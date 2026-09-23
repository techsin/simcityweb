/**
 * Commercial medium-density models: shops+apartments, motel, supermarket, hotel, department store,
 * small office, office block, mall.
 *
 * Window alignment notes (shader uses object-space coordinates): WallWindows columns repeat every colW meters
 * starting at x/z = 0 (pattern 0: 3.0, 1: 2.2, 2: 1.6, 3: 4.2, 5: 1.5, 6: 2.8, 7: 3.2) and rows every floor height from
 * y = 0. Facade extents are chosen as multiples of colW and upper-floor bases fall in the gap between window rows.
 */
import { ModelBuilder, type Paint } from '../ModelBuilder';
import type { ModelBuildFn } from '../registry';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { rooftopWaterTank, pool, bench } from '../kit';
import * as K from './com_kit';
import { P, C, box, up, faceZ, faceX } from './com_kit';
import { isMirrorTwin } from './res_util';

type B = ModelBuilder;
const WW = (color: number, pattern: number, floor: number): Paint => P(color, Surf.WallWindows, pattern, floor);
const GC = (tint: number, floor: number): Paint => P(0x8899aa, Surf.GlassCurtain, tint, floor);

function fenceLine(b: B, ax: number, az: number, bx: number, bz: number, h = 1.1, color = 0xf2f0ea) {
  const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 2.6));
  for (let i = 0; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
    box(b, x - 0.06, 0, z - 0.06, x + 0.06, h, z + 0.06, K.metal(color), null);
  }
  b.paint(color, Surf.Metal).beam([ax, h, az], [bx, h, bz], 0.07).beam([ax, h * 0.5, az], [bx, h * 0.5, bz], 0.05);
}

/** Vertical fins (double-sided quads) along a +Z face at z from x0..x1 every `step`. */
function finsZ(b: B, x0: number, x1: number, step: number, y0: number, y1: number, z: number, depth: number, p: Paint) {
  b.paint(p);
  for (let x = x0; x <= x1 + 1e-3; x += step) b.quad2([x, y0, z], [x, y0, z + depth], [x, y1, z + depth], [x, y1, z]);
}

// ============================================================================================ SHOPS + APARTMENTS (1x1)
interface GroundOpts { frame: number; awnings: number[][]; signBack: number; letter: number[]; wallBand?: Paint }
/** Two shops + residential door on the +Z face (x0..x1 at z), ground floor height gh. */
function twoShops(b: B, rng: RNG, x0: number, x1: number, z: number, gh: number, o: GroundOpts) {
  const mid = (x0 + x1) / 2;
  const sy = gh - 1.15;
  for (let s = 0; s < 2; s++) {
    const a = s === 0 ? x0 + 0.45 : mid + 0.9, e = s === 0 ? mid - 0.9 : x1 - 0.45;
    K.storefront(b, a + 0.1, e - 0.1, z, { y1: sy - 0.2, frame: o.frame, doors: [s === 0 ? e - 1.2 : a + 1.2], pitch: 1.6 });
    if (s === 0 || rng.chance(0.6)) K.signBoard(b, rng, a, e, sy, gh - 0.3, z, K.plain(o.signBack), o.letter[s % o.letter.length], 0.15);
    else K.letters(b, rng, (a + e) / 2, sy + 0.1, z + 0.03, e - a - 0.6, 0.55, o.letter[s % o.letter.length]);
    K.awning(b, a - 0.1, e + 0.1, z, sy - 0.05, 1.3, 0.6, o.awnings[s % o.awnings.length], 0.8, 0.28);
  }
  K.door(b, mid, z, 1.1, 2.3, 0x3a2a20, 0xe8e0d0);
  faceZ(b, mid - 0.7, mid + 0.7, 2.5, 2.9, z + 0.03, K.emis(0xffe2a8, 3));
}
function saBrick(b: B, rng: RNG) {
  up(b, -8, -8, 8, 8, 0.03, K.pav(C.sidewalk));
  const x0 = -6.6, x1 = 6.6, z0 = -6.6, z1 = 2.2, top = 10.4;
  box(b, x0, 0, z0, x1, 4.0, z1, P(0x8e4030, Surf.Brick), null);
  box(b, x0, 4.0, z0, x1, top, z1, WW(0x9c4a36, 1, 3.4), null);
  K.cornice(b, x0, z0, x1, z1, 3.8, 0.2, 0.08, P(0xd9cfb8, Surf.Stone), null);
  K.cornice(b, x0, z0, x1, z1, top, 0.6, 0.3, P(0xd9cfb8, Surf.Stone));
  up(b, x0 + 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.1, top + 0.61, K.roofP());
  twoShops(b, rng, x0, x1, z1, 4.0, { frame: 0x26332a, awnings: [[0xb8262b, 0xf2efe6], [0x2f7d4a, 0xf2efe6]], signBack: 0x26332a, letter: [0xfff1c9, 0xffc933] });
  // fire escape on +X side
  const fe = K.metal(0x2a2c2e);
  for (const py of [4.0, 7.4]) {
    box(b, x1, py, -4.6, x1 + 1.1, py + 0.12, -0.2, fe, undefined, { bottom: fe });
    faceX(b, -4.6, -0.2, py + 0.12, py + 1.05, x1 + 1.1, fe, 1);
    faceX(b, -4.6, -0.2, py + 0.12, py + 1.05, x1 + 1.1, fe, -1);
  }
  b.paint(0x2a2c2e, Surf.Metal).beam([x1 + 0.55, 4.1, -0.4], [x1 + 0.55, 7.45, -4.2], 0.12).beam([x1 + 0.55, 1.6, -4.4], [x1 + 0.55, 4.05, -4.4], 0.08);
  rooftopWaterTank(b, -3.2, top + 0.6, -3.6, 0.95);
  K.ac(b, 2.5, top + 0.6, -3.5, 0.9);
}
function saStucco(b: B, rng: RNG) {
  up(b, -8, -8, 8, 8, 0.03, K.pav(C.sidewalk));
  const x0 = -6, x1 = 6, z0 = -6, z1 = 3, top = 12.8;
  box(b, x0, 0, z0, x1, 4.0, z1, K.plain(0xcdbd9e), null);
  box(b, x0, 4.0, z0, x1, top, z1, WW(0xeee2c8, 0, 3.2), null);
  K.cornice(b, x0, z0, x1, z1, top, 0.55, 0.35, K.plain(0xf6efe0));
  up(b, x0 + 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.1, top + 0.56, K.roofP());
  K.cornice(b, x0, z0, x1, z1, 3.85, 0.18, 0.1, K.plain(0xf6efe0), null);
  twoShops(b, rng, x0, x1, z1, 4.0, { frame: 0x3a2a20, awnings: [[0x2f6b3a], [0x7a2335]], signBack: 0x3a2a20, letter: [0xff4fc3, 0x4dff88] });
  const rail = K.metal(0x5a5e63);
  for (const k of [1, 2, 3]) {
    const yb = k * 3.2 + 0.9;
    for (const cx of [-1.5, 1.5]) {
      box(b, cx - 1.2, yb, z1, cx + 1.2, yb + 0.15, z1 + 0.9, K.plain(0xf6efe0), undefined, { bottom: K.plain(0xf6efe0) });
      b.paint(rail).quad2([cx - 1.2, yb + 0.15, z1 + 0.9], [cx + 1.2, yb + 0.15, z1 + 0.9], [cx + 1.2, yb + 1.05, z1 + 0.9], [cx - 1.2, yb + 1.05, z1 + 0.9]);
    }
    for (const cx of [-4.5, 4.5]) b.paint(rail).quad2([cx - 0.85, yb + 0.1, z1 + 0.12], [cx + 0.85, yb + 0.1, z1 + 0.12], [cx + 0.85, yb + 0.9, z1 + 0.12], [cx - 0.85, yb + 0.9, z1 + 0.12]);
  }
  K.roofJunk(b, rng, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, top + 0.56, 2, true);
}
function saBay(b: B, rng: RNG) {
  up(b, -8, -8, 8, 8, 0.03, K.pav(C.sidewalk));
  const x0 = -6.6, x1 = 6.6, z0 = -6.6, z1 = 2.2, top = 13.8;
  const ww = WW(0xcfae72, 1, 3.4);
  box(b, x0, 0, z0, x1, 4.0, z1, P(0xcfc2a8, Surf.Stone), null);
  box(b, x0, 4.0, z0, x1, top, z1, ww, null);
  box(b, -2.2, 4.0, z1, 2.2, 13.1, z1 + 1.0, ww, null);
  K.cornice(b, -2.2, z1, 2.2, z1 + 1.0, 13.1, 0.3, 0.1, K.plain(0xece4d4));
  box(b, -2.2, 3.7, z1, 2.2, 4.0, z1 + 1.0, K.plain(0xece4d4), null, { bottom: K.plain(0xece4d4) });
  K.cornice(b, x0, z0, x1, z1, top, 0.7, 0.35, K.plain(0xece4d4));
  up(b, x0 + 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.1, top + 0.71, K.roofP());
  for (const k of [2, 3]) K.cornice(b, x0, z0, x1, z1, k * 3.4 + 0.45, 0.14, 0.06, K.plain(0xece4d4), null);
  twoShops(b, rng, x0, x1, z1, 4.0, { frame: 0x1f2a44, awnings: [[0x24406e], [0xd9822b, 0xf2efe6]], signBack: 0x1f2a44, letter: [0xffffff, 0x9fe8ff] });
  K.ac(b, -4, top + 0.71, -4, 1.0);
  K.ac(b, 3.5, top + 0.71, -2.5, 0.8);
  box(b, 1.5, top + 0.71, -5.6, 4.0, top + 2.8, -3.6, K.plain(0xb8b0a0), K.roofP());
}
function saMansard(b: B, rng: RNG) {
  up(b, -8, -8, 8, 8, 0.03, K.pav(C.sidewalk));
  const x0 = -6, x1 = 6, z0 = -6, z1 = 3, top = 9.6;
  const wall = WW(0x8c9bab, 0, 3.2);
  box(b, x0, 0, z0, x1, 4.0, z1, K.plain(0xf2efe6), null);
  box(b, x0, 4.0, z0, x1, top, z1, wall, null);
  K.cornice(b, x0, z0, x1, z1, top, 0.4, 0.3, K.plain(0xf2efe6), null);
  K.loft(b, K.rectPts(x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2), K.rectPts(x0 + 0.9, z0 + 0.9, x1 - 0.9, z1 - 0.9), top + 0.4, top + 2.8, P(0x4a5058, Surf.RoofTiles), K.roofP(0x6a6e73));
  for (const dx of [-4.5, -1.5, 1.5, 4.5]) {
    box(b, dx - 0.65, top + 0.6, z1 - 0.8, dx + 0.65, top + 2.0, z1 + 0.1, K.plain(0xf2efe6), null);
    faceZ(b, dx - 0.42, dx + 0.42, top + 0.75, top + 1.85, z1 + 0.12, P(0x2a3440, Surf.GlassPlain));
    b.paint(0x4a5058, Surf.RoofTiles).gableRoof(dx, z1 - 0.35, 1.3, 0.9, top + 2.0, 0.55, 'z', 0.08, K.plain(0xf2efe6));
  }
  for (const cx of [x0 + 0.8, x1 - 0.8]) box(b, cx - 0.35, top + 1.5, -2.5, cx + 0.35, top + 3.6, -1.2, P(0x9c4a36, Surf.Brick));
  twoShops(b, rng, x0, x1, z1, 4.0, { frame: 0xf2efe6, awnings: [[0x5a1a24, 0xefe6d2], [0x2f4a6b]], signBack: 0x2f4a6b, letter: [0xffc933, 0x2fd6ff] });
}
function saModern(b: B, rng: RNG) {
  up(b, -8, -8, 8, 8, 0.03, K.pav(0xd9d6d0));
  const x0 = -6.4, x1 = 6.4, z0 = -6.4, z1 = 3.2, top = 13.6;
  box(b, x0, 0, z0, x1, 4.0, z1, K.plain(0x2b2d31), null);
  box(b, x0, 4.0, z0, x1, top, z1, WW(0xf0efea, 2, 3.4), K.roofP());
  K.parapet(b, x0, z0, x1, z1, top, 0.6, 0.2, K.plain(0xf0efea));
  K.storefront(b, -6.0, -0.9, z1, { y0: 0.2, y1: 3.4, frame: 0x111111, doors: [-1.8], pitch: 1.3, surround: 0.05 });
  K.storefront(b, 0.9, 6.0, z1, { y0: 0.2, y1: 3.4, frame: 0x111111, doors: [1.8], pitch: 1.3, surround: 0.05 });
  K.letters(b, rng, -3.4, 3.5, z1 + 0.03, 4.4, 0.42, 0x2fd6ff);
  K.letters(b, rng, 3.4, 3.5, z1 + 0.03, 4.4, 0.42, 0xff4fc3);
  const rail = K.metal(0xbcc8d0);
  for (const yb of [4.3, 7.7, 11.1]) {
    box(b, x0, yb, z1, x1, yb + 0.22, z1 + 1.3, K.plain(0xf7f6f2), undefined, { bottom: K.plain(0xe2e0da) });
    b.paint(rail).quad2([x0, yb + 0.22, z1 + 1.28], [x1, yb + 0.22, z1 + 1.28], [x1, yb + 1.15, z1 + 1.28], [x0, yb + 1.15, z1 + 1.28]);
  }
  // roof terrace
  box(b, -4.5, top, -4.0, 1.5, top + 2.6, -1.0, K.plain(0x2b2d31), K.roofP());
  for (const px of [-5.0, -2.6, 2.4, 4.8]) K.planter(b, rng, px - 0.6, 0.8, px + 0.6, 2.2, 0.55, 0x55595f);
  b.push().translate(0, top, 0);
  for (const px of [-5.0, 2.4, 4.8]) K.shrub(b, rng, px, 1.5, 0.6);
  b.pop();
  K.umbrella(b, 3.2, -3.0, 1.2, 0xf2efe6, 2.4);
  b.push().translate(0, top, 0); K.umbrella(b, 3.2, -3.0, 1.2, 0xf2efe6, 2.4); b.pop();
}
function saTurret(b: B, rng: RNG) {
  up(b, -8, -8, 8, 8, 0.03, K.pav(C.sidewalk));
  const x0 = -6.6, x1 = 6.6, z0 = -6.6, z1 = 2.2, top = 13.8;
  const ww = WW(0xb5835a, 1, 3.4);
  box(b, x0, 0, z0, x1, 4.0, z1, P(0x8a5a3c, Surf.Brick), null);
  box(b, x0, 4.0, z0, x1, top, z1, ww, null);
  K.cornice(b, x0, z0, x1, z1, top, 0.55, 0.3, P(0xe0d4bc, Surf.Stone));
  up(b, x0 + 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.1, top + 0.56, K.roofP());
  K.cornice(b, x0, z0, x1, z1, 3.8, 0.22, 0.08, P(0xe0d4bc, Surf.Stone), null);
  // corner turret
  const tc: K.V2 = [5.6, 1.3];
  const oct = K.ngonPts(tc[0], tc[1], 2.25, 8, Math.PI / 8);
  K.loft(b, K.ngonPts(tc[0], tc[1], 1.0, 8, Math.PI / 8), oct, 3.2, 4.0, P(0xe0d4bc, Surf.Stone), null);
  K.prismPts(b, oct, 4.0, 14.3, ww, null);
  K.bandPts(b, oct, 14.3, 14.7, P(0xe0d4bc, Surf.Stone), 0.2);
  b.paint(0x4d6b60, Surf.Metal).cylinder(tc[0], tc[1], 14.7, 2.3, 2.45, 0.05, 8, { smooth: false, top: false });
  box(b, tc[0] - 0.05, 17.0, tc[1] - 0.05, tc[0] + 0.05, 17.5, tc[1] + 0.05, K.metal(0x333333), null);
  twoShops(b, rng, x0, 3.2, z1, 4.0, { frame: 0x2a1e16, awnings: [[0x8a2a1e], [0x2f6b3a, 0xefe6d2]], signBack: 0x2a1e16, letter: [0xff8a2a, 0xffd88a] });
  K.onSide(b, 'px', () => {
    K.storefront(b, -0.4, 4.6, x1, { y1: 2.8, frame: 0x2a1e16, doors: [0.6], pitch: 1.6 });
    K.awning(b, -0.5, 4.7, x1, 2.85, 1.2, 0.55, [0x8a2a1e], 1, 0.28);
  });
  K.roofJunk(b, rng, x0 + 0.6, z0 + 0.6, 2.5, z1 - 0.6, top + 0.56, 2, true);
}
const shopsApartments: ModelBuildFn = (b, v, rng) => [saBrick, saStucco, saBay, saMansard, saModern, saTurret][v % 6](b, rng);

