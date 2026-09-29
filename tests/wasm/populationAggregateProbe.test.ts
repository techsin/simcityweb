/**
 * Equivalence of the population aggregate PROBE arms (benchmark-only decision probe; tools/bench/
 * populationAggregateProbe.bench.mjs): the verbatim 24f8609 original (tests/wasm/populationAggregateOriginal.ts, arm A)
 * vs the fair JS (src/wasm/js/populationAggregateProbe.ts: B stable-shape objects + def index, B0 def index alone,
 * C JS over the SoA, E the gather, CE gather + C) vs WASM (wasm/sim-kernels/src/popagg.rs via
 * src/wasm/kernels/populationAggregateProbeBind.ts: D resident, D staged, D with the scalar blur, DE gather + D).
 * Everything must be BIT-identical: rt.totals (pop, resCapAll, resCapBuilt, jobs, jobCapAll, jobCapBuilt, countByDev,
 * abandoned, constructing), W / accE / accW / unW / eduSum / eduPop, coh[15] (f64 bit patterns) and the 16 coarse grids
 * (raw, blurred, demographics; f32 bit patterns), NaN == NaN — after every call of a demo / plain / sample day sequence
 * (so the state kept across calls is compared too), plus identical SoA gathers:
 *  1. random worlds: map sizes 1..300 (cw 1..38), 0..2500 buildings, all flag mixes, defs without devType / missing,
 *     buildings on and beyond the map edges (block indices out of range), ids beyond mWf / accessById, NaN / -1 /
 *     >1 access, NaN workforce shares, f32 cohort shares incl. -0 / subnormals / Infinity, NaN / huge / negative
 *     pop-capacity-jobs, traffic absent / without accessById (JS arms) / with it, education fallback on / off;
 *  2. edge cases: empty map, everything skipped / abandoned / constructing, zero and huge values, one block (cw 1),
 *     demographics grids missing (rt.coarsePopW of another size), no traffic system (this kernel has no graph: the
 *     graph-like edge cases are the missing traffic / access arrays and out-of-range ids);
 *  3. the gather's domain (values the SoA cannot hold are rejected) and the binding (JS preference, stale layout,
 *     invalid dev code -> JS rerun, overlapping outputs, workerAccess callback, mixed resident / staged, byte counts);
 *  4. the real profiler fixtures (dense1m_s7 1.12M pop, bot256_s7_y60; captures written by
 *     `node tools/bench/populationAggregateProbe.bench.mjs capture`, skipped when absent);
 *  5. a live city (stressCity, the live systems) — the arms on Building objects as the current sim makes them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setSimWasmPreference, simWasmInstance, simWasmStatus } from '../../src/wasm/simWasm';
import {
  DEV_SKIP, DefIndex, PopAggSoA, aggregateObjects, aggregateSoA, gatherSoA, newGrids, newResult, newTotals, type PopAggBuilding, type PopAggDef,
  type PopAggGrids, type PopAggInput,
} from '../../src/wasm/js/populationAggregateProbe';
import {
  POPAGG_CONSTANTS, makePopAggKernels, popAggSoAJs, type PopAggBindStats, type PopAggWasm,
} from '../../src/wasm/kernels/populationAggregateProbe';
import {
  PROBE_CONSTANTS, checkArms, checkDays, decodeCapture, diffSnapshots, makeArms, residentSoA, worldFromCapture, type ArmName, type ProbeWorld,
  type TrafficLike,
} from '../../tools/bench/populationAggregateProbe/core';
import { ORIGINAL_CONSTANTS, makeOriginalAggregate, type OrigBuilding, type OrigCache, type OrigRuntime } from './populationAggregateOriginal';

const ROOT = resolve(__dirname, '..', '..');

let reserved = false;
function loaderWasm(): PopAggWasm {
  const w = simWasmInstance();
  if (!w) throw new Error('wasm unavailable: ' + simWasmStatus().error);
  if (typeof w.exports.popagg_aggregate !== 'function') throw new Error('src/wasm/sim_kernels.wasm has no popagg exports: run npm run build:wasm');
  // one reserve at a safe point (no pinned views yet): the arms keep their resident arrays pinned, so the heap may not
  // grow while they live (heap.ts growth rule)
  if (!reserved) { w.heap.reserve(64 << 20); reserved = true; }
  return { ex: w.exports as unknown as PopAggWasm['ex'], heap: w.heap };
}

afterEach(() => setSimWasmPreference('auto', 'popagg'));

// ------------------------------------------------------------------------------------------------ random worlds
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

interface WorldOpts {
  N: number;
  n: number;
  /** 'none' | 'callback' (workerAccess only) | 'array' (accessById) */
  traffic: 'none' | 'callback' | 'array' | 'layersOff';
  /** value kinds for pop / capacity / jobs */
  values: 'city' | 'wild' | 'zero' | 'huge';
  shares: 'city' | 'wild' | 'none';
  eduMean: number;
  /** rt.coarsePopW of the right size (demographics blur on) */
  demoGrids?: boolean;
  /** flag mix: 'city' | 'abandoned' | 'constructing' | 'wild' */
  flags?: 'city' | 'abandoned' | 'constructing' | 'wild';
  /** share of buildings with a def the loop skips */
  skip?: number;
  /** share of buildings with a def whose devType the int dev code cannot hold (12, 7.5; non-residential, so the
   *  original survives them: its totals arrays grow NaN entries / extra keys) */
  odd?: number;
}

