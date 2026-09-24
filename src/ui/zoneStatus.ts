/**
 * "Why isn't this lot growing?" for EMPTY zoned cells (hover tip of the query tool + inspector). Mirrors the growth
 * rules in src/sim/economy/growth.ts cheaply from state arrays only: road access (lots must touch a road), power
 * (state.powered on the lot or a served neighbouring conductor, see utilityReaches), water (medium / high density
 * zones), and RCI demand. Power / water are only required when the utilities layer runs (infraFlags(st).utilities),
 * like growth. Also used by the onboarding card (power / water steps) and the inspector's lot chips.
 */
import { DEV_TYPE_LABELS, Network, isRoad, zoneDensity, zoneFamily, type Zone } from '../core/types';
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

/** growth builds lots up to this deep from their road front (the largest growables are 4×4) */
const LOT_DEPTH = 4;
/** nearest-powered-cell search radius (Chebyshev tiles) */
const SEARCH_R = 40;

const FAMILY_NAME: Record<string, string> = { R: 'residential', C: 'commercial', I: 'industrial' };

const DIRS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Walk from zoned cell (x, z) straight toward a road, over cells one lot could cover together with it (same zone,
 * empty, dry, no power line), up to LOT_DEPTH. Without `flag`: true when a road front is reached. With `flag`: true
 * when one of those lot cells or the road front reached has the flag set.
 */
function walkToRoad(st: CityState, x: number, z: number, flag: Uint8Array | null): boolean {
  const N = st.size, zn = st.zone[z * N + x];
  for (const [dx, dz] of DIRS) {
    for (let d = 1; d <= LOT_DEPTH; d++) {
      const xx = x + dx * d, zz = z + dz * d;
      if (xx < 0 || zz < 0 || xx >= N || zz >= N) break;
      const j = zz * N + xx;
      const n = st.network[j];
      if (isRoad(n)) {
        if (!flag || flag[j] === 1) return true;
        break;
      }
      if (n !== Network.None || st.zone[j] !== zn || st.building[j] >= 0 || st.water[j] || st.powerLines[j]) break;
      if (flag && flag[j] === 1) return true;
    }
  }
  return false;
}

/** a lot through this cell can front a road: a road within LOT_DEPTH in a straight line, only open same-zone lot between */
export function roadAccess(st: CityState, x: number, z: number): boolean {
  return walkToRoad(st, x, z, null);
}

/**
 * The utility reaches zoned cell i: its own flag (state.powered / state.watered); a served 4-neighbour that feeds empty
 * lots the way src/sim/infra/utilities.ts does (power through any network / power-line / building cell, water only
 * through road pipes); or, for cells deeper in the block, a flagged cell / road front of a lot that would include it
 * (growth serves a lot through any of its cells or its road front). The neighbour rule also keeps the answer right for
 * lots zoned while PAUSED: the utilities system flags those on its next soft refresh, which waits for game days.
 */
export function utilityReaches(st: CityState, arr: Uint8Array, i: number, kind: 'power' | 'water'): boolean {
  if (arr[i]) return true;
  const N = st.size, x = i % N, z = (i - x) / N, p = kind === 'power';
  if ((x > 0 && feeds(st, arr, i - 1, p)) || (x < N - 1 && feeds(st, arr, i + 1, p)) || (i >= N && feeds(st, arr, i - N, p)) || (i + N < st.cells && feeds(st, arr, i + N, p))) return true;
  return st.zone[i] !== 0 && walkToRoad(st, x, z, arr);
}

function feeds(st: CityState, arr: Uint8Array, j: number, power: boolean): boolean {
  return arr[j] === 1 && (power ? st.network[j] !== Network.None || st.powerLines[j] !== 0 || st.building[j] >= 0 : isRoad(st.network[j]));
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
  if (util && !utilityReaches(st, st.powered, i, 'power')) {
    const d = nearestSet(st.powered, N, x, z);
    blockers.push({ id: 'power', text: d > 0 ? `No power (nearest powered cell ${d} tile${d === 1 ? '' : 's'})` : 'No power — no power plant reaches this area' });
  }
  if (util && zoneDensity(zn as Zone) >= 2 && !utilityReaches(st, st.watered, i, 'water')) {
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
