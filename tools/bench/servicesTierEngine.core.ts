/**
 * Services tier engine A/B — environment-agnostic core: the replay implementations (a) and one benchmark ARM (b–d),
 * shared by the node arm process (servicesTierEngine.node.ts) and the Chromium arm worker (servicesTierEngine.browser.ts),
 * driven by tools/bench/servicesTierEngine.bench.mjs. One arm per isolate: V8's ArrayBuffer-detaching protector is
 * per isolate, so an arm that detaches nothing (JS arms, and wasm arms on the pre-sized binary) keeps it intact.
 *
 * Replay (a): after one pass of the ORIGINAL ServicesSystem on a fixture, every tier slot's inputs are captured from
 * its private fields (facility list, op, capacity, the reach pool + ranges from its cache, the need raster, the seat
 * order), then the phase kernels are replayed on them:
 *    original JS   the loop bodies of services.ts @ 24f8609 (allocSeats / splatUnion / reportDemand / finalizeTier)
 *    fair JS       src/wasm/js/servicesTierEngine.ts (same algorithmic changes as the port: e-cache, typed ranges)
 *    wasm          catch_* of each binary variant (SIMD build = shipped, scalar build) with the slot data resident in
 *                  its linear memory (the engine's memory model); "staged" arms copy the need raster in per call
 * Every case is checked bit-exact (u32 patterns; NaN = NaN) against the original before it is timed.
 *
 * Arms (b–d): the live ServicesSystem of a full createSystems() simulation on the fixture, as is (orig) or with the tier
 * engine installed before the Simulation is built (fair = JS kernels, wasm = SIMD binary with layers staged, scalar =
 * scalar binary, resident = SIMD with the CityState layers + need rasters adopted into wasm memory: zero copies).
 */
import { allocJS, finalizeJS, reportJS, unionJS, type PhaseArgs } from '../../src/wasm/js/servicesTierEngine';
import { servicesBackendStats, type CatchWasm } from '../../src/wasm/kernels/servicesBind';
import { installServicesTierEngine, type InstalledTierEngine } from '../../src/wasm/kernels/services';
import { WasmHeap } from '../../src/wasm/heap';
import { SIM_WASM_INITIAL_RESERVE } from '../../src/wasm/simWasm';
import { adoptLayers } from '../../src/wasm/layers';
import { deserializeCity, type SerializedCity } from '../../src/save/serialize';
import { unpackFile } from '../../src/save/bundle';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import type { ServicesSystem } from '../../src/sim/infra/services';
import type { CityState } from '../../src/sim/CityState';
import { schedulerOf } from '../../src/sim/infra/scheduler';
import { infoOf } from '../../src/sim/infra/common';
import { runAB, type AbOptions, type AbResult } from './ab';

// ------------------------------------------------------------------------------------------------ capture
export interface SlotCapture {
  k: number;
  name: string;
  shared: boolean;
  n: number;
  /** per facility (list order) */
  ids: Int32Array;
  str: Float64Array;
  op: Float64Array;
  cap: Float64Array;
  fs: Int32Array;
  fe: Int32Array;
  /** seat order (shared slots) */
  order: Int32Array;
  /** the slot's pool (indices / weights) and entry count */
  idx: Int32Array;
  w: Float32Array;
  poolN: number;
  entries: number;
  needL: Float32Array;
  C: number;
}

interface SvcLike {
  fac: { id: number }[][];
  facOp: number[][];
  facCap: number[][];
  shared: boolean[];
  cache: ({ idx: Int32Array; w: Float32Array; ent: Map<number, { start: number; end: number }> } | null)[];
  need: Float32Array[];
  provNeed: (Float32Array | null)[];
  order: Int32Array;
  seatOrder(k: number): void;
}

const NEED_RASTER = [0, 0, 1, 2, 3, 4, 5, 6];
export const SLOT_NAMES = ['police', 'fire', 'elementary', 'high', 'college', 'health', 'play', 'green', 'transit'];

