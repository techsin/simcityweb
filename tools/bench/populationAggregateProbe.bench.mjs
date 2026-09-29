#!/usr/bin/env node
/**
 * Population aggregate PROBE — "is the population cost data layout or language?" (decision probe, benchmark only).
 * Arms (tools/bench/populationAggregateProbe/core.ts): A = the 24f8609 loop as-is over Building objects; B = fair JS
 * with stable-shape objects + a def index (B0 = the def index alone on the sim's own objects); C = JS over a
 * struct-of-arrays snapshot; D = wasm (wasm/sim-kernels/src/popagg.rs) over the same SoA, resident in wasm memory
 * (Dstaged = everything copied in / out per call, Dscalar = the scalar build, DscalarBlur = SIMD build with the scalar
 * blur); E = the gather objects -> SoA; DE / CE = gather + wasm / gather + JS (buildings stay objects).
 *
 *   node tools/bench/populationAggregateProbe.bench.mjs <suite> [options]
 *
 * suites
 *   node     node micro A/B on the real fixtures: CPU time from an idle worker thread, >= 31 interleaved pairs per
 *            comparison (A:B, A:B0, A:C, C:D, A:DE, A:E, A:CE, Dstaged:D, Dscalar:D, DscalarBlur:D), each on a plain,
 *            a sample and a demo day; all arms bit-exact first (and again after timing)
 *   browser  the same arms in headless Chromium (Playwright): a Web Worker loads the fixture with the frozen sim,
 *            warms it, checks bit-exactness and runs the pairs with performance.now() (wall clock)
 *   e2e      the whole sim at 1M population, one child process per arm driven round-robin in chunks of days: the
 *            population system's CPU ms/day with its aggregate region swapped (bundle-time shell of the frozen
 *            population.ts) for B0 / B (+ stable-shape buildings) / C+E / D+E / D+E on stable shapes, vs the genuine
 *            system (also on stable shapes: Aobj) and a shell running the verbatim original (control); cities
 *            bit-identical at the end. --e2e-fixture F (repeatable; default the first fixture)
 *   capture  write the fixtures' inputs to node_modules/.cache/sim-bench/populationAggregateProbe/ (the test reads them)
 *   all      capture + node + browser + e2e
 *
 * options: --fixture F (repeatable; default dense1m_s7 + bot256_s7_y60 from --fixtures DIR / $SIM_FIXTURES / the
 *   profiler's scratch dir), --tree live|snap|DIR (default snap = the frozen 24f8609 snapshot, $SIM_SNAP), --warm N (8),
 *   --reps N (31), --kinds plain,sample,demo, --pairs A:B,C:D, --days N (e2e, 128), --chunk N (e2e, 3),
 *   --e2e-arms asis,shellOrig,B0,Aobj,B,CE,DE,DEs (e2e; --warm defaults to 12 there), --json out.json
 * The scalar binary (same Rust without +simd128) is built on demand into node_modules/.cache/sim-bench/ (skipped
 * without cargo). Needs the popagg exports in src/wasm/sim_kernels.wasm (npm run build:wasm).
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SNAP, probePlugins } from './populationAggregateProbe/plugins.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = join(ROOT, 'tools', 'bench', 'populationAggregateProbe');
const CACHE = join(ROOT, 'node_modules', '.cache', 'sim-bench', 'populationAggregateProbe');
const DEFAULT_FIXTURES = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/wasm/profile/fixtures';
mkdirSync(CACHE, { recursive: true });

const argv = process.argv.slice(2);
const suite = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'node';
const rest = argv[0] === suite ? argv.slice(1) : argv;
const opt = (k, d) => (rest.indexOf(k) >= 0 ? rest[rest.indexOf(k) + 1] : d);
const has = (k) => rest.includes(k);
const treeArg = opt('--tree', 'snap');
const tree = treeArg === 'live' ? ROOT : treeArg === 'snap' ? process.env.SIM_SNAP ?? DEFAULT_SNAP : resolve(treeArg);
const fixDir = opt('--fixtures', process.env.SIM_FIXTURES ?? DEFAULT_FIXTURES);
let fixtures = rest.flatMap((v, i) => (v === '--fixture' ? [resolve(rest[i + 1])] : []));
if (fixtures.length === 0) fixtures = ['dense1m_s7.metropolis', 'bot256_s7_y60.metropolis'].map((f) => join(fixDir, f));
for (const f of fixtures) if (!existsSync(f)) { console.error(`fixture ${f} not found (--fixture F / --fixtures DIR / SIM_FIXTURES)`); process.exit(2); }
const warm = opt('--warm', '8');
const jsonOut = opt('--json');
console.log(`# tree ${tree}${tree === ROOT ? ' (live)' : ''}; fixtures ${fixtures.map((f) => f.split('/').pop()).join(', ')}; load ${loadavg().map((v) => v.toFixed(1)).join(' ')}`);

async function bundle(entry, out, platform = 'node', shell = false) {
  const { rolldown } = await import('rolldown');
  const b = await rolldown({ input: join(HERE, entry), platform, logLevel: 'warn', plugins: probePlugins(tree, { shell }) });
  await b.write({ format: 'esm', file: out });
  await b.close();
  return out;
}

/** the scalar build of the same Rust (SIMD vs scalar comparison); null without cargo */
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

