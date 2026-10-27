/** Headless query handlers and their watch invalidation policies (WORKER_DESIGN §2.8). */
import type { CellRect } from '../core/events';
import type { NeedTier, CityState } from '../sim/CityState';
import type { Simulation } from '../sim/Simulation';
import { getDef } from '../sim/catalog';
import { opexTierOf } from '../sim/economy/opex';
import { advisorIssues, advisorIssuesReady, openAdvice, type OpenAdvice } from '../sim/economy/advisors';
import { computeMonthlyBudget } from '../sim/economy/budget';
import { capHints } from '../sim/economy/demand';
import { attractivenessBreakdown, tourismSummary } from '../sim/economy/tourism';
import { unservedClusters } from '../sim/infra/catchments';
import type { EmergencySystem } from '../sim/infra/emergency';
import type { TrafficSystem } from '../sim/infra/traffic';
import type { ServicesSystem } from '../sim/infra/services';
import { ferryPartnersFor, stopsNear } from '../sim/infra/transportFacilities';
import { demolishRisks, sideDemolishRisks, type Removal } from '../game/demolishRisk';
import { upkeepHere } from '../game/tools/placement';
import { countGarages } from '../ui/statsModel';
import { inspectBuilding, inspectCell, inspectSignature, type InspectBuildingArgs, type InspectCellArgs } from './inspect';
import { EXACT_FIELDS, PLAIN_KEYS, PRIMARY_LAYERS, SYSTEM_KEYS, type QueryName as WireQueryName, type WatchPolicy } from './protocol';

export type { WatchPolicy } from './protocol';
interface PlacementArgs { x: number; z: number; w: number; d: number }

/** The public advisor functions resolve pendingWhere / placed; explicitly copy only their data fields. */
function advice(rows: OpenAdvice[]): OpenAdvice[] {
  return rows.map(({ id, advisor, text, kind, priority, x, z }) => ({ id, advisor, text, kind, priority, x, z }));
}

/** W0.3b: keep the need raster on the sim side; only the existing marginal price crosses the query seam. */
function upkeepContext(sim: Simulation, { defId, x, z, w, d }: PlacementArgs & { defId: string }): { here: number | null } {
  const def = getDef(defId), tier = opexTierOf(def);
  const svc = sim.getSystem<ServicesSystem>('services');
  const need = tier && typeof svc?.needRaster === 'function' ? svc.needRaster(tier) : null;
  return { here: def ? upkeepHere(sim.state, def, x, z, w, d, need) : null };
}

export const QUERY_HANDLERS = {
  upkeepContext,
  inspectBuilding,
  inspectCell,
  dispatchOptions: (sim: Simulation, { incidentId }: { incidentId: number }) => sim.getSystem<EmergencySystem>('emergency')?.dispatchOptions(sim, incidentId) ?? [],
  routePreview: (sim: Simulation, { incidentId, stationId }: { incidentId: number; stationId: number }) => sim.getSystem<EmergencySystem>('emergency')?.routePreview(sim, incidentId, stationId) ?? null,
  emergencyReport: (sim: Simulation, { x, z }: { x: number; z: number }) => {
    const inc = sim.getSystem<EmergencySystem>('emergency')?.report(sim, x, z);
    return inc ? structuredClone(inc) : null;
  },
  demolishRisks: (sim: Simulation, { rect, cost, sandbox }: { rect: CellRect; cost: number; sandbox?: boolean }) => demolishRisks(sim.state, rect, cost, { sandbox }),
  sideDemolishRisks: (sim: Simulation, { ids, fee, sandbox, add }: { ids: readonly number[]; fee: number; sandbox?: boolean; add?: Removal['add'] }) => sideDemolishRisks(sim.state, ids, fee, { sandbox, add }),
  stopsNear: (sim: Simulation, { x, z, w, d }: PlacementArgs) => stopsNear(sim, x, z, w, d),
  ferryPartnersFor: (sim: Simulation, { x, z, w, d, rot }: PlacementArgs & { rot: number }) => ferryPartnersFor(sim, x, z, w, d, rot),
  openAdvice: (sim: Simulation, _args: Record<string, never>) => advice(openAdvice(sim)),
  advisorIssues: (sim: Simulation, _args: Record<string, never>) => advisorIssuesReady(sim.state)
    ? advice(Object.values(advisorIssues(sim.state)).flat().sort((a, b) => b.priority - a.priority)) : advice(openAdvice(sim)),
  capHints: (sim: Simulation, _args: Record<string, never>) => capHints(sim.state),
  tourismSummary: (sim: Simulation, _args: Record<string, never>) => tourismSummary(sim.state),
  attractivenessBreakdown: (sim: Simulation, _args: Record<string, never>) => attractivenessBreakdown(sim.state),
  unservedClusters: (sim: Simulation, { tier, max = 1 }: { tier: NeedTier; max?: number }) => unservedClusters(sim, tier, max),
  computeMonthlyBudget: (sim: Simulation, _args: Record<string, never>) => computeMonthlyBudget(sim.state, null),
  // Walking the state avoids the old StatsPanel rt.ensureLists() write into the economy runtime.
  garageStates: (sim: Simulation, _args: Record<string, never>) => countGarages(sim.state.buildings.values(), sim.getSystem<TrafficSystem>('traffic')),
  verify: (sim: Simulation, _args: Record<string, never>) => exactDigest(sim.state),
} satisfies Record<WireQueryName, (sim: Simulation, args: any) => unknown>;

