/**
 * Equivalence of the desirability / land-value band kernels (wasm/sim-kernels/src/econ.rs via
 * src/wasm/kernels/desirabilityLandValueBandsBind.ts) with the 24f8609 JS original (tests/wasm/econBandsOriginal.ts,
 * verbatim) and the fair JS (src/wasm/js/desirabilityLandValueBands.ts). Everything must be BIT-identical: the 12
 * desirability layers and the land value (uint32 patterns, NaN == NaN) and the 4 land-value accumulators (f64 bits),
 * compared after EVERY band of zoned sweeps, allCells sweeps and land-value sweeps, for the original, the fair JS, the
 * wasm kernels on resident layers (in wasm memory, zero copy) and on staged layers (plain arrays):
 *  - random states: sizes 1..64 (N not divisible by COARSE, map edges), value kinds (noise, ±0, subnormals, 1e±30,
 *    ±Infinity, NaN), network / water / zone mixes incl. network codes outside the tables, all infra-flag combinations,
 *    daily / random / whole-map band splits;
 *  - edge cases: empty map, all water, all roads, no roads (isolated zones), landfill-only, zero / huge values,
 *    avgCommute 0 / NaN / huge, a zone code that is not a zone (same TypeError at the same cell, same partial writes);
 *  - real layers: the live stress city after some days, and the profiler's 1M-population fixtures (captures written by
 *    tools/bench/desirabilityLandValueBands.bench.mjs; skipped when absent);
 *  - the binding: JS preference / forced wasm, arguments outside the kernel domain (-> JS), zero copy, mixed staging;
 *  - the whole city: a city simulated by the genuine systems vs. by the 24f8609 shells running the original / fair JS /
 *    wasm staged / wasm resident bands — bit-identical every day and after 120 days (after a JS-vs-JS baseline).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import type { CityState } from '../../src/sim/CityState';
import type { EconRuntime } from '../../src/sim/economy/runtime';
import { infraFlags } from '../../src/sim/economy/runtime';
import { setSimWasmPreference, simWasmInstance, simWasmStatus } from '../../src/wasm/simWasm';
import { adoptLayers } from '../../src/wasm/layers';
import type { EconBandFns } from '../../src/wasm/js/desirabilityLandValueBands';
import {
  ECON_TABLES, econBandsJs, econBandsWasm, installEconBands, makeEconBandKernels, type EconBindStats, type EconWasm,
} from '../../src/wasm/kernels/desirabilityLandValueBands';
import { makeOriginalBands } from './econBandsOriginal';
import {
  RT_LAYERS, ST_LAYERS, bandsOf, captureFrom, checkArms, decodeCapture, diffArms, fixedArm, oneBand, origArm, wasmArm,
  type Arm, type EconCapture, type Layer,
} from '../../tools/bench/desirabilityLandValueBands/core';
import { stressCity } from '../infra/cityGen';

const ROOT = resolve(__dirname, '..', '..');

function loaderWasm(): EconWasm {
  const w = simWasmInstance();
  if (!w) throw new Error('wasm unavailable: ' + simWasmStatus().error);
  return { ex: w.exports as unknown as EconWasm['ex'], heap: w.heap };
}

// ------------------------------------------------------------------------------------------------ random states
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

type Kind = 'unit' | 'noise' | 'wide' | 'special' | 'zero' | 'negzero' | 'huge';
const KINDS: Kind[] = ['unit', 'noise', 'wide', 'special', 'zero', 'negzero', 'huge'];

function value(kind: Kind, r: () => number): number {
  const u = r();
  switch (kind) {
    case 'unit': return u;
    case 'noise': return u * 3 - 1;
    // magnitudes 1e-40 (subnormal f32) .. 1e30, both signs, zeros and -0
    case 'wide': return u < 0.1 ? (u < 0.05 ? 0 : -0) : (r() < 0.5 ? -1 : 1) * Math.exp((r() * 2 - 1) * 70);
    case 'special': {
      const k = (u * 12) | 0;
      return [NaN, Infinity, -Infinity, 0, -0, 1e-40, -1e-42, 3.4e38, -3.4e38, r(), -r(), 1][k];
    }
    case 'zero': return 0;
    case 'negzero': return -0;
    case 'huge': return (r() < 0.5 ? -1 : 1) * 1e30 * (1 + r());
  }
}

function f32(n: number, kind: Kind, r: () => number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = value(kind, r);
  return a;
}
function f32range(n: number, lo: number, hi: number, r: () => number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = lo + (hi - lo) * r();
  return a;
}

interface Profile {
  kind: Kind;
  /** probability of a road cell; roadCodes 'valid' = 1..6, 'any' = 1..255 (codes outside NET_NOISE / NET_TRAFFIC) */
  roads: number;
  roadCodes: 'valid' | 'any';
  water: number;
  /** zone mix: 'mixed' (None / 1..9 / Landfill), 'none', 'landfill', 'zoned' (1..9 only) */
  zones: 'mixed' | 'none' | 'landfill' | 'zoned';
  heights: Kind | 'flat';
  flags: { traffic: boolean; pollution: boolean; services: boolean } | null;
  avgCommute: number;
  shiftKind: Kind | 'small';
}

