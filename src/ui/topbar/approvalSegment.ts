/**
 * The top bar's approval segment (POLISH_PLAN §7.3: GUIDE's, from the round-1 TopBar split): the score and its face, and
 * the hover card of the biggest approval terms, each row opening its fix (FH-06's model in approvalGuide.ts); a click
 * anywhere else opens the advisors.
 */
import type { GameContext, PanelsApi } from '../../game/context';
import type { CityState } from '../../sim/CityState';
import { DAYS_PER_MONTH } from '../../core/constants';
import { clear, h, setText } from '../dom';
import { icon } from '../icons';
import { APPROVAL_LABELS, approvalBreakdown } from '../../sim/economy/approval';
import { APPROVAL } from '../../sim/economy/tuning';
import { NO_RESIDENTS_TEXT, approvalFix, approvalFixHint, approvalHud, newTownFooter } from './approvalGuide';
import { HudChip } from './hudChip';

/** FEEL-03 (d): how long the approval chip shows (ms) */
export const APPROVAL_CHIP_MS = 3000;
/** FEEL-03 (d): the least a term must move the shown approval in a month for the chip to name it (points) */
export const APPROVAL_CAUSE_MIN = 0.25;

/**
 * FEEL-03 (d): which term moved the shown approval this month.
 * - The sim moves approval each month by APPROVAL.ema of its gap to raw, and raw is the sum of the terms
 *   (src/sim/economy/approval.ts). That rule is linear, so each term has a share of the shown approval that follows the
 *   same rule (share += ema × (term − share)), and a month's move of the shown approval is the sum of the shares' moves.
 * - So after a tax raise approval keeps falling for months, by the tax term's share catching up with the term. A term
 *   that improved meanwhile pushes approval up, and is never named for the fall.
 * - A term is named only when its share moved approval by APPROVAL_CAUSE_MIN or more in approval's direction, and by
 *   more than the part the shares do not explain: approval from before the city was opened, loaded or resynced (its gap
 *   to the terms' sum then is unknown history, which fades as the sim smooths it away). Else the chip shows the number
 *   alone. `clamp` (the 0-100 limit) and the constant `base` are never named.
 * - Terms and values only: approvalBreakdown's detail lines differ on a replica (src/worker/replicaSafe.ts). The values
 *   are copied, because a replica fills one terms object in place (NOTE-092).
 */
export class ApprovalCauses {
  /** each term's share of the shown approval (null: nothing to start from yet) */
  private shares: Record<string, number> | null = null;
  /** the shown approval (unrounded) at the last reset or month */
  private ap = 0;

  /** start over from this month's terms and approval (a city opened, loaded or resynced) */
  reset(terms: Readonly<Record<string, number>> | null | undefined, ap: number): void {
    this.shares = terms ? { ...terms } : null;
    this.ap = ap;
  }

  /**
   * `months` month ticks after the last call (more than one when the HUD missed a tick), at `terms` and approval `ap`:
   * the id of the term whose share moved approval most in the direction of `shown` (the shown change; 0: none), or null
   */
  step(terms: Readonly<Record<string, number>> | null | undefined, ap: number, months: number, shown: number): string | null {
    const s = this.shares;
    if (!s || !terms) {
      this.reset(terms, ap);
      return null;
    }
    const moved = ap - this.ap, dir = Math.sign(shown);
    this.ap = ap;
    const f = 1 - (1 - APPROVAL.ema) ** Math.max(1, months);
    let best: string | null = null, bestV = 0, explained = 0;
    for (const id of new Set([...Object.keys(s), ...Object.keys(terms)])) {
      const d = f * ((terms[id] ?? 0) - (s[id] ?? 0));
      s[id] = (s[id] ?? 0) + d;
      explained += d;
      if (id !== 'clamp' && id !== 'base' && d * dir > bestV) {
        bestV = d * dir;
        best = id;
      }
    }
    return best !== null && bestV >= APPROVAL_CAUSE_MIN && bestV > (moved - explained) * dir ? best : null;
  }
}

/** FEEL-03 (d): the chip's text, "−2 · Residential taxes" (`d`: the displayed approval's change, whole points) */
export function approvalChipText(d: number, term: string | null): string {
  return `${d > 0 ? '+' : '−'}${Math.abs(d)}${term ? ` · ${term}` : ''}`;
}

