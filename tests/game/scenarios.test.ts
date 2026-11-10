/**
 * LG-14: the scenarios' objectives and medals (src/game/scenarios.ts).
 * - Boomtown: 50k / 100k / 150k residents by the end of year 10, decided on the monthly history samples of the window.
 * - Lights Out: back to 70,000 residents and 60% approval within 12 / 9 / 6 months; gold also needs no new loan.
 * - Smog City: the 12-month average air pollution at homes 40% below the year before, with 180,000 residents in the month
 *   the air goal is met, within 10 / 5 / 2 years (the lead's tiers and reading, NOTE-104).
 * - Evaluation is a pure function of mirrored state: it changes nothing, needs no simulation and no random number.
 * - The profile keeps the best medal per scenario and each scenario city's outcome (medals persist across reloads).
 * - The Mayor's challenges as the dialog and the card show them.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOOMTOWN, CHALLENGE_BADGE_NOTE, CHALLENGE_INFO, LIGHTS_OUT, MEDALS, NEW_CITY_DAY, SCENARIOS, SCENARIO_IDS, SCENARIO_LAND, SCENARIO_LIST,
  SMOG_CITY, airCut, applyChallenges, boomtownConfig, challengeStatus, challengesSummary, evaluateScenario, hasNewLoan, loadMedals,
  loadScenarioRun, medalRank, recordScenarioRun, resultText, runKey, scenarioOf, type ScenarioMemo, type ScenarioStart, type ScenarioState,
} from '../../src/game/scenarios';
import { DIFFICULTY_FUNDS, defaultCityConfig } from '../../src/sim/config';
import { CHALLENGE_BADGE_POP, FREQUENT_DISASTERS, MAYOR_CHALLENGES } from '../../src/sim/economy/challenges';
import { difficultyRules } from '../../src/sim/economy/tuning';

// ------------------------------------------------------------------------------------------------ synthetic cities
interface Month { pop: number; approval?: number; air?: number }

/**
 * A city as an evaluation reads it: `before` monthly samples up to and including the start month, then one sample per
 * scenario month. The day is the last sample's (the month's first day), as on the host's 'month' event.
 */
function city(start: ScenarioStart, months: Month[], opts: { before?: Month[]; loans?: [number, number][]; cur?: number; last?: number } = {}): ScenarioState {
  const m0 = Math.floor(start.startDay / 30), before = opts.before ?? [];
  const all = [...before, ...months];
  const t = all.map((_, k) => m0 - before.length + 1 + k);
  const lastT = months.length ? m0 + months.length : m0;
  const now = all.at(-1);
  return {
    day: lastT * 30,
    stats: { population: now?.pop ?? 0, approval: now?.approval ?? 50 },
    history: { t, pop: all.map((m) => m.pop), approval: all.map((m) => m.approval ?? 50), air: all.map((m) => m.air ?? 0) },
    budget: {
      loans: (opts.loans ?? []).map(([principal, rate]) => ({ principal, rate, remaining: principal, monthlyPayment: 1, monthsLeft: 60 })),
      curIncome: opts.cur ? { 'oneoff:loan': opts.cur } : {}, lastIncome: opts.last ? { 'oneoff:loan': opts.last } : {},
    },
  } as unknown as ScenarioState;
}
const repeat = (n: number, m: Month): Month[] => Array.from({ length: n }, () => ({ ...m }));

