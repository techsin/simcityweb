/**
 * Justice: arrests, the jail stock, holding cells and the courthouse (SIM_DEPTH_AMENDMENTS WP7-2, docs/SIM_DEPTH_PART_B.md
 * items 9 / 10). Headless: no DOM / three.js. Monthly (JusticeSystem, last infra system):
 *   arrests    = ARREST_K x arrest potential + emergency arrests of last month. The potential is the level of the latest
 *                crime raw pass (crime.ts: sum over buildings of raw crime x occupants x police reach), stored, not
 *                summed (crime passes are >= 20 days apart).
 *   sentenced  = arrests x smoothstep(5k, 40k, population) (a village's petty offenders are not jailed)
 *   inmates   += sentenced - inmates / SENTENCE_MONTHS, capped at INMATE_CAP x (beds + holding)
 *   beds       = sum of prison beds (civ_jail 2,500) x police funding; holding = police-station holding cells (kiosk 5,
 *                station 25, HQ 100) x police funding — so a town with a police station jails its few offenders
 *                without a prison (overflow <= 0.05 below the prison's 15k unlock)
 *   occupancy  = inmates / max(1, beds + holding); overflow = max(0, 12 sentenced - beds - holding) / max(1, 12 sentenced)
 *   factors    = policeMul (1 - 0.3 overflow) x (courthouse ? 1.08 : 1), crimeMul 1 + 0.15 overflow: offenders released
 *                early make patrols less effective and crime higher (60k residents without a prison: overflow ~0.7,
 *                policeMul ~0.79 — the legacy rule was 0.75 above 25k)
 *   riots      = occupancy > 1.2 for 3 months: hash(jail id, month) < 0.25 spawns a prison riot (WP8 incident) at a jail
 * justiceFactors(st) is a pure read of the persisted stats.justice (services / crime see the saved factors right after a
 * load). JusticeSystem.monthly also runs WP7a's facility bookkeeping (facilities.ts): the city job fill + BF.Understaffed
 * flags (staffing) and the airport / seaport / transit use factors; daily it tallies emergency vehicles per station.
 * Persistent: systemData.justice (JusticeData, plain data); stats.justice (JusticeStats).
 */
import type { Building, CityState, JusticeStats } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import { fundingFactor, isFunctional } from './common';
import {
  ARREST_K, COURTHOUSE_POLICE_MUL, INMATE_CAP, JUSTICE_CRIME_K, JUSTICE_POLICE_K, PRISON_RIOT_MONTHS, PRISON_RIOT_OCC, PRISON_RIOT_P,
  SENTENCE_MONTHS, SENTENCE_POP,
} from './params';
import { getDef } from '../catalog';
import { emergencyOf } from './emergency';
import { facilityDaily, facilityInit, facilityMonthly, justiceFactsOf, monthlyScan } from './facilities';

export interface JusticeFactors {
  /** multiplier on police effectiveness */
  policeMul: number;
  /** multiplier on raw crime */
  crimeMul: number;
}

/** persisted justice / facility bookkeeping (systemData.justice; plain data, structured-clone safe) */
export interface JusticeData {
  v: 1;
  /** inmate stock (a number: WP8's failed prison riot multiplies it by 0.7) */
  inmates: number;
  /** arrest potential of the latest crime raw pass (crime.ts addArrestPotential) */
  potential: number;
  /** consecutive months with occupancy above PRISON_RIOT_OCC */
  hot: number;
  /** month index of the last prison riot (-1 none) */
  riotMonth: number;
  /** WP7a facilities (facilities.ts): job-weighted fill of C / I sites (-1 = unknown) */
  cityFill: number;
  /** use factor per building id (airports, seaport, transit defs; missing = 1) */
  use: Record<string, number>;
  /** airports: passengers / day; seaport: trucks / day (-1 unknown) — report data of the last update */
  useData: Record<string, number>;
  /** emergency vehicles dispatched per station id: this month, last month; highest vehicle id counted */
  resp: Record<string, number>;
  respLast: Record<string, number>;
  respVid: number;
}

