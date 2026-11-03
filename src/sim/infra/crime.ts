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
 *
 *  B2 (docs/dev/B2_DESIGN.md §5): each of the three steps runs as a sequence of small pieces (one scheduler step each,
 *  about half INFRA_PIECE_COLD_MS estimated warm ms): the raw step over chunks of one building snapshot per pass, the
 *  blur by rows into crime-private buffers, the mix into a private buffer published by one .set(), the flags from a
 *  candidate list applied in one piece. A pass whose pieces run with nothing in between computes exactly what the
 *  pre-B2 steps computed.
 */
import { DevType, Zone } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { BF } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import { BoxVRun, boxHRows } from './blur';
import { BuildingSnapshot, Fam, infoOf, isFunctional, nowMs, readEffects, setFlagQuiet, wealthOf, type DefInfo } from './common';
import {
  CRIME_GARBAGE, CRIME_NIGHTLIFE, CRIME_SPILL, CRIME_THRESHOLD, INFRA_BLD_SIZING_US, INFRA_CELL_SIZING_US, INFRA_PIECE_COLD_MS,
  LOCAL_UNEMP_CI, LOCAL_UNEMP_R, YOUTH_CRIME, YOUTH_CRIME_MAX, YOUTH_PLAY, YOUTH_POP_FULL, YOUTH_POP_START,
  YOUTH_REF_TEENS,
} from './params';
import { pieceBudgetUs, pieceUnits, schedulerOf } from './scheduler';
import { ordinanceEffect } from '../economy/ordinances';
import { cohortShares } from '../economy/demographics';
import { addArrestPotential, justiceFactors } from './justice';
import { emergencyCrimeBoosts } from './emergency';
import type { TrafficSystem } from './traffic';

export const CRIME_PERIOD = 20;

// ---- B2 pieces (design §5). Sources (stepIdx 0): the pass start, the snapshot, its chunk plan, the building chunks, the
// spill venues + emergency boosts, the clamp (cell ranges; its last piece hands the arrest potential to justice).
const CS_START = 0, CS_SNAP = 1, CS_PLAN = 2, CS_BLD = 3, CS_SPILL = 4, CS_CLAMP = 5;
// spread (stepIdx 1): the copy, blur3's six box passes by rows, the mix into a private buffer (rows), its publish
const SP_COPY = 0, SP_BLUR = 1, SP_MIX = 2, SP_PUB = 3;
// flags (stepIdx 2): building chunks (sums, candidates), the publish (flags in order, stats), the events (batches)
const CF_BLD = 0, CF_PUB = 1, CF_EV = 2;
/**
 * B2 piece budget (design R2): every crime loop runs once per pass (every CRIME_PERIOD days), so it runs cold for many
 * passes after a load — the map-other prototype's split crime pieces ran at p99 ~20 x and up to 37 x their warm cost in
 * days 0-200 — half INFRA_PIECE_COLD_MS, like traffic's and services' once-per-pass loops (G1 / G2), with G2's cold cell
 * and Building floors (params INFRA_CELL_SIZING_US / INFRA_BLD_SIZING_US). The pure native fills / copies of a whole
 * layer (raw.fill, tmp.set, the publish) are one piece each, far below INFRA_PIECE_MS.
 */
const COLD = INFRA_PIECE_COLD_MS / 2;
/**
 * the absolute scale of the estimates: stepCost = CR_EST x (CR.piece + the piece's units x CR) / 1000. CR sets the relative
 * costs, so (with the budgets) the chunk sizes; CR_EST makes the estimate honest warm wall ms without moving a chunk
 * (traffic's TR_EST / services' SV_EST pattern).
 */
const CR_EST = 1;
/**
 * B2 cost model (design §9): estimated warm wall µs per work unit of each kind of piece. Start values: the crime mapping's
 * in-schedule fits (dense1m / bot256 / vet cities: sources 5 ns per building + 63 ns per footprint cell, spread 20.3 ns
 * per cell, flags 31 ns per building + 4.5 ns per footprint cell + 0.4 µs per event).
 */
