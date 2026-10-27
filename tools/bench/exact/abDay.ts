// @ts-nocheck — dev tool, bundled with rolldown (not type-checked by design; keeps `tsc --noEmit` independent of it)
/**
 * PI-1 headline numbers: CPU ms per simulated day of the whole sim, two identical arms (A/A) in separate isolates.
 *
 *   node tools/bench/sim-profile/bundle.mjs ../baselines/pi1Day          (-> node_modules/.cache/sim-profile/pi1Day.js)
 *   node --allow-natives-syntax node_modules/.cache/sim-profile/pi1Day.js --fixture F.metropolis
 *        [--mode design|headless] [--chunk 12] [--reps 32] [--warm 20] [--out result.json] [--testdefs]
 *        [--armB other/pi1Day.js] [--kernel nimby|blur|fire|traffic|services|sys:<system name>]
 * --armB: arm B is this harness bundled in another tree (copy this file there, bundle with that tree's bundle.mjs):
 *   the paired ratio is then B/A of two code versions, and `deterministic` says whether both ended bit-identical.
 * --kernel: each round times --chunk calls of one containing function on the warmed city (rebuildNimby, blur3 on a
 *   fixed 256² field at radius 2 and 1, the fire system's daily step with the day advanced, a full synchronous traffic
 *   cycle, a full services pass, or any system's daily step) instead of --chunk days.
 *
 * --mode design:   sim.advanceDay() + schedulerOf(sim).flush(sim) every day (every infra pass completes when due)
 * --mode headless: sim.advanceDay() only (the InfraScheduler's headless day budget)
 *
 * Method (docs/WASM_PLAN.md §7.11): each arm is a worker thread (its own isolate) that loads the fixture with zlib +
 * decodeBundle (never unpackFile, which detaches buffers and invalidates the protector), checks the protector with a
 * probe made first thing in the isolate, and warms up --warm days (JIT). Then --reps rounds, arms in alternating order
 * (AB, BA, ...) while the other arm and the main thread wait: each round rebuilds the city from the fixture bytes,
 * advances --warm days untimed, then times the next --chunk days, so every sample measures the SAME simulated days.
 * The clock is process CPU time (user + system) around the chunk: on Windows it ticks at ~15.6 ms, so size --chunk
 * for >= 1 s of CPU (worst-case tick error 2 x 15.6 ms per sample).
 * Output: per arm the median ms/day with a 95 % bootstrap CI, the paired A/A ratio (B/A) median + CI, a digest of each
 * city at the end (the arms must match: D1), the protector state and the city info before/after.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { cpus, loadavg, totalmem, platform, release } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };

function makeProbe(): (() => boolean) | null {
  try {
    const ta = new Float32Array(64);
    const probe = new Function('a', 'let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s;');
    const prep = new Function('f', 'a', '%PrepareFunctionForOptimization(f); f(a); f(a); %OptimizeFunctionOnNextCall(f); f(a);');
    const status = new Function('f', 'return %GetOptimizationStatus(f);');
    prep(probe, ta);
    const s0 = status(probe);
    return () => { probe(ta); return status(probe) === s0; };
  } catch {
    return null;
  }
}

const cpuMs = (): number => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };

if (!isMainThread) {
  const probe = makeProbe();
  const { fixture, mode, warm, testdefs } = workerData;
  if (testdefs) (await import('../../../tests/infra/cityGen')).registerTestDefs();
  const { decodeBundle } = await import('../../../src/save/bundle');
  const { deserializeCity, serializeCity } = await import('../../../src/save/serialize');
  const { Simulation } = await import('../../../src/sim/Simulation');
  const { createSystems } = await import('../../../src/sim/systems/index');
  const { schedulerOf } = await import('../../../src/sim/infra/scheduler');
  const raw = new Uint8Array(gunzipSync(readFileSync(fixture)));
  let sim, sch;
  // every round starts from a fresh copy of the fixture (decoded from the same bytes), so every sample times the same
  // simulated days; the load and the warm-up are not timed
  const fresh = () => {
    sim = new Simulation(deserializeCity(decodeBundle(raw.slice())), createSystems());
    sch = schedulerOf(sim);
  };
  const day = mode === 'design' ? () => { sim.advanceDay(); sch.flush(sim); } : () => sim.advanceDay();
  // --kernel: time --chunk calls of one containing function in situ (on the warmed city) instead of --chunk days
  const { kernel } = workerData;
  let kernelCall = null, kernelOut = () => '';
  if (kernel === 'nimby') {
    const { rebuildNimby } = await import('../../../src/sim/infra/nimby');
    kernelCall = () => rebuildNimby(sim);
  } else if (kernel === 'blur') {
    const { blur3 } = await import('../../../src/sim/infra/blur');
    const N = 256, base = new Float32Array(N * N), a = new Float32Array(N * N), tmp = new Float32Array(N * N);
    let s = 7;
    for (let i = 0; i < base.length; i++) { s = (s * 1103515245 + 12345) >>> 0; base[i] = (s >>> 8) / 65536 * ((i % 97) < 30 ? 1 : 0.01); }
    kernelCall = () => { a.set(base); blur3(a, tmp, N, 2); a.set(base); blur3(a, tmp, N, 1); };
    kernelOut = () => createHash('sha256').update(new Uint8Array(a.buffer)).digest('hex');
  } else if (kernel === 'fire') {
    kernelCall = () => { sim.state.day++; sim.getSystem('fire').daily(sim); };
  } else if (kernel === 'traffic') {
    // one full synchronous traffic cycle (what profile.ts --mode cycles times)
    kernelCall = () => { const tr = sim.getSystem('traffic'); tr.invalidate(); tr.runCycleSync(sim); };
  } else if (kernel === 'services') {
    kernelCall = () => sim.getSystem('services').compute(sim, false);
  } else if (kernel?.startsWith('sys:')) {
    // any system's daily step, with the day advanced (e.g. sys:economy.population)
    const name = kernel.slice(4);
    kernelCall = () => { sim.state.day++; sim.getSystem(name).daily(sim); };
  }
  const work = kernelCall ?? day;
  fresh();
  const info = () => { const s = sim.state.stats; return { day: sim.state.day, population: s.population, buildings: sim.state.buildings.size, funds: Math.round(sim.state.funds) }; };
  const digest = () => {
    const h = createHash('sha256');
    const walk = (v) => {
      if (ArrayBuffer.isView(v)) h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
      else if (Array.isArray(v)) { h.update('['); v.forEach(walk); h.update(']'); }
      else if (v && typeof v === 'object') for (const k of Object.keys(v).sort()) { if (k === 'savedAt') continue; h.update(k); walk(v[k]); }
      else h.update(String(v));
    };
    walk(serializeCity(sim.state, { copy: true }));
    return h.digest('hex');
  };
  const info0 = info();
  for (let i = 0; i < warm; i++) day();
  parentPort.postMessage({ ready: true, info0, intact: probe ? probe() : null });
  parentPort.on('message', (m) => {
    if (m.run) {
      fresh();
      for (let i = 0; i < warm; i++) day();
      const c0 = cpuMs(), w0 = performance.now();
      for (let i = 0; i < m.run; i++) work();
      parentPort.postMessage({ cpu: cpuMs() - c0, wall: performance.now() - w0 });
    } else if (m.finish) {
      parentPort.postMessage({ info1: info(), digest: digest() + kernelOut(), intact: probe ? probe() : null });
    }
  });
} else {
  const fixture = arg('fixture');
  const mode = arg('mode', 'design');
  const chunk = +arg('chunk', '12');
  const reps = +arg('reps', '32');
  const warm = +arg('warm', '20');
  const out = arg('out');
  const self = fileURLToPath(import.meta.url);
  // each worker's messages are queued from creation: a message that arrives while we wait on the other arm is kept
  // --armB <bundle.js>: arm B runs this same harness bundled against another tree (a J-fix worktree): an A/B instead of A/A
  const armB = arg('armB');
  const kernel = arg('kernel');
  const arms = [0, 1].map((k) => {
    const w = new Worker(k === 1 && armB ? armB : self, { workerData: { fixture, mode, warm, kernel, testdefs: argv.includes('--testdefs') } });
    const box = { w, queue: [], waiter: null, error: null };
    w.on('message', (m) => { if (box.waiter) { const r = box.waiter; box.waiter = null; r.res(m); } else box.queue.push(m); });
    w.on('error', (e) => { box.error = e; if (box.waiter) box.waiter.rej(e); });
    w.on('exit', (c) => { if (box.waiter) box.waiter.rej(new Error(`arm exited with ${c}`)); });
    return box;
  });
  const next = (box) => box.queue.length ? Promise.resolve(box.queue.shift()) : box.error ? Promise.reject(box.error) : new Promise((res, rej) => { box.waiter = { res, rej }; });
  const ask = (box, m) => { box.w.postMessage(m); return next(box); };
  const t0 = Date.now();
  const ready = [];
  for (const a of arms) ready.push(await next(a)); // both arms load and warm up concurrently, before any measurement
  const samples = [[], []];
  const walls = [[], []];
  for (let r = 0; r < reps; r++) {
    const order = r % 2 ? [1, 0] : [0, 1];
    for (const a of order) {
      const res = await ask(arms[a], { run: chunk });
      samples[a].push(res.cpu / chunk);
      walls[a].push(res.wall / chunk);
    }
  }
  const fin = [];
  for (const a of arms) fin.push(await ask(a, { finish: true }));
  for (const a of arms) await a.w.terminate();

  const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const boot = (xs, B = 2000) => { const ms = []; for (let b = 0; b < B; b++) { const s = []; for (let i = 0; i < xs.length; i++) s.push(xs[Math.floor(rnd() * xs.length)]); ms.push(median(s)); } ms.sort((a, b) => a - b); return [ms[Math.floor(0.025 * B)], ms[Math.floor(0.975 * B)]]; };
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const armStats = (a) => ({ medianMsPerDay: r3(median(samples[a])), ci95: boot(samples[a]).map(r3), minMsPerDay: r3(Math.min(...samples[a])), medianWallMsPerDay: r3(median(walls[a])) });
  const ratios = samples[1].map((b, i) => b / samples[0][i]);
  const pooled = samples[0].map((a, i) => 0.5 * (a + samples[1][i]));
  const res = {
    fixture, mode, chunk, reps, warm, armB: armB ?? null, kernel: kernel ?? 'day', timedDays: `${warm + 1}..${warm + chunk} after load, every round`,
    tickErrorPct: r3((2 * 15.625 * 100) / (median(pooled) * chunk)),
    msPerDay: { median: r3(median(pooled)), ci95: boot(pooled).map(r3), note: 'per round, mean of the two arms; CPU time (process user+system)' },
    armA: armStats(0), armB: armStats(1),
    aa: { ratioBoverA: r3(median(ratios)), ci95: boot(ratios).map(r3), min: r3(Math.min(...ratios)), max: r3(Math.max(...ratios)) },
    deterministic: fin[0].digest === fin[1].digest, digest: fin[0].digest.slice(0, 16),
    protectorIntact: { ready: ready.map((x) => x.intact), end: fin.map((x) => x.intact) },
    info0: ready[0].info0, info1: fin[0].info1,
    env: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0].model, threads: cpus().length, memGB: Math.round(totalmem() / 2 ** 30), loadavg: loadavg() },
    wallS: Math.round((Date.now() - t0) / 1000),
  };
  console.log(JSON.stringify(res, null, 1));
  if (out) writeFileSync(out, JSON.stringify({ ...res, samples, walls }, null, 1));
}
