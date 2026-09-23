/**
 * Shared modeling helpers for the 'park' and 'landmark' builders (owned by the park/landmark asset agent).
 * Everything draws INTO a ModelBuilder in model space (meters, lot centered, +Z = front / street side).
 *
 * Highlights:
 *  - flatPoly / disc / annulus / ribbon / spline / blobPoly: organic ground shapes (paths, ponds, beds)
 *  - lathe (revolve a profile, smooth normals with creases) and loftRing (sweep a cross-section along a closed plan path)
 *  - track3D: ribbon following a 3D polyline (coaster track, cables)
 *  - trees, flower beds, fountain, lamps, benches, bleachers, floodlight masts, fences, goals
 */
import * as THREE from 'three';
import { ModelBuilder, PALETTE, type ColorLike, type Paint } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import type { ModelBuilders, ModelBuildFn } from '../registry';

export type P2 = [number, number];
export type V3 = [number, number, number];
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------- flat shapes
/** Up-facing triangle (auto winding). */
export function upTri(b: ModelBuilder, a: V3, c1: V3, c2: V3): void {
  const ny = (c1[2] - a[2]) * (c2[0] - a[0]) - (c1[0] - a[0]) * (c2[2] - a[2]);
  if (ny >= 0) b.tri(a, c1, c2);
  else b.tri(a, c2, c1);
}

/** Flat up-facing polygon at height y (any winding, may be concave). */
export function flatPoly(b: ModelBuilder, pts: P2[], y: number): void {
  if (pts.length < 3) return;
  const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [i, j, k] of tris) upTri(b, [pts[i][0], y, pts[i][1]], [pts[j][0], y, pts[j][1]], [pts[k][0], y, pts[k][1]]);
}

/** Flat up-facing quad strip (thin line / marking) from a to b with width w at height y. 2 tris. */
export function line(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, w: number, y: number): void {
  const dx = bx - ax, dz = bz - az;
  const l = Math.hypot(dx, dz) || 1;
  const px = (-dz / l) * (w / 2), pz = (dx / l) * (w / 2);
  upTri(b, [ax + px, y, az + pz], [bx + px, y, bz + pz], [bx - px, y, bz - pz]);
  upTri(b, [ax + px, y, az + pz], [bx - px, y, bz - pz], [ax - px, y, az - pz]);
}

/** Axis aligned flat rectangle (top face only) — markings, tiles. 2 tris. */
export function rect(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number): void {
  b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
}

/** Rectangle outline made of 4 flat lines (markings). */
export function rectLines(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, w: number, y: number): void {
  const h = w / 2;
  rect(b, x0 - h, z0 - h, x1 + h, z0 + h, y);
  rect(b, x0 - h, z1 - h, x1 + h, z1 + h, y);
  rect(b, x0 - h, z0 + h, x0 + h, z1 - h, y);
  rect(b, x1 - h, z0 + h, x1 + h, z1 - h, y);
}

/** Flat disc. */
export function disc(b: ModelBuilder, cx: number, cz: number, y: number, r: number, seg = 16): void {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
    upTri(b, [cx, y, cz], [cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r]);
  }
}

/** Flat ring (annulus) or arc of a ring between angles a0..a1. */
export function annulus(b: ModelBuilder, cx: number, cz: number, y: number, r0: number, r1: number, seg = 16, a0 = 0, a1 = TAU): void {
  for (let i = 0; i < seg; i++) {
    const t0 = a0 + ((a1 - a0) * i) / seg, t1 = a0 + ((a1 - a0) * (i + 1)) / seg;
    const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
    upTri(b, [cx + c0 * r0, y, cz + s0 * r0], [cx + c0 * r1, y, cz + s0 * r1], [cx + c1 * r1, y, cz + s1 * r1]);
    upTri(b, [cx + c0 * r0, y, cz + s0 * r0], [cx + c1 * r1, y, cz + s1 * r1], [cx + c1 * r0, y, cz + s1 * r0]);
  }
}

/** Vertical wall quad from (ax,az) to (bx,bz); faces to the LEFT of a->b when seen from above with +x right, +z down
 * (i.e. normal = (-dz, 0, dx)). */
export function wall(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, y0: number, y1: number): void {
  b.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]);
}

/** Cylinder wall (open), optionally facing inward, optionally partial arc. */
export function cylWall(b: ModelBuilder, cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, seg: number, inward = false, a0 = 0, a1 = TAU): void {
  const slope = (r0 - r1) / (y1 - y0 || 1);
  for (let i = 0; i < seg; i++) {
    const t0 = a0 + ((a1 - a0) * i) / seg, t1 = a0 + ((a1 - a0) * (i + 1)) / seg;
    const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
    const p00: V3 = [cx + c0 * r0, y0, cz + s0 * r0], p10: V3 = [cx + c1 * r0, y0, cz + s1 * r0];
    const p01: V3 = [cx + c0 * r1, y1, cz + s0 * r1], p11: V3 = [cx + c1 * r1, y1, cz + s1 * r1];
    const n0 = nrm([c0, slope, s0]), n1 = nrm([c1, slope, s1]);
    if (!inward) {
      b.triN(p00, p11, p10, n0, n1, n1);
      b.triN(p00, p01, p11, n0, n0, n1);
    } else {
      const m0 = neg(n0), m1 = neg(n1);
      b.triN(p00, p10, p11, m0, m1, m1);
      b.triN(p00, p11, p01, m0, m1, m0);
    }
  }
}

/** Basin / planter: outer wall + rim + inner wall, open inside (fill it yourself). */
export function tube(b: ModelBuilder, cx: number, cz: number, y0: number, y1: number, rOut: number, rIn: number, seg: number, yInner = y0): void {
  cylWall(b, cx, cz, y0, y1, rOut, rOut, seg);
  annulus(b, cx, cz, y1, rIn, rOut, seg);
  cylWall(b, cx, cz, yInner, y1, rIn, rIn, seg, true);
}

