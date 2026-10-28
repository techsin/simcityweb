/**
 * B2 G2 (docs/dev/B2_DESIGN.md §4, §11): the services pass and the NIMBY rebuild in pieces — one go against many small
 * steps, and against the frozen pre-B2 ServicesSystem (tests/sim/exact/servicesOriginal.ts = services.ts at 41ae570).
 *  kernels   the resumable runs against their whole-call originals: RoadTimeRun / RoadDistRun (catchments), the transit
 *            coverage by stop ranges, NimbyRun (nimby.ts; also against the frozen pre-J4 rebuild), the police need run
 *            (facilities.ts), with other searches / scans between the pieces
 *  services  passes run in one go (scale 1e9), at the production piece size and in tiny / random pieces give identical
 *            cities and services fields at every pass end, across network, building, funding and corridor edits, with
 *            and without WP1 (the EQ / HQ fallback); the same against the frozen original (every original field); queries
 *            of other systems between every two pieces change nothing (R8); every external output changes at most once per
 *            state visit (R7); a mid-pass save holds no pass state and loads idle (R9); the piece sequence does not depend
 *            on the host mode (O4); two cities stepped interleaved equal their solo runs; piece estimates stay within budget.
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { RNG } from '../../src/core/rng';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { CityActions } from '../../src/sim/actions';
import { createSystems } from '../../src/sim/systems/index';
import { infraSystems } from '../../src/sim/systems/infra';
import { buildingList, removeBuilding } from '../../src/sim/infra/common';
import {
  RoadDistRun, RoadTimeRun, TIME_Q, reachRaw, roadDistMulti, roadTimeMulti, tierProvider, unservedClusters,
} from '../../src/sim/infra/catchments';
import { NimbyRun, nimbyCost, rebuildNimby } from '../../src/sim/infra/nimby';
import { justiceSites, pluggedList, facilityReport } from '../../src/sim/infra/facilities';
import { computeTransitCoverage, transitCoverageRange, collectStops } from '../../src/sim/infra/transit';
import { INFRA_PIECE_COLD_MS, INFRA_PIECE_MS, NET_TIME, RAMP_PENALTY } from '../../src/sim/infra/params';
import { schedulerOf, withPieceScale } from '../../src/sim/infra/scheduler';
import type { ServicesSystem } from '../../src/sim/infra/services';
import type { TrafficSystem } from '../../src/sim/infra/traffic';
import type { UtilitiesSystem } from '../../src/sim/infra/utilities';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { newState, place, roadLine } from './cityGen';
import { servicesCity } from '../wasm/servicesCity';
import { ServicesSystemOriginal } from '../sim/exact/servicesOriginal';
import { rebuildNimbyOriginal } from '../sim/exact/nimbyOriginal';
import { diffDigests, digest, fieldsDigest, stateDigest } from './b2Harness';

// ------------------------------------------------------------------------------------------------ helpers
function randomRoads(rng: RNG, N: number, density = 0.55): CityState {
  const st = newState(N);
  const types = [Network.Street, Network.Road, Network.Avenue, Network.OneWay, Network.Highway];
  for (let i = 0; i < st.cells; i++) {
    const r = rng.next();
    if (r < density) st.network[i] = rng.pick(types);
    else if (r < density + 0.05) st.network[i] = Network.Rail;
  }
  return st;
}

/** a services city with every NIMBY source kind: servicesCity's facilities, river, rail and highways, plus landfill
 *  zones (partly full), a coal plant, road-flag bus stops and a crime raster (the police need) */
