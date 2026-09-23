/**
 * "Why isn't this lot growing?" for EMPTY zoned cells (hover tip of the query tool + inspector). Mirrors the growth
 * rules in src/sim/economy/growth.ts cheaply from state arrays only: road access (lots must touch a road), power
 * (state.powered on the lot or its road front), water (medium / high density zones), and RCI demand.
 * Power / water are only required when the utilities layer runs (infraFlags(st).utilities), like growth.
 */
import { DEV_TYPE_LABELS, Network, zoneDensity, zoneFamily, type Zone } from '../core/types';
import type { CityState } from '../sim/CityState';
import { ZONE_DEVTYPES } from '../sim/catalog';
import { infraFlags } from '../sim/economy/runtime';
import { isGrowZone } from '../sim/economy/tuning';

export interface ZoneBlocker {
  id: 'road' | 'power' | 'water' | 'demand';
  /** short line, e.g. "No power (nearest powered cell 7 tiles)" */
  text: string;
}

export interface ZoneStatus {
  /** nothing blocks growth: the lot is waiting for the growth allowance */
  ready: boolean;
  blockers: ZoneBlocker[];
}

const isRoadN = (n: number) => n >= Network.Street && n <= Network.Highway;
/** growth carves lots up to this deep from the road front */
const LOT_DEPTH = 3;
/** nearest-powered-cell search radius (Chebyshev tiles) */
const SEARCH_R = 40;

const FAMILY_NAME: Record<string, string> = { R: 'residential', C: 'commercial', I: 'industrial' };

/** road within LOT_DEPTH tiles in a straight line (lots are carved perpendicular to the road front) */
function roadAccess(st: CityState, x: number, z: number): boolean {
  const N = st.size;
  for (let d = 1; d <= LOT_DEPTH; d++) {
    if (x - d >= 0 && isRoadN(st.network[z * N + x - d])) return true;
    if (x + d < N && isRoadN(st.network[z * N + x + d])) return true;
    if (z - d >= 0 && isRoadN(st.network[(z - d) * N + x])) return true;
    if (z + d < N && isRoadN(st.network[(z + d) * N + x])) return true;
  }
  return false;
}

/** the utility flag on the cell or a 4-neighbour (a lot is served when any of its cells / front cells is) */
function servedNear(arr: Uint8Array, N: number, x: number, z: number): boolean {
  const i = z * N + x;
  if (arr[i]) return true;
  if (x > 0 && arr[i - 1]) return true;
  if (x < N - 1 && arr[i + 1]) return true;
  if (z > 0 && arr[i - N]) return true;
  if (z < N - 1 && arr[i + N]) return true;
  return false;
}

/** Chebyshev distance to the nearest cell with arr[i] set (ring scan), or -1 beyond SEARCH_R */
export function nearestSet(arr: Uint8Array, N: number, x: number, z: number, maxR = SEARCH_R): number {
  for (let r = 1; r <= maxR; r++) {
    const x0 = x - r, x1 = x + r, z0 = z - r, z1 = z + r;
    for (let xx = Math.max(0, x0); xx <= Math.min(N - 1, x1); xx++) {
      if (z0 >= 0 && arr[z0 * N + xx]) return r;
      if (z1 < N && arr[z1 * N + xx]) return r;
    }
    for (let zz = Math.max(0, z0 + 1); zz <= Math.min(N - 1, z1 - 1); zz++) {
      if (x0 >= 0 && arr[zz * N + x0]) return r;
      if (x1 < N && arr[zz * N + x1]) return r;
    }
  }
  return -1;
}

/** status of an empty growable zoned cell; null for anything else (not zoned, built on, road, water...) */
export function emptyZoneStatus(st: CityState, x: number, z: number): ZoneStatus | null {
  if (!st.inBounds(x, z)) return null;
  const N = st.size;
  const i = z * N + x;
  const zn = st.zone[i];
  if (!isGrowZone(zn) || st.building[i] >= 0 || st.network[i] || st.water[i] || st.powerLines[i]) return null;
  const blockers: ZoneBlocker[] = [];
  if (!roadAccess(st, x, z)) blockers.push({ id: 'road', text: 'No road access — lots must touch a road' });
  const util = infraFlags(st).utilities;
  if (util && !servedNear(st.powered, N, x, z)) {
    const d = nearestSet(st.powered, N, x, z);
    blockers.push({ id: 'power', text: d > 0 ? `No power (nearest powered cell ${d} tile${d === 1 ? '' : 's'})` : 'No power — no power plant reaches this area' });
  }
  if (util && zoneDensity(zn as Zone) >= 2 && !servedNear(st.watered, N, x, z)) {
    blockers.push({ id: 'water', text: 'No water (needed for medium / high density)' });
  }
  const devs = ZONE_DEVTYPES[zn] ?? [];
  const dem = st.stats.demand;
  let best = -1;
  for (const d of devs) best = Math.max(best, dem?.[d] ?? 0);
  if (devs.length && best <= 0.02) {
    const fam = FAMILY_NAME[zoneFamily(zn as Zone) ?? ''] ?? '';
    const names = devs.map((d) => DEV_TYPE_LABELS[d]).join(' / ');
    blockers.push({ id: 'demand', text: `No ${fam ? fam + ' ' : ''}demand right now (${names})` });
  }
  return { ready: blockers.length === 0, blockers };
}

/** one-line summary: "Not growing: no power (nearest powered cell 7 tiles)" / "Ready to grow" */
export function zoneStatusLine(s: ZoneStatus): string {
  if (s.ready) return 'Ready to grow — waiting for a builder';
  const first = s.blockers[0].text;
  return 'Not growing: ' + first.charAt(0).toLowerCase() + first.slice(1);
}
