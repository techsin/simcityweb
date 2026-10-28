/**
 * B3 (WASM_PLAN B3, WORKER_DESIGN S4): the month-boundary work spread over the month's days, at fixed offsets.
 * Tourism's venue pass (venues, hotels, totals, venue records, visitor raster) runs on day TOURISM_DAY of the month and is
 * saved as systemData.tourismPass; the month tick keeps only the attract step (attractiveness, migration). A save on any
 * day of the month continues the game it was taken from exactly. docs/dev/B3_DESIGN.md §7.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createCityState, computeWater } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { economySystems } from '../../src/sim/systems/economy';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import {
  ATTRACTIONS, TOURISM_DAY, TOURISM_SLICES, attractivenessBreakdown, tourismSummary, tourismSystem, venueVisits,
} from '../../src/sim/economy/tourism';
import { budgetSystem, venueIncomeFactor } from '../../src/sim/economy/budget';
import {
  DEMO_AGG_DAYS, DEMO_PHASE, DEMOGRAPHICS_EVENT_PHASE, EQHQ_DAY, OCC_PHASE, OUTAGE_PRUNE_DAY,
} from '../../src/sim/economy/population';
import { demographicsData } from '../../src/sim/economy/demographics';
import { MONTH_SCAN_DAYS } from '../../src/sim/economy/advisors';
import { FACILITY_SCAN_DAY } from '../../src/sim/infra/facilities';
import { DEMOGRAPHICS_EVENT_DAYS, FREIGHT_REFRESH_DAYS, OCC_PERIOD } from '../../src/sim/economy/tuning';
import { approvalSystem } from '../../src/sim/economy/approval';
import { CityActions, lPath } from '../../src/sim/actions';
import { DAYS_PER_MONTH } from '../../src/core/constants';
import { Network, Zone } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { decodeBundle, encodeBundle } from '../../src/save/bundle';

// ------------------------------------------------------------------------------------------------ the town
const SIZE = 160;
/** the venues, west to east along the road at z 70 (lots at z 71, touching it) */
const VENUES: readonly (readonly [string, number])[] = [
  ['lm_castle', 30], ['civ_museum', 35], ['park_zoo', 39], ['tr_airport_small', 46], ['tr_airport_large', 55], ['tr_train_station', 68],
  ['civ_college', 73], ['lm_opera_house', 79], ['park_plaza', 84], ['park_garden', 87], ['park_large', 90], ['lm_obelisk', 95],
  ['lm_clock_tower', 97], ['lm_arch', 99], ['lm_observatory', 102], ['rw_casino', 105], ['civ_convention_center', 109], ['civ_city_hall', 114],
  ['park_stadium', 119], ['park_amusement', 126], ['lm_pyramid', 133], ['lm_ferris_wheel', 137],
];
/** the venue the script plops on day 58, and where */
const LATE_VENUE = ['lm_cathedral', 30] as const;

/**
 * the systems of a town: 'economy' = every economy system; 'tourism' = tourism, budget and approval on one runtime (the
 * continuity tests: the rest of the economy does not continue exactly across a load in the base either — population's
 * post-load refill, approval's init — and B3's claim is tourism's continuity; with these three the whole city does)
 */
type Systems = 'economy' | 'tourism';
const systemsOf = (s: Systems): SimSystem[] => {
  if (s === 'economy') return economySystems();
  const rt = new EconRuntime();
  return [tourismSystem(rt), budgetSystem(rt), approvalSystem(rt)];
};

/**
 * An economy-only town: 148 apartment blocks along an edge-to-edge avenue (z 40), four of them historic; six hotels and
 * 22 venues (landmarks, culture, parks, airports, a train station, a college) along a road (z 70); a lake along the south
 * edge with a shore road (z 139): beaches.
 */
