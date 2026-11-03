#!/usr/bin/env node
/**
 * W1.2's browser acceptance (docs/WORKER_DESIGN.md §5.4 and §6 row W1.2): a real simulation worker in Playwright's
 * Chromium, against the production build by default. One browser and one server, both stopped on any exit.
 *
 *   node tools/qa-worker.mjs [--dev] [--port 5535] [--out <dir>] [--size small] [--freeze-ms 15000]
 *
 * Steps, each logged PASS or FAIL (exit code 1 on any FAIL):
 *   boot      ?quickstart=1&simworker=1 reaches __ready on a worker host (the worker is its own script)
 *   tools     a road drag and a zone drag through the real tools (pointer events on the canvas) are acked
 *   play      days advance at speed 3
 *   verify    paused, the worker's exact digest equals the replica's (host.verify(): query 'verify')
 *   save      Ctrl+S, then the stored record holds the road and the zone
 *   load      a reload, the title's Continue: the same city on a new worker, which continues
 *   freeze    CDP Page.setWebLifecycleState frozen for 15 s, then active: no crash path, days advance within 1 s
 *   hidden    a hidden tab still saves (main acks outside ticks)
 *   crash     a fatal in the worker: the crash dialog; "Restart from autosave" boots a new worker from the save
 *   watchdog  a worker that stops posting: 10 visible seconds, the crash dialog; "Continue on the main thread"
 *   fallback  a worker script that fails to load: the city boots on the main thread, with one toast
 *   console   no console errors outside the steps that crash on purpose
 * Measured, not gated: boot time and action latency (post to ack applied, p50 / p95 / p99). Not covered here: the
 * protector probe in the page and the worker (S1's tests/perf/protector.test.ts runs the production loop under node),
 * the held terraform brush, and W1.3's journal check. WebGL runs on SwiftShader: function, not GPU timings.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const DEV = flag('dev');
const PORT = Number(opt('port', 5535));
const OUT = path.resolve(opt('out', path.join(os.tmpdir(), 'qa-worker')));
const SIZE = opt('size', 'small');
const FREEZE_MS = Number(opt('freeze-ms', 15000));
const READY_MS = 300000;

fs.mkdirSync(OUT, { recursive: true });
const logFile = path.join(OUT, 'log.txt');
fs.writeFileSync(logFile, '');
const log = (...a) => {
  const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  console.log(s); fs.appendFileSync(logFile, s + '\n');
};
const results = [];
const check = (step, ok, detail = '') => { results.push({ step, ok }); log(ok ? 'PASS' : 'FAIL', step, detail); };

let server, browser;
const cleanup = async () => {
  try { await browser?.close(); } catch { /* closed */ }
  try { await server?.close?.(); } catch { /* closed */ }
};
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });
process.on('SIGTERM', async () => { await cleanup(); process.exit(143); });
const timer = setTimeout(async () => { log('QA TIMEOUT'); await cleanup(); process.exit(124); }, Number(process.env.QA_TIMEOUT_MS ?? 1800000));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(page, name) {
  const f = path.join(OUT, `${name}.png`);
  try { await page.screenshot({ path: f, timeout: 60000 }); log('shot', f); } catch (e) { log('shot failed', name, String(e).slice(0, 200)); }
  return f;
}

// ---- page helpers (all run in the page: window.__metropolis is the App)
const hostInfo = (page) => page.evaluate(() => {
  const c = window.__metropolis.city, h = c?.host;
  if (!h) return null;
  const st = h.state;
  let roads = 0, zoned = 0;
  for (let i = 0; i < st.network.length; i++) { if (st.network[i]) roads++; if (st.zone[i]) zoned++; }
  return { kind: h.kind, disposed: !!h.isDisposed, day: st.day, speed: h.speed, roads, zoned, funds: st.funds,
    applied: h.replica?.applied ?? null, pending: h.pending?.count ?? 0, crashed: !!c.crashed };
});
const waitHost = (page, test, arg, ms = 60000) => page.waitForFunction(test, arg, { timeout: ms, polling: 100 });
const crashDialog = (page) => page.evaluate(() => [...document.querySelectorAll('.modal h2')].some((e) => e.textContent === 'The simulation stopped'));