function svcCity(size: number, seed: number, perDef = 3): CityState {
  const st = servicesCity(size, seed, perDef).st;
  const N = st.size, rng = new RNG(seed * 31 + 7);
  for (let z = N - 7; z < N - 2; z++) for (let x = 2; x < 9; x++) {
    const i = z * N + x;
    if (st.network[i] !== 0 || st.building[i] >= 0 || st.water[i]) continue;
    st.zone[i] = Zone.Landfill;
    st.landfillFill[i] = rng.chance(0.5) ? rng.range(0, 1) : 0;
  }
  for (let i = 0; i < st.cells; i++) {
    st.crime[i] = rng.chance(0.3) ? rng.range(0, 0.8) : 0;
    if (st.network[i] >= 1 && st.network[i] <= 4 && i % 53 === 0) st.netFlags[i] |= 16;
  }
  for (let t = 0; t < 200; t++) {
    const x = rng.int(2, N - 6), z = rng.int(2, N - 6);
    let ok = true;
    for (let zz = z; zz < z + 4 && ok; zz++) for (let xx = x; xx < x + 4 && ok; xx++) if (st.network[zz * N + xx] !== 0 || st.building[zz * N + xx] >= 0 || st.water[zz * N + xx]) ok = false;
    if (!ok) continue;
    place(st, 'util_coal_plant', x, z, { flags: BF.Powered });
    break;
  }
  return st;
}

type Svc = ServicesSystem & Record<string, unknown> & { compute(sim: Simulation, first: boolean): void; stepName: string; stepCost(sim: Simulation): number };
interface SvcCity { st: CityState; sim: Simulation; svc: Svc }
/** a city's simulation: infra systems only (no WP1: the services EQ / HQ fallback runs) or every system; services may be
 *  the frozen pre-B2 class */
function svcSim(st: CityState, systems: 'infra' | 'all', orig = false): SvcCity {
  const list = (systems === 'infra' ? infraSystems() : createSystems()) as SimSystem[];
  if (orig) list[list.findIndex((s) => s.name === 'services')] = new ServicesSystemOriginal() as unknown as SimSystem;
  const sim = new Simulation(st, list);
  return { st, sim, svc: sim.getSystem('services') as unknown as Svc };
}

/** the edits between two passes: a road cut / restore (networkChanged), a facility placed / bulldozed, a funding change,
 *  a highway cell (the NIMBY corridor), home populations */
function svcEdit(c: SvcCity, k: number): void {
  const { st, sim } = c, N = st.size;
  const rng = new RNG(0xed17 + k);
  switch (k % 4) {
    case 0: {
      const z = 4 + 3 * (k % 9);
      for (let x = 2; x < N - 3; x++) { const i = z * N + x; if (st.building[i] < 0 && !st.water[i]) st.network[i] = k % 8 === 0 ? Network.Road : 0; }
      sim.events.emit('networkChanged', { x0: 0, z0: z, x1: N - 1, z1: z });
      break;
    }
    case 1: {
      for (let t = 0; t < 400; t++) {
        const x = rng.int(1, N - 2), z = rng.int(1, N - 2), i = z * N + x;
        if (st.building[i] >= 0 || st.network[i] !== 0 || st.water[i]) continue;
        sim.events.emit('buildingAdded', place(st, rng.pick(['civ_elementary_school', 'civ_clinic', 'park_small', 'civ_police_kiosk']), x, z, { flags: BF.Powered | BF.Watered }));
        break;
      }
      for (const b of st.buildings.values()) if (b.pop > 0 && b.id % 7 === k % 7) b.pop = Math.max(0, b.pop - 5);
      break;
    }
    case 2: {
      const fac = buildingList(st).filter((b) => /^(civ_|park_)/.test(b.def));
      if (fac.length) removeBuilding(sim, fac[(k * 13) % fac.length]);
      break;
    }
    default: {
      new CityActions(sim).setFunding(k % 8 === 3 ? 'education' : 'health', 40 + (k % 5) * 10);
      const i = Math.floor(N / 3) * N + 1 + (k % (N - 2));
      if (st.building[i] < 0) { st.network[i] = Network.Highway; sim.events.emit('networkChanged', { x0: i % N, z0: (i / N) | 0, x1: i % N, z1: (i / N) | 0 }); }
    }
  }
}

/** services fields whose content depends on where the pieces fall (the estimates, the clocks, the snapshot's chunk plan),
 *  and the state reference (the state digest covers the state) */
