/** Population moments use real time, independent of the simulation speed. */
import './milestone.css';
import type { GameContext } from '../game/context';
import { POP_MILESTONES } from '../game/GameSounds';
import { resolveMotion } from '../game/settings';
import type { NewsItem } from '../sim/CityState';
import { CITY_RANKS, listMilestones, type CityRank } from '../sim/economy/rewards';
import { STAGE_POP } from '../sim/economy/tuning';
import { h } from './dom';

export class MilestoneCard {
  private el = h('div', { class: 'milestone-card mp-glass', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', style: 'display:none' });
  private title = h('div', { class: 'milestone-title' });
  private next = h('div', { class: 'milestone-next' });
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastShown = -Infinity;
  private highest = 0;
  private rank = 0;
  private offs: (() => void)[] = [];
  private disposed = false;
  private abort = () => this.dispose();

  constructor(private ctx: GameContext, parent: HTMLElement, private onRankUp?: (rank: CityRank, intensity: number) => void) {
    if (ctx.signal.aborted) { this.dispose(); return; }
    this.el.append(this.title, this.next);
    parent.appendChild(this.el);
    this.reset();
    this.offs.push(
      ctx.host.events.on('news', (n) => this.onNews(n)),
      ctx.host.events.on('reset', () => this.reset()),
    );
    ctx.signal.addEventListener('abort', this.abort, { once: true });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hide();
    for (const off of this.offs) off();
    this.offs = [];
    this.ctx.signal.removeEventListener('abort', this.abort);
    this.el.remove();
  }

  private hide(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.el.style.display = 'none';
  }

  private reset(): void {
    this.hide();
    const pop = this.ctx.state.stats.population;
    this.highest = POP_MILESTONES.filter((m) => m <= pop).pop() ?? 0;
    this.rank = CITY_RANKS.findIndex((r) => r.id === listMilestones(this.ctx.state).currentRank.id);
  }

  private onNews(n: NewsItem): void {
    if (n.kind !== 'good') return;
    const m = /reaches ([\d,.]+) residents/i.exec(n.text);
    const pop = m ? Number(m[1].replace(/[,.]/g, '')) : 0;
    if (!POP_MILESTONES.includes(pop) || pop <= this.highest) return;
    this.highest = pop;
    let rank = this.rank;
    while (rank + 1 < CITY_RANKS.length && CITY_RANKS[rank + 1].population <= pop) rank++;
    if (rank > this.rank) {
      this.rank = rank;
      if (CITY_RANKS[rank].population === pop && !this.ctx.host.policy.live) this.onRankUp?.(CITY_RANKS[rank], rank / (CITY_RANKS.length - 1));
    }
    const now = performance.now();
    if (this.ctx.host.speed >= 3 && now - this.lastShown < 30_000) return;
    // A visible card always gets four seconds; a burst replaces its contents rather than stacking cards.
    this.hide();
    this.lastShown = now;
    this.title.textContent = `${this.ctx.state.config.name.toLocaleUpperCase('en-US')} · ${pop.toLocaleString('en-US')} RESIDENTS`;
    const milestones = listMilestones(this.ctx.state);
    const stage = STAGE_POP.find((s) => s.pop > pop);
    const nextRank = milestones.nextRank;
    this.next.textContent = stage && (!nextRank || stage.pop < nextRank.population)
      ? `Next: ${stage.stage === 6 ? 'Towers' : stage.stage === 7 ? 'Skyscrapers' : stage.stage === 8 ? 'Supertalls' : 'Taller buildings'} at ${stage.pop.toLocaleString('en-US')} residents`
      : nextRank ? `Next: ${nextRank.name} at ${nextRank.population.toLocaleString('en-US')} residents`
        : `Next: Keep your ${milestones.currentRank.name} thriving`;
    this.el.classList.toggle('reduced-motion', resolveMotion(this.ctx.settings.motion) === 'reduced');
    this.el.style.display = '';
    this.timer = setTimeout(() => this.hide(), 4000);
  }
}
