// deterministic still-view counts (no drawing needed: three.js counts what it submits): per side and quality, one fresh
// browser, bench page with nodraw=1; each still view settled 40 frames, then the per-frame mean of the last 5 frames of
// draw calls / triangles (all passes, main pass, shadow pass). Also the same view again after a far view (LOD hysteresis).
//   node stills.mjs <outfile> <scene> <q csv> <label:side,...> [views csv]
import { launch, serverUrl, guard, appendJsonl, loadavg } from './lib.mjs';
const [outFile, scene, qCsv, labelCsv, viewCsv = 'street,default,far,edgelow,edget18,edget25'] = process.argv.slice(2);
const labels = labelCsv.split(',').map((s) => { const [l, side] = s.split(':'); return { l, side }; });
for (const q of qCsv.split(',')) {
  for (const L of labels) {
    const { browser, pid } = await launch();
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
      await page.goto(`${serverUrl(L.side)}/bench.html?scene=${scene}&q=${q}&nodraw=1`, { waitUntil: 'load', timeout: 300000 });
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000, polling: 200 });
      guard(pid);
      const views = viewCsv.split(',');
      const out = {};
      for (const pass of [1, 2]) {
        for (const v of views) {
          const s = await page.evaluate((n) => window.__bench.still(n, 40), v);
          const k = (x) => +(x / s.n).toFixed(1);
          out[`${v}${pass > 1 ? '@2' : ''}`] = { calls: k(s.calls), tris: k(s.tris), mc: k(s.mc), mt: k(s.mt), sc: k(s.sc), st: k(s.st) };
        }
      }
      appendJsonl(outFile, { scene, q, label: L.l, side: L.side, la: loadavg()[0], views: out });
      console.log(`[stills] ${scene} ${q} ${L.l} done`);
    } catch (e) {
      console.log(`[stills] ${scene} ${q} ${L.l} error ${String(e).slice(0, 300)}`);
    } finally {
      await browser.close().catch(() => {});
    }
  }
}
