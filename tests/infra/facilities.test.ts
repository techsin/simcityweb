/**
 * WP7a "every facility genuinely works" (docs/SIM_DEPTH_PART_B.md §5 WP7a, critic items 7, 8, 12-16): the matrix over every
 * non-hidden ploppable catalog def (placed with road + power + water in a small populated city, 60 days: facilityReport
 * with its title and >= 1 line, and its effect metric — read at the facility — differs from the same city without it;
 * two runs without it are identical, a burnt copy does nothing), staffing (unreachable -> Understaffed / op 0.6 ->
 * recovery; power is not staffing; labour-short cities), police capacity (two stations beat one overloaded station),
 * airport / seaport use factors, patrol model hints and the static def facts.
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { CATALOG, getDef } from '../../src/sim/catalog';
import type { BuildingDef } from '../../src/sim/catalogTypes';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import { CityActions, lPath } from '../../src/sim/actions';
import { createCityState, computeWater } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { computeMonthlyBudget } from '../../src/sim/economy/budget';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import {
  airportPassengers, facilityDefFacts, facilityOpFactor, facilityQuality, facilityReport, facilityUseFactor, policeCapacityOf, staffingOf, understaffed,
  updateUseFactors, useFactorOf,
} from '../../src/sim/infra/facilities';
import { TRANSPORT_EFFECT_METRICS, freightSinkTrucks } from '../../src/sim/infra/transportFacilities';
import { facilityLoad } from '../../src/sim/infra/catchments';
import { justiceData } from '../../src/sim/infra/justice';
import type { ServicesSystem } from '../../src/sim/infra/services';
import type { PollutionSystem } from '../../src/sim/infra/pollution';
import type { TrafficSystem } from '../../src/sim/infra/traffic';
import { JAIL_BEDS, POLICE_CAP } from '../../src/sim/infra/params';
import { newSim, newState, place, roadLine, TEST_DEFS } from './cityGen';

const N = 80;
/** the test site (16 x 16, north edge on the avenue, west edge on a road) and the shore site (west road, sea south) */
const SITE = { x0: 36, z0: 35, x1: 52, z1: 51 };
const SHORE_X = 41, SEA_Z = 70;

type Sim = Simulation;
function road(A: CityActions, x0: number, z0: number, x1: number, z1: number, t = Network.Road): void {
  const r = A.buildNetwork(lPath({ x: x0, z: z0 }, { x: x1, z: z1 }), t);
  if (!r.ok) throw new Error(`road ${x0},${z0}-${x1},${z1}: ${r.reason}`);
}

/** a small sandbox city: homes, shops, industry, a coal plant, pumps, a landfill, a sea along the south edge */
function buildBase(): CityState {
  return buildCity(360).st;
}
/** the base city's layout grown for `days` days (a young town for days ~5) */
function buildCity(days: number): { st: CityState; sim: Sim; A: CityActions } {
  const st = createCityState(defaultCityConfig({ size: N, seed: 4242, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false, difficulty: 'sandbox' }));
  const N1 = N + 1;
  st.heights.fill(5);
  for (let z = SEA_Z; z <= N; z++) for (let x = 0; x <= N; x++) st.heights[z * N1 + x] = -4;
  computeWater(st);
  st.trees.fill(0);
  const sim = new Simulation(st, createSystems());
  const A = new CityActions(sim);
  road(A, 0, 34, N - 1, 34, Network.Avenue);
  for (let z = 4; z <= 28; z += 6) road(A, 2, z, 34, z);
  for (let x = 2; x <= 32; x += 6) road(A, x, 4, x, 33);
  road(A, 34, 4, 34, 33);
  road(A, 2, 38, 34, 38);
  road(A, 34, 35, 34, 38);
  road(A, 34, 4, 78, 4);
  for (let z = 10; z <= 22; z += 6) road(A, 50, z, 78, z);
  for (let x = 50; x <= 74; x += 6) road(A, x, 5, x, 33);
  road(A, 35, 35, 35, 52);
  road(A, 35, 52, 55, 52);
  road(A, 40, 53, 40, SEA_Z - 1);
  for (let bz = 5; bz < 34; bz += 6) for (let bx = 3; bx < 33; bx += 6) A.zone({ x0: bx, z0: bz, x1: bx + 5, z1: Math.min(bz + 5, 34) }, bz < 16 ? Zone.ResLow : Zone.ResMed);
  A.zone({ x0: 3, z0: 35, x1: 34, z1: 38 }, Zone.ComLow);
  for (let bz = 5; bz < 22; bz += 6) for (let bx = 51; bx < 74; bx += 6) A.zone({ x0: bx, z0: bz, x1: bx + 5, z1: bz + 5 }, Zone.IndMed);
  const must = (r: { ok: boolean; reason?: string }, what: string) => { if (!r.ok) throw new Error(`${what}: ${r.reason}`); };
  must(A.plop('util_coal_plant', 75, 0, 0), 'coal plant');
  for (const z of [5, 6, 7]) must(A.plop('util_water_pump', 1, z, 0), 'pump');
  A.zone({ x0: 44, z0: 5, x1: 49, z1: 10 }, Zone.Landfill);
  sim.runDays(days);
  return { st, sim, A };
}

