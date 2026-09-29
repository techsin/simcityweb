#!/usr/bin/env node
/**
 * trafficCore benchmarks and checks: original JS (the tree's traffic.ts) vs the fair optimised-JS core
 * (src/wasm/js/trafficCore.ts) vs the wasm core (wasm/sim-kernels/src/traffic.rs via src/wasm/kernels/trafficBind.ts;
 * SIMD = the shipped binary, scalar = the same Rust without simd128, imp = exp / log imported from JS).
 *
 *   node tools/bench/trafficCore.bench.mjs <suite> [--tree snap|live|DIR] [--fixture dense1m|bot256|stress1m|stress256]
 *        [--fixtures DIR] [--json out.json] [suite options]
 *
 * suites
 *   verify   step-by-step equivalence (orig vs fair vs wasm after every traffic step), --cycles N
 *   (more suites: see the usage printed without arguments)
 *
 * --tree: the simulation sources the benchmark runs on: `snap` (default) = the frozen tree of commit 24f8609 ($SIM_SNAP,
 * default the profiler's snapshot; the version traffic.rs was ported from and the 1M fixtures were saved with), `live`
 * = this repo (only meaningful once src/sim/infra/traffic.ts is back at the 24f8609 phase structure), or a directory.
 * Bundles go to node_modules/.cache/sim-bench/trafficCore/. Protocol: tools/bench/ab.ts (warm-up, >= 31 interleaved
 * order-alternated pairs, CPU time from an idle worker thread, median / min, 95% bootstrap CI, load average).
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { loadavg } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { treePlugins } from './trafficCore/plugins.mjs';
import { searchPlugins } from './roadTransitSearch/plugins.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = join(ROOT, 'tools', 'bench', 'trafficCore');
const CACHE = join(ROOT, 'node_modules', '.cache', 'sim-bench', 'trafficCore');
export const DEFAULT_SNAP = '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/wasm/profile/snap';
mkdirSync(CACHE, { recursive: true });

const argv = process.argv.slice(2);
const suite = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
const rest = argv[0] === suite ? argv.slice(1) : argv;
const opt = (k, d) => (rest.indexOf(k) >= 0 ? rest[rest.indexOf(k) + 1] : d);
const treeArg = opt('--tree', 'snap');
const tree = treeArg === 'live' ? ROOT : treeArg === 'snap' ? process.env.SIM_SNAP ?? DEFAULT_SNAP : resolve(treeArg);
const treeTag = treeArg === 'live' ? 'live' : treeArg === 'snap' ? 'snap' : 'tree';

export async function bundle(entry, platform = 'node') {
  const { rolldown } = await import('rolldown');
  const out = join(CACHE, `${entry.replace(/\.ts$/, '')}.${treeTag}.${platform === 'node' ? 'mjs' : 'js'}`);
  // + the search porter's 'swap' plugin: the tree's search.ts dispatches per call on globalThis.__searchMode ('js' =
  // the original, 'wasm' = src/wasm/kernels/searchBind.ts), for the 'orig-ws' arm (original traffic.ts on the wasm
  // searches: the baseline once the search port is adopted); everything else runs with 'js'
  // (node only: the swap module times its calls with process.cpuUsage)
  const plugins = [...treePlugins({ tree }), ...(platform === 'node' ? searchPlugins({ tree, mode: 'swap' }).filter((p) => p.name !== 'rts-tree-redirect') : [])];
  const b = await rolldown({ input: join(HERE, entry), platform, logLevel: 'silent', plugins, external: platform === 'node' ? ['vite'] : [] });
  await b.write({ format: 'esm', file: out });
  await b.close();
  return out;
}

export function runNode(file, args, label, env = {}) {
  const json = opt('--json') ?? join(CACHE, `${label}.${treeTag}.${opt('--fixture', 'default')}.json`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--max-old-space-size=8192', file, ...args, '--json', json], { stdio: 'inherit', cwd: ROOT, env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
  console.log(`# ${label}: ${((Date.now() - t0) / 1000).toFixed(0)} s wall -> ${json}`);
  return existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) : null;
}

/**
 * headless Chromium (Playwright): the in-situ cycle A/B on the main thread and in a Worker.
 * Default (isolated): one browser context = renderer process = V8 isolate per arm (browserArm.ts, coordinated from
 * node by browserIso.ts), CPU time of each arm's renderer (/proc schedstat of its threads) + wall time in the page.
 * --shared: the earlier protocol (all arms in one page / one Worker, wall clock only; browserPage.ts).
 */
