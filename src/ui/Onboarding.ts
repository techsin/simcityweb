/** Founding steps, first-year goals and the shared once-per-profile explainer queue. */
import { Network, Overlay } from '../core/types';
import type { GameContext } from '../game/context';
import { getDef } from '../sim/catalog';
import { APPROVAL_LABELS } from '../sim/economy/approval';
import type { LandfillInfo } from '../sim/infra/pollution';
import { watchFor, type QueryResult, type WatchHandle } from '../worker/SimHost';
import { h, setText, toggleClass } from './dom';
import { icon } from './icons';
import { guideCopy, type ZoneTargets } from './guide/copy';
import { type GuideAction, type GuideHooks, toolAction, viewAction } from './guide/coach';
import { edgeHint } from './guide/edgeHint';
import { ExplainerQueue, type Explainer } from './guide/explainers';
import { accessibleZones, foundingDone, fuelPlant, hasCategory, WIND_START, zoneTargets } from './guide/founding';
import { advanceGoals, approvalTerms, goalFacts, goalPresentation, landfillSites, trackBudget, trackPower, visibleGoals, type GoalFacts } from './guide/goals';
import { FOUNDING_IDS, GOAL_IDS, loadGuideProfile, newProgress, readProgress, saveGuideProfile,
  type FoundingId, type GoalId, type GuideId, type GuideProgress } from './guide/progress';
import './guide/onboarding.css';

interface Row {
  el: HTMLElement;
  num: HTMLElement;
  title: HTMLElement;
  sub: HTMLElement;
  button: HTMLButtonElement;
  action: GuideAction;
}

export class Onboarding {
  readonly el: HTMLDivElement;
  private rows = new Map<GuideId, Row>();
  private progressText!: HTMLElement;
  private title!: HTMLElement;
  private subtitle!: HTMLElement;
  private pillText!: HTMLElement;
  private dismissal!: HTMLElement;
  private tip!: HTMLElement;
  private tipText!: HTMLElement;
  private tipAction!: HTMLButtonElement;
  private visible = false;
  private primed = false;
  private acc = 1;
  private lastCheck = -Infinity;
  private lastFacts = -Infinity;
  private facts: GoalFacts;
  private targets: ZoneTargets;
  private p: GuideProgress;
  private profile = loadGuideProfile();
  private explainers: ExplainerQueue;
  private budgetWatch?: WatchHandle<QueryResult<'computeMonthlyBudget'>>;
  private caps?: WatchHandle<QueryResult<'capHints'>>;
  private landfill: LandfillInfo[] = [];
  private landfillPending = false;
  private landfillEpoch = 0;
  private viewSince: number | null = null;
  private hintShown = false;
  private pauseRestore: number | null = null;
  private changingSpeed = false;
  private completions: { text: string; title: string; cell?: { x: number; z: number }; reward?: boolean }[] = [];