let baseCache: SerializedCity | null = null;
function base(): SerializedCity {
  if (!baseCache) baseCache = serializeCity(buildBase(), { copy: true });
  return baseCache;
}
function branch(): { st: CityState; sim: Sim; A: CityActions } {
  const st = deserializeCity(structuredClone(base()) as SerializedCity);
  const sim = new Simulation(st, createSystems());
  return { st, sim, A: new CityActions(sim) };
}

/**
 * prerequisites some transit defs need to do anything at all (WP7b: a station needs a partner station or rail to the map
 * edge, a ferry a partner terminal on the same water) — applied to the def's own control run too — and where to put it
 */
interface Setup { prep(A: CityActions): void; at: [number, number, 0 | 1 | 2 | 3] }
const RAIL_Z = SITE.z0 + 9;
const railToEdge = (A: CityActions) => { const r = A.buildNetwork(lPath({ x: SITE.x0, z: RAIL_Z }, { x: N - 1, z: RAIL_Z }), Network.Rail); if (!r.ok) throw new Error(`rail: ${r.reason}`); };
const SETUPS: Readonly<Record<string, Setup>> = {
  tr_subway_station: {
    prep: (A) => {
      const r = A.buildSubway(lPath({ x: SITE.x0, z: SITE.z0 }, { x: SITE.x0 + 12, z: SITE.z0 }));
      if (!r.ok) throw new Error(`subway: ${r.reason}`);
      if (!A.plop('tr_subway_station', SITE.x0 + 12, SITE.z0, 0).ok) throw new Error('partner subway station');
    },
    at: [SITE.x0, SITE.z0, 0],
  },
  tr_train_station: { prep: railToEdge, at: [SITE.x0, RAIL_Z + 1, 0] },
  tr_freight_station: { prep: railToEdge, at: [SITE.x0, RAIL_Z + 1, 0] },
  tr_ferry_terminal: {
    prep: (A) => {
      road(A, 55, SITE.z1 + 1, 59, SITE.z1 + 1);
      road(A, 59, SITE.z1 + 2, 59, SEA_Z - 1);
      if (!A.plop('tr_ferry_terminal', 60, SEA_Z - 2, 0).ok) throw new Error('partner ferry terminal');
    },
    at: [SHORE_X, SEA_Z - 2, 0],
  },
};

/** plop a def on the test site (or the shore site): first rotation / position that validates */
function plopDef(A: CityActions, st: CityState, def: BuildingDef): Building | null {
  const setup = SETUPS[def.id];
  if (setup) {
    const [x, z, rot] = setup.at;
    const r = A.plop(def.id, x, z, rot);
    if (!r.ok) throw new Error(`${def.id} at ${x},${z}: ${r.reason}`);
    return st.buildingAt(x, z) ?? null;
  }
  const shore = def.placement === 'shore';
  for (const rot of [0, 1, 2, 3] as const) {
    const [w, d] = rot & 1 ? [def.footprint[1], def.footprint[0]] : def.footprint;
    const spots: [number, number][] = shore ? [[SHORE_X, SEA_Z - d]] : [[SITE.x0, SITE.z0], [SITE.x0 + 1, SITE.z0], [SITE.x0, SITE.z0 + 1]];
    for (const [x, z] of spots) {
      if (x + w > SITE.x1 + 8 || z + d > (shore ? SEA_Z : SITE.z1)) continue;
      if (shore && rot !== 0) continue;
      const r = A.plop(def.id, x, z, rot);
      if (r.ok) return st.buildingAt(x, z) ?? null;
    }
  }
  return null;
}

/** sum of a layer over the rect around the site (the facility's catchment side of the map) */
function sumRect(a: Float32Array, r: { x0: number; z0: number; x1: number; z1: number }, pad = 16): number {
  let s = 0;
  for (let z = Math.max(0, r.z0 - pad); z < Math.min(N, r.z1 + pad); z++) for (let x = Math.max(0, r.x0 - pad); x < Math.min(N, r.x1 + pad); x++) s += a[z * N + x];
  return s;
}
const around = (b: Building | null) => (b ? { x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d } : SITE);

type Metric = { name: string; f: (sim: Sim, b: Building | null) => number; dir: 1 | -1 | 0 };
/** a layer summed around the facility (pad: its own reach, so nothing else's chaos moves the sum) */
const layerM = (key: keyof CityState, pad = 16): Metric => ({ name: String(key), dir: 1, f: (sim, b) => sumRect(sim.state[key] as Float32Array, around(b), pad) });
const statM = (name: string, g: (st: CityState) => number, dir: 1 | -1 | 0 = 1): Metric => ({ name, dir, f: (sim) => g(sim.state) });
const incomeM = (id: string): Metric => ({ name: `income ${id}`, dir: 1, f: (sim) => computeMonthlyBudget(sim.state, null).income['facility:' + id] ?? 0 });

