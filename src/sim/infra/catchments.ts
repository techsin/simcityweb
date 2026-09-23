/**
 * Catchments & proximity engine (SIM_DEPTH_SPEC WP2) — PHASE 0 STUB with the final signatures.
 *
 * WP2 implements: reach kernels (walk / drive / euclid), the tier engine with capacity sharing (enhanced 2-step
 * floating catchment), access fields (accessCommute, shopAccess), per-facility load and unserved clusters.
 * Until then: tier layers are the (zero) new layers or the legacy coverage layers, facilityLoad = null,
 * unservedClusters = [], reachCells = 0. Headless: no DOM / three.js.
 */
import type { CityState, NeedTier } from '../CityState';
import type { Simulation } from '../Simulation';
import type { ReachMetric, ServiceTier } from '../catalogTypes';

/** need tier served by each service tier */
export const TIER_NEED: Readonly<Record<ServiceTier, NeedTier>> = {
  elementary: 'elementary', high: 'high', college: 'college', library: 'college', clinic: 'health', hospital: 'health',
  play: 'play', green: 'green', police: 'police', fire: 'fire',
};

/** coverage layer of a need tier */
export function tierLayer(st: CityState, tier: NeedTier): Float32Array {
  switch (tier) {
    case 'elementary': return st.eduElemCov;
    case 'high': return st.eduHighCov;
    case 'college': return st.eduCollegeCov;
    case 'health': return st.healthCov;
    case 'play': return st.playCov;
    case 'green': return st.greenCov;
    case 'police': return st.policeCov;
    case 'fire': return st.fireCov;
  }
}

export interface FacilityLoad {
  tier: ServiceTier;
  needTier: NeedTier;
  /** seats / patient-equivalents / visitors (Infinity for capacity-free tiers) */
  capacity: number;
  /** competition-weighted demand reaching the facility */
  demand: number;
  /** demand / (capacity x operating) */
  utilization: number;
  served: number;
  /** operating factor 0..1+ (funding x ordinance x power x water x staffing) */
  operating: number;
  powered: boolean;
  /** reach radius (cells) and metric */
  radius: number;
  metric: ReachMetric;
}

/** load of a service building (WP5 inspector, WP6 bot). STUB: null */
export function facilityLoad(_sim: Simulation, _buildingId: number): FacilityLoad | null {
  return null;
}

/** where most people lack a tier: coarse 8x8 blocks, sum need x (1 - cov) where cov < 0.3, top `max`. STUB: [] */
export function unservedClusters(_sim: Simulation, _tier: NeedTier, _max = 5): { x: number; z: number; people: number }[] {
  return [];
}

/** reach output: cell indices and falloff weights 0..1 (capacity >= cells reached) */
export interface ReachScratch {
  idx: Int32Array;
  w: Float32Array;
}
export function newReachScratch(cells: number): ReachScratch {
  return { idx: new Int32Array(cells), w: new Float32Array(cells) };
}

/**
 * cells reached from a footprint (bx, bz, bw, bd) within `radius` (cells; walk / drive radii are multiplied by
 * ROAD_RADIUS_FACTOR inside) by `metric`; fills scratch.idx / scratch.w, returns the count. STUB: 0
 */
export function reachCells(_st: CityState, _bx: number, _bz: number, _bw: number, _bd: number, _radius: number, _metric: ReachMetric, _scratch: ReachScratch): number {
  return 0;
}
