/**
 * Installs the services tier engine (src/wasm/js/servicesTierEngine.ts, with the wasm kernels of servicesBind.ts or
 * the restructured JS ones) into a LIVE ServicesSystem instance, without editing src/sim: the private methods that
 * make up the tier engine are overridden on the instance (TS private methods are ordinary prototype methods at
 * runtime), everything else of the system keeps running as is.
 *
 *   const systems = createSystems();
 *   const svc = installServicesTierEngine(systems.find((s) => s.name === 'services') as ServicesSystem);   // before new Simulation()
 *   const sim = new Simulation(state, systems);
 *   ...
 *   svc.dispose();   // city unload / scene dispose (or disposeServicesTierEngine(system)): frees the engine's wasm memory
 *
 * Overridden (ported to the engine; bit-identical results, identical scheduler step boundaries):
 *   tierWork          P_INIT / P_SEARCH (reachOf + splatUnion) / P_ALLOC / P_REPORT / P_FINAL as engine batches
 *   prep              the original prep (need rasters, facility lists, op factors stay JS), then the work estimate is
 *                     recomputed from the engine's cache records (same terms and order as services.ts)
 *   invalidateReach   the original (netEvents) + the engine's typed records
 *   finishTransit     stop list + stop rules in JS (collectStops, def-coverage / serving skips, radius by mode), the
 *                     coverage disks + combine in the kernel
 *   footprints        the max / fill loops in the kernel
 *   finish            the legacy-combo loop in the kernel, the rest verbatim (per-building stats.needs pass, stale
 *                     records, EQ / HQ)
 *   accessCommuteLand, shopLand   chamfer / block sums / box3 / bilinear taps in the kernel, building walks in JS
 * Install BEFORE the Simulation is constructed (init runs the first pass): both engines then start from empty caches,
 * so the work estimates — and with them the scheduler — match the original exactly.
 *
 * Staged inputs: every installed step method starts a new staging step (kernels.beginStep), so a network / water copy
 * is never reused across scheduler steps (road edits happen between steps); the access-field chamfer always re-copies.
 *
 * Lifecycle / memory: the engine's arrays (≈ 20–40 MiB of wasm memory on a 256² city) belong to one ServicesSystem.
 * dispose() restores the original methods and returns every block to the shared WasmHeap; installing again on the same
 * system disposes the previous engine; a ServicesSystem that is garbage-collected without dispose() has its engine freed
 * by a FinalizationRegistry (a safety net only: GC timing is unbounded, call dispose() on unload).
 *
 * Kernel fault (a trap = a bug): the original methods take over IN THE SAME PASS — a fault inside the tier steps
 * restarts the current tier slot on the original engine (the slots the engine finished are bit-identical), a fault in a
 * later step runs the original method of that step — and the next pass is forced (lastRun, dirty, accessDirty,
 * nimbyDirty), so anything a partial in-place write may have touched is recomputed by the original code within a day.
 *
 * Reference: services.ts at commit 24f8609 (+ the transit-slot stop rules of the live transit.ts, feature-detected, and
 * the per-building stats.needs pass of 233ea41).
 */
import type { Simulation } from '../../sim/Simulation';
import type { Building, CityState, NeedStat, NeedTier } from '../../sim/CityState';
import type { ServicesSystem } from '../../sim/infra/services';
import type { CellRect } from '../../core/events';
import { BF } from '../../sim/CityState';
import { DevType, Network } from '../../core/types';
import { Fam, Transit, buildingList, fundingFactor, infoOf, isFunctional, type DefInfo } from '../../sim/infra/common';
import * as P from '../../sim/infra/params';
import { NEED_ORDER, TIME_Q, tierLayer } from '../../sim/infra/catchments';
import * as transit from '../../sim/infra/transit';
import {
  TierEngine, U_COPY, U_ENTRY, U_SEARCH, WORK_PER_STEP, jsKernels, jsSpace, keyOf, type FacilityParams, type ReachConsts, type Space,
  type TierKernels,
} from '../js/servicesTierEngine';
import { CATCH_LAYOUT, TierEngineFault, catchWasmFromSlot, makeWasmTierKernels, wasmSpace, type CatchWasm } from './servicesBind';

/** verbatim services.ts FOOT_WORK: tier work units per footprint cell of finalizeTier's footprint max */
const FOOT_WORK = 0.2;

