/**
 * Demographics core (SIM_DEPTH_SPEC WP1): who lives in a residential building, what they need, and how that feeds
 * back into the city. Headless: no DOM / three.js.
 *
 * COHORTS (per residential building, stored as Float32 fields b.kids / teens / yad / srs; adults = 1 − the sum):
 *   target t = normalize(HOUSEHOLD_PROFILE[form] ⊙ COHORT_WEALTH_MUL[w] ⊙ LIFE(building age) ⊙ PULL ⊙ VAR)
 *   form     house / apartment / tower (def.household, else HOUSEHOLD_BY_MODEL, else by stage)
 *   LIFE     new suburbs are full of children, 30 years later they are full of seniors (damped for apartments / towers)
 *   PULL     families move where schools / playgrounds are (famScore), students near colleges and transit (studScore),
 *            seniors near clinics, gardens, shops and quiet streets (senScore; × city HQ). Floor PULL_MIN.
 *   VAR      ±COHORT_VAR per building (deterministic hash of the id).
 *   A new building is seeded with t; afterwards shares move toward t with the turnover rate + the newcomer share.
 * WORKFORCE (b.wf) = adults × PART_ADULT[w] × (.94 + .06 min(1, HQ/100)) + young adults × (.7 working / .25 studying,
 *   study = college coverage × COLLEGE_WILL[w]) + teens × .06 + seniors × .10. Reference mix ≈ 0.55, house ≈ 0.49,
 *   tower ≈ 0.6. traffic uses pop × workerShare(b) as the building's commuting workers (one source of truth).
 * EDUCATION (b.edu, adults' attainment 0..1) drifts toward EDU_BASE + .35 elementary + .33 high + .20 college coverage at
 *   the home (time constant EDU_TAU_YEARS); newcomers bring the city mean. EQ = EQ_FLOOR + EQ_SPAN_STOCK × pop-avg(edu)
 *   (population system, monthly) — a closed school fades over years, not in one services pass.
 * NEEDS (needsOf / needsPenalty / evaluateNeeds): per cohort access 0..1 from the WP2 catchment layers (elementary →
 *   kids, high school → teens, college → young adults, clinics / hospitals → seniors, playgrounds → kids + teens, green,
 *   shops, transit for the car-less, quiet for seniors, jobs from traffic, tap water from utilities). Unmet needs lower
 *   the building's health target (capped NEEDS_PENALTY_MAX, scaled by needsExpectation: a town below NEEDS_POP_START
 *   expects little, a NEEDS_POP_FULL city a school on every street → vacancies; on their own never abandonment,
 *   NEEDS_ABANDON_SHARE) and set BF.NeedsUnmet when children / teens / seniors lack a school / clinic (gap >= 0.5,
 *   >= 3 people; also below NEEDS_POP_START, where it is information only: needsExpectation(st) === 0).
 * Without the services system (sim-core-only runs) coverage is COVERAGE_FALLBACK everywhere and there is no needs
 * penalty; buildings the demographics update never visited use the reference mix COHORT_BASE (cohortShares) so
 * infra-only simulations stay at the calibration mix.
 */
import type { Building, CityState } from '../CityState';
import { BF } from '../CityState';
import type { BuildingDef } from '../catalogTypes';
import type { Simulation } from '../Simulation';
import { DevType, Zone, zoneDensity } from '../../core/types';
import { hash2 } from '../../core/rng';
import { getDef } from '../catalog';
import {
  CARLESS_EFF, COHORT_BASE, COHORT_VAR, COHORT_WEALTH_MUL, COLLEGE_WILL, COVERAGE_FALLBACK, EDU_BASE, EDU_NEWCOMER,
  EDU_TAU_YEARS, EDU_W, EQ_FLOOR, EQ_SMOOTH_MONTHS, EQ_SPAN_STOCK, HOUSEHOLD_BY_MODEL, HOUSEHOLD_PROFILE, HQ_AIR,
  HQ_FLOOR, HQ_LAG_YEARS, HQ_NOISE, HQ_SPAN_ACCESS, HQ_TAP, LIFE_DAMP, NEEDS_PENALTY_MAX, NEEDS_POP_FULL, NEEDS_POP_START,
  NEEDS_UNMET_GAP,
  NEEDS_UNMET_PEOPLE, NEED_OK, NEED_W, PART_ADULT, PART_SENIOR, PART_TEEN, PART_YAD_STUDY, PART_YAD_WORK, PATIENT_W,
  PULL_MIN, QUIET_NOISE, QUIET_SPAN, TAP_SAFE, TURNOVER_PER_YEAR, WATER_REQUIRED_STAGE, WORKFORCE_RATIO,
} from './tuning';

/** 0 kids 0-11, 1 teens 12-17, 2 young adults 18-24, 3 adults 25-64, 4 seniors 65+ */
export type Cohort = 0 | 1 | 2 | 3 | 4;
export const COHORT_LABELS: readonly string[] = ['Children', 'Teens', 'Young adults', 'Adults', 'Seniors'];
export type HouseholdForm = 'house' | 'apartment' | 'tower';

// ------------------------------------------------------------------------------------------------ persistent data
/** demographics data persisted in state.systemData.demographics (plain numbers, save / load exact) */
export interface DemographicsData {
  v: 1;
  /** population-weighted mean education stock of residents (newcomers bring it) */
  eduMean: number;
  /** smoothed workforce / population ratio (demand, WP4) */
  wfRatio: number;
  /** smoothed traffic-based employment ratio (-1 = not set yet) */
  empRatio: number;
  /** workforce / population at the last OCC_PERIOD aggregation (daily workforce in between) */
  wfNow?: number;
  /** occupancy slice cursor: a loaded city continues the same visiting order (save / load continuity) */
  cursor?: number;
}
export function demographicsData(st: CityState): DemographicsData {
  let d = st.systemData.demographics as DemographicsData | undefined;
  if (!d || d.v !== 1) {
    d = { v: 1, eduMean: -1, wfRatio: WORKFORCE_RATIO, empRatio: -1 };
    st.systemData.demographics = d;
  }
  return d;
}

