/**
 * Pollution system: air, water, noise and garbage (every POLL_PERIOD days, cheap separable blurs).
 *
 *  AIR    sources: industry by DevType (I-D heavy, I-M medium, I-A small, I-HT ~0; x0.75 with Clean Air ordinance),
 *         def.pollution.air (power plants, incinerators ...), traffic volume (x congestion), landfill smell.
 *         Emitters are bucketed into small / medium / large radius classes and blurred (3 box passes); the field
 *         drifts slightly with a slowly rotating wind; layer = 1 - exp(-field / AIR_K), smoothed over time.
 *  WATER  industry + def.pollution.water + sewage (pop, reduced by treatment plant capacity), blurred into ground
 *         water; spreads along water bodies by iterative diffusion over water cells (persistent).
 *  NOISE  traffic volume, industry, def.pollution.noise (airports, stadiums ...).
 *  GARBAGE production per resident / job (recycling ordinance -20 %); collection capacity = landfill zone cells with
 *         road access (LANDFILL_CELL_CAP t/month each) + def.garbageCapacity (incinerators, recycling) x funding.
 *         When short, buildings farthest (road BFS) from facilities are not collected: state.garbage builds up on
 *         their cells -> BF.NoGarbage. stats.garbageProduced / garbageCapacity (tons / month).
 *  Flags BF.Polluted (air or water above threshold). stats.avgPollution. Emits layerUpdated('pollution').
 */
import { Network, Zone, isRoad } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { BF } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import { blur3, blurDownAdd, blurSigma2, shiftField } from './blur';
import {
  DX, DZ, Fam, activeJobs, detectJobsUnknown, ensureIdArray, ensureIdFloat, fundingFactor, infoOf, isFunctional, nowMs,
  readOrdinances, setFlagQuiet,
} from './common';
import {
  AIR_K, AIR_PER_JOB, AIR_PER_TRIP, GARBAGE_BUILDUP, GARBAGE_DECAY, GARBAGE_PER_CIVIC_JOB, GARBAGE_PER_JOB_C,
  GARBAGE_PER_JOB_I, GARBAGE_PER_RES, LANDFILL_AIR, LANDFILL_CELL_CAP, NOISE_K, NOISE_PER_JOB, NOISE_PER_TRIP,
  NO_GARBAGE_THRESHOLD, POLLUTED_THRESHOLD, POLL_PEAK_GAIN, POLL_RADII, POLL_SMOOTH, RECYCLING_CUT, SEWAGE_PER_RES,
  TREATMENT_DEFAULT_CAP, WATER_K, WATER_POLL_PER_JOB, WIND_DRIFT,
} from './params';

const IND_KEYS = ['IA', 'ID', 'IM', 'IHT'] as const;
/** days between pollution updates */
export const POLL_PERIOD = 4;

function radiusClass(r: number): number {
  if (r <= 0) return 1;
  if (r <= 4) return 0;
  if (r <= 9) return 1;
  return 2;
}