/** capture every non-empty slot of an ORIGINAL ServicesSystem after a completed pass */
export function captureSlots(svc: unknown, C: number, strengthOf: (k: number, b: { id: number }) => number): SlotCapture[] {
  const s = svc as SvcLike;
  const out: SlotCapture[] = [];
  for (let k = 0; k < s.fac.length; k++) {
    const list = s.fac[k], cache = s.cache[k];
    if (!list.length || !cache) continue;
    const n = list.length;
    const ids = new Int32Array(n), str = new Float64Array(n), op = new Float64Array(n), cap = new Float64Array(n), fs = new Int32Array(n), fe = new Int32Array(n);
    let poolN = 0, entries = 0;
    for (let c = 0; c < n; c++) {
      const b = list[c];
      const e = cache.ent.get(b.id);
      ids[c] = b.id;
      str[c] = strengthOf(k, b);
      op[c] = s.facOp[k][c];
      cap[c] = s.facCap[k][c];
      fs[c] = e ? e.start : 0;
      fe[c] = e ? e.end : 0;
      if (e) { poolN = Math.max(poolN, e.end); entries += e.end - e.start; }
    }
    let order = new Int32Array(0);
    if (s.shared[k]) { s.seatOrder(k); order = s.order.slice(0, n); }
    const needL = k < 8 ? s.provNeed[k] ?? s.need[NEED_RASTER[k]] : s.need[0];
    out.push({
      k, name: SLOT_NAMES[k] ?? String(k), shared: s.shared[k], n, ids, str, op, cap, fs, fe, order, idx: cache.idx.slice(0, poolN), w: cache.w.slice(0, poolN),
      poolN, entries, needL: needL.slice(), C,
    });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ original loops
/** services.ts allocSeats (24f8609) arithmetic for a whole slot in seat order (record() bookkeeping excluded) */
export function origAllocSlot(s: SlotCapture, u: Float32Array, A: Float32Array, cov: Float32Array, sig: Float64Array, seat: Float64Array, Dout: Float64Array): void {
  const pIdx = s.idx, pW = s.w, needL = s.needL;
  for (let q = 0; q < s.n; q++) {
    const c = s.order[q];
    const s0 = s.fs[c], s1 = s.fe[c];
    sig[c] = 1; seat[c] = 0;
    if (s1 <= s0) { Dout[c] = 0; continue; }
    const st = s.str[c];
    let D = 0;
    for (let q2 = s0; q2 < s1; q2++) {
      const i = pIdx[q2];
      const a = pW[q2] * st;
      A[i] += a;
      const ui = u[i];
      D += needL[i] * (ui < a ? ui : a);
    }
    const op = s.op[c], S = s.cap[c];
    const sg = S < Infinity && D > S ? S / D : 1;
    const rho = sg * op;
    if (sg > 0) {
      for (let q2 = s0; q2 < s1; q2++) {
        const i = pIdx[q2];
        const a = pW[q2] * st;
        const ui = u[i];
        const e = ui < a ? ui : a;
        if (!(e > 0)) continue;
        const left = ui - e * sg;
        u[i] = left > 0 ? left : 0;
        cov[i] += e * rho;
      }
    }
    sig[c] = sg; seat[c] = D * sg; Dout[c] = D;
  }
}

/** services.ts splatUnion (24f8609) arithmetic for a whole slot in list order */
export function origUnionSlot(s: SlotCapture, A: Float32Array, cov: Float32Array, Dout: Float64Array, servedOut: Float64Array): void {
  const pIdx = s.idx, pW = s.w, needL = s.needL;
  for (let c = 0; c < s.n; c++) {
    const s0 = s.fs[c], s1 = s.fe[c];
    const st = s.str[c], op = s.op[c], S = s.cap[c];
    let D = 0;
    for (let q = s0; q < s1; q++) { const i = pIdx[q]; const w = pW[q]; D += needL[i] * w; A[i] += w; }
    const r = S < Infinity && D > S ? op * (S / D) : op;
    const eff = st * r;
    let served = 0;
    if (eff > 0) {
      for (let q = s0; q < s1; q++) {
        const i = pIdx[q];
        let v = pW[q] * eff;
        if (v > 1) v = 1;
        served += needL[i] * v;
        cov[i] = 1 - (1 - cov[i]) * (1 - v);
      }
    }
    Dout[c] = D; servedOut[c] = served;
  }
}

/** services.ts reportDemand (24f8609) for a whole slot (facilities with sig < 1) */
export function origReportSlot(s: SlotCapture, u: Float32Array, A: Float32Array, sig: Float64Array, seat: Float64Array, dem: Float64Array): void {
  const pIdx = s.idx, pW = s.w, needL = s.needL;
  for (let c = 0; c < s.n; c++) {
    const s0 = s.fs[c], s1 = s.fe[c];
    if (s1 <= s0 || !(sig[c] < 1)) continue;
    const st = s.str[c];
    let left = 0;
    for (let q = s0; q < s1; q++) {
      const i = pIdx[q];
      const n = needL[i];
      if (!(n > 0)) continue;
      const ui = u[i];
      if (!(ui > 0)) continue;
      const a = pW[q] * st;
      const Ai = A[i];
      left += n * (ui < a ? ui : a) * (Ai > a ? a / Ai : 1);
    }
    dem[c] = seat[c] + left;
  }
}

/** services.ts finalizeTier (24f8609) cell loops */
export function origFinalize(C: number, cov: Float32Array, layer: Float32Array, needL: Float32Array, A: Float32Array, out: Float64Array): void {
  for (let i = 0; i < C; i++) { const v = cov[i]; layer[i] = v < 1 ? v : 1; }
  let need = 0, served = 0, unreached = 0;
  for (let i = 0; i < C; i++) {
    const n = needL[i];
    if (n <= 0) continue;
    need += n;
    served += n * layer[i];
    if (A[i] <= 0) unreached += n;
  }
  out[0] = need; out[1] = served; out[2] = unreached;
}

// ------------------------------------------------------------------------------------------------ wasm replay state
/** one slot's replay data resident in a kernel instance's memory */
interface WasmSlot {
  w: CatchWasm;
  s: SlotCapture;
  p: Record<string, number>;
  ip: number;
  fp: number;
}

function place(w: CatchWasm, s: SlotCapture): WasmSlot {
  const h = w.heap;
  const n = Math.max(1, s.n), C = s.C;
  const p: Record<string, number> = {};
  const al = (bytes: number) => h.alloc(Math.max(16, bytes), 16);
  p.order = al(4 * n); p.fs = al(4 * n); p.fe = al(4 * n); p.str = al(8 * n); p.op = al(8 * n); p.cap = al(8 * n);
  p.idx = al(4 * Math.max(1, s.poolN)); p.w = al(4 * Math.max(1, s.poolN)); p.need = al(4 * C); p.needStage = al(4 * C);
  p.u = al(4 * C); p.A = al(4 * C); p.cov = al(4 * C); p.layer = al(4 * C);
  p.o1 = al(8 * n); p.o2 = al(8 * n); p.o3 = al(8 * n); p.ec = al(8 * C); p.ok = al(n);
  const b = () => w.memory.buffer;
  new Int32Array(b(), p.order, s.order.length).set(s.order);
  new Int32Array(b(), p.fs, s.n).set(s.fs); new Int32Array(b(), p.fe, s.n).set(s.fe);
  new Float64Array(b(), p.str, s.n).set(s.str); new Float64Array(b(), p.op, s.n).set(s.op); new Float64Array(b(), p.cap, s.n).set(s.cap);
  new Int32Array(b(), p.idx, s.poolN).set(s.idx); new Float32Array(b(), p.w, s.poolN).set(s.w);
  new Float32Array(b(), p.need, C).set(s.needL);
  return { w, s, p, ip: al(64 * 4), fp: al(16 * 8) };
}

function phaseBlock(ws: WasmSlot, pNeed: number, o1: number, o2: number, o3: number, ec: number, ecCap: number): void {
  const I = ws.w.heap.I32, F = ws.w.heap.F64, s = ws.s, p = ws.p;
  const ib = ws.ip >> 2, fb = ws.fp >> 3;
  I[ib] = s.n; I[ib + 1] = 0; I[ib + 2] = p.order; I[ib + 3] = p.fs; I[ib + 4] = p.fe; I[ib + 5] = p.str; I[ib + 6] = p.op; I[ib + 7] = p.cap;
  I[ib + 8] = p.idx; I[ib + 9] = p.w; I[ib + 10] = Math.max(1, s.poolN); I[ib + 11] = pNeed; I[ib + 12] = p.u; I[ib + 13] = p.A; I[ib + 14] = p.cov;
  I[ib + 15] = s.C; I[ib + 16] = o1; I[ib + 17] = o2; I[ib + 18] = o3; I[ib + 19] = ec; I[ib + 20] = ecCap;
  F[fb] = 0; F[fb + 1] = 0; F[fb + 2] = Infinity; F[fb + 3] = 0.25;
}

function resetCells(ws: WasmSlot, shared: boolean): void {
  const b = ws.w.memory.buffer, C = ws.s.C, p = ws.p;
  new Float32Array(b, p.A, C).fill(0);
  new Float32Array(b, p.cov, C).fill(0);
  if (shared) new Float32Array(b, p.u, C).fill(1);
}

// ------------------------------------------------------------------------------------------------ cases
export interface ReplayCase {
  name: string;
  /** slots in the case, entries processed */
  entries: number;
  run: () => void;
  /** outputs to compare with the original's (u32 patterns) */
  outputs: () => ArrayBufferView[];
}

function sameBits(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.byteLength !== b.byteLength) return false;
  if (a instanceof Float64Array && b instanceof Float64Array) {
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i]) && !(a[i] !== a[i] && b[i] !== b[i])) return false;
    return true;
  }
  if (a instanceof Float32Array && b instanceof Float32Array) {
    const ua = new Uint32Array(a.buffer, a.byteOffset, a.length), ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
    for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i] && !(a[i] !== a[i] && b[i] !== b[i])) return false;
    return true;
  }
  const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return false;
  return true;
}