const SV_EXCLUDE = ['lastMs', 'lastPassMs', 'workLeft', 'snap', 'lastState'];
/**
 * the tier engine's per-facility scratch of the current slot: JS arrays emptied per slot in the original, typed arrays
 * grown once in W (every entry is written before it is read within a slot; after a pass they hold the last slot's
 * scratch). Compared between W runs, not against the original's representation.
 */
const SV_SCRATCH = ['facStart', 'facEnd', 'facSig', 'facSeat'];

/** the city digest with systemData per key */
function cityDigest(st: CityState): Record<string, string> {
  const out = stateDigest(st);
  for (const k of Object.keys(st.systemData)) out['sd.' + k] = digest((st.systemData as Record<string, unknown>)[k]);
  return out;
}
/** query-owned caches (clustersOf computes on demand: queries between pieces change them by design) */
const SV_QUERY = ['clusters', 'clusterPass'];

/** the services passes of a city at piece scale `scale` ('random': a random scale per pass); hook after every piece of
 *  those passes; the digests after init and at every pass end */
function runPasses(mk: () => CityState, systems: 'infra' | 'all', passes: number, scale: number | 'random', opts: { orig?: boolean; hook?: (c: SvcCity, k: number) => void; exclude?: string[]; drop?: string[]; initScale?: number } = {}): Record<string, string>[] {
  const rng = new RNG(0x5e7f1ce5);
  const pick = () => (scale === 'random' ? rng.pick([1e9, 1, 0.3, 0.05, 0.004]) : scale);
  const c = withPieceScale(opts.initScale ?? pick(), () => svcSim(mk(), systems, opts.orig));
  const ex = [...SV_EXCLUDE, ...(opts.exclude ?? [])];
  const dig = () => { const d = { ...cityDigest(c.st), ...fieldsDigest(c.svc, ex) }; for (const k of opts.drop ?? []) delete d[k]; return d; };
  const out: Record<string, string>[] = [dig()];
  const s = c.svc as unknown as { stepIdx: number; firstPass: boolean };
  for (let p = 0; p < passes; p++) {
    svcEdit(c, p);
    c.st.day += 3;
    withPieceScale(pick(), () => {
      s.stepIdx = -1;
      s.firstPass = false;
      let k = 0;
      do { c.svc.step(c.sim); opts.hook?.(c, ++k); if (k > 5e6) throw new Error('pass did not end'); } while (s.stepIdx >= 0);
    });
    out.push(dig());
  }
  return out;
}

function expectSameRuns(a: Record<string, string>[], b: Record<string, string>[], label: string): void {
  expect(b.length).toBe(a.length);
  for (let p = 0; p < a.length; p++) expect(diffDigests(a[p], b[p]), `${label}: ${p === 0 ? 'init' : `pass ${p}`}`).toEqual([]);
}

