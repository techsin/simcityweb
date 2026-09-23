/**
 * Commercial high-density models: hotel tower, office tower, skyscraper, megatower.
 * Towers are modeled as massing (boxes, lofts, stacked rotated slabs) with GlassCurtain / WallWindows surfaces;
 * crowns, spires, fins, diagrids, beacons and light bands are real geometry (emissive glows at night).
 */
import { ModelBuilder, type Paint } from '../ModelBuilder';
import type { ModelBuildFn } from '../registry';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { pool, bench } from '../kit';
import * as K from './com_kit';
import { P, C, box, up, down, faceZ, type V2, type V3 } from './com_kit';

type B = ModelBuilder;
const WW = (color: number, pattern: number, floor: number): Paint => P(color, Surf.WallWindows, pattern, floor);
const GC = (tint: number, floor: number): Paint => P(0x8899aa, Surf.GlassCurtain, tint, floor);
const ROOF = K.roofP(0x6f7174);

// ---------------------------------------------------------------------------------------------- local helpers
/** Prism with a planar (sloped) top: yTop(x,z) must be linear. */
function prismSloped(b: B, pts: V2[], y0: number, yTop: (x: number, z: number) => number, side: Paint, cap: Paint | null) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; }
  if (a < 0) pts = pts.slice().reverse();
  const n = pts.length;
  b.paint(side);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    b.quad([xi, y0, zi], [xi, yTop(xi, zi), zi], [xj, yTop(xj, zj), zj], [xj, y0, zj]);
  }
  if (cap) {
    b.paint(cap);
    for (let i = 1; i < n - 1; i++) b.tri([pts[0][0], yTop(pts[0][0], pts[0][1]), pts[0][1]], [pts[i + 1][0], yTop(pts[i + 1][0], pts[i + 1][1]), pts[i + 1][1]], [pts[i][0], yTop(pts[i][0], pts[i][1]), pts[i][1]]);
  }
}
/** Diagonal grid strips on a +Z facing plane z (x0..x1, y0..y1). Module W wide, H tall, strip width t. */
function diagridZ(b: B, x0: number, x1: number, y0: number, y1: number, z: number, W: number, H: number, t: number, p: Paint) {
  const k = W / H;
  b.paint(p);
  for (const dir of [1, -1]) {
    const span = (y1 - y0) * k;
    for (let c = x0 - span - W; c <= x1 + span + W; c += W) {
      // x(y) = c + dir * (y - y0) * k
      let ya = y0, yb = y1;
      const yAt = (x: number) => y0 + ((x - c) * dir) / k;
      const ylo = Math.min(yAt(x0), yAt(x1)), yhi = Math.max(yAt(x0), yAt(x1));
      ya = Math.max(ya, ylo); yb = Math.min(yb, yhi);
      if (yb - ya < 0.5) continue;
      const xa = c + dir * (ya - y0) * k, xb = c + dir * (yb - y0) * k;
      const h = t / 2;
      b.quad([Math.max(x0, xa - h), ya, z], [Math.min(x1, xa + h), ya, z], [Math.min(x1, xb + h), yb, z], [Math.max(x0, xb - h), yb, z]);
    }
  }
}
/** Diagrid on all four faces of an axis aligned box. */
function diagridBox(b: B, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, W: number, H: number, t: number, p: Paint, off = 0.12) {
  diagridZ(b, x0, x1, y0, y1, z1 + off, W, H, t, p);
  K.onSide(b, 'nz', () => diagridZ(b, -x1, -x0, y0, y1, -z0 + off, W, H, t, p));
  K.onSide(b, 'px', () => diagridZ(b, -z1, -z0, y0, y1, x1 + off, W, H, t, p));
  K.onSide(b, 'nx', () => diagridZ(b, z0, z1, y0, y1, -x0 + off, W, H, t, p));
}
/** Vertical fins (double-sided quads) along +Z face at z from x0..x1 every `step`. */
function finsZ(b: B, x0: number, x1: number, step: number, y0: number, y1: number, z: number, depth: number, p: Paint) {
  b.paint(p);
  for (let x = x0; x <= x1 + 1e-3; x += step) b.quad2([x, y0, z], [x, y0, z + depth], [x, y1, z + depth], [x, y1, z]);
}
function finsX(b: B, z0: number, z1: number, step: number, y0: number, y1: number, x: number, depth: number, p: Paint) {
  b.paint(p);
  for (let z = z0; z <= z1 + 1e-3; z += step) b.quad2([x, y0, z], [x + depth, y0, z], [x + depth, y1, z], [x, y1, z]);
}
/** Stone piers on the +Z face. */
function piersZ(b: B, x0: number, x1: number, step: number, y0: number, y1: number, z: number, p: Paint, w = 0.5, d = 0.35) {
  for (let x = x0; x <= x1 + 1e-3; x += step) box(b, x - w / 2, y0, z, x + w / 2, y1, z + d, p, undefined, { nz: null });
}
function piersX(b: B, z0: number, z1: number, step: number, y0: number, y1: number, x: number, p: Paint, w = 0.5, d = 0.35) {
  for (let z = z0; z <= z1 + 1e-3; z += step) box(b, x, y0, z - w / 2, x + d, y1, z + w / 2, p, undefined, { nx: null });
}
/** Paved plaza over the lot front with trees (and optional lawn edge). */
function plaza(b: B, rng: RNG, X: number, Z: number, zb: number, o: { trees?: V2[]; color?: number; lawn?: boolean } = {}) {
  up(b, -X, -Z, X, Z, 0.03, K.pav(o.color ?? C.plaza));
  if (o.lawn) {
    up(b, -X, zb + 3, -X + 5, Z - 1.5, 0.07, K.foliage(C.grass));
    up(b, X - 5, zb + 3, X, Z - 1.5, 0.07, K.foliage(C.grass));
  }
  for (const [x, z] of o.trees ?? []) {
    K.planter(b, rng, x - 1.0, z - 1.0, x + 1.0, z + 1.0, 0.45, 0x8e8b84);
    K.tree(b, rng, x, z, 0.85);
  }
}
/** Rotated rect box (slab) about (cx, cz). */
function rotSlab(b: B, cx: number, cz: number, hw: number, hd: number, y0: number, y1: number, ang: number, side: Paint, top: Paint | null) {
  b.push().translate(cx, 0, cz).rotateY(ang);
  box(b, -hw, y0, -hd, hw, y1, hd, side, top);
  b.pop();
}
function beacons4(b: B, x0: number, z0: number, x1: number, z1: number, y: number, s = 0.45) {
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]] as V2[]) K.beacon(b, x, y, z, s);
}

