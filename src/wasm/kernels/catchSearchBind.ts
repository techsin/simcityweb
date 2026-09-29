/**
 * WebAssembly bindings for the cell-grid road searches of src/sim/infra/catchments.ts (Rust: search.rs
 * road_time_multi / road_dist_multi): roadTimeMulti (services accessCommute: linear Dial, integer NET_TIME_Q / RAMP_Q
 * costs, 34k buckets over 65k cells) and roadDistMulti (services shopAccess: 8-slot circular Dial, WALK / DRIVE_COST).
 * Same signatures, bit-identical outputs (`out` labels and the settled count). JS runs whenever the 'search' kernel
 * slot is inactive or the arguments leave the validated domain: integer costs in [0, 2^20], integer limits, seeds
 * inside the map, network values covered by the cost table.
 *
 * Staging per call: st.network (C bytes) and `out` (C i32, in and out) unless they live in wasm memory; the queue in
 * reserved scratch (roadTimeMulti: limitQ + 1 heads, 2 x 5C entries). The JS originals' module-level engine state
 * (ReachEngine arrays, bucket heads) only caches capacity, so skipping it is unobservable.
 *
 * This file does not import catchments.ts (kernels/catchSearch.ts binds the live module).
 */
import type { CityState } from '../../sim/CityState';
import { simWasmCallFailed, type SimWasmInstance } from '../simWasm';
import { scratchSlot, type WasmHeap } from '../heap';
import { SEARCH_KERNEL, block } from './searchShared';

export interface CatchSearchApi {
  roadTimeMulti(st: CityState, out: Int32Array, limitQ: number, netTimeQ: readonly number[], rampQ: number): number;
  roadDistMulti(st: CityState, metric: number, seeds: Int32Array, nSeeds: number, maxQ: number, out: Int32Array): number;
}

export interface CatchSearchParams {
  WALK_COST: readonly number[];
  DRIVE_COST: readonly number[];
  RAMP_COST: number;
  /** Network.Highway / Network.Street */
  HIGHWAY: number;
  STREET: number;
}

interface CatchExports {
  search_road_time_multi(nSide: number, net: number, out: number, limitQ: number, cost: number, costLen: number, rampQ: number, hw: number, street: number, head: number, headLen: number, ent: number, ecap: number): number;
  search_road_dist_multi(nSide: number, net: number, seeds: number, ns: number, maxQ: number, cost: number, costLen: number, drive: number, ramp: number, hw: number, street: number, out: number, outLen: number, head8: number, ent: number, ecap: number): number;
}


export const catchSearchStats = { timeWasm: 0, timeJs: 0, distWasm: 0, distJs: 0 };

const S_NET = scratchSlot(), S_OUT = scratchSlot(), S_HEAD = scratchSlot(), S_ENT = scratchSlot(), S_COST = scratchSlot(), S_SEED = scratchSlot(), S_H8 = scratchSlot();
const LIM = 1 << 20;
const isInt = (v: number) => v === (v | 0);

/** a cost table as Int32 when every entry is an integer in [0, LIM] (null otherwise) */
function costTable(cache: WeakMap<readonly number[], Int32Array | null>, t: readonly number[]): Int32Array | null {
  let c = cache.get(t);
  if (c === undefined) {
    c = t.length > 0 && t.length <= 256 && t.every((v) => typeof v === 'number' && isInt(v) && v >= 0 && v <= LIM) ? Int32Array.from(t) : null;
    cache.set(t, c);
  }
  return c;
}

