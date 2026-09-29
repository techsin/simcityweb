/**
 * Services tier engine: equivalence of the ORIGINAL JS (the live ServicesSystem / catchments / transit code, services.ts
 * at 24f8609 + part-B transit rules), the FAIR restructured JS (src/wasm/js/servicesTierEngine.ts) and the WASM port
 * (wasm/sim-kernels/src/catch.rs via src/wasm/kernels/servicesBind.ts). Everything is compared as raw bit patterns
 * (u32 for f32, u64 for f64; NaN = NaN).
 *  1. kernels: V8 Math.hypot (exhaustive probe grid), reachRaw on random maps / all metrics / edge cases, the cell
 *     kernels (finalize, transit disks, footprints, combos, chamfer, box3, block sums, shop taps) on random inputs with
 *     NaN / +-0 / subnormals / huge values, the invalid-network-code fallback;
 *  2. the engine installed into the live ServicesSystem (services test city): every tier phase of a cold, a warm and a
 *     road-edit pass (A, unseated share, coverage, each facility's pool segment = the touched order, sig / seated / D /
 *     dem, facility loads, layers, stats.needs, the scheduler state), then whole-city identity over 120 days (after a
 *     JS-vs-JS baseline), a mid-run switch to the JS kernels and the migration to JS memory when the heap is full;
 *  3. the real profiler fixtures (dense1m_s7 1.12M pop, bot256_s7_y60 0.65M pop; skipped when absent — set
 *     SIM_FIXTURES=<dir>): every reach against catchments.reachRaw, per-phase equivalence, identity at design cadence.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import type { CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import type { ServicesSystem } from '../../src/sim/infra/services';
import { reachRaw, reachResult } from '../../src/sim/infra/catchments';
import { computeTransitCoverage, type StopList } from '../../src/sim/infra/transit';
import { schedulerOf } from '../../src/sim/infra/scheduler';
import { removeBuilding } from '../../src/sim/economy/buildings';
import { deserializeCity, type SerializedCity } from '../../src/save/serialize';
import { unpackFile } from '../../src/save/bundle';
import { initSimWasmSync, setSimWasmPreference } from '../../src/wasm/simWasm';
import { WasmHeap } from '../../src/wasm/heap';
import { adoptLayers } from '../../src/wasm/layers';
import {
  TierEngine, accessLandJS, blockSumJS, box3JS, comboJS, finalizeJS, footprintsJS, jsKernels, reachRawJS, shopTapsJS, transitCovJS,
  type ReachScratch, type StopArgs, enodeCap, FALL_CAP,
} from '../../src/wasm/js/servicesTierEngine';
import {
  CATCH_LAYOUT, catchWasmFromSlot, makeWasmTierKernels, reachRawWasm, servicesBackendStats, wasmSpace, type CatchWasm,
} from '../../src/wasm/kernels/servicesBind';
import { installServicesTierEngine, reachConsts, type InstalledTierEngine, type TierBackend } from '../../src/wasm/kernels/services';
import { servicesCity } from './servicesCity';
import { checkImpl, fairImpl, origImpl, wasmImpl, type SlotCapture } from '../../tools/bench/servicesTierEngine.core';

// ------------------------------------------------------------------------------------------------ helpers
function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** first differing element (bit patterns, NaN = NaN) or -1 */
function firstDiff(a: ArrayBufferView, b: ArrayBufferView): number {
  if (a.byteLength !== b.byteLength) return -2;
  if (a instanceof Float32Array && b instanceof Float32Array) {
    const ua = new Uint32Array(a.buffer, a.byteOffset, a.length), ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
    for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i] && !(a[i] !== a[i] && b[i] !== b[i])) return i;
    return -1;
  }
  if (a instanceof Float64Array && b instanceof Float64Array) {
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i]) && !(a[i] !== a[i] && b[i] !== b[i])) return i;
    return -1;
  }
  const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return i;
  return -1;
}
function expectSame(got: ArrayBufferView, want: ArrayBufferView, label: string): void {
  const d = firstDiff(got, want);
  if (d !== -1) {
    const g = (got as unknown as ArrayLike<number>)[d], w = (want as unknown as ArrayLike<number>)[d];
    expect.fail(`${label}: first difference at ${d}: ${g} vs ${w}`);
  }
}

/** a field with the magnitudes the kernels must reproduce exactly */
function field(n: number, seed: number, kind: 'unit' | 'wide' | 'need'): Float32Array {
  const r = rng(seed), a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = r();
    if (kind === 'unit') a[i] = u < 0.05 ? (u < 0.02 ? 0 : -0) : u < 0.07 ? 1 + r() : u < 0.08 ? NaN : u < 0.09 ? 1e-40 * r() : r();
    else if (kind === 'need') a[i] = u < 0.3 ? 0 : u < 0.32 ? -r() : u < 0.33 ? NaN : u < 0.34 ? 1e-42 : r() * 400;
    else a[i] = u < 0.1 ? (u < 0.05 ? 0 : -0) : (r() < 0.5 ? -1 : 1) * Math.exp((r() * 2 - 1) * 70);
  }
  return a;
}

