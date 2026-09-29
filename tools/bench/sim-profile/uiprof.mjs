#!/usr/bin/env node
/**
 * Full-game main-thread profile at ultra speed on a big-city fixture (headless chromium, SwiftShader).
 *
 *   node tools/bench/sim-profile/uiprof.mjs --fixture <F.metropolis> [--root <tree to serve, default repo root>] [--days 60]
 *        [--warm 10] [--quality low] [--startDay N] [--nice -15] [--autogroup -10|off] [--w 480 --h 270] [--camDist 180]
 *        [--out ui-profile] [--cdpprof 1]      then: node tools/bench/sim-profile/uianalyze.mjs ui-profile.trace.json
 *
 * Serves the game from a Vite dev server rooted at --root, loads the fixture into a CityScene (the saved-city path:
 * new CityScene({ state }) like demo.ts), sets speed 3 (ultra), and instruments with performance.mark() pairs:
 * rAF frame (CityScene.loop), sim.update, advanceDay, every SimSystem hook, every InfraScheduler step (with sub-phase),
 * every sim event emit (listeners = render / UI handlers), world.update / objects.update / world.render.
 * A CDP trace (blink.user_timing + devtools.timeline) gives each mark's thread time (tts, main-thread CPU µs), so every
 * region is measured in CPU time (robust against machine load) as well as wall time.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']); return acc; }, []));
const ROOT = resolve(args.root ?? resolve(here, '../../..'));
const FIXTURE = resolve(args.fixture);
const DAYS = +(args.days ?? 60);
const WARM = +(args.warm ?? 10);
const OUT = args.out ?? resolve(process.cwd(), 'ui-profile');
const NICE = args.nice ?? '-15';
const main = ROOT;
const { createServer } = await import(`${main}/node_modules/vite/dist/node/index.js`);
const { chromium } = await import(`${main}/node_modules/playwright/index.mjs`);

// chromium wrapper with a raised priority (shorter run queues on the loaded box: wall-clock closer to CPU time)
const chromeBin = execSync('ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1').toString().trim();
mkdirSync(resolve(ROOT, 'node_modules/.cache/sim-profile'), { recursive: true });
const wrapper = resolve(ROOT, 'node_modules/.cache/sim-profile/chrome-nice.sh');
writeFileSync(wrapper, `#!/bin/sh\nexec nice -n ${NICE} ${chromeBin} "$@"\n`, { mode: 0o755 });

const server = await createServer({
  root: ROOT, configFile: `${ROOT}/vite.config.ts`, cacheDir: `${ROOT}/node_modules/.cache/sim-profile/vite-${process.pid}`, logLevel: 'error',
  server: { port: 0, host: '127.0.0.1', hmr: false, fs: { strict: false } },
});
await server.listen();
console.log('[uiprof] vite up', server.httpServer.address().port);
const base = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ executablePath: wrapper, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
log('browser launched');
// sched autogroup: the browser runs in its own session; raise the group's weight for the measurement (restored on exit)
const AG = args.autogroup ?? '-10';
try { const pid = +execSync(`pgrep -P ${process.pid} -f chrome | head -1`).toString().trim(); if (pid && AG !== 'off') { writeFileSync(`/proc/${pid}/autogroup`, AG); log('autogroup', readFileSync(`/proc/${pid}/autogroup`, 'utf8').trim()); } } catch (e) { log('autogroup failed', String(e)); }
try {
  const ctx = await browser.newContext({ viewport: { width: +(args.w ?? 960), height: +(args.h ?? 540) } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(0);
  page.on('pageerror', (e) => log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /\[prof\]/.test(m.text())) log('console', m.type(), m.text().slice(0, 300)); });
  const fixtureBytes = readFileSync(FIXTURE);
  await page.route('**/__fixture.metropolis', (r) => r.fulfill({ status: 200, body: fixtureBytes, contentType: 'application/octet-stream' }));
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>prof</title></head><body style="margin:0"><div id="app"></div>
<script type="module">
import { CityScene } from '/src/game/CityScene.ts';
import { deserializeCity } from '/src/save/serialize.ts';
import { unpackFile } from '/src/save/bundle.ts';
const P = new URLSearchParams(location.search);
const bytes = new Uint8Array(await (await fetch('/__fixture.metropolis')).arrayBuffer());
const state = deserializeCity(await unpackFile(bytes));
if (P.has('startDay')) state.day = +P.get('startDay');
const scene = new CityScene({ container: document.getElementById('app'), state, onExitToRegion: () => {}, onSave: async () => {},
  settings: { quality: P.get('quality') || 'low', autosaveMonths: 0 }, initialSpeed: 0 });
