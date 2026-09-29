/**
 * Services tier engine A/B — node entry (bundled + run by tools/bench/servicesTierEngine.bench.mjs; CPU time from an
 * otherwise idle worker thread, interleaved order-alternated pairs, 95 % bootstrap CI of the paired ratio).
 *
 *   node .../servicesTierEngine.node.mjs --fixture F.metropolis [--fixture G ...] [--reps 31] [--cases replay,passes,insitu]
 *        [--insitu-days 60] [--chunk 6] [--scalar path/to/sim_kernels.scalar.wasm] [--json out.json]
 *
 * Arms: original JS (the live ServicesSystem, services.ts 24f8609 + part-B transit rules), fair JS (the restructured JS
 * engine, src/wasm/js/servicesTierEngine.ts), wasm SIMD (the committed binary) and wasm scalar (same Rust without
 * +simd128), each engine arm installed with installServicesTierEngine before the Simulation is built.
 * Cases:
 *  replay   (a) phase kernels on the captured slots of one original pass (alloc / union / report / finalize)
 *  passes   (b) cold pass (invalidateReach(undefined) first: every road reach fresh) and warm pass (cached reaches),
 *           (c) full services.compute(sim, false): orig vs wasm, fair JS vs wasm, orig vs fair JS, scalar vs SIMD, and
 *           staged vs resident (CityState layers + need rasters adopted into wasm memory)
 *  insitu   (d) the whole sim at design cadence (advanceDay + scheduler flush every day), the arms interleaved in
 *           `chunk`-day chunks: sim ms/day, services ms/day, tier-engine ms/day; then the cities must be bit-identical
 * Every arm is checked bit-exact before it is timed (replay outputs; after the passes and in situ: whole cities).
 */
import { readFileSync, existsSync } from 'node:fs';
import { deserializeCity, type SerializedCity } from '../../src/save/serialize';
import { unpackFile } from '../../src/save/bundle';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import type { ServicesSystem } from '../../src/sim/infra/services';
import { schedulerOf } from '../../src/sim/infra/scheduler';
import { infoOf } from '../../src/sim/infra/common';
import { initSimWasmSync, simWasmInstance, simWasmStatus } from '../../src/wasm/simWasm';
import { WasmHeap } from '../../src/wasm/heap';
import { adoptLayers } from '../../src/wasm/layers';
import type { CatchWasm } from '../../src/wasm/kernels/servicesBind';
import { installServicesTierEngine, type InstalledTierEngine } from '../../src/wasm/kernels/services';
import { bootstrapMedianCI, runAB, type AbResult } from './ab';
import { benchMain, cpuMs, loadAvg } from './node';
import { captureSlots, checkImpl, fairImpl, origImpl, replayAB, wasmImpl } from './servicesTierEngine.core';

type Arm = 'orig' | 'js' | 'wasm' | 'scalar' | 'resident';

interface SimArm {
  arm: Arm;
  sim: Simulation;
  svc: ServicesSystem;
  inst: InstalledTierEngine | null;
  /** CPU ms accumulated in the services tier-engine methods / the whole services step */
  acc: { tier: number; stops: number; foot: number; finish: number; prep: number; services: number };
}

function instanceFromFile(file: string, reserve: number): CatchWasm {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(file)), {});
  const ex = inst.exports as unknown as CatchWasm['ex'] & { memory: WebAssembly.Memory; __heap_base: WebAssembly.Global };
  const heap = new WasmHeap(ex.memory, Number(ex.__heap_base.value));
  heap.reserve(reserve);
  return { ex, memory: ex.memory, heap };
}

/** method-level CPU timers on a services instance (after install: they wrap the engine overrides) */
function instrument(a: SimArm): void {
  const svc = a.svc as unknown as Record<string, (...x: unknown[]) => unknown>;
  const map: [string, keyof SimArm['acc']][] = [['tierWork', 'tier'], ['finishTransit', 'stops'], ['footprints', 'foot'], ['finish', 'finish'], ['prep', 'prep'], ['step', 'services']];
  for (const [m, key] of map) {
    const f = svc[m];
    svc[m] = function (this: unknown, ...x: unknown[]) {
      const t0 = cpuMs();
      try { return f.apply(this, x); } finally { a.acc[key] += cpuMs() - t0; }
    };
  }
}

