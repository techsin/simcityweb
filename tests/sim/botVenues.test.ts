/**
 * WP6b balance round 3 bot rules (tools/simbot.ts; acceptance round 2, LEAD DECISION 13): tourism venues — landmarks,
 * the big sport / entertainment / business venues, the city's zoo and its airports — are saved for (a share of each
 * month's surplus goes into a venue fund that optional spending leaves alone) and bought cheapest first once the fund
 * holds the price and a reserve stays in the bank; a venue goes on any free lot of a park block (a grown city's park
 * blocks rarely have their edges free), an airport onto the airport blocks once they border the town; fire response
 * counts workers as well as residents.
 */
import { describe, expect, it } from 'vitest';
import { FIRE_GAP, SimBot, VENUE_POP, VENUE_RESERVE_MONTHS, VENUE_SAVE_SHARE, botSystems } from '../../tools/simbot';
import { BF } from '../../src/sim/CityState';
import { CATALOG, getDef } from '../../src/sim/catalog';
import { lotTouchesRoad, placeBuilding } from '../../src/sim/economy/buildings';

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
    const { net } = town(b, ['lm_arch', 'zoo', 'lm_cathedral']);
    const list = b.venueCandidates();
    expect(list.map((c) => c.id)).toEqual(['lm_arch', 'park_zoo', 'lm_cathedral']);
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

  it('the municipal airport waits until its blocks border the town; the zoo is one', { timeout: 600000 }, async () => {
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
    // one zoo: once it stands, the venue rule saves for the next venue
    expect(b.venueCandidates().some((c) => c.id === 'park_zoo')).toBe(true);
    st.milestones['park_zoo'] = 1;
    expect(b.venueCandidates().some((c) => c.id === 'park_zoo')).toBe(false);
  });
});

describe('bot: fire response counts workers (WP6b round 3)', () => {
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
