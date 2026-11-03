#!/usr/bin/env node
/**
 * FH-21's context-loss test (POLISH_PLAN §8.1, verifier check 8): a lost WebGL context must pause the game, save, and
 * show "Graphics reset — Restore"; Restore (or the browser's webglcontextrestored) must bring back a working view at the
 * same camera with the city's state hash unchanged.
 *
 * Usage:  node tools/qa-context-loss.mjs [--size small|medium] [--shots <dir>] [--cache <vite cache dir>]
 *
 * Self-contained like tools/qa-deadzones.mjs: its own Vite dev server (HMR off) on a free port, headless Chromium
 * (SwiftShader WebGL), a quickstart city on Low. Two rounds: WEBGL_lose_context.loseContext() then the Restore button,
 * and loseContext() then restoreContext(). Exit 1 on any failed check.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const SIZE = arg('--size', 'small');
const SHOTS = arg('--shots', null);
// (an own dependency cache outside node_modules, so a parallel dev server's re-optimisation cannot break the page)
const CACHE = arg('--cache', join(tmpdir(), 'metropolis-qa-context-loss-vite'));
const log = (...a) => console.log('[context-loss]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const server = await createServer({ root, cacheDir: CACHE, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch();
const failures = [];
const check = (name, ok, detail) => {
  log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail));
  if (!ok) failures.push(name);
};
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Low keeps SwiftShader frames short; the slow-frame prompt (FH-21) is answered already
  await page.addInitScript(() => {
    try {
      localStorage.setItem('metropolis.settings', JSON.stringify({ quality: 'low' }));
      localStorage.setItem('metropolis.settings.v1', JSON.stringify({ quality: 'low' }));
      localStorage.setItem('metropolis.ui.slowPrompt', JSON.stringify({ shown: true, answer: 'keep' }));
    } catch {
      /* ignore */
    }
  });
  await page.goto(`${base}/index.html?quickstart=1&size=${SIZE}`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__ready === true && window.__metropolis?.city?.scene?.worldView && !window.__metropolis.city.scene.worldView.isNull, null, { timeout: 400000, polling: 250 });
  await sleep(2000);
  const snap = () => page.evaluate(async () => {
    const sc = window.__metropolis.city.scene;
    const { exactDigest } = await import('/src/worker/queries.ts');
    const { readCamera } = await import('/src/game/cameraStart.ts');
    const gl = sc.worldView.renderer?.getContext?.();
    return { hash: exactDigest(sc.sim.state), cam: readCamera(sc.worldView.controls), speed: sc.host.speed, lastSave: window.__metropolis.city.lastSave,
      card: document.querySelector('.ctx-lost')?.textContent ?? null, canvas: document.querySelectorAll('canvas.mp-canvas').length, lost: gl?.isContextLost?.() ?? null,
      calls: sc.worldView.renderer?.info?.render?.calls ?? 0, isNull: !!sc.worldView.isNull };
  });
  const sameCam = (a, b) => !!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.z - b.z) < 0.5 && Math.abs(a.distance - b.distance) < 1 && Math.abs((a.yaw ?? 0) - (b.yaw ?? 0)) < 0.1 && Math.abs((a.tilt ?? 0) - (b.tilt ?? 0)) < 0.1;
  for (const round of ['Restore button', 'restoreContext()']) {
    // the game runs when the context goes: the pause is the handler's
    await page.evaluate(() => window.__metropolis.city.scene.host.setSpeed(1, 'keyboard'));
    await sleep(800);
    const before = await snap();
    await page.evaluate(() => {
      window.__oldCanvas = document.querySelector('canvas.mp-canvas');
      const c = window.__oldCanvas;
      window.__lose = (c.getContext('webgl2') || c.getContext('webgl')).getExtension('WEBGL_lose_context');
      window.__lose.loseContext();
    });
    await page.waitForSelector('.ctx-lost', { timeout: 30000 });
    await sleep(2500);
    const lost = await snap();
    check(`${round}: loseContext() pauses the game`, lost.speed === 0, lost.speed);
    check(`${round}: it saves`, lost.lastSave > before.lastSave, { before: before.lastSave, after: lost.lastSave });
    check(`${round}: it shows "Graphics reset" with Restore`, /Graphics reset/.test(lost.card ?? '') && /Restore/.test(lost.card ?? ''), lost.card);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `lost-${round.replace(/\W+/g, '-')}.png`) });
    if (round === 'Restore button') await page.getByText('Restore', { exact: true }).click();
    else await page.evaluate(() => window.__lose.restoreContext());
    await page.waitForFunction(() => !document.querySelector('.ctx-lost'), null, { timeout: 120000 });
    await sleep(4000);
    const after = await snap();
    const fresh = await page.evaluate(() => document.querySelector('canvas.mp-canvas') !== window.__oldCanvas);
    check(`${round}: a working view on a fresh canvas`, fresh && after.lost === false && !after.isNull && after.calls > 0 && after.canvas === 1, { fresh, lost: after.lost, calls: after.calls, canvases: after.canvas });
    check(`${round}: the same camera`, sameCam(lost.cam ?? before.cam, after.cam), { before: before.cam, after: after.cam });
    check(`${round}: the city's state hash is unchanged (and it stays paused)`, after.hash === lost.hash && after.speed === 0, { lost: lost.hash, after: after.hash, speed: after.speed });
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `restored-${round.replace(/\W+/g, '-')}.png`) });
  }
  check('no page errors', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  check('the run completed', false, String(e?.stack ?? e));
} finally {
  await browser.close();
  await server.close();
}
log(failures.length ? `${failures.length} check(s) failed` : 'all checks passed');
process.exit(failures.length ? 1 : 0);
