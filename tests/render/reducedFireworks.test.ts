/** FEEL-21: render-only flash limits, live particles and unchanged Full show programs/scheduling. */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { sharedUniforms } from '../../src/assets/materials';
import { Fireworks, type FireworksSoundFn } from '../../src/render/city/effects/Fireworks';
import { waterFlashUniforms } from '../../src/render/world/waterFlash';

interface Internals {
  clock: number;
  seed: number;
  data: Float32Array;
  death: Float32Array;
  smokeData: Float32Array;
  queue: Float64Array;
  flT: Float64Array;
  flP: Float32Array;
  poolFl: Int16Array;
  flPool: Int8Array;
  poolE: Float32Array;
  poolC: THREE.Vector3[];
  qN: number;
  qHead: number;
  nextShot: number;
  nextSalvo: number;
  uniforms: { uGain: { value: number } };
  smokeU: { uGlow: { value: number } };
  updateLights(): void;
  queueFlash(time: number, x: number, y: number, z: number, col: readonly [number, number, number], strength: number, radius: number): void;
}
const inside = (fw: Fireworks) => fw as unknown as Internals;
const material = (mesh: THREE.Mesh) => mesh.material as THREE.ShaderMaterial;
const bytes = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
const shows: Fireworks[] = [];
let night = 0;

beforeEach(() => {
  night = sharedUniforms.uNight.value;
  sharedUniforms.uNight.value = 1;
  vi.spyOn(performance, 'now').mockReturnValue(1000);
});
afterEach(() => {
  for (const show of shows.splice(0)) show.dispose();
  sharedUniforms.uNight.value = night;
  vi.restoreAllMocks();
});

function make() {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 30000);
  camera.position.set(800, 650, 1500);
  camera.lookAt(800, 200, 800);
  camera.updateMatrixWorld();
  const fill = new THREE.HemisphereLight(0xb8ccff, 0x222222, 0.5);
  const fw = new Fireworks({
    camera, fill: () => fill, mapSize: 1600, groundAt: () => 0, quality: 'high',
    getSites: () => [{ x: 800, y: 0, z: 800, kind: 'centre', weight: 1 }],
    water: () => ({ data: new Uint8Array(100).fill(1), size: 10, cellSize: 160 }),
  });
  shows.push(fw);
  fw.start({ seed: 7, population: 1000000, duration: 6 });
  fw.update(0);
  return { fw, p: inside(fw), fill };
}

function state(fw: Fireworks) {
  const p = inside(fw);
  return {
    clock: p.clock, seed: p.seed, shells: fw.shells, spawned: fw.spawned, dropped: fw.dropped,
    qN: p.qN, qHead: p.qHead, nextShot: p.nextShot, nextSalvo: p.nextSalvo,
    active: fw.active, settled: fw.settled, time: fw.time,
  };
}

function sameParticles(a: Fireworks, b: Fireworks) {
  const x = inside(a), y = inside(b);
  expect(state(a)).toEqual(state(b));
  for (const key of ['data', 'death', 'smokeData', 'queue', 'flT', 'flP', 'poolFl', 'flPool', 'poolE'] as const) {
    expect(bytes(x[key]).equals(bytes(y[key])), key).toBe(true);
  }
}

