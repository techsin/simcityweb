/**
 * Crime system (every CRIME_PERIOD days, 3 scheduler steps): state.crime (0..1) per cell.
 *  Per building (raw step):
 *    density (occupants per cell) + poverty (R$ / CS$ / dirty industry) + unemployment (R: half city-wide, half the
 *    building's own job access from traffic) + low land value + abandonment + uncollected garbage
 *    + youth (R: teens from cohortShares, damped by high-school and playground / sports coverage, x 'crime.youth',
 *      phased in with town size YOUTH_POP_START .. YOUTH_POP_FULL residents)
 *    + nightlife (CS$$$ in high-density commercial),
 *    x ordinanceEffect 'crime.rate' (neighbourhood watch, gambling ...) x justice crimeMul (jail overflow, WP7),
 *    x (1 - 0.85 x police coverage x 'police.effect' x justice policeMul (unless services already applied it)).
 *    Painted on the footprint; CRIME_SPILL venues (casino, jail, stadium) and emergency crime boosts (riots / failed
 *    incidents, WP8) are splatted around their site. Arrest potential goes to justice (WP7).
 *  Blur step: blurred slightly (spills onto streets), smoothed in time.
 *  Flags step: BF.Crime on buildings above CRIME_THRESHOLD. stats.avgCrime = occupant-weighted mean.
 *  Emits layerUpdated('crime').
 */
import { DevType, Zone } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { BF } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import { blur3 } from './blur';
import { Fam, infoOf, isFunctional, nowMs, readEffects, setFlagQuiet, wealthOf, buildingList, type DefInfo } from './common';
import {
  CRIME_GARBAGE, CRIME_NIGHTLIFE, CRIME_SPILL, CRIME_THRESHOLD, LOCAL_UNEMP_CI, LOCAL_UNEMP_R, YOUTH_CRIME,
  YOUTH_CRIME_MAX, YOUTH_PLAY, YOUTH_POP_FULL, YOUTH_POP_START, YOUTH_REF_TEENS,
} from './params';
import { schedulerOf, sizeFactors } from './scheduler';
import { ordinanceEffect } from '../economy/ordinances';
import { cohortShares } from '../economy/demographics';
import { addArrestPotential, justiceFactors } from './justice';
import { emergencyCrimeBoosts } from './emergency';
import type { TrafficSystem } from './traffic';

export const CRIME_PERIOD = 20;

const POVERTY_BY_DEV: number[] = [];
POVERTY_BY_DEV[DevType.R1] = 0.28;
POVERTY_BY_DEV[DevType.R2] = 0.12;
POVERTY_BY_DEV[DevType.R3] = 0.04;
POVERTY_BY_DEV[DevType.CS1] = 0.14;
POVERTY_BY_DEV[DevType.CS2] = 0.08;
POVERTY_BY_DEV[DevType.CS3] = 0.05;
POVERTY_BY_DEV[DevType.CO2] = 0.05;
POVERTY_BY_DEV[DevType.CO3] = 0.03;
POVERTY_BY_DEV[DevType.IA] = 0.04;
POVERTY_BY_DEV[DevType.ID] = 0.16;
POVERTY_BY_DEV[DevType.IM] = 0.1;
POVERTY_BY_DEV[DevType.IHT] = 0.03;

function ordEffect(st: CityState, key: string): number {
  try {
    const v = ordinanceEffect(st, key);
    return typeof v === 'number' && isFinite(v) && v >= 0 ? v : 1;
  } catch {
    return 1;
  }
}

/** per-building crime terms of the last raw step (inspector / advisors "why is crime high here") */
export interface CrimeTerms {
  density: number;
  poverty: number;
  unemployment: number;
  landValue: number;
  abandoned: number;
  garbage: number;
  youth: number;
  nightlife: number;
  /** multiplier from ordinances and justice (1 = neutral) */
  multiplier: number;
  /** share removed by police 0..0.85 */
  police: number;
  /** final raw crime of the building 0..1 */
  total: number;
}

