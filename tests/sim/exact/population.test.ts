import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RNG } from '../../../src/core/rng';
import { DevType, Network } from '../../../src/core/types';
import { BF, CityState, type Building } from '../../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../../src/sim/Simulation';
import { CATALOG, getDef, rebuildCatalogIndex } from '../../../src/sim/catalog';
import type { BuildingDef } from '../../../src/sim/catalogTypes';
import { placeBuilding, removeBuilding } from '../../../src/sim/economy/buildings';
import { demographicsData } from '../../../src/sim/economy/demographics';
import { populationSystem } from '../../../src/sim/economy/population';
import { EconRuntime } from '../../../src/sim/economy/runtime';
import { COARSE, OCC_PERIOD } from '../../../src/sim/economy/tuning';
import { deserializeCity, serializeCity } from '../../../src/save/serialize';
import { newState, place, registerTestDefs } from '../../infra/cityGen';
import { populationSystemOriginal } from './populationOriginal';

const catalogBefore = CATALOG.slice();
let cityDefs: BuildingDef[];
beforeAll(() => {
  registerTestDefs();
  cityDefs = CATALOG.filter((d) => d.devType !== undefined || d.id.startsWith('t_'));
});
afterAll(() => {
  CATALOG.splice(0, CATALOG.length, ...catalogBefore);
  rebuildCatalogIndex();
});
beforeEach(() => {
  // Compare the profiling field too, under identical clock inputs; no timing runs in this suite.
  vi.spyOn(performance, 'now').mockReturnValue(100);
  vi.spyOn(Date, 'now').mockReturnValue(1000);
});
afterEach(() => vi.restoreAllMocks());

const floats = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, Math.fround(1e-40), -1e-40,
  0.1, -0.1, 1, 1e30, -1e30, 1e300, -1e300, Infinity, -Infinity, NaN];
const numberBits = new Float64Array(2);
const numberWords = new Uint32Array(numberBits.buffer);

