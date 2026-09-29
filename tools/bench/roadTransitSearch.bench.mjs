#!/usr/bin/env node
/**
 * roadTransitSearch benchmarks: original JS (src/sim/infra/search.ts) vs fair optimised JS (src/wasm/js/
 * roadTransitSearch.ts) vs WASM (wasm/sim-kernels/src/search.rs through src/wasm/kernels/searchBind.ts; SIMD build =
 * the shipped binary, scalar build = same Rust without simd128), marshalling included where the design has it.
 *
 *   node tools/bench/roadTransitSearch.bench.mjs <suite> [--tree live|snap|DIR] [--fixture dense1m|stress1m|stress256]
 *        [--fixtures DIR] [--reps N] [--quick] [--json out.json] [suite options]
 *
 * suites
 *   capture  record every search.ts call of 2 traffic cycles on the fixture (runCycleSync) -> a capture file
 *   replay   (a)+(b) replay a capture: per call kind (round / inbound / shop / freight searches, transit, accumulate)
 *            and whole cycles, interleaved CPU-time A/B: js vs wasm, js vs fair-js, fair-js vs wasm, js vs wasm copy
 *            mode, wasm scalar vs wasm SIMD; every implementation verified bit-identical in lockstep first
 *   insitu   (c) two Simulations, TrafficSystem.runCycleSync interleaved >= 31 pairs, search.ts swapped by the plugin
 *   e2e      whole headless sim, interleaved chunks of days: ms/day total / traffic task / inside search.ts; then the
 *            JS-vs-JS baseline and the JS-vs-wasm identity check of the saved cities (default 120 days).
 *            --secondary also swaps in the catchments (services) and emergency searches (insitu / e2e)
 *   secondary  the catchments (roadTimeMulti / roadDistMulti) and emergency (ChunkedSearch / DispatchSearch) kernels on
 *            the fixture's real inputs: js vs wasm, verified bit-identical first
 *   browser  headless Chromium (Playwright): replay the capture on the main thread and in a Web Worker (wall clock)
 *   all      capture + replay + insitu + secondary + e2e + browser
 *
 * --tree: the simulation sources the benchmark runs on. `live` = this repo; `snap` = a frozen tree ($SIM_SNAP; default
 * the profiler's snapshot of commit 24f8609, the version the kernels were ported from and the 1M fixtures were saved
 * with), so concurrent edits of the live sim cannot disturb a measurement. The wasm bindings always come from this repo.
 * Bundles and captures go to node_modules/.cache/sim-bench/roadTransitSearch/. Measurement protocol: tools/bench/ab.ts
 * (warm-up >= 600 ms per side, >= 31 interleaved order-alternated pairs, CPU time from an idle worker thread,
 * median / min, 95% bootstrap CI of the paired ratio, load average reported).
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchPlugins } from './roadTransitSearch/plugins.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = join(ROOT, 'tools', 'bench', 'roadTransitSearch');
const CACHE = join(ROOT, 'node_modules', '.cache', 'sim-bench', 'roadTransitSearch');
const DEFAULT_SNAP = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/wasm/profile/snap';
mkdirSync(CACHE, { recursive: true });

const argv = process.argv.slice(2);
const suite = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'all';
const rest = argv[0] === suite ? argv.slice(1) : argv;
const opt = (k, d) => (rest.indexOf(k) >= 0 ? rest[rest.indexOf(k) + 1] : d);
const has = (k) => rest.includes(k);
const treeArg = opt('--tree', 'live');
const tree = treeArg === 'live' ? ROOT : treeArg === 'snap' ? process.env.SIM_SNAP ?? DEFAULT_SNAP : resolve(treeArg);
const treeTag = treeArg === 'live' ? 'live' : treeArg === 'snap' ? 'snap' : 'tree';
const fixture = opt('--fixture', 'dense1m');
const jsonOut = opt('--json');
if (!existsSync(join(tree, 'src', 'sim', 'infra', 'search.ts'))) {
  console.error(`no simulation tree at ${tree}`);
  process.exit(1);
}
const { rolldown } = await import('rolldown');

/** bundle a TS entry of tools/bench/roadTransitSearch with the plugins for `mode`; returns the output path */
async function bundle(entry, mode, platform = 'node') {
  const out = join(CACHE, `${entry.replace(/\.ts$/, '')}.${treeTag}.${mode}${has('--secondary') ? '2' : ''}.${platform === 'node' ? 'mjs' : 'js'}`);
  const b = await rolldown({
    input: join(HERE, entry), platform, logLevel: 'silent', plugins: searchPlugins({ tree, mode, secondary: has('--secondary') }),
    // vite (secondary.ts compiles the private DispatchSearch class with transformWithOxc) stays a runtime import
    external: platform === 'node' ? ['vite'] : [],
  });
  await b.write({ format: 'esm', file: out });
  await b.close();
  return out;
}

/** run a bundled node entry (cwd = repo root: the wasm loader finds src/wasm/sim_kernels.wasm), with --json capture */
function runNode(file, args, label) {
  const json = join(CACHE, `${label}${has('--secondary') ? '2' : ''}.${treeTag}.${fixture}.json`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--max-old-space-size=8192', file, ...args, '--json', json], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
  console.log(`# ${label}: ${((Date.now() - t0) / 1000).toFixed(0)} s wall`);
  return existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) : null;
}

function capturePath() {
  return opt('--capture') ?? join(CACHE, `${fixture}.${treeTag}.capture`);
}

