/**
 * LG-14: the pinned objectives card of a scenario city, its briefing and its win / lose card; also the Mayor's challenges
 * of a city founded with some (their rules and how far their badges are).
 *
 * - A city with neither a scenario nor a challenge gets no card: nothing is mounted and nothing listens.
 * - The card reads the city through the host only: the mirrored state (ctx.state: config, day, stats, loans and the
 *   monthly history) and the host's month / reset events. It judges with src/game/scenarios.ts evaluateScenario, a pure
 *   function, so it sends no command but the pause of its briefing and result cards (host.setSpeed / host.resume).
 * - It updates once a month (the host's 'month' event; the UI tick only compares a few numbers, so a loan taken shows
 *   at once and a host that delivers the month's history after its event is still read in that month).
 * - The outcome is decided once: the month it is reached, the result is recorded in the profile (recordScenarioRun: the
 *   city's outcome and the profile's best medal), and the win / lose card opens as soon as no New Year show or LIVE
 *   emergency is running and no other dialog is open. A city whose outcome is known shows it and judges no more.
 * - The briefing shows once per scenario city, at its start, as soon as no other dialog is open (it never stacks on a
 *   storage dialog or a guide's own card). It and the result card pause the city like the pause menu does, and no
 *   hotkey of the game runs under them.
 * - It sits at the top of the top-left HUD column, above the guide card and the toasts, and minimises to a pill.
 */
import './objectives.css';
import type { GameContext } from '../game/context';
import { loadPref, resolveMotion, savePref } from '../game/settings';
import {
  CHALLENGE_BADGE_NOTE, MEDALS, MEDAL_NAMES, SCENARIOS, challengeStatus, evaluateScenario, loadMedals, loadScenarioRun, medalRank,
  recordScenarioRun, resultText, runKey, scenarioOf, type ChallengeStatus, type Medal, type ScenarioMemo, type ScenarioStart,
  type ScenarioStatus,
} from '../game/scenarios';
import { h, setText, toggleClass } from './dom';
import { icon } from './icons';
import { confirmOpen } from './Modals';
import { storageDialogOpen } from './StorageDialog';

const PREF = 'objectives';
const num = (v: number): string => Math.round(v).toLocaleString('en-US');

interface LineEls {
  row: HTMLElement;
  label: HTMLElement;
  value: HTMLElement;
  fill: HTMLElement;
  width: string;
}

export class ObjectivesCard {
  /** the card (null in a city with no scenario and no Mayor's challenge) */
  readonly el: HTMLElement | null = null;
  private start: ScenarioStart | null = null;
  private key = '';
  private memo: ScenarioMemo = {};
  private status: ScenarioStatus | null = null;
  /** the briefing is due and has not been shown yet (it waits for another dialog over the city to close) */
  private briefing = false;
  /** a decided outcome whose card has not been shown yet */
  private pending: { status: ScenarioStatus; best: boolean; previous: Medal | null } | null = null;
  private modal: { el: HTMLElement; primary: () => void } | null = null;
  private title!: HTMLElement;
  private sub!: HTMLElement;
  private pillText!: HTMLElement;
  private linesEl!: HTMLElement;
  private medalsEl!: HTMLElement;
  private medalEls = new Map<Medal, HTMLElement>();
  private lines: LineEls[] = [];
  private chEls: { root: HTMLElement; value: HTMLElement; fill: HTMLElement; width: string } | null = null;
  /** the challenge badges were earned when the card last looked (a change while playing is announced once) */
  private earned: boolean | null = null;
  /** the rank of the medal secured when the card last looked (-1: it has not looked yet) */
  private secured = -1;
  private minimised = false;
  private offs: (() => void)[] = [];
  private disposed = false;
  // what the last evaluation was made from (the UI tick compares these, nothing else)
  private seen = { samples: -1, last: -1, month: -1, loans: -1, proceeds: false };

