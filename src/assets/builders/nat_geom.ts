/**
 * Low-level geometry helpers shared by the nature / vehicle / prop builders (owned by the nature-vehicle-prop asset agent).
 * Everything draws INTO a ModelBuilder using only its public API (tri / triN / paint / raw).
 *
 * Highlights:
 *  - leafBlob(): jittered icosphere whose normals are blended toward a crown center => soft, volumetric foliage
 *    shading at 20 tris per blob (detail 0).
 *  - tier(): jagged, drooping conifer cone tier (2n tris) with a darker concave underside.
 *  - limb(): tapered tube along a polyline (trunks, branches, palm trunks, cactus arms).
 *  - lathe(): revolved profile (cypress spindles, fountain bowls, tanks).
 *  - tintSince(): per-vertex color modulation (height AO / sun-kissed tops) applied to everything emitted after a mark.
 */
import * as THREE from 'three';
import { ModelBuilder, type ColorLike } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';

export type V3 = [number, number, number];

// ------------------------------------------------------------------ vector math
export const vadd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vscale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const vdot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vlen = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const vnorm = (a: V3): V3 => {
  const l = vlen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const vlerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const vmix = (a: V3, b: V3, t: number): V3 => vnorm(vlerp(a, b, t));

/** Flat triangle, winding auto-corrected so its normal points along `out`. */
export function triOut(b: ModelBuilder, p0: V3, p1: V3, p2: V3, out: V3): void {
  const n = vcross(vsub(p1, p0), vsub(p2, p0));
  if (vdot(n, out) >= 0) b.tri(p0, p1, p2);
  else b.tri(p0, p2, p1);
}
/** Flat quad (p0..p3 in order around the perimeter), winding auto-corrected toward `out`. */
export function quadOut(b: ModelBuilder, p0: V3, p1: V3, p2: V3, p3: V3, out: V3): void {
  triOut(b, p0, p1, p2, out);
  triOut(b, p0, p2, p3, out);
}
/** Smooth triangle with per-vertex normals; winding auto-corrected toward the geometric outside `out`. */
export function triOutN(b: ModelBuilder, p0: V3, p1: V3, p2: V3, n0: V3, n1: V3, n2: V3, out: V3): void {
  const n = vcross(vsub(p1, p0), vsub(p2, p0));
  if (vdot(n, out) >= 0) b.triN(p0, p1, p2, n0, n1, n2);
  else b.triN(p0, p2, p1, n0, n2, n1);
}

// ------------------------------------------------------------------ per-vertex tint
/** Number of vertices emitted so far (use as a mark for tintSince). */
export function mark(b: ModelBuilder): number {
  return b.triangleCount * 3;
}
/**
 * Multiply the vertex colors of everything emitted since `start` by fn(pos, normal) -> [r,g,b] multiplier (linear).
 * Uses ModelBuilder.raw() which exposes the live attribute arrays.
 */
export function tintSince(b: ModelBuilder, start: number, fn: (p: V3, n: V3) => V3): void {
  const r = b.raw();
  const count = r.pos.length / 3;
  for (let i = start; i < count; i++) {
    const k = fn([r.pos[i * 3], r.pos[i * 3 + 1], r.pos[i * 3 + 2]], [r.nrm[i * 3], r.nrm[i * 3 + 1], r.nrm[i * 3 + 2]]);
    r.col[i * 3] *= k[0];
    r.col[i * 3 + 1] *= k[1];
    r.col[i * 3 + 2] *= k[2];
  }
}

/** Standard foliage gradient: darker & cooler at the bottom of [y0,y1], slightly warm/bright at the top, darker undersides. */
export function foliageShade(y0: number, y1: number, strength = 1, warmTop = 1): (p: V3, n: V3) => V3 {
  return (p, n) => {
    const t = Math.min(1, Math.max(0, (p[1] - y0) / Math.max(0.01, y1 - y0)));
    const under = n[1] < 0 ? -n[1] : 0;
    const k = 1 - strength * (0.36 * (1 - t) + 0.2 * under) + strength * 0.1 * t;
    return [k * (1 + 0.05 * t * warmTop), k * (1 + 0.02 * t * warmTop), k * (1 - 0.06 * t * warmTop + 0.05 * (1 - t))];
  };
}

// ------------------------------------------------------------------ colors
const _col = new THREE.Color();
/** Mix two sRGB hex colors; returns sRGB hex. */
export function mixHex(a: number, c: number, t: number): number {
  const ca = new THREE.Color(a), cb = new THREE.Color(c);
  return ca.lerp(cb, t).getHex();
}
/** Scale brightness of an sRGB hex color (in linear space). */
export function shadeHex(a: number, k: number): number {
  _col.set(a);
  _col.r = Math.min(1, _col.r * k);
  _col.g = Math.min(1, _col.g * k);
  _col.b = Math.min(1, _col.b * k);
  return _col.getHex();
}
/** Slight random hue/brightness jitter of an sRGB hex color. */
export function jitterHex(rng: RNG, a: number, amt = 0.08): number {
  _col.set(a);
  const hsl = { h: 0, s: 0, l: 0 };
  _col.getHSL(hsl);
  _col.setHSL((hsl.h + rng.range(-amt, amt) * 0.15 + 1) % 1, Math.min(1, Math.max(0, hsl.s * (1 + rng.range(-amt, amt)))), Math.min(1, Math.max(0, hsl.l * (1 + rng.range(-amt, amt)))));
  return _col.getHex();
}

// ------------------------------------------------------------------ icosphere
interface Ico {
  verts: V3[];
  faces: [number, number, number][];
}
const icoCache = new Map<number, Ico>();
export function icosphere(detail: number): Ico {
  let ico = icoCache.get(detail);
  if (ico) return ico;
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const map = new Map<string, number>();
  const verts: V3[] = [];
  const idx: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = verts.length;
      verts.push([x, y, z]);
      map.set(key, k);
    }
    idx.push(k);
  }
  const faces: [number, number, number][] = [];
  for (let i = 0; i < idx.length; i += 3) faces.push([idx[i], idx[i + 1], idx[i + 2]]);
  geo.dispose();
  ico = { verts, faces };
  icoCache.set(detail, ico);
  return ico;
}