// ============================================================================================ MOTEL (3x2)
function motel(b: B, v: number, rng: RNG) {
  const pal = [
    { wall: 0xf4c9d2, door: 0x2fb5b0, rail: 0x2fb5b0, trim: 0xffffff, neonA: 0xff4fc3, neonB: 0x2fd6ff, mansard: false },
    { wall: 0xe8d8b8, door: 0xd96a1e, rail: 0x6b4a36, trim: 0x6b4a36, neonA: 0xff8a2a, neonB: 0xffd23f, mansard: true },
    { wall: 0xf0f0ec, door: 0x24406e, rail: 0x8f979e, trim: 0x24406e, neonA: 0x2fb8ff, neonB: 0xff3b30, mansard: false },
  ][v % 3];
  // v0/v1: L-shape around a parking court with the pool in the corner; v2: straight bar, parking in front, pool at the side
  const L = v % 3 !== 2;
  up(b, -24, -16, 24, 16, 0.03, K.pav(0xb3aea2));
  up(b, -24, 14.4, 24, 16, 0.07, K.foliage(C.grass));
  const wall = K.plain(pal.wall);
  const H = 6.0, fh = 3.05;
  const bw = { x0: -22.5, x1: L ? 16.5 : 13.6, z0: -15.5, z1: -7.8 };
  const lw = { x0: -22.5, x1: -14.6, z0: -7.8, z1: 10.8 };
  const backW = WW(pal.wall, 4, fh);
  box(b, bw.x0, 0, bw.z0, bw.x1, H, bw.z1, wall, K.roofP(), { nz: backW, nx: backW });
  if (L) box(b, lw.x0, 0, lw.z0, lw.x1, H, lw.z1, wall, K.roofP(), { nz: null, nx: backW });
  const galP = K.plain(0xd8d4cc);
  const railP = K.plain(pal.rail);
  const trimP = K.plain(pal.trim);
  const g0 = L ? lw.x1 : bw.x0;
  // back-wing gallery
  const gz = -5.9;
  box(b, g0, fh - 0.2, bw.z1, bw.x1, fh, gz, galP, undefined, { bottom: galP });
  b.paint(railP).quad2([g0, fh, gz], [bw.x1, fh, gz], [bw.x1, fh + 0.95, gz], [g0, fh + 0.95, gz]);
  box(b, g0 - (L ? 0 : 0.3), H, bw.z1, bw.x1 + 0.3, H + 0.25, gz - 0.2, trimP, undefined, { bottom: trimP });
  for (let x = g0 + 0.2; x <= bw.x1; x += 4.3) box(b, x - 0.12, 0, gz - 0.12, x + 0.12, H, gz + 0.12, trimP, null);
  // left-wing gallery
  const gx = -12.7;
  if (L) {
    box(b, lw.x1, fh - 0.2, gz, gx, fh, lw.z1, galP, undefined, { bottom: galP });
    b.paint(railP).quad2([gx, fh, lw.z1], [gx, fh, gz], [gx, fh + 0.95, gz], [gx, fh + 0.95, lw.z1]);
    box(b, lw.x1, H, gz - 0.2, gx - 0.2, H + 0.25, lw.z1 + 0.3, trimP, undefined, { bottom: trimP });
    for (let z = lw.z1 - 0.2; z >= gz; z -= 4.3) box(b, gx - 0.12, 0, z - 0.12, gx + 0.12, H, z + 0.12, trimP, null);
  }
  // rooms: door + porch light + window + AC grille
  const doorP = K.plain(pal.door), winP = P(0x2a3440, Surf.GlassPlain), acP = K.plain(0xcfd2d4), lampP = K.emis(0xffc870, 4);
  for (const y0 of [0, fh]) {
    for (let x = g0 + 0.6; x + 3.6 < bw.x1; x += 4.3) {
      faceZ(b, x, x + 0.95, y0 + 0.02, y0 + 2.15, bw.z1 + 0.02, doorP);
      faceZ(b, x + 0.28, x + 0.68, y0 + 2.3, y0 + 2.52, bw.z1 + 0.03, lampP);
      faceZ(b, x + 1.5, x + 3.2, y0 + 1.0, y0 + 2.2, bw.z1 + 0.02, winP);
      faceZ(b, x + 1.9, x + 2.8, y0 + 0.45, y0 + 0.85, bw.z1 + 0.02, acP);
    }
    if (L) for (let z = lw.z1 - 0.6; z - 3.6 > lw.z0; z -= 4.3) {
      faceX(b, z - 0.95, z, y0 + 0.02, y0 + 2.15, lw.x1 + 0.02, doorP, 1);
      faceX(b, z - 0.68, z - 0.28, y0 + 2.3, y0 + 2.52, lw.x1 + 0.03, lampP, 1);
      faceX(b, z - 3.2, z - 1.5, y0 + 1.0, y0 + 2.2, lw.x1 + 0.02, winP, 1);
      faceX(b, z - 2.8, z - 1.9, y0 + 0.45, y0 + 0.85, lw.x1 + 0.02, acP, 1);
    }
  }
  // stairs
  b.paint(0x9a9690, Surf.Plain).beam([bw.x1 + 1.1, 0, gz - 0.3], [bw.x1 + 1.1, fh, bw.z1 - 4.5], 1.1);
  box(b, bw.x1, fh - 0.2, bw.z1 - 5.2, bw.x1 + 1.7, fh, bw.z1, galP, undefined, { bottom: galP });
  if (pal.mansard) {
    K.loft(b, K.rectPts(bw.x0 - 0.3, bw.z0 - 0.3, bw.x1 + 0.3, gz + 0.1), K.rectPts(bw.x0 + 1.2, bw.z0 + 1.2, bw.x1 - 1.2, bw.z1 - 1.0), H + 0.25, H + 1.6, P(0x6b4a36, Surf.RoofTiles), K.roofP());
    K.loft(b, K.rectPts(lw.x0 - 0.3, bw.z1 - 1.0, gx + 0.1, lw.z1 + 0.4), K.rectPts(lw.x0 + 1.2, bw.z1, lw.x1 - 1.0, lw.z1 - 1.0), H + 0.25, H + 1.6, P(0x6b4a36, Surf.RoofTiles), K.roofP());
  } else {
    for (let i = 0; i < 5; i++) K.ac(b, -18 + i * 7.5, H, -12.5, 0.9);
  }
  if (L) {
    // parking court + pool courtyard in the L
    K.asphalt(b, -12.8, -6.0, 24, 14.4);
    K.stallsX(b, rng, -12.4, 15.8, -5.7, -1, 0.5);
    K.stallsZ(b, rng, -0.3, 13.8, -12.5, -1, 0.5);
    up(b, -5.4, 3.2, 9.4, 12.8, 0.09, K.foliage(C.grass));
    pool(b, 2.0, 8.0, 8.5, 4.2);
    fenceLine(b, -5.2, 3.4, 9.2, 3.4);
    fenceLine(b, 9.2, 3.4, 9.2, 12.6);
    fenceLine(b, 9.2, 12.6, -5.2, 12.6);
    fenceLine(b, -5.2, 12.6, -5.2, 3.4);
    for (const lx of [-3.2, -1.6]) box(b, lx - 0.35, 0.1, 6.5, lx + 0.35, 0.45, 8.3, K.plain(0xf4f4f0));
    K.umbrella(b, -2.4, 10.8, 1.1, pal.neonA, 2.3);
  } else {
    // two parking rows in front of the bar, pool on the side behind the office
    K.asphalt(b, -24, -6.0, 24, 3.4);
    K.asphalt(b, -24, 3.4, 11.8, 14.4);
    K.stallsX(b, rng, -22.4, 13.2, -5.7, -1, 0.55);
    K.stallsX(b, rng, -22.4, 10.8, 6.2, 1, 0.4);
    K.lotLamp(b, -12, 11.9, 6.5, [Math.PI]);
    K.lotLamp(b, 3, 11.9, 6.5, [Math.PI]);
    up(b, 15.4, -15.8, 24, -4.2, 0.08, K.foliage(C.grass));
    pool(b, 19.6, -10.0, 4.2, 7.4);
    fenceLine(b, 15.9, -15.3, 23.4, -15.3);
    fenceLine(b, 23.4, -15.3, 23.4, -4.6);
    fenceLine(b, 23.4, -4.6, 15.9, -4.6);
    fenceLine(b, 15.9, -4.6, 15.9, -15.3);
    for (const lz of [-13.4, -11.6]) box(b, 16.6, 0.1, lz - 0.35, 18.4, 0.45, lz + 0.35, K.plain(0xf4f4f0));
    K.umbrella(b, 17.4, -6.4, 1.1, pal.neonA, 2.3);
    K.palm(b, rng, 22.6, -5.4, 0.55);
  }
  // office
  const ox0 = 12.4, ox1 = 21.2, oz0 = 3.6, oz1 = 11.0;
  box(b, ox0, 0, oz0, ox1, 4.0, oz1, wall, K.roofP());
  box(b, ox0 - 3.5, 3.6, oz0 + 0.5, ox1 + 0.4, 4.1, oz1 + 0.4, trimP, undefined, { bottom: trimP });
  for (const [cx, cz] of [[ox0 - 3.2, oz0 + 0.8], [ox0 - 3.2, oz1 + 0.1]] as [number, number][]) box(b, cx - 0.15, 0, cz - 0.15, cx + 0.15, 3.6, cz + 0.15, trimP, null);
  K.storefront(b, ox0 + 0.8, ox1 - 0.8, oz1, { y1: 3.0, frame: pal.trim, doors: [ox0 + 2.2], pitch: 1.6 });
  K.onSide(b, 'nx', () => K.storefront(b, oz0 + 1.0, oz1 - 1.0, -ox0, { y1: 3.0, frame: pal.trim, pitch: 1.6 }));
  K.letters(b, rng, (ox0 + ox1) / 2, 4.2, oz1 + 0.45, 5, 0.6, pal.neonB, { n: 6, words: 1 });
  // tall neon sign
  const sx = 20.2, sz = 13.4, sh = 9.6;
  K.pylon(b, sx, sz, sh, 4.4, [{ h: 3.0, color: pal.neonA }, { h: 0.85, color: pal.neonB, w: 3.4 }], { poles: 2, pole: 0x5a5e63, frame: 0x2a2a2a, cap: pal.neonB });
  K.letters(b, rng, sx, sh - 2.35, sz + 0.28, 3.8, 1.6, pal.neonB, { n: 5, words: 1, k: 8 });
  K.pylonLetters(b, rng, sx, sz, sh - 3.0 - 0.12 - 0.72, 0.55, 3.0, 0x1a1a1a, { n: 7 });
  const ay = sh - 4.6;
  b.paint(0xffd23f, Surf.Emissive, 8).beam([sx - 2.0, ay + 0.5, sz], [sx - 3.6, ay - 0.6, sz], 0.3).beam([sx - 3.6, ay - 0.6, sz], [sx - 2.4, ay - 1.6, sz], 0.3);
  // front landscaping
  for (let tx = -20; tx <= 12; tx += 8) {
    if (v % 3 === 0) K.palm(b, rng, tx, 15.0, 0.55);
    else K.tree(b, rng, tx, 15.0, 0.6);
  }
}

