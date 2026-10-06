#!/usr/bin/env node
/**
 * Services tier engine A/B driver — ONE ISOLATE PER ARM, in node AND headless Chromium.
 *
 *   node tools/bench/servicesTierEngine.bench.mjs [node|browser|all] --fixture F.metropolis [--fixture G ...]
 *        [--cases replay,warm,cold,insitu] [--arms orig,fair,wasm,scalar,resident] [--replay-arms orig,fair,wasm,staged,scalar]
 *        [--reps 31] [--chunk 6] [--protector intact|invalidated|both] [--warm-ms 600] [--browser-cases ...] [--json out.json]
 *   npm run bench:services -- all --fixture <dir>/dense1m_s7.metropolis --json out.json
 *
 * Why one isolate per arm: V8's ArrayBuffer-detaching protector is per isolate and, once invalidated (any detach:
 * memory.grow, a postMessage transfer list), slows every typed-array loop of that isolate by 7–16 %. A single-process
 * A/B lets one arm's memory.grow tax the other arm. Here each arm is its own node process (fork, IPC) or its own
 * dedicated Worker (Chromium), the wasm arms run the pre-sized binary (never grows), and every sample records the
 * protector state (node --allow-natives-syntax / chromium --js-flags=--allow-natives-syntax probe).
 *   --protector intact       (default) nothing detaches: the sim worker of the integration plan
 *   --protector invalidated  every arm detaches a buffer first: today's main thread (lodBuilder.ts:82 transfers)
 *
 * Arms (tools/bench/servicesTierEngine.core.ts BenchArm):
 *   orig      the live ServicesSystem (services.ts / catchments.ts / transit.ts)
 *   fair      the restructured JS engine (src/wasm/js/servicesTierEngine.ts) installed with backend 'js'
 *   wasm      the engine on the committed SIMD binary (src/wasm/sim_kernels.wasm), CityState layers STAGED (copied in /
 *             out per call, need rasters once per pass, the network once per step): marshalling included
 *   scalar    the same Rust built without +simd128 (node tools/build-wasm.mjs --variant scalar; cargo needed)
 *   resident  SIMD with the CityState layers + need rasters adopted into wasm memory (zero copies)
 *   staged    (replay only) SIMD with the need raster copied in per call
 * Cases:
 *   replay    (a) the phase kernels (alloc / union / report / finalize) on the slots captured after one original pass
 *   warm/cold (b) one full services pass, cached reaches / every road reach fresh (invalidateReach(undefined))
 *   insitu    (d) the whole sim at design cadence (advanceDay + scheduler flush), `chunk`-day chunks: sim ms/day,
 *             services ms/day, tier engine ms/day — the end-to-end measurement
 * Protocol: warm-up >= warm-ms CPU per arm (and >= 3 samples), then `reps` rounds; each round runs every arm once in a
 * rotated order (arm r % n first); the clock is process.cpuUsage() inside the arm process (node; the process is
 * otherwise idle) or performance.now() inside the worker (Chromium; wall clock). Statistics: per arm median / min,
 * paired speedup median(t_A / t_B) with a 95 % bootstrap CI (10,000 resamples). After every case the arms' cities must
 * hash identically (bit-identical simulations).
 */
import { spawnSync, fork } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg, cpus } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'node_modules', '.cache', 'sim-bench');
mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const mode = ['node', 'browser', 'all'].includes(argv[0]) ? argv.shift() : 'node';
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const fixtures = argv.flatMap((v, i) => (v === '--fixture' ? [resolve(argv[i + 1])] : []));
if (fixtures.length === 0) {
  console.error('usage: servicesTierEngine.bench.mjs [node|browser|all] --fixture F.metropolis [...] (see the file header)');
  process.exit(2);
}
const CASES = opt('--cases', 'replay,warm,cold,insitu').split(',');
const BROWSER_CASES = opt('--browser-cases', opt('--cases', 'replay,warm,cold,insitu')).split(',');
const SIM_ARMS = opt('--arms', 'orig,fair,wasm,scalar,resident').split(',');
const REPLAY_ARMS = opt('--replay-arms', 'orig,fair,wasm,staged,scalar').split(',');
const BROWSER_ARMS = opt('--browser-arms', 'orig,fair,wasm,scalar').split(',');
const REPS = Number(opt('--reps', 31));
const CHUNK = Number(opt('--chunk', 6));
const WARM_MS = Number(opt('--warm-ms', 600));
const PROTECTORS = (opt('--protector', 'intact') === 'both' ? ['intact', 'invalidated'] : [opt('--protector', 'intact')]);
const jsonFile = opt('--json');
const SIMD = join(ROOT, 'src', 'wasm', 'sim_kernels.wasm');
const la = () => loadavg().map((v) => +v.toFixed(1));
const result = { meta: { node: process.version, v8: process.versions.v8, cpus: cpus().length, cpu: cpus()[0]?.model, reps: REPS, chunk: CHUNK, warmMs: WARM_MS, load: la(), started: new Date().toISOString() }, node: {}, browser: {} };
const save = () => { if (jsonFile) writeFileSync(jsonFile, JSON.stringify(result, null, 1)); };