function runNode(file, args, label, heap = 8192) {
  const json = join(CACHE, `${label}.json`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [`--max-old-space-size=${heap}`, file, ...args, '--json', json], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
  console.log(`# ${label}: ${((Date.now() - t0) / 1000).toFixed(0)} s wall`);
  return existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) : null;
}

const pass = (keys) => keys.flatMap((k) => (rest.indexOf(k) >= 0 ? [k, rest[rest.indexOf(k) + 1]] : []));

async function capture() {
  const file = await bundle('node.ts', join(CACHE, 'node.mjs'));
  return runNode(file, [...fixtures.flatMap((f) => ['--fixture', f]), '--warm', warm, '--capture-dir', CACHE, '--capture-only'], 'capture');
}

async function node() {
  const file = await bundle('node.ts', join(CACHE, 'node.mjs'));
  const scalar = scalarBuild();
  return runNode(file, [...fixtures.flatMap((f) => ['--fixture', f]), '--warm', warm, ...(scalar ? ['--scalar', scalar] : []),
    ...pass(['--reps', '--kinds', '--pairs']), '--capture-dir', CACHE], 'node');
}

async function e2e() {
  const file = await bundle('e2e.ts', join(CACHE, 'e2e.mjs'), 'node', true);
  const out = [];
  const list = rest.flatMap((v, i) => (v === '--e2e-fixture' ? [resolve(rest[i + 1])] : []));
  for (const f of list.length ? list : [fixtures[0]]) {
    // (--warm / --days / --chunk only when given: e2e.ts defaults 12 / 128 / 3)
    out.push(runNode(file, ['--fixture', f, ...pass(['--warm', '--days', '--chunk', '--e2e-arms'])], `e2e.${f.split('/').pop().replace(/\.metropolis$/, '')}`, 4096));
  }
  return out;
}

async function browser() {
  const worker = await bundle('browser.ts', join(CACHE, 'browser.worker.js'), 'browser');
  const scalar = scalarBuild();
  const files = {
    '/': { type: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>population aggregate probe</title><script type="module">' +
      'const w = new Worker("/worker.js", { type: "module" }); window.__res = null;' +
      'w.onmessage = (e) => { if (e.data.log !== undefined) console.log(e.data.log); if (e.data.done) window.__res = e.data; };' +
      'w.onerror = (e) => { window.__res = { done: true, error: String(e.message || e) }; };' +
      `w.postMessage(${JSON.stringify({
        fixtures: fixtures.map((f, i) => ({ url: `/fixture/${i}`, name: f.split('/').pop().replace(/\.metropolis$/, '') })),
        simd: '/simd.wasm', scalar: scalar ? '/scalar.wasm' : null, warm: Number(warm), reps: Number(opt('--reps', 31)),
        kinds: opt('--kinds', 'plain,sample,demo').split(','), pairs: opt('--pairs', null),
      })});` +
      '</script>' },
    '/worker.js': { type: 'text/javascript', file: worker },
    '/simd.wasm': { type: 'application/wasm', file: join(ROOT, 'src', 'wasm', 'sim_kernels.wasm') },
  };
  fixtures.forEach((f, i) => { files[`/fixture/${i}`] = { type: 'application/octet-stream', file: f }; });
  if (scalar) files['/scalar.wasm'] = { type: 'application/wasm', file: scalar };
  const server = createServer((req, res) => {
    const f = files[req.url.split('?')[0]];
    if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f.type, 'cache-control': 'no-store' });
    res.end(f.body ?? readFileSync(f.file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const { chromium } = await import('playwright');
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=6144'] });
  let result;
  try {
    const page = await b.newPage();
    page.on('console', (m) => console.log(`[chromium] ${m.text()}`));
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    await page.goto(url);
    await page.waitForFunction(() => window.__res !== null, null, { timeout: 180 * 60 * 1000, polling: 2000 });
    const res = await page.evaluate(() => window.__res);
    if (res.error) throw new Error(`browser benchmark failed: ${res.error}`);
    result = { chromium: b.version(), ...res.result };
  } finally {
    await b.close();
    server.close();
  }
  writeFileSync(join(CACHE, 'browser.json'), JSON.stringify({ load: loadavg(), result }, null, 1));
  console.log(`# wrote ${join(CACHE, 'browser.json')}`);
  return result;
}

const out = { suite, tree, fixtures, loadBefore: loadavg() };
try {
  if (suite === 'capture') out.capture = await capture();
  if (suite === 'node' || suite === 'all') out.node = await node();
  if (suite === 'browser' || suite === 'all') out.browser = await browser();
  if (suite === 'e2e' || suite === 'all') out.e2e = await e2e();
} catch (e) {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
}
out.loadAfter = loadavg();
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(out, null, 1));
  console.log(`# wrote ${jsonOut}`);
}
