/**
 * ToolController — routes LEFT-button pointer events on the canvas to the active tool (middle/right are left to the
 * camera controller). Pointer moves are coalesced and processed once per frame.
 */
import type { GameContext } from '../context';
import { findToolSpec } from '../toolCatalog';
import { QueryTool } from './QueryTool';
import type { Tool, ToolPointer } from './Tool';

export class ToolController {
  private current: Tool;
  private readonly defaultTool: Tool;
  private lastEvt: PointerEvent | null = null;
  private moveDirty = false;
  private leftDown = false;
  private inside = false;
  private shift = false;
  private offs: (() => void)[] = [];
  private cache = new Map<string, Tool>();

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
        if (e.button === 2 && this.current.cancel()) this.ctx.sound('cancel');
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
      this.inside = true;
      this.lastEvt = e;
      this.moveDirty = true;
      this.ctx.tip.move(e.clientX, e.clientY);
    });
    on(canvas, 'pointerup', (e) => {
      if (e.button !== 0 || !this.leftDown) return;
      this.leftDown = false;
      this.lastEvt = e;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.safeCall(() => this.current.up(this.pointer(e)!));
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

  /** select a tool by id; null = default query tool. Returns false if the tool is locked / unknown. */
  select(id: string | null): boolean {
    if (id === 'query') id = null;
    let next: Tool = this.defaultTool;
    if (id) {
      const spec = findToolSpec(this.ctx, id);
      if (!spec) {
        console.warn('[tools] unknown tool', id);
        return false;
      }
      if (spec.locked) {
        this.ctx.toast(`${spec.label} is locked — ${spec.locked.hint}`, 'warning');
        this.ctx.sound('error');
        return false;
      }
      if (spec.disabled) {
        this.ctx.toast(`${spec.label}: ${spec.disabled}`, 'warning');
        this.ctx.sound('error');
        return false;
      }
      next = this.cache.get(id) ?? spec.create(this.ctx);
      if (!id.startsWith('plop:')) this.cache.set(id, next);
    }
    if (next === this.current) return true;
    this.safeCall(() => this.current.deactivate());
    this.current = next;
    this.safeCall(() => this.current.activate());
    this.applyCursor();
    try {
      this.ctx.world.setGridVisible(this.ctx.settings.showGrid && this.current.wantsGrid && this.current !== this.defaultTool);
    } catch {
      /* ignore */
    }
    if (this.inside) this.moveDirty = true;
    this.ctx.ui.emit('tool', this.activeId);
    return true;
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