// ============================================================================================ SUPERMARKET (3x3)
function supermarket(b: B, v: number, rng: RNG) {
  const cfg = [
    { wall: K.plain(0xe4d8c2), brand: 0xb8262b, letter: 0xffffff, band: 0xb8262b, canopy: 0xb8262b },
    { wall: P(0x9a6a42, Surf.Wood), brand: 0x2f6b3a, letter: 0x9dff7a, band: 0x2f6b3a, canopy: 0x3a3e44 },
    { wall: P(0x2a5ea8, Surf.Corrugated), brand: 0xf4f2ea, letter: 0xffd21f, band: 0xffd21f, canopy: 0x1d3f75 },
  ][v % 3];
  up(b, -24, -24, 24, 24, 0.03, K.pav(C.sidewalk));
  const bx0 = -17.4, bx1 = 22.8, bz0 = -23.2, bz1 = -7.6, h = 7.6;
  box(b, bx0, 0, bz0, bx1, h, bz1, cfg.wall, K.roofP());
  K.parapet(b, bx0, bz0, bx1, bz1, h, 0.8, 0.3, v === 2 ? K.plain(0xf4f2ea) : cfg.wall);
  faceZ(b, bx0, bx1, 5.0, 5.6, bz1 + 0.02, K.plain(cfg.band));
  const ec = 2.7, ew = 7.6;
  // entrance block
  if (v === 1) {
    box(b, ec - ew, 0, bz1 - 1.0, ec + ew, 8.4, bz1 + 1.6, P(0xb58a5c, Surf.Wood), null);
    b.paint(0x2f5a3e, Surf.Metal).gableRoof(ec, bz1 + 0.3, ew * 2 + 0.6, 5.6, 8.4, 3.2, 'z', 0.5, P(0xb58a5c, Surf.Wood));
    K.storefront(b, ec - 6.4, ec + 6.4, bz1 + 1.6, { y0: 0.2, y1: 5.8, frame: 0x2b2b2b, doors: [ec - 3.2, ec + 3.2], pitch: 1.6, transom: 3.2 });
    K.letters(b, rng, ec, 6.35, bz1 + 1.64, 11, 1.4, cfg.letter, { mixed: true, words: 2 });
  } else if (v === 2) {
    box(b, ec - ew, 0, bz1 - 1, ec + ew, 10.2, bz1 + 0.6, K.plain(0xf4f2ea), K.roofP());
    K.letters(b, rng, ec, 6.6, bz1 + 0.64, 14, 2.6, cfg.letter, { n: 6, words: 1 });
    box(b, ec - 5, 0, bz1 + 0.6, ec + 5, 4.4, bz1 + 4.2, P(0x2a3440, Surf.GlassPlain), K.roofP(0xa0a0a0));
    K.storefront(b, ec - 4.6, ec + 4.6, bz1 + 4.2, { y0: 0.05, y1: 4.1, frame: 0x1d3f75, doors: [ec - 2.2, ec + 2.2], pitch: 1.5, surround: 0.08 });
  } else {
    box(b, ec - ew, 0, bz1 - 1, ec + ew, 10.4, bz1 + 1.4, K.plain(cfg.brand), K.roofP());
    K.parapet(b, ec - ew, bz1 - 1, ec + ew, bz1 + 1.4, 10.4, 0.4, 0.25, K.plain(0xf2efe6));
    K.storefront(b, ec - 6.2, ec + 6.2, bz1 + 1.4, { y0: 0.2, y1: 5.2, frame: 0xdedede, doors: [ec - 3, ec + 3], pitch: 1.55, transom: 3.0 });
    K.letters(b, rng, ec, 6.3, bz1 + 1.44, 13.5, 2.4, cfg.letter, { n: 9, words: 2 });
  }
  // walkway canopies + small display windows
  for (const [a, e] of [[bx0, ec - ew], [ec + ew, bx1]] as [number, number][]) {
    K.canopy(b, a, e, bz1, 3.6, 2.6, 0.35, K.plain(cfg.canopy));
    for (let x = a + 1.5; x + 3 < e; x += 4.5) K.storefront(b, x, x + 3, bz1, { y0: 0.9, y1: 3.0, frame: 0x444444, pitch: 1.5, surround: 0.08 });
    for (let x = a + 0.3; x < e; x += 5.5) box(b, x - 0.12, 0, bz1 + 2.3, x + 0.12, 3.6, bz1 + 2.54, K.metal(0x8a9096), null);
  }
  // loading dock (-X)
  K.asphalt(b, -24, -23.8, bx0, -7.8, 0.06, C.asphaltDark);
  K.onSide(b, 'nx', () => {
    // local z = -world x ; local x = world z
    for (const dz of [-20.5, -16.5, -12.5]) {
      faceZ(b, dz - 1.4, dz + 1.4, 0.9, 4.0, -bx0 + 0.02, K.metal(0x6d7278));
      box(b, dz - 1.8, 0.0, -bx0, dz + 1.8, 1.1, -bx0 + 0.8, K.plain(0x2a2a2a));
    }
  });
  K.truck(b, -21.3, -16.2, Math.PI, 0xf2f2f2, cfg.brand === 0xf4f2ea ? 0x2a5ea8 : cfg.brand, 9);
  K.dumpster(b, -21.0, -9.6, 0x2f5d3a, Math.PI / 2);
  // parking
  K.asphalt(b, -24, -5.0, 24, 22.4);
  for (let i = 0; i < 6; i++) up(b, ec - 3 + i * 1.1, -4.9, ec - 2.45 + i * 1.1, 0.0, 0.09, K.plain(C.line));
  const r1 = -0.2;
  K.stallsX(b, rng, -21, 21, r1, -1, 0.5);
  K.stallsX(b, rng, -21, 21, r1 + 5.2, 1, 0.42);
  K.stallsX(b, rng, -21, 21, 16.9, -1, 0.24);
  for (const [ix0, ix1] of [[-24, -21.2], [21.2, 24]] as [number, number][]) {
    up(b, ix0, r1, ix1, r1 + 10.4, 0.1, K.foliage(C.grass));
    up(b, ix0, 16.9, ix1, 22.1, 0.1, K.foliage(C.grass));
    K.tree(b, rng, (ix0 + ix1) / 2, r1 + 5.2, 0.62);
    K.tree(b, rng, (ix0 + ix1) / 2, 19.5, 0.6);
  }
  for (const lx of [-11, 2.7, 16]) K.lotLamp(b, lx, r1 + 5.2, 8.0, [Math.PI / 2, -Math.PI / 2]);
  for (const cx of [-5.5, 11.5]) {
    const cp = K.metal(0x9aa0a6);
    b.paint(cp).beam([cx - 1.3, 1.0, r1 + 6.0], [cx - 1.3, 1.0, r1 + 9.8], 0.08).beam([cx + 1.3, 1.0, r1 + 6.0], [cx + 1.3, 1.0, r1 + 9.8], 0.08);
    box(b, cx - 1.1, 0.06, r1 + 6.4, cx + 1.1, 1.0, r1 + 9.2, K.metal(0xb8bcc2), null);
  }
  up(b, -24, 22.4, 24, 24, 0.08, K.foliage(C.grass));
  K.pylon(b, -19.5, 23.0, 8.8, 3.2, [{ h: 1.6, color: cfg.brand === 0xf4f2ea ? 0x2a5ea8 : cfg.brand }, { h: 0.9, color: cfg.letter, k: 5 }], { poles: 0, pole: v === 1 ? 0x7a5634 : 0x8e8b84, frame: 0x2a2a2a });
  K.pylonLetters(b, rng, -19.5, 23.0, 7.55, 0.9, 2.8, 0xffffff, { both: true, n: 6 });
  K.pylonLetters(b, rng, -19.5, 23.0, 6.35, 0.55, 2.8, 0x1a1a1a, { both: true, n: 7 });
  if (v === 1) {
    for (let i = 0; i < 4; i++) {
      const px = ec - 9.5 - i * 1.6;
      box(b, px - 0.7, 0, bz1 + 0.6, px + 0.7, 0.8, bz1 + 1.8, P(0x8b6a47, Surf.Wood), K.foliage([0xb8322a, 0xe98a2a, 0x7aa83a, 0xe8c547][i]));
    }
  }
  K.roofJunk(b, rng, bx0 + 2, bz0 + 2, bx1 - 2, bz1 - 2, h, 7, true);
}