/** the civic table: the effect each (non-transport) def is built for, read at the facility / its own stat */
function metricOf(def: BuildingDef): Metric | null {
  const tier = def.coverage?.tier;
  if (def.category === 'power') return statM('power supply', (st) => st.stats.powerSupply);
  if (def.category === 'water') return statM('water supply', (st) => st.stats.waterSupply);
  if (def.id === 'util_recycling_center') return statM('recycled t/month', (st) => st.stats.garbageRecycled);
  if (def.id === 'util_incinerator') return { name: 'burned t/month', dir: 1, f: (sim) => sim.getSystem<PollutionSystem>('pollution')!.garbageSummary().burnedT };
  if (def.id === 'civ_jail') return statM('prison beds', (st) => st.stats.justice.beds);
  if (def.id === 'civ_courthouse') return statM('policeMul', (st) => st.stats.justice.policeMul);
  if (tier === 'police') return layerM('policeCov');
  if (tier === 'fire') return layerM('fireCov');
  if (tier === 'clinic' || tier === 'hospital') return layerM('healthCov');
  if (tier === 'elementary') return layerM('eduElemCov');
  if (tier === 'high') return layerM('eduHighCov');
  if (tier === 'college' || tier === 'library') return layerM('eduCollegeCov');
  if (tier === 'play') return layerM('playCov');
  if (tier === 'green') return layerM('greenCov');
  if (def.id === 'tr_airport_small' || def.id === 'tr_airport_large' || def.id === 'tr_seaport') return incomeM(def.id);
  if (def.prestige) return layerM('prestige', def.prestige.radius + 2);
  if (def.stigma) return layerM('stigma', def.stigma.radius + 2);
  if (def.landValue) {
    return { name: 'land value effect', dir: 1, f: (sim, b) => {
      const rt = (sim.getSystem('economy.population') as unknown as { rt: { lvEffects: Float32Array } }).rt;
      return sumRect(rt.lvEffects, around(b), 8);
    } };
  }
  return null;
}

const testIds = new Set(TEST_DEFS.map((d) => d.id));
/** WP7b's transit defs: their effect metric is TRANSPORT_EFFECT_METRICS (report only while WP7b's table is empty) */
const TRANSIT_DEFS = new Set(['tr_bus_stop', 'civ_bus_depot', 'tr_subway_station', 'tr_train_station', 'tr_freight_station', 'tr_parking_garage', 'tr_ferry_terminal']);
/** every non-hidden ploppable catalog def (without the test defs registerTestDefs() pushes into CATALOG) */
function ploppableDefs(): BuildingDef[] {
  return CATALOG.filter((d) => d.category !== 'growable' && !d.hidden && !testIds.has(d.id) && !d.id.startsWith('wp') && !d.id.includes('_wp2') && !d.id.endsWith('_np') && !d.id.endsWith('_pw'));
}

/** the matrix control: the base city without any facility after 60 days (read only; shared by the matrix parts) */
let controlCache: Sim | null = null;
function controlRun(): Sim {
  if (!controlCache) { const c = branch(); c.sim.runDays(60); controlCache = c.sim; }
  return controlCache;
}
/** controls of the defs with a setup (the setup without the def, 60 days), one per setup */
const setupControls = new Map<Setup['prep'], Sim>();

/** one matrix row: place the def (after its setup), 60 days, report + effect metric vs the same city without it */
function matrixRow(def: BuildingDef, failures: string[], burnt: { n: number; max: number }): string | null {
  const { st, sim, A } = branch();
  const setup = SETUPS[def.id];
  let ctl = controlRun();
  if (setup) {
    setup.prep(A);
    let c = setupControls.get(setup.prep);
    if (!c) {
      const x = branch();
      setup.prep(x.A);
      x.sim.runDays(60);
      setupControls.set(setup.prep, (c = x.sim));
    }
    ctl = c;
  }
  const b = plopDef(A, st, def);
  if (!b) { failures.push(`${def.id}: could not be placed`); return null; }
  const touches = (() => { for (let x = b.x - 1; x <= b.x + b.w; x++) for (let z = b.z - 1; z <= b.z + b.d; z++) { if (x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d) continue; if (st.inBounds(x, z) && st.network[st.idx(x, z)] >= Network.Street && st.network[st.idx(x, z)] <= Network.Highway) return true; } return false; })();
  sim.runDays(60);
  const rep = facilityReport(sim, b.id);
  if (!rep) { failures.push(`${def.id}: no report`); return null; }
  if (rep.title !== def.name) failures.push(`${def.id}: title "${rep.title}"`);
  if (!(rep.lines.length >= 1)) failures.push(`${def.id}: no lines`);
  if (!rep.role) failures.push(`${def.id}: no role`);
  if (!touches) failures.push(`${def.id}: no road beside the lot`);
  if ((def.powerUse ?? 0) > 0 && !(b.flags & BF.Powered)) failures.push(`${def.id}: not powered`);
  const m = TRANSIT_DEFS.has(def.id) ? null : metricOf(def);
  const tm = TRANSPORT_EFFECT_METRICS[def.id];
  let res = 'report only';
  if (m) {
    const v = m.f(sim, b), v0 = m.f(ctl, null);
    res = `${m.name} ${v0.toFixed(2)} -> ${v.toFixed(2)}`;
    if (!(Math.abs(v - v0) > 1e-6)) failures.push(`${def.id}: ${m.name} unchanged (${v0} -> ${v})`);
    else if (m.dir > 0 && !(v > v0)) failures.push(`${def.id}: ${m.name} fell (${v0} -> ${v})`);
    // a burnt copy does nothing (metrics that are exactly 0 without the facility)
    if (Math.abs(v0) < 1e-9 && burnt.n < burnt.max && def.category !== 'power' && def.category !== 'water') {
      const x = branch();
      const bb = plopDef(x.A, x.st, def)!;
      bb.flags |= BF.Burnt;
      x.sim.events.emit('buildingChanged', bb);
      x.sim.runDays(60);
      const vb = m.f(x.sim, bb);
      if (Math.abs(vb) > 1e-9) failures.push(`${def.id}: a burnt copy still gives ${m.name} ${vb}`);
      burnt.n++;
    }
  } else if (tm) {
    const v = tm(sim), v0 = tm(ctl);
    res = `transport metric ${v0.toFixed(2)} -> ${v.toFixed(2)}`;
    if (!(Math.abs(v - v0) > 1e-6)) failures.push(`${def.id}: transport metric unchanged`);
  } else if (def.category !== 'transport') failures.push(`${def.id}: no effect metric in the civic table`);
  return `${def.id.padEnd(24)} ${res.padEnd(44)} | ${rep.lines.slice(0, 3).map((l) => `${l.label}: ${l.value}`).join(' · ')}${rep.warnings.length ? ' | ! ' + rep.warnings.join(' / ') : ''}`;
}

