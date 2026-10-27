/** Browser-free tests of the acceptance oracle; run: node tools/qa-worker/selftest.mjs. Outside Vitest discovery. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseArgs, waitForAcks, poll, selectedChecks, CHECKS, brokenBuildVerdict, withCleanup, Report } from './harness.mjs';
import { installProbe, savedMarkers } from './page.mjs';
import { breakAckPlugin } from './build.mjs';
import { resumeDelay, restoreVisibility } from './freeze.mjs';
import { Driver } from './driver.mjs';

const rows = (extra = {}) => [{ seq: 1, status: 'resolved', result: { ok: true }, ...extra }];
afterEach(() => { globalThis.window?.__qaWorker?.dispose(); delete globalThis.window; delete globalThis.document; });

test('CLI: defaults, host validation and explicit W1 gate', () => {
  assert.deepEqual(parseArgs([]), { host: 'local', swiftshader: false, headed: false, w1: false, ackTimeout: 8000, bootTimeout: 180000 });
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['--host', 'worker', '--w1', '--swiftshader']).host, 'worker');
  assert.equal(parseArgs(['--break-ack', 'zone']).only, 'zone');
  assert.equal(parseArgs(['--only', 'freeze']).only, 'freeze');
  for (const args of [['--host', 'other'], ['--out'], ['--ack-timeout', '-1'], ['--boot-timeout', 'NaN'], ['--drop-ack', 'unknown'], ['--digest-module', 'x.ts'], ['--wat'], ['--only', 'typo'], ['--break-ack', 'zone', '--only', 'freeze'], ['--break-ack', 'zone', '--drop-ack', 'zone'], ['--break-ack', 'zone', '--host', 'worker']]) {
    assert.throws(() => parseArgs(args));
  }
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
  try { assert.equal((await waitForAcks(async () => r, 'setTax', 100)).length, 1); }
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
  assert.deepEqual(evidence, { op: 'zone', rewrites: 1 });
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
  await assert.rejects(waitForAcks(async () => {
    if (reads++) throw new Error('probe broke');
    return rows({ status: 'pending' });
  }, 'zone', 100), (e) => e.failure.kind === 'missing-command' && e.message === 'probe broke');
});

test('freeze oracle: deadline starts at later resume/visible; hidden, delayed and frozen-frame evidence fails', () => {
  const f = { frozenAt: 0, resumedAt: 15000, visibleAt: 15500, advancedAt: 16499, framesDuringFreeze: [] };
  assert.equal(resumeDelay(f), 999);
  assert.equal(resumeDelay({ ...f, resumedAt: 15600 }), 899);
  assert.throws(() => resumeDelay({ ...f, visibleAt: null }), /stayed hidden/);
  assert.throws(() => resumeDelay({ ...f, advancedAt: 16501 }), /limit 1000/);
  assert.throws(() => resumeDelay({ ...f, framesDuringFreeze: [1] }), /frames while frozen/);
});

test('freeze restore: headless minimizes/normalizes, headed brings to front, hidden timeout is specific', async () => {
  globalThis.document = { visibilityState: 'hidden' };
  globalThis.window = { __qaWorker: { markVisible() {}, dispose() {} } };
  const calls = [], evidence = {};
  const page = { evaluate: async (fn) => fn(), bringToFront: async () => { calls.push('front'); document.visibilityState = 'visible'; } };
  const cdp = { send: async (method, args) => {
    calls.push([method, args]);
    if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'page' } };
    if (method === 'Browser.getWindowForTarget') return { windowId: 42 };
    if (args?.bounds?.windowState === 'normal') document.visibilityState = 'visible';
  } };
  await restoreVisibility(page, cdp, false, 50, evidence);
  assert.equal(evidence.visibilityAfterActive, 'hidden');
  assert.deepEqual(calls.slice(2).map(([, a]) => a.bounds.windowState), ['minimized', 'normal']);
  document.visibilityState = 'hidden'; calls.length = 0;
  await restoreVisibility(page, cdp, true, 50, {});
  assert.deepEqual(calls, ['front']);
  document.visibilityState = 'hidden'; page.bringToFront = async () => {};
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
