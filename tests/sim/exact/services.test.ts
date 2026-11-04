import { beforeAll, describe, expect, it } from 'vitest';
import { RNG } from '../../../src/core/rng';
import type { CellRect } from '../../../src/core/events';
import { Network } from '../../../src/core/types';
import { BF, type Building, type CityState, type NeedStat } from '../../../src/sim/CityState';
import { Simulation } from '../../../src/sim/Simulation';
import { CATALOG, getDef, rebuildCatalogIndex } from '../../../src/sim/catalog';
import { clearInfoCache, Transit } from '../../../src/sim/infra/common';
import { computeTransitCoverageCached, NEED_ORDER, registerTierProvider, tierProvider } from '../../../src/sim/infra/catchments';
import { TRANSIT_COV_RADIUS } from '../../../src/sim/infra/params';
import { ServicesSystem } from '../../../src/sim/infra/services';
import { NETFLAG_BUS_STOP, type StopList } from '../../../src/sim/infra/transit';
import { deserializeCity, serializeCity } from '../../../src/save/serialize';
import { newState, place, registerTestDefs } from '../../infra/cityGen';
import { computeTransitCoverageOriginal, ServicesSystemOriginal } from './servicesOriginal';

type Service = ServicesSystem | ServicesSystemOriginal;
interface Entry { key: number; start: number; end: number; x0: number; z0: number; x1: number; z1: number; road: boolean; valid: boolean }
interface Cache { idx: Int32Array; w: Float32Array; ent: Map<number, Entry> }
interface Records { slot: Map<number, number>; key: Float64Array; start: Float64Array; end: Float64Array; box: Int32Array; road: Uint8Array; valid: Uint8Array }
interface TypedCache { idx: Int32Array; w: Float32Array; top: number; used: number; rec: Records }
interface Probe {
  stepIdx: number; firstPass: boolean; tierSlot: number; tierPhase: number; cursor: number; workLeft: number;
  A: Float32Array; cov: Float32Array; multi: Building[]; shared: boolean[];
  fac: Building[][]; facOp: number[][]; facCap: number[][];
  utilById: Float32Array; tierById: Float32Array; tierStats: NeedStat[];
  facStart: number[]; facEnd: number[];
  prep(sim: Simulation): void;
  tierWork(sim: Simulation): void;
  finalizeTier(st: CityState, k: number, need: Float32Array): void;
  finishTransit(sim: Simulation): void;
  invalidateReach(r: CellRect | undefined): void;
  stepCost(sim: Simulation): number;
}
interface TypedProbe extends Probe { cache: (TypedCache | null)[]; curRec: Records; curCache: TypedCache | null }
interface OriginalProbe extends Probe { cache: (Cache | null)[]; curEnt: Map<number, Entry>; pIdx: Int32Array; pW: Float32Array }
const probe = (s: Service): Probe => s as unknown as Probe;
const typed = (s: ServicesSystem): TypedProbe => s as unknown as TypedProbe;
const original = (s: ServicesSystemOriginal): OriginalProbe => s as unknown as OriginalProbe;
const record = (v: object): Record<string, unknown> => v as unknown as Record<string, unknown>;
const scalar = new Float64Array(2), scalarBits = new Uint32Array(scalar.buffer);

/** Bit equality except that any two NaNs compare equal: V8 can change their payloads across JIT tiers. */
function same(a: unknown, b: unknown, label: string): void {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return;
    scalar[0] = a; scalar[1] = b;
    if (scalarBits[0] !== scalarBits[2] || scalarBits[1] !== scalarBits[3]) expect.fail(`${label}: ${a} != ${b} (f64 bits)`);
    return;
  }
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const x = Buffer.from(a.buffer, a.byteOffset, a.byteLength), y = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
    if (a.constructor !== b.constructor || !x.equals(y)) {
      if (a.constructor === b.constructor && a.byteLength === b.byteLength && ((a instanceof Float32Array && b instanceof Float32Array)
        || (a instanceof Float64Array && b instanceof Float64Array))) {
        for (let i = 0; i < a.length; i++) same(a[i], b[i], `${label}[${i}]`);
        return;
      }
      let i = 0;
      while (i < x.length && i < y.length && x[i] === y[i]) i++;
      expect.fail(`${label}: byte ${i}, lengths ${x.length}/${y.length}, ${x[i]} != ${y[i]}`);
    }
    return;
  }
  if (a === b) return;
  if (a instanceof Map && b instanceof Map) { same([...a], [...b], label); return; }
  if (a instanceof Set && b instanceof Set) { same([...a], [...b], label); return; }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) expect.fail(`${label}: lengths ${a.length}/${b.length}`);
    for (let i = 0; i < a.length; i++) same(a[i], b[i], `${label}[${i}]`);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = record(a), y = record(b), keys = Object.keys(y);
    if (Object.keys(x).length !== keys.length) expect.fail(`${label}: different keys`);
    for (const k of keys) {
      if (!Object.hasOwn(x, k)) expect.fail(`${label}: missing ${k}`);
      same(x[k], y[k], `${label}.${k}`);
    }
    return;
  }
  expect.fail(`${label}: ${String(a)} != ${String(b)}`);
}

