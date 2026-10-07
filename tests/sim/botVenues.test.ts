/**
 * WP6b balance round 3 bot rules (tools/simbot.ts; acceptance round 2, LEAD DECISION 13): tourism venues — landmarks,
 * the big sport / entertainment / business venues and the airports (not the zoo: the parks rule builds it for the
 * residential cap) — are saved for (a share of each month's surplus goes into a venue fund that optional spending leaves
 * alone) and bought cheapest first once the fund holds the price and a reserve stays in the bank; a venue goes on any
 * free lot of a park block (a grown city's park blocks rarely have their edges free), an airport onto the airport blocks
 * once they border the town; a landmark only on a lot that touches a road; the trunk becomes a highway once the industry
 * lacks freight access and the bank and budget can carry it; fire response counts workers as well as residents.
 */
import { describe, expect, it } from 'vitest';
import {
  FIRE_GAP, FIRE_URGENT, HIGHWAY_FREIGHT_GAP, HIGHWAY_RESERVE_MONTHS, SimBot, VENUE_POP, VENUE_RESERVE_MONTHS, VENUE_SAVE_SHARE,
  botSystems,
} from '../../tools/simbot';
import { BF } from '../../src/sim/CityState';
import { CATALOG, getDef } from '../../src/sim/catalog';
import { lotTouchesRoad, placeBuilding } from '../../src/sim/economy/buildings';
import { lPath } from '../../src/sim/actions';
import { Network } from '../../src/core/types';
import { NETWORK_UPKEEP } from '../../src/sim/economy/tuning';

async function bot(size: number) {
  const b = new SimBot({ size, years: 1, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0, quiet: true, noInfra: false }, await botSystems(false));
  b.setup();
  return b;
}

/** a mid-size town for the venue rules: population above VENUE_POP, last month §20,000 income and §10,000 expenses */
function town(b: SimBot, unlock: string[]) {
  const st = b.st;
  st.stats.population = VENUE_POP + 5000;
  st.budget.lastIncome = { 'tax:R$': 20000 };
  st.budget.lastExpense = { 'service:police': 10000 };
  for (const id of unlock) st.unlocked.add(id);
  return { expense: 10000, net: 10000 };
}

/** a 1 x 1 growable to fill lots with */
const FILLER = CATALOG.find((d) => d.category === 'growable' && d.footprint[0] === 1 && d.footprint[1] === 1)!;
function fill(b: SimBot, x: number, z: number) {
  const st = b.st;
  placeBuilding(b.sim, {
    id: st.nextBuildingId++, def: FILLER.id, x, z, w: 1, d: 1, rot: 0, variant: 0, pop: 2, jobs: 0, capacity: FILLER.capacity ?? 2,
    wealth: 1, built: 1, age: 400, flags: BF.Powered | BF.Watered, baseY: 1, health: 1, unhappy: 0,
  });
}

