#!/usr/bin/env node
/**
 * T084's browser check (NOTE-073 item 2): the sun -> moon handover must not stall the game.
 *
 * WorldView used to hide the sun light for the minutes the direct light is off (after dusk, before dawn). three.js keys
 * every program on the light and shadow counts, so every material in view needed a second program at the first dusk
 * after a city entry, and three waited for each link in the same frame: one frame of 3.4-5.3 s on the real GPU, on every
 * quality. The light now stays in the light state at intensity 0. This check loads a city, pauses the simulation and
 * runs the view's own clock (scene.world.timeOfDay, then its autoTime at the game's 2 game minutes a second) through
 * 18:50-20:10 and 05:00-06:30, one sample per animation frame. It fails on
 *   - a frame over 250 ms (judged on a real GPU; with software GL every frame is slow, so the lengths are only printed),
 *   - any change of renderer.info.programs.length, inside a window or between the first and the last,
 *   - the sun light leaving three's light state (visible, castShadow, shadowMap.enabled; intensity 0 while it is off),
 *   - a window without the handover in it (the direct light must go off and come back on, or the window proves nothing),
 * and prints each window's largest frame and the program counts.
 *
 * Usage:  node tools/qa-nightfall.mjs [--gpu] [--headed] [--exe <chrome>] [--channel <name>] [--profile <dir>]
 *              [--host default|worker|loopback] [--prod] [--dist <dir>] [--url <base>] [--cache <vite cache dir>]
 *              [--quality low|medium|high|ultra] [--size small|medium|large] [--seed N] [--region <file>]
 *              [--windows 18:50-20:10,05:00-06:30] [--time-scale 2] [--max-frame 250] [--settle 5] [--timeout 900]
 *              [--out <dir>] [--shots <dir>]
 *   --gpu        Chromium on this machine's GPU (--enable-gpu --ignore-gpu-blocklist --use-angle=default); without it
 *                SwiftShader, as the other qa tools. The frame limit is judged whenever WebGL is not software.
 *   --headed, --exe <path>, --channel <name>   how Chromium is started (a window; another binary; Playwright's channel)
 *   --profile    the browser profile. Default: a fresh one in the temp folder for every run, removed afterwards (a profile
 *                that has seen the handover has the second programs in its GPU shader cache, which hides the stall)
 *   --host       default (the simulation on the main thread), worker (?simworker=1) or loopback (?simworker=loopback)
 *   --prod       the production build: vite build into the temp folder (or --dist <dir>, already built), vite preview.
 *                Default: its own Vite dev server (HMR off) on a free port
 *   --url        a server that is already running, instead of starting one (with --prod: it serves a production build)
 *   --quality    default high with --gpu, else low
 *   --size, --seed   the quickstart city (?quickstart=1; default small): new terrain with water and trees, no buildings
 *   --region     a .region.metropolis file to import and enter instead (its first city): a built city has more
 *                materials in view. Dev server: through /src/save; production build: through the title screen's dialogs
 *   --windows    the spans of the view's clock, HH:MM-HH:MM, comma separated
 *   --time-scale game minutes per real second while a window runs (the game's own: 2). A frame moves the clock by at
 *                most 0.1 s of it, so with software GL keep it at or under 6 or the 1.5 minutes at dusk are stepped over
 *   --max-frame  the frame limit in ms (given explicitly, it is judged with software GL too)
 *   --settle     seconds between the city's first frame and the first window
 *   --timeout    seconds a window may take
 *   --out        a folder for qa-nightfall.json (every frame's length and hour, the checks)
 *   --shots      a folder for a screenshot at the end of each window
 * Exit 1 on any failed check. The page-side probe and the verdicts are tools/qa-nightfall-probe.mjs (unit-tested in
 * tests/render/nightfall.test.ts on a WorldView without a GL context).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer, preview } from 'vite';
import { chromium } from 'playwright';
import { describeWindow, hhmm, installNightfallProbe, nightfallChecks, parseWindows } from './qa-nightfall-probe.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const VALUES = ['--exe', '--channel', '--profile', '--host', '--dist', '--url', '--cache', '--quality', '--size', '--seed', '--region', '--windows', '--time-scale', '--max-frame', '--settle', '--timeout', '--out', '--shots'];
const FLAGS = ['--gpu', '--headed', '--prod', '--help', '-h'];
const USAGE = 'node tools/qa-nightfall.mjs [--gpu] [--headed] [--exe <chrome>] [--channel <name>] [--profile <dir>] [--host default|worker|loopback] [--prod] [--dist <dir>] [--url <base>]\n'
  + '    [--cache <dir>] [--quality low|medium|high|ultra] [--size small|medium|large] [--seed N] [--region <file>] [--windows 18:50-20:10,05:00-06:30]\n'
  + '    [--time-scale 2] [--max-frame 250] [--settle 5] [--timeout 900] [--out <dir>] [--shots <dir>]      (see the head of this file)';
const die = (msg) => {
  console.error(`[nightfall] ${msg}\n${USAGE}`);
  process.exit(2);
};
for (let i = 0; i < argv.length; i++) {
  if (VALUES.includes(argv[i])) {
    if (i + 1 >= argv.length) die(`${argv[i]} needs a value`);
    i++;
  } else if (!FLAGS.includes(argv[i])) die(`unknown option ${argv[i]}`);
}
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : d;
};
const flag = (k) => argv.includes(k);
if (flag('--help') || flag('-h')) {
  console.log(USAGE);
  process.exit(0);
}
const number = (k, d) => {
  const v = Number(arg(k, d));
  if (!Number.isFinite(v) || v <= 0) die(`${k} must be a positive number`);
  return v;
};
const oneOf = (k, d, list) => {
  const v = arg(k, d);
  if (!list.includes(v)) die(`${k} must be one of ${list.join(', ')}`);
  return v;
};
const GPU = flag('--gpu'), HEADED = flag('--headed'), PROD = flag('--prod');
const EXE = arg('--exe', null), CHANNEL = arg('--channel', null), PROFILE = arg('--profile', null);
const HOST = oneOf('--host', 'default', ['default', 'worker', 'loopback']);
const DIST = arg('--dist', null), URL_BASE = arg('--url', null);
const CACHE = arg('--cache', join(tmpdir(), 'metropolis-qa-nightfall-vite'));
const QUALITY = oneOf('--quality', GPU ? 'high' : 'low', ['low', 'medium', 'high', 'ultra']);
const SIZE = oneOf('--size', 'small', ['small', 'medium', 'large', '64', '128', '256']);
const SEED = arg('--seed', null), REGION = arg('--region', null);
let WINDOWS;
try {
  WINDOWS = parseWindows(arg('--windows', '18:50-20:10,05:00-06:30'));
} catch (e) {
  die(`--windows: ${e.message}`);
}
const TIME_SCALE = number('--time-scale', '2'), MAX_FRAME = number('--max-frame', '250'), SETTLE = number('--settle', '5'), TIMEOUT = number('--timeout', '900');
const OUT = arg('--out', null), SHOTS = arg('--shots', null);
const LOAD_TIMEOUT = 900000;
/** the host kind the city must report (SimHost.kind) */
const HOST_KIND = { default: 'local', worker: 'worker', loopback: 'loopback' }[HOST];