function randomCapture(N: number, seed: number, p: Profile): EconCapture {
  const r = rng(seed);
  const nn = N * N;
  const cw = Math.ceil(N / 8);
  const cc = cw * cw;
  const zone = new Uint8Array(nn), network = new Uint8Array(nn), water = new Uint8Array(nn), building = new Int32Array(nn).fill(-1);
  for (let i = 0; i < nn; i++) {
    const u = r();
    zone[i] = p.zones === 'none' ? 0 : p.zones === 'landfill' ? 10 : p.zones === 'zoned' ? 1 + ((r() * 9) | 0)
      : u < 0.3 ? 0 : u < 0.35 ? 10 : 1 + ((r() * 9) | 0);
    if (r() < p.roads) network[i] = p.roadCodes === 'valid' ? 1 + ((r() * 6) | 0) : 1 + ((r() * 255) | 0);
    if (r() < p.water) water[i] = r() < 0.8 ? 1 : 2 + ((r() * 254) | 0);
    if (r() < 0.3) building[i] = (r() * 1e6) | 0;
  }
  const layers: Record<string, Layer> = {
    zone, network, water, building,
    heights: p.heights === 'flat' ? new Float32Array((N + 1) * (N + 1)) : p.heights === 'unit' ? f32range((N + 1) * (N + 1), 0, 60, r) : f32((N + 1) * (N + 1), p.heights, r),
  };
  for (const k of ST_LAYERS) if (!(k in layers)) layers[k] = p.kind === 'unit' && k === 'traffic' ? f32range(nn, 0, 4000, r) : p.kind === 'unit' && k === 'commute' ? f32range(nn, -5, 120, r) : f32(nn, p.kind, r);
  for (let d = 0; d < 12; d++) {
    const a = f32(nn, p.kind, r);
    for (let i = 0; i < nn; i++) if (r() < 0.2) a[i] = -1;
    layers['des' + d] = a;
  }
  layers.coarsePop = p.kind === 'unit' ? f32range(cc, 0, 20000, r) : f32(cc, p.kind, r);
  layers.coarseFreight = p.kind === 'unit' ? f32range(cc, 0, 1, r) : f32(cc, p.kind, r);
  layers.coarseWealth = p.kind === 'unit' ? f32range(cc, -1, 1, r) : f32(cc, p.kind, r);
  layers.lvStatic = p.kind === 'unit' ? f32range(nn, 0, 0.4, r) : f32(nn, p.kind, r);
  layers.lvEffects = p.kind === 'unit' ? f32range(nn, -1, 1, r) : f32(nn, p.kind, r);
  layers.lvLandfill = p.kind === 'unit' ? f32range(nn, -0.5, 0.5, r) : f32(nn, p.kind, r);
  const shift = p.shiftKind === 'small' ? f32range(12, -0.2, 0.2, r) : f32(12, p.shiftKind, r);
  const systemData = p.flags ? { infraVersion: 1, infraLayers: { utilities: true, ...p.flags } } : {};
  return { name: `random N=${N} seed=${seed}`, N, cw, day: 0, population: 0, avgCommute: p.avgCommute, systemData, shift, layers };
}

