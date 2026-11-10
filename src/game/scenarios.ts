/**
 * LG-14: scenarios and optional challenges (docs/POLISH_PLAN.md LG-14; D9: Boomtown, Lights Out and Smog City first).
 *
 * A scenario city carries one saved record, `config.scenario` (ScenarioStart): which scenario it is, the day it started
 * and the figures its goals are measured from. It is written once, when the city is founded (Boomtown) or bundled
 * (tools/scenarios.ts), and the simulation never reads it. Everything else is derived:
 *
 *  - evaluateScenario() is a pure function of that record and of state every host mirrors to the page (the day, the
 *    monthly history series, the stats and the loans). It runs on the main thread from the replica (ObjectivesCard) and
 *    headless on a simulation's own state (tools/scenarios.ts); it never reaches into the simulation and draws no random
 *    number, so a scenario city with the same seed and actions plays out the same.
 *  - Goals are decided on the monthly history samples only ("the objectives card updates monthly"): the same history
 *    gives the same outcome after any save and load, with no scenario state of its own to carry across.
 *  - What a profile keeps (localStorage, like the other per-profile prefs): the best medal per scenario, and per scenario
 *    city the decided outcome and the one fact history cannot give back, that a loan was taken (ScenarioMemo).
 *
 * All three scenarios are played on SCENARIO_LAND, the 128-cell map of the seed-7 bot city: Boomtown founds it empty;
 * Lights Out and Smog City are that city in February 2008 and January 2015 (bundled saves, scenarioBundles/).
 *
 * The Mayor's challenges of a city (config.challenges) are rules of the simulation (src/sim/economy/challenges.ts); this
 * module only names them for the New City dialog, the objectives card and the region card.
 */
import type { TerrainPreset } from '../core/types';
import type { CityState } from '../sim/CityState';
import { DIFFICULTY_FUNDS, type CityConfigData, type ScenarioRecord } from '../sim/config';
import { CHALLENGE_BADGE_POP, FREQUENT_DISASTERS, cityChallenges, type MayorChallenge } from '../sim/economy/challenges';
import { formatMoney } from '../sim/economy/format';
import { difficultyRules } from '../sim/economy/tuning';
import { loadPref, savePref } from './settings';

// ------------------------------------------------------------------------------------------------ scenarios
export const SCENARIO_IDS = ['boomtown', 'lights_out', 'smog_city'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];
export const MEDALS = ['bronze', 'silver', 'gold'] as const;
export type Medal = (typeof MEDALS)[number];
export const MEDAL_NAMES: Record<Medal, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

/**
 * Saved with the city (config.scenario; the fields: sim/config.ts ScenarioRecord): the day the scenario started on and
 * what its goals are measured from, with an id this build knows (scenarioOf() is the check)
 */
export interface ScenarioStart extends ScenarioRecord {
  id: ScenarioId;
}

/** the day a new city is founded on: 1 April of its first year (FEEL-05; main.ts FOUNDING_DAY). Boomtown starts then (D11) */
export const NEW_CITY_DAY = 90;

/** the land of every scenario: the bot's 128-cell map (tools/simbot.ts: seed 7, plains, water 0.2, its hilliness and trees) */
export const SCENARIO_LAND = {
  size: 128, seed: 7, terrain: 'plains' as TerrainPreset, waterAmount: 0.2, hilliness: 0.25, treeDensity: 0.35, climate: 'temperate',
} as const;

/** Boomtown: an empty tile and §100k; residents by the end of year 10 */
export const BOOMTOWN = { months: 120, funds: 100_000, residents: { bronze: 50_000, silver: 100_000, gold: 150_000 } } as const;
/** Lights Out: back to `residents` and `approval` within `months`; gold also needs no new loan. `funds`: what is left in
 *  the bank, less than one replacement plant costs (tools/scenarios.ts checks it against the catalog) */
export const LIGHTS_OUT = { months: { bronze: 12, silver: 9, gold: 6 }, residents: 70_000, approval: 60, funds: 15_000 } as const;
/** Smog City: the 12-month average air pollution at homes `cut` below the year before the start, with `residents` in the
 *  city in the month that is met, within `months` (10 / 5 / 2 years: the lead, NOTE-104) */
