/**
 * B2 G3 (docs/dev/B2_DESIGN.md §5, §6, §11): the crime and pollution passes in pieces — one go against many small steps,
 * and against the frozen pre-B2 systems (tests/sim/exact/crimeOriginal.ts, pollutionOriginal.ts = crime.ts / pollution.ts
 * at 41ae570).
 *  kernels   Blur3Run, downsampleRows and upsampleAddRows (blur.ts) in random row ranges = blur3, blurDown's downsample and
 *            upsampleAdd, with other blurs / upsamplings (other keys of the module tables) between the pieces
 *  passes    crime and pollution passes run in one go (scale 1e9), at the production piece size and in tiny / random
 *            pieces give identical cities and system fields at every pass end, across network, building, landfill, tree,
 *            park, terrain (water list) and funding edits; the same against the frozen originals (every original field);
 *            queries of other systems between every two pieces change nothing (R8); every external output changes in at
 *            most one piece per state visit (R7); a mid-pass save holds no pass state and loads idle (R9); the piece
 *            sequence does not depend on the host mode (O4); two cities stepped interleaved equal their solo runs; a
 *            terrain change in the middle of the water stage keeps the stage's list (review 1 R5); piece estimates stay
 *            within budget.
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { RNG } from '../../src/core/rng';
import { BF, type CityState } from '../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { CityActions } from '../../src/sim/actions';
import { createSystems } from '../../src/sim/systems/index';
import { infraSystems } from '../../src/sim/systems/infra';
import { buildingList, removeBuilding } from '../../src/sim/infra/common';
import { Blur3Run, blur3, blurDown, downsampleRows, upsampleAdd, upsampleAddRows } from '../../src/sim/infra/blur';
import { INFRA_PIECE_COLD_MS } from '../../src/sim/infra/params';
import { schedulerOf, withPieceScale } from '../../src/sim/infra/scheduler';
import type { PollutionSystem } from '../../src/sim/infra/pollution';
import type { CrimeSystem } from '../../src/sim/infra/crime';
import type { TrafficSystem } from '../../src/sim/infra/traffic';
import type { UtilitiesSystem } from '../../src/sim/infra/utilities';
import type { ServicesSystem } from '../../src/sim/infra/services';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { place } from './cityGen';
import { envCity } from './envCity';
import { PollutionSystemOriginal } from '../sim/exact/pollutionOriginal';
import { CrimeSystemOriginal } from '../sim/exact/crimeOriginal';
import { diffDigests, digest, fieldsDigest, stateDigest } from './b2Harness';

// ------------------------------------------------------------------------------------------------ helpers
type Piecewise = { step(sim: Simulation): void; compute(sim: Simulation, first: boolean): void; stepName: string; stepCost(sim: Simulation): number };
type Pol = PollutionSystem & Piecewise;
type Cri = CrimeSystem & Piecewise;
interface EnvCity { st: CityState; sim: Simulation; pol: Pol; cri: Cri }
/** a city's simulation: every system or infra only; pollution / crime may be the frozen pre-B2 classes */
function envSim(st: CityState, systems: 'infra' | 'all', orig = false): EnvCity {
  const list = (systems === 'infra' ? infraSystems() : createSystems()) as SimSystem[];
  if (orig) {
    list[list.findIndex((s) => s.name === 'pollution')] = new PollutionSystemOriginal() as unknown as SimSystem;
    list[list.findIndex((s) => s.name === 'crime')] = new CrimeSystemOriginal() as unknown as SimSystem;
  }
  const sim = new Simulation(st, list);
  return { st, sim, pol: sim.getSystem('pollution') as unknown as Pol, cri: sim.getSystem('crime') as unknown as Cri };
}

/** the edits between two passes: a road cut / restore (networkChanged), a building placed / bulldozed, landfill cells
 *  rezoned or built over (brownfield, the fill reset), trees (treesChanged), a park (the park signature), a water cell
 *  (terrainChanged: the water list), funding, a fire */
