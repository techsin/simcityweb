/**
 * WP6b final balance gate (docs/SIM_DEPTH_PART_B.md §7, SIM_DEPTH_SPEC WP6 "Balance procedure", SIM_DEPTH_AMENDMENTS
 * WP6-4). SLOW: only with BALANCE=1 (three 128 x 15 bots, ~10-30 min on a loaded box); BALANCE=256 also runs the
 * 256 x 60 seed 7 gate (an hour or more).
 *   BALANCE=1 npx vitest run tests/sim/balance.test.ts --testTimeout=7200000
 *
 * 128 x 15 seed 7, the partB baseline set (tests/sim/fixtures/balance-baseline.json, recorded by WP6b; phase0 kept):
 *  - population >= 0.9 x phase0 every year and >= 0.9 x partB from year 5, approval >= 50 from year 10, funds >= 0,
 *    EQ >= 100 by year 15;
 *  - one employment ledger: |unemployment - (1 - access-weighted employment)| <= 0.02 every year;
 *  - emergencies: >= 85 % of the incidents auto-dispatched from year 10, <= 5 % failed over the run; justice overflow
 *    <= 0.2 from year 8; <= 3 % of the growables abandoned; water and power supply >= demand from year 6;
 *  - the wrong choices do clearly worse (critic item 41): a mayor who builds no services at all ends with less than
 *    half the population, approval below 45 and most incidents failed; one who builds no schools ends with EQ < 60 and
 *    lower approval — and neither ends with more than 5 % more people than the base (the chaos margin);
 *  - WP6b round 2: a mayor who never dispatches to uncovered emergencies (--neglect) has more of them fail and a lower
 *    approval over the run (residents remember unanswered emergencies for a year); one who refuses smokestack industry
 *    (--skip dirty) breathes cleaner air but pays with unemployment (labour headroom: commerce alone no longer employs
 *    everyone) and a smaller city.
 * The yearly tables for seeds 7 and 11 (256 x 60) live in the partB set; tools/simbot.ts prints the same columns.
 */
import { describe, expect, it } from 'vitest';
import { SimBot, botSystems, type BotOptions } from '../../tools/simbot';
import { BF } from '../../src/sim/CityState';
import { workerShare } from '../../src/sim/economy/demographics';
import baseline from './fixtures/balance-baseline.json';

interface Yearly {
  year: number; pop: number; funds: number; approval: number; eq: number; unemployment: number; accUnemp: number;
  incidents: number; auto: number; failed: number; overflow: number; abandoned: number; waterOk: boolean; powerOk: boolean;
  air: number;
}

async function play(size: number, years: number, seed: number, extra: Partial<BotOptions> = {}): Promise<Yearly[]> {
  const b = new SimBot({ size, years, seed, difficulty: 'medium', terrain: 'plains', water: 0.2, quiet: true, noInfra: false, ...extra }, await botSystems(false));
  const out: Yearly[] = [];
  b.run(years, (r) => {
    const st = b.st, s = st.stats;
    const tr = b.sim.getSystem('traffic') as unknown as { workerAccess?: (id: number) => number } | undefined;
    let grow = 0, ab = 0, accW = 0, accE = 0, unW = 0;
    for (const o of st.buildings.values()) {
      if (o.flags & BF.Plopped) continue;
      grow++;
      if (o.flags & BF.Abandoned) ab++;
      if (o.pop <= 0 || o.flags & (BF.Abandoned | BF.Burnt)) continue;
      const w = o.pop * workerShare(o);
      const a = tr?.workerAccess ? tr.workerAccess(o.id) : -1;
      if (a >= 0) { accW += w; accE += w * Math.max(0, Math.min(1, a)); } else unW += w;
    }
    const mean = accW > 0 ? accE / accW : 1;
    const em = s.emergency?.year;
    const sum = (v: Record<string, number> | number | undefined) => (typeof v === 'number' ? v : v ? Object.values(v).reduce((x, y) => x + y, 0) : 0);
    out.push({
      year: r.year, pop: r.pop, funds: r.funds, approval: r.approval, eq: r.eq, unemployment: r.unemployment,
      accUnemp: accW + unW > 0 ? 1 - (accE + unW * mean) / (accW + unW) : 0,
      incidents: sum(em?.count), auto: sum(em?.auto), failed: sum(em?.failed), overflow: s.justice?.overflow ?? 0,
      abandoned: grow ? ab / grow : 0, waterOk: s.waterSupply >= s.waterDemand, powerOk: s.powerSupply >= s.powerDemand,
      air: s.avgAir ?? 0,
    });
  });
  return out;
}

type Runs = Record<string, { phase0: number[][]; partB?: number[][] }>;
const runs = (baseline as unknown as { runs: Runs }).runs;

