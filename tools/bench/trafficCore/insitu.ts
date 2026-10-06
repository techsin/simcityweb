/**
 * In-situ A/B (node, CPU time): one Simulation per arm, all loaded from the same fixture, each running
 * TrafficSystem.runCycleSync (one full traffic assignment: prep, prepTransit, transit, the matching rounds, commute,
 * inbound / shop / freight, finalize, finalize2), INTERLEAVED with a rotating order (ABCD, BCDA, ...) for >= 31
 * rounds after warm-up cycles. Per arm: CPU ms per cycle and per phase (median, min); per pair of arms: paired speedup
 * with a 95% bootstrap CI. Afterwards every arm's traffic state and city are compared with the first arm (must be
 * identical: the arms ran the same cycles), and every arm reports what it ran on: V8's ArrayBuffer-detaching protector
 * (intact unless the arm is '-inv'), wasm memory growth (the pre-sized binary must never grow), traffic-core JS calls.
 *
 * Isolation (default: the bench script passes --worker): every arm runs in its OWN V8 isolate (a worker thread,
 * armWorker.ts) — no shared inline caches / JIT feedback, and its own protector. The coordinator (this worker) sends
 * one command at a time and waits; the other threads are idle, so the process CPU time measured inside the active arm
 * is that arm's. Identity across isolates: per-field digests (compare.ts digestTraffic) + a SHA-256 of the saved city.
 * --in-process runs all arms in this isolate instead (the earlier protocol; kept to show the difference).
 * --edit: before EVERY cycle one dead-end road cell is bulldozed / rebuilt alternately in every arm (edit.ts): each
 * cycle rebuilds the graph, every other one shrinks it below the last settled counts (the P1 condition).
 *
 *   args: --fixture dense1m|bot256|stress1m|stress256 [--fixtures DIR] [--pairs 31] [--warm 3] [--edit]
 *         [--arms orig,orig2,fair,wasm,wasm-scalar,wasm-fdlibm,orig-inv,wasm-inv,orig-ws,wasm-ws] [--resident]
 *         [--worker armWorker.mjs | --in-process] [--settle 30] [--scalar FILE] [--fdlibm FILE]
 */
import { benchMain, loadAvg } from '../node';
import { bootstrapMedianCI } from '../ab';
import { initSimWasmSync, simWasmInstance, simWasmStatus, type SimWasmInstance } from '../../../src/wasm/simWasm';
import { resetTrafficWasmStats, trafficWasmStats, type TrafficWasmCore } from '../../../src/wasm/kernels/trafficBind';
import { fixtureDir, loadCity } from './fixtures';
import { baseKind, makeArm, PHASE_NAMES, runCycle, type Arm, type ArmKind } from './arms';
import { diffCity, diffDigests, diffTraffic } from './compare';
import { instanceFromFile } from './instances';
import { adoptLayers } from '../../../src/wasm/layers';
import { spawnArm, type ArmProc } from './isolates';
import { editToggle } from './edit';

const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n === 0 ? NaN : n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CycleResult { ms: number; phases: number[]; steps: number[]; jsCalls: number }
interface ArmState { protector: boolean | null; heap: { capacity: number; used: number; grows: number } | null; jsCalls: number; wasmCalls: number; traps: number; lastJsReason: string | null; arena?: number; stats?: Record<string, unknown> }
interface Runner {
  mode: string;
  info: Record<string, number>;
  cycle(i: number, edit: boolean): Promise<CycleResult>;
  identity(): Promise<Record<string, string[]>>;
  states(): Promise<ArmState[]>;
  close(): Promise<void>;
}

