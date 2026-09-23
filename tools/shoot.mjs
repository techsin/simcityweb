#!/usr/bin/env node
/**
 * Screenshot helper for visual review (asset gallery or the game itself).
 *
 * Usage:
 *   node tools/shoot.mjs <page> <query> <out.png> [<query> <out.png> ...]
 *     page  = gallery | game   (gallery.html or index.html)
 *     query = URL query string without '?', e.g.  "group=residential&variants=first"
 * Example:
 *   node tools/shoot.mjs gallery "model=res_cottage" shots/cottage.png "model=res_cottage&night=1" shots/cottage_night.png
 *
 * Starts its own Vite dev server on a free port, waits for window.__ready (up to 90 s), saves full-page PNGs,
 * prints console errors and GALLERY_STATS lines.
 * Env: SHOOT_W / SHOOT_H viewport for game pages (default 1600x900). SHOOT_WAIT extra ms to wait after ready.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [page, ...rest] = process.argv.slice(2);
if (!page || rest.length < 2 || rest.length % 2) {
  console.error('usage: node tools/shoot.mjs <gallery|game> <query> <out.png> [...]');
  process.exit(1);
}
const file = page === 'game' ? 'index.html' : 'gallery.html';

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const addr = server.httpServer.address();
const base = `http://127.0.0.1:${addr.port}/${file}`;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
});
try {
  for (let i = 0; i < rest.length; i += 2) {
    const query = rest[i];
    const out = resolve(root, rest[i + 1]);
    mkdirSync(dirname(out), { recursive: true });
    const vw = parseInt(process.env.SHOOT_W ?? '1600', 10), vh = parseInt(process.env.SHOOT_H ?? '900', 10);
    const p = await browser.newPage({ viewport: { width: vw, height: vh } });
    p.on('console', (m) => {
      const t = m.text();
      if (m.type() === 'error' || m.type() === 'warning' || t.startsWith('GALLERY_STATS') || t.startsWith('[')) console.log(`[console.${m.type()}] ${t.startsWith('GALLERY_STATS') ? t : t.slice(0, 4000)}`);
    });
    p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
    const t0 = Date.now();
    await p.goto(`${base}?${query}`, { waitUntil: 'load', timeout: 300000 });
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 400000, polling: 250 }).catch(() => console.log('WARN: __ready not set within timeout'));
    const extra = parseInt(process.env.SHOOT_WAIT ?? '0', 10);
    if (extra) await p.waitForTimeout(extra);
    if (file === 'gallery.html') {
      const box = await p.evaluate(() => { const r = document.getElementById('wrap').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      await p.setViewportSize({ width: Math.max(vw, Math.ceil(box.x + box.width)), height: Math.max(vh, Math.ceil(box.y + box.height)) });
      await p.screenshot({ path: out, clip: box, timeout: 300000 });
    } else await p.screenshot({ path: out, timeout: 300000 });
    console.log(`saved ${out} (${Date.now() - t0} ms)`);
    await p.close();
  }
} finally {
  await browser.close();
  await server.close();
}
