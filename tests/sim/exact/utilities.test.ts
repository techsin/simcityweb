import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RNG } from '../../../src/core/rng';
import { DevType, Network, Zone } from '../../../src/core/types';
import { BF, CityState, type Building } from '../../../src/sim/CityState';
import { Simulation } from '../../../src/sim/Simulation';
import { CATALOG, getDef, rebuildCatalogIndex } from '../../../src/sim/catalog';
import type { BuildingDef } from '../../../src/sim/catalogTypes';
import { placeBuilding, removeBuilding } from '../../../src/sim/economy/buildings';
import { buildingList, clearInfoCache, infoOf } from '../../../src/sim/infra/common';
import { schedulerOf } from '../../../src/sim/infra/scheduler';
import { buildingPowerUse, buildingWaterUse, plantLoadOf, UtilitiesSystem, waterQualityAt } from '../../../src/sim/infra/utilities';
import { deserializeCity, serializeCity } from '../../../src/save/serialize';
import { place, registerTestDefs } from '../../infra/cityGen';
import {
  buildingPowerUseOriginal, buildingWaterUseOriginal, plantLoadOfOriginal, UtilitiesSystemOriginal, waterQualityAtOriginal,
} from './utilitiesOriginal';

// Byte comparison except for NaN payloads, which V8 may canonicalize differently across JIT tiers.
function exact(a: unknown, b: unknown, path = 'value'): void {
  if (Object.is(a, b)) return;
  const fail = () => { throw new Error(`Utilities mismatch at ${path}: ${String(a)} / ${String(b)}`); };
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return fail();
  if (a instanceof ArrayBuffer && b instanceof ArrayBuffer) {
    if (!Buffer.from(a).equals(Buffer.from(b))) fail();
    return;
  }
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    if (a.constructor !== b.constructor || a.byteLength !== b.byteLength) return fail();
    const ab = Buffer.from(a.buffer, a.byteOffset, a.byteLength), bb = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
    if (ab.equals(bb)) return;
    if ((a instanceof Float32Array && b instanceof Float32Array) || (a instanceof Float64Array && b instanceof Float64Array)) {
      const stride = a.BYTES_PER_ELEMENT;
      for (let i = 0; i < a.length; i++) {
        if (Number.isNaN(a[i]) && Number.isNaN(b[i])) continue;
        for (let j = i * stride; j < (i + 1) * stride; j++) {
          if (ab[j] !== bb[j]) throw new Error(`Utilities byte mismatch at ${path}[${i}], byte ${j}`);
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
  { id: 'j11_nuclear', model: 'nuclear', category: 'power', powerOut: 10, waterUse: 5 },
  { id: 'j11_coal', model: 'coal', category: 'power', powerOut: 80, waterUse: 100 },
  { id: 'j11_wind', model: 'wind', category: 'power', powerOut: 1 },
  { id: 'j11_solar', model: 'solar', category: 'power', powerOut: 2 },
  { id: 'j11_incin', model: 'incinerator', category: 'garbage', powerOut: 3 },
  { id: 'j11_pump', model: 'util_water_pump', category: 'water', waterOut: 3, powerUse: 0.1 },
  { id: 'j11_desal', model: 'desal', category: 'water', waterOut: 3, powerUse: 1 },
  { id: 'j11_treatment', model: 'treatment', category: 'water', waterOut: 20, powerUse: 2 },
  { id: 'j11_dual', model: 'dual', category: 'power', powerOut: 4, waterOut: 6, powerUse: 1, waterUse: 1 },
  { id: 'j11_float', model: 'float', category: 'power', powerOut: 1, waterOut: 1, powerUse: 1, waterUse: 1 },
].map((d) => ({ name: d.id, footprint: [1, 1], ...d } as BuildingDef));
const ids = ['t_r1', 't_r2', 't_r3', 't_cs', 't_co', 't_id', 't_im', 't_iht', 't_small_plant', 't_pump', 't_tower',
  't_treat', 't_clinic', 't_police', 't_fire', 't_park', ...extraDefs.map((d) => d.id)];
const zones = [Zone.None, Zone.ResLow, Zone.ResMed, Zone.ResHigh, Zone.ComHigh, Zone.IndMed];
const special = [-0, 0, Number.MIN_VALUE, -Number.MIN_VALUE, 2 ** -149, -(2 ** -149), 1 - 2 ** -24, 1, 1 + 2 ** -23,
  -1, 1e30, -1e30, Number.MAX_VALUE, -Number.MAX_VALUE, Infinity, -Infinity, NaN];

beforeAll(() => {
  registerTestDefs();
  CATALOG.push(...extraDefs);
  rebuildCatalogIndex();
  clearInfoCache();
  // Deterministic telemetry as well as deterministic scheduling; production still measures real time.
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
  const rng = new RNG(seed);
  // Explicit config: defaultCityConfig draws an unused Math.random seed even when given a seed override.
  const st = new CityState({
    name: 'J11', mayor: 'Test', size, seed, difficulty: 'medium', climate: rng.pick(['temperate', 'desert', 'tropical', 'alpine']),
    terrain: 'flat', waterAmount: 0, hilliness: 0, treeDensity: 0, disasters: false, startFunds: 100000, startYear: 2000,
  });
  st.heights.fill(5);
  st.stats.sewageTreated = rng.next();
  if (seed % 7 === 0) st.nextBuildingId = 1023;
  for (let i = 0; i < st.cells; i++) {
    const x = i % size, z = (i / size) | 0;
    st.zone[i] = rng.pick(zones);
    if (mode === 3) st.network[i] = x % 2 === 0 && z % 2 === 0 ? Network.Road : Network.None;
    else if (mode !== 1 && (x % 4 === 1 || z % 3 === 1)) st.network[i] = rng.pick([Network.Road, Network.Street, Network.Avenue]);
    st.powerLines[i] = mode === 1 || rng.chance(0.1) ? 1 : 0;
    st.water[i] = mode === 4 ? 1 : rng.chance(0.15) ? 1 : 0;
    st.waterPollution[i] = rng.next();
    if (mode === 0 || st.building[i] >= 0 || (mode !== 1 && (st.network[i] || !rng.chance(0.65)))) continue;
    const def = getDef(rng.pick(ids))!;
    const [w, d] = def.footprint;
    if (x + w > size || z + d > size) continue;
    let free = true;
    for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) {
      if (st.building[zz * size + xx] >= 0 || st.network[zz * size + xx]) free = false;
    }
    if (!free) continue;
    place(st, def.id, x, z, {
      pop: def.devType !== undefined && def.devType <= DevType.R3 ? rng.int(1, 400) : 0,
      jobs: def.devType !== undefined && def.devType > DevType.R3 ? rng.int(0, 100) : 0,
      capacity: rng.int(1, 400), built: rng.chance(0.15) ? rng.next() : 1,
      flags: (def.category === 'growable' ? 0 : BF.Plopped) | rng.pick([0, 0, BF.Powered | BF.Watered, BF.Burnt, BF.Abandoned]),
    });
  }
  return st;
}

function clone(st: CityState): CityState {
  return Object.assign(new CityState({ ...st.config }), structuredClone(st));
}

function arm(st: CityState, original: boolean) {
  const util = original ? new UtilitiesSystemOriginal() : new UtilitiesSystem();
  const sim = new Simulation(st);
  const events: unknown[] = [], steps: unknown[] = [];
  const phases = new Set<number>();
  for (const name of ['buildingAdded', 'buildingRemoved', 'buildingChanged', 'networkChanged', 'powerLinesChanged',
    'zoneChanged', 'layerUpdated', 'news', 'day', 'month', 'year', 'reset'] as const) {
    sim.events.on(name, (value) => events.push([name, structuredClone(value)]));
  }
  const pollution = { name: 'pollution', incineratorShare: (id: number) => ((id + sim.state.day) % 5) / 4 };
  sim.systems.push(util, pollution);
  util.init(sim);
  const trace = () => {
    const task = schedulerOf(sim).tasks[0], step = task.step;
    task.step = (s) => {
      const phase = fields(util).stepIdx as number;
      phases.add(phase < 0 ? 0 : phase);
      steps.push([s.state.day, phase, task.cost(s), task.due(s), task.urgent(s)]);
      step(s);
    };
  };
  trace();
  return { sim, util, events, steps, phases, trace };
}
type Arm = ReturnType<typeof arm>;

function compare(a: Arm, b: Arm, label: string): void {
  exact(a.sim.state, b.sim.state, `${label}.state`);
  // Compare every pre-existing system field, including scratch tails, maps, counts and scheduling flags.
  // Only the new geometry scratch and cross-arm object/function identities lack an oracle counterpart.
  exact(fields(a.util, ['records', 'simRef', 'unsub']), fields(b.util, ['simRef', 'unsub']), `${label}.utilities`);
  exact((fields(a.util).unsub as unknown[]).length, (fields(b.util).unsub as unknown[]).length, `${label}.subscriptions`);
  exact(fields(schedulerOf(a.sim), ['tasks']), fields(schedulerOf(b.sim), ['tasks']), `${label}.scheduler`);
  const ta = schedulerOf(a.sim).tasks[0], tb = schedulerOf(b.sim).tasks[0];
  exact([ta.cost(a.sim), ta.due(a.sim), ta.urgent(a.sim)], [tb.cost(b.sim), tb.due(b.sim), tb.urgent(b.sim)], `${label}.nextStep`);
  exact(a.steps, b.steps, `${label}.steps`);
  exact(a.events, b.events, `${label}.events`);
  a.events.length = b.events.length = a.steps.length = b.steps.length = 0;
}

function accessors(a: Arm, b: Arm): void {
  const st = a.sim.state;
  for (let i = -1; i <= st.cells; i++) {
    const x = i % st.size, z = Math.floor(i / st.size);
    exact(a.util.gridInfo(a.sim, x, z), b.util.gridInfo(b.sim, x, z), `grid ${i}`);
    exact(a.util.waterInfo(a.sim, x, z), b.util.waterInfo(b.sim, x, z), `water ${i}`);
    exact(waterQualityAt(a.sim, i), waterQualityAtOriginal(b.sim, i), `quality ${i}`);
  }
  for (const id of [-1, 0, ...st.buildings.keys(), st.nextBuildingId + 1]) {
    exact(plantLoadOf(a.sim, id), plantLoadOfOriginal(b.sim, id), `load ${id}`);
    exact(a.util.producerInfo(id), b.util.producerInfo(id), `producer ${id}`);
  }
}

function edit(sim: Simulation, seed: number, turn: number): void {
  const st = sim.state, rng = new RNG(seed);
  st.day += rng.int(1, 5);
  st.budget.funding.utilities = rng.pick([0, 25, 50, 99.99, 100, 150]);
  st.budget.ordinances = rng.pick([[], ['nuclear_free_zone'], ['water_conservation'], ['power_conservation', 'water_conservation']]);
  st.stats.sewageTreated = rng.next();
  if (!st.cells) return;
  const i = rng.int(0, st.cells - 1), x = i % st.size, z = (i / st.size) | 0;
  const rect = { x0: x, z0: z, x1: x + 1, z1: z + 1 };
  st.zone[i] = rng.pick(zones);
  sim.events.emit('zoneChanged', rect);
  st.waterPollution[i] = rng.next();
  st.water[i] ^= 1;
  if (turn % 3 === 0) {
    st.network[i] = st.network[i] ? Network.None : Network.Road;
    sim.events.emit('networkChanged', rect);
  }
  if (turn % 7 === 0) {
    st.powerLines[i] ^= 1;
    sim.events.emit('powerLinesChanged', rect);
  }
  const all = [...st.buildings.values()], b = all.length ? rng.pick(all) : undefined;
  if (b) {
    b.built = rng.pick([0, 0.5, 1, 1]);
    b.flags = (b.flags & BF.Plopped) | rng.pick([0, BF.Burnt, BF.Abandoned, BF.Powered, BF.Powered | BF.Watered]);
    b.pop = rng.int(0, 400); b.jobs = rng.int(0, 120); b.capacity = rng.int(0, 400);
    if (turn % 5 === 0) b.def = rng.pick([...ids, 'j11_unknown']);
    sim.events.emit('buildingChanged', b);
    if (turn % 4 === 0) {
      removeBuilding(sim, b);
      // A replacement object and a different Map position, sometimes with the same id and count.
      if (turn % 8 === 0) placeBuilding(sim, { ...b, def: rng.pick(ids), built: 1, flags: 0 });
    }
    if (turn % 11 === 0 && st.buildings.has(b.id)) {
      // Geometry can change without an event between scheduler steps. Never trust a previous step's record.
      const moved = st.buildings.get(b.id)!;
      for (let j = 0; j < st.cells; j++) if (st.building[j] === b.id) st.building[j] = -1;
      moved.x = x; moved.z = z; moved.w = Math.min(rng.int(1, 3), st.size - x); moved.d = Math.min(rng.int(1, 3), st.size - z);
      for (let zz = z; zz < z + moved.d; zz++) for (let xx = x; xx < x + moved.w; xx++) st.building[zz * st.size + xx] = moved.id;
    }
  }
  if (st.building[i] < 0 && turn % 2 === 0) {
    const def = getDef(rng.pick(ids.filter((id) => getDef(id)!.footprint.every((n) => n === 1))))!;
    placeBuilding(sim, {
      id: st.nextBuildingId++, def: def.id, x, z, w: 1, d: 1, rot: 0, variant: 0, pop: 60, jobs: 20, capacity: 60,
      wealth: 1, built: 1, age: 100, flags: def.category === 'growable' ? 0 : BF.Plopped, baseY: 5, health: 1, unhappy: 0,
    });
  }
}

function pass(a: Arm, b: Arm, label: string, between?: (step: number) => void): void {
  for (let k = 0; k < 6; k++) {
    schedulerOf(a.sim).tasks[0].step(a.sim);
    schedulerOf(b.sim).tasks[0].step(b.sim);
    compare(a, b, `${label}, step ${k}`);
    if (fields(a.util).stepIdx === -1) return;
    between?.(k);
  }
  throw new Error(`Unfinished utilities pass: ${label}`);
}

describe('J11 exact utilities records', () => {
  it('matches 10,240 generated passes, including edits between steps, scheduler costs, reloads and resizing', () => {
    const rng = new RNG('J11 utilities passes'), sizes = [0, 1, 2, 3, 5, 8, 9, 16, 17];
    const phases = new Set<number>();
    let cases = 0;
    for (let run = 0; run < 128; run++) {
      const st = city(sizes[run % sizes.length], rng.int(1, 0x7fffffff), run % 5);
      const a = arm(clone(st), false), b = arm(clone(st), true);
      compare(a, b, `init ${run}`);
      for (let n = 0; n < 80; n++) {
        const seed = rng.int(1, 0x7fffffff);
        edit(a.sim, seed, n); edit(b.sim, seed, n);
        if (n === 27) {
          const sa = serializeCity(a.sim.state, { copy: true }), sb = serializeCity(b.sim.state, { copy: true });
          exact(sa, sb, 'save');
          a.sim.replaceState(deserializeCity(sa)); b.sim.replaceState(deserializeCity(sb));
          a.trace(); b.trace();
          compare(a, b, 'reload');
        }
        if (n === 53) {
          const fresh = city(sizes[(run + 4) % sizes.length], seed, (run + 2) % 5);
          a.sim.replaceState(clone(fresh)); b.sim.replaceState(clone(fresh));
          a.trace(); b.trace();
          compare(a, b, 'resize');
        }
        if (n % 8 === 0) {
          a.util.compute(a.sim); b.util.compute(b.sim);
          compare(a, b, `compute ${run}/${n}`);
        } else if (n % 8 === 1) {
          a.util.invalidate(); b.util.invalidate();
          a.sim.advanceDay(); b.sim.advanceDay();
          compare(a, b, `scheduler ${run}/${n}`);
          schedulerOf(a.sim).flush(a.sim); schedulerOf(b.sim).flush(b.sim);
          compare(a, b, `flush ${run}/${n}`);
        } else {
          pass(a, b, `${run}/${n}`, n % 8 === 2 ? (k) => {
            const midSeed = rng.int(1, 0x7fffffff);
            edit(a.sim, midSeed, n + k); edit(b.sim, midSeed, n + k);
          } : undefined);
        }
        if (n % 20 === 0) accessors(a, b);
        cases++;
      }
      for (const phase of a.phases) phases.add(phase);
    }
    expect(cases).toBe(10240);
    expect([...phases].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  }, 45000);

  it('matches 18 additions, removals and geometry edits at all six scheduler phase boundaries', () => {
    const st = city(16, 87, 0);
    st.network.fill(0); st.powerLines.fill(0); st.water.fill(0); st.waterPollution.fill(0);
    st.zone.fill(Zone.ResMed);
    for (let x = 0; x < 16; x++) st.network[5 * 16 + x] = Network.Road;
    place(st, 't_small_plant', 0, 4);
    const pump = place(st, 't_pump', 1, 4);
    const house = place(st, 't_r2', 2, 6, { pop: 60 });
    for (let x = 3; x < 16; x++) place(st, 't_r2', x, 6, { pop: 60 });
    for (let target = 0; target < 6; target++) for (let action = 0; action < 3; action++) {
      const a = arm(clone(st), false), b = arm(clone(st), true);
      compare(a, b, 'boundary init');
      expect(a.sim.state.stats.powerDemand).toBeGreaterThan(a.sim.state.stats.powerSupply);
      expect(a.sim.state.stats.waterDemand).toBeGreaterThan(a.sim.state.stats.waterSupply);
      a.util.invalidate(); b.util.invalidate();
      a.sim.state.day = b.sim.state.day = 31;
      let edited = false;
      for (let k = 0; k < 6; k++) {
        const next = fields(a.util).stepIdx as number, phase = next < 0 ? 0 : next;
        if (phase === target) {
          for (const arm of [a, b]) {
            const st = arm.sim.state;
            if (action === 0) {
              st.nextBuildingId = 2051;
              placeBuilding(arm.sim, { ...house, id: 2050, def: 'j11_treatment', x: 15, z: 15, flags: BF.Plopped });
            } else if (action === 1) removeBuilding(arm.sim, st.buildings.get(pump.id)!);
            else {
              const moved = st.buildings.get(house.id)!;
              st.building[moved.z * st.size + moved.x] = -1;
              moved.x = 14; moved.z = 14; moved.w = 2; moved.d = 2;
              for (let z = 14; z < 16; z++) for (let x = 14; x < 16; x++) st.building[z * 16 + x] = moved.id;
            }
          }
          edited = true;
        }
        schedulerOf(a.sim).tasks[0].step(a.sim); schedulerOf(b.sim).tasks[0].step(b.sim);
        compare(a, b, `boundary ${target}/${action}, step ${k}`);
        if (fields(a.util).stepIdx === -1) break;
      }
      expect(edited).toBe(true);
      expect(fields(a.util).stepIdx).toBe(-1);
      accessors(a, b);
    }
  });

  it('matches 384 passes with special floats, retained scratch, sparse ids and producer transitions', () => {
    const rng = new RNG('J11 utility float edges');
    const st = city(9, 123, 0);
    st.nextBuildingId = 4095;
    st.network.fill(Network.Road);
    for (let i = 0; i < ids.length; i++) place(st, ids[i], i % 7, Math.floor(i / 7));
    const a = arm(clone(st), false), b = arm(clone(st), true);
    compare(a, b, 'float init');
    const floatDef = getDef('j11_float')!;
    for (let c = 0; c < 384; c++) {
      floatDef.powerOut = rng.pick(special); floatDef.waterOut = rng.pick(special);
      floatDef.powerUse = rng.pick(special); floatDef.waterUse = rng.pick(special);
      clearInfoCache();
      const seed = rng.int(1, 0x7fffffff);
      for (const arm of [a, b]) {
        const st = arm.sim.state, r = new RNG(seed);
        st.day += 31;
        st.stats.sewageTreated = r.pick(special);
        st.budget.funding.utilities = r.pick(special);
        st.budget.ordinances = c % 3 ? [] : ['nuclear_free_zone'];
        for (let i = 0; i < st.cells; i++) st.waterPollution[i] = r.pick(special);
        for (let i = 0; i < st.heights.length; i++) st.heights[i] = r.pick(special);
        for (const building of st.buildings.values()) {
          building.pop = r.pick(special); building.jobs = r.pick(special); building.capacity = r.pick(special);
          building.built = c % 2 ? 1 : r.pick(special);
          building.flags = r.pick([0, BF.Burnt, BF.Abandoned, BF.Powered | BF.Watered]);
          if (c % 17 === 0) building.def = r.pick(ids);
        }
      }
      pass(a, b, `float ${c}`);
      accessors(a, b);
      for (const ba of buildingList(a.sim.state)) {
        const bb = b.sim.state.buildings.get(ba.id)!, inf = infoOf(a.sim.state, ba);
        for (const unknown of [false, true]) {
          exact(buildingPowerUse(inf, ba, unknown), buildingPowerUseOriginal(inf, bb, unknown), 'power use');
          exact(buildingWaterUse(inf, ba, unknown), buildingWaterUseOriginal(inf, bb, unknown), 'water use');
        }
      }
    }
  }, 15000);

  it('matches growing and shrinking records, full grids, component arrays, producer and critical lists', () => {
    const st = city(65, 19, 0);
    st.network.fill(0);
    st.powerLines.fill(0);
    st.water.fill(0);
    st.nextBuildingId = 8191;
    for (let z = 0; z < st.size; z += 3) for (let x = 0; x < st.size; x += 3) {
      st.network[z * st.size + x] = Network.Road;
      if (x + 1 < st.size) place(st, x % 2 ? 't_small_plant' : 't_pump', x + 1, z);
      if (z + 1 < st.size) place(st, 't_clinic', x, z + 1);
    }
    const a = arm(clone(st), false), b = arm(clone(st), true);
    compare(a, b, 'large init');
    expect(fields(a.util).nPComp).toBeGreaterThan(256);
    expect(fields(a.util).nWComp).toBeGreaterThan(256);
    expect(fields(a.util).nPlants).toBeGreaterThan(64);
    expect(fields(a.util).nCrit).toBeGreaterThan(256);
    for (let n = 0; n < 8; n++) {
      for (const arm of [a, b]) {
        arm.sim.state.day += 31;
        if (n === 1) for (const building of [...arm.sim.state.buildings.values()].slice(0, 800)) removeBuilding(arm.sim, building);
        if (n === 2) {
          const fresh = city(33, 29, 0);
          fresh.network.fill(0); fresh.powerLines.fill(0);
          for (let z = 0; z < 33; z++) for (let x = 0; x < 33; x++) place(fresh, 't_r2', x, z, { pop: 60 });
          arm.sim.replaceState(fresh); arm.trace();
        }
        if (n === 4) { arm.sim.replaceState(city(1, 31, 0)); arm.trace(); }
      }
      pass(a, b, `grow/shrink ${n}`);
      accessors(a, b);
    }
  });

  it('compares NaNs equally while preserving signed zero and all other float bits', () => {
    for (const Ctor of [Float32Array, Float64Array]) {
      const a = new Ctor([NaN, -0, Infinity, -Infinity, 1]), b = new Ctor(a);
      new Uint8Array(b.buffer)[0] ^= 1;
      exact(a, b);
      b[1] = 0;
      expect(() => exact(a, b)).toThrow('byte mismatch');
      b[1] = -0; b[2] = -Infinity;
      expect(() => exact(a, b)).toThrow('byte mismatch');
      b[2] = Infinity;
      new Uint8Array(b.buffer)[4 * b.BYTES_PER_ELEMENT] ^= 1;
      expect(() => exact(a, b)).toThrow('byte mismatch');
    }
  });
});
