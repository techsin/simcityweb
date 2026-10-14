/**
 * Final fixes, lane sim-econ (PB-BOTFALLBACK + routed 4 / 39 / 46): the balance bot's "sector full" fallback zones new
 * commerce near the core and the homes (not in a chain along the map edge next to the outermost shop block), the
 * garbage-range rule counts shops and offices beyond the trucks' reach whatever their tonnage, and the bot's --help.
 */
import { describe, expect, it } from 'vitest';
import { FIRE_GAP, FIRE_URGENT, SimBot, USAGE, botSystems } from '../../tools/simbot';
import { DevType } from '../../src/core/types';
import { getDef } from '../../src/sim/catalog';

async function bot(size: number) {
  return new SimBot({ size, years: 1, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0, quiet: true, noInfra: false }, await botSystems(false));
}
const ringOf = (b: SimBot, bx: number, bz: number) => Math.max(Math.abs(bx - b.cbx + 0.5), Math.abs(bz - b.cbz + 0.5));

describe('bot fallback: a full commercial sector takes residential land near the core and the homes', () => {
  it('every C block developed, homes out to ring 3.5: the new shop blocks sit on the frontier among the homes', { timeout: 300000 }, async () => {
    const b = await bot(160);
    // the commercial sector is full (its outermost blocks reach ring ~8, next to undeveloped land), the town's homes
    // reach ring 3.5
    for (const o of b.blocks) {
      if (o.use === 'C') o.developed = true;
      if (o.use === 'R' && o.ring <= 3.5) o.developed = true;
    }
    const farC = b.blocks.filter((o) => o.use === 'C' && o.ring >= 5);
    expect(farC.length).toBeGreaterThan(0);
    const picks: { bx: number; bz: number; ring: number; homes: number }[] = [];
    for (let k = 0; k < 8; k++) {
      const p = b.nextBlock('C');
      expect(p).toBeDefined();
      let homes = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const o = b.byKey.get(p!.bx + dx + ',' + (p!.bz + dz));
        if (o && o !== p && o.developed && o.use === 'R') homes++;
      }
      picks.push({ bx: p!.bx, bz: p!.bz, ring: p!.ring, homes });
      expect(p!.use).toBe('C');
      p!.developed = true;
    }
    // (the old rule took the block nearest any commercial block: the land beside the outermost shop blocks, ring >= 5,
    // with no homes around — and then the block beside that one)
    for (const p of picks) {
      expect(p.ring).toBeLessThanOrEqual(4.5);
      expect(p.homes).toBeGreaterThanOrEqual(2);
    }
    // spread around the town, not one chain along an edge
    expect(new Set(picks.map((p) => Math.sign(p.bx - b.cbx + 0.5) + ',' + Math.sign(p.bz - b.cbz + 0.5))).size).toBeGreaterThanOrEqual(3);
    void ringOf;
  });

  it('a full industrial sector still extends the industrial park (the residential block nearest the industry)', { timeout: 300000 }, async () => {
    const b = await bot(160);
    for (const o of b.blocks) {
      if (o.use === 'I') o.developed = true;
      if (o.use === 'R' && o.ring <= 2.5) o.developed = true;
    }
    const p = b.nextBlock('I')!;
    expect(p).toBeDefined();
    expect(p.use).toBe('I');
    let dmin = Infinity;
    for (const o of b.blocks) if (o !== p && o.developed && o.use === 'I') dmin = Math.min(dmin, Math.abs(o.bx - p.bx) + Math.abs(o.bz - p.bz));
    expect(dmin).toBe(1);
  });
});