// ---------------------------------------------------------------------------------------------- curves
/** Catmull-Rom spline through control points; returns sampled points (open or closed). */
export function spline(ctrl: P2[], perSeg = 6, closed = false): P2[] {
  const n = ctrl.length;
  if (n < 2) return ctrl.slice();
  const out: P2[] = [];
  const get = (i: number): P2 => (closed ? ctrl[((i % n) + n) % n] : ctrl[Math.max(0, Math.min(n - 1, i))]);
  const segs = closed ? n : n - 1;
  for (let s = 0; s < segs; s++) {
    const p0 = get(s - 1), p1 = get(s), p2 = get(s + 1), p3 = get(s + 2);
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b2: number, c: number, d: number) => 0.5 * (2 * b2 + (-a + c) * t + (2 * a - 5 * b2 + 4 * c - d) * t2 + (-a + 3 * b2 - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push(ctrl[n - 1]);
  return out;
}

/** Organic closed polygon around (cx,cz) with radii rx, rz, deformed by low-frequency harmonics. */
export function blobPoly(rng: RNG, cx: number, cz: number, rx: number, rz: number, n = 16, amount = 0.18, rot = 0): P2[] {
  const h = [rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU)];
  const a = [rng.range(0.4, 1), rng.range(0.3, 0.8), rng.range(0.1, 0.5)];
  const pts: P2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const k = 1 + amount * (a[0] * Math.sin(2 * t + h[0]) + a[1] * Math.sin(3 * t + h[1]) + a[2] * Math.sin(5 * t + h[2])) / 1.6;
    const x = Math.cos(t) * rx * k, z = Math.sin(t) * rz * k;
    pts.push([cx + x * Math.cos(rot) - z * Math.sin(rot), cz + x * Math.sin(rot) + z * Math.cos(rot)]);
  }
  return pts;
}

/** Offset a closed polygon outward by d (miter, clamped). Polygon orientation is auto-detected. */
export function offsetPoly(pts: P2[], d: number): P2[] {
  const n = pts.length;
  const sgn = signedArea(pts) > 0 ? 1 : -1;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
    const n1 = segNormal(p, c, sgn), n2 = segNormal(c, q, sgn);
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const cos = Math.max(0.35, mx * n1[0] + mz * n1[1]);
    out.push([c[0] + (mx * d) / cos, c[1] + (mz * d) / cos]);
  }
  return out;
}

export function signedArea(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    a += ax * bz - bx * az;
  }
  return a / 2;
}
/** outward normal of segment a->b for polygon with orientation sgn (signedArea sign). */
function segNormal(a: P2, c: P2, sgn: number): P2 {
  const dx = c[0] - a[0], dz = c[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  // for sgn>0 (x right, z down => clockwise on screen), outward normal is (dz, -dx)
  return sgn > 0 ? [dz / l, -dx / l] : [-dz / l, dx / l];
}

/**
 * Ribbon along a polyline (paths, rims, tracks on the ground). Top face at y; with `sides`, vertical side walls down to y0.
 * `closed` joins the last point to the first.
 */
export function ribbon(b: ModelBuilder, pts: P2[], w: number, y: number, opts: { closed?: boolean; sides?: boolean; y0?: number } = {}): void {
  const n = pts.length;
  if (n < 2) return;
  const closed = opts.closed ?? false;
  const hw = w / 2;
  const L: P2[] = [], R: P2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const c = pts[i];
    // segment directions
    const d1 = dir2(prev, c, next, c), d2 = dir2(c, next, c, prev);
    let tx = d1[0] + d2[0], tz = d1[1] + d2[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const px = -tz, pz = tx;
    const cos = Math.max(0.4, Math.abs(px * -d1[1] + pz * d1[0]));
    L.push([c[0] + (px * hw) / cos, c[1] + (pz * hw) / cos]);
    R.push([c[0] - (px * hw) / cos, c[1] - (pz * hw) / cos]);
  }
  const segs = closed ? n : n - 1;
  const y0 = opts.y0 ?? 0;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    upTri(b, [L[i][0], y, L[i][1]], [L[j][0], y, L[j][1]], [R[j][0], y, R[j][1]]);
    upTri(b, [L[i][0], y, L[i][1]], [R[j][0], y, R[j][1]], [R[i][0], y, R[i][1]]);
    if (opts.sides) {
      wall(b, L[i][0], L[i][1], L[j][0], L[j][1], y0, y); // faces +perp (left)
      wall(b, R[j][0], R[j][1], R[i][0], R[i][1], y0, y); // faces -perp (right)
    }
  }
}
function dir2(a: P2, c: P2, fa: P2, fc: P2): P2 {
  let dx = c[0] - a[0], dz = c[1] - a[1];
  let l = Math.hypot(dx, dz);
  if (l < 1e-6) {
    dx = fc[0] - fa[0];
    dz = fc[1] - fa[1];
    l = Math.hypot(dx, dz) || 1;
    return [-dx / l, -dz / l];
  }
  return [dx / l, dz / l];
}

