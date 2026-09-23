/**
 * Utilities system: power grid + water network.
 *
 * POWER
 *  - Conductors: any network cell (roads, rail, bridges), power-line cells, building-covered cells.
 *  - Each connected conductor component shares the output of the power plants it contains (def.powerOut, reduced when
 *    utilities funding < 100 %). Demand = def.powerUse (scaled by occupancy) or derived from capacity.
 *  - Brownout: when demand > supply, a multi-source BFS from the plants serves consumers in distance order; once the
 *    supply is exhausted every farther consumer loses power (farthest first).
 *  - Empty zoned cells 4-adjacent to a powered conductor are marked powered (for growth).
 *  - Writes state.powered, BF.Powered (buildingChanged on flip), stats.powerSupply / powerDemand.
 * WATER
 *  - Pipes run automatically under every road cell; road-connected components form water networks.
 *  - Producers (def.waterOut) feed the road component they touch (<= 1 cell). Pumps within 2 cells of water +50 %;
 *    output drops with water pollution at the pump (less with a treatment plant in the city).
 *  - Buildings 4-adjacent to a watered road get water; same brownout ordering by BFS from producers.
 *  - Writes state.watered, BF.Watered, stats.waterSupply / waterDemand.
 * Incremental: marks dirty on network / building / power-line / zone changes; recomputes on the next day
 * (and every UTIL_REFRESH_DAYS days since demand drifts with population).
 */
import { Network, isRoad } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { BF } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import {
  DX, DZ, Fam, type DefInfo, activeJobs, detectJobsUnknown, ensureIdArray, ensureIdFloat, fundingFactor, infoOf,
  readOrdinances, setFlagQuiet,
} from './common';
import {
  CONSERVATION_CUT, POWER_MIN_PLOPPED, POWER_PER_CIVIC_JOB, POWER_PER_JOB_C, POWER_PER_JOB_I, POWER_PER_RES,
  PUMP_WATER_BONUS, PUMP_WATER_DIST, UTIL_BASE_SHARE, UTIL_REFRESH_DAYS, WATER_PER_CIVIC_JOB, WATER_PER_JOB_C,
  WATER_PER_JOB_I, WATER_PER_RES,
} from './params';

const IND_KEYS = ['IA', 'ID', 'IM', 'IHT'] as const;

function occupancy(inf: DefInfo, b: Building, jobsUnknown: boolean): number {
  if (b.capacity <= 0) return 1;
  if (inf.fam === Fam.R) return Math.min(1, b.pop / b.capacity);
  if (inf.fam === Fam.C || inf.fam === Fam.I) return Math.min(1, activeJobs(inf, b, jobsUnknown) / b.capacity);
  return 1;
}

/** full-occupancy utility use of a building (power MW or water kL/day) */
function fullUse(inf: DefInfo, b: Building, power: boolean): number {
  const explicit = power ? inf.powerUse : inf.waterUse;
  if (explicit >= 0) return explicit;
  const cap = b.capacity;
  switch (inf.fam) {
    case Fam.R: return cap * (power ? POWER_PER_RES : WATER_PER_RES);
    case Fam.C: return cap * (power ? POWER_PER_JOB_C : WATER_PER_JOB_C);
    case Fam.I: {
      const k = IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))];
      return cap * (power ? POWER_PER_JOB_I[k] : WATER_PER_JOB_I[k]);
    }
    default: {
      const jobs = inf.civicJobs;
      const perJob = power ? POWER_PER_CIVIC_JOB : WATER_PER_CIVIC_JOB;
      const minUse = inf.isPark ? 0.2 : POWER_MIN_PLOPPED;
      return Math.max(minUse, jobs * perJob);
    }
  }
}

