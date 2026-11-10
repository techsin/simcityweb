import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { Climate } from '../../src/core/types';
import { Simulation } from '../../src/sim/Simulation';
import { advisorsSystem, advisorData } from '../../src/sim/economy/advisors';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { Weather, weather } from '../../src/render/world/Weather';
import { patchSurfaceMaterial, sharedUniforms } from '../../src/assets/materials';
import { getRoadMaterial, roadUniforms } from '../../src/render/city/roads/roadMaterial';
import { newState } from '../infra/cityGen';

const climates: Climate[] = ['temperate', 'desert', 'tropical', 'alpine'];

describe('FEEL-23 shared weather calendar', () => {
  it('is repeatable in three-day spells across climates and seasons, without a random draw', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('weather must not draw random'); });
    try {
      for (const climate of climates) for (let seed = 1; seed <= 10; seed++) for (let day = 0; day < 720; day += 3) {
        const first = weather(day, seed, climate);
        expect(weather(day + 1, seed, climate)).toEqual(first);
        expect(weather(day + 2, seed, climate)).toEqual(first);
        expect(weather(day, seed, climate)).toEqual(first);
        expect(first.intensity).toBeGreaterThanOrEqual(0);
        expect(first.intensity).toBeLessThanOrEqual(1);
        if (first.kind === 'clear') expect(first.intensity).toBe(0);
        if (first.kind === 'snow') {
          expect(['temperate', 'alpine']).toContain(climate);
          expect([0, 1, 11]).toContain(Math.floor(day / 30) % 12);
        }
        if (climate === 'desert') expect(['clear', 'haze']).toContain(first.kind);
        else expect(first.kind).not.toBe('haze');
        if (climate === 'tropical') expect(first.kind).not.toBe('snow');
      }
    } finally { random.mockRestore(); }
  });

  it('has spring/autumn rain, winter snow and desert haze, and keeps three out of the runtime import graph', () => {
    const seen = new Set<string>();
    for (let day = 0; day < 360; day++) {
      const month = Math.floor(day / 30);
      const temperate = weather(day, 7);
      if (temperate.kind === 'rain' && month >= 2 && month <= 4) seen.add('spring rain');
      if (temperate.kind === 'rain' && month >= 8 && month <= 10) seen.add('autumn rain');
      if (temperate.kind === 'snow') seen.add('winter snow');
      if (weather(day, 7, 'desert').kind === 'haze') seen.add('desert haze');
    }
    expect([...seen].sort()).toEqual(['autumn rain', 'desert haze', 'spring rain', 'winter snow']);
    const source = readFileSync(new URL('../../src/render/world/Weather.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/import type \* as Three from 'three'/);
    expect(source.replace(/^import type[^\n]*$/gm, '')).not.toMatch(/(?:from\s*|import\s*\()['"]three['"]/);
  });

  it('posts snow/rain copy only on matching days, using the same calendar as the visible particles', () => {
    for (const climate of climates) {
      const st = newState(64);
      st.config.seed = 7; st.config.climate = climate; st.stats.population = 1000;
      st.milestones.civ_elementary_school = 1;
      const adv = advisorsSystem(new EconRuntime()), sim = new Simulation(st, [adv]);
      const a = advisorData(st), renderer = new Weather(new THREE.Scene(), THREE), target = new THREE.Vector3(100, 0, 100);
      let snow = 0, rain = 0;
      for (let day = 0; day < 360; day++) for (const id of ['snowball', 'snowday', 'showers']) {
        st.day = day; st.news.length = 0;
        a.nextHeadline = day; a.bag = [id]; a.shown = {};
        adv.daily!(sim);
        const current = renderer.update(st, target, 5, 0, 'high');
        expect(current).toEqual(weather(day, 7, climate));
        const expected = id === 'showers' ? current.kind === 'rain' && st.month === 3 : current.kind === 'snow';
        const prefix = id === 'snowball' ? 'Snowfall turns' : id === 'snowday' ? 'Snow day!' : 'April showers:';
        expect(st.news.some((n) => n.text.startsWith(prefix)), `${climate} day ${day} ${id}`).toBe(expected);
        for (const n of st.news) {
          if (/^Snowfall turns|^Snow day!/.test(n.text)) { expect(current.kind).toBe('snow'); snow++; }
          if (/^April showers:/.test(n.text)) { expect(current.kind).toBe('rain'); rain++; }
        }
        if (expected) {
          expect(renderer.particles.visible).toBe(true);
          expect(renderer.uniforms.uSnow.value).toBe(id === 'showers' ? 0 : 1);
        }
      }
      if (climate === 'temperate' || climate === 'alpine') expect(snow).toBeGreaterThan(0);
      if (climate !== 'desert') expect(rain).toBeGreaterThan(0);
      renderer.dispose();
    }
  });
});

describe('FEEL-23 cosmetic renderer and materials', () => {
  it('caps High at 768 particles, uses depth-tested transparent precipitation, and leaves city/RNG state alone', () => {
    const st = newState(64), sim = new Simulation(st), scene = new THREE.Scene(), renderer = new Weather(scene, THREE);
    const state = structuredClone(st.systemData), water = st.water.slice(), rng = sim.rng.state;
    const target = new THREE.Vector3(20, 0, 30), seeds = renderer.particles.geometry.getAttribute('seed');
    expect(seeds.count).toBe(1024);
    expect(renderer.particles.material.depthWrite).toBe(false);
    expect(renderer.particles.material.depthTest).toBe(true);
    expect(renderer.particles.material.transparent).toBe(true);
    for (const [quality, count] of [['low', 256], ['medium', 512], ['high', 768], ['ultra', 1024]] as const) {
      const current = renderer.update(st, target, 12, 0.1, quality);
      expect(renderer.particles.geometry.drawRange.count).toBe(count);
      expect(renderer.uniforms.uAnchor.value.toArray()).toEqual([20, 12, 30]);
      expect(renderer.particles.visible).toBe(current.kind === 'snow' || current.kind === 'rain');
      expect(renderer.particles.geometry.getAttribute('seed')).toBe(seeds);
    }
    expect(st.systemData).toEqual(state); expect(st.water).toEqual(water); expect(sim.rng.state).toBe(rng);
    const disposed = vi.fn();
    renderer.particles.geometry.addEventListener('dispose', disposed);
    renderer.particles.material.addEventListener('dispose', disposed);
    renderer.dispose();
    expect(disposed).toHaveBeenCalledTimes(2);
    expect(renderer.particles.parent).toBeNull();
  });

  it('recomputes weather when the city replica is replaced on a reset', () => {
    const a = newState(64), b = newState(64), renderer = new Weather(new THREE.Scene(), THREE);
    a.config.climate = 'desert'; b.config.climate = 'alpine';
    for (let day = 0; day < 60; day++) if (weather(day, a.config.seed, a.config.climate).kind !== weather(day, b.config.seed, b.config.climate).kind) {
      a.day = b.day = day;
      const before = renderer.update(a, new THREE.Vector3(), 5, 0, 'high');
      const after = renderer.update(b, new THREE.Vector3(), 5, 0, 'high');
      expect(before).not.toEqual(after);
      expect(after).toEqual(weather(day, b.config.seed, 'alpine'));
      renderer.dispose();
      return;
    }
    renderer.dispose();
    throw new Error('expected differing desert/alpine weather');
  });

  it('binds live roof-snow and road-wetness uniforms into the existing material shaders', () => {
    const shader = () => ({ uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
      vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader });
    const roof = patchSurfaceMaterial(new THREE.MeshStandardMaterial()), roofShader = shader(), roadShader = shader();
    roof.onBeforeCompile(roofShader as Parameters<typeof roof.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    const road = getRoadMaterial();
    road.onBeforeCompile(roadShader as Parameters<typeof road.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    expect(roofShader.uniforms.uWeatherSnow).toBe(sharedUniforms.uWeatherSnow);
    expect(roofShader.fragmentShader).toContain('uniform float uWeatherSnow;');
    expect(roofShader.fragmentShader).toContain('smoothstep(0.25, 0.8, vObjNormal.y)');
    expect(roofShader.fragmentShader).toContain('step(2.5, vSurf.x) * (1.0 - step(4.5, vSurf.x))');
    expect(roadShader.uniforms.uRoadWet).toBe(roadUniforms.uRoadWet);
    expect(roadShader.fragmentShader).toContain('uniform float uRoadWet;');
    expect(roadShader.fragmentShader).toContain('rough = mix(rough, 0.18, uRoadWet)');
    expect(roadShader.fragmentShader).toContain('albedo *= 1.0 - 0.22 * uRoadWet');
    roof.dispose();
  });
});