export class CrimeSystem implements SimSystem {
  readonly name = 'crime';
  private raw = new Float32Array(0);
  private tmp = new Float32Array(0);
  private lastRun = -1e9;
  private teens = new Float32Array(5);
  private simRef: Simulation | null = null;
  lastMs = 0;

  /** pass progress: -1 idle, 0 raw crime per building, 1 blur + smoothing, 2 flags + stats */
  private stepIdx = -1;
  private firstPass = false;

  init(sim: Simulation): void {
    sim.state.systemData.infraVersion = 1;
    this.simRef = sim;
    // per-id DefInfo cache does not survive a new city (replaceState: building ids start again from 1)
    this.infos = [];
    this.lastRun = -1e9;
    this.stepIdx = -1;
    this.compute(sim, true);
    const self = this;
    schedulerOf(sim).register({
      name: 'crime',
      due: (s) => self.stepIdx >= 0 || s.state.day - self.lastRun >= CRIME_PERIOD,
      urgent: () => false,
      cost: (s) => {
        const f = sizeFactors(s);
        return self.stepIdx <= 0 ? 0.4 * f.cells + 1.8 * f.bld : self.stepIdx === 1 ? 2.2 * f.cells : 0.8 * f.bld;
      },
      step: (s) => self.step(s),
    });
  }

  daily(sim: Simulation): void {
    schedulerOf(sim).tickDay(sim);
  }

  frame(sim: Simulation, _dt: number): void {
    schedulerOf(sim).tickFrame(sim, this);
  }

  /** full synchronous update (init / tests) */
  compute(sim: Simulation, first: boolean): void {
    const t0 = nowMs();
    this.stepIdx = -1;
    this.firstPass = first;
    do this.step(sim); while (this.stepIdx >= 0);
    this.lastMs = nowMs() - t0;
  }

  step(sim: Simulation): void {
    const t0 = nowMs();
    if (this.stepIdx <= 0) { this.rawStep(sim); this.stepIdx = 1; }
    else if (this.stepIdx === 1) { this.smoothStep(sim, this.firstPass); this.stepIdx = 2; }
    else { this.flagStep(sim); this.stepIdx = -1; this.firstPass = false; }
    this.lastMs = nowMs() - t0;
  }

  /** crime terms of one building now (same formula as the raw step; null if not found) */
  termsOf(id: number): CrimeTerms | null {
    const sim = this.simRef;
    const b = sim?.state.buildings.get(id);
    if (!sim || !b) return null;
    const ctx = this.context(sim);
    return { ...this.buildingTerms(sim.state, b, ctx, this.scratchTerms) };
  }

  private context(sim: Simulation): Ctx {
    const st = sim.state;
    const C = st.cells;
    const fx = readEffects(st);
    const jf = justiceFactors(st);
    // services (WP2) folds the police effect (ordinance 'police.effect' x justice policeMul) into policeCov: apply only
    // the justice difference since its last pass here, so both count once (WP2-3 / WP3-3); without it, apply both
    const svc = sim.getSystem('services') as unknown as { policeMul?: number; facilityLoadOf?: unknown } | undefined;
    const svcPolice = typeof svc?.policeMul === 'number' && svc.policeMul > 0;
    const applied = svcPolice ? (svc!.policeMul as number) : 1;
    // WP2 writes the catchment layers (high-school seats, play coverage), possibly all 0 in a young city; the legacy
    // education / park coverage is only a fallback without WP2 (never switch layers when the first school opens)
    const wp2 = typeof svc?.facilityLoadOf === 'function';
    let lvKnown = false;
    for (let i = 0; i < C; i += 97) if (st.landValue[i] > 0) { lvKnown = true; break; }
    return {
      mul: fx.crimeRate * jf.crimeMul,
      policeEff: (svcPolice ? 1 : fx.policeEffect) * (jf.policeMul / applied),
      // x 'crime.youth' (youth curfew) x town size (no youth gangs in a village; full from YOUTH_POP_FULL)
      youthMul: ordEffect(st, 'crime.youth') * Math.max(0, Math.min(1, ((st.stats.population || 0) - YOUTH_POP_START) / (YOUTH_POP_FULL - YOUTH_POP_START))),
      unemp: Math.max(0, Math.min(1, st.stats.unemployment || 0)),
      lvKnown,
      high: wp2 ? st.eduHighCov : st.eduCov,
      play: wp2 ? st.playCov : st.parkCov,
      traffic: sim.getSystem<TrafficSystem>('traffic') ?? null,
    };
  }

