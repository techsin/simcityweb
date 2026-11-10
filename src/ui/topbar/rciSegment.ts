/**
 * The top bar's RCI segment (POLISH_PLAN §7.3: GUIDE's, from the round-1 TopBar split): the three demand bars with their
 * cap marks, FH-03's "+ zone" badge (rciGuide.ts), the demand-cap toasts, and the popover (demand by type, the
 * neighbours' share, the cap hints and LG-05's built-out line). Also the demand helpers other panels read (re-exported
 * by src/ui/TopBar.ts).
 */
import { DEV_TYPE_LABELS, DevType } from '../../core/types';
import { watchFor, type WatchHandle, type QueryResult } from '../../worker/SimHost';
import type { GameContext } from '../../game/context';
import { clear, escapeHtml, h, setText, toggleClass } from '../dom';
import { icon } from '../icons';
import { compact } from '../format';
import { econData } from '../../sim/economy/runtime';
import { ZONE_ADVICE, builtOutIssue, zoneBadge } from './rciGuide';
import { adviceAction, issueButtons, zoneRoom, type ZoneRoom } from '../adviceActions';
import type { OpenAdvice } from '../../sim/economy/advisors';

const RCI_DEFS: { key: 'R' | 'C' | 'I'; color: string; devs: DevType[] }[] = [
  { key: 'R', color: 'var(--res)', devs: [DevType.R1, DevType.R2, DevType.R3] },
  { key: 'C', color: 'var(--com)', devs: [DevType.CS1, DevType.CS2, DevType.CS3, DevType.CO2, DevType.CO3] },
  { key: 'I', color: 'var(--ind)', devs: [DevType.IA, DevType.ID, DevType.IM, DevType.IHT] },
];

const FAMILY_NAMES: Record<string, string> = { R: 'Residential', C: 'Commercial', I: 'Industrial' };
/** FH-03: the "+ zone" badge recounts the empty lots at most this often (real ms; the bar updates on every UI tick) */
const ZONE_RECOUNT_MS = 1000;
/** where to look for cap relief (toolbar category to open) */
const CAP_TARGET: Record<string, { category: string; label: string; icon: string }> = {
  R: { category: 'parks', label: 'Parks', icon: 'park' },
  C: { category: 'transport', label: 'Airports', icon: 'plane' },
  I: { category: 'transport', label: 'Freight & ports', icon: 'train' },
};

export const DEV_NAMES = [
  'Low-wealth residents', 'Medium-wealth residents', 'High-wealth residents',
  'Low-wealth services', 'Medium-wealth services', 'High-wealth services',
  'Medium-wealth offices', 'High-wealth offices',
  'Agriculture', 'Dirty industry', 'Manufacturing', 'High-tech industry',
];

/** aggregate demand for a family: strongest positive sub-demand, else the mean */
export function familyDemand(demand: number[], devs: DevType[]): number {
  let mx = -1, sum = 0;
  for (const d of devs) {
    const v = demand[d] ?? 0;
    mx = Math.max(mx, v);
    sum += v;
  }
  const mean = sum / devs.length;
  return Math.max(-1, Math.min(1, mx > 0 ? Math.max(mx, mean) : mean));
}

/** current count vs cap for a dev type: returns 0..1+ ratio or -1 if unknown */
export function capRatio(ctx: GameContext, d: DevType): number {
  const st = ctx.state.stats;
  const cap = st.demandCap?.[d] ?? 0;
  if (!cap || cap <= 0) return -1;
  const cur = d <= DevType.R3 ? (st.residents as number[] | undefined)?.[d] ?? 0 : st.jobsByDev?.[d] ?? 0;
  return cur / cap;
}

