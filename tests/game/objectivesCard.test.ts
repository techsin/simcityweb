/**
 * LG-14: the pinned objectives card (src/ui/ObjectivesCard.ts).
 * - A city with no scenario and no Mayor's challenge gets no card and no listener.
 * - It reads the city through the host only (the mirrored state and the host's events); the context's simulation is
 *   never touched.
 * - It updates monthly, on the host's month event (a loan shows at once).
 * - A scenario city opens once with its briefing, paused; the outcome is recorded in the profile the month it is
 *   decided and the win / lose card follows, never during a New Year show or a LIVE emergency; medals and the city's
 *   outcome are there after a reload.
 * - A city founded with Mayor's challenges shows them and how far their badges are.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { GameContext } from '../../src/game/context';
import { loadMedals, loadScenarioRun, type ScenarioStart } from '../../src/game/scenarios';
import { CHALLENGE_BADGE_POP, type MayorChallenge } from '../../src/sim/economy/challenges';
import { ObjectivesCard } from '../../src/ui/ObjectivesCard';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
let store: Map<string, string>;
let win: FEl;
const lifetimes: AbortController[] = [];
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
  win = new FEl('window');
  vi.stubGlobal('window', win);
});
afterEach(() => {
  for (const a of lifetimes.splice(0)) a.abort();
  vi.unstubAllGlobals();
});

const LOANS: [number, number][] = [[60_000, 0.05]];
const LIGHTS_OUT: ScenarioStart = { id: 'lights_out', startDay: 2910, loans: LOANS };
const loan = ([principal, rate]: [number, number]) => ({ principal, rate, remaining: principal, monthlyPayment: 1, monthsLeft: 60 });

interface CityOpts {
  scenario?: ScenarioStart; challenges?: MayorChallenge[]; pop?: number; approval?: number; day?: number; tile?: number;
  /** another dialog is already over the city when it opens (a storage dialog, a guide's own card) */
  dialog?: boolean;
}

/** the mirrored state a card reads, as a plain object: nothing else of the city exists in these tests */
function cityState(o: CityOpts) {
  const day = o.day ?? o.scenario?.startDay ?? 3000, m0 = Math.floor(day / 30);
  return {
    config: { name: 'Ashbury', seed: 7, regionId: 'r1', tileX: o.tile ?? 6, tileZ: 6, ...(o.scenario ? { scenario: o.scenario } : {}), ...(o.challenges ? { challenges: o.challenges } : {}) },
    day,
    stats: { population: o.pop ?? 71_043, approval: o.approval ?? 62 },
    history: { t: [m0], pop: [o.pop ?? 71_043], approval: [o.approval ?? 62], air: [0.05] },
    budget: { loans: LOANS.map(loan), curIncome: {} as Record<string, number>, lastIncome: {} as Record<string, number> },
  };
}
type State = ReturnType<typeof cityState>;

