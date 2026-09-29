/**
 * Equivalence of the field-pass kernels (wasm/sim-kernels/src/fields.rs via src/wasm/kernels/fieldPassesBind.ts) with the
 * 24f8609 JS originals (tests/wasm/fieldPassesOriginal.ts, verbatim loops of nimby.ts / pollution.ts) and the fair JS
 * (src/wasm/js/fieldPasses.ts). Everything must be BIT-identical (uint32 patterns, NaN == NaN; counters exactly):
 *  1. random inputs, per kernel: NIMBY rasters (splat lists with off-map / edge / 64+-wide footprints, amounts and radii
 *     incl. 0, −0, NaN, ±Infinity, subnormal, huge; landfill blocks with odd N and NaN / negative / > 1 fill; corridor
 *     cache hits, misses and resizes), stageCells (layers with ±0, subnormals, NaN, ±Infinity, unknown network codes,
 *     every flag bit; freight lists as Int32Array or plain arrays with non-integers / out-of-range entries; landfill
 *     regions with out-of-range order entries), saturate (every mask / buffer combination), the water stage (rivers,
 *     lakes, isolated cells, all water, none; the lists of the original ensureWaterList; invalid lists → JS), the soil
 *     stock — for the original, the fair JS and the wasm kernels on resident (wasm memory) and staged (plain) arrays;
 *  2. edge cases: 1×1 map, no sources, no water, zero / huge values, arguments outside the kernels' domain (→ JS);
 *  3. the live modules: nimby.ts's rebuildNimby vs makeNimby(fair JS / wasm) (outputs + scheduler cost) across
 *     network / building edits; a PollutionSystem with installFieldPasses(…) vs the genuine one, compared after EVERY
 *     step of several passes (source fields air / waterS / noiseS, airPollution, noise, waterPollution, ground, soil);
 *  4. the profiler's 1M-population fixtures (captures written by tools/bench/fieldPasses.bench.mjs; skipped when absent);
 *  5. the whole city: 120 days of every system with the genuine field passes, the fair JS and the wasm kernels (resident
 *     and staged) — bit-identical layers and stats (after a JS-vs-JS baseline).
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type * as NimbyModule from '../../src/sim/infra/nimby';
import type { CityState } from '../../src/sim/CityState';

// services.ts imports rebuildNimby / nimbyCost from nimby.ts: dispatch per CityState (registry below), else the original
vi.mock('../../src/sim/infra/nimby', async (importOriginal) => {
  const orig = await importOriginal<typeof NimbyModule>();
  const reg = ((globalThis as { __nimbySwitch?: WeakMap<object, { rebuildNimby: (s: unknown) => void; nimbyCost: (s: unknown) => number }> }).__nimbySwitch ??= new WeakMap());
  return {
    ...orig,
    rebuildNimby: (sim: { state: object }) => { const i = reg.get(sim.state); return i ? i.rebuildNimby(sim) : orig.rebuildNimby(sim as never); },
    nimbyCost: (sim: { state: object }) => { const i = reg.get(sim.state); return i ? i.nimbyCost(sim) : orig.nimbyCost(sim as never); },
  };
});

const { rebuildNimby, nimbyCost } = await import('../../src/sim/infra/nimby');
const { Simulation } = await import('../../src/sim/Simulation');
const { createSystems } = await import('../../src/sim/systems/index');
const { schedulerOf } = await import('../../src/sim/infra/scheduler');
const { falloff } = await import('../../src/sim/infra/catchments');
const { DX, DZ } = await import('../../src/sim/infra/common');
const { BANK_DIST, NIMBY_HIGHWAY, NIMBY_HIGHWAY_BRIDGE, NIMBY_LANDFILL_IDLE, NIMBY_RAIL } = await import('../../src/sim/infra/params');
const { Network, Zone } = await import('../../src/core/types');
const { BF } = await import('../../src/sim/CityState');
const { simWasmInstance, simWasmStatus } = await import('../../src/wasm/simWasm');
const { adoptLayers } = await import('../../src/wasm/layers');
const { NimbySources, NimbyTables, PH_ALL, SAT_TABLE, fieldKernelsJs } = await import('../../src/wasm/js/fieldPasses');
const { FIELDS_KERNEL, makeFieldKernels, fieldsMathSelfTest } = await import('../../src/wasm/kernels/fieldPassesBind');
const { adoptPollutionArrays, installFieldPasses, makeNimby } = await import('../../src/wasm/kernels/fieldPasses');
const orig = await import('./fieldPassesOriginal');
const core = await import('../../tools/bench/fieldPasses/core');
const { stressCity } = await import('../infra/cityGen');

type FieldKernels = import('../../src/wasm/js/fieldPasses').FieldKernels;
type FieldsWasm = import('../../src/wasm/kernels/fieldPassesBind').FieldsWasm;
type FieldsBindStats = import('../../src/wasm/kernels/fieldPassesBind').FieldsBindStats;
type NimbyArgs = import('../../src/wasm/js/fieldPasses').NimbyArgs;
type CellsArgs = import('../../src/wasm/js/fieldPasses').CellsArgs;
type WaterArgs = import('../../src/wasm/js/fieldPasses').WaterArgs;
type PollutionSystem = import('../../src/sim/infra/pollution').PollutionSystem;
type Sim = InstanceType<typeof Simulation>;

const ROOT = resolve(__dirname, '..', '..');

// ------------------------------------------------------------------------------------------------ helpers
function loaderWasm(): FieldsWasm {
  const w = simWasmInstance();
  if (!w) throw new Error('wasm unavailable: ' + simWasmStatus().error);
  return { ex: w.exports as unknown as FieldsWasm['ex'], heap: w.heap };
}

/** kernels that must run wasm on every call (a JS fallback throws) */
const NEVER: FieldKernels = {
  kind: 'never',
  nimby() { throw new Error('nimby fell back to JS'); },
  cells() { throw new Error('cells fell back to JS'); },
  saturate() { throw new Error('saturate fell back to JS'); },
  water() { throw new Error('water fell back to JS'); },
  soil() { throw new Error('soil fell back to JS'); },
};
function wasmKernels(stats?: FieldsBindStats): FieldKernels {
  return makeFieldKernels(NEVER, { wasm: loaderWasm(), stats, onError: (e) => { throw e; } });
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

type Kind = 'unit' | 'noise' | 'wide' | 'special' | 'zero' | 'negzero' | 'huge' | 'sparse';
const KINDS: Kind[] = ['unit', 'noise', 'wide', 'special', 'zero', 'negzero', 'huge', 'sparse'];
function value(kind: Kind, r: () => number): number {
  const u = r();
  switch (kind) {
    case 'unit': return u;
    case 'noise': return u * 3 - 1;
    case 'wide': return u < 0.1 ? (u < 0.05 ? 0 : -0) : (r() < 0.5 ? -1 : 1) * Math.exp((r() * 2 - 1) * 70);
    case 'special': return [NaN, Infinity, -Infinity, 0, -0, 1e-40, -1e-42, 3.4e38, -3.4e38, r(), -r(), 1, 0.02, 0.005, 2, 1e-4][(u * 16) | 0];
    case 'zero': return 0;
    case 'negzero': return -0;
    case 'huge': return (r() < 0.5 ? -1 : 1) * 1e30 * (1 + r());
    case 'sparse': return u < 0.8 ? 0 : r() * 2;
  }
}
const f32 = (n: number, kind: Kind, r: () => number): Float32Array => Float32Array.from({ length: n }, () => value(kind, r));
const pick = <T>(xs: readonly T[], r: () => number): T => xs[(r() * xs.length) | 0];

/** first differing index of two arrays as bit patterns (NaN == NaN), -1 when identical */
function diffBits(a: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number }, b: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number }): number {
  if (a.length !== b.length) return 0;
  if (a instanceof Uint8Array || a instanceof Int32Array) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
    return -1;
  }
  const ua = new Uint32Array(a.buffer, a.byteOffset, a.length), ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return i;
  return -1;
}
function expectSame(label: string, a: Float32Array, b: Float32Array): void {
  const i = diffBits(a, b);
  expect(i, `${label}: differs at ${i}: ${a[i]} vs ${b[i]}`).toBe(-1);
}

