/**
 * NIMBY / YIMBY rasters (SIM_DEPTH_SPEC WP2) — PHASE 0 STUB with the final signatures.
 *
 * WP2 implements: st.stigma / st.prestige / st.campus rebuilt once per services pass from def.stigma / prestige /
 * campus (catalog) plus non-catalog sources (highway / rail cells, landfill blocks, I-D / I-M growables), splatted
 * with the 35 %-plateau smoothstep falloff, summed and saturated with 1 - exp(-x). Only functional buildings count.
 * Until then the layers stay 0. Headless: no DOM / three.js.
 */
import type { CityState } from '../CityState';
import type { Simulation } from '../Simulation';

/** rebuild st.stigma / st.prestige / st.campus (one services step, <= 3 ms). STUB: no-op */
export function rebuildNimby(_sim: Simulation): void {
  // WP2
}

/** estimated cost (ms) of rebuildNimby for the scheduler. STUB: 0 */
export function nimbyCost(_sim: Simulation): number {
  return 0;
}

/** NIMBY / YIMBY values at cell i (inspector) */
export function nimbyAt(st: CityState, i: number): { stigma: number; prestige: number; campus: number } {
  return { stigma: st.stigma[i] ?? 0, prestige: st.prestige[i] ?? 0, campus: st.campus[i] ?? 0 };
}
