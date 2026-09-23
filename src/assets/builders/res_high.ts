/**
 * Residential high density: projects, highrise slab, tower, twin towers, luxury tower, supertall.
 * (owned by the residential asset agent)
 */
import type { ModelBuilder, ColorLike, Paint } from '../ModelBuilder';
import type { RNG } from '../../core/rng';
import { Surf } from '../../core/types';
import { rooftopWaterTank } from '../kit';
import {
  P, inFace, U, fq, door, lawnSlab, paveSlab, tree, trashCans, planter, parapet,
  flatRoof, setLot, band, bandRing, parking, chainFence, lounger, beacon, capPoly, poolRect, poolGlow, lightPool, parkedCar, type Face,
} from './res_util';
import { ww } from './res_mid';

// ---------------------------------------------------------------------------------------------- helpers
const ROOF = 0x6c6962;
const GLASS_RAIL = 0xa8bcc8;

/** Glass curtain box. */
function glassBox(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, tint: number, floor: number, top: Paint | null = P(ROOF, Surf.RoofFlat), faces: { pz?: Paint | null; nz?: Paint | null; px?: Paint | null; nx?: Paint | null } = {}): void {
  b.paint(0x2a3440, Surf.GlassCurtain, tint, floor).box(x0, y0, z0, x1, y1, z1, { top, ...faces });
}

/** Balcony ring around a rect at floor level y: slab box + outward rail quads (18 tris). sides: which faces get rails. */
function ringBalc(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, out: number, slab: ColorLike, rail: ColorLike | null = GLASS_RAIL, sides: Face[] = ['pz', 'nz', 'px', 'nx'], railSurf: Surf = Surf.Metal): void {
  const X0 = x0 - out, X1 = x1 + out, Z0 = z0 - out, Z1 = z1 + out;
  b.paint(slab).box(X0, y - 0.22, Z0, X1, y, Z1);
  if (rail === null) return;
  b.paint(rail, railSurf);
  const h = y + 1.05;
  if (sides.includes('pz')) b.quad([X0, y, Z1], [X1, y, Z1], [X1, h, Z1], [X0, h, Z1]);
  if (sides.includes('nz')) b.quad([X1, y, Z0], [X0, y, Z0], [X0, h, Z0], [X1, h, Z0]);
  if (sides.includes('px')) b.quad([X1, y, Z1], [X1, y, Z0], [X1, h, Z0], [X1, h, Z1]);
  if (sides.includes('nx')) b.quad([X0, y, Z0], [X0, y, Z1], [X0, h, Z1], [X0, h, Z0]);
}

/** Front/back only balcony slabs (strip) on z faces. */
function stripBalc(b: ModelBuilder, x0: number, x1: number, zFace: number, dir: 1 | -1, y: number, out: number, slab: ColorLike, rail: ColorLike = GLASS_RAIL, railSurf: Surf = Surf.Metal, rh = 1.05): void {
  const za = dir > 0 ? zFace : zFace - out, zb = dir > 0 ? zFace + out : zFace;
  b.paint(slab).box(x0, y - 0.22, za, x1, y, zb, dir > 0 ? { nz: null } : { pz: null });
  b.paint(rail, railSurf);
  const zr = dir > 0 ? zb : za, h = y + rh;
  if (dir > 0) b.quad([x0, y, zr], [x1, y, zr], [x1, h, zr], [x0, h, zr]);
  else b.quad([x1, y, zr], [x0, y, zr], [x0, h, zr], [x1, h, zr]);
}

/**
 * Vertical stack of small balconies / loggias on a world face: two side fins + per floor a slab top and rail front.
 * ~4 tris per floor + 12.
 */
function balcStack(b: ModelBuilder, f: Face, plane: number, a: number, w: number, dp: number, y0: number, y1: number, fh: number, slab: ColorLike, rail: ColorLike, railSurf: Surf = Surf.Plain): void {
  inFace(b, f, plane, () => {
    const u = U(f, a), x0 = u - w / 2, x1 = u + w / 2;
    b.paint(slab);
    b.box(x0 - 0.18, y0, 0, x0, y1, dp, { nz: null, bottom: null });
    b.box(x1, y0, 0, x1 + 0.18, y1, dp, { nz: null, bottom: null });
    for (let y = y0; y < y1 - 0.5; y += fh) {
      b.paint(slab).quad([x0, y, dp], [x1, y, dp], [x1, y, 0], [x0, y, 0]);
      b.paint(rail, railSurf).quad([x0, y - 0.2, dp], [x1, y - 0.2, dp], [x1, y + 1.0, dp], [x0, y + 1.0, dp]);
    }
  });
}

/** Emissive crown band ring around a rect. */
function litRing(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, color: ColorLike = 0xfff0cc): void {
  b.paint(color, Surf.Emissive).box(x0, y, z0, x1, y + h, z1, { top: null });
}

/** Spire: tapered mast with a red beacon. */
function spire(b: ModelBuilder, x: number, z: number, y: number, h: number, r: number, color: ColorLike = 0xc8ccd0): void {
  b.paint(color, Surf.Metal).cylinder(x, z, y, h, r, r * 0.12, 6, { top: false });
  beacon(b, x, y + h, z, 0xff3a2a, Math.max(0.35, r * 0.6));
}

/** Podium with glass lobby front, canopy and roof deck finish. */
function podium(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h: number, wall: ColorLike, lobbyW: number, deck: Paint = P(0x8a867e, Surf.RoofFlat), wallSurf: Surf = Surf.Stone): void {
  b.paint(wall, wallSurf).box(x0, 0, z0, x1, h, z1, { top: deck });
  inFace(b, 'pz', z1, () => {
    b.paint(0x2a2c2e); fq(b, -lobbyW / 2 - 0.15, 0.1, lobbyW / 2 + 0.15, Math.min(h - 0.6, 5.5), 0.04);
    b.paint(0x2a3440, Surf.GlassPlain); fq(b, -lobbyW / 2, 0.15, lobbyW / 2, Math.min(h - 0.75, 5.35), 0.07);
    b.paint(0x2a2c2e);
    for (let i = 1; i < Math.round(lobbyW / 1.8); i++) { const u = -lobbyW / 2 + i * (lobbyW / Math.round(lobbyW / 1.8)); fq(b, u - 0.05, 0.15, u + 0.05, Math.min(h - 0.75, 5.35), 0.09); }
    for (const s of [-1, 1]) {
      b.paint(0x2a3440, Surf.GlassPlain);
      const a = s * (lobbyW / 2 + 1.5), c = s * ((x1 - x0) / 2 - 1.2);
      if (Math.abs(c) - Math.abs(a) > 2) fq(b, Math.min(a, c), 0.8, Math.max(a, c), Math.min(h - 1.0, 4.2), 0.05);
    }
  });
  b.paint(0xe8e6e0).box(-lobbyW / 2 - 1, Math.min(h - 0.6, 5.5) - 0.9, z1, lobbyW / 2 + 1, Math.min(h - 0.6, 5.5) - 0.55, z1 + 3.2, { nz: null, bottom: { color: 0xd8d4cc } });
  b.paint(0xfff0c8, Surf.Emissive).box(-lobbyW / 2, Math.min(h - 0.6, 5.5) - 0.95, z1 + 0.5, lobbyW / 2, Math.min(h - 0.6, 5.5) - 0.9, z1 + 2.7, { top: null, px: null, nx: null, pz: null, nz: null, bottom: { color: 0xfff0c8, surf: Surf.Emissive } });
}

/** Paved plaza w/ planters and trees around a footprint; front edge at zf. */
function plaza(b: ModelBuilder, rng: RNG, hw: number, hd: number, color: ColorLike = 0xcfc9bd): void {
  paveSlab(b, -hw, -hd, hw, hd, color, 0.1);
  b.paint(0xb8b2a6, Surf.Pavement);
  for (let i = -3; i <= 3; i++) b.quad([i * hw / 3.5 - 0.05, 0.105, hd], [i * hw / 3.5 + 0.05, 0.105, hd], [i * hw / 3.5 + 0.05, 0.105, -hd], [i * hw / 3.5 - 0.05, 0.105, -hd]);
  void rng;
}

function roofBox(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, color: ColorLike = 0x8f8b84): void {
  b.paint(color).box(x0, y, z0, x1, y + h, z1, { bottom: null, top: P(0x5e5b55, Surf.RoofFlat) });
}

