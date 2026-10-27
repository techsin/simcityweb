/** Founding predicates read only the host's mirrored state. */
import { zoneFamily, type Zone } from '../../core/types';
import { BF, type Building, type CityState } from '../../sim/CityState';
import { getDef } from '../../sim/catalog';
import { infraFlags } from '../../sim/economy/runtime';
import { isGrowZone } from '../../sim/economy/tuning';
import { lotAccess, utilityReaches } from '../zoneStatus';
import type { FoundingId } from './progress';
import type { WindStart, ZoneTargets } from './copy';

export const WIND_START: WindStart = { turbines: 3, residentsPerMW: 300, residentRounding: 500 };

/** Half-size tiles need half the lots; scarce buildable land can lower that further. */
export function zoneTargets(st: CityState): ZoneTargets {
  let dry = 0;
  for (let i = 0; i < st.cells; i++) if (!st.water[i]) dry++;
  const scale = Math.min(st.size <= 64 ? 0.5 : 1, dry / 1024);
  return { R: Math.max(4, Math.ceil(40 * scale)), C: Math.max(2, Math.ceil(8 * scale)), I: Math.max(2, Math.ceil(12 * scale)) };
}

export function accessibleZones(st: CityState): ZoneTargets & { roadless: number } {
  const counts = { R: 0, C: 0, I: 0, roadless: 0 };
  for (let i = 0; i < st.cells; i++) {
    if (!isGrowZone(st.zone[i]) || st.water[i]) continue;
    const family = zoneFamily(st.zone[i] as Zone);
    if (family !== 'R' && family !== 'C' && family !== 'I') continue;
    const access = lotAccess(st, i % st.size, Math.floor(i / st.size));
    if (access === 'front' || access === 'yard') counts[family]++;
    else if (access === 'none') counts.roadless++;
  }
  return counts;
}

export function hasCategory(st: CityState, category: string): boolean {
  for (const b of st.buildings.values()) {
    const def = getDef(b.def);
    if (def?.category === category && !/pylon/.test(def.id) && !(b.flags & BF.Burnt)) return true;
  }
  return false;
}

export function isFuelPlant(b: Building): boolean {
  const def = getDef(b.def);
  return !!def && (def.powerOut ?? 0) > 0 && (def.pollution?.air ?? 0) > 0 && !(b.flags & BF.Burnt);
}

export function fuelPlant(st: CityState): Building | undefined {
  return [...st.buildings.values()].find(isFuelPlant);
}

export function zoneServed(st: CityState, kind: 'power' | 'water'): boolean {
  if (!infraFlags(st).utilities) return hasCategory(st, kind);
  const flags = kind === 'power' ? st.powered : st.watered;
  for (let i = 0; i < st.cells; i++) if (isGrowZone(st.zone[i]) && utilityReaches(st, flags, i, kind)) return true;
  return false;
}

export function foundingDone(st: CityState, startDay: number, targets: ZoneTargets): Record<FoundingId, boolean> {
  const zones = accessibleZones(st);
  return { road: st.neighborConnections.length > 0, zones: zones.R >= targets.R && zones.C >= targets.C && zones.I >= targets.I,
    power: zoneServed(st, 'power'), water: zoneServed(st, 'water'), play: st.day > startDay };
}
