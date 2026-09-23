/**
 * Crime system (every CRIME_PERIOD days): state.crime (0..1) per cell.
 *  Per building: density (occupants per cell) + poverty (R$ / CS$ / dirty industry) + unemployment + low land value
 *  + abandonment, x ordinances (neighbourhood watch 0.9, youth curfew 0.92, legalized gambling 1.12),
 *  x (1 - 0.85 x police coverage). Painted on the footprint, blurred slightly (spills onto streets), smoothed in time.
 *  BF.Crime on buildings above CRIME_THRESHOLD. stats.avgCrime = occupant-weighted mean. Emits layerUpdated('crime').
 */
import { DevType } from '../../core/types';
import type { Building } from '../CityState';
import { BF } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import { blur3 } from './blur';
import { Fam, infoOf, nowMs, readOrdinances, setFlagQuiet, wealthOf } from './common';
import { CRIME_THRESHOLD } from './params';

export const CRIME_PERIOD = 4;

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

export class CrimeSystem implements SimSystem {
  readonly name = 'crime';
  private raw = new Float32Array(0);
  private tmp = new Float32Array(0);
  private lastRun = -1e9;
  lastMs = 0;

  init(sim: Simulation): void {
    sim.state.systemData.infraVersion = 1;
    this.lastRun = -1e9;
    this.compute(sim, true);
  }

  daily(sim: Simulation): void {
    const d = sim.state.day;
    if (d % CRIME_PERIOD === 3 || d - this.lastRun > CRIME_PERIOD * 2) this.compute(sim, false);
  }

  compute(sim: Simulation, first: boolean): void {
    const t0 = nowMs();
    const st = sim.state;
    const N = st.size, C = st.cells;
    this.lastRun = st.day;
    if (this.raw.length !== C) {
      this.raw = new Float32Array(C);
      this.tmp = new Float32Array(C);
    }
    const raw = this.raw;
    raw.fill(0);
    const ords = readOrdinances(st);
    let mul = 1;
    if (ords.has('neighborhoodWatch')) mul *= 0.9;
    if (ords.has('youthCurfew')) mul *= 0.92;
    if (ords.has('legalizedGambling')) mul *= 1.12;
    const unemp = Math.max(0, Math.min(1, st.stats.unemployment || 0));
    // land value may not be computed yet (all zero) -> neutral 0.5
    let lvKnown = false;
    for (let i = 0; i < C; i += 97) if (st.landValue[i] > 0) { lvKnown = true; break; }
    const police = st.policeCov, lv = st.landValue;
    for (const b of st.buildings.values()) {
      if (b.built < 1 && (b.flags & BF.Abandoned) === 0) continue;
      const inf = infoOf(st, b);
      const area = b.w * b.d;
      const occ = inf.fam === Fam.R ? b.pop : b.jobs;
      const ci = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
      let c = Math.min(1, occ / (area * 90)) * 0.3;
      if (inf.dev >= 0) c += POVERTY_BY_DEV[inf.dev] ?? 0.08;
      else if (inf.fam === Fam.R) c += wealthOf(inf, b) === 1 ? 0.28 : 0.1;
      else c += inf.isPark ? 0.06 : 0.03;
      c += unemp * (inf.fam === Fam.R ? 0.5 : 0.2);
      c += (1 - (lvKnown ? lv[ci] : 0.5)) * 0.2;
      if (b.flags & BF.Abandoned) c += 0.35;
      if (b.flags & BF.Burnt) c += 0.1;
      c *= mul * (1 - 0.85 * Math.min(1, police[ci]));
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        raw[z * N + x] = c;
      }
    }
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
    // flags & stats
    const changed: Building[] = [];
    let sum = 0, w = 0;
    for (const b of st.buildings.values()) {
      const ci = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
      const c = L[ci];
      const inf = infoOf(st, b);
      const occ = inf.fam === Fam.R ? b.pop : b.jobs;
      if (occ > 0) { sum += c * occ; w += occ; }
      if (setFlagQuiet(b, BF.Crime, c > CRIME_THRESHOLD)) changed.push(b);
    }
    st.stats.avgCrime = w > 0 ? sum / w : 0;
    for (const b of changed) sim.events.emit('buildingChanged', b);
    sim.events.emit('layerUpdated', 'crime');
    this.lastMs = nowMs() - t0;
  }

  private scratch = new Float32Array(0);
  private tmpB(): Float32Array {
    if (this.scratch.length !== this.raw.length) this.scratch = new Float32Array(this.raw.length);
    return this.scratch;
  }
}
