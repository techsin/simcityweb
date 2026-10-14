/**
 * "Why isn't this lot growing?" for EMPTY zoned cells (hover tip of the query tool + inspector). Mirrors the growth
 * rules in src/sim/economy/growth.ts cheaply from state arrays only: road access (lots must touch a road; DEEP BLOCKS:
 * a lot on the road may extend INFILL_MAX_EXTRA rows into the block, so back cells up to LOT_DEPTH + INFILL_MAX_EXTRA
 * deep fill as its yard, and cells behind a standing building fill when that lot is rebuilt), power (state.powered on
 * the lot or a served neighbouring conductor, see utilityReaches; a back cell is judged at its road front), water
 * (medium / high density zones), and RCI demand — only for the DevTypes that can live there (final fixes N4: growth
 * picks a type only where its desirability is above GROW_MIN_DESIR, judged at the lot's road front; demand for R$$$
 * alone never builds on land R$$$ shuns). Power / water are only required when the utilities layer runs
 * (infraFlags(st).utilities), like growth. Also used by the onboarding card (power / water steps), the inspector's
 * lot chips and the zone tool's preview (zonePlanNoAccess, final fixes N3: tiles a new zone would leave without road
 * access).
 */
import type { CellRect } from '../core/events';
import { DEV_TYPE_LABELS, Network, isRoad, zoneDensity, zoneFamily, type Zone } from '../core/types';
import { BF, type CityState } from '../sim/CityState';
import { ZONE_DEVTYPES } from '../sim/catalog';
import { infraFlags } from '../sim/economy/runtime';
import { DESIR_WEIGHTS, GROW_MIN_DESIR, INFILL_MAX_EXTRA, isGrowZone } from '../sim/economy/tuning';

export interface ZoneBlocker {
  /** 'behind': the lot sits behind the buildings on the road (a warning, not a hard blocker: it fills when the lot in
   *  front is rebuilt); 'fit': there is demand, but only for types that can't live here (a warning: it grows once a
   *  type that fits wants in, or the land gets better) */
  id: 'road' | 'behind' | 'power' | 'water' | 'demand' | 'fit';
  /** short line, e.g. "No power (nearest powered cell 7 tiles)" */
  text: string;
}

/**
 * How an empty zoned cell reaches a road front (straight lines, see walkToRoad):
 *  - 'front':  a lot through it can front a road (a road within LOT_DEPTH, only open lot of its zone between)
 *  - 'yard':   deeper (up to LOT_DEPTH + INFILL_MAX_EXTRA) with only open lot between: it fills as the back yard of a
 *              lot built on the road (growth.ts extendInward)
 *  - 'behind': a growable building of its zone stands between it and a road within that depth: it fills when that
 *              lot is rebuilt bigger (redevelopment keeps the yards), or when a street runs into the block
 *  - 'none':   no road within LOT_DEPTH + INFILL_MAX_EXTRA
 */
export type LotAccess = 'front' | 'yard' | 'behind' | 'none';

export interface ZoneStatus {
  /** nothing blocks growth: the lot is waiting for the growth allowance */
  ready: boolean;
  blockers: ZoneBlocker[];
  /** road access of the cell */
  access: LotAccess;
  /** a line that is no blocker ('yard': "Fills as the back yard of a lot on the road") */
  note?: string;
}

/**
 * A zoning the zone tool previews (final fixes N3): the cells of `rect` read as zone `zone`, the growables in
 * `demolished` (other families the rezoning tears down) as open lot.
 */
export interface ZonePlan {
  rect: CellRect;
  zone: number;
  demolished?: ReadonlySet<number>;
}

/** growth builds lots up to this deep from their road front (the largest growables are 4×4) */
const LOT_DEPTH = 4;
/** deepest cell a lot on the road can take in (its footprint + the extra yard rows of growth's extendInward) */
export const BACK_LOT_DEPTH = LOT_DEPTH + INFILL_MAX_EXTRA;
/** nearest-powered-cell search radius (Chebyshev tiles) */
const SEARCH_R = 40;
/** demand at or below this counts as none (the RCI meter's dead band) */
const DEMAND_MIN = 0.02;

const FAMILY_NAME: Record<string, string> = { R: 'residential', C: 'commercial', I: 'industrial' };

const DIRS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const RANK: Record<LotAccess, number> = { none: 0, behind: 1, yard: 2, front: 3 };
const BY_RANK: readonly LotAccess[] = ['none', 'behind', 'yard', 'front'];