/** the four replay families (alloc / union / report / finalize) for one implementation over all captured slots */
export interface Impl {
  label: string;
  alloc(): void;
  union(): void;
  report(): void;
  finalize(): void;
  /** outputs after the last run of each family */
  allocOut(): ArrayBufferView[];
  unionOut(): ArrayBufferView[];
  reportOut(): ArrayBufferView[];
  finalizeOut(): ArrayBufferView[];
}

/** original-JS implementation (the services.ts loops on the captured arrays) */
export function origImpl(slots: SlotCapture[]): Impl {
  const C = slots[0]?.C ?? 0;
  const shared = slots.filter((s) => s.shared), union = slots.filter((s) => !s.shared);
  const u = new Float32Array(C), A = new Float32Array(C), cov = new Float32Array(C), layer = new Float32Array(C);
  const st = new Map<SlotCapture, { sig: Float64Array; seat: Float64Array; D: Float64Array; served: Float64Array; dem: Float64Array; u: Float32Array; A: Float32Array; cov: Float32Array; fin: Float64Array; layer: Float32Array }>();
  for (const s of slots) st.set(s, { sig: new Float64Array(s.n), seat: new Float64Array(s.n), D: new Float64Array(s.n), served: new Float64Array(s.n), dem: new Float64Array(s.n), u: new Float32Array(C), A: new Float32Array(C), cov: new Float32Array(C), fin: new Float64Array(3), layer: new Float32Array(C) });
  const alloc = () => { for (const s of shared) { const x = st.get(s)!; u.fill(1); A.fill(0); cov.fill(0); origAllocSlot(s, u, A, cov, x.sig, x.seat, x.D); x.u.set(u); x.A.set(A); x.cov.set(cov); } };
  const unionF = () => { for (const s of union) { const x = st.get(s)!; A.fill(0); cov.fill(0); origUnionSlot(s, A, cov, x.D, x.served); x.A.set(A); x.cov.set(cov); } };
  alloc(); unionF();
  return {
    label: 'original JS',
    alloc: () => { for (const s of shared) { const x = st.get(s)!; u.fill(1); A.fill(0); cov.fill(0); origAllocSlot(s, u, A, cov, x.sig, x.seat, x.D); } },
    union: () => { for (const s of union) { const x = st.get(s)!; A.fill(0); cov.fill(0); origUnionSlot(s, A, cov, x.D, x.served); } },
    report: () => { for (const s of shared) { const x = st.get(s)!; origReportSlot(s, x.u, x.A, x.sig, x.seat, x.dem); } },
    finalize: () => { for (const s of slots) { const x = st.get(s)!; origFinalize(C, x.cov, x.layer, s.needL, x.A, x.fin); } },
    allocOut: () => { alloc(); return shared.flatMap((s) => { const x = st.get(s)!; return [x.sig, x.seat, x.D, x.u, x.A, x.cov]; }); },
    unionOut: () => { unionF(); return union.flatMap((s) => { const x = st.get(s)!; return [x.D, x.served, x.A, x.cov]; }); },
    reportOut: () => shared.map((s) => { const x = st.get(s)!; origReportSlot(s, x.u, x.A, x.sig, x.seat, x.dem); return maskDem(s, x.sig, x.dem); }),
    finalizeOut: () => slots.flatMap((s) => { const x = st.get(s)!; origFinalize(C, x.cov, x.layer, s.needL, x.A, x.fin); return [x.layer.slice(), x.fin.slice()]; }),
  };
}

