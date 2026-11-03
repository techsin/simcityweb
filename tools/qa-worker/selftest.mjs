/** Browser-free tests of the acceptance oracle; run: node tools/qa-worker/selftest.mjs. Outside Vitest discovery. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { parseArgs, waitForAcks, poll, selectedChecks, CHECKS, brokenBuildVerdict, withCleanup, Report, validateSession } from './harness.mjs';
import { installProbe, savedMarkers } from './page.mjs';
import { breakAckPlugin } from './build.mjs';
import { freeze, hideForFreeze, resumeDelay, restoreVisibility } from './freeze.mjs';
import { owningLifecycleSession } from './lifecycle.mjs';
import { Driver, toolSelected, dispatchState } from './driver.mjs';
import { installProtector, watchProtectors } from './w1.mjs';

const rows = (extra = {}) => [{ seq: 1, status: 'resolved', result: { ok: true }, ...extra }];
afterEach(() => { globalThis.window?.__qaWorker?.dispose(); delete globalThis.window; delete globalThis.document; });

test('CLI: loopback runs by default; worker shares the host switch; local W1 is optional', () => {
  assert.deepEqual(parseArgs([]), { host: 'loopback', swiftshader: false, headed: false, w1: true, ackTimeout: 8000, bootTimeout: 180000 });
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

function protectorPage() {
  const cdp = new EventEmitter(), sent = [], names = new Map(), probes = new Map();
  let main = { intact: true };
  cdp.send = async (method, params) => {
    if (method === 'Target.sendMessageToTarget') {
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
  return { cdp, sent, page: { addInitScript: async () => {}, context: () => ({ newCDPSession: async () => cdp }), evaluate: async () => main },
    setMain(value) { main = value; }, attach(session, name, probe = { intact: true }) {
      names.set(session, name); probes.set(session, probe);
      cdp.emit('Target.attachedToTarget', { sessionId: session, waitingForDebugger: true, targetInfo: { type: 'worker', url: 'test-worker' } });
    } };
}

test('protector gate: LOD workers resume without a sim probe; missing sim and invalid main still fail', async () => {
  const f = protectorPage(), gate = await watchProtectors(f.page);
  try {
    f.attach('lod', 'lod-proxies-0', { intact: false, error: 'cold render worker' });
    assert.match(await gate.check(false), /main intact/);
    assert(!f.sent.some((s) => s.session === 'lod' && s.params?.expression?.includes('installProtector')));
    assert(f.sent.some((s) => s.session === 'lod' && s.method === 'Runtime.runIfWaitingForDebugger'));
    await assert.rejects(gate.check(true), /expected one dedicated worker named sim/);
    f.setMain({ intact: false, status: 1 });
    await assert.rejects(gate.check(false), /main protector unavailable\/invalidated/);
  } finally { await gate.dispose(); }
});

test('protector gate: the sim worker is probed before startup and initialization failure stays a failure', async () => {
  const f = protectorPage(), gate = await watchProtectors(f.page);
  try {
    f.attach('sim', 'sim'); assert.match(await gate.check(true), /sim worker intact/);
    assert(f.sent.some((s) => s.session === 'sim' && s.params?.expression?.includes('installProtector')));
  } finally { await gate.dispose(); }
  const bad = protectorPage(), badGate = await watchProtectors(bad.page);
  try {
    bad.attach('sim', 'sim', { intact: false, error: 'did not optimize' });
    await assert.rejects(badGate.check(true), /worker protector could not initialize/);
    assert(bad.sent.some((s) => s.method === 'Runtime.runIfWaitingForDebugger'));
  } finally { await badGate.dispose(); }
});

test('protector gate: reload cannot erase an earlier isolate invalidation', async () => {
  const f = protectorPage(), gate = await watchProtectors(f.page);
  try {
    await gate.beforeReload(false);
    f.setMain({ intact: false, turbofan: false, status: 129 });
    await gate.beforeReload(false);
    f.setMain({ intact: true, turbofan: true, status: 41 });
    await assert.rejects(gate.check(false), /before reload: main protector unavailable\/invalidated/);
  } finally { await gate.dispose(); }
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
