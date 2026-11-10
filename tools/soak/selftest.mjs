// Browser-free checks. Explicit filename keeps this out of the app's Vitest suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { missingFixture, parseOptions } from './options.mjs';
import { Probe, hardwareRenderer, installTelemetry, pagePrototypes } from './telemetry.mjs';
import { assess, cadenceOverrun, heapTrend, lateHeapTrend, markdown } from './report.mjs';
import { CYCLE_STEPS, Driver, PANEL_IDS } from './driver.mjs';
import { MockPage, OWNERS, checkReads, loadParser, pageReads, pageShape } from './mockpage.mjs';
import { run } from './run.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const MiB = 1024 * 1024;

let model;
/** The one place every mock page takes its shape from: the members the source declares (mockpage.mjs), read once. */
const pageModel = () => model ??= loadParser().then(parseAst => ({ parseAst, shape: pageShape(parseAst, root) }));

/**
 * A Driver on a mock page, on a clock that jumps where the real one sleeps: a wait runs to its limit in no time.
 * A driver that slept for real against this clock would never reach a limit, so its stop hook ends it after a minute.
 */
function drive(page) {
  let now = 0, stop = null;
  setTimeout(() => { stop = 'A driver step on the mock page was still running after 60 s of real time'; }, 60_000).unref();
  return new Driver(page, { catalog: {}, cellSize: 16, pulse: async () => {}, checkStop: () => { if (stop) throw new Error(stop); }, event: () => {}, clock: { now: () => now, sleep: async ms => { now += ms; } } });
}

test('CLI units, fixture selection and unsafe/ambiguous arguments', () => {
  const o = parseOptions(['--city', 'small', '--minutes', '20'], root, {});
  assert.equal(o.durationMs, 1_200_000);
  assert.equal(o.cycleMs, 300_000);
  assert.equal(o.fixture, null);
  assert.equal(o.lateHeapMiBPerHour, 8);
  assert.equal(o.minDaysPerSec, 0);
  assert.equal(parseOptions(['--city', 'dense1m', '--min-days-per-sec', '15'], root, {}).minDaysPerSec, 15);
  assert.equal(parseOptions(['--city', 'dense1m'], root, {}).fixture, resolve(root, 'tools/bench/.fixtures/fixtures/dense1m_s7.metropolis'));
  assert.equal(parseOptions(['--city', 'dense1m'], root, { SIM_FIXTURES: here }).fixture, join(here, 'dense1m_s7.metropolis'));
  for (const args of [[], ['--city', 'vet'], ['--city', 'small', '--minutes', 'NaN'], ['--city', 'small', '--hours', '-1'], ['--city', 'small', '--port', '65536'], ['--city', 'small', '--minutes', '20', '--hours', '1'], ['--city', 'small', '--city', 'small'], ['--city', 'small', '--fixture', 'foo'], ['--city', 'small', '--exit-settle-seconds', '1'], ['--city', 'small', '--typo', '1'], ['--city', 'small', '--min-days-per-sec', '-1'], ['--city', 'small', '--late-heap-mib-per-hour', 'x']]) assert.throws(() => parseOptions(args, root, {}));
});

test('heap regression uses hours/MiB and rejects insufficient or zero-span data', () => {
  const points = [0, 0.5, 1, 1.5].map(h => ({ elapsedMs: 123456 + h * 3_600_000, heap: { usedSize: (40 + 8 * h) * MiB } }));
  assert.equal(heapTrend(points).slopeMiBPerHour, 8);
  assert.equal(heapTrend(points.slice(0, 2)), null);
  assert.equal(heapTrend([points[0], points[0], points[0]]), null);
  assert.equal(heapTrend(points.map(p => ({ ...p, heap: { usedSize: 100 * MiB - p.heap.usedSize } }))).slopeMiBPerHour, -8);
});