/** justice data of a state (created with defaults; missing fields of older records are filled in) */
export function justiceData(st: CityState): JusticeData {
  let d = st.systemData.justice as Partial<JusticeData> | undefined;
  if (!d || typeof d !== 'object') {
    d = {};
    st.systemData.justice = d;
  }
  if (d.v !== 1) d.v = 1;
  if (typeof d.inmates !== 'number' || !Number.isFinite(d.inmates)) d.inmates = Number.isFinite(st.stats.justice?.inmates) ? st.stats.justice.inmates : 0;
  if (typeof d.potential !== 'number' || !Number.isFinite(d.potential)) d.potential = 0;
  if (typeof d.hot !== 'number') d.hot = 0;
  if (typeof d.riotMonth !== 'number') d.riotMonth = -1;
  if (typeof d.cityFill !== 'number') d.cityFill = -1;
  if (!d.use || typeof d.use !== 'object') d.use = {};
  if (!d.useData || typeof d.useData !== 'object') d.useData = {};
  if (!d.resp || typeof d.resp !== 'object') d.resp = {};
  if (!d.respLast || typeof d.respLast !== 'object') d.respLast = {};
  if (typeof d.respVid !== 'number') d.respVid = 0;
  return d as JusticeData;
}

/** police / crime multipliers of the justice system: a pure read of the persisted stats.justice (neutral 1 / 1) */
export function justiceFactors(st: CityState): JusticeFactors {
  const j = st.stats.justice;
  const p = j?.policeMul, c = j?.crimeMul;
  return { policeMul: typeof p === 'number' && p > 0 && Number.isFinite(p) ? p : 1, crimeMul: typeof c === 'number' && c > 0 && Number.isFinite(c) ? c : 1 };
}

/** states whose JusticeSystem ran init (crime.init runs first: its potential waits in `pending` until justice.init) */
const bound = new WeakSet<CityState>();
const pending = new WeakMap<CityState, number>();

/**
 * crime.ts reports the arrest potential of a raw pass (sum over buildings of raw crime x occupants x police reach). Stored
 * as the level of the latest pass; before justice.init (crime.init's pass on load) it waits, and a saved level wins.
 */
export function addArrestPotential(st: CityState, v: number): void {
  if (!(v >= 0) || !Number.isFinite(v)) return;
  if (!bound.has(st)) { pending.set(st, v); return; }
  justiceData(st).potential = v;
}

/** effective prison beds / holding cells (x police funding) and courthouse presence of a state */
export interface JusticeCapacity {
  beds: number;
  holding: number;
  jails: number;
  courthouse: boolean;
}
export function justiceCapacity(st: CityState, plopped?: readonly Building[]): JusticeCapacity {
  const f = fundingFactor(st, 'police');
  let beds = 0, holding = 0, jails = 0, court = false;
  const list = plopped ?? monthlyScan(st).plopped;
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    if (!isFunctional(b)) continue;
    const jf = justiceFactsOf(b.def);
    if (jf.beds > 0) { beds += jf.beds; jails++; }
    holding += jf.holding;
    if (jf.court) court = true;
  }
  return { beds: beds * f, holding: holding * f, jails, courthouse: court && f > 0 };
}