describe('bot: tourism venues (WP6b round 3)', () => {
  it('saves a share of the surplus for the cheapest unbuilt venue; optional spending leaves the fund alone', { timeout: 600000 }, async () => {
    const b = await bot(96);
    const { net } = town(b, ['lm_arch', 'zoo', 'lm_observatory', 'lm_cathedral']);
    const list = b.venueCandidates();
    // (the zoo is a park the residential cap asks for — caps() — not a venue)
    expect(list.map((c) => c.id)).toEqual(['lm_arch', 'lm_observatory', 'lm_cathedral']);
    b.saveForVenue();
    expect(b.venueFund).toBeCloseTo(VENUE_SAVE_SHARE * net, 6);
    // capped at the next venue's price
    for (let k = 0; k < 10; k++) b.saveForVenue();
    expect(b.venueFund).toBe(getDef('lm_arch')!.cost);
    // a needed school / station may use the money (canSpend), optional spending may not (canSpendOpt)
    b.st.funds = b.reserve() + b.venueFund + 1000;
    expect(b.canSpend(3000)).toBe(true);
    expect(b.canSpendOpt(3000)).toBe(false);
    expect(b.canSpendOpt(500)).toBe(true);
    // below VENUE_POP the fund is released (the old reward rule buys a small town's first landmarks)
    b.st.stats.population = VENUE_POP - 1;
    b.saveForVenue();
    expect(b.venueFund).toBe(0);
  });

  it('buys the venue once the fund holds its price and VENUE_RESERVE_MONTHS of expenses stay in the bank; one a month', { timeout: 600000 }, async () => {
    const b = await bot(96);
    const { expense } = town(b, ['lm_arch', 'lm_clock_tower', 'lm_obelisk']);
    const st = b.st;
    b.st.milestones['lm_clock_tower'] = 1; // (built already)
    const arch = getDef('lm_arch')!, obelisk = getDef('lm_obelisk')!;
    expect(b.venueCandidates()[0].id).toBe('lm_obelisk');
    b.venueFund = obelisk.cost!;
    // one § short of the reserve: nothing
    st.funds = 4000 + VENUE_RESERVE_MONTHS * expense + obelisk.cost!;
    b.venues();
    expect(b.count('lm_obelisk')).toBe(0);
    // enough: the obelisk, from the fund, on a lot that touches a road; the arch waits for next month
    st.funds = 4000 + VENUE_RESERVE_MONTHS * expense + obelisk.cost! + arch.cost! + 50;
    b.venues();
    expect(b.count('lm_obelisk')).toBe(1);
    expect(b.count('lm_arch')).toBe(0);
    expect(b.venueFund).toBe(0);
    const o = [...st.buildings.values()].find((x) => x.def === 'lm_obelisk')!;
    expect(lotTouchesRoad(st, o.x, o.z, o.w, o.d)).toBe(true);
    expect(b.log.some((l) => l.includes('venue: Obelisk'))).toBe(true);
  });

  it('places a venue on any free lot of a park block whose edges and centre are taken', { timeout: 600000 }, async () => {
    const b = await bot(96);
    town(b, ['lm_pyramid']);
    const st = b.st, N = st.size;
    st.funds = 1e6;
    // one park block next to town, built up except a 3 x 3 lot along its north road one cell in from the corner — not
    // one of the nine lots placeNear tries (corners, edge middles, centre); every other park block taken out
    const cx = b.line(b.cbx), cz = b.line(b.cbz);
    const parks = b.blocks.filter((o) => o.use === 'P').sort((p, q) => Math.hypot(p.x0 - cx, p.z0 - cz) - Math.hypot(q.x0 - cx, q.z0 - cz));
    const blk = parks[0];
    for (const o of parks.slice(1)) o.use = 'R';
    b.buildBlockRoads(blk);
    blk.developed = true;
    const lx = blk.x0 + 1, lz = blk.z0;
    for (let z = blk.z0; z < blk.z1; z++) for (let x = blk.x0; x < blk.x1; x++) {
      if (x >= lx && x < lx + 3 && z >= lz && z < lz + 3) continue;
      if (st.building[z * N + x] < 0 && !st.network[z * N + x] && !st.water[z * N + x]) fill(b, x, z);
    }
    expect(b.placeNear('lm_pyramid', cx, cz, ['P'], false)).toBeNull();
    expect(b.placeVenue('lm_pyramid')).toBe(true);
    const p = [...st.buildings.values()].find((o) => o.def === 'lm_pyramid')!;
    expect([p.x, p.z]).toEqual([lx, lz]);
    expect(lotTouchesRoad(st, p.x, p.z, p.w, p.d)).toBe(true);
  });

  it('the municipal airport waits until its blocks border the town; the zoo is no venue', { timeout: 600000 }, async () => {
    const b = await bot(128);
    town(b, ['airport_small', 'zoo']);
    const st = b.st;
    st.funds = 1e6;
    const air = b.blocks.filter((o) => o.use === 'A').sort((p, q) => p.bx - q.bx);
    expect(air.length).toBe(3);
    expect(b.placeVenue('tr_airport_small')).toBe(false);
    expect(b.count('tr_airport_small')).toBe(0);
    const next = b.blocks.find((o) => o.use !== 'A' && Math.abs(o.bx - air[0].bx) + Math.abs(o.bz - air[0].bz) === 1)!;
    b.buildBlockRoads(next);
    next.developed = true;
    expect(b.placeVenue('tr_airport_small')).toBe(true);
    expect(b.count('tr_airport_small')).toBe(1);
    // the zoo, unlocked, is left to the parks rule (caps(): the residential cap)
    expect(st.unlocked.has('zoo')).toBe(true);
    expect(b.venueCandidates().some((c) => c.id === 'park_zoo')).toBe(false);
  });

  it('places a landmark only on a lot that touches a road', { timeout: 600000 }, async () => {
    const b = await bot(96);
    const st = b.st, N = st.size;
    // a town below VENUE_POP: rewards() places its landmarks
    st.stats.population = VENUE_POP - 5000;
    st.unlocked.add('lm_obelisk');
    st.funds = 1e6;
    // the nearest park block built up except the 1 x 1 lot in its middle (no road touches it); every other park block
    // taken out
    const cx = b.line(b.cbx), cz = b.line(b.cbz);
    const parks = b.blocks.filter((o) => o.use === 'P').sort((p, q) => Math.hypot(p.x0 - cx, p.z0 - cz) - Math.hypot(q.x0 - cx, q.z0 - cz));
    const blk = parks[0];
    for (const o of parks.slice(1)) o.use = 'R';
    b.buildBlockRoads(blk);
    blk.developed = true;
    const mx = blk.x0 + ((blk.x1 - blk.x0 - 1) >> 1), mz = blk.z0 + ((blk.z1 - blk.z0 - 1) >> 1);
    for (let z = blk.z0; z < blk.z1; z++) for (let x = blk.x0; x < blk.x1; x++) {
      if (x === mx && z === mz) continue;
      if (st.building[z * N + x] < 0 && !st.network[z * N + x] && !st.water[z * N + x]) fill(b, x, z);
    }
    expect(lotTouchesRoad(st, mx, mz, 1, 1)).toBe(false);
    b.rewards();
    // (it waits rather than standing where nobody can visit it)
    expect(b.count('lm_obelisk')).toBe(0);
    // a lot on the block's edge comes free: the obelisk goes there
    const ex = blk.x0, ez = blk.z0;
    const o = st.buildingAt(ex, ez)!;
    expect(b.A.bulldoze({ x0: o.x, z0: o.z, x1: o.x + o.w, z1: o.z + o.d }).ok).toBe(true);
    b.rewards();
    expect(b.count('lm_obelisk')).toBe(1);
    const ob = [...st.buildings.values()].find((x) => x.def === 'lm_obelisk')!;
    expect(lotTouchesRoad(st, ob.x, ob.z, ob.w, ob.d)).toBe(true);
  });
});