function passingLog() {
  return {
    options: parseOptions(['--city', 'small', '--minutes', '20'], root, {}),
    startedAt: 'test-only', provenance: { branch: 'test', head: 'test', namedBase: 'test' },
    completed: true, observedMs: 1_200_000, finalExit: true, build: { ok: true }, gpu: { hardware: true, renderer: 'test renderer' },
    cycles: Array.from({ length: 4 }, () => ({ completed: true, steps: CYCLE_STEPS.map(name => ({ name, ok: true })) })),
    exits: [0, 300_000, 600_000, 900_000, 1_200_000].map(elapsedMs => ({ label: 'test', elapsedMs, heap: { usedSize: (40 + elapsedMs / 3_600_000 * 8) * MiB }, counts: { CityScene: 0, CityState: 0, WebGLRenderer: 1 } })),
    samples: [0, 15_000].map(elapsedMs => ({ elapsedMs, phase: 'playing-ultra', sim: { days: 1, citySeconds: 15, runningSeconds: 15 }, frames: { city: { count: 100 } }, longTaskSupported: true, heap: { usedSize: 100 * MiB }, dom: { nodes: 500 }, losses: [], unexpectedLosses: 0 })),
    errorCounts: { console: 0, page: 0, harness: 0 }, crashes: 0, disconnects: 0,
  };
}

test('summary fails missing actions, retained cities, missing counts, crashes, errors, loss and unmeasured runs', () => {
  assert.equal(assess(passingLog()).pass, true);
  const failures = [
    log => { log.completed = false; },
    log => { log.cycles[0].steps.pop(); },
    log => { log.cycles[0].steps[0].ok = false; },
    log => { log.exits[0].counts.CityScene = 1; }, // even warm-up leaks fail
    log => { log.exits[2].counts.CityState = 1; },
    log => { delete log.exits[2].counts.WebGLRenderer; },
    log => { log.exits = log.exits.slice(0, 3); },
    log => { log.crashes = 1; },
    log => { log.disconnects = 1; },
    log => { log.errorCounts.console = 1; },
    log => { log.errorCounts.page = 1; },
    log => { log.errorCounts.harness = 1; },
    log => { log.samples[0].unexpectedLosses = 1; },
    log => { log.samples[0].longTaskSupported = false; },
    log => { log.samples = []; },
    log => { log.gpu.hardware = false; },
    log => { log.options.heapMiBPerHour = 1; },
    log => { log.observedMs = 0; },
  ];
  for (const mutate of failures) { const log = passingLog(); mutate(log); assert.equal(assess(log).pass, false, mutate.toString()); }
  const log = passingLog();
  log.samples[0].losses.push({ intentional: true });
  assert.equal(assess(log).pass, true);
  assert.match(markdown(log, assess(log)), /\*\*PASS\*\* 0 cities left/);
});

test('NOTE-026: the second-half slope catches a late leak the whole-run slope passes; short runs are n/a; the days/s floor', () => {
  // 4 hours, an exit every 5 minutes: flat for 2 hours, then +10 MiB/hour (whole-run fit 5 MiB/hour, second half 10)
  const longLog = (heapAt) => {
    const log = passingLog();
    log.options = parseOptions(['--city', 'small', '--hours', '4'], root, {});
    log.observedMs = 4 * 3_600_000;
    log.cycles = Array.from({ length: 48 }, () => ({ completed: true, steps: CYCLE_STEPS.map(name => ({ name, ok: true })) }));
    log.exits = Array.from({ length: 49 }, (_, i) => ({ label: 'test', elapsedMs: i * 300_000, heap: { usedSize: heapAt(i / 12) * MiB }, counts: { CityScene: 0, CityState: 0, WebGLRenderer: 1 } }));
    return log;
  };
  const gate = (log) => assess(log).gates.find(g => g.name === 'Second-half heap growth below threshold');
  const late = longLog(h => 40 + 10 * Math.max(0, h - 2));
  assert.ok(heapTrend(late.exits.slice(1)).slopeMiBPerHour < late.options.heapMiBPerHour);
  assert.ok(Math.abs(lateHeapTrend(late.exits.slice(1)).slopeMiBPerHour - 10) < 1e-9);
  assert.equal(gate(late).pass, false);
  assert.equal(assess(late).pass, false);
  assert.equal(assess(longLog(() => 40)).pass, true);
  const sparse = longLog(() => 40);
  sparse.exits = sparse.exits.filter((_, i) => i % 24 === 0); // 3 exits: 1 warm-up, then 2 samples
  assert.equal(gate(sparse).pass, false);
  assert.match(gate(sparse).detail, /insufficient data/);
  assert.equal(gate(passingLog()).pass, true); // the 20-minute smoke
  assert.match(gate(passingLog()).detail, /n\/a/);
  // the floor is off by default; on, it reads the sim's days per running second (the next test)
  assert.equal(assess(passingLog()).gates.some(g => g.name === 'Simulation rate at the floor'), false);
  const slow = passingLog();
  slow.options.minDaysPerSec = 15;
  assert.equal(assess(slow).pass, false);
  for (const s of slow.samples) s.sim.days = 240;
  assert.equal(assess(slow).pass, true);
});

