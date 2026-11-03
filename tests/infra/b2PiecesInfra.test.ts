/**
 * B2 G4 (docs/dev/B2_DESIGN.md §7, §8, §11): the utilities pass and the emergency response sequence in pieces — one go
 * against many small steps, and against the frozen pre-B2 systems (tests/sim/exact/utilitiesOriginal.ts,
 * emergencyOriginal.ts = utilities.ts / emergency.ts at 41ae570).
 *  utilities  passes run in one go (scale 1e9), at the production piece size and in tiny / random pieces give identical
 *             cities and system fields at every pass end, across network, building (growables: the label patch; a bridge:
 *             the relabel of a soft pass; plopped), power-line, zone, funding and occupancy edits, on cities with no short
 *             grid, a short island grid and short main grids (both brownouts); the same against the frozen original (every
 *             original field), also with a road edit at the start of the water step (pre-B2's mid-pass water relabel);
 *             queries of other systems between every two pieces change nothing (R8); every external output changes in at
 *             most one piece per state visit (R7); a mid-pass save holds no pass state and loads idle (R9); the piece
 *             sequence does not depend on the host mode (O4); two cities stepped interleaved equal their solo runs; piece
 *             estimates stay within budget.
 *  emergency  response sequences likewise (graph changes: the epoch restart; station changes; traffic updates: the
 *             siren times), against the frozen original's layers and slacks.
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
import { INFRA_PIECE_COLD_MS } from '../../src/sim/infra/params';
import { schedulerOf, withPieceScale } from '../../src/sim/infra/scheduler';
import type { UtilitiesSystem } from '../../src/sim/infra/utilities';
import type { TrafficSystem } from '../../src/sim/infra/traffic';
import type { PollutionSystem } from '../../src/sim/infra/pollution';
import type { ServicesSystem } from '../../src/sim/infra/services';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { place } from './cityGen';
import { emergCity, utilCity } from './infraCity';
import { UtilitiesSystemOriginal } from '../sim/exact/utilitiesOriginal';
import { EmergencySystemOriginal } from '../sim/exact/emergencyOriginal';
import { diffDigests, digest, fieldsDigest, stateDigest, trafficCycle } from './b2Harness';

// ------------------------------------------------------------------------------------------------ helpers
type Piecewise = { step(sim: Simulation): void; compute(sim: Simulation): void; stepName: string; stepCost(sim: Simulation): number };
type Ut = UtilitiesSystem & Piecewise;
interface UtCity { st: CityState; sim: Simulation; ut: Ut }
type UtF = { stepIdx: number; dirtyFull: boolean; dirtyWater: boolean; pComp: Int32Array; nPComp: number; sub: number };
const f = (u: Ut) => u as unknown as UtF;

/** a city's simulation: every system or infra only; utilities may be the frozen pre-B2 class */
function utSim(st: CityState, systems: 'infra' | 'all', orig = false): UtCity {
  const list = (systems === 'infra' ? infraSystems() : createSystems()) as SimSystem[];
  if (orig) list[list.findIndex((s) => s.name === 'utilities')] = new UtilitiesSystemOriginal() as unknown as SimSystem;
  const sim = new Simulation(st, list);
  return { st, sim, ut: sim.getSystem('utilities') as unknown as Ut };
}

/** a free cell (no building, road or water) */
function freeCell(st: CityState, rng: RNG, ok: (i: number) => boolean = () => true): number {
  for (let t = 0; t < 4000; t++) {
    const i = rng.int(0, st.cells - 1);
    if (st.building[i] < 0 && st.network[i] === 0 && !st.water[i] && ok(i)) return i;
  }
  return -1;
}

/** the edits between two passes: a road cut / restore (networkChanged), growables added / removed (the label patch), a
 *  growable bridging two grids (a soft pass relabels), a plopped building, power lines, zones, funding, occupancy, a plant
 *  burnt */