/** dem of the crowded facilities only (others are not written by reportDemand) */
function maskDem(s: SlotCapture, sig: Float64Array, dem: Float64Array): Float64Array {
  const o = new Float64Array(s.n);
  for (let c = 0; c < s.n; c++) o[c] = s.fe[c] > s.fs[c] && sig[c] < 1 ? dem[c] : 0;
  return o;
}

/** fair-JS implementation (servicesTierEngine.ts kernels; e-cache alloc) */
export function fairImpl(slots: SlotCapture[]): Impl {
  const C = slots[0]?.C ?? 0;
  const shared = slots.filter((s) => s.shared), union = slots.filter((s) => !s.shared);
  const ec = new Float64Array(C);
  const st = new Map<SlotCapture, { a: PhaseArgs; fin: Float64Array; layer: Float32Array }>();
  for (const s of slots) {
    const a: PhaseArgs = {
      k: s.k, nFac: s.n, cursor: 0, order: s.order, fs: s.fs, fe: s.fe, str: s.str, op: s.op, cap: s.cap, idx: s.idx, w: s.w, need: s.needL,
      u: new Float32Array(C), A: new Float32Array(C), cov: new Float32Array(C), o1: new Float64Array(s.n), o2: new Float64Array(s.n), o3: new Float64Array(s.n),
      ec, ok: new Uint8Array(s.n), work: 0, left: 0, limit: Infinity,
    };
    st.set(s, { a, fin: new Float64Array(3), layer: new Float32Array(C) });
  }
  const sig = new Map<SlotCapture, Float64Array>(), seat = new Map<SlotCapture, Float64Array>(), dem = new Map<SlotCapture, Float64Array>();
  for (const s of shared) { sig.set(s, new Float64Array(s.n)); seat.set(s, new Float64Array(s.n)); dem.set(s, new Float64Array(s.n)); }
  const alloc = () => {
    for (const s of shared) {
      const a = st.get(s)!.a;
      a.u.fill(1); a.A.fill(0); a.cov.fill(0); a.cursor = 0; a.work = 0; a.left = 0;
      a.o1 = sig.get(s)!; a.o2 = seat.get(s)!; a.o3 = st.get(s)!.a.o3;
      allocJS(a);
    }
  };
  const union1 = () => {
    for (const s of union) {
      const a = st.get(s)!.a;
      a.A.fill(0); a.cov.fill(0); a.cursor = 0; a.work = 0; a.left = 0;
      unionJS(a);
    }
  };
  const report1 = () => {
    for (const s of shared) {
      const a = st.get(s)!.a;
      a.cursor = 0; a.work = 0; a.left = 0;
      const o3 = a.o3;
      a.o1 = sig.get(s)!; a.o2 = seat.get(s)!; a.o3 = dem.get(s)!;
      reportJS(a);
      a.o3 = o3;
    }
  };
  alloc(); union1();
  return {
    label: 'fair JS',
    alloc, union: union1, report: report1,
    finalize: () => { for (const s of slots) { const x = st.get(s)!; finalizeJS(C, x.a.cov, x.layer, false, s.needL, x.a.A, x.fin); } },
    allocOut: () => { alloc(); return shared.flatMap((s) => { const a = st.get(s)!.a; return [sig.get(s)!, seat.get(s)!, a.o3, a.u, a.A, a.cov]; }); },
    unionOut: () => { union1(); return union.flatMap((s) => { const a = st.get(s)!.a; return [a.o1, a.o2, a.A, a.cov]; }); },
    reportOut: () => { report1(); return shared.map((s) => maskDem(s, sig.get(s)!, dem.get(s)!)); },
    finalizeOut: () => slots.flatMap((s) => { const x = st.get(s)!; finalizeJS(C, x.a.cov, x.layer, false, s.needL, x.a.A, x.fin); return [x.layer.slice(), x.fin.slice()]; }),
  };
}