/** the simulation driving a state (set by the population system; lets UI queries read traffic / utilities) */
const simOfState = new WeakMap<CityState, Simulation>();
export function bindDemographics(sim: Simulation): void {
  simOfState.set(sim.state, sim);
}
export function demographicsSim(st: CityState): Simulation | undefined {
  const s = simOfState.get(st);
  return s && s.state === st ? s : undefined;
}

// ------------------------------------------------------------------------------------------------ household form
const MODEL_FORM = new Map<string, HouseholdForm>();
for (const f of ['house', 'apartment', 'tower'] as const) for (const m of HOUSEHOLD_BY_MODEL[f]) MODEL_FORM.set(m, f);
const formCache = new WeakMap<BuildingDef, HouseholdForm>();

/** household form of a residential def: def.household, else HOUSEHOLD_BY_MODEL, else by stage (<= 3 house, 4-5
 *  apartment, >= 6 tower), else by zone density */
export function householdForm(def?: BuildingDef, zone?: Zone): HouseholdForm {
  if (def) {
    const c = formCache.get(def);
    if (c) return c;
    let f: HouseholdForm | undefined = def.household;
    if (!f && def.model) f = MODEL_FORM.get(def.model.startsWith('res_') ? def.model.slice(4) : def.model);
    if (!f && def.stage !== undefined) f = def.stage <= 3 ? 'house' : def.stage <= 5 ? 'apartment' : 'tower';
    if (f) { formCache.set(def, f); return f; }
  }
  const d = zone !== undefined ? zoneDensity(zone) : 1;
  return d >= 3 ? 'tower' : d === 2 ? 'apartment' : 'house';
}

function wealthIdx(w: number): number {
  return w >= 3 ? 2 : w <= 1 ? 0 : 1;
}

/** normalised cohort shares [5] of a household form and wealth 1..3 (profile × wealth; used by WP6 for empty lots) */
export function profileShares(form: HouseholdForm, wealth: number, out: Float32Array = new Float32Array(5)): Float32Array {
  const P = HOUSEHOLD_PROFILE[form] ?? HOUSEHOLD_PROFILE.apartment;
  const M = COHORT_WEALTH_MUL[wealthIdx(wealth)];
  let s = 0;
  for (let c = 0; c < 5; c++) s += P[c] * M[c];
  for (let c = 0; c < 5; c++) out[c] = (P[c] * M[c]) / s;
  return out;
}

/** cohort shares [5] of a building: its fields when set, else the reference mix COHORT_BASE (never visited by the
 *  demographics update: infra-only simulations, the first days after loading an old save) */
export function cohortShares(b: Building, out: Float32Array = new Float32Array(5)): Float32Array {
  if (b.kids !== undefined && b.teens !== undefined && b.yad !== undefined && b.srs !== undefined) {
    out[0] = b.kids; out[1] = b.teens; out[2] = b.yad; out[4] = b.srs;
    out[3] = Math.max(0, 1 - b.kids - b.teens - b.yad - b.srs);
    return out;
  }
  for (let c = 0; c < 5; c++) out[c] = COHORT_BASE[c];
  return out;
}

/** workforce share of a building's residents (b.wf ?? WORKFORCE_RATIO) — traffic's commuting workers = pop × this */
export function workerShare(b: Building): number {
  return b.wf ?? WORKFORCE_RATIO;
}

/** WP1-4: share of residents without a car (poorer, young adults and seniors); WP7 charges them extra on car trips */
export function carlessShare(b: Building): number {
  return carlessOf(b.wealth, b.yad ?? COHORT_BASE[2], b.srs ?? COHORT_BASE[4]);
}
function carlessOf(wealth: number, yad: number, srs: number): number {
  const w = Math.max(1, Math.min(3, wealth || 1));
  return CARLESS_EFF[w - 1] * (0.5 + yad + srs);
}

/**
 * Give a building every optional WP1 field (undefined until written) in one fixed order. V8 gives objects one hidden
 * class per property set and order: if WP1 added kids..edu to homes and hire to businesses as it first writes them,
 * every creation site would split into three classes and every loop over buildings (all systems) would turn
 * polymorphic / megamorphic (on the 256² stress city that cost the population system alone 0.2-0.4 ms/day). A
 * self-assignment adds a missing field (value undefined: "derive from the profile") and is a no-op for present ones.
 */
export function ensureDemographicsFields(b: Building): void {
  b.kids = b.kids; b.teens = b.teens; b.yad = b.yad; b.srs = b.srs; b.wf = b.wf; b.edu = b.edu; b.hire = b.hire;
}

/** true when the building needs piped water (growables at stage >= WATER_REQUIRED_STAGE or zone density >= 2;
 *  plopped buildings with def.waterUse > 0) */
export function waterRequired(st: CityState, b: Building): boolean {
  const def = getDef(b.def);
  if (!def) return false;
  if (def.category !== 'growable') return (def.waterUse ?? 0) > 0;
  const N = st.size;
  const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
  return (def.stage ?? 1) >= WATER_REQUIRED_STAGE || zoneDensity(st.zone[i] as Zone) >= 2;
}

