/**
 * Data views: overlay picker + variant chips + legend (world.setOverlay + objects.setOverlayMode). Also the compact
 * legend chip shown bottom-left while a data view is active (with its own variant switcher).
 */
import '../insight.css';
import { Overlay } from '../../core/types';
import type { GameContext } from '../../game/context';
import { resolveVariant } from '../../sim/infra/overlays';
import { Panel } from '../Panel';
import { clear, h, toggle, toggleClass } from '../dom';
import { icon } from '../icons';
import { DESIR_GROUPS, OVERLAYS, legendHtml, overlayInfo, overlayTitle, overlayVariants } from '../overlays';
import { uiZoom } from '../zoom';

/**
 * Variant chips of a data view (none for views without variants). Desirability's 15 variants come in labelled rows
 * (residential / commercial / industrial / appeal); others in one wrapping row.
 */
export function variantChips(ctx: GameContext, o: Overlay, compact = false): HTMLElement | null {
  const names = overlayVariants(o);
  if (names.length < 2) return null;
  const cur = resolveVariant(o, ctx.overlayVariant);
  const pick = (v: number) => {
    if (v === resolveVariant(o, ctx.overlayVariant)) return;
    ctx.sound('tab');
    ctx.setOverlay(o, v);
  };
  const chip = (v: number) => {
    // (the pick plays its own 'tab' sound: opt out of the generic click)
    const b = h('button', { class: 'dv-var' + (v === cur ? ' on' : ''), dataset: { v: String(v) }, title: names[v], 'data-sfx': 'none' }, names[v]) as HTMLButtonElement;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      pick(v);
    });
    return b;
  };
  if (o === Overlay.Desirability) {
    const box = h('div', { class: 'dv-vars grouped' + (compact ? ' compact' : '') });
    for (const g of DESIR_GROUPS) {
      // (the legend chip is narrow: short group names, the full one as the tooltip)
      const row = h('div', { class: 'dv-var-row' }, h('span', { class: 'dv-var-g', title: g.label }, compact ? g.short : g.label));
      for (let v = g.from; v <= g.to; v++) row.appendChild(chip(v));
      box.appendChild(row);
    }
    return box;
  }
  const box = h('div', { class: 'dv-vars' + (compact ? ' compact' : '') });
  names.forEach((_, v) => box.appendChild(chip(v)));
  return box;
}

export class DataViewsPanel extends Panel {
  readonly id = 'dataviews';
  readonly title = 'Data views';
  override icon = 'layers';
  override width = 400;
  private btns = new Map<Overlay, HTMLButtonElement>();
  private legend!: HTMLDivElement;
  private vars!: HTMLDivElement;
  private varsKey = '';
  private underground = false;

  override defaultPos(w: number, _hh: number): { x: number; y: number } {
    // top-right under the top bar; fit() keeps the bottom above the minimap
    return { x: w - this.width - 14, y: 72 };
  }

  protected build(): void {
    const groups = new Map<string, HTMLElement>();
    const none = h('button', { class: 'dv-btn', html: icon('none', 20) + '<span>None</span>' }) as HTMLButtonElement;
    none.addEventListener('click', () => this.pick(Overlay.None));
    this.btns.set(Overlay.None, none);
    for (const o of OVERLAYS) {
      let g = groups.get(o.group);
      if (!g) {
        g = h('div', { class: 'dv-grid' });
        groups.set(o.group, g);
      }
      const b = h('button', { class: 'dv-btn', title: o.hint ?? o.label, html: icon(o.icon, 20) + `<span>${o.label}</span>` }) as HTMLButtonElement;
      b.addEventListener('click', () => this.pick(this.ctx.overlay === o.o ? Overlay.None : o.o));
      this.btns.set(o.o, b);
      g.appendChild(b);
    }
    // layout (fits 1280×720): the overlay grid (and the Underground toggle under it) scrolls inside; variants + legend
    // stay pinned below (Desirability's 15 variants + a legend left the grid one row tall with the toggle pinned too)
    const scroll = h('div', { class: 'dv-scroll' });
    this.scroll = scroll;
    scroll.addEventListener('scroll', () => this.cue(), { passive: true });
    let first = true;
    for (const [name, g] of groups) {
      scroll.appendChild(h('div', { class: 'sec-title' }, name));
      if (first) {
        g.prepend(none);
        first = false;
      }
      scroll.appendChild(g);
    }
    this.body.classList.add('dv-body');
    this.body.appendChild(scroll);
    this.vars = h('div', { class: 'dv-vars-wrap' });
    this.legend = h('div', { class: 'dv-legend' });
    const ug = toggle(false, (v) => {
      this.underground = v;
      try {
        this.ctx.objects.setUnderground(v);
      } catch {
        /* ignore */
      }
    });
    scroll.append(h('div', { class: 'sec-title' }, 'View'), h('div', { class: 'set-row dv-ug' }, h('div', null, h('div', { class: 'sr-l' }, 'Underground view'), h('div', { class: 'sr-d' }, 'Show subway tunnels')), ug));
    this.body.append(h('div', { class: 'dv-foot' }, this.vars, this.legend));
    this.ctx.ui.on('overlay', () => this.update());
  }

  override onOpen(): void {
    requestAnimationFrame(() => this.fit());
  }