/** a prison can be built (its unlock reached, sandbox, or one already stands); until then holding cells take the sentenced */
export function prisonAvailable(st: CityState, jails = 0): boolean {
  const req = getDef('civ_jail')?.requires;
  return jails > 0 || !req || !!st.config.sandbox || st.unlocked.has(req);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** deterministic 0..1 hash of (a, b) (no sim.rng draw) */
export function hash01(a: number, b: number): number {
  let h = (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** the monthly justice model (exported for tests); writes stats.justice and systemData.justice */
export function justiceMonthly(sim: Simulation, plopped?: readonly Building[]): void {
  const st = sim.state;
  const d = justiceData(st);
  const j = st.stats.justice as JusticeStats;
  const pop = Math.max(0, st.stats.population || 0);
  const em = st.stats.emergency?.lastMonth?.arrests ?? 0;
  const arrests = ARREST_K * Math.max(0, d.potential) + Math.max(0, em);
  const sentenced = arrests * smoothstep(SENTENCE_POP[0], SENTENCE_POP[1], pop);
  const cap = justiceCapacity(st, plopped);
  const places = cap.beds + cap.holding;
  let inmates = Math.max(0, Number.isFinite(d.inmates) ? d.inmates : 0);
  const releases = inmates / SENTENCE_MONTHS;
  inmates = Math.min(INMATE_CAP * places, inmates + sentenced - releases);
  if (!(inmates > 0)) inmates = 0;
  const yearly = 12 * sentenced;
  // no unfixable penalty (critic item 10): until the prison can be built, a city with holding cells (a police station)
  // gives its few sentenced offenders community service instead of releasing them early
  const canJail = prisonAvailable(st, cap.jails);
  const overflow = !canJail && places > 0 ? 0 : Math.max(0, yearly - places) / Math.max(1, yearly);
  const occupancy = inmates / Math.max(1, places);
  d.inmates = inmates;
  j.inmates = inmates;
  j.beds = Math.round(cap.beds);
  j.holding = Math.round(cap.holding);
  j.arrestsMonth = Math.round(arrests * 10) / 10;
  j.releasesMonth = Math.round(releases * 10) / 10;
  j.occupancy = Math.round(occupancy * 1000) / 1000;
  j.overflow = Math.round(overflow * 1000) / 1000;
  j.policeMul = Math.round((1 - JUSTICE_POLICE_K * j.overflow) * (cap.courthouse ? COURTHOUSE_POLICE_MUL : 1) * 1e4) / 1e4;
  j.crimeMul = Math.round((1 + JUSTICE_CRIME_K * j.overflow) * 1e4) / 1e4;
  // prison riots: a jail crowded for PRISON_RIOT_MONTHS months riots with PRISON_RIOT_P a month (position hash, no rng)
  d.hot = cap.jails > 0 && occupancy > PRISON_RIOT_OCC ? d.hot + 1 : 0;
  if (d.hot >= PRISON_RIOT_MONTHS) {
    const m = st.monthIndex;
    const em2 = emergencyOf(sim);
    if (em2?.active) {
      const list = plopped ?? monthlyScan(st).plopped;
      for (let k = 0; k < list.length; k++) {
        const b = list[k];
        if (!(justiceFactsOf(b.def).beds > 0) || !isFunctional(b) || !st.buildings.has(b.id)) continue;
        if (hash01(b.id, m) >= PRISON_RIOT_P) continue;
        if (em2.spawn(sim, 'prisonRiot', b.x, b.z, { buildingId: b.id }) >= 0) { d.riotMonth = m; break; }
      }
    }
  }
}

/** the justice system (monthly model + WP7a facility bookkeeping) */
export class JusticeSystem implements SimSystem {
  readonly name = 'justice';

  init(sim: Simulation): void {
    const st = sim.state;
    const had = st.systemData.justice !== undefined && typeof (st.systemData.justice as { potential?: unknown }).potential === 'number';
    const d = justiceData(st);
    // a saved potential (the uninterrupted run's latest crime pass) wins over crime.init's recomputation on load
    const p = pending.get(st);
    if (!had && p !== undefined) d.potential = p;
    pending.delete(st);
    bound.add(st);
    facilityInit(sim);
  }

  daily(sim: Simulation): void {
    facilityDaily(sim);
  }

  monthly(sim: Simulation): void {
    const scan = monthlyScan(sim.state); // one building scan for the month (justice + staffing + use factors)
    justiceMonthly(sim, scan.plopped);
    facilityMonthly(sim, scan);
  }
}

export function getJustice(sim: Simulation): JusticeSystem | undefined {
  return sim.getSystem<JusticeSystem>('justice');
}
