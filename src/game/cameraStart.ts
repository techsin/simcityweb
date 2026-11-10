/**
 * Where the camera starts (QA UX-3): new cities open on the best buildable land (largest flat, dry area near the map
 * centre / a neighbour connection) instead of the map centre (often water); saved cities restore the last view,
 * stored in state.systemData.camera (CameraMemory: only once the real view's camera has been placed).
 */
import { CELL_SIZE } from '../core/constants';
import type { CameraControllerApi } from '../render/contracts';
import type { CityState } from '../sim/CityState';
import type { SimHost } from '../worker/SimHost';
import { ShowCamera, readView, type ShowControls, type ShowRules, type ShowView } from './ShowCamera';

/** persisted camera (state.systemData.camera): world focus x / z (m), distance (m), yaw / tilt (degrees) */
export interface SavedCamera {
  x: number;
  z: number;
  distance: number;
  yaw?: number;
  tilt?: number;
}

/** cells steeper than this (m between corners) are not "flat" */
const FLAT_SLOPE = 2.5;

/**
 * Cell (x, z) at the centre of the largest flat non-water area, preferring the map centre and the nearest
 * neighbour connection. Cheap: one pass over the cells + a blocks grid.
 */
export function bestBuildableCell(st: CityState): { x: number; z: number } {
  const N = st.size;
  const B = Math.max(4, Math.round(N / 16));
  const nb = Math.ceil(N / B);
  const good = new Float32Array(nb * nb);
  const tot = new Float32Array(nb * nb);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const k = Math.floor(z / B) * nb + Math.floor(x / B);
      tot[k]++;
      if (!st.water[z * N + x] && st.cellSlope(x, z) <= FLAT_SLOPE) good[k]++;
    }
  }
  const frac = (bx: number, bz: number) => {
    if (bx < 0 || bz < 0 || bx >= nb || bz >= nb) return 0;
    const k = bz * nb + bx;
    return tot[k] ? good[k] / tot[k] : 0;
  };
  const conns = st.neighborConnections ?? [];
  const half = N / 2;
  let best = { x: Math.floor(N / 2), z: Math.floor(N / 2) }, bestScore = -1e9;
  for (let bz = 0; bz < nb; bz++) {
    for (let bx = 0; bx < nb; bx++) {
      const self = frac(bx, bz);
      if (self < 0.6) continue;
      // flat share of the 5x5 block window (weighted toward the middle): "largest flat area"
      let s = 0, w = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const ww = Math.abs(dx) <= 1 && Math.abs(dz) <= 1 ? 1 : 0.5;
        s += frac(bx + dx, bz + dz) * ww;
        w += ww;
      }
      const cx = (bx + 0.5) * B, cz = (bz + 0.5) * B;
      const dCentre = Math.hypot(cx - half, cz - half) / half;
      let dConn = 0;
      if (conns.length) {
        dConn = 1e9;
        for (const c of conns) dConn = Math.min(dConn, Math.hypot(cx - c.x, cz - c.z));
        dConn /= half;
      }
      const score = s / w + 0.2 * self - 0.35 * dCentre - (conns.length ? 0.25 * dConn : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { x: Math.min(N - 1, Math.floor(cx)), z: Math.min(N - 1, Math.floor(cz)) };
      }
    }
  }
  return best;
}

type ViewControls = CameraControllerApi & {
  setView?: (x: number, z: number, distance: number, tiltDeg?: number, yawDeg?: number) => void;
  yawAngle?: number;
  tiltAngle?: number;
  tilt?: number;
  // the controller's smoothing goals (src/render/world/CameraController.ts; read when present)
  goalTarget?: { x: number; z: number };
  goalDistance?: number;
  goalYaw?: number;
  goalTilt?: number;
};

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Current view of the camera controller (null when it exposes nothing usable). Prefers the controller's goal (resting)
 * view, so a save taken mid-glide / mid-rotation restores where the camera was heading.
 */