// ============================================================================================ HOTEL TOWER (3x3)
function htOval(b: B, rng: RNG) {
  plaza(b, rng, 24, 24, 3.2, { color: 0xd6cfc0 });
  const px0 = -22.4, px1 = 22.4, pz0 = -22.4, pz1 = 3.2;
  box(b, px0, 0, pz0, px1, 4, pz1, P(0xd8ccb4, Surf.Stone), null);
  box(b, px0, 4, pz0, px1, 12, pz1, WW(0xe2d6bc, 7, 4), null);
  K.cornice(b, px0, pz0, px1, pz1, 12, 0.6, 0.3, P(0xece2cc, Surf.Stone), ROOF);
  for (let x = px0 + 1.6; x + 4.4 < px1; x += 6.4) if (Math.abs(x + 2.2) > 8) K.storefront(b, x, x + 4.4, pz1, { y0: 0.5, y1: 3.4, frame: 0x6b4a2a, pitch: 2.2 });
  K.storefront(b, -6.4, 6.4, pz1, { y0: 0.05, y1: 3.6, frame: 0xc9a24a, doors: [-2, 2], doorW: 2, pitch: 2.1 });
  // oval tower
  const cz = -9.4;
  const ell = K.ngonPts(0, cz, 13.5, 16, 0, 9.0);
  const top = 117;
  K.prismPts(b, ell, 12.6, top, GC(2, 3.5), null);
  for (let y = 47.6; y < top - 5; y += 35) K.bandPts(b, ell, y, y + 0.7, K.metal(0xc9a24a), 0.15);
  const ell2 = K.scalePts(ell, 0.86, 0.8, 0, cz);
  K.loft(b, ell, ell2, top, top + 7, K.emis(0x7a5a24), null);
  for (let i = 0; i < 16; i += 2) b.paint(0xffe0a0, Surf.Emissive).beam([ell[i][0] * 1.01, top + 0.6, cz + (ell[i][1] - cz) * 1.01], [ell2[i][0] * 1.01, top + 7, cz + (ell2[i][1] - cz) * 1.01], 0.35);
  K.bandPts(b, ell, top - 0.3, top + 0.6, K.emis(0xffd88a), 0.2);
  K.bandPts(b, ell2, top + 6.2, top + 7.0, K.emis(0xffd88a), 0.15);
  K.prismPts(b, K.scalePts(ell2, 0.97, 0.97, 0, cz), top + 7, top + 7.2, K.metal(0xc9a24a), ROOF);
  K.mast(b, 0, cz, top + 7.2, 12, 0.35, 0.08, K.metal(0xd8d8d8));
  // pool deck on podium
  b.push().translate(0, 12, 0);
  pool(b, 14.5, -2.5, 9, 5);
  for (const lx of [11, 13, 15, 17]) box(b, lx - 0.35, 0.14, -7.6, lx + 0.35, 0.45, -6.0, K.plain(0xf4f4f0));
  K.umbrella(b, 19.5, -8.5, 1.2, 0xf2efe6, 2.4);
  K.umbrella(b, -17, -2, 1.2, 0xf2efe6, 2.4);
  up(b, -20, -20, -14, -4, 0.05, K.foliage(0x6f9a45));
  b.pop();
  // porte-cochere + drive loop
  box(b, -9, 5.2, pz1, 9, 6.0, pz1 + 7.5, K.plain(0xf2eee4), ROOF, { bottom: K.emis(0xe8e0cc), nz: null });
  K.bandRect(b, -9, pz1, 9, pz1 + 7.5, 5.35, 5.8, K.emis(0xffd88a), 0.05);
  for (const cx of [-8.4, 8.4]) box(b, cx - 0.35, 0, pz1 + 6.6, cx + 0.35, 5.2, pz1 + 7.3, K.plain(0xece2cc), null);
  K.letters(b, rng, 0, 6.05, pz1 + 7.2, 12, 1.0, 0xffe6b0, { words: 1, n: 7 });
  K.asphalt(b, -13, pz1 + 0.5, 13, 21, 0.05, 0x4a4b4e);
  b.paint(C.grass, Surf.Foliage).cylinder(0, 15.5, 0, 0.12, 5, 5, 12, { smooth: false });
  K.fountain(b, 0, 15.5, 3.0);
  K.car(b, -3, pz1 + 3.8, Math.PI / 2, 0x1e1e1e, 0.06, true);
  K.car(b, 4.5, pz1 + 3.8, Math.PI / 2, 0xe8e8e8);
  for (const fx of [-18, -15, 15, 18]) K.flag(b, fx, 21.5, 10, [0x1d3a6b, 0xc9a24a, 0xc9a24a, 0x1d3a6b][(fx + 18) / 11 | 0]);
  for (const tx of [-20, 20]) for (const tz of [8, 14]) K.palm(b, rng, tx, tz, 0.9);
}
function htDeco(b: B, rng: RNG) {
  plaza(b, rng, 24, 24, 6.6, { color: 0xd3cbbb, trees: [[-19, 17], [19, 17]] });
  const ww = WW(0xd9c6a0, 1, 3.3);
  const stone = P(0xc9b48c, Surf.Stone);
  box(b, -22, 0, -22, 22, 6.6, 6.6, stone, null);
  box(b, -22, 6.6, -22, 22, 13.2, 6.6, ww, ROOF);
  K.cornice(b, -22, -22, 22, 6.6, 13.2, 0.5, 0.3, P(0xe2d2b0, Surf.Stone), null);
  box(b, -15.4, 13.2, -17.6, 15.4, 69.3, 4.4, ww, ROOF);
  box(b, -11, 69.3, -13.2, 11, 99, 0, ww, ROOF);
  box(b, -6.6, 99, -11, 6.6, 118.8, -2.2, ww, null);
  const pier = P(0xe6d8b8, Surf.Stone);
  piersZ(b, -15.4, 15.4, 4.4, 13.2, 70, 4.4, pier);
  piersZ(b, -11, 11, 4.4, 69.3, 99.6, 0, pier);
  piersX(b, -17.6, 4.4, 4.4, 13.2, 70, 15.4, pier);
  // pyramid crown with lit hips
  const cy = 118.8, ch = 13;
  box(b, -7.2, cy, -11.6, 7.2, cy + 0.8, -1.6, pier);
  b.paint(0x5f9a86, Surf.Metal).pyramid(0, -6.6, 13.2, 8.8, cy + 0.8, ch);
  const apex: V3 = [0, cy + 0.8 + ch, -6.6];
  for (const [x, z] of [[-6.6, -11], [6.6, -11], [6.6, -2.2], [-6.6, -2.2]] as V2[]) b.paint(0xffd88a, Surf.Emissive).beam([x, cy + 0.8, z], apex, 0.3);
  for (const y of [69.3, 99, cy + 0.8]) K.bandRect(b, y === 69.3 ? -15.4 : y === 99 ? -11 : -7.2, y === 69.3 ? -17.6 : y === 99 ? -13.2 : -11.6, y === 69.3 ? 15.4 : y === 99 ? 11 : 7.2, y === 69.3 ? 4.4 : y === 99 ? 0 : -1.6, y - 0.6, y, K.emis(0xffd88a), 0.4);
  K.mast(b, 0, -6.6, apex[1], 9, 0.25, 0.05, K.metal(0xd8d8d8));
  // entrance
  K.storefront(b, -4.4, 4.4, 6.6, { y0: 0.05, y1: 5.4, frame: 0xc9a24a, doors: [-1.5, 1.5], doorW: 1.8, transom: 3.4 });
  for (let x = -19.8; x < 19; x += 4.4) if (Math.abs(x + 1.8) > 6) K.storefront(b, x, x + 3.2, 6.6, { y0: 0.6, y1: 5.0, frame: 0x2a2320, pitch: 1.6, transom: 3.6 });
  box(b, -8, 4.6, 6.6, 8, 5.4, 13, K.metal(0x2a2a2a), ROOF, { bottom: K.emis(0xfff0cc), nz: null });
  faceZ(b, -8, 8, 4.7, 5.3, 13.02, K.emis(0xffd88a));
  K.letters(b, rng, 0, 5.45, 12.7, 11, 1.1, 0xffd88a, { words: 1, n: 6 });
  for (const cx of [-7.5, 7.5]) box(b, cx - 0.2, 0, 12.3, cx + 0.2, 4.6, 12.7, K.metal(0xc9a24a), null);
  K.bladeSign(b, 15.4, 4.4, 30, 22, 1.8, 0xff4f6a, 0x2a2a2a);
  K.car(b, 2, 9.8, Math.PI / 2, 0xe0b020);
}
function htSail(b: B, rng: RNG) {
  plaza(b, rng, 24, 24, 2, { color: 0xe0d9cc });
  // low podium
  box(b, -22, 0, -22, 22, 9, 2, K.plain(0xeeebe4), ROOF);
  K.storefront(b, -20, 20, 2, { y0: 0.2, y1: 8.2, frame: 0xbfc5ca, doors: [-2, 2], doorW: 2.2, pitch: 2.5, transom: 4.2, surround: 0 });
  // D-shaped sail tower tapering upward
  const bz = -21, rx = 16, rz = 21;
  const sec = (t: number): V2[] => {
    const sx = 1 - 0.5 * Math.pow(t, 1.6), sz = 1 - 0.35 * t;
    const pts: V2[] = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; pts.push([Math.cos(a) * rx * sx, bz + Math.sin(a) * rz * sz]); }
    return pts;
  };
  const H = 138, segs = 6;
  for (let s = 0; s < segs; s++) {
    const t0 = s / segs, t1 = (s + 1) / segs;
    K.loft(b, sec(t0), sec(t1), 9 + t0 * (H - 9), 9 + t1 * (H - 9), GC(5, 3.6), s === segs - 1 ? ROOF : null);
  }
  for (let s = 1; s < segs; s++) { const t = s / segs; K.bandPts(b, sec(t), 9 + t * (H - 9) - 0.5, 9 + t * (H - 9) + 0.4, K.plain(0xf4f4f0), 0.12); }
  // LED strip up the sail apex (front)
  for (let s = 0; s < segs; s++) {
    const t0 = s / segs, t1 = (s + 1) / segs;
    const za = bz + rz * (1 - 0.35 * t0) + 0.12, zb = bz + rz * (1 - 0.35 * t1) + 0.12;
    b.paint(0x7fd8ff, Surf.Emissive).quad([-0.9, 9 + t0 * (H - 9), za], [0.9, 9 + t0 * (H - 9), za], [0.9, 9 + t1 * (H - 9), zb], [-0.9, 9 + t1 * (H - 9), zb]);
  }
  // back exoskeleton mast
  const mw = K.plain(0xf4f4f0);
  b.paint(mw).beam([-14, 9, bz - 0.8], [-1.5, H + 14, bz - 0.8], 1.6).beam([14, 9, bz - 0.8], [1.5, H + 14, bz - 0.8], 1.6);
  K.mast(b, 0, bz - 0.8, H + 14, 8, 0.6, 0.1, K.metal(0xe0e0e0));
  // helipad disk
  b.paint(0xf4f4f0, Surf.Plain).cylinder(0, bz + 5, H - 2, 0.6, 5.5, 5.5, 12, { smooth: false, topPaint: K.plain(0x3a7a5a), bottom: true });
  K.bandPts(b, K.ngonPts(0, bz + 5, 5.5, 12), H - 1.9, H - 1.5, K.emis(0x6fff9a), 0.05);
  // entrance canopy & water feature
  box(b, -7, 6, 2, 7, 6.8, 9, K.plain(0xf4f4f0), ROOF, { bottom: K.emis(0xeaf4ff), nz: null });
  K.letters(b, rng, 0, 6.9, 8.6, 10, 1.1, 0x7fd8ff, { words: 1, n: 6 });
  b.paint(0x3f8fb8, Surf.Water).box(-20, 0, 12, -6, 0.25, 21);
  b.paint(0x3f8fb8, Surf.Water).box(6, 0, 12, 20, 0.25, 21);
  for (const fx of [-16, -10, 10, 16]) b.paint(0xd8f0ff, Surf.Water).cylinder(fx, 16.5, 0.2, 2.4, 0.25, 0.05, 5, { top: false });
  for (const tx of [-21.5, 21.5]) for (const tz of [6, 13, 20]) K.palm(b, rng, tx, tz, 0.85);
}
const hotelTower: ModelBuildFn = (b, v, rng) => [htOval, htDeco, htSail][v % 3](b, rng);

