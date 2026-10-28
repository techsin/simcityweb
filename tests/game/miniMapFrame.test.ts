/** T030: camera cadence, bounded base painting and unchanged settled map colours. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Network, Overlay } from '../../src/core/types';
import type { GameContext } from '../../src/game/context';
import type { CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { MiniMap } from '../../src/ui/MiniMap';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom } from './fakeDom';

installFakeDom();
afterEach(() => vi.restoreAllMocks());

function fixture(size = 16) {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const painted: Uint8ClampedArray[] = [], draws: number[] = [];
  const g = {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (img: ImageData) => painted.push(img.data.slice()),
    drawImage: () => draws.push(now), clearRect() {}, save() {}, restore() {}, beginPath() {},
    moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {}, arc() {},
  };
  class Canvas extends FEl {
    width = 300;
    height = 150;
    getContext() { return g; }
    getBoundingClientRect() { throw new Error('layout read in a frame'); }
    override setAttribute(k: string, v: string): void {
      super.setAttribute(k, v);
      if (k === 'width') this.width = +v;
      if (k === 'height') this.height = +v;
    }
  }
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'canvas' ? new Canvas(tag) : new FEl(tag)) as typeof document.createElement);
  const sim = new Simulation(newState(size), []), abort = new AbortController();
  const camera = new THREE.PerspectiveCamera(45, 1.5, 1, 10000);
  const target = new THREE.Vector3(128, 0, 128);
  camera.position.set(128, 800, 900);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  const world = { camera, controls: { target } };
  const ctx = {
    get state() { return sim.state; }, sim, signal: abort.signal, overlay: Overlay.None,
    world, sound() {},
  } as unknown as GameContext;
  const map = new MiniMap(ctx, new FEl('div') as unknown as HTMLElement);
  const frame = (dt: number) => { now += dt * 1000; return map.frame(dt); };
  return { map, sim, ctx, abort, camera, world, painted, draws, frame };
}

/** The complete painter at 93069fa, kept here as the colour oracle for sliced and invalidated sweeps. */
function reference(st: CityState, ov: Overlay): Uint8ClampedArray {
  const ZC = [[0, 0, 0], [120, 205, 130], [80, 185, 105], [50, 160, 85], [120, 165, 240], [80, 140, 240], [55, 110, 215], [200, 205, 110], [230, 180, 60], [215, 145, 40], [150, 120, 90]];
  const BC = [[205, 195, 235], [210, 245, 215], [180, 235, 195], [150, 225, 175], [200, 220, 255], [175, 205, 255], [150, 185, 255], [235, 235, 170], [255, 220, 140], [250, 200, 120], [180, 150, 120]];
  const N = st.size, out = new Uint8ClampedArray(N * N * 4);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x, hgt = st.cellHeight(x, z);
    let r: number, g: number, b: number;
    if (st.water[i]) {
      const dd = Math.min(1, -hgt / 25);
      r = 38 - dd * 18; g = 92 - dd * 30; b = 128 - dd * 25;
    } else {
      const t = Math.min(1, hgt / 140);
      r = 92 + t * 60; g = 128 + t * 20; b = 72 + t * 40;
      if (hgt < 1.6) { r = 196; g = 186; b = 140; }
      if (hgt > 170) { const s = Math.min(1, (hgt - 170) / 40); r += (235 - r) * s; g += (238 - g) * s; b += (240 - b) * s; }
      const tr = st.trees[i];
      if (tr) { const k = 1 - tr * 0.07; r *= k * 0.92; g *= k; b *= k * 0.9; }
      const sh = x + 1 < N ? (st.cellHeight(x + 1, z) - hgt) * -0.9 : 0;
      r += sh; g += sh; b += sh;
    }
    const n = st.network[i], zn = st.zone[i], bid = st.building[i];
    if (n) {
      if (n === Network.Rail) { r = 130; g = 100; b = 80; }
      else if (n === Network.Highway) { r = 70; g = 72; b = 78; }
      else { r = 105; g = 108; b = 116; }
    } else if (bid >= 0) [r, g, b] = BC[zn];
    else if (zn) { r = r * 0.35 + ZC[zn][0] * 0.65; g = g * 0.35 + ZC[zn][1] * 0.65; b = b * 0.35 + ZC[zn][2] * 0.65; }
    if (ov === Overlay.Power && !st.water[i] && (bid >= 0 || zn)) {
      const p = st.powered[i];
      r = p ? 250 : 80; g = p ? 215 : 70; b = p ? 80 : 70;
    }
    out.set([r, g, b, 255], i * 4);
  }
  return out;
}

