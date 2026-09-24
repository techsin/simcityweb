/**
 * Sun shadows.
 *
 * `CitySun` is a THREE.DirectionalLight (API-compatible: position / target / color / intensity) that can switch into
 * three r186's built-in 2-cascade "SunLight" code path (WebGLLights handles `isSunLight` before `isDirectionalLight`,
 * both use identical uniform layouts). In that mode its `shadow` is a `CityCascadeShadow` whose splits are fitted
 * to the visible ground (not the camera near plane) and quantized, with texel snapping (from SunLightShadow) so
 * panning / rotating never shimmers.
 *
 * Low quality uses a single DirectionalLightShadow fitted around the camera target with manual texel snapping.
 *
 * Direction convention: `sun.position - sun.target.position` points TO the light in both modes.
 *
 * Shadow cameras carry `userData.cascade` (0 / 1; the single map is 0) and `userData.texel` (world size of a shadow
 * texel) so casters can cull / LOD per cascade (see DynamicBatch per-pass culling). The cascaded fit is clamped to
 * the view-depth range of the map box (no far cascade beyond the city) and its caster ceiling only reaches as far
 * toward the sun as the tallest possible caster needs.
 */
import * as THREE from 'three';
import { SunLightShadow } from 'three/examples/jsm/lights/SunLightShadow.js';

const _lightOrientationMatrix = new THREE.Matrix4();
const _viewToLightMatrix = new THREE.Matrix4();
const _lightDirection = new THREE.Vector3();
const _up = new THREE.Vector3();
const _center = new THREE.Vector3();
const _near = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _far = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());
const CASCADES = 2;
const FADE = 0.12;
const _world = new THREE.Vector3();

/**
 * Global shadow-caster change counter: bumped by anything that changes what the shadow map would contain
 * (batched instances added / moved / hidden, tree chunks rebuilt...). WorldView re-renders the shadow map only
 * when the shadow cameras or the sun moved, or this counter changed (throttled), instead of every frame.
 */
export const shadowCasters = { version: 0 };

/**
 * Receiver volume of a shadow pass: the part of the VIEW frustum a cascade shades (its depth slice). A caster only
 * matters if its shadow (the caster swept away from the light down to the ground) reaches that volume — much tighter
 * than the cascade's ortho box, which is a light-aligned square around the slice's bounding sphere. Attached to the
 * shadow cameras (`userData.recv`) and frustums (`.recv`) every frame.
 */
export interface ShadowReceiver {
  planes: THREE.Plane[];
  /** normal . dirToLight per plane */
  nl: Float64Array;
  /** unit direction TO the light */
  dir: THREE.Vector3;
  /** lowest ground height: shadows end there */
  ground: number;
  /** bumped whenever the volume changes: caster lists cached for a shadow camera that did not move (single map
   *  while the view only rotates) must still be rebuilt */
  version: number;
  /** last volume (6 planes + light dir + ground) for change detection */
  snap: Float64Array;
}

export function makeReceiver(): ShadowReceiver {
  return { planes: Array.from({ length: 6 }, () => new THREE.Plane()), nl: new Float64Array(6), dir: new THREE.Vector3(0, 1, 0), ground: 0, version: 0, snap: new Float64Array(28) };
}

const _rf = new THREE.Frustum();
const _rm = new THREE.Matrix4();
const _fwd = new THREE.Vector3();
const _cp = new THREE.Vector3();