export const SMOG_CITY = { months: { bronze: 120, silver: 60, gold: 24 }, cut: 0.4, residents: 180_000, window: 12 } as const;

export interface ScenarioDef {
  id: ScenarioId;
  title: string;
  /** one line for the menu */
  tagline: string;
  /** the briefing: where the city stands and what is asked */
  brief: string;
  /** what each medal takes */
  goals: Record<Medal, string>;
  /** months the scenario lasts */
  months: number;
  /** 'found': a new city on empty land; 'bundle': a saved city (scenarioBundles/<id>.metropolis) */
  start: 'found' | 'bundle';
  /** the scenario city's name */
  city: string;
}

const n = (v: number): string => Math.round(v).toLocaleString('en-US');
/** '§100k', '§40k' (the shared compact format without a '.0') */
const moneyShort = (v: number): string => formatMoney(v, true).replace(/\.0(?=[kM]$)/, '');
const pctText = (v: number): string => `${Math.round(v * 100)}%`;
const years = (months: number): string => (months % 12 === 0 ? `${months / 12} years` : `${months} months`);

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioDef>> = {
  boomtown: {
    id: 'boomtown', title: 'Boomtown', start: 'found', city: 'Boomtown', months: BOOMTOWN.months,
    tagline: `Empty land and ${moneyShort(BOOMTOWN.funds)}`,
    brief: `An open valley and ${formatMoney(BOOMTOWN.funds)} in the bank. Found a city and grow it as fast as you can: the residents it has reached by the end of year ${BOOMTOWN.months / 12} decide the medal.`,
    goals: {
      bronze: `${n(BOOMTOWN.residents.bronze)} residents by year ${BOOMTOWN.months / 12}`,
      silver: `${n(BOOMTOWN.residents.silver)} residents`,
      gold: `${n(BOOMTOWN.residents.gold)} residents`,
    },
  },
  lights_out: {
    id: 'lights_out', title: 'Lights Out', start: 'bundle', city: 'Ashbury', months: LIGHTS_OUT.months.bronze,
    tagline: 'A city of 71,000 has lost its power plant',
    brief: `February 2008. The gas power plant that lit Ashbury burned down last night, and ${formatMoney(LIGHTS_OUT.funds)} is all that is left in the bank: less than a new plant costs. Without power, homes and workplaces empty within weeks. Bring the city back to ${n(LIGHTS_OUT.residents)} residents and ${LIGHTS_OUT.approval}% approval.`,
    goals: {
      bronze: `Within ${LIGHTS_OUT.months.bronze} months`,
      silver: `Within ${LIGHTS_OUT.months.silver} months`,
      gold: `Within ${LIGHTS_OUT.months.gold} months, without a new loan`,
    },
  },
  smog_city: {
    id: 'smog_city', title: 'Smog City', start: 'bundle', city: 'Coalbrook', months: SMOG_CITY.months.bronze,
    tagline: 'Clean the air of a city of 193,000',
    brief: `January 2015. Coalbrook grew up on smokestack industry and fossil power, and its residents breathe it. Cut the air pollution at homes by ${pctText(SMOG_CITY.cut)}, measured as the average of the last 12 months against the year before you took office, with ${n(SMOG_CITY.residents)} residents in the month the air goal is met.`,
    goals: {
      bronze: `Within ${years(SMOG_CITY.months.bronze)}`,
      silver: `Within ${years(SMOG_CITY.months.silver)}`,
      gold: `Within ${years(SMOG_CITY.months.gold)}`,
    },
  },
};
export const SCENARIO_LIST: readonly ScenarioDef[] = SCENARIO_IDS.map((id) => SCENARIOS[id]);

/** a config's scenario record when this build knows the scenario (a save from a newer build with another id: free play) */
export function scenarioOf(config: Pick<CityConfigData, 'scenario'>): ScenarioStart | null {
  const s = config.scenario;
  return s && typeof s === 'object' && (SCENARIO_IDS as readonly string[]).includes(s.id) && Number.isFinite(s.startDay) ? (s as ScenarioStart) : null;
}

