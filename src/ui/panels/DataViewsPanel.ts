/** Data views: overlay picker + legend (world.setOverlay + objects.setOverlayMode). Also a compact legend chip. */
import { Overlay } from '../../core/types';
import type { GameContext } from '../../game/context';
import { Panel } from '../Panel';
import { h, toggle, toggleClass } from '../dom';
import { icon } from '../icons';
import { OVERLAYS, legendHtml, overlayInfo } from '../overlays';
import { uiZoom } from '../zoom';

export class DataViewsPanel extends Panel {
  readonly id = 'dataviews';
  readonly title = 'Data views';
  override icon = 'layers';
  override width = 400;
  private btns = new Map<Overlay, HTMLButtonElement>();
  private legend!: HTMLDivElement;
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
      const b = h('button', { class: 'dv-btn', html: icon(o.icon, 20) + `<span>${o.label}</span>` }) as HTMLButtonElement;
      b.addEventListener('click', () => this.pick(this.ctx.overlay === o.o ? Overlay.None : o.o));
      this.btns.set(o.o, b);
      g.appendChild(b);
    }
    // layout (fits 1280×720): the overlay grid scrolls inside; legend + Underground toggle stay pinned below it
    const scroll = h('div', { class: 'dv-scroll' });
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
    this.legend = h('div', { class: 'dv-legend' });
    const ug = toggle(false, (v) => {
      this.underground = v;
      try {
        this.ctx.objects.setUnderground(v);
      } catch {
        /* ignore */
      }
    });
    this.body.append(h('div', { class: 'dv-foot' }, this.legend, h('div', { class: 'set-row dv-ug' }, h('div', null, h('div', { class: 'sr-l' }, 'Underground view'), h('div', { class: 'sr-d' }, 'Show subway tunnels')), ug)));
    this.ctx.ui.on('overlay', () => this.update());
  }

  override onOpen(): void {
    requestAnimationFrame(() => this.fit());
  }

  /** limit the height so the panel never covers the minimap (it sits above it in the right column) */
  private fit(): void {
    const el = this.el;
    const layer = el?.parentElement;
    if (!layer || !this.isOpen) return;
    const z = uiZoom();
    const lr = layer.getBoundingClientRect();
    let bottom = layer.clientHeight - 12;
    const mm = this.ctx.root.querySelector('.minimap') as HTMLElement | null;
    if (mm && mm.offsetParent !== null) {
      const r = mm.getBoundingClientRect();
      const mmL = (r.left - lr.left) / z, mmR = (r.right - lr.left) / z, mmT = (r.top - lr.top) / z;
      const left = el.offsetLeft, right = left + el.offsetWidth;
      if (right > mmL && left < mmR) bottom = Math.min(bottom, mmT - 10);
    }
    const maxH = Math.max(240, Math.floor(bottom - el.offsetTop));
    const v = maxH + 'px';
    if (el.style.maxHeight !== v) el.style.maxHeight = v;
  }

  private pick(o: Overlay): void {
    if (o !== this.ctx.overlay) this.ctx.sound(o === Overlay.None ? 'overlayOff' : 'overlay');
    this.ctx.setOverlay(o);
  }

  override update(): void {
    for (const [o, b] of this.btns) toggleClass(b, 'on', o === this.ctx.overlay);
    const info = overlayInfo(this.ctx.overlay);
    const html = info ? `<div class="sec-title">${info.label} legend</div>${legendHtml(this.ctx.overlay, this.ctx.mods.overlayLegend)}` : '<div class="dv-nolegend">Pick a data view to see its legend</div>';
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

/** small legend chip shown bottom-left while an overlay is active */
export class LegendChip {
  readonly el: HTMLDivElement;
  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.el = h('div', { class: 'legend-chip mp-glass' });
    parent.prepend(this.el);
    ctx.ui.on('overlay', () => this.update());
    this.update();
  }
  update(): void {
    const info = overlayInfo(this.ctx.overlay);
    if (!info) {
      this.el.classList.remove('show');
      return;
    }
    this.el.innerHTML = '';
    const close = h('button', { class: 'icon-btn', title: 'Hide data view', html: icon('close', 13) });
    close.addEventListener('click', () => {
      this.ctx.sound('overlayOff');
      this.ctx.setOverlay(Overlay.None);
    });
    const head = h('div', { class: 'lg-head' }, h('span', { class: 'ico-wrap', style: 'color:#3fd6c6', html: icon(info.icon, 16) }), h('b', null, info.label), close);
    const body = h('div', { html: legendHtml(this.ctx.overlay, this.ctx.mods.overlayLegend) });
    this.el.append(head, body);
    this.el.classList.add('show');
  }
}