/** Arc points (for markings, paths). */
export function arcPts(cx: number, cz: number, r: number, a0: number, a1: number, seg: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = a0 + ((a1 - a0) * i) / seg;
    out.push([cx + Math.cos(t) * r, cz + Math.sin(t) * r]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- solids of revolution / sweeps
/** A profile point [radius, y] with optional paint for the segment that STARTS at this point. */
export type ProfPt = [number, number] | [number, number, Paint];

/**
 * Revolve a profile around the Y axis at (cx, cz). Profile goes from bottom-outer upward (counter-clockwise around the
 * solid cross-section when viewed with r to the right, y up) so normals face outward. Adjacent segments whose directions
 * differ by less than `crease` degrees are smooth-shaded.
 */
export function lathe(b: ModelBuilder, cx: number, cz: number, prof: ProfPt[], seg = 16, crease = 35, a0 = 0, a1 = TAU): void {
  const base = b.getPaint();
  const segN = computeProfileNormals(prof, crease);
  for (let k = 0; k < prof.length - 1; k++) {
    const p = prof[k], q = prof[k + 1];
    if (p.length === 3) b.paint(p[2]);
    const [na, nb] = segN[k];
    for (let i = 0; i < seg; i++) {
      const t0 = a0 + ((a1 - a0) * i) / seg, t1 = a0 + ((a1 - a0) * (i + 1)) / seg;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      const A0: V3 = [cx + c0 * p[0], p[1], cz + s0 * p[0]], A1: V3 = [cx + c1 * p[0], p[1], cz + s1 * p[0]];
      const B0: V3 = [cx + c0 * q[0], q[1], cz + s0 * q[0]], B1: V3 = [cx + c1 * q[0], q[1], cz + s1 * q[0]];
      const nA0: V3 = [na[0] * c0, na[1], na[0] * s0], nA1: V3 = [na[0] * c1, na[1], na[0] * s1];
      const nB0: V3 = [nb[0] * c0, nb[1], nb[0] * s0], nB1: V3 = [nb[0] * c1, nb[1], nb[0] * s1];
      if (p[0] > 1e-5) b.triN(A0, B1, A1, nA0, nB1, nA1);
      if (q[0] > 1e-5) b.triN(A0, B0, B1, nA0, nB0, nB1);
    }
  }
  b.paint(base);
}

/** per segment [normal at start, normal at end] in (r, y) space, with crease handling */
function computeProfileNormals(prof: ProfPt[], crease: number): [P2, P2][] {
  const segs: P2[] = [];
  for (let k = 0; k < prof.length - 1; k++) {
    const dr = prof[k + 1][0] - prof[k][0], dy = prof[k + 1][1] - prof[k][1];
    const l = Math.hypot(dr, dy) || 1;
    segs.push([dy / l, -dr / l]);
  }
  const cosC = Math.cos((crease * Math.PI) / 180);
  const out: [P2, P2][] = [];
  for (let k = 0; k < segs.length; k++) {
    const n = segs[k];
    let s = n, e = n;
    if (k > 0) {
      const pn = segs[k - 1];
      if (pn[0] * n[0] + pn[1] * n[1] > cosC) s = nrm2([pn[0] + n[0], pn[1] + n[1]]);
    }
    if (k < segs.length - 1) {
      const nn = segs[k + 1];
      if (nn[0] * n[0] + nn[1] * n[1] > cosC) e = nrm2([nn[0] + n[0], nn[1] + n[1]]);
    }
    out.push([s, e]);
  }
  return out;
}

/**
 * Sweep a cross-section profile [d, y] along a CLOSED plan path (d = outward offset from the path).
 * Same profile conventions as lathe (outer wall upward, then inward over the top, then down the inside).
 */
export function loftRing(b: ModelBuilder, path: P2[], prof: ProfPt[], crease = 35): void {
  const n = path.length;
  const sgn = signedArea(path) > 0 ? 1 : -1;
  const N: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = segNormal(path[(i - 1 + n) % n], path[i], sgn), c = segNormal(path[i], path[(i + 1) % n], sgn);
    N.push(nrm2([a[0] + c[0], a[1] + c[1]]));
  }
  const base = b.getPaint();
  const segN = computeProfileNormals(prof, crease);
  for (let k = 0; k < prof.length - 1; k++) {
    const p = prof[k], q = prof[k + 1];
    if (p.length === 3) b.paint(p[2]);
    const [na, nb] = segN[k];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const P = (idx: number, pp: ProfPt): V3 => [path[idx][0] + N[idx][0] * pp[0], pp[1], path[idx][1] + N[idx][1] * pp[0]];
      const Nn = (idx: number, nn: P2): V3 => nrm([N[idx][0] * nn[0], nn[1], N[idx][1] * nn[0]]);
      const A0 = P(i, p), A1 = P(j, p), B0 = P(i, q), B1 = P(j, q);
      // orientation: path with sgn>0 runs clockwise on screen (x right, z down) => same as lathe's angle direction
      if (sgn > 0) {
        b.triN(A0, B1, A1, Nn(i, na), Nn(j, nb), Nn(j, na));
        b.triN(A0, B0, B1, Nn(i, na), Nn(i, nb), Nn(j, nb));
      } else {
        b.triN(A0, A1, B1, Nn(i, na), Nn(j, na), Nn(j, nb));
        b.triN(A0, B1, B0, Nn(i, na), Nn(j, nb), Nn(i, nb));
      }
    }
  }
  b.paint(base);
}

/** Rounded rectangle / stadium-shaped closed path centered at (cx,cz). r = corner radius. */
export function roundRectPath(cx: number, cz: number, w: number, d: number, r: number, cornerSeg = 6): P2[] {
  const out: P2[] = [];
  const hx = w / 2 - r, hz = d / 2 - r;
  const corners: [number, number, number][] = [
    [hx, hz, 0], [-hx, hz, Math.PI / 2], [-hx, -hz, Math.PI], [hx, -hz, Math.PI * 1.5],
  ];
  for (const [ox, oz, a0] of corners) {
    for (let i = 0; i <= cornerSeg; i++) {
      const t = a0 + (Math.PI / 2) * (i / cornerSeg);
      out.push([cx + ox + Math.cos(t) * r, cz + oz + Math.sin(t) * r]);
    }
  }
  return out;
}

/** Superellipse path (|x/a|^p + |z/b|^p = 1), good for stadium bowls. */
export function superEllipse(cx: number, cz: number, a: number, c: number, p: number, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const ct = Math.cos(t), st = Math.sin(t);
    const x = a * Math.sign(ct) * Math.pow(Math.abs(ct), 2 / p);
    const z = c * Math.sign(st) * Math.pow(Math.abs(st), 2 / p);
    out.push([cx + x, cz + z]);
  }
  return out;
}

/**
 * Rectangular-section ribbon following a 3D polyline (coaster track, walkway). Width is horizontal-ish (perpendicular to
 * travel and to `up` hint), continuous through loops. 8 tris per segment (top, bottom, 2 sides).
 */
