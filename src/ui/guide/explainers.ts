/** The shared first-time tip queue. Event owners offer tips; only a displayed tip is remembered. */
import { DAYS_PER_MONTH } from '../../core/constants';
import type { GuideAction } from './coach';
import { saveGuideProfile, type GuideProfile, type GuideProgress } from './progress';

export interface Explainer {
  id: string;
  text: string[];
  action?: GuideAction;
  priority?: number;
  /** Persistent problems withdraw their queued tip when they have been fixed. */
  relevant?: () => boolean;
}

export class ExplainerQueue {
  private pending = new Map<string, Explainer>();
  current: Explainer | null = null;

  constructor(private profile: GuideProfile, private progress: GuideProgress) {}

  offer(tip: Explainer): void {
    if (!this.profile.tips || this.profile.seenExplainers.includes(tip.id) || this.current?.id === tip.id) return;
    this.pending.set(tip.id, tip);
  }

  next(day: number, celebrating: boolean): Explainer | null {
    if (!this.profile.tips || celebrating || this.current) return null;
    if (this.progress.lastExplainerDay !== null && day - this.progress.lastExplainerDay < 2 * DAYS_PER_MONTH) return null;
    for (const [id, tip] of this.pending) if (tip.relevant && !tip.relevant()) this.pending.delete(id);
    const tip = [...this.pending.values()].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
    if (!tip) return null;
    this.pending.delete(tip.id);
    this.current = tip;
    this.profile.seenExplainers.push(tip.id);
    this.progress.lastExplainerDay = day;
    saveGuideProfile(this.profile);
    return tip;
  }

  close(): void { this.current = null; }
  clear(): void { this.pending.clear(); this.close(); }
}
