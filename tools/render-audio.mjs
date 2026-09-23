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
import { mkdirSync, writeFileSync, openSync, writeSync, closeSync, readFileSync, readdirSync } from 'node:fs';
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
const marker = `--audio-lab-${process.pid}-${Date.now()}`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--disable-gpu', marker] });

/** CPU seconds (user+sys) used so far by the launched browser and all its child processes (Linux /proc) */
const TICK = 100; // USER_HZ
function browserCpuSec() {
  try {
    const procs = new Map();
    let rootPid = null;
    for (const d of readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const st = readFileSync(`/proc/${d}/stat`, 'utf8');
        const rp = st.lastIndexOf(')');
        const f = st.slice(rp + 2).split(' ');
        procs.set(+d, { ppid: +f[1], cpu: (+f[11] + +f[12]) / TICK });
        if (rootPid === null && readFileSync(`/proc/${d}/cmdline`, 'utf8').includes(marker)) rootPid = +d;
      } catch {
        /* process vanished */
      }
    }
    if (rootPid === null) return NaN;
    const tree = new Set([rootPid]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [pid, p] of procs) if (!tree.has(pid) && tree.has(p.ppid)) (tree.add(pid), (grew = true));
    }
    let sum = 0;
    const detail = [];
    for (const pid of tree) {
      sum += procs.get(pid)?.cpu ?? 0;
      if (process.env.LAB_CPU_DETAIL) {
        let type = 'browser';
        try {
          type = /--type=([a-z-]+)/.exec(readFileSync(`/proc/${pid}/cmdline`, 'utf8'))?.[1] ?? 'browser';
        } catch {
          /* ignore */
        }
        detail.push(`${pid}:${type}=${procs.get(pid)?.cpu}`);
      }
    }
    if (detail.length) console.log('CPU ' + detail.join(' '));
    return sum;
  } catch {
    return NaN;
  }
}
let failed = false;
try {
  for (let i = 0; i < rest.length; i += 2) {
    const query = rest[i];
    const out = resolve(root, rest[i + 1]);
    mkdirSync(dirname(out), { recursive: true });
    const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    let cpuA = NaN, cpuB = NaN;
    p.on('console', (m) => {
      const t = m.text();
      if (t === 'LAB_RENDER_START') return void (cpuA = browserCpuSec());
      if (t === 'LAB_RENDER_END') return void (cpuB = browserCpuSec());
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
    const audioSec = result.mode === 'track' ? result.window[1] - result.window[0] : result.analyzedSec;
    if (isFinite(cpuA) && isFinite(cpuB)) {
      result.renderCpuSec = Math.round((cpuB - cpuA) * 100) / 100;
      // fraction of ONE core the song needs when played in real time (offline render work / audio length)
      result.cpuRealtimeFraction = Math.round(((cpuB - cpuA) / Math.max(0.1, audioSec)) * 1000) / 1000;
    }
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