/** a copy of `a` allocated in the loader's wasm memory (resident arrays) */
const residents: ArrayBufferView[] = [];
function resident<T extends Float32Array | Uint8Array | Int32Array>(a: T): T {
  const h = loaderWasm().heap;
  const v = h.allocArray(a.constructor as never, a.length) as unknown as T;
  (v as Float32Array).set(a as Float32Array);
  residents.push(v);
  return v;
}
function freeResidents(): void {
  const h = loaderWasm().heap;
  for (const v of residents) h.free(v);
  residents.length = 0;
}

// the random tests pin resident arrays: give the loader's heap room once (a safe point: nothing uses it yet)
loaderWasm().heap.reserve(64 << 20);

// ================================================================================================= 0. binary / math
describe('fields kernels: binary and math', () => {
  it('the loader binary has the fields exports and its fdlibm exp / log match this engine bit for bit', { timeout: 600000 }, () => {
    expect(FIELDS_KERNEL.instance(), simWasmStatus().error ?? '').not.toBeNull();
    const w = loaderWasm();
    expect(w.ex.fields_layout()).toBe(1);
    expect(fieldsMathSelfTest(w, 200000)).toBe(true);
  });
});

// ================================================================================================= 1. NIMBY
interface Splat { x: number; z: number; w: number; d: number; amount: number; R: number; target: 0 | 1 | 2 }

function randomSplats(N: number, n: number, r: () => number): Splat[] {
  const out: Splat[] = [];
  const amounts = [0.35, 0.12, 0.05, 1e-40, 1e30, NaN, 0, -0, -0.1, Infinity, 5e-324, 3];
  const radii = [0, 0.1, 0.124, 0.13, 0.5, 1, 2.26, 3, 4, 6, 10.4, 25, 60, 70, NaN, -1, Infinity];
  for (let k = 0; k < n; k++) {
    const special = r() < 0.15;
    const wide = r() < 0.03;
    out.push({
      x: ((r() * (N + 24)) | 0) - 12, z: ((r() * (N + 24)) | 0) - 12,
      w: wide ? pick([63, 64, 70, 100], r) : 1 + ((r() * 5) | 0), d: wide ? pick([1, 63, 64, 90], r) : 1 + ((r() * 5) | 0),
      amount: special ? pick(amounts, r) : r() * 0.6, R: special ? pick(radii, r) : r() * 9,
      target: ((r() * 3) | 0) as 0 | 1 | 2,
    });
  }
  return out;
}

interface NimbyWorld {
  N: number; splats: Splat[]; zone: Uint8Array; fill: Float32Array | null; net: Uint8Array; flags: Uint8Array; lfA: number; lfR: number;
}
function randomWorld(N: number, r: () => number, opts: { lf?: boolean; fillNull?: boolean; lfR?: number; lfA?: number } = {}): NimbyWorld {
  const C = N * N;
  const zone = new Uint8Array(C), net = new Uint8Array(C), flags = new Uint8Array(C);
  const fill = opts.fillNull ? null : f32(C, pick(['unit', 'special', 'wide', 'noise'] as Kind[], r), r);
  for (let i = 0; i < C; i++) {
    zone[i] = opts.lf !== false && r() < 0.25 ? Zone.Landfill : (r() * 10) | 0;
    const u = r();
    net[i] = u < 0.12 ? Network.Highway : u < 0.2 ? Network.Rail : u < 0.3 ? ((r() * 9) | 0) : 0;
    flags[i] = (r() * 256) | 0;
  }
  return { N, splats: randomSplats(N, 20 + ((r() * 60) | 0), r), zone, fill, net, flags, lfA: opts.lfA ?? 0.35, lfR: opts.lfR ?? 6 };
}

