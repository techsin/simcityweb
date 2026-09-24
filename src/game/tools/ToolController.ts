/**
 * ToolController — routes LEFT-button pointer events on the canvas to the active tool (middle/right are left to the
 * camera controller). Pointer moves are coalesced and processed once per frame.
 */
import type { Overlay } from '../../core/types';
import type { GameContext } from '../context';
import { categoryOfTool, findToolSpec } from '../toolCatalog';
import { QueryTool } from './QueryTool';
import type { Tool, ToolPointer } from './Tool';

/** tool-select sound transposition per toolbar category (semitones, C major pentatonic) */
const TOOL_PITCH: Record<string, number> = { zones: 0, transport: 2, utilities: 4, civic: 7, parks: 9, landmarks: 12, terrain: -5, bulldoze: -8 };

export class ToolController {
  private current: Tool;
  private readonly defaultTool: Tool;
  private lastEvt: PointerEvent | null = null;
  private moveDirty = false;
  /** performance.now() of the last idle hover refresh (query tool) */
  private hoverRefreshAt = 0;
  private leftDown = false;
  /** the right button was already held during the current left drag (chorded cancel is tried once per press) */
  private chord = false;
  private inside = false;
  private shift = false;
  private offs: (() => void)[] = [];
  private cache = new Map<string, Tool>();
  private autoOverlayOn: Overlay | null = null;

  constructor(private ctx: GameContext, private canvas: HTMLCanvasElement) {
    this.defaultTool = new QueryTool(ctx);
    this.current = this.defaultTool;
    this.attach(canvas);
  }

  /** (re)bind pointer listeners to a canvas */
  attach(canvas: HTMLCanvasElement): void {
    for (const f of this.offs) f();
    this.offs = [];
    this.canvas = canvas;
    const on = <K extends keyof HTMLElementEventMap>(t: HTMLElement | Window, k: K, f: (e: HTMLElementEventMap[K]) => void) => {
      t.addEventListener(k, f as EventListener);
      this.offs.push(() => t.removeEventListener(k, f as EventListener));
    };
    on(canvas, 'pointerdown', (e) => {
      if (e.button === 2 || e.button === 1) {
        if (e.button === 2 && this.cancelDrag()) this.ctx.sound('cancel');
        return;
      }
      if (e.button !== 0) return;
      this.leftDown = true;
      this.lastEvt = e;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.safeCall(() => this.current.down(this.pointer(e)!));
    });
    on(canvas, 'pointermove', (e) => {
      // the left button let go while the right one is still held: pointer events report that as a move, not a
      // pointerup (which only fires once every button is up) - without this a brush kept painting until the next click
      if (this.leftDown && (e.buttons & 1) === 0) this.endLeft(e);
      // chorded right button while dragging (pointer events report it as a move, not a pointerdown) = cancel: tried
      // once per right press (every later move reports the same buttons), audible only when a drag was cancelled
      // (brush / query / plop tools have nothing to cancel and keep going)
      const chord = this.leftDown && (e.buttons & 2) !== 0;
      if (chord && !this.chord && this.cancelDrag()) this.ctx.sound('cancel');
      this.chord = chord;
      this.inside = true;
      this.lastEvt = e;
      this.moveDirty = true;
      this.ctx.tip.move(e.clientX, e.clientY);
    });
    on(canvas, 'contextmenu', (e) => {
      if (this.cancelDrag()) e.preventDefault();
    });
    on(canvas, 'pointerup', (e) => {
      if (e.button !== 0 || !this.leftDown) return;
      this.endLeft(e);
    });
    on(canvas, 'pointercancel', () => {
      this.leftDown = false;
      this.current.cancel();
    });
    on(canvas, 'pointerleave', () => {
      this.inside = false;
      if (!this.leftDown) this.safeCall(() => this.current.leave());
    });
    on(canvas, 'pointerenter', () => (this.inside = true));
    on(window, 'blur', () => {
      this.shift = false;
      if (this.leftDown) {
        this.leftDown = false;
        this.current.cancel();
      }
    });
    this.applyCursor();
  }

  /** the left button went up: finish the tool's drag */
  private endLeft(e: PointerEvent): void {
    this.leftDown = false;
    this.chord = false;
    this.lastEvt = e;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.safeCall(() => this.current.up(this.pointer(e)!));
  }

  get active(): Tool {
    return this.current;
  }
  get activeId(): string | null {
    return this.current === this.defaultTool ? null : this.current.id;
  }

  private safeCall(f: () => void): void {
    try {
      f();
    } catch (e) {
      console.error('[tools] tool error', e);
    }
  }

  private pointer(e: PointerEvent | null): ToolPointer | null {
    if (!e) return null;
    let hit = null;
    try {
      hit = this.ctx.world.pickCell(e.clientX, e.clientY);
    } catch {
      hit = null;
    }
    return { clientX: e.clientX, clientY: e.clientY, hit, shift: e.shiftKey || this.shift, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, down: this.leftDown };
  }

