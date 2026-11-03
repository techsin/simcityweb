/**
 * FH-06 (GUIDE): what the top bar's approval segment tells a newcomer. Headless (no DOM), so tests pin it, and the
 * round-1 TopBar split can build the approval segment around it unchanged.
 *  - below APPROVAL_MIN_RESIDENTS the HUD shows "—": nobody lives here yet to approve of anything;
 *  - under NEW_TOWN_RESIDENTS the faces are kinder (a new town sits in the 40s and 50s while it plays correctly) and the
 *    hover card says what is usual; from NEW_TOWN_RESIDENTS today's thresholds apply;
 *  - each approval row with a fix names it, and the top bar opens it on click (a data view, Budget · Taxes or a
 *    toolbar tab). Everything here reads the replica only.
 */
import { Overlay } from '../../core/types';
import { adviceView } from '../advisorModel';
import { overlayInfo } from '../overlays';

/** below this many residents approval shows "—" */
export const APPROVAL_MIN_RESIDENTS = 50;
/** under this many residents the new-town faces and footer apply */
export const NEW_TOWN_RESIDENTS = 10_000;
export const NO_RESIDENTS_TEXT = 'Approval starts with your first residents';
/**
 * FH-06's "usual range", per difficulty, from the bot tables (the risk the plan names: the sentence must stay true).
 * The 10th to 90th percentile of the bot's monthly approval from 50 to 10,000 residents, rounded to 5 (Nov 3; 128 cells,
 * 3 years, seeds 3 / 7 / 11): Easy 56.4–61.5, Medium 50.4–55.6, Hard 46.5–53.1 (docs/dev/reports/local-R1-guide-d.md,
 * "The usual range"). Sandbox keeps Medium's approval rules. Re-check after the final balance pass.
 */
const NEW_TOWN_RANGE: Readonly<Record<string, readonly [number, number]>> = { easy: [55, 60], medium: [50, 55], hard: [45, 55] };

/** the hover card's footer under NEW_TOWN_RESIDENTS: what is usual on this difficulty */
export function newTownFooter(difficulty: string): string {
  const [lo, hi] = NEW_TOWN_RANGE[difficulty] ?? NEW_TOWN_RANGE.medium;
  return `New towns usually sit at ${lo}–${hi}% until police, parks and land value arrive.`;
}

export type ApprovalFace = 'smile' | 'meh' | 'frown';

export interface ApprovalHud {
  /** the HUD value: "64%", or "—" before the first residents */
  value: string;
  /** the face icon */
  face: ApprovalFace;
  /** the segment's colour class ('' good, 'meh', 'bad'; 'none' before the first residents) */
  cls: '' | 'meh' | 'bad' | 'none';
  /** population band: 0 before the first residents, 1 a new town, 2 from NEW_TOWN_RESIDENTS */
  band: 0 | 1 | 2;
}

/** smile / meh / frown for an approval value at a population (new towns: 50 / 35; from 10,000: 60 / 40) */
export function approvalFace(approval: number, population: number): ApprovalFace {
  const newTown = population < NEW_TOWN_RESIDENTS;
  const good = newTown ? 50 : 60, meh = newTown ? 35 : 40;
  return approval >= good ? 'smile' : approval >= meh ? 'meh' : 'frown';
}

export function approvalHud(approval: number, population: number): ApprovalHud {
  if (!(population >= APPROVAL_MIN_RESIDENTS)) return { value: '—', face: 'smile', cls: 'none', band: 0 };
  const face = approvalFace(approval, population);
  return {
    value: `${Math.round(approval)}%`,
    face,
    cls: face === 'smile' ? '' : face === 'meh' ? 'meh' : 'bad',
    band: population < NEW_TOWN_RESIDENTS ? 1 : 2,
  };
}

/** what clicking an approval row opens */
export type ApprovalFix =
  | { kind: 'view'; overlay: Overlay; variant?: number; label: string }
  | { kind: 'budget'; tab: 'taxes'; label: string }
  | { kind: 'flyout'; category: string; label: string };

const view = (overlay: Overlay, variant?: number): ApprovalFix => ({
  kind: 'view', overlay, ...(variant === undefined ? {} : { variant }), label: `${overlayInfo(overlay)?.label ?? 'Data'} view`,
});
/** the service views the "City services at homes" row steps through (police, fire and health coverage at homes) */
const SERVICE_VIEWS: readonly Overlay[] = [Overlay.Police, Overlay.Fire, Overlay.Health];
/** approval term id → the advice whose data view shows that problem (advisorModel.adviceView, the Advisors panel's map) */
const TERM_ADVICE: Readonly<Record<string, string>> = {
  pollution: 'airPollution', noise: 'noise', garbage: 'garbage', commute: 'commute', tapWater: 'tapWater', hq: 'hqLow',
};

/**
 * The fix an approval row opens; null when no single place fixes it (baseline, unemployment, deficit, ...).
 * crime → the Police view (where police patrol: the fix, not the problem); tax → Budget · Taxes; parks → the toolbar's
 * Parks tab; services → the Police view, then Fire, then Health on the next clicks (`current` is the shown data view).
 */
export function approvalFix(id: string, current: Overlay = Overlay.None): ApprovalFix | null {
  switch (id) {
    case 'crime': return view(Overlay.Police);
    case 'tax': return { kind: 'budget', tab: 'taxes', label: 'Budget · Taxes' };
    case 'parks': return { kind: 'flyout', category: 'parks', label: 'Parks tab' };
    case 'services': {
      const i = SERVICE_VIEWS.indexOf(current);
      return view(SERVICE_VIEWS[(i + 1) % SERVICE_VIEWS.length]);
    }
  }
  const advice = TERM_ADVICE[id];
  const v = advice ? adviceView(advice) : null;
  return v ? view(v.overlay, v.variant) : null;
}

/** the row's click hint ("Click: Police view"); null when the row has no fix */
export function approvalFixHint(id: string): string | null {
  if (id === 'services') return 'Click: Police view; click again for Fire, then Health';
  const fix = approvalFix(id);
  return fix ? `Click: ${fix.label}` : null;
}