/** f32 values (Math.fround: the sim stores shares as f32) incl. -0, subnormals and infinities */
const F32_SPECIAL = [0, -0, 1, 0.5, 1e-40, -1e-42, Infinity, -Infinity, 3.4e38, 0.13].map(Math.fround);

function randomWorld(seed: number, o: WorldOpts): ProbeWorld {
  const r = rng(seed);
  const cw = Math.ceil(o.N / 8), cc = cw * cw;
  // defs: 12 devTypes, a few without devType, some ids missing from the catalog
  const defTab = new Map<string, PopAggDef | undefined>();
  for (let d = 0; d < 12; d++) for (let v = 0; v < 3; v++) defTab.set(`def${d}_${v}`, { devType: d });
  defTab.set('noDev', {});
  const defIds = [...defTab.keys()];
  defTab.set('odd12', { devType: 12 });
  defTab.set('odd7.5', { devType: 7.5 });
  const idMax = Math.max(4, o.n * 3);
  const used = new Set<number>();
  const list: OrigBuilding[] = [];
  const val = (): number => {
    const u = r();
    switch (o.values) {
      case 'zero': return 0;
      case 'huge': return u < 0.5 ? 1e300 * (1 + r()) : -1e300 * r();
      case 'wild': return u < 0.1 ? NaN : u < 0.2 ? -r() * 50 : u < 0.3 ? 0 : u < 0.35 ? -0 : u < 0.4 ? 1e30 : u < 0.6 ? r() * 10 : Math.round(r() * 3000);
      default: return u < 0.15 ? 0 : Math.round(r() * (u < 0.5 ? 40 : 4000));
    }
  };
  const share = (): number | undefined => {
    if (o.shares === 'none') return undefined;
    const u = r();
    if (u < 0.2) return undefined;
    if (o.shares === 'wild' && u < 0.35) return F32_SPECIAL[(r() * F32_SPECIAL.length) | 0];
    return Math.fround(r() * (o.shares === 'wild' ? 1.5 : 0.4));
  };
  for (let k = 0; k < o.n; k++) {
    let id = (r() * idMax) | 0;
    while (used.has(id)) id = (id + 1) % idMax;
    used.add(id);
    const u = r();
    let def = u < (o.skip ?? 0.03) ? (r() < 0.5 ? 'noDev' : 'missing' + ((r() * 3) | 0)) : defIds[(r() * (defIds.length - 1)) | 0];
    if (o.odd && r() < o.odd) def = r() < 0.5 ? 'odd12' : 'odd7.5';
    const w = 1 + ((r() * 4) | 0), d = 1 + ((r() * 4) | 0);
    // mostly on the map; some on / beyond the edges (block indices that wrap or leave the grid)
    const edge = r();
    const x = edge < 0.05 ? -((r() * 20) | 0) : edge < 0.1 ? o.N - 1 + ((r() * 12) | 0) : (r() * Math.max(1, o.N - w)) | 0;
    const z = edge > 0.95 ? -((r() * 20) | 0) : edge > 0.9 ? o.N - 1 + ((r() * 12) | 0) : (r() * Math.max(1, o.N - d)) | 0;
    let flags = 0;
    const fm = o.flags ?? 'city';
    const fu = r();
    if (fm === 'abandoned') flags = r() < 0.5 ? 4 : 16;
    else if (fm === 'constructing') flags = 128;
    else if (fm === 'wild') flags = (r() * 0x40000) | 0 | (r() < 0.1 ? 0x80000000 : 0);
    else flags = (fu < 0.05 ? 4 : 0) | (fu > 0.97 ? 16 : 0) | (r() < 0.1 ? 128 : 0) | (r() < 0.5 ? 3 : 0);
    const b: Record<string, unknown> = {
      id, def, x, z, w, d, rot: 0, variant: 0, pop: val(), jobs: val(), capacity: val(), wealth: (r() * 4) | 0, built: 1, age: 0, flags,
      baseY: 0, health: 1, unhappy: 0,
    };
    if (r() < 0.8) {
      b.kids = share(); b.teens = share(); b.yad = share(); b.srs = share();
      b.wf = r() < 0.5 ? Math.fround(r()) : undefined;
      b.edu = share();
      b.hire = undefined;
    }
    list.push(b as unknown as OrigBuilding);
  }
  // mWf: covers most ids (the rest read undefined -> wk = NaN), NaN = the default ratio
  const mWf = new Float32Array(Math.max(0, Math.floor(idMax * (0.6 + 0.5 * r()))));
  for (let i = 0; i < mWf.length; i++) mWf[i] = r() < 0.3 ? NaN : Math.fround(0.3 + 0.4 * r());
  const acc = new Float32Array(Math.max(0, Math.floor(idMax * (0.5 + 0.6 * r()))));
  for (let i = 0; i < acc.length; i++) { const u = r(); acc[i] = u < 0.15 ? -1 : u < 0.2 ? NaN : u < 0.25 ? Math.fround(1 + r()) : u < 0.3 ? 0 : Math.fround(r()); }
  const traffic: TrafficLike | undefined = o.traffic === 'none' ? undefined
    : o.traffic === 'callback' ? { workerAccess: (id: number) => (id >= 0 && id < acc.length ? acc[id] : -1) }
    : { workerAccess: (id: number) => (id >= 0 && id < acc.length ? acc[id] : -1), accessById: acc };
  const systemData: Record<string, unknown> = { demographics: { v: 1, eduMean: o.eduMean, wfRatio: 0.55, empRatio: -1 } };
  if (o.traffic !== 'none') systemData.infraVersion = 1;
  if (o.traffic === 'layersOff') systemData.infraLayers = { traffic: false };
  const dg = o.demoGrids ?? true;
  const defCache: { id: string; def: PopAggDef }[] = [];
  const rt: OrigRuntime = {
    growables: list,
    // EconRuntime.defOf: per-id cache validated by the def id
    defOf(b) {
      const c = defCache[b.id];
      if (c !== undefined && c.id === b.def) return c.def;
      const d = defTab.get(b.def);
      if (d) defCache[b.id] = { id: b.def, def: d };
      return d;
    },
    totals: { pop: [0, 0, 0], resCapAll: [0, 0, 0], resCapBuilt: [0, 0, 0], jobs: new Array(12).fill(0), jobCapAll: new Array(12).fill(0),
      jobCapBuilt: new Array(12).fill(0), countByDev: new Array(12).fill(0), civicJobCap: 0, civicJobs: 0, abandoned: 0, constructing: 0 },
    cw,
    coarsePopRaw: new Float32Array(cc), coarseWealthRaw: new Float32Array(cc), coarseCountRaw: new Float32Array(cc), coarsePop: new Float32Array(cc),
    coarseWealth: new Float32Array(cc),
    coarsePopW: dg ? [new Float32Array(cc), new Float32Array(cc), new Float32Array(cc)] : [new Float32Array(cc + 1), new Float32Array(cc + 1), new Float32Array(cc + 1)],
    coarseSkill: new Float32Array(dg ? cc : cc + 1), coarseKids: new Float32Array(dg ? cc : cc + 1),
  };
  const cache: OrigCache = { wf: mWf, ensure() { /* the arrays already cover the ids they cover */ } };
  return {
    name: `random#${seed}`,
    sim: { state: { day: 0, nextBuildingId: idMax, systemData }, getSystem: (n: string) => (n === 'traffic' ? traffic : undefined) },
    rt, cache, resolveDef: (id) => defTab.get(id), population: 0,
  };
}

