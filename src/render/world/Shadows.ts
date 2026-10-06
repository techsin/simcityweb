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
 * texel) so casters can cull / LOD per cascade (see DynamicBatch per-pass culling); the shadow frustums carry the
 * receiver volume (`recv`) and the cascade (`cascade`) for the casters' intersectsFrustum. The cascaded fit is clamped to
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
/** scalar inputs of a cascade fit (CityCascadeShadow.sameFit) */
const _fitV = new Float64Array(15);

/**
 * Global shadow-caster change counter: bumped by anything that changes what the shadow map would contain
 * (batched instances added / moved / hidden, tree chunks rebuilt...). WorldView re-renders the shadow map only
 * when the shadow cameras or the sun moved, or this counter changed (throttled), instead of every frame.
 */
export const shadowCasters = {
  version: 0,
  /** bumped by casters that move every frame (vehicles): WorldView re-renders the map for them every frame while the
   *  view is close enough for a one-frame shadow lag to show */
  dynamic: 0,
};

/**
 * Receiver volume of a shadow pass: the part of the VIEW frustum a cascade shades (its depth slice). A caster only
 * matters if its shadow (the caster swept away from the light down to the ground) reaches that volume — much tighter
 * than the cascade's ortho box, which is a light-aligned square around the slice's bounding sphere. Attached to the
 * shadow cameras (`userData.recv`) and frustums (`.recv`) every frame.
 */
export interface ShadowReceiver {
  planes: THREE.Plane[];
  /** the same 6 planes flattened (nx, ny, nz, constant each) for the per-caster tests (receiverSweep*: tree / terrain
   *  chunks every shadow pass) */
  pl: Float64Array;
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
  /** view camera position the volume was fitted at, and a counter bumped only when the volume changes other than
   *  by a translation (caster lists culled with a guard band stay valid while the view only moves a little) */
  origin: THREE.Vector3;
  shape: number;
  shapeSnap: Float64Array;
  /** view distance to the ground along the view axis (scale for guard bands) */
  reach: number;
  /** view camera orientation (unit world axes x, y, z: 9 numbers), view direction, depth slice [dn, df] and the view
   *  cone's half-diagonal (rad): caster lists culled against a widened receiver stay valid while the view turns /
   *  moves / narrows its slice by less than the widening (DynamicBatch) */
  rot: Float64Array;
  fwd: THREE.Vector3;
  dn: number;
  df: number;
  phi: number;
  /** bumped when the light direction, ground or view projection change (a widened receiver cannot cover that) */
  form: number;
  formSnap: Float64Array;
  /** the volume's 8 corners (x, y, z each): a caster list culled against a widened receiver stays valid while the
   *  current volume lies inside it (DynamicBatch) */
  corners: Float64Array;
}

export function makeReceiver(): ShadowReceiver {
  return {
    planes: Array.from({ length: 6 }, () => new THREE.Plane()), pl: new Float64Array(24), nl: new Float64Array(6), dir: new THREE.Vector3(0, 1, 0), ground: 0, version: 0, snap: new Float64Array(28), origin: new THREE.Vector3(), shape: 0, shapeSnap: new Float64Array(28), reach: 100,
    rot: new Float64Array(9), fwd: new THREE.Vector3(0, 0, -1), dn: 0, df: 0, phi: 0.6, form: 0, formSnap: new Float64Array(10),
    corners: new Float64Array(24),
  };
}

/** distance from a camera to the ground plane y = 0 along its view axis (clamped; grazing views count as far) */
export function viewReach(cam: THREE.Camera): number {
  const w = cam.matrixWorld.elements;
  // the camera looks along -Z: w[9] / |Z| is how steeply it looks down
  const down = w[9] / Math.max(1e-9, Math.hypot(w[8], w[9], w[10]));
  return Math.min(5000, Math.max(10, down > 0.05 ? w[13] / down : 2000));
}

const _rf = new THREE.Frustum();
const _rm = new THREE.Matrix4();
const _fwd = new THREE.Vector3();
const _cp = new THREE.Vector3();
/** the receiver volume's values (6 planes, light direction, ground) and the form values (light, ground, projection
 *  shape) for change detection (plain loops: setReceiver runs a few times per frame) */