export interface BlobOpts {
  /** 0 = 20 tris, 1 = 80 tris */
  detail?: number;
  /** radial jitter fraction (0..0.5) */
  jitter?: number;
  /** 0 = faceted, 1 = fully smooth (normals from `nc`) */
  soft?: number;
  /** center used for smooth normals (crown center). Default: blob center */
  nc?: V3;
  /** rotation around Y */
  rotY?: number;
  /** tilt around X (radians) for less regular facets */
  tilt?: number;
  /** squash everything below this y toward it (flat rock bottoms) */
  floorY?: number;
  /** optional per-face color override (return null for the current paint) */
  faceColor?: (faceIndex: number, centroid: V3, normal: V3) => ColorLike | null;
  surf?: Surf;
}

/** Jittered icosphere blob with soft normals. Uses the current paint unless faceColor overrides. */
export function leafBlob(b: ModelBuilder, rng: RNG, c: V3, r: V3, o: BlobOpts = {}): void {
  const ico = icosphere(o.detail ?? 0);
  const jit = o.jitter ?? 0.15;
  const soft = o.soft ?? 0.6;
  const nc = o.nc ?? c;
  const ry = o.rotY ?? rng.range(0, Math.PI * 2);
  const tilt = o.tilt ?? rng.range(-0.4, 0.4);
  const cy = Math.cos(ry), sy = Math.sin(ry), ct = Math.cos(tilt), st = Math.sin(tilt);
  const pts: V3[] = ico.verts.map(([x, y, z]) => {
    // tilt around X then rotate around Y
    const y1 = y * ct - z * st, z1 = y * st + z * ct;
    const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
    const j = 1 + rng.range(-jit, jit);
    const p: V3 = [c[0] + x2 * r[0] * j, c[1] + y1 * r[1] * j, c[2] + z2 * r[2] * j];
    if (o.floorY !== undefined && p[1] < o.floorY) p[1] = o.floorY + (p[1] - o.floorY) * 0.12;
    return p;
  });
  const vn: V3[] = pts.map((p) => vnorm([(p[0] - nc[0]) / (r[0] * r[0]), (p[1] - nc[1]) / (r[1] * r[1]), (p[2] - nc[2]) / (r[2] * r[2])]));
  const base = b.getPaint();
  ico.faces.forEach(([ia, ib, ic], fi) => {
    const a = pts[ia], bb = pts[ib], cc = pts[ic];
    const fnrm = vnorm(vcross(vsub(bb, a), vsub(cc, a)));
    if (o.faceColor) {
      const cen: V3 = [(a[0] + bb[0] + cc[0]) / 3, (a[1] + bb[1] + cc[1]) / 3, (a[2] + bb[2] + cc[2]) / 3];
      const fc = o.faceColor(fi, cen, fnrm);
      if (fc !== null) b.paint(fc, o.surf ?? base.surf);
      else b.paint(base);
    }
    const na = vmix(fnrm, vn[ia], soft), nb = vmix(fnrm, vn[ib], soft), ncc = vmix(fnrm, vn[ic], soft);
    b.triN(a, bb, cc, na, nb, ncc);
  });
  b.paint(base);
}

// ------------------------------------------------------------------ tubes
/** Orthonormal frame perpendicular to t. */
function frame(t: V3): [V3, V3] {
  const ref: V3 = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = vnorm(vcross(ref, t));
  const w = vcross(t, u);
  return [u, w];
}

