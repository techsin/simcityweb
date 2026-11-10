/**
 * The RCI segment's guide (POLISH_PLAN FH-03, LG-05), headless (src/ui/topbar/rciSegment.ts draws it):
 * - FH-03's "+ zone" badge: a family whose demand is above ZONE_BADGE_DEMAND with fewer than ZONE_BADGE_LOTS empty
 *   road-facing lots (zoneRoom, src/ui/adviceActions.ts) — "zone more", where the tall bar used to offer no action. A
 *   click runs that family's zoning action (the toast's "Zone homes / shops / industry").
 * - Never on a full map (free land under BUILT_OUT_FREE of the map, the advisors' own free-land test): zoning more is not
 *   possible there. When a family also has no room left, the advisors call the city built out, and the RCI popover shows
 *   LG-05's built-out advice (builtOutIssue) with its buttons instead.
 */
import { BUILT_OUT_FREE, type OpenAdvice } from '../../sim/economy/advisors';
import type { ZoneRoom } from '../adviceActions';

/** a family's demand (the RCI bar's value) above this, with fewer than ZONE_BADGE_LOTS empty lots: the badge */
export const ZONE_BADGE_DEMAND = 0.5;
export const ZONE_BADGE_LOTS = 12;
/** the zoning advice per family (0 R, 1 C, 2 I): the badge's action (src/ui/adviceActions.ts ids) */
export const ZONE_ADVICE = ['zoneR', 'zoneC', 'zoneI'] as const;
const FAMILY = ['residential', 'commercial', 'industrial'];
const ZONE_WHAT = ['homes', 'shops', 'industry'];

/** free land under BUILT_OUT_FREE of the map's `cells` tiles (LG-05's full map: no new land to zone) */
export function builtOut(room: Pick<ZoneRoom, 'free'>, cells: number): boolean {
  return room.free < BUILT_OUT_FREE * cells;
}

export interface ZoneBadge {
  /** the families that want more zoning (0 R, 1 C, 2 I), in RCI order */
  fams: number[];
  /** the one the click zones: the strongest demand of `fams` (-1: no badge) */
  fam: number;
  /** the badge's tooltip ('' without a badge) */
  title: string;
}

/** the "+ zone" badge for `demand` per family (the RCI bars' values) and the room left */
export function zoneBadge(room: ZoneRoom, cells: number, demand: readonly number[]): ZoneBadge {
  const none: ZoneBadge = { fams: [], fam: -1, title: '' };
  if (builtOut(room, cells)) return none;
  const fams = [0, 1, 2].filter((f) => (demand[f] ?? 0) > ZONE_BADGE_DEMAND && room.front[f] < ZONE_BADGE_LOTS);
  if (!fams.length) return none;
  const fam = fams.reduce((a, b) => ((demand[b] ?? 0) > (demand[a] ?? 0) ? b : a));
  const lots = (f: number) => `${room.front[f] === 0 ? 'no' : room.front[f].toLocaleString('en-US')} empty ${FAMILY[f]} ${room.front[f] === 1 ? 'lot' : 'lots'}`;
  const who = fams.map((f) => FAMILY[f]);
  const lead = `${who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}` : who[0]} demand is strong`;
  const title = `${lead.charAt(0).toUpperCase()}${lead.slice(1)}, with ${fams.map(lots).join(' and ')} left. Click to zone ${ZONE_WHAT[fam]}.`;
  return { fams, fam, title };
}

/** LG-05: the built-out advice among the advisors' open issues (the RCI popover's line), if any */
export function builtOutIssue(issues: readonly OpenAdvice[] | undefined): OpenAdvice | null {
  return issues?.find((a) => a.id === 'builtOut') ?? null;
}