/** wasm implementation on one binary (slot data resident; `stageNeed`: copy the need raster in per slot and call) */
export function wasmImpl(w: CatchWasm, slots: SlotCapture[], label: string, stageNeed = false): Impl {
  const shared = slots.filter((s) => s.shared), union = slots.filter((s) => !s.shared);
  const ws = new Map<SlotCapture, WasmSlot>();
  for (const s of slots) ws.set(s, place(w, s));
  const ex = w.ex;
  const need = (x: WasmSlot) => {
    if (!stageNeed) return x.p.need;
    new Float32Array(x.w.memory.buffer, x.p.needStage, x.s.C).set(x.s.needL);
    return x.p.needStage;
  };
  // report reads the post-alloc u / A: keep a copy per slot
  const postU = new Map<SlotCapture, number>(), postA = new Map<SlotCapture, number>();
  const alloc = () => {
    for (const s of shared) {
      const x = ws.get(s)!;
      resetCells(x, true);
      phaseBlock(x, need(x), x.p.o1, x.p.o2, x.p.o3, x.p.ec, s.C);
      ex.catch_alloc(x.ip, x.fp);
    }
  };
  const union1 = () => {
    for (const s of union) {
      const x = ws.get(s)!;
      resetCells(x, false);
      phaseBlock(x, need(x), x.p.o1, x.p.o2, x.p.o3, x.p.ec, s.C);
      ex.catch_union(x.ip, x.fp);
    }
  };
  alloc(); union1();
  for (const s of shared) {
    const x = ws.get(s)!, h = w.heap;
    const pu = h.alloc(4 * s.C, 16), pa = h.alloc(4 * s.C, 16), pdem = h.alloc(8 * Math.max(1, s.n), 16);
    new Float32Array(w.memory.buffer, pu, s.C).set(new Float32Array(w.memory.buffer, x.p.u, s.C));
    new Float32Array(w.memory.buffer, pa, s.C).set(new Float32Array(w.memory.buffer, x.p.A, s.C));
    postU.set(s, pu); postA.set(s, pa);
    x.p.dem = pdem;
  }
  const report1 = () => {
    for (const s of shared) {
      const x = ws.get(s)!;
      phaseBlock(x, need(x), x.p.o1, x.p.o2, x.p.dem, x.p.ok, s.n);
      const I = w.heap.I32, ib = x.ip >> 2;
      I[ib + 12] = postU.get(s)!; I[ib + 13] = postA.get(s)!;
      ex.catch_report(x.ip, x.fp);
    }
  };
  const fin = (s: SlotCapture) => {
    const x = ws.get(s)!, I = w.heap.I32, ib = x.ip >> 2;
    I[ib] = s.C; I[ib + 1] = x.p.cov; I[ib + 2] = x.p.layer; I[ib + 3] = 0; I[ib + 4] = need(x); I[ib + 5] = x.p.A;
    ex.catch_finalize(x.ip, x.fp);
  };
  const v = <T extends ArrayBufferView>(C: new (b: ArrayBuffer, o: number, n: number) => T, p: number, n: number): T => new C(w.memory.buffer, p, n);
  return {
    label,
    alloc, union: union1, report: report1,
    finalize: () => { for (const s of slots) fin(s); },
    allocOut: () => { alloc(); return shared.flatMap((s) => { const x = ws.get(s)!; return [v(Float64Array, x.p.o1, s.n).slice(), v(Float64Array, x.p.o2, s.n).slice(), v(Float64Array, x.p.o3, s.n).slice(), v(Float32Array, x.p.u, s.C).slice(), v(Float32Array, x.p.A, s.C).slice(), v(Float32Array, x.p.cov, s.C).slice()]; }); },
    unionOut: () => { union1(); return union.flatMap((s) => { const x = ws.get(s)!; return [v(Float64Array, x.p.o1, s.n).slice(), v(Float64Array, x.p.o2, s.n).slice(), v(Float32Array, x.p.A, s.C).slice(), v(Float32Array, x.p.cov, s.C).slice()]; }); },
    reportOut: () => { report1(); return shared.map((s) => { const x = ws.get(s)!; return maskDem(s, v(Float64Array, x.p.o1, s.n), v(Float64Array, x.p.dem, s.n)); }); },
    finalizeOut: () => slots.flatMap((s) => { fin(s); const x = ws.get(s)!, F = w.heap.F64; return [v(Float32Array, x.p.layer, s.C).slice(), new Float64Array([F[x.fp >> 3], F[(x.fp >> 3) + 1], F[(x.fp >> 3) + 2]])]; }),
  };
}

