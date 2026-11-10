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
  state.stats.approval = 40.125;
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
  return { state, sim, row, update };
}

describe('FH-26 recovery alternative in the Rewards panel', () => {
  it('shows both six-month approval routes and the recorded lowest approval', () => {
    const { row } = make();
    const text = textOf(row());
    expect(text).toContain('Statue of the Mayor');
    expect(text).toContain('Population 2,500 / 2,500');
    expect(text).toContain('Months at approval \u226555% 0 / 6');
    expect(text).toMatch(/or/i);
    expect(text).toContain('+0.0');
    expect(text).toContain('40.1');
    expect(text).toMatch(/Recovery months 0 \/ 6/i);
    expect(text).toContain('Locked');
    expect(row().querySelector('.fill')!.style.width).toBe('0%');
  });

  it('shows a half-complete recovery goal below 55% approval', () => {
    const { state, sim, row, update } = make();
    sim.runDays(30);
    state.stats.approval = 50.125;
    sim.runDays(90);
    update();
    const text = textOf(row());
    expect(text).toContain('Months at approval \u226555% 0 / 6');
    expect(text).toContain('+10.0');
    expect(text).toMatch(/Recovery months 3 \/ 6/i);
    expect(row().querySelector('.fill')!.style.width).toBe('50%');
  });

  it('updates a decimal recovery readout while the rounded progress bar is unchanged', () => {
    const { state, sim, row, update } = make();
    sim.runDays(30);
    state.stats.approval = 50.125;
    sim.runDays(90);
    update();
    state.stats.approval = 50.425;
    update();
    expect(textOf(row())).toContain('+10.3');
    expect(textOf(row())).toMatch(/Recovery months 3 \/ 6/i);
    expect(row().querySelector('.fill')!.style.width).toBe('50%');
  });

  it('replaces the recovery goal with Unlocked after its sixth full month', () => {
    const { state, sim, row, update } = make();
    sim.runDays(30);
    state.stats.approval = 50.125;
    sim.runDays(180);
    update();
    expect(textOf(row())).toContain('Unlocked');
    expect(textOf(row())).not.toMatch(/Recovery months/i);
    expect(row().querySelector('.reward-prog')).toBeNull();
  });
});