/** one arm of the NIMBY comparison: original (its own kernel cache), or kernels + a context */
class NimbyArm {
  S: Float32Array; P: Float32Array; K: Float32Array;
  ctx = {};
  tables = new NimbyTables(falloff);
  private origFn = orig.makeOriginalNimby(falloff);
  constructor(readonly label: string, readonly k: FieldKernels | null, readonly res: boolean, C: number) {
    this.S = new Float32Array(C); this.P = new Float32Array(C); this.K = new Float32Array(C);
    if (res) { this.S = resident(this.S); this.P = resident(this.P); this.K = resident(this.K); }
  }
  run(w: NimbyWorld, force = false): number {
    const lay = <T extends Uint8Array | Float32Array>(a: T): T => (this.res ? resident(a) : a);
    if (this.k === null) {
      return this.origFn({
        N: w.N, splats: w.splats, zone: w.zone, landfillFill: w.fill, network: w.net, netFlags: w.flags, lfA: w.lfA, lfR: w.lfR,
        NIMBY_LANDFILL_IDLE, NIMBY_HIGHWAY, NIMBY_HIGHWAY_BRIDGE, NIMBY_RAIL, stigma: this.S, prestige: this.P, campus: this.K,
      });
    }
    const src = new NimbySources(this.tables);
    let touches = 0;
    for (const s of w.splats) touches += src.add(s.x, s.z, s.w, s.d, s.amount, s.R, s.target);
    const lfTable = w.lfR > 0 ? this.tables.of(w.lfR, 2, 2) : null;
    const tabH = this.tables.of(NIMBY_HIGHWAY.radius, 1, 1), tabR = this.tables.of(NIMBY_RAIL.radius, 1, 1);
    const a: NimbyArgs = {
      N: w.N, src, zone: lay(w.zone), fill: w.fill ? lay(w.fill) : null, lfCode: Zone.Landfill, lfTable, lfA: w.lfA, lfIdle: NIMBY_LANDFILL_IDLE,
      net: lay(w.net), flags: lay(w.flags), highway: Network.Highway, rail: Network.Rail, tabH, tabR, aH: NIMBY_HIGHWAY.amount, aHB: NIMBY_HIGHWAY_BRIDGE,
      aR: NIMBY_RAIL.amount, force, S: this.S, P: this.P, K: this.K,
    };
    const r = this.k.nimby(this.ctx, a, PH_ALL);
    return touches + r.lf * (lfTable ? lfTable.n : 0) + r.nh * tabH.n + r.nr * tabR.n;
  }
}

describe('NIMBY rasters: original vs fair JS vs wasm (random worlds)', () => {
  it('splats, landfill blocks, corridors (cache hit / miss / resize) and 1 − exp(−x) are bit-identical', { timeout: 600000 }, () => {
    const r = rng(0xa11ce);
    const stats: FieldsBindStats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
    const W = wasmKernels(stats);
    try {
      for (const N of [1, 2, 3, 5, 8, 17, 33, 64]) {
        const C = N * N;
        const arms = [new NimbyArm('original', null, false, C), new NimbyArm('fair JS', fieldKernelsJs, false, C), new NimbyArm('wasm staged', W, false, C), new NimbyArm('wasm resident', W, true, C)];
        const worlds = [
          randomWorld(N, r), randomWorld(N, r, { fillNull: true }), randomWorld(N, r, { lfR: 0 }), randomWorld(N, r, { lfA: NaN }),
          randomWorld(N, r, { lf: false, lfR: 2.6, lfA: 1e-30 }),
        ];
        for (const w of worlds) {
          // the same network twice (the second fair / wasm rebuild hits the corridor cache), then a changed network
          for (let rep = 0; rep < 3; rep++) {
            if (rep === 2) for (let i = 0; i < C; i += 3) { w.net[i] = w.net[i] === Network.Highway ? Network.Rail : Network.Highway; w.flags[i] ^= (i & 1) + 1; }
            const t = arms.map((a) => a.run(w));
            for (let k = 1; k < arms.length; k++) {
              expect(t[k], `N=${N} touches ${arms[k].label}`).toBe(t[0]);
              expectSame(`N=${N} rep ${rep} ${arms[k].label} stigma`, arms[0].S, arms[k].S);
              expectSame(`N=${N} rep ${rep} ${arms[k].label} prestige`, arms[0].P, arms[k].P);
              expectSame(`N=${N} rep ${rep} ${arms[k].label} campus`, arms[0].K, arms[k].K);
            }
          }
          // force (no cache) gives the same
          const tf = arms.slice(1).map((a) => a.run(w, true));
          for (const t of tf) expect(t).toBe(arms[0].run(w));
          for (let k = 1; k < arms.length; k++) expectSame(`N=${N} forced ${arms[k].label}`, arms[0].S, arms[k].S);
        }
      }
      expect(stats.jsCalls).toBe(0);
      expect(stats.wasmCalls).toBeGreaterThan(100);
    } finally {
      freeResidents();
    }
  });

  it('a context reused across map sizes and interleaved cities keeps its cache correct', { timeout: 600000 }, () => {
    const r = rng(77);
    const W = wasmKernels();
    const a = new NimbyArm('original', null, false, 0), b = new NimbyArm('fair JS', fieldKernelsJs, false, 0), c = new NimbyArm('wasm', W, false, 0);
    for (const N of [16, 9, 16, 1, 16]) {
      const C = N * N;
      for (const arm of [a, b, c]) { arm.S = new Float32Array(C); arm.P = new Float32Array(C); arm.K = new Float32Array(C); }
      const w = randomWorld(N, r);
      expect(b.run(w)).toBe(a.run(w));
      expect(c.run(w)).toBe(a.run(w));
      expectSame(`N=${N} fair`, a.S, b.S);
      expectSame(`N=${N} wasm`, a.S, c.S);
    }
  });

  it('the corridor cache is keyed by the tables and amounts too (same network, other corridor parameters: rebuilt)', { timeout: 600000 }, () => {
    const r = rng(0xc0de);
    const N = 24, C = N * N;
    const w = randomWorld(N, r);
    const origFn = orig.makeOriginalNimby(falloff);
    // [highway amount, bridge amount, rail amount, highway radius, rail radius]; the last entry repeats: a cache hit
    const params = [[0.18, 0.25, 0.06, 3, 2], [0.3, 0.25, 0.06, 3, 2], [0.3, 0.4, 0.06, 3, 2], [0.3, 0.4, 0.1, 3, 2], [0.3, 0.4, 0.1, 5, 2],
      [0.3, 0.4, 0.1, 5, 4], [NaN, 0.4, 0.1, 5, 4], [NaN, 0.4, 0.1, 5, 4]];
    for (const impl of [fieldKernelsJs, wasmKernels()]) {
      const ctx = {};
      const tables = new NimbyTables(falloff);
      params.forEach(([aH, aHB, aR, rH, rR], k) => {
        const S0 = new Float32Array(C), P0 = new Float32Array(C), K0 = new Float32Array(C);
        const t0 = origFn({
          N, splats: w.splats, zone: w.zone, landfillFill: w.fill, network: w.net, netFlags: w.flags, lfA: w.lfA, lfR: w.lfR, NIMBY_LANDFILL_IDLE,
          NIMBY_HIGHWAY: { amount: aH, radius: rH }, NIMBY_HIGHWAY_BRIDGE: aHB, NIMBY_RAIL: { amount: aR, radius: rR }, stigma: S0, prestige: P0, campus: K0,
        });
        const src = new NimbySources(tables);
        let touches = 0;
        for (const s of w.splats) touches += src.add(s.x, s.z, s.w, s.d, s.amount, s.R, s.target);
        const lfTable = w.lfR > 0 ? tables.of(w.lfR, 2, 2) : null;
        const tabH = tables.of(rH, 1, 1), tabR = tables.of(rR, 1, 1);
        const S = new Float32Array(C), P = new Float32Array(C), K = new Float32Array(C);
        const res = impl.nimby(ctx, {
          N, src, zone: w.zone, fill: w.fill, lfCode: Zone.Landfill, lfTable, lfA: w.lfA, lfIdle: NIMBY_LANDFILL_IDLE, net: w.net, flags: w.flags,
          highway: Network.Highway, rail: Network.Rail, tabH, tabR, aH, aHB, aR, force: false, S, P, K,
        }, PH_ALL);
        expect(res.changed, `${impl.kind} params ${k}: raster rebuilt`).toBe(k !== params.length - 1);
        expect(touches + res.lf * (lfTable ? lfTable.n : 0) + res.nh * tabH.n + res.nr * tabR.n).toBe(t0);
        expectSame(`${impl.kind} params ${k} stigma`, S0, S);
        expectSame(`${impl.kind} params ${k} prestige`, P0, P);
      });
    }
  });
});