// ============================================================================================ HOTEL (2x2)
function rooftopLetters(b: B, rng: RNG, cx: number, y: number, z: number, w: number, lh: number, color: number, frame = 0x3a3d40) {
  box(b, cx - w / 2, y, z - 0.15, cx + w / 2, y + 0.25, z + 0.15, K.metal(frame));
  for (let x = cx - w / 2 + 0.6; x <= cx + w / 2 - 0.5; x += (w - 1.1) / 3) b.paint(frame, Surf.Metal).beam([x, y + 0.25, z - 0.05], [x, y + lh + 0.3, z - 0.05], 0.12);
  K.letters(b, rng, cx, y + 0.4, z + 0.1, w - 0.4, lh, color, { words: 1, n: 5 });
}
function hotelBrick(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(C.sidewalk));
  const x0 = -13.2, x1 = 13.2, z0 = -11, z1 = 4.4, base = 6.6, top = 29.7;
  const stone = P(0xd8ccb4, Surf.Stone);
  box(b, x0, 0, z0, x1, base, z1, stone, null);
  box(b, x0, base, z0, x1, top, z1, WW(0x9a4b38, 1, 3.3), null);
  K.cornice(b, x0, z0, x1, z1, base - 0.3, 0.5, 0.25, P(0xe6dcc6, Surf.Stone), null);
  K.cornice(b, x0, z0, x1, z1, top, 0.9, 0.6, P(0xe6dcc6, Surf.Stone));
  up(b, x0 + 0.2, z0 + 0.2, x1 - 0.2, z1 - 0.2, top + 0.91, K.roofP());
  // lobby arches
  for (let x = x0 + 1.2; x + 2.6 <= x1 - 1; x += 3.6) {
    if (Math.abs(x + 1.3) < 3) continue;
    K.storefront(b, x, x + 2.6, z1, { y0: 0.7, y1: 5.2, frame: 0x2a2320, pitch: 1.3, transom: 3.9 });
  }
  K.storefront(b, -2.4, 2.4, z1, { y0: 0.05, y1: 5.4, frame: 0xc9a24a, doors: [-0.9, 0.9], doorW: 1.6, transom: 3.2 });
  K.onSide(b, 'px', () => { for (let x = -3.2; x + 2.6 <= 10; x += 3.6) K.storefront(b, x, x + 2.6, x1, { y0: 0.7, y1: 5.2, frame: 0x2a2320, pitch: 1.3, transom: 3.9 }); });
  // marquee canopy to the curb + flags
  K.canopy(b, -4.2, 4.2, z1, 4.3, 3.3, 0.55, K.plain(0x7a2335), K.emis(0xfff0cc));
  K.letters(b, rng, 0, 4.9, z1 + 3.0, 6.5, 0.5, 0xffd88a, { words: 1 });
  for (const fx of [-2.2, 0, 2.2]) K.facadeFlag(b, fx, 6.2, z1, [0x2e6fb5, 0xc0392b, 0xf2f0ea][(fx / 2.2 + 1) | 0], 2.3);
  for (const [px, pz] of [[-7, 6.2], [7, 6.2]] as [number, number][]) K.planter(b, rng, px - 1.1, pz - 0.6, px + 1.1, pz + 0.6, 0.7, 0x8e8b84, true);
  // vintage rooftop sign + tank
  rooftopLetters(b, rng, 0, top + 0.9, -2.0, 13, 3.4, 0xff3b30);
  rooftopWaterTank(b, -9.5, top + 0.9, -7.5, 1.1);
  K.ac(b, 8, top + 0.9, -7, 1.2);
  // rear service wing
  box(b, -10, 0, -15.4, 10, 6.6, z0, P(0x9a4b38, Surf.Brick), K.roofP());
}
function hotelModern(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(0xd6d2ca));
  const x0 = -12.6, x1 = 12.6, z0 = -8.4, z1 = 4.2, base = 6.4, top = 35.2;
  // podium
  const px0 = -15.2, px1 = 15.2, pz0 = -15.2, pz1 = 6.2;
  box(b, px0, 0, pz0, px1, base, pz1, K.plain(0xe9e7e2), K.roofP(0x9a9892));
  K.storefront(b, -14.2, 14.2, pz1, { y0: 0.2, y1: 5.6, frame: 0x2b2d31, doors: [-1.2, 1.2], pitch: 1.8, transom: 3.4, surround: 0.1 });
  K.onSide(b, 'px', () => K.storefront(b, -5.2, 14.2, px1, { y0: 0.2, y1: 5.6, frame: 0x2b2d31, pitch: 1.8, transom: 3.4, surround: 0.1 }));
  // slab with balcony bands
  box(b, x0, base, z0, x1, top, z1, WW(0xf2f0ea, 3, 3.2), K.roofP());
  for (let k = 2; k < 11; k++) {
    const y = k * 3.2 + 0.25;
    box(b, x0 - 0.2, y, z1, x1 + 0.2, y + 0.18, z1 + 1.2, K.plain(0xf7f6f2), undefined, { bottom: K.plain(0xdedcd6) });
    faceZ(b, x0 - 0.2, x1 + 0.2, y + 0.18, y + 1.0, z1 + 1.19, K.metal(0x9fb3c0));
  }
  // vertical sign fin
  box(b, x1 - 0.2, 9.5, z1 + 1.3, x1 + 0.4, top - 1.0, z1 + 2.4, K.plain(0x2b2d31), undefined, { px: K.emis(0x2fd6ff, 7) });
  for (let i = 0; i < 5; i++) faceZ(b, x1 - 0.1, x1 + 0.3, 12 + i * 4.3, 15.4 + i * 4.3, z1 + 2.42, K.emis(0x2fd6ff, 7));
  // pool terrace on podium
  b.push().translate(0, base, 0);
  pool(b, 0, -11.6, 14, 4.2);
  for (const lx of [-8, -5, 5, 8]) box(b, lx - 0.35, 0.12, -14.6, lx + 0.35, 0.45, -13.0, K.plain(0xf4f4f0));
  K.umbrella(b, -11.5, -12, 1.2, 0x2fb5b0, 2.4);
  K.umbrella(b, 11.5, -12, 1.2, 0x2fb5b0, 2.4);
  b.pop();
  // porte-cochere
  box(b, -6, 4.6, pz1, 6, 5.2, pz1 + 6.4, K.plain(0xf2f0ea), K.roofP(0xb9b6ae), { bottom: K.emis(0xe8e2d4, K.CANOPY_K), nz: null });
  for (const cx of [-5.4, 5.4]) box(b, cx - 0.25, 0, pz1 + 5.6, cx + 0.25, 4.6, pz1 + 6.1, K.metal(0xb8bcc2), null);
  K.letters(b, rng, 0, 5.3, pz1 + 6.1, 8, 0.8, 0x2fd6ff, { words: 1 });
  rooftopLetters(b, rng, 0, top, z1 - 1.0, 14, 2.6, 0x2fd6ff, 0x2b2d31);
  box(b, -9, top, z0 + 1, -3, top + 3, z0 + 5, K.plain(0xd8d6d0), K.roofP());
  K.car(b, 2.5, pz1 + 3.2, Math.PI / 2, 0x1e1e1e, 0.06, true);
}
function hotelDeco(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(0xd6cfc0));
  const ww = WW(0xd6c3a0, 1, 3.3);
  const t1 = { x0: -13.2, x1: 13.2, z0: -13.2, z1: 4.4 };
  box(b, t1.x0, 0, t1.z0, t1.x1, 6.6, t1.z1, P(0xc4b08c, Surf.Stone), null);
  box(b, t1.x0, 6.6, t1.z0, t1.x1, 29.7, t1.z1, ww, K.roofP());
  box(b, -8.8, 29.7, -11, 8.8, 36.3, 2.2, ww, K.roofP());
  box(b, -4.4, 36.3, -8.8, 4.4, 39.6, -2.2, ww, K.roofP());
  const piers = P(0xe2d2b0, Surf.Stone);
  for (let x = t1.x0; x <= t1.x1 + 0.01; x += 4.4) box(b, x - 0.3, 6.6, t1.z1, x + 0.3, 30.4, t1.z1 + 0.35, piers, undefined);
  for (let x = -8.8; x <= 8.81; x += 4.4) box(b, x - 0.25, 29.7, 2.2, x + 0.25, 37.0, 2.5, piers);
  for (let x = -4.4; x <= 4.41; x += 2.2) box(b, x - 0.12, 38.2, -2.2, x + 0.12, 41.0, -1.95, K.emis(0xffd88a));
  K.bandRect(b, -4.4, -8.8, 4.4, -2.2, 39.3, 39.6, K.emis(0xffd88a), 0.05);
  // ground floor shops & entrance
  for (let x = t1.x0 + 1.0; x + 3.2 < t1.x1; x += 4.4) {
    if (Math.abs(x + 1.6) < 3) continue;
    K.storefront(b, x, x + 3.2, t1.z1, { y0: 0.6, y1: 4.8, frame: 0x2a2320, pitch: 1.6, transom: 3.6 });
  }
  K.storefront(b, -2.2, 2.2, t1.z1, { y0: 0.05, y1: 5.6, frame: 0xc9a24a, doors: [0], doorW: 2.2, transom: 3.4 });
  box(b, -3.6, 3.9, t1.z1, 3.6, 4.5, t1.z1 + 3.6, K.metal(0x2a2a2a), undefined, { bottom: K.emis(0xfff0cc, K.CANOPY_K), nz: null });
  faceZ(b, -3.6, 3.6, 3.95, 4.45, t1.z1 + 3.62, K.emis(0xffd88a));
  K.bladeSign(b, t1.x1 - 0.8, t1.z1 + 0.35, 9, 12, 1.4, 0xff4f6a, 0x2a2a2a);
  K.facadeFlag(b, -5, 6.0, t1.z1 + 0.35, 0x1d3a6b, 2.2);
  K.facadeFlag(b, 5, 6.0, t1.z1 + 0.35, 0x1d3a6b, 2.2);
  K.mast(b, 0, -5.5, 39.6, 5.5, 0.25, 0.06, K.metal(0xcfcfcf));
}
function hotelGlass(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(0xd9d4ca));
  const x0 = -12, x1 = 12, z0 = -10.5, z1 = 3, base = 5.1, top = 28.9;
  const stone = P(0xe8e1d2, Surf.Stone);
  box(b, x0 - 0.4, 0, z0 - 0.4, x1 + 0.4, base, z1 + 0.4, stone, null);
  K.storefront(b, x0 + 1, x1 - 1, z1 + 0.4, { y0: 0.2, y1: 4.5, frame: 0x7d5c3a, doors: [0], doorW: 2.2, pitch: 2.0, transom: 3.2 });
  box(b, x0, base, z0, x1, top, z1, GC(5, 3.4), K.roofP());
  for (const cx of [x0, x1]) for (const cz of [z0, z1]) box(b, cx - 0.6, base, cz - 0.6, cx + 0.6, top + 0.6, cz + 0.6, stone);
  K.cornice(b, x0, z0, x1, z1, top, 0.6, 0.3, stone, null);
  for (let k = 0; k < 3; k++) {
    const y = base + 3.4 * (2 + k * 2);
    box(b, -6, y, z1, 6, y + 0.15, z1 + 1.1, stone, undefined, { bottom: stone });
    faceZ(b, -6, 6, y + 0.15, y + 1.0, z1 + 1.09, K.metal(0x8a8f94));
  }
  // rooftop bar
  box(b, -8, top, -6, 2, top + 3.2, 0, P(0x2a3440, Surf.GlassPlain, 2), K.roofP(0x6a6e73));
  box(b, -8.4, top + 3.2, -6.4, 2.4, top + 3.45, 0.4, K.metal(0x7d5c3a));
  up(b, 2.4, -9, 11.2, 2.2, top + 0.02, P(0x8b6a47, Surf.Wood));
  b.push().translate(0, top, 0);
  for (const [ux, uz] of [[5, -6.5], [9, -6.5], [5, -1.5], [9, -1.5]] as [number, number][]) K.umbrella(b, ux, uz, 1.1, 0xf2efe6, 2.3);
  b.pop();
  b.paint(0xffd89a, Surf.Emissive).beam([2.6, top + 2.6, -8.8], [11, top + 2.4, 2.0], 0.07).beam([11, top + 2.6, -8.8], [2.6, top + 2.4, 2.0], 0.07);
  // entrance canopy + name
  K.canopy(b, -4.5, 4.5, z1 + 0.4, 4.6, 3.6, 0.3, K.metal(0x7d5c3a), K.emis(0xffd88a));
  K.letters(b, rng, 0, 4.95, z1 + 3.8, 7, 0.75, 0xffe6b0, { mixed: true, words: 1 });
  for (const px of [-8.5, 8.5]) K.planter(b, rng, px - 1.4, 5.2, px + 1.4, 6.6, 0.6, 0x7d5c3a, true);
  K.car(b, -2.0, 6.2, Math.PI / 2, 0xe0b020);
}
const hotel: ModelBuildFn = (b, v, rng) => [hotelBrick, hotelModern, hotelDeco, hotelGlass][v % 4](b, rng);