export function readCamera(c: CameraControllerApi | undefined | null): SavedCamera | null {
  if (!c?.target) return null;
  const v = c as ViewControls;
  const g = v.goalTarget;
  const t = g && num(g.x) && num(g.z) ? g : c.target;
  const dist = num(v.goalDistance) ? v.goalDistance : c.distance;
  if (!num(t.x) || !num(t.z) || !num(dist)) return null;
  const out: SavedCamera = { x: Math.round(t.x * 10) / 10, z: Math.round(t.z * 10) / 10, distance: Math.round(dist) };
  const yaw = num(v.goalYaw) ? v.goalYaw : v.yawAngle;
  if (num(yaw)) out.yaw = Math.round((yaw * 180) / Math.PI * 100) / 100;
  // raw tilt (before the zoomed-out auto top-down blend) when available, else the effective one
  const tilt = num(v.goalTilt) ? v.goalTilt : num(v.tilt) ? v.tilt : v.tiltAngle;
  if (num(tilt)) out.tilt = Math.round((tilt * 180) / Math.PI * 100) / 100;
  return out;
}

/** a stored camera that makes sense for this map */
export function validCamera(v: unknown, st: CityState): SavedCamera | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Partial<SavedCamera>;
  const M = st.size * CELL_SIZE;
  if (typeof c.x !== 'number' || typeof c.z !== 'number' || typeof c.distance !== 'number') return null;
  if (!(c.x >= 0 && c.x <= M && c.z >= 0 && c.z <= M && c.distance > 0)) return null;
  return { x: c.x, z: c.z, distance: c.distance, yaw: typeof c.yaw === 'number' ? c.yaw : undefined, tilt: typeof c.tilt === 'number' ? c.tilt : undefined };
}

/** place the camera immediately (setView) when the controller supports it, else a smooth focusOn */
export function applyCamera(c: CameraControllerApi, cam: SavedCamera): void {
  const v = c as ViewControls;
  if (typeof v.setView === 'function') v.setView(cam.x, cam.z, cam.distance, cam.tilt, cam.yaw);
  else c.focusOn(cam.x, cam.z, cam.distance);
}

/**
 * The view a city opens on: the save's stored camera; else (a new city, or an old save without one) the best buildable
 * land, or the centre of an old save's buildings. `distance`: zoom for the latter two.
 */
export function startCamera(st: CityState, distance: number): SavedCamera {
  const saved = validCamera(st.systemData.camera, st);
  if (saved) return saved;
  let cell = bestBuildableCell(st);
  if (st.buildings.size) {
    // an older save without a stored camera: centre on the city itself
    let sx = 0, sz = 0, n = 0;
    for (const b of st.buildings.values()) {
      sx += b.x + b.w / 2;
      sz += b.z + b.d / 2;
      n++;
    }
    cell = { x: Math.floor(sx / n), z: Math.floor(sz / n) };
  }
  return { x: (cell.x + 0.5) * CELL_SIZE, z: (cell.z + 0.5) * CELL_SIZE, distance };
}

/** A new city's title uses its founding calendar date, including cities that begin in April. */
export function foundingTitle(st: CityState): string {
  const day = typeof st.systemData.foundedDay === 'number' ? st.systemData.foundedDay : st.day;
  const date = new Date(Date.UTC(st.config.startYear + Math.floor(day / 360), Math.floor(day % 360 / 30), 1));
  const founded = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
  return `${st.config.name} · Founded ${founded} · Mayor ${st.config.mayor}`;
}

export interface FlyInOptions {
  /** what ends the travel (ShowCamera's rules: the map canvas and the camera keys) */
  rules?: ShowRules;
  /** keep the high view until release() — the app's loading screen is gone — or FLY_HOLD_MAX_S on a page without one */
  hold?: boolean;
  /** the camera already rests on the landing: fly back to exactly that view (`landing` is its rounded copy, for saves) */
  inPlace?: boolean;
  /** a menu, a dialog or photo mode is up when the travel would start: the camera lands at once instead */
  busy?: () => boolean;
}

/** the travel's length (s) and its height above the landing */
const FLY_S = 2.5, FLY_HEIGHT = 3;
/** a held fly-in nobody releases (a page without the app's loading screen) starts by itself after this long (s of frames) */
const FLY_HOLD_MAX_S = 1.5;

/**
 * View-only opening travel. Input skips to the landing; saved cities never construct this.
 * QA B4: with `hold`, the camera waits at the high view and the clock starts at release(): the first render (2 s and
 * more in one frame on cold shaders) and the loading screen's fade ran the whole travel before anything was on screen.
 * Input before the release is not a skip (nothing is on screen to skip yet).
 */