/** Compare all own fields, ordered Map/Set contents and typed-array bytes (including NaN payloads and signed zero). */
function exact(actual: unknown, expected: unknown, path: string): void {
  if (typeof actual === 'number' && typeof expected === 'number') {
    numberBits[0] = actual; numberBits[1] = expected;
    if (numberWords[0] !== numberWords[2] || numberWords[1] !== numberWords[3]) {
      throw new Error(`${path}: number bits differ (${actual}, ${expected})`);
    }
    return;
  }
  if (actual === expected) return;
  if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object') {
    throw new Error(`${path}: ${String(actual)} != ${String(expected)}`);
  }
  if (actual.constructor !== expected.constructor) throw new Error(`${path}: constructors differ`);
  if (ArrayBuffer.isView(actual) && ArrayBuffer.isView(expected)) {
    const a = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength);
    const b = Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength);
    if (!a.equals(b)) throw new Error(`${path}: typed-array bytes differ`);
    return;
  }
  if (actual instanceof Map && expected instanceof Map) return exact([...actual], [...expected], `${path}.entries`);
  if (actual instanceof Set && expected instanceof Set) return exact([...actual], [...expected], `${path}.values`);
  if (Array.isArray(actual) && Array.isArray(expected) && actual.length !== expected.length) throw new Error(`${path}: lengths differ`);
  const ak = Object.keys(actual), ek = Object.keys(expected);
  if (ak.length !== ek.length || ak.some((k, i) => k !== ek[i])) throw new Error(`${path}: keys differ`);
  for (const k of ak) exact((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${path}.${k}`);
}

function cloneState(st: CityState): CityState {
  return Object.assign(Object.create(CityState.prototype), structuredClone(st));
}

interface Arm {
  sim: Simulation;
  rt: EconRuntime;
  pop: ReturnType<typeof populationSystem>;
  events: unknown[];
  calls: number[];
}
type Pair = [Arm, Arm];
interface Options {
  traffic?: 'none' | 'array' | 'callback';
  access?: Float32Array;
  setup?: (rt: EconRuntime) => void;
}

function arm(st: CityState, original: boolean, options: Options): Arm {
  const rt = new EconRuntime();
  const pop = (original ? populationSystemOriginal : populationSystem)(rt);
  const calls: number[] = [], events: unknown[] = [];
  const access = options.access?.slice() ?? new Float32Array(st.nextBuildingId).fill(0.7);
  const traffic = {
    name: 'traffic',
    workerAccess(id: number) { calls.push(id); return id < access.length ? access[id] : -1; },
    ...(options.traffic === 'array' ? { accessById: access } : {}),
    jobFill(id: number) { return id % 7 / 6; },
  };
  const setup: SimSystem = { name: 'test.setup', init(sim) { rt.attach(sim); options.setup?.(rt); } };
  const sim = new Simulation(cloneState(st), [...(options.traffic && options.traffic !== 'none' ? [traffic] : []), setup, pop]);
  for (const event of ['buildingAdded', 'buildingRemoved', 'buildingChanged', 'layerUpdated', 'reset'] as const) {
    sim.events.on(event, (value) => events.push([event, structuredClone(value)]));
  }
  return { sim, rt, pop, events, calls };
}

function pair(st: CityState, options: Options = {}): Pair {
  return [arm(st, true, options), arm(st, false, options)];
}

function runtimeOutput(rt: EconRuntime): Record<string, unknown> {
  // Omit only the simulation backreferences and event subscriptions. Include private list/def caches and timing.
  return Object.fromEntries(Object.entries(rt).filter(([k]) => !['sim', 'subscribedTo', 'initializedFor', 'unsub'].includes(k)));
}

function check(p: Pair, label: string): void {
  exact(p[1].sim.state, p[0].sim.state, `${label}.state`);
  exact(runtimeOutput(p[1].rt), runtimeOutput(p[0].rt), `${label}.runtime`);
  exact(p[1].events, p[0].events, `${label}.events`);
  exact(p[1].calls, p[0].calls, `${label}.workerAccess order`);
  for (const a of p) { a.events.length = 0; a.calls.length = 0; }
}

function day(p: Pair, day: number, label: string): void {
  for (const a of p) { a.sim.state.day = day; a.pop.daily!(a.sim); }
  check(p, label);
}

function randomBuilding(rng: RNG, size: number, id: number, wild: boolean): Building {
  const eligible = cityDefs.filter((d) => d.footprint[0] <= size && d.footprint[1] <= size);
  const def = rng.pick(eligible);
  const [w, d] = def.footprint;
  const val = () => wild ? rng.pick(floats) : rng.range(0, 2000);
  const share = () => rng.chance(0.25) ? undefined : Math.fround(wild ? rng.pick(floats) : rng.range(0, 0.3));
  return {
    id, def: def.id, x: rng.int(0, size - w), z: rng.int(0, size - d), w, d, rot: rng.pick([0, 1, 2, 3] as const), variant: 0,
    pop: val(), jobs: val(), capacity: val(), wealth: rng.int(1, 3), built: rng.next(), age: rng.int(0, 2000),
    flags: rng.pick([0, BF.Abandoned, BF.Burnt, BF.Constructing, BF.OnFire, BF.Powered | BF.Watered])
      | (def.devType === undefined && rng.chance(0.7) ? BF.Plopped : 0),
    baseY: 5, health: rng.next(), unhappy: rng.int(0, 60),
    kids: share(), teens: share(), yad: share(), srs: share(), edu: share(), wf: share(), hire: share(),
  };
}

function randomCity(rng: RNG, size: number, count: number, wild = false): CityState {
  const st = newState(size);
  st.day = rng.pick([0, 1, OCC_PERIOD - 1, OCC_PERIOD, 8 * OCC_PERIOD - 1, 8 * OCC_PERIOD, 361]);
  st.systemData.infraVersion = 1;
  st.systemData.infraLayers = { utilities: rng.chance(0.5), traffic: rng.chance(0.8), pollution: false, services: !wild && rng.chance(0.5) };
  st.systemData.regionJobs = wild ? rng.pick(floats) : rng.int(-10, 2000);
  if (rng.chance(0.5)) st.neighborConnections.push({ edge: 'n', x: 0, z: 0, type: Network.Road });
  for (let dev = 0; dev < 12; dev++) {
    st.stats.demand[dev] = rng.range(-1, 1);
    st.desirability[dev].fill(rng.range(-1, 1));
  }
  for (const a of [st.crime, st.noise, st.airPollution, st.eduElemCov, st.eduHighCov, st.eduCollegeCov,
    st.healthCov, st.playCov, st.greenCov, st.shopAccess, st.transitCov]) a.fill(rng.next());
  for (let k = 0; k < count; k++) {
    st.nextBuildingId += rng.int(0, 2);
    const b = randomBuilding(rng, size, st.nextBuildingId, wild);
    const placed = place(st, b.def, b.x, b.z, b);
    if (rng.chance(0.04)) placed.def = 'exact.missing';
  }
  const dd = demographicsData(st);
  dd.eduMean = rng.chance(0.5) ? -1 : rng.next();
  if (rng.chance(0.5)) dd.wfNow = rng.next();
  dd.empRatio = rng.chance(0.5) ? -1 : rng.next();
  if (rng.chance(0.3)) {
    const cc = Math.ceil(size / COARSE) ** 2;
    const grid = () => Float32Array.from({ length: cc }, () => rng.range(0, 1000));
    st.systemData.popGrids = { v: 1, popW: [grid(), grid(), grid()], skill: grid(), kids: grid(),
      coh: Float64Array.from({ length: 15 }, () => rng.next()) };
  }
  return st;
}

describe('population: bit-identical to 614609f', () => {
  // 2,000 independent generated cities × 6 calls = 12,000 randomized differential cases.
  for (let batch = 0; batch < 10; batch++) {
    it(`1,200 seeded cases, batch ${batch}`, () => {
      const rng = new RNG(0x614609f + batch);
      let cases = 0;
      for (let trial = 0; trial < 200; trial++) {
        const wild = trial % 17 === 0;
        const size = rng.pick([1, 7, 8, 9, 16, 17, 24, 33]);
        const st = randomCity(rng, size, trial % 23 === 0 ? 96 : rng.int(0, 24), wild);
        const traffic = rng.pick(['none', 'array', 'callback'] as const);
        const access = Float32Array.from({ length: rng.int(0, st.nextBuildingId + 10) }, () => rng.pick([-1, 0, 0.3, 0.9, 1, 2, NaN, Infinity]));
        const p = pair(st, { traffic, access });
        const label = `batch ${batch}, city ${trial}`;
        check(p, `${label}, init`); cases++;
        day(p, 1, `${label}, warm`); cases++;
        const added = randomBuilding(rng, size, st.nextBuildingId + 3, wild);
        for (const a of p) {
          a.sim.state.nextBuildingId = added.id + 1;
          placeBuilding(a.sim, { ...added });
        }
        day(p, OCC_PERIOD, `${label}, added/sample`); cases++;
        const upgrade = rng.pick(cityDefs.filter((d) => d.devType !== undefined));
        for (const a of p) {
          const b = a.sim.state.buildings.get(added.id)!;
          b.def = upgrade.id; b.capacity = upgrade.capacity ?? 100;
          b.x = size - 1; b.z = size - 1; b.w = 1; b.d = 1;
          // Also test direct edits: the original defOf validates even without buildingChanged.
          if (trial % 2) a.sim.events.emit('buildingChanged', b);
        }
        day(p, 8 * OCC_PERIOD, `${label}, upgraded/demo`); cases++;
        const removedId = p[0].rt.growables[0]?.id ?? added.id;
        for (const a of p) removeBuilding(a.sim, a.sim.state.buildings.get(removedId)!);
        day(p, 8 * OCC_PERIOD + 1, `${label}, swap-remove`); cases++;
        const reused = randomBuilding(rng, size, removedId, wild);
        for (const a of p) placeBuilding(a.sim, { ...reused });
        day(p, 25, `${label}, reused id/EQ-HQ`); cases++;
      }
      expect(cases).toBe(1200);
    }, 20_000);
  }

  it('empty/full grids, coarse borders, flags, extreme floats and mismatched grid lengths', () => {
    const rng = new RNG('population edges');
    let cases = 0;
    for (const size of [1, 7, 8, 9, 17, 32, 65]) {
      for (const flags of [-1, 0, BF.Abandoned | BF.Burnt, BF.Constructing]) {
        const st = newState(size);
        if (flags >= 0) {
          for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
            place(st, rng.pick(['t_r1', 't_cs', 't_id', 't_iht']), x, z, {
              flags, built: -Infinity, pop: rng.pick(floats), jobs: rng.pick(floats), capacity: rng.pick(floats),
              kids: rng.pick(floats), teens: rng.pick(floats), yad: rng.pick(floats), srs: rng.pick(floats), edu: rng.pick(floats),
            });
          }
        }
        const p = pair(st, { setup(rt) {
          const cc = rt.cw * rt.cw;
          rt.coarsePopRaw = new Float32Array(cc + 3).fill(-0);
          rt.coarseWealthRaw = new Float32Array(cc + 3).fill(-0);
          rt.coarseCountRaw = new Float32Array(cc + 3).fill(-0);
          rt.coarsePop = new Float32Array(cc + 3).fill(-0);
          rt.coarseWealth = new Float32Array(cc + 3).fill(-0);
          if (size % 2) rt.coarsePopW = [new Float32Array(cc + 1), new Float32Array(0), new Float32Array(cc + 2)];
        } });
        check(p, `edge ${size}/${flags}, init`); cases++;
        day(p, OCC_PERIOD, `edge ${size}/${flags}, sample`); cases++;
        day(p, 8 * OCC_PERIOD, `edge ${size}/${flags}, demo`); cases++;
      }
    }
    expect(cases).toBe(84);
  });

  it('fractional/sparse ids, unknown defs, unsupported devTypes and out-of-map blocks', () => {
    const base = CATALOG.slice();
    try {
      for (const dev of [12, 7.5, NaN, Infinity]) CATALOG.push({ ...getDef('t_r1')!, id: `exact.dev.${dev}`, category: 'park', devType: dev });
      CATALOG.push({ ...getDef('t_r1')!, id: 'exact.noDev', category: 'park', devType: undefined });
      rebuildCatalogIndex();
      const p = pair(newState(9));
      const rng = new RNG('population ids');
      const ids = [0, 0.5, 1.5, -1, -0.5, 2049, 2 ** 20, 2 ** 31, Infinity, -Infinity, NaN];
      for (let k = 0; k < ids.length; k++) {
        const b = randomBuilding(rng, 9, ids[k], true);
        b.def = rng.pick(['t_r1', 't_cs', 'exact.dev.12', 'exact.dev.7.5', 'exact.dev.NaN', 'exact.dev.Infinity', 'exact.noDev', 'exact.missing']);
        b.x = rng.pick([-40, -1, 0, 8, 9, 90, 2 ** 33]); b.z = rng.pick([-40, 0, 8, 9, 2 ** 33]);
        b.flags = BF.Constructing;
        // Aggregate accepts these ids/coordinates. Skip the occupancy pre-pass and keep them out of construction's list.
        for (const a of p) a.rt.growables.push({ ...b });
      }
      for (const d of [1, OCC_PERIOD, 8 * OCC_PERIOD, 8 * OCC_PERIOD + 1]) day(p, d, `odd ids day ${d}`);
    } finally {
      CATALOG.splice(0, CATALOG.length, ...base);
      rebuildCatalogIndex();
    }
  });

  it('late catalog registration, in-place edits, same-length replacement and runtime resets', () => {
    const base = CATALOG.slice();
    try {
      const st = newState(16);
      const b = place(st, 't_r1', 0, 0, { pop: 100, jobs: 20, flags: BF.Constructing, built: -Infinity });
      b.def = 'exact.late';
      const p = pair(st);
      check(p, 'missing catalog def');
      day(p, 1, 'missing catalog def, warm');
      const def: BuildingDef = { ...getDef('t_r1')!, id: b.def, devType: DevType.R2 };
      CATALOG.push(def); rebuildCatalogIndex();
      day(p, OCC_PERIOD, 'registered later');
      expect(p[1].rt.totals.pop[DevType.R2]).toBe(100);
      def.devType = DevType.R3;
      day(p, 8 * OCC_PERIOD, 'in-place dev edit without rebuild');
      expect(p[1].rt.totals.pop[DevType.R3]).toBe(100);
      delete def.devType;
      day(p, 1, 'removed devType');
      def.devType = DevType.CS1;
      day(p, 2, 'added devType');
      CATALOG[CATALOG.indexOf(def)] = { ...def, devType: DevType.CO3 };
      rebuildCatalogIndex();
      day(p, 3, 'same-length replacement: preserve original runtime resolution');
      for (const a of p) {
        const next = { ...a.sim.state.buildings.get(b.id)!, id: a.sim.state.nextBuildingId++ };
        placeBuilding(a.sim, next);
      }
      day(p, 4, 'new id resolves replacement');
      expect(p[1].rt.totals.jobs[DevType.CO3]).toBe(20);
      for (const a of p) a.rt.reset();
      day(p, 5, 'direct runtime reset resolves replacement for both ids');
      expect(p[1].rt.totals.jobs[DevType.CO3]).toBe(40);
      for (const a of p) a.sim.events.emit('reset', undefined);
      day(p, 6, 'reset event');
      for (const a of p) a.pop.init!(a.sim);
      check(p, 'same-state init');
    } finally {
      CATALOG.splice(0, CATALOG.length, ...base);
      rebuildCatalogIndex();
    }
  });

  it('two cities in one process, save/load, replaceState and reattaching the same system', () => {
    const rng = new RNG('population city lifecycle');
    const p = pair(randomCity(rng, 17, 80), { traffic: 'array' });
    const other = pair(randomCity(rng, 33, 120), { traffic: 'callback' });
    check(p, 'city A init'); check(other, 'city B init');
    for (let d = 1; d <= 120; d++) {
      day(p, d, `city A day ${d}`);
      day(other, d, `city B day ${d}`);
      if (d === 47) {
        const saves = p.map((a) => serializeCity(a.sim.state, { copy: true }));
        exact(saves[1], saves[0], 'serialized city (no index cache)');
        for (let i = 0; i < p.length; i++) p[i].sim.replaceState(deserializeCity(saves[i]));
        check(p, 'save/load replaces state');
      }
      if (d === 73) {
        const next = randomCity(rng, 9, 30);
        for (const a of p) a.sim.replaceState(cloneState(next));
        check(p, 'new city reuses ids with different defs and size');
      }
    }
    const next = randomCity(rng, 8, 20);
    for (const a of p) {
      const old = a.sim;
      a.sim = new Simulation(cloneState(next), [a.pop]);
      old.events.emit('reset', undefined); // old runtime/population subscriptions must have been removed
    }
    check(p, 'reattach existing population system');
    day(p, 8 * OCC_PERIOD, 'reattached sample');
  });

  it('keeps definition reads live when traffic callbacks edit the catalog during aggregation', () => {
    const base = CATALOG.slice();
    try {
      const def: BuildingDef = { ...getDef('t_r1')!, id: 'exact.callback', devType: DevType.R1 };
      CATALOG.push(def); rebuildCatalogIndex();
      const st = newState(8);
      st.systemData.infraVersion = 1;
      st.systemData.infraLayers = { traffic: true, utilities: false, services: false, pollution: false };
      const first = place(st, 't_r1', 0, 0, { pop: 10, flags: BF.Constructing, built: -Infinity });
      place(st, def.id, 1, 0, { pop: 20, flags: BF.Constructing, built: -Infinity });
      const p = pair(st, { traffic: 'callback' });
      check(p, 'callback init');
      for (const a of p) {
        def.devType = DevType.R1;
        const traffic = a.sim.getSystem('traffic') as SimSystem & { workerAccess: (id: number) => number };
        traffic.workerAccess = (id) => {
          a.calls.push(id);
          if (id === first.id) def.devType = DevType.R2;
          return 0.8;
        };
        a.sim.state.day = 8 * OCC_PERIOD;
        a.pop.daily!(a.sim);
      }
      check(p, 'callback changes next building devType');
      expect(p[1].rt.totals.pop).toEqual([10, 20, 0]);
    } finally {
      CATALOG.splice(0, CATALOG.length, ...base);
      rebuildCatalogIndex();
    }
  });
});
