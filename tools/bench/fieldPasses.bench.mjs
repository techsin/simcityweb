#!/usr/bin/env node
/**
 * Field-pass A/B driver (NIMBY rasters + pollution field stages): original JS (as-is) / fair JS / wasm scalar / wasm
 * SIMD, resident (arrays in wasm memory) and staged (marshalling included), in node AND headless Chromium, plus the
 * in-situ whole-sim A/B.
 *
 *   node tools/bench/fieldPasses.bench.mjs [node|browser|insitu|all] [--capture NAME=FIXTURE[@water] …] [--tree DIR]
 *        [--warm 20] [--reps 31] [--cases nimby,cells,…] [--insitu-mode cycles|days] [--insitu-fixture F[@water] …]
 *        [--days 62] [--chunk 2] [--insitu-arms asis,fair,wasmRes,wasmStaged] [--blur js|wasm] [--json out.json]
 *
 *  node     bundles fieldPasses/node.ts (rolldown, the bot's execution style) and runs it: per capture (the inputs of one
 *           NIMBY rebuild + one pollution pass after --warm days, cached in node_modules/.cache/sim-bench/fieldPasses/),
 *           check every arm bit-exact, then runAB (ab.ts) per case: CPU time from an idle worker thread.
 *  browser  bundles fieldPasses/browser.ts for a module Web Worker and runs the same A/B in Playwright Chromium (headless,
 *           swiftshader) on the captures, wall clock (performance.now) in the worker.
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
const mode = ['node', 'browser', 'insitu', 'all'].includes(argv[0]) ? argv.shift() : 'node';
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
    await page.waitForFunction(() => window.__res !== null, null, { timeout: 180 * 60 * 1000, polling: 1000 });
    const res = await page.evaluate(() => window.__res);
    if (res.error) throw new Error(`browser benchmark failed: ${res.error}`);
    result.browser = { chromium: browser.version(), ...res.result };
  } finally {
    await browser.close();
    server.close();
  }
}

const scalar = mode === 'insitu' ? null : (opt('--scalar') ?? scalarBinary());
if (mode === 'node' || mode === 'all') await runNode(scalar);
if (mode === 'browser' || mode === 'all') await runBrowser(scalar);
if (mode === 'insitu' || mode === 'all') await runInsitu();
if (jsonFile) {
  writeFileSync(jsonFile, JSON.stringify(result, null, 1));
  console.log(`# wrote ${jsonFile}`);
}