/** Low-poly regular prism with per-face paint (glass etc.), returns ring points. */
function prismPts(cx: number, cz: number, r: number, n: number, rot = 0): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return pts;
}
function polyBalc(b: ModelBuilder, pts: [number, number][], y: number, out: number, slab: ColorLike, rail: ColorLike | null = GLASS_RAIL): void {
  // expand polygon by `out` along vertex directions (convex, centered), draw slab top + edge + rails
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  const ex = pts.map(([x, z]) => { const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1; return [x + (dx / l) * out, z + (dz / l) * out] as [number, number]; });
  b.paint(slab);
  capPoly(b, ex, y, true);
  const n = ex.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = ex[i], [bx, bz] = ex[(i + 1) % n];
    const e1x = bx - ax, e1z = bz - az;
    const nx = e1z, nz = -e1x;
    const outward = (ax - cx) * nx + (az - cz) * nz > 0;
    const A: [number, number, number] = [ax, y - 0.22, az], B: [number, number, number] = [bx, y - 0.22, bz], Cc: [number, number, number] = [bx, y, bz], D: [number, number, number] = [ax, y, az];
    b.paint(slab);
    if (outward) b.quad(A, B, Cc, D); else b.quad(B, A, D, Cc);
    if (rail !== null) {
      b.paint(rail, Surf.Metal);
      const A2: [number, number, number] = [ax, y, az], B2: [number, number, number] = [bx, y, bz], C2: [number, number, number] = [bx, y + 1.05, bz], D2: [number, number, number] = [ax, y + 1.05, az];
      if (outward) b.quad(A2, B2, C2, D2); else b.quad(B2, A2, D2, C2);
    }
  }
}

// ---------------------------------------------------------------------------------------------- PROJECTS (R$) 2x2
function projects(b: ModelBuilder, v: number, rng: RNG): void {
  lawnSlab(b, -16, -16, 16, 16, 0x7a9448);
  const fh = 2.9;
  if (v === 0) {
    // cruciform red-brick tower (NYCHA style), 14 floors
    const brick = 0x8a4a3a, fl = 14, top = fl * fh;
    ww(b, -12, -3, 12, 3, 0, top, brick, 0, fh, null);
    ww(b, -3, -12, 3, -3, 0, top, brick, 0, fh, null, { pz: null });
    ww(b, -3, 3, 3, 12, 0, top, brick, 0, fh, null, { nz: null });
    b.paint(ROOF, Surf.RoofFlat);
    for (const [a, c, d, e] of [[-12, -3, 12, 3], [-3, -12, 3, -3], [-3, 3, 3, 12]] as [number, number, number, number][]) b.quad([a, top, e], [d, top, e], [d, top, c], [a, top, c]);
    for (const [a, c, d, e] of [[-12, -3, -3, 3], [3, -3, 12, 3], [-3, -12, 3, -3], [-3, 3, 3, 12]] as [number, number, number, number][]) parapet(b, a, c, d, e, top, 0.9, 0.25, 0x7a4234, 0x9a948a);
    roofBox(b, -2.5, -2.5, 2.5, 2.5, top, 3.4, 0x7a4234);
    rooftopWaterTank(b, 0, top + 3.4, 0, 1.0);
    inFace(b, 'pz', 12, () => { door(b, 0, 0.1, 2.2, 2.4, 0x55585c, { frame: 0x9a948a, lamp: true }); b.paint(0x9a948a).box(-2.2, 2.6, 0, 2.2, 2.8, 1.8, { nz: null }); });
    paveSlab(b, -1.5, 12, 1.5, 16, 0xb8b2a6, 0.1);
    parking(b, rng, 4.5, 4.0, 15.6, 15.6, 0.55, 2);
    paveSlab(b, -15.6, 4.5, -4.5, 15.6, 0xb0aa9e, 0.1);
    for (let i = 0; i < 3; i++) { const x = -13 + i * 3.8; b.paint(0x6b4a33, Surf.Wood).box(x - 0.8, 0.42, 14.5, x + 0.8, 0.5, 14.9, { bottom: null }); }
    chainFence(b, -15.8, -15.8, 15.8, -15.8, 1.0, 0x8a8f94, 4);
    chainFence(b, -15.8, -15.8, -15.8, 4, 1.0, 0x8a8f94, 4);
    for (const [x, z] of [[-9, -9], [9, -9], [-9, 8.5]] as [number, number][]) tree(b, rng, x, z, 1.1, 'round');
    trashCans(b, 4.2, 13.0, 3, 0x3a3d40);
  } else if (v === 1 || v === 3) {
    // concrete slab with small balcony stacks (v1) or deck-access galleries (v3)
    const C = 3, x0 = -4 * C, x1 = 4 * C, z0 = -2 * C, z1 = 2 * C;
    const fl = v === 1 ? 16 : 12, top = fl * fh, col = v === 1 ? 0xb8b4aa : 0xa8a49a;
    ww(b, x0, z0, x1, z1, 0, top, col, 0, fh, null);
    flatRoof(b, x0, z0, x1, z1, top, 0.9, 0.25, col, 0x77736c, 0x9a968e);
    if (v === 1) {
      for (const x of [-7.5, -1.5, 4.5, 10.5]) balcStack(b, 'pz', z1, x, 2.6, 1.1, fh, top, fh, 0xc8c4ba, 0x9aa89a);
      for (const x of [-7.5, 4.5]) balcStack(b, 'nz', z0, x, 2.6, 1.1, fh, top, fh, 0xc8c4ba, 0x9aa89a);
      roofBox(b, -3, -3, 3, 1, top, 3.2, 0x9a968e);
      for (let i = 0; i < 3; i++) b.paint(0x777777, Surf.Metal).cylinder(-8 + i * 2.5, 3, top, 2.2, 0.06, 0.06, 4, { top: false });
    } else {
      for (let f = 1; f < fl; f++) stripBalc(b, x0, x1, z1, 1, f * fh, 1.8, 0xb8b4aa, 0x9c988e);
      for (const x of [x0 - 3.5, x1]) { b.paint(0x9c988e).box(x, 0, -2.5, x + 3.5, top + 3, 2.5, { bottom: null, top: P(0x5e5b55, Surf.RoofFlat) }); }
      inFace(b, 'pz', 2.5, () => { b.paint(0x2a3440, Surf.GlassPlain); for (const u of [-14.2, 13.8]) fq(b, u - 0.4, 1.0, u + 0.4, top, 0.02); });
    }
    b.paint(0x3a3c40).box(-2.5, 0, z1, 2.5, 2.8, z1 + 0.05, { top: null, bottom: null, nz: null });
    b.paint(0x9a968e).box(-3, 2.8, z1, 3, 3.1, z1 + 2.2, { nz: null });
    parking(b, rng, -15.6, 8.6, 15.6, 15.8, 0.6, 1, 6);
    parking(b, rng, -15.6, -15.8, 15.6, -9.8, 0.5, 1, 5);
    paveSlab(b, -1.5, z1, 1.5, 8.6, 0xb8b2a6, 0.1);
    for (const x of [-13, 13]) tree(b, rng, x, -7.8, 0.9, 'round');
  } else {
    // square point block, 18 floors, colored spandrel panels, corner balcony stacks
    const C = 3, h = 3 * C, fl = 18, top = fl * fh;
    ww(b, -h, -h, h, h, fh, top, 0xc2beb4, 0, fh, null);
    b.paint(0x55585c).box(-h + 0.6, 0, -h + 0.6, h - 0.6, fh, h - 0.6, { top: null });
    for (const [x, z] of [[-h, -h], [h, -h], [-h, h], [h, h]] as [number, number][]) b.paint(0x9a968e).box(x - 0.4, 0, z - 0.4, x + 0.4, fh, z + 0.4, { bottom: null, top: null });
    b.paint(0x9a968e).quad([-h, fh, h], [h, fh, h], [h, fh, -h], [-h, fh, -h].map((q) => q) as [number, number, number]);
    flatRoof(b, -h, -h, h, h, top, 1.0, 0.25, 0xc2beb4, 0x77736c);
    // colored panel strips between window rows (every other floor)
    for (let f = 2; f < fl; f += 2) band(b, -h, -h, h, h, f * fh - 0.05, 0.9, 0.06, f % 4 === 0 ? 0x5a7ea0 : 0xc88a4a, false);
    for (const [f, x] of [['pz', 7.5], ['px', -7.5], ['nz', -7.5], ['nx', 7.5]] as [Face, number][]) balcStack(b, f, f === 'pz' ? h : f === 'nz' ? -h : f === 'px' ? h : -h, x, 2.4, 1.1, 2 * fh, top, fh, 0xd4d0c6, 0xd4d0c6);
    roofBox(b, -2.5, -2.5, 2.5, 2.5, top, 3.6, 0x9a968e);
    b.paint(0x777777, Surf.Metal).cylinder(1.5, 1.5, top + 3.6, 5, 0.08, 0.05, 4, { top: false });
    parking(b, rng, -15.6, 10.2, 15.6, 15.8, 0.6, 1);
    parking(b, rng, 10.2, -15.6, 15.8, 9.6, 0.0, 1);
    paveSlab(b, -1.5, h, 1.5, 10.2, 0xb8b2a6, 0.1);
    for (const [x, z] of [[-13, -13], [-13, 0], [0, -13], [7, -13]] as [number, number][]) tree(b, rng, x, z, 1.0, 'round');
    for (let i = 0; i < 3; i++) { const x = -13 + i * 3.2; b.paint(0x6b4a33, Surf.Wood).box(x - 0.8, 0.42, 7.0, x + 0.8, 0.5, 7.4, { bottom: null }); }
  }
}