test('NOTE-081: the days/s floor reads running seconds: a cycle\'s pauses do not fail it, a slow, stalled or unmeasured sim does', () => {
  const floor = log => assess(log).gates.find(g => g.name === 'Simulation rate at the floor');
  // a sample of a city left to play, of a cycle's pause, and of a sim that stood paused while it was left to play
  const sample = (phase, days, citySeconds, runningSeconds) => ({ ...passingLog().samples[0], phase, sim: { days, citySeconds, runningSeconds } });
  const play = (days, seconds = 12) => sample('playing-ultra', days, seconds, seconds);
  const cyclePause = seconds => sample('zone-road-bulldoze', 0, seconds, 0);
  const stall = seconds => sample('playing-ultra', 0, seconds, 0);
  const run = (...samples) => ({ ...passingLog(), options: { ...passingLog().options, minDaysPerSec: 15 }, samples });

  // T082's loaded hour, in proportion: 17.83 days/s while the sim ran, 12.59 with the cycles' pauses in the denominator
  const paused = run(play(214), play(214), cyclePause(5), cyclePause(5));
  assert.equal(floor(paused).pass, true);
  assert.match(floor(paused).detail, /^17\.83 days\/s per running second >= 15; 12\.59 days\/s per city second, .* is informative$/);
  const result = assess(paused);
  assert.deepEqual([result.runningSeconds, result.citySeconds, result.idleSeconds], [24, 34, 0]);
  assert.ok(Math.abs(result.daysPerRunningSecond - 428 / 24) < 1e-12 && Math.abs(result.daysPerCitySecond - 428 / 34) < 1e-12);
  // the bar is where it was: under 15 while it ran fails, however short the pauses; exactly 15 passes
  assert.equal(floor(run(play(179), play(179))).pass, false);
  assert.equal(floor(run(play(180), play(180))).pass, true);

  // Only a cycle's pauses leave the rate. A sim that stood paused while left to play (an emergency lesson, a dialog)
  // keeps those 60 s in it: before NOTE-081 they failed the floor through the city seconds, and they still do.
  const stalled = run(play(214), play(214), cyclePause(5), cyclePause(5), stall(15), stall(15), stall(15), stall(15));
  assert.equal(floor(stalled).pass, false);
  assert.match(floor(stalled).detail, /^5\.10 days\/s per running second >= 15, with 60\.0 s paused between cycles counted as running; 4\.55 days\/s per city second/);
  assert.equal(assess(stalled).idleSeconds, 60);
  // the same 60 s paused inside a cycle (its inspections, its save) are the harness's own
  const cycling = run(play(214), play(214), cyclePause(5), cyclePause(5), cyclePause(15), cyclePause(15), cyclePause(15), cyclePause(15));
  assert.equal(floor(cycling).pass, true);
  assert.equal(assess(cycling).idleSeconds, 0);
  assert.match(floor(cycling).detail, /^17\.83 days\/s per running second >= 15; 4\.55 days\/s per city second/);

  // No rate is a failure, never a pass on the other number: no running time measured; and a run that died in its first
  // cycle, never left to play (T082's unpatched run: 3 days over 0.1 running seconds would read 28 days/s)
  for (const [log, why] of [
    [run(sample('playing-ultra', 300, 15, undefined), sample('playing-ultra', 300, 15, undefined)), 'no running time was measured'],
    [run(sample('inspect-growable', 3, 30, 0.1), sample('panels-and-data', 0, 15, 0)), 'the city was never left to play between cycles'],
  ]) {
    assert.equal(floor(log).pass, false);
    assert.equal(floor(log).detail.startsWith(`no rate (${why}) for the floor of 15 days/s per running second; `), true, floor(log).detail);
    assert.equal(assess(log).daysPerRunningSecond, null);
  }
  assert.equal(floor(run(play(0), play(0))).pass, false);

  // both numbers are in the summary whether or not the floor is on
  const line = assess({ ...stalled, options: { ...stalled.options, minDaysPerSec: 0 } }).gates.at(-1);
  assert.equal(line.name, 'Telemetry present and simulation advances');
  assert.match(line.detail, /428 sim days: 5\.10 days\/s over 24\.0 running seconds and 60\.0 s paused between cycles, 4\.55 days\/s over 94\.0 city seconds \(the cycles' pauses included\)$/);
  assert.match(markdown(paused, result), /sim days per running second/);
  assert.match(markdown(paused, result), /Simulation host: not read\./);
  assert.match(markdown({ ...paused, initialCity: { host: 'local' } }, result), /Simulation host: local\./);
});

test('hardware gate rejects software and unknown renderers', () => {
  for (const name of ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11)', 'ANGLE (AMD, Radeon RX 6800 Direct3D11)']) assert.equal(hardwareRenderer(name), true);
  for (const name of ['', 'WebKit WebGL', 'ANGLE (Google, Vulkan SwiftShader Device)', 'llvmpipe (LLVM 15)', 'ANGLE (Microsoft Basic Render Driver)', 'Intel software rasterizer', 'ANGLE (Microsoft, WARP)']) assert.equal(hardwareRenderer(name), false);
});

function fakeCDP(failMethod = '') {
  const calls = [];
  return { calls, async send(method, params) {
    calls.push({ method, params });
    if (method === failMethod) throw new Error('injected CDP failure');
    if (method === 'Runtime.evaluate') return { result: { objectId: `proto:${params.expression.split('.').at(-1)}` } };
    if (method === 'Runtime.queryObjects') return { objects: { objectId: params.prototypeObjectId.replace('proto:', 'array:') } };
    if (method === 'Runtime.callFunctionOn') return { result: { value: params.objectId.endsWith('WebGLRenderer') ? 1 : 0 } };
    return {};
  } };
}

test('queryObjects never leaks remote handles, including failures', async () => {
  const cdp = fakeCDP(), probe = new Probe(cdp);
  assert.deepEqual(await probe.counts(), { CityScene: 0, CityState: 0, WebGLRenderer: 1 });
  assert.equal(cdp.calls.length, 12);
  for (let i = 0; i < 12; i += 4) {
    const calls = cdp.calls.slice(i, i + 4);
    assert.deepEqual(calls.map(c => c.method), ['Runtime.evaluate', 'Runtime.queryObjects', 'Runtime.callFunctionOn', 'Runtime.releaseObjectGroup']);
    assert.equal(new Set(calls.map(c => c.params.objectGroup)).size, 1);
    assert.ok(calls[0].params.objectGroup);
    assert.equal(calls[2].params.returnByValue, true);
  }
  for (const failMethod of ['Runtime.evaluate', 'Runtime.queryObjects', 'Runtime.callFunctionOn']) {
    const broken = fakeCDP(failMethod);
    await assert.rejects(new Probe(broken).counts(), /injected/);
    assert.equal(broken.calls.at(-1).method, 'Runtime.releaseObjectGroup');
  }
  await assert.rejects(probe.send('Runtime.evaluate', { expression: 'document' }), /objectGroup/);
});

test('bounded telemetry measures frame stalls and sim progress across visits without bridging region gaps; a pause is city time, not running time', async () => {
  let now = 0, frameCallback, taskCallback;
  const consoleArgs = [];
  const page = new MockPage((await pageModel()).shape, { globals: {
    performance: { now: () => now }, localStorage: { setItem() {} },
    requestAnimationFrame: fn => { frameCallback = fn; },
    HTMLCanvasElement: class { getContext() { return null; } },
    console: { log: (...args) => consoleArgs.push(args), error: (...args) => consoleArgs.push(args), assert: (...args) => consoleArgs.push(args) },
    PerformanceObserver: class {
      static supportedEntryTypes = ['longtask'];
      constructor(fn) { taskCallback = fn; }
      observe() {}
    },
  } });
  page.call(installTelemetry);
  const error = new Error('keep the stack text');
  page.context.console.error('example', error, { city: 'would be retained' });
  page.context.console.assert(false, { node: 'would be retained' });
  assert.equal(consoleArgs[0][1], error.stack);
  assert.equal(consoleArgs[0][2], '[object Object]');
  assert.equal(consoleArgs[1][0], false);
  assert.equal(consoleArgs.flat().some(v => v !== null && ['object', 'function', 'symbol'].includes(typeof v)), false);
  const game = page.game, drain = () => page.evaluate(() => window.__soakTelemetry.drain());
  const tick = ms => { now = ms; frameCallback(ms); };
  page.enterCity();
  Object.assign(game, { day: 0, speed: 3 });
  tick(0); game.day = 1; tick(16.5); game.day = 2; tick(117);
  taskCallback({ getEntries: () => [{ duration: 49 }, { duration: 100.5 }] });
  page.leaveCity(); tick(150);
  game.day = 500;
  page.enterCity();
  game.speed = 3;
  tick(200); game.day = 501; tick(250);
  // paused in the city, as a cycle's inspections are: 50 ms more of city time, none of running time
  game.speed = 0; tick(300);
  const data = await drain();
  assert.equal(data.sim.days, 3);
  assert.ok(Math.abs(data.sim.citySeconds - 0.217) < 1e-9 && Math.abs(data.sim.runningSeconds - 0.167) < 1e-9, JSON.stringify(data.sim));
  assert.ok(Math.abs(data.sim.daysPerRunningSecond - 3 / 0.167) < 1e-6 && Math.abs(data.sim.daysPerCitySecond - 3 / 0.217) < 1e-6, JSON.stringify(data.sim));
  assert.equal('daysPerSecond' in data.sim, false); // the name that did not say which seconds
  assert.deepEqual(data.state, { day: 501, population: 1_200_000, buildings: 2, speed: 0, quality: 'ultra' });
  assert.equal(data.frames.city.maxMs, 100.5);
  assert.equal(data.frames.city.p99Ms, 101);
  assert.equal(data.frames.region.count, 1);
  assert.equal(data.longTasks.count, 1);
  assert.equal(data.longTasks.maxMs, 100.5);
  const again = await drain();
  assert.equal(again.frames.city.count, 0);
  assert.equal(again.sim.days, 0);
  assert.equal(again.sim.daysPerRunningSecond, null);
});

test('the game loads the profile the soak seeds: Ultra, "Keep going", tips off, no camera moves, no first-run quality pick', async () => {
  // what installTelemetry leaves in localStorage before the app starts
  const stored = new Map();
  const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, String(value)); } };
  const context = vm.createContext({
    localStorage: storage, performance: { now: () => 0 }, requestAnimationFrame() {}, console: {},
    HTMLCanvasElement: class { getContext() { return null; } }, PerformanceObserver: class { static supportedEntryTypes = []; },
  });
  context.window = context;
  vm.runInContext(`(${installTelemetry})()`, context);
  // the game's own loaders, bundled as a run bundles its helpers: the app's settings, then the city's on top of them
  const { rolldown } = await import('rolldown');
  const dir = join(here, '.runs', `selftest-helpers-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const load = async (source, name) => {
    const bundle = await rolldown({ input: join(root, source), platform: 'node', logLevel: 'warn' });
    try { await bundle.write({ format: 'esm', dir, entryFileNames: name }); } finally { await bundle.close(); }
    return import(pathToFileURL(join(dir, name)).href);
  };
  const app = await load('src/region/settings.ts', 'app-settings.mjs'), game = await load('src/game/settings.ts', 'game-settings.mjs');
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    const profile = app.loadSettings();
    // a seeded profile is an existing one: a first run would take the device's quality instead of Ultra (FH-21)
    assert.equal(app.applyFirstRunQuality(profile, () => 'low'), false);
    const city = game.loadSettings(app.cityOverrides(profile)); // as CityScene loads them
    const seeded = { quality: 'ultra', autosaveMonths: 3, edgeScroll: false, emergencyUncovered: 'ignore', tips: false, newYearCamera: false, cameraMoments: false };
    // tips off: with them on, the first emergency no station covers pauses the game for its lesson, "Keep going" or not (FH-08)
    assert.deepEqual(Object.fromEntries(Object.keys(seeded).map(key => [key, city[key]])), seeded);
    // and what the README says stays on, stays on: the New Year show and the year in review
    assert.deepEqual([city.newYear !== 'off', city.yearReview], [true, true]);
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before); else delete globalThis.localStorage;
  }
});

test('context loss marks intentional disposal once, then detects later unexpected loss', () => {
  class Canvas {
    className = 'mp-canvas';
    isConnected = true;
    addEventListener(name, fn) { this[name] = fn; }
    getContext() { return this.gl; }
  }
  class GL {
    constructor(canvas) {
      this.canvas = canvas;
      this.extension = { loseContext() { canvas.webglcontextlost({ target: canvas, statusMessage: 'test' }); } };
    }
    getExtension() { return this.extension; }
  }
  const context = vm.createContext({
    performance: { now: () => 0 }, localStorage: { setItem() {} }, requestAnimationFrame() {},
    HTMLCanvasElement: Canvas, WebGLRenderingContext: GL,
    PerformanceObserver: class { static supportedEntryTypes = []; },
  });
  context.window = context;
  vm.runInContext(`(${installTelemetry.toString()})()`, context);
  const canvas = new Canvas(); canvas.gl = new GL(canvas);
  const gl = canvas.getContext('webgl');
  gl.getExtension('WEBGL_lose_context').loseContext(); // what three's renderer.forceContextLoss() calls
  canvas.webglcontextlost({ target: canvas, statusMessage: 'spontaneous' });
  const data = context.__soakTelemetry.drain();
  assert.equal(data.losses[0].intentional, true);
  assert.equal(data.losses[1].intentional, false);
  assert.equal(data.unexpectedLosses, 1);
});

test('real helper bundles compile without changing app code or launching Chromium', async () => {
  const { rolldown } = await import('rolldown');
  const dir = join(here, '.runs', `selftest-helpers-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const node = await rolldown({ input: join(here, 'fixture-entry.mjs'), platform: 'node', logLevel: 'warn' });
  try { await node.write({ format: 'esm', dir, entryFileNames: 'fixture.mjs' }); } finally { await node.close(); }
  const helpers = await import(pathToFileURL(join(dir, 'fixture.mjs')).href);
  assert.equal(helpers.cellSize, 16);
  assert.equal(helpers.catalog.civ_clinic.category, 'health');
  assert.equal(helpers.catalog.util_wind_turbine.name, 'Wind Turbine');
  const browser = await rolldown({ input: join(here, 'seed-entry.mjs'), platform: 'browser', logLevel: 'warn' });
  try {
    const code = (await browser.generate({ format: 'iife' })).output.find(o => o.type === 'chunk').code;
    assert.doesNotThrow(() => new vm.Script(code));
    assert.match(code, /__soakSeed/);
  } finally { await browser.close(); }
});