/** the city config Boomtown is founded with (the caller adds the region tile and the mayor) */
export function boomtownConfig(): Partial<CityConfigData> {
  return {
    ...SCENARIO_LAND, name: SCENARIOS.boomtown.city, difficulty: 'medium', startFunds: BOOMTOWN.funds, sandbox: false, disasters: false,
    scenario: { id: 'boomtown', startDay: NEW_CITY_DAY },
  };
}

// ------------------------------------------------------------------------------------------------ evaluation
/** what an evaluation reads: mirrored by every host (worker/protocol.ts PLAIN_KEYS, the history tail and the clock) */
export type ScenarioState = Pick<CityState, 'day' | 'stats' | 'history' | 'budget'>;

/** a decided outcome: the medal (null: the scenario was lost) and the months it took */
export interface ScenarioResult {
  medal: Medal | null;
  month: number;
}
/** what a scenario city's profile record remembers between evaluations */
export interface ScenarioMemo {
  /** Lights Out: a loan was taken since the start (a loan repaid early leaves no other trace) */
  newLoan?: boolean;
  /** the outcome once decided: final, never evaluated again */
  result?: ScenarioResult;
}

export interface ObjectiveLine {
  label: string;
  /** "39,311 / 70,000" */
  value: string;
  /** 0..1 towards the goal */
  progress: number;
  done: boolean;
}

export interface ScenarioStatus {
  id: ScenarioId;
  phase: 'active' | 'won' | 'lost';
  /** won: the final medal. active: the medal already secured (Boomtown's tiers), else null */
  medal: Medal | null;
  /** whole months since the start, and the scenario's last month */
  month: number;
  months: number;
  /** active: the best medal still in reach */
  reach: Medal | null;
  /** the goals with the city's current figures */
  lines: ObjectiveLine[];
  /** where the clock stands: "Month 3 of 12", "Year 2 of 10" */
  clock: string;
  /** one line for the minimised card */
  headline: string;
  /** Lights Out: a loan was taken since the start */
  newLoan: boolean;
  /** the outcome when it is decided (the caller keeps it: ScenarioMemo.result) */
  result: ScenarioResult | null;
}

const monthOf = (day: number): number => Math.floor(day / 30);
const frac = (v: number, goal: number): number => (goal > 0 ? Math.max(0, Math.min(1, v / goal)) : 0);

/** the history samples of the scenario's months 1..last, oldest first: [months since the start, index into the series] */
function samples(start: ScenarioStart, st: ScenarioState, last: number): [number, number][] {
  const t = st.history.t, m0 = monthOf(start.startDay), out: [number, number][] = [];
  for (let i = 0; i < t.length; i++) {
    const m = t[i] - m0;
    if (m >= 1 && m <= last) out.push([m, i]);
  }
  return out;
}

/** a loan in `loans` that was not outstanding at the start (matched one to one on principal and rate) */
export function hasNewLoan(startLoans: readonly (readonly [number, number])[] | undefined, loans: readonly { principal: number; rate: number }[]): boolean {
  const left = (startLoans ?? []).slice();
  for (const l of loans) {
    const k = left.findIndex(([p, r]) => p === l.principal && Math.abs(r - l.rate) < 1e-9);
    if (k < 0) return true;
    left.splice(k, 1);
  }
  return false;
}

/** loan proceeds booked in the running month, or in the month just closed when that month began after the start */
function loanProceeds(st: ScenarioState, month: number): boolean {
  const b = st.budget;
  return (b.curIncome?.['oneoff:loan'] ?? 0) > 0 || (month >= 1 && (b.lastIncome?.['oneoff:loan'] ?? 0) > 0);
}

const tierByMonth = (m: number, limits: Record<Medal, number>): Medal | null =>
  m <= limits.gold ? 'gold' : m <= limits.silver ? 'silver' : m <= limits.bronze ? 'bronze' : null;

/** mean of the `window` samples of `a` ending at index i (null before `window` samples exist) */
function trailingMean(a: readonly number[], i: number, window: number): number | null {
  if (i < window - 1) return null;
  let s = 0;
  for (let k = i - window + 1; k <= i; k++) s += a[k];
  return s / window;
}