function randomMap(N: number, seed: number): { size: number; cells: number; network: Uint8Array; water: Uint8Array } {
  const r = rng(seed), C = N * N;
  const network = new Uint8Array(C), water = new Uint8Array(C);
  // road grid with every network code, a river with bridges, random clutter
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x;
    if (x % 4 === 1 || z % 5 === 2) network[i] = 1 + Math.floor(r() * 5);
    if (r() < 0.03) network[i] = Network.Rail;
    if (r() < 0.05) network[i] = 0;
    if (Math.abs(x - (N >> 1)) <= 1 || r() < 0.02) water[i] = 1;
  }
  return { size: N, cells: C, network, water };
}

let wasm: CatchWasm;
beforeAll(() => {
  setSimWasmPreference('auto');
  expect(initSimWasmSync()).toBe(true);
  const w = catchWasmFromSlot();
  expect(w, 'the committed binary exports the catch_* kernels (npm run build:wasm)').not.toBeNull();
  wasm = w!;
  expect(wasm.ex.catch_layout()).toBe(CATCH_LAYOUT);
});
afterEach(() => {
  setSimWasmPreference('auto');
  setSimWasmPreference('auto', 'services');
});

/** a JS engine and a wasm engine sized for N (kernel-level tests) */
function engines(N: number): { js: TierEngine; wa: TierEngine } {
  const K = reachConsts();
  const js = new TierEngine(9, K, jsKernels);
  js.ensure(N);
  const wa = new TierEngine(9, K, makeWasmTierKernels(), wasmSpace(wasm));
  wa.ensure(N);
  return { js, wa };
}