test('missing fixture produces honest FAIL JSON and Markdown without a build/browser', async () => {
  const missing = join(here, '.runs', `missing-fixture-${process.pid}-${Date.now()}.metropolis`);
  const result = await run(parseOptions(['--city', 'dense1m', '--minutes', '20', '--fixture', missing], root, {}));
  assert.equal(result.result.pass, false);
  const path = join(result.out, 'run.json');
  const log = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(log.completed, false);
  assert.equal(log.result.pass, false);
  assert.equal(log.build.ok, false);
  assert.match(log.failure, /Fixture missing/);
  // the reason says how to get one: the default path is gitignored, so a fresh worktree has no fixture
  assert.match(log.failure, /given with --fixture[\s\S]*npm run fixtures -- --only snap,dense1m[\s\S]*--fixture PATH, or SIM_FIXTURES=/);
  const summary = readFileSync(join(dirname(path), 'summary.md'), 'utf8');
  assert.match(summary, /FAIL/);
  assert.match(summary, /^Fixture: .*missing-fixture-.*\.metropolis \(not loaded\)\.$/m); // not the small city's line
});

test('a missing fixture says how to build or point at one; a cycle past its cadence names the busy machine', () => {
  const dense = parseOptions(['--city', 'dense1m'], root, {});
  assert.equal(dense.fixtureFrom, 'default');
  assert.match(missingFixture(dense), /^Fixture missing: .*dense1m_s7\.metropolis \(the default path\)\. The dense1m fixture is generated and gitignored, so a fresh worktree has none\. Build it in this tree.*: npm run fixtures -- --only snap,dense1m \(from Windows PowerShell: cmd\.exe \/d \/s \/c "npm run fixtures -- --only snap,dense1m"\)\. Or point at one that exists: --fixture PATH, or SIM_FIXTURES=/);
  assert.match(missingFixture(parseOptions(['--city', 'dense1m'], root, { SIM_FIXTURES: here })), /\(SIM_FIXTURES holds no dense1m_s7\.metropolis\)/);
  const vet = parseOptions(['--city', 'vet', '--fixture', 'nowhere/vet_s7_y43.region.metropolis'], root, {});
  assert.equal(vet.fixtureFrom, '--fixture');
  assert.match(missingFixture(vet), /\(given with --fixture\)\. The shared vet_s7_y43 save comes from `npm run fixtures -- --only cities --cities DIR`/);
  assert.equal(parseOptions(['--city', 'small'], root, {}).fixtureFrom, null);
  assert.throws(() => parseOptions(['--city', 'vet'], root, {}), /requires --fixture PATH \(vet_s7_y43\)\. The shared vet_s7_y43 save comes from/);

  // The cadence limit is where it was: a cycle still running when the next one is due (every 5 minutes by default) stops
  // the run, and the last cycle of a run has no next one. Cycle 3 of a 20-minute run: due at 10:00, the next at 15:00.
  const options = parseOptions(['--city', 'small', '--minutes', '20'], root, {});
  const cycle = { number: 3, scheduledMs: 600_000, startedMs: 600_400, endedMs: 912_400, completed: true, steps: [
    { name: 'inspect-growable', startedMs: 601_000, endedMs: 741_000 }, { name: 'save', startedMs: 741_000, endedMs: 742_000 },
    { name: 'reenter', startedMs: 800_000, endedMs: 860_000 }, { name: 'quality-low-high-ultra', startedMs: 860_000, endedMs: 905_000 },
  ] };
  assert.equal(cadenceOverrun(cycle, 899_999, 900_000, options), null);
  assert.equal(typeof cadenceOverrun(cycle, 900_000, 900_000, options), 'string');
  assert.equal(cadenceOverrun(cycle, 1_300_000, 1_200_000, options), null);
  const text = cadenceOverrun(cycle, 912_400, 900_000, options);
  assert.match(text, /^Action cycle 3 took 312 s and was still running when the next one was due \(one every 300 s, --cycle-minutes 5\), so the run stops here\. /);
  assert.match(text, /The usual cause is a busy machine: the harness, its build and Chromium run at below-normal priority/);
  assert.match(text, /Run the soak again with the machine to itself\. /);
  assert.match(text, /slowest steps: inspect-growable 140 s, reenter 60 s, quality-low-high-ultra 45 s\.$/);
  assert.match(cadenceOverrun({ ...cycle, steps: [] }, 912_400, 750_000, { ...options, cycleMs: 150_000 }), /--cycle-minutes 2\.5\).*slowest steps: none recorded\.$/);
});