/** the matrix runs in parts (every 4th def each), so no single test holds the whole ~5,000 simulated days */
const MATRIX_PARTS = 4;
describe('facilities: every facility genuinely works (matrix)', () => {
  it('the control: two runs of the base city without a facility are identical', { timeout: 900_000 }, () => {
    const c1 = controlRun().state;
    const c2 = branch();
    c2.sim.runDays(60);
    expect(c1.stats.population).toBe(c2.st.stats.population);
    expect(c1.funds).toBe(c2.st.funds);
    expect(Array.from(c1.crime)).toEqual(Array.from(c2.st.crime));
    console.log(`matrix base city: ${c1.stats.population} residents, ${c1.buildings.size} buildings, power ${Math.round(c1.stats.powerSupply)} MW, water ${Math.round(c1.stats.waterSupply)} kL/day`);
    expect(c1.stats.population).toBeGreaterThan(800);
    expect(ploppableDefs().length).toBeGreaterThanOrEqual(74);
  });
  for (let part = 0; part < MATRIX_PARTS; part++) {
    it(`every non-hidden ploppable (part ${part + 1} / ${MATRIX_PARTS}): report with its title and >= 1 line; its effect metric changes vs the same city without it`, { timeout: 900_000 }, () => {
      const defs = ploppableDefs().filter((_, i) => i % MATRIX_PARTS === part);
      const rows: string[] = [];
      const failures: string[] = [];
      const burnt = { n: 0, max: 2 };
      for (const def of defs) {
        const r = matrixRow(def, failures, burnt);
        if (r) rows.push(r);
      }
      console.log(rows.join('\n'));
      console.log(`burnt controls checked: ${burnt.n}`);
      expect(failures).toEqual([]);
      expect(burnt.n).toBe(burnt.max);
    });
  }
});