// ------------------------------------------------------------------------------------------------ 1. kernels
describe('services tier engine kernels', () => {
  it('V8 Math.hypot port: exact for every (x - cx, z - cz), |.| <= 400, offsets 0 / 0.5, and special values', () => {
    const h = wasm.ex.catch_hypot;
    let n = 0, bad = 0;
    for (const ox of [0, 0.5]) for (const oz of [0, 0.5]) for (let x = -400; x <= 400; x++) for (let z = -400; z <= 400; z++) {
      const a = x - ox, b = z - oz;
      n++;
      if (!Object.is(Math.hypot(a, b), h(a, b))) bad++;
    }
    expect(bad).toBe(0);
    expect(n).toBe(4 * 801 * 801);
    const sp = [0, -0, 1e-310, -1e-310, 1e300, -1e300, 3, 4, Infinity, -Infinity, NaN, 0.1, 1e-160];
    for (const a of sp) for (const b of sp) expect(Object.is(h(a, b), Math.hypot(a, b)) || (h(a, b) !== h(a, b) && Math.hypot(a, b) !== Math.hypot(a, b)), `${a},${b}`).toBe(true);
  });

  it('reachRaw: fair JS and wasm reproduce catchments.reachRaw (touched order + weights) on random maps, metrics and edge cases', () => {
    const K = reachConsts();
    const shapes: [number, number][] = [[1, 1], [2, 2], [7, 3], [64, 11], [96, 12]];
    let cases = 0;
    for (const [N, seed] of shapes) {
      const st = randomMap(N, seed) as unknown as CityState;
      const { js, wa } = engines(N);
      const r = rng(seed * 31 + 7);
      const radii = [0, -1, NaN, 0.1, 0.5, 1, 2.5, 3.7, 7, 16, 36, 60, 1000, Infinity];
      for (let t = 0; t < 60; t++) {
        const bw = 1 + Math.floor(r() * 5), bd = 1 + Math.floor(r() * 5);
        // include footprints touching / crossing / outside the map edges
        const bx = Math.floor(r() * (N + 6)) - 3, bz = Math.floor(r() * (N + 6)) - 3;
        const radius = radii[t % radii.length], metric = t % 4;
        const n0 = reachRaw(st, bx, bz, bw, bd, radius, metric);
        const ref = reachResult();
        const touched0 = ref.touched.slice(0, n0), best0 = Float32Array.from(touched0, (i) => ref.best[i]);
        const R: ReachScratch = js.scratch();
        const n1 = reachRawJS(N, st.network, st.water, K, R, bx, bz, bw, bd, radius, metric);
        js.stamp = R.stamp;
        const n2 = reachRawWasm(wa, N, st.network, st.water, bx, bz, bw, bd, radius, metric);
        const label = `N=${N} fp=(${bx},${bz},${bw},${bd}) r=${radius} m=${metric}`;
        expect(n1, label).toBe(n0);
        expect(n2, label).toBe(n0);
        expectSame(js.touched.v.slice(0, n1), touched0, `${label} JS touched`);
        expectSame(wa.touched.v.slice(0, n2), touched0, `${label} wasm touched`);
        expectSame(Float32Array.from(js.touched.v.slice(0, n1), (i) => js.best.v[i]), best0, `${label} JS weights`);
        expectSame(Float32Array.from(wa.touched.v.slice(0, n2), (i) => wa.best.v[i]), best0, `${label} wasm weights`);
        cases++;
      }
    }
    expect(cases).toBe(shapes.length * 60);
  });

  it('an invalid network code (outside the cost tables) is reported, not trapped: -1 from catch_reach_raw', () => {
    const N = 16;
    const st = randomMap(N, 5);
    st.network[5 * N + 6] = 9;
    const { wa } = engines(N);
    const n = reachRawWasm(wa, N, st.network, st.water, 5, 5, 2, 2, 12, 0);
    expect(n).toBe(-1);
  });

  it('finalize / transit disks / footprints / combos: fair JS == wasm == original on random inputs', () => {
    for (const N of [1, 3, 17, 64]) {
      const C = N * N;
      const { js, wa } = engines(N);
      // finalize (in engine memory: cov / A are engine-owned)
      for (const seed of [1, 2]) {
        const cov = field(C, seed, 'unit'), A = field(C, seed + 5, 'unit'), need = field(C, seed + 9, 'need');
        const out1 = new Float64Array(3), out2 = new Float64Array(3), l1 = new Float32Array(C), l2 = new Float32Array(C);
        js.cov.v.set(cov); js.A.v.set(A); wa.cov.v.set(cov); wa.A.v.set(A);
        const ref = new Float32Array(C), refOut = new Float64Array(3);
        finalizeJS(C, cov, ref, false, need, A, refOut);
        js.beginPass(); wa.beginPass();
        js.finalize(l1, false, need).forEach((v, i) => (out1[i] = v));
        wa.finalize(l2, false, need).forEach((v, i) => (out2[i] = v));
        expectSame(l1, ref, `finalize layer JS N=${N}`); expectSame(l2, ref, `finalize layer wasm N=${N}`);
        expectSame(out1, refOut, `finalize sums JS N=${N}`); expectSame(out2, refOut, `finalize sums wasm N=${N}`);
      }
      // transit disks: compare with the live computeTransitCoverage (road-flag stops: no skip rules apply)
      const r = rng(N + 3);
      const ns = 1 + Math.floor(r() * 12);
      js.ensureStops(ns); wa.ensureStops(ns);
      const stops: StopList = { n: ns, bid: new Int32Array(ns).fill(-1), mode: new Uint8Array(ns), cell: new Int32Array(ns) };
      for (let s = 0; s < ns; s++) { stops.mode[s] = 1 + Math.floor(r() * 3); stops.cell[s] = Math.floor(r() * C); }
      const st = { size: N, cells: C, buildings: new Map() } as unknown as CityState;
      for (const funding of [0, 0.7, 1, 1.25]) {
        const base = field(C, N + 11, 'unit');
        const tmpRef = new Float32Array(C), Tref = base.slice();
        computeTransitCoverage(st, stops, tmpRef, funding);
        for (let i = 0; i < C; i++) { const t = tmpRef[i]; if (t > 0) Tref[i] = 1 - (1 - Tref[i]) * (1 - Math.min(1, t)); }
        for (const e of [js, wa]) {
          const cell = e.stopCell.v, R = e.stopR.v, fac = e.stopFactor.v, skip = e.stopSkip.v;
          for (let s = 0; s < ns; s++) { cell[s] = stops.cell[s]; R[s] = stops.mode[s] === 1 ? 5 : stops.mode[s] === 2 ? 7 : 8; fac[s] = stops.mode[s] === 1 ? 0.75 : 1; skip[s] = 0; }
          const args: StopArgs = { n: ns, cell, R, factor: fac, skip };
          const T = base.slice();
          e.kernels.transitCov(e, N, args, funding, e.tmp.v, T);
          expectSame(T, Tref, `transit ${e.kernels.name} N=${N} funding ${funding}`);
          expectSame(e.tmp.v, tmpRef, `transit tmp ${e.kernels.name} N=${N}`);
        }
      }
      // footprints (boxes incl. off-map / empty / overlapping), 3 layers
      const nb = 40;
      js.ensureBoxes(nb); wa.ensureBoxes(nb);
      const boxes = new Int32Array(4 * nb);
      for (let q = 0; q < nb; q++) { boxes[4 * q] = Math.floor(r() * (N + 4)) - 2; boxes[4 * q + 1] = Math.floor(r() * (N + 4)) - 2; boxes[4 * q + 2] = Math.floor(r() * 5); boxes[4 * q + 3] = Math.floor(r() * 5); }
      const L0 = [field(C, 21, 'unit'), field(C, 22, 'wide'), field(C, 23, 'unit')];
      const ref = L0.map((a) => a.slice());
      footprintsJS(N, nb, boxes, ref);
      for (const e of [js, wa]) {
        e.boxes.v.set(boxes);
        const L = L0.map((a) => a.slice());
        e.kernels.footprints(e, N, nb, e.boxes.v, L);
        L.forEach((a, j) => expectSame(a, ref[j], `footprints ${e.kernels.name} N=${N} layer ${j}`));
      }
      // legacy combos
      const E = field(C, 31, 'unit'), H = field(C, 32, 'unit'), Kc = field(C, 33, 'wide'), P = field(C, 34, 'unit'), G = field(C, 35, 'unit');
      const eduR = new Float32Array(C), parkR = new Float32Array(C);
      comboJS(C, E, H, Kc, P, G, eduR, parkR, 0.45, 0.35, 0.2);
      for (const e of [js, wa]) {
        const edu = new Float32Array(C), park = new Float32Array(C);
        e.kernels.combo(e, C, E, H, Kc, P, G, edu, park, 0.45, 0.35, 0.2);
        expectSame(edu, eduR, `edu ${e.kernels.name}`); expectSame(park, parkR, `park ${e.kernels.name}`);
      }
    }
  });

  it('alloc / union / report / finalize on synthetic slots with extreme values: original loops == fair JS == wasm', () => {
    // pools with unique cells per facility (the invariant of real reaches), need with NaN / negatives / huge values,
    // capacities 0 / tiny / huge / Infinity / NaN, op and strength 0 / NaN / huge, empty and whole-map reaches
    const odd = [0, -0, 1e-300, 1e-40, 0.3, 1, 7.5, 1e30, Infinity, NaN, -1];
    for (const [N, seed] of [[1, 1], [4, 2], [16, 3], [48, 4]]) {
      const C = N * N, r = rng(seed * 101);
      const slots: SlotCapture[] = [];
      for (let k = 0; k < 4; k++) {
        const shared = k % 2 === 0;
        const n = 1 + Math.floor(r() * 12);
        const fs = new Int32Array(n), fe = new Int32Array(n), idx: number[] = [], w: number[] = [];
        for (let c = 0; c < n; c++) {
          const m = c === 0 ? 0 : c === 1 ? C : Math.floor(r() * (C + 1));
          const cells = Array.from({ length: C }, (_, i) => i);
          for (let i = C - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
          fs[c] = idx.length;
          for (let q = 0; q < m; q++) { idx.push(cells[q]); w.push(r() < 0.2 ? 1 : r() < 0.05 ? 1e-30 : Math.fround(r())); }
          fe[c] = idx.length;
        }
        const pick = () => (r() < 0.35 ? odd[Math.floor(r() * odd.length)] : r() * 3000);
        const cap = Float64Array.from({ length: n }, () => (r() < 0.3 ? Infinity : pick()));
        const op = Float64Array.from({ length: n }, () => (r() < 0.7 ? r() * 1.3 : pick()));
        const str = Float64Array.from({ length: n }, () => (r() < 0.7 ? r() : pick()));
        const order = Int32Array.from({ length: n }, (_, c) => c).sort((a, b) => op[b] - op[a] || a - b);
        slots.push({
          k, name: `synthetic ${k}`, shared, n, ids: Int32Array.from({ length: n }, (_, c) => c + 1), str, op, cap, fs, fe, order, idx: Int32Array.from(idx),
          w: Float32Array.from(w), poolN: idx.length, entries: idx.length, needL: field(C, seed * 7 + k, 'need'), C,
        });
      }
      const ref = origImpl(slots);
      for (const x of [fairImpl(slots), wasmImpl(wasm, slots, 'wasm')]) expect(checkImpl(ref, x), `N=${N} ${x.label}`).toEqual([]);
    }
  });

  it('access fields: chamfer / box3 / block sums / shop taps: fair JS (verbatim services.ts code) == wasm', () => {
    for (const N of [2, 5, 64]) {
      const C = N * N;
      const { js, wa } = engines(N);
      const map = randomMap(N, N * 7);
      const r = rng(N);
      const dist = Int32Array.from({ length: C }, () => (r() < 0.2 ? -1 : Math.floor(r() * 4000)));
      for (const [scaled, scale, step, unreached] of [[true, 0.005, 0.35, 12.5], [false, 1, 4, 0]] as const) {
        const vR = new Float32Array(C), oR = new Float32Array(C);
        accessLandJS(N, map.network, dist, vR, scaled ? oR : null, scaled, scale, step, 1e9, unreached);
        for (const e of [js, wa]) {
          const o = new Float32Array(C);
          e.kernels.accessLand(e, N, map.network, dist, e.tmp.v, scaled ? o : null, scaled, scale, step, 1e9, unreached);
          expectSame(e.tmp.v, vR, `chamfer ${e.kernels.name} N=${N} scaled=${scaled}`);
          if (scaled) expectSame(o, oR, `access out ${e.kernels.name} N=${N}`);
        }
      }
      for (const B of [1, 3, 8]) {
        const nb = Math.ceil(N / B);
        const res = field(C, B + N, 'need');
        const popR = new Float32Array(nb * nb);
        blockSumJS(N, B, nb, res, popR);
        const aR = popR.slice(), tR = new Float32Array(nb * nb);
        box3JS(aR, nb, tR);
        for (const e of [js, wa]) {
          const pop = new Float32Array(nb * nb);
          e.kernels.blockSum(e, N, B, nb, res, pop);
          expectSame(pop, popR, `block sums ${e.kernels.name} N=${N} B=${B}`);
          const a = pop.slice(), t = new Float32Array(nb * nb);
          e.kernels.box3(e, a, nb, t);
          expectSame(a, aR, `box3 ${e.kernels.name} N=${N} B=${B}`);
        }
        // taps: v with distances beyond capQ / NaN, a LUT, a ratio grid
        const capQ = 48, lut = Float32Array.from({ length: capQ + 1 }, (_, q) => 1 - q / (capQ + 3));
        const v = Float32Array.from({ length: C }, () => (r() < 0.1 ? NaN : r() < 0.2 ? 1e9 : Math.floor(r() * 60)));
        const ratio = field(nb * nb, B * 3, 'unit').map((x) => (x !== x ? 0.5 : Math.abs(x)));
        const cx0 = new Int32Array(N), cx1 = new Int32Array(N), ct = new Float32Array(N);
        for (let x = 0; x < N; x++) { const f = Math.min(nb - 1, Math.max(0, (x + 0.5) / B - 0.5)); const x0 = Math.floor(f); cx0[x] = x0; cx1[x] = Math.min(nb - 1, x0 + 1); ct[x] = f - x0; }
        const outR = new Float32Array(C);
        shopTapsJS(N, nb, B, v, ratio, lut, cx0, cx1, ct, outR, capQ, 0.35);
        for (const e of [js, wa]) {
          e.tmp.v.set(v);
          const out = new Float32Array(C);
          e.kernels.shopTaps(e, N, nb, B, e.tmp.v, ratio, lut, cx0, cx1, ct, out, capQ, 0.35);
          expectSame(out, outR, `shop taps ${e.kernels.name} N=${N} B=${B}`);
        }
      }
    }
  });
});

// ------------------------------------------------------------------------------------------------ 2. installed engine
interface Arm {
  label: string;
  st: CityState;
  sim: Simulation;
  svc: ServicesSystem;
  inst: InstalledTierEngine | null;
}

function makeArm(label: string, st: CityState, backend: TierBackend | 'orig', opts: { wasm?: CatchWasm } = {}): Arm {
  const systems = createSystems();
  const svc = systems.find((s) => s.name === 'services') as ServicesSystem;
  const inst = backend === 'orig' ? null : installServicesTierEngine(svc, { backend, wasm: opts.wasm });
  const sim = new Simulation(st, systems);
  return { label, st, sim, svc, inst };
}

type Priv = Record<string, unknown> & {
  A: Float32Array; cov: Float32Array; seat: Float32Array; pIdx: Int32Array; pW: Float32Array; facStart: number[]; facEnd: number[];
  facSig: number[]; facSeat: number[]; fac: { id: number }[][]; shared: boolean[]; tierSlot: number; tierPhase: number; cursor: number;
  workLeft: number; stepIdx: number; tierStats: unknown[];
};

const BY_ID = ['tierById', 'capById', 'demById', 'servById', 'seatById', 'opById', 'utilById', 'powById', 'seenById'] as const;

/** snapshot of the tier engine state at a phase boundary */
interface Snap {
  tag: string;
  A: Float32Array;
  cov: Float32Array;
  u: Float32Array | null;
  segs: { idx: Int32Array; w: Float32Array }[] | null;
  sig: Float64Array | null;
  seat: Float64Array | null;
  byId: Float32Array[];
}

/** where each hooked arm writes its snapshots (hooks are installed once per arm) */
const sinks = new WeakMap<Arm, { snaps: Snap[] }>();

/** hook the phase boundaries of the original (its private methods) or of the engine (its methods) */
function hookPhases(arm: Arm, snapsNow: Snap[]): void {
  const have = sinks.get(arm);
  if (have) { have.snaps = snapsNow; return; }
  const sink = { snaps: snapsNow };
  sinks.set(arm, sink);
  const snaps = { push: (x: Snap) => sink.snaps.push(x) };
  const p = arm.svc as unknown as Priv;
  const byId = () => BY_ID.map((f) => (p[f] as Float32Array).slice());
  if (!arm.inst) {
    const origSeat = p.seatOrder as (k: number) => void, origFin = p.finalizeTier as (...a: unknown[]) => void, origRep = p.reportDemand as (...a: unknown[]) => number;
    const segs = (k: number) => p.fac[k].map((_b, c) => ({ idx: p.pIdx.slice(p.facStart[c], p.facEnd[c]), w: p.pW.slice(p.facStart[c], p.facEnd[c]) }));
    p.seatOrder = function (k: number) {
      snaps.push({ tag: `search-end ${k}`, A: p.A.slice(), cov: p.cov.slice(), u: p.seat.slice(), segs: segs(k), sig: null, seat: null, byId: byId() });
      origSeat.call(this, k);
    };
    p.reportDemand = function (...a: unknown[]) {
      const k = a[2] as number;
      if (a[3] === 0) snaps.push({ tag: `alloc-end ${k}`, A: p.A.slice(), cov: p.cov.slice(), u: p.seat.slice(), segs: null, sig: Float64Array.from(p.facSig), seat: Float64Array.from(p.facSeat), byId: byId() });
      return origRep.apply(this, a);
    };
    p.finalizeTier = function (...a: unknown[]) {
      const k = a[1] as number;
      const shared = p.shared[k];
      snaps.push({ tag: `final ${k}`, A: p.A.slice(), cov: p.cov.slice(), u: shared ? p.seat.slice() : null, segs: shared ? null : segs(k), sig: null, seat: null, byId: byId() });
      origFin.apply(this, a);
    };
  } else {
    const e = arm.inst.engine;
    const origSeat = (Object.getPrototypeOf(arm.svc) as Priv).seatOrder as (k: number) => void;
    const origFinalize = e.finalize.bind(e), origReport = e.report2.bind(e);
    const segs = (k: number) => p.fac[k].map((_b, c) => e.segmentOf(k, c));
    p.seatOrder = function (k: number) {
      snaps.push({ tag: `search-end ${k}`, A: e.A.v.slice(), cov: e.cov.v.slice(), u: e.u.v.slice(), segs: segs(k), sig: null, seat: null, byId: byId() });
      origSeat.call(this, k);
    };
    e.report2 = (k, cursor, ...rest) => {
      if (cursor === 0) snaps.push({ tag: `alloc-end ${k}`, A: e.A.v.slice(), cov: e.cov.v.slice(), u: e.u.v.slice(), segs: null, sig: e.sig.v.slice(0, p.fac[k].length), seat: e.seat.v.slice(0, p.fac[k].length), byId: byId() });
      return origReport(k, cursor, ...rest);
    };
    e.finalize = (layer, transit, needL) => {
      const k = p.tierSlot;
      const shared = p.shared[k];
      snaps.push({ tag: `final ${k}`, A: e.A.v.slice(), cov: e.cov.v.slice(), u: shared ? e.u.v.slice() : null, segs: shared ? null : segs(k), sig: null, seat: null, byId: byId() });
      return origFinalize(layer, transit, needL);
    };
  }
}

function compareSnaps(ref: Snap[], got: Snap[], label: string): void {
  expect(got.map((s) => s.tag), `${label}: phase sequence`).toEqual(ref.map((s) => s.tag));
  for (let j = 0; j < ref.length; j++) {
    const a = ref[j], b = got[j], l = `${label} ${a.tag}`;
    expectSame(b.A, a.A, `${l} A`);
    expectSame(b.cov, a.cov, `${l} coverage`);
    if (a.u && b.u) expectSame(b.u, a.u, `${l} unseated share`);
    if (a.segs && b.segs) {
      expect(b.segs.length).toBe(a.segs.length);
      a.segs.forEach((s, c) => { expectSame(b.segs![c].idx, s.idx, `${l} facility ${c} pool cells (touched order)`); expectSame(b.segs![c].w, s.w, `${l} facility ${c} pool weights`); });
    }
    if (a.sig && b.sig) { expectSame(b.sig, a.sig, `${l} sig`); expectSame(b.seat!, a.seat!, `${l} seated`); }
    a.byId.forEach((x, f) => expectSame(b.byId[f], x, `${l} ${BY_ID[f]}`));
  }
}

function layersOf(st: object): Map<string, ArrayBufferView> {
  const m = new Map<string, ArrayBufferView>();
  for (const [k, v] of Object.entries(st)) {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) m.set(k, v);
    else if (Array.isArray(v) && v.length && v.every((x) => ArrayBuffer.isView(x))) (v as ArrayBufferView[]).forEach((a, i) => m.set(`${k}[${i}]`, a));
  }
  return m;
}
function diffCities(a: Arm, b: Arm): string[] {
  const out: string[] = [];
  const la = layersOf(a.st), lb = layersOf(b.st);
  for (const [k, va] of la) {
    const vb = lb.get(k);
    if (!vb) { out.push(`${k}: missing`); continue; }
    const ua = new Uint8Array(va.buffer, va.byteOffset, va.byteLength), ub = new Uint8Array(vb.buffer, vb.byteOffset, vb.byteLength);
    if (ua.length !== ub.length) { out.push(`${k}: shape`); continue; }
    for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) { out.push(`${k}: byte ${i}`); break; }
  }
  if (JSON.stringify(a.st.stats) !== JSON.stringify(b.st.stats)) out.push('stats');
  const pa = a.svc as unknown as Priv, pb = b.svc as unknown as Priv;
  for (const f of BY_ID) if (firstDiff(pa[f] as Float32Array, pb[f] as Float32Array) !== -1) out.push(`services.${f}`);
  for (const f of ['stepIdx', 'tierSlot', 'tierPhase', 'cursor', 'workLeft']) if (!Object.is(pa[f], pb[f])) out.push(`services.${f}: ${String(pa[f])} vs ${String(pb[f])}`);
  if (JSON.stringify(pa.tierStats) !== JSON.stringify(pb.tierStats)) out.push('services.tierStats');
  return out;
}

