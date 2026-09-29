#!/usr/bin/env node
/**
 * Desirability / land-value band A/B driver: original JS (as-is) / fair JS / wasm scalar / wasm SIMD, resident (layers
 * in wasm memory) and staged (marshalling included), in node AND headless Chromium, plus the in-situ whole-sim A/B.
 *
 *   node tools/bench/desirabilityLandValueBands.bench.mjs [node|browser|insitu|all] --fixture F.metropolis [--fixture G …]
 *        [--tree DIR] [--reps 31] [--warm 20] [--days 90] [--chunk 3] [--insitu-mode frames|headless]
 *        [--insitu-arms asis,fixed,wasmRes,wasmStaged] [--json out.json]
 *
 *  node     bundles desirabilityLandValueBands/node.ts (rolldown, the bot's execution style) and runs it: per fixture,
 *           capture the band inputs after --warm days (cached in node_modules/.cache/sim-bench/econ/), check every arm
 *           bit-exact after every band, then runAB (ab.ts) on full sweeps: CPU time from an idle worker thread.
 *  browser  bundles desirabilityLandValueBands/browser.ts for a module Web Worker and runs the same A/B in Playwright
 *           Chromium (headless, swiftshader) on the captures, wall clock (performance.now) in the worker.
 *  insitu   bundles desirabilityLandValueBands/insitu.ts: whole sim per arm (genuine systems vs installEconBands shells),
 *           frames-mode ultra emulation (--insitu-mode frames, default) or headless days, arms interleaved in chunks.
 *  --tree   the simulation sources to bundle against (default: the repository). Pass the frozen snapshot of commit
 *           24f8609 while the live sim is mid-edit; the kernels / bindings (src/wasm/**) always come from here.
 * The scalar binary (same Rust without +simd128) is built on demand with `node tools/build-wasm.mjs --variant scalar`
 * into node_modules/.cache/sim-bench/ (skipped without cargo). Results: --json (one file with every part).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeRedirect } from './desirabilityLandValueBands/plugins.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'node_modules', '.cache', 'sim-bench');
const CAP_DIR = join(OUT, 'econ');
mkdirSync(CAP_DIR, { recursive: true });
const argv = process.argv.slice(2);
const mode = ['node', 'browser', 'insitu', 'all'].includes(argv[0]) ? argv.shift() : 'node';
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const fixtures = argv.flatMap((v, i) => (v === '--fixture' ? [resolve(argv[i + 1])] : []));
if (fixtures.length === 0) {
  console.error('usage: desirabilityLandValueBands.bench.mjs [node|browser|insitu|all] --fixture F.metropolis [...] [--tree DIR]');
  process.exit(2);
}
const tree = resolve(opt('--tree', ROOT));
const warm = opt('--warm', '20');
const jsonFile = opt('--json');
const result = { mode, fixtures, tree };

// the kernels are ports of 24f8609: say so when the tree's originals differ (the as-is arms then run another algorithm)
const FROZEN = {
  desirability: '15e9d50bae9609dc95bf4e356630f8caad375e933b650fd31c291e0584f8ad42',
  landValue: 'd75db40b99b1cd6a2bb0881a7746e63ca8a807d35eea5f87aec4bf1849aa933f',
};
for (const [f, h] of Object.entries(FROZEN)) {
  const file = join(tree, 'src', 'sim', 'economy', `${f}.ts`);
  const got = existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : 'missing';
  if (got !== h) console.log(`# WARNING: ${file} is not the 24f8609 version the kernels were ported from (pass --tree <24f8609 snapshot>)`);
}
console.log(`# tree ${tree}${tree === ROOT ? ' (live)' : ''}`);

async function bundle(entry, file, platform) {
  const { rolldown } = await import('rolldown');
  const b = await rolldown({ input: entry, platform, logLevel: 'warn', plugins: treeRedirect(tree) });
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

const capName = (f) => `${f.split('/').pop().replace(/\.metropolis$/, '')}.w${warm}.cap`;

async function runNode(scalar, captureOnly = false) {
  const file = await bundle(join(ROOT, 'tools', 'bench', 'desirabilityLandValueBands', 'node.ts'), join(OUT, 'desirabilityLandValueBands.node.mjs'), 'node');
  const json = join(OUT, 'desirabilityLandValueBands.node.json');
  const args = ['--max-old-space-size=8192', '--expose-gc', file, ...fixtures.flatMap((f) => ['--fixture', f]), '--cap-dir', CAP_DIR, '--warm', warm, '--json', json];
  if (opt('--reps')) args.push('--reps', opt('--reps'));
  if (opt('--sweeps')) args.push('--sweeps', opt('--sweeps'));
  if (captureOnly) args.push('--sweeps', 'none');
  if (scalar) args.push('--scalar', scalar);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) throw new Error(`node benchmark failed (${r.status})`);
  if (!captureOnly) result.node = JSON.parse(readFileSync(json, 'utf8'));
}

async function runInsitu() {
  const file = await bundle(join(ROOT, 'tools', 'bench', 'desirabilityLandValueBands', 'insitu.ts'), join(OUT, 'desirabilityLandValueBands.insitu.mjs'), 'node');
  result.insitu = [];
  const list = argv.flatMap((v, i) => (v === '--insitu-fixture' ? [resolve(argv[i + 1])] : []));
  for (const f of list.length ? list : fixtures) {
    const json = join(OUT, 'desirabilityLandValueBands.insitu.json');
    const args = ['--max-old-space-size=12288', file, '--fixture', f, '--warm', warm, '--json', json,
      '--days', opt('--days', '90'), '--chunk', opt('--chunk', '3'), '--mode', opt('--insitu-mode', 'frames')];
    if (opt('--insitu-arms')) args.push('--arms', opt('--insitu-arms'));
    const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ROOT });
    if (r.status !== 0) throw new Error(`in-situ benchmark failed (${r.status})`);
    result.insitu.push(JSON.parse(readFileSync(json, 'utf8')));
  }
}

async function runBrowser(scalar) {
  const missing = fixtures.filter((f) => !existsSync(join(CAP_DIR, capName(f))));
  if (missing.length) await runNode(null, true);
  const worker = await bundle(join(ROOT, 'tools', 'bench', 'desirabilityLandValueBands', 'browser.ts'), join(OUT, 'desirabilityLandValueBands.browser.mjs'), 'browser');
  const caps = fixtures.map((f) => capName(f));
  const files = {
    '/': { type: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>econ band A/B</title><script type="module">' +
      'const w = new Worker("/worker.mjs", { type: "module" }); window.__res = null;' +
      'w.onmessage = (e) => { if (e.data.log !== undefined) console.log(e.data.log); if (e.data.done) window.__res = e.data; };' +
      'w.onerror = (e) => { window.__res = { done: true, error: String(e.message || e) }; };' +
      `w.postMessage(${JSON.stringify({ caps: caps.map((c) => '/cap/' + c), simd: '/simd.wasm', scalar: scalar ? '/scalar.wasm' : null, reps: Number(opt('--reps', 31)) })});` +
      '</script>' },
    '/worker.mjs': { type: 'text/javascript', file: worker },
    '/simd.wasm': { type: 'application/wasm', file: join(ROOT, 'src', 'wasm', 'sim_kernels.wasm') },
  };
  for (const c of caps) files['/cap/' + c] = { type: 'application/octet-stream', file: join(CAP_DIR, c) };
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
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=4096'] });
  try {
    const page = await browser.newPage();
    page.on('console', (m) => console.log(`[chromium] ${m.text()}`));
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    await page.goto(url);
    await page.waitForFunction(() => window.__res !== null, null, { timeout: 120 * 60 * 1000, polling: 1000 });
    const res = await page.evaluate(() => window.__res);
    if (res.error) throw new Error(`browser benchmark failed: ${res.error}`);
    result.browser = { chromium: browser.version(), ...res.result };
  } finally {
    await browser.close();
    server.close();
  }
}

const scalar = mode === 'insitu' ? null : scalarBinary();
if (mode === 'node' || mode === 'all') await runNode(scalar);
if (mode === 'browser' || mode === 'all') await runBrowser(scalar);
if (mode === 'insitu' || mode === 'all') await runInsitu();
if (jsonFile) {
  writeFileSync(jsonFile, JSON.stringify(result, null, 1));
  console.log(`# wrote ${jsonFile}`);
}
console.log(`# captures in ${CAP_DIR}: ${readdirSync(CAP_DIR).join(', ')}`);
