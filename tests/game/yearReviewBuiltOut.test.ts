/**
 * T054b: LG-21's built-out grade reads a real producer. LG-05's block in the advisors' month tick publishes the map's
 * free-land test as AdvisorData.full; the history system, the next one of the tick, samples it as history.builtOut, and
 * the year review scores the growth stat of a full city on unemployment. End to end here:
 *   - a town that zones its last free land (the flag at the next month tick, the series from that month, the year's
 *     grade), and that later gives land back;
 *   - land exhaustion and the demand-gated built-out card stay distinct, as T054's stub test has them
 *     (yearReviewHistory.test.ts): a full map with weak demand has the flag and no card, and a card the Advisors panel
 *     already shows between two month ticks publishes nothing;
 *   - a real economy (a SimBot city whose last free land is zoned): the flag, the series and the grade; a saved game
 *     continues bit for bit (T057: the flag is plain saved state of the advisors' record, not a continuity record), and a
 *     save from before the flag gets it at its next month tick;
 *   - the packet host: the replica mirrors the flag and the series, the card's grade row shows the score, and the flag
 *     leaves the replica when it leaves the core's record.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SimBot } from '../../tools/simbot';
import { Emitter } from '../../src/core/events';
import { DevType, Network, Zone } from '../../src/core/types';
import type { GameContext, UIEvents } from '../../src/game/context';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import { CityActions } from '../../src/sim/actions';
import type { CityState } from '../../src/sim/CityState';
import { CONTINUITY_RECORDS } from '../../src/sim/persist';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { BUILT_OUT_FREE, advisorData, advisorIssues, advisorsSystem, type AdvisorData, type AdvisorsSystem } from '../../src/sim/economy/advisors';
import { historySystem } from '../../src/sim/economy/history';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { economySystems } from '../../src/sim/systems/economy';
import { decodeBundle, encodeBundle } from '../../src/save/bundle';
import { applyCityDelta, encodeCityDelta } from '../../src/save/recoveryCodec';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { YearReview, buildYearReview, yearGradeInput } from '../../src/ui/YearReview';
import { growthScore, unemploymentScore, yearGrade } from '../../src/ui/yearGrade';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { exactDigest } from '../../src/worker/queries';
import { newState, place, roadLine } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();

/** free land as the advisors' zone scan counts it (ZoneScan.free): unzoned, no building, network, water or power line */
function freeLand(st: CityState): number {
  let n = 0;
  for (let i = 0; i < st.cells; i++) if (st.zone[i] === Zone.None && st.building[i] < 0 && st.network[i] === Network.None && !st.water[i] && !st.powerLines[i]) n++;
  return n;
}
/** the published flag as saved (undefined: no such field) */
const flagOf = (st: CityState) => (st.systemData.advisors as AdvisorData | undefined)?.full;
const hasFlag = (st: CityState) => Object.hasOwn((st.systemData.advisors ?? {}) as object, 'full');
const planning = (st: CityState, id: string) => advisorIssues(st).planning?.find((a) => a.id === id);

/**
 * a 64 × 64 town like LG-05's (tests/sim/advisors.test.ts): a road on every eighth row, every other tile zoned for shops,
 * one shop per strip: no free land. `freeStrip` leaves the last strip unzoned (STRIP: 448 free tiles, 11% of the map)
 */
function town(freeStrip: boolean): CityState {
  const st = newState(64);
  st.systemData.infraVersion = 1;
  st.funds = 1e6;
  for (let z = 0; z < 64; z += 8) roadLine(st, 0, z, 63, z, Network.Road);
  for (let k = 0; k < 8; k++) {
    if (freeStrip && k === 7) continue;
    for (let z = 8 * k + 1; z < 8 * k + 8; z++) for (let x = 0; x < 64; x++) st.zone[st.idx(x, z)] = Zone.ComLow;
    place(st, 't_cs', 5, 8 * k + 1, { jobs: 10 });
  }
  return st;
}
const STRIP = { x0: 0, z0: 57, x1: 64, z1: 64 };

/**
 * the producer and the reader in their economy order, on figures a test system writes each day before they read them
 * (no economy runs: the demand, the population and the unemployment are what `figures` says)
 */
