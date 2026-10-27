import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RNG } from '../../../src/core/rng';
import { DevType, Network, Zone } from '../../../src/core/types';
import { BF, CityState, type Building } from '../../../src/sim/CityState';
import { Simulation } from '../../../src/sim/Simulation';
import { CATALOG, getDef, rebuildCatalogIndex } from '../../../src/sim/catalog';
import type { BuildingDef } from '../../../src/sim/catalogTypes';
import { placeBuilding, removeBuilding } from '../../../src/sim/economy/buildings';
import { EconRuntime } from '../../../src/sim/economy/runtime';
import { conditionBreakdown, populationSystem } from '../../../src/sim/economy/population';
import { DemographicsCache, targetShares, updateDemographics } from '../../../src/sim/economy/demographics';
import { clearInfoCache } from '../../../src/sim/infra/common';
import { schedulerOf } from '../../../src/sim/infra/scheduler';
import { UtilitiesSystem } from '../../../src/sim/infra/utilities';
import { deserializeCity, serializeCity } from '../../../src/save/serialize';
import { place, registerTestDefs } from '../../infra/cityGen';
import {
  conditionBreakdownOriginal, DemographicsCacheOriginal, populationSystemOriginal, targetSharesOriginal,
  updateDemographicsOriginal, UtilitiesSystemOriginal,
} from './j10Original';

// Compare bytes first; V8 may canonicalize NaN payloads differently in different JIT tiers.
function exact(a: unknown, b: unknown, path = 'value'): void {
  if (Object.is(a, b)) return;
  const fail = () => { throw new Error(`J10 mismatch at ${path}: ${String(a)} / ${String(b)}`); };
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return fail();
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    if (a.constructor !== b.constructor || a.byteLength !== b.byteLength) return fail();
    const ab = Buffer.from(a.buffer, a.byteOffset, a.byteLength), bb = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
    if (ab.equals(bb)) return;
    if ((a instanceof Float32Array && b instanceof Float32Array) || (a instanceof Float64Array && b instanceof Float64Array)) {
      const stride = a.BYTES_PER_ELEMENT;
      for (let i = 0; i < a.length; i++) {
        if (Number.isNaN(a[i]) && Number.isNaN(b[i])) continue;
        for (let j = i * stride; j < (i + 1) * stride; j++) {
          if (ab[j] !== bb[j]) throw new Error(`J10 byte mismatch at ${path}[${i}], byte ${j}`);
        }
      }
      return;
    }
    return fail();
  }
  if (a instanceof Map && b instanceof Map) return exact([...a], [...b], path);
  if (a instanceof Set && b instanceof Set) return exact([...a], [...b], path);
  if (Array.isArray(a) !== Array.isArray(b)) return fail();
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return fail();
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return fail();
  for (const k of ak) exact((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
}

function fields(value: object, omit: readonly string[] = []): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([k, v]) => !omit.includes(k) && typeof v !== 'function'));
}

const extraDefs: BuildingDef[] = [
  { id: 'j10_nuclear', model: 'nuclear', category: 'power', powerOut: 10, waterUse: 5 },
  { id: 'j10_wind', model: 'wind', category: 'power', powerOut: 1 },
  { id: 'j10_solar', model: 'solar', category: 'power', powerOut: 2 },
  { id: 'j10_incin', model: 'incinerator', category: 'garbage', powerOut: 3 },
  { id: 'j10_desal', model: 'desal', category: 'water', waterOut: 3, powerUse: 1 },
  { id: 'j10_treatment', model: 'treatment', category: 'water', waterOut: 20, powerUse: 2 },
].map((d) => ({ name: d.id, footprint: [1, 1], ...d } as BuildingDef));
const ids = ['t_r1', 't_r2', 't_cs', 't_id', 't_iht', 't_small_plant', 't_pump', 't_clinic', 't_park', ...extraDefs.map((d) => d.id)];
const zones = [Zone.None, Zone.ResLow, Zone.ResMed, Zone.ResHigh, Zone.ComHigh, Zone.IndMed, Zone.Landfill];
const coverages = ['healthCov', 'eduElemCov', 'eduHighCov', 'eduCollegeCov', 'playCov', 'greenCov', 'shopAccess', 'transitCov', 'crime', 'noise', 'airPollution', 'waterPollution'] as const;
const special = [-0, 0, Number.MIN_VALUE, -Number.MIN_VALUE, 2 ** -149, -(2 ** -149), 1 - 2 ** -24, 1, 1 + 2 ** -23, -1, 1e30, -1e30, Number.MAX_VALUE, -Number.MAX_VALUE, Infinity, -Infinity, NaN];

