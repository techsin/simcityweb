// FRESH bench page: a new browser, bench.html loaded once, the plan's segments run in order (pass 1 = first motions
// after the load; optional pass 2 = the same segments again in the same page). CPU per segment from schedstat
// snapshots (renderer main thread, GPU process), per-frame main-thread CPU from the poller.
//   node fresh.mjs <side> <scene> <q> <outfile> <tag> [pass1 csv] [pass2 csv] [extra url params]
import { launch, pickRenderer, rendererPids, gpuPid, serverUrl, loadavg, guard, startPoller, frameCpu, cpuAt, appendJsonl, snap, delta, threadCpu, sleep } from './lib.mjs';

const [side, scene, q, outFile, tag, p1 = 'street,zoomout,farorbit,default,zoomin,streetpan,streetfast,pan,fastpan,cuts', p2 = '', extra = ''] = process.argv.slice(2);
const url = serverUrl(side);
const rec = { tag, side, scene, q, kind: 'fresh', load0: loadavg(), t: new Date().toISOString(), extra };
const { browser, pid } = await launch();
let poller = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  await page.goto(`${url}/blank.html`, { waitUntil: 'load' });
  guard(pid);
  // every renderer of the browser goes into the poller (the page's and the idle spare): the page's is the busy one
  const rall = rendererPids(pid);
  poller = startPoller(rall.map((p) => `/proc/${p}/task/${p}/schedstat`), tag, 400, 1500);
  const rpid0 = pickRenderer(pid);
  const ctx0 = { rpid: rpid0, gpid: gpuPid(pid) };
  const s0 = snap(ctx0);
  const tNav = Date.now();
  await page.goto(`${url}/${process.env.PAGE ?? "bench"}.html?scene=${scene}&q=${q}${extra ? '&' + extra : ''}`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000, polling: 100 });
  guard(pid);
  const rpid = pickRenderer(pid);
  const s1 = snap({ ...ctx0, rpid });
  rec.sameRenderer = rpid === rpid0;
  rec.rk = rall.indexOf(rpid);
  if (rec.rk < 0) rec.sameRenderer = false;
  const c = { rpid, gpid: gpuPid(pid) };
  rec.readyMs = Date.now() - tNav;
  rec.loadCpu = delta({ ...s0, main: rpid === rpid0 ? s0.main : 0 }, s1);
  const L = await page.evaluate(() => { const l = window.__load; return { marks: l.marks, first: l.first, veil: l.veil, veilT: l.veilFrames.map((f) => f.t), b: l.buildings }; });
  rec.load = { marks: L.marks, first: L.first, veil: L.veil, b: L.b };
  const segs = [];
  const run = async (names, pass) => {
    for (const name of names) {
      const a = snap(c);
      const r = await page.evaluate((n) => window.__bench.seg(n, true), name);
      const b = snap(c);
      const d = delta(a, b);
      const ft = r.frames.map((f) => f.t);
      segs.push({ name, pass, cpu: d.main, gpu: d.gpu, rproc: d.rproc, wall: d.wall, ft, t1: r.t1, js: r.js, up: r.up, ob: r.ob, rn: r.rn, calls: r.calls, tris: r.tris, mc: r.mc, mt: r.mt, sc: r.sc, st: r.st, gd: r.gd, jsMax: r.jsMax, allocKB: r.allocKB, fjs: r.frames.map((f) => +f.js.toFixed(1)) });
    }
  };
  if (p1) await run(p1.split(','), 1);
  if (p2) await run(p2.split(','), 2);
  rec.stats = await page.evaluate(() => window.__bench.stats());
  rec.heapGC = await page.evaluate(() => window.__bench.gc());
  const poll = await poller.stop();
  poller = null;
  // per-frame CPU: load frame + veil frames (only valid when the page kept the renderer), then each segment
  if (rec.sameRenderer) {
    const vt = L.veilT;
    rec.firstCpu = cpuAt(poll, rec.rk, vt[0]) - cpuAt(poll, rec.rk, L.first.t);
    rec.veilCpu = frameCpu(poll, rec.rk, vt.slice(0, vt.length - 1), vt[vt.length - 1]).map((x) => +x.toFixed(2));
  }
  for (const s of segs) {
    s.per = rec.rk >= 0 ? frameCpu(poll, rec.rk, s.ft, s.t1).map((x) => +x.toFixed(2)) : [];
    s.pollCpu = +s.per.reduce((a, b) => a + b, 0).toFixed(2);
    s.over16 = s.per.filter((x) => x > 16.7).length;
    s.over33 = s.per.filter((x) => x > 33.3).length;
    delete s.ft;
  }
  rec.segs = segs;
  rec.errors = errs.slice(0, 8);
} catch (e) {
  rec.error = String(e && e.stack || e).slice(0, 2000);
} finally {
  if (poller) await poller.stop().catch(() => {});
  await browser.close().catch(() => {});
}
rec.load1 = loadavg();
appendJsonl(outFile, rec);
console.log(JSON.stringify({ tag, side, scene, q, ready: rec.readyMs, err: rec.error?.slice(0, 400), segs: (rec.segs ?? []).map((s) => `${s.name}${s.pass > 1 ? '2' : ''}:${s.cpu.toFixed(0)}`).join(' ') }));