function town(systems: Systems = 'tourism') {
  const st = createCityState(defaultCityConfig({ size: SIZE, seed: 1234, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
  const N1 = SIZE + 1;
  for (let z = 0; z <= SIZE; z++) for (let x = 0; x <= SIZE; x++) st.heights[z * N1 + x] = z >= 146 ? -1 : 1;
  computeWater(st);
  st.trees.fill(0);
  const sim = new Simulation(st, systemsOf(systems));
  const A = new CityActions(sim);
  st.funds = 1e8;
  const road = (x0: number, z0: number, x1: number, z1: number, type = Network.Road) => {
    expect(A.buildNetwork(lPath({ x: x0, z: z0 }, { x: x1, z: z1 }), type).ok).toBe(true);
  };
  road(0, 40, SIZE - 1, 40, Network.Avenue);
  road(0, 70, SIZE - 1, 70);
  road(0, 139, SIZE - 1, 139);
  let nextId = 5_000_000;
  const grow = (defId: string, x: number, z: number, o: Partial<Building>, zone: Zone) => {
    const def = getDef(defId)!;
    const b: Building = {
      id: nextId++, def: defId, x, z, w: def.footprint[0], d: def.footprint[1], rot: 0, variant: 0, pop: 0, jobs: 0, capacity: def.capacity ?? 0,
      wealth: 2, built: 1, age: 400, flags: BF.Powered | BF.Watered, baseY: 1, health: 0.8, unhappy: 0, ...o,
    };
    st.nextBuildingId = Math.max(st.nextBuildingId, b.id + 1);
    placeBuilding(sim, b);
    for (let zz = z; zz < z + b.d; zz++) for (let xx = x; xx < x + b.w; xx++) st.zone[zz * SIZE + xx] = zone;
    return b;
  };
  const homes: Building[] = [];
  for (const z of [38, 41]) for (let x = 2; x + 2 <= SIZE - 2; x += 2) homes.push(grow('res_apartment.r2.4', x, z, { pop: 130, capacity: 130 }, Zone.ResMed));
  for (const k of [7, 30, 61, 100]) homes[k].flags |= BF.Historic;
  for (let k = 0; k < 6; k++) grow('com_hotel.cs1.5', 4 + k * 4, 71, { jobs: 150 + k }, Zone.ComMed);
  const ids: Record<string, number> = {};
  for (const [defId, x] of VENUES) ids[defId] = plop(sim, A, defId, x);
  // (a city of 100k for the venues' size factor; the population system, when it runs, writes its own)
  st.stats.population = 100000;
  return { st, sim, A, ids, homes };
}
type Town = ReturnType<typeof town>;
function plop(sim: Simulation, A: CityActions, defId: string, x: number): number {
  const def = getDef(defId)!;
  if (def.requires) sim.state.unlocked.add(def.requires);
  const r = A.plop(defId, x, 71, 0);
  expect(r.ok, `${defId}: ${r.reason}`).toBe(true);
  return sim.state.buildingAt(x, 71)!.id;
}
const rectOf = (b: Building) => ({ x0: b.x, z0: b.z, x1: b.x + b.w - 1, z1: b.z + b.d - 1 });
function bulldoze(st: CityState, A: CityActions, id: number): void {
  const b = st.buildings.get(id)!;
  expect(A.bulldoze(rectOf(b)).ok).toBe(true);
  expect(st.buildings.has(id)).toBe(false);
}
/**
 * the player's script (determinism R4), at the end of its day: day 30 bulldozes a venue that is not the last plopped
 * building (the runtime swap-removes it from rt.plopped; a load rebuilds the list in Map order); day 58 — after the
 * pass of day 56, before the tick of day 60 — bulldozes a landmark and the operating large airport and plops a venue
 */
function script(sim: Simulation, A: CityActions, ids: Record<string, number>): void {
  const st = sim.state;
  if (st.day === 30) bulldoze(st, A, ids.civ_museum);
  if (st.day === 58) {
    bulldoze(st, A, ids.lm_castle);
    bulldoze(st, A, ids.tr_airport_large);
    plop(sim, A, LATE_VENUE[0], LATE_VENUE[1]);
  }
}
const runTo = (sim: Simulation, day: number, A?: CityActions, ids?: Record<string, number>) => {
  while (sim.state.day < day) { sim.advanceDay(); if (A && ids) script(sim, A, ids); }
};
const tourismOf = (sim: Simulation) => sim.getSystem<SimSystem & { refresh(sim: Simulation): void; rt: EconRuntime }>('economy.tourism')!;
interface Pass { m: number; culture: number; conn: number[]; seats: number; kEff: number; tc: number; dump: boolean; ven: Float64Array; spl: Float64Array }
const passOf = (st: CityState) => st.systemData.tourismPass as Pass;
const load = (ser: SerializedCity, systems: Systems = 'tourism') => {
  const st = deserializeCity(structuredClone(ser));
  const sim = new Simulation(st, systemsOf(systems));
  return { st, sim, A: new CityActions(sim) };
};

/** the first path where a and b differ (numbers with Object.is, typed arrays byte for byte, objects key by key), '' if none */
function diffPath(a: unknown, b: unknown, path = ''): string {
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return `${path || '.'}: typed array / other`;
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (x.length !== y.length) return `${path || '.'}: ${x.length} / ${y.length} bytes`;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `${path || '.'}: byte ${i}`;
    return '';
  }
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return Object.is(a, b) ? '' : `${path || '.'}: ${String(a)} / ${String(b)}`;
  }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) return `${path || '.'}: keys {${ka.join()}} / {${kb.join()}}`;
  for (const k of ka) {
    const d = diffPath((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return '';
}
/** what the player sees of tourism right now (venues, summary, breakdown, raster) */
const tourismView = (st: CityState, ids: readonly number[]) => ({
  venues: ids.map((id) => venueVisits(st, id)), summary: tourismSummary(st), breakdown: attractivenessBreakdown(st), visitors: st.visitors.slice(),
});
/** tourism's outputs (econData, stats), the income lines it feeds, the breakdown and the raster */
function tourismOutputs(st: CityState) {
  const d = econData(st), s = st.stats;
  const income: Record<string, number> = {};
  for (const [k, v] of Object.entries(st.budget.lastIncome ?? {})) if (k === 'tourism' || k.startsWith('facility:')) income[k] = v;
  return {
    econ: {
      tourists: d.tourists, touristsGross: d.touristsGross, overnight: d.overnight, hotelShortage: d.hotelShortage, tourism: d.tourism,
      attractiveness: d.attractiveness, attractByWealth: d.attractByWealth, attractTerms: d.attractTerms, migration: d.migration, migrants: d.migrants,
    },
    stats: { tourists: s.tourists, hotelRooms: s.hotelRooms, attractiveness: s.attractiveness, attractByWealth: s.attractByWealth },
    income, breakdown: attractivenessBreakdown(st), visitors: st.visitors.slice(),
  };
}
/** the venue pass's outputs (totals, records, raster) and the attract step's (attractiveness, its terms, migration) */
function passView(st: CityState, ids: readonly number[]) {
  const d = econData(st), s = st.stats;
  return {
    pass: { totals: [d.tourists, d.touristsGross, d.overnight, d.hotelShortage, d.tourism, s.tourists, s.hotelRooms], venues: ids.map((id) => venueVisits(st, id)), visitors: st.visitors.slice() },
    attract: { a: d.attractiveness, w: d.attractByWealth, t: d.attractTerms, mig: d.migration, m: d.migrants, s: s.attractiveness, sw: s.attractByWealth },
  };
}
/** sha256 of a serialized city (keys sorted, typed arrays by bytes; savedAt left out) */
function sha(v: unknown): string {
  const h = createHash('sha256');
  const feed = (x: unknown): void => {
    if (ArrayBuffer.isView(x)) h.update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
    else if (Array.isArray(x)) { h.update('['); for (const y of x) feed(y); h.update(']'); }
    else if (x && typeof x === 'object') for (const k of Object.keys(x).sort()) { if (k === 'savedAt') continue; h.update(k); feed((x as Record<string, unknown>)[k]); }
    else h.update(String(x));
  };
  feed(v);
  return h.digest('hex');
}
/** the window of the hotel-room / historic slices that `day` belongs to (the days after one TOURISM_DAY up to the next;
 *  0, not −0, before the first one) */
const windowOf = (day: number) => Math.ceil((day - TOURISM_DAY) / TOURISM_SLICES) + 0;

// ------------------------------------------------------------------------------------------------ tests
describe('B3: the venue pass on TOURISM_DAY, the attract step on the month tick', () => {
  it('schedule: totals, records, raster and the layer event change on the pass day only; the tick scores the pass', { timeout: 120000 }, () => {
    expect(TOURISM_DAY).toBe(26);
    const t = town('economy');
    const ids = Object.values(t.ids);
    const layer: number[] = [];
    t.sim.events.on('layerUpdated', (name) => { if (name === 'tourism') layer.push(t.st.day); });
    let prev = passView(t.st, ids);
    for (let day = 1; day <= 91; day++) {
      const passBefore = passOf(t.st);
      t.sim.advanceDay();
      const cur = passView(t.st, ids);
      const passDay = day % DAYS_PER_MONTH === TOURISM_DAY, tick = day % DAYS_PER_MONTH === 0;
      expect(diffPath(prev.pass, cur.pass) !== '', `day ${day}: the pass's outputs change`).toBe(passDay);
      expect(diffPath(prev.attract, cur.attract) !== '', `day ${day}: the attract step's outputs change`).toBe(tick);
      if (passDay) expect(passOf(t.st).m).toBe(Math.ceil(day / DAYS_PER_MONTH));
      if (tick) {
        // the tick scored the pass of day TOURISM_DAY: the same object, fed to this tick
        expect(passOf(t.st)).toBe(passBefore);
        expect(passOf(t.st).m).toBe(t.st.monthIndex);
        expect(passOf(t.st).tc).toBe(passOf(t.st).culture);
      }
      prev = cur;
    }
    expect(layer).toEqual([26, 56, 86]);
    expect(econData(t.st).tourists).toBeGreaterThan(1000);
    expect(tourismSummary(t.st)!.beachCells).toBeGreaterThan(40);
    expect(tourismSummary(t.st)!.historic).toBeGreaterThan(0);
  });

  it('a save on any day of the month (31…60) continues the uninterrupted game exactly, with bulldozed and new venues', { timeout: 300000 }, () => {
    const ref = town();
    // (the venue the script plops on day 58 gets the next building id: nothing else builds in this town)
    const late = ref.st.nextBuildingId;
    const all = [...Object.values(ref.ids), late];
    const saves = new Map<number, SerializedCity>();
    const views = new Map<number, ReturnType<typeof tourismView>>();
    const outs = new Map<number, ReturnType<typeof tourismOutputs>>();
    while (ref.st.day < 91) {
      ref.sim.advanceDay();
      if (ref.st.day === 57) {
        // the script's day-58 removals hit a landmark and an operating airport that the pass of day 56 counted
        expect(venueVisits(ref.st, ref.ids.lm_castle)!.gross).toBeGreaterThan(0);
        expect(venueVisits(ref.st, ref.ids.tr_airport_large)!.op).toBeGreaterThan(0);
        expect(passOf(ref.st).conn[0]).toBe(1);
      }
      script(ref.sim, ref.A, ref.ids);
      if (ref.st.day === 30) {
        // the day-30 removal reordered rt.plopped: no longer ascending (a load rebuilds it in Map order)
        const pl = tourismOf(ref.sim).rt.plopped.map((b) => b.id);
        expect(pl.some((id, k) => k > 0 && id < pl[k - 1])).toBe(true);
      }
      if (ref.st.day === 58) expect(ref.st.buildingAt(LATE_VENUE[1], 71)!.id).toBe(late);
      if (ref.st.day >= 31 && ref.st.day <= 60) {
        saves.set(ref.st.day, serializeCity(ref.st, { copy: true }));
        views.set(ref.st.day, tourismView(ref.st, all));
      }
      if (ref.st.day === 60) {
        // the new venue has no record until the pass of day 86: it earned its catalog income at this tick (factor 1)
        expect(venueVisits(ref.st, late)).toBeNull();
        expect(venueIncomeFactor(ref.st, late, LATE_VENUE[0])).toBe(1);
        expect(passOf(ref.st).conn[0]).toBe(0);
      }
      if (ref.st.day === 60 || ref.st.day === 90) outs.set(ref.st.day, tourismOutputs(ref.st));
    }
    expect(venueVisits(ref.st, late)!.visits).toBeGreaterThan(0);
    const end = serializeCity(ref.st, { copy: true });
    for (const [s, ser] of saves) {
      const g = load(ser);
      expect(diffPath(views.get(s), tourismView(g.st, all)), `save on day ${s}: right after the load`).toBe('');
      while (g.st.day < 91) {
        g.sim.advanceDay();
        script(g.sim, g.A, ref.ids);
        if (g.st.day === 60 || g.st.day === 90) expect(diffPath(outs.get(g.st.day), tourismOutputs(g.st)), `save on day ${s}: day ${g.st.day}`).toBe('');
      }
      // … and so does the whole city: its save on day 91, field by field and by digest (savedAt is the clock time)
      const e = serializeCity(g.st, { copy: true });
      expect(diffPath({ ...end, savedAt: 0 }, { ...e, savedAt: 0 }), `save on day ${s}: the whole city on day 91`).toBe('');
      expect(sha(e), `save on day ${s}: the city digest on day 91`).toBe(sha(end));
    }
  });

  it('a save in the city\'s first month continues exactly: the slice window is 0, never −0 (the bundle codec stores 0)', { timeout: 120000 }, () => {
    const ref = town();
    const saves = new Map<number, SerializedCity>();
    while (ref.st.day < 91) {
      ref.sim.advanceDay();
      if (ref.st.day === 3 || ref.st.day === 25) {
        expect(Object.is((ref.st.systemData.tourismAcc as { m: number }).m, 0), `day ${ref.st.day}: window 0`).toBe(true);
        saves.set(ref.st.day, serializeCity(ref.st, { copy: true }));
      }
    }
    const end = serializeCity(ref.st, { copy: true });
    for (const [s, ser] of saves) {
      // the game's save files (the bundle codec) and a structured clone load the same city, and both continue the game
      const viaBundle = deserializeCity(decodeBundle(encodeBundle(ser)) as SerializedCity);
      const viaClone = deserializeCity(structuredClone(ser));
      expect(diffPath(viaClone.systemData, viaBundle.systemData), `save on day ${s}: bundle / clone`).toBe('');
      for (const st of [viaBundle, viaClone]) {
        const sim = new Simulation(st, systemsOf('tourism'));
        runTo(sim, 91);
        const e = serializeCity(st, { copy: true });
        expect(diffPath({ ...end, savedAt: 0 }, { ...e, savedAt: 0 }), `save on day ${s}: the whole city on day 91`).toBe('');
      }
    }
  });

  it('a layer listener that throws on the pass day leaves the pass saved and the next window started: saves on days 56–59 continue', { timeout: 120000 }, () => {
    const g = town();
    let thrown = 0;
    g.sim.events.on('layerUpdated', (n) => { if (n === 'tourism' && g.st.day === 56 && thrown++ === 0) throw new Error('overlay'); });
    // (the browser's guard: the scene catches what a day throws and runs the next day)
    const step = () => { try { g.sim.advanceDay(); } catch (e) { expect((e as Error).message).toBe('overlay'); } };
    while (g.st.day < 56) step();
    expect(thrown).toBe(1);
    // the pass of day 56 is the saved one (fresh for the tick of day 60), and the slice record is the next window's
    expect(passOf(g.st).m).toBe(2);
    const acc = g.st.systemData.tourismAcc as { m: number; done: number; rooms: number; hist: number[] };
    expect([acc.m, acc.done, acc.rooms, acc.hist.length]).toEqual([windowOf(57), 0, 0, 0]);
    const all = Object.values(g.ids);
    const saves = new Map<number, SerializedCity>(), views = new Map<number, ReturnType<typeof tourismView>>();
    for (;;) {
      if (g.st.day <= 59) {
        saves.set(g.st.day, serializeCity(g.st, { copy: true }));
        views.set(g.st.day, tourismView(g.st, all));
      }
      if (g.st.day >= 91) break;
      step();
    }
    const end = serializeCity(g.st, { copy: true });
    for (const [s, ser] of saves) {
      const h = load(ser);
      expect(passOf(h.st).m, `save on day ${s}`).toBe(2);
      expect(diffPath(views.get(s), tourismView(h.st, all)), `save on day ${s}: right after the load`).toBe('');
      runTo(h.sim, 91);
      const e = serializeCity(h.st, { copy: true });
      expect(diffPath({ ...end, savedAt: 0 }, { ...e, savedAt: 0 }), `save on day ${s}: the whole city on day 91`).toBe('');
      expect(sha(e), `save on day ${s}: the city digest on day 91`).toBe(sha(end));
    }
  });

  it('fallbacks: a missing or invalid pass, a v1 slice record (saves from before B3)', { timeout: 120000 }, () => {
    const ref = town();
    runTo(ref.sim, 40);
    const dom10 = serializeCity(ref.st, { copy: true });
    const attract40 = econData(ref.st).attractiveness;
    runTo(ref.sim, 56);
    const pass56 = structuredClone(passOf(ref.st)), out56 = tourismOutputs(ref.st);
    runTo(ref.sim, 58);
    const dom28 = serializeCity(ref.st, { copy: true });
    const attract58 = econData(ref.st).attractiveness;
    const castle = ref.ids.lm_castle;
    const atCastle = (st: CityState) => st.visitors[st.idx(st.buildings.get(castle)!.x + 1, st.buildings.get(castle)!.z + 1)];
    /** a copy of a save, edited: no pass (an old save) and sentinel totals, to see which totals init keeps */
    const edited = (ser: SerializedCity, edit: (sd: Record<string, unknown>) => void) => {
      const c = structuredClone(ser);
      edit(c.data.systemData as Record<string, unknown>);
      return c;
    };
    const old = (sd: Record<string, unknown>) => {
      delete sd.tourismPass;
      (sd.economy as { tourists: number }).tourists = 12345;
    };
    // (a) loaded on dom 10: init rebuilds the records and the raster; the saved totals and attractiveness stand until the
    // pass of day 56 and the tick of day 60
    const a = load(edited(dom10, old));
    expect(venueVisits(a.st, castle)!.visits).toBeGreaterThan(0);
    expect(atCastle(a.st)).toBeGreaterThan(0.05);
    expect(econData(a.st).tourists).toBe(12345);
    expect(econData(a.st).attractiveness).toBe(attract40);
    expect(passOf(a.st).m).toBe(2);
    expect(passOf(a.st).ven).toBeInstanceOf(Float64Array);
    // … loaded on dom 28: init's pass feeds the coming tick, so its totals stand (next to its records) and the saved
    // attractiveness is put back; the tick of day 60 scores init's pass, without a pass of its own
    const b = load(edited(dom28, old));
    const pB = passOf(b.st);
    expect(pB.m).toBe(2);
    expect(econData(b.st).attractiveness).toBe(attract58);
    const fresh = load(dom28);
    tourismOf(fresh.sim).refresh(fresh.sim);
    expect(econData(b.st).tourists).toBe(econData(fresh.st).tourists);
    expect(econData(b.st).tourists).not.toBe(12345);
    let layerB = 0;
    b.sim.events.on('layerUpdated', (n) => { if (n === 'tourism') layerB++; });
    runTo(b.sim, 60);
    expect(layerB).toBe(0);
    expect(passOf(b.st)).toBe(pB);
    // … with the pass deleted after init, the tick runs its own
    const c = load(edited(dom28, old));
    runTo(c.sim, 59);
    delete c.st.systemData.tourismPass;
    let layerC = 0;
    c.sim.events.on('layerUpdated', (n) => { if (n === 'tourism') layerC++; });
    runTo(c.sim, 60);
    expect(layerC).toBe(1);
    expect(passOf(c.st).m).toBe(2);
    expect(econData(c.st).attractiveness).toBe(econData(b.st).attractiveness);
    // (c) a pass that fails the validator takes the fallback: a Float32Array (ids above 2^24 would not survive), a short
    // conn, an unknown version, a non-finite field
    for (const edit of [
      (p: Record<string, unknown>) => { p.ven = new Float32Array(p.ven as Float64Array); },
      (p: Record<string, unknown>) => { p.conn = [1, 1, 1]; },
      (p: Record<string, unknown>) => { p.v = 2; },
      (p: Record<string, unknown>) => { p.kEff = NaN; },
    ]) {
      const g = load(edited(dom10, (sd) => { edit(sd.tourismPass as Record<string, unknown>); (sd.economy as { tourists: number }).tourists = 12345; }));
      const p = passOf(g.st) as unknown as Record<string, unknown>;
      expect(p.v).toBe(1);
      expect(p.ven).toBeInstanceOf(Float64Array);
      expect((p.conn as number[]).length).toBe(4);
      expect(Number.isFinite(p.kEff)).toBe(true);
      expect(econData(g.st).tourists).toBe(12345);
    }
    // (b) a v1 slice record (from before B3: its window ended on the tick) becomes an empty v2; the window is then
    // incomplete, so the pass of day 56 takes one full pass — the same sums as the uninterrupted game's slices
    const v1 = load(edited(dom10, (sd) => { sd.tourismAcc = { v: 1, m: 2, done: 0b11111111110, rooms: 999, hist: [castle] }; }));
    runTo(v1.sim, 41);
    expect((v1.st.systemData.tourismAcc as { v: number }).v).toBe(2);
    runTo(v1.sim, 56);
    expect(diffPath(pass56, passOf(v1.st))).toBe('');
    expect(diffPath(out56, tourismOutputs(v1.st))).toBe('');
  });

  it('a save from before B3 (no pass, a v1 slice record) loaded on dom 10 or 28 continues, and is the uninterrupted game from its first tick on', { timeout: 120000 }, () => {
    // (a static town: nothing changes between the game's venue pass and the load, so a load-time pass equals it)
    const ref = town();
    const saves = new Map<number, SerializedCity>();
    const outs = new Map<number, ReturnType<typeof tourismOutputs>>();
    while (ref.st.day < 91) {
      ref.sim.advanceDay();
      if (ref.st.day === 40 || ref.st.day === 58) saves.set(ref.st.day, serializeCity(ref.st, { copy: true }));
      if (ref.st.day === 56 || ref.st.day === 60 || ref.st.day === 90) outs.set(ref.st.day, tourismOutputs(ref.st));
    }
    const end = serializeCity(ref.st, { copy: true });
    for (const [s, ser] of saves) {
      const c = structuredClone(ser);
      const sd = c.data.systemData as Record<string, unknown>;
      delete sd.tourismPass;
      sd.tourismAcc = { v: 1, m: 2, done: 0b111, rooms: 999, hist: [] };
      const g = load(c);
      expect(passOf(g.st).ven).toBeInstanceOf(Float64Array);
      while (g.st.day < 91) {
        g.sim.advanceDay();
        const o = outs.get(g.st.day);
        if (!o) continue;
        // (on day 56 the culture detail of the breakdown is still the one init's pass scored: what the last tick scored
        // stays with a pass until the next tick)
        const cur = tourismOutputs(g.st);
        const skip = g.st.day === 56 ? { breakdown: [] } : {};
        expect(diffPath({ ...o, ...skip }, { ...cur, ...skip }), `save on day ${s}: day ${g.st.day}`).toBe('');
      }
      const e = serializeCity(g.st, { copy: true });
      expect(diffPath({ ...end, savedAt: 0 }, { ...e, savedAt: 0 }), `save on day ${s}: the whole city on day 91`).toBe('');
      expect(sha(e), `save on day ${s}: the city digest on day 91`).toBe(sha(end));
    }
  });

  it('a venue bulldozed between the pass and the tick leaves the totals and the tick\'s scores at once (never below 0)', { timeout: 120000 }, () => {
    // A bulldozes the castle and the large airport on day 28 (after the pass), B on day 25 (before it), C keeps them
    const A = town(), B = town(), C = town();
    runTo(B.sim, 25);
    bulldoze(B.st, B.A, B.ids.lm_castle);
    bulldoze(B.st, B.A, B.ids.tr_airport_large);
    runTo(A.sim, 28);
    const p = passOf(A.st);
    expect(p.conn[0]).toBe(1);
    const castle = venueVisits(A.st, A.ids.lm_castle)!, airport = venueVisits(A.st, A.ids.tr_airport_large)!;
    expect(castle.gross).toBeGreaterThan(0);
    expect(airport.op).toBeGreaterThan(0);
    const t0 = econData(A.st).tourists, c0 = p.culture;
    bulldoze(A.st, A.A, A.ids.lm_castle);
    bulldoze(A.st, A.A, A.ids.tr_airport_large);
    expect(econData(A.st).tourists).toBeCloseTo(t0 - castle.visits - airport.visits, 6);
    expect(A.st.stats.tourists).toBe(Math.round(econData(A.st).tourists));
    expect(p.culture).toBe(c0 - castle.gross);
    expect(p.conn[0]).toBe(0);
    // (the last tick, init's, scored no landmark: its culture visits stay at 0, not below)
    expect(p.tc).toBe(0);
    expect(passOf(A.st)).toBe(p);
    for (const g of [A, B, C]) runTo(g.sim, 30);
    const connect = (g: Town) => econData(g.st).attractTerms.connect;
    expect(connect(A)).toBe(connect(B));
    expect(connect(A)).toBeLessThan(connect(C));
    expect(passOf(A.st).tc).toBe(passOf(A.st).culture);
    // the clamps: a pass whose culture / connections are already below the record's (never below 0)
    const D = town();
    runTo(D.sim, 28);
    const q = passOf(D.st);
    q.culture = 1; q.tc = 1; q.conn[0] = 0;
    bulldoze(D.st, D.A, D.ids.lm_castle);
    bulldoze(D.st, D.A, D.ids.tr_airport_large);
    expect(q.culture).toBe(0);
    expect(q.tc).toBe(0);
    expect(q.conn[0]).toBe(0);
  });

  it('determinism: two runs of the same city give identical saves after a year (12 passes, 12 ticks)', { timeout: 300000 }, () => {
    const run = () => {
      const t = town('economy');
      runTo(t.sim, 361, t.A, t.ids);
      return sha(serializeCity(t.st, { copy: true }));
    };
    expect(run()).toBe(run());
  });

  it('slicing: each window holds every slice once; the pass reads it only from the daily; venues in ascending id', { timeout: 120000 }, () => {
    const t = town();
    for (let day = 1; day <= 150; day++) {
      t.sim.advanceDay();
      const acc = t.st.systemData.tourismAcc as { v: number; m: number; done: number };
      expect(acc.v).toBe(2);
      if (day % TOURISM_SLICES === TOURISM_DAY) {
        // the pass read the window and the next one starts with the next day
        expect(acc.m).toBe(windowOf(day) + 1);
        expect(acc.done).toBe(0);
        expect(windowOf(day + 1)).toBe(acc.m);
        continue;
      }
      expect(acc.m).toBe(windowOf(day));
      let bits = 0;
      for (let d = Math.max(1, day - TOURISM_SLICES + 1); d <= day; d++) if (windowOf(d) === windowOf(day)) bits |= 1 << (d % TOURISM_SLICES);
      expect(acc.done, `day ${day}`).toBe(bits);
    }
    expect(t.st.stats.hotelRooms).toBe(Math.round(1.5 * (150 + 151 + 152 + 153 + 154 + 155)));
    // the daily's pass reads the window's sums …
    const truth = t.st.stats.hotelRooms;
    runTo(t.sim, 175);
    (t.st.systemData.tourismAcc as { rooms: number }).rooms += 1000;
    runTo(t.sim, 176);
    expect(t.st.stats.hotelRooms).toBe(truth + 1000);
    // … no other pass does: refresh, and the tick's fallback, take one full pass
    tourismOf(t.sim).refresh(t.sim);
    expect(t.st.stats.hotelRooms).toBe(truth);
    runTo(t.sim, 179);
    (t.st.systemData.tourismAcc as { rooms: number }).rooms += 5000;
    delete t.st.systemData.tourismPass;
    runTo(t.sim, 180);
    expect(t.st.stats.hotelRooms).toBe(truth);
    // the venues in ascending id, whatever the order of rt.plopped: a bulldozed venue reorders the list (swap-remove)
    const u = town();
    runTo(u.sim, 30);
    bulldoze(u.st, u.A, u.ids.civ_museum);
    const pl = tourismOf(u.sim).rt.plopped.map((b) => b.id);
    expect(pl.some((id, k) => k > 0 && id < pl[k - 1])).toBe(true);
    runTo(u.sim, 55);
    const copy = load(serializeCity(u.st, { copy: true }));
    const pl2 = tourismOf(copy.sim).rt.plopped.map((b) => b.id);
    expect(pl2).toEqual([...pl2].sort((x, y) => x - y));
    runTo(u.sim, 56);
    runTo(copy.sim, 56);
    const ven = passOf(u.st).ven;
    const vid: number[] = [];
    for (let k = 0; k < ven.length; k += 3) vid.push(ven[k]);
    expect(vid.length).toBe(VENUES.filter(([d]) => ATTRACTIONS[d]).length - 1);
    expect(vid).toEqual([...vid].sort((x, y) => x - y));
    expect(diffPath(passOf(u.st), passOf(copy.st))).toBe('');
    expect(diffPath(tourismOutputs(u.st), tourismOutputs(copy.st))).toBe('');
  });
});

describe('B3: the population samples off the month tick (P3), and the month calendar', () => {
  it('P3: no month tick is an employment or a demographics sample day; the samples recur every 4 and 32 days; the demographics event on dom 1', { timeout: 120000 }, () => {
    for (let day = 1; day <= 960; day++) {
      if (day % DAYS_PER_MONTH !== 0) continue;
      expect(day % OCC_PERIOD, `tick ${day}`).not.toBe(OCC_PHASE);
      expect(day % DEMO_AGG_DAYS, `tick ${day}`).not.toBe(DEMO_PHASE);
    }
    // every demographics day is an employment day (the demographics sample reads the employment sample's records)
    expect(DEMO_PHASE % OCC_PERIOD).toBe(OCC_PHASE);
    expect(DEMO_AGG_DAYS % OCC_PERIOD).toBe(0);
    // in a running town (every economy system): the employment sample writes wfNow, the demographics sample the saved
    // grids — only on their days
    const t = town('economy');
    const events: number[] = [];
    t.sim.events.on('layerUpdated', (name) => { if (name === 'demographics') events.push(t.st.day); });
    let wf = demographicsData(t.st).wfNow, grids = sha(t.st.systemData.popGrids);
    const wfDays: number[] = [], gridDays: number[] = [];
    for (let day = 1; day <= 200; day++) {
      t.sim.advanceDay();
      const w = demographicsData(t.st).wfNow, g = sha(t.st.systemData.popGrids);
      if (!Object.is(w, wf)) wfDays.push(day);
      if (g !== grids) gridDays.push(day);
      wf = w;
      grids = g;
    }
    expect(wfDays.length).toBeGreaterThan(10);
    for (const d of wfDays) expect(d % OCC_PERIOD, `wfNow on day ${d}`).toBe(OCC_PHASE);
    expect(gridDays.length).toBeGreaterThanOrEqual(3);
    for (const d of gridDays) expect(d % DEMO_AGG_DAYS, `grids on day ${d}`).toBe(DEMO_PHASE);
    expect(events).toEqual([1, 31, 61, 91, 121, 151, 181]);
    expect(DEMOGRAPHICS_EVENT_DAYS).toBe(DAYS_PER_MONTH);
  });

  it('the calendar: the month work never falls on the tick (dom 0); the heavy steps on distinct days; the samples never on 0, 26 or 28', () => {
    const CORE_DAY = 20; // growth.ts (the commercial core; not exported)
    const offsets: Record<string, number> = {
      EQHQ_DAY, TOURISM_DAY, zoneScan: MONTH_SCAN_DAYS[0], facScan: MONTH_SCAN_DAYS[1], CORE_DAY, FACILITY_SCAN_DAY,
      freight: FREIGHT_REFRESH_DAYS >> 1, prune: OUTAGE_PRUNE_DAY, demographicsEvent: DEMOGRAPHICS_EVENT_PHASE,
    };
    for (const [k, d] of Object.entries(offsets)) expect(d > 0 && d < DAYS_PER_MONTH, `${k} = ${d}`).toBe(true);
    const heavy = [EQHQ_DAY, TOURISM_DAY, MONTH_SCAN_DAYS[0], MONTH_SCAN_DAYS[1], CORE_DAY, FACILITY_SCAN_DAY];
    expect(new Set(heavy).size).toBe(heavy.length);
    // the samples (odd days) in 64 months: never on the tick, the venue pass or the zone scan
    for (let day = 1; day <= 64 * DAYS_PER_MONTH; day++) {
      const dom = day % DAYS_PER_MONTH;
      if (dom !== 0 && dom !== TOURISM_DAY && dom !== MONTH_SCAN_DAYS[0]) continue;
      expect(day % OCC_PERIOD === OCC_PHASE, `employment sample on day ${day}`).toBe(false);
      expect(day % DEMO_AGG_DAYS === DEMO_PHASE, `demographics sample on day ${day}`).toBe(false);
    }
  });
});
