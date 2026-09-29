#!/usr/bin/env node
/**
 * Field-pass A/B driver (NIMBY rasters + pollution field stages): original JS (as-is) / fair JS / wasm scalar / wasm
 * SIMD, resident (arrays in wasm memory) and staged (marshalling included), in node AND headless Chromium, plus the
 * in-situ whole-sim A/B.
 *
 *   node tools/bench/fieldPasses.bench.mjs [node|browser|browser-cpu|insitu|all] [--capture NAME=FIXTURE[@water] …] [--tree DIR]
 *        [--warm 20] [--reps 31] [--cases nimby,cells,…] [--insitu-mode cycles|days] [--insitu-fixture F[@water] …]
 *        [--days 62] [--chunk 2] [--insitu-arms asis,fair,wasmRes,wasmStaged] [--blur js|wasm] [--json out.json]
 *
 *  node     bundles fieldPasses/node.ts (rolldown, the bot's execution style) and runs it: per capture (the inputs of one
 *           NIMBY rebuild + one pollution pass after --warm days, cached in node_modules/.cache/sim-bench/fieldPasses/),
 *           check every arm bit-exact, then runAB (ab.ts) per case: CPU time from an idle worker thread.
 *  browser  bundles fieldPasses/browser.ts for a module Web Worker and runs the same A/B in Playwright Chromium (headless,
 *           swiftshader) on the captures, wall clock (performance.now) in the worker; the page is served cross-origin
 *           isolated (COOP / COEP headers) so the clock has 5 µs instead of 100 µs resolution.
 *  browser-cpu
 *           the same A/B in Chromium on the page's MAIN thread (fieldPasses/browserPage.ts), driven sample by sample
 *           from here: each sample's clock is the renderer main thread's CPU time (CDP Performance.getMetrics →
 *           ThreadTime) read before and after it, so time the thread spends descheduled on a loaded machine does not
 *           count (wall clock in the worker mode inflates ~3x at load 20 on 4 cores). Warm-up, calibration (samples
 *           >= --min-sample ms of CPU, default 40), interleaved order-alternated pairs and the bootstrap CI as ab.ts.
 *  insitu   bundles fieldPasses/insitu.ts: whole sim per arm (genuine systems vs installFieldPasses + makeNimby shells),
 *           --insitu-mode cycles (back-to-back passes + rebuilds) and/or days (design cadence), arms interleaved.
 *           --blur wasm swaps the (already ported) wasm blur kernels into every arm (the post-integration baseline).
 *  --tree   the simulation sources to bundle against. Default: the frozen snapshot of commit 24f8609 (the version the
 *           kernels were ported from and the fixtures were saved with) when present, else the repository. The kernels /
 *           bindings (src/wasm/**) and the frozen originals (tests/wasm/fieldPassesOriginal.ts) always come from here.
 * Default captures: dense1m (dense1m_s7, 1.12M pop), bot256 (bot256_s7_y60, 0.65M pop), bot256w (bot256_s7_y60 with the
 * 'coast' preset's sea + river on its free cells: the fixtures have no water). The scalar binary (same Rust without
 * +simd128) is built on demand with `node tools/build-wasm.mjs --variant scalar` into node_modules/.cache/sim-bench/.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { plugins } from './fieldPasses/plugins.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'node_modules', '.cache', 'sim-bench');
const CAP_DIR = join(OUT, 'fieldPasses');
mkdirSync(CAP_DIR, { recursive: true });
const SCRATCH = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/wasm/profile';
const FIX = process.env.SIM_FIXTURES ?? join(SCRATCH, 'fixtures');
const SNAP = process.env.SIM_SNAP ?? join(SCRATCH, 'snap');

const argv = process.argv.slice(2);
const mode = ['node', 'browser', 'browser-cpu', 'insitu', 'all'].includes(argv[0]) ? argv.shift() : 'node';
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const multi = (k) => argv.flatMap((v, i) => (v === k ? [argv[i + 1]] : []));
const caps = multi('--capture');
if (caps.length === 0) {
  caps.push(`dense1m=${join(FIX, 'dense1m_s7.metropolis')}`, `bot256=${join(FIX, 'bot256_s7_y60.metropolis')}`, `bot256w=${join(FIX, 'bot256_s7_y60.metropolis')}@coast`);
}
const tree = resolve(opt('--tree', existsSync(join(SNAP, 'src', 'sim', 'infra', 'pollution.ts')) ? SNAP : ROOT));
const warm = opt('--warm', '20');
const jsonFile = opt('--json');
/** the SIMD binary (default: the shipped one) */
const SIMD = resolve(opt('--simd', join(ROOT, 'src', 'wasm', 'sim_kernels.wasm')));
/** in-situ blur: 'js' (the live code as it is) or 'wasm' (the adopted wasm blur kernels in every arm) */
const BLUR = opt('--blur', 'js');
const result = { mode, caps, tree };

