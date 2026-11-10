/** NOTE-048: the year review's milestone read is pure on the packet host's mirrored inputs. */
import { describe, expect, it } from 'vitest';
import { DevType } from '../../src/core/types';
import { listMilestones } from '../../src/sim/economy/rewards';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import type { Packet } from '../../src/worker/protocol';
import { exactDigest } from '../../src/worker/queries';
import { REPLICA_SAFE } from '../../src/worker/replicaSafe';
import { newState } from '../infra/cityGen';

describe('year review milestones on a packet host', () => {
  it('matches after Ready and a changed packet, without changing either city or the RNG', async () => {
    const st = newState(16), packets: Packet[] = [];
    st.stats.population = 7400;
    st.stats.eq = 60; st.stats.hq = 70;
    st.stats.residents = [3000, 3000, 1400];
    const host = new LoopbackSimHost(st, { initialSpeed: 0, loopback: { modules: {} }, onPacket: (p) => packets.push(p) });
    await host.start();
    try {
      expect(REPLICA_SAFE).toContain('listMilestones');
      const compare = () => {
        const primary = host.harness.primary, before = exactDigest(host.state), liveBefore = exactDigest(primary);
        const rng = host.harness.core.sim.rng.state, expected = listMilestones(primary);
        expect(listMilestones(host.state)).toEqual(expected);
        expect(listMilestones(host.state)).toEqual(expected);
        expect(exactDigest(host.state)).toBe(before); expect(exactDigest(primary)).toBe(liveBefore);
        expect(host.harness.core.sim.rng.state).toBe(rng);
        return expected;
      };
      expect(compare().currentRank.id).toBe('town');

      // Authoritative fixture writes must travel in a packet; the replica is never edited by this test.
      st.stats.population = 60000; st.stats.eq = 85; st.stats.hq = 100;
      st.stats.residents = [30000, 25000, 5000];
      st.stats.jobsByDev[DevType.CO3] = 16000; st.stats.jobsByDev[DevType.IHT] = 7000;
      st.milestones.civ_police_station = 1; st.milestones.tr_airport_small = 1;
      st.unlocked.add('water_treatment'); st.unlocked.add('museum'); st.unlocked.add('country_club');
      expect(listMilestones(host.state).currentRank.id).toBe('town');
      host.harness.flush(true);
      await host.drain();
      expect(packets.some((p) => p.plain?.stats && p.plain.milestones && p.plain.unlocked)).toBe(true);
      const result = compare();
      expect(result.currentRank.id).toBe('large_city');
      expect(result.nextRank?.id).toBe('metropolis');
      expect(result.nextUnlocks.map((r) => r.id)).not.toContain('museum');
    } finally { await host.dispose(); }
  });
});
