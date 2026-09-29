/**
 * Equivalence of the Rust blur kernels (wasm/sim-kernels/src/blur.rs via src/wasm/kernels/blurBind.ts) with the live
 * JS original (src/sim/infra/blur.ts): every output must be BIT-identical (compared as uint32 patterns; any NaN equals
 * any NaN) on random fields of many shapes / magnitudes, on edge-case parameters and on real layers of a grown city,
 * in copy mode (plain arrays) and zero-copy mode (arrays in wasm memory). Also: heap growth / fallback behaviour.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as js from '../../src/sim/infra/blur';
import { POLL_RADII, TREE_COVER_RADIUS } from '../../src/sim/infra/params';
import { BLUR_KERNEL, makeBlurKernels } from '../../src/wasm/kernels/blurBind';
import {
  applySimWasmFlag, initSimWasmSync, parseSimWasmFlag, resetSimWasm, setSimWasmPreference, simWasmInstance, simWasmStatus, simWasmWanted,
} from '../../src/wasm/simWasm';
import { WasmHeapFullError } from '../../src/wasm/heap';
import { adoptLayers } from '../../src/wasm/layers';
import { newSim, stressCity } from '../infra/cityGen';

const wb = makeBlurKernels(js);

// ------------------------------------------------------------------------------------------------ helpers
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

type Kind = 'noise' | 'sparse' | 'wide' | 'ints' | 'const';
const KINDS: Kind[] = ['noise', 'sparse', 'wide', 'ints', 'const'];

function field(n: number, kind: Kind, seed: number): Float32Array {
  const a = new Float32Array(n);
  const r = rng(seed * 7919 + kind.length);
  for (let i = 0; i < n; i++) {
    const u = r();
    switch (kind) {
      case 'noise': a[i] = u * 3 - 1; break;
      case 'sparse': a[i] = u < 0.03 ? r() * 1e4 : u < 0.05 ? -r() * 50 : 0; break;
      // magnitudes 1e-40 (subnormal) .. 1e30, both signs, some exact zeros and -0
      case 'wide': a[i] = u < 0.1 ? (u < 0.05 ? 0 : -0) : (r() < 0.5 ? -1 : 1) * Math.exp((r() * 2 - 1) * 70); break;
      case 'ints': a[i] = Math.floor(u * 5) * 0.25; break;
      case 'const': a[i] = 0.7; break;
    }
  }
  return a;
}

/** first index where the bit patterns differ (NaN == NaN), or -1 */
function firstDiff(a: Float32Array, b: Float32Array, len = Math.max(a.length, b.length)): number {
  if (a.length < len || b.length < len) return Math.min(a.length, b.length);
  const ua = new Uint32Array(a.buffer, a.byteOffset, len), ub = new Uint32Array(b.buffer, b.byteOffset, len);
  for (let i = 0; i < len; i++) {
    if (ua[i] !== ub[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return i;
  }
  return -1;
}

function expectSame(got: Float32Array, want: Float32Array, label: string, len?: number): void {
  const d = firstDiff(got, want, len);
  if (d >= 0) expect.fail(`${label}: first difference at ${d}: wasm ${got[d]} vs js ${want[d]}`);
}

beforeAll(() => {
  setSimWasmPreference('auto');
  expect(initSimWasmSync()).toBe(true);
});
afterEach(() => {
  setSimWasmPreference('auto');
  setSimWasmPreference('auto', 'blur');
});

// ------------------------------------------------------------------------------------------------ loader
describe('loader (node)', () => {
  it('auto-initialises the committed SIMD binary from disk', () => {
    const st = simWasmStatus();
    expect(st.state).toBe('ready');
    expect(st.source).toMatch(/src[\\/]wasm[\\/]sim_kernels\.wasm$/);
    expect(st.features?.simd128).toBe(true);
    expect(st.kernels.blur?.active).toBe(true);
    expect(st.kernels.blur?.missing).toEqual([]);
    expect(BLUR_KERNEL.instance()).not.toBeNull();
  });

  it('parses the A/B flag syntax', () => {
    expect(parseSimWasmFlag('js')).toEqual({ global: 'js', kernels: {} });
    expect(parseSimWasmFlag('1')).toEqual({ global: 'wasm', kernels: {} });
    expect(parseSimWasmFlag('auto,blur:js, traffic:wasm')).toEqual({ global: 'auto', kernels: { blur: 'js', traffic: 'wasm' } });
    expect(parseSimWasmFlag('nonsense')).toEqual({ global: null, kernels: {} });
  });

  it('preference js routes every call to the JS original; per-kernel overrides win', () => {
    setSimWasmPreference('js');
    expect(BLUR_KERNEL.instance()).toBeNull();
    setSimWasmPreference('wasm', 'blur');
    expect(BLUR_KERNEL.instance()).not.toBeNull();
    applySimWasmFlag('auto,blur:js');
    expect(BLUR_KERNEL.instance()).toBeNull();
    // worth initialising (browser) whenever some kernel may use wasm
    applySimWasmFlag('js,blur:wasm');
    expect(simWasmWanted()).toBe(true);
    setSimWasmPreference('auto', 'blur');
    expect(simWasmWanted()).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ box passes
describe('box passes (copy mode) are bit-identical', () => {
  const SIZES = [1, 2, 3, 4, 5, 7, 8, 16, 31, 64, 100, 256];
  const RADII = [0, 1, 2, 3, 4, 7, 12, 40, 300];
  it('boxH / boxV / blur3 / boxAverage on random fields', { timeout: 180000 }, () => {
    let runs = 0;
    for (const N of SIZES) {
      for (const r of RADII) {
        for (const kind of KINDS) {
          if (N === 256 && kind !== 'noise' && kind !== 'wide' && r > 7) continue; // keep the suite fast
          const src = field(N * N, kind, N * 31 + r);
          const a1 = new Float32Array(N * N), a2 = new Float32Array(N * N);
          js.boxH(src, a1, N, r); wb.boxH(src, a2, N, r);
          expectSame(a2, a1, `boxH N=${N} r=${r} ${kind}`);
          js.boxV(src, a1, N, r); wb.boxV(src, a2, N, r);
          expectSame(a2, a1, `boxV N=${N} r=${r} ${kind}`);
          const b1 = src.slice(), b2 = src.slice();
          js.blur3(b1, new Float32Array(N * N), N, r); wb.blur3(b2, new Float32Array(N * N), N, r);
          expectSame(b2, b1, `blur3 N=${N} r=${r} ${kind}`);
          js.boxAverage(src, a1, new Float32Array(N * N), N, r); wb.boxAverage(src, a2, new Float32Array(N * N), N, r);
          expectSame(a2, a1, `boxAverage N=${N} r=${r} ${kind}`);
          runs++;
        }
      }
    }
    expect(runs).toBeGreaterThan(400);
  });

  it('arrays longer than N*N: only the first N*N elements are read / written', () => {
    const N = 37, r = 3;
    const src = field(N * N + 50, 'noise', 5);
    const d1 = field(N * N + 50, 'noise', 6), d2 = d1.slice();
    js.boxAverage(src, d1, new Float32Array(N * N + 9), N, r);
    wb.boxAverage(src, d2, new Float32Array(N * N + 9), N, r);
    expectSame(d2, d1, 'boxAverage long arrays');
  });

  it('in-place boxAverage (src === dst) matches', () => {
    const N = 64, r = 2;
    const a1 = field(N * N, 'noise', 9), a2 = a1.slice();
    js.boxAverage(a1, a1, new Float32Array(N * N), N, r);
    wb.boxAverage(a2, a2, new Float32Array(N * N), N, r);
    expectSame(a2, a1, 'boxAverage src === dst');
  });
});

// ------------------------------------------------------------------------------------------------ resampling
describe('blurDown / upsampleAdd / blurDownAdd are bit-identical', () => {
  const SIZES = [1, 5, 16, 63, 64, 100, 256];
  const FACTORS = [1, 2, 3, 4, 5, 8];
  const SHIFTS: [number, number][] = [
    [0, 0], [-0, 0], [0.3, -1.7], [2.5, 7.25], [1e-9, -1e-9], [-3.5, 0], [0, 12.6], [1e6, 0], [-0.75, -4.2], [NaN, 0], [0, Infinity],
  ];
  it('blurDown on random fields', { timeout: 180000 }, () => {
    for (const N of SIZES) {
      for (const f of FACTORS) {
        for (const r of [0, 1, 2, 3]) {
          const M = Math.ceil(N / f);
          const src = field(N * N, r % 2 ? 'sparse' : 'noise', N + f * 13 + r);
          const c1 = field(M * M + 3, 'noise', 1), c2 = c1.slice();
          const m1 = js.blurDown(src, N, f, r, c1, new Float32Array(M * M + 3), );
          const m2 = wb.blurDown(src, N, f, r, c2, new Float32Array(M * M + 3));
          expect(m2).toBe(m1);
          expectSame(c2, c1, `blurDown N=${N} f=${f} r=${r}`);
        }
      }
    }
  });

  it('upsampleAdd with shifts, gains and edge weights', { timeout: 180000 }, () => {
    for (const N of SIZES) {
      for (const f of FACTORS) {
        const M = Math.ceil(N / f);
        const coarse = field(M * M, 'noise', N * 3 + f);
        for (const [dx, dz] of SHIFTS) {
          for (const gain of [1, 3.7, -0.25]) {
            const a1 = field(N * N, 'noise', 77), a2 = a1.slice();
            js.upsampleAdd(coarse, a1, N, f, gain, dx, dz);
            wb.upsampleAdd(coarse, a2, N, f, gain, dx, dz);
            expectSame(a2, a1, `upsampleAdd N=${N} f=${f} d=(${dx},${dz}) g=${gain}`);
          }
        }
      }
    }
  });

  it('blurDownAdd (the pollution call shapes, and acc === src)', { timeout: 180000 }, () => {
    for (const N of [64, 100, 256]) {
      for (const [f, r] of [[2, 1], [4, 2], [2, 2], [4, 1], [8, 1]] as const) {
        const M = Math.ceil(N / f);
        const src = field(N * N, 'sparse', N + f + r);
        for (const [dx, dz] of SHIFTS.slice(0, 6)) {
          const a1 = field(N * N, 'noise', 3), a2 = a1.slice();
          const k1 = new Float32Array(M * M), k2 = new Float32Array(M * M);
          js.blurDownAdd(src, a1, N, f, r, 12.5, k1, new Float32Array(M * M), dx, dz);
          wb.blurDownAdd(src, a2, N, f, r, 12.5, k2, new Float32Array(M * M), dx, dz);
          expectSame(a2, a1, `blurDownAdd acc N=${N} f=${f} r=${r} d=(${dx},${dz})`);
          expectSame(k2, k1, `blurDownAdd coarse N=${N} f=${f} r=${r}`);
        }
        const s1 = src.slice(), s2 = src.slice();
        js.blurDownAdd(s1, s1, N, f, r, 2, new Float32Array(M * M), new Float32Array(M * M));
        wb.blurDownAdd(s2, s2, N, f, r, 2, new Float32Array(M * M), new Float32Array(M * M));
        expectSame(s2, s1, `blurDownAdd acc === src N=${N} f=${f}`);
      }
    }
  });
});

// ------------------------------------------------------------------------------------------------ shifts
describe('shiftField / shiftPlume are bit-identical', () => {
  it('fractional, negative, huge and non-finite shifts', { timeout: 180000 }, () => {
    const shifts: [number, number][] = [
      [0, 0], [-0, -0], [0.25, 0.5], [-1.3, 2.7], [3, -4], [300, 0], [0, -1e12], [NaN, 1], [1, NaN], [Infinity, 0], [0.999999, -0.000001],
    ];
    for (const N of [1, 2, 7, 64, 256]) {
      const src = field(N * N, 'noise', N);
      for (const [dx, dz] of shifts) {
        const d1 = new Float32Array(N * N), d2 = new Float32Array(N * N);
        js.shiftField(src, d1, N, dx, dz); wb.shiftField(src, d2, N, dx, dz);
        expectSame(d2, d1, `shiftField N=${N} d=(${dx},${dz})`);
        js.shiftPlume(src, d1, N, dx, dz); wb.shiftPlume(src, d2, N, dx, dz);
        expectSame(d2, d1, `shiftPlume N=${N} d=(${dx},${dz})`);
      }
    }
  });
});

// ------------------------------------------------------------------------------------------------ real layers
describe('real layers of a grown 256² city', () => {
  it('pollution / crime / tree-cover call shapes on live layers', { timeout: 120000 }, () => {
    const city = stressCity(256);
    const sim = newSim(city.st);
    for (let d = 0; d < 45; d++) sim.advanceDay();
    const st = city.st, N = st.size;
    const layers: [string, Float32Array][] = [
      ['airPollution', st.airPollution], ['crime', st.crime], ['noise', st.noise], ['landValue', st.landValue], ['traffic', st.traffic],
      ['treesQuarter', Float32Array.from(st.trees, (t) => t * 0.25)],
    ];
    let checked = 0;
    for (const [name, L] of layers) {
      // crime: blur3 r=1; tree cover / park buffer: boxAverage r=TREE_COVER_RADIUS; pollution: blurDown(Add) f=2/4
      const b1 = L.slice(), b2 = L.slice();
      js.blur3(b1, new Float32Array(N * N), N, 1); wb.blur3(b2, new Float32Array(N * N), N, 1);
      expectSame(b2, b1, `${name} blur3`);
      const o1 = new Float32Array(N * N), o2 = new Float32Array(N * N);
      js.boxAverage(L, o1, new Float32Array(N * N), N, TREE_COVER_RADIUS); wb.boxAverage(L, o2, new Float32Array(N * N), N, TREE_COVER_RADIUS);
      expectSame(o2, o1, `${name} boxAverage`);
      for (const [f, rr] of [[2, 1], [2, Math.max(1, Math.round(POLL_RADII[1] / 2))], [4, Math.max(1, Math.round(POLL_RADII[2] / 4))], [4, 2]]) {
        const M = Math.ceil(N / f);
        const c1 = new Float32Array(M * M), c2 = new Float32Array(M * M);
        js.blurDown(L, N, f, rr, c1, new Float32Array(M * M)); wb.blurDown(L, N, f, rr, c2, new Float32Array(M * M));
        expectSame(c2, c1, `${name} blurDown f=${f} r=${rr}`);
        const a1 = st.noise.slice(), a2 = st.noise.slice();
        js.upsampleAdd(c1, a1, N, f, 0.5, -1.25, 2.5); wb.upsampleAdd(c1, a2, N, f, 0.5, -1.25, 2.5);
        expectSame(a2, a1, `${name} upsampleAdd f=${f}`);
        checked++;
      }
    }
    expect(checked).toBe(24);
    // the layers carry real signal (not all zeros)
    expect(st.crime.some((v) => v > 0)).toBe(true);
    expect(st.airPollution.some((v) => v > 0)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ zero copy
describe('zero-copy: arrays living in wasm memory', () => {
  it('kernels run in place on heap arrays and match JS (including scratch contents)', { timeout: 180000 }, () => {
    const w = simWasmInstance()!;
    const N = 256, r = 2, nn = N * N;
    const holder = { a: field(nn, 'noise', 1), tmp: new Float32Array(nn), src: field(nn, 'sparse', 2), acc: field(nn, 'noise', 3), coarse: new Float32Array(128 * 128), coarseTmp: new Float32Array(128 * 128) };
    const ref = { a: holder.a.slice(), tmp: new Float32Array(nn), acc: holder.acc.slice(), coarse: new Float32Array(128 * 128), coarseTmp: new Float32Array(128 * 128) };
    const adopted = adoptLayers(holder, w.heap);
    try {
      expect(adopted.arrays).toBe(6);
      expect(w.heap.ptrOf(holder.a)).toBeGreaterThan(0);
      const before = w.heap.stats();
      wb.blur3(holder.a, holder.tmp, N, r);
      js.blur3(ref.a, ref.tmp, N, r);
      expectSame(holder.a, ref.a, 'zero-copy blur3');
      expectSame(holder.tmp, ref.tmp, 'zero-copy blur3 scratch');
      wb.blurDownAdd(holder.src, holder.acc, N, 2, 1, 3, holder.coarse, holder.coarseTmp, 0.5, -2);
      js.blurDownAdd(holder.src, ref.acc, N, 2, 1, 3, ref.coarse, ref.coarseTmp, 0.5, -2);
      expectSame(holder.acc, ref.acc, 'zero-copy blurDownAdd');
      expectSame(holder.coarse, ref.coarse, 'zero-copy blurDownAdd coarse');
      expectSame(holder.coarseTmp, ref.coarseTmp, 'zero-copy blurDownAdd coarseTmp');
      // in place: no staging block grew for these calls
      expect(w.heap.stats().grows).toBe(before.grows);
    } finally {
      adopted.release();
    }
    expect(w.heap.ptrOf(holder.a)).toBe(-1);
  });

  it('growth detaches views; refresh() / onGrow rebind them with their contents', () => {
    const w = simWasmInstance()!;
    const h = w.heap;
    const holder = { layer: field(4096, 'noise', 11) };
    const want = holder.layer.slice();
    const adopted = adoptLayers(holder, h);
    try {
      const stale = holder.layer;
      const g0 = h.generation;
      h.reserve(h.capacity); // at least doubles the memory -> memory.grow
      expect(h.generation).toBe(g0 + 1);
      expect(stale.length).toBe(0); // detached
      expect(holder.layer === stale).toBe(false); // the onGrow listener rebound the field
      expectSame(holder.layer, want, 'rebound layer');
    } finally {
      adopted.release();
    }
  });

  it('with pinned views, scratch growth is refused and the binding falls back to JS (correct result)', { timeout: 180000 }, () => {
    const w = simWasmInstance()!;
    const h = w.heap;
    const pin = h.allocArray(Float32Array, 16);
    try {
      // a grid bigger than all of memory: staging would need memory.grow -> WasmHeapFullError -> JS
      const N = Math.ceil(Math.sqrt(h.capacity / 4)) + 8;
      expect(() => h.alloc(N * N * 4)).toThrow(WasmHeapFullError);
      const g0 = h.generation;
      const src = field(N * N, 'noise', 4);
      const d1 = new Float32Array(N * N), d2 = new Float32Array(N * N);
      js.boxH(src, d1, N, 1);
      wb.boxH(src, d2, N, 1);
      expectSame(d2, d1, 'boxH via JS fallback');
      expect(h.generation).toBe(g0);
      expect(simWasmStatus().state).toBe('ready'); // a full heap does not disable wasm
    } finally {
      h.free(pin);
    }
  });
});

// ------------------------------------------------------------------------------------------------ failure modes
describe('failure modes', () => {
  it('without WebAssembly the kernels run on JS (state unavailable)', () => {
    const g = globalThis as { WebAssembly?: typeof WebAssembly };
    const saved = g.WebAssembly;
    resetSimWasm();
    try {
      delete g.WebAssembly;
      expect(typeof WebAssembly).toBe('undefined');
      expect(BLUR_KERNEL.instance()).toBeNull();
      expect(simWasmStatus().state).toBe('unavailable');
      const N = 32, src = field(N * N, 'noise', 3), d1 = new Float32Array(N * N), d2 = new Float32Array(N * N);
      js.boxH(src, d1, N, 3);
      wb.boxH(src, d2, N, 3);
      expectSame(d2, d1, 'boxH without WebAssembly');
    } finally {
      g.WebAssembly = saved;
      resetSimWasm();
      expect(initSimWasmSync()).toBe(true);
    }
  });

  it('a broken binary leaves the kernels on JS (auto) and throws when forced to wasm', () => {
    resetSimWasm();
    try {
      expect(initSimWasmSync(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1]))).toBe(false);
      expect(simWasmStatus().state).toBe('failed');
      expect(BLUR_KERNEL.instance()).toBeNull();
      const N = 16, src = field(N * N, 'noise', 1), d1 = new Float32Array(N * N), d2 = new Float32Array(N * N);
      js.boxV(src, d1, N, 2);
      wb.boxV(src, d2, N, 2);
      expectSame(d2, d1, 'boxV on the JS path');
      setSimWasmPreference('wasm');
      expect(() => wb.boxV(src, d2, N, 2)).toThrow(/forced to wasm/);
    } finally {
      setSimWasmPreference('auto');
      resetSimWasm();
      expect(initSimWasmSync()).toBe(true);
    }
  });
});
