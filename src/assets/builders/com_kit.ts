/**
 * Commercial-group modeling helpers (owned by the commercial asset builder).
 * Cheap, tri-conscious primitives: single-sided quads for ground markings, storefronts with mullions,
 * striped awnings, neon channel letters, pylon signs, cheap cars, parking rows, lofted (tapered) prisms,
 * crown light bands, beacons, plazas.  All coordinates are model space (meters, lot centered, front = +Z).
 */
import { ModelBuilder, type BoxFaces, type ColorLike, type Paint } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';

export type V2 = [number, number];
export type V3 = [number, number, number];

export function P(color: ColorLike, surf: Surf = Surf.Plain, pattern = 0, floor = 3.3): Paint {
  return { color, surf, pattern, floor };
}

export const C = {
  asphalt: 0x3b3c3f,
  asphaltDark: 0x2f3033,
  line: 0xe9e7e0,
  lineY: 0xe0bb3a,
  sidewalk: 0xc9c4b8,
  concrete: 0xbdb8ae,
  concreteDark: 0x8e8b84,
  plaza: 0xd6cfc0,
  plazaWarm: 0xcdb99a,
  grass: 0x6f9a45,
  grassDark: 0x587f38,
  hedge: 0x3f6b2e,
  roof: 0x8f8d89,
  roofDark: 0x626466,
  trunk: 0x5b4330,
  glass: 0x9fb3c0,
  glassDark: 0x1b222b,
  black: 0x1f2124,
  white: 0xf2f0ea,
  offwhite: 0xe6e1d6,
  metal: 0x9aa0a6,
  metalDark: 0x55595f,
  steel: 0xc3c8cd,
  gold: 0xc9a24a,
  bronze: 0x7d5c3a,
  water: 0x3f8fb8,
};

export const NEON = [0xff3b30, 0x2fd6ff, 0xff4fc3, 0xffc933, 0x4dff88, 0xfff1d6, 0xff8a2a, 0xa07bff];
export const CAR_COLORS = [0xb8bcc2, 0x2b2d31, 0xf1f1ef, 0x8a1c1c, 0x1f3f7a, 0x5d6b73, 0x3e5e3a, 0xc9a13b, 0x6b2f4a, 0xd96b2b, 0xe7e7e2, 0x44484e];

export const pav = (c: ColorLike = C.sidewalk) => P(c, Surf.Pavement);
let roofTone: ColorLike = C.roof;
/** Pick the default flat-roof tone for the model being built (gravel grey, light concrete, white membrane, tar, beige). */
export function setRoofTone(rng: RNG) {
  roofTone = rng.weighted([0x8f8d89, 0xb3b0a8, 0xd2d1cc, 0x6d6f72, 0xa39a8a], [3, 2, 2, 1.5, 1.5]);
}
export const roofP = (c?: ColorLike) => P(c ?? roofTone, Surf.RoofFlat);
export const emis = (c: ColorLike) => P(c, Surf.Emissive);
export const metal = (c: ColorLike) => P(c, Surf.Metal);
export const plain = (c: ColorLike) => P(c, Surf.Plain);
export const glassP = (c: ColorLike = C.glass) => P(c, Surf.GlassPlain);
export const foliage = (c: ColorLike = C.grass) => P(c, Surf.Foliage);

// ---------------------------------------------------------------------------------------------- primitives
/** Axis-aligned box (no bottom). top: undefined = side paint, null = omitted. */
export function box(b: ModelBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, side: Paint, top?: Paint | null, faces?: BoxFaces) {
  b.paint(side).box(x0, y0, z0, x1, y1, z1, { top, ...faces });
}

/** Upward facing quad (2 tris). */
export function up(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, p: Paint) {
  b.paint(p).quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
}
/** Downward facing quad (underside of canopies). */
export function down(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, p: Paint) {
  b.paint(p).quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]);
}
/** Vertical quad in the XY plane at z, facing +Z (dir=1) or -Z (dir=-1). */
export function faceZ(b: ModelBuilder, x0: number, x1: number, y0: number, y1: number, z: number, p: Paint, dir: 1 | -1 = 1) {
  b.paint(p);
  if (dir > 0) b.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
  else b.quad([x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z]);
}
/** Vertical quad in the ZY plane at x, facing +X (dir=1) or -X (dir=-1). */
export function faceX(b: ModelBuilder, z0: number, z1: number, y0: number, y1: number, x: number, p: Paint, dir: 1 | -1 = 1) {
  b.paint(p);
  if (dir > 0) b.quad([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1]);
  else b.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]);
}

