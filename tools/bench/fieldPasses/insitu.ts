/**
 * In-situ A/B of the field passes: the whole simulation (the frozen 24f8609 tree via plugins.mjs), one Simulation per
 * arm, CPU time from an otherwise idle worker thread.
 *
 *   node fieldPasses.insitu.mjs --fixture F.metropolis [--water coast] [--mode cycles|days] [--warm 20] [--reps 31]
 *        [--days 62] [--chunk 2] [--arms asis,fair,wasmRes,wasmStaged] [--json out.json]
 *
 * Arms: asis = the genuine systems (pollution.ts methods, nimby.ts); fair = installFieldPasses(fair JS) + makeNimby(fair
 * JS); wasmRes = the wasm kernels with the CityState layers and the PollutionSystem field arrays adopted into wasm memory
 * (zero copy); wasmStaged = the wasm kernels on plain arrays (every call copies its arrays in / out). NIMBY is swapped per
 * CityState through the nimbySwitch module redirect (services.ts imports nimby.ts).
 *
 * --mode cycles: back-to-back full pollution passes (compute, as a regular pass: dt = POLL_PERIOD days) and NIMBY
 *   rebuilds, arms interleaved with rotated order, `reps` rounds after 2 warm-up rounds; per rep and arm: the pass CPU
 *   (and its field steps 4, 6–9 / other steps), the rebuild CPU. Paired ratios per round with 95 % bootstrap CIs.
 * --mode days: design cadence (advanceDay + scheduler flush every day: every due infra step completes that day), arms
 *   interleaved in chunks of `chunk` days (order rotated per round). Per day: the pollution system's steps, its field
 *   steps, the NIMBY rebuild, the services steps (the rebuild's containing system), the whole day. Paired ratios per
 *   chunk. At the end the cities of all arms must be bit-identical (layers + stats).
 */
import type { CityState } from '../../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { schedulerOf } from '../../../src/sim/infra/scheduler';
import { POLL_PERIOD, type PollutionSystem } from '../../../src/sim/infra/pollution';
import { nimbyCost as origNimbyCost, rebuildNimby as origRebuildNimby } from '../../../src/sim/infra/nimby';
import { adoptLayers } from '../../../src/wasm/layers';
import { fieldKernelsJs, type FieldKernels } from '../../../src/wasm/js/fieldPasses';
import { adoptPollutionArrays, installFieldPasses, makeFieldKernels, makeNimby, type FieldsBindStats } from '../../../src/wasm/kernels/fieldPasses';
import { bootstrapMedianCI } from '../ab';
import { benchMain, cpuMs, loadAvg } from '../node';
import { instantiate } from './core';
import { loadFixture, overlayWater } from './capture';
import { readFileSync } from 'node:fs';

type ArmName = 'asis' | 'fair' | 'wasmRes' | 'wasmStaged';
const LABEL: Record<ArmName, string> = { asis: 'JS as-is', fair: 'fair JS', wasmRes: 'wasm resident', wasmStaged: 'wasm staged' };

interface Rec { day: number; pollution: number; fields: number; nimby: number; services: number; total: number }
interface Arm {
  name: ArmName;
  sim: Simulation;
  pol: PollutionSystem;
  cur: Rec;
  recs: Rec[];
  stats: FieldsBindStats | null;
  rebuild(sim: Simulation): void;
}

const FIELD_STEPS = new Set([4, 6, 7, 8, 9]);
const med = (xs: number[]): number => { const s = xs.slice().sort((p, q) => p - q); const n = s.length; return n ? (n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2])) : NaN; };
const mean = (xs: number[]): number => xs.reduce((p, q) => p + q, 0) / Math.max(1, xs.length);

const NEVER: FieldKernels = {
  kind: 'never',
  nimby() { throw new Error('nimby fell back to JS'); },
  cells() { throw new Error('cells fell back to JS'); },
  saturate() { throw new Error('saturate fell back to JS'); },
  water() { throw new Error('water fell back to JS'); },
  soil() { throw new Error('soil fell back to JS'); },
};

benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const fixture = opt('--fixture')!;
  const water = opt('--water', '')!;
  const mode = opt('--mode', 'days')!;
  const warm = Number(opt('--warm', '20'));
  const reps = Number(opt('--reps', '31'));
  const days = Number(opt('--days', '62'));
  const chunk = Number(opt('--chunk', '2'));
  const armNames = opt('--arms', 'asis,fair,wasmRes,wasmStaged')!.split(',') as ArmName[];
  const simdFile = opt('--simd', 'src/wasm/sim_kernels.wasm')!;
  const w = instantiate(new WebAssembly.Module(readFileSync(simdFile)), 256 << 20);
  const reg = ((globalThis as { __nimbySwitch?: WeakMap<CityState, unknown> }).__nimbySwitch ??= new WeakMap());

  // ---------------------------------------------------------------------------------------------- arms
  const arms: Arm[] = [];
  for (const name of armNames) {
    const st = await loadFixture(fixture);
    const added = water ? overlayWater(st, water === 'river' ? 'river' : 'coast') : 0;
    const systems = createSystems();
    let stats: FieldsBindStats | null = null;
    let kernels: FieldKernels | null = null;
    if (name === 'fair') kernels = fieldKernelsJs;
    else if (name !== 'asis') {
      stats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
      kernels = makeFieldKernels(NEVER, { wasm: w, stats, onError: (e) => { throw e; } });
    }
    const impl = kernels ? makeNimby(kernels) : { rebuildNimby: origRebuildNimby, nimbyCost: origNimbyCost };
    const box: { arm?: Arm } = {};
    const rebuild = (sim: Simulation) => {
      const t0 = cpuMs();
      try { impl.rebuildNimby(sim); } finally { if (box.arm) box.arm.cur.nimby += cpuMs() - t0; }
    };
    reg.set(st, { rebuildNimby: rebuild, nimbyCost: impl.nimbyCost });
    if (name === 'wasmRes') adoptLayers(st, w.heap, { reserveExtra: 32 << 20 });
    const sim = new Simulation(st, systems);
    const pol = sim.getSystem('pollution') as unknown as PollutionSystem;
    if (kernels) installFieldPasses(pol, kernels);
    if (name === 'wasmRes') adoptPollutionArrays(pol, w.heap);
    const arm: Arm = { name, sim, pol, cur: { day: 0, pollution: 0, fields: 0, nimby: 0, services: 0, total: 0 }, recs: [], stats, rebuild };
    box.arm = arm;
    // step timers (the scheduler calls pollution.step / services.step through closures: instance overrides work)
    const pRec = pol as unknown as { step(s: Simulation): void; stepIdx: number };
    const pStep = pRec.step.bind(pol);
    pRec.step = (s) => {
      const k = pRec.stepIdx < 0 ? 0 : pRec.stepIdx;
      const t0 = cpuMs();
      try { pStep(s); } finally { const c = cpuMs() - t0; arm.cur.pollution += c; if (FIELD_STEPS.has(k)) arm.cur.fields += c; }
    };
    const svc = sim.systems.find((s: SimSystem) => s.name === 'services') as unknown as { step(s: Simulation): void };
    const sStep = svc.step.bind(svc);
    svc.step = (s) => { const t0 = cpuMs(); try { sStep(s); } finally { arm.cur.services += cpuMs() - t0; } };
    arms.push(arm);
    log(`# ${LABEL[name]}: ${fixture.split('/').pop()}${water ? ` + ${water} water (${added} cells)` : ''}, day ${st.day}, population ${st.stats.population}` +
      `${name === 'wasmRes' ? ', CityState layers + pollution field arrays resident in wasm memory' : ''}`);
  }
  const day = (a: Arm) => {
    a.cur = { day: a.sim.state.day + 1, pollution: 0, fields: 0, nimby: 0, services: 0, total: 0 };
    const t0 = cpuMs();
    a.sim.advanceDay();
    schedulerOf(a.sim).flush(a.sim);
    a.cur.total = cpuMs() - t0;
    a.recs.push(a.cur);
  };
  for (let d = 0; d < warm; d++) for (const a of arms) day(a);
  for (const a of arms) { a.recs.length = 0; if (a.stats) Object.assign(a.stats, { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 }); }
  log(`# warm-up ${warm} days at design cadence done (day ${arms[0].sim.state.day}); load ${loadAvg().join(' ')}`);

  const ratioOf = (xs: number[]) => {
    const ci = bootstrapMedianCI(xs, 4242);
    const m = med(xs);
    return { n: xs.length, ratio: m, speedup: 1 / m, lo: 1 / ci.hi, hi: 1 / ci.lo };
  };
  /**
   * speedup = sum(A) / sum(B) over paired units (chunks / rounds) with a 95 % bootstrap CI (resampling the units): the
   * robust statistic for rare heavy events (a pollution pass lands in few chunks, so a median of chunk ratios mostly
   * measures the chunks without one)
   */
  const totalsOf = (a: number[], b: number[]) => {
    let s = 0x9e3779b9;
    const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const n = a.length;
    const sum = (x: number[], idx?: number[]) => (idx ? idx.reduce((p, i) => p + x[i], 0) : x.reduce((p, q) => p + q, 0));
    const sp: number[] = [];
    for (let k = 0; k < 2000; k++) {
      const idx = Array.from({ length: n }, () => (r() * n) | 0);
      const sb = sum(b, idx);
      if (sb > 0) sp.push(sum(a, idx) / sb);
    }
    sp.sort((p, q) => p - q);
    return { n, speedup: sum(a) / Math.max(1e-12, sum(b)), lo: sp[Math.floor(0.025 * sp.length)], hi: sp[Math.min(sp.length - 1, Math.ceil(0.975 * sp.length))] };
  };
  const out: Record<string, unknown> = { fixture, water, mode, warm, arms: armNames };

  if (mode === 'cycles') {
    // ------------------------------------------------------------------------------------------- back-to-back passes
    type Sample = { pass: number; fields: number; other: number; nimby: number };
    const S = new Map<ArmName, Sample[]>(arms.map((a) => [a.name, []]));
    const pass = (a: Arm): Sample => {
      const priv = a.pol as unknown as { lastRun: number };
      priv.lastRun = a.sim.state.day - POLL_PERIOD;
      a.cur = { day: 0, pollution: 0, fields: 0, nimby: 0, services: 0, total: 0 };
      const t0 = cpuMs();
      a.pol.compute(a.sim, false);
      const passMs = cpuMs() - t0;
      a.rebuild(a.sim);
      return { pass: passMs, fields: a.cur.fields, other: a.cur.pollution - a.cur.fields, nimby: a.cur.nimby };
    };
    for (let r = -2; r < reps; r++) {
      for (let k = 0; k < arms.length; k++) {
        const a = arms[(k + Math.max(0, r)) % arms.length];
        const s = pass(a);
        if (r >= 0) S.get(a.name)!.push(s);
      }
    }
    log(`\n## ${reps} rounds of one pollution pass (compute) + one NIMBY rebuild per arm, interleaved; load ${loadAvg().join(' ')}`);
    const perArm: Record<string, unknown> = {};
    for (const a of arms) {
      const xs = S.get(a.name)!;
      const col = (k: keyof Sample) => xs.map((x) => x[k]);
      perArm[a.name] = { pass: { median: med(col('pass')), min: Math.min(...col('pass')) }, fields: { median: med(col('fields')), min: Math.min(...col('fields')) }, other: { median: med(col('other')) }, nimby: { median: med(col('nimby')), min: Math.min(...col('nimby')) }, stats: a.stats };
      log(`${LABEL[a.name].padEnd(14)} pass ${med(col('pass')).toFixed(2)} ms (min ${Math.min(...col('pass')).toFixed(2)}; field steps ${med(col('fields')).toFixed(2)}, other steps ${med(col('other')).toFixed(2)}), NIMBY rebuild ${med(col('nimby')).toFixed(2)} ms (min ${Math.min(...col('nimby')).toFixed(2)})`);
    }
    const ratios: Record<string, unknown> = {};
    const base = arms[0].name;
    for (const a of arms.slice(1)) {
      for (const k of ['pass', 'fields', 'nimby'] as const) {
        const A = S.get(base)!, B = S.get(a.name)!;
        const r = ratioOf(A.map((x, i) => B[i][k] / Math.max(1e-9, x[k])));
        const t = totalsOf(A.map((x) => x[k]), B.map((x) => x[k]));
        ratios[`${LABEL[base]} -> ${LABEL[a.name]} ${k}`] = { ...r, totals: t };
        log(`${`${LABEL[base]} -> ${LABEL[a.name]}`.padEnd(30)} ${k.padEnd(6)} speedup ${r.speedup.toFixed(2)}x [${r.lo.toFixed(2)}, ${r.hi.toFixed(2)}] (n=${r.n}); totals ${t.speedup.toFixed(2)}x [${t.lo.toFixed(2)}, ${t.hi.toFixed(2)}]`);
      }
    }
    if (arms.some((a) => a.name === 'fair')) {
      const A = S.get('fair')!;
      for (const a of arms.filter((x) => x.name.startsWith('wasm'))) {
        for (const k of ['pass', 'fields', 'nimby'] as const) {
          const B = S.get(a.name)!;
          const r = ratioOf(A.map((x, i) => B[i][k] / Math.max(1e-9, x[k])));
          const t = totalsOf(A.map((x) => x[k]), B.map((x) => x[k]));
          ratios[`fair JS -> ${LABEL[a.name]} ${k}`] = { ...r, totals: t };
          log(`${`fair JS -> ${LABEL[a.name]}`.padEnd(30)} ${k.padEnd(6)} speedup ${r.speedup.toFixed(2)}x [${r.lo.toFixed(2)}, ${r.hi.toFixed(2)}] (n=${r.n}); totals ${t.speedup.toFixed(2)}x [${t.lo.toFixed(2)}, ${t.hi.toFixed(2)}]`);
        }
      }
    }
    Object.assign(out, { reps, perArm, ratios, samples: Object.fromEntries([...S].map(([k, v]) => [k, v])) });
  } else {
    // ------------------------------------------------------------------------------------------- design cadence days
    const rounds = Math.ceil(days / chunk);
    const day0 = arms[0].sim.state.day;
    for (let r = 0; r < rounds; r++) {
      const target = day0 + Math.min(days, (r + 1) * chunk);
      for (let k = 0; k < arms.length; k++) {
        const a = arms[(k + r) % arms.length];
        while (a.sim.state.day < target) day(a);
      }
    }
    log(`\n## design cadence (advanceDay + flush): ${days} days in ${rounds} interleaved chunks of ${chunk} days; load ${loadAvg().join(' ')}`);
    const perArm: Record<string, unknown> = {};
    for (const a of arms) {
      const col = (k: keyof Rec) => a.recs.map((x) => x[k]);
      perArm[a.name] = {
        days: a.recs.length, pollution: mean(col('pollution')), fields: mean(col('fields')), nimby: mean(col('nimby')), services: mean(col('services')),
        total: mean(col('total')), totalMedian: med(col('total')), stats: a.stats,
      };
      log(`${LABEL[a.name].padEnd(14)} ms/day: pollution ${mean(col('pollution')).toFixed(3)} (field steps ${mean(col('fields')).toFixed(3)}), NIMBY ${mean(col('nimby')).toFixed(3)}, ` +
        `services ${mean(col('services')).toFixed(3)}, pollution + NIMBY ${(mean(col('pollution')) + mean(col('nimby'))).toFixed(3)}, whole day ${mean(col('total')).toFixed(2)} (median ${med(col('total')).toFixed(2)})`);
    }
    const chunkRatios = (A: Arm, B: Arm, f: (x: Rec) => number) => {
      const rs: number[] = [];
      for (let c0 = 0; c0 < A.recs.length; c0 += chunk) {
        let sa = 0, sb = 0;
        for (let d = c0; d < c0 + chunk && d < A.recs.length; d++) { sa += f(A.recs[d]); sb += f(B.recs[d]); }
        if (sa > 0) rs.push(sb / sa);
      }
      return ratioOf(rs);
    };
    const ratios: Record<string, unknown> = {};
    const metrics: [string, (x: Rec) => number][] = [
      ['pollution+NIMBY', (x) => x.pollution + x.nimby], ['field steps+NIMBY', (x) => x.fields + x.nimby], ['pollution', (x) => x.pollution],
      ['NIMBY', (x) => x.nimby], ['services', (x) => x.services], ['whole day', (x) => x.total],
    ];
    const pairs: [Arm, Arm][] = [];
    const byName = new Map(arms.map((a) => [a.name, a]));
    for (const [x, y] of [['asis', 'fair'], ['fair', 'wasmRes'], ['fair', 'wasmStaged'], ['asis', 'wasmRes'], ['wasmStaged', 'wasmRes']] as [ArmName, ArmName][]) {
      if (byName.has(x) && byName.has(y)) pairs.push([byName.get(x)!, byName.get(y)!]);
    }
    const chunkSums = (X: Arm, f: (x: Rec) => number) => {
      const out: number[] = [];
      for (let c0 = 0; c0 < X.recs.length; c0 += chunk) {
        let s = 0;
        for (let d = c0; d < c0 + chunk && d < X.recs.length; d++) s += f(X.recs[d]);
        out.push(s);
      }
      return out;
    };
    for (const [A, B] of pairs) {
      for (const [k, f] of metrics) {
        const r = chunkRatios(A, B, f);
        const t = totalsOf(chunkSums(A, f), chunkSums(B, f));
        ratios[`${LABEL[A.name]} -> ${LABEL[B.name]} ${k}`] = { ...r, totals: t };
        log(`${`${LABEL[A.name]} -> ${LABEL[B.name]}`.padEnd(30)} ${k.padEnd(18)} speedup ${r.speedup.toFixed(2)}x [${r.lo.toFixed(2)}, ${r.hi.toFixed(2)}] (n=${r.n} chunks); totals ${t.speedup.toFixed(2)}x [${t.lo.toFixed(2)}, ${t.hi.toFixed(2)}]`);
      }
    }
    Object.assign(out, { days, chunk, perArm, ratios, recs: Object.fromEntries(arms.map((a) => [a.name, a.recs])) });
  }

  // ---------------------------------------------------------------------------------------------- identical cities
  const lay = (st: object) => Object.entries(st).flatMap(([k, v]) => ArrayBuffer.isView(v) ? [[k, v] as const] : Array.isArray(v) && v.length && v.every((x) => ArrayBuffer.isView(x)) ? (v as ArrayBufferView[]).map((x, i) => [`${k}[${i}]`, x] as const) : []);
  const ref = new Map(lay(arms[0].sim.state));
  let identical = true;
  for (const a of arms.slice(1)) {
    for (const [k, v] of lay(a.sim.state)) {
      const u = ref.get(k)!;
      const x = new Uint8Array(u.buffer, u.byteOffset, u.byteLength), y = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      if (x.length !== y.length || x.some((b, i) => b !== y[i])) { identical = false; log(`# NOT identical: ${a.name} ${k}`); break; }
    }
    if (JSON.stringify(a.sim.state.stats) !== JSON.stringify(arms[0].sim.state.stats)) { identical = false; log(`# NOT identical: ${a.name} stats`); }
  }
  log(`# cities of all arms after the run (day ${arms[0].sim.state.day}): ${identical ? 'bit-identical' : 'DIFFERENT'}`);
  for (const a of arms) if (a.stats) log(`# ${LABEL[a.name]}: ${a.stats.wasmCalls} wasm calls, ${a.stats.jsCalls} JS fallbacks, staged ${(a.stats.bytesIn / 1048576).toFixed(1)} MiB in / ${(a.stats.bytesOut / 1048576).toFixed(1)} MiB out`);
  out.identical = identical;
  out.load = loadAvg();
  return out;
});
