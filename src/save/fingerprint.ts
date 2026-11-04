import { BF, type CityState } from '../sim/CityState';

/**
 * Cheap summary of what a save would change: sim time, money, buildings, budget / policies, name, unlocks. Together
 * with the host's change-event counter it tells "unsaved changes" apart (camera moves don't count).
 */
export function cityFingerprint(st: CityState): string {
  const b = st.budget;
  const budget = b ? JSON.stringify([b.taxRates, b.funding, b.ordinances, b.loans?.length ?? 0]) : '';
  // player-set "historic" marks (toggling one emits only buildingChanged, which derived recomputes emit too)
  let hist = 0;
  for (const x of st.buildings.values()) if (x.flags & BF.Historic) hist = (hist + Math.imul(x.id, 2654435761)) | 0;
  return `${st.day}|${Math.round(st.funds * 100)}|${st.buildings.size}|${st.nextBuildingId}|${st.config.name}|${st.unlocked?.size ?? 0}|${hist}|${budget}`;
}

/**
 * sim events that change saved state without necessarily moving the fingerprint (paused edits: tools, dispatches,
 * disasters, unlocks). Not counted: derived recomputes (layerUpdated, and buildingChanged, which traffic / utilities /
 * pollution passes emit for flag updates after an edit — counting those would flag a just-saved city as unsaved).
 */
export const CHANGE_EVENTS = [
  'networkChanged', 'zoneChanged', 'terrainChanged', 'powerLinesChanged', 'subwayChanged', 'treesChanged',
  'buildingAdded', 'buildingRemoved', 'disaster', 'emergency', 'unlocked',
] as const;