function boomtown(start: ScenarioStart, st: ScenarioState, month: number): Omit<ScenarioStatus, 'id' | 'newLoan' | 'result'> & { decided: number } {
  const R = BOOMTOWN.residents, h = st.history;
  const tier = (pop: number): Medal | null => (pop >= R.gold ? 'gold' : pop >= R.silver ? 'silver' : pop >= R.bronze ? 'bronze' : null);
  let best = 0, goldAt = 0;
  for (const [m, i] of samples(start, st, BOOMTOWN.months)) {
    if (h.pop[i] > best) best = h.pop[i];
    if (!goldAt && h.pop[i] >= R.gold) goldAt = m;
  }
  const medal = tier(best), over = month >= BOOMTOWN.months;
  const phase = goldAt || (over && medal) ? 'won' : over ? 'lost' : 'active';
  const pop = st.stats.population, next = medal === 'silver' || medal === 'gold' ? R.gold : medal === 'bronze' ? R.silver : R.bronze;
  const year = Math.min(BOOMTOWN.months / 12, Math.floor(month / 12) + 1);
  return {
    phase, medal, month, months: BOOMTOWN.months, reach: phase === 'active' ? 'gold' : null, decided: goldAt || BOOMTOWN.months,
    lines: [
      { label: 'Residents', value: `${n(pop)} / ${n(next)}`, progress: frac(pop, next), done: pop >= next },
      ...MEDALS.map((k) => ({ label: MEDAL_NAMES[k], value: `${n(R[k])} residents`, progress: frac(Math.max(best, pop), R[k]), done: best >= R[k] })),
    ],
    clock: `Year ${year} of ${BOOMTOWN.months / 12}`,
    headline: `${n(pop)} / ${n(next)} residents`,
  };
}

function lightsOut(start: ScenarioStart, st: ScenarioState, month: number, newLoan: boolean): Omit<ScenarioStatus, 'id' | 'newLoan' | 'result'> & { decided: number } {
  const L = LIGHTS_OUT, h = st.history;
  let at = 0;
  for (const [m, i] of samples(start, st, L.months.bronze)) {
    if (h.pop[i] >= L.residents && h.approval[i] >= L.approval) { at = m; break; }
  }
  const byTime = at ? tierByMonth(at, L.months) : null;
  const medal = byTime === 'gold' && newLoan ? 'silver' : byTime;
  const phase = at ? 'won' : month >= L.months.bronze ? 'lost' : 'active';
  // the next sample is month + 1: the best medal that month can still earn
  const next = tierByMonth(month + 1, L.months);
  const reach = phase !== 'active' ? null : next === 'gold' && newLoan ? 'silver' : next;
  const pop = st.stats.population, approval = Math.round(st.stats.approval);
  return {
    phase, medal, month, months: L.months.bronze, reach, decided: at || L.months.bronze,
    lines: [
      { label: 'Residents', value: `${n(pop)} / ${n(L.residents)}`, progress: frac(pop, L.residents), done: pop >= L.residents },
      { label: 'Approval', value: `${approval}% / ${L.approval}%`, progress: frac(approval, L.approval), done: approval >= L.approval },
      { label: 'No new loan', value: newLoan ? 'A loan was taken: silver at best' : 'Kept (gold needs it)', progress: newLoan ? 0 : 1, done: !newLoan },
    ],
    clock: `Month ${Math.min(month + 1, L.months.bronze)} of ${L.months.bronze}`,
    headline: `${n(pop)} / ${n(L.residents)} residents · ${approval}% / ${L.approval}%`,
  };
}

const CUT_SLACK = 1e-9;

/** Smog City's measure: how far the 12-month average air pollution at homes is below the start's (0.4 = 40% cleaner) */
export function airCut(start: ScenarioStart, st: ScenarioState, index = st.history.t.length - 1): number | null {
  const base = start.air ?? 0, mean = trailingMean(st.history.air, index, SMOG_CITY.window);
  return base > 0 && mean !== null ? 1 - mean / base : null;
}