describe('facilities: staffing (WP7-3, critic items 7 / 8)', () => {
  it('a school workers cannot reach is Understaffed at op 0.6 with lower service, and recovers once its road is connected; power is not staffing', { timeout: 600_000 }, () => {
    const { st, sim, A } = branch();
    // an island road east of the site, not connected to anything
    road(A, 60, 56, 70, 56);
    expect(A.plop('civ_elementary_school', 62, 57, 0).ok).toBe(true);
    const school = st.buildingAt(62, 57)!;
    // a connected school on the site
    expect(A.plop('civ_elementary_school', SITE.x0, SITE.z0, 0).ok).toBe(true);
    const ok = st.buildingAt(SITE.x0, SITE.z0)!;
    sim.runDays(75);
    const s = staffingOf(st, school)!;
    console.log(`island school: jobs ${school.jobs} / ${school.capacity} hire ${school.hire} staff ${s?.staff} rel ${s?.rel} flags understaffed ${!!(school.flags & BF.Understaffed)} · connected: jobs ${ok.jobs} rel ${staffingOf(st, ok)?.rel}`);
    expect(s).not.toBeNull();
    expect(s.rel).toBeLessThan(0.6);
    expect(school.flags & BF.Understaffed).toBeTruthy();
    expect(facilityOpFactor(st, school)).toBeCloseTo(0.6 + 0.4 * s.rel, 5);
    expect(facilityOpFactor(st, ok)).toBeGreaterThanOrEqual(0.95);
    expect(ok.flags & BF.Understaffed).toBeFalsy();
    const svc = sim.getSystem<ServicesSystem>('services')!;
    svc.compute(sim, false);
    const opIsland = facilityLoad(sim, school.id)!.operating, opOk = facilityLoad(sim, ok.id)!.operating;
    expect(opIsland).toBeLessThan(opOk * 0.75);
    const rep = facilityReport(sim, school.id)!;
    const staffLine = rep.lines.find((l) => l.key === 'staff')!;
    expect(staffLine.status).toBe('bad');
    expect(staffLine.hint).toMatch(/reach|road/);
    expect(rep.warnings.some((w) => /Understaffed/.test(w))).toBe(true);
    // connect the island to the site's road network -> workers arrive, flag clears at the next month
    road(A, 55, 52, 60, 52);
    road(A, 60, 52, 60, 56);
    let days = 0;
    while ((school.flags & BF.Understaffed) && days < 150) { sim.runDays(15); days += 15; }
    console.log(`connected after ${days} days: jobs ${school.jobs} rel ${staffingOf(st, school)?.rel}`);
    expect(school.flags & BF.Understaffed).toBeFalsy();
    expect(facilityOpFactor(st, school)).toBeGreaterThanOrEqual(0.9);
    // no power: hiring drops to 25 % but that is not understaffing — op comes from the power factor only
    const coal = [...st.buildings.values()].find((b) => b.def === 'util_coal_plant')!;
    expect(A.bulldoze({ x0: coal.x, z0: coal.z, x1: coal.x + coal.w, z1: coal.z + coal.d }).ok).toBe(true);
    sim.runDays(45);
    expect(ok.flags & BF.Powered).toBeFalsy();
    expect(ok.hire).toBeLessThanOrEqual(0.25);
    expect(ok.flags & BF.Understaffed).toBeFalsy();
    expect(facilityOpFactor(st, ok)).toBeGreaterThanOrEqual(0.95);
    svc.compute(sim, false);
    expect(facilityLoad(sim, ok.id)!.operating).toBeLessThanOrEqual(0.3 * 1.01);
  });

  it('staffing formula: unknown = full; relative to the city job fill (labour-short cities); no road = 0; 0.05 steps', () => {
    const st = newState(32);
    roadLine(st, 2, 10, 30, 10);
    const b = place(st, 't_school', 10, 11);
    expect(facilityOpFactor(st, b)).toBe(1); // hire never set: infra-only / not staffed yet
    b.hire = 1; b.capacity = 20;
    b.jobs = 20;
    expect(facilityOpFactor(st, b)).toBe(1);
    b.jobs = 10;
    // the city's job fill is not known yet (no filled C / I job: a young town) -> counts as full, like unknown staffing
    expect(facilityOpFactor(st, b)).toBe(1);
    expect(understaffed(st, b)).toBe(false);
    justiceData(st).cityFill = 1;
    expect(facilityOpFactor(st, b)).toBeCloseTo(0.8, 6);
    // jobs = 2 x workers: every employer fills ~half; a reachable facility at the city's fill is fully effective
    justiceData(st).cityFill = 0.5;
    expect(facilityOpFactor(st, b)).toBeCloseTo(1, 6);
    justiceData(st).cityFill = 0.52;
    expect(facilityOpFactor(st, b)).toBeGreaterThanOrEqual(0.95);
    // hire 0.25 (no power): 5 of 20 x 0.25 posted jobs filled = fully staffed
    justiceData(st).cityFill = 1;
    b.hire = 0.25; b.jobs = 5;
    expect(facilityOpFactor(st, b)).toBe(1);
    // 0.05 steps
    b.hire = 1; b.jobs = 13;
    expect(staffingOf(st, b)!.rel).toBe(0.65);
    // no road beside the lot: nobody reaches it
    const lone = place(st, 't_school', 20, 20);
    lone.hire = 1; lone.capacity = 20; lone.jobs = 20;
    expect(staffingOf(st, lone)!.road).toBe(false);
    expect(facilityOpFactor(st, lone)).toBeCloseTo(0.6, 6);
  });
});

describe('facilities: staffing in a new town (review r1)', () => {
  it('a new sandbox town: a road-connected school is never flagged Understaffed, op >= 0.95 over its first 60 days, and the flag (and the report warning) equal live understaffed() every day', { timeout: 300_000 }, () => {
    const { st, sim, A } = buildCity(5);
    expect(A.plop('civ_elementary_school', SITE.x0, SITE.z0, 0).ok).toBe(true);
    const school = st.buildingAt(SITE.x0, SITE.z0)!;
    let flagged = 0, mismatch = 0, repMismatch = 0, minOp = 1;
    for (let d = 0; d < 60; d++) {
      sim.advanceDay();
      const live = understaffed(st, school);
      const flag = (school.flags & BF.Understaffed) !== 0;
      if (flag) flagged++;
      if (flag !== live) mismatch++;
      if (facilityReport(sim, school.id)!.warnings.some((w) => /^Understaffed/.test(w)) !== live) repMismatch++;
      minOp = Math.min(minOp, facilityOpFactor(st, school));
    }
    console.log(`young town: pop ${st.stats.population}, city fill ${justiceData(st).cityFill}, school jobs ${school.jobs} / ${school.capacity}, min op ${minOp}`);
    expect(flagged).toBe(0);
    expect(mismatch).toBe(0);
    expect(repMismatch).toBe(0);
    expect(minOp).toBeGreaterThanOrEqual(0.95);
    // the staff line states the staffing effect (no "service at x %"), and no city-workforce line on a staffed school
    const rep = facilityReport(sim, school.id)!;
    expect(rep.lines.find((l) => l.key === 'staff')!.value).not.toMatch(/service at/);
    expect(rep.lines.some((l) => l.key === 'cityStaff')).toBe(false);
  });
});

