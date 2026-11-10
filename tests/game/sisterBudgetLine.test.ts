/**
 * LG-12: the Budget panel names the endowment (economy/budget.ts ENDOWMENT_KEY) "Sister city endowment" among the
 * one-offs: an expense of the city that gave it, an income of the city founded with it, and no part of the monthly net.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { ENDOWMENT_KEY } from '../../src/sim/economy/budget';
import { BudgetPanel } from '../../src/ui/panels/BudgetPanel';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

function ledger(income: Record<string, number>, expense: Record<string, number>): FEl {
  const st = newState(32), host = new LocalSimHost(st), abort = new AbortController();
  st.budget.lastIncome = income;
  st.budget.lastExpense = expense;
  const ctx = { state: st, sim: host.sim, host, signal: abort.signal, mods: {}, sound: vi.fn(), toast: vi.fn() } as unknown as GameContext;
  const panel = new BudgetPanel(ctx);
  panel.mount(() => {}, () => {}, () => {});
  panel.showTab('ledger');
  cleanups.push(async () => { panel.onClose(); abort.abort('dispose'); await host.dispose(); });
  return panel.el as unknown as FEl;
}
const rows = (el: FEl) => el.querySelector('.oneoff-box')!.querySelectorAll('tr').map((r) => r.querySelectorAll('td').map((c) => textOf(c)));

describe('LG-12: the Budget ledger', () => {
  it('lists what the parent gave as "Sister city endowment", apart from the monthly net', () => {
    const el = ledger({ 'tax:R$': 9_000 }, { 'transport:roads': 4_000, [ENDOWMENT_KEY]: 2_000_000 });
    expect(rows(el)).toEqual([['Sister city endowment', '−§2,000,000'], ['One-off total', '−§2,000,000']]);
    expect(textOf(el.querySelector('.ledger-net')!)).toBe('Monthly net (recurring)+§5,000');
  });

  it('and what the new city received under the same name', () => {
    const el = ledger({ [ENDOWMENT_KEY]: 2_000_000 }, { 'oneoff:construction': 1_500 });
    expect(rows(el)).toEqual([['Sister city endowment', '+§2,000,000'], ['Construction', '−§1,500'], ['One-off total', '+§1,998,500']]);
  });
});