const WASM_ARMS: ArmName[] = ['D', 'Dstaged', 'DscalarBlur', 'DE'];
const JS_ARMS: ArmName[] = ['A', 'B', 'B0', 'C', 'CE', 'E'];

/** makeArms + checkArms over `world` (the wasm arms unless the traffic access is a callback) */
function checkWorld(world: ProbeWorld, rounds = 2, day0 = 0): number {
  const traffic = world.sim.getSystem('traffic') as TrafficLike | undefined;
  const jsOnly = traffic !== undefined && !(traffic.accessById instanceof Float32Array) && world.sim.state.systemData.infraLayers === undefined;
  const arms = makeArms(world, { simd: loaderWasm(), arms: jsOnly ? JS_ARMS : [...JS_ARMS, ...WASM_ARMS] });
  try {
    return checkArms(world, arms, checkDays(day0, rounds));
  } finally {
    for (const a of Object.values(arms)) a.dispose();
  }
}

describe('random worlds: original == fair JS == wasm, bit for bit', () => {
  const cases: [string, WorldOpts][] = [
    ['city 256² (cw 32), traffic array', { N: 256, n: 2500, traffic: 'array', values: 'city', shares: 'city', eduMean: 0.4 }],
    ['city, no traffic system', { N: 128, n: 1500, traffic: 'none', values: 'city', shares: 'city', eduMean: -1 }],
    ['traffic layer off (infraLayers.traffic = false)', { N: 96, n: 900, traffic: 'layersOff', values: 'city', shares: 'city', eduMean: 0.2 }],
    ['traffic without accessById (workerAccess callback; JS arms)', { N: 100, n: 800, traffic: 'callback', values: 'city', shares: 'city', eduMean: 0.3 }],
    ['wild values (NaN / negative / -0 / 1e30 pop, jobs, capacity)', { N: 77, n: 1200, traffic: 'array', values: 'wild', shares: 'wild', eduMean: 0.6 }],
    ['wild shares (-0, subnormal, ±Infinity, > 1)', { N: 64, n: 1000, traffic: 'array', values: 'city', shares: 'wild', eduMean: -1 }],
    ['huge values (±1e300: Infinity / NaN sums)', { N: 50, n: 500, traffic: 'array', values: 'huge', shares: 'city', eduMean: 1 }],
    ['wild flags (every bit, sign bit)', { N: 70, n: 900, traffic: 'array', values: 'city', shares: 'city', eduMean: 0.5, flags: 'wild' }],
    ['30 % skipped defs (no def / no devType)', { N: 90, n: 700, traffic: 'array', values: 'city', shares: 'city', eduMean: 0.5, skip: 0.3 }],
    ['odd map 300 (cw 38)', { N: 300, n: 2000, traffic: 'array', values: 'city', shares: 'city', eduMean: 0.45 }],
    ['tiny map 9 (cw 2)', { N: 9, n: 60, traffic: 'array', values: 'city', shares: 'city', eduMean: 0.1 }],
    ['one block (N 8, cw 1)', { N: 8, n: 40, traffic: 'array', values: 'wild', shares: 'wild', eduMean: 0.1 }],
    ['N 1 (cw 1)', { N: 1, n: 12, traffic: 'array', values: 'city', shares: 'city', eduMean: 0.9 }],
    ['demographics grids of another size (no demographics blur)', { N: 64, n: 600, traffic: 'array', values: 'city', shares: 'city', eduMean: 0.5, demoGrids: false }],
  ];
  for (const [label, o] of cases) {
    it(label, () => {
      for (const seed of [1, 2, 3]) {
        const n = checkWorld(randomWorld(seed * 7919 + o.n, o), 2, seed * 13);
        expect(n).toBeGreaterThan(0);
      }
    });
  }
});