describe('FEEL-21 fireworks', () => {
  it('keeps Full shader programs byte-identical to round 1 and restores them after a live toggle', () => {
    const { fw } = make();
    for (const mesh of [fw.mesh, fw.reflection]) {
      expect(hash(material(mesh).vertexShader)).toBe('76008c41aa84d998c5f33d4518e7b002efacc4d09fa5e71f389a9a3115694f82');
      expect(hash(material(mesh).fragmentShader)).toBe('8c1eeb2c3ab976cac164fde9f1d2f80750608c8373456b55a25cfc6ca7b5a4b7');
    }
    const version = material(fw.mesh).version;
    fw.setFlashStrength(1);
    expect(material(fw.mesh).version).toBe(version);
    fw.setFlashStrength(0.5);
    expect(material(fw.mesh).version).toBe(version + 1);
    fw.setFlashStrength(0.5);
    expect(material(fw.mesh).version).toBe(version + 1);
    fw.setFlashStrength(1);
    expect(hash(material(fw.mesh).vertexShader)).toBe('76008c41aa84d998c5f33d4518e7b002efacc4d09fa5e71f389a9a3115694f82');
    expect(hash(material(fw.reflection).fragmentShader)).toBe('8c1eeb2c3ab976cac164fde9f1d2f80750608c8373456b55a25cfc6ca7b5a4b7');
  });

  it('leaves the director, random stream, sounds, particle bytes and native lifetimes identical through a whole show', () => {
    const a = make(), b = make();
    const soundsA: Parameters<FireworksSoundFn>[] = [], soundsB: Parameters<FireworksSoundFn>[] = [];
    a.fw.onSound = (...event) => soundsA.push(event);
    b.fw.onSound = (...event) => soundsB.push(event);
    b.fw.setFlashStrength(0.5);
    for (let frame = 0; frame < 240; frame++) {
      if (frame === 100) b.fw.setFlashStrength(1);
      if (frame === 150) b.fw.setFlashStrength(0.5);
      a.fw.update(0.1);
      const fullWater = waterFlashUniforms.uFlashCol.value.map((c) => c.toArray());
      b.fw.update(0.1);
      sameParticles(a.fw, b.fw);
      if (frame >= 100 && frame < 150) {
        expect(b.p.uniforms.uGain.value).toBe(a.p.uniforms.uGain.value);
        expect(b.p.poolC.map((c) => c.toArray())).toEqual(a.p.poolC.map((c) => c.toArray()));
        expect(waterFlashUniforms.uFlashCol.value.map((c) => c.toArray())).toEqual(fullWater);
        expect(b.fill.intensity).toBeCloseTo(a.fill.intensity, 14);
      }
    }
    expect(a.fw.spawned).toBeGreaterThan(0);
    expect(soundsB).toEqual(soundsA);
    expect(soundsA.length).toBeGreaterThan(0);
  });

  it('halves spark, own-smoke, ground, water and final nonlinear fill-light output immediately at a frozen flash', () => {
    const { fw, p, fill } = make();
    p.clock = 10.05;
    p.queueFlash(10, 800, 190, 800, [1, 0.3, 0.1], 1, 80);
    p.updateLights();
    const gain = p.uniforms.uGain.value, glow = p.smokeU.uGlow.value;
    const pools = p.poolC.map((c) => c.clone());
    const water = waterFlashUniforms.uFlashCol.value.map((c) => c.clone());
    const delta = fill.intensity - 0.5;
    const particles = Buffer.from(bytes(p.data)), before = state(fw);
    expect(delta).toBeGreaterThan(0);
    expect(pools.some((c) => c.lengthSq() > 0)).toBe(true);
    expect(water[0].lengthSq()).toBeGreaterThan(0);
    fw.timeScale = 0;
    fw.setFlashStrength(0.5);
    expect(state(fw)).toEqual(before);
    expect(bytes(p.data).equals(particles)).toBe(true);
    expect(p.uniforms.uGain.value).toBe(gain * 0.5);
    expect(p.smokeU.uGlow.value).toBe(glow * 0.5);
    for (let i = 0; i < pools.length; i++) expect(p.poolC[i].toArray()).toEqual(pools[i].multiplyScalar(0.5).toArray());
    for (let i = 0; i < water.length; i++) expect(waterFlashUniforms.uFlashCol.value[i].toArray()).toEqual(water[i].multiplyScalar(0.5).toArray());
    expect(fill.intensity - 0.5).toBeCloseTo(delta * 0.5, 14);
    fw.setFlashStrength(1);
    expect(p.uniforms.uGain.value).toBe(gain);
    expect(p.smokeU.uGlow.value).toBe(glow);
    expect(fill.intensity - 0.5).toBeCloseTo(delta, 14);
  });

  it('coalesces dense finale lights into at most three onsets in any rolling second', () => {
    const { fw, p, fill } = make();
    fw.setFlashStrength(0.5);
    const onsets: number[][] = [[], [], []];
    let lit = [false, false, false];
    for (let frame = 1; frame <= 1200; frame++) {
      const now = frame / 200;
      p.clock = now;
      if (frame % 2 === 0) p.queueFlash(now, 800, 190, 800, [1, 0.8, 0.6], 1, 80);
      p.updateLights();
      const channels = [fill.intensity - 0.5 > 1e-6, p.poolC.some((c) => c.lengthSq() > 0), waterFlashUniforms.uFlashCol.value.some((c) => c.lengthSq() > 0)];
      for (let channel = 0; channel < channels.length; channel++) {
        if (channels[channel] && !lit[channel]) onsets[channel].push(now);
        if (!channels[channel] && lit[channel]) expect(now - onsets[channel].at(-1)!).toBeLessThanOrEqual(0.165);
      }
      lit = channels;
    }
    for (const channel of onsets) {
      expect(channel.length).toBeGreaterThan(10);
      for (let i = 0; i < channel.length; i++) {
        expect(channel.filter((at) => at >= channel[i] && at < channel[i] + 1 - 1e-9).length).toBeLessThanOrEqual(3);
        if (i) expect(channel[i] - channel[i - 1]).toBeGreaterThanOrEqual(0.395);
      }
    }
  });

  it('admits crackle and flash sprites on the same grid without extending their native lifetime', () => {
    const { fw } = make();
    fw.setFlashStrength(0.5);
    const vertex = material(fw.mesh).vertexShader;
    const nativeGuard = vertex.indexOf('if (age < 0.0 || age > life)');
    const retime = vertex.indexOf('if (kind >= 4.0)');
    expect(nativeGuard).toBeGreaterThan(0);
    expect(retime).toBeGreaterThan(nativeGuard);
    expect(vertex.slice(retime, retime + 200)).toContain('ceil(aP0.w / 0.4) * 0.4');
    expect(vertex.slice(retime, retime + 200)).toContain('if (age < 0.0)');
    // The shader's native guard intersects the new onset with the old lifetime, including 60 ms crackle pops.
    for (const life of [0.06, 0.09, 0.1, 0.13, 0.16]) {
      const ticks = new Set<number>();
      for (let i = 1; i <= 1000; i++) {
        const birth = i / 200;
        const tick = Math.ceil(birth / 0.4) * 0.4;
        if (tick <= birth + life) ticks.add(tick);
      }
      const onsets = [...ticks].sort((a, b) => a - b);
      for (const at of onsets) expect(onsets.filter((t) => t >= at && t < at + 1 - 1e-9).length).toBeLessThanOrEqual(3);
    }
  });

  it('removes fast blink/glitter from particles already in flight and fades in ember/split births', () => {
    const { fw, p } = make();
    fw.fastForward(4);
    const before = Buffer.from(bytes(p.data));
    fw.setFlashStrength(0.5);
    const vertex = material(fw.mesh).vertexShader, fragment = material(fw.reflection).fragmentShader;
    expect(vertex).toContain('float rnd = 0.5;');
    expect(vertex).toContain('float on = 0.3;');
    expect(vertex).not.toContain('if (!snap)');
    expect(vertex).toContain('(0.25 + 0.95 * rnd) * smoothstep(0.0, min(0.15, life * 0.5), age)');
    expect(fragment).toContain('if (false) {');
    expect(fragment).toContain('br *= 0.8;');
    expect(fragment).not.toContain('br *= step(0.5, band)');
    expect(bytes(p.data).equals(before)).toBe(true);
    fw.setFlashStrength(1);
    expect(material(fw.mesh).vertexShader).toContain('float on = step(fract(uTime * aK.w + aK.y * 7.0), 0.3);');
    expect(bytes(p.data).equals(before)).toBe(true);
  });

  it('keeps Reduced through quality changes, a hard restart and a rank show without adding random draws', () => {
    const { fw, p } = make();
    fw.setFlashStrength(0.5);
    const seed = p.seed;
    fw.setQuality('low');
    expect(p.seed).toBe(seed);
    fw.stop(true);
    fw.start({ seed: 11, rankBurst: true, duration: 8 });
    fw.update(0.1);
    expect(p.uniforms.uGain.value).toBe(0.5);
    expect(material(fw.mesh).vertexShader).toContain('float rnd = 0.5;');
    fw.setFlashStrength(1);
    expect(p.uniforms.uGain.value).toBe(1);
    expect(hash(material(fw.mesh).vertexShader)).toBe('76008c41aa84d998c5f33d4518e7b002efacc4d09fa5e71f389a9a3115694f82');
  });
});
