/** Browser-free tests of the acceptance oracle; run: node tools/qa-worker/selftest.mjs. Outside Vitest discovery. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseArgs, waitForAcks, poll, selectedChecks, CHECKS, brokenBuildVerdict, withCleanup, Report, Skipped, validateSession } from './harness.mjs';
import { installProbe, savedMarkers } from './page.mjs';
import { assertPortFree, breakAckPlugin } from './build.mjs';
import { assertNoCrashOverlay, freeze, hideForFreeze, resumeDelay, restoreVisibility } from './freeze.mjs';
import { owningLifecycleSession } from './lifecycle.mjs';
import { Driver, toolSelected, dispatchState } from './driver.mjs';
import { installProtector, protectorRows, watchProtectors } from './w1.mjs';
import { BROWSER_CHECKS, protectorCheck, recoveryMirror } from './checks.mjs';
import { JOURNAL_EXCLUDED, journalSkip, journalVerdict, readRecoveryIdb, recoveryMode, writeAtPagehide } from './journal.mjs';
import { GPU, SWIFTSHADER, pageRenderer, realGpuProblem } from './launch.mjs';
import { fakeIndexedDB } from './fake-idb.mjs';

const rows = (extra = {}) => [{ seq: 1, status: 'resolved', result: { ok: true }, ...extra }];
/** page globals a test stands in for; node has none of them */
const PAGE_GLOBALS = ['window', 'document', 'localStorage', 'indexedDB', 'PageTransitionEvent'];
const pageGlobal = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
afterEach(() => { globalThis.window?.__qaWorker?.dispose?.(); for (const name of PAGE_GLOBALS) delete globalThis[name]; });

test('CLI: loopback runs by default; worker shares the host switch; local W1 is optional', () => {
  assert.deepEqual(parseArgs([]), { host: 'loopback', gpu: true, swiftshader: false, headed: false, w1: true, ackTimeout: 8000, bootTimeout: 180000, port: 0 });
  assert.equal(parseArgs(['--host', 'local']).w1, false);
  assert.equal(parseArgs(['--host', 'loopback', '--break-ack', 'zone']).w1, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['--host', 'worker', '--w1', '--swiftshader']).host, 'worker');
  assert.equal(parseArgs(['--break-ack', 'zone']).only, 'zone');
  assert.equal(parseArgs(['--only', 'freeze']).only, 'freeze');
  for (const args of [['--host', 'other'], ['--out'], ['--ack-timeout', '-1'], ['--boot-timeout', 'NaN'], ['--drop-ack', 'unknown'], ['--host', 'local', '--digest-module', 'x.ts'], ['--wat'], ['--only', 'typo'], ['--break-ack', 'zone', '--only', 'freeze'], ['--break-ack', 'zone', '--drop-ack', 'zone']]) {
    assert.throws(() => parseArgs(args));
  }
});

test('CLI: --gpu states the real GPU (the default), --swiftshader is its opposite, --port names the preview port', () => {
  for (const host of ['local', 'loopback', 'worker']) assert.equal(parseArgs(['--host', host, '--gpu', '--port', '5692']).host, host);
  assert.deepEqual([parseArgs(['--gpu']).gpu, parseArgs(['--gpu']).swiftshader], [true, false]);
  assert.deepEqual([parseArgs(['--swiftshader']).gpu, parseArgs(['--swiftshader']).swiftshader], [false, true]);
  assert.throws(() => parseArgs(['--gpu', '--swiftshader']), /opposite renderers/);
  assert.throws(() => parseArgs(['--swiftshader', '--gpu']), /opposite renderers/);
  assert.equal(parseArgs(['--port', '5692']).port, 5692);
  assert.equal(parseArgs(['--port', '0']).port, 0, 'a free port, as without --port');
  for (const port of [[], ['-1'], ['65536'], ['5173.5'], ['http'], ['--gpu']]) assert.throws(() => parseArgs(['--port', ...port]), /port|needs a value/);
});

test('--port: a port that is taken is refused before the build; a free one is left free', async () => {
  const holder = createServer();
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const port = holder.address().port;
  try { await assert.rejects(assertPortFree(port), new RegExp(`^Error: --port ${port} is already in use on 127\\.0\\.0\\.1$`)); }
  finally { await new Promise((resolve) => holder.close(resolve)); }
  await assertPortFree(port);
  // the probe left it free: the preview can bind it
  await new Promise((resolve, reject) => { const again = createServer().once('error', reject).listen(port, '127.0.0.1', () => again.close(resolve)); });
});

