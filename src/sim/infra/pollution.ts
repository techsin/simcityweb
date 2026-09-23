/**
 * Pollution system: air, water, noise and garbage. Runs every POLL_PERIOD days in two stages on consecutive days
 * (A: sources + air, B: noise + water + garbage + flags) so no single day costs more than ~5 ms on 256^2.
 *
 *  Source model: catalog def.pollution.{air,water,noise} = intensity on the 0..1 overlay scale at the source with a
 *  falloff radius (negative = cleaning, e.g. water treatment). Converted to a source strength S = -K ln(1 - I) /
 *  POLL_PEAK_GAIN so an isolated emitter peaks at ~I; emitters are bucketed by radius into blur classes
 *  (air: full / half / quarter resolution, sigma ~2.4 / 4.9 / 9.8 cells; water & noise: half / quarter) and
 *  sources add up (industrial districts saturate). Growables scale with activity (0.3 + 0.7 x occupancy).
 *  Defs without explicit pollution fall back to per-job emission by industry type (AIR_PER_JOB ...).
 *  AIR    + traffic volume (x congestion) + landfill cells (util_landfill_tile def), wind drift, x ordinanceEffect
 *         'pollution.air' (x 'pollution.air.industry' for industry & power plants); layer = 1 - exp(-f / AIR_K).
 *  WATER  + sewage (pop, reduced by treatment plants: def.capacity or waterOut x 4 residents per kL/day), ground
 *         water blur; spreads along water bodies by iterative diffusion over water cells (persistent state).
 *  NOISE  traffic volume, def.pollution.noise (airports, stadiums, industry ...).
 *  GARBAGE production = def.pollution.garbage (t/month at full occupancy) x activity x 'garbage.produced';
 *         collection capacity = landfill zone cells with road access (util_landfill_tile garbageCapacity per cell) +
 *         def.garbageCapacity (incinerators, recycling) x utilities funding. When short, buildings farthest (road
 *         BFS) from facilities are not collected: state.garbage (0..1) builds up on their cells -> BF.NoGarbage.
 *         stats.garbageProduced / garbageCapacity (tons / month).
 *  Flags BF.Polluted (air > 0.45 or ground water > 0.6). stats.avgPollution (occupant weighted, 0.75 air + 0.25 water).
 *  Emits layerUpdated('pollution') after stage B.
 */
import { Network, Zone, isRoad } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { BF } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import { blur3, blurDownAdd, blurSigma2, shiftField } from './blur';
import {
  DX, DZ, Fam, activeJobs, detectJobsUnknown, ensureIdArray, ensureIdFloat, fundingFactor, infoOf, isFunctional, nowMs,
  readEffects, setFlagQuiet, activity, type OrdEffects,
  buildingList,
} from './common';
import { getDef } from '../catalog';
import { schedulerOf, sizeFactors } from './scheduler';
import {
  AIR_K, AIR_PER_JOB, AIR_PER_TRIP, GARBAGE_BUILDUP, GARBAGE_DECAY, GARBAGE_PER_CIVIC_JOB, GARBAGE_PER_JOB_C,
  GARBAGE_PER_JOB_I, GARBAGE_PER_RES, LANDFILL_AIR, LANDFILL_CELL_CAP, NOISE_K, NOISE_PER_JOB, NOISE_PER_TRIP,
  NO_GARBAGE_THRESHOLD, POLLUTED_THRESHOLD, POLL_PEAK_GAIN, POLL_RADII, POLL_SMOOTH, SEWAGE_PER_RES,
  TREATMENT_DEFAULT_CAP, TREATMENT_RES_PER_KL, WATER_K, WATER_POLL_PER_JOB, WIND_DRIFT,
} from './params';