// ------------------------------------------------------------------------------------------------ Boomtown
describe('LG-14 Boomtown', () => {
  const start: ScenarioStart = { id: 'boomtown', startDay: NEW_CITY_DAY };

  it('a new city is active with every medal in reach and nothing secured', () => {
    const s = evaluateScenario(start, city(start, []));
    expect(s).toMatchObject({ id: 'boomtown', phase: 'active', medal: null, reach: 'gold', month: 0, months: 120, result: null, clock: 'Year 1 of 10' });
    expect(s.lines[0]).toEqual({ label: 'Residents', value: '0 / 50,000', progress: 0, done: false });
    expect(s.lines.slice(1).map((l) => [l.label, l.value, l.done])).toEqual([
      ['Bronze', '50,000 residents', false], ['Silver', '100,000 residents', false], ['Gold', '150,000 residents', false],
    ]);
  });

  it('a medal is secured the month its residents are reached and stays the scenario\'s medal; the next one is the goal', () => {
    const s = evaluateScenario(start, city(start, [...repeat(29, { pop: 40_000 }), { pop: 50_000 }]));
    expect(s).toMatchObject({ phase: 'active', medal: 'bronze', reach: 'gold', month: 30, result: null, clock: 'Year 3 of 10' });
    expect(s.lines[0].value).toBe('50,000 / 100,000');
    expect(s.lines[1].done).toBe(true);
    // the city shrinks again: the secured medal stays
    const later = evaluateScenario(start, city(start, [...repeat(29, { pop: 40_000 }), { pop: 50_000 }, ...repeat(10, { pop: 30_000 })]));
    expect(later).toMatchObject({ phase: 'active', medal: 'bronze' });
    expect(later.lines[0].value).toBe('30,000 / 100,000');
  });

  it('gold ends the scenario at once, with the month it was reached', () => {
    const s = evaluateScenario(start, city(start, [...repeat(79, { pop: 120_000 }), { pop: 150_000 }, { pop: 151_000 }]));
    expect(s).toMatchObject({ phase: 'won', medal: 'gold', reach: null, result: { medal: 'gold', month: 80 } });
  });

  it('the end of year 10 decides: the best month of the window counts, a later one does not', () => {
    const at = (months: Month[]) => evaluateScenario(start, city(start, months));
    expect(at(repeat(120, { pop: 99_729 }))).toMatchObject({ phase: 'won', medal: 'bronze', result: { medal: 'bronze', month: 120 } });
    expect(at([...repeat(60, { pop: 100_000 }), ...repeat(60, { pop: 80_000 })])).toMatchObject({ phase: 'won', medal: 'silver' });
    expect(at(repeat(120, { pop: 49_999 }))).toMatchObject({ phase: 'lost', medal: null, reach: null, result: { medal: null, month: 120 } });
    // month 119: still open; the sample of month 120 is the last that counts
    expect(at(repeat(119, { pop: 49_999 }))).toMatchObject({ phase: 'active', result: null, clock: 'Year 10 of 10' });
    expect(at([...repeat(119, { pop: 10_000 }), { pop: 50_000 }])).toMatchObject({ phase: 'won', medal: 'bronze' });
    expect(at([...repeat(120, { pop: 10_000 }), { pop: 60_000 }])).toMatchObject({ phase: 'lost', result: { medal: null, month: 120 } });
  });

  it('the bot\'s city, founded on day 0, counts its own ten years', () => {
    const bot: ScenarioStart = { id: 'boomtown', startDay: 0 };
    expect(evaluateScenario(bot, city(bot, repeat(120, { pop: 60_000 })))).toMatchObject({ phase: 'won', medal: 'bronze', month: 120 });
  });

  it('is founded on the scenario land with the scenario\'s money, on the day new cities start', () => {
    const cfg = boomtownConfig();
    expect(cfg).toMatchObject({ ...SCENARIO_LAND, difficulty: 'medium', startFunds: BOOMTOWN.funds, sandbox: false, scenario: { id: 'boomtown', startDay: NEW_CITY_DAY } });
    expect(BOOMTOWN.funds).toBe(DIFFICULTY_FUNDS.medium);
    // main.ts founds every new city on FOUNDING_DAY (the App boots on import, so its source is read)
    expect(readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')).toMatch(new RegExp(`const FOUNDING_DAY = ${NEW_CITY_DAY};`));
  });
});

// ------------------------------------------------------------------------------------------------ Lights Out
describe('LG-14 Lights Out', () => {
  const LOANS: [number, number][] = [[60_000, 0.05], [60_000, 0.060000000000000005]];
  const start: ScenarioStart = { id: 'lights_out', startDay: 2910, loans: LOANS };
  const startMonth: Month = { pop: 71_043, approval: 62 };
  const back: Month = { pop: 72_282, approval: 64 };
  const dark: Month = { pop: 39_533, approval: 48 };
  const run = (months: Month[], opts: Parameters<typeof city>[2] = {}, memo: ScenarioMemo = {}) =>
    evaluateScenario(start, city(start, months, { before: [startMonth], loans: LOANS, ...opts }), memo);

  it('the city as it stands at the start is not "back": only the months after it count', () => {
    const s = run([]);
    expect(s).toMatchObject({ phase: 'active', medal: null, reach: 'gold', month: 0, months: 12, result: null, newLoan: false, clock: 'Month 1 of 12' });
    expect(s.lines.map((l) => [l.label, l.value, l.done])).toEqual([
      ['Residents', '71,043 / 70,000', true], ['Approval', '62% / 60%', true], ['No new loan', 'Kept (gold needs it)', true],
    ]);
  });

  it('gold within 6 months, silver within 9, bronze within 12, by the first month both figures are back', () => {
    const at = (m: number) => run([...repeat(m - 1, dark), back]);
    for (const m of [1, 6]) expect(at(m)).toMatchObject({ phase: 'won', medal: 'gold', result: { medal: 'gold', month: m } });
    for (const m of [7, 9]) expect(at(m)).toMatchObject({ phase: 'won', medal: 'silver', result: { medal: 'silver', month: m } });
    for (const m of [10, 12]) expect(at(m)).toMatchObject({ phase: 'won', medal: 'bronze', result: { medal: 'bronze', month: m } });
    // the first such month decides, whatever follows
    expect(run([dark, back, dark, dark]).result).toEqual({ medal: 'gold', month: 2 });
  });

  it('twelve months without both figures: lost; a recovery in month 13 is too late', () => {
    expect(run(repeat(11, dark))).toMatchObject({ phase: 'active', reach: 'bronze', clock: 'Month 12 of 12' });
    expect(run(repeat(12, dark))).toMatchObject({ phase: 'lost', medal: null, result: { medal: null, month: 12 } });
    expect(run([...repeat(12, dark), back])).toMatchObject({ phase: 'lost', result: { medal: null, month: 12 } });
  });

  it('both figures are needed in the same month, at their thresholds', () => {
    expect(run([{ pop: 69_999, approval: 70 }]).phase).toBe('active');
    expect(run([{ pop: 80_000, approval: 59 }]).phase).toBe('active');
    expect(run([{ pop: LIGHTS_OUT.residents, approval: LIGHTS_OUT.approval }]).result).toEqual({ medal: 'gold', month: 1 });
    expect(run([{ pop: 80_000, approval: 59 }, { pop: 69_000, approval: 61 }, { pop: 70_000, approval: 60 }]).result).toEqual({ medal: 'gold', month: 3 });
  });

  it('a new loan costs gold: the same recovery is silver', () => {
    const borrowed: [number, number][] = [...LOANS, [13_000, 0.07]];
    const s = run([back], { loans: borrowed });
    expect(s).toMatchObject({ phase: 'won', medal: 'silver', newLoan: true, result: { medal: 'silver', month: 1 } });
    expect(s.lines[2]).toMatchObject({ value: 'A loan was taken: silver at best', done: false });
    // silver and bronze times are not touched by the loan
    expect(run([...repeat(8, dark), back], { loans: borrowed }).medal).toBe('silver');
    expect(run([...repeat(10, dark), back], { loans: borrowed }).medal).toBe('bronze');
  });

  it('the best medal still in reach follows the month and the loan', () => {
    expect(run(repeat(5, dark)).reach).toBe('gold');
    expect(run(repeat(6, dark)).reach).toBe('silver');
    expect(run(repeat(8, dark)).reach).toBe('silver');
    expect(run(repeat(9, dark)).reach).toBe('bronze');
    expect(run(repeat(2, dark), { loans: [...LOANS, [5000, 0.07]] }).reach).toBe('silver');
  });

  it('tells a new loan from the loans the city started with', () => {
    expect(hasNewLoan(LOANS, [{ principal: 60_000, rate: 0.05 }, { principal: 60_000, rate: 0.060000000000000005 }])).toBe(false);
    // order does not matter; a start loan paid off leaves the others as they were
    expect(hasNewLoan(LOANS, [{ principal: 60_000, rate: 0.060000000000000005 }, { principal: 60_000, rate: 0.05 }])).toBe(false);
    expect(hasNewLoan(LOANS, [{ principal: 60_000, rate: 0.05 }])).toBe(false);
    expect(hasNewLoan(LOANS, [])).toBe(false);
    // another amount, another rate, or one more of a kind the city had once
    expect(hasNewLoan(LOANS, [{ principal: 60_000, rate: 0.05 }, { principal: 30_000, rate: 0.07 }])).toBe(true);
    expect(hasNewLoan(LOANS, [{ principal: 60_000, rate: 0.07 }])).toBe(true);
    expect(hasNewLoan(LOANS, [{ principal: 60_000, rate: 0.05 }, { principal: 60_000, rate: 0.05 }])).toBe(true);
    expect(hasNewLoan(undefined, [{ principal: 5000, rate: 0.05 }])).toBe(true);
    expect(hasNewLoan(undefined, [])).toBe(false);
  });

  it('a loan taken and repaid is still a new loan: its proceeds show in the month\'s ledger, and the profile remembers', () => {
    // taken this month (not yet in a closed ledger)
    expect(run([dark], { cur: 20_000 }).newLoan).toBe(true);
    // taken last month and repaid: the closed month's ledger has it
    expect(run([dark, dark], { last: 20_000 }).newLoan).toBe(true);
    // the ledger of the month before the start is not the scenario's
    expect(run([], { last: 20_000 }).newLoan).toBe(false);
    // months later nothing in the city shows it: the memo does, and gold stays out of reach
    expect(run([dark, dark, back])).toMatchObject({ newLoan: false, medal: 'gold' });
    expect(run([dark, dark, back], {}, { newLoan: true })).toMatchObject({ newLoan: true, medal: 'silver', result: { medal: 'silver', month: 3 } });
  });

  it('a decided outcome stands: later months, loans or a collapse do not change it', () => {
    const won: ScenarioMemo = { result: { medal: 'gold', month: 4 } };
    const later = run([...repeat(3, dark), back, ...repeat(6, dark)], { loans: [...LOANS, [50_000, 0.07]] }, won);
    expect(later).toMatchObject({ phase: 'won', medal: 'gold', reach: null, result: { medal: 'gold', month: 4 } });
    const lostMemo: ScenarioMemo = { result: { medal: null, month: 12 } };
    expect(run([...repeat(12, dark), ...repeat(5, back)], {}, lostMemo)).toMatchObject({ phase: 'lost', medal: null, result: { medal: null, month: 12 } });
  });
});

// ------------------------------------------------------------------------------------------------ Smog City
describe('LG-14 Smog City', () => {
  const start: ScenarioStart = { id: 'smog_city', startDay: 5400, air: 0.08 };
  const yearBefore = repeat(12, { pop: 190_000, air: 0.08 });
  const run = (months: Month[]) => evaluateScenario(start, city(start, months, { before: yearBefore }));
  const clean: Month = { pop: 190_000, air: 0.04 }, dirty: Month = { pop: 190_000, air: 0.08 };

  it('measures the average of the last 12 months against the year before the start', () => {
    const st = city(start, repeat(6, clean), { before: yearBefore });
    // six months at half the pollution: the 12-month average is a quarter down
    expect(airCut(start, st)).toBeCloseTo(0.25, 9);
    const s = evaluateScenario(start, st);
    expect(s).toMatchObject({ phase: 'active', medal: null, reach: 'gold', month: 6, months: 120, clock: 'Year 1 of 10' });
    expect(s.lines.map((l) => [l.label, l.value, l.done])).toEqual([['Air pollution at homes', '−25% / −40%', false], ['Residents', '190,000 / 180,000', true]]);
    expect(s.lines[0].progress).toBeCloseTo(0.625, 9);
    // dirtier than before reads as a plus
    expect(evaluateScenario(start, city(start, repeat(12, { pop: 190_000, air: 0.1 }), { before: yearBefore })).lines[0].value).toBe('+25% / −40%');
    expect(run([]).lines[0].value).toBe('0% / −40%');
  });

  it('is won the first month the average is 40% down with 180,000 residents in the city', () => {
    // half the pollution from month 1: 9 months give 37.5%, 10 give 41.7%
    expect(run(repeat(9, clean)).phase).toBe('active');
    expect(run(repeat(10, clean))).toMatchObject({ phase: 'won', medal: 'gold', result: { medal: 'gold', month: 10 } });
    // too few residents that month: not yet
    const thin = [...repeat(9, clean), { pop: SMOG_CITY.residents - 1, air: 0.04 }];
    expect(run(thin).phase).toBe('active');
    expect(run([...thin, { pop: SMOG_CITY.residents, air: 0.04 }]).result).toEqual({ medal: 'gold', month: 11 });
    // exactly 40% counts (12 months at 60% of the start)
    expect(run(repeat(12, { pop: 190_000, air: 0.048 })).phase).toBe('won');
    // ... also where the division itself lands a hair under 0.4 (0.06 against 0.1 gives 0.3999999999999998)
    const tenth: ScenarioStart = { ...start, air: 0.1 };
    const st = city(tenth, repeat(12, { pop: 190_000, air: 0.06 }), { before: repeat(12, { pop: 190_000, air: 0.1 }) });
    expect(airCut(tenth, st)).toBeLessThan(SMOG_CITY.cut);
    const s = evaluateScenario(tenth, st);
    expect(s).toMatchObject({ phase: 'won', result: { medal: 'gold', month: 12 } });
    expect(s.lines[0]).toMatchObject({ value: '−40% / −40%', done: true });
    // one month short of that average is still short
    expect(evaluateScenario(tenth, city(tenth, repeat(11, { pop: 190_000, air: 0.06 }), { before: repeat(12, { pop: 190_000, air: 0.1 }) })).phase).toBe('active');
  });

  it('gold within 2 years, silver within 5, bronze within 10; ten years without it: lost', () => {
    expect(SMOG_CITY.months).toEqual({ bronze: 120, silver: 60, gold: 24 });
    // (ten clean months after the dirty ones bring the 12-month average 40% down: the goal falls in month dirty + 10)
    const at = (m: number) => run([...repeat(m - 12, dirty), ...repeat(12, clean)]);
    expect(at(24).result).toEqual({ medal: 'gold', month: 22 });
    expect(run([...repeat(14, dirty), ...repeat(12, clean)]).result).toEqual({ medal: 'gold', month: 24 });
    expect(run([...repeat(15, dirty), ...repeat(12, clean)]).result).toEqual({ medal: 'silver', month: 25 });
    expect(run([...repeat(50, dirty), ...repeat(12, clean)]).result).toEqual({ medal: 'silver', month: 60 });
    expect(run([...repeat(51, dirty), ...repeat(12, clean)]).result).toEqual({ medal: 'bronze', month: 61 });
    expect(run([...repeat(110, dirty), ...repeat(10, clean)]).result).toEqual({ medal: 'bronze', month: 120 });
    // the card's best medal still in reach: the next month's sample decides
    expect(run(repeat(23, dirty))).toMatchObject({ phase: 'active', reach: 'gold', clock: 'Year 2 of 10' });
    expect(run(repeat(24, dirty))).toMatchObject({ phase: 'active', reach: 'silver', clock: 'Year 3 of 10' });
    expect(run(repeat(59, dirty))).toMatchObject({ phase: 'active', reach: 'silver' });
    expect(run(repeat(60, dirty))).toMatchObject({ phase: 'active', reach: 'bronze' });
    expect(run(repeat(119, dirty))).toMatchObject({ phase: 'active', reach: 'bronze', clock: 'Year 10 of 10' });
    expect(run(repeat(120, dirty))).toMatchObject({ phase: 'lost', result: { medal: null, month: 120 } });
    expect(run([...repeat(111, dirty), ...repeat(12, clean)])).toMatchObject({ phase: 'lost', result: { medal: null, month: 120 } });
  });

  it('a save with less than a year of history, or no baseline, is never judged clean', () => {
    const short = city(start, repeat(5, clean), { before: repeat(3, { pop: 190_000, air: 0.08 }) });
    expect(airCut(start, short)).toBeNull();
    expect(evaluateScenario(start, short).phase).toBe('active');
    const noBase: ScenarioStart = { id: 'smog_city', startDay: 5400 };
    expect(evaluateScenario(noBase, city(noBase, repeat(24, { pop: 190_000, air: 0 }), { before: yearBefore })).phase).toBe('active');
  });
});

// ------------------------------------------------------------------------------------------------ purity and texts
describe('LG-14 evaluation', () => {
  it('reads the city and changes nothing: a frozen state gives the same answer, and no simulation is asked', () => {
    const start: ScenarioStart = { id: 'lights_out', startDay: 2910, loans: [[60_000, 0.05]] };
    const freeze = <T>(o: T): T => { if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); } return o; };
    const months = [{ pop: 40_000, approval: 50 }, { pop: 71_000, approval: 61 }];
    const open = city(start, months, { loans: [[60_000, 0.05]] });
    const frozen = freeze(city(start, months, { loans: [[60_000, 0.05]] }));
    const memo = freeze<ScenarioMemo>({});
    const before = JSON.stringify(open);
    const a = evaluateScenario(start, open), b = evaluateScenario(freeze({ ...start }), frozen, memo);
    expect(JSON.stringify(open)).toBe(before);
    expect(b).toEqual(a);
    expect(a.result).toEqual({ medal: 'gold', month: 2 });
    // the state it read has no simulation, no systems and no random stream to reach
    expect(Object.keys(open).sort()).toEqual(['budget', 'day', 'history', 'stats']);
  });

  it('knows its scenarios; a record of an unknown one (a save from another build) is free play', () => {
    expect(SCENARIO_IDS).toEqual(['boomtown', 'lights_out', 'smog_city']);
    expect(SCENARIO_LIST.map((s) => [s.id, s.start, s.months])).toEqual([['boomtown', 'found', 120], ['lights_out', 'bundle', 12], ['smog_city', 'bundle', 120]]);
    expect(scenarioOf({})).toBeNull();
    expect(scenarioOf({ scenario: { id: 'boomtown', startDay: 90 } })).toEqual({ id: 'boomtown', startDay: 90 });
    expect(scenarioOf({ scenario: { id: 'gridlock', startDay: 0 } as unknown as ScenarioStart })).toBeNull();
    expect(scenarioOf({ scenario: { id: 'boomtown' } as unknown as ScenarioStart })).toBeNull();
    expect(scenarioOf(defaultCityConfig())).toBeNull();
  });

  it('the briefings and goals quote the figures the judging uses', () => {
    const { boomtown, lights_out, smog_city } = SCENARIOS;
    expect(boomtown.brief).toContain('§100,000');
    expect(boomtown.tagline).toBe('Empty land and §100k');
    expect(boomtown.goals).toEqual({ bronze: '50,000 residents by year 10', silver: '100,000 residents', gold: '150,000 residents' });
    expect(lights_out.brief).toContain('§15,000');
    expect(lights_out.brief).toContain('70,000 residents and 60% approval');
    expect(lights_out.goals).toEqual({ bronze: 'Within 12 months', silver: 'Within 9 months', gold: 'Within 6 months, without a new loan' });
    expect(smog_city.brief).toContain('by 40%');
    // (the lead's reading: the floor holds in the month the air goal is met, not at every moment)
    expect(smog_city.brief).toContain('180,000 residents in the month the air goal is met');
    expect(smog_city.goals).toEqual({ bronze: 'Within 10 years', silver: 'Within 5 years', gold: 'Within 2 years' });
    for (const s of SCENARIO_LIST) for (const m of MEDALS) expect(s.goals[m].length).toBeGreaterThan(5);
  });

  it('says how a scenario ended', () => {
    expect(resultText('boomtown', { medal: 'bronze', month: 120 })).toBe('Boomtown reached 50,000 residents by year 10.');
    expect(resultText('boomtown', { medal: 'gold', month: 96 })).toBe('Boomtown reached 150,000 residents in 8 years.');
    expect(resultText('boomtown', { medal: null, month: 120 })).toBe('Year 10 is over and the city has not reached 50,000 residents.');
    expect(resultText('lights_out', { medal: 'gold', month: 5 })).toBe('The city is back at 70,000 residents and 60% approval after 5 months, without a new loan.');
    expect(resultText('lights_out', { medal: 'silver', month: 1 }, true)).toBe('The city is back at 70,000 residents and 60% approval after 1 month, with a new loan.');
    expect(resultText('lights_out', { medal: 'silver', month: 8 })).toBe('The city is back at 70,000 residents and 60% approval after 8 months.');
    expect(resultText('lights_out', { medal: null, month: 12 })).toBe('12 months on, the city has not come back to 70,000 residents and 60% approval.');
    expect(resultText('smog_city', { medal: 'gold', month: 10 })).toBe('Air pollution at homes is down 40% after 10 months, and 180,000 residents still live here.');
    expect(resultText('smog_city', { medal: 'silver', month: 40 })).toBe('Air pollution at homes is down 40% after 3 years and 4 months, and 180,000 residents still live here.');
    expect(resultText('smog_city', { medal: null, month: 120 })).toBe('10 years on, the air at homes is not 40% cleaner with 180,000 residents in the city.');
  });
});

