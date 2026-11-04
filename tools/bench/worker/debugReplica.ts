/** Standalone NOTE-020 preflight; run with node tools/bench/worker/runChecks.mjs. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { getHeapStatistics } from 'node:v8';
import { Network } from '../../../src/core/types';
import { LoopbackCore } from '../../../src/worker/loopbackCore';
import { EntryType, assertOwnedBuffers } from '../../../src/worker/protocol';
import { triggerDisaster } from '../../../src/sim/infra/disasters';
import { newState, stressCity } from '../../../tests/infra/cityGen';
import { FirstFailure, ReplicaCheck } from './checkReplica';
import { grownFixture, loadFixture } from './fixtures';

console.log(`Node ${process.version}; heap limit ${Math.round(getHeapStatistics().heap_size_limit / 1024 / 1024)} MiB; no heap override in this runner.`);

// Exercise the oracle itself as well as the long runs. All node assertions below contain scalars only.
{
  const st = newState(16); st.network[1] = Network.Road;
  const loop = new LoopbackCore(st, {
    cadence: 'live', initialSpeed: 0, modules: {},
    onPacket: (p, host) => check.packet(p, host.elapsedTimeMs),
  });
  const check = new ReplicaCheck(loop.core.sim, loop.replica, () => loop.recorder.cause);
  const emit = (group: 'traffic' | 'utilities', cause: number) => {
    loop.recorder.cause = cause; loop.core.sim.events.emit('layerUpdated', group); loop.recorder.cause = undefined;
  };
  try {
    st.traffic[1] = 10; st.congestion[1] = 0.1; emit('traffic', 7);
    st.traffic[1] = 11; st.congestion[1] = 0.125; loop.flush(true);
    assert.equal(loop.state.traffic[1], 11); assert.equal(loop.state.congestion[1], 0.125);
    st.day = 1; st.traffic[1] = 20; emit('traffic', 8);
    loop.core.sim.events.emit('speedChanged', 0);
    st.powered[1] = 1; st.watered[1] = 1; emit('utilities', 9);
    st.powered[2] = 1; st.watered.fill(1); st.traffic[1] = 21; loop.frame(0.1);
    assert.equal(loop.state.traffic[1], 11); assert.equal(loop.state.powered[2], 1); assert.equal(loop.state.watered[3], 1);
    st.day = 2; loop.core.sim.events.emit('speedChanged', 0);
    st.traffic[1] = 30; emit('traffic', 10);
    st.powered[1] = 0; st.watered[1] = 0; emit('utilities', 11);
    st.traffic[1] = 31; st.congestion[1] = 0.5; st.powered[3] = 1; st.watered[2] = 0;
    loop.frame(0.149);
    assert.equal(loop.state.traffic[1], 11); assert.equal(loop.state.powered[1], 1);
    loop.frame(0.001);
    assert.equal(loop.state.traffic[1], 31); assert.equal(loop.state.congestion[1], 0.5); assert.equal(loop.state.powered[1], 1);
    loop.frame(0.099); loop.flush(true); assert.equal(loop.state.powered[3], 0);
    loop.frame(0.001);
    assert.equal(loop.state.powered[1], 0); assert.equal(loop.state.powered[3], 1); assert.equal(loop.state.watered[2], 0);
    check.finish();
  } finally { check.dispose(); loop.dispose(); }
}
for (const name of ['powered', 'watered', 'traffic', 'congestion'] as const) {
  let packets = 0, frames = 0;
  const loop = new LoopbackCore(newState(128), {
    cadence: 'live', initialSpeed: 0, modules: {},
    onPacket: (p, host) => { packets++; host.replica.state[name].fill(1); check.packet(p, host.elapsedTimeMs); },
  });
  const check = new ReplicaCheck(loop.core.sim, loop.replica);
  try {
    assert.throws(() => { for (; frames < 100; ) { frames++; loop.frame(0.25); } }, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(`packet 1: ${name}; first differing index=0; primary(last sent)=0; replica=1; differing cells=16384; log=[]`));
      assert.ok(error.message.length < 500); assert.equal(Object.hasOwn(error, 'actual'), false);
      return true;
    });
    assert.equal(frames, 1); assert.equal(packets, 1);
  } finally { check.dispose(); loop.dispose(); }
}
for (const corruption of ['reorder', 'drop', 'duplicate', 'day', 'cause']) {
  const loop = new LoopbackCore(newState(16), { modules: {} });
  const check = new ReplicaCheck(loop.core.sim, loop.replica);
  try {
    loop.core.sim.events.emit('speedChanged', 0);
    loop.core.sim.events.emit('layerUpdated', 'services');
    loop.core.sim.events.emit('layerUpdated', 'traffic');
    const p = loop.recorder.flush({ force: true })!;
    if (corruption === 'reorder') [p.log[0], p.log[1]] = [p.log[1], p.log[0]];
    if (corruption === 'drop') p.log.pop();
    if (corruption === 'duplicate') p.log.push([...p.log[2]]);
    if (corruption === 'day') p.log[2][1]++;
    if (corruption === 'cause') p.log[2][3] = 7;
    assert.equal(loop.replica.apply(structuredClone(p)), true);
    assert.throws(() => check.packet(p, loop.elapsedTimeMs), /packet 1: event log order\/day\/cause/);
  } finally { check.dispose(); loop.dispose(); }
}
console.log('PASS focused checks: flush-time copies, independent group throttles, duplicate deferred emits, four silent-write/first-failure controls, five event-corruption controls.');

const fixtures = [
  { label: 'generated 128²', create: () => stressCity(128).st },
  ...(existsSync(grownFixture()) ? [{ label: 'grown fixture', create: () => loadFixture(grownFixture()) }] : []),
];
if (!existsSync(grownFixture())) console.log(`SKIP grown fixture: ${grownFixture()}`);

for (const { label, create } of fixtures) for (const speed of [undefined, 3, 1]) {
  const name = `${label}, ${speed === undefined ? 'design' : `live ${speed}x`}, 120 days`;
  console.log(`RUN ${name}`);
  const started = performance.now(), failure = new FirstFailure();
  let packets = 0, frameDisasters = 0, emergencyEvents = 0;
  const loop = new LoopbackCore(create(), {
    cadence: speed === undefined ? 'design' : 'live', initialSpeed: speed,
    recorder: { dev: true, onAuditError: (id, field) => failure.record(`audit ${id}.${field}`, 'silent exact-field write') },
    errors: { report: (title, error) => failure.record(title, error) },
    replica: { report: (key, error) => failure.record(key, error) },
    onPacket: (p, host) => {
      failure.check(p); assertOwnedBuffers(p); check.packet(p, host.elapsedTimeMs);
      if (!p.log.some((e) => e[0] === EntryType.Day)) frameDisasters += p.log.filter((e) => e[0] === EntryType.Disaster).length;
      emergencyEvents += p.log.filter((e) => e[0] === EntryType.Emergency).length;
      assert.equal(p.log.some((e) => e[0] === EntryType.Ack), false);
      packets++;
    },
  });
  const check = new ReplicaCheck(loop.core.sim, loop.replica);
  try {
    if (speed === undefined) {
      for (let day = 1; day <= 120; day++) {
        loop.runDays(1);
        if (day % 30 === 0) { loop.forceRollingRound(); check.rolling(); }
      }
    } else {
      const buildings = [...loop.primary.buildings.values()].filter((b) => b.pop > 0 && b.built >= 1);
      const first = buildings[0], second = buildings.find((b) => Math.hypot(b.x - first.x, b.z - first.z) > 30)!;
      assert.equal(triggerDisaster(loop.core.sim, 'fire', first.x, first.z), true);
      assert.equal(triggerDisaster(loop.core.sim, 'fire', second.x, second.z), true);
      assert.equal(triggerDisaster(loop.core.sim, 'tornado', 60, 60), true);
      const end = loop.primary.day + 120;
      let tick = 0;
      while (loop.primary.day < end && tick < 10000) { loop.frame((8 + (tick * 17) % 26) / 1000); tick++; }
      assert.equal(loop.primary.day, end);
      loop.forceRollingRound(); check.rolling();
      assert.ok(frameDisasters > 0); assert.ok(emergencyEvents > 0);
    }
    check.finish(); assert.ok(packets >= 120);
    console.log(`PASS ${name}: ${packets} packets, ${frameDisasters} frame disaster events, ${emergencyEvents} emergency events, ${((performance.now() - started) / 1000).toFixed(2)} s`);
  } finally { check.dispose(); loop.dispose(); }
}
