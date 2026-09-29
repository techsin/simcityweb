/**
 * In-situ A/B (node, CPU time): one Simulation per arm, all loaded from the same fixture, each running
 * TrafficSystem.runCycleSync (one full traffic assignment: prep, prepTransit, transit, the matching rounds, commute,
 * inbound / shop / freight, finalize, finalize2), INTERLEAVED with a rotating order (ABCD, BCDA, ...) for >= 31
 * rounds after warm-up cycles. Per arm: CPU ms per cycle and per phase (median, min); per pair of arms: paired speedup
 * with a 95% bootstrap CI. Afterwards every arm's traffic state and city are compared with the original (must be
 * identical: the arms ran the same cycles).
 *   args: --fixture dense1m|bot256|stress1m|stress256 [--fixtures DIR] [--pairs 31] [--warm 3] [--arms orig,fair,wasm,wasm-scalar,wasm-imp]
 *         [--scalar FILE] [--imp FILE]
 */
import { benchMain, loadAvg } from '../node';
import { bootstrapMedianCI } from '../ab';
import { initSimWasmSync, simWasmStatus } from '../../../src/wasm/simWasm';
import { resetTrafficWasmStats, trafficWasmStats, type TrafficWasmCore } from '../../../src/wasm/kernels/trafficBind';
import { fixtureDir, loadCity } from './fixtures';
import { makeArm, PHASE_NAMES, runCycle, type Arm, type ArmKind } from './arms';
import { diffCity, diffTraffic } from './compare';
import { instanceFromFile } from './instances';

const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n === 0 ? NaN : n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };

benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
  const spec = opt('--fixture', 'dense1m')!;
  const pairs = Number(opt('--pairs', '31'));
  const warm = Number(opt('--warm', '3'));
  let kinds = opt('--arms', 'orig,fair,wasm,wasm-scalar,wasm-imp')!.split(',') as ArmKind[];
  if (!initSimWasmSync()) throw new Error('wasm init failed: ' + simWasmStatus().error);
  const instances: Partial<Record<ArmKind, () => ReturnType<typeof instanceFromFile>>> = {};
  const sc = opt('--scalar'), imp = opt('--imp');
  if (sc) { const i = instanceFromFile(sc, 'scalar'); instances['wasm-scalar'] = () => i; }
  if (imp) { const i = instanceFromFile(imp, 'imported-math'); instances['wasm-imp'] = () => i; }
  kinds = kinds.filter((k) => (k !== 'wasm-scalar' || sc) && (k !== 'wasm-imp' || imp));
  resetTrafficWasmStats();
  const dir = fixtureDir(args);
  const arms: Arm[] = [];
  for (const k of kinds) arms.push(makeArm(k, (await loadCity(spec, dir)).st, instances));
  const A0 = arms[0];
  log(`# ${spec}: pop ${A0.st.stats.population}, road nodes ${A0.tr.road.n}, transit nodes ${A0.tr.road.n + A0.tr.rail.n + A0.tr.subway.n}, origins ${A0.tr.oN}, sites ${A0.tr.jN}, stops ${A0.tr.stops.n}; arms ${kinds.join(', ')}; load ${loadAvg().join(' ')}`);
  for (let k = 0; k < warm; k++) for (const a of arms) runCycle(a);
  const cyc: number[][] = arms.map(() => []);
  const ph: number[][][] = arms.map(() => PHASE_NAMES.map(() => []));
  const rounds: number[] = [];
  const load0 = loadAvg();
  for (let k = 0; k < pairs; k++) {
    for (let q = 0; q < arms.length; q++) {
      const i = (q + k) % arms.length;
      const a = arms[i];
      cyc[i].push(runCycle(a));
      for (let p = 0; p < PHASE_NAMES.length; p++) ph[i][p].push(a.phaseCpu[p]);
      if (i === 0) rounds.push(a.phaseSteps[4]);
    }
    if (k < 2 || k === pairs - 1) log(`pair ${k}: ${arms.map((a, i) => `${a.kind} ${cyc[i][k].toFixed(1)}`).join(' | ')} ms/cycle`);
  }
  const load1 = loadAvg();
  const summary = arms.map((a, i) => ({
    kind: a.kind, cycleMs: median(cyc[i]), cycleMin: Math.min(...cyc[i]),
    phases: Object.fromEntries(PHASE_NAMES.map((n, p) => [n, { median: median(ph[i][p]), min: Math.min(...ph[i][p]) }])),
  }));
  const vs = (i: number, j: number, f: (x: number) => number[]) => {
    const ra = f(i), rb = f(j);
    const r = ra.map((x, k) => rb[k] / x).filter((v) => v === v && v !== Infinity);
    if (r.length < 5) return null;
    const ci = bootstrapMedianCI(r);
    return { speedup: 1 / median(r), lo: 1 / ci.hi, hi: 1 / ci.lo };
  };
  const idx = (k: ArmKind) => kinds.indexOf(k);
  const cmpPairs: [ArmKind, ArmKind][] = [['orig', 'fair'], ['orig', 'wasm'], ['fair', 'wasm'], ['wasm-scalar', 'wasm'], ['wasm-imp', 'wasm'], ['orig', 'wasm-imp']];
  const ratios: Record<string, unknown> = {};
  for (const [x, y] of cmpPairs) {
    const i = idx(x), j = idx(y);
    if (i < 0 || j < 0) continue;
    const whole = vs(i, j, (q) => cyc[q]);
    const per: Record<string, unknown> = {};
    for (let p = 0; p < PHASE_NAMES.length; p++) per[PHASE_NAMES[p]] = vs(i, j, (q) => ph[q][p]);
    // the ported phases only (everything but final2, prep's building walk stays inside prep)
    const portable = vs(i, j, (q) => ph[q][0].map((_, k) => PHASE_NAMES.reduce((s, n, p) => (n === 'final2' ? s : s + ph[q][p][k]), 0)));
    ratios[`${x}->${y}`] = { cycle: whole, portable, phases: per };
    log(`${x} -> ${y}: cycle ${whole ? `${whole.speedup.toFixed(3)}x [${whole.lo.toFixed(3)}, ${whole.hi.toFixed(3)}]` : 'n/a'}; without final2 ${portable ? `${portable.speedup.toFixed(3)}x [${portable.lo.toFixed(3)}, ${portable.hi.toFixed(3)}]` : 'n/a'}`);
  }
  log('median CPU ms per phase (sum over the cycle):');
  log('  ' + ['phase'.padEnd(12), ...kinds.map((k) => k.padStart(12))].join(''));
  for (let p = 0; p < PHASE_NAMES.length; p++) log('  ' + [PHASE_NAMES[p].padEnd(12), ...summary.map((s) => s.phases[PHASE_NAMES[p]].median.toFixed(2).padStart(12))].join(''));
  log('  ' + ['cycle'.padEnd(12), ...summary.map((s) => s.cycleMs.toFixed(2).padStart(12))].join(''));
  log('  ' + ['cycle min'.padEnd(12), ...summary.map((s) => s.cycleMin.toFixed(2).padStart(12))].join(''));
  // identity after warm + pairs cycles
  const identity: Record<string, string[]> = {};
  for (const a of arms.slice(1)) identity[a.kind] = [...diffTraffic(A0.tr, a.tr), ...diffCity(A0.st, a.st)];
  log(`identical to ${A0.kind} after ${warm + pairs} cycles: ${Object.entries(identity).map(([k, d]) => `${k} ${d.length === 0 ? 'yes' : 'NO ' + d.slice(0, 3).join('; ')}`).join(', ')}`);
  const wcore = arms.find((a) => a.kind === 'wasm')?.core as TrafficWasmCore | undefined;
  log(`wasm stats ${JSON.stringify(trafficWasmStats)}; arena ${wcore ? (wcore.arenaBytes / 1048576).toFixed(1) : '-'} MiB; last JS reason ${wcore?.lastJsReason || '-'}; rounds/cycle ${median(rounds)}`);
  return { fixture: spec, pop: A0.st.stats.population, roadNodes: A0.tr.road.n, pairs, warm, arms: summary, ratios, identity, stats: { ...trafficWasmStats }, arenaBytes: wcore?.arenaBytes, load: [load0, load1] };
});
