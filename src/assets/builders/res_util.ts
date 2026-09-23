/**
 * Residential helper kit (owned by the residential asset agent). Local modeling helpers used by
 * res_houses.ts / res_mid.ts / res_high.ts: face-space transforms, windows, doors, roofs with thickness,
 * cornices, parapets, balconies, fire escapes and small lot-dressing props.
 *
 * Face space: inFace(b, face, plane, fn) sets a transform so that inside fn local x = "u" (to the right when
 * looking at the wall from outside), y = up, local +z = outward normal and z = 0 is the wall plane.
 */
import * as THREE from 'three';
import { ModelBuilder, PALETTE, type ColorLike, type Paint } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { CAR_COLORS, car } from '../kit';

export type V3 = [number, number, number];
export type Face = 'pz' | 'nz' | 'px' | 'nx';

export function P(color: ColorLike, surf: Surf = Surf.Plain, pattern = 0, floor = 3.3): Paint {
  return { color, surf, pattern, floor };
}

// ---------------------------------------------------------------------------------------------- palettes
export const TRIM = 0xf1eee6;
export const TRIM_CREAM = 0xe8dfc9;
export const TRIM_DARK = 0x2e3033;
export const GLASS = 0x2a3440;
export const LAWN = 0x6a9443;
export const LAWN_LUSH = 0x5e8d3c;
export const LAWN_DRY = 0x93945a;
export const DIRT = 0x86704f;
export const CONCRETE = 0xbdb8ad;
export const ASPHALT = 0x404145;
export const DOORS = [0x7e2a26, 0x2c3b57, 0x2f4a37, 0x6b4a2e, 0x2a2a2a, 0xa8823a, 0x55707e];
export const FLOWERS = [0xc4506a, 0xd9a13c, 0xe6e0d0, 0x9a5fb0, 0xd4553a];

/** Push a face-space transform, run fn, pop. */
export function inFace(b: ModelBuilder, f: Face, plane: number, fn: () => void): void {
  b.push();
  if (f === 'pz') b.translate(0, 0, plane);
  else if (f === 'nz') b.translate(0, 0, plane).rotateY(Math.PI);
  else if (f === 'px') b.translate(plane, 0, 0).rotateY(Math.PI / 2);
  else b.translate(plane, 0, 0).rotateY(-Math.PI / 2);
  fn();
  b.pop();
}
/** world coordinate along the face (x for z-faces, z for x-faces) -> face-space u */
export function U(f: Face, a: number): number {
  return f === 'pz' || f === 'nx' ? a : -a;
}

/** Quad in face space facing +z at depth z. */
export function fq(b: ModelBuilder, u0: number, v0: number, u1: number, v1: number, z: number): void {
  b.quad([u0, v0, z], [u1, v0, z], [u1, v1, z], [u0, v1, z]);
}

/** Triangle oriented so its normal points up (+y) (or down if up=false). */
export function triUp(b: ModelBuilder, a: V3, c1: V3, c2: V3, up = true): void {
  const ux = c1[0] - a[0], uz = c1[2] - a[2], vx = c2[0] - a[0], vz = c2[2] - a[2];
  const ny = uz * vx - ux * vz;
  if ((ny >= 0) === up) b.tri(a, c1, c2);
  else b.tri(a, c2, c1);
}
/** Convex polygon cap at height y (fan triangulation), facing up. pts = [x, z][] */
export function capPoly(b: ModelBuilder, pts: [number, number][], y: number, up = true): void {
  for (let i = 1; i < pts.length - 1; i++) triUp(b, [pts[0][0], y, pts[0][1]], [pts[i][0], y, pts[i][1]], [pts[i + 1][0], y, pts[i + 1][1]], up);
}

// ---------------------------------------------------------------------------------------------- openings
export interface WinStyle {
  frame?: ColorLike | null;
  ft?: number;
  glass?: ColorLike;
  /** 0 none, 1 vertical bar, 2 cross, 3 two-over-two (cross + extra verticals) */
  mull?: number;
  sill?: ColorLike | null;
  shutter?: ColorLike | null;
  head?: ColorLike | null;
  flower?: ColorLike | null;
  /** draw glass with WallWindows-like dark look but GlassPlain night glow (default) */
  surf?: Surf;
  /** always lit at night (pavilion glass) — use on one living-room window so a home never looks empty */
  lit?: boolean;
}

/** Window in face space: bottom-center at (u, y), size w x h. */
export function win(b: ModelBuilder, u: number, y: number, w: number, h: number, s: WinStyle = {}): void {
  const ft = s.ft ?? 0.1;
  const fc = s.frame === undefined ? TRIM : s.frame;
  if (fc !== null) {
    b.paint(fc);
    fq(b, u - w / 2 - ft, y - ft, u + w / 2 + ft, y + h + ft, 0.05);
  }
  b.paint(s.glass ?? GLASS, s.surf ?? Surf.GlassPlain, s.lit ? 2 : 0);
  fq(b, u - w / 2, y, u + w / 2, y + h, 0.08);
  const mull = s.mull ?? 0;
  if (mull > 0 && fc !== null) {
    b.paint(fc);
    fq(b, u - 0.035, y, u + 0.035, y + h, 0.1);
    if (mull >= 2) fq(b, u - w / 2, y + h * 0.52 - 0.035, u + w / 2, y + h * 0.52 + 0.035, 0.1);
    if (mull >= 3) {
      fq(b, u - w / 4 - 0.03, y, u - w / 4 + 0.03, y + h, 0.1);
      fq(b, u + w / 4 - 0.03, y, u + w / 4 + 0.03, y + h, 0.1);
    }
  }
  if (s.shutter) {
    b.paint(s.shutter, Surf.Wood);
    const sw = Math.min(0.55, w * 0.45);
    fq(b, u - w / 2 - ft - 0.04 - sw, y - 0.02, u - w / 2 - ft - 0.04, y + h + 0.02, 0.06);
    fq(b, u + w / 2 + ft + 0.04, y - 0.02, u + w / 2 + ft + 0.04 + sw, y + h + 0.02, 0.06);
  }
  if (s.sill) {
    b.paint(s.sill);
    const a = u - w / 2 - ft - 0.08, c = u + w / 2 + ft + 0.08, y0 = y - ft - 0.1, y1 = y - ft + 0.02;
    b.quad([a, y1, 0.16], [c, y1, 0.16], [c, y1, 0], [a, y1, 0]);
    fq(b, a, y0, c, y1, 0.16);
  }
  if (s.head) {
    b.paint(s.head);
    const a = u - w / 2 - ft - 0.1, c = u + w / 2 + ft + 0.1, y0 = y + h + ft, y1 = y0 + 0.2;
    b.quad([a, y1, 0.12], [c, y1, 0.12], [c, y1, 0], [a, y1, 0]);
    fq(b, a, y0, c, y1, 0.12);
  }
  if (s.flower) {
    b.paint(0x6b4a33, Surf.Wood).box(u - w / 2, y - ft - 0.34, 0, u + w / 2, y - ft - 0.06, 0.3, { nz: null });
    b.paint(s.flower, Surf.Foliage).box(u - w / 2 + 0.03, y - ft - 0.06, 0.03, u + w / 2 - 0.03, y - ft + 0.14, 0.27, { nz: null, bottom: null });
  }
}

/** Row of windows on a world face. `at` = list of world coordinates along the face (x for z faces, z for x faces). */
export function wins(b: ModelBuilder, f: Face, plane: number, at: number[], y: number, w: number, h: number, s: WinStyle = {}): void {
  inFace(b, f, plane, () => {
    for (const a of at) win(b, U(f, a), y, w, h, s);
  });
}

/** evenly spaced centers across [a0, a1] */
export function spread(a0: number, a1: number, n: number): number[] {
  const r: number[] = [];
  for (let i = 0; i < n; i++) r.push(a0 + ((i + 0.5) / n) * (a1 - a0));
  return r;
}