window.__scene = scene;
scene.ctx.ui.on('viewsReady', () => { window.__viewsReady = true; });
scene.start();
</script></body></html>`;
  await page.route('**/__prof.html*', (r) => r.fulfill({ status: 200, body: html, contentType: 'text/html' }));
  const t0 = Date.now();
  log('goto');
  page.on('requestfailed', (r) => log('requestfailed', r.url().slice(0, 120), r.failure()?.errorText));
  await page.goto(`${base}__prof.html?quality=${args.quality ?? 'low'}${args.startDay ? '&startDay=' + args.startDay : ''}`, { waitUntil: 'load', timeout: 0 });
  log('page loaded');
  const tick = setInterval(async () => { try { log('waiting', JSON.stringify(await page.evaluate(() => ({ vr: window.__viewsReady ?? null, sys: window.__scene?.sim?.systems?.length ?? -1, day: window.__scene?.sim?.state?.day ?? -1, t: document.title })))); } catch (e) { log('probe failed', String(e).slice(0, 100)); } }, 20000);
  await page.waitForFunction(() => window.__viewsReady === true && window.__scene?.sim?.systems?.length > 0, null, { timeout: 0, polling: 500 });
  clearInterval(tick);
  log(`scene ready in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  // camera over the city centre, then a few frames to settle
  await page.evaluate(async (CAMD) => {
    const s = window.__scene;
    s.ctx.focusCell(s.sim.state.size / 2, s.sim.state.size / 2, CAMD);
    s.ctx.onboarding?.hide?.(false);
    try { s.onboarding?.hide(false); } catch {}
  }, +(args.camDist ?? 900));
  // instrumentation (marks); sub-phase labels read from the systems like the node harness
  await page.evaluate(async () => {
    const scene = window.__scene, sim = scene.sim;
    const { schedulerOf } = await import('/src/sim/infra/scheduler.ts');
    const M = (n) => performance.mark(n);
    window.__on = false;
    const on = () => window.__on;
    const sys = (n) => sim.getSystem(n);
    const TR = ['prep', 'prepTransit', 'transit', 'roundSearch', 'roundMatch', 'commute', 'inbound', 'shop', 'freight', 'final', 'final2'];
    const UT = ['uses', 'label', 'power', 'brownout', 'water', 'waterBrownout'];
    const PO = ['garbSrc', 'garbRoute', 'garbApply', 'srcBld', 'srcCells', 'airNear', 'airFar', 'noise', 'water', 'flags'];
    const SV = ['prep', 'tiers', 'stops', 'nimby', 'accSeed', 'accSearch', 'accLand', 'shopA', 'shopB', 'foot', 'finish'];
    const sub = (t) => {
      try {
        if (t === 'traffic') { const x = sys('traffic'); return x.phase < 0 ? 'prep' : x.phase === 0 && x.graphDirty ? 'rebuild' : TR[x.phase]; }
        if (t === 'utilities') { const i = sys('utilities').stepIdx; return UT[i < 0 ? 0 : i]; }
        if (t === 'pollution') { const i = sys('pollution').stepIdx; return PO[i < 0 ? 0 : i]; }
        if (t === 'services') { const i = sys('services').stepIdx; return SV[i < 0 ? 0 : i]; }
        if (t === 'crime') { const i = sys('crime').stepIdx; return ['sources', 'spread', 'flags'][i < 0 ? 0 : i]; }
        if (t === 'emergency.response') { const i = sys('emergency').respStep; return 'resp' + (i < 0 ? 0 : i); }
      } catch {}
      return '-';
    };
    const wrap = (obj, key, label) => {
      const f = obj[key];
      if (typeof f !== 'function') return;
      obj[key] = function (...a) { if (!on()) return f.apply(this, a); const l = typeof label === 'function' ? label() : label; M('>' + l); try { return f.apply(this, a); } finally { M('<' + l); } };
    };
    // frame = CityScene.loop (arrow property; the loop re-reads this.loop for the next rAF)
    const loop = scene.loop;
    let fno = 0;
    scene.loop = (now) => { if (!on()) return loop(now); M('>F'); try { loop(now); } finally { M('<F'); if (++fno % 30 === 0) performance.clearMarks(); } };
    wrap(sim, 'update', 'U');
    wrap(sim, 'advanceDay', 'D');
    for (const s of sim.systems) for (const k of ['daily', 'monthly', 'yearly', 'frame']) wrap(s, k, `S:${s.name}.${k}`);
    for (const t of schedulerOf(sim).tasks) wrap(t, 'step', () => `T:${t.name}:${sub(t.name)}`);
    const em = sim.events.emit;
    sim.events.emit = function (type, p) { if (!on()) return em.call(this, type, p); M('>E:' + type); try { return em.call(this, type, p); } finally { M('<E:' + type); } };
    for (const [o, k, l] of [[scene.world, 'update', 'R:world.update'], [scene.objects, 'update', 'R:objects.update'], [scene.world, 'render', 'R:world.render']]) if (o) wrap(o, k, l);
    window.__startDay = sim.state.day;
  });
  // warm-up at ultra (not traced)
  await page.evaluate((w) => new Promise((res) => { const s = window.__scene; s.sim.speed = 3; const d0 = s.sim.state.day; const f = () => (s.sim.state.day - d0 >= w ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), WARM);
  log(`warm-up ${WARM} days done; day ${await page.evaluate(() => window.__scene.sim.state.day)}`);
  const cdp = await ctx.newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', (d) => { for (const e of d.value) events.push(e); });
  const traced = new Promise((r) => cdp.on('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['blink.user_timing', 'disabled-by-default-devtools.timeline', 'devtools.timeline', 'v8', 'toplevel'] }, transferMode: 'ReportEvents' });
  if (args.cdpprof) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  const load0 = readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');
  const run = await page.evaluate((days) => new Promise((res) => {
    const s = window.__scene; const st = s.sim.state; const d0 = st.day; const t0 = performance.now(); let frames = 0;
    window.__on = true;
    const f = () => { frames++; if (st.day - d0 >= days) { window.__on = false; res({ d0, d1: st.day, frames, wallMs: performance.now() - t0, pop: st.stats.population, buildings: st.buildings.size }); } else requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }), DAYS);
  const load1 = readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');
  log('run', JSON.stringify(run), 'load', load0, '->', load1);
  let cpuprofile = null;
  if (args.cdpprof) cpuprofile = (await cdp.send('Profiler.stop')).profile;
  await cdp.send('Tracing.end');
  await traced;
  log(`trace events ${events.length}`);
  // keep only what the analysis needs
  const keep = events.filter((e) => e.cat === 'blink.user_timing' || ['MinorGC', 'MajorGC', 'V8.GC_SCAVENGER', 'V8.GCScavenger', 'MinorGCLatency', 'V8.GCIncrementalMarking', 'V8.GCFinalizeMC', 'BlinkGC.AtomicPhase', 'ThreadControllerImpl::RunTask', 'RunTask', 'FireAnimationFrame', 'Animation Frame Fired'].includes(e.name));
  writeFileSync(`${OUT}.trace.json`, JSON.stringify({ run, load: [load0, load1], events: keep }));
  if (cpuprofile) writeFileSync(`${OUT}.cpuprofile`, JSON.stringify(cpuprofile));
  log(`wrote ${OUT}.trace.json (${keep.length} events)`);
} finally {
  await browser.close();
  await server.close();
}
