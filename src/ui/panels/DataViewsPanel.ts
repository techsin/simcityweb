/** Data views: overlay picker + legend (world.setOverlay + objects.setOverlayMode). Also a compact legend chip. */
import { Overlay } from '../../core/types';
import type { GameContext } from '../../game/context';
import { Panel } from '../Panel';
import { h, toggle, toggleClass } from '../dom';
import { icon } from '../icons';
import { OVERLAYS, legendHtml, overlayInfo } from '../overlays';

export class DataViewsPanel extends Panel {
  readonly id = 'dataviews';
  readonly title = 'Data views';
  override icon = 'layers';
  override width = 400;
  private btns = new Map<Overlay, HTMLButtonElement>();
  private legend!: HTMLDivElement;
  private underground = false;

  override defaultPos(w: number, hh: number): { x: number; y: number } {
    return { x: w - this.width - 14, y: Math.max(72, hh - 640) };
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
    let first = true;
    for (const [name, g] of groups) {
      this.body.appendChild(h('div', { class: 'sec-title' }, name));
      if (first) {
        g.prepend(none);
        first = false;
      }
      this.body.appendChild(g);
    }
    this.legend = h('div', { class: 'dv-legend' });
    const ug = toggle(false, (v) => {
      this.underground = v;
      try {
        this.ctx.objects.setUnderground(v);
      } catch {
        /* ignore */
      }
    });
    this.body.append(this.legend, h('div', { class: 'set-row', style: 'margin-top:8px' }, h('div', null, h('div', { class: 'sr-l' }, 'Underground view'), h('div', { class: 'sr-d' }, 'Show subway tunnels')), ug));
    this.ctx.ui.on('overlay', () => this.update());
  }

  private pick(o: Overlay): void {
    this.ctx.setOverlay(o);
    this.ctx.sound('click');
  }

  override update(): void {
    for (const [o, b] of this.btns) toggleClass(b, 'on', o === this.ctx.overlay);
    const info = overlayInfo(this.ctx.overlay);
    this.legend.innerHTML = info ? `<div class="sec-title">${info.label} legend</div>${legendHtml(this.ctx.overlay, this.ctx.mods.overlayLegend)}` : '';
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
    close.addEventListener('click', () => this.ctx.setOverlay(Overlay.None));
    const head = h('div', { class: 'lg-head' }, h('span', { class: 'ico-wrap', style: 'color:#3fd6c6', html: icon(info.icon, 16) }), h('b', null, info.label), close);
    const body = h('div', { html: legendHtml(this.ctx.overlay, this.ctx.mods.overlayLegend) });
    this.el.append(head, body);
    this.el.classList.add('show');
  }
}
