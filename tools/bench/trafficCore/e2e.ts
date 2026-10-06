/**
 * End-to-end A/B (node, CPU time): the whole headless simulation (Simulation.advanceDay: every system) on a 1M
 * fixture, one Simulation per arm, in INTERLEAVED chunks of days with a rotating order. Per chunk: CPU ms per day of
 * the whole sim and of the traffic system (every traffic step, whichever hook ran it). `--flush` = design cadence
 * (scheduler.flush() after every day: every due infra pass completes on time, a traffic cycle every 2 days), else the
 * InfraScheduler's headless budget (time-sliced). Afterwards: a JS-vs-JS baseline (a second original simulation over
 * the same days must save byte-identical), then every arm against the original (saved city + traffic state).
 * With --worker FILE (the bench script's default) every arm runs in its own V8 isolate (armWorker.ts, see insitu.ts);
 * the JS-vs-JS baseline is then the arm `orig2` (a second original, interleaved like the others: also the control
 * ratio orig -> orig2), identity = per-field traffic digests + SHA-256 of the saved city.
 * Every arm keeps V8's ArrayBuffer-detaching protector intact (fixtures gunzipped with zlib, pre-sized wasm memory)
 * unless its kind ends in '-inv'; the state is reported per arm at the end (protector, memory.grow, JS fallbacks).
 *   args: --fixture dense1m [--fixtures DIR] [--days 120] [--chunk 4] [--warm 2] [--flush] [--arms orig,orig2,orig-ws,wasm]
 *         [--resident] [--no-baseline] [--worker armWorker.mjs | --in-process] [--settle 30]
 */
import { benchMain, loadAvg } from '../node';
import { bootstrapMedianCI } from '../ab';
import { initSimWasmSync, simWasmInstance, simWasmStatus } from '../../../src/wasm/simWasm';
import { resetTrafficWasmStats, trafficWasmStats, type TrafficWasmCore } from '../../../src/wasm/kernels/trafficBind';
import { adoptLayers } from '../../../src/wasm/layers';
import { schedulerOf } from '../../../src/sim/infra/scheduler';
import { serializeCity } from '../../../src/save/serialize';
import { fixtureDir, loadCity } from './fixtures';
import { cpuMs, makeArm, searchModeFor, type Arm, type ArmKind } from './arms';
import { diffDigests, diffTraffic } from './compare';
import { spawnArm, type ArmProc } from './isolates';

const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n === 0 ? NaN : n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };

/** byte-exact comparison of two saved cities (typed arrays bytewise; savedAt ignored) */
function diffSave(a: unknown, b: unknown, path = '$', out: string[] = []): string[] {
  if (out.length >= 8) return out;
  if (ArrayBuffer.isView(a)) {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), bv = b as ArrayBufferView;
    if (!ArrayBuffer.isView(b) || bv.byteLength !== a.byteLength) { out.push(`${path}: shape`); return out; }
    const y = new Uint8Array(bv.buffer, bv.byteOffset, bv.byteLength);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { out.push(`${path}: byte ${i}`); break; }
    return out;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (!(Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && a !== a && b !== b))) out.push(`${path}: ${String(a).slice(0, 30)} vs ${String(b).slice(0, 30)}`);
    return out;
  }
  if (a instanceof Map) { const bm = b as Map<unknown, unknown>; if (a.size !== bm.size) out.push(`${path}: map size`); else for (const [k, v] of a) diffSave(v, bm.get(k), `${path}<${String(k)}>`, out); return out; }
  for (const k of Object.keys(a as object)) if (k !== 'savedAt') diffSave((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
  return out;
}

interface ChunkResult { ms: number; traffic: number }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
  const spec = opt('--fixture', 'dense1m')!;
  const days = Number(opt('--days', '120'));
  const chunk = Number(opt('--chunk', '4'));
  const warm = Number(opt('--warm', '2'));
  const flush = args.includes('--flush');
  const resident = args.includes('--resident');
  const settle = Number(opt('--settle', '30'));
  const worker = args.includes('--in-process') ? undefined : opt('--worker');
  const kinds = opt('--arms', worker ? 'orig,orig2,orig-ws,wasm' : 'orig,orig-ws,wasm')!.split(',') as ArmKind[];
  const dir = fixtureDir(args);
  const arms: Arm[] = [];
  const procs: ArmProc[] = [];
  let info: { pop: number; day: number };
  if (worker) {
    for (const k of kinds) {
      procs.push(await spawnArm(worker, k, spec, args, resident, {}));
      log(`#   arm ${k}: isolate up, rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MiB`);
    }
    info = { pop: procs[0].info.pop, day: procs[0].info.day };
  } else {
    if (!initSimWasmSync()) throw new Error('wasm init failed: ' + simWasmStatus().error);
    resetTrafficWasmStats();
    for (const k of kinds) {
      const st = (await loadCity(spec, dir)).st;
      if (resident && k.startsWith('wasm')) adoptLayers(st, simWasmInstance()!.heap, { reserveExtra: 32 << 20 });
      arms.push(makeArm(k, st));
    }
    info = { pop: arms[0].st.stats.population, day: arms[0].st.day };
  }
  const day0 = info.day;
  log(`# ${worker ? 'one V8 isolate per arm' : 'one isolate (all arms)'}; ${spec}: pop ${info.pop}, day ${day0}; ${flush ? 'DESIGN CADENCE (scheduler.flush() every day)' : 'headless scheduler budget (time-sliced)'}; layers ${resident ? 'resident' : 'staged'}; chunks of ${chunk} days; arms ${kinds.join(', ')}; load ${loadAvg().join(' ')}`);
  const runLocal = (a: Arm): ChunkResult => {
    searchModeFor(a.kind);
    a.phaseCpu.fill(0);
    const sch = schedulerOf(a.sim);
    const t0 = cpuMs();
    for (let d = 0; d < chunk; d++) {
      a.sim.advanceDay();
      if (flush) sch.flush(a.sim);
    }
    const ms = (cpuMs() - t0) / chunk;
    searchModeFor('orig');
    let tr = 0;
    for (let p = 0; p < a.phaseCpu.length; p++) tr += a.phaseCpu[p];
    return { ms, traffic: tr / chunk };
  };
  const runChunk = async (i: number): Promise<ChunkResult> => {
    if (!worker) return runLocal(arms[i]);
    const r = await procs[i].call<ChunkResult>({ cmd: 'days', n: chunk, flush });
    await sleep(settle);
    return r;
  };
  for (let k = 0; k < warm; k++) for (let i = 0; i < kinds.length; i++) await runChunk(i);
  const pairs = Math.max(1, Math.floor(days / chunk) - warm);
  const res: ChunkResult[][] = kinds.map(() => []);
  const load0 = loadAvg();
  const t0 = Date.now();
  for (let k = 0; k < pairs; k++) {
    for (let q = 0; q < kinds.length; q++) { const i = (q + k) % kinds.length; res[i].push(await runChunk(i)); }
    if (k < 2 || k % 10 === 9) log(`chunk ${k}: ${kinds.map((kd, i) => `${kd} ${res[i][k].ms.toFixed(1)} ms/day (traffic ${res[i][k].traffic.toFixed(1)})`).join(' | ')} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  const load1 = loadAvg();
  const summary = kinds.map((kind, i) => ({ kind, msPerDay: median(res[i].map((x) => x.ms)), msMin: Math.min(...res[i].map((x) => x.ms)), trafficPerDay: median(res[i].map((x) => x.traffic)), trafficMean: res[i].reduce((s, x) => s + x.traffic, 0) / res[i].length }));
  const ratio = (i: number, j: number, f: (x: ChunkResult) => number) => {
    const r = res[i].map((x, k) => (f(x) > 0 && f(res[j][k]) > 0 ? f(res[j][k]) / f(x) : NaN)).filter((v) => v === v);
    if (r.length < 3) return null;
    const ci = bootstrapMedianCI(r);
    return { speedup: 1 / median(r), lo: 1 / ci.hi, hi: 1 / ci.lo, n: r.length };
  };
  const ratios: Record<string, unknown> = {};
  for (let i = 0; i < kinds.length; i++) for (let j = 0; j < kinds.length; j++) {
    const a = kinds[i], b = kinds[j];
    if (i === j || !(a === 'orig' || ((a === 'orig-ws' || a === 'fair' || a === 'orig-inv') && b.startsWith('wasm')) || (a === 'orig-inv' && b === 'orig'))) continue;
    const whole = ratio(i, j, (x) => x.ms), traffic = ratio(i, j, (x) => x.traffic);
    ratios[`${kinds[i]}->${kinds[j]}`] = { whole, traffic };
    const f = (r: typeof whole) => (r ? `${r.speedup.toFixed(3)}x [${r.lo.toFixed(3)}, ${r.hi.toFixed(3)}]` : 'n/a');
    log(`${kinds[i]} -> ${kinds[j]}: whole sim ${f(whole)}, traffic ${f(traffic)}`);
  }
  for (const s of summary) log(`  ${s.kind.padEnd(8)} whole ${s.msPerDay.toFixed(2)} ms/day (min ${s.msMin.toFixed(2)}), traffic ${s.trafficPerDay.toFixed(2)} ms/day (median of chunks; mean ${s.trafficMean.toFixed(2)}) = ${(100 * s.trafficMean / s.msPerDay).toFixed(1)}%`);
  // ---- identity
  const identity: Record<string, string[]> = {};
  const total = (warm + pairs) * chunk;
  let pops: string;
  let wasm: unknown = null;
  if (worker) {
    const dg: { digest: Record<string, number>; stats: unknown; arena: number; lastJsReason: string | null; pop: number; protector: boolean | null; heap: { capacity: number; used: number; grows: number } | null; jsCalls: number }[] = [];
    const sv: { hash: string; pop: number; day: number }[] = [];
    for (const p of procs) { dg.push(await p.call({ cmd: 'digest' })); sv.push(await p.call({ cmd: 'save' })); }
    for (let i = 1; i < procs.length; i++) {
      identity[kinds[i]] = [...(sv[0].hash === sv[i].hash ? [] : ['saved city (sha256)']), ...diffDigests(dg[0].digest, dg[i].digest)];
      log(`${kinds[0]} vs ${kinds[i]} after ${total} days (day ${sv[i].day}): ${identity[kinds[i]].length === 0 ? 'city and traffic state identical' : 'DIFFERENT ' + identity[kinds[i]].slice(0, 4).join('; ')}`);
    }
    dg.forEach((d, i) => log(`  ${kinds[i].padEnd(8)} protector ${d.protector === null ? 'not probed' : d.protector ? 'intact' : 'INVALIDATED'}; ${d.heap ? `wasm heap ${(d.heap.capacity / 1048576).toFixed(1)} MiB, used ${(d.heap.used / 1048576).toFixed(1)} MiB, memory.grow ${d.heap.grows}` : 'no wasm heap'}; traffic-core JS calls ${d.jsCalls}`));
    pops = kinds.map((k, i) => `${k} ${sv[i].pop}`).join(', ');
    const wi = kinds.indexOf('wasm');
    if (wi >= 0) wasm = { stats: dg[wi].stats, arena: dg[wi].arena, lastJsReason: dg[wi].lastJsReason };
    for (const p of procs) await p.close();
  } else {
    const save = (a: Arm) => serializeCity(a.st, { copy: true });
    const base = save(arms[0]);
    if (!args.includes('--no-baseline')) {
      const C = makeArm('orig', (await loadCity(spec, dir)).st);
      const sch = schedulerOf(C.sim);
      for (let d = 0; d < total; d++) { C.sim.advanceDay(); if (flush) sch.flush(C.sim); }
      identity.jsVsJs = diffSave(base, save(C));
      log(`JS vs JS after ${total} days: ${identity.jsVsJs.length === 0 ? 'identical' : 'DIFFERENT ' + identity.jsVsJs.slice(0, 3).join('; ')}`);
    }
    for (const a of arms.slice(1)) {
      identity[a.kind] = [...diffSave(base, save(a)), ...diffTraffic(arms[0].tr, a.tr)];
      log(`${arms[0].kind} vs ${a.kind} after ${total} days: ${identity[a.kind].length === 0 ? 'city and traffic state identical' : 'DIFFERENT ' + identity[a.kind].slice(0, 3).join('; ')}`);
    }
    pops = arms.map((a) => `${a.kind} ${a.st.stats.population}`).join(', ');
    const w = arms.find((a) => a.kind === 'wasm')?.core as TrafficWasmCore | undefined;
    if (w) wasm = { stats: { ...trafficWasmStats }, arena: w.arenaBytes, lastJsReason: w.lastJsReason };
  }
  log(`population ${pops}; wasm ${JSON.stringify(wasm)}; load ${load0.join(' ')} -> ${load1.join(' ')}`);
  return { fixture: spec, mode: worker ? 'isolates' : 'in-process', flush, resident, day0, days: total, chunk, pairs, arms: summary, ratios, identity, wasm, load: [load0, load1] };
});