/** 1 - exp(-x) lookup table on [0, 16) (x beyond -> 1) */
const SAT_N = 4096, SAT_MAX = 16;
const SAT = new Float32Array(SAT_N + 1);
for (let i = 0; i <= SAT_N; i++) SAT[i] = 1 - Math.exp(-(i / SAT_N) * SAT_MAX);
/** L[i] += (sat(field[i] * invK) - L[i]) * alpha, skipping cells where mask[i] != 0 */
function saturate(field: Float32Array, L: Float32Array, C: number, invK: number, alpha: number, mask: Uint8Array | null): void {
  const scale = (invK * SAT_N) / SAT_MAX;
  for (let i = 0; i < C; i++) {
    if (mask !== null && mask[i] !== 0) continue;
    const f = field[i];
    let t = 0;
    if (f > 0) {
      const u = f * scale;
      if (u >= SAT_N) t = 1;
      else { const k = u | 0; const a = SAT[k]; t = a + (SAT[k + 1] - a) * (u - k); }
    }
    L[i] += (t - L[i]) * alpha;
  }
}

/** source strength per unit of intensity: peak field for intensity I is -K ln(1 - I) (layer = 1 - exp(-f/K)) */
function srcScale(K: number): number {
  return K / POLL_PEAK_GAIN;
}
/** catalog intensity (0..1 at the source, negative = cleaning) -> source strength for the blur model */
function intensityToSource(I: number, scale: number): number {
  if (I === 0) return 0;
  const a = Math.min(0.95, Math.abs(I));
  const v = -Math.log(1 - a) * scale;
  return I < 0 ? -v : v;
}

const IND_KEYS = ['IA', 'ID', 'IM', 'IHT'] as const;
/** share kept per diffusion iteration along water bodies (higher = spreads farther downstream) */
const WATER_DIFFUSE_KEEP = 0.975;
/** days between pollution updates */
export const POLL_PERIOD = 12;


export class PollutionSystem implements SimSystem {
  readonly name = 'pollution';
  /** air sources by radius class (full / half / quarter resolution blur) */
  private air: Float32Array<ArrayBuffer>[] = [];
  /** water / noise sources by class (half / quarter resolution blur) */
  private waterS: Float32Array<ArrayBuffer>[] = [];
  private noiseS: Float32Array<ArrayBuffer>[] = [];
  /** non-empty flags: air 0..2, water 3..4, noise 5..6 */
  private usedCls = new Uint8Array(7);
  private tmp = new Float32Array(0);
  private tmp2 = new Float32Array(0);
  private coarse = new Float32Array(0);
  private coarseTmp = new Float32Array(0);
  private waterCells = new Int32Array(0);
  private waterNb = new Int32Array(0);
  private nWater = -1;
  private waterVersion = -1;
  private queue = new Int32Array(0);
  private visit = new Int32Array(0);
  private served = new Int32Array(1024);
  private prodById = new Float32Array(1024);
  private stamp = 0;
  private lastRun = -1e9;
  lastMs = 0;

  private unsub: (() => void)[] = [];

  init(sim: Simulation): void {
    for (const u of this.unsub) u();
    this.unsub = [sim.events.on('terrainChanged', () => this.invalidateWater()), sim.events.on('reset', () => this.invalidateWater())];
    sim.state.systemData.infraVersion = 1;
    this.lastRun = -1e9;
    this.nWater = -1;
    this.stepIdx = -1;
    this.compute(sim, true);
    const self = this;
    schedulerOf(sim).register({
      name: 'pollution',
      due: (s) => self.stepIdx >= 0 || s.state.day - self.lastRun >= POLL_PERIOD,
      urgent: () => false,
      cost: (s) => self.stepCost(s),
      step: (s) => self.step(s),
    });
  }

  /** pass progress: -1 idle, 0 sources, 1 air, 2 noise, 3 water, 4 garbage, 5 flags + stats */
  private stepIdx = -1;
  private firstPass = false;
  private fxB: OrdEffects | null = null;
  private jobsUnknownB = false;
  private dtMonthsB = 0;

  daily(sim: Simulation): void {
    schedulerOf(sim).tickDay(sim);
  }

  frame(sim: Simulation, _dt: number): void {
    schedulerOf(sim).tickFrame(sim, this);
  }

