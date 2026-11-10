/** Shared, interruptible camera travel for New Year and the city's firsts. Angles are degrees. */
import { CELL_SIZE } from '../core/constants';
import { isTyping } from '../ui/dom';
import { isBoundCode, isCameraCode } from './bindings';
import type { GameContext } from './context';
import { resolveMotion } from './settings';

export interface ShowView { x: number; z: number; d: number; tilt: number; yaw: number }
export interface ShowControls {
  enabled: boolean;
  readonly target: { x: number; z: number };
  readonly distance: number;
  readonly yawAngle: number;
  readonly tiltAngle: number;
  readonly baseTilt?: number;
  edgeScroll?: boolean;
  setView(x: number, z: number, distance: number, tilt?: number, yaw?: number): void;
  setShowView?(x: number, z: number, distance: number, tilt?: number, yaw?: number): void;
}

/**
 * What ends a session. By default any key, click, wheel step or touch does, and a bare pointer move does not (it only
 * counts as activity for the idle rule):
 *   - camera input (a camera key, the wheel or a middle / right press on the map) takes the camera where it is;
 *   - anything else returns the saved view, and the key or click that did it does nothing else (QA B1 / B8: the click
 *     went on to the bulldozer, Escape opened the pause menu). Chords, bare modifiers and keys typed into a text box
 *     end the show too, but keep their own job;
 *   - the browser's and the system's own keys (FOREIGN) are no input to the game: the show plays on.
 */
export interface ShowRules {
  /** the New Year show keeps the base game's rule: only a camera key, or a press, wheel step or touch on the map, ends
   *  it; the camera stays where it is and nothing is consumed */
  cameraOnly?: boolean;
  /** the map canvas (a press or a wheel step on it belongs to the camera or a tool) */
  canvas?: () => EventTarget | null | undefined;
  /** a key the camera acts on (the live bindings) */
  cameraKey?: (e: KeyboardEvent) => boolean;
  /** a key the game has an action on (the live bindings): a function key without one stays the browser's */
  gameKey?: (e: KeyboardEvent) => boolean;
}

/** the idle rule (FEEL-07): this long without input, and this long since the last show ended */
const IDLE_MS = 4000;
/** a consumed press swallows the click that follows its release within this long (a touch's click comes a little late) */
const CLICK_MS = 500;
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'OS']);
/** the browser's and the system's keys (reload, full screen, the developer tools, volume, media, print screen): unless
 *  the game has an action on one they are no input to it. A show plays on, and they are not counted as held (the
 *  release of some never arrives) */
const FOREIGN = /^(?:F\d{1,2}$|Audio|Media|Volume|Launch|Browser|PrintScreen$)/;

