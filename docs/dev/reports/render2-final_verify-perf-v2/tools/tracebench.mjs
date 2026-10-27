// attribution of one first-motion segment on a FRESH bench page: the fresh plan's segments run in order, the target one
// under a Chrome trace with the V8 sampling profiler (disabled-by-default-v8.cpu_profiler); prints the main thread's
// self time by JS function (url:line) and by top-level event kind inside the target segment.
//   node tracebench.mjs <side> <scene> <q> <plan csv> <target seg> <out.json>
import { writeFileSync } from 'node:fs';
import { launch, serverUrl, guard } from './lib.mjs';
const [side, scene, q, planCsv, target, outFile] = process.argv.slice(2);
const { browser, pid } = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(`${serverUrl(side)}/blank.html`, { waitUntil: 'load' });
  guard(pid);
  await page.goto(`${serverUrl(side)}/bench.html?scene=${scene}&q=${q}&nodraw=1`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000, polling: 100 });
  const cdp = await ctx.newCDPSession(page);
  let seen = 0;
  const nth = +(process.env.TARGET_N ?? 1);
  for (const s of planCsv.split(',')) {
    if (s !== target || ++seen < nth) { await page.evaluate((n) => window.__bench.seg(n), s); continue; }
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    const r = await page.evaluate((n) => window.__bench.seg(n), s);
    const { profile } = await cdp.send('Profiler.stop');
    writeFileSync(outFile, JSON.stringify({ side, scene, q, target, r, profile }));
    // self time per function (url:line:name) from the samples
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const dt = profile.timeDeltas;
    const self = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const n = byId.get(profile.samples[i]);
      const cf = n.callFrame;
      const key = `${cf.functionName || '(anon)'} ${String(cf.url).split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
    }
    // inclusive time per file
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const incFile = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const seen = new Set();
      let id = profile.samples[i];
      while (id) {
        const f = String(byId.get(id).callFrame.url).split('/').pop().split('?')[0] || '(native)';
        if (!seen.has(f)) { seen.add(f); incFile.set(f, (incFile.get(f) ?? 0) + (dt[i] ?? 0) / 1000); }
        id = parent.get(id);
      }
    }
    const tot = [...self.values()].reduce((a, b) => a + b, 0);
    console.log(`side ${side} ${scene} ${q} ${target}: js ${r.js.toFixed(0)} ms (in-page), sampled ${tot.toFixed(0)} ms`);
    console.log('self time by function:');
    for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${v.toFixed(1).padStart(8)}  ${k}`);
    console.log('inclusive time by file:');
    for (const [k, v] of [...incFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${v.toFixed(1).padStart(8)}  ${k}`);
    break;
  }
} finally {
  await browser.close();
}
