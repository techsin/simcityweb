/**
 * Placement helpers of the plop tool (headless, state reads only; tests pin them):
 *  - shore buildings (ferry terminal, marina, seaport, hydro dam, desalination, lighthouse) face the water: the auto
 *    rotation picks a side whose front is water by actions.ts's rule (countFront: at least half the front edge water,
 *    the footprint dry) and prefers one whose lot also touches a road (final fixes P14);
 *  - staffed service buildings (schools, clinics, hospitals, police / fire stations, libraries, museums: a coverage and
 *    staff) do not work without a road (final fixes P8: the tip says so in red);
 *  - what one more facility costs at this spot (final fixes P3, recalibrated in UI-1): its building upkeep plus the
 *    running costs of the people it would newly serve here (servedHere: the services tier engine's arithmetic replayed
 *    for this one facility); nobody without a road for a staffed service.
 */
import type { Building, CityState } from '../../sim/CityState';
import type { BuildingDef, ServiceKind } from '../../sim/catalogTypes';
import { countFront, lotTouchesRoad } from '../../sim/economy/buildings';
import { expectedUpkeep, opexActive, opexRateOf, opexTierOf } from '../../sim/economy/opex';
import { newReachScratch, reachCells, tierLayer, tierProvider, type ReachScratch } from '../../sim/infra/catchments';
import { REACH_METRICS, infoOf, readEffects } from '../../sim/infra/common';
import { justiceFactors } from '../../sim/infra/justice';

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

/** the best claim share per reached multi-cell building (servedHere): an open-addressing table keyed by building id,
 *  stamped per call (no clearing, no allocation while the reach fits) */
class LotTable {
  key = new Int32Array(0);
  val = new Float32Array(0);
  stamp = new Int32Array(0);
  slots = new Int32Array(0);
  n = 0;
  gen = 0;
  begin(reached: number): void {
    let cap = 1024;
    while (cap < reached * 2) cap *= 2;
    if (this.key.length < cap) {
      this.key = new Int32Array(cap); this.val = new Float32Array(cap); this.stamp = new Int32Array(cap); this.slots = new Int32Array(cap);
      this.gen = 0;
    }
    if (++this.gen > 0x7ffffff0) { this.stamp.fill(0); this.gen = 1; }
    this.n = 0;
  }
  /** keep the larger share for building `id` */
  max(id: number, a: number): void {
    const mask = this.key.length - 1;
    let h = (Math.imul(id, 0x9e3779b1) >>> 0) & mask;
    for (;;) {
      if (this.stamp[h] !== this.gen) {
        this.stamp[h] = this.gen; this.key[h] = id; this.val[h] = a; this.slots[this.n++] = h;
        return;
      }
      if (this.key[h] === id) { if (a > this.val[h]) this.val[h] = a; return; }
      h = (h + 1) & mask;
    }
  }
}
const lots = new LotTable();

/** fundingFactor's numbers without serviceEffectiveness's econData initialization/normalization on a read. */
function upkeepFunding(st: CityState, service: ServiceKind | undefined): number {
  if (!service) return 1;
  const economy = st.systemData.economy as { v?: number; strikes?: Partial<Record<ServiceKind, number>> } | undefined;
  const strikes = economy?.v === 1 ? economy.strikes : {};
  const pct = st.budget.funding[service];
  if (strikes) {
    if ((strikes[service] ?? 0) > 0) return 0;
    const v = Math.pow(Math.max(0, (pct ?? 100) / 100), 0.7);
    if (Number.isFinite(v)) return Math.max(0, v);
  }
  // The existing fallback also covers old v1 data without strikes and non-finite funding.
  if (pct === undefined || pct === null || !isFinite(pct)) return 1;
  const f = Math.max(0, pct) / 100;
  return f <= 1 ? f : 1 + (1 - Math.exp(-(f - 1) * 2.5)) * 0.35;
}

/**
 * The people one more facility of `def` with footprint (x, z, w, d) would newly serve — the change in its tier's
 * stats.needs served, which the running costs are charged on (economy/opex.ts) — by the services tier engine's own
 * arithmetic (services.ts) replayed for this one facility on the last pass's need raster and coverage layer:
 *  - reach: catchments.reachCells, the claim share a = falloff x strength of every reached cell;
 *  - shared tiers (schools, clinics, hospitals, parks, police — capacity shared seat by seat): the facility claims
 *    min(unseated share, a) of a cell — the unseated share read as 1 - coverage — and seats min(1, capacity / claims)
 *    of its claims at its quality (funding x ordinance x justice: a 110 % school serves 1.1 per pupil seated; a new
 *    facility counts as fully staffed, like services' unknown staffing); the coverage tops out at 1;
 *  - union tier (fire): (1 - coverage) x min(1, a x quality) of a cell (1 - (1 - c)(1 - v));
 *  - a lot counts as a whole (services' footprint max): the reached front row of a deep lot covers its back rows too,
 *    so a multi-cell building gains its best reached cell's share on its whole need.
 * Final fixes UI-1: the cursor multiplied the reach share by the uncovered share and counted only the reached front
 * cells, 1.4-2.8x under the real budget change in a 312k city (2x on libraries and museums of a 1M one); replayed like
 * this it lands within 3 % of the services pass on 330 sites of two bot cities, every running-cost def.
 * 0 for a staffed service without a road (it does not work), null without a need raster / tier (see upkeepHere).
 */