/** player-facing lines of the access classes */
export const ACCESS_TEXT = {
  yard: 'Fills as the back yard of a lot on the road',
  behind: 'Behind the buildings on the road — it fills when the lot in front is rebuilt, or run a street into the block',
  none: 'No road access — lots must touch a road',
} as const;

/** zone of cell (x, z), as `plan` would leave it */
function zoneOf(st: CityState, x: number, z: number, plan: ZonePlan | null): number {
  if (plan) {
    const r = plan.rect;
    if (x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1) return plan.zone;
  }
  return st.zone[z * st.size + x];
}

/**
 * Walk from zoned cell (x, z) straight toward a road in direction k, over cells one lot (or its yard, or the lot in
 * front) could cover: same zone, dry, no power line; open cells or growable buildings of the zone (the latter make the
 * cell 'behind'), up to BACK_LOT_DEPTH. Returns the access rank of that direction (RANK), and with `flag`: -1 when one
 * of the cells passed or the road front reached has the flag set (the lot would be served through it). `plan`: judge
 * the city as that zoning would leave it.
 */
function walkDir(st: CityState, x: number, z: number, k: number, flag: Uint8Array | null, plan: ZonePlan | null = null): number {
  const N = st.size, zn = plan ? zoneOf(st, x, z, plan) : st.zone[z * N + x];
  const [dx, dz] = DIRS[k];
  let blocked = false;
  for (let d = 1; d <= BACK_LOT_DEPTH; d++) {
    const xx = x + dx * d, zz = z + dz * d;
    if (xx < 0 || zz < 0 || xx >= N || zz >= N) return 0;
    const j = zz * N + xx;
    const n = st.network[j];
    if (isRoad(n)) {
      if (flag) return flag[j] === 1 ? -1 : 0;
      return blocked ? RANK.behind : d <= LOT_DEPTH ? RANK.front : RANK.yard;
    }
    if (n !== Network.None || (plan ? zoneOf(st, xx, zz, plan) : st.zone[j]) !== zn || st.water[j] || st.powerLines[j]) return 0;
    const bid = st.building[j];
    if (bid >= 0 && !plan?.demolished?.has(bid)) {
      const b = st.buildings.get(bid);
      if (!b || b.flags & BF.Plopped) return 0;
      blocked = true;
    }
    if (flag && flag[j] === 1) return -1;
  }
  return 0;
}

/** road access class of zoned cell (x, z): the best over the four straight directions (see LotAccess); `plan`: as the
 *  zone tool's previewed zoning would leave it */
export function lotAccess(st: CityState, x: number, z: number, plan: ZonePlan | null = null): LotAccess {
  let best = 0;
  for (let k = 0; k < 4 && best < RANK.front; k++) best = Math.max(best, walkDir(st, x, z, k, null, plan));
  return BY_RANK[best];
}

/**
 * The zone tool's road-access check (final fixes N3): the cells of `rect` that zoning it `zone` would zone (dry, no
 * network / power line / plopped building, not that zone already — actions.ts zone()) and the ones among them that
 * will never develop: no road within BACK_LOT_DEPTH in a straight line through the new zone (lotAccess 'none', with the
 * rectangle zoned and the growables of other families it demolishes — `demolished`, the preview's ids — gone). A
 * warning, not a block. Rects above maxCells cells are not checked (total 0).
 */
export function zonePlanNoAccess(st: CityState, rect: CellRect, zone: number, demolished?: readonly number[], maxCells = 20000): { none: number[]; total: number } {
  const N = st.size;
  const x0 = Math.max(0, Math.min(rect.x0, rect.x1)), x1 = Math.min(N, Math.max(rect.x0, rect.x1));
  const z0 = Math.max(0, Math.min(rect.z0, rect.z1)), z1 = Math.min(N, Math.max(rect.z0, rect.z1));
  const out = { none: [] as number[], total: 0 };
  if (!isGrowZone(zone) || x1 <= x0 || z1 <= z0 || (x1 - x0) * (z1 - z0) > maxCells) return out;
  const plan: ZonePlan = { rect: { x0, z0, x1, z1 }, zone, demolished: demolished?.length ? new Set(demolished) : undefined };
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    const i = z * N + x;
    if (st.water[i] || st.network[i] !== Network.None || st.powerLines[i] || st.zone[i] === zone) continue;
    const bid = st.building[i];
    if (bid >= 0) {
      const b = st.buildings.get(bid);
      if (!b || b.flags & BF.Plopped) continue;
    }
    out.total++;
    if (lotAccess(st, x, z, plan) === 'none') out.none.push(i);
  }
  return out;
}

