/** FH-06: the top bar's approval segment for a newcomer: "—" before residents, new-town faces and footer, row fixes. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { Overlay } from '../../src/core/types';
import type { GameContext, UIEvents } from '../../src/game/context';
import { TopBar } from '../../src/ui/TopBar';
import {
  NO_RESIDENTS_TEXT, approvalFace, approvalFix, approvalFixHint, approvalHud, newTownFooter,
} from '../../src/ui/topbar/approvalGuide';
import { LocalSimHost } from '../../src/worker/SimHost';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { approvalBreakdown } from '../../src/sim/economy/approval';
import { newState, stressCity } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
afterEach(() => vi.restoreAllMocks());

/** a monthly approval report as approval.ts leaves it (econData.approvalTerms; resCrime is the mirrored home crime) */
const TERMS = { base: 61, tax: -7, services: -5.4, pollution: -3, crime: -12.3, parks: -1.6, unemployment: -1, clamp: 0 };

function fixture(population: number, approval: number) {
  const st = newState(16), abort = new AbortController();
  st.config.name = 'Test'; st.config.mayor = 'Pat'; st.config.difficulty = 'medium';
  st.stats.demand.fill(0); st.stats.demandCap.fill(0);
  const host = new LocalSimHost(st, { signal: abort.signal, initialSpeed: 0 });
  const showTab = vi.fn();
  const ctx = {
    host, state: st, sim: host.sim, signal: abort.signal, ui: new Emitter<UIEvents>(), mods: {}, world: { timeOfDay: 12 },
    overlay: Overlay.None, overlayVariant: -1,
    setOverlay: vi.fn((o: Overlay) => { ctx.overlay = o; }),
    sound: vi.fn(), toast: vi.fn(), openPauseMenu: vi.fn(), openFlyout: vi.fn(),
    panels: { toggle: vi.fn(), open: vi.fn(), get: vi.fn((id: string) => (id === 'budget' ? { showTab } : undefined)) },
  } as unknown as GameContext & { setOverlay: ReturnType<typeof vi.fn> };
  const bar = new TopBar(ctx, new FEl('div') as unknown as HTMLElement);
  const el = bar.el as unknown as FEl;
  const set = (pop: number, ap: number, terms: Record<string, number> = TERMS) => {
    st.stats.population = pop;
    st.stats.residents = [pop, 0, 0];
    st.stats.approval = ap;
    // a new object, as each monthly report is
    st.systemData.economy = { ...(st.systemData.economy as object), approvalTerms: { ...terms }, approvalRaw: ap - 2, resCrime: 0.41 };
    bar.update();
  };
  set(population, approval);
  const seg = el.querySelector('.approval')!;
  const card = el.querySelector('.appr-pop')!;
  const row = (id: string) => card.querySelectorAll('.ap-r').find((r) => r.dataset.fix === id || textOf(r).startsWith(id));
  /** a click on `target` inside the approval segment (the fake DOM does not bubble: the segment's listener gets the target) */
  const clickOn = (target: FEl) => seg.fire('click', { target });
  return { st, ctx, bar, el, seg, card, row, set, clickOn, showTab, dispose: async () => { abort.abort('dispose'); await host.dispose(); } };
}

describe('approval HUD model (FH-06)', () => {
  it('shows "—" below 50 residents and a number from 50', () => {
    expect(approvalHud(65, 0)).toEqual({ value: '—', face: 'smile', cls: 'none', band: 0 });
    expect(approvalHud(65, 49).value).toBe('—');
    expect(approvalHud(64.6, 50)).toEqual({ value: '65%', face: 'smile', cls: '', band: 1 });
    expect(approvalHud(64.6, 10_000).band).toBe(2);
  });

  it('at 3,000 residents 52% smiles, 38% is meh and 30% frowns; from 10,000 today\'s 60 / 40 apply', () => {
    expect([52, 50, 49.9, 38, 35, 34.9, 30].map((a) => approvalFace(a, 3000))).toEqual(['smile', 'smile', 'meh', 'meh', 'meh', 'frown', 'frown']);
    expect([60, 59.9, 52, 40, 39.9, 30].map((a) => approvalFace(a, 10_000))).toEqual(['smile', 'meh', 'meh', 'meh', 'frown', 'frown']);
    expect(approvalHud(38, 3000).cls).toBe('meh');
    expect(approvalHud(30, 3000).cls).toBe('bad');
  });

  it('the usual new-town range follows the difficulty (the bot tables; sandbox keeps Medium\'s rules)', () => {
    expect(newTownFooter('medium')).toBe('New towns usually sit at 50–55% until police, parks and land value arrive.');
    expect(newTownFooter('easy')).toContain('55–60%');
    expect(newTownFooter('hard')).toContain('45–55%');
    expect(newTownFooter('sandbox')).toBe(newTownFooter('medium'));
  });

  it('maps rows to their fixes', () => {
    expect(approvalFix('crime')).toEqual({ kind: 'view', overlay: Overlay.Police, label: 'Police view' });
    expect(approvalFix('tax')).toEqual({ kind: 'budget', tab: 'taxes', label: 'Budget · Taxes' });
    expect(approvalFix('pollution')).toMatchObject({ kind: 'view', overlay: Overlay.AirPollution });
    expect(approvalFix('parks')).toEqual({ kind: 'flyout', category: 'parks', label: 'Parks tab' });
    expect([Overlay.None, Overlay.Police, Overlay.Fire, Overlay.Health].map((o) => (approvalFix('services', o) as { overlay: Overlay }).overlay))
      .toEqual([Overlay.Police, Overlay.Fire, Overlay.Health, Overlay.Police]);
    for (const id of ['base', 'unemployment', 'deficit', 'strikes', 'clamp']) expect(approvalFix(id)).toBeNull();
    expect(approvalFixHint('crime')).toBe('Click: Police view');
    expect(approvalFixHint('base')).toBeNull();
  });
});