// ---------------------------------------------------------------------------------------------- HIGHRISE SLAB (R$) 3x2
function highriseSlab(b: ModelBuilder, v: number, rng: RNG): void {
  lawnSlab(b, -24, -16, 24, 16, 0x7a9448);
  const C = 3, x0 = -7 * C, x1 = 7 * C, z0 = -2 * C, z1 = 2 * C;
  if (v === 0) {
    // soviet panel block: 16 floors, loggia stacks w/ colored panels, 3 entrance canopies, rooftop machine rooms
    const fh = 2.8, fl = 16, top = fl * fh;
    ww(b, x0, z0, x1, z1, 0, top, 0xc8c6c0, 0, fh, null);
    flatRoof(b, x0, z0, x1, z1, top, 0.7, 0.2, 0xb8b6b0, 0x77736c);
    const cols = [0x6a8aaa, 0xc8a060, 0x6a8aaa, 0xc8a060, 0x6a8aaa, 0xc8a060];
    [-16.5, -10.5, -4.5, 4.5, 10.5, 16.5].forEach((x, i) => balcStack(b, 'pz', z1, x, 2.8, 1.2, fh, top, fh, 0xd8d6d0, cols[i]));
    for (const x of [-13.5, 0, 13.5]) {
      b.paint(0xb8b6b0).box(x - 1.6, 2.6, z1, x + 1.6, 2.8, z1 + 1.8, { nz: null });
      inFace(b, 'pz', z1, () => door(b, x, 0.1, 1.4, 2.3, 0x6a5040, { frame: 0x9a968e, lamp: true }));
      roofBox(b, x - 2.5, -2.5, x + 2.5, 2.5, top, 3.0, 0xb8b6b0);
    }
    b.paint(0x888888, Surf.Metal).cylinder(0, 0, top + 3.0, 6, 0.08, 0.05, 4, { top: false });
    for (let i = 0; i < 12; i++) b.paint(0x55585c).box(x0 + 1 + i * 3.4, top + 0.1, z0 + 0.8, x0 + 1.4 + i * 3.4, top + 1.6, z0 + 1.2);
    parking(b, rng, -23.6, 9.0, 4, 15.8, 0.65, 1);
    b.paint(0xd8c49a, Surf.Pavement).box(8, 0, 8.6, 20, 0.12, 15.2, { bottom: null });
    playMini(b, 11.5, 12);
    b.paint(0xc9483a).box(15.5, 0, 10.5, 17.5, 1.1, 11.4, { bottom: null });
    b.paint(0x3a7ab8, Surf.Metal).box(17.8, 0, 12.5, 19.4, 0.25, 14.4, { bottom: null });
    paveSlab(b, -23.6, 6.2, 23.6, 8.2, 0xb8b2a6, 0.1);
    for (const x of [-20, -6, 6, 20]) tree(b, rng, x, -11, 1.1, 'round');
    for (const x of [-22, 22]) tree(b, rng, x, 3, 1.0, 'cone');
  } else if (v === 1) {
    // brutalist: 20 floors raw concrete, egg-crate balconies with solid parapets, pilotis, back cores
    const fh = 2.8, fl = 20, top = fl * fh;
    const conc = 0x9a968e;
    ww(b, x0, z0, x1, z1, fh, top, 0x5a5a58, 3, fh, null, { px: P(conc), nx: P(conc) });
    b.paint(0x3a3c40).box(x0 + 1.5, 0, z0 + 1.5, x1 - 1.5, fh, z1 - 1.5, { top: null });
    for (let i = 0; i <= 7; i++) { const x = x0 + i * 6; b.paint(conc).box(x - 0.5, 0, z0 - 0.3, x + 0.5, fh, z1 + 0.3, { bottom: null, top: null }); }
    for (let f = 2; f <= fl; f++) stripBalc(b, x0, x1, z1, 1, f * fh - 0.9, 1.6, conc, conc, Surf.Plain, 1.0);
    // full-height stair-core slots (glazed)
    for (const c of [-12, 0, 12]) {
      b.paint(conc).box(c - 1.3, fh, z1, c + 1.3, top + 1.2, z1 + 1.8, { nz: null, bottom: null, top: P(0x5e5b55, Surf.RoofFlat) });
      inFace(b, 'pz', z1 + 1.8, () => { b.paint(0x2a3440, Surf.GlassPlain, 2); fq(b, c - 0.5, fh + 0.4, c + 0.5, top + 0.6, 0.02); });
    }
    for (let i = 1; i < 7; i++) { const x = x0 + i * 6; b.paint(conc).box(x - 0.18, fh, z1, x + 0.18, top, z1 + 1.6, { nz: null, bottom: null }); }
    for (const x of [-12, 12]) { b.paint(0x8a867e).box(x - 2.5, 0, z0 - 4.5, x + 2.5, top + 4, z0, { bottom: null, pz: null, top: P(0x5e5b55, Surf.RoofFlat) }); }
    flatRoof(b, x0, z0, x1, z1, top, 1.2, 0.3, conc, 0x6c6962);
    roofBox(b, -4, -3, 4, 3, top, 3.5, conc);
    paveSlab(b, x0 - 1, z1, x1 + 1, 16, 0xa8a49a, 0.1);
    parking(b, rng, -23.6, 9.5, 23.6, 15.8, 0.6, 1);
    for (const x of [-22, 22]) tree(b, rng, x, 0, 1.0, 'round');
    parking(b, rng, -23.6, -15.8, -15, -11, 0.4, 1);
  } else {
    // Unité d'habitation: on pilotis, brise-soleil grid w/ colored loggias, sculptural roof terrace
    const fh = 3.3, fl = 14, y0 = 2 * fh, top = y0 + (fl - 2) * fh;
    const conc = 0xb0aca2;
    b.paint(conc, Surf.WallWindows, 3, fh).box(x0, y0, z0, x1, top, z1, { top: P(0xa8a498, Surf.Pavement), bottom: { color: 0x8a867e } });
    for (let i = 0; i <= 5; i++) {
      const x = x0 + 2 + i * ((x1 - x0 - 4) / 5);
      for (const z of [z0 + 2, z1 - 2]) b.paint(conc).cylinder(x, z, 0, y0, 1.1, 0.7, 6, { top: false });
    }
    // brise-soleil grid on the front: vertical fins + floor bands
    for (let i = 0; i <= 14; i++) b.paint(0xc8c4ba).box(x0 + i * 3 - 0.15, y0, z1, x0 + i * 3 + 0.15, top, z1 + 1.0, { nz: null, bottom: null });
    for (let f = 1; f < fl - 2; f++) b.paint(0xc8c4ba).box(x0, y0 + f * fh - 0.15, z1, x1, y0 + f * fh + 0.15, z1 + 1.0, { nz: null, bottom: null });
    const pal = [0xc0392b, 0xe0b030, 0x2e6fb5, 0x3d8a4a];
    inFace(b, 'pz', z1, () => {
      for (let i = 0; i < 22; i++) {
        const c = rng.int(0, 13), f = rng.int(0, fl - 3);
        b.paint(pal[i % 4]); fq(b, x0 + c * 3 + 0.2, y0 + f * fh + 0.2, x0 + c * 3 + 0.9, y0 + (f + 1) * fh - 0.2, 0.3);
      }
    });
    // roof terrace sculpture: ventilation cone, gym box, running track edge
    b.paint(0xc8c4ba).cylinder(-12, 0, top, 6, 2.2, 1.0, 8, { top: true });
    b.paint(0xc8c4ba).box(6, top, -4, 16, top + 3.2, 3, { bottom: null, top: P(0x8a867e, Surf.RoofFlat) });
    b.paint(0x55585c).box(x0, top, z0, x1, top + 1.2, z0 + 0.3, { bottom: null });
    b.paint(0x55585c).box(x0, top, z1 - 0.3, x1, top + 1.2, z1, { bottom: null });
    lawnSlab(b, -23.6, -15.6, 23.6, 15.6, 0x6a9443, 0.1);
    paveSlab(b, -3, z1, 3, 16, 0xb8b2a6, 0.12);
    for (const [x, z] of [[-18, 11], [-10, 12], [10, 12], [18, 11], [-18, -12], [0, -12], [18, -12]] as [number, number][]) tree(b, rng, x, z, 1.15, 'wide');
    parking(b, rng, 6, 9.8, 23.6, 15.8, 0.5, 1);
  }
}

