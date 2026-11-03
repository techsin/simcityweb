#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile, execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import { parseOptions, help, timeout } from './options.mjs';
import { Driver } from './driver.mjs';
import { Probe, hardwareRenderer, installTelemetry } from './telemetry.mjs';
import { assess, markdown } from './report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = parseOptions(process.argv.slice(2), root); }
  catch (error) { console.error(`${error.message}\n\n${help}`); process.exitCode = 2; }
  if (options?.help) console.log(help);
  else if (options) process.exitCode = (await run(options)).result.pass ? 0 : 1;
}

export async function run(options) {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${options.city}-${process.pid}`;
  const out = join(here, '.runs', id);
  mkdirSync(out, { recursive: true });
  const git = (...args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim(); } catch { return 'unavailable'; } };
  const log = {
    schemaVersion: 1, startedAt: new Date().toISOString(), options, out,
    provenance: { head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), namedBase: git('rev-parse', 'claude/beautiful-johnson-u2jqoz'), status: git('status', '--short'), node: process.version, platform: process.platform, release: os.release() },
    settings: { headless: true, viewport: { width: 1920, height: 1080 }, quality: 'ultra', speed: 3, emergencyUncovered: 'ignore', newYearCamera: false, autosaveMonths: 3, input: 'mouse/keyboard only after fixture seeding', consoleObjects: 'converted to text before native console to prevent Playwright retention' },
    build: { ok: false }, priority: [], samples: [], exits: [], cycles: [], errors: [],
    errorCounts: { console: 0, page: 0, harness: 0 }, crashes: 0, disconnects: 0,
    completed: false, observedMs: 0, finalExit: false,
  };
  let browser, browserServer, server, page, probe, buildChild;
  let closing = false, stopReason = null, phase = 'setup', start = null, nextSample = 0, lastPrint = 0;
  let buildKill;
  const killBuild = () => {
    if (!buildChild?.pid || buildChild.exitCode !== null) return Promise.resolve();
    if (buildKill) return buildKill;
    // Kill only the process tree started by this run (npm/cmd can have children).
    if (process.platform === 'win32') buildKill = new Promise(resolveKill => {
      execFile('taskkill.exe', ['/PID', String(buildChild.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }, () => resolveKill());
    });
    else {
      try { process.kill(-buildChild.pid, 'SIGTERM'); } catch { buildChild.kill(); }
      buildKill = Promise.resolve();
    }
    return buildKill;
  };
  const elapsed = () => start === null ? null : performance.now() - start;
  const event = (type, data = {}) => appendFileSync(join(out, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), elapsedMs: elapsed(), phase, type, ...data }) + '\n');
  const recordError = (kind, message) => {
    log.errorCounts[kind]++;
    const row = { kind, message: String(message).slice(0, 8000), phase, elapsedMs: elapsed() };
    // Full text events are streamed; cap the checkpoint's examples, not the counts.
    if (log.errors.length < 200) log.errors.push(row);
    event('error', row);
  };
  const atomic = (name, content) => { const p = join(out, name); writeFileSync(`${p}.tmp`, content); renameSync(`${p}.tmp`, p); };
  const checkpoint = () => {
    const result = assess(log);
    atomic('run.json', JSON.stringify({ ...log, result }, null, 2) + '\n');
    atomic('summary.md', markdown(log, result));
    return result;
  };
  const priority = (pid, name) => {
    const entry = { name, pid, requested: os.constants.priority.PRIORITY_BELOW_NORMAL };
    try { os.setPriority(pid, entry.requested); entry.actual = os.getPriority(pid); }
    catch (e) { entry.error = e.message; }
    log.priority.push(entry); event('priority', entry);
  };
  const checkStop = () => { if (stopReason) throw new Error(stopReason); };
  const onSignal = signal => { stopReason = `Interrupted by ${signal}`; event('interrupt', { signal }); void killBuild(); };
  const sigint = () => onSignal('SIGINT'), sigterm = () => onSignal('SIGTERM');
  process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
  const sample = async (force = false) => {
    checkStop();
    if (!probe || !page || (!force && performance.now() < nextSample)) return;
    const memory = await probe.memory();
    const measurements = await timeout(page.evaluate(() => window.__soakTelemetry.drain()), 45_000, 'telemetry drain');
    const row = { at: new Date().toISOString(), elapsedMs: elapsed(), phase, ...memory, ...measurements };
    log.samples.push(row); event('sample', row);
    nextSample = performance.now() + options.sampleMs;
    if (performance.now() - lastPrint >= 60_000) {
      lastPrint = performance.now();
      console.log(`[${row.elapsedMs === null ? 'setup' : (row.elapsedMs / 60_000).toFixed(1) + ' min'}] ${phase}: heap ${(row.heap.usedSize / 1048576).toFixed(1)} MiB, DOM ${row.dom.nodes}, pop ${row.state?.population ?? 'region'}`);
    }
    checkpoint();
  };
  const gpu = async () => {
    const info = await timeout(page.evaluate(() => {
      const gl = window.__metropolis.city.scene.worldView.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '', vendor: ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : '', version: String(gl.getParameter(gl.VERSION)), lost: gl.isContextLost() };
    }), 30_000, 'GPU check');
    info.hardware = hardwareRenderer(info.renderer) && !info.lost;
    log.gpu = info; event('gpu', info);
    if (!info.hardware) throw new Error(`Hardware WebGL renderer not verified: ${JSON.stringify(info)}`);
  };
  let driver;
  const retention = async label => {
    phase = 'region-settle';
    await driver.delay(options.exitSettleMs); // thumbnail renderer has a 15-second idle disposal
    await sample(true);
    // No instances or node handles are retained between this GC and queryObjects.
    const memory = await probe.memory(true);
    const counts = await probe.counts();
    const first = log.exits[0];
    const row = { label, at: new Date().toISOString(), elapsedMs: elapsed(), ...memory, counts, rendererDeltaFromFirstExit: first ? counts.WebGLRenderer - first.counts.WebGLRenderer : 0 };
    log.exits.push(row); event('exit-measurement', row); checkpoint();
    return row;
  };
  try {
    priority(process.pid, 'harness and in-process Vite preview');
    event('start', { provenance: log.provenance, options });
    checkpoint();
    if (options.fixture && !existsSync(options.fixture)) throw new Error(`Fixture missing: ${options.fixture}. See tools/soak/README.md; fixtures are never generated implicitly.`);
    console.log(`Soak output: ${out}\nBuild/setup begins; schedule this browser run between timing runs.`);

    // Generated output stays below tools/soak. This is the normal production
    // npm build, including its tsc --noEmit gate, with only outDir overridden.
    const dist = join(out, 'dist');
    const distRelative = relative(root, dist).replaceAll('\\', '/');
    const buildStarted = performance.now();
    await timeout(new Promise((resolveBuild, rejectBuild) => {
      const args = ['run', 'build', '--', '--outDir', distRelative];
      buildChild = process.platform === 'win32'
        ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npm run build -- --outDir ${distRelative}`], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        : spawn('npm', args, { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      if (buildChild.pid) priority(buildChild.pid, 'npm build');
      for (const stream of [buildChild.stdout, buildChild.stderr]) stream.on('data', chunk => { appendFileSync(join(out, 'build.log'), chunk); process.stdout.write(chunk); });
      buildChild.on('error', rejectBuild);
      buildChild.on('exit', (code, signal) => code === 0 ? resolveBuild() : rejectBuild(new Error(`npm run build exited ${code ?? signal}`)));
    }), 600_000, 'production build');
    buildChild = null;
    log.build = { ok: true, durationMs: performance.now() - buildStarted, command: `npm run build -- --outDir ${distRelative}` };
    checkStop();

    const { rolldown } = await import('rolldown');
    const helperDir = join(out, 'helpers');
    const nodeBundle = await rolldown({ input: join(here, 'fixture-entry.mjs'), platform: 'node', logLevel: 'warn' });
    try { await nodeBundle.write({ format: 'esm', dir: helperDir, entryFileNames: 'fixture.mjs' }); }
    finally { await nodeBundle.close(); }
    const helpers = await import(pathToFileURL(join(helperDir, 'fixture.mjs')).href);
    if (options.fixture) log.fixture = await helpers.prepareFixture(options.fixture, join(out, 'input.region.metropolis'));
    const browserBundle = await rolldown({ input: join(here, 'seed-entry.mjs'), platform: 'browser', logLevel: 'warn' });
    let seedCode;
    try { seedCode = (await browserBundle.generate({ format: 'iife' })).output.find(o => o.type === 'chunk').code; }
    finally { await browserBundle.close(); }

    const { preview } = await import('vite');
    server = await preview({ root, configFile: false, logLevel: 'warn', build: { outDir: dist }, preview: { host: '127.0.0.1', port: options.port, strictPort: true } });
    const origin = `http://127.0.0.1:${options.port}`;
    const { chromium } = await import('playwright');
    log.chromiumArgs = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
    browserServer = await chromium.launchServer({ headless: true, channel: 'chromium', args: log.chromiumArgs, timeout: 90_000 });
    priority(browserServer.process().pid, 'Chromium');
    browser = await chromium.connect(browserServer.wsEndpoint());
    log.browserVersion = browser.version();
    browser.on('disconnected', () => { if (!closing) { log.disconnects++; stopReason = 'Browser disconnected unexpectedly'; event('browser-disconnected'); } });
    const context = await browser.newContext({ viewport: log.settings.viewport, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await context.addInitScript(installTelemetry);
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(240_000);
    page.on('console', msg => {
      if (msg.type() === 'error') recordError('console', msg.text());
      else if (msg.type() === 'warning') event('console-warning', { message: msg.text().slice(0, 8000) });
      // Never msg.args(): those JSHandles can pin whole city graphs.
    });
    page.on('pageerror', error => recordError('page', error.stack ?? error.message));
    page.on('crash', () => { log.crashes++; stopReason = 'Page crashed'; event('page-crash'); });
    page.on('close', () => { if (!closing && !stopReason) { stopReason = 'Page closed unexpectedly'; recordError('harness', stopReason); } });

    // Fixture seeding is the only state setup outside player input. It uses the
    // real bundle decoder and IndexedDB adapter in a throwaway document. Navigate
    // away before the app loads so that helper prototypes/bytes cannot pollute GC.
    if (log.fixture) {
      const setupURL = `${origin}/__soak_setup__`;
      await page.route(setupURL, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Soak fixture setup</title>' }));
      await page.goto(setupURL);
      await timeout(page.evaluate(seedCode), 30_000, 'install fixture seeder');
      const seeded = await timeout(page.evaluate(async base64 => window.__soakSeed(base64), readFileSync(log.fixture.output).toString('base64')), 120_000, 'seed fixture');
      event('fixture-seeded', seeded);
      await page.unroute(setupURL);
    }
    seedCode = null;
    await page.goto(options.city === 'small' ? `${origin}/index.html?quickstart=1&size=small&terrain=flat&difficulty=sandbox&seed=7` : `${origin}/index.html`, { waitUntil: 'load' });
    probe = new Probe(await context.newCDPSession(page));
    driver = new Driver(page, { catalog: helpers.catalog, cellSize: helpers.cellSize, pulse: () => sample(), checkStop, event });
    if (options.city === 'small') await driver.foundSmall();
    else {
      await driver.wait('title ready', () => window.__ready === true, null, 240_000);
      await driver.click({ selector: 'button', contains: 'Load Region' });
      await driver.click({ selector: '.region-row .rr-actions button', text: 'Open' });
      const state = await driver.enter();
      if (state.population < 900_000) throw new Error(`Loaded large city is too small: ${state.population}`);
    }
    log.initialCity = await driver.readyCity();
    if (log.initialCity.quality !== 'ultra') throw new Error(`Initial graphics quality must be Ultra, got ${log.initialCity.quality}`);
    await gpu();
    await probe.capturePrototypes();
    const liveCounts = await probe.counts();
    event('live-count-sanity', liveCounts);
    if (liveCounts.CityScene !== 1 || liveCounts.CityState !== 1 || liveCounts.WebGLRenderer < 1) throw new Error(`Prototype sanity failed: ${JSON.stringify(liveCounts)}`);
    await driver.play();
    await sample(true); // drain setup telemetry before starting the duration clock
    start = performance.now();
    let due = 0, cycleNumber = 0;
    while (elapsed() < options.durationMs) {
      checkStop();
      if (elapsed() >= due) {
        const cycle = { number: ++cycleNumber, scheduledMs: due, startedMs: elapsed(), steps: [], completed: false };
        log.cycles.push(cycle);
        const step = async (name, fn) => {
          phase = name;
          const row = { name, startedMs: elapsed(), ok: false };
          cycle.steps.push(row); event('step-start', { cycle: cycle.number, name });
          try { row.detail = await fn(); row.ok = true; }
          finally { row.endedMs = elapsed(); event('step-end', { cycle: cycle.number, ...row }); checkpoint(); }
        };
        await driver.pause();
        await step('inspect-growable', () => driver.inspect('growable'));
        await step('inspect-service', () => driver.inspect('service'));
        await step('panels-and-data', () => driver.panels());
        await step('zone-road-bulldoze', () => driver.edits());
        let saved;
        await step('save', async () => (saved = await driver.save()));
        await step('exit', () => driver.exit());
        await step('retention', () => retention(`cycle-${cycle.number}`));
        await step('reenter', async () => {
          const state = await driver.enter();
          if (state.tileKey !== saved.tileKey || state.day < saved.day) throw new Error('Re-entry did not restore the saved city/day');
          await gpu();
          await probe.capturePrototypes();
          return state;
        });
        await step('quality-low-high-ultra', () => driver.quality());
        cycle.completed = true; cycle.endedMs = elapsed();
        event('cycle-complete', { number: cycle.number, elapsedMs: cycle.endedMs });
        due += options.cycleMs;
        if (elapsed() >= due && due < options.durationMs) throw new Error('Action cycle exceeded its cadence; increase --cycle-minutes and rerun');
        checkpoint();
      }
      phase = 'playing-ultra';
      await driver.delay(Math.min(1000, Math.max(1, options.durationMs - elapsed())));
    }
    log.observedMs = elapsed();
    await sample(true);
    phase = 'final-exit';
    await driver.save();
    await driver.exit();
    await retention('final');
    log.finalExit = true;
    await sample(true);
    log.completed = true;
  } catch (error) {
    log.failure = String(error.stack ?? error);
    log.observedMs = elapsed() ?? 0;
    recordError('harness', log.failure);
    console.error(log.failure);
  } finally {
    closing = true;
    await killBuild();
    // Each cleanup is bounded so the failure report is still written when the
    // browser/GPU is unhealthy. Closing the context is intentionally not an exit
    // leak measurement; only actual region transitions enter the zero-city gate.
    for (const [label, cleanup] of [
      ['browser', () => browser?.close()],
      ['browser-server', async () => {
        if (browserServer) {
          try { await timeout(browserServer.close(), 10_000, 'graceful browser-server close'); }
          catch { await browserServer.kill(); }
        }
      }],
      ['preview', () => server ? new Promise((res, rej) => {
        server.httpServer.closeAllConnections();
        server.httpServer.close(e => e ? rej(e) : res());
      }) : undefined],
    ]) {
      try { await timeout(Promise.resolve().then(cleanup), 15_000, `close ${label}`); }
      catch (error) { recordError('harness', `Cleanup ${label}: ${error.message}`); }
    }
    process.off('SIGINT', sigint); process.off('SIGTERM', sigterm);
    log.finishedAt = new Date().toISOString();
    event('finish', { completed: log.completed });
    const result = checkpoint();
    console.log(`${result.pass ? 'PASS' : 'FAIL'}: ${join(out, 'summary.md')}\nJSON: ${join(out, 'run.json')}`);
    return { out, result };
  }
}