  constructor(private ctx: GameContext, parent: HTMLElement, private hooks: GuideHooks) {
    const st = ctx.host.state, saved = readProgress(st.systemData.onboarding, st.day);
    this.p = saved ?? newProgress(st.day);
    if (!saved) this.p.minimised = this.profile.min;
    this.targets = zoneTargets(st);
    this.facts = goalFacts(ctx.host);
    this.lastFacts = performance.now();
    this.explainers = new ExplainerQueue(this.profile, this.p);
    this.el = h('div', { class: 'onboard mp-glass i' });
    parent.prepend(this.el);
    this.build();
    this.setMinimised(this.p.minimised, false);
    const offs = [
      ctx.host.events.on('day', () => trackPower(ctx.host.state, this.p)),
      ctx.host.events.on('month', () => trackBudget(ctx.host.state, this.p)),
      ctx.host.events.on('speedChanged', () => { if (!this.changingSpeed) this.pauseRestore = null; }),
      ctx.host.events.on('zoneChanged', () => { this.landfillEpoch++; this.landfill = []; }),
      ctx.host.events.on('terrainChanged', () => { this.targets = zoneTargets(ctx.host.state); this.clearHint(); }),
      // ToolController has already cleared the old tool and drawn the next preview when this event arrives.
      ctx.ui.on('tool', () => { this.hintShown = false; }),
      ctx.ui.on('panel', ({ id, open }) => { if (id === 'budget' && open) this.p.budgetOpened = true; }),
      ctx.ui.on('overlay', (overlay) => { this.viewSince = overlay === Overlay.None ? null : performance.now(); }),
      ctx.ui.on('query', (target) => {
        if (!this.visible || this.p.whyOpened) return;
        const b = target?.buildingId == null ? undefined : ctx.host.state.buildings.get(target.buildingId);
        const def = b && getDef(b.def);
        if (!this.p.whyOpened && def?.devType !== undefined && def.devType <= 2) this.hooks.openWhy?.();
      }),
    ];
    for (const event of ['pointerdown', 'pointermove']) ctx.canvas.addEventListener(event, () => this.clearHint(), { capture: true, signal: ctx.signal });
    const dispose = () => {
      for (const off of offs) off();
      this.visible = false;
      this.pauseRestore = null;
      this.landfillEpoch++;
      this.explainers.clear();
      this.completions = [];
      this.clearHint();
      this.coach(null);
    };
    if (ctx.signal.aborted) dispose();
    else ctx.signal.addEventListener('abort', dispose, { once: true });
    const young = st.stats.population < 300 && st.buildings.size < 40;
    if (!ctx.signal.aborted && !this.profile.dismissedAll && !this.profile.veteran && !this.p.dismissed && (saved || young)) this.show(false);
  }

  /** Detached data for FH-22's host command (not yet present on the W0.3–5 base). No replica writes here. */
  get progress(): GuideProgress { return structuredClone(this.p); }
  get isMinimised(): boolean { return this.p.minimised; }
  get isVisible(): boolean { return this.visible; }

  /** Help reopens the current phase without resetting any completed step. */
  show(sound = true): void {
    if (this.ctx.signal.aborted) return;
    if (sound && !this.visible) this.ctx.sound('open');
    this.visible = true;
    this.p.dismissed = false;
    this.acc = 1;
    this.frame(0);
  }

  hide(remember: boolean): void {
    this.visible = false;
    if (remember) this.p.dismissed = true;
    this.el.classList.remove('show');
    this.dismissal.hidden = true;
    this.closeExplainer();
    this.budgetWatch?.dispose(); this.budgetWatch = undefined;
    this.caps?.dispose(); this.caps = undefined;
    this.landfillEpoch++;
    this.lastFacts = -Infinity;
    this.clearHint();
    this.coach(null);
  }

  setMinimised(on: boolean, remember = true): void {
    this.p.minimised = on;
    toggleClass(this.el, 'min', on);
    if (remember) { this.profile.min = on; saveGuideProfile(this.profile); }
    if (on) { this.clearHint(); this.coach(null); }
  }

  /** Inspector owner calls this after expanding Why?, not merely after a Query click. */
  whyExpanded(buildingId: number): void {
    if (this.ctx.signal.aborted) return;
    const b = this.ctx.host.state.buildings.get(buildingId);
    if (b && getDef(b.def)?.category === 'growable') this.p.whyOpened = true;
  }

  /** Emergency, finance, news and year-review owners share this queue and its pacing. */
  offerExplainer(tip: Explainer): void { if (!this.ctx.signal.aborted) this.explainers.offer(tip); }

  setTips(on: boolean): void {
    if (this.ctx.signal.aborted) return;
    this.profile.tips = on;
    saveGuideProfile(this.profile);
    if (!on) { this.closeExplainer(); this.explainers.clear(); this.caps?.dispose(); this.caps = undefined; }
  }

  private coach(action: GuideAction | null): void {
    const target = action?.coach ?? null;
    this.hooks.coach(target?.categories ?? [], !!target?.play);
    this.hooks.mark?.(target);
  }

  private clearHint(): void {
    if (!this.hintShown) return;
    this.hintShown = false;
    this.ctx.world.setHighlight(null);
  }

  private roadHint(): void {
    const path = edgeHint(this.ctx.host.state);
    if (!path.length || !this.ctx.host.preview.buildNetwork(path, Network.Road).ok) return;
    this.ctx.world.setHighlight(path.map((cell) => ({ ...cell, ok: true })));
    this.hintShown = true;
  }