/** Compare records by id and reach contents; physical offsets / spare pool bytes are private storage. */
function sameRecords(rec: Records, pool: TypedCache | null, old: Cache, label: string): void {
  same([...rec.slot.keys()], [...old.ent.keys()], `${label}.ids`);
  for (const [id, e] of old.ent) {
    const q = rec.slot.get(id)!;
    same([rec.key[q], rec.end[q] - rec.start[q], ...rec.box.subarray(4 * q, 4 * q + 4), !!rec.road[q], !!rec.valid[q]],
      [e.key, e.end - e.start, e.x0, e.z0, e.x1, e.z1, e.road, e.valid], `${label}.${id}.record`);
    if (!pool || rec.end[q] > pool.top || rec.start[q] > rec.end[q]) expect.fail(`${label}.${id}: invalid pool range`);
    same(pool.idx.subarray(rec.start[q], rec.end[q]), old.idx.subarray(e.start, e.end), `${label}.${id}.idx`);
    same(pool.w.subarray(rec.start[q], rec.end[q]), old.w.subarray(e.start, e.end), `${label}.${id}.w`);
  }
}

function sameSystem(a: ServicesSystem, b: ServicesSystemOriginal, label: string): void {
  const x = record(a), y = record(b);
  for (const k of Object.keys(y)) {
    // Wall-clock timings and subscription closures are not simulation outputs; state is checked separately.
    if (k === 'lastMs' || k === 'unsub' || k === 'lastState') continue;
    if (k === 'cache' || k === 'curEnt' || k === 'pIdx' || k === 'pW' || k === 'facStart' || k === 'facEnd') continue;
    same(x[k], y[k], `${label}.${k}`);
  }
  const p = typed(a), o = original(b);
  for (let k = 0; k < o.cache.length; k++) {
    const c = p.cache[k], old = o.cache[k];
    if (!c || !old) { same(c, old, `${label}.cache[${k}]`); continue; }
    sameRecords(c.rec, c, old, `${label}.cache[${k}]`);
  }
  sameRecords(p.curRec, p.curCache, { idx: o.pIdx, w: o.pW, ent: o.curEnt }, `${label}.pending`);
  same(p.facStart.length, o.facStart.length, `${label}.facStart.length`);
  same(p.facEnd.length, o.facEnd.length, `${label}.facEnd.length`);
  for (let c = 0; c < o.facStart.length; c++) {
    same(p.facEnd[c] - p.facStart[c], o.facEnd[c] - o.facStart[c], `${label}.reachLength[${c}]`);
    if (p.curCache && p.stepIdx === 1 && p.tierPhase !== 0) {
      same(p.curCache.idx.subarray(p.facStart[c], p.facEnd[c]), o.pIdx.subarray(o.facStart[c], o.facEnd[c]), `${label}.idx[${c}]`);
      same(p.curCache.w.subarray(p.facStart[c], p.facEnd[c]), o.pW.subarray(o.facStart[c], o.facEnd[c]), `${label}.w[${c}]`);
    }
  }
}

const SPECIAL = [0, -0, 1, -1, 1 + 2 ** -23, 1 - 2 ** -24, 2 ** -149, -(2 ** -149),
  3.4028234663852886e38, -3.4028234663852886e38, Number.MIN_VALUE, Number.MAX_VALUE, Infinity, -Infinity, NaN];
function field(r: RNG, n: number, scale = 1): Float32Array {
  const a = new Float32Array(n), bits = new Uint32Array(a.buffer);
  for (let i = 0; i < n; i++) {
    if (i % 7 === 0) bits[i] = r.pick([0x7fc00001, 0xffc12345, 0x7f800001, 0x80000000, 1, 0x7f7fffff]);
    else a[i] = r.chance(0.3) ? r.pick(SPECIAL) : r.range(-0.5, 1.5) * scale;
  }
  return a;
}