// ------------------------------------------------------------------------------------------------ kernels
describe('B2 G2 kernels: the resumable runs equal their whole-call originals', () => {
  it('RoadTimeRun in random chunks (seed scan and drain) = roadTimeMulti, other searches between the chunks', () => {
    const rng = new RNG(0xb2c1);
    const NTQ = NET_TIME.map((t, k) => (k >= 1 && k <= 5 ? Math.max(1, Math.round(t / TIME_Q)) : 0));
    const RQ = Math.round(RAMP_PENALTY / TIME_Q);
    for (let c = 0; c < 50; c++) {
      const N = rng.pick([1, 3, 9, 24, 48]);
      const st = randomRoads(rng, N, rng.range(0.2, 0.9));
      const seeds = Int32Array.from({ length: st.cells }, () => (rng.chance(0.08) ? rng.int(0, 3000) : -1));
      const limit = rng.pick([1, 50, 2000, 26000]);
      const a = seeds.slice(), b = seeds.slice(), other = new Int32Array(st.cells);
      const nA = roadTimeMulti(st, a, limit, NTQ, RQ);
      const run = new RoadTimeRun();
      run.begin(st, b, limit, NTQ, RQ);
      while (!run.seed(rng.pick([1, 5, 300, 1e9]))) { other.set(seeds); roadTimeMulti(st, other, 100, NTQ, RQ); }
      while (!run.run(rng.pick([1, 2, 7, 100, 1e9]))) {
        other.set(seeds); roadTimeMulti(st, other, 300, NTQ, RQ);
        reachRaw(st, rng.int(0, N - 1), rng.int(0, N - 1), 1, 1, 5, rng.int(0, 2));
      }
      expect(digest(b), `case ${c}`).toBe(digest(a));
      expect(run.settled, `case ${c} settled`).toBe(nA);
      expect(run.run(3)).toBe(true);
    }
  });

  it('RoadDistRun in random chunks = roadDistMulti, other searches between the chunks', () => {
    const rng = new RNG(0xb2c2);
    for (let c = 0; c < 50; c++) {
      const N = rng.pick([1, 4, 12, 30, 48]);
      const st = randomRoads(rng, N, rng.range(0.3, 0.9));
      const nS = rng.int(0, 40);
      const seeds = Int32Array.from({ length: nS + 3 }, () => rng.int(0, st.cells - 1));
      const metric = rng.int(0, 1), maxQ = rng.pick([0, 8, 160, 4000]);
      const a = new Int32Array(st.cells), b = new Int32Array(st.cells).fill(7), other = new Int32Array(st.cells);
      const nA = roadDistMulti(st, metric, seeds, nS, maxQ, a);
      const run = new RoadDistRun();
      run.start(st, metric, seeds, nS, maxQ, b);
      while (!run.run(rng.pick([1, 3, 50, 1e9]))) {
        roadDistMulti(st, 1 - metric, seeds, Math.min(3, nS), 40, other);
        reachRaw(st, rng.int(0, N - 1), rng.int(0, N - 1), 1, 1, 4, rng.int(0, 2));
      }
      expect(digest(b), `case ${c}`).toBe(digest(a));
      expect(run.settled, `case ${c} settled`).toBe(nA);
    }
  });

  it('transitCoverageRange in random stop ranges = computeTransitCoverage', () => {
    const rng = new RNG(0xb2c3);
    for (let c = 0; c < 8; c++) {
      const st = svcCity(48, 3 + c, 2);
      const stops = collectStops(st);
      const fund = rng.range(0, 1.25);
      const active = (s: number) => (s * 7 + c) % 5 !== 0;
      const a = new Float32Array(st.cells), b = new Float32Array(st.cells).fill(0.5);
      computeTransitCoverage(st, stops, a, fund, true, active);
      b.fill(0);
      for (let s = 0; s < stops.n;) { const s1 = Math.min(stops.n, s + rng.int(1, 9)); transitCoverageRange(st, stops, b, fund, true, active, s, s1); s = s1; }
      expect(stops.n).toBeGreaterThan(3);
      expect(digest(b), `case ${c}`).toBe(digest(a));
    }
  });

  it('NimbyRun in random pieces = rebuildNimby = the frozen pre-J4 rebuild; its cost estimate too', () => {
    const rng = new RNG(0xb2c4);
    const L = ['stigma', 'prestige', 'campus'] as const;
    for (let c = 0; c < 10; c++) {
      const st = svcCity(rng.pick([24, 40, 64]), 11 + c, 2);
      // a few highway / rail / tunnel / bridge cells (the corridor raster) and unpowered plants
      for (let i = 0; i < st.cells; i++) if (rng.chance(0.01)) { st.network[i] = rng.pick([Network.Highway, Network.Rail]); st.netFlags[i] = rng.int(0, 3); }
      const sim = new Simulation(st, []);
      rebuildNimbyOriginal(sim);
      const ref = L.map((k) => st[k].slice());
      rebuildNimby(sim);
      L.forEach((k, j) => expect(digest(st[k]), `case ${c} whole ${k}`).toBe(digest(ref[j])));
      const cost = nimbyCost(sim);
      for (const k of L) st[k].fill(NaN);
      const run = new NimbyRun();
      run.begin(sim, buildingList(st));
      let guard = 0;
      while (!run.step(rng.pick([0, 0.01, 1, 20, 300, 1e9]))) {
        // (another city's rebuild between the pieces: per-run scratch)
        if (guard % 7 === 0) rebuildNimby(new Simulation(svcCity(24, 99, 1), []));
        if (++guard > 1e6) throw new Error('nimby run did not end');
      }
      L.forEach((k, j) => expect(digest(st[k]), `case ${c} pieces ${k}`).toBe(digest(ref[j])));
      expect(nimbyCost(sim), `case ${c} cost`).toBe(cost);
      expect(run.active).toBe(false);
    }
  });

  it('the police need run in random pieces = policeNeed, and leaves the same per-state lists', () => {
    const rng = new RNG(0xb2c5);
    const prov = tierProvider('police')!;
    expect(typeof prov.needRun).toBe('function');
    for (let c = 0; c < 8; c++) {
      const size = rng.pick([32, 48]);
      const a = svcCity(size, 21 + c, 2), b = svcCity(size, 21 + c, 2);
      for (const st of [a, b]) for (let i = 0; i < st.cells; i++) st.crime[i] = (i * 2654435761 % 97) / 97;
      // (a stale list on one case in two: a building placed after the last scan, without an event)
      if (c % 2) for (const st of [a, b]) place(st, 't_cs', 0, 0, { jobs: 30 });
      const res = Float32Array.from({ length: a.cells }, (_, i) => (i % 3 ? (i % 11) * 1.5 : 0));
      const outA = new Float32Array(a.cells), outB = new Float32Array(b.cells);
      prov.needOf!(a, res, outA);
      const run = prov.needRun!(b, res, outB, buildingList(b), b.nextBuildingId);
      let guard = 0;
      while (!run.step(rng.pick([0, 0.05, 2, 50, 1e9]))) { if (++guard > 1e7) throw new Error('police need run did not end'); }
      expect(digest(outB), `case ${c} raster`).toBe(digest(outA));
      expect(justiceSites(b).map((x) => x.id), `case ${c} justice list`).toEqual(justiceSites(a).map((x) => x.id));
      expect(pluggedList(b).map((x) => x.id), `case ${c} plopped list`).toEqual(pluggedList(a).map((x) => x.id));
      // the job-site list (second call: reads the cached list)
      const a2 = new Float32Array(a.cells), b2 = new Float32Array(b.cells);
      prov.needOf!(a, res, a2);
      prov.needOf!(b, res, b2);
      expect(digest(b2), `case ${c} second call`).toBe(digest(a2));
    }
  });
});