export type TierBackend = 'wasm' | 'js';

export interface TierEngineOptions {
  /** 'wasm' (default; runs the JS kernels when no instance is available) or 'js' (the restructured JS engine) */
  backend?: TierBackend;
  /** explicit kernel instance (benchmarks: scalar / SIMD builds); default: the loader's instance */
  wasm?: CatchWasm;
  /** also replace the numeric parts of accessCommuteLand / shopLand (default true) */
  accessFields?: boolean;
  /**
   * heap.reserve() this many bytes at install (a safe point). Normally unnecessary: the binary is pre-sized (64 MiB,
   * wasm/sim-kernels/src/build.rs) and a reserve beyond it GROWS memory, which invalidates V8's ArrayBuffer-detaching
   * protector for the whole isolate (every JS typed-array loop slows down)
   */
  reserveBytes?: number;
  /** smallest reach pool per slot, in entries (default 65,536; tests shrink it to force compaction / growth) */
  minPoolEntries?: number;
}

export interface InstalledTierEngine {
  readonly engine: TierEngine;
  readonly backend: TierBackend;
  /** false after dispose() / uninstall() or a kernel fault (the original methods are back) */
  readonly active: boolean;
  /** the fault that uninstalled the engine, if any */
  readonly fault: Error | null;
  /** restore the original methods (mid-pass safe) and free the engine's memory */
  dispose(): void;
  /** alias of dispose() */
  uninstall(): void;
}

/** the installed engine of each system (re-install, disposeServicesTierEngine) */
const installedOf = new WeakMap<object, InstalledTierEngine>();

/**
 * Safety net for a city unloaded without dispose(): when its ServicesSystem is garbage-collected, the engine's blocks
 * go back to the WasmHeap. The held value is the engine only (it holds no reference to the system).
 */
const reclaim: FinalizationRegistry<TierEngine> | null =
  typeof FinalizationRegistry === 'function' ? new FinalizationRegistry<TierEngine>((e) => { if (!e.disposed) e.dispose(); }) : null;

/** the engine installed into `system` (undefined: none, or disposed) */
export function servicesTierEngineOf(system: ServicesSystem): InstalledTierEngine | undefined {
  return installedOf.get(system);
}

/** dispose the engine installed into `system` (city unload / scene dispose); false when none is installed */
export function disposeServicesTierEngine(system: ServicesSystem): boolean {
  const inst = installedOf.get(system);
  if (!inst) return false;
  inst.dispose();
  return true;
}

// services.ts @ 24f8609 (module-private there)
const NT = NEED_ORDER.length;
const SLOT_TRANSIT = NT;
const NEED_RASTER: readonly number[] = [0, 0, 1, 2, 3, 4, 5, 6];
const S_TIERS = 1, S_STOPS = 2;
const P_INIT = 0, P_SEARCH = 1, P_ALLOC = 2, P_REPORT = 3, P_FINAL = 4;
const OVERRIDDEN = ['tierWork', 'prep', 'invalidateReach', 'workOf', 'finishTransit', 'footprints', 'finish', 'accessCommuteLand', 'shopLand'] as const;

/** the private surface of ServicesSystem the engine drives (24f8609 field names) */
interface Svc {
  stepIdx: number;
  lastRun: number;
  dirty: boolean;
  accessDirty: boolean;
  nimbyDirty: boolean;
  tierSlot: number;
  tierPhase: number;
  cursor: number;
  workLeft: number;
  fac: Building[][];
  facOp: number[][];
  facCap: number[][];
  shared: boolean[];
  hadFac: boolean[];
  need: Float32Array[];
  provNeed: (Float32Array | null)[];
  provSum: Float64Array;
  needSum: Float64Array;
  tierStats: NeedStat[];
  order: Int32Array;
  cache: unknown[];
  multi: Building[];
  multiCells: number;
  stops: transit.StopList | undefined;
  tierById: Float32Array;
  demById: Float32Array;
  utilById: Float32Array;
  seenById: Float32Array;
  passNo: number;
  lastEqDay: number;
  donePasses: number;
  idist: Int32Array;
  shopDist: Int32Array;
  shopLut: Float32Array;
  colX0: Int32Array;
  colX1: Int32Array;
  colT: Float32Array;
  record(b: Building, inf: DefInfo, S: number, D: number, served: number, op: number, seated: number): void;
  seatOrder(k: number): void;
  workOf(st: CityState, b: Building, k: number): number;
  prep(sim: Simulation): void;
  invalidateReach(r: CellRect | undefined): void;
  tierWork(sim: Simulation): void;
  finishTransit(sim: Simulation): void;
  footprints(st: CityState): void;
  finish(sim: Simulation, first: boolean): void;
  accessCommuteLand(sim: Simulation): void;
  shopLand(sim: Simulation): void;
}