// ------------------------------------------------------------------------------------------------ local appeal
/** true when sim-infra's services system writes the coverage layers (else COVERAGE_FALLBACK everywhere) */
function servicesOn(st: CityState): boolean {
  if (st.systemData.infraVersion === undefined) return false;
  const l = st.systemData.infraLayers as { services?: boolean } | undefined;
  return l?.services ?? true;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** coverage / access values at a cell (scratch; COVERAGE_FALLBACK without the services system) */
interface Access { elem: number; high: number; college: number; health: number; play: number; green: number; shop: number; transit: number; crime: number; noise: number }
const ACC: Access = { elem: 0, high: 0, college: 0, health: 0, play: 0, green: 0, shop: 0, transit: 0, crime: 0, noise: 0 };
function accessAt(st: CityState, i: number, svc: boolean, out: Access = ACC): Access {
  if (svc) {
    out.elem = st.eduElemCov[i]; out.high = st.eduHighCov[i]; out.college = st.eduCollegeCov[i]; out.health = st.healthCov[i];
    out.play = st.playCov[i]; out.green = st.greenCov[i]; out.shop = st.shopAccess[i]; out.transit = st.transitCov[i];
  } else {
    const f = COVERAGE_FALLBACK;
    out.elem = out.high = out.college = out.health = out.play = out.green = out.shop = out.transit = f;
  }
  out.crime = st.crime[i];
  out.noise = st.noise[i];
  return out;
}
function famScore(a: Access): number {
  return clamp01(0.45 * a.elem + 0.2 * a.high + 0.2 * a.play + 0.15 * (1 - a.crime) - 0.1 * Math.max(0, a.noise - 0.3));
}
function studScore(a: Access): number {
  return clamp01(0.6 * a.college + 0.2 * a.transit + 0.2 * a.shop);
}
function senScore(a: Access): number {
  return clamp01(0.45 * a.health + 0.2 * a.green + 0.2 * a.shop + 0.15 * (1 - a.noise));
}

/** appeal 0..1 of cell i for families (schools, playgrounds, safety, quiet) — WP5 overlay variant, WP6 */
export function familyScoreAt(st: CityState, i: number): number {
  return famScore(accessAt(st, i, servicesOn(st)));
}
/** appeal 0..1 of cell i for seniors (clinics / hospitals, gardens, shops, quiet) */
export function seniorScoreAt(st: CityState, i: number): number {
  return senScore(accessAt(st, i, servicesOn(st)));
}
/** appeal 0..1 of cell i for students / young adults (college, transit, shops) */
export function studentScoreAt(st: CityState, i: number): number {
  return studScore(accessAt(st, i, servicesOn(st)));
}

// ------------------------------------------------------------------------------------------------ needs
export type NeedKind = 'elementary' | 'high' | 'college' | 'health' | 'play' | 'green' | 'shops' | 'jobs' | 'transit' | 'quiet' | 'water';
export interface NeedReport {
  /** cohort with the need, -1 = whole household */
  cohort: Cohort | -1;
  kind: NeedKind;
  /** e.g. "Elementary school", "Unsafe tap water" */
  label: string;
  /** people with this need in the building */
  people: number;
  /** access 0..1 */
  access: number;
  met: boolean;
  /** serving facility (building id), when known */
  providerId?: number;
}

const PLAY_TEEN = 0.7;
const REF_PLAY = COHORT_BASE[0] + PLAY_TEEN * COHORT_BASE[1];
const REF_GREEN = 0.8 + 1.2 * COHORT_BASE[4];
const REF_CARLESS = COHORT_BASE[2] + COHORT_BASE[4];

// (reciprocals: the access records are refilled for every home after each services pass, divisions dominated them)
const INV_NEED_OK = 1 / NEED_OK;
const INV_QUIET_SPAN = 1 / QUIET_SPAN;
function gap(a: number): number {
  return a >= NEED_OK ? 0 : (NEED_OK - a) * INV_NEED_OK;
}
function quietGap(noise: number): number {
  return clamp01((noise - QUIET_NOISE) * INV_QUIET_SPAN);
}

/** how much residents expect their needs to be met 0..1 (grows with the city: smoothstep over population) */
export function needsExpectation(st: CityState): number {
  return smoothstep(NEEDS_POP_START, NEEDS_POP_FULL, st.stats.population);
}

/**
 * per-day context of the demographics hot paths (population occupancy reads it once per day; the public functions
 * build a scratch one per call)
 */
export interface DemographicsCtx {
  /** services system writes the coverage layers */
  svc: boolean;
  /** needsExpectation */
  expectation: number;
  /** city mean education (newcomers) */
  eduMean: number;
  /** HQ terms: senior pull factor, adult participation factor */
  hqPull: number;
  hqPart: number;
}
export function demographicsCtx(st: CityState, out: DemographicsCtx = { svc: false, expectation: 0, eduMean: 0, hqPull: 1, hqPart: 1 }): DemographicsCtx {
  const hq = Math.max(0, st.stats.hq);
  const d = demographicsData(st);
  out.svc = servicesOn(st);
  out.expectation = needsExpectation(st);
  out.eduMean = d.eduMean >= 0 ? d.eduMean : EDU_NEWCOMER;
  out.hqPull = 0.85 + 0.3 * Math.min(1, hq / 150);
  out.hqPart = 0.94 + 0.06 * Math.min(1, hq / 100);
  return out;
}
const CTX_TMP: DemographicsCtx = { svc: false, expectation: 0, eduMean: 0, hqPull: 1, hqPart: 1 };

/** per-def constants of the cohort model (profile × wealth, life-cycle damping, wealth index) */
interface DefDemo { pm: Float64Array; damp: number; wi: number }
const defDemo = new Map<BuildingDef, DefDemo>();
function demoOf(def: BuildingDef): DefDemo {
  let d = defDemo.get(def);
  if (!d) {
    const wi = wealthIdx((def.devType ?? DevType.R2) + 1);
    const form = householdForm(def);
    const P = HOUSEHOLD_PROFILE[form], M = COHORT_WEALTH_MUL[wi];
    const pm = new Float64Array(5);
    for (let c = 0; c < 5; c++) pm[c] = P[c] * M[c];
    d = { pm, damp: LIFE_DAMP[form], wi };
    defDemo.set(def, d);
  }
  return d;
}

// ------------------------------------------------------------------------------------------------ access cache
/**
 * Access record of a home at its cell: the need gaps and amenity scores derived from the ~11 coverage / crime / noise
 * layers. The public functions compute it on the fly; the population system keeps them in a DemographicsCache (one
 * record per building id) that is refilled after every services pass and monthly instead of re-reading the layers on
 * every occupancy visit.
 */
interface AccessRec {
  gE: number; gH: number; gC: number; gS: number; gP: number; gG: number; gSh: number; gT: number; gQ: number;
  fam: number; stud: number; sen: number; eduT: number; col: number; noise: number;
}
const REC: AccessRec = { gE: 0, gH: 0, gC: 0, gS: 0, gP: 0, gG: 0, gSh: 0, gT: 0, gQ: 0, fam: 0, stud: 0, sen: 0, eduT: 0, col: 0, noise: 0 };
function accessRecord(st: CityState, i: number, svc: boolean, r: AccessRec = REC): AccessRec {
  const a = accessAt(st, i, svc);
  r.gE = gap(a.elem); r.gH = gap(a.high); r.gC = gap(a.college); r.gS = gap(a.health);
  r.gP = gap(a.play); r.gG = gap(a.green); r.gSh = gap(a.shop); r.gT = gap(a.transit); r.gQ = quietGap(a.noise);
  r.fam = famScore(a); r.stud = studScore(a); r.sen = senScore(a);
  r.eduT = clamp01(EDU_BASE + EDU_W[0] * a.elem + EDU_W[1] * a.high + EDU_W[2] * a.college);
  r.col = clamp01(a.college);
  r.noise = a.noise;
  return r;
}
/** raw needs penalty of a record for wealth index w and cohort shares */
function needsRaw(r: AccessRec, w: number, k0: number, k1: number, k2: number, k4: number): number {
  return NW_ELEM[w] * k0 * r.gE + NW_HIGH[w] * k1 * r.gH + NW_COLL[w] * k2 * r.gC + NW_HEALTH[w] * k4 * r.gS
    + NW_PLAY[w] * (k0 + PLAY_TEEN * k1) * r.gP + NW_GREEN[w] * (0.8 + 1.2 * k4) * r.gG + NW_SHOPS[w] * r.gSh
    + NW_TRANSIT[w] * (k2 + k4) * r.gT + NW_QUIET[w] * k4 * r.gQ;
}
/** largest cohort share among the kids / teens / seniors needs with a gap >= NEEDS_UNMET_GAP (0 = none): BF.NeedsUnmet
 *  when pop × this >= NEEDS_UNMET_PEOPLE */
function unmetShare(r: AccessRec, k0: number, k1: number, k4: number): number {
  let m = 0;
  if (r.gE >= NEEDS_UNMET_GAP && k0 > m) m = k0;
  if (r.gH >= NEEDS_UNMET_GAP && k1 > m) m = k1;
  if (r.gS >= NEEDS_UNMET_GAP && k4 > m) m = k4;
  return m;
}

/** DemographicsCache record layout (16 × 32 bit per building id = one 64-byte cache line) */
const C_STRIDE = 16;
const C_VER = 0, C_RAW = 1, C_UNMET = 2, C_NOISE = 3, C_LASTDAY = 4, C_LASTPOP = 5, C_HIRE = 6, C_FAM = 7, C_STUD = 8,
  C_SEN = 9, C_EDUT = 10, C_COL = 11, C_SEEN = 12, C_NEXT = 13;
/** record fields the population system reads after DemographicsCache.refresh (offset + REC_*): the raw needs penalty
 *  (folded with the cohort shares; × needsExpectation, capped), the unmet-needs share (BF.NeedsUnmet when
 *  pop × share >= NEEDS_UNMET_PEOPLE) and the night noise at the home */
export const REC_RAW = C_RAW, REC_UNMET = C_UNMET, REC_NOISE = C_NOISE;

/**
 * Per-simulation cache of the population system (never saved; rebuilt lazily):
 *  - one record per building id: needs penalty terms folded with the cohort shares at fill time, NeedsUnmet population
 *    threshold, night noise, amenity scores / education target / college coverage for the cohort targets — refilled
 *    after every services pass (invalidate; monthly without the services system: crime / noise drift), so the ~11
 *    coverage layers are read about once per fortnight per home instead of on every occupancy visit;
 *  - last demographics update day / population (update cadence, newcomer share) and the last written b.hire (the
 *    building's property store is only touched when the hiring factor changes);
 *  - a seen marker: the first time the population system meets a building it gets every optional WP1 field
 *    (ensureDemographicsFields: one hidden class per creation site);
 *  - wf: compact mirror of b.wf by id for the employment sampling (NaN = not set).
 */
export class DemographicsCache {
  version = 1;
  f = new Float32Array(0);
  i32 = new Int32Array(this.f.buffer);
  wf = new Float32Array(0);

  /** the coverage layers changed: every access record is refilled on its next use */
  invalidate(): void {
    this.version++;
  }
  ensure(id: number): void {
    const n0 = this.wf.length;
    if (id < n0) return;
    const n = Math.max(id + 1, n0 * 2, 1024);
    const f = new Float32Array(n * C_STRIDE);
    f.set(this.f);
    const i32 = new Int32Array(f.buffer);
    for (let k = n0; k < n; k++) { const o = k * C_STRIDE; i32[o + C_VER] = 0; i32[o + C_LASTDAY] = -1; f[o + C_HIRE] = NaN; }
    this.f = f;
    this.i32 = i32;
    const w = new Float32Array(n).fill(NaN);
    w.set(this.wf);
    this.wf = w;
  }
  /** seed the per-building bookkeeping from a (loaded) building and give it every optional WP1 field */
  sync(b: Building): void {
    this.ensure(b.id);
    const o = b.id * C_STRIDE;
    ensureDemographicsFields(b);
    this.i32[o + C_SEEN] = 1;
    this.f[o + C_LASTPOP] = b.pop;
    this.f[o + C_HIRE] = b.hire ?? NaN;
    this.wf[b.id] = b.wf ?? NaN;
  }
  /** first sight of a building (new since the cache was built): sync it; a no-op afterwards */
  touch(b: Building): void {
    const id = b.id;
    if (id >= this.wf.length || this.i32[id * C_STRIDE + C_SEEN] === 0) this.sync(b);
  }
  /** make building b's access record current (cell i; def: wealth for the needs weights); returns the record offset */
  refresh(st: CityState, b: Building, i: number, svc: boolean, def: BuildingDef): number {
    const id = b.id;
    this.ensure(id);
    const o = id * C_STRIDE;
    if (this.i32[o + C_VER] === this.version) return o;
    const r = accessRecord(st, i, svc);
    const w = def.devType ?? DevType.R2;
    const wi = w < 0 ? 0 : w > 2 ? 2 : w;
    const k0 = b.kids ?? COHORT_BASE[0], k1 = b.teens ?? COHORT_BASE[1], k2 = b.yad ?? COHORT_BASE[2], k4 = b.srs ?? COHORT_BASE[4];
    const f = this.f;
    f[o + C_RAW] = needsRaw(r, wi, k0, k1, k2, k4);
    f[o + C_UNMET] = unmetShare(r, k0, k1, k4);
    f[o + C_NOISE] = r.noise;
    f[o + C_FAM] = r.fam; f[o + C_STUD] = r.stud; f[o + C_SEN] = r.sen; f[o + C_EDUT] = r.eduT; f[o + C_COL] = r.col;
    this.i32[o + C_VER] = this.version;
    return o;
  }
  /** last demographics update day (-1 = none since this cache was built), the population then, and the day the next
   *  update is due (population system schedule) */
  lastDay(id: number): number {
    return id < this.wf.length ? this.i32[id * C_STRIDE + C_LASTDAY] : -1;
  }
  lastPop(id: number): number {
    return this.f[id * C_STRIDE + C_LASTPOP];
  }
  nextDay(id: number): number {
    return this.i32[id * C_STRIDE + C_NEXT];
  }
  /** a home that already carries its demographics (loaded save): start the update bookkeeping without an update */
  markUpdated(b: Building, day: number): void {
    this.touch(b);
    const o = b.id * C_STRIDE;
    this.i32[o + C_LASTDAY] = day;
    this.f[o + C_LASTPOP] = b.pop;
    this.wf[b.id] = b.wf ?? NaN;
  }
  setNextDay(id: number, day: number): void {
    this.ensure(id);
    this.i32[id * C_STRIDE + C_NEXT] = day;
  }
  /** write b.hire (1/256 steps) only when it changed; returns the hiring factor */
  setHire(b: Building, occ: number): number {
    const q = Math.fround(Math.round(Math.max(0, Math.min(1, occ)) * 256) / 256);
    const id = b.id;
    this.ensure(id);
    const o = id * C_STRIDE;
    if (this.f[o + C_HIRE] !== q) {
      if (this.i32[o + C_SEEN] === 0) this.sync(b); // first WP1 write: every optional field first (one hidden class)
      b.hire = q;
      this.f[o + C_HIRE] = q;
    }
    return q;
  }
}

/** result of evaluateNeeds (shared scratch — copy what you keep) */
export interface NeedsEval {
  /** health-target penalty 0..NEEDS_PENALTY_MAX (capped raw × needsExpectation) */
  penalty: number;
  /** uncapped sum of the need terms (before the city-size expectation) */
  raw: number;
  /** BF.NeedsUnmet condition: kids / teens / seniors lack a school / clinic (gap >= 0.5, >= 3 people) */
  unmet: boolean;
}
const EVAL: NeedsEval = { penalty: 0, raw: 0, unmet: false };
const SH = new Float32Array(5);

/**
 * needs penalty + NeedsUnmet condition of a residential building at cell i (0 / false without the services system or
 * for non-residential buildings). Returns a shared scratch object. ctx: the population system's per-day context.
 */
export function evaluateNeeds(st: CityState, b: Building, i: number, def: BuildingDef | undefined = getDef(b.def), ctx?: DemographicsCtx, cache?: DemographicsCache): NeedsEval {
  EVAL.penalty = 0; EVAL.raw = 0; EVAL.unmet = false;
  if (!def || def.devType === undefined || def.devType > DevType.R3) return EVAL;
  const c = ctx ?? demographicsCtx(st, CTX_TMP);
  if (!c.svc) return EVAL;
  let raw: number, share: number;
  if (cache) {
    // cached: needs terms folded with the cohort shares at fill time (refilled after every services pass and after
    // the home's own demographics update)
    const o = cache.refresh(st, b, i, true, def);
    raw = cache.f[o + C_RAW];
    share = cache.f[o + C_UNMET];
  } else {
    const r = accessRecord(st, i, true);
    const k0 = b.kids ?? COHORT_BASE[0], k1 = b.teens ?? COHORT_BASE[1], k2 = b.yad ?? COHORT_BASE[2], k4 = b.srs ?? COHORT_BASE[4];
    raw = needsRaw(r, def.devType, k0, k1, k2, k4);
    share = unmetShare(r, k0, k1, k4);
  }
  EVAL.raw = raw;
  EVAL.penalty = (raw < NEEDS_PENALTY_MAX ? raw : NEEDS_PENALTY_MAX) * c.expectation;
  EVAL.unmet = b.pop * share >= NEEDS_UNMET_PEOPLE;
  return EVAL;
}
/** NEED_W folded with the reference-share normalisation (weight / reference share of the cohort) */
const NW_ELEM = NEED_W.elementary.map((v) => v / COHORT_BASE[0]);
const NW_HIGH = NEED_W.high.map((v) => v / COHORT_BASE[1]);
const NW_COLL = NEED_W.college.map((v) => v / COHORT_BASE[2]);
const NW_HEALTH = NEED_W.health.map((v) => v / COHORT_BASE[4]);
const NW_PLAY = NEED_W.play.map((v) => v / REF_PLAY);
const NW_GREEN = NEED_W.green.map((v) => v / REF_GREEN);
const NW_SHOPS = NEED_W.shops;
const NW_TRANSIT = NEED_W.transit.map((v) => v / REF_CARLESS);
const NW_QUIET = NEED_W.quiet.map((v) => v / COHORT_BASE[4]);

/** health-target penalty 0..NEEDS_PENALTY_MAX from unmet cohort needs at cell i */
export function needsPenalty(st: CityState, b: Building, i: number): number {
  return evaluateNeeds(st, b, i).penalty;
}

/** duck-typed optional infra queries */
interface TrafficQ { workerAccess?: (id: number) => number }
interface UtilitiesQ { waterQualityAt?: (sim: Simulation, cell: number) => number }

/** tap-water quality 0..1 at a cell (utilities per-network quality, else stats.tapWater) */
export function tapWaterAt(sim: Simulation | undefined, st: CityState, cell: number): number {
  const u = sim?.getSystem('utilities') as unknown as UtilitiesQ | undefined;
  if (sim && u && typeof u.waterQualityAt === 'function') return u.waterQualityAt(sim, cell);
  return st.stats.tapWater ?? 1;
}

function buildingHasWater(st: CityState, b: Building): boolean {
  if (st.systemData.infraVersion === undefined) return true;
  const l = st.systemData.infraLayers as { utilities?: boolean } | undefined;
  if (!(l?.utilities ?? true)) return true;
  if (b.flags & BF.Watered) return true;
  return st.watered[b.z * st.size + b.x] === 1 || st.watered[(b.z + b.d - 1) * st.size + b.x + b.w - 1] === 1;
}

/**
 * needs of a residential building (WP5 inspector): every need with its cohort, people, access and met flag.
 * [] for non-residential buildings and without the services system (coverage unknown).
 */
export function needsOf(st: CityState, b: Building): NeedReport[] {
  const def = getDef(b.def);
  if (!def || def.devType === undefined || def.devType > DevType.R3 || !servicesOn(st)) return [];
  const N = st.size;
  const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
  const w = def.devType;
  const s = cohortShares(b, new Float32Array(5));
  const a = accessAt(st, i, true, { ...ACC });
  const p = b.pop;
  const out: NeedReport[] = [];
  const add = (cohort: Cohort | -1, kind: NeedKind, label: string, people: number, access: number, met = access >= NEED_OK) => {
    if (people < 0.5) return;
    out.push({ cohort, kind, label, people: Math.round(people), access: clamp01(access), met });
  };
  add(0, 'elementary', 'Elementary school', p * s[0], a.elem);
  add(1, 'high', 'High school', p * s[1], a.high);
  add(2, 'college', 'College / library', p * s[2] * COLLEGE_WILL[w], a.college);
  add(4, 'health', 'Clinic / hospital', p * s[4], a.health);
  add(0, 'play', 'Playground / sports', p * (s[0] + s[1]), a.play);
  add(-1, 'green', 'Parks & gardens', p, a.green);
  add(-1, 'shops', 'Shops within reach', p, a.shop);
  const carless = p * carlessOf(b.wealth, s[2], s[4]);
  add(-1, 'transit', 'Transit (car-less residents)', carless, a.transit);
  const qg = quietGap(a.noise);
  add(4, 'quiet', qg > 0 ? 'Quiet streets (too noisy)' : 'Quiet streets', p * s[4], 1 - qg, qg < NEEDS_UNMET_GAP);
  const sim = demographicsSim(st);
  const tr = sim?.getSystem('traffic') as unknown as TrafficQ | undefined;
  if (tr && typeof tr.workerAccess === 'function') {
    const acc = tr.workerAccess(b.id);
    if (acc >= 0) add(3, 'jobs', 'Jobs within commute', p * workerShare(b), acc, acc >= 0.9);
  }
  const needWater = waterRequired(st, b);
  const watered = buildingHasWater(st, b);
  if (!watered && needWater) add(-1, 'water', 'No water supply', p, 0, false);
  else if (watered && st.systemData.infraVersion !== undefined) {
    const q = tapWaterAt(sim, st, i);
    add(-1, 'water', q < TAP_SAFE ? 'Unsafe tap water' : 'Tap water', p, q, q >= TAP_SAFE);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ per-building update
const INV_EDU_TAU_DAYS = 1 / (360 * EDU_TAU_YEARS);
const T = new Float32Array(5);
const LIFE = new Float32Array(5);

/** life-cycle multipliers [5] of a household form at building age A (years), damped per form */
export function lifeCycle(form: HouseholdForm, ageYears: number, out: Float32Array = new Float32Array(5)): Float32Array {
  return lifeInto(LIFE_DAMP[form], ageYears, out);
}
/** smoothstep(a, a + 1 / inv, x) with a precomputed reciprocal span */
function ssInv(a: number, inv: number, x: number): number {
  const t = clamp01((x - a) * inv);
  return t * t * (3 - 2 * t);
}
function lifeInto(damp: number, A: number, out: Float32Array): Float32Array {
  const late = ssInv(40, 1 / 20, A); // smoothstep(40, 60, A)
  const k = 1.35 - 0.7 * ssInv(8, 1 / 22, A) + 0.3 * ssInv(35, 1 / 20, A);
  const t = 1.1 - 0.4 * ssInv(15, 1 / 20, A) + 0.2 * late;
  const s = 0.55 + 0.95 * ssInv(10, 1 / 25, A) - 0.3 * late;
  out[0] = 1 + (k - 1) * damp;
  out[1] = 1 + (t - 1) * damp;
  out[2] = 1;
  out[3] = 1;
  out[4] = 1 + (s - 1) * damp;
  return out;
}

/**
 * target cohort shares [5] of a residential building at cell i (profile × wealth × life cycle × amenity pull ×
 * per-building variation, normalised)
 */
export function targetShares(st: CityState, b: Building, def: BuildingDef, i: number, out: Float32Array = new Float32Array(5), ctx?: DemographicsCtx): Float32Array {
  const c = ctx ?? demographicsCtx(st, CTX_TMP);
  const r = accessRecord(st, i, c.svc);
  return targetFrom(b, def, r.fam, r.stud, r.sen, c, out);
}
function targetFrom(b: Building, def: BuildingDef, fam: number, stud: number, sen: number, c: DemographicsCtx, out: Float32Array): Float32Array {
  const dd = demoOf(def);
  const pm = dd.pm;
  lifeInto(dd.damp, b.age / 360, LIFE);
  const pullF = Math.max(PULL_MIN, 0.7 + 0.6 * fam);
  const pullY = Math.max(PULL_MIN, 0.7 + 0.6 * stud);
  const pullS = Math.max(PULL_MIN, (0.8 + 0.4 * sen) * c.hqPull);
  const id = b.id;
  const v0 = pm[0] * LIFE[0] * pullF * (1 + COHORT_VAR * (2 * hash2(id, 101) - 1));
  const v1 = pm[1] * LIFE[1] * pullF * (1 + COHORT_VAR * (2 * hash2(id, 102) - 1));
  const v2 = pm[2] * pullY * (1 + COHORT_VAR * (2 * hash2(id, 103) - 1));
  const v3 = pm[3] * (1 + COHORT_VAR * (2 * hash2(id, 104) - 1));
  const v4 = pm[4] * LIFE[4] * pullS * (1 + COHORT_VAR * (2 * hash2(id, 105) - 1));
  const inv = 1 / (v0 + v1 + v2 + v3 + v4);
  out[0] = v0 * inv; out[1] = v1 * inv; out[2] = v2 * inv; out[3] = v3 * inv; out[4] = v4 * inv;
  return out;
}

/** workforce share of a cohort mix at wealth 1..3 with college coverage and city HQ */
export function workforceShare(s: ArrayLike<number>, wealth: number, collegeCov: number, hq: number): number {
  return wfShare(s[1], s[2], s[3], s[4], wealthIdx(wealth), collegeCov, 0.94 + 0.06 * Math.min(1, Math.max(0, hq) / 100));
}
function wfShare(teens: number, yad: number, adults: number, srs: number, wi: number, collegeCov: number, hqPart: number): number {
  const study = clamp01(collegeCov) * COLLEGE_WILL[wi];
  return adults * PART_ADULT[wi] * hqPart + yad * (PART_YAD_WORK * (1 - study) + PART_YAD_STUDY * study) + teens * PART_TEEN + srs * PART_SENIOR;
}

/** education target 0..1 at cell i (EDU_BASE + weighted school coverage) */
export function educationTarget(st: CityState, i: number): number {
  const a = accessAt(st, i, servicesOn(st));
  return clamp01(EDU_BASE + EDU_W[0] * a.elem + EDU_W[1] * a.high + EDU_W[2] * a.college);
}

/**
 * per-building cohort / workforce / education update (runs in the occupancy slice every dtDays after the pop update).
 * pop0 = residents before this update (newcomers pull the mix toward the target and bring the city's mean education).
 * Fields are written as Math.fround so save / load (Float32 columns) is exact. ctx: the population system's per-day
 * context (built per call when omitted).
 */
export function updateDemographics(st: CityState, b: Building, def: BuildingDef, i: number, dtDays: number, pop0 = b.pop, ctx?: DemographicsCtx, cache?: DemographicsCache): void {
  const dev = def.devType;
  if (dev === undefined || dev > DevType.R3) return;
  const c = ctx ?? demographicsCtx(st, CTX_TMP);
  const id = b.id;
  let fam: number, stud: number, sen: number, eduT: number, col: number;
  if (cache) {
    cache.touch(b); // (first write: every optional WP1 field first, one hidden class)
    const o = cache.refresh(st, b, i, c.svc, def);
    const f = cache.f;
    fam = f[o + C_FAM]; stud = f[o + C_STUD]; sen = f[o + C_SEN]; eduT = f[o + C_EDUT]; col = f[o + C_COL];
  } else {
    const r = accessRecord(st, i, c.svc);
    fam = r.fam; stud = r.stud; sen = r.sen; eduT = r.eduT; col = r.col;
  }
  const t = targetFrom(b, def, fam, stud, sen, c, T);
  const pop1 = b.pop;
  let k0: number, k1: number, k2: number, k4: number;
  if (b.kids === undefined || b.teens === undefined || b.yad === undefined || b.srs === undefined) {
    k0 = t[0]; k1 = t[1]; k2 = t[2]; k4 = t[4];
  } else {
    const k = Math.min(1, (TURNOVER_PER_YEAR / 360) * dtDays + Math.max(0, pop1 - pop0) / Math.max(1, pop1));
    k0 = b.kids + (t[0] - b.kids) * k;
    k1 = b.teens + (t[1] - b.teens) * k;
    k2 = b.yad + (t[2] - b.yad) * k;
    k4 = b.srs + (t[4] - b.srs) * k;
  }
  b.kids = k0 = Math.fround(k0); b.teens = k1 = Math.fround(k1); b.yad = k2 = Math.fround(k2); b.srs = k4 = Math.fround(k4);
  const adults = Math.max(0, 1 - k0 - k1 - k2 - k4);
  const wf = (b.wf = Math.fround(wfShare(k1, k2, adults, k4, demoOf(def).wi, col, c.hqPart)));
  // education stock
  const mean = c.eduMean;
  let edu: number;
  if (b.edu === undefined) edu = mean;
  else {
    edu = b.edu + (eduT - b.edu) * Math.min(1, dtDays * INV_EDU_TAU_DAYS);
    if (pop1 > pop0 && pop1 > 0) edu = (edu * Math.max(0, pop0) + mean * (pop1 - pop0)) / pop1;
  }
  b.edu = Math.fround(clamp01(edu));
  if (cache) {
    const o = id * C_STRIDE;
    cache.i32[o + C_LASTDAY] = st.day;
    cache.f[o + C_LASTPOP] = pop1;
    cache.wf[id] = wf;
    cache.i32[o + C_VER] = 0; // the needs terms are folded with the shares: refill on the next visit
  }
}

// ------------------------------------------------------------------------------------------------ EQ / HQ
/** city context for the HQ target (pop-weighted at homes; tapWater per network via utilities when available) */
export interface HqInputs { patientAccess: number; air: number; noise: number; tapWater: number; medScore: number }

/** smoothed city education stock (pop-avg b.edu) → EQ target 0..150 */
export function eqTarget(avgEdu: number): number {
  return Math.max(0, Math.min(150, EQ_FLOOR + EQ_SPAN_STOCK * avgEdu));
}
/** HQ target 0..150 from patient-weighted health access, environment at homes and emergency medicine (WP1-2) */
export function hqTarget(h: HqInputs): number {
  const env = Math.max(0, 1 - HQ_AIR * h.air - HQ_NOISE * h.noise - HQ_TAP * (1 - h.tapWater));
  const med = 0.85 + 0.15 * Math.max(0, Math.min(1, h.medScore));
  return Math.max(0, Math.min(150, (HQ_FLOOR + HQ_SPAN_ACCESS * clamp01(h.patientAccess)) * env * med));
}

const HQ_IN: HqInputs = { patientAccess: 0, air: 0, noise: 0, tapWater: 1, medScore: 1 };
const defByName = (b: Building): BuildingDef | undefined => getDef(b.def);

/**
 * EQ / HQ step over dtDays (population system, monthly; only with the services system): EQ follows the residents'
 * education stock, HQ the patient-weighted health coverage at homes × air / noise / tap water × emergency medicine.
 * Returns false (nothing written) while no resident carries b.edu yet (services' legacy fallback keeps EQ / HQ).
 * defOf: def lookup (the population system passes its per-id cache; default getDef).
 */
export function updateEqHq(st: CityState, list: readonly Building[], dtDays: number, sim?: Simulation, defOf: (b: Building) => BuildingDef | undefined = defByName): boolean {
  const N = st.size;
  let pop = 0, edu = 0, patients = 0, pAcc = 0, air = 0, noise = 0, tapW = 0, tap = 0;
  const hasUtil = st.systemData.infraVersion !== undefined && ((st.systemData.infraLayers as { utilities?: boolean } | undefined)?.utilities ?? true);
  const util = sim?.getSystem('utilities') as unknown as UtilitiesQ | undefined;
  const wq = sim && util && typeof util.waterQualityAt === 'function' ? util : undefined;
  const meanTap = st.stats.tapWater ?? 1;
  const wat = st.watered;
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    if (b.pop <= 0 || b.edu === undefined || b.flags & (BF.Abandoned | BF.Burnt)) continue;
    const def = defOf(b);
    if (!def || def.devType === undefined || def.devType > DevType.R3) continue;
    const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
    const p = b.pop;
    const s = cohortShares(b, SH);
    const pw = p * (PATIENT_W[0] * s[0] + PATIENT_W[1] * s[1] + PATIENT_W[2] * s[2] + PATIENT_W[3] * s[3] + PATIENT_W[4] * s[4]);
    pop += p;
    edu += p * b.edu;
    patients += pw;
    pAcc += pw * Math.min(1, st.healthCov[i]);
    air += p * st.airPollution[i];
    noise += p * st.noise[i];
    // piped water (as buildingHasWater, with the infra checks hoisted out of the loop)
    if (hasUtil && (b.flags & BF.Watered || wat[b.z * N + b.x] === 1 || wat[(b.z + b.d - 1) * N + b.x + b.w - 1] === 1)) {
      tap += p * (wq ? wq.waterQualityAt!(sim!, i) : meanTap);
      tapW += p;
    }
  }
  if (pop <= 0) return false;
  const s = st.stats;
  HQ_IN.patientAccess = patients > 0 ? pAcc / patients : 0;
  HQ_IN.air = air / pop;
  HQ_IN.noise = noise / pop;
  HQ_IN.tapWater = tapW > 0 ? tap / tapW : s.tapWater ?? 1;
  HQ_IN.medScore = s.emergency?.medScore ?? 1;
  const eqT = eqTarget(edu / pop);
  const hqT = hqTarget(HQ_IN);
  if (dtDays > 0) {
    s.eq += (eqT - s.eq) * (1 - Math.exp(-dtDays / (30 * EQ_SMOOTH_MONTHS)));
    s.hq += (hqT - s.hq) * (1 - Math.exp(-dtDays / (360 * HQ_LAG_YEARS)));
  }
  return true;
}