function smogCity(start: ScenarioStart, st: ScenarioState, month: number): Omit<ScenarioStatus, 'id' | 'newLoan' | 'result'> & { decided: number } {
  const S = SMOG_CITY, h = st.history;
  let at = 0;
  // (CUT_SLACK: an average that is 40% down to the last bit of the division still counts)
  for (const [m, i] of samples(start, st, S.months.bronze)) {
    const cut = airCut(start, st, i);
    if (cut !== null && cut >= S.cut - CUT_SLACK && h.pop[i] >= S.residents) { at = m; break; }
  }
  const phase = at ? 'won' : month >= S.months.bronze ? 'lost' : 'active';
  const cut = airCut(start, st) ?? 0, pop = st.stats.population;
  const pc = Math.round(cut * 100), signed = `${pc > 0 ? '−' : pc < 0 ? '+' : ''}${Math.abs(pc)}%`;
  const year = Math.min(S.months.bronze / 12, Math.floor(month / 12) + 1);
  return {
    phase, medal: at ? tierByMonth(at, S.months) : null, month, months: S.months.bronze,
    reach: phase === 'active' ? tierByMonth(month + 1, S.months) : null, decided: at || S.months.bronze,
    lines: [
      { label: 'Air pollution at homes', value: `${signed} / −${pctText(S.cut)}`, progress: frac(cut, S.cut), done: cut >= S.cut - CUT_SLACK },
      { label: 'Residents', value: `${n(pop)} / ${n(S.residents)}`, progress: frac(pop, S.residents), done: pop >= S.residents },
    ],
    clock: `Year ${year} of ${S.months.bronze / 12}`,
    headline: `Air ${signed} / −${pctText(S.cut)} · ${n(pop)} residents`,
  };
}

/**
 * Where a scenario city stands. `memo`: what the profile remembers of this city; a decided `memo.result` is final.
 * `status.result` is set when the outcome is decided: record it (recordScenarioRun) so it stays the outcome.
 */
export function evaluateScenario(start: ScenarioStart, st: ScenarioState, memo: ScenarioMemo = {}): ScenarioStatus {
  const month = Math.max(0, monthOf(st.day) - monthOf(start.startDay));
  const newLoan = start.id === 'lights_out'
    && (memo.newLoan === true || hasNewLoan(start.loans, st.budget.loans) || loanProceeds(st, month));
  const s = start.id === 'boomtown' ? boomtown(start, st, month)
    : start.id === 'lights_out' ? lightsOut(start, st, month, newLoan) : smogCity(start, st, month);
  const { decided, ...status } = s;
  if (memo.result) {
    // decided earlier: that outcome stands, whatever the city did since
    return { id: start.id, ...status, phase: memo.result.medal ? 'won' : 'lost', medal: memo.result.medal, reach: null, newLoan, result: memo.result };
  }
  return { id: start.id, ...status, newLoan, result: status.phase === 'active' ? null : { medal: status.phase === 'won' ? status.medal : null, month: decided } };
}

/** how a decided scenario ended, in a sentence (the result card) */
export function resultText(id: ScenarioId, result: ScenarioResult, newLoan = false): string {
  const took = result.month >= 24 && result.month % 12 === 0 ? `${result.month / 12} years` : result.month >= 24 ? `${Math.floor(result.month / 12)} years and ${result.month % 12} months` : `${result.month} month${result.month === 1 ? '' : 's'}`;
  if (id === 'boomtown') {
    return result.medal
      ? `${SCENARIOS.boomtown.city} reached ${n(BOOMTOWN.residents[result.medal])} residents ${result.medal === 'gold' && result.month < BOOMTOWN.months ? `in ${took}` : `by year ${BOOMTOWN.months / 12}`}.`
      : `Year ${BOOMTOWN.months / 12} is over and the city has not reached ${n(BOOMTOWN.residents.bronze)} residents.`;
  }
  if (id === 'lights_out') {
    return result.medal
      ? `The city is back at ${n(LIGHTS_OUT.residents)} residents and ${LIGHTS_OUT.approval}% approval after ${took}${result.medal === 'gold' ? ', without a new loan' : newLoan ? ', with a new loan' : ''}.`
      : `${LIGHTS_OUT.months.bronze} months on, the city has not come back to ${n(LIGHTS_OUT.residents)} residents and ${LIGHTS_OUT.approval}% approval.`;
  }
  return result.medal
    ? `Air pollution at homes is down ${pctText(SMOG_CITY.cut)} after ${took}, and ${n(SMOG_CITY.residents)} residents still live here.`
    : `${years(SMOG_CITY.months.bronze)} on, the air at homes is not ${pctText(SMOG_CITY.cut)} cleaner with ${n(SMOG_CITY.residents)} residents in the city.`;
}

