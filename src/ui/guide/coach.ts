/** Coach targets for the CityScene / TopBar / inspector owners to connect without DOM reach-ins. */
import type { GameContext, PanelsApi } from '../../game/context';
import type { Overlay } from '../../core/types';
import { approvalFix } from '../topbar/approvalGuide';

export interface CoachTarget {
  categories: string[];
  items?: string[];
  play?: boolean;
  control?: 'rci' | 'budget' | 'approval' | 'dataviews' | 'why' | 'rewards';
  family?: 'R' | 'C' | 'I';
}

export interface GuideHooks {
  coach: (categories: string[], play: boolean) => void;
  /** Added by the deferred Toolbar / TopBar wiring. */
  mark?: (target: CoachTarget | null) => void;
  /** InfoPanel opens Why? on its next growable query, then reports the actual expansion. */
  openWhy?: () => void;
  /** FH-06 supplies the same term-specific action used by its approval rows. */
  approvalFix?: (term: string) => GuideAction | null;
  /** NewYear owns this gate. Explainers wait for the gate to be wired. */
  celebrating?: () => boolean;
}

export interface GuideAction {
  label: string;
  icon: string;
  coach: CoachTarget;
  run: (ctx: GameContext) => void;
}

/** Reuse the approval rows' mapping so the explainer opens the same fix. */
export function approvalAction(term: string, current: Overlay): GuideAction | null {
  const fix = approvalFix(term, current);
  if (!fix) return null;
  return { label: `Open ${fix.label}`, icon: 'approval', coach: { categories: [], control: 'approval' }, run: (ctx) => {
    if (fix.kind === 'view') ctx.setOverlay(fix.overlay, fix.variant);
    else if (fix.kind === 'flyout') ctx.openFlyout?.(fix.category);
    else openTaxes(ctx);
  } };
}

export function openTaxes(ctx: GameContext): void {
  const panel = (ctx.panels as PanelsApi & { get?(id: string): unknown }).get?.('budget') as { showTab?(tab: 'taxes'): void } | undefined;
  panel?.showTab?.('taxes');
  ctx.panels.open('budget');
}

export function toolAction(label: string, icon: string, tool: string, category: string, tab?: string): GuideAction {
  return { label, icon, coach: { categories: [category], items: [tool] }, run: (ctx) => {
    ctx.openFlyout?.(category, tab);
    ctx.tools.select(tool);
  } };
}

export function viewAction(label: string, icon: string, category: string, tab: string, overlay: Overlay): GuideAction {
  return { label, icon, coach: { categories: [category] }, run: (ctx) => {
    ctx.openFlyout?.(category, tab);
    ctx.setOverlay(overlay);
  } };
}