function playMini(b: ModelBuilder, x: number, z: number): void {
  b.paint(0xc9483a).box(x - 1.2, 0, z - 0.6, x + 0.2, 1.4, z + 0.6, { bottom: null });
  b.paint(0x3a7ab8).gableRoof(x - 0.5, z, 1.4, 1.2, 1.4, 0.6, 'x', 0.1);
  b.paint(0xd9b23a, Surf.Metal).quad2([x + 0.2, 1.2, z - 0.3], [x + 0.2, 1.2, z + 0.3], [x + 2.0, 0.15, z + 0.3], [x + 2.0, 0.15, z - 0.3]);
}

// ---------------------------------------------------------------------------------------------- TOWER (R$$) 2x2
function tower(b: ModelBuilder, v: number, rng: RNG): void {
  plaza(b, rng, 16, 16, 0xcfc9bd);
  const fh = 3.1;
  if (v === 0) {
    // 30-floor beige tower with balcony rings every floor, podium, mechanical crown frame
    const C = 4.2, h = 2 * C + 1.05 * 0, fl = 30, py = 2 * fh, top = fl * fh;
    const x0 = -2.5 * C, x1 = 2.5 * C;
    podium(b, -14, -14, 14, 12, py, 0xb8ae9c, 10);
    ww(b, x0, -h, x1, h, py, top, 0xbfae90, 3, fh, P(ROOF, Surf.RoofFlat));
    for (let f = 3; f < fl; f++) ringBalc(b, x0, -h, x1, h, f * fh, 1.3, 0xf2eee6);
    roofBox(b, -5, -4, 5, 4, top, 4.5, 0xd8d0c0);
    b.paint(0xe2d8c6);
    for (const [a, c] of [[x0, -h], [x1, -h], [x0, h], [x1, h]] as [number, number][]) b.box(a - 0.3, top, c - 0.3, a + 0.3, top + 6, c + 0.3, { bottom: null });
    bandRing(b, x0, -h, x1, h, top + 5.2, 0.8, 0.3, 0xe2d8c6);
    litRing(b, x0 - 0.31, -h - 0.31, x1 + 0.31, h + 0.31, top + 5.0, 0.2, 0xfff0cc);
    podiumDeck(b, rng, -14, -14, 14, 12, py, x0 - 1.4, -h - 1.4, x1 + 1.4, h + 1.4);
    streetTrees(b, rng, 16, 14.6);
  } else if (v === 1) {
    // brick-clad wedding-cake tower with setbacks, water tank, corner balconies
    const C = 3, podH = 3 * fh;
    const brick = 0x8e5a44;
    podium(b, -15, -15, 15, 13, podH, 0x7a4a3a, 9, P(ROOF, Surf.RoofFlat), Surf.Brick);
    const tiers: [number, number, number][] = [[3, 20, 4 * C], [20, 25, 3 * C], [25, 28, 2 * C]];
    for (const [f0, f1, h] of tiers) {
      ww(b, -h, -h, h, h, f0 * fh, f1 * fh, brick, 0, fh, P(ROOF, Surf.RoofFlat));
      bandRing(b, -h, -h, h, h, f1 * fh - 0.4, 0.4, 0.25, 0xd8d0c0);
      if (f1 < 28) parapet(b, -h, -h, h, h, f1 * fh, 1.0, 0.2, brick, 0xd8d0c0);
    }
    for (const a of [-7.5, 7.5]) balcStack(b, 'pz', 4 * C, a, 2.6, 1.2, 4 * fh, 20 * fh, fh, 0xd8d0c0, 0x7a8288, Surf.Metal);
    balcStack(b, 'px', 4 * C, 7.5, 2.6, 1.2, 4 * fh, 20 * fh, fh, 0xd8d0c0, 0x7a8288, Surf.Metal);
    balcStack(b, 'nx', -4 * C, -7.5, 2.6, 1.2, 4 * fh, 20 * fh, fh, 0xd8d0c0, 0x7a8288, Surf.Metal);
    rooftopWaterTank(b, 2, 28 * fh, -2, 1.3);
    roofBox(b, -4.5, -1, -0.5, 4, 28 * fh, 3.0, brick);
    b.paint(0x2e3033).box(-15, podH, 12.8, 15, podH + 0.8, 13, { bottom: null });
    streetTrees(b, rng, 16, 14.6);
  } else if (v === 2) {
    // 34-floor teal glass tower with white slab bands on front/back, open crown frame
    const x0 = -9, x1 = 9, z0 = -9, z1 = 9, fl = 34, py = 2 * fh, top = fl * fh;
    podium(b, -14, -14, 14, 12.5, py, 0x9a9690, 10);
    glassBox(b, x0, z0, x1, z1, py, top, 6, fh);
    for (let f = 3; f < fl; f++) {
      stripBalc(b, x0, x1, z1, 1, f * fh, 1.5, 0xf4f4f0);
      stripBalc(b, x0, x1, z0, -1, f * fh, 1.5, 0xf4f4f0);
    }
    b.paint(0xf4f4f0);
    for (const x of [x0, x1]) b.box(x - 0.3, py, z0 - 1.5, x + 0.3, top + 8, z0 - 0.9).box(x - 0.3, py, z1 + 0.9, x + 0.3, top + 8, z1 + 1.5);
    for (const y of [top + 3, top + 7.4]) { b.box(x0 - 0.3, y, z1 + 0.9, x1 + 0.3, y + 0.6, z1 + 1.5, { bottom: null }); b.box(x0 - 0.3, y, z0 - 1.5, x1 + 0.3, y + 0.6, z0 - 0.9, { bottom: null }); }
    roofBox(b, -5, -5, 5, 5, top, 4.0, 0xd8d8d4);
    litRing(b, -5.02, -5.02, 5.02, 5.02, top + 3.4, 0.35, 0xbfe8ff);
    podiumDeck(b, rng, -14, -14, 14, 12.5, py, x0 - 0.1, z0 - 1.6, x1 + 0.1, z1 + 1.6);
    streetTrees(b, rng, 16, 14.6);
  } else if (v === 3) {
    // octagonal white tower with balcony rings, square podium
    const fl = 28, py = 2 * fh, top = fl * fh;
    podium(b, -14, -14, 14, 12.5, py, 0xc2bcb0, 10);
    const pts = prismPts(0, 0, 11, 8, Math.PI / 8);
    b.paint(0xe8e6e0, Surf.WallWindows, 3, fh).extrude(pts, py, top - py, { topPaint: P(ROOF, Surf.RoofFlat) });
    for (let f = 3; f < fl; f++) polyBalc(b, pts, f * fh, 1.3, 0xf6f4f0);
    b.paint(0xe8e6e0).extrude(prismPts(0, 0, 6.5, 8, Math.PI / 8), top, 4.2, { topPaint: P(0x5e5b55, Surf.RoofFlat) });
    b.paint(0xfff0cc, Surf.Emissive).extrude(prismPts(0, 0, 6.55, 8, Math.PI / 8), top + 3.4, 0.4, { top: false });
    spire(b, 0, 0, top + 4.2, 8, 0.35);
    podiumDeck(b, rng, -14, -14, 14, 12.5, py, -12.5, -12.5, 12.5, 12.5);
    streetTrees(b, rng, 16, 14.6);
  } else if (v === 4) {
    // L-shaped 22-floor tower, terracotta panels, corner balcony stacks, roof garden
    const C = 3, fl = 22, py = 2 * fh, top = fl * fh;
    podium(b, -14, -14, 14, 12.5, py, 0x8a7a6a, 10);
    const col = 0xc07a58;
    ww(b, -4 * C, 0, 4 * C, 3 * C, py, top, col, 0, fh, P(0x5f8a3a, Surf.Foliage));
    ww(b, -4 * C, -4 * C, -1 * C, 0, py, top, col, 0, fh, P(0x5f8a3a, Surf.Foliage), { pz: null });
    parapet(b, -4 * C, 0, 4 * C, 3 * C, top, 1.1, 0.25, 0xe8e0d0);
    parapet(b, -4 * C, -4 * C, -1 * C, 0, top, 1.1, 0.25, 0xe8e0d0);
    balcStack(b, 'pz', 3 * C, 10.5, 2.6, 1.4, 3 * fh, top, fh, 0xe8e0d0, GLASS_RAIL, Surf.Metal);
    balcStack(b, 'pz', 3 * C, -10.5, 2.6, 1.4, 3 * fh, top, fh, 0xe8e0d0, GLASS_RAIL, Surf.Metal);
    balcStack(b, 'px', -1 * C, -7.5, 2.6, 1.4, 3 * fh, top, fh, 0xe8e0d0, GLASS_RAIL, Surf.Metal);
    balcStack(b, 'nz', -4 * C, -7.5, 2.6, 1.4, 3 * fh, top, fh, 0xe8e0d0, GLASS_RAIL, Surf.Metal);
    balcStack(b, 'px', 4 * C, 4.5, 2.6, 1.4, 3 * fh, top, fh, 0xe8e0d0, GLASS_RAIL, Surf.Metal);
    for (const [x, z] of [[-8, 5], [6, 4], [-7, -7]] as [number, number][]) { b.paint(0x4f7a34, Surf.Foliage).blob(x, top + 1.2, z, 1.6, 1.2, 1.6, 0, 0.2, x); }
    roofBox(b, 0, 2, 5, 7, top, 3.5, 0xe8e0d0);
    podiumDeck(b, rng, -14, -14, 14, 12.5, py, -12.5, -12.5, 12.5, 9.5);
    streetTrees(b, rng, 16, 14.6);
  } else {
    // 32-floor twin-slab tower with central glass core, vertical fins, dark grey + white
    const fl = 32, py = 2 * fh, top = fl * fh;
    podium(b, -14, -14, 14, 12.5, py, 0x55585c, 10);
    const C = 3;
    ww(b, -4 * C, -3 * C, -1 * C, 3 * C, py, top, 0xecebe6, 0, fh);
    ww(b, 1 * C, -3 * C, 4 * C, 3 * C, py, top, 0x4a4d52, 0, fh);
    glassBox(b, -1 * C, -1.5 * C, 1 * C, 1.5 * C, py, top + 6, 3, fh, P(ROOF, Surf.RoofFlat), {});
    b.paint(0xd8d8d4);
    for (let i = 0; i <= 3; i++) { b.box(-4 * C + i * C - 0.12, py, 3 * C, -4 * C + i * C + 0.12, top, 3 * C + 0.9, { nz: null, bottom: null }); b.box(C + i * C - 0.12, py, 3 * C, C + i * C + 0.12, top, 3 * C + 0.9, { nz: null, bottom: null }); }
    for (let f = 4; f < fl; f += 4) { stripBalc(b, -4 * C, -1 * C, 3 * C, 1, f * fh, 1.4, 0xecebe6); stripBalc(b, 1 * C, 4 * C, 3 * C, 1, f * fh + 2 * fh, 1.4, 0xecebe6); }
    for (const x of [-7.5, 7.5]) roofBox(b, x - 3, -4, x + 3, 4, top, 3.0, x < 0 ? 0xecebe6 : 0x4a4d52);
    litRing(b, -1 * C - 0.02, -1.5 * C - 0.02, 1 * C + 0.02, 1.5 * C + 0.02, top + 5.4, 0.4, 0xbfe8ff);
    podiumDeck(b, rng, -14, -14, 14, 12.5, py, -12.5, -9.5, 12.5, 9.5);
    streetTrees(b, rng, 16, 14.6);
  }
}