// ------------------------------------------------------------------------------------------------ the profile's record
const PREF = 'scenarios';
/** scenario cities remembered per profile (the oldest are dropped) */
const MAX_RUNS = 40;

export interface MedalRecord {
  medal: Medal;
  /** months the run took */
  month: number;
  /** Date.now() when it was won */
  at: number;
}
interface RunRecord extends ScenarioMemo {
  id: ScenarioId;
  at: number;
}
interface ScenarioProfile {
  medals: Partial<Record<ScenarioId, MedalRecord>>;
  runs: Record<string, RunRecord>;
}

const isMedal = (v: unknown): v is Medal => (MEDALS as readonly unknown[]).includes(v);
const isScenario = (v: unknown): v is ScenarioId => (SCENARIO_IDS as readonly unknown[]).includes(v);
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function readResult(v: unknown): ScenarioResult | undefined {
  const r = record(v);
  return (r.medal === null || isMedal(r.medal)) && typeof r.month === 'number' && Number.isFinite(r.month) ? { medal: r.medal, month: r.month } : undefined;
}

/** the stored record with every malformed entry dropped (another build, a hand-edited or damaged value) */
function loadProfile(): ScenarioProfile {
  const raw = record(loadPref<unknown>(PREF, null));
  const out: ScenarioProfile = { medals: {}, runs: {} };
  for (const [id, v] of Object.entries(record(raw.medals))) {
    const m = record(v);
    if (isScenario(id) && isMedal(m.medal) && typeof m.month === 'number') out.medals[id] = { medal: m.medal, month: m.month, at: typeof m.at === 'number' ? m.at : 0 };
  }
  for (const [key, v] of Object.entries(record(raw.runs))) {
    const r = record(v);
    if (!isScenario(r.id)) continue;
    const run: RunRecord = { id: r.id, at: typeof r.at === 'number' ? r.at : 0 };
    if (r.newLoan === true) run.newLoan = true;
    const result = readResult(r.result);
    if (result) run.result = result;
    out.runs[key] = run;
  }
  return out;
}

export const medalRank = (m: Medal | null | undefined): number => (m ? MEDALS.indexOf(m) + 1 : 0);

/** the profile's best medal per scenario */
export function loadMedals(): Partial<Record<ScenarioId, MedalRecord>> {
  return loadProfile().medals;
}

/** the key of a scenario city in the profile's record: its region and tile (a city outside a region: its name and seed) */
export function runKey(config: Pick<CityConfigData, 'regionId' | 'tileX' | 'tileZ' | 'name' | 'seed'>): string {
  return config.regionId !== undefined ? `${config.regionId}:${config.tileX ?? 0}_${config.tileZ ?? 0}` : `city:${config.name}:${config.seed}`;
}

/** what the profile remembers of a scenario city; null for a city it has not seen yet */
export function loadScenarioRun(key: string): ScenarioMemo | null {
  const r = loadProfile().runs[key];
  return r ? { ...(r.newLoan ? { newLoan: true } : {}), ...(r.result ? { result: r.result } : {}) } : null;
}

/**
 * Remember a scenario city's memo. A decided result with a medal also raises the profile's best medal for the scenario
 * (a better medal, or the same medal in fewer months). Returns true when it is a new best.
 */
export function recordScenarioRun(key: string, id: ScenarioId, memo: ScenarioMemo, now = Date.now()): boolean {
  const p = loadProfile();
  const prev = p.runs[key];
  const run: RunRecord = { id, at: now };
  if (memo.newLoan || prev?.newLoan) run.newLoan = true;
  // (a decided outcome is never replaced)
  const result = prev?.result ?? memo.result;
  if (result) run.result = { medal: result.medal, month: result.month };
  p.runs[key] = run;
  const keys = Object.keys(p.runs);
  if (keys.length > MAX_RUNS) for (const k of keys.sort((a, b) => p.runs[a].at - p.runs[b].at).slice(0, keys.length - MAX_RUNS)) delete p.runs[k];
  let best = false;
  if (!prev?.result && result?.medal) {
    const old = p.medals[id];
    if (!old || medalRank(result.medal) > medalRank(old.medal) || (result.medal === old.medal && result.month < old.month)) {
      p.medals[id] = { medal: result.medal, month: result.month, at: now };
      best = true;
    }
  }
  savePref(PREF, p);
  return best;
}