  private stepCost(sim: Simulation): number {
    const { cells, bld } = sizeFactors(sim);
    switch (this.stepIdx < 0 ? 0 : this.stepIdx) {
      case 0: return 1.2 * bld + 0.5 * cells;
      case 1: return 1.9 * cells;
      case 2: return 0.9 * cells;
      case 3: return 1.1 * cells;
      case 4: return 1.6 * bld + 0.5 * cells;
      default: return 0.6 * bld;
    }
  }

  /** one step of the pollution pass: sources / air / noise / water / garbage / flags */
  step(sim: Simulation): void {
    const t0 = nowMs();
    const k = this.stepIdx < 0 ? 0 : this.stepIdx;
    if (k === 0) this.stageA(sim, this.firstPass);
    else if (k === 1) this.stageAir(sim, this.firstPass);
    else if (k === 2) this.stageNoise(sim, this.firstPass);
    else if (k === 3) this.stageB(sim, this.firstPass);
    else if (k === 4) this.stageB2(sim, this.firstPass);
    else this.stageFlags(sim);
    this.stepIdx = k >= 5 ? -1 : k + 1;
    if (this.stepIdx < 0) this.firstPass = false;
    this.lastMs = nowMs() - t0;
  }

  /** full synchronous update (init / tests) */
  compute(sim: Simulation, first: boolean): void {
    const t0 = nowMs();
    this.stepIdx = -1;
    this.firstPass = first;
    do this.step(sim); while (this.stepIdx >= 0);
    this.lastMs = nowMs() - t0;
  }

  /** stage A: sources for all layers */
  private stageA(sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    if (this.tmp.length !== C) {
      this.air = [new Float32Array(C), new Float32Array(C), new Float32Array(C)];
      this.waterS = [new Float32Array(C), new Float32Array(C)];
      this.noiseS = [new Float32Array(C), new Float32Array(C)];
      this.tmp = new Float32Array(C);
      this.tmp2 = new Float32Array(C);
      this.queue = new Int32Array(C);
      this.visit = new Int32Array(C);
    }
    const M2 = Math.ceil(N / 2);
    if (this.coarse.length < M2 * M2) { this.coarse = new Float32Array(M2 * M2); this.coarseTmp = new Float32Array(M2 * M2); }
    const dtMonths = first ? 0 : Math.min(2, (st.day - this.lastRun) / 30);
    this.lastRun = st.day;
    const fx = readEffects(st);
    const jobsUnknown = detectJobsUnknown(st);
    const air = this.air, waterS = this.waterS, noiseS = this.noiseS;
    for (const a of air) a.fill(0);
    for (const a of waterS) a.fill(0);
    for (const a of noiseS) a.fill(0);
    const used = this.usedCls;
    used.fill(0);

    // treatment capacity -> sewage reduction
    let treatCap = 0;
    const util = Math.min(1, fundingFactor(st, 'utilities'));
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const inf = infoOf(st, b);
      if (!inf.isTreatment || !isFunctional(b)) continue;
      const cap = inf.capacity > 0 ? inf.capacity : inf.waterOut > 0 ? inf.waterOut * TREATMENT_RES_PER_KL : TREATMENT_DEFAULT_CAP;
      treatCap += cap * util;
    }
    const pop = Math.max(1, st.stats.population || 0);
    const treated = Math.min(1, treatCap / pop);
    const sewageMul = 1 - 0.9 * treated;
    const airK = srcScale(AIR_K), waterK = srcScale(WATER_K), noiseK = srcScale(NOISE_K);

