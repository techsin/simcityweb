import { describe, expect, it } from 'vitest';
import { RNG } from '../../../src/core/rng';
import * as blur from '../../../src/sim/infra/blur';
import * as original from './blurOriginal';
import { newState } from '../../infra/cityGen';

const SPECIAL = [
  0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x807fffff, 0x00800000, 0x80800000,
  0x3f800000, 0xbf800000, 0x7f7fffff, 0xff7fffff, 0x7f800000, 0xff800000,
  0x7fc00000, 0xffc00000, 0x7fc12345, 0xffc54321, 0x7f800001, 0xff800001,
];
type Kind = 'zero' | 'full' | 'sparse' | 'wide' | 'bits' | 'special' | 'cancel';
const KINDS: Kind[] = ['zero', 'full', 'sparse', 'wide', 'bits', 'special', 'cancel'];

function field(n: number, rng: RNG, kind: Kind): Float32Array {
  const a = new Float32Array(n), bits = new Uint32Array(a.buffer);
  for (let i = 0; i < n; i++) {
    switch (kind) {
      case 'zero': break;
      case 'full': a[i] = 0.7; break;
      case 'sparse': a[i] = rng.chance(0.05) ? rng.range(-50, 1e4) : 0; break;
      case 'wide': a[i] = rng.range(-1, 1) * 2 ** rng.int(-149, 127); break;
      case 'bits': bits[i] = rng.int(0, 0xffffffff); break;
      case 'special': bits[i] = rng.pick(SPECIAL); break;
      case 'cancel': a[i] = [2 ** 80, 1, -(2 ** 80), -1, 2 ** -149, -(2 ** -149)][i % 6]; break;
    }
  }
  return a;
}

// Nonzero offsets and guard cells also catch writes beyond a view or beyond N*N.
function views(lengths: number[], rng: RNG, kind: Kind, layout = 0, N = 1): Float32Array[] {
  if (layout === 0) return lengths.map((n) => field(n + 4, rng, kind).subarray(2, n + 2));
  const stride = Math.max(...lengths) + 3;
  const offsets = lengths.map((_, i) => 2 + i * stride);
  if (layout === 2) offsets.fill(2);
  if (layout === 3 || layout === 4 || layout === 8) {
    for (let i = 0; i < offsets.length; i++) offsets[i] = 2 + (layout === 4 ? offsets.length - 1 - i : i) * (layout === 8 ? N : 1);
  }
  if (layout === 5) offsets[1] = offsets[0];
  if (layout === 6) offsets[2] = offsets[0];
  if (layout === 7) offsets[2] = offsets[1];
  const backing = field(Math.max(...lengths.map((n, i) => offsets[i] + n)) + 2, rng, kind);
  return lengths.map((n, i) => backing.subarray(offsets[i], offsets[i] + n));
}

function copyViews(arrays: Float32Array[]): Float32Array[] {
  const copies = new Map<ArrayBufferLike, ArrayBufferLike>();
  return arrays.map((a) => {
    let copy = copies.get(a.buffer);
    if (!copy) { copy = a.buffer.slice(0); copies.set(a.buffer, copy); }
    return new Float32Array(copy, a.byteOffset, a.length);
  });
}

/**
 * byte-for-byte, except that any two NaNs are equal: V8 does not keep NaN payload bits stable across its tiers (the
 * interpreter and optimized code store different payloads into a Float32Array), so the original compared with a frozen
 * copy of ITSELF differs in NaN bytes under load. Every non-NaN value, -0 and the infinities stay bit-exact.
 */
function sameBytes(got: Uint8Array, want: Uint8Array, label: string, width: 4 | 8 = 4): void {
  if (got.length !== want.length) expect.fail(`${label}: byte lengths differ`);
  const g = new DataView(got.buffer, got.byteOffset, got.byteLength), w = new DataView(want.buffer, want.byteOffset, want.byteLength);
  const at = (v: DataView, i: number) => (width === 4 ? v.getFloat32(i, true) : v.getFloat64(i, true));
  for (let i = 0; i < got.length; i += width) {
    let same = true;
    for (let k = i; k < i + width && k < got.length; k++) if (got[k] !== want[k]) { same = false; break; }
    if (same || (i + width <= got.length && Number.isNaN(at(g, i)) && Number.isNaN(at(w, i)))) continue;
    expect.fail(`${label}: bytes ${i}..${i + width - 1}: ${[...got.subarray(i, i + width)].map((b) => b.toString(16)).join(' ')} != ${[...want.subarray(i, i + width)].map((b) => b.toString(16)).join(' ')}`);
  }
}

type Call = (arrays: Float32Array[]) => number | void;
function compare(arrays: Float32Array[], oldCall: Call, newCall: Call, label: string): void {
  const want = copyViews(arrays), got = copyViews(arrays);
  const oldResult = oldCall(want), newResult = newCall(got);
  if (typeof oldResult === 'number' && typeof newResult === 'number') {
    sameBytes(new Uint8Array(Float64Array.of(newResult).buffer), new Uint8Array(Float64Array.of(oldResult).buffer), `${label} return`, 8);
  } else if (!Object.is(newResult, oldResult)) expect.fail(`${label}: return values differ`);
  const checked = new Set<ArrayBufferLike>();
  for (let i = 0; i < want.length; i++) {
    if (checked.has(want[i].buffer)) continue;
    checked.add(want[i].buffer);
    sameBytes(new Uint8Array(got[i].buffer), new Uint8Array(want[i].buffer), `${label} buffer ${i}`);
  }
}

