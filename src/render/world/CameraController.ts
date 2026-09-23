/**
 * CameraController — SC4-style city camera (implements CameraControllerApi).
 *
 * Mouse:  LEFT is reserved for tools.  MIDDLE drag or SHIFT+RIGHT drag = pan (ground anchored: the point under the
 *         cursor follows the cursor).  RIGHT drag = orbit (yaw) / tilt.  WHEEL = smooth zoom toward the cursor.
 * Keys:   WASD / arrows = pan, Q / E = rotate 90° (smoothed snaps), R / F or PageUp / PageDown = tilt,
 *         + / - zoom, Home = recenter. Keys are ignored while an input / textarea / contenteditable is focused.
 * Touch:  one finger = pan, two fingers = pinch zoom + twist rotate.
 * Zoom 40 m .. 7 km, tilt 25°..85° with an automatic top-down tendency when zoomed far out.
 * Target is clamped to the map, the camera never goes below the terrain; all motion is damped.
 */
import * as THREE from 'three';
import type { CameraControllerApi } from '../contracts';

export interface CameraControllerOptions {
  /** world size of the map (m) */
  mapSize: number;
  /** terrain height sampler (world x,z -> y) */
  heightAt: (x: number, z: number) => number;
  minDistance?: number;
  maxDistance?: number;
  /** degrees */
  minTilt?: number;
  maxTilt?: number;
  edgeScroll?: boolean;
}

const DEG = Math.PI / 180;
const SNAP0 = Math.PI / 4; // default diagonal view (SC4-like)