/** the title menu's sub-line: "3 scenarios · 2 medals" */
export function challengesSummary(): string {
  const won = Object.keys(loadMedals()).length;
  return `${SCENARIO_LIST.length} scenarios · ${won === 0 ? 'no medal yet' : `${won} medal${won === 1 ? '' : 's'}`}`;
}

// ------------------------------------------------------------------------------------------------ Mayor's challenges
/** names and rules of the Mayor's challenges (the New City dialog's toggles) */
export const CHALLENGE_INFO: Readonly<Record<MayorChallenge, { name: string; rule: string }>> = {
  noLoans: { name: 'No loans', rule: 'The bank lends nothing: the city lives on what it earns.' },
  noDirtyIndustry: { name: 'No dirty industry', rule: 'Smokestack industry (I-D) never opens. Farms, manufacturing and high-tech still do.' },
  frequentDisasters: { name: 'Frequent disasters', rule: `Tornadoes, quakes and meteors strike ${FREQUENT_DISASTERS === 2 ? 'twice' : `${FREQUENT_DISASTERS} times`} as often.` },
  hardMoney: {
    name: 'Hard money',
    // (all of Hard's money rules, NOTE-104: src/sim/economy/challenges.ts moneyDifficulty)
    rule: `Hard's money on any difficulty: ${moneyShort(DIFFICULTY_FUNDS.hard)} to start, ${Math.round((1 - difficultyRules('hard').income) * 100)}% less tax income, `
      + `services cost ${Math.round((difficultyRules('hard').opexMultiplier - 1) * 100)}% more to run, and the council removes you after `
      + `${difficultyRules('hard').bankruptRemovalMonths} months in debt.`,
  },
};
/** how a challenge earns its badge (the dialog's note and the objectives card) */
export const CHALLENGE_BADGE_NOTE = `Each challenge earns its badge on the region card once the city reaches ${n(CHALLENGE_BADGE_POP)} residents.`;

/**
 * A city config with the dialog's challenge picks applied: `challenges` (dropped when none; never in sandbox, whose
 * unlimited money leaves nothing to challenge), Hard's starting funds for "Hard money", and Disasters switched on for
 * "Frequent disasters".
 */
export function applyChallenges(cfg: CityConfigData, picks: readonly MayorChallenge[]): CityConfigData {
  const list = cfg.sandbox || cfg.difficulty === 'sandbox' ? [] : cityChallenges({ challenges: picks });
  const out: CityConfigData = { ...cfg };
  if (list.length) out.challenges = list;
  else delete out.challenges;
  if (list.includes('hardMoney')) out.startFunds = DIFFICULTY_FUNDS.hard;
  if (list.includes('frequentDisasters')) out.disasters = true;
  return out;
}

export interface ChallengeStatus {
  list: { id: MayorChallenge; name: string; rule: string }[];
  /** the badges are earned: the city has reached CHALLENGE_BADGE_POP residents at some point */
  earned: boolean;
  /** the most residents the city has had, and the badge's bar */
  best: number;
  goal: number;
}

/** a city's Mayor's challenges and how far their badges are (null: the city has none) */
export function challengeStatus(st: Pick<CityState, 'config' | 'stats' | 'history'>): ChallengeStatus | null {
  const ids = cityChallenges(st.config);
  if (!ids.length) return null;
  // (reached ranks live in systemData.cityRanks, which the replica does not mirror: the history has the same answer)
  let best = st.stats.population;
  for (const p of st.history.pop) if (p > best) best = p;
  return { list: ids.map((id) => ({ id, ...CHALLENGE_INFO[id] })), earned: best >= CHALLENGE_BADGE_POP, best, goal: CHALLENGE_BADGE_POP };
}