const _snapV = new Float64Array(28);
const _formV = new Float64Array(9);
const _formTol = new Float64Array(9);

/** fit a receiver to a perspective view camera between view depths dn..df */
export function setReceiver(rec: ShadowReceiver, cam: THREE.Camera, dn: number, df: number, dirToLight: THREE.Vector3, ground: number): void {
  _rf.setFromProjectionMatrix(_rm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const planes = rec.planes;
  for (let i = 0; i < 4; i++) planes[i].copy(_rf.planes[i]);
  _fwd.set(0, 0, -1).transformDirection(cam.matrixWorld);
  _cp.setFromMatrixPosition(cam.matrixWorld);
  const fc = _fwd.dot(_cp);
  planes[4].normal.copy(_fwd).negate();
  planes[4].constant = fc + df;
  planes[5].normal.copy(_fwd);
  planes[5].constant = -fc - dn;
  rec.dir.copy(dirToLight).normalize();
  const dx = rec.dir.x, dy = rec.dir.y, dz = rec.dir.z;
  for (let i = 0; i < 6; i++) rec.nl[i] = planes[i].normal.dot(rec.dir);
  rec.ground = ground;
  // change detection (tolerant: a still, damped camera jitters by float ulps)
  const v = _snapV, pl = rec.pl;
  for (let i = 0; i < 6; i++) {
    const p = planes[i], n = p.normal, o = i * 4;
    v[o] = pl[o] = n.x; v[o + 1] = pl[o + 1] = n.y; v[o + 2] = pl[o + 2] = n.z; v[o + 3] = pl[o + 3] = p.constant;
  }
  v[24] = dx; v[25] = dy; v[26] = dz; v[27] = ground;
  const s = rec.snap;
  let changed = false;
  for (let i = 0; i < 28; i++) {
    const x = v[i];
    if (Math.abs(s[i] - x) > 1e-7 * Math.max(1, Math.abs(x))) { s[i] = x; changed = true; }
  }
  if (changed) rec.version++;
  // translation-invariant fingerprint: normals, plane offsets relative to the view position, light, ground
  rec.origin.copy(_cp);
  rec.reach = viewReach(cam);
  const h = rec.shapeSnap;
  const cx = _cp.x, cy = _cp.y, cz = _cp.z;
  let reshaped = false;
  for (let i = 0; i < 6; i++) {
    const p = planes[i], n = p.normal, o = i * 4;
    if (Math.abs(h[o] - n.x) > 1e-7) { h[o] = n.x; reshaped = true; }
    if (Math.abs(h[o + 1] - n.y) > 1e-7) { h[o + 1] = n.y; reshaped = true; }
    if (Math.abs(h[o + 2] - n.z) > 1e-7) { h[o + 2] = n.z; reshaped = true; }
    const c = p.constant + n.x * cx + n.y * cy + n.z * cz;
    if (Math.abs(h[o + 3] - c) > 1e-6 * Math.max(1, Math.abs(c), Math.abs(p.constant))) { h[o + 3] = c; reshaped = true; }
  }
  if (Math.abs(h[24] - dx) > 1e-7) { h[24] = dx; reshaped = true; }
  if (Math.abs(h[25] - dy) > 1e-7) { h[25] = dy; reshaped = true; }
  if (Math.abs(h[26] - dz) > 1e-7) { h[26] = dz; reshaped = true; }
  if (Math.abs(h[27] - ground) > 1e-6) { h[27] = ground; reshaped = true; }
  if (reshaped) rec.shape++;
  // view orientation / slice / cone for widened-receiver caster lists
  const w = cam.matrixWorld.elements;
  for (let c = 0; c < 3; c++) {
    const ax = w[c * 4], ay = w[c * 4 + 1], az = w[c * 4 + 2];
    const l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    rec.rot[c * 3] = ax / l; rec.rot[c * 3 + 1] = ay / l; rec.rot[c * 3 + 2] = az / l;
  }
  rec.fwd.copy(_fwd);
  rec.dn = dn;
  rec.df = df;
  const P = cam.projectionMatrix.elements;
  const persp = (cam as THREE.PerspectiveCamera).isPerspectiveCamera === true;
  rec.phi = persp ? Math.atan(Math.hypot(1 / P[0], 1 / P[5]) + Math.hypot(P[8] / P[0], P[9] / P[5])) : 0;
  const f = _formV, ft = _formTol;
  f[0] = dx; f[1] = dy; f[2] = dz; f[3] = ground; f[4] = P[0]; f[5] = P[5]; f[6] = P[8]; f[7] = P[9]; f[8] = persp ? 1 : 0;
  ft[0] = ft[1] = ft[2] = 1e-7; ft[3] = 1e-6; ft[4] = 1e-9 * Math.abs(P[0]); ft[5] = 1e-9 * Math.abs(P[5]); ft[6] = ft[7] = 1e-9; ft[8] = 0.5;
  const fs = rec.formSnap;
  let reformed = false;
  for (let i = 0; i < 9; i++) if (Math.abs(fs[i] - f[i]) > ft[i]) { fs[i] = f[i]; reformed = true; }
  if (reformed) rec.form++;
  // corners: the view's corner rays (through its near-plane corners) at view depths dn and df
  const pi = cam.projectionMatrixInverse.elements, cr = rec.corners;
  for (let c = 0; c < 4; c++) {
    const x = c & 1 ? 1 : -1, y = c & 2 ? 1 : -1;
    const vw = pi[3] * x + pi[7] * y - pi[11] + pi[15];
    const vx = (pi[0] * x + pi[4] * y - pi[8] + pi[12]) / vw, vy = (pi[1] * x + pi[5] * y - pi[9] + pi[13]) / vw, vz = (pi[2] * x + pi[6] * y - pi[10] + pi[14]) / vw;
    // the near-plane corner in world space, its ray from the camera and that ray's view depth per unit
    const wx = w[0] * vx + w[4] * vy + w[8] * vz + w[12], wy = w[1] * vx + w[5] * vy + w[9] * vz + w[13], wz = w[2] * vx + w[6] * vy + w[10] * vz + w[14];
    let rx = wx - cx, ry = wy - cy, rz = wz - cz;
    const dep = rx * _fwd.x + ry * _fwd.y + rz * _fwd.z;
    if (persp && dep > 1e-9) { rx /= dep; ry /= dep; rz /= dep; }
    else { rx = 0; ry = 0; rz = 0; }
    // (orthographic views: the corner itself at both depths, shifted along the view direction)
    const bx = persp ? cx : wx - _fwd.x * dep, by = persp ? cy : wy - _fwd.y * dep, bz = persp ? cz : wz - _fwd.z * dep;
    for (let k = 0; k < 2; k++) {
      const d = k === 0 ? dn : df, o = (c * 2 + k) * 3;
      cr[o] = persp ? bx + rx * d : bx + _fwd.x * d;
      cr[o + 1] = persp ? by + ry * d : by + _fwd.y * d;
      cr[o + 2] = persp ? bz + rz * d : bz + _fwd.z * d;
    }
  }
}

/** can a caster sphere shadow the receiver volume? (sphere swept away from the light down to the ground) */
export function receiverSweepSphere(rec: ShadowReceiver, cx: number, cy: number, cz: number, r: number): boolean {
  const T = Math.min(6000, Math.max(0, (cy + r - rec.ground) / Math.max(rec.dir.y, 0.05)));
  const pl = rec.pl, nl = rec.nl;
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    const d0 = pl[o] * cx + pl[o + 1] * cy + pl[o + 2] * cz + pl[o + 3];
    if (d0 < -r && d0 - T * nl[i] < -r) return false;
  }
  return true;
}