/** compare an implementation's outputs with the original's; returns the mismatch labels */
export function checkImpl(ref: Impl, x: Impl): string[] {
  const bad: string[] = [];
  const fam: [string, () => ArrayBufferView[], () => ArrayBufferView[]][] = [
    ['alloc', ref.allocOut, x.allocOut], ['union', ref.unionOut, x.unionOut], ['report', ref.reportOut, x.reportOut], ['finalize', ref.finalizeOut, x.finalizeOut],
  ];
  for (const [name, a, b] of fam) {
    const ra = a(), rb = b();
    if (ra.length !== rb.length) { bad.push(`${name}: ${ra.length} vs ${rb.length} outputs`); continue; }
    for (let j = 0; j < ra.length; j++) if (!sameBits(ra[j], rb[j])) bad.push(`${name}: output ${j}`);
  }
  return bad;
}

/** interleaved A/B of every family: A = `a`, B = `b` */
export function replayAB(a: Impl, b: Impl, slots: SlotCapture[], opts: AbOptions, log: (s: string) => void): AbResult[] {
  const shared = slots.filter((s) => s.shared), union = slots.filter((s) => !s.shared);
  const eS = shared.reduce((p, s) => p + s.entries, 0), eU = union.reduce((p, s) => p + s.entries, 0);
  const out: AbResult[] = [];
  const fams: [string, () => void, () => void, number][] = [
    [`alloc, ${shared.length} shared slots (${eS} entries)`, a.alloc, b.alloc, eS],
    [`union, ${union.length} union slots (${eU} entries)`, a.union, b.union, eU],
    [`report, ${shared.length} shared slots`, a.report, b.report, eS],
    [`finalize, ${slots.length} slots`, a.finalize, b.finalize, 0],
  ];
  for (const [name, fa, fb, entries] of fams) {
    if (name.startsWith('union') && union.length === 0) continue;
    const r = runAB({ name: `${name}: ${a.label} vs ${b.label}`, a: fa, b: fb, aLabel: a.label, bLabel: b.label }, opts);
    (r as AbResult & { entries?: number }).entries = entries;
    out.push(r);
    log(`${r.name.padEnd(70)} ${fmt(r.a.median)} vs ${fmt(r.b.median)}  speedup ${r.speedup.median.toFixed(2)}x [${r.speedup.lo.toFixed(2)}, ${r.speedup.hi.toFixed(2)}]` +
      (entries ? `  (${(1e6 * r.a.median / entries).toFixed(1)} / ${(1e6 * r.b.median / entries).toFixed(1)} ns per entry)` : '') +
      `  min ${fmt(r.a.min)} vs ${fmt(r.b.min)} = ${(r.a.min / r.b.min).toFixed(2)}x`);
  }
  return out;
}

const fmt = (ms: number): string => (ms >= 1 ? ms.toFixed(2) + ' ms' : (ms * 1000).toFixed(0) + ' µs');

// ------------------------------------------------------------------------------------------------ benchmark arms
export type ArmKind = 'orig' | 'fair' | 'wasm' | 'scalar' | 'resident' | 'staged';
/** replay arms: orig / fair / wasm (resident slot data) / staged (need raster copied in per call) / scalar */
export const REPLAY_FAMILIES = ['alloc', 'union', 'report', 'finalize'] as const;
export type ReplayFamily = (typeof REPLAY_FAMILIES)[number];

export interface ArmConfig {
  kind: ArmKind;
  /** 'replay': captured slots + phase kernels only; 'sim': the full simulation (passes, in situ) */
  group: 'replay' | 'sim';
  /** .metropolis file bytes */
  fixture: Uint8Array;
  /** the binary of a wasm arm (pre-sized: it must never grow) */
  wasm: Uint8Array | null;
  /** 'invalidated': detach an ArrayBuffer first, like the game's main thread after lodBuilder's first transfer */
  protector: 'intact' | 'invalidated';
  /** CPU time (node arm process) or wall clock (browser worker), ms */
  clock: () => number;
}

/** per-sample CPU ms of the services methods (instance wrappers, identical on every arm) */
export interface ArmSample {
  ms: number;
  /** services = every services step; engine = tierWork + finishTransit + footprints + finish (what the port replaces
   *  besides the access fields); access = accessCommuteLand + shopLand; passes = completed passes */
  services: number;
  engine: number;
  tier: number;
  prep: number;
  access: number;
  passes: number;
  day: number;
}

const TIMED = ['step', 'prep', 'tierWork', 'finishTransit', 'footprints', 'finish', 'accessCommuteLand', 'shopLand'] as const;