function setup(o: CityOpts, state: State = cityState(o)) {
  const abort = new AbortController();
  lifetimes.push(abort);
  const events = new Emitter<Record<string, unknown>>(), ui = new Emitter<Record<string, unknown>>();
  const speed = { value: 1, pausedFrom: 1 };
  const host = {
    events, policy: { live: false, alerts: [], subscribe: () => () => undefined },
    setSpeed: vi.fn((v: number, source: string) => { if (v === 0 && source === 'pause') speed.pausedFrom = speed.value; speed.value = v; }),
    resume: vi.fn(() => { speed.value = speed.pausedFrom; }),
  };
  const show = { newYear: false };
  const root = new FEl('div'), column = new FEl('div');
  const dialog = o.dialog ? root.appendChild(new FEl('div')) : null;
  if (dialog) dialog.className = 'modal-back';
  // the guide card and the toasts are already in the column
  const guide = column.appendChild(new FEl('div')), toasts = column.appendChild(new FEl('div'));
  guide.className = 'onboard';
  toasts.className = 'toasts';
  const sound = vi.fn(), toast = vi.fn(), exitToRegion = vi.fn(async () => undefined);
  const ctx = {
    host, ui, root, settings: { motion: 'full' }, signal: abort.signal, sound, toast, exitToRegion,
    newYearBusy: () => show.newYear,
    get state() { return state; },
    get sim(): never { throw new Error('the card must not reach into the simulation'); },
    get actions(): never { throw new Error('the card sends no action'); },
  } as unknown as GameContext;
  const card = new ObjectivesCard(ctx, column as unknown as HTMLElement);
  const el = column.querySelector('.objectives');
  /** the next month: a history sample, the day and the stats, then the host's event */
  const month = (pop: number, approval: number, air = 0.05) => {
    const h = state.history;
    h.t.push(h.t.at(-1)! + 1);
    h.pop.push(pop);
    h.approval.push(approval);
    h.air.push(air);
    state.day = h.t.at(-1)! * 30;
    state.stats.population = pop;
    state.stats.approval = approval;
    state.budget.lastIncome = state.budget.curIncome;
    state.budget.curIncome = {};
    events.emit('month', h.t.at(-1));
  };
  const tick = () => ui.emit('uiTick', undefined);
  const lines = () => (el?.querySelectorAll('.obj-line') ?? []).map((l) => textOf(l));
  const modal = () => root.querySelector('.obj-card');
  const press = (label: string) => modal()!.querySelectorAll('button').find((b) => textOf(b) === label)!.click();
  const listeners = (e: Emitter<Record<string, unknown>>) => [...(e as unknown as { map: Map<string, Set<unknown>> }).map.values()].reduce((n, s) => n + s.size, 0);
  return { state, abort, events, ui, host, speed, show, root, dialog, column, guide, card, el, sound, toast, exitToRegion, month, tick, lines, modal, press, listeners };
}

describe('LG-14 objectives card: which cities have one', () => {
  it('a city with no scenario and no challenge gets no card, no listener and no stored record', () => {
    const t = setup({});
    expect(t.card.el).toBeNull();
    expect(t.column.querySelector('.objectives')).toBeNull();
    expect(t.column.children).toHaveLength(2);
    expect(t.listeners(t.events)).toBe(0);
    expect(t.listeners(t.ui)).toBe(0);
    expect(win.listenerCount()).toBe(0);
    expect(t.host.setSpeed).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
    expect(t.modal()).toBeNull();
  });

  it('a scenario city has it at the top of the top-left column, above the guide and the toasts', () => {
    const t = setup({ scenario: LIGHTS_OUT });
    expect(t.column.children.map((c) => c.className.split(' ')[0])).toEqual(['objectives', 'onboard', 'toasts']);
    expect(t.el!.getAttribute('role')).toBe('status');
    expect(textOf(t.el!.querySelector('.obj-title')!)).toBe('Lights Out');
    expect(textOf(t.el!.querySelector('.obj-sub')!)).toBe('Month 1 of 12 · Gold in reach');
    expect(t.lines()).toEqual(['Residents71,043 / 70,000', 'Approval62% / 60%', 'No new loanKept (gold needs it)']);
    expect(t.el!.querySelectorAll('.obj-medal').map((m) => [textOf(m), m.classList.contains('have'), m.classList.contains('out')])).toEqual([
      ['Bronze', false, false], ['Silver', false, false], ['Gold', false, false],
    ]);
    // the medals carry what they take as their tooltip
    expect(t.el!.querySelectorAll('.obj-medal').map((m) => m.title)).toEqual(['Within 12 months', 'Within 9 months', 'Within 6 months, without a new loan']);
  });

  it('a save whose scenario this build does not know is free play: no card', () => {
    const t = setup({ scenario: { id: 'gridlock', startDay: 0 } as unknown as ScenarioStart });
    expect(t.card.el).toBeNull();
    expect(t.listeners(t.events)).toBe(0);
  });
});