const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
export const readView = (c: ShowControls): ShowView => ({ x: c.target.x, z: c.target.z, d: c.distance, tilt: (c.baseTilt ?? c.tiltAngle) * 180 / Math.PI, yaw: c.yawAngle * 180 / Math.PI });
const consume = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
/** focus in a form control: the camera controller ignores its keys there (its isTypingTarget), so they move no camera */
const inField = (e: Event): boolean => {
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  return !!t && (t.isContentEditable === true || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
};

export class ShowCamera {
  session = 0;
  saved: ShowView | null = null;
  private ctl: ShowControls | null = null;
  private from: ShowView | null = null;
  private to: ShowView | null = null;
  private elapsed = 0;
  private duration = 0;
  private returning = false;
  private edge = false;
  private offs: (() => void)[] = [];
  private lastInput: number;
  private lastEnd = -Infinity;
  private held = false;
  private keys = new Set<string>();
  private disposed = false;
  private rules: ShowRules = {};
  /** the pointer whose press ended a show: its release and the click after it are swallowed too */
  private eatUp: number | null = null;
  private eatClickUntil = -Infinity;
  /** the key whose press ended a show: its release is swallowed too (Space clicks a focused button on release) */
  private eatKey: string | null = null;

  constructor(private controls: () => ShowControls | null, signal?: AbortSignal, private now = () => performance.now()) {
    this.lastInput = now();
    if (signal?.aborted) { this.disposed = true; return; }
    if (typeof window !== 'undefined') {
      // (capture on the window: these run before the tools, the camera and the HUD, so a consumed press reaches none)
      const on = (type: string, fn: (e: any) => void, passive = true) => {
        window.addEventListener(type, fn, { capture: true, passive, signal });
        this.offs.push(() => window.removeEventListener(type, fn, true));
      };
      on('keydown', (e: KeyboardEvent) => this.onKeyDown(e), false);
      on('keyup', (e: KeyboardEvent) => {
        this.keys.delete(e.code);
        // (macOS sends no release for a key that went down with Command held: Cmd+S left "S" held for good, and no show
        // began again. Command's own release ends them all; a key that is still down repeats, and counts again)
        if (e.key === 'Meta') this.keys.clear();
        this.lastInput = now();
        if (this.eatKey === null || e.code !== this.eatKey) return;
        this.eatKey = null;
        consume(e);
      }, false);
      on('pointerdown', (e: PointerEvent) => this.onPointerDown(e), false);
      on('pointerup', (e: PointerEvent) => this.onPointerUp(e, true), false);
      on('pointercancel', (e: PointerEvent) => this.onPointerUp(e, false), false);
      on('click', (e: MouseEvent) => {
        if (this.now() > this.eatClickUntil) return;
        this.eatClickUntil = -Infinity;
        consume(e);
      }, false);
      on('pointermove', () => { this.lastInput = now(); });
      on('wheel', (e: WheelEvent) => {
        this.lastInput = now();
        if (!this.ctl) return;
        // a wheel step on the map zooms: the player's camera, in every session. Over the HUD it scrolls a list
        if (this.onCanvas(e)) this.cancel();
        else if (!this.rules.cameraOnly) this.cancel(true);
      });
      on('touchstart', (e: TouchEvent) => {
        this.held = true;
        this.lastInput = now();
        if (!this.ctl) return;
        if (!this.rules.cameraOnly) this.cancel(true);
        else if (this.onCanvas(e)) this.cancel();
      });
      on('touchend', () => { this.held = false; this.lastInput = now(); });
      on('touchcancel', () => { this.held = false; this.lastInput = now(); });
      on('blur', (e: FocusEvent) => {
        // (a capture listener also sees every element's blur, a button blurring itself after its click: only the
        // window's own means the player left)
        if (e.target !== window) return;
        this.held = false;
        this.keys.clear();
        this.eatKey = this.eatUp = null;
        this.lastInput = now();
        // the view comes back (the New Year show plays on, as it always did)
        if (this.ctl && !this.rules.cameraOnly) this.cancel(true);
      });
    }
    signal?.addEventListener('abort', () => this.dispose(), { once: true });
  }

  get active(): boolean { return this.ctl !== null; }
  get idle(): boolean {
    const now = this.now();
    return !this.held && !this.keys.size && now - this.lastInput >= IDLE_MS && now - this.lastEnd >= IDLE_MS;
  }

  private onCanvas(e: Event): boolean {
    const canvas = this.rules.canvas?.();
    return !!canvas && e.target === canvas;
  }

  private onKeyDown(e: KeyboardEvent): void {
    const foreign = FOREIGN.test(e.code);
    if (!foreign) this.keys.add(e.code);
    this.lastInput = this.now();
    // (the swallowed key held on: its repeats are still the skip, no second command; any new press ends the wait for
    // its release)
    if (e.repeat && e.code === this.eatKey) { consume(e); return; }
    this.eatKey = null;
    if (!this.ctl) return;
    const camera = !!this.rules.cameraKey?.(e);
    if (this.rules.cameraOnly) {
      if (camera) this.cancel();
      return;
    }
    // (F5, F11, a volume key: the browser's or the system's, unless an action is bound to it. The show plays on)
    if (foreign && !camera && !this.rules.gameKey?.(e)) return;
    const chord = e.ctrlKey || e.metaKey || e.altKey;
    // (the camera controller ignores its keys in a chord or a form control: then they are no camera move either)
    if (camera && !chord && !inField(e)) { this.cancel(); return; }
    this.cancel(true);
    if (chord || isTyping(e) || MODIFIERS.has(e.key)) return;
    this.eatKey = e.code;
    consume(e);
  }

  private onPointerDown(e: PointerEvent): void {
    this.held = true;
    this.lastInput = this.now();
    this.eatUp = null;
    this.eatClickUntil = -Infinity;
    if (!this.ctl) return;
    const map = this.onCanvas(e);
    if (this.rules.cameraOnly) {
      if (map) this.cancel();
      return;
    }
    // middle / right press on the map: pan or orbit, the player takes the camera
    if (map && (e.button === 1 || e.button === 2)) { this.cancel(); return; }
    this.cancel(true);
    this.eatUp = e.pointerId ?? 0;
    consume(e);
  }

  private onPointerUp(e: PointerEvent, click: boolean): void {
    this.held = false;
    this.lastInput = this.now();
    if (this.eatUp === null || (e.pointerId ?? 0) !== this.eatUp) return;
    this.eatUp = null;
    if (click) this.eatClickUntil = this.now() + CLICK_MS;
    consume(e);
  }

  /** `rules`: what ends this session (ShowRules); false while a show runs, or (but for New Year) a key or pointer is held */
  begin(rules: ShowRules = {}): boolean {
    if (this.disposed || this.active || (!rules.cameraOnly && (this.held || this.keys.size))) return false;
    const c = this.controls();
    if (!c?.enabled) return false;
    this.ctl = c;
    this.session++;
    this.saved = readView(c);
    this.rules = rules;
    this.edge = c.edgeScroll ?? false;
    if ('edgeScroll' in c) c.edgeScroll = false;
    return true;
  }

  moveTo(view: ShowView, seconds: number): void {
    if (!this.ctl) return;
    this.from = readView(this.ctl);
    this.to = { ...view };
    this.elapsed = 0;
    this.duration = seconds;
    this.returning = false;
  }

  back(seconds = 2.5): void {
    if (!this.saved || !this.ctl) return;
    this.moveTo(this.saved, seconds);
    this.returning = true;
  }

  frame(dt: number): void {
    const c = this.ctl, a = this.from, b = this.to;
    if (!c) return;
    if (!c.enabled || c !== this.controls()) { this.cancel(); return; }
    if (!a || !b) return;
    this.elapsed += Math.max(0, dt);
    const k = this.duration > 0 ? smooth(this.elapsed / this.duration) : 1;
    let dy = (b.yaw - a.yaw) % 360;
    if (dy > 180) dy -= 360;
    if (dy < -180) dy += 360;
    try {
      (c.setShowView ?? c.setView).call(c, a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k,
        k === 1 ? b.d : Math.exp(Math.log(a.d) + (Math.log(b.d) - Math.log(a.d)) * k),
        a.tilt + (b.tilt - a.tilt) * k, a.yaw + dy * k);
    } catch { this.cancel(); }
    if (k === 1 && this.returning) this.cancel();
  }

  /** End the session. Camera input leaves the camera where the player took it; `restore` puts the saved view back. */
  cancel(restore = false): void {
    const c = this.ctl;
    try {
      if (c && restore && this.saved) {
        const v = this.saved;
        c.setView(v.x, v.z, v.d, v.tilt, v.yaw);
      }
    } catch {
      /* a lost view can no longer restore its camera */
    } finally {
      if (c && 'edgeScroll' in c) c.edgeScroll = this.edge;
      if (c) this.lastEnd = this.now();
      this.ctl = this.from = this.to = null;
    }
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs = [];
  }
}

/** CONTENT emits ref.first once, when it records systemData.firsts; old news is never replayed on load. */
export class FirstCameraMoments {
  private pending: { key: string; x: number; z: number; caption: string }[] = [];
  private seen = new Set<string>();
  private t = 0;
  private caption: HTMLElement | null = null;
  private phase = 0;
  private focus: ShowView | null = null;
  private session = 0;

  constructor(private ctx: GameContext, private show: ShowCamera, private busy: () => boolean) {
    if (ctx.signal.aborted) return;
    const off = ctx.host.events.on('news', (n) => {
      const key = (n.ref as { first?: string } | undefined)?.first;
      if (!key || !(/^(?:stage:[678]|unique:.+|neighbor)$/.test(key)) || n.x === undefined || n.z === undefined || this.seen.has(key)) return;
      this.seen.add(key);
      // (B10) a first that happens while Camera moments is off, or motion is reduced, is not kept for later
      if (this.wanted()) this.pending.push({ key, x: n.x, z: n.z, caption: n.text });
    });
    ctx.signal.addEventListener('abort', () => { off(); this.stop(); }, { once: true });
  }

  /** a spotlight is on screen (the scene holds the tools' hover meanwhile: the map moves under a resting pointer) */
  get playing(): boolean { return this.phase !== 0; }

  /** the player's choice: the setting, and motion not reduced */
  private wanted(): boolean {
    return !!this.ctx.settings.cameraMoments && resolveMotion(this.ctx.settings.motion) !== 'reduced';
  }

  frame(dt: number): void {
    const wanted = this.wanted();
    // (B10) switching the setting off drops what was waiting: switching it on again never plays an old first
    if (!wanted) this.pending.length = 0;
    const allowed = wanted && !document.hidden && !this.ctx.host.policy.live && !this.busy();
    if (this.phase) {
      // (B2) a gate that closes mid-show (LIVE, a dialog, the setting) gives the player's view back
      if (!allowed) { this.stop(true); return; }
      if (!this.show.active || this.show.session !== this.session) { this.stop(); return; }
      let left = Math.max(0, dt);
      while (left > 0 && this.show.active) {
        const end = this.phase === 1 ? 2 : this.phase === 2 ? 6 : 8.5;
        const step = Math.min(left, end - this.t);
        this.show.frame(step);
        this.t += step;
        left -= step;
        if (this.t >= 6 && this.phase === 2) { this.show.back(); this.phase = 3; }
        else if (this.t >= 2 && this.phase === 1 && this.focus) {
          this.show.moveTo({ ...this.focus, yaw: this.focus.yaw + 25 }, 4);
          this.phase = 2;
        }
        else if (this.t >= 8.5) { this.stop(); break; }
      }
      if (!this.show.active) this.stop();
      return;
    }
    // (the idle rule covers the gap between two shows as well: 4 s since the last one ended, B10)
    if (!allowed || !this.pending.length || !this.show.idle) return;
    const ctx = this.ctx;
    const keys = () => ctx.settings.keyBindings;
    if (!this.show.begin({ canvas: () => ctx.canvas, cameraKey: (e) => isCameraCode(e.code, keys()), gameKey: (e) => isBoundCode(e.code, keys()) })) return;
    const n = this.pending.shift()!;
    this.focus = { x: (n.x + 0.5) * CELL_SIZE, z: (n.z + 0.5) * CELL_SIZE, d: 360, tilt: 30, yaw: this.show.saved!.yaw };
    this.show.moveTo(this.focus, 2);
    this.session = this.show.session;
    this.phase = 1;
    this.t = 0;
    ctx.tip?.hide();
    this.caption = document.createElement('div');
    this.caption.className = 'show-caption mp-glass';
    this.caption.textContent = n.caption;
    this.caption.style.cssText = 'position:absolute;bottom:100px;left:25%;right:25%;padding:12px;text-align:center;pointer-events:none';
    ctx.root.appendChild(this.caption);
  }

  /** `restore`: the show ends on a gate, not on the player's input: the saved view comes back */
  private stop(restore = false): void {
    const was = this.phase;
    if (was && this.show.session === this.session) this.show.cancel(restore);
    this.phase = 0;
    this.caption?.remove();
    this.caption = null;
    // the hover under the pointer is read again from the view the player has now
    if (was && !this.ctx.signal.aborted) this.ctx.tools?.refresh();
  }
}
