/**
 * System-level A/B: the full simulation (all infra + economy systems) on the 256² stress city, with the blur module
 * swapped for the wasm bindings (tools/bench/sim.plugins.mjs) — sim A runs with preference 'js', sim B with the
 * wasm kernels, in interleaved chunks of 12 days (one pollution period). Reports CPU ms per simulated day, the time
 * spent inside blur calls, and checks that both cities end bit-identical.
 *   npm run bench:wasm -- sim [--json out.json] [--reps N]
 */
import { createSystems } from '../../src/sim/systems';
import { Simulation } from '../../src/sim/Simulation';
import { initSimWasmSync, setSimWasmPreference, simWasmStatus } from '../../src/wasm/simWasm';
import { registerTestDefs, stressCity } from '../../tests/infra/cityGen';
import { bootstrapMedianCI } from './ab';
import { benchMain, cpuMs } from './node';

const stats = (): { ms: number; calls: number } => ((globalThis as { __blurStats?: { ms: number; calls: number } }).__blurStats ??= { ms: 0, calls: 0 });

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) >> 1] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]);
}

function sameLayers(a: object, b: object): boolean {
  for (const [k, v] of Object.entries(a)) {
    const w = (b as Record<string, unknown>)[k];
    const list = Array.isArray(v) && v.every((x) => ArrayBuffer.isView(x)) ? (v as ArrayBufferView[]) : ArrayBuffer.isView(v) ? [v] : null;
    if (!list) continue;
    const other = Array.isArray(w) ? (w as ArrayBufferView[]) : [w as ArrayBufferView];
    for (let i = 0; i < list.length; i++) {
      const x = new Uint8Array(list[i].buffer, list[i].byteOffset, list[i].byteLength), y = new Uint8Array(other[i].buffer, other[i].byteOffset, other[i].byteLength);
      if (x.length !== y.length) return false;
      for (let j = 0; j < x.length; j++) if (x[j] !== y[j]) return false;
    }
  }
  return JSON.stringify((a as { stats: unknown }).stats) === JSON.stringify((b as { stats: unknown }).stats);
}

benchMain(({ args, log }) => {
  const reps = Number(args[args.indexOf('--reps') + 1]) || 15;
  const CHUNK = 12;
  if (!initSimWasmSync()) throw new Error('wasm init failed: ' + simWasmStatus().error);
  registerTestDefs();
  const mk = () => {
    const c = stressCity(256);
    return { city: c, sim: new Simulation(c.st, createSystems()) };
  };
  const A = mk(), B = mk();
  log(`# stress city 256²: ${A.city.buildings} buildings, pop ${A.city.pop}, ${A.city.roadCells} road cells; chunks of ${CHUNK} days, ${reps} pairs`);
  const run = (X: typeof A, pref: 'js' | 'auto') => {
    setSimWasmPreference(pref);
    const s = stats();
    s.ms = 0; s.calls = 0;
    const t0 = cpuMs();
    X.sim.runDays(CHUNK);
    return { ms: (cpuMs() - t0) / CHUNK, blurMs: s.ms / CHUNK, calls: s.calls };
  };
  // warm-up: two chunks each
  for (let k = 0; k < 2; k++) { run(A, 'js'); run(B, 'auto'); }
  const a: number[] = [], b: number[] = [], ab: number[] = [], bb: number[] = [], ratio: number[] = [];
  let callsA = 0, callsB = 0;
  for (let k = 0; k < reps; k++) {
    let ra, rb;
    if (k % 2 === 0) { ra = run(A, 'js'); rb = run(B, 'auto'); } else { rb = run(B, 'auto'); ra = run(A, 'js'); }
    a.push(ra.ms); b.push(rb.ms); ab.push(ra.blurMs); bb.push(rb.blurMs); ratio.push(rb.ms / ra.ms);
    callsA += ra.calls; callsB += rb.calls;
    log(`pair ${k}: js ${ra.ms.toFixed(1)} ms/day (blur ${ra.blurMs.toFixed(2)}) | wasm ${rb.ms.toFixed(1)} ms/day (blur ${rb.blurMs.toFixed(2)})`);
  }
  setSimWasmPreference('auto');
  const ci = bootstrapMedianCI(ratio);
  const identical = sameLayers(A.city.st, B.city.st);
  const res = {
    days: (reps + 2) * CHUNK, pop: A.city.st.stats.population,
    jsMsPerDay: median(a), wasmMsPerDay: median(b), speedup: 1 / median(ratio), speedupCI: [1 / ci.hi, 1 / ci.lo],
    blurJsMsPerDay: median(ab), blurWasmMsPerDay: median(bb), blurShareJs: median(ab) / median(a), blurCallsPerDay: callsA / (reps * CHUNK),
    identical, wasmCalls: callsB,
  };
  log(`full sim: js ${res.jsMsPerDay.toFixed(1)} ms/day, wasm-blur ${res.wasmMsPerDay.toFixed(1)} ms/day, speedup ${res.speedup.toFixed(3)}x [${res.speedupCI.map((v) => v.toFixed(3)).join(', ')}]`);
  log(`blur inside the sim: js ${res.blurJsMsPerDay.toFixed(3)} ms/day (${(100 * res.blurShareJs).toFixed(2)}% of the day), wasm ${res.blurWasmMsPerDay.toFixed(3)} ms/day, ${res.blurCallsPerDay.toFixed(2)} calls/day`);
  log(`cities bit-identical after ${res.days} days: ${identical}; population ${res.pop}`);
  return res;
});
