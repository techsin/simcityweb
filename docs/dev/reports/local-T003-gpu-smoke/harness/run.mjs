// T003 real-GPU smoke harness. One config per invocation (fresh browser):
//   node run.mjs <mode gpu|ss> <scene city|ui|world|game300k|gamefresh> <q> <w> <h> <outDir> <what shots,timing>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const WT = 'C:/Users/techsin/Desktop/projects/simcityweb-worker';
const require = createRequire(WT + '/package.json');
const { chromium } = require('playwright');

const [mode, scene, q, W, H, outDir, what = 'shots,timing'] = process.argv.slice(2);
const w = +W, h = +H;
const BASE = 'http://127.0.0.1:5199/';
const CITY = 'C:/Users/techsin/AppData/Local/Temp/claude/C--Users-techsin-Desktop-projects-simcityweb/aa362639-df94-5668-b880-d90605d049a2/scratchpad/t003/cities/vet_s7_y21.region.metropolis';
const tag = `${scene}_${q}_${w}_${mode}`;
mkdirSync(outDir, { recursive: true });

const args = mode === 'gpu'
  ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default']
  : mode === 'gpuu'
  ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default', '--disable-gpu-vsync', '--disable-frame-rate-limit']
  :['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const { createServer } = require('vite');
const server = await createServer({ root: WT, logLevel: 'error', server: { port: 5199, strictPort: true, host: '127.0.0.1', hmr: false } });
await server.listen();
const t0 = Date.now();
const browser = await chromium.launch({ args, headless: !process.env.HEADED });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const logs = [];
const res = { tag, mode, scene, q, w, h, browser: browser.version(), logs, shots: [], timing: {} };
await ctx.addInitScript((quality) => {
  try { localStorage.setItem('metropolis.settings', JSON.stringify({ quality, v: 2 })); } catch {}
  // total time spent in requestAnimationFrame callbacks per frame (all of the app's per-frame main-thread work)
  window.__raf = new Map();
  const rAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => rAF((ts) => {
    const t = performance.now();
    try { cb(ts); } finally { window.__raf.set(ts, (window.__raf.get(ts) || 0) + performance.now() - t); }
  });
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...a) {
    const c = orig.call(this, type, ...a);
    if (c && /webgl/.test(type) && !this.__lostHook) {
      this.__lostHook = 1;
      this.addEventListener('webglcontextlost', () => console.error('WEBGL_CONTEXT_LOST canvas=' + (this.id || this.className || 'anon') + ' ' + this.width + 'x' + this.height + ' attached=' + this.isConnected));
    }
    return c;
  };
}, q);
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 600)}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message.slice(0, 600)}`));

const urls = {
  city: `demo-city.html?q=${q}&hud=0`,
  world: `demo-world.html?quality=${q}&hud=0`,
  ui: `demo-ui.html?town=1&quality=${q}`,
  game300k: `index.html`,
  gamefresh: `index.html?quickstart=1&size=small&seed=7`,
};
const waitReady = () => page.waitForFunction(() => window.__ready === true, null, { timeout: 600000, polling: 250 });
await page.goto(BASE + urls[scene], { waitUntil: 'load', timeout: 300000 });
await waitReady();
if (scene === 'game300k') {
  const b64 = readFileSync(CITY).toString('base64');
  await page.evaluate(async (b64) => {
    window.__ready = false;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const { importRegion } = await import('/src/save/index.ts');
    const r = await importRegion(new Blob([bytes]));
    const key = r.tiles.find((t) => t.city).key;
    await window.__metropolis.continueInCity(r, key);
  }, b64);
  await waitReady();
}
res.loadMs = Date.now() - t0;
res.ctxAlive = await page.evaluate(() => { const g = window; const sc = g.__metropolis?.city?.scene; const wv = sc ? sc.worldView : g.__worldView || g.world || g.__scene?.worldView; return wv ? !wv.renderer.getContext().isContextLost() : null; });

// page-side helpers: find the WorldView and state for this scene
await page.evaluate((scene) => {
  const g = window;
  const sc = scene.startsWith('game') ? g.__metropolis?.city?.scene : scene === 'ui' ? g.__scene : null;
  const wv = sc ? sc.worldView : scene === 'city' ? g.__worldView : g.world;
  const st = sc ? sc.sim.state : scene === 'city' ? g.__city.st : g.state;
  if (sc?.sim) sc.sim.speed = 0;
  const cc = wv.cameraController;
  const t = cc.target;
  g.__h = {
    wv, st, sc, cc,
    def: { x: t.x, z: t.z, d: cc.distance, tilt: cc.baseTilt * 180 / Math.PI, yaw: cc.yawAngle * 180 / Math.PI },
    maxD: cc.opts?.maxDistance ?? 2500,
    hour(hh) {
      if (sc?.applySettings) sc.applySettings({ autoTime: false, fixedHour: hh });
      wv.autoTime = false; wv.timeOfDay = hh;
    },
    month(m) {
      st.day = Math.floor(st.day / 360) * 360 + m * 30 + 15;
      wv.trees.setMonth(st.month); wv.terrain.setMonth(st.month);
    },
    view(name) {
      const d = this.def;
      if (name === 'street') cc.setView(d.x, d.z, 70, 28, d.yaw);
      else if (name === 'far') cc.setView(d.x, d.z, this.maxD * 0.95, d.tilt, d.yaw);
      else cc.setView(d.x, d.z, d.d, d.tilt, d.yaw);
    },
    frames(n) { return new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }); },
    info() { const i = wv.renderer.info.render; return { calls: i.calls, triangles: i.triangles, renderScale: wv.renderScale }; },
  };
}, scene);
res.def = await page.evaluate(() => ({ ...window.__h.def, maxD: window.__h.maxD }));
res.renderer = await page.evaluate(() => {
  const gl = window.__h.wv.renderer.getContext();
  const e = gl.getExtension('WEBGL_debug_renderer_info');
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});

if (what.includes('shots')) {
  // fixed full resolution for comparable stills
  await page.evaluate(() => { const wv = window.__h.wv; wv.dynamicResolution = false; wv.renderScale = 1; wv.applyRenderSize?.(); });
  const plan = [
    ['street', 14, 5], ['default', 14, 5], ['far', 14, 5], ['default', 22, 5], ['default', 14, 0], ['street', 22, 0],
  ];
  const settle = mode === 'gpu' ? 120 : 8;
  for (const [v, hh, m] of plan) {
    await page.evaluate(async ([v, hh, m, n]) => { const H = window.__h; H.month(m); H.hour(hh); H.view(v); await H.frames(n); }, [v, hh, m, settle]);
    if (mode === 'gpu') await page.waitForTimeout(1500);
    const name = `${tag}_${v}_${hh === 22 ? 'night' : 'day'}_${m === 0 ? 'jan' : 'jun'}.png`;
    await page.screenshot({ path: join(outDir, name), timeout: 600000 });
    res.shots.push({ name, ...(await page.evaluate(() => window.__h.info())) });
  }
  await page.evaluate(() => { const wv = window.__h.wv; wv.dynamicResolution = wv.q.dynamicResolution; });
}

if (what.includes('timing')) {
  await page.evaluate(async () => { const H = window.__h; H.month(5); H.hour(14); H.view('default'); await H.frames(120); });
  // per-frame main-thread CPU (wv.update + wv.render) and GPU time (timer query around wv.render)
  res.gpuTimer = await page.evaluate(() => {
    const H = window.__h, wv = H.wv, gl = wv.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const I = (H.inst = { cpu: [], gpu: [], pending: [], cu: 0 });
    const origU = wv.update, origR = wv.render;
    wv.update = function (...a) { const t = performance.now(); const r = origU.apply(this, a); I.cu = performance.now() - t; return r; };
    wv.render = function (...a) {
      for (let i = I.pending.length - 1; i >= 0; i--) {
        const q = I.pending[i];
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) I.gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(q); I.pending.splice(i, 1);
        }
      }
      let q = null;
      if (ext && I.pending.length < 8) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      const t = performance.now(); const r = origR.apply(this, a); I.cpu.push(I.cu + performance.now() - t); I.cu = 0;
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); I.pending.push(q); }
      return r;
    };
    return !!ext;
  });
  await page.waitForTimeout(2000);
  const collect = (seconds, script) => page.evaluate(async ([seconds, script]) => {
    const H = window.__h, d = H.def, iv = [], scales = [], spikes = [];
    let calls = 0, tris = 0, n = 0;
    H.inst.cpu = []; H.inst.gpu = []; window.__raf.clear();
    await new Promise((resolve) => {
      let last = -1, start = -1;
      const f = (ts) => {
        if (start < 0) start = ts;
        const t = (ts - start) / 1000;
        if (last >= 0) { iv.push(ts - last); if (ts - last > 25 && spikes.length < 60) spikes.push([+t.toFixed(2), +(ts - last).toFixed(1)]); }
        last = ts;
        const inf = H.info(); calls += inf.calls; tris += inf.triangles; n++; scales.push(inf.renderScale);
        if (script) {
          // 0-5 s pan, 5-10 s zoom out to far, 10-15 s zoom in to street, 15-20 s orbit
          const u = (x) => Math.min(1, Math.max(0, x)), ease = (x) => x * x * (3 - 2 * x);
          const span = Math.min(3000, H.maxD * 0.4);
          let x = d.x, z = d.z, dist = d.d, yaw = d.yaw;
          if (t < 5) { const k = ease(u(t / 5)); x = d.x + span * k; z = d.z + span * 0.5 * k; }
          else if (t < 10) { const k = ease(u((t - 5) / 5)); x = d.x + span; z = d.z + span * 0.5; dist = d.d * Math.pow(H.maxD * 0.95 / d.d, k); }
          else if (t < 15) { const k = ease(u((t - 10) / 5)); dist = H.maxD * 0.95 * Math.pow(70 / (H.maxD * 0.95), k); x = d.x + span * (1 - k); z = d.z + span * 0.5 * (1 - k); }
          else { const k = u((t - 15) / 5); dist = 70 + (d.d - 70) * k; yaw = d.yaw + 360 * k; }
          H.cc.setView(x, z, dist, d.tilt, yaw);
        }
        if (t >= seconds) resolve(); else requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    const cpu = H.inst.cpu.slice(), raf = [...window.__raf.values()];
    await H.frames(10);
    const gpu = H.inst.gpu.slice();
    const st = (a) => { const z = [...a].sort((x, y) => x - y), q = (k) => +z[Math.min(z.length - 1, Math.floor(k * z.length))].toFixed(2); return z.length ? { n: z.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over16_7: z.filter((x) => x > 16.7).length } : null; };
    const s = [...iv].sort((a, b) => a - b), p = (k) => s[Math.min(s.length - 1, Math.floor(k * s.length))];
    return {
      raf: st(raf), cpu: st(cpu), gpu: st(gpu),
      frames: iv.length, p50: p(0.5), p95: p(0.95), p99: p(0.99), max: s[s.length - 1],
      over16_7: iv.filter((x) => x > 18).length, over33: iv.filter((x) => x > 34).length,
      avgCalls: Math.round(calls / n), avgTris: Math.round(tris / n), minScale: Math.min(...scales), spikes,
    };
  }, [seconds, script]);
  res.timing.idle = await collect(30, false);
  await page.evaluate(() => window.__h.view('default'));
  await page.waitForTimeout(1000);
  res.timing.camera = await collect(20, true);
}
if (what.includes('lodprobe')) {
  // triangles / draw calls every 500 ms for 8 s after each view change (does LOD settle, and where?)
  res.lod = {};
  for (const v of ['default', 'far', 'default', 'far']) {
    const k = res.lod[v] ? v + '2' : v;
    res.lod[k] = await page.evaluate(async (v) => {
      const H = window.__h; H.month(5); H.hour(14); H.view(v);
      const out = [];
      for (let i = 0; i < 16; i++) { await new Promise((r) => setTimeout(r, 500)); const x = H.info(); out.push(`${(x.triangles / 1e6).toFixed(2)}M/${x.calls}`); }
      return out.join(' ');
    }, v);
  }
}
if (what.includes('burst')) {
  // wall time per wv.render() from K=1 vs K=10 back-to-back renders between GPU syncs (median of 5)
  res.burst = {};
  for (const v of ['default', 'far', 'street']) {
    res.burst[v] = await page.evaluate(async (v) => {
      const H = window.__h, wv = H.wv, gl = wv.renderer.getContext(), px = new Uint8Array(4);
      H.month(5); H.hour(14); H.view(v); await H.frames(90);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const m = {};
      for (const K of [1, 10]) {
        const ts = [];
        for (let rep = 0; rep < 5; rep++) {
          await new Promise((r) => requestAnimationFrame(r));
          sync(); const t = performance.now();
          for (let i = 0; i < K; i++) wv.render();
          sync(); ts.push(performance.now() - t);
        }
        ts.sort((a, b) => a - b); m[K] = ts[2];
      }
      return +((m[10] - m[1]) / 9).toFixed(2);
    }, v);
  }
}
res.totalMs = Date.now() - t0;
await browser.close();
await server.close();
writeFileSync(join(outDir, `${tag}.json`), JSON.stringify(res, null, 1));
console.log(JSON.stringify({ tag, loadMs: res.loadMs, totalMs: res.totalMs, logs: logs.length, timing: res.timing, renderer: res.renderer }));