  private founding(id: FoundingId): { title: string; text: string[]; action: GuideAction } {
    const b = guideCopy.phaseB, a = guideCopy.actions;
    switch (id) {
      case 'road': return { title: b.B1Title(), text: [b.B1(), b.B1Hint()], action: {
        ...toolAction(a.Road(), 'road', 'net:2', 'transport'), run: (ctx) => { ctx.tools.select('net:2'); this.roadHint(); },
      } };
      case 'zones': {
        const action = toolAction(a.Zones(), 'zones', 'zone:1', 'zones');
        action.coach.items = ['zone:1', 'zone:4', 'zone:8'];
        return { title: b.B2Title(), text: [b.B2(this.targets), b.B2Cost()], action };
      }
      case 'power': return { title: b.B3Title(), text: [b.B3(WIND_START), b.B3Output(WIND_START), b.B3Roads()],
        action: toolAction(a.Wind(), 'power', 'plop:util_wind_turbine', 'utilities', 'power') };
      case 'water': return { title: b.B4Title(), text: [b.B4(), b.B4Pipes()], action: toolAction(a.Water(), 'waterTower', 'plop:util_water_tower', 'utilities', 'water') };
      case 'play': return { title: b.B5Title(), text: [b.B5()], action: { label: a.Play(), icon: 'play', coach: { categories: [], play: true }, run: (ctx) => {
        if (!FOUNDING_IDS.slice(0, 4).every((step) => this.p.completed.includes(step))) return;
        if (ctx.host.speed !== 1) ctx.sound('speed1');
        ctx.host.setSpeed(1, 'onboarding');
      } } };
    }
  }

  private build(): void {
    const button = (text: string, run: () => void, cls = 'ob-link') => {
      const el = h('button', { type: 'button', class: cls }, text);
      el.addEventListener('click', (e) => { e.stopPropagation(); run(); }, { signal: this.ctx.signal });
      return el;
    };
    this.pillText = h('span', { class: 'obp-t' });
    const pill = button('', () => { this.setMinimised(false); this.ctx.sound('open'); this.acc = 1; this.frame(0); }, 'ob-pill');
    pill.title = 'Show your city guide';
    pill.append(h('span', { class: 'ob-badge', html: icon('star', 13) }), this.pillText, h('span', { html: icon('chevDown', 13) }));
    const min = button('−', () => { this.setMinimised(true); this.ctx.sound('close'); }, 'icon-btn ob-min');
    min.title = 'Minimise';
    const close = button('×', () => this.hide(false), 'icon-btn');
    close.title = 'Close guide';
    this.title = h('div', { class: 'ob-title' });
    this.subtitle = h('div', { class: 'ob-sub' });
    this.progressText = h('span', { class: 'ob-prog' });
    const list = h('div', { class: 'ob-steps' });
    for (const id of [...FOUNDING_IDS, ...GOAL_IDS]) {
      const content = FOUNDING_IDS.includes(id as FoundingId) ? this.founding(id as FoundingId) : goalPresentation(id as GoalId, this.ctx.host.state, undefined, this.hooks);
      const num = h('span', { class: 'ob-num' }), title = h('div', { class: 'ob-t' }), sub = h('div', { class: 'ob-s' });
      const btn = button('', () => this.rows.get(id)!.action.run(this.ctx), 'btn sm');
      const el = h('div', { class: 'ob-step', dataset: { guideId: id } }, num, h('div', { class: 'ob-txt' }, title, sub), btn);
      this.rows.set(id, { el, num, title, sub, button: btn, action: content.action });
      list.appendChild(el);
    }
    this.tipText = h('div');
    this.tipAction = button('', () => { this.explainers.current?.action?.run(this.ctx); this.closeExplainer(); }, 'btn sm');
    this.tip = h('div', { class: 'ob-tip', role: 'status' }, this.tipText,
      h('div', { class: 'ob-tip-actions' }, this.tipAction, button(guideCopy.actions.GotIt(), () => this.closeExplainer())));
    this.tip.hidden = true;
    this.dismissal = h('div', { class: 'ob-dismiss' }, h('p', null, 'Hide the guide for this city or all your cities?'),
      button('This city', () => this.hide(true)), button('All cities', () => {
        this.profile.dismissedAll = true;
        this.profile.tips = false;
        saveGuideProfile(this.profile);
        this.hide(true);
      }), button('Cancel', () => { this.dismissal.hidden = true; }));
    this.dismissal.hidden = true;
    this.el.append(pill, h('div', { class: 'ob-head' }, h('span', { class: 'ob-badge', html: icon('star', 15) }),
      h('div', null, this.title, this.subtitle), this.progressText, min, close), list, this.tip, this.dismissal,
      h('div', { class: 'ob-foot' }, h('span', { class: 'faint' }, 'Press F1 any time for help'),
        button("Don't show again", () => { this.dismissal.hidden = false; })));
  }