/** one full pass on each arm (hooks collect per-phase snapshots), then the comparisons */
function passAndCompare(arms: Arm[], label: string): void {
  const snaps = arms.map(() => [] as Snap[]);
  arms.forEach((a, j) => { hookPhases(a, snaps[j]); a.svc.compute(a.sim, false); });
  for (let j = 1; j < arms.length; j++) {
    compareSnaps(snaps[0], snaps[j], `${label} ${arms[j].label}`);
    expect(diffCities(arms[0], arms[j]), `${label} ${arms[j].label}: city`).toEqual([]);
  }
  expect(snaps[0].length).toBeGreaterThan(8);
}

function roadEdit(arms: Arm[], seed: number): string {
  const r = rng(seed), N = arms[0].st.size;
  for (let t = 0; t < 5000; t++) {
    const x = 1 + Math.floor(r() * (N - 2)), z = 1 + Math.floor(r() * (N - 2)), i = z * N + x;
    const cur = arms[0].st.network[i];
    if (cur !== Network.Road && cur !== Network.Street) continue;
    const nv = cur === Network.Road ? Network.Street : Network.None;
    for (const a of arms) { a.st.network[i] = nv; a.sim.events.emit('networkChanged', { x0: x, z0: z, x1: x, z1: z }); }
    return `${x},${z}: ${cur} -> ${nv}`;
  }
  throw new Error('no road cell to edit');
}