export function track3D(b: ModelBuilder, pts: V3[], w: number, t: number, opts: { closed?: boolean; bottom?: boolean } = {}): V3[] {
  const n = pts.length;
  const closed = opts.closed ?? false;
  const sides: V3[] = [];
  const ups: V3[] = [];
  let prevSide: V3 | null = null;
  for (let i = 0; i < n; i++) {
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const c = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const tg = nrm([c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    let s = cross(tg, [0, 1, 0]);
    const sl = Math.hypot(s[0], s[1], s[2]);
    if (sl < 0.15 && prevSide) s = prevSide;
    else if (sl < 1e-6) s = [1, 0, 0];
    else s = [s[0] / sl, s[1] / sl, s[2] / sl];
    if (prevSide && dot(s, prevSide) < 0) s = [-s[0], -s[1], -s[2]];
    prevSide = s;
    sides.push(s);
    ups.push(nrm(cross(s, tg)));
  }
  const segs = closed ? n : n - 1;
  const hw = w / 2;
  const off = (p: V3, s: V3, u: V3, a: number, c: number): V3 => [p[0] + s[0] * a + u[0] * c, p[1] + s[1] * a + u[1] * c, p[2] + s[2] * a + u[2] * c];
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const p = pts[i], q = pts[j], si = sides[i], sj = sides[j], ui = ups[i], uj = ups[j];
    const pTL = off(p, si, ui, -hw, 0), pTR = off(p, si, ui, hw, 0), pBL = off(p, si, ui, -hw, -t), pBR = off(p, si, ui, hw, -t);
    const qTL = off(q, sj, uj, -hw, 0), qTR = off(q, sj, uj, hw, 0), qBL = off(q, sj, uj, -hw, -t), qBR = off(q, sj, uj, hw, -t);
    orientQuad(b, pTL, pTR, qTR, qTL, ui);
    if (opts.bottom ?? true) orientQuad(b, pBL, qBL, qBR, pBR, [-ui[0], -ui[1], -ui[2]]);
    orientQuad(b, pTR, pBR, qBR, qTR, si);
    orientQuad(b, pTL, qTL, qBL, pBL, [-si[0], -si[1], -si[2]]);
  }
  return ups;
}

/** quad a,b,c,d with winding chosen so that its normal agrees with `want`. */
export function orientQuad(b: ModelBuilder, a: V3, c1: V3, c2: V3, d: V3, want: V3): void {
  const u: V3 = [c1[0] - a[0], c1[1] - a[1], c1[2] - a[2]], v: V3 = [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]];
  const n = cross(u, v);
  if (dot(n, want) >= 0) b.quad(a, c1, c2, d);
  else b.quad(d, c2, c1, a);
}
/** triangle with winding chosen so that its normal agrees with `want`. */
export function orientTri(b: ModelBuilder, a: V3, c1: V3, c2: V3, want: V3): void {
  const u: V3 = [c1[0] - a[0], c1[1] - a[1], c1[2] - a[2]], v: V3 = [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]];
  if (dot(cross(u, v), want) >= 0) b.tri(a, c1, c2);
  else b.tri(a, c2, c1);
}

