import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CELL_SIZE } from '../../src/core/constants';
import { Emitter } from '../../src/core/events';
import { Overlay } from '../../src/core/types';
import { BF, type CityState } from '../../src/sim/CityState';
import type { CityEvents } from '../../src/sim/Simulation';
import { REPLICA } from '../../src/save/state';
import { PostFX } from '../../src/render/world/PostFX';
import { SkySystem, smogSunTransmission } from '../../src/render/world/Sky';
import { DistrictSmog, WorldView } from '../../src/render/world/WorldView';
import { QUALITY_PRESETS, type QualitySettings } from '../../src/render/world/quality';
import { newState, place } from '../infra/cityGen';

function skyWithoutGPU() {
  const sky = new SkySystem({} as THREE.WebGLRenderer, 'temperate', [32, 16], 32);
  const internals = sky as unknown as { renderLut(): void; renderEnv(): void; envRT: THREE.WebGLRenderTarget };
  internals.envRT = new THREE.WebGLRenderTarget(32, 16);
  const lut = vi.spyOn(internals, 'renderLut').mockImplementation(() => {});
  const env = vi.spyOn(internals, 'renderEnv').mockImplementation(() => {});
  return { sky, lut, env };
}

interface WorldHarness {
  state: CityState;
  q: QualitySettings;
  overlay: Overlay;
  smog?: DistrictSmog;
  sky: SkySystem;
  post: PostFX;
  cameraController: { target: THREE.Vector3; distance: number };
  updateSmog(dt: number): void;
  updateAtmosphere(): void;
}

function worldWithoutGPU(q: QualitySettings): WorldHarness {
  const state = newState(128);
  place(state, 't_r1', 32, 32, { flags: BF.Polluted });
  state.history.air.push(1);
  const { sky } = skyWithoutGPU();
  const post = new PostFX({} as THREE.WebGLRenderer, q);
  const world = Object.assign(Object.create(WorldView.prototype), {
    state, q, sky, post, overlay: Overlay.None, clock: 0, _time: 13,
    renderer: { toneMappingExposure: 1 },
    cameraController: { target: new THREE.Vector3(32.5 * CELL_SIZE, 0, 32.5 * CELL_SIZE), distance: 800 },
  }) as WorldHarness;
  sky.update(13, 12, 0, new THREE.Vector3(), new THREE.Scene());
  world.updateSmog(0);
  world.smog!.value = 0.6;
  world.smog!.tint = 1;
  return world;
}