  private renderRow(id: GuideId, content: { title: string; text: string[]; action: GuideAction }, current: boolean, done: boolean, index: number): void {
    const r = this.rows.get(id)!;
    r.el.hidden = false;
    r.action = content.action;
    toggleClass(r.el, 'done', done);
    toggleClass(r.el, 'current', current);
    toggleClass(r.el, 'ob-goal', id.startsWith('G'));
    setText(r.num, done ? '✓' : String(index));
    setText(r.title, content.title);
    setText(r.sub, content.text.join('\n'));
    setText(r.button, content.action.label);
    r.button.disabled = done;
    if (id === 'play' && !FOUNDING_IDS.slice(0, 4).every((step) => this.p.completed.includes(step))) {
      r.button.remove();
      setText(r.sub, guideCopy.phaseB.B5Locked());
    } else if (!r.button.parentElement) r.el.appendChild(r.button);
  }

  private renderFounding(): GuideAction | null {
    const st = this.ctx.host.state, b = guideCopy.phaseB;
    const current = FOUNDING_IDS.find((id) => !this.p.completed.includes(id));
    for (const [i, id] of FOUNDING_IDS.entries()) {
      const content = this.founding(id);
      let hint: string | null = null;
      if (id === current) {
        if (id === 'zones') {
          const counts = accessibleZones(st);
          hint = counts.roadless ? b.B2RoadHint() : counts.R < this.targets.R ? b.B2CountHint(this.targets, counts.R) : null;
        }
        if (id === 'power') {
          const selected = this.ctx.tools.activeId?.replace(/^plop:/, ''), def = selected && getDef(selected);
          hint = def && (def.powerOut ?? 0) > 0 && (def.pollution?.air ?? 0) > 0 ? b.B3FuelHint(def.id, WIND_START.residentsPerMW)
            : hasCategory(st, 'power') ? b.B3Hint() : null;
        }
        if (id === 'water' && hasCategory(st, 'water')) hint = b.B4Hint();
      }
      if (hint) content.text.push(hint);
      this.renderRow(id, content, id === current, this.p.completed.includes(id), i + 1);
      toggleClass(this.rows.get(id)!.el, 'hinted', !!hint);
    }
    const n = FOUNDING_IDS.filter((id) => this.p.completed.includes(id)).length;
    setText(this.title, b.BTitle());
    setText(this.subtitle, this.ctx.host.speed === 0 ? b.BPaused() : 'Space pauses while you build.');
    setText(this.progressText, `${n} / ${FOUNDING_IDS.length}`);
    setText(this.pillText, `${n}/${FOUNDING_IDS.length} · ${current ? this.founding(current).title : b.BTitle()}`);
    return current ? this.rows.get(current)!.action : null;
  }

  private refreshLandfill(): void {
    if (this.landfillPending || this.p.phase !== 'year' || this.p.completed.includes('G2') || !this.p.started.includes('G2')) return;
    const epoch = this.landfillEpoch;
    this.landfillPending = true;
    void Promise.all(landfillSites(this.ctx.host.state).map((cell) => this.ctx.host.query('inspectCell', { ...cell, sections: [] })))
      .then((reports) => {
        if (this.ctx.signal.aborted || epoch !== this.landfillEpoch) return;
        this.landfill = reports.flatMap((r) => r?.landfill ? [r.landfill] : []);
        this.acc = 1;
        this.frame(0);
      }).catch(() => { /* a failed query never completes a goal */ }).finally(() => { this.landfillPending = false; });
  }