/** T030: the fill scales on the compositor (scaleY from the centre line); an unchanged value writes no style */
function paintBar(el: HTMLElement, v: number, color: string): void {
  const fill = el.firstElementChild as HTMLElement;
  const a = Math.min(1, Math.abs(v));
  const scale = String(v >= 0 ? -a : a), opacity = v >= 0 ? '1' : '0.45';
  if (fill.dataset.scale === scale && fill.dataset.color === color && fill.style.opacity === opacity) return;
  fill.dataset.scale = scale;
  fill.dataset.color = color;
  fill.style.transform = `scaleY(${scale})`;
  // Compensate the scaled corner radius so the settled fill keeps its original 2 px rounding.
  fill.style.borderRadius = `2px / ${2 / (a || 1)}px`;
  fill.style.background = color;
  fill.style.opacity = opacity;
}

export class RciSegment {
  readonly el: HTMLElement;
  private rciBars: HTMLElement[] = [];
  private rciPop: HTMLElement;
  private subBars: { el: HTMLElement; val: HTMLElement; dev: DevType; color: string }[] = [];
  private rciOpen = false;
  private capHintsEl!: HTMLElement;
  private capSig = '';
  private hintsWatch: WatchHandle<QueryResult<'capHints'>> | null = null;
  /** FH-03: the RCI segment's "+ zone" badge, the family its click zones (-1: hidden) and the room counted last (the
   *  layers recounted at most once a real second: zoneRoom is one pass over the map) */
  private zoneBadgeEl: HTMLElement;
  private zoneFam = -1;
  private zoneMemo: { st: unknown; at: number; room: ZoneRoom } | null = null;
  /** LG-05: the advisors' open issues while the RCI popover is open (its built-out line) */
  private issuesWatch: WatchHandle<QueryResult<'advisorIssues'>> | null = null;
  /** RCI popover: what the neighbour cities add to demand (econData.regionTerms, WP4-1) */
  private regionEl!: HTMLElement;
  private regionSig = '';
  private announced = new Map<string, number>();
  /** RCI families capped at the last update (announceCaps toasts on the change to capped) */
  private cappedFams = new Set<string>();

