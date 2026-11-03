#!/usr/bin/env node
/**
 * T029 browser gate: emergency slow-downs counted per 10 real minutes at ultra, on a big-city fixture, in the real game
 * (index.html, the local sim host), headless Chromium on SwiftShader. Counts, not timings.
 *
 *   node emgcount.mjs --root <tree> --region <F.region.metropolis> --label <name> --out <dir> [--minutes 10] [--react 3]
 *
 * The fixture is imported as a region file (tools/bench/baselines/toRegion.ts) and played through App.continueInCity.
 * The player uses real input only: a mouse click on the top bar's Ultra button at the start, and again `--react`
 * real seconds after the game left ultra without the player (an emergency slow-down or pause). The player never
 * dispatches and never dismisses a banner: a player who wants ultra and lets the city handle itself.
 * Read-only listeners in the page record every speed change, every policy snapshot (banners, LIVE) and every emergency
 * event (with its uncovered reason); nothing else is touched.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ROOT = resolve(arg('root'));
const REGION = resolve(arg('region'));
const LABEL = arg('label', 'run');
const OUT = resolve(arg('out', '.'));
const MINUTES = +arg('minutes', '10');
const REACT = +arg('react', '3');
const W = +arg('w', '960'), H = +arg('h', '540'), DSF = +arg('dsf', '1'), ZOOM = +arg('zoom', '0');
const NM = '/home/user/simcityweb/node_modules';
mkdirSync(OUT, { recursive: true });
const { createServer } = await import(`${NM}/vite/dist/node/index.js`);
const { chromium } = await import(`${NM}/playwright/index.mjs`);
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}] [${LABEL}]`, ...a);
const cacheDir = resolve(OUT, `.vite-${process.pid}`);

const server = await createServer({
  root: ROOT, configFile: `${ROOT}/vite.config.ts`, cacheDir, logLevel: 'error',
  server: { port: 0, host: '127.0.0.1', hmr: false, strictPort: false },
});
await server.listen();
const port = server.httpServer.address().port;
log('vite up on', port, 'root', ROOT);
let browser;
const shots = [];
try {
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
  await ctx.addInitScript(() => {
    try {
      // presentation only: low quality (SwiftShader), no autosave, no sound, no New Year show or review card, no tips;
      // the emergency settings stay at their defaults (live, major, slow-motion 3)
      localStorage.setItem('metropolis.settings.v1', JSON.stringify({ quality: 'low', autosaveMonths: 0, masterVolume: 0, pauseWhenHidden: false, newYear: 'off', yearReview: false, tips: false, cameraMoments: false }));
      // quality and autosave are app-level keys too (src/region/settings.ts SHARED_KEYS): they override the city's
      localStorage.setItem('metropolis.settings', JSON.stringify({ quality: 'low', autosaveMonths: 0, v: 3 }));
    } catch {}
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(0);
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message.slice(0, 300)); log('pageerror', e.message.slice(0, 200)); });
  page.on('console', (m) => { if (m.type() === 'error') { errors.push('console: ' + m.text().slice(0, 300)); } });
  const shot = async (name) => { const p = resolve(OUT, `${LABEL}-${name}.png`); await page.screenshot({ path: p }); shots.push(p); log('shot', p); };

  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 600000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000, polling: 500 });
  log('title screen up', ((Date.now() - t0) / 1000).toFixed(0), 's');
  const b64 = readFileSync(REGION).toString('base64');
  await page.evaluate(async (b64) => {
    window.__ready = false;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const { importRegion } = await import('/src/save/index.ts');
    const r = await importRegion(new Blob([bytes]));
    void window.__metropolis.continueInCity(r, r.tiles.find((t) => t.city).key);
  }, b64);
  await page.waitForFunction(() => {
    const sc = window.__metropolis?.city?.scene;
    return !!(window.__ready && sc && sc.sim.systems.some((s) => s.name === 'emergency') && sc.host.actions);
  }, null, { timeout: 1800000, polling: 1000 });
  const loadS = (Date.now() - t0) / 1000;
  log('city up', loadS.toFixed(0), 's');

  // read-only recorders
  const info = await page.evaluate(() => {
    const sc = window.__metropolis.city.scene, sim = sc.sim, st = sim.state;
    const R = (window.__t029 = { t0: performance.now(), speed: [], policy: [], emg: [], player: [], frames: 0 });
    const raf = () => { R.frames++; requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    const now = () => +((performance.now() - R.t0) / 1000).toFixed(2);
    sim.events.on('speedChanged', (s) => R.speed.push([now(), st.day, s, sim.liveSlowdown]));
    sim.events.on('emergency', (e) => R.emg.push([now(), st.day, e.type, e.id, e.kind, e.major ? 1 : 0, e.manualPossible ? 1 : 0, e.reason ?? '']));
    const ac = new AbortController();
    sc.host.policy.subscribe((p) => R.policy.push([now(), st.day, p.live ? 1 : 0, p.alerts.map((a) => a.id).join(','), p.toast?.text ?? '']), ac.signal);
    const em = sim.getSystem('emergency');
    const fire = st.buildings.size;
    return { population: st.stats.population, buildings: fire, day: st.day, year: st.year ?? null, speed: sim.speed, incidents: em.incidents().length,
      stations: em.stationList().length, quality: sc.settings?.quality ?? null, settings: JSON.parse(localStorage.getItem('metropolis.settings.v1')), app: JSON.parse(localStorage.getItem('metropolis.settings')) };
  });
  log('city', JSON.stringify(info));
  // the camera: ZOOM mouse-wheel notches in at the view's centre (real input; fewer objects for SwiftShader to draw)
  if (ZOOM) { await page.mouse.move(W / 2, H / 2 + 30); for (let k = 0; k < ZOOM; k++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(300); } }
  await shot('loaded');

  const box = await page.locator('.speed button[title="Ultra (3)"]').boundingBox();
  log('ultra button', JSON.stringify(box));
  // a real mouse click on the top bar's Ultra button (its place is fixed: the top bar does not move)
  const click = async (why) => {
    const at = await page.evaluate(() => +((performance.now() - window.__t029.t0) / 1000).toFixed(2));
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(([at, why]) => window.__t029.player.push([at, why]), [at, why]);
  };
  // settle 5 s paused-or-as-loaded, then the run starts with the player's click on Ultra
  await page.waitForTimeout(5000);
  const day0 = await page.evaluate(() => { window.__t029.t0 = performance.now(); window.__t029.frames = 0; window.__t029.speed.length = 0; window.__t029.policy.length = 0; window.__t029.emg.length = 0; return window.__metropolis.city.scene.sim.state.day; });
  await click('start');
  const tEnd = Date.now() + MINUTES * 60000;
  let offSince = -1, shotSlow = false, shotPause = false, nextShot = Date.now() + 5 * 60000, samples = 0, atUltra = 0;
  while (Date.now() < tEnd) {
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => { const sc = window.__metropolis.city.scene; return { speed: sc.sim.speed, live: sc.host.policy.live, alerts: sc.host.policy.alerts.length, day: sc.sim.state.day }; });
    samples++;
    if (s.speed === 3) { atUltra++; offSince = -1; continue; }
    if (s.speed === 0 && !shotPause) { shotPause = true; await shot('first-pause'); }
    if (s.speed === 1 && !shotSlow) { shotSlow = true; await shot('first-live'); }
    if (offSince < 0) offSince = Date.now();
    else if (Date.now() - offSince >= REACT * 1000) { await click(s.speed === 0 ? 'resume-pause' : 'restore-ultra'); offSince = -1; }
    if (Date.now() > nextShot) { nextShot = Infinity; await shot('mid'); }
  }
  if (nextShot !== Infinity) await shot('mid');
  const R = await page.evaluate(() => { const sc = window.__metropolis.city.scene; return { ...window.__t029, day1: sc.sim.state.day, pop1: sc.sim.state.stats.population, wall: (performance.now() - window.__t029.t0) / 1000 }; });
  await shot('end');

  // ---- counts
  // a policy slow-down: the speed drops below the player's (3 -> 1 LIVE, or -> 0) with no player click just before;
  // the player only ever clicks Ultra, so every drop is the policy's
  const drops = [];
  let prev = 3;
  for (const [t, day, sp, slow] of R.speed) {
    if (sp < prev) drops.push({ t, day, to: sp, slow });
    prev = sp;
  }
  const liveStarts = [];
  let lastLive = 0;
  const alertIds = new Set();
  for (const [t, , live, ids] of R.policy) {
    if (live && !lastLive) liveStarts.push(t);
    lastLive = live;
    for (const id of String(ids).split(',').filter(Boolean)) alertIds.add(+id);
  }
  const uncovered = new Map();
  for (const [t, day, type, id, kind, major, mp, reason] of R.emg) {
    if (type !== 'uncovered') continue;
    const u = uncovered.get(id) ?? { id, kind, major, reasons: new Set(), mp: 0, t };
    u.reasons.add(reason || '?'); if (mp) u.mp = 1;
    uncovered.set(id, u);
  }
  const byReason = {};
  for (const u of uncovered.values()) for (const r of u.reasons) byReason[r] = (byReason[r] ?? 0) + 1;
  const busyIds = new Set([...uncovered.values()].filter((u) => u.reasons.has('busy')).map((u) => u.id));
  const busyBannered = [...alertIds].filter((id) => busyIds.has(id) && ![...uncovered.get(id).reasons].some((r) => r !== 'busy'));
  const summary = {
    label: LABEL, root: ROOT, region: REGION, minutes: MINUTES, reactS: REACT, loadS: +loadS.toFixed(0), city: info,
    wallS: +R.wall.toFixed(1), fps: +(R.frames / R.wall).toFixed(2), viewport: `${W}x${H}`, dsf: DSF, zoom: ZOOM, days: R.day1 - day0, daysPerS: +((R.day1 - day0) / R.wall).toFixed(2), pop1: R.pop1,
    slowdowns: drops.length, toLive: drops.filter((d) => d.to === 1).length, toPause: drops.filter((d) => d.to === 0).length,
    liveEpisodes: liveStarts.length, bannersRaised: alertIds.size, playerClicks: R.player.length,
    ultraShare: +(atUltra / Math.max(1, samples)).toFixed(3),
    uncoveredIncidents: uncovered.size, uncoveredMajor: [...uncovered.values()].filter((u) => u.major).length, byReason,
    busyOnlyBannered: busyBannered.length,
    toasts: R.policy.filter((p) => p[4]).map((p) => [p[0], p[4]]),
    drops, player: R.player, errors, shots,
  };
  writeFileSync(resolve(OUT, `${LABEL}.json`), JSON.stringify({ summary, timeline: { speed: R.speed, policy: R.policy, emg: R.emg } }, null, 1));
  const { drops: _d, toasts: _t, player: _p, ...brief } = summary;
  log('RESULT', JSON.stringify(brief));
} finally {
  await browser?.close().catch(() => {});
  await server.close().catch(() => {});
  const { rmSync } = await import('node:fs');
  rmSync(cacheDir, { recursive: true, force: true });
}