  private offerTips(): void {
    if (!this.profile.tips || !this.hooks.celebrating) return;
    const st = this.ctx.host.state, b = guideCopy.phaseB, d = guideCopy.phaseD, a = guideCopy.actions;
    const spent = Math.max(0, Object.entries(st.budget.curExpense).reduce((total, [key, amount]) => total + (key.startsWith('oneoff:') && key !== 'oneoff:loanRepay' ? amount : 0), 0)
      - (st.budget.curIncome['oneoff:refund'] ?? 0));
    const founded = typeof st.systemData.foundedDay === 'number' ? st.systemData.foundedDay : 0;
    if (st.day === founded && st.stats.population === 0 && spent > st.config.startFunds * 0.4) {
      this.offerExplainer({ id: 'BSpend', text: [b.BSpend(spent, st.config.startFunds)], priority: 5,
        relevant: () => this.ctx.host.state.stats.population === 0 });
    }
    if (this.p.phase === 'founding') return;
    if (this.facts.brownout) this.offerExplainer({ id: 'E12', text: [d.E12(st.stats), d.E12Fix()], priority: 10,
      action: viewAction(a.Power(), 'power', 'utilities', 'power', Overlay.Power), relevant: () => this.facts.brownout });
    if (!this.profile.seenExplainers.includes('E7')) this.caps ??= watchFor(this.ctx.host, 'capHints', {}, 'daily', this.ctx.signal);
    else { this.caps?.dispose(); this.caps = undefined; }
    const capped = this.caps?.value?.[0];
    if (capped) {
      const family = capped.family;
      const action: GuideAction = family === 'R'
        ? { label: a.Parks(), icon: 'park', coach: { categories: ['parks'], control: 'rci', family }, run: (ctx) => ctx.openFlyout?.('parks') }
        : { label: a.Rewards(), icon: 'reward', coach: { categories: ['landmarks'], control: 'rci', family }, run: (ctx) => ctx.panels.open('rewards') };
      this.offerExplainer({ id: 'E7', text: [family === 'R' ? d.E7Homes() : family === 'C' ? d.E7Shops() : d.E7Industry()], action,
        relevant: () => !!this.caps?.value?.some((hint) => hint.family === family) });
    }
    if (st.stats.approval < 45 && st.stats.population >= 300) {
      const drag = Object.entries(approvalTerms(st)).filter(([, value]) => value < 0).sort((a, b) => a[1] - b[1])[0];
      const action = drag && this.hooks.approvalFix?.(drag[0]);
      if (drag && action) this.offerExplainer({ id: 'E8', text: [d.E8(st.stats.approval, { label: APPROVAL_LABELS[drag[0]] ?? drag[0], value: drag[1] }), d.E8Risk()], action,
        relevant: () => this.ctx.host.state.stats.approval < 45 });
    }
  }

  private closeExplainer(): void {
    this.explainers.close();
    this.tip.hidden = true;
    const restore = this.pauseRestore;
    this.pauseRestore = null;
    if (restore !== null && !this.ctx.signal.aborted && this.ctx.host.speed === 0) this.ctx.host.setSpeed(restore, 'onboarding');
  }

