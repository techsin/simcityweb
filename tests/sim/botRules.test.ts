/**
 * WP6a balance-bot rules (tools/simbot.ts; SIM_DEPTH_SPEC WP6 Bot, SIM_DEPTH_AMENDMENTS WP6-3, docs/SIM_DEPTH_PART_B.md
 * §5 WP6a + item 38): an attentive mayor dispatches to uncovered major emergencies (--neglect never does), a prison
 * goes into an industrial / utility block away from wealthy homes when the jail overflows, pumps are upgraded to a
 * treatment plant in place when no land is left, the land kept for utilities stays theirs and a grown city's full blocks
 * do not hide it, and a short run serves the catchment needs with every service and utility on a lot that touches a
 * road. With BALANCE=1 also the slow 128 x 15 balance gate (bottom of the file).
 */
import { describe, expect, it } from 'vitest';
import { JAIL_GAP, SimBot, botSystems } from '../../tools/simbot';
import { DevType, Network } from '../../src/core/types';
import { BF, type Building } from '../../src/sim/CityState';
import { lPath } from '../../src/sim/actions';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { CATALOG, getDef } from '../../src/sim/catalog';
import { lotTouchesRoad, placeBuilding } from '../../src/sim/economy/buildings';
import baseline from './fixtures/balance-baseline.json';

async function bot(size: number, neglect = false) {
  return new SimBot({ size, years: 1, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0, quiet: true, noInfra: false, neglect }, await botSystems(false));
}

function plopAny(b: SimBot, def: string, x: number, z: number): Building {
  for (const rot of [0, 1, 2, 3] as const) if (b.A.plop(def, x, z, rot).ok) return b.st.buildingAt(x, z)!;
  throw new Error(`cannot plop ${def} at ${x},${z}`);
}

describe('bot: emergencies (WP6-3)', () => {
  it('dispatches the best unit to an uncovered major incident; --neglect leaves it uncovered', { timeout: 600000 }, async () => {
    for (const neglect of [false, true]) {
      const b = await bot(64, neglect);
      b.st.funds = 1e6;
      expect(b.A.buildNetwork(lPath({ x: 2, z: 20 }, { x: 62, z: 20 }), Network.Road).ok).toBe(true);
      plopAny(b, 'civ_clinic', 4, 18);
      const home = plopAny(b, 'civ_library', 52, 21);
      const em = emergencyOf(b.sim)!;
      b.sim.runDays(2);
      const id = em.spawn(b.sim, 'medical', home.x, home.z, { buildingId: home.id, major: true, severity: 10 });
      expect(id).toBeGreaterThanOrEqual(0);
      const inc = em.incident(id)!;
      expect(inc.state).toBe('uncovered');
      b.daily();
      expect(em.incident(id)?.state ?? 'resolved').toBe(neglect ? 'uncovered' : 'dispatched');
      expect(b.dispatches).toBe(neglect ? 0 : 1);
    }
  });
});

