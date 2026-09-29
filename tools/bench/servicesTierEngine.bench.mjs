#!/usr/bin/env node
/**
 * Services tier engine A/B driver: original JS / fair JS / wasm scalar / wasm SIMD, in node AND headless Chromium.
 *
 *   node tools/bench/servicesTierEngine.bench.mjs [node|browser|all] --fixture F.metropolis [--fixture G ...]
 *        [--reps 31] [--cases replay,passes,insitu] [--insitu-days 60] [--chunk 6] [--json out.json]
 *   npm run bench:services -- all --fixture <dir>/dense1m_s7.metropolis --json out.json
 *
 *  node      bundles tools/bench/servicesTierEngine.node.ts (rolldown, the bot's execution style) and runs it: CPU time
 *            from an idle worker thread (see node.ts); cases replay (a), cold / warm / full passes (b, c), in situ (d)
 *  browser   bundles tools/bench/servicesTierEngine.browser.ts for a Web Worker, serves it + the binaries + the first
 *            fixture from a local static server and runs it in Playwright Chromium (headless, swiftshader): replay +
 *            full passes, wall clock (performance.now) in the worker
 * The scalar binary (same Rust without +simd128) is built on demand with `node tools/build-wasm.mjs --variant scalar`
 * into node_modules/.cache/sim-bench/ (skipped when cargo is missing). Fixtures: see tools/bench/sim-profile/fixtures
 * (dense1m.ts, botgrow.ts) — the profiler's dense 1.12M city and the balance bot's year-60 city.
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'node_modules', '.cache', 'sim-bench');
mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const mode = ['node', 'browser', 'all'].includes(argv[0]) ? argv.shift() : 'node';
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const fixtures = argv.flatMap((v, i) => (v === '--fixture' ? [resolve(argv[i + 1])] : []));
if (fixtures.length === 0) {
  console.error('usage: servicesTierEngine.bench.mjs [node|browser|all] --fixture F.metropolis [...]');
  process.exit(2);
}
const jsonFile = opt('--json');
const result = { mode, fixtures };

// ------------------------------------------------------------------------------------------------ scalar variant
function scalarBinary() {
  const file = join(OUT, 'sim_kernels.scalar.wasm');
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-wasm.mjs'), '--variant', 'scalar', '--out', OUT], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    console.log(`# scalar build unavailable (${(r.stderr || r.stdout || '').trim().split('\n').pop()}): SIMD only`);
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

// ------------------------------------------------------------------------------------------------ node
async function runNode(scalar) {
  const file = await bundle(join(ROOT, 'tools', 'bench', 'servicesTierEngine.node.ts'), join(OUT, 'servicesTierEngine.node.mjs'), 'node');
  const json = join(OUT, 'servicesTierEngine.node.json');
  const args = ['--max-old-space-size=8192', file, ...fixtures.flatMap((f) => ['--fixture', f]), '--json', json];
  for (const k of ['--reps', '--cases', '--insitu-days', '--chunk']) if (opt(k)) args.push(k, opt(k));
  if (scalar) args.push('--scalar', scalar);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) throw new Error(`node benchmark failed (${r.status})`);
  result.node = JSON.parse(readFileSync(json, 'utf8'));
}

// ------------------------------------------------------------------------------------------------ browser
async function runBrowser(scalar) {
  const worker = await bundle(join(ROOT, 'tools', 'bench', 'servicesTierEngine.browser.ts'), join(OUT, 'servicesTierEngine.browser.mjs'), 'browser');
  const files = {
    '/': { type: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>services tier engine A/B</title><script type="module">' +
      'const w = new Worker("/worker.mjs", { type: "module" }); window.__res = null;' +
      'w.onmessage = (e) => { if (e.data.log !== undefined) console.log(e.data.log); if (e.data.done) window.__res = e.data; };' +
      `w.postMessage(${JSON.stringify({ fixture: '/fixture.metropolis', simd: '/simd.wasm', scalar: scalar ? '/scalar.wasm' : null, reps: Number(opt('--reps', 21)) })});` +
      '</script>' },
    '/worker.mjs': { type: 'text/javascript', file: worker },
    '/simd.wasm': { type: 'application/wasm', file: join(ROOT, 'src', 'wasm', 'sim_kernels.wasm') },
    '/fixture.metropolis': { type: 'application/octet-stream', file: fixtures[0] },
  };
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
    await page.waitForFunction(() => window.__res !== null, null, { timeout: 90 * 60 * 1000, polling: 1000 });
    const res = await page.evaluate(() => window.__res);
    if (res.error) throw new Error(`browser benchmark failed: ${res.error}`);
    result.browser = res.result;
  } finally {
    await browser.close();
    server.close();
  }
}

const scalar = scalarBinary();
if (mode === 'node' || mode === 'all') await runNode(scalar);
if (mode === 'browser' || mode === 'all') await runBrowser(scalar);
if (jsonFile) {
  writeFileSync(jsonFile, JSON.stringify(result, null, 1));
  console.log(`# wrote ${jsonFile}`);
}
