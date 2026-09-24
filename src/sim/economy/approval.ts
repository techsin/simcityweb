/**
 * Approval (0..100), EQ / HQ (0..150) and the pop-weighted "resident experience" used by approval + advisors.
 * sim-core OWNS stats.approval. stats.eq / stats.hq are written by sim-infra's services system when present;
 * without it sim-core moves them slowly toward a target from coverage at homes (× ordinance effects).
 * Without infra sim-core also fills stats.avgCommute / avgPollution / avgCrime (fallbacks).
 *
 * SIM_DEPTH_SPEC WP4: approval is a sum of named terms (econData.approvalTerms, approvalBreakdown() for the TopBar
 * tooltip). Besides the legacy terms (tax, services, pollution, crime, commute, unemployment, parks, strikes, deficit,
 * ordinances, civic buildings) residents now judge: noise at home, tap water, garbage pickup, power / water outages,
 * unmet needs (pupils without a school in reach, seniors without a clinic), tourism, HQ, emergencies (WP8; legacy fire
 * count while the emergency system is inactive), jail overflow (WP7) and disasters. All terms are resident-weighted
 * (read at the centre cell of every occupied home) and computed once a month. The service gaps (garbage, unmet needs,
 * tap water) are bounded: each saturates softly and together they cost at most APPROVAL_TERMS.gapMax (serviceGaps).
 *
 * residentSurvey(st, rt) is the shared monthly resident experience (per wealth and city-wide); the tourism system
 * (attractiveness, WP4) reads it on the same day, so the survey is cached per day.
 */
import type { SimSystem, Simulation } from '../Simulation';
import { BF, type Building } from '../CityState';
import { clamp, smoothstep } from '../../core/rng';
import { DevType } from '../../core/types';
import {
  APPROVAL, APPROVAL_TERMS as AT, COMMUTE_FALLBACK, COVERAGE_FALLBACK, EQ_BASE, EQ_RATE, EQ_SPAN, HQ_BASE, HQ_RATE, HQ_SPAN,
  NEEDS_POP_FULL, NEEDS_POP_START, TAX_NEUTRAL,
} from './tuning';
import { type EconRuntime, type InfraFlags, econData, infraFlags } from './runtime';
import { ordinanceEffect } from './ordinances';
import { serviceEffectiveness } from './budget';
import { waterRequired } from './demographics';
import type { FactorTerm } from '../explain';
import type { CityState } from '../CityState';

export interface ResidentCoverage {
  police: number;
  fire: number;
  health: number;
  edu: number;
  park: number;
  transit: number;
}
const coverage = new WeakMap<object, ResidentCoverage>();
/** pop-weighted coverage at homes from the last monthly update */
export function residentCoverage(state: object): ResidentCoverage {
  return coverage.get(state) ?? { police: 0, fire: 0, health: 0, edu: 0, park: 0, transit: 0 };
}

// ------------------------------------------------------------------------------------------------ resident survey
/**
 * Resident-weighted experience at homes. Index 0..2 = R$ / R$$ / R$$$, index 3 = all residents.
 * Averages are 0 when nobody lives in that tier (pop[k] = 0).
 */
export interface ResidentSurvey {
  day: number;
  pop: number[];
  crime: number[];
  air: number[];
  noise: number[];
  park: number[];
  prestige: number[];
  /** shares of residents: home without garbage pickup / unpowered / needing water but unwatered */
  noGarbage: number[];
  unpowered: number[];
  unwatered: number[];
  /** city-wide only */
  commute: number;
  police: number;
  fire: number;
  health: number;
  edu: number;
  transit: number;
  green: number;
}

const surveys = new WeakMap<CityState, ResidentSurvey>();

function hasPower(st: CityState, b: Building, inf: InfraFlags): boolean {
  if (!inf.utilities || b.flags & BF.Powered) return true;
  const N = st.size;
  return st.powered[b.z * N + b.x] === 1 || st.powered[(b.z + b.d - 1) * N + b.x + b.w - 1] === 1;
}
function hasWater(st: CityState, b: Building, inf: InfraFlags): boolean {
  if (!inf.utilities || b.flags & BF.Watered) return true;
  const N = st.size;
  return st.watered[b.z * N + b.x] === 1 || st.watered[(b.z + b.d - 1) * N + b.x + b.w - 1] === 1;
}

