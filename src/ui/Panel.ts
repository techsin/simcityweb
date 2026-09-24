/** Draggable / closable floating panels and their manager (ESC closes the top-most). */
import type { GameContext, PanelsApi } from '../game/context';
import { loadPref, savePref } from '../game/settings';
import { h } from './dom';
import { icon } from './icons';
import { uiZoom } from './zoom';

export abstract class Panel {
  abstract readonly id: string;
  abstract readonly title: string;
  icon = 'info';
  width = 420;
  /** centered panels may be taller (they don't collide with the minimap) */
  center = false;
  el!: HTMLDivElement;
  body!: HTMLDivElement;
  headExtra!: HTMLDivElement;
  titleEl!: HTMLHeadingElement;
  isOpen = false;
  constructor(protected ctx: GameContext) {}

  /** build the DOM shell (once) */
  mount(onClose: () => void, onFocus: () => void, onDragEnd: () => void): void {
    this.titleEl = h('h3', null, this.title);
    this.headExtra = h('div', { class: 'ph-extra' });
    const close = h('button', { class: 'icon-btn', title: 'Close (Esc)', html: icon('close', 16) });
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      onClose();
    });
    const head = h('div', { class: 'panel-head' }, h('span', { class: 'ph-ico ico-wrap', html: icon(this.icon, 18) }), this.titleEl, this.headExtra, close);
    this.body = h('div', { class: 'panel-body' });
    this.el = h('div', { class: 'panel mp-glass i' + (this.center ? ' center' : ''), style: { width: this.width + 'px' } }, head, this.body);
    this.el.addEventListener('pointerdown', onFocus);
    // drag
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select, .ui-seg')) return;
      e.preventDefault();
      const z = uiZoom();
      const sx = e.clientX, sy = e.clientY;
      const ox = this.el.offsetLeft, oy = this.el.offsetTop;
      head.setPointerCapture(e.pointerId);
      // soft grab / drop sounds once the panel actually moves
      let dragged = false;
      const mv = (ev: PointerEvent) => {
        if (!dragged && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 4) {
          dragged = true;
          this.ctx.sound('grab');
        }
        this.setPos(ox + (ev.clientX - sx) / z, oy + (ev.clientY - sy) / z);
      };
      const up = () => {
        head.removeEventListener('pointermove', mv);
        head.removeEventListener('pointerup', up);
        if (dragged) this.ctx.sound('drop');
        onDragEnd();
      };
      head.addEventListener('pointermove', mv);
      head.addEventListener('pointerup', up);
    });
    this.build();
  }

  setPos(x: number, y: number): void {
    const parent = this.el.parentElement;
    if (parent) {
      const pw = parent.clientWidth, ph = parent.clientHeight;
      x = Math.max(4 - this.el.offsetWidth + 80, Math.min(pw - 80, x));
      y = Math.max(4, Math.min(ph - 40, y));
    }
    this.el.style.left = Math.round(x) + 'px';
    this.el.style.top = Math.round(y) + 'px';
  }

  /** default position given the layer size (unzoomed css px) */
  defaultPos(w: number, _h: number): { x: number; y: number } {
    return { x: w - this.width - 14, y: 72 };
  }

  /** create body content (called once after mount) */
  protected abstract build(): void;
  /** refresh dynamic content (called on open and on ui ticks while open) */
  update(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class PanelManager implements PanelsApi {
  private panels = new Map<string, Panel>();
  private order: string[] = [];
  private z = 10;
  /** last measured height of each open panel (content growth re-checks the toolbar clearance) */
  private lastH = new Map<string, number>();
  constructor(private ctx: GameContext, private layer: HTMLElement) {}

  /**
   * Keep a panel's bottom above the bottom toolbar where they overlap horizontally: on short screens (1280×720) a
   * centered panel whose content grows after it opened (e.g. the budget ledger tab) would otherwise slide under it.
   * Moves the panel up (never above the top bar); a drag that doesn't change the height is left alone.
   */
  private keepAboveToolbar(p: Panel): void {
    const el = p.el;
    const bar = this.ctx.root.querySelector('.hud-bottom .toolbar') as HTMLElement | null;
    if (!el || !bar || !p.isOpen || el.classList.contains('closing')) return;
    this.lastH.set(p.id, el.offsetHeight);
    const z = uiZoom();
    const lr = this.layer.getBoundingClientRect(), br = bar.getBoundingClientRect();
    if (!br.height) return;
    const barL = (br.left - lr.left) / z, barR = (br.right - lr.left) / z, limit = (br.top - lr.top) / z - 8;
    const left = el.offsetLeft, top = el.offsetTop, hgt = el.offsetHeight;
    if (left + el.offsetWidth <= barL || left >= barR || top + hgt <= limit) return;
    const y = Math.max(64, Math.floor(limit - hgt));
    if (y < top) p.setPos(left, y);
  }

  register(p: Panel): void {
    this.panels.set(p.id, p);
  }

  get(id: string): Panel | undefined {
    return this.panels.get(id);
  }

  isOpen(id: string): boolean {
    return !!this.panels.get(id)?.isOpen;
  }

  open(id: string): void {
    const p = this.panels.get(id);
    if (!p) return;
    if (!p.el) p.mount(() => this.close(id), () => this.focus(id), () => savePref('panel.' + id, { x: p.el.offsetLeft, y: p.el.offsetTop }));
    if (p.isOpen) {
      this.focus(id);
      return;
    }
    p.isOpen = true;
    p.el.classList.remove('closing');
    this.layer.appendChild(p.el);
    const saved = loadPref<{ x: number; y: number } | null>('panel.' + id, null);
    const pos = saved ?? this.freeSpot(p);
    p.setPos(pos.x, pos.y);
    const H = this.layer.clientHeight;
    if (p.el.offsetTop + p.el.offsetHeight > H - 8) p.setPos(p.el.offsetLeft, Math.max(64, H - p.el.offsetHeight - 12));
    this.focus(id);
    try {
      p.onOpen();
      p.update();
    } catch (e) {
      console.error('[ui] panel error', id, e);
    }
    this.keepAboveToolbar(p);
    this.ctx.sound('open');
    this.ctx.ui.emit('panel', { id, open: true });
  }

  /** default position, shifted left (or down) so it doesn't cover already-open panels */
  private freeSpot(p: Panel): { x: number; y: number } {
    const W = this.layer.clientWidth, H = this.layer.clientHeight;
    let { x, y } = p.defaultPos(W, H);
    const w = p.width, h = Math.min(p.el.offsetHeight || 400, H - 180);
    if (p.center) y = Math.max(64, Math.round((H - h) / 2) - 20);
    y = Math.max(64, Math.min(y, H - h - 12));
    const others = this.order.map((id) => this.panels.get(id)!).filter((o) => o && o !== p && o.isOpen);
    for (let guard = 0; guard < 8; guard++) {
      const hit = others.find((o) => {
        const ox = o.el.offsetLeft, oy = o.el.offsetTop, ow = o.el.offsetWidth, oh = o.el.offsetHeight;
        return x < ox + ow - 40 && x + w > ox + 40 && y < oy + oh - 40 && y + h > oy + 40;
      });
      if (!hit) break;
      const left = hit.el.offsetLeft - w - 12;
      if (left >= 12) x = left;
      else {
        x = Math.min(W - w - 14, x + 28);
        y = Math.min(y + 28, H - h - 12);
      }
    }
    return { x, y };
  }

  close(id: string): void {
    const p = this.panels.get(id);
    if (!p || !p.isOpen) return;
    p.isOpen = false;
    this.order = this.order.filter((x) => x !== id);
    try {
      p.onClose();
    } catch (e) {
      console.error('[ui] panel close error', id, e);
    }
    p.el.classList.add('closing');
    const el = p.el;
    setTimeout(() => {
      if (!p.isOpen && el.parentElement) el.remove();
    }, 150);
    this.ctx.sound('close');
    this.ctx.ui.emit('panel', { id, open: false });
  }

  toggle(id: string): void {
    if (this.isOpen(id)) this.close(id);
    else this.open(id);
  }

  focus(id: string): void {
    const p = this.panels.get(id);
    if (!p?.el) return;
    this.order = this.order.filter((x) => x !== id);
    this.order.push(id);
    p.el.style.zIndex = String(++this.z);
  }

  /** close the top-most panel; returns true if one was closed */
  closeTop(): boolean {
    const id = this.order[this.order.length - 1];
    if (!id) return false;
    this.close(id);
    return true;
  }

  closeAll(): void {
    for (const id of [...this.order]) this.close(id);
  }

  /** refresh open panels */
  tick(): void {
    for (const id of this.order) {
      const p = this.panels.get(id);
      if (!p?.isOpen) continue;
      try {
        p.update();
      } catch (e) {
        console.error('[ui] panel update error', id, e);
      }
      // content grew (tab switch, new rows): keep it clear of the toolbar
      if (p.el.offsetHeight !== this.lastH.get(id)) this.keepAboveToolbar(p);
    }
  }

  /** keep panels on-screen after a resize */
  clampAll(): void {
    for (const id of this.order) {
      const p = this.panels.get(id);
      if (!p?.isOpen) continue;
      p.setPos(p.el.offsetLeft, p.el.offsetTop);
      this.keepAboveToolbar(p);
    }
  }
}
