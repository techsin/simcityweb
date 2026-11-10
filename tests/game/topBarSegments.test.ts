/**
 * The round-1 TopBar split's contract (POLISH_PLAN §7.3, §7.4): each segment of src/ui/topbar/ builds, ticks and
 * handles its clicks on its own, so its owner lane can change it without the shell; the shell lays them out in the
 * HUD's order and exposes them (later lanes hang coach marks and focus handlers on them); and the RCI segment calls the
 * shell back to refresh the whole bar when its popover opens, as the TopBar did before the split.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { GameContext, UIEvents } from '../../src/game/context';
import { TopBar } from '../../src/ui/TopBar';
import { ApprovalSegment } from '../../src/ui/topbar/approvalSegment';
import { CityDateGroup } from '../../src/ui/topbar/cityDate';
import { FundsSegment } from '../../src/ui/topbar/fundsSegment';
import { PanelButtons } from '../../src/ui/topbar/panelButtons';
import { PopulationSegment } from '../../src/ui/topbar/populationSegment';
import { RciSegment } from '../../src/ui/topbar/rciSegment';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';
import { installTraceDom } from './topBarTrace';

installFakeDom();
let restore = () => {};
beforeAll(() => { restore = installTraceDom(); });
afterAll(() => { restore(); vi.restoreAllMocks(); });

function context() {
  const st = newState(16), abort = new AbortController();
  st.config.name = 'Test City'; st.config.mayor = 'Pat'; st.config.startYear = 2000; st.config.difficulty = 'medium';
  st.day = 462; st.funds = 100000; st.stats.population = 12345; st.stats.approval = 68;
  st.history.pop = [11000, 12000];
  st.budget.lastIncome = { taxes: 5000 }; st.budget.lastExpense = { upkeep: 1000 };
  st.stats.demand.fill(0); st.stats.demandCap.fill(0);
  const sim = { speed: 0 };
  const watch = () => ({ value: undefined, version: 0, error: undefined, setArgs() {}, subscribe: () => () => {}, dispose() {} });
  const ctx = {
    host: { setSpeed: vi.fn(), watch, query: vi.fn(async () => []) }, state: st, sim, signal: abort.signal,
    ui: new Emitter<UIEvents>(), mods: {}, world: { timeOfDay: 10.5 },
    sound: vi.fn(), toast: vi.fn(), openPauseMenu: vi.fn(), openFlyout: vi.fn(), panels: { toggle: vi.fn(), open: vi.fn() },
  } as unknown as GameContext;
  return { st, ctx, abort };
}

const fel = (e: HTMLElement) => e as unknown as FEl;

describe('the TopBar segments (src/ui/topbar/)', () => {
  it('each builds and ticks on its own, without the shell', () => {
    const { ctx, abort } = context();
    const city = new CityDateGroup(ctx), funds = new FundsSegment(ctx), pop = new PopulationSegment(ctx);
    const appr = new ApprovalSegment(ctx), buttons = new PanelButtons(ctx), rci = new RciSegment(ctx, () => {});
    for (const s of [city, funds, pop, appr, buttons, rci]) s.update();
    expect(textOf(fel(city.el))).toContain('Test City');
    expect(textOf(fel(city.el))).toContain('Apr 13, 2001');
    expect(fel(city.el).classList.contains('is-paused')).toBe(true);
    expect(textOf(fel(funds.el))).toBe('§100,000+§4,000/mo');
    expect(textOf(fel(pop.el))).toContain('12,345');
    expect(textOf(fel(appr.el))).toContain('68%');
    expect(fel(rci.el).querySelectorAll('.rci-bar')).toHaveLength(15);
    buttons.setBadge('advisors', 3);
    expect(textOf(fel(buttons.el).querySelector('.badge')!)).toBe('3');
    fel(funds.el).click();
    fel(pop.el).click();
    expect(ctx.panels.toggle).toHaveBeenNthCalledWith(1, 'budget');
    expect(ctx.panels.toggle).toHaveBeenNthCalledWith(2, 'stats');
    abort.abort();
  });

  it('the shell lays them out in the HUD\'s order and exposes them', () => {
    const { ctx, abort } = context();
    const bar = new TopBar(ctx, new FEl('div') as unknown as HTMLElement);
    const el = fel(bar.el);
    expect(el.children.map((c) => c.className)).toEqual(['mp-glass', 'mp-glass', 'spacer', 'mp-glass']);
    expect(el.children[0]).toBe(fel(bar.city.el));
    expect(el.children[1].children).toEqual([bar.funds.el, bar.population.el, bar.rci.el, bar.approval.el]);
    expect(el.children[3]).toBe(fel(bar.buttons.el));
    abort.abort();
  });

  it('the RCI segment refreshes the whole bar once per opening, not on closing', () => {
    const { ctx, abort } = context();
    const refresh = vi.fn();
    const rci = new RciSegment(ctx, refresh);
    const seg = fel(rci.el), inner = seg.querySelector('.rci')!;
    seg.fire('click', { target: inner });
    expect(refresh).toHaveBeenCalledTimes(1);
    seg.fire('click', { target: inner });
    expect(refresh).toHaveBeenCalledTimes(1);
    seg.fire('click', { target: inner });
    expect(rci.closePopover()).toBe(true);
    expect(rci.closePopover()).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(2);
    // through the shell: opening ticks every segment (the date moved since the last tick)
    const bar = new TopBar(ctx, new FEl('div') as unknown as HTMLElement);
    bar.update();
    ctx.state.day += 1;
    fel(bar.rci.el).fire('click', { target: fel(bar.rci.el).querySelector('.rci')! });
    expect(textOf(fel(bar.city.el))).toContain('Apr 14, 2001');
    abort.abort();
  });
});
