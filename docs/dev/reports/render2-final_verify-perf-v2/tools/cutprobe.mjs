// per-frame shadow work in a warm cut sequence: one browser per side, the plan's segments run twice (warm-up), then the
// target segment with per-frame detail (draw calls / triangles per pass) printed per side.
//   node cutprobe.mjs <scene> <q> <plan csv> <target> <side,...>
import { launch, serverUrl, guard } from './lib.mjs';
const [scene, q, planCsv, target, sideCsv] = process.argv.slice(2);
const out = {};
for (const side of sideCsv.split(',')) {
  const { browser, pid } = await launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await page.goto(`${serverUrl(side)}/bench.html?scene=${scene}&q=${q}&nodraw=1`, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000, polling: 200 });
    guard(pid);
    for (let pass = 0; pass < 2; pass++) for (const s of planCsv.split(',')) await page.evaluate((n) => window.__bench.seg(n), s);
    const runs = [];
    for (let k = 0; k < 2; k++) {
      for (const s of planCsv.split(',')) { if (s === target) break; await page.evaluate((n) => window.__bench.seg(n), s); }
      const r = await page.evaluate((n) => window.__bench.seg(n, true), target);
      runs.push(r.frames.map((f) => `${f.sc}/${(f.st / 1e3).toFixed(0)}k`).join(' '));
    }
    out[side] = runs;
    console.log(`${side.padEnd(5)} ${target} per frame shadow calls/tris:\n   run1 ${runs[0]}\n   run2 ${runs[1]}`);
  } finally {
    await browser.close();
  }
}