describe('smog world wiring', () => {
  for (const q of Object.values(QUALITY_PRESETS)) {
    it(`${q.level}: scales the existing haze and applies the tier's tint/sun policy`, () => {
      const w = worldWithoutGPU(q);
      w.smog!.value = 0;
      w.smog!.tint = 0;
      w.updateAtmosphere();
      const clean = w.post.fog.uHaze.value;
      const grade = structuredClone(w.post.grade);
      w.smog!.value = 0.6;
      w.smog!.tint = 1;
      w.updateSmog(0);
      w.updateAtmosphere();
      expect(w.post.fog.uHaze.value).toBeCloseTo(clean * 2.5, 14);
      expect(w.post.fog.uSmog.value).toBe(q.level === 'low' ? 0 : 1);
      expect(w.sky.smog).toBe(q.level === 'low' ? 0 : 1);
      expect(structuredClone(w.post.grade)).toEqual(grade);
      for (const overlay of Object.values(Overlay).filter((v): v is Overlay => typeof v === 'number' && v !== Overlay.None)) {
        w.overlay = overlay;
        w.updateSmog(0);
        w.updateAtmosphere();
        expect(w.post.fog.uHaze.value, Overlay[overlay]).toBe(clean);
        expect(w.post.fog.uSmog.value).toBe(0);
        expect(w.sky.smog).toBe(0);
      }
      w.overlay = Overlay.None;
      w.updateSmog(0);
      w.updateAtmosphere();
      expect(w.post.fog.uHaze.value).toBeCloseTo(clean * 2.5, 14);
      w.post.dispose();
      w.sky.dispose();
    });
  }

  it('invalidates through existing pollution and building callbacks, without adding listeners', () => {
    const w = worldWithoutGPU(QUALITY_PRESETS.high);
    const events = new Emitter<CityEvents>();
    const unsub: (() => void)[] = [];
    Object.assign(w, {
      events, unsub,
      terrain: { markCells() {}, onLayerUpdated() {} }, trees: { onCellsChanged() {} },
    });
    (w as unknown as { bindEvents(): void }).bindEvents();
    const invalidate = vi.spyOn(w.smog!, 'invalidate');
    events.emit('layerUpdated', 'traffic');
    expect(invalidate).not.toHaveBeenCalled();
    events.emit('layerUpdated', 'pollution');
    const b = w.state.buildings.values().next().value!;
    events.emit('buildingAdded', b);
    events.emit('buildingRemoved', b);
    expect(invalidate).toHaveBeenCalledTimes(3);
    for (const off of unsub) off();
    events.emit('layerUpdated', 'pollution');
    expect(invalidate).toHaveBeenCalledTimes(3);
    w.post.dispose();
    w.sky.dispose();
  });

  it('keeps clean-city smog and atmosphere uniforms exactly at the baseline', () => {
    const w = worldWithoutGPU(QUALITY_PRESETS.high);
    w.state.buildings.clear();
    w.state.history.air.push(0.9);
    w.smog = undefined;
    w.updateSmog(0);
    w.updateAtmosphere();
    const haze = w.post.fog.uHaze.value;
    for (let i = 0; i < 24; i++) {
      w.updateSmog(0.25);
      w.updateAtmosphere();
      expect(w.smog!.value).toBe(0);
      expect(w.smog!.tint).toBe(0);
      expect(w.sky.smog).toBe(0);
      expect(w.post.fog.uSmog.value).toBe(0);
      expect(w.post.fog.uHaze.value).toBe(haze);
    }
    w.post.dispose();
    w.sky.dispose();
  });

  it.each(['same city', 'different seed', 'different name', 'different region', 'different tile', 'real reset', 'local reset', 'same replica'])(
    'preserves resync easing only for the same city (%s)', (kind) => {
      const w = worldWithoutGPU(QUALITY_PRESETS.high);
      const fresh = newState(128);
      place(fresh, 't_r1', 32, 32, { flags: BF.Polluted });
      fresh.history.air.push(1);
      if (kind === 'different seed') fresh.config.seed++;
      if (kind === 'different name') fresh.config.name = 'Another city';
      if (kind === 'different region') fresh.config.regionId = 'other';
      if (kind === 'different tile') fresh.config.tileX = 1;
      if (kind !== 'local reset') {
        Object.defineProperty(w.state, REPLICA, { value: true });
        Object.defineProperty(fresh, REPLICA, { value: true });
      }
      const events = new Emitter<CityEvents>(), unsub: (() => void)[] = [];
      Object.assign(w, {
        events, unsub, getState: () => kind === 'same replica' ? w.state : fresh, shForce: 0,
        terrain: { reset() {}, heightRange: () => [0, 1], worldHeight: () => 0 },
        trees: { reset() {} }, water: { updateOuter() {} },
      });
      const methods = w as unknown as { bindEvents(): void; setState(state: CityState): void };
      methods.bindEvents();
      const cache = w.smog!, before = cache.value, beforeTint = cache.tint;
      if (kind === 'real reset') methods.setState(fresh);
      else events.emit('reset', undefined);
      if (kind !== 'same replica') expect(w.state).toBe(fresh);
      w.updateSmog(0);
      w.updateAtmosphere();
      if (kind === 'same city') {
        expect(w.smog).toBe(cache);
        expect(cache.value).toBe(before);
        expect(cache.tint).toBe(beforeTint);
        expect(w.post.fog.uSmog.value).toBe(beforeTint);
      } else {
        expect(w.smog).not.toBe(cache);
        expect(w.smog!.value).toBe(0);
        expect(w.smog!.tint).toBe(0);
        expect(w.post.fog.uSmog.value).toBe(0);
      }
      for (const off of unsub) off();
      w.post.dispose();
      w.sky.dispose();
    },
  );
});

describe('smog sun', () => {
  it('uses the eased tint directly, leaving zero exact with a bounded dimming floor', () => {
    for (const s of [-1, 0]) expect(smogSunTransmission(s)).toBe(1);
    expect(smogSunTransmission(0.5)).toBe(0.875);
    expect(smogSunTransmission(1)).toBe(0.75);
    expect(smogSunTransmission(2)).toBe(0.75);
  });

  it('dims daylight and the disk, preserves moonlight, and does not refresh LUT/PMREM when panning into smog', () => {
    const { sky, lut, env } = skyWithoutGPU();
    const scene = new THREE.Scene(), camera = new THREE.Vector3();
    sky.update(13, 12, 0, camera, scene, true);
    const day = sky.lighting.lightIntensity, disk = sky.uniforms.uSunDisk.value.clone();
    const lutCalls = lut.mock.calls.length, envCalls = env.mock.calls.length;
    sky.smog = 1;
    sky.update(13, 12, 0.1, camera, scene);
    expect(sky.lighting.lightIntensity).toBe(day * 0.75);
    disk.multiplyScalar(0.75).toArray().forEach((v, i) => expect(sky.uniforms.uSunDisk.value.getComponent(i)).toBeCloseTo(v, 12));
    expect(lut).toHaveBeenCalledTimes(lutCalls);
    expect(env).toHaveBeenCalledTimes(envCalls);
    sky.smog = 0;
    sky.update(22, 12, 1, camera, scene);
    const moon = sky.lighting.lightIntensity;
    sky.smog = 1;
    sky.update(22, 12, 1.1, camera, scene);
    expect(sky.lighting.lightIntensity).toBe(moon);
    sky.dispose();
  });
});
