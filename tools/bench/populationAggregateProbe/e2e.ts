/**
 * Population aggregate probe — END-TO-END: the whole simulation at 1M population (the frozen 24f8609 tree via
 * plugins.mjs), advanced headless, with the probed aggregate region of the population system swapped per arm. Measures
 * the containing system's cost — economy.population daily (construction + occupancy + aggregate + demographics events)
 * in CPU ms per day — and the whole day.
 *
 *   node e2e.mjs --fixture F.metropolis [--warm 12] [--days 128] [--chunk 3] [--e2e-arms asis,shellOrig,B0,Aobj,B,CE,DE,DEs]
 *        [--simd src/wasm/sim_kernels.wasm] [--json out.json]
 *
 * ONE PROCESS PER ARM, driven round-robin. The coordinator forks one child per arm (each loads the fixture and builds
 * its own Simulation), then advances them in chunks of --chunk days, one child at a time (the others block on IPC, idle),
 * the arm order rotated every round; warm-up chunks first, then the measured ones. Each child times its own days with
 * process.cpuUsage() (its main thread + V8 helper threads; the IPC handling happens between chunks). Separate processes
 * matter here: arms that re-shape the buildings (Aobj, B, DEs) would otherwise share inline-cache feedback with the
 * others in every system that reads buildings (polymorphic property loads for everyone), and one arm's garbage would be
 * collected during another arm's day. Per-chunk paired ratios (same days, same round) with 95 % bootstrap CIs.
 *
 * Arms (nothing on disk is edited; the shell is a bundle-time copy of the frozen population.ts, plugins.mjs popShell):
 *   asis       the genuine systems
 *   shellOrig  population system = the shell running the VERBATIM original region (tests/wasm/populationAggregateOriginal.ts):
 *              the JS-vs-JS control (asis vs shellOrig must be ~1.00x: the swap mechanism itself costs nothing)
 *   B0         shell + aggregateObjects with the def index, on the sim's own objects (the def-index change alone)
 *   Aobj       the genuine systems on STABLE-SHAPE buildings: every loaded Building re-created (before the Simulation is
 *              built, so every system indexes the new objects) as ONE 25-field literal with the seven optional WP1
 *              fields declared (undefined where absent) — what declaring them in the serialize / growth / actions
 *              literals gives loaded buildings (buildings grown during the run keep the frozen growth.ts literal)
 *   B          Aobj's stable-shape buildings + shell + the def index: arm (B), the JS fix without any data migration
 *   CE         shell + gather (E) + JS SoA loop (C) every day, on the sim's own objects
 *   DE         shell + gather (E) into a SoA in wasm memory + the wasm kernel (D), on the sim's own objects; rt's coarse
 *              grids, the population system's DemographicsCache.wf and traffic.accessById adopted into the same wasm
 *              memory (zero copy; if the sim reallocates one, the binding stages it — `staged` reports the bytes)
 *   DEs        DE on Aobj's stable-shape buildings (wasm without a data migration, once (B)'s shapes are adopted)
 * Headless days keep the cities bit-identical across arms: checked at the end (sha256 of every typed-array layer of the
 * state, of the stats, of every building's defined fields).
 */
import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { deserializeCity, type SerializedCity } from '../../../src/save/serialize';
import { unpackFile } from '../../../src/save/bundle';
import { Simulation, type SimSystem } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { getDef } from '../../../src/sim/catalog';
import type { EconRuntime } from '../../../src/sim/economy/runtime';
import { populationSystemShell, type ProbeKernel, type ProbeKernelResult } from 'popagg:shell';
import {
  DefIndex, PopAggSoA, aggregateObjects, aggregateSoA, gatherNeed, gatherSoA, newResult, type PopAggBuilding, type PopAggGrids, type PopAggInput,
} from '../../../src/wasm/js/populationAggregateProbe';
import { makePopAggKernels, type PopAggBindStats, type PopAggSoAFn } from '../../../src/wasm/kernels/populationAggregateProbeBind';
import { adoptLayers } from '../../../src/wasm/layers';
import { makeOriginalAggregate, type OrigCache, type OrigRuntime, type OrigSim } from '../../../tests/wasm/populationAggregateOriginal';
import { bootstrapMedianCI } from '../ab';
import { cpuMs, loadAvg } from '../node';
import { PROBE_CONSTANTS, instantiate, residentSoA } from './core';