function pipeline(figures: (st: CityState) => void): { systems: SimSystem[]; adv: AdvisorsSystem } {
  const adv = advisorsSystem(new EconRuntime()) as AdvisorsSystem;
  const services = { name: 'services', clustersOf: () => [], facilityLoadOf: () => null } as unknown as SimSystem;
  const mayor: SimSystem = { name: 'test.figures', init: (sim) => figures(sim.state), daily: (sim) => figures(sim.state) };
  return { systems: [services, mayor, adv, historySystem()], adv };
}
function play(st: CityState, figures: (st: CityState) => void) {
  const { systems, adv } = pipeline(figures);
  const sim = new Simulation(st, systems);
  return { st, sim, adv, A: new CityActions(sim) };
}

// ---- T057's whole-city comparison (tests/save/loadContinuity.test.ts): the city as saved, key by key (savedAt aside)
function canonical(v: unknown): unknown {
  if (ArrayBuffer.isView(v)) {
    const b = new Uint8Array((v as ArrayBufferView).buffer, (v as ArrayBufferView).byteOffset, (v as ArrayBufferView).byteLength);
    return `${v.constructor.name}:${createHash('sha256').update(b).digest('hex')}`;
  }
  if (v instanceof Map) return ['$map', ...[...v.entries()].map(([k, x]) => [canonical(k), canonical(x)])];
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : Number.isNaN(v) ? 'NaN' : v;
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}
function digest(st: CityState): Record<string, string> {
  const s = serializeCity(st, { copy: true }) as unknown as Record<string, unknown>;
  const out: Record<string, string> = {};
  const add = (k: string, v: unknown) => { out[k] = createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex').slice(0, 16); };
  for (const k of Object.keys(s)) if (k !== 'savedAt' && k !== 'data') add(k, s[k]);
  const data = s.data as Record<string, unknown>;
  for (const k of Object.keys(data)) if (k !== 'systemData' && k !== 'stats') add(`data.${k}`, data[k]);
  const stats = data.stats as Record<string, unknown>;
  for (const k of Object.keys(stats)) add(`stats.${k}`, stats[k]);
  const sd = data.systemData as Record<string, unknown>;
  for (const k of Object.keys(sd)) add(`sd.${k}`, sd[k]);
  return out;
}
const differing = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
const savedAdvisors = (s: SerializedCity) => (s.data.systemData as { advisors: AdvisorData }).advisors;

describe('T054b: LG-05 publishes land exhaustion and LG-21 grades a full city on unemployment', () => {
  it('a town zones its last free land: the flag at the next month tick, the series from that month, the year graded on unemployment; freed land takes it back', () => {
    // year 1: a free strip, 9% unemployed. Year 2 (the strip zoned on day 400): the town loses 6% of its residents with 6%
    // unemployed. Year 3 (the strip dezoned on day 760): it grows 4% with 12% unemployed
    const { st, sim, A } = play(town(true), (c) => {
      const d = c.day;
      c.stats.population = d <= 360 ? 50000 : d <= 720 ? Math.round(50000 - (3000 * (d - 360)) / 360) : Math.round(47000 + (1880 * (d - 720)) / 360);
      c.stats.unemployment = d <= 360 ? 0.09 : d <= 720 ? 0.06 : 0.12;
    });
    const year = (n: number) => st.config.startYear + n;
    sim.runDays(360);
    expect(freeLand(st)).toBe(448);
    expect(448).toBeGreaterThan(BUILT_OUT_FREE * st.cells);
    expect(hasFlag(st), 'land left: no such field, as before').toBe(false);
    expect(st.history.builtOut).toEqual(new Array(12).fill(0));
    const y1 = yearGradeInput(st.history, 12)!;
    expect(y1.builtOut).toBe(false);
    expect(yearGrade(y1).scores.growth).toBe(growthScore(y1.growth));
    expect([growthScore(y1.growth), unemploymentScore(y1.unemployment)]).toEqual([100, expect.closeTo(37.5, 9)]);

    // day 400: the mayor zones the last free strip. Neither the edit nor the day-28 scan publishes: the month tick does
    sim.runDays(40);
    expect(A.zone(STRIP, Zone.ComLow)).toMatchObject({ ok: true, affected: 448 });
    expect(freeLand(st)).toBe(0);
    expect(hasFlag(st)).toBe(false);
    sim.runDays(19);
    expect(advisorData(st).scan?.zone?.free, 'day 419: the scan of day 418 saw the full map').toBe(0);
    expect(hasFlag(st)).toBe(false);
    sim.runDays(1);
    expect(flagOf(st), 'day 420: the month tick').toBe(true);
    expect(st.history.builtOut.slice(12), 'months 13 and 14').toEqual([0, 1]);

    // day 720, the New Year after year 2: the map was full at the tick, so the year is graded on its unemployment, not
    // on its shrinking
    sim.runDays(300);
    expect(st.history.builtOut.slice(12)).toEqual([0, ...new Array(11).fill(1)]);
    const y2 = yearGradeInput(st.history, 24)!;
    expect(y2.builtOut).toBe(true);
    expect(y2.growth).toBeCloseTo(-0.06, 12);
    const g2 = yearGrade(y2);
    expect(g2.scores.growth).toBe(unemploymentScore(y2.unemployment));
    expect(g2.scores.growth).toBeCloseTo(75, 9);
    expect(growthScore(y2.growth)).toBe(0);
    // (the stat is a quarter of the grade)
    expect(g2.score - yearGrade({ ...y2, builtOut: false }).score).toBeCloseTo(0.25 * 75, 9);
    const card2 = buildYearReview(st, year(2))!;
    expect(card2.grade).toEqual(g2);
    expect(card2.pastGrades.map((p) => [p.year, p.grade.scores.growth])).toEqual([[year(0), 100], [year(1), g2.scores.growth]]);

    // day 760: the strip is dezoned. Land to zone again: the field goes at the next month tick, and the year that ends
    // with land left is graded on growth again
    sim.runDays(40);
    expect(A.dezone(STRIP)).toMatchObject({ ok: true, affected: 448 });
    expect(flagOf(st)).toBe(true);
    sim.runDays(20);
    expect(hasFlag(st), 'day 780: land left, no such field').toBe(false);
    expect(st.history.builtOut.slice(24), 'months 25 and 26').toEqual([1, 0]);
    sim.runDays(300);
    const y3 = yearGradeInput(st.history, 36)!;
    expect(y3.builtOut).toBe(false);
    expect(y3.growth).toBeCloseTo(0.04, 12);
    expect(yearGrade(y3).scores.growth).toBe(growthScore(y3.growth));
    expect(growthScore(y3.growth)).toBeCloseTo((100 * 0.09) / 0.13, 9);
    expect(unemploymentScore(y3.unemployment)).toBe(0);
    expect(buildYearReview(st, year(3))!.pastGrades.map((p) => p.grade.scores.growth)).toEqual([100, g2.scores.growth, growthScore(y3.growth)]);
  });

  it('land exhaustion and the built-out card stay distinct: a full map with weak demand has the flag and no card', () => {
    // (T054's stub `full: true, builtOut: false`, from the real producer: nobody wants in, so there is nothing to advise)
    const { st, sim } = play(town(false), (c) => { c.stats.population = 50000; c.stats.unemployment = 0.1; c.stats.demand.fill(0); });
    sim.runDays(360);
    expect(planning(st, 'builtOut')).toBeUndefined();
    expect(st.news.some((n) => /built out/i.test(n.text))).toBe(false);
    // (its unemployment advice knows there is no land to zone: that text is keyed on the free land alone, like the flag)
    expect(planning(st, 'unemployment')?.text).toBe('Unemployment is at 10%. There is almost no free land left: rezone low-value blocks to commercial or industrial land.');
    expect(flagOf(st)).toBe(true);
    expect(st.history.builtOut).toEqual(new Array(12).fill(1));
    const input = yearGradeInput(st.history, 12)!;
    expect(input.builtOut).toBe(true);
    expect(yearGrade(input).scores.growth).toBe(unemploymentScore(input.unemployment));
    expect([unemploymentScore(input.unemployment), growthScore(input.growth)]).toEqual([expect.closeTo(25, 9), 100]);
  });

  it('a built-out card the Advisors panel already shows publishes nothing: only the month tick writes the flag', () => {
    // (T054's stub `full: false, builtOut: true`, from the real producer: the card of the panel's own pass, between two
    // month ticks)
    const { st, sim, adv, A } = play(town(true), (c) => {
      c.stats.population = 50000; c.stats.unemployment = 0.09; c.stats.demand.fill(0); c.stats.demand[DevType.CS1] = 0.8;
    });
    sim.runDays(30);
    expect(planning(st, 'zoneC')?.text).toBe('Businesses want to open shops and offices — zone more commercial land.');
    expect(planning(st, 'builtOut')).toBeUndefined();
    expect(hasFlag(st)).toBe(false);
    sim.runDays(10);
    expect(A.zone(STRIP, Zone.ComLow).ok).toBe(true);
    // the panel reads the city as it is now (a scan of its own): the card is there …
    const before = structuredClone(st.systemData.advisors);
    expect(adv.openAdvice(st).some((a) => a.id === 'builtOut')).toBe(true);
    // … and the read left the saved record alone
    expect(st.systemData.advisors).toEqual(before);
    expect(hasFlag(st)).toBe(false);
    // the day-29 prediction runs the tick's rules on the saved scans, and writes nothing but its places
    sim.runDays(19);
    expect(advisorData(st).scan?.places).toBeDefined();
    const saved = structuredClone(st.systemData.advisors);
    adv.predictPlaces(st);
    expect(st.systemData.advisors).toEqual(saved);
    expect(hasFlag(st)).toBe(false);
    expect(st.history.builtOut).toEqual([0]);
    sim.runDays(1);
    expect(flagOf(st)).toBe(true);
    expect(st.history.builtOut).toEqual([0, 1]);
    expect(planning(st, 'builtOut')?.text).toMatch(/^Unemployment is at 9% and commercial demand is strong, but the city is built out: no free land is left\./);
    expect(planning(st, 'zoneC')).toBeUndefined();
  });

  it('a real economy: a bot city zones its last free land; the flag, the series and the grade follow, saved games continue bit for bit (T057), and an older save catches up at its month tick', { timeout: 300_000 }, () => {
    // the reader takes the tick's own value: the advisors run right before the history system
    const names = economySystems().map((s) => s.name);
    expect(names.indexOf('economy.history')).toBe(names.indexOf('economy.advisors') + 1);
    // T057: the advisors' record is ordinary saved state (written by the game, saved with every save), not one of the
    // continuity records a save hook writes and a lean recovery snapshot leaves out
    expect(CONTINUITY_RECORDS).not.toContain('advisors');

    // (without the rewards system: its init unlocks at once, and silently, a reward whose conditions were first met since
    // the last month tick, where the uninterrupted game unlocks it at the tick with its news. That difference after a load
    // is not this lane's: with the rewards, this town loads its day-388 save with the Mayor's House, which the game gives
    // on day 390. Reported in docs/dev/reports/local-T054b-builtout-producer.md)
    const economy = () => economySystems().filter((s) => s.name !== 'economy.rewards');
    const bot = new SimBot({ size: 48, years: 1, seed: 5, difficulty: 'medium', terrain: 'plains', water: 0.1, quiet: true, noInfra: true }, economy());
    bot.run(1);
    const sim = bot.sim, st = bot.st, t0 = st.day;
    expect(t0).toBe(360);
    expect(st.stats.population).toBeGreaterThan(500);
    expect(freeLand(st)).toBeGreaterThan(BUILT_OUT_FREE * st.cells);
    expect(hasFlag(st)).toBe(false);
    expect(st.history.builtOut).toEqual(new Array(12).fill(0));
    expect(yearGradeInput(st.history, 12)?.builtOut).toBe(false);

    // 1 January, year 2: the mayor zones every free tile for homes (a command a tile, as drags over odd land would)
    const A = new CityActions(sim);
    st.funds += 1e6;
    for (let z = 0; z < st.size; z++) for (let x = 0; x < st.size; x++) {
      const i = st.idx(x, z);
      if (st.zone[i] === Zone.None && st.building[i] < 0 && st.network[i] === Network.None && !st.water[i] && !st.powerLines[i]) {
        expect(A.zone({ x0: x, z0: z, x1: x + 1, z1: z + 1 }, Zone.ResLow).ok).toBe(true);
      }
    }
    expect(freeLand(st)).toBe(0);
    // … and on day 740 dezones every empty lot (in the uninterrupted game and in every loaded game that reaches the day)
    const freeDay = t0 + 380;
    const giveBack = (s: Simulation) => {
      expect(new CityActions(s).dezone({ x0: 0, z0: 0, x1: s.state.size, z1: s.state.size }).ok).toBe(true);
      expect(freeLand(s.state)).toBeGreaterThan(BUILT_OUT_FREE * s.state.cells);
    };
    // saves: before the first full scan (dom 3), on the scan days (28, 29), on the tick that publishes (30), with the flag
    // (dom 10), and five days before the land is given back
    const saveAt = [3, 28, 29, 30, 40, 375].map((d) => t0 + d);
    const end = t0 + 405;
    const saves = new Map<number, Uint8Array>();
    const want = new Map<number, Record<string, string>>();
    const flags: [number, boolean][] = [];
    let card: ReturnType<typeof buildYearReview> = null;
    sim.events.on('year', (y) => { card = buildYearReview(st, y); });
    while (st.day < end) {
      sim.advanceDay();
      if (st.day === freeDay) giveBack(sim);
      if (st.day % 30 === 0) flags.push([st.day, hasFlag(st)]);
      if (saveAt.includes(st.day)) saves.set(st.day, encodeBundle(serializeCity(st)));
      if (st.day >= saveAt[0]) want.set(st.day, digest(st));
    }
    // the flag from the first tick after the fill to the last one before the land came back; the series follows it
    expect(flags.map(([d, f]) => (f ? d : -d))).toEqual([390, 420, 450, 480, 510, 540, 570, 600, 630, 660, 690, 720, -750]);
    expect(flagOf(st)).toBeUndefined();
    expect(st.history.builtOut.slice(12)).toEqual([...new Array(12).fill(1), 0]);
    expect(st.stats.population).toBeGreaterThan(500);

    // the card of the second New Year (captured at the tick of day 720) is graded as a full city's. (This town grew all
    // year and has no unemployment, so either scoring gives its growth stat 100: the towns above tell the two apart; here
    // the real economy's own records lead the card to the built-out scoring)
    const input = yearGradeInput(st.history, 24)!;
    expect(input.builtOut).toBe(true);
    const grade = yearGrade(input);
    expect(grade.scores.growth).toBe(unemploymentScore(input.unemployment));
    const report = card as ReturnType<typeof buildYearReview>;
    expect(report?.year).toBe(st.config.startYear + 2);
    expect(report?.grade).toEqual(grade);
    expect(report?.pastGrades.map((p) => p.year)).toEqual([st.config.startYear, st.config.startYear + 1]);

    // T057: every save, loaded, equals the uninterrupted game right after the load and on each of the next 30 days
    for (const [day, bytes] of saves) {
      const copy = deserializeCity(decodeBundle(bytes) as SerializedCity);
      const sim2 = new Simulation(copy, economy());
      expect(hasFlag(copy), `save on day ${day}`).toBe(day >= 390);
      expect(differing(want.get(day)!, digest(copy)), `save on day ${day} (dom ${day % 30}): right after the load`).toEqual([]);
      for (let k = 0; k < 30; k++) {
        sim2.advanceDay();
        if (copy.day === freeDay) giveBack(sim2);
        expect(differing(want.get(copy.day)!, digest(copy)), `save on day ${day} (dom ${day % 30}): day ${copy.day}`).toEqual([]);
      }
    }

    // a save from before the flag (the day-400 save without it): only the advisors' record differs, until its next month
    // tick writes the flag ahead of the history's sample; from then on it is the uninterrupted game again
    const old = decodeBundle(saves.get(t0 + 40)!) as SerializedCity;
    expect(savedAdvisors(old).full).toBe(true);
    delete savedAdvisors(old).full;
    const loaded = deserializeCity(old);
    const sim3 = new Simulation(loaded, economy());
    expect(differing(want.get(t0 + 40)!, digest(loaded))).toEqual(['sd.advisors']);
    sim3.runDays(19);
    expect(differing(want.get(loaded.day)!, digest(loaded)), 'day 419').toEqual(['sd.advisors']);
    sim3.runDays(1);
    expect(flagOf(loaded)).toBe(true);
    expect(loaded.history.builtOut.at(-1)).toBe(1);
    expect(differing(want.get(loaded.day)!, digest(loaded)), 'day 420: the month tick').toEqual([]);

    // a lean recovery snapshot keeps the flag (it rides in the advisors' record, which is never left out)
    const base = decodeBundle(saves.get(t0 + 3)!) as SerializedCity, cur = decodeBundle(saves.get(t0 + 40)!) as SerializedCity;
    expect(savedAdvisors(base).full).toBeUndefined();
    const back = applyCityDelta(structuredClone(encodeCityDelta(cur, base, 1, { lean: true })), base);
    expect(savedAdvisors(back).full).toBe(true);
    expect(CONTINUITY_RECORDS.filter((k) => (back.data.systemData as Record<string, unknown>)[k] !== undefined)).toEqual([]);
  });

  it('on the packet host the replica mirrors the flag and the series, the card grades from them, and freed land takes the flag off the replica too', async () => {
    const st = town(false);
    st.config.name = 'Queensbury';
    const abort = new AbortController();
    const host = new LoopbackSimHost(st, { initialSpeed: 0, signal: abort.signal, loopback: { cadence: 'design', modules: {
      createSystems: () => pipeline((c) => { c.stats.population = 50000; c.stats.unemployment = 0.1; c.stats.demand.fill(0); }).systems,
      CityActions,
    } } });
    await host.start();
    const ui = new Emitter<UIEvents>(), scene = new FEl('div'), root = new FEl('div'), canvas = new FEl('canvas');
    scene.append(canvas, root);
    const ctx = { host, get state() { return host.state; }, ui, settings: { ...DEFAULT_SETTINGS }, signal: abort.signal, root, canvas } as unknown as GameContext;
    new YearReview(ctx, { busy: () => false });
    try {
      await host.drain();
      ui.emit('viewsReady', undefined);
      for (let month = 0; month < 12; month++) { host.harness.runDays(30); await host.drain(); }
      const replica = host.state, primary = host.harness.primary;
      expect(replica).not.toBe(primary);
      expect(flagOf(primary)).toBe(true);
      expect(flagOf(replica)).toBe(true);
      expect(replica.history.builtOut).toEqual(new Array(12).fill(1));
      expect(exactDigest(replica)).toBe(exactDigest(host.harness.delivered));
      const year = primary.config.startYear + 1;
      const report = buildYearReview(replica, year)!;
      expect(report).toEqual(buildYearReview(primary, year));
      expect(report.grade?.scores.growth).toBeCloseTo(25, 9);
      // the card opened on 1 January, from the replica: its grade row carries the unemployment score as the growth stat
      const card = root.querySelector('.year-review')!;
      expect(textOf(card)).toContain(`Queensbury Gazette — ${year}`);
      const row = card.querySelector('.yr-grade')!;
      expect(row.title).toContain('growth: 25.0');
      expect(textOf(row)).toContain(`${report.grade!.letter}${report.grade!.score.toFixed(1)} / 100`);
      // the mayor dezones the last strip (a command to the core): at the next month tick the field leaves the core's
      // record, and the replica's with it
      host.actions.dezone(STRIP);
      await host.drain();
      expect(freeLand(primary)).toBe(447);
      host.harness.runDays(30);
      await host.drain();
      expect([hasFlag(primary), hasFlag(replica)]).toEqual([false, false]);
      expect(replica.history.builtOut).toEqual([...new Array(12).fill(1), 0]);
      expect(exactDigest(replica)).toBe(exactDigest(host.harness.delivered));
    } finally { abort.abort('dispose'); await host.dispose(); }
  }, 60_000);
});
