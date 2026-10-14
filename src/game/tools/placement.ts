/**
 * Placement helpers of the plop tool (headless, state reads only; tests pin them):
 *  - shore buildings (ferry terminal, marina, seaport, hydro dam, desalination, lighthouse) face the water: the auto
 *    rotation picks a side whose front is water by actions.ts's rule (countFront: at least half the front edge water,
 *    the footprint dry) and prefers one whose lot also touches a road (final fixes P14);
 *  - staffed service buildings (schools, clinics, hospitals, police / fire stations, libraries, museums: a coverage and
 *    staff) do not work without a road (final fixes P8: the tip says so in red);
 *  - what one more facility costs at this spot (final fixes P3): its building upkeep plus the running costs of the
 *    people it would newly serve here — the unserved need of its tier in its reach (services' need raster x what the
 *    tier's coverage leaves unserved x the reach falloff x its strength), capped at a typical load (economy/opex.ts
 *    expectedUpkeep); nobody without a road for a staffed service.
 */
import type { Building, CityState } from '../../sim/CityState';
import type { NeedTier } from '../../sim/CityState';
import type { BuildingDef } from '../../sim/catalogTypes';
import type { Simulation } from '../../sim/Simulation';
import { countFront, lotTouchesRoad } from '../../sim/economy/buildings';
import { expectedUpkeep, opexActive, opexTierOf } from '../../sim/economy/opex';
import { newReachScratch, reachCells, tierLayer, type ReachScratch } from '../../sim/infra/catchments';
import { REACH_METRICS, infoOf } from '../../sim/infra/common';

export type Rot = 0 | 1 | 2 | 3;

/** the footprint (dims for rot) at (x, z) is on dry land and its front edge faces water (actions.ts plop's shore rule) */
export function shoreFacesWater(st: CityState, x: number, z: number, w: number, d: number, rot: Rot): boolean {
  if (x < 0 || z < 0 || x + w > st.size || z + d > st.size) return false;
  for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) if (st.water[zz * st.size + xx]) return false;
  const f = countFront(st, x, z, w, d, rot, (i) => st.water[i] === 1);
  return f.total > 0 && f.hit * 2 >= f.total;
}

/**
 * The rotation (and the origin it gives) that faces a shore building's front to the water: among the rotations whose
 * placement passes the shore rule, the one whose lot touches a road, then the most water along the front, then
 * `current` (no flicker); null when no rotation faces water here (the caller falls back to facing the road).
 * `place(rot)` = the origin and dims of the footprint for that rotation (the tool centres it on the cursor).
 */
export function shoreRotation(st: CityState, place: (rot: Rot) => { x: number; z: number; w: number; d: number }, current: Rot): { x: number; z: number; rot: Rot } | null {
  let best: { x: number; z: number; rot: Rot } | null = null;
  let bestScore = -1;
  for (let k = 0; k < 4; k++) {
    const rot = ((current + k) % 4) as Rot;
    const o = place(rot);
    if (!shoreFacesWater(st, o.x, o.z, o.w, o.d, rot)) continue;
    const f = countFront(st, o.x, o.z, o.w, o.d, rot, (i) => st.water[i] === 1);
    const score = (lotTouchesRoad(st, o.x, o.z, o.w, o.d) ? 1000 : 0) + f.hit;
    if (score > bestScore) { bestScore = score; best = { x: o.x, z: o.z, rot }; }
  }
  return best;
}

/** a service building with staff: it does not work until a road touches its lot (actions.ts noRoadWarning's rule) */
export function staffedService(def: Pick<BuildingDef, 'coverage' | 'jobs'>): boolean {
  return !!def.coverage && (def.jobs ?? 0) > 0;
}

let scratch: ReachScratch | null = null;

/**
 * Monthly cost (§, 100 % funding) of one more facility of `def` with footprint (x, z, w, d): its building upkeep plus
 * the running costs of the people it would newly serve there (see the header). null when the def has a flat upkeep,
 * the city charges no running costs, or the services system has no need raster yet (the caller shows the city-wide
 * estimate).
 */
export function upkeepHere(sim: Simulation, def: BuildingDef, x: number, z: number, w: number, d: number): number | null {
  const st = sim.state;
  const tier = opexTierOf(def);
  if (!tier || !opexActive(st)) return null;
  const svc = sim.getSystem('services') as unknown as { needRaster?: (t: NeedTier) => Float32Array | null } | undefined;
  const need = typeof svc?.needRaster === 'function' ? svc.needRaster(tier) : null;
  if (!need || need.length !== st.cells) return null;
  // (the services system's classification of the def: reach radius, metric and strength)
  const inf = infoOf(st, { def: def.id, x, z, w, d } as Building);
  if (inf.tier < 0 || !(inf.tierRadius > 0)) return null;
  let people = 0;
  if (!staffedService(def) || lotTouchesRoad(st, x, z, w, d)) {
    scratch ??= newReachScratch(4096);
    const n = reachCells(st, x, z, w, d, inf.tierRadius, REACH_METRICS[inf.metric] ?? 'walk', scratch);
    const cov = tierLayer(st, tier);
    const idx = scratch.idx, wt = scratch.w;
    for (let q = 0; q < n; q++) {
      const i = idx[q];
      const v = need[i];
      if (v > 0) people += v * wt[q] * Math.max(0, 1 - cov[i]);
    }
    people *= Math.max(0, Math.min(1, inf.tierStrength || 1));
  }
  return expectedUpkeep(st, def, people);
}