function randomBands(N: number, r: () => number): [number, number][] {
  const out: [number, number][] = [];
  let z = 0;
  while (z < N) {
    const z1 = Math.min(N, z + 1 + ((r() * Math.max(1, N / 3)) | 0));
    out.push([z, z1]);
    z = z1;
  }
  return out;
}

let live: Arm[] = [];
afterEach(() => {
  for (const a of live) a.dispose();
  live = [];
  setSimWasmPreference('auto');
});

function armsOf(c: EconCapture): Arm[] {
  const w = loaderWasm();
  live = [origArm(c), fixedArm(c, ECON_TABLES), wasmArm(c, ECON_TABLES, w, 'wasm resident', true), wasmArm(c, ECON_TABLES, w, 'wasm staged', false)];
  return live;
}

/** all arms bit-identical over the daily split, a random split and one whole-map band (init), each for 3 sweeps */
function checkCapture(c: EconCapture, seed = 1): Arm[] {
  const arms = armsOf(c);
  checkArms(arms, c.N);
  checkArms(arms, c.N, randomBands(c.N, rng(seed * 31 + 7)));
  checkArms(arms, c.N, [[0, c.N]]);
  return arms;
}

const BASE: Profile = {
  kind: 'unit', roads: 0.3, roadCodes: 'valid', water: 0.05, zones: 'mixed', heights: 'unit',
  flags: { traffic: true, pollution: true, services: true }, avgCommute: 22.5, shiftKind: 'small',
};