export interface LimbOpts {
  /** radial segments */
  seg?: number;
  /** smooth normals (default true) */
  smooth?: boolean;
  /** cap the far end (fan), default false */
  cap?: boolean;
  /** cap the start, default false */
  capStart?: boolean;
  /** called before each segment i is emitted (e.g. to alternate paint) */
  segPaint?: (i: number) => void;
  /** rotation of the ring (radians) */
  rot?: number;
  /** squash ring along the frame's second axis */
  flat?: number;
}
/** Tapered tube along a polyline path with radii per point. Emits (n-1)*seg*2 tris (+caps). */
export function limb(b: ModelBuilder, path: V3[], radii: number[], o: LimbOpts = {}): void {
  const seg = o.seg ?? 5;
  const smooth = o.smooth ?? true;
  const rot = o.rot ?? 0;
  const n = path.length;
  const rings: V3[][] = [];
  const dirs: V3[][] = [];
  for (let i = 0; i < n; i++) {
    const tIn = i > 0 ? vnorm(vsub(path[i], path[i - 1])) : null;
    const tOut = i < n - 1 ? vnorm(vsub(path[i + 1], path[i])) : null;
    const t = tIn && tOut ? vnorm(vadd(tIn, tOut)) : (tIn ?? tOut)!;
    const [u, w] = frame(t);
    const ring: V3[] = [], dr: V3[] = [];
    for (let k = 0; k < seg; k++) {
      const a = rot + (k / seg) * Math.PI * 2;
      const d = vadd(vscale(u, Math.cos(a)), vscale(w, Math.sin(a) * (o.flat ?? 1)));
      dr.push(vnorm(d));
      ring.push(vadd(path[i], vscale(d, radii[i])));
    }
    rings.push(ring);
    dirs.push(dr);
  }
  for (let i = 0; i < n - 1; i++) {
    o.segPaint?.(i);
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      const a = rings[i][k], bq = rings[i][k1], c = rings[i + 1][k1], d = rings[i + 1][k];
      const out = vnorm(vadd(dirs[i][k], dirs[i][k1]));
      if (smooth) {
        triOutN(b, a, bq, c, dirs[i][k], dirs[i][k1], dirs[i + 1][k1], out);
        triOutN(b, a, c, d, dirs[i][k], dirs[i + 1][k1], dirs[i + 1][k], out);
      } else quadOut(b, a, bq, c, d, out);
    }
  }
  const fan = (ring: V3[], out: V3) => {
    for (let k = 1; k < seg - 1; k++) triOut(b, ring[0], ring[k], ring[k + 1], out);
  };
  if (o.cap) fan(rings[n - 1], vnorm(vsub(path[n - 1], path[n - 2])));
  if (o.capStart) fan(rings[0], vnorm(vsub(path[0], path[1])));
}

/**
 * Revolve a profile [(r, y)...] (bottom to top) around the Y axis at (cx, cz). seg sides.
 * Points with r = 0 become poles (1 tri per side). Jitter randomizes ring radii per vertex.
 */
export function lathe(
  b: ModelBuilder,
  cx: number,
  cz: number,
  profile: [number, number][],
  seg: number,
  o: { smooth?: boolean; jitter?: number; rng?: RNG; twist?: number; sx?: number; sz?: number; ringPaint?: (i: number) => void } = {},
): void {
  const smooth = o.smooth ?? true;
  const twist = o.twist ?? 0;
  const sx = o.sx ?? 1, sz = o.sz ?? 1;
  const rings: V3[][] = profile.map(([r, y], i) =>
    Array.from({ length: seg }, (_, k) => {
      const a = (k / seg) * Math.PI * 2 + twist * i;
      const j = o.jitter && o.rng && r > 0 ? 1 + o.rng.range(-o.jitter, o.jitter) : 1;
      return [cx + Math.cos(a) * r * j * sx, y, cz + Math.sin(a) * r * j * sz] as V3;
    }),
  );
  // normals: from profile slope
  const nrm = (i: number, k: number): V3 => {
    const i0 = Math.max(0, i - 1), i1 = Math.min(profile.length - 1, i + 1);
    const dr = profile[i1][0] - profile[i0][0], dy = profile[i1][1] - profile[i0][1];
    const a = (k / seg) * Math.PI * 2 + twist * i;
    // outward radial (cos, sin) with slope: normal = (dy * radial, -dr)
    return vnorm([Math.cos(a) * dy, -dr, Math.sin(a) * dy]);
  };
  for (let i = 0; i < profile.length - 1; i++) {
    o.ringPaint?.(i);
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      const a = rings[i][k], bq = rings[i][k1], c = rings[i + 1][k1], d = rings[i + 1][k];
      const am = ((k + 0.5) / seg) * Math.PI * 2 + twist * (i + 0.5);
      const dr = profile[i + 1][0] - profile[i][0], dy = profile[i + 1][1] - profile[i][1];
      const out = vnorm([Math.cos(am) * dy, -dr, Math.sin(am) * dy]);
      const r0 = profile[i][0], r1 = profile[i + 1][0];
      if (smooth) {
        if (r0 > 1e-4 && r1 > 1e-4) {
          triOutN(b, a, bq, c, nrm(i, k), nrm(i, k1), nrm(i + 1, k1), out);
          triOutN(b, a, c, d, nrm(i, k), nrm(i + 1, k1), nrm(i + 1, k), out);
        } else if (r1 <= 1e-4) triOutN(b, a, bq, c, nrm(i, k), nrm(i, k1), nrm(i + 1, k1), out);
        else triOutN(b, a, c, d, nrm(i, k), nrm(i + 1, k1), nrm(i + 1, k), out);
      } else {
        if (r0 > 1e-4 && r1 > 1e-4) quadOut(b, a, bq, c, d, out);
        else if (r1 <= 1e-4) triOut(b, a, bq, c, out);
        else triOut(b, a, c, d, out);
      }
    }
  }
}