describe('MiniMap frame cadence', () => {
  it('draws at most 10 Hz in motion, flushes the final camera pose on the first resting frame, then stays idle', () => {
    const f = fixture();
    f.frame(0); f.frame(0.02);
    f.draws.length = 0;
    for (let i = 0; i < 50; i++) {
      f.camera.position.x += 1;
      f.camera.updateMatrixWorld();
      expect(f.frame(0.02)).toBe(false);
    }
    expect(f.draws.length).toBeGreaterThan(0);
    expect(f.draws.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < f.draws.length; i++) expect(f.draws[i] - f.draws[i - 1]).toBeGreaterThanOrEqual(100);
    const movingDraws = f.draws.length;
    expect(f.frame(0.001)).toBe(true);
    expect(f.draws).toHaveLength(movingDraws + 1);
    for (let i = 0; i < 100; i++) expect(f.frame(0.02)).toBe(false);
    expect(f.draws).toHaveLength(movingDraws + 1);
    // Projection-only zoom changes and camera replacement also settle, without DOM measurements.
    f.camera.zoom = 1.5; f.camera.updateProjectionMatrix();
    f.frame(0.01);
    expect(f.frame(0.001)).toBe(true);
    f.world.camera = f.camera.clone();
    f.frame(0.01);
    expect(f.frame(0.001)).toBe(true);
    f.abort.abort('dispose'); f.map.dispose();
  });

  it('still reports camera stops with a collapsed map and refreshes it when reopened', () => {
    const f = fixture();
    f.frame(0); f.frame(0.01);
    const collapse = (f.map.el as unknown as FEl).querySelectorAll('button').find((b) => b.title === 'Collapse map')!;
    collapse.click();
    const n = f.draws.length;
    f.camera.position.x += 10; f.camera.updateMatrixWorld(); f.frame(0.01);
    expect(f.frame(0.01)).toBe(true);
    expect(f.draws).toHaveLength(n);
    collapse.click(); f.frame(0);
    expect(f.draws).toHaveLength(n + 1);
    f.abort.abort('dispose'); f.map.dispose();
  });
});

describe('MiniMap sliced base painter', () => {
  it.each([Overlay.None, Overlay.Power])('publishes only complete maps with exactly the original pixels (overlay %s)', (overlay) => {
    const f = fixture(128), st = f.sim.state;
    f.ctx.overlay = overlay;
    for (let i = 0; i < st.heights.length; i++) st.heights[i] = (i * 17 % 260) - 30;
    for (let i = 0; i < st.water.length; i++) {
      st.water[i] = i % 7 === 0 ? 1 : 0;
      st.trees[i] = i % 5;
      st.zone[i] = i % 11;
      st.network[i] = [Network.None, Network.Road, Network.Rail, Network.Highway][i % 4];
      st.building[i] = i % 3 ? -1 : 1;
      st.powered[i] = i % 2;
    }
    const expected = reference(st, overlay);
    for (let i = 0; i < 3; i++) {
      f.frame(0.02);
      expect(f.painted).toHaveLength(0);
      expect(f.draws).toHaveLength(0);
    }
    f.frame(0.02);
    expect(f.painted).toHaveLength(1);
    expect(f.painted[0]).toEqual(expected);
    f.abort.abort('dispose'); f.map.dispose();
  });

  it('yields at the time budget even before the cell limit', () => {
    const f = fixture(128);
    let t = 0;
    vi.mocked(performance.now).mockImplementation(() => t++);
    f.frame(0);
    expect(f.painted).toHaveLength(0);
    // With 1 ms per clock read, only two rows fit each slice; 64 slices complete the 128 rows.
    for (let i = 1; i < 63; i++) f.frame(0);
    expect(f.painted).toHaveLength(0);
    f.frame(0);
    expect(f.painted).toHaveLength(1);
    f.abort.abort('dispose'); f.map.dispose();
  });

  it('retains invalidations during a sweep and converges on the latest utilities and edits', () => {
    const f = fixture(128), st = f.sim.state;
    for (let i = 0; i < 4; i++) f.frame(0.02);
    expect(f.painted).toHaveLength(1);
    f.map.markDirty(); f.frame(1);
    st.zone.fill(1); st.powered.fill(1);
    f.sim.events.emit('layerUpdated', 'utilities');
    for (let i = 0; i < 3; i++) f.frame(0.02);
    expect(f.painted).toHaveLength(2);
    f.frame(1);
    for (let i = 0; i < 3; i++) f.frame(0.02);
    expect(f.painted).toHaveLength(3);
    expect(f.painted.at(-1)).toEqual(reference(st, Overlay.None));
    f.abort.abort('dispose'); f.map.dispose();
  });

  it('restarts an in-flight sweep on an overlay change or reset, including a different map size', () => {
    const f = fixture(128);
    f.sim.state.zone.fill(1); f.sim.state.powered.fill(1);
    f.frame(0.02);
    f.ctx.overlay = Overlay.Power; f.map.markDirty();
    f.frame(0.02);
    const st = newState(64);
    st.zone.fill(1); st.powered.fill(1);
    f.sim.replaceState(st);
    f.frame(0.02);
    expect(f.painted).toHaveLength(1);
    expect(f.painted[0]).toEqual(reference(st, Overlay.Power));
    f.abort.abort('dispose'); f.map.dispose();
  });

  it.each(['abort', 'dispose'] as const)('does no further painting after %s', (exit) => {
    const f = fixture(128);
    f.frame(0.02);
    if (exit === 'abort') f.abort.abort('dispose');
    else f.map.dispose();
    for (let i = 0; i < 10; i++) f.frame(1);
    expect(f.painted).toHaveLength(0);
    f.abort.abort('dispose'); f.map.dispose();
  });
});