/** the resident survey of today (computed at most once per day; monthly callers: tourism, approval) */
export function residentSurvey(st: CityState, rt: EconRuntime, inf: InfraFlags = infraFlags(st)): ResidentSurvey {
  const c = surveys.get(st);
  if (c && c.day === st.day) return c;
  const N = st.size;
  const z4 = () => [0, 0, 0, 0];
  const pop = z4(), crime = z4(), air = z4(), noise = z4(), park = z4(), prestige = z4(), noG = z4(), unP = z4(), unW = z4();
  let commute = 0, pol = 0, fire = 0, hlth = 0, edu = 0, transit = 0, green = 0;
  for (const b of rt.growables) {
    if (b.pop <= 0 || b.flags & BF.Abandoned) continue;
    const def = rt.defOf(b);
    if (!def || def.devType === undefined || def.devType > DevType.R3) continue;
    const i = (b.z + (b.d >> 1)) * N + b.x + (b.w >> 1);
    const p = b.pop;
    const w = def.devType;
    pop[3] += p; pop[w] += p;
    const cr = st.crime[i] * p, ai = st.airPollution[i] * p, no = st.noise[i] * p, pk = st.parkCov[i] * p, pr = st.prestige[i] * p;
    crime[3] += cr; crime[w] += cr;
    air[3] += ai; air[w] += ai;
    noise[3] += no; noise[w] += no;
    park[3] += pk; park[w] += pk;
    prestige[3] += pr; prestige[w] += pr;
    if (b.flags & BF.NoGarbage) { noG[3] += p; noG[w] += p; }
    if (!hasPower(st, b, inf)) { unP[3] += p; unP[w] += p; }
    else if (!hasWater(st, b, inf) && waterRequired(st, b)) { unW[3] += p; unW[w] += p; }
    commute += (inf.traffic && st.commute[i] > 0 ? st.commute[i] : COMMUTE_FALLBACK) * p;
    if (inf.services) {
      pol += st.policeCov[i] * p; fire += st.fireCov[i] * p; hlth += st.healthCov[i] * p; edu += st.eduCov[i] * p;
      transit += st.transitCov[i] * p; green += st.greenCov[i] * p;
    }
  }
  // sum / P (not × 1/P): the legacy approval loop summed in exactly this order, so resCrime / resPollution /
  // resCommute / coverage stay bit-identical
  for (let k = 0; k < 4; k++) {
    const P = pop[k];
    if (P <= 0) { crime[k] = air[k] = noise[k] = park[k] = prestige[k] = noG[k] = unP[k] = unW[k] = 0; continue; }
    crime[k] /= P; air[k] /= P; noise[k] /= P; park[k] /= P; prestige[k] /= P; noG[k] /= P; unP[k] /= P; unW[k] /= P;
  }
  const W = pop[3];
  const sv: ResidentSurvey = W > 0
    ? {
      day: st.day, pop, crime, air, noise, park, prestige, noGarbage: noG, unpowered: unP, unwatered: unW,
      commute: commute / W, police: pol / W, fire: fire / W, health: hlth / W, edu: edu / W, transit: transit / W, green: green / W,
    }
    : {
      day: st.day, pop, crime, air, noise, park, prestige, noGarbage: noG, unpowered: unP, unwatered: unW,
      commute: COMMUTE_FALLBACK, police: 0, fire: 0, health: 0, edu: 0, transit: 0, green: 0,
    };
  surveys.set(st, sv);
  return sv;
}

// ------------------------------------------------------------------------------------------------ terms
/** labels of the approval terms (stable ids; WP5 TopBar tooltip) */
export const APPROVAL_LABELS: Record<string, string> = {
  base: 'Baseline',
  tax: 'Residential taxes',
  services: 'City services at homes',
  pollution: 'Air pollution',
  crime: 'Crime',
  commute: 'Commute times',
  unemployment: 'Unemployment',
  parks: 'Parks near homes',
  strikes: 'Strikes',
  deficit: 'City in debt',
  ordinances: 'Ordinances',
  civic: 'Civic buildings',
  noise: 'Noise at home',
  tapWater: 'Tap water quality',
  garbage: 'Uncollected garbage',
  outages: 'Power / water outages',
  needs: 'Unmet needs (schools, clinics)',
  tourism: 'Tourism pride',
  hq: 'Health (HQ)',
  emergencies: 'Emergencies last month',
  justice: 'Criminals released early',
  disaster: 'Disaster',
  clamp: 'Limit (0–100)',
};