describe('desirability / land-value bands: kernel equivalence', () => {
  it('random states: sizes, value kinds, infra flags, band splits', { timeout: 600000 }, () => {
    let cases = 0;
    const sizes = [1, 2, 3, 7, 8, 9, 17, 40, 64];
    const flagSets: (Profile['flags'])[] = [null];
    for (let m = 0; m < 8; m++) flagSets.push({ traffic: (m & 1) !== 0, pollution: (m & 2) !== 0, services: (m & 4) !== 0 });
    let seed = 1;
    for (const N of sizes) {
      for (const kind of KINDS) {
        const flags = flagSets[seed % flagSets.length];
        const heights: Profile['heights'] = kind === 'unit' ? 'unit' : seed % 3 === 0 ? 'flat' : kind;
        const c = randomCapture(N, seed, {
          ...BASE, kind, flags, heights, roadCodes: seed % 2 ? 'valid' : 'any', shiftKind: kind === 'unit' ? 'small' : kind,
          avgCommute: [22.5, 0, NaN, -3, 1e300, 12, 80, 6.333303093984793][seed % 8],
        });
        checkCapture(c, seed);
        for (const a of live) a.dispose();
        live = [];
        cases++;
        seed++;
      }
    }
    // every flag combination on one mid-size map
    for (const flags of flagSets) {
      checkCapture(randomCapture(33, 1000 + cases, { ...BASE, flags }), cases);
      for (const a of live) a.dispose();
      live = [];
      cases++;
    }
    expect(cases).toBe(sizes.length * KINDS.length + flagSets.length);
  });

  it('edge cases: empty map, all water, all roads, no roads, landfill only, zero / huge values', { timeout: 300000 }, () => {
    const scenarios: [string, Partial<Profile>][] = [
      ['empty map (unzoned, no roads, no water, zeros)', { zones: 'none', roads: 0, water: 0, kind: 'zero', heights: 'flat' }],
      ['all water', { water: 1 }],
      ['all roads, valid codes', { roads: 1 }],
      ['all roads, any codes', { roads: 1, roadCodes: 'any' }],
      ['no roads (isolated zones: no neighbour roads anywhere)', { roads: 0, water: 0, zones: 'zoned' }],
      ['landfill only (unzoned)', { zones: 'landfill', roads: 0.1 }],
      ['zero values, no infra', { kind: 'zero', flags: null, heights: 'flat' }],
      ['-0 everywhere', { kind: 'negzero', heights: 'negzero', shiftKind: 'negzero' }],
      ['huge values', { kind: 'huge', heights: 'huge', shiftKind: 'huge', avgCommute: 1e30 }],
      ['special values (NaN / ±Inf / subnormal)', { kind: 'special', heights: 'special', shiftKind: 'special', avgCommute: NaN }],
      ['avgCommute 0 (fallback), traffic off', { avgCommute: 0, flags: { traffic: false, pollution: true, services: true } }],
    ];
    let k = 0;
    for (const [name, p] of scenarios) {
      for (const N of [1, 5, 24]) {
        const c = randomCapture(N, 500 + k++, { ...BASE, ...p });
        c.name = `${name}, N=${N}`;
        try {
          checkCapture(c, k);
        } catch (e) {
          throw new Error(`${c.name}: ${(e as Error).message}`);
        } finally {
          for (const a of live) a.dispose();
          live = [];
        }
      }
    }
  });

  it('a zone code that is not a zone: the same TypeError at the same cell, the same partial writes', { timeout: 120000 }, () => {
    const N = 20;
    for (const bad of [11, 57, 255]) {
      const c = randomCapture(N, bad, { ...BASE, roads: 0.2 });
      const cell = 7 * N + 13;
      (c.layers.zone as Uint8Array)[cell] = bad;
      (c.layers.network as Uint8Array)[cell] = 0;
      (c.layers.water as Uint8Array)[cell] = 0;
      const w = loaderWasm();
      const stats: EconBindStats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
      const orig = origArm(c), fixed = fixedArm(c, ECON_TABLES);
      const resident = wasmArm(c, ECON_TABLES, w, 'resident', true), staged = wasmArm(c, ECON_TABLES, w, 'staged', false);
      live = [orig, fixed, resident, staged];
      // the binding reruns the band in (fair) JS after the kernel stops at the cell: bind with a JS fallback here
      const withJs = (a: Arm): Arm => {
        const b = makeEconBandKernels(ECON_TABLES, econBandsJs, { wasm: w, stats });
        return { ...a, desirability: (z0, z1, all) => b.desirability(a.state.st, a.state.rt, infraFlags(a.state.st), a.state.shift, z0, z1, all) };
      };
      const arms = [orig, fixed, withJs(resident), withJs(staged)];
      for (const all of [false, true]) {
        const msgs = arms.map((a) => {
          try { a.desirability(0, N, all); return 'no error'; } catch (e) { return `${(e as Error).constructor.name}: ${(e as Error).message}`; }
        });
        expect(msgs[0]).toMatch(/^TypeError/);
        expect(msgs).toEqual([msgs[0], msgs[0], msgs[0], msgs[0]]);
        for (let k = 1; k < arms.length; k++) expect(diffArms(arms[0], arms[k]), `${arms[k].label} bad=${bad}`).toBe('');
      }
      expect(stats.jsCalls).toBe(4);
      // the land-value band does not look at zone codes beyond "not None": no error, bit-identical
      checkArms([orig, fixed, resident, staged], N, bandsOf(N), ['lv']);
      for (const a of live) a.dispose();
      live = [];
    }
  });
});

describe('desirability / land-value bands: real layers', () => {
  it('the live stress city after 12 days', { timeout: 900000 }, () => {
    const city = stressCity(256);
    const sim = new Simulation(city.st, createSystems());
    for (let d = 0; d < 12; d++) sim.advanceDay();
    const rt = (sim.systems.find((s) => s.name === 'economy.population') as unknown as { rt: EconRuntime }).rt;
    const c = captureFrom('stress256', sim.state, rt);
    const arms = checkCapture(c);
    // the kernels really ran (resident: zero copy; staged: band rows copied)
    expect(arms[2].stats!.wasmCalls).toBeGreaterThan(0);
    expect(arms[2].stats!.bytesIn + arms[2].stats!.bytesOut).toBe(0);
    expect(arms[3].stats!.bytesIn).toBeGreaterThan(0);
    expect(arms[2].stats!.jsCalls + arms[3].stats!.jsCalls).toBe(0);
  });

  // captures of the profiler fixtures after 20 warm days (written by the benchmark into node_modules/.cache/sim-bench/econ)
  const capDirs = [process.env.ECON_CAPTURE_DIR, join(ROOT, 'node_modules', '.cache', 'sim-bench', 'econ')].filter((d): d is string => !!d && existsSync(d));
  const caps = capDirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.cap')).map((f) => join(d, f)));
  it.skipIf(caps.length === 0)(`profiler fixtures (1M-population captures): ${caps.map((f) => f.split('/').pop()).join(', ') || 'none found'}`, { timeout: 900000 }, () => {
    for (const f of caps) {
      const c = decodeCapture(new Uint8Array(readFileSync(f)));
      checkCapture(c);
      for (const a of live) a.dispose();
      live = [];
    }
  });
});