async function capture() {
  const file = await bundle('capture.ts', 'capture');
  const out = capturePath();
  const r = spawnSync(process.execPath, ['--max-old-space-size=8192', file, '--fixture', fixture, ...pass(['--fixtures', '--cycles']), '--out', out], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) throw new Error('capture failed');
  return out;
}

/** options passed through to the child */
function pass(keys) {
  const out = [];
  for (const k of keys) if (rest.indexOf(k) >= 0) out.push(k, rest[rest.indexOf(k) + 1]);
  return out;
}

/** the scalar build of the same Rust (for the SIMD vs scalar comparison); null without cargo */
function scalarBuild() {
  const f = join(CACHE, 'sim_kernels.scalar.wasm');
  const manifest = JSON.parse(readFileSync(join(ROOT, 'src', 'wasm', 'sim_kernels.manifest.json'), 'utf8'));
  const stamp = join(CACHE, 'sim_kernels.scalar.source');
  if (existsSync(f) && existsSync(stamp) && readFileSync(stamp, 'utf8') === manifest.sourceHash) return f;
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-wasm.mjs'), '--variant', 'scalar', '--out', CACHE], { encoding: 'utf8', cwd: ROOT });
  if (r.status !== 0 || !existsSync(f)) {
    console.log('# no scalar build (cargo missing?): the SIMD vs scalar comparison is skipped');
    return null;
  }
  writeFileSync(stamp, manifest.sourceHash);
  return f;
}

async function replay() {
  const cap = capturePath();
  if (!existsSync(cap)) await capture();
  const file = await bundle('replayNode.ts', 'none');
  const scalar = scalarBuild();
  return runNode(file, ['--capture', cap, ...(scalar ? ['--scalar', scalar] : []), ...pass(['--reps', '--warmup']), ...(has('--quick') ? ['--quick'] : [])], 'replay');
}

async function insitu() {
  const file = await bundle('insitu.ts', 'swap');
  return runNode(file, ['--fixture', fixture, ...pass(['--fixtures', '--pairs', '--warm'])], 'insitu');
}

async function secondary() {
  const file = await bundle('secondary.ts', 'none');
  process.env.RTS_EMERGENCY_TS = join(tree, 'src', 'sim', 'infra', 'emergency.ts');
  return runNode(file, ['--fixture', fixture, ...pass(['--fixtures', '--reps', '--warmup', '--days'])], 'secondary');
}

async function e2e() {
  const file = await bundle('e2e.ts', 'swap');
  return runNode(file, ['--fixture', fixture, ...pass(['--fixtures', '--days', '--chunk', '--warm']), ...(has('--no-baseline') ? ['--no-baseline'] : [])], 'e2e');
}

/** headless Chromium: the capture replayed on the main thread and in a worker, wall clock (browsers have no CPU clock) */
async function browser() {
  const cap = capturePath();
  if (!existsSync(cap)) await capture();
  const page = await bundle('browserPage.ts', 'none', 'browser');
  const worker = await bundle('browserWorker.ts', 'none', 'browser');
  const scalar = scalarBuild();
  const files = {
    '/index.html': { body: `<!doctype html><meta charset="utf-8"><title>roadTransitSearch A/B</title><script type="module" src="/page.js"></script>`, type: 'text/html' },
    '/page.js': { file: page, type: 'text/javascript' },
    '/worker.js': { file: worker, type: 'text/javascript' },
    '/sim_kernels.wasm': { file: join(ROOT, 'src', 'wasm', 'sim_kernels.wasm'), type: 'application/wasm' },
    '/scalar.wasm': scalar ? { file: scalar, type: 'application/wasm' } : null,
    '/capture.bin': { file: cap, type: 'application/octet-stream' },
  };
  const server = createServer((req, res) => {
    const f = files[req.url.split('?')[0]];
    if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f.type, 'cache-control': 'no-store' });
    res.end(f.body ?? readFileSync(f.file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/index.html?reps=${opt('--reps', has('--quick') ? '11' : '31')}&scalar=${scalar ? 1 : 0}&warmup=${opt('--warmup', '600')}`;
  const { chromium } = await import('playwright');
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let result;
  try {
    const p = await b.newPage();
    p.on('console', (m) => console.log(`[browser] ${m.text()}`));
    p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    await p.goto(url);
    await p.waitForFunction(() => window.__rts?.done === true, null, { timeout: 60 * 60 * 1000, polling: 1000 });
    result = await p.evaluate(() => window.__rts);
    result.userAgent = await p.evaluate(() => navigator.userAgent);
  } finally {
    await b.close();
    server.close();
  }
  if (result.error) throw new Error(`browser: ${result.error}`);
  const json = join(CACHE, `browser.${treeTag}.${fixture}.json`);
  writeFileSync(json, JSON.stringify({ load: loadavg(), result }, null, 1));
  console.log(`# wrote ${json}`);
  return result;
}

const out = { suite, tree, fixture, loadBefore: loadavg() };
try {
  if (suite === 'capture' || suite === 'all') out.capture = await capture();
  if (suite === 'replay' || suite === 'all') out.replay = await replay();
  if (suite === 'insitu' || suite === 'all') out.insitu = await insitu();
  if (suite === 'secondary' || suite === 'all') out.secondary = await secondary();
  if (suite === 'e2e' || suite === 'all') out.e2e = await e2e();
  if (suite === 'browser' || suite === 'all') out.browser = await browser();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
out.loadAfter = loadavg();
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(out, null, 1));
  console.log(`# wrote ${jsonOut}`);
}
void extname;