export interface DoorStyle {
  frame?: ColorLike | null;
  surf?: Surf;
  /** glass panel in the upper door */
  lite?: boolean;
  /** transom window above */
  transom?: boolean;
  /** porch light beside door */
  lamp?: boolean;
  /** side lights (narrow windows either side) */
  sidelights?: boolean;
}
/** Door in face space: bottom-center (u, y), w x h. */
export function door(b: ModelBuilder, u: number, y: number, w: number, h: number, color: ColorLike, s: DoorStyle = {}): void {
  const fc = s.frame === undefined ? TRIM : s.frame;
  const sl = s.sidelights ? 0.42 : 0;
  const tr = s.transom ? 0.45 : 0;
  if (fc !== null) {
    b.paint(fc);
    fq(b, u - w / 2 - sl - 0.12, y, u + w / 2 + sl + 0.12, y + h + tr + 0.12, 0.05);
  }
  b.paint(color, s.surf ?? Surf.Plain);
  fq(b, u - w / 2, y, u + w / 2, y + h, 0.09);
  b.paint(GLASS, Surf.GlassPlain);
  if (s.lite) fq(b, u - w * 0.3, y + h * 0.6, u + w * 0.3, y + h * 0.9, 0.11);
  if (s.transom) fq(b, u - w / 2, y + h + 0.06, u + w / 2, y + h + tr, 0.09);
  if (s.sidelights) {
    fq(b, u - w / 2 - sl, y + 0.3, u - w / 2 - 0.06, y + h, 0.09);
    fq(b, u + w / 2 + 0.06, y + 0.3, u + w / 2 + sl, y + h, 0.09);
  }
  if (s.lamp) {
    b.paint(0xffe2a8, Surf.Emissive);
    b.box(u + w / 2 + sl + 0.225, y + h * 0.72, 0.06, u + w / 2 + sl + 0.475, y + h * 0.72 + 0.4, 0.3, { nz: null });
  }
}

/** Garage door (horizontal panel lines via Wood surf) in face space. */
export function garageDoor(b: ModelBuilder, u: number, y: number, w: number, h: number, color: ColorLike = 0xe9e6de, frame: ColorLike | null = TRIM, windows = false, lamp = true): void {
  if (lamp) {
    b.paint(0xffe2a8, Surf.Emissive);
    b.box(u + w / 2 + 0.3, y + h * 0.9, 0.04, u + w / 2 + 0.55, y + h * 0.9 + 0.4, 0.28, { nz: null });
  }
  if (frame !== null) {
    b.paint(frame);
    fq(b, u - w / 2 - 0.15, y, u + w / 2 + 0.15, y + h + 0.15, 0.04);
  }
  b.paint(color, Surf.Wood);
  fq(b, u - w / 2, y, u + w / 2, y + h, 0.07);
  if (windows) {
    // dark garage glazing: reflective but never lit at night
    b.paint(0x2a3038, Surf.GlassPlain, 1);
    fq(b, u - w / 2 + 0.2, y + h * 0.72, u + w / 2 - 0.2, y + h * 0.86, 0.09);
  }
}

/** Steps in face space, centered at u, width w, going up to height n*rise at the wall; y0 ground. */
export function steps(b: ModelBuilder, u: number, w: number, n: number, rise: number, run: number, color: ColorLike = CONCRETE, y0 = 0, surf: Surf = Surf.Pavement): void {
  b.paint(color, surf);
  for (let k = 1; k <= n; k++) {
    b.box(u - w / 2, y0 + (k - 1) * rise, 0, u + w / 2, y0 + k * rise, (n - k + 1) * run, { nz: null });
  }
}

/** Stoop railings (two sloped beams + posts) in face space for steps built with steps(). */
export function stoopRails(b: ModelBuilder, u: number, w: number, n: number, rise: number, run: number, color: ColorLike = 0x222426, y0 = 0): void {
  b.paint(color, Surf.Metal);
  const L = n * run;
  for (const s of [-1, 1]) {
    const x = u + s * (w / 2 - 0.06);
    const zb = L - run * 0.5, yb = y0 + rise + 0.9, yt = y0 + n * rise + 0.9;
    // sloped hand rail + newel post + a mid baluster (in-plane strips)
    b.quad2([x, yb - 0.07, zb], [x, yt - 0.07, 0.1], [x, yt, 0.1], [x, yb, zb]);
    b.quad2([x, y0, zb + 0.04], [x, y0, zb - 0.04], [x, yb + 0.05, zb - 0.04], [x, yb + 0.05, zb + 0.04]);
    const zm = zb * 0.5, ym = y0 + rise * (n * 0.5 + 0.5);
    b.quad2([x, ym, zm + 0.03], [x, ym, zm - 0.03], [x, (yb + yt) / 2, zm - 0.03], [x, (yb + yt) / 2, zm + 0.03]);
  }
}

// ---------------------------------------------------------------------------------------------- roofs
export interface RoofOpts {
  /** eave overhang (m) */
  over?: number;
  /** rake (gable end) overhang */
  rake?: number;
  /** slab thickness */
  t?: number;
  /** fascia / soffit color */
  trim?: ColorLike;
  /** gable triangle paint (null = none) */
  gable?: Paint | null;
  /** ridge cap colour (draws a cap along the ridge) */
  ridge?: ColorLike;
}

/**
 * Gable roof with real thickness (fascia + soffit). Walls rect centered (cx, cz), w x d, wall top y0,
 * ridge h above y0. axis = ridge direction.
 */
export function roofGable(b: ModelBuilder, cx: number, cz: number, w: number, d: number, y0: number, h: number, axis: 'x' | 'z', roof: Paint, o: RoofOpts = {}): void {
  if (axis === 'z') {
    b.push().translate(cx, 0, cz).rotateY(Math.PI / 2);
    roofGable(b, 0, 0, d, w, y0, h, 'x', roof, o);
    b.pop();
    return;
  }
  const over = o.over ?? 0.45, rake = o.rake ?? 0.3, t = o.t ?? 0.16;
  const half = d / 2, k = h / half;
  const ye = y0 - k * over, yr = y0 + h;
  const xa = cx - w / 2 - rake, xb = cx + w / 2 + rake;
  const zf = cz + half + over, zb = cz - half - over;
  b.paint(roof);
  b.quad([xa, ye, zf], [xb, ye, zf], [xb, yr, cz], [xa, yr, cz]);
  b.quad([xb, ye, zb], [xa, ye, zb], [xa, yr, cz], [xb, yr, cz]);
  b.paint(o.trim ?? TRIM);
  // soffits
  b.quad([xa, ye - t, zf], [xa, yr - t, cz], [xb, yr - t, cz], [xb, ye - t, zf]);
  b.quad([xb, ye - t, zb], [xb, yr - t, cz], [xa, yr - t, cz], [xa, ye - t, zb]);
  // eave fascia
  b.quad([xa, ye - t, zf], [xb, ye - t, zf], [xb, ye, zf], [xa, ye, zf]);
  b.quad([xb, ye - t, zb], [xa, ye - t, zb], [xa, ye, zb], [xb, ye, zb]);
  // rake fascia
  b.quad([xb, ye - t, zf], [xb, yr - t, cz], [xb, yr, cz], [xb, ye, zf]);
  b.quad([xb, yr - t, cz], [xb, ye - t, zb], [xb, ye, zb], [xb, yr, cz]);
  b.quad([xa, ye, zf], [xa, yr, cz], [xa, yr - t, cz], [xa, ye - t, zf]);
  b.quad([xa, yr, cz], [xa, ye, zb], [xa, ye - t, zb], [xa, yr - t, cz]);
  if (o.ridge !== undefined) b.paint(o.ridge).box(xa, yr - 0.06, cz - 0.16, xb, yr + 0.1, cz + 0.16, { bottom: null });
  if (o.gable !== null && o.gable !== undefined) {
    b.paint(o.gable);
    const gx0 = cx - w / 2, gx1 = cx + w / 2, zF = cz + half, zB = cz - half;
    b.tri([gx1, y0, zF], [gx1, y0, zB], [gx1, yr, cz]);
    b.tri([gx0, y0, zB], [gx0, y0, zF], [gx0, yr, cz]);
  }
}