/** screen points of the canvas whose picked cells are buildable: a row for the road, a rectangle below it to zone */
async function dragPlan(page) {
  return page.evaluate(() => {
    const scene = window.__metropolis.city.scene, w = scene.world, canvas = scene.canvas, r = canvas.getBoundingClientRect();
    const st = scene.host.state, cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pick = (x, y) => { const c = w.pickCell(x, y); return c ? { x: c.x, z: c.z } : null; };
    return { a: [cx - 160, cy - 40], b: [cx + 160, cy - 40], z0: [cx - 120, cy + 10], z1: [cx + 100, cy + 70],
      cells: [pick(cx - 160, cy - 40), pick(cx + 160, cy - 40)], size: st.size };
  });
}
async function drag(page, from, to) {
  await page.mouse.move(from[0], from[1], { steps: 4 });
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 6 });
  await page.mouse.move(to[0], to[1], { steps: 6 });
  await sleep(150);
  await page.mouse.up();
}
async function selectTool(page, id) {
  const ok = await page.evaluate((tool) => window.__metropolis.city.scene.tools.select(tool), id);
  if (!ok) throw new Error(`tool ${id} not selected`);
}
/** the App's city is up: its scene's views are ready and the save indicator runs (the end of App.enterCity) */
const cityUp = (page, kind) => page.waitForFunction((k) => {
  const c = window.__metropolis.city;
  return !!c?.scene && !!c.status && !c.crashed && !c.host.isDisposed && (!k || c.host.kind === k);
}, kind ?? null, { timeout: READY_MS, polling: 250 });
async function enterCity(page, url, what) {
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: READY_MS, polling: 250 });
  await cityUp(page);
  log(what, 'ready after', Date.now() - t0, 'ms');
  return Date.now() - t0;
}
async function continueFromTitle(page, base) {
  const t0 = Date.now();
  await page.goto(`${base}/?simworker=1`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: READY_MS, polling: 250 });
  await page.getByText('Continue', { exact: true }).first().click();
  await cityUp(page);
  log('continue: city after', Date.now() - t0, 'ms');
}
async function setSpeed(page, n) {
  await page.keyboard.press(`Digit${n}`);
}