// ------------------------------------------------------------------------------------------------ statistics
function median(xs) {
  const s = xs.slice().sort((p, q) => p - q);
  const n = s.length;
  return n === 0 ? NaN : n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
}
function xrng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
/** speedup of B over A from paired samples: median of a_i / b_i, 95 % percentile-bootstrap CI (10k resamples) */
function paired(a, b, seed = 99) {
  const r = a.map((x, i) => x / b[i]);
  const R = xrng(seed), n = r.length, meds = [], buf = new Array(n), B = 10000;
  for (let k = 0; k < B; k++) { for (let i = 0; i < n; i++) buf[i] = r[(R() * n) | 0]; meds.push(median(buf)); }
  meds.sort((p, q) => p - q);
  return { n, speedup: median(r), lo: meds[Math.floor(0.025 * B)], hi: meds[Math.ceil(0.975 * B) - 1], medA: median(a), medB: median(b), minA: Math.min(...a), minB: Math.min(...b) };
}
const f2 = (v) => (v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3));
const fmt = (s) => `${s.speedup.toFixed(3)}x [${s.lo.toFixed(3)}, ${s.hi.toFixed(3)}]  (median ${f2(s.medA)} -> ${f2(s.medB)} ms, min ${f2(s.minA)} -> ${f2(s.minB)})`;
const PAIRS = [['orig', 'wasm'], ['fair', 'wasm'], ['orig', 'fair'], ['scalar', 'wasm'], ['orig', 'scalar'], ['wasm', 'resident'], ['orig', 'resident'], ['fair', 'resident'], ['wasm', 'staged']];