export type QueryName = keyof typeof QUERY_HANDLERS;
export type QueryArgs<K extends QueryName> = Parameters<typeof QUERY_HANDLERS[K]>[1];
export type QueryResult<K extends QueryName> = ReturnType<typeof QUERY_HANDLERS[K]>;

export function runQuery<K extends QueryName>(sim: Simulation, name: K, args: QueryArgs<K>): QueryResult<K> {
  const handler = QUERY_HANDLERS[name] as (sim: Simulation, args: QueryArgs<K>) => QueryResult<K>;
  return handler(sim, args);
}

/** Keys are independent of object property insertion order, including nested rects and section lists. */
export function queryKey(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(queryKey).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + queryKey((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
}

export function watchSignature<K extends QueryName>(sim: Simulation, name: K, args: QueryArgs<K>, when: WatchPolicy, commands: number): string {
  if (name === 'inspectBuilding' || name === 'inspectCell') return inspectSignature(sim, args as InspectBuildingArgs | InspectCellArgs);
  const st = sim.state;
  // W0.3b: a dispatch/return can change availability while paused, before the next daily refresh.
  if (name === 'dispatchOptions') {
    const em = sim.getSystem<EmergencySystem>('emergency');
    const inc = em?.incident((args as QueryArgs<'dispatchOptions'>).incidentId);
    return `${st.day}:${commands}:${inc?.state}:${inc?.units.join(',')}:${queryKey(em?.stationList())}`;
  }
  if (name === 'computeMonthlyBudget') {
    const b = st.budget;
    return `${st.day}:${st.buildings.size}:${queryKey(b.taxRates)}:${queryKey(b.funding)}:${queryKey(b.ordinances)}:${queryKey(b.loans)}`;
  }
  return String(when === 'monthly' ? st.monthIndex : when === 'daily' ? st.day : `${st.day}:${commands}`);
}

/** Exact mirrored state only; this works on a replica too, without serializing or touching sim caches. */
export function exactDigest(st: CityState): number {
  let hash = 2166136261;
  const byte = (n: number) => { hash = Math.imul(hash ^ n, 16777619) >>> 0; };
  const str = (s: string) => { for (let i = 0; i < s.length; i++) { byte(s.charCodeAt(i) & 255); byte(s.charCodeAt(i) >>> 8); } byte(255); };
  const walk = (v: unknown): void => {
    if (ArrayBuffer.isView(v)) { str(v.constructor.name); for (const n of new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) byte(n); return; }
    if (v instanceof Set) { walk([...v].sort()); return; }
    if (Array.isArray(v)) { str('array'); for (const n of v) walk(n); str('end'); return; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v).sort()) { str(k); walk((v as Record<string, unknown>)[k]); } str('end'); return; }
    str(typeof v + ':' + String(v));
  };
  walk(st.config); walk(st.day);
  for (const k of PRIMARY_LAYERS) walk(st[k]);
  for (const b of [...st.buildings.values()].sort((a, b) => a.id - b.id)) { walk(b.id); for (const k of EXACT_FIELDS) walk(b[k]); }
  for (const k of PLAIN_KEYS) walk(st[k]);
  walk(st.unlocked); walk(st.announced); walk(st.history); walk(st.news);
  for (const k of SYSTEM_KEYS) walk(st.systemData[k]);
  return hash;
}
