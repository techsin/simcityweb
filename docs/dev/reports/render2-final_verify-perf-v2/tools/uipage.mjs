// ui page (demo-ui.html?town=1, the full CityScene with its own frame loop). The camera plan runs through the
// gameinit.js hook (window.__scene); per-segment and per-frame CPU from the poller over the hook's frame marks.
//   fresh: node uipage.mjs fresh <side> <q> <outfile> <tag> <segs csv>                      (one fresh browser)
//   warm:  node uipage.mjs warm <q> <outfile> <tag> <rows> <segs csv> <label:side,...>      (one browser per label)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, pickRenderer, rendererPids, gpuPid, serverUrl, loadavg, guard, startPoller, frameCpu, cpuAt, appendJsonl, TOOLS, threadCpu, procCpu, sleep } from './lib.mjs';

const INIT = readFileSync(resolve(TOOLS, 'gameinit.js'), 'utf8');
const [mode, ...rest] = process.argv.slice(2);
const UIQ = (q) => `town=1&days=${process.env.UIDAYS ?? 30}&speed=0&quality=${q}&onboard=0&f1=3&frames=3`;

async function openPage(side, q) {
  const { browser, pid } = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 300)));
  const DRAW = process.env.DRAW ?? 'nodraw';
  if (DRAW === 'nodraw') await page.addInitScript({ content: 'window.__noDraw = true; window.__drawOn = false;' });
  else if (DRAW === 'scissor') await page.addInitScript({ content: 'window.__scissor = true;' });
  await page.addInitScript({ content: 'window.__keepCamera = true; window.__reanchor = true;' });
  await page.addInitScript({ content: INIT });
  await page.goto(`${serverUrl(side)}/blank.html`, { waitUntil: 'load' });
  guard(pid);
  return { browser, pid, page, errs };
}

function segStats(poll, k, D, marks) {
  const out = {};
  for (let j = 0; j < marks.length; j++) {
    const m = marks[j];
    if (m.name === 'end') continue;
    const i0 = m.i, i1 = marks[j + 1].i;
    const per = frameCpu(poll, k, D.F.slice(i0, i1), D.F[i1]);
    const R = D.R.filter((r) => r.i >= i0 && r.i < i1);
    // phase CPU (poller CPU between the in-page phase timestamps; as game.mjs): lcpu = the scene's frame callback
    let lcpu = 0;
    const ph = { wu: 0, ou: 0, wr: 0, wm: 0, su: 0 };
    for (const r of R) {
      const ts = r.ts || [];
      for (let q = 0; q < ts.length; q += 3) {
        const c = cpuAt(poll, k, ts[q + 2]) - cpuAt(poll, k, ts[q + 1]);
        if (ts[q] === 'lp') lcpu += c;
        else if (ts[q] in ph) ph[ts[q]] += c;
      }
    }
    for (const x in ph) ph[x] = +ph[x].toFixed(2);
    out[m.name] = {
      lcpu: +lcpu.toFixed(2), ph,
      n: i1 - i0, cpu: +per.reduce((a, b) => a + b, 0).toFixed(2), max: +Math.max(...per).toFixed(2), over16: per.filter((x) => x > 16.7).length, over33: per.filter((x) => x > 33.3).length,
      per: per.map((x) => +x.toFixed(1)), wu: +R.reduce((a, r) => a + r.wu, 0).toFixed(1), wr: +R.reduce((a, r) => a + r.wr, 0).toFixed(1), ou: +R.reduce((a, r) => a + r.ou, 0).toFixed(1), su: +R.reduce((a, r) => a + r.su, 0).toFixed(1),
      calls: R.reduce((a, r) => a + (r.calls || 0), 0), tris: R.reduce((a, r) => a + (r.tris || 0), 0),
    };
  }
  return out;
}