type ArmName = 'asis' | 'shellOrig' | 'B0' | 'Aobj' | 'B' | 'CE' | 'DE' | 'DEs';
const LABEL: Record<ArmName, string> = {
  asis: 'genuine population system', shellOrig: 'shell + verbatim original (control)', B0: 'shell + def index (sim objects)',
  Aobj: 'genuine system, stable-shape buildings', B: 'stable shapes + shell + def index', CE: 'shell + gather + JS SoA',
  DE: 'shell + gather + wasm (resident)', DEs: 'stable shapes + gather + wasm',
};
/** arms whose loaded buildings are re-created with one stable shape */
const STABLE: ReadonlySet<ArmName> = new Set<ArmName>(['Aobj', 'B', 'DEs']);
/** arms whose kernel region is gather + SoA loop */
const SOA_ARMS: ReadonlySet<ArmName> = new Set<ArmName>(['CE', 'DE', 'DEs']);
/** arms without a kernel region (the genuine population system) */
const NO_KERNEL: ReadonlySet<ArmName> = new Set<ArmName>(['asis', 'Aobj']);

/** the Building fields in declaration order (CityState.ts Building @ 24f8609) + the seven optional WP1 fields */
function stableBuilding(b: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {
    id: b.id, def: b.def, x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot, variant: b.variant, pop: b.pop, jobs: b.jobs, capacity: b.capacity,
    wealth: b.wealth, built: b.built, age: b.age, flags: b.flags, baseY: b.baseY, health: b.health, unhappy: b.unhappy,
    kids: b.kids, teens: b.teens, yad: b.yad, srs: b.srs, wf: b.wf, edu: b.edu, hire: b.hire,
  };
  // anything else a save carried (extra keys) keeps its value
  for (const k of Object.keys(b)) if (!(k in o)) o[k] = b[k];
  return o;
}

/** one simulated day of an arm: CPU ms of economy.population daily, of the kernel region in it, of the gather inside the
 *  kernel region (SoA arms), of the whole day; wall ms of the whole day */
interface DayRec { day: number; pop: number; kernel: number; total: number; wall: number; gather: number }

/** per-call timing of the kernel region (shell arms) */
const timing = { current: null as DayRec | null };

// ------------------------------------------------------------------------------------------------ kernels
type Trafficish = { workerAccess?: (id: number) => number; accessById?: Float32Array };

function trafficOf(sim: Simulation, inf: { traffic: boolean }): Trafficish | undefined {
  const traffic = inf.traffic ? (sim.getSystem('traffic') as unknown as Trafficish | undefined) : undefined;
  return typeof traffic?.workerAccess === 'function' ? traffic : undefined;
}

/** the verbatim original region (rebuilt when the system gets a new DemographicsCache at init) */
function origKernel(): ProbeKernel {
  let key: { rt: EconRuntime; cache: object; coh: Float64Array } | null = null;
  let agg: ReturnType<typeof makeOriginalAggregate> | null = null;
  return {
    run(sim, rt, cache, inf, first, _sample, _demo, _dd, coh) {
      const t0 = cpuMs();
      if (!key || key.rt !== rt || key.cache !== cache || key.coh !== coh) {
        agg = makeOriginalAggregate(rt as unknown as OrigRuntime, cache as OrigCache, coh);
        key = { rt, cache, coh };
      }
      const r = agg!.aggregate(sim as unknown as OrigSim, first);
      const out: ProbeKernelResult = { W: r.W, eduSum: r.eduSum, eduPop: r.eduPop, accE: r.accE, accW: r.accW, unW: r.unW, tAcc: trafficOf(sim, inf) };
      if (timing.current) timing.current.kernel += cpuMs() - t0;
      return out;
    },
  };
}