// the kernels are ports of 24f8609: say so when the tree's originals differ from the snapshot's (the as-is arms and the
// overrides would then run different algorithms)
const sha = (f) => (existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : 'missing');
for (const f of ['src/sim/infra/nimby.ts', 'src/sim/infra/pollution.ts']) {
  const file = join(tree, f), snap = join(SNAP, f);
  if (existsSync(snap) && sha(file) !== sha(snap)) console.log(`# WARNING: ${file} is not the 24f8609 version the kernels were ported from (pass --tree ${SNAP})`);
}
console.log(`# tree ${tree}${tree === ROOT ? ' (live)' : ''}`);

async function bundle(entry, file, platform) {
  const { rolldown } = await import('rolldown');
  const b = await rolldown({ input: entry, platform, logLevel: 'warn', plugins: plugins(tree, { blur: platform === 'node' && entry.endsWith('insitu.ts') ? BLUR : 'js' }) });
  await b.write({ format: 'esm', file });
  await b.close();
  return file;
}

function scalarBinary() {
  const file = join(OUT, 'sim_kernels.scalar.wasm');
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-wasm.mjs'), '--variant', 'scalar', '--out', OUT], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    console.log(`# scalar build unavailable (${(r.stderr || r.stdout || '').trim().split('\n').pop()}): SIMD only`);
    return null;
  }
  return existsSync(file) ? file : null;
}

const capName = (c) => `${c.split('=')[0]}.w${warm}.cap`;

async function runNode(scalar, captureOnly = false) {
  const file = await bundle(join(ROOT, 'tools', 'bench', 'fieldPasses', 'node.ts'), join(OUT, 'fieldPasses.node.mjs'), 'node');
  const json = join(OUT, 'fieldPasses.node.json');
  const args = ['--max-old-space-size=8192', file, ...caps.flatMap((c) => ['--capture', c]), '--cap-dir', CAP_DIR, '--warm', warm, '--json', json];
  if (opt('--reps')) args.push('--reps', opt('--reps'));
  if (opt('--cases')) args.push('--cases', opt('--cases'));
  if (opt('--pairs')) args.push('--pairs', opt('--pairs'));
  if (captureOnly) args.push('--cases', 'soil', '--reps', '1');
  if (scalar) args.push('--scalar', scalar);
  args.push('--simd', SIMD);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) throw new Error(`node benchmark failed (${r.status})`);
  if (!captureOnly) result.node = JSON.parse(readFileSync(json, 'utf8'));
}

async function runInsitu() {
  const file = await bundle(join(ROOT, 'tools', 'bench', 'fieldPasses', 'insitu.ts'), join(OUT, 'fieldPasses.insitu.mjs'), 'node');
  result.insitu = [];
  const list = multi('--insitu-fixture');
  const fixtures = list.length ? list : [join(FIX, 'dense1m_s7.metropolis'), join(FIX, 'bot256_s7_y60.metropolis')];
  const modes = (opt('--insitu-mode', 'cycles,days')).split(',');
  for (const f of fixtures) {
    for (const m of modes) {
      const [fixture, water = ''] = f.split('@');
      const json = join(OUT, 'fieldPasses.insitu.json');
      const args = ['--max-old-space-size=12288', file, '--fixture', resolve(fixture), '--mode', m, '--warm', warm, '--json', json,
        '--reps', opt('--reps', '31'), '--days', opt('--days', '62'), '--chunk', opt('--chunk', '2'), '--simd', SIMD];
      if (water) args.push('--water', water);
      if (opt('--insitu-arms')) args.push('--arms', opt('--insitu-arms'));
      const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ROOT });
      if (r.status !== 0) throw new Error(`in-situ benchmark failed (${r.status})`);
      result.insitu.push(JSON.parse(readFileSync(json, 'utf8')));
    }
  }
}