// ---------------------------------------------------------------------------------------------- vector utils
export function nrm(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function nrm2(v: P2): P2 {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}
function neg(v: V3): V3 {
  return [-v[0], -v[1], -v[2]];
}
export function cross(a: V3, c: V3): V3 {
  return [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
}
export function dot(a: V3, c: V3): number {
  return a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
}

// ---------------------------------------------------------------------------------------------- palettes
export const GRASS = [0x6c9a44, 0x74a24a, 0x659240, 0x7aa852, 0x5f8c3c];
export const GRASS_LUSH = 0x6fa047;
export const GRASS_DARK = 0x557f36;
export const MEADOW = 0x8ea957;
export const PATH_GRAVEL = 0xcdbf9f;
export const PATH_PAVE = 0xc9c3b5;
export const PATH_RED = 0xb57a5c;
export const SOIL = 0x5a4331;
export const STONE_RIM = 0xb9b2a3;
export const POND_WATER = 0x3d7384;
export const FLOWERS = [0xe0475a, 0xf2c14e, 0xf28ab2, 0xffffff, 0x9b6ad6, 0xf07b3f, 0xd62d6a];
export const FOLIAGE = [0x4d7a30, 0x5a8a38, 0x3f6d2c, 0x668f3a, 0x4a7f3c, 0x57843a];
export const LAMP_GLOW = 0xffe0a6;

// ---------------------------------------------------------------------------------------------- ground
/** Lawn base covering rect plus a few irregular tone patches (subtle mowing / color variation). */
export function lawnPatchwork(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, base: ColorLike = GRASS_LUSH, patches = 4, h = 0.06): void {
  b.paint(base, Surf.Foliage).slab(x0, z0, x1, z1, h);
  const w = x1 - x0, d = z1 - z0;
  for (let i = 0; i < patches; i++) {
    const rx = rng.range(0.15, 0.3) * w, rz = rng.range(0.15, 0.3) * d;
    const cx = rng.range(x0 + rx * 0.7, x1 - rx * 0.7), cz = rng.range(z0 + rz * 0.7, z1 - rz * 0.7);
    const poly = blobPoly(rng, cx, cz, rx, rz, 12, 0.3).map(([x, z]) => [Math.max(x0, Math.min(x1, x)), Math.max(z0, Math.min(z1, z))] as P2);
    b.paint(rng.pick(GRASS), Surf.Foliage);
    flatPoly(b, poly, h + 0.005 + i * 0.002);
  }
}

/** Winding path through control points (smoothed). */
export function path(b: ModelBuilder, ctrl: P2[], w: number, color: ColorLike = PATH_GRAVEL, y = 0.09, perSeg = 5, closed = false): P2[] {
  const pts = ctrl.length > 2 ? spline(ctrl, perSeg, closed) : ctrl;
  b.paint(color, Surf.Pavement);
  ribbon(b, pts, w, y, { closed });
  return pts;
}

/** Pond: organic water surface with a pebble rim, optional reeds. Returns the water polygon. */
export function pond(b: ModelBuilder, rng: RNG, cx: number, cz: number, rx: number, rz: number, opts: { n?: number; rim?: ColorLike; water?: ColorLike; rimW?: number; reeds?: number; rot?: number; y?: number; rimSides?: boolean } = {}): P2[] {
  const n = opts.n ?? 18;
  const poly = blobPoly(rng, cx, cz, rx, rz, n, 0.22, opts.rot ?? 0);
  const y = opts.y ?? 0;
  b.paint(opts.water ?? POND_WATER, Surf.Water);
  flatPoly(b, poly, y + 0.1);
  b.paint(opts.rim ?? STONE_RIM, Surf.Stone);
  ribbon(b, poly, opts.rimW ?? 0.8, y + 0.2, { closed: true, sides: opts.rimSides ?? true, y0: y + 0.02 });
  const reeds = opts.reeds ?? 0;
  for (let i = 0; i < reeds; i++) {
    const k = rng.int(0, n - 1);
    const [px, pz] = poly[k];
    const dx = px - cx, dz = pz - cz, l = Math.hypot(dx, dz) || 1;
    const x = px - (dx / l) * 0.5, z = pz - (dz / l) * 0.5;
    b.paint(rng.pick([0x5d7a36, 0x6f8a3c, 0x4f6b2e]), Surf.Foliage).cone(x, z, 0.05, rng.range(0.9, 1.5), 0.45, 4, false);
  }
  return poly;
}

/** Point-in-polygon test. */
export function inPoly(pts: P2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------------------------- lot bounds
/** Active lot rect used to keep tree canopies (and other clamped props) inside the lot. Set per model build. */
let BOUNDS: [number, number, number, number] | null = null;
export function setBounds(x0: number, z0: number, x1: number, z1: number): void {
  BOUNDS = [x0, z0, x1, z1];
}
export function clearBounds(): void {
  BOUNDS = null;
}
/** Clamp a point so that a disc of radius r around it stays inside the active bounds. */
export function clampIn(x: number, z: number, r: number): P2 {
  if (!BOUNDS) return [x, z];
  const [x0, z0, x1, z1] = BOUNDS;
  const cx = x1 - x0 < 2 * r ? (x0 + x1) / 2 : Math.max(x0 + r, Math.min(x1 - r, x));
  const cz = z1 - z0 < 2 * r ? (z0 + z1) / 2 : Math.max(z0 + r, Math.min(z1 - r, z));
  return [cx, cz];
}
/** Wrap builders so each build runs with the lot bounds active (trees auto-clamped inside the footprint). */
export function lotModels(defs: Record<string, ModelBuildFn>): ModelBuilders {
  const out: ModelBuilders = {};
  for (const [id, fn] of Object.entries(defs)) {
    out[id] = (b, v, rng, entry) => {
      const hx = entry.footprint[0] * 8 - 0.15, hz = entry.footprint[1] * 8 - 0.15;
      setBounds(-hx, -hz, hx, hz);
      try {
        fn(b, v, rng, entry);
      } finally {
        clearBounds();
      }
    };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- vegetation
const CANOPY_R: Record<string, number> = { oak: 3.0, maple: 2.65, round: 2.4, cherry: 2.6, birch: 1.8, poplar: 1.35, cone: 2.15, willow: 3.3, acacia: 3.6, palm: 3.2 };
export type TreeKind = 'oak' | 'round' | 'cone' | 'poplar' | 'cherry' | 'birch' | 'willow' | 'palm' | 'maple' | 'acacia';

/** Richer low-poly park tree (~30-70 tris). s=1 => ~7-9 m tall. Returns the top height. */
export function tree(b: ModelBuilder, rng: RNG, x: number, z: number, s = 1, kind: TreeKind = 'oak'): number {
  const k = s * rng.range(0.85, 1.15);
  [x, z] = clampIn(x, z, CANOPY_R[kind] * k);
  const seed = rng.next() * 10;
  const g = rng.pick(FOLIAGE);
  switch (kind) {
    case 'oak': {
      b.paint(PALETTE.trunk, Surf.Wood).cylinder(x, z, 0, 2.6 * k, 0.28 * k, 0.18 * k, 5, { top: false });
      b.paint(g, Surf.Foliage).blob(x, 4.5 * k, z, 2.5 * k, 2.0 * k, 2.4 * k, 0, 0.16, seed);
      const a = rng.range(0, TAU);
      b.paint(shade(g, 1.08), Surf.Foliage).blob(x + Math.cos(a) * 0.9 * k, 5.6 * k, z + Math.sin(a) * 0.9 * k, 1.7 * k, 1.5 * k, 1.7 * k, 0, 0.18, seed + 3);
      return 7.1 * k;
    }
    case 'maple': {
      b.paint(PALETTE.trunk, Surf.Wood).cylinder(x, z, 0, 2.4 * k, 0.24 * k, 0.16 * k, 5, { top: false });
      const c = rng.pick([0xc8642c, 0xd9912f, 0xb8452f, 0x8fa33b]);
      b.paint(c, Surf.Foliage).blob(x, 4.4 * k, z, 2.3 * k, 2.2 * k, 2.3 * k, 0, 0.14, seed);
      return 6.6 * k;
    }
    case 'round': {
      b.paint(PALETTE.trunk, Surf.Wood).cylinder(x, z, 0, 2.2 * k, 0.22 * k, 0.15 * k, 5, { top: false });
      b.paint(g, Surf.Foliage).blob(x, 3.9 * k, z, 2.1 * k, 1.9 * k, 2.1 * k, 0, 0.14, seed);
      return 5.8 * k;
    }
    case 'cherry': {
      b.paint(0x4a3528, Surf.Wood).cylinder(x, z, 0, 2.0 * k, 0.22 * k, 0.14 * k, 5, { top: false });
      b.paint(rng.pick([0xf0b3c8, 0xe89ab5, 0xf5c6d6]), Surf.Foliage).blob(x, 3.5 * k, z, 2.2 * k, 1.6 * k, 2.2 * k, 0, 0.18, seed);
      return 5.1 * k;
    }
    case 'birch': {
      b.paint(0xe4e0d4, Surf.Plain).cylinder(x, z, 0, 3.6 * k, 0.16 * k, 0.1 * k, 5, { top: false });
      b.paint(0x86a84a, Surf.Foliage).blob(x, 5.2 * k, z, 1.5 * k, 2.4 * k, 1.5 * k, 0, 0.18, seed);
      return 7.6 * k;
    }
    case 'poplar': {
      b.paint(PALETTE.trunk, Surf.Wood).cylinder(x, z, 0, 1.4 * k, 0.2 * k, 0.15 * k, 5, { top: false });
      b.paint(shade(g, 0.95), Surf.Foliage).blob(x, 5.0 * k, z, 1.2 * k, 4.2 * k, 1.2 * k, 0, 0.1, seed);
      return 9.2 * k;
    }
    case 'cone': {
      b.paint(PALETTE.trunk, Surf.Wood).cylinder(x, z, 0, 1.4 * k, 0.22 * k, 0.16 * k, 5, { top: false });
      const c = rng.pick([0x2f5a2e, 0x355f32, 0x2b5230]);
      b.paint(c, Surf.Foliage).cone(x, z, 1.0 * k, 4.8 * k, 2.1 * k, 7, false);
      b.paint(shade(c, 1.1), Surf.Foliage).cone(x, z, 3.4 * k, 4.4 * k, 1.5 * k, 7, false);
      return 7.8 * k;
    }
    case 'willow': {
      b.paint(0x55402e, Surf.Wood).cylinder(x, z, 0, 2.8 * k, 0.32 * k, 0.2 * k, 5, { top: false });
      const c = 0x8aa84a;
      b.paint(c, Surf.Foliage).blob(x, 4.3 * k, z, 2.6 * k, 1.5 * k, 2.6 * k, 0, 0.18, seed);
      // drooping curtain: flared, jagged hem
      b.paint(shade(c, 0.9), Surf.Foliage);
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
        const r0 = 2.3 * k, r1 = 3.1 * k;
        const yb = (1.1 + (i % 3) * 0.35) * k;
        const t0: V3 = [x + Math.cos(a0) * r0, 4.3 * k, z + Math.sin(a0) * r0], t1: V3 = [x + Math.cos(a1) * r0, 4.3 * k, z + Math.sin(a1) * r0];
        const b0: V3 = [x + Math.cos(a0) * r1, yb, z + Math.sin(a0) * r1], b1: V3 = [x + Math.cos(a1) * r1, yb + 0.3 * k, z + Math.sin(a1) * r1];
        b.quad2(b0, b1, t1, t0);
      }
      return 5.9 * k;
    }
    case 'acacia': {
      b.paint(0x5b4633, Surf.Wood).cylinder(x, z, 0, 3.4 * k, 0.22 * k, 0.14 * k, 5, { top: false });
      b.paint(0x7c8f3e, Surf.Foliage).blob(x, 4.0 * k, z, 3.0 * k, 0.8 * k, 2.6 * k, 0, 0.2, seed);
      return 4.8 * k;
    }
    case 'palm': {
      const lean = rng.range(-0.5, 0.5);
      b.paint(0x8a7355, Surf.Wood).beam([x, 0, z], [x + lean, 6.2 * k, z + lean * 0.5], 0.36 * k);
      const tx = x + lean, ty = 6.2 * k, tz = z + lean * 0.5;
      b.paint(0x4f8a3a, Surf.Foliage);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + seed;
        const ex = tx + Math.cos(a) * 2.6 * k, ez = tz + Math.sin(a) * 2.6 * k;
        const px = -Math.sin(a) * 0.5 * k, pz = Math.cos(a) * 0.5 * k;
        b.quad2([tx, ty + 0.2, tz], [tx + px + Math.cos(a) * 1.2 * k, ty + 0.4, tz + pz + Math.sin(a) * 1.2 * k], [ex, ty - 1.1 * k, ez], [tx - px + Math.cos(a) * 1.2 * k, ty + 0.4, tz - pz + Math.sin(a) * 1.2 * k]);
      }
      return ty + 0.5;
    }
  }
}

/** Low shrub / bush clump (20 tris). */
export function shrub(b: ModelBuilder, rng: RNG, x: number, z: number, r = 0.8, color?: ColorLike): void {
  b.paint(color ?? rng.pick(FOLIAGE), Surf.Foliage).blob(x, r * 0.55, z, r, r * 0.75, r, 0, 0.2, rng.next() * 10);
}

/** Flower bed: raised soil edge + rows of colored flower tufts. */
export function flowerBed(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, opts: { colors?: number[]; spacing?: number; border?: ColorLike | null; tuft?: number } = {}): void {
  const border = opts.border === undefined ? 0x9b9384 : opts.border;
  if (border !== null) b.paint(border, Surf.Stone).box(x0 - 0.15, 0, z0 - 0.15, x1 + 0.15, 0.22, z1 + 0.15);
  b.paint(SOIL, Surf.Plain).box(x0, 0.2, z0, x1, 0.24, z1, { nx: null, px: null, nz: null, pz: null });
  const colors = opts.colors ?? FLOWERS;
  const sp = opts.spacing ?? 0.75;
  const t = opts.tuft ?? 0.62;
  const nx = Math.max(1, Math.floor((x1 - x0) / sp)), nz = Math.max(1, Math.floor((z1 - z0) / sp));
  const stepX = (x1 - x0) / nx, stepZ = (z1 - z0) / nz;
  // rows of one color each (reads as planted bands from afar)
  for (let j = 0; j < nz; j++) {
    const c = colors[(j + Math.floor(rng.next() * 2)) % colors.length];
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * stepX + rng.range(-0.1, 0.1), z = z0 + (j + 0.5) * stepZ + rng.range(-0.1, 0.1);
      b.paint(rng.chance(0.15) ? 0x5a8a38 : c, Surf.Foliage).pyramid(x, z, t * stepX * 1.2, t * stepZ * 1.2, 0.22, rng.range(0.28, 0.45));
    }
  }
}

/** Round flower bed (circle) with concentric color rings of tufts. */
export function roundBed(b: ModelBuilder, rng: RNG, cx: number, cz: number, r: number, colors: number[] = FLOWERS): void {
  b.paint(0x9b9384, Surf.Stone);
  cylWall(b, cx, cz, 0, 0.24, r + 0.15, r + 0.15, 14);
  b.paint(SOIL, Surf.Plain);
  disc(b, cx, cz, 0.24, r + 0.15, 14);
  const rings = Math.max(1, Math.round(r / 0.7));
  for (let k = 0; k < rings; k++) {
    const rr = (k + 0.5) * (r / rings);
    const c = colors[k % colors.length];
    const n = Math.max(1, Math.round((TAU * rr) / 0.75));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + k;
      b.paint(c, Surf.Foliage).pyramid(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, 0.62, 0.62, 0.24, rng.range(0.28, 0.42));
    }
  }
  if (rng.chance(0.5)) shrub(b, rng, cx, cz, 0.6, 0x3f6d2c);
}

/** Hedge with slightly rounded look (box). */
export function hedgeBox(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h = 1.1, color: ColorLike = 0x3f6b2e): void {
  b.paint(color, Surf.Foliage).box(x0, 0, z0, x1, h, z1);
}

// ---------------------------------------------------------------------------------------------- furniture
/** Park lantern lamp post (~28 tris). style 0 = lantern, 1 = globe, 2 = modern bar */
export function lamp(b: ModelBuilder, x: number, z: number, h = 4.2, style = 0): void {
  b.paint(0x26292c, Surf.Metal);
  b.cylinder(x, z, 0, 0.35, 0.16, 0.12, 6, { top: false });
  b.cylinder(x, z, 0.35, h - 0.35, 0.07, 0.055, 5, { top: false });
  if (style === 0) {
    b.paint(LAMP_GLOW, Surf.Emissive).cylinder(x, z, h, 0.62, 0.2, 0.3, 4, { top: false });
    b.paint(0x26292c, Surf.Metal).cone(x, z, h + 0.62, 0.32, 0.38, 4, false);
  } else if (style === 1) {
    b.paint(LAMP_GLOW, Surf.Emissive).blob(x, h + 0.3, z, 0.36, 0.36, 0.36, 0, 0.0, 1);
  } else {
    b.paint(0x26292c, Surf.Metal).box(x - 0.08, h, z - 0.08, x + 0.6, h + 0.12, z + 0.08);
    b.paint(0xf4f1e6, Surf.Emissive).box(x + 0.05, h - 0.03, z - 0.07, x + 0.58, h, z + 0.07, { top: null });
  }
}

/** Bench facing +Z at rot=0 (~36 tris). */
export function parkBench(b: ModelBuilder, x: number, z: number, rot = 0, color: ColorLike = 0x8a6440): void {
  b.push().translate(x, 0, z).rotateY(rot);
  b.paint(color, Surf.Wood).box(-0.9, 0.42, -0.22, 0.9, 0.5, 0.25).box(-0.9, 0.55, -0.3, 0.9, 0.9, -0.24);
  b.paint(0x2e3033, Surf.Metal).box(-0.78, 0, -0.26, -0.68, 0.45, 0.2, { top: null }).box(0.68, 0, -0.26, 0.78, 0.45, 0.2, { top: null });
  b.pop();
}

/** Trash bin (10 tris). */
export function bin(b: ModelBuilder, x: number, z: number): void {
  b.paint(0x3b5e3a, Surf.Metal).cylinder(x, z, 0, 0.9, 0.28, 0.3, 5);
}

/** Fountain: stone basin, water, tiered center with jet. r = basin radius. tiers 1..3 (~120-220 tris). */
export function fountain(b: ModelBuilder, x: number, z: number, r: number, tiers = 2, opts: { stone?: ColorLike; water?: ColorLike; seg?: number; y?: number } = {}): number {
  const stone = opts.stone ?? 0xd8d0bf;
  const water = opts.water ?? 0x5a9fbf;
  const seg = opts.seg ?? 20;
  const y = opts.y ?? 0;
  const rimH = Math.min(0.7, 0.35 + r * 0.06);
  b.paint(stone, Surf.Stone);
  cylWall(b, x, z, y, y + rimH, r, r, seg);
  annulus(b, x, z, y + rimH, r - 0.35, r, seg);
  cylWall(b, x, z, y + rimH - 0.2, y + rimH, r - 0.35, r - 0.35, seg, true);
  b.paint(water, Surf.Water);
  disc(b, x, z, y + rimH - 0.2, r - 0.35, seg);
  // tiers
  let top = y + rimH;
  let tr = r * 0.42;
  let ty = y + rimH - 0.2;
  const s2 = Math.max(8, Math.round(seg * 0.6));
  for (let t = 0; t < tiers; t++) {
    const colH = t === 0 ? 1.1 + r * 0.12 : 0.8;
    b.paint(stone, Surf.Stone);
    lathe(b, x, z, [[0.28, ty], [0.2, ty + colH * 0.5], [0.24, ty + colH], [tr, ty + colH + 0.15], [tr, ty + colH + 0.35], [tr - 0.12, ty + colH + 0.35]], s2);
    b.paint(water, Surf.Water);
    disc(b, x, z, ty + colH + 0.3, tr - 0.12, s2);
    ty = ty + colH + 0.3;
    tr *= 0.55;
    top = ty;
  }
  // jet + falling sheet
  b.paint(0xcfe8f2, Surf.Water);
  b.cone(x, z, top, 0.9 + r * 0.08, 0.16, 6, true);
  return top + 0.9 + r * 0.08;
}

/** Bleachers: stepped rows facing +Z at rot=0 (seat rows along X), centered at (x, z) front edge. */
export function bleachers(b: ModelBuilder, x: number, z: number, w: number, rows: number, rot = 0, opts: { rise?: number; depth?: number; seat?: ColorLike; frame?: ColorLike; roof?: ColorLike | null } = {}): void {
  const rise = opts.rise ?? 0.45, depth = opts.depth ?? 0.8;
  b.push().translate(x, 0, z).rotateY(rot);
  const seat = opts.seat ?? 0x2d6fb5, frame = opts.frame ?? 0x8e8b84;
  for (let r = 0; r < rows; r++) {
    const z1 = -r * depth, z0 = -rows * depth;
    b.paint(frame, Surf.Pavement).box(-w / 2, 0, z0, w / 2, (r + 1) * rise, z1, { top: { color: seat, surf: Surf.Plain }, nx: null, px: null, nz: null });
  }
  // side walls as single panels
  b.paint(frame, Surf.Pavement);
  const zb = -rows * depth;
  for (const sx of [-w / 2, w / 2]) {
    // polygon in the YZ plane: (0,0) -> steps -> back bottom
    const poly: P2[] = [[0, 0]];
    for (let r = 0; r < rows; r++) poly.push([-r * depth, (r + 1) * rise], [-(r + 1) * depth, (r + 1) * rise]);
    poly.push([zb, 0]);
    const contour = poly.map(([zz, yy]) => new THREE.Vector2(zz, yy));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [i, j, k] of tris) orientTri(b, [sx, poly[i][1], poly[i][0]], [sx, poly[j][1], poly[j][0]], [sx, poly[k][1], poly[k][0]], [Math.sign(sx), 0, 0]);
  }
  b.paint(frame, Surf.Pavement).box(-w / 2, 0, zb - 0.01, w / 2, rows * rise + 1.0, zb + 0.15, { bottom: null });
  if (opts.roof) {
    const hTop = rows * rise + 3.2;
    b.paint(0x5a5f66, Surf.Metal);
    for (let i = 0; i <= 3; i++) {
      const px = -w / 2 + 0.3 + (i * (w - 0.6)) / 3;
      b.box(px - 0.1, rows * rise, zb + 0.05, px + 0.1, hTop, zb + 0.25, { top: null });
    }
    b.paint(opts.roof, Surf.Metal).box(-w / 2 - 0.2, hTop, zb - 0.2, w / 2 + 0.2, hTop + 0.25, zb + rows * depth * 0.9);
  }
  b.pop();
}