/** shared glue of the fair kernels: inputs as the original derives them, the rt grids + the closure grids */
function kernelGlue(allocGrid: (n: number) => Float32Array) {
  const inp: PopAggInput = { cw: 0, sample: false, demo: false, mWf: new Float32Array(0), tAcc: false, accArr: undefined, workerAccess: undefined, eduFallback: 0 };
  let own: { cc: number; popWRaw: Float32Array[]; skillRaw: Float32Array; kidsRaw: Float32Array; skillBlur: Float32Array } | null = null;
  const out = newResult();
  let wa: { traffic: Trafficish; fn: (id: number) => number } | null = null;
  return {
    out,
    prepare(sim: Simulation, rt: EconRuntime, cache: { wf: Float32Array }, inf: { traffic: boolean }, sample: boolean, demo: boolean, dd: { eduMean: number }) {
      const cw = rt.cw, cc = cw * cw;
      inp.cw = cw; inp.sample = sample; inp.demo = demo; inp.mWf = cache.wf;
      const traffic = trafficOf(sim, inf);
      inp.tAcc = traffic !== undefined;
      inp.accArr = traffic && traffic.accessById instanceof Float32Array ? traffic.accessById : undefined;
      if (traffic && wa?.traffic !== traffic) wa = { traffic, fn: (id: number) => traffic.workerAccess!(id) };
      inp.workerAccess = traffic ? wa!.fn : undefined;
      inp.eduFallback = dd.eduMean >= 0 ? dd.eduMean : 0;
      if (!own || own.cc !== cc) {
        own = { cc, popWRaw: [allocGrid(cc), allocGrid(cc), allocGrid(cc)], skillRaw: allocGrid(cc), kidsRaw: allocGrid(cc), skillBlur: allocGrid(cc) };
      }
      const g: PopAggGrids = {
        coarsePopRaw: rt.coarsePopRaw, coarseWealthRaw: rt.coarseWealthRaw, coarseCountRaw: rt.coarseCountRaw, coarsePop: rt.coarsePop,
        coarseWealth: rt.coarseWealth, popWRaw: own.popWRaw, skillRaw: own.skillRaw, kidsRaw: own.kidsRaw, skillBlur: own.skillBlur,
        coarsePopW: rt.coarsePopW, coarseKids: rt.coarseKids, coarseSkill: rt.coarseSkill,
      };
      return { inp, g, traffic };
    },
  };
}

function bKernel(): ProbeKernel {
  const glue = kernelGlue((n) => new Float32Array(n));
  const defs = new DefIndex((id) => getDef(id), PROBE_CONSTANTS.DEV_TYPE_COUNT);
  return {
    run(sim, rt, cache, inf, _first, sample, demo, dd, coh) {
      const t0 = cpuMs();
      const { inp, g, traffic } = glue.prepare(sim, rt, cache, inf, sample, demo, dd);
      aggregateObjects(rt.growables as unknown as PopAggBuilding[], defs, PROBE_CONSTANTS, inp, g, rt.totals, coh, glue.out);
      const o = glue.out;
      if (timing.current) timing.current.kernel += cpuMs() - t0;
      return { W: o.W, eduSum: o.eduSum, eduPop: o.eduPop, accE: o.accE, accW: o.accW, unW: o.unW, tAcc: traffic };
    },
  };
}

/**
 * gather + a SoA loop (JS or wasm); falls back to the object loop when the gather rejects a value. `before` runs first,
 * inside the timed region (the wasm arms re-adopt arrays the sim reallocated, see residentKeeper).
 */
function soaKernel(soa: PopAggSoA, loop: PopAggSoAFn, allocGrid: (n: number) => Float32Array, counters: Counters,
  before: ((sim: Simulation, rt: EconRuntime, cache: object) => void) | null = null): ProbeKernel {
  const glue = kernelGlue(allocGrid);
  const defs = new DefIndex((id) => getDef(id), PROBE_CONSTANTS.DEV_TYPE_COUNT);
  return {
    run(sim, rt, cache, inf, _first, sample, demo, dd, coh) {
      const t0 = cpuMs();
      if (before) before(sim, rt, cache);
      const { inp, g, traffic } = glue.prepare(sim, rt, cache, inf, sample, demo, dd);
      const list = rt.growables as unknown as PopAggBuilding[];
      const tg = cpuMs();
      const ok = gatherSoA(list, defs, PROBE_CONSTANTS, rt.cw, soa, gatherNeed(sample, demo));
      if (timing.current) timing.current.gather += cpuMs() - tg;
      if (ok) loop(soa, inp, g, rt.totals, coh, glue.out);
      else { counters.gatherRejected++; aggregateObjects(list, defs, PROBE_CONSTANTS, inp, g, rt.totals, coh, glue.out); }
      const o = glue.out;
      if (timing.current) timing.current.kernel += cpuMs() - t0;
      return { W: o.W, eduSum: o.eduSum, eduPop: o.eduPop, accE: o.accE, accW: o.accW, unW: o.unW, tAcc: traffic };
    },
  };
}