describe('facilities: police capacity (WP7-1)', () => {
  it('police need = (residents + 0.5 jobs) x (0.5 + crime); capacities 6k / 30k / 110k; two stations beat one overloaded station', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 61, 30, Network.Road);
    for (let x = 20; x <= 40; x++) place(st, 't_r2', x, 31, { pop: 1200, capacity: 1200, wealth: 2 });
    for (let x = 20; x <= 40; x++) if (x !== 26 && x !== 30) place(st, 't_cs', x, 29, { jobs: 200, capacity: 200 });
    for (let i = 0; i < st.cells; i++) st.crime[i] = 0.3;
    const k1 = place(st, 'civ_police_kiosk', 30, 29);
    k1.flags |= BF.Powered | BF.Watered;
    const sim = newSim(st);
    const svc = sim.getSystem<ServicesSystem>('services')!;
    for (let i = 0; i < st.cells; i++) st.crime[i] = 0.3;
    svc.compute(sim, false);
    const need = svc.needRaster('police')!;
    const i = st.idx(25, 31), j = st.idx(25, 29);
    expect(need[i]).toBeCloseTo(1200 * (0.5 + 0.3), 0);
    expect(need[j]).toBeCloseTo(0.5 * 200 * (0.5 + 0.3), 0);
    expect(policeCapacityOf('civ_police_kiosk')).toBe(POLICE_CAP.civ_police_kiosk);
    expect(policeCapacityOf('civ_police_hq')).toBe(110000);
    const L1 = facilityLoad(sim, k1.id)!;
    expect(L1.capacity).toBe(6000);
    expect(L1.utilization).toBeGreaterThan(1.15);
    const probe = st.idx(28, 31);
    const one = st.policeCov[probe];
    const rep = facilityReport(sim, k1.id)!;
    const load = rep.lines.find((l) => l.key === 'patrolLoad')!;
    expect(load.status).toBe('bad');
    expect(load.value).toMatch(/\/ 6,000/);
    // a second kiosk next to it: the load is split, coverage rises, utilisation falls
    const k2 = place(st, 'civ_police_kiosk', 26, 29);
    k2.flags |= BF.Powered | BF.Watered;
    svc.compute(sim, false);
    const two = st.policeCov[probe];
    console.log(`overloaded kiosk: util ${L1.utilization.toFixed(2)} cov ${one.toFixed(3)} -> two kiosks: cov ${two.toFixed(3)} util ${facilityLoad(sim, k1.id)!.utilization.toFixed(2)} / ${facilityLoad(sim, k2.id)!.utilization.toFixed(2)}`);
    expect(two).toBeGreaterThan(one * 1.3);
    expect(facilityLoad(sim, k1.id)!.utilization).toBeLessThan(L1.utilization);
    expect(st.stats.needs.police.capacity).toBeGreaterThan(0);
    expect(st.stats.needs.police.overcrowded).toBeGreaterThanOrEqual(1);
  });
});

describe('facilities: use factors (WP7-11, critic items 12 / 13)', () => {
  it('airport passengers 0.012 pop^0.95 + overnight: small airport ~0.61 at 12k, ~0.9 at 100k; unused seaport 0.6 once trucks are counted', () => {
    expect(useFactorOf(0)).toBeCloseTo(0.6, 9);
    expect(useFactorOf(0.5)).toBeCloseTo(1, 9);
    expect(useFactorOf(2)).toBeCloseTo(1, 9);
    const st = newState(64);
    roadLine(st, 2, 30, 61, 30, Network.Road);
    const air = place(st, 'tr_airport_small', 10, 31);
    const port = place(st, 'tr_seaport', 40, 20);
    const sim = newSim(st);
    st.systemData.economy = { overnight: 70 };
    st.stats.population = 12000;
    updateUseFactors(sim);
    expect(airportPassengers(st)).toBeCloseTo(0.012 * Math.pow(12000, 0.95) + 70, 3);
    const f12 = facilityUseFactor(st, air);
    st.systemData.economy = { overnight: 365 };
    st.stats.population = 100000;
    updateUseFactors(sim);
    const f100 = facilityUseFactor(st, air);
    console.log(`small airport use factor: ${f12.toFixed(3)} at 12k, ${f100.toFixed(3)} at 100k`);
    expect(f12).toBeGreaterThan(0.6);
    expect(f12).toBeLessThan(0.63);
    expect(f100).toBeGreaterThan(0.87);
    expect(f100).toBeLessThan(0.93);
    const rep = facilityReport(sim, air.id)!;
    expect(rep.lines.find((l) => l.key === 'passengers')!.value).toMatch(/\/ 3,000 a day/);
    // seaport: trucks within reach / 3,000 (WP7b freightSinkTrucks; unknown -> 1)
    const t = freightSinkTrucks(sim, port.id);
    expect(facilityUseFactor(st, port)).toBeCloseTo(t >= 0 ? useFactorOf(t / 3000) : 1, 4);
    console.log(`seaport: freightSinkTrucks ${t} -> use factor ${facilityUseFactor(st, port)}`);
    // persisted: a save keeps the factors
    const back = deserializeCity(structuredClone(serializeCity(st, { copy: true })) as SerializedCity);
    expect(facilityUseFactor(back, back.buildings.get(air.id)!)).toBe(f100);
    // a building without an entry counts 1
    expect(facilityUseFactor(st, place(st, 'park_small', 5, 5))).toBe(1);
  });
});

