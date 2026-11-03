/** Population moments use real time, independent of the simulation speed. */
import './milestone.css';
import type { GameContext } from '../game/context';
import { POP_MILESTONES, populationMilestone } from '../game/milestones';
import { resolveMotion } from '../game/settings';
import type { NewsItem } from '../sim/CityState';
import { CITY_RANKS, listMilestones, type CityRank } from '../sim/economy/rewards';
import { STAGE_POP } from '../sim/economy/tuning';
import { h, setText } from './dom';

/** Let the final alert's exit fade finish before a milestone appears. */
export const ALERT_CLEAR_DELAY_MS = 300;

interface Moment { population: number; rankUp: boolean; remaining: number; interruptions: number; deferred?: boolean }

export class MilestoneCard {
  private el = h('div', { class: 'milestone-card mp-glass', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', style: 'display:none' });
  private title = h('div', { class: 'milestone-title' });
  private next = h('div', { class: 'milestone-next' });
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wake: ReturnType<typeof setTimeout> | null = null;
  private pending: Moment | null = null;
  private active: Moment | null = null;
  private expiresAt = 0;
  private alertsEmptySince: number | null = -Infinity;
  private panels = new Set<string>();
  private lastShown = -Infinity;
  private highest = 0;
  private rank = 0;
  private offs: (() => void)[] = [];
  private disposed = false;
  private abort = () => this.dispose();

  constructor(private ctx: GameContext, private parent: HTMLElement, private onRankUp?: (rank: CityRank, intensity: number) => void, private isBusy: () => boolean = () => false) {
    if (ctx.signal.aborted) { this.dispose(); return; }
    this.el.append(this.title, this.next);
    parent.appendChild(this.el);
    this.reset();
    this.offs.push(
      ctx.host.events.on('news', (n) => this.onNews(n)),
      ctx.host.events.on('reset', () => this.reset()),
      ctx.host.policy.subscribe(() => this.present(), ctx.signal),
      ctx.ui.on('uiTick', () => this.present()),
      ctx.ui.on('panel', ({ id, open }) => {
        if (open) this.panels.add(id);
        else this.panels.delete(id);
        this.present();
      }),
    );
    ctx.signal.addEventListener('abort', this.abort, { once: true });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hide();
    this.clearWake();
    this.pending = null;
    for (const off of this.offs) off();
    this.offs = [];
    this.ctx.signal.removeEventListener('abort', this.abort);
    this.el.remove();
  }

  private hide(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.active = null;
    this.expiresAt = 0;
    this.el.style.display = 'none';
  }

  private clearWake(): void {
    if (this.wake !== null) clearTimeout(this.wake);
    this.wake = null;
  }

  private reset(): void {
    this.hide();
    this.clearWake();
    this.pending = null;
    if (this.ctx.host.policy.alerts.length) this.alertsEmptySince = null;
    else if (this.alertsEmptySince === null) this.alertsEmptySince = performance.now();
    const pop = this.ctx.state.stats.population;
    this.highest = POP_MILESTONES.filter((m) => m <= pop).pop() ?? 0;
    this.rank = CITY_RANKS.findLastIndex((r) => r.population <= pop);
  }

  private onNews(n: NewsItem): void {
    if (n.kind !== 'good') return;
    const pop = populationMilestone(n.text);
    if (pop === null || pop <= this.highest) return;
    this.highest = pop;
    if (this.pending && this.stale(this.pending)) {
      this.pending = null;
      this.clearWake();
    }
    if (this.active && this.stale(this.active)) this.hide();
    let rank = this.rank;
    while (rank + 1 < CITY_RANKS.length && CITY_RANKS[rank + 1].population <= pop) rank++;
    const rankUp = rank > this.rank && CITY_RANKS[rank].population === pop;
    if (rank > this.rank) {
      this.rank = rank;
      if (rankUp && !this.ctx.host.policy.live) this.onRankUp?.(CITY_RANKS[rank], rank / (CITY_RANKS.length - 1));
    }
    this.enqueue({ population: pop, rankUp, remaining: 4000, interruptions: 0 });
    this.present();
  }

  private enqueue(moment: Moment): void {
    if (!this.pending || (moment.rankUp || !this.pending.rankUp) && moment.population >= this.pending.population) this.pending = moment;
  }

  private stale(moment: Moment): boolean {
    return moment.interruptions > 0 && moment.population < this.highest;
  }

  private present(): void {
    if (this.disposed) return;
    const now = performance.now();
    if (this.ctx.host.policy.alerts.length) this.alertsEmptySince = null;
    else if (this.alertsEmptySince === null) this.alertsEmptySince = now;
    if (!this.pending && !this.active) return;
    // Panels can be dragged anywhere, so keep the moment until their contents are clear of it.
    const blocked = this.alertsEmptySince === null || now - this.alertsEmptySince < ALERT_CLEAR_DELAY_MS || this.isBusy() || this.panels.size > 0 || Array.from(this.parent.querySelectorAll('.panel')).some((p) => !p.classList.contains('closing'));
    if (blocked) {
      if (this.active && this.active.interruptions === 0 && this.active.population === this.highest) {
        const remaining = Math.max(0, this.expiresAt - now);
        if (remaining > 0) this.enqueue({ ...this.active, remaining, interruptions: 1, deferred: true });
      }
      if (this.pending) this.pending.deferred = true;
      this.hide();
      this.clearWake();
      return;
    }
    const moment = this.pending;
    if (!moment) {
      if (this.active) this.paint(this.active.population);
      return;
    }
    if (this.stale(moment)) {
      this.pending = null;
      this.clearWake();
      return;
    }
    const wait = 30_000 - (now - this.lastShown);
    if (this.ctx.host.speed >= 3 && wait > 0) {
      if (moment.rankUp && this.active) {
        // Update this card without another entrance or extending its original four-second lifetime.
        moment.remaining = Math.max(0, this.expiresAt - now);
        this.active = moment;
        this.paint(moment.population);
        this.pending = null;
      } else if (moment.rankUp || moment.deferred) {
        if (this.wake === null) this.wake = setTimeout(() => { this.wake = null; this.present(); }, wait);
      } else this.pending = null;
      return;
    }
    this.pending = null;
    this.clearWake();
    this.hide();
    this.lastShown = now;
    this.active = moment;
    this.expiresAt = now + moment.remaining;
    this.paint(moment.population);
    this.el.style.display = '';
    this.timer = setTimeout(() => this.hide(), moment.remaining);
  }

  private paint(pop: number): void {
    setText(this.title, `${this.ctx.state.config.name.toLocaleUpperCase('en-US')} · ${pop.toLocaleString('en-US')} RESIDENTS`);
    const reached = Math.max(pop, this.ctx.state.stats.population);
    const stats = reached === this.ctx.state.stats.population ? this.ctx.state.stats : { ...this.ctx.state.stats, population: reached };
    const milestones = listMilestones({ stats, unlocked: this.ctx.state.unlocked, milestones: this.ctx.state.milestones });
    const stage = STAGE_POP.find((s) => s.pop > reached);
    const nextRank = milestones.nextRank;
    const currentRank = milestones.currentRank;
    const next = stage && (!nextRank || stage.pop < nextRank.population)
      ? `Next: ${stage.stage === 6 ? 'Towers' : stage.stage === 7 ? 'Skyscrapers' : stage.stage === 8 ? 'Supertalls' : 'Taller buildings'} at ${stage.pop.toLocaleString('en-US')} residents`
      : nextRank ? `Next: ${nextRank.name} at ${nextRank.population.toLocaleString('en-US')} residents`
        : `Next: Keep your ${currentRank.name} thriving`;
    setText(this.next, next);
    this.el.classList.toggle('reduced-motion', resolveMotion(this.ctx.settings.motion) === 'reduced');
  }
}
