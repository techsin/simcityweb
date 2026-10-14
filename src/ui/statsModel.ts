/**
 * City statistics panel model (headless, no DOM): the Park & ride card's line and the commute by mode. StatsPanel
 * renders them; tests pin them.
 */
import { compact } from './format';
import { BF, type CommuteByMode } from '../sim/CityState';
import { CATALOG } from '../sim/catalog';

/**
 * the parking garage defs the traffic system runs park & ride from (traffic.ts GARAGE_DEFS), derived from the catalog
 * (routed 50: the transport buildings the roads service runs — parking garages; a hard-coded id duplicated traffic's
 * private list)
 */
export const GARAGE_DEFS: ReadonlySet<string> = new Set(CATALOG.filter((d) => d.category === 'transport' && d.service === 'roads').map((d) => d.id));

/** parking garages by their state in the last traffic assignment (TrafficSystem.garageInfo(id)) */
export interface GarageCounts {
  /** parking garages standing */
  total: number;
  /** park & ride garages ('parkRide'): a stop within reach whose riders ride a vehicle */
  parkRide: number;
  /** of those, the ones that keep all their spaces for the parking-short block around them (reserve = spaces) */
  kept: number;
  /** by a downtown stop ('downtown': its riders walk to jobs beside it) — parking only */
  downtown: number;
  /** by a stop whose transit reaches no jobs yet ('noTransit') */
  noTransit: number;
  /** standing (not burnt / abandoned) but not seen by a traffic assignment yet: placed since the last one */
  pending: number;
}

/** what countGarages reads from the traffic system (null: a garage no assignment has seen yet) */
export interface GarageStates {
  garageInfo?(id: number): { state?: string; spaces?: number; reserve?: number } | null;
}

/** the garages among `buildings` by their park & ride state (traffic: no system, or not seen yet → only counted) */
export function countGarages(buildings: Iterable<{ id: number; def: string; flags?: number }>, traffic: GarageStates | null | undefined): GarageCounts {
  const out: GarageCounts = { total: 0, parkRide: 0, kept: 0, downtown: 0, noTransit: 0, pending: 0 };
  for (const b of buildings) {
    if (!GARAGE_DEFS.has(b.def)) continue;
    out.total++;
    const g = traffic?.garageInfo?.(b.id);
    if (!g) {
      if (traffic?.garageInfo && !((b.flags ?? 0) & (BF.Burnt | BF.Abandoned))) out.pending++;
      continue;
    }
    const state = g.state;
    if (state === 'parkRide') {
      out.parkRide++;
      // (no park & ride room left: what the garage's own report calls "all N spaces kept for the businesses around it")
      const spaces = g.spaces ?? 0;
      if (spaces > 0 && Math.round(g.reserve ?? 0) >= spaces) out.kept++;
    } else if (state === 'downtown') out.downtown++;
    else if (state === 'noTransit') out.noTransit++;
  }
  return out;
}

/**
 * The Park & ride card's line. stats.transitFleet.parkRideSpaces sums the park & ride room of the garages in park &
 * ride service after the last traffic assignment: each one's spaces minus those it keeps for the parking-short block
 * around it (traffic.ts, local parkers first). 0 spaces while park & ride garages stand means every one of them keeps
 * all its spaces for local parking — not "no garages by a stop" —, or (a garage with room the stats do not count yet:
 * placed since that assignment) park & ride starts with the next traffic update. A garage no assignment has seen yet
 * is counted at the next one. Garages by stops that are no park & ride (downtown stops, stops whose transit reaches no
 * jobs) say so, as their facility reports do.
 */
export function parkRideLine(tf: { parkRideSpaces: number } | null | undefined, g: GarageCounts): string {
  if (tf && tf.parkRideSpaces > 0) return `a day · ${compact(tf.parkRideSpaces)} spaces`;
  if (g.parkRide > 0) return g.kept >= g.parkRide ? 'all spaces kept for local parking' : 'starts with the next traffic update';
  if (g.pending > 0) return 'new garage: counted at the next traffic update';
  if (g.noTransit > 0) return 'transit from their stops reaches no jobs yet';
  if (g.downtown > 0) return 'garages by downtown stops: parking only';
  return 'no garages by a stop';
}

/**
 * The Statistics panel's commute-by-mode lines (final fixes F6) from stats.commuteByMode, read defensively (a city
 * without traffic, or an older save, lacks it; 0 = no trips of that mode): "Car 9.1 · Transit 14.2 · Walk 6.0 min",
 * and a short line on why transit can raise the city average (the "Avg. commute" card, all modes, stays): transit
 * riders accept longer trips than drivers — the minutes it saves them, or costs them, against driving the same trip
 * (transitSaved).
 */
export function commuteModes(m: Partial<CommuteByMode> | null | undefined): { times: string; note: string } {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  if (!m) return { times: '', note: '' };
  const car = num(m.car), transit = num(m.transit), walk = num(m.walk);
  const parts = [car ? `Car ${car.toFixed(1)}` : '', transit ? `Transit ${transit.toFixed(1)}` : '', walk ? `Walk ${walk.toFixed(1)}` : ''].filter(Boolean);
  if (!parts.length) return { times: '', note: '' };
  const saved = typeof m.transitSaved === 'number' && Number.isFinite(m.transitSaved) ? m.transitSaved : 0;
  let note = '';
  if (transit > 0) {
    const vsCar = saved >= 0.05 ? `it saves them ${saved.toFixed(1)} min against driving the same trip` : saved <= -0.05 ? `${(-saved).toFixed(1)} min more than driving the same trip` : 'about as long as driving the same trip';
    note = car > 0 && transit > car + 0.5
      ? `Transit riders accept longer trips than drivers — ${vsCar}.`
      : saved >= 0.05 ? `Transit saves its riders ${saved.toFixed(1)} min against driving the same trip.`
        : saved <= -0.05 ? `Transit riders accept trips ${(-saved).toFixed(1)} min longer than driving them.` : '';
  }
  return { times: `${parts.join(' · ')} min`, note };
}