/** Podium roof deck dressing around a tower footprint: planters, lawn patches, trees. */
function podiumDeck(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, y: number, tx0: number, tz0: number, tx1: number, tz1: number): void {
  b.paint(GLASS_RAIL, Surf.Metal);
  b.quad([x0, y, z1], [x1, y, z1], [x1, y + 1.1, z1], [x0, y + 1.1, z1]);
  b.quad([x1, y, z1], [x1, y, z0], [x1, y + 1.1, z0], [x1, y + 1.1, z1]);
  const pads: [number, number, number, number][] = [[x0 + 0.8, tz1 + 0.6, x1 - 0.8, z1 - 0.8], [tx1 + 0.6, z0 + 0.8, x1 - 0.8, tz1 + 0.6]];
  for (const [a, c, d, e] of pads) {
    if (d - a < 1.5 || e - c < 1.5) continue;
    b.paint(0x5f8a3a, Surf.Foliage).box(a, y, c, d, y + 0.3, e, { bottom: null });
    const n = Math.max(1, Math.floor((d - a) / 7));
    for (let i = 0; i < n; i++) b.paint(0x4f7a34, Surf.Foliage).blob(a + (i + 0.5) * ((d - a) / n), y + 1.3, (c + e) / 2, 1.2, 1.1, 1.2, 0, 0.2, i + y);
  }
  void rng;
}

function streetTrees(b: ModelBuilder, rng: RNG, hw: number, z: number): void {
  for (const x of [-hw + 2.5, hw - 2.5]) { b.paint(0x5a4432).box(x - 0.8, 0.1, z - 0.8, x + 0.8, 0.13, z + 0.8, { bottom: null }); tree(b, rng, x, z, 0.85, 'round'); }
}

// ---------------------------------------------------------------------------------------------- TWIN TOWERS (R$$) 3x3
function twinTowers(b: ModelBuilder, v: number, rng: RNG): void {
  plaza(b, rng, 24, 24, 0xcfc9bd);
  const fh = 3.1;
  type T = [number, number, number, number, number]; // x0, z0, x1, z1, floors
  // per-variant layout: v0 A back-right / B front-left, v1 side by side at the back, v2 diagonal mirrored (A front-left)
  const L = [
    { A: [1, -21, 19, -4, 36] as T, B: [-19, -1, -3, 15, 26] as T, pf: 2, pool: [3, 4, 17, 10], lawns: [[-21, -21, -3, -4], [2, 12, 21, 18]], trees: [[-17, -17], [-8, -17], [-17, -8], [6, 15], [17, 15]] },
    { A: [1, -20, 19, -4, 36] as T, B: [-19, -20, -3, -4, 27] as T, pf: 3, pool: [-8, 6, 8, 12], lawns: [[-21, -1, -10, 18], [10, -1, 21, 18]], trees: [[-17, 3], [-14, 14], [14, 14], [17, 3], [-3, 16]] },
    { A: [-19, -1, -3, 15, 38] as T, B: [1, -21, 19, -4, 26] as T, pf: 4, pool: [-19, -19, -5, -12], lawns: [[1, 0, 21, 18], [-21, -9, -3, -3]], trees: [[5, 4], [16, 4], [5, 15], [16, 15], [-16, -6]] },
  ][v];
  const py = L.pf * fh;
  const pod = [0x9a9690, 0xc2b8a4, 0x8a5a44][v];
  podium(b, -22, -22, 22, 19, py, pod, 12, P(0x8a867e, Surf.RoofFlat), v === 2 ? Surf.Brick : Surf.Stone);
  // garden deck: lawns, trees, pool
  for (const [a, c, d, e] of L.lawns) b.paint(0x5f8a3a, Surf.Foliage).box(a, py, c, d, py + 0.3, e, { bottom: null });
  for (const [x, z] of L.trees) { b.paint(0x5b4330, Surf.Wood).cylinder(x, z, py + 0.3, 1.6, 0.16, 0.12, 5, { top: false }); b.paint(0x4f7a34, Surf.Foliage).blob(x, py + 3.0, z, 2.0, 1.7, 2.0, 0, 0.2, x * z); }
  { const [a, c, d, e] = L.pool; poolRect(b, a, c, d, e, 0xe2dccd, 0.8, 0x3fb0d8, py); }
  b.paint(GLASS_RAIL, Surf.Metal).quad([-22, py, 19], [22, py, 19], [22, py + 1.1, 19], [-22, py + 1.1, 19]).quad([22, py, 19], [22, py, -22], [22, py + 1.1, -22], [22, py + 1.1, 19]);
  const A = L.A, B = L.B;
  if (v === 0) {
    for (const [x0, z0, x1, z1, fl] of [A, B]) {
      const top = fl * fh;
      glassBox(b, x0, z0, x1, z1, py, top, 6, fh);
      for (let f = 4; f < fl; f++) {
        if (f % 6 === 0) { band(b, x0, z0, x1, z1, f * fh - 0.9, 0.9, 0.15, 0xd8d8d4); continue; } // mechanical floor band
        ringBalc(b, x0, z0, x1, z1, f * fh, 1.2, 0xf4f4f0, GLASS_RAIL, ['pz', 'px', 'nx', 'nz']);
      }
      roofBox(b, x0 + 3, z0 + 3, x1 - 3, z1 - 3, top, 4.5, 0xd8d8d4);
      litRing(b, x0 + 2.98, z0 + 2.98, x1 - 2.98, z1 - 2.98, top + 3.9, 0.35, 0xbfe8ff);
      beacon(b, (x0 + x1) / 2, top + 4.5, (z0 + z1) / 2);
    }
  } else if (v === 1) {
    for (const [x0, z0, x1, z1, fl] of [A, B]) {
      const top = fl * fh, s = fl > 30 ? 1 : 0;
      const C = 4.2;
      const X0 = Math.round(x0 / C) * C, X1 = Math.round(x1 / C) * C, Z0 = Math.round(z0 / C) * C, Z1 = Math.round(z1 / C) * C;
      ww(b, X0, Z0, X1, Z1, py, top - 4 * fh, 0xe0d4be, 3, fh);
      ww(b, X0 + C, Z0 + C, X1 - C, Z1 - C, top - 4 * fh, top, 0xe0d4be, 3, fh);
      for (let f = 4; f < fl - 4; f++) ringBalc(b, X0, Z0, X1, Z1, f * fh, 1.2, 0xf2ece0, GLASS_RAIL, ['pz', 'px']);
      bandRing(b, X0, Z0, X1, Z1, (fl - 4) * fh, 0.5, 0.3, 0xf2ece0);
      b.paint(0x3e444c, Surf.RoofTiles).pyramid((X0 + X1) / 2, (Z0 + Z1) / 2, X1 - X0 - 2 * C, Z1 - Z0 - 2 * C, top, 6 + s * 3);
      spire(b, (X0 + X1) / 2, (Z0 + Z1) / 2, top + 5 + s * 3, 5, 0.25);
    }
  } else {
    for (const [x0, z0, x1, z1, fl] of [A, B]) {
      const top = fl * fh, C = 3;
      const X0 = Math.round(x0 / C) * C, X1 = Math.round(x1 / C) * C, Z0 = Math.round(z0 / C) * C, Z1 = Math.round(z1 / C) * C;
      ww(b, X0, Z0, X1, Z1, py, top, 0xb8704e, 0, fh);
      for (const a of [X0 + 1.5 + C, X1 - 1.5 - C]) balcStack(b, 'pz', Z1, a, 2.6, 1.3, 4 * fh, top, fh, 0xe8dccc, GLASS_RAIL, Surf.Metal);
      balcStack(b, 'px', X1, (Z0 + Z1) / 2 + 1.5, 2.6, 1.3, 4 * fh, top, fh, 0xe8dccc, GLASS_RAIL, Surf.Metal);
      flatRoof(b, X0, Z0, X1, Z1, top, 1.2, 0.3, 0xe8dccc, 0x5f8a3a);
      roofBox(b, X0 + 3, Z0 + 3, X0 + 9, Z0 + 8, top, 3.6, 0xe8dccc);
      for (let f = 8; f < fl; f += 8) bandRing(b, X0, Z0, X1, Z1, f * fh - 0.4, 0.6, 0.2, 0xe8dccc);
    }
  }
  streetTrees(b, rng, 24, 21.5);
  for (const x of [-10, 10]) planter(b, x, 21, 3.0, 1.2, 0.1, 0x8f8a80, 0x4f7a34, x);
}