const log = (...a) => console.log('[nightfall]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (name, ok, detail, skipped = false) => {
  log(skipped ? 'INFO' : ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail));
  checks.push({ name, ok: skipped || !!ok, skipped, detail });
};
for (const d of [OUT, SHOTS]) if (d) mkdirSync(d, { recursive: true });

/** `p`, or an error once `ms` have passed (a page that stopped drawing frames never reports) */
const within = (p, ms, what) => {
  let timer;
  const late = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(what)), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
};

/** a free TCP port on the loopback interface (vite preview takes a fixed one) */
const freePort = () => new Promise((res, rej) => {
  const s = createNetServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

/** page side, before the game's code: the settings of the run. The clock follows the game (autoTime), no autosave, no New
 *  Year show (it takes the clock), and FH-21's slow-frame prompt already answered (it would offer another quality) */
function settingsInit({ quality }) {
  try {
    const merge = (key, patch) => {
      let v = {};
      try {
        v = JSON.parse(localStorage.getItem(key) ?? '{}') || {};
      } catch {
        v = {};
      }
      localStorage.setItem(key, JSON.stringify({ ...v, ...patch }));
    };
    merge('metropolis.settings', { quality, autosaveMonths: 0 });
    merge('metropolis.settings.v1', { quality, autoTime: true, autosaveMonths: 0, pauseWhenHidden: false, muteInBackground: false, newYear: 'off', yearReview: false, tips: false, cameraMoments: false });
    localStorage.setItem('metropolis.ui.slowPrompt', JSON.stringify({ shown: true, answer: 'keep' }));
  } catch {
    /* storage blocked */
  }
}

/** centre of the first visible `sel` whose text starts with `text` (screen px), or null */
const centreOf = (page, sel, text) => page.evaluate(([sel, text]) => {
  const e = [...document.querySelectorAll(sel)].find((x) => {
    const b = x.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && (!text || (x.textContent ?? '').trim().startsWith(text));
  });
  if (!e) return null;
  const b = e.getBoundingClientRect();
  return [b.x + b.width / 2, b.y + b.height / 2];
}, [sel, text ?? null]);

/** a real click on the first visible `sel` whose text starts with `text`, once it is there */
async function clickText(page, sel, text, timeout = 120000) {
  const t0 = Date.now();
  for (;;) {
    const p = await centreOf(page, sel, text);
    if (p) {
      await page.mouse.click(p[0], p[1]);
      return;
    }
    if (Date.now() - t0 > timeout) throw new Error(`no visible ${sel}${text ? ` "${text}"` : ''}`);
    await sleep(250);
  }
}

/** dev server: import the region file through the save module and enter its first city */
async function enterRegionByModule(page, file) {
  const b64 = readFileSync(file).toString('base64');
  await page.evaluate(async (b64) => {
    window.__ready = false;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const { importRegion } = await import('/src/save/index.ts');
    const region = await importRegion(new Blob([bytes]));
    const tile = region.tiles.find((t) => t.city);
    if (!tile) throw new Error('the region has no city');
    void window.__metropolis.continueInCity(region, tile.key);
  }, b64);
}

/** production build (no /src modules): the player's path, title -> Load Region -> Import file -> Open -> the tile -> Play */
async function enterRegionByUi(page, file) {
  await clickText(page, 'button', 'Load Region');
  await sleep(600);
  const chooser = page.waitForEvent('filechooser');
  await clickText(page, 'button', 'Import file');
  await (await chooser).setFiles(file);
  await clickText(page, '.region-row button', 'Open');
  await clickText(page, '.rc-item');
  await sleep(600);
  await clickText(page, 'button', 'Play');
}

/** a profile with an earlier session: the title screen offers its unsaved progress; the run discards it */
async function discardRecovery(page) {
  for (let i = 0; i < 16; i++) {
    await sleep(250);
    const p = await centreOf(page, '.modal-foot button, .modal button', 'Discard');
    if (!p) continue;
    await page.mouse.click(p[0], p[1]);
    log('recovery offer: Discard clicked');
    await sleep(800);
    return;
  }
}

const options = { gpu: GPU, headed: HEADED, exe: EXE, channel: CHANNEL, profile: PROFILE, host: HOST, prod: PROD, url: URL_BASE, quality: QUALITY, size: SIZE, seed: SEED, region: REGION,
  windows: WINDOWS, timeScale: TIME_SCALE, maxFrameMs: MAX_FRAME, settleS: SETTLE, timeoutS: TIMEOUT };
const result = { options, startedAt: new Date().toISOString(), url: null, chromium: null, env: null, before: null, after: null, windows: [], checks, pageErrors: [], consoleErrors: [] };
let server = null, context = null, tempProfile = null;
try {
  // ---- the page's server
  let base = URL_BASE;
  if (!base && PROD) {
    const outDir = DIST ?? join(tmpdir(), 'metropolis-qa-nightfall-dist');
    const configFile = join(root, 'vite.config.ts');
    if (!DIST) {
      const t = Date.now();
      await build({ root, configFile, cacheDir: CACHE, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
      log(`production build in ${outDir} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
    }
    const port = await freePort();
    server = await preview({ root, configFile, cacheDir: CACHE, logLevel: 'warn', build: { outDir }, preview: { port, strictPort: true, host: '127.0.0.1' } });
    base = `http://127.0.0.1:${port}`;
  } else if (!base) {
    server = await createServer({ root, cacheDir: CACHE, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
    await server.listen();
    base = `http://127.0.0.1:${server.httpServer.address().port}`;
  }
  base = base.replace(/\/+$/, '');

  // ---- the browser, on a fresh profile unless one is given
  const profile = PROFILE ?? (tempProfile = mkdtempSync(join(tmpdir(), 'metropolis-qa-nightfall-profile-')));
  const gl = GPU ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];
  context = await chromium.launchPersistentContext(profile, {
    headless: !HEADED,
    ...(EXE ? { executablePath: EXE } : {}),
    ...(CHANNEL ? { channel: CHANNEL } : {}),
    args: [...gl, '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  result.chromium = context.browser()?.version() ?? null;
  await context.addInitScript(settingsInit, { quality: QUALITY });
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(LOAD_TIMEOUT);
  page.on('pageerror', (e) => result.pageErrors.push(String(e.message).slice(0, 400)));
  page.on('crash', () => result.pageErrors.push('PAGE CRASH'));
  page.on('console', (m) => {
    if (m.type() === 'error' && result.consoleErrors.length < 50) result.consoleErrors.push(m.text().slice(0, 300));
  });

  // ---- the city
  const query = new URLSearchParams();
  if (!REGION) {
    query.set('quickstart', '1');
    query.set('size', SIZE);
    if (SEED !== null) query.set('seed', SEED);
  }
  if (HOST === 'worker') query.set('simworker', '1');
  if (HOST === 'loopback') query.set('simworker', 'loopback');
  const qs = query.toString();
  result.url = `${base}/index.html${qs ? `?${qs}` : ''}`;
  log(`${result.url}  (${PROD ? 'production build' : URL_BASE ? 'the server given' : 'dev server'}; profile ${tempProfile ? 'fresh' : profile}; ${GPU ? 'GPU' : 'SwiftShader'} flags; quality ${QUALITY})`);
  const t0 = Date.now();
  await page.goto(result.url, { waitUntil: 'load', timeout: LOAD_TIMEOUT });
  const cityUp = () => page.waitForFunction(() => {
    const c = window.__metropolis && window.__metropolis.city;
    return window.__ready === true && !!c && c.entered === true && !!c.scene;
  }, null, { timeout: LOAD_TIMEOUT, polling: 250 });
  if (REGION) {
    // (the title screen first. A dev server that finds new dependencies on the way into the city reloads the page, and
    // the import with it: then once more. A quickstart city just starts again by itself)
    for (let attempt = 1; ; attempt++) {
      await page.waitForFunction(() => window.__ready === true, null, { timeout: LOAD_TIMEOUT, polling: 250 });
      if (PROFILE) await discardRecovery(page);
      const reloaded = page.waitForEvent('load', { timeout: 0 }).then(() => true);
      try {
        if (PROD) await enterRegionByUi(page, resolve(REGION));
        else await enterRegionByModule(page, resolve(REGION));
      } catch (e) {
        if (!/context was destroyed|navigat/i.test(String(e))) throw e;
      }
      if (!(await Promise.race([cityUp().then(() => false), reloaded]))) break;
      if (attempt >= 3) throw new Error('the page reloaded each time the region was imported');
      log('the page reloaded on the way into the city: importing the region again');
    }
  } else await cityUp();
  log(`city entered after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await sleep(SETTLE * 1000);

  const env = await page.evaluate(() => {
    const sc = window.__metropolis.city.scene, w = sc.world, st = sc.host.state;
    let gpu = null;
    try {
      const gl = w.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    } catch {
      /* a stand-in view without a context */
    }
    return {
      gpu, host: sc.host.kind, quality: w.quality ?? null,
      realView: !w.isNull && !!w.sky && !!w.sun && !!w.renderer && !(sc.degraded && sc.degraded.world),
      day: st.day, dayOfYear: st.day % 360, size: st.size, buildings: st.buildings ? st.buildings.size : null, population: st.stats ? st.stats.population : null,
      autoTime: w.autoTime, timeScale: w.timeScale, timeOfDay: w.timeOfDay, dpr: window.devicePixelRatio, userAgent: navigator.userAgent,
    };
  });
  result.env = env;
  log('WebGL:', env.gpu, '| host:', env.host, '| quality:', env.quality, '| day', env.day, `(day ${env.dayOfYear} of the year)`, '| map', env.size, '| buildings', env.buildings, '| population', env.population);
  const software = !env.gpu || /swiftshader|llvmpipe|software|basic render/i.test(env.gpu);
  check('the city runs on the real world view (no stand-in)', env.realView, { quality: env.quality });
  check(`the simulation runs on the ${HOST} host`, env.host === HOST_KIND, { kind: env.host, expected: HOST_KIND });
  if (GPU) check('--gpu: WebGL runs on the GPU', !software, env.gpu);
  if (!env.realView) throw new Error('no real world view: nothing to measure');

  // ---- paused, settled: the probe and its baseline
  await page.evaluate(() => window.__metropolis.city.scene.host.setSpeed(0, 'keyboard'));
  await page.waitForFunction(() => window.__metropolis.city.scene.host.speed === 0, null, { timeout: 60000, polling: 100 });
  let before = await page.evaluate(installNightfallProbe);
  for (let i = 0; i < 20; i++) {
    // (a program still arriving after the load belongs to the load, not to a window)
    await sleep(1000);
    const s = await page.evaluate(() => window.__nightfall.state());
    const steady = s.programs === before.programs;
    before = s;
    if (steady) break;
  }
  result.before = before;
  log(`paused at ${hhmm(before.tod)}: ${before.programs} programs, sun light ${before.sunVisible ? 'visible' : 'HIDDEN'} at intensity ${before.sunIntensity.toFixed(4)}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'nightfall-0-start.png') });

  // ---- the windows of the view's clock
  for (let i = 0; i < WINDOWS.length; i++) {
    const win = { ...WINDOWS[i], timeScale: TIME_SCALE, maxFrameMs: MAX_FRAME, timeoutS: TIMEOUT };
    log(`${win.name}: running the view's clock at ${TIME_SCALE} game min/s ...`);
    const rep = await within(page.evaluate((w) => window.__nightfall.run(w), win), (TIMEOUT + 120) * 1000, `${win.name}: no report from the page after ${TIMEOUT + 120} s`);
    result.windows.push(rep);
    log(describeWindow(rep));
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `nightfall-${i + 1}-${win.name.replace(/[^\w]+/g, '-')}.png`) });
  }
  const after = await page.evaluate(() => window.__nightfall.state());
  result.after = after;

  // ---- the verdicts
  const judged = flag('--max-frame') || !software;
  if (!judged) log(`software GL (${env.gpu}): frame lengths are printed, not judged (run with --gpu, or give --max-frame)`);
  for (const c of nightfallChecks({ windows: result.windows, before, after }, { maxFrameMs: MAX_FRAME, enforceFrames: judged })) check(c.name, c.ok, c.detail, !!c.skipped);
  const crashed = await page.evaluate(() => [...document.querySelectorAll('.modal h2')].some((e) => e.textContent === 'The simulation stopped'));
  check('no page errors', result.pageErrors.length === 0 && !crashed, { pageErrors: result.pageErrors.slice(0, 5), simulationStopped: crashed });
  if (result.consoleErrors.length) log('console errors (not judged):', JSON.stringify(result.consoleErrors.slice(0, 5)));
  const largest = result.windows.reduce((a, w) => (w.maxMs > a.maxMs ? w : a), result.windows[0]);
  log(`largest frame: ${largest.maxMs} ms at ${largest.maxAt === null ? '-' : hhmm(largest.maxAt)} (${largest.name}); programs: ${before.programs} before, ${result.windows.map((w) => `${w.programs.start} -> ${w.programs.end}`).join(', ')}, ${after.programs} after`);
} catch (e) {
  check('the run completed', false, String(e?.stack ?? e));
} finally {
  if (OUT) {
    try {
      writeFileSync(join(OUT, 'qa-nightfall.json'), JSON.stringify(result));
      log('written', join(OUT, 'qa-nightfall.json'));
    } catch (e) {
      log('could not write the result', String(e));
    }
  }
  await context?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
  if (tempProfile) {
    try {
      rmSync(tempProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      log('could not remove the profile', tempProfile);
    }
  }
}
const failed = checks.filter((c) => !c.ok);
log(failed.length ? `FAILED: ${failed.map((c) => c.name).join('; ')}` : 'all checks passed');
process.exit(failed.length ? 1 : 0);