describe('bot: facilities', () => {
  it('builds a prison in an industrial / utility block, never within 12 cells of R$$$ homes, when the jail overflows', { timeout: 600000 }, async () => {
    const b = await bot(96);
    b.setup();
    b.st.funds = 5e6;
    b.st.unlocked.add('jail');
    b.st.stats.justice.overflow = 0.5;
    // an R$$$ home in the middle of the industrial / utility block nearest the prison's target: that block is out
    const st = b.st, N = st.size;
    const cx = b.line(b.cbx) + 5 * 9, cz = b.trunkZ;
    const near = b.blocks.filter((o) => o.use === 'I' || o.use === 'U')
      .sort((p, q) => Math.hypot((p.x0 + p.x1) / 2 - cx, (p.z0 + p.z1) / 2 - cz) - Math.hypot((q.x0 + q.x1) / 2 - cx, (q.z0 + q.z1) / 2 - cz))[0];
    const r3 = CATALOG.find((d) => d.devType === DevType.R3 && d.footprint[0] === 1 && d.footprint[1] === 1)
      ?? CATALOG.find((d) => d.devType === DevType.R3)!;
    const [hw, hd] = r3.footprint;
    // the free lot nearest the block's centre
    let hx = -1, hz = -1, hb = Infinity;
    const mx = (near.x0 + near.x1) / 2, mz = (near.z0 + near.z1) / 2;
    for (let z = near.z0; z + hd <= near.z1; z++) for (let x = near.x0; x + hw <= near.x1; x++) {
      let free = true;
      for (let zz = z; zz < z + hd && free; zz++) for (let xx = x; xx < x + hw; xx++) if (st.building[zz * N + xx] >= 0 || st.network[zz * N + xx]) { free = false; break; }
      const dd = Math.hypot(x - mx, z - mz);
      if (free && dd < hb) { hb = dd; hx = x; hz = z; }
    }
    expect(hx).toBeGreaterThanOrEqual(0);
    placeBuilding(b.sim, {
      id: st.nextBuildingId++, def: r3.id, x: hx, z: hz, w: hw, d: hd, rot: 0, variant: 0, pop: 8, jobs: 0,
      capacity: r3.capacity ?? 8, wealth: 3, built: 1, age: 0, flags: BF.Powered | BF.Watered, baseY: 1, health: 1, unhappy: 0,
    });
    b.ensureJustice();
    const jails = [...st.buildings.values()].filter((o) => o.def === 'civ_jail');
    expect(jails.length).toBe(1);
    const j = jails[0];
    expect(lotTouchesRoad(st, j.x, j.z, j.w, j.d)).toBe(true);
    const blk = b.blocks.find((o) => j.x >= o.x0 && j.x < o.x1 && j.z >= o.z0 && j.z < o.z1);
    expect(['I', 'U']).toContain(blk?.use);
    const G = JAIL_GAP;
    expect(G).toBe(12);
    const within = hx >= j.x - G && hx < j.x + j.w + G && hz >= j.z - G && hz < j.z + j.d + G;
    expect(within).toBe(false);
  });

  it('a built-up city: with no small lot left in the industrial / utility blocks, the prison replaces stage-3 lots', { timeout: 600000 }, async () => {
    const b = await bot(96);
    b.setup();
    const st = b.st, N = st.size;
    st.funds = 5e6;
    st.unlocked.add('jail');
    st.stats.justice.overflow = 0.5;
    // every industrial / utility block developed and built up with stage-3 industry: no free lot, nothing small to clear
    const ind = CATALOG.filter((d) => d.category === 'growable' && d.stage === 3 && d.devType !== undefined && d.devType >= DevType.ID && d.devType <= DevType.IM)
      .sort((p, q) => p.footprint[0] * p.footprint[1] - q.footprint[0] * q.footprint[1])[0];
    expect(ind).toBeTruthy();
    const [w, d] = ind.footprint;
    let placed = 0;
    for (const o of b.blocks) {
      if (o.use !== 'I' && o.use !== 'U') continue;
      b.buildBlockRoads(o);
      o.developed = true;
      for (let z = o.z0; z + d <= o.z1; z += d) for (let x = o.x0; x + w <= o.x1; x += w) {
        let free = true;
        for (let zz = z; zz < z + d && free; zz++) for (let xx = x; xx < x + w; xx++) if (st.building[zz * N + xx] >= 0 || st.network[zz * N + xx] || st.water[zz * N + xx]) { free = false; break; }
        if (!free) continue;
        placeBuilding(b.sim, {
          id: st.nextBuildingId++, def: ind.id, x, z, w, d, rot: 0, variant: 0, pop: 0, jobs: 10, capacity: ind.capacity ?? 10,
          wealth: 2, built: 1, age: 400, flags: BF.Powered | BF.Watered, baseY: 1, health: 1, unhappy: 0,
        });
        placed++;
      }
    }
    expect(placed).toBeGreaterThan(10);
    const factories = [...st.buildings.values()].filter((o) => o.def === ind.id).map((o) => o.id);
    b.ensureJustice();
    const jails = [...st.buildings.values()].filter((o) => o.def === 'civ_jail');
    expect(jails.length).toBe(1);
    const j = jails[0];
    expect(lotTouchesRoad(st, j.x, j.z, j.w, j.d)).toBe(true);
    const blk = b.blocks.find((o) => j.x >= o.x0 && j.x < o.x1 && j.z >= o.z0 && j.z < o.z1);
    expect(['I', 'U']).toContain(blk?.use);
    // stage-3 factories made way for it
    expect(factories.filter((id) => !st.buildings.has(id)).length).toBeGreaterThan(0);
  });

  it('clearing lots: nothing is bulldozed for a facility that cannot stand on the cleared site, and a failed site is skipped', { timeout: 600000 }, async () => {
    const b = await bot(96);
    b.setup();
    const st = b.st, N = st.size, N1 = N + 1;
    st.funds = 5e6;
    st.unlocked.add('jail');
    // one industrial block, built up with small workshops (stage 1: what placeByClearing may clear)
    const blk = b.blocks.find((o) => o.use === 'I')!;
    b.buildBlockRoads(blk);
    blk.developed = true;
    const ws = getDef('ind_workshop.id.1')!;
    const [w, d] = ws.footprint;
    for (let z = blk.z0; z + d <= blk.z1; z += d) for (let x = blk.x0; x + w <= blk.x1; x += w) {
      let free = true;
      for (let zz = z; zz < z + d && free; zz++) for (let xx = x; xx < x + w; xx++) if (st.building[zz * N + xx] >= 0 || st.network[zz * N + xx] || st.water[zz * N + xx]) { free = false; break; }
      if (free) placeBuilding(b.sim, {
        id: st.nextBuildingId++, def: ws.id, x, z, w, d, rot: 0, variant: 0, pop: 0, jobs: 5, capacity: ws.capacity ?? 5,
        wealth: 2, built: 1, age: 400, flags: BF.Powered | BF.Watered, baseY: 1, health: 1, unhappy: 0,
      });
    }
    const inBlk = (x: number, z: number) => x >= blk.x0 && x < blk.x1 && z >= blk.z0 && z < blk.z1;
    const shops = () => [...st.buildings.values()].filter((o) => o.def === ws.id && inBlk(o.x, o.z)).length;
    const n0 = shops();
    expect(n0).toBeGreaterThan(4);
    const only = (x: number, z: number) => inBlk(x, z);
    const cx = (blk.x0 + blk.x1) >> 1, cz = (blk.z0 + blk.z1) >> 1;
    // a hillside: every lot of the block is too steep for a prison (no plop check passes) — nothing is cleared
    const hills = new Float32Array(st.heights);
    for (let z = blk.z0; z <= blk.z1; z++) for (let x = blk.x0; x <= blk.x1; x++) st.heights[z * N1 + x] += 8 * (x - blk.x0);
    expect(b.placeByClearing('civ_jail', cx, cz, Infinity, ['I'], only)).toBeNull();
    expect(shops()).toBe(n0);
    expect(b.log.some((l) => l.includes('could not build'))).toBe(false);
    // levelled again: the sites tried on the hillside wait CLEAR_FAIL_DAYS, so the same call still clears nothing ...
    st.heights.set(hills);
    expect(b.placeByClearing('civ_jail', cx, cz, Infinity, ['I'], only)).toBeNull();
    expect(shops()).toBe(n0);
    // ... and two years later the prison goes up, on cleared workshop lots
    st.day += 721;
    const r = b.placeByClearing('civ_jail', cx, cz, Infinity, ['I'], only);
    expect(r?.ok).toBe(true);
    expect(shops()).toBeLessThan(n0);
    const jail = [...st.buildings.values()].find((o) => o.def === 'civ_jail')!;
    expect(inBlk(jail.x, jail.z)).toBe(true);
    expect(lotTouchesRoad(st, jail.x, jail.z, jail.w, jail.d)).toBe(true);
  });

  it('replaces pumps by a treatment plant in place when no land is left', { timeout: 600000 }, async () => {
    const b = await bot(96);
    b.setup();
    b.st.funds = 5e6;
    b.st.unlocked.add('water_treatment');
    const u = b.blocks.find((o) => o.use === 'U')!;
    b.buildBlockRoads(u);
    u.developed = true;
    let pumps = 0;
    for (let z = u.z0; z < u.z0 + 3; z++) for (let x = u.x0; x < u.x0 + 3; x += 2) if (b.A.plop('util_water_pump', x, z, 0).ok) pumps++;
    expect(pumps).toBeGreaterThan(0);
    expect(b.upgradePumps()).toBe(true);
    const plants = [...b.st.buildings.values()].filter((o) => o.def === 'util_water_treatment');
    expect(plants.length).toBe(1);
  });

  it('reserved (undeveloped) utility blocks are for power and water only; blocks without room do not use up the search', { timeout: 600000 }, async () => {
    const b = await bot(128);
    b.setup();
    b.st.funds = 5e6;
    b.st.unlocked.add('water_treatment');
    b.st.unlocked.add('jail');
    const st = b.st, N = st.size;
    const u = b.blocks.find((o) => o.use === 'U' && !o.developed)!;
    expect(u).toBeTruthy();
    const ux = (u.x0 + u.x1) / 2, uz = (u.z0 + u.z1) / 2;
    // the other planned utility blocks are taken: u is the whole reserve (1 + pop / 150k blocks)
    for (const o of b.blocks) if (o.use === 'U' && o !== u) { b.buildBlockRoads(o); o.developed = true; }
    expect(b.utilityReserve()).toBe(1);
    expect(b.spareUtilityBlocks()).toBe(0);
    // a prison (or anything but power / water) never takes the land kept for utilities
    expect(b.placeNear('civ_jail', ux, uz, ['U'], true, 1, true)).toBeNull();
    expect(u.developed).toBe(false);
    // the nearest 14 industrial / utility blocks are full: the search goes on to the first block with room (it used to
    // try only the 14 nearest, full or not — the reserved blocks of a grown city were never reached)
    const cx = b.line(b.cbx), cz = b.line(b.cbz);
    const dist = (o: typeof u) => Math.hypot((o.x0 + o.x1) / 2 - cx, (o.z0 + o.z1) / 2 - cz);
    const cand = b.blocks.filter((o) => o.use === 'I' || o.use === 'X').sort((p, q) => dist(p) - dist(q));
    expect(cand.length).toBeGreaterThan(15);
    for (const o of cand.slice(0, 15)) {
      b.buildBlockRoads(o);
      o.developed = true;
      for (let z = o.z0; z < o.z1; z++) for (let x = o.x0; x < o.x1; x++) if (st.network[z * N + x] === Network.None) st.building[z * N + x] = 0x7fffff;
    }
    const r = b.placeNear('util_water_treatment', cx, cz, ['I', 'X'], true, Infinity, true);
    expect(r?.ok).toBe(true);
    // and the reserve itself serves power / water (a reserved block touches the town: roads on its sides)
    b.buildBlockRoads(u);
    expect(b.placeNear('util_water_pump', ux, uz, ['U'], true, 1, true)?.ok).toBe(true);
    const plant = [...st.buildings.values()].find((o) => o.def === 'util_water_treatment')!;
    expect(lotTouchesRoad(st, plant.x, plant.z, plant.w, plant.d)).toBe(true);
  });

  it('a walking-catchment facility (school, clinic, park) never takes a lot whose only road is the highway; the trunk upgrade re-homes stranded ones', { timeout: 600000 }, async () => {
    const b = await bot(96);
    b.setup();
    b.st.funds = 5e6;
    const st = b.st, N = st.size;
    const walkRoad = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N && st.network[z * N + x] >= Network.Street && st.network[z * N + x] <= Network.OneWay;
    // a 3 x 3 lot just below the trunk (an avenue for now) with no other road along its edges
    const z0 = b.trunkZ + 1;
    let x0 = -1;
    for (let x = 1; x + 4 < N && x0 < 0; x++) {
      let ok = st.network[(z0 - 1) * N + x] === Network.Avenue;
      for (let dz = 0; dz < 3 && ok; dz++) for (let dx = 0; dx < 3; dx++) if (st.network[(z0 + dz) * N + x + dx] !== Network.None) ok = false;
      for (let k = -1; k <= 3 && ok; k++) if (walkRoad(x + k, z0 + 3)) ok = false;
      for (let k = 0; k < 3 && ok; k++) if (walkRoad(x - 1, z0 + k) || walkRoad(x + 3, z0 + k)) ok = false;
      if (ok) x0 = x;
    }
    expect(x0).toBeGreaterThanOrEqual(0);
    const target = b.trunkZ + 8; // (a target on the same side of the trunk)
    // while the trunk is an avenue it is a footpath like any street: a school may front it
    expect(b.civicAccept('civ_elementary_school', target)(x0, z0, 3, 3)).toBe(true);
    let school: Building | null = null;
    for (const rot of [0, 1, 2, 3] as const) if (!school && b.A.plop('civ_elementary_school', x0, z0, rot).ok) school = st.buildingAt(x0, z0)!;
    expect(school).toBeTruthy();
    // the town grows, the trunk becomes a highway (a pedestrian barrier): the school would reach nobody — it is moved
    expect(b.A.buildNetwork(lPath({ x: 0, z: b.trunkZ }, { x: N - 1, z: b.trunkZ }), Network.Highway).ok).toBe(true);
    b.highway = true;
    b.rehomeStranded();
    expect(st.buildings.has(school!.id)).toBe(false);
    expect(b.civicAccept('civ_elementary_school', target)(x0, z0, 3, 3)).toBe(false);
    expect(b.civicAccept('park_small', target)(x0, z0, 1, 1)).toBe(false);
    // a drive catchment (police, fire, high school) takes the highway; across the trunk nothing serves the target
    expect(b.civicAccept('civ_police_station', target)(x0, z0, 3, 3)).toBe(true);
    expect(b.civicAccept('civ_police_station', b.trunkZ - 8)(x0, z0, 3, 3)).toBe(false);
    // a street along the lot's back: the school may go there
    expect(b.A.buildNetwork(lPath({ x: x0, z: z0 + 3 }, { x: x0 + 2, z: z0 + 3 }), Network.Street).ok).toBe(true);
    expect(b.civicAccept('civ_elementary_school', target)(x0, z0, 3, 3)).toBe(true);
  });

  it('a short run serves catchment needs and puts every service and utility on a lot that touches a road', { timeout: 1200000 }, async () => {
    const b = await bot(96);
    b.run(4);
    const st = b.st;
    const s = st.stats;
    expect(s.population).toBeGreaterThan(3000);
    expect((st.milestones['civ_elementary_school'] ?? 0)).toBeGreaterThanOrEqual(1);
    let services = 0, noRoad = 0;
    for (const o of st.buildings.values()) {
      if (!(o.flags & BF.Plopped)) continue;
      const def = getDef(o.def);
      if (!def || def.category === 'transport' || def.category === 'park' || def.category === 'reward' || def.category === 'landmark') continue;
      services++;
      if (!lotTouchesRoad(st, o.x, o.z, o.w, o.d)) noRoad++;
    }
    expect(services).toBeGreaterThan(3);
    expect(noRoad).toBe(0);
    // the yearly report carries the new columns
    const row = b.rows[b.rows.length - 1];
    expect(row.kidsPct).toBeGreaterThan(0);
    expect(row.enrolE).toBeGreaterThan(0);
  });
});

