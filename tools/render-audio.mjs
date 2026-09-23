#!/usr/bin/env node
/**
 * Offline audio render + analysis via the audio lab page (audio-lab.html / src/audio/lab/main.ts).
 *
 * Usage:
 *   node tools/render-audio.mjs "<query>" <out.png> ["<query>" <out.png> ...]
 *     query = audio-lab URL query without '?':
 *       track=<id>[&seed=S][&seconds=N][&from=T]   whole song by default; from/seconds render an excerpt
 *       sfx=<name>|all                             UI / game one-shots
 *       inst=<name>[,<name>...]|all                instrument demo phrases
 *     add wav=1 to also write <out>.wav (16-bit stereo 44.1 kHz) next to the PNG
 * Examples:
 *   node tools/render-audio.mjs "track=sunday_jazz&seed=3" shots/audio/jazz.png
 *   node tools/render-audio.mjs "track=sunday_jazz&seed=3&from=60&seconds=60&wav=1" shots/audio/jazz_60.png
 *   node tools/render-audio.mjs "inst=all" shots/audio/inst.png "sfx=all" shots/audio/sfx.png
 *
 * Starts its own Vite dev server, opens chromium with --autoplay-policy=no-user-gesture-required, waits for
 * window.__ready (up to 20 min), saves the lab canvas as PNG, writes <out>.json with the full stats and prints a
 * compact "RESULT <json>" line per query (arrays trimmed). Exit code 1 if any render failed.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rest = process.argv.slice(2);
if (rest.length < 2 || rest.length % 2) {
  console.error('usage: node tools/render-audio.mjs "<query>" <out.png> [...]');
  process.exit(1);
}

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const addr = server.httpServer.address();
const base = `http://127.0.0.1:${addr.port}/audio-lab.html`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-gpu'] });
let failed = false;
try {
  for (let i = 0; i < rest.length; i += 2) {
    const query = rest[i];
    const out = resolve(root, rest[i + 1]);
    mkdirSync(dirname(out), { recursive: true });
    const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    p.on('console', (m) => {
      const t = m.text();
      if (t.startsWith('LAB_RESULT')) return;
      if (m.type() === 'error' || m.type() === 'warning' || t.startsWith('[')) console.log(`[console.${m.type()}] ${t.slice(0, 2000)}`);
    });
    p.on('pageerror', (e) => console.log(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
    const t0 = Date.now();
    await p.goto(`${base}?${query}`, { waitUntil: 'load', timeout: 300000 });
    const ok = await p.waitForFunction(() => window.__ready === true, null, { timeout: 1200000, polling: 500 }).then(() => true, () => false);
    if (!ok) {
      console.log(`FAIL ${query}: __ready not set within timeout`);
      failed = true;
      await p.close();
      continue;
    }
    const err = await p.evaluate(() => window.__error ?? null);
    if (err) {
      console.log(`FAIL ${query}:\n${err}`);
      failed = true;
      await p.close();
      continue;
    }
    const canvas = await p.$('#lab');
    if (canvas) await canvas.screenshot({ path: out, timeout: 300000 });
    else await p.screenshot({ path: out, fullPage: true });
    const result = await p.evaluate(() => window.__result);
    writeFileSync(out.replace(/\.png$/i, '') + '.json', JSON.stringify(result, null, 1));
    const compact = { ...result };
    for (const k of Object.keys(compact)) if (Array.isArray(compact[k]) && compact[k].length > 24 && typeof compact[k][0] !== 'object') compact[k] = `[${compact[k].length} values]`;
    console.log(`RESULT ${JSON.stringify(compact)}`);
    if (/(^|&)wav=1(&|$)/.test(query)) {
      const info = await p.evaluate(() => window.__wavInfo);
      const wavPath = out.replace(/\.png$/i, '') + '.wav';
      const fd = openSync(wavPath, 'w');
      for (let c = 0; c < info.chunks; c++) {
        const b64 = await p.evaluate((k) => window.__wavChunk(k), c);
        writeSync(fd, Buffer.from(b64, 'base64'));
      }
      closeSync(fd);
      console.log(`wav ${wavPath} (${(info.bytes / 1e6).toFixed(1)} MB)`);
    }
    console.log(`saved ${out} (${Date.now() - t0} ms)`);
    await p.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
