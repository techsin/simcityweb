/** Budget and ordinance controls consume acknowledgements, and late replies cannot revive an exited city. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import type { ActionResult } from '../../src/sim/actions';
import { Simulation } from '../../src/sim/Simulation';
import { BudgetPanel } from '../../src/ui/panels/BudgetPanel';
import { OrdinancesPanel } from '../../src/ui/panels/ListPanels';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
afterEach(() => vi.restoreAllMocks());
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function fixture() {
  const state = newState(32), abort = new AbortController();
  const sound = vi.fn(), toast = vi.fn();
  const calls: { op: string; args: unknown[]; resolve(r: ActionResult): void; reject(e: Error): void }[] = [];
  const ctx = {
    state, sim: new Simulation(state, []), signal: abort.signal, sound, toast,
    mods: { listOrdinances: () => [{ id: 'smoke_detectors', name: 'Smoke detectors', enabled: false, available: true, monthlyCost: 25, effects: [] }] },
    host: {
      act: (op: string, args: unknown[]) => {
        const done = new Promise<ActionResult>((resolve, reject) => { calls.push({ op, args, resolve, reject }); });
        return { seq: calls.length, exact: false, predicted: { ok: true, cost: 0 }, done };
      },
    },
  } as unknown as GameContext;
  return { ctx, state, abort, sound, toast, calls };
}
const button = (root: FEl, text: RegExp) => root.all().find((e) => e.tagName === 'button' && text.test(textOf(e)))!;

describe('panel commands', () => {
  it('repayment carries the rendered loan guard and reports a refusal only after its acknowledgement', async () => {
    const f = fixture();
    f.state.budget.loans.push({ principal: 10000, remaining: 8000, monthsLeft: 80, rate: 0.05, monthlyPayment: 100 });
    const panel = new BudgetPanel(f.ctx);
    panel.mount(() => {}, () => {}, () => {});
    const el = panel.el as unknown as FEl;
    button(el, /^Loans$/).click();
    const repay = button(el, /^Repay/);
    f.state.budget.loans[0].monthsLeft--; // the rendered row is now stale
    repay.click();
    expect(f.calls[0]).toMatchObject({ op: 'repayLoan', args: [0, { principal: 10000, monthsLeft: 80 }] });
    expect(repay.disabled).toBe(true);
    expect(f.sound).not.toHaveBeenCalled();
    expect(f.toast).not.toHaveBeenCalled();
    f.calls[0].resolve({ ok: false, cost: 0, reason: 'Loan changed — refresh and try again' });
    await flush();
    expect(f.toast).toHaveBeenCalledExactlyOnceWith('Loan changed — refresh and try again', 'error');
    expect(f.sound).not.toHaveBeenCalled();
    expect(button(el, /^Repay/)).not.toBe(repay);
    f.abort.abort('dispose');
  });

  it('taking a loan waits for success; disposed controls and late replies stay silent', async () => {
    const f = fixture(), panel = new BudgetPanel(f.ctx);
    panel.mount(() => {}, () => {}, () => {});
    const el = panel.el as unknown as FEl;
    button(el, /^Loans$/).click();
    const loan = () => el.querySelector('.loan-actions')!.children[0];
    loan().click();
    expect(f.calls[0].op).toBe('takeLoan');
    expect(f.sound).not.toHaveBeenCalled();
    f.calls[0].resolve({ ok: true, cost: -10000 });
    await flush();
    expect(f.sound).toHaveBeenCalledExactlyOnceWith('money');
    const retained = loan();
    retained.click();
    f.abort.abort('dispose');
    retained.click();
    expect(f.calls).toHaveLength(2);
    f.calls[1].resolve({ ok: true, cost: -10000 });
    await flush();
    expect(f.sound).toHaveBeenCalledTimes(1);
    expect(retained.listenerCount()).toBe(0);
  });

  it('an ordinance switch stays optimistic through updates, then rolls back a refused acknowledgement', async () => {
    const f = fixture(), panel = new OrdinancesPanel(f.ctx);
    panel.mount(() => {}, () => {}, () => {});
    panel.update();
    const el = panel.el as unknown as FEl;
    el.querySelector('.ui-switch')!.click();
    panel.update();
    expect(f.calls[0]).toMatchObject({ op: 'setOrdinance', args: ['smoke_detectors', true] });
    expect(el.querySelector('.ui-switch')!.getAttribute('aria-checked')).toBe('true');
    expect(f.sound).not.toHaveBeenCalled();
    f.calls[0].resolve({ ok: false, cost: 0, reason: 'The council refused' });
    await flush();
    expect(el.querySelector('.ui-switch')!.getAttribute('aria-checked')).toBe('false');
    expect(f.toast).toHaveBeenCalledExactlyOnceWith('The council refused', 'error');
    expect(f.sound).toHaveBeenCalledExactlyOnceWith('error');
    el.querySelector('.ui-switch')!.click();
    f.abort.abort('dispose');
    f.calls[1].resolve({ ok: true, cost: 25 });
    await flush();
    expect(f.sound).toHaveBeenCalledTimes(1);
  });

  it('a rejected loan acknowledgement is handled without a success sound', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fixture(), panel = new BudgetPanel(f.ctx);
    panel.mount(() => {}, () => {}, () => {});
    const el = panel.el as unknown as FEl;
    button(el, /^Loans$/).click();
    el.querySelector('.loan-actions')!.children[0].click();
    f.calls[0].reject(new Error('Host unavailable'));
    await flush();
    expect(log).toHaveBeenCalledTimes(1);
    expect(f.toast).toHaveBeenCalledExactlyOnceWith('Action unavailable', 'error');
    expect(f.sound).not.toHaveBeenCalled();
    f.abort.abort('dispose');
  });
});