// ---------------------------------------------------------------------------------------------- LUXURY TOWER (R$$$) 3x3
function luxuryTower(b: ModelBuilder, v: number, rng: RNG): void {
  plaza(b, rng, 24, 24, 0xd6d0c4);
  const fh = 3.4;
  // per-variant podium: colour (stone / granite / bronze), height, pool position; #1 stepped, #3 L-shaped infinity pool
  const PD = [
    { col: 0xd8d2c4, fl: 3, pools: [[-20, 12, -6, 17]], trees: [[16, 14], [20, 10], [19, -18], [14, -19]] },
    { col: 0x4a4a4c, fl: 2, pools: [[14.5, -12, 20.5, 12]], trees: [[-18, 14], [-12, 15], [-19, -18], [-13, -19]] },
    { col: 0x8a6a4a, fl: 4, pools: [[-12, -20.5, 12, -14.5]], trees: [[-18, 14], [18, 14], [-19, 4], [19, 4]] },
    { col: 0xd8d2c4, fl: 3, pools: [[-20, 13, 13.5, 17], [15, -14, 20.5, 17]], trees: [[-19, -18], [-19, -8], [8, -19]] },
    { col: 0x4a4a4c, fl: 2, pools: [[-20.5, -12, -14.5, 12]], trees: [[16, 14], [19, 6], [19, -16], [14, -19]] },
  ][v];
  const py = PD.fl * fh;
  podium(b, -22, -22, 22, 18, py, PD.col, 14, P(0xd8d2c4, Surf.Pavement));
  let deckY = py;
  if (v === 1) {
    // stepped podium: an extra amenity tier (lounge floor) over the back/left part
    deckY = py;
    b.paint(PD.col, Surf.Stone).box(-20, py, -20, 12, py + fh, 10, { bottom: null, top: P(0xd8d2c4, Surf.Pavement) });
    inFace(b, 'pz', 10, () => { b.paint(0x2a3440, Surf.GlassPlain, 2); fq(b, -19.5, py + 0.4, 11.5, py + fh - 0.4, 0.03); });
    b.paint(GLASS_RAIL, Surf.Metal).quad([-20, py + fh, 10], [12, py + fh, 10], [12, py + fh + 1.1, 10], [-20, py + fh + 1.1, 10]);
  }
  for (const [a, c, d, e] of PD.pools) {
    b.paint(0xe2dccd, Surf.Pavement).box(a - 0.8, deckY, c - 0.8, d + 0.8, deckY + 0.14, e + 0.8, { bottom: null });
    b.paint(0x2f9fc8, Surf.Water).box(a, deckY, c, d, deckY + 0.3, e, { bottom: null });
    poolGlow(b, a, c, d, e, deckY + 0.3);
  }
  if (v === 3) b.paint(0x2f9fc8, Surf.Water).box(20.5, deckY - 0.6, -14, 20.9, deckY + 0.3, 17, { bottom: null, nx: null }); // infinity edge spill
  const [pa, pc, pd, pe] = PD.pools[0];
  const alongX = pd - pa >= pe - pc;
  for (let i = 0; i < 5; i++) {
    if (alongX) lounger(b, pa + 1.5 + i * ((pd - pa - 3) / 4), pc > 0 ? pc - 1.6 : pe + 1.6, pc > 0 ? 0 : Math.PI, 0xf2f0ea, deckY + 0.14);
    else lounger(b, pa > 0 ? pa - 1.6 : pd + 1.6, pc + 1.5 + i * ((pe - pc - 3) / 4), pa > 0 ? Math.PI / 2 : -Math.PI / 2, 0xf2f0ea, deckY + 0.14);
  }
  for (const [x, z] of PD.trees) { b.paint(0x5b4330, Surf.Wood).cylinder(x, z, py, 1.8, 0.15, 0.12, 5, { top: false }); b.paint(0x4f7a34, Surf.Foliage).blob(x, py + 3.0, z, 1.8, 1.6, 1.8, 0, 0.2, x + z); }
  b.paint(GLASS_RAIL, Surf.Metal).quad([-22, py, 18], [22, py, 18], [22, py + 1.1, 18], [-22, py + 1.1, 18]).quad([22, py, 18], [22, py, -22], [22, py + 1.1, -22], [22, py + 1.1, 18]);
  if (v === 0) {
    // chamfered square glass tower, sky gardens every 15 floors, tapered lit crown + spire
    const fl = 44, top = fl * fh;
    const pts: [number, number][] = [[-10, -6], [-6, -10], [6, -10], [10, -6], [10, 6], [6, 10], [-6, 10], [-10, 6]];
    const segs: [number, number][] = [[3, 15], [16, 30], [31, fl]];
    for (const [f0, f1] of segs) b.paint(0x2a3440, Surf.GlassCurtain, 6, fh).extrude(pts, f0 * fh, (f1 - f0) * fh, { top: false });
    for (const f of [15, 30]) {
      const inset = pts.map(([x, z]) => [x * 0.8, z * 0.8] as [number, number]);
      b.paint(0x3a3c40).extrude(inset, f * fh, fh, { top: false });
      polyBalc(b, pts, f * fh + 0.2, 0.0, 0xe8e6e0, GLASS_RAIL);
      for (const [x, z] of [[-7, 0], [7, 0], [0, 7], [0, -7]] as [number, number][]) b.paint(0x4f7a34, Surf.Foliage).blob(x * 0.95, f * fh + 1.2, z * 0.95, 1.2, 1.0, 1.2, 0, 0.2, x + f);
    }
    // crown
    const crown = pts.map(([x, z]) => [x * 0.55, z * 0.55] as [number, number]);
    b.paint(0x2a3440, Surf.GlassCurtain, 5, fh);
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length], [cx, cz] = crown[(i + 1) % pts.length], [dx, dz] = crown[i];
      b.quad([ax, top, az], [bx, top, bz], [cx, top + 10, cz], [dx, top + 10, dz]);
    }
    b.paint(0xfff0cc, Surf.Emissive).extrude(crown, top + 10, 0.5, { top: true });
    b.paint(0xfff0cc, Surf.Emissive).extrude(pts.map(([x, z]) => [x * 1.005, z * 1.005] as [number, number]), top - 0.4, 0.4, { top: false });
    spire(b, 0, 0, top + 10.5, 18, 0.5);
  } else if (v === 1) {
    // twisting tower: blocks of 3 floors rotated incrementally, white slab edges
    const blocks = 15, s = 9.5;
    for (let i = 0; i < blocks; i++) {
      const y0 = py + i * 3 * fh, a = (i / blocks) * (Math.PI / 2);
      const pts = prismPts(0, 0, s * Math.SQRT2, 4, Math.PI / 4 + a);
      b.paint(0x2a3440, Surf.GlassCurtain, 6, fh).extrude(pts, y0, 3 * fh - 0.25, { top: false });
      polyBalc(b, pts, y0 + 3 * fh, 0.9, 0xf4f4f0, i === blocks - 1 ? null : GLASS_RAIL);
    }
    const topY = py + blocks * 3 * fh;
    b.paint(0xf4f4f0).extrude(prismPts(0, 0, 8, 4, Math.PI / 4 + Math.PI / 2), topY, 6, { topPaint: P(0x5e5b55, Surf.RoofFlat) });
    b.paint(0xbfe8ff, Surf.Emissive).extrude(prismPts(0, 0, 8.05, 4, Math.PI / 4 + Math.PI / 2), topY + 5.2, 0.4, { top: false });
    beacon(b, 0, topY + 6, 0);
  } else if (v === 2) {
    // cylindrical teal glass tower, balcony rings every 2 floors, lit crown ring
    const fl = 42, top = fl * fh, pts = prismPts(0, 0, 10.5, 12);
    b.paint(0x2a3440, Surf.GlassCurtain, 6, fh).extrude(pts, py, top - py, { topPaint: P(ROOF, Surf.RoofFlat) });
    for (let f = 4; f < fl; f += 3) polyBalc(b, pts, f * fh, 1.2, 0xf4f4f0, GLASS_RAIL);
    const cr = prismPts(0, 0, 10.6, 12);
    b.paint(0xf4f4f0);
    for (let i = 0; i < 12; i += 2) { const [x, z] = cr[i]; b.box(x - 0.3, top, z - 0.3, x + 0.3, top + 9, z + 0.3, { bottom: null }); }
    b.paint(0xbfe8ff, Surf.Emissive).extrude(prismPts(0, 0, 10.7, 12), top + 8, 0.5, { top: false });
    b.paint(0xd8d8d4).extrude(prismPts(0, 0, 6, 8), top, 4.5, { topPaint: P(0x5e5b55, Surf.RoofFlat) });
    spire(b, 0, 0, top + 4.5, 10, 0.4);
  } else if (v === 3) {
    // stepped setback tower: bronze glass, stone fins, lit art-deco crown with spire
    const tiers: [number, number, number][] = [[3, 26, 10.5], [26, 38, 8.4], [38, 46, 6.3]];
    for (const [f0, f1, h] of tiers) {
      glassBox(b, -h, -h, h, h, f0 * fh, f1 * fh, 2, fh, P(0xd8cfbc, Surf.Pavement));
      b.paint(0xd8cfbc);
      for (let i = -2; i <= 2; i++) {
        const x = (i / 2) * h * 0.66;
        b.box(x - 0.3, f0 * fh, h, x + 0.3, f1 * fh + 0.8, h + 0.7, { nz: null, bottom: null });
        b.box(x - 0.3, f0 * fh, -h - 0.7, x + 0.3, f1 * fh + 0.8, -h, { pz: null, bottom: null });
        b.box(h, f0 * fh, x - 0.3, h + 0.7, f1 * fh + 0.8, x + 0.3, { nx: null, bottom: null });
        b.box(-h - 0.7, f0 * fh, x - 0.3, -h, f1 * fh + 0.8, x + 0.3, { px: null, bottom: null });
      }
      parapet(b, -h, -h, h, h, f1 * fh, 1.2, 0.3, 0xd8cfbc);
      litRing(b, -h - 0.02, -h - 0.02, h + 0.02, h + 0.02, f1 * fh - 0.5, 0.4, 0xffd89a);
    }
    const top = 46 * fh;
    b.paint(0xd8cfbc).box(-4, top, -4, 4, top + 5, 4, { bottom: null, top: null });
    b.paint(0xffd89a, Surf.Emissive).pyramid(0, 0, 8, 8, top + 5, 7);
    spire(b, 0, 0, top + 12, 16, 0.4);
  } else {
    // sail tower: D-shaped plan, blue glass with white fins, sloped crown
    const fl = 40, top = fl * fh;
    const pts: [number, number][] = [[-11, -8], [11, -8]];
    for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI; pts.push([Math.cos(a) * 11, -8 + 0.001 + Math.sin(a) * 18]); }
    const plan = pts.slice(1);
    b.paint(0x2a3440, Surf.GlassCurtain, 6, fh).extrude(plan, py, top - py, { top: false });
    // sloped crown: top rises from front (low) to back (high)
    const yTop = (z: number) => top + 4 + (10 - z) * 0.6;
    b.paint(0x2a3440, Surf.GlassCurtain, 5, fh);
    for (let i = 0; i < plan.length; i++) {
      const [ax, az] = plan[i], [bx, bz] = plan[(i + 1) % plan.length];
      const e1x = bx - ax, e1z = bz - az;
      const out = (ax * e1z - az * e1x) < 0;
      const q: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]] = [[ax, top, az], [bx, top, bz], [bx, yTop(bz), bz], [ax, yTop(az), az]];
      if (out) b.quad(q[0], q[1], q[2], q[3]); else b.quad(q[1], q[0], q[3], q[2]);
    }
    b.paint(0xdfe3e6);
    for (let i = 1; i < plan.length - 1; i++) b.tri([plan[0][0], yTop(plan[0][1]), plan[0][1]], [plan[i + 1][0], yTop(plan[i + 1][1]), plan[i + 1][1]], [plan[i][0], yTop(plan[i][1]), plan[i][1]]);
    // three white fins across the sloped crown
    b.paint(0xf4f4f0);
    for (const x of [-5, 0, 5]) { const zf = -8 + Math.sqrt(Math.max(0, 121 - x * x)) * (18 / 11) - 0.3; b.beam([x, yTop(zf) + 0.05, zf], [x, yTop(-7.8) + 0.05, -7.8], 0.45); }
    b.paint(0xfff0cc, Surf.Emissive);
    for (let i = 0; i < plan.length; i++) {
      const [ax, az] = plan[i], [bx, bz] = plan[(i + 1) % plan.length];
      b.beam([ax, yTop(az) + 0.05, az], [bx, yTop(bz) + 0.05, bz], 0.35);
    }
    b.paint(0xf4f4f0);
    for (let k = 1; k < 8; k++) { const a = (k / 8) * Math.PI, x = Math.cos(a) * 11.4, z = -8 + Math.sin(a) * 18.4; b.box(x - 0.25, py, z - 0.25, x + 0.25, yTop(z) + 0.5, z + 0.25, { bottom: null }); }
    for (let f = 6; f < fl; f += 6) ringBalc(b, -11, -8.6, 11, -8, f * fh, 0.0, 0xf4f4f0, null);
  }
  streetTrees(b, rng, 24, 21.5);
  for (const x of [-12, 12]) planter(b, x, 21, 3.0, 1.2, 0.1, 0x8f8a80, 0x4f7a34, x);
}

