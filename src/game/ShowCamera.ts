/** Shared, interruptible camera travel for New Year and the city's firsts. Angles are degrees. */
import { CELL_SIZE } from '../core/constants';
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

const smooth = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const read = (c: ShowControls): ShowView => ({ x: c.target.x, z: c.target.z, d: c.distance, tilt: (c.baseTilt ?? c.tiltAngle) * 180 / Math.PI, yaw: c.yawAngle * 180 / Math.PI });

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
  private held = false;
  private keys = new Set<string>();
  private disposed = false;
  private keyCancels: ((e: KeyboardEvent) => boolean) | null = null;

  constructor(private controls: () => ShowControls | null, signal?: AbortSignal, private now = () => performance.now()) {
    this.lastInput = now();
    if (signal?.aborted) { this.disposed = true; return; }
    if (typeof window !== 'undefined') {
      const on = (type: string, fn: (e: any) => void) => {
        window.addEventListener(type, fn, { capture: true, passive: true, signal });
        this.offs.push(() => window.removeEventListener(type, fn, true));
      };
      const input = () => { this.lastInput = now(); this.cancel(); };
      on('keydown', (e: KeyboardEvent) => {
        this.keys.add(e.code);
        this.lastInput = now();
        if (!this.keyCancels || this.keyCancels(e)) this.cancel();
      });
      on('keyup', (e: KeyboardEvent) => {
        this.keys.delete(e.code);
        this.lastInput = now();
        if (!this.keyCancels || this.keyCancels(e)) this.cancel();
      });
      on('pointerdown', () => { this.held = true; input(); });
      on('pointerup', () => { this.held = false; input(); });
      on('pointercancel', () => { this.held = false; input(); });
      on('pointermove', input);
      on('wheel', input);
      on('touchstart', () => { this.held = true; input(); });
      on('touchend', () => { this.held = false; input(); });
      on('touchcancel', () => { this.held = false; input(); });
      on('blur', () => { this.held = false; this.keys.clear(); input(); });
    }
    signal?.addEventListener('abort', () => this.dispose(), { once: true });
  }

  get active(): boolean { return this.ctl !== null; }
  get idle(): boolean { return !this.held && !this.keys.size && this.now() - this.lastInput >= 4000; }

  begin(keyCancels: ((e: KeyboardEvent) => boolean) | null = null): boolean {
    if (this.disposed || this.active || this.held || this.keys.size) return false;
    const c = this.controls();
    if (!c?.enabled) return false;
    this.ctl = c;
    this.session++;
    this.saved = read(c);
    this.keyCancels = keyCancels;
    this.edge = c.edgeScroll ?? false;
    if ('edgeScroll' in c) c.edgeScroll = false;
    return true;
  }

  moveTo(view: ShowView, seconds: number): void {
    if (!this.ctl) return;
    this.from = read(this.ctl);
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

  /** Input leaves the camera where the player took it; explicit cancellation can restore the start view. */
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
      this.pending.push({ key, x: n.x, z: n.z, caption: n.text });
    });
    ctx.signal.addEventListener('abort', () => { off(); this.stop(); }, { once: true });
  }

  frame(dt: number): void {
    const allowed = !document.hidden && this.ctx.settings.cameraMoments && resolveMotion(this.ctx.settings.motion) !== 'reduced' && !this.ctx.host.policy.live && !this.busy();
    if (this.phase) {
      if (!allowed || !this.show.active || this.show.session !== this.session) { this.stop(); return; }
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
    if (!allowed || !this.pending.length || !this.show.idle || !this.show.begin()) return;
    const n = this.pending.shift()!;
    this.focus = { x: (n.x + 0.5) * CELL_SIZE, z: (n.z + 0.5) * CELL_SIZE, d: 360, tilt: 30, yaw: this.show.saved!.yaw };
    this.show.moveTo(this.focus, 2);
    this.session = this.show.session;
    this.phase = 1;
    this.t = 0;
    this.caption = document.createElement('div');
    this.caption.className = 'show-caption mp-glass';
    this.caption.textContent = n.caption;
    this.caption.style.cssText = 'position:absolute;bottom:100px;left:25%;right:25%;padding:12px;text-align:center;pointer-events:none';
    this.ctx.root.appendChild(this.caption);
  }

  private stop(): void {
    if (this.phase && this.show.session === this.session) this.show.cancel();
    this.phase = 0;
    this.caption?.remove();
    this.caption = null;
  }
}