function damp(current: number, target: number, lambda: number, dt: number) {
  return target + (current - target) * Math.exp(-lambda * dt);
}
function isTypingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export class CameraController implements CameraControllerApi {
  enabled = true;
  /** pan with the mouse at the screen edges */
  edgeScroll = false;
  /** 0..1 how strongly the camera tilts toward top-down when zoomed far out */
  autoTopDown = 0.75;
  /** keyboard pan speed multiplier */
  panSpeed = 1;
  readonly camera: THREE.PerspectiveCamera;
  private dom: HTMLElement;
  private opts: Required<CameraControllerOptions>;

  // smoothed state
  private _target = new THREE.Vector3();
  private _distance = 900;
  private yaw = SNAP0;
  private tilt = 52 * DEG;
  // desired state
  private goalTarget = new THREE.Vector3();
  private goalDistance = 900;
  private goalYaw = SNAP0;
  private goalTilt = 52 * DEG;
  private groundY = 0;

  // interaction
  private panning = false;
  private orbiting = false;
  private panPlaneY = 0;
  private panAnchor = new THREE.Vector3();
  private lastX = 0;
  private lastY = 0;
  private pointerX = -1;
  private pointerY = -1;
  private pointerInside = false;
  private panVel = new THREE.Vector3();
  private lastPanTime = 0;
  private keys = new Set<string>();
  private zoomAnchor = new THREE.Vector3();
  private zoomAnchorActive = false;
  private touches = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private pinchAngle = 0;

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private offset = new THREE.Vector3();
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions | undefined][] = [];

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, opts: CameraControllerOptions) {
    this.camera = camera;
    this.dom = dom;
    this.opts = {
      minDistance: 40,
      maxDistance: 7000,
      minTilt: 25,
      maxTilt: 85,
      edgeScroll: false,
      ...opts,
    };
    this.edgeScroll = this.opts.edgeScroll;
    const c = opts.mapSize / 2;
    this._target.set(c, opts.heightAt(c, c), c);
    this.goalTarget.copy(this._target);
    this.groundY = this._target.y;
    this.bind();
    this.apply();
  }

  // ------------------------------------------------------------------ public API
  get target(): THREE.Vector3 {
    return this._target;
  }
  get distance(): number {
    return this._distance;
  }
  /** current yaw (radians, 0 = looking north) */
  get yawAngle(): number {
    return this.yaw;
  }
  /** current effective tilt (radians above the horizon) */
  get tiltAngle(): number {
    return this.effectiveTilt();
  }

  focusOn(worldX: number, worldZ: number, distance?: number): void {
    this.goalTarget.set(worldX, 0, worldZ);
    this.clampGoal();
    if (distance !== undefined) this.goalDistance = THREE.MathUtils.clamp(distance, this.opts.minDistance, this.opts.maxDistance);
    this.panVel.set(0, 0, 0);
  }

  rotateStep(dir: 1 | -1): void {
    const k = Math.round((this.goalYaw - SNAP0) / (Math.PI / 2));
    this.goalYaw = SNAP0 + (k + dir) * (Math.PI / 2);
  }

  /** immediately place the camera (no smoothing). Angles in degrees. */
  setView(x: number, z: number, distance: number, tiltDeg?: number, yawDeg?: number): void {
    this.goalTarget.set(x, 0, z);
    this.clampGoal();
    this._target.copy(this.goalTarget);
    this._target.y = this.opts.heightAt(x, z);
    this.groundY = this._target.y;
    this.goalDistance = this._distance = THREE.MathUtils.clamp(distance, this.opts.minDistance, this.opts.maxDistance);
    if (tiltDeg !== undefined) this.goalTilt = this.tilt = THREE.MathUtils.clamp(tiltDeg, this.opts.minTilt, this.opts.maxTilt) * DEG;
    if (yawDeg !== undefined) this.goalYaw = this.yaw = yawDeg * DEG;
    this.panVel.set(0, 0, 0);
    this.apply();
  }

  recenter(): void {
    const c = this.opts.mapSize / 2;
    this.focusOn(c, c, Math.min(this.opts.maxDistance, this.opts.mapSize * 0.9));
  }

  // ------------------------------------------------------------------ input
  private on<K extends keyof HTMLElementEventMap>(t: EventTarget, type: K | string, fn: (e: any) => void, o?: AddEventListenerOptions) {
    t.addEventListener(type, fn as EventListener, o);
    this.listeners.push([t, type, fn as EventListener, o]);
  }

  private bind() {
    const d = this.dom;
    this.on(d, 'contextmenu', (e: Event) => e.preventDefault());
    this.on(d, 'pointerdown', (e: PointerEvent) => this.onPointerDown(e));
    this.on(window, 'pointermove', (e: PointerEvent) => this.onPointerMove(e));
    this.on(window, 'pointerup', (e: PointerEvent) => this.onPointerUp(e));
    this.on(window, 'pointercancel', (e: PointerEvent) => this.onPointerUp(e));
    this.on(d, 'pointerenter', () => (this.pointerInside = true));
    this.on(d, 'pointerleave', () => (this.pointerInside = false));
    this.on(d, 'wheel', (e: WheelEvent) => this.onWheel(e), { passive: false });
    this.on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e, true));
    this.on(window, 'keyup', (e: KeyboardEvent) => this.onKey(e, false));
    this.on(window, 'blur', () => {
      this.keys.clear();
      this.panning = this.orbiting = false;
    });
    this.on(d, 'touchstart', (e: TouchEvent) => this.onTouch(e), { passive: false });
    this.on(d, 'touchmove', (e: TouchEvent) => this.onTouch(e), { passive: false });
    this.on(d, 'touchend', (e: TouchEvent) => this.onTouch(e), { passive: false });
  }

  private rayToPlane(clientX: number, clientY: number, y: number, out: THREE.Vector3): boolean {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.plane.constant = -y;
    const hit = this.raycaster.ray.intersectPlane(this.plane, out);
    if (!hit) return false;
    // reject hits absurdly far away (near horizon)
    return out.distanceTo(this.camera.position) < this._distance * 12 + 2000;
  }

  /** approximate terrain hit (ray march) used for anchors */
  private groundHit(clientX: number, clientY: number, out: THREE.Vector3): boolean {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const ray = this.raycaster.ray;
    const maxT = this._distance * 6 + 3000;
    let step = Math.max(2, this._distance / 150);
    let prevT = 0;
    for (let t = step; t < maxT; t += step) {
      ray.at(t, this.tmp2);
      if (this.tmp2.y <= this.opts.heightAt(this.tmp2.x, this.tmp2.z)) {
        let a = prevT, b = t;
        for (let i = 0; i < 16; i++) {
          const m = (a + b) / 2;
          ray.at(m, this.tmp2);
          if (this.tmp2.y <= this.opts.heightAt(this.tmp2.x, this.tmp2.z)) b = m;
          else a = m;
        }
        ray.at(b, out);
        return true;
      }
      prevT = t;
      step *= 1.02;
    }
    return this.rayToPlane(clientX, clientY, this.groundY, out);
  }

  private onPointerDown(e: PointerEvent) {
    if (!this.enabled) return;
    const pan = e.button === 1 || (e.button === 2 && e.shiftKey);
    const orbit = e.button === 2 && !e.shiftKey;
    if (!pan && !orbit) return;
    e.preventDefault();
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (pan) {
      if (this.groundHit(e.clientX, e.clientY, this.panAnchor)) {
        this.panning = true;
        this.panPlaneY = this.panAnchor.y;
        this.panVel.set(0, 0, 0);
        this.lastPanTime = performance.now();
      }
    } else {
      this.orbiting = true;
    }
    try {
      this.dom.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private onPointerMove(e: PointerEvent) {
    const r = this.dom.getBoundingClientRect();
    this.pointerX = e.clientX - r.left;
    this.pointerY = e.clientY - r.top;
    if (!this.enabled) return;
    if (this.panning) {
      // ground anchored: find where the cursor ray hits the anchor plane now, shift the target by the difference
      this.apply();
      if (this.rayToPlane(e.clientX, e.clientY, this.panPlaneY, this.tmp)) {
        const dx = this.panAnchor.x - this.tmp.x, dz = this.panAnchor.z - this.tmp.z;
        this._target.x += dx;
        this._target.z += dz;
        this.goalTarget.x = this._target.x;
        this.goalTarget.z = this._target.z;
        this.clampTarget(this._target);
        this.goalTarget.x = this._target.x;
        this.goalTarget.z = this._target.z;
        const now = performance.now();
        const dt = Math.max(1, now - this.lastPanTime) / 1000;
        this.lastPanTime = now;
        this.panVel.x = THREE.MathUtils.lerp(this.panVel.x, dx / dt, 0.5);
        this.panVel.z = THREE.MathUtils.lerp(this.panVel.z, dz / dt, 0.5);
      }
    } else if (this.orbiting) {
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.goalYaw -= dx * 0.006;
      this.goalTilt = THREE.MathUtils.clamp(this.goalTilt + dy * 0.004, this.opts.minTilt * DEG, this.opts.maxTilt * DEG);
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  private onPointerUp(e: PointerEvent) {
    if (this.panning) {
      // keep inertia only if the drag was still moving when released
      if (performance.now() - this.lastPanTime > 80) this.panVel.set(0, 0, 0);
      const maxV = this._distance * 4;
      if (this.panVel.length() > maxV) this.panVel.setLength(maxV);
    }
    this.panning = false;
    this.orbiting = false;
    try {
      this.dom.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private onWheel(e: WheelEvent) {
    if (!this.enabled) return;
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 32;
    else if (e.deltaMode === 2) dy *= 400;
    const factor = Math.exp(THREE.MathUtils.clamp(dy, -400, 400) * 0.0014);
    this.zoomBy(factor, e.clientX, e.clientY);
  }

  /** zoom by factor (>1 = out) toward a screen point (client coords) */
  zoomBy(factor: number, clientX?: number, clientY?: number) {
    const nd = THREE.MathUtils.clamp(this.goalDistance * factor, this.opts.minDistance, this.opts.maxDistance);
    if (clientX !== undefined && clientY !== undefined && factor < 1 && this.groundHit(clientX, clientY, this.zoomAnchor)) {
      this.zoomAnchorActive = true;
    } else if (factor >= 1) {
      this.zoomAnchorActive = false;
    }
    this.goalDistance = nd;
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (isTypingTarget()) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!down) {
      this.keys.delete(k);
      return;
    }
    if (!this.enabled) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const handled = ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'r', 'f', 'PageUp', 'PageDown', '+', '=', '-', '_'];
    if (handled.includes(k)) {
      this.keys.add(k);
      if (k.startsWith('Arrow') || k.startsWith('Page')) e.preventDefault();
    }
    if (e.repeat) return;
    if (k === 'q') this.rotateStep(-1);
    else if (k === 'e') this.rotateStep(1);
    else if (k === 'Home') {
      this.recenter();
      e.preventDefault();
    }
  }

  private onTouch(e: TouchEvent) {
    if (!this.enabled) return;
    e.preventDefault();
    const r = this.dom.getBoundingClientRect();
    const prev = new Map(this.touches);
    this.touches.clear();
    for (const t of Array.from(e.touches)) this.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
    const pts = [...this.touches.values()];
    if (pts.length === 1) {
      const p = pts[0];
      const was = prev.size === 1 ? [...prev.values()][0] : null;
      if (!was || !this.panning) {
        this.panning = this.groundHit(p.x, p.y, this.panAnchor);
        this.panPlaneY = this.panAnchor.y;
      } else {
        this.onPointerMove({ clientX: p.x, clientY: p.y } as PointerEvent);
      }
    } else if (pts.length === 2) {
      this.panning = false;
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (prev.size === 2) {
        if (this.pinchDist > 0) this.zoomBy(this.pinchDist / Math.max(dist, 1), (a.x + b.x) / 2, (a.y + b.y) / 2);
        let da = ang - this.pinchAngle;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        this.goalYaw -= da;
      }
      this.pinchDist = dist;
      this.pinchAngle = ang;
    } else {
      this.panning = false;
      this.pinchDist = 0;
    }
    void r;
  }

  // ------------------------------------------------------------------ update
  private clampTarget(t: THREE.Vector3) {
    const S = this.opts.mapSize;
    const m = -S * 0.05;
    t.x = THREE.MathUtils.clamp(t.x, m, S - m);
    t.z = THREE.MathUtils.clamp(t.z, m, S - m);
  }
  private clampGoal() {
    this.clampTarget(this.goalTarget);
  }

  private effectiveTilt(): number {
    const far = THREE.MathUtils.smoothstep(this._distance, 1800, 7000) * this.autoTopDown;
    return THREE.MathUtils.lerp(this.tilt, Math.max(this.tilt, 80 * DEG), far);
  }

  update(dt: number): void {
    dt = Math.min(dt, 0.1);
    // keyboard
    if (this.enabled && this.keys.size) {
      let fx = 0, fz = 0;
      if (this.keys.has('w') || this.keys.has('ArrowUp')) fz += 1;
      if (this.keys.has('s') || this.keys.has('ArrowDown')) fz -= 1;
      if (this.keys.has('d') || this.keys.has('ArrowRight')) fx += 1;
      if (this.keys.has('a') || this.keys.has('ArrowLeft')) fx -= 1;
      if (fx || fz) {
        const speed = this._distance * 1.1 * this.panSpeed;
        const sx = Math.sin(this.yaw), cz = -Math.cos(this.yaw);
        // forward = direction the camera looks (projected), right = perpendicular
        const fwdX = sx, fwdZ = cz, rightX = -cz, rightZ = sx;
        this.goalTarget.x += (fwdX * fz + rightX * fx) * speed * dt;
        this.goalTarget.z += (fwdZ * fz + rightZ * fx) * speed * dt;
        this.clampGoal();
      }
      if (this.keys.has('r') || this.keys.has('PageUp')) this.goalTilt += 55 * DEG * dt;
      if (this.keys.has('f') || this.keys.has('PageDown')) this.goalTilt -= 55 * DEG * dt;
      this.goalTilt = THREE.MathUtils.clamp(this.goalTilt, this.opts.minTilt * DEG, this.opts.maxTilt * DEG);
      if (this.keys.has('+') || this.keys.has('=')) this.zoomBy(Math.exp(-1.6 * dt));
      if (this.keys.has('-') || this.keys.has('_')) this.zoomBy(Math.exp(1.6 * dt));
    }
    // edge scrolling
    if (this.enabled && this.edgeScroll && this.pointerInside && !this.panning && !this.orbiting) {
      const w = this.dom.clientWidth, h = this.dom.clientHeight, m = 14;
      let fx = 0, fz = 0;
      if (this.pointerX < m) fx = -1;
      else if (this.pointerX > w - m) fx = 1;
      if (this.pointerY < m) fz = 1;
      else if (this.pointerY > h - m) fz = -1;
      if (fx || fz) {
        const speed = this._distance * 0.9;
        const sx = Math.sin(this.yaw), cz = -Math.cos(this.yaw);
        this.goalTarget.x += (sx * fz - cz * fx) * speed * dt;
        this.goalTarget.z += (cz * fz + sx * fx) * speed * dt;
        this.clampGoal();
      }
    }
    // pan inertia
    if (!this.panning && this.panVel.lengthSq() > 1e-4) {
      this.goalTarget.x += this.panVel.x * dt;
      this.goalTarget.z += this.panVel.z * dt;
      this.clampGoal();
      this.panVel.multiplyScalar(Math.exp(-dt * 5));
      if (this.panVel.lengthSq() < 1) this.panVel.set(0, 0, 0);
    }

    // smoothing
    const prevDist = this._distance;
    if (!this.panning) {
      this._target.x = damp(this._target.x, this.goalTarget.x, 10, dt);
      this._target.z = damp(this._target.z, this.goalTarget.z, 10, dt);
    }
    this._distance = Math.exp(damp(Math.log(this._distance), Math.log(this.goalDistance), 9, dt));
    this.yaw = damp(this.yaw, this.goalYaw, 9, dt);
    this.tilt = damp(this.tilt, this.goalTilt, 10, dt);
    // zoom toward cursor: keep the anchor fixed on screen while the distance changes
    if (this.zoomAnchorActive) {
      const f = this._distance / prevDist;
      if (Math.abs(f - 1) > 1e-5) {
        this._target.x = this.zoomAnchor.x + (this._target.x - this.zoomAnchor.x) * f;
        this._target.z = this.zoomAnchor.z + (this._target.z - this.zoomAnchor.z) * f;
        this.clampTarget(this._target);
        this.goalTarget.x = this._target.x;
        this.goalTarget.z = this._target.z;
      }
      if (Math.abs(this._distance - this.goalDistance) < this.goalDistance * 0.002) this.zoomAnchorActive = false;
    }
    // follow terrain height at the target (smoothed so hills don't make the camera jitter)
    const gy = this.opts.heightAt(this._target.x, this._target.z);
    this.groundY = damp(this.groundY, Math.max(gy, 0), 6, dt);
    this._target.y = this.groundY;
    this.apply();
  }

  /** compute camera position from target / distance / angles; keep it above the terrain */
  private apply() {
    const tilt = this.effectiveTilt();
    const d = this._distance;
    const ch = Math.cos(tilt);
    this.offset.set(-Math.sin(this.yaw) * ch * d, Math.sin(tilt) * d, Math.cos(this.yaw) * ch * d);
    const cam = this.camera;
    cam.position.copy(this._target).add(this.offset);
    const minY = Math.max(this.opts.heightAt(cam.position.x, cam.position.z), 0) + Math.max(8, d * 0.08);
    if (cam.position.y < minY) cam.position.y = minY;
    cam.lookAt(this._target);
    cam.updateMatrixWorld();
  }

  dispose() {
    for (const [t, type, fn, o] of this.listeners) t.removeEventListener(type, fn, o);
    this.listeners = [];
  }
}