  /**
   * limit the height so the panel never covers the minimap or the bottom toolbar (it moves left when the inspector
   * takes the right column), and cue the overlay list's hidden rows (fades at the edges that scroll)
   */
  private fit(): void {
    const el = this.el;
    const layer = el?.parentElement;
    if (!layer || !this.isOpen) return;
    const z = uiZoom();
    const lr = layer.getBoundingClientRect();
    let bottom = layer.clientHeight - 12;
    const left = el.offsetLeft, right = left + el.offsetWidth;
    for (const sel of ['.minimap', '.hud-bottom .toolbar']) {
      const o = this.ctx.root.querySelector(sel) as HTMLElement | null;
      if (!o || o.offsetParent === null) continue;
      const r = o.getBoundingClientRect();
      const oL = (r.left - lr.left) / z, oR = (r.right - lr.left) / z, oT = (r.top - lr.top) / z;
      if (r.width > 0 && right > oL && left < oR) bottom = Math.min(bottom, oT - 10);
    }
    const maxH = Math.max(240, Math.floor(bottom - el.offsetTop));
    const v = maxH + 'px';
    if (el.style.maxHeight !== v) el.style.maxHeight = v;
    this.cue();
  }

  /** fade the overlay list where more buttons are hidden (above / below) */
  private cue(): void {
    const sc = this.scroll;
    if (!sc) return;
    const more = sc.scrollHeight - sc.clientHeight > 4;
    toggleClass(sc, 'more-below', more && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 4);
    toggleClass(sc, 'more-above', more && sc.scrollTop > 4);
  }
  private scroll: HTMLElement | null = null;

  private pick(o: Overlay): void {
    if (o !== this.ctx.overlay) this.ctx.sound(o === Overlay.None ? 'overlayOff' : 'overlay');
    this.ctx.setOverlay(o);
  }

  override update(): void {
    const ov = this.ctx.overlay;
    for (const [o, b] of this.btns) toggleClass(b, 'on', o === ov);
    const info = overlayInfo(ov);
    const key = `${ov}:${resolveVariant(ov, this.ctx.overlayVariant)}`;
    if (key !== this.varsKey) {
      this.varsKey = key;
      clear(this.vars);
      const chips = info ? variantChips(this.ctx, ov) : null;
      if (chips) this.vars.append(h('div', { class: 'sec-title' }, 'Show'), chips);
    }
    const html = info
      ? `<div class="sec-title">${overlayTitle(ov, this.ctx.overlayVariant)} legend</div>${legendHtml(ov, this.ctx.mods.overlayLegend, this.ctx.overlayVariant, this.ctx.state)}`
      : '<div class="dv-nolegend">Pick a data view to see its legend</div>';
    if (this.legend.dataset.html !== html) {
      this.legend.dataset.html = html;
      this.legend.innerHTML = html;
    }
    this.fit();
  }

  override onClose(): void {
    if (this.underground) {
      try {
        this.ctx.objects.setUnderground(false);
      } catch {
        /* ignore */
      }
    }
  }
}

/** small legend chip shown bottom-left while an overlay is active (title, variant switcher, legend, notes); hidden
 *  while the Data views panel is open (it shows the same switcher and legend) */
export class LegendChip {
  readonly el: HTMLDivElement;
  private key = '';
  private body!: HTMLDivElement;
  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.el = h('div', { class: 'legend-chip mp-glass' });
    parent.prepend(this.el);
    ctx.ui.on('overlay', () => this.update());
    ctx.ui.on('panel', ({ id }) => {
      if (id === 'dataviews') this.update();
    });
    // the wind arrow / commute scale follow the city: refresh the legend body now and then
    ctx.ui.on('uiTick', () => this.refreshBody());
    this.update();
  }
  update(): void {
    const o = this.ctx.overlay;
    const info = overlayInfo(o);
    let panelOpen = false;
    try {
      panelOpen = this.ctx.panels.isOpen('dataviews');
    } catch {
      /* panels not built yet */
    }
    if (!info || panelOpen) {
      this.el.classList.remove('show');
      this.key = '';
      return;
    }
    const key = `${o}:${resolveVariant(o, this.ctx.overlayVariant)}`;
    if (key === this.key && this.el.classList.contains('show')) {
      this.refreshBody();
      return;
    }
    this.key = key;
    this.el.innerHTML = '';
    const close = h('button', { class: 'icon-btn', title: 'Hide data view', html: icon('close', 13) });
    close.addEventListener('click', () => {
      this.ctx.sound('overlayOff');
      this.ctx.setOverlay(Overlay.None);
    });
    const head = h('div', { class: 'lg-head' }, h('span', { class: 'ico-wrap', style: 'color:#3fd6c6', html: icon(info.icon, 16) }), h('b', null, overlayTitle(o, this.ctx.overlayVariant)), close);
    this.body = h('div', { class: 'lg-body' });
    const chips = variantChips(this.ctx, o, true);
    this.el.append(head);
    if (chips) this.el.append(chips);
    this.el.append(this.body);
    this.refreshBody(true);
    this.el.classList.add('show');
  }
  private lastBodyAt = 0;
  private refreshBody(force = false): void {
    if (!this.body || !this.el.classList.contains('show')) return;
    const now = performance.now();
    if (!force && now - this.lastBodyAt < 2000) return;
    this.lastBodyAt = now;
    const html = legendHtml(this.ctx.overlay, this.ctx.mods.overlayLegend, this.ctx.overlayVariant, this.ctx.state);
    if (this.body.dataset.html !== html) {
      this.body.dataset.html = html;
      this.body.innerHTML = html;
    }
  }
}
