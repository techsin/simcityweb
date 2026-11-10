/** Photo controls override only the displayed clock; settings and the HUD's layout stay intact. */
import { Overlay } from '../core/types';
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

/** The PNG as a Blob: a download from a blob: link starts at once, a data: link of a 4096 px picture took a second more. */
export function pngBlob(dataUrl: string): Blob {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

/** what the scene knows and the bar uses when it is there */
export interface PhotoHooks {
  /** the building the inspector shows: its selection box comes back on leaving */
  inspected?: () => number | null;
  /** the speed Resume returns to when the game was already paused on entering (the scene's last running speed) */
  lastSpeed?: () => number;
  /** runs `f` after the next painted frame (default: an animation frame, then a task), so "Capturing…" shows first */
  afterPaint?: (f: () => void) => void;
}

const afterPaint = (f: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(f, 0));
  else setTimeout(f, 0);
};

export class PhotoBar {
  private bar: HTMLElement | null = null;
  private clock: { hour: number; auto: boolean; scale: number; at: number } | null = null;
  private hour = 12;
  private wasInert = false;
  private hadClass = false;
  private focus: HTMLElement | null = null;
  private offs: (() => void)[] = [];
  private controlsAbort: AbortController | null = null;
  private pauseBtn: HTMLElement | null = null;
  /** the speed the bar's Pause stopped (0: the bar has not paused) */
  private before = 0;
  private capturing = false;

  constructor(private ctx: GameContext, private scene: HTMLElement, private now = () => performance.now(), private hooks: PhotoHooks = {}) {
    ctx.signal.addEventListener('abort', () => this.exit(), { once: true });
  }

  get active(): boolean { return !!this.clock; }

