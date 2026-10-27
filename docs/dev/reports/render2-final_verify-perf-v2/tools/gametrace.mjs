// attribution of the first frames on the REAL load path: same flow as game.mjs, with a Chrome trace (CDP Tracing)
// from the Continue click to frame K after viewsReady; prints the renderer main thread's top-level work per frame
// (thread time) and the biggest events inside frames 1..6.  node gametrace.mjs <side> <q> <out.json> [K]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, serverUrl, guard, TOOLS, sleep } from './lib.mjs';

const [side, q, outFile, K0 = '12'] = process.argv.slice(2);
const K = +K0;
const INIT = readFileSync(resolve(TOOLS, 'gameinit.js'), 'utf8');
const { browser, pid } = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(`${serverUrl(side)}/seed.html?q=${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__seeded, null, { timeout: 300000 });
  await page.addInitScript({ content: 'window.__noDraw = true; window.__drawOn = false;' });
  await page.addInitScript({ content: INIT });
  await page.goto(`${serverUrl(side)}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  await sleep(1500);
  guard(pid);
  const cdp = await ctx.newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', (d) => events.push(...d.value));
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', { traceConfig: { includedCategories: (process.env.CATS ?? 'devtools.timeline,v8,disabled-by-default-v8.gc,toplevel').split(','), recordMode: 'recordAsMuchAsPossible' }, transferMode: 'ReportEvents' });
  await page.click('button.menu-item.primary', { timeout: 60000 });
  await page.waitForFunction((k) => window.__worldAt >= 0 && window.__frames.length > window.__worldAt + k + 2, K, { timeout: 600000, polling: 100 });
  await cdp.send('Tracing.end');
  await done;
  const D = await page.evaluate(() => ({ F: window.__frames, w: window.__worldAt, origin: performance.timeOrigin }));
  writeFileSync(outFile, JSON.stringify({ D, events }));
  // main thread of the page's renderer: the thread named CrRendererMain with the most events
  const names = events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  const cnt = new Map();
  for (const e of events) { const k = e.pid + ':' + e.tid; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
  const main = names.map((n) => n.pid + ':' + n.tid).sort((a, b) => (cnt.get(b) ?? 0) - (cnt.get(a) ?? 0))[0];
  const ev = events.filter((e) => e.pid + ':' + e.tid === main && e.ph === 'X');
  // trace clock (us) -> epoch ms: align with the frame starts via the first 'FireAnimationFrame' after F[w]
  const fafs = ev.filter((e) => e.name === 'FireAnimationFrame').map((e) => e.ts).sort((a, b) => a - b);
  // find offset so that rAF events line up with the page's frame start times (F, epoch ms)
  let best = null;
  for (const f of fafs.slice(0, 400)) {
    const off = D.F[D.w] - f / 1000; // candidate: this rAF event is frame 1
    let err = 0;
    for (let k = 1; k < 8; k++) { const t = (D.F[D.w + k] - off) * 1000; const near = fafs.reduce((m, x) => Math.min(m, Math.abs(x - t)), 1e12); err += near; }
    if (!best || err < best.err) best = { off, err };
  }
  const toEpoch = (ts) => ts / 1000 + best.off;
  const top = ev.filter((e) => e.name === 'ThreadControllerImpl::RunTask' || e.name === 'RunTask');
  console.log(`side ${side} q ${q}: ${events.length} events, main ${main}, align err ${(best.err / 1000).toFixed(2)} ms`);
  for (let k = 0; k < K; k++) {
    const a = D.F[D.w + k], b = D.F[D.w + k + 1];
    const inF = ev.filter((e) => toEpoch(e.ts) >= a && toEpoch(e.ts) < b);
    const tops = top.filter((e) => toEpoch(e.ts) >= a && toEpoch(e.ts) < b);
    const tt = tops.reduce((s, e) => s + (e.tdur ?? e.dur ?? 0), 0) / 1000;
    const agg = new Map();
    for (const e of inF) {
      if (e.name === 'ThreadControllerImpl::RunTask' || e.name === 'RunTask') continue;
      const key = e.name + (e.args?.data?.functionName ? ':' + e.args.data.functionName : '') + (e.args?.data?.url ? ' ' + String(e.args.data.url).split('/').pop() : '');
      agg.set(key, (agg.get(key) ?? 0) + (e.tdur ?? e.dur ?? 0) / 1000);
    }
    const tops2 = [...agg.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([n, v]) => `${n} ${v.toFixed(1)}`).join(' | ');
    console.log(`frame ${k + 1}: tasks thread-time ${tt.toFixed(1)} ms (${tops.length} tasks) :: ${tops2}`);
  }
} finally {
  await browser.close();
}
