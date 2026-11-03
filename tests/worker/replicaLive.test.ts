/** R16: the W0.1 frame path, with jitter and frame-driven disasters; no command lane is installed. */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { triggerDisaster, type DisastersSystem } from '../../src/sim/infra/disasters';
import type { EmergencySystem } from '../../src/sim/infra/emergency';
import { LoopbackCore } from '../../src/worker/loopbackCore';
import { EntryType, assertOwnedBuffers } from '../../src/worker/protocol';
import { FirstFailure, ReplicaCheck } from '../../tools/bench/worker/checkReplica';
import { grownFixture, loadFixture } from '../../tools/bench/worker/fixtures';
import { stressCity } from '../infra/cityGen';

describe.each([
  ['generated 128²', () => stressCity(128).st, true],
  ['grown fixture', () => loadFixture(grownFixture()), existsSync(grownFixture())],
] as const)('replica live cadence: %s', (label, create, present) => {
  it.skipIf(!present).each([3, 1])(`${label}, speed %s: 120 days of 8–33 ms ticks, active tornado and fires, every packet exact`, { timeout: 300000 }, (speed) => {
    const failure = new FirstFailure();
    let packets = 0, frameDisasters = 0, emergencyEvents = 0;
    const loop = new LoopbackCore(create(), {
      cadence: 'live', initialSpeed: speed,
      errors: { report: (title, error) => failure.record(title, error) },
      recorder: { dev: true, onAuditError: (id, field) => failure.record(`audit ${id}.${field}`, 'silent exact-field write') },
      replica: { report: (key, error) => failure.record(key, error) },
      onPacket: (p, host) => {
        // This callback is outside the guarded sim/view callbacks: a mismatch stops the frame loop.
        failure.check(p);
        assertOwnedBuffers(p);
        check.packet(p, host.elapsedTimeMs);
        if (!p.log.some((e) => e[0] === EntryType.Day)) frameDisasters += p.log.filter((e) => e[0] === EntryType.Disaster).length;
        emergencyEvents += p.log.filter((e) => e[0] === EntryType.Emergency).length;
        expect(p.log.some((e) => e[0] === EntryType.Ack)).toBe(false);
        packets++;
      },
    });
    const check = new ReplicaCheck(loop.core.sim, loop.replica);
    // W0.4: the LIVE policy now runs in SimCore. This suite checks the replica at a fixed cadence, as the benches do.
    loop.core.livePolicy.setSettings({ emergencyUncovered: 'ignore', emergencyLiveSlowmo: 3, emergencyAlerts: 'major' });
    try {
      const buildings = [...loop.primary.buildings.values()].filter((b) => b.pop > 0 && b.built >= 1);
      const first = buildings[0], second = buildings.find((b) => Math.hypot(b.x - first.x, b.z - first.z) > 30)!;
      expect(triggerDisaster(loop.core.sim, 'fire', first.x, first.z)).toBe(true);
      expect(triggerDisaster(loop.core.sim, 'fire', second.x, second.z)).toBe(true);
      expect(triggerDisaster(loop.core.sim, 'tornado', 60, 60)).toBe(true);
      expect(loop.core.sim.getSystem<DisastersSystem>('disasters')!.active.some((d) => d.kind === 'tornado')).toBe(true);
      expect(loop.core.sim.getSystem<EmergencySystem>('emergency')!.incidents().filter((i) => i.kind === 'fire').length).toBeGreaterThan(0);
      const end = loop.primary.day + 120;
      let tick = 0;
      while (loop.primary.day < end && tick < 10000) {
        loop.frame((8 + (tick * 17) % 26) / 1000);
        tick++;
      }
      expect(loop.primary.day).toBe(end);
      loop.forceRollingRound(); check.rolling(); check.finish();
      expect(packets).toBeGreaterThanOrEqual(120);
      expect(frameDisasters).toBeGreaterThan(0); expect(emergencyEvents).toBeGreaterThan(0);
    } finally { check.dispose(); loop.dispose(); }
  });
});