test('GPU launch: --gpu is the three real-GPU flags; only an unmasked, non-software renderer stands for a real GPU', () => {
  assert.deepEqual(GPU, ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default']);
  assert(SWIFTSHADER.includes('--use-angle=swiftshader') && !SWIFTSHADER.includes('--use-angle=default'));
  assert.equal(realGpuProblem({ renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11)', unmasked: true }), null);
  for (const renderer of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'Google SwiftShader',
    'llvmpipe (LLVM 15.0.7, 256 bits)', 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)']) {
    assert.match(realGpuProblem({ renderer, unmasked: true }), /real-GPU run got software renderer/);
  }
  // the masked string names no GPU: without the extension SwiftShader cannot be ruled out
  assert.match(realGpuProblem({ renderer: 'WebKit WebGL', unmasked: false }), /WEBGL_debug_renderer_info is unavailable/);
  for (const graphics of [null, undefined, {}, { renderer: null, unmasked: false }, { renderer: '', unmasked: true }]) assert.match(realGpuProblem(graphics), /no WebGL renderer could be read/);
});

test('GPU check: the page reads the city context\'s unmasked renderer, and a scratch context only without a city', () => {
  const context = (renderer, extension = true) => ({ RENDERER: 1,
    getExtension: (name) => extension && name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 2 } : null,
    getParameter: (name) => name === 2 ? renderer : 'WebKit WebGL' });
  pageGlobal('window', { __metropolis: { city: { scene: { ctx: { world: { renderer: { getContext: () => context('ANGLE (NVIDIA)') } } } } } } });
  pageGlobal('document', { createElement() { throw new Error('a city with a context needs no scratch canvas'); } });
  assert.deepEqual(pageRenderer(), { renderer: 'ANGLE (NVIDIA)', unmasked: true, source: 'city' });
  pageGlobal('window', { __metropolis: {} });
  pageGlobal('document', { createElement: () => ({ getContext: (kind) => kind === 'webgl2' ? context('unused', false) : null }) });
  assert.deepEqual(pageRenderer(), { renderer: 'WebKit WebGL', unmasked: false, source: 'scratch' });
  pageGlobal('document', { createElement: () => ({ getContext: () => null }) });
  assert.deepEqual(pageRenderer(), { renderer: null, unmasked: false, source: 'none' });
});

const TOOL = fileURLToPath(new URL('../qa-worker.mjs', import.meta.url));
test('tools/qa-worker.mjs: --host hands the run to this harness; --gpu, --help and its own options stay the W1.2 script\'s', async (t) => {
  // every call below ends before Vite or Playwright is imported: no build and no browser
  const tool = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', windowsHide: true });
  const help = tool('--help');
  // a sandbox that cannot start a process (spawn EPERM) cannot run this case: say so rather than fail
  if (['EPERM', 'EACCES'].includes(help.error?.code)) { t.skip(`this environment cannot start node (${help.error.code})`); return; }
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--gpu\s+the real GPU \(--enable-gpu --ignore-gpu-blocklist --use-angle=default\)/);
  assert.match(help.stdout, /--host worker\|loopback\|local/);
  // a mistyped --gpu must not run on SwiftShader unnoticed
  for (const [args, message] of [[['--gpus', '--port', '5692'], /unknown option --gpus/], [['--gpu', '--port'], /--port needs a value/]]) {
    const refused = tool(...args);
    assert.equal(refused.status, 2, `${args}: ${refused.stdout}`); assert.match(refused.stderr, message);
  }
  // with --host the harness's own parser answers: its help, its exit 2
  const forwarded = tool('--host', 'worker', '--gpu', '--port', '5692', '--help');
  assert.equal(forwarded.status, 0, forwarded.stderr); assert.match(forwarded.stdout, /^Worker acceptance harness/);
  const host = tool('--host', 'elsewhere');
  assert.equal(host.status, 2); assert.match(host.stderr, /host must be local, loopback or worker/);
  // its own steps launch Chromium with the shared real-GPU flags under --gpu, and stop on a software renderer
  const source = await readFile(TOOL, 'utf8');
  assert.match(source, /chromium\.launch\(\{ args: \[\.\.\.\(GPU \? GPU_FLAGS : \['--use-angle=swiftshader', '--enable-unsafe-swiftshader'\]\),/);
  assert.match(source, /const problem = realGpuProblem\(graphics\);\s+check\('gpu: [^']+', !problem, [^;]+;\s+if \(problem\) throw new Error/);
});

test('ack oracle: missing, pending, rejected, refused and malformed tickets fail', async () => {
  for (const r of [[], rows({ status: 'pending' }), rows({ status: 'rejected', error: 'worker died' }), rows({ result: { ok: false, reason: 'no funds' } }), rows({ result: null }), rows({ seq: 0 })]) {
    await assert.rejects(waitForAcks(async () => r, 'zone', 10));
  }
  await assert.rejects(waitForAcks(async () => rows({ result: 1 }), 'triggerDisaster', 10), /boolean acknowledgement/);
});

test('ack oracle: deferred tickets must ALL settle, including void results', async () => {
  const r = rows({ status: 'pending', result: null });
  const timer = setTimeout(() => { r[0].status = 'resolved'; }, 5);
  // The second read comes one polling interval after the first. The budget only has to outlast that interval on a
  // loaded machine (a 50 ms timer can fire 150 ms late there); the wait ends at the read that sees the ticket settled.
  try { assert.equal((await waitForAcks(async () => r, 'setTax', 5000)).length, 1); }
  finally { clearTimeout(timer); }
  await assert.rejects(waitForAcks(async () => [...rows(), ...rows({ seq: 2, status: 'pending' })], 'zone', 10), /acknowledgement/);
});

test('deadlines: an unresponsive browser read fails without waiting for its promise', async () => {
  await assert.rejects(poll(() => new Promise(() => {}), Boolean, 10, 'resume probe'), /resume probe \(read timed out\)/);
});

test('ack oracle: issuing gestures and dispatch tags are mandatory', async () => {
  await assert.rejects(waitForAcks(async () => rows(), 'zone', 10, { gesture: true }), /gesture/);
  await assert.rejects(waitForAcks(async () => rows({ gesture: 1, owner: 'wrong', tool: 'zone:1' }), 'zone', 10, { gesture: true }), /gesture/);
  await assert.rejects(waitForAcks(async () => rows(), 'dispatch', 10, { tag: true }), /tag/);
  await waitForAcks(async () => rows({ gesture: 1, owner: 'zone:1', tool: 'zone:1' }), 'zone', 10, { gesture: true });
  await waitForAcks(async () => rows({ tagMatchesTool: true }), 'dispatch', 10, { tag: true });
});

function fixture() {
  const controller = new AbortController();
  const tool = { id: 'zone:1' };
  let seq = 0, calls = 0;
  const host = {
    kind: 'local', state: { day: 0 },
    act(op, args, opts) { calls++; this.last = { op, args, opts }; return { seq: ++seq, exact: true, predicted: { ok: true }, done: Promise.resolve({ ok: true }) }; },
    beginGesture(owner) {
      let resolve;
      return { owner, settled: new Promise((r) => { resolve = r; }), end() { resolve(); } };
    },
    frame() { this.state.day++; }, dispose() { controller.abort('dispose'); },
  };
  const ctx = { signal: controller.signal, tools: { active: tool }, degraded: {}, world: {}, objects: {}, sound() {}, toast() {} };
  const scene = { host, ctx, async save() { host.act('setCamera', [{ x: 1 }]); } };
  globalThis.window = { __ready: true, __metropolis: { city: { scene } } };
  return { host, ctx, tool, scene, calls: () => calls };
}

test('probe: observes real tickets without changing args, tags, gestures or results; restores on dispose', async () => {
  const { host, ctx, tool, calls } = fixture();
  const original = host.act, originalSound = ctx.sound;
  installProbe();
  const q = window.__qaWorker, g = host.beginGesture(tool);
  const args = [{ x0: 1 }], opts = { tag: tool, gesture: g };
  const ticket = host.act('zone', args, opts);
  assert.deepEqual(await ticket.done, { ok: true });
  assert.equal(host.last.args, args); assert.equal(host.last.opts, opts); assert.equal(calls(), 1);
  g.end(); await g.settled;
  await waitForAcks(async () => q.commands, 'zone', 10, { gesture: true, tag: true });
  assert.equal(q.gestures[0].settled, true);
  ctx.sound('terraform'); ctx.toast('test');
  assert.equal(q.sounds[0].at >= q.gestures[0].settledAt, true);
  assert.equal(q.sounds.length, 1); assert.equal(q.toasts.length, 1);
  host.dispose();
  assert.equal(host.act, original); assert.equal(ctx.sound, originalSound); assert.equal(window.__qaWorker, undefined);
  assert.equal(ctx.signal.reason, 'dispose');
});

test('negative control: a real mutation and exact prediction cannot hide a withheld ack', async () => {
  const { host, calls } = fixture();
  installProbe({ dropAck: 'zone' });
  const first = host.act('zone', []), second = host.act('zone', []);
  assert.equal(calls(), 2);
  assert.equal(first.predicted.ok, true);
  await second.done;
  const q = window.__qaWorker;
  assert.equal(q.commands[0].dropped, true);
  assert.equal(q.commands[1].status, 'resolved');
  await assert.rejects(waitForAcks(async () => q.commands, 'zone', 10), /ticket.done acknowledgement/);
});

test('probe: late acks after city abort cannot turn into PASS', async () => {
  const { host, ctx } = fixture();
  let resolve;
  host.act = () => ({ seq: 1, done: new Promise((r) => { resolve = r; }) });
  installProbe();
  const q = window.__qaWorker;
  host.act('zone', []);
  host.dispose(); resolve({ ok: true }); await Promise.resolve();
  assert.equal(ctx.signal.aborted, true);
  assert.equal(q.commands[0].status, 'pending');
});

test('freeze probe: pre-freeze and hidden progress cannot satisfy visible resume; timestamps and frames recorded', () => {
  const { host } = fixture();
  globalThis.document = new EventTarget();
  document.visibilityState = 'visible';
  installProbe();
  const q = window.__qaWorker;
  q.armFreeze();
  host.frame();
  assert.equal(q.freeze.advancedAt, null);
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('freeze'));
  document.dispatchEvent(new Event('resume'));
  assert.equal(q.freeze.day, 1);
  assert.equal(q.freeze.advancedAt, null);
  host.frame();
  assert.equal(q.freeze.advancedAt, null);
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  host.frame();
  assert.equal(q.freeze.advancedAt >= q.freeze.visibleAt, true);
  assert.equal(q.freeze.resumedAt >= q.freeze.frozenAt, true);
  assert.deepEqual(q.freeze.framesDuringFreeze, []);
  assert.equal(q.freeze.framesAtResume, q.freeze.framesAtFreeze);
  assert.ok(resumeDelay(q.freeze) >= 0);
  host.dispose();
});

test('save markers: byte ranges, day, funds, nextBuildingId and saved camera are continuity markers', () => {
  const { host } = fixture();
  const buffer = new Uint8Array([1, 2, 3, 4]);
  Object.assign(host.state, { config: { seed: 7, name: 'QA' }, size: 256, funds: 100, nextBuildingId: 7, systemData: { camera: { x: 1, z: 2, distance: 3 } },
    budget: { taxRates: [9], funding: { fire: 100 }, ordinances: [], loans: [] }, buildings: new Map() });
  for (const key of ['heights', 'water', 'zone', 'network', 'netFlags', 'powerLines', 'subway']) host.state[key] = buffer.subarray(1, 3);
  const before = savedMarkers();
  buffer[0]++;
  assert.deepEqual(savedMarkers(), before);
  for (const key of ['day', 'funds', 'nextBuildingId']) {
    host.state[key]++; assert.notDeepEqual(savedMarkers(), before); host.state[key]--;
  }
  host.state.systemData.camera.x++;
  assert.notDeepEqual(savedMarkers(), before);
  host.state.systemData.camera.x--;
  buffer[1]++;
  assert.notDeepEqual(savedMarkers(), before);
});

test('probe: non-cloneable arguments do not throw into the application command path', async () => {
  const { host, calls } = fixture(); installProbe();
  const args = [() => {}];
  const ticket = host.act('zone', args);
  assert.equal(calls(), 1); assert.equal(host.last.args, args);
  assert.deepEqual(await ticket.done, { ok: true });
  assert.equal(window.__qaWorker.commands[0].args.uncloneable, true);
});

test('save correlation: periodic setCamera cannot impersonate a CityScene.save call', async () => {
  const { host, scene } = fixture(); installProbe();
  await host.act('setCamera', [{ x: 1 }]).done;
  await scene.save(false);
  const q = window.__qaWorker;
  assert.equal(q.commands[0].save, null);
  assert.equal(q.commands[1].save, q.saves[0].id);
  assert.equal(q.saves[0].auto, false);
  assert.equal(q.saves[0].status, 'resolved');
});

test('drop-ack: survives reload until consumed, and is not applied again in a third session', async () => {
  const page = { evaluate: async (fn, arg) => fn(arg), waitForFunction: async (fn) => assert.ok(fn()) };
  const d = new Driver(page, { host: 'local', dropAck: 'dispatch', ackTimeout: 10 });
  let f = fixture(); await d.ready();
  await f.host.act('zone', []).done; await d.archive(); f.host.dispose();
  assert.equal(d.dropAckUsed, false);
  f = fixture(); await d.ready(); f.host.act('dispatch', []); await d.archive(); f.host.dispose();
  assert.equal(d.dropAckUsed, true);
  f = fixture(); await d.ready(); await f.host.act('dispatch', []).done;
  assert.equal(window.__qaWorker.commands[0].status, 'resolved');
  assert.equal(window.__qaWorker.commands[0].dropped, undefined);
});

test('ready: stale title readiness and null views cannot pass the city gate', async () => {
  const { ctx } = fixture();
  const page = { evaluate: async (fn, arg) => fn(arg), waitForFunction: async (fn) => assert.ok(fn()) };
  const d = new Driver(page, { host: 'local' });
  ctx.world.isNull = true; await assert.rejects(d.ready());
  ctx.world.isNull = false; ctx.objects.isNull = true; await assert.rejects(d.ready());
  ctx.objects.isNull = false; window.__ready = false; await assert.rejects(d.ready());
  window.__ready = true; await d.ready();
});

test('only: freeze is isolated; dispatch and save include their explicit prerequisites', () => {
  assert.deepEqual([...selectedChecks('freeze')], ['host ready', 'no crash overlay', CHECKS.freeze]);
  assert.deepEqual([...selectedChecks('dispatchBest')], ['host ready', 'no crash overlay', 'dispatchBest', 'dispatch', 'triggerDisaster', CHECKS.fixture]);
  assert.ok(selectedChecks('save').has(CHECKS.setCamera));
  assert.equal(selectedChecks(), null);
});

test('broken build: production transform replaces the actual host done initializer, fails closed on drift', async () => {
  const source = await readFile(new URL('../../src/worker/SimHost.ts', import.meta.url), 'utf8');
  const evidence = {}, plugin = breakAckPlugin('zone', evidence);
  assert.equal(plugin.transform(source, '/src/unrelated.ts'), null);
  const out = plugin.transform(source, '/repo/src/worker/SimHost.ts');
  plugin.generateBundle();
  assert.deepEqual(evidence, { op: 'zone', host: 'local', rewrites: 1 });
  const line = out.code.split('\n').find((s) => s.includes('const done =')).replace('<CommandResult<K>>', '');
  const actDone = new Function('op', 'predicted', `${line}\nreturn done;`);
  assert.deepEqual(await actDone('dezone', { ok: true }), { ok: true });
  await assert.rejects(poll(() => actDone('zone', { ok: true }), Boolean, 10, 'disabled done'), /read timed out/);
  assert.throws(() => plugin.transform(source, '/repo/src/worker/SimHost.ts'), /duplicate/);
  assert.throws(() => breakAckPlugin('zone', {}).transform('changed source', '/src/worker/SimHost.ts'), /initializer changed/);
  assert.throws(() => breakAckPlugin('zone', {}).generateBundle(), /did not include/);
  assert.equal(await readFile(new URL('../../src/worker/SimHost.ts', import.meta.url), 'utf8'), source);
});

test('broken build verdict: only the targeted pending ack failure counts; unrelated failures never pass', async () => {
  let error;
  try { await waitForAcks(async () => rows({ status: 'pending' }), 'zone', 10); } catch (e) { error = e; }
  const check = { name: 'zone', status: 'FAIL', failure: error.failure };
  const transformed = { op: 'zone', rewrites: 1 };
  assert.equal(brokenBuildVerdict([check], 'zone', transformed), true);
  for (const checks of [[], [{ name: 'Chromium', status: 'FAIL' }], [check, { name: 'console errors', status: 'FAIL' }], [{ ...check, name: 'dezone' }], [{ ...check, failure: { op: 'zone', kind: 'missing-command' } }]]) {
    assert.equal(brokenBuildVerdict(checks, 'zone', transformed), false);
  }
  assert.equal(brokenBuildVerdict([check], 'zone', { op: 'zone', rewrites: 0 }), false);
  assert.equal(brokenBuildVerdict([check], 'zone', transformed, ['pointerup failed']), false);
});

test('broken build verdict: a failing probe read after a pending ack is not an ack timeout', async () => {
  let reads = 0;
  // as above: the budget outlasts one polling interval under load, and the second read's own failure ends the wait
  await assert.rejects(waitForAcks(async () => {
    if (reads++) throw new Error('probe broke');
    return rows({ status: 'pending' });
  }, 'zone', 5000), (e) => e.failure.kind === 'missing-command' && e.message === 'probe broke');
  assert.equal(reads, 2);
});

test('freeze oracle: deadline starts at later resume/visible; hidden, delayed and frozen-frame evidence fails', () => {
  const f = { frozenAt: 0, resumedAt: 15000, visibleAt: 15500, advancedAt: 16499, framesDuringFreeze: [] };
  assert.equal(resumeDelay(f), 999);
  assert.equal(resumeDelay({ ...f, resumedAt: 15600 }), 899);
  assert.throws(() => resumeDelay({ ...f, visibleAt: null }), /stayed hidden/);
  assert.throws(() => resumeDelay({ ...f, advancedAt: 16501 }), /limit 1000/);
  assert.throws(() => resumeDelay({ ...f, framesDuringFreeze: [1] }), /frames while frozen/);
});

const CITY = { regionId: 'quickstart', tileKey: '3_2' }, CITY_KEY = 'quickstart:3_2';
/** recoveryMode()'s result for a packet host whose store persists */
const journalMode = (extra = {}) => ({ kind: 'worker', persistence: 'worker-idb', storePersistent: true, mirror: true, ...CITY, ...extra });
/** what one pagehide leaves after a UI zone (seq 89), as W1.3 stores it: bound to the save, or to a snapshot of it */
function journalEvidence(kind = 'save', mode = journalMode()) {
  const base = kind === 'snapshot' ? { kind, at: 1500, baseSavedAt: 1000 } : { kind, savedAt: 1000 };
  const journal = { v: 1, ...CITY, at: 2000, base, fromCmd: 80,
    ops: [{ seq: 81, op: 'setTax', args: [0, 9.5] }, { seq: 89, op: 'zone', args: [{ x0: 146, z0: 154, x1: 147, z1: 155 }, 1] }] };
  return { host: mode.kind, mode, edit: { seq: 89, op: 'zone' },
    ls: { journal, marker: { ...CITY, kind: kind === 'snapshot' ? 'snapshot' : 'journal', at: kind === 'snapshot' ? 1500 : 2000, baseSavedAt: 1000, bytes: 0 } },
    idb: { key: CITY_KEY, journal: structuredClone(journal), savedAt: 1000, snapshot: kind === 'snapshot' ? { ...CITY, at: 1500, baseSavedAt: 1000, bytes: 12 } : null } };
}

test('recovery mirror: only a host or mode without a journal by design skips; a packet host that should journal never does', () => {
  for (const mode of [undefined, null, journalMode()]) assert.match(journalSkip('local', mode), /LocalSimHost uses snapshot recovery/);
  // W1.3: the mirror is bound wherever the page's store persists, in both of the worker's persistence modes
  for (const persistence of ['worker-idb', 'main']) assert.equal(journalSkip('worker', journalMode({ persistence })), null);
  assert.equal(journalSkip('loopback', journalMode({ kind: 'loopback', persistence: null })), null);
  // the old harness skipped a worker host without a mirror; with a store that persists that is W1.3 broken
  assert.throws(() => journalSkip('worker', journalMode({ mirror: false })), /W1\.3 keeps the journal mirror on this worker host \(persistence 'worker-idb'\), but host\.recovery is null/);
  assert.throws(() => journalSkip('loopback', journalMode({ kind: 'loopback', persistence: null, mirror: false })), /host\.recovery is null/);
  // no journal by design: nothing survives a reload, and the reason is the row's text
  assert.match(journalSkip('worker', journalMode({ persistence: 'main', storePersistent: false, mirror: false })),
    /^no journal by design: the page's store does not persist .* persistence 'main' without a journal mirror \(cloud-W1\.3 decision 6\)$/);
  assert.match(journalSkip('loopback', journalMode({ kind: 'loopback', persistence: null, storePersistent: false })), /^no journal by design: the page's store does not persist/);
  // a read that does not show the mode is a failure, not a reason to skip
  assert.throws(() => journalSkip('worker', journalMode({ persistence: 'worker-idb', storePersistent: false })), /cannot run 'worker-idb'/);
  assert.throws(() => journalSkip('worker', journalMode({ persistence: null })), /WorkerSimHost\.persistence reads null/);
  assert.throws(() => journalSkip('worker', journalMode({ storePersistent: null })), /App\.persistent is not readable/);
  assert.throws(() => journalSkip('worker', journalMode({ kind: 'local' })), /the page runs another host/);
  assert.throws(() => journalSkip('loopback', null), /recovery mode read failed/);
  assert.throws(() => journalSkip('worker', journalMode({ tileKey: null })), /region and tile are not readable/);
});

test('recovery mirror: passes on what W1.3 stores for each packet mode, bound to a save or to a snapshot of it', () => {
  assert.equal(journalVerdict(journalEvidence('save')),
    "worker, persistence 'worker-idb': App pagehide wrote 2 whitelisted edits bound to save; UI zone seq 89 retained in localStorage and in IndexedDB recovery/quickstart:3_2#journal; "
    + 'IndexedDB holds that save (the worker wrote it on its own connection and replays the journal at boot)');
  assert.match(journalVerdict(journalEvidence('snapshot')), /bound to snapshot; .* IndexedDB holds that snapshot and its save \(the worker wrote it/);
  assert.match(journalVerdict(journalEvidence('snapshot', journalMode({ persistence: 'main' }))),
    /^worker, persistence 'main': .* \(main stored it and passes the journal in init\.journal: the worker's IndexedDB was unavailable\)$/);
  assert.match(journalVerdict(journalEvidence('save', journalMode({ kind: 'loopback', persistence: null }))), /^loopback: .* \(the loopback core wrote it and replays the journal at boot\)$/);
});

test('recovery mirror: each stored copy is asserted: the localStorage journal and marker, the IndexedDB record, and the base they are bound to', () => {
  const fails = (kind, change, message, rebased = false) => {
    const e = journalEvidence(kind); change(e);
    assert.throws(() => journalVerdict(e), (error) => { assert.match(error.message, message); assert.equal(!!error.rebased, rebased, error.message); return true; });
  };
  fails('save', (e) => { e.ls.journal = null; }, /wrote no journal to localStorage/);
  fails('save', (e) => { e.ls.journal.ops.pop(); }, /^pagehide did not journal the UI edit$/);
  fails('save', (e) => { e.ls.journal.ops.at(-1).op = 'dezone'; }, /did not journal the UI edit/);
  fails('save', (e) => { e.ls.journal.ops.reverse(); }, /invalid watermarks\/order/);
  fails('save', (e) => { e.ls.journal.ops[0].seq = 80; }, /invalid watermarks\/order/);
  for (const op of JOURNAL_EXCLUDED) fails('save', (e) => { e.ls.journal.ops[0].op = op; }, new RegExp(`retained an excluded command: ${op}`));
  fails('save', (e) => { e.ls.journal.tileKey = '0_0'; }, /journal names quickstart:0_0, the city is quickstart:3_2/);
  fails('save', (e) => { e.ls.journal.base = { kind: 'other' }; }, /journal has no valid base/);
  fails('save', (e) => { e.ls.marker = null; }, /marker \(metropolis\.recovery\) is missing or names another city/);
  fails('save', (e) => { e.ls.marker.regionId = 'other'; }, /is missing or names another city/);
  fails('save', (e) => { e.ls.marker.kind = 'snapshot'; }, /does not describe the journal/);
  fails('snapshot', (e) => { e.ls.marker.kind = 'journal'; }, /does not describe the journal/);
  fails('snapshot', (e) => { e.ls.marker.at = 1400; }, /does not describe the journal/);
  fails('save', (e) => { e.ls.marker.baseSavedAt = 999; }, /does not describe the journal/);
  fails('save', (e) => { e.idb.error = 'open: blocked'; }, /IndexedDB could not be read: open: blocked/);
  // W1.3 writes the IndexedDB copy wherever the store persists: the worker's boot replay reads only that one
  fails('save', (e) => { e.idb.journal = null; }, /left no journal record in IndexedDB \(recovery\/quickstart:3_2#journal\)/);
  fails('save', (e) => { e.idb.journal.ops.pop(); }, /IndexedDB recovery\/quickstart:3_2#journal does not hold the UI edit/);
  // bound to records the database really holds, or the next boot discards it (journalMatches)
  fails('save', (e) => { e.idb.savedAt = 999; }, /bound to the save of 1000, but IndexedDB cities\/quickstart:3_2 holds the save of 999/, true);
  fails('save', (e) => { e.idb.savedAt = null; }, /holds the save of null/, true);
  fails('snapshot', (e) => { e.idb.snapshot = null; }, /bound to the snapshot of 1500, but IndexedDB recovery\/quickstart:3_2 holds null/, true);
  fails('snapshot', (e) => { e.idb.snapshot.at = 1600; }, /bound to the snapshot of 1500/, true);
  fails('snapshot', (e) => { e.idb.snapshot.baseSavedAt = 999; }, /bound to the snapshot of 1500/, true);
  fails('snapshot', (e) => { e.idb.savedAt = 999; }, /holds the save of 999/, true);
  // a save or snapshot between the edit and the reads: the two copies sit on either side of it
  fails('save', (e) => { e.idb.journal.base = { kind: 'snapshot', at: 2100, baseSavedAt: 1000 }; e.idb.journal.fromCmd = 89; e.idb.journal.ops = []; }, /IndexedDB .* is bound to .*"snapshot".* from command 89, the localStorage copy to .*"save".* from command 80/, true);
  fails('save', (e) => { e.ls.journal.base = { kind: 'snapshot', at: 2100, baseSavedAt: 1000 }; e.ls.journal.fromCmd = 89; e.ls.journal.ops = []; }, /snapshot base already contains the UI edit \(seq 89, fromCmd 89\)/, true);
});

test('recovery mirror: the excluded list and the page reads follow the source', async () => {
  const src = (file) => readFile(new URL(`../../src/${file}`, import.meta.url), 'utf8');
  // no excluded op is on the journal whitelist, and every command the UI posts is on one list or the other
  const whitelist = /JOURNAL_OPS[^=]*= \{([^}]+)\}/.exec(await src('save/recoveryCodec.ts'))[1].split(',').map((entry) => entry.split(':')[0].trim()).filter(Boolean);
  assert(whitelist.includes('zone') && whitelist.length >= 15, `JOURNAL_OPS was not read: ${whitelist}`);
  assert.deepEqual(JOURNAL_EXCLUDED.filter((op) => whitelist.includes(op)), [], 'an excluded op is journaled now: update JOURNAL_EXCLUDED');
  // the seams recoveryMode(), writeAtPagehide() and readRecoveryIdb() read
  assert.match(await src('main.ts'), /private persistent = false;/, 'App.persistent moved: update recoveryMode()');
  assert.match(await src('main.ts'), /window\.addEventListener\('pagehide', \(\) => \{\s+this\.unloading = true;\s+this\.snapshotNow\('pagehide'\);/);
  assert.match(await src('main.ts'), /c\.host\.recovery\?\.writeNow\(why\);/);
  assert.match(await src('worker/WorkerSimHost.ts'), /readonly persistence: 'worker-idb' \| 'main';/, 'WorkerSimHost.persistence moved: update recoveryMode()');
  assert.match(await src('worker/WorkerSimHost.ts'), /journal: opts\.journal \?\? \(opts\.kv\?\.persistent \?\? false\)/, 'the worker host\'s journal rule changed: review journalSkip()');
  assert.match(await src('worker/LoopbackSimHost.ts'), /get recovery\(\): RecoveryMirror \| null \{ return this\.options\.recovery \|\| this\.mirror \? this\.writer : null; \}/);
  const ls = await src('save/recoveryLs.ts');
  assert.match(ls, /const LS_MARKER = 'metropolis\.recovery';/); assert.match(ls, /const LS_JOURNAL = 'metropolis\.recovery\.journal';/);
  assert.match(await src('save/db.ts'), /export const DB_NAME = 'metropolis';/);
  assert.match(await src('save/cities.ts'), /return `\$\{regionId\}:\$\{tileKey\}`;/);
  assert.match(await src('save/recoveryIdb.ts'), /kv\.put\('recovery', journal, recKey\(journal\) \+ '#journal'\)/);
  assert.match(await src('save/recoveryIdb.ts'), /kv\.put\('recovery', \{ marker, payload \} satisfies IdbRecoveryRecord, recKey\(marker\)\)/);
});

test('recovery mirror: the page reads the mode from the App and its host, never writing', () => {
  const host = { kind: 'worker', persistence: 'worker-idb', recovery: { writeNow() { throw new Error('reading the mode writes nothing'); } } };
  pageGlobal('window', { __metropolis: { persistent: true, region: { data: { id: 'quickstart' } }, city: { tile: { key: '3_2' }, scene: { host } } } });
  assert.deepEqual(recoveryMode(), journalMode());
  // LoopbackSimHost has no persistence mode of its own; LocalSimHost's `persistence` is its city, not a mode
  Object.assign(host, { kind: 'loopback', persistence: undefined });
  assert.deepEqual(recoveryMode(), journalMode({ kind: 'loopback', persistence: null }));
  Object.assign(host, { kind: 'local', persistence: { regionId: 'quickstart', tileKey: '3_2' }, recovery: null });
  assert.deepEqual(recoveryMode(), journalMode({ kind: 'local', persistence: null, mirror: false }));
  // a store in memory, and a field that moved: the verdict tells them apart
  window.__metropolis.persistent = false;
  assert.equal(recoveryMode().storePersistent, false);
  delete window.__metropolis.persistent;
  assert.equal(recoveryMode().storePersistent, null);
});

test('recovery mirror: the App\'s own pagehide writes; pageshow follows even when a handler throws', () => {
  const events = [], slot = new Map([['metropolis.recovery.journal', '{"v":1,"ops":[]}']]);
  pageGlobal('PageTransitionEvent', class { constructor(type, init) { Object.assign(this, { type, ...init }); } });
  pageGlobal('localStorage', { getItem: (key) => slot.get(key) ?? null });
  pageGlobal('window', { dispatchEvent(event) {
    events.push([event.type, event.persisted]);
    if (event.type === 'pagehide') slot.set('metropolis.recovery', '{"kind":"journal"}');
  } });
  assert.deepEqual(writeAtPagehide(), { journal: { v: 1, ops: [] }, marker: { kind: 'journal' } });
  assert.deepEqual(events, [['pagehide', false], ['pageshow', true]]);
  slot.clear(); events.length = 0;
  window.dispatchEvent = (event) => { events.push(event.type); };
  assert.deepEqual(writeAtPagehide(), { journal: null, marker: null }, 'an App that wrote nothing leaves nothing to read');
  window.dispatchEvent = (event) => { events.push(event.type); if (event.type === 'pagehide') throw new Error('handler failed'); };
  assert.throws(() => writeAtPagehide(), /handler failed/);
  assert.deepEqual(events.slice(-2), ['pagehide', 'pageshow'], 'the App must not stay in its unloading state');
});

test('recovery mirror: the page reads the journal record, and with it the snapshot marker and the save it is bound to', async () => {
  const journal = journalEvidence('snapshot').ls.journal;
  const records = new Map([[`recovery/${CITY_KEY}#journal`, journal], [`recovery/${CITY_KEY}`, { marker: { ...CITY, at: 1500, baseSavedAt: 1000, bytes: 12, cityName: 'QA' }, payload: new Uint8Array(12) }],
    [`cities/${CITY_KEY}`, { key: CITY_KEY, ...CITY, savedAt: 1000, city: { heights: new Float32Array(4) } }]]);
  const reads = [], kv = { get: async (store, key) => { reads.push(`${store}/${key}`); return records.get(`${store}/${key}`); } };
  let idb = fakeIndexedDB(kv); pageGlobal('indexedDB', idb);
  // while it waits for the put, only the small journal record is read
  assert.deepEqual(await readRecoveryIdb(journalMode()), { key: CITY_KEY, journal, snapshot: null, savedAt: null });
  assert.deepEqual(reads, [`recovery/${CITY_KEY}#journal`]);
  // then the base: the marker without its payload, the save's time without its city
  assert.deepEqual(await readRecoveryIdb({ ...journalMode(), base: true }), { key: CITY_KEY, journal, savedAt: 1000, snapshot: { ...CITY, at: 1500, baseSavedAt: 1000, bytes: 12 } });
  assert.deepEqual(idb.opened.map((db) => [db.name, db.closed]), [['metropolis', true], ['metropolis', true]], 'each read closes its own connection');
  records.clear();
  assert.deepEqual(await readRecoveryIdb({ ...journalMode(), base: true }), { key: CITY_KEY, journal: null, snapshot: null, savedAt: null });
  // failures come back as `error`: a database that is not there is not created, a failed read is not an empty one
  idb = fakeIndexedDB(kv, { exists: false }); pageGlobal('indexedDB', idb);
  assert.match((await readRecoveryIdb(journalMode())).error, /^open: the upgrade was aborted$/);
  assert.equal(idb.opened.length, 0);
  pageGlobal('indexedDB', fakeIndexedDB(kv, { fail: new Error('disk') }));
  assert.match((await readRecoveryIdb({ ...journalMode(), base: true })).error, /^read: disk$/);
  pageGlobal('indexedDB', { open() { throw new Error('denied'); } });
  assert.match((await readRecoveryIdb(journalMode())).error, /^open: denied$/);
});

/**
 * A page model of §4.3's mirror for the row's control flow (the real hosts are tests/worker/qaWorkerJournal.test.ts):
 * commands join the journal, pagehide writes localStorage at once and IndexedDB `idbDelay` ms later, and a snapshot
 * takes the journal's edits into its own record.
 */
function journalApp({ kind = 'worker', persistence = 'worker-idb', persistent = true, mirror = true, idbDelay = 0, idbWrites = true, snapshotAfterDraw = 0, ackTimeout = 5000 } = {}) {
  const records = new Map([[`cities/${CITY_KEY}`, { key: CITY_KEY, ...CITY, savedAt: 1000 }]]), slot = new Map();
  const m = { fromCmd: 0, ops: [], snapshot: null, seq: 10, at: 2000, draws: [], pagehides: 0, evaluations: 0 };
  const writeNow = () => {
    const journal = { v: 1, ...CITY, at: ++m.at, base: m.snapshot ? { kind: 'snapshot', at: m.snapshot, baseSavedAt: 1000 } : { kind: 'save', savedAt: 1000 }, fromCmd: m.fromCmd, ops: structuredClone(m.ops) };
    slot.set('metropolis.recovery.journal', JSON.stringify(journal));
    slot.set('metropolis.recovery', JSON.stringify({ ...CITY, kind: m.snapshot ? 'snapshot' : 'journal', at: m.snapshot ?? journal.at, baseSavedAt: 1000 }));
    if (idbWrites) setTimeout(() => records.set(`recovery/${CITY_KEY}#journal`, journal), idbDelay);
  };
  const snapshot = () => {
    m.snapshot = ++m.at; m.fromCmd = m.seq; m.ops = [];
    records.set(`recovery/${CITY_KEY}`, { marker: { ...CITY, at: m.snapshot, baseSavedAt: 1000, bytes: 3 }, payload: new Uint8Array(3) });
  };
  pageGlobal('PageTransitionEvent', class { constructor(type) { this.type = type; } });
  pageGlobal('localStorage', { getItem: (key) => slot.get(key) ?? null });
  pageGlobal('indexedDB', fakeIndexedDB({ get: async (store, key) => records.get(`${store}/${key}`) }));
  pageGlobal('window', { __metropolis: { persistent, region: { data: { id: CITY.regionId } },
    city: { tile: { key: CITY.tileKey }, scene: { host: { kind, persistence, recovery: mirror ? {} : null } } } },
  dispatchEvent(event) { if (event.type === 'pagehide') { m.pagehides++; if (persistent && mirror) writeNow(); } } });
  const d = { options: { host: kind, ackTimeout }, page: { evaluate: async (fn, arg) => { m.evaluations++; return fn(arg); } },
    draw: async (op, tool, cell) => {
      assert.deepEqual([op, tool], ['zone', 'zone:1']);
      m.draws.push(cell); m.ops.push({ seq: ++m.seq, op: 'zone', args: [cell] });
      if (snapshotAfterDraw-- > 0) snapshot();
      return [{ seq: m.seq }];
    } };
  return { d, m, records, snapshot };
}
/** the row as the run adds it, after the zone check it depends on (`zone`: that check's status) */
const recoveryRow = async (app, zone = 'PASS') => {
  const report = new Report();
  report.checks.push({ name: 'zone', status: zone, reason: 'the zone check, run earlier' });
  await recoveryMirror(app.d, report);
  assert.deepEqual(report.checks.map((c) => c.name), ['zone', 'recovery mirror']);
  return { ...report.checks[1], details: report.details };
};

test('recovery mirror row: a real edit, the App\'s pagehide, then both stores, for each packet mode', async (t) => {
  t.mock.method(console, 'log', () => {});
  let app = journalApp(), row = await recoveryRow(app);
  assert.equal(row.status, 'PASS', row.reason);
  assert.match(row.reason, /^worker, persistence 'worker-idb': App pagehide wrote 1 whitelisted edits bound to save; UI zone seq 11 retained/);
  assert.deepEqual(app.m.draws, [[146, 154]]);
  assert.deepEqual([row.details.recoveryMode.persistence, row.details.recoveryJournal.ops.length, row.details.recoveryStores.idb.savedAt], ['worker-idb', 1, 1000]);
  // bound to a snapshot the worker stored earlier
  app = journalApp({ persistence: 'main' }); app.snapshot();
  row = await recoveryRow(app);
  assert.equal(row.status, 'PASS', row.reason); assert.match(row.reason, /^worker, persistence 'main': .* bound to snapshot; .* holds that snapshot and its save/);
  app = journalApp({ kind: 'loopback', persistence: undefined });
  row = await recoveryRow(app);
  assert.equal(row.status, 'PASS', row.reason); assert.match(row.reason, /^loopback: /);
  // the IndexedDB put completes after pagehide returned: the row waits for it
  app = journalApp({ idbDelay: 150 });
  row = await recoveryRow(app);
  assert.equal(row.status, 'PASS', row.reason);
});

test('recovery mirror row: a host that should journal and does not is a FAIL; a mode without a journal is SKIPPED with its reason', async (t) => {
  t.mock.method(console, 'log', () => {});
  // W1.2's worker host had no mirror, and the row was skipped there; with W1.3 that is a failure
  let app = journalApp({ mirror: false }), row = await recoveryRow(app);
  assert.equal(row.status, 'FAIL'); assert.match(row.reason, /host\.recovery is null/);
  assert.deepEqual([app.m.draws.length, app.m.pagehides], [0, 0]);
  // the IndexedDB copy is the one the worker's boot replay reads: localStorage alone does not pass
  app = journalApp({ idbWrites: false, ackTimeout: 300 }); row = await recoveryRow(app);
  assert.equal(row.status, 'FAIL'); assert.match(row.reason, /left no journal record in IndexedDB/);
  app = journalApp({ persistence: 'main', persistent: false, mirror: false }); row = await recoveryRow(app);
  assert.equal(row.status, 'SKIPPED'); assert.match(row.reason, /^no journal by design: the page's store does not persist/);
  assert.deepEqual([app.m.draws.length, app.m.pagehides], [0, 0], 'a skipped row edits nothing');
  app = journalApp({ kind: 'local', persistence: undefined, mirror: false }); row = await recoveryRow(app);
  assert.equal(row.status, 'SKIPPED'); assert.match(row.reason, /LocalSimHost uses snapshot recovery/);
  assert.equal(app.m.evaluations, 0, 'the local skip reads nothing from the page');
  // its prerequisite still applies: without a working zone tool the row cannot make its edit
  app = journalApp(); row = await recoveryRow(app, 'FAIL');
  assert.deepEqual([row.status, row.reason, app.m.evaluations], ['SKIPPED', 'prerequisite did not pass: zone', 0]);
});

test('recovery mirror row: one snapshot inside the window repeats the edit once; a second disagreement fails', async (t) => {
  t.mock.method(console, 'log', () => {});
  // a periodic snapshot lands between the edit's ack and pagehide: the edit is in the snapshot, not in the journal
  let app = journalApp({ snapshotAfterDraw: 1 }), row = await recoveryRow(app);
  assert.equal(row.status, 'PASS', row.reason);
  assert.deepEqual(app.m.draws, [[146, 154], [148, 154]]);
  assert.match(row.reason, /bound to snapshot; UI zone seq 12 retained/);
  assert.match(row.details.recoveryRebased, /snapshot base already contains the UI edit \(seq 11, fromCmd 11\)/);
  // twice in a row cannot be a periodic snapshot (30 s apart while paused)
  app = journalApp({ snapshotAfterDraw: 2 }); row = await recoveryRow(app);
  assert.equal(row.status, 'FAIL');
  assert.match(row.reason, /base already contains the UI edit \(seq 12, fromCmd 12\).*; a first edit read the same way \(.*seq 11, fromCmd 11.*\), so no save or snapshot explains it$/);
  assert.equal(app.m.draws.length, 2);
  // a journal bound to a save the database does not hold is not replayable, however often it is read
  app = journalApp(); app.records.get(`cities/${CITY_KEY}`).savedAt = 999; row = await recoveryRow(app);
  assert.equal(row.status, 'FAIL'); assert.match(row.reason, /bound to the save of 1000, but IndexedDB cities\/quickstart:3_2 holds the save of 999; a first edit read the same way/);
});

test('report: a check that finds it does not apply is SKIPPED with its reason, never PASS', async (t) => {
  t.mock.method(console, 'log', () => {});
  const report = new Report();
  await report.check('applies', async () => 'tested');
  await report.check('no journal here', async () => new Skipped('no journal by design'));
  await report.check('needs it', async () => 'unreachable', ['no journal here']);
  assert.deepEqual(report.checks.map((c) => [c.name, c.status, c.reason]),
    [['applies', 'PASS', 'tested'], ['no journal here', 'SKIPPED', 'no journal by design'], ['needs it', 'SKIPPED', 'prerequisite did not pass: no journal here']]);
  assert.equal(report.exitCode, 0);
  const none = new Report();
  await none.check('no journal here', async () => new Skipped('no journal by design'));
  assert.equal(none.exitCode, 3, 'a run of skips alone is not acceptance');
});

test('crash overlay: the W1.2 crash dialog and a crashed city fail the gate; a healthy page passes', async () => {
  // The page reads the real DOM; the same fake answers both a page-side read and a selector count.
  const dom = (titles, crashed) => ({
    document: { querySelectorAll: (sel) => sel === '.modal h2' ? titles.map((textContent) => ({ textContent })) : [] },
    window: { __metropolis: { city: { crashed } } },
  });
  const pageFor = (d) => ({
    async evaluate(fn, arg) {
      globalThis.window = d.window; globalThis.document = d.document;
      try { return fn(arg); } finally { delete globalThis.window; delete globalThis.document; }
    },
    locator: (sel) => ({ count: async () => d.document.querySelectorAll(sel).length, allTextContents: async () => [] }),
  });
  await assertNoCrashOverlay(pageFor(dom(['Settings'], undefined)), 'healthy');
  await assert.rejects(assertNoCrashOverlay(pageFor(dom(['The simulation stopped'], false)), 'after freeze'), /after freeze: "The simulation stopped" crash dialog/);
  await assert.rejects(assertNoCrashOverlay(pageFor(dom([], true)), 'at end'), /at end: the App marked the city crashed/);
});

test('freeze restore: normalize the hidden window, bring headed pages forward, and report persistent hidden state', async () => {
  globalThis.document = { visibilityState: 'hidden' };
  globalThis.window = { __qaWorker: { markVisible() {}, dispose() {} } };
  const calls = [], evidence = {}; let restore = true;
  const page = { evaluate: async (fn) => fn(), bringToFront: async () => { calls.push('front'); document.visibilityState = 'visible'; } };
  const cdp = { send: async (method, args) => {
    calls.push([method, args]);
    if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'page' } };
    if (method === 'Browser.getWindowForTarget') return { windowId: 42 };
    if (restore && args?.bounds?.windowState === 'normal') document.visibilityState = 'visible';
  } };
  await restoreVisibility(page, cdp, false, 50, evidence);
  assert.equal(evidence.visibilityAfterActive, 'hidden');
  assert.deepEqual(calls.slice(2).map(([, a]) => a.bounds.windowState), ['normal']);
  document.visibilityState = 'hidden'; calls.length = 0;
  await restoreVisibility(page, cdp, true, 50, {});
  assert.equal(calls.at(-1), 'front');
  document.visibilityState = 'hidden'; page.bringToFront = async () => {}; restore = false;
  await assert.rejects(restoreVisibility(page, cdp, true, 10, {}), /page stayed hidden after active/);
});

test('cleanup: secondary failure preserves primary error and reports cleanup evidence', async () => {
  const cleanup = [];
  await assert.rejects(withCleanup(async () => { throw new Error('primary ack failure'); }, async () => { throw new Error('cleanup failure'); }, (e) => cleanup.push(e.message)), /^Error: primary ack failure$/);
  assert.deepEqual(cleanup, ['cleanup failure']);
  await assert.rejects(withCleanup(async () => {}, async () => { throw new Error('cleanup alone'); }), /cleanup alone/);
});

test('exit status: an entirely skipped run is distinct from acceptance', () => {
  const report = new Report();
  report.checks = [{ status: 'SKIPPED' }]; assert.equal(report.exitCode, 3);
  report.checks.push({ status: 'PASS' }); assert.equal(report.exitCode, 0);
  report.checks.push({ status: 'FAIL' }); assert.equal(report.exitCode, 1);
});

test('control reporting: report-write failure never announces a successful negative control', async (t) => {
  const logs = [];
  t.mock.method(console, 'log', (line) => logs.push(line));
  const report = new Report();
  report.checks = [{ name: 'zone', status: 'FAIL', failure: { op: 'zone', kind: 'ack-timeout' } }];
  report.details.brokenBuild = { op: 'zone', rewrites: 1 };
  // An existing directory cannot be opened as a report file; no artifact is created.
  await report.finish({ breakAck: 'zone', out: new URL('./', import.meta.url) });
  assert.equal(logs.some((line) => line.startsWith('PASS broken-build control')), false);
  assert.equal(report.checks.find((c) => c.name === 'broken-build control').status, 'FAIL');
});

test('loopback oracle: exact unposted refusals are classified without satisfying transported ack coverage', async () => {
  const refusal = rows({ seq: 0, exact: true, predicted: { ok: false }, result: { ok: false, reason: 'Nothing to change' } });
  await waitForAcks(async () => refusal, 'terraform', 10, { allowFailure: true });
  await assert.rejects(waitForAcks(async () => refusal, 'terraform', 10), /invalid ticket/);
  await assert.rejects(waitForAcks(async () => rows({ ...refusal[0], exact: false }), 'terraform', 10, { allowFailure: true }), /invalid ticket/);
  validateSession([...refusal, ...rows({ seq: 1 })]);
  assert.throws(() => validateSession(rows({ seq: 0, exact: true, predicted: { ok: true } })), /unposted refusal/);
});

test('loopback oracle: only same-key sliders sharing the actual promise may coalesce sequences', () => {
  const slider = { op: 'setTax', args: [0, 9], seq: 1, ticketId: 3 };
  validateSession([slider, { ...slider, args: [0, 10] }, { op: 'zone', seq: 2 }]);
  for (const changed of [{ ticketId: 4 }, { op: 'zone' }, { args: [1, 10] }]) {
    assert.throws(() => validateSession([slider, { ...slider, ...changed }]), /coalesced/);
  }
  assert.throws(() => validateSession([{ op: 'zone', seq: 2 }, slider]), /did not increase/);
});

test('probe: forwards save reason and observes the real host save watermark', async () => {
  const { host, scene } = fixture();
  host.save = async (reason) => ({ cmd: 5, savedAt: 100, reason });
  scene.save = function (...args) { this.args = args; return host.save(args[1]); };
  installProbe();
  await scene.save(false, 'exit');
  assert.deepEqual(scene.args, [false, 'exit']);
  assert.equal(window.__qaWorker.saves[0].reason, 'exit');
  assert.equal(window.__qaWorker.hostSaves[0].ack.cmd, 5);
  assert.equal(window.__qaWorker.hostSaves[0].reason, 'exit');
});

test('broken loopback build: only target settlement is withheld; packet mutation and other acks still complete', async () => {
  const source = await readFile(new URL('../../src/worker/LoopbackSimHost.ts', import.meta.url), 'utf8');
  const evidence = {}, plugin = breakAckPlugin('zone', evidence, 'loopback');
  const out = plugin.transform(source, '/repo/src/worker/LoopbackSimHost.ts'); plugin.generateBundle();
  assert.deepEqual(evidence, { op: 'zone', host: 'loopback', rewrites: 1 });
  const body = out.code.split('private ack(seq: number, result: unknown): void {')[1].split('  beginGesture(')[0];
  const ack = new Function('seq', 'result', body.slice(0, body.lastIndexOf('}')));
  let resolved = 0, pendingCleared = 0;
  const target = { tickets: new Map([[1, { resolve() { resolved++; } }], [2, { resolve() { resolved++; } }]]),
    edits: new Map([[1, { op: 'zone' }], [2, { op: 'dezone' }]]), options: {}, controller: { pending: { ack() { pendingCleared++; } } } };
  ack.call(target, 1, { ok: true });
  assert.equal(resolved, 0); assert.equal(target.edits.has(1), false); assert.equal(pendingCleared, 1);
  ack.call(target, 2, { ok: true });
  assert.equal(resolved, 1); assert.equal(pendingCleared, 2);
  assert.throws(() => breakAckPlugin('zone', {}, 'loopback').transform('drift', '/repo/src/worker/LoopbackSimHost.ts'), /acknowledgement changed/);
  assert.equal(await readFile(new URL('../../src/worker/LoopbackSimHost.ts', import.meta.url), 'utf8'), source);
});

test('probe: abort teardown measures the original world even after the scene replaces it', async () => {
  const { host, ctx } = fixture();
  ctx.world = { pendingPreviews: new Map([[1, {}]]) };
  installProbe(); host.dispose(); ctx.world = {};
  await Promise.resolve();
  assert.equal(window.__qaWorkerArchive.teardown.ghosts, 1, 'a leaked old-world ghost must remain visible to the oracle');
  assert.equal(window.__qaWorkerArchive.teardown.aborted, true);
});

test('ready: instruments the arriving real view after loading views are replaced', async () => {
  const { ctx } = fixture();
  const real = { setPendingPreview() {} }, original = real.setPendingPreview;
  let waits = 0;
  const page = { evaluate: async (fn, arg) => fn(arg), waitForFunction: async (fn) => {
    if (++waits === 2) ctx.world = real;
    assert.ok(fn());
  } };
  await new Driver(page, { host: 'local' }).ready();
  assert.notEqual(real.setPendingPreview, original);
  window.__qaWorker.dispose();
  assert.equal(real.setPendingPreview, original);
});

test('probe control: an exact unposted refusal cannot consume the dropped transported ack', async () => {
  const { host } = fixture();
  let calls = 0;
  host.act = () => ++calls === 1
    ? { seq: 0, exact: true, predicted: { ok: false }, done: Promise.resolve({ ok: false }) }
    : { seq: 1, exact: true, predicted: { ok: true }, done: Promise.resolve({ ok: true }) };
  installProbe({ dropAck: 'zone' });
  await host.act('zone', []).done; host.act('zone', []);
  assert.equal(window.__qaWorker.commands[0].dropped, undefined);
  assert.equal(window.__qaWorker.commands[1].dropped, true);
});

test('broken controls: healthy asynchronous pending reads end as ack timeout, with the actual ticket seq', async () => {
  let reads = 0;
  await assert.rejects(waitForAcks(async () => {
    reads++; await new Promise((r) => setTimeout(r, 2));
    return rows({ seq: 4, status: 'pending' });
  }, 'zone', 15), (e) => {
    assert.equal(e.code, 'poll-timeout');
    assert.deepEqual(e.failure, { op: 'zone', kind: 'ack-timeout', seqs: [4] });
    return true;
  });
  assert.equal(reads, 1, 'expiry must not launch a new browser read with a fractional remaining budget');
});

test('broken controls: an oversleep cannot launch a one-millisecond browser read after the ack deadline', async (t) => {
  let now = 0, reads = 0;
  const original = globalThis.setTimeout;
  t.mock.method(performance, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => original(() => {
    if (ms === 50) now = 101;
    fn(...args);
  }, ms === 50 ? 1 : ms));
  await assert.rejects(waitForAcks(async () => { reads++; return rows({ seq: 5, status: 'pending' }); }, 'zone', 100),
    (e) => e.failure.kind === 'ack-timeout' && e.failure.seqs[0] === 5 && e.code === 'poll-timeout');
  assert.equal(reads, 1);
});

test('Query toolbar: null activeId is the selected default QueryTool, never a failed selection', () => {
  const { ctx, scene } = fixture();
  ctx.tools.active = { id: 'query' }; ctx.tools.activeId = null; scene.tools = ctx.tools;
  assert.equal(toolSelected('query'), true);
  assert.equal(toolSelected('bulldoze'), false);
  ctx.tools.active = { id: 'bulldoze' }; ctx.tools.activeId = 'bulldoze';
  assert.equal(toolSelected('query'), false);
});

test('Onboarding Play: hover the row, wait for a real actionable button, then issue the click', async () => {
  const order = [];
  const button = { filter() { return this; }, async click(opts) { order.push(opts?.trial ? 'trial' : 'click'); } };
  const row = { filter() { return this; }, async hover() { order.push('hover'); }, locator() { return button; } };
  const card = { locator() { return row; } };
  const page = { locator(selector) {
    if (selector === '.onboard.show.min') return { count: async () => 0 };
    if (selector === '.onboard.show') return card;
    return button;
  } };
  const d = new Driver(page, {});
  d.command = async (op, input) => { assert.equal(op, 'setSpeed'); order.push('observe'); await input(); return rows(); };
  await d.onboardingPlay();
  assert.deepEqual(order, ['hover', 'trial', 'observe', 'click']);
});

test('Dispatch input waits for packet watch data and the initial tool camera fit before station focus', async () => {
  const { scene, ctx } = fixture();
  const t = { id: 'dispatch', inc: 1, fitPending: true, opts: [], optionsWatch: { value: undefined, version: 0 } };
  scene.tools = { active: t }; ctx.world = { controls: { target: { x: 1544, z: 2032 }, distance: 1447 } };
  assert.equal(dispatchState({ incident: 1, station: 6 }).ready, false);
  t.optionsWatch.value = [{ stationId: 6 }]; t.optionsWatch.version++; t.opts = t.optionsWatch.value;
  assert.equal(dispatchState({ incident: 1, station: 6 }).ready, false, 'watch data alone does not finish initial camera fitting');
  t.fitPending = false;
  const d = new Driver({ evaluate: async (fn, arg) => fn(arg) }, { ackTimeout: 100 });
  const ready = await d.waitForDispatch(1, 6);
  assert.equal(ready.ready, true); assert.equal(ready.version, 1);
  assert.equal(dispatchState({ incident: 1, station: 7 }).ready, false);
});

function protectorRuntime(canOptimize) {
  const state = { active: false, status: 41 };
  const context = { __native: {
    PrepareFunctionForOptimization() {},
    OptimizeFunctionOnNextCall() { state.active = canOptimize; },
    GetOptimizationStatus() { return state.status; },
    ActiveTierIsTurbofan() { return state.active; },
  } };
  // Simulate V8 intrinsics without a particular engine's numeric status layout or native-syntax flag.
  const source = `(${installProtector.toString().replaceAll('%', '__native.')})();`;
  runInNewContext(source, context);
  return { context, state, reinstall: () => runInNewContext(source, context) };
}

test('protector probe: active TurboFan passes with status 41; status drift alone cannot fail it', () => {
  const { context, state, reinstall } = protectorRuntime(true), probe = context.__qaProtector;
  assert.equal(probe().intact, true);
  state.status = 81;
  assert.equal(probe().intact, true);
  state.active = false;
  assert.equal(probe().intact, false);
  state.active = true; reinstall();
  assert.equal(context.__qaProtector, probe);
  assert.equal(probe().intact, false, 'tier recovery or reinstallation must not erase an invalidation');
});

test('protector probe: numeric status cannot substitute for an active TurboFan dependency', () => {
  const { context } = protectorRuntime(false), result = context.__qaProtector();
  assert.equal(result.intact, false);
  assert.match(result.error, /did not reach TurboFan.*41, 41, 41, 41/);
});

const INTACT = { intact: true, turbofan: true, initial: 41, status: 41 }, INVALIDATED = { intact: false, turbofan: false, initial: 41, status: 16641 };
/** The page and its CDP session, with dedicated workers that attach, change, fail to answer and go away. */
function protectorPage() {
  const cdp = new EventEmitter(), sent = [], names = new Map(), probes = new Map(), broken = new Map();
  const f = { cdp, sent, main: INTACT, mainReads: 0 };
  cdp.send = async (method, params) => {
    if (method === 'Target.sendMessageToTarget') {
      if (broken.has(params.sessionId)) throw broken.get(params.sessionId);
      const m = JSON.parse(params.message); sent.push({ session: params.sessionId, ...m });
      let result = {};
      if (m.method === 'Runtime.evaluate') {
        const value = m.params.expression === 'self.name' ? names.get(params.sessionId)
          : m.params.expression === 'self.__qaProtector()' ? probes.get(params.sessionId)
          : { name: names.get(params.sessionId), probe: probes.get(params.sessionId) };
        result = { result: { value } };
      }
      queueMicrotask(() => cdp.emit('Target.receivedMessageFromTarget', { message: JSON.stringify({ id: m.id, result }) }));
    }
    return {};
  };
  cdp.detach = async () => {};
  f.page = { addInitScript: async () => {}, context: () => ({ newCDPSession: async () => cdp }),
    evaluate: async () => { f.mainReads++; if (f.main instanceof Error) throw f.main; return f.main; } };
  /** the page's probe now; an Error makes the read itself fail */
  f.setMain = (value) => { f.main = value; };
  f.attach = (session, name, probe = INTACT) => {
    names.set(session, name); probes.set(session, probe);
    cdp.emit('Target.attachedToTarget', { sessionId: session, waitingForDebugger: true, targetInfo: { type: 'worker', url: 'test-worker' } });
  };
  f.setProbe = (session, probe) => probes.set(session, probe);
  /** the worker ended: a reload, or its city was left */
  f.detach = (session) => cdp.emit('Target.detachedFromTarget', { sessionId: session });
  f.breakSession = (session, error) => broken.set(session, error);
  return f;
}
const statuses = (reading) => [reading.main.status, reading.sim.status];

test('protector rows: the two isolates are read and judged separately; neither failure hides the other', async () => {
  const f = protectorPage(), gate = await watchProtectors(f.page);
  try {
    f.attach('sim', 'sim');
    let r = await gate.read(true);
    assert.deepEqual(statuses(r), ['PASS', 'PASS']);
    assert.equal(r.main.reason, `intact: ${JSON.stringify(INTACT)}`); assert.equal(r.sim.reason, `intact: ${JSON.stringify(INTACT)}`);
    // the real-GPU run's case (B3): the page's protector is gone, and the old check stopped before reading the worker
    f.setMain(INVALIDATED);
    r = await gate.read(true);
    assert.deepEqual(statuses(r), ['FAIL', 'PASS']);
    assert.equal(r.main.reason, `main protector unavailable/invalidated: ${JSON.stringify(INVALIDATED)}`);
    assert.deepEqual([r.main.probe, r.sim.probe], [INVALIDATED, INTACT]);
    // and the other way round: the worker's failure leaves the page's row alone
    f.setMain(INTACT); f.setProbe('sim', INVALIDATED);
    r = await gate.read(true);
    assert.deepEqual(statuses(r), ['PASS', 'FAIL']);
    assert.equal(r.sim.reason, `sim worker protector invalidated: ${JSON.stringify(INVALIDATED)}`);
    f.setMain(INVALIDATED);
    assert.deepEqual(statuses(await gate.read(true)), ['FAIL', 'FAIL']);
  } finally { await gate.dispose(); }
});

test('protector rows: LOD workers resume without a sim probe; without a sim worker the row is skipped, or fails where the host needs one', async () => {
  const f = protectorPage(), gate = await watchProtectors(f.page);
  try {
    f.attach('lod', 'lod-proxies-0', { intact: false, error: 'cold render worker' });
    // local and loopback run the simulation in the main isolate: nothing to read, so nothing to pass
    let r = await gate.read(false);
    assert.deepEqual(statuses(r), ['PASS', 'SKIPPED']);
    assert.match(r.sim.reason, /^no dedicated sim worker on this host: the simulation runs in the main isolate/);
    assert(!f.sent.some((s) => s.session === 'lod' && s.params?.expression?.includes('installProtector')));
    assert(f.sent.some((s) => s.session === 'lod' && s.method === 'Runtime.runIfWaitingForDebugger'));
    // --host worker: a missing sim worker fails its own row, and the page still gets its verdict
    r = await gate.read(true);
    assert.deepEqual(statuses(r), ['PASS', 'FAIL']);
    assert.match(r.sim.reason, /^expected one dedicated worker named sim; found \[\]$/);
    f.setMain({ intact: false, status: 1 });
    r = await gate.read(false);
    assert.deepEqual(statuses(r), ['FAIL', 'SKIPPED']);
    assert.match(r.main.reason, /main protector unavailable\/invalidated/);
    // a worker named sim on a host that does not need one is still read, not waved through
    f.setMain(INTACT); f.attach('extra', 'sim');
    r = await gate.read(false);
    assert.deepEqual(statuses(r), ['PASS', 'PASS']); assert.match(r.sim.reason, /a worker named sim, which this host does not require/);
    f.attach('second', 'sim');
    assert.match((await gate.read(true)).sim.reason, /expected one dedicated worker named sim; found \[\{"name":"sim","url":"test-worker"\},\{"name":"sim","url":"test-worker"\}\]/);
  } finally { await gate.dispose(); }
});

test('protector rows: the sim worker is probed before startup; a baseline that could not be made fails its row on every host', async () => {
  const f = protectorPage(), gate = await watchProtectors(f.page);
  try {
    f.attach('sim', 'sim');
    assert.deepEqual(statuses(await gate.read(true)), ['PASS', 'PASS']);
    assert(f.sent.some((s) => s.session === 'sim' && s.params?.expression?.includes('installProtector')));
  } finally { await gate.dispose(); }
  const bad = protectorPage(), badGate = await watchProtectors(bad.page);
  try {
    bad.attach('sim', 'sim', { intact: false, error: 'did not optimize' });
    let r = await badGate.read(true);
    assert.deepEqual(statuses(r), ['PASS', 'FAIL']);
    assert.match(r.sim.reason, /worker protector could not initialize/);
    assert(bad.sent.some((s) => s.method === 'Runtime.runIfWaitingForDebugger'));
    // a worker that could not be identified cannot be ruled out as the sim worker: no skip on a host without one
    r = await badGate.read(false);
    assert.deepEqual(statuses(r), ['PASS', 'FAIL']);
    assert.match(r.sim.reason, /^worker protector could not initialize/);
  } finally { await badGate.dispose(); }
});

test('protector rows: a reload cannot erase an earlier invalidation; the row keeps failing and also says what the new isolate reads', async () => {
  const f = protectorPage(), gate = await watchProtectors(f.page);
  try {
    f.attach('first', 'sim');
    await gate.checkpoint('before reload', true);
    assert.deepEqual(statuses(await gate.read(true)), ['PASS', 'PASS'], 'a clean checkpoint keeps nothing');
    f.setMain(INVALIDATED);
    await gate.checkpoint('before reload', true);
    // the reload: a fresh page isolate and a fresh worker, both intact
    f.setMain(INTACT); f.detach('first'); f.attach('second', 'sim');
    const r = await gate.read(true);
    assert.deepEqual(statuses(r), ['FAIL', 'PASS']);
    assert.equal(r.main.reason, `before reload: main protector unavailable/invalidated: ${JSON.stringify(INVALIDATED)}; the current main isolate reads intact: ${JSON.stringify(INTACT)}`);
    assert.equal(r.sim.reason, `intact: ${JSON.stringify(INTACT)}`, 'the worker was intact before the reload and is now');
    assert.deepEqual(statuses(await gate.read(true)), ['FAIL', 'PASS'], 'and it stays in every later row');
  } finally { await gate.dispose(); }
});

test('protector rows: a city\'s worker that ends at exit to region keeps its invalidation in the later sim rows', async () => {
  const f = protectorPage(), gate = await watchProtectors(f.page);
  try {
    f.attach('city', 'sim');
    assert.deepEqual(statuses(await gate.read(true)), ['PASS', 'PASS']);
    f.setProbe('city', INVALIDATED);
    const reads = f.mainReads;
    await gate.checkpoint('before exit to region', true, ['sim']);
    assert.equal(f.mainReads, reads, 'the page\'s isolate stays: only the departing worker is read');
    // the region screen pre-spawns the next city's worker
    f.detach('city'); f.attach('next', 'sim');
    const r = await gate.read(true);
    assert.deepEqual(statuses(r), ['PASS', 'FAIL']);
    assert.equal(r.sim.reason, `before exit to region: sim worker protector invalidated: ${JSON.stringify(INVALIDATED)}; the current sim worker reads intact: ${JSON.stringify(INTACT)}`);
    // without the checkpoint the replaced worker's state is gone with it
    const g = protectorPage(), unchecked = await watchProtectors(g.page);
    try {
      g.attach('city', 'sim');
      await unchecked.read(true);
      g.setProbe('city', INVALIDATED); g.detach('city'); g.attach('next', 'sim');
      assert.deepEqual(statuses(await unchecked.read(true)), ['PASS', 'PASS']);
    } finally { await unchecked.dispose(); }
  } finally { await gate.dispose(); }
});

test('protector rows: a read that fails is that isolate\'s failure, never an exception that ends the other\'s read', async () => {
  const f = protectorPage(), gate = await watchProtectors(f.page);
  try {
    f.attach('sim', 'sim');
    f.setMain(new Error('page evaluation timed out (renderer/simulation unresponsive)'));
    let r = await gate.read(true);
    assert.deepEqual(statuses(r), ['FAIL', 'PASS']);
    assert.match(r.main.reason, /^main isolate probe unreadable: page evaluation timed out/);
    f.setMain(INTACT); f.breakSession('sim', new Error('Target closed'));
    r = await gate.read(true);
    assert.deepEqual(statuses(r), ['PASS', 'FAIL']);
    assert.match(r.sim.reason, /^sim worker probe unreadable: Target closed$/);
    // the same holds for a checkpoint: it records, and never throws into the UI check that is running
    f.setMain(new Error('page closed'));
    await gate.checkpoint('before reload', true);
    f.setMain(INTACT); f.detach('sim'); f.attach('after', 'sim');
    r = await gate.read(true);
    assert.deepEqual(statuses(r), ['FAIL', 'FAIL']);
    assert.match(r.main.reason, /^before reload: main isolate probe unreadable: page closed; the current main isolate reads intact/);
    assert.match(r.sim.reason, /^before reload: sim worker probe unreadable: Target closed; the current sim worker reads intact/);
  } finally { await gate.dispose(); }
});

test('run wiring: the departing isolates are read before the reload and before exit; the preview takes --port; Chromium takes the GPU flags', async () => {
  // these lines run only in a browser: their place in the flow is pinned here
  const checks = await readFile(new URL('./checks.mjs', import.meta.url), 'utf8'), at = (text) => { const i = checks.indexOf(text); assert(i >= 0, text); return i; };
  assert(at("await protectors.checkpoint('before reload', options.host === 'worker');") < at('await page.reload('));
  assert(at("await protectors.checkpoint('before exit to region', true, ['sim']);") < at("hasText: 'Save & exit to region' }).click()"));
  assert(at("await protector('at boot');") < at("await protector('at end');") && at("await protector('at end');") < at("await protector('after freeze');"));
  assert(at('await recoveryMirror(d, report);') < at("await report.check('setCamera / Ctrl+S save'"), 'the journal is read before the save that trims it');
  const run = await readFile(new URL('./run.mjs', import.meta.url), 'utf8');
  assert.match(run, /await report\.check\('production build', async \(\) => \{\s+if \(options\.port\) await assertPortFree\(options\.port\);\s+const vite = await import\('vite'\);/, 'a taken port fails before the build');
  assert.match(run, /preview: \{ port: options\.port \?\? 0, host: '127\.0\.0\.1', strictPort: true, open: false \}/);
  assert.match(run, /report\.details\.gpuFlags = \[\.\.\.\(options\.swiftshader \? SWIFTSHADER : GPU\)\];/);
  assert.match(run, /args: \[\.\.\.report\.details\.gpuFlags, `--js-flags=\$\{PROTECTOR_V8_FLAGS\.join\(' '\)\}`\]/);
  assert.match(checks, /const problem = options\.swiftshader \? null : realGpuProblem\(state\);\s+assert\(!problem, problem\);/);
});

test('protector rows: each point of the run reports its two rows from one reading; skips say why', async (t) => {
  t.mock.method(console, 'log', () => {});
  assert.deepEqual(protectorRows('at boot'), ['protector at boot / main isolate', 'protector at boot / sim worker']);
  for (const when of ['at boot', 'at end', 'after freeze']) for (const name of protectorRows(when)) assert(BROWSER_CHECKS.includes(name), name);
  assert.deepEqual(BROWSER_CHECKS.filter((name) => /^protector/.test(name) && !/ \/ (main isolate|sim worker)$/.test(name)), [], 'no row that covers both isolates is left');
  assert.equal(new Set(BROWSER_CHECKS).size, BROWSER_CHECKS.length);
  const rowsOf = (report) => report.checks.map((c) => [c.name, c.status]);
  // --host worker with the page's protector gone: the worker's row still passes, as its own row
  const f = protectorPage(), gate = await watchProtectors(f.page);
  try {
    f.attach('sim', 'sim'); f.setMain(INVALIDATED);
    const report = new Report(), reads = f.mainReads;
    await protectorCheck(report, { w1: true, host: 'worker' }, gate, 'at end');
    assert.deepEqual(rowsOf(report), [['protector at end / main isolate', 'FAIL'], ['protector at end / sim worker', 'PASS']]);
    assert.equal(f.mainReads, reads + 1, 'both rows come from one reading');
    assert.deepEqual(report.details.protectors['protector at end / sim worker'], { status: 'PASS', reason: `intact: ${JSON.stringify(INTACT)}`, probe: INTACT });
    assert.equal(report.details.protectors['protector at end / main isolate'].probe.status, 16641);
    assert.equal(report.exitCode, 1);
  } finally { await gate.dispose(); }
  // --host loopback: the page's row passes, and the sim worker's is skipped with its reason
  const g = protectorPage(), loopback = await watchProtectors(g.page);
  try {
    const report = new Report();
    await protectorCheck(report, { w1: true, host: 'loopback' }, loopback, 'after freeze');
    assert.deepEqual(rowsOf(report), [['protector after freeze / main isolate', 'PASS'], ['protector after freeze / sim worker', 'SKIPPED']]);
    assert.match(report.checks[1].reason, /no dedicated sim worker on this host/);
    // --host local without --w1, and a run narrowed by --only: skipped without reading either isolate
    const local = new Report(), reads = g.mainReads;
    await protectorCheck(local, { w1: false, host: 'local' }, null, 'at boot');
    assert.deepEqual(local.checks.map((c) => [c.status, c.reason]), Array(2).fill(['SKIPPED', 'local host: use --w1 to include the shared digest and protector gates']));
    const only = new Report(); only.configure({ only: 'freeze' });
    await protectorCheck(only, { w1: true, host: 'loopback' }, loopback, 'at boot');
    assert.deepEqual(only.checks.map((c) => [c.status, c.reason]), Array(2).fill(['SKIPPED', 'not selected by --only freeze']));
    assert.equal(g.mainReads, reads);
  } finally { await loopback.dispose(); }
});

test('freeze adapter: disable focus emulation on Playwright owning session, failing closed on API or version drift', async () => {
  const calls = [], owner = { send: async (...args) => calls.push(args) };
  const page = { _connection: { toImpl(p) { assert.equal(p, page); return { delegate: { _mainFrameSession: { _client: owner } } }; } } };
  await owningLifecycleSession(page, '1.56.1').send('Emulation.setFocusEmulationEnabled', { enabled: false });
  assert.deepEqual(calls, [['Emulation.setFocusEmulationEnabled', { enabled: false }]]);
  assert.throws(() => owningLifecycleSession(page, '2.0.0'), /supports Playwright 1.56.1/);
  assert.throws(() => owningLifecycleSession({}, '1.56.1'), /owning CDP session is unavailable/);
});

test('freeze setup: requires a genuinely hidden page before attempting frozen lifecycle', async () => {
  globalThis.document = { visibilityState: 'visible' };
  const calls = [], evidence = {}, page = { evaluate: async (fn) => fn() };
  const cdp = { send: async (method, args) => {
    calls.push([method, args]);
    if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'page' } };
    if (method === 'Browser.getWindowForTarget') return { windowId: 42 };
    if (args?.bounds?.windowState === 'minimized') document.visibilityState = 'hidden';
  } };
  await hideForFreeze(page, cdp, 20, evidence);
  assert.equal(evidence.windowId, 42); assert.equal(document.visibilityState, 'hidden');
  assert.equal(calls.at(-1)[1].bounds.windowState, 'minimized');
  document.visibilityState = 'visible'; cdp.send = async () => ({ targetInfo: { targetId: 'page' }, windowId: 42 });
  await assert.rejects(hideForFreeze(page, cdp, 10, {}), /page did not become hidden/);
});

test('freeze control: a CDP frozen acknowledgement without a real DOM freeze fails and restores focus/visibility', async () => {
  const { host } = fixture();
  globalThis.document = new EventTarget(); document.visibilityState = 'visible';
  installProbe();
  const cdp = new EventEmitter(), calls = [], owner = { send: async (method, args) => calls.push([method, args]) };
  cdp.send = async (method, args) => {
    calls.push([method, args]);
    if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'page' } };
    if (method === 'Browser.getWindowForTarget') return { windowId: 42 };
    if (method === 'Runtime.addBinding') window[args.name] = (payload) => cdp.emit('Runtime.bindingCalled', { name: args.name, payload });
    if (method === 'Runtime.removeBinding') delete window[args.name];
    if (method === 'Browser.setWindowBounds') {
      document.visibilityState = args.bounds.windowState === 'minimized' ? 'hidden' : 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    }
    return {};
  };
  cdp.detach = async () => calls.push(['detach']);
  const page = { evaluate: async (fn, arg) => { host.state.day++; return fn(arg); }, context: () => ({ newCDPSession: async () => cdp }),
    _connection: { toImpl: () => ({ delegate: { _mainFrameSession: { _client: owner } } }) }, isClosed: () => false };
  const d = { page, options: { ackTimeout: 10 }, clean: async () => {}, speed: async () => {}, cleanupErrors: [] };
  const report = { details: {} };
  await assert.rejects(freeze(d, report), /browser did not emit a real document freeze event/);
  assert.deepEqual(calls.filter(([m]) => m === 'Emulation.setFocusEmulationEnabled').map(([, a]) => a.enabled), [false, true]);
  assert.deepEqual(calls.filter(([m]) => m === 'Page.setWebLifecycleState').map(([, a]) => a.state), ['frozen', 'active']);
  assert.equal(document.visibilityState, 'visible'); assert.equal(calls.at(-1)[0], 'detach');
  assert.equal(report.details.freeze.frozenForMs, undefined, '15-second hold must not start without real freeze evidence');
});
