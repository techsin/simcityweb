#!/usr/bin/env node
/**
 * PI-1 in-browser numbers: the real game (index.html) in headless Chromium on the real GPU, a fixture imported as a
 * region (toRegion.ts), quality ultra, sim speed 3 (ultra: 0.05 s per day) for --days simulated days.
 *
 *   node tools/bench/baselines/pi1Browser.mjs <fixture.region.metropolis> [--days 90] [--runs 3] [--out result.json]
 *        [--emergency ignore|live|pause]   (the player setting emergencyUncovered; default ignore, see below)
 *
 * Per frame: main-thread time inside requestAnimationFrame callbacks (the game's whole frame: sim.update, objects,
 * render submit; wrapped in an init script). Long tasks >= 50 ms from PerformanceObserver('longtask'). Throughput:
 * simulated days / wall seconds over the run. Starts its own Vite server on --port (5199). Wall clock in the page
 * (performance.now), headless (frame timing in a headed window can be throttled when the display sleeps).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const file = argv[0];
const DAYS = +arg('days', '90'), RUNS = +arg('runs', '3'), PORT = +arg('port', '5199'), OUT = arg('out');
// the game's emergency speed policy (settings.emergencyUncovered, src/ui/EmergencyBanner.ts) drops a big city to speed 1
// (LIVE) or pauses within seconds of an undispatched incident; 'ignore' keeps the speed so ultra is actually measured
const EMERGENCY = arg('emergency', 'ignore');
const b64 = readFileSync(file).toString('base64');

const server = await createServer({ root, logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1', hmr: false } });
await server.listen();
const runs = [];
let browserVersion = '', renderer = '';
try {
  for (let run = 0; run < RUNS; run++) {
    const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'] });
    browserVersion = browser.version();
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('metropolis.settings', JSON.stringify({ quality: 'ultra', v: 2 })); } catch {}
      const frames = (window.__pi1 = { busy: new Map(), longtasks: [] });
      const rAF = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => rAF((ts) => {
        const t = performance.now();
        try { cb(ts); } finally { frames.busy.set(ts, (frames.busy.get(ts) || 0) + performance.now() - t); }
      });
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) frames.longtasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000, polling: 250 });
    const tLoad = Date.now();
    await page.evaluate(async (b64) => {
      window.__ready = false;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const { importRegion } = await import('/src/save/index.ts');
      const r = await importRegion(new Blob([bytes]));
      await window.__metropolis.continueInCity(r, r.tiles.find((t) => t.city).key);
    }, b64);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000, polling: 250 });
    const loadS = (Date.now() - tLoad) / 1000;
    renderer = await page.evaluate(() => { const gl = window.__metropolis.city.scene.worldView.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; });
    // settle paused for 5 s (paused-city baseline frames), then run at speed 3 for DAYS days
    const r = await page.evaluate(async ([DAYS, EMERGENCY]) => {
      const sc = window.__metropolis.city.scene, P = window.__pi1, st = sc.sim.state;
      sc.applySettings({ emergencyUncovered: EMERGENCY });
      const speedChanges = [];
      let tRun = -1;
      sc.sim.events.on('speedChanged', (s) => { if (tRun >= 0) speedChanges.push([+((performance.now() - tRun) / 1000).toFixed(2), st.day, s]); });
      const stat = (xs) => { const s = xs.slice().sort((a, b) => a - b), q = (k) => +s[Math.min(s.length - 1, Math.floor(k * s.length))].toFixed(2); return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over16_7: s.filter((x) => x > 16.7).length, over33: s.filter((x) => x > 33.3).length }; };
      sc.sim.speed = 0;
      await new Promise((res) => setTimeout(res, 3000));
      P.busy.clear(); P.longtasks.length = 0;
      await new Promise((res) => setTimeout(res, 5000));
      const paused = stat([...P.busy.values()]);
      P.busy.clear(); P.longtasks.length = 0;
      const d0 = st.day, pop0 = st.stats.population, t0 = performance.now();
      sc.sim.speed = 3;
      tRun = t0;
      await new Promise((res) => { const f = () => (st.day - d0 >= DAYS || performance.now() - t0 > 600000 ? res() : setTimeout(f, 50)); f(); });
      const wallS = (performance.now() - t0) / 1000, days = st.day - d0;
      sc.sim.speed = 0;
      const busy = [...P.busy.values()];
      const lt = P.longtasks.filter(([s]) => s >= t0);
      return {
        day0: d0, days, wallS: +wallS.toFixed(2), daysPerS: +(days / wallS).toFixed(2), pop0, pop1: st.stats.population,
        frames: busy.length, busy: stat(busy), busySumPerDay: +(busy.reduce((a, b) => a + b, 0) / days).toFixed(2),
        longTasks: { n: lt.length, max: lt.length ? +Math.max(...lt.map((x) => x[1])).toFixed(0) : 0, sumMs: Math.round(lt.reduce((a, x) => a + x[1], 0)) },
        paused, emergencyUncovered: EMERGENCY, speedChanges,
      };
    }, [DAYS, EMERGENCY]);
    runs.push({ run, loadS, ...r, errors });
    console.log(JSON.stringify({ run, loadS, daysPerS: r.daysPerS, busy: r.busy, longTasks: r.longTasks, paused: r.paused, speedChanges: r.speedChanges }));
    await browser.close();
  }
} finally {
  await server.close();
}
const med = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const summary = {
  fixture: file, days: DAYS, runs: RUNS, browser: browserVersion, renderer, quality: 'ultra', speed: 3, viewport: '1920x1080', headless: true, emergencyUncovered: EMERGENCY,
  median: {
    daysPerS: med(runs.map((r) => r.daysPerS)), busyP50: med(runs.map((r) => r.busy.p50)), busyP99: med(runs.map((r) => r.busy.p99)),
    busyMax: med(runs.map((r) => r.busy.max)), busyMsPerSimDay: med(runs.map((r) => r.busySumPerDay)), longTasks: med(runs.map((r) => r.longTasks.n)),
    longTaskMax: med(runs.map((r) => r.longTasks.max)), pausedP99: med(runs.map((r) => r.paused.p99)),
  },
  runsDetail: runs,
};
console.log(JSON.stringify(summary.median));
if (OUT) writeFileSync(OUT, JSON.stringify(summary, null, 1));