async function main() {
  const vite = require('vite');
  const { chromium } = require('playwright');
  const cacheDir = path.join(OUT, 'vitecache');
  if (DEV) {
    server = await vite.createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir, logLevel: 'warn',
      server: { port: PORT, strictPort: true, host: '127.0.0.1', hmr: false } });
    await server.listen();
  } else {
    const outDir = path.join(OUT, 'dist'), t0 = Date.now();
    await vite.build({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
    const worker = fs.readdirSync(path.join(outDir, 'assets')).filter((f) => /^simWorker-.*\.js$/.test(f));
    const bytes = worker.length ? fs.statSync(path.join(outDir, 'assets', worker[0])).size : 0;
    log('build', Date.now() - t0, 'ms; worker chunk', worker[0] ?? 'missing', bytes, 'bytes');
    check('build: the worker is its own chunk', worker.length === 1, worker.join(','));
    server = await vite.preview({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir, logLevel: 'warn',
      build: { outDir }, preview: { port: PORT, strictPort: true, host: '127.0.0.1' } });
  }
  const base = `http://127.0.0.1:${PORT}`;
  log('server', base, DEV ? '(dev)' : '(production build)');
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  let expectErrors = false;
  const errors = [], workers = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (!expectErrors) errors.push(m.text());
    log(expectErrors ? 'console error (expected)' : 'console error', m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => { if (!expectErrors) errors.push(String(e)); log('pageerror', String(e).slice(0, 300)); });
  page.on('worker', (w) => { workers.push(w.url()); log('worker', w.url().split('/').pop()); });

  // ---- boot
  const bootMs = await enterCity(page, `${base}/?quickstart=1&size=${SIZE}&seed=7&simworker=1`, 'quickstart');
  let info = await hostInfo(page);
  check('boot: a worker host', info?.kind === 'worker' && workers.some((u) => /simWorker/.test(u)), JSON.stringify({ info, workers: workers.length, bootMs }));
  await shot(page, '01-boot');

  // ---- tools: a road, then a zone beside it, through the real tools
  const plan = await dragPlan(page);
  log('drag plan', plan);
  const before = await hostInfo(page);
  await selectTool(page, 'net:2');
  await drag(page, plan.a, plan.b);
  await waitHost(page, (n) => { const h = window.__metropolis.city.host; let r = 0; for (const v of h.state.network) if (v) r++; return r > n && (h.pending?.count ?? 0) === 0; }, before.roads).catch(() => undefined);
  await selectTool(page, 'zone:1');
  await drag(page, plan.z0, plan.z1);
  await waitHost(page, (n) => { const h = window.__metropolis.city.host; let z = 0; for (const v of h.state.zone) if (v) z++; return z > n && (h.pending?.count ?? 0) === 0; }, before.zoned).catch(() => undefined);
  await page.keyboard.press('Escape');
  info = await hostInfo(page);
  check('tools: road and zone drags acked', info.roads > before.roads && info.zoned > before.zoned && info.pending === 0,
    JSON.stringify({ before: { roads: before.roads, zoned: before.zoned }, after: { roads: info.roads, zoned: info.zoned, pending: info.pending } }));
  await shot(page, '02-tools');

  // ---- play
  await setSpeed(page, 3);
  const day0 = (await hostInfo(page)).day;
  await waitHost(page, (d) => window.__metropolis.city.host.state.day >= d + 40, day0, 120000).catch(() => undefined);
  info = await hostInfo(page);
  check('play: days advance at speed 3', info.day >= day0 + 40 && info.speed === 3, JSON.stringify({ from: day0, to: info.day, speed: info.speed }));

  // ---- latency (measured, not gated): post to ack applied, on a running city
  const lat = await page.evaluate(async () => {
    const h = window.__metropolis.city.host, out = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      const t = h.post('setTax', [0, 9 + (i % 2) * 0.5]); h.flushCommands();
      await t.done; out.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 25));
    }
    out.sort((a, b) => a - b);
    const q = (p) => out[Math.min(out.length - 1, Math.floor(p * out.length))];
    return { n: out.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: out.at(-1) };
  });
  log('latency (post to ack applied, ms, SwiftShader, not gated)', lat);

  // ---- verify on a paused city
  await setSpeed(page, 1); await page.keyboard.press('Space');
  await waitHost(page, () => window.__metropolis.city.host.speed === 0, null, 10000).catch(() => undefined);
  await sleep(1500);
  const v1 = await page.evaluate(() => window.__metropolis.city.host.verify());
  await sleep(500);
  const v2 = await page.evaluate(() => window.__metropolis.city.host.verify());
  check('verify: worker digest equals the replica\'s (paused)', v1.worker === v1.replica && v2.worker === v2.replica, JSON.stringify({ v1, v2 }));

  // ---- save
  const saveFrom = await hostInfo(page);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => /City saved/.test(document.querySelector('.save-pill')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => undefined);
  const savedRec = await page.evaluate(async () => {
    const app = window.__metropolis, c = app.city;
    return { lastSave: c.lastSave, dirty: app.isDirty(), pill: document.querySelector('.save-pill')?.textContent };
  });
  check('save: Ctrl+S through the worker, stored by main', /City saved/.test(savedRec.pill ?? '') && savedRec.dirty === false, JSON.stringify(savedRec));
  await shot(page, '03-saved');

  // ---- hidden tab: no ticks; main acks outside them, so the save still replies
  await page.evaluate(() => window.__metropolis.city.host.setSpeed(1, 'topbar'));
  await sleep(800);
  const hidden = await page.evaluate(async () => {
    const c = window.__metropolis.city, h = c.host, s = c.scene;
    // a hidden tab posts no ticks (no rAF) and no pings (the watchdog stops on visibilitychange)
    cancelAnimationFrame(s.raf);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const t0 = performance.now();
    try { const ack = await Promise.race([h.save('hidden'), new Promise((_, no) => setTimeout(() => no(new Error('no reply in 20 s')), 20000))]); return { ok: true, ms: performance.now() - t0, cmd: ack.cmd }; }
    catch (e) { return { ok: false, error: String(e) }; }
    finally {
      delete document.visibilityState; delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
      s.last = performance.now(); s.raf = requestAnimationFrame(s.loop);
    }
  });
  check('hidden: a save replies with the tab hidden', hidden.ok, JSON.stringify(hidden));
  await page.keyboard.press('Space');
  await waitHost(page, () => window.__metropolis.city.host.speed === 0, null, 10000).catch(() => undefined);
  await page.keyboard.press('Control+s');
  await sleep(2000);
  const kept = await hostInfo(page);

  // ---- load: reload into the title, Continue
  await continueFromTitle(page, base);
  info = await hostInfo(page);
  check('load: the saved city on a new worker', info?.kind === 'worker' && info.roads === kept.roads && info.zoned === kept.zoned && info.day >= saveFrom.day,
    JSON.stringify({ saved: { day: kept.day, roads: kept.roads, zoned: kept.zoned }, loaded: info }));
  await shot(page, '04-loaded');
  await setSpeed(page, 3);
  const loadDay = info.day;
  await waitHost(page, (d) => window.__metropolis.city.host.state.day >= d + 20, loadDay, 120000).catch(() => undefined);
  info = await hostInfo(page);
  check('load: it continues', info.day >= loadDay + 20, JSON.stringify({ from: loadDay, to: info.day }));

  // ---- freeze (R16): frozen for 15 s, then active
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await sleep(FREEZE_MS);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  const resumed = await page.evaluate(async () => {
    const h = window.__metropolis.city.host, d0 = h.state.day, t0 = performance.now();
    while (performance.now() - t0 < 1000 && h.state.day === d0) await new Promise((r) => setTimeout(r, 20));
    return { d0, d1: h.state.day, ms: performance.now() - t0, disposed: !!h.isDisposed };
  });
  const crashedAfterFreeze = await crashDialog(page);
  check('freeze: no crash path, days advance within 1 s of resume', !crashedAfterFreeze && !resumed.disposed && resumed.d1 > resumed.d0, JSON.stringify({ ...resumed, crashDialog: crashedAfterFreeze }));
  await shot(page, '05-after-freeze');
  check('console: no errors in normal play', errors.length === 0, errors.slice(0, 5).join(' | '));

  // ---- crash: a fatal in the worker, then Restart from autosave
  expectErrors = true;
  await page.keyboard.press('Space');
  await page.evaluate(() => { const h = window.__metropolis.city.host; h.link.post({ t: 'tick', seq: 0, dt: -1, ack: 0 }); });
  await page.waitForFunction(() => [...document.querySelectorAll('.modal h2')].some((e) => e.textContent === 'The simulation stopped'), null, { timeout: 30000 }).catch(() => undefined);
  const dialog = await crashDialog(page);
  check('crash: a fatal opens the crash dialog', dialog);
  await shot(page, '06-crash-dialog');
  if (dialog) {
    await page.getByText('Restart from autosave', { exact: true }).click();
    await cityUp(page, 'worker').catch(() => undefined);
    info = await hostInfo(page);
    check('crash: Restart from autosave boots a new worker on the save', info?.kind === 'worker' && !info.disposed && info.roads === kept.roads, JSON.stringify(info));
    await shot(page, '07-restarted');
  }

  // ---- watchdog: the worker stops posting; 10 visible seconds, then Continue on the main thread
  await page.evaluate(() => { const h = window.__metropolis.city.host; h.link.port.terminate(); });
  const t0 = Date.now();
  await page.waitForFunction(() => [...document.querySelectorAll('.modal h2')].some((e) => e.textContent === 'The simulation stopped'), null, { timeout: 40000 }).catch(() => undefined);
  const watchdog = await crashDialog(page), after = Date.now() - t0;
  check('watchdog: 10 visible seconds without a packet open the crash dialog', watchdog && after >= 9000, `${after} ms`);
  if (watchdog) {
    await page.getByText('Continue on the main thread', { exact: true }).click();
    await cityUp(page, 'local').catch(() => undefined);
    info = await hostInfo(page);
    check('watchdog: Continue on the main thread runs the save on a local host', info?.kind === 'local' && info.roads === kept.roads, JSON.stringify(info));
    await shot(page, '08-main-thread');
  }
  expectErrors = false;
  await page.close();

  // ---- fallback: a worker script that fails to load
  const fctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await fctx.addInitScript(() => {
    const W = window.Worker;
    window.Worker = class extends W {
      constructor(url, o) { super(/simWorker/.test(String(url)) ? 'data:text/javascript,throw new Error("qa-worker: the script failed")' : url, o); }
    };
  });
  const fpage = await fctx.newPage();
  const toasts = [];
  await fpage.exposeFunction('__qaToast', (t) => toasts.push(t));
  await fpage.addInitScript(() => {
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && /toast/.test(n.className ?? '')) window.__qaToast(n.textContent); })
      .observe(document.documentElement, { childList: true, subtree: true });
  });
  await enterCity(fpage, `${base}/?quickstart=1&size=${SIZE}&seed=7&simworker=1`, 'fallback');
  const finfo = await hostInfo(fpage);
  const workerToasts = toasts.filter((t) => /simulation worker/i.test(t));
  check('fallback: a failed worker script boots the city on the main thread, with one toast', finfo?.kind === 'local' && workerToasts.length === 1, JSON.stringify({ kind: finfo?.kind, toasts }));
  await shot(fpage, '09-fallback');
  await fctx.close();
}

try {
  await main();
} catch (e) {
  log('QA FAILED', String(e?.stack ?? e));
  results.push({ step: 'harness', ok: false });
} finally {
  clearTimeout(timer);
  await cleanup();
  const failed = results.filter((r) => !r.ok);
  log(`${results.length - failed.length} of ${results.length} passed${failed.length ? `; failed: ${failed.map((r) => r.step).join(', ')}` : ''}`);
  process.exitCode = failed.length ? 1 : 0;
}