/**
 * V8's ArrayBuffer-detaching protector, observed through an optimized typed-array loop: code optimized while the
 * protector holds depends on it and deoptimizes when it is invalidated. null when natives syntax is not enabled
 * (node --allow-natives-syntax / chromium --js-flags=--allow-natives-syntax).
 */
export function makeProtectorProbe(): (() => boolean) | null {
  try {
    const ta = new Float32Array(64);
    const probe = new Function('a', 'let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s;') as (a: Float32Array) => number;
    const prep = new Function('f', 'a', '%PrepareFunctionForOptimization(f); f(a); f(a); %OptimizeFunctionOnNextCall(f); f(a);') as (f: unknown, a: unknown) => void;
    const status = new Function('f', 'return %GetOptimizationStatus(f);') as (f: unknown) => number;
    prep(probe, ta);
    const s0 = status(probe);
    return () => { probe(ta); return status(probe) === s0; };
  } catch {
    return null;
  }
}

/** detach an ArrayBuffer (invalidates the protector for this isolate) */
export function invalidateProtector(): void {
  const b = new ArrayBuffer(8) as ArrayBuffer & { transfer?: () => ArrayBuffer };
  if (typeof b.transfer === 'function') b.transfer();
  else structuredClone(b, { transfer: [b] });
}

/** a kernel instance from bytes, with the loader's start-up reserve (no memory.grow on the pre-sized binary) */
export function instanceFrom(bytes: Uint8Array): CatchWasm {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes as Uint8Array<ArrayBuffer>), {});
  const ex = inst.exports as unknown as CatchWasm['ex'] & { memory: WebAssembly.Memory; __heap_base: WebAssembly.Global };
  const heap = new WasmHeap(ex.memory, Number(ex.__heap_base.value));
  heap.reserve(SIM_WASM_INITIAL_RESERVE);
  return { ex, memory: ex.memory, heap };
}

function fnv(h: number, b: Uint8Array): number {
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619) >>> 0;
  return h;
}
const viewBytes = (v: ArrayBufferView): Uint8Array => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
const BY_ID = ['tierById', 'capById', 'demById', 'servById', 'seatById', 'opById', 'utilById', 'powById', 'seenById'];

/** FNV-1a over every typed-array layer of the state, stats, buildings and the services per-facility data */
export function cityHash(st: CityState, svc: ServicesSystem): string {
  let h = 0x811c9dc5 >>> 0;
  const o = st as unknown as Record<string, unknown>;
  for (const k of Object.keys(o).sort()) {
    const v = o[k];
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) h = fnv(h, viewBytes(v));
    else if (Array.isArray(v) && v.length && v.every((x) => ArrayBuffer.isView(x))) for (const x of v as ArrayBufferView[]) h = fnv(h, viewBytes(x));
  }
  const enc = new TextEncoder();
  h = fnv(h, enc.encode(JSON.stringify(st.stats)));
  const bl: number[] = [];
  for (const b of st.buildings.values()) { const x = b as unknown as Record<string, number>; bl.push(b.id, b.x, b.z, b.w, b.d, b.pop ?? 0, x.jobs ?? 0, b.flags, x.capacity ?? 0); }
  h = fnv(h, viewBytes(Float64Array.from(bl)));
  const p = svc as unknown as Record<string, unknown>;
  for (const f of BY_ID) h = fnv(h, viewBytes(p[f] as Float32Array));
  h = fnv(h, enc.encode(JSON.stringify(p.tierStats)));
  return `${h.toString(16).padStart(8, '0')}/day${st.day}/pop${Math.round((st.stats as unknown as { population?: number }).population ?? 0)}`;
}

/** one A/B arm: built from a fixture, then driven command by command (each command timed with the arm's clock) */
export class BenchArm {
  readonly cfg: ArmConfig;
  st!: CityState;
  sim!: Simulation;
  svc!: ServicesSystem;
  inst: InstalledTierEngine | null = null;
  w: CatchWasm | null = null;
  impl: Impl | null = null;
  slots: SlotCapture[] = [];
  readonly probe = makeProtectorProbe();
  private readonly acc: Record<string, number> = {};
  private calls = 0;

  private constructor(cfg: ArmConfig) {
    this.cfg = cfg;
  }