// ============================================================================================ OFFICE TOWER (2x2)
function otGlassBox(b: B, rng: RNG) {
  plaza(b, rng, 16, 16, 7.5, { trees: [[-12.5, 12], [12.5, 12]] });
  const x0 = -12, x1 = 12, z0 = -13.5, z1 = 7.5, base = 5.7, top = 100.7;
  box(b, -10.5, 0, -12, 10.5, base, 6, P(0x2a3440, Surf.GlassPlain), null);
  K.storefront(b, -9.9, 9.9, 6, { y0: 0.05, y1: 5.3, frame: 0x55595f, doors: [-1.5, 1.5], pitch: 3.3, transom: 3.2, surround: 0 });
  for (const [cx, cz] of [[x0 + 0.5, z1 - 0.5], [x1 - 0.5, z1 - 0.5], [0, z1 - 0.5]] as V2[]) box(b, cx - 0.5, 0, cz - 0.5, cx + 0.5, base, cz + 0.5, K.metal(0x9aa2aa), null);
  box(b, x0, base, z0, x1, top, z1, GC(0, 3.8), ROOF, { bottom: K.plain(0x55595f) });
  K.bandRect(b, x0, z0, x1, z1, top, top + 3.8, K.metal(0x8a9096), 0.0);
  K.bandRect(b, x0, z0, x1, z1, top + 2.4, top + 3.8, K.emis(0xdff1ff), 0.05);
  box(b, -6, top, -8, 3, top + 3.0, -1, K.plain(0x8a8f94), ROOF);
  K.mast(b, 4.5, -6, top, 18, 0.35, 0.08, K.metal(0xcccccc));
  beacons4(b, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, top + 3.8, 0.35);
  K.canopy(b, -4, 4, 6, 4.4, 3.2, 0.3, K.metal(0xc3c8cd), K.emis(0xeaf4ff));
  K.letters(b, rng, 0, 1.0, 14.8, 5, 0.6, 0xeaf4ff, { words: 1 });
  box(b, -3, 0, 14.5, 3, 1.8, 14.9, K.plain(0x3a3e44));
}
function otStone(b: B, rng: RNG) {
  plaza(b, rng, 16, 16, 7.5, { color: 0xd3cbbb, trees: [[-12.5, 12.5], [12.5, 12.5]] });
  const x0 = -12, x1 = 12, z0 = -12, z1 = 7.5, base = 7.6, top = 83.6;
  const stone = P(0xb9a888, Surf.Stone);
  box(b, x0, 0, z0, x1, base, z1, stone, null);
  box(b, x0, base, z0, x1, top, z1, WW(0xc8b89a, 5, 3.8), null);
  const pier = P(0xd4c6a8, Surf.Stone);
  piersZ(b, x0, x1, 6, base, top, z1, pier, 0.7, 0.4);
  piersX(b, z0, z1, 6.5, base, top, x1, pier, 0.7, 0.4);
  for (let x = x0 + 1; x + 4 < x1; x += 6) K.storefront(b, x + 0.5, x + 4.5, z1, { y0: 0.05, y1: 6.2, frame: 0x2a2320, doors: Math.abs(x + 3) < 1 ? [x + 2.5] : [], pitch: 2, transom: 4.0 });
  K.cornice(b, x0, z0, x1, z1, top, 0.9, 0.8, pier, null);
  box(b, x0 + 0.5, top + 0.9, z0 + 0.5, x1 - 0.5, top + 4.7, z1 - 0.5, WW(0xc8b89a, 4, 3.8), ROOF);
  K.cornice(b, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, top + 4.7, 0.5, 0.4, pier);
  K.bandRect(b, x0, z0, x1, z1, top - 1.4, top, K.emis(0xffe2b0), 0.42);
  up(b, x0 + 0.2, z0 + 0.2, x1 - 0.2, z1 - 0.2, top + 5.21, ROOF);
  b.push().translate(0, top + 5.2, 0);
  K.flag(b, 0, -2, 8, 0x2e6fb5);
  b.pop();
  K.roofJunk(b, rng, x0 + 2, z0 + 2, x1 - 2, z1 - 3, top + 5.2, 3, true);
}
function otDeco(b: B, rng: RNG) {
  plaza(b, rng, 16, 16, 8.8, { color: 0xd3cbbb });
  const ww = WW(0xd0bf9c, 1, 3.6);
  const stone = P(0xa8987a, Surf.Stone);
  box(b, -13.2, 0, -13.2, 13.2, 7.2, 8.8, stone, null);
  box(b, -13.2, 7.2, -13.2, 13.2, 43.2, 8.8, ww, ROOF);
  box(b, -11, 43.2, -11, 11, 72, 6.6, ww, ROOF);
  box(b, -6.6, 72, -6.6, 6.6, 93.6, 2.2, ww, ROOF);
  const pier = P(0xe2d4b4, Surf.Stone);
  piersZ(b, -11, 11, 4.4, 7.2, 44, 8.8, pier);
  piersZ(b, -8.8, 8.8, 4.4, 43.2, 72.8, 6.6, pier);
  piersX(b, -11, 6.6, 4.4, 7.2, 44, 13.2, pier);
  box(b, -5.5, 93.6, -5.5, 5.5, 97.2, 1.1, pier, ROOF);
  box(b, -4.4, 97.2, -4.4, 4.4, 100.8, 0, pier, ROOF);
  box(b, -2.2, 100.8, -3.3, 2.2, 104.4, -1.1, pier, ROOF);
  for (let x = -4.4; x <= 4.41; x += 2.2) { faceZ(b, x - 0.2, x + 0.2, 93.8, 97.0, 1.12, K.emis(0xffd88a)); }
  for (let x = -3.3; x <= 3.31; x += 2.2) faceZ(b, x - 0.2, x + 0.2, 97.4, 100.6, 0.02, K.emis(0xffd88a));
  K.bandRect(b, -6.6, -6.6, 6.6, 2.2, 92.9, 93.6, K.emis(0xffd88a), 0.06);
  K.mast(b, 0, -2.2, 104.4, 20, 0.35, 0.05, K.metal(0xd0d0d0));
  K.storefront(b, -3.3, 3.3, 8.8, { y0: 0.05, y1: 6.2, frame: 0xc9a24a, doors: [-1.2, 1.2], doorW: 1.8, transom: 3.8 });
  for (const sx of [-9.9, 6.6]) K.storefront(b, sx, sx + 3.3, 8.8, { y0: 0.6, y1: 5.6, frame: 0x2a2320, pitch: 1.65, transom: 3.8 });
  box(b, -4.4, 4.4, 8.8, 4.4, 5.0, 12, K.metal(0x2a2a2a), ROOF, { bottom: K.emis(0xfff0cc), nz: null });
  K.letters(b, rng, 0, 5.05, 11.8, 7, 0.8, 0xffd88a, { words: 1 });
  for (const tx of [-12.5, 12.5]) K.tree(b, rng, tx, 12.8, 0.8);
}
function otTwisted(b: B, rng: RNG) {
  plaza(b, rng, 16, 16, 7.5, { trees: [[-13, 12.5], [13, 12.5], [-13, -13]] });
  const cz = -3;
  K.prismPts(b, K.ngonPts(0, cz, 8.4, 8, Math.PI / 8), 0, 5, P(0x2a3440, Surf.GlassPlain), K.roofP(0x9a9a9a));
  const n = 30, fh = 3.8, y0 = 5;
  for (let i = 0; i < n; i++) {
    const a = (i * 2.6 * Math.PI) / 180;
    rotSlab(b, 0, cz, 9, 9, y0 + i * fh, y0 + (i + 1) * fh, a, GC(1, fh), ROOF);
  }
  const aTop = ((n - 1) * 2.6 * Math.PI) / 180, yt = y0 + n * fh;
  b.push().translate(0, 0, cz).rotateY(aTop);
  K.bandRect(b, -9, -9, 9, 9, yt - 0.9, yt, K.emis(0x7fffd4), 0.06);
  box(b, -9, yt, -9, 9, yt + 1.2, 9, K.plain(0xe8ecee), null);
  up(b, -8.2, -8.2, 8.2, 8.2, yt + 0.3, K.foliage(0x6f9a45));
  box(b, -4, yt, -4, 4, yt + 3.5, 4, GC(1, 3.5), ROOF);
  b.pop();
  K.mast(b, 0, cz, yt + 3.5, 8, 0.3, 0.06, K.metal(0xd0d0d0));
  b.paint(C.water, Surf.Water).box(-6, 0, 9, 6, 0.2, 13);
  K.canopy(b, -3, 3, 6.1, 3.8, 2.4, 0.25, K.metal(0xc3c8cd), K.emis(0xeaf4ff));
}
function otSeagram(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(0xc9c2b4));
  box(b, -16, 0, 4.5, 16, 0.45, 15.2, P(0x5a5048, Surf.Stone));
  const x0 = -12, x1 = 12, z0 = -10.5, z1 = 4.5, base = 7.6, top = 98.8;
  box(b, -10.5, 0, -9, 10.5, base, 3, P(0x2a3440, Surf.GlassPlain), null);
  K.storefront(b, -9.9, 9.9, 3, { y0: 0.05, y1: 7.2, frame: 0x6b5238, doors: [-1.4, 1.4], pitch: 3.3, transom: 3.5, surround: 0 });
  for (let x = x0 + 0.4; x <= x1; x += 5.8) box(b, x - 0.4, 0, z1 - 0.8, x + 0.4, base, z1, K.metal(0x5a4430), null);
  box(b, x0, base, z0, x1, top, z1, GC(3, 3.8), ROOF, { bottom: K.metal(0x3a2c22) });
  const bronze = K.metal(0x7a5a38);
  finsZ(b, x0 + 1.5, x1 - 1.5, 1.5, base, top, z1, 0.4, bronze);
  finsX(b, z0 + 1.5, z1 - 1.5, 1.5, base, top, x1, 0.4, bronze);
  K.bandRect(b, x0, z0, x1, z1, top, top + 3.8, K.metal(0x3a2c22), 0.0);
  up(b, x0, z0, x1, z1, top + 3.8, ROOF);
  K.bandRect(b, x0, z0, x1, z1, base - 0.5, base, K.metal(0x7a5a38), 0.05);
  for (const px of [-9, 9]) {
    b.paint(0x2f5f7a, Surf.Water).box(px - 5.5, 0.45, 6.5, px + 5.5, 0.55, 13.5, { top: P(0x2f6f96, Surf.Water) });
    K.fountain(b, px, 10, 1.0, 0x7a6a5a);
  }
  for (const tx of [-14.5, 14.5]) { K.tree(b, rng, tx, -13.5, 0.8); }
  K.letters(b, rng, 0, 0.8, 15.25, 5, 0.55, 0xe8d8b8, { words: 1 });
}
function otOctSloped(b: B, rng: RNG) {
  plaza(b, rng, 16, 16, 7.5, { trees: [[-12.5, 12], [12.5, 12]] });
  const pts = K.chamferPts(-12, -13.5, 12, 7.5, 4.5);
  K.prismPts(b, K.chamferPts(-11, -12.5, 11, 6.5, 4.1), 0, 5.7, P(0x2a3440, Surf.GlassPlain), null);
  K.prismPts(b, pts, 5.7, 108.3, GC(4, 3.8), null);
  down(b, -12, -13.5, 12, 7.5, 5.7, K.plain(0x8e9398));
  const yTop = (_x: number, z: number) => 108.3 + ((7.5 - z) / 21) * 17;
  prismSloped(b, pts, 108.3, yTop, GC(4, 3.8), K.metal(0xc8ced4));
  // lit edges of the sloped crown
  const lit = K.emis(0xeaf6ff);
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    b.paint(lit).beam([pts[i][0], yTop(pts[i][0], pts[i][1]), pts[i][1]], [pts[j][0], yTop(pts[j][0], pts[j][1]), pts[j][1]], 0.35);
  }
  for (let k = 1; k < 5; k++) {
    const z = 7.5 - (21 * k) / 5, y = yTop(0, z) + 0.2;
    const hw = 12 - (Math.abs(z + 3) > 6 ? Math.abs(Math.abs(z + 3) - 6) : 0);
    b.paint(lit).beam([-hw, y, z], [hw, y, z], 0.25);
  }
  K.beacon(b, 0, yTop(0, -13.5) + 0.2, -13.2, 0.5);
  K.canopy(b, -4, 4, 6.5, 4.4, 3.4, 0.3, K.metal(0xc3c8cd), K.emis(0xeaf4ff));
  K.letters(b, rng, 0, 4.75, 9.8, 6, 0.7, 0xeaf4ff, { words: 1 });
}
function otPyramid(b: B, rng: RNG) {
  plaza(b, rng, 16, 16, 7.5, { color: 0xcfc6b6, trees: [[-13, 12.5], [13, 12.5]] });
  const n = 1.5;
  const pts: V2[] = [[-10.5 + n, -13.5], [10.5 - n, -13.5], [10.5 - n, -13.5 + n], [10.5, -13.5 + n], [10.5, 7.5 - n], [10.5 - n, 7.5 - n], [10.5 - n, 7.5], [-10.5 + n, 7.5], [-10.5 + n, 7.5 - n], [-10.5, 7.5 - n], [-10.5, -13.5 + n], [-10.5 + n, -13.5 + n]];
  b.paint(P(0x6a5a52, Surf.Stone)).extrude(pts, 0, 7.6, { top: false });
  b.paint(WW(0x8a5a4e, 5, 3.8)).extrude(pts, 7.6, 98.8 - 7.6, { top: true, topPaint: ROOF });
  K.bandPts(b, K.rectPts(-9, -12, 9, 6), 106.4 - 0.8, 106.4, K.emis(0xfff4e0), 0.02);
  b.paint(WW(0x8a5a4e, 5, 3.8)).extrude(K.rectPts(-9, -12, 9, 6), 98.8, 7.6, { top: false });
  b.paint(0xc0c6cc, Surf.Metal).pyramid(0, -3, 18, 18, 106.4, 15);
  K.beacon(b, 0, 121.4, -3, 0.6, 0xffffff);
  K.storefront(b, -4.5, 4.5, 7.5, { y0: 0.05, y1: 6.8, frame: 0x2a2a2a, doors: [-1.5, 1.5], doorW: 1.8, transom: 3.6 });
  for (const sx of [-8.5, 5.5]) K.storefront(b, sx, sx + 3, 7.5, { y0: 0.6, y1: 6.4, frame: 0x2a2a2a, pitch: 1.5, transom: 3.6 });
  K.canopy(b, -5, 5, 7.5, 4.6, 2.8, 0.35, K.metal(0x2a2a2a), K.emis(0xfff0cc));
  K.letters(b, rng, 0, 1.0, 14.9, 6, 0.6, 0xfff1d6, { words: 1 });
  box(b, -3.6, 0, 14.6, 3.6, 1.9, 15.0, P(0x6a5a52, Surf.Stone));
}
function otTapered(b: B, rng: RNG) {
  plaza(b, rng, 16, 16, 8.5, { color: 0xd6cfc0, trees: [[-13, 12.5], [13, 12.5]] });
  const cz = -3;
  const sq = (h: number) => K.rectPts(-h, cz - h, h, cz + h);
  K.prismPts(b, sq(11), 0, 5.4, P(0x2a3440, Surf.GlassPlain), null);
  const lv: [number, number, number][] = [[5.4, 12, 11], [47, 11, 9.8], [88.4, 9.8, 8.6], [129.6, 8.6, 0]];
  for (let i = 0; i < 3; i++) K.loft(b, sq(lv[i][1]), sq(lv[i + 1][1]), lv[i][0], lv[i + 1][0], GC(2, 3.6), i === 2 ? ROOF : null);
  down(b, -12, cz - 12, 12, cz + 12, 5.4, K.plain(0x55595f));
  // open crown frame
  const g = K.emis(0xffc870), yt = 129.6;
  const s0 = 8.2, s1 = 6.0, y1 = yt + 10;
  const corners = (s: number): V2[] => [[-s, cz - s], [s, cz - s], [s, cz + s], [-s, cz + s]];
  const c0 = corners(s0), c1 = corners(s1);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    b.paint(g).beam([c0[i][0], yt, c0[i][1]], [c1[i][0], y1, c1[i][1]], 0.45);
    b.paint(g).beam([c1[i][0], y1, c1[i][1]], [c1[j][0], y1, c1[j][1]], 0.4);
    b.paint(K.metal(0x7a5a38)).beam([c0[i][0], yt + 4.8, c0[i][1]], [c0[j][0], yt + 4.8, c0[j][1]], 0.35);
  }
  box(b, -4, yt, cz - 4, 4, yt + 4, cz + 4, K.plain(0x6b5238), ROOF);
  K.mast(b, 0, cz, yt + 4, 12, 0.3, 0.06, K.metal(0xd0d0d0));
  K.canopy(b, -4, 4, cz + 11, 4.2, 3.2, 0.3, K.metal(0x7a5a38), K.emis(0xffd88a));
  K.letters(b, rng, 0, 4.55, cz + 14.0, 6, 0.7, 0xffe6b0, { words: 1 });
}
const officeTower: ModelBuildFn = (b, v, rng) => [otGlassBox, otStone, otDeco, otTwisted, otSeagram, otOctSloped, otPyramid, otTapered][v % 8](b, rng);