if (mode === 'fresh') {
  const [side, q, outFile, tag, segCsv] = rest;
  const rec = { tag, side, q, kind: 'ui', load0: loadavg(), t: new Date().toISOString() };
  const P = await openPage(side, q);
  let poller = null;
  try {
    const rall = rendererPids(P.pid);
    poller = startPoller(rall.map((p) => `/proc/${p}/task/${p}/schedstat`), tag, 400, 1500);
    const t0c = Object.fromEntries(rall.map((p) => [p, threadCpu(p)]));
    const tNav = Date.now();
    await P.page.goto(`${serverUrl(side)}/demo-ui.html?${UIQ(q)}`, { waitUntil: 'load', timeout: 300000 });
    await P.page.waitForFunction(() => window.__ready === true, null, { timeout: 900000, polling: 100 });
    rec.readyMs = Date.now() - tNav;
    const rpid = pickRenderer(P.pid);
    rec.rk = rall.indexOf(rpid);
    rec.sameRenderer = rec.rk >= 0;
    rec.loadCpu = (threadCpu(rpid) - (t0c[rpid] ?? 0)) / 1e6;
    const marks = await P.page.evaluate((n) => window.__gameHook.run(n), segCsv.split(','));
    await P.page.waitForFunction(() => window.__frames.length > window.__gameHook.done + 2, null, { timeout: 600000, polling: 100 });
    const D = await P.page.evaluate(() => ({ F: window.__frames, R: window.__frec, worldAt: window.__worldAt, heap: performance.memory ? performance.memory.usedJSHeapSize : 0, b: window.__scene.sim.state.buildings.size }));
    const poll = await poller.stop();
    poller = null;
    rec.segs = rec.rk >= 0 ? segStats(poll, rec.rk, D, marks) : {};
    rec.buildings = D.b;
    rec.errors = P.errs.slice(0, 8);
  } catch (e) {
    rec.error = String(e && e.stack || e).slice(0, 2000);
  } finally {
    if (poller) await poller.stop().catch(() => {});
    await P.browser.close().catch(() => {});
  }
  rec.load1 = loadavg();
  appendJsonl(outFile, rec);
  console.log(JSON.stringify({ tag, side, q, ready: rec.readyMs, err: rec.error?.slice(0, 300), segs: Object.fromEntries(Object.entries(rec.segs ?? {}).map(([k, v]) => [k, v.cpu])) }));
} else if (mode === 'warm') {
  const [q, outFile, tag, rowsS, segCsv, labelCsv] = rest;
  const rows = +rowsS, segs = segCsv.split(','), labels = labelCsv.split(',').map((s) => { const [l, side] = s.split(':'); return { l, side }; });
  const pages = [];
  let poller = null;
  const t0 = Date.now();
  try {
    for (const L of labels) {
      const P = await openPage(L.side, q);
      await P.page.goto(`${serverUrl(L.side)}/demo-ui.html?${UIQ(q)}`, { waitUntil: 'load', timeout: 300000 });
      await P.page.waitForFunction(() => window.__ready === true, null, { timeout: 900000, polling: 200 });
      guard(P.pid);
      P.rpid = pickRenderer(P.pid);
      pages.push({ ...L, ...P });
      console.log(`[ui-warm] ${L.l} ready ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    for (const P of pages) await P.page.evaluate((n) => window.__gameHook.run(n), segs); // warm-up pass
    poller = startPoller(pages.map((P) => `/proc/${P.rpid}/task/${P.rpid}/schedstat`), tag, 500, 7200);
    const runs = [];
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < segs.length; k++) {
        const order = pages.map((_, i) => pages[(i + r + k) % pages.length]);
        for (const P of order) {
          const marks = await P.page.evaluate((n) => window.__gameHook.run(n), [segs[k]]);
          await P.page.waitForFunction(() => window.__frames.length > window.__gameHook.done + 2, null, { timeout: 600000, polling: 50 });
          runs.push({ r, seg: segs[k], P, marks: marks.slice(-2), la: loadavg()[0] });
        }
      }
      console.log(`[ui-warm] row ${r + 1}/${rows} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    const poll = await poller.stop();
    poller = null;
    const Ds = new Map();
    for (const P of pages) Ds.set(P, await P.page.evaluate(() => ({ F: window.__frames, R: window.__frec })));
    for (const x of runs) {
      const k = pages.indexOf(x.P);
      const st = segStats(poll, k, Ds.get(x.P), x.marks)[x.seg];
      appendJsonl(outFile, { tag, q, kind: 'uiwarm', row: x.r, seg: x.seg, label: x.P.l, side: x.P.side, la: x.la, ...st });
    }
  } catch (e) {
    console.log('[ui-warm] error ' + String(e && e.stack || e).slice(0, 1500));
    appendJsonl(outFile, { tag, q, kind: 'uiwarm', error: String(e && e.stack || e).slice(0, 1500) });
  } finally {
    if (poller) await poller.stop().catch(() => {});
    for (const P of pages) await P.browser.close().catch(() => {});
  }
  console.log(`[ui-warm] done ${tag} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