function stencils(arrays: Float32Array[], N: number, r: number, label: string): void {
  compare(arrays, ([s, d]) => original.boxHOriginal(s, d, N, r), ([s, d]) => blur.boxH(s, d, N, r), `${label} boxH`);
  compare(arrays, ([s, d]) => original.boxVOriginal(s, d, N, r), ([s, d]) => blur.boxV(s, d, N, r), `${label} boxV`);
  compare(arrays, ([s, , t]) => original.blur3Original(s, t, N, r), ([s, , t]) => blur.blur3(s, t, N, r), `${label} blur3`);
  compare(arrays, ([s, d, t]) => original.boxAverageOriginal(s, d, t, N, r), ([s, d, t]) => blur.boxAverage(s, d, t, N, r), `${label} boxAverage`);
}

function resample(arrays: Float32Array[], N: number, f: number, r: number, gain: number, dx: number, dz: number, label: string): void {
  compare(arrays, ([s, , c, t]) => original.blurDownOriginal(s, N, f, r, c, t),
    ([s, , c, t]) => blur.blurDown(s, N, f, r, c, t), `${label} blurDown`);
  compare(arrays, ([, a, c]) => original.upsampleAddOriginal(c, a, N, f, gain, dx, dz),
    ([, a, c]) => blur.upsampleAdd(c, a, N, f, gain, dx, dz), `${label} upsampleAdd`);
  compare(arrays, ([s, a, c, t]) => original.blurDownAddOriginal(s, a, N, f, r, gain, c, t, dx, dz),
    ([s, a, c, t]) => blur.blurDownAdd(s, a, N, f, r, gain, c, t, dx, dz), `${label} blurDownAdd`);
}