function summarise(tag, samples, metrics, log) {
  const out = {};
  for (const [A, B] of PAIRS) {
    if (!samples[A] || !samples[B]) continue;
    const key = `${A}->${B}`;
    out[key] = {};
    for (const m of metrics) {
      const a = samples[A].map((s) => s[m]), b = samples[B].map((s) => s[m]);
      if (a.some((v) => !(v > 0)) || b.some((v) => !(v > 0))) continue;
      out[key][m] = paired(a, b);
      log(`  ${tag} ${key.padEnd(15)} ${m.padEnd(9)} ${fmt(out[key][m])}`);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ builds
function scalarBinary() {
  const file = join(OUT, 'sim_kernels.scalar.wasm');
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-wasm.mjs'), '--variant', 'scalar', '--out', OUT], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    console.log(`# scalar build unavailable (${(r.stderr || r.stdout || '').trim().split('\n').pop()}): the scalar arm is skipped`);
    return null;
  }
  return existsSync(file) ? file : null;
}

async function bundle(entry, file, platform) {
  const { rolldown } = await import('rolldown');
  const b = await rolldown({ input: entry, platform, logLevel: 'warn' });
  await b.write({ format: 'esm', file });
  await b.close();
  return file;
}

// ------------------------------------------------------------------------------------------------ arms
/** node: one forked process per arm, serialised request / response over IPC */
function nodeArm(label, entry) {
  const child = fork(entry, [], {
    cwd: ROOT, execArgv: ['--allow-natives-syntax', '--max-old-space-size=4096'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, SIM_WASM: 'auto' },
  });
  let waiting = null, ready;
  const queue = [];
  const readyP = new Promise((r) => { ready = r; });
  child.on('message', (msg) => {
    if (msg && msg.ready) { ready(); return; }
    const w = waiting; waiting = null;
    if (!w) return;
    if (msg.ok === false) w.reject(new Error(`${label}: ${msg.error}`)); else w.resolve(msg);
    if (queue.length) { const q = queue.shift(); waiting = q.w; child.send(q.m); }
  });
  child.on('exit', (code) => { if (waiting) waiting.reject(new Error(`${label} exited (${code})`)); });
  const send = (m) => new Promise((resolve, reject) => {
    const w = { resolve, reject };
    if (!waiting) { waiting = w; child.send(m); } else queue.push({ w, m });
  });
  return {
    label,
    async init(m) { await readyP; return send({ cmd: 'init', ...m }); },
    send,
    close() { try { child.send({ cmd: 'exit' }); } catch { /* gone */ } setTimeout(() => child.kill('SIGKILL'), 3000).unref(); },
  };
}

/** browser: one dedicated module Worker per arm in the bench page; commands go through page.evaluate */
function browserArm(page, label) {
  const send = (m) => page.evaluate(([l, msg]) => window.__arms[l].send(msg), [label, m]).then((r) => {
    if (r.ok === false) throw new Error(`${label}: ${r.error}`);
    return r;
  });
  return {
    label,
    async init(m) { await page.evaluate((l) => window.__mkArm(l), label); return send({ cmd: 'init', ...m }); },
    send,
    close() { page.evaluate((l) => window.__arms[l]?.close(), label).catch(() => {}); },
  };
}

// ------------------------------------------------------------------------------------------------ cases
/** every arm once per round, rotated start */
async function round(arms, r, msg) {
  const out = {};
  for (let j = 0; j < arms.length; j++) {
    const a = arms[(j + r) % arms.length];
    out[a.label] = await a.send(msg);
  }
  return out;
}

async function hashes(arms, tag, log) {
  const hs = {};
  for (const a of arms) hs[a.label] = (await a.send({ cmd: 'hash' })).hash;
  const set = new Set(Object.values(hs));
  log(`  hash ${tag}: ${set.size === 1 ? 'IDENTICAL ' + [...set][0] : 'DIFFERENT ' + JSON.stringify(hs)}`);
  return { identical: set.size === 1, hashes: hs };
}

async function runReplay(arms, log) {
  const res = {};
  for (const family of ['alloc', 'union', 'report', 'finalize']) {
    const l0 = la();
    // warm-up: >= WARM_MS per arm and >= 5 calls
    const spent = Object.fromEntries(arms.map((a) => [a.label, 0]));
    const per = Object.fromEntries(arms.map((a) => [a.label, []]));
    let w = 0;
    while (w < 5 || Object.values(spent).some((v) => v < WARM_MS)) {
      const o = await round(arms, w, { cmd: 'replay', family, inner: 1 });
      for (const [k, v] of Object.entries(o)) { spent[k] += v.ms; per[k].push(v.ms); }
      if (++w > 4000) break;
    }
    // inner calls per sample: the fastest arm's sample >= 10 ms (same inner for every arm)
    const fastest = Math.min(...Object.values(per).map((xs) => median(xs.slice(-5))));
    const inner = Math.max(1, Math.ceil(10 / Math.max(fastest, 1e-3)));
    const samples = Object.fromEntries(arms.map((a) => [a.label, []]));
    const prot = new Set();
    for (let r = 0; r < REPS; r++) {
      const o = await round(arms, r, { cmd: 'replay', family, inner });
      for (const [k, v] of Object.entries(o)) { samples[k].push({ ms: v.ms }); prot.add(`${k}:${v.protector}`); }
    }
    log(`replay ${family}: warm-up ${w} rounds, ${inner} calls per sample, load ${l0.join(' ')} -> ${la().join(' ')}, protector ${[...prot].join(' ')}`);
    res[family] = { inner, loadBefore: l0, loadAfter: la(), protector: [...prot], samples, summary: summarise(`replay ${family}`, samples, ['ms'], log) };
  }
  return res;
}

async function runSim(arms, cs, log) {
  const res = {};
  for (const c of cs) {
    const l0 = la();
    const loads = [];
    const prot = new Set();
    const samples = Object.fromEntries(arms.map((a) => [a.label, []]));
    if (c === 'warm' || c === 'cold') {
      const cold = c === 'cold';
      const spent = Object.fromEntries(arms.map((a) => [a.label, 0]));
      let w = 0;
      while (w < 3 || Object.values(spent).some((v) => v < WARM_MS)) {
        const o = await round(arms, w, { cmd: 'pass', cold });
        for (const [k, v] of Object.entries(o)) spent[k] += v.s.ms;
        if (++w > 400) break;
      }
      for (let r = 0; r < REPS; r++) {
        const o = await round(arms, r, { cmd: 'pass', cold });
        for (const [k, v] of Object.entries(o)) { samples[k].push(v.s); prot.add(`${k}:${v.protector}`); }
        loads.push(Object.values(o)[0].load);
      }
      log(`${c} pass: warm-up ${w} rounds; load ${l0.join(' ')} -> ${la().join(' ')}; protector ${[...prot].join(' ')}`);
    } else if (c === 'insitu') {
      for (let w = 0; w < 2; w++) await round(arms, w, { cmd: 'days', n: CHUNK });
      for (let r = 0; r < REPS; r++) {
        const o = await round(arms, r, { cmd: 'days', n: CHUNK });
        for (const [k, v] of Object.entries(o)) { samples[k].push(v.s); prot.add(`${k}:${v.protector}`); }
        loads.push(Object.values(o)[0].load);
        if (r % 10 === 9) log(`  insitu chunk ${r + 1}/${REPS} (day ${Object.values(o)[0].s.day}): ${Object.entries(o).map(([k, v]) => `${k} ${v.s.ms.toFixed(1)} ms/day (svc ${v.s.services.toFixed(1)}, eng ${v.s.engine.toFixed(1)})`).join(' | ')}`);
      }
      log(`insitu: ${REPS} chunks of ${CHUNK} days; load ${l0.join(' ')} -> ${la().join(' ')}; protector ${[...prot].join(' ')}`);
    } else continue;
    const metrics = ['ms', 'services', 'engine', 'tier', 'access', 'prep'];
    const h = await hashes(arms, c, log);
    res[c] = { loadBefore: l0, loadAfter: la(), loads, protector: [...prot], samples, summary: summarise(c, samples, metrics, log), ...h };
    if (!h.identical) throw new Error(`${c}: the arms' cities differ`);
  }
  return res;
}

async function runGroup(mk, group, kinds, cs, init, log) {
  const arms = kinds.map((k) => mk(k));
  try {
    const infos = {};
    for (const a of arms) {
      const r = await a.init({ kind: a.label, group, ...init(a.label) });
      infos[a.label] = r.info;
      log(`init ${group}/${a.label}: ${r.initMs.toFixed(0)} ms, pop ${r.info.pop}, protector intact ${r.info.protectorIntact}` +
        (r.info.engine ? `, engine ${r.info.engine.backend} (${(r.info.engine.liveBytes / 1048576).toFixed(1)} MiB)` : '') +
        (r.info.wasmHeap ? `, wasm memory ${(r.info.wasmHeap.capacity / 1048576).toFixed(0)} MiB, grows ${r.info.wasmHeap.grows}` : ''));
    }
    const res = group === 'replay' ? await runReplay(arms, log) : await runSim(arms, cs, log);
    const end = {};
    for (const a of arms) end[a.label] = (await a.send({ cmd: 'info' })).info;
    for (const [k, v] of Object.entries(end)) {
      if (v.wasmHeap && v.wasmHeap.grows !== 0) log(`  WARNING ${k}: wasm memory grew ${v.wasmHeap.grows} times (protector invalidated)`);
      if (v.engine && (v.engine.calls?.jsCalls ?? 0) > 0) log(`  note ${k}: ${v.engine.calls.jsCalls} JS fallback calls`);
    }
    return { arms: kinds, init: infos, end, ...res };
  } finally {
    for (const a of arms) a.close();
  }
}

// ------------------------------------------------------------------------------------------------ node
async function runNode(scalar) {
  const entry = await bundle(join(ROOT, 'tools', 'bench', 'servicesTierEngine.node.ts'), join(OUT, 'servicesTierEngine.node.mjs'), 'node');
  const wasmOf = (k) => (k === 'scalar' ? scalar : k === 'orig' || k === 'fair' ? null : SIMD);
  for (const fx of fixtures) {
    const name = basename(fx).replace(/\.metropolis$/, '');
    result.node[name] = {};
    for (const prot of PROTECTORS) {
      const log = (s) => console.log(`[node ${name} ${prot}] ${s}`);
      const R = (result.node[name][prot] = {});
      const init = (k) => ({ fixture: fx, wasm: wasmOf(k), protector: prot });
      const ok = (k) => k !== 'scalar' || scalar;
      if (CASES.includes('replay')) R.replay = await runGroup((k) => nodeArm(k, entry), 'replay', REPLAY_ARMS.filter(ok), [], init, log);
      save();
      const simCases = CASES.filter((c) => c !== 'replay');
      if (simCases.length) R.sim = await runGroup((k) => nodeArm(k, entry), 'sim', SIM_ARMS.filter(ok), simCases, init, log);
      save();
    }
  }
}

// ------------------------------------------------------------------------------------------------ browser
const PAGE = `<!doctype html><meta charset="utf-8"><title>services tier engine A/B</title><script type="module">
window.__arms = {};
window.__mkArm = (label) => {
  const w = new Worker('/worker.mjs', { type: 'module' });
  let waiting = null; const q = [];
  w.onmessage = (e) => { const r = waiting; waiting = null; if (r) r(e.data); if (q.length) { const [m, rr] = q.shift(); waiting = rr; w.postMessage(m); } };
  w.onerror = (e) => { const r = waiting; waiting = null; if (r) r({ ok: false, error: 'worker error: ' + e.message }); };
  window.__arms[label] = { send: (m) => new Promise((r) => { if (!waiting) { waiting = r; w.postMessage(m); } else q.push([m, r]); }), close: () => w.terminate() };
  return true;
};
</script>`;

async function runBrowser(scalar) {
  const worker = await bundle(join(ROOT, 'tools', 'bench', 'servicesTierEngine.browser.ts'), join(OUT, 'servicesTierEngine.browser.mjs'), 'browser');
  const files = { '/': { type: 'text/html', body: PAGE }, '/worker.mjs': { type: 'text/javascript', file: worker }, '/simd.wasm': { type: 'application/wasm', file: SIMD } };
  if (scalar) files['/scalar.wasm'] = { type: 'application/wasm', file: scalar };
  fixtures.forEach((f, i) => { files[`/fixture${i}.metropolis`] = { type: 'application/octet-stream', file: f }; });
  const server = createServer((req, res) => {
    const f = files[req.url.split('?')[0]];
    if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f.type, 'cache-control': 'no-store' });
    res.end(f.body ?? readFileSync(f.file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--allow-natives-syntax --max-old-space-size=4096'] });
  try {
    const wasmOf = (k) => (k === 'scalar' ? '/scalar.wasm' : k === 'orig' || k === 'fair' ? null : '/simd.wasm');
    for (let i = 0; i < fixtures.length; i++) {
      const name = basename(fixtures[i]).replace(/\.metropolis$/, '');
      result.browser[name] = {};
      for (const prot of PROTECTORS) {
        const log = (s) => console.log(`[chromium ${name} ${prot}] ${s}`);
        const R = (result.browser[name][prot] = {});
        const init = (k) => ({ fixture: `/fixture${i}.metropolis`, wasm: wasmOf(k), protector: prot });
        const ok = (k) => k !== 'scalar' || scalar;
        const fresh = async () => {
          const page = await browser.newPage();
          page.on('console', (m) => console.log(`  [chromium console] ${m.text()}`));
          page.on('pageerror', (e) => console.log(`  [chromium pageerror] ${e.message}`));
          await page.goto(url);
          return page;
        };
        if (BROWSER_CASES.includes('replay')) {
          const page = await fresh();
          R.replay = await runGroup((k) => browserArm(page, k), 'replay', REPLAY_ARMS.filter((k) => k !== 'staged' && ok(k)), [], init, log);
          await page.close();
          save();
        }
        const simCases = BROWSER_CASES.filter((c) => c !== 'replay');
        if (simCases.length) {
          const page = await fresh();
          R.sim = await runGroup((k) => browserArm(page, k), 'sim', BROWSER_ARMS.filter(ok), simCases, init, log);
          R.userAgent = await page.evaluate(() => navigator.userAgent);
          await page.close();
          save();
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

const scalar = scalarBinary();
console.log(`# services tier engine A/B: ${mode}; fixtures ${fixtures.map((f) => basename(f)).join(', ')}; cases ${CASES.join(',')}; reps ${REPS}; protector ${PROTECTORS.join(',')}; load ${la().join(' ')}`);
if (mode === 'node' || mode === 'all') await runNode(scalar);
if (mode === 'browser' || mode === 'all') await runBrowser(scalar);
result.meta.loadEnd = la();
result.meta.finished = new Date().toISOString();
save();
if (jsonFile) console.log(`# wrote ${jsonFile}`);