export function buildingPowerUse(inf: DefInfo, b: Building, jobsUnknown: boolean): number {
  if (inf.powerOut > 0) return 0;
  if (b.built < 1 || (b.flags & (BF.Burnt | BF.Abandoned)) !== 0) return 0;
  const occ = occupancy(inf, b, jobsUnknown);
  return fullUse(inf, b, true) * (UTIL_BASE_SHARE + (1 - UTIL_BASE_SHARE) * occ);
}
export function buildingWaterUse(inf: DefInfo, b: Building, jobsUnknown: boolean): number {
  if (inf.waterOut > 0) return 0;
  if (b.built < 1 || (b.flags & (BF.Burnt | BF.Abandoned)) !== 0) return 0;
  const occ = occupancy(inf, b, jobsUnknown);
  return fullUse(inf, b, false) * (UTIL_BASE_SHARE + (1 - UTIL_BASE_SHARE) * occ);
}

function plantEfficiency(state: CityState): number {
  const f = fundingFactor(state, 'utilities');
  return f >= 1 ? 1 : 0.4 + 0.6 * f;
}

export interface GridInfo {
  supply: number;
  demand: number;
  /** true when demand > supply (brownout) */
  shortage: boolean;
}

export class UtilitiesSystem implements SimSystem {
  readonly name = 'utilities';
  private dirty = true;
  private lastRun = -1e9;
  private unsub: (() => void)[] = [];
  private stamp = 0;
  // per cell
  private pComp = new Int32Array(0);
  private wComp = new Int32Array(0);
  private queue = new Int32Array(0);
  private visit = new Int32Array(0);
  // per building id
  private bStamp = new Int32Array(1024);
  private bUse = new Float32Array(1024);
  private bOk = new Int32Array(1024);
  private bWComp = new Int32Array(1024);
  private bPow = new Uint8Array(1024);
  private bWat = new Uint8Array(1024);
  // per component
  private cSupply = new Float64Array(256);
  private cDemand = new Float64Array(256);
  private cLeft = new Float64Array(256);
  private wSupply = new Float64Array(256);
  private wDemand = new Float64Array(256);
  private wLeft = new Float64Array(256);
  private nPComp = 0;
  private nWComp = 0;
  private wasShort = false;
  private lastShortNotify = -1e9;
  /** last compute duration (ms) */
  lastMs = 0;

