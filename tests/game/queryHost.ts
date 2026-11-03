/** Immediate query seam for existing presentation fixtures. Real cadence is covered by worker/queries.test. */
import type { Simulation } from '../../src/sim/Simulation';
import type { EmergencySystem } from '../../src/sim/infra/emergency';
import type { SimHost, WatchHandle } from '../../src/worker/SimHost';
import { queryKey, runQuery, watchSignature, type QueryArgs, type QueryName, type QueryResult, type WatchPolicy } from '../../src/worker/queries';

export function queryHost(sim: Simulation): Pick<SimHost, 'query' | 'watch' | 'emergency' | 'events' | 'commandCount'> {
  return {
    events: sim.events,
    commandCount: 0,
    query: (name, args) => Promise.resolve(structuredClone(runQuery(sim, name, args))),
    watch<K extends QueryName>(name: K, args: QueryArgs<K>, when: WatchPolicy): WatchHandle<QueryResult<K>, QueryArgs<K>> {
      let key = '', value: QueryResult<K> | undefined, disposed = false;
      const w = {
        version: 0, error: undefined,
        get value() {
          if (disposed) return undefined;
          const next = queryKey(args) + ':' + watchSignature(sim, name, args, when, 0);
          if (key !== next) { value = structuredClone(runQuery(sim, name, args)); key = next; w.version++; }
          return value;
        },
        setArgs(a: QueryArgs<K>) { args = a; },
        subscribe() { return () => {}; },
        dispose() { disposed = true; value = undefined; },
      };
      return w;
    },
    emergency: {
      get active() { return sim.getSystem<EmergencySystem>('emergency')?.active ?? false; },
      get layersReady() { return sim.getSystem<EmergencySystem>('emergency')?.layersReady ?? false; },
      incident: (id) => sim.getSystem<EmergencySystem>('emergency')?.incident(id),
      stationList: () => sim.getSystem<EmergencySystem>('emergency')?.stationList() ?? [],
      incidents: () => sim.getSystem<EmergencySystem>('emergency')?.incidents() ?? [],
      vehicles: () => sim.getSystem<EmergencySystem>('emergency')?.vehicles() ?? [],
      stationFleet: (id) => sim.getSystem<EmergencySystem>('emergency')?.stationFleet(id) ?? null,
      stationName: (id) => sim.getSystem<EmergencySystem>('emergency')?.stationName(id) ?? 'Station',
    },
  };
}
