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
  /** already widened for the view's predicted motion (widenReceiver): caster lists culled against it take no guard
   *  band of their own (DynamicBatch) */
  banded: boolean;
}

export function makeReceiver(): ShadowReceiver {
  return {
    planes: Array.from({ length: 6 }, () => new THREE.Plane()), pl: new Float64Array(24), nl: new Float64Array(6), dir: new THREE.Vector3(0, 1, 0), ground: 0, version: 0, snap: new Float64Array(28), origin: new THREE.Vector3(), shape: 0, shapeSnap: new Float64Array(28), reach: 100,
    rot: new Float64Array(9), fwd: new THREE.Vector3(0, 0, -1), dn: 0, df: 0, phi: 0.6, form: 0, formSnap: new Float64Array(10),
    corners: new Float64Array(24), banded: false,
  };
}

/** out = rec (a new volume for the caster lists culled against out: its version is bumped), unwidened */
export function copyReceiver(out: ShadowReceiver, rec: ShadowReceiver): void {
  for (let i = 0; i < 6; i++) out.planes[i].copy(rec.planes[i]);
  out.pl.set(rec.pl);
  out.nl.set(rec.nl);
  out.dir.copy(rec.dir);
  out.ground = rec.ground;
  out.origin.copy(rec.origin);
  out.reach = rec.reach;
  out.rot.set(rec.rot);
  out.fwd.copy(rec.fwd);
  out.dn = rec.dn;
  out.df = rec.df;
  out.phi = rec.phi;
  out.form = rec.form;
  out.formSnap.set(rec.formSnap);
  out.corners.set(rec.corners);
  out.banded = false;
  out.version++;
}

/** does `outer` hold the volume of `inner` (same light / ground / projection as of their fits, inner's 8 corners inside
 *  outer's planes, within float noise)? A NaN corner or plane: no. */
export function receiverHolds(outer: ShadowReceiver, inner: ShadowReceiver): boolean {
  const fo = outer.formSnap, fi = inner.formSnap;
  for (let i = 0; i < fo.length; i++) if (fo[i] !== fi[i]) return false;
  const pl = outer.pl, c = inner.corners;
  for (let p = 0; p < 24; p += 4) {
    const nx = pl[p], ny = pl[p + 1], nz = pl[p + 2], d = pl[p + 3];
    for (let o = 0; o < 24; o += 3) {
      const x = c[o], y = c[o + 1], z = c[o + 2];
      if (!(nx * x + ny * y + nz * z + d >= -(1e-4 + 1e-7 * (Math.abs(x) + Math.abs(y) + Math.abs(z))))) return false;
    }
  }
  return true;
}

/** widenReceiver: most frames predicted, and its scratch (per step: the view position's offset, then the 8 corners'
 *  offsets from it: near / far per corner ray, as in ShadowReceiver.corners) */
export const WIDEN_MAX_FRAMES = 16;
const _wv = new Float64Array(27 * WIDEN_MAX_FRAMES);
const _wp = new Float64Array(24);
const _wc = new Float64Array(24);

/**
 * The receiver a single-map render culls its casters against when the map is to serve the next k frames too: the
 * view's receiver `rec` (this frame) widened to hold its volumes predicted for frames 1..k of the view's last per-frame
 * motion — rigid: rotation q (row-major 3x3, world axes) about the view position, then its travel v, repeated (the
 * travel turns with the view, so an orbit is extrapolated as an orbit and a zoom as a zoom). As DynamicBatch's guard
 * bands: each side plane (through the view position) turns outward about its hinge just enough to hold the predicted
 * corner rays, then shifts out by the view position's predicted travel across it; both by `err` more (relative: the
 * prediction's error, only where the motion widens) and by `pad` (m) more; the depth planes hold the predicted
 * corners' depth range with slack (the far plane culls nothing the map's square takes in, and a zoom moves it with the
 * view). Copies the light, ground, form and view pose of rec; out's corners are the widened volume's. Returns how much
 * wider the volume's cross-section at view depth `depth` gets (relative growth of its width plus that of its height:
 * about the share of casters it adds), or -1 (out untouched) when a side would turn by more than maxTurn or a
 * predicted corner ray cannot be held (a jump).
 */