beforeAll(() => {
  registerTestDefs();
  CATALOG.push(...extraDefs);
  rebuildCatalogIndex();
  clearInfoCache();
  // Wall-clock telemetry is not deterministic; fixed clocks also let us compare every timing field.
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.spyOn(Date, 'now').mockReturnValue(0);
});
afterAll(() => {
  CATALOG.splice(CATALOG.length - extraDefs.length, extraDefs.length);
  rebuildCatalogIndex();
  clearInfoCache();
  vi.restoreAllMocks();
});

function city(size: number, seed: number, mode: number): CityState {
  // Same flat CityState / place helpers as cityGen, with an explicitly seeded config.
  const st = new CityState({
    name: 'J10', mayor: 'Test', size, seed, difficulty: 'medium', climate: 'temperate', terrain: 'flat',
    waterAmount: 0, hilliness: 0, treeDensity: 0, disasters: false, startFunds: 100000, startYear: 2000,
  });
  const rng = new RNG(seed);
  st.heights.fill(5);
  st.stats.demand.fill(0.4);
  st.stats.sewageTreated = rng.next();
  for (let i = 0; i < st.cells; i++) {
    const x = i % size, z = (i / size) | 0;
    st.zone[i] = rng.pick(zones);
    if (mode !== 1 && (x % 4 === 1 || z % 3 === 1)) st.network[i] = Network.Road;
    st.powerLines[i] = rng.chance(0.2) ? 1 : 0;
    st.water[i] = rng.chance(0.1) ? 1 : 0;
    for (const key of coverages) st[key][i] = rng.next();
    for (const a of st.desirability) a[i] = rng.range(-0.5, 1);
    if (mode === 0 || (mode !== 1 && (st.network[i] || !rng.chance(0.45)))) continue;
    const def = getDef(mode === 1 ? 't_r1' : rng.pick(ids))!;
    const b = place(st, def.id, x, z, {
      pop: def.devType !== undefined && def.devType <= DevType.R3 ? rng.int(1, 60) : 0,
      jobs: def.devType !== undefined && def.devType > DevType.R3 ? rng.int(0, 40) : 0,
      capacity: rng.int(1, 120), wealth: rng.int(1, 3), age: rng.int(0, 360 * 70),
      flags: (def.category === 'growable' ? 0 : BF.Plopped) | rng.pick([0, BF.Constructing, BF.Burnt, BF.Abandoned, BF.Powered | BF.Watered]),
      built: rng.chance(0.1) ? rng.next() : 1, rot: rng.int(0, 3) as Building['rot'],
    });
    if (rng.chance(0.1)) b.def = 'j10_unknown';
    if (rng.chance(0.5)) {
      b.kids = Math.fround(rng.next() * 0.3); b.teens = Math.fround(rng.next() * 0.1);
      b.yad = Math.fround(rng.next() * 0.2); b.srs = Math.fround(rng.next() * 0.2);
      b.wf = Math.fround(rng.next()); b.edu = Math.fround(rng.next());
    }
  }
  return st;
}

function clone(st: CityState): CityState {
  return Object.assign(new CityState({ ...st.config }), structuredClone(st));
}