// ------------------------------------------------------------------------------------------------ services
describe('B2 G2 services: a pass in one go = in pieces = the frozen pre-B2 pass', () => {
  const cities: [string, () => CityState, 'infra' | 'all', number][] = [
    ['services city 48, infra only (EQ / HQ fallback)', () => svcCity(48, 5), 'infra', 6],
    ['services city 64, every system (WP1)', () => svcCity(64, 9), 'all', 5],
    ['services city 96, infra only', () => svcCity(96, 7), 'infra', 4],
  ];
  for (const [name, mk, systems, passes] of cities) {
    it(`${name}: one go = production pieces = tiny / random pieces, at every pass end across edits`, () => {
      const one = runPasses(mk, systems, passes, 1e9);
      expectSameRuns(one, runPasses(mk, systems, passes, 1), `${name} production`);
      expectSameRuns(one, runPasses(mk, systems, passes, name.includes(' 96') ? 0.01 : 1e-9), `${name} tiny`);
      expectSameRuns(one, runPasses(mk, systems, passes, 'random'), `${name} random`);
    }, 600_000);

    it(`${name}: production and random pieces = the frozen original (41ae570), every original field`, () => {
      // (the original's own field names: W's new piece fields have no counterpart; the estimates / clocks differ by design)
      const orig = withPieceScale(1, () => svcSim(mk(), systems, true));
      const keys = Object.keys(orig.svc).filter((k) => !SV_EXCLUDE.includes(k) && !SV_SCRATCH.includes(k));
      const w = withPieceScale(1, () => svcSim(mk(), systems));
      const onlyW = Object.keys(w.svc).filter((k) => !keys.includes(k));
      expect(SV_SCRATCH.every((k) => k in orig.svc && k in w.svc)).toBe(true);
      const ref = runPasses(mk, systems, passes, 1, { orig: true, exclude: Object.keys(orig.svc).filter((k) => !keys.includes(k)) });
      expectSameRuns(ref, runPasses(mk, systems, passes, 1, { exclude: onlyW }), `${name} production vs original`);
      expectSameRuns(ref, runPasses(mk, systems, passes, 'random', { exclude: onlyW }), `${name} random vs original`);
    }, 600_000);
  }

  it('R8: queries of other systems between every two pieces change nothing (traffic, services, utilities, facilities, emergency)', () => {
    const mk = () => svcCity(48, 13);
    // (emergency's probe refreshes its station list lazily and saves it in systemData.emergency: the query's own effect)
    const drop = ['systemData', 'sd.emergency'];
    const base = runPasses(mk, 'infra', 4, 0.05, { exclude: SV_QUERY, drop });
    const rng = new RNG(0x9e7a);
    const withQueries = runPasses(mk, 'infra', 4, 0.05, {
      exclude: SV_QUERY,
      drop,
      hook: (c, k) => {
        const { sim, st } = c, N = st.size;
        const tr = sim.getSystem('traffic') as unknown as TrafficSystem, f = tr as unknown as { attachDirty: boolean };
        tr.findPath(sim, rng.int(0, st.cells - 1), rng.int(0, st.cells - 1));
        tr.stopsNear(st, rng.int(0, N - 3), rng.int(0, N - 3), 2, 2);
        if (k % 5 === 0) { f.attachDirty = true; tr.stopAttached(rng.int(0, st.nextBuildingId)); tr.freightRailCells(); }
        for (const b of buildingList(st)) if (b.id % 29 === k % 29) { tr.routeInfo(b.id); facilityReport(sim, b.id); }
        const svc = c.svc;
        for (const t of ['police', 'elementary', 'health', 'green'] as const) { svc.needRaster(t); unservedClusters(sim, t, 3); }
        const ut = sim.getSystem('utilities') as unknown as UtilitiesSystem;
        ut.waterQualityAt(sim, rng.int(0, st.cells - 1));
        ut.gridInfo(sim, rng.int(0, N - 1), rng.int(0, N - 1));
        const em = emergencyOf(sim);
        if (em && k % 3 === 0) em.probe(sim, rng.pick(['fire', 'police', 'medical'] as const), rng.int(0, N - 1), rng.int(0, N - 1));
        reachRaw(st, rng.int(0, N - 2), rng.int(0, N - 2), 1, 1, 8, rng.int(0, 2));
      },
    });
    expectSameRuns(base, withQueries, 'queries between pieces');
  }, 600_000);

  it('R7: every external output changes in at most one piece per state visit (production pieces); transitCov in three states', () => {
    const c = withPieceScale(1, () => svcSim(svcCity(64, 17), 'infra'));
    const { st } = c;
    const tiers = ['police', 'fire', 'elementary', 'high', 'college', 'health', 'play', 'green'] as const;
    const outputs = (): Record<string, string> => ({
      need: digest(tiers.map((t) => c.svc.needRaster(t))),
      policeCov: digest(st.policeCov), fireCov: digest(st.fireCov), eduElemCov: digest(st.eduElemCov), eduHighCov: digest(st.eduHighCov),
      eduCollegeCov: digest(st.eduCollegeCov), healthCov: digest(st.healthCov), playCov: digest(st.playCov), greenCov: digest(st.greenCov),
      eduCov: digest(st.eduCov), parkCov: digest(st.parkCov), transitCov: digest(st.transitCov),
      access: digest(st.accessCommute), shop: digest(st.shopAccess), nimby: digest([st.stigma, st.prestige, st.campus]),
      stats: digest([st.stats.needs, st.stats.eq, st.stats.hq]), police: String([c.svc.policeMul, c.svc.policeFx]),
    });
    const s = c.svc as unknown as { stepIdx: number; firstPass: boolean; accessDirty: boolean; nimbyDirty: boolean };
    for (let p = 0; p < 4; p++) {
      svcEdit(c, p);
      st.day += 3;
      s.accessDirty = true; s.nimbyDirty = true;
      let prev = outputs();
      const changes = new Map<string, number>();
      // (a piece's changes belong to the state it ran in; the pass starts in prep)
      let visit = 0, state = 0, pieces = 0, transit = 0;
      s.stepIdx = -1;
      s.firstPass = false;
      withPieceScale(1, () => {
        do {
          c.svc.step(c.sim);
          pieces++;
          const now = outputs();
          for (const k of Object.keys(now)) {
            if (now[k] === prev[k]) continue;
            changes.set(`${k}@${visit}:${state}`, (changes.get(`${k}@${visit}:${state}`) ?? 0) + 1);
            if (k === 'transitCov') transit++;
          }
          prev = now;
          if (s.stepIdx !== state) { visit++; state = s.stepIdx; }
        } while (s.stepIdx >= 0);
      });
      expect(pieces, `pass ${p}`).toBeGreaterThan(60);
      for (const [k, n] of changes) expect(n, `pass ${p}: ${k} changed in ${n} pieces`).toBeLessThanOrEqual(1);
      expect(transit, `pass ${p}: transitCov changes`).toBeLessThanOrEqual(3);
    }
  }, 300_000);

  it('R9: a save taken mid-pass holds no pass state; it loads idle and loads the same twice', () => {
    const c = withPieceScale(1, () => svcSim(svcCity(48, 19), 'infra'));
    const keysOf = (x: SerializedCity) => ({ top: Object.keys(x).sort(), sd: Object.keys((x.data.systemData ?? {}) as object).sort() });
    const between = keysOf(serializeCity(c.st, { copy: true }));
    const s = c.svc as unknown as { stepIdx: number; firstPass: boolean };
    s.stepIdx = -1;
    let saved = null as SerializedCity | null, at = '';
    withPieceScale(0.02, () => {
      let k = 0;
      do { c.svc.step(c.sim); if (++k === 120 && s.stepIdx >= 0) { saved = structuredClone(serializeCity(c.st, { copy: true })); at = c.svc.stepName; } } while (s.stepIdx >= 0);
    });
    expect(saved, 'mid-pass save taken').not.toBeNull();
    expect(at).not.toMatch(/^prep\.corridor$/);
    expect(keysOf(saved!)).toEqual(between);
    const load = () => {
      const c2 = svcSim(deserializeCity(structuredClone(saved!)), 'infra');
      const f = c2.svc as unknown as Record<string, unknown>;
      expect(f.stepIdx).toBe(-1);
      for (const k of ['sub', 'cur', 'cur2', 'provPh', 'finCur', 'nCs']) expect(f[k], k).toBe(0);
      expect((f.snap as { n: number }).n).toBe(0);
      expect((f.nimbyRun as { active: boolean }).active).toBe(false);
      for (let d = 0; d < 20; d++) { c2.sim.advanceDay(); schedulerOf(c2.sim).flush(c2.sim); }
      return { ...cityDigest(c2.st), ...fieldsDigest(c2.svc, SV_EXCLUDE) };
    };
    expect(diffDigests(load(), load())).toEqual([]);
  }, 300_000);

  it('O4: the piece sequence and the results do not depend on the host mode (frames active or headless)', () => {
    const run = (live: boolean) => {
      const c = svcSim(svcCity(48, 23), 'infra');
      const sch = schedulerOf(c.sim) as unknown as { lastFrameMs: number; framesActive: boolean };
      sch.lastFrameMs = live ? 1e15 : -1e15;
      expect(sch.framesActive).toBe(live);
      const s = c.svc as unknown as { stepIdx: number; firstPass: boolean };
      const names: string[] = [], out: Record<string, string>[] = [];
      for (let p = 0; p < 3; p++) {
        svcEdit(c, p);
        c.st.day += 3;
        s.stepIdx = -1;
        do { names.push(c.svc.stepName); c.svc.step(c.sim); } while (s.stepIdx >= 0);
        out.push({ ...cityDigest(c.st), ...fieldsDigest(c.svc, SV_EXCLUDE) });
      }
      return { names, out };
    };
    const headless = run(false), live = run(true);
    expect(live.names.length).toBeGreaterThan(100);
    expect(live.names).toEqual(headless.names);
    expectSameRuns(headless.out, live.out, 'frames active');
  }, 300_000);

  it('two cities stepped interleaved, piece by piece, equal their solo runs (no module scratch shared across cities)', () => {
    const mkA = () => svcCity(48, 31), mkB = () => svcCity(40, 37);
    const soloA = runPasses(mkA, 'infra', 3, 0.05, { initScale: 0.05 }), soloB = runPasses(mkB, 'infra', 3, 0.05, { initScale: 0.05 });
    withPieceScale(0.05, () => {
      const A = svcSim(mkA(), 'infra'), B = svcSim(mkB(), 'infra');
      const a = [{ ...cityDigest(A.st), ...fieldsDigest(A.svc, SV_EXCLUDE) }], b = [{ ...cityDigest(B.st), ...fieldsDigest(B.svc, SV_EXCLUDE) }];
      const sa = A.svc as unknown as { stepIdx: number; firstPass: boolean }, sb = B.svc as unknown as { stepIdx: number; firstPass: boolean };
      for (let p = 0; p < 3; p++) {
        svcEdit(A, p); svcEdit(B, p);
        A.st.day += 3; B.st.day += 3;
        sa.stepIdx = sb.stepIdx = -1;
        sa.firstPass = sb.firstPass = false;
        let first = true;
        while (first || sa.stepIdx >= 0 || sb.stepIdx >= 0) {
          if (first || sa.stepIdx >= 0) A.svc.step(A.sim);
          if (first || sb.stepIdx >= 0) B.svc.step(B.sim);
          first = false;
        }
        a.push({ ...cityDigest(A.st), ...fieldsDigest(A.svc, SV_EXCLUDE) });
        b.push({ ...cityDigest(B.st), ...fieldsDigest(B.svc, SV_EXCLUDE) });
      }
      expectSameRuns(soloA, a, 'city A interleaved');
      expectSameRuns(soloB, b, 'city B interleaved');
    });
  }, 300_000);

  it('every piece estimate stays within its budget at the production size (services city 128, a fresh and a cached pass)', () => {
    const c = svcSim(svcCity(128, 41, 6), 'infra');
    const max = new Map<string, number>();
    const s = c.svc as unknown as { stepIdx: number; firstPass: boolean; accessDirty: boolean; nimbyDirty: boolean; invalidateReach(r?: unknown): void };
    for (let p = 0; p < 3; p++) {
      if (p === 1) svcEdit(c, 0);
      if (p === 0) s.invalidateReach(undefined);
      c.st.day += 3;
      s.accessDirty = true; s.nimbyDirty = true;
      s.stepIdx = -1;
      do {
        const name = c.svc.stepName.replace(/#\d+$/, ''), e = c.svc.stepCost(c.sim);
        if (e > (max.get(name) ?? 0)) max.set(name, e);
        c.svc.step(c.sim);
      } while (s.stepIdx >= 0);
    }
    // (budgets: INFRA_PIECE_MS for the tier steps, half INFRA_PIECE_COLD_MS for every other loop; the edit-only attachment
    // refresh of traffic is the one exception, R2)
    for (const [name, e] of max) {
      const cap = /attach/.test(name) ? 1 : name.startsWith('tiers') ? INFRA_PIECE_MS * 1.5 : INFRA_PIECE_COLD_MS * 1.5;
      expect(e, `${name} estimate`).toBeLessThanOrEqual(cap);
    }
    expect(max.size).toBeGreaterThan(40);
  }, 300_000);
});

// keep the type imports used (documentation of what the hooks call)
export type { Building };
