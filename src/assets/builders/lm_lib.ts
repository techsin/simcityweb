/**
 * Helpers for landmark builders (park/landmark asset agent): vertical polygons (facades with openings),
 * gothic / round arch outlines, facade frames, prisms with per-edge paint, crenellations, parametric shells.
 */
import * as THREE from 'three';
import { ModelBuilder, type ColorLike, type Paint } from '../ModelBuilder';
import { Surf } from '../../core/types';
import { type P2, type V3, orientTri, orientQuad, nrm, cross, dot } from './park_lib';

const TAU = Math.PI * 2;

/**
 * Flat polygon (optionally with holes) given in 2D (u, v), mapped to 3D by `map`, facing `normal`.
 */
export function planePoly(b: ModelBuilder, outer: P2[], holes: P2[][], map: (u: number, v: number) => V3, normal: V3): void {
  const contour = outer.map(([u, v]) => new THREE.Vector2(u, v));
  const hs = holes.map((h) => h.map(([u, v]) => new THREE.Vector2(u, v)));
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  const all = [...outer, ...holes.flat()];
  for (const [i, j, k] of tris) orientTri(b, map(all[i][0], all[i][1]), map(all[j][0], all[j][1]), map(all[k][0], all[k][1]), normal);
}

/** Polygon in the XY plane at depth z facing +Z (dir=1) or -Z (dir=-1). */
export function polyZ(b: ModelBuilder, pts: P2[], z: number, dir: 1 | -1 = 1, holes: P2[][] = []): void {
  planePoly(b, pts, holes, (x, y) => [x, y, z], [0, 0, dir]);
}
/** Polygon in the ZY plane (u = z, v = y) at x facing +X (dir=1) or -X. */
export function polyX(b: ModelBuilder, pts: P2[], x: number, dir: 1 | -1 = 1, holes: P2[][] = []): void {
  planePoly(b, pts, holes, (z, y) => [x, y, z], [dir, 0, 0]);
}

/** Pointed gothic arch outline, width w, spring height hs (sharp=1: equilateral; 0.5: round). Left foot -> right foot. */
export function gothicArch(cx: number, w: number, hs: number, seg = 5, y0 = 0, sharp = 1): P2[] {
  const r = w * Math.max(0.5, sharp);
  const aA = Math.acos((w / 2 - r) / r);
  const left: P2[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI - (i / seg) * (Math.PI - aA);
    left.push([cx - w / 2 + r + Math.cos(a) * r, hs + Math.sin(a) * r]);
  }
  const right = left.slice(0, -1).reverse().map(([x, y]) => [2 * cx - x, y] as P2);
  return [[cx - w / 2, y0], ...left, ...right, [cx + w / 2, y0]];
}

/** Round (semicircular) arch outline from left foot to right foot. */
export function roundArch(cx: number, w: number, hs: number, seg = 8, y0 = 0): P2[] {
  const out: P2[] = [[cx - w / 2, y0]];
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI - (i / seg) * Math.PI;
    out.push([cx + Math.cos(a) * (w / 2), hs + Math.sin(a) * (w / 2)]);
  }
  out.push([cx + w / 2, y0]);
  return out;
}

/** Dark recessed opening (door / window / louvre) on a +Z / -Z facade: shape drawn slightly proud of the wall. */
export function openingZ(b: ModelBuilder, shape: P2[], z: number, dir: 1 | -1, color: ColorLike = 0x2a2622, surf = Surf.Plain): void {
  b.paint(color, surf);
  polyZ(b, shape, z + dir * 0.03, dir);
}
export function openingX(b: ModelBuilder, shape: P2[], x: number, dir: 1 | -1, color: ColorLike = 0x2a2622, surf = Surf.Plain): void {
  b.paint(color, surf);
  polyX(b, shape, x + dir * 0.03, dir);
}

