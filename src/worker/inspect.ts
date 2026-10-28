/** Inspector data gathering, shared by every host. Reports contain only cloneable values. */
import { DevType, Zone, zoneFamily } from '../core/types';
import { BF, type Building } from '../sim/CityState';
import { getDef } from '../sim/catalog';
import type { Simulation, SimSystem } from '../sim/Simulation';
import { desirabilityBreakdown } from '../sim/economy/desirability';
import { landValueBreakdown } from '../sim/economy/landValue';
import { growthLimits } from '../sim/economy/growth';
import { conditionBreakdown } from '../sim/economy/population';
import { cohortShares, needsExpectation, needsOf, tapWaterAt, waterRequired, type NeedReport } from '../sim/economy/demographics';
import { lotCell } from '../sim/economy/factors';
import type { EconRuntime } from '../sim/economy/runtime';
import { facilityLoad } from '../sim/infra/catchments';
import { facilityReport } from '../sim/infra/facilities';
import { roadCellReport } from '../sim/infra/transportFacilities';
import { EMG_FIRE, EMG_MEDICAL, EMG_POLICE, emergencyReachAt } from '../sim/infra/overlays';
import type { CrimeSystem } from '../sim/infra/crime';
import type { PollutionSystem } from '../sim/infra/pollution';
import type { TrafficSystem } from '../sim/infra/traffic';
import type { UtilitiesSystem } from '../sim/infra/utilities';
import { emptyZoneStatus, frontCellOf } from '../ui/zoneStatus';

export const INSPECT_SECTIONS = ['why', 'residents', 'facility', 'environment'] as const;
export type InspectSection = typeof INSPECT_SECTIONS[number];
export interface InspectBuildingArgs { id: number; sections: readonly InspectSection[] }
export interface InspectCellArgs { x: number; z: number; sections: readonly InspectSection[] }

function read<T>(f: () => T, fallback: T): T {
  try { return f() ?? fallback; }
  catch (e) { console.warn('[inspect] query failed', e); return fallback; }
}

function runtime(sim: Simulation): EconRuntime | null {
  return sim.getSystem<SimSystem & { rt?: EconRuntime }>('economy.population')?.rt ?? null;
}

/** downtownStage is non-enumerable in the sim's result; it must survive structuredClone. */
function limits(sim: Simulation, cell: number, dev: number) {
  const g = growthLimits(sim.state, cell, dev);
  return { ...g, downtownStage: g.downtownStage };
}

const NEED_TIERS: Record<string, string[]> = {
  elementary: ['elementary'], high: ['high'], college: ['college', 'library'], health: ['clinic', 'hospital'], play: ['play'], green: ['green'],
};

function providers(sim: Simulation, b: Building, needs: NeedReport[]) {
  const st = sim.state;
  return needs.map((n) => {
    let best = n.providerId === undefined ? undefined : st.buildings.get(n.providerId);
    if (n.providerId === undefined && NEED_TIERS[n.kind] && runtime(sim)) {
      let distance = Infinity;
      // Do not call rt.ensureLists(): an inspector must not rebuild the simulation's working lists.
      for (const f of st.buildings.values()) {
        if (!(f.flags & BF.Plopped) || f.flags & BF.Burnt || f.built < 1) continue;
        const cov = getDef(f.def)?.coverage;
        if (!cov?.tier || !NEED_TIERS[n.kind].includes(cov.tier)) continue;
        const d = Math.hypot(f.x + f.w / 2 - b.x - b.w / 2, f.z + f.d / 2 - b.z - b.d / 2);
        if (d <= cov.radius && d < distance) { best = f; distance = d; }
      }
    }
    if (!best) return null;
    const load = read(() => facilityLoad(sim, best!.id), null);
    return { def: best.def, name: getDef(best.def)?.name, utilization: load && load.capacity > 0 && Number.isFinite(load.capacity) ? load.utilization : null };
  });
}

function environment(sim: Simulation, ci: number, b: Building | null, covCell = ci) {
  const st = sim.state, util = sim.getSystem<UtilitiesSystem>('utilities');
  const x = ci % st.size, z = Math.floor(ci / st.size);
  return {
    noise: st.noise[ci], air: st.airPollution[ci], waterPollution: st.waterPollution[ci], soil: st.soil[ci], garbage: st.garbage[ci],
    garbageInfo: b ? read(() => sim.getSystem<PollutionSystem>('pollution')?.garbageInfo(b.id) ?? null, null) : null,
    tapWater: st.watered[ci] || (b && b.flags & BF.Watered) ? read(() => tapWaterAt(sim, st, ci), 1) : null,
    responses: [EMG_FIRE, EMG_POLICE, EMG_MEDICAL].map((v) => read(() => emergencyReachAt(st, ci, v), null)),
    coverage: {
      police: st.policeCov[covCell], fire: st.fireCov[covCell], health: st.healthCov[covCell], elementary: st.eduElemCov[covCell],
      high: st.eduHighCov[covCell], college: st.eduCollegeCov[covCell], play: st.playCov[covCell], green: st.greenCov[covCell],
      transit: st.transitCov[covCell], shops: st.shopAccess[covCell], parking: st.parking[covCell], front: covCell !== ci,
    },
    grid: read(() => util?.gridInfo(sim, x, z) ?? null, null), water: read(() => util?.waterInfo(sim, x, z) ?? null, null),
  };
}
export type InspectEnvironment = ReturnType<typeof environment>;

