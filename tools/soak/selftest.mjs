// Browser-free checks. Explicit filename keeps this out of the app's Vitest suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseOptions } from './options.mjs';
import { Probe, hardwareRenderer, installTelemetry } from './telemetry.mjs';
import { assess, heapTrend, markdown } from './report.mjs';
import { CYCLE_STEPS } from './driver.mjs';
import { run } from './run.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const MiB = 1024 * 1024;

test('CLI units, fixture selection and unsafe/ambiguous arguments', () => {
  const o = parseOptions(['--city', 'small', '--minutes', '20'], root, {});
  assert.equal(o.durationMs, 1_200_000);
  assert.equal(o.cycleMs, 300_000);
  assert.equal(o.fixture, null);
  assert.equal(parseOptions(['--city', 'dense1m'], root, {}).fixture, resolve(root, 'tools/bench/.fixtures/fixtures/dense1m_s7.metropolis'));
  assert.equal(parseOptions(['--city', 'dense1m'], root, { SIM_FIXTURES: here }).fixture, join(here, 'dense1m_s7.metropolis'));
  for (const args of [[], ['--city', 'vet'], ['--city', 'small', '--minutes', 'NaN'], ['--city', 'small', '--hours', '-1'], ['--city', 'small', '--port', '65536'], ['--city', 'small', '--minutes', '20', '--hours', '1'], ['--city', 'small', '--city', 'small'], ['--city', 'small', '--fixture', 'foo'], ['--city', 'small', '--exit-settle-seconds', '1'], ['--city', 'small', '--typo', '1']]) assert.throws(() => parseOptions(args, root, {}));
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
    samples: [0, 15_000].map(elapsedMs => ({ elapsedMs, sim: { days: 1, citySeconds: 15 }, frames: { city: { count: 100 } }, longTaskSupported: true, heap: { usedSize: 100 * MiB }, dom: { nodes: 500 }, losses: [], unexpectedLosses: 0 })),
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

test('bounded telemetry measures frame stalls and sim progress across visits without bridging region gaps', () => {
  let now = 0, frameCallback, taskCallback;
  const consoleArgs = [];
  const context = vm.createContext({
    performance: { now: () => now }, localStorage: { setItem() {} },
    requestAnimationFrame: fn => { frameCallback = fn; },
    HTMLCanvasElement: class { getContext() { return null; } },
    console: { log: (...args) => consoleArgs.push(args), error: (...args) => consoleArgs.push(args), assert: (...args) => consoleArgs.push(args) },
    PerformanceObserver: class {
      static supportedEntryTypes = ['longtask'];
      constructor(fn) { taskCallback = fn; }
      observe() {}
    },
  });
  context.window = context;
  vm.runInContext(`(${installTelemetry.toString()})()`, context);
  const error = new Error('keep the stack text');
  context.console.error('example', error, { city: 'would be retained' });
  context.console.assert(false, { node: 'would be retained' });
  assert.equal(consoleArgs[0][1], error.stack);
  assert.equal(consoleArgs[0][2], '[object Object]');
  assert.equal(consoleArgs[1][0], false);
  assert.equal(consoleArgs.flat().some(v => v !== null && ['object', 'function', 'symbol'].includes(typeof v)), false);
  const state = { config: { regionId: 'r', tileX: 0, tileZ: 0 }, day: 0, stats: { population: 100 }, buildings: new Map() };
  context.__metropolis = { city: { scene: { sim: { state, speed: 3 }, settings: { quality: 'ultra' } } } };
  const tick = ms => { now = ms; frameCallback(ms); };
  tick(0); state.day = 1; tick(16.5); state.day = 2; tick(117);
  taskCallback({ getEntries: () => [{ duration: 49 }, { duration: 100.5 }] });
  context.__metropolis.city = null; tick(150);
  state.day = 500;
  context.__metropolis.city = { scene: { sim: { state, speed: 3 }, settings: { quality: 'ultra' } } };
  tick(200); state.day = 501; tick(250);
  const data = context.__soakTelemetry.drain();
  assert.equal(data.sim.days, 3);
  assert.equal(data.frames.city.maxMs, 100.5);
  assert.equal(data.frames.city.p99Ms, 101);
  assert.equal(data.longTasks.count, 1);
  assert.equal(data.longTasks.maxMs, 100.5);
  const again = context.__soakTelemetry.drain();
  assert.equal(again.frames.city.count, 0);
  assert.equal(again.sim.days, 0);
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
  assert.match(readFileSync(join(dirname(path), 'summary.md'), 'utf8'), /FAIL/);
});
