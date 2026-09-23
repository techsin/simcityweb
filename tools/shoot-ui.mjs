#!/usr/bin/env node
/**
 * Screenshot helper for the game UI dev page (demo-ui.html). Copy of tools/shoot.mjs targeting the UI demo.
 *
 * Usage:
 *   node tools/shoot-ui.mjs <query> <out.png> [<query> <out.png> ...]
 *     query = URL query string without '?', e.g. "town=1&panel=budget"  (see src/ui/demo.ts for params)
 *     Special query params read by this tool (not passed on): _w=<px> _h=<px> viewport, _wait=<ms> extra wait,
 *     _dpr=<n> device scale factor.
 * Example:
 *   node tools/shoot-ui.mjs "fake=1&panel=budget" shots/ui/budget.png "tool=road&drag=60,60,70,64" shots/ui/road.png
 *
 * Starts its own Vite dev server, waits for window.__ready (up to 180 s), saves viewport PNGs, prints console errors.
 * Env: SHOOT_W / SHOOT_H default viewport (1600x900), SHOOT_WAIT extra ms after ready.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rest = process.argv.slice(2);
if (rest.length < 2 || rest.length % 2) {
  console.error('usage: node tools/shoot-ui.mjs <query> <out.png> [...]');
  process.exit(1);
}

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const addr = server.httpServer.address();
const base = `http://127.0.0.1:${addr.port}/demo-ui.html`;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
});
try {
  for (let i = 0; i < rest.length; i += 2) {
    const params = new URLSearchParams(rest[i]);
    const out = resolve(root, rest[i + 1]);
    mkdirSync(dirname(out), { recursive: true });
    const vw = parseInt(params.get('_w') ?? process.env.SHOOT_W ?? '1600', 10);
    const vh = parseInt(params.get('_h') ?? process.env.SHOOT_H ?? '900', 10);
    const dpr = parseFloat(params.get('_dpr') ?? '1');
    const extra = parseInt(params.get('_wait') ?? process.env.SHOOT_WAIT ?? '0', 10);
    for (const k of ['_w', '_h', '_wait', '_dpr']) params.delete(k);
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
    const p = await ctx.newPage();
    p.on('console', (m) => {
      const t = m.text();
      if (m.type() === 'error' || m.type() === 'warning' || t.startsWith('[')) console.log(`[console.${m.type()}] ${t.slice(0, 3000)}`);
    });
    p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
    const t0 = Date.now();
    await p.goto(`${base}?${params.toString()}`, { waitUntil: 'load', timeout: 120000 });
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000, polling: 250 }).catch(() => console.log('WARN: __ready not set within timeout'));
    if (extra) await p.waitForTimeout(extra);
    await p.screenshot({ path: out });
    console.log(`saved ${out} (${Date.now() - t0} ms)`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