test('every member the tool reads off window.__metropolis is one the source still declares (T082: city.state)', async () => {
  const { parseAst, shape } = await pageModel();
  // the scan follows optional chains, aliases and destructuring; a parameter of the same name hides an alias
  const paths = code => pageReads(parseAst, code, 'snippet.mjs').map(path => path.join('.'));
  assert.deepEqual(paths('() => window.__metropolis?.city?.scene?.panels.get(1)?.el'), ['city.scene.panels.get']);
  assert.deepEqual(paths('() => { const a = window.__metropolis, s = a?.city?.scene; return [1].map(a => a.busy).length + s.sim.speed + a.busy; }'), ['city.scene', 'city.scene.sim.speed', 'busy']);
  assert.deepEqual(paths('() => { const { city, busy: b } = window.__metropolis; const { scene: s } = city; return s.simReady && !b; }'), ['city', 'busy', 'city.scene', 'city.scene.simReady']);
  assert.deepEqual(paths('() => window.__ready && document.title'), []);

  const read = Object.fromEntries(Object.keys(OWNERS).map(owner => [owner, new Set()]));
  for (const file of ['driver.mjs', 'telemetry.mjs', 'run.mjs']) {
    const found = checkReads(shape, pageReads(parseAst, readFileSync(join(here, file), 'utf8'), file));
    assert.deepEqual(found.missing, [], `tools/soak/${file} reads a member that the source (${[...new Set(Object.values(OWNERS).map(o => o.file))].join(', ')}) no longer declares`);
    for (const owner in read) for (const name of found.read[owner]) read[owner].add(name);
  }
  // the scan sees the reads (one that found nothing would pass anything): save(), the canvas steps, the telemetry
  for (const [owner, names] of Object.entries({ app: ['city', 'busy', 'regionScreen'], city: ['scene', 'tile', 'lastSave', 'saving', 'saveFailed'], scene: ['sim', 'host', 'canvas', 'objects', 'worldView'], sim: ['state', 'speed'], state: ['day', 'buildings', 'config', 'network'] })) {
    for (const name of names) assert.ok(read[owner].has(name), `the scan lost the ${owner} read of ${name}`);
  }
  // the line T082's soak died on, as driver.mjs had it: the App's city record lost `state` in W0.6
  const before = pageReads(parseAst, '() => { const c = window.__metropolis.city; return { lastSave: c.lastSave, day: c.state.day, buildings: c.state.buildings.size, tileKey: c.tile.key }; }', 'driver-before-T088.mjs');
  assert.deepEqual(checkReads(shape, before).missing, ['window.__metropolis.city.state']);
  // and the mock page has a stand-in for every App, city-record and scene member read, so the steps below meet them
  const page = new MockPage(shape);
  page.enterCity();
  for (const owner of ['app', 'city', 'scene']) assert.deepEqual([...read[owner]].filter(name => !page.standIns[owner].has(name)), [], `mockpage.mjs gives these ${owner} members no stand-in`);
  // its records carry exactly the declared names: the source is where the shape comes from
  assert.deepEqual(Object.keys(page.app.city).sort(), [...shape.city].sort());
  assert.deepEqual(Object.keys(page.app.city.scene).sort(), [...shape.scene].sort());
});