function arm(st: CityState, original: boolean) {
  const rt = new EconRuntime();
  const util = original ? new UtilitiesSystemOriginal() : new UtilitiesSystem();
  const pop = original ? populationSystemOriginal(rt) : populationSystem(rt);
  const sim = new Simulation(st);
  const events: unknown[] = [], steps: unknown[] = [];
  for (const name of ['buildingAdded', 'buildingRemoved', 'buildingChanged', 'layerUpdated', 'news', 'day', 'month', 'year', 'reset'] as const) {
    sim.events.on(name, (value) => events.push([name, structuredClone(value)]));
  }
  const traffic = {
    name: 'traffic', accessById: Float32Array.from({ length: 2048 }, (_, i) => i % 5 === 0 ? -1 : (i % 7) / 6),
    workerAccess(id: number) { return this.accessById[id] ?? -1; },
    jobFill(id: number) { return id % 4 === 0 ? -1 : (id % 3) / 2; },
  };
  const pollution = { name: 'pollution', incineratorShare: (id: number) => (id % 4) / 3 };
  sim.systems.push(util, pop, traffic, pollution);
  for (const system of sim.systems) system.init?.(sim);
  const trace = () => {
    const task = schedulerOf(sim).tasks[0], step = task.step;
    task.step = (s) => {
      steps.push([s.state.day, task.cost(s), task.due(s), task.urgent(s), fields(util).stepIdx]);
      step(s);
    };
  };
  trace();
  return { sim, rt, util, pop, events, steps, trace };
}
type Arm = ReturnType<typeof arm>;

function compare(a: Arm, b: Arm, label: string): void {
  exact(a.sim.state, b.sim.state, `${label}.state`);
  exact(fields(a.rt, ['sim', 'subscribedTo', 'initializedFor', 'unsub']), fields(b.rt, ['sim', 'subscribedTo', 'initializedFor', 'unsub']), `${label}.runtime`);
  exact(fields(a.util, ['simRef', 'unsub', 'useInfo']), fields(b.util, ['simRef', 'unsub', 'useInfo']), `${label}.utilities`);
  exact(fields(schedulerOf(a.sim), ['tasks']), fields(schedulerOf(b.sim), ['tasks']), `${label}.scheduler`);
  const ta = schedulerOf(a.sim).tasks[0], tb = schedulerOf(b.sim).tasks[0];
  exact([ta.cost(a.sim), ta.due(a.sim), ta.urgent(a.sim)], [tb.cost(b.sim), tb.due(b.sim), tb.urgent(b.sim)], `${label}.nextStep`);
  exact(a.steps, b.steps, `${label}.steps`);
  exact(a.events, b.events, `${label}.events`);
  a.events.length = b.events.length = a.steps.length = b.steps.length = 0;
}

function edit(sim: Simulation, seed: number, day: number): void {
  const st = sim.state, rng = new RNG(seed), all = [...st.buildings.values()];
  const i = rng.int(0, st.cells - 1), x = i % st.size, z = (i / st.size) | 0;
  const rect = { x0: x, z0: z, x1: x + 1, z1: z + 1 };
  st.zone[i] = rng.pick(zones);
  sim.events.emit('zoneChanged', rect);
  if (day % 3 === 0) {
    st.network[i] = st.network[i] ? Network.None : Network.Road;
    sim.events.emit('networkChanged', rect);
  }
  if (day % 7 === 0) {
    for (const key of coverages) st[key][i] = rng.next();
    sim.events.emit('layerUpdated', 'services');
  }
  if (day % 11 === 0) st.budget.funding.utilities = rng.pick([0, 50, 100, 150]);
  const b = all.length ? rng.pick(all) : undefined;
  if (b && day % 5 === 0) {
    // Same object and id, different def; no second def index may mask an upgrade.
    b.def = rng.pick((b.flags & BF.Plopped) ? ['t_pump', 't_park', 'j10_treatment'] : ['t_r1', 't_r2', 't_cs', 'j10_unknown']);
    b.wealth = rng.int(1, 3);
    sim.events.emit('buildingChanged', b);
  }
  if (b && day % 13 === 0) {
    removeBuilding(sim, b);
    // Reuse an id with a new object and def, and change the Map iteration position.
    if (day % 26 === 0) placeBuilding(sim, { ...b, def: 't_r2', flags: 0, pop: 30, built: 1, kids: undefined, edu: undefined });
  }
  if (day % 4 === 0 && st.building[i] < 0) {
    const id = st.nextBuildingId++;
    placeBuilding(sim, {
      id, def: 't_r1', x, z, w: 1, d: 1, rot: 0, variant: 0, pop: 8, jobs: 0, capacity: 12,
      wealth: 1, built: 0.5, age: 0, flags: BF.Constructing, baseY: 5, health: 1, unhappy: 0,
    });
  }
}