describe('edge cases', () => {
  const base: WorldOpts = { N: 64, n: 0, traffic: 'array', values: 'city', shares: 'city', eduMean: 0.5 };
  it('empty map (no growables)', () => {
    expect(checkWorld(randomWorld(5, base))).toBeGreaterThan(0);
  });
  it('every growable abandoned / burnt, or constructing', () => {
    checkWorld(randomWorld(6, { ...base, n: 300, flags: 'abandoned' }));
    checkWorld(randomWorld(7, { ...base, n: 300, flags: 'constructing' }));
  });
  it('every growable skipped (defs without devType / missing)', () => {
    checkWorld(randomWorld(8, { ...base, n: 300, skip: 1 }));
  });
  it('zero values (no sample / demographics terms) and no shares at all', () => {
    checkWorld(randomWorld(9, { ...base, n: 400, values: 'zero' }));
    checkWorld(randomWorld(10, { ...base, n: 400, shares: 'none' }));
  });
  it('any day order after the first demo day (state kept across plain / sample days)', () => {
    // (the original allocates its demographics grids on its first demo day — the system's init call is one — so every
    // sequence starts with a demo day; after it, the kept coh / demographics grids must agree whatever follows)
    const w = randomWorld(11, { ...base, n: 500 });
    const arms = makeArms(w, { simd: loaderWasm() });
    try {
      expect(checkArms(w, arms, [32, 33, 34, 36, 40, 41, 64, 68, 69, 96, 97, 100])).toBeGreaterThan(0);
    } finally {
      for (const a of Object.values(arms)) a.dispose();
    }
  });
});