describe('desirability / land-value bands: binding', () => {
  it("JS preference, forced wasm, domain checks, zero copy and mixed staging", { timeout: 120000 }, () => {
    const c = randomCapture(48, 77, BASE);
    const orig = origArm(c);
    const w = loaderWasm();
    const mk = (label: string, resident: boolean, fallback: EconBandFns) => {
      const a = wasmArm(c, ECON_TABLES, w, label, resident);
      const stats: EconBindStats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
      const b = makeEconBandKernels(ECON_TABLES, fallback, { stats });
      const arm: Arm = {
        ...a,
        stats,
        desirability: (z0, z1, all) => b.desirability(a.state.st, a.state.rt, infraFlags(a.state.st), a.state.shift, z0, z1, all),
        landValue: (z0, z1, first) => b.landValue(a.state.st, a.state.rt, infraFlags(a.state.st), z0, z1, first, a.state.acc),
      };
      return arm;
    };
    const staged = mk('staged', false, econBandsJs);
    const resident = mk('resident', true, econBandsJs);
    live = [orig, staged, resident];
    // 1. 'js' preference: the loader slot is off, every call runs the fair JS
    setSimWasmPreference('js', 'econ');
    checkArms([orig, staged, resident], c.N);
    expect(staged.stats!.wasmCalls + resident.stats!.wasmCalls).toBe(0);
    expect(staged.stats!.jsCalls).toBeGreaterThan(0);
    // 2. forced wasm
    setSimWasmPreference('wasm', 'econ');
    const js0 = staged.stats!.jsCalls;
    checkArms([orig, staged, resident], c.N);
    expect(staged.stats!.jsCalls).toBe(js0);
    expect(resident.stats!.wasmCalls).toBeGreaterThan(0);
    expect(resident.stats!.bytesIn + resident.stats!.bytesOut).toBe(0);
    setSimWasmPreference('auto', 'econ');
    // 3. arguments outside the kernel domain run JS (and stay bit-identical to the original)
    const jsBefore = staged.stats!.jsCalls;
    for (const [z0, z1] of [[-1, 3], [2.5, 7], [40, 60]] as [number, number][]) {
      for (const a of [orig, staged]) a.desirability(z0, z1, true);
      for (const a of [orig, staged]) a.landValue(z0, z1, false);
      expect(diffArms(orig, staged)).toBe('');
    }
    expect(staged.stats!.jsCalls - jsBefore).toBe(6);
    // an empty band does nothing (in both)
    for (const a of [orig, staged]) { a.desirability(5, 5, true); a.landValue(9, 3, false); }
    expect(diffArms(orig, staged)).toBe('');
    // a runtime whose coarse width disagrees with the map runs JS
    const rt = staged.state.rt as unknown as { cw: number };
    rt.cw += 1;
    const js1 = staged.stats!.jsCalls;
    staged.desirability(0, 4, false);
    expect(staged.stats!.jsCalls).toBe(js1 + 1);
    rt.cw -= 1;
    // 4. mixed: CityState layers resident, EconRuntime arrays plain (staged) -> only those are copied
    const mixed = mk('mixed', true, econBandsJs);
    live.push(mixed);
    const mrt = mixed.state.rt as unknown as Record<string, Layer>;
    for (const k of RT_LAYERS) mrt[k] = mrt[k].slice();
    const fresh = origArm(c);
    live.push(fresh);
    checkArms([fresh, mixed], c.N);
    expect(mixed.stats!.wasmCalls).toBeGreaterThan(0);
    const cc = c.cw * c.cw;
    expect(mixed.stats!.bytesIn).toBeGreaterThan(0);
    expect(mixed.stats!.bytesOut).toBe(0);
    expect(mixed.stats!.bytesIn % 4).toBe(0);
    expect(mixed.stats!.bytesIn).toBeLessThan(40 * (c.N * c.N * 4 + cc * 4));
  });
});