/** Front-facing gable only on one end: roof ridge along z; useful for gable-front houses. Same as roofGable axis z. */

/** Hip roof with thickness. Ridge along the longer side. */
export function roofHip(b: ModelBuilder, cx: number, cz: number, w: number, d: number, y0: number, h: number, roof: Paint, o: RoofOpts = {}): void {
  if (d > w) {
    b.push().translate(cx, 0, cz).rotateY(Math.PI / 2);
    roofHip(b, 0, 0, d, w, y0, h, roof, o);
    b.pop();
    return;
  }
  const over = o.over ?? 0.45, t = o.t ?? 0.16;
  const half = d / 2, k = h / half;
  const ye = y0 - k * over, yr = y0 + h;
  const x0 = cx - w / 2 - over, x1 = cx + w / 2 + over, z0 = cz - half - over, z1 = cz + half + over;
  const rx0 = cx - w / 2 + half, rx1 = cx + w / 2 - half;
  b.paint(roof);
  b.quad([x0, ye, z1], [x1, ye, z1], [rx1, yr, cz], [rx0, yr, cz]);
  b.quad([x1, ye, z0], [x0, ye, z0], [rx0, yr, cz], [rx1, yr, cz]);
  b.tri([x1, ye, z1], [x1, ye, z0], [rx1, yr, cz]);
  b.tri([x0, ye, z0], [x0, ye, z1], [rx0, yr, cz]);
  b.paint(o.trim ?? TRIM);
  const yt = ye - t;
  // soffit ring (flat, only the overhang band) + fascia
  b.quad([x0, yt, z1], [x0, yt, z0], [x1, yt, z0], [x1, yt, z1]);
  b.quad([x0, yt, z1], [x1, yt, z1], [x1, ye, z1], [x0, ye, z1]);
  b.quad([x1, yt, z0], [x0, yt, z0], [x0, ye, z0], [x1, ye, z0]);
  b.quad([x1, yt, z1], [x1, yt, z0], [x1, ye, z0], [x1, ye, z1]);
  b.quad([x0, yt, z0], [x0, yt, z1], [x0, ye, z1], [x0, ye, z0]);
  if (o.ridge !== undefined && rx1 - rx0 > 0.3) b.paint(o.ridge).box(rx0 - 0.1, yr - 0.06, cz - 0.16, rx1 + 0.1, yr + 0.1, cz + 0.16, { bottom: null });
}

/**
 * Shed (mono-pitch) roof slab with thickness. Low wall top at y0 on the side opposite to `high`,
 * rising by h across d (wall planes). fill = paint for the wall infill (high wall strip + side triangles).
 */
export function roofShed(b: ModelBuilder, cx: number, cz: number, w: number, d: number, y0: number, h: number, high: Face, roof: Paint, o: RoofOpts & { fill?: Paint | null } = {}): void {
  if (high !== 'nz') {
    const a = high === 'pz' ? Math.PI : high === 'px' ? -Math.PI / 2 : Math.PI / 2;
    const swap = high === 'px' || high === 'nx';
    b.push().translate(cx, 0, cz).rotateY(a);
    roofShed(b, 0, 0, swap ? d : w, swap ? w : d, y0, h, 'nz', roof, o);
    b.pop();
    return;
  }
  const over = o.over ?? 0.5, rake = o.rake ?? over, t = o.t ?? 0.2;
  const k = h / d;
  const x0 = cx - w / 2 - rake, x1 = cx + w / 2 + rake;
  const zl = cz + d / 2 + over, zh = cz - d / 2 - over;
  const yl = y0 - k * over, yh = y0 + h + k * over;
  b.paint(roof);
  b.quad([x0, yl, zl], [x1, yl, zl], [x1, yh, zh], [x0, yh, zh]);
  b.paint(o.trim ?? TRIM);
  b.quad([x0, yl - t, zl], [x0, yh - t, zh], [x1, yh - t, zh], [x1, yl - t, zl]);
  b.quad([x0, yl - t, zl], [x1, yl - t, zl], [x1, yl, zl], [x0, yl, zl]);
  b.quad([x1, yh - t, zh], [x0, yh - t, zh], [x0, yh, zh], [x1, yh, zh]);
  b.quad([x1, yl - t, zl], [x1, yh - t, zh], [x1, yh, zh], [x1, yl, zl]);
  b.quad([x0, yl, zl], [x0, yh, zh], [x0, yh - t, zh], [x0, yl - t, zl]);
  if (o.fill) {
    b.paint(o.fill);
    const wx0 = cx - w / 2, wx1 = cx + w / 2, wz0 = cz - d / 2, wz1 = cz + d / 2;
    b.quad([wx1, y0, wz0], [wx0, y0, wz0], [wx0, y0 + h, wz0], [wx1, y0 + h, wz0]);
    b.tri([wx1, y0, wz1], [wx1, y0, wz0], [wx1, y0 + h, wz0]);
    b.tri([wx0, y0, wz0], [wx0, y0, wz1], [wx0, y0 + h, wz0]);
  }
}

/** Mansard / truncated hip: steep lower slopes from the wall rect (+over) to an inset flat top at y0+h. */
export function roofMansard(b: ModelBuilder, cx: number, cz: number, w: number, d: number, y0: number, h: number, inset: number, roof: Paint, top: Paint, over = 0.25): void {
  const x0 = cx - w / 2 - over, x1 = cx + w / 2 + over, z0 = cz - d / 2 - over, z1 = cz + d / 2 + over;
  const ix0 = cx - w / 2 + inset, ix1 = cx + w / 2 - inset, iz0 = cz - d / 2 + inset, iz1 = cz + d / 2 - inset;
  const y1 = y0 + h;
  b.paint(roof);
  b.quad([x0, y0, z1], [x1, y0, z1], [ix1, y1, iz1], [ix0, y1, iz1]);
  b.quad([x1, y0, z0], [x0, y0, z0], [ix0, y1, iz0], [ix1, y1, iz0]);
  b.quad([x1, y0, z1], [x1, y0, z0], [ix1, y1, iz0], [ix1, y1, iz1]);
  b.quad([x0, y0, z0], [x0, y0, z1], [ix0, y1, iz1], [ix0, y1, iz0]);
  b.paint(top);
  b.quad([ix0, y1, iz1], [ix1, y1, iz1], [ix1, y1, iz0], [ix0, y1, iz0]);
}

/** Gable dormer on a front (+z) roof slope. Roof: walls front plane zw, wall top y0, pitch k (rise/run). */
export function dormer(b: ModelBuilder, x: number, zFront: number, zw: number, y0: number, k: number, dw: number, dh: number, wall: Paint, roof: Paint, trim: ColorLike = TRIM, zBack?: number): void {
  const ys = y0 + (zw - zFront) * k; // roof height at dormer front
  const yb = ys - 0.15;
  const yt = ys + dh;
  const zb = zBack ?? zFront - (dh + 0.6) / k - 0.3;
  b.paint(wall).box(x - dw / 2, yb, zb, x + dw / 2, yt, zFront, { top: null, nz: null });
  roofGable(b, x, (zFront + zb) / 2 + 0.1, dw, zFront - zb + 0.2, yt, dw * 0.45, 'z', roof, { over: 0.18, rake: 0.2, t: 0.1, trim, gable: wall });
  inFace(b, 'pz', zFront, () => win(b, x, ys + 0.12, dw * 0.55, dh - 0.45, { frame: trim, mull: 2 }));
}