describe('bot: the trunk becomes a highway when the industry lacks freight access (WP6b round 3)', () => {
  /** a 96 town past HIGHWAY_POP: a block of workshops with jobs, last month §20,000 income and §10,000 expenses */
  async function industrialTown() {
    const b = await bot(96);
    b.sim.advanceDay(); // (the economy runtime's coarse layers)
    const st = b.st, N = st.size;
    st.stats.population = 20000;
    st.budget.lastIncome = { 'tax:R$': 20000 };
    st.budget.lastExpense = { 'service:police': 10000 };
    const blk = b.blocks.find((o) => o.use === 'I' && !o.developed)!;
    b.buildBlockRoads(blk);
    blk.developed = true;
    const ws = getDef('ind_workshop.id.1')!;
    const [w, d] = ws.footprint;
    for (let z = blk.z0; z + d <= blk.z1; z += d) for (let x = blk.x0; x + w <= blk.x1; x += w) {
      let free = true;
      for (let zz = z; zz < z + d && free; zz++) for (let xx = x; xx < x + w; xx++) if (st.building[zz * N + xx] >= 0 || st.network[zz * N + xx]) { free = false; break; }
      if (!free) continue;
      placeBuilding(b.sim, {
        id: st.nextBuildingId++, def: ws.id, x, z, w, d, rot: 0, variant: 0, pop: 0, jobs: 40, capacity: 40,
        wealth: 2, built: 1, age: 400, flags: BF.Powered | BF.Watered, baseY: 1, health: 1, unhappy: 0,
      });
    }
    return b;
  }

  it('freightGap: the share of industrial jobs with no highway, rail or edge connection within reach', { timeout: 600000 }, async () => {
    const b = await industrialTown();
    const rt = b.rt!;
    const base = b.st.neighborConnections.length ? 0.25 : 0.1;
    rt.coarseFreight.fill(base);
    expect(b.freightGap()).toBe(1);
    rt.coarseFreight.fill(1);
    expect(b.freightGap()).toBe(0);
  });

  it('upgrades once HIGHWAY_RESERVE_MONTHS of expenses stay in the bank and the budget carries the upkeep', { timeout: 600000 }, async () => {
    const b = await industrialTown();
    const st = b.st, N = st.size;
    b.pendingUpkeep = 0;
    b.rt!.coarseFreight.fill(b.st.neighborConnections.length ? 0.25 : 0.1);
    expect(b.freightGap()).toBeGreaterThan(HIGHWAY_FREIGHT_GAP);
    const path = lPath({ x: 0, z: b.trunkZ }, { x: N - 1, z: b.trunkZ });
    const cost = b.A.buildNetwork(path, Network.Highway, true).cost;
    expect(cost).toBeGreaterThan(0);
    // one § short of the price + the reserve: nothing
    st.funds = 4000 + HIGHWAY_RESERVE_MONTHS * 10000 + cost;
    expect(b.upgradeTrunk()).toBe(false);
    expect(b.highway).toBe(false);
    // a budget that cannot carry the extra upkeep (last month: −§1 net) waits too, unless the bank is rich
    st.funds = 4000 + HIGHWAY_RESERVE_MONTHS * 10000 + cost + 1000;
    st.budget.lastIncome = { 'tax:R$': 9999 };
    expect(b.upgradeTrunk()).toBe(false);
    // enough: the whole trunk is a highway, its extra upkeep counted for this month
    st.budget.lastIncome = { 'tax:R$': 20000 };
    expect(b.upgradeTrunk()).toBe(true);
    expect(b.highway).toBe(true);
    for (const x of [0, N >> 1, N - 1]) expect(st.network[b.trunkZ * N + x]).toBe(Network.Highway);
    expect(b.pendingUpkeep).toBeCloseTo(-N * (NETWORK_UPKEEP[Network.Highway] - NETWORK_UPKEEP[Network.Avenue]), 6);
    expect(b.log.some((l) => l.includes('trunk upgraded to highway'))).toBe(true);
  });
});

