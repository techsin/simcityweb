// which GPU-process threads carry a drawn frame's cost (and its noise): one browser, bench page, still views drawn
// N times each; per frame the CPU delta of every GPU-process thread (by name) and the wall time.
//   node gputhreads.mjs <side> <q> [views csv] [N]
import { readFileSync, readdirSync } from 'node:fs';
import { launch, gpuPid, serverUrl, guard, loadavg } from './lib.mjs';
const [side, q, viewCsv = 'default,street,far,edgelow', N0 = '8'] = process.argv.slice(2);
const N = +N0;
const threads = (pid) => {
  const o = {};
  for (const t of readdirSync(`/proc/${pid}/task`)) {
    try {
      const name = readFileSync(`/proc/${pid}/task/${t}/comm`, 'utf8').trim();
      const cpu = +readFileSync(`/proc/${pid}/task/${t}/schedstat`, 'utf8').split(' ')[0];
      o[`${name}#${t}`] = cpu;
    } catch { /* gone */ }
  }
  return o;
};
const { browser, pid } = await launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto(`${serverUrl(side)}/bench.html?scene=town&q=${q}&nodraw=1`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000, polling: 200 });
  guard(pid);
  const g = gpuPid(pid);
  for (const v of viewCsv.split(',')) {
    await page.evaluate((n) => window.__bench.still(n, 20), v);
    for (let i = 0; i < N; i++) {
      const a = threads(g), t0 = Date.now();
      await page.evaluate(() => window.__bench.drawOne(true));
      const b = threads(g), wall = Date.now() - t0;
      const d = Object.entries(b).map(([k, x]) => [k, (x - (a[k] ?? x)) / 1e6]).filter(([, x]) => x > 0.5).sort((p, q2) => q2[1] - p[1]);
      const tot = d.reduce((s, [, x]) => s + x, 0);
      console.log(`${v.padEnd(8)} #${i} wall ${wall} ms load ${loadavg()[0]} gpu ${tot.toFixed(1)} ms :: ${d.slice(0, 8).map(([k, x]) => `${k} ${x.toFixed(1)}`).join(' | ')}`);
    }
  }
} finally {
  await browser.close();
}
