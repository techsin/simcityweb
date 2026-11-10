/**
 * FEEL-03 (a), money you can feel: a cost float at the cursor on every paid commit, "−§25,018" in red or "+§1,200 refund"
 * in green, with a plop's upkeep under it ("+§700/mo"). Paid actions only played a sound, so the coal plant's §25,018
 * went by with no on-screen beat (shots2/017 → 018).
 * - Tool.ts's `commitAction` calls `cost()` once per commit, from its ok path (the exact prediction or the
 *   acknowledgement, never a failure), so every tool and the inspector's demolition get it; it checks the sandbox.
 * - Pooled: at most FLOAT_POOL elements, made on first use; one more float reuses the oldest.
 * - It rises FLOAT_RISE px and fades over FLOAT_MS with the Web Animations API, transform and opacity only, from the
 *   pointer position CityScene already tracks. The layer is fixed to the viewport outside the zoomed `.mp-ui`, so client
 *   coordinates need no rect; the float scales by the UI zoom instead.
 * - No forced layout: nothing here reads layout, and every DOM write waits for one animation-frame callback. CityScene's
 *   frame loop registers its callback first, so these writes come after that frame's reads (the camera's edge scroll
 *   reads the canvas size each frame), never between a read and the paint. The float shows in the frame that follows
 *   the commit, well within the plan's 100 ms.
 * - The commits of one gesture within FLOAT_MERGE_MS add up in one float (a held brush commits every 70-120 ms).
 * - Reduced motion (`resolveMotion`): the float stands still for FLOAT_MS, then goes.
 */
import './floatText.css';
import type { GameContext } from '../game/context';
import { resolveMotion } from '../game/settings';
import { h, setText } from './dom';
import { money, moneySigned } from './format';
import { uiZoom } from './zoom';

/** life of a float (ms) */
export const FLOAT_MS = 900;
/** how far it rises (UI px) */
export const FLOAT_RISE = 28;
/** at most this many float elements */
export const FLOAT_POOL = 6;
/** commits of one gesture this close (ms) share one float */
export const FLOAT_MERGE_MS = 250;

export interface PointerPos {
  readonly x: number;
  readonly y: number;
}

interface Slot {
  el: HTMLElement;
  costEl: HTMLElement;
  subEl: HTMLElement;
  /** spawn time (performance.now); -Infinity: never used */
  t0: number;
  /** spawns so far: a queued draw is stale once a newer float took the element */
  gen: number;
  key: object | null;
  sum: number;
  upkeep: number;
  anim: Animation | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** a cost float's main line: "−§25,018" for money paid, "+§1,200 refund" for money back; null for nothing */
export function costText(cost: number): { text: string; cls: 'neg' | 'pos' } | null {
  const v = Math.round(cost);
  if (!v) return null;
  return v > 0 ? { text: moneySigned(-v), cls: 'neg' } : { text: `${moneySigned(-v)} refund`, cls: 'pos' };
}

/** a plop's upkeep line, "+§700/mo"; '' for none */
export function upkeepText(upkeep: number): string {
  const v = Math.round(upkeep);
  return v > 0 ? `+${money(v)}/mo` : '';
}

export class FloatText {
  readonly layer: HTMLElement;
  private slots: Slot[] = [];
  /** DOM writes waiting for the next animation frame, in order, and its request (0: none) */
  private ops: (() => void)[] = [];
  private raf = 0;

  constructor(parent: HTMLElement, private pointer: () => PointerPos, private reduced: () => boolean, private signal: AbortSignal) {
    this.layer = h('div', { class: 'ft-layer', 'aria-hidden': 'true' });
    parent.appendChild(this.layer);
    signal.addEventListener('abort', () => this.dispose(), { once: true });
  }

  /** float `cost` (+ paid, − refunded) and a plop's monthly `upkeep` at the pointer; `key` (the gesture) merges a
   *  burst of commits into one float. False: nothing shown (no cost, no pointer yet, disposed). */
  cost(cost: number, upkeep = 0, key: object | null = null): boolean {
    if (this.signal.aborted) return false;
    const now = performance.now();
    if (key) {
      const s = this.slots.find((x) => x.key === key && now - x.t0 < FLOAT_MERGE_MS);
      if (s) {
        s.sum += cost;
        s.upkeep += upkeep;
        this.later(() => this.render(s));
        return true;
      }
    }
    if (!Math.round(cost)) return false;
    const p = this.pointer();
    if (!(p.x >= 0 && p.y >= 0)) return false;
    const s = this.take(now);
    Object.assign(s, { t0: now, key, sum: cost, upkeep });
    const gen = ++s.gen, { x, y } = p;
    this.later(() => {
      // a newer float took this element since: its own draw sees to it
      if (s.gen !== gen) return;
      this.stop(s);
      // the frame came too late (a hidden tab, a long task): nothing to draw, and nothing an older float left may stay
      // up (reduced motion: its hide was queued under the older generation, which this float ended)
      if (performance.now() - now >= FLOAT_MS) {
        if (s.el.className !== 'ft') s.el.className = 'ft';
        return;
      }
      this.render(s);
      this.play(s, x, y);
    });
    return true;
  }

