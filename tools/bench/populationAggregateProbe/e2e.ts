/**
 * Population aggregate probe — END-TO-END: the whole simulation at 1M population (the frozen 24f8609 tree via
 * plugins.mjs), one Simulation per arm, advanced headless in interleaved chunks of days (arm order rotated every round),
 * CPU time from an otherwise idle worker thread. Measures the containing system's cost — economy.population daily
 * (construction + occupancy + aggregate + demographics events) in ms/day — with the probed aggregate region swapped.
 *
 *   node e2e.mjs --fixture F.metropolis [--warm 8] [--days 96] [--chunk 3] [--e2e-arms asis,shellOrig,B,CE,DE]
 *        [--simd src/wasm/sim_kernels.wasm] [--json out.json]
 *
 * Arms (nothing on disk is edited; the shell is a bundle-time copy of the frozen population.ts, plugins.mjs popShell):
 *   asis       the genuine systems
 *   shellOrig  population system = the shell running the VERBATIM original region (tests/wasm/populationAggregateOriginal.ts):
 *              the JS-vs-JS control (asis vs shellOrig must be ~1.00x: the swap mechanism itself costs nothing)
 *   B          shell + aggregateObjects with the def index, on the sim's own objects (its buildings already share one
 *              hidden class after load: see node suite arm B0 vs B)
 *   CE         shell + gather (E) + JS SoA loop (C) every day
 *   DE         shell + gather (E) into a SoA in wasm memory + the wasm kernel (D); rt's coarse grids, the population
 *              system's DemographicsCache.wf and traffic.accessById adopted into the same wasm memory (zero copy; if the
 *              sim reallocates one, the binding stages it — `staged` reports the bytes)
 * Headless days keep the cities bit-identical across arms: checked at the end (every typed-array layer of the state,
 * the stats, every building's fields).
 */
import { readFileSync } from 'node:fs';
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
import { makePopAggKernels, type PopAggBindStats, type PopAggSoAFn, type PopAggWasm } from '../../../src/wasm/kernels/populationAggregateProbeBind';
import { adoptLayers } from '../../../src/wasm/layers';
import { makeOriginalAggregate, type OrigCache, type OrigRuntime, type OrigSim } from '../../../tests/wasm/populationAggregateOriginal';
import { bootstrapMedianCI } from '../ab';
import { benchMain, cpuMs, loadAvg } from '../node';
import { PROBE_CONSTANTS, instantiate, residentSoA } from './core';

type ArmName = 'asis' | 'shellOrig' | 'B' | 'CE' | 'DE';
const LABEL: Record<ArmName, string> = {
  asis: 'genuine population system', shellOrig: 'shell + verbatim original (control)', B: 'shell + fair JS (def index)',
  CE: 'shell + gather + JS SoA', DE: 'shell + gather + wasm (resident)',
};

