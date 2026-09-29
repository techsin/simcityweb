#!/usr/bin/env node
/**
 * Headless-Chromium check of the WebAssembly kernels in the real browser pipelines.
 *
 *   node tools/bench/browser-check.mjs dev   [--ab] [--quick] [--flag js] [--mime-octet] [--coi] [--json out.json]
 *   node tools/bench/browser-check.mjs prod  [...]      vite build (project config + check page) + vite preview
 *
 *  dev   Vite dev server: /src/wasm/sim_kernels.wasm served from the source tree
 *  prod  production build: hashed asset under assets/, served by vite preview
 *  --mime-octet   serve .wasm as application/octet-stream (static hosts) -> exercises the arrayBuffer() fallback
 *  --flag js      ?simwasm=js -> kernels must stay on JS (A/B switch)
 *  --coi          COOP/COEP headers -> crossOriginIsolated (SharedArrayBuffer available)
 *  --ab           run the in-browser A/B timings (main thread + worker)
 * Exit code 1 when a check fails.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const mode = args[0] === 'prod' ? 'prod' : 'dev';
const has = (f) => args.includes(f);
const opt = (f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);
const flag = opt('--flag') ?? null;
if (has('--coi')) process.env.COI = '1';

process.chdir(ROOT);
const vite = await import('vite');
const configFile = resolve(ROOT, 'tools/bench/vite.check.config.ts');
let server, url;
const t0 = Date.now();
if (mode === 'dev') {
  server = await vite.createServer({ configFile, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
  await server.listen();
  url = `http://127.0.0.1:${server.httpServer.address().port}/tools/bench/wasm-check.html`;
} else {
  await vite.build({ configFile, logLevel: 'warn' });
  console.log(`# vite build: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  server = await vite.preview({ configFile, logLevel: 'error', preview: { port: 0, host: '127.0.0.1' } });
  url = `http://127.0.0.1:${server.httpServer.address().port}/tools/bench/wasm-check.html`;
}
const q = new URLSearchParams();
if (flag) q.set('simwasm', flag);
if (has('--ab')) q.set('ab', '1');
if (has('--quick')) q.set('quick', '1');
const full = url + (q.toString() ? `?${q}` : '');

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let result, failed = [];
const wasmResponses = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text().slice(0, 500)}`); });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('response', (r) => { if (r.url().endsWith('.wasm')) wasmResponses.push({ url: r.url().replace(/^https?:\/\/[^/]+/, ''), status: r.status(), type: r.headers()['content-type'] }); });
  if (has('--mime-octet')) {
    await page.route('**/*.wasm', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), 'content-type': 'application/octet-stream' } });
    });
  }
  await page.goto(full);
  await page.waitForFunction(() => window.__wasmCheck?.done === true, null, { timeout: 15 * 60 * 1000, polling: 500 });
  result = await page.evaluate(() => window.__wasmCheck);
} finally {
  await browser.close();
  await server.close?.();
  if (server.httpServer?.close) server.httpServer.close();
}

// ---- verdict
const expectWasm = flag !== 'js';
const main = result.main ?? {};
const worker = result.worker ?? {};
if (result.error) failed.push(`page error: ${result.error}`);
if (worker.error) failed.push(`worker error: ${worker.error}`);
for (const [where, r] of [['main', main], ['worker', worker]]) {
  if (!r.status) continue;
  if (expectWasm && r.status.state !== 'ready') failed.push(`${where}: wasm not ready (${r.status.state}: ${r.status.error})`);
  if (!expectWasm && r.eq?.wasmActive) failed.push(`${where}: flag js but wasm kernels active`);
  if (r.eq?.failures?.length) failed.push(`${where}: ${r.eq.failures.length} equivalence failures: ${r.eq.failures.slice(0, 5).join(', ')}`);
}
if (expectWasm && !result.syncCompile?.ok) failed.push(`sync main-thread compile failed: ${result.syncCompile?.error}`);
if (has('--coi') && !result.crossOriginIsolated) failed.push('COI headers set but page is not crossOriginIsolated');

const summary = {
  mode, url: full.replace(/^https?:\/\/[^/]+/, ''), userAgent: result.userAgent, crossOriginIsolated: result.crossOriginIsolated,
  workerCrossOriginIsolated: worker.crossOriginIsolated, wasmUrl: result.wasmUrl, wasmResponses,
  main: { state: main.status?.state, source: main.status?.source, bytes: main.status?.bytes, initMs: main.status?.initMs, simd: main.status?.features?.simd128, checks: main.eq?.checks, failures: main.eq?.failures?.length, wasmActive: main.eq?.wasmActive },
  worker: { state: worker.status?.state, initMs: worker.status?.initMs, checks: worker.eq?.checks, failures: worker.eq?.failures?.length, wasmActive: worker.eq?.wasmActive },
  syncCompile: result.syncCompile,
  ab: [...(main.ab ?? []).map((r) => ({ where: 'main', ...r })), ...(worker.ab ?? []).map((r) => ({ where: 'worker', ...r }))].map((r) => ({
    where: r.where, name: r.name, jsMs: r.a.median, wasmMs: r.b.median, jsMin: r.a.min, wasmMin: r.b.min, speedup: r.speedup,
  })),
  failed,
};
console.log(JSON.stringify(summary, null, 1));
if (opt('--json')) writeFileSync(opt('--json'), JSON.stringify({ summary, result }, null, 1));
process.exit(failed.length ? 1 : 0);
