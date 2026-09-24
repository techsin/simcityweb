/**
 * NIMBY / YIMBY rasters (SIM_DEPTH_SPEC WP2). Headless: no DOM / three.js.
 *
 * st.stigma / st.prestige / st.campus (0..1) are rebuilt in one services step per pass from
 *  - catalog fields def.stigma / def.prestige / def.campus {amount at the source, radius} (plants, dumps, jails,
 *    airports ... / landmarks, city hall, golf ... / universities, research),
 *  - non-catalog sources: I-D / I-M growables (NIMBY_ID / NIMBY_IM), high-end commercial growables at stage >= 6
 *    (PRESTIGE_HIGH_C), landfill zones per 2x2 block x (idle + (1 - idle) x the block's mean st.landfillFill),
 *    highway cells (bridges / elevated more, tunnels none) and rail cells.
 * Every source splats amount x falloff (full to 35 % of the radius, smoothstep to 0 at the radius, measured from the
 * footprint edge); building sources are summed and saturated with 1 - exp(-x); network cells combine by max (a
 * highway corridor is one source, not hundreds). Only functional buildings count (burnt / abandoned ones don't).
 * Power plants are scaled by (NIMBY_PLANT_IDLE + (1 - IDLE) x plantLoad) when the utilities system reports plantLoad.
 */
import { DevType, Network, Zone } from '../../core/types';
import type { CityState } from '../CityState';
import type { Simulation } from '../Simulation';
import { getDef } from '../catalog';
import { Fam, buildingList, infoOf, isFunctional } from './common';
import { falloff } from './catchments';
import {
  NIMBY_HIGHWAY, NIMBY_HIGHWAY_BRIDGE, NIMBY_ID, NIMBY_IM, NIMBY_LANDFILL_IDLE, NIMBY_PLANT_IDLE, NIMBY_RAIL,
  PRESTIGE_HIGH_C, PRESTIGE_HIGH_C_STAGE,
} from './params';

/** splat kernel (offsets from the footprint min corner + weights), cached per (radius, w, d) */
interface Kernel { dx: Int16Array; dz: Int16Array; w: Float32Array; n: number }
const kernels = new Map<number, Kernel>();
function kernelOf(R: number, bw: number, bd: number): Kernel {
  const r = Math.max(0, Math.min(60, Math.round(R * 4) / 4));
  const key = (r * 4) * 4096 + Math.min(63, bw) * 64 + Math.min(63, bd);
  let k = kernels.get(key);
  if (k) return k;
  const cx = bw / 2 - 0.5, cz = bd / 2 - 0.5;
  const half = Math.max(bw, bd) / 2;
  const Rt = Math.ceil(r + half);
  const dx: number[] = [], dz: number[] = [], w: number[] = [];
  for (let z = Math.floor(cz - Rt); z <= Math.ceil(cz + Rt); z++) for (let x = Math.floor(cx - Rt); x <= Math.ceil(cx + Rt); x++) {
    const d = Math.max(0, Math.hypot(x - cx, z - cz) - half);
    if (d >= r) continue;
    const v = falloff(d, r);
    if (v <= 0) continue;
    dx.push(x); dz.push(z); w.push(v);
  }
  k = { dx: Int16Array.from(dx), dz: Int16Array.from(dz), w: Float32Array.from(w), n: w.length };
  kernels.set(key, k);
  return k;
}

function splatAdd(out: Float32Array, N: number, bx: number, bz: number, bw: number, bd: number, amount: number, R: number): number {
  if (!(amount > 0) || !(R > 0)) return 0;
  const k = kernelOf(R, bw, bd);
  for (let q = 0; q < k.n; q++) {
    const x = bx + k.dx[q], z = bz + k.dz[q];
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    out[z * N + x] += amount * k.w[q];
  }
  return k.n;
}
function splatMax(out: Float32Array, N: number, x0: number, z0: number, amount: number, R: number): number {
  const k = kernelOf(R, 1, 1);
  for (let q = 0; q < k.n; q++) {
    const x = x0 + k.dx[q], z = z0 + k.dz[q];
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    const i = z * N + x;
    const v = amount * k.w[q];
    if (v > out[i]) out[i] = v;
  }
  return k.n;
}

interface Scratch { C: number; stig: Float32Array; line: Float32Array; pres: Float32Array; camp: Float32Array }
let scratch: Scratch = { C: 0, stig: new Float32Array(0), line: new Float32Array(0), pres: new Float32Array(0), camp: new Float32Array(0) };
/** estimated cost (ms) of the next rebuild per state (deterministic: from source counts of the last rebuild) */
const costEst = new WeakMap<CityState, number>();

type PlantLoadFn = (id: number) => number;
function plantLoadFn(sim: Simulation): PlantLoadFn | null {
  const u = sim.getSystem('utilities') as unknown as { plantLoad?: PlantLoadFn } | undefined;
  return u && typeof u.plantLoad === 'function' ? u.plantLoad.bind(u) : null;
}

