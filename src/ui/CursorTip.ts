/** Tooltip that follows the mouse over the 3D view (tool costs, validity, hover info). */
import type { CursorTipApi } from '../game/context';
import { h } from './dom';
import { uiZoom } from './zoom';

export class CursorTip implements CursorTipApi {
  readonly el: HTMLDivElement;
  private x = 0;
  private y = 0;
  private visible = false;
  private html = '';
  constructor(parent: HTMLElement) {
    this.el = h('div', { class: 'cursor-tip mp-glass' });
    parent.appendChild(this.el);
  }
  show(html: string, kind: 'ok' | 'bad' | 'info' = 'info'): void {
    if (html !== this.html) {
      this.html = html;
      this.el.innerHTML = html;
    }
    const cls = `cursor-tip mp-glass show ${kind}`;
    if (this.el.className !== cls) this.el.className = cls;
    this.visible = true;
    this.place();
  }
  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.el.className = 'cursor-tip mp-glass';
  }
  move(clientX: number, clientY: number): void {
    this.x = clientX;
    this.y = clientY;
    if (this.visible) this.place();
  }
  private place(): void {
    const z = uiZoom();
    const parent = this.el.parentElement!.getBoundingClientRect();
    let lx = (this.x - parent.left) / z + 18;
    let ly = (this.y - parent.top) / z + 20;
    const w = this.el.offsetWidth, hh = this.el.offsetHeight;
    const maxX = parent.width / z - w - 8, maxY = parent.height / z - hh - 8;
    if (lx > maxX) lx = (this.x - parent.left) / z - w - 14;
    if (ly > maxY) ly = (this.y - parent.top) / z - hh - 14;
    this.el.style.transform = `translate(${Math.round(lx)}px, ${Math.round(ly)}px)`;
  }
}