/** Chimney with cap. */
export function chimney(b: ModelBuilder, x: number, z: number, w: number, d: number, y0: number, y1: number, color: ColorLike = 0x8a4a38, surf: Surf = Surf.Brick): void {
  b.paint(color, surf).box(x - w / 2, y0, z - d / 2, x + w / 2, y1, z + d / 2, { top: null });
  b.paint(0x5a5a58).box(x - w / 2 - 0.08, y1, z - d / 2 - 0.08, x + w / 2 + 0.08, y1 + 0.18, z + d / 2 + 0.08);
  b.paint(0x222222).box(x - w / 4, y1 + 0.18, z - d / 4, x + w / 4, y1 + 0.35, z + d / 4, { bottom: null });
}

// ---------------------------------------------------------------------------------------------- mid/high-rise parts
/** Box band (cornice / stringcourse / slab) around a rect, protruding `out`. 10 tris. */
export function band(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, out: number, color: ColorLike | Paint, top = true): void {
  if (typeof color === 'object' && color !== null && !Array.isArray(color) && 'color' in (color as object)) b.paint(color as Paint);
  else b.paint(color as ColorLike);
  b.box(x0 - out, y, z0 - out, x1 + out, y + h, z1 + out, top ? undefined : { top: null });
}

/** Parapet ring (outer, inner, top faces): 24 tris. */
export function parapet(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, t: number, color: ColorLike, cap?: ColorLike): void {
  const y1 = y + h;
  b.paint(color);
  // outer
  b.quad([x0, y, z1], [x1, y, z1], [x1, y1, z1], [x0, y1, z1]);
  b.quad([x1, y, z0], [x0, y, z0], [x0, y1, z0], [x1, y1, z0]);
  b.quad([x1, y, z1], [x1, y, z0], [x1, y1, z0], [x1, y1, z1]);
  b.quad([x0, y, z0], [x0, y, z1], [x0, y1, z1], [x0, y1, z0]);
  // inner
  const a0 = x0 + t, a1 = x1 - t, c0 = z0 + t, c1 = z1 - t;
  b.quad([a1, y, c1], [a0, y, c1], [a0, y1, c1], [a1, y1, c1]);
  b.quad([a0, y, c0], [a1, y, c0], [a1, y1, c0], [a0, y1, c0]);
  b.quad([a1, y, c0], [a1, y, c1], [a1, y1, c1], [a1, y1, c0]);
  b.quad([a0, y, c1], [a0, y, c0], [a0, y1, c0], [a0, y1, c1]);
  // top
  b.paint(cap ?? color);
  b.quad([x0, y1, z1], [x1, y1, z1], [a1, y1, c1], [a0, y1, c1]);
  b.quad([x1, y1, z0], [x0, y1, z0], [a0, y1, c0], [a1, y1, c0]);
  b.quad([x1, y1, z1], [x1, y1, z0], [a1, y1, c0], [a1, y1, c1]);
  b.quad([x0, y1, z0], [x0, y1, z1], [a0, y1, c1], [a0, y1, c0]);
}

/** Flat roof top + parapet ring. */
export function flatRoof(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, parH = 0.8, t = 0.3, parColor: ColorLike = 0x9a968e, roofColor: ColorLike = 0x77736c, cap?: ColorLike): void {
  b.paint(roofColor, Surf.RoofFlat).quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
  if (parH > 0) parapet(b, x0, z0, x1, z1, y, parH, t, parColor, cap);
}

/** Balcony in face space: slab + railing. rail: 'glass' | 'solid' | 'bars'. */
export function balcony(b: ModelBuilder, u: number, y: number, w: number, dp: number, slab: ColorLike, rail: ColorLike, kind: 'glass' | 'solid' | 'bars' = 'solid'): void {
  b.paint(slab).box(u - w / 2, y - 0.18, 0, u + w / 2, y, dp, { nz: null });
  const rh = 1.05;
  if (kind === 'glass') b.paint(rail, Surf.Metal);
  else if (kind === 'bars') b.paint(rail, Surf.Metal);
  else b.paint(rail);
  const x0 = u - w / 2 + 0.02, x1 = u + w / 2 - 0.02, z1 = dp - 0.03;
  b.quad2([x0, y, z1], [x1, y, z1], [x1, y + rh, z1], [x0, y + rh, z1]);
  b.quad2([x1, y, z1], [x1, y, 0], [x1, y + rh, 0], [x1, y + rh, z1]);
  b.quad2([x0, y, 0], [x0, y, z1], [x0, y + rh, z1], [x0, y + rh, 0]);
  if (kind !== 'solid') {
    b.paint(kind === 'glass' ? 0xdddddd : rail, Surf.Metal);
    b.box(x0, y + rh, 0, x1, y + rh + 0.06, z1 + 0.03, { nz: null, bottom: null });
  }
}

/** Fire escape in face space: platforms at each y in ys, zig-zag ladders, railing. */
export function fireEscape(b: ModelBuilder, u: number, ys: number[], w: number, color: ColorLike = 0x2b2b2b): void {
  const dp = 1.2;
  b.paint(color, Surf.Metal);
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    b.box(u - w / 2, y - 0.08, 0, u + w / 2, y, dp, { nz: null });
    b.quad2([u - w / 2, y + 0.9, dp], [u + w / 2, y + 0.9, dp], [u + w / 2, y + 1.0, dp], [u - w / 2, y + 1.0, dp]);
    b.quad2([u - w / 2, y + 0.4, dp], [u + w / 2, y + 0.4, dp], [u + w / 2, y + 0.46, dp], [u - w / 2, y + 0.46, dp]);
    // posts at ends
    b.box(u - w / 2, y, dp - 0.06, u - w / 2 + 0.06, y + 1.0, dp, { nz: null, bottom: null, top: null });
    b.box(u + w / 2 - 0.06, y, dp - 0.06, u + w / 2, y + 1.0, dp, { nz: null, bottom: null, top: null });
    // ladder down to the previous platform (or drop ladder to 2.5 m above ground for first)
    const yPrev = i > 0 ? ys[i - 1] : Math.max(y - 2.4, 1.8);
    const dir = i % 2 === 0 ? 1 : -1;
    const xa = u - dir * (w / 2 - 0.5), xb = u + dir * (w / 2 - 0.5);
    b.beam([xa, yPrev, dp * 0.5], [xb, y, dp * 0.5], 0.12);
  }
}

// ---------------------------------------------------------------------------------------------- lot dressing
export function lawnSlab(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, color: ColorLike = LAWN, h = 0.06): void {
  b.paint(color, Surf.Foliage).box(x0, 0, z0, x1, h, z1);
}
export function paveSlab(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, color: ColorLike = CONCRETE, h = 0.09): void {
  b.paint(color, Surf.Pavement).box(x0, 0, z0, x1, h, z1);
}

export function bush(b: ModelBuilder, x: number, z: number, r: number, color: ColorLike = 0x4a7434, seed = 1, hScale = 0.8): void {
  b.paint(color, Surf.Foliage).blob(x, r * hScale * 1.1, z, r, r * hScale, r, 0, 0.18, seed);
}

/** Row of bushes along a line. */
export function bushRow(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, n: number, r: number, color: ColorLike = 0x4a7434, seed = 1): void {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    bush(b, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, r * (0.85 + 0.3 * ((i * 7919) % 5) / 5), color, seed + i * 3.1);
  }
}

/** Flower bed: soil + low colored foliage. */
export function flowerBed(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, color: ColorLike, y = 0): void {
  // low green base + 3-5 soft flower clumps (flower colour pulled 35% toward leaf green)
  b.paint(0x4f7a34, Surf.Foliage).box(x0, y, z0, x1, y + 0.18, z1);
  const w = x1 - x0, d = z1 - z0, alongX = w >= d, L = Math.max(w, d);
  const n = Math.max(3, Math.min(5, Math.round(L / 1.1)));
  const fc = typeof color === 'number' ? mixHex(color, 0x4f7a34, 0.35) : color;
  b.paint(fc, Surf.Foliage);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, side = (i % 2 ? 1 : -1) * 0.18;
    const r = 0.28 + 0.07 * (((i * 37 + Math.round(x0 * 13 + z0 * 7)) % 5 + 5) % 5) / 4;
    const x = alongX ? x0 + w * t : (x0 + x1) / 2 + side * w;
    const z = alongX ? (z0 + z1) / 2 + side * d : z0 + d * t;
    b.blob(x, y + 0.18 + r * 0.45, z, Math.min(r, w * 0.5), r * 0.75, Math.min(r, d * 0.5), 0, 0.2, x * 3.1 + z * 1.7);
  }
}