describe('J8 blur is byte-identical to 614609f', () => {
  for (const seed of [614609, 0x12345678, 0xdeadbeef, 0x7fffffff]) {
    it(`2,500 seeded stencil cases (seed ${seed})`, { timeout: 20000 }, () => {
      const rng = new RNG(seed);
      for (let i = 0; i < 2500; i++) {
        const N = rng.int(0, 20), nn = N * N;
        const r = rng.pick([0, 1, 2, Math.floor(N / 2), N - 1, N, N + 1, rng.int(0, 2 * N + 3)]);
        const lengths = [0, 1, 2].map(() => i % 11 === 0 ? rng.pick([0, Math.max(0, nn - 1), nn + 5]) : nn);
        const kind = rng.pick(KINDS), layout = i % 9;
        stencils(views(lengths, rng, kind, layout, N), N, r, `seed=${seed} case=${i} N=${N} r=${r} ${kind} layout=${layout}`);
      }
    });
  }

  it('1,000 seeded downsample / upsample cases, including aliased scratch', { timeout: 20000 }, () => {
    const rng = new RNG('J8 resampling');
    const shifts = [0, -0, 0.35, -0.8, 1e-9, -1e-9, 1.5, -3, 100, -100, NaN, Infinity, -Infinity];
    for (let i = 0; i < 1000; i++) {
      const N = rng.int(0, 20), f = rng.pick([1, 2, 3, 4, 5, 8, 1.5]), M = Math.ceil(N / f);
      const r = rng.pick([0, 1, 2, M, M + 1]), kind = rng.pick(KINDS);
      const lengths = [N * N, N * N, M * M, M * M].map((n) => i % 7 === 0 ? Math.max(0, n - 1) : n + 3);
      resample(views(lengths, rng, kind, i % 9, N), N, f, r, rng.pick([0, -0, 0.5, 3.7, -0.25, 1e38, NaN, Infinity]),
        rng.pick(shifts), rng.pick(shifts), `resample case=${i} N=${N} f=${f} r=${r} ${kind}`);
    }
  });

  it('border impulses, empty / full grids, special floats and every loop boundary', { timeout: 20000 }, () => {
    const rng = new RNG('J8 boundaries');
    let cases = 0;
    for (const N of [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33]) {
      for (const r of [0, 1, Math.floor(N / 2), Math.ceil(N / 2), N - 1, N, N + 1, 300]) {
        for (const kind of KINDS) {
          stencils(views([N * N + 3, N * N + 5, N * N + 7], rng, kind), N, r, `edge N=${N} r=${r} ${kind}`);
          cases++;
        }
        for (const index of new Set([0, N - 1, (N - 1) * N, N * N - 1, Math.floor(N / 2) * N + Math.floor(N / 2)])) {
          if (N === 0) continue;
          const arrays = views([N * N, N * N, N * N], rng, 'zero', 1);
          arrays[0][index] = 1;
          stencils(arrays, N, r, `impulse N=${N} r=${r} index=${index}`);
          cases++;
        }
      }
    }
    expect(cases).toBe(1360);
  });

  it('keeps legacy results for fractional / negative parameters and short views', () => {
    const rng = new RNG('J8 legacy inputs');
    let cases = 0;
    for (const N of [-2, -0, 0.5, 1.5, 4.5, NaN, -Infinity]) {
      for (const r of [-Infinity, -2, -0.5, -0, Number.MIN_VALUE, 0.5, 1.5, 4, NaN, Infinity, Number.MAX_VALUE]) {
        for (const layout of [0, 2, 3, 4]) {
          stencils(views([27, 25, 23], rng, 'wide', layout), N, r, `legacy N=${N} r=${r} layout=${layout}`);
          cases++;
        }
      }
    }
    for (const r of [-Infinity, -2, -0.5, Number.MIN_VALUE, 0.5, 1.5, NaN, Infinity, Number.MAX_VALUE]) {
      stencils(views([64, 64, 64], rng, 'special'), 8, r, `legacy radius=${r}`);
      cases++;
    }
    expect(cases).toBe(317);
  });

  it('keeps read / write order when distinct shared buffers alias the same storage', () => {
    const N = 5, rng = new RNG('J8 shared buffers'), initial = field(N * N + 4, rng, 'wide');
    const want = new Float32Array(new SharedArrayBuffer(initial.byteLength));
    const got = new Float32Array(new SharedArrayBuffer(initial.byteLength));
    // Cloning SharedArrayBuffer shares storage without transferring or detaching an ArrayBuffer.
    const oldDst = new Float32Array(structuredClone(want.buffer), 4, N * N);
    const newDst = new Float32Array(structuredClone(got.buffer), 4, N * N);
    for (const [name, oldCall, newCall] of [
      ['boxH', original.boxHOriginal, blur.boxH],
      ['boxV', original.boxVOriginal, blur.boxV],
      ['blur3', original.blur3Original, blur.blur3],
    ] as const) {
      want.set(initial); got.set(initial);
      oldCall(want.subarray(0, N * N), oldDst, N, 1);
      newCall(got.subarray(0, N * N), newDst, N, 1);
      sameBytes(new Uint8Array(got.buffer), new Uint8Array(want.buffer), `shared ${name}`);
    }
  });

  it('preserves all other exports, default shifts and repeated cached calls', () => {
    const rng = new RNG('J8 unchanged exports');
    for (let i = 0; i < 100; i++) {
      const N = rng.int(0, 12), r = rng.pick([0, -0, -1, 0.5, 2, NaN, Infinity, Number.MAX_VALUE]);
      compare([], () => original.blurSigma2Original(r), () => blur.blurSigma2(r), `sigma2 case=${i}`);
      const arrays = views([N * N, N * N, N * N, N * N], rng, rng.pick(KINDS), i % 9, N);
      const dx = rng.pick([0, -0, 0.5, -1.7, N, NaN, Infinity]), dz = rng.range(-2, 2);
      compare(arrays, ([s, d]) => original.shiftFieldOriginal(s, d, N, dx, dz),
        ([s, d]) => blur.shiftField(s, d, N, dx, dz), `shiftField case=${i}`);
      compare(arrays, ([s, d]) => original.shiftPlumeOriginal(s, d, N, dx, dz),
        ([s, d]) => blur.shiftPlume(s, d, N, dx, dz), `shiftPlume case=${i}`);
      compare(arrays, ([s, a, c, t]) => {
        original.blurDownAddOriginal(s, a, N, 2, 1, 3.7, c, t);
        original.upsampleAddOriginal(c, a, N, 2, 0.5);
      }, ([s, a, c, t]) => {
        blur.blurDownAdd(s, a, N, 2, 1, 3.7, c, t);
        blur.upsampleAdd(c, a, N, 2, 0.5);
      }, `default / cached case=${i}`);
    }
  });

  it('matches on city layers and larger grids with reused scratch', () => {
    const rng = new RNG('J8 city fields');
    for (const N of [64, 127, 256]) {
      const st = newState(N);
      st.crime.set(field(st.cells, rng, 'sparse'));
      st.treeCover.set(field(st.cells, rng, 'full'));
      const arrays = [st.crime, st.treeCover, new Float32Array(st.cells), new Float32Array(st.cells)];
      for (const r of [1, 2, 4]) stencils(arrays, st.size, r, `city N=${st.size} r=${r}`);
      for (const f of [2, 4, 8]) resample(arrays, st.size, f, 2, 0.5, 0.7, -1.6, `city N=${st.size} f=${f}`);
      compare(arrays, ([s, a, c, t]) => {
        for (const n of [N, 5, 1, 0, 4, N]) {
          original.blur3Original(s, t, n, 1);
          original.blurDownAddOriginal(s, a, n, 2, 2, 0.5, c, t, 0.7, -1.6);
        }
      }, ([s, a, c, t]) => {
        for (const n of [N, 5, 1, 0, 4, N]) {
          blur.blur3(s, t, n, 1);
          blur.blurDownAdd(s, a, n, 2, 2, 0.5, c, t, 0.7, -1.6);
        }
      }, `reused scratch N=${N}`);
    }
  });
});