describe('facilities: patrol model hints and static facts', () => {
  it('police patrols carry car_police, garbage rounds garbage_truck; health buildings push no random patrol', { timeout: 120_000 }, () => {
    const st = newState(64);
    for (let z = 10; z <= 50; z += 10) roadLine(st, 2, z, 61, z);
    for (let x = 10; x <= 50; x += 10) roadLine(st, x, 2, x, 61);
    for (let x = 11; x < 50; x += 2) place(st, 't_r2', x, 11, { pop: 60 });
    place(st, 't_police', 21, 21);
    place(st, 't_clinic', 31, 21);
    place(st, 't_incin', 41, 21);
    const sim = newSim(st);
    sim.runDays(8);
    const tr = sim.getSystem<TrafficSystem>('traffic')!;
    const routes = tr.getSampleRoutes(4096).filter((r) => r.kind === 'service');
    const models = routes.map((r) => r.model ?? '(none)');
    console.log(`service routes: ${models.join(', ')}`);
    expect(models).toContain('car_police');
    expect(models).toContain('garbage_truck');
    for (const m of models) expect(['car_police', 'garbage_truck', '(none)']).toContain(m);
  });

  it('facilityDefFacts: every non-hidden ploppable has static tooltip facts', () => {
    for (const def of ploppableDefs()) {
      const facts = facilityDefFacts(def.id);
      expect(facts.length, def.id).toBeGreaterThanOrEqual(1);
      for (const f of facts) { expect(f.key).toBeTruthy(); expect(f.label).toBeTruthy(); expect(f.value).toBeTruthy(); }
    }
    expect(facilityDefFacts('civ_police_station').map((f) => f.key)).toEqual(expect.arrayContaining(['patrol', 'fleet', 'holding']));
    expect(facilityDefFacts('civ_hospital').find((f) => f.key === 'beds')!.value).toMatch(/^200/);
    expect(facilityDefFacts('util_incinerator').find((f) => f.key === 'output')!.value).toMatch(/by tons burned/);
    expect(facilityDefFacts('util_coal_plant').find((f) => f.key === 'cooling')!.hint).toMatch(/halves/);
    expect(facilityDefFacts('growable-does-not-exist')).toEqual([]);
    expect(getDef('civ_jail')!.coverage).toBeUndefined();
    expect(getDef('civ_courthouse')!.coverage).toBeUndefined();
  });
});

