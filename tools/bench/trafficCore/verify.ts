/**
 * Step-by-step equivalence on a city: the original traffic.ts, the fair JS core and the wasm core (three Simulations
 * of the same city) are stepped phase by phase; after the warm-start cycle and after EVERY step the whole traffic
 * state (diffTraffic) and the city's traffic outputs (diffCity) must be identical. Reports which path ran.
 *   args: --fixture stress96|stress256|dense1m|bot256|stress1m|<file> [--fixtures DIR] [--cycles 4] [--arms fair,wasm]
 */
import { benchMain, loadAvg } from '../node';
import { initSimWasmSync, simWasmStatus } from '../../../src/wasm/simWasm';
import { resetTrafficWasmStats, trafficWasmStats, type TrafficWasmCore } from '../../../src/wasm/kernels/trafficBind';
import { fixtureDir, loadCity } from './fixtures';
import { makeArm, PHASE_NAMES, type ArmKind } from './arms';
import { diffCity, diffTraffic } from './compare';

benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
  const spec = opt('--fixture', 'stress96')!;
  const cycles = Number(opt('--cycles', '4'));
  const others = opt('--arms', 'fair,wasm')!.split(',') as ArmKind[];
  if (!initSimWasmSync()) throw new Error('wasm init failed: ' + simWasmStatus().error);
  resetTrafficWasmStats();
  const dir = fixtureDir(args);
  const mk = async (k: ArmKind) => makeArm(k, (await loadCity(spec, dir)).st);
  const A = await mk('orig');
  const B = await Promise.all(others.map((k) => mk(k)));
  log(`# ${spec}: pop ${A.st.stats.population}, road nodes ${A.tr.road.n}, origins ${A.tr.oN}, sites ${A.tr.jN}, clusters ${A.tr.qN}, stops ${A.tr.stops.n}; load ${loadAvg().join(' ')}`);
  const fails: string[] = [];
  const check = (where: string) => {
    for (const b of B) {
      const d = [...diffTraffic(A.tr, b.tr), ...diffCity(A.st, b.st)];
      if (d.length) fails.push(`${b.kind} @ ${where}: ${d.slice(0, 6).join('; ')}`);
    }
  };
  check('warm-start cycle');
  let steps = 0;
  for (let cy = 0; cy < cycles && fails.length === 0; cy++) {
    for (const x of [A, ...B]) { x.tr.phase = 0; x.tr.lastCycleStart = x.st.day; }
    while (A.tr.phase >= 0 && fails.length === 0) {
      const ph = A.tr.phase;
      for (const x of [A, ...B]) {
        if (x.tr.phase !== ph) { fails.push(`${x.kind}: phase ${x.tr.phase} vs ${ph}`); break; }
        x.tr.step(x.sim);
      }
      steps++;
      check(`cycle ${cy} ${PHASE_NAMES[ph]} (round ${A.tr.round})`);
    }
  }
  const wasm = B.find((b) => b.kind === 'wasm')?.core as TrafficWasmCore | undefined;
  log(`${fails.length === 0 ? 'IDENTICAL' : 'DIFFERENT'} after the warm-start cycle + ${cycles} cycles (${steps} steps compared)`);
  for (const f of fails.slice(0, 8)) log('  ' + f);
  log(`wasm stats ${JSON.stringify(trafficWasmStats)}; last JS reason: ${wasm?.lastJsReason || '-'}`);
  log(`wasm core calls ${JSON.stringify(wasm?.calls ?? {})}`);
  return { spec, cycles, steps, identical: fails.length === 0, fails, stats: { ...trafficWasmStats }, lastJsReason: wasm?.lastJsReason ?? null };
});