export function inspectBuilding(sim: Simulation, args: InspectBuildingArgs) {
  const st = sim.state, b = st.buildings.get(args.id);
  if (!b) return null;
  const def = getDef(b.def), dev = def?.devType, rt = runtime(sim), ci = lotCell(b, st.size);
  const growable = !def || def.category === 'growable', rubble = growable && !!(b.flags & BF.Burnt);
  const traffic = sim.getSystem<TrafficSystem>('traffic');
  const needs = dev !== undefined && dev <= DevType.R3 && b.pop > 0 ? read(() => needsOf(st, b), []) : [];
  return {
    building: { ...b },
    facility: !growable ? read(() => facilityReport(sim, b.id), null) : null,
    waterRequired: read(() => waterRequired(st, b), false), needsExpectation: read(() => needsExpectation(st), 1),
    condition: growable && !rubble ? read(() => conditionBreakdown(st, b), null) : null,
    desirability: growable && dev !== undefined ? read(() => desirabilityBreakdown(st, rt, dev, ci), null) : null,
    growth: growable && dev !== undefined ? read(() => limits(sim, ci, dev), null) : null,
    landValue: st.landValue[ci], desirabilityValue: dev === undefined ? null : st.desirability[dev]?.[ci] ?? null,
    commute: st.commute[ci], route: read(() => traffic?.routeInfo(b.id) ?? null, null),
    workerAccess: read(() => traffic?.workerAccess(b.id) ?? -1, -1), jobFill: read(() => traffic?.jobFill(b.id) ?? -1, -1),
    customers: read(() => traffic?.customers(b.id) ?? 0, 0), freightAccess: read(() => traffic?.freightAccess(b.id) ?? -1, -1),
    needs,
    providers: args.sections.includes('residents') ? providers(sim, b, needs) : [],
    cohorts: args.sections.includes('residents') ? Array.from(cohortShares(b, new Float32Array(5))) : [],
    landValueTerms: args.sections.includes('why') ? read(() => landValueBreakdown(st, rt, ci), []) : [],
    crime: args.sections.includes('why') ? read(() => sim.getSystem<CrimeSystem>('crime')?.termsOf(b.id) ?? null, null) : null,
    environment: args.sections.includes('environment') ? environment(sim, ci, b) : null,
  };
}
export type InspectBuilding = NonNullable<ReturnType<typeof inspectBuilding>>;

export function devsForZone(z: Zone): DevType[] {
  const f = zoneFamily(z);
  if (f === 'R') return [DevType.R1, DevType.R2, DevType.R3];
  if (f === 'C') return z === Zone.ComLow ? [DevType.CS1, DevType.CS2, DevType.CS3] : [DevType.CS1, DevType.CS2, DevType.CS3, DevType.CO2, DevType.CO3];
  if (f === 'I') return z === Zone.IndAg ? [DevType.IA] : [DevType.ID, DevType.IM, DevType.IHT];
  return [];
}

export function inspectCell(sim: Simulation, args: InspectCellArgs) {
  const st = sim.state, { x, z, sections } = args;
  if (!st.inBounds(x, z)) return null;
  const ci = st.idx(x, z), zone = st.zone[ci] as Zone, rt = runtime(sim);
  const devs = devsForZone(zone);
  let best = devs[0];
  for (const d of devs) if ((st.desirability[d]?.[ci] ?? -2) > (st.desirability[best]?.[ci] ?? -2)) best = d;
  const covCell = zone && zone !== Zone.Landfill ? read(() => frontCellOf(st, x, z), ci) : ci;
  return {
    x, z, landValue: st.landValue[ci], desirabilityValues: devs.map((d) => ({ dev: d, value: st.desirability[d]?.[ci] ?? 0 })), best,
    road: st.network[ci] ? read(() => roadCellReport(sim, ci), []) : [],
    noise: st.noise[ci], air: st.airPollution[ci],
    landfill: zone === Zone.Landfill ? read(() => sim.getSystem<PollutionSystem>('pollution')?.landfillInfo(x, z) ?? null, null) : null,
    landfillFill: st.landfillFill[ci], zoneStatus: read(() => emptyZoneStatus(st, x, z), null),
    desirability: sections.includes('why') && devs.length ? read(() => desirabilityBreakdown(st, rt, best, ci), null) : null,
    growth: sections.includes('why') && devs.length ? read(() => limits(sim, ci, best), null) : null,
    landValueTerms: sections.includes('why') && devs.length ? read(() => landValueBreakdown(st, rt, ci), []) : [],
    environment: sections.includes('environment') ? environment(sim, ci, null, covCell) : null,
  };
}
export type InspectCell = NonNullable<ReturnType<typeof inspectCell>>;

export function inspectSignature(sim: Simulation, args: InspectBuildingArgs | InspectCellArgs): string {
  const st = sim.state;
  if ('id' in args) {
    const b = st.buildings.get(args.id);
    return b ? `${b.pop}:${b.jobs}:${b.flags}:${Math.round(b.built * 20)}:${st.monthIndex}:${Math.floor(st.day / 5)}:${st.budget.ordinances.length}` : 'gone';
  }
  const { x, z } = args;
  if (!st.inBounds(x, z)) return 'outside';
  const i = st.idx(x, z), zs = read(() => emptyZoneStatus(st, x, z), null);
  return `${st.network[i]}:${st.zone[i]}:${st.building[i]}:${st.powered[i]}:${st.watered[i]}:${Math.floor(st.day / 5)}:${zs?.blockers.map((b) => b.text).join('|') ?? ''}`;
}