export class ApprovalSegment {
  readonly el: HTMLElement;
  private apprEl: HTMLElement;
  /** approval terms object the tooltip was built from (a new object each month on the main-thread host only) */
  private apprTerms: unknown = null;
  /** T065: the terms' content the tooltip was built from, re-read once per sim day (a replica keeps the object) */
  private apprKey = '';
  private apprDay = -1;
  /** population band the card was built for (FH-06: no residents yet / a new town / from 10,000) */
  private apprBand = -1;
  private apprPop: HTMLElement;
  /** FEEL-03 (d): the approval chip, the month of the last tick (-1: none yet), the displayed approval at that tick
   *  (null: no score shown), and where approval's moves come from (the terms' shares) */
  readonly chip: HudChip;
  private chipMonth = -1;
  /** the state the month was read from (a load or a replica's resync replaces it: no chip for that) */
  private chipOf: object | null = null;
  private chipAp: number | null = null;
  private readonly causes = new ApprovalCauses();

  constructor(private ctx: GameContext) {
    this.apprEl = h('div', { class: 'hud-value' });
    this.chip = new HudChip(ctx, 'appr');
    // hover card: why approval is where it is (approvalBreakdown, rebuilt monthly); the plain title is the fallback
    this.apprPop = h('div', { class: 'appr-pop mp-glass' });
    this.el = h('div', { class: 'hud-seg click approval', title: 'Mayor approval — advisors (N)' }, h('span', { class: 'ico-wrap', html: icon('smile', 20) }), h('div', { class: 'hud-stack' }, h('div', { class: 'hud-label' }, 'Approval'), this.apprEl, this.chip.el), this.apprPop);
    // FH-06: a card row with a fix opens it (one delegated listener: the rows are rebuilt monthly); anywhere else, the advisors
    this.el.addEventListener('click', (e) => {
      if (this.openApprovalFix(e.target)) return;
      this.ctx.panels.toggle('advisors');
    }, { signal: this.ctx.signal });
    // a fix that opens a panel or a toolbar tab hides the card until the pointer leaves (it would cover what it opened)
    this.el.addEventListener('pointerleave', () => { delete this.el.dataset.dismissed; }, { signal: this.ctx.signal });
  }

  /** FH-06: open the fix of the approval row under `target` (a data view, Budget · Taxes or the Parks tab); false: none */
  private openApprovalFix(target: EventTarget | null): boolean {
    let id: string | undefined;
    for (let n = target as HTMLElement | null; n && n !== this.el; n = n.parentElement) {
      if (n.dataset?.fix) { id = n.dataset.fix; break; }
    }
    const ctx = this.ctx;
    const fix = id ? approvalFix(id, ctx.overlay) : null;
    if (!fix) return false;
    if (fix.kind === 'view') {
      if (ctx.overlay !== fix.overlay) ctx.sound('overlay');
      ctx.setOverlay(fix.overlay, fix.variant);
    } else if (fix.kind === 'budget') {
      ctx.panels.open('budget');
      const budget = (ctx.panels as PanelsApi & { get?(id: string): unknown }).get?.('budget') as { showTab?(t: 'taxes'): void } | undefined;
      budget?.showTab?.(fix.tab);
      this.el.dataset.dismissed = '1';
    } else {
      ctx.openFlyout?.(fix.category);
      this.el.dataset.dismissed = '1';
    }
    return true;
  }