// ============================================================================================ DEPARTMENT STORE (2x2)
function deptBeaux(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(0xd9d3c7));
  const x0 = -12.8, x1 = 12.8, z0 = -12.8, z1 = 6.4, base = 8.4, top = 21.0;
  const stone = P(0xe0d4bc, Surf.Stone);
  box(b, x0, 0, z0, x1, base, z1, stone, null);
  box(b, x0, base, z0, x1, top, z1, WW(0xe0d4bc, 7, 4.2), null);
  K.cornice(b, x0, z0, x1, z1, base - 0.4, 0.5, 0.25, P(0xece2cc, Surf.Stone), null);
  box(b, x0 - 0.5, top, z0 - 0.5, x1 + 0.5, top + 0.7, z1 + 0.5, P(0xece2cc, Surf.Stone), null);
  box(b, x0, top + 0.7, z0, x1, top + 2.2, z1, stone, K.roofP());
  // display windows w/ awnings between piers
  const bays = [[-12.0, -8.4], [-7.6, -3.6], [3.6, 7.6]] as [number, number][];
  for (const [a, e] of bays) {
    K.storefront(b, a, e, z1, { y0: 0.7, y1: 4.2, frame: 0x6b4a2a, pitch: 2.0, transom: 3.5 });
    K.storefront(b, a + 0.3, e - 0.3, z1, { y0: 5.4, y1: 7.4, frame: 0x6b4a2a, pitch: 1.2, surround: 0.08 });
    K.awning(b, a - 0.1, e + 0.1, z1, 4.6, 1.3, 0.6, [0x6b1f2a], 1, 0.3);
  }
  for (const px of [-12.4, -8.0, -3.2, 3.2, 8.0]) box(b, px - 0.4, 0, z1, px + 0.4, base - 0.4, z1 + 0.35, stone);
  // grand entrance
  K.storefront(b, -2.6, 2.6, z1, { y0: 0.05, y1: 5.2, frame: 0xc9a24a, doors: [-1.2, 1.2], doorW: 1.6, transom: 3.4 });
  faceZ(b, -2.6, 2.6, 5.6, 7.6, z1 + 0.02, P(0x2a3440, Surf.GlassPlain));
  K.letters(b, rng, 0, 8.7, z1 + 0.05, 9, 0.9, 0xffd88a, { words: 1, n: 7 });
  for (const fx of [-3.2, 0, 3.2]) K.facadeFlag(b, fx, 11.8, z1, [0x1d3a6b, 0x6b1f2a, 0x1d3a6b][(fx / 3.2 + 1) | 0], 2.6);
  // corner rotunda with dome
  const rc: K.V2 = [11.2, 5.0];
  b.paint(0xe0d4bc, Surf.WallWindows, 7, 4.2).cylinder(rc[0], rc[1], 0, top + 0.7, 3.4, 3.4, 12, { top: false, smooth: true });
  box(b, rc[0] - 3.8, top + 0.7, rc[1] - 3.8, rc[0] + 3.8, top + 1.3, rc[1] + 3.8, P(0xece2cc, Surf.Stone));
  b.paint(0x5f8f80, Surf.Metal).sphere(rc[0], top + 1.3, rc[1], 3.2, 12, 6, { hemi: true, scaleY: 0.9 });
  b.paint(0xece2cc, Surf.Stone).cylinder(rc[0], rc[1], top + 4.0, 1.6, 0.6, 0.5, 6, {});
  // side display windows
  K.onSide(b, 'px', () => {
    for (let x = -4.3; x + 4 <= 12.2; x += 5) {
      K.storefront(b, x, x + 3.6, x1, { y0: 0.7, y1: 4.2, frame: 0x6b4a2a, pitch: 1.8, transom: 3.5 });
      K.awning(b, x - 0.1, x + 3.7, x1, 4.6, 1.2, 0.55, [0x6b1f2a], 1, 0.3);
    }
  });
  K.roofJunk(b, rng, x0 + 1, z0 + 1, x1 - 5, z1 - 3, top + 2.2, 4, true);
}
function deptDeco(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(0xd6cfc0));
  const x0 = -13.2, x1 = 13.2, z0 = -13.2, z1 = 6.6, top = 19.8;
  const ww = WW(0xcbb994, 1, 3.6);
  box(b, x0, 0, z0, x1, 4.8, z1, P(0x3a3a3e, Surf.Stone), null);
  box(b, x0, 4.8, z0, x1, top, z1, ww, K.roofP());
  K.parapet(b, x0, z0, x1, z1, top, 0.8, 0.3, P(0xd9c9a4, Surf.Stone));
  const pier = P(0xd9c9a4, Surf.Stone);
  for (let x = x0; x <= x1 + 0.01; x += 2.2) if (Math.abs(x) > 4.5) box(b, x - 0.22, 4.8, z1, x + 0.22, top + 0.8, z1 + 0.4, pier, undefined);
  // central tower
  box(b, -4.4, 0, z1 - 2, 4.4, 24.0, z1 + 0.8, pier, K.roofP());
  box(b, -3.3, 24.0, z1 - 1.6, 3.3, 25.4, z1 + 0.4, pier, K.roofP());
  box(b, -1.1, 4.8, z1 + 0.8, 1.1, 22.6, z1 + 1.1, K.emis(0xffc870, 6));
  for (const sx of [-3.0, 3.0]) faceZ(b, sx - 0.5, sx + 0.5, 6.0, 21.5, z1 + 0.82, P(0x2a3440, Surf.GlassPlain));
  // ground display windows + canopy with name
  for (const [a, e] of [[-12.6, -9], [-8.6, -5], [5, 8.6], [9, 12.6]] as [number, number][]) K.storefront(b, a, e, z1, { y0: 0.6, y1: 3.8, frame: 0xc9a24a, pitch: 1.8, surround: 0.1 });
  K.storefront(b, -3.6, 3.6, z1 + 0.8, { y0: 0.05, y1: 4.0, frame: 0xc9a24a, doors: [-1.4, 1.4], doorW: 1.6 });
  K.canopy(b, x0, x1, z1 + 0.8, 4.2, 1.8, 0.4, K.metal(0x2a2a2a), K.emis(0xffd88a));
  K.letters(b, rng, -8.8, 4.62, z1 + 2.4, 7, 0.75, 0xffe6b0, { words: 1, n: 6 });
  K.letters(b, rng, 8.8, 4.62, z1 + 2.4, 7, 0.75, 0xffe6b0, { words: 1, n: 6 });
  K.onSide(b, 'px', () => { for (let x = -4; x + 3.6 <= 12; x += 4.6) K.storefront(b, x, x + 3.6, x1, { y0: 0.6, y1: 3.8, frame: 0xc9a24a, pitch: 1.8, surround: 0.1 }); });
  K.roofJunk(b, rng, x0 + 1, z0 + 1, x1 - 1, z1 - 4, top, 5, true);
}
function deptModern(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(0xd3cec4));
  const x0 = -14, x1 = 14, z0 = -14, z1 = 6, top = 17.5;
  const panel = K.plain(0xe4ddd0);
  box(b, x0, 4.6, z0, x1, top, z1, panel, K.roofP());
  box(b, x0 + 0.6, 0, z0 + 0.6, x1 - 0.6, 4.6, z1 - 0.6, K.plain(0x3a3e44), null);
  K.storefront(b, x0 + 1.2, x1 - 1.2, z1 - 0.6, { y0: 0.2, y1: 4.2, frame: 0x222222, doors: [-6, 6], pitch: 2.4, surround: 0 });
  K.onSide(b, 'px', () => K.storefront(b, -4.6, 12.6, x1 - 0.6, { y0: 0.2, y1: 4.2, frame: 0x222222, pitch: 2.4, surround: 0 }));
  for (let x = x0 + 2; x < x1 - 1; x += 2) box(b, x - 0.15, 5.2, z1, x + 0.15, top - 0.6, z1 + 0.45, K.plain(0xf1ece2));
  for (let z = z0 + 2; z < z1 - 1; z += 2) box(b, x1, 5.2, z - 0.15, x1 + 0.45, top - 0.6, z + 0.15, K.plain(0xf1ece2), undefined, { nx: null });
  K.bandRect(b, x0, z0, x1, z1, top - 0.9, top, K.plain(0xc0392b), 0.5);
  // big logo + letters on a panel
  box(b, -9.5, 7.2, z1 + 0.45, 9.5, 13.6, z1 + 0.8, K.plain(0xf7f4ee));
  K.discSign(b, -6.2, 10.4, z1 + 0.8, 2.4, K.emis(0xe0282e, 7), K.metal(0xd8d8d8), 14, 0.3);
  K.discSign(b, -6.2, 10.4, z1 + 1.1, 1.6, K.emis(0xffffff, 5), K.metal(0xffffff), 14, 0.02);
  K.letters(b, rng, 2.2, 9.1, z1 + 0.82, 11, 2.6, 0xe0282e, { n: 5, words: 1 });
  K.canopy(b, x0, x1, z1, 4.3, 2.2, 0.3, K.plain(0xc0392b), K.emis(0xfff3dc, K.CANOPY_K));
  for (let fx = -12; fx <= 12; fx += 6) K.flag(b, fx, 7.6, 3.5, [0xc0392b, 0x2e6fb5, 0xf2f0ea, 0x2e6fb5, 0xc0392b][(fx / 6 + 2) | 0]);
  K.roofJunk(b, rng, x0 + 1, z0 + 1, x1 - 1, z1 - 1, top, 6, true);
  for (const tx of [-12, 12]) K.tree(b, rng, tx, 12.5, 0.8);
}
function deptChicago(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(C.sidewalk));
  const x0 = -13.5, x1 = 13.5, z0 = -13.5, z1 = 6.0, base = 8.0, top = 20.0;
  const tc = P(0xd8c3a0, Surf.Stone);
  box(b, x0, 0, z0, x1, base, z1, tc, null);
  box(b, x0, base, z0, x1, top, z1, WW(0x8e4a36, 5, 4.0), null);
  for (let x = x0; x <= x1 + 0.01; x += 4.5) box(b, x - 0.35, base, z1, x + 0.35, top, z1 + 0.3, tc, undefined);
  for (let z = z0; z <= z1 + 0.01; z += 4.5) box(b, x1, base, z - 0.35, x1 + 0.3, top, z + 0.35, tc, undefined, { nx: null });
  K.cornice(b, x0, z0, x1, z1, top, 1.0, 0.8, tc);
  up(b, x0 + 0.2, z0 + 0.2, x1 - 0.2, z1 - 0.2, top + 1.01, K.roofP());
  for (let x = x0 + 0.8; x + 3.2 < x1 - 0.5; x += 4.5) {
    K.storefront(b, x, x + 3.0, z1, { y0: 0.6, y1: 4.4, frame: 0x1f3a2e, pitch: 1.5, transom: 3.6 });
    K.storefront(b, x, x + 3.0, z1, { y0: 5.2, y1: 7.4, frame: 0x1f3a2e, pitch: 1.0, surround: 0.08 });
  }
  K.onSide(b, 'px', () => { for (let x = -5.2; x + 3 < 13; x += 4.5) K.storefront(b, x, x + 3.0, x1, { y0: 0.6, y1: 4.4, frame: 0x1f3a2e, pitch: 1.5, transom: 3.6 }); });
  // corner entrance canopy + clock
  box(b, 8.5, 4.6, z1, x1 + 0.1, 5.1, z1 + 2.2, K.metal(0x1f3a2e), undefined, { bottom: K.emis(0xfff0cc, K.CANOPY_K), nz: null });
  b.paint(0x1f3a2e, Surf.Metal).beam([11.2, 5.1, z1 + 1.6], [11.2, 6.2, z1 + 1.6], 0.12);
  K.discSign(b, 11.2, 7.0, z1 + 1.35, 0.8, K.emis(0xfff6e0), K.metal(0x1f3a2e), 12, 0.35);
  K.letters(b, rng, -3, 5.8, z1 + 0.04, 13, 1.1, 0xffd88a, { words: 2, n: 10 });
  box(b, -12, 5.6, z1, 12, 7.3, z1 + 0.08, K.plain(0x1f3a2e), null);
  K.roofJunk(b, rng, x0 + 1, z0 + 1, x1 - 1, z1 - 1, top + 1.01, 4, true);
}
const departmentStore: ModelBuildFn = (b, v, rng) => [deptBeaux, deptDeco, deptModern, deptChicago][v % 4](b, rng);