/** Arch frame (archivolt) around an arch outline: ring between the outline and its outward offset, protruding `depth`. */
export function archFrameZ(b: ModelBuilder, shape: P2[], z: number, dir: 1 | -1, t: number, depth: number, paint: Paint): void {
  const n = shape.length;
  const cx = (shape[0][0] + shape[n - 1][0]) / 2;
  const top = Math.max(...shape.map((p) => p[1]));
  const ic: P2 = [cx, shape[0][1] + (top - shape[0][1]) * 0.4];
  const nrmAt = (i: number): P2 => {
    const a = shape[Math.max(0, i - 1)], c = shape[Math.min(n - 1, i + 1)];
    let nx = c[1] - a[1], ny = -(c[0] - a[0]);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    if (nx * (shape[i][0] - ic[0]) + ny * (shape[i][1] - ic[1]) < 0) { nx = -nx; ny = -ny; }
    return [nx, ny];
  };
  const outer = shape.map((p, i) => {
    const q = nrmAt(i);
    return [p[0] + q[0] * t, p[1] + q[1] * t] as P2;
  });
  outer[0][1] = shape[0][1];
  outer[n - 1][1] = shape[n - 1][1];
  b.paint(paint);
  const zf = z + dir * depth;
  for (let i = 0; i < n - 1; i++) {
    const a = shape[i], c = shape[i + 1], oa = outer[i], oc = outer[i + 1];
    orientQuad(b, [a[0], a[1], zf], [c[0], c[1], zf], [oc[0], oc[1], zf], [oa[0], oa[1], zf], [0, 0, dir]);
    const sx = oc[1] - oa[1], sy = -(oc[0] - oa[0]);
    const mx = (oa[0] + oc[0]) / 2 - ic[0], my = (oa[1] + oc[1]) / 2 - ic[1];
    const sg = sx * mx + sy * my >= 0 ? 1 : -1;
    orientQuad(b, [oa[0], oa[1], z], [oc[0], oc[1], z], [oc[0], oc[1], zf], [oa[0], oa[1], zf], [sx * sg, sy * sg, 0]);
    orientQuad(b, [a[0], a[1], z], [c[0], c[1], z], [c[0], c[1], zf], [a[0], a[1], zf], [-sx * sg, -sy * sg, 0]);
  }
}

/** Prism from a plan polygon with per-edge paint (edge i from pts[i] to pts[i+1]); top cap with `top` paint (null = none). */
export function prismEdges(b: ModelBuilder, pts: P2[], y0: number, y1: number, edgePaint: (i: number) => Paint, top: Paint | null): void {
  const n = pts.length;
  // orientation: we want outward normals. compute signed area in (x, z)
  let area = 0;
  for (let i = 0; i < n; i++) area += pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1];
  const cx = pts.reduce((s, p) => s + p[0], 0) / n, cz = pts.reduce((s, p) => s + p[1], 0) / n;
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    b.paint(edgePaint(i));
    const mx = (a[0] + c[0]) / 2 - cx, mz = (a[1] + c[1]) / 2 - cz;
    orientQuad(b, [a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]], [mx, 0, mz]);
  }
  void area;
  if (top) {
    b.paint(top);
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [i, j, k] of tris) orientTri(b, [pts[i][0], y1, pts[i][1]], [pts[j][0], y1, pts[j][1]], [pts[k][0], y1, pts[k][1]], [0, 1, 0]);
  }
}

/** Crenellations (merlons) along a straight wall top from a to c at height y. */
export function merlons(b: ModelBuilder, ax: number, az: number, cx: number, cz: number, y: number, t: number, opts: { w?: number; h?: number; gap?: number } = {}): void {
  const w = opts.w ?? 0.9, h = opts.h ?? 1.1, gap = opts.gap ?? 0.8;
  const dx = cx - ax, dz = cz - az;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.floor((len + gap) / (w + gap)));
  const used = n * w + (n - 1) * gap;
  const start = (len - used) / 2;
  b.push().translate(ax, y, az).rotateY(Math.atan2(dx, dz));
  for (let i = 0; i < n; i++) {
    const z0 = start + i * (w + gap);
    b.box(-t / 2, 0, z0, t / 2, h, z0 + w, { bottom: null });
  }
  b.pop();
}