  constructor(private ctx: GameContext, parent: HTMLElement) {
    const st = ctx.state;
    this.start = scenarioOf(st.config);
    const challenges = challengeStatus(st);
    if ((!this.start && !challenges) || ctx.signal.aborted) return;

    this.el = this.build(challenges);
    parent.prepend(this.el);
    this.setMinimised(!!loadPref<{ min?: boolean }>(PREF, {}).min, false);

    let first = false;
    if (this.start) {
      this.key = runKey(st.config);
      const known = loadScenarioRun(this.key);
      first = !known;
      this.memo = known ?? {};
      // (the profile now knows this city: its briefing shows once)
      if (first) recordScenarioRun(this.key, this.start.id, {});
    }
    this.refresh();
    // the briefing of a city the profile has not seen, at its start: at once, or once another dialog over the city (a
    // storage dialog, a guide's own) has closed, so two cards never stack
    this.briefing = first && this.status?.phase === 'active' && this.status.month === 0;
    if (this.briefing && !this.otherDialog()) this.showBriefing();

    this.offs.push(
      ctx.host.events.on('month', () => this.refresh()),
      ctx.host.events.on('reset', () => this.refresh()),
      ctx.ui.on('uiTick', () => this.tick()),
      ctx.ui.on('settings', () => this.paintMotion()),
    );
    // registered before the scene's own key handler (the scene builds its HUD first): an open card takes its keys
    if (typeof window !== 'undefined') window.addEventListener('keydown', (e) => this.onKey(e), { capture: true, signal: ctx.signal });
    ctx.signal.addEventListener('abort', () => this.dispose(), { once: true });
  }

  /** where the scenario stands (tests; null in a city without one) */
  get scenario(): ScenarioStatus | null {
    return this.status;
  }

  get isMinimised(): boolean {
    return this.minimised;
  }

  /** a briefing or result card is open */
  get modalOpen(): boolean {
    return !!this.modal;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs = [];
    this.modal?.el.remove();
    this.modal = null;
    this.pending = null;
    this.el?.remove();
  }