export class FoundingFlyIn {
  private done = false;
  private started = false;
  private released = false;
  private waited = 0;
  private elapsed = 0;
  private title: HTMLElement | null = null;
  /** the show camera's session of this travel (-1: it has none) */
  private session = -1;
  /** the landing as the controller holds it */
  private to: ShowView;

  constructor(private show: ShowCamera, private controls: ShowControls, readonly landing: SavedCamera, private titleText: string, private landed: () => void, private root?: HTMLElement, private opts: FlyInOptions = {}) {
    if (!opts.inPlace) controls.setView(landing.x, landing.z, landing.distance, landing.tilt, landing.yaw);
    const v = this.to = readView(controls);
    // (the first frame behind the fading loading screen is already the high view, never the landing)
    (controls.setShowView ?? controls.setView).call(controls, v.x, v.z, v.d * FLY_HEIGHT, v.tilt, v.yaw);
    if (!opts.hold) this.start();
  }

  get active(): boolean { return !this.done; }

  /** the loading screen is gone: the travel starts with the next frame */
  release(): void { this.released = true; }

  /** end it now, on the landing (the graphics context was lost: the view that is rebuilt opens there) */
  land(): void { this.finish(); }

  private start(): void {
    this.started = true;
    const c = this.controls, v = this.to;
    // (another show has the camera: it keeps it, untouched)
    if (this.show.active) { this.finish(); return; }
    // (from the landing again: keys pressed under the loading screen may have moved the held view)
    c.setView(v.x, v.z, v.d, v.tilt, v.yaw);
    // (no travel when the player is busy elsewhere or holds a key or a button)
    if (this.opts.busy?.() || !this.show.begin(this.opts.rules) || !this.show.saved) { this.finish(); return; }
    this.session = this.show.session;
    (c.setShowView ?? c.setView).call(c, v.x, v.z, v.d * FLY_HEIGHT, v.tilt, v.yaw);
    this.show.moveTo(this.show.saved, FLY_S);
    if (this.root) {
      this.title = document.createElement('div');
      this.title.className = 'founding-title mp-glass';
      this.title.textContent = this.titleText;
      // (as wide as its text and above the top-left HUD column: its left end lay under the Getting started card)
      this.title.style.cssText = 'position:absolute;top:30%;left:50%;transform:translateX(-50%);width:max-content;max-width:70%;z-index:52;padding:20px;text-align:center;font-size:24px;pointer-events:none';
      this.root.appendChild(this.title);
    }
  }

  frame(dt: number): void {
    if (this.done) return;
    if (!this.started) {
      if (!this.released && (this.waited += Math.max(0, dt)) < FLY_HOLD_MAX_S) return;
      // (this frame shows the high view; the travel runs from the next one)
      this.start();
      return;
    }
    if (!this.show.active || this.session !== this.show.session) { this.finish(); return; }
    this.elapsed += Math.max(0, dt);
    this.show.frame(dt);
    if (this.elapsed >= FLY_S) this.finish();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    const mine = this.session === this.show.session;
    if (mine) this.show.cancel();
    // (the landing, unless another show — a celebration that took over — has the camera now)
    if (mine || !this.show.active) {
      const v = this.to;
      this.controls.setView(v.x, v.z, v.d, v.tilt, v.yaw);
    }
    this.title?.remove();
    this.title = null;
    this.landed();
  }
}

/**
 * Keeps the view in the save (state.systemData.camera, so every save path restores it), but only once the real view's
 * camera has been placed. Until then the game runs on stand-in views (while the renderer modules load, or for good
 * without WebGL) whose camera sits at the map corner (0, 0) / 800 m: storing that would overwrite a save's camera, and
 * the start view placed from it (place) would open the city on the corner.
 */
export class CameraMemory {
  /** the real view's camera was placed (place()): from now on store() keeps the save's camera up to date */
  placed = false;

  /** open the view on startCamera() (call once the real views exist) */
  place(st: CityState, c: CameraControllerApi | null | undefined, fallbackDistance = 900): void {
    if (!c) return;
    applyCamera(c, startCamera(st, c.distance || fallbackDistance));
    this.placed = true;
  }

  /** remember the current view in the save; a no-op before place() and on a stand-in view (`standIn`) */
  store(host: Pick<SimHost, 'act'>, c: CameraControllerApi | null | undefined, standIn = false): void {
    if (!this.placed || standIn) return;
    const cam = readCamera(c);
    if (cam) host.act('setCamera', [cam]);
  }
}
