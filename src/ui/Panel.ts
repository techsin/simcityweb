/** Draggable / closable floating panels and their manager (ESC closes the top-most). */
import type { GameContext, PanelsApi } from '../game/context';
import { loadPref, savePref } from '../game/settings';
import { h } from './dom';
import { icon } from './icons';
import { uiZoom } from './zoom';

/** min real ms between two data-only rebuilds of a panel's content (Panel.gate; the inspector's REBUILD_MS) */
export const PANEL_REBUILD_MS = 1000;

/** a saved panel position: its top-left and the size of the panel layer it was dragged in (css px) */
export interface SavedPos {
  x: number;
  y: number;
  W?: number;
  H?: number;
}

/**
 * Where a panel goes when the panel layer changes size from W0 × H0 to W × H (final fixes P12: after a 1920×1080 →
 * 1280×720 resize the Data views panel sat mid-screen): it keeps the edge it is docked to — its gap to the right edge
 * when nearer the right, centred when about centred (centred panels also vertically), else its left — and is then kept
 * fully on screen below the top bar (top 64; a panel taller than the layer keeps its top there).
 */
export function anchoredPos(x: number, y: number, w: number, hgt: number, W0: number, H0: number, W: number, H: number, center = false): { x: number; y: number } {
  if (W0 > 0 && W0 !== W) {
    const left = x, right = W0 - (x + w);
    if (Math.abs(left - right) <= 48) x = (W - w) / 2;
    else if (right < left) x = W - w - right;
  }
  if (center && H0 > 0 && H0 !== H) {
    const top = y, bottom = H0 - (y + hgt);
    if (Math.abs(top - bottom) <= 96) y = Math.round((H - hgt) / 2) - 20;
  }
  x = Math.max(4, Math.min(W - w - 4, x));
  y = Math.max(64, Math.min(H - hgt - 8, y));
  return { x: Math.round(x), y: Math.round(y) };
}

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
  /** the panel layer changed size or the panel was moved (after the manager re-anchored it): re-measure what depends
   *  on the layout */
  onLayout(): void {}

  // ---- rebuild gate (final fixes A1)
  private gateKey = '\0';
  private gateSig = '';
  private gateAt = -Infinity;
  /**
   * For panels that rebuild their content from a signature: true (rebuild now) when `sig` differs from the last build's
   * and either `key` — what is shown: tab, target — changed or at least `minMs` of real time passed since that build.
   * At ultra speed the city's numbers change several times a second, and a whole-content rebuild on every 6 Hz UI tick
   * (plus the layout it forces) cost several ms per open panel. resetGate() lets the next call through (a tab switch,
   * a click).
   */
  protected gate(key: string, sig: string, minMs = PANEL_REBUILD_MS): boolean {
    if (key === this.gateKey && sig === this.gateSig) return false;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (key === this.gateKey && now - this.gateAt < minMs) return false;
    this.gateKey = key;
    this.gateSig = sig;
    this.gateAt = now;
    return true;
  }
  protected resetGate(): void {
    this.gateKey = '\0';
  }
}