interface DayRec { day: number; pop: number; kernel: number; total: number }

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
  return {
    out,
    prepare(sim: Simulation, rt: EconRuntime, cache: { wf: Float32Array }, inf: { traffic: boolean }, sample: boolean, demo: boolean, dd: { eduMean: number }) {
      const cw = rt.cw, cc = cw * cw;
      inp.cw = cw; inp.sample = sample; inp.demo = demo; inp.mWf = cache.wf;
      const traffic = trafficOf(sim, inf);
      inp.tAcc = traffic !== undefined;
      inp.accArr = traffic && traffic.accessById instanceof Float32Array ? traffic.accessById : undefined;
      inp.workerAccess = traffic ? (id: number) => traffic.workerAccess!(id) : undefined;
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

/** gather + a SoA loop (JS or wasm); falls back to the object loop when the gather rejects a value */
function soaKernel(soa: PopAggSoA, loop: PopAggSoAFn, allocGrid: (n: number) => Float32Array, counters: { gatherRejected: number }): ProbeKernel {
  const glue = kernelGlue(allocGrid);
  const defs = new DefIndex((id) => getDef(id), PROBE_CONSTANTS.DEV_TYPE_COUNT);
  return {
    run(sim, rt, cache, inf, _first, sample, demo, dd, coh) {
      const t0 = cpuMs();
      const { inp, g, traffic } = glue.prepare(sim, rt, cache, inf, sample, demo, dd);
      const list = rt.growables as unknown as PopAggBuilding[];
      if (gatherSoA(list, defs, PROBE_CONSTANTS, rt.cw, soa, gatherNeed(sample, demo))) loop(soa, inp, g, rt.totals, coh, glue.out);
      else { counters.gatherRejected++; aggregateObjects(list, defs, PROBE_CONSTANTS, inp, g, rt.totals, coh, glue.out); }
      const o = glue.out;
      if (timing.current) timing.current.kernel += cpuMs() - t0;
      return { W: o.W, eduSum: o.eduSum, eduPop: o.eduPop, accE: o.accE, accW: o.accW, unW: o.unW, tAcc: traffic };
    },
  };
}

// ------------------------------------------------------------------------------------------------ helpers
const med = (xs: number[]): number => { const s = xs.slice().sort((p, q) => p - q); const n = s.length; return n ? (n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2])) : NaN; };
const mean = (xs: number[]): number => xs.reduce((p, q) => p + q, 0) / Math.max(1, xs.length);
const pct = (xs: number[], p: number): number => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/** every typed-array layer (and arrays of them) of an object: name -> bytes */
function layers(o: object): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(o)) {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) m.set(k, new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    else if (Array.isArray(v) && v.length && v.every((x) => ArrayBuffer.isView(x))) v.forEach((x: ArrayBufferView, i: number) => m.set(`${k}[${i}]`, new Uint8Array(x.buffer, x.byteOffset, x.byteLength)));
  }
  return m;
}
/** a digest of every building's fields (FNV-1a over the numbers' f64 bits and the def ids) */
function buildingsDigest(sim: Simulation): string {
  const f = new Float64Array(1), u = new Uint32Array(f.buffer);
  let h = 0x811c9dc5 >>> 0;
  const mix = (x: number) => { h ^= x; h = Math.imul(h, 0x01000193) >>> 0; };
  const ids = [...sim.state.buildings.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const b = sim.state.buildings.get(id)! as unknown as Record<string, unknown>;
    for (const k of Object.keys(b).sort()) {
      const v = b[k];
      if (typeof v === 'number') { f[0] = v; mix(u[0]); mix(u[1]); }
      else if (typeof v === 'string') for (let i = 0; i < v.length; i++) mix(v.charCodeAt(i));
      else if (v === undefined) mix(7);
    }
  }
  return h.toString(16);
}