// ================================================================================================= 2. pollution kernels
interface CellsCase { base: CellsArgs; orig: { regCap: number[]; regUsed: number[]; lfAir: number; lfWater: number; lfNoise: number } }

function randomCells(N: number, r: () => number, freightKind: number): CellsCase {
  const C = N * N;
  const kind = () => pick(KINDS, r);
  const network = Uint8Array.from({ length: C }, () => { const u = r(); return u < 0.4 ? 0 : u < 0.9 ? 1 + ((r() * 6) | 0) : (r() * 256) | 0; });
  const building = Int32Array.from({ length: C }, () => (r() < 0.5 ? -1 : (r() * 1000) | 0) - (r() < 0.05 ? 1e6 : 0));
  const nReg = (r() * 4) | 0;
  const lfOrder = Int32Array.from({ length: 40 + ((r() * 40) | 0) }, () => (r() < 0.9 ? (r() * C) | 0 : pick([-1, C, C + 5, -1e6], r)));
  const regStart: number[] = [], regCount: number[] = [], regCap: number[] = [], regUsed: number[] = [];
  for (let k = 0; k < nReg; k++) {
    regStart.push((r() * lfOrder.length) | 0);
    regCount.push((r() * 30) | 0);   // may run past the end of lfOrder
    regCap.push(pick([0, 100, 1e6, -5], r));
    regUsed.push(r() * 200);
  }
  const lfAir = r() * 0.5, lfWater = r() * 0.2, lfNoise = r() * 0.1;
  const regAdd = new Float64Array(Math.max(4, 4 * nReg));
  for (let k = 0; k < nReg; k++) {
    const n = regCount[k];
    const use = regCap[k] > 0 ? Math.min(1, regUsed[k] / regCap[k]) : 0;
    const act = 0.25 + (1 - 0.25) * use;
    const m = act / Math.sqrt(Math.max(1, n / 16));
    regAdd[4 * k] = lfAir * m; regAdd[4 * k + 1] = lfWater * m; regAdd[4 * k + 2] = lfNoise * m; regAdd[4 * k + 3] = 0.35 * act;
  }
  const freight: ArrayLike<number> | null = freightKind === 0 ? null : freightKind === 1 ? new Int32Array(0)
    : freightKind === 2 ? Int32Array.from({ length: 30 }, () => ((r() * (C + 10)) | 0) - 5)
      : Array.from({ length: 30 }, () => pick([0, 1.5, -0, -1, C, C - 1, NaN, 2 ** 40, (r() * C) | 0, (r() * C) | 0], r));
  const base: CellsArgs = {
    C, garbage: f32(C, kind(), r), building, soil: f32(C, pick(['unit', 'sparse', 'special', 'wide'] as Kind[], r), r), network,
    traffic: f32(C, pick(['unit', 'wide', 'special', 'sparse', 'noise'] as Kind[], r), r).map((v) => v * 3000),
    congestion: f32(C, pick(['unit', 'noise', 'special'] as Kind[], r), r).map((v) => v * 2.5),
    netFlags: Uint8Array.from({ length: C }, () => (r() * 256) | 0),
    A0: f32(C, kind(), r), W0: f32(C, kind(), r), N0: f32(C, kind(), r), soilSrc: f32(C, kind(), r), freight, lfOrder, nReg, regStart, regCount, regAdd,
    smell: r() * 0.3, waterK: 5.714285714285714, soilGW: 0.3, trafficAir: 4e-5 * (0.5 + r()), tunnelAir: 0.3, congDamp: 0.25,
    crossing: r(), noisePerTrip: 3e-4, tunnelNoise: 0.05, bridgeNoise: 1.25, tn: pick([1, 0, 0.7, 1.3], r), freightS: r(),
    perTrip: [0, 0.00022, 0.0003, 0.00034, 0.0003, 0.00045, 0], base: Float32Array.from([0, 0, 0.0126, 0.0505, 0.025, 0.4, 0.16]), highway: 5, rail: 6,
  };
  return { base, orig: { regCap, regUsed, lfAir, lfWater, lfNoise } };
}

function cellsCopy(p: CellsArgs, res: boolean): CellsArgs {
  const c = <T extends Float32Array | Uint8Array | Int32Array>(a: T): T => (res ? resident(a) : (a.slice() as T));
  return { ...p, garbage: c(p.garbage), building: c(p.building), soil: c(p.soil), network: c(p.network), traffic: c(p.traffic), congestion: c(p.congestion),
    netFlags: c(p.netFlags), A0: c(p.A0), W0: c(p.W0), N0: c(p.N0), soilSrc: c(p.soilSrc), lfOrder: c(p.lfOrder) };
}

/** the used flags as stageCells leaves them (bit 0 air, 1 noise, 2 water) */
function usedFromBits(bits: number, p: CellsArgs): number {
  let u = bits;
  if (p.freight && p.freight.length > 0) u |= 2;
  for (let r = 0; r < p.nReg; r++) if (p.regCount[r] > 0) u |= 7;
  return u;
}