interface Counters { gatherRejected: number; readopted: number }

const RT_GRIDS = ['coarsePopRaw', 'coarseWealthRaw', 'coarseCountRaw', 'coarsePop', 'coarseWealth', 'coarsePopW', 'coarseSkill', 'coarseKids'];

/**
 * The architect's memory model for this kernel's inputs / outputs: rt's coarse grids, the population system's
 * DemographicsCache.wf and traffic.accessById live in the kernel's wasm memory. adopt() moves them there (adoptLayers:
 * copy into a heap block, the owner's field re-pointed; arrays already in the heap are skipped). The sim reallocates
 * wf / accessById when building ids outgrow them (doubling: the first new building after a load, then rarely); in the
 * one-Memory-per-Simulation design the new array would be allocated in wasm memory in the first place, so the wasm arms
 * re-adopt a reallocated array at their next kernel call — inside the timed region (the one-off copy is charged to the
 * wasm arm) — instead of staging it on every call.
 */
function residentKeeper(heap: PopAggWasmHeap, counters: Counters) {
  const adopt = (sim: Simulation, rt: EconRuntime, cache: object): string[] => {
    const keys: string[] = [];
    const c = cache as { wf?: Float32Array };
    const tr = sim.getSystem('traffic') as unknown as { accessById?: Float32Array } | undefined;
    const r = rt as unknown as Record<string, unknown>;
    const gridsIn = RT_GRIDS.every((k) => { const v = r[k]; return Array.isArray(v) ? v.every((a) => heap.ptrOf(a as Float32Array) >= 0) : heap.ptrOf(v as Float32Array) >= 0; });
    if (!gridsIn) keys.push(...adoptLayers(rt, heap, { include: (k) => RT_GRIDS.includes(k) }).keys);
    if (c.wf instanceof Float32Array && heap.ptrOf(c.wf) < 0) keys.push(...adoptLayers(cache, heap, { include: (k) => k === 'wf' }).keys.map((k) => 'cache.' + k));
    if (tr?.accessById instanceof Float32Array && heap.ptrOf(tr.accessById) < 0) {
      keys.push(...adoptLayers(tr, heap, { include: (k) => k === 'accessById' }).keys.map((k) => 'traffic.' + k));
    }
    return keys;
  };
  return {
    adopt,
    /** soaKernel's `before` hook */
    before: (sim: Simulation, rt: EconRuntime, cache: object) => { const k = adopt(sim, rt, cache); if (k.length) counters.readopted += k.length; },
  };
}
type PopAggWasmHeap = Parameters<typeof adoptLayers>[1];

// ------------------------------------------------------------------------------------------------ digests
const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex').slice(0, 24);

/** sha256 of every typed-array layer (and arrays of them) of the state */
function layerDigests(o: object): Record<string, string> {
  const m: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) m[k] = sha(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    else if (Array.isArray(v) && v.length && v.every((x) => ArrayBuffer.isView(x))) {
      v.forEach((x: ArrayBufferView, i: number) => { m[`${k}[${i}]`] = sha(new Uint8Array(x.buffer, x.byteOffset, x.byteLength)); });
    }
  }
  return m;
}
/** sha256 over every building's DEFINED fields (sorted ids and keys; numbers as f64 bits): a field declared undefined
 *  reads exactly like an absent one, so the stable-shape arms compare with the others */
function buildingsDigest(sim: Simulation): string {
  const h = createHash('sha256');
  const f = new Float64Array(1), fb = new Uint8Array(f.buffer);
  const ids = [...sim.state.buildings.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const b = sim.state.buildings.get(id)! as unknown as Record<string, unknown>;
    for (const k of Object.keys(b).sort()) {
      const v = b[k];
      if (v === undefined) continue;
      h.update(k);
      if (typeof v === 'number') { f[0] = v; h.update(fb); }
      else if (typeof v === 'string') h.update('s' + v);
      else h.update('j' + JSON.stringify(v));
    }
    h.update('|');
  }
  return h.digest('hex').slice(0, 24);
}