const CR = {
  /** per piece (dispatch, cursors) */
  piece: 3,
  /** the pass start: raw.fill (per cell), context(), the resets */
  start: 20, fill: 0.0004,
  /** the snapshot (per building: buildingList + the copy) and its chunk plan (per building) */
  snapTake: 0.02, plan: 0.012,
  /** the raw step per building / footprint cell; the spill splats per venue cell, per boost cell; the clamp per cell */
  srcB: 0.007, srcF: 0.063, splat: 0.012, clamp: 0.0014,
  /** spread: blur3 per cell of one box pass, the mix per cell, the copies per cell */
  box: 0.0023, mix: 0.0057, copy: 0.0004,
  /** flags per building / footprint cell, the publish per candidate, per event */
  flagB: 0.031, flagF: 0.0045, apply: 0.05, event: 0.4,
} as const;
/** cells of one piece of a once-per-pass cell loop costing `us` per cell (the cold cell floor) */
function cellUnits(us: number, budget = COLD): number {
  return pieceUnits(us > INFRA_CELL_SIZING_US ? us : INFRA_CELL_SIZING_US, 1, budget);
}
/** rows of N cells of one such piece */
function rowUnits(us: number, N: number): number {
  return Math.max(1, Math.floor(cellUnits(us) / Math.max(1, N)));
}

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

  // ---- B2 piece state (design §5). Every field below is reset at each pass start and end and in init (resetPieces);
  // none is saved (R9).
  /** the piece inside the current state, and its cursor (chunk / row / event index) */
  private sub = 0;
  private cur = 0;
  /** the pass snapshot (R4): the raw step and the flags step walk it */
  private snap = new BuildingSnapshot();
  /** the raw step's context (computed once per pass at its first piece, as pre-B2 once per step) and arrest sum */
  private ctx: Ctx | null = null;
  private arrest = 0;
  /** CRIME_SPILL venues met by the building chunks (snapshot indices, list order) */
  private venues: number[] = [];
  /** blur3 by rows: its pass (0..2), half (H / V) and the V run */
  private blurP = 0;
  private blurV = false;
  private boxV = new BoxVRun();
  /** the mixed layer before its publish (design review 2 item 5a: the mix in pieces into a private buffer, one .set()) */
  private next = new Float32Array(0);
  /** flags: the occupant-weighted sums, the candidates (2 x snapshot index + the wanted BF.Crime bit, for each building
   *  whose bit flips) and the changed list */
  private fSum = 0;
  private fW = 0;
  private cand: number[] = [];
  private changed: Building[] = [];

  init(sim: Simulation): void {
    sim.state.systemData.infraVersion = 1;
    this.simRef = sim;
    // per-id DefInfo cache does not survive a new city (replaceState: building ids start again from 1)
    this.infos = [];
    this.lastRun = -1e9;
    this.stepIdx = -1;
    this.resetPieces();
    this.compute(sim, true);
    const self = this;
    schedulerOf(sim).register({
      name: 'crime',
      due: (s) => self.stepIdx >= 0 || s.state.day - self.lastRun >= CRIME_PERIOD,
      urgent: () => false,
      cost: (s) => self.stepCost(s),
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

  /**
   * one step (B2: one piece) of the crime pass. The state ids and transitions are the pre-B2 ones; a state stays current
   * until its last piece reports completion. A pass whose pieces run with nothing in between computes exactly what the
   * pre-B2 steps computed.
   */
  step(sim: Simulation): void {
    const t0 = nowMs();
    // (B2 review 1 O8: an explicit pass start — pre-B2 treated stepIdx 0 and -1 alike; a direct stepIdx = -1 (compute,
    // tests) starts with every cursor reset)
    if (this.stepIdx < 0) { this.resetPieces(); this.stepIdx = 0; }
    if (this.stepIdx === 0) { if (this.rawPiece(sim)) this.nextState(1); }
    else if (this.stepIdx === 1) { if (this.smoothPiece(sim, this.firstPass)) this.nextState(2); }
    else if (this.flagPiece(sim)) { this.stepIdx = -1; this.firstPass = false; this.resetPieces(); }
    this.lastMs = nowMs() - t0;
  }

  private nextState(s: number): void {
    this.stepIdx = s;
    this.sub = 0;
    this.cur = 0;
  }

  /** B2: every piece cursor back to its reset value; the pass's snapshot is released (R9) */
  private resetPieces(): void {
    this.sub = 0;
    this.cur = 0;
    this.snap.release();
    this.ctx = null;
    this.arrest = 0;
    this.venues.length = 0;
    this.blurP = 0;
    this.blurV = false;
    this.fSum = 0;
    this.fW = 0;
    this.cand.length = 0;
    this.changed.length = 0;
  }

  // ------------------------------------------------------------------------------------------------ B2 cost model
  /**
   * estimated warm wall ms of the next step (B2 §9: the next piece's own work counts x the CR coefficients, with the
   * piece's own chunk sizes). Pure and O(1): reads the cursors and sizes, never runs a loop, never sets anything up.
   */
  stepCost(sim: Simulation): number {
    return (CR_EST * (CR.piece + this.pieceUs(sim))) / 1000;
  }

  /** µs of the next piece (stepCost) */
  private pieceUs(sim: Simulation): number {
    const st = sim.state, C = st.cells, N = st.size;
    const rows = (us: number, left: number) => Math.max(0, Math.min(rowUnits(us, N), left)) * us * N;
    const cells = (us: number, left: number) => Math.max(0, Math.min(cellUnits(us), left)) * us;
    const snap = this.snap;
    switch (this.stepIdx) {
      case -1: return CR.start + C * CR.fill;
      case 0:
        switch (this.sub) {
          case CS_START: return CR.start + C * CR.fill;
          case CS_SNAP: return st.buildings.size * CR.snapTake;
          case CS_PLAN: return Math.max(0, Math.min(pieceUnits(CR.plan, 1, COLD), snap.n - snap.planned)) * CR.plan;
          case CS_BLD: return snap.countOf(this.cur) * CR.srcB + snap.cellsOf(this.cur) * CR.srcF;
          case CS_SPILL: return this.spillUs();
          default: return cells(CR.clamp, C - this.cur);
        }
      case 1:
        switch (this.sub) {
          case SP_COPY: return C * CR.copy;
          case SP_BLUR: return rows(CR.box, N - this.cur);
          case SP_MIX: return rows(CR.mix, N - this.cur);
          default: return C * CR.copy;
        }
      default:
        switch (this.sub) {
          case CF_BLD: return snap.countOf(this.cur) * CR.flagB + snap.cellsOf(this.cur) * CR.flagF;
          case CF_PUB: return this.cand.length * CR.apply + 2;
          default: return Math.max(0, Math.min(pieceUnits(CR.event, 1, COLD), this.changed.length - this.cur)) * CR.event + 2;
        }
    }
  }

  /** µs of the spill piece: the venues' splat areas (O(venues)) and a fixed allowance for the emergency boosts */
  private spillUs(): number {
    let cells = 0;
    const L = this.snap.list;
    for (let k = 0; k < this.venues.length; k++) {
      const b = L[this.venues[k]], sp = CRIME_SPILL[b.def];
      const r = sp ? sp.radius + Math.max(b.w, b.d) / 2 : 0;
      cells += (2 * r + 2) * (2 * r + 2);
    }
    return 5 + cells * CR.splat;
  }

  /** B2: the name of the next piece ('sources.bld#3'), for the step tools (b2work cpumap / profile labels) */
  get stepName(): string {
    switch (this.stepIdx) {
      case -1: return 'sources.start';
      case 0: return 'sources.' + ['start', 'snap', 'plan', 'bld', 'spill', 'clamp'][this.sub] + (this.sub === CS_BLD ? '#' + this.cur : '');
      case 1: return 'spread.' + ['copy', 'blur', 'mix', 'publish'][this.sub];
      default: return 'flags.' + ['bld', 'publish', 'events'][this.sub];
    }
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

  // ------------------------------------------------------------------------------------------------ raw step (state 0)
  /** the whole raw step in one go (pre-B2 name and semantics: the one-go reference) */
  private rawStep(sim: Simulation): void {
    if (this.stepIdx !== 0) { this.resetPieces(); this.stepIdx = 0; }
    while (!this.rawPiece(sim)) { /* pieces */ }
    this.nextState(1);
  }

  /** one piece of the raw step; true when the state is complete */
  private rawPiece(sim: Simulation): boolean {
    const st = sim.state;
    switch (this.sub) {
      case CS_START: this.rawStart(sim); this.sub = CS_SNAP; return false;
      case CS_SNAP:
        this.snap.take(st);
        // (chunks planned with the cold Building floor; CS_BLD's estimate keeps srcB / srcF)
        this.snap.planBegin(Math.max(CR.srcB, INFRA_BLD_SIZING_US), CR.srcF, pieceBudgetUs(COLD));
        this.sub = CS_PLAN;
        return false;
      case CS_PLAN:
        if (this.snap.planRun(pieceUnits(CR.plan, 1, COLD))) { this.sub = CS_BLD; this.cur = 0; }
        return false;
      case CS_BLD:
        if (this.cur < this.snap.chunks) this.rawBuildings(st, this.cur++);
        if (this.cur >= this.snap.chunks) this.sub = CS_SPILL;
        return false;
      case CS_SPILL: this.rawSpill(sim); this.sub = CS_CLAMP; this.cur = 0; return false;
      default: return this.rawClamp(st);
    }
  }

  /** the pass start: lastRun, the raw buffer, the context (once per pass, as pre-B2 once per raw step), the sums */
  private rawStart(sim: Simulation): void {
    const st = sim.state;
    const C = st.cells;
    this.lastRun = st.day;
    if (this.raw.length !== C) {
      this.raw = new Float32Array(C);
      this.tmp = new Float32Array(C);
    }
    this.raw.fill(0);
    this.ctx = this.context(sim);
    this.arrest = 0;
    this.venues.length = 0;
  }

  /** the raw crime of chunk k of the snapshot (pre-B2's loop body); the spill venues met on the way, in list order */
  private rawBuildings(st: CityState, k: number): void {
    const N = st.size;
    const raw = this.raw, ctx = this.ctx!, list = this.snap.list, venues = this.venues;
    let arrest = this.arrest;
    for (let bI = this.snap.bounds[k], b1 = this.snap.bounds[k + 1]; bI < b1; bI++) {
      const b = list[bI];
      // (pre-B2 walked the list a second time for the venues, after this loop: the same buildings in the same order)
      if (CRIME_SPILL[b.def] && isFunctional(b)) venues.push(bI);
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
    this.arrest = arrest;
  }

  /** nuisance venues spill crime around them; riots / failed incidents boost it (WP8) */
  private rawSpill(sim: Simulation): void {
    const st = sim.state;
    const N = st.size;
    const raw = this.raw, list = this.snap.list, mul = this.ctx!.mul;
    for (let k = 0; k < this.venues.length; k++) {
      const b = list[this.venues[k]];
      const sp = CRIME_SPILL[b.def];
      splat(raw, N, b.x + b.w / 2, b.z + b.d / 2, sp.radius + Math.max(b.w, b.d) / 2, sp.amount * mul);
    }
    const boosts = emergencyCrimeBoosts(sim);
    for (let k = 0; k < boosts.length; k++) {
      const e = boosts[k];
      splat(raw, N, e.x + 0.5, e.z + 0.5, Math.max(1, e.radius), e.amount);
    }
  }

  /** the clamp by cell ranges; its last piece hands the arrest potential to justice. True when the raw step is done */
  private rawClamp(st: CityState): boolean {
    const C = st.cells, raw = this.raw;
    const i1 = Math.min(C, this.cur + cellUnits(CR.clamp));
    for (let i = this.cur; i < i1; i++) if (raw[i] > 1) raw[i] = 1;
    this.cur = i1;
    if (i1 < C) return false;
    addArrestPotential(st, this.arrest);
    return true;
  }

  // ------------------------------------------------------------------------------------------------ smoothing (state 1)
  /** the whole smoothing step in one go (pre-B2 name and semantics) */
  private smoothStep(sim: Simulation, first: boolean): void {
    if (this.stepIdx !== 1) { this.stepIdx = 1; this.sub = 0; this.cur = 0; }
    while (!this.smoothPiece(sim, first)) { /* pieces */ }
    this.nextState(2);
  }

  /** one piece of the smoothing step (blur3 of the raw field by rows on crime-private buffers, the mix); true when done */
  private smoothPiece(sim: Simulation, first: boolean): boolean {
    const st = sim.state;
    const N = st.size, C = st.cells;
    switch (this.sub) {
      case SP_COPY: {
        // (pre-B2: a raw buffer of another size was rebuilt first)
        if (this.raw.length !== C) this.rawStep(sim);
        // spill onto neighbouring cells, keep peaks on buildings
        this.tmp.set(this.raw);
        this.tmpB();
        if (this.next.length !== C) this.next = new Float32Array(C);
        this.blurP = 0; this.blurV = false;
        this.sub = SP_BLUR;
        this.cur = 0;
        return false;
      }
      case SP_BLUR:
        if (this.blurPiece(N)) { this.sub = SP_MIX; this.cur = 0; }
        return false;
      case SP_MIX: {
        const raw = this.raw, tmp = this.tmp, L = st.crime, out = this.next;
        const alpha = first ? 1 : 0.4;
        const z1 = Math.min(N, this.cur + rowUnits(CR.mix, N));
        for (let i = this.cur * N, i1 = z1 * N; i < i1; i++) {
          let t = Math.max(raw[i] * 0.85, tmp[i]);
          if (t > 1) t = 1;
          out[i] = L[i] + (t - L[i]) * alpha;
        }
        this.cur = z1;
        if (z1 >= N) this.sub = SP_PUB;
        return false;
      }
      default:
        // (the publish piece: st.crime, a saved layer, changes in one piece — R7 / R9)
        st.crime.set(this.next.subarray(0, C));
        return true;
    }
  }

  /**
   * blur3(tmp, scratch, N, 1) by rows: three times boxH (tmp -> scratch) then boxV (scratch -> tmp), each in row ranges
   * (boxHRows; BoxVRun keeps its running column sums itself). Rows in order give blur3's result exactly. True when done.
   */
  private blurPiece(N: number): boolean {
    const r = 1, rows = rowUnits(CR.box, N);
    const a = this.tmp, t = this.scratch;
    if (!this.blurV) {
      const z1 = Math.min(N, this.cur + rows);
      boxHRows(a, t, N, r, this.cur, z1);
      this.cur = z1;
      if (z1 >= N) { this.blurV = true; this.boxV.begin(t, a, N, r); this.cur = 0; }
      return false;
    }
    const done = this.boxV.run(rows);
    this.cur = this.boxV.z;
    if (!done) return false;
    this.blurV = false;
    this.cur = 0;
    return ++this.blurP >= 3;
  }

  // ------------------------------------------------------------------------------------------------ flags (state 2)
  /** the whole flags step in one go (pre-B2 name and semantics) */
  private flagStep(sim: Simulation): void {
    if (this.stepIdx !== 2) { this.stepIdx = 2; this.sub = 0; this.cur = 0; }
    while (!this.flagPiece(sim)) { /* pieces */ }
  }

  /** one piece of the flags step; true when the pass is complete */
  private flagPiece(sim: Simulation): boolean {
    const st = sim.state;
    switch (this.sub) {
      case CF_BLD:
        if (this.cur === 0) this.flagSnapshot(st);
        if (this.cur < this.snap.chunks) this.flagBuildings(st, this.cur++);
        if (this.cur >= this.snap.chunks) { this.sub = CF_PUB; this.cur = 0; }
        return false;
      case CF_PUB: {
        // (the publish piece: the flags in snapshot order — pre-B2's changed list — and stats.avgCrime)
        const list = this.snap.list, changed = this.changed;
        changed.length = 0;
        for (let k = 0; k < this.cand.length; k++) {
          const q = this.cand[k];
          const b = list[q >> 1];
          if (setFlagQuiet(b, BF.Crime, (q & 1) !== 0)) changed.push(b);
        }
        st.stats.avgCrime = this.fW > 0 ? this.fSum / this.fW : 0;
        this.sub = CF_EV;
        this.cur = 0;
        return false;
      }
      default: {
        const changed = this.changed;
        const k1 = Math.min(changed.length, this.cur + pieceUnits(CR.event, 1, COLD));
        for (let k = this.cur; k < k1; k++) {
          const b = changed[k];
          // (R4: a snapshot building removed since gets no event; in an uninterrupted pass every one is live)
          if (st.buildings.get(b.id) === b) sim.events.emit('buildingChanged', b);
        }
        this.cur = k1;
        if (k1 < changed.length) return false;
        sim.events.emit('layerUpdated', 'crime');
        return true;
      }
    }
  }

  /**
   * the snapshot for the flags (B2: the pass snapshot of the raw step; a flags step run on its own — the one-go method
   * outside a pass — takes one)
   */
  private flagSnapshot(st: CityState): void {
    this.fSum = 0;
    this.fW = 0;
    this.cand.length = 0;
    if (this.snap.chunks > 0 || this.snap.n > 0) return;
    this.snap.take(st);
    this.snap.plan(Math.max(CR.srcB, INFRA_BLD_SIZING_US), CR.srcF, pieceBudgetUs(COLD));
  }

  /** chunk k of the flags: the weighted sums (doubles, list order) and the buildings whose BF.Crime bit flips */
  private flagBuildings(st: CityState, k: number): void {
    const N = st.size;
    const L = st.crime, list = this.snap.list, cand = this.cand;
    let sum = this.fSum, w = this.fW;
    for (let bI = this.snap.bounds[k], b1 = this.snap.bounds[k + 1]; bI < b1; bI++) {
      const b = list[bI];
      const ci = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
      const c = L[ci];
      const inf = this.info(st, b);
      const occ = inf.fam === Fam.R ? b.pop : b.jobs;
      if (occ > 0) { sum += c * occ; w += occ; }
      const on = c > CRIME_THRESHOLD;
      if (((b.flags & BF.Crime) !== 0) !== on) cand.push(bI * 2 + (on ? 1 : 0));
    }
    this.fSum = sum;
    this.fW = w;
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