/** the live catchments / params constants of the reach kernels (throws when the Dial queue's integer costs are not) */
export function reachConsts(): ReachConsts {
  const ints = (a: readonly number[], name: string): Int32Array => {
    if (!a.every((v) => Number.isInteger(v) && v >= 0 && v < 1 << 20)) throw new Error(`services tier engine: ${name} must be non-negative integers`);
    return Int32Array.from(a);
  };
  const walk = ints(P.WALK_COST, 'WALK_COST'), drive = ints(P.DRIVE_COST, 'DRIVE_COST');
  if (walk.length !== drive.length) throw new Error('services tier engine: WALK_COST / DRIVE_COST lengths differ');
  if (!Number.isInteger(P.RAMP_COST)) throw new Error('services tier engine: RAMP_COST must be an integer');
  return { walk, drive, ramp: P.RAMP_COST, hw: Network.Highway, street: Network.Street, nearField: P.CATCH_NEAR_FIELD, roadFactor: P.ROAD_RADIUS_FACTOR };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** kernels + space for a backend choice */
function backendOf(opts: TierEngineOptions): { kernels: TierKernels; space: Space; backend: TierBackend } {
  if ((opts.backend ?? 'wasm') === 'wasm') {
    const w = opts.wasm ?? catchWasmFromSlot();
    if (w && typeof w.ex.catch_layout === 'function' && w.ex.catch_layout() === CATCH_LAYOUT) {
      if (opts.reserveBytes) w.heap.reserve(opts.reserveBytes);
      const fixed = opts.wasm;
      return { kernels: makeWasmTierKernels(fixed ? () => fixed : catchWasmFromSlot), space: wasmSpace(w), backend: 'wasm' };
    }
  }
  return { kernels: jsKernels, space: jsSpace, backend: 'js' };
}

/** install the engine into `system` (see the file header); throws when the live constants are unusable */
export function installServicesTierEngine(system: ServicesSystem, opts: TierEngineOptions = {}): InstalledTierEngine {
  // one engine per system: a second install replaces (and frees) the first
  installedOf.get(system)?.dispose();
  const sys = system as unknown as Svc;
  const self = system as unknown as Record<string, unknown>;
  const proto = Object.getPrototypeOf(system) as Svc;
  const orig = { prep: proto.prep, invalidateReach: proto.invalidateReach, workOf: proto.workOf };
  const K = reachConsts();
  const be = backendOf(opts);
  const engine = new TierEngine(NT + 1, K, be.kernels, be.space, { minPool: opts.minPoolEntries });
  const accessFields = opts.accessFields ?? true;
  let lastCache: unknown = sys.cache;
  let infos: DefInfo[] = [];
  const fp: FacilityParams = { radius: 0, metric: 0, strength: 0 };
  const state = { active: true, fault: null as Error | null };
  /** true while the original prep runs: its work estimate is replaced below, so workOf is a no-op meanwhile */
  let inOrigPrep = false;
  const token = {};
  reclaim?.register(system, engine, token);

  const syncReset = (): void => {
    if (sys.cache !== lastCache) { lastCache = sys.cache; engine.reset(); }
  };

  /**
   * Give the system back to the original methods, mid-pass safe: a pass inside the tier steps restarts the current tier
   * slot on the original engine (its reach cache is empty: fresh searches, identical results; the slots the engine
   * finished stay as written), later steps simply continue on the original methods. Frees the engine.
   */
  function handOver(fault: Error | null): void {
    if (!state.active) return;
    state.active = false;
    state.fault = fault;
    // the prototype's methods again (assigned rather than deleted: deleting properties would turn the system object
    // into a slow dictionary-mode object for the rest of the city)
    const pr = proto as unknown as Record<string, unknown>;
    for (const name of OVERRIDDEN) if (Object.prototype.hasOwnProperty.call(self, name)) self[name] = pr[name];
    sys.cache = new Array(NT + 1).fill(null);
    if (sys.stepIdx === S_TIERS) { sys.tierPhase = P_INIT; sys.cursor = 0; }
    if (fault) {
      // force the next pass (with access fields and NIMBY): whatever a trapped kernel may have half-written in place
      // (resident layers) is recomputed by the original code
      sys.lastRun = -1e9;
      sys.dirty = true;
      sys.accessDirty = true;
      sys.nimbyDirty = true;
    }
    reclaim?.unregister(token);
    if (installedOf.get(system) === handle) installedOf.delete(system);
    engine.dispose();
  }

  /** a kernel fault (TierEngineFault; anything else is rethrown): the original methods take over, see handOver */
  const onFault = (err: unknown): void => {
    if (!(err instanceof TierEngineFault)) throw err;
    handOver(err);
    console.error('[services tier engine] kernel fault, the original JS engine finishes this pass and runs the next one:', err.message);
  };

  // ---------------------------------------------------------------------------------------------- prep
  function prep(this: Svc, sim: Simulation): void {
    const st = sim.state;
    syncReset();
    // the original's work estimate would run workOf for every facility (its own caches stay empty): workOf is a
    // no-op meanwhile (an instance override installed once — adding / deleting properties per pass would push the
    // system object into dictionary mode), the estimate is recomputed below from the engine's records
    inOrigPrep = true;
    try {
      orig.prep.call(this, sim);
    } finally {
      inOrigPrep = false;
    }
    syncReset();
    engine.ensure(st.size);
    engine.beginPass();
    const C = st.cells;
    let w = 0;
    for (let k = 0; k <= NT; k++) {
      const list = this.fac[k];
      if (list.length === 0) { if (this.hadFac[k] || k === SLOT_TRANSIT) w += C * 0.05; continue; }
      w += C * (this.shared[k] ? 0.45 : 0.3) + (k === SLOT_TRANSIT ? 0 : FOOT_WORK * this.multiCells);
      const perEntry = U_ENTRY * (this.shared[k] ? 3 : 2);
      for (const b of list) {
        const e = engine.recordOf(k, b.id, keyOf(b));
        if (e >= 0) w += (e >> 1) * ((e & 1 ? U_COPY : U_SEARCH) + perEntry) + 16;
        else w += orig.workOf.call(this, st, b, k);
      }
    }
    this.workLeft = w;
  }

  // ---------------------------------------------------------------------------------------------- tier engine
  function tierWork(this: Svc, sim: Simulation): void {
    try {
      tierWorkInner.call(this, sim);
    } catch (err) {
      // stepIdx stays S_TIERS: the next step() runs the original tierWork from P_INIT of the current slot
      onFault(err);
    }
  }

  function tierWorkInner(this: Svc, sim: Simulation): void {
    const st = sim.state;
    const C = st.cells, N = st.size;
    const eng = engine;
    // a new scheduler step: network / water copies of an earlier step are stale (road edits happen between steps)
    eng.kernels.beginStep?.(eng);
    const alive = (b: { id: number }): boolean => st.buildings.has(b.id);
    let work = 0;
    while (this.stepIdx === S_TIERS && work < WORK_PER_STEP) {
      const k = this.tierSlot;
      if (k > NT) { this.stepIdx = S_STOPS; break; }
      const list = this.fac[k];
      const shared = this.shared[k];
      const needL = k < NT ? this.provNeed[k] ?? this.need[NEED_RASTER[k]] : this.need[0];
      const ops = this.facOp[k], caps = this.facCap[k];
      switch (this.tierPhase) {
        case P_INIT: {
          if (list.length === 0) {
            if (this.hadFac[k] || k === SLOT_TRANSIT) {
              (k === SLOT_TRANSIT ? st.transitCov : tierLayer(st, NEED_ORDER[k])).fill(0);
              work += C * 0.05; this.workLeft -= C * 0.05;
            }
            this.hadFac[k] = false;
            eng.dropSlot(k);
            if (k < NT) {
              const n = this.provNeed[k] ? this.provSum[k] : this.needSum[NEED_RASTER[k]];
              const ts = this.tierStats[k];
              ts.need = n; ts.served = 0; ts.capacity = 0; ts.unreached = n; ts.overcrowded = 0;
            }
            this.tierSlot++;
            break;
          }
          this.hadFac[k] = true;
          const transitSlot = k === SLOT_TRANSIT;
          if (infos.length < list.length) infos = new Array(list.length);
          for (let c = 0; c < list.length; c++) infos[c] = infoOf(st, list[c]);
          eng.initSlot(k, list, ops, caps, shared, (_b, c) => {
            const inf = infos[c];
            if (transitSlot) { fp.radius = inf.covRadius; fp.metric = 2; fp.strength = inf.covStrength; }
            else { fp.radius = inf.tierRadius; fp.metric = inf.metric; fp.strength = inf.tierStrength; }
            return fp;
          }, st.nextBuildingId, alive);
          this.cursor = 0;
          this.tierPhase = P_SEARCH;
          const w = C * 0.1;
          work += w; this.workLeft -= w;
          break;
        }
        case P_SEARCH: {
          if (this.cursor >= list.length) {
            if (shared) { this.seatOrder(k); eng.setOrder(this.order, list.length); this.tierPhase = P_ALLOC; } else this.tierPhase = P_FINAL;
            this.cursor = 0;
            break;
          }
          const c0 = this.cursor;
          eng.refreshAlive(list, c0, alive);
          const r = eng.search(k, c0, work, this.workLeft, WORK_PER_STEP, !shared, N, st.network, st.water, needL);
          work = r.work; this.workLeft = r.left; this.cursor = r.cursor;
          if (!shared && k !== SLOT_TRANSIT) {
            const D = eng.D.v, served = eng.served.v, al = eng.alive.v;
            for (let c = c0; c < r.cursor; c++) {
              if (al[c] === 0) continue;
              const S = caps[c], d = D[c];
              this.record(list[c], infos[c], S, d, served[c], ops[c], S < Infinity && d > S ? S : d);
            }
          }
          break;
        }
        case P_ALLOC: {
          if (this.cursor >= list.length) { this.tierPhase = P_REPORT; this.cursor = 0; break; }
          const q0 = this.cursor;
          const a = eng.alloc2(k, q0, work, this.workLeft, WORK_PER_STEP, needL);
          work = a.work; this.workLeft = a.left; this.cursor = a.cursor;
          const ord = this.order, fs = eng.fs.v, fe = eng.fe.v, sig = eng.sig.v, seat = eng.seat.v, D = eng.D.v;
          for (let q = q0; q < a.cursor; q++) {
            const c = ord[q];
            if (fe[c] <= fs[c]) continue;
            const op = ops[c], d = D[c];
            const rho = sig[c] * op;
            this.record(list[c], infos[c], caps[c], d, d * rho, op, seat[c]);
          }
          break;
        }
        case P_REPORT: {
          if (this.cursor >= list.length) { this.tierPhase = P_FINAL; break; }
          const c0 = this.cursor;
          const a = eng.report2(k, c0, work, this.workLeft, WORK_PER_STEP, needL);
          work = a.work; this.workLeft = a.left; this.cursor = a.cursor;
          const ok = eng.demOk.v, dem = eng.dem.v;
          for (let c = c0; c < a.cursor; c++) {
            if (ok[c] === 0) continue;
            const id = list[c].id;
            if (id < this.demById.length) {
              const S = caps[c], d = dem[c];
              this.demById[id] = d;
              this.utilById[id] = S < Infinity && S > 0 ? d / S : 0;
            }
          }
          break;
        }
        default: {
          const layer = k === SLOT_TRANSIT ? st.transitCov : tierLayer(st, NEED_ORDER[k]);
          const f = eng.finalize(layer, k === SLOT_TRANSIT, needL);
          if (k !== SLOT_TRANSIT) {
            let capacity = 0, over = 0;
            for (let c = 0; shared && c < list.length; c++) {
              const S = caps[c];
              if (!(S < Infinity)) continue;
              capacity += S * ops[c];
              const id = list[c].id;
              if (id < this.utilById.length && this.tierById[id] > 0 && this.utilById[id] > P.OVERCROWDED_UTIL) over++;
            }
            const ts = this.tierStats[k];
            ts.need = f[0]; ts.served = f[1]; ts.capacity = capacity; ts.unreached = f[2]; ts.overcrowded = over;
            // verbatim: the original's finalizeTier ends with the footprint max of the tier layer (a lot is covered as a
            // whole from the moment its tier is written)
            footprintMax(this.multi, N, layer);
          }
          eng.finishSlot(k);
          const w = C * (shared ? 0.3 : 0.2) + (k === SLOT_TRANSIT ? 0 : FOOT_WORK * this.multiCells);
          work += w; this.workLeft -= w;
          this.tierSlot++;
          this.tierPhase = P_INIT;
        }
      }
    }
  }

  function workOf(this: Svc, st: CityState, b: Building, k: number): number {
    return inOrigPrep ? 0 : orig.workOf.call(this, st, b, k);
  }

  function invalidateReach(this: Svc, r: CellRect | undefined): void {
    orig.invalidateReach.call(this, r);
    engine.invalidate(r);
  }

  // ---------------------------------------------------------------------------------------------- transit stops
  const tr = transit as unknown as Record<string, unknown>;
  const pr = P as unknown as Record<string, unknown>;
  const stopServes = typeof tr.stopServes === 'function' ? (tr.stopServes as (sim: Simulation, id: number) => boolean) : null;
  const ferryR = typeof pr.FERRY_COV_RADIUS === 'number' ? (pr.FERRY_COV_RADIUS as number) : null;
  const ferryMode = (Transit as unknown as Record<string, number>).Ferry;

  function finishTransit(this: Svc, sim: Simulation): void {
    try {
      const st = sim.state;
      const N = st.size;
      engine.kernels.beginStep?.(engine);
      this.stops = transit.collectStops(st, this.stops);
      const stops = this.stops;
      const n = stops.n;
      engine.ensure(N);
      engine.ensureStops(n);
      const cell = engine.stopCell.v, R = engine.stopR.v, fac = engine.stopFactor.v, skip = engine.stopSkip.v;
      const TR = P.TRANSIT_COV_RADIUS;
      for (let s = 0; s < n; s++) {
        let sk = 0;
        const bid = stops.bid[s];
        if (bid >= 0) {
          const b = st.buildings.get(bid);
          if (b && infoOf(st, b).cov >= 0) sk = 1;
        }
        // live transit.ts (WP7-6): unattached stops give no walking coverage (road-flag stops always serve)
        if (!sk && stopServes && !(bid < 0 || stopServes(sim, bid))) sk = 1;
        const mode = stops.mode[s];
        const r = mode === Transit.Bus ? TR.bus : mode === Transit.Subway ? TR.subway : ferryR !== null && mode === ferryMode ? ferryR : TR.train;
        if (!Number.isInteger(r)) throw new Error(`transit coverage radius ${r} is not an integer`);
        cell[s] = stops.cell[s]; R[s] = r; fac[s] = mode === Transit.Bus ? 0.75 : 1; skip[s] = sk;
      }
      const funding = Math.min(1.25, fundingFactor(st, 'transit'));
      engine.kernels.transitCov(engine, N, { n, cell, R, factor: fac, skip }, funding, engine.tmp.v, st.transitCov);
    } catch (err) {
      onFault(err);
      proto.finishTransit.call(this, sim);
    }
  }

  // ---------------------------------------------------------------------------------------------- footprints
  /** verbatim ServicesSystem.footprintMax: one layer's max over each multi-cell footprint */
  function footprintMax(list: readonly Building[], N: number, L: Float32Array): void {
    for (let q = 0; q < list.length; q++) {
      const b = list[q];
      const x0 = Math.max(0, b.x), z0 = Math.max(0, b.z), x1 = Math.min(N, b.x + b.w), z1 = Math.min(N, b.z + b.d);
      let m = 0;
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { const v = L[z * N + x]; if (v > m) m = v; }
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) L[z * N + x] = m;
    }
  }
  function footprints(this: Svc, st: CityState): void {
    try {
      const N = st.size;
      engine.kernels.beginStep?.(engine);
      const layers: Float32Array[] = [];
      for (let k = 0; k < NT; k++) if (this.hadFac[k]) layers.push(tierLayer(st, NEED_ORDER[k]));
      if (this.hadFac[SLOT_TRANSIT] || (this.stops?.n ?? 0) > 0) layers.push(st.transitCov);
      if (layers.length === 0) return;
      const list = this.multi;
      engine.ensure(N);
      engine.ensureBoxes(list.length);
      const bx = engine.boxes.v;
      for (let q = 0; q < list.length; q++) { const b = list[q]; bx[4 * q] = b.x; bx[4 * q + 1] = b.z; bx[4 * q + 2] = b.w; bx[4 * q + 3] = b.d; }
      engine.kernels.footprints(engine, N, list.length, bx, layers);
    } catch (err) {
      onFault(err);
      proto.footprints.call(this, st);
    }
  }

  // ---------------------------------------------------------------------------------------------- finish
  function finish(this: Svc, sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const E = st.eduElemCov, H = st.eduHighCov, Kc = st.eduCollegeCov, Pl = st.playCov, G = st.greenCov;
    const [we, wh, wc] = P.EDU_LEGACY_W;
    try {
      engine.kernels.beginStep?.(engine);
      engine.kernels.combo(engine, C, E, H, Kc, Pl, G, st.eduCov, st.parkCov, we, wh, wc);
    } catch (err) {
      onFault(err);
      proto.finish.call(this, sim, first);
      return;
    }
    // ---- verbatim from services.ts finish (24f8609 + the per-building stats.needs pass)
    for (let k = 0; k < NT; k++) {
      if (!this.hadFac[k]) continue;
      const needL = this.provNeed[k] ?? this.need[NEED_RASTER[k]];
      if (!needL || needL.length !== C) continue;
      const layer = tierLayer(st, NEED_ORDER[k]);
      let served = 0, unreached = 0;
      for (let i = 0; i < C; i++) { const n = needL[i]; if (n <= 0) continue; const v = layer[i]; served += n * v; if (v <= 0) unreached += n; }
      this.tierStats[k].served = served;
      this.tierStats[k].unreached = unreached;
    }
    const needs = st.stats.needs as Record<NeedTier, NeedStat> | undefined;
    if (needs) {
      for (let k = 0; k < NT; k++) {
        const t = NEED_ORDER[k];
        const src = this.tierStats[k];
        const dst = needs[t] ?? (needs[t] = { need: 0, served: 0, capacity: 0, unreached: 0, overcrowded: 0 });
        dst.need = Math.round(src.need);
        dst.served = Math.round(src.served);
        dst.capacity = Math.round(src.capacity);
        dst.unreached = Math.round(src.unreached);
        dst.overcrowded = src.overcrowded;
      }
    }
    const tb = this.tierById, seen = this.seenById, pass = this.passNo;
    for (let id = 0, n = Math.min(tb.length, seen.length); id < n; id++) if (tb[id] > 0 && seen[id] !== pass) tb[id] = 0;
    let popSum = 0, eduA = 0, health = 0, air = 0, wp1 = false;
    const bL = buildingList(st);
    for (let bI = 0; bI < bL.length; bI++) {
      const b = bL[bI];
      if (b.pop <= 0) continue;
      if (infoOf(st, b).fam !== Fam.R) continue;
      if (b.edu !== undefined) { wp1 = true; break; }
      const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
      popSum += b.pop;
      eduA += b.pop * (1 - (1 - E[i]) * (1 - H[i]) * (1 - Kc[i]));
      health += b.pop * st.healthCov[i];
      air += b.pop * st.airPollution[i];
    }
    const stats = st.stats;
    const dtDays = Math.max(0, st.day - this.lastEqDay);
    this.lastEqDay = st.day;
    if (!wp1 && popSum > 0 && !first && dtDays > 0) {
      eduA /= popSum; health /= popSum; air /= popSum;
      const eqT = Math.min(150, 25 + 125 * eduA);
      const hqT = Math.min(150, Math.max(0, (30 + 120 * health) * (1 - 0.35 * air)));
      stats.eq += (eqT - stats.eq) * (1 - Math.exp(-dtDays / (P.EQ_TAU_YEARS * 360)));
      stats.hq += (hqT - stats.hq) * (1 - Math.exp(-dtDays / (P.HQ_TAU_YEARS * 360)));
    }
    this.donePasses++;
    sim.events.emit('layerUpdated', 'services');
    sim.events.emit('layerUpdated', 'catchments');
  }

  // ---------------------------------------------------------------------------------------------- access fields
  function accessCommuteLand(this: Svc, sim: Simulation): void {
    const st = sim.state;
    const N = st.size;
    try {
      engine.ensure(N);
      engine.kernels.beginStep?.(engine);
      const avg = st.stats.avgCommute;
      const unreached = avg > 0 ? P.ACCESS_UNREACHED * avg : 0;
      engine.kernels.accessLand(engine, N, st.network, this.idist, engine.tmp.v, st.accessCommute, true, TIME_Q, P.ACCESS_LAND_STEP, 1e9, unreached);
    } catch (err) {
      onFault(err);
      proto.accessCommuteLand.call(this, sim);
      return;
    }
    // ---- verbatim: residential footprints keep their own (traffic) commute
    const out = st.accessCommute, cm = st.commute;
    const bL = buildingList(st);
    for (let bI = 0; bI < bL.length; bI++) {
      const b = bL[bI];
      if (b.pop <= 0 || infoOf(st, b).fam !== Fam.R) continue;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        if (cm[i] > 0) out[i] = cm[i];
      }
    }
  }

  function shopLand(this: Svc, sim: Simulation): void {
    try {
      const st = sim.state;
      const N = st.size;
      engine.ensure(N);
      engine.kernels.beginStep?.(engine);
      const v = engine.tmp.v;
      const INF = 1e9;
      engine.kernels.accessLand(engine, N, st.network, this.shopDist, v, null, false, 1, 4, INF, 0);
      const B = P.CLUSTER_BLOCK;
      const nb = Math.ceil(N / B);
      const cs = new Float32Array(nb * nb), pop = new Float32Array(nb * nb), t = new Float32Array(nb * nb);
      engine.kernels.blockSum(engine, N, B, nb, this.need[0], pop);
      const bL = buildingList(st);
      for (let bI = 0; bI < bL.length; bI++) {
        const b = bL[bI];
        const inf = infoOf(st, b);
        if (inf.fam !== Fam.C || inf.dev < DevType.CS1 || inf.dev > DevType.CS3 || !isFunctional(b)) continue;
        const x = Math.min(N - 1, b.x + (b.w >> 1)), z = Math.min(N - 1, b.z + (b.d >> 1));
        cs[((z / B) | 0) * nb + ((x / B) | 0)] += b.capacity;
      }
      engine.kernels.box3(engine, cs, nb, t);
      engine.kernels.box3(engine, pop, nb, t);
      const ratio = cs;
      for (let q = 0; q < nb * nb; q++) ratio[q] = Math.min(1, (cs[q] * P.RES_PER_CS_JOB) / (pop[q] + 1));
      const capQ = P.SHOP_CAP_CELLS * 4;
      if (this.shopLut.length !== capQ + 1) {
        this.shopLut = new Float32Array(capQ + 1);
        for (let q = 0; q <= capQ; q++) this.shopLut[q] = 1 - smoothstep(P.SHOP_NEAR, P.SHOP_FAR, q / 4);
      }
      if (this.colX0.length !== N) { this.colX0 = new Int32Array(N); this.colX1 = new Int32Array(N); this.colT = new Float32Array(N); }
      const cx0 = this.colX0, cx1 = this.colX1, ct = this.colT;
      for (let x = 0; x < N; x++) {
        const f = Math.min(nb - 1, Math.max(0, (x + 0.5) / B - 0.5));
        const x0 = Math.floor(f);
        cx0[x] = x0; cx1[x] = Math.min(nb - 1, x0 + 1); ct[x] = f - x0;
      }
      engine.kernels.shopTaps(engine, N, nb, B, v, ratio, this.shopLut, cx0, cx1, ct, st.shopAccess, capQ, P.SHOP_BASE);
    } catch (err) {
      onFault(err);
      proto.shopLand.call(this, sim);
    }
  }

  // ---------------------------------------------------------------------------------------------- install
  const impl: Record<(typeof OVERRIDDEN)[number], unknown> = {
    tierWork, prep, invalidateReach, workOf, finishTransit, footprints, finish, accessCommuteLand, shopLand,
  };
  for (const name of OVERRIDDEN) {
    if (!accessFields && (name === 'accessCommuteLand' || name === 'shopLand')) continue;
    if (typeof (proto as unknown as Record<string, unknown>)[name] !== 'function') throw new Error(`ServicesSystem has no ${name}() (services.ts changed?)`);
    self[name] = impl[name];
  }

  const handle: InstalledTierEngine = {
    engine,
    backend: be.backend,
    get active() { return state.active; },
    get fault() { return state.fault; },
    dispose(): void { handOver(null); },
    uninstall(): void { handOver(null); },
  };
  installedOf.set(system, handle);
  return handle;
}