/** the zone tool's warning line for `none` of `total` tiles without road access ('' when none) */
export function noAccessText(none: number, total: number): string {
  if (none <= 0) return '';
  const lead = none >= total ? (total === 1 ? 'This tile has' : `All ${total} tiles have`) : `${none} of ${total} tiles have`;
  return `${lead} no road access and will never develop — a road must run within ${BACK_LOT_DEPTH} tiles of a lot`;
}

/**
 * the lot cell on the road front a back lot fills from (the cell just before the road in the direction of the cell's
 * best road access; the cell itself when it fronts a road or has no access): coverages of a back lot are judged there
 * (services reach a lot through its front; a grown building takes its best cell's coverage)
 */
export function frontCellOf(st: CityState, x: number, z: number): number {
  return lotFront(st, x, z, false);
}

/** the lot cell beside the road in the direction of the cell's best road access (`always`), or only for back lots
 *  (yard / behind: frontCellOf); the cell itself without access */
function lotFront(st: CityState, x: number, z: number, always: boolean): number {
  const N = st.size, i = z * N + x;
  let best = 0, bk = -1;
  for (let k = 0; k < 4; k++) { const r = walkDir(st, x, z, k, null); if (r > best) { best = r; bk = k; } }
  if (bk < 0 || (best === RANK.front && !always)) return i;
  const [dx, dz] = DIRS[bk];
  for (let d = 1; d <= BACK_LOT_DEPTH; d++) {
    const xx = x + dx * d, zz = z + dz * d;
    if (isRoad(st.network[zz * N + xx])) return (zz - dz) * N + (xx - dx);
  }
  return i;
}

/** a lot through this cell can front a road: a road within LOT_DEPTH in a straight line, only open same-zone lot between */
export function roadAccess(st: CityState, x: number, z: number): boolean {
  return lotAccess(st, x, z) === 'front';
}

/**
 * The utility reaches zoned cell i: its own flag (state.powered / state.watered); a served 4-neighbour that feeds empty
 * lots the way src/sim/infra/utilities.ts does (power through any network / power-line / building cell, water only
 * through road pipes); or, for cells deeper in the block, a flagged cell / road front of a lot that would include it
 * (growth serves a lot through any of its cells or its road front) — judged in the directions of the cell's best road
 * access (a back lot is served through the road it fills from). The neighbour rule also keeps the answer right for lots
 * zoned while PAUSED: the utilities system flags those on its next soft refresh, which waits for game days.
 */
