// GPU stand-in on still views AND along moving sequences, same pages (bench3 page, nodraw=1 except the measured frames).
// One browser per label (two per version = A/A). Warm-up (discarded): every still view settled + one drawn frame, then
// one sampled drawn pass of every sequence (SwiftShader compiles its pipelines on first draws: seconds of GPU-process CPU).
// Rows (rotated page order per view / sequence):
//   still view: settle 20 frames, then K = 4 drawn frames with the shadow map forced, each measured alone  (mode 'gpu')
//   sequence:   the segment frame by frame, sampled frames drawn and measured alone (warm3 SAMPLE)        (mode 'gpuseq')
//   node warm4.mjs <scene> <q> <outfile> <tag> <rows> <views csv|-> <seqs csv|-> <label:side,...> [extra url params]
import { launch, pickRenderer, gpuPid, serverUrl, loadavg, guard, appendJsonl, snap, delta } from './lib.mjs';

const [scene, q, outFile, tag, rowsS, viewCsv, seqCsv, labelCsv, extra = ''] = process.argv.slice(2);
const rows = +rowsS;
const views = viewCsv && viewCsv !== '-' ? viewCsv.split(',') : [];
const seqs = seqCsv && seqCsv !== '-' ? seqCsv.split(',') : [];
const labels = labelCsv.split(',').map((s) => { const [l, side] = s.split(':'); return { l, side }; });
const K = +(process.env.GPUK ?? 2);
const SAMPLE = { cuts: [5, [0, 1]], edgefast: [10, [0, 5]], fastpan: [10, [0]], edgepan: [20, [0]], edgeturn: [20, [0]], zoomout: [30, [0]], farorbit: [20, [0]], streetfast: [10, [0]] };
const drawn = (s, i) => { const [every, picks] = SAMPLE[s] ?? [10, [0]]; return picks.includes(i % every); };
const pages = [];
const t0 = Date.now();

async function seqPass(P, name, record, r, la) {
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
  if (record) appendJsonl(outFile, { tag, scene, q, mode: 'gpuseq', row: r, seg: name, label: P.l, side: P.side, la, fr });
}

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
    console.log(`[warm4] ${L.l} (${L.side}) ready ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  for (const P of pages) {
    for (const v of views) { await P.page.evaluate((n) => window.__bench.still(n, 20), v); await P.page.evaluate(() => window.__bench.drawOne(true)); }
    for (const s of seqs) await seqPass(P, s, false, -1, 0);
  }
  console.log(`[warm4] warmed ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < views.length; k++) {
      const name = views[k];
      const order = pages.map((_, i) => pages[(i + r + k) % pages.length]);
      for (const P of order) {
        const la = loadavg()[0];
        const st = await P.page.evaluate((n) => window.__bench.still(n, 20), name);
        const fr = [];
        for (let j = 0; j < K; j++) {
          const a = snap(P.c);
          const f = await P.page.evaluate(() => window.__bench.drawOne(true));
          const b = snap(P.c);
          const d = delta(a, b);
          fr.push({ gpu: d.gpu, main: d.main, wall: d.wall, js: f.js, calls: f.calls, tris: f.tris, mt: f.mt, mc: f.mc, st: f.st, sc: f.sc });
        }
        appendJsonl(outFile, { tag, scene, q, mode: 'gpu', row: r, seg: name, label: P.l, side: P.side, la, still: st, fr });
      }
    }
    for (let k = 0; k < seqs.length; k++) {
      const name = seqs[k];
      const order = pages.map((_, i) => pages[(i + r + k + 1) % pages.length]);
      for (const P of order) await seqPass(P, name, true, r, loadavg()[0]);
    }
    console.log(`[warm4] row ${r + 1}/${rows} ${((Date.now() - t0) / 1000).toFixed(0)} s load ${loadavg()[0]}`);
  }
} catch (e) {
  console.log('[warm4] error ' + String(e && e.stack || e).slice(0, 1500));
  appendJsonl(outFile, { tag, scene, q, error: String(e && e.stack || e).slice(0, 1500) });
} finally {
  for (const P of pages) await P.browser.close().catch(() => {});
}
console.log(`[warm4] done ${tag} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