test('Driver.save() on a page shaped like the real App record waits for the save and returns the saved city', async () => {
  const { shape } = await pageModel();
  const page = new MockPage(shape);
  page.enterCity();
  Object.assign(page.game, { speed: 3, day: 4321 });
  const driver = drive(page);
  const lastSave = page.game.lastSave;
  assert.deepEqual(await driver.save(), { lastSave: lastSave + 60_000, day: 4321, buildings: 2, tileKey: '3,4' });
  assert.equal(page.game.saves, 1);
  assert.equal(page.game.speed, 0); // saved paused
  assert.deepEqual(page.input.map(i => i.split(' ')[0]), ['click', 'key']); // real input only: Pause, then Ctrl+S
  assert.equal(page.input[1], 'key Control+s');

  // What a removed field does. T082: the record had no `state`, and the 10 selftests still passed. This page has only
  // what the source declares, so the same call fails here the way it does in the browser.
  for (const [owner, member, failure] of [
    ['city', 'tile', /page\.evaluate: TypeError: Cannot read properties of undefined \(reading 'key'\)/],
    ['scene', 'sim', /page\.evaluate: TypeError: Cannot read properties of undefined \(reading 'speed'\)/],
    ['city', 'lastSave', /Timed out: completed successful save/], // (the wait runs its 2 minutes on the jumping clock)
  ]) {
    const without = new MockPage({ ...shape, [owner]: new Set([...shape[owner]].filter(name => name !== member)) });
    without.enterCity();
    await assert.rejects(drive(without).save(), failure, `${owner}.${member}`);
  }
});