export function utilityReaches(st: CityState, arr: Uint8Array, i: number, kind: 'power' | 'water'): boolean {
  if (arr[i]) return true;
  const N = st.size, x = i % N, z = (i - x) / N, p = kind === 'power';
  if ((x > 0 && feeds(st, arr, i - 1, p)) || (x < N - 1 && feeds(st, arr, i + 1, p)) || (i >= N && feeds(st, arr, i - N, p)) || (i + N < st.cells && feeds(st, arr, i + N, p))) return true;
  if (st.zone[i] === 0) return false;
  const ranks = [0, 0, 0, 0];
  let best = 0;
  for (let k = 0; k < 4; k++) { ranks[k] = walkDir(st, x, z, k, null); if (ranks[k] > best) best = ranks[k]; }
  if (best === 0) return false;
  for (let k = 0; k < 4; k++) if (ranks[k] === best && walkDir(st, x, z, k, arr) < 0) return true;
  return false;
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

/** −1..1 in the inspector's points: "+18", "−30" (true minus), "0" under half a point (inspectorModel signedPts) */
function pts(v: number): string {
  const r = Math.round(Math.abs(v) * 100);
  return r === 0 ? '0' : `${v > 0 ? '+' : '−'}${r}`;
}

/**
 * the 'fit' blocker's line (final fixes N4): demand exists, but only for DevTypes whose desirability on this lot is at
 * or below growth's floor. `idle`: types that could live here but have no demand; `unfit`: types with demand that can't
 * — named with the land value when that is what keeps them away (every one of them weighs land value heavily and the
 * lot is below their reference), else their best desirability. "Waiting for demand: no R$ demand; R$$$ can't live here
 * (land value 0%)"
 */
function fitText(st: CityState, zn: number, fi: number, idle: readonly number[], unfit: readonly number[]): string {
  const fam = zoneFamily(zn as Zone);
  const verb = fam === 'R' ? "can't live here" : fam === 'C' ? "won't open here" : "won't move in here";
  const names = (ds: readonly number[]) => ds.map((d) => DEV_TYPE_LABELS[d]).join(' / ');
  const lv = st.landValue[fi] ?? 0;
  const lvLow = unfit.every((d) => DESIR_WEIGHTS[d].lv >= 0.4 && lv < DESIR_WEIGHTS[d].lvRef);
  let best = -1;
  for (const d of unfit) best = Math.max(best, st.desirability[d]?.[fi] ?? -1);
  const why = lvLow ? `land value ${Math.round(lv * 100)}%` : `desirability ${pts(best)}, growth needs above ${pts(GROW_MIN_DESIR)}`;
  const tail = `${names(unfit)} ${verb} (${why})`;
  return idle.length ? `Waiting for demand: no ${names(idle)} demand; ${tail}` : `Land too unattractive: ${tail}`;
}

/** status of an empty growable zoned cell; null for anything else (not zoned, built on, road, water...) */
export function emptyZoneStatus(st: CityState, x: number, z: number): ZoneStatus | null {
  if (!st.inBounds(x, z)) return null;
  const N = st.size;
  const i = z * N + x;
  const zn = st.zone[i];
  if (!isGrowZone(zn) || st.building[i] >= 0 || st.network[i] || st.water[i] || st.powerLines[i]) return null;
  const blockers: ZoneBlocker[] = [];
  const access = lotAccess(st, x, z);
  if (access === 'none') blockers.push({ id: 'road', text: ACCESS_TEXT.none });
  else if (access === 'behind') blockers.push({ id: 'behind', text: ACCESS_TEXT.behind });
  const util = infraFlags(st).utilities;
  if (util && !utilityReaches(st, st.powered, i, 'power')) {
    const d = nearestSet(st.powered, N, x, z);
    blockers.push({ id: 'power', text: d > 0 ? `No power (nearest powered cell ${d} tile${d === 1 ? '' : 's'})` : 'No power — no power plant reaches this area' });
  }
  if (util && zoneDensity(zn as Zone) >= 2 && !utilityReaches(st, st.watered, i, 'water')) {
    blockers.push({ id: 'water', text: 'No water (needed for medium / high density)' });
  }
  const devs = ZONE_DEVTYPES[zn] ?? [];
  if (devs.length) {
    const dem = st.stats.demand;
    // growth picks a type for a lot only where its desirability is above GROW_MIN_DESIR (growth.ts pickDev), at the
    // lot cell beside the road it grows the lot from (tryGrow's candidate) — for a cell deeper in the lot, the one on
    // the road in the direction of its best access
    const fi = access === 'none' ? i : lotFront(st, x, z, true);
    let wanted = 0, hosted = false;
    const idle: number[] = [], unfit: number[] = [];
    for (const d of devs) {
      const want = (dem?.[d] ?? 0) > DEMAND_MIN;
      const fits = (st.desirability[d]?.[fi] ?? 0) > GROW_MIN_DESIR;
      if (want) wanted++;
      if (want && fits) hosted = true;
      else if (fits) idle.push(d);
      else if (want) unfit.push(d);
    }
    if (!wanted) {
      const fam = FAMILY_NAME[zoneFamily(zn as Zone) ?? ''] ?? '';
      const names = devs.map((d) => DEV_TYPE_LABELS[d]).join(' / ');
      blockers.push({ id: 'demand', text: `No ${fam ? fam + ' ' : ''}demand right now (${names})` });
    } else if (!hosted) blockers.push({ id: 'fit', text: fitText(st, zn, fi, idle, unfit) });
  }
  return { ready: blockers.length === 0, blockers, access, note: access === 'yard' ? ACCESS_TEXT.yard : undefined };
}

/** the status only waits on the lot in front ('behind') or on demand that fits ('fit') — a warning, not a red blocker */
export function zoneStatusTone(s: ZoneStatus): 'ok' | 'warn' | 'bad' {
  if (s.ready) return 'ok';
  return s.blockers.every((b) => b.id === 'behind' || b.id === 'fit') ? 'warn' : 'bad';
}

/** one-line summary: "Not growing: no power (nearest powered cell 7 tiles)" / "Ready to grow" / the 'behind' line /
 *  the 'fit' line ("Waiting for demand: …") */
export function zoneStatusLine(s: ZoneStatus): string {
  if (s.ready) return s.access === 'yard' ? `Ready — ${ACCESS_TEXT.yard.charAt(0).toLowerCase()}${ACCESS_TEXT.yard.slice(1)}` : 'Ready to grow — waiting for a builder';
  const first = s.blockers[0];
  if (first.id === 'behind' || first.id === 'fit') return first.text;
  return 'Not growing: ' + first.text.charAt(0).toLowerCase() + first.text.slice(1);
}