const LAYERS = ['policeCov', 'fireCov', 'eduElemCov', 'eduHighCov', 'eduCollegeCov', 'healthCov', 'playCov', 'greenCov', 'transitCov'];
const BASE_DEFS = ['civ_police_station', 'civ_fire_station', 'civ_elementary_school', 'civ_high_school', 'civ_college',
  'civ_hospital', 'park_playground', 'park_large', 'tr_bus_stop', 'park_marina', 'tr_subway_station', 'tr_train_station',
  'tr_ferry_terminal', 'civ_bus_depot', 'tr_parking_garage'];

beforeAll(() => {
  registerTestDefs();
  for (const id of BASE_DEFS) {
    const def = getDef(id)!;
    CATALOG.push({ ...def, id: `exact_${id}`, footprint: [1, 1] });
  }
  rebuildCatalogIndex();
  clearInfoCache();
});

function cloneCity(st: CityState): CityState {
  return Object.assign(Object.create(Object.getPrototypeOf(st)) as CityState, structuredClone(st));
}

function city(N: number, seed: number, copies = 1): CityState {
  const st = newState(N), r = new RNG(seed);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x;
    if (x % 4 === 1 || z % 5 === 2) st.network[i] = r.pick([Network.Street, Network.Road, Network.Avenue, Network.Highway]);
    if (x === (N >> 1)) st.water[i] = 1;
    if (z === N - 2 && !st.network[i]) st.network[i] = Network.Rail;
    if (st.network[i] > 0 && r.chance(0.12)) st.netFlags[i] |= NETFLAG_BUS_STOP;
    st.crime[i] = r.next(); st.airPollution[i] = r.next(); st.commute[i] = r.range(0, 120);
  }
  const add = (id: string, residential: boolean) => {
    const def = getDef(id)!, [w, d] = def.footprint;
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = r.int(0, N - w), z = r.int(0, N - d);
      let ok = true;
      for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) if (st.building[zz * N + xx] >= 0) ok = false;
      if (!ok) continue;
      const b = place(st, id, x, z, { flags: r.pick([0, BF.Powered, BF.Watered, BF.Powered | BF.Watered]),
        pop: residential ? r.int(1, 2000) : 0, jobs: residential ? 0 : r.int(0, 80), wealth: r.int(1, 3) });
      if (r.chance(0.4)) b.hire = r.next();
      return;
    }
  };
  for (let n = 0; n < copies; n++) for (const id of BASE_DEFS) add(`exact_${id}`, false);
  for (const id of ['t_bus', 't_subway', 't_train', 't_coal']) add(id, false);
  for (let n = 0; n < N * N / 8; n++) {
    const res = r.chance(0.75);
    add(res ? r.pick(['t_r1', 't_r2', 't_r3']) : r.pick(['t_cs', 't_co']), res);
  }
  return st;
}

function pair(st: CityState) {
  const a = new ServicesSystem(), b = new ServicesSystemOriginal();
  const sa = new Simulation(cloneCity(st)), sb = new Simulation(cloneCity(st));
  // Exercise the current WP7 stop attachment rule, including generic catalog coverage.
  for (const [sim, svc] of [[sa, a], [sb, b]] as const) {
    const traffic = { name: 'traffic', stopAttached: (id: number) => id % 3 !== sim.state.day % 3, commuteOf: () => 0 };
    sim.systems.push(svc, traffic);
  }
  const ea: string[] = [], eb: string[] = [];
  sa.events.on('layerUpdated', (v) => ea.push(v)); sb.events.on('layerUpdated', (v) => eb.push(v));
  return { a, b, sa, sb, ea, eb };
}
type Pair = ReturnType<typeof pair>;

function check(p: Pair, label: string): void {
  same(p.sa.state, p.sb.state, `${label}.state`);
  sameSystem(p.a, p.b, label);
  same(p.ea, p.eb, `${label}.events`);
  same(probe(p.a).stepCost(p.sa), probe(p.b).stepCost(p.sb), `${label}.cost`);
}

function pass(p: Pair, label: string, afterStep?: () => void): number {
  let steps = 0;
  do {
    same(probe(p.a).stepCost(p.sa), probe(p.b).stepCost(p.sb), `${label}.costBefore${steps}`);
    p.a.step(p.sa); p.b.step(p.sb);
    check(p, `${label}.step${steps}`);
    afterStep?.();
    if (++steps > 200) expect.fail(`${label}: pass did not finish`);
  } while (probe(p.a).stepIdx >= 0);
  for (const tier of NEED_ORDER) same(p.a.clustersOf(tier), p.b.clustersOf(tier), `${label}.clusters.${tier}`);
  for (const id of p.sa.state.buildings.keys()) same(p.a.facilityLoadOf(p.sa.state, id), p.b.facilityLoadOf(p.sb.state, id), `${label}.load.${id}`);
  return steps;
}