// ============================================================================================ OFFICES (2x2)
function officePlaza(b: B, rng: RNG, z0: number, z1: number, trees: number[], color = C.plaza) {
  up(b, -16, z0, 16, z1, 0.06, K.pav(color));
  for (const tx of trees) {
    K.planter(b, rng, tx - 1.0, (z0 + z1) / 2 - 1.0, tx + 1.0, (z0 + z1) / 2 + 1.0, 0.5, 0x8e8b84);
    K.tree(b, rng, tx, (z0 + z1) / 2, 0.85);
  }
}
function offRibbon(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.foliage(C.grass));
  officePlaza(b, rng, 3.2, 16, [-10, 10]);
  const x0 = -12.8, x1 = 12.8, z0 = -12.8, z1 = 3.2, base = 4.5, top = 23.0;
  box(b, x0 + 1.2, 0, z0 + 1.2, x1 - 1.2, base, z1 - 1.8, K.plain(0x2b2d31), null);
  K.storefront(b, x0 + 1.8, x1 - 1.8, z1 - 1.8, { y0: 0.1, y1: 4.2, frame: 0x2b2d31, doors: [0], doorW: 2.4, pitch: 2.1, surround: 0 });
  for (let x = x0 + 0.6; x <= x1; x += 6.4) box(b, x - 0.3, 0, z1 - 0.9, x + 0.3, base, z1 - 0.3, K.plain(0xe8e6e0), null);
  box(b, x0, base, z0, x1, top, z1, WW(0xefede8, 2, 3.8), K.roofP(), { bottom: K.plain(0xd8d6d0) });
  K.parapet(b, x0, z0, x1, z1, top, 0.5, 0.2, K.plain(0xefede8));
  box(b, -6, top, -8, 6, top + 3.2, -2, K.plain(0x9ea3a8), K.roofP());
  K.ac(b, 8, top, -8, 1.3);
  K.ac(b, -9, top, -3, 1.2);
  K.letters(b, rng, 0, top + 0.6, z1 + 0.05, 10, 1.0, 0x2fd6ff, { words: 1, n: 7, surf: Surf.Emissive });
  bench(b, -4, 9.5);
  bench(b, 4, 9.5);
}
function offBlueGlass(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(C.plaza));
  const x0 = -12, x1 = 12, z0 = -12, z1 = 3, base = 4.2, top = 23.2;
  box(b, x0 - 0.3, 0, z0 - 0.3, x1 + 0.3, base, z1 + 0.3, K.plain(0x3a3e44), null);
  K.storefront(b, x0 + 0.6, x1 - 0.6, z1 + 0.3, { y0: 0.1, y1: 3.9, frame: 0x3a3e44, doors: [-1.5, 1.5], pitch: 3.0, surround: 0 });
  K.onSide(b, 'px', () => K.storefront(b, -2.4, 11.4, x1 + 0.3, { y0: 0.1, y1: 3.9, frame: 0x3a3e44, pitch: 3.0, surround: 0 }));
  const t2 = top - 3.8;
  box(b, x0, base, z0, x1, t2, z1, GC(0, 3.8), K.roofP());
  K.bandRect(b, x0, z0, x1, z1, t2 - 0.4, t2 + 0.6, K.metal(0x9aa2aa), 0.08);
  finsZ(b, x0 + 1.5, x1 - 1.5, 3, base, t2 - 0.4, z1, 0.5, K.metal(0xc3c8cd));
  box(b, x0 + 1.5, t2, z0 + 1.5, x1 - 1.5, top, z1 - 1.5, GC(0, 3.8), K.roofP());
  K.bandRect(b, x0 + 1.5, z0 + 1.5, x1 - 1.5, z1 - 1.5, top - 0.6, top + 0.8, K.metal(0x9aa2aa), 0.08);
  K.canopy(b, -4, 4, z1 + 0.3, 3.9, 3.0, 0.3, K.metal(0xc3c8cd), K.emis(0xeaf4ff, K.CANOPY_K));
  up(b, -16, 5, 16, 16, 0.06, K.foliage(C.grass));
  up(b, -2.5, 3.3, 2.5, 16, 0.08, K.pav(C.plaza));
  for (const tx of [-12, -7, 7, 12]) K.tree(b, rng, tx, 10, 0.9);
  K.pylon(b, 7, 14, 2.2, 5, [{ h: 1.4, color: 0x2e6fb5 }], { poles: 0, pole: 0x8e8b84, depth: 0.6 });
  K.ac(b, -6, top + 0.8, -6, 1.3);
  K.ac(b, 5, top + 0.8, -7.5, 1.3);
}
function offPostmodern(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(0xd9d3c7));
  const x0 = -12, x1 = 12, z0 = -12, z1 = 3, base = 4.4, top = 15.2;
  const stone = P(0xd8ccb4, Surf.Stone);
  box(b, x0, 0, z0, x1, base, z1, stone, null);
  box(b, x0, base, z0, x1, top, z1, WW(0xa0563e, 0, 3.8), K.roofP());
  for (const y of [base, 11.4]) K.cornice(b, x0, z0, x1, z1, y - 0.15, 0.3, 0.12, stone, null);
  K.cornice(b, x0, z0, x1, z1, top, 0.6, 0.4, stone);
  // central pedimented bay
  box(b, -4.5, 0, z1, 4.5, top + 0.6, z1 + 0.8, stone, K.roofP());
  b.paint(0x5f8f80, Surf.Metal).gableRoof(0, z1 - 2.5, 9.4, 7.6, top + 0.6, 3.4, 'z', 0.3, stone);
  K.discSign(b, 0, top + 1.9, z1 + 0.85, 0.8, P(0x2a3440, Surf.GlassPlain), stone, 10, 0.1);
  K.storefront(b, -1.8, 1.8, z1 + 0.8, { y0: 0.05, y1: 3.8, frame: 0x1f2a44, doors: [0], doorW: 2.0 });
  b.paint(0x2a3440, Surf.GlassPlain);
  for (let k = 1; k < 4; k++) faceZ(b, -1.5, 1.5, k * 3.8 + 1.0, k * 3.8 + 2.9, z1 + 0.82, P(0x2a3440, Surf.GlassPlain));
  for (const sx of [-10.5, -6.5, 6.5, 10.5]) K.storefront(b, sx - 1.2, sx + 1.2, z1, { y0: 0.8, y1: 3.4, frame: 0x1f2a44, pitch: 1.2, surround: 0.1 });
  officePlaza(b, rng, 4.2, 16, [-10, 10], 0xcdb99a);
  K.letters(b, rng, 0, 4.6, z1 + 0.82, 5.5, 0.5, 0xffd88a, { words: 1 });
  K.flag(b, -5.5, 12.5, 9, 0x2e6fb5);
  K.flag(b, 5.5, 12.5, 9, 0xc0392b);
  K.ac(b, -8, top + 0.6, -8, 1.1);
  K.ac(b, 7, top + 0.6, -7, 1.1);
}
function offGreenL(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.foliage(C.grass));
  const top = 26.6;
  const gc = GC(0, 3.8);
  box(b, -13.5, 0, -13.5, 13.5, top, -3, gc, K.roofP());
  box(b, 3, 0, -3, 13.5, top, 6, gc, K.roofP(), { nz: null });
  const par = K.metal(0xa9b0b6);
  box(b, -13.6, top, -13.6, 13.6, top + 1.2, -13.35, par);
  box(b, -13.6, top, -13.35, -13.35, top + 1.2, -2.9, par, undefined, { pz: par, nz: null });
  box(b, -13.35, top, -3.15, 2.9, top + 1.2, -2.9, par, undefined, { nx: null });
  box(b, 2.9, top, -3.15, 3.15, top + 1.2, 6.1, par, undefined, { nz: null });
  box(b, 3.15, top, 5.85, 13.35, top + 1.2, 6.1, par, undefined, { nx: null });
  box(b, 13.35, top, -13.35, 13.6, top + 1.2, 6.1, par, undefined, { nz: null });
  box(b, -1.5, 0, -6, 4.5, top + 3.6, -3, K.plain(0x9a9690), K.roofP());
  box(b, -1.5, 0, -3, 4.5, 4.5, 0.5, P(0x2a3440, Surf.GlassPlain), K.roofP());
  K.storefront(b, -1.3, 2.8, 0.5, { y0: 0.05, y1: 4.2, frame: 0x55595f, doors: [0.7], doorW: 2.0, surround: 0 });
  // courtyard garden in the L
  up(b, -13.5, -2.6, 2.6, 16, 0.06, K.pav(C.plaza));
  up(b, -12.5, -1.6, 1.6, 6.4, 0.09, K.foliage(0x77a34f));
  for (const [tx, tz] of [[-10, 1], [-5, 4], [-1, 0.6], [-11, 10], [-4, 11], [9, 11]] as [number, number][]) K.tree(b, rng, tx, tz, 0.85);
  b.paint(C.water, Surf.Water).box(-8, 0, 7.5, 0, 0.12, 9.0);
  bench(b, -6, 5.8);
  K.roofJunk(b, rng, -12.5, -12.5, 12.5, -4, top, 4, false);
  K.letters(b, rng, 8.25, top - 2.8, 6.1, 9, 1.4, 0x4dff88, { words: 1, n: 6 });
}
function offFins(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(C.plaza));
  const x0 = -10.5, x1 = 10.5, z0 = -10.5, z1 = 4.5, top = 28.8;
  box(b, x0 + 0.8, 0, z0 + 0.8, x1 - 0.8, 3.6, z1 - 0.8, P(0x2a3440, Surf.GlassPlain), null);
  K.storefront(b, x0 + 1.2, x1 - 1.2, z1 - 0.8, { y0: 0.05, y1: 3.3, frame: 0x55595f, doors: [0], doorW: 2.4, pitch: 3, surround: 0 });
  box(b, x0, 3.6, z0, x1, top, z1, WW(0xbdb6aa, 5, 3.6), K.roofP(), { bottom: K.plain(0x9a958c) });
  const fin = K.plain(0xd6d0c4);
  for (let x = x0; x <= x1 + 0.01; x += 3) box(b, x - 0.15, 3.6, z1, x + 0.15, top + 0.9, z1 + 0.8, fin);
  for (let z = z0; z < z1; z += 3) box(b, x1, 3.6, z - 0.15, x1 + 0.8, top + 0.9, z + 0.15, fin, undefined, { nx: null });
  K.bandRect(b, x0, z0, x1, z1, top, top + 0.9, K.plain(0x3a3e44), 0.0);
  up(b, x0, z0, x1, z1, top + 0.9, K.roofP());
  for (const [px, pz] of [[-13, 9], [13, 9], [-13, -2], [13, -2]] as [number, number][]) { K.planter(b, rng, px - 1.2, pz - 1.2, px + 1.2, pz + 1.2, 0.5, 0x8e8b84); K.tree(b, rng, px, pz, 0.8); }
  K.fountain(b, 0, 10.5, 2.6);
  box(b, -5, top + 0.9, -7, 3, top + 4.0, -2, K.plain(0x8e8b84), K.roofP());
  K.letters(b, rng, 0, 1.0, 15.2, 6, 0.7, 0x3a8dff, { words: 1 });
  box(b, -3.4, 0, 14.9, 3.4, 2.0, 15.4, K.plain(0x3a3e44));
}
function offOctBronze(b: B, rng: RNG) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(0xcdb99a));
  const pts = K.chamferPts(-11, -11, 11, 4, 3.5);
  const grown = K.chamferPts(-11.4, -11.4, 11.4, 4.4, 3.6);
  K.prismPts(b, grown, 0, 4.2, P(0x2a3440, Surf.GlassPlain), null);
  K.prismPts(b, pts, 4.2, 23.2, GC(2, 3.8), null);
  K.loft(b, pts, K.scalePts(pts, 0.94, 0.94, 0, -3.5), 23.2, 25.0, K.metal(0x6b5238), K.roofP());
  K.bandPts(b, grown, 3.9, 4.4, K.metal(0x6b5238), 0.05);
  for (let y = 4.2 + 3.8; y < 23; y += 3.8) K.bandPts(b, pts, y - 0.2, y + 0.2, K.metal(0xb89a6a), 0.08);
  box(b, -3, 0, 4.4, 3, 6.5, 7.4, P(0x2a3440, Surf.GlassPlain), K.metal(0x6b5238));
  K.storefront(b, -2.6, 2.6, 7.4, { y0: 0.05, y1: 6.2, frame: 0x6b5238, doors: [0], doorW: 2.2, transom: 3.0, surround: 0 });
  up(b, -16, 8, 16, 16, 0.06, K.foliage(C.grass));
  up(b, -2.2, 7.4, 2.2, 16, 0.08, K.pav(0xcdb99a));
  for (const tx of [-12, -7, 7, 12]) K.tree(b, rng, tx, 12, 0.85);
  K.roofJunk(b, rng, -8, -9, 8, 1, 25.0, 3, true);
  K.letters(b, rng, 0, 20.4, 4.05, 8, 1.2, 0xffe6b0, { words: 1, n: 5 });
}
const officeSmall: ModelBuildFn = (b, v, rng) => [offRibbon, offBlueGlass, offPostmodern, offGreenL, offFins, offOctBronze][v % 6](b, rng);

