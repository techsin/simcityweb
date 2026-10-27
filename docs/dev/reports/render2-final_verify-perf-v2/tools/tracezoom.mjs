// attribution of the real load path's first zoom-out: the same flow as game.mjs (seed, menu, Continue, 40 frames, street)
// with a Chrome trace (CDP Tracing) around the first zoom-out only; prints the renderer main thread's work in that
// window by top-level task kind and by the biggest nested events / JS functions (thread time where the trace has it).
//   node tracezoom.mjs <side> <q> <out.json> [seg]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, serverUrl, guard, TOOLS, sleep } from './lib.mjs';

const [side, q, outFile, SEG = 'zoomout'] = process.argv.slice(2);
const INIT = readFileSync(resolve(TOOLS, 'gameinit.js'), 'utf8');
const { browser, pid } = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(`${serverUrl(side)}/seed.html?q=${q}`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__seeded, null, { timeout: 300000 });
  await page.addInitScript({ content: 'window.__noDraw = true; window.__drawOn = false;' });
  if (process.env.NOAUDIO === '1') await page.addInitScript({ content: 'window.AudioContext = undefined; window.webkitAudioContext = undefined;' });
  await page.addInitScript({ content: INIT });
  await page.goto(`${serverUrl(side)}/index.html`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  await sleep(1500);
  guard(pid);
  await page.click('button.menu-item.primary', { timeout: 60000 });
  await page.waitForFunction(() => window.__worldAt >= 0 && window.__frames.length > window.__worldAt + 42, null, { timeout: 600000, polling: 100 });
  await page.evaluate(() => window.__gameHook.run(['street']));
  const cdp = await ctx.newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', (d) => events.push(...d.value));
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['devtools.timeline', 'v8', 'disabled-by-default-v8.gc', 'toplevel', 'blink', 'cc', 'disabled-by-default-devtools.timeline'], recordMode: 'recordAsMuchAsPossible' }, transferMode: 'ReportEvents' });
  const t0 = await page.evaluate(() => performance.timeOrigin + performance.now());
  await page.evaluate((s) => window.__gameHook.run([s]), SEG);
  const t1 = await page.evaluate(() => performance.timeOrigin + performance.now());
  await cdp.send('Tracing.end');
  await done;
  writeFileSync(outFile, JSON.stringify({ t0, t1, events }));
  const names = events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  const cnt = new Map();
  for (const e of events) { const k = e.pid + ':' + e.tid; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
  const main = names.map((n) => n.pid + ':' + n.tid).sort((a, b) => (cnt.get(b) ?? 0) - (cnt.get(a) ?? 0))[0];
  const ev = events.filter((e) => e.pid + ':' + e.tid === main && e.ph === 'X');
  const T = (e) => (e.tdur ?? e.dur ?? 0) / 1000;
  const top = ev.filter((e) => e.name === 'ThreadControllerImpl::RunTask' || e.name === 'RunTask');
  const tot = top.reduce((s, e) => s + T(e), 0);
  // classify each top-level task by its biggest direct child kind
  const byKind = new Map(), byFn = new Map(), byEv = new Map();
  const sorted = ev.slice().sort((a, b) => a.ts - b.ts);
  const lb = (x) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m].ts < x) lo = m + 1; else hi = m; } return lo; };
  for (const t of top) {
    const end = t.ts + (t.dur ?? 0);
    let best = null;
    for (let i = lb(t.ts); i < sorted.length && sorted[i].ts <= end; i++) {
      const k = sorted[i];
      if (k === t || k.name === 'ThreadControllerImpl::RunTask' || k.name === 'RunTask' || k.ts + (k.dur ?? 0) > end) continue;
      if (!best || (k.dur ?? 0) > (best.dur ?? 0)) best = k;
    }
    const kind = best ? best.name + (best.args?.data?.functionName ? ':' + best.args.data.functionName : '') + (best.args?.data?.url ? ' ' + String(best.args.data.url).split('/').pop().split('?')[0] : '') : '(no child)';
    byKind.set(kind, (byKind.get(kind) ?? 0) + T(t));
  }
  for (const e of ev) {
    if (e.name === 'ThreadControllerImpl::RunTask' || e.name === 'RunTask') continue;
    const key = e.name + (e.args?.data?.functionName ? ':' + e.args.data.functionName : '') + (e.args?.data?.url ? ' ' + String(e.args.data.url).split('/').pop().split('?')[0] : '');
    byEv.set(key, (byEv.get(key) ?? 0) + T(e));
  }
  console.log(`side ${side} q ${q} seg ${SEG}: ${events.length} events, ${top.length} top-level tasks, thread time ${tot.toFixed(1)} ms over ${((t1 - t0) / 1000).toFixed(1)} s`);
  console.log('by task kind (biggest child):');
  for (const [k, v] of [...byKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`  ${v.toFixed(1).padStart(8)}  ${k}`);
  console.log('by event (inclusive, nested events counted in each):');
  for (const [k, v] of [...byEv.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  ${v.toFixed(1).padStart(8)}  ${k}`);
  void byFn;
} finally {
  await browser.close();
}