async function inProcess(kinds: ArmKind[], spec: string, dir: string, resident: boolean, extra: { scalar?: string; fdlibm?: string }): Promise<Runner> {
  if (!initSimWasmSync()) throw new Error('wasm init failed: ' + simWasmStatus().error);
  resetTrafficWasmStats();
  const instances: Partial<Record<ArmKind, () => SimWasmInstance | null>> = {};
  if (extra.scalar) { const i = instanceFromFile(extra.scalar, 'scalar'); instances['wasm-scalar'] = () => i; }
  if (extra.fdlibm) { const i = instanceFromFile(extra.fdlibm, 'fdlibm'); instances['wasm-fdlibm'] = () => i; }
  const arms: Arm[] = [];
  for (const k of kinds) {
    if (k.endsWith('-inv')) throw new Error('-inv arms need one isolate per arm (drop --in-process)');
    const st = (await loadCity(spec, dir)).st;
    if (resident && baseKind(k).startsWith('wasm')) adoptLayers(st, (instances[baseKind(k)]?.() ?? simWasmInstance())!.heap, { reserveExtra: 32 << 20 });
    arms.push(makeArm(k, st, instances));
  }
  const A0 = arms[0];
  return {
    mode: 'one isolate (all arms in the coordinator)',
    info: { pop: A0.st.stats.population, nodes: A0.tr.road.n, total: A0.tr.road.n + A0.tr.rail.n + A0.tr.subway.n, oN: A0.tr.oN, jN: A0.tr.jN, stops: A0.tr.stops.n },
    async cycle(i, edit) {
      const a = arms[i];
      if (edit) editToggle(a);
      const j0 = trafficWasmStats.jsCalls;
      const ms = runCycle(a);
      return { ms, phases: Array.from(a.phaseCpu), steps: Array.from(a.phaseSteps), jsCalls: trafficWasmStats.jsCalls - j0 };
    },
    async identity() {
      const id: Record<string, string[]> = {};
      for (const a of arms.slice(1)) id[a.kind] = [...diffTraffic(A0.tr, a.tr), ...diffCity(A0.st, a.st)];
      return id;
    },
    async states() {
      return arms.map((a) => {
        const w = a.core as TrafficWasmCore | null;
        const inst = baseKind(a.kind).startsWith('wasm') ? (instances[baseKind(a.kind)]?.() ?? simWasmInstance()) : null;
        return { protector: null, heap: inst ? inst.heap.stats() : null, jsCalls: trafficWasmStats.jsCalls, wasmCalls: trafficWasmStats.wasmCalls, traps: trafficWasmStats.traps, lastJsReason: w && 'lastJsReason' in w ? w.lastJsReason : null, arena: w && 'arenaBytes' in w ? w.arenaBytes : 0 };
      });
    },
    async close() {},
  };
}

async function isolated(file: string, kinds: ArmKind[], spec: string, args: string[], resident: boolean, extra: { scalar?: string; fdlibm?: string }, log: (s: string) => void): Promise<Runner> {
  const procs: ArmProc[] = [];
  for (const k of kinds) {
    procs.push(await spawnArm(file, k, spec, args, resident, extra));
    const i = procs[procs.length - 1].info as Record<string, unknown>;
    log(`#   arm ${k}: isolate up (Simulation init ${(i.initMs as number).toFixed(0)} ms CPU), protector ${i.protector === null ? 'not probed' : i.protector ? 'intact' : 'INVALIDATED'}, rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MiB`);
  }
  return {
    mode: 'one V8 isolate (worker thread) per arm',
    info: procs[0].info,
    cycle: (i, edit) => procs[i].call<CycleResult>({ cmd: 'cycle', edit }),
    async identity() {
      const dg: { digest: Record<string, number> }[] = [];
      const sv: { hash: string }[] = [];
      for (const p of procs) { dg.push(await p.call({ cmd: 'digest' })); sv.push(await p.call({ cmd: 'save' })); }
      const id: Record<string, string[]> = {};
      for (let i = 1; i < procs.length; i++) {
        id[procs[i].kind] = [...diffDigests(dg[0].digest, dg[i].digest), ...(sv[0].hash === sv[i].hash ? [] : ['saved city (sha256)'])];
      }
      return id;
    },
    async states() {
      const out: ArmState[] = [];
      for (const p of procs) out.push(await p.call<ArmState>({ cmd: 'digest' }));
      return out;
    },
    async close() { for (const p of procs) await p.close(); },
  };
}