/** Run fn with a transform so that local +Z points toward the given side of the lot. See comments for mapping. */
export function onSide(b: ModelBuilder, side: 'pz' | 'px' | 'nx' | 'nz', fn: () => void) {
  // px: local z = world x, local x = -world z | nx: local z = -world x, local x = world z | nz: local z = -z, local x = -x
  b.push();
  if (side === 'px') b.rotateY(Math.PI / 2);
  else if (side === 'nx') b.rotateY(-Math.PI / 2);
  else if (side === 'nz') b.rotateY(Math.PI);
  fn();
  b.pop();
}

// ---------------------------------------------------------------------------------------------- polygons
export function rectPts(x0: number, z0: number, x1: number, z1: number): V2[] {
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}
export function chamferPts(x0: number, z0: number, x1: number, z1: number, c: number): V2[] {
  return [[x0 + c, z0], [x1 - c, z0], [x1, z0 + c], [x1, z1 - c], [x1 - c, z1], [x0 + c, z1], [x0, z1 - c], [x0, z0 + c]];
}
export function ngonPts(cx: number, cz: number, rx: number, n: number, rot = 0, rz = rx): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
  }
  return out;
}
export function scalePts(pts: V2[], sx: number, sz = sx, cx = 0, cz = 0): V2[] {
  return pts.map(([x, z]) => [cx + (x - cx) * sx, cz + (z - cz) * sz] as V2);
}
export function rotPts(pts: V2[], a: number, cx = 0, cz = 0): V2[] {
  const c = Math.cos(a), s = Math.sin(a);
  return pts.map(([x, z]) => [cx + (x - cx) * c - (z - cz) * s, cz + (x - cx) * s + (z - cz) * c] as V2);
}
export function offsetPts(pts: V2[], dx: number, dz: number): V2[] {
  return pts.map(([x, z]) => [x + dx, z + dz] as V2);
}
function area(pts: V2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return a;
}

/**
 * Loft between two convex polygons with the same vertex count (bottom at y0, top at y1).
 * Draws side quads (outward) and an optional top cap (fan). Winding auto-corrected.
 */
export function loft(b: ModelBuilder, bot: V2[], top: V2[], y0: number, y1: number, side: Paint | null, cap: Paint | null, skipSides?: (i: number) => boolean) {
  if (area(bot) < 0) {
    bot = bot.slice().reverse();
    top = top.slice().reverse();
  }
  const n = bot.length;
  if (side) {
    b.paint(side);
    for (let i = 0; i < n; i++) {
      if (skipSides && skipSides(i)) continue;
      const j = (i + 1) % n;
      b.quad([bot[i][0], y0, bot[i][1]], [top[i][0], y1, top[i][1]], [top[j][0], y1, top[j][1]], [bot[j][0], y0, bot[j][1]]);
    }
  }
  if (cap) {
    b.paint(cap);
    for (let i = 1; i < n - 1; i++) b.tri([top[0][0], y1, top[0][1]], [top[i + 1][0], y1, top[i + 1][1]], [top[i][0], y1, top[i][1]]);
  }
}
/** Straight prism from a convex polygon. */
export function prismPts(b: ModelBuilder, pts: V2[], y0: number, y1: number, side: Paint | null, cap: Paint | null) {
  loft(b, pts, pts, y0, y1, side, cap);
}
/** Emissive (or any) band around a convex polygon, pushed outward by `out` meters (no caps). */
export function bandPts(b: ModelBuilder, pts: V2[], y0: number, y1: number, p: Paint, out = 0.06) {
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  const grown = pts.map(([x, z]) => {
    const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1;
    return [x + (dx / l) * out, z + (dz / l) * out] as V2;
  });
  loft(b, grown, grown, y0, y1, p, null);
}
/** Band around an axis-aligned rect (4 quads, 8 tris). */
export function bandRect(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, p: Paint, out = 0.06) {
  box(b, x0 - out, y0, z0 - out, x1 + out, y1, z1 + out, p, null);
}