  /** floats alive now (tests) */
  get active(): number {
    const now = performance.now();
    return this.slots.filter((s) => now - s.t0 < FLOAT_MS).length;
  }

  /** an idle slot, a new one while the pool has room, else the oldest */
  private take(now: number): Slot {
    const idle = this.slots.find((x) => now - x.t0 >= FLOAT_MS);
    if (idle) return idle;
    if (this.slots.length < FLOAT_POOL) {
      const costEl = h('div', { class: 'ft-cost' }), subEl = h('div', { class: 'ft-sub' });
      const el = h('div', { class: 'ft' }, h('div', { class: 'ft-in' }, costEl, subEl));
      this.later(() => this.layer.appendChild(el));
      const s: Slot = { el, costEl, subEl, t0: -Infinity, gen: 0, key: null, sum: 0, upkeep: 0, anim: null, timer: null };
      this.slots.push(s);
      return s;
    }
    return this.slots.reduce((a, b) => (b.t0 < a.t0 ? b : a));
  }

  /** queue a DOM write for the next animation frame (one request per frame) */
  private later(op: () => void): void {
    this.ops.push(op);
    if (this.raf) return;
    const flush = () => {
      this.raf = 0;
      const ops = this.ops;
      this.ops = [];
      if (!this.signal.aborted) for (const f of ops) f();
    };
    this.raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flush) : (queueMicrotask(flush), -1);
  }

  private render(s: Slot): void {
    const c = costText(s.sum);
    setText(s.costEl, c?.text ?? '');
    const cls = `ft-cost ${c?.cls ?? ''}`.trim();
    if (s.costEl.className !== cls) s.costEl.className = cls;
    setText(s.subEl, upkeepText(s.upkeep));
  }

  private play(s: Slot, x: number, y: number): void {
    const z = uiZoom();
    const at = `translate(${x}px, ${y}px) scale(${z})`;
    if (this.reduced() || typeof s.el.animate !== 'function') {
      // still: it shows where it was made, then goes
      s.el.style.transform = at;
      s.el.className = 'ft on';
      const gen = s.gen;
      s.timer = setTimeout(() => {
        s.timer = null;
        this.later(() => { if (s.gen === gen) s.el.className = 'ft'; });
      }, FLOAT_MS);
      return;
    }
    s.el.className = 'ft';
    try {
      s.anim = s.el.animate([
        // the rise eases out over the whole life; the fade waits past half of it
        { transform: at, opacity: 0, offset: 0, easing: 'cubic-bezier(0.22, 0.8, 0.36, 1)' },
        { opacity: 1, offset: 0.08 },
        { opacity: 1, offset: 0.55 },
        { transform: `translate(${x}px, ${y - FLOAT_RISE * z}px) scale(${z})`, opacity: 0, offset: 1 },
      ], { duration: FLOAT_MS });
    } catch {
      s.anim = null;
    }
  }

  private stop(s: Slot): void {
    s.anim?.cancel();
    s.anim = null;
    if (s.timer !== null) clearTimeout(s.timer);
    s.timer = null;
  }

  private dispose(): void {
    if (this.raf > 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ops = [];
    for (const s of this.slots) this.stop(s);
    this.slots = [];
    this.layer.remove();
  }
}

/** one float layer per city (CityScene attaches it; Tool.ts finds it by the context, no GameContext field needed) */
const layers = new WeakMap<object, FloatText>();

/** CityScene: the city's float layer in `parent`, at the pointer `pointer()` tracks (client px; x < 0: unknown) */
export function attachFloatText(ctx: GameContext, parent: HTMLElement, pointer: () => PointerPos): FloatText {
  const ft = new FloatText(parent, pointer, () => resolveMotion(ctx.settings?.motion ?? 'system') === 'reduced', ctx.signal);
  layers.set(ctx, ft);
  return ft;
}

/** the city's float layer (undefined in a context CityScene did not build, e.g. a test's) */
export function floatTextOf(ctx: object): FloatText | undefined {
  return layers.get(ctx);
}
