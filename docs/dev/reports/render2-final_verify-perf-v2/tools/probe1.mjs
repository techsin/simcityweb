import { launch, pickRenderer, gpuPid, snap, delta, serverUrl, loadavg, guard } from './lib.mjs';
const [side = 'new', scene = 'town', q = 'low', segs = 'street,zoomout'] = process.argv.slice(2);
const { browser, pid } = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning' || t.startsWith('[bench]')) console.log('[console.' + m.type() + '] ' + t.slice(0, 600)); });
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
const t0 = Date.now();
await page.goto(`${serverUrl(side)}/${process.env.PAGE ?? "bench"}.html?scene=${scene}&q=${q}&${process.env.EXTRA ?? ""}`, { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000, polling: 200 });
guard(pid);
const c = { rpid: pickRenderer(pid), gpid: gpuPid(pid) };
console.log('ready in', Date.now() - t0, 'ms; renderer', c.rpid, 'gpu', c.gpid, 'load', loadavg());
const L = await page.evaluate(() => { const l = window.__load; return { marks: l.marks, first: l.first, veil: l.veil, b: l.buildings }; });
console.log(JSON.stringify(L).slice(0, 1500));
for (const s of segs.split(',')) {
  const a = snap(c);
  const r = await page.evaluate((n) => window.__bench.seg(n), s);
  const b = snap(c);
  const d = delta(a, b);
  console.log(s, JSON.stringify({ wall: d.wall, main: +d.main.toFixed(1), gpu: +d.gpu.toFixed(1), js: +r.js.toFixed(1), up: +r.up.toFixed(1), ob: +r.ob.toFixed(1), rn: +r.rn.toFixed(1), calls: r.calls / r.n, mt: Math.round(r.mt / r.n), tris: Math.round(r.tris / r.n), st: Math.round(r.st / r.n), jsMax: +r.jsMax.toFixed(1), allocKB: +r.allocKB.toFixed(1) }));
}
console.log(JSON.stringify(await page.evaluate(() => window.__bench.stats())).slice(0, 800));
await browser.close();