    // --- sources from buildings
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const inf = infoOf(st, b);
      const onFire = (b.flags & BF.OnFire) !== 0;
      if (!isFunctional(b) && !onFire) continue;
      const area = b.w * b.d;
      const act = onFire && !isFunctional(b) ? 0 : 0.3 + 0.7 * activity(inf, b, jobsUnknown);
      const industrial = inf.fam === Fam.I || inf.powerOut > 0;
      const airMul = fx.air * (industrial ? fx.airIndustry : 1);
      const waterMul = fx.water * (inf.fam === Fam.I ? fx.waterIndustry : 1);
      let a = 0, w = 0, nz = 0;
      let ca = 1, cw = 0, cn = 0;
      if (inf.air !== 0 || inf.waterPoll !== 0 || inf.noise !== 0) {
        // catalog semantics: intensity (0..1 overlay scale) at the source, falling off to 0 at radius
        const R = inf.pollRadius > 0 ? inf.pollRadius : 3;
        ca = R <= 6 ? 0 : R <= 13 ? 1 : 2;
        cw = cn = R <= 8 ? 0 : 1;
        a = intensityToSource(inf.air, airK) * act * airMul;
        w = intensityToSource(inf.waterPoll, waterK) * (inf.waterPoll > 0 ? act * waterMul : util);
        nz = intensityToSource(inf.noise, noiseK) * act;
      } else if (inf.fam === Fam.I) {
        // fallback when the def carries no explicit pollution: per active job by industry type
        const k = IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))];
        const j = activeJobs(inf, b, jobsUnknown);
        a = j * AIR_PER_JOB[k] * airMul;
        w = j * WATER_POLL_PER_JOB[k] * waterMul;
        nz = j * NOISE_PER_JOB[k];
      }
      if (inf.fam === Fam.R) w += b.pop * SEWAGE_PER_RES * sewageMul * fx.water;
      if (onFire) { a += intensityToSource(0.5, airK) * area; ca = 0; }
      if (a === 0 && w === 0 && nz === 0) continue;
      const ia = a / area, iw = w / area, inz = nz / area;
      const A = air[ca], W = waterS[cw], Nz = noiseS[cn];
      if (ia !== 0) used[ca] = 1;
      if (iw !== 0) used[3 + cw] = 1;
      if (inz !== 0) used[5 + cn] = 1;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        A[i] += ia;
        W[i] += iw;
        Nz[i] += inz;
      }
    }
    // --- traffic + landfill cells (util_landfill_tile def pollution per landfill cell)
    const traffic = st.traffic, cong = st.congestion, net = st.network, zone = st.zone;
    const A0 = air[0], W0 = waterS[0], N0 = noiseS[0];
    const lf = getDef('util_landfill_tile')?.pollution;
    const lfAir = lf ? intensityToSource(lf.air ?? 0, airK) * fx.air : LANDFILL_AIR;
    const lfWater = lf ? intensityToSource(lf.water ?? 0, waterK) * fx.water : 0;
    const lfNoise = lf ? intensityToSource(lf.noise ?? 0, noiseK) : 0;
    const trafficAir = AIR_PER_TRIP * fx.air;
    for (let i = 0; i < C; i++) {
      const t = traffic[i];
      if (t > 0) {
        const n = net[i];
        if (n >= 1 && n <= 5) {
          const c = cong[i];
          A0[i] += t * trafficAir * (1 + (c < 2 ? c : 2));
          N0[i] += t * NOISE_PER_TRIP;
          used[0] = 1; used[5] = 1;
        } else if (n === Network.Rail) {
          N0[i] += t * NOISE_PER_TRIP * 0.2;
          used[5] = 1;
        }
      }
      if (zone[i] === Zone.Landfill && st.building[i] < 0) {
        A0[i] += lfAir; W0[i] += lfWater; N0[i] += lfNoise;
        used[0] = 1; used[3] = 1; used[5] = 1;
      }
    }
    this.fxB = fx;
    this.jobsUnknownB = jobsUnknown;
    this.dtMonthsB = dtMonths;
  }

  /** stage A2: blur air per class (full / half / quarter resolution), sum with gains, wind drift, map to 0..1 */
  private stageAir(sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const air = this.air, used = this.usedCls;
    // --- blur air per class (full / half / quarter resolution), sum with gains, wind drift
    const tmp = this.tmp, tmp2 = this.tmp2;
    const field = tmp2;
    {
      field.fill(0);
      // small emitters at half resolution (radius 1 -> sigma^2 = 4 * 2 = 8 cells^2, ~ full-res radius 2)
      if (used[0]) blurDownAdd(air[0], field, N, 2, 1, POLL_PEAK_GAIN * 2 * Math.PI * 8, this.coarse, this.coarseTmp);
      for (let c = 1; c < 3; c++) {
        if (!used[c]) continue;
        const f = c === 1 ? 2 : 4;
        const rr = Math.max(1, Math.round(POLL_RADII[c] / f));
        blurDownAdd(air[c], field, N, f, rr, POLL_PEAK_GAIN * 2 * Math.PI * f * f * blurSigma2(rr), this.coarse, this.coarseTmp);
      }
    }
    const ang = (st.day / 360) * Math.PI * 2 * 0.7 + Math.sin(st.day * 0.05) * 1.3;
    shiftField(field, tmp, N, Math.cos(ang) * WIND_DRIFT, Math.sin(ang) * WIND_DRIFT);
    const alpha = first ? 1 : POLL_SMOOTH;
    const airL = st.airPollution;
    saturate(tmp, airL, C, 1 / AIR_K, alpha, null);
  }

  /** blur a 2-class (half / quarter resolution) source pair into `out` (cleared) */
  private blurPair(src: Float32Array[], usedBase: number, out: Float32Array, N: number): void {
    out.fill(0);
    // class 0: half res r=1 (sigma^2 = 8), class 1: quarter res r=2 (sigma^2 = 96)
    if (this.usedCls[usedBase]) blurDownAdd(src[0], out, N, 2, 1, POLL_PEAK_GAIN * 2 * Math.PI * 8, this.coarse, this.coarseTmp);
    if (this.usedCls[usedBase + 1]) blurDownAdd(src[1], out, N, 4, 2, POLL_PEAK_GAIN * 2 * Math.PI * 96, this.coarse, this.coarseTmp);
  }

  /** stage B: noise, water, garbage, flags & stats (uses the sources collected by stage A) */
  /** stage B0: noise layer */
  private stageNoise(sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    this.blurPair(this.noiseS, 5, this.tmp, N);
    saturate(this.tmp, st.noise, C, 1 / NOISE_K, first ? 1 : POLL_SMOOTH, null);
  }

  /** stage B1: water pollution (ground water + diffusion along water bodies) */
  private stageB(sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const tmp = this.tmp, tmp2 = this.tmp2;
    const alpha = first ? 1 : POLL_SMOOTH;
    // --- water: ground water blur (negative = treatment cleaning) + diffusion along water bodies
    {
      this.blurPair(this.waterS, 3, tmp, N);
      const L = st.waterPollution;
      const wm = st.water;
      // negative sources (treatment plants) also clean nearby water bodies
      for (let i = 0; i < C; i++) if (wm[i] && tmp[i] < 0) L[i] = Math.max(0, L[i] + tmp[i] * 0.05);
      saturate(tmp, L, C, 1 / WATER_K, alpha, wm);
      // diffusion over water cells (precomputed list + 4 neighbour slots: water idx or -(land cell)-1)
      this.ensureWaterList(st);
      const nW = this.nWater, wc = this.waterCells, wnb = this.waterNb;
      const cur = tmp2, nxt = tmp;
      for (let q = 0; q < nW; q++) cur[q] = L[wc[q]];
      const iters = 8;
      for (let it = 0; it < iters; it++) {
        for (let q = 0; q < nW; q++) {
          let s = cur[q], n = 1, inflow = 0;
          const b = q * 4;
          for (let k = 0; k < 4; k++) {
            const t = wnb[b + k];
            if (t === 0x7fffffff) continue;
            if (t >= 0) { s += cur[t]; n++; }
            else { const lv = L[-t - 1]; if (lv > inflow) inflow = lv; }
          }
          const v = (s / n) * WATER_DIFFUSE_KEEP + inflow * 0.12;
          nxt[q] = v > 1 ? 1 : v;
        }
        for (let q = 0; q < nW; q++) cur[q] = nxt[q];
      }
      for (let q = 0; q < nW; q++) L[wc[q]] = cur[q];
    }
  }

  /** stage B2: garbage, flags & stats */
  private stageB2(sim: Simulation, _first: boolean): void {
    const st = sim.state;
    const N = st.size;
    const airL = st.airPollution;
    const fx = this.fxB ?? readEffects(st);
    const jobsUnknown = this.jobsUnknownB, dtMonths = this.dtMonthsB;
    // --- garbage
    this.garbage(sim, dtMonths, fx.garbage, jobsUnknown);
  }

  /** stage B3: flags & stats */
  private stageFlags(sim: Simulation): void {
    const st = sim.state;
    const N = st.size;
    const airL = st.airPollution;
    // --- flags & stats
    const changed: Building[] = [];
    let polSum = 0, polN = 0;
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const cx = Math.min(N - 1, b.x + (b.w >> 1)), cz = Math.min(N - 1, b.z + (b.d >> 1));
      const i = cz * N + cx;
      const a = airL[i], w = st.waterPollution[i];
      const weight = b.pop > 0 ? b.pop : Math.max(1, b.jobs * 0.5);
      polSum += (0.75 * a + 0.25 * w) * weight;
      polN += weight;
      if (setFlagQuiet(b, BF.Polluted, a > POLLUTED_THRESHOLD || w > 0.6)) changed.push(b);
    }
    st.stats.avgPollution = polN > 0 ? polSum / polN : 0;
    for (const b of changed) sim.events.emit('buildingChanged', b);
    sim.events.emit('layerUpdated', 'pollution');
  }

  /** mark water topology dirty (terrain changed) */
  invalidateWater(): void {
    this.nWater = -1;
  }

  private ensureWaterList(st: CityState): void {
    if (this.nWater >= 0 && this.waterVersion === st.cells) return;
    const N = st.size, C = st.cells, wm = st.water;
    let n = 0;
    const idx = new Int32Array(C).fill(-1);
    for (let i = 0; i < C; i++) if (wm[i]) idx[i] = n++;
    this.waterCells = new Int32Array(n);
    this.waterNb = new Int32Array(n * 4);
    for (let i = 0, q = 0; i < C; i++) {
      if (!wm[i]) continue;
      this.waterCells[q] = i;
      const x = i % N, z = (i - x) / N;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], nz = z + DZ[k];
        let t = 0x7fffffff;
        if (nx >= 0 && nz >= 0 && nx < N && nz < N) {
          const j = nz * N + nx;
          t = wm[j] ? idx[j] : -j - 1;
        }
        this.waterNb[q * 4 + k] = t;
      }
      q++;
    }
    this.nWater = n;
    this.waterVersion = C;
  }

  private garbage(sim: Simulation, dtMonths: number, prodMul: number, jobsUnknown: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const net = st.network, zone = st.zone, bld = st.building;
    const G = st.garbage;
    const funding = Math.min(1.2, fundingFactor(st, 'utilities'));
    // production per building
    let produced = 0;
    this.served = ensureIdArray(this.served, st);
    this.prodById = ensureIdFloat(this.prodById, st);
    const prod = this.prodById;
    const seeds: number[] = [];
    let capacity = 0;
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const inf = infoOf(st, b);
      prod[b.id] = 0;
      if (inf.garbageCap > 0 && isFunctional(b)) {
        capacity += inf.garbageCap * funding;
        seedPerimeter(st, b, seeds);
        continue;
      }
      if (!isFunctional(b)) continue;
      let p = 0;
      if (inf.garbage > 0) p = inf.garbage * (inf.fam === Fam.Plop ? 1 : activity(inf, b, jobsUnknown)); // catalog: t/month at full occupancy
      else if (inf.fam === Fam.R) p = b.pop * GARBAGE_PER_RES;
      else if (inf.fam === Fam.C) p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_JOB_C;
      else if (inf.fam === Fam.I) p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_JOB_I[IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))]];
      else p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_CIVIC_JOB;
      p *= prodMul;
      if (p > 0) { prod[b.id] = p; produced += p; }
    }
    // landfill cells with road access (flood fill landfill regions, region counts if it touches a road)
    const visit = this.visit, queue = this.queue;
    const stampL = ++this.stamp;
    let landfillCells = 0;
    for (let s = 0; s < C; s++) {
      if (zone[s] !== Zone.Landfill || bld[s] >= 0 || visit[s] === stampL) continue;
      let qh = 0, qt = 0;
      queue[qt++] = s;
      visit[s] = stampL;
      let road = false;
      while (qh < qt) {
        const i = queue[qh++];
        const x = i % N, z = (i - x) / N;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k], nz = z + DZ[k];
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const j = nz * N + nx;
          if (isRoad(net[j] as Network)) road = true;
          if (zone[j] === Zone.Landfill && bld[j] < 0 && visit[j] !== stampL) { visit[j] = stampL; queue[qt++] = j; }
        }
      }
      if (!road) {
        for (let q = 0; q < qt; q++) G[queue[q]] = 0.35;
        continue;
      }
      landfillCells += qt;
      for (let q = 0; q < qt; q++) {
        const i = queue[q];
        const x = i % N, z = (i - x) / N;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k], nz = z + DZ[k];
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const j = nz * N + nx;
          if (isRoad(net[j] as Network)) seeds.push(j);
        }
      }
    }
    const lfCap = getDef('util_landfill_tile')?.garbageCapacity ?? LANDFILL_CELL_CAP;
    capacity += landfillCells * lfCap * Math.max(0.5, Math.min(1, funding));
    const util = produced > 0 ? Math.min(1, produced / Math.max(1, capacity)) : 0;
    for (let i = 0; i < C; i++) if (zone[i] === Zone.Landfill && bld[i] < 0 && visit[i] === stampL) G[i] = Math.max(G[i] * 0.9, 0.45 + 0.5 * util);
    st.stats.garbageProduced = produced;
    st.stats.garbageCapacity = capacity;
    // who gets collected: all if capacity suffices, else BFS order from facilities along roads
    const served = this.served;
    const sStamp = ++this.stamp;
    if (capacity >= produced) {
      for (const b of buildingList(st)) served[b.id] = sStamp;
    } else if (capacity > 0 && seeds.length > 0) {
      let left = capacity;
      let qh = 0, qt = 0;
      for (const s of seeds) if (visit[s] !== sStamp) { visit[s] = sStamp; queue[qt++] = s; }
      while (qh < qt && left > 0) {
        const i = queue[qh++];
        const x = i % N, z = (i - x) / N;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k], nz = z + DZ[k];
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const j = nz * N + nx;
          const bid = bld[j];
          if (bid >= 0 && served[bid] !== sStamp && left > 0) {
            left -= prod[bid];
            served[bid] = sStamp;
          }
          if (visit[j] === sStamp || !isRoad(net[j] as Network)) continue;
          visit[j] = sStamp;
          queue[qt++] = j;
        }
      }
    }
    // accumulate / decay garbage on building cells
    const changed: Building[] = [];
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const p = prod[b.id];
      const ok = p === 0 || served[b.id] === sStamp;
      const area = b.w * b.d;
      let level = 0;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        const i = z * N + x;
        if (bld[i] !== b.id) continue;
        let g = G[i];
        if (ok) g *= 1 - GARBAGE_DECAY;
        else g = Math.min(1, g + (p / area) * GARBAGE_BUILDUP * dtMonths * 4);
        G[i] = g;
        if (g > level) level = g;
      }
      if (setFlagQuiet(b, BF.NoGarbage, level > NO_GARBAGE_THRESHOLD)) changed.push(b);
    }
    // non-building, non-landfill cells decay
    for (let i = 0; i < C; i++) if (bld[i] < 0 && zone[i] !== Zone.Landfill) G[i] *= 0.5;
    for (const b of changed) sim.events.emit('buildingChanged', b);
  }
}

function seedPerimeter(st: CityState, b: Building, out: number[]): void {
  const N = st.size;
  for (let z = b.z - 1; z <= b.z + b.d; z++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    const i = z * N + x;
    if (isRoad(st.network[i] as Network)) out.push(i);
  }
}