describe('LG-14 objectives card: the briefing', () => {
  it('a scenario city opens once with its briefing, paused; "Take office" resumes', () => {
    const t = setup({ scenario: LIGHTS_OUT });
    expect(t.card.modalOpen).toBe(true);
    expect(t.host.setSpeed).toHaveBeenCalledWith(0, 'pause');
    expect(t.speed.value).toBe(0);
    const m = t.modal()!;
    expect(textOf(m.querySelector('h2')!)).toBe('Lights Out');
    expect(textOf(m.querySelector('.obj-text')!)).toContain('70,000 residents and 60% approval');
    expect(m.querySelectorAll('.obj-goal').map((g) => textOf(g))).toEqual(['BronzeWithin 12 months', 'SilverWithin 9 months', 'GoldWithin 6 months, without a new loan']);
    // the profile knows the city from now on
    expect(loadScenarioRun('r1:6_6')).toEqual({});
    t.press('Take office');
    expect(t.card.modalOpen).toBe(false);
    expect(t.modal()).toBeNull();
    expect(t.host.resume).toHaveBeenCalledWith('pause');
    expect(t.speed.value).toBe(1);

    // the same city opened again (a reload): no second briefing, and the game is not paused
    const again = setup({ scenario: LIGHTS_OUT });
    expect(again.card.modalOpen).toBe(false);
    expect(again.host.setSpeed).not.toHaveBeenCalled();
  });

  it('Boomtown is a new, paused city: its briefing leaves it paused for the founding', () => {
    const state = cityState({ scenario: { id: 'boomtown', startDay: 90 }, pop: 0, day: 90 });
    state.history = { t: [], pop: [], approval: [], air: [] };
    state.budget.loans = [];
    const t = setup({}, state);
    t.speed.value = 0;
    t.speed.pausedFrom = 0;
    expect(textOf(t.modal()!.querySelector('h2')!)).toBe('Boomtown');
    t.press('Found the city');
    expect(t.speed.value).toBe(0);
    expect(t.lines()[0]).toBe('Residents0 / 50,000');
    expect(textOf(t.el!.querySelector('.obj-sub')!)).toBe('Year 1 of 10 · Gold in reach');
  });

  it('a city first opened after its first month (an older save, a cleared profile) gets no briefing', () => {
    const state = cityState({ scenario: LIGHTS_OUT });
    state.history.t.push(98);
    state.history.pop.push(39_533);
    state.history.approval.push(48);
    state.history.air.push(0.04);
    state.day = 2940;
    const t = setup({}, state);
    expect(t.card.modalOpen).toBe(false);
    expect(t.card.scenario).toMatchObject({ phase: 'active', month: 1 });
  });

  it('a dialog already over the city when it opens (a storage dialog, a guide\'s own) keeps the briefing waiting; it then opens once', () => {
    const t = setup({ scenario: LIGHTS_OUT, dialog: true });
    expect(t.card.modalOpen).toBe(false);
    expect(t.modal()).toBeNull();
    expect(t.host.setSpeed).not.toHaveBeenCalled();
    // the profile knows the city all the same (a reload in the meantime would not brief it again)
    expect(loadScenarioRun('r1:6_6')).toEqual({});
    t.tick();
    expect(t.card.modalOpen).toBe(false);
    t.dialog!.remove();
    t.tick();
    expect(t.card.modalOpen).toBe(true);
    expect(textOf(t.modal()!.querySelector('h2')!)).toBe('Lights Out');
    expect(t.host.setSpeed).toHaveBeenCalledWith(0, 'pause');
    t.press('Take office');
    expect(t.speed.value).toBe(1);
    t.tick();
    expect(t.card.modalOpen).toBe(false);
    expect(t.host.setSpeed).toHaveBeenCalledTimes(1);
  });

  const key = (k: string, repeat = false) => {
    const e = { key: k, repeat, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    win.fire('keydown', e);
    return e;
  };

  it('no hotkey of the game runs under an open card: Esc and Enter are its main button, Space and the speed keys stop there', () => {
    const t = setup({ scenario: LIGHTS_OUT });
    const space = key(' ');
    expect(space.stopImmediatePropagation).toHaveBeenCalled();
    expect(space.preventDefault).toHaveBeenCalled();
    expect(t.card.modalOpen).toBe(true);
    // a speed key (it would unpause the city behind the card) or a tool key never reaches the game; the browser keeps
    // its own keys (F5, Tab), so nothing else is prevented
    for (const k of ['1', '3', 'b', 'Delete', 'F1', 'Tab']) {
      const e = key(k);
      expect(e.stopImmediatePropagation, k).toHaveBeenCalled();
      expect(e.preventDefault, k).not.toHaveBeenCalled();
    }
    expect(t.host.setSpeed).toHaveBeenCalledTimes(1);
    // a held Enter does nothing
    expect(key('Enter', true).stopImmediatePropagation).toHaveBeenCalled();
    expect(t.card.modalOpen).toBe(true);
    key('Escape');
    expect(t.card.modalOpen).toBe(false);
    expect(t.speed.value).toBe(1);
    // with no card open the keys are the game's
    expect(key('Escape').stopImmediatePropagation).not.toHaveBeenCalled();
    expect(key(' ').preventDefault).not.toHaveBeenCalled();
    expect(key('1').stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('a focused button of the card keeps Enter and Space (the browser clicks it); elsewhere Enter is the main button', () => {
    const t = setup({ scenario: LIGHTS_OUT });
    const back = t.root.querySelector('.obj-back')! as unknown as { contains: (n: unknown) => boolean };
    const inside = { tagName: 'BUTTON' }, outside = { tagName: 'BUTTON' };
    back.contains = (n) => n === inside;
    const doc = document as unknown as { activeElement?: unknown };
    try {
      doc.activeElement = inside;
      for (const k of ['Enter', ' ']) {
        const e = key(k);
        expect(e.stopImmediatePropagation, k).toHaveBeenCalled();
        expect(e.preventDefault, k).not.toHaveBeenCalled();
      }
      expect(t.card.modalOpen).toBe(true);
      // a focused button outside the card (the HUD behind it) gets neither key
      doc.activeElement = outside;
      expect(key(' ').preventDefault).toHaveBeenCalled();
      expect(t.card.modalOpen).toBe(true);
      const enter = key('Enter');
      expect(enter.preventDefault).toHaveBeenCalled();
      expect(t.card.modalOpen).toBe(false);
      expect(t.speed.value).toBe(1);
    } finally {
      delete doc.activeElement;
    }
  });

  it('leaves the keys to a dialog that is open above it', () => {
    const t = setup({ scenario: LIGHTS_OUT });
    const other = t.root.appendChild(new FEl('div'));
    other.className = 'modal-back confirm';
    for (const k of ['Escape', 'Enter', ' ', '1']) {
      const e = key(k);
      expect(e.stopImmediatePropagation, k).not.toHaveBeenCalled();
      expect(e.preventDefault, k).not.toHaveBeenCalled();
    }
    expect(t.card.modalOpen).toBe(true);
    other.remove();
    key('Escape');
    expect(t.card.modalOpen).toBe(false);
  });
});

describe('LG-14 objectives card: monthly updates', () => {
  it('follows the host\'s month event, not the days in between', () => {
    const t = setup({ scenario: LIGHTS_OUT });
    t.press('Take office');
    // days pass, people leave: the card keeps the month's figures
    t.state.day += 12;
    t.state.stats.population = 55_000;
    t.state.stats.approval = 51;
    t.tick();
    expect(t.lines()[0]).toBe('Residents71,043 / 70,000');
    t.month(39_533, 48);
    expect(t.lines()).toEqual(['Residents39,533 / 70,000', 'Approval48% / 60%', 'No new loanKept (gold needs it)']);
    expect(textOf(t.el!.querySelector('.obj-sub')!)).toBe('Month 2 of 12 · Gold in reach');
    expect(t.el!.querySelectorAll('.obj-line').map((l) => l.classList.contains('done'))).toEqual([false, false, true]);
    expect(t.el!.querySelectorAll('.fill').map((f) => f.style.width)).toEqual(['56%', '80%', '100%']);
    // the pill's line for the minimised card
    expect(textOf(t.el!.querySelector('.obj-pt')!)).toBe('Lights Out · 39,533 / 70,000 residents · 48% / 60%');
  });

  it('reads a month whose history arrives after its event on the next UI tick', () => {
    const t = setup({ scenario: LIGHTS_OUT });
    t.press('Take office');
    // the event first (nothing new to read yet), the sample afterwards
    t.events.emit('month', 98);
    expect(t.lines()[0]).toBe('Residents71,043 / 70,000');
    const h = t.state.history;
    h.t.push(98); h.pop.push(40_000); h.approval.push(49); h.air.push(0.04);
    t.state.day = 2940;
    t.state.stats.population = 40_000;
    t.state.stats.approval = 49;
    t.tick();
    expect(t.lines()[0]).toBe('Residents40,000 / 70,000');
  });

  it('Boomtown says a medal is secured the month it happens, and goes on to the next one', () => {
    const t = setup({ scenario: { id: 'boomtown', startDay: 90 }, pop: 0, day: 90 });
    t.press('Found the city');
    t.month(49_000, 60);
    expect(t.toast).not.toHaveBeenCalled();
    t.month(50_200, 60);
    expect(t.toast).toHaveBeenCalledTimes(1);
    expect(t.toast.mock.calls[0]).toEqual(['Bronze is secured: 50,000 residents by year 10.', 'good', undefined, 'Boomtown']);
    expect(textOf(t.el!.querySelector('.obj-sub')!)).toBe('Year 1 of 10 · Bronze secured');
    expect(t.lines()[0]).toBe('Residents50,200 / 100,000');
    expect(t.el!.querySelectorAll('.obj-medal').map((m) => m.classList.contains('have'))).toEqual([true, false, false]);
    // the same medal is not announced again, also when the city dips and comes back
    t.month(48_000, 60);
    t.month(51_000, 60);
    expect(t.toast).toHaveBeenCalledTimes(1);
    t.month(100_000, 60);
    expect(t.toast).toHaveBeenCalledTimes(2);
    expect(t.toast.mock.calls[1][0]).toBe('Silver is secured: 100,000 residents.');
    // nothing is decided before year 10 or gold: no result card, no medal in the profile yet
    t.tick();
    expect(t.card.modalOpen).toBe(false);
    expect(loadMedals()).toEqual({});
    // gold ends it
    t.month(150_000, 60);
    expect(t.toast).toHaveBeenCalledTimes(2);
    t.tick();
    expect(textOf(t.modal()!.querySelector('h2')!)).toBe('Gold medal');
    expect(loadMedals().boomtown).toMatchObject({ medal: 'gold', month: 6 });
  });

  it('a loan shows at once and stays on record after it is repaid: gold is gone, the recovery is silver', () => {
    const t = setup({ scenario: LIGHTS_OUT });
    t.press('Take office');
    t.state.budget.loans.push(loan([30_000, 0.06]));
    t.state.budget.curIncome['oneoff:loan'] = 30_000;
    t.tick();
    expect(t.lines()[2]).toBe('No new loanA loan was taken: silver at best');
    expect(textOf(t.el!.querySelector('.obj-sub')!)).toBe('Month 1 of 12 · Silver in reach');
    expect(t.el!.querySelectorAll('.obj-medal').map((m) => m.classList.contains('out'))).toEqual([false, false, true]);
    expect(loadScenarioRun('r1:6_6')).toEqual({ newLoan: true });
    // repaid: nothing in the city shows the loan any more
    t.state.budget.loans.pop();
    t.month(40_000, 50);
    t.month(72_000, 61);
    expect(t.card.scenario).toMatchObject({ phase: 'won', medal: 'silver', newLoan: true, result: { medal: 'silver', month: 2 } });
    expect(loadMedals().lights_out).toMatchObject({ medal: 'silver', month: 2 });
  });
});

describe('LG-14 objectives card: the outcome', () => {
  it('a win is recorded the month it is reached; its card opens paused once no New Year show is running', () => {
    const t = setup({ scenario: LIGHTS_OUT });
    t.press('Take office');
    t.show.newYear = true;
    t.month(72_282, 64);
    // decided and in the profile at once
    expect(t.card.scenario).toMatchObject({ phase: 'won', medal: 'gold', result: { medal: 'gold', month: 1 } });
    expect(loadMedals()).toMatchObject({ lights_out: { medal: 'gold', month: 1 } });
    expect(loadScenarioRun('r1:6_6')).toEqual({ result: { medal: 'gold', month: 1 } });
    // the card waits for the show
    t.tick();
    expect(t.card.modalOpen).toBe(false);
    t.show.newYear = false;
    t.host.setSpeed.mockClear();
    t.tick();
    expect(t.card.modalOpen).toBe(true);
    expect(t.host.setSpeed).toHaveBeenCalledWith(0, 'pause');
    const m = t.modal()!;
    expect(m.classList.contains('gold')).toBe(true);
    expect(textOf(m.querySelector('h2')!)).toBe('Gold medal');
    expect(m.querySelectorAll('.obj-text').map((p) => textOf(p))).toEqual([
      'The city is back at 70,000 residents and 60% approval after 1 month, without a new loan.', 'Your first medal in this scenario.',
    ]);
    expect(t.sound).toHaveBeenCalledWith('reward');
    t.press('Keep playing');
    expect(t.card.modalOpen).toBe(false);
    expect(t.speed.value).toBe(1);
    // it is shown once
    t.tick();
    expect(t.card.modalOpen).toBe(false);
    // the pinned card keeps the outcome
    expect(t.el!.classList.contains('won')).toBe(true);
    expect(textOf(t.el!.querySelector('.obj-sub')!)).toBe('Gold medal');
    expect(t.el!.querySelectorAll('.obj-medal').map((x) => [x.classList.contains('have'), x.classList.contains('out')])).toEqual([[false, true], [false, true], [true, false]]);
    // and later months do not judge again
    t.month(30_000, 40);
    expect(t.card.scenario).toMatchObject({ phase: 'won', medal: 'gold' });
    t.tick();
    expect(t.card.modalOpen).toBe(false);
  });

  it('waits while a LIVE emergency runs', () => {
    const t = setup({ scenario: LIGHTS_OUT });
    t.press('Take office');
    t.host.policy.live = true;
    t.month(72_282, 64);
    t.tick();
    expect(t.card.modalOpen).toBe(false);
    t.host.policy.live = false;
    t.tick();
    expect(t.card.modalOpen).toBe(true);
  });

  it('waits while another dialog is open (the pause menu, a confirmation): the outcome is recorded all the same', () => {
    const t = setup({ scenario: LIGHTS_OUT });
    t.press('Take office');
    // the pause menu: the game's own pause, taken from the speed the city ran at
    const menu = t.root.appendChild(new FEl('div'));
    menu.className = 'modal-back';
    t.host.setSpeed.mockClear();
    t.month(72_282, 64);
    t.tick();
    expect(t.card.modalOpen).toBe(false);
    expect(t.host.setSpeed).not.toHaveBeenCalled();
    expect(loadMedals()).toMatchObject({ lights_out: { medal: 'gold', month: 1 } });
    // closing: the menu is still in the page for its fade
    menu.className = 'modal-back closing';
    t.tick();
    expect(t.card.modalOpen).toBe(false);
    menu.remove();
    t.tick();
    expect(t.card.modalOpen).toBe(true);
    expect(t.host.setSpeed).toHaveBeenCalledWith(0, 'pause');
  });

  it('"Exit to region" leaves through the game\'s own exit, still paused', () => {
    const t = setup({ scenario: LIGHTS_OUT });
    t.press('Take office');
    t.month(72_282, 64);
    t.tick();
    t.host.resume.mockClear();
    t.press('Exit to region');
    expect(t.exitToRegion).toHaveBeenCalledTimes(1);
    expect(t.host.resume).not.toHaveBeenCalled();
    expect(t.card.modalOpen).toBe(false);
  });

  it('twelve months without a recovery: the lose card, and no medal', () => {
    const t = setup({ scenario: LIGHTS_OUT });
    t.press('Take office');
    for (let m = 0; m < 11; m++) t.month(15_000, 45);
    expect(t.card.scenario).toMatchObject({ phase: 'active', reach: 'bronze' });
    expect(t.el!.querySelectorAll('.obj-medal').map((x) => x.classList.contains('out'))).toEqual([false, true, true]);
    t.month(15_000, 45);
    t.tick();
    const m = t.modal()!;
    expect(m.classList.contains('lost')).toBe(true);
    expect(textOf(m.querySelector('h2')!)).toBe('Out of time');
    expect(textOf(m.querySelector('.obj-text')!)).toBe('12 months on, the city has not come back to 70,000 residents and 60% approval.');
    expect(loadMedals()).toEqual({});
    expect(loadScenarioRun('r1:6_6')).toEqual({ result: { medal: null, month: 12 } });
    t.press('Keep playing');
    expect(t.el!.classList.contains('lost')).toBe(true);
    expect(textOf(t.el!.querySelector('.obj-sub')!)).toBe('Not reached');
    expect(t.el!.querySelectorAll('.obj-medal').map((x) => x.classList.contains('out'))).toEqual([true, true, true]);
  });

  it('medals and the city\'s outcome are there after a reload; a second attempt can only improve the best', () => {
    const first = setup({ scenario: LIGHTS_OUT });
    first.press('Take office');
    for (let m = 0; m < 7; m++) first.month(20_000, 45);
    first.month(72_000, 62);
    expect(loadMedals().lights_out).toMatchObject({ medal: 'silver', month: 8 });
    first.abort.abort();

    // the same city, opened again from its save: decided, no briefing, no second result card
    const state = cityState({ scenario: LIGHTS_OUT });
    for (let m = 1; m <= 8; m++) { state.history.t.push(97 + m); state.history.pop.push(m < 8 ? 20_000 : 72_000); state.history.approval.push(m < 8 ? 45 : 62); state.history.air.push(0.05); }
    state.day = 105 * 30;
    const again = setup({}, state);
    expect(again.card.scenario).toMatchObject({ phase: 'won', medal: 'silver', result: { medal: 'silver', month: 8 } });
    again.tick();
    expect(again.card.modalOpen).toBe(false);
    expect(textOf(again.el!.querySelector('.obj-sub')!)).toBe('Silver medal');

    // another attempt (another region): bronze does not replace silver, and its card says so
    const second = setup({ scenario: LIGHTS_OUT, tile: 9 });
    second.press('Take office');
    for (let m = 0; m < 10; m++) second.month(20_000, 45);
    second.month(72_000, 62);
    second.tick();
    expect(textOf(second.modal()!.querySelector('h2')!)).toBe('Bronze medal');
    expect(second.modal()!.querySelectorAll('.obj-text').map((p) => textOf(p))[1]).toBe('Your best stays Silver.');
    expect(loadMedals().lights_out).toMatchObject({ medal: 'silver', month: 8 });
    second.press('Keep playing');

    // a third, in gold time: a new best
    const third = setup({ scenario: LIGHTS_OUT, tile: 10 });
    third.press('Take office');
    third.month(72_000, 62);
    third.tick();
    expect(third.modal()!.querySelectorAll('.obj-text').map((p) => textOf(p))[1]).toBe('A new best: your Silver medal is now Gold.');
    expect(loadMedals().lights_out).toMatchObject({ medal: 'gold', month: 1 });
  });
});

describe('LG-14 objectives card: Mayor\'s challenges', () => {
  it('a city founded with challenges shows them and how far their badges are', () => {
    const t = setup({ challenges: ['noLoans', 'hardMoney'], pop: 12_340 });
    expect(t.card.modalOpen).toBe(false);
    expect(t.host.setSpeed).not.toHaveBeenCalled();
    expect(textOf(t.el!.querySelector('.obj-title')!)).toBe('Mayor’s challenges');
    expect(textOf(t.el!.querySelector('.obj-sub')!)).toBe(`Badges at ${CHALLENGE_BADGE_POP.toLocaleString('en-US')} residents`);
    expect(t.el!.querySelectorAll('.obj-ch-chip').map((c) => [textOf(c), c.title])).toEqual([
      ['No loans', 'The bank lends nothing: the city lives on what it earns.'],
      ['Hard money', 'Hard\'s money on any difficulty: §40k to start and 15% less tax income.'],
    ]);
    expect(t.lines()).toEqual(['Badges12,340 / 25,000 residents']);
    expect(t.el!.querySelector('.fill')!.style.width).toBe('49%');
    // no scenario: no medals, no lines of one
    expect(t.el!.querySelector('.obj-medals')).toBeNull();
  });

  it('announces the badges once, the month the city reaches the rank', () => {
    const t = setup({ challenges: ['noLoans'], pop: 24_000 });
    t.month(24_900, 60);
    expect(t.toast).not.toHaveBeenCalled();
    t.month(25_100, 60);
    expect(t.toast).toHaveBeenCalledTimes(1);
    expect(t.toast.mock.calls[0][0]).toBe('No loans: the badge is earned. It shows on the region card.');
    expect(t.lines()).toEqual(['BadgesEarned']);
    expect(t.el!.querySelector('.obj-ch')!.classList.contains('earned')).toBe(true);
    // the city shrinks: earned stays earned, and is not announced again
    t.month(20_000, 60);
    t.month(26_000, 60);
    expect(t.lines()).toEqual(['BadgesEarned']);
    expect(t.toast).toHaveBeenCalledTimes(1);
  });

  it('a city that already holds its badges when it is opened says so without a toast', () => {
    const t = setup({ challenges: ['noDirtyIndustry'], pop: 80_000 });
    expect(t.lines()).toEqual(['BadgesEarned']);
    expect(textOf(t.el!.querySelector('.obj-sub')!)).toBe('Badges earned');
    expect(t.toast).not.toHaveBeenCalled();
  });
});

describe('LG-14 objectives card: lifetime', () => {
  it('minimises to a pill and remembers it', () => {
    const t = setup({ challenges: ['noLoans'], pop: 1000 });
    expect(t.card.isMinimised).toBe(false);
    t.el!.querySelectorAll('button').find((b) => b.title === 'Minimise')!.click();
    expect(t.card.isMinimised).toBe(true);
    expect(t.el!.classList.contains('min')).toBe(true);
    expect(textOf(t.el!.querySelector('.obj-pt')!)).toBe('Challenges · 1,000 / 25,000');
    const again = setup({ challenges: ['noLoans'], pop: 1000 });
    expect(again.card.isMinimised).toBe(true);
    again.el!.querySelector('.obj-pill')!.click();
    expect(again.card.isMinimised).toBe(false);
    expect(setup({ challenges: ['noLoans'] }).card.isMinimised).toBe(false);
  });

  it('goes with the city: the card, an open briefing and every listener', () => {
    const t = setup({ scenario: LIGHTS_OUT });
    expect(t.card.modalOpen).toBe(true);
    expect(t.listeners(t.events)).toBe(2);
    expect(t.listeners(t.ui)).toBe(2);
    expect(win.listenerCount('keydown')).toBe(1);
    t.abort.abort();
    expect(t.column.querySelector('.objectives')).toBeNull();
    expect(t.modal()).toBeNull();
    expect(t.listeners(t.events)).toBe(0);
    expect(t.listeners(t.ui)).toBe(0);
    expect(win.listenerCount('keydown')).toBe(0);
    // late events find nothing
    expect(() => { t.events.emit('month', 99); t.tick(); }).not.toThrow();
  });

  it('a city already disposed builds nothing', () => {
    const abort = new AbortController();
    abort.abort();
    const column = new FEl('div');
    const ctx = { state: cityState({ scenario: LIGHTS_OUT }), signal: abort.signal } as unknown as GameContext;
    const card = new ObjectivesCard(ctx, column as unknown as HTMLElement);
    expect(card.el).toBeNull();
    expect(column.children).toHaveLength(0);
  });
});
