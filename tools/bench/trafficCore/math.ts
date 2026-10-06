/**
 * Bit test of the traffic kernels' exp / log against this engine's Math.exp / Math.log: `--random N` random arguments
 * per function (default 10^8: all bit patterns, the logit range, utility differences <= 0, price ratios [0.25, 8]) plus
 * EVERY argument the traffic phases pass to Math.exp / Math.log during `--cycles` cycles of each fixture (recorded
 * through a wrapper around the fair JS core's calls, which are the original's calls). Mismatch count must be 0.
 * The shipped binary imports the engine's functions (env.js_exp / env.js_log), so it matches by construction: this is a
 * wiring check. `--fdlibm FILE` (the benchmark-only build with the inline fdlibm port, V8's algorithm) is checked too:
 * exact on V8, but only there.
 *   args: [--random 100000000] [--fixtures DIR] [--cities dense1m,bot256,stress1m] [--cycles 4] [--fdlibm FILE]
 */
import { benchMain, loadAvg } from '../node';
import { initSimWasmSync, simWasmInstance, simWasmStatus, type SimWasmInstance } from '../../../src/wasm/simWasm';
import { instanceFromFile } from './instances';
import { makeFairTrafficCore } from '../../../src/wasm/js/trafficCore';
import { installTrafficCore } from '../../../src/wasm/kernels/trafficDriver';
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { deps, fairSearch, P } from './deps';
import { fixtureDir, loadCity } from './fixtures';

benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
  const N = Number(opt('--random', '100000000'));
  const cycles = Number(opt('--cycles', '4'));
  const cities = opt('--cities', 'dense1m,bot256,stress1m')!.split(',').filter(Boolean);
  if (!initSimWasmSync()) throw new Error('wasm init failed: ' + simWasmStatus().error);
  const builds: [string, SimWasmInstance][] = [['shipped (imported Math.exp / Math.log)', simWasmInstance()!]];
  if (opt('--fdlibm')) builds.push(['inline fdlibm (benchmark-only build)', instanceFromFile(opt('--fdlibm')!, 'fdlibm')]);
  const CH = 1 << 20;
  const same = (a: number, b: number) => Object.is(a, b) || (a !== a && b !== b);
  const out: Record<string, unknown> = {};
  for (const [label, w] of builds) {
  log(`## ${label}`);
  const ex = w.exports as unknown as { traffic_math_batch(x: number, o: number, n: number, which: number): void };
  const h = w.heap;
  const p = h.alloc(16 * CH + 64, 16);
  const check = (xs: Float64Array, which: 0 | 1): number => {
    let bad = 0;
    for (let s = 0; s < xs.length; s += CH) {
      const n = Math.min(CH, xs.length - s);
      new Float64Array(h.memory.buffer, p, n).set(xs.subarray(s, s + n));
      ex.traffic_math_batch(p, p + 8 * CH, n, which);
      const R = new Float64Array(h.memory.buffer, p + 8 * CH, n), X = new Float64Array(h.memory.buffer, p, n);
      const f = which ? Math.log : Math.exp;
      for (let i = 0; i < n; i++) if (!same(R[i], f(X[i]))) { if (bad++ < 5) log(`MISMATCH ${which ? 'log' : 'exp'}(${X[i]}) wasm ${R[i]} js ${f(X[i])}`); }
    }
    return bad;
  };
  // ---- random arguments
  const t0 = Date.now();
  let s = 0x2545f491 >>> 0;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  const buf = new Float64Array(CH), U = new Uint32Array(buf.buffer);
  let badR = 0, doneR = 0;
  for (let k = 0; k < N; k += CH) {
    const n = Math.min(CH, N - k);
    for (let i = 0; i < n; i++) {
      const m = (i + k) & 3;
      if (m === 0) { U[2 * i] = r(); U[2 * i + 1] = r(); } else if (m === 1) buf[i] = (r() / 4294967296 - 0.5) * 1500; else if (m === 2) buf[i] = -(r() / 4294967296) * 40; else buf[i] = 0.25 + (r() / 4294967296) * 7.75;
    }
    const xs = buf.subarray(0, n);
    badR += check(xs, 0) + check(xs, 1);
    doneR += n;
    if ((k / CH) % 20 === 0) log(`random: ${doneR.toExponential(2)} arguments x 2 functions, ${badR} mismatches (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  log(`random: ${doneR} arguments per function, ${badR} mismatches`);
  // ---- every argument of the cities' cycles
  const perCity: Record<string, { exp: number; log: number; bad: number }> = {};
  for (const spec of cities) {
    const st = (await loadCity(spec, fixtureDir(args))).st;
    const systems = createSystems();
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const tr = systems.find((x) => x.name === 'traffic') as any;
    installTrafficCore(tr, deps, makeFairTrafficCore(P, fairSearch));
    const sim = new Simulation(st, systems);
    const E: number[] = [], L: number[] = [];
    const exp0 = Math.exp, log0 = Math.log;
    Math.exp = (x: number) => { E.push(x); return exp0(x); };
    Math.log = (x: number) => { L.push(x); return log0(x); };
    try {
      for (let k = 0; k < cycles; k++) tr.runCycleSync(sim);
    } finally {
      Math.exp = exp0; Math.log = log0;
    }
    const bad = check(Float64Array.from(E), 0) + check(Float64Array.from(L), 1);
    perCity[spec] = { exp: E.length, log: L.length, bad };
    log(`${spec}: ${E.length} exp + ${L.length} log arguments from ${cycles} cycles, ${bad} mismatches`);
  }
  h.free(p);
  out[label] = { random: doneR, randomMismatches: badR, cities: perCity };
  }
  return { node: process.version, builds: out, load: loadAvg() };
});
