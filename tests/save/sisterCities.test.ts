/**
 * LG-12: sister cities (src/region/regionEffects.ts, economy/budget.ts bookEndowments, economy/approval.ts).
 * - The rules: up to 25% of the parent's funds, at most §5M, once per city per 10 game years (with the date it is
 *   possible again); nothing from a sandbox city.
 * - The best free tile (the one whose shared edge holds the most of the parent's edge roads) and the road stub, which
 *   is no neighbour connection until the new city's roads join it (veteran finding 6).
 * - The region's ledger entry is the transfer: both cities book it once, from every save, and a store killed anywhere in
 *   the founding's save chain holds a whole transfer or none.
 * - The parent's "Founded a sister city" approval for 12 months; a city without a sister is not touched at all.
 * - NOTE-095: a sister city starts on its parent's date (that year and month), so its first save, its news and the
 *   parent's 10-year line agree, and each city's 10-year dates are in its own calendar.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Network } from '../../src/core/types';
import { RegionModel, generateRegionTerrain } from '../../src/region/RegionModel';
import { summarizeCity } from '../../src/region/citySummary';
import {
  ADJ_SHARE, ENDOWMENT_MAX, ENDOWMENT_MIN, ENDOWMENT_SHARE, ENDOWMENT_YEARS, SISTER_STUB_CELLS, applyRegionEffects, commitSisterCity, endowmentBlock,
  endowmentLimit, gameMonthLabel, lastEndowmentDay, planSisterCity, prepareSisterCity, regionContext, sisterLines, sisterLinks, sisterNote, sisterParent,
  sisterStart, sisterStub, sisterTile, type SisterPlan,
} from '../../src/region/regionEffects';
import type { RegionData, RegionTile } from '../../src/region/types';
import { loadRegion, saveRegion } from '../../src/save';
import { clearRecoveryBase, hasCity, loadCity, saveCity } from '../../src/save/cities';
import { setKV } from '../../src/save/db';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { CityActions, lPath } from '../../src/sim/actions';
import { CityState } from '../../src/sim/CityState';
import { SISTER_APPROVAL, SISTER_APPROVAL_DAYS, approvalBreakdown } from '../../src/sim/economy/approval';
import { ENDOWMENT_KEY, bookEndowments, sisterBooks } from '../../src/sim/economy/budget';
import { CONN_MIN_CELLS, CONN_MIN_DEPTH, updateNeighborConnections } from '../../src/sim/economy/connections';
import { connectionRelief } from '../../src/sim/economy/demand';
import { econData } from '../../src/sim/economy/runtime';
import { EDGE_CONN, EDGE_NONE, WORKFORCE_RATIO } from '../../src/sim/economy/tuning';
import { REGION_JOB_MIN, REGION_JOB_SHARE } from '../../src/sim/infra/params';
import { Simulation } from '../../src/sim/Simulation';
import { economySystems } from '../../src/sim/systems/economy';
import { dayLabel } from '../../src/ui/format';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { SimCore } from '../../src/worker/SimCore';
import { LocalSimHost } from '../../src/worker/SimHost';
import { makeCity } from '../sim/helpers';
import { MemStorage, PersistentMemoryKV } from './fixtures';

// ------------------------------------------------------------------------------------------------ the region
/** a hand-laid neighbourhood: the parent (medium) with two small tiles east, a medium one south and west, a large north */
const P = '4_4', E1 = '6_4', E2 = '6_5', S = '4_6', W = '2_4', N = '4_0';
function tiles(): RegionTile[] {
  return [
    { key: P, x: 4, z: 4, size: 2 },
    { key: E1, x: 6, z: 4, size: 1 },
    { key: E2, x: 6, z: 5, size: 1 },
    { key: S, x: 4, z: 6, size: 2 },
    { key: W, x: 2, z: 4, size: 2 },
    { key: N, x: 4, z: 0, size: 4 },
  ];
}
let model: RegionModel;
let data: RegionData;
const tile = (key: string, m: RegionModel = model) => m.tileByKey(key)!;
beforeAll(() => {
  data = {
    format: 'metropolis-region', version: 1, genVersion: 1, id: 'sisters', name: 'Sister Valley', seed: 3, preset: 'greenvale',
    climate: 'temperate', tiles: tiles(), totals: { population: 0, cities: 0, r: 0, c: 0, i: 0 }, created: 1, lastPlayed: 1,
  };
  // (a preview-resolution terrain: the tests only ask it how wet a tile is)
  model = new RegionModel(data, generateRegionTerrain(data.seed, data.preset, { samplesPerUnit: 8 }, data.climate));
}, 60_000);
let kv: PersistentMemoryKV;
const cores: SimCore[] = [];
const hosts: LocalSimHost[] = [];
/** an empty store and an unfounded region */
function reset(): void {
  for (const t of data.tiles) delete t.city;
  delete data.endowments;
  kv = new PersistentMemoryKV();
  setKV(kv);
  clearRecoveryBase();
}
beforeEach(() => {
  reset();
  vi.stubGlobal('localStorage', new MemStorage());
});
afterEach(async () => {
  for (const c of cores.splice(0)) c.dispose();
  for (const h of hosts.splice(0)) await h.dispose();
  clearRecoveryBase();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** year 43, April: day 15,570 */
const DAY = 43 * 360 + 90;
const TEN_YEARS = ENDOWMENT_YEARS * 360;

/** roads written straight into the layer: (x0,z0)..(x1,z1) inclusive */
function lay(st: CityState, x0: number, z0: number, x1: number, z1: number, type = Network.Road): void {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) st.network[z * st.size + x] = type;
}
/** the parent's state: flat dry land, §8M, with its tile summary (founded stamp 1000). `roads`: one road reaches its
 *  east edge at z 40, on E1's half of that edge, so E1 is the first tile a founding picks */
function parentCity(funds = 8_000_000, day = DAY, m: RegionModel = model, roads = true): CityState {
  const st = new CityState(m.cityConfigFor(tile(P, m), { name: 'Queensbury', mayor: 'Ada Lovell' }));
  st.funds = funds;
  st.day = day;
  if (roads) lay(st, 120, 40, 127, 40);
  tile(P, m).city = { ...summarizeCity(st), founded: 1000 };
  return st;
}
function childCity(key: string, m: RegionModel = model, name = 'Fairland'): CityState {
  return new CityState(m.cityConfigFor(tile(key, m), { name, mayor: 'Ada Lovell' }));
}
/** the plan of a founding from `st`, with `amount` chosen in the dialog */
function planFrom(st: CityState, amount = 0, m: RegionModel = model): SisterPlan {
  const plan = planSisterCity(m, tile(P, m), sisterParent(st, P))!;
  plan.amount = amount;
  return plan;
}
/** the new city of a plan, on the tile it picked */
const childOf = (plan: SisterPlan, name = 'Fairland', m: RegionModel = model) => childCity(plan.to.key, m, name);
/** open a city as every host does: the region's context first, then the systems' init (SimCore.boot) */
function open(st: CityState, key: string, m: RegionModel = model): SimCore {
  const core = new SimCore(st);
  core.boot(regionContext(m, tile(key, m)), { createSystems: economySystems });
  cores.push(core);
  return core;
}
/** main.ts startNewCity's steps for a sister city; `stop` kills the tab before that step */
async function found(plan: SisterPlan, child: CityState = childOf(plan), stop?: 'city' | 'region' | 'regionWrite'): Promise<void> {
  prepareSisterCity(child, plan);
  plan.to.city = summarizeCity(child);
  if (stop === 'city') return;
  await saveCity(data.id, plan.to.key, child);
  if (stop === 'region') return;
  await commitSisterCity(data, plan, stop === 'regionWrite' ? () => Promise.reject(new Error('killed')) : () => saveRegion(data)).catch((e: Error) => {
    if (e.message !== 'killed') throw e;
  });
}
/** a new tab: only the store survives */
async function reopen(): Promise<{ m: RegionModel; d: RegionData }> {
  const d = (await loadRegion(data.id))!;
  return { m: new RegionModel(d, model.terrain), d };
}
const roadCells = (st: CityState) => st.network.reduce((n, v) => n + (v ? 1 : 0), 0);

// ------------------------------------------------------------------------------------------------ the rules
describe('LG-12: the endowment rules', () => {
  it('a city may give a quarter of its funds, at most §5M', () => {
    expect([ENDOWMENT_SHARE, ENDOWMENT_MAX, ENDOWMENT_YEARS]).toEqual([0.25, 5_000_000, 10]);
    expect(endowmentLimit(8_000_000)).toBe(2_000_000);
    expect(endowmentLimit(17_712_345)).toBe(4_428_086);
    expect(endowmentLimit(20_000_000)).toBe(5_000_000);
    expect(endowmentLimit(900_000_000)).toBe(5_000_000);
    for (const none of [0, -50_000, NaN, Infinity, -Infinity]) expect(endowmentLimit(none), String(none)).toBe(0);
  });

  it('the plan offers the limit in whole slider steps, and nothing when the treasury is too small', () => {
    const rich = planFrom(parentCity(17_712_345));
    expect([rich.to.key, rich.limit, rich.step, rich.blocked, rich.amount]).toEqual([E1, 4_420_000, 10_000, undefined, 0]);
    const town = planFrom(parentCity(100_000));
    expect([town.limit, town.step]).toEqual([25_000, 1_000]);
    const village = planFrom(parentCity(9_999));
    expect([village.limit, village.step]).toEqual([2_400, 100]);
    const poor = planFrom(parentCity(4 * ENDOWMENT_MIN - 1));
    expect(poor.limit).toBe(0);
    expect(poor.blocked).toBe('Queensbury has too little money to endow a sister city.');
    expect(planFrom(parentCity(-20_000)).blocked).toBe('Queensbury has too little money to endow a sister city.');
  });

  it('a sandbox city cannot endow', () => {
    const st = parentCity();
    st.config.difficulty = 'sandbox';
    st.config.sandbox = true;
    const plan = planFrom(st);
    expect(plan.limit).toBe(0);
    expect(plan.blocked).toBe('A sandbox city has unlimited money, so it cannot endow a sister city.');
  });

  it('a second endowment within 10 game years is refused with the date it becomes possible', async () => {
    const st = parentCity();
    await found(planFrom(st, 2_000_000));
    expect(tile(E1).city?.name).toBe('Fairland');
    expect(lastEndowmentDay(data, tile(P))).toBe(DAY);
    // the same day, five years on, and the last day of the tenth year: refused, with both dates in the parent's calendar
    for (const day of [DAY, DAY + 5 * 360, DAY + TEN_YEARS - 1]) {
      st.day = day;
      const again = planSisterCity(model, tile(P), sisterParent(st, P))!;
      expect(again.limit, String(day)).toBe(0);
      expect(again.blocked).toBe('Queensbury endowed a sister city in Apr 2043. It can endow another from Apr 2053 (once every 10 years).');
      // the founding itself stays possible, on another free tile
      expect(again.to.city).toBeUndefined();
    }
    st.day = DAY + TEN_YEARS;
    const later = planSisterCity(model, tile(P), sisterParent(st, P))!;
    expect([later.blocked, later.limit]).toEqual([undefined, 2_000_000]);
    expect(gameMonthLabel(DAY, 2000)).toBe('Apr 2043');
    expect(gameMonthLabel(DAY + TEN_YEARS, 1950)).toBe('Apr 2003');
  });

  it('founding without an endowment does not start the 10 years, and another city on the tile starts fresh', async () => {
    const st = parentCity();
    await found(planFrom(st, 0));
    expect(data.endowments).toHaveLength(1);
    expect(lastEndowmentDay(data, tile(P))).toBeUndefined();
    expect(endowmentBlock(data, tile(P), sisterParent(st, P))).toBeUndefined();
    await found(planFrom(st, 1_000_000));
    expect(endowmentBlock(data, tile(P), sisterParent(st, P))).toMatch(/^Queensbury endowed a sister city in Apr 2043/);
    // the city is deleted and another one founded on its tile: the ledger's entries are not its own
    tile(P).city = { ...tile(P).city!, founded: 2000 };
    expect(lastEndowmentDay(data, tile(P))).toBeUndefined();
    expect(endowmentBlock(data, tile(P), sisterParent(st, P))).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------ tile and stub
describe('LG-12: the best free tile and the road stub', () => {
  it('reads the parent\'s edge roads from its state without touching it', () => {
    const st = parentCity();
    lay(st, 30, 120, 30, 127, Network.Avenue);
    lay(st, 0, 50, 0, 50, Network.Street); // a single cell at the west edge: nothing behind it
    lay(st, 60, 0, 60, 9, Network.OneWay);
    st.netFlags[60] = 0b1100 | 1; // direction 3 (−z), and a bit that is not the direction
    lay(st, 90, 127, 90, 127, Network.Rail); // rail is not a road
    const network = st.network.slice(), netFlags = st.netFlags.slice();
    // it is given these fields only (each is mirrored on a host's replica), frozen where an object can be
    const view = Object.freeze({ size: st.size, network: st.network, netFlags: st.netFlags, funds: st.funds, day: st.day, config: Object.freeze({ ...st.config }) });
    const p = sisterParent(view, P);
    expect(p).toMatchObject({ tileKey: P, name: 'Queensbury', mayor: 'Ada Lovell', funds: 8_000_000, day: DAY, startYear: 2000, sandbox: false });
    expect(p.edgeRoads).toEqual({
      n: [{ a: 60, type: Network.OneWay, dir: 0b1100, inward: true }],
      s: [{ a: 30, type: Network.Avenue, dir: 0, inward: true }],
      e: [{ a: 40, type: Network.Road, dir: 0, inward: true }],
      w: [{ a: 50, type: Network.Street, dir: 0, inward: false }],
    });
    expect(sisterParent(st, P)).toEqual(p);
    expect(Buffer.compare(Buffer.from(st.network.buffer), Buffer.from(network.buffer))).toBe(0);
    expect(Buffer.compare(Buffer.from(st.netFlags.buffer), Buffer.from(netFlags.buffer))).toBe(0);
  });

  it('picks the free tile whose shared edge holds the most of the parent\'s edge roads', () => {
    const st = parentCity(); // one road to the east edge, on E1's half
    expect(sisterTile(model, tile(P), sisterParent(st, P))!.tile.key).toBe(E1);
    lay(st, 120, 100, 127, 100); // and one on E2's half: one each, equal edges: the drier tile
    const water = vi.spyOn(model, 'tileWaterFraction').mockImplementation((t) => (t.key === E1 ? 0.3 : 0.1));
    expect(sisterTile(model, tile(P), sisterParent(st, P))!.tile.key).toBe(E2);
    water.mockRestore();
    lay(st, 30, 120, 30, 127);
    lay(st, 80, 120, 81, 127); // three road cells on the south edge
    const south = sisterTile(model, tile(P), sisterParent(st, P))!;
    expect(south.tile.key).toBe(S);
    expect(south.seg).toMatchObject({ edge: 's', from: 0, to: 128, founded: false });
    // a founded tile is never picked, however many roads lead to it
    tile(S).city = summarizeCity(childCity(S));
    expect([E1, E2]).toContain(sisterTile(model, tile(P), sisterParent(st, P))!.tile.key);
  });

  it('without edge roads the longest shared edge wins, then the least water; no free tile, no sister city', () => {
    const st = parentCity(8_000_000, DAY, model, false);
    const water: Record<string, number> = { [E1]: 0, [E2]: 0, [S]: 0.3, [W]: 0.1, [N]: 0.2 };
    vi.spyOn(model, 'tileWaterFraction').mockImplementation((t) => water[t.key]);
    expect(sisterTile(model, tile(P), sisterParent(st, P))!.tile.key).toBe(W);
    tile(W).city = summarizeCity(childCity(W));
    expect(sisterTile(model, tile(P), sisterParent(st, P))!.tile.key).toBe(N);
    for (const k of [N, S, E1, E2]) tile(k).city = summarizeCity(childCity(k));
    expect(sisterTile(model, tile(P), sisterParent(st, P))).toBeNull();
    expect(planSisterCity(model, tile(P), sisterParent(st, P))).toBeNull();
  });

  it('continues each road that reaches the shared edge into the new tile, at the same place on the edge', () => {
    const st = parentCity(); // east, z 40: E1 covers the parent's z 0..63
    lay(st, 120, 100, 127, 100, Network.Avenue); // east, z 100: E2 covers z 64..127
    lay(st, 30, 120, 30, 127, Network.Highway); // south, x 30
    lay(st, 0, 50, 7, 50, Network.Street); // west, z 50
    lay(st, 20, 0, 20, 7); // north, x 20
    const p = sisterParent(st, P);
    const seg = (key: string) => regionContext(model, tile(P)).neighbors.find((n) => n.tileKey === key)!;
    const stub = (key: string) => sisterStub(tile(P), tile(key), seg(key), p);
    expect(SISTER_STUB_CELLS).toBe(CONN_MIN_DEPTH);
    const road = { type: Network.Road, dir: 0 };
    expect(stub(E1)).toEqual([[{ x: 0, z: 40, ...road }, { x: 1, z: 40, ...road }, { x: 2, z: 40, ...road }]]);
    // (E2 starts one region unit further south: the parent's z 100 is its z 36)
    expect(stub(E2)).toEqual([[0, 1, 2].map((x) => ({ x, z: 36, type: Network.Avenue, dir: 0 }))]);
    expect(stub(S)).toEqual([[0, 1, 2].map((z) => ({ x: 30, z, type: Network.Highway, dir: 0 }))]);
    expect(stub(W)).toEqual([[127, 126, 125].map((x) => ({ x, z: 50, type: Network.Street, dir: 0 }))]);
    // (the large tile north: its south edge is row 255)
    expect(stub(N)).toEqual([[255, 254, 253].map((z) => ({ x: 20, z, ...road }))]);
  });

  it('a wide road keeps its width, a road along the border is continued once, at a junction where it has one', () => {
    const along = parentCity();
    lay(along, 10, 127, 50, 127); // a road along the south border, nothing joins it from inside
    const seg = regionContext(model, tile(P)).neighbors.find((n) => n.tileKey === S)!;
    expect(sisterStub(tile(P), tile(S), seg, sisterParent(along, P)).map((c) => c[0].x)).toEqual([30]);
    lay(along, 20, 120, 21, 126, Network.Avenue); // an avenue two cells wide joins it at x 20 and 21
    expect(sisterStub(tile(P), tile(S), seg, sisterParent(along, P)).map((c) => [c[0].x, c[0].type, c.length])).toEqual([[20, Network.Road, 3], [21, Network.Road, 3]]);
    // two separate roads: two stubs
    const two = parentCity();
    lay(two, 40, 120, 40, 127);
    lay(two, 90, 120, 90, 127, Network.Street);
    expect(sisterStub(tile(P), tile(S), seg, sisterParent(two, P)).map((c) => [c[0].x, c[0].type])).toEqual([[40, Network.Road], [90, Network.Street]]);
  });

  it('lays the stub in the new city: its road type and direction, no trees; water or a steep cell ends it', () => {
    const st = parentCity();
    lay(st, 120, 40, 127, 40, Network.OneWay);
    for (let x = 120; x <= 127; x++) st.netFlags[40 * 128 + x] = 0b1000; // heading −x, into the parent
    lay(st, 120, 10, 127, 10);
    lay(st, 120, 20, 127, 20, Network.Avenue);
    const plan = planFrom(st);
    expect(plan.to.key).toBe(E1);
    const child = childCity(E1);
    child.trees.fill(3);
    child.water[10 * 64 + 1] = 1; // water one cell in on the z 10 road's line
    child.heights[20 * 65 + 2] = 20; // a cliff corner on the z 20 avenue's second cell
    prepareSisterCity(child, plan);
    const at = (x: number, z: number) => [child.network[z * 64 + x], child.netFlags[z * 64 + x], child.trees[z * 64 + x]];
    expect([0, 1, 2, 3].map((x) => at(x, 40))).toEqual([[Network.OneWay, 0b1000, 0], [Network.OneWay, 0b1000, 0], [Network.OneWay, 0b1000, 0], [Network.None, 0, 3]]);
    expect([0, 1, 2].map((x) => at(x, 10))).toEqual([[Network.Road, 0, 0], [Network.None, 0, 3], [Network.None, 0, 3]]);
    expect([0, 1, 2].map((x) => at(x, 20))).toEqual([[Network.Avenue, 0, 0], [Network.None, 0, 3], [Network.None, 0, 3]]);
    // its save names the founding, its parent, and where the first stub starts
    expect(child.systemData.sisterOf).toEqual({ v: 1, id: plan.id, tile: P, name: 'Queensbury', at: { x: 0, z: 10 } });
    const land = childCity(E1);
    land.water.fill(1);
    prepareSisterCity(land, plan);
    expect([roadCells(land), land.systemData.sisterOf]).toEqual([0, { v: 1, id: plan.id, tile: P, name: 'Queensbury' }]);
    // nothing else is on the map, and the money is not in the first save: the ledger entry moves it
    expect(roadCells(child)).toBe(5);
    expect(child.funds).toBe(child.config.startFunds);
    expect(summarizeCity(child).sisterOf).toBe(P);
    expect('sisterOf' in summarizeCity(childCity(E1))).toBe(false);
  });

  it('veteran finding 6: the stub alone is no neighbour connection and relieves no demand cap, until the city\'s roads join it', () => {
    const st = parentCity();
    lay(st, 120, 40, 127, 41, Network.Highway); // two lanes: a stub two cells wide, six cells in all
    const plan = planFrom(st);
    const child = childCity(E1);
    prepareSisterCity(child, plan);
    expect(roadCells(child)).toBe(2 * SISTER_STUB_CELLS);
    expect(2 * SISTER_STUB_CELLS).toBeGreaterThanOrEqual(CONN_MIN_CELLS); // enough cells: it is its depth that keeps it out
    expect(updateNeighborConnections(child)).toBe(false);
    expect(child.neighborConnections).toEqual([]);
    const none = { R: 0, C: 0, I: 0 };
    connectionRelief(child, none);
    expect(none).toEqual({ R: 0, C: 0, I: 0 });
    // the parent is as it was: its own edge road is its own connection, with or without the sister city
    const twin = parentCity();
    lay(twin, 120, 40, 127, 41, Network.Highway);
    updateNeighborConnections(st);
    updateNeighborConnections(twin);
    expect(st.neighborConnections).toEqual(twin.neighborConnections);
    expect(Buffer.compare(Buffer.from(st.network.buffer), Buffer.from(twin.network.buffer))).toBe(0);
    // the mayor of the new city builds on from the stub: now it is a road into the city, and a connection
    const sim = new Simulation(child, []);
    const built = new CityActions(sim).buildNetwork(lPath({ x: 2, z: 40 }, { x: 9, z: 40 }), Network.Highway);
    expect(built.ok).toBe(true);
    expect(child.neighborConnections).toEqual([{ edge: 'w', x: 0, z: 40, type: Network.Highway }]);
    const relief = { R: 0, C: 0, I: 0 };
    connectionRelief(child, relief);
    expect(relief.I).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------------------------ the ledger
describe('LG-12: the region\'s ledger', () => {
  it('a region without sister cities gives every city the context it always had', () => {
    const st = parentCity();
    tile(E1).city = summarizeCity(childCity(E1));
    for (const key of [P, E1]) expect('endowments' in regionContext(model, tile(key))).toBe(false);
    applyRegionEffects(st, regionContext(model, tile(P)));
    expect('endowments' in (st.systemData.region as object)).toBe(false);
    const sim = new Simulation(st, economySystems());
    expect(st.systemData.sisterBooks).toBeUndefined();
    expect(st.funds).toBe(8_000_000);
    sim.runDays(60);
    expect('sisterCity' in econData(st).approvalTerms).toBe(false);
    expect(Object.keys(st.budget.lastExpense).concat(Object.keys(st.budget.lastIncome))).not.toContain(ENDOWMENT_KEY);
  });

  it('the region write stores the entry with the new tile, and shows both treasuries as they will stand', async () => {
    const st = parentCity();
    const plan = planFrom(st, 2_000_000);
    await found(plan);
    const stored = (await loadRegion(data.id))!;
    const t = (key: string) => stored.tiles.find((x) => x.key === key)!;
    expect(stored.endowments).toEqual([{ id: plan.id, from: P, to: E1, amount: 2_000_000, day: DAY, fromFounded: 1000, toFounded: t(E1).city!.founded }]);
    expect(t(P).city!.funds).toBe(6_000_000);
    expect(t(E1).city).toMatchObject({ name: 'Fairland', funds: 2_100_000, sisterOf: P });
    // the two cities' sides of it; a neighbour that is neither gets none
    tile(S).city = summarizeCity(childCity(S));
    expect(regionContext(model, tile(P)).endowments).toEqual([{ id: plan.id, dir: 'out', amount: 2_000_000, day: DAY, city: 'Fairland' }]);
    expect(regionContext(model, tile(E1)).endowments).toEqual([{ id: plan.id, dir: 'in', amount: 2_000_000, day: DAY, city: 'Queensbury' }]);
    expect('endowments' in regionContext(model, tile(S))).toBe(false);
    // structured-clone friendly: it goes into the save and to the worker
    expect(() => structuredClone(regionContext(model, tile(P)))).not.toThrow();
  });

  it('never more than the plan allows, whatever amount reaches it', async () => {
    const st = parentCity(1_000_000);
    await found(planFrom(st, 9_000_000));
    expect(data.endowments![0].amount).toBe(250_000);
    const st2 = parentCity(1_000_000);
    st2.day = DAY + 1;
    const blocked = planFrom(st2, 100_000); // the 10-year rule: nothing, whatever the plan carries
    expect(blocked.blocked).toBeDefined();
    await found(blocked);
    expect(data.endowments!.map((e) => e.amount)).toEqual([250_000, 0]);
    delete data.endowments;
    const negative = planFrom(parentCity(), -5);
    expect([negative.blocked, negative.limit]).toEqual([undefined, 2_000_000]);
    await found(negative);
    expect(data.endowments!.map((e) => e.amount)).toEqual([0]);
  });

  it('a region write that fails takes the entry and the shown money back; the retry stores it once', async () => {
    const st = parentCity();
    const plan = planFrom(st, 2_000_000);
    const child = childCity(E1);
    prepareSisterCity(child, plan);
    plan.to.city = summarizeCity(child);
    await saveCity(data.id, E1, child);
    await expect(commitSisterCity(data, plan, () => Promise.reject(new Error('quota')))).rejects.toThrow('quota');
    expect(data.endowments).toBeUndefined();
    expect([tile(P).city!.funds, tile(E1).city!.funds]).toEqual([8_000_000, 100_000]);
    // main.ts retries the whole founding with the same plan: a new state, a new tile summary, the same id
    await found(plan, childCity(E1));
    expect(data.endowments!.map((e) => e.id)).toEqual([plan.id]);
    expect([tile(P).city!.funds, tile(E1).city!.funds]).toEqual([6_000_000, 2_100_000]);
    // and committing the same plan once more replaces its entry instead of adding one
    tile(E1).city!.funds = 100_000;
    await commitSisterCity(data, plan, () => saveRegion(data));
    expect(data.endowments).toHaveLength(1);
    expect([tile(P).city!.funds, tile(E1).city!.funds]).toEqual([6_000_000, 2_100_000]);
    await expect(commitSisterCity(data, { ...plan, to: tile(S) }, async () => undefined)).rejects.toThrow('tile summary');
  });

  it('the sister links: on the region card, on both tile cards, and gone with either city', async () => {
    expect(sisterLines(data)).toEqual([]);
    const st = parentCity();
    await found(planFrom(st, 1_000_000));
    st.day += 1;
    const second = planFrom(st);
    expect(second.to.key).not.toBe(E1);
    await found(second, childOf(second, 'Eastport'));
    expect(sisterLinks(data).map((l) => [l.parent.key, l.city.key])).toEqual([[P, E1], [P, second.to.key]]);
    expect(sisterLines(data)).toEqual(['Queensbury → Fairland, Eastport']);
    expect(sisterNote(data, tile(P))).toBe('sister cities: Fairland, Eastport');
    expect(sisterNote(data, tile(E1))).toBe('sister city of Queensbury');
    expect(sisterNote(data, tile(second.to.key === S ? W : S))).toBe('');
    // a sister city that founds one of its own is both
    const fair = childCity(E1);
    fair.systemData.sisterOf = { v: 1, id: data.endowments![0].id, tile: P, name: 'Queensbury' };
    tile(E1).city = { ...summarizeCity(fair), founded: tile(E1).city!.founded };
    const grand = planSisterCity(model, tile(E1), sisterParent(fair, E1))!;
    await found(grand, childOf(grand, 'Northgate'));
    expect(sisterNote(data, tile(E1))).toBe('sister city of Queensbury · sister city: Northgate');
    expect(sisterLines(data)).toContain('Fairland → Northgate');
    // the parent is deleted, and another city founded on its tile: no link to that one
    tile(P).city = { ...tile(P).city!, name: 'Newcomer', founded: 9999 };
    expect(sisterLinks(data).map((l) => l.city.city!.name)).toEqual(['Northgate']);
    delete tile(P).city;
    expect(sisterNote(data, tile(E1))).toBe('sister city: Northgate');
  });
});

// ------------------------------------------------------------------------------------------------ the calendar
describe('LG-12: a sister city starts on its parent\'s date (NOTE-095)', () => {
  it('its parent\'s year and month, from the first of that month', () => {
    const at = (day: number, startYear = 2000) => sisterStart({ day, startYear });
    expect(at(43 * 360 + 8 * 30 + 5)).toEqual({ startYear: 2043, day: 240 }); // 6 Sep 2043: 1 Sep 2043
    expect(at(DAY)).toEqual({ startYear: 2043, day: 90 }); // 1 Apr 2043: the day itself
    expect(at(43 * 360 + 359)).toEqual({ startYear: 2043, day: 330 }); // 30 Dec 2043: 1 Dec 2043
    expect(at(50 * 360 + 14, 1950)).toEqual({ startYear: 2000, day: 0 }); // 15 Jan 2000 in a city started in 1950
    expect(at(0)).toEqual({ startYear: 2000, day: 0 });
  });

  it('a sister founded from a parent in 2043 starts in 2043: its first save\'s date and the endowment line agree, and each city\'s 10-year dates are in its own calendar', async () => {
    const st = parentCity(8_000_000, 43 * 360 + 8 * 30 + 5); // 6 Sep 2043 (start year 2000)
    const plan = planFrom(st, 2_000_000);
    // main.ts startNewCity: the dialog's config (here an ordinary one: start year 2000) and FEEL-05's 1 April, then the
    // sister city's own preparation
    const child = childOf(plan);
    child.day = 90;
    child.systemData.foundedDay = 90;
    await found(plan, child);
    const first = (await loadCity(data.id, E1))!;
    expect([first.config.startYear, first.day, first.systemData.foundedDay, first.year]).toEqual([2043, 240, 240, 2043]);
    expect(dayLabel(first.day, first.config.startYear)).toBe('Sep 1, 2043');
    expect(tile(E1).city!.year).toBe(2043); // the region's tile card
    // the parent's 10-year line names the month the new city's calendar starts in
    const line = endowmentBlock(data, tile(P), sisterParent(st, P))!;
    expect(line).toBe('Queensbury endowed a sister city in Sep 2043. It can endow another from Sep 2053 (once every 10 years).');
    expect(line).toContain(` in ${gameMonthLabel(first.day, first.config.startYear)}.`);
    // and so does the new city's news of its founding, booked when it is opened
    open(first, E1);
    expect(dayLabel(first.news.find((n) => n.text.startsWith('Queensbury founded'))!.day, first.config.startYear)).toBe('Sep 1, 2043');
    // two years on in its own calendar the sister city endows one of its own: that line is in its calendar, from 2045
    first.day += 2 * 360;
    tile(E1).city = { ...summarizeCity(first), founded: tile(E1).city!.founded };
    const grand = planSisterCity(model, tile(E1), sisterParent(first, E1))!;
    grand.amount = 100_000;
    const north = childOf(grand, 'Northgate');
    await found(grand, north);
    expect([north.config.startYear, north.day]).toEqual([2045, 240]);
    expect(endowmentBlock(data, tile(E1), sisterParent(first, E1))).toBe('Fairland endowed a sister city in Sep 2045. It can endow another from Sep 2055 (once every 10 years).');
    // the parent's has not moved: its own calendar opens the window ten years to the day later, in Sep 2053
    expect(endowmentBlock(data, tile(P), sisterParent(st, P))).toBe(line);
    st.day = 53 * 360 + 8 * 30 + 4;
    expect(endowmentBlock(data, tile(P), sisterParent(st, P))).toBe(line);
    st.day += 1;
    expect(endowmentBlock(data, tile(P), sisterParent(st, P))).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------ the bookings
describe('LG-12: each city books its side of the entry exactly once', () => {
  /** what a city pays every month for what stands on it (the report's recurring lines) */
  const upkeep = (s: CityState) => Object.entries(s.budget.lastExpense).reduce((n, [k, v]) => n + (k.startsWith('oneoff:') ? 0 : v), 0);

  it('the parent pays once, on the endowment line; the new city opens with its start funds plus the endowment', async () => {
    const st = parentCity();
    const plan = planFrom(st, 2_000_000);
    const child = childCity(E1);
    await found(plan, child);
    // the new city is entered at once
    const sister = open(child, E1);
    expect(child.funds).toBe(2_100_000);
    expect(child.budget.curIncome).toEqual({ [ENDOWMENT_KEY]: 2_000_000 });
    expect(child.budget.curExpense).toEqual({});
    expect(sisterBooks(child)).toEqual({ v: 1, booked: [plan.id] });
    // (the news item points at the stub: the place to build on from)
    expect(child.news.find((n) => n.text.startsWith('Queensbury founded'))).toMatchObject({
      text: 'Queensbury founded this city as its sister city and gave it §2,000,000 to start with. Its road reaches our border here: build on from it to connect the two cities.',
      kind: 'good', x: 0, z: 40,
    });
    expect([0, 1, 2, 3].map((x) => child.network[40 * 64 + x])).toEqual([Network.Road, Network.Road, Network.Road, Network.None]); // joined to the parent's edge road
    // the parent, the next time it is opened
    const parent = open(st, P);
    expect(st.funds).toBe(6_000_000);
    expect(st.budget.curExpense).toEqual({ [ENDOWMENT_KEY]: 2_000_000 });
    expect(st.budget.curIncome).toEqual({});
    expect(sisterBooks(st)).toEqual({ v: 1, booked: [plan.id], founded: DAY });
    expect(st.news.map((n) => n.text)).toContain('We founded Fairland as our sister city and gave it §2,000,000 to start with. Residents are proud of it.');
    // two months on: the monthly region refresh has booked nothing more, and the line was in one report only
    parent.sim.runDays(60);
    sister.sim.runDays(60);
    expect(st.budget.lastExpense[ENDOWMENT_KEY] ?? 0).toBe(0);
    expect(child.budget.lastIncome[ENDOWMENT_KEY] ?? 0).toBe(0);
    expect(st.funds).toBe(6_000_000 - 2 * upkeep(st));
    expect(child.funds).toBe(2_100_000 - 2 * upkeep(child));
    expect(sisterBooks(st)!.booked).toEqual([plan.id]);
  });

  it('the report of the month it was booked in lists it once, as a one-off outside the monthly net', async () => {
    const st = parentCity(8_000_000, DAY, model, false); // no road: nothing recurring in its budget
    await found(planFrom(st, 2_000_000));
    const parent = open(st, P);
    parent.sim.runDays(30);
    expect(st.budget.lastExpense[ENDOWMENT_KEY]).toBe(2_000_000);
    expect(st.budget.curExpense).toEqual({});
    expect(econData(st).lastNet).toBe(0);
    expect(st.funds).toBe(6_000_000);
  });

  it('a save round trip, a second boot and the monthly refresh never book it again', async () => {
    const st = parentCity();
    const plan = planFrom(st, 2_000_000);
    await found(plan);
    open(st, P);
    expect(st.funds).toBe(6_000_000);
    const loaded = deserializeCity(serializeCity(st, { copy: true }));
    open(loaded, P);
    expect(loaded.funds).toBe(6_000_000);
    expect(loaded.budget.curExpense).toEqual({ [ENDOWMENT_KEY]: 2_000_000 });
    const sim = new Simulation(loaded, []);
    bookEndowments(sim);
    applyRegionEffects(loaded, regionContext(model, tile(P)));
    bookEndowments(sim);
    expect(loaded.funds).toBe(6_000_000);
    expect(sisterBooks(loaded)!.booked).toEqual([plan.id]);
    expect(loaded.news.filter((n) => n.text.startsWith('We founded Fairland'))).toHaveLength(1);
  });

  it('only the city the founding made takes the money: not a later city on its tile, nor one founded on the parent\'s', async () => {
    const st = parentCity();
    const plan = planFrom(st, 2_000_000);
    await found(plan);
    // the sister city is deleted and a plain city founded there
    const plain = childCity(E1, model, 'Plainville');
    tile(E1).city = { ...summarizeCity(plain), founded: 5000 };
    open(plain, E1);
    expect(plain.funds).toBe(100_000);
    expect(plain.systemData.sisterBooks).toBeUndefined();
    expect(plain.budget.curIncome).toEqual({});
    // ... or another sister city, from another founding
    const other = childCity(E1, model, 'Otherton');
    other.systemData.sisterOf = { v: 1, id: 'another-founding', tile: P, name: 'Queensbury' };
    open(other, E1);
    expect(other.funds).toBe(100_000);
    // the parent still pays for what it gave (the transfer can't be undone by deleting the new city)
    expect(regionContext(model, tile(P)).endowments).toEqual([{ id: plan.id, dir: 'out', amount: 2_000_000, day: DAY, city: null }]);
    // but a city founded later on the PARENT's tile owes nothing
    const heir = parentCity(500_000);
    tile(P).city = { ...summarizeCity(heir), founded: 2000 };
    expect('endowments' in regionContext(model, tile(P))).toBe(false);
    open(heir, P);
    expect(heir.funds).toBe(500_000);
  });

  it('founding without an endowment moves no money, and still counts as a founding', async () => {
    const st = parentCity();
    const plan = planFrom(st, 0);
    const child = childCity(E1);
    await found(plan, child);
    expect([tile(P).city!.funds, tile(E1).city!.funds]).toEqual([8_000_000, 100_000]);
    open(child, E1);
    open(st, P);
    expect([st.funds, child.funds]).toEqual([8_000_000, 100_000]);
    expect([st.budget.curExpense, child.budget.curIncome]).toEqual([{}, {}]);
    expect(sisterBooks(st)).toEqual({ v: 1, booked: [plan.id], founded: DAY });
    expect(st.news.map((n) => n.text)).toContain('We founded Fairland as our sister city. Residents are proud of it.');
    expect(child.news.map((n) => n.text)).toContain('Queensbury founded this city as its sister city. Its road reaches our border here: build on from it to connect the two cities.');
    // without a stub (the parent has no road at that edge) the news names no place
    const far = planFrom(st, 0);
    const lone = childOf(far, 'Loneham');
    far.stub = [];
    await found(far, lone);
    open(lone, far.to.key);
    expect(lone.news.find((n) => n.text.startsWith('Queensbury founded'))).toMatchObject({ text: 'Queensbury founded this city as its sister city.', x: undefined });
  });

  it('a sandbox city\'s money is not counted: the line is booked, the funds stay', async () => {
    const st = parentCity();
    const plan = planFrom(st, 1_000_000);
    const child = new CityState(model.cityConfigFor(tile(E1), { name: 'Sandville', difficulty: 'sandbox', sandbox: true, startFunds: 10_000_000 }));
    await found(plan, child);
    open(child, E1);
    expect(child.funds).toBe(10_000_000);
    expect(child.budget.curIncome).toEqual({ [ENDOWMENT_KEY]: 1_000_000 });
    expect(sisterBooks(child)!.booked).toEqual([plan.id]);
  });
});

// ------------------------------------------------------------------------------------------------ a killed tab
describe('LG-12: a tab killed during the founding leaves one whole transfer or none', () => {
  /** the parent as stored before "Found a sister city" */
  async function stored(): Promise<CityState> {
    const st = parentCity();
    await saveCity(data.id, P, st);
    await saveRegion(data);
    return st;
  }
  /** open a stored city in a new tab, through the real host; `save`: it is saved before the tab goes */
  async function session(m: RegionModel, key: string, save: boolean): Promise<number> {
    const st = (await loadCity(m.data.id, key))!;
    const host = new LocalSimHost(st, { rctx: regionContext(m, tile(key, m)), persistence: { regionId: m.data.id, tileKey: key, regionName: m.data.name } });
    hosts.push(host);
    await host.start({ createSystems: economySystems });
    const funds = host.state.funds;
    if (save) {
      const ack = await host.save('exit');
      // main.ts doSaveCity: the tile summary follows the save
      const t = tile(key, m);
      t.city = { ...ack.summary, founded: t.city?.founded ?? ack.summary.founded, thumbnail: t.city?.thumbnail };
      await saveRegion(m.data);
    }
    await host.dispose();
    return funds;
  }

  for (const stop of ['city', 'region', 'regionWrite'] as const) {
    it(`killed before the ${stop === 'city' ? 'new city is stored' : stop === 'region' ? 'region is written' : 'region write lands'}: no city, no transfer`, async () => {
      const st = await stored();
      await found(planFrom(st, 2_000_000), undefined, stop);
      const { m, d } = await reopen();
      expect(d.endowments).toBeUndefined();
      expect(tile(E1, m).city).toBeUndefined();
      expect(tile(P, m).city!.funds).toBe(8_000_000);
      expect('endowments' in regionContext(m, tile(P, m))).toBe(false);
      expect(await session(m, P, true)).toBe(8_000_000);
      expect(await session(m, P, false)).toBe(8_000_000);
      // what the dead tab left of the new city is on no tile, and holds no endowment
      expect(await hasCity(d.id, E1)).toBe(stop !== 'city');
      if (stop !== 'city') expect((await loadCity(d.id, E1))!.funds).toBe(100_000);
      // founding a plain city there later is an ordinary founding
      const plain = childCity(E1, m, 'Plainville');
      tile(E1, m).city = summarizeCity(plain);
      await saveCity(d.id, E1, plain);
      await saveRegion(d);
      expect(await session(m, E1, true)).toBe(100_000);
      expect(await session(m, P, false)).toBe(8_000_000);
    });
  }

  it('killed right after the region write: both cities book it, once, however often they are opened', async () => {
    const st = await stored();
    const plan = planFrom(st, 2_000_000);
    await found(plan);
    const { m } = await reopen();
    expect(tile(P, m).city!.funds).toBe(6_000_000);
    expect(tile(E1, m).city).toMatchObject({ funds: 2_100_000, sisterOf: P });
    // the parent first this time; each is opened, saved, and opened twice more
    expect(await session(m, P, true)).toBe(6_000_000);
    expect(await session(m, E1, true)).toBe(2_100_000);
    for (let k = 0; k < 2; k++) {
      expect(await session(m, P, true)).toBe(6_000_000);
      expect(await session(m, E1, true)).toBe(2_100_000);
    }
    expect((await reopen()).d.tiles.filter((t) => t.city).map((t) => [t.key, t.city!.funds, t.city!.sisterOf])).toEqual([[P, 6_000_000, undefined], [E1, 2_100_000, P]]);
    expect((await loadCity(m.data.id, P))!.systemData.sisterBooks).toEqual({ v: 1, booked: [plan.id], founded: DAY });
    expect((await loadCity(m.data.id, E1))!.systemData.sisterBooks).toEqual({ v: 1, booked: [plan.id] });
  });

  it('a packet host books before its Ready: the replica opens with the money moved, and its save holds the booking', async () => {
    const st = await stored();
    const plan = planFrom(st, 2_000_000);
    await found(plan);
    const { m } = await reopen();
    for (const [key, funds, line] of [[P, 6_000_000, 'curExpense'], [E1, 2_100_000, 'curIncome']] as const) {
      // the worker's protocol, run on the page (?simworker=loopback): `state` is the replica
      const host = new LoopbackSimHost((await loadCity(m.data.id, key))!, {
        rctx: regionContext(m, tile(key, m)), persistence: { regionId: m.data.id, tileKey: key, regionName: m.data.name },
        initialSpeed: 0, loopback: { modules: { createSystems: economySystems } },
      });
      try {
        await host.start();
        await host.drain();
        expect(host.state.funds, key).toBe(funds);
        expect(host.state.budget[line]).toEqual({ [ENDOWMENT_KEY]: 2_000_000 });
        // (the books stay with the authoritative state: nothing on the page reads them)
        expect(host.harness.primary.systemData.sisterBooks).toMatchObject({ booked: [plan.id] });
        // what the App reads from it for a founding of its own
        expect(sisterParent(host.state, key)).toMatchObject({ funds, day: host.state.day, name: host.state.config.name });
        const ack = await host.save('exit');
        expect(ack.summary).toMatchObject({ funds, ...(key === E1 ? { sisterOf: P } : {}) });
      } finally {
        await host.dispose();
      }
      expect((await loadCity(m.data.id, key))!.funds).toBe(funds);
    }
    // and the next opening, on either kind of host, books nothing more
    expect(await session(m, P, false)).toBe(6_000_000);
    expect(await session(m, E1, false)).toBe(2_100_000);
  });

  it('killed again and again before either city is saved: every reopening books it afresh from the old save, never twice', async () => {
    const st = await stored();
    await found(planFrom(st, 2_000_000));
    for (let k = 0; k < 3; k++) {
      const { m } = await reopen();
      expect(await session(m, P, false)).toBe(6_000_000);
      expect(await session(m, E1, false)).toBe(2_100_000);
      expect((await loadCity(m.data.id, P))!.funds).toBe(8_000_000); // the store still holds the save from before
    }
    const { m } = await reopen();
    expect(await session(m, P, true)).toBe(6_000_000);
    expect(await session(m, P, false)).toBe(6_000_000);
    expect((await loadCity(m.data.id, P))!.funds).toBe(6_000_000);
    // all the money there is: the parent's eight million and the new city's own start funds
    expect(await session(m, E1, true)).toBe(2_100_000);
    expect((await loadCity(m.data.id, P))!.funds + (await loadCity(m.data.id, E1))!.funds).toBe(8_000_000 + 100_000);
  });
});

// ------------------------------------------------------------------------------------------------ recognition
describe('LG-12: "Founded a sister city" approval', () => {
  it('adds one point in each of the 12 monthly updates after the founding, and nothing before or after', () => {
    const a = makeCity(), b = makeCity();
    a.sim.runDays(45);
    b.sim.runDays(45);
    expect(econData(a.st).approvalRaw).toBe(econData(b.st).approvalRaw);
    // booked today (mid-month), from a founding made the day the city was left
    a.st.systemData.sisterBooks = { v: 1, booked: ['x'], founded: a.st.day };
    expect([SISTER_APPROVAL, SISTER_APPROVAL_DAYS]).toEqual([1, 360]);
    for (let month = 1; month <= 14; month++) {
      a.sim.runDays(30);
      b.sim.runDays(30);
      const on = month <= 12;
      expect(econData(a.st).approvalTerms.sisterCity, `month ${month}`).toBe(on ? 1 : undefined);
      expect(econData(a.st).approvalRaw, `month ${month}`).toBe(econData(b.st).approvalRaw + (on ? 1 : 0));
      expect('sisterCity' in econData(b.st).approvalTerms).toBe(false);
    }
    // the shown approval followed it up, and is on its way back
    expect(a.st.stats.approval).toBeGreaterThan(b.st.stats.approval);
  });

  it('a founding booked on a month tick still counts 12 updates; the breakdown names it', () => {
    const { st, sim } = makeCity();
    sim.runDays(60);
    st.systemData.sisterBooks = { v: 1, booked: ['x'], founded: st.day };
    let months = 0;
    for (let k = 0; k < 15; k++) {
      sim.runDays(30);
      if (!econData(st).approvalTerms.sisterCity) continue;
      months++;
      expect(approvalBreakdown(st).find((t) => t.id === 'sisterCity')).toMatchObject({ label: 'Founded a sister city', value: 1 });
    }
    expect(months).toBe(12);
    expect(approvalBreakdown(st).some((t) => t.id === 'sisterCity')).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ PB-REGION
describe('LG-12: the sister city\'s jobs reach the parent as any neighbour\'s do (PB-REGION)', () => {
  it('through the parent\'s connection on the shared edge; an unconnected edge gives a tenth', () => {
    const city = () => {
      const st = parentCity();
      st.stats.population = 10_000;
      st.stats.workforce = 5_500;
      return st;
    };
    const base = Math.round(REGION_JOB_SHARE * 5_500 + REGION_JOB_MIN);
    // the day it is founded the sister city has no jobs: nothing changes for the parent
    tile(E1).city = { ...summarizeCity(childCity(E1)), sisterOf: P };
    const day0 = city();
    applyRegionEffects(day0, regionContext(model, tile(P)));
    expect(day0.systemData.regionJobs).toBeUndefined();
    // years later it is a job centre: 50,000 jobs for 20,000 residents
    tile(E1).city = { ...tile(E1).city!, population: 20_000, r: 20_000, c: 30_000, i: 20_000 };
    const surplus = 50_000 - Math.round(20_000 * WORKFORCE_RATIO);
    const apart = city();
    applyRegionEffects(apart, regionContext(model, tile(P)));
    expect((apart.systemData.regionJobs as number) - base).toBeCloseTo(ADJ_SHARE * surplus * EDGE_NONE, -1);
    // the road the stub continues is the parent's connection on that edge
    const joined = city();
    joined.neighborConnections = [{ edge: 'e', x: 127, z: 40, type: Network.Road }];
    applyRegionEffects(joined, regionContext(model, tile(P)));
    expect((joined.systemData.regionJobs as number) - base).toBeCloseTo(ADJ_SHARE * surplus * EDGE_CONN[Network.Road], -1);
    // a connection on the other half of the east edge (E2's) does not reach it
    const beside = city();
    beside.neighborConnections = [{ edge: 'e', x: 127, z: 100, type: Network.Highway }];
    applyRegionEffects(beside, regionContext(model, tile(P)));
    expect(beside.systemData.regionJobs).toBe(apart.systemData.regionJobs);
  });
});