describe('def index: devTypes the int dev code cannot hold', () => {
  it('B / B0 start over in the exact loop and match the original, extra totals keys included', () => {
    const w = randomWorld(21, { N: 64, n: 600, traffic: 'array', values: 'city', shares: 'city', eduMean: 0.5, odd: 0.05 });
    // (the gather rejects these defs, so only the object arms run; checkArms compares the 12 real devs + everything else)
    const arms = makeArms(w, { simd: loaderWasm(), arms: ['A', 'B', 'B0'] });
    try {
      expect(checkArms(w, arms, checkDays(0, 2))).toBe(12);
    } finally {
      for (const a of Object.values(arms)) a.dispose();
    }
    // and the totals' extra entries exactly as the original leaves them: rt.totals persists across calls, fill(0)
    // resets countByDev[12] once the array has grown to 13 entries, the '7.5' keys stay NaN — so both sides keep their
    // totals object over the same call sequence (a fresh, identical world)
    const w2 = randomWorld(21, { N: 64, n: 600, traffic: 'array', values: 'city', shares: 'city', eduMean: 0.5, odd: 0.05 });
    const orig = makeOriginalAggregate(w2.rt, w2.cache);
    const defs = new DefIndex(w2.resolveDef, 12);
    const t = newTotals(12), g = newGrids(w2.rt.cw), coh = new Float64Array(15), res = newResult();
    for (const day of checkDays(0, 2)) {
      w2.sim.state.day = day;
      orig.aggregate(w2.sim, false);
      const inp: PopAggInput = { cw: w2.rt.cw, sample: day % 4 === 0, demo: day % 32 === 0, mWf: w2.cache.wf, tAcc: true,
        accArr: (w2.sim.getSystem('traffic') as TrafficLike).accessById, eduFallback: 0.5 };
      aggregateObjects(w2.rt.growables as unknown as PopAggBuilding[], defs, PROBE_CONSTANTS, inp, g, t, coh, res);
      const w = w2;
      for (const k of ['countByDev', 'jobs', 'jobCapAll', 'jobCapBuilt'] as const) {
        const a = w.rt.totals[k], b = t[k];
        expect(Object.keys(b)).toEqual(Object.keys(a));
        expect(Object.keys(a)).toContain('7.5');
        expect(a.length).toBe(13);
        for (const key of Object.keys(a)) expect(Object.is((b as unknown as Record<string, number>)[key], (a as unknown as Record<string, number>)[key]) || (Number.isNaN((a as unknown as Record<string, number>)[key]) && Number.isNaN((b as unknown as Record<string, number>)[key]))).toBe(true);
      }
    }
  });
});

// ------------------------------------------------------------------------------------------------ gather domain
describe('gather (arm E): values the SoA cannot hold exactly are rejected', () => {
  const defs = () => new DefIndex((id) => (id === 'r' ? { devType: 0 } : id === 'c' ? { devType: 3 } : id === 'x12' ? { devType: 12 } : id === 'xf' ? { devType: 1.5 } : id === 'nd' ? {} : undefined), 12);
  const b = (o: Partial<PopAggBuilding> & Record<string, unknown> = {}): PopAggBuilding => ({ id: 1, def: 'r', x: 3, z: 4, w: 2, d: 2, pop: 10, jobs: 0, capacity: 12, wealth: 1, flags: 3, ...o });
  const gather = (list: PopAggBuilding[]) => gatherSoA(list, defs(), PROBE_CONSTANTS, 8, new PopAggSoA());
  it('accepts undefined shares, -0, subnormal f32, Infinity, NaN pop and skipped defs', () => {
    expect(gather([b({ kids: undefined, edu: -0 }), b({ id: 2, teens: Math.fround(1e-40), srs: Infinity }), b({ id: 3, pop: NaN, capacity: NaN }),
      b({ id: 4, def: 'nd', kids: NaN }), b({ id: 5, def: 'missing', wealth: 9999 })])).toBe(true);
  });
  for (const [label, o] of [
    ['NaN share', { kids: NaN }], ['null edu', { edu: null }], ['non-f32 share 0.1', { teens: 0.1 }], ['wealth 300', { wealth: 300 }],
    ['wealth 1.5', { wealth: 1.5 }], ['id 1.5', { id: 1.5 }], ['string pop', { pop: '5' }], ['undefined capacity', { capacity: undefined }],
    ['devType 12', { def: 'x12' }], ['devType 1.5', { def: 'xf' }],
    // ((2^33 + 1) / 8 | 0) * cw overflows int32: the Int32Array would wrap it into the grids, where the JS drops the adds
    ['block index beyond int32', { z: 2 ** 33 }],
  ] as [string, Record<string, unknown>][]) {
    it(`rejects ${label}`, () => {
      expect(gather([b(), b({ id: 2, ...o })])).toBe(false);
    });
  }
  it('skipped rows only carry the dev code', () => {
    const soa = new PopAggSoA();
    expect(gatherSoA([b({ def: 'nd' }), b({ id: 2, def: 'missing' }), b({ id: 3 })], defs(), PROBE_CONSTANTS, 8, soa)).toBe(true);
    expect([soa.dev[0], soa.dev[1], soa.dev[2]]).toEqual([DEV_SKIP, DEV_SKIP, 0]);
    expect(soa.n).toBe(3);
  });
});