/** Floodlight mast aimed at (tx, tz): pole + emissive light bank (~40 tris). */
export function floodMast(b: ModelBuilder, x: number, z: number, h: number, tx: number, tz: number, opts: { bank?: number; lattice?: boolean } = {}): void {
  const bank = opts.bank ?? Math.max(1.2, h * 0.08);
  b.paint(0x8a9096, Surf.Metal);
  if (opts.lattice) {
    const s0 = h * 0.035, s1 = h * 0.015;
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.beam([x + dx * s0, 0, z + dz * s0], [x + dx * s1, h, z + dz * s1], 0.18);
    for (let k = 1; k < 5; k++) {
      const y = (h * k) / 5, s = s0 + (s1 - s0) * (k / 5);
      b.box(x - s, y - 0.1, z - s, x + s, y + 0.1, z + s, { top: null, bottom: null });
    }
  } else {
    b.cylinder(x, z, 0, h, Math.max(0.18, h * 0.012), Math.max(0.1, h * 0.006), 6, { top: false });
  }
  const a = Math.atan2(tx - x, tz - z);
  b.push().translate(x, h, z).rotateY(a).rotateX(0.35);
  b.paint(0x3a3e44, Surf.Metal).box(-bank / 2 - 0.1, -bank * 0.35 - 0.1, -0.35, bank / 2 + 0.1, bank * 0.35 + 0.1, 0.0);
  b.paint(0xf6f8ff, Surf.Emissive).box(-bank / 2, -bank * 0.35, 0.0, bank / 2, bank * 0.35, 0.06, { nx: null, px: null, top: null, bottom: null, nz: null });
  b.pop();
}