/**
 * SLOW balance gate (SIM_DEPTH_SPEC WP6 "Slow balance test" + docs/SIM_DEPTH_PART_B.md item 39), only with BALANCE=1:
 *   BALANCE=1 npx vitest run tests/sim/botRules.test.ts -t balance
 * The bot on a 128 map for 15 years (seed 7): population >= 0.9 x the phase-0 baseline; from year 10 the elementary need
 * is >= 85 % served with < 5 % of the kids unreached, counted per home (SimBot.homeNeed: a deep lot whose front door is
 * in a school's catchment is served), and the per-cell stats.needs that migration, approval and the advisors read agrees
 * with it within 0.05 — this last check needs services.ts to count a lot by its footprint (routed item 1, owner lead /
 * WP6b: scratchpad simB/review-WP6a-sim/fixes/services_needs_stats.patch; without it stats.needs still counts the back
 * rows of deep lots as unreached: 0.51 served / 0.45 unreached per cell vs 0.91 / 0.02 per home in 2015); <= 3 % of the
 * growables abandoned in any year; a prison once the jail overflows (overflow <= 0.2 from year 8). WP6b moves / extends
 * this gate in tests/sim/balance.test.ts (256 x 60, the partB baseline set).
 */
describe.skipIf(process.env.BALANCE !== '1')('balance (slow, BALANCE=1)', () => {
  it('128 x 15 seed 7: population, elementary schools per home, abandonment, justice', { timeout: 7_200_000 }, async () => {
    const b = new SimBot({ size: 128, years: 15, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0.2, quiet: true, noInfra: false }, await botSystems(false));
    const yearly: { year: number; pop: number; served: number; unreached: number; cellServed: number; cellUnreached: number; abandoned: number; overflow: number }[] = [];
    b.run(15, (r) => {
      const n = b.homeNeed('elementary');
      const c = b.st.stats.needs?.elementary;
      let grow = 0, ab = 0;
      for (const o of b.st.buildings.values()) {
        if (o.flags & BF.Plopped) continue;
        grow++;
        if (o.flags & BF.Abandoned) ab++;
      }
      yearly.push({
        year: r.year, pop: r.pop, served: n.need > 0 ? n.served / n.need : 1, unreached: n.need > 0 ? n.unreached / n.need : 0,
        cellServed: c && c.need > 0 ? c.served / c.need : 1, cellUnreached: c && c.need > 0 ? c.unreached / c.need : 0,
        abandoned: grow ? ab / grow : 0, overflow: b.st.stats.justice?.overflow ?? 0,
      });
    });
    const phase0 = (baseline.runs['128x15_seed7'].phase0 as number[][]).at(-1)!;
    expect(yearly.at(-1)!.pop).toBeGreaterThanOrEqual(0.9 * phase0[1]);
    for (const y of yearly.slice(9)) {
      expect(y.served, `elementary served per home ${y.year}`).toBeGreaterThanOrEqual(0.85);
      expect(y.unreached, `kids unreached per home ${y.year}`).toBeLessThan(0.05);
      // (what the advisors, approval and migration read: needs services.ts's footprint-aware stats, see above)
      expect(Math.abs(y.cellServed - y.served), `stats.needs elementary served per cell vs per home ${y.year}`).toBeLessThanOrEqual(0.05);
      expect(Math.abs(y.cellUnreached - y.unreached), `stats.needs kids unreached per cell vs per home ${y.year}`).toBeLessThanOrEqual(0.05);
    }
    for (const y of yearly) expect(y.abandoned, `abandoned ${y.year}`).toBeLessThanOrEqual(0.03);
    for (const y of yearly.slice(7)) expect(y.overflow, `justice overflow ${y.year}`).toBeLessThanOrEqual(0.2);
  });
});