// ------------------------------------------------------------------------------------------------ whole city
const FROZEN = {
  desirability: '15e9d50bae9609dc95bf4e356630f8caad375e933b650fd31c291e0584f8ad42',
  landValue: 'd75db40b99b1cd6a2bb0881a7746e63ca8a807d35eea5f87aec4bf1849aa933f',
};
/** the live files are still the 24f8609 versions (then the genuine systems are the reference too) */
const liveIsFrozen = (['desirability', 'landValue'] as const).every(
  (f) => createHash('sha256').update(readFileSync(join(ROOT, 'src', 'sim', 'economy', `${f}.ts`))).digest('hex') === FROZEN[f],
);

/** EconBandFns over the verbatim 24f8609 closures */
function originalBandFns(): EconBandFns {
  let ob: ReturnType<typeof makeOriginalBands> | null = null;
  let obRt: EconRuntime | null = null;
  const get = (rt: EconRuntime) => { if (obRt !== rt) { ob = makeOriginalBands(rt); obRt = rt; } return ob!; };
  return {
    desirability(st, rt, _inf, shift, z0, z1, all) {
      const o = get(rt as EconRuntime);
      o.shift.set(shift);
      o.desirability(st as CityState, z0, z1, all);
    },
    landValue(st, rt, _inf, z0, z1, first, acc) {
      const o = get(rt as EconRuntime);
      o.setAcc(acc[0], acc[1], acc[2], acc[3]);
      o.landValue(st as CityState, z0, z1, first);
      const a = o.acc();
      acc[0] = a[0]; acc[1] = a[1]; acc[2] = a[2]; acc[3] = a[3];
    },
  };
}

type CityArm = 'genuine' | 'shell: original' | 'shell: fair JS' | 'shell: wasm staged' | 'shell: wasm resident';

function layerBytes(st: object): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(st)) {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) m.set(k, new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    else if (Array.isArray(v) && v.length && v.every((x) => ArrayBuffer.isView(x))) {
      (v as ArrayBufferView[]).forEach((a, i) => m.set(`${k}[${i}]`, new Uint8Array(a.buffer, a.byteOffset, a.byteLength)));
    }
  }
  return m;
}

function diffCities(a: CityState, b: CityState): string[] {
  const la = layerBytes(a), lb = layerBytes(b);
  const out: string[] = [];
  for (const [k, va] of la) {
    const vb = lb.get(k);
    if (!vb || vb.length !== va.length) { out.push(`${k}: shape`); continue; }
    for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) { out.push(`${k}: byte ${i}`); break; }
  }
  if (JSON.stringify(a.stats) !== JSON.stringify(b.stats)) out.push('stats');
  if (a.buildings.size !== b.buildings.size) out.push('buildings');
  return out;
}

/** today's band outputs: 12 desirability layers + land value + avgLandValue */
function diffBands(a: CityState, b: CityState): string {
  const eq = (x: Float32Array, y: Float32Array) => {
    const ux = new Uint32Array(x.buffer, x.byteOffset, x.length), uy = new Uint32Array(y.buffer, y.byteOffset, y.length);
    for (let i = 0; i < ux.length; i++) if (ux[i] !== uy[i]) return i;
    return -1;
  };
  for (let d = 0; d < 12; d++) { const i = eq(a.desirability[d], b.desirability[d]); if (i >= 0) return `desirability[${d}] at ${i}`; }
  const i = eq(a.landValue, b.landValue);
  if (i >= 0) return `landValue at ${i}`;
  if (!Object.is(a.stats.avgLandValue, b.stats.avgLandValue)) return `avgLandValue ${a.stats.avgLandValue} vs ${b.stats.avgLandValue}`;
  return '';
}