/** soft saturation of a negative term: ≈ raw while small (slope 1 at 0), never below −sat */
function saturate(raw: number, sat: number): number {
  if (raw === 0) return 0; // no −0 in the breakdown
  return raw < 0 && sat > 0 ? -sat * (1 - Math.exp(raw / sat)) : raw;
}

interface NeedLike { need: number; unreached: number }
export interface ServiceGaps {
  garbage: number;
  needs: number;
  tapWater: number;
  /** sum of the three terms before the APPROVAL_TERMS.gapMax limit */
  sum: number;
  /** true when the gapMax limit scaled the three terms down */
  limited: boolean;
}

/**
 * SERVICE-GAP approval terms (WP4): uncollected garbage, unmet needs (pupils without a school in reach, patients
 * without a clinic) and tap water. Each is the spec formula × its population fade (garbage 2k..20k residents, needs
 * WP1's NEEDS_POP_START..NEEDS_POP_FULL), saturating softly at APPROVAL_TERMS.gapSat; their sum is limited to
 * APPROVAL_TERMS.gapMax (all three scaled by the same factor, so the breakdown still sums to approvalRaw).
 * Pure (tests, UI): residents = resident population of the survey, shares 0..1, tapWater 0..1 (1 = clean / n.a.).
 */
export function serviceGaps(
  residents: number, noGarbageShare: number, tapWater: number,
  nd: { elementary?: NeedLike; high?: NeedLike; health?: NeedLike } | undefined,
): ServiceGaps {
  const fadeG = residents > 0 ? smoothstep(AT.needsPop0, AT.garbagePop1, residents) : 0;
  const fadeN = residents > 0 ? smoothstep(NEEDS_POP_START, NEEDS_POP_FULL, residents) : 0;
  let needsRaw = 0;
  if (nd && fadeN > 0) {
    const pupils = (nd.elementary?.need ?? 0) + (nd.high?.need ?? 0);
    if (pupils > 0) needsRaw += AT.kidsUnreached * clamp(((nd.elementary?.unreached ?? 0) + (nd.high?.unreached ?? 0)) / pupils, 0, 1);
    const patients = nd.health?.need ?? 0;
    if (patients > 0) needsRaw += AT.seniorsHealth * clamp((nd.health?.unreached ?? 0) / patients, 0, 1);
  }
  const S = AT.gapSat;
  let garbage = saturate(fadeG * AT.garbage * clamp(noGarbageShare, 0, 1), S.garbage);
  let needs = saturate(fadeN * needsRaw, S.needs);
  let tap = saturate(AT.tapWater * clamp(1 - tapWater, 0, 1), S.tapWater);
  const sum = garbage + needs + tap;
  const limited = sum < AT.gapMax;
  if (limited) {
    const k = AT.gapMax / sum;
    garbage *= k; needs *= k; tap *= k;
  }
  return { garbage, needs, tapWater: tap, sum, limited };
}

/** duck-typed optional systems (emergency WP8 / disasters) — no hard imports of sim-infra */
interface EmergencyApi { active?: boolean }
interface DisastersApi { active?: readonly unknown[] }