  /** approval (FH-06: "—" before the first residents; kinder faces in a new town) */
  update(): void {
    const st = this.ctx.state;
    const pop = st.stats.population;
    const ap = st.stats.approval ?? 50;
    const hud = approvalHud(ap, pop);
    setText(this.apprEl, hud.value);
    const want = `hud-seg click approval ${hud.cls}`;
    if (this.el.className !== want || this.el.dataset.face !== hud.face) {
      this.el.className = want;
      this.el.dataset.face = hud.face;
      (this.el.firstElementChild as HTMLElement).innerHTML = icon(hud.face, 20);
    }
    // why: the biggest approval terms of the last monthly update (sim-core approvalBreakdown, WP4), rebuilt monthly
    const eco = st.systemData.economy as { approvalTerms?: Record<string, number>; approvalRaw?: number } | undefined;
    // T065: a replica host (worker, loopback) merges each month's terms into the same object (mergePlain keeps
    // identities), so the identity test alone never fires there; a content key, built only on a new sim day, does
    const terms = eco?.approvalTerms;
    let key = this.apprKey;
    if (terms !== this.apprTerms || st.day !== this.apprDay) {
      this.apprDay = st.day;
      key = '';
      for (const id in terms) key += `${id}:${terms[id]};`;
    }
    if (terms !== this.apprTerms || key !== this.apprKey || hud.band !== this.apprBand) {
      this.apprTerms = terms;
      this.apprKey = key;
      this.apprBand = hud.band;
      let tip = 'Mayor approval — advisors (N)';
      clear(this.apprPop);
      try {
        const br = approvalBreakdown(st).filter((t) => t.id !== 'clamp');
        if (hud.band === 0) {
          // nobody to ask yet: no score and no rows, just what starts it
          tip = '';
          this.apprPop.append(
            h('div', { class: 'ap-h' }, h('b', null, 'Approval —')),
            h('div', { class: 'ap-note' }, `${NO_RESIDENTS_TEXT}.`),
            h('div', { class: 'ap-f' }, 'Click for your advisors (N)'),
          );
        } else if (br.length > 1) {
          // the styled card replaces the native title (no double tooltip)
          tip = '';
          const top = br.slice(0, 10);
          const max = Math.max(1, ...top.map((t) => Math.abs(t.value)));
          this.apprPop.append(
            h('div', { class: 'ap-h' }, h('b', null, `Approval ${Math.round(ap)}%`), h('span', { class: 'faint' }, ` heading for ${Math.round(eco?.approvalRaw ?? ap)}%`)),
            ...top.map((t) => {
              const a = Math.min(1, Math.abs(t.value) / max);
              const hint = approvalFixHint(t.id);
              return h('div', { class: 'ap-r' + (hint ? ' fix' : ''), title: hint ? `${t.detail ? t.detail + '. ' : ''}${hint}` : t.detail ?? '', dataset: hint ? { fix: t.id } : undefined },
                h('span', { class: 'l' }, t.label),
                h('span', { class: 't' }, h('i', { class: t.value >= 0 ? 'p' : 'n', style: { width: `${a * 50}%`, left: t.value >= 0 ? '50%' : `${50 - a * 50}%` } }), h('b')),
                h('span', { class: 'v ' + (t.value >= 0 ? 'pos' : 'neg') }, `${t.value >= 0 ? '+' : '−'}${Math.abs(t.value).toFixed(1)}`),
                t.detail ? h('span', { class: 'd' }, t.detail) : null);
            }),
            ...(hud.band === 1 ? [h('div', { class: 'ap-note' }, newTownFooter(st.config.difficulty))] : []),
            h('div', { class: 'ap-f' }, 'Click a row to open its fix; anywhere else for your advisors (N)'),
          );
        }
      } catch {
        /* keep the plain title */
      }
      this.el.title = tip;
      this.apprPop.classList.toggle('empty', !this.apprPop.childElementCount);
    }
    this.changeChip(st, ap, hud.band);
  }

  /** FEEL-03 (d): at the month tick, when the displayed approval moved by a point or more, the change and the term that
   *  moved it most (ApprovalCauses; none before the first residents, in a sandbox, or right after the city opened) */
  private changeChip(st: CityState, ap: number, band: number): void {
    const m = Math.floor(st.day / DAYS_PER_MONTH);
    if (m !== this.chipMonth || st !== this.chipOf) {
      const T = (st.systemData.economy as { approvalTerms?: Record<string, number> } | undefined)?.approvalTerms;
      const shown = band > 0 && !st.config.sandbox ? Math.round(ap) : null;
      if (this.chipMonth < 0 || st !== this.chipOf || m < this.chipMonth) {
        // the city opened, or a load or a replica's resync replaced the state: a new baseline, no chip
        this.causes.reset(T, ap);
      } else {
        // (the shares follow every month, shown or not, so that the first chip after the first residents is right)
        const d = shown !== null && this.chipAp !== null ? shown - this.chipAp : 0;
        const cause = this.causes.step(T, ap, m - this.chipMonth, d);
        if (Math.abs(d) >= 1) this.chip.show(approvalChipText(d, cause === null ? null : APPROVAL_LABELS[cause] ?? cause), d > 0 ? 'pos' : 'neg', APPROVAL_CHIP_MS);
      }
      this.chipMonth = m;
      this.chipOf = st;
      this.chipAp = shown;
    }
    this.chip.tick();
  }
}