/**
 * Formal boxwood parterre: clipped hedge border, inner lawn, gravel cross paths, 4 topiary cones and
 * optional flower edge strips (0.8 m) along the outer long sides.
 */
export function parterre(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, flower: ColorLike | null = null): void {
  const t = 0.45, hh = 0.55, y = 0.07;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const up = (a: number, c: number, d: number, e: number, yy: number) => b.quad([a, yy, e], [d, yy, e], [d, yy, c], [a, yy, c]);
  b.paint(0x5e8d3c, Surf.Foliage); up(x0, z0, x1, z1, y);
  b.paint(0xd8d0c0, Surf.Pavement); up(cx - 0.6, z0 + t, cx + 0.6, z1 - t, y + 0.02); up(x0 + t, cz - 0.6, x1 - t, cz + 0.6, y + 0.025);
  // clipped boxwood border as one hollow ring
  const X0 = x0, X1 = x1, Z0 = z0, Z1 = z1, a0 = x0 + t, a1 = x1 - t, c0 = z0 + t, c1 = z1 - t;
  b.paint(0x2f5a26, Surf.Foliage);
  b.quad([X0, y, Z1], [X1, y, Z1], [X1, hh, Z1], [X0, hh, Z1]); b.quad([X1, y, Z0], [X0, y, Z0], [X0, hh, Z0], [X1, hh, Z0]);
  b.quad([X1, y, Z1], [X1, y, Z0], [X1, hh, Z0], [X1, hh, Z1]); b.quad([X0, y, Z0], [X0, y, Z1], [X0, hh, Z1], [X0, hh, Z0]);
  b.quad([a1, y, c1], [a0, y, c1], [a0, hh, c1], [a1, hh, c1]); b.quad([a0, y, c0], [a1, y, c0], [a1, hh, c0], [a0, hh, c0]);
  b.quad([a1, y, c0], [a1, y, c1], [a1, hh, c1], [a1, hh, c0]); b.quad([a0, y, c1], [a0, y, c0], [a0, hh, c0], [a0, hh, c1]);
  b.quad([X0, hh, Z1], [X1, hh, Z1], [a1, hh, c1], [a0, hh, c1]); b.quad([X1, hh, Z0], [X0, hh, Z0], [a0, hh, c0], [a1, hh, c0]);
  b.quad([X1, hh, Z1], [X1, hh, Z0], [a1, hh, c0], [a1, hh, c1]); b.quad([X0, hh, Z0], [X0, hh, Z1], [a0, hh, c1], [a0, hh, c0]);
  const qx = (x1 - x0) / 4, qz = (z1 - z0) / 4;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) spike(b, cx + sx * qx, cz + sz * qz, y, 1.7, 0.5, 6);
  if (flower !== null) {
    const fc = typeof flower === 'number' ? mixHex(flower, 0x4f7a34, 0.35) : flower;
    b.paint(fc, Surf.Foliage);
    for (const z of [c0 + 0.05, c1 - 0.85]) b.box(a0 + 0.1, y, z, a1 - 0.1, 0.42, z + 0.8, { bottom: null, nz: z < cz ? null : undefined, pz: z > cz ? null : undefined });
  }
}

/** Cone without degenerate triangles (seg tris): topiary, spires. Uses the current paint. */
export function spike(b: ModelBuilder, x: number, z: number, y: number, h: number, r: number, seg = 6): void {
  const apex: V3 = [x, y + h, z];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    b.tri([x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], apex);
  }
}

/** Current lot limits used to keep trees inside the lot / under the height guideline. */
const LOT = { hw: 8, hd: 8, maxH: 100 };
export function setLot(hw: number, hd: number, maxH: number): void {
  LOT.hw = hw; LOT.hd = hd; LOT.maxH = maxH;
}
const TREE_R = { round: 2.2 * 1.18, wide: 3.3 * 1.2, column: 0.9 * 1.1, cone: 1.8 };
const TREE_H = { round: 5.9 * 1.16, wide: 7.2 * 1.2, column: 6.8 * 1.1, cone: 7.1 };

/** Tree variants (cheap). kind: round | cone | columnar | palm-ish tall */
export function tree(b: ModelBuilder, rng: RNG, x: number, z: number, s = 1, kind: 'round' | 'cone' | 'column' | 'wide' = 'round', color?: ColorLike): void {
  let k = s * rng.range(0.85, 1.15);
  // keep under the model's height guideline and inside the lot
  k = Math.min(k, (LOT.maxH * 1.15) / TREE_H[kind]);
  const r = TREE_R[kind] * k + 0.2;
  x = Math.max(-LOT.hw + r, Math.min(LOT.hw - r, x));
  z = Math.max(-LOT.hd + r, Math.min(LOT.hd - r, z));
  const g = color ?? rng.pick([0x4c7630, 0x557f35, 0x3f6a2d, 0x62883a, 0x4a6e2c]);
  if (kind === 'round') {
    b.paint(PALETTE.trunk, Surf.Wood).cylinder(x, z, 0, 2.4 * k, 0.2 * k, 0.14 * k, 5, { top: false });
    b.paint(g, Surf.Foliage).blob(x, 3.9 * k, z, 2.2 * k, 2.0 * k, 2.2 * k, 0, 0.16, rng.next() * 10);
  } else if (kind === 'wide') {
    b.paint(PALETTE.trunk, Surf.Wood).cylinder(x, z, 0, 3.0 * k, 0.28 * k, 0.18 * k, 5, { top: false });
    b.paint(g, Surf.Foliage).blob(x, 4.6 * k, z, 3.3 * k, 2.3 * k, 3.1 * k, 0, 0.2, rng.next() * 10);
    b.paint(g, Surf.Foliage).blob(x + 1.2 * k, 5.6 * k, z - 0.6 * k, 2.0 * k, 1.6 * k, 2.0 * k, 0, 0.2, rng.next() * 10);
  } else if (kind === 'column') {
    b.paint(PALETTE.trunk, Surf.Wood).cylinder(x, z, 0, 0.8 * k, 0.15 * k, 0.12 * k, 5, { top: false });
    b.paint(color ?? 0x3a5e2c, Surf.Foliage).blob(x, 3.6 * k, z, 0.9 * k, 3.2 * k, 0.9 * k, 0, 0.1, rng.next() * 10);
  } else {
    b.paint(PALETTE.trunk, Surf.Wood).cylinder(x, z, 0, 1.4 * k, 0.18 * k, 0.14 * k, 5, { top: false });
    b.paint(color ?? 0x2f5a2e, Surf.Foliage).cone(x, z, 1.1 * k, 6.0 * k, 1.8 * k, 7);
  }
}

/** Picket-style fence: panel (double sided) + posts + cap rail. */
export function picket(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, h = 1.0, color: ColorLike = TRIM, postEvery = 2.4): void {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.1) return;
  b.paint(color, Surf.Corrugated);
  b.quad2([ax, 0.1, az], [bx, 0.1, bz], [bx, h, bz], [ax, h, az]);
  b.paint(color);
  const n = Math.max(1, Math.round(len / postEvery));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    b.box(x - 0.07, 0, z - 0.07, x + 0.07, h + 0.12, z + 0.07, { bottom: null });
  }
}

/** Wooden board / privacy fence (solid). */
export function boardFence(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, h = 1.8, color: ColorLike = 0x8a6c4c): void {
  b.paint(color, Surf.Wood);
  b.quad2([ax, 0, az], [bx, 0, bz], [bx, h, bz], [ax, h, az]);
  b.paint(color).beam([ax, h, az], [bx, h, bz], 0.1);
}