describe('TopBar approval segment (FH-06)', () => {
  it('at 0 residents the HUD shows "—" and the card says approval starts with the first residents', async () => {
    const f = fixture(0, 65);
    try {
      expect(textOf(f.seg.querySelector('.hud-value')!)).toBe('—');
      expect(f.seg.classList.contains('none')).toBe(true);
      expect(textOf(f.card)).toContain(NO_RESIDENTS_TEXT);
      expect(textOf(f.card)).not.toContain('65%');
      expect(f.card.querySelectorAll('.ap-r')).toHaveLength(0);
      // the first residents: the card is rebuilt although no new monthly report came
      f.st.stats.population = 120; f.st.stats.residents = [120, 0, 0];
      f.bar.update();
      expect(textOf(f.seg.querySelector('.hud-value')!)).toBe('65%');
      expect(f.card.querySelectorAll('.ap-r').length).toBeGreaterThan(1);
    } finally { await f.dispose(); }
  });

  it('under 10,000 residents the new-town footer renders and the faces are kinder; from 10,000 neither', async () => {
    const f = fixture(3000, 52);
    try {
      expect(textOf(f.card)).toContain('New towns usually sit at 50–55% until police, parks and land value arrive.');
      expect(f.seg.dataset.face).toBe('smile');
      f.set(3000, 38);
      expect(f.seg.dataset.face).toBe('meh');
      expect(f.seg.classList.contains('meh')).toBe(true);
      f.set(3000, 30);
      expect(f.seg.dataset.face).toBe('frown');
      expect(f.seg.classList.contains('bad')).toBe(true);
      f.set(12_000, 52);
      expect(f.seg.dataset.face).toBe('meh');
      expect(textOf(f.card)).not.toContain('New towns usually');
      expect(textOf(f.card)).toContain('Click a row to open its fix');
    } finally { await f.dispose(); }
  });

  it('shows the row details in the card, not only in a title', async () => {
    const f = fixture(3000, 52);
    try {
      const crime = f.row('crime')!;
      expect(textOf(crime)).toContain('Crime at homes');
      expect(textOf(crime.querySelector('.d')!)).toBe('crime at homes 41% — low-wealth homes, uncollected garbage and low land value; police remove up to 85% where they patrol');
      expect(crime.title).toContain('Click: Police view');
      expect(textOf(f.card.querySelectorAll('.ap-r')[0])).toContain('every city starts at 61');
    } finally { await f.dispose(); }
  });

  it('clicking the crime row sets ctx.overlay = Overlay.Police; rows without a fix and the segment still open the advisors', async () => {
    const f = fixture(3000, 52);
    try {
      // a click on the row's label (a child of the row) finds the row
      f.clickOn(f.row('crime')!.querySelector('.l')!);
      expect(f.ctx.overlay).toBe(Overlay.Police);
      expect(f.ctx.setOverlay).toHaveBeenCalledExactlyOnceWith(Overlay.Police, undefined);
      expect(f.ctx.sound).toHaveBeenCalledWith('overlay');
      expect(f.ctx.panels.toggle).not.toHaveBeenCalled();
      const base = f.card.querySelectorAll('.ap-r')[0];
      expect(base.dataset.fix).toBeUndefined();
      f.clickOn(base);
      f.clickOn(f.card.querySelector('.ap-h')!);
      f.clickOn(f.seg);
      expect(f.ctx.panels.toggle).toHaveBeenCalledTimes(3);
      expect(f.ctx.setOverlay).toHaveBeenCalledTimes(1);
    } finally { await f.dispose(); }
  });

  it('tax opens Budget · Taxes, air the Air view, parks the Parks tab, services steps Police → Fire → Health', async () => {
    const f = fixture(3000, 52);
    try {
      f.clickOn(f.row('tax')!);
      expect(f.ctx.panels.open).toHaveBeenCalledExactlyOnceWith('budget');
      expect(f.showTab).toHaveBeenCalledExactlyOnceWith('taxes');
      // the card would cover the panel it opened: hidden until the pointer leaves the segment
      expect(f.seg.dataset.dismissed).toBe('1');
      f.seg.fire('pointerleave');
      expect(f.seg.dataset.dismissed).toBeUndefined();
      f.clickOn(f.row('pollution')!);
      expect(f.ctx.overlay).toBe(Overlay.AirPollution);
      expect(f.seg.dataset.dismissed).toBeUndefined(); // a data view keeps the card (the services row steps on)
      f.clickOn(f.row('parks')!);
      expect(f.ctx.openFlyout).toHaveBeenCalledExactlyOnceWith('parks');
      expect(f.seg.dataset.dismissed).toBe('1');
      f.seg.fire('pointerleave');
      const seen: Overlay[] = [];
      for (let k = 0; k < 4; k++) { f.clickOn(f.row('services')!); seen.push(f.ctx.overlay); }
      expect(seen).toEqual([Overlay.Police, Overlay.Fire, Overlay.Health, Overlay.Police]);
      expect(f.ctx.panels.toggle).not.toHaveBeenCalled();
      // one delegated listener on the segment, none on the rows, however often the card is rebuilt
      const n = f.seg.listenerCount('click');
      for (let m = 0; m < 5; m++) f.set(3000, 50 + m);
      expect(f.seg.listenerCount('click')).toBe(n);
      for (const r of f.card.querySelectorAll('.ap-r')) expect(r.listenerCount()).toBe(0);
      f.clickOn(f.row('tax')!);
      expect(f.showTab).toHaveBeenCalledTimes(2);
    } finally { await f.dispose(); }
  });
});