// ------------------------------------------------------------------------------------------------ main
benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const fixture = opt('--fixture')!;
  const warm = Number(opt('--warm', '8'));
  const days = Number(opt('--days', '96'));
  const chunk = Number(opt('--chunk', '3'));
  const armNames = (opt('--e2e-arms', 'asis,shellOrig,B,CE,DE')!.split(',')) as ArmName[];
  const bytes = new Uint8Array(readFileSync(fixture));
  const w: PopAggWasm = instantiate(new WebAssembly.Module(readFileSync(opt('--simd', 'src/wasm/sim_kernels.wasm')!)), 64 << 20);

  interface SimArm { name: ArmName; sim: Simulation; days: DayRec[]; cur: DayRec; stats: PopAggBindStats | null; counters: { gatherRejected: number }; adopted: string[] }
  const arms: SimArm[] = [];
  for (const name of armNames) {
    const st = deserializeCity((await unpackFile(bytes)) as SerializedCity);
    const systems = createSystems();
    const pi = systems.findIndex((s) => s.name === 'economy.population');
    const rt = (systems[pi] as unknown as { rt: EconRuntime }).rt;
    const counters = { gatherRejected: 0 };
    let stats: PopAggBindStats | null = null;
    if (name !== 'asis') {
      let kernel: ProbeKernel;
      if (name === 'shellOrig') kernel = origKernel();
      else if (name === 'B') kernel = bKernel();
      else if (name === 'CE') {
        kernel = soaKernel(new PopAggSoA(), (s, i, g, t, coh, out) => aggregateSoA(s, PROBE_CONSTANTS, i, g, t, coh, out), (n) => new Float32Array(n), counters);
      } else {
        stats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
        const js: PopAggSoAFn = (s, i, g, t, coh, out) => aggregateSoA(s, PROBE_CONSTANTS, i, g, t, coh, out);
        kernel = soaKernel(residentSoA(w), makePopAggKernels(PROBE_CONSTANTS, js, { wasm: w, stats }), (n) => w.heap.allocArray(Float32Array, n), counters);
      }
      systems[pi] = populationSystemShell(rt, kernel);
    }
    const sim = new Simulation(st, systems);
    const adopted: string[] = [];
    if (name === 'DE') {
      // the architect's memory model for this kernel's inputs / outputs: rt's coarse grids, the population system's
      // DemographicsCache.wf and traffic.accessById live in the kernel's wasm memory
      const GRIDS = ['coarsePopRaw', 'coarseWealthRaw', 'coarseCountRaw', 'coarsePop', 'coarseWealth', 'coarsePopW', 'coarseSkill', 'coarseKids'];
      adopted.push(...adoptLayers(rt, w.heap, { include: (k) => GRIDS.includes(k) }).keys);
      const cache = (sim.systems.find((s) => s.name === 'economy.population') as unknown as { __probeCache: object }).__probeCache;
      adopted.push(...adoptLayers(cache, w.heap, { include: (k) => k === 'wf' }).keys.map((k) => 'cache.' + k));
      const traffic = sim.getSystem('traffic');
      if (traffic) adopted.push(...adoptLayers(traffic, w.heap, { include: (k) => k === 'accessById' }).keys.map((k) => 'traffic.' + k));
    }
    const arm: SimArm = { name, sim, days: [], cur: { day: 0, pop: 0, kernel: 0, total: 0 }, stats, counters, adopted };
    for (const s of sim.systems as SimSystem[]) {
      if (s.name !== 'economy.population') continue;
      const f = s.daily!.bind(s);
      s.daily = (x) => { const t0 = cpuMs(); try { f(x); } finally { arm.cur.pop += cpuMs() - t0; } };
    }
    const ad = sim.advanceDay.bind(sim);
    sim.advanceDay = () => {
      arm.cur = { day: sim.state.day + 1, pop: 0, kernel: 0, total: 0 };
      timing.current = arm.cur;
      const t0 = cpuMs();
      try { ad(); } finally { timing.current = null; }
      arm.cur.total = cpuMs() - t0;
      arm.days.push(arm.cur);
    };
    arms.push(arm);
    log(`# ${LABEL[name]}: ${fixture.split('/').pop()} day ${st.day}, population ${st.stats.population}, growables ${rt.growables.length}` +
      `${adopted.length ? `; in wasm memory: ${adopted.join(', ')}` : ''}`);
  }

  for (let d = 0; d < warm; d++) for (const a of arms) a.sim.advanceDay();
  for (const a of arms) { a.days.length = 0; if (a.stats) Object.assign(a.stats, { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 }); }
  const day0 = arms[0].sim.state.day;
  const l0 = loadAvg();
  log(`# warm-up ${warm} days done (day ${day0}); ${days} days in chunks of ${chunk}, ${arms.length} arms interleaved (order rotated); load ${l0.join(' ')}`);
  const rounds = Math.ceil(days / chunk);
  const w0 = performance.now();
  for (let r = 0; r < rounds; r++) {
    const target = day0 + Math.min(days, (r + 1) * chunk);
    for (let k = 0; k < arms.length; k++) {
      const a = arms[(k + r) % arms.length];
      while (a.sim.state.day < target) a.sim.advanceDay();
    }
  }
  log(`# ran ${days} days x ${arms.length} arms in ${((performance.now() - w0) / 1000).toFixed(0)} s wall; load ${loadAvg().join(' ')}`);

  // ---------------------------------------------------------------------------------------------- results
  const dayEnd = day0 + days;
  const maps = new Map(arms.map((a) => [a.name, new Map(a.days.filter((d) => d.day > day0 && d.day <= dayEnd).map((d) => [d.day, d]))]));
  const perArm: Record<string, unknown> = {};
  for (const a of arms) {
    const ds = [...maps.get(a.name)!.values()];
    const col = (k: keyof DayRec) => ds.map((d) => d[k] as number);
    const p = {
      label: LABEL[a.name], days: ds.length,
      popMsPerDay: { mean: mean(col('pop')), median: med(col('pop')), p95: pct(col('pop'), 0.95) },
      kernelMsPerDay: a.name === 'asis' ? null : { mean: mean(col('kernel')), median: med(col('kernel')) },
      dayMs: { mean: mean(col('total')), median: med(col('total')), p95: pct(col('total'), 0.95) },
      staged: a.stats ? { calls: a.stats.wasmCalls, jsCalls: a.stats.jsCalls, kibInPerCall: a.stats.bytesIn / Math.max(1, a.stats.wasmCalls) / 1024, kibOutPerCall: a.stats.bytesOut / Math.max(1, a.stats.wasmCalls) / 1024 } : null,
      gatherRejected: a.counters.gatherRejected,
      population: a.sim.state.stats.population,
    };
    perArm[a.name] = p;
    log(`${LABEL[a.name].padEnd(38)} population.daily ${p.popMsPerDay.mean.toFixed(3)} ms/day (median ${p.popMsPerDay.median.toFixed(3)})` +
      `${p.kernelMsPerDay ? `, of which the aggregate region ${p.kernelMsPerDay.mean.toFixed(3)} ms` : ''}; whole day ${p.dayMs.mean.toFixed(2)} ms (median ${p.dayMs.median.toFixed(2)})` +
      `${p.staged ? `; wasm calls ${p.staged.calls}, JS fallbacks ${p.staged.jsCalls}, staged ${p.staged.kibInPerCall.toFixed(1)} KiB in / ${p.staged.kibOutPerCall.toFixed(1)} KiB out per call` : ''}`);
  }
  // paired ratios per chunk (B / A), 95 % bootstrap CI of the median
  const ratio = (A: ArmName, B: ArmName, key: keyof DayRec) => {
    const ma = maps.get(A), mb = maps.get(B);
    if (!ma || !mb) return null;
    const rs: number[] = [];
    for (let c0 = day0 + 1; c0 <= dayEnd; c0 += chunk) {
      let sa = 0, sb = 0, n = 0;
      for (let d = c0; d < c0 + chunk && d <= dayEnd; d++) {
        const x = ma.get(d), y = mb.get(d);
        if (!x || !y) continue;
        sa += x[key] as number; sb += y[key] as number; n++;
      }
      if (n && sa > 0) rs.push(sb / sa);
    }
    const ci = bootstrapMedianCI(rs, 4242);
    const m = med(rs);
    return { n: rs.length, ratio: m, lo: ci.lo, hi: ci.hi, speedup: 1 / m, speedupLo: 1 / ci.hi, speedupHi: 1 / ci.lo };
  };
  const pairs: [string, ArmName, ArmName][] = [
    ['asis -> shellOrig (control)', 'asis', 'shellOrig'], ['asis -> B', 'asis', 'B'], ['asis -> CE', 'asis', 'CE'], ['asis -> DE', 'asis', 'DE'],
    ['shellOrig -> B', 'shellOrig', 'B'], ['shellOrig -> CE', 'shellOrig', 'CE'], ['shellOrig -> DE', 'shellOrig', 'DE'], ['B -> DE', 'B', 'DE'], ['CE -> DE', 'CE', 'DE'],
  ];
  const ratios: Record<string, unknown> = {};
  for (const [label, A, B] of pairs) {
    const rows: Record<string, unknown> = {};
    for (const key of ['pop', 'kernel', 'total'] as const) {
      if (key === 'kernel' && (A === 'asis' || B === 'asis')) continue;
      const r = ratio(A, B, key);
      if (!r) continue;
      rows[key] = r;
      log(`${label.padEnd(28)} ${key.padEnd(6)} speedup ${r.speedup.toFixed(3)}x [${r.speedupLo.toFixed(3)}, ${r.speedupHi.toFixed(3)}] (n=${r.n} chunks of ${chunk} days)`);
    }
    if (Object.keys(rows).length) ratios[label] = rows;
  }
  // identical cities (headless: nothing depends on timing)
  const ref = arms[0].sim;
  const refLayers = layers(ref.state), refStats = JSON.stringify(ref.state.stats), refDigest = buildingsDigest(ref);
  let identical = true;
  for (const a of arms.slice(1)) {
    for (const [k, v] of layers(a.sim.state)) {
      const u = refLayers.get(k);
      if (!u || u.length !== v.length || u.some((x, i) => x !== v[i])) { identical = false; log(`# NOT identical: ${a.name} layer ${k}`); break; }
    }
    if (JSON.stringify(a.sim.state.stats) !== refStats) { identical = false; log(`# NOT identical: ${a.name} stats`); }
    if (buildingsDigest(a.sim) !== refDigest) { identical = false; log(`# NOT identical: ${a.name} buildings`); }
  }
  log(`# cities after ${warm + days} days: ${identical ? 'bit-identical across all arms (layers, stats, every building field)' : 'DIFFERENT'}`);
  return { fixture, warm, days, chunk, day0, arms: perArm, ratios, identical, load: { before: l0, after: loadAvg() } };
});
