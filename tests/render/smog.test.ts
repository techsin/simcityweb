import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BF, type CityState } from '../../src/sim/CityState';
import { DistrictSmog } from '../../src/render/world/WorldView';
import { PostFX } from '../../src/render/world/PostFX';
import { QUALITY_PRESETS } from '../../src/render/world/quality';
import { newState, place } from '../infra/cityGen';

afterEach(() => vi.restoreAllMocks());

/** Advance with the same maximum timestep as WorldView, without a renderer. */
function advance(smog: DistrictSmog, state: CityState, seconds: number, x: number, z: number): number {
  for (let left = seconds; left > 1e-9; left -= 0.25) smog.update(state, Math.min(0.25, left), x, z);
  return smog.value;
}

describe('FEEL-16 district smog', () => {
  it('uses an exact 32-cell circle around the camera target and building centers', () => {
    const st = newState(128);
    place(st, 't_r3', 95, 63, { flags: BF.Polluted }); // center (96,64): exactly 32 away
    place(st, 't_r3', 31, 63, { flags: BF.Polluted }); // center (32,64): opposite boundary
    place(st, 't_r3', 63, 63); // one clean building in the center
    place(st, 't_r3', 96, 63, { flags: BF.Polluted }); // anchor in the circle, center outside
    place(st, 't_r3', 95, 95, { flags: BF.Polluted }); // within the square, outside the circle
    const smog = new DistrictSmog();
    smog.update(st, 0, 64, 64);
    expect(advance(smog, st, 3, 64, 64)).toBeCloseTo((8 / 15) * (1 - Math.exp(-3)), 12);
  });

  it('counts each building once regardless of footprint, occupancy, or other flags', () => {
    const st = newState(128);
    place(st, 't_r3', 60, 60, { w: 8, d: 8, pop: 400, flags: BF.Polluted | BF.NoRoad });
    place(st, 't_r1', 70, 64, { pop: 0, flags: BF.Noisy | BF.NoGarbage });
    st.history.air.push(0.5);
    const smog = new DistrictSmog();
    expect(advance(smog, st, 3, 64, 64)).toBeCloseTo(0.5 * (1 - Math.exp(-3)), 12);
  });

  it.each([
    { air: undefined, target: 0.48 },
    { air: 0.2, target: 0.52 },
    { air: 0.6, target: 0.6 },
    { air: 2, target: 0.6 },
    { air: -1, target: 0.48 },
    { air: NaN, target: 0.48 },
    { air: Infinity, target: 0.48 },
  ])('blends the latest air history safely ($air)', ({ air, target }) => {
    const st = newState(64);
    for (let i = 0; i < 5; i++) place(st, 't_r1', 20 + i, 20, { flags: i < 3 ? BF.Polluted : 0 });
    if (air !== undefined) st.history.air.push(0.9, air);
    const smog = new DistrictSmog();
    expect(advance(smog, st, 3, 24, 24)).toBeCloseTo(target * (1 - Math.exp(-3)), 12);
  });

  it.each([false, true])('leaves a clean district unchanged with stale air history (empty: %s)', (empty) => {
    const st = newState(64);
    if (!empty) place(st, 't_r1', 20, 20, { flags: BF.NoRoad | BF.Noisy });
    st.history.air.push(1);
    st.airPollution.fill(1);
    const smog = new DistrictSmog();
    expect(advance(smog, st, 6, 24, 24)).toBe(0);
    expect(smog.tint).toBe(0);
  });

  it('samples a moving camera at the half-second boundary and eases between samples', () => {
    const st = newState(128);
    place(st, 't_r1', 20, 20, { flags: BF.Polluted });
    place(st, 't_r1', 100, 100);
    const smog = new DistrictSmog();
    smog.update(st, 0, 20, 20);
    smog.update(st, 0.25, 100, 100);
    smog.update(st, 0.24, 100, 100);
    const before = 0.8 * (1 - Math.exp(-0.49));
    expect(smog.value).toBeCloseTo(before, 12);
    smog.update(st, 0.01, 100, 100);
    expect(smog.value).toBeCloseTo(before * Math.exp(-0.01), 12);
  });

  it('keeps the two-Hz sample cadence across uneven frame intervals', () => {
    const st = newState(64);
    place(st, 't_r1', 20, 20, { flags: BF.Polluted });
    let samples = 0;
    Object.defineProperty(st.history, 'air', { get: () => { samples++; return [0]; } });
    const smog = new DistrictSmog();
    smog.update(st, 0, 20, 20);
    for (let i = 0; i < 5; i++) smog.update(st, 0.2, 20, 20);
    expect(samples, 'initial sample, then 0.5 and 1.0 seconds').toBe(3);
  });

  it('reaches 95% in three seconds, independent of frame size', () => {
    const st = newState(64);
    place(st, 't_r1', 20, 20, { flags: BF.Polluted });
    st.history.air.push(1);
    const quarterFrames = new DistrictSmog(), tenthFrames = new DistrictSmog();
    advance(quarterFrames, st, 3, 20, 20);
    for (let i = 0; i < 30; i++) tenthFrames.update(st, 0.1, 20, 20);
    expect(quarterFrames.value).toBeCloseTo(1 - Math.exp(-3), 12);
    expect(tenthFrames.value).toBeCloseTo(quarterFrames.value, 12);
    expect(tenthFrames.tint).toBeCloseTo(quarterFrames.tint, 12);
  });

  it('eases partial-strength tint in and out symmetrically without a threshold delay', () => {
    const st = newState(128);
    for (let i = 0; i < 5; i++) place(st, 't_r1', 20 + i, 20, { flags: i < 3 ? BF.Polluted : 0 });
    place(st, 't_r1', 100, 100);
    const strength = THREE.MathUtils.smoothstep(0.48, 0.25, 0.6);
    const arriving = new DistrictSmog(), leaving = new DistrictSmog();
    arriving.update(st, 0, 24, 24);
    leaving.update(st, 0, 100, 100);
    leaving.value = 0.48;
    leaving.tint = strength;
    for (let i = 0; i < 12; i++) {
      arriving.update(st, 0.25, 24, 24);
      leaving.update(st, 0.25, 100, 100);
      expect(arriving.tint + leaving.tint).toBeCloseTo(strength, 12);
      expect(arriving.value + leaving.value).toBeCloseTo(0.48, 12);
      expect(arriving.tint, 'brown begins on the first eased frame').toBeGreaterThan(0);
    }
    expect(arriving.tint / strength).toBeCloseTo(1 - Math.exp(-3), 12);
    expect(leaving.tint / strength).toBeCloseTo(Math.exp(-3), 12);
    advance(leaving, st, 9, 100, 100);
    expect(leaving.value).toBe(0);
    expect(leaving.tint).toBe(0);
  });

  it('keeps tint exactly zero when the sampled smog is below the threshold', () => {
    const st = newState(64);
    for (let i = 0; i < 5; i++) place(st, 't_r1', 20 + i, 20, { flags: i === 0 ? BF.Polluted : 0 });
    const smog = new DistrictSmog();
    expect(advance(smog, st, 3, 24, 24)).toBeGreaterThan(0);
    expect(smog.tint).toBe(0);
  });

  it('snapshots flags only when dirty, at most once per absolute game month', () => {
    const st = newState(64);
    const b = place(st, 't_r1', 20, 20, { flags: BF.Polluted });
    const scans = vi.spyOn(st.buildings, 'values');
    const smog = new DistrictSmog();
    smog.update(st, 0, 20, 20);
    expect(scans).toHaveBeenCalledTimes(1);
    b.flags = 0;
    smog.invalidate();
    advance(smog, st, 1, 20, 20);
    expect(scans).toHaveBeenCalledTimes(1);
    expect(smog.value, 'the same month keeps its flag snapshot').toBeCloseTo(0.8 * (1 - Math.exp(-1)), 12);
    st.day = 360; // January again, but a different monthIndex
    advance(smog, st, 0.25, 20, 20);
    const before = smog.value;
    advance(smog, st, 0.25, 20, 20);
    expect(scans).toHaveBeenCalledTimes(2);
    expect(smog.value).toBeCloseTo(before * Math.exp(-0.25), 12);
    st.day = 390;
    advance(smog, st, 0.5, 20, 20);
    expect(scans, 'a new month alone does not trigger a map scan').toHaveBeenCalledTimes(2);
    b.flags = BF.Polluted;
    smog.invalidate();
    advance(smog, st, 0.5, 20, 20);
    expect(scans).toHaveBeenCalledTimes(3);
  });

  it('drops cached flags and the eased value when a replacement replica is adopted', () => {
    const dirty = newState(64), clean = newState(64);
    place(dirty, 't_r1', 20, 20, { flags: BF.Polluted });
    place(clean, 't_r1', 20, 20);
    clean.history.air.push(1);
    const smog = new DistrictSmog();
    expect(advance(smog, dirty, 3, 20, 20)).toBeGreaterThan(0);
    expect(smog.update(clean, 0, 20, 20)).toBe(0);
    expect(smog.tint).toBe(0);
    expect(advance(smog, clean, 1, 20, 20)).toBe(0);
  });

  it('keeps both eased values on an explicit same-city adoption while replacing the snapshot', () => {
    const old = newState(64), fresh = newState(64);
    place(old, 't_r1', 20, 20, { flags: BF.Polluted });
    place(fresh, 't_r1', 20, 20);
    const smog = new DistrictSmog();
    advance(smog, old, 3, 20, 20);
    const value = smog.value, tint = smog.tint;
    smog.adopt(fresh, true);
    expect(smog.value).toBe(value);
    expect(smog.tint).toBe(tint);
    smog.update(fresh, 0, 20, 20);
    expect(smog.value).toBe(value);
    expect(smog.tint).toBe(tint);
    advance(smog, fresh, 1, 20, 20);
    expect(smog.value).toBeCloseTo(value * Math.exp(-1), 12);
    expect(smog.tint).toBeCloseTo(tint * Math.exp(-1), 12);
    smog.adopt(old);
    expect(smog.value).toBe(0);
    expect(smog.tint).toBe(0);
  });
});

describe('FEEL-16 post-process contract without WebGL', () => {
  it('adds one smog uniform and leaves the zero-smog shader path neutral', () => {
    const post = new PostFX({} as THREE.WebGLRenderer, QUALITY_PRESETS.high);
    try {
      const materials = post as unknown as { compositeMat: THREE.ShaderMaterial; prefilterMat: THREE.ShaderMaterial };
      const shader = materials.compositeMat.fragmentShader;
      expect(post.fog.uSmog.value).toBe(0);
      expect(materials.compositeMat.uniforms.uSmog).toBe(post.fog.uSmog);
      expect(shader.match(/uniform float uSmog;/g)).toHaveLength(1);
      expect(materials.prefilterMat.fragmentShader).not.toContain('uniform float uSmog;');
      expect(shader).toContain('if (uSmog > 0.0)');
      expect(shader).not.toContain('smoothstep(0.25, 0.6, uSmog)');
      expect(shader).toContain('vec3(0.55, 0.50, 0.42)');
    } finally { post.dispose(); }
  });
});