export function widenReceiver(out: ShadowReceiver, rec: ShadowReceiver, v: ArrayLike<number>, q: ArrayLike<number>, k: number, err: number, pad: number, depth: number, maxTurn: number): number {
  k = Math.max(1, Math.min(WIDEN_MAX_FRAMES, k | 0));
  const cr = rec.corners;
  if (!(cr[0] === cr[0])) return -1;
  const ax = rec.origin.x, ay = rec.origin.y, az = rec.origin.z;
  const fx = rec.fwd.x, fy = rec.fwd.y, fz = rec.fwd.z;
  const W = _wv;
  // predicted view position offsets p_s = v + q v + ... + q^(s-1) v and corner offsets q^s (c - a), s = 1..k
  let px = 0, py = 0, pz = 0, tx = v[0], ty = v[1], tz = v[2];
  for (let s = 0; s < k; s++) {
    const o = s * 27, b = s === 0 ? -1 : (s - 1) * 27;
    px += tx; py += ty; pz += tz;
    W[o] = px; W[o + 1] = py; W[o + 2] = pz;
    const nx = q[0] * tx + q[1] * ty + q[2] * tz, ny = q[3] * tx + q[4] * ty + q[5] * tz, nz = q[6] * tx + q[7] * ty + q[8] * tz;
    tx = nx; ty = ny; tz = nz;
    for (let c = 0; c < 8; c++) {
      const x = b < 0 ? cr[c * 3] - ax : W[b + 3 + c * 3], y = b < 0 ? cr[c * 3 + 1] - ay : W[b + 4 + c * 3], z = b < 0 ? cr[c * 3 + 2] - az : W[b + 5 + c * 3];
      W[o + 3 + c * 3] = q[0] * x + q[1] * y + q[2] * z;
      W[o + 4 + c * 3] = q[3] * x + q[4] * y + q[5] * z;
      W[o + 5 + c * 3] = q[6] * x + q[7] * y + q[8] * z;
    }
  }
  const pl = rec.pl, P = _wp;
  // cross-section at `depth` before / after (distance of the view axis point to each side plane)
  const qx = ax + fx * depth, qy = ay + fy * depth, qz = az + fz * depth;
  let h0 = 0, h1 = 0, w0 = 0, w1 = 0;
  for (let i = 0; i < 4; i++) {
    const o = i * 4, nx = pl[o], ny = pl[o + 1], nz = pl[o + 2];
    // hinge turn: the normal rotates toward the view direction (its component along the plane)
    const fn = fx * nx + fy * ny + fz * nz;
    let ux = fx - fn * nx, uy = fy - fn * ny, uz = fz - fn * nz;
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
    let A = 0;
    if (ul > 1e-9) {
      ux /= ul; uy /= ul; uz /= ul;
      for (let s = 0; s < k; s++) {
        // (far corners: the near ones lie on the same rays)
        for (let c = 1; c < 8; c += 2) {
          const p = s * 27 + 3 + c * 3, rx = W[p], ry = W[p + 1], rz = W[p + 2];
          const a = nx * rx + ny * ry + nz * rz;
          if (a >= 0) continue;
          const b = ux * rx + uy * ry + uz * rz;
          if (!(b > 0)) return -1;
          const t = Math.atan2(-a, b);
          if (t > A) A = t;
        }
      }
      A *= 1 + err;
      if (A > maxTurn) return -1;
    } else ux = uy = uz = 0;
    const cA = Math.cos(A), sA = Math.sin(A);
    const mx = nx * cA + ux * sA, my = ny * cA + uy * sA, mz = nz * cA + uz * sA;
    // the view position travels to p_s: shift the plane out by what crosses it
    let tr = 0;
    for (let s = 0; s < k; s++) {
      const o = s * 27, mv = mx * W[o] + my * W[o + 1] + mz * W[o + 2];
      if (-mv > tr) tr = -mv;
    }
    const d = -(mx * ax + my * ay + mz * az) + tr * (1 + err) + pad;
    P[o] = mx; P[o + 1] = my; P[o + 2] = mz; P[o + 3] = d;
    const h = nx * qx + ny * qy + nz * qz + pl[o + 3], hw = mx * qx + my * qy + mz * qz + d;
    if (i < 2) { h0 += h; w0 += hw; } else { h1 += h; w1 += hw; }
  }
  // depth range: the current corners and the predicted ones (view position travel included), with slack
  let nd = rec.dn, fd = rec.df;
  for (let s = 0; s < k; s++) {
    const o = s * 27, pd = fx * W[o] + fy * W[o + 1] + fz * W[o + 2];
    for (let c = 0; c < 8; c++) {
      const p = o + 3 + c * 3, dd = pd + fx * W[p] + fy * W[p + 1] + fz * W[p + 2];
      if (dd < nd) nd = dd;
      if (dd > fd) fd = dd;
    }
  }
  nd = Math.min(rec.dn + (nd - rec.dn) * (1 + err), rec.dn * 0.5) - pad;
  fd = (rec.df + (fd - rec.df) * (1 + err)) * 1.3 + pad;
  const fa = fx * ax + fy * ay + fz * az;
  P[16] = -fx; P[17] = -fy; P[18] = -fz; P[19] = fa + fd;
  P[20] = fx; P[21] = fy; P[22] = fz; P[23] = -fa - nd;
  // the widened volume's corners: side x (NDC +1: plane 0, -1: plane 1) x side y (+1: plane 3, -1: plane 2) x depth
  // (near: plane 5, far: plane 4), as setReceiver orders them; each must lie inside the other planes
  const C = _wc;
  for (let c = 0; c < 4; c++) {
    for (let e = 0; e < 2; e++) {
      if (!corner3(P, c & 1 ? 0 : 1, c & 2 ? 3 : 2, e ? 4 : 5, C, (c * 2 + e) * 3)) return -1;
    }
  }
  for (let p = 0; p < 24; p += 4) {
    for (let o = 0; o < 24; o += 3) {
      const x = C[o], y = C[o + 1], z = C[o + 2];
      if (!(P[p] * x + P[p + 1] * y + P[p + 2] * z + P[p + 3] >= -(1e-3 + 1e-6 * (Math.abs(x) + Math.abs(y) + Math.abs(z))))) return -1;
    }
  }
  // (the current volume too: its corners inside the widened planes)
  for (let p = 0; p < 24; p += 4) {
    for (let o = 0; o < 24; o += 3) {
      const x = cr[o], y = cr[o + 1], z = cr[o + 2];
      if (!(P[p] * x + P[p + 1] * y + P[p + 2] * z + P[p + 3] >= -(1e-4 + 1e-7 * (Math.abs(x) + Math.abs(y) + Math.abs(z))))) return -1;
    }
  }
  const dx = rec.dir.x, dy = rec.dir.y, dz = rec.dir.z;
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    out.planes[i].normal.set(P[o], P[o + 1], P[o + 2]);
    out.planes[i].constant = P[o + 3];
    out.nl[i] = P[o] * dx + P[o + 1] * dy + P[o + 2] * dz;
  }
  out.pl.set(P);
  out.corners.set(C);
  out.dir.copy(rec.dir);
  out.ground = rec.ground;
  out.origin.copy(rec.origin);
  out.reach = rec.reach;
  out.rot.set(rec.rot);
  out.fwd.copy(rec.fwd);
  out.dn = nd;
  out.df = fd;
  out.phi = rec.phi;
  out.form = rec.form;
  out.formSnap.set(rec.formSnap);
  out.banded = true;
  out.version++;
  return (h0 > 1e-9 ? w0 / h0 - 1 : 0) + (h1 > 1e-9 ? w1 / h1 - 1 : 0);
}