describe('pollution kernels: original vs fair JS vs wasm (random inputs)', () => {
  it('stageCells: cell loop, freight rail cells, landfill regions (+ used flags)', { timeout: 600000 }, () => {
    const r = rng(0xce11);
    const W = wasmKernels();
    try {
      for (const N of [1, 2, 3, 7, 16, 40]) for (let rep = 0; rep < 6; rep++) {
        const cs = randomCells(N, r, rep % 4);
        const o = cellsCopy(cs.base, false);
        const used = new Uint8Array(7);
        orig.origStageCells({
          C: o.C, traffic: o.traffic, congestion: o.congestion, network: o.network, netFlags: o.netFlags, building: o.building, garbage: o.garbage, soil: o.soil,
          A0: o.A0, W0: o.W0, N0: o.N0, soilSrc: o.soilSrc, used, trafficAir: o.trafficAir, tn: o.tn, perTrip: o.perTrip as number[], base: o.base as Float32Array,
          crossing: o.crossing, smell: o.smell, waterK: o.waterK, SOIL_GROUNDWATER: o.soilGW, TUNNEL_AIR: o.tunnelAir, NOISE_CONG_DAMP: o.congDamp,
          NOISE_PER_TRIP: o.noisePerTrip, TUNNEL_NOISE: o.tunnelNoise, BRIDGE_NOISE: o.bridgeNoise, fr: o.freight, freightS: o.freightS, nReg: o.nReg,
          regStart: o.regStart as number[], regCount: o.regCount as number[], regCap: cs.orig.regCap, regUsed: cs.orig.regUsed, lfOrder: o.lfOrder,
          lfAir: cs.orig.lfAir, lfWater: cs.orig.lfWater, lfNoise: cs.orig.lfNoise, LANDFILL_IDLE_EMIT: 0.25, LANDFILL_SIZE_REF: 16, SOIL_SRC_LANDFILL: 0.35,
        });
        const usedO = (used[0] ? 1 : 0) | (used[5] ? 2 : 0) | (used[3] ? 4 : 0);
        for (const [label, k, res] of [['fair JS', fieldKernelsJs, false], ['wasm staged', W, false], ['wasm resident', W, true]] as const) {
          const p = cellsCopy(cs.base, res);
          const bits = k.cells(p);
          expect(usedFromBits(bits, p), `${label} N=${N} used`).toBe(usedO);
          expectSame(`${label} N=${N} rep ${rep} A0`, o.A0, p.A0);
          expectSame(`${label} N=${N} rep ${rep} W0`, o.W0, p.W0);
          expectSame(`${label} N=${N} rep ${rep} N0`, o.N0, p.N0);
          expectSame(`${label} N=${N} rep ${rep} soilSrc`, o.soilSrc, p.soilSrc);
        }
        freeResidents();
      }
    } finally {
      freeResidents();
    }
  });

  it('saturate: every mask / buffer combination, alphas, special fields', { timeout: 600000 }, () => {
    const r = rng(0x5a7);
    const W = wasmKernels();
    try {
      for (const N of [1, 2, 3, 5, 16, 33]) {
        const C = N * N;
        for (let rep = 0; rep < 8; rep++) {
          const field = f32(C, pick(KINDS, r), r).map((v) => v * pick([1, 3, 20, 1e-3], r));
          const L0 = f32(C, pick(KINDS, r), r);
          const mask = r() < 0.5 ? Uint8Array.from({ length: C }, () => (r() < 0.3 ? (1 + ((r() * 255) | 0)) : 0)) : null;
          const buf1 = r() < 0.7 ? f32(C, pick(['unit', 'special', 'noise'] as Kind[], r), r) : null;
          const buf2 = r() < 0.5 ? f32(C, pick(['unit', 'special', 'wide'] as Kind[], r), r) : null;
          const invK = pick([1 / 3, 1 / 2, 1 / 3 + 1e-9, 5], r), alpha = pick([1, 0.35, 0, NaN, -2], r), k1 = pick([0.12, 0.25, 0, -1, NaN], r), k2 = pick([0.15, 2, 0], r);
          const a = L0.slice();
          orig.origSaturate(field, a, C, invK, alpha, mask, buf1, k1, buf2, k2);
          for (const [label, k, res] of [['fair JS', fieldKernelsJs, false], ['wasm staged', W, false], ['wasm resident', W, true]] as const) {
            const b = res ? resident(L0) : L0.slice();
            const g = <T extends Float32Array | Uint8Array | null>(x: T): T => (res && x ? resident(x as Float32Array) as unknown as T : x);
            k.saturate(g(field), b, C, invK, alpha, g(mask), g(buf1), k1, g(buf2), k2);
            expectSame(`${label} saturate N=${N} rep ${rep} mask ${!!mask} buf1 ${!!buf1} buf2 ${!!buf2}`, a, b);
          }
          freeResidents();
        }
      }
    } finally {
      freeResidents();
    }
  });

  it('water stage: cleaning, ground saturate, diffusion over the water list, bank coupling', { timeout: 600000 }, () => {
    const r = rng(0x3a7e5);
    const W = wasmKernels();
    try {
      for (const N of [1, 2, 3, 6, 17, 48]) {
        const C = N * N;
        const masks: [string, Uint8Array][] = [
          ['none', new Uint8Array(C)], ['all', new Uint8Array(C).fill(1)],
          ['river', Uint8Array.from({ length: C }, (_, i) => (Math.abs((i % N) - N / 2 - 3 * Math.sin((i / N) / 3)) < 2 ? 1 : 0))],
          ['lakes', Uint8Array.from({ length: C }, () => (r() < 0.2 ? 1 : 0))],
          ['coast', Uint8Array.from({ length: C }, (_, i) => ((i % N) + ((i / N) | 0) < N / 2 ? 1 + ((r() * 3) | 0) : 0))],
        ];
        for (const [mname, wm] of masks) for (let rep = 0; rep < 3; rep++) {
          const lists = orig.origWaterList(N, wm, BANK_DIST, DX, DZ);
          const tmp = f32(C, pick(['noise', 'special', 'unit', 'wide'] as Kind[], r), r), tmp2 = f32(C, pick(KINDS, r), r);
          const L = f32(C, pick(['unit', 'special', 'negzero', 'noise'] as Kind[], r), r), ground = f32(C, pick(['unit', 'special', 'wide'] as Kind[], r), r);
          const alpha = pick([1, 0.35], r);
          const o = { tmp: tmp.slice(), tmp2: tmp2.slice(), L: L.slice(), ground: ground.slice() };
          orig.origStageBAfterBlur({ C, ...o, wm, alpha, WATER_K: 2, BANK_COUPLING: 0.6, nW: lists.nWater, waterCells: lists.waterCells, waterNb: lists.waterNb, bankCells: lists.bankCells, bankSrc: lists.bankSrc });
          for (const [label, k, res] of [['fair JS', fieldKernelsJs, false], ['wasm staged', W, false], ['wasm resident', W, true]] as const) {
            const c = <T extends Float32Array | Uint8Array | Int32Array>(a: T): T => (res ? resident(a) : (a.slice() as T));
            const p: WaterArgs = { C, tmp: c(tmp), tmp2: c(tmp2), L: c(L), ground: c(ground), water: c(wm), waterCells: c(lists.waterCells), nW: lists.nWater,
              waterNb: c(lists.waterNb), bankCells: c(lists.bankCells), bankSrc: c(lists.bankSrc), invK: 1 / 2, alpha, bankCoupling: 0.6 };
            k.water(p);
            for (const key of ['L', 'ground', 'tmp', 'tmp2'] as const) expectSame(`${label} water N=${N} ${mname} rep ${rep} ${key}`, o[key], p[key]);
          }
          freeResidents();
        }
      }
    } finally {
      freeResidents();
    }
  });

  it('water stage with lists that are not ensureWaterList output runs the original semantics (wasm reports, JS runs)', { timeout: 600000 }, () => {
    const r = rng(9);
    const stats: FieldsBindStats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
    const W = makeFieldKernels(fieldKernelsJs, { wasm: loaderWasm(), stats });
    const N = 8, C = 64;
    const wm = Uint8Array.from({ length: C }, () => (r() < 0.4 ? 1 : 0));
    const lists = orig.origWaterList(N, wm, BANK_DIST, DX, DZ);
    for (const bad of ['water slot >= nW', 'land slot >= C', 'water cell < 0', 'bank >= C']) {
      const nb = lists.waterNb.slice(), cells = lists.waterCells.slice(), bank = lists.bankCells.slice();
      if (bad === 'water slot >= nW') nb[1] = lists.nWater + 3;
      if (bad === 'land slot >= C') nb[2] = -C - 7;
      if (bad === 'water cell < 0') cells[0] = -1;
      if (bad === 'bank >= C') { if (!bank.length) continue; bank[0] = C + 1; }
      const tmp = f32(C, 'noise', r), tmp2 = f32(C, 'unit', r), L = f32(C, 'unit', r), ground = f32(C, 'unit', r);
      const o = { tmp: tmp.slice(), tmp2: tmp2.slice(), L: L.slice(), ground: ground.slice() };
      orig.origStageBAfterBlur({ C, ...o, wm, alpha: 0.35, WATER_K: 2, BANK_COUPLING: 0.6, nW: lists.nWater, waterCells: cells, waterNb: nb, bankCells: bank, bankSrc: lists.bankSrc });
      const jsBefore = stats.jsCalls;
      const p: WaterArgs = { C, tmp, tmp2, L, ground, water: wm, waterCells: cells, nW: lists.nWater, waterNb: nb, bankCells: bank, bankSrc: lists.bankSrc, invK: 0.5, alpha: 0.35, bankCoupling: 0.6 };
      W.water(p);
      expect(stats.jsCalls, bad).toBe(jsBefore + 1);
      for (const key of ['L', 'ground', 'tmp', 'tmp2'] as const) expectSame(`${bad} ${key}`, o[key], p[key]);
    }
  });

  it('soil stock', { timeout: 600000 }, () => {
    const r = rng(0x5011);
    const W = wasmKernels();
    try {
      for (const N of [1, 2, 3, 9, 32]) for (let rep = 0; rep < 8; rep++) {
        const C = N * N;
        const soil = f32(C, pick(KINDS, r), r), src = f32(C, pick(KINDS, r), r);
        const dt = pick([0.4, 2, 1e-9, 0.4], r), decay = pick([1, 3, 0, 1e6], r);
        const a = soil.slice();
        orig.origSoil(a, src, C, dt, decay, 0.015, 0.002);
        const grow = 0.015 * dt, keep = Math.max(0, 1 - 0.002 * dt * decay);
        for (const [label, k, res] of [['fair JS', fieldKernelsJs, false], ['wasm staged', W, false], ['wasm resident', W, true]] as const) {
          const b = res ? resident(soil) : soil.slice();
          k.soil(b, res ? resident(src) : src, C, grow, keep);
          expectSame(`${label} soil N=${N} rep ${rep}`, a, b);
        }
        freeResidents();
      }
    } finally {
      freeResidents();
    }
  });

  it('arguments outside the kernels\' domain run JS with the same results (and forced wasm runs wasm)', { timeout: 600000 }, () => {
    const stats: FieldsBindStats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
    const W = makeFieldKernels(fieldKernelsJs, { wasm: loaderWasm(), stats });
    const r = rng(3);
    const C = 25;
    const field = f32(C, 'unit', r);
    // non-positive / non-finite scale -> JS
    for (const invK of [0, -1, Infinity, NaN]) {
      const a = f32(C, 'unit', r), b = a.slice();
      orig.origSaturate(field, a, C, invK, 0.35, null);
      W.saturate(field, b, C, invK, 0.35, null);
      expectSame(`invK ${invK}`, a, b);
    }
    expect(stats.jsCalls).toBe(4);
    // L overlapping the field (same buffer) -> JS
    const buf = new Float32Array(2 * C);
    buf.set(field);
    const a = buf.slice();
    orig.origSaturate(a.subarray(0, C), a.subarray(C / 5 | 0, (C / 5 | 0) + C), C, 1 / 3, 0.35, null);
    W.saturate(buf.subarray(0, C), buf.subarray(C / 5 | 0, (C / 5 | 0) + C), C, 1 / 3, 0.35, null);
    expectSame('overlap', a, buf);
    expect(stats.jsCalls).toBe(5);
    // arrays too short -> JS; C = 0 -> wasm, nothing written
    W.soil(new Float32Array(3), new Float32Array(2), 3, 0.1, 0.9);
    expect(stats.jsCalls).toBe(6);
    W.soil(new Float32Array(0), new Float32Array(0), 0, 0.1, 0.9);
    expect(stats.jsCalls).toBe(6);
  });
});