// Office blocks are the most common CO$$ mid-rise, so their mirror twins get their own palette (tw) instead of
// flipped copies: bronze glass + dark fins / sandstone + green bands / dark granite + cream bands / granite + bronze.
function blockMies(b: B, rng: RNG, tw = false) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(0xc9c2b4));
  const x0 = -12, x1 = 12, z0 = -12, z1 = 3, base = 4.5, top = 38.7;
  box(b, -10.5, 0, -10.5, 10.5, base, 1.5, P(0x2a3440, Surf.GlassPlain), null);
  K.storefront(b, -9.9, 9.9, 1.5, { y0: 0.05, y1: 4.2, frame: 0x6b5238, doors: [-1.4, 1.4], pitch: 3.3, surround: 0 });
  for (let x = x0 + 0.3; x <= x1; x += 5.85) for (const z of [z0 + 0.3, z1 - 0.3]) box(b, x - 0.3, 0, z - 0.3, x + 0.3, base, z + 0.3, K.metal(0x3a2c22), null);
  box(b, x0, base, z0, x1, top, z1, GC(tw ? 2 : 3, 3.8), K.roofP(), { bottom: K.plain(0x3a3a3a) });
  const fin = K.metal(tw ? 0x2e3236 : 0x6b5238);
  for (let x = x0 + 1.5; x < x1; x += 3) b.paint(fin).quad2([x, base, z1], [x, base, z1 + 0.45], [x, top, z1 + 0.45], [x, top, z1]);
  for (let z = z0 + 1.5; z < z1; z += 3) b.paint(fin).quad2([x1, base, z], [x1 + 0.45, base, z], [x1 + 0.45, top, z], [x1, top, z]);
  K.bandRect(b, x0, z0, x1, z1, top - 3.8, top + 0.3, K.metal(0x2e2a26), 0.02);
  K.roofJunk(b, rng, x0 + 1.5, z0 + 1.5, x1 - 1.5, z1 - 1.5, top, 4, false);
  K.canopy(b, -4.5, 4.5, 1.5, 3.8, 4.2, 0.3, K.metal(0x6b5238), K.emis(0xffb060, 5));
  // plaza pools
  for (const px of [-8, 8]) b.paint(0x2f5f7a, Surf.Water).box(px - 5, 0.0, 6.5, px + 5, 0.3, 12.5, { top: P(0x2f6f96, Surf.Water) });
  for (const px of [-8, 8]) K.fountain(b, px, 9.5, 1.0, 0x9a958c);
  K.letters(b, rng, 0, 0.4, 15.5, 5, 0.6, 0xffb060, { words: 1 });
  box(b, -3, 0, 15.2, 3, 1.4, 15.5, P(0x3a3a3e, Surf.Stone));
}
function blockConcrete(b: B, rng: RNG, tw = false) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(C.plaza));
  const x0 = -12, x1 = 12, z0 = -12, z1 = 4.5, top = 36;
  box(b, x0 + 1, 0, z0 + 1, x1 - 1, 3.6, z1 - 1, P(0x2a3440, Surf.GlassPlain), null);
  K.storefront(b, x0 + 1.5, x1 - 1.5, z1 - 1, { y0: 0.05, y1: 3.3, frame: 0x55595f, doors: [0], doorW: 2.4, pitch: 3, surround: 0 });
  const accent = tw ? 0x2f5a44 : 0x2e6fb5;
  box(b, x0, 3.6, z0, x1, top, z1, WW(tw ? 0xb89a74 : 0xc9bfae, 5, 3.6), K.roofP(), { bottom: K.plain(0x8e8b84) });
  for (let y = 7.2; y < top; y += 7.2) K.bandRect(b, x0, z0, x1, z1, y - 0.3, y, K.plain(accent), 0.12);
  box(b, -9, top, -9, 9, top + 3.6, 1.5, GC(tw ? 2 : 4, 3.6), K.roofP());
  K.roofJunk(b, rng, -8, -8, 8, 0.5, top + 3.6, 4, false);
  K.canopy(b, -4, 4, z1 - 1, 3.3, 3.0, 0.3, K.metal(accent), K.emis(0xeaf4ff, K.CANOPY_K));
  for (const cx of [-6, 0, 6]) b.paint(0x9aa0a6, Surf.Metal).cylinder(cx, -10.5, top, 2.2, 1.0, 1.0, 8, { topPaint: K.metal(0x333333) });
  officePlaza(b, rng, 5.5, 16, [-11, 11]);
  K.fountain(b, 0, 10.5, 2.2);
}
function blockRounded(b: B, rng: RNG, tw = false) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(C.sidewalk));
  const pts: K.V2[] = [[-12.8, -12.8], [12.8, -12.8], [12.8, -2.2]];
  for (let i = 1; i <= 5; i++) { const a = (i / 6) * (Math.PI / 2); pts.push([6.4 + Math.cos(a) * 6.4, -2.2 + Math.sin(a) * 6.4]); }
  pts.push([6.4, 4.2], [-12.8, 4.2]);
  K.prismPts(b, pts, 0, 3.6, P(0x3a3a3e, Surf.Stone), null);
  const wallC = tw ? 0x4a4c52 : 0x8a4a38, trimC = K.plain(tw ? 0xd8c8a4 : 0xe0d6c2);
  K.prismPts(b, pts, 3.6, 39.6, WW(wallC, 2, 3.6), K.roofP());
  for (let y = 10.8; y < 39; y += 10.8) K.bandPts(b, pts, y - 0.25, y + 0.1, trimC, 0.12);
  K.bandPts(b, pts, 39.6, 40.4, trimC, 0.1);
  b.push().rotateY(Math.PI / 4);
  K.storefront(b, 4.8, 9.8, 10.9, { y0: 0.05, y1: 3.3, frame: 0xc9a24a, doors: [7.3], doorW: 2.0, pitch: 2.5 });
  K.canopy(b, 5.0, 9.6, 10.9, 3.45, 2.2, 0.25, K.metal(0x3a3a3e), K.emis(0xffc870, 4));
  b.pop();
  K.roofJunk(b, rng, 3, -11.5, 11.5, 2, 39.6, 4, false);
  K.storefront(b, -12, 5.2, 4.2, { y0: 0.5, y1: 3.2, frame: 0xc9a24a, pitch: 2.2 });
  K.canopy(b, -12.4, 5.5, 4.2, 3.35, 1.4, 0.2, K.metal(0x3a3a3e));
  box(b, -8, 39.6, -9, 2, 43.0, -3, K.plain(wallC), K.roofP());
  K.mast(b, -3, -6, 43.0, 6, 0.2, 0.05, K.metal(0xb0b0b0));
  K.letters(b, rng, -4, 36.9, 4.32, 14, 1.8, 0x2fd6ff, { words: 1, n: 7 });
  for (const tx of [-12, -4, 4]) K.tree(b, rng, tx, 11, 0.8);
  up(b, -16, 7, 16, 16, 0.06, K.foliage(C.grass));
}
function blockWings(b: B, rng: RNG, tw = false) {
  up(b, -16, -16, 16, 16, 0.03, K.pav(C.plaza));
  const top = 43.2, ww = WW(tw ? 0x3e4046 : 0xe8e6e0, 5, 3.6), band = K.plain(tw ? 0x8a6a42 : 0x2e6fb5);
  box(b, -13.5, 0, -4.5, 13.5, top, 3, ww, K.roofP());
  box(b, -4.5, 0, -13.5, 4.5, top, -4.5, ww, K.roofP(), { pz: null });
  box(b, -4.5, 0, 3, 4.5, top + 3.6, 4.8, GC(tw ? 2 : 5, 3.6), K.roofP());
  K.storefront(b, -4.1, 4.1, 4.8, { y0: 0.05, y1: 4.0, frame: 0x55595f, doors: [0], doorW: 2.4, pitch: 2.7, surround: 0 });
  K.canopy(b, -4.5, 4.5, 4.8, 4.2, 2.5, 0.3, K.metal(0xc3c8cd), K.emis(0xeaf4ff, K.CANOPY_K));
  K.bandRect(b, -13.5, -4.5, 13.5, 3, 3.3, 3.6, band, 0.1);
  K.bandRect(b, -13.5, -4.5, 13.5, 3, top - 0.6, top, band, 0.1);
  K.roofJunk(b, rng, -12.5, -4, 12.5, 2.5, top, 4, true);
  officePlaza(b, rng, 7.6, 16, [-11, -6, 6, 11]);
  K.letters(b, rng, -9, top - 3.1, 3.05, 7, 1.3, 0x9fd8ff, { words: 1, n: 5 });
}
const officeBlock: ModelBuildFn = (b, v, rng, e) => [blockMies, blockConcrete, blockRounded, blockWings][v % 4](b, rng, isMirrorTwin(e.id, v, rng));

// ============================================================================================ MALL (4x4)
/**
 * Retail unit of an open-air centre in a local frame: shop front faces +Z at z = -21, back at z = -31,
 * spanning local x [a, e]. Callers rotate the frame so the front faces the plaza.
 */
