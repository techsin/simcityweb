/** NEW-05: both slider kinds read the red boundary from tuning. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { TAX_GROWTH_WARNING_RATE } from '../../src/sim/economy/tuning';
import { BudgetPanel } from '../../src/ui/panels/BudgetPanel';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom } from './fakeDom';

vi.mock('../../src/sim/economy/tuning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/sim/economy/tuning')>();
  return { ...actual, TAX_GROWTH_WARNING_RATE: 15.5 };
});

installFakeDom();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('Budget tax color tuning (NEW-05)', () => {
  it('moves the red boundary with tuning and retains the lower warn edge on every slider', () => {
    const st = newState(32), host = new LocalSimHost(st), abort = new AbortController();
    const ctx = { state: st, sim: host.sim, host, signal: abort.signal, mods: {}, sound: vi.fn(), toast: vi.fn() } as unknown as GameContext;
    const panel = new BudgetPanel(ctx);
    cleanups.push(async () => { panel.onClose(); abort.abort('dispose'); await host.dispose(); });
    panel.mount(() => {}, () => {}, () => {});
    const sliders = (panel.el as unknown as FEl).querySelectorAll('.tax-group').flatMap((group) => group.querySelectorAll('input'));
    expect(sliders).toHaveLength(15);
    for (const [rate, warn, bad] of [
      [9.5, false, false], [10, true, false], [14, true, false],
      [TAX_GROWTH_WARNING_RATE, false, true], [TAX_GROWTH_WARNING_RATE + 0.5, false, true],
      [TAX_GROWTH_WARNING_RATE - 0.5, true, false], [9.5, false, false],
    ] as const) {
      st.budget.taxRates.fill(rate);
      panel.update();
      for (const slider of sliders) {
        expect(slider.classList.contains('warn'), `${rate}% warn`).toBe(warn);
        expect(slider.classList.contains('bad'), `${rate}% bad`).toBe(bad);
      }
    }
  });
});
