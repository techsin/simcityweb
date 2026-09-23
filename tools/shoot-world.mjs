#!/usr/bin/env node
/**
 * Screenshot helper for the world renderer demo (demo-world.html).
 *
 * Usage:
 *   node tools/shoot-world.mjs <query> <out.png> [<query> <out.png> ...]
 *     query = URL query string without '?', e.g.  "time=18.6&terrain=coast&quality=high&dist=900&tilt=35"
 * Example:
 *   node tools/shoot-world.mjs "time=12" shots/world/noon.png "time=19.2" shots/world/sunset.png
 *
 * Starts its own Vite dev server on a free port, waits for window.__ready (up to 180 s), saves PNGs and prints
 * console errors / [world] lines. SwiftShader WebGL (slow but deterministic).
 * Env: SHOOT_W / SHOOT_H viewport (default 1280x720). SHOOT_WAIT extra ms to wait after ready.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rest = process.argv.slice(2);
if (rest.length < 2 || rest.length % 2) {
  console.error('usage: node tools/shoot-world.mjs <query> <out.png> [...]');
  process.exit(1);
}

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const addr = server.httpServer.address();
const base = `http://127.0.0.1:${addr.port}/demo-world.html`;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
});
try {
  for (let i = 0; i < rest.length; i += 2) {
    const query = rest[i];
    const out = resolve(root, rest[i + 1]);
    mkdirSync(dirname(out), { recursive: true });
    const vw = parseInt(process.env.SHOOT_W ?? '1280', 10), vh = parseInt(process.env.SHOOT_H ?? '720', 10);
    const p = await browser.newPage({ viewport: { width: vw, height: vh } });
    p.on('console', (m) => {
      const t = m.text();
      if (m.type() === 'error' || m.type() === 'warning' || t.startsWith('[')) console.log(`[console.${m.type()}] ${t.slice(0, 4000)}`);
    });
    p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
    const t0 = Date.now();
    await p.goto(`${base}?still=1&hud=0&${query}`, { waitUntil: 'load', timeout: 120000 });
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000, polling: 250 }).catch(() => console.log('WARN: __ready not set within timeout'));
    const extra = parseInt(process.env.SHOOT_WAIT ?? '0', 10);
    if (extra) await p.waitForTimeout(extra);
    await p.screenshot({ path: out, timeout: 240000 });
    console.log(`saved ${out} (${Date.now() - t0} ms)`);
    await p.close();
  }
} finally {
  await browser.close();
  await server.close();
}