  /** current pointer state (for key handlers) */
  currentPointer(): ToolPointer | null {
    return this.inside || this.leftDown ? this.pointer(this.lastEvt) : null;
  }

  /**
   * select a tool by id; null = default query tool. Returns false if the tool is locked / unknown.
   * Plays the tool sound (pitched per toolbar category along the pentatonic scale) unless opts.silent.
   */
  select(id: string | null, opts: { silent?: boolean } = {}): boolean {
    if (id === 'query') id = null;
    let next: Tool = this.defaultTool;
    if (id) {
      const spec = findToolSpec(this.ctx, id);
      if (!spec) {
        console.warn('[tools] unknown tool', id);
        return false;
      }
      if (spec.locked) {
        this.ctx.sound('error');
        this.ctx.toast(`${spec.label} is locked — ${spec.locked.hint}`, 'warning');
        return false;
      }
      if (spec.disabled) {
        this.ctx.sound('error');
        this.ctx.toast(`${spec.label}: ${spec.disabled}`, 'warning');
        return false;
      }
      next = this.cache.get(id) ?? spec.create(this.ctx);
      if (!id.startsWith('plop:')) this.cache.set(id, next);
    }
    if (next === this.current) return true;
    if (!opts.silent) this.playSelectSound(id, next === this.defaultTool);
    this.safeCall(() => this.current.deactivate());
    // restore the data view we switched on automatically (unless the player changed it meanwhile)
    if (this.autoOverlayOn !== null && this.ctx.overlay === this.autoOverlayOn && next.autoOverlay !== this.autoOverlayOn) {
      this.ctx.setOverlay(0 as Overlay);
    }
    this.autoOverlayOn = null;
    // never let the previous tool's cursor tip linger (e.g. "Lower terrain" while Level is active)
    this.ctx.tip.hide();
    this.current = next;
    this.safeCall(() => this.current.activate());
    const ao = this.current.autoOverlay;
    if (ao !== null && (this.ctx.overlay === 0 || this.ctx.overlay === ao)) {
      if (this.ctx.overlay !== ao) this.ctx.setOverlay(ao);
      this.autoOverlayOn = ao;
    }
    this.applyCursor();
    try {
      this.ctx.world.setGridVisible(this.ctx.settings.showGrid && this.current.wantsGrid && this.current !== this.defaultTool);
    } catch {
      /* ignore */
    }
    if (this.inside && !this.leftDown && this.lastEvt) {
      // recompute the new tool's hover preview / tip now instead of waiting for the next frame or mouse move
      const p = this.pointer(this.lastEvt);
      if (p) this.safeCall(() => this.current.move(p));
      this.moveDirty = false;
    } else if (this.inside) this.moveDirty = true;
    this.ctx.ui.emit('tool', this.activeId);
    return true;
  }

  private playSelectSound(id: string | null, putAway: boolean): void {
    if (putAway || !id) {
      this.ctx.sound('toolOff');
      return;
    }
    let cat = '';
    try {
      cat = categoryOfTool(this.ctx, id) ?? '';
    } catch {
      /* ignore */
    }
    const semis = TOOL_PITCH[cat] ?? (id.startsWith('disaster:') ? -8 : 0);
    this.ctx.sound('toolSelect', { pitch: Math.pow(2, semis / 12) });
  }

  private applyCursor(): void {
    this.canvas.style.cursor = this.current.cursor;
  }

  /** Esc: cancel the drag if any. Returns true if something was cancelled. */
  cancelDrag(): boolean {
    const r = this.current.cancel();
    if (r) this.leftDown = false;
    return r;
  }

  /** forward key events to the tool; true = consumed */
  key(e: KeyboardEvent): boolean {
    if (e.key === 'Shift') {
      this.shift = e.type === 'keydown';
      this.moveDirty = true;
    }
    let used = false;
    this.safeCall(() => (used = this.current.key(e, this.currentPointer())));
    return used;
  }

  frame(dt: number): void {
    // the query tool's hover tip shows live state (an empty lot gets power, a building grows...): re-read it about
    // once a second while the cursor rests on the map
    if (!this.moveDirty && !this.leftDown && this.inside && this.lastEvt && this.current === this.defaultTool) {
      const now = performance.now();
      if (now - this.hoverRefreshAt >= 1000) {
        this.hoverRefreshAt = now;
        this.moveDirty = true;
      }
    }
    if (this.moveDirty && this.lastEvt && (this.inside || this.leftDown)) {
      this.moveDirty = false;
      const p = this.pointer(this.lastEvt);
      if (p) this.safeCall(() => this.current.move(p));
    }
    if (this.leftDown) {
      const p = this.pointer(this.lastEvt);
      this.safeCall(() => this.current.frame(dt, p));
    }
  }

  /** re-run the hover preview (e.g. after funds / state changed) */
  refresh(): void {
    this.moveDirty = true;
  }

  dispose(): void {
    this.current.deactivate();
    for (const f of this.offs) f();
  }
}