/** rebuild st.stigma / st.prestige / st.campus (one services step, <= 3 ms) */
export function rebuildNimby(sim: Simulation): void {
  const st = sim.state;
  const N = st.size, C = st.cells;
  if (scratch.C !== C) scratch = { C, stig: new Float32Array(C), line: new Float32Array(C), pres: new Float32Array(C), camp: new Float32Array(C) };
  const { stig, line, pres, camp } = scratch;
  stig.fill(0); line.fill(0); pres.fill(0); camp.fill(0);
  const plantLoad = plantLoadFn(sim);
  let touches = 0;
  const bL = buildingList(st);
  for (let bI = 0; bI < bL.length; bI++) {
    const b = bL[bI];
    if (!isFunctional(b)) continue;
    const inf = infoOf(st, b);
    let sA = inf.stigmaAmt, sR = inf.stigmaR;
    let pA = inf.prestigeAmt, pR = inf.prestigeR;
    if (inf.fam === Fam.I) {
      if (inf.dev === DevType.ID) { sA = NIMBY_ID.amount; sR = NIMBY_ID.radius; }
      else if (inf.dev === DevType.IM) { sA = NIMBY_IM.amount; sR = NIMBY_IM.radius; }
    } else if (inf.fam === Fam.C && pA === 0 && (inf.dev === DevType.CS3 || inf.dev === DevType.CO3)) {
      const stage = getDef(b.def)?.stage ?? 0;
      if (stage >= PRESTIGE_HIGH_C_STAGE) { pA = PRESTIGE_HIGH_C.amount; pR = PRESTIGE_HIGH_C.radius; }
    }
    if (sA > 0 && inf.powerOut > 0 && plantLoad) {
      const load = plantLoad(b.id);
      if (load >= 0) sA *= NIMBY_PLANT_IDLE + (1 - NIMBY_PLANT_IDLE) * Math.min(1, load);
    }
    if (sA > 0) touches += splatAdd(stig, N, b.x, b.z, b.w, b.d, sA, sR);
    if (pA > 0) touches += splatAdd(pres, N, b.x, b.z, b.w, b.d, pA, pR);
    if (inf.campusAmt > 0) touches += splatAdd(camp, N, b.x, b.z, b.w, b.d, inf.campusAmt, inf.campusR);
  }
  // landfill zones: per 2x2 block, scaled by how full the block's own landfill cells are (WP3's landfillFill stock:
  // an empty landfill is only mildly stigmatised, a mountain of garbage fully — incinerators / recycling elsewhere
  // in the city do not count)
  const lfDef = getDef('util_landfill_tile');
  const lfA = lfDef?.stigma?.amount ?? 0.35, lfR = lfDef?.stigma?.radius ?? 6;
  const zone = st.zone, net = st.network, flags = st.netFlags, lfFill = st.landfillFill;
  for (let z = 0; z < N; z += 2) for (let x = 0; x < N; x += 2) {
    let cnt = 0, fill = 0;
    for (let dz = 0; dz < 2 && z + dz < N; dz++) for (let dx = 0; dx < 2 && x + dx < N; dx++) {
      const i = (z + dz) * N + x + dx;
      if (zone[i] !== Zone.Landfill) continue;
      cnt++;
      const f = lfFill ? lfFill[i] : 0;
      fill += f > 0 ? (f < 1 ? f : 1) : 0;
    }
    if (cnt > 0) touches += splatAdd(stig, N, x, z, 2, 2, lfA * (NIMBY_LANDFILL_IDLE + (1 - NIMBY_LANDFILL_IDLE) * (fill / cnt)) * cnt / 4, lfR);
  }
  // network corridors (max-combined)
  for (let i = 0; i < C; i++) {
    const t = net[i];
    if (t === Network.Highway) {
      const f = flags[i];
      if (f & 2) continue; // tunnel
      touches += splatMax(line, N, i % N, (i / N) | 0, f & 1 ? NIMBY_HIGHWAY_BRIDGE : NIMBY_HIGHWAY.amount, NIMBY_HIGHWAY.radius);
    } else if (t === Network.Rail) {
      touches += splatMax(line, N, i % N, (i / N) | 0, NIMBY_RAIL.amount, NIMBY_RAIL.radius);
    }
  }
  const S = st.stigma, P = st.prestige, K = st.campus;
  for (let i = 0; i < C; i++) {
    const a = stig[i] + line[i];
    S[i] = a > 0 ? 1 - Math.exp(-a) : 0;
    const p = pres[i];
    P[i] = p > 0 ? 1 - Math.exp(-p) : 0;
    const c = camp[i];
    K[i] = c > 0 ? 1 - Math.exp(-c) : 0;
  }
  // cost model (calibrated on the 256² stress city): per-cell passes + splat touches + building loop
  costEst.set(st, 0.3 + 0.9 * (C / 65536) + 0.45 * (bL.length / 20000) + touches * 6e-6);
}

/** estimated cost (ms) of rebuildNimby for the scheduler (from the previous rebuild's source counts) */
export function nimbyCost(sim: Simulation): number {
  const st = sim.state;
  return costEst.get(st) ?? 0.3 + 0.9 * (st.cells / 65536) + 0.45 * (st.buildings.size / 20000) + 0.6;
}

/** NIMBY / YIMBY values at cell i (inspector) */
export function nimbyAt(st: CityState, i: number): { stigma: number; prestige: number; campus: number } {
  return { stigma: st.stigma[i] ?? 0, prestige: st.prestige[i] ?? 0, campus: st.campus[i] ?? 0 };
}
