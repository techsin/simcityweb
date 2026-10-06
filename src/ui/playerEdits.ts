/**
 * Counts the player's own map edits — zoning, roads / rail, power lines, subway, plopped buildings placed or removed —
 * from the simulation's events. City growth (grown buildings, lot grading, trees) never counts, so a panel refreshes an
 * expensive view after the player changed something, not every day the city grows (AdvisorsPanel's fresh scans).
 * Headless (no DOM).
 */
import { BF, type Building } from '../sim/CityState';
import type { Simulation } from '../sim/Simulation';

export interface EditCounter {
  /** edits so far (compare with the value of the last look) */
  readonly count: number;
  dispose(): void;
}

export function playerEditCounter(sim: Simulation): EditCounter {
  let n = 0;
  const bump = () => { n++; };
  const plopped = (b: Building) => { if (b.flags & BF.Plopped) n++; };
  const ev = sim.events;
  const offs = [
    ev.on('zoneChanged', bump), ev.on('networkChanged', bump), ev.on('powerLinesChanged', bump), ev.on('subwayChanged', bump),
    ev.on('buildingAdded', plopped), ev.on('buildingRemoved', plopped),
  ];
  return {
    get count() { return n; },
    dispose() { for (const off of offs) off(); },
  };
}