function envEdit(c: EnvCity, k: number): void {
  const { st, sim } = c, N = st.size;
  const rng = new RNG(0xe17 + k);
  switch (k % 5) {
    case 0: {
      const z = 4 + 3 * (k % 9);
      for (let x = 2; x < N - 3; x++) { const i = z * N + x; if (st.building[i] < 0 && !st.water[i]) st.network[i] = k % 10 === 0 ? Network.Road : 0; }
      sim.events.emit('networkChanged', { x0: 0, z0: z, x1: N - 1, z1: z });
      break;
    }
    case 1: {
      // landfill cells: two dezoned (brownfield), one built over (the fill reset)
      let n = 0;
      for (let i = 0; i < st.cells && n < 3; i++) {
        if (st.zone[i] !== Zone.Landfill || st.building[i] >= 0 || !(st.landfillFill[i] > 0.05)) continue;
        if (n < 2) st.zone[i] = 0;
        else sim.events.emit('buildingAdded', place(st, 't_r1', i % N, (i / N) | 0, { pop: 4 }));
        n++;
      }
      for (let t = 0; t < 40; t++) { const i = rng.int(0, st.cells - 1); if (st.building[i] < 0 && !st.water[i]) st.trees[i] = rng.int(0, 4); }
      sim.events.emit('treesChanged', undefined as never);
      break;
    }
    case 2: {
      const list = buildingList(st).filter((b) => !b.def.startsWith('util_'));
      if (list.length) removeBuilding(sim, list[(k * 13) % list.length]);
      for (let t = 0; t < 400; t++) {
        const x = rng.int(1, N - 4), z = rng.int(1, N - 4);
        let ok = true;
        for (let zz = z; zz < z + 2 && ok; zz++) for (let xx = x; xx < x + 2 && ok; xx++) { const i = zz * N + xx; if (st.building[i] >= 0 || st.network[i] !== 0 || st.water[i]) ok = false; }
        if (!ok) continue;
        sim.events.emit('buildingAdded', place(st, rng.pick(['park_small', 'park_playground', 't_r1']), x, z, { flags: BF.Powered | BF.Watered, pop: 6 }));
        break;
      }
      break;
    }
    case 3: {
      // a water cell (terrain) and a burning building
      for (let t = 0; t < 400; t++) {
        const i = rng.int(0, st.cells - 1);
        if (st.water[i] || st.building[i] >= 0 || st.network[i] !== 0) continue;
        st.water[i] = 1;
        sim.events.emit('terrainChanged', { x0: i % N, z0: (i / N) | 0, x1: i % N, z1: (i / N) | 0 } as never);
        break;
      }
      const list = buildingList(st);
      if (list.length) list[(k * 7) % list.length].flags ^= BF.OnFire;
      break;
    }
    default:
      new CityActions(sim).setFunding(k % 10 === 4 ? 'utilities' : 'police', 50 + (k % 4) * 15);
      for (const b of st.buildings.values()) if (b.pop > 0 && b.id % 9 === k % 9) b.pop = Math.max(0, b.pop - 3);
  }
}

/** fields whose content depends on where the pieces fall (the estimates, the clocks, the chunk plan, the op pool), and
 *  object references (the state digest covers the state) */
const EX = ['lastMs', 'simRef', 'unsub', 'snap', 'ops', 'ctx'];

/** the city digest with systemData per key */
function cityDigest(st: CityState): Record<string, string> {
  const out = stateDigest(st);
  for (const k of Object.keys(st.systemData)) out['sd.' + k] = digest((st.systemData as Record<string, unknown>)[k]);
  return out;
}

interface RunOpts { orig?: boolean; hook?: (c: EnvCity, k: number) => void; exclude?: string[]; drop?: string[]; initScale?: number }
/** the pollution then crime passes of a city at piece scale `scale` ('random': a random scale per pass); hook after
 *  every piece of those passes; the digests after init and at every pass end */