/** Chain-link style fence: posts + top/mid rail (see-through). */
export function railFence(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, h = 3, spacing = 3, color: ColorLike = 0x6f767c, rails = 2): void {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / spacing));
  b.paint(color, Surf.Metal);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    b.box(x - 0.05, 0, z - 0.05, x + 0.05, h, z + 0.05, { bottom: null });
  }
  for (let r = 0; r < rails; r++) {
    const y = h - (r * h) / rails - 0.05;
    b.beam([ax, y, az], [bx, y, bz], 0.06);
  }
}

/** Solid (windscreen / mesh) fence panel between two points — double sided. */
export function panelFence(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, color: ColorLike, surf = Surf.Plain): void {
  b.paint(color, surf).quad2([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]);
}

/** Small football goal with frame + suggestion of netting. Opening faces +Z at rot = 0. */
export function goal(b: ModelBuilder, x: number, z: number, rot: number, w = 5, h = 2): void {
  b.push().translate(x, 0, z).rotateY(rot);
  b.paint(0xf4f4f4, Surf.Metal);
  const t = 0.12;
  b.box(-w / 2 - t, 0, -t / 2, -w / 2, h, t / 2, { bottom: null });
  b.box(w / 2, 0, -t / 2, w / 2 + t, h, t / 2, { bottom: null });
  b.box(-w / 2 - t, h, -t / 2, w / 2 + t, h + t, t / 2);
  // net (light, slightly transparent-looking grey)
  b.paint(0xdfe3e6, Surf.Plain);
  const dd = h * 0.6;
  b.quad2([-w / 2, h, 0], [w / 2, h, 0], [w / 2, 0, -dd], [-w / 2, 0, -dd]);
  b.tri([-w / 2, 0, 0], [-w / 2, h, 0], [-w / 2, 0, -dd]).tri([-w / 2, 0, 0], [-w / 2, 0, -dd], [-w / 2, h, 0]);
  b.tri([w / 2, 0, 0], [w / 2, 0, -dd], [w / 2, h, 0]).tri([w / 2, 0, 0], [w / 2, h, 0], [w / 2, 0, -dd]);
  b.pop();
}