// ================================================================================================= 3. live modules
/**
 * a small but complete test city: the stress city with an interior river (a vertical channel crossed by avenues /
 * highways, which become bridges) and a lake (both cleared of roads and buildings), rail with level crossings, highway
 * bridges / tunnels elsewhere, a landfill zone next to a road
 */
function testCity(size = 96, seed = 7): CityState {
  const { st } = stressCity(size, seed);
  const N = st.size;
  const clear = (x: number, z: number): boolean => {
    const i = z * N + x;
    if (st.network[i] === Network.Highway || st.network[i] === Network.Avenue) { st.netFlags[i] |= 1; return false; }
    const id = st.building[i];
    if (id >= 0) {
      const b = st.buildings.get(id);
      if (b) for (let zz = b.z; zz < b.z + b.d; zz++) for (let xx = b.x; xx < b.x + b.w; xx++) st.building[zz * N + xx] = -1;
      st.buildings.delete(id);
    }
    st.network[i] = 0; st.netFlags[i] = 0; st.zone[i] = 0;
    return true;
  };
  const rx = Math.floor(N * 0.35);
  for (let z = 6; z < N - 6; z++) for (let x = rx; x < rx + 3; x++) if (clear(x, z)) st.water[z * N + x] = 1;
  const lx = Math.floor(N * 0.6), lz = Math.floor(N * 0.2);
  for (let z = lz; z < lz + 9; z++) for (let x = lx; x < lx + 9; x++) if (clear(x, z)) st.water[z * N + x] = 1;
  // highway tunnels / bridges elsewhere, a rail line with level crossings
  let hw = 0;
  for (let i = 0; i < st.cells; i++) if (st.network[i] === Network.Highway && !(st.netFlags[i] & 1)) { hw++; if (hw % 7 === 0) st.netFlags[i] |= 1; if (hw % 11 === 0) st.netFlags[i] |= 2; }
  const rz = 3 * Math.floor(N / 3 / 4) + 1;
  for (let x = 0; x < N; x++) {
    const i = rz * N + x;
    if (st.network[i] === Network.Street || st.network[i] === Network.Road) {
      if (x % 3 === 1) st.netFlags[i] |= 0x20;
      else st.network[i] = Network.Rail;
    }
  }
  // a landfill next to a road
  for (let z = N - 12; z < N - 4; z++) for (let x = 4; x < 12; x++) {
    const i = z * N + x;
    if (st.network[i] === 0 && st.building[i] < 0 && !st.water[i]) st.zone[i] = Zone.Landfill;
  }
  return st;
}

