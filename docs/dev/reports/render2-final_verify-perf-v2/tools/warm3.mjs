// GPU stand-in ALONG moving sequences (bench3 page): one browser per label (two per version = A/A), each page loaded once
// and warmed with one full nodraw pass of the segments; then `rows` rows: every segment run frame by frame on every page
// (rotated order), drawing only the sampled frames (frame i drawn when i % every[seg] is in picks[seg]); the GPU process's
// CPU (and the renderer main thread's) is read around each drawn frame alone (the frame, then the next rAF + gl.finish).
//   node warm3.mjs <scene> <q> <outfile> <tag> <rows> <segs csv> <label:side,...> [extra url params]
import { launch, pickRenderer, gpuPid, serverUrl, loadavg, guard, appendJsonl, snap, delta } from './lib.mjs';

const [scene, q, outFile, tag, rowsS, segCsv, labelCsv, extra = ''] = process.argv.slice(2);
const rows = +rowsS, segs = segCsv.split(','), labels = labelCsv.split(',').map((s) => { const [l, side] = s.split(':'); return { l, side }; });
// sampled frames per segment: cuts = each cut's first frame and the one after it (0,1 of every 5); others every 5th / 10th
const SAMPLE = { cuts: [5, [0, 1]], edgefast: [5, [0]], fastpan: [5, [0]], edgepan: [10, [0]], edgeturn: [10, [0]], zoomout: [15, [0]], farorbit: [10, [0]], streetfast: [5, [0]] };
const drawn = (s, i) => { const [every, picks] = SAMPLE[s] ?? [10, [0]]; return picks.includes(i % every); };
const pages = [];
const t0 = Date.now();
try {
  for (const L of labels) {
    const { browser, pid } = await launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`[${L.l}] pageerror ${String(e.message).slice(0, 200)}`));
    await page.goto(`${serverUrl(L.side)}/bench3.html?scene=${scene}&q=${q}${extra ? '&' + extra : ''}`, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000, polling: 200 });
    guard(pid);
    const c = { rpid: pickRenderer(pid), gpid: gpuPid(pid) };
    pages.push({ ...L, browser, page, c });
    console.log(`[warm3] ${L.l} (${L.side}) ready ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  for (const P of pages) for (const s of segs) await P.page.evaluate((n) => window.__bench.seg(n), s);
  console.log(`[warm3] warmed ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < segs.length; k++) {
      const name = segs[k];
      const order = pages.map((_, i) => pages[(i + r + k) % pages.length]);
      for (const P of order) {
        const la = loadavg()[0];
        const n = await P.page.evaluate((s) => window.__bench.segLen(s), name);
        const fr = [];
        for (let i = 0; i < n; i++) {
          if (!drawn(name, i)) { await P.page.evaluate(([s, j]) => window.__bench.step(s, j, false), [name, i]); continue; }
          const a = snap(P.c);
          const f = await P.page.evaluate(([s, j]) => window.__bench.step(s, j, true), [name, i]);
          const b = snap(P.c);
          const d = delta(a, b);
          fr.push({ i, gpu: +d.gpu.toFixed(2), main: +d.main.toFixed(2), wall: d.wall, js: +f.js.toFixed(2), calls: f.calls, tris: f.tris, mt: f.mt, mc: f.mc, st: f.st, sc: f.sc });
        }
        appendJsonl(outFile, { tag, scene, q, mode: 'gpuseq', row: r, seg: name, label: P.l, side: P.side, la, fr });
      }
    }
    console.log(`[warm3] row ${r + 1}/${rows} ${((Date.now() - t0) / 1000).toFixed(0)} s load ${loadavg()[0]}`);
  }
} catch (e) {
  console.log('[warm3] error ' + String(e && e.stack || e).slice(0, 1500));
  appendJsonl(outFile, { tag, scene, q, mode: 'gpuseq', error: String(e && e.stack || e).slice(0, 1500) });
} finally {
  for (const P of pages) await P.browser.close().catch(() => {});
}
console.log(`[warm3] done ${tag} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
