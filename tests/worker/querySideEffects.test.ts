/** §5.3 / R16: reading every report must leave a deterministic 120-day city bit-identical. */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { serializeCity } from '../../src/save/serialize';
import { BF, NEED_TIERS, type CityState } from '../../src/sim/CityState';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { INSPECT_SECTIONS } from '../../src/worker/inspect';
import { LocalSimHost } from '../../src/worker/SimHost';
import { QUERY_HANDLERS, type QueryArgs, type QueryName } from '../../src/worker/queries';
import { newState, place, roadLine } from '../infra/cityGen';

afterEach(() => vi.restoreAllMocks());

function town() {
  const st = newState(64);
  st.config.seed = 7;
  st.funds = 1e7;
  roadLine(st, 0, 20, 63, 20, Network.Road);
  roadLine(st, 0, 36, 63, 36, Network.Road);
  roadLine(st, 30, 20, 30, 50, Network.Road);
  roadLine(st, 0, 50, 63, 50, Network.Road);
  const sample = [
    place(st, 't_r1', 6, 21, { pop: 12 }), place(st, 't_r2', 9, 21, { pop: 60 }),
    place(st, 't_r3', 12, 21, { pop: 300 }), place(st, 't_cs', 17, 21, { jobs: 20 }),
    place(st, 't_co', 20, 21, { jobs: 250 }), place(st, 't_id', 25, 21, { jobs: 40 }),
  ];
  for (const b of sample) st.zone[st.idx(b.x, b.z)] = b.pop ? Zone.ResHigh : Zone.ComHigh;
  const flags = BF.Plopped | BF.Powered | BF.Watered;
  for (const [def, x, z] of [
    ['t_coal', 2, 18], ['t_pump', 6, 19], ['t_treat', 8, 18], ['t_fire', 12, 19], ['t_police', 16, 19],
    ['t_clinic', 20, 19], ['civ_elementary_school', 3, 37], ['civ_library', 9, 37], ['civ_clinic', 15, 37],
    ['t_park', 24, 37], ['t_incin', 26, 37], ['tr_parking_garage', 33, 37], ['tr_bus_stop', 37, 37],
    ['tr_bus_stop', 24, 19], ['tr_ferry_terminal', 5, 51], ['tr_ferry_terminal', 40, 51],
  ] as const) sample.push(place(st, def, x, z, { flags }));
  for (let z = 53; z < 64; z++) for (let x = 0; x < 64; x++) { st.heights[st.idx(x, z)] = 0; st.water[st.idx(x, z)] = 3; }
  st.zone[st.idx(55, 21)] = Zone.Landfill;
  st.zone[st.idx(56, 21)] = Zone.ResLow;
  st.zone[st.idx(57, 21)] = Zone.ComLow;
  st.zone[st.idx(58, 21)] = Zone.IndMed;
  return { st, sample, clinic: sample.find((b) => b.def === 't_clinic')! };
}

function canonical(v: unknown): unknown {
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}

function hash(st: CityState): string {
  const saved = serializeCity(st, { copy: true });
  saved.savedAt = 0;
  return createHash('sha256').update(JSON.stringify(canonical(saved))).digest('hex');
}

async function run(reads: boolean) {
  const { st, sample, clinic } = town();
  let now = 0;
  const errors: unknown[] = [], host = new LocalSimHost(st, { now: () => now, errors: { report: (...args) => errors.push(args) } });
  await host.start();
  const em = emergencyOf(host.sim)!;
  const counts = new Map<QueryName, number>(), hashes: string[] = [], rng: number[] = [];
  let routeDays = 0, incident = -1;
  const read = async <K extends QueryName>(name: K, args: QueryArgs<K>) => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    const result = await host.query(name, args);
    // Exercise the watch delivery of the same handler too; production consumers use a subset of these policies.
    const w = host.watch(name, args, 'daily');
    expect(w.error, name).toBeUndefined();
    expect(w.value, name).toEqual(result);
    w.dispose();
    return result;
  };
  try {
    for (let day = 0; day < 120; day++) {
      host.sim.runDays(1);
      now += 1000;
      // The same mutations in both arms, including an incident with a real route (not only empty report cases).
      if (day % 20 === 0) incident = em.spawn(host.sim, 'medical', 9, 21, { buildingId: sample[1].id, major: true });
      if (day % 30 === 0) host.act('plantTrees', [{ x0: 2 + day / 30, z0: 3, x1: 3 + day / 30, z1: 4 }]);
      if (reads) {
        const before = hash(st), beforeRng = host.sim.rng.state;
        const current = new Map(sample.map((b) => st.buildingAt(b.x, b.z)).filter((b) => !!b).map((b) => [b.id, b]));
        for (const b of current.values()) {
          await read('inspectBuilding', { id: b.id, sections: [] });
          for (const section of INSPECT_SECTIONS) await read('inspectBuilding', { id: b.id, sections: [section] });
          await read('inspectBuilding', { id: b.id, sections: INSPECT_SECTIONS });
        }
        await read('inspectBuilding', { id: -1, sections: INSPECT_SECTIONS });
        for (const [x, z] of [[2, 2], [9, 20], [55, 21], [56, 21], [57, 21], [58, 21], [10, 60]]) {
          for (const section of INSPECT_SECTIONS) await read('inspectCell', { x, z, sections: [section] });
          await read('inspectCell', { x, z, sections: INSPECT_SECTIONS });
        }
        await read('dispatchOptions', { incidentId: incident });
        if (await read('routePreview', { incidentId: incident, stationId: clinic.id })) routeDays++;
        await read('emergencyReport', { x: 9, z: 21 });
        await read('demolishRisks', { rect: { x0: 2, z0: 18, x1: 15, z1: 23 }, cost: 500 });
        await read('sideDemolishRisks', { ids: sample.slice(0, 6).map((b) => b.id), fee: 300, add: { cells: [{ x: 9, z: 21 }], pipes: true } });
        await read('stopsNear', { x: 33, z: 37, w: 2, d: 2 });
        await read('ferryPartnersFor', { x: 5, z: 51, w: 2, d: 2, rot: 0 });
        await read('openAdvice', {});
        await read('advisorIssues', {});
        await read('capHints', {});
        await read('tourismSummary', {});
        await read('attractivenessBreakdown', {});
        for (const tier of NEED_TIERS) await read('unservedClusters', { tier });
        await read('computeMonthlyBudget', {});
        await read('garageStates', {});
        await read('verify', {});
        expect(hash(st), `queries changed state on day ${day + 1}`).toBe(before);
        expect(host.sim.rng.state).toBe(beforeRng);
      }
      hashes.push(hash(st));
      rng.push(host.sim.rng.state);
    }
    expect(errors).toEqual([]);
    if (reads) {
      expect([...counts.keys()].sort()).toEqual(Object.keys(QUERY_HANDLERS).sort());
      expect([...counts.values()].every((n) => n >= 120)).toBe(true);
      expect(routeDays).toBeGreaterThan(0);
    }
    return { hashes, rng };
  } finally { await host.dispose(); }
}

describe('query side effects', () => {
  it('120 deterministic days with every query/watch handler, sampled buildings/cells and every section equal 120 days with no reads', { timeout: 120000 }, async () => {
    const warnings = vi.spyOn(console, 'warn');
    const without = await run(false);
    const withReads = await run(true);
    expect(withReads.hashes).toEqual(without.hashes);
    expect(withReads.rng).toEqual(without.rng);
    expect(warnings).not.toHaveBeenCalled();
  });
});