describe('live modules: nimby.ts vs makeNimby, PollutionSystem vs installFieldPasses', () => {
  it('rebuildNimby: outputs and scheduler cost identical across network and building edits', { timeout: 600000 }, () => {
    const st = testCity(96, 11);
    const sim = new Simulation(st, createSystems());
    for (let d = 0; d < 6; d++) sim.advanceDay();
    const stats: FieldsBindStats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
    const impls = [makeNimby(fieldKernelsJs), makeNimby(wasmKernels(stats)), makeNimby(fieldKernelsJs, { cacheCorridor: false }), makeNimby(wasmKernels(stats), { cacheCorridor: false })];
    const N = st.size;
    for (let round = 0; round < 5; round++) {
      if (round === 2) for (let x = 0; x < N; x += 2) st.network[5 * N + x] = Network.Highway; // new highway
      if (round === 3) { for (let i = 0; i < st.cells; i++) if (st.network[i] === Network.Highway && i % 5 === 0) st.netFlags[i] ^= 3; }
      if (round === 4) { for (const b of [...st.buildings.values()].slice(0, 40)) b.flags |= BF.Abandoned; st.landfillFill.fill(0.5); }
      rebuildNimby(sim);
      const ref = { S: st.stigma.slice(), P: st.prestige.slice(), K: st.campus.slice(), cost: nimbyCost(sim) };
      for (const [k, impl] of impls.entries()) {
        st.stigma.fill(-1); st.prestige.fill(-1); st.campus.fill(-1);
        impl.rebuildNimby(sim);
        expectSame(`round ${round} impl ${k} stigma`, ref.S, st.stigma);
        expectSame(`round ${round} impl ${k} prestige`, ref.P, st.prestige);
        expectSame(`round ${round} impl ${k} campus`, ref.K, st.campus);
        expect(impl.nimbyCost(sim), `round ${round} impl ${k} cost`).toBe(ref.cost);
      }
    }
    expect(stats.jsCalls).toBe(0);
    for (const i of impls) i.release(st);
  });

  it('PollutionSystem: every step of 4 passes identical (genuine vs fair JS vs wasm resident / staged)', { timeout: 900000 }, () => {
    const w = loaderWasm();
    w.heap.reserve(32 << 20);
    const adopted: { release(): void }[] = [];
    const mk = (res: boolean) => {
      const st = testCity(80, 5);
      if (res) adopted.push(adoptLayers(st, w.heap, { reserveExtra: 8 << 20 }));
      const sim = new Simulation(st, createSystems());
      for (let d = 0; d < 4; d++) sim.advanceDay();
      return sim;
    };
    const sims: Sim[] = [mk(false), mk(false), mk(true), mk(false)];
    const stats: FieldsBindStats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
    const pols = sims.map((s) => s.getSystem('pollution') as unknown as PollutionSystem & Record<string, unknown>);
    installFieldPasses(pols[1], fieldKernelsJs);
    installFieldPasses(pols[2], wasmKernels(stats));
    installFieldPasses(pols[3], wasmKernels(stats));
    adopted.unshift(adoptPollutionArrays(pols[2] as unknown as PollutionSystem, w.heap));
    try {
      const arrays = (p: Record<string, unknown>, st: CityState): [string, Float32Array][] => [
        ['air0', (p.air as Float32Array[])[0]], ['air1', (p.air as Float32Array[])[1]], ['air2', (p.air as Float32Array[])[2]],
        ['waterS0', (p.waterS as Float32Array[])[0]], ['waterS1', (p.waterS as Float32Array[])[1]], ['noiseS0', (p.noiseS as Float32Array[])[0]],
        ['noiseS1', (p.noiseS as Float32Array[])[1]], ['soilSrc', p.soilSrc as Float32Array], ['ground', p.ground as Float32Array],
        ['airPollution', st.airPollution], ['noise', st.noise], ['waterPollution', st.waterPollution], ['soil', st.soil], ['treeCover', st.treeCover],
        ['landfillFill', st.landfillFill], ['garbage', st.garbage],
      ];
      for (let pass = 0; pass < 4; pass++) {
        for (const [k, p] of pols.entries()) { (p as unknown as { lastRun: number }).lastRun = sims[k].state.day - 12; (p as unknown as { stepIdx: number }).stepIdx = -1; }
        for (let step = 0; step < 10; step++) {
          for (const [k, p] of pols.entries()) p.step(sims[k]);
          const ref = arrays(pols[0], sims[0].state);
          for (let k = 1; k < 4; k++) {
            const got = arrays(pols[k], sims[k].state);
            for (let j = 0; j < ref.length; j++) expectSame(`pass ${pass} step ${step} arm ${k} ${ref[j][0]}`, ref[j][1], got[j][1]);
            const used = (q: object) => Array.from((q as { usedCls: Uint8Array }).usedCls);
            expect(used(pols[k]), `pass ${pass} step ${step} used`).toEqual(used(pols[0]));
            expect(JSON.stringify(sims[k].state.stats)).toBe(JSON.stringify(sims[0].state.stats));
          }
        }
        // the water body diffuses: the test city has one
        expect((pols[0] as unknown as { nWater: number }).nWater).toBeGreaterThan(50);
      }
      expect(stats.jsCalls).toBe(0);
      expect(stats.wasmCalls).toBeGreaterThan(30);
    } finally {
      for (const a of adopted) a.release();
    }
  });
});