async function browser() {
  const fixture = opt('--fixture', 'dense1m');
  const dir = opt('--fixtures', process.env.SIM_FIXTURES ?? '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/wasm/profile/fixtures');
  const fx = { dense1m: 'dense1m_s7.metropolis', bot256: 'bot256_s7_y60.metropolis', stress1m: 'stress1m_testdefs_s7.metropolis' }[fixture] ?? fixture;
  const fixtureFile = fx.includes('/') ? fx : join(dir, fx);
  const shared = rest.includes('--shared');
  const { extraBinaries } = await import('./trafficCore/binaries.mjs');
  const bins = await extraBinaries(CACHE);
  const files = {
    '/sim_kernels.wasm': { file: join(ROOT, 'src', 'wasm', 'sim_kernels.wasm'), type: 'application/wasm' },
    '/scalar.wasm': bins.scalar ? { file: bins.scalar, type: 'application/wasm' } : null,
    '/fixture.metropolis': { file: fixtureFile, type: 'application/octet-stream' },
  };
  if (shared) {
    files['/index.html'] = { body: '<!doctype html><meta charset="utf-8"><title>trafficCore A/B</title><script type="module" src="/page.js"></script>', type: 'text/html' };
    files['/page.js'] = { file: await bundle('browserPage.ts', 'browser'), type: 'text/javascript' };
    files['/worker.js'] = { file: await bundle('browserWorker.ts', 'browser'), type: 'text/javascript' };
  } else {
    files['/arm.html'] = { body: '<!doctype html><meta charset="utf-8"><title>trafficCore arm</title><script type="module" src="/arm.js"></script>', type: 'text/html' };
    files['/arm.js'] = { file: await bundle('browserArm.ts', 'browser'), type: 'text/javascript' };
    files['/armworker.js'] = { file: await bundle('browserArmWorker.ts', 'browser'), type: 'text/javascript' };
  }
  const server = createServer((req, res) => {
    const f = files[req.url.split('?')[0]];
    if (!f) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f.type, 'cache-control': 'no-store' });
    res.end(f.body ?? readFileSync(f.file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = await import('playwright');
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=6144'] });
  let result;
  const load0 = loadavg();
  try {
    if (shared) {
      const q = `fixture=${fixture}&testdefs=${fixtureFile.includes('testdefs') ? 1 : 0}&pairs=${opt('--pairs', '31')}&warm=${opt('--warm', '2')}&resident=${rest.includes('--resident') ? 1 : 0}&main=${rest.includes('--worker-only') ? 0 : 1}`;
      const p = await b.newPage();
      p.on('console', (m) => console.log(`[browser] ${m.text()}`));
      p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
      await p.goto(`${base}/index.html?${q}`);
      await p.waitForFunction(() => window.__tc?.done === true, null, { timeout: 3 * 60 * 60 * 1000, polling: 2000 });
      result = await p.evaluate(() => window.__tc);
      if (result.error) throw new Error(`browser: ${result.error}`);
    } else {
      const { runIsolatedBrowser } = await import(pathToFileURL(await bundle('browserIso.ts')).href);
      const kinds = opt('--arms', `orig,orig2,fair,wasm${bins.scalar ? ',wasm-scalar' : ''}`).split(',');
      const where = rest.includes('--worker-only') ? ['worker'] : rest.includes('--main-only') ? ['main'] : ['main', 'worker'];
      result = await runIsolatedBrowser(b, {
        base, testdefs: fixtureFile.includes('testdefs'), pairs: Number(opt('--pairs', '31')), warm: Number(opt('--warm', '3')),
        resident: rest.includes('--resident'), kinds, where, settle: Number(opt('--settle', '50')), timeoutMs: Number(opt('--cycle-timeout', '600000')),
      }, (s) => console.log(s));
      result.protocol = 'isolated: one browser context (renderer process, V8 isolate) per arm; CPU = renderer threads schedstat';
    }
    result.userAgent = b.version();
  } finally {
    await b.close();
    server.close();
  }
  const json = opt('--json') ?? join(CACHE, `browser.${treeTag}.${fixture}.json`);
  writeFileSync(json, JSON.stringify({ load: [load0, loadavg()], result }, null, 1));
  console.log(`# Chromium ${result.userAgent}; load ${load0.map((v) => v.toFixed(1)).join(' ')} -> ${loadavg().map((v) => v.toFixed(1)).join(' ')}; wrote ${json}`);
  return result;
}

const passArgs = rest.filter((a, i) => a !== '--tree' && rest[i - 1] !== '--tree' && a !== '--json' && rest[i - 1] !== '--json');

async function main() {
  if (!existsSync(join(tree, 'src', 'sim', 'infra', 'traffic.ts'))) throw new Error(`no simulation tree at ${tree} (set SIM_SNAP)`);
  switch (suite) {
    case 'verify': return runNode(await bundle('verify.ts'), passArgs, 'verify');
    case 'micro': {
      const { extraBinaries } = await import('./trafficCore/binaries.mjs');
      const bins = await extraBinaries(CACHE);
      const extra = [...(bins.scalar ? ['--scalar', bins.scalar] : []), ...(bins.imp ? ['--imp', bins.imp] : [])];
      return runNode(await bundle('micro.ts'), [...passArgs, ...extra], 'micro');
    }
    case 'math': return runNode(await bundle('math.ts'), passArgs, 'math');
    case 'e2e': {
      const worker = rest.includes('--in-process') ? [] : ['--worker', await bundle('armWorker.ts')];
      return runNode(await bundle('e2e.ts'), [...passArgs, ...worker], rest.includes('--flush') ? 'e2e-flush' : 'e2e');
    }
    case 'browser': return browser();
    case 'insitu': {
      const { extraBinaries } = await import('./trafficCore/binaries.mjs');
      const bins = await extraBinaries(CACHE);
      const extra = [...(bins.scalar ? ['--scalar', bins.scalar] : []), ...(bins.imp ? ['--imp', bins.imp] : [])];
      // one V8 isolate (worker thread) per arm unless --in-process (see insitu.ts)
      const worker = rest.includes('--in-process') ? [] : ['--worker', await bundle('armWorker.ts')];
      return runNode(await bundle('insitu.ts'), [...passArgs, ...extra, ...worker], 'insitu');
    }
    default:
      console.log([
        'usage: node tools/bench/trafficCore.bench.mjs <suite> [--tree snap|live|DIR] [--fixture dense1m|bot256|stress1m|stress256] [--fixtures DIR] [--json FILE]',
        '  verify   [--cycles N]                      step-by-step equivalence orig / fair / wasm after every traffic step',
        '  insitu   [--pairs 31] [--warm 3] [--arms orig,orig2,orig-ws,fair,wasm,wasm-scalar,wasm-imp] [--resident] [--in-process]',
        '                                             traffic cycle A/B (runCycleSync), one isolate per arm, per-phase CPU',
        '  micro    [--reps 31]                       sort (native / JS radix / wasm radix), logit, roundMatch kernel, SIMD vs scalar',
        '  math     [--random 100000000]              exp / log bit test vs V8 (fixture arguments + random)',
        '  e2e      [--days 120] [--chunk 4] [--flush] [--arms orig,orig2,orig-ws,wasm] [--resident]',
        '                                             whole simulation ms/day with the core swapped in (+ identity after the run)',
        '  browser  [--pairs 31] [--warm 3] [--resident] [--arms orig,orig2,fair,wasm,wasm-scalar] [--main-only|--worker-only] [--shared]',
        '                                             headless Chromium: in-situ A/B on the main thread and in a Worker (one renderer per arm)',
      ].join('\n'));
      process.exitCode = suite ? 1 : 0;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