export class PanelManager implements PanelsApi {
  private panels = new Map<string, Panel>();
  private order: string[] = [];
  private z = 10;
  /** last measured height of each open panel (content growth re-checks the toolbar clearance) */
  private lastH = new Map<string, number>();
  /** the panel layer's size at the last open / resize (css px): resizes re-anchor open panels from it */
  private layerW = 0;
  private layerH = 0;
  /**
   * watches the open panels' sizes (final fixes A1: tick() read every panel's offsetHeight right after its update, one
   * forced layout per panel per UI tick); without ResizeObserver tick() reads them once, after all updates
   */
  private ro: ResizeObserver | null = null;
  private byEl = new Map<Element, Panel>();
  constructor(private ctx: GameContext, private layer: HTMLElement) {
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver((entries) => this.onResized(entries));
      ctx.signal?.addEventListener('abort', () => this.ro?.disconnect(), { once: true });
    }
  }

  /** a panel's size changed (new rows, a tab switch): keep it clear of the toolbar */
  private onResized(entries: readonly ResizeObserverEntry[]): void {
    for (const e of entries) {
      const p = this.byEl.get(e.target);
      if (!p || !p.isOpen || p.el.classList.contains('closing')) continue;
      if (p.el.offsetHeight !== this.lastH.get(p.id)) this.keepAboveToolbar(p);
    }
  }

  /** right edge (layer css px) of the top-left HUD column — toasts and the onboarding card — or 0 */
  private hudColumnRight(): number {
    const tl = this.ctx.root?.querySelector?.('.hud-tl') as HTMLElement | null;
    if (!tl) return 0;
    const z = uiZoom();
    const lr = this.layer.getBoundingClientRect(), r = tl.getBoundingClientRect();
    return r.width > 0 ? (r.right - lr.left) / z : 0;
  }

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

  /** open (or focus) a panel; opts.silent: the action that opened it already made its sound (inspect ping, jump) */
  open(id: string, opts: { silent?: boolean } = {}): void {
    const p = this.panels.get(id);
    if (!p) return;
    if (!p.el) {
      p.mount(() => this.close(id), () => this.focus(id), () => {
        // (with the layer size it was dragged in: a later open in another window size re-anchors it, see open)
        const pos: SavedPos = { x: p.el.offsetLeft, y: p.el.offsetTop, W: this.layer.clientWidth, H: this.layer.clientHeight };
        savePref('panel.' + id, pos);
        p.onLayout();
      });
      this.byEl.set(p.el, p);
    }
    if (p.isOpen) {
      this.focus(id);
      return;
    }
    p.isOpen = true;
    p.el.classList.remove('closing');
    this.layer.appendChild(p.el);
    const W = this.layer.clientWidth, H = this.layer.clientHeight;
    this.layerW = W;
    this.layerH = H;
    const saved = loadPref<SavedPos | null>('panel.' + id, null);
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      // a position dragged in another window size keeps its docked edge; any saved one stays fully on screen
      const a = anchoredPos(saved.x, saved.y, p.el.offsetWidth || p.width, p.el.offsetHeight, saved.W ?? W, saved.H ?? H, W, H, p.center);
      p.setPos(a.x, a.y);
    } else {
      const pos = this.freeSpot(p);
      p.setPos(pos.x, pos.y);
    }
    if (p.el.offsetTop + p.el.offsetHeight > H - 8) p.setPos(p.el.offsetLeft, Math.max(64, H - p.el.offsetHeight - 12));
    this.ro?.observe(p.el);
    this.focus(id);
    try {
      p.onOpen();
      p.update();
    } catch (e) {
      console.error('[ui] panel error', id, e);
    }
    this.keepAboveToolbar(p);
    if (!opts.silent) this.ctx.sound('open');
    this.ctx.ui.emit('panel', { id, open: true });
  }

  /**
   * default position, shifted left (or down) so it doesn't cover already-open panels — never into the top-left HUD
   * column, where the toasts would cover its title and tabs (final fixes, routed from emergency r1: at 1280×720 the
   * Budget panel opened beside Advisors & news slid under the toasts). A centred panel with no free spot keeps its
   * default place on top of the others (it has the focus).
   */
  private freeSpot(p: Panel): { x: number; y: number } {
    const W = this.layer.clientWidth, H = this.layer.clientHeight;
    let { x, y } = p.defaultPos(W, H);
    const w = p.width, h = Math.min(p.el.offsetHeight || 400, H - 180);
    if (p.center) y = Math.max(64, Math.round((H - h) / 2) - 20);
    y = Math.max(64, Math.min(y, H - h - 12));
    const x0 = x, y0 = y;
    const minLeft = Math.max(12, Math.ceil(this.hudColumnRight()) + 12);
    const others = this.order.map((id) => this.panels.get(id)!).filter((o) => o && o !== p && o.isOpen);
    for (let guard = 0; guard < 8; guard++) {
      const hit = others.find((o) => {
        const ox = o.el.offsetLeft, oy = o.el.offsetTop, ow = o.el.offsetWidth, oh = o.el.offsetHeight;
        return x < ox + ow - 40 && x + w > ox + 40 && y < oy + oh - 40 && y + h > oy + 40;
      });
      if (!hit) break;
      const left = hit.el.offsetLeft - w - 12;
      if (left >= minLeft) x = left;
      else if (p.center) return { x: x0, y: y0 };
      else {
        x = Math.min(W - w - 14, x + 28);
        y = Math.min(y + 28, H - h - 12);
      }
    }
    return { x, y };
  }

  /** close a panel; opts.silent: the action that closed it already made its sound (e.g. Demolish) */
  close(id: string, opts: { silent?: boolean } = {}): void {
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
    this.ro?.unobserve(el);
    setTimeout(() => {
      if (!p.isOpen && el.parentElement) el.remove();
    }, 150);
    if (!opts.silent) this.ctx.sound('close');
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

  /** refresh open panels: every update first, then (without a ResizeObserver) one pass of height reads */
  tick(): void {
    const open: Panel[] = [];
    for (const id of [...this.order]) {
      const p = this.panels.get(id);
      if (!p?.isOpen) continue;
      try {
        p.update();
      } catch (e) {
        console.error('[ui] panel update error', id, e);
      }
      open.push(p);
    }
    // content grew (tab switch, new rows): keep it clear of the toolbar (the ResizeObserver reports it otherwise)
    if (this.ro) return;
    const grown = open.filter((p) => p.isOpen && p.el.offsetHeight !== this.lastH.get(p.id));
    for (const p of grown) this.keepAboveToolbar(p);
  }

  /** after a resize: re-anchor the open panels to the edge they are docked to (anchoredPos), fully on screen */
  clampAll(): void {
    const W = this.layer.clientWidth, H = this.layer.clientHeight;
    const W0 = this.layerW || W, H0 = this.layerH || H;
    this.layerW = W;
    this.layerH = H;
    for (const id of this.order) {
      const p = this.panels.get(id);
      if (!p?.isOpen) continue;
      const a = anchoredPos(p.el.offsetLeft, p.el.offsetTop, p.el.offsetWidth, p.el.offsetHeight, W0, H0, W, H, p.center);
      p.setPos(a.x, a.y);
      this.keepAboveToolbar(p);
      try {
        p.onLayout();
      } catch (e) {
        console.error('[ui] panel layout error', id, e);
      }
    }
  }
}