export class PollutionSystem implements SimSystem {
  readonly name = 'pollution';
  private air: Float32Array<ArrayBuffer>[] = [];
  private water = new Float32Array(0);
  private noise = new Float32Array(0);
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
    this.compute(sim, true);
  }

  daily(sim: Simulation): void {
    if (sim.state.day - this.lastRun >= POLL_PERIOD) this.compute(sim, false);
  }

  compute(sim: Simulation, first: boolean): void {
    const t0 = nowMs();
    const st = sim.state;
    const N = st.size, C = st.cells;
    if (this.tmp.length !== C) {
      this.air = [new Float32Array(C), new Float32Array(C), new Float32Array(C)];
      this.water = new Float32Array(C);
      this.noise = new Float32Array(C);
      this.tmp = new Float32Array(C);
      this.tmp2 = new Float32Array(C);
      this.queue = new Int32Array(C);
      this.visit = new Int32Array(C);
    }
    const dtMonths = first ? 0 : Math.min(2, (st.day - this.lastRun) / 30);
    this.lastRun = st.day;
    const ords = readOrdinances(st);
    const cleanAir = ords.has('cleanAir') ? 0.75 : 1;
    const jobsUnknown = detectJobsUnknown(st);
    const air = this.air, water = this.water, noise = this.noise;
    for (const a of air) a.fill(0);
    water.fill(0);
    noise.fill(0);

    // treatment capacity -> sewage reduction
    let treatCap = 0;
    const util = fundingFactor(st, 'utilities');
    for (const b of st.buildings.values()) {
      const inf = infoOf(st, b);
      if (inf.isTreatment && isFunctional(b)) treatCap += (inf.capacity > 0 ? inf.capacity : TREATMENT_DEFAULT_CAP) * Math.min(1, util);
    }
    const pop = Math.max(1, st.stats.population || 0);
    const treated = Math.min(1, treatCap / pop);
    const sewageMul = 1 - 0.9 * treated;

    // --- sources from buildings
    for (const b of st.buildings.values()) {
      const inf = infoOf(st, b);
      if (!isFunctional(b) && (b.flags & BF.OnFire) === 0) continue;
      const area = b.w * b.d;
      let a = 0, w = 0, nz = 0;
      let cls = 1;
      if (inf.fam === Fam.I) {
        const k = IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))];
        const j = activeJobs(inf, b, jobsUnknown);
        a = j * AIR_PER_JOB[k] * cleanAir;
        w = j * WATER_POLL_PER_JOB[k];
        nz = j * NOISE_PER_JOB[k];
      } else if (inf.fam === Fam.R) {
        w = b.pop * SEWAGE_PER_RES * sewageMul;
      }
      if (inf.air > 0 || inf.waterPoll > 0 || inf.noise > 0) {
        a += inf.air * (inf.fam === Fam.Plop ? 1 : cleanAir) * (inf.powerOut > 0 ? cleanAir : 1);
        w += inf.waterPoll;
        nz += inf.noise;
        cls = radiusClass(inf.pollRadius);
      }
      if (b.flags & BF.OnFire) a += 2 * area;
      if (a === 0 && w === 0 && nz === 0) continue;
      const ia = a / area, iw = w / area, inz = nz / area;
      const A = air[cls];
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        A[i] += ia;
        water[i] += iw;
        noise[i] += inz;
      }
    }
    // --- traffic + landfill
    const traffic = st.traffic, cong = st.congestion, net = st.network, zone = st.zone;
    const A0 = air[0];
    for (let i = 0; i < C; i++) {
      const t = traffic[i];
      if (t > 0 && net[i] !== Network.Rail && net[i] !== Network.None) {
        const c = cong[i];
        A0[i] += t * AIR_PER_TRIP * (1 + Math.min(2, c)) * cleanAir;
        noise[i] += t * NOISE_PER_TRIP;
      } else if (t > 0 && net[i] === Network.Rail) {
        noise[i] += t * NOISE_PER_TRIP * 0.2;
      }
      if (zone[i] === Zone.Landfill && st.building[i] < 0) A0[i] += LANDFILL_AIR;
    }
    // --- blur air per class, sum with gains, wind drift
    const tmp = this.tmp, tmp2 = this.tmp2;
    const field = tmp2;
    {
      // small emitters: full resolution
      const r = POLL_RADII[0];
      blur3(air[0], tmp, N, r);
      const gain = POLL_PEAK_GAIN * 2 * Math.PI * blurSigma2(r);
      const A = air[0];
      for (let i = 0; i < C; i++) field[i] = A[i] * gain;
      // medium / large emitters: blurred at 1/2 and 1/4 resolution (sigma ~ POLL_RADII[1], POLL_RADII[2])
      const M2 = Math.ceil(N / 2);
      if (this.coarse.length < M2 * M2) { this.coarse = new Float32Array(M2 * M2); this.coarseTmp = new Float32Array(M2 * M2); }
      for (let c = 1; c < 3; c++) {
        const f = c === 1 ? 2 : 4;
        const rr = Math.max(1, Math.round(POLL_RADII[c] / f));
        const sig2 = f * f * blurSigma2(rr);
        blurDownAdd(air[c], field, N, f, rr, POLL_PEAK_GAIN * 2 * Math.PI * sig2, this.coarse, this.coarseTmp);
      }
    }
    const ang = (st.day / 360) * Math.PI * 2 * 0.7 + Math.sin(st.day * 0.05) * 1.3;
    shiftField(field, tmp, N, Math.cos(ang) * WIND_DRIFT, Math.sin(ang) * WIND_DRIFT);
    const alpha = first ? 1 : POLL_SMOOTH;
    const airL = st.airPollution;
    const invAK = 1 / AIR_K;
    for (let i = 0; i < C; i++) {
      const target = 1 - Math.exp(-tmp[i] * invAK);
      airL[i] += (target - airL[i]) * alpha;
    }
    // --- noise
    {
      // half resolution blur (sigma^2 = 4 * 2 = 8 cells^2)
      tmp.fill(0);
      blurDownAdd(noise, tmp, N, 2, 1, POLL_PEAK_GAIN * 2 * Math.PI * 8, this.coarse, this.coarseTmp);
      const L = st.noise;
      const invK = 1 / NOISE_K;
      for (let i = 0; i < C; i++) {
        const target = 1 - Math.exp(-tmp[i] * invK);
        L[i] += (target - L[i]) * alpha;
      }
    }
    // --- water: ground water blur + diffusion along water bodies
    {
      tmp.fill(0);
      blurDownAdd(water, tmp, N, 2, 1, POLL_PEAK_GAIN * 2 * Math.PI * 8, this.coarse, this.coarseTmp);
      const L = st.waterPollution;
      const wm = st.water;
      const invK = 1 / WATER_K;
      for (let i = 0; i < C; i++) {
        if (wm[i]) continue;
        const target = 1 - Math.exp(-tmp[i] * invK);
        L[i] += (target - L[i]) * alpha;
      }
      // diffusion over water cells (precomputed list + 4 neighbour slots: water idx or -(land cell)-1)
      this.ensureWaterList(st);
      const nW = this.nWater, wc = this.waterCells, wnb = this.waterNb;
      const cur = tmp2, nxt = tmp;
      for (let q = 0; q < nW; q++) cur[q] = L[wc[q]];
      const iters = 6;
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
          const v = (s / n) * 0.93 + inflow * 0.12;
          nxt[q] = v > 1 ? 1 : v;
        }
        for (let q = 0; q < nW; q++) cur[q] = nxt[q];
      }
      for (let q = 0; q < nW; q++) L[wc[q]] = cur[q];
    }
    // --- garbage
    this.garbage(sim, dtMonths, ords.has('recycling'), jobsUnknown);
    // --- flags & stats
    const changed: Building[] = [];
    let polSum = 0, polN = 0;
    for (const b of st.buildings.values()) {
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
    this.lastMs = nowMs() - t0;
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

  private garbage(sim: Simulation, dtMonths: number, recycling: boolean, jobsUnknown: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const net = st.network, zone = st.zone, bld = st.building;
    const G = st.garbage;
    const prodMul = recycling ? 1 - RECYCLING_CUT : 1;
    const funding = Math.min(1.2, fundingFactor(st, 'utilities'));
    // production per building
    let produced = 0;
    this.served = ensureIdArray(this.served, st);
    this.prodById = ensureIdFloat(this.prodById, st);
    const prod = this.prodById;
    const seeds: number[] = [];
    let capacity = 0;
    for (const b of st.buildings.values()) {
      const inf = infoOf(st, b);
      prod[b.id] = 0;
      if (inf.garbageCap > 0 && isFunctional(b)) {
        capacity += inf.garbageCap * funding;
        seedPerimeter(st, b, seeds);
        continue;
      }
      if (!isFunctional(b)) continue;
      let p = 0;
      if (inf.fam === Fam.R) p = b.pop * GARBAGE_PER_RES;
      else if (inf.fam === Fam.C) p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_JOB_C;
      else if (inf.fam === Fam.I) p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_JOB_I[IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))]];
      else p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_CIVIC_JOB + inf.garbage;
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
    capacity += landfillCells * LANDFILL_CELL_CAP * Math.max(0.5, Math.min(1, funding));
    const util = produced > 0 ? Math.min(1, produced / Math.max(1, capacity)) : 0;
    for (let i = 0; i < C; i++) if (zone[i] === Zone.Landfill && bld[i] < 0 && visit[i] === stampL) G[i] = Math.max(G[i] * 0.9, 0.45 + 0.5 * util);
    st.stats.garbageProduced = produced;
    st.stats.garbageCapacity = capacity;
    // who gets collected: all if capacity suffices, else BFS order from facilities along roads
    const served = this.served;
    const sStamp = ++this.stamp;
    if (capacity >= produced) {
      for (const b of st.buildings.values()) served[b.id] = sStamp;
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
    for (const b of st.buildings.values()) {
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
