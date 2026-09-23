/**
 * "Getting started" card for a player's first city: five steps that tick themselves off from the city state, with
 * buttons that open the right tool and pulsing coach marks on the matching toolbar / top-bar buttons.
 * Dismissal is remembered in localStorage (per browser, not per city).
 */
import { getDef } from '../sim/catalog';
import { zoneFamily, type Zone } from '../core/types';
import { isGrowZone } from '../sim/economy/tuning';
import { infraFlags } from '../sim/economy/runtime';
import type { GameContext } from '../game/context';
import { loadPref, savePref } from '../game/settings';
import { h, setText, toggleClass } from './dom';
import { icon } from './icons';

const PREF = 'onboarding';

interface Step {
  id: string;
  title: string;
  sub: string;
  icon: string;
  /** toolbar categories to highlight while this step is current */
  coach: string[];
  /** highlight the play button */
  coachPlay?: boolean;
  action: string;
  run: (ctx: GameContext) => void;
  done: (ctx: GameContext, o: Onboarding) => boolean;
  /** replaces `sub` while the step is current (e.g. "the plant isn't connected to any zone yet"); null = sub */
  hint?: (ctx: GameContext) => string | null;
}

function edgeRoad(ctx: GameContext): boolean {
  const st = ctx.state;
  if (st.neighborConnections?.length) return true;
  const N = st.size;
  for (let k = 0; k < N; k++) {
    if (st.network[k] || st.network[(N - 1) * N + k] || st.network[k * N] || st.network[k * N + N - 1]) return true;
  }
  return false;
}

function hasCategory(ctx: GameContext, cat: string): boolean {
  for (const b of ctx.state.buildings.values()) {
    const d = getDef(b.def);
    if (d?.category === cat && !/pylon/.test(d.id)) return true;
  }
  return false;
}

/** a growable zoned cell (empty lot or growable building) with the utility flag set: power / water really reaches a zone */
function zoneServed(ctx: GameContext, arr: Uint8Array, cat: string): boolean {
  const st = ctx.state;
  // without the utilities layer (sim-infra not loaded) nothing is ever flagged: a plant of the category is enough
  if (!infraFlags(st).utilities) return hasCategory(ctx, cat);
  const zone = st.zone;
  for (let k = 0; k < st.cells; k++) if (arr[k] && zone[k] && isGrowZone(zone[k])) return true;
  return false;
}

const STEPS: Step[] = [
  {
    id: 'road', title: 'Connect to the region', sub: 'Build a road from the map edge (or highway) into your city.', icon: 'road',
    coach: ['transport'], action: 'Road tool', run: (c) => c.tools.select('net:2'),
    done: (c) => edgeRoad(c),
  },
  {
    id: 'zones', title: 'Zone R, C and I', sub: 'Paint residential, commercial and industrial zones next to roads.', icon: 'zones',
    coach: ['zones'], action: 'Zones', run: (c) => c.openFlyout?.('zones'),
    done: (c) => {
      const st = c.state;
      let r = false, co = false, i = false;
      for (let k = 0; k < st.cells && !(r && co && i); k++) {
        const z = st.zone[k];
        if (!z) continue;
        const f = zoneFamily(z as Zone);
        if (f === 'R') r = true;
        else if (f === 'C') co = true;
        else if (f === 'I') i = true;
      }
      return r && co && i;
    },
  },
  {
    id: 'power', title: 'Place a power plant', sub: 'Buildings need electricity. Roads and power lines carry it.', icon: 'power',
    coach: ['utilities'], action: 'Power', run: (c) => c.openFlyout?.('utilities', 'power'),
    // ticks only once electricity actually reaches a zoned lot (not merely when a plant exists)
    done: (c) => zoneServed(c, c.state.powered, 'power'),
    hint: (c) => (hasCategory(c, 'power') ? 'Your plant isn’t reaching any zone yet — connect it to your zones with roads or power lines.' : null),
  },
  {
    id: 'water', title: 'Add water', sub: 'A water tower or pump next to a road supplies your zones.', icon: 'waterTower',
    coach: ['utilities'], action: 'Water', run: (c) => c.openFlyout?.('utilities', 'water'),
    done: (c) => zoneServed(c, c.state.watered, 'water'),
    hint: (c) => (hasCategory(c, 'water') ? 'No zone gets water yet — the tower / pump must touch a road that runs past your zones.' : null),
  },
  {
    id: 'play', title: 'Press play', sub: 'Unpause the simulation and watch your city grow.', icon: 'play',
    coach: [], coachPlay: true, action: 'Play', run: (c) => (c.sim.speed = 1),
    done: (c, o) => c.sim.speed > 0 && c.state.day > o.startDay,
  },
];

export class Onboarding {
  readonly el: HTMLDivElement;
  private rows: { step: Step; el: HTMLElement; num: HTMLElement; sub: HTMLElement }[] = [];
  /** minimised to a small pill (remembered) */
  private minimised = false;
  private pill!: HTMLElement;
  private pillText!: HTMLElement;
  private progress!: HTMLElement;
  private visible = false;
  private doneAt = -1;
  private acc = 1;
  /** steps already done at the last check (a newly finished step chimes); null until the first check after show() */
  private doneSteps: Set<number> | null = null;
  private constructed = false;
  startDay = 0;

  constructor(private ctx: GameContext, parent: HTMLElement, private hooks: { coach: (cats: string[], play: boolean) => void }) {
    this.el = h('div', { class: 'onboard mp-glass i' });
    parent.prepend(this.el);
    this.build();
    const pref = loadPref<{ dismissed?: boolean; min?: boolean }>(PREF, {});
    this.setMinimised(!!pref.min, false);
    const young = ctx.state.stats.population < 300 && ctx.state.buildings.size < 40;
    if (!pref.dismissed && young) this.show();
    this.constructed = true;
  }