/** Merlons around a circle (tower top). */
export function merlonRing(b: ModelBuilder, cx: number, cz: number, r: number, y: number, n: number, t = 0.5, h = 1.1): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    b.push().translate(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r).rotateY(-a);
    const w = ((TAU * r) / n) * 0.5;
    b.box(-t / 2, 0, -w / 2, t / 2, h, w / 2, { bottom: null });
    b.pop();
  }
}

/**
 * Parametric surface patch with smooth normals. f(u, v) -> point for u in [0,1] (nu steps), v in [0,1] (nv steps).
 * `inside` is a point inside the solid used to orient normals outward. twoSided emits back faces too.
 */
export function surface(b: ModelBuilder, f: (u: number, v: number) => V3, nu: number, nv: number, inside: V3, twoSided = false): void {
  const P: V3[][] = [];
  const N: V3[][] = [];
  const eps = 1e-3;
  for (let i = 0; i <= nu; i++) {
    P.push([]);
    N.push([]);
    for (let j = 0; j <= nv; j++) {
      const u = i / nu, v = j / nv;
      const p = f(u, v);
      const du = f(Math.min(1, u + eps), v), du0 = f(Math.max(0, u - eps), v);
      const dv = f(u, Math.min(1, v + eps)), dv0 = f(u, Math.max(0, v - eps));
      const tu: V3 = [du[0] - du0[0], du[1] - du0[1], du[2] - du0[2]];
      const tv: V3 = [dv[0] - dv0[0], dv[1] - dv0[1], dv[2] - dv0[2]];
      let n = nrm(cross(tu, tv));
      if (!isFinite(n[0]) || Math.hypot(n[0], n[1], n[2]) < 0.5) n = nrm([p[0] - inside[0], p[1] - inside[1], p[2] - inside[2]]);
      if (dot(n, [p[0] - inside[0], p[1] - inside[1], p[2] - inside[2]]) < 0) n = [-n[0], -n[1], -n[2]];
      P[i].push(p);
      N[i].push(n);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = P[i][j], c = P[i + 1][j], d = P[i + 1][j + 1], e = P[i][j + 1];
      const na = N[i][j], nc = N[i + 1][j], nd = N[i + 1][j + 1], ne = N[i][j + 1];
      emitOriented(b, a, c, d, na, nc, nd);
      emitOriented(b, a, d, e, na, nd, ne);
      if (twoSided) {
        emitOriented(b, a, c, d, neg(na), neg(nc), neg(nd));
        emitOriented(b, a, d, e, neg(na), neg(nd), neg(ne));
      }
    }
  }
}
function neg(v: V3): V3 {
  return [-v[0], -v[1], -v[2]];
}
/** triangle with smooth normals; winding chosen to agree with the average normal. Skips degenerate triangles. */
function emitOriented(b: ModelBuilder, a: V3, c: V3, d: V3, na: V3, nc: V3, nd: V3): void {
  const u: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], v: V3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const fn = cross(u, v);
  if (Math.hypot(fn[0], fn[1], fn[2]) < 1e-8) return;
  const avg: V3 = [na[0] + nc[0] + nd[0], na[1] + nc[1] + nd[1], na[2] + nc[2] + nd[2]];
  if (dot(fn, avg) >= 0) b.triN(a, c, d, na, nc, nd);
  else b.triN(a, d, c, na, nd, nc);
}

/** Aviation obstruction light (small red emissive box). */
export function beacon(b: ModelBuilder, x: number, y: number, z: number, s = 0.5, color: ColorLike = 0xff2a1a): void {
  b.paint(color, Surf.Emissive).box(x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2);
}