describe('services exact J3', () => {
  it('the comparator ignores only NaN payloads, including in offset f32/f64 views', () => {
    const a32 = new Float32Array(new Uint32Array([1, 0x7fc00001, 0x80000000, 0x7f800000, 0xff800000, 0]).buffer).subarray(1, 5);
    const b32 = new Float32Array(new Uint32Array([2, 0xff800001, 0x80000000, 0x7f800000, 0xff800000, 1]).buffer).subarray(1, 5);
    const a64 = new Float64Array(new BigUint64Array([1n, 0x7ff8000000000001n, 0x8000000000000000n, 0x7ff0000000000000n]).buffer).subarray(1);
    const b64 = new Float64Array(new BigUint64Array([2n, 0xfff0000000000123n, 0x8000000000000000n, 0x7ff0000000000000n]).buffer).subarray(1);
    same(a32, b32, 'f32 NaNs'); same(a64, b64, 'f64 NaNs'); same(a64[0], b64[0], 'number NaNs');
    for (const [a, b] of [[0, -0], [Infinity, -Infinity], [NaN, 0], [Number.MIN_VALUE, 0], [1, 1 + Number.EPSILON]]) {
      expect(() => same(a, b, 'number mismatch')).toThrow();
      expect(() => same(new Float64Array([a]), new Float64Array([b]), 'f64 mismatch')).toThrow();
    }
    for (const [a, b] of [[0, -0], [Infinity, -Infinity], [NaN, 0], [2 ** -149, 0], [1, 1 + 2 ** -23]]) {
      expect(() => same(new Float32Array([a]), new Float32Array([b]), 'f32 mismatch')).toThrow();
    }
    expect(() => same(a32, a64, 'constructor mismatch')).toThrow();
    expect(() => same(a32, a32.subarray(1), 'length mismatch')).toThrow();
    expect(() => same(new Uint32Array([0x7fc00001]), new Uint32Array([0x7fc00002]), 'integer bytes')).toThrow();
  });

  it('finalizeTier: 5,000 seeded cases, including f32/f64 extremes, all slots, footprints and overlapping views', () => {
    const r = new RNG(0x614609), a = new ServicesSystem(), b = new ServicesSystemOriginal();
    for (let trial = 0; trial < 5000; trial++) {
      const N = r.pick([0, 1, 2, 3, 7, 16]), C = N * N, k = trial % 9;
      const st = { size: N, cells: C } as CityState;
      for (const name of LAYERS) record(st)[name] = field(r, C + 3);
      const cov = field(r, C + 3), A = field(r, C + 3), need = field(r, C + 3, 500);
      if (trial % 16 < 2) { cov.fill(trial % 2); need.fill(trial % 2); }
      // Preserve the old two-pass semantics when a caller supplies aliased / overlapping views.
      if (trial % 16 === 2) record(st)[LAYERS[k]] = cov.subarray(1, C + 1);
      if (trial % 16 === 3) record(st)[LAYERS[k]] = need.subarray(1, C + 1);
      if (trial % 16 === 4) record(st)[LAYERS[k]] = A.subarray(1, C + 1);
      if (trial % 16 === 5) record(st)[LAYERS[k]] = cov;
      const multi = Array.from({ length: r.int(0, 5) }, () => ({ x: r.int(-2, N + 1), z: r.int(-2, N + 1), w: r.int(1, 6), d: r.int(1, 6) } as Building));
      const fac = Array.from({ length: r.int(0, 8) }, (_, id) => ({ id } as Building));
      const op = fac.map(() => r.chance(0.4) ? r.pick(SPECIAL) : r.range(0, 2));
      const cap = fac.map(() => r.chance(0.4) ? r.pick(SPECIAL) : r.range(0, 1e5));
      const input = { st, cov, A, need, multi, fac, op, cap, util: field(r, 10, 2), tiers: field(r, 10, 10) };
      const copy = structuredClone(input);
      const shared = r.chance(0.5);
      for (const [svc, v] of [[a, input], [b, copy]] as const) {
        const p = probe(svc);
        p.cov = v.cov; p.A = v.A; p.multi = v.multi; p.shared[k] = shared;
        p.fac[k] = v.fac; p.facOp[k] = v.op; p.facCap[k] = v.cap;
        p.utilById = v.util; p.tierById = v.tiers;
        p.finalizeTier(v.st, k, v.need);
      }
      same(input, copy, `finalize ${trial}`);
      sameSystem(a, b, `finalize ${trial}`);
    }
  });

  it('transit disks: 5,000 seeded cases with borders, empty/full grids, overlaps, modes, skips and special funding', () => {
    const r = new RNG(0x73a951), st = newState(12);
    const plain = place(st, 't_bus', 0, 0).id, own = place(st, 'tr_bus_stop', 4, 4).id;
    for (let trial = 0; trial < 5000; trial++) {
      const N = r.pick([0, 1, 2, 5, 9, 17, 33]), C = N * N;
      const state = { ...st, size: N, cells: C } as CityState;
      const n = trial % 31 === 0 ? C : r.int(0, 16);
      const stops: StopList = { n, bid: new Int32Array(n), mode: new Uint8Array(n), cell: new Int32Array(n) };
      for (let s = 0; s < n; s++) {
        stops.bid[s] = r.pick([-1, plain, own, 99999]);
        stops.mode[s] = r.pick([Transit.Bus, Transit.Subway, Transit.Train, Transit.Ferry, 0, 255]);
        stops.cell[s] = trial % 31 === 0 ? s : r.pick([0, C - 1, N - 1, C - N, r.int(-2 * N, C + 2 * N)]);
      }
      const funding = trial < SPECIAL.length ? SPECIAL[trial] : r.chance(0.3) ? r.pick(SPECIAL) : r.range(-2, 3);
      const out = field(r, C + trial % 3), original = out.slice(), seen: number[] = [], seenOriginal: number[] = [];
      const skip = r.chance(0.5), filter = r.chance(0.7), active = new Uint8Array(n);
      for (let s = 0; s < n; s++) active[s] = r.int(0, 1);
      computeTransitCoverageCached(state, stops, out, funding, skip, filter ? (s) => { seen.push(s); return !!active[s]; } : undefined);
      computeTransitCoverageOriginal(state, stops, original, funding, skip, filter ? (s) => { seenOriginal.push(s); return !!active[s]; } : undefined);
      same(out, original, `transit ${trial}`);
      same(seen, seenOriginal, `transit callback order ${trial}`);
    }
  });

  it('transit disks retain the general path for modified fractional/large radii and grids', () => {
    const saved = { ...TRANSIT_COV_RADIUS }, r = new RNG(14), st = newState(17);
    const stops: StopList = { n: 3, bid: new Int32Array([-1, -1, -1]), mode: new Uint8Array([1, 2, 3]), cell: new Int32Array([0, 130, 288]) };
    try {
      for (const radius of [0, -1, 0.5, 4.25, 65, Infinity, -Infinity, NaN]) for (const N of [17, 17.5]) {
        TRANSIT_COV_RADIUS.bus = TRANSIT_COV_RADIUS.subway = TRANSIT_COV_RADIUS.train = radius;
        const state = { ...st, size: N } as CityState, a = field(r, 300), b = a.slice();
        computeTransitCoverageCached(state, stops, a, 0.875);
        computeTransitCoverageOriginal(state, stops, b, 0.875);
        same(a, b, `radius ${radius}, size ${N}`);
      }
    } finally { Object.assign(TRANSIT_COV_RADIUS, saved); }
  });

  it('finishTransit: 128 passes preserve stop discovery, attachment, funding and composition bytes', () => {
    const p = pair(city(24, 115)), r = new RNG(0xb0570);
    p.a.compute(p.sa, false); p.b.compute(p.sb, false);
    for (let trial = 0; trial < 128; trial++) {
      const cov = field(r, p.sa.state.cells), funding = r.pick([0, 45, 100, 150, 1e9, -1, NaN, Infinity]);
      for (const sim of [p.sa, p.sb]) {
        sim.state.day++;
        sim.state.transitCov.set(cov);
        sim.state.budget.funding.transit = funding;
        // Full and empty road-stop sets exercise the reusable StopList's growth and tail entries.
        sim.state.network.fill(trial % 3 ? Network.Road : Network.None);
        sim.state.netFlags.fill(trial % 2 ? NETFLAG_BUS_STOP : 0);
        for (const b of sim.state.buildings.values()) b.flags = trial % 5 ? BF.Powered | BF.Watered : BF.Abandoned;
      }
      probe(p.a).finishTransit(p.sa); probe(p.b).finishTransit(p.sb);
      check(p, `finishTransit ${trial}`);
    }
  });

  it('reachOf/tierWork: 256 seeded passes preserve caches, reach bytes, work estimates and invalidation', () => {
    const r = new RNG(0xcac4e), p = pair(city(12, 91));
    for (let trial = 0; trial < 256; trial++) {
      if (trial % 32 === 0) {
        const st = city(r.pick([8, 12, 16]), r.int(1, 0x7fffffff));
        p.sa.state = cloneCity(st); p.sb.state = cloneCity(st);
      }
      const N = p.sa.state.size, i = r.int(0, N * N - 1), x = i % N, z = (i - x) / N;
      if (trial % 4 === 0) {
        const net = r.int(0, 6);
        for (const sim of [p.sa, p.sb]) sim.state.network[i] = net;
        // Alternate hash-only invalidation with exact event rectangles.
        if (trial % 8 === 0) for (const s of [p.a, p.b]) probe(s).invalidateReach({ x0: x, x1: x, z0: z, z1: z });
      }
      if (trial % 11 === 0) for (const sim of [p.sa, p.sb]) sim.state.water[i] ^= 1;
      if (trial % 13 === 0) for (const sim of [p.sa, p.sb]) {
        const b = [...sim.state.buildings.values()][trial % sim.state.buildings.size];
        b.x = (b.x + 1) % N; b.rot = ((b.rot + 1) % 4) as Building['rot'];
        if (trial % 26 === 0) b.def = 't_school';
      }
      if (trial % 17 === 0) for (const sim of [p.sa, p.sb]) {
        const b = sim.state.buildings.values().next().value!;
        sim.state.buildings.delete(b.id);
      }
      for (const [s, sim] of [[p.a, p.sa], [p.b, p.sb]] as const) {
        sim.state.day += 2;
        probe(s).prep(sim); probe(s).stepIdx = 1;
      }
      check(p, `cache ${trial} prep`);
      do {
        probe(p.a).tierWork(p.sa); probe(p.b).tierWork(p.sb);
        check(p, `cache ${trial} tier`);
      } while (probe(p.a).stepIdx === 1);
    }
  });

  it('reuses typed records and reads every warm reach in place without retaining removed facilities', () => {
    const p = pair(city(16, 67));
    for (let i = 0; i < 3; i++) { p.a.compute(p.sa, false); p.b.compute(p.sb, false); check(p, `warmup ${i}`); }
    const a = typed(p.a), tables = new Set([a.curRec, ...a.cache.flatMap((c) => c ? [c.rec] : [])]);
    const buffers = new Set([...tables].flatMap((r) => [r.key, r.start, r.end, r.box, r.road, r.valid]));
    const pools = a.cache.map((c) => c && { idx: c.idx, w: c.w, top: c.top });
    for (let i = 0; i < 3; i++) {
      pass(p, `reuse ${i}`);
      for (let k = 0; k < a.cache.length; k++) {
        const c = a.cache[k];
        if (!c) continue;
        expect(tables.has(c.rec)).toBe(true);
        for (const buf of [c.rec.key, c.rec.start, c.rec.end, c.rec.box, c.rec.road, c.rec.valid]) expect(buffers.has(buf)).toBe(true);
        expect(c.idx).toBe(pools[k]!.idx); expect(c.w).toBe(pools[k]!.w); expect(c.top).toBe(pools[k]!.top);
      }
    }
    for (const sim of [p.sa, p.sb]) { sim.state.buildings.clear(); sim.state.building.fill(-1); sim.state.day++; }
    pass(p, 'empty after reuse');
    expect(a.cache.every((c) => c === null)).toBe(true);
    expect(a.curRec.slot.size).toBe(0);
  });

  it('108 passes on one city: every slot, facility churn, staffing, funding, hashes, load and reset', () => {
    const st = newState(24), defs = BASE_DEFS.slice(0, 9).map((id) => `exact_${id}`);
    st.network.fill(Network.Road);
    st.systemData.justice = { cityFill: 1 };
    for (let k = 0; k < defs.length; k++) for (let c = 0; c < 3; c++) {
      place(st, defs[k], 3 + 6 * c, 2 + 2 * k, { flags: BF.Powered | BF.Watered, hire: 1, jobs: 100 });
    }
    for (let x = 2; x < 22; x += 2) place(st, 't_r1', x, 22, { pop: 8000 });
    const p = pair(st), seen = new Set<number>(), emptied = new Set<number>();
    p.a.init(p.sa); p.b.init(p.sb); check(p, 'churn init');
    expect(typed(p.a).cache.every((c) => c && c.rec.slot.size > 0)).toBe(true);
    for (let n = 0; n < 108; n++) {
      const action = n % 12, cycle = Math.floor(n / 12);
      if (n === 48 || n === 84) {
        const old = new Set(typed(p.a).cache.flatMap((c) => c ? [c.idx] : []));
        for (const sim of [p.sa, p.sb]) sim.replaceState(n === 48
          ? deserializeCity(serializeCity(sim.state, { copy: true })) : cloneCity(sim.state));
        check(p, `churn reset ${n}`);
        for (const c of typed(p.a).cache) if (c) expect(old.has(c.idx)).toBe(false);
      }
      for (const sim of [p.sa, p.sb]) {
        const st = sim.state, N = st.size;
        st.day += 3;
        const facilities = [...st.buildings.values()].filter((b) => defs.includes(b.def));
        if (action === 1 || action === 2) {
          for (const service of ['police', 'fire', 'education', 'health', 'parks', 'transit'] as const) {
            st.budget.funding[service] = action === 1 ? [0, 45, 150][cycle % 3] : 100;
          }
          for (const b of facilities) {
            b.hire = 1; b.jobs = action === 1 ? 0 : 100;
            b.flags = action === 1 ? BF.Understaffed : BF.Powered | BF.Watered;
            sim.events.emit('buildingChanged', b);
          }
        }
        if (action === 3) for (const b of facilities) st.building[b.z * N + b.x] = -1;
        if (action === 3) for (const b of facilities) {
          b.x = (b.x + 1) % N; b.rot = ((b.rot + 1) % 4) as Building['rot'];
          st.building[b.z * N + b.x] = b.id;
          sim.events.emit('buildingChanged', b);
        }
        if (action === 4) for (const def of defs) {
          const b = facilities.find((b) => b.def === def)!;
          st.buildings.delete(b.id); st.building[b.z * N + b.x] = -1;
          sim.events.emit('buildingRemoved', b);
          const added = place(st, def, b.x, b.z, { flags: BF.Powered | BF.Watered, hire: 1, jobs: 100 });
          sim.events.emit('buildingAdded', added);
        }
        if (action === 5 || action === 6) for (const b of facilities) {
          if (b.def !== defs[cycle]) continue;
          b.flags = action === 5 ? BF.Abandoned : BF.Powered | BF.Watered;
          sim.events.emit('buildingChanged', b);
        }
        if (action === 7 || action === 8) {
          const i = (cycle * 29 + action) % st.cells;
          st.network[i] = st.network[i] === Network.Road ? Network.Avenue : Network.Road;
          // action 8 bypasses events and must be caught by the network hash.
          if (action === 7) sim.events.emit('networkChanged', { x0: i % N, x1: i % N, z0: Math.floor(i / N), z1: Math.floor(i / N) });
        }
        if (action === 9) st.water[(cycle * 31 + 5) % st.cells] ^= 1;
        if (action === 10) {
          // The same ids migrate between tier slots, including transit, without a network change.
          const a = facilities.find((b) => b.def === defs[cycle])!;
          const b = facilities.find((b) => b.def === defs[(cycle + 1) % 9])!;
          [a.def, b.def] = [b.def, a.def];
          sim.events.emit('buildingChanged', a); sim.events.emit('buildingChanged', b);
        }
      }
      check(p, `churn edit ${n}`);
      pass(p, `churn ${n}`);
      for (let k = 0; k < 9; k++) if (typed(p.a).cache[k]?.rec.slot.size) seen.add(k);
      if (action === 5) { expect(typed(p.a).cache[cycle]).toBeNull(); emptied.add(cycle); }
      if (action === 6) expect(typed(p.a).cache[cycle]!.rec.slot.size).toBeGreaterThan(0);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...emptied].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('grows and compacts typed caches, preserving committed reaches across a restarted partial search', () => {
    const st = newState(40);
    st.network.fill(Network.Road);
    for (let i = 0; i < 80; i++) place(st, 'exact_civ_elementary_school', 2 + 2 * (i % 16), 2 + 3 * Math.floor(i / 16),
      { flags: BF.Powered | BF.Watered });
    for (let x = 0; x < 40; x += 2) place(st, 't_r1', x, 22, { pop: 10000 });
    const p = pair(st), k = NEED_ORDER.indexOf('elementary');
    pass(p, 'growth cold');
    expect(typed(p.a).cache[k]!.rec.key.length).toBeGreaterThanOrEqual(80);
    for (const sim of [p.sa, p.sb]) {
      sim.state.day++;
      for (const b of sim.state.buildings.values()) if (b.def === 'exact_civ_elementary_school') b.x++;
    }
    p.a.step(p.sa); p.b.step(p.sb); check(p, 'restart prep');
    p.a.step(p.sa); p.b.step(p.sb); check(p, 'restart search');
    const a = typed(p.a), old = a.cache[k]!, pending = a.curRec;
    expect(a.tierSlot).toBe(k); expect(a.tierPhase).toBe(1);
    expect(pending.slot.size).toBeGreaterThan(0); expect(pending.slot.size).toBeLessThan(80);
    for (const [id, q] of pending.slot) expect(pending.key[q]).not.toBe(old.rec.key[old.rec.slot.get(id)!]);
    // compute() restarts at prep; stepping it manually also checks each cold/warm cost and boundary.
    probe(p.a).stepIdx = probe(p.b).stepIdx = -1;
    pass(p, 'restart with old committed keys');
    let compacted = false, grew = false;
    for (let n = 0; n < 8; n++) {
      for (const sim of [p.sa, p.sb]) { sim.state.day++; sim.state.water[799] ^= 1; }
      pass(p, `growth invalid ${n}`);
      const c = a.cache[k]!, top = c.top;
      grew ||= c.idx.length > 65536;
      pass(p, `growth warm ${n}`);
      compacted ||= c.top < top;
      expect(c.top).toBeLessThanOrEqual(2 * c.used);
    }
    expect(grew).toBe(true); expect(compacted).toBe(true);
  });

  it('16 generated cities: six passes each, every state field/array and scheduler boundary, with edits and reloads', () => {
    let interrupted = false;
    const provider = tierProvider('police');
    try {
      for (let seed = 1; seed <= 16; seed++) {
        // Cover both capacity-free and shared police (WP7), plus caller-supplied need rasters.
        registerTierProvider('police', seed % 2 ? null : {
          shared: true, capacityOf: (_st, b) => 10 + b.id % 300,
          needOf: (st, res, out) => { for (let i = 0; i < out.length; i++) out[i] = res[i] * (0.5 + st.crime[i]); },
        });
        const p = pair(city(seed === 16 ? 64 : [8, 12, 24, 40][seed % 4], seed, seed === 16 ? 8 : 1));
        probe(p.a).firstPass = probe(p.b).firstPass = true;
        for (let n = 0; n < 6; n++) {
          if (n === 1) { p.a.init(p.sa); p.b.init(p.sb); check(p, `city ${seed} init`); }
          for (const sim of [p.sa, p.sb]) {
            const st = sim.state;
            st.day += 3;
            if (n === 2) {
              st.network[0] = Network.Avenue;
              sim.events.emit('networkChanged', { x0: 0, x1: 0, z0: 0, z1: 0 });
              st.subway[0] ^= 1;
              sim.events.emit('subwayChanged', { x0: 0, x1: 0, z0: 0, z1: 0 });
            }
            if (n === 3) { st.water[st.cells >> 1] ^= 1; st.network[st.cells - 1] = Network.Road; }
            if (n === 4) {
              st.budget.funding.education = 45; st.budget.funding.transit = 150;
              const b = st.buildings.values().next().value!;
              b.flags ^= BF.Powered | BF.Watered; b.def = 't_school'; b.rot = 1;
              sim.events.emit('buildingChanged', b);
              const removed = [...st.buildings.values()][1];
              st.buildings.delete(removed.id); st.building[removed.z * st.size + removed.x] = -1;
              sim.events.emit('buildingRemoved', removed);
              const added = place(st, 't_school', removed.x, removed.z);
              sim.events.emit('buildingAdded', added);
            }
            if (n === 5) {
              // Save/load discards reaches even at the same size; a changed map size exercises ensure too.
              sim.state = seed % 2 ? deserializeCity(serializeCity(st, { copy: true })) : city(12, seed + 100);
            }
          }
          pass(p, `city ${seed} pass ${n}`, () => {
            const a = probe(p.a);
            if (seed !== 16 || n !== 0 || interrupted || a.stepIdx !== 1 || a.cursor === 0) return;
            interrupted = true;
            // Invalidate both the committed caches and the pending records between scheduled steps.
            for (const [svc, sim] of [[p.a, p.sa], [p.b, p.sb]] as const) {
              sim.state.network[1] = Network.Rail;
              probe(svc).invalidateReach(undefined);
              const next = probe(svc).fac[probe(svc).tierSlot]?.[probe(svc).cursor];
              if (next) sim.state.buildings.delete(next.id);
            }
          });
        }
      }
    } finally { registerTierProvider('police', provider ?? null); }
    expect(interrupted, 'dense small city crosses a tier work boundary').toBe(true);
  });

  it('restarting a cold partial tier pass discards only pending records', () => {
    const p = pair(city(64, 813, 8));
    p.a.step(p.sa); p.b.step(p.sb);
    p.a.step(p.sa); p.b.step(p.sb);
    check(p, 'partial');
    expect(probe(p.a).stepIdx).toBe(1);
    expect(typed(p.a).curRec.slot.size).toBeGreaterThan(0);
    p.a.compute(p.sa, false); p.b.compute(p.sb, false);
    check(p, 'restarted');
    pass(p, 'warm after restart');
  });
});
