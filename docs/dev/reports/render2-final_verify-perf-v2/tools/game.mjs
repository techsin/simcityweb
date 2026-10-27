// REAL game load path: seed the town save, main menu -> Continue -> CityScene; per-frame main-thread CPU (poller) for
// frames 1..K after viewsReady (frame 1 = the first frame with the city's WorldView), then scripted first motions.
//   node game.mjs <side> <q> <outfile> <tag> [segments csv] [K]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, pickRenderer, rendererPids, gpuPid, serverUrl, loadavg, guard, startPoller, frameCpu, cpuAt, appendJsonl, TOOLS, threadCpu, procCpu, sleep } from './lib.mjs';

const [side, q, outFile, tag, segCsv = 'street,zoomout,farorbit,default,zoomin,pan,fastpan,streetpan,streetfast,cuts', K0 = '40'] = process.argv.slice(2);
const K = +K0;
const INIT = readFileSync(resolve(TOOLS, 'gameinit.js'), 'utf8');
const url = serverUrl(side);
const la0 = loadavg();
const { browser, pid } = await launch();
let poller = null;
const rec = { tag, side, q, kind: 'game', load0: la0, t: new Date().toISOString() };
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  await page.goto(`${url}/seed.html?q=${q}`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__seeded, null, { timeout: 300000, polling: 100 });
  rec.seed = await page.evaluate(() => window.__seeded);
  const DRAW = process.env.DRAW ?? 'nodraw';
  rec.draw = DRAW;
  if (DRAW === 'nodraw') await page.addInitScript({ content: 'window.__noDraw = true; window.__drawOn = false;' });
  else if (DRAW === 'scissor') await page.addInitScript({ content: 'window.__scissor = true;' });
  if (process.env.NOAUDIO === '1') { rec.noAudio = true; await page.addInitScript({ content: 'window.AudioContext = undefined; window.webkitAudioContext = undefined;' }); }
  await page.addInitScript({ content: INIT });
  const tNav = Date.now();
  await page.goto(`${url}/index.html`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000, polling: 100 });
  rec.titleMs = Date.now() - tNav;
  await sleep(1500); // menu items animate in (delay 0.35 s)
  guard(pid);
  const rpid = pickRenderer(pid), gpid = gpuPid(pid);
  const rall = rendererPids(pid);
  rec.rk = rall.indexOf(rpid);
  poller = startPoller(rall.map((p) => `/proc/${p}/task/${p}/schedstat`), `${tag}`, 400, 1200);
  const c0 = { main: threadCpu(rpid), gpu: procCpu(gpid), t: Date.now() };
  await page.click('button.menu-item.primary', { timeout: 60000 });
  const tClick = Date.now();
  // wait for viewsReady + K frames with the WorldView
  try {
    await page.waitForFunction((k) => window.__worldAt >= 0 && window.__frames.length > window.__worldAt + k + 2, K, { timeout: +(process.env.LOADWAIT ?? 600000), polling: 100 });
  } catch (e) {
    rec.diag = await page.evaluate(() => {
      const a = window.__metropolis, c = a && a.city, sc = c && c.scene, w = sc && sc.world;
      return { worldAt: window.__worldAt, frames: window.__frames.length, app: !!a, city: !!c, scene: !!sc, world: w ? w.constructor.name : null, cc: !!(w && w.cameraController), veil: window.__veilGone, busy: a && a.busy, text: document.body.innerText.slice(0, 400) };
    }).catch((x) => String(x));
    throw e;
  }
  const c1 = { main: threadCpu(rpid), gpu: procCpu(gpid), t: Date.now() };
  if (pickRenderer(pid) !== rpid) rec.rendererChanged = true;
  rec.clickToFramesMs = c1.t - tClick;
  rec.loadCpu = { main: (c1.main - c0.main) / 1e6, gpu: (c1.gpu - c0.gpu) / 1e6 };
  // motion segments
  const segs = segCsv ? segCsv.split(',').filter(Boolean) : [];
  let marks = [];
  if (segs.length) marks = await page.evaluate((n) => window.__gameHook.run(n), segs);
  await page.waitForFunction(() => window.__frames.length > window.__gameHook.done + 2, null, { timeout: 600000, polling: 100 });
  const D = await page.evaluate(() => ({ F: window.__frames, R: window.__frec, worldAt: window.__worldAt, veil: window.__veilGone, paused: window.__paused, anchor: window.__gameHook.anchor, done: window.__gameHook.done, heap: performance.memory ? performance.memory.usedJSHeapSize : 0 }));
  const poll = await poller.stop();
  poller = null;
  const F = D.F, w = D.worldAt;
  // per-frame CPU for frames 1..K (frame 1 = F[w])
  const starts = F.slice(w, w + K + 1);
  const fc = frameCpu(poll, rec.rk, starts.slice(0, K), starts[K]);
  rec.frames = fc.map((x) => +x.toFixed(2));
  rec.inpage = D.R.slice(0, K).map((r) => ({ wu: +r.wu.toFixed(2), wr: +r.wr.toFixed(2), ou: +r.ou.toFixed(2), su: +r.su.toFixed(2), lp: +(r.lp ?? 0).toFixed(2), calls: r.calls, tris: r.tris }));
  // CPU per phase in the first frames: poller CPU between the in-page phase timestamps (lp = the scene's whole frame
  // callback; wu / ou / wr = world.update / objects.update / world.render inside it)
  rec.phase = D.R.slice(0, 40).map((r) => {
    const o = { lp: 0, wu: 0, ou: 0, wr: 0, su: 0, wm: 0 };
    const ts = r.ts || [];
    for (let k = 0; k < ts.length; k += 3) o[ts[k]] = +(o[ts[k]] + cpuAt(poll, rec.rk, ts[k + 2]) - cpuAt(poll, rec.rk, ts[k + 1])).toFixed(2);
    return o;
  });
  rec.veilFrame = F.findIndex((t) => t >= D.veil) - w; // frame index (rel. to frame 1 = 0) of the first frame after the veil class drop
  rec.preWorld = { frames: w, cpuLast10: frameCpu(poll, rec.rk, F.slice(Math.max(0, w - 10), w), F[w]).map((x) => +x.toFixed(2)) };
  // segments
  const segOut = {};
  for (let k = 0; k < marks.length; k++) {
    const m = marks[k];
    if (m.name === 'end') continue;
    const i0 = m.i, i1 = marks[k + 1].i; // [i0, i1) frames of this segment
    const per = frameCpu(poll, rec.rk, F.slice(i0, i1), F[i1]);
    const R = D.R.filter((r) => r.i >= i0 && r.i < i1);
    // render-only CPU of the segment: poller CPU inside world.update + objects.update + world.render
    let rcpu = 0, lcpu = 0;
    const ph = { wu: 0, ou: 0, wr: 0, wm: 0, su: 0 };
    for (const r of R) {
      const ts = r.ts || [];
      for (let k = 0; k < ts.length; k += 3) {
        const c = cpuAt(poll, rec.rk, ts[k + 2]) - cpuAt(poll, rec.rk, ts[k + 1]);
        if (ts[k] === 'lp') lcpu += c; else if (ts[k] !== 'su') rcpu += c;
        if (ts[k] in ph) ph[ts[k]] += c;
      }
    }
    for (const k in ph) ph[k] = +ph[k].toFixed(2);
    segOut[m.name] = {
      n: i1 - i0, cpu: +per.reduce((a, b) => a + b, 0).toFixed(2), rcpu: +rcpu.toFixed(2), lcpu: +lcpu.toFixed(2), ph, max: +Math.max(...per).toFixed(2), over16: per.filter((x) => x > 16.7).length, over33: per.filter((x) => x > 33.3).length,
      per: per.map((x) => +x.toFixed(1)), wu: +R.reduce((a, r) => a + r.wu, 0).toFixed(1), wr: +R.reduce((a, r) => a + r.wr, 0).toFixed(1), ou: +R.reduce((a, r) => a + r.ou, 0).toFixed(1), su: +R.reduce((a, r) => a + r.su, 0).toFixed(1),
    };
  }
  rec.segs = segOut;
  rec.heap = D.heap;
  rec.errors = errs.slice(0, 8);
  rec.load1 = loadavg();
} catch (e) {
  rec.error = String(e && e.stack || e).slice(0, 2000);
} finally {
  if (poller) await poller.stop().catch(() => {});
  await browser.close().catch(() => {});
}
appendJsonl(outFile, rec);
console.log(JSON.stringify({ tag, side, q, f: rec.frames?.slice(0, 6), err: rec.error?.slice(0, 300), segs: Object.fromEntries(Object.entries(rec.segs ?? {}).map(([k, v]) => [k, v.cpu])) }));