export function servedHere(st: CityState, def: BuildingDef, x: number, z: number, w: number, d: number, need: Float32Array | null): number | null {
  const tier = opexTierOf(def);
  if (!tier) return null;
  if (!need || need.length !== st.cells) return null;
  // (the services system's classification of the def: reach radius, metric, strength and capacity)
  const self = { def: def.id, x, z, w, d } as Building;
  const inf = infoOf(st, self);
  if (inf.tier < 0 || !(inf.tierRadius > 0)) return null;
  if (staffedService(def) && !lotTouchesRoad(st, x, z, w, d)) return 0;
  const prov = tierProvider(tier);
  const shared = prov?.shared ?? (tier !== 'police' && tier !== 'fire');
  let cap = inf.tierCap;
  if (prov?.capacityOf) { const c = prov.capacityOf(st, self); if (c > 0) cap = c; }
  // quality (services opOf without the staffing / power / water factors of a running facility)
  const fx = readEffects(st);
  let op = upkeepFunding(st, inf.service);
  if (tier === 'police') op *= fx.policeEffect * justiceFactors(st).policeMul;
  else if (tier === 'elementary' || tier === 'high' || tier === 'college') op *= fx.eduEffect;
  else if (tier === 'health') op *= fx.healthEffect;
  if (!(op > 0)) return 0;
  const s = inf.tierStrength;
  scratch ??= newReachScratch(4096);
  const n = reachCells(st, x, z, w, d, inf.tierRadius, REACH_METRICS[inf.metric] ?? 'walk', scratch);
  const L = tierLayer(st, tier);
  const idx = scratch.idx, wt = scratch.w;
  // claims (per reached cell, as services seats them) -> the seated share of a crowded facility; union tiers
  // (police without its provider) ration by the need in reach
  let D = 0;
  for (let q = 0; q < n; q++) {
    const v = need[idx[q]];
    if (!(v > 0)) continue;
    D += shared ? v * Math.min(Math.max(0, 1 - L[idx[q]]), wt[q] * s) : v * wt[q];
  }
  const r = op * (cap < Infinity && D > cap ? cap / D : 1);
  const gain = (a: number, l: number) => {
    const u = l < 1 ? 1 - l : 0;
    return shared ? Math.min(u, Math.min(u, a) * r) : u * Math.min(1, a * r);
  };
  const N = st.size, grid = st.building;
  let people = 0;
  lots.begin(n);
  for (let q = 0; q < n; q++) {
    const i = idx[q];
    const a = wt[q] * s;
    if (!(a > 0)) continue;
    const id = grid[i];
    if (id >= 0) {
      // (a multi-cell building shares its id with a neighbouring cell: no building lookup per cell)
      const x0 = i % N;
      if ((x0 > 0 && grid[i - 1] === id) || (x0 < N - 1 && grid[i + 1] === id) || (i >= N && grid[i - N] === id) || (i + N < grid.length && grid[i + N] === id)) {
        lots.max(id, a);
        continue;
      }
    }
    const v = need[i];
    if (v > 0) people += v * gain(a, L[i]);
  }
  for (let k = 0; k < lots.n; k++) {
    const h = lots.slots[k];
    const b = st.buildings.get(lots.key[h]);
    if (!b) continue;
    let nb = 0, lb = 0;
    for (let zz = Math.max(0, b.z); zz < Math.min(N, b.z + b.d); zz++) {
      for (let xx = Math.max(0, b.x); xx < Math.min(N, b.x + b.w); xx++) {
        const i = zz * N + xx;
        nb += need[i];
        if (L[i] > lb) lb = L[i];
      }
    }
    if (nb > 0) people += nb * gain(lots.val[h], lb);
  }
  return people;
}

/**
 * Monthly cost (§, 100 % funding) of one more facility of `def` with footprint (x, z, w, d): its building upkeep plus
 * the running costs of the people it would newly serve there (servedHere) — the budget change it makes. Bounded by the
 * facility's own capacity, not by expectedUpkeep's typical load (the city-wide estimate of the build card: a fire
 * station in a 1M city's unserved district newly protects 13-17k people, §690-870 a month against the typical §539).
 * null when the def has a flat upkeep, the city charges no running costs, or the services system has no need raster
 * yet (the caller shows the city-wide estimate).
 */
export function upkeepHere(st: CityState, def: BuildingDef, x: number, z: number, w: number, d: number, need: Float32Array | null): number | null {
  const rate = opexRateOf(def);
  if (!rate || !opexActive(st)) return null;
  const people = servedHere(st, def, x, z, w, d, need);
  if (people === null) return null;
  // (expectedUpkeep with nobody served = the building share)
  return expectedUpkeep(st, def, 0) + Math.max(0, people) * rate.rate;
}