function retailUnit(b: B, rng: RNG, a: number, e: number, h: number, wall: Paint, trim: number, awningColor: number, neon: number, upper: boolean) {
  const zf = -21, mid = (a + e) / 2;
  box(b, a, 0, -31, e, h, zf, wall, K.roofP());
  faceZ(b, a, e, h - 0.4, h + 0.5, zf + 0.12, K.plain(trim));
  up(b, a, zf - 0.25, e, zf + 0.12, h + 0.5, K.plain(trim));
  K.storefront(b, a + 0.6, e - 0.6, zf, { y0: 0.4, y1: 3.3, frame: 0x2a2a2a, doors: [mid + (rng.chance(0.5) ? 1.2 : -1.2)], pitch: 2.8 });
  K.awning(b, a + 0.4, e - 0.4, zf, 3.65, 1.4, 0.6, [awningColor], 1, 0.3);
  K.letters(b, rng, mid, 4.25, zf + 0.03, e - a - 2.0, 0.95, neon, { n: 3, words: 1, mixed: rng.chance(0.4) });
  if (upper) faceZ(b, a + 0.9, e - 0.9, 5.7, 7.5, zf + 0.03, P(0x2a3440, Surf.GlassPlain));
}
/** v2: open-air lifestyle centre — two L-shaped retail rows around a landscaped plaza, cinema, clock tower, parking in front. */
function mallLifestyle(b: B, rng: RNG) {
  up(b, -32, -32, 32, 32, 0.03, K.pav(0xb3aea2));
  const walls = [K.plain(0xd89a6a), K.plain(0xe9dfc8), K.plain(0x9fb59a), K.plain(0x8c9bab), P(0x9c4a36, Surf.Brick), K.plain(0xe7c3a0), K.plain(0xc9d3c0)];
  const awn = [0x2f6b3a, 0x7a2335, 0x24406e, 0xd9822b, 0x2a8f8a, 0x5a3a6b];
  const neon = rng.shuffle(K.NEON.slice());
  let k = 0;
  const unit = (a: number, e: number, h: number, upper: boolean) => {
    retailUnit(b, rng, a, e, h, walls[k % walls.length], 0xf2ede2, awn[k % awn.length], neon[k % neon.length], upper);
    k++;
  };
  // back row, left and right of the clock tower gap (fronts face +Z)
  unit(-15.5, -8.8, 9.5, true);
  unit(-8.8, -2.6, 7.6, false);
  unit(2.6, 10.2, 8.2, false);
  unit(10.2, 18.8, 10.4, true);
  unit(18.8, 31, 8.8, false);
  // left wing (fronts face +X): local x = -world z
  b.push().rotateY(Math.PI / 2);
  unit(-6.5, 3.2, 8.4, false);
  unit(3.2, 12.4, 10.0, true);
  unit(12.4, 21, 7.8, false);
  b.pop();
  // right wing (fronts face -X): local x = world z
  b.push().rotateY(-Math.PI / 2);
  unit(-21, -10.5, 9.0, false);
  unit(-10.5, 6.5, 8.0, false);
  b.pop();
  // cinema anchor at the back-left corner with marquee and vertical blade
  const cx0 = -31, cx1 = -15.5;
  box(b, cx0, 0, -31, cx1, 14.5, -21, K.plain(0x3a3e44), K.roofP());
  box(b, cx0, 14.5, -31, cx1, 15.2, -21, K.plain(0x2a2d31), null);
  K.storefront(b, cx0 + 3, cx1 - 2, -21, { y0: 0.2, y1: 3.8, frame: 0xc9a24a, doors: [-25, -21.5], doorW: 2.0, pitch: 2.4 });
  K.canopy(b, cx0 + 2, cx1 - 1, -21, 4.2, 2.8, 0.9, K.plain(0x7a2335), K.emis(0xffc933, 8));
  box(b, cx0 + 2, 6.4, -21, cx1 - 1, 9.8, -20.7, K.plain(0x1a1a1a));
  K.letters(b, rng, (cx0 + cx1) / 2, 7.1, -20.68, 12, 2.0, 0xff4fc3, { n: 6, words: 1, k: 8 });
  box(b, cx1 - 1.4, 5.0, -20.7, cx1 - 0.6, 13.8, -19.3, K.plain(0x7a2335), undefined, { nz: null });
  K.verticalLetters(b, rng, cx1 - 1.0, 6.0, 12.4, -19.28, 0.7, 0xffc933, 8);
  // clock tower in the gap between the back rows
  box(b, -2.6, 0, -27, 2.6, 18.0, -21.8, K.plain(0xe9dfc8), null);
  b.paint(0xb5583a, Surf.RoofTiles).pyramid(0, -24.4, 6.0, 6.0, 18.0, 3.6);
  K.discSign(b, 0, 14.6, -21.9, 1.5, K.emis(0xfff6e0, 5), K.plain(0x3a3a3a), 12, 0.2);
  K.storefront(b, -1.6, 1.6, -21.8, { y0: 0.05, y1: 5.0, frame: 0x2a2a2a, pitch: 1.6, transom: 3.2 });
  // plaza
  up(b, -21, -21, 21, 7.2, 0.06, K.pav(0xcdb99a));
  up(b, -8, -15, 8, -9, 0.08, K.foliage(0x77a34f));
  K.fountain(b, 0, -2.5, 3.2, 0xd4cbb8);
  for (const [tx, tz] of [[-11, -12], [11, 2.5]] as [number, number][]) {
    K.planter(b, rng, tx - 1.1, tz - 1.1, tx + 1.1, tz + 1.1, 0.5, 0x9a8a72);
    K.tree(b, rng, tx, tz, 0.9);
  }
  K.umbrella(b, 15.5, -1.0, 1.4, 0xc8352b, 2.5);
  const fest = K.emis(0xffc870, 3);
  for (const [ax, bx] of [[-20, 20]] as [number, number][]) {
    let prev: K.V3 = [ax, 4.2, -8];
    for (let i = 1; i <= 3; i++) { const t = i / 3; const pt: K.V3 = [ax + (bx - ax) * t, 4.2 - 1.6 * t * (1 - t), -8]; b.paint(fest).beam(prev, pt, 0.04); prev = pt; }
  }
  // gateway pylons at the plaza entrance
  for (const gx of [-6, 6]) box(b, gx - 0.6, 0, 6.4, gx + 0.6, 6.5, 7.6, K.plain(0xe9dfc8), K.plain(0xb5583a));
  box(b, -6.6, 5.2, 6.7, 6.6, 6.2, 7.3, K.plain(0x3a3e44));
  K.letters(b, rng, 0, 5.35, 7.32, 10, 0.7, 0xffc933, { n: 5, words: 1 });
  // parking in front
  K.asphalt(b, -31.5, 8.2, 31.5, 24.2);
  for (const [rz, nose, fill] of [[8.6, -1, 0.14], [13.8, 1, 0.0]] as [number, 1 | -1, number][]) {
    K.stallsX(b, rng, -30.5, -3.2, rz, nose, fill);
    K.stallsX(b, rng, 3.2, 30.5, rz, nose, fill);
  }
  up(b, -3.0, 8.6, 3.0, 19.0, 0.1, K.foliage(C.grass));
  K.tree(b, rng, 0, 13.8, 0.75);
  K.lotLamp(b, -16, 19.6, 8, [Math.PI]);
  K.lotLamp(b, 16, 19.6, 8, [Math.PI]);
  up(b, -32, 24.2, 32, 32, 0.07, K.foliage(C.grass));
  for (const tx of [-16, 12]) K.tree(b, rng, tx, 27.5, 0.8);
  K.pylon(b, 27, 30.8, 11, 3.6, [{ h: 2.2, color: 0xb5583a }, { h: 0.8, color: neon[0] }, { h: 0.8, color: neon[1] }, { h: 0.8, color: neon[2] }], { poles: 2, pole: 0x6a6e73, frame: 0x2a2a2a, cap: 0xdedede });
  K.pylonLetters(b, rng, 27, 30.8, 8.35, 1.2, 3.2, 0xfff4e0, { n: 4 });
}
function mall(b: B, v: number, rng: RNG) {
  if (v === 2) return mallLifestyle(b, rng);
  up(b, -32, -32, 32, 32, 0.03, K.pav(0xb3aea2));
  const wall = K.plain(v === 0 ? 0xdfd3bb : 0xe4e2dc);
  if (v === 0) {
    const cz0 = -30.5, cz1 = -9.5, ch = 11;
    box(b, -21, 0, cz0, 21, ch, cz1, wall, K.roofP());
    K.parapet(b, -21, cz0, 21, cz1, ch, 0.8, 0.3, K.plain(0xc9b996));
    b.paint(0x8899aa, Surf.GlassCurtain, 5, 3).gableRoof(0, -20, 34, 7, ch, 2.6, 'x', 0.1, K.plain(0xc9b996));
    // anchors
    const an = [
      { x0: -31.5, x1: -20, h: 15, col: K.plain(0xc4b08c), band: 0x7a2335, lc: 0xffc933 },
      { x0: 20, x1: 31.5, h: 13.5, col: K.plain(0xe9e6df), band: 0x1d4f91, lc: 0xff3b30 },
    ];
    for (const a of an) {
      box(b, a.x0, 0, -31, a.x1, a.h, -5, a.col, K.roofP());
      K.parapet(b, a.x0, -31, a.x1, -5, a.h, 0.6, 0.3, K.plain(a.band));
      K.storefront(b, a.x0 + 2.5, a.x1 - 2.5, -5, { y0: 0.2, y1: 4.4, frame: 0x2a2a2a, doors: [(a.x0 + a.x1) / 2], doorW: 2.4, pitch: 2.2 });
      box(b, a.x0 + 0.8, 6.8, -5, a.x1 - 0.8, 11.2, -4.6, K.plain(a.band));
      K.letters(b, rng, (a.x0 + a.x1) / 2, 7.6, -4.56, a.x1 - a.x0 - 3, 2.6, a.lc, { words: 1, n: 5 });
      K.canopy(b, a.x0 + 2, a.x1 - 2, -5, 4.6, 1.8, 0.3, K.plain(a.band));
    }
    // central atrium entrance with pyramid skylight
    box(b, -8, 0, -11, 8, 14, -4.5, P(0x2a3440, Surf.GlassPlain), K.roofP());
    K.storefront(b, -7.4, 7.4, -4.5, { y0: 0.05, y1: 13.2, frame: 0xc3c8cd, doors: [-2, 2], doorW: 2.4, pitch: 1.85, transom: 4.4, surround: 0.12 });
    b.paint(0x8899aa, Surf.GlassCurtain, 5, 3).pyramid(0, -7.75, 14, 5.5, 14, 4.2);
    box(b, -9, 14, -11.5, 9, 14.6, -4.2, K.plain(0xc9b996), null);
    K.letters(b, rng, 0, 15.0, -4.18, 12, 1.8, 0x2fd6ff, { words: 1, n: 6 });
    for (const [a, e] of [[-20, -9], [9, 20]] as [number, number][]) for (let x = a + 1; x + 3 < e; x += 4) K.storefront(b, x, x + 3, cz1, { y0: 0.9, y1: 3.4, frame: 0x55595f, pitch: 1.5, surround: 0.1 });
    K.roofJunk(b, rng, -20, -30, 20, -24, ch, 6, false);
    K.roofJunk(b, rng, -31, -30, -21, -8, 15, 2, false);
  } else {
    box(b, -26, 0, -31, 26, 12, -6, wall, K.roofP());
    K.parapet(b, -26, -31, 26, -6, 12, 0.8, 0.3, K.plain(0x3a3e44));
    b.paint(0x8899aa, Surf.GlassCurtain, 5, 3).sphere(0, 12, -18.5, 9, 12, 6, { hemi: true, scaleY: 0.8 });
    box(b, -9.5, 12, -28, 9.5, 12.6, -9, K.plain(0x3a3e44), null);
    const an = [
      { x0: -31.5, x1: -18, z1: -2, h: 16, band: 0x2a8f8a, lc: 0xffc933 },
      { x0: 18, x1: 31.5, z1: -2, h: 16, band: 0xe27d3a, lc: 0xfff1d6 },
    ];
    for (const a of an) {
      box(b, a.x0, 0, -31.5, a.x1, a.h, a.z1, K.plain(0xd9d6cf), K.roofP());
      box(b, a.x0 - 0.2, a.h - 3.5, a.z1, a.x1 + 0.2, a.h, a.z1 + 0.4, K.plain(a.band));
      K.letters(b, rng, (a.x0 + a.x1) / 2, a.h - 3.0, a.z1 + 0.42, a.x1 - a.x0 - 3, 2.4, a.lc, { words: 1, n: 5 });
      K.storefront(b, a.x0 + 2, a.x1 - 2, a.z1, { y0: 0.2, y1: 4.2, frame: 0x2a2a2a, doors: [(a.x0 + a.x1) / 2], doorW: 2.4, pitch: 2.2 });
    }
    box(b, -9, 0, -8, 9, 9, -3, P(0x2a3440, Surf.GlassPlain), K.roofP());
    K.storefront(b, -8.6, 8.6, -3, { y0: 0.05, y1: 8.6, frame: 0x3a3e44, doors: [-2, 2], doorW: 2.4, pitch: 2.15, transom: 4.2, surround: 0.12 });
    box(b, -10, 9, -8.5, 10, 10.6, -2.4, K.plain(0x3a3e44), null);
    K.letters(b, rng, 0, 9.35, -2.36, 16, 1.0, 0x2fd6ff, { words: 1, n: 8 });
    K.roofJunk(b, rng, -25, -30, -12, -8, 12, 3, false);
    K.roofJunk(b, rng, 12, -30, 25, -8, 12, 3, false);
    // parking deck on the left-front
    const dx0 = -31.5, dx1 = -12.5, dz0 = 1.5, dz1 = 31;
    box(b, dx0, 0, dz0, dx1, 0.9, dz1, K.plain(0xb8b5ad));
    for (const y of [3.4, 6.4]) {
      box(b, dx0, y - 0.35, dz0, dx1, y, dz1, K.plain(0xc4c0b8), undefined, { bottom: K.plain(0x8e8b84) });
      box(b, dx0, y, dz0, dx1, y + 1.0, dz0 + 0.25, K.plain(0xc4c0b8));
      box(b, dx0, y, dz1 - 0.25, dx1, y + 1.0, dz1, K.plain(0xc4c0b8));
      box(b, dx1 - 0.25, y, dz0, dx1, y + 1.0, dz1, K.plain(0xc4c0b8));
    }
    for (let z = dz0 + 0.5; z < dz1; z += 7.3) for (const x of [dx0 + 0.5, dx1 - 0.5]) box(b, x - 0.3, 0.9, z - 0.3, x + 0.3, 3.05, z + 0.3, K.plain(0x9a968e), null);
    b.push().translate(0, 6.4, 0);
    K.stallsZ(b, rng, dz0 + 1, dz1 - 1, dx0 + 0.8, 1, 0.4, 0.02);
    K.stallsZ(b, rng, dz0 + 1, dz1 - 1, dx1 - 6.0, -1, 0.35, 0.02);
    b.pop();
    for (let z = dz0 + 1.4; z < dz1 - 1; z += 2.7) faceX(b, z - 0.9, z + 0.9, 3.45, 4.6, dx1 + 0.01, K.metal(K.CAR_COLORS[(z * 7) % K.CAR_COLORS.length | 0]), 1);
    K.lotLamp(b, -22, 16, 6.4 + 4.5, [0, Math.PI], false);
  }
  // surface parking
  const sx0 = v === 0 ? -31.5 : -11.5;
  K.asphalt(b, sx0, -3.6, 31.5, 30.4);
  const rows: [number, 1 | -1, number][] = [[-2.8, -1, 0.25], [2.4, 1, 0.18], [14.6, -1, 0.15], [19.8, 1, 0.12]];
  for (const [rz, nose, fill] of rows) {
    K.stallsX(b, rng, sx0 + 1, -3.2, rz, nose, fill);
    K.stallsX(b, rng, 3.2, 30.5, rz, nose, fill);
  }
  for (const rz of [-2.8, 14.6]) {
    up(b, -3.0, rz, 3.0, rz + 10.4, 0.1, K.foliage(C.grass));
    K.tree(b, rng, 0, rz + 2.8, 0.75);
    K.tree(b, rng, 0, rz + 7.6, 0.75);
    K.lotLamp(b, sx0 + 12, rz + 5.2, 8, [Math.PI / 2]);
    K.lotLamp(b, 18, rz + 5.2, 8, [-Math.PI / 2]);
  }
  up(b, -32, 30.4, 32, 32, 0.07, K.foliage(C.grass));
  for (const tx of [-18, 16]) K.tree(b, rng, tx, 31.0, 0.6);
  K.pylon(b, 27, 30.8, 11, 3.6, [{ h: 2.2, color: v === 0 ? 0x7a2335 : 0x2a8f8a }, { h: 0.8, color: 0xffc933 }, { h: 0.8, color: 0x2fd6ff }, { h: 0.8, color: 0xff4fc3 }], { poles: 2, pole: 0x6a6e73, frame: 0x2a2a2a, cap: 0xdedede });
}

export const midModels: Record<string, ModelBuildFn> = {
  com_shops_apartments: shopsApartments,
  com_motel: (b, v, rng) => motel(b, v, rng),
  com_supermarket: (b, v, rng) => supermarket(b, v, rng),
  com_hotel: hotel,
  com_department_store: departmentStore,
  com_office_small: officeSmall,
  com_office_block: officeBlock,
  com_mall: (b, v, rng) => mall(b, v, rng),
};
