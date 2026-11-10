/**
 * T065 (desktop finding B1, T071 QA): the TopBar's approval hover card rebuilds after each month tick on every host.
 * A replica host (the worker's `?simworker=1` and the loopback host) applies each packet's `sys.economy` with
 * `mergePlain`, which keeps nested object identities, so `economy.approvalTerms` stays the same object from month to
 * month there; the card must not depend on that object being new each month, as it is on the main-thread host.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { DevType } from '../../src/core/types';
import type { GameContext, UIEvents } from '../../src/game/context';
import { DAYS_PER_MONTH } from '../../src/core/constants';
import * as approval from '../../src/sim/economy/approval';
import { ApprovalSegment } from '../../src/ui/topbar/approvalSegment';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { LocalSimHost } from '../../src/worker/SimHost';
import { stressCity } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
afterEach(() => vi.restoreAllMocks());

interface Driven {
  host: LocalSimHost | LoopbackSimHost;
  /** advance whole days on the host's authoritative simulation and deliver them to its state */
  run(days: number): Promise<void>;
}

const HOSTS: [string, () => Promise<Driven>][] = [
  ['the main-thread host', async () => {
    const host = new LocalSimHost(stressCity(32, 7, false).st, { initialSpeed: 0 });
    await host.start();
    return { host, run: async (days) => { host.sim.runDays(days); } };
  }],
  ['the loopback replica host', async () => {
    const host = new LoopbackSimHost(stressCity(32, 7, false).st, { initialSpeed: 0, loopback: { cadence: 'design' } });
    await host.start();
    // (sliders are coalesced until a flush: deliver them before the days run)
    return { host, run: async (days) => { await host.drain(); host.harness.runDays(days); await host.drain(); } };
  }],
];

/** the card's rows as the player reads them: label and signed value */
function cardRows(seg: ApprovalSegment): string[] {
  const pop = (seg.el as unknown as FEl).querySelector('.appr-pop')!;
  return pop.querySelectorAll('.ap-r').map((r) => `${textOf(r.querySelector('.l')!)} ${textOf(r.querySelector('.v')!)}`);
}

/** what the card should show: the sim's breakdown of the last monthly update, formatted as the card formats it */
function expectedRows(st: Parameters<typeof approval.approvalBreakdown>[0]): string[] {
  return approval.approvalBreakdown(st).filter((t) => t.id !== 'clamp').slice(0, 10)
    .map((t) => `${t.label} ${t.value >= 0 ? '+' : '−'}${Math.abs(t.value).toFixed(1)}`);
}

const termsOf = (st: { systemData: Record<string, unknown> }) =>
  structuredClone((st.systemData.economy as { approvalTerms: Record<string, number> }).approvalTerms);

function context(host: LocalSimHost | LoopbackSimHost, signal: AbortSignal): GameContext {
  return {
    host, get state() { return host.state; }, signal, ui: new Emitter<UIEvents>(), mods: {},
    sound: vi.fn(), toast: vi.fn(), openFlyout: vi.fn(), setOverlay: vi.fn(), panels: { toggle: vi.fn(), open: vi.fn() },
  } as unknown as GameContext;
}

describe.each(HOSTS)('the approval card on %s', (_label, create) => {
  it('rebuilds after each month tick: its rows match approvalBreakdown after two months whose terms change', async () => {
    const { host, run } = await create(), abort = new AbortController();
    const seg = new ApprovalSegment(context(host, abort.signal));
    try {
      const st = () => host.state;
      seg.update();
      // to the next month tick
      await run(DAYS_PER_MONTH - (st().day % DAYS_PER_MONTH)); seg.update();
      expect(st().stats.population).toBeGreaterThan(0);
      const month1 = termsOf(st());
      expect(cardRows(seg).length).toBeGreaterThan(1);
      expect(cardRows(seg)).toEqual(expectedRows(st()));
      // the player raises the taxes: the next monthly update changes the tax term
      for (const dev of [DevType.R1, DevType.R2, DevType.R3]) host.actions.setTax(dev, 15);
      await run(DAYS_PER_MONTH); seg.update();
      const month2 = termsOf(st());
      expect(month2.tax).not.toBe(month1.tax);
      expect(cardRows(seg)).toEqual(expectedRows(st()));
      // and once more, lowering them
      for (const dev of [DevType.R1, DevType.R2, DevType.R3]) host.actions.setTax(dev, 5);
      await run(DAYS_PER_MONTH); seg.update();
      expect(termsOf(st()).tax).not.toBe(month2.tax);
      expect(cardRows(seg)).toEqual(expectedRows(st()));
    } finally { abort.abort(); await host.dispose(); }
  });

  it('does no card work on frames of the same day, nor on a new day whose terms are unchanged', async () => {
    const { host, run } = await create(), abort = new AbortController();
    const seg = new ApprovalSegment(context(host, abort.signal));
    try {
      const st = () => host.state;
      await run(DAYS_PER_MONTH - (st().day % DAYS_PER_MONTH) + 1); seg.update();
      const pop = (seg.el as unknown as FEl).querySelector('.appr-pop')!, rows = [...pop.children];
      expect(rows.length).toBeGreaterThan(1);
      const breakdown = vi.spyOn(approval, 'approvalBreakdown');
      for (let i = 0; i < 10; i++) seg.update();
      // a day that is not a month tick leaves the terms as they are
      expect(st().day % DAYS_PER_MONTH).not.toBe(DAYS_PER_MONTH - 1);
      await run(1); seg.update(); seg.update();
      expect(breakdown).not.toHaveBeenCalled();
      expect(pop.children).toEqual(rows);
      expect(pop.children.every((c, i) => c === rows[i])).toBe(true);
    } finally { abort.abort(); await host.dispose(); }
  });
});