// ------------------------------------------------------------------------------------------------ child (one arm)
type Msg = { type: 'advance'; to: number } | { type: 'reset' } | { type: 'finish' };

async function childMain(args: string[], name: ArmName): Promise<void> {
  const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const fixture = opt('--fixture')!;
  const bytes = new Uint8Array(readFileSync(fixture));
  const c0 = cpuMs();
  const st = deserializeCity((await unpackFile(bytes)) as SerializedCity);
  if (STABLE.has(name)) for (const [id, b] of st.buildings) st.buildings.set(id, stableBuilding(b as unknown as Record<string, unknown>) as unknown as typeof b);
  const systems = createSystems();
  const pi = systems.findIndex((s) => s.name === 'economy.population');
  const rt = (systems[pi] as unknown as { rt: EconRuntime }).rt;
  const counters: Counters = { gatherRejected: 0, readopted: 0 };
  let stats: PopAggBindStats | null = null;
  const wasmArm = name === 'DE' || name === 'DEs';
  const w = wasmArm ? instantiate(new WebAssembly.Module(readFileSync(opt('--simd', 'src/wasm/sim_kernels.wasm')!)), 64 << 20) : null;
  const keeper = w ? residentKeeper(w.heap, counters) : null;
  if (!NO_KERNEL.has(name)) {
    let kernel: ProbeKernel;
    if (name === 'shellOrig') kernel = origKernel();
    else if (name === 'B0' || name === 'B') kernel = bKernel();
    else if (name === 'CE') {
      kernel = soaKernel(new PopAggSoA(), (s, i, g, t, coh, out) => aggregateSoA(s, PROBE_CONSTANTS, i, g, t, coh, out), (n) => new Float32Array(n), counters);
    } else {
      stats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
      const js: PopAggSoAFn = (s, i, g, t, coh, out) => aggregateSoA(s, PROBE_CONSTANTS, i, g, t, coh, out);
      kernel = soaKernel(residentSoA(w!), makePopAggKernels(PROBE_CONSTANTS, js, { wasm: w!, stats }), (n) => w!.heap.allocArray(Float32Array, n), counters,
        keeper!.before);
    }
    systems[pi] = populationSystemShell(rt, kernel);
  }
  const sim = new Simulation(st, systems);
  const adopted: string[] = [];
  if (keeper) {
    const cache = (sim.systems.find((s) => s.name === 'economy.population') as unknown as { __probeCache: object }).__probeCache;
    adopted.push(...keeper.adopt(sim, rt, cache));
  }
  let cur: DayRec = { day: 0, pop: 0, kernel: 0, total: 0, wall: 0, gather: 0 };
  for (const s of sim.systems as SimSystem[]) {
    if (s.name !== 'economy.population') continue;
    const f = s.daily!.bind(s);
    s.daily = (x) => { const t0 = cpuMs(); try { f(x); } finally { cur.pop += cpuMs() - t0; } };
  }
  const advance = (): DayRec => {
    cur = { day: sim.state.day + 1, pop: 0, kernel: 0, total: 0, wall: 0, gather: 0 };
    timing.current = cur;
    const w0 = performance.now(), t0 = cpuMs();
    try { sim.advanceDay(); } finally { timing.current = null; }
    cur.total = cpuMs() - t0;
    cur.wall = performance.now() - w0;
    return cur;
  };
  const send = (m: unknown, cb?: () => void) => process.send!(m, undefined, {}, cb);
  process.on('message', (m: Msg) => {
    try {
      if (m.type === 'advance') {
        const recs: DayRec[] = [];
        while (sim.state.day < m.to) recs.push(advance());
        send({ type: 'advanced', records: recs, day: sim.state.day });
      } else if (m.type === 'reset') {
        if (stats) Object.assign(stats, { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 });
        counters.gatherRejected = 0;
        counters.readopted = 0;
        send({ type: 'reset' });
      } else if (m.type === 'finish') {
        const mem = process.memoryUsage();
        send({
          type: 'final', day: sim.state.day, population: sim.state.stats.population, stats, counters, adopted,
          digest: { layers: layerDigests(sim.state), stats: sha(JSON.stringify(sim.state.stats)), buildings: buildingsDigest(sim) },
          rssMiB: Math.round(mem.rss / 1048576), heapUsedMiB: Math.round(mem.heapUsed / 1048576),
        }, () => process.exit(0));
      }
    } catch (e) {
      send({ type: 'error', error: e instanceof Error ? e.stack : String(e) }, () => process.exit(1));
    }
  });
  send({
    type: 'ready', day: st.day, population: st.stats.population, growables: rt.growables.length, adopted,
    loadCpuMs: Math.round(cpuMs() - c0),
  });
}