function sameCity(a: Simulation, b: Simulation): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(a.state)) {
    const w = (b.state as unknown as Record<string, unknown>)[k];
    const list = Array.isArray(v) && v.length && v.every((x) => ArrayBuffer.isView(x)) ? (v as ArrayBufferView[]) : ArrayBuffer.isView(v) ? [v] : null;
    if (!list) continue;
    const other = Array.isArray(w) ? (w as ArrayBufferView[]) : [w as ArrayBufferView];
    for (let i = 0; i < list.length; i++) {
      const x = new Uint8Array(list[i].buffer, list[i].byteOffset, list[i].byteLength), y = new Uint8Array(other[i].buffer, other[i].byteOffset, other[i].byteLength);
      if (x.length !== y.length) { out.push(`${k}: shape`); continue; }
      for (let j = 0; j < x.length; j++) if (x[j] !== y[j]) { out.push(`${k}`); break; }
    }
  }
  if (JSON.stringify(a.state.stats) !== JSON.stringify(b.state.stats)) out.push('stats');
  return out;
}

const med = (xs: number[]): number => { const s = xs.slice().sort((p, q) => p - q); return s.length % 2 ? s[(s.length - 1) >> 1] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]); };

benchMain(async ({ args, log }) => {
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const fixtures: string[] = [];
  args.forEach((v, i) => { if (v === '--fixture') fixtures.push(args[i + 1]); });
  const reps = Number(opt('--reps') ?? 31);
  const cases = (opt('--cases') ?? 'replay,passes,insitu').split(',');
  const insituDays = Number(opt('--insitu-days') ?? 60);
  const chunk = Number(opt('--chunk') ?? 6);
  if (!initSimWasmSync()) throw new Error('wasm init failed: ' + simWasmStatus().error);
  const simdFile = simWasmInstance()!.source;
  const scalarFile = opt('--scalar');
  const opts = { reps, clock: cpuMs, clockName: 'cpu', warmupMs: 600, minSampleMs: 10 };
  const results: Record<string, unknown> = { simd: simdFile, scalar: scalarFile ?? null, reps, loadBefore: loadAvg() };
  log(`# wasm SIMD ${simdFile}${scalarFile ? `, scalar ${scalarFile}` : ''}; ${reps} interleaved pairs; load ${loadAvg().join(' ')}`);

  for (const fixture of fixtures) {
    const name = fixture.split('/').pop()!.replace(/\.metropolis$/, '');
    const bytes = new Uint8Array(readFileSync(fixture));
    const load = async () => deserializeCity((await unpackFile(bytes)) as SerializedCity);
    const R: Record<string, unknown> = {};
    results[name] = R;

    // ---------------------------------------------------------------------------------------- (a) replay
    if (cases.includes('replay')) {
      const st = await load();
      const sim = new Simulation(st, createSystems());
      const svc = sim.getSystem<ServicesSystem>('services')!;
      svc.compute(sim, false);
      const slots = captureSlots(svc, st.cells, (k, b) => (k === 8 ? infoOf(st, b as never).covStrength : infoOf(st, b as never).tierStrength));
      const entries = slots.reduce((p, s) => p + s.entries, 0);
      log(`\n## ${name}: pop ${st.stats.population}; captured ${slots.length} slots, ${entries} pool entries: ${slots.map((s) => `${s.name} ${s.n}f/${s.entries}e`).join(', ')}`);
      const simd = instanceFromFile(simdFile, 128 << 20);
      const impls = [origImpl(slots), fairImpl(slots), wasmImpl(simd, slots, 'wasm SIMD'), wasmImpl(simd, slots, 'wasm SIMD staged need', true)];
      if (scalarFile && existsSync(scalarFile)) impls.push(wasmImpl(instanceFromFile(scalarFile, 128 << 20), slots, 'wasm scalar'));
      for (const x of impls.slice(1)) {
        const bad = checkImpl(impls[0], x);
        if (bad.length) throw new Error(`${name} replay ${x.label} differs from the original: ${bad.slice(0, 5).join('; ')}`);
      }
      log(`replay outputs bit-exact: ${impls.slice(1).map((x) => x.label).join(', ')}`);
      const [O, J, W, WG, WS] = impls;
      const rr: AbResult[] = [];
      rr.push(...replayAB(O, W, slots, opts, log), ...replayAB(J, W, slots, opts, log), ...replayAB(O, J, slots, opts, log));
      if (WS) rr.push(...replayAB(WS, W, slots, opts, log));
      rr.push(...replayAB(W, WG, slots, opts, log));
      R.replay = { slots: slots.map((s) => ({ slot: s.name, facilities: s.n, entries: s.entries, shared: s.shared })), results: rr };
    }

    // ---------------------------------------------------------------------------------------- (b)(c) passes
    if (cases.includes('passes')) {
      const arms: Arm[] = ['orig', 'js', 'wasm', ...(scalarFile && existsSync(scalarFile) ? ['scalar' as Arm] : []), 'resident'];
      const sims: Partial<Record<Arm, SimArm>> = {};
      for (const arm of arms) {
        const st = await load();
        const systems = createSystems();
        const svc = systems.find((s) => s.name === 'services') as ServicesSystem;
        let inst: InstalledTierEngine | null = null;
        let w: CatchWasm | undefined;
        if (arm === 'scalar') w = instanceFromFile(scalarFile!, 128 << 20);
        if (arm === 'resident') w = instanceFromFile(simdFile, 160 << 20);
        if (arm !== 'orig') inst = installServicesTierEngine(svc, { backend: arm === 'js' ? 'js' : 'wasm', wasm: w, reserveBytes: 96 << 20 });
        const sim = new Simulation(st, systems);
        if (arm === 'resident') {
          // the memory model's resident case: CityState layers + the services need rasters live in wasm memory
          adoptLayers(st, w!.heap);
          adoptLayers(svc, w!.heap, { include: (k) => k === 'need' });
        }
        const a: SimArm = { arm, sim, svc, inst, acc: { tier: 0, stops: 0, foot: 0, finish: 0, prep: 0, services: 0 } };
        instrument(a);
        sims[arm] = a;
      }
      const all = arms.map((a) => sims[a]!);
      const pass = (a: SimArm, cold: boolean) => () => {
        if (cold) (a.svc as unknown as { invalidateReach(r: unknown): void }).invalidateReach(undefined);
        a.svc.compute(a.sim, false);
      };
      for (const a of all) for (let i = 0; i < 2; i++) pass(a, false)();
      for (const a of all.slice(1)) {
        const d = sameCity(all[0].sim, a.sim);
        if (d.length) throw new Error(`${name}: ${a.arm} differs from the original after the warm-up passes: ${d.slice(0, 5).join(', ')}`);
      }
      log(`\n## ${name}: full services passes (the ${arms.length} cities are bit-identical after the warm-up passes)`);
      const pr: unknown[] = [];
      const pairs: [Arm, Arm][] = [['orig', 'wasm'], ['js', 'wasm'], ['orig', 'js'], ...(sims.scalar ? [['scalar', 'wasm'] as [Arm, Arm]] : []), ['wasm', 'resident']];
      for (const cold of [false, true]) {
        for (const [x, y] of pairs) {
          if (cold && (x === 'scalar' || y === 'resident')) continue;
          const A = sims[x]!, B = sims[y]!;
          for (const s of [A, B]) for (const k of Object.keys(s.acc) as (keyof SimArm['acc'])[]) s.acc[k] = 0;
          let na = 0, nb = 0;
          const r = runAB({ name: `${name} ${cold ? 'cold' : 'warm'} pass: ${x} vs ${y}`, a: () => { na++; pass(A, cold)(); }, b: () => { nb++; pass(B, cold)(); }, aLabel: x, bLabel: y },
            { ...opts, minSampleMs: 20 });
          const per = (s: SimArm, n: number) => Object.fromEntries(Object.entries(s.acc).map(([k, v]) => [k, +(v / n).toFixed(3)]));
          const pa = per(A, na), pb = per(B, nb);
          const engA = pa.tier + pa.stops + pa.foot + pa.finish, engB = pb.tier + pb.stops + pb.foot + pb.finish;
          log(`${r.name.padEnd(56)} ${r.a.median.toFixed(2)} vs ${r.b.median.toFixed(2)} ms  speedup ${r.speedup.median.toFixed(2)}x [${r.speedup.lo.toFixed(2)}, ${r.speedup.hi.toFixed(2)}]` +
            `   tier engine ${engA.toFixed(2)} vs ${engB.toFixed(2)} ms (${(engA / engB).toFixed(2)}x; tierWork ${pa.tier.toFixed(2)} vs ${pb.tier.toFixed(2)})`);
          pr.push({ ...r, cold, perPassA: pa, perPassB: pb, tierEngineA: engA, tierEngineB: engB });
        }
      }
      for (const a of all.slice(1)) {
        const d = sameCity(all[0].sim, a.sim);
        if (d.length) throw new Error(`${name}: ${a.arm} differs from the original after the timed passes: ${d.slice(0, 5).join(', ')}`);
      }
      log('cities still bit-identical after all timed passes');
      R.passes = pr;
    }

    // ---------------------------------------------------------------------------------------- (d) in situ
    if (cases.includes('insitu')) {
      const arms: Arm[] = ['orig', 'wasm', 'js'];
      const sims: SimArm[] = [];
      for (const arm of arms) {
        const st = await load();
        const systems = createSystems();
        const svc = systems.find((s) => s.name === 'services') as ServicesSystem;
        const inst = arm === 'orig' ? null : installServicesTierEngine(svc, { backend: arm === 'js' ? 'js' : 'wasm', reserveBytes: 96 << 20 });
        const sim = new Simulation(st, systems);
        const a: SimArm = { arm, sim, svc, inst, acc: { tier: 0, stops: 0, foot: 0, finish: 0, prep: 0, services: 0 } };
        instrument(a);
        sims.push(a);
      }
      const runChunk = (a: SimArm, days: number) => {
        for (const k of Object.keys(a.acc) as (keyof SimArm['acc'])[]) a.acc[k] = 0;
        const t0 = cpuMs();
        for (let d = 0; d < days; d++) { a.sim.advanceDay(); schedulerOf(a.sim).flush(a.sim); }
        const tot = cpuMs() - t0;
        const eng = a.acc.tier + a.acc.stops + a.acc.foot + a.acc.finish;
        return { day: tot / days, services: a.acc.services / days, engine: eng / days };
      };
      // warm-up chunk each (JIT tiers, first passes after load)
      for (const a of sims) runChunk(a, chunk);
      const nChunks = Math.max(1, Math.round(insituDays / chunk));
      const per: Record<string, { day: number[]; services: number[]; engine: number[] }> = {};
      for (const a of sims) per[a.arm] = { day: [], services: [], engine: [] };
      log(`\n## ${name}: in situ, design cadence (advanceDay + flush), ${nChunks} interleaved chunks of ${chunk} days per arm (load ${loadAvg().join(' ')})`);
      for (let c = 0; c < nChunks; c++) {
        const order = c % 2 === 0 ? sims : sims.slice().reverse();
        for (const a of order) {
          const r = runChunk(a, chunk);
          per[a.arm].day.push(r.day); per[a.arm].services.push(r.services); per[a.arm].engine.push(r.engine);
        }
        log(`chunk ${c}: ${sims.map((a) => `${a.arm} ${per[a.arm].day[c].toFixed(1)} ms/day (services ${per[a.arm].services[c].toFixed(1)}, tier engine ${per[a.arm].engine[c].toFixed(1)})`).join(' | ')}`);
      }
      const ratioCI = (x: number[], y: number[]) => {
        const rs = x.map((v, i) => y[i] / v);
        const ci = bootstrapMedianCI(rs, 7);
        return { median: 1 / med(rs), lo: 1 / ci.hi, hi: 1 / ci.lo };
      };
      const summary: Record<string, unknown> = {};
      for (const [b, label] of [['wasm', 'orig vs wasm'], ['js', 'orig vs fair js']] as const) {
        const A = per.orig, B = per[b];
        const s = {
          dayMs: [med(A.day), med(B.day)], servicesMs: [med(A.services), med(B.services)], engineMs: [med(A.engine), med(B.engine)],
          daySpeedup: ratioCI(A.day, B.day), servicesSpeedup: ratioCI(A.services, B.services), engineSpeedup: ratioCI(A.engine, B.engine),
        };
        summary[label] = s;
        log(`${label}: sim ${s.dayMs[0].toFixed(1)} -> ${s.dayMs[1].toFixed(1)} ms/day ${s.daySpeedup.median.toFixed(3)}x [${s.daySpeedup.lo.toFixed(3)}, ${s.daySpeedup.hi.toFixed(3)}]; ` +
          `services ${s.servicesMs[0].toFixed(2)} -> ${s.servicesMs[1].toFixed(2)} ms/day ${s.servicesSpeedup.median.toFixed(2)}x [${s.servicesSpeedup.lo.toFixed(2)}, ${s.servicesSpeedup.hi.toFixed(2)}]; ` +
          `tier engine ${s.engineMs[0].toFixed(2)} -> ${s.engineMs[1].toFixed(2)} ms/day ${s.engineSpeedup.median.toFixed(2)}x [${s.engineSpeedup.lo.toFixed(2)}, ${s.engineSpeedup.hi.toFixed(2)}]`);
      }
      const ident = sims.slice(1).map((a) => ({ arm: a.arm, diff: sameCity(sims[0].sim, a.sim) }));
      for (const x of ident) log(`in situ cities bit-identical after ${(nChunks + 1) * chunk} days: ${x.arm} ${x.diff.length === 0 ? 'yes' : 'NO ' + x.diff.slice(0, 5).join(', ')}`);
      if (ident.some((x) => x.diff.length)) throw new Error(`${name}: in-situ cities differ`);
      R.insitu = { days: (nChunks + 1) * chunk, chunk, per, summary, identical: true, passes: sims.map((a) => (a.svc as unknown as { donePasses: number }).donePasses) };
    }
  }
  results.loadAfter = loadAvg();
  log(`# load ${loadAvg().join(' ')}`);
  return results;
});