/** intersection of planes a, b, c of P (nx, ny, nz, constant each) -> out[o..o+2]; false if they are (nearly) parallel */
function corner3(P: Float64Array, a: number, b: number, c: number, out: Float64Array, o: number): boolean {
  a *= 4; b *= 4; c *= 4;
  const ax = P[a], ay = P[a + 1], az = P[a + 2], ad = P[a + 3];
  const bx = P[b], by = P[b + 1], bz = P[b + 2], bd = P[b + 3];
  const cx = P[c], cy = P[c + 1], cz = P[c + 2], cd = P[c + 3];
  // b x c, c x a, a x b
  const bcx = by * cz - bz * cy, bcy = bz * cx - bx * cz, bcz = bx * cy - by * cx;
  const cax = cy * az - cz * ay, cay = cz * ax - cx * az, caz = cx * ay - cy * ax;
  const abx = ay * bz - az * by, aby = az * bx - ax * bz, abz = ax * by - ay * bx;
  const det = ax * bcx + ay * bcy + az * bcz;
  if (!(Math.abs(det) > 1e-12)) return false;
  const k = -1 / det;
  out[o] = (ad * bcx + bd * cax + cd * abx) * k;
  out[o + 1] = (ad * bcy + bd * cay + cd * aby) * k;
  out[o + 2] = (ad * bcz + bd * caz + cd * abz) * k;
  return true;
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
const _rmi = new THREE.Matrix4();
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
  // corners: the view's 4 corner rays (NDC x, y = +-1: the side planes' edges), each through two of its points (NDC
  // depth -1 and 0, finite for any far plane), at view depths dn and df
  const e = _rmi.copy(_rm).invert().elements, cr = rec.corners, fx = _fwd.x, fy = _fwd.y, fz = _fwd.z;
  let ok = true;
  for (let c = 0; c < 4; c++) {
    const x = c & 1 ? 1 : -1, y = c & 2 ? 1 : -1;
    const wa = e[3] * x + e[7] * y - e[11] + e[15], wb = e[3] * x + e[7] * y + e[15];
    const ax = (e[0] * x + e[4] * y - e[8] + e[12]) / wa, ay = (e[1] * x + e[5] * y - e[9] + e[13]) / wa, az = (e[2] * x + e[6] * y - e[10] + e[14]) / wa;
    const bx = (e[0] * x + e[4] * y + e[12]) / wb, by = (e[1] * x + e[5] * y + e[13]) / wb, bz = (e[2] * x + e[6] * y + e[14]) / wb;
    // view depth along the ray is affine in its parameter
    const da = (ax - cx) * fx + (ay - cy) * fy + (az - cz) * fz, db = (bx - cx) * fx + (by - cy) * fy + (bz - cz) * fz;
    const k = 1 / (db - da);
    for (let q = 0; q < 2; q++) {
      const t = ((q === 0 ? dn : df) - da) * k, o = (c * 2 + q) * 3;
      const px = ax + (bx - ax) * t, py = ay + (by - ay) * t, pz = az + (bz - az) * t;
      if (!Number.isFinite(px + py + pz)) ok = false;
      cr[o] = px; cr[o + 1] = py; cr[o + 2] = pz;
    }
  }
  // (degenerate: no list is kept by containment)
  if (!ok) cr.fill(NaN);
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
  /**
   * Far cascade hold (set by WorldView.updateShadowPolicy before the frame's fit): a shadow render then redraws the near
   * cascade only. The far cascade keeps its map tile and lookup matrix from its last render (restored after every fit;
   * its depth range is the fit's, so it joins the near cascade seamlessly), its pass draws nothing (its frustum is
   * emptied and flagged `hold`, which casters' frustum tests reject) and WorldView scissors the render to the near
   * cascade's tile, so the clear keeps the far one.
   */
  holdFar = false;
  /** the far cascade's lookup matrix, depth range, camera position / orientation as last rendered (farOk: valid) */
  private farM = new THREE.Matrix4();
  private farD = new THREE.Vector4();
  private farP = new THREE.Vector3();
  private farQ = new THREE.Quaternion();
  private farOk = false;
  /** the fit's far depth range and how far its far camera moved from the rendered one (fraction of its half size) */
  private readonly fitFarD = new THREE.Vector4();
  private fitFarShift = 0;
  private fitFarTurn = false;
  /** holdFar at the last fit (a change refits) */
  private fitHold = false;

  /** can the held far cascade stand in for this frame's fit? Not once its depth range changed by more than one split
   *  step (1/6 octave) since it was drawn, the light turned or it moved by more than a tenth of its size (a jump /
   *  camera cut: it would miss much of the new view) */
  get farHoldable(): boolean {
    const a = this.farD, b = this.fitFarD;
    return Math.abs(b.x - a.x) <= 0.13 * Math.abs(a.x) + 1 && Math.abs(b.y - a.y) <= 0.13 * a.y && !this.fitFarTurn && this.fitFarShift < 0.1;
  }

  /** is the far cascade held by the last fit (holdFar with valid old content)? */
  get farHeld(): boolean {
    return ((this as any)._frustums[CASCADES - 1] as { hold?: boolean }).hold === true;
  }

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
    if (this.sameFit(light, viewCamera) && this.fitHold === this.holdFar) return;
    this.fitHold = this.holdFar;
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
    // far cascade hold (see holdFar): its rendered state, or the state it keeps
    const F = CASCADES - 1, ff = frus[F] as THREE.Frustum & { hold?: boolean };
    this.fitFarD.copy(cdata[F]);
    this.fitFarShift = cams[F].position.distanceTo(this.farP) / Math.max(1e-6, cams[F].right);
    this.fitFarTurn = Math.abs(cams[F].quaternion.dot(this.farQ)) < 1 - 1e-9;
    if (this.holdFar && this.farOk) {
      mats[F].copy(this.farM);
      for (const p of ff.planes) { p.normal.set(0, 0, 0); p.constant = -1e30; }
      ff.hold = true;
    } else {
      this.farM.copy(mats[F]);
      this.farD.copy(cdata[F]);
      this.farP.copy(cams[F].position);
      this.farQ.copy(cams[F].quaternion);
      this.farOk = true;
      ff.hold = false;
    }
  }
  /** world size of a shadow texel per cascade (after last update) */
  lastTexel = [0.2, 1];
}