// ============================================================================================ SKYSCRAPER (3x3)
function skEmpire(b: B, rng: RNG) {
  plaza(b, rng, 24, 24, 15.4, { color: 0xd3cbbb, trees: [[-20, 20], [20, 20]] });
  const ww = WW(0xcdbf9f, 1, 3.6);
  const stone = P(0xa8987a, Surf.Stone), pier = P(0xe0d4b8, Surf.Stone);
  box(b, -22, 0, -22, 22, 7.2, 15.4, stone, null);
  box(b, -22, 7.2, -22, 22, 21.6, 15.4, ww, ROOF);
  box(b, -15.4, 21.6, -17.6, 15.4, 86.4, 11, ww, ROOF);
  box(b, -11, 86.4, -13.2, 11, 165.6, 6.6, ww, ROOF);
  box(b, -6.6, 165.6, -8.8, 6.6, 187.2, 2.2, ww, ROOF);
  box(b, -4.4, 187.2, -6.6, 4.4, 198, 0, pier, ROOF);
  piersZ(b, -13.2, 13.2, 4.4, 21.6, 87, 11, pier);
  piersZ(b, -8.8, 8.8, 4.4, 86.4, 166.2, 6.6, pier);
  piersX(b, -15.4, 6.6, 4.4, 21.6, 87, 15.4, pier);
  piersX(b, -11, 4.4, 4.4, 86.4, 166.2, 11, pier);
  // lit crown
  const lit = K.emis(0xfff0c0);
  for (let x = -3.3; x <= 3.31; x += 2.2) faceZ(b, x - 0.35, x + 0.35, 187.6, 197.4, 0.02, lit);
  K.onSide(b, 'px', () => { for (let z = -5.5; z <= -1.09; z += 2.2) faceZ(b, -z - 0.35, -z + 0.35, 187.6, 197.4, 4.42, lit); });
  K.bandRect(b, -6.6, -8.8, 6.6, 2.2, 186.4, 187.2, lit, 0.1);
  box(b, -2.4, 198, -4.7, 2.4, 203, -1.9, K.emis(0xfff4d8), ROOF);
  K.mast(b, 0, -3.3, 203, 36, 1.3, 0.12, K.metal(0xd8d8d8));
  // entrance
  K.storefront(b, -4.4, 4.4, 15.4, { y0: 0.05, y1: 6.4, frame: 0xc9a24a, doors: [-1.8, 0, 1.8], doorW: 1.6, transom: 4.0 });
  for (let x = -19.8; x < 19; x += 4.4) if (Math.abs(x + 1.8) > 6) K.storefront(b, x, x + 3.2, 15.4, { y0: 0.6, y1: 5.8, frame: 0x2a2320, pitch: 1.6, transom: 3.8 });
  box(b, -5.5, 4.8, 15.4, 5.5, 5.6, 19.6, K.metal(0x2a2a2a), ROOF, { bottom: K.emis(0xfff0cc), nz: null });
  faceZ(b, -5.5, 5.5, 4.9, 5.5, 19.62, K.emis(0xffd88a));
  K.facadeFlag(b, -7.5, 7.0, 15.4, 0x1d3a6b, 2.6);
  K.facadeFlag(b, 7.5, 7.0, 15.4, 0x1d3a6b, 2.6);
}
function skChrysler(b: B, rng: RNG) {
  plaza(b, rng, 24, 24, 15.4, { color: 0xcfc8ba, trees: [[-20, 20], [20, 20], [-20, -20]] });
  const ww = WW(0xdcd9d2, 1, 3.6);
  const cz = -2.2;
  box(b, -19.8, 0, -19.8, 19.8, 7.2, 15.4, P(0x3a3a3e, Surf.Stone), null);
  box(b, -19.8, 7.2, -19.8, 19.8, 28.8, 15.4, ww, ROOF);
  box(b, -15.4, 28.8, -15.4, 15.4, 57.6, 11, ww, ROOF);
  box(b, -11, 57.6, cz - 11, 11, 158.4, cz + 11, ww, null);
  const pier = P(0xeeece6, Surf.Stone);
  piersZ(b, -8.8, 8.8, 4.4, 57.6, 158.4, cz + 11, pier, 0.6, 0.3);
  piersX(b, cz - 8.8, cz + 8.8, 4.4, 57.6, 158.4, 11, pier, 0.6, 0.3);
  // stacked sunburst crown
  const steel = K.metal(0xd4d8dc), sun = K.emis(0xfff2cc);
  let y = 158.4;
  for (let i = 0; i < 6; i++) {
    const s0 = 11 - 1.6 * i, s1 = s0 - 1.1, th = 6.2;
    K.loft(b, K.rectPts(-s0, cz - s0, s0, cz + s0), K.rectPts(-s1, cz - s1, s1, cz + s1), y, y + th, steel, i === 5 ? steel : null);
    const o = 0.08;
    for (let f = 0; f < 4; f++) {
      b.push().translate(0, 0, cz).rotateY((f * Math.PI) / 2);
      b.paint(sun).tri([-s0 * 0.72, y + 0.6, s0 - (1.1 * 0.6) / th + o], [s0 * 0.72, y + 0.6, s0 - (1.1 * 0.6) / th + o], [0, y + th - 0.4, s1 + 0.07 + o]);
      for (const wx of [-0.45, 0.45]) b.paint(K.plain(0x2a2e33)).tri([wx * s0 * 0.9 - 0.5, y + 0.7, s0 + o * 1.5 - 0.15], [wx * s0 * 0.9 + 0.5, y + 0.7, s0 + o * 1.5 - 0.15], [wx * s0 * 0.9, y + 3.2, s0 - 0.45 + o * 1.5]);
      b.pop();
    }
    y += th;
  }
  K.mast(b, 0, cz, y, 38, 0.9, 0.05, K.metal(0xe0e4e8));
  K.storefront(b, -4.4, 4.4, 15.4, { y0: 0.05, y1: 6.4, frame: 0xc0c6cc, doors: [-1.8, 0, 1.8], doorW: 1.6, transom: 4.2 });
  box(b, -5.5, 5, 15.4, 5.5, 5.7, 19.4, K.metal(0x2a2a2a), ROOF, { bottom: K.emis(0xfff0cc), nz: null });
  K.letters(b, rng, 0, 5.75, 19.0, 9, 1.0, 0xfff2cc, { words: 1, n: 8 });
}
function skCiticorp(b: B, rng: RNG) {
  plaza(b, rng, 24, 24, 11.2, { color: 0xd6d0c4, lawn: true, trees: [[-18, 18], [18, 18], [-18, -20], [18, -20]] });
  const x0 = -12.8, x1 = 12.8, z0 = -14.4, z1 = 11.2, sb = 34.2, top = 186.2;
  const zc = (z0 + z1) / 2;
  const col = K.plain(0xc9ccd0);
  for (const [cx, czz] of [[0, z1 - 3.6], [0, z0 + 3.6], [x0 + 3.6, zc], [x1 - 3.6, zc]] as V2[]) box(b, cx - 3.6, 0, czz - 3.6, cx + 3.6, sb, czz + 3.6, col, null);
  box(b, -6.5, 0, zc - 6.5, 6.5, 10, zc + 6.5, P(0x2a3440, Surf.GlassPlain), K.roofP(0x9a9a9a));
  const pts = K.rectPts(x0, z0, x1, z1);
  K.prismPts(b, pts, sb, top, WW(0xc5cad0, 2, 3.8), null);
  down(b, x0, z0, x1, z1, sb, K.plain(0xb0b5ba));
  const yTop = (_x: number, z: number) => top + (z1 - z);
  prismSloped(b, pts, top, yTop, WW(0xc5cad0, 2, 3.8), K.metal(0xd6dade));
  // lit bands across the slope
  const lit = K.emis(0xf4fbff);
  for (let k = 1; k < 9; k++) {
    const z = z1 - (k * (z1 - z0)) / 9;
    const y = yTop(0, z);
    b.paint(lit).quad([x0 + 0.6, y + 0.12, z + 0.35], [x1 - 0.6, y + 0.12, z + 0.35], [x1 - 0.6, y + 0.12 + 0.5, z - 0.15], [x0 + 0.6, y + 0.12 + 0.5, z - 0.15]);
  }
  K.beacon(b, 0, yTop(0, z0) + 0.1, z0 + 0.5, 0.6);
  // sunken garden / low glass pavilion
  box(b, 14, 0, -6, 21, 7, 6, P(0x2a3440, Surf.GlassPlain), K.roofP(0x9a9a9a));
  b.paint(0xf2f0ea, Surf.Plain).shedRoof(17.5, 0, 7.4, 12.4, 7, 4, 'px');
  K.letters(b, rng, 0, 6.5, z1 - 0.1 + 0.05, 7, 1.0, 0xf4fbff, { words: 1 });
  for (const bx of [-6, 6]) bench(b, bx, 16);
}
function skTwisted(b: B, rng: RNG) {
  plaza(b, rng, 24, 24, 14, { color: 0xd8d4cc, trees: [[-20, 20], [-12, 20], [12, 20], [20, 20]] });
  const cz = -2;
  box(b, -20, 0, -20, 20, 9, 14, GC(5, 4.5), K.foliage(0x6f9a45));
  K.storefront(b, -18, 18, 14, { y0: 0.1, y1: 8.4, frame: 0x8f979e, doors: [-2, 2], doorW: 2.2, pitch: 3, transom: 4.4, surround: 0 });
  const n = 26, fh = 7.6, y0 = 9;
  const oct = K.chamferPts(-10.5, cz - 10.5, 10.5, cz + 10.5, 3);
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1)) * (Math.PI / 2);
    const s = K.rotPts(oct, a, 0, cz);
    K.prismPts(b, s, y0 + i * fh, y0 + (i + 1) * fh, GC(5, 3.8), ROOF);
  }
  const yt = y0 + n * fh;
  const last = K.rotPts(oct, Math.PI / 2, 0, cz);
  K.bandPts(b, last, yt - 1.2, yt, K.emis(0x9fe8ff), 0.12);
  K.prismPts(b, K.scalePts(last, 0.5, 0.5, 0, cz), yt, yt + 4, K.plain(0xd8dcdf), ROOF);
  K.mast(b, 0, cz, yt + 4, 10, 0.3, 0.06, K.metal(0xd0d0d0));
  for (const fx of [-8, 8]) b.paint(C.water, Surf.Water).box(fx - 4, 0, 16, fx + 4, 0.25, 21);
  K.canopy(b, -4, 4, 14, 5.2, 3.0, 0.3, K.metal(0xc3c8cd), K.emis(0xeaf4ff));
}
function skDiagrid(b: B, rng: RNG) {
  plaza(b, rng, 24, 24, 15.4, { color: 0xd3cbbb, trees: [[-20, 20], [20, 20]] });
  const stone = P(0xd9c9a8, Surf.Stone);
  box(b, -22, 0, -22, 22, 4, 15.4, stone, null);
  box(b, -22, 4, -22, 22, 24, 15.4, WW(0xd9c9a8, 1, 4), ROOF);
  K.cornice(b, -22, -22, 22, 15.4, 24, 0.8, 0.4, P(0xe8dcc2, Surf.Stone), null);
  for (let x = -19.8; x < 19; x += 4.4) if (Math.abs(x + 1.6) > 6) K.storefront(b, x, x + 3.2, 15.4, { y0: 0.5, y1: 3.4, frame: 0x2a2320, pitch: 1.6 });
  K.storefront(b, -4.4, 4.4, 15.4, { y0: 0.05, y1: 3.6, frame: 0x2a2320, doors: [-1.5, 1.5], doorW: 1.8 });
  const x0 = -13.5, x1 = 13.5, z0 = -15, z1 = 12, y0 = 24, y1 = 184;
  box(b, x0, y0, z0, x1, y1, z1, GC(0, 4), ROOF);
  const white = K.metal(0xe8ecef);
  diagridBox(b, x0, z0, x1, z1, y0, y1, 9, 16, 0.9, white);
  for (let y = y0 + 16; y < y1; y += 16) K.bandRect(b, x0, z0, x1, z1, y - 0.25, y + 0.25, white, 0.14);
  K.bandRect(b, x0, z0, x1, z1, y1, y1 + 2.4, white, 0.0);
  K.bandRect(b, x0, z0, x1, z1, y1 + 0.6, y1 + 2.2, K.emis(0xdff1ff), 0.05);
  box(b, -6, y1, -8, 6, y1 + 4.5, 4, K.plain(0xc9ced4), ROOF);
  beacons4(b, x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 0.6, y1 + 2.4, 0.4);
  K.letters(b, rng, 0, 20.5, 15.45, 12, 1.4, 0xffe6b0, { words: 1 });
}
function skBundled(b: B, rng: RNG) {
  plaza(b, rng, 24, 24, 10.5, { color: 0xcfc8ba, trees: [[-20, 19], [20, 19], [-20, 13], [20, 13]] });
  const xs: [number, number][] = [[-13.5, -4.5], [-4.5, 4.5], [4.5, 13.5]];
  const zs: [number, number][] = [[-16.5, -7.5], [-7.5, 1.5], [1.5, 10.5]];
  const H = [[220, 244, 164], [182, 244, 128], [110, 146, 92]];
  const g = GC(3, 3.8), belt = K.metal(0x2a2c2e);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const [a, e] = xs[i], [c, d] = zs[j], h = H[j][i];
    box(b, a, 0, c, e, h, d, g, ROOF);
    for (let y = 60.8; y < h - 8; y += 60.8) K.bandRect(b, a, c, e, d, y - 3.8, y, belt, 0.05);
    K.bandRect(b, a, c, e, d, h - 3.8, h - 1.4, belt, 0.05);
    K.bandRect(b, a, c, e, d, h - 1.4, h, K.emis(0xeaf4ff), 0.05);
    if (h < 240) box(b, a + 2, h, c + 2, e - 2, h + 2.5, d - 2, K.plain(0x55595f), ROOF);
  }
  K.mast(b, -2.6, -12, 244, 46, 0.8, 0.1, K.metal(0xe0e0e0));
  K.mast(b, 2.6, -3, 244, 40, 0.8, 0.1, K.metal(0xe0e0e0));
  for (const [x, z] of [[-4, -16], [4, -16], [-4, 1], [4, 1]] as V2[]) K.beacon(b, x, 244, z, 0.4);
  box(b, -8, 0, 10.5, 8, 6, 14.5, P(0x2a3440, Surf.GlassPlain), K.metal(0x2a2c2e));
  K.storefront(b, -7.5, 7.5, 14.5, { y0: 0.05, y1: 5.6, frame: 0x2a2c2e, doors: [-2, 2], doorW: 2.0, pitch: 2.5, surround: 0 });
  K.letters(b, rng, 0, 6.2, 14.52, 12, 1.2, 0xeaf4ff, { words: 1 });
}
const skyscraper: ModelBuildFn = (b, v, rng) => [skEmpire, skChrysler, skCiticorp, skTwisted, skDiagrid, skBundled][v % 6](b, rng);