  init(sim: Simulation): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    const ev = sim.events;
    const mark = () => { this.dirty = true; };
    this.unsub.push(ev.on('networkChanged', mark), ev.on('buildingAdded', mark), ev.on('buildingRemoved', mark),
      ev.on('powerLinesChanged', mark), ev.on('zoneChanged', mark), ev.on('reset', mark));
    sim.state.systemData.infraVersion = 1;
    this.dirty = true;
    this.compute(sim);
  }

  daily(sim: Simulation): void {
    if (this.dirty || sim.state.day - this.lastRun >= UTIL_REFRESH_DAYS) this.compute(sim);
  }

  /** mark for recompute on the next day */
  invalidate(): void {
    this.dirty = true;
  }

  /** power grid info at a cell (conductor or building) or null if not on a grid */
  gridInfo(sim: Simulation, x: number, z: number): GridInfo | null {
    const st = sim.state;
    if (!st.inBounds(x, z) || this.pComp.length !== st.cells) return null;
    const c = this.pComp[z * st.size + x];
    if (c < 0 || c >= this.nPComp) return null;
    return { supply: this.cSupply[c], demand: this.cDemand[c], shortage: this.cDemand[c] > this.cSupply[c] };
  }
  /** water network info at a road cell / building */
  waterInfo(sim: Simulation, x: number, z: number): GridInfo | null {
    const st = sim.state;
    if (!st.inBounds(x, z) || this.wComp.length !== st.cells) return null;
    let c = this.wComp[z * st.size + x];
    if (c < 0) {
      const b = st.buildingAt(x, z);
      if (b && b.id < this.bWComp.length) c = this.bWComp[b.id] - 1;
    }
    if (c < 0 || c >= this.nWComp) return null;
    return { supply: this.wSupply[c], demand: this.wDemand[c], shortage: this.wDemand[c] > this.wSupply[c] };
  }

  compute(sim: Simulation): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const st = sim.state;
    const C = st.cells;
    if (this.pComp.length !== C) {
      this.pComp = new Int32Array(C);
      this.wComp = new Int32Array(C);
      this.queue = new Int32Array(C);
      this.visit = new Int32Array(C);
    }
    this.bStamp = ensureIdArray(this.bStamp, st);
    this.bOk = ensureIdArray(this.bOk, st);
    this.bUse = ensureIdFloat(this.bUse, st);
    this.bWComp = ensureIdArray(this.bWComp, st);
    if (this.bPow.length < this.bOk.length) {
      this.bPow = new Uint8Array(this.bOk.length);
      this.bWat = new Uint8Array(this.bOk.length);
    }
    const ords = readOrdinances(st);
    const jobsUnknown = detectJobsUnknown(st);
    const changed: Building[] = [];
    this.computePower(st, ords.has('powerConservation'), jobsUnknown);
    this.computeWater(st, ords.has('waterConservation'), jobsUnknown);
    // apply flags
    const bPow = this.bPow, bWat = this.bWat;
    for (const b of st.buildings.values()) {
      const pw = bPow[b.id] === 1;
      const wt = bWat[b.id] === 1;
      const f1 = setFlagQuiet(b, BF.Powered, pw);
      const f2 = setFlagQuiet(b, BF.Watered, wt);
      if (f1 || f2) changed.push(b);
    }
    for (const b of changed) sim.events.emit('buildingChanged', b);
    // news on new shortage
    const short = st.stats.powerDemand > st.stats.powerSupply * 1.0001 && st.stats.powerSupply > 0;
    if (short && !this.wasShort && st.day - this.lastShortNotify > 30) {
      this.lastShortNotify = st.day;
      sim.notify(`Power shortage: demand ${Math.round(st.stats.powerDemand)} MW exceeds supply ${Math.round(st.stats.powerSupply)} MW. Brownouts in outlying areas.`, 'warning', undefined, undefined, 'utilities');
    }
    this.wasShort = short;
    this.dirty = false;
    this.lastRun = st.day;
    sim.events.emit('layerUpdated', 'utilities');
    this.lastMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  }

  // ------------------------------------------------------------------------------------------ power
  private computePower(st: CityState, conservation: boolean, jobsUnknown: boolean): void {
    const N = st.size, C = st.cells;
    const net = st.network, lines = st.powerLines, bld = st.building, zone = st.zone;
    const comp = this.pComp, queue = this.queue;
    const powered = st.powered;
    const stampNo = ++this.stamp;
    const bStamp = this.bStamp, bUse = this.bUse;
    const eff = plantEfficiency(st);
    const demandMul = conservation ? 1 - CONSERVATION_CUT : 1;
    comp.fill(-1);
    let nc = 0;
    let supplyTot = 0, demandTot = 0;
    const result = this.bPow;
    // pass 1: components
    for (let s = 0; s < C; s++) {
      if (comp[s] >= 0) continue;
      if (net[s] === 0 && lines[s] === 0 && bld[s] < 0) continue;
      if (nc >= this.cSupply.length) this.growPower();
      let supply = 0, demand = 0;
      let qh = 0, qt = 0;
      queue[qt++] = s;
      comp[s] = nc;
      while (qh < qt) {
        const i = queue[qh++];
        const bid = bld[i];
        if (bid >= 0 && bStamp[bid] !== stampNo) {
          bStamp[bid] = stampNo;
          const b = st.buildings.get(bid);
          if (b) {
            const inf = infoOf(st, b);
            if (inf.powerOut > 0) {
              const out = b.built >= 1 && (b.flags & (BF.Burnt | BF.Abandoned)) === 0 ? inf.powerOut * eff : 0;
              supply += out;
              bUse[bid] = -out; // negative marks a plant
            } else {
              const u = buildingPowerUse(inf, b, jobsUnknown) * demandMul;
              bUse[bid] = u;
              demand += u;
            }
          }
        }
        const x = i % N, z = (i - x) / N;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k], nz = z + DZ[k];
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const j = nz * N + nx;
          if (comp[j] >= 0) continue;
          if (net[j] === 0 && lines[j] === 0 && bld[j] < 0) continue;
          comp[j] = nc;
          queue[qt++] = j;
        }
      }
      this.cSupply[nc] = supply;
      this.cDemand[nc] = demand;
      this.cLeft[nc] = supply;
      supplyTot += supply;
      demandTot += demand;
      nc++;
    }
    this.nPComp = nc;
    // pass 2: cell power for fully supplied components
    for (let i = 0; i < C; i++) {
      const c = comp[i];
      powered[i] = c >= 0 && this.cSupply[c] > 0 && this.cDemand[c] <= this.cSupply[c] ? 1 : 0;
    }
    // pass 3: brownout ordering (multi-source BFS from plants in short components)
    let anyShort = false;
    for (let c = 0; c < nc; c++) if (this.cSupply[c] > 0 && this.cDemand[c] > this.cSupply[c]) { anyShort = true; break; }
    const served = this.bOk;
    const stamp2 = stampNo; // served[bid] === stamp2 -> powered
    if (anyShort) {
      const visit = this.visit;
      const vstamp = stampNo;
      let qh = 0, qt = 0;
      for (const b of st.buildings.values()) {
        if (bStamp[b.id] !== stampNo || bUse[b.id] >= 0) continue;
        const c = comp[b.z * N + b.x];
        if (c < 0 || !(this.cDemand[c] > this.cSupply[c])) continue;
        for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
          const i = z * N + x;
          if (visit[i] === vstamp) continue;
          visit[i] = vstamp;
          queue[qt++] = i;
        }
      }
      const exhausted = new Uint8Array(nc);
      while (qh < qt) {
        const i = queue[qh++];
        const c = comp[i];
        const bid = bld[i];
        if (bid >= 0 && served[bid] !== stamp2 && served[bid] !== -stamp2) {
          const u = bUse[bid];
          if (u < 0) served[bid] = stamp2; // plant
          else if (!exhausted[c] && this.cLeft[c] >= u) {
            this.cLeft[c] -= u;
            served[bid] = stamp2;
          } else {
            exhausted[c] = 1;
            served[bid] = -stamp2;
          }
        }
        powered[i] = exhausted[c] ? 0 : 1;
        const x = i % N, z = (i - x) / N;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k], nz = z + DZ[k];
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const j = nz * N + nx;
          if (visit[j] === vstamp || comp[j] !== c) continue;
          visit[j] = vstamp;
          queue[qt++] = j;
        }
      }
    }
    // buildings
    for (const b of st.buildings.values()) {
      const c = comp[b.z * N + b.x];
      let on = false;
      if (c >= 0 && this.cSupply[c] > 0) {
        if (this.cDemand[c] <= this.cSupply[c]) on = true;
        else on = served[b.id] === stamp2;
      }
      const v = on ? 1 : 0;
      result[b.id] = v;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        const i = z * N + x;
        if (bld[i] === b.id) powered[i] = v;
      }
    }
    // empty zoned cells adjacent to a powered conductor
    for (let i = 0; i < C; i++) {
      if (zone[i] === 0 || comp[i] >= 0) continue;
      const x = i % N, z = (i - x) / N;
      let p = 0;
      for (let k = 0; k < 4 && !p; k++) {
        const nx = x + DX[k], nz = z + DZ[k];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        if (comp[j] >= 0 && powered[j]) p = 1;
      }
      powered[i] = p;
    }
    st.stats.powerSupply = supplyTot;
    st.stats.powerDemand = demandTot;
  }

  private growPower(): void {
    const n = this.cSupply.length * 2;
    const g = (a: Float64Array) => { const b = new Float64Array(n); b.set(a); return b; };
    this.cSupply = g(this.cSupply);
    this.cDemand = g(this.cDemand);
    this.cLeft = g(this.cLeft);
  }
  private growWater(): void {
    const n = this.wSupply.length * 2;
    const g = (a: Float64Array) => { const b = new Float64Array(n); b.set(a); return b; };
    this.wSupply = g(this.wSupply);
    this.wDemand = g(this.wDemand);
    this.wLeft = g(this.wLeft);
  }

  // ------------------------------------------------------------------------------------------ water
  private computeWater(st: CityState, conservation: boolean, jobsUnknown: boolean): void {
    const N = st.size, C = st.cells;
    const net = st.network, zone = st.zone, bld = st.building;
    const comp = this.wComp, queue = this.queue;
    const watered = st.watered;
    const demandMul = conservation ? 1 - CONSERVATION_CUT : 1;
    const eff = plantEfficiency(st);
    comp.fill(-1);
    // components over road cells
    let nc = 0;
    for (let s = 0; s < C; s++) {
      if (comp[s] >= 0 || !isRoad(net[s] as Network)) continue;
      if (nc >= this.wSupply.length) this.growWater();
      let qh = 0, qt = 0;
      queue[qt++] = s;
      comp[s] = nc;
      while (qh < qt) {
        const i = queue[qh++];
        const x = i % N, z = (i - x) / N;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k], nz = z + DZ[k];
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const j = nz * N + nx;
          if (comp[j] >= 0 || !isRoad(net[j] as Network)) continue;
          comp[j] = nc;
          queue[qt++] = j;
        }
      }
      this.wSupply[nc] = 0;
      this.wDemand[nc] = 0;
      nc++;
    }
    this.nWComp = nc;
    // any treatment plant in the city halves pollution penalty on pumps
    let hasTreatment = false;
    for (const b of st.buildings.values()) {
      const inf = infoOf(st, b);
      if (inf.isTreatment && b.built >= 1 && (b.flags & BF.Burnt) === 0) { hasTreatment = true; break; }
    }
    // assign buildings to components
    const bComp = this.bWComp; // per-building component (+1), 0 = none
    const bUse = this.bUse;
    let supplyTot = 0, demandTot = 0;
    const seeds: number[] = [];
    for (const b of st.buildings.values()) {
      const c = adjacentComp(comp, N, b);
      bComp[b.id] = c + 1;
      if (c < 0) continue;
      const inf = infoOf(st, b);
      if (inf.waterOut > 0) {
        let out = 0;
        if (b.built >= 1 && (b.flags & (BF.Burnt | BF.Abandoned)) === 0) {
          out = inf.waterOut * eff;
          if (inf.isPump && nearWater(st, b, PUMP_WATER_DIST)) out *= 1 + PUMP_WATER_BONUS;
          const wp = st.waterPollution[Math.min(C - 1, (b.z + (b.d >> 1)) * N + b.x + (b.w >> 1))] || 0;
          out *= 1 - 0.5 * Math.min(1, wp) * (hasTreatment ? 0.35 : 1);
        }
        bUse[b.id] = -out - 1e-9;
        this.wSupply[c] += out;
        supplyTot += out;
        if (out > 0) seeds.push(b.id);
      } else {
        const u = buildingWaterUse(inf, b, jobsUnknown) * demandMul;
        bUse[b.id] = u;
        this.wDemand[c] += u;
        demandTot += u;
      }
    }
    for (let c = 0; c < nc; c++) this.wLeft[c] = this.wSupply[c];
    // road cells watered
    for (let i = 0; i < C; i++) {
      const c = comp[i];
      watered[i] = c >= 0 && this.wSupply[c] > 0 && this.wDemand[c] <= this.wSupply[c] ? 1 : 0;
    }
    const result = this.bWat;
    let anyShort = false;
    for (let c = 0; c < nc; c++) if (this.wSupply[c] > 0 && this.wDemand[c] > this.wSupply[c]) { anyShort = true; break; }
    const servedStamp = ++this.stamp;
    const served = this.bOk;
    if (anyShort) {
      const visit = this.visit;
      const exhausted = new Uint8Array(nc);
      let qh = 0, qt = 0;
      for (const id of seeds) {
        const b = st.buildings.get(id)!;
        const c = bComp[id] - 1;
        if (!(this.wDemand[c] > this.wSupply[c])) continue;
        const tmp = perimeterRoadCells(st, comp, b);
        for (const i of tmp) if (visit[i] !== servedStamp) { visit[i] = servedStamp; queue[qt++] = i; }
      }
      while (qh < qt) {
        const i = queue[qh++];
        const c = comp[i];
        const x = i % N, z = (i - x) / N;
        watered[i] = exhausted[c] ? 0 : 1;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k], nz = z + DZ[k];
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const j = nz * N + nx;
          const bid = bld[j];
          if (bid >= 0 && served[bid] !== servedStamp && served[bid] !== -servedStamp && bComp[bid] - 1 === c) {
            const u = bUse[bid];
            if (u < 0) served[bid] = servedStamp;
            else if (!exhausted[c] && this.wLeft[c] >= u) { this.wLeft[c] -= u; served[bid] = servedStamp; }
            else { exhausted[c] = 1; served[bid] = -servedStamp; }
          }
          if (visit[j] === servedStamp || comp[j] !== c) continue;
          visit[j] = servedStamp;
          queue[qt++] = j;
        }
      }
    }
    for (const b of st.buildings.values()) {
      const c = bComp[b.id] - 1;
      let on = false;
      if (c >= 0 && this.wSupply[c] > 0) on = this.wDemand[c] <= this.wSupply[c] ? true : served[b.id] === servedStamp;
      const v = on ? 1 : 0;
      result[b.id] = v;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        const i = z * N + x;
        if (bld[i] === b.id) watered[i] = v;
      }
    }
    // empty zoned cells within 1 cell of a watered road
    for (let i = 0; i < C; i++) {
      if (zone[i] === 0 || bld[i] >= 0 || comp[i] >= 0) continue;
      const x = i % N, z = (i - x) / N;
      let w = 0;
      for (let k = 0; k < 4 && !w; k++) {
        const nx = x + DX[k], nz = z + DZ[k];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        if (comp[j] >= 0 && watered[j]) w = 1;
      }
      watered[i] = w;
    }
    st.stats.waterSupply = supplyTot;
    st.stats.waterDemand = demandTot;
  }
}

