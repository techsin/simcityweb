import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { GameContext, UIEvents } from '../../src/game/context';
import { normalizeReward } from '../../src/game/modules';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation } from '../../src/sim/Simulation';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { listRewards, rewardsSystem } from '../../src/sim/economy/rewards';
import { PanelManager } from '../../src/ui/Panel';
import { RewardsPanel } from '../../src/ui/panels/ListPanels';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('window', globalThis);
});
const aborts: AbortController[] = [];
afterEach(() => {
  for (const abort of aborts.splice(0)) abort.abort();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function make() {
  const state = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', disasters: false }));
  state.stats.population = 2500;
  state.stats.approval = 55;
  const sim = new Simulation(state, [rewardsSystem(new EconRuntime())]);
  const root = new FEl('div'), layer = new FEl('div');
  layer.clientWidth = 1600;
  layer.clientHeight = 900;
  root.appendChild(layer);
  const abort = new AbortController();
  aborts.push(abort);
  const ctx = {
    root, state, signal: abort.signal, sim, host: { state, events: sim.events, commandCount: 0 },
    ui: new Emitter<UIEvents>(), sound() {},
    mods: { listRewards: () => listRewards(state).filter((r) => r.id === 'statue').map(normalizeReward) },
  } as unknown as GameContext;
  const panels = new PanelManager(ctx, layer as unknown as HTMLElement);
  ctx.panels = panels;
  const panel = new RewardsPanel(ctx);
  panels.register(panel);
  panels.open('rewards');
  panel.update();
  const row = () => (panel.body as unknown as FEl).querySelectorAll('.li').find((r) => r.dataset.reward === 'statue')!;
  const update = () => {
    vi.advanceTimersByTime(1100);
    panel.update();
  };
  return { state, sim, panel, row, update };
}

describe('FH-26 approval reward row', () => {
  it('shows the 55% condition, population and a six-month goal before unlocking', () => {
    const { row } = make();
    const text = textOf(row());
    expect(text).toContain('Statue of the Mayor');
    expect(text).toContain('Keep 2,500 residents and approval of at least 55% for six months.');
    expect(text).toContain('Population 2,500 / 2,500');
    expect(text).toContain('Approval 55 / 55');
    expect(text).toContain('Months at approval \u226555% 0 / 6');
    expect(text).toContain('Locked');
    expect(row().querySelector('.fill')!.style.width).toBe('0%');
  });

  it('renders three qualifying months as half of the goal', () => {
    const { sim, row, update } = make();
    sim.runDays(90);
    update();
    expect(textOf(row())).toContain('Months at approval \u226555% 3 / 6');
    expect(row().querySelector('.fill')!.style.width).toBe('50%');
  });

  it('updates the holding statistic even when the rounded progress bar stays the same', () => {
    const { state, sim, row, update } = make();
    sim.runDays(90);
    update();
    state.stats.approval = 54;
    update();
    expect(textOf(row())).toContain('Approval 54 / 55');
    expect(row().querySelector('.fill')!.style.width).toBe('50%');
  });

  it('replaces the goal with Unlocked after the sixth full month', () => {
    const { sim, row, update } = make();
    sim.runDays(180);
    update();
    expect(textOf(row())).toContain('Unlocked');
    expect(textOf(row())).not.toContain('Months at approval');
    expect(row().querySelector('.reward-prog')).toBeNull();
  });
});