  /** `refresh`: the whole bar's update, run when the popover opens (the shell's TopBar.update) */
  constructor(private ctx: GameContext, private refresh: () => void) {
    const rci = h('div', { class: 'rci' });
    for (const d of RCI_DEFS) {
      const bar = h('div', { class: 'rci-bar' }, h('i'), h('span', { class: 'rci-cap' }));
      this.rciBars.push(bar);
      rci.appendChild(h('div', { class: 'rci-col' }, bar, h('span', { class: 'rci-l', style: { color: d.color } }, d.key)));
    }
    this.rciPop = this.buildRciPop();
    // FH-03: "+ zone" while a family wants in and has almost no empty lots; a click zones it (not the popover)
    this.zoneBadgeEl = h('button', { class: 'rci-zone', type: 'button', style: { display: 'none' } }, '+ zone');
    this.zoneBadgeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.zoneFam >= 0) adviceAction(ZONE_ADVICE[this.zoneFam])?.run(this.ctx, null);
    }, { signal: this.ctx.signal });
    this.el = h('div', { class: 'hud-seg click rci-seg', title: 'RCI demand — click for details' }, rci, h('span', { class: 'rci-capdot' }), this.zoneBadgeEl, this.rciPop);
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.rci-pop')) return;
      this.setRci(!this.rciOpen);
    }, { signal: this.ctx.signal });
    document.addEventListener('pointerdown', (e) => {
      if (this.rciOpen && !(e.target as HTMLElement).closest('.rci-seg')) this.setRci(false);
    }, { signal: ctx.signal });
  }

  private buildRciPop(): HTMLElement {
    const grid = h('div', { class: 'rci-grid' });
    for (const fam of RCI_DEFS) {
      for (const d of fam.devs) {
        const bar = h('div', { class: 'rci-bar' }, h('i'), h('span', { class: 'rci-cap' }));
        const val = h('span', { class: 'val' });
        bar.title = DEV_NAMES[d];
        grid.appendChild(h('div', { class: 'g' }, val, bar, h('span', { class: 'lbl' }, DEV_TYPE_LABELS[d])));
        this.subBars.push({ el: bar, val, dev: d, color: fam.color });
      }
    }
    const groups = h('div', { class: 'rci-groups' },
      h('div', { style: { color: 'var(--res)', borderColor: 'var(--res)' } }, 'RESIDENTIAL'),
      h('div', { style: { color: 'var(--com)', borderColor: 'var(--com)' } }, 'COMMERCIAL'),
      h('div', { style: { color: 'var(--ind)', borderColor: 'var(--ind)' } }, 'INDUSTRIAL'),
    );
    this.capHintsEl = h('div', { class: 'rci-hints' });
    this.regionEl = h('div', { class: 'rci-region' });
    const foot = h('div', { class: 'rci-foot' }, h('span', { class: 'cap-key' }, 'Demand cap reached'), h('span', { class: 'faint' }, 'Bars above the line = growth wanted'));
    return h('div', { class: 'rci-pop mp-glass i' }, h('div', { class: 'sec-title' }, 'Demand by type'), grid, groups, this.regionEl, this.capHintsEl, foot);
  }

  /** per DevType: is the demand cap limiting growth? (sim-core demandInfo, else supply/cap ratio heuristic) */
  private cappedDevs(): boolean[] {
    const st = this.ctx.state;
    const di = this.ctx.mods.econ?.demandInfo;
    if (di) {
      try {
        const info = di(st);
        if (Array.isArray(info.capped)) return info.capped.map((c, d) => c && (st.stats.demand[d] ?? 0) > -0.05);
      } catch {
        /* fall through */
      }
    }
    return Array.from({ length: 12 }, (_, d) => (st.stats.demand[d] ?? 0) > 0.05 && capRatio(this.ctx, d) >= 0.95);
  }

  private capHints(): { family: 'R' | 'C' | 'I'; devs: number[]; hint: string }[] {
    const hints = this.hintsWatch?.value;
    if (hints) return hints;
    const capped = this.cappedDevs();
    const fallback: Record<string, string> = {
      R: 'Build parks, plazas or landmarks to raise the residential cap.',
      C: 'Build an airport, a convention center or landmarks to raise the commercial cap.',
      I: 'Connect to neighbors (highway / rail), build freight stations or a seaport to raise the industrial cap.',
    };
    return RCI_DEFS.filter((fam) => fam.devs.some((d) => capped[d])).map((fam) => ({ family: fam.key, devs: fam.devs.filter((d) => capped[d]), hint: fallback[fam.key] }));
  }

  /** the neighbour cities' share of demand (econData.regionTerms: residents / jobs added to the targets and caps) */
  private renderRegion(): void {
    const t = econData(this.ctx.state).regionTerms;
    const r = (v: number) => Math.round(v);
    const sig = t ? [...t.R, ...t.CS, t.CO, t.I, t.market, t.capR, t.capC, t.capI].map((v) => r(v * (v < 5 ? 100 : 1))).join(',') : '';
    if (sig === this.regionSig) return;
    this.regionSig = sig;
    clear(this.regionEl);
    if (!t) return;
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const parts: string[] = [];
    const R = sum(t.R), C = sum(t.CS) + t.CO, I = t.I;
    if (Math.abs(R) >= 1) parts.push(`<b>R</b> ${R >= 0 ? '+' : '−'}${compact(Math.abs(R))} residents`);
    if (Math.abs(C) >= 1) parts.push(`<b>C</b> ${C >= 0 ? '+' : '−'}${compact(Math.abs(C))} jobs`);
    if (Math.abs(I) >= 1) parts.push(`<b>I</b> ${I >= 0 ? '+' : '−'}${compact(Math.abs(I))} jobs`);
    const caps = [t.capR >= 1 ? `R +${compact(t.capR)}` : '', t.capC >= 1 ? `C +${compact(t.capC)}` : '', t.capI >= 1 ? `I +${compact(t.capI)}` : ''].filter(Boolean);
    if (!parts.length && !caps.length && t.market <= 1.001) return;
    this.regionEl.append(
      h('div', { class: 'rr-t', html: icon('region', 13) + '<span>Neighbour cities add</span>' }),
      h('div', { class: 'rr-v', html: parts.length ? parts.join(' · ') : 'no extra demand yet' }),
      h('div', { class: 'rr-s' }, [t.market > 1.001 ? `industry market ×${t.market.toFixed(2)}` : '', caps.length ? `caps ${caps.join(' · ')}` : '', 'better road / rail links raise it'].filter(Boolean).join(' · ')),
    );
  }

  /** "what to build" cards in the RCI popover — how players discover the cap / reward loop; LG-05: a built-out city's
   *  advice first, with its buttons */
  private renderCapHints(): void {
    const hints = this.capHints();
    const out = builtOutIssue(this.issuesWatch?.value);
    const sig = (out ? `B|${out.text}|${(out.options ?? []).map((o) => `${o.id}@${o.x},${o.z}`).join('/')}|${out.x},${out.z}\n` : '')
      + hints.map((x) => x.family + x.devs.join('.') + x.hint).join('|');
    if (sig === this.capSig) return;
    this.capSig = sig;
    clear(this.capHintsEl);
    if (out) this.capHintsEl.appendChild(this.builtOutHint(out));
    for (const hnt of hints) {
      const fam = RCI_DEFS.find((f) => f.key === hnt.family)!;
      const go = h('button', { class: 'btn sm', html: icon(CAP_TARGET[hnt.family].icon, 13) + `<span>${CAP_TARGET[hnt.family].label}</span>` });
      go.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setRci(false);
        this.ctx.openFlyout?.(CAP_TARGET[hnt.family].category);
      }, { signal: this.ctx.signal });
      this.capHintsEl.appendChild(h('div', { class: 'cap-hint', style: { '--fc': fam.color } as Record<string, string> },
        h('span', { class: 'ch-ico', html: icon('alert', 14) }),
        h('div', { class: 'ch-body' },
          h('div', { class: 'ch-t' }, `${FAMILY_NAMES[hnt.family]} demand is capped`, h('span', { class: 'ch-devs' }, hnt.devs.map((d) => DEV_TYPE_LABELS[d]).join(' · '))),
          h('div', { class: 'ch-d' }, hnt.hint),
        ),
        go,
      ));
    }
  }

  /** LG-05: the built-out advice as a cap hint: its text and one button per option (src/ui/adviceActions.ts) */
  private builtOutHint(out: OpenAdvice): HTMLElement {
    const acts = h('div', { class: 'ch-acts' });
    for (const b of issueButtons(out)) {
      const btn = h('button', { class: 'btn sm', title: b.action.tip, html: icon(b.action.icon, 13) + `<span>${escapeHtml(b.action.label)}</span>` });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setRci(false);
        b.action.run(this.ctx, b.at);
      }, { signal: this.ctx.signal });
      acts.appendChild(btn);
    }
    return h('div', { class: 'cap-hint built-out', style: { '--fc': '#ffd46b' } as Record<string, string> },
      h('span', { class: 'ch-ico', html: icon('alert', 14) }),
      h('div', { class: 'ch-body' }, h('div', { class: 'ch-t' }, 'The city is built out'), h('div', { class: 'ch-d' }, out.text)),
      acts,
    );
  }

  /** FH-03: show or hide the "+ zone" badge for the bars' demand (`dem`, per DevType) */
  private updateZoneBadge(dem: number[]): void {
    const st = this.ctx.state, now = performance.now();
    let m = this.zoneMemo;
    if (!m || m.st !== st || !(now >= m.at && now - m.at < ZONE_RECOUNT_MS)) m = this.zoneMemo = { st, at: now, room: zoneRoom(st) };
    const b = zoneBadge(m.room, st.cells, RCI_DEFS.map((fam) => familyDemand(dem, fam.devs)));
    this.zoneFam = b.fam;
    const display = b.fam >= 0 ? '' : 'none';
    if (this.zoneBadgeEl.style.display !== display) this.zoneBadgeEl.style.display = display;
    if (b.fam < 0) return;
    if (this.zoneBadgeEl.title !== b.title) this.zoneBadgeEl.title = b.title;
    const fam = RCI_DEFS[b.fam].key;
    if (this.zoneBadgeEl.dataset.fam !== fam) {
      this.zoneBadgeEl.dataset.fam = fam;
      this.zoneBadgeEl.style.setProperty('--fc', RCI_DEFS[b.fam].color);
    }
  }

  /**
   * toast when a demand cap starts limiting a family's growth: only when it newly becomes capped (not again while it
   * stays capped) and at most every half-year per family - a cap flickering around its threshold toasted, with the
   * full warning sound, every quarter (Toasts also keeps a repeated message quiet for REPEAT_MS)
   */
  private announceCaps(fams: string[]): void {
    const st = this.ctx.state;
    if (st.stats.population < 200) return;
    const was = this.cappedFams;
    if (fams.length !== was.size || fams.some((f) => !was.has(f))) this.cappedFams = new Set(fams);
    for (const f of fams) {
      if (was.has(f)) continue;
      const last = this.announced.get(f) ?? -1e9;
      if (st.day - last < 180) continue;
      this.announced.set(f, st.day);
      void this.ctx.host.query('capHints', {}).then((hints) => {
        if (this.ctx.signal.aborted) return;
        const hint = hints.find((x) => x.family === f)?.hint ?? '';
        // (FEEL-02a: it shares the news toasts' budget)
        this.ctx.toast(`${FAMILY_NAMES[f]} growth is capped. ${hint}`, 'warning', undefined, 'Demand cap', { budget: true });
      }).catch(() => {});
    }
  }

  /** close the RCI popover; true if it was open */
  closePopover(): boolean {
    if (!this.rciOpen) return false;
    this.setRci(false);
    return true;
  }

  private setRci(open: boolean): void {
    if (open !== this.rciOpen) this.ctx.sound(open ? 'flyout' : 'flyoutClose');
    this.rciOpen = open;
    if (open) {
      this.hintsWatch ??= watchFor(this.ctx.host, 'capHints', {}, 'daily', this.ctx.signal);
      this.issuesWatch ??= watchFor(this.ctx.host, 'advisorIssues', {}, 'monthly', this.ctx.signal);
    } else {
      this.hintsWatch?.dispose(); this.hintsWatch = null;
      this.issuesWatch?.dispose(); this.issuesWatch = null;
    }
    toggleClass(this.rciPop, 'open', open);
    if (open) this.refresh();
  }

  /** RCI (cap flags from sim-core's demandInfo when available) */
  update(): void {
    const st = this.ctx.state;
    const dem = st.stats.demand ?? [];
    const cappedDev = this.cappedDevs();
    const capFams: string[] = [];
    RCI_DEFS.forEach((fam, i) => {
      const bar = this.rciBars[i];
      paintBar(bar, familyDemand(dem, fam.devs), fam.color);
      const capped = fam.devs.some((dv) => cappedDev[dv]);
      toggleClass(bar, 'capped', capped);
      toggleClass(bar.parentElement!, 'capped', capped);
      if (capped) capFams.push(fam.key);
    });
    toggleClass(this.el, 'has-cap', capFams.length > 0);
    const segTitle = capFams.length ? `RCI demand — ${capFams.map((f) => FAMILY_NAMES[f]).join(', ')} capped · click for details` : 'RCI demand — click for details';
    if (this.el.title !== segTitle) this.el.title = segTitle;
    this.announceCaps(capFams);
    this.updateZoneBadge(dem);
    if (this.rciOpen) {
      for (const s of this.subBars) {
        const v = dem[s.dev] ?? 0;
        paintBar(s.el, v, s.color);
        setText(s.val, (v > 0 ? '+' : '') + Math.round(v * 100));
        const capped = cappedDev[s.dev];
        toggleClass(s.el, 'capped', capped);
        toggleClass(s.el.parentElement!, 'capped', capped);
        const cap = st.stats.demandCap?.[s.dev] ?? 0;
        s.el.title = `${DEV_NAMES[s.dev]}: demand ${Math.round(v * 100)}${cap > 0 ? ` · cap ${cap.toLocaleString('en-US')}` : ''}${capped ? ' — CAPPED' : ''}`;
      }
      this.renderCapHints();
      this.renderRegion();
    }
  }
}