describe('bot garbage rule: shops and offices beyond the trucks count, whatever their tonnage (routed 4)', () => {
  it('a 1M-size city (0.3 % of its garbage = 90 t) with 5 new shops beyond range (2.5 t) gets a facility for them', { timeout: 300000 }, async () => {
    const run = (withShops: boolean) => async () => {
      const b = await bot(96);
      b.setup();
      const st = b.st;
      st.stats.population = 1_000_000;
      // five shops in the north-west corner beyond the trucks' reach, each making 0.5 t a month (new, few workers);
      // 30 homes elsewhere, collected
      const shop = 'com_boutique.cs3.1';
      expect(getDef(shop)?.devType).toBe(DevType.CS3);
      const ids: number[] = [];
      for (let k = 0; k < (withShops ? 5 : 0); k++) {
        const id = st.nextBuildingId++;
        st.buildings.set(id, { id, def: shop, x: 2 + 3 * k, z: 5, w: 1, d: 1, rot: 0, variant: 0, pop: 0, jobs: 2, capacity: 12, wealth: 3, built: 1, age: 30, flags: 0, baseY: 1, health: 1, unhappy: 0 });
        ids.push(id);
      }
      const fake = {
        garbageSummary: () => ({ producedT: 30_000, outOfRangeT: withShops ? 2.5 : 0, overCapacityT: 0 }),
        garbageInfo: (id: number) => (ids.includes(id) ? { producedT: 0.5, collected: false, reason: 'range' } : { producedT: 1, collected: true }),
      };
      const sim = b.sim as unknown as { getSystem: (n: string) => unknown };
      const orig = sim.getSystem.bind(sim);
      sim.getSystem = (n: string) => (n === 'pollution' ? fake : orig(n));
      const calls: { x: number; z: number }[] = [];
      (b as unknown as { garbageFacilityNear: (x: number, z: number) => boolean }).garbageFacilityNear = (x: number, z: number) => { calls.push({ x, z }); return true; };
      // (capacity is fine: only the range rule can act)
      st.stats.garbageProduced = 100; st.stats.garbageCapacity = 1000;
      b.ensureGarbage();
      return calls;
    };
    const none = await run(false)();
    expect(none).toEqual([]);
    const calls = await run(true)();
    expect(calls.length).toBe(1);
    expect(calls[0].x).toBeLessThan(20);
    expect(calls[0].z).toBeLessThan(12);
  });
});

describe('bot fire rule: an urgent fire gap is not starved by the other rules\' reserve', () => {
  it('more than FIRE_URGENT beyond reach and the bank below the 1.5-month reserve: the station is still built', { timeout: 300000 }, async () => {
    const b = await bot(96);
    const st = b.st;
    for (let d = 0; d < 3; d++) b.sim.advanceDay();
    st.stats.population = 20000;
    st.budget.lastIncome = { 'tax:R$': 9000 };
    st.budget.lastExpense = { 'service:police': 10000 };
    // below canSpend's reserve (4,000 + 1.5 months of expenses + the price), above the urgent cushion (1,500 + 0.3 months)
    st.funds = 12000;
    b.pendingUpkeep = 0;
    expect(b.canSpend(1400)).toBe(false);
    expect(b.canSpendUrgent(1400)).toBe(true);
    const calls: string[] = [];
    (b as unknown as { placeCivic: (d: string) => unknown }).placeCivic = (d: string) => { calls.push(d); return d === 'civ_fire_station' ? { ok: true, cost: 1400, affected: 1 } : null; };
    const gap = (share: number) => {
      (b as unknown as { fireGap: () => unknown }).fireGap = () => ({ share, at: { x: 20, z: 20 }, alts: [] });
    };
    gap((FIRE_GAP + FIRE_URGENT) / 2);
    b.ensureResponse();
    expect(calls.filter((c) => c === 'civ_fire_station')).toEqual([]);
    gap(FIRE_URGENT + 0.03);
    b.ensureResponse();
    expect(calls.filter((c) => c === 'civ_fire_station')).toEqual(['civ_fire_station']);
    // an empty till still waits (1,500 + 0.3 months of expenses stay)
    st.funds = 5000;
    expect(b.canSpendUrgent(1400)).toBe(false);
  });
});

describe('bot --help (routed 46)', () => {
  it('USAGE lists every flag of the command line', () => {
    for (const f of ['--size', '--years', '--seed', '--difficulty', '--terrain', '--water', '--quiet', '--no-infra', '--tax', '--spendy', '--neglect', '--skip', '--help']) {
      expect(USAGE).toContain(f);
    }
  });
});