describe('facilities: report texts say what the simulation does (review r1)', () => {
  it('a station placed today is "on duty from tomorrow", not underfunded; a hospital not yet assessed counts beds; a burnt station reports only that', { timeout: 300_000 }, () => {
    const { st, sim, A } = branch();
    expect(A.plop('civ_police_station', SITE.x0, SITE.z0, 0).ok).toBe(true);
    const ps = st.buildingAt(SITE.x0, SITE.z0)!;
    let fleet = facilityReport(sim, ps.id)!.lines.find((l) => l.key === 'fleet')!;
    expect(fleet.value).toBe('0 — on duty from tomorrow');
    expect(fleet.status).toBe('ok');
    expect(fleet.hint).toBeUndefined();
    sim.advanceDay();
    fleet = facilityReport(sim, ps.id)!.lines.find((l) => l.key === 'fleet')!;
    expect(fleet.value).toMatch(/^2 \(\d out\)$/);
    // below ~14 % funding no unit leaves: underfunded, with the real threshold
    st.budget.funding.police = 10;
    sim.advanceDay();
    fleet = facilityReport(sim, ps.id)!.lines.find((l) => l.key === 'fleet')!;
    expect(fleet.value).toBe('0 — underfunded');
    expect(fleet.status).toBe('bad');
    expect(fleet.hint).toMatch(/at least 14%/);
    st.budget.funding.police = 100;
    // a hospital before its first services pass: beds, not patient-equivalents
    expect(A.plop('civ_hospital', SITE.x0, SITE.z0 + 4, 0).ok).toBe(true);
    const hosp = st.buildingAt(SITE.x0, SITE.z0 + 4)!;
    const beds = facilityReport(sim, hosp.id)!.lines.find((l) => l.key === 'beds')!;
    expect(beds.value).toBe(`— / ${((getDef('civ_hospital')!.coverage!.capacity ?? 0) / 200).toLocaleString('en-US')} (not yet assessed)`);
    // burnt: one status line + the upkeep still charged, one warning — no live-looking service lines
    ps.flags |= BF.Burnt;
    sim.events.emit('buildingChanged', ps);
    const rep = facilityReport(sim, ps.id)!;
    expect(rep.lines.map((l) => l.key)).toEqual(['status', 'upkeep']);
    expect(rep.lines[1].hint).toMatch(/bulldoze/);
    expect(rep.warnings).toEqual(['Burnt down — bulldoze it and build it again']);
  });

  it('live service quality names every factor (ordinances, funding, staffing); an unpowered airport claims no relief, income or benefit', { timeout: 300_000 }, () => {
    const { st, sim, A } = branch();
    expect(A.plop('civ_elementary_school', SITE.x0, SITE.z0, 0).ok).toBe(true);
    const school = st.buildingAt(SITE.x0, SITE.z0)!;
    sim.runDays(3);
    st.budget.ordinances.push('pro_reading');
    st.budget.funding.education = 80;
    const q = facilityQuality(st, school);
    const f80 = Math.pow(0.8, 0.7);
    expect(q.total).toBeCloseTo(f80 * 1.1 * (school.flags & BF.Powered ? 1 : 0.3) * facilityOpFactor(st, school), 6);
    const line = facilityReport(sim, school.id)!.lines.find((l) => l.key === 'quality')!;
    expect(line.value).toBe(`${Math.round(Math.min(1.5, q.total) * 100)}%`);
    expect(line.hint).toMatch(/Pro-Reading Campaign \+10%/);
    expect(line.hint).toMatch(/80% budget −/);
    st.budget.ordinances.length = 0;
    st.budget.funding.education = 100;
    // an unpowered airport: demand.ts gives it no relief (venue op 0) and the next booking no income -> the report agrees
    expect(A.plop('tr_airport_small', SITE.x0, SITE.z0 + 5, 0).ok).toBe(true);
    const air = st.buildingAt(SITE.x0, SITE.z0 + 5)!;
    updateUseFactors(sim);
    air.flags &= ~BF.Powered;
    for (let z = air.z; z < air.z + air.d; z++) for (let x = air.x; x < air.x + air.w; x++) st.powered[st.idx(x, z)] = 0;
    const rep = facilityReport(sim, air.id)!;
    const by = (k: string) => rep.lines.find((l) => l.key === k)!;
    expect(by('relief').value).toMatch(/^none while it has no power/);
    expect(by('income').value).toBe('none while it has no power');
    expect(by('use').value).toBe('none while it has no power');
    expect(rep.warnings.some((w) => /^No power — closed/.test(w))).toBe(true);
    // over its rating: at full benefit, and the report says so
    st.stats.population = 2_000_000;
    updateUseFactors(sim);
    air.flags |= BF.Powered;
    const pax = facilityReport(sim, air.id)!.lines.find((l) => l.key === 'passengers')!;
    expect(pax.hint).toMatch(/Busier than its 3,000 rating — already at full benefit/);
  });

  it('a clinic that faces only a highway: "Nobody can walk to it"; producer factors read as signed changes; static facts without repeated nouns', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 61, 30, Network.Highway);
    roadLine(st, 2, 44, 61, 44, Network.Road);
    for (let x = 10; x < 50; x += 2) place(st, 't_r2', x, 45, { pop: 60, capacity: 60, wealth: 1 });
    const clinic = place(st, 'civ_clinic', 20, 31);
    clinic.flags |= BF.Powered | BF.Watered;
    const sim = newSim(st);
    for (const b of st.buildings.values()) b.flags |= BF.Powered | BF.Watered;
    sim.getSystem<ServicesSystem>('services')!.compute(sim, false);
    const rep = facilityReport(sim, clinic.id)!;
    expect(facilityLoad(sim, clinic.id)!.demand).toBeLessThan(1);
    expect(rep.warnings.some((w) => /^Nobody can walk to it — the highway it faces blocks pedestrians/.test(w))).toBe(true);
    expect(rep.lines.some((l) => l.key === 'seniors')).toBe(false); // nobody in reach: no "≈ 0 of 0 residents"
    // producers: a factor under a 1 % change is left out; the rest are signed changes, not bare percentages
    const wind = place(st, 'util_wind_turbine', 40, 20);
    const pump = place(st, 'util_water_pump', 44, 20);
    const plant = place(st, 'util_water_treatment', 50, 10);
    const u = sim.getSystem('utilities') as unknown as { producerInfo: (id: number) => unknown };
    const info: Record<number, unknown> = {
      [wind.id]: { kind: 'power', nominal: 5, output: 3, factors: [{ label: 'Sheltered site', mul: 0.6 }], load: 0.5 },
      [pump.id]: { kind: 'water', nominal: 5000, output: 4995, factors: [{ label: 'Polluted intake', mul: 0.999 }], load: 0.2 },
      [plant.id]: { kind: 'water', nominal: 50000, output: 40500, factors: [{ label: 'Polluted intake', mul: 0.81 }], load: 0.9 },
    };
    u.producerInfo = (id: number) => info[id] ?? null;
    const line = (b: Building, k: string) => facilityReport(sim, b.id)!.lines.find((l) => l.key === k)!;
    expect(line(wind, 'output').hint).toBe('Sheltered site −40%');
    expect(line(pump, 'output').hint).toBeUndefined();
    expect(line(pump, 'intake').hint).toMatch(/tap-water quality/);
    expect(line(plant, 'output').hint).toBe('Polluted intake −19%');
    expect(line(plant, 'intake').hint).toMatch(/it still delivers clean water/);
    // static facts: numbers with their unit once; the wind turbine's height range; stigma in words
    expect(facilityDefFacts('civ_clinic').find((f) => f.key === 'seats')!.value).not.toMatch(/patients/);
    expect(facilityDefFacts('park_playground').find((f) => f.key === 'seats')?.value ?? '').not.toMatch(/kids and teens/);
    expect(facilityDefFacts('util_wind_turbine').find((f) => f.key === 'output')!.value).toBe('3–7 MW by height');
    expect(facilityDefFacts('civ_jail').find((f) => f.key === 'stigma')!.value).toMatch(/^severe within 10 tiles$/);
    expect(facilityDefFacts('civ_jail').find((f) => f.key === 'beds')!.value).toBe(JAIL_BEDS.civ_jail.toLocaleString('en-US'));
  });
});
