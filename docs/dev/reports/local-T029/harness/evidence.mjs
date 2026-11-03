#!/usr/bin/env node
/**
 * T029 browser evidence (the lane's tree, bot256, the count runs' configuration): readable screenshots of
 *  (a) a banner raised inside the 30 s cooldown while the game stays at ultra, and
 *  (b) the Emergencies panel's "Waiting for a unit" row with its Send button for a busy in-range call.
 * Device scale 1 (sharp UI), the camera zoomed in 8 wheel notches (the frames SwiftShader can draw). A busy call waits
 * only a few game days, a few frames here, so the page pauses itself the moment one is raised (host.setSpeed(0,
 * 'pause'), the call the top bar's Pause button makes); the rest is real input.
 *   node evidence.mjs <tree> <F.region.metropolis> <outDir> [maxMinutes=9]
 */
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
const [ROOT, REGION, OUT, MAXMIN = '9'] = process.argv.slice(2);
const NM = '/home/user/simcityweb/node_modules';
const { createServer } = await import(`${NM}/vite/dist/node/index.js`);
const { chromium } = await import(`${NM}/playwright/index.mjs`);
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}] [evidence]`, ...a);
const cacheDir = resolve(OUT, `.vite-ev-${process.pid}`);
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, cacheDir, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const W = 960, H = 540;
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    localStorage.setItem('metropolis.settings.v1', JSON.stringify({ quality: 'low', autosaveMonths: 0, masterVolume: 0, pauseWhenHidden: false, newYear: 'off', yearReview: false, tips: false, cameraMoments: false }));
    localStorage.setItem('metropolis.settings', JSON.stringify({ quality: 'low', autosaveMonths: 0, v: 3 }));
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(0);
  page.on('pageerror', (e) => log('pageerror', e.message.slice(0, 200)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { polling: 500 });
  const b64 = readFileSync(REGION).toString('base64');
  await page.evaluate(async (b64) => {
    window.__ready = false;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const { importRegion } = await import('/src/save/index.ts');
    const r = await importRegion(new Blob([bytes]));
    void window.__metropolis.continueInCity(r, r.tiles.find((t) => t.city).key);
  }, b64);
  await page.waitForFunction(() => { const sc = window.__metropolis?.city?.scene; return !!(window.__ready && sc && sc.host.actions && sc.sim.systems.some((s) => s.name === 'emergency')); }, null, { polling: 1000 });
  await page.evaluate(() => {
    const sc = window.__metropolis.city.scene, sim = sc.sim;
    const E = (window.__ev = { busy: [], lastEnd: -1e9, live: false, alerts: '', cooldownBanner: null });
    sim.events.on('emergency', (e) => {
      if (e.type === 'uncovered' && e.reason === 'busy' && e.manualPossible && e.major && !E.busy.length) { E.busy.push(e.id); E.busyAt = { day: sim.state.day, speed: sim.speed, live: sc.host.policy.live }; sc.host.setSpeed(0, 'pause'); }
    });
    sc.host.policy.subscribe((p) => {
      const ids = p.alerts.map((a) => a.id).join(',');
      if (E.live && !p.live) E.lastEnd = performance.now();
      // a new alert while no episode runs and the last one ended under 30 s ago: a cooldown banner
      const old = new Set(E.alerts.split(',')), fresh = p.alerts.some((a) => !old.has(String(a.id)));
      if (!p.live && fresh && performance.now() - E.lastEnd < 30000 && sim.speed === 3 && !E.cooldownBanner) E.cooldownBanner = { at: performance.now() - E.lastEnd, ids };
      E.live = p.live; E.alerts = ids;
    }, new AbortController().signal);
  });
  const btn = async (title) => { const b = await page.locator(`button[title="${title}"]`).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const [ux, uy] = await btn('Ultra (3)'), [px, py] = await btn('Pause (Space)');
  const [ex, ey] = await btn('Emergencies — active incidents, fleets, statistics');
  await page.mouse.move(W / 2, H / 2 + 30);
  for (let k = 0; k < 8; k++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(300); }
  await page.mouse.click(ux, uy);
  const sharp = async (name) => { const p = resolve(OUT, `evidence-${name}.png`); await page.screenshot({ path: p }); log('shot', p); return p; };
  const end = Date.now() + +MAXMIN * 60000;
  let gotBanner = false, gotRow = false, offSince = -1;
  while (Date.now() < end && !(gotBanner && gotRow)) {
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => { const sc = window.__metropolis.city.scene, E = window.__ev; return { speed: sc.sim.speed, live: sc.host.policy.live, busy: E.busy.length, cb: E.cooldownBanner, day: sc.sim.state.day, alerts: sc.host.policy.alerts.length }; });
    if (!gotBanner && s.cb) {
      gotBanner = true;
      log('cooldown banner', JSON.stringify(s.cb), 'speed', s.speed, 'day', s.day);
      await sharp('cooldown-banner');
      const after = await page.evaluate(() => ({ speed: window.__metropolis.city.scene.sim.speed, live: window.__metropolis.city.scene.host.policy.live, alerts: window.__metropolis.city.scene.host.policy.alerts, banners: [...document.querySelectorAll('.emg-banners > *')].map((b) => b.textContent.replace(/\s+/g, ' ').slice(0, 160)) }));
      log('at the shot', JSON.stringify(after));
    }
    if (!gotRow && s.busy > 0) {
      gotRow = true;
      log('busy call', JSON.stringify(await page.evaluate(() => window.__ev.busyAt)), 'now day', s.day, 'speed', s.speed, 'live', s.live, 'alerts', s.alerts);
      await page.mouse.click(ex, ey); await page.waitForTimeout(2500);
      await sharp('waiting-row');
      const rows = await page.evaluate(() => [...document.querySelectorAll('.emg-row')].map((r) => r.textContent.replace(/\s+/g, ' ').slice(0, 200)));
      log('panel rows', JSON.stringify(rows));
      await page.mouse.click(ex, ey);
      await page.mouse.click(ux, uy);
      continue;
    }
    if (s.speed === 3) offSince = -1;
    else if (offSince < 0) offSince = Date.now();
    else if (Date.now() - offSince >= 3000) { await page.mouse.click(ux, uy); offSince = -1; }
  }
  log('done', JSON.stringify({ gotBanner, gotRow }));
} finally {
  await browser.close();
  await server.close();
  rmSync(cacheDir, { recursive: true, force: true });
}