  /** show regardless of the stored dismissal (e.g. from Help) */
  show(): void {
    if (this.constructed && !this.visible) this.ctx.sound('open');
    this.visible = true;
    this.startDay = this.ctx.state.day;
    this.doneAt = -1;
    this.doneSteps = null;
    this.el.classList.add('show');
    this.acc = 1;
    this.frame(0);
  }

  hide(remember: boolean): void {
    this.visible = false;
    this.el.classList.remove('show');
    this.hooks.coach([], false);
    if (remember) savePref(PREF, { ...loadPref<Record<string, unknown>>(PREF, {}), dismissed: true });
  }

  /** collapse the card to a small pill (keeps the map clear at 720p) / expand it again */
  setMinimised(on: boolean, remember = true): void {
    this.minimised = on;
    toggleClass(this.el, 'min', on);
    if (remember) savePref(PREF, { ...loadPref<Record<string, unknown>>(PREF, {}), min: on });
  }

  get isMinimised(): boolean {
    return this.minimised;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  private build(): void {
    const close = h('button', { class: 'icon-btn', title: 'Dismiss', html: icon('close', 14) });
    close.addEventListener('click', () => this.hide(true));
    const min = h('button', { class: 'icon-btn ob-min', title: 'Minimise', html: icon('minus', 14) });
    min.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMinimised(true);
      this.ctx.sound('close');
    });
    // minimised: a small pill with the progress + current step; click to expand
    this.pillText = h('span', { class: 'obp-t' });
    this.pill = h('button', { class: 'ob-pill', title: 'Show the getting-started guide' }, h('span', { class: 'ob-badge', html: icon('star', 13) }), this.pillText, h('span', { class: 'ico-wrap', html: icon('chevDown', 13) }));
    this.pill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setMinimised(false);
      this.ctx.sound('open');
    });
    this.progress = h('span', { class: 'ob-prog' });
    const list = h('div', { class: 'ob-steps' });
    STEPS.forEach((step, i) => {
      const num = h('span', { class: 'ob-num' }, String(i + 1));
      const btn = h('button', { class: 'btn sm', html: icon(step.icon, 13) + `<span>${step.action}</span>` });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // the step's own action sounds (tool select, flyout...); otherwise the delegated generic click plays
        step.run(this.ctx);
      });
      const sub = h('div', { class: 'ob-s' }, step.sub);
      const el = h('div', { class: 'ob-step' }, num, h('div', { class: 'ob-txt' }, h('div', { class: 'ob-t' }, step.title), sub), btn);
      this.rows.push({ step, el, num, sub });
      list.appendChild(el);
    });
    const later = h('button', { class: 'ob-link' }, "Don't show again");
    later.addEventListener('click', () => this.hide(true));
    this.el.append(
      this.pill,
      h('div', { class: 'ob-head' }, h('span', { class: 'ob-badge', html: icon('star', 15) }), h('div', null, h('div', { class: 'ob-title' }, 'Getting started'), h('div', { class: 'ob-sub' }, 'Five steps to a living city')), this.progress, min, close),
      list,
      h('div', { class: 'ob-foot' }, h('span', { class: 'faint' }, 'Press F1 any time for help'), later),
    );
  }

  /** called every frame (cheap: checks run ~2×/s) */
  frame(dt: number): void {
    if (!this.visible) return;
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    let current = -1, doneN = 0;
    this.rows.forEach((r, i) => {
      let done = false;
      try {
        done = r.step.done(this.ctx, this);
      } catch {
        done = false;
      }
      if (done) doneN++;
      else if (current < 0) current = i;
      toggleClass(r.el, 'done', done);
      setText(r.num, done ? '✓' : String(i + 1));
    });
    this.rows.forEach((r, i) => {
      toggleClass(r.el, 'current', i === current);
      let hint: string | null = null;
      if (i === current && r.step.hint) {
        try {
          hint = r.step.hint(this.ctx);
        } catch {
          hint = null;
        }
      }
      setText(r.sub, hint ?? r.step.sub);
      toggleClass(r.el, 'hinted', !!hint);
    });
    // chime when a step gets done (not for steps already done when the card appeared, nor the last one: see below)
    const nowDone = new Set(this.rows.map((r, i) => (r.el.classList.contains('done') ? i : -1)).filter((i) => i >= 0));
    if (this.doneSteps && doneN < STEPS.length) for (const i of nowDone) if (!this.doneSteps.has(i)) {
      this.ctx.sound('stepDone');
      break;
    }
    this.doneSteps = nowDone;
    setText(this.progress, `${doneN} / ${STEPS.length}`);
    setText(this.pillText, current >= 0 ? `${doneN}/${STEPS.length} · ${STEPS[current].title}` : `Getting started ${doneN}/${STEPS.length}`);
    const cur = current >= 0 ? STEPS[current] : null;
    this.hooks.coach(cur ? cur.coach : [], !!cur?.coachPlay);
    if (doneN === STEPS.length) {
      if (this.doneAt < 0) {
        this.doneAt = performance.now();
        this.el.classList.add('complete');
        this.ctx.sound('reward');
        this.ctx.toast("You're all set, Mayor! Watch the RCI meter to see what your city needs next.", 'good', undefined, 'Getting started');
      } else if (performance.now() - this.doneAt > 6000) this.hide(true);
    }
  }
}
