import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { normalizeReward } from '../../src/game/modules';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { RewardsPanel } from '../../src/ui/panels/ListPanels';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const proto = FEl.prototype as unknown as Record<string, unknown>;
const scroll = vi.fn();
const aborts: AbortController[] = [];
beforeAll(() => { proto.scrollIntoView = scroll; });
afterAll(() => { delete proto.scrollIntoView; });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  scroll.mockClear();
});
afterEach(() => {
  for (const abort of aborts.splice(0)) abort.abort();
  vi.useRealTimers();
});

function make(earned = false) {
  const abort = new AbortController();
  aborts.push(abort);
  const state = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', disasters: false, treeDensity: 0, waterAmount: 0 }));
  const ordinary = { id: 'honour_word_in_ordinary_reward', name: 'Clock Tower', kind: 'landmark', unlocked: true, progress: 1, defIds: [] };
  const honour = {
    id: 'honour_clean_air_metropolis', name: 'Clean Air Metropolis', kind: 'honour', description: 'Keep the air clean for twelve months.',
    unlocked: earned, progress: earned ? 1 : 0.57, progressText: 'Air at homes 0.14; needs 0.10',
    defIds: ['rw_honour_clean_air_metropolis_plaque', 'rw_eco_plaza'],
  };
  const off = vi.fn(), select = vi.fn((_id: string) => true), close = vi.fn();
  const on = vi.fn(() => off);
  const ctx = {
    state, signal: abort.signal, host: { events: { on }, commandCount: 0 },
    mods: { listRewards: () => [ordinary, honour].map(normalizeReward) },
    tools: { select }, panels: { close },
    get sim() { throw new Error('RewardsPanel must read the mirrored state'); },
  } as unknown as GameContext;
  const panel = new RewardsPanel(ctx);
  panel.mount(() => undefined, () => undefined, () => undefined);
  panel.onOpen();
  panel.update();
  const body = panel.body as unknown as FEl;
  const tabs = body.querySelector('.ui-seg')!.children;
  const rows = () => body.querySelectorAll('.li');
  return { abort, state, ordinary, honour, panel, body, tabs, rows, off, on, select, close };
}

describe('Rewards panel honours tab', () => {
  it('filters by normalized category and switches both tabs without waiting for the rebuild gate', () => {
    const t = make();
    expect(t.tabs.map(textOf)).toEqual(['Rewards', 'Honours']);
    expect(t.rows().map((row) => row.dataset.reward)).toEqual([t.ordinary.id]);
    t.tabs[1].click();
    expect(t.rows().map((row) => row.dataset.reward)).toEqual([t.honour.id]);
    expect(t.tabs.map((tab) => tab.classList.contains('on'))).toEqual([false, true]);
    t.tabs[0].click();
    expect(t.rows().map((row) => row.dataset.reward)).toEqual([t.ordinary.id]);
    expect(t.tabs.map((tab) => tab.classList.contains('on'))).toEqual([true, false]);
  });

  it('shows locked numeric progress and updates the current blocker even within the same progress percent', () => {
    const t = make();
    t.tabs[1].click();
    expect(textOf(t.rows()[0])).toContain('Locked');
    expect(textOf(t.rows()[0])).toContain('Air at homes 0.14; needs 0.10');
    expect(t.rows()[0].querySelector('.fill')!.style.width).toBe('57%');
    expect(t.rows()[0].querySelectorAll('button')).toHaveLength(0);
    t.honour.progressText = 'Air at homes 0.13; needs 0.10';
    vi.advanceTimersByTime(1000);
    t.panel.update();
    expect(textOf(t.rows()[0])).toContain('Air at homes 0.13; needs 0.10');
    expect(textOf(t.rows()[0])).not.toContain('Air at homes 0.14');
  });

  it('shows the earned plaque and selects each optional decoration through its Place button', () => {
    const t = make(true);
    t.tabs[1].click();
    const row = t.rows()[0];
    expect(textOf(row)).toContain('Earned');
    expect(textOf(row)).toContain('Commemorative plaque awarded');
    expect(row.querySelector('.reward-prog')).toBeNull();
    const buttons = row.querySelectorAll('button');
    expect(buttons.map((button) => button.title)).toEqual(['Place Clean Air Metropolis Plaque', 'Place Eco Plaza']);
    for (const button of buttons) button.click();
    expect(t.select.mock.calls.map(([id]) => id)).toEqual(['plop:rw_honour_clean_air_metropolis_plaque', 'plop:rw_eco_plaza']);
    expect(t.close.mock.calls).toEqual([['rewards'], ['rewards']]);
    t.state.milestones.rw_honour_clean_air_metropolis_plaque = 1;
    t.panel.onOpen();
    t.panel.update();
    expect(t.rows()[0].querySelectorAll('button').map((button) => button.title)).toEqual(['Place Eco Plaza']);
  });

  it('opens a referenced honour or reward in the correct tab, highlights just that row, and scrolls to it', () => {
    const t = make();
    for (const [id, active] of [[t.honour.id, 1], [t.ordinary.id, 0]] as const) {
      t.panel.showReward(id);
      const selected = t.rows().find((row) => row.dataset.reward === id)!;
      expect(t.tabs.map((tab) => tab.classList.contains('on'))).toEqual(active === 1 ? [false, true] : [true, false]);
      expect(t.rows().filter((row) => row.classList.contains('reward-highlight'))).toEqual([selected]);
      expect(scroll.mock.contexts.at(-1)).toBe(selected);
      expect(scroll).toHaveBeenLastCalledWith({ block: 'center', inline: 'nearest' });
    }
    t.panel.onClose();
    expect(t.rows().some((row) => row.classList.contains('reward-highlight'))).toBe(false);
  });

  it('removes tab, placement, shell and host listeners when the city signal aborts', () => {
    const t = make(true);
    t.tabs[1].click();
    const place = t.rows()[0].querySelectorAll('button')[0];
    const elements = [t.panel.el as unknown as FEl, ...(t.panel.el as unknown as FEl).all()];
    expect(elements.reduce((count, element) => count + element.listenerCount(), 0)).toBeGreaterThan(0);
    expect(t.on).toHaveBeenCalledWith('buildingChanged', expect.any(Function));
    t.abort.abort();
    expect(elements.every((element) => element.listenerCount() === 0)).toBe(true);
    expect(t.off).toHaveBeenCalledTimes(1);
    t.tabs[0].click();
    place.click();
    expect(t.rows().map((row) => row.dataset.reward)).toEqual([t.honour.id]);
    expect(t.select).not.toHaveBeenCalled();
    expect(t.close).not.toHaveBeenCalled();
  });
});