// ---------------------------------------------------------------------------------------------- SUPERTALL (R$$$) 4x4
function supertall(b: ModelBuilder, v: number, rng: RNG): void {
  plaza(b, rng, 32, 32, 0xd6d0c4);
  const fh = 3.5;
  // plaza: amenity / retail wings on both sides, drop-off loop with cars, lawn quadrants
  const wingC = [0xcfcac0, 0xd8d4ca, 0xcfc6b2][v], wingF = v === 1 ? 3 : 2;
  for (const sx of [-1, 1]) {
    const xa = sx < 0 ? -31 : 22, xb = sx < 0 ? -22 : 31, wh = wingF * fh;
    b.paint(wingC, Surf.Stone).box(xa, 0, -28, xb, wh, 12, { top: P(0x8a867e, Surf.RoofFlat) });
    b.paint(wingC).box(xa - 0.3, wh, -28.3, xb + 0.3, wh + 0.5, 12.3, { bottom: null, top: P(0x8a867e, Surf.RoofFlat) });
    b.paint(0x2a3440, Surf.GlassPlain, 2);
    inFace(b, sx < 0 ? 'px' : 'nx', sx < 0 ? xb : xa, () => fq(b, U(sx < 0 ? 'px' : 'nx', sx < 0 ? 10.5 : -26.5), 0.3, U(sx < 0 ? 'px' : 'nx', sx < 0 ? -26.5 : 10.5), wh - 0.8, 0.04));
    inFace(b, 'pz', 12, () => fq(b, xa + 0.8, 0.3, xb - 0.8, wh - 0.8, 0.04));
    b.paint(0xe8e6e0).box(xa, 3.4, 12, xb, 3.6, 14.2, { nz: null, bottom: { color: 0xd8d4cc } });
    lawnSlab(b, sx < 0 ? -21 : 8, 14, sx < 0 ? -8 : 21, 30, 0x5e8d3c, 0.12);
    lawnSlab(b, sx < 0 ? -21 : 2, -31, sx < 0 ? -2 : 21, -22, 0x5e8d3c, 0.12);
  }
  // drop-off loop
  const loop: [number, number][] = [], inner: [number, number][] = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; loop.push([Math.cos(a) * 6.8, 24 + Math.sin(a) * 6.8]); inner.push([Math.cos(a) * 3.0, 24 + Math.sin(a) * 3.0]); }
  b.paint(0x55565a, Surf.Pavement); capPoly(b, loop, 0.12, true);
  b.paint(0x5e8d3c, Surf.Foliage); capPoly(b, inner, 0.14, true);
  b.paint(0xd6cfc0).cylinder(0, 24, 0.14, 0.6, 1.4, 1.4, 8, { top: false, smooth: false });
  b.paint(0x3f9fc8, Surf.Water).cylinder(0, 24, 0.7, 0.02, 1.3, 1.3, 8);
  paveSlab(b, -3.4, 30.5, 3.4, 32, 0x55565a, 0.12);
  const nCars = v === 1 ? 3 : 4;
  for (let i = 0; i < nCars; i++) { const a = Math.PI * (0.15 + i * 0.25); parkedCar(b, rng, Math.cos(a) * 4.9, 24 - Math.sin(a) * 4.9, a, undefined, 0.12); }
  lightPool(b, -8, 20.2, 8, 21.6, 0xd6d0c4, 0.105);
  for (const x of [-26, -9, 9, 26]) { b.paint(0x5a4432).box(x - 1, 0.1, 29.5, x + 1, 0.14, 31.5, { bottom: null }); tree(b, rng, x, 30.5, 1.0, 'round'); }
  const lawnTrees: [number, number][] = v === 1 ? [[-15, 19], [15, 19]] : [[-15, 19], [15, 19], [-12, -26], [12, -26]];
  for (const [x, z] of lawnTrees) tree(b, rng, x, z, 1.1, 'wide');
  if (v === 0) {
    // square dark-glass supertall with 3 setbacks, silver fins, lit crown, spire
    const tiers: [number, number, number][] = [[0, 30, 15], [30, 52, 12.5], [52, 70, 10]];
    b.paint(0xcfcac0, Surf.Stone).box(-19, 0, -19, 19, 3 * fh, 19, { top: P(0xa8a498, Surf.Pavement) });
    inFace(b, 'pz', 19, () => { b.paint(0x2a3440, Surf.GlassPlain); fq(b, -12, 0.2, 12, 9.5, 0.05); });
    for (const [f0, f1, h] of tiers) {
      glassBox(b, -h, -h, h, h, Math.max(3, f0) * fh, f1 * fh, 6, fh, P(0x8a867e, Surf.RoofFlat));
      b.paint(0xb8bcc2, Surf.Metal);
      for (let i = -3; i <= 3; i++) {
        const x = (i / 3) * (h - 0.4);
        b.box(x - 0.2, Math.max(3, f0) * fh, h, x + 0.2, f1 * fh, h + 0.5, { nz: null, bottom: null, top: null });
        b.box(h, Math.max(3, f0) * fh, x - 0.2, h + 0.5, f1 * fh, x + 0.2, { nx: null, bottom: null, top: null });
      }
      bandRing(b, -h, -h, h, h, f1 * fh - 0.6, 0.6, 0.35, 0xb8bcc2);
      litRing(b, -h - 0.36, -h - 0.36, h + 0.36, h + 0.36, f1 * fh - 0.9, 0.3, 0xcfe8ff);
    }
    const top = 70 * fh;
    b.paint(0x2a3440, Surf.GlassCurtain, 3, fh).box(-7, top, -7, 7, top + 8, 7, { top: null });
    b.paint(0xcfe8ff, Surf.Emissive).pyramid(0, 0, 14, 14, top + 8, 6);
    spire(b, 0, 0, top + 14, 36, 0.8, 0xd8dce0);
  } else if (v === 1) {
    // stepped 12-sided cylinder tiers, sky-blue glass, balcony rings every 3 floors, lantern crown
    const tiers: [number, number, number][] = [[3, 32, 15], [32, 56, 12.5], [56, 72, 9.5]];
    b.paint(0xd8d4ca).extrude(prismPts(0, 0, 20, 12, Math.PI / 12), 0, 3 * fh, { topPaint: P(0xa8a498, Surf.Pavement) });
    inFace(b, 'pz', 19.3, () => { b.paint(0x2a3440, Surf.GlassPlain); fq(b, -6, 0.2, 6, 9.0, 0.3); });
    for (const [f0, f1, r] of tiers) {
      const pts = prismPts(0, 0, r, 12, Math.PI / 12);
      b.paint(0x2a3440, Surf.GlassCurtain, 6, fh).extrude(pts, f0 * fh, (f1 - f0) * fh, { topPaint: P(0x8a867e, Surf.RoofFlat) });
      for (let f = f0 + 5; f < f1 - 1; f += 5) polyBalc(b, pts, f * fh, 0.9, 0xf4f4f0, null);
      b.paint(0xcfe8ff, Surf.Emissive).extrude(prismPts(0, 0, r + 0.05, 12, Math.PI / 12), f1 * fh - 0.8, 0.4, { top: false });
    }
    const top = 72 * fh;
    b.paint(0xf4f4f0);
    const cr = prismPts(0, 0, 9.5, 12, Math.PI / 12);
    cr.forEach(([x, z], i) => { if (i % 2 === 0) b.box(x - 0.3, top, z - 0.3, x + 0.3, top + 12, z + 0.3, { bottom: null }); });
    b.paint(0xfff0cc, Surf.Emissive).extrude(prismPts(0, 0, 6.5, 12, Math.PI / 12), top, 10, { top: true });
    b.paint(0xf4f4f0).cylinder(0, 0, top + 12, 1.0, 9.8, 7.0, 12, { top: true });
    spire(b, 0, 0, top + 13, 24, 0.7);
  } else {
    // slender chamfered bronze tower with stone frame, sky gardens and a sculpted open crown
    const fl = 68, top = fl * fh;
    const pts: [number, number][] = [[-13, -8], [-8, -13], [8, -13], [13, -8], [13, 8], [8, 13], [-8, 13], [-13, 8]];
    b.paint(0xcfc6b2, Surf.Stone).box(-20, 0, -20, 20, 3 * fh, 20, { top: P(0x8f8a80, Surf.Pavement) });
    inFace(b, 'pz', 20, () => { b.paint(0x2a3440, Surf.GlassPlain); fq(b, -10, 0.2, 10, 9.5, 0.05); });
    const gardens = [22, 45];
    let f0 = 3;
    for (const g of [...gardens, fl]) {
      b.paint(0x2a3440, Surf.GlassCurtain, 2, fh).extrude(pts, f0 * fh, (g - f0) * fh, { top: false });
      if (g !== fl) {
        const inset = pts.map(([x, z]) => [x * 0.78, z * 0.78] as [number, number]);
        b.paint(0x3a3c40).extrude(inset, g * fh, 2 * fh, { top: false });
        polyBalc(b, pts, g * fh + 0.2, 0.0, 0xcfc6b2, GLASS_RAIL);
        for (const [x, z] of [[-9, 0], [9, 0], [0, 9], [0, -9], [-6, 6], [6, -6]] as [number, number][]) b.paint(0x4f7a34, Surf.Foliage).blob(x, g * fh + 1.3, z, 1.3, 1.1, 1.3, 0, 0.2, x - z + g);
      }
      f0 = g + 2;
    }
    // stone corner piers full height
    b.paint(0xcfc6b2);
    for (const [x, z] of [[-10.5, -10.5], [10.5, -10.5], [10.5, 10.5], [-10.5, 10.5]] as [number, number][]) b.box(x - 1.0, 3 * fh, z - 1.0, x + 1.0, top + 16, z + 1.0, { bottom: null });
    // open crown: tapered frame
    for (const [x, z] of [[-10.5, -10.5], [10.5, -10.5], [10.5, 10.5], [-10.5, 10.5]] as [number, number][]) b.beam([x, top + 16, z], [x * 0.25, top + 34, z * 0.25], 0.9);
    b.paint(0xffd89a, Surf.Emissive).box(-3.5, top, -3.5, 3.5, top + 14, 3.5, { bottom: null });
    litRing(b, -13.02, -13.02, 13.02, 13.02, top - 0.5, 0.4, 0xffd89a);
    spire(b, 0, 0, top + 34, 18, 0.6);
  }
}

export const highModels = {
  res_projects: (b: ModelBuilder, v: number, rng: RNG) => { setLot(16, 16, 60); projects(b, v, rng); },
  res_highrise_slab: (b: ModelBuilder, v: number, rng: RNG) => { setLot(24, 16, 70); highriseSlab(b, v, rng); },
  res_tower: (b: ModelBuilder, v: number, rng: RNG) => { setLot(16, 16, 110); tower(b, v, rng); },
  res_twin_towers: (b: ModelBuilder, v: number, rng: RNG) => { setLot(24, 24, 120); twinTowers(b, v, rng); },
  res_luxury_tower: (b: ModelBuilder, v: number, rng: RNG) => { setLot(24, 24, 200); luxuryTower(b, v, rng); },
  res_supertall: (b: ModelBuilder, v: number, rng: RNG) => { setLot(32, 32, 300); supertall(b, v, rng); },
};