  /** DefInfo per building id (ids are never reused; known defs only) */
  private infos: DefInfo[] = [];
  private info(st: CityState, b: Building): DefInfo {
    let inf = this.infos[b.id];
    if (inf === undefined) {
      inf = infoOf(st, b);
      if (inf.known) this.infos[b.id] = inf;
    }
    return inf;
  }
  private scratchTerms: CrimeTerms = { density: 0, poverty: 0, unemployment: 0, landValue: 0, abandoned: 0, garbage: 0, youth: 0, nightlife: 0, multiplier: 1, police: 0, total: 0 };

  /** crime terms of building b into t (no allocation) */
  private buildingTerms(st: CityState, b: Building, ctx: Ctx, t: CrimeTerms): CrimeTerms {
    const N = st.size;
    const inf = this.info(st, b);
    const area = b.w * b.d;
    const occ = inf.fam === Fam.R ? b.pop : b.jobs;
    const ci = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
    t.poverty = 0; t.unemployment = 0; t.abandoned = 0; t.youth = 0; t.nightlife = 0; t.multiplier = ctx.mul;
    t.density = Math.min(1, occ / (area * 90)) * 0.3;
    if (inf.dev >= 0) t.poverty = POVERTY_BY_DEV[inf.dev] ?? 0.08;
    else if (inf.fam === Fam.R) t.poverty = wealthOf(inf, b) === 1 ? 0.28 : 0.1;
    else t.poverty = inf.isPark ? 0.06 : 0.03;
    if (inf.fam === Fam.R) {
      const acc = ctx.traffic ? ctx.traffic.workerAccess(b.id) : -1;
      // local: half the city rate, half the building's own job access (unknown access -> the city rate)
      t.unemployment = LOCAL_UNEMP_R * (acc >= 0 ? 0.5 * ctx.unemp + 0.5 * (1 - Math.min(1, acc)) : ctx.unemp);
      if (b.pop > 0) {
        const teens = cohortShares(b, this.teens)[1];
        const y = YOUTH_CRIME * (teens / YOUTH_REF_TEENS) * (1 - Math.min(1, ctx.high[ci])) * (1 - YOUTH_PLAY * Math.min(1, ctx.play[ci]));
        t.youth = Math.min(YOUTH_CRIME_MAX, Math.max(0, y)) * ctx.youthMul;
      }
    } else t.unemployment = ctx.unemp * LOCAL_UNEMP_CI;
    t.landValue = (1 - (ctx.lvKnown ? st.landValue[ci] : 0.5)) * 0.2;
    if (b.flags & BF.Abandoned) t.abandoned += 0.35;
    if (b.flags & BF.Burnt) t.abandoned += 0.1;
    t.garbage = CRIME_GARBAGE * Math.min(1, st.garbage[ci]);
    if (inf.dev === DevType.CS3 && st.zone[ci] === Zone.ComHigh) t.nightlife = CRIME_NIGHTLIFE;
    const base = t.density + t.poverty + t.unemployment + t.landValue + t.abandoned + t.garbage + t.youth + t.nightlife;
    t.police = 0.85 * Math.min(1, st.policeCov[ci] * ctx.policeEff);
    t.total = base * ctx.mul * (1 - t.police);
    return t;
  }