describe('J10 exact lookup reuse', () => {
  it('matches 10,240 generated city-days, with edits, simultaneous cities, loads and new cities', () => {
    const rng = new RNG('J10 city days');
    const sizes = [1, 2, 3, 5, 8, 9, 16, 17];
    let cases = 0;
    for (let run = 0; run < 16; run++) {
      const pairs = [0, 1].map((n) => {
        const st = city(sizes[(run + n) % sizes.length], rng.int(1, 0x7fffffff), (run + n) % 4);
        return [arm(clone(st), false), arm(clone(st), true)] as const;
      });
      for (const [a, b] of pairs) compare(a, b, `init ${run}`);
      for (let day = 1; day <= 320; day++) for (let n = 0; n < pairs.length; n++) {
        const [a, b] = pairs[n];
        const seed = rng.int(1, 0x7fffffff);
        edit(a.sim, seed, day); edit(b.sim, seed, day);
        if (day === 113 || day === 227) {
          const sa = serializeCity(a.sim.state, { copy: true }), sb = serializeCity(b.sim.state, { copy: true });
          exact(sa, sb, 'save');
          a.sim.replaceState(deserializeCity(sa)); b.sim.replaceState(deserializeCity(sb));
          a.trace(); b.trace();
        }
        if (day === 251) {
          const fresh = city(sizes[(run + n + 3) % sizes.length], seed, 2);
          a.sim.replaceState(clone(fresh)); b.sim.replaceState(clone(fresh));
          a.trace(); b.trace();
        }
        a.sim.advanceDay(); b.sim.advanceDay();
        compare(a, b, `run ${run}, city ${n}, day ${day}`);
        if (day % 31 === 0) {
          for (const home of a.rt.growables) {
            exact(conditionBreakdown(a.sim.state, home), conditionBreakdownOriginal(b.sim.state, b.sim.state.buildings.get(home.id)!), 'condition');
          }
        }
        cases++;
      }
    }
    expect(cases).toBe(10240);
  }, 45000);

  it('matches 1,024 demographic updates with special floats, cache invalidations, borders and changing defs', () => {
    const rng = new RNG('J10 float edges');
    const a = city(5, 10, 0), b = clone(a);
    const ca = new DemographicsCache(), cb = new DemographicsCacheOriginal();
    for (let c = 0; c < 1024; c++) {
      const def = getDef(rng.pick(['t_r1', 't_r2', 't_r3', 't_cs']))!;
      const ba = place(a, 't_r1', c % 5, ((c / 5) | 0) % 5, {
        id: c % 2 ? 1025 : 1, def: def.id, pop: rng.pick(special), age: rng.pick(special),
        kids: c % 3 ? rng.pick(special) : undefined, teens: rng.pick(special), yad: rng.pick(special), srs: rng.pick(special),
        wf: rng.pick(special), edu: c % 5 ? rng.pick(special) : undefined,
      });
      const bb = { ...ba };
      const i = c % 25;
      a.day = b.day = c;
      a.stats.hq = b.stats.hq = rng.pick(special);
      a.systemData.infraVersion = b.systemData.infraVersion = c % 4 ? 1 : undefined;
      for (const key of coverages) a[key][i] = b[key][i] = rng.pick(special);
      if (c % 3 === 0) { ca.invalidate(); cb.invalidate(); }
      const dt = rng.pick(special), pop0 = rng.pick(special);
      exact(targetShares(a, ba, def, i), targetSharesOriginal(b, bb, def, i), `target ${c}`);
      updateDemographics(a, ba, def, i, dt, pop0, undefined, c % 2 ? ca : undefined);
      updateDemographicsOriginal(b, bb, def, i, dt, pop0, undefined, c % 2 ? cb : undefined);
      exact(ba, bb, `demographics ${c}`);
      // i32 aliases f; f's byte comparison covers its integer record slots too.
      exact(fields(ca, ['i32']), fields(cb, ['i32']), `demographics cache ${c}`);
      // Negative integer sentinels can look like NaNs through f, so check integer slots explicitly as well.
      for (let o = 0; o < ca.i32.length; o += 16) {
        for (const k of [0, 4, 12, 13]) exact(ca.i32[o + k], cb.i32[o + k], `demographics integer ${c}.${o + k}`);
      }
      exact(a.systemData, b.systemData, `demographics data ${c}`);
    }
  });

  it('matches utilities steps with sparse ids, disconnected grids, special floats and edits between steps', () => {
    const rng = new RNG('J10 utilities edges');
    for (let c = 0; c < 32; c++) {
      const st = city(c % 2 ? 33 : 9, c + 100, 0);
      st.nextBuildingId = c % 2 ? 4096 : 1;
      // More than 256 disconnected components exercises the component-array growth paths.
      for (let i = 0; i < st.cells; i++) st.network[i] = ((i % st.size) % 2 === 0 && ((i / st.size) | 0) % 2 === 0) ? Network.Road : Network.None;
      const defs = c % 3 === 0 ? ['j10_treatment', ...ids] : c % 3 === 1 ? [...ids].reverse() : ids.filter((id) => id !== 'j10_treatment');
      for (let k = 0; k < defs.length; k++) {
        const i = (k * 3) % st.cells;
        place(st, defs[k], i % st.size, (i / st.size) | 0, {
          pop: rng.pick(special), jobs: rng.pick(special), capacity: rng.pick(special), built: rng.pick(special),
          flags: rng.pick([0, BF.Powered | BF.Watered, BF.Burnt, BF.Abandoned]),
        });
      }
      const a = arm(clone(st), false), b = arm(clone(st), true);
      compare(a, b, `edge init ${c}`);
      for (let step = 0; step < 12; step++) {
        a.sim.state.day++; b.sim.state.day++;
        edit(a.sim, c * 100 + step, step); edit(b.sim, c * 100 + step, step);
        if (step === 4) clearInfoCache();
        a.util.step(a.sim); b.util.step(b.sim);
        compare(a, b, `edge ${c} step ${step}`);
        for (let i = -1; i <= st.cells; i++) exact(a.util.waterQualityAt(a.sim, i), b.util.waterQualityAt(b.sim, i), `water ${i}`);
      }
    }
  });

  it('compares NaNs equally while preserving signed zero and every other float bit', () => {
    for (const Ctor of [Float32Array, Float64Array]) {
      const a = new Ctor([NaN, -0, Infinity, -Infinity]), b = new Ctor(a);
      new Uint8Array(b.buffer)[0] ^= 1;
      exact(a, b);
      b[1] = 0;
      expect(() => exact(a, b)).toThrow('byte mismatch');
      b[1] = -0; b[2] = -Infinity;
      expect(() => exact(a, b)).toThrow('byte mismatch');
    }
  });
});
