/** Rank bursts share the city renderer, but never hold or interrupt the New Year show. */
import type { GameContext } from '../game/context';
import { resolveMotion } from '../game/settings';
import type { Fireworks } from '../render/city/effects/Fireworks';
import { CITY_RANKS, type CityRank } from '../sim/economy/rewards';

type RankFireworksView = Pick<Fireworks, 'start' | 'stop' | 'isRankBurst'>;

export class RankFireworks {
  private highest = 0;
  private current: RankFireworksView | null = null;
  private offs: (() => void)[] = [];
  private disposed = false;
  private abort = () => this.dispose();

  constructor(private ctx: GameContext, private isBusy: () => boolean) {
    if (ctx.signal.aborted) { this.dispose(); return; }
    this.reset();
    this.offs.push(
      ctx.host.events.on('reset', () => this.reset()),
      ctx.ui.on('uiTick', () => { if (ctx.host.policy.live || resolveMotion(ctx.settings.motion) === 'reduced') this.cancel(); }),
    );
    ctx.signal.addEventListener('abort', this.abort, { once: true });
  }

  start(rank: CityRank, intensity: number): void {
    const tier = CITY_RANKS.findIndex((r) => r.id === rank.id);
    if (this.disposed || tier <= this.highest) return;
    this.highest = tier;
    if (this.isBusy() || this.ctx.host.policy.live || resolveMotion(this.ctx.settings.motion) === 'reduced') return;
    const fw = (this.ctx.objects as { fireworks?: RankFireworksView }).fireworks;
    if (!fw) return;
    this.current = fw;
    fw.start({ population: rank.population, intensity, duration: 8, rankBurst: true, seed: this.ctx.state.config.seed ^ rank.population });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    for (const off of this.offs) off();
    this.offs = [];
    this.ctx.signal.removeEventListener('abort', this.abort);
  }

  private cancel(): void {
    if (this.current?.isRankBurst) this.current.stop(true);
    this.current = null;
  }

  private reset(): void {
    this.cancel();
    const population = this.ctx.state.stats.population;
    this.highest = CITY_RANKS.findLastIndex((r) => r.population <= population);
  }
}