/** DirectionalLight that can run through three's cascaded SunLight path. */
export class CitySun extends THREE.DirectionalLight {
  readonly dirShadow: THREE.DirectionalLightShadow;
  readonly cascadeShadow: CityCascadeShadow;
  /** receiver volume of the single (low quality) map: the view's, fitted every frame by fitSunShadow */
  readonly dirReceiver = makeReceiver();
  /** the volume the single map's casters are culled against while dirReceiverCull is on: dirReceiver as of the map's
   *  last render, widened for the view's motion predicted until it may be needed again (WorldView.updateShadowPolicy,
   *  widenReceiver); the map serves every frame whose receiver it holds */
  readonly dirCull = makeReceiver();
  private _cascaded = false;
  private _dirCull = true;

  constructor(color: THREE.ColorRepresentation = 0xffffff, intensity = 3) {
    super(color, intensity);
    this.name = 'sun';
    this.dirShadow = this.shadow;
    this.dirShadow.camera.userData.cascade = 0;
    this.dirShadow.camera.userData.texel = 1;
    (this.dirShadow as any)._frustum.cascade = 0;
    this.dirReceiverCull = true;
    this.cascadeShadow = new CityCascadeShadow();
  }

  /**
   * Single map: cull its casters against the receiver volume (dirCull) or only against the map's own box, which draws
   * the casters of the whole square, also those behind the view (WorldView.capture: views other than the game view's).
   */
  get dirReceiverCull(): boolean {
    return this._dirCull;
  }

  set dirReceiverCull(on: boolean) {
    this._dirCull = on;
    this.dirShadow.camera.userData.recv = on ? this.dirCull : undefined;
    (this.dirShadow as any)._frustum.recv = on ? this.dirCull : undefined;
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

/** single map: its radius steps by 1 / DIR_RADIUS_STEPS octave while the view zooms (see fitSunShadow) */
export const DIR_RADIUS_STEPS = 6;

/** single map: log2 of the radius a fit asks for, before it is rounded up to the next step */
export function dirShadowLogRadius(f: ShadowFit): number {
  return Math.log2(Math.max(120, f.distance * f.rangeMul * 0.62));
}

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
  const radius = Math.pow(2, Math.ceil(dirShadowLogRadius(f) * DIR_RADIUS_STEPS) / DIR_RADIUS_STEPS);
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