/** is the box entirely inside the receiver volume? (then every caster in it certainly shadows it: no per-caster test) */
export function receiverContainsBox(rec: ShadowReceiver, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  const pl = rec.pl;
  for (let i = 0; i < 6; i++) {
    const o = i * 4, nx = pl[o], ny = pl[o + 1], nz = pl[o + 2];
    // n-vertex: the corner with the smallest signed distance
    if (nx * (nx > 0 ? x0 : x1) + ny * (ny > 0 ? y0 : y1) + nz * (nz > 0 ? z0 : z1) + pl[o + 3] < 0) return false;
  }
  return true;
}

/** can a caster box shadow the receiver volume? */
export function receiverSweepBox(rec: ShadowReceiver, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  const T = Math.min(6000, Math.max(0, (y1 - rec.ground) / Math.max(rec.dir.y, 0.05)));
  const pl = rec.pl, nl = rec.nl;
  for (let i = 0; i < 6; i++) {
    const o = i * 4, nx = pl[o], ny = pl[o + 1], nz = pl[o + 2];
    const d = nx * (nx > 0 ? x1 : x0) + ny * (ny > 0 ? y1 : y0) + nz * (nz > 0 ? z1 : z0) + pl[o + 3];
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

  /** inputs of the last fit (view / light matrices, splits, sizes; see sameFit) */
  private fitKey = new Float64Array(48);
  private fitCam: THREE.Camera | null = null;
  private fitLight: THREE.Light | null = null;

  constructor() {
    super();
    const cams = (this as any)._cameras as THREE.OrthographicCamera[];
    const frus = (this as any)._frustums as THREE.Frustum[];
    // (frustums carry their cascade too: casters skip whole passes in Object3D.intersectsFrustum, see DynamicBatch)
    cams.forEach((c, i) => { c.userData.cascade = i; c.userData.texel = 1; c.userData.recv = this.receivers[i]; (frus[i] as any).recv = this.receivers[i]; (frus[i] as any).cascade = i; });
  }

  /** true when the fit inputs equal the last call's: the cascades are fitted twice per rendered shadow frame (WorldView
   *  fits them to see whether they moved, three fits them again when it renders the map), the second one is free */
  private sameFit(light: THREE.Light, vc: THREE.Camera): boolean {
    const k = this.fitKey;
    let same = vc === this.fitCam && light === this.fitLight;
    this.fitCam = vc;
    this.fitLight = light;
    const a = vc.matrixWorld.elements, b = vc.projectionMatrix.elements, l = light.matrixWorld.elements;
    for (let i = 0; i < 16; i++) {
      if (k[i] !== a[i]) { k[i] = a[i]; same = false; }
      if (k[16 + i] !== b[i]) { k[16 + i] = b[i]; same = false; }
    }
    const f = _fitV, pc = vc as THREE.PerspectiveCamera;
    f[0] = l[12]; f[1] = l[13]; f[2] = l[14];
    f[3] = this.splits[0]; f[4] = this.splits[1]; f[5] = this.splits[2]; f[6] = this.casterTop; f[7] = this.groundY;
    f[8] = this.radius; f[9] = this.mapSize.x; f[10] = this.mapSize.y; f[11] = this.camera.near; f[12] = pc.near; f[13] = pc.far;
    f[14] = pc.isPerspectiveCamera === true ? 1 : 0;
    for (let i = 0; i < 15; i++) if (k[32 + i] !== f[i]) { k[32 + i] = f[i]; same = false; }
    return same;
  }

  override updateMatrices(light: THREE.Light, viewCamera?: THREE.Camera): void {
    if (!viewCamera) return;
    if (this.sameFit(light, viewCamera)) return;
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
    // (up to 6 km: a low sun casts tall buildings' shadows kilometres across the map)
    maxZ += Math.min(Math.max(s2, 2500), 6000, reach);
    const shadowNear = this.camera.near;
    const toLight = _world.copy(_lightDirection).negate();
    for (let i = 0; i < CASCADES; i++) {
      const cNear = i === 0 ? s0 : cdata[i - 1].z;
      const cFar = i === 0 ? s1 : s2;
      if (persp) setReceiver(this.receivers[i], vc, i === 0 ? camNear : cNear * 0.98, cFar * 1.02, toLight, this.groundY);
      cams[i].userData.recv = persp ? this.receivers[i] : undefined;
      (frus[i] as any).recv = persp ? this.receivers[i] : undefined;
      const fadeStart = cFar - FADE * (cFar - (i === 0 ? s0 : s1));
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
    this.lastTexel[0] = (2 * cams[0].right) / resX;
    this.lastTexel[1] = (2 * cams[1].right) / resX;
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
    (this.dirShadow as any)._frustum.cascade = 0;
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