// ---------------------------------------------------------------------------------------------- building parts
/** Parapet ring on a flat roof (32 tris). */
export function parapet(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, t: number, p: Paint) {
  b.paint(p);
  b.box(x0, y, z1 - t, x1, y + h, z1);
  b.box(x0, y, z0, x1, y + h, z0 + t);
  b.box(x0, y, z0 + t, x0 + t, y + h, z1 - t, { pz: null, nz: null });
  b.box(x1 - t, y, z0 + t, x1, y + h, z1 - t, { pz: null, nz: null });
}
/** Cornice / cap slab overhanging a rect by `out` (10 tris, +2 with underside). */
export function cornice(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, out: number, p: Paint, top?: Paint | null, under = false) {
  box(b, x0 - out, y, z0 - out, x1 + out, y + h, z1 + out, p, top, under ? { bottom: p } : undefined);
}

export interface ShopOpts {
  /** bottom of display glass (default 0.45) */
  y0?: number;
  /** top of glass */
  y1: number;
  frame: ColorLike;
  /** target mullion spacing */
  pitch?: number;
  /** door center x positions */
  doors?: number[];
  doorW?: number;
  /** optional transom bar height */
  transom?: number;
  /** glass color (mostly irrelevant, shader darkens it) */
  glass?: ColorLike;
  /** frame surround thickness (0 = none) */
  surround?: number;
}
/** Storefront glazing on the plane z (facing +Z) between x0..x1. ~2 tris per mullion. Use onSide() for other faces. */
export function storefront(b: ModelBuilder, x0: number, x1: number, z: number, o: ShopOpts) {
  const y0 = o.y0 ?? 0.45, y1 = o.y1;
  const fp = metal(o.frame);
  const s = o.surround ?? 0.12;
  if (s > 0) faceZ(b, x0 - s, x1 + s, y0 - s, y1 + s, z + 0.02, fp);
  faceZ(b, x0, x1, y0, y1, z + 0.04, glassP(o.glass ?? C.glass));
  const pitch = o.pitch ?? 2.2;
  const n = Math.max(1, Math.round((x1 - x0) / pitch));
  for (let i = 1; i < n; i++) {
    const x = x0 + (i * (x1 - x0)) / n;
    faceZ(b, x - 0.06, x + 0.06, y0, y1, z + 0.06, fp);
  }
  if (o.transom) faceZ(b, x0, x1, o.transom - 0.06, o.transom + 0.06, z + 0.06, fp);
  const dw = o.doorW ?? 1.8;
  for (const dx of o.doors ?? []) {
    faceZ(b, dx - dw / 2 - 0.1, dx + dw / 2 + 0.1, 0.0, 2.35, z + 0.07, fp);
    faceZ(b, dx - dw / 2, dx + dw / 2, 0.05, 2.25, z + 0.09, glassP(0x2a3440));
  }
}

/** Plain door (solid) on +Z plane. */
export function door(b: ModelBuilder, cx: number, z: number, w: number, h: number, color: ColorLike, frame?: ColorLike) {
  if (frame !== undefined) faceZ(b, cx - w / 2 - 0.12, cx + w / 2 + 0.12, 0, h + 0.12, z + 0.02, plain(frame));
  faceZ(b, cx - w / 2, cx + w / 2, 0, h, z + 0.04, plain(color));
}

/**
 * Sloped fabric awning on the +Z plane z, from x0..x1, attached at height y, projecting `depth`, dropping `drop`.
 * cols: stripe colors (1 color = plain). stripe width ~ stripeW.
 */