function runPasses(mk: () => CityState, systems: 'infra' | 'all', passes: number, scale: number | 'random', opts: RunOpts = {}): Record<string, string>[] {
  const rng = new RNG(0x9011c3);
  const pick = () => (scale === 'random' ? rng.pick([1e9, 1, 0.3, 0.05, 0.004]) : scale);
  const c = withPieceScale(opts.initScale ?? pick(), () => envSim(mk(), systems, opts.orig));
  const ex = [...EX, ...(opts.exclude ?? [])];
  const dig = () => {
    const d: Record<string, string> = { ...cityDigest(c.st) };
    for (const [k, v] of Object.entries(fieldsDigest(c.pol, ex))) d['pol.' + k] = v;
    for (const [k, v] of Object.entries(fieldsDigest(c.cri, ex))) d['cri.' + k] = v;
    for (const k of opts.drop ?? []) delete d[k];
    return d;
  };
  const out: Record<string, string>[] = [dig()];
  for (let p = 0; p < passes; p++) {
    envEdit(c, p);
    c.st.day += 12;
    withPieceScale(pick(), () => {
      let k = 0;
      for (const sys of [c.pol, c.cri]) {
        const s = sys as unknown as { stepIdx: number; firstPass: boolean };
        s.stepIdx = -1;
        s.firstPass = false;
        do { sys.step(c.sim); opts.hook?.(c, ++k); if (k > 5e6) throw new Error('pass did not end'); } while (s.stepIdx >= 0);
      }
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
describe('B2 G3 kernels: the resumable blur pieces equal their whole-call originals', () => {
  it('Blur3Run in random row chunks = blur3, other blurs between the chunks', () => {
    const rng = new RNG(0xb3c1);
    for (let c = 0; c < 40; c++) {
      const N = rng.pick([1, 2, 5, 17, 64, 128]), r = rng.pick([0, 1, 2, 3, 7]), C = N * N;
      const src = Float32Array.from({ length: C }, () => (rng.chance(0.3) ? 0 : rng.range(-3, 40)));
      const a = src.slice(), ta = new Float32Array(C);
      blur3(a, ta, N, r);
      const b = src.slice(), tb = new Float32Array(C), other = new Float32Array(C), ot = new Float32Array(C);
      const run = new Blur3Run();
      run.begin(b, tb, N, r);
      let guard = 0;
      while (!run.run(rng.pick([1, 3, 17, 300, 1e9]))) {
        other.set(src); blur3(other, ot, N, Math.max(1, r - 1));
        if (++guard > 1e6) throw new Error('blur run did not end');
      }
      expect(digest(b), `case ${c} a`).toBe(digest(a));
      expect(digest(tb), `case ${c} tmp`).toBe(digest(ta));
      expect(Blur3Run.rowsOf(N, r) === 0 || guard + 1 <= Blur3Run.rowsOf(N, r)).toBe(true);
    }
  });

  it('downsampleRows / upsampleAddRows in random row ranges = blurDown\'s downsample / upsampleAdd, other upsamplings between', () => {
    const rng = new RNG(0xb3c2);
    for (let c = 0; c < 40; c++) {
      const N = rng.pick([1, 3, 8, 33, 64, 96]), f = rng.pick([2, 4, 3]), C = N * N, M = Math.ceil(N / f);
      const src = Float32Array.from({ length: C }, () => (rng.chance(0.4) ? 0 : rng.range(-2, 9)));
      const ca = new Float32Array(M * M + 5), cta = new Float32Array(M * M + 5);
      blurDown(src, N, f, 0, ca, cta); // r = 0: the downsample only
      const cb = new Float32Array(M * M + 5).fill(7);
      cb.fill(0, 0, M * M);
      for (let z = 0; z < N;) { const z1 = Math.min(N, z + rng.int(1, 9)); downsampleRows(src, N, f, cb, z, z1); z = z1; }
      expect(digest(cb.subarray(0, M * M)), `case ${c} down`).toBe(digest(ca.subarray(0, M * M)));
      const gain = rng.range(0.1, 40), dx = rng.pick([0, 0.7, -2.25, 5]), dz = rng.pick([0, -0.4, 3.5]);
      const accA = Float32Array.from({ length: C }, () => rng.range(0, 1)), accB = accA.slice(), other = new Float32Array(9 * 9);
      upsampleAdd(ca, accA, N, f, gain, dx, dz);
      for (let z = 0; z < N;) {
        const z1 = Math.min(N, z + rng.int(1, 7));
        upsampleAddRows(ca, accB, N, f, gain, dx, dz, z, z1);
        upsampleAdd(new Float32Array(9), other, 9, 3, 1, 0.5, 0); // (another key of the module tables)
        z = z1;
      }
      expect(digest(accB), `case ${c} up`).toBe(digest(accA));
    }
  });
});

// ------------------------------------------------------------------------------------------------ passes
describe('B2 G3 crime + pollution: a pass in one go = in pieces = the frozen pre-B2 pass', () => {
  const cities: [string, () => CityState, 'infra' | 'all', number][] = [
    ['env city 48, infra only', () => envCity(48, 5), 'infra', 6],
    ['env city 64, every system', () => envCity(64, 9), 'all', 5],
    ['env city 96, infra only', () => envCity(96, 7), 'infra', 5],
  ];
  for (const [name, mk, systems, passes] of cities) {
    it(`${name}: one go = production pieces = tiny / random pieces, at every pass end across edits`, () => {
      const one = runPasses(mk, systems, passes, 1e9);
      expectSameRuns(one, runPasses(mk, systems, passes, 1), `${name} production`);
      expectSameRuns(one, runPasses(mk, systems, passes, name.includes(' 96') ? 0.01 : 1e-9), `${name} tiny`);
      expectSameRuns(one, runPasses(mk, systems, passes, 'random'), `${name} random`);
    }, 600_000);

    it(`${name}: production and random pieces = the frozen originals (41ae570), every original field`, () => {
      const orig = withPieceScale(1, () => envSim(mk(), systems, true));
      const w = withPieceScale(1, () => envSim(mk(), systems));
      const onlyW = (a: object, b: object) => Object.keys(a).filter((k) => !(k in b));
      const exW = [...onlyW(w.pol, orig.pol), ...onlyW(w.cri, orig.cri)];
      const exO = [...onlyW(orig.pol, w.pol), ...onlyW(orig.cri, w.cri)];
      expect(exO).toEqual([]);
      const ref = runPasses(mk, systems, passes, 1, { orig: true });
      expectSameRuns(ref, runPasses(mk, systems, passes, 1, { exclude: exW }), `${name} production vs original`);
      expectSameRuns(ref, runPasses(mk, systems, passes, 'random', { exclude: exW }), `${name} random vs original`);
    }, 600_000);
  }

  it('the edits reach every branch: brownfield / fill resets, a BFS rerun, a water-list rebuild, the tree and park programs', () => {
    const c = withPieceScale(1, () => envSim(envCity(96, 7), 'infra'));
    const seen = new Set<string>();
    const p = c.pol as unknown as { stepIdx: number; firstPass: boolean; bfCell: number[]; fzCell: number[]; nOps: number; venues?: number[] };
    const cr = c.cri as unknown as { stepIdx: number; venues: number[] };
    withPieceScale(1, () => {
      for (let pass = 0; pass < 6; pass++) {
        envEdit(c, pass);
        c.st.day += 12;
        p.stepIdx = -1;
        do {
          const n = c.pol.stepName;
          if (n === 'garbSrc.end') { if (p.bfCell.length) seen.add('brownfield'); if (p.fzCell.length) seen.add('fillReset'); }
          if (n.startsWith('garbRoute.bfs')) seen.add('bfs');
          if (n === 'water.list1') seen.add('waterList');
          if (/^srcCells\.trees\.(trees|boxH)/.test(n)) seen.add('trees');
          c.pol.step(c.sim);
        } while (p.stepIdx >= 0);
        cr.stepIdx = -1;
        do { if (c.cri.stepName === 'sources.spill' && cr.venues.length) seen.add('venues'); c.cri.step(c.sim); } while (cr.stepIdx >= 0);
      }
    });
    expect([...seen].sort()).toEqual(['bfs', 'brownfield', 'fillReset', 'trees', 'venues', 'waterList']);
  }, 300_000);

  it('R8: queries of other systems between every two pieces change nothing', () => {
    const mk = () => envCity(48, 13);
    // (emergency's probe refreshes its station list lazily and saves it in systemData.emergency: the query's own effect;
    // crime's termsOf writes its teens / terms scratch)
    const drop = ['systemData', 'sd.emergency', 'cri.teens', 'cri.scratchTerms'];
    const base = runPasses(mk, 'all', 4, 0.05, { drop });
    const rng = new RNG(0x9e7b);
    const withQueries = runPasses(mk, 'all', 4, 0.05, {
      drop,
      hook: (c, k) => {
        const { sim, st } = c, N = st.size;
        const tr = sim.getSystem('traffic') as unknown as TrafficSystem, f = tr as unknown as { attachDirty: boolean };
        tr.findPath(sim, rng.int(0, st.cells - 1), rng.int(0, st.cells - 1));
        if (k % 5 === 0) { f.attachDirty = true; tr.stopAttached(rng.int(0, st.nextBuildingId)); tr.freightRailCells(); }
        const pol = c.pol;
        for (const b of buildingList(st)) if (b.id % 23 === k % 23) { pol.garbageInfo(b.id); pol.emissionOf(b.id); pol.incineratorShare(b.id); c.cri.termsOf(b.id); }
        pol.landfillInfo(rng.int(0, N - 1), rng.int(0, N - 1));
        pol.garbageSummary(); pol.roadlessGarbage();
        const ut = sim.getSystem('utilities') as unknown as UtilitiesSystem;
        ut.waterQualityAt(sim, rng.int(0, st.cells - 1));
        ut.gridInfo(sim, rng.int(0, N - 1), rng.int(0, N - 1));
        const svc = sim.getSystem('services') as unknown as ServicesSystem | undefined;
        svc?.needRaster('police');
        const em = emergencyOf(sim);
        if (em && k % 3 === 0) em.probe(sim, rng.pick(['fire', 'police', 'medical'] as const), rng.int(0, N - 1), rng.int(0, N - 1));
        // (the blur module's scratch and tables: another city's blurs between the pieces)
        const o = new Float32Array(64 * 64), ot = new Float32Array(64 * 64);
        blur3(o, ot, 64, 2);
        upsampleAdd(new Float32Array(32 * 32), o, 64, 2, 1, 0.25, -0.5);
      },
    });
    expectSameRuns(base, withQueries, 'queries between pieces');
  }, 600_000);

  it('R7: every external output changes in at most one piece per state visit (production pieces)', () => {
    const c = withPieceScale(1, () => envSim(envCity(64, 17), 'infra'));
    const { st } = c;
    const flags = () => { let h = 0; for (const b of st.buildings.values()) h = (Math.imul(h, 31) + (b.flags & (BF.Crime | BF.NoGarbage | BF.Polluted | BF.Noisy)) + b.id) | 0; return h; };
    const incs = () => buildingList(st).filter((b) => b.def === 'util_incinerator').map((b) => c.pol.incineratorShare(b.id));
    const outputs = (): Record<string, string> => ({
      garbage: digest(st.garbage), landfillFill: digest(st.landfillFill), soil: digest(st.soil), treeCover: digest(st.treeCover),
      air: digest(st.airPollution), noise: digest(st.noise), water: digest(st.waterPollution), crime: digest(st.crime),
      stats: digest([st.stats.garbageProduced, st.stats.garbageCapacity, st.stats.garbageRecycled, st.stats.landfillFill, st.stats.sewageTreated,
        st.stats.avgPollution, st.stats.avgNoise, st.stats.avgAir, st.stats.avgWaterPollution, st.stats.avgCrime]),
      flags: String(flags()), inc: digest(incs()), summary: digest({ ...c.pol.garbageSummary() }), roadless: digest(c.pol.roadlessGarbage()),
      landfill: digest(Array.from({ length: 12 }, (_, k) => c.pol.landfillInfo(4 + (k % 8), st.size - 12 + (k >> 1)))),
    });
    for (let p = 0; p < 5; p++) {
      envEdit(c, p);
      st.day += 12;
      (c.pol as unknown as { treesDirty: boolean }).treesDirty = true;
      let prev = outputs();
      const changes = new Map<string, number>();
      let pieces = 0;
      withPieceScale(1, () => {
        for (const sys of [c.pol, c.cri]) {
          const s = sys as unknown as { stepIdx: number; firstPass: boolean };
          s.stepIdx = -1;
          s.firstPass = false;
          // (a piece's changes belong to the state it ran in)
          let visit = 0, state = 0;
          do {
            sys.step(c.sim);
            pieces++;
            const now = outputs();
            for (const k of Object.keys(now)) {
              if (now[k] === prev[k]) continue;
              const key = `${sys.name}:${k}@${visit}:${state}`;
              changes.set(key, (changes.get(key) ?? 0) + 1);
            }
            prev = now;
            if (s.stepIdx !== state) { visit++; state = s.stepIdx; }
          } while (s.stepIdx >= 0);
        }
      });
      expect(pieces, `pass ${p}`).toBeGreaterThan(60);
      for (const [k, n] of changes) expect(n, `pass ${p}: ${k} changed in ${n} pieces`).toBeLessThanOrEqual(1);
    }
  }, 300_000);

  it('R9: a save taken mid-pass holds no pass state; it loads idle and loads the same twice', () => {
    const c = withPieceScale(1, () => envSim(envCity(48, 19), 'infra'));
    const keysOf = (x: SerializedCity) => ({ top: Object.keys(x).sort(), sd: Object.keys((x.data.systemData ?? {}) as object).sort() });
    const between = keysOf(serializeCity(c.st, { copy: true }));
    for (const sys of [c.pol, c.cri]) {
      const s = sys as unknown as { stepIdx: number };
      s.stepIdx = -1;
      let saved = null as SerializedCity | null, at = '';
      withPieceScale(0.02, () => {
        let k = 0;
        do { sys.step(c.sim); if (++k === 90 && s.stepIdx >= 0) { saved = structuredClone(serializeCity(c.st, { copy: true })); at = sys.stepName; } } while (s.stepIdx >= 0);
      });
      expect(saved, `${sys.name}: mid-pass save taken`).not.toBeNull();
      expect(at).not.toMatch(/start$/);
      expect(keysOf(saved!)).toEqual(between);
      const load = () => {
        const c2 = envSim(deserializeCity(structuredClone(saved!)), 'infra');
        for (const x of [c2.pol, c2.cri]) {
          const f = x as unknown as Record<string, unknown>;
          expect(f.stepIdx).toBe(-1);
          for (const k of ['sub', 'cur']) expect(f[k], k).toBe(0);
          expect((f.snap as { n: number }).n).toBe(0);
        }
        for (let d = 0; d < 30; d++) { c2.sim.advanceDay(); schedulerOf(c2.sim).flush(c2.sim); }
        return { ...cityDigest(c2.st), ...fieldsDigest(c2.pol, EX), ...fieldsDigest(c2.cri, EX) };
      };
      expect(diffDigests(load(), load())).toEqual([]);
    }
  }, 300_000);

  it('O4: the piece sequence and the results do not depend on the host mode (frames active or headless)', () => {
    const run = (live: boolean) => {
      const c = envSim(envCity(48, 23), 'infra');
      const sch = schedulerOf(c.sim) as unknown as { lastFrameMs: number; framesActive: boolean };
      sch.lastFrameMs = live ? 1e15 : -1e15;
      expect(sch.framesActive).toBe(live);
      const names: string[] = [], out: Record<string, string>[] = [];
      for (let p = 0; p < 3; p++) {
        envEdit(c, p);
        c.st.day += 12;
        for (const sys of [c.pol, c.cri]) {
          const s = sys as unknown as { stepIdx: number };
          s.stepIdx = -1;
          do { names.push(sys.stepName); sys.step(c.sim); } while (s.stepIdx >= 0);
        }
        out.push({ ...cityDigest(c.st), ...fieldsDigest(c.pol, EX), ...fieldsDigest(c.cri, EX) });
      }
      return { names, out };
    };
    const headless = run(false), live = run(true);
    expect(live.names.length).toBeGreaterThan(100);
    expect(live.names).toEqual(headless.names);
    expectSameRuns(headless.out, live.out, 'frames active');
  }, 300_000);

  it('two cities stepped interleaved, piece by piece, equal their solo runs (no module scratch shared across cities)', () => {
    const mkA = () => envCity(48, 31), mkB = () => envCity(40, 37);
    const soloA = runPasses(mkA, 'infra', 3, 0.05, { initScale: 0.05 }), soloB = runPasses(mkB, 'infra', 3, 0.05, { initScale: 0.05 });
    withPieceScale(0.05, () => {
      // (both states first: the city generator clears the shared DefInfo cache, which would change which DefInfo objects
      // a system's per-id cache shares — the digest sees object identity — not any value)
      const stA = mkA(), stB = mkB();
      const A = envSim(stA, 'infra'), B = envSim(stB, 'infra');
      const dig = (c: EnvCity) => {
        const d: Record<string, string> = { ...cityDigest(c.st) };
        for (const [k, v] of Object.entries(fieldsDigest(c.pol, EX))) d['pol.' + k] = v;
        for (const [k, v] of Object.entries(fieldsDigest(c.cri, EX))) d['cri.' + k] = v;
        return d;
      };
      const a = [dig(A)], b = [dig(B)];
      for (let p = 0; p < 3; p++) {
        envEdit(A, p); envEdit(B, p);
        A.st.day += 12; B.st.day += 12;
        for (const name of ['pol', 'cri'] as const) {
          const sa = A[name] as unknown as { stepIdx: number; firstPass: boolean }, sb = B[name] as unknown as { stepIdx: number; firstPass: boolean };
          sa.stepIdx = sb.stepIdx = -1;
          sa.firstPass = sb.firstPass = false;
          let first = true;
          while (first || sa.stepIdx >= 0 || sb.stepIdx >= 0) {
            if (first || sa.stepIdx >= 0) A[name].step(A.sim);
            if (first || sb.stepIdx >= 0) B[name].step(B.sim);
            first = false;
          }
        }
        a.push(dig(A));
        b.push(dig(B));
      }
      expectSameRuns(soloA, a, 'city A interleaved');
      expectSameRuns(soloB, b, 'city B interleaved');
    });
  }, 300_000);

  it('review 1 R5: a terrain change in the middle of the water stage keeps the stage\'s list; the next pass rebuilds it', () => {
    const c = withPieceScale(0.02, () => envSim(envCity(48, 29), 'infra'));
    const p = c.pol as unknown as { stepIdx: number; firstPass: boolean; nWater: number; waterCells: Int32Array; sub: number };
    const st = c.st, N = st.size;
    p.stepIdx = -1;
    let hit = false;
    withPieceScale(0.02, () => {
      do {
        c.pol.step(c.sim);
        if (!hit && p.stepIdx === 8 && p.sub === 2) {
          // (in the diffusion: a new water cell and terrainChanged)
          for (let i = 0; i < st.cells; i++) if (!st.water[i] && st.building[i] < 0 && st.network[i] === 0) { st.water[i] = 1; c.sim.events.emit('terrainChanged', { x0: i % N, z0: (i / N) | 0, x1: i % N, z1: (i / N) | 0 } as never); break; }
          hit = true;
        }
      } while (p.stepIdx >= 0);
    });
    expect(hit).toBe(true);
    expect(p.nWater).toBe(-1);
    const before = p.waterCells.length;
    c.pol.compute(c.sim, false);
    expect(p.nWater).toBe(before + 1);
    for (let i = 0; i < st.cells; i++) if (!Number.isFinite(st.waterPollution[i])) throw new Error(`NaN water at ${i}`);
  }, 120_000);

  it('every piece estimate stays within its budget at the production size (env city 128)', () => {
    const c = envSim(envCity(128, 41), 'infra');
    const max = new Map<string, number>();
    for (let p = 0; p < 3; p++) {
      envEdit(c, p);
      c.st.day += 12;
      (c.pol as unknown as { treesDirty: boolean }).treesDirty = true;
      for (const sys of [c.pol, c.cri]) {
        const s = sys as unknown as { stepIdx: number };
        s.stepIdx = -1;
        do {
          const name = sys.name + ':' + sys.stepName.replace(/#\d+$/, ''), e = sys.stepCost(c.sim);
          if (e > (max.get(name) ?? 0)) max.set(name, e);
          sys.step(c.sim);
        } while (s.stepIdx >= 0);
      }
    }
    // (half INFRA_PIECE_COLD_MS for every piece, the snapshot take (one buildingList + copy) and traffic's attachment
    // refresh — edit-only, R2 — excepted)
    for (const [name, e] of max) {
      const cap = /attach|snap$/.test(name) ? 1 : INFRA_PIECE_COLD_MS * 0.75;
      expect(e, `${name} estimate`).toBeLessThanOrEqual(cap);
    }
    expect(max.size).toBeGreaterThan(30);
  }, 300_000);
});