describe('the approval card on the replica (LoopbackSimHost)', () => {
  it('reads the crime, tax and baseline details from mirrored data and opens the crime fix', async () => {
    const { st } = stressCity(48, 7);
    st.budget.taxRates.fill(11, 0, 3);
    const abort = new AbortController();
    const host = new LoopbackSimHost(st, { initialSpeed: 0, signal: abort.signal, loopback: { cadence: 'design' } });
    await host.start();
    try {
      host.harness.runDays(60);
      await host.drain();
      const replica = host.state;
      expect(replica).not.toBe(host.harness.primary);
      const detail = (s: Parameters<typeof approvalBreakdown>[0], id: string) => approvalBreakdown(s).find((t) => t.id === id)?.detail;
      for (const id of ['base', 'crime', 'tax']) expect(detail(replica, id), id).toBe(detail(host.harness.primary, id));
      expect(detail(replica, 'crime')).toMatch(/^crime at homes \d+% — low-wealth homes/);
      expect(detail(replica, 'tax')).toMatch(/^homes are taxed 11% on average/);
      const ctx = {
        host, state: replica, sim: host.sim, signal: abort.signal, ui: new Emitter<UIEvents>(), mods: {}, world: { timeOfDay: 12 },
        overlay: Overlay.None, overlayVariant: -1, setOverlay: vi.fn((o: Overlay) => { ctx.overlay = o; }),
        sound: vi.fn(), toast: vi.fn(), openPauseMenu: vi.fn(), openFlyout: vi.fn(), panels: { toggle: vi.fn(), open: vi.fn() },
      } as unknown as GameContext;
      const bar = new TopBar(ctx, new FEl('div') as unknown as HTMLElement);
      bar.update();
      const el = bar.el as unknown as FEl, seg = el.querySelector('.approval')!;
      const crime = el.querySelectorAll('.ap-r').find((r) => r.dataset.fix === 'crime')!;
      expect(textOf(crime)).toContain('crime at homes');
      seg.fire('click', { target: crime });
      expect(ctx.overlay).toBe(Overlay.Police);
      expect(ctx.panels.toggle).not.toHaveBeenCalled();
    } finally { abort.abort('dispose'); await host.dispose(); }
  }, 60000);
});