/** fit a receiver to a perspective view camera between view depths dn..df */
export function setReceiver(rec: ShadowReceiver, cam: THREE.Camera, dn: number, df: number, dirToLight: THREE.Vector3, ground: number): void {
  _rf.setFromProjectionMatrix(_rm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  for (let i = 0; i < 4; i++) rec.planes[i].copy(_rf.planes[i]);
  _fwd.set(0, 0, -1).transformDirection(cam.matrixWorld);
  _cp.setFromMatrixPosition(cam.matrixWorld);
  const fc = _fwd.dot(_cp);
  rec.planes[4].normal.copy(_fwd).negate();
  rec.planes[4].constant = fc + df;
  rec.planes[5].normal.copy(_fwd);
  rec.planes[5].constant = -fc - dn;
  rec.dir.copy(dirToLight).normalize();
  for (let i = 0; i < 6; i++) rec.nl[i] = rec.planes[i].normal.dot(rec.dir);
  rec.ground = ground;
  // change detection (tolerant: a still, damped camera jitters by float ulps)
  const s = rec.snap;
  let o = 0, changed = false;
  const note = (v: number) => {
    if (Math.abs(s[o] - v) > 1e-7 * Math.max(1, Math.abs(v))) { s[o] = v; changed = true; }
    o++;
  };
  for (const p of rec.planes) { note(p.normal.x); note(p.normal.y); note(p.normal.z); note(p.constant); }
  note(rec.dir.x); note(rec.dir.y); note(rec.dir.z); note(ground);
  if (changed) rec.version++;
}

/** can a caster sphere shadow the receiver volume? (sphere swept away from the light down to the ground) */
export function receiverSweepSphere(rec: ShadowReceiver, cx: number, cy: number, cz: number, r: number): boolean {
  const T = Math.min(6000, Math.max(0, (cy + r - rec.ground) / Math.max(rec.dir.y, 0.05)));
  const P = rec.planes, nl = rec.nl;
  for (let i = 0; i < 6; i++) {
    const n = P[i].normal;
    const d0 = n.x * cx + n.y * cy + n.z * cz + P[i].constant;
    if (d0 < -r && d0 - T * nl[i] < -r) return false;
  }
  return true;
}

/** is the box entirely inside the receiver volume? (then every caster in it certainly shadows it: no per-caster test) */
export function receiverContainsBox(rec: ShadowReceiver, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  const P = rec.planes;
  for (let i = 0; i < 6; i++) {
    const n = P[i].normal;
    // n-vertex: the corner with the smallest signed distance
    if (n.x * (n.x > 0 ? x0 : x1) + n.y * (n.y > 0 ? y0 : y1) + n.z * (n.z > 0 ? z0 : z1) + P[i].constant < 0) return false;
  }
  return true;
}

/** can a caster box shadow the receiver volume? */
export function receiverSweepBox(rec: ShadowReceiver, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  const T = Math.min(6000, Math.max(0, (y1 - rec.ground) / Math.max(rec.dir.y, 0.05)));
  const P = rec.planes, nl = rec.nl;
  for (let i = 0; i < 6; i++) {
    const n = P[i].normal;
    const d = n.x * (n.x > 0 ? x1 : x0) + n.y * (n.y > 0 ? y1 : y0) + n.z * (n.z > 0 ? z1 : z0) + P[i].constant;
    if (d < 0 && d - T * nl[i] < 0) return false;
  }
  return true;
}

/** SunLightShadow with explicit (ground fitted) split depths. */
export class CityCascadeShadow extends SunLightShadow {
  /** view-space depths [start, split, end] (set every frame by the controller) */
  splits = [1, 300, 1500];
  /** world y of the highest possible shadow caster (limits how far toward the sun the caster volume reaches) */
  casterTop = Infinity;
  /** lowest ground height (receiver volumes end there) */
  groundY = -50;
  readonly receivers = [makeReceiver(), makeReceiver()];

  constructor() {
    super();
    const cams = (this as any)._cameras as THREE.OrthographicCamera[];
    const frus = (this as any)._frustums as THREE.Frustum[];
    cams.forEach((c, i) => { c.userData.cascade = i; c.userData.texel = 1; c.userData.recv = this.receivers[i]; (frus[i] as any).recv = this.receivers[i]; });
  }

  override updateMatrices(light: THREE.Light, viewCamera?: THREE.Camera): void {
    if (!viewCamera) return;
    const self = this as any;
    const cams: THREE.OrthographicCamera[] = self._cameras;
    const mats: THREE.Matrix4[] = self._matrices;
    const frus: THREE.Frustum[] = self._frustums;
    const vps: THREE.Vector4[] = self._viewports;
    const cdata: THREE.Vector4[] = self._cascadeData;
    const insetX = Math.min(0.25, (Math.ceil(this.radius) + 1) / this.mapSize.x);
    const insetY = Math.min(0.25, (Math.ceil(this.radius) + 1) / this.mapSize.y);
    for (let i = 0; i < CASCADES; i++) vps[i].set(i + insetX, insetY, 1 - 2 * insetX, 1 - 2 * insetY);
    const resX = this.mapSize.x * (1 - 2 * insetX);
    const resY = this.mapSize.y * (1 - 2 * insetY);
    const res = Math.min(resX, resY);
    const vc = viewCamera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    const camNear = vc.near;
    const s0 = Math.max(camNear, this.splits[0]);
    const s2 = Math.max(s0 + 1, Math.min(this.splits[2], vc.far));
    const s1 = THREE.MathUtils.clamp(this.splits[1], s0 + 0.5, s2 - 0.5);
    const splits = [s0, s1, s2];

    _lightDirection.setFromMatrixPosition(light.matrixWorld).negate().normalize();
    _up.set(0, 1, 0);
    if (Math.abs(_up.dot(_lightDirection)) > 0.99) _up.set(0, 0, 1);
    _lightOrientationMatrix.lookAt(_center.set(0, 0, 0), _lightDirection, _up);
    _viewToLightMatrix.copy(_lightOrientationMatrix).transpose().multiply(vc.matrixWorld);
    const inv = vc.projectionMatrixInverse;
    const persp = (vc as THREE.PerspectiveCamera).isPerspectiveCamera === true;
    let maxZ = -Infinity;
    let minWorldY = Infinity;
    for (let i = 0; i < 4; i++) {
      const x = i === 0 || i === 1 ? 1 : -1;
      const y = i === 0 || i === 3 ? 1 : -1;
      const n = _near[i].set(x, y, -1).applyMatrix4(inv); // at view depth camNear
      const f = _far[i];
      if (persp) {
        f.copy(n).multiplyScalar(s2 / camNear);
        n.multiplyScalar(s0 / camNear);
      } else {
        f.set(n.x, n.y, -s2);
        n.set(n.x, n.y, -s0);
      }
      minWorldY = Math.min(minWorldY, _world.copy(n).applyMatrix4(vc.matrixWorld).y, _world.copy(f).applyMatrix4(vc.matrixWorld).y);
      n.applyMatrix4(_viewToLightMatrix);
      f.applyMatrix4(_viewToLightMatrix);
      maxZ = Math.max(maxZ, n.z, f.z);
    }
    // raise the caster ceiling so tall buildings / hills outside the view still cast into it: far enough toward the
    // sun for a caster of height casterTop standing anywhere sunward of the slice (low sun -> long reach)
    const upY = Math.max(0.08, -_lightDirection.y);
    const reach = Number.isFinite(this.casterTop) ? Math.max(50, (this.casterTop - Math.max(minWorldY, -200)) / upY) : Infinity;
    maxZ += Math.min(s2, 2500, reach);
    const shadowNear = this.camera.near;
    const toLight = _world.copy(_lightDirection).negate();
    for (let i = 0; i < CASCADES; i++) {
      const cNear = i === 0 ? splits[0] : cdata[i - 1].z;
      const cFar = splits[i + 1];
      if (persp) setReceiver(this.receivers[i], vc, i === 0 ? camNear : cNear * 0.98, cFar * 1.02, toLight, this.groundY);
      cams[i].userData.recv = persp ? this.receivers[i] : undefined;
      (frus[i] as any).recv = persp ? this.receivers[i] : undefined;
      const fadeStart = cFar - FADE * (cFar - splits[i]);
      cdata[i].set(i === 0 ? -1e10 : cNear, cFar, fadeStart, 0);
      const na = (cNear - s0) / (s2 - s0), fa = (cFar - s0) / (s2 - s0);
      _center.set(0, 0, 0);
      for (let j = 0; j < 4; j++) {
        _corners[j * 2].lerpVectors(_near[j], _far[j], na);
        _corners[j * 2 + 1].lerpVectors(_near[j], _far[j], fa);
        _center.add(_corners[j * 2]).add(_corners[j * 2 + 1]);
      }
      _center.multiplyScalar(1 / 8);
      let r2 = 0, minZ = Infinity;
      for (let j = 0; j < 8; j++) {
        r2 = Math.max(r2, _corners[j].distanceToSquared(_center));
        minZ = Math.min(minZ, _corners[j].z);
      }
      // quantize the radius (log steps) so zooming only re-snaps occasionally
      let radius = Math.sqrt(r2);
      radius = Math.pow(2, Math.ceil(Math.log2(radius) * 8) / 8);
      if (res > 1) {
        radius /= 1 - 1 / res;
        const tx = (2 * radius) / resX, ty = (2 * radius) / resY;
        _center.x = Math.round(_center.x / tx) * tx;
        _center.y = Math.round(_center.y / ty) * ty;
      }
      _center.z = maxZ + shadowNear;
      _center.applyMatrix4(_lightOrientationMatrix);
      const cc = cams[i];
      cc.position.copy(_center);
      cc.quaternion.setFromRotationMatrix(_lightOrientationMatrix);
      cc.left = -radius;
      cc.right = radius;
      cc.top = radius;
      cc.bottom = -radius;
      cc.near = shadowNear;
      cc.far = maxZ - minZ + 2 * shadowNear;
      cc.updateProjectionMatrix();
      cc.updateMatrixWorld();
      cc.userData.texel = (2 * radius) / resX;
      self._updateMatrix(cc, mats[i], frus[i], vps[i]);
    }
    this.lastTexel = [(2 * cams[0].right) / resX, (2 * cams[1].right) / resX];
  }
  /** world size of a shadow texel per cascade (after last update) */
  lastTexel = [0.2, 1];
}

/** DirectionalLight that can run through three's cascaded SunLight path. */
export class CitySun extends THREE.DirectionalLight {
  readonly dirShadow: THREE.DirectionalLightShadow;
  readonly cascadeShadow: CityCascadeShadow;
  /** receiver volume of the single (low quality) map */
  readonly dirReceiver = makeReceiver();
  private _cascaded = false;

  constructor(color: THREE.ColorRepresentation = 0xffffff, intensity = 3) {
    super(color, intensity);
    this.name = 'sun';
    this.dirShadow = this.shadow;
    this.dirShadow.camera.userData.cascade = 0;
    this.dirShadow.camera.userData.texel = 1;
    this.dirShadow.camera.userData.recv = this.dirReceiver;
    (this.dirShadow as any)._frustum.recv = this.dirReceiver;
    this.cascadeShadow = new CityCascadeShadow();
  }

  get cascaded(): boolean {
    return this._cascaded;
  }

  /** switch between the single fitted map and 2 cascades (forces a shader recompile of lit materials) */
  setCascaded(on: boolean) {
    this._cascaded = on;
    const self = this as any;
    self.isSunLight = on;
    self.type = on ? 'SunLight' : 'DirectionalLight';
    self.shadow = on ? this.cascadeShadow : this.dirShadow;
  }
}

/** quantize to 1/6 octave steps so split distances (and cascade radii) only change occasionally while zooming */
function quantizeLog(v: number, mode: 'round' | 'floor' | 'ceil' = 'round'): number {
  return Math.pow(2, Math[mode](Math.log2(Math.max(v, 1)) * 6) / 6);
}

const _basisX = new THREE.Vector3();
const _basisY = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export interface ShadowFit {
  /** camera target on the ground */
  target: THREE.Vector3;
  /** camera distance to target */
  distance: number;
  /** quality: shadow range multiplier */
  rangeMul: number;
  /** direction TO the light (unit) */
  lightDir: THREE.Vector3;
  /** highest terrain point (for caster ceiling) */
  maxHeight: number;
  /** map size in meters: the cascaded fit never extends past the map box (optional) */
  mapSize?: number;
  /** tallest caster above the terrain maximum (default 450 m) */
  casterHeight?: number;
  /** lowest terrain point (receiver volumes end there) */
  minHeight?: number;
}

const _box = new THREE.Vector3();

/**
 * Position the light / fit the shadow frustum for this frame.
 * Cascaded: split depths from the ground footprint; single: ortho box around the target, texel snapped.
 */
export function fitSunShadow(sun: CitySun, camera: THREE.PerspectiveCamera, f: ShadowFit) {
  const d = f.distance;
  if (sun.cascaded) {
    sun.position.copy(f.lightDir);
    sun.target.position.set(0, 0, 0);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    const sh = sun.cascadeShadow;
    // view depth of the target
    _tmp.copy(f.target).applyMatrix4(camera.matrixWorldInverse);
    const tDepth = Math.max(camera.near * 2, -_tmp.z);
    // nearest visible ground: bottom of the frustum hits the ground roughly at tDepth * k (depends on tilt);
    // use a conservative fraction and let the first cascade start there
    let start = Math.max(camera.near, tDepth * 0.35 - 60);
    let end = Math.min(camera.far, Math.max(tDepth * f.rangeMul, tDepth + 600));
    const top = f.maxHeight + (f.casterHeight ?? 450);
    sh.casterTop = top;
    sh.groundY = (f.minHeight ?? -50) - 2;
    if (f.mapSize) {
      // view depth range of the map box (linear in the corners): nothing casts or receives city shadows outside it
      let dMin = Infinity, dMax = -Infinity;
      for (let c = 0; c < 8; c++) {
        _box.set(c & 1 ? f.mapSize : 0, c & 2 ? top : -50, c & 4 ? f.mapSize : 0).applyMatrix4(camera.matrixWorldInverse);
        dMin = Math.min(dMin, -_box.z);
        dMax = Math.max(dMax, -_box.z);
      }
      if (dMax > camera.near) {
        end = Math.min(end, Math.max(dMax, start + 100));
        if (dMin > start) start = Math.min(dMin, end - 100);
      }
    }
    const split = THREE.MathUtils.clamp(tDepth * 1.25, start + (end - start) * 0.12, start + (end - start) * 0.55);
    // start rounds down / end rounds up so the (map-clamped) range still covers everything visible
    sh.splits[0] = quantizeLog(start, 'floor');
    sh.splits[1] = quantizeLog(split);
    sh.splits[2] = quantizeLog(end, 'ceil');
    sh.camera.near = 1;
    const t0 = sh.lastTexel[0];
    sh.normalBias = THREE.MathUtils.clamp(t0 * 1.2, 0.05, 1.5);
    sh.bias = -0.00015;
    return;
  }
  // single map: square around the target (covers the visible neighbourhood), snapped to texels in light space
  const sh = sun.dirShadow;
  const radius = Math.pow(2, Math.ceil(Math.log2(Math.max(120, d * f.rangeMul * 0.62)) * 6) / 6);
  const size = sh.mapSize.x;
  const texel = (2 * radius) / size;
  const L = f.lightDir;
  _up.set(0, 1, 0);
  if (Math.abs(L.y) > 0.99) _up.set(0, 0, 1);
  _basisX.crossVectors(_up, L).normalize();
  _basisY.crossVectors(L, _basisX).normalize();
  const cx = Math.round(f.target.dot(_basisX) / texel) * texel;
  const cy = Math.round(f.target.dot(_basisY) / texel) * texel;
  const cz = f.target.dot(L);
  _center.copy(_basisX).multiplyScalar(cx).addScaledVector(_basisY, cy).addScaledVector(L, cz);
  const back = Math.max(600, radius * 2 + f.maxHeight * 2);
  sun.target.position.copy(_center);
  sun.position.copy(_center).addScaledVector(L, back);
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  const cam = sh.camera as THREE.OrthographicCamera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = 1;
  cam.far = back + radius * 1.5 + 200;
  cam.updateProjectionMatrix();
  cam.userData.texel = texel;
  sh.normalBias = THREE.MathUtils.clamp(texel * 1.4, 0.05, 2);
  sh.bias = -0.0002;
  camera.updateMatrixWorld();
  setReceiver(sun.dirReceiver, camera, camera.near, Math.min(camera.far, radius * 4 + d * 2), L, (f.minHeight ?? -50) - 2);
}