/** Filled convex polygon (fan) facing `out`. */
export function polyOut(b: ModelBuilder, pts: V3[], out: V3): void {
  for (let k = 1; k < pts.length - 1; k++) triOut(b, pts[0], pts[k], pts[k + 1], out);
}

// ------------------------------------------------------------------ conifer tier
export interface TierOpts {
  /** rim vertex count (even numbers give alternating long/short branches) */
  n?: number;
  /** how far rim tips hang below the tier base (m) */
  droop?: number;
  /** inner/short branch radius factor */
  jag?: number;
  /** color of the underside */
  under?: ColorLike;
  /** normal softness */
  soft?: number;
  rot?: number;
  /** horizontal offset of the apex (bend) */
  lean?: [number, number];
  /** skip the underside (e.g. the lowest tier touching nothing) */
  noUnder?: boolean;
}
/** Conifer foliage tier: jagged drooping cone (apex at y0 + h) with concave underside. 2n tris. */
export function tier(b: ModelBuilder, rng: RNG, cx: number, cz: number, y0: number, h: number, r: number, o: TierOpts = {}): void {
  const n = o.n ?? 8;
  const droop = o.droop ?? r * 0.18;
  const jag = o.jag ?? 0.72;
  const soft = o.soft ?? 0.55;
  const rot = o.rot ?? rng.range(0, Math.PI * 2);
  const lean = o.lean ?? [0, 0];
  const apex: V3 = [cx + lean[0], y0 + h, cz + lean[1]];
  const rim: V3[] = [];
  for (let k = 0; k < n; k++) {
    const a = rot + (k / n) * Math.PI * 2 + rng.range(-0.12, 0.12);
    const rr = r * (k % 2 === 0 ? 1 : jag) * rng.range(0.9, 1.08);
    const dy = droop * (rr / r) * rng.range(0.7, 1.2);
    rim.push([cx + Math.cos(a) * rr, y0 - dy, cz + Math.sin(a) * rr]);
  }
  const side = b.getPaint();
  for (let k = 0; k < n; k++) {
    const a = rim[k], c = rim[(k + 1) % n];
    const mid = vlerp(a, c, 0.5);
    // cone surface normal: (h * radialDir, r) normalized
    const radial = (p: V3): V3 => {
      const dx = p[0] - cx, dz = p[2] - cz, d = Math.hypot(dx, dz) || 1;
      return vnorm([(dx / d) * h, r, (dz / d) * h]);
    };
    const fnrm = vnorm(vcross(vsub(a, apex), vsub(c, apex)));
    const out: V3 = vnorm([mid[0] - cx, 0.4, mid[2] - cz]);
    const f = vdot(fnrm, out) >= 0 ? fnrm : vscale(fnrm, -1);
    triOutN(b, apex, a, c, vmix(f, [0, 1, 0], 0.35), vmix(f, radial(a), soft), vmix(f, radial(c), soft), out);
  }
  if (!o.noUnder) {
    if (o.under !== undefined) b.paint(o.under, side.surf);
    const u: V3 = [cx + lean[0] * 0.3, y0 + h * 0.22, cz + lean[1] * 0.3];
    for (let k = 0; k < n; k++) {
      const a = rim[k], c = rim[(k + 1) % n];
      triOut(b, u, a, c, [0, -1, 0]);
    }
    b.paint(side);
  }
}

/** Pick helper that works with readonly tuples. */
export function pickIdx<T>(arr: readonly T[], i: number): T {
  return arr[((i % arr.length) + arr.length) % arr.length];
}
