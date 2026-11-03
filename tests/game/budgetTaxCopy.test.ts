/** NEW-05: the tax hint follows tuning rather than repeating today's numeric values. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { APPROVAL, TAX_NEUTRAL } from '../../src/sim/economy/tuning';
import { BudgetPanel } from '../../src/ui/panels/BudgetPanel';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

vi.mock('../../src/sim/economy/tuning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/sim/economy/tuning')>();
  return { ...actual, TAX_NEUTRAL: 8.75, APPROVAL: { ...actual.APPROVAL, taxPerPoint: -4.125, taxLowPerPoint: 2.375 } };
});

installFakeDom();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('Budget tax hint tuning (NEW-05)', () => {
  it('describes gradual growth costs with the imported neutral rate and approval slopes', () => {
    const st = newState(32), host = new LocalSimHost(st), abort = new AbortController();
    const ctx = { state: st, sim: host.sim, host, signal: abort.signal, mods: {}, sound: vi.fn(), toast: vi.fn() } as unknown as GameContext;
    const panel = new BudgetPanel(ctx);
    cleanups.push(async () => { panel.onClose(); abort.abort('dispose'); await host.dispose(); });
    panel.mount(() => {}, () => {}, () => {});
    const hints = (panel.el as unknown as FEl).querySelectorAll('.dim').map(textOf).filter((text) => text.includes('% is neutral.'));
    expect(hints).toHaveLength(1);
    const hint = hints[0];
    expect(hint).toContain(`${TAX_NEUTRAL}% is neutral. Higher taxes gradually slow growth.`);
    expect(hint).toContain(`approval (−${-APPROVAL.taxPerPoint} a point)`);
    expect(hint).toContain(`approval (+${APPROVAL.taxLowPerPoint}) but less income`);
    expect(hint.match(/\d+(?:\.\d+)?/g)?.map(Number)).toEqual([TAX_NEUTRAL, -APPROVAL.taxPerPoint, APPROVAL.taxLowPerPoint]);
    expect(hint).not.toMatch(/collapse|\b(?:days|months|years)\b/i);
  });
});