export function approvalSystem(rt: EconRuntime): SimSystem {
  let firesMonth = 0;
  let disasterMonth = false;
  let subscribedTo: Simulation | null = null;
  let unsub: (() => void) | null = null;

  const update = (sim: Simulation, first: boolean) => {
    const st = sim.state;
    const data = econData(st);
    // init of a loaded city (terms from an earlier month): keep the saved, smoothed approval instead of snapping it
    // to this month's raw value (save / load continuity)
    const resumed = first && st.day > 0 && Object.keys(data.approvalTerms).length > 0;
    const inf = infraFlags(st);
    const sv = residentSurvey(st, rt, inf);
    const w = sv.pop[3];
    const cov: ResidentCoverage = inf.services && w > 0
      ? { police: sv.police, fire: sv.fire, health: sv.health, edu: sv.edu, park: sv.park[3], transit: sv.transit }
      : {
        police: COVERAGE_FALLBACK * serviceEffectiveness(st, 'police'), fire: COVERAGE_FALLBACK * serviceEffectiveness(st, 'fire'),
        health: COVERAGE_FALLBACK * serviceEffectiveness(st, 'health'), edu: COVERAGE_FALLBACK * serviceEffectiveness(st, 'education'),
        park: 0.3, transit: 0,
      };
    coverage.set(st, cov);
    if (w > 0) {
      data.resCrime = sv.crime[3];
      data.resPollution = sv.air[3];
      data.resCommute = sv.commute;
    }
    data.resServices = (cov.police + cov.fire + cov.health + cov.edu) / 4;
    data.resParks = cov.park;
    data.resEdu = cov.edu;
    data.resHealth = cov.health;
    const s = st.stats;
    if (!inf.traffic) s.avgCommute = w > 0 ? data.resCommute : COMMUTE_FALLBACK;
    // ---- EQ / HQ
    const eqT = clamp(EQ_BASE + EQ_SPAN * cov.edu * ordinanceEffect(st, 'edu.effect'), 0, 150);
    const hqT = clamp(HQ_BASE + HQ_SPAN * cov.health * ordinanceEffect(st, 'health.effect'), 0, 150);
    if (inf.services) { /* sim-infra services owns EQ / HQ */ }
    else if (s.population <= 0) { s.eq = first ? s.eq : s.eq + (50 - s.eq) * 0.1; s.hq = first ? s.hq : s.hq + (50 - s.hq) * 0.1; }
    else if (!first) {
      s.eq += (eqT - s.eq) * EQ_RATE;
      s.hq += (hqT - s.hq) * HQ_RATE;
    }
    // ---- approval terms
    const pop = s.population;
    let tax = TAX_NEUTRAL;
    if (pop > 0) tax = (s.residents[0] * st.budget.taxRates[0] + s.residents[1] * st.budget.taxRates[1] + s.residents[2] * st.budget.taxRates[2]) / pop;
    const taxTerm = tax > TAX_NEUTRAL ? APPROVAL.taxPerPoint * (tax - TAX_NEUTRAL) : APPROVAL.taxLowPerPoint * (TAX_NEUTRAL - tax);
    let strikes = 0;
    for (const k in data.strikes) if (data.strikes[k] > 0) strikes++;
    const T: Record<string, number> = {};
    T.base = APPROVAL.base;
    T.tax = taxTerm;
    T.services = APPROVAL.services * (data.resServices - 0.3);
    T.pollution = APPROVAL.pollution * data.resPollution;
    T.crime = APPROVAL.crime * data.resCrime;
    T.commute = APPROVAL.commute * Math.max(0, data.resCommute - 30);
    T.unemployment = APPROVAL.unemployment * Math.max(0, s.unemployment - 0.08);
    T.parks = APPROVAL.parks * (data.resParks - 0.2);
    T.strikes = APPROVAL.strike * strikes;
    T.deficit = data.monthsNegative > 0 ? APPROVAL.deficit : 0;
    T.ordinances = ordinanceEffect(st, 'add.approval');
    T.civic = ((st.milestones.civ_mayor_house ?? 0) > 0 ? 2 : 0) + ((st.milestones.civ_statue ?? 0) > 0 ? 3 : 0)
      + ((st.milestones.civ_city_hall ?? 0) > 0 ? 2 : 0);
    // WP4 resident-weighted terms. Outages / poor HQ fade in over the first residents (a hamlet's first homes wait for
    // the first power plant and clinic without the mayor being blamed); garbage fades in more slowly and unmet needs
    // follow WP1's expectation curve (tuning APPROVAL_TERMS / NEEDS_POP_*).
    const fadeIn = w > 0 ? smoothstep(AT.needsPop0, AT.needsPop1, w) : 0;
    T.noise = w > 0 ? AT.noise * sv.noise[3] : 0;
    T.outages = fadeIn * (AT.unpowered * sv.unpowered[3] + AT.unwatered * sv.unwatered[3]);
    const g = serviceGaps(w, sv.noGarbage[3], w > 0 && inf.utilities ? s.tapWater ?? 1 : 1, s.needs);
    T.garbage = g.garbage;
    T.needs = g.needs;
    T.tapWater = g.tapWater;
    T.tourism = Math.min(AT.tourismMax, (data.tourists ?? 0) / AT.tourismPerPoint);
    // HQ: a bonus for good health care; the penalty fades in with the city (no hamlet has a hospital)
    const hq = w > 0 ? clamp(AT.hq * (s.hq - AT.hqRef) / AT.hqSpan, -AT.hq, AT.hq) : 0;
    T.hq = hq < 0 ? hq * fadeIn : hq;
    const em = sim.getSystem<SimSystem & EmergencyApi>('emergency');
    if (em?.active === true && s.emergency) {
      const lm = s.emergency.lastMonth;
      T.emergencies = -Math.min(AT.emergencyMax, AT.emFailed * lm.failed + AT.emLate * lm.late + AT.emDeaths * lm.deaths + AT.emRiotDays * lm.riotDays);
    } else {
      T.emergencies = -Math.min(AT.fireMax, AT.firePer * firesMonth);
    }
    T.justice = AT.justice * clamp(s.justice?.overflow ?? 0, 0, 1);
    const dis = sim.getSystem<SimSystem & DisastersApi>('disasters');
    T.disaster = disasterMonth || (dis?.active?.length ?? 0) > 0 ? AT.disaster : 0;
    firesMonth = 0;
    disasterMonth = false;
    let raw = 0;
    for (const k in T) {
      if (T[k] === 0) T[k] = 0; // no −0 in the breakdown
      raw += T[k];
    }
    const clamped = clamp(raw, 0, 100);
    T.clamp = clamped - raw;
    raw = clamped;
    data.approvalTerms = T;
    data.approvalRaw = raw;
    if (!resumed) s.approval = first ? raw : clamp(s.approval + (raw - s.approval) * APPROVAL.ema, 0, 100);
    if (!inf.pollution) s.avgPollution = data.resPollution;
    if (!inf.services) s.avgCrime = data.resCrime;
  };
  return {
    name: 'economy.approval',
    init(sim) {
      rt.attach(sim);
      if (subscribedTo !== sim) {
        unsub?.();
        unsub = sim.events.on('disaster', (e) => {
          if (!e.active) return;
          if (e.kind === 'fire') firesMonth++;
          else disasterMonth = true;
        });
        subscribedTo = sim;
      }
      firesMonth = 0;
      disasterMonth = false;
      update(sim, true);
    },
    monthly(sim) {
      update(sim, false);
    },
  };
}

