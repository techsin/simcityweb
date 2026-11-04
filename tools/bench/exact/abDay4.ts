// @ts-nocheck — dev tool, bundled with rolldown (not type-checked by design; keeps `tsc --noEmit` independent of it)
/**
 * T015 whole-day A/B with several fresh isolates per arm and an A/A (and B/B) pair inside every run
 * (docs/WASM_PLAN.md finding 4; derived from tools/bench/baselines/pi1Day.ts).
 *
 *   copy this file to tools/bench/exact/abDay4.ts in BOTH trees, bundle each with that tree's bundle.mjs:
 *     node tools/bench/sim-profile/bundle.mjs ../exact/abDay4
 *   node --allow-natives-syntax <treeA>/node_modules/.cache/sim-profile/abDay4.js --fixture F.metropolis
 *        --armB <treeB>/node_modules/.cache/sim-profile/abDay4.js [--iso 2] [--mode design|headless]
 *        [--chunk 180] [--reps 24] [--warm 20] [--out result.json]
 *
 * Workers: --iso isolates per arm (A0, B0, A1, B1, ...; arm A runs this bundle, arm B the --armB bundle). Each loads
 * the fixture with zlib + decodeBundle (never unpackFile), checks the protector with a probe made first thing, and
 * warms --warm days. Then --reps rounds: every worker runs once per round, one at a time while the others wait; the
 * order rotates every round and reverses on odd rounds, so each worker takes every position equally often. Each run
 * rebuilds the city from the fixture bytes, advances --warm days untimed and times the next --chunk days (the SAME
 * simulated days every time).
 * Clocks: process CPU (user + system, all threads; ticks at ~15.6 ms on Windows, so size --chunk for >= 1 s) and wall
 * (the worker's elapsed time; the stand-in for thread CPU, which node 22.12 lacks: process.threadCpuUsage needs 23.9).
 * Statistics: per arm mean / median ms per day; B/A as (a) a hierarchical bootstrap (resample isolates within each arm,
 * then chunks within each isolate) of the ratio of means and the ratio of medians, (b) the per-round paired ratio
 * (mean of the arm's isolates in that round), median + bootstrap CI over rounds. The same for A1/A0 and B1/B0 (A/A, B/B).
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
  const { fixture, mode, warm } = workerData;
  const { decodeBundle } = await import('../../../src/save/bundle');
  const { deserializeCity, serializeCity } = await import('../../../src/save/serialize');
  const { Simulation } = await import('../../../src/sim/Simulation');
  const { createSystems } = await import('../../../src/sim/systems/index');
  const { schedulerOf } = await import('../../../src/sim/infra/scheduler');
  const raw = new Uint8Array(gunzipSync(readFileSync(fixture)));
  let sim, sch;
  const fresh = () => {
    sim = new Simulation(deserializeCity(decodeBundle(raw.slice())), createSystems());
    sch = schedulerOf(sim);
  };
  const day = mode === 'design' ? () => { sim.advanceDay(); sch.flush(sim); } : () => sim.advanceDay();
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
      const svc = sim.getSystem('services');
      const p0 = svc?.passNo ?? 0;
      const c0 = cpuMs(), w0 = performance.now();
      for (let i = 0; i < m.run; i++) day();
      parentPort.postMessage({ cpu: cpuMs() - c0, wall: performance.now() - w0, passes: (svc?.passNo ?? 0) - p0 });
    } else if (m.finish) {
      parentPort.postMessage({ info1: info(), digest: digest(), intact: probe ? probe() : null });
    }
  });
} else {
  const fixture = arg('fixture');
  const mode = arg('mode', 'design');
  const chunk = +arg('chunk', '180');
  const reps = +arg('reps', '24');
  const warm = +arg('warm', '20');
  const iso = +arg('iso', '2');
  const out = arg('out');
  const armBPath = arg('armB');
  if (!armBPath) throw new Error('--armB is required');
  const self = fileURLToPath(import.meta.url);
  // workers: A0, B0, A1, B1, ... (arm k % 2, isolate k >> 1); each worker's messages are queued from creation
  const W = 2 * iso;
  const workers = Array.from({ length: W }, (_, k) => {
    const arm = k % 2, ix = k >> 1;
    const w = new Worker(arm === 1 ? armBPath : self, { workerData: { fixture, mode, warm } });
    const box = { w, arm, ix, name: `${arm ? 'B' : 'A'}${ix}`, queue: [], waiter: null, error: null };
    w.on('message', (m) => { if (box.waiter) { const r = box.waiter; box.waiter = null; r.res(m); } else box.queue.push(m); });
    w.on('error', (e) => { box.error = e; if (box.waiter) box.waiter.rej(e); });
    w.on('exit', (c) => { if (box.waiter) box.waiter.rej(new Error(`${box.name} exited with ${c}`)); });
    return box;
  });
  const next = (box) => box.queue.length ? Promise.resolve(box.queue.shift()) : box.error ? Promise.reject(box.error) : new Promise((res, rej) => { box.waiter = { res, rej }; });
  const ask = (box, m) => { box.w.postMessage(m); return next(box); };
  const t0 = Date.now();
  const ready = [];
  for (const b of workers) ready.push(await next(b)); // all load and warm up concurrently, before any measurement
  // cpu[arm][isolate][round], wall likewise
  const cpu = [0, 1].map(() => Array.from({ length: iso }, () => []));
  const wall = [0, 1].map(() => Array.from({ length: iso }, () => []));
  const passes = [0, 1].map(() => Array.from({ length: iso }, () => []));
  const orders = [];
  for (let r = 0; r < reps; r++) {
    let order = workers.map((_, k) => (k + r) % W);
    if (r % 2) order = order.reverse();
    orders.push(order.map((k) => workers[k].name).join(''));
    for (const k of order) {
      const b = workers[k];
      const res = await ask(b, { run: chunk });
      cpu[b.arm][b.ix].push(res.cpu / chunk);
      wall[b.arm][b.ix].push(res.wall / chunk);
      passes[b.arm][b.ix].push(res.passes);
    }
    process.stderr.write(`round ${r + 1}/${reps} ${orders[r]} A ${cpu[0].map((v) => v[r].toFixed(2)).join('/')} B ${cpu[1].map((v) => v[r].toFixed(2)).join('/')}\n`);
  }
  const fin = [];
  for (const b of workers) fin.push(await ask(b, { finish: true }));
  for (const b of workers) await b.w.terminate();

  const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const B = 4000;
  const ci = (vals) => { vals.sort((a, b) => a - b); return [vals[Math.floor(0.025 * B)], vals[Math.floor(0.975 * B)]]; };
  const r4 = (x) => Math.round(x * 10000) / 10000;
  // hierarchical resample of one arm: isolates with replacement, then that isolate's chunks with replacement
  const resampleArm = (arm) => { const s = []; for (let i = 0; i < arm.length; i++) { const iso_ = pick(arm); for (let j = 0; j < iso_.length; j++) s.push(pick(iso_)); } return s; };
  const hier = (num, den) => {
    const rm = [], rmed = [];
    for (let b = 0; b < B; b++) { const n = resampleArm(num), d = resampleArm(den); rm.push(mean(n) / mean(d)); rmed.push(median(n) / median(d)); }
    const all = (x) => x.flat();
    return { meanRatio: r4(mean(all(num)) / mean(all(den))), meanCi95: ci(rm).map(r4), medianRatio: r4(median(all(num)) / median(all(den))), medianCi95: ci(rmed).map(r4) };
  };
  const paired = (num, den) => {
    // per round: mean over the given isolates (num / den are arrays of per-isolate round series)
    const rs = num[0].map((_, r) => mean(num.map((s) => s[r])) / mean(den.map((s) => s[r])));
    const boots = [];
    for (let b = 0; b < B; b++) { const s = []; for (let i = 0; i < rs.length; i++) s.push(pick(rs)); boots.push(median(s)); }
    return { median: r4(median(rs)), ci95: ci(boots).map(r4), mean: r4(mean(rs)), min: r4(Math.min(...rs)), max: r4(Math.max(...rs)) };
  };
  const armStats = (a, src) => ({ meanMsPerDay: r4(mean(src[a].flat())), medianMsPerDay: r4(median(src[a].flat())), minMsPerDay: r4(Math.min(...src[a].flat())),
    perIsolateMean: src[a].map((s) => r4(mean(s))), perIsolateMedian: src[a].map((s) => r4(median(s))) });
  const clockBlock = (src) => ({
    armA: armStats(0, src), armB: armStats(1, src),
    BoverA: { hierarchical: hier(src[1], src[0]), pairedRounds: paired(src[1], src[0]) },
    AA: iso >= 2 ? { hierarchical: hier([src[0][1]], [src[0][0]]), pairedRounds: paired([src[0][1]], [src[0][0]]) } : null,
    BB: iso >= 2 ? { hierarchical: hier([src[1][1]], [src[1][0]]), pairedRounds: paired([src[1][1]], [src[1][0]]) } : null,
  });
  const digests = fin.map((f, k) => ({ worker: workers[k].name, digest: f.digest.slice(0, 16) }));
  const sameWithin = [0, 1].map((a) => new Set(fin.filter((_, k) => workers[k].arm === a).map((f) => f.digest)).size === 1);
  const res = {
    fixture, mode, chunk, reps, warm, iso, armA: self, armB: armBPath, timedDays: `${warm + 1}..${warm + chunk} after load, every run`,
    tickErrorPct: r4((2 * 15.625 * 100) / (median(cpu[0].flat()) * chunk)),
    processCpu: clockBlock(cpu),
    wall: clockBlock(wall),
    // B/A < 1 = arm B faster; speedup = 1 / ratio
    speedupProcessCpu: { mean: r4(1 / (mean(cpu[1].flat()) / mean(cpu[0].flat()))), median: r4(1 / (median(cpu[1].flat()) / median(cpu[0].flat()))) },
    servicesPassesPerChunk: { A: passes[0].map((s) => [...new Set(s)]), B: passes[1].map((s) => [...new Set(s)]) },
    deterministicWithinArm: { A: sameWithin[0], B: sameWithin[1] }, digests,
    protectorIntact: { ready: ready.map((x) => x.intact), end: fin.map((x) => x.intact) },
    info0: ready[0].info0, info1A: fin[0].info1, info1B: fin[1].info1, orders,
    env: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0].model, threads: cpus().length, memGB: Math.round(totalmem() / 2 ** 30), loadavg: loadavg() },
    wallS: Math.round((Date.now() - t0) / 1000),
  };
  console.log(JSON.stringify(res, null, 1));
  if (out) writeFileSync(out, JSON.stringify({ ...res, samples: { cpu, wall, passes } }, null, 1));
}