/** Chain link fence (metal, transparent-looking via dark thin panel). */
export function chainFence(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, h = 1.5, color: ColorLike = 0x8a8f94, postEvery = 3): void {
  b.paint(color, Surf.Metal);
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / postEvery));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    b.cylinder(x, z, 0, h, 0.04, 0.04, 4, { top: false });
  }
  b.beam([ax, h, az], [bx, h, bz], 0.05);
  b.paint(0x7d8286, Surf.Metal);
  for (const y of [0.12, h * 0.5]) b.quad2([ax, y - 0.025, az], [bx, y - 0.025, bz], [bx, y + 0.025, bz], [ax, y + 0.025, az]);
}

/** See-through iron railing: thin square posts every `every` m + top rail. */
export function ironRail(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, h = 0.9, color: ColorLike = 0x2a2c2e, every = 1.2, y0 = 0): void {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.05) return;
  const n = Math.max(1, Math.round(len / every));
  const tx = ((bx - ax) / len) * 0.025, tz = ((bz - az) / len) * 0.025;
  b.paint(color, Surf.Metal);
  // posts and rails as thin double-sided strips in the railing plane (cheap, see-through)
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    b.quad2([x - tx, y0 + 0.05, z - tz], [x + tx, y0 + 0.05, z + tz], [x + tx, y0 + h, z + tz], [x - tx, y0 + h, z - tz]);
  }
  b.quad2([ax, y0 + h - 0.06, az], [bx, y0 + h - 0.06, bz], [bx, y0 + h, bz], [ax, y0 + h, az]);
  b.quad2([ax, y0 + h * 0.2 - 0.03, az], [bx, y0 + h * 0.2 - 0.03, bz], [bx, y0 + h * 0.2 + 0.03, bz], [ax, y0 + h * 0.2 + 0.03, az]);
}

/**
 * Ground light pool (Surf.Emissive pattern 9): a flat patch painted 0.7x the ground colour (linear) — looks like
 * the ground by day, warm lamp-lit ground at night. Place just above the lawn / pavement it sits on.
 */
export function lightPool(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, ground: ColorLike, y = 0.105): void {
  const c = new THREE.Color();
  if (ground instanceof THREE.Color) c.copy(ground); else if (Array.isArray(ground)) c.setRGB(ground[0], ground[1], ground[2], THREE.SRGBColorSpace); else c.set(ground as THREE.ColorRepresentation);
  c.multiplyScalar(0.7);
  b.paint(c, Surf.Emissive, 9);
  b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
}

/** Low stone / brick garden wall with cap. */
export function lowWall(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h = 0.8, color: ColorLike = 0xb8ab94, surf: Surf = Surf.Stone, cap: ColorLike = 0xd8d2c4): void {
  b.paint(color, surf).box(x0, 0, z0, x1, h, z1, { top: null });
  b.paint(cap).box(x0 - 0.05, h, z0 - 0.05, x1 + 0.05, h + 0.1, z1 + 0.05, { bottom: null });
}

export function hedgeBox(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h = 1.2, color: ColorLike = 0x3f6b2e): void {
  b.paint(color, Surf.Foliage).box(x0, 0, z0, x1, h, z1);
}

export function mailbox(b: ModelBuilder, x: number, z: number, color: ColorLike = 0x2a2a2a): void {
  b.paint(0x6b4a33, Surf.Wood).box(x - 0.05, 0, z - 0.05, x + 0.05, 1.0, z + 0.05, { bottom: null });
  b.paint(color, Surf.Metal).box(x - 0.13, 1.0, z - 0.25, x + 0.13, 1.25, z + 0.25, { bottom: null });
}

export function trampoline(b: ModelBuilder, x: number, z: number, r = 1.8): void {
  b.paint(0x2e5f9a, Surf.Metal).cylinder(x, z, 0.68, 0.14, r, r, 10, { top: false });
  // padded ring + mat
  b.paint(0x2e7ab8);
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2, a1 = ((i + 1) / 10) * Math.PI * 2, ri = r - 0.25;
    b.quad([x + Math.cos(a0) * r, 0.83, z + Math.sin(a0) * r], [x + Math.cos(a0) * ri, 0.83, z + Math.sin(a0) * ri], [x + Math.cos(a1) * ri, 0.83, z + Math.sin(a1) * ri], [x + Math.cos(a1) * r, 0.83, z + Math.sin(a1) * r]);
  }
  b.paint(0x30353b).cylinder(x, z, 0.78, 0.02, r - 0.25, r - 0.25, 10, { top: true });
  b.paint(0x555a60, Surf.Metal);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    b.box(x + Math.cos(a) * r - 0.04, 0, z + Math.sin(a) * r - 0.04, x + Math.cos(a) * r + 0.04, 0.78, z + Math.sin(a) * r + 0.04, { bottom: null, top: null });
  }
}

export function gardenShed(b: ModelBuilder, x: number, z: number, w: number, d: number, wall: ColorLike, roof: ColorLike, rot = 0): void {
  b.push().translate(x, 0, z).rotateY(rot);
  b.paint(wall, Surf.Wood).box(-w / 2, 0, -d / 2, w / 2, 2.1, d / 2, { top: null });
  b.paint(roof, Surf.RoofTiles).gableRoof(0, 0, w, d, 2.1, 0.8, 'x', 0.2, { color: wall, surf: Surf.Wood });
  b.paint(0x5a4a3a, Surf.Wood);
  fq(b, -0.45, 0, 0.45, 1.9, d / 2 + 0.03);
  b.pop();
}

export function playset(b: ModelBuilder, x: number, z: number, rot = 0, accent: ColorLike = 0xc9483a): void {
  b.push().translate(x, 0, z).rotateY(rot);
  b.paint(0x8a6a48, Surf.Wood);
  // swing frame
  b.beam([-1.6, 0, -0.8], [-1.6, 2.3, 0], 0.1).beam([-1.6, 0, 0.8], [-1.6, 2.3, 0], 0.1);
  b.beam([1.6, 0, -0.8], [1.6, 2.3, 0], 0.1).beam([1.6, 0, 0.8], [1.6, 2.3, 0], 0.1);
  b.beam([-1.6, 2.3, 0], [1.6, 2.3, 0], 0.12);
  // fort
  b.box(1.6, 1.2, -0.8, 3.0, 1.3, 0.8);
  b.paint(accent).gableRoof(2.3, 0, 1.4, 1.6, 2.4, 0.6, 'x', 0.1);
  b.paint(0x8a6a48, Surf.Wood).box(1.6, 0, -0.8, 1.7, 2.4, -0.7).box(2.9, 0, 0.7, 3.0, 2.4, 0.8).box(2.9, 0, -0.8, 3.0, 2.4, -0.7).box(1.6, 0, 0.7, 1.7, 2.4, 0.8);
  // slide
  b.paint(0xd9b23a, Surf.Metal).quad2([3.0, 1.3, -0.3], [3.0, 1.3, 0.3], [4.8, 0.1, 0.3], [4.8, 0.1, -0.3]);
  b.pop();
}

export function grill(b: ModelBuilder, x: number, z: number): void {
  b.paint(0x222222, Surf.Metal).box(x - 0.35, 0.6, z - 0.25, x + 0.35, 1.0, z + 0.25, { bottom: null });
  b.box(x - 0.3, 0, z - 0.2, x + 0.3, 0.6, z + 0.2, { bottom: null, top: null });
}

/** Patio table + umbrella. */
export function patioSet(b: ModelBuilder, x: number, z: number, color: ColorLike = 0xe7e1d0): void {
  b.paint(0xdddddd, Surf.Metal).cylinder(x, z, 0, 2.3, 0.04, 0.04, 4, { top: false });
  b.paint(color).cone(x, z, 2.0, 0.5, 1.4, 8, false);
  b.paint(0xf0f0f0).cylinder(x, z, 0.7, 0.05, 0.55, 0.55, 8);
}