test('the save, exit and re-entry steps run on that page; the driver refuses a simulation host it does not measure', async () => {
  const { shape } = await pageModel();
  const page = new MockPage(shape);
  page.enterCity();
  const driver = drive(page);
  await driver.play();
  assert.equal(page.game.speed, 3);
  page.game.day = 777;
  await driver.pause();
  const saved = await driver.save();
  assert.equal(page.call(pagePrototypes), true); // Probe.capturePrototypes' page function
  await driver.exit();
  assert.equal(page.app.city, null);
  assert.equal(page.game.saves, 2); // "Save & exit to region" saves again
  const state = await driver.enter();
  assert.deepEqual(state, { size: 256, population: 1_200_000, buildings: 2, day: 777, quality: 'ultra', host: 'local', degraded: [], panels: PANEL_IDS, tileKey: saved.tileKey });
  assert.equal(page.call(pagePrototypes), true); // the same prototypes on the second visit
  assert.equal(page.game.speed, 1); // a loaded city resumes at normal speed until the cycle's last step
  await driver.play();
  assert.equal(page.game.speed, 3);
  page.openMenu();
  await driver.clear(); // Escape closes what a step left open
  assert.equal(page.game.menu, false);

  // A worker or loopback host has a `sim` too (a facade over its replica), so only the host's kind tells them apart.
  for (const hostKind of ['worker', 'loopback']) {
    const other = new MockPage(shape, { hostKind });
    other.enterCity();
    await assert.rejects(drive(other).readyCity(), new RegExp(`^Error: The soak supports the main-thread simulation host only \\('local'\\), and this page runs '${hostKind}' [\\s\\S]*would pass unmeasured`));
  }
  // an App without the host's kind (a later rename) is refused as well, not taken for the main thread
  const unknown = new MockPage({ ...shape, scene: new Set([...shape.scene].filter(name => name !== 'host')) });
  unknown.enterCity();
  await assert.rejects(drive(unknown).readyCity(), /this page runs 'null'/);
});