/** Tiny person (~22 tris): legs + torso + head. For charm, sparingly. */
export function person(b: ModelBuilder, rng: RNG, x: number, z: number, y = 0, rot = 0): void {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(rng.pick([0x2b3440, 0x3d3a36, 0x4a5a70, 0x6b5a48]), Surf.Plain).box(-0.17, 0, -0.1, 0.17, 0.85, 0.1, { bottom: null, top: null });
  b.paint(rng.pick([0xc0392b, 0x2e6fb5, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x8e44ad, 0xe67e22]), Surf.Plain).box(-0.21, 0.85, -0.12, 0.21, 1.45, 0.12, { bottom: null });
  b.paint(rng.pick([0xe0b89a, 0xc69070, 0x8d5a3b, 0xf0d0b5]), Surf.Plain).box(-0.1, 1.47, -0.1, 0.1, 1.72, 0.1, { bottom: null });
  b.pop();
}

/** Shade a color (multiply brightness). */
export function shade(c: ColorLike, k: number): number {
  const col = new THREE.Color();
  if (typeof c === 'number' || typeof c === 'string') col.set(c as any);
  else if (Array.isArray(c)) col.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  else col.copy(c);
  col.r = Math.min(1, col.r * k);
  col.g = Math.min(1, col.g * k);
  col.b = Math.min(1, col.b * k);
  return col.getHex();
}

/** Umbrella (market / cafe) (~20 tris). */
export function umbrella(b: ModelBuilder, x: number, z: number, color: ColorLike, r = 1.4, h = 2.4): void {
  b.paint(0xdedede, Surf.Metal).cylinder(x, z, 0, h, 0.04, 0.04, 4, { top: false });
  b.paint(color, Surf.Plain).cone(x, z, h - 0.35, 0.55, r, 8, false);
}

/** Small colored pavilion tent / kiosk with a striped conical roof. */
export function stripedCone(b: ModelBuilder, x: number, z: number, y0: number, h: number, r: number, seg: number, c1: ColorLike, c2: ColorLike): void {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
    b.paint(i % 2 ? c1 : c2, Surf.Plain);
    const p0: V3 = [x + Math.cos(a0) * r, y0, z + Math.sin(a0) * r], p1: V3 = [x + Math.cos(a1) * r, y0, z + Math.sin(a1) * r];
    const top: V3 = [x, y0 + h, z];
    const am = (a0 + a1) / 2, sl = r / h;
    const nn = nrm([Math.cos(am), sl, Math.sin(am)]);
    b.triN(p0, top, p1, nrm([Math.cos(a0), sl, Math.sin(a0)]), nn, nrm([Math.cos(a1), sl, Math.sin(a1)]));
  }
}

/** Striped cylinder wall (tent sides, carousel). */
export function stripedWall(b: ModelBuilder, x: number, z: number, y0: number, y1: number, r: number, seg: number, c1: ColorLike, c2: ColorLike): void {
  for (let i = 0; i < seg; i++) {
    b.paint(i % 2 ? c1 : c2, Surf.Plain);
    cylWall(b, x, z, y0, y1, r, r, 1, false, (i / seg) * TAU, ((i + 1) / seg) * TAU);
  }
}