export function awning(b: ModelBuilder, x0: number, x1: number, z: number, y: number, depth: number, drop: number, cols: ColorLike[], stripeW = 0.9, valance = 0.3) {
  const n = cols.length > 1 ? Math.max(2, Math.round((x1 - x0) / stripeW)) : 1;
  const w = (x1 - x0) / n;
  const zf = z + depth, yf = y - drop;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * w, e = a + w;
    b.paint(cols[i % cols.length], Surf.Plain);
    b.quad2([a, y, z], [e, y, z], [e, yf, zf], [a, yf, zf]);
    if (valance > 0) b.quad2([a, yf - valance, zf], [e, yf - valance, zf], [e, yf, zf], [a, yf, zf]);
  }
  b.paint(cols[0], Surf.Plain);
  b.tri([x0, y, z], [x0, yf - valance, zf], [x0, yf, zf]);
  b.tri([x0, y, z], [x0, yf, zf], [x0, yf - valance, zf]);
  b.tri([x1, y, z], [x1, yf, zf], [x1, yf - valance, zf]);
  b.tri([x1, y, z], [x1, yf - valance, zf], [x1, yf, zf]);
}

/** Flat canopy slab projecting from the +Z plane (box with underside). */
export function canopy(b: ModelBuilder, x0: number, x1: number, z: number, y: number, depth: number, thick: number, p: Paint, edge?: Paint) {
  box(b, x0, y, z, x1, y + thick, z + depth, p, undefined, { bottom: p, nz: null });
  if (edge) faceZ(b, x0, x1, y + thick * 0.3, y + thick * 0.7, z + depth + 0.03, edge);
}

/**
 * Neon / channel letters on the +Z plane at z: fits a random "word" (or two) into maxW, centered at cx, baseline y0,
 * cap height h. Each letter = 1 quad. Returns the actual width used.
 */
export function letters(b: ModelBuilder, rng: RNG, cx: number, y0: number, z: number, maxW: number, h: number, color: ColorLike, opts: { n?: number; words?: number; surf?: Surf; mixed?: boolean } = {}): number {
  const words = opts.words ?? (rng.chance(0.35) ? 2 : 1);
  const ws: { w: number; h: number; gap: number }[] = [];
  const total = opts.n ?? rng.int(4, 8);
  const split = words > 1 ? rng.int(2, Math.max(2, total - 2)) : -1;
  for (let i = 0; i < total; i++) {
    const lw = h * rng.range(0.48, 0.82);
    const lh = opts.mixed && i > 0 && rng.chance(0.55) ? h * 0.72 : h;
    ws.push({ w: lw, h: lh, gap: i === split - 1 ? h * 0.55 : h * 0.16 });
  }
  let W = 0;
  for (let i = 0; i < ws.length; i++) W += ws[i].w + (i < ws.length - 1 ? ws[i].gap : 0);
  const s = Math.min(1, maxW / W);
  let x = cx - (W * s) / 2;
  const p = P(color, opts.surf ?? Surf.Emissive);
  for (const L of ws) {
    faceZ(b, x, x + L.w * s, y0, y0 + L.h, z, p);
    x += (L.w + L.gap) * s;
  }
  return W * s;
}

/** Sign panel (backing box) + letters, on the +Z plane. */
export function signBoard(b: ModelBuilder, rng: RNG, x0: number, x1: number, y0: number, y1: number, z: number, back: Paint, letterColor: ColorLike, depth = 0.25, opts: { words?: number; n?: number; mixed?: boolean } = {}) {
  box(b, x0, y0, z, x1, y1, z + depth, back, undefined, { nz: null });
  const h = (y1 - y0) * 0.62;
  letters(b, rng, (x0 + x1) / 2, y0 + (y1 - y0 - h) / 2, z + depth + 0.02, (x1 - x0) * 0.86, h, letterColor, opts);
}

/** Projecting blade sign perpendicular to the +Z facade at x (emissive both faces). */
export function bladeSign(b: ModelBuilder, x: number, z: number, y0: number, h: number, w: number, color: ColorLike, frame: ColorLike = C.black) {
  box(b, x - 0.13, y0, z, x + 0.13, y0 + h, z + w, metal(frame), undefined, { nz: null, px: emis(color), nx: emis(color) });
  box(b, x - 0.04, y0 + h * 0.5 - 0.05, z - 0.01, x + 0.04, y0 + h * 0.5 + 0.05, z + 0.05, metal(frame));
}