function adjacentComp(comp: Int32Array, N: number, b: Building): number {
  const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.d;
  for (let x = x0; x < x1; x++) {
    if (x < 0 || x >= N) continue;
    if (z0 > 0) { const c = comp[(z0 - 1) * N + x]; if (c >= 0) return c; }
    if (z1 < N) { const c = comp[z1 * N + x]; if (c >= 0) return c; }
  }
  for (let z = z0; z < z1; z++) {
    if (z < 0 || z >= N) continue;
    if (x0 > 0) { const c = comp[z * N + x0 - 1]; if (c >= 0) return c; }
    if (x1 < N) { const c = comp[z * N + x1]; if (c >= 0) return c; }
  }
  return -1;
}

function perimeterRoadCells(st: CityState, comp: Int32Array, b: Building): number[] {
  const N = st.size;
  const out: number[] = [];
  for (let z = b.z - 1; z <= b.z + b.d; z++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    const inside = x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d;
    const corner = (x < b.x || x >= b.x + b.w) && (z < b.z || z >= b.z + b.d);
    if (inside || corner) continue;
    const i = z * N + x;
    if (comp[i] >= 0) out.push(i);
  }
  return out;
}

function nearWater(st: CityState, b: Building, d: number): boolean {
  const N = st.size;
  for (let z = b.z - d; z < b.z + b.d + d; z++) for (let x = b.x - d; x < b.x + b.w + d; x++) {
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    if (st.water[z * N + x]) return true;
  }
  return false;
}