function gates(key: string, y: Yearly[], opts: { approvalFrom: number; eqBy: number; overflowFrom: number; utilFrom: number }) {
  const p0 = new Map(runs[key].phase0.map((r) => [r[0], r[1]]));
  const pb = new Map((runs[key].partB ?? []).map((r) => [r[0], r[1]]));
  let inc = 0, failed = 0;
  y.forEach((r, k) => {
    const n = k + 1;
    if (p0.has(r.year)) expect(r.pop, `pop ${r.year} vs phase0`).toBeGreaterThanOrEqual(0.9 * p0.get(r.year)!);
    // (partB from year 5: a 5k town moves by more than 10 % with any change of the chaotic bot)
    if (n >= 5 && pb.has(r.year)) expect(r.pop, `pop ${r.year} vs partB`).toBeGreaterThanOrEqual(0.9 * pb.get(r.year)!);
    expect(r.funds, `funds ${r.year}`).toBeGreaterThanOrEqual(0);
    if (n >= opts.approvalFrom) expect(r.approval, `approval ${r.year}`).toBeGreaterThanOrEqual(50);
    expect(Math.abs(r.unemployment - r.accUnemp), `unemployment vs access ${r.year}`).toBeLessThanOrEqual(0.02);
    if (n >= 10 && r.incidents > 0) expect(r.auto / r.incidents, `auto-dispatched ${r.year}`).toBeGreaterThanOrEqual(0.85);
    if (n >= opts.overflowFrom) expect(r.overflow, `justice overflow ${r.year}`).toBeLessThanOrEqual(0.2);
    expect(r.abandoned, `abandoned ${r.year}`).toBeLessThanOrEqual(0.03);
    if (n >= opts.utilFrom) {
      expect(r.waterOk, `water ${r.year}`).toBe(true);
      expect(r.powerOk, `power ${r.year}`).toBe(true);
    }
    inc += r.incidents; failed += r.failed;
  });
  expect(failed / Math.max(1, inc), 'failed incidents over the run').toBeLessThanOrEqual(0.05);
  expect(Math.max(...y.slice(0, opts.eqBy).map((r) => r.eq)), `EQ by year ${opts.eqBy}`).toBeGreaterThanOrEqual(100);
}

describe.skipIf(process.env.BALANCE !== '1' && process.env.BALANCE !== '256')('WP6b balance gate (slow, BALANCE=1)', () => {
  it('128 x 15 seed 7: the acceptance gates, the partB baseline and the wrong choices', { timeout: 7_200_000 }, async () => {
    const y = await play(128, 15, 7);
    gates('128x15_seed7', y, { approvalFrom: 10, eqBy: 15, overflowFrom: 8, utilFrom: 6 });
    const base = y.at(-1)!;
    // no services at all (police, fire, schools, clinics, parks, emergency response): far fewer people, angry, failing
    const none = await play(128, 15, 7, { skip: ['services'] });
    const n = none.at(-1)!;
    expect(n.pop, 'no services: population').toBeLessThan(0.5 * base.pop);
    expect(n.approval, 'no services: approval').toBeLessThan(Math.min(45, base.approval - 20));
    const inc = none.reduce((s, r) => s + r.incidents, 0), failed = none.reduce((s, r) => s + r.failed, 0);
    expect(failed / Math.max(1, inc), 'no services: failed incidents').toBeGreaterThan(0.5);
    // no schools: the education quotient collapses and approval falls, with no population gain beyond the chaos margin
    const ns = (await play(128, 15, 7, { skip: ['schools'] })).at(-1)!;
    expect(ns.eq, 'no schools: EQ').toBeLessThan(60);
    expect(ns.approval, 'no schools: approval').toBeLessThan(base.approval);
    expect(ns.pop, 'no schools: population').toBeLessThanOrEqual(1.05 * base.pop);
    // neglect (never dispatching to uncovered emergencies): more of them fail, approval over the run is lower
    const mean = (v: Yearly[], f: (r: Yearly) => number) => v.reduce((s, r) => s + f(r), 0) / v.length;
    const ng = await play(128, 15, 7, { neglect: true });
    expect(ng.reduce((s, r) => s + r.failed, 0), 'neglect: failed incidents').toBeGreaterThan(y.reduce((s, r) => s + r.failed, 0));
    expect(mean(ng, (r) => r.approval), 'neglect: mean approval').toBeLessThan(mean(y, (r) => r.approval));
    // no smokestack industry: cleaner air, but jobs lag (unemployment) and the city stays smaller
    const dirty = await play(128, 15, 7, { skip: ['dirty'] });
    expect(dirty.at(-1)!.air, 'no dirty industry: air').toBeLessThan(base.air);
    expect(Math.max(...dirty.map((r) => r.unemployment)), 'no dirty industry: unemployment').toBeGreaterThan(0.04);
    expect(dirty.at(-1)!.pop, 'no dirty industry: population').toBeLessThan(0.9 * base.pop);
  });
});

describe.skipIf(process.env.BALANCE !== '256')('WP6b balance gate 256 x 60 (very slow, BALANCE=256)', () => {
  it('256 x 60 seed 7: the spec gates', { timeout: 14_400_000 }, async () => {
    const y = await play(256, 60, 7);
    gates('256x60_seed7', y, { approvalFrom: 30, eqBy: 30, overflowFrom: 20, utilFrom: 21 });
    expect(y[14].pop, 'year 15').toBeGreaterThanOrEqual(150000);
    expect(y[59].pop, 'year 60').toBeGreaterThanOrEqual(950000);
  });
});