export function makeCatchmentSearchKernels(js: CatchSearchApi, p: CatchSearchParams, opts: { instance?: () => SimWasmInstance | null } = {}): CatchSearchApi {
  const inst = opts.instance ?? (() => SEARCH_KERNEL.instance());
  const tables = new WeakMap<readonly number[], Int32Array | null>();
  const walk = costTable(tables, p.WALK_COST), drive = costTable(tables, p.DRIVE_COST);
  const rampOk = isInt(p.RAMP_COST) && p.RAMP_COST >= 0 && p.RAMP_COST <= LIM;

  function stageNet(h: WasmHeap, net: Uint8Array, C: number): number {
    const own = h.ptrOf(net);
    if (own >= 0) return own;
    const q = block(h, S_NET, C);
    h.U8.set(net.length === C ? net : net.subarray(0, C), q);
    return q;
  }
  function stageTable(h: WasmHeap, t: Int32Array): number {
    const q = block(h, S_COST, t.length * 4);
    h.I32.set(t, q >> 2);
    return q;
  }

  function roadTimeMulti(st: CityState, out: Int32Array, limitQ: number, netTimeQ: readonly number[], rampQ: number): number {
    const w = inst();
    const N = st.size, C = st.cells;
    const table = w === null ? null : costTable(tables, netTimeQ);
    if (
      w === null || table === null || !isInt(N) || N < 1 || C !== N * N || !(st.network instanceof Uint8Array) || st.network.length < C ||
      !(out instanceof Int32Array) || out.length < C || !isInt(limitQ) || limitQ < 0 || limitQ > 1 << 24 || !isInt(rampQ) || rampQ < 0 || rampQ > LIM
    ) {
      catchSearchStats.timeJs++;
      return js.roadTimeMulti(st, out, limitQ, netTimeQ, rampQ);
    }
    const h = w.heap, ex = w.exports as unknown as CatchExports;
    try {
      const pHead = block(h, S_HEAD, (limitQ + 1) * 4);
      const ecap = 10 * C + 16;
      const pEnt = block(h, S_ENT, ecap * 4);
      const own = h.ptrOf(out);
      const pOut = own >= 0 ? own : block(h, S_OUT, C * 4);
      const pNet = stageNet(h, st.network, C);
      const pCost = stageTable(h, table);
      if (own < 0) h.I32.set(out.length === C ? out : out.subarray(0, C), pOut >> 2);
      const r = ex.search_road_time_multi(N, pNet, pOut, limitQ, pCost, table.length, rampQ, p.HIGHWAY, p.STREET, pHead, limitQ + 1, pEnt, ecap);
      if (r === -5) {
        // a network value the cost table does not cover: JS semantics (undefined costs)
        catchSearchStats.timeJs++;
        return js.roadTimeMulti(st, out, limitQ, netTimeQ, rampQ);
      }
      if (r < 0) throw new Error(`search_road_time_multi returned ${r}`);
      if (own < 0) out.set(new Int32Array(h.memory.buffer, pOut, C));
      catchSearchStats.timeWasm++;
      return r;
    } catch (e) {
      simWasmCallFailed('search', e);
      catchSearchStats.timeJs++;
      return js.roadTimeMulti(st, out, limitQ, netTimeQ, rampQ);
    }
  }

  function roadDistMulti(st: CityState, metric: number, seeds: Int32Array, nSeeds: number, maxQ: number, out: Int32Array): number {
    const w = inst();
    const N = st.size, C = st.cells;
    const table = metric === 0 ? walk : drive;
    let ok = w !== null && table !== null && rampOk && isInt(N) && N >= 1 && C === N * N && st.network instanceof Uint8Array && st.network.length >= C &&
      out instanceof Int32Array && out.length >= C && seeds instanceof Int32Array && isInt(nSeeds) && nSeeds >= 0 && nSeeds <= seeds.length &&
      typeof maxQ === 'number';
    if (ok) for (let s = 0; s < nSeeds; s++) if (!(seeds[s] >= 0 && seeds[s] < C)) { ok = false; break; }
    if (!ok) {
      catchSearchStats.distJs++;
      return js.roadDistMulti(st, metric, seeds, nSeeds, maxQ, out);
    }
    const h = w!.heap, ex = w!.exports as unknown as CatchExports;
    // integer labels: `nd > maxQ` == `nd > floor(maxQ)`; NaN / huge never cut, -huge always cuts
    const mq = maxQ !== maxQ || maxQ >= 2 ** 30 ? 2 ** 30 : maxQ <= -(2 ** 30) ? -(2 ** 30) : Math.floor(maxQ);
    try {
      const L = out.length;
      const ecap = 2 * (nSeeds + 4 * C) + 16;
      const pEnt = block(h, S_ENT, ecap * 4);
      const pH8 = block(h, S_H8, 32);
      const own = h.ptrOf(out);
      const pOut = own >= 0 ? own : block(h, S_OUT, L * 4);
      const pSeed = block(h, S_SEED, nSeeds * 4);
      const pNet = stageNet(h, st.network, C);
      const pCost = stageTable(h, table!);
      if (nSeeds > 0) h.I32.set(seeds.subarray(0, nSeeds), pSeed >> 2);
      const r = ex.search_road_dist_multi(N, pNet, pSeed, nSeeds, mq, pCost, table!.length, metric === 1 ? 1 : 0, p.RAMP_COST, p.HIGHWAY, p.STREET, pOut, L, pH8, pEnt, ecap);
      if (r === -5) {
        catchSearchStats.distJs++;
        return js.roadDistMulti(st, metric, seeds, nSeeds, maxQ, out);
      }
      if (r < 0) throw new Error(`search_road_dist_multi returned ${r}`);
      if (own < 0) out.set(new Int32Array(h.memory.buffer, pOut, L));
      catchSearchStats.distWasm++;
      return r;
    } catch (e) {
      simWasmCallFailed('search', e);
      catchSearchStats.distJs++;
      return js.roadDistMulti(st, metric, seeds, nSeeds, maxQ, out);
    }
  }

  return { roadTimeMulti, roadDistMulti };
}