function utilEdit(c: UtCity, k: number): void {
  const { st, sim } = c, N = st.size;
  const rng = new RNG(0x6a4 + k * 31);
  switch (k % 6) {
    case 0: {
      const z = 4 + 3 * (k % 9);
      for (let x = 2; x < N - 12; x++) { const i = z * N + x; if (st.building[i] < 0 && !st.water[i]) st.network[i] = k % 12 === 0 ? Network.Road : 0; }
      sim.events.emit('networkChanged', { x0: 0, z0: z, x1: N - 1, z1: z });
      break;
    }
    case 1: {
      // growables added next to roads and removed: the soft pass's label patch
      for (let n = 0; n < 6; n++) {
        const i = freeCell(st, rng, (j) => (j % N > 0 && st.network[j - 1] !== 0) || (j % N < N - 1 && st.network[j + 1] !== 0));
        if (i >= 0) sim.events.emit('buildingAdded', place(st, rng.pick(['t_r1', 't_r2', 't_cs']), i % N, (i / N) | 0, { pop: 10, jobs: 4 }));
      }
      const list = buildingList(st).filter((b) => b.def.startsWith('t_r') || b.def === 't_cs');
      for (let n = 0; n < 3 && list.length; n++) removeBuilding(sim, list[(k * 17 + n * 5) % list.length]);
      st.zone[freeCell(st, rng)] = Zone.ResLow;
      sim.events.emit('zoneChanged', { x0: 0, z0: 0, x1: N - 1, z1: N - 1 });
      break;
    }
    case 2: {
      // a growable whose 4-neighbours lie in two power grids: patchPower fails, the soft pass relabels
      const comp = f(c.ut).pComp;
      for (let t = 0; t < 4000; t++) {
        const i = rng.int(N + 1, st.cells - N - 2);
        if (st.building[i] >= 0 || st.network[i] !== 0 || st.water[i] || comp.length !== st.cells) continue;
        const nb = [comp[i - 1], comp[i + 1], comp[i - N], comp[i + N]].filter((v) => v >= 0);
        if (nb.length < 2 || nb.every((v) => v === nb[0])) continue;
        sim.events.emit('buildingAdded', place(st, 't_r1', i % N, (i / N) | 0, { pop: 6 }));
        break;
      }
      for (const b of st.buildings.values()) if (b.pop > 0 && b.id % 7 === k % 7) b.pop = Math.max(0, b.pop - 5);
      break;
    }
    case 3: {
      // a plopped building (full pass) and power lines
      const i = freeCell(st, rng);
      if (i >= 0) sim.events.emit('buildingAdded', place(st, k % 2 ? 't_small_plant' : 't_pump', i % N, (i / N) | 0, { flags: BF.Plopped }));
      for (let n = 0; n < 30; n++) { const j = freeCell(st, rng); if (j >= 0) st.powerLines[j] = st.powerLines[j] ? 0 : 1; }
      sim.events.emit('powerLinesChanged', undefined as never);
      break;
    }
    case 4:
      new CityActions(sim).setFunding('utilities', [100, 55, 30, 120][k % 4]);
      for (const b of st.buildings.values()) if (b.pop > 0 && b.id % 5 === k % 5) b.pop += 3;
      break;
    default: {
      // a plant burnt or repaired
      const plants = buildingList(st).filter((b) => b.def.includes('plant') || b.def === 'util_wind_turbine');
      if (plants.length) { const b = plants[k % plants.length]; b.flags ^= BF.Burnt; sim.events.emit('buildingChanged', b); }
      break;
    }
  }
}

/** fields whose content depends on where the pieces fall (the clock) and object references (the state digest covers the
 *  state) */
const EX = ['lastMs', 'simRef', 'unsub', 'snap', 'pollRef'];

function cityDigest(st: CityState): Record<string, string> {
  const out = stateDigest(st);
  for (const k of Object.keys(st.systemData)) out['sd.' + k] = digest((st.systemData as Record<string, unknown>)[k]);
  return out;
}

/** one utilities pass driven piece by piece with nothing in between; hook after every piece (with the state before it) */
function utilPass(c: UtCity, hook?: (c: UtCity, k: number, before: number) => void): number {
  const s = f(c.ut);
  s.stepIdx = -1;
  let k = 0;
  do {
    const before = s.stepIdx;
    c.ut.step(c.sim);
    hook?.(c, ++k, before);
    if (k > 5e6) throw new Error('utilities pass did not end');
  } while (s.stepIdx >= 0);
  return k;
}

interface RunOpts { orig?: boolean; hook?: (c: UtCity, k: number, before: number) => void; exclude?: string[]; drop?: string[]; initScale?: number; midWater?: boolean }
/** the utilities passes of a city at piece scale `scale` ('random': a random scale per pass); the digests after init and at
 *  every pass end. midWater: a road edit right before the water step (pre-B2's mid-pass water relabel) */
function runPasses(mk: () => CityState, systems: 'infra' | 'all', passes: number, scale: number | 'random', opts: RunOpts = {}): Record<string, string>[] {
  const rng = new RNG(0x51a7);
  const pick = () => (scale === 'random' ? rng.pick([1e9, 1, 0.3, 0.05, 0.004]) : scale);
  const c = withPieceScale(opts.initScale ?? pick(), () => utSim(mk(), systems, opts.orig));
  const ex = [...EX, ...(opts.exclude ?? [])];
  const dig = () => {
    const d: Record<string, string> = { ...cityDigest(c.st) };
    for (const [k, v] of Object.entries(fieldsDigest(c.ut, ex))) d['ut.' + k] = v;
    for (const k of opts.drop ?? []) delete d[k];
    return d;
  };
  const out: Record<string, string>[] = [dig()];
  for (let p = 0; p < passes; p++) {
    utilEdit(c, p);
    c.st.day += 3 + (p % 4) * 5;
    let edited = false;
    withPieceScale(pick(), () => utilPass(c, (cc, k, before) => {
      opts.hook?.(cc, k, before);
      // (after the power state's last piece, before U_WATER's first: the same pass-relative point in every arm)
      if (opts.midWater && !edited && before !== 4 && f(cc.ut).stepIdx === 4) {
        edited = true;
        const z = 7 + 3 * (p % 5), st = cc.st, N = st.size;
        for (let x = 3; x < N / 2; x++) { const i = z * N + x; if (st.building[i] < 0 && !st.water[i]) st.network[i] = st.network[i] ? 0 : Network.Road; }
        cc.sim.events.emit('networkChanged', { x0: 0, z0: z, x1: N - 1, z1: z });
      }
    }));
    out.push(dig());
  }
  return out;
}

