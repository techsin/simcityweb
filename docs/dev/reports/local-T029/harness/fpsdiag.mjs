#!/usr/bin/env node
// T029 harness diagnostic: frames per second on SwiftShader for a few render configurations (paused, then ultra)
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
const [ROOT, REGION, OUT] = process.argv.slice(2);
const NM = '/home/user/simcityweb/node_modules';
const { createServer } = await import(`${NM}/vite/dist/node/index.js`);
const { chromium } = await import(`${NM}/playwright/index.mjs`);
const cacheDir = resolve(OUT, `.vite-diag-${process.pid}`);
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, cacheDir, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const port = server.httpServer.address().port;
const b64 = readFileSync(REGION).toString('base64');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
try {
  for (const cfg of [{ dsf: 1, zoom: 0 }, { dsf: 0.5, zoom: 0 }, { dsf: 0.5, zoom: 8 }, { dsf: 0.25, zoom: 8 }]) {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: cfg.dsf });
    await ctx.addInitScript(() => {
      localStorage.setItem('metropolis.settings.v1', JSON.stringify({ quality: 'low', autosaveMonths: 0, masterVolume: 0, pauseWhenHidden: false, newYear: 'off', yearReview: false, tips: false, cameraMoments: false }));
      localStorage.setItem('metropolis.settings', JSON.stringify({ quality: 'low', autosaveMonths: 0, v: 3 }));
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(0);
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { polling: 500 });
    await page.evaluate(async (b64) => {
      window.__ready = false;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const { importRegion } = await import('/src/save/index.ts');
      const r = await importRegion(new Blob([bytes]));
      void window.__metropolis.continueInCity(r, r.tiles.find((t) => t.city).key);
    }, b64);
    await page.waitForFunction(() => { const sc = window.__metropolis?.city?.scene; return !!(window.__ready && sc && sc.host.actions); }, null, { polling: 1000 });
    const box = await page.locator('.speed button[title="Pause (Space)"]').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    if (cfg.zoom) { await page.mouse.move(480, 300); for (let k = 0; k < cfg.zoom; k++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(300); } }
    await page.waitForTimeout(3000);
    const measure = (ms) => page.evaluate(async (ms) => {
      const sc = window.__metropolis.city.scene; let n = 0; const d0 = sc.sim.state.day; const t0 = performance.now();
      await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      const s = (performance.now() - t0) / 1000;
      const c = document.querySelector('canvas');
      return { fps: +(n / s).toFixed(2), daysPerS: +((sc.sim.state.day - d0) / s).toFixed(2), speed: sc.sim.speed, buf: c ? [c.width, c.height] : null };
    }, ms);
    const paused = await measure(10000);
    const ub = await page.locator('.speed button[title="Ultra (3)"]').boundingBox();
    await page.mouse.click(ub.x + ub.width / 2, ub.y + ub.height / 2);
    const ultra = await measure(15000);
    await page.screenshot({ path: resolve(OUT, `diag-dsf${cfg.dsf}-z${cfg.zoom}.png`) });
    log(JSON.stringify({ cfg, paused, ultra }));
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
  rmSync(cacheDir, { recursive: true, force: true });
}