  /** Cheap frame gate: predicates run twice per second; building counters and landfill queries once. */
  frame(dt: number): void {
    if (!this.visible || this.ctx.signal.aborted) return;
    this.acc += dt;
    const now = performance.now();
    if (this.acc < 0.5 && now - this.lastCheck < 500) return;
    this.acc = 0;
    this.lastCheck = now;
    const st = this.ctx.host.state;
    if (now - this.lastFacts >= 1000) {
      this.facts = goalFacts(this.ctx.host);
      this.lastFacts = now;
      this.refreshLandfill();
    }
    const celebrating = this.hooks.celebrating?.() ?? false;
    for (const row of this.rows.values()) row.el.hidden = true;
    let action: GuideAction | null = null, fresh = false;
    if (this.p.phase === 'founding') {
      const done = foundingDone(st, this.p.startDay, this.targets);
      for (const id of FOUNDING_IDS) if (done[id] && !this.p.completed.includes(id)) { this.p.completed.push(id); fresh = true; }
      if (FOUNDING_IDS.every((id) => this.p.completed.includes(id))) {
        this.p.phase = 'year';
        this.clearHint();
        if (this.primed) {
          const plant = hasCategory(st, 'fire') ? undefined : fuelPlant(st);
          this.completions.push({ text: guideCopy.phaseB.BComplete() + (plant ? ' ' + guideCopy.phaseB.BCompleteFire() : ''),
            title: guideCopy.phaseB.BTitle(), reward: true,
            cell: plant ? { x: plant.x + (plant.w >> 1), z: plant.z + (plant.d >> 1) } : undefined });
          fresh = false;
        }
      } else action = this.renderFounding();
    }
    let goals: GoalId[] = [];
    if (this.p.phase !== 'founding') {
      const gained = advanceGoals({ state: st, facts: this.facts, progress: this.p, landfill: this.landfill,
        viewSeconds: this.ctx.overlay !== Overlay.None && this.viewSince !== null ? (now - this.viewSince) / 1000 : 0 });
      fresh ||= gained.length > 0;
      if (this.p.phase === 'year' && this.p.completed.includes('G9')) {
        this.p.phase = 'complete';
        if (this.primed) this.completions.push({ text: guideCopy.phaseC.CComplete(), title: guideCopy.phaseC.CTitle() });
      }
      goals = visibleGoals(this.p);
      if (goals.includes('G5')) this.budgetWatch ??= watchFor(this.ctx.host, 'computeMonthlyBudget', {}, 'daily', this.ctx.signal);
      else { this.budgetWatch?.dispose(); this.budgetWatch = undefined; }
      for (const [i, id] of goals.entries()) {
        this.renderRow(id, goalPresentation(id, st, this.budgetWatch?.value, this.hooks), i === 0, false, GOAL_IDS.indexOf(id) + 1);
        this.rows.get(id)!.el.style.order = String(i);
      }
      action = goals.length ? this.rows.get(goals[0])!.action : null;
      const count = GOAL_IDS.filter((id) => this.p.completed.includes(id)).length;
      setText(this.title, guideCopy.phaseC.CTitle());
      setText(this.subtitle, 'A few goals as your town grows.');
      setText(this.progressText, `${count} / ${GOAL_IDS.length}`);
      setText(this.pillText, guideCopy.phaseC.CProgress(count, GOAL_IDS.length, goals.length ? this.rows.get(goals[0])!.title.textContent ?? '' : guideCopy.phaseC.CTitle()));
    }
    if (fresh && this.primed && !celebrating) this.ctx.sound('stepDone');
    if (!celebrating) for (const completion of this.completions.splice(0)) {
      if (completion.reward) this.ctx.sound('reward');
      this.ctx.toast(completion.text, 'good', completion.cell, completion.title);
    }
    this.primed = true;
    this.offerTips();
    // NewYear's owner must provide its gate before tips can pause or appear over the show.
    const tip = this.hooks.celebrating && !this.p.minimised ? this.explainers.next(st.day, celebrating) : null;
    if (tip) {
      setText(this.tipText, tip.text.join('\n'));
      this.tipAction.hidden = !tip.action;
      if (tip.action) setText(this.tipAction, tip.action.label);
      this.tip.hidden = false;
      if (st.config.difficulty === 'easy' || tip.id === 'E1a') {
        this.pauseRestore = this.ctx.host.speed > 0 ? this.ctx.host.speed : null;
        this.changingSpeed = true;
        try { this.ctx.host.setSpeed(0, 'onboarding'); } finally { this.changingSpeed = false; }
      }
    }
    const shown = !celebrating && (this.p.phase !== 'complete' || goals.length > 0 || !!this.explainers.current);
    toggleClass(this.el, 'show', shown);
    this.coach(shown && !this.p.minimised ? this.explainers.current?.action ?? action : null);
  }
}