describe('bot: fire response counts workers (WP6b round 3)', () => {
  it('fireGap names the three areas with the most people beyond reach, largest first', { timeout: 600000 }, async () => {
    const b = await bot(96);
    const st = b.st, N = st.size;
    st.respFire.fill(2);
    for (const o of st.buildings.values()) { o.pop = 0; o.jobs = 0; }
    // three 8 x 8 areas beyond reach: 3, 2 and 1 small homes (60 people each), on free cells away from the town
    const homes = (x0: number, z0: number, n: number) => {
      let k = 0;
      for (let z = z0; z < z0 + 8 && k < n; z++) for (let x = x0; x < x0 + 8 && k < n; x++) {
        const i = z * N + x;
        if (st.building[i] >= 0 || st.network[i] || st.water[i]) continue;
        fill(b, x, z);
        const o = st.buildings.get(st.building[i])!;
        o.pop = 60; o.jobs = 0;
        st.respFire[i] = -1;
        k++;
      }
      expect(k).toBe(n);
    };
    homes(8, 8, 2);
    homes(80, 8, 3);
    homes(8, 80, 1);
    const g = b.fireGap();
    expect(g.share).toBe(1);
    expect(g.at).toEqual({ x: 84, z: 12 });
    expect(g.alts).toEqual([{ x: 12, z: 12 }, { x: 12, z: 84 }]);
  });

  it('builds a station when more than FIRE_URGENT are beyond reach although the budget cannot carry it; falls back to clearing and the next gaps', { timeout: 600000 }, async () => {
    const b = await bot(96);
    const st = b.st;
    for (let d = 0; d < 3; d++) b.sim.advanceDay();
    st.stats.population = 20000;
    // a budget that cannot carry a station's running costs (net −§1,000), a bank above the reserve
    st.budget.lastIncome = { 'tax:R$': 9000 };
    st.budget.lastExpense = { 'service:police': 10000 };
    st.funds = 4000 + 1.5 * 10000 + 5000;
    b.pendingUpkeep = 0;
    expect(b.canAfford('civ_fire_station')).toBe(false);
    const calls: string[] = [];
    const okAt = 4;
    (b as unknown as { placeCivic: (d: string, x: number, z: number, r: number, c?: boolean) => unknown }).placeCivic = (d, x, z, r, c = false) => {
      calls.push(`${d}@${x},${z}${c ? '+clear' : ''}`);
      return calls.length === okAt ? { ok: true, cost: 1400, affected: 1 } : null;
    };
    const gap = (share: number) => {
      (b as unknown as { fireGap: () => unknown }).fireGap = () => ({ share, at: { x: 20, z: 20 }, alts: [{ x: 60, z: 20 }, { x: 20, z: 60 }] });
    };
    // between FIRE_GAP and FIRE_URGENT: the budget check stands
    gap((FIRE_GAP + FIRE_URGENT) / 2);
    b.ensureResponse();
    expect(calls.filter((c) => c.startsWith('civ_fire_station'))).toEqual([]);
    // above FIRE_URGENT: the largest gap, then with small lots cleared, then the next gaps until a site takes it
    gap(FIRE_URGENT + 0.05);
    b.ensureResponse();
    expect(calls.filter((c) => c.startsWith('civ_fire_station'))).toEqual([
      'civ_fire_station@20,20', 'civ_fire_station@20,20+clear', 'civ_fire_station@60,20', 'civ_fire_station@60,20+clear',
    ]);
  });

  it('an industrial district beyond the fire response is a gap even with every home covered', { timeout: 600000 }, async () => {
    const b = await bot(96);
    const st = b.st, N = st.size;
    // homes everywhere covered; a block of workshops (no residents) beyond reach
    st.respFire.fill(2);
    const blk = b.blocks.find((o) => o.use === 'I')!;
    const ws = getDef('ind_workshop.id.1')!;
    const [w, d] = ws.footprint;
    let jobs = 0;
    for (let z = blk.z0; z + d <= blk.z1; z += d) for (let x = blk.x0; x + w <= blk.x1; x += w) {
      let free = true;
      for (let zz = z; zz < z + d && free; zz++) for (let xx = x; xx < x + w; xx++) if (st.building[zz * N + xx] >= 0 || st.network[zz * N + xx]) { free = false; break; }
      if (!free) continue;
      placeBuilding(b.sim, {
        id: st.nextBuildingId++, def: ws.id, x, z, w, d, rot: 0, variant: 0, pop: 0, jobs: 40, capacity: 40,
        wealth: 2, built: 1, age: 400, flags: BF.Powered | BF.Watered, baseY: 1, health: 1, unhappy: 0,
      });
      jobs += 40;
      for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) st.respFire[zz * N + xx] = -1;
    }
    expect(jobs).toBeGreaterThan(0);
    let people = 0;
    for (const o of st.buildings.values()) people += o.pop + o.jobs;
    const g = b.fireGap();
    expect(g.share).toBeCloseTo(jobs / people, 6);
    expect(g.share).toBeGreaterThan(FIRE_GAP);
    // the hotspot is the industrial block
    expect(g.at!.x).toBeGreaterThanOrEqual(blk.x0 - 8);
    expect(g.at!.x).toBeLessThan(blk.x1 + 8);
    expect(g.at!.z).toBeGreaterThanOrEqual(blk.z0 - 8);
    expect(g.at!.z).toBeLessThan(blk.z1 + 8);
  });
});
