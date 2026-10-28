/** T030: compositor-driven demand bars retain their settled geometry and HUD data. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { GameContext, UIEvents } from '../../src/game/context';
import { TopBar } from '../../src/ui/TopBar';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const st = newState(16), abort = new AbortController();
  st.config.name = 'Test City'; st.config.mayor = 'Pat'; st.config.startYear = 2000; st.config.difficulty = 'medium';
  st.day = 462; st.funds = 100000; st.stats.population = 12345; st.stats.approval = 68;
  st.budget.lastIncome = { taxes: 5000, 'oneoff:loan': 10000 };
  st.budget.lastExpense = { upkeep: 1000, 'oneoff:construction': 2500 };
  st.stats.demand.fill(0); st.stats.demandCap.fill(0);
  const host = new LocalSimHost(st, { signal: abort.signal, initialSpeed: 0 });
  const ui = new Emitter<UIEvents>();
  const ctx = {
    host, state: st, sim: host.sim, signal: abort.signal, ui, mods: {}, world: { timeOfDay: 10.5 },
    sound: vi.fn(), toast: vi.fn(), panels: { toggle: vi.fn() }, openPauseMenu: vi.fn(),
  } as unknown as GameContext;
  const bar = new TopBar(ctx, new FEl('div') as unknown as HTMLElement);
  return { st, host, ctx, bar, el: bar.el as unknown as FEl, dispose: async () => { abort.abort('dispose'); ui.clear(); await host.dispose(); } };
}

describe('TopBar settled values', () => {
  it('keeps date, speed, time, funds, recurring net, population and approval values', async () => {
    const f = fixture();
    try {
      f.bar.update();
      const text = textOf(f.el);
      for (const value of ['Test City', 'Mayor Pat · Medium', 'Apr 13, 2001', '10:30', '§100,000', '+§4,000/mo', '12,345', '68%']) expect(text).toContain(value);
      expect(f.el.querySelector('.is-paused')).toBeTruthy();
      const speed = vi.spyOn(f.host, 'setSpeed');
      f.el.querySelector('.speed')!.children[2].click();
      expect(speed).toHaveBeenCalledExactlyOnceWith(2, 'topbar');
      f.bar.update();
      expect(f.el.querySelector('.is-paused')).toBeNull();
      f.st.funds = 95000; f.st.stats.population = 14000; f.st.stats.approval = 45;
      f.bar.update();
      for (const value of ['§95,000', '14,000', '45%']) expect(textOf(f.el)).toContain(value);
      await f.dispose();
      f.el.querySelector('.speed')!.children[1].click();
      expect(speed).toHaveBeenCalledTimes(1);
    } finally { await f.dispose(); }
  });

  it.each([-1.7, -1, -0.5, -0.01, 0, 0.01, 0.25, 1, 1.7])('preserves the settled fill bounds and opacity for demand %s, including the popover', async (v) => {
    const f = fixture();
    try {
      f.st.stats.demand.fill(v);
      f.bar.update();
      f.el.querySelector('.rci-seg')!.click();
      const bars = f.el.querySelectorAll('.rci-bar');
      expect(bars).toHaveLength(15);
      for (let i = 0; i < bars.length; i++) {
        const fill = bars[i].firstElementChild!;
        const scale = Number(String(fill.style.transform).match(/scaleY\(([^)]+)\)/)![1]);
        const H = i < 3 ? 28 : 84, a = Math.min(1, Math.abs(v));
        // A fixed half-height fill with top origin must occupy the same bounds as the old top/height painter.
        expect(H / 2 + Math.min(0, scale) * H / 2).toBeCloseTo(v >= 0 ? H * (0.5 - a * 0.5) : H * 0.5, 10);
        expect(Math.abs(scale) * H / 2).toBeCloseTo(a * H / 2, 10);
        expect(fill.style.opacity).toBe(v >= 0 ? '1' : '0.45');
        expect(fill.style.background).toBeTruthy();
        expect(fill.style.top).toBeUndefined();
        expect(fill.style.height).toBeUndefined();
      }
    } finally { await f.dispose(); }
  });

  it('leaves unchanged demand fills and net classes alone on repeated HUD ticks', async () => {
    const f = fixture();
    try {
      f.st.stats.demand.fill(0.5); f.bar.update();
      const fill = f.el.querySelector('.rci-bar')!.firstElementChild!;
      const transform = fill.style.transform, setTransform = vi.fn();
      Object.defineProperty(fill.style, 'transform', { get: () => transform, set: setTransform });
      const net = f.el.querySelectorAll('.hud-sub').find((el) => textOf(el).includes('/mo'))!;
      const cls = net.className, setClass = vi.fn();
      Object.defineProperty(net, 'className', { get: () => cls, set: setClass });
      for (let i = 0; i < 10; i++) f.bar.update();
      expect(setTransform).not.toHaveBeenCalled();
      expect(setClass).not.toHaveBeenCalled();
      f.st.stats.demand.fill(-0.5); f.bar.update();
      expect(setTransform).toHaveBeenCalledExactlyOnceWith('scaleY(0.5)');
    } finally { await f.dispose(); }
  });
});