/** Sun lounger (for pools). */
export function lounger(b: ModelBuilder, x: number, z: number, rot = 0, color: ColorLike = 0xf2efe6, y = 0): void {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(color).box(-0.35, 0.25, -0.9, 0.35, 0.35, 0.6, { bottom: null });
  b.quad2([-0.35, 0.35, 0.6], [0.35, 0.35, 0.6], [0.35, 0.9, 1.0], [-0.35, 0.9, 1.0]);
  b.pop();
}

/** In-ground pool with coping + water. */
export function poolRect(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, deck: ColorLike = 0xe2dccd, deckW = 1.2, water: ColorLike = 0x3fa9cf, y = 0): void {
  b.paint(deck, Surf.Pavement).box(x0 - deckW, y, z0 - deckW, x1 + deckW, y + 0.14, z1 + deckW);
  b.paint(water, Surf.Water).box(x0, y, z0, x1, y + 0.16, z1, { bottom: null });
  poolGlow(b, x0, z0, x1, z1, y + 0.16);
}

/** Weak underwater light: soft cyan emissive patch in the pool centre just above the water top at yw. */
export function poolGlow(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, yw: number): void {
  const ix = Math.min(0.8, (x1 - x0) * 0.2), iz = Math.min(0.8, (z1 - z0) * 0.2), y = yw + 0.004;
  b.paint(0x3fd0e8, Surf.Emissive, 1);
  b.quad([x0 + ix, y, z1 - iz], [x1 - ix, y, z1 - iz], [x1 - ix, y, z0 + iz], [x0 + ix, y, z0 + iz]);
}

export function acBox(b: ModelBuilder, x: number, z: number, y = 0): void {
  b.paint(0xb7b9b8, Surf.Metal).box(x - 0.45, y, z - 0.45, x + 0.45, y + 0.8, z + 0.45, { bottom: null });
}

export function trashCans(b: ModelBuilder, x: number, z: number, n = 2, color: ColorLike = 0x3d5a45): void {
  for (let i = 0; i < n; i++) b.paint(i % 2 ? 0x4a4f55 : color, Surf.Plain).box(x + i * 0.75 - 0.3, 0, z - 0.3, x + i * 0.75 + 0.3, 1.05, z + 0.3, { bottom: null });
}

export function propaneTank(b: ModelBuilder, x: number, z: number): void {
  b.push().translate(x, 0.55, z).rotateZ(Math.PI / 2);
  b.paint(0xe9e9e4, Surf.Metal).cylinder(0, 0, -0.9, 1.8, 0.45, 0.45, 8, { top: true, bottom: true });
  b.pop();
}

export function satDish(b: ModelBuilder, x: number, y: number, z: number, rot = 0.6): void {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(0x777777, Surf.Metal).box(-0.03, 0, -0.03, 0.03, 0.5, 0.03, { bottom: null });
  b.push().translate(0, 0.65, 0.05).rotateX(1.2);
  b.paint(0xd8d8d8, Surf.Metal).cylinder(0, 0, 0, 0.12, 0.42, 0.36, 8, { top: true });
  b.pop();
  b.pop();
}

/** Parked car helper with deterministic color from rng. */
export function parkedCar(b: ModelBuilder, rng: RNG, x: number, z: number, rot: number, color?: ColorLike, y = 0.1): void {
  car(b, x, z, rot, color ?? rng.pick(CAR_COLORS), y);
}

/** Laundry line between two points with a few hanging cloths. */
export function laundry(b: ModelBuilder, rng: RNG, a: V3, c: V3, n = 4): void {
  b.paint(0x444444, Surf.Metal).beam(a, c, 0.025);
  const cols = [0xe8e8e8, 0xc75d5d, 0x5d7fc7, 0xe6d27a, 0x7fbf8a, 0xd9a0c0];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5 + rng.range(-0.2, 0.2)) / n;
    const x = a[0] + (c[0] - a[0]) * t, y = a[1] + (c[1] - a[1]) * t, z = a[2] + (c[2] - a[2]) * t;
    const dx = (c[0] - a[0]), dz = (c[2] - a[2]);
    const L = Math.hypot(dx, dz) || 1;
    const hw = rng.range(0.25, 0.45);
    const ux = (dx / L) * hw, uz = (dz / L) * hw;
    const hh = rng.range(0.5, 0.9);
    b.paint(rng.pick(cols));
    b.quad2([x - ux, y - hh, z - uz], [x + ux, y - hh, z + uz], [x + ux, y, z + uz], [x - ux, y, z - uz]);
  }
}

/** Planter box with shrub (for plazas / terraces). */
export function planter(b: ModelBuilder, x: number, z: number, w: number, d: number, y = 0, color: ColorLike = 0x8f8a80, plant: ColorLike = 0x4f7a34, seed = 1): void {
  b.paint(color).box(x - w / 2, y, z - d / 2, x + w / 2, y + 0.55, z + d / 2, { bottom: null });
  b.paint(plant, Surf.Foliage).blob(x, y + 0.75, z, w * 0.45, 0.45, d * 0.45, 0, 0.2, seed);
}

/** Emissive rooftop aircraft warning light. */
export function beacon(b: ModelBuilder, x: number, y: number, z: number, color: ColorLike = 0xff3a2a, s = 0.35): void {
  b.paint(color, Surf.Emissive).box(x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, { bottom: null });
}

