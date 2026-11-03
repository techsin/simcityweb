/** LG-06: the approved synchronous cost readers use only the plain data delivered by a packet host. */
import { describe, expect, it } from 'vitest';
import { emergencyRebuildCosts } from '../../src/sim/economy/budget';
import { emergencyMigrationImpact } from '../../src/sim/economy/tourism';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { exactDigest } from '../../src/worker/queries';
import { REPLICA_SAFE } from '../../src/worker/replicaSafe';
import { newState } from '../infra/cityGen';

describe('neglect: replica-safe emergency costs', () => {
  it('matches both reads after Ready and subsequent packets, without mutating state or exposing live arrays', async () => {
    const st = newState(16);
    st.stats.emergency.year.rebuildCost = 5_000;
    st.stats.emergency.year.unansweredRebuildCost = 3_000;
    st.systemData.economy = { migration: [0.98, 1.02, 0.95], rawTarget: [2_000, 3_000, 1_000], safetyMigrationLoss: [0.01, 0.03, 0.02] };
    const host = new LoopbackSimHost(st, { initialSpeed: 0, loopback: { modules: {} } });
    try {
      await host.start();
      expect(REPLICA_SAFE).toContain('emergencyRebuildCosts');
      expect(REPLICA_SAFE).toContain('emergencyMigrationImpact');
      expect(host.state).not.toBe(host.harness.primary);
      const compare = () => {
        const before = exactDigest(host.state), liveBefore = exactDigest(host.harness.primary), rng = host.harness.core.sim.rng.state;
        expect(emergencyRebuildCosts(host.state)).toEqual(emergencyRebuildCosts(host.harness.primary));
        const impact = emergencyMigrationImpact(host.state);
        expect(impact).toEqual(emergencyMigrationImpact(host.harness.primary));
        expect(structuredClone(impact)).toEqual(impact);
        impact.multiplierLoss.fill(100);
        expect(emergencyMigrationImpact(host.state).multiplierLoss).not.toEqual(impact.multiplierLoss);
        expect(exactDigest(host.state)).toBe(before);
        expect(exactDigest(host.harness.primary)).toBe(liveBefore);
        expect(host.harness.core.sim.rng.state).toBe(rng);
      };
      compare();
      host.harness.primary.stats.emergency.year.unansweredRebuildCost = 8_400;
      host.harness.primary.systemData.economy = { migration: [0.9, 0.92, 0.94], rawTarget: [4_000, 3_000, 2_000], safetyMigrationLoss: [0.05, 0.04, 0.03] };
      expect(emergencyRebuildCosts(host.state).unansweredYear).toBe(3_000);
      host.harness.flush(true);
      await host.drain();
      expect(emergencyRebuildCosts(host.state).unansweredYear).toBe(8_400);
      compare();
    } finally { await host.dispose(); }
  });

  it('keeps old packet-host saves without the optional safety and rebuilding fields neutral', async () => {
    const st = newState(16);
    delete st.systemData.economy;
    delete st.stats.emergency.year.rebuildCost;
    delete st.stats.emergency.year.unansweredRebuildCost;
    const host = new LoopbackSimHost(st, { initialSpeed: 0, loopback: { modules: {} } });
    try {
      await host.start();
      const before = exactDigest(host.state);
      expect(emergencyRebuildCosts(host.state)).toEqual({ month: 0, lastMonth: 0, year: 0, unansweredYear: 0 });
      expect(emergencyMigrationImpact(host.state)).toEqual({ multiplierLoss: [0, 0, 0], targetResidents: 0, multiplier: 1 });
      expect(host.state.systemData.economy).toBeUndefined();
      expect(exactDigest(host.state)).toBe(before);
    } finally { await host.dispose(); }
  });
});