  static async create(cfg: ArmConfig): Promise<BenchArm> {
    const a = new BenchArm(cfg);
    if (cfg.protector === 'invalidated') invalidateProtector();
    const st = deserializeCity((await unpackFile(cfg.fixture)) as SerializedCity);
    const wasmKind = cfg.kind === 'wasm' || cfg.kind === 'scalar' || cfg.kind === 'resident' || cfg.kind === 'staged';
    if (wasmKind) {
      if (!cfg.wasm) throw new Error(`${cfg.kind}: no wasm binary`);
      a.w = instanceFrom(cfg.wasm);
    }
    if (cfg.group === 'replay') {
      // capture the slots from one ORIGINAL pass (every arm: deterministic), then this arm's implementation
      const sim = new Simulation(st, createSystems());
      const svc = sim.getSystem<ServicesSystem>('services')!;
      svc.compute(sim, false);
      a.st = st; a.sim = sim; a.svc = svc;
      a.slots = captureSlots(svc, st.cells, (k, b) => (k === 8 ? infoOf(st, b as never).covStrength : infoOf(st, b as never).tierStrength));
      const ref = origImpl(a.slots);
      a.impl = cfg.kind === 'orig' ? ref : cfg.kind === 'fair' ? fairImpl(a.slots)
        : wasmImpl(a.w!, a.slots, cfg.kind === 'staged' ? 'wasm SIMD, need raster staged per call' : cfg.kind, cfg.kind === 'staged');
      if (a.impl !== ref) {
        const bad = checkImpl(ref, a.impl);
        if (bad.length) throw new Error(`${cfg.kind}: replay outputs differ from the original: ${bad.slice(0, 5).join('; ')}`);
      }
      return a;
    }
    const systems = createSystems();
    const svc = systems.find((s) => s.name === 'services') as ServicesSystem;
    if (cfg.kind !== 'orig') a.inst = installServicesTierEngine(svc, { backend: cfg.kind === 'fair' ? 'js' : 'wasm', wasm: a.w ?? undefined });
    if (a.inst && a.inst.backend !== (cfg.kind === 'fair' ? 'js' : 'wasm')) throw new Error(`${cfg.kind}: got the ${a.inst.backend} backend`);
    const sim = new Simulation(st, systems);
    if (cfg.kind === 'resident') {
      // the memory model's resident case: CityState layers + the services need rasters live in wasm memory
      adoptLayers(st, a.w!.heap);
      adoptLayers(svc, a.w!.heap, { include: (k) => k === 'need' });
    }
    a.st = st; a.sim = sim; a.svc = svc;
    a.instrument();
    return a;
  }

  /** CPU wrappers on the services methods (installed after the engine: they wrap its overrides) */
  private instrument(): void {
    const svc = this.svc as unknown as Record<string, (...x: unknown[]) => unknown>;
    const clock = this.cfg.clock, acc = this.acc;
    for (const m of TIMED) {
      acc[m] = 0;
      const f = svc[m];
      svc[m] = function (this: unknown, ...x: unknown[]) {
        const t0 = clock();
        try { return f.apply(this, x); } finally { acc[m] += clock() - t0; }
      };
    }
  }

  private sample(ms: number, days: number): ArmSample {
    const a = this.acc, d = Math.max(1, days);
    const s: ArmSample = {
      ms: ms / d, services: a.step / d, engine: (a.tierWork + a.finishTransit + a.footprints + a.finish) / d, tier: a.tierWork / d, prep: a.prep / d,
      access: (a.accessCommuteLand + a.shopLand) / d, passes: (this.svc as unknown as { donePasses: number }).donePasses - this.calls, day: this.st.day,
    };
    this.calls = (this.svc as unknown as { donePasses: number }).donePasses;
    for (const k of Object.keys(a)) a[k] = 0;
    return s;
  }

  /** one services pass (cold: every road reach searched fresh) */
  pass(cold: boolean): ArmSample {
    for (const k of Object.keys(this.acc)) this.acc[k] = 0;
    this.calls = (this.svc as unknown as { donePasses: number }).donePasses;
    const t0 = this.cfg.clock();
    if (cold) (this.svc as unknown as { invalidateReach(r: unknown): void }).invalidateReach(undefined);
    this.svc.compute(this.sim, false);
    return this.sample(this.cfg.clock() - t0, 1);
  }

  /** n days at design cadence (advanceDay + scheduler flush); per-day sample */
  days(n: number): ArmSample {
    for (const k of Object.keys(this.acc)) this.acc[k] = 0;
    this.calls = (this.svc as unknown as { donePasses: number }).donePasses;
    const t0 = this.cfg.clock();
    for (let d = 0; d < n; d++) { this.sim.advanceDay(); schedulerOf(this.sim).flush(this.sim); }
    return this.sample(this.cfg.clock() - t0, n);
  }

  /** `inner` calls of one replay family; ms per call */
  replay(family: ReplayFamily, inner: number): number {
    const f = this.impl![family];
    const t0 = this.cfg.clock();
    for (let i = 0; i < inner; i++) f();
    return (this.cfg.clock() - t0) / inner;
  }

  hash(): string {
    return cityHash(this.st, this.svc);
  }

  info(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      kind: this.cfg.kind, group: this.cfg.group, protectorIntact: this.probe ? this.probe() : null, pop: (this.st.stats as unknown as { population: number }).population,
      day: this.st.day,
    };
    if (this.w) out.wasmHeap = this.w.heap.stats();
    if (this.inst) {
      const e = this.inst.engine;
      out.engine = { backend: this.inst.backend, active: this.inst.active, kernels: e.kernels.name, stats: { ...e.stats }, pool: e.poolInfo(), calls: servicesBackendStats(e), liveBytes: e.space.liveBytes?.() ?? 0 };
    }
    if (this.slots.length) out.slots = this.slots.map((s) => ({ slot: s.name, facilities: s.n, entries: s.entries, shared: s.shared }));
    return out;
  }
}