/** Disc sign facing +Z (e.g. logos), seg-gon. */
export function discSign(b: ModelBuilder, x: number, y: number, z: number, r: number, face: Paint, rim: Paint, seg = 12, thick = 0.25) {
  b.push().translate(x, y, z).rotateX(Math.PI / 2);
  b.paint(rim).cylinder(0, 0, 0, thick, r, r, seg, { top: true, topPaint: face, smooth: false });
  b.pop();
}

export interface PylonPanel { h: number; color: ColorLike; surf?: Surf; w?: number }
/** Free-standing pylon sign: panels stacked downward from the top. poles: 1 central / 2 legs / 0 monument base. */
export function pylon(b: ModelBuilder, x: number, z: number, h: number, w: number, panels: PylonPanel[], o: { poles?: 0 | 1 | 2; pole?: ColorLike; depth?: number; frame?: ColorLike; rot?: number; cap?: ColorLike } = {}) {
  const d = o.depth ?? 0.5;
  const frame = metal(o.frame ?? C.metalDark);
  b.push().translate(x, 0, z).rotateY(o.rot ?? 0);
  let y = h;
  if (o.cap !== undefined) {
    box(b, -w / 2 - 0.15, h, -d / 2 - 0.1, w / 2 + 0.15, h + 0.35, d / 2 + 0.1, plain(o.cap));
  }
  for (const pn of panels) {
    const pw = pn.w ?? w;
    const face = P(pn.color, pn.surf ?? Surf.Emissive);
    box(b, -pw / 2, y - pn.h, -d / 2, pw / 2, y, d / 2, frame, frame, { pz: face, nz: face, bottom: frame });
    y -= pn.h + 0.12;
  }
  const poles = o.poles ?? 1;
  const pp = metal(o.pole ?? C.metalDark);
  if (poles === 1) box(b, -0.22, 0, -0.22, 0.22, y + 0.1, 0.22, pp, null);
  else if (poles === 2) {
    box(b, -w / 2 + 0.1, 0, -0.2, -w / 2 + 0.5, y + 0.1, 0.2, pp, null);
    box(b, w / 2 - 0.5, 0, -0.2, w / 2 - 0.1, y + 0.1, 0.2, pp, null);
  } else box(b, -w / 2 + 0.2, 0, -d / 2 - 0.05, w / 2 - 0.2, y + 0.1, d / 2 + 0.05, pp);
  b.pop();
}

// ---------------------------------------------------------------------------------------------- vehicles & parking
/** Cheap car (20 tris) centered at (x,z), nose toward +Z rotated by rot. */
export function car(b: ModelBuilder, x: number, z: number, rot: number, color: ColorLike, y = 0.06, big = false) {
  b.push().translate(x, y, z).rotateY(rot);
  const L = big ? 2.45 : 2.25, W = big ? 0.98 : 0.9;
  b.paint(color, Surf.Metal).box(-W, 0.12, -L, W, big ? 1.0 : 0.85, L);
  b.paint(0x1d232b, Surf.Metal).box(-W + 0.1, big ? 1.0 : 0.85, -L * 0.52, W - 0.1, big ? 1.72 : 1.36, L * (big ? 0.62 : 0.4), { top: P(color, Surf.Metal) });
  b.pop();
}
/** Box truck / delivery truck (~30 tris), nose +Z. */
export function truck(b: ModelBuilder, x: number, z: number, rot: number, cab: ColorLike, cargo: ColorLike, long = 8) {
  b.push().translate(x, 0, z).rotateY(rot);
  const hl = long / 2;
  b.paint(cargo, Surf.Plain).box(-1.25, 0.9, -hl, 1.25, 3.7, hl - 2.3);
  b.paint(cab, Surf.Metal).box(-1.2, 0.35, hl - 2.2, 1.2, 2.7, hl);
  faceZ(b, -1.0, 1.0, 1.6, 2.5, hl + 0.02, metal(0x1d232b));
  b.paint(0x1a1a1a, Surf.Plain).box(-1.15, 0.0, -hl + 0.5, 1.15, 0.9, -hl + 2.2, { top: null }).box(-1.15, 0, hl - 2.0, 1.15, 0.35, hl - 0.6, { top: null });
  b.pop();
}
/** Asphalt surface quad. */
export function asphalt(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y = 0.06, color: ColorLike = C.asphalt) {
  up(b, x0, z0, x1, z1, y, pav(color));
}
/**
 * Row of parking stalls side by side along X (stall depth along Z starting at z0). nose: +1 cars face +Z.
 * Stripe quads + cars (fill = probability). Returns stall count.
 */