  // ------------------------------------------------------------------------------------------------ building
  private build(challenges: ChallengeStatus | null): HTMLElement {
    const signal = this.ctx.signal;
    const def = this.start ? SCENARIOS[this.start.id] : null;
    this.title = h('div', { class: 'obj-title' }, def ? def.title : 'Mayor’s challenges');
    this.sub = h('div', { class: 'obj-sub' });
    this.pillText = h('span', { class: 'obj-pt' });
    const min = h('button', { class: 'icon-btn', type: 'button', title: 'Minimise', html: icon('minus', 14) });
    min.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMinimised(true);
      this.ctx.sound('close');
    }, { signal });
    const pill = h('button', { class: 'obj-pill', type: 'button', title: 'Show the objectives' },
      h('span', { class: 'obj-badge', html: icon(def ? 'trophy' : 'star', 13) }), this.pillText, h('span', { class: 'ico-wrap', html: icon('chevDown', 13) }));
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMinimised(false);
      this.ctx.sound('open');
    }, { signal });
    this.linesEl = h('div', { class: 'obj-lines' });
    this.medalsEl = h('div', { class: 'obj-medals' });
    if (def) {
      for (const m of MEDALS) {
        const chip = h('span', { class: `obj-medal ${m}`, title: def.goals[m] }, MEDAL_NAMES[m]);
        this.medalEls.set(m, chip);
        this.medalsEl.appendChild(chip);
      }
    }
    const el = h('div', { class: 'objectives mp-glass i', role: 'status', 'aria-label': def ? `${def.title}: objectives` : 'Mayor’s challenges' },
      pill,
      h('div', { class: 'obj-head' }, h('span', { class: 'obj-badge', html: icon(def ? 'trophy' : 'star', 15) }), h('div', { class: 'obj-heading' }, this.title, this.sub), min),
      def ? this.linesEl : null,
      def ? this.medalsEl : null,
    );
    if (challenges) {
      const value = h('span', { class: 'obj-v' }), fill = h('div', { class: 'fill' });
      const root = h('div', { class: def ? 'obj-ch' : 'obj-ch solo' },
        def ? h('div', { class: 'obj-ch-title' }, 'Mayor’s challenges') : null,
        h('div', { class: 'obj-ch-list' }, ...challenges.list.map((c) => h('span', { class: 'obj-ch-chip', title: c.rule }, c.name))),
        h('div', { class: 'obj-line', title: CHALLENGE_BADGE_NOTE }, h('div', { class: 'obj-row' }, h('span', { class: 'obj-l' }, 'Badges'), value), h('div', { class: 'bar' }, fill)),
      );
      this.chEls = { root, value, fill, width: '' };
      el.appendChild(root);
    }
    return el;
  }

  setMinimised(on: boolean, remember = true): void {
    this.minimised = on;
    if (this.el) toggleClass(this.el, 'min', on);
    if (remember) savePref(PREF, { min: on });
  }

  private paintMotion(): void {
    if (this.el) toggleClass(this.el, 'reduced-motion', resolveMotion(this.ctx.settings.motion) === 'reduced');
  }

  // ------------------------------------------------------------------------------------------------ judging
  /** cheap: has anything an evaluation reads changed since the last one? then judge again; and open a waiting card */
  private tick(): void {
    if (this.disposed) return;
    const st = this.ctx.state, t = st.history.t, b = st.budget;
    const s = this.seen;
    if (t.length !== s.samples || (t.length ? t[t.length - 1] : -1) !== s.last || Math.floor(st.day / 30) !== s.month
      || b.loans.length !== s.loans || ((b.curIncome['oneoff:loan'] ?? 0) > 0) !== s.proceeds) this.refresh();
    if ((this.briefing || this.pending) && !this.modal && !this.otherDialog()) {
      // the briefing first; a decided outcome also waits for the New Year show and a LIVE emergency
      if (this.briefing) this.showBriefing();
      else if (!this.ctx.newYearBusy?.() && !this.ctx.host.policy.live) this.showResult();
    }
  }

  /**
   * Another dialog is open over the city: a confirmation or the storage dialog (the two the scene's own key handler
   * steps back for) or the pause menu. It has the keys, and the briefing and the result card wait until it is closed.
   */
  private otherDialog(): boolean {
    if (confirmOpen() || storageDialogOpen()) return true;
    const mine = this.modal?.el;
    for (const el of Array.from(this.ctx.root.querySelectorAll('.modal-back'))) if (el !== mine) return true;
    return false;
  }

  private refresh(): void {
    if (this.disposed || !this.el) return;
    const st = this.ctx.state, t = st.history.t, b = st.budget;
    this.seen = {
      samples: t.length, last: t.length ? t[t.length - 1] : -1, month: Math.floor(st.day / 30), loans: b.loans.length,
      proceeds: (b.curIncome['oneoff:loan'] ?? 0) > 0,
    };
    if (this.start) {
      const s = evaluateScenario(this.start, st, this.memo);
      if (s.newLoan && !this.memo.newLoan) {
        this.memo.newLoan = true;
        recordScenarioRun(this.key, s.id, this.memo);
      }
      if (s.result && !this.memo.result) {
        const previous = loadMedals()[s.id]?.medal ?? null;
        this.memo.result = s.result;
        this.pending = { status: s, best: recordScenarioRun(this.key, s.id, this.memo), previous };
      }
      // a medal secured while the scenario runs on (Boomtown's tiers) is said once, when it happens
      const secured = s.phase === 'active' ? medalRank(s.medal) : 0;
      if (this.secured >= 0 && secured > this.secured) {
        this.ctx.toast(`${MEDAL_NAMES[s.medal!]} is secured: ${SCENARIOS[s.id].goals[s.medal!]}.`, 'good', undefined, SCENARIOS[s.id].title);
      }
      this.secured = secured;
      this.status = s;
      this.paintScenario(s);
    }
    this.paintChallenges(challengeStatus(st));
    this.paintMotion();
  }

  private paintScenario(s: ScenarioStatus): void {
    const def = SCENARIOS[s.id];
    const state = s.phase === 'won' ? `${MEDAL_NAMES[s.medal!]} medal` : s.phase === 'lost' ? 'Not reached'
      : s.medal ? `${MEDAL_NAMES[s.medal]} secured` : s.reach ? `${MEDAL_NAMES[s.reach]} in reach` : '';
    setText(this.sub, s.phase === 'active' ? `${s.clock}${state ? ` · ${state}` : ''}` : state);
    setText(this.pillText, s.phase === 'active' ? `${def.title} · ${s.headline}` : `${def.title} · ${state}`);
    toggleClass(this.el!, 'won', s.phase === 'won');
    toggleClass(this.el!, 'lost', s.phase === 'lost');
    s.lines.forEach((line, k) => {
      let e = this.lines[k];
      if (!e) {
        const label = h('span', { class: 'obj-l' }), value = h('span', { class: 'obj-v' }), fill = h('div', { class: 'fill' });
        const row = h('div', { class: 'obj-line' }, h('div', { class: 'obj-row' }, label, value), h('div', { class: 'bar' }, fill));
        this.linesEl.appendChild(row);
        e = this.lines[k] = { row, label, value, fill, width: '' };
      }
      setText(e.label, line.label);
      setText(e.value, line.value);
      toggleClass(e.row, 'done', line.done);
      const width = `${Math.round(line.progress * 100)}%`;
      if (width !== e.width) e.fill.style.width = e.width = width;
    });
    // a medal is lit once it is won or secured, dimmed once it is out of reach
    const have = medalRank(s.medal), reach = s.phase === 'active' ? medalRank(s.reach) : have;
    for (const m of MEDALS) {
      const chip = this.medalEls.get(m)!, rank = medalRank(m);
      toggleClass(chip, 'have', s.phase === 'won' ? m === s.medal : rank <= have);
      toggleClass(chip, 'out', rank > Math.max(have, reach) || (s.phase === 'won' && m !== s.medal));
    }
  }

  private paintChallenges(c: ChallengeStatus | null): void {
    const e = this.chEls;
    if (!e || !c) return;
    setText(e.value, c.earned ? 'Earned' : `${num(c.best)} / ${num(c.goal)} residents`);
    toggleClass(e.root, 'earned', c.earned);
    const width = `${Math.round(Math.min(1, c.best / c.goal) * 100)}%`;
    if (width !== e.width) e.fill.style.width = e.width = width;
    if (!this.start) {
      setText(this.sub, c.earned ? 'Badges earned' : `Badges at ${num(c.goal)} residents`);
      setText(this.pillText, c.earned ? 'Challenge badges earned' : `Challenges · ${num(c.best)} / ${num(c.goal)}`);
    }
    if (this.earned === false && c.earned) {
      this.ctx.toast(`${c.list.map((x) => x.name).join(', ')}: the ${c.list.length === 1 ? 'badge is' : 'badges are'} earned. ${c.list.length === 1 ? 'It shows' : 'They show'} on the region card.`, 'good', undefined, 'Mayor’s challenges');
      this.ctx.sound('reward');
    }
    this.earned = c.earned;
  }

  // ------------------------------------------------------------------------------------------------ briefing and result
  private goalRows(id: ScenarioStatus['id']): HTMLElement {
    const def = SCENARIOS[id];
    return h('div', { class: 'obj-goals' }, ...MEDALS.map((m) => h('div', { class: 'obj-goal' }, h('span', { class: `obj-medal ${m} have` }, MEDAL_NAMES[m]), h('span', null, def.goals[m]))));
  }

  /** a centred card over the paused city; `primary` is its main button's action (Enter and Esc take it too) */
  private openModal(card: HTMLElement, primary: () => void): void {
    this.modal?.el.remove();
    this.ctx.host.setSpeed(0, 'pause');
    const back = h('div', { class: 'modal-back obj-back' }, card);
    this.modal = { el: back, primary };
    // (modal: no tool tooltip floats over it, as with the confirmation dialog)
    this.ctx.tip?.hide();
    this.ctx.root.appendChild(back);
    (card.querySelector('.btn.primary') as HTMLElement | null)?.focus();
  }

  /** close the open card; `resume`: back to the speed the game had before it opened */
  private closeModal(resume: boolean): void {
    const m = this.modal;
    if (!m) return;
    this.modal = null;
    m.el.remove();
    if (resume) this.ctx.host.resume('pause');
    this.ctx.sound('dialogClose');
  }

  private button(label: string, ic: Parameters<typeof icon>[0], cls: string, run: () => void): HTMLButtonElement {
    const b = h('button', { class: `btn ${cls}`, type: 'button', html: icon(ic, 15) + `<span>${label}</span>` });
    b.addEventListener('click', run, { signal: this.ctx.signal });
    return b;
  }

  private showBriefing(): void {
    this.briefing = false;
    const def = SCENARIOS[this.start!.id];
    const begin = () => this.closeModal(true);
    const card = h('div', { class: 'modal mp-glass obj-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${def.title}: briefing` },
      h('div', { class: 'obj-card-head' }, h('span', { class: 'obj-badge big', html: icon('trophy', 22) }), h('div', null, h('div', { class: 'obj-eyebrow' }, 'Scenario'), h('h2', null, def.title))),
      h('p', { class: 'obj-text' }, def.brief),
      this.goalRows(def.id),
      h('div', { class: 'obj-actions' }, this.button(def.start === 'found' ? 'Found the city' : 'Take office', 'play', 'primary', begin)),
    );
    this.openModal(card, begin);
    this.ctx.sound('dialogOpen');
  }

  private showResult(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    const s = p.status, def = SCENARIOS[s.id], result = s.result!;
    const medal = result.medal;
    const best = !medal ? (p.previous ? `Your best stays ${MEDAL_NAMES[p.previous]}.` : 'Start it again from Challenges on the title screen.')
      : p.best ? (p.previous ? `A new best: your ${MEDAL_NAMES[p.previous]} medal is now ${MEDAL_NAMES[medal]}.` : 'Your first medal in this scenario.')
        : p.previous && medalRank(p.previous) > medalRank(medal) ? `Your best stays ${MEDAL_NAMES[p.previous]}.` : 'Your best medal stands.';
    const keep = () => this.closeModal(true);
    const card = h('div', { class: `modal mp-glass obj-card obj-result ${medal ?? 'lost'}`, role: 'alertdialog', 'aria-modal': 'true', 'aria-label': `${def.title}: ${medal ? `${MEDAL_NAMES[medal]} medal` : 'not reached'}` },
      h('div', { class: 'obj-card-head' }, h('span', { class: `obj-badge big ${medal ?? 'lost'}`, html: icon(medal ? 'trophy' : 'clock', 22) }),
        h('div', null, h('div', { class: 'obj-eyebrow' }, def.title), h('h2', null, medal ? `${MEDAL_NAMES[medal]} medal` : 'Out of time'))),
      h('p', { class: 'obj-text' }, resultText(s.id, result, s.newLoan)),
      h('p', { class: 'obj-text dim' }, best),
      h('div', { class: 'obj-actions' },
        this.button('Keep playing', 'play', 'primary', keep),
        this.button('Exit to region', 'region', '', () => {
          this.closeModal(false);
          void this.ctx.exitToRegion();
        })),
    );
    this.openModal(card, keep);
    this.ctx.sound(medal ? 'reward' : 'dialogOpen');
  }

  /**
   * While a briefing or result card is open no hotkey of the game runs under it (Space and the speed keys would unpause
   * the city behind it). Esc is its main button, and so is Enter unless another button of the card has the focus (then
   * Enter is that button's own click).
   */
  private onKey(e: KeyboardEvent): void {
    const m = this.modal;
    if (!m || this.disposed || this.otherDialog()) return;
    e.stopImmediatePropagation();
    if (e.key !== 'Enter' && e.key !== 'Escape' && e.key !== ' ') return;
    const focused = typeof document !== 'undefined' ? document.activeElement : null;
    const onButton = !!focused && focused.tagName === 'BUTTON' && m.el.contains(focused);
    // (a focused button of the card keeps Enter and Space: the browser clicks it)
    if (e.key !== 'Escape' && onButton) return;
    e.preventDefault();
    if (e.key !== ' ' && !e.repeat) m.primary();
  }
}