// ------------------------------------------------------------------------------------------------ binding
describe('binding: domain, fallbacks, staging', () => {
  /** a small SoA world run through aggregateSoA (JS) and the binding */
  function setup(seed = 3) {
    const w = randomWorld(seed, { N: 64, n: 600, traffic: 'array', values: 'city', shares: 'city', eduMean: 0.4 });
    const soa = new PopAggSoA();
    expect(gatherSoA(w.rt.growables as unknown as PopAggBuilding[], new DefIndex(w.resolveDef, 12), PROBE_CONSTANTS, w.rt.cw, soa)).toBe(true);
    const traffic = w.sim.getSystem('traffic') as TrafficLike;
    const inp: PopAggInput = { cw: w.rt.cw, sample: true, demo: true, mWf: w.cache.wf, tAcc: true, accArr: traffic.accessById, eduFallback: 0.4 };
    return { w, soa, inp };
  }
  function run(fn: typeof popAggSoAJs, soa: PopAggSoA, inp: PopAggInput, g: PopAggGrids = newGrids(inp.cw)) {
    const t = newTotals(12), coh = new Float64Array(15), out = newResult();
    fn(soa, inp, g, t, coh, out);
    return { t, coh, out, g };
  }
  const same = (x: ReturnType<typeof run>, y: ReturnType<typeof run>) => {
    const flat = (r: ReturnType<typeof run>) => [...r.t.pop, ...r.t.resCapAll, ...r.t.resCapBuilt, ...r.t.jobs, ...r.t.jobCapAll, ...r.t.jobCapBuilt,
      ...r.t.countByDev, r.t.abandoned, r.t.constructing, r.out.W, r.out.accE, r.out.accW, r.out.unW, r.out.eduSum, r.out.eduPop, ...r.coh];
    const gl = (r: ReturnType<typeof run>) => [r.g.coarsePopRaw, r.g.coarseWealthRaw, r.g.coarseCountRaw, r.g.coarsePop, r.g.coarseWealth, ...r.g.popWRaw,
      r.g.skillRaw, r.g.kidsRaw, ...r.g.coarsePopW, r.g.coarseKids, r.g.skillBlur, r.g.coarseSkill];
    return diffSnapshots({ f64: Float64Array.from(flat(x)), grids: gl(x) }, { f64: Float64Array.from(flat(y)), grids: gl(y) });
  };
  const stats = (): PopAggBindStats => ({ wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 });

  it('staged (plain arrays) = resident = JS, and the staged call counts its bytes', () => {
    const { soa, inp } = setup();
    const w = loaderWasm();
    const st = stats();
    const k = makePopAggKernels(POPAGG_CONSTANTS, () => { throw new Error('fell back'); }, { wasm: w, stats: st });
    const js = run(popAggSoAJs, soa, inp);
    const staged = run(k, soa, inp);
    expect(same(js, staged)).toBeNull();
    expect(st.wasmCalls).toBe(1);
    // SoA 58 B / growable + mWf + accessById in, 16 grids out
    expect(st.bytesIn).toBe(soa.n * 58 + inp.mWf.byteLength + inp.accArr!.byteLength);
    expect(st.bytesOut).toBe(16 * inp.cw * inp.cw * 4);
    // resident: SoA, mWf, accessById and grids in wasm memory -> nothing copied
    const res = residentSoA(w);
    expect(gatherSoA(setup().w.rt.growables as unknown as PopAggBuilding[], new DefIndex(setup().w.resolveDef, 12), PROBE_CONSTANTS, inp.cw, res)).toBe(true);
    const mWf = w.heap.allocArray(Float32Array, inp.mWf.length); mWf.set(inp.mWf);
    const acc = w.heap.allocArray(Float32Array, inp.accArr!.length); acc.set(inp.accArr!);
    const gridsR = newGrids(inp.cw, (n) => w.heap.allocArray(Float32Array, n));
    const st2 = stats();
    const k2 = makePopAggKernels(POPAGG_CONSTANTS, () => { throw new Error('fell back'); }, { wasm: w, stats: st2 });
    const resident = run(k2, res, { ...inp, mWf, accArr: acc }, gridsR);
    expect(same(js, resident)).toBeNull();
    expect(st2.bytesIn + st2.bytesOut).toBe(0);
    // mixed: some SoA columns resident, the rest staged
    const mixed = new PopAggSoA();
    Object.assign(mixed, { n: res.n, cap: res.cap, dev: res.dev, blk: res.blk, flags: soa.flags, pop: res.pop, capacity: soa.capacity, jobs: res.jobs,
      wealth: soa.wealth, id: res.id, kids: soa.kids, teens: res.teens, yad: soa.yad, srs: res.srs, edu: soa.edu });
    expect(same(js, run(k2, mixed, { ...inp, mWf, accArr: inp.accArr }))).toBeNull();
    for (const a of [mWf, acc, ...res.arrays()]) w.heap.free(a);
    for (const a of [gridsR.coarsePopRaw, gridsR.coarseWealthRaw, gridsR.coarseCountRaw, gridsR.coarsePop, gridsR.coarseWealth, ...gridsR.popWRaw, gridsR.skillRaw,
      gridsR.kidsRaw, ...gridsR.coarsePopW, gridsR.coarseKids, gridsR.skillBlur, gridsR.coarseSkill]) w.heap.free(a);
  });

  it('every day kind and the scalar blur give the JS result', () => {
    const { soa, inp } = setup(4);
    const w = loaderWasm();
    for (const scalarBlur of [false, true]) {
      const k = makePopAggKernels(POPAGG_CONSTANTS, () => { throw new Error('fell back'); }, { wasm: w, scalarBlur });
      for (const [sample, demo] of [[false, false], [true, false], [true, true], [false, true]]) {
        const i2 = { ...inp, sample, demo };
        expect(same(run(popAggSoAJs, soa, i2), run(k, soa, i2))).toBeNull();
      }
    }
  });

  it('JS preference, stale layout, overlapping outputs and the workerAccess callback run JS', () => {
    const { soa, inp } = setup(5);
    const js = run(popAggSoAJs, soa, inp);
    // JS preference (loader instance)
    setSimWasmPreference('js', 'popagg');
    const st = stats();
    const kl = makePopAggKernels(POPAGG_CONSTANTS, popAggSoAJs, { stats: st });
    expect(same(js, run(kl, soa, inp))).toBeNull();
    expect(st).toMatchObject({ wasmCalls: 0, jsCalls: 1 });
    setSimWasmPreference('auto', 'popagg');
    expect(same(js, run(kl, soa, inp))).toBeNull();
    expect(st.wasmCalls).toBe(1);
    // a binary whose layout differs
    const w = loaderWasm();
    const stale = { ex: { ...w.ex, memory: w.ex.memory, popagg_layout: () => 99, popagg_aggregate: w.ex.popagg_aggregate }, heap: w.heap } as PopAggWasm;
    const st2 = stats();
    const ks = makePopAggKernels(POPAGG_CONSTANTS, popAggSoAJs, { wasm: stale, stats: st2 });
    expect(same(js, run(ks, soa, inp))).toBeNull();
    expect(st2.jsCalls).toBe(1);
    // overlapping outputs: the same array as coarsePop and coarseWealth (JS writes one after the other)
    const g1 = newGrids(inp.cw), g2 = newGrids(inp.cw);
    g1.coarseWealth = g1.coarsePop; g2.coarseWealth = g2.coarsePop;
    const st3 = stats();
    const k3 = makePopAggKernels(POPAGG_CONSTANTS, popAggSoAJs, { wasm: w, stats: st3 });
    expect(same(run(popAggSoAJs, soa, inp, g1), run(k3, soa, inp, g2))).toBeNull();
    expect(st3).toMatchObject({ wasmCalls: 0, jsCalls: 1 });
    // an output overlapping an input (coarseKids aliasing the mWf buffer)
    const g3 = newGrids(inp.cw), g4 = newGrids(inp.cw);
    const alias = new Float32Array(inp.mWf.buffer, 0, inp.cw * inp.cw);
    g3.coarseKids = alias; g4.coarseKids = alias;
    const mwf1 = inp.mWf.slice();
    const r3 = run(popAggSoAJs, soa, { ...inp, mWf: mwf1 }, { ...g3, coarseKids: new Float32Array(mwf1.buffer, 0, inp.cw * inp.cw) });
    const r4 = run(k3, soa, inp, g4);
    expect(same(r3, r4)).toBeNull();
    expect(st3.jsCalls).toBe(2);
    // traffic access through a callback only
    const cb = { ...inp, accArr: undefined, workerAccess: (id: number) => (id < inp.accArr!.length ? inp.accArr![id] : -1) };
    expect(same(run(popAggSoAJs, soa, cb), run(k3, soa, cb))).toBeNull();
    expect(st3.jsCalls).toBe(3);
  });

  it('a dev code outside the totals makes the kernel stop and the call rerun in JS', () => {
    const { soa, inp } = setup(6);
    soa.dev[Math.floor(soa.n / 2)] = 13;
    const w = loaderWasm();
    const st = stats();
    const k = makePopAggKernels(POPAGG_CONSTANTS, (s, i, g, t, coh, out) => aggregateSoA(s, POPAGG_CONSTANTS, i, g, t, coh, out), { wasm: w, stats: st });
    const js = run(popAggSoAJs, soa, inp);
    const r = run(k, soa, inp);
    expect(same(js, r)).toBeNull();
    expect(st).toMatchObject({ wasmCalls: 0, jsCalls: 1 });
    expect(Number.isNaN(js.t.countByDev[13])).toBe(true); // (the JS semantics the rerun keeps: undefined + 1)
  });
});