export function stallsX(b: ModelBuilder, rng: RNG, x0: number, x1: number, z0: number, nose: 1 | -1, fill: number, y = 0.06, depth = 5.2, pitch = 2.7, lineColor: ColorLike = C.line): number {
  const n = Math.floor((x1 - x0) / pitch);
  const off = x0 + (x1 - x0 - n * pitch) / 2;
  const lp = plain(lineColor);
  for (let i = 0; i <= n; i++) {
    const sx = off + i * pitch;
    up(b, sx - 0.07, z0, sx + 0.07, z0 + depth, y + 0.02, lp);
  }
  for (let i = 0; i < n; i++) {
    if (!rng.chance(fill)) continue;
    car(b, off + (i + 0.5) * pitch + rng.range(-0.12, 0.12), z0 + depth / 2 + nose * rng.range(-0.1, 0.35), nose > 0 ? rng.range(-0.04, 0.04) : Math.PI + rng.range(-0.04, 0.04), rng.pick(CAR_COLORS), y, rng.chance(0.2));
  }
  return n;
}
/** Row of stalls side by side along Z (stall depth along X starting at x0). nose: +1 cars face +X. */
export function stallsZ(b: ModelBuilder, rng: RNG, z0: number, z1: number, x0: number, nose: 1 | -1, fill: number, y = 0.06, depth = 5.2, pitch = 2.7, lineColor: ColorLike = C.line): number {
  const n = Math.floor((z1 - z0) / pitch);
  const off = z0 + (z1 - z0 - n * pitch) / 2;
  const lp = plain(lineColor);
  for (let i = 0; i <= n; i++) {
    const sz = off + i * pitch;
    up(b, x0, sz - 0.07, x0 + depth, sz + 0.07, y + 0.02, lp);
  }
  for (let i = 0; i < n; i++) {
    if (!rng.chance(fill)) continue;
    car(b, x0 + depth / 2 + nose * rng.range(-0.1, 0.35), off + (i + 0.5) * pitch + rng.range(-0.12, 0.12), nose > 0 ? Math.PI / 2 : -Math.PI / 2, rng.pick(CAR_COLORS), y, rng.chance(0.2));
  }
  return n;
}
/** Parking-lot light pole with 1-2 emissive heads (~28 tris). */
export function lotLamp(b: ModelBuilder, x: number, z: number, h = 7.5, dirs: number[] = [0], pool = true) {
  box(b, x - 0.1, 0, z - 0.1, x + 0.1, h, z + 0.1, metal(0x4a4d52), null);
  for (const a of dirs) {
    b.push().translate(x, h, z).rotateY(a);
    box(b, -0.25, -0.05, 0.05, 0.25, 0.12, 1.3, metal(0x4a4d52), emis(0xfff0cc), { bottom: emis(0xfff0cc) });
    b.pop();
    if (pool) lightPool(b, x + Math.sin(a) * 1.2, z + Math.cos(a) * 1.2, h * 0.6);
  }
}
/** Faint emissive light pool on the ground (octagon, 6 tris) — nearly invisible by day, glows at night. */
export function lightPool(b: ModelBuilder, x: number, z: number, r: number, y = 0.075, color: ColorLike = 0x393a3d) {
  const pts = ngonPts(x, z, r, 8, Math.PI / 8);
  b.paint(color, Surf.Emissive);
  for (let i = 1; i < 7; i++) b.tri([pts[0][0], y, pts[0][1]], [pts[i + 1][0], y, pts[i + 1][1]], [pts[i][0], y, pts[i][1]]);
}