async function runBrowser(scalar) {
  const missing = caps.filter((c) => !existsSync(join(CAP_DIR, capName(c))));
  if (missing.length) await runNode(null, true);
  const worker = await bundle(join(ROOT, 'tools', 'bench', 'fieldPasses', 'browser.ts'), join(OUT, 'fieldPasses.browser.mjs'), 'browser');
  const names = caps.map(capName);
  const files = {
    '/': { type: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>field pass A/B</title><script type="module">' +
      'const w = new Worker("/worker.mjs", { type: "module" }); window.__res = null;' +
      'w.onmessage = (e) => { if (e.data.log !== undefined) console.log(e.data.log); if (e.data.done) window.__res = e.data; };' +
      'w.onerror = (e) => { window.__res = { done: true, error: String(e.message || e) }; };' +
      `w.postMessage(${JSON.stringify({ caps: names.map((c) => '/cap/' + c), simd: '/simd.wasm', scalar: scalar ? '/scalar.wasm' : null, reps: Number(opt('--reps', 31)), cases: opt('--cases')?.split(',') })});` +
      '</script>' },
    '/worker.mjs': { type: 'text/javascript', file: worker },
    '/simd.wasm': { type: 'application/wasm', file: SIMD },
  };
  for (const c of names) files['/cap/' + c] = { type: 'application/octet-stream', file: join(CAP_DIR, c) };
  if (scalar) files['/scalar.wasm'] = { type: 'application/wasm', file: scalar };
  const server = createServer((req, res) => {
    const f = files[req.url.split('?')[0]];
    if (!f) { res.writeHead(404); res.end(); return; }
    // cross-origin isolation (COOP + COEP): the worker's performance.now() then ticks in 5 µs steps instead of 100 µs
    res.writeHead(200, {
      'content-type': f.type, 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp',
    });
    res.end(f.body ?? readFileSync(f.file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=4096'] });
  try {
    const page = await browser.newPage();
    page.on('console', (m) => console.log(`[chromium] ${m.text()}`));
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    await page.goto(url);
    await page.waitForFunction(() => window.__res !== null, null, { timeout: 180 * 60 * 1000, polling: 1000 });
    const res = await page.evaluate(() => window.__res);
    if (res.error) throw new Error(`browser benchmark failed: ${res.error}`);
    result.browser = { chromium: browser.version(), ...res.result };
  } finally {
    await browser.close();
    server.close();
  }
}

/** serve `files` ({ path: { type, body | file } }) on 127.0.0.1, cross-origin isolated (COOP + COEP) */
async function serve(files) {
  const server = createServer((req, res) => {
    const f = files[req.url.split('?')[0]];
    if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      'content-type': f.type, 'cache-control': 'no-store', 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp',
    });
    res.end(f.body ?? readFileSync(f.file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

/** ab.ts statistics for externally timed samples (per-call ms of A / B per pair) */
function abStats(name, aLabel, bLabel, A, B, inner, clock) {
  const median = (xs) => { const s = xs.slice().sort((p, q) => p - q); const n = s.length; return n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };
  const R = A.map((a, i) => B[i] / Math.max(a, 1e-9));
  let st = 12345;
  const rnd = () => { st ^= st << 13; st >>>= 0; st ^= st >>> 17; st ^= st << 5; st >>>= 0; return st / 4294967296; };
  const meds = [];
  const buf = new Array(R.length);
  for (let k = 0; k < 2000; k++) { for (let i = 0; i < R.length; i++) buf[i] = R[(rnd() * R.length) | 0]; meds.push(median(buf)); }
  meds.sort((p, q) => p - q);
  const lo = meds[50], hi = meds[1950], rm = median(R);
  const side = (label, xs) => ({ label, median: median(xs), min: Math.min(...xs), mean: xs.reduce((p, q) => p + q, 0) / xs.length });
  return { name, clock, reps: A.length, inner, a: side(aLabel, A), b: side(bLabel, B), ratio: { median: rm, lo, hi }, speedup: { median: 1 / rm, lo: 1 / hi, hi: 1 / lo } };
}
const fmtMs = (ms) => (ms >= 1 ? ms.toFixed(3) + ' ms' : (ms * 1000).toFixed(1) + ' µs');

async function runBrowserCpu(scalar) {
  const missing = caps.filter((c) => !existsSync(join(CAP_DIR, capName(c))));
  if (missing.length) await runNode(null, true);
  const pageJs = await bundle(join(ROOT, 'tools', 'bench', 'fieldPasses', 'browserPage.ts'), join(OUT, 'fieldPasses.page.mjs'), 'browser');
  const names = caps.map(capName);
  const files = {
    '/': { type: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>field pass A/B (cpu)</title><script type="module" src="/page.mjs"></script>' },
    '/page.mjs': { type: 'text/javascript', file: pageJs },
    '/simd.wasm': { type: 'application/wasm', file: SIMD },
  };
  for (const c of names) files['/cap/' + c] = { type: 'application/octet-stream', file: join(CAP_DIR, c) };
  if (scalar) files['/scalar.wasm'] = { type: 'application/wasm', file: scalar };
  const { server, url } = await serve(files);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=4096'] });
  const reps = Number(opt('--reps', 31)), minSampleMs = Number(opt('--min-sample', 40)), warmupMs = 600;
  const cases = opt('--cases')?.split(',') ?? ['nimby', 'nimbyNoCache', 'cells', 'airSat', 'noiseSat', 'water', 'soil', 'pass'];
  const clock = 'cpu (Chromium renderer main thread: CDP Performance.getMetrics ThreadTime)';
  try {
    const page = await browser.newPage();
    page.on('console', (m) => console.log(`[chromium] ${m.text()}`));
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    await page.goto(url);
    await page.waitForFunction(() => !!globalThis.__fp, null, { timeout: 120000 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable', { timeDomain: 'threadTicks' });
    const threadMs = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'ThreadTime').value * 1000;
    const out = { chromium: browser.version(), userAgent: await page.evaluate(() => navigator.userAgent), clock, reps, minSampleMs, warmupMs };
    console.log(`# Chromium ${out.chromium}, main thread, ${clock}; samples >= ${minSampleMs} ms CPU, ${reps} interleaved pairs; load ${loadavg().map((v) => v.toFixed(1)).join(' ')}`);
    for (const c of names) {
      const { meta, arms } = await page.evaluate(([u, s, sc]) => globalThis.__fp.load(u, s, sc), ['/cap/' + c, '/simd.wasm', scalar ? '/scalar.wasm' : null]);
      const labels = await page.evaluate(() => globalThis.__fp.check());
      console.log(`\n## ${meta.name}: N ${meta.N}, population ${meta.population}\nbit-exact on the page (Chromium): ${labels}`);
      const pairs = [
        ['as-is vs fair JS', 'orig', 'fair'], ['fair JS vs wasm SIMD resident', 'fair', 'simdRes'], ['fair JS vs wasm SIMD staged', 'fair', 'simdStaged'],
        ['as-is vs wasm SIMD resident', 'orig', 'simdRes'], ['wasm scalar vs SIMD build (resident)', 'scalarRes', 'simdRes'],
      ].filter(([, a, b]) => arms[a] && arms[b]);
      const results = {};
      for (const kind of cases) {
        results[kind] = [];
        for (const [label, a, b] of pairs) {
          // the original never caches the corridor raster: nimbyNoCache is its only NIMBY case
          const ka = a === 'orig' && kind === 'nimbyNoCache' ? 'nimby' : kind, kb = b === 'orig' && kind === 'nimbyNoCache' ? 'nimby' : kind;
          // warm-up (alternating, >= warmupMs wall per side) and calibration from its CPU time
          const w0 = await threadMs();
          const wu = await page.evaluate(([x, y, kx, ky, ms]) => globalThis.__fp.warm(x, y, kx, ky, ms), [a, b, ka, kb, warmupMs]);
          const cpu = (await threadMs()) - w0;
          const per = (cpu / wu.calls) * (Math.max(wu.wa, wu.wb) / Math.max(1e-9, wu.wa + wu.wb));
          const inner = Math.max(1, Math.ceil(minSampleMs / Math.max(per, 1e-6)));
          // one CDP read between consecutive samples (it ends one and starts the next: 2 round trips per sample; the
          // constant per-sample overhead of the evaluate / getMetrics handling lands in A and B samples alike)
          let tPrev = await threadMs();
          const sample = async (arm, k) => {
            await page.evaluate(([x, y, n]) => globalThis.__fp.run(x, y, n), [arm, k, inner]);
            const t = await threadMs();
            const d = (t - tPrev) / inner;
            tPrev = t;
            return d;
          };
          const A = [], B = [];
          for (let r = 0; r < reps; r++) {
            if (r % 2 === 0) { A.push(await sample(a, ka)); B.push(await sample(b, kb)); } else { B.push(await sample(b, kb)); A.push(await sample(a, ka)); }
          }
          const res = abStats(`${kind} ${label}`, arms[a], arms[b], A, B, inner, clock);
          results[kind].push(res);
          console.log(`${res.name.padEnd(46)} ${res.a.label}: ${fmtMs(res.a.median).padStart(10)} (min ${fmtMs(res.a.min).padStart(9)})  ${res.b.label}: ` +
            `${fmtMs(res.b.median).padStart(10)} (min ${fmtMs(res.b.min).padStart(9)})  speedup ${res.speedup.median.toFixed(2)}x [${res.speedup.lo.toFixed(2)}, ` +
            `${res.speedup.hi.toFixed(2)}]  (x${inner}, n=${reps}, cpu)  load ${loadavg()[0].toFixed(1)}`);
        }
      }
      out[meta.name] = { meta, results };
      await page.evaluate(() => globalThis.__fp.dispose());
    }
    result.browserCpu = out;
  } finally {
    await browser.close();
    server.close();
  }
}

const scalar = mode === 'insitu' ? null : (opt('--scalar') ?? scalarBinary());
if (mode === 'node' || mode === 'all') await runNode(scalar);
if (mode === 'browser' || mode === 'all') await runBrowser(scalar);
if (mode === 'browser-cpu' || mode === 'all') await runBrowserCpu(scalar);
if (mode === 'insitu' || mode === 'all') await runInsitu();
if (jsonFile) {
  writeFileSync(jsonFile, JSON.stringify(result, null, 1));
  console.log(`# wrote ${jsonFile}`);
}