// ------------------------------------------------------------------------------------------------ real fixtures
describe('profiler fixtures (1M-population captures)', () => {
  const dirs = [process.env.POPAGG_CAPTURE_DIR, join(ROOT, 'node_modules', '.cache', 'sim-bench', 'populationAggregateProbe')].filter((d): d is string => !!d && existsSync(d));
  const caps = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.pagc')).map((f) => join(d, f)));
  it.skipIf(caps.length === 0)(`every arm bit-exact on demo / plain / sample days: ${caps.map((f) => f.split('/').pop()).join(', ') || 'none found'}`, { timeout: 900000 }, () => {
    for (const f of caps) {
      const cap = decodeCapture(new Uint8Array(readFileSync(f)));
      const world = worldFromCapture(cap);
      expect(world.rt.growables.length).toBe(cap.n);
      const arms = makeArms(world, { simd: loaderWasm() });
      try {
        const n = checkArms(world, arms, checkDays(cap.day, 2));
        expect(n).toBe(6 * 8); // 6 days x (10 arms - A - the gather-only E)
      } finally {
        for (const a of Object.values(arms)) a.dispose();
      }
    }
  });
});

// ------------------------------------------------------------------------------------------------ live city
describe('live city (stressCity, the live systems)', () => {
  it('the arms agree on the Building objects of a live simulated city', { timeout: 600000 }, async () => {
    const { stressCity } = await import('../infra/cityGen');
    const { Simulation } = await import('../../src/sim/Simulation');
    const { createSystems } = await import('../../src/sim/systems/index');
    const { getDef } = await import('../../src/sim/catalog');
    const { st } = stressCity(96, 11);
    const systems = createSystems();
    const sim = new Simulation(st, systems);
    for (let d = 0; d < 6; d++) sim.advanceDay();
    const rt = (systems.find((s) => s.name === 'economy.population') as unknown as { rt: OrigRuntime }).rt;
    expect(rt.growables.length).toBeGreaterThan(100);
    // the population system's own DemographicsCache is private: a workforce table from the buildings' b.wf
    const wf = new Float32Array(st.nextBuildingId + 16).fill(NaN);
    for (const b of rt.growables as unknown as (OrigBuilding & { wf?: number })[]) if (b.wf !== undefined) wf[b.id] = b.wf;
    const world: ProbeWorld = {
      name: 'live stressCity(96)', sim: sim as unknown as ProbeWorld['sim'], rt, cache: { wf, ensure() {} },
      resolveDef: (id) => getDef(id), population: st.stats.population,
    };
    const arms = makeArms(world, { simd: loaderWasm() });
    try {
      expect(checkArms(world, arms, checkDays(st.day, 2))).toBeGreaterThan(0);
    } finally {
      for (const a of Object.values(arms)) a.dispose();
    }
    // the probe's constants are still the live ones (else arm A — frozen — is no longer the live loop's arithmetic)
    expect(POPAGG_CONSTANTS).toMatchObject({ COARSE: ORIGINAL_CONSTANTS.COARSE, WORKFORCE_RATIO: ORIGINAL_CONSTANTS.WORKFORCE_RATIO, DEV_TYPE_COUNT: 12, R_MAX: 2 });
    expect([...POPAGG_CONSTANTS.COHORT_BASE]).toEqual([...ORIGINAL_CONSTANTS.COHORT_BASE]);
  });
});
