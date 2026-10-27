/** FH-09: tax effects use the current rates; money still comes from W0.3's host watch. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevType } from '../../src/core/types';
import type { GameContext } from '../../src/game/context';
import { taxFactor } from '../../src/sim/economy/demand';
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

function fixture() {
  let now = 0;
  const st = newState(32), host = new LocalSimHost(st, { now: () => now }), abort = new AbortController();
  st.stats.population = 3000;
  st.stats.residents = [2000, 1000, 0];
  const watch = vi.spyOn(host, 'watch'), act = vi.spyOn(host, 'act');
  const ctx = { state: st, sim: host.sim, host, signal: abort.signal, mods: {}, sound: vi.fn(), toast: vi.fn() } as unknown as GameContext;
  const panel = new BudgetPanel(ctx);
  panel.mount(() => {}, () => {}, () => {});
  const el = panel.el as unknown as FEl;
  cleanups.push(async () => { panel.onClose(); abort.abort('dispose'); await host.dispose(); });
  const groups = el.querySelectorAll('.tax-group');
  const rows = groups.flatMap((g) => g.querySelectorAll('.tax-row').filter((r) => !r.classList.contains('master')));
  const masters = groups.map((g) => g.querySelector('.master')!);
  return { st, host, abort, panel, el, rows, masters, watch, act, time: (t: number) => { now = t; } };
}

function input(row: FEl, rate: number): void {
  const s = row.querySelector('input')!;
  (s as unknown as HTMLInputElement).value = String(rate);
  s.fire('input');
}
const effect = (row: FEl) => textOf(row.querySelector('.tax-effect')!);

describe('Budget tax effects (FH-09)', () => {
  it('All residential at 11% sends host commands and shows the 7-point target cost before the forecast refreshes', () => {
    const f = fixture();
    const income = f.panel.projection().inc;
    input(f.masters[0], 11);
    expect(f.act.mock.calls).toEqual([['setTax', [DevType.R1, 11]], ['setTax', [DevType.R2, 11]], ['setTax', [DevType.R3, 11]]]);
    for (const row of f.rows.slice(0, 3)) expect(effect(row)).toBe('Citywide: approval heads 7 lower (88% reached over 6 months)');
    const copy = textOf(f.el);
    expect(copy).toContain('9% is neutral');
    expect(copy).toContain('−3.5 a point');
    expect(copy).toContain('above 13% demand collapses');
    expect(copy).toContain('(+1.5) but less income');
    expect(copy).not.toContain('above ~12%');
    expect(f.panel.projection().inc).toBe(income); // the 200 ms watch cap still applies
    f.time(200); f.panel.update();
    expect(f.panel.projection().inc).toBeGreaterThan(income);
    expect(f.watch).toHaveBeenCalledExactlyOnceWith('computeMonthlyBudget', {}, 'daily');
  });

  it('mixed rates use residents, ignore empty tiers, and apply the slope after averaging', () => {
    const f = fixture();
    f.st.stats.residents = [2250, 750, 0];
    [7, 11, 17].forEach((rate, d) => { f.st.budget.taxRates[d] = rate; });
    f.panel.update(); // weighted rate 8%, not an average of the three separate approval effects
    for (const row of f.rows.slice(0, 3)) expect(effect(row)).toContain('approval heads 1.5 higher');
    expect(textOf(f.masters[0].querySelector('.tr-v')!)).toBe('Mixed');
    expect(textOf(f.el)).toContain('Residential rows share the citywide tax effect vs 9%, weighted by residents');
    f.st.stats.residents = [0, 3000, 0];
    f.panel.update();
    for (const row of f.rows.slice(0, 3)) expect(effect(row)).toContain('approval heads 7 lower');
  });

  it('shows neutral approval and waits for residents in an empty city', () => {
    const f = fixture();
    expect(effect(f.rows[0])).toBe('Citywide approval: neutral at 9%');
    f.st.stats.population = 0;
    f.st.stats.residents = [0, 0, 0];
    input(f.masters[0], 11);
    for (const row of f.rows.slice(0, 3)) expect(effect(row)).toBe('Approval starts with your first residents');
  });

  it('shows commercial and industrial tax demand factors, including both clamped extremes', () => {
    const f = fixture();
    for (const rate of [0, 11.5, 20]) {
      f.st.budget.taxRates.fill(rate, DevType.CS1);
      f.panel.update();
      for (let d = DevType.CS1; d <= DevType.IHT; d++) {
        expect(effect(f.rows[d])).toBe(`demand ×${Number(taxFactor(d, rate).toFixed(2))}`);
        expect(effect(f.rows[d])).not.toContain('approval');
      }
    }
  });

  it.each([
    [9.5, false, false], [10, true, false], [13, true, false], [13.5, false, true], [14, false, true],
  ] as const)('at %s%%, individual and All sliders have warn=%s and bad=%s', (rate, warn, bad) => {
    const f = fixture();
    for (const master of f.masters) input(master, rate);
    for (const row of [...f.rows, ...f.masters]) {
      const s = row.querySelector('input')!;
      expect(s.classList.contains('warn')).toBe(warn);
      expect(s.classList.contains('bad')).toBe(bad);
    }
  });

  it('keeps half-point values and updates existing rows without rebuilding the controls', () => {
    const f = fixture(), slider = f.rows[0].querySelector('input');
    input(f.masters[0], 9.5);
    expect(effect(f.rows[0])).toContain('approval heads 1.75 lower');
    expect(textOf(f.masters[0].querySelector('.tr-v')!)).toBe('9.5%');
    expect(f.el.querySelectorAll('.tax-group')[0].querySelectorAll('.tax-row')[1].querySelector('input')).toBe(slider);
  });

  it('releases the forecast on close and keeps retained tax controls silent after city disposal', () => {
    const f = fixture(), first = f.watch.mock.results[0].value;
    f.panel.onClose();
    expect(first.value).toBeUndefined();
    f.panel.onOpen();
    expect(f.watch).toHaveBeenCalledTimes(2);
    const retained = (f.panel.el as unknown as FEl).querySelector('.tax-row')!;
    f.abort.abort('dispose');
    input(retained, 12);
    expect(f.act).not.toHaveBeenCalled();
    expect(f.watch.mock.results[1].value.value).toBeUndefined();
    expect(retained.querySelector('input')!.listenerCount()).toBe(0);
  });
});