/**
 * Approval terms of the last monthly update (sum = econData.approvalRaw within rounding; WP5 TopBar tooltip).
 * Ordered by |value|, the baseline first; zero terms are left out.
 */
export function approvalBreakdown(st: CityState): FactorTerm[] {
  const d = st.systemData.economy as { approvalTerms?: Record<string, number> } | undefined;
  const T = d?.approvalTerms;
  if (!T) return [];
  const out: FactorTerm[] = [];
  for (const id in T) {
    const v = T[id];
    if (!v && id !== 'base') continue;
    out.push({ id, label: APPROVAL_LABELS[id] ?? id, value: v, detail: approvalDetail(st, id, T) });
  }
  out.sort((a, b) => (a.id === 'base' ? -1 : b.id === 'base' ? 1 : Math.abs(b.value) - Math.abs(a.value)));
  return out;
}

function approvalDetail(st: CityState, id: string, T: Record<string, number>): string | undefined {
  const s = st.stats;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
  const d = st.systemData.economy as { tourists?: number } | undefined;
  const sv = surveys.get(st);
  // the three service gaps hit their common limit: say so
  const gapSum = (T.garbage ?? 0) + (T.needs ?? 0) + (T.tapWater ?? 0);
  const limit = gapSum < 0 && Math.abs(gapSum - AT.gapMax) < 1e-6 ? ` (garbage, schools / clinics and tap water together cost at most ${-AT.gapMax})` : '';
  switch (id) {
    case 'tapWater': return `tap water ${pct(s.tapWater ?? 1)} clean${limit}`;
    case 'hq': return `HQ ${Math.round(s.hq)}`;
    case 'tourism': return `${n0(d?.tourists ?? 0)} tourists / day`;
    case 'unemployment': return `${pct(s.unemployment)} unemployed`;
    case 'justice': return `jail overflow ${pct(s.justice?.overflow ?? 0)}`;
    case 'noise': return sv ? `average noise at homes ${pct(sv.noise[3])}` : undefined;
    case 'garbage': return sv ? `${pct(sv.noGarbage[3])} of residents without garbage pickup${limit}` : undefined;
    case 'outages': return sv ? `${pct(sv.unpowered[3])} of residents without power, ${pct(sv.unwatered[3])} without water` : undefined;
    case 'needs': {
      const n = s.needs;
      if (!n) return undefined;
      const u = (n.elementary?.unreached ?? 0) + (n.high?.unreached ?? 0);
      const p = n.health?.unreached ?? 0;
      const parts: string[] = [];
      if (u >= 1) parts.push(`${n0(u)} pupils without a school in reach`);
      if (p >= 1) parts.push(`${n0(p)} patients without a clinic in reach`);
      return parts.length ? parts.join(', ') + limit : undefined;
    }
    default: return undefined;
  }
}
