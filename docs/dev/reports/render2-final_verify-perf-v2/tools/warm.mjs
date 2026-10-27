// WARM pages: one browser per label (two labels per version = A/A copies), each page loaded once and warmed with one
// full pass of the segments (discarded); then `rows` rows, each segment run on every page in a rotated order
// (interleaved per segment). CPU per segment from schedstat snapshots; per-frame CPU from one poller over all pages.
//   node warm.mjs <scene> <q> <outfile> <tag> <rows> <segs csv> <label:side,...> [extra url params] [mode]
// mode 'gpu': instead of moving segments, still views (segs = view names): settle, then K drawn frames with the shadow
// map forced, each measured alone (GPU-process CPU per drawn frame = the GPU stand-in).
import { launch, pickRenderer, gpuPid, serverUrl, loadavg, guard, startPoller, frameCpu, appendJsonl, snap, delta, sleep } from './lib.mjs';

const [scene, q, outFile, tag, rowsS, segCsv, labelCsv, extra = '', mode = 'cpu'] = process.argv.slice(2);
const rows = +rowsS, segs = segCsv.split(','), labels = labelCsv.split(',').map((s) => { const [l, side, ex = ''] = s.split(':'); return { l, side, ex }; });
const K = 4;
const pages = [];
let poller = null;
const t0 = Date.now();
try {
  for (const L of labels) {
    const { browser, pid } = await launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`[${L.l}] pageerror ${String(e.message).slice(0, 200)}`));
    await page.goto(`${serverUrl(L.side)}/${process.env.PAGE ?? "bench"}.html?scene=${scene}&q=${q}${extra ? '&' + extra : ''}${L.ex ? '&' + L.ex : ''}`, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000, polling: 200 });
    guard(pid);
    const c = { rpid: pickRenderer(pid), gpid: gpuPid(pid) };
    pages.push({ ...L, browser, page, c });
    console.log(`[warm] ${L.l} (${L.side}) ready ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  // warm-up pass (discarded)
  for (const P of pages) {
    if (mode === 'gpu') { for (const v of segs) { await P.page.evaluate((n) => window.__bench.still(n, 20), v); await P.page.evaluate(() => window.__bench.drawOne(true)); } }
    else for (const s of segs) await P.page.evaluate((n) => window.__bench.seg(n), s);
  }
  console.log(`[warm] warmed ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (mode === 'cpu') poller = startPoller(pages.map((P) => `/proc/${P.c.rpid}/task/${P.c.rpid}/schedstat`), tag, 500, 7200);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < segs.length; k++) {
      const name = segs[k];
      const order = pages.map((_, i) => pages[(i + r + k) % pages.length]);
      for (const P of order) {
        const la = loadavg()[0];
        if (mode === 'alloc') {
          // allocation per frame: V8's sampling heap profiler, collected objects included (minor + major GC)
          if (!P.cdp) P.cdp = await P.page.context().newCDPSession(P.page);
          await P.cdp.send('HeapProfiler.enable');
          await P.cdp.send('HeapProfiler.startSampling', { samplingInterval: 8192, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
          const res = await P.page.evaluate((n) => window.__bench.seg(n), name);
          const { profile } = await P.cdp.send('HeapProfiler.stopSampling');
          let tot = 0;
          const walk = (nd) => { tot += nd.selfSize; for (const c of nd.children ?? []) walk(c); };
          walk(profile.head);
          appendJsonl(outFile, { tag, scene, q, mode, row: r, seg: name, label: P.l, side: P.side, la, n: res.n, allocKB: tot / 1024 / res.n, samples: profile.samples?.length ?? 0 });
        } else if (mode === 'gpu') {
          const st = await P.page.evaluate((n) => window.__bench.still(n, 20), name);
          const fr = [];
          for (let j = 0; j < K; j++) {
            const a = snap(P.c);
            const f = await P.page.evaluate(() => window.__bench.drawOne(true));
            const b = snap(P.c);
            const d = delta(a, b);
            fr.push({ gpu: d.gpu, main: d.main, wall: d.wall, js: f.js, calls: f.calls, tris: f.tris, mt: f.mt, mc: f.mc, st: f.st, sc: f.sc });
          }
          appendJsonl(outFile, { tag, scene, q, mode, row: r, seg: name, label: P.l, side: P.side, la, still: st, fr });
        } else {
          const a = snap(P.c);
          const res = await P.page.evaluate((n) => window.__bench.seg(n, true), name);
          const b = snap(P.c);
          const d = delta(a, b);
          appendJsonl(outFile, {
            tag, scene, q, mode, row: r, seg: name, label: P.l, side: P.side, la, cpu: d.main, gpu: d.gpu, rproc: d.rproc, wall: d.wall,
            js: res.js, up: res.up, ob: res.ob, rn: res.rn, calls: res.calls, tris: res.tris, mc: res.mc, mt: res.mt, sc: res.sc, st: res.st, gd: res.gd, jsMax: res.jsMax, allocKB: res.allocKB,
            ft: res.frames.map((f) => f.t), t1: res.t1, pi: pages.indexOf(P),
          });
        }
      }
    }
    console.log(`[warm] row ${r + 1}/${rows} ${((Date.now() - t0) / 1000).toFixed(0)} s load ${loadavg()[0]}`);
  }
  const stats = [];
  for (const P of pages) stats.push({ label: P.l, side: P.side, stats: await P.page.evaluate(() => window.__bench.stats()), heapGC: await P.page.evaluate(() => window.__bench.gc()) });
  appendJsonl(outFile, { tag, scene, q, mode, final: true, stats });
} catch (e) {
  console.log('[warm] error ' + String(e && e.stack || e).slice(0, 1500));
  appendJsonl(outFile, { tag, scene, q, mode, error: String(e && e.stack || e).slice(0, 1500) });
} finally {
  if (poller) {
    const poll = await poller.stop().catch(() => null);
    if (poll && mode !== 'gpu') {
      // per-frame CPU for every moving row: rewrite as a side file of per-frame arrays
      const { readJsonl } = await import('./lib.mjs');
      const recs = readJsonl(outFile).filter((x) => x.tag === tag && x.ft);
      const outPer = outFile.replace(/\.jsonl$/, '') + `.${tag}.perframe.jsonl`;
      for (const x of recs) {
        const per = frameCpu(poll, x.pi, x.ft, x.t1);
        appendJsonl(outPer, { row: x.row, seg: x.seg, label: x.label, per: per.map((v) => +v.toFixed(2)) });
      }
    }
  }
  for (const P of pages) await P.browser.close().catch(() => {});
}
console.log(`[warm] done ${tag} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