// ============================================================================================ MEGATOWER (4x4)
function megaPlaza(b: B, rng: RNG, water: boolean) {
  up(b, -32, -32, 32, 32, 0.03, K.pav(0xd8d2c6));
  up(b, -32, 18, -8, 32, 0.07, K.foliage(C.grass));
  up(b, 8, 18, 32, 32, 0.07, K.foliage(C.grass));
  up(b, -32, -32, -26, 18, 0.07, K.foliage(C.grass));
  up(b, 26, -32, 32, 18, 0.07, K.foliage(C.grass));
  if (water) {
    b.paint(0x2f7fb0, Surf.Water).box(-24, 0, 21, -10, 0.25, 29);
    b.paint(0x2f7fb0, Surf.Water).box(10, 0, 21, 24, 0.25, 29);
    for (const fx of [-21, -17, -13, 13, 17, 21]) b.paint(0xd8f0ff, Surf.Water).cylinder(fx, 25, 0.2, 3.0, 0.3, 0.05, 5, { top: false });
  }
  for (const tz of [-26, -16, -6, 4, 14]) { K.tree(b, rng, -29, tz, 0.85); K.tree(b, rng, 29, tz, 0.85); }
  for (const tx of [-28, 28]) K.tree(b, rng, tx, 28, 0.85);
}
function megaBurj(b: B, rng: RNG) {
  megaPlaza(b, rng, true);
  const cz = -3;
  const glass = GC(4, 4);
  for (let w = 0; w < 3; w++) {
    const a = Math.PI / 2 + (w * 2 * Math.PI) / 3;
    b.push().translate(0, 0, cz).rotateY(Math.PI / 2 - a);
    let y = 0;
    for (let k = 0; k < 8; k++) {
      const L = 25.5 - 2.4 * k;
      const y1 = 16 + 40 * k + w * 13;
      box(b, -6.75, y, 0, 6.75, y1, L, glass, ROOF);
      if (k === 0) K.storefront(b, -5, 5, L, { y0: 0.05, y1: 7.5, frame: 0xa9b0b6, doors: [0], doorW: 2.4, pitch: 2.5, transom: 4, surround: 0 });
      box(b, -6.9, y1 - 0.5, L - 0.2, 6.9, y1, L + 0.15, K.metal(0xdfe4e8), null);
      y = y1;
    }
    b.pop();
  }
  const hex = (r: number): V2[] => K.ngonPts(0, cz, r, 6, Math.PI / 6);
  K.loft(b, hex(9.5), hex(8.5), 0, 200, glass, null);
  K.loft(b, hex(8.5), hex(6.8), 200, 330, glass, null);
  K.loft(b, hex(6.8), hex(4.5), 330, 360, glass, K.roofP(0x9a9a9a));
  K.bandPts(b, hex(6.8), 329, 330.5, K.emis(0xdff1ff), 0.15);
  K.loft(b, hex(4.5), hex(0.25), 360, 418, K.metal(0xd8dde2), null);
  K.beacon(b, 0, 418, cz, 0.35, 0xffffff);
  for (const y of [368, 380, 392]) { const r = 4.5 - ((y - 360) / 58) * 4.25; K.bandPts(b, hex(r), y, y + 2, K.emis(0xdff1ff), 0.08); }
  for (const y of [250, 300, 355]) K.bandPts(b, hex(y < 330 ? 8.5 - (y - 200) * 0.013 : 4.6), y, y + 0.8, K.emis(0xdff1ff), 0.12);
  K.fountain(b, 0, 26, 3.5);
}
function megaShanghai(b: B, rng: RNG) {
  megaPlaza(b, rng, false);
  const cz = -2, R = 23;
  const sec = (t: number): V2[] => {
    const rot = t * (2 * Math.PI / 3), s = 1 - 0.45 * Math.pow(t, 1.15);
    const pts: V2[] = [];
    for (let i = 0; i < 9; i++) {
      const a = rot + (i / 9) * Math.PI * 2;
      const r = R * s * (1 - 0.09 * Math.cos(3 * (a - rot)));
      pts.push([Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    return pts;
  };
  // podium
  K.prismPts(b, K.ngonPts(0, cz, 29, 12, 0.13), 0, 11, GC(5, 5.5), K.foliage(0x77a34f));
  const H = 384, n = 30, y0 = 11;
  const lit = K.emis(0x8fd8ff);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const a = sec(t0), c = sec(t1);
    const ya = y0 + t0 * (H - y0), yb = y0 + t1 * (H - y0);
    K.loft(b, a, c, ya, yb, GC(5, 4.2), null);
    // spiral notch light line along vertex 0
    const off = (p: V2): V2 => { const dx = p[0], dz = p[1] - cz, l = Math.hypot(dx, dz) || 1; return [p[0] + (dx / l) * 0.25, p[1] + (dz / l) * 0.25]; };
    const pa = off(a[0]), pc = off(c[0]);
    const ta = [-(a[0][1] - cz), a[0][0]], tl = Math.hypot(ta[0], ta[1]) || 1;
    const tx = (ta[0] / tl) * 1.1, tz = (ta[1] / tl) * 1.1;
    b.paint(lit).quad2([pa[0] - tx, ya, pa[1] - tz], [pa[0] + tx, ya, pa[1] + tz], [pc[0] + tx, yb, pc[1] + tz], [pc[0] - tx, yb, pc[1] - tz]);
  }
  // sloped crown
  const last = sec(1);
  const yTop = (x: number, z: number) => H + 18 + (x * 0.35 + (z - cz) * 0.25) * 0.9;
  prismSloped(b, last, H, yTop, GC(5, 4.2), K.metal(0xcfd6dc));
  K.bandPts(b, last, H - 0.5, H + 1.0, K.emis(0xdff1ff), 0.2);
  K.beacon(b, 7, yTop(7, cz) + 0.1, cz, 0.45);
  K.beacon(b, -7, yTop(-7, cz) + 0.1, cz, 0.45);
  K.storefront(b, -8, 8, cz + 29 * Math.cos(Math.PI / 12) - 0.1, { y0: 0.1, y1: 8, frame: 0xa9b0b6, doors: [-2, 2], doorW: 2.4, pitch: 2.5, surround: 0 });
  K.fountain(b, 0, 25, 3.2);
}
function megaOpener(b: B, rng: RNG) {
  megaPlaza(b, rng, true);
  const cz = -3, H = 400;
  const wy = (y: number) => 21.5 - 5 * Math.pow(y / H, 1.3);
  const depth = (y: number) => 38 * Math.pow(1 - y / H, 0.85) + 8 * (y / H);
  const rect = (y: number, xa?: number, xb?: number): V2[] => { const d = depth(y) / 2; return K.rectPts(xa ?? -wy(y), cz - d, xb ?? wy(y), cz + d); };
  const g = GC(4, 4.2);
  const levels = [0, 60, 130, 200, 265, 330];
  // base podium
  box(b, -26, 0, cz - 24, 26, 10, cz + 21, K.plain(0xe4e2dc), K.foliage(0x77a34f));
  for (let i = 0; i < levels.length - 1; i++) K.loft(b, rect(levels[i]), rect(levels[i + 1]), levels[i], levels[i + 1], g, i === levels.length - 2 ? K.emis(0x6fb8ff) : null);
  // aperture legs & bridge
  const ya = 330, yb = 372, hx = 9;
  K.loft(b, rect(ya, -wy(ya), -hx), rect(yb, -wy(yb), -hx), ya, yb, g, null);
  K.loft(b, rect(ya, hx, wy(ya)), rect(yb, hx, wy(yb)), ya, yb, g, null);
  const inner = K.emis(0x6fb8ff);
  // inner walls of the aperture (lit)
  const da = depth(ya) / 2, db = depth(yb) / 2;
  b.paint(inner).quad([-hx + 0.05, ya, cz - da], [-hx + 0.05, ya, cz + da], [-hx + 0.05, yb, cz + db], [-hx + 0.05, yb, cz - db]);
  b.paint(inner).quad([hx - 0.05, ya, cz + da], [hx - 0.05, ya, cz - da], [hx - 0.05, yb, cz - db], [hx - 0.05, yb, cz + db]);
  K.loft(b, rect(yb), rect(H), yb, H, g, ROOF);
  const dbb = depth(yb) / 2;
  b.paint(inner).quad([-hx, yb - 0.05, cz - dbb], [hx, yb - 0.05, cz - dbb], [hx, yb - 0.05, cz + dbb], [-hx, yb - 0.05, cz + dbb]);
  // lit frame around the aperture on front and back
  const frame = K.emis(0xdff1ff), fw = 0.8;
  for (const s of [1, -1]) {
    const za = cz + s * (da + 0.1), zb = cz + s * (db + 0.1);
    const Q = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => (s > 0 ? b.paint(frame).quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1]) : b.paint(frame).quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z1], [x1, y1, z1]));
    Q(-hx - fw, -hx, ya, yb, za, zb);
    Q(hx, hx + fw, ya, yb, za, zb);
    Q(-hx - fw, hx + fw, yb, yb + fw, zb, cz + s * (depth(yb + fw) / 2 + 0.1));
    Q(-hx - fw, hx + fw, ya - fw, ya, cz + s * (depth(ya - fw) / 2 + 0.1), za);
  }
  const dt = depth(H) / 2;
  const wt = wy(H);
  beacons4(b, -wt + 0.6, cz - dt + 0.6, wt - 0.6, cz + dt - 0.6, H, 0.5);
  K.bandRect(b, -wt, cz - dt, wt, cz + dt, H - 1.2, H, K.emis(0xdff1ff), 0.1);
  K.storefront(b, -10, 10, cz + 21, { y0: 0.1, y1: 9.2, frame: 0xa9b0b6, doors: [-3, 0, 3], doorW: 2.2, pitch: 2.5, transom: 4.5, surround: 0 });
  K.letters(b, rng, 0, 7.4, cz + 21.05, 14, 1.2, 0xdff1ff, { words: 1 });
}
const megatower: ModelBuildFn = (b, v, rng) => [megaBurj, megaShanghai, megaOpener][v % 3](b, rng);

export const highModels: Record<string, ModelBuildFn> = {
  com_hotel_tower: hotelTower,
  com_office_tower: officeTower,
  com_skyscraper: skyscraper,
  com_megatower: megatower,
};