describe('desirability / land-value bands: whole city', () => {
  it(`120 days: genuine systems vs 24f8609 shells with the original / fair JS / wasm bands${liveIsFrozen ? '' : ' (live files changed: shells only)'}`, { timeout: 1800000 }, () => {
    const DAYS = 120;
    const arms: CityArm[] = liveIsFrozen
      ? ['genuine', 'genuine', 'shell: original', 'shell: fair JS', 'shell: wasm staged', 'shell: wasm resident']
      : ['shell: original', 'shell: original', 'shell: fair JS', 'shell: wasm staged', 'shell: wasm resident'];
    const stats: EconBindStats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
    const residentStats: EconBindStats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
    const w = loaderWasm();
    const never: EconBandFns = {
      desirability() { throw new Error('wasm band fell back to JS'); },
      landValue() { throw new Error('wasm band fell back to JS'); },
    };
    const released: (() => void)[] = [];
    const sims = arms.map((arm) => {
      const city = stressCity(128, 11);
      const systems = createSystems();
      if (arm !== 'genuine') {
        const bands = arm === 'shell: original' ? originalBandFns() : arm === 'shell: fair JS' ? econBandsJs
          : makeEconBandKernels(ECON_TABLES, never, { wasm: w, stats: arm === 'shell: wasm resident' ? residentStats : stats });
        expect(installEconBands(systems, bands)).not.toBeNull();
      }
      // resident: the CityState layers move into wasm memory before the systems see them (one reserve, a safe point);
      // the EconRuntime arrays exist only after init (EconRuntime.reset) and move right after it
      let adopted: ReturnType<typeof adoptLayers> | null = null;
      if (arm === 'shell: wasm resident') {
        w.heap.reserve(8 << 20);
        adopted = adoptLayers(city.st, w.heap, { reserveExtra: 4 << 20 });
      }
      const sim = new Simulation(city.st, systems);
      if (adopted) {
        const rt = (systems.find((s) => s.name === 'economy.population') as unknown as { rt: EconRuntime }).rt;
        const b = adoptLayers(rt, w.heap, { include: (k) => (RT_LAYERS as readonly string[]).includes(k) });
        const a = adopted;
        released.push(() => { b.release(); a.release(); });
        Object.assign(residentStats, { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 });
      }
      return { arm, sim };
    });
    try {
      for (let d = 0; d < DAYS; d++) {
        for (const s of sims) s.sim.advanceDay();
        for (let k = 1; k < sims.length; k++) {
          const diff = diffBands(sims[0].sim.state, sims[k].sim.state);
          if (diff) throw new Error(`day ${d + 1}: ${sims[k].arm} vs ${sims[0].arm}: ${diff}`);
        }
      }
      // JS-vs-JS baseline first (the comparison is meaningless if the sim is not deterministic), then every arm
      expect(diffCities(sims[0].sim.state, sims[1].sim.state), 'baseline').toEqual([]);
      for (let k = 2; k < sims.length; k++) expect(diffCities(sims[0].sim.state, sims[k].sim.state), sims[k].arm).toEqual([]);
      expect(stats.wasmCalls).toBeGreaterThan(2 * DAYS);
      expect(residentStats.wasmCalls).toBeGreaterThan(2 * DAYS - 2);
      expect(residentStats.bytesIn + residentStats.bytesOut).toBe(0);
      console.log(`[econ bands] ${DAYS} days, ${sims.length} cities bit-identical (${arms.join(' | ')}); staged kernel calls ${stats.wasmCalls} ` +
        `(${(stats.bytesIn / stats.wasmCalls / 1024).toFixed(0)} KiB in, ${(stats.bytesOut / stats.wasmCalls / 1024).toFixed(0)} KiB out per call), ` +
        `resident ${residentStats.wasmCalls} (zero copy); population ${sims[0].sim.state.stats.population}`);
    } finally {
      for (const r of released) r();
    }
  });

  it('econBandsWasm (the loader-bound instance) matches the fair JS on a grown city', { timeout: 600000 }, () => {
    const city = stressCity(96, 5);
    const sysA = createSystems(), sysB = createSystems();
    installEconBands(sysA, econBandsJs);
    installEconBands(sysB, econBandsWasm);
    const a = new Simulation(city.st, sysA);
    const b = new Simulation(stressCity(96, 5).st, sysB);
    for (let d = 0; d < 30; d++) {
      a.advanceDay();
      b.advanceDay();
      expect(diffBands(a.state, b.state), `day ${d + 1}`).toBe('');
    }
    expect(simWasmStatus().kernels.econ?.active).toBe(true);
  });
});