// ------------------------------------------------------------------------------------------------ the profile
describe('LG-14 medals in the profile', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a fresh profile has no medal and has seen no scenario city', () => {
    expect(loadMedals()).toEqual({});
    expect(loadScenarioRun('r1:6_6')).toBeNull();
    expect(challengesSummary()).toBe('3 scenarios · no medal yet');
  });

  it('a won scenario is a medal that is there after a reload', () => {
    expect(recordScenarioRun('r1:6_6', 'lights_out', { result: { medal: 'silver', month: 7 } }, 1000)).toBe(true);
    // (a reload: nothing but the storage survives, and every read goes to it)
    expect(JSON.parse(store.get('metropolis.ui.scenarios')!)).toMatchObject({ medals: { lights_out: { medal: 'silver', month: 7, at: 1000 } } });
    expect(loadMedals()).toEqual({ lights_out: { medal: 'silver', month: 7, at: 1000 } });
    expect(loadScenarioRun('r1:6_6')).toEqual({ result: { medal: 'silver', month: 7 } });
    expect(challengesSummary()).toBe('3 scenarios · 1 medal');
  });

  it('keeps the best medal per scenario: a better medal or a faster run replaces it, a worse one does not', () => {
    recordScenarioRun('a', 'smog_city', { result: { medal: 'silver', month: 40 } }, 1);
    expect(recordScenarioRun('b', 'smog_city', { result: { medal: 'bronze', month: 80 } }, 2)).toBe(false);
    expect(loadMedals().smog_city).toMatchObject({ medal: 'silver', month: 40 });
    expect(recordScenarioRun('c', 'smog_city', { result: { medal: 'silver', month: 38 } }, 3)).toBe(true);
    expect(recordScenarioRun('d', 'smog_city', { result: { medal: 'silver', month: 39 } }, 4)).toBe(false);
    expect(loadMedals().smog_city).toMatchObject({ medal: 'silver', month: 38 });
    expect(recordScenarioRun('e', 'smog_city', { result: { medal: 'gold', month: 20 } }, 5)).toBe(true);
    expect(loadMedals().smog_city).toEqual({ medal: 'gold', month: 20, at: 5 });
    // a lost run is remembered as that city's outcome, and takes no medal away
    expect(recordScenarioRun('f', 'smog_city', { result: { medal: null, month: 120 } }, 6)).toBe(false);
    expect(loadScenarioRun('f')).toEqual({ result: { medal: null, month: 120 } });
    expect(loadMedals().smog_city?.medal).toBe('gold');
    expect(challengesSummary()).toBe('3 scenarios · 1 medal');
    recordScenarioRun('g', 'boomtown', { result: { medal: 'bronze', month: 120 } }, 7);
    expect(challengesSummary()).toBe('3 scenarios · 2 medals');
  });

  it('a scenario city\'s outcome is recorded once, and a loan stays remembered', () => {
    recordScenarioRun('r:1_1', 'lights_out', {}, 1);
    expect(loadScenarioRun('r:1_1')).toEqual({});
    recordScenarioRun('r:1_1', 'lights_out', { newLoan: true }, 2);
    recordScenarioRun('r:1_1', 'lights_out', {}, 3);
    expect(loadScenarioRun('r:1_1')).toEqual({ newLoan: true });
    expect(recordScenarioRun('r:1_1', 'lights_out', { newLoan: true, result: { medal: 'silver', month: 2 } }, 4)).toBe(true);
    // recorded again (a second evaluation, a better-looking one): the first outcome stands and is no new best
    expect(recordScenarioRun('r:1_1', 'lights_out', { result: { medal: 'gold', month: 1 } }, 5)).toBe(false);
    expect(loadScenarioRun('r:1_1')).toEqual({ newLoan: true, result: { medal: 'silver', month: 2 } });
    expect(loadMedals().lights_out).toMatchObject({ medal: 'silver', month: 2 });
  });

  it('remembers the latest 40 scenario cities; the medals are kept regardless', () => {
    recordScenarioRun('first', 'boomtown', { result: { medal: 'gold', month: 100 } }, 1);
    for (let k = 0; k < 40; k++) recordScenarioRun(`run${k}`, 'boomtown', {}, 10 + k);
    expect(loadScenarioRun('first')).toBeNull();
    expect(loadScenarioRun('run0')).toEqual({});
    expect(loadScenarioRun('run39')).toEqual({});
    expect(loadMedals().boomtown?.medal).toBe('gold');
  });

  it('ignores what it cannot read: another shape, an unknown scenario, a damaged value', () => {
    store.set('metropolis.ui.scenarios', '{not json');
    expect(loadMedals()).toEqual({});
    store.set('metropolis.ui.scenarios', JSON.stringify({
      medals: { boomtown: { medal: 'platinum', month: 3 }, gridlock: { medal: 'gold', month: 3 }, smog_city: { medal: 'gold', month: 12, at: 9 }, lights_out: 'gold' },
      runs: { a: { id: 'gridlock', result: { medal: 'gold', month: 1 } }, b: { id: 'boomtown', result: { medal: 'tin', month: 1 }, newLoan: 'yes' }, c: 7 },
    }));
    expect(loadMedals()).toEqual({ smog_city: { medal: 'gold', month: 12, at: 9 } });
    expect(loadScenarioRun('a')).toBeNull();
    expect(loadScenarioRun('b')).toEqual({});
    expect(loadScenarioRun('c')).toBeNull();
    store.set('metropolis.ui.scenarios', JSON.stringify([1, 2]));
    expect(loadMedals()).toEqual({});
    // and storage that throws (private mode) is a profile without medals, not an error
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(loadMedals()).toEqual({});
    expect(() => recordScenarioRun('x', 'boomtown', { result: { medal: 'gold', month: 1 } })).not.toThrow();
  });

  it('names a scenario city by its region and tile', () => {
    expect(runKey({ regionId: 'r9', tileX: 6, tileZ: 4, name: 'Ashbury', seed: 7 })).toBe('r9:6_4');
    expect(runKey({ name: 'Ashbury', seed: 7 })).toBe('city:Ashbury:7');
    expect(medalRank(null)).toBe(0);
    expect(MEDALS.map(medalRank)).toEqual([1, 2, 3]);
  });
});