  enter(): void {
    if (this.active || this.ctx.signal.aborted) return;
    const ctx = this.ctx, w = ctx.world as GameContext['world'] & { timeScale?: number };
    const signal = (this.controlsAbort = new AbortController()).signal;
    this.clock = { hour: w.timeOfDay, auto: w.autoTime, scale: w.timeScale ?? 2, at: this.now() };
    this.hour = w.timeOfDay;
    this.before = 0;
    this.capturing = false;
    this.focus = document.activeElement as HTMLElement | null;
    this.wasInert = ctx.root.inert;
    this.hadClass = this.scene.classList.contains('photo-mode');
    ctx.root.inert = true;
    this.scene.classList.add('photo-mode');
    // End any held gesture without changing the selected tool or its automatic overlay.
    ctx.canvas.dispatchEvent(new Event('pointercancel'));
    ctx.tools.active.leave();
    ctx.tip.hide();
    this.plain(true);
    const value = h('span', { class: 'opt-val' }, hourLabel(this.hour));
    const scrub = slider({ signal, min: 0, max: 24, step: 0.05, value: this.hour, oninput: (hour) => {
      this.hour = hour;
      value.textContent = hourLabel(hour);
      this.frame();
    } });
    scrub.setAttribute('aria-label', 'Photo time of day');
    const pause = this.pauseBtn = h('button', { type: 'button', class: 'btn' }, ctx.host.speed ? 'Pause' : 'Resume');
    pause.addEventListener('click', () => {
      // QA B5: Resume returns to the speed this Pause stopped, through setSpeed (host.resume() answers the pause menu's
      // own pause: it gave Normal for Fast, and nothing once the menu had been opened on a paused game)
      if (ctx.host.speed) {
        this.before = ctx.host.speed;
        ctx.host.setSpeed(0, 'keyboard');
      } else ctx.host.setSpeed(this.before || this.hooks.lastSpeed?.() || 1, 'keyboard');
      pause.textContent = ctx.host.speed ? 'Pause' : 'Resume';
    }, { signal });
    const capture = h('button', { type: 'button', class: 'btn primary' }, 'Capture PNG');
    const status = h('span', { role: 'status' });
    capture.addEventListener('click', () => {
      if (this.capturing) return;
      // QA B13: the render and its readback hold the main thread (0.6 s and more at the 4096 px cap): say so first
      this.capturing = true;
      capture.disabled = true;
      status.textContent = 'Capturing…';
      (this.hooks.afterPaint ?? afterPaint)(() => {
        if (signal.aborted) return;
        try { this.capture(); status.textContent = 'Captured'; }
        catch { status.textContent = 'Capture failed'; }
        this.capturing = false;
        capture.disabled = false;
      });
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
    // QA B9: a press in photo mode (on the bar, a right or middle drag on the map) stays below the document, where the
    // toolbar and the RCI popover listen for "a click outside": what they had open is part of the layout to restore
    this.scene.addEventListener('pointerdown', (e) => e.stopPropagation(), { signal });
    this.frame();
    exit.focus();
  }

  frame(): void {
    if (!this.active) return;
    this.ctx.world.autoTime = false;
    this.ctx.world.timeOfDay = this.hour;
    // (the speed can change under the bar: an emergency's pause, a command's acknowledgement on the worker host)
    const label = this.ctx.host.speed ? 'Pause' : 'Resume';
    if (this.pauseBtn && this.pauseBtn.textContent !== label) this.pauseBtn.textContent = label;
  }

  capture(): string {
    const ctx = this.ctx;
    const [width, height] = photoSize(ctx.canvas.width || ctx.canvas.clientWidth, ctx.canvas.height || ctx.canvas.clientHeight);
    const png = ctx.world.capture(width, height, false);
    if (!png.startsWith('data:image/png')) throw new Error('PNG capture unavailable');
    let href = png;
    try {
      href = URL.createObjectURL(pngBlob(png));
      // (the download has read it long before; an exit or a second capture does not wait for this)
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch {
      /* no Blob URLs here: the data: link downloads as well, only slower */
    }
    const a = h('a', { href, download: photoFilename(ctx.state.config.name, ctx.state.day, ctx.state.config.startYear) });
    this.scene.appendChild(a);
    a.click();
    a.remove();
    return png;
  }

  /**
   * QA B6: the picture shows the plain city. On entering, the Query tool's hover box, the build grid, the data view (a
   * tool's automatic one too) and the subway view go at the renderers; the HUD's own state (ctx.overlay, the selected
   * tool) is untouched, and leaving draws each again from it. A tool's ghost, path and brush went with its leave().
   */
  private plain(on: boolean): void {
    const ctx = this.ctx, tools = ctx.tools;
    const each = (...steps: (() => void)[]) => {
      for (const step of steps) {
        try { step(); } catch { /* a stand-in view without it */ }
      }
    };
    if (on) {
      each(
        () => (tools.active as { clearHover?: () => void }).clearHover?.(),
        () => ctx.objects.setSelected(null),
        () => ctx.world.setGridVisible(false),
        () => ctx.world.setOverlay(Overlay.None),
        () => ctx.objects.setOverlayMode(Overlay.None),
        () => ctx.objects.setUnderground(false),
      );
      return;
    }
    each(
      () => { if (ctx.overlay !== Overlay.None) ctx.setOverlay(ctx.overlay, ctx.overlayVariant); },
      () => ctx.world.setGridVisible(ctx.settings.showGrid && !!tools.activeId && tools.active.wantsGrid),
      () => { if (tools.activeId === 'subway') ctx.objects.setUnderground(true); },
      () => {
        const id = this.hooks.inspected?.() ?? null;
        if (id !== null) ctx.objects.setSelected(id);
      },
    );
  }

  exit(): void {
    const saved = this.clock;
    if (!saved) return;
    this.clock = null;
    this.controlsAbort?.abort();
    this.controlsAbort = null;
    this.pauseBtn = null;
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
      this.plain(false);
      // (the tool's own preview and the hover box come back with its next move)
      this.ctx.tools.refresh();
      if (this.focus?.isConnected) this.focus.focus({ preventScroll: true });
    }
    this.focus = null;
  }
}