/** ratio pairs reported when both arms ran: [A, B] = speedup of B over A */
const PAIRS: [string, string][] = [
  ['orig', 'orig2'], ['wasm', 'wasm2'], ['orig', 'fair'], ['orig', 'wasm'], ['fair', 'wasm'], ['wasm-scalar', 'wasm'], ['wasm-fdlibm', 'wasm'],
  ['orig-inv', 'orig'], ['wasm-inv', 'wasm'], ['orig-inv', 'wasm-inv'], ['fair-inv', 'wasm-inv'], ['orig-inv', 'wasm'],
  ['orig', 'orig-ws'], ['orig-ws', 'wasm'], ['orig-ws', 'wasm-ws'], ['wasm', 'wasm-ws'],
];

benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
  const spec = opt('--fixture', 'dense1m')!;
  const pairs = Number(opt('--pairs', '31'));
  const warm = Number(opt('--warm', '3'));
  const settle = Number(opt('--settle', '30'));
  const edit = args.includes('--edit');
  const sc = opt('--scalar'), fd = opt('--fdlibm');
  let kinds = opt('--arms', 'orig,orig2,fair,wasm,wasm-scalar,wasm-fdlibm')!.split(',') as ArmKind[];
  kinds = kinds.filter((k) => (baseKind(k) !== 'wasm-scalar' || sc) && (baseKind(k) !== 'wasm-fdlibm' || fd));
  const dir = fixtureDir(args);
  // --resident: the wasm arms' CityState layers live in their instance's wasm memory (zero-copy layers, the
  // architect's memory model); otherwise the traffic / congestion / network layers are staged per call
  const resident = args.includes('--resident');
  const worker = args.includes('--in-process') ? undefined : opt('--worker');
  const extra = { scalar: sc, fdlibm: fd };
  const runner = worker ? await isolated(worker, kinds, spec, args, resident, extra, log) : await inProcess(kinds, spec, dir, resident, extra);
  const I = runner.info;
  log(`# ${runner.mode}; layers ${resident ? 'RESIDENT in wasm memory (wasm arms)' : 'staged per call'}${edit ? '; EDIT before every cycle (dead-end road cell bulldozed / rebuilt)' : ''}`);
  log(`# ${spec}: pop ${I.pop}, road nodes ${I.nodes}, transit nodes ${I.total}, origins ${I.oN}, sites ${I.jN}, stops ${I.stops}; arms ${kinds.join(', ')}; load ${loadAvg().join(' ')}`);
  const n = kinds.length;
  for (let k = 0; k < warm; k++) for (let i = 0; i < n; i++) { await runner.cycle(i, edit); if (worker) await sleep(settle); }
  const cyc: number[][] = kinds.map(() => []);
  const ph: number[][][] = kinds.map(() => PHASE_NAMES.map(() => []));
  const js: number[] = kinds.map(() => 0);
  const rounds: number[] = [];
  const load0 = loadAvg();
  const t0 = Date.now();
  for (let k = 0; k < pairs; k++) {
    for (let q = 0; q < n; q++) {
      const i = (q + k) % n;
      const r = await runner.cycle(i, edit);
      cyc[i].push(r.ms);
      js[i] += r.jsCalls;
      for (let p = 0; p < PHASE_NAMES.length; p++) ph[i][p].push(r.phases[p]);
      if (i === 0) rounds.push(r.steps[4]);
      // let background GC tasks of this arm finish before the next arm's clock starts
      if (worker) await sleep(settle);
    }
    if (k < 2 || k === pairs - 1 || k % 10 === 9) log(`pair ${k}: ${kinds.map((kd, i) => `${kd} ${cyc[i][k].toFixed(1)}`).join(' | ')} ms/cycle (${((Date.now() - t0) / 1000).toFixed(0)} s, load ${loadAvg()[0]})`);
  }
  const load1 = loadAvg();
  const summary = kinds.map((kind, i) => ({
    kind, cycleMs: median(cyc[i]), cycleMin: Math.min(...cyc[i]), jsCalls: js[i],
    phases: Object.fromEntries(PHASE_NAMES.map((nm, p) => [nm, { median: median(ph[i][p]), min: Math.min(...ph[i][p]) }])),
  }));
  const vs = (i: number, j: number, f: (x: number) => number[]) => {
    const ra = f(i), rb = f(j);
    const r = ra.map((x, k) => rb[k] / x).filter((v) => v === v && v !== Infinity);
    if (r.length < 5) return null;
    const ci = bootstrapMedianCI(r);
    return { speedup: 1 / median(r), lo: 1 / ci.hi, hi: 1 / ci.lo };
  };
  const idx = (k: ArmKind) => kinds.indexOf(k);
  const ratios: Record<string, unknown> = {};
  const fmt = (r: { speedup: number; lo: number; hi: number } | null) => (r ? `${r.speedup.toFixed(3)}x [${r.lo.toFixed(3)}, ${r.hi.toFixed(3)}]` : 'n/a');
  for (const [x, y] of PAIRS) {
    const i = idx(x), j = idx(y);
    if (i < 0 || j < 0) continue;
    const whole = vs(i, j, (q) => cyc[q]);
    const per: Record<string, unknown> = {};
    for (let p = 0; p < PHASE_NAMES.length; p++) per[PHASE_NAMES[p]] = vs(i, j, (q) => ph[q][p]);
    // the ported phases only (everything but final2; prep's building walk stays inside prep)
    const portable = vs(i, j, (q) => ph[q][0].map((_, k) => PHASE_NAMES.reduce((s, nm, p) => (nm === 'final2' ? s : s + ph[q][p][k]), 0)));
    ratios[`${x}->${y}`] = { cycle: whole, portable, phases: per };
    log(`${x} -> ${y}: cycle ${fmt(whole)}; without final2 ${fmt(portable)}`);
    log(`    per phase: ${PHASE_NAMES.map((nm) => `${nm} ${(per[nm] as { speedup: number } | null)?.speedup.toFixed(2) ?? '-'}`).join(', ')}`);
  }
  log('median CPU ms per phase (sum over the cycle):');
  log('  ' + ['phase'.padEnd(12), ...kinds.map((k) => k.padStart(12))].join(''));
  for (let p = 0; p < PHASE_NAMES.length; p++) log('  ' + [PHASE_NAMES[p].padEnd(12), ...summary.map((s) => s.phases[PHASE_NAMES[p]].median.toFixed(2).padStart(12))].join(''));
  log('  ' + ['cycle'.padEnd(12), ...summary.map((s) => s.cycleMs.toFixed(2).padStart(12))].join(''));
  log('  ' + ['cycle min'.padEnd(12), ...summary.map((s) => s.cycleMin.toFixed(2).padStart(12))].join(''));
  log('  ' + ['JS fallback'.padEnd(12), ...summary.map((s) => String(s.jsCalls).padStart(12))].join(''));
  // identity after warm + pairs cycles, and what every arm ran on
  const identity = await runner.identity();
  log(`identical to ${kinds[0]} after ${warm + pairs} cycles: ${Object.entries(identity).map(([k, d]) => `${k} ${d.length === 0 ? 'yes' : 'NO ' + d.slice(0, 4).join('; ')}`).join(', ')}`);
  const states = await runner.states();
  states.forEach((s, i) => log(`  ${kinds[i].padEnd(12)} protector ${s.protector === null ? 'not probed' : s.protector ? 'intact' : 'INVALIDATED'}; ${s.heap ? `wasm heap ${(s.heap.capacity / 1048576).toFixed(1)} MiB, used ${(s.heap.used / 1048576).toFixed(1)} MiB, memory.grow ${s.heap.grows}` : 'no wasm heap'}; core JS calls ${s.jsCalls}, wasm calls ${s.wasmCalls}, traps ${s.traps}${s.lastJsReason ? `, last JS reason: ${s.lastJsReason}` : ''}`));
  log(`rounds/cycle ${median(rounds)}; load ${load0.join(' ')} -> ${load1.join(' ')}`);
  await runner.close();
  return { fixture: spec, mode: runner.mode, resident, edit, pop: I.pop, roadNodes: I.nodes, pairs, warm, arms: summary, ratios, identity, states, load: [load0, load1] };
});