// ------------------------------------------------------------------------------------------------ Mayor's challenges
describe('LG-14 Mayor\'s challenges in the game', () => {
  it('names every challenge with its rule, quoting the simulation\'s own numbers', () => {
    expect(Object.keys(CHALLENGE_INFO)).toEqual([...MAYOR_CHALLENGES]);
    expect(CHALLENGE_INFO.noLoans.name).toBe('No loans');
    expect(CHALLENGE_INFO.noDirtyIndustry.rule).toContain('I-D');
    expect(CHALLENGE_INFO.frequentDisasters.rule).toBe(`Tornadoes, quakes and meteors strike ${FREQUENT_DISASTERS === 2 ? 'twice' : `${FREQUENT_DISASTERS} times`} as often.`);
    // Hard money is all of Hard's money rules (NOTE-104): the funds, the tax income, the running costs and the removal
    expect(CHALLENGE_INFO.hardMoney.rule).toBe('Hard\'s money on any difficulty: §40k to start, 15% less tax income, services cost 15% more to run, and the council removes you after 12 months in debt.');
    expect(difficultyRules('hard')).toMatchObject({ income: 0.85, opexMultiplier: 1.15, bankruptRemovalMonths: 12 });
    expect(DIFFICULTY_FUNDS.hard).toBe(40_000);
    expect(CHALLENGE_BADGE_NOTE).toBe(`Each challenge earns its badge on the region card once the city reaches ${CHALLENGE_BADGE_POP.toLocaleString('en-US')} residents.`);
  });

  it('applies the dialog\'s picks to a city config', () => {
    const cfg = defaultCityConfig({ difficulty: 'easy', disasters: false });
    // none picked: the config is the same, without the key
    const none = applyChallenges(cfg, []);
    expect(none).toEqual(cfg);
    expect(Object.hasOwn(none, 'challenges')).toBe(false);
    expect(applyChallenges(cfg, ['noLoans'])).toEqual({ ...cfg, challenges: ['noLoans'] });
    // Hard money: Hard's starting funds; Frequent disasters: disasters on; the list in the table's order
    expect(applyChallenges(cfg, ['hardMoney', 'frequentDisasters', 'noLoans'])).toEqual({
      ...cfg, challenges: ['noLoans', 'frequentDisasters', 'hardMoney'], startFunds: DIFFICULTY_FUNDS.hard, disasters: true,
    });
    expect(cfg.startFunds).toBe(DIFFICULTY_FUNDS.easy);
    // Sandbox takes none
    const sandbox = defaultCityConfig({ difficulty: 'sandbox' });
    expect(applyChallenges(sandbox, ['hardMoney', 'noLoans'])).toEqual(sandbox);
    expect(applyChallenges({ ...cfg, challenges: ['noLoans'] }, [])).toEqual(cfg);
  });

  it('reports a city\'s challenges and how far their badges are; a city without any has no status', () => {
    const st = (pop: number, past: number[] = [], challenges?: string[]) => ({
      config: { ...defaultCityConfig(), challenges }, stats: { population: pop }, history: { pop: past },
    }) as unknown as Parameters<typeof challengeStatus>[0];
    expect(challengeStatus(st(1000))).toBeNull();
    expect(challengeStatus(st(1000, [], []))).toBeNull();
    const young = challengeStatus(st(12_340, [500, 9000], ['hardMoney', 'noLoans']))!;
    expect(young).toMatchObject({ earned: false, best: 12_340, goal: CHALLENGE_BADGE_POP });
    expect(young.list.map((c) => c.name)).toEqual(['No loans', 'Hard money']);
    // reached once: earned, also after the city shrank
    expect(challengeStatus(st(900, [8000, 25_000, 12_000], ['noLoans']))).toMatchObject({ earned: true, best: 25_000 });
    expect(challengeStatus(st(CHALLENGE_BADGE_POP, [], ['noLoans']))!.earned).toBe(true);
  });
});
