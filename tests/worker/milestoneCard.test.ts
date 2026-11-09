import { afterEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { GameContext, UIEvents } from '../../src/game/context';
import * as rewards from '../../src/sim/economy/rewards';
import { MilestoneCard } from '../../src/ui/MilestoneCard';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { REPLICA_SAFE } from '../../src/worker/replicaSafe';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom } from '../game/fakeDom';

installFakeDom();
afterEach(() => vi.restoreAllMocks());

describe('milestone card on the packet host', () => {
  it('reads its next rank through listMilestones from the delivered population after a multi-threshold packet', async () => {
    const read = vi.spyOn(rewards, 'listMilestones'), abort = new AbortController();
    const batches = [
      { population: 300001, milestones: [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000] },
      { population: 800001, milestones: [500000, 750000] },
    ];
    let batch = 0;
    const state = newState(16);
    state.config.name = 'Queensbury';
    const host = new LoopbackSimHost(state, { initialSpeed: 0, loopback: { cadence: 'design', modules: {
      createSystems: () => [{ name: 'milestone fixture', daily(sim) {
        const next = batches[batch++];
        sim.state.stats.population = next.population;
        for (const pop of next.milestones) sim.notify(`Queensbury reaches ${pop.toLocaleString('en-US')} residents!`, 'good');
      } }],
    } } });
    await host.start();
    const ui = new Emitter<UIEvents>(), root = new FEl('div');
    const ctx = { host, get state() { return host.state; }, ui, settings: { motion: 'full' }, signal: abort.signal } as unknown as GameContext;
    const card = new MilestoneCard(ctx, root as unknown as HTMLElement);
    try {
      expect(REPLICA_SAFE).toContain('listMilestones');
      host.harness.runDays(1); await host.drain();
      expect(root.querySelector('.milestone-title')!.textContent).toContain('250,000 RESIDENTS');
      expect(root.querySelector('.milestone-next')!.textContent).toBe('Next: Global City at 500,000 residents');
      expect(read).toHaveBeenCalledTimes(batches[0].milestones.length);
      for (const [projection] of read.mock.calls) {
        expect(projection.stats.population).toBe(300001);
        expect(projection.unlocked).toBe(host.state.unlocked);
        expect(projection.milestones).toBe(host.state.milestones);
      }
      const before = structuredClone({ stats: host.state.stats, milestones: host.state.milestones, unlocked: host.state.unlocked });
      expect(rewards.listMilestones(host.state)).toEqual(rewards.listMilestones(host.harness.primary));
      expect({ stats: host.state.stats, milestones: host.state.milestones, unlocked: host.state.unlocked }).toEqual(before);
      read.mockClear();
      host.harness.runDays(1); await host.drain();
      expect(root.querySelector('.milestone-next')!.textContent).toBe('Next: Megacity at 1,000,000 residents');
      expect(read).toHaveBeenCalledTimes(batches[1].milestones.length);
      expect(read.mock.calls.every(([projection]) => projection.stats.population === 800001)).toBe(true);
      expect(host.state.stats.population).toBe(host.harness.primary.stats.population);
      expect(host.state).not.toBe(host.harness.primary);
    } finally { card.dispose(); abort.abort(); await host.dispose(); }
  });
});