describe('services tier engine installed into the live ServicesSystem', () => {
  it('every phase of a cold, a warm and a road-edit pass matches the original (fair JS and wasm)', { timeout: 900000 }, () => {
    const arms = [makeArm('orig', servicesCity(128, 11).st, 'orig'), makeArm('js', servicesCity(128, 11).st, 'js'), makeArm('wasm', servicesCity(128, 11).st, 'wasm')];
    expect(arms[1].inst!.backend).toBe('js');
    expect(arms[2].inst!.backend).toBe('wasm');
    const fac = (arms[0].svc as unknown as Priv).fac.map((l) => l.length);
    expect(fac.every((n) => n > 0), `every tier slot has facilities: ${fac}`).toBe(true);
    for (const a of arms) (a.svc as unknown as { invalidateReach(r: unknown): void }).invalidateReach(undefined);
    passAndCompare(arms, 'cold');
    passAndCompare(arms, 'warm');
    roadEdit(arms, 3);
    roadEdit(arms, 4);
    passAndCompare(arms, 'road edit');
    const s = arms[2].inst!.engine.stats;
    expect(s.fresh).toBeGreaterThan(0);
    expect(s.cached).toBeGreaterThan(0);
    expect(servicesBackendStats(arms[2].inst!.engine)!.jsCalls).toBe(0);
  });

  it('a city simulated 120 days on the engine is bit-identical to the original (JS-vs-JS baseline first)', { timeout: 1800000 }, () => {
    const DAYS = 120;
    const run = (backend: TierBackend | 'orig') => {
      const arm = makeArm(backend, servicesCity(96, 5, 2).st, backend);
      for (let d = 0; d < DAYS; d++) {
        if (d % 9 === 4) roadEdit([arm], 100 + d);
        arm.sim.advanceDay();
        if (d % 2 === 0) schedulerOf(arm.sim).flush(arm.sim);
      }
      return arm;
    };
    const a = run('orig'), b = run('orig');
    expect(diffCities(a, b), 'JS vs JS baseline').toEqual([]);
    expect((a.svc as unknown as { donePasses: number }).donePasses).toBeGreaterThan(12);
    const w = run('wasm');
    expect(diffCities(a, w), 'original vs wasm engine').toEqual([]);
    const j = run('js');
    expect(diffCities(a, j), 'original vs fair JS engine').toEqual([]);
    expect(w.inst!.engine.stats.fresh).toBeGreaterThan(0);
  });

  it('a tier losing all its facilities mid-run (empty slot: layer zeroed, records dropped) and a city without facilities', { timeout: 900000 }, () => {
    const arms = [makeArm('orig', servicesCity(64, 17).st, 'orig'), makeArm('js', servicesCity(64, 17).st, 'js'), makeArm('wasm', servicesCity(64, 17).st, 'wasm')];
    for (let d = 0; d < 16; d++) {
      if (d === 6) {
        // bulldoze every police and fire building (same ids in every arm)
        for (const a of arms) {
          for (const b of [...a.st.buildings.values()]) if (/police|fire/.test(b.def)) removeBuilding(a.sim, b);
        }
      }
      for (const a of arms) { a.sim.advanceDay(); schedulerOf(a.sim).flush(a.sim); }
    }
    for (const a of arms.slice(1)) expect(diffCities(arms[0], a), a.label).toEqual([]);
    expect((arms[0].svc as unknown as Priv).fac[0].length).toBe(0);
    // no facilities at all: every slot empty from the start
    const bare = (backend: TierBackend | 'orig') => {
      const c = servicesCity(32, 3, 0);
      const a = makeArm(backend, c.st, backend);
      for (let d = 0; d < 6; d++) { a.sim.advanceDay(); schedulerOf(a.sim).flush(a.sim); }
      return a;
    };
    const o = bare('orig');
    expect(diffCities(o, bare('wasm'))).toEqual([]);
    expect(diffCities(o, bare('js'))).toEqual([]);
  });

  it('switching the services kernels to JS mid-run and back keeps the city identical', { timeout: 900000 }, () => {
    const a = makeArm('orig', servicesCity(64, 9).st, 'orig');
    const b = makeArm('wasm', servicesCity(64, 9).st, 'wasm');
    for (let d = 0; d < 30; d++) {
      if (d === 10) setSimWasmPreference('js', 'services');
      if (d === 20) setSimWasmPreference('auto', 'services');
      if (d % 7 === 3) roadEdit([a, b], d);
      a.sim.advanceDay(); b.sim.advanceDay();
      schedulerOf(a.sim).flush(a.sim); schedulerOf(b.sim).flush(b.sim);
    }
    expect(diffCities(a, b)).toEqual([]);
    expect(servicesBackendStats(b.inst!.engine)!.jsCalls).toBeGreaterThan(0);
  });

  it('a full heap (pinned views, no room to grow) migrates the engine to JS memory without changing results', { timeout: 900000 }, () => {
    // a private instance with a small, non-growable reservation: adopted layers pin views, so pool growth must fail
    const bytes = readFileSync(join(process.cwd(), 'src', 'wasm', 'sim_kernels.wasm'));
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
    const ex = inst.exports as unknown as CatchWasm['ex'] & { memory: WebAssembly.Memory; __heap_base: WebAssembly.Global };
    const heap = new WasmHeap(ex.memory, Number(ex.__heap_base.value));
    const w: CatchWasm = { ex, memory: ex.memory, heap };
    const pin = { a: new Float32Array(4) };
    heap.reserve(3 << 20);
    adoptLayers(pin, heap);
    const a = makeArm('orig', servicesCity(64, 13).st, 'orig');
    const b = makeArm('wasm', servicesCity(64, 13).st, 'wasm', { wasm: w });
    for (let d = 0; d < 12; d++) {
      if (d % 4 === 1) roadEdit([a, b], d + 50);
      a.sim.advanceDay(); b.sim.advanceDay();
      schedulerOf(a.sim).flush(a.sim); schedulerOf(b.sim).flush(b.sim);
    }
    expect(b.inst!.engine.stats.migratedToJs).toBe(true);
    expect(b.inst!.active).toBe(true);
    expect(diffCities(a, b)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ 3. fixtures
const FIXTURE_DIR = process.env.SIM_FIXTURES ?? '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/wasm/profile/fixtures';
const FIXTURES = ['dense1m_s7.metropolis', 'bot256_s7_y60.metropolis'].map((f) => join(FIXTURE_DIR, f)).filter((f) => existsSync(f));

describe.skipIf(FIXTURES.length === 0)('real profiler fixtures', () => {
  for (const file of FIXTURES) {
    const name = file.split('/').pop()!;
    it(`${name}: every facility reach, every tier phase (cold / warm / road edit) and 8 days at design cadence are bit-identical`, { timeout: 1800000 }, async () => {
      const bytes = new Uint8Array(readFileSync(file));
      const load = async () => deserializeCity((await unpackFile(bytes)) as SerializedCity);
      const arms = [makeArm('orig', await load(), 'orig'), makeArm('js', await load(), 'js'), makeArm('wasm', await load(), 'wasm')];
      // every reach of the city: catchments.reachRaw vs the wasm kernel (touched order + weights)
      const st = arms[0].st, p = arms[0].svc as unknown as Priv;
      const e = arms[2].inst!.engine;
      const { infoOf } = await import('../../src/sim/infra/common');
      let reaches = 0;
      for (let k = 0; k < p.fac.length; k++) for (const b0 of p.fac[k]) {
        const b = b0 as unknown as { x: number; z: number; w: number; d: number };
        const inf = infoOf(st, b0 as never);
        const radius = k === 8 ? inf.covRadius : inf.tierRadius, metric = k === 8 ? 2 : inf.metric;
        const n0 = reachRaw(st, b.x, b.z, b.w, b.d, radius, metric);
        const ref = reachResult();
        const n2 = reachRawWasm(e, st.size, st.network, st.water, b.x, b.z, b.w, b.d, radius, metric);
        expect(n2).toBe(n0);
        expectSame(e.touched.v.slice(0, n2), ref.touched.slice(0, n0), `${name} reach ${b0.id} touched`);
        expectSame(Float32Array.from(e.touched.v.slice(0, n2), (i) => e.best.v[i]), Float32Array.from(ref.touched.slice(0, n0), (i) => ref.best[i]), `${name} reach ${b0.id} weights`);
        reaches++;
      }
      expect(reaches).toBeGreaterThan(500);
      for (const a of arms) (a.svc as unknown as { invalidateReach(r: unknown): void }).invalidateReach(undefined);
      passAndCompare(arms, `${name} cold`);
      passAndCompare(arms, `${name} warm`);
      roadEdit(arms, 7);
      passAndCompare(arms, `${name} road edit`);
      for (let d = 0; d < 8; d++) {
        if (d === 3) roadEdit(arms, 11);
        for (const a of arms) { a.sim.advanceDay(); schedulerOf(a.sim).flush(a.sim); }
      }
      for (const a of arms.slice(1)) expect(diffCities(arms[0], a), `${name} ${a.label} after 8 days`).toEqual([]);
    });
  }
});