function expectSameRuns(a: Record<string, string>[], b: Record<string, string>[], label: string): void {
  expect(b.length).toBe(a.length);
  for (let p = 0; p < a.length; p++) expect(diffDigests(a[p], b[p]), `${label}: ${p === 0 ? 'init' : `pass ${p}`}`).toEqual([]);
}

// ------------------------------------------------------------------------------------------------ utilities
describe('B2 G4 utilities: a pass in one go = in pieces = the frozen pre-B2 pass', () => {
  const cities: [string, () => CityState, 'infra' | 'all', number][] = [
    ['util city 48 (no short grid), infra only', () => utilCity(48, 5, 'ok'), 'infra', 8],
    ['util city 64 (short main grids), every system', () => utilCity(64, 9, 'short'), 'all', 7],
    ['util city 96 (a short island grid), infra only', () => utilCity(96, 7, 'island'), 'infra', 7],
  ];
  for (const [name, mk, systems, passes] of cities) {
    it(`${name}: one go = production pieces = tiny / random pieces, at every pass end across edits`, () => {
      const one = runPasses(mk, systems, passes, 1e9);
      expectSameRuns(one, runPasses(mk, systems, passes, 1), `${name} production`);
      expectSameRuns(one, runPasses(mk, systems, passes, name.includes(' 96') ? 0.01 : 1e-9), `${name} tiny`);
      expectSameRuns(one, runPasses(mk, systems, passes, 'random'), `${name} random`);
    }, 600_000);

    it(`${name}: production and random pieces = the frozen original (41ae570), every original field`, () => {
      const orig = withPieceScale(1, () => utSim(mk(), systems, true));
      const w = withPieceScale(1, () => utSim(mk(), systems));
      const exW = Object.keys(w.ut).filter((k) => !(k in orig.ut));
      expect(Object.keys(orig.ut).filter((k) => !(k in w.ut))).toEqual([]);
      const ref = runPasses(mk, systems, passes, 1, { orig: true });
      expectSameRuns(ref, runPasses(mk, systems, passes, 1, { exclude: exW }), `${name} production vs original`);
      expectSameRuns(ref, runPasses(mk, systems, passes, 'random', { exclude: exW }), `${name} random vs original`);
      // (a road edit between the power and the water step: the water step relabels the networks first)
      const refW = runPasses(mk, systems, 4, 1, { orig: true, midWater: true });
      expectSameRuns(refW, runPasses(mk, systems, 4, 0.05, { exclude: exW, midWater: true }), `${name} mid-pass water relabel vs original`);
    }, 600_000);
  }

  it('the edits reach every branch: both labels, the relabel of a soft pass, both brownouts, the results without one, the mid-pass water relabel, flag flips', () => {
    const seen = new Set<string>();
    for (const [mk, midWater] of [[() => utilCity(48, 5, 'ok'), false], [() => utilCity(64, 9, 'short'), true], [() => utilCity(96, 7, 'island'), false]] as const) {
      // (small pieces: every label spans several, so the names after each piece show every sub-state)
      const c = withPieceScale(0.05, () => utSim(mk(), 'infra'));
      const u = c.ut as unknown as UtF & { passFull: boolean; relabelPower: boolean; cand: number[]; changed: unknown[] };
      withPieceScale(0.05, () => {
        for (let p = 0; p < 7; p++) {
          utilEdit(c, p);
          c.st.day += 3 + (p % 4) * 5;
          let edited = false;
          utilPass(c, (cc, _k, before) => {
            const n = cc.ut.stepName.split('#')[0];
            if (n === 'label.plabel') seen.add(u.passFull ? 'powerLabel' : 'softRelabel');
            if (n === 'label.wlabel') seen.add('waterLabel');
            if (n === 'water.wlabel') seen.add('midWaterRelabel');
            if (n.startsWith('brownout.')) seen.add('powerBrownout');
            if (n.startsWith('waterBrownout.')) seen.add('waterBrownout');
            if (n === 'power.cells') seen.add('powerResults');
            if (n === 'water.cells') seen.add('waterResults');
            if (n.endsWith('.events') && u.changed.length > 0) seen.add('flagFlips');
            if (midWater && !edited && before !== 4 && u.stepIdx === 4) {
              edited = true;
              const st = cc.st, N = st.size, z = 10;
              for (let x = 3; x < N / 2; x++) { const i = z * N + x; if (st.building[i] < 0 && !st.water[i]) st.network[i] = st.network[i] ? 0 : Network.Road; }
              cc.sim.events.emit('networkChanged', { x0: 0, z0: z, x1: N - 1, z1: z });
            }
          });
        }
      });
    }
    expect([...seen].sort()).toEqual(['flagFlips', 'midWaterRelabel', 'powerBrownout', 'powerLabel', 'powerResults', 'softRelabel', 'waterBrownout', 'waterLabel', 'waterResults']);
  }, 300_000);

  it('R8: queries of other systems between every two pieces change nothing', () => {
    const mk = () => utilCity(48, 13, 'short');
    // (emergency's probe refreshes its station list lazily and saves it in systemData.emergency: the query's own effect)
    const drop = ['systemData', 'sd.emergency'];
    const base = runPasses(mk, 'all', 5, 0.05, { drop });
    const rng = new RNG(0x9e7c);
    const withQueries = runPasses(mk, 'all', 5, 0.05, {
      drop,
      hook: (c, k) => {
        const { sim, st } = c, N = st.size;
        const ut = c.ut;
        for (let q = 0; q < 4; q++) {
          const x = rng.int(0, N - 1), z = rng.int(0, N - 1);
          ut.gridInfo(sim, x, z); ut.waterInfo(sim, x, z); ut.waterQualityAt(sim, z * N + x);
        }
        for (const b of buildingList(st)) if (b.id % 11 === k % 11) { ut.plantLoad(b.id); ut.producerInfo(b.id); }
        const tr = sim.getSystem('traffic') as unknown as TrafficSystem, tf = tr as unknown as { attachDirty: boolean };
        tr.findPath(sim, rng.int(0, st.cells - 1), rng.int(0, st.cells - 1));
        if (k % 5 === 0) { tf.attachDirty = true; tr.stopAttached(rng.int(0, st.nextBuildingId)); tr.freightRailCells(); }
        const pol = sim.getSystem('pollution') as unknown as PollutionSystem;
        for (const b of buildingList(st)) if (b.id % 23 === k % 23) { pol.garbageInfo(b.id); pol.incineratorShare(b.id); }
        (sim.getSystem('services') as unknown as ServicesSystem | undefined)?.needRaster('police');
        const em = emergencyOf(sim);
        if (em && k % 3 === 0) em.probe(sim, rng.pick(['fire', 'police', 'medical'] as const), rng.int(0, N - 1), rng.int(0, N - 1));
      },
    });
    expectSameRuns(base, withQueries, 'queries between pieces');
  }, 600_000);

  it('R7: every external output changes in at most one piece per state visit (production and tiny pieces)', () => {
    for (const [mk, scale] of [[() => utilCity(64, 17, 'short'), 1], [() => utilCity(48, 19, 'island'), 0.03]] as const) {
      const c = withPieceScale(scale, () => utSim(mk(), 'infra'));
      const { st, sim, ut } = c, N = st.size;
      const flags = () => { let h = 0; for (const b of st.buildings.values()) h = (Math.imul(h, 31) + (b.flags & (BF.Powered | BF.Watered)) + b.id) | 0; return h; };
      const samples = Array.from({ length: 40 }, (_, k) => ((k * 7919) % N) * N + ((k * 104729) % N));
      const ids = () => buildingList(st).filter((b) => b.id % 3 === 0).map((b) => b.id);
      const outputs = (): Record<string, string> => ({
        powered: digest(st.powered), watered: digest(st.watered), flags: String(flags()),
        stats: digest([st.stats.powerSupply, st.stats.powerDemand, st.stats.waterSupply, st.stats.waterDemand, st.stats.tapWater]),
        grid: digest(samples.map((i) => ut.gridInfo(sim, i % N, (i / N) | 0))),
        water: digest(samples.map((i) => [ut.waterInfo(sim, i % N, (i / N) | 0), ut.waterQualityAt(sim, i)])),
        bwater: digest(buildingList(st).map((b) => ut.waterInfo(sim, b.x, b.z))),
        load: digest(ids().map((id) => ut.plantLoad(id))),
        producers: digest(buildingList(st).map((b) => ut.producerInfo(b.id)?.output ?? null)),
      });
      for (let p = 0; p < 6; p++) {
        utilEdit(c, p);
        st.day += 5;
        let prev = outputs();
        const changes = new Map<string, number>();
        let pieces = 0, visit = 0, state = -1;
        withPieceScale(scale, () => utilPass(c, () => {
          pieces++;
          const now = outputs();
          for (const k of Object.keys(now)) {
            if (now[k] === prev[k]) continue;
            const key = `${k}@${visit}:${state}`;
            changes.set(key, (changes.get(key) ?? 0) + 1);
          }
          prev = now;
          const s = f(ut).stepIdx;
          if (s !== state) { visit++; state = s; }
        }));
        expect(pieces, `pass ${p}`).toBeGreaterThan(20);
        for (const [k, n] of changes) expect(n, `pass ${p}: ${k} changed in ${n} pieces`).toBeLessThanOrEqual(1);
      }
    }
  }, 300_000);

  it('R9: a save taken mid-pass holds no pass state; it loads idle and loads the same twice', () => {
    const c = withPieceScale(1, () => utSim(utilCity(48, 21, 'short'), 'infra'));
    const keysOf = (x: SerializedCity) => ({ top: Object.keys(x).sort(), sd: Object.keys((x.data.systemData ?? {}) as object).sort() });
    const between = keysOf(serializeCity(c.st, { copy: true }));
    for (const at of [40, 130, 260]) {
      utilEdit(c, at);
      let saved = null as SerializedCity | null, name = '';
      withPieceScale(0.02, () => utilPass(c, (cc, k) => { if (k === at && f(cc.ut).stepIdx >= 0) { saved = structuredClone(serializeCity(cc.st, { copy: true })); name = cc.ut.stepName; } }));
      expect(saved, `mid-pass save at piece ${at} taken`).not.toBeNull();
      expect(name).not.toMatch(/start$/);
      expect(keysOf(saved!)).toEqual(between);
      const load = () => {
        const c2 = utSim(deserializeCity(structuredClone(saved!)), 'infra');
        const x = c2.ut as unknown as Record<string, unknown>;
        expect(x.stepIdx).toBe(-1);
        for (const k of ['sub', 'cur', 'lS', 'lNc', 'qh', 'qt']) expect(x[k], k).toBe(0);
        expect((x.snap as { n: number }).n).toBe(0);
        expect((x.cand as unknown[]).length).toBe(0);
        for (let d = 0; d < 30; d++) { c2.sim.advanceDay(); schedulerOf(c2.sim).flush(c2.sim); }
        return { ...cityDigest(c2.st), ...fieldsDigest(c2.ut, EX) };
      };
      expect(diffDigests(load(), load())).toEqual([]);
    }
  }, 300_000);

  it('O4: the piece sequence and the results do not depend on the host mode (frames active or headless)', () => {
    const run = (live: boolean) => {
      const c = utSim(utilCity(48, 23, 'short'), 'infra');
      const sch = schedulerOf(c.sim) as unknown as { lastFrameMs: number; framesActive: boolean };
      sch.lastFrameMs = live ? 1e15 : -1e15;
      expect(sch.framesActive).toBe(live);
      const names: string[] = [], out: Record<string, string>[] = [];
      for (let p = 0; p < 4; p++) {
        utilEdit(c, p);
        c.st.day += 5;
        utilPass(c, (cc) => names.push(cc.ut.stepName));
        out.push({ ...cityDigest(c.st), ...fieldsDigest(c.ut, EX) });
      }
      return { names, out };
    };
    const headless = run(false), live = run(true);
    expect(live.names.length).toBeGreaterThan(100);
    expect(live.names).toEqual(headless.names);
    expectSameRuns(headless.out, live.out, 'frames active');
  }, 300_000);

  it('two cities stepped interleaved, piece by piece, equal their solo runs (no module scratch shared across cities)', () => {
    const mkA = () => utilCity(48, 31, 'short'), mkB = () => utilCity(40, 37, 'island');
    const soloA = runPasses(mkA, 'infra', 4, 0.05, { initScale: 0.05 }), soloB = runPasses(mkB, 'infra', 4, 0.05, { initScale: 0.05 });
    withPieceScale(0.05, () => {
      const stA = mkA(), stB = mkB();
      const A = utSim(stA, 'infra'), B = utSim(stB, 'infra');
      const dig = (c: UtCity) => {
        const d: Record<string, string> = { ...cityDigest(c.st) };
        for (const [k, v] of Object.entries(fieldsDigest(c.ut, EX))) d['ut.' + k] = v;
        return d;
      };
      const a = [dig(A)], b = [dig(B)];
      for (let p = 0; p < 4; p++) {
        utilEdit(A, p); utilEdit(B, p);
        A.st.day += 3 + (p % 4) * 5; B.st.day += 3 + (p % 4) * 5;
        const sa = f(A.ut), sb = f(B.ut);
        sa.stepIdx = sb.stepIdx = -1;
        let first = true;
        while (first || sa.stepIdx >= 0 || sb.stepIdx >= 0) {
          if (first || sa.stepIdx >= 0) A.ut.step(A.sim);
          if (first || sb.stepIdx >= 0) B.ut.step(B.sim);
          first = false;
        }
        a.push(dig(A));
        b.push(dig(B));
      }
      expectSameRuns(soloA, a, 'city A interleaved');
      expectSameRuns(soloB, b, 'city B interleaved');
    });
  }, 300_000);

  it('every piece estimate stays within its budget at the production size (util city 128)', () => {
    const c = utSim(utilCity(128, 41, 'short'), 'infra');
    const max = new Map<string, number>();
    for (let p = 0; p < 6; p++) {
      utilEdit(c, p);
      c.st.day += 5;
      utilPass(c, (cc) => {
        const name = cc.ut.stepName.replace(/#\d+$/, ''), e = cc.ut.stepCost(cc.sim);
        if (e > (max.get(name) ?? 0)) max.set(name, e);
      });
    }
    // (the estimate is taken before each piece: utilPass's hook runs after it, so record the next one's; half
    // INFRA_PIECE_COLD_MS for every piece, the snapshot take (one buildingList + copy) excepted)
    for (const [name, e] of max) {
      const cap = /snap$/.test(name) ? 1 : INFRA_PIECE_COLD_MS * 0.75;
      expect(e, `${name} estimate`).toBeLessThanOrEqual(cap);
    }
    expect(max.size).toBeGreaterThan(15);
  }, 300_000);
});

// ------------------------------------------------------------------------------------------------ emergency response
type EmF = { respStep: number; respSub?: number; respDirty: boolean; respTaskStep(sim: Simulation): void; respCost(): number; stepName?: string };
interface EmCity { st: CityState; sim: Simulation; em: EmF }
function emSim(st: CityState, orig = false): EmCity {
  const list = infraSystems() as SimSystem[];
  if (orig) list[list.findIndex((s) => s.name === 'emergency')] = new EmergencySystemOriginal() as unknown as SimSystem;
  const sim = new Simulation(st, list);
  return { st, sim, em: sim.getSystem('emergency') as unknown as EmF };
}
const emActive = (em: EmF) => em.respStep >= 0 || (em.respSub ?? 0) !== 0;

/** one response sequence driven piece by piece with nothing in between; hook after every piece */
function respSequence(c: EmCity, hook?: (c: EmCity, k: number, before: number) => void): number {
  c.em.respStep = -1;
  c.em.respDirty = true;
  let k = 0;
  do {
    const before = c.em.respStep;
    c.em.respTaskStep(c.sim);
    hook?.(c, ++k, before);
    if (k > 5e6) throw new Error('response sequence did not end');
  } while (emActive(c.em));
  return k;
}

/** a road row cut or restored, then one traffic cycle: traffic rebuilds its graph (the moved graph: its signature, an
 *  epoch change), its layer updates (the siren times) */
function roadEditAndCycle(c: EmCity, z: number, restore: boolean): void {
  const { st, sim } = c, N = st.size;
  for (let x = 2; x < N / 2; x++) { const i = z * N + x; if (st.building[i] < 0) st.network[i] = restore ? Network.Road : 0; }
  sim.events.emit('networkChanged', { x0: 0, z0: z, x1: N - 1, z1: z });
  trafficCycle(sim);
}

/** the edits between two sequences: a road edit + a traffic cycle (graph epoch, siren times), a station built, a station
 *  bulldozed, a subway edit + a traffic cycle (traffic rebuilds the very same road graph: the same signature), a traffic
 *  cycle alone (siren times) */
function emEdit(c: EmCity, k: number): void {
  const { st, sim } = c, N = st.size;
  const rng = new RNG(0xe3 + k * 13);
  switch (k % 5) {
    case 0: roadEditAndCycle(c, 4 + 3 * (k % 7), k % 10 === 5); break;
    case 1: {
      const i = freeCell(st, rng, (j) => j % N > 0 && st.network[j - 1] !== 0);
      if (i >= 0) sim.events.emit('buildingAdded', place(st, rng.pick(['t_fire', 't_police', 't_clinic']), i % N, (i / N) | 0, { flags: BF.Plopped | BF.Powered | BF.Watered }));
      break;
    }
    case 2: {
      const stations = buildingList(st).filter((b) => b.def.startsWith('civ_') || b.def === 't_fire' || b.def === 't_police' || b.def === 't_clinic');
      if (stations.length > 2) removeBuilding(sim, stations[k % stations.length]);
      break;
    }
    case 3: {
      const i = rng.int(N, st.cells - N - 1);
      st.subway[i] = st.subway[i] ? 0 : 1;
      sim.events.emit('networkChanged', { x0: i % N, z0: (i / N) | 0, x1: i % N, z1: (i / N) | 0 });
      trafficCycle(sim);
      break;
    }
    default: trafficCycle(sim);
  }
}

/** emergency fields that are references, clocks or dispatch scratch (the state digest covers the state) */
const EM_EX = ['sim', 'unsub', 'lastDailyMs', 'g', 'ownG', 'sigG', 'sigRunG', 'cacheState'];

interface EmOpts { orig?: boolean; hook?: (c: EmCity, k: number, before: number) => void; exclude?: string[]; drop?: string[]; midGraph?: boolean }
function runSequences(mk: () => CityState, seqs: number, scale: number | 'random', opts: EmOpts = {}): Record<string, string>[] {
  const rng = new RNG(0xe5e9);
  const pick = () => (scale === 'random' ? rng.pick([1e9, 1, 0.3, 0.05, 0.004]) : scale);
  const c = withPieceScale(pick(), () => emSim(mk(), opts.orig));
  const ex = [...EM_EX, ...(opts.exclude ?? [])];
  const dig = () => {
    const d: Record<string, string> = { ...cityDigest(c.st) };
    for (const [k, v] of Object.entries(fieldsDigest(c.em, ex))) d['em.' + k] = v;
    for (const k of opts.drop ?? []) delete d[k];
    return d;
  };
  const out: Record<string, string>[] = [dig()];
  for (let p = 0; p < seqs; p++) {
    emEdit(c, p);
    c.st.day += 30;
    let edited = false;
    withPieceScale(pick(), () => respSequence(c, (cc, k, before) => {
      opts.hook?.(cc, k, before);
      // (a graph change in the middle of the police search: the same sequence-relative point in every arm)
      if (opts.midGraph && !edited && before !== 1 && cc.em.respStep === 1) { edited = true; roadEditAndCycle(cc, 7 + 3 * (p % 5), p % 2 === 1); }
    }));
    out.push(dig());
  }
  return out;
}

describe('B2 G4 emergency response: a sequence in one go = in pieces = the frozen pre-B2 sequence', () => {
  const cities: [string, () => CityState, number][] = [
    ['emergency city 64', () => emergCity(64, 9), 6],
    ['emergency city 96', () => emergCity(96, 7), 6],
  ];
  for (const [name, mk, seqs] of cities) {
    it(`${name}: one go = production pieces = tiny / random pieces, at every sequence end across edits`, () => {
      const one = runSequences(mk, seqs, 1e9);
      expectSameRuns(one, runSequences(mk, seqs, 1), `${name} production`);
      expectSameRuns(one, runSequences(mk, seqs, name.includes(' 96') ? 0.01 : 1e-9), `${name} tiny`);
      expectSameRuns(one, runSequences(mk, seqs, 'random'), `${name} random`);
    }, 600_000);

    it(`${name}: production and random pieces = the frozen original (41ae570), every original field, also with a graph change mid-sequence`, () => {
      const orig = emSim(mk(), true), w = emSim(mk());
      const exW = Object.keys(w.em).filter((k) => !(k in orig.em));
      expect(Object.keys(orig.em).filter((k) => !(k in w.em))).toEqual([]);
      const ref = runSequences(mk, seqs, 1, { orig: true });
      expectSameRuns(ref, runSequences(mk, seqs, 1, { exclude: exW }), `${name} production vs original`);
      expectSameRuns(ref, runSequences(mk, seqs, 'random', { exclude: exW }), `${name} random vs original`);
      const refG = runSequences(mk, 4, 1, { orig: true, midGraph: true });
      expectSameRuns(refG, runSequences(mk, 4, 0.05, { exclude: exW, midGraph: true }), `${name} graph change mid-sequence vs original`);
    }, 600_000);
  }

  it('the edits reach every branch: a moved graph (signature pieces, epoch restart), the same graph rebuilt, the station scan, the siren times, every state', () => {
    const c = withPieceScale(0.05, () => emSim(emergCity(64, 9)));
    const seen = new Set<string>();
    const e = c.em as unknown as { gEpoch: number; stScan: unknown[] };
    withPieceScale(0.05, () => {
      for (let p = 0; p < 8; p++) {
        emEdit(c, p);
        c.st.day += 30;
        const ep0 = e.gEpoch;
        let edited = false;
        respSequence(c, (cc, _k, before) => {
          const n = (cc.em.stepName ?? '').replace(/#\d+$/, '');
          seen.add(n);
          // (a police search piece followed by a start piece: the epoch restart)
          if (before >= 1 && cc.em.respStep === -1) seen.add('restart');
          if (p === 6 && !edited && before !== 1 && cc.em.respStep === 1) { edited = true; roadEditAndCycle(cc, 13, false); }
        });
        if (p % 5 === 3) seen.add(e.gEpoch === ep0 ? 'sameGraph' : 'subwayMovedEpoch');
      }
    });
    for (const k of ['resp0.sig', 'resp0.scan', 'resp0.times', 'resp0.start', 'resp0.run', 'resp0.slack', 'resp1.run', 'resp2.slack', 'resp3.rows', 'resp4.bld', 'resp1.sig', 'sameGraph', 'restart']) expect(seen.has(k), k).toBe(true);
  }, 300_000);

  it('R8: dispatch queries between every two pieces (lazy station / graph / siren refreshes) change no response result', () => {
    const mk = () => emergCity(64, 11);
    // (the queries refresh the shared lazy caches themselves: the pieces' caches and dispatch scratch differ, the results not)
    const resp = ['respFire', 'respPolice', 'respMedical', 'buildings', 'stats'];
    const fieldsOf = (c: EmCity) => {
      const f = c.em as unknown as Record<string, unknown>;
      return digest([f.nodeSlack, f.hasStation, f.respLast, f.respComputed, f.gEpoch, f.gSig, f.stVer, f.tm, f.respTm, f.stations, (f.p as { siren?: unknown }).siren]);
    };
    const run = (queries: boolean) => {
      const rng = new RNG(0x9e7d);
      const c = withPieceScale(0.05, () => emSim(mk()));
      const out: string[] = [];
      for (let p = 0; p < 6; p++) {
        emEdit(c, p);
        c.st.day += 30;
        withPieceScale(0.05, () => respSequence(c, (cc) => {
          if (!queries) return;
          const em = emergencyOf(cc.sim)!, N = cc.st.size;
          em.probe(cc.sim, rng.pick(['fire', 'police', 'medical'] as const), rng.int(0, N - 1), rng.int(0, N - 1));
          em.stationList();
          (cc.sim.getSystem('traffic') as unknown as TrafficSystem).findPath(cc.sim, rng.int(0, cc.st.cells - 1), rng.int(0, cc.st.cells - 1));
        }));
        const d = cityDigest(c.st);
        out.push(digest([resp.map((k) => d[k]), fieldsOf(c)]));
      }
      return out;
    };
    expect(run(true)).toEqual(run(false));
  }, 300_000);

  it('R7 / R9: the siren times, their saved copy and the station list change in one piece; a save mid-sequence loads idle', () => {
    const c = withPieceScale(0.03, () => emSim(emergCity(64, 13)));
    const e = c.em as unknown as { tm: Float32Array; p: { siren?: unknown }; stations: unknown[] };
    const between = Object.keys((serializeCity(c.st, { copy: true }).data.systemData ?? {}) as object).sort();
    for (let p = 0; p < 5; p++) {
      emEdit(c, p);
      c.st.day += 30;
      const outs = () => ({ tm: digest(e.tm), siren: digest(e.p.siren), st: digest(e.stations) });
      let prev = outs(), saved = null as SerializedCity | null;
      const changes = new Map<string, number>();
      withPieceScale(0.03, () => respSequence(c, (cc, k) => {
        const now = outs();
        for (const key of Object.keys(now) as (keyof typeof now)[]) if (now[key] !== prev[key]) changes.set(key, (changes.get(key) ?? 0) + 1);
        prev = now;
        if (k === 25 && emActive(cc.em)) saved = structuredClone(serializeCity(cc.st, { copy: true }));
      }));
      for (const [key, n] of changes) expect(n, `sequence ${p}: ${key} changed in ${n} pieces`).toBeLessThanOrEqual(1);
      expect(saved).not.toBeNull();
      expect(Object.keys((saved!.data.systemData ?? {}) as object).sort()).toEqual(between);
      const c2 = emSim(deserializeCity(structuredClone(saved!)));
      const x = c2.em as unknown as Record<string, unknown>;
      expect(x.respStep).toBe(-1);
      for (const k of ['respSub', 'respCur']) expect(x[k], k).toBe(0);
      expect(x.tmRun).toBe(false);
      expect((x.stScan as unknown[]).length).toBe(0);
    }
  }, 300_000);

  it('every response piece estimate stays within its budget at the production size (emergency city 128)', () => {
    const c = emSim(emergCity(128, 41));
    const max = new Map<string, number>();
    for (let p = 0; p < 6; p++) {
      emEdit(c, p);
      c.st.day += 30;
      respSequence(c, (cc) => {
        const name = (cc.em.stepName ?? '').replace(/#\d+$/, ''), est = cc.em.respCost();
        if (est > (max.get(name) ?? 0)) max.set(name, est);
      });
    }
    // (a quarter of INFRA_PIECE_COLD_MS for every piece; the station scan's snapshot, one building-list copy, and a search's
    // start — the seeds and ChunkedSearch.start's native O(n) fills — excepted)
    for (const [name, est] of max) expect(est, `${name} estimate`).toBeLessThanOrEqual(name === 'resp0.stations' ? 0.5 : name.endsWith('.start') ? INFRA_PIECE_COLD_MS : INFRA_PIECE_COLD_MS * 0.5);
    expect(max.size).toBeGreaterThan(10);
  }, 300_000);
});
