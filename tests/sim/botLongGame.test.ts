/** LG-10 round 1 (base 8182828): opt-in rules exercise existing content; the default mayor stays on its old path. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimBot, USAGE, botSystems, parseArgs, type BotOptions } from '../../tools/simbot';
import { DevType, Network, Zone } from '../../src/core/types';
import { BF, type Building } from '../../src/sim/CityState';
import { CATALOG, getDef } from '../../src/sim/catalog';
import { lotTouchesRoad, placeBuilding } from '../../src/sim/economy/buildings';
import { getOrdinance, ordinanceMonthly } from '../../src/sim/economy/ordinances';
import { getTraffic } from '../../src/sim/systems/infra';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { lPath } from '../../src/sim/actions';

afterEach(() => vi.restoreAllMocks());

async function bot(opts: Partial<BotOptions> = {}) {
  const b = new SimBot({ size: 96, years: 1, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0, quiet: true, noInfra: false, ...opts }, await botSystems(false));
  b.setup();
  return b;
}

function solvent(b: SimBot, pop = 150000) {
  b.st.stats.population = pop;
  b.st.funds = 1e6;
  b.st.budget.lastIncome = { 'tax:R$': 20000 };
  b.st.budget.lastExpense = { 'service:police': 10000 };
  b.pendingUpkeep = 0;
}

const HOME = CATALOG.find((d) => d.devType === DevType.R1 && d.footprint[0] === 1 && d.footprint[1] === 1)!;
function home(b: SimBot, x: number, z: number, pop: number, w = 1, d = 1) {
  const o: Building = { id: b.st.nextBuildingId++, def: HOME.id, x, z, w, d, rot: 0, variant: 0, pop, jobs: 0, capacity: pop,
    wealth: 1, built: 1, age: 400, flags: BF.Powered | BF.Watered, baseY: 1, health: 1, unhappy: 0 };
  placeBuilding(b.sim, o);
  return o;
}

async function subwayTown(opts: Partial<BotOptions> = {}) {
  const b = await bot({ subway: true, ...opts });
  solvent(b);
  for (const blk of b.blocks) if (blk.ring <= 3.5) {
    b.buildBlockRoads(blk);
    blk.developed = true;
    if (blk.use === 'R') blk.zone = Zone.ResHigh;
  }
  const blocks = b.blocks.filter((o) => o.developed && o.use === 'R' && o.ring >= 2.5).slice(0, 4);
  blocks.forEach((o, i) => home(b, o.x0 + 2, o.z0 + 2, 800 - i * 100, i === 3 ? 4 : 1, i === 3 ? 4 : 1));
  return { b, blocks };
}

function rejects(args: string[], message: RegExp) {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  expect(() => parseArgs(args)).toThrow('exit');
  expect(err).toHaveBeenCalledWith(expect.stringMatching(message));
}

describe('bot: LG-10 options and fixed taxes', () => {
  it('defaults to no new strategies and parses --tax=N without consuming the following flag', () => {
    expect(parseArgs([])).toEqual({ size: 256, years: 60, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0.2, quiet: false, noInfra: false });
    expect(parseArgs(['--tax=12.5', '--subway', '--late-ordinances', '--venues', '--skip', 'transit,dirty', '--neglect'])).toMatchObject({
      tax: 12.5, subway: true, lateOrdinances: true, venues: true, skip: ['transit', 'dirty'], neglect: true,
    });
    expect(parseArgs(['--tax', '0', '--quiet'])).toMatchObject({ tax: 0, quiet: true });
    expect(parseArgs(['--tax=20']).tax).toBe(20);
  });

  it.each(['--tax=', '--tax=NaN', '--tax=Infinity', '--tax=-1', '--tax=21', '--tax'])('rejects invalid fixed taxes: %s', (arg) => {
    rejects([arg], /finite rate from 0 to 20/);
  });

  it('sets all tax types before the first day and keeps them fixed through deficits and surpluses', async () => {
    const b = await bot({ tax: 12 });
    expect(b.st.budget.taxRates).toEqual(Array(12).fill(12));
    for (const income of [0, 1e6]) {
      b.st.budget.lastIncome = { 'tax:R$': income };
      b.st.budget.lastExpense = { 'service:police': 1000 };
      b.finance();
      expect(b.st.budget.taxRates).toEqual(Array(12).fill(12));
    }
  });

  it.each(['--subway', '--late-ordinances', '--venues', '--tax=12'])('keeps newcomer separate from %s', (flag) => {
    rejects(['--profile', 'newcomer', flag], /newcomer has its own/);
  });

  it('keeps newcomer founding, taxes and no-loan behavior and extends the shared help', async () => {
    expect(parseArgs(['--profile', 'newcomer', '--neglect'])).toMatchObject({ size: 128, years: 10, profile: 'newcomer', neglect: true });
    const b = await bot({ profile: 'newcomer' });
    expect(b.st.day).toBe(90);
    expect(b.st.budget.taxRates).toEqual(Array(12).fill(9));
    b.st.budget.lastExpense = { 'service:police': 1000 };
    b.finance();
    expect(b.st.budget.taxRates).toEqual(Array(12).fill(11));
    expect(b.st.budget.loans).toHaveLength(0);
    for (const flag of ['--subway', '--late-ordinances', '--venues', '--tax=N', '--profile', '--skip', '--neglect']) expect(USAGE).toContain(flag);
    expect(USAGE).toContain('--expand lands with LG-19');
  });

  it.each([['--expand', 'LG-19'], ['--megaprojects', 'LG-03'], ['--arcology', 'LG-04'], ['--charter=green', 'LG-17']])('reports unavailable content for %s', (flag, item) => {
    rejects([flag], new RegExp(`lands with ${item}`));
  });
});

describe('bot: LG-10 subway', () => {
  it('ranks residents once per home, not once per footprint cell', async () => {
    const { b, blocks } = await subwayTown();
    expect(b.subwayDistricts()).toEqual(blocks.slice(0, 3));
  });

  it('waits for 150k, the capital reserve and upkeep, then connects the core and all three districts', async () => {
    const { b, blocks } = await subwayTown();
    const st = b.st;
    st.stats.population = 149999;
    b.ensureSubway();
    expect(st.subway.some(Boolean)).toBe(false);
    st.stats.population = 150000;
    st.funds = b.reserve();
    b.ensureSubway();
    expect(st.subway.some(Boolean)).toBe(false);
    st.funds = 50000;
    st.budget.lastIncome = { 'tax:R$': 9999 };
    b.ensureSubway();
    expect(st.subway.some(Boolean)).toBe(false);
    solvent(b);
    b.ensureSubway();
    const stops = [...st.buildings.values()].filter((o) => o.def === 'tr_subway_station');
    expect(stops.length).toBeGreaterThanOrEqual(4);
    for (const o of stops) {
      expect(b.walkableLot(o.x, o.z, o.w, o.d)).toBe(true);
      expect(st.subway[o.z * b.N + o.x]).toBe(1);
      expect(getTraffic(b.sim)!.stopAttached(o.id)).toBe(true);
    }
    const targets = [{ x: b.line(b.cbx) + 1, z: b.trunkZ + 1 }, ...blocks.slice(0, 3).map((o) => ({ x: o.x0, z: o.z0 }))];
    for (const c of targets) expect(stops.some((o) => Math.abs(o.x - c.x) + Math.abs(o.z - c.z) <= 4)).toBe(true);
    // Every eighth tunnel tile on the main line has its own entrance within the documented four-tile site search.
    const plan = (b as unknown as { subwayLine: { paths: { x: number; z: number }[][]; stops: { x: number; z: number; at?: { x: number; z: number } }[] } }).subwayLine;
    let distance = 0;
    for (const path of plan.paths) for (const c of path.slice(1)) if (++distance % 8 === 0) {
      expect(plan.stops.some((s) => s.x === c.x && s.z === c.z && s.at)).toBe(true);
    }
    expect(new Set(plan.stops.map((s) => s.at!.x + ',' + s.at!.z)).size).toBe(plan.stops.length);
    expect(st.funds).toBeGreaterThan(b.reserve());
    expect(b.pendingUpkeep).toBeLessThan(0);
    const funds = st.funds, count = stops.length;
    st.day += 90;
    b.ensureSubway();
    expect(st.funds).toBe(funds);
    expect(b.count('tr_subway_station')).toBe(count);
  });

  it('retries missing entrances on the same route and honors --skip transit', async () => {
    const { b } = await subwayTown();
    const plop = vi.spyOn(b.A, 'plop').mockReturnValue({ ok: false, cost: 1500, reason: 'No site' });
    b.ensureSubway();
    const tunnels = b.st.subway.slice();
    expect(b.count('tr_subway_station')).toBe(0);
    plop.mockRestore();
    b.st.day += 90;
    b.ensureSubway();
    expect(b.count('tr_subway_station')).toBeGreaterThan(1);
    for (let i = 0; i < tunnels.length; i++) if (tunnels[i]) expect(b.st.subway[i]).toBe(1);
    const skipped = await subwayTown({ skip: ['transit', 'dirty'] });
    skipped.b.ensureSubway();
    expect(skipped.b.st.subway.some(Boolean)).toBe(false);
    const industry = skipped.b.blocks.find((o) => o.use === 'I')!;
    expect(skipped.b.zoneFor(industry)).toBe(Zone.IndHigh);
  });
});

describe('bot: LG-10 late ordinances', () => {
  it('enacts useful environmental and tourism policies with their recurring costs; no duplicates', async () => {
    const b = await bot({ lateOrdinances: true });
    solvent(b, 30000);
    Object.assign(b.st.stats, { waterDemand: 800, waterSupply: 1000, powerDemand: 800, powerSupply: 1000,
      avgNoise: 0.3, avgAir: 0.3, avgWaterPollution: 0.2, garbageProduced: 100, garbageCapacity: 100, tourists: 100 });
    b.st.stats.jobsByDev[DevType.IM] = 1000;
    b.st.soil[0] = 0.4;
    const upkeep = b.pendingUpkeep;
    b.lateOrdinances();
    const wanted = ['water_conservation', 'power_conservation', 'sewage_mandate', 'quiet_zones', 'pollution_controls', 'clean_air_act', 'tire_recycling', 'brownfield_cleanup', 'tourism_promotion'];
    expect(b.st.budget.ordinances).toEqual(wanted);
    const bill = wanted.reduce((n, id) => n + ordinanceMonthly(getOrdinance(id)!, 30000), 0);
    expect(b.pendingUpkeep).toBe(upkeep - bill);
    b.lateOrdinances();
    expect(b.st.budget.ordinances).toEqual(wanted);
  });

  it('waits for unlocks, a useful effect, the reserve and the uncommitted monthly surplus', async () => {
    const b = await bot({ lateOrdinances: true });
    solvent(b, 4000);
    Object.assign(b.st.stats, { waterDemand: 800, waterSupply: 1000, sewageTreated: 1 });
    b.lateOrdinances();
    expect(b.st.budget.ordinances).toEqual([]);
    b.st.stats.population = 10000;
    b.st.stats.waterDemand = 100;
    b.lateOrdinances();
    expect(b.st.budget.ordinances).toEqual([]);
    b.st.stats.waterDemand = 800;
    b.st.funds = b.reserve();
    b.lateOrdinances();
    expect(b.st.budget.ordinances).toEqual([]);
    b.st.funds = 1e6;
    b.pendingUpkeep = -9990;
    b.lateOrdinances();
    expect(b.st.budget.ordinances).toEqual([]);
    b.pendingUpkeep = 0;
    b.A.setOrdinance('free_clinics', true); // enacted this month, not yet in lastExpense
    b.st.budget.lastIncome = { 'tax:R$': 10200 };
    b.lateOrdinances();
    expect(b.st.budget.ordinances).toEqual(['free_clinics']);
    b.st.budget.lastIncome = { 'tax:R$': 10300 };
    b.lateOrdinances();
    expect(b.st.budget.ordinances).toContain('water_conservation');
  });

  it('includes power scrubber upkeep and releases the nuclear ban before nuclear power is needed', async () => {
    const b = await bot({ lateOrdinances: true });
    solvent(b, 30000);
    expect(b.placeUtility('util_coal_plant', b.line(b.cbx) + 27, b.trunkZ)).toBe(true);
    b.pendingUpkeep = 0;
    b.lateOrdinances();
    expect(b.st.budget.ordinances).toContain('clean_power_act');
    expect(-b.pendingUpkeep).toBeCloseTo(ordinanceMonthly(getOrdinance('clean_power_act')!, 30000) + getDef('util_coal_plant')!.upkeep! * 0.15);
    Object.assign(b.st.stats, { powerDemand: 100, powerSupply: 1000 });
    b.lateOrdinances();
    expect(b.st.budget.ordinances).toContain('nuclear_free_zone');
    b.st.unlocked.add('nuclear_power');
    Object.assign(b.st.stats, { powerDemand: 1000, powerSupply: 2000 });
    b.ensurePower();
    expect(b.st.budget.ordinances).not.toContain('nuclear_free_zone');
  });

  it('uses curfews for youth crime and revenue ordinances for a deficit, respecting skip choices', async () => {
    const b = await bot({ lateOrdinances: true });
    solvent(b, 30000);
    Object.assign(b.st.stats, { avgCrime: 0.5, approval: 65 });
    b.st.stats.cohorts[1] = 3000;
    b.opts.skip = ['police'];
    b.lateOrdinances();
    expect(b.st.budget.ordinances).not.toContain('youth_curfew');
    b.opts.skip = [];
    b.lateOrdinances();
    expect(b.st.budget.ordinances).toContain('youth_curfew');
    b.st.budget.ordinances = [];
    b.pendingUpkeep = 0;
    b.st.budget.lastIncome = { 'tax:R$': 9000 };
    Object.assign(b.st.stats, { avgCrime: 0.1, tripsCar: 1000 });
    b.opts.skip = ['transit', 'garbage'];
    b.lateOrdinances();
    expect(b.st.budget.ordinances).toEqual(['legalized_gambling']);
    b.opts.skip = [];
    b.pendingUpkeep = 0;
    b.st.budget.lastIncome['ordinance:legalized_gambling'] = 900;
    b.lateOrdinances();
    expect(b.st.budget.ordinances).toContain('parking_fines');
  });
});

describe('bot: LG-10 missing venues', () => {
  it('builds one unlocked zoo and one road-accessible passenger station whose rail reaches the edge', async () => {
    const b = await bot({ venues: true });
    solvent(b, 30000);
    b.st.unlocked.add('zoo');
    b.ensureLateVenues();
    expect(b.count('park_zoo')).toBe(1);
    expect(b.count('tr_train_station')).toBe(1);
    const station = [...b.st.buildings.values()].find((o) => o.def === 'tr_train_station')!;
    expect(lotTouchesRoad(b.st, station.x, station.z, station.w, station.d)).toBe(true);
    expect(getTraffic(b.sim)!.stopAttached(station.id)).toBe(true);
    expect(b.st.neighborConnections.some((c) => c.type === Network.Rail)).toBe(true);
    expect(b.pendingUpkeep).toBeLessThan(-getDef('park_zoo')!.upkeep!);
    const funds = b.st.funds;
    b.st.day += 180;
    b.ensureLateVenues();
    expect(b.st.funds).toBe(funds);
  });

  it('keeps the reserve and held funds, waits for the zoo unlock and honors service / transit skips', async () => {
    const b = await bot({ venues: true, skip: ['transit'] });
    solvent(b, 30000);
    b.ensureLateVenues();
    expect(b.count('park_zoo')).toBe(0);
    b.st.unlocked.add('zoo');
    b.venueFund = 20000;
    b.jailHold = 12000;
    b.st.funds = b.reserve() + b.venueFund + b.jailHold + 20000;
    b.ensureLateVenues();
    expect(b.count('park_zoo')).toBe(0);
    b.st.funds = 1e6;
    b.opts.skip = ['services', 'transit'];
    b.ensureLateVenues();
    expect(b.count('park_zoo')).toBe(0);
    expect(b.count('tr_train_station')).toBe(0);
    b.opts.skip = ['transit'];
    b.ensureLateVenues();
    expect(b.count('park_zoo')).toBe(1);
    expect(b.count('tr_train_station')).toBe(0);
    expect(b.venueFund).toBe(20000);
    expect(b.jailHold).toBe(12000);
  });
});

describe('bot: LG-10 isolation', () => {
  it('flags off do not call the new rules; direct calls do not scan buildings or draw RNG', async () => {
    const b = await bot();
    const scans = vi.spyOn(b.st.buildings, 'values');
    const rng = vi.spyOn(b.sim.rng, 'next');
    b.ensureSubway(); b.ensureLateVenues(); b.lateOrdinances();
    expect(b.subwayDistricts()).toEqual([]);
    expect(scans).not.toHaveBeenCalled();
    expect(rng).not.toHaveBeenCalled();
    scans.mockRestore(); rng.mockRestore();
    const subway = vi.spyOn(b, 'ensureSubway');
    const venues = vi.spyOn(b, 'ensureLateVenues');
    const policies = vi.spyOn(b, 'lateOrdinances');
    b.monthly();
    expect(subway).not.toHaveBeenCalled();
    expect(venues).not.toHaveBeenCalled();
    expect(policies).not.toHaveBeenCalled();
  });

  it('new flags leave --neglect in charge of manual emergency dispatch', async () => {
    const b = await bot({ subway: true, lateOrdinances: true, venues: true, neglect: true });
    solvent(b);
    b.A.buildNetwork(lPath({ x: 2, z: 10 }, { x: 90, z: 10 }), Network.Road);
    expect(b.A.plop('civ_library', 85, 11, 0).ok).toBe(true);
    const em = emergencyOf(b.sim)!;
    b.sim.runDays(2);
    const o = b.st.buildingAt(85, 11)!;
    const id = em.spawn(b.sim, 'medical', o.x, o.z, { buildingId: o.id, major: true, severity: 10 });
    expect(id).toBeGreaterThanOrEqual(0);
    const dispatch = vi.spyOn(em, 'dispatchBest');
    b.daily();
    expect(dispatch).not.toHaveBeenCalled();
    expect(b.dispatches).toBe(0);
  });
});
