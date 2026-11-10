/**
 * The top bar's approval segment (POLISH_PLAN §7.3: GUIDE's, from the round-1 TopBar split): the score and its face, and
 * the hover card of the biggest approval terms, each row opening its fix (FH-06's model in approvalGuide.ts); a click
 * anywhere else opens the advisors.
 */
import type { GameContext, PanelsApi } from '../../game/context';
import { clear, h, setText } from '../dom';
import { icon } from '../icons';
import { approvalBreakdown } from '../../sim/economy/approval';
import { NO_RESIDENTS_TEXT, approvalFix, approvalFixHint, approvalHud, newTownFooter } from './approvalGuide';

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

  constructor(private ctx: GameContext) {
    this.apprEl = h('div', { class: 'hud-value' });
    // hover card: why approval is where it is (approvalBreakdown, rebuilt monthly); the plain title is the fallback
    this.apprPop = h('div', { class: 'appr-pop mp-glass' });
    this.el = h('div', { class: 'hud-seg click approval', title: 'Mayor approval — advisors (N)' }, h('span', { class: 'ico-wrap', html: icon('smile', 20) }), h('div', { class: 'hud-stack' }, h('div', { class: 'hud-label' }, 'Approval'), this.apprEl), this.apprPop);
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
  }
}
