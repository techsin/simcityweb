/** Photo controls override only the displayed clock; settings and the HUD's layout stay intact. */
import type { GameContext } from '../game/context';
import { h, slider } from './dom';
import { hourLabel } from './format';
import './fx.css';

export function photoSize(width: number, height: number): [number, number] {
  const scale = Math.min(1, 4096 / Math.max(1, width, height));
  return [Math.max(16, Math.round(width * scale)), Math.max(16, Math.round(height * scale))];
}

export function photoFilename(name: string, day: number, startYear: number): string {
  const y = startYear + Math.floor(day / 360), m = Math.floor(day % 360 / 30) + 1, d = day % 30 + 1;
  return `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'City'}-${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}.png`;
}

export class PhotoBar {
  private bar: HTMLElement | null = null;
  private clock: { hour: number; auto: boolean; scale: number; at: number } | null = null;
  private hour = 12;
  private wasInert = false;
  private hadClass = false;
  private focus: HTMLElement | null = null;
  private offs: (() => void)[] = [];
  private controlsAbort: AbortController | null = null;

  constructor(private ctx: GameContext, private scene: HTMLElement, private now = () => performance.now()) {
    ctx.signal.addEventListener('abort', () => this.exit(), { once: true });
  }

  get active(): boolean { return !!this.clock; }

  enter(): void {
    if (this.active || this.ctx.signal.aborted) return;
    const ctx = this.ctx, w = ctx.world as GameContext['world'] & { timeScale?: number };
    const signal = (this.controlsAbort = new AbortController()).signal;
    this.clock = { hour: w.timeOfDay, auto: w.autoTime, scale: w.timeScale ?? 2, at: this.now() };
    this.hour = w.timeOfDay;
    this.focus = document.activeElement as HTMLElement | null;
    this.wasInert = ctx.root.inert;
    this.hadClass = this.scene.classList.contains('photo-mode');
    ctx.root.inert = true;
    this.scene.classList.add('photo-mode');
    // End any held gesture without changing the selected tool or its automatic overlay.
    ctx.canvas.dispatchEvent(new Event('pointercancel'));
    ctx.tools.active.leave();
    ctx.tip.hide();
    const value = h('span', { class: 'opt-val' }, hourLabel(this.hour));
    const scrub = slider({ signal, min: 0, max: 24, step: 0.05, value: this.hour, oninput: (hour) => {
      this.hour = hour;
      value.textContent = hourLabel(hour);
      this.frame();
    } });
    scrub.setAttribute('aria-label', 'Photo time of day');
    const pause = h('button', { type: 'button', class: 'btn' }, ctx.host.speed ? 'Pause' : 'Resume');
    pause.addEventListener('click', () => {
      if (ctx.host.speed) ctx.host.setSpeed(0, 'keyboard');
      else ctx.host.resume('keyboard');
      pause.textContent = ctx.host.speed ? 'Pause' : 'Resume';
    }, { signal });
    const capture = h('button', { type: 'button', class: 'btn primary' }, 'Capture PNG');
    const status = h('span', { role: 'status' });
    capture.addEventListener('click', () => {
      try { this.capture(); status.textContent = 'Captured'; }
      catch { status.textContent = 'Capture failed'; }
    }, { signal });
    const exit = h('button', { type: 'button', class: 'btn' }, 'Exit');
    exit.addEventListener('click', () => this.exit(), { signal });
    this.bar = h('div', { class: 'photo-bar mp-glass', role: 'toolbar', 'aria-label': 'Photo mode' }, h('span', null, 'Time'), scrub, value, pause, capture, exit, status);
    this.scene.appendChild(this.bar);
    // Left drag pans in photo mode; the active building tool receives no down event.
    const pan = (e: PointerEvent) => {
      if (e.button !== 0) return;
      (ctx.world.controls as { beginPan?: (x: number, y: number) => void }).beginPan?.(e.clientX, e.clientY);
      e.stopImmediatePropagation();
    };
    ctx.canvas.addEventListener('pointerdown', pan, { capture: true, signal });
    this.offs.push(() => ctx.canvas.removeEventListener('pointerdown', pan, true));
    this.frame();
    exit.focus();
  }

  frame(): void {
    if (!this.active) return;
    this.ctx.world.autoTime = false;
    this.ctx.world.timeOfDay = this.hour;
  }

  capture(): string {
    const ctx = this.ctx;
    const [width, height] = photoSize(ctx.canvas.width || ctx.canvas.clientWidth, ctx.canvas.height || ctx.canvas.clientHeight);
    const png = ctx.world.capture(width, height, false);
    if (!png.startsWith('data:image/png')) throw new Error('PNG capture unavailable');
    const a = h('a', { href: png, download: photoFilename(ctx.state.config.name, ctx.state.day, ctx.state.config.startYear) });
    this.scene.appendChild(a);
    a.click();
    a.remove();
    return png;
  }

  exit(): void {
    const saved = this.clock;
    if (!saved) return;
    this.clock = null;
    this.controlsAbort?.abort();
    this.controlsAbort = null;
    const w = this.ctx.world;
    w.autoTime = saved.auto;
    w.timeOfDay = (saved.hour + (saved.auto ? Math.max(0, this.now() - saved.at) / 1000 * saved.scale / 60 : 0)) % 24;
    this.scene.classList.toggle('photo-mode', this.hadClass);
    this.ctx.root.inert = this.wasInert;
    this.bar?.remove();
    this.bar = null;
    for (const off of this.offs) off();
    this.offs = [];
    if (!this.ctx.signal.aborted) {
      this.ctx.tools.refresh();
      if (this.focus?.isConnected) this.focus.focus({ preventScroll: true });
    }
    this.focus = null;
  }
}