/** Snap a coordinate to a multiple of step (for aligning WallWindows columns). */
export function snap(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/** window column widths of the WallWindows patterns (materials.ts) */
export const COLW = [3.0, 2.2, 1.6, 4.2, 6.0, 1.5, 2.8, 3.2];

/** Mix two hex colors. */
export function mixHex(a: number, c: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const cr = (c >> 16) & 255, cg = (c >> 8) & 255, cb = c & 255;
  return (Math.round(ar + (cr - ar) * t) << 16) | (Math.round(ag + (cg - ag) * t) << 8) | Math.round(ab + (cb - ab) * t);
}

/**
 * Bay window in face space: protrudes dp from the wall between y0 and y1, width w at the wall.
 * winY = window bottom heights (one per storey), winH = window height. roof: small hipped roof on top (else flat cap).
 */
export function bay(
  b: ModelBuilder, u: number, y0: number, y1: number, w: number, dp: number, wall: Paint,
  o: { winY?: number[]; winH?: number; frame?: ColorLike; roof?: Paint | null; roofH?: number; square?: boolean; bottom?: boolean; cap?: ColorLike } = {},
): void {
  const a = o.square ? 0 : dp * 0.8;
  const pts: [number, number][] = [[u - w / 2, 0], [u - w / 2 + a, dp], [u + w / 2 - a, dp], [u + w / 2, 0]];
  b.paint(wall);
  for (let i = 0; i < 3; i++) {
    const [ua, za] = pts[i], [ub, zb] = pts[i + 1];
    if (Math.hypot(ub - ua, zb - za) < 0.01) continue;
    b.quad([ua, y0, za], [ub, y0, zb], [ub, y1, zb], [ua, y1, za]);
  }
  const wh = o.winH ?? 1.4;
  for (const wy of o.winY ?? [y0 + 0.8]) {
    for (let i = 0; i < 3; i++) {
      const [ua, za] = pts[i], [ub, zb] = pts[i + 1];
      const du = ub - ua, dz = zb - za, L = Math.hypot(du, dz);
      if (L < 0.3) continue;
      const tu = du / L, tz = dz / L, nu = -tz, nz = tu;
      const ins = Math.min(0.22, L * 0.15);
      const Q = (s: number, off: number, grow: number, y: number): V3 => {
        const t = s < 0.5 ? ins - grow : L - ins + grow;
        return [ua + tu * t + nu * off, y, za + tz * t + nz * off];
      };
      b.paint(o.frame ?? TRIM);
      b.quad(Q(0, 0.03, 0.08, wy - 0.08), Q(1, 0.03, 0.08, wy - 0.08), Q(1, 0.03, 0.08, wy + wh + 0.08), Q(0, 0.03, 0.08, wy + wh + 0.08));
      b.paint(GLASS, Surf.GlassPlain);
      b.quad(Q(0, 0.06, 0, wy), Q(1, 0.06, 0, wy), Q(1, 0.06, 0, wy + wh), Q(0, 0.06, 0, wy + wh));
    }
  }
  if (o.bottom ?? y0 > 0.2) {
    b.paint(wall);
    capPoly(b, pts, y0, false);
  }
  if (o.roof) {
    const rh = o.roofH ?? dp * 0.7;
    const yr = y1 + rh;
    const q1: V3 = [pts[1][0], yr, 0], q2: V3 = [pts[2][0], yr, 0];
    const p0: V3 = [pts[0][0] - 0.1, y1, 0], p1: V3 = [pts[1][0], y1, pts[1][1] + 0.12], p2: V3 = [pts[2][0], y1, pts[2][1] + 0.12], p3: V3 = [pts[3][0] + 0.1, y1, 0];
    if (a > 0) { p1[0] -= 0.1; p2[0] += 0.1; }
    b.paint(o.roof);
    b.quad(p1, p2, q2, q1);
    b.tri(p0, p1, q1);
    b.tri(p2, p3, q2);
  } else {
    b.paint(o.cap ?? wall.color);
    capPoly(b, pts, y1, true);
  }
}

/**
 * Projecting band whose top is only a ring (outer edge -> wall line), so it does not paint over the roof.
 * If roof is given, a flat roof quad is drawn over the wall rect at the band top. 16 (+2) tris.
 */
export function bandRing(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, out: number, color: ColorLike, roof: ColorLike | null = null): void {
  const X0 = x0 - out, X1 = x1 + out, Z0 = z0 - out, Z1 = z1 + out, y1 = y + h;
  b.paint(color).box(X0, y, Z0, X1, y1, Z1, { top: null });
  b.quad([X0, y1, Z1], [X1, y1, Z1], [x1, y1, z1], [x0, y1, z1]);
  b.quad([X1, y1, Z0], [X0, y1, Z0], [x0, y1, z0], [x1, y1, z0]);
  b.quad([X1, y1, Z1], [X1, y1, Z0], [x1, y1, z0], [x1, y1, z1]);
  b.quad([X0, y1, Z0], [X0, y1, Z1], [x0, y1, z1], [x0, y1, z0]);
  if (roof !== null) b.paint(roof, Surf.RoofFlat).quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
}

/**
 * Cheap parking lot: asphalt slab, painted stall lines (single quads) and parked cars.
 * Stalls are 2.6 m wide along x; rows of 5.2 m deep stalls facing an aisle. rows: 1 = one row at the -z side,
 * 2 = two rows with an aisle between (needs ~16.4 m).
 */
export function parking(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, fill = 0.6, rows = 1, maxCars = 8): void {
  let cars = 0;
  b.paint(ASPHALT, Surf.Pavement).box(x0, 0, z0, x1, 0.08, z1);
  const sw = 2.6, sd = 5.2;
  const rowZ: [number, number][] = rows === 2 ? [[z0 + 0.3, 0], [z1 - 0.3 - sd, Math.PI]] : [[z0 + 0.3, 0]];
  for (const [rz, rot] of rowZ) {
    const n = Math.floor((x1 - x0 - 0.6) / sw);
    const sx0 = (x0 + x1) / 2 - (n * sw) / 2;
    b.paint(0xe8e8e2);
    for (let i = 0; i <= n; i++) {
      const x = sx0 + i * sw;
      b.quad([x - 0.06, 0.09, rz + sd], [x + 0.06, 0.09, rz + sd], [x + 0.06, 0.09, rz], [x - 0.06, 0.09, rz]);
    }
    for (let i = 0; i < n; i++) if (rng.chance(fill) && cars < maxCars) { cars++; car(b, sx0 + (i + 0.5) * sw, rz + sd / 2, rot + (rng.next() - 0.5) * 0.06, rng.pick(CAR_COLORS), 0.08); }
  }
}

// ---------------------------------------------------------------------------------------------- rng palettes
/** Palette pick where index 0 is the hand-tuned default and alternatives come up with probability 1-keep. */
export function pickPal<T>(rng: RNG, pal: readonly T[], keep = 0.3): T {
  return rng.chance(keep) ? pal[0] : pal[1 + Math.floor(rng.next() * (pal.length - 1))];
}
export const SIDING_PAL = [0xeeebe2, 0xe6dcc2, 0x9fae94, 0x8fa3b5, 0xd2b48f, 0xc9b8a0, 0xa6b7a6, 0xb89a8c, 0xd8cfa0, 0x9aa0a8];
export const ROOF_PAL = [0x45484d, 0x5b4a3e, 0x3d4650, 0x6b5a4a, 0x55634f, 0x7a4536, 0x5c5f63, 0x4a4540];
export const DOOR_PAL = [0x7e2a26, 0x2c3b57, 0x2f4a37, 0x6b4a2e, 0x2a2a2a, 0xa8823a, 0x55707e, 0x5a3a4a];
export const BRICK_PAL = [0x8f4a3a, 0x7a4636, 0xb08a60, 0x9a5a44, 0x6e3a2e, 0xa7765a, 0x8a5040, 0xc4a472];

/** Plumbing vent stack on a roof. */
export function vent(b: ModelBuilder, x: number, z: number, y: number, h = 0.7): void {
  b.paint(0x55585c, Surf.Metal).cylinder(x, z, y - 0.3, h + 0.3, 0.07, 0.07, 5, { top: true });
}

/** Paved path through points (x, z): rotated slabs with overlapping ends (approximates a curve). */
export function pathPts(b: ModelBuilder, pts: [number, number][], w: number, color: ColorLike, h = 0.08): void {
  b.paint(color, Surf.Pavement);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az), a = Math.atan2(bx - ax, bz - az);
    b.push().translate((ax + bx) / 2, 0, (az + bz) / 2).rotateY(a);
    b.box(-w / 2, 0, -L / 2 - (i > 0 ? w * 0.35 : 0), w / 2, h + i * 0.001, L / 2 + (i < pts.length - 2 ? w * 0.35 : 0), { bottom: null });
    b.pop();
  }
}

/** Garden / drive lamp post with lamp head + ground light pool. ~22 tris. */
export function gardenLamp(b: ModelBuilder, x: number, z: number, ground: ColorLike, h = 3.2, gy = 0.1): void {
  b.paint(0x2a2c2e, Surf.Metal).box(x - 0.06, 0, z - 0.06, x + 0.06, h, z + 0.06, { bottom: null, top: null });
  b.paint(0xffe6b0, Surf.Emissive).box(x - 0.18, h, z - 0.18, x + 0.18, h + 0.45, z + 0.18, { bottom: null });
  lightPool(b, x - 1.6, z - 1.6, x + 1.6, z + 1.6, ground, gy);
}

/** Row of 2 x 3 solar panels on a sloped roof plane y(z) between x0..x1, z0..z1 (dark glass, never lit). */
export function solarRoof(b: ModelBuilder, x0: number, x1: number, z0: number, z1: number, yAt: (z: number) => number, cols = 3, rows = 2): void {
  b.paint(0x1f2a3e, Surf.GlassPlain, 1);
  const pw = (x1 - x0) / cols, pd = (z1 - z0) / rows;
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const a = x0 + c * pw + 0.06, bb = a + pw - 0.12, za = z0 + r * pd + 0.06, zb = za + pd - 0.12;
    b.quad([a, yAt(zb) + 0.1, zb], [bb, yAt(zb) + 0.1, zb], [bb, yAt(za) + 0.1, za], [a, yAt(za) + 0.1, za]);
  }
}