// ================================================================================================= 4. fixtures
describe('profiler fixtures (1M-population captures)', () => {
  const dirs = [process.env.FIELDPASSES_CAPTURE_DIR, join(ROOT, 'node_modules', '.cache', 'sim-bench', 'fieldPasses')].filter((d): d is string => !!d && existsSync(d));
  const caps = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.cap')).map((f) => join(d, f)));
  it.skipIf(caps.length === 0)(`every arm bit-exact on every case: ${caps.map((f) => f.split('/').pop()).join(', ') || 'none found'}`, { timeout: 900000 }, () => {
    const w = loaderWasm();
    for (const file of caps) {
      const cap = core.decodeCapture(new Uint8Array(readFileSync(file)));
      const arms = [core.origArm(cap), core.fairArm(cap), core.wasmArm(cap, w, 'wasm resident', true), core.wasmArm(cap, w, 'wasm staged', false)];
      try {
        core.checkArms(arms);
        // and the captured genuine rebuildNimby
        arms[2].run('nimby');
        const o = arms[2].outputs('nimby');
        expectSame(`${cap.meta.name} stigma`, cap.arrays['nimby.expS'] as Float32Array, o.S as Float32Array);
        expectSame(`${cap.meta.name} prestige`, cap.arrays['nimby.expP'] as Float32Array, o.P as Float32Array);
        expectSame(`${cap.meta.name} campus`, cap.arrays['nimby.expK'] as Float32Array, o.K as Float32Array);
        expect(o.touches).toBe(cap.meta.nimby.touches);
      } finally {
        for (const a of arms) a.dispose();
      }
    }
  });
});

// ================================================================================================= 5. whole city
describe('whole city: 120 days with the field passes swapped in', () => {
  it('genuine vs genuine (baseline), fair JS, wasm resident, wasm staged: bit-identical layers and stats', { timeout: 1800000 }, () => {
    const reg = (globalThis as { __nimbySwitch?: WeakMap<object, unknown> }).__nimbySwitch!;
    const w = loaderWasm();
    const stats: FieldsBindStats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
    const arms: { label: string; sim: Sim; release?: () => void }[] = [];
    for (const label of ['genuine A', 'genuine B', 'fair JS', 'wasm resident', 'wasm staged']) {
      const st = testCity(72, 3);
      let kernels: FieldKernels | null = null;
      if (label === 'fair JS') kernels = fieldKernelsJs;
      if (label.startsWith('wasm')) kernels = wasmKernels(stats);
      const releases: (() => void)[] = [];
      if (kernels) {
        const impl = makeNimby(kernels);
        reg.set(st, impl);
        releases.push(() => impl.release(st));
      }
      if (label === 'wasm resident') { w.heap.reserve(24 << 20); const a = adoptLayers(st, w.heap, { reserveExtra: 8 << 20 }); releases.push(() => a.release()); }
      const sim = new Simulation(st, createSystems());
      if (kernels) {
        const pol = sim.getSystem('pollution') as unknown as PollutionSystem;
        installFieldPasses(pol, kernels);
        if (label === 'wasm resident') { const a = adoptPollutionArrays(pol, w.heap); releases.unshift(() => a.release()); }
      }
      arms.push({ label, sim, release: () => { for (const f of releases) f(); } });
    }
    const layers = (st: object) => Object.entries(st).flatMap(([k, v]) => (ArrayBuffer.isView(v) ? [[k, v] as const]
      : Array.isArray(v) && v.length && v.every((x) => ArrayBuffer.isView(x)) ? (v as ArrayBufferView[]).map((x, i) => [`${k}[${i}]`, x] as const) : []));
    const compare = (day: number) => {
      const ref = new Map(layers(arms[0].sim.state));
      for (const a of arms.slice(1)) {
        for (const [k, v] of layers(a.sim.state)) {
          const u = ref.get(k)!;
          const x = new Uint8Array(u.buffer, u.byteOffset, u.byteLength), y = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
          let d = -1;
          for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { d = i; break; }
          expect(d, `day ${day}: ${a.label} layer ${k} differs at byte ${d}`).toBe(-1);
        }
        expect(JSON.stringify(a.sim.state.stats), `day ${day}: ${a.label} stats`).toBe(JSON.stringify(arms[0].sim.state.stats));
      }
    };
    try {
      for (let d = 1; d <= 120; d++) {
        for (const a of arms) { a.sim.advanceDay(); if (d % 3 === 0) schedulerOf(a.sim).flush(a.sim); }
        if (d % 30 === 0) compare(d);
      }
      expect(stats.jsCalls).toBe(0);
      expect(stats.wasmCalls).toBeGreaterThan(20);
    } finally {
      for (const a of arms) a.release?.();
    }
  });
});