// ---------------------------------------------------------------------------------------------- landscaping & props
export const TREE_GREENS = [0x4f7a32, 0x5a8a3a, 0x3f6b2e, 0x6b8f3a, 0x4a7d3f];
/** Cheap deciduous tree (28 tris). */
export function tree(b: ModelBuilder, rng: RNG, x: number, z: number, s = 1, color?: ColorLike) {
  const k = s * rng.range(0.85, 1.15);
  box(b, x - 0.14 * k, 0, z - 0.14 * k, x + 0.14 * k, 2.3 * k, z + 0.14 * k, P(C.trunk, Surf.Wood), null);
  b.paint(color ?? rng.pick(TREE_GREENS), Surf.Foliage).blob(x, 3.5 * k, z, 1.9 * k, 1.75 * k, 1.9 * k, 0, 0.16, rng.next() * 10);
}
/** Columnar / cypress-like tree (18 tris). */
export function coneTree(b: ModelBuilder, rng: RNG, x: number, z: number, s = 1) {
  const k = s * rng.range(0.85, 1.15);
  b.paint(0x2f5a2e, Surf.Foliage).cylinder(x, z, 0.3, 5.5 * k, 1.1 * k, 0.1, 6, { top: false });
}
/** Palm tree (~30 tris). */
export function palm(b: ModelBuilder, rng: RNG, x: number, z: number, s = 1) {
  const k = s * rng.range(0.85, 1.15);
  const h = 7 * k;
  b.paint(0x7a6446, Surf.Wood).cylinder(x, z, 0, h, 0.22 * k, 0.16 * k, 5, { top: false });
  b.paint(0x4d7d34, Surf.Foliage);
  const a0 = rng.next() * 6.28;
  for (let i = 0; i < 5; i++) {
    const a = a0 + (i / 5) * Math.PI * 2;
    const ex = x + Math.cos(a) * 2.6 * k, ez = z + Math.sin(a) * 2.6 * k;
    const px = -Math.sin(a) * 0.45 * k, pz = Math.cos(a) * 0.45 * k;
    b.quad2([x, h, z], [x + px, h + 0.2, z + pz], [ex, h - 1.2 * k, ez], [x - px, h + 0.2, z - pz]);
  }
}
/** Shrub blob (20 tris). */
export function shrub(b: ModelBuilder, rng: RNG, x: number, z: number, r = 0.8, color?: ColorLike) {
  b.paint(color ?? rng.pick([0x3f6b2e, 0x4d7a36, 0x5b8a3c]), Surf.Foliage).blob(x, r * 0.6, z, r, r * 0.75, r, 0, 0.18, rng.next() * 10);
}
/** Planter box with greenery (12 tris), optional tree. */
export function planter(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, h = 0.6, edge: ColorLike = C.concrete, withTree = false) {
  box(b, x0, 0, z0, x1, h, z1, plain(edge), foliage(rng.pick([0x4d7a36, 0x5b8a3c, 0x46703a])));
  if (withTree) tree(b, rng, (x0 + x1) / 2, (z0 + z1) / 2, 0.8);
}
/** Market / patio umbrella with table (22 tris). */
export function umbrella(b: ModelBuilder, x: number, z: number, r: number, color: ColorLike, h = 2.5, tableColor: ColorLike = 0xe8e4dc) {
  box(b, x - 0.05, 0, z - 0.05, x + 0.05, h, z + 0.05, metal(0xdddddd), null);
  b.paint(color, Surf.Plain).pyramid(x, z, r * 2, r * 2, h - 0.45, 0.6);
  b.paint(color, Surf.Plain).quad([x - r, h - 0.45, z - r], [x + r, h - 0.45, z - r], [x + r, h - 0.45, z + r], [x - r, h - 0.45, z + r]);
  box(b, x - 0.45, 0.7, z - 0.45, x + 0.45, 0.76, z + 0.45, plain(tableColor), undefined, { bottom: plain(tableColor) });
}
/** Dumpster (12 tris). */
export function dumpster(b: ModelBuilder, x: number, z: number, color: ColorLike = 0x2f5d3a, rotY = 0) {
  b.push().translate(x, 0, z).rotateY(rotY);
  box(b, -1.0, 0, -0.75, 1.0, 1.25, 0.75, metal(color), plain(0x2a2a2a));
  b.pop();
}
/** Rooftop HVAC box with dark fan (12 tris). */
export function ac(b: ModelBuilder, x: number, y: number, z: number, s = 1, color: ColorLike = 0xa9adb1) {
  box(b, x - 0.9 * s, y, z - 0.7 * s, x + 0.9 * s, y + 0.9 * s, z + 0.7 * s, metal(color));
  up(b, x - 0.5 * s, z - 0.45 * s, x + 0.5 * s, z + 0.45 * s, y + 0.9 * s + 0.01, metal(0x2e3134));
}
/** Scatter AC units / vents / hatch on a flat roof rect. */
export function roofJunk(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, y: number, n = 3, hut = true) {
  const w = x1 - x0, d = z1 - z0;
  if (w < 3 || d < 3) return;
  for (let i = 0; i < n; i++) ac(b, rng.range(x0 + 1.2, x1 - 1.2), y, rng.range(z0 + 1.0, z1 - 1.0), rng.range(0.7, 1.25));
  if (hut && w > 7 && d > 6) {
    const hx = rng.range(x0 + 1, x1 - 4), hz = rng.range(z0 + 1, z1 - 3.5);
    box(b, hx, y, hz, hx + 2.8, y + 2.5, hz + 2.4, plain(0xb0aca3), roofP(0x77777a));
  }
}
/** Red aviation beacon (emissive box, 10 tris). */
export function beacon(b: ModelBuilder, x: number, y: number, z: number, s = 0.45, color: ColorLike = 0xff2a1a) {
  box(b, x - s, y, z - s, x + s, y + s * 1.6, z + s, emis(color));
}
/** Tapered 4-sided mast / spire (8 tris) + optional beacon. */
export function mast(b: ModelBuilder, x: number, z: number, y0: number, h: number, r0: number, r1: number, p: Paint, withBeacon = true) {
  loft(b, rectPts(x - r0, z - r0, x + r0, z + r0), rectPts(x - r1, z - r1, x + r1, z + r1), y0, y0 + h, p, null);
  if (withBeacon) beacon(b, x, y0 + h, z, Math.max(0.25, r1 * 1.6));
}
/** Round fountain with basin and jet (~44 tris). */
export function fountain(b: ModelBuilder, x: number, z: number, r: number, stone: ColorLike = 0xd4cbb8) {
  b.paint(stone, Surf.Stone).cylinder(x, z, 0, 0.6, r, r, 12, { top: true, topPaint: P(C.water, Surf.Water), smooth: false });
  b.paint(stone, Surf.Stone).cylinder(x, z, 0.5, 0.9, r * 0.18, r * 0.12, 6, { top: true, smooth: false });
  b.paint(0xcfe8f5, Surf.Water).cylinder(x, z, 1.4, 1.0, r * 0.1, 0.02, 5, { top: false });
}
/** Angled facade flag on the +Z plane at (x, y): pole leaning out + flag (12 tris). */
export function facadeFlag(b: ModelBuilder, x: number, y: number, z: number, color: ColorLike, len = 2.6) {
  b.paint(0xd8d8d8, Surf.Metal).beam([x, y, z], [x, y + len * 0.55, z + len * 0.85], 0.08);
  const tx = x, ty = y + len * 0.55, tz = z + len * 0.85;
  b.paint(color, Surf.Plain).quad2([tx, ty, tz], [tx, ty - 1.6, tz], [tx, ty - 1.6 - len * 0.2, tz - len * 0.32], [tx, ty - len * 0.2, tz - len * 0.32]);
}
/** Vertical flag pole on the ground (19 tris). */
export function flag(b: ModelBuilder, x: number, z: number, h: number, color: ColorLike) {
  box(b, x - 0.06, 0, z - 0.06, x + 0.06, h, z + 0.06, metal(0xdadada));
  b.paint(color, Surf.Plain).quad2([x + 0.06, h - 0.15, z], [x + 2.1, h - 0.25, z], [x + 2.1, h - 1.5, z], [x + 0.06, h - 1.4, z]);
}

/** Round up height so it's k floors of f above base (helper for window alignment). */
export function floorsTop(base: number, floors: number, f: number): number {
  return base + floors * f;
}