  private rawStep(sim: Simulation): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    this.lastRun = st.day;
    if (this.raw.length !== C) {
      this.raw = new Float32Array(C);
      this.tmp = new Float32Array(C);
    }
    const raw = this.raw;
    raw.fill(0);
    const ctx = this.context(sim);
    let arrest = 0;
    const list = buildingList(st);
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      if (b.built < 1 && (b.flags & BF.Abandoned) === 0) continue;
      const t = this.buildingTerms(st, b, ctx, this.scratchTerms);
      const c = t.total;
      const occ = this.info(st, b).fam === Fam.R ? b.pop : b.jobs;
      if (occ > 0 && t.police > 0) arrest += (c / Math.max(1e-6, 1 - t.police)) * occ * (t.police / 0.85);
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        raw[z * N + x] = c;
      }
    }
    // nuisance venues spill crime around them; riots / failed incidents boost it (WP8)
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const sp = CRIME_SPILL[b.def];
      if (!sp || !isFunctional(b)) continue;
      splat(raw, N, b.x + b.w / 2, b.z + b.d / 2, sp.radius + Math.max(b.w, b.d) / 2, sp.amount * ctx.mul);
    }
    const boosts = emergencyCrimeBoosts(sim);
    for (let k = 0; k < boosts.length; k++) {
      const e = boosts[k];
      splat(raw, N, e.x + 0.5, e.z + 0.5, Math.max(1, e.radius), e.amount);
    }
    for (let i = 0; i < C; i++) if (raw[i] > 1) raw[i] = 1;
    addArrestPotential(st, arrest);
  }

  private smoothStep(sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    if (this.raw.length !== C) this.rawStep(sim);
    const raw = this.raw;
    // spill onto neighbouring cells, keep peaks on buildings
    const tmp = this.tmp;
    tmp.set(raw);
    blur3(tmp, this.tmpB(), N, 1);
    const L = st.crime;
    const alpha = first ? 1 : 0.4;
    for (let i = 0; i < C; i++) {
      let t = Math.max(raw[i] * 0.85, tmp[i]);
      if (t > 1) t = 1;
      L[i] += (t - L[i]) * alpha;
    }
  }

  private flagStep(sim: Simulation): void {
    const st = sim.state;
    const N = st.size;
    const L = st.crime;
    const changed: Building[] = [];
    let sum = 0, w = 0;
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const ci = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
      const c = L[ci];
      const inf = this.info(st, b);
      const occ = inf.fam === Fam.R ? b.pop : b.jobs;
      if (occ > 0) { sum += c * occ; w += occ; }
      if (setFlagQuiet(b, BF.Crime, c > CRIME_THRESHOLD)) changed.push(b);
    }
    st.stats.avgCrime = w > 0 ? sum / w : 0;
    for (const b of changed) sim.events.emit('buildingChanged', b);
    sim.events.emit('layerUpdated', 'crime');
  }

  private scratch = new Float32Array(0);
  private tmpB(): Float32Array {
    if (this.scratch.length !== this.raw.length) this.scratch = new Float32Array(this.raw.length);
    return this.scratch;
  }
}

interface Ctx {
  mul: number;
  policeEff: number;
  youthMul: number;
  unemp: number;
  lvKnown: boolean;
  high: Float32Array;
  play: Float32Array;
  traffic: TrafficSystem | null;
}

/** add amount x (1 - d / r) to raw around (cx, cz) (cell-centre coordinates), within radius r */
function splat(raw: Float32Array, N: number, cx: number, cz: number, r: number, amount: number): void {
  if (!(amount > 0) || !(r > 0)) return;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx + r));
  const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(N - 1, Math.ceil(cz + r));
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
    if (d >= r) continue;
    raw[z * N + x] += amount * (1 - d / r);
  }
}

/** the crime system of a simulation */
export function getCrime(sim: Simulation): CrimeSystem | undefined {
  return sim.getSystem<CrimeSystem>('crime');
}