// ------------------------------------------------------------------------------------------------ coordinator
const med = (xs: number[]): number => { const s = xs.slice().sort((p, q) => p - q); const n = s.length; return n ? (n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2])) : NaN; };
const mean = (xs: number[]): number => xs.reduce((p, q) => p + q, 0) / Math.max(1, xs.length);
const pct = (xs: number[], p: number): number => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

interface Kid { name: ArmName; cp: ChildProcess; ready: Record<string, unknown>; days: DayRec[]; final?: Record<string, unknown> }

function ask(k: Kid, m: Msg, want: string): Promise<Record<string, unknown>> {
  return new Promise((res, rej) => {
    const onMsg = (r: Record<string, unknown>) => {
      if (r.type === want) { done(); res(r); } else if (r.type === 'error') { done(); rej(new Error(`${k.name}: ${String(r.error)}`)); }
    };
    const onExit = (code: number | null) => { done(); rej(new Error(`${k.name}: child exited (${code}) while waiting for ${want}`)); };
    const done = () => { k.cp.off('message', onMsg); k.cp.off('exit', onExit); };
    k.cp.on('message', onMsg);
    k.cp.on('exit', onExit);
    if (m) k.cp.send(m);
  });
}

async function coordinatorMain(args: string[]): Promise<void> {
  const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const fixture = opt('--fixture')!;
  const warm = Number(opt('--warm', '12'));
  const days = Number(opt('--days', '128'));
  const chunk = Number(opt('--chunk', '3'));
  const jsonOut = opt('--json');
  const armNames = (opt('--e2e-arms', 'asis,shellOrig,B0,Aobj,B,CE,DE,DEs')!.split(',')) as ArmName[];
  for (const n of armNames) if (!(n in LABEL)) throw new Error(`unknown e2e arm ${n} (${Object.keys(LABEL).join(', ')})`);
  const log = (s: string) => console.log(s);
  log(`# node ${process.version} (V8 ${process.versions.v8}), ${cpus().length} cpus (${cpus()[0]?.model}); load average ${loadAvg().join(' ')}`);
  log(`# e2e ${fixture.split('/').pop()}: ${armNames.length} arms, one process each, round-robin in chunks of ${chunk} days (order rotated)`);
  const self = process.argv[1];
  const kids: Kid[] = [];
  try {
    for (const name of armNames) {
      const cp = fork(self, [...args, '--e2e-child', name], { execArgv: ['--max-old-space-size=3072'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      const k: Kid = { name, cp, ready: {}, days: [] };
      k.ready = await ask(k, null as unknown as Msg, 'ready');
      kids.push(k);
      const a = k.ready.adopted as string[];
      log(`# ${name.padEnd(9)} ${LABEL[name]}: day ${k.ready.day}, population ${k.ready.population}, growables ${k.ready.growables}, ` +
        `load + init ${k.ready.loadCpuMs} ms CPU${a.length ? `; in wasm memory: ${a.join(', ')}` : ''}`);
    }
    const n = kids.length;
    let day = Number(kids[0].ready.day);
    for (const k of kids) if (Number(k.ready.day) !== day) throw new Error('arms loaded different days');
    const runRounds = async (to: number, keep: boolean): Promise<void> => {
      for (let r = 0; day < to; r++) {
        const target = Math.min(to, day + chunk);
        for (let q = 0; q < n; q++) {
          const k = kids[(q + r) % n];
          const rep = await ask(k, { type: 'advance', to: target }, 'advanced');
          if (keep) k.days.push(...(rep.records as DayRec[]));
        }
        day = target;
      }
    };
    await runRounds(day + warm, false);
    for (const k of kids) await ask(k, { type: 'reset' }, 'reset');
    const day0 = day, dayEnd = day0 + days;
    const l0 = loadAvg();
    log(`# warm-up ${warm} days done (day ${day0}); measuring ${days} days; load ${l0.join(' ')}`);
    const w0 = performance.now();
    await runRounds(dayEnd, true);
    const l1 = loadAvg();
    log(`# ran ${days} days x ${n} arms in ${((performance.now() - w0) / 1000).toFixed(0)} s wall; load ${l1.join(' ')}`);
    for (const k of kids) k.final = await ask(k, { type: 'finish' }, 'final');

    // -------------------------------------------------------------------------------------------- results
    const maps = new Map(kids.map((k) => [k.name, new Map(k.days.filter((d) => d.day > day0 && d.day <= dayEnd).map((d) => [d.day, d]))]));
    const perArm: Record<string, unknown> = {};
    for (const k of kids) {
      const ds = [...maps.get(k.name)!.values()];
      const col = (key: keyof DayRec) => ds.map((d) => d[key] as number);
      const st = k.final!.stats as PopAggBindStats | null;
      const p = {
        label: LABEL[k.name], days: ds.length,
        popMsPerDay: { mean: mean(col('pop')), median: med(col('pop')), p95: pct(col('pop'), 0.95) },
        kernelMsPerDay: NO_KERNEL.has(k.name) ? null : { mean: mean(col('kernel')), median: med(col('kernel')) },
        gatherMsPerDay: SOA_ARMS.has(k.name) ? { mean: mean(col('gather')), median: med(col('gather')) } : null,
        dayMs: { mean: mean(col('total')), median: med(col('total')), p95: pct(col('total'), 0.95) },
        wallDayMs: { mean: mean(col('wall')), median: med(col('wall')) },
        staged: st ? { calls: st.wasmCalls, jsCalls: st.jsCalls, kibInPerCall: st.bytesIn / Math.max(1, st.wasmCalls) / 1024, kibOutPerCall: st.bytesOut / Math.max(1, st.wasmCalls) / 1024 } : null,
        gatherRejected: (k.final!.counters as Counters).gatherRejected,
        readopted: (k.final!.counters as Counters).readopted,
        population: k.final!.population, rssMiB: k.final!.rssMiB, heapUsedMiB: k.final!.heapUsedMiB,
        /** the measured days (CPU ms: pop / kernel / total; wall ms), for pooling replicate runs */
        records: ds.map((d) => [d.day, +d.pop.toFixed(4), +d.kernel.toFixed(4), +d.total.toFixed(4), +d.wall.toFixed(3), +d.gather.toFixed(4)]),
      };
      perArm[k.name] = p;
      log(`${k.name.padEnd(9)} ${LABEL[k.name].padEnd(40)} population.daily ${p.popMsPerDay.mean.toFixed(3)} ms/day (median ${p.popMsPerDay.median.toFixed(3)})` +
        `${p.kernelMsPerDay ? `, aggregate region ${p.kernelMsPerDay.mean.toFixed(3)} ms` : ''}` +
        `${p.gatherMsPerDay ? ` (gather ${p.gatherMsPerDay.mean.toFixed(3)} ms of it)` : ''}; whole day ${p.dayMs.mean.toFixed(2)} ms (median ${p.dayMs.median.toFixed(2)})` +
        `${p.staged ? `; wasm calls ${p.staged.calls}, JS fallbacks ${p.staged.jsCalls}, staged ${p.staged.kibInPerCall.toFixed(1)} KiB in / ${p.staged.kibOutPerCall.toFixed(1)} KiB out per call` : ''}` +
        `${p.gatherRejected ? `; gather rejected ${p.gatherRejected}x` : ''}${p.readopted ? `; re-adopted ${p.readopted} reallocated array(s)` : ''}`);
    }
    // paired ratios per chunk (candidate / baseline), 95 % bootstrap CI of the median
    const ratio = (A: ArmName, B: ArmName, key: keyof DayRec) => {
      const ma = maps.get(A), mb = maps.get(B);
      if (!ma || !mb) return null;
      const rs: number[] = [];
      for (let c0 = day0 + 1; c0 <= dayEnd; c0 += chunk) {
        let sa = 0, sb = 0, m = 0;
        for (let d = c0; d < c0 + chunk && d <= dayEnd; d++) {
          const x = ma.get(d), y = mb.get(d);
          if (!x || !y) continue;
          sa += x[key] as number; sb += y[key] as number; m++;
        }
        if (m && sa > 0) rs.push(sb / sa);
      }
      const ci = bootstrapMedianCI(rs, 4242);
      const mr = med(rs);
      return { n: rs.length, ratio: mr, lo: ci.lo, hi: ci.hi, speedup: 1 / mr, speedupLo: 1 / ci.hi, speedupHi: 1 / ci.lo };
    };
    const pairs: [string, ArmName, ArmName][] = [
      ['asis -> shellOrig (control)', 'asis', 'shellOrig'], ['asis -> B0', 'asis', 'B0'], ['asis -> Aobj', 'asis', 'Aobj'], ['asis -> B', 'asis', 'B'],
      ['asis -> CE', 'asis', 'CE'], ['asis -> DE', 'asis', 'DE'], ['asis -> DEs', 'asis', 'DEs'],
      ['shellOrig -> B0', 'shellOrig', 'B0'], ['shellOrig -> CE', 'shellOrig', 'CE'], ['shellOrig -> DE', 'shellOrig', 'DE'], ['Aobj -> B', 'Aobj', 'B'],
      ['B0 -> DE', 'B0', 'DE'], ['B -> DEs', 'B', 'DEs'], ['CE -> DE', 'CE', 'DE'],
    ];
    const ratios: Record<string, unknown> = {};
    for (const [label, A, B] of pairs) {
      const rows: Record<string, unknown> = {};
      for (const key of ['pop', 'kernel', 'total'] as const) {
        if (key === 'kernel' && (NO_KERNEL.has(A) || NO_KERNEL.has(B))) continue;
        const r = ratio(A, B, key);
        if (!r) continue;
        rows[key] = r;
        log(`${label.padEnd(28)} ${key.padEnd(6)} speedup ${r.speedup.toFixed(3)}x [${r.speedupLo.toFixed(3)}, ${r.speedupHi.toFixed(3)}] (n=${r.n} chunks of ${chunk} days)`);
      }
      if (Object.keys(rows).length) ratios[label] = rows;
    }
    // identical cities (headless: nothing depends on timing)
    const ref = kids[0].final!.digest as { layers: Record<string, string>; stats: string; buildings: string };
    let identical = true;
    for (const k of kids.slice(1)) {
      const d = k.final!.digest as typeof ref;
      for (const [key, h] of Object.entries(ref.layers)) if (d.layers[key] !== h) { identical = false; log(`# NOT identical: ${k.name} layer ${key}`); }
      if (Object.keys(d.layers).length !== Object.keys(ref.layers).length) { identical = false; log(`# NOT identical: ${k.name} layer set`); }
      if (d.stats !== ref.stats) { identical = false; log(`# NOT identical: ${k.name} stats`); }
      if (d.buildings !== ref.buildings) { identical = false; log(`# NOT identical: ${k.name} buildings`); }
    }
    log(`# cities after ${warm + days} days: ${identical ? `bit-identical across all ${n} arms (${Object.keys(ref.layers).length} state layers, stats, every building's fields)` : 'DIFFERENT'}`);
    const result = { fixture, warm, days, chunk, day0, arms: perArm, ratios, identical, load: { before: l0, after: l1 }, node: process.version, v8: process.versions.v8 };
    if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(result, null, 1)); log(`# wrote ${jsonOut}`); }
  } finally {
    for (const k of kids) if (k.cp.exitCode === null) k.cp.kill();
  }
}

// ------------------------------------------------------------------------------------------------ entry
{
  const args = process.argv.slice(2);
  const ci = args.indexOf('--e2e-child');
  const run = ci >= 0 ? childMain(args.filter((_, i) => i !== ci && i !== ci + 1), args[ci + 1] as ArmName) : coordinatorMain(args);
  run.catch((e) => {
    console.error(e instanceof Error ? e.stack : e);
    process.exit(1);
  });
}
