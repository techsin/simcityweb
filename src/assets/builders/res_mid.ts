/**
 * Residential medium density: walk-up, tenement, rowhouses, apartment, condo, courtyard block.
 * (owned by the residential asset agent)
 *
 * WallWindows columns are anchored to the model origin: wall edges are placed on multiples of the pattern's
 * column width (COLW) so windows never get cut at corners; storeys are multiples of the floor height from y=0.
 */
import type { ModelBuilder, ColorLike, Paint } from '../ModelBuilder';
import type { RNG } from '../../core/rng';
import { Surf } from '../../core/types';
import { rooftopWaterTank, acUnit } from '../kit';
import {
  P, inFace, U, fq, win, wins, door, steps, roofGable, roofHip, roofMansard, chimney, lawnSlab, paveSlab, bush,
  bushRow, flowerBed, tree, lowWall, hedgeBox, trashCans, parkedCar, laundry, planter, parapet, flatRoof, setLot, band,
  fireEscape, bay, capPoly, spread, bandRing, parking, lounger, ironRail, stoopRails, lightPool, pickPal, mixHex, type WinStyle, type Face,
} from './res_util';

// ---------------------------------------------------------------------------------------------- local helpers
const ROOF = 0x6c6962;
const TAR = 0x4e4b47;

/** WallWindows box (no bottom). top = roof paint or null. */
export function ww(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, color: ColorLike, pattern: number, floor: number, top: Paint | null = P(ROOF, Surf.RoofFlat), faces: { pz?: Paint | null; nz?: Paint | null; px?: Paint | null; nx?: Paint | null } = {}): void {
  b.paint(color, Surf.WallWindows, pattern, floor).box(x0, y0, z0, x1, y1, z1, { top, ...faces });
}

/** Window air-conditioner box sticking out of a facade. */
function acWin(b: ModelBuilder, f: Face, plane: number, a: number, y: number): void {
  inFace(b, f, plane, () => b.paint(0xc8c8c2, Surf.Metal).box(U(f, a) - 0.35, y, 0, U(f, a) + 0.35, y + 0.45, 0.45, { nz: null }));
}

/** Rooftop bulkhead (stair / elevator hut). */
function bulkhead(b: ModelBuilder, x: number, z: number, w: number, d: number, y: number, h: number, color: ColorLike = 0x9a968e): void {
  b.paint(color).box(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, { bottom: null, top: P(0x5e5b55, Surf.RoofFlat) });
}

/** Bracketed cornice: projecting band + fascia + row of brackets on the front face. */
function cornice(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, color: ColorLike, front: Face[] = ['pz'], brackets = true, out = 0.55, roof: ColorLike | null = TAR): void {
  bandRing(b, x0, z0, x1, z1, y, 0.35, out, color, roof);
  band(b, x0, z0, x1, z1, y - 0.45, 0.45, out * 0.35, color, false);
  if (!brackets) return;
  b.paint(color);
  for (const f of front) {
    const plane = f === 'pz' ? z1 : f === 'nz' ? z0 : f === 'px' ? x1 : x0;
    const a0 = f === 'pz' || f === 'nz' ? x0 : z0, a1 = f === 'pz' || f === 'nz' ? x1 : z1;
    const n = Math.max(2, Math.round((a1 - a0) / 1.6));
    inFace(b, f, plane, () => {
      for (let i = 0; i <= n; i++) {
        const u = U(f, a0 + ((a1 - a0) * i) / n);
        b.box(u - 0.1, y - 0.7, 0, u + 0.1, y, out * 0.9, { nz: null, bottom: null, top: null });
      }
    });
  }
}

/** Window-sill courses: thin projecting bands at sill level of each floor f in [f0, f1). */
function sills(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, f0: number, f1: number, fh: number, frac: number, color: ColorLike, top = true): void {
  for (let f = f0; f < f1; f++) band(b, x0, z0, x1, z1, f * fh + frac * fh - 0.13, 0.13, 0.07, color, top);
}

/** Sidewalk-ish paved front strip. */
function frontPave(b: ModelBuilder, x0: number, x1: number, z0: number, z1: number, color: ColorLike = 0xc3beb3): void {
  paveSlab(b, x0, z0, x1, z1, color, 0.1);
}

/** Street tree in a small pit on a paved strip. */
function streetTree(b: ModelBuilder, rng: RNG, x: number, z: number, s = 1): void {
  b.paint(0x5a4432).box(x - 0.8, 0.1, z - 0.8, x + 0.8, 0.13, z + 0.8, { bottom: null });
  tree(b, rng, x, z, s, 'round');
}

/** See-through iron area railing (posts every 1.2 m + top rail). */
function railing(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, h = 1.0, color: ColorLike = 0x2a2c2e): void {
  ironRail(b, ax, az, bx, bz, h, color, 1.2);
}

// ---------------------------------------------------------------------------------------------- WALK-UP (R$) 1x1
function walkup(b: ModelBuilder, v: number, rng: RNG): void {
  const C = 2.2; // pattern 1 column width
  const x0 = -3 * C, x1 = 3 * C, z0 = -3 * C, z1 = 2 * C; // 13.2 x 11
  const fh = 3.2;
  frontPave(b, -8, 8, z1, 8);
  paveSlab(b, -8, -8, 8, z0, 0x9a948a, 0.08);
  const floors = [4, 3, 4, 3, 3, 4][v];
  const top = floors * fh;
  const brick = [0x8e4636, 0x9a6a4a, 0xc4a472, 0x8f9294, 0xb3aa98, 0x6e3a2e][v];
  const trimC = [0xd8d0c0, 0xe0d6c4, 0xefe8da, 0xe8e6e0, 0xefe9dc, 0xcfc6b4][v];
  const base = [P(0x8a8378, Surf.Stone), P(0x9a8a78, Surf.Stone), P(0xc4a472, Surf.Brick), P(0x7a7d80, Surf.Stone), P(0xa39a88, Surf.Stone), P(0x6e3a2e, Surf.Brick)][v];
  const sideBlank = v === 1 || v === 5;
  // ground floor base
  b.paint(base).box(x0, 0, z0, x1, fh, z1, { top: null });
  const upperSide = sideBlank ? P(brick, Surf.Brick) : P(brick, Surf.WallWindows, 1, fh);
  const notch = v === 5;
  if (notch) {
    // L-plan with an air-shaft notch on the right side
    const blank = P(brick, Surf.Brick);
    ww(b, x0, 0, x1, z1, fh, top, brick, 1, fh, P(ROOF, Surf.RoofFlat), { px: blank });
    ww(b, x0, z0, x1, -C, fh, top, brick, 1, fh, P(ROOF, Surf.RoofFlat), { px: blank });
    ww(b, x0, -C, C, 0, fh, top, brick, 1, fh, P(ROOF, Surf.RoofFlat), { pz: null, nz: null, nx: blank });
  } else {
    ww(b, x0, z0, x1, z1, fh, top, brick, 1, fh, P(ROOF, Surf.RoofFlat), { px: upperSide, nx: upperSide });
  }
  if (sideBlank && v === 1) {
    // faded painted advert on the blank side wall
    inFace(b, 'nx', x0, () => {
      const a = U('nx', -4.2), c = U('nx', 1.8);
      b.paint(0xd9cfb0); fq(b, a, 4.6, c, 8.6, 0.03);
      b.paint(0x9a4a3a); fq(b, a + 0.35, 7.0, c - 0.35, 8.1, 0.04);
      b.paint(0x3a5a7a); fq(b, a + 0.35, 5.1, c - 0.35, 5.9, 0.04);
      b.paint(0x9a4a3a); fq(b, a + 0.9, 6.2, c - 0.9, 6.7, 0.04);
    });
  }
  // ground floor openings: door + stoop at center, windows at pattern columns
  const ws: WinStyle = { frame: trimC, mull: 2, sill: trimC, head: trimC };
  inFace(b, 'pz', z1, () => {
    door(b, 0, 0.9, 1.2, 2.2, [0x3a2a22, 0x2f4a37, 0x6b2a26, 0x2a2a2a, 0x3a2a22, 0x2c3b57][v], { transom: true, frame: trimC, lamp: true });
    for (const x of [-5.5, -3.3, 3.3, 5.5]) win(b, x, 1.0, 0.9, 1.6, ws);
    steps(b, 0, 1.9, 3, 0.3, 0.3, 0xa29c90, 0, Surf.Stone);
  });
  inFace(b, 'pz', z1, () => stoopRails(b, 0, 1.9, 3, 0.3, 0.3, 0x2a2c2e));
  lightPool(b, -1.25, z1 + 0.9, 1.25, z1 + 3.4, 0xc3beb3, 0.105);
  if (!sideBlank) {
    wins(b, 'px', x1, [-5.5, -3.3, -1.1, 1.1, 3.3], 1.0, 0.9, 1.6, { frame: trimC, sill: trimC });
    wins(b, 'nx', x0, [-5.5, -3.3, -1.1, 1.1, 3.3], 1.0, 0.9, 1.6, { frame: trimC, sill: trimC });
  }
  wins(b, 'nz', z0, [-5.5, -1.1, 3.3], 1.0, 0.9, 1.6, { frame: trimC });
  // string course over the base + sill courses on the upper floors
  band(b, x0, z0, x1, z1, fh - 0.15, 0.3, 0.12, trimC, false);
  if (v !== 2 && v !== 4 && v !== 5) sills(b, x0, z0, x1, z1, 1, floors, fh, 0.22, trimC);
  else {
    // side-wall sill courses only (front has bays / blank party walls)
    b.paint(trimC);
    for (let f = 1; f < floors; f++) {
      const y = f * fh + 0.22 * fh - 0.13;
      if (v !== 5) b.box(x1, y, z0, x1 + 0.07, y + 0.13, z1, { nx: null, bottom: null });
      b.box(x0 - 0.07, y, z0, x0, y + 0.13, z1, { px: null, bottom: null });
    }
  }
  // cornice / parapet variants
  if (v === 0 || v === 5) {
    cornice(b, x0, z0, x1, z1, top, 0x3a3530, ['pz']);
    parapet(b, x0, z0, x1, z1, top + 0.35, 0.6, 0.25, brick, 0x6a645c);
  } else if (v === 1) {
    parapet(b, x0, z0, x1, z1, top, 1.1, 0.3, brick, 0xd8ccb8);
    b.paint(brick).box(-2.2, top + 1.1, z1 - 0.3, 2.2, top + 1.9, z1, { bottom: null });
    b.paint(0xd8ccb8).box(-2.3, top + 1.9, z1 - 0.35, 2.3, top + 2.05, z1 + 0.05, { bottom: null });
    band(b, x0, z1 - 0.3, x1, z1, top - 0.5, 0.35, 0.12, 0xd8ccb8, false);
  } else if (v === 2) {
    cornice(b, x0, z0, x1, z1, top, 0xe8e0cc, ['pz'], true, 0.45);
    parapet(b, x0, z0, x1, z1, top + 0.35, 0.5, 0.25, brick);
    // two 3-storey angled bays
    for (const x of [-3.3, 3.3]) inFace(b, 'pz', z1, () => bay(b, x, fh, top - 0.2, 3.0, 0.9, P(brick), { winY: [fh + 0.7, 2 * fh + 0.7, 3 * fh + 0.7], winH: 1.7, frame: trimC }));
  } else if (v === 3) {
    band(b, x0, z0, x1, z1, top, 0.3, 0.3, 0xe8e6e0);
    roofMansard(b, 0, (z0 + z1) / 2, x1 - x0, z1 - z0, top + 0.3, 3.0, 1.1, P(0x464c55, Surf.RoofTiles), P(ROOF, Surf.RoofFlat), 0.25);
    for (const x of [-4.4, 0, 4.4]) {
      const zf = z1 - 0.5;
      b.paint(0xe8e6e0).box(x - 0.8, top + 0.6, zf - 1.5, x + 0.8, top + 2.6, zf, { nz: null, bottom: null, top: P(0x464c55) });
      inFace(b, 'pz', zf, () => win(b, x, top + 0.9, 0.8, 1.4, { frame: 0xe8e6e0, mull: 2 }));
    }
  } else {
    // v4 greystone: stone front, brick sides, full-height angled bay on the left, cornice
    cornice(b, x0, z0, x1, z1, top, 0xb8b0a0, ['pz'], false, 0.45);
    parapet(b, x0, z0, x1, z1, top + 0.35, 0.5, 0.25, 0xb3aa98);
    inFace(b, 'pz', z1, () => bay(b, -3.3, fh, top - 0.2, 3.4, 1.0, P(0xb3aa98, Surf.Stone), { winY: [fh + 0.7, 2 * fh + 0.7], winH: 1.7, frame: 0xefe9dc }));
  }
  // fire escapes
  const ys = Array.from({ length: floors - 1 }, (_, i) => (i + 1) * fh);
  if (v === 0 || v === 3) inFace(b, 'pz', z1, () => fireEscape(b, 3.3, ys, 4.0));
  if (v === 1) inFace(b, 'px', x1, () => fireEscape(b, U('px', -1.1), ys, 4.0));
  if (v === 5) inFace(b, 'pz', z1, () => { fireEscape(b, -4.4, ys, 3.6); fireEscape(b, 4.4, ys, 3.6); });
  if (v === 2 || v === 4) inFace(b, 'nz', z0, () => fireEscape(b, U('nz', 0), ys, 4.0));
  // AC units poking out of windows
  const acs: [Face, number, number][] = [['pz', -5.5, fh * 2 + 0.7], ['pz', 1.1, fh + 0.7], ['pz', -1.1, fh * 3 + 0.7], ['px', -3.3, fh * 2 + 0.7]];
  for (let i = 0; i < acs.length; i++) {
    const [f, a, y] = acs[(i + v) % acs.length];
    if (y > top - 1 || (f === 'px' && sideBlank)) continue;
    if (v === 2 && Math.abs(Math.abs(a) - 3.3) < 1.6) continue;
    acWin(b, f, f === 'pz' ? z1 : x1, a, y);
  }
  // rooftop
  const ry = v === 3 ? top + 3.3 : top;
  if (v === 3) { acUnit(b, 1.5, ry, -3, 0.8); }
  else {
    if (v !== 1) rooftopWaterTank(b, v === 5 ? -3.5 : 3.0, top, -3.5, 0.9);
    bulkhead(b, -3.0, -1.5, 2.6, 3.0, top, 2.6, brick);
    acUnit(b, 3.5, top, 1.5, 0.9);
    if (v === 1 || v === 4) acUnit(b, 1.0, top, -4.5, 1.0);
    if (v === 5) laundry(b, rng, [0.5, top + 1.7, 3.2], [5.5, top + 1.7, -1.5], 4);
  }
  // street dressing
  trashCans(b, 4.4, z1 + 1.0, 2, 0x3a3d40);
  if (v % 2 === 0) streetTree(b, rng, -5.5, 6.4, 0.85);
  else bush(b, -5.0, z1 + 1.2, 0.6, 0x3f6a2d, v);
}

// ---------------------------------------------------------------------------------------------- TENEMENT (R$) 2x2
function tenement(b: ModelBuilder, v: number, rng: RNG): void {
  const C = 2.2;
  paveSlab(b, -16, -16, 16, 16, 0x8e8a82, 0.07);
  frontPave(b, -16, 16, 13.2, 16);
  const fh = v === 1 ? 3.0 : 3.1;
  const trimC = 0xd8d0c0;
  if (v === 0) {
    // U plan open to the back courtyard, red brick, front fire escapes, laundry lines
    const brick = 0x8a4434, top = 5 * fh;
    b.paint(P(0x7a7066, Surf.Stone)).box(-6 * C, 0, C, 6 * C, fh, 6 * C, { top: null });
    ww(b, -6 * C, C, 6 * C, 6 * C, fh, top, brick, 1, fh);
    ww(b, -6 * C, -6 * C, -3 * C, C, 0, top, brick, 1, fh, P(ROOF, Surf.RoofFlat), { pz: null });
    ww(b, 3 * C, -6 * C, 6 * C, C, 0, top, brick, 1, fh, P(ROOF, Surf.RoofFlat), { pz: null });
    inFace(b, 'pz', 6 * C, () => {
      for (const x of [-5.5, 5.5]) { door(b, x, 0.6, 1.3, 2.3, 0x3a2a22, { transom: true, frame: trimC, lamp: true }); steps(b, x, 2.0, 2, 0.3, 0.3, 0xa29c90, 0, Surf.Stone); }
      for (const x of [-12.1, -9.9, -7.7, -3.3, -1.1, 1.1, 3.3, 7.7, 9.9, 12.1]) win(b, x, 0.9, 0.9, 1.6, { frame: trimC, sill: trimC });
      for (const x of [-8.8, 0, 8.8]) fireEscape(b, x, [fh, 2 * fh, 3 * fh, 4 * fh], 3.6);
    });
    band(b, -6 * C, C, 6 * C, 6 * C, fh - 0.15, 0.3, 0.1, trimC, false);
    sills(b, -6 * C, C, 6 * C, 6 * C, 1, 5, fh, 0.22, trimC);
    cornice(b, -6 * C, C, 6 * C, 6 * C, top, 0x3a3530, ['pz'], true, 0.5);
    parapet(b, -6 * C, -6 * C, 6 * C, 6 * C, top + 0.35, 0.5, 0.25, brick, 0x6a645c);
    // courtyard
    paveSlab(b, -3 * C, -6 * C, 3 * C, C, 0x7e7a72, 0.08);
    for (const z of [-11, -7, -3]) laundry(b, rng, [-3 * C, 8.5 + (z % 3), z], [3 * C, 8.5 + (z % 3), z + 0.5], 5);
    tree(b, rng, 0, -9, 0.9, 'round');
    trashCans(b, -5.5, -1.0, 3, 0x3a3d40);
    for (const [x, z] of [[-9.9, 3], [9.9, -8]] as [number, number][]) rooftopWaterTank(b, x, top, z, 1.0);
    bulkhead(b, 0, 8.0, 3.0, 3.0, top, 2.6, brick);
    acUnit(b, -4, top, 9.5); acUnit(b, 5, top, 5.0); acUnit(b, -11, top, -8);
    for (const [a, y] of [[-12.1, 2 * fh + 0.7], [3.3, 3 * fh + 0.7], [-3.3, fh + 0.7]] as [number, number][]) acWin(b, 'pz', 6 * C, a, y);
    for (const x of [-12, 12]) streetTree(b, rng, x, 14.6, 0.85);
  } else if (v === 1) {
    // O plan (closed light well), grey stucco, 6 storeys, rooftop sheds
    const st = 0xb8aa8e, top = 6 * fh, R = 6 * C, r = 2 * C;
    b.paint(P(0x9a968e, Surf.Stone)).box(-R - 0.1, 0, -R - 0.1, R + 0.1, fh, R + 0.1, { top: { color: 0x8a867e } });
    ww(b, -R, r, R, R, fh, top, st, 1, fh);
    ww(b, -R, -R, R, -r, fh, top, st, 1, fh);
    ww(b, -R, -r, -r, r, fh, top, st, 1, fh, P(ROOF, Surf.RoofFlat), { pz: null, nz: null });
    ww(b, r, -r, R, r, fh, top, st, 1, fh, P(ROOF, Surf.RoofFlat), { pz: null, nz: null });
    // light well floor
    paveSlab(b, -r, -r, r, r, 0x77736a, 0.15);
    laundry(b, rng, [-r, 10, -1], [r, 10, 1], 4);
    laundry(b, rng, [-r, 13, 2], [r, 13, 1], 4);
    inFace(b, 'pz', R + 0.1, () => {
      door(b, 0, 0.9, 2.0, 2.3, 0x4a3a2e, { transom: true, frame: 0xe0dcd2, lamp: true });
      for (const x of [-12.1, -9.9, -7.7, -5.5, -3.3, 3.3, 5.5, 7.7, 9.9, 12.1]) win(b, x, 0.9, 0.9, 1.5, { frame: 0xe0dcd2, sill: 0xe0dcd2 });
      steps(b, 0, 2.6, 3, 0.3, 0.32, 0x8a867e, 0, Surf.Stone);
      stoopRails(b, 0, 2.6, 3, 0.3, 0.32, 0x2a2c2e);
    });
    lightPool(b, -1.25, R + 1.06, 1.25, R + 3.56, 0xc3beb3, 0.105);
    wins(b, 'px', R + 0.1, spread(-R, R, 12), 0.9, 0.9, 1.5, { frame: 0xe0dcd2 });
    sills(b, -R, -R, R, R, 1, 6, fh, 0.22, 0xe0d8c6, false);
    cornice(b, -R, -R, R, R, top, 0xd8d0bf, ['pz', 'px'], true, 0.5, null);
    b.paint(TAR, Surf.RoofFlat);
    for (const [a0, c0, a1, c1] of [[-R, r, R, R], [-R, -R, R, -r], [-R, -r, -r, r], [r, -r, R, r]]) b.quad([a0, top + 0.35, c1], [a1, top + 0.35, c1], [a1, top + 0.35, c0], [a0, top + 0.35, c0]);
    for (const [x, z, w, d] of [[-9, 9, 3, 2.5], [8, -9, 3.5, 3], [9, 8, 2.4, 2.4]] as [number, number, number, number][]) bulkhead(b, x, z, w, d, top + 0.35, 2.4, 0x8c887e);
    rooftopWaterTank(b, -9, top + 0.35, -9, 1.0);
    for (const [x, z] of [[-4, 10.5], [4, -10.5], [-10.5, -2]] as [number, number][]) acUnit(b, x, top + 0.35, z);
    inFace(b, 'nx', -R, () => fireEscape(b, 0, [fh, 2 * fh, 3 * fh, 4 * fh, 5 * fh], 3.6));
    for (const [a, y] of [[-9.9, 2 * fh + 0.6], [5.5, 4 * fh + 0.6], [-1.1, 3 * fh + 0.6], [9.9, fh + 0.6]] as [number, number][]) acWin(b, 'pz', R, a, y);
    for (const x of [-10, 10]) streetTree(b, rng, x, 14.6, 0.85);
  } else if (v === 2) {
    // H / front-court plan, yellow brick, entrance court with garden
    const brick = 0xc6a468, top = 5 * fh;
    ww(b, -6 * C, -1 * C, -2 * C, 6 * C, 0, top, brick, 1, fh);
    ww(b, 2 * C, -1 * C, 6 * C, 6 * C, 0, top, brick, 1, fh);
    ww(b, -6 * C, -6 * C, 6 * C, -1 * C, 0, top, brick, 1, fh);
    paveSlab(b, -2 * C, -1 * C, 2 * C, 6 * C, 0xb8b2a6, 0.1);
    lawnSlab(b, -3.2, 2.0, 3.2, 10.5, 0x5e8a3c, 0.12);
    tree(b, rng, -2.0, 7.0, 0.8, 'round'); tree(b, rng, 2.0, 4.5, 0.8, 'round');
    ironRail(b, -2 * C, 13.05, -1.2, 13.05, 1.1);
    ironRail(b, 1.2, 13.05, 2 * C, 13.05, 1.1);
    inFace(b, 'pz', -1 * C, () => { door(b, 0, 0.1, 1.8, 2.5, 0x2f4a37, { transom: true, frame: trimC, lamp: true }); b.paint(0x2f4a37).box(-1.6, 2.9, 0, 1.6, 3.05, 1.2, { nz: null }); });
    for (const x of [-4 * C, 4 * C]) { cornice(b, x - 2 * C, -1 * C, x + 2 * C, 6 * C, top, 0xe6dcc6, ['pz'], true, 0.45); sills(b, x - 2 * C, -1 * C, x + 2 * C, 6 * C, 1, 5, fh, 0.22, 0xe6dcc6); }
    bandRing(b, -6 * C, -6 * C, 6 * C, -1 * C, top, 0.35, 0.3, 0xe6dcc6, ROOF);
    inFace(b, 'px', -2 * C, () => fireEscape(b, U('px', 4 * C), [fh, 2 * fh, 3 * fh, 4 * fh], 3.4));
    inFace(b, 'nx', 2 * C, () => fireEscape(b, U('nx', 4 * C), [fh, 2 * fh, 3 * fh, 4 * fh], 3.4));
    rooftopWaterTank(b, -9, top + 0.35, 6, 1.0);
    rooftopWaterTank(b, 8, top + 0.35, -9, 1.0);
    bulkhead(b, 0, -8, 3.4, 3.0, top + 0.35, 2.6, brick);
    acUnit(b, 9, top + 0.35, 8); acUnit(b, -9, top + 0.35, -10); acUnit(b, 4, top + 0.35, -11);
    for (const [a, y] of [[-12.1, 2 * fh + 0.7], [7.7, 3 * fh + 0.7], [11.0, fh + 0.7]] as [number, number][]) acWin(b, 'pz', 6 * C, a, y);
    laundry(b, rng, [-2 * C, 11, 10], [2 * C, 11, 9], 4);
    trashCans(b, -12, 14.3, 3, 0x3a3d40);
  } else {
    // two side-by-side dumbbell tenements with an air shaft, different heights & colors
    const specs: [number, number, number, number][] = [[-6 * C, -C / 2, 0x7a4a36, 5], [C / 2, 6 * C, 0x7f8a7a, 6]];
    for (const [xa, xb, col, n] of specs) {
      const top = n * fh, xm = (xa + xb) / 2;
      const xa2 = Math.round(xa / C) * C, xb2 = Math.round(xb / C) * C;
      ww(b, xa2, 1 * C, xb2, 6 * C, 0, top, col, 1, fh);
      ww(b, xa2, -6 * C, xb2, -2 * C, 0, top, col, 1, fh);
      ww(b, xa2 + C, -2 * C, xb2 - C, 1 * C, 0, top, col, 1, fh, P(ROOF, Surf.RoofFlat), { pz: null, nz: null });
      cornice(b, xa2, 1 * C, xb2, 6 * C, top, n === 5 ? 0x3a3530 : 0xd8d4c8, ['pz'], true, 0.5);
      bandRing(b, xa2, -6 * C, xb2, -2 * C, top, 0.35, 0.25, n === 5 ? 0x3a3530 : 0xd8d4c8, ROOF);
      inFace(b, 'pz', 6 * C, () => {
        door(b, xm, 0.6, 1.3, 2.3, 0x3a2a22, { transom: true, frame: trimC, lamp: true });
        steps(b, xm, 2.0, 2, 0.3, 0.3, 0xa29c90, 0, Surf.Stone);
        stoopRails(b, xm, 2.0, 2, 0.3, 0.3, 0x2a2c2e);
        fireEscape(b, xm + (n === 5 ? -3.3 : 3.3), Array.from({ length: n - 1 }, (_, i) => (i + 1) * fh), 3.4);
      });
      rooftopWaterTank(b, xm + 2, top + 0.35, -9, 1.0);
      bulkhead(b, xm - 2, 7.0, 2.8, 2.8, top + 0.35, 2.4, col);
      acUnit(b, xm, top + 0.35, 10.5);
      acWin(b, 'pz', 6 * C, xm - 1.1 - (n === 5 ? 0 : 2.2), 2 * fh + 0.7);
      acWin(b, 'pz', 6 * C, xm + 1.1, 3 * fh + 0.7);
    }
    laundry(b, rng, [-C / 2 - 0.1, 9, 4], [C / 2 + 0.1, 9.5, 4], 2);
    paveSlab(b, -16, -16, 16, -6 * C, 0x77736a, 0.1);
    trashCans(b, -1.0, 14.2, 3, 0x3a3d40);
    for (const x of [-11, 11]) streetTree(b, rng, x, 14.6, 0.85);
  }
}

// ---------------------------------------------------------------------------------------------- ROWHOUSES (R$$) 2x1
function rowhouses(b: ModelBuilder, v: number, rng: RNG): void {
  paveSlab(b, -16, -8, 16, 8, 0xc3beb3, 0.08);
  const z0 = -6.5, z1 = 3.5;
  if (v === 0) {
    // New York brownstones: high stoops, rusticated basement, tall parlor windows, bracketed cornices
    const stoneC = pickPal(rng, [0x6e4a3a, 0x7a5444, 0x5e4034, 0x6a5040, 0x80604a], 0.35);
    const stone = P(stoneC, Surf.Stone), trimC = 0x8a6a58;
    const doorsC = rng.shuffle([0x3a2418, 0x2a2a2a, 0x2f4a37, 0x5a2a22, 0x2c3b57]);
    for (let i = 0; i < 4; i++) {
      const xa = -14 + i * 7, xb = xa + 7, du = i % 2 === 0 ? xa + 1.6 : xb - 1.6;
      const side = { px: i === 3 ? undefined : null, nx: i === 0 ? undefined : null };
      b.paint(P(mixHex(stoneC, 0x000000, 0.15), Surf.Stone)).box(xa, 0, z0, xb, 1.8, z1, { top: null, ...side });
      b.paint(stone).box(xa, 1.8, z0, xb, 11.1, z1, { top: P(ROOF, Surf.RoofFlat), ...side });
      cornice(b, xa, z0, xb, z1, 11.1, i % 2 === 0 ? 0x2e2a28 : 0x4a3e36, ['pz'], true, 0.5);
      const ws: WinStyle = { frame: 0x3a2a22, mull: 1, sill: trimC, head: trimC };
      inFace(b, 'pz', z1, () => {
        door(b, du, 1.8, 1.2, 2.6, doorsC[i], { surf: Surf.Wood, transom: true, frame: trimC, lamp: true });
        const wx = i % 2 === 0 ? [xa + 3.9, xa + 5.7] : [xa + 1.3, xa + 3.1];
        for (const x of wx) win(b, x, 2.4, 1.0, 2.3, ws);
        for (const x of [xa + 1.4, xa + 3.5, xa + 5.6]) { win(b, x, 5.9, 0.95, 1.9, ws); win(b, x, 8.8, 0.95, 1.7, ws); }
        for (const x of wx) win(b, x, 0.3, 0.9, 1.0, { frame: 0x2a2a2a });
        steps(b, du, 1.7, 6, 0.3, 0.33, mixHex(stoneC, 0x000000, 0.05), 0, Surf.Stone);
        stoopRails(b, du, 1.8, 6, 0.3, 0.33, 0x1c1c1c);
      });
      lightPool(b, du - 1.25, z1 + 1.98, du + 1.25, 8.0, 0xc3beb3, 0.085);
      railing(b, xa + 0.2, 6.9, du - 1.0, 6.9, 1.0);
      railing(b, du + 1.0, 6.9, xb - 0.2, 6.9, 1.0);
      wins(b, 'nz', z0, [xa + 2, xa + 5], 2.4, 1.0, 2.0, { frame: 0x3a2a22 });
      wins(b, 'nz', z0, [xa + 2, xa + 5], 5.9, 1.0, 1.8, { frame: 0x3a2a22 });
      wins(b, 'nz', z0, [xa + 2, xa + 5], 8.8, 1.0, 1.6, { frame: 0x3a2a22 });
      chimney(b, xb - 0.5, -4, 0.8, 1.2, 11.0, 12.3, 0x6a4636);
    }
    for (const x of [-10.5, 3.5]) streetTree(b, rng, x, 7.2, 0.8);
  } else if (v === 1) {
    // London terrace: white stucco ground floor, stock brick above, porticos, black railings, mansard + dormers
    const stucco = P(0xefebe2), brick = P(pickPal(rng, [0xb89a6a, 0xa88a60, 0x9a6a4a, 0xc0a878], 0.4), Surf.Brick), iron = 0x1c1c1c;
    const doorsC = rng.shuffle([0x1c1c1c, 0x2c3b57, 0x7e2a26, 0x2f4a37, 0xa8823a, 0x55707e]);
    for (let i = 0; i < 4; i++) {
      const xa = -14 + i * 7, xb = xa + 7, du = i % 2 === 0 ? xa + 1.5 : xb - 1.5;
      const side = { px: i === 3 ? undefined : null, nx: i === 0 ? undefined : null };
      b.paint(stucco).box(xa, 0, z0, xb, 3.9, z1, { top: null, ...side });
      b.paint(brick).box(xa, 3.9, z0, xb, 9.6, z1, { top: null, ...side });
      band(b, xa, z1 - 0.2, xb, z1, 3.7, 0.3, 0.12, 0xf6f2e8, false);
      band(b, xa, z1 - 0.2, xb, z1, 9.3, 0.35, 0.3, 0xf6f2e8);
      roofMansard(b, (xa + xb) / 2, (z0 + z1) / 2, 7, z1 - z0, 9.65, 2.4, 1.0, P(0x4a5058, Surf.RoofTiles), P(ROOF, Surf.RoofFlat), 0.02);
      const wxs = i % 2 === 0 ? [xa + 3.6, xa + 5.6] : [xa + 1.4, xa + 3.4];
      inFace(b, 'pz', z1, () => {
        door(b, du, 0.6, 1.1, 2.4, doorsC[i], { transom: true, frame: 0xf6f2e8, lamp: true });
        for (const x of wxs) win(b, x, 0.9, 1.0, 2.2, { frame: 0xf6f2e8, mull: 2 });
        for (const x of [xa + 1.5, xa + 3.5, xa + 5.5]) { win(b, x, 4.6, 1.0, 2.1, { frame: 0xf6f2e8, mull: 2, sill: 0xf6f2e8 }); win(b, x, 7.4, 0.95, 1.5, { frame: 0xf6f2e8, mull: 2, sill: 0xf6f2e8 }); }
        steps(b, du, 1.8, 2, 0.3, 0.35, 0xe0dcd2);
      });
      // balcony railing on first floor
      b.paint(0xf6f2e8).box(xa + 0.3, 4.4, z1, xb - 0.3, 4.55, z1 + 0.5, { nz: null });
      ironRail(b, xa + 0.3, z1 + 0.48, xb - 0.3, z1 + 0.48, 0.85, iron, 1.2, 4.55);
      // portico
      b.paint(0xf6f2e8).box(du - 1.0, 3.0, z1, du + 1.0, 3.3, z1 + 1.4, { nz: null });
      for (const s of [-1, 1]) b.paint(0xf6f2e8).cylinder(du + s * 0.8, z1 + 1.2, 0.6, 2.4, 0.13, 0.12, 6, { top: false });
      const dx = (xa + xb) / 2;
      b.paint(0x4a5058).box(dx - 0.7, 10.6, z1 - 1.7, dx + 0.7, 11.8, z1 - 0.6, { bottom: null });
      inFace(b, 'pz', z1 - 0.6, () => win(b, dx, 10.7, 0.7, 0.9, { frame: 0xf6f2e8 }));
      railing(b, xa + 0.2, 7.0, du - 0.9, 7.0, 1.1, iron);
      railing(b, du + 0.9, 7.0, xb - 0.2, 7.0, 1.1, iron);
      lightPool(b, du - 0.9, z1 + 0.7, du + 0.9, z1 + 3.2, 0xc3beb3, 0.085);
      wins(b, 'nz', z0, [xa + 2, xa + 5], 1.0, 1.0, 2.0, { frame: 0xf6f2e8 });
      wins(b, 'nz', z0, [xa + 2, xa + 5], 4.6, 1.0, 1.9, { frame: 0xf6f2e8 });
      if (i > 0) chimney(b, xa, -1.5, 0.9, 2.0, 11.8, 12.6, 0xb89a6a);
    }
    for (const x of [-7, 7]) streetTree(b, rng, x, 7.2, 0.8);
  } else if (v === 2) {
    // Boston bow-fronts: red brick, rounded full-height bows, black shutters, flat roofs
    const brick = P(pickPal(rng, [0x8f4a38, 0x9a5a44, 0x7a4636, 0xa0604a], 0.4), Surf.Brick), trimC = 0xe8e2d4;
    const doorsC = rng.shuffle([0x1c1c1c, 0x2f4a37, 0x7e2a26, 0x2c3b57]);
    const W = 28 / 3;
    for (let i = 0; i < 3; i++) {
      const xa = -14 + i * W, xb = xa + W;
      const side = { px: i === 2 ? undefined : null, nx: i === 0 ? undefined : null };
      b.paint(P(0x8a8378, Surf.Stone)).box(xa, 0, z0, xb, 1.2, z1, { top: null, ...side });
      b.paint(brick).box(xa, 1.2, z0, xb, 10.4, z1, { top: P(ROOF, Surf.RoofFlat), ...side });
      const bx = xa + W * 0.62, br = 2.3;
      // bow: half-octagon prism from 1.2 to 10.4
      const pts: [number, number][] = [];
      for (let k = 0; k <= 4; k++) { const a = Math.PI - (k / 4) * Math.PI; pts.push([bx + Math.cos(a) * br, z1 + Math.sin(a) * br * 0.55]); }
      b.paint(brick);
      for (let k = 0; k < 4; k++) b.quad([pts[k][0], 1.2, pts[k][1]], [pts[k + 1][0], 1.2, pts[k + 1][1]], [pts[k + 1][0], 10.4, pts[k + 1][1]], [pts[k][0], 10.4, pts[k][1]]);
      b.paint(P(0x8a8378, Surf.Stone));
      for (let k = 0; k < 4; k++) b.quad([pts[k][0], 0, pts[k][1]], [pts[k + 1][0], 0, pts[k + 1][1]], [pts[k + 1][0], 1.2, pts[k + 1][1]], [pts[k][0], 1.2, pts[k][1]]);
      b.paint(ROOF, Surf.RoofFlat); capPoly(b, pts, 10.4);
      // windows on bow facets
      for (let k = 0; k < 4; k++) {
        const [ax, az] = pts[k], [cx2, cz2] = pts[k + 1];
        const mx = (ax + cx2) / 2, mz = (az + cz2) / 2, ang = Math.atan2(cx2 - ax, cz2 - az) - Math.PI / 2;
        b.push().translate(mx, 0, mz).rotateY(ang);
        for (const y of [1.9, 5.0, 8.0]) win(b, 0, y, 0.8, y < 2 ? 2.0 : 1.8, { frame: trimC, mull: 2 });
        b.pop();
      }
      bandRing(b, xa, z0, xb, z1, 10.4, 0.45, 0.35, trimC, TAR);
      parapet(b, xa, z0, xb, z1, 10.85, 0.5, 0.2, 0x8f4a38);
      const du = xa + 1.4;
      inFace(b, 'pz', z1, () => {
        door(b, du, 1.2, 1.1, 2.4, doorsC[i], { transom: true, frame: trimC, lamp: true });
        win(b, du, 5.0, 0.95, 1.8, { frame: trimC, mull: 2, shutter: 0x1c1c1c });
        win(b, du, 8.0, 0.95, 1.8, { frame: trimC, mull: 2, shutter: 0x1c1c1c });
        steps(b, du, 1.6, 4, 0.3, 0.3, 0x9a948a, 0, Surf.Stone);
        stoopRails(b, du, 1.7, 4, 0.3, 0.3, 0x1c1c1c);
      });
      lightPool(b, du - 1.25, z1 + 1.3, du + 1.25, z1 + 3.8, 0xc3beb3, 0.085);
      wins(b, 'nz', z0, [xa + 2.5, xb - 2.5], 1.9, 1.0, 1.9, { frame: trimC });
      wins(b, 'nz', z0, [xa + 2.5, xb - 2.5], 5.0, 1.0, 1.8, { frame: trimC });
      chimney(b, xb - 0.5, -3.5, 0.9, 1.4, 10.4, 12.2, 0x8f4a38);
      ironRail(b, bx - br, z1 + 1.4, bx + br, z1 + 1.4, 0.9, 0x2a2c2e);
    }
    wins(b, 'px', 14, [-4.5, -1.5], 5.0, 1.0, 1.8, { frame: trimC });
    wins(b, 'nx', -14, [-4.5, -1.5], 5.0, 1.0, 1.8, { frame: trimC });
    for (const x of [-9, 6]) streetTree(b, rng, x, 7.2, 0.8);
  } else if (v === 3) {
    // San Francisco "painted ladies": pastel Victorians, 2-storey angled bays, ornate front gables
    const cols = rng.chance(0.3) ? [0xa9c2d4, 0xe8d49a, 0xb5d1b8, 0xe2b8b8] : rng.shuffle([0xa9c2d4, 0xe8d49a, 0xb5d1b8, 0xe2b8b8, 0xc8b8e0, 0xf0d8b8, 0xb8d8d8, 0xe8c4a8]).slice(0, 4);
    const trims = rng.shuffle([0xf4f0e6, 0x5a3a4a, 0xf4f0e6, 0x3e5a6a]);
    for (let i = 0; i < 4; i++) {
      const xa = -14 + i * 7, xb = xa + 7, cx = (xa + xb) / 2;
      const wall = P(cols[i], Surf.Wood), tr = trims[i];
      const side = { px: i === 3 ? undefined : null, nx: i === 0 ? undefined : null };
      b.paint(0x8a8378).box(xa, 0, z0, xb, 1.5, z1, { top: null, ...side });
      b.paint(wall).box(xa, 1.5, z0, xb, 8.4, z1, { top: null, ...side });
      roofGable(b, cx, (z0 + z1) / 2 + 0.2, 7, z1 - z0 + 0.4, 8.4, 3.4, 'z', P(0x5a5a5e, Surf.RoofTiles), { gable: wall, over: 0.35, rake: 0.3, trim: tr });
      // gable trim band + round window
      band(b, xa, z1 - 0.2, xb, z1, 8.2, 0.3, 0.25, tr, false);
      inFace(b, 'pz', z1, () => {
        win(b, cx, 9.2, 1.0, 1.1, { frame: tr, mull: 2 });
        door(b, xb - 1.3, 1.5, 1.0, 2.3, [0x7e2a26, 0x2c3b57, 0x5a3a4a, 0x2f4a37][i], { transom: true, frame: tr, lamp: true });
        win(b, xb - 1.3, 5.3, 0.9, 1.9, { frame: tr, mull: 2 });
        steps(b, xb - 1.3, 1.5, 5, 0.3, 0.32, 0xb0a99c, 0, Surf.Wood);
        bay(b, xa + 2.5, 1.5, 8.2, 3.8, 0.9, wall, { winY: [2.2, 5.2], winH: 1.9, frame: tr, cap: tr });
      });
      wins(b, 'nz', z0, [xa + 2, xa + 5], 2.2, 1.0, 1.8, { frame: tr });
      wins(b, 'nz', z0, [xa + 2, xa + 5], 5.3, 1.0, 1.8, { frame: tr });
      b.paint(tr).quad2([xb - 2.1, 0.1, z1 + 1.6], [xb - 2.1, 0.1, z1 + 0.1], [xb - 2.1, 2.2, z1 + 0.1], [xb - 2.1, 2.2, z1 + 1.6]);
      lightPool(b, xb - 2.0, z1 + 1.6, xb - 0.6, z1 + 3.9, 0xc3beb3, 0.085);
    }
    wins(b, 'px', 14, [-4.5, -1.5], 5.3, 0.9, 1.7, { frame: 0x3e5a6a });
    wins(b, 'nx', -14, [-4.5, -1.5], 5.3, 0.9, 1.7, { frame: 0xf4f0e6 });
    for (const x of [-7, 7]) streetTree(b, rng, x, 7.2, 0.75);
  } else if (v === 4) {
    // Bath / Georgian terrace in honey limestone: parapet, entablature, fanlit doors, area railings
    const stC = pickPal(rng, [0xd8c49a, 0xcfc0a0, 0xe0cfa8], 0.4);
    const stone = P(stC, Surf.Stone), trimC = 0xe8dcc0;
    const doorsC = rng.shuffle([0x2f4a37, 0x7e2a26, 0x2c3b57, 0xa8823a, 0x1c1c1c]);
    // rusticated ground storey (proud, darker), plain ashlar above
    b.paint(P(mixHex(stC, 0x6a5a40, 0.18), Surf.Stone)).box(-14.1, 0, z0, 14.1, 3.9, z1 + 0.1, { top: { color: trimC } });
    b.paint(stone).box(-14, 3.9, z0, 14, 10.2, z1, { top: P(TAR, Surf.RoofFlat), bottom: null });
    inFace(b, 'pz', z1 + 0.1, () => { b.paint(mixHex(stC, 0x3a3020, 0.3)); for (const y of [1.3, 2.05, 2.8]) fq(b, -14.1, y, 14.1, y + 0.05, 0.01); });
    // 3-part entablature: architrave, frieze, projecting cornice
    band(b, -14, z0, 14, z1, 8.75, 0.25, 0.06, trimC, false);
    band(b, -14, z0, 14, z1, 9.0, 0.5, 0.02, mixHex(stC, 0xffffff, 0.15), false);
    bandRing(b, -14, z0, 14, z1, 9.5, 0.3, 0.3, trimC, TAR);
    parapet(b, -14, z0, 14, z1, 9.8, 0.9, 0.25, stC, trimC);
    for (let i = 0; i < 4; i++) {
      const xa = -14 + i * 7, du = xa + (i % 2 === 0 ? 1.5 : 5.5);
      inFace(b, 'pz', z1 + 0.1, () => {
        door(b, du, 1.0, 1.1, 2.4, doorsC[i], { transom: true, frame: 0xf2ead8, lamp: true });
        for (const x of (i % 2 === 0 ? [xa + 3.6, xa + 5.6] : [xa + 1.4, xa + 3.4])) win(b, x, 1.4, 1.0, 2.0, { frame: 0xf6f2e8, mull: 3 });
        for (const x of [xa + 1.5, xa + 3.5, xa + 5.5]) { win(b, x, 4.5, 1.0, 2.3, { frame: 0xf6f2e8, mull: 3, head: trimC }); win(b, x, 7.6, 1.0, 1.5, { frame: 0xf6f2e8, mull: 3 }); }
        steps(b, du, 1.6, 3, 0.33, 0.33, 0xc8b48a, 0, Surf.Stone);
      });
      b.paint(0x1c1c1c, Surf.Metal).box(du - 0.6, 3.7, z1 + 0.1, du + 0.6, 3.75, z1 + 0.5, { nz: null });
      if (i > 0) {
        chimney(b, xa, -1.5, 1.3, 3.0, 9.8, 12.3, stC, Surf.Stone);
        b.paint(0x9a5a44).cylinder(xa, -2.4, 12.48, 0.45, 0.14, 0.12, 5).cylinder(xa, -1.5, 12.48, 0.45, 0.14, 0.12, 5).cylinder(xa, -0.6, 12.48, 0.45, 0.14, 0.12, 5);
      }
      lightPool(b, du - 0.8, z1 + 1.1, du + 0.8, z1 + 2.9, 0xc3beb3, 0.085);
      wins(b, 'nz', z0, [xa + 2, xa + 5], 1.4, 1.0, 2.0, { frame: 0xf6f2e8 });
      wins(b, 'nz', z0, [xa + 2, xa + 5], 4.5, 1.0, 2.2, { frame: 0xf6f2e8 });
    }
    railing(b, -14, 6.8, 14, 6.8, 1.1);
    for (let i = 0; i < 4; i++) bush(b, -12.5 + i * 7 + (i % 2 ? -1.0 : 4.0), 5.3, 0.55, 0x3f6a2d, i);
    for (const x of [-7, 7]) streetTree(b, rng, x, 7.3, 0.8);
  } else {
    // Amsterdam canal houses: 5 narrow brick houses with step / neck / bell gables and hoist beams
    const cols = rng.chance(0.3) ? [0x5a3a2e, 0x7a4032, 0x3e3a38, 0x8a5a3e, 0x6a4a3a] : rng.shuffle([0x5a3a2e, 0x7a4032, 0x3e3a38, 0x8a5a3e, 0x6a4a3a, 0x4a3a34, 0x7a5a48, 0x5e4a40]).slice(0, 5);
    const doorsC = rng.shuffle([0x2f4a37, 0x1c1c1c, 0x7e2a26, 0x2c3b57, 0x2f4a37, 0x55707e]);
    const W = 5.6;
    for (let i = 0; i < 5; i++) {
      const xa = -14 + i * W, xb = xa + W, cx = (xa + xb) / 2;
      const hgt = [9.6, 10.4, 9.0, 10.0, 9.6][i];
      const brick = P(cols[i], Surf.Brick);
      const side = { px: i === 4 ? undefined : null, nx: i === 0 ? undefined : null };
      b.paint(brick).box(xa, 0, z0, xb, hgt, z1, { top: null, ...side });
      roofGable(b, cx, (z0 + z1) / 2, W, z1 - z0, hgt, 3.3, 'z', P(0x4a3a34, Surf.RoofTiles), { gable: brick, over: 0.05, rake: 0.0, trim: 0x3a2a24 });
      // front gable: stepped / neck
      const g = i % 3;
      b.paint(brick);
      if (g === 0) {
        for (let k = 0; k < 3; k++) b.box(xa + 0.5 + k * 0.7, hgt + k * 1.1, z1 - 0.35, xb - 0.5 - k * 0.7, hgt + (k + 1) * 1.1, z1, { bottom: null, top: P(0xe8e2d4) });
      } else if (g === 1) {
        b.box(cx - 1.3, hgt, z1 - 0.35, cx + 1.3, hgt + 3.0, z1, { bottom: null, top: P(0xe8e2d4) });
        b.paint(0xefe9dc).tri([cx - 1.3, hgt + 1.4, z1 + 0.01], [cx - 2.5, hgt, z1 + 0.01], [cx - 1.3, hgt, z1 + 0.01]);
        b.paint(0xefe9dc).tri([cx + 1.3, hgt + 1.4, z1 + 0.01], [cx + 1.3, hgt, z1 + 0.01], [cx + 2.5, hgt, z1 + 0.01]);
      } else {
        b.box(xa + 0.4, hgt, z1 - 0.35, xb - 0.4, hgt + 1.6, z1, { bottom: null, top: null });
        b.quad([xa + 0.4, hgt + 1.6, z1], [xb - 0.4, hgt + 1.6, z1], [cx + 0.6, hgt + 3.0, z1], [cx - 0.6, hgt + 3.0, z1]);
        b.paint(0xe8e2d4).box(cx - 0.7, hgt + 3.0, z1 - 0.35, cx + 0.7, hgt + 3.2, z1 + 0.05, { bottom: null });
      }
      // hoist beam
      b.paint(0x2a2622, Surf.Wood).box(cx - 0.1, hgt + (g === 0 ? 2.4 : 2.2), z1, cx + 0.1, hgt + (g === 0 ? 2.6 : 2.4), z1 + 1.0, { nz: null });
      const tr = 0xf0ece2;
      inFace(b, 'pz', z1, () => {
        door(b, xa + 1.3, 0.6, 1.0, 2.3, doorsC[i], { transom: true, frame: tr, lamp: i % 2 === 0 });
        win(b, xa + 3.7, 0.9, 1.6, 2.0, { frame: tr, mull: 3 });
        for (let f = 1; f * 3.0 + 2.3 < hgt; f++) { win(b, xa + 1.5, f * 3.0 + 0.6, 1.0, 1.7, { frame: tr, mull: 2 }); win(b, xa + 4.1, f * 3.0 + 0.6, 1.0, 1.7, { frame: tr, mull: 2 }); }
        win(b, cx, hgt + 0.5, 0.8, 1.1, { frame: tr, mull: 2 });
        steps(b, xa + 1.3, 1.3, 2, 0.3, 0.3, 0x9a948a);
      });
      wins(b, 'nz', z0, [cx], 3.9, 1.6, 1.8, { frame: tr });
      wins(b, 'nz', z0, [cx], 7.1, 1.6, 1.8, { frame: tr });
    }
    for (let i = 0; i < 4; i++) { b.paint(0x2a2c2e, Surf.Metal).cylinder(-11.2 + i * 5.6 + 2.8, 7.4, 0, 0.9, 0.06, 0.06, 5); }
    b.paint(0x2a2c2e, Surf.Metal);
    for (let i = 0; i < 3; i++) { const x = -9 + i * 7; b.box(x - 0.7, 0.4, 6.6, x + 0.7, 0.9, 6.7, { bottom: null }); }
  }
}

// ---------------------------------------------------------------------------------------------- balconies
/** Individual balconies on a world face at along-face centers `at`, one per floor base in ys. ~18 tris each. */
function balcs(b: ModelBuilder, f: Face, plane: number, at: number[], ys: number[], w: number, dp: number, slab: ColorLike, rail: ColorLike, railSurf: Surf = Surf.Plain, rh = 1.05): void {
  inFace(b, f, plane, () => {
    for (const a of at) for (const y of ys) {
      const u = U(f, a), x0 = u - w / 2, x1 = u + w / 2;
      b.paint(slab).box(x0, y - 0.2, 0, x1, y, dp, { nz: null });
      b.paint(rail, railSurf);
      b.quad([x0, y, dp], [x1, y, dp], [x1, y + rh, dp], [x0, y + rh, dp]);
      b.quad2([x1, y, dp], [x1, y, 0], [x1, y + rh, 0], [x1, y + rh, dp]);
      b.quad2([x0, y, 0], [x0, y, dp], [x0, y + rh, dp], [x0, y + rh, 0]);
    }
  });
}

/** Continuous balcony band along a world face [a0, a1] at floor y. rail: glass (Metal) or solid. */
function balcBand(b: ModelBuilder, f: Face, plane: number, a0: number, a1: number, y: number, dp: number, slab: ColorLike, rail: ColorLike, railSurf: Surf = Surf.Metal, rh = 1.05, plants: ColorLike | null = null): void {
  inFace(b, f, plane, () => {
    const u0 = Math.min(U(f, a0), U(f, a1)), u1 = Math.max(U(f, a0), U(f, a1));
    b.paint(slab).box(u0, y - 0.22, 0, u1, y, dp, { nz: null });
    b.paint(rail, railSurf);
    b.quad([u0, y, dp], [u1, y, dp], [u1, y + rh, dp], [u0, y + rh, dp]);
    b.quad2([u1, y, dp], [u1, y, 0], [u1, y + rh, 0], [u1, y + rh, dp]);
    b.quad2([u0, y, 0], [u0, y, dp], [u0, y + rh, dp], [u0, y + rh, 0]);
    if (plants !== null) b.paint(plants, Surf.Foliage).box(u0 + 0.2, y, dp - 0.7, u1 - 0.2, y + 1.35, dp - 0.1, { nz: null, bottom: null });
  });
}

/** Glass lobby front + canopy on a +z face. */
function lobby(b: ModelBuilder, x0: number, x1: number, zf: number, h: number, canopy: ColorLike, frame: ColorLike = 0x2a2c2e, dp = 2.4): void {
  inFace(b, 'pz', zf, () => {
    b.paint(frame); fq(b, x0 - 0.1, 0.1, x1 + 0.1, h + 0.1, 0.04);
    b.paint(0x2a3440, Surf.GlassPlain); fq(b, x0, 0.15, x1, h, 0.07);
    b.paint(frame);
    const n = Math.max(1, Math.round((x1 - x0) / 1.5));
    for (let i = 1; i < n; i++) { const u = x0 + ((x1 - x0) * i) / n; fq(b, u - 0.04, 0.15, u + 0.04, h, 0.09); }
  });
  b.paint(canopy).box(x0 - 0.8, h + 0.2, zf, x1 + 0.8, h + 0.5, zf + dp, { nz: null, bottom: { color: 0xd8d4cc } });
  b.paint(0xfff0c8, Surf.Emissive).box(x0, h + 0.15, zf + 0.4, x1, h + 0.2, zf + dp - 0.4, { top: null, nz: null, px: null, nx: null, pz: null, bottom: { color: 0xfff0c8, surf: Surf.Emissive } });
}

/** Rooftop mechanical: a few AC units + optional bulkhead. */
function roofMech(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, y: number, n = 3, hut = true): void {
  for (let i = 0; i < n; i++) acUnit(b, rng.range(x0 + 1.5, x1 - 1.5), y, rng.range(z0 + 1.5, z1 - 1.5), rng.range(0.8, 1.2));
  if (hut) bulkhead(b, (x0 + x1) / 2 + rng.range(-2, 2), (z0 + z1) / 2 + rng.range(-1, 1), 3.2, 3.0, y, 2.8);
}

// ---------------------------------------------------------------------------------------------- APARTMENT (R$$) 2x2
function apartment(b: ModelBuilder, v: number, rng: RNG): void {
  lawnSlab(b, -16, -16, 16, 16, 0x6a9443);
  const fh = 3.0;
  if (v === 0 || v === 2 || v === 3) {
    // slab: x [-12.6, 12.6] (6 cols of 4.2), z [-4.2, 8.4]
    const C = 4.2, x0 = -3 * C, x1 = 3 * C, z0 = -C, z1 = 2 * C;
    const floors = v === 2 ? 7 : 6, top = floors * fh;
    const wall = [0xe8e4dc, 0, 0xd4d6d6, 0xd8c8ae][v];
    const setback = v === 3;
    ww(b, x0, z0, x1, z1, fh, setback ? top - fh : top, wall, 3, fh, P(0x9a968e, Surf.RoofFlat));
    b.paint(0x9c9890).box(x0, 0, z0, x1, fh, z1, { top: null });
    lobby(b, -4.2, 4.2, z1, 2.8, v === 0 ? 0x3a3c40 : 0xe8e8e4);
    inFace(b, 'pz', z1, () => { for (const x of [-10.5, -6.3, 6.3, 10.5]) win(b, x, 0.9, 3.0, 1.6, { frame: 0x3a3c40, ft: 0.06 }); });
    wins(b, 'nz', z0, [-10.5, -6.3, -2.1, 2.1, 6.3, 10.5], 0.9, 3.0, 1.6, { frame: 0x3a3c40, ft: 0.06 });
    const ys = Array.from({ length: floors - (setback ? 2 : 1) }, (_, i) => (i + 1) * fh);
    if (v === 0) {
      balcs(b, 'pz', z1, [-10.5, -6.3, -2.1, 2.1, 6.3, 10.5], ys, 3.4, 1.5, 0xf2f0ea, 0xc0643e);
      flatRoof(b, x0, z0, x1, z1, top, 0.9, 0.25, 0xe8e4dc, 0x8a867e, 0xd0ccc4);
      roofMech(b, rng, x0, z0, x1, z1, top, 3, true);
    } else if (v === 2) {
      for (const y of ys) balcBand(b, 'pz', z1, x0, x1, y, 1.8, 0xf4f4f0, 0x9fb4c0, Surf.Metal);
      for (let i = 1; i < 6; i++) b.paint(0xf4f4f0).box(x0 + i * C - 0.1, fh, z1, x0 + i * C + 0.1, top - fh + 1.1, z1 + 1.8, { bottom: null });
      // penthouse set back
      flatRoof(b, x0, z0, x1, z1, top, 0.3, 0.2, 0xd4d6d6, 0x8a867e);
      ww(b, x0 + C, z0 + 1.5, x1 - C, z1 - 3.0, top, top + fh, 0x3a3d42, 3, fh);
      band(b, x0 + C - 0.8, z0 + 0.7, x1 - C + 0.8, z1 - 2.2, top + fh, 0.3, 0, 0xf4f4f0);
      b.paint(0x9fb4c0, Surf.Metal).quad2([x0 + 0.3, top + 0.3, z1 - 0.3], [x1 - 0.3, top + 0.3, z1 - 0.3], [x1 - 0.3, top + 1.3, z1 - 0.3], [x0 + 0.3, top + 1.3, z1 - 0.3]);
      acUnit(b, x0 + 2, top, z0 + 2); acUnit(b, x1 - 2, top, z0 + 2);
    } else {
      // warm beige with wood accent strips, top floor set back with a green terrace
      b.paint(0x9a7250, Surf.Wood);
      for (const x of [-8.4, 0, 8.4]) b.box(x - 0.5, fh, z1, x + 0.5, top - fh, z1 + 0.25, { nz: null, bottom: null });
      balcs(b, 'pz', z1, [-10.5, -6.3, -2.1, 2.1, 6.3, 10.5], ys.filter((_, i) => i % 2 === 0), 3.4, 1.4, 0xece8e0, 0x9fb4c0, Surf.Metal);
      balcs(b, 'pz', z1, [-10.5, -6.3, -2.1, 2.1, 6.3, 10.5].filter((_, i) => i % 2 === 1), ys.filter((_, i) => i % 2 === 1), 3.4, 1.4, 0xece8e0, 0x9fb4c0, Surf.Metal);
      b.paint(0x5f8a3a, Surf.Foliage).quad([x0, top - fh + 0.05, z1], [x1, top - fh + 0.05, z1], [x1, top - fh + 0.05, z0], [x0, top - fh + 0.05, z0]);
      ww(b, x0 + C, z0, x1 - C, z1 - 2.5, top - fh, top, 0xd8c8ae, 3, fh, P(0x5f8a3a, Surf.Foliage));
      parapet(b, x0, z0, x1, z1, top - fh, 0.4, 0.2, 0xd8c8ae);
      b.paint(0x9fb4c0, Surf.Metal).quad2([x0 + 0.2, top - fh + 0.4, z1 - 0.2], [x1 - 0.2, top - fh + 0.4, z1 - 0.2], [x1 - 0.2, top - fh + 1.2, z1 - 0.2], [x0 + 0.2, top - fh + 1.2, z1 - 0.2]);
      for (const x of [-11, 11]) planter(b, x, z1 - 1.4, 1.2, 1.2, top - fh, 0x8f8a80, 0x4f7a34, x);
      solar(b, x0 + C + 1, z0 + 1, x1 - C - 1, z1 - 3.5, top);
    }
    // back parking + front landscaping
    parking(b, rng, -15, -15.8, 15, -5.0, 0.55, 1);
    paveSlab(b, -2.5, z1, 2.5, 16, 0xc8c4bc, 0.1);
    hedgeBox(b, -15.6, 13.8, -3.2, 14.6, 0.9, 0x3f6b2e);
    hedgeBox(b, 3.2, 13.8, 15.6, 14.6, 0.9, 0x3f6b2e);
    for (const x of [-10, -5.5, 5.5, 10]) tree(b, rng, x, 12.0, 0.9, 'round');
    bushRow(b, -12, 9.5, -5, 9.5, 4, 0.55, 0x4a7434, v);
    bushRow(b, 5, 9.5, 12, 9.5, 4, 0.55, 0x4a7434, v + 7);
  } else if (v === 1) {
    // L-shaped brick block, punched windows, bar balconies, courtyard garden at the back
    const C = 3.0, fh1 = 3.0, top = 5 * fh1;
    const brick = 0x9a5a44;
    ww(b, -4 * C, 0, 4 * C, 3 * C, 0, top, brick, 0, fh1, null);
    ww(b, 1 * C, -4 * C, 4 * C, 0, 0, top, brick, 0, fh1, null, { pz: null });
    cornice(b, -4 * C, 0, 4 * C, 3 * C, top, 0xd8d0c0, ['pz'], false, 0.3);
    cornice(b, 1 * C, -4 * C, 4 * C, 0, top, 0xd8d0c0, ['pz'], false, 0.3);
    parapet(b, -4 * C, 0, 4 * C, 3 * C, top + 0.35, 0.6, 0.25, brick, 0xd8d0c0);
    band(b, -4 * C, 0, 4 * C, 3 * C, fh1 - 0.1, 0.25, 0.08, 0xd8d0c0, false);
    balcs(b, 'pz', 3 * C, [-7.5, -1.5, 4.5, 10.5], [fh1, 2 * fh1, 3 * fh1, 4 * fh1], 2.2, 1.1, 0xd8d0c0, 0x8a9096, Surf.Metal, 0.9);
    inFace(b, 'pz', 3 * C, () => { door(b, 1.5, 0.1, 1.8, 2.5, 0x2a2c2e, { transom: true, frame: 0xd8d0c0, lamp: true }); });
    b.paint(0xd8d0c0).box(0, 2.8, 3 * C, 3, 2.95, 3 * C + 1.2, { nz: null });
    balcs(b, 'nx', 1 * C, [-10.5, -4.5], [fh1, 2 * fh1, 3 * fh1, 4 * fh1], 2.2, 1.1, 0xd8d0c0, 0x8a9096, Surf.Metal, 0.9);
    roofMech(b, rng, -4 * C, 0, 4 * C, 3 * C, top + 0.35, 2, true);
    acUnit(b, 7.5, top + 0.35, -7);
    // garden courtyard
    lawnSlab(b, -12, -15, 3, 0, 0x5e8d3c, 0.1);
    paveSlab(b, -12, -8, 3, -6.5, 0xc8c2b6, 0.12);
    for (const [x, z] of [[-9, -11.5], [-4, -3.5], [-9, -3.5]] as [number, number][]) tree(b, rng, x, z, 0.9, 'round');
    playsetMini(b, -4, -12);
    parking(b, rng, 1.0, -15.8, 15.6, -12.4, 0.0, 1);
    paveSlab(b, 12.4, -12.4, 15.8, 16, ASPH, 0.08);
    parkedCar(b, rng, 14.1, 6, 0);
    paveSlab(b, -16, 9, 16, 16, 0xc3beb3, 0.1);
    for (const x of [-12, -4, 7]) { b.paint(0x5a4432).box(x - 0.8, 0.1, 12.2, x + 0.8, 0.13, 13.8, { bottom: null }); tree(b, rng, x, 13, 0.8, 'round'); }
  } else if (v === 4) {
    // white base with checkerboard of cantilevered dark boxes
    const C = 4.2, x0 = -3 * C, x1 = 3 * C, z0 = -C, z1 = 2 * C, floors = 5, top = floors * fh;
    ww(b, x0, z0, x1, z1, 0, top, 0xeeeeea, 0, fh);
    b.paint(0x55585c).box(x0 - 0.02, 0, z1 - 0.1, x1 + 0.02, fh, z1 + 0.02, { top: null, nz: null, bottom: null });
    lobby(b, -4.2, 0.0, z1, 2.8, 0x2e3033);
    for (let f = 1; f < floors; f++) for (let c = 0; c < 6; c++) {
      if ((f + c) % 2) continue;
      const xa = x0 + c * C + 0.2, xb = xa + C - 0.4, y0 = f * fh + 0.1;
      b.paint(0x3a3d42).box(xa, y0, z1, xb, y0 + fh - 0.2, z1 + 1.3, { nz: null });
      inFace(b, 'pz', z1 + 1.3, () => { b.paint(0x2a3440, Surf.WallWindows, 3, 100); fq(b, xa + 0.3, y0 + 0.5, xb - 0.3, y0 + fh - 0.6, 0.02); });
    }
    flatRoof(b, x0, z0, x1, z1, top, 0.5, 0.2, 0xeeeeea, 0x8a867e);
    roofMech(b, rng, x0, z0, x1, z1, top, 3, true);
    balcs(b, 'nz', z0, [-8.4, 0, 8.4], [fh, 2 * fh, 3 * fh, 4 * fh], 3.4, 1.3, 0xeeeeea, 0x55585c, Surf.Metal);
    parking(b, rng, -15, -15.8, 15, -5.0, 0.55, 1);
    paveSlab(b, -4.5, z1, 0.5, 16, 0xc8c4bc, 0.1);
    for (let i = 0; i < 5; i++) planter(b, 3 + i * 2.6, 10.5, 1.8, 1.0, 0, 0x55585c, 0x5a8a3a, i);
    for (const x of [-12, -8]) tree(b, rng, x, 12, 0.9, 'column');
    hedgeBox(b, -15.6, 14.2, -5.0, 15.0, 0.8, 0x3f6b2e);
  } else {
    // 1990s pastel block: salmon + cream, hipped tile roof, corner balconies
    const C = 3.0, x0 = -4 * C, x1 = 4 * C, z0 = -2 * C, z1 = 2 * C, floors = 6, top = floors * fh;
    ww(b, x0, z0, x1, z1, 0, top, 0xd9a08a, 0, fh, null);
    b.paint(0xefe6d6).box(x0 - 0.05, 0, z0 - 0.05, x1 + 0.05, fh, z1 + 0.05, { top: null, bottom: null });
    for (const x of [-3, 3]) b.paint(0xefe6d6).box(x - 1.5, fh, z1, x + 1.5, top, z1 + 0.3, { nz: null, bottom: null, top: null });
    band(b, x0, z0, x1, z1, top - 0.3, 0.3, 0.2, 0xefe6d6, false);
    roofHip(b, 0, 0, x1 - x0, z1 - z0, top, 3.2, P(0xa65a3c, Surf.RoofTiles), { over: 0.7, trim: 0xefe6d6 });
    const ys = [fh, 2 * fh, 3 * fh, 4 * fh, 5 * fh];
    balcs(b, 'pz', z1, [-10.5, 10.5], ys, 2.8, 1.4, 0xefe6d6, 0xf4f0e8, Surf.Metal, 1.0);
    balcs(b, 'px', x1, [4.5], ys, 2.8, 1.3, 0xefe6d6, 0xf4f0e8, Surf.Metal, 1.0);
    balcs(b, 'nx', x0, [4.5], ys, 2.8, 1.3, 0xefe6d6, 0xf4f0e8, Surf.Metal, 1.0);
    inFace(b, 'pz', z1, () => { door(b, 0, 0.1, 2.0, 2.5, 0x55707e, { frame: 0xefe6d6, sidelights: true, lamp: true }); });
    b.paint(0xa65a3c).box(-2.0, 2.8, z1, 2.0, 3.0, z1 + 1.8, { nz: null });
    parking(b, rng, -15, -15.8, 15, -7.0, 0.5, 1);
    paveSlab(b, -1.2, z1, 1.2, 16, 0xc8c4bc, 0.1);
    for (const x of [-11, -6, 6, 11]) tree(b, rng, x, 11.5, 0.95, 'round');
    bushRow(b, -11, 7.2, -3, 7.2, 5, 0.5, 0x4a7434, 3);
    bushRow(b, 3, 7.2, 11, 7.2, 5, 0.5, 0x4a7434, 9);
    flowerBed(b, -4, 9, 4, 10, 0xc4506a);
  }
}

const ASPH = 0x404145;

function playsetMini(b: ModelBuilder, x: number, z: number): void {
  b.paint(0xd9c39a, Surf.Pavement).box(x - 2.5, 0, z - 2, x + 2.5, 0.14, z + 2, { bottom: null });
  b.paint(0xc9483a).box(x - 1.2, 0, z - 0.6, x + 0.2, 1.4, z + 0.6, { bottom: null });
  b.paint(0x3a7ab8).gableRoof(x - 0.5, z, 1.4, 1.2, 1.4, 0.6, 'x', 0.1);
  b.paint(0xd9b23a, Surf.Metal).quad2([x + 0.2, 1.2, z - 0.3], [x + 0.2, 1.2, z + 0.3], [x + 2.0, 0.15, z + 0.3], [x + 2.0, 0.15, z - 0.3]);
}

function solar(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number): void {
  b.paint(0x1d2a44, Surf.GlassCurtain, 3, 1.2);
  for (let z = z0; z + 1.6 <= z1; z += 2.4) b.quad([x0, y + 0.3, z + 1.6], [x1, y + 0.3, z + 1.6], [x1, y + 0.9, z], [x0, y + 0.9, z]);
}

// ---------------------------------------------------------------------------------------------- CONDO (R$$$) 2x2
function condo(b: ModelBuilder, v: number, rng: RNG): void {
  lawnSlab(b, -16, -16, 16, 16, 0x5a8c3a);
  const fh = 3.2;
  const glassRail = 0xa8bcc8;
  if (v === 0) {
    // terraced ziggurat: setbacks toward the street, glass-railed terraces with planters
    const C = 4.2, x0 = -3 * C, x1 = 3 * C, z0 = -2 * C;
    const stone = 0xe6e0d4;
    const tiers: [number, number, number][] = [[0, 5, 2 * C], [5, 7, C], [7, 9, 0]];
    for (const [f0, f1, zf] of tiers) {
      ww(b, x0, z0, x1, zf, f0 * fh, f1 * fh, stone, 3, fh, P(0xc8c2b4, Surf.Pavement));
      if (f1 < 9) {
        const y = f1 * fh;
        b.paint(glassRail, Surf.Metal).quad2([x0 + 0.2, y, zf - 0.2], [x1 - 0.2, y, zf - 0.2], [x1 - 0.2, y + 1.1, zf - 0.2], [x0 + 0.2, y + 1.1, zf - 0.2]);
        for (let i = 0; i < 4; i++) planter(b, x0 + 2.5 + i * 6.5, zf - 1.3, 2.4, 0.9, y, 0xb8b0a0, 0x4f7a34, i + f1);
        b.paint(0xe8e2d4).box(x0 + 1.6, y, zf - C + 0.8, x0 + 4.4, y + 2.6, zf - C + 3.0, { bottom: null, top: { color: 0xf4f0e8 } });
      }
    }
    for (let f = 1; f < 5; f++) balcBand(b, 'pz', 2 * C, x0, x1, f * fh, 1.6, 0xf2eee6, glassRail);
    b.paint(0x2a3440, Surf.GlassPlain).box(x0 + 0.2, 0.1, 2 * C, x1 - 0.2, fh - 0.2, 2 * C + 0.02, { top: null, bottom: null, nz: null });
    b.paint(0xd8d2c4).box(-5, fh - 0.1, 2 * C, 5, fh + 0.2, 2 * C + 3.0, { nz: null });
    flatRoof(b, x0, z0, x1, 0, 9 * fh, 0.6, 0.2, stone, 0x8a867e);
    roofMech(b, rng, x0, z0, x1, 0, 9 * fh, 2, true);
    frontGarden(b, rng, 2 * C);
  } else if (v === 1) {
    // stepped sideways: 9-storey glass block + 6-storey block with roof terrace, white slab bands
    const xl0 = -12, xm = -1.5, xr1 = 12, z0 = -7.5, z1 = 7.5;
    b.paint(0x2a3440, Surf.GlassCurtain, 5, fh).box(xl0, 0, z0, xm, 9 * fh, z1, { top: P(0x8a867e, Surf.RoofFlat) });
    b.paint(0x2a3440, Surf.GlassCurtain, 0, fh).box(xm, 0, z0, xr1, 6 * fh, z1, { top: P(0xc8c2b4, Surf.Pavement), nx: null });
    for (let f = 1; f <= 9; f++) band(b, xl0, z0, xm, z1, f * fh - 0.25, 0.3, 1.2, 0xf4f2ec, f === 9);
    for (let f = 1; f <= 6; f++) band(b, xm, z0, xr1, z1, f * fh - 0.25, 0.3, 1.2, 0xf4f2ec, false);
    for (let f = 1; f < 9; f++) b.paint(glassRail, Surf.Metal).quad2([xl0 - 1.2, f * fh + 0.05, z1 + 1.2], [xm, f * fh + 0.05, z1 + 1.2], [xm, f * fh + 1.1, z1 + 1.2], [xl0 - 1.2, f * fh + 1.1, z1 + 1.2]);
    for (let f = 1; f < 6; f++) b.paint(glassRail, Surf.Metal).quad2([xm, f * fh + 0.05, z1 + 1.2], [xr1 + 1.2, f * fh + 0.05, z1 + 1.2], [xr1 + 1.2, f * fh + 1.1, z1 + 1.2], [xm, f * fh + 1.1, z1 + 1.2]);
    // roof terrace with pergola and plants on the lower block
    const y = 6 * fh + 0.05;
    b.paint(glassRail, Surf.Metal).quad2([xm, y, z1 + 1.1], [xr1 + 1.1, y, z1 + 1.1], [xr1 + 1.1, y + 1.1, z1 + 1.1], [xm, y + 1.1, z1 + 1.1]);
    b.paint(0x7a5a40, Surf.Wood);
    for (const [px, pz] of [[2, 1], [8, 1], [2, 5], [8, 5]] as [number, number][]) b.box(px - 0.1, y, pz - 0.1, px + 0.1, y + 2.6, pz + 0.1, { bottom: null });
    for (let i = 0; i < 6; i++) b.box(1.8 + i * 1.28, y + 2.6, 0.7, 2.0 + i * 1.28, y + 2.8, 5.3, { bottom: null });
    for (let i = 0; i < 4; i++) planter(b, 0.5 + i * 3.3, -4.5, 2.0, 1.0, y, 0x9a948a, 0x4f7a34, i);
    tree(b, rng, 10.5, -5.0, 0.0001);
    b.paint(0x4f7a34, Surf.Foliage).blob(10.5, y + 2.0, -4.8, 1.4, 1.3, 1.4, 0, 0.2, 3);
    b.paint(0x3a3d42).box(-11.8, 9 * fh, -6, -4, 9 * fh + 2.8, -1, { bottom: null, top: P(0x5e5b55, Surf.RoofFlat) });
    lobbyFront(b, -9, -4, z1 + 1.2);
    frontGarden(b, rng, z1 + 1.2);
  } else if (v === 2) {
    // rounded front corner with continuous white balcony bands, silver glass
    const fl = 8, R = 7.0, x0 = -12, x1 = 12, z0 = -8, z1 = 7;
    const pts: [number, number][] = [[x0, z0], [x1, z0], [x1, z1 - R]];
    for (let k = 1; k < 6; k++) { const a = (k / 6) * (Math.PI / 2); pts.push([x1 - R + Math.cos(a) * R, z1 - R + Math.sin(a) * R]); }
    pts.push([x1 - R, z1], [x0, z1]);
    b.paint(0x2a3440, Surf.GlassCurtain, 4, fh).extrude(pts, 0, fl * fh, { topPaint: P(0x8a867e, Surf.RoofFlat) });
    // balcony bands follow the outline (front + curve + right side), 1.4 m out
    const out: [number, number][] = [[x1 + 1.4, z0 + 2], [x1 + 1.4, z1 - R]];
    for (let k = 1; k < 6; k++) { const a = (k / 6) * (Math.PI / 2); out.push([x1 - R + Math.cos(a) * (R + 1.4), z1 - R + Math.sin(a) * (R + 1.4)]); }
    out.push([x1 - R, z1 + 1.4], [x0 + 2, z1 + 1.4]);
    const inn: [number, number][] = [[x1, z0 + 2], [x1, z1 - R]];
    for (let k = 1; k < 6; k++) { const a = (k / 6) * (Math.PI / 2); inn.push([x1 - R + Math.cos(a) * R, z1 - R + Math.sin(a) * R]); }
    inn.push([x1 - R, z1], [x0 + 2, z1]);
    for (let f = 1; f <= fl; f++) {
      const y = f * fh;
      b.paint(0xf4f2ec);
      for (let i = 0; i < out.length - 1; i++) {
        const a = out[i], c = out[i + 1], ia = inn[i], ic = inn[i + 1];
        b.quad([ia[0], y, ia[1]], [a[0], y, a[1]], [c[0], y, c[1]], [ic[0], y, ic[1]]);
        b.quad([a[0], y - 0.3, a[1]], [c[0], y - 0.3, c[1]], [c[0], y, c[1]], [a[0], y, a[1]].map((q) => q) as [number, number, number]);
        if (f < fl) { b.paint(glassRail, Surf.Metal); b.quad2([a[0], y, a[1]], [c[0], y, c[1]], [c[0], y + 1.05, c[1]], [a[0], y + 1.05, a[1]]); b.paint(0xf4f2ec); }
      }
    }
    b.paint(0xf4f2ec).box(x0 - 0.2, 0, z0 - 0.2, x0 + 2, fl * fh + 0.6, z1 + 1.6, { bottom: null });
    b.paint(0xf4f2ec).box(x1 - 2, 0, z0 - 0.2, x1 + 1.6, fl * fh + 0.6, z0 + 2, { bottom: null });
    roofMech(b, rng, x0 + 3, z0 + 1, x1 - 6, z1 - 2, fl * fh, 2, true);
    lobbyFront(b, -6, 0, z1 + 1.4);
    frontGarden(b, rng, z1 + 1.4);
  } else if (v === 3) {
    // dark glass with vertical wood fins, cantilevered boxes, rooftop pool
    const x0 = -12, x1 = 12, z0 = -8, z1 = 6, fl = 9;
    b.paint(0x2a3440, Surf.GlassCurtain, 3, fh).box(x0, fh, z0, x1, fl * fh, z1, { top: P(0xc8c2b4, Surf.Pavement) });
    b.paint(0x3a3c40).box(x0, 0, z0, x1, fh, z1, { top: null });
    b.paint(0x9a7250, Surf.Wood);
    for (let i = 0; i <= 12; i++) { const x = x0 + i * 2; b.box(x - 0.12, fh, z1, x + 0.12, fl * fh, z1 + 0.6, { nz: null, bottom: null }); }
    for (const [xa, f] of [[-9, 3], [2, 5], [-4, 7]] as [number, number][]) {
      b.paint(0xe8e6e0).box(xa, f * fh, z1 + 0.6, xa + 6, (f + 1) * fh, z1 + 3.0, { nz: null });
      inFace(b, 'pz', z1 + 3.0, () => { b.paint(0x2a3440, Surf.GlassPlain); fq(b, xa + 0.3, f * fh + 0.3, xa + 5.7, (f + 1) * fh - 0.3, 0.02); });
    }
    // rooftop pool + deck
    const y = fl * fh;
    b.paint(0xa8bcc8, Surf.Metal).quad2([x0 + 0.1, y, z1 - 0.1], [x1 - 0.1, y, z1 - 0.1], [x1 - 0.1, y + 1.1, z1 - 0.1], [x0 + 0.1, y + 1.1, z1 - 0.1]);
    b.paint(0x8a6a4c, Surf.Wood).box(x0 + 0.5, y, z0 + 0.5, x1 - 0.5, y + 0.15, z1 - 0.5, { bottom: null });
    b.paint(0x3fb0d8, Surf.Water).box(x0 + 2, y + 0.15, -1, x1 - 6, y + 0.3, 4, { bottom: null });
    for (const x of [-8, -6, -4, -2]) lounger(b, x, -4.5, 0, 0xf2f0ea, y + 0.15);
    b.paint(0x3a3d42).box(x1 - 5, y + 0.15, z0 + 1, x1 - 1, y + 3.0, z0 + 5, { bottom: null, top: P(0x5e5b55, Surf.RoofFlat) });
    lobbyFront(b, -3, 3, z1 + 0.6);
    frontGarden(b, rng, z1 + 0.6);
  } else if (v === 4) {
    // classic limestone luxury: arched windows, balconettes, mansard penthouse w/ dormers, canopy
    const C = 3.2, x0 = -4 * C, x1 = 4 * C, z0 = -2 * C, z1 = 2 * C, fl = 7, top = fl * fh;
    b.paint(P(0xc8bea8, Surf.Stone)).box(x0, 0, z0, x1, fh, z1, { top: null });
    ww(b, x0, z0, x1, z1, fh, top, 0xd6ccb6, 7, fh, null);
    band(b, x0, z0, x1, z1, fh - 0.15, 0.35, 0.15, 0xe6decc, false);
    band(b, x0, z0, x1, z1, 3 * fh - 0.1, 0.2, 0.1, 0xe6decc, false);
    bandRing(b, x0, z0, x1, z1, top, 0.5, 0.45, 0xe6decc);
    roofMansard(b, 0, 0, x1 - x0, z1 - z0, top + 0.5, 4.2, 1.6, P(0x3e444c, Surf.RoofTiles), P(0x6c6962, Surf.RoofFlat), 0.2);
    for (const x of [-11.2, -4.8, 4.8, 11.2]) {
      const zf = z1 - 0.5;
      b.paint(0xe6decc).box(x - 1.0, top + 0.9, zf - 2.0, x + 1.0, top + 3.6, zf, { nz: null, bottom: null, top: P(0x3e444c) });
      inFace(b, 'pz', zf, () => win(b, x, top + 1.2, 1.1, 1.9, { frame: 0xe6decc, mull: 2 }));
    }
    // balconettes (iron) on floors 2 & 5
    for (const f of [2, 5]) inFace(b, 'pz', z1, () => {
      for (let c = 0; c < 8; c++) {
        const u = x0 + (c + 0.5) * C;
        b.paint(0xe6decc).box(u - 1.0, f * fh + 0.2, 0, u + 1.0, f * fh + 0.35, 0.6, { nz: null });
        b.paint(0x3a3d40, Surf.Metal); fq(b, u - 1.0, f * fh + 0.35, u + 1.0, f * fh + 1.05, 0.58);
      }
    });
    inFace(b, 'pz', z1, () => {
      door(b, 0, 0.1, 2.2, 2.7, 0x2a2622, { transom: true, frame: 0xe6decc, sidelights: true });
      for (const x of [-11.2, -8, -4.8, 4.8, 8, 11.2]) win(b, x, 0.8, 1.2, 1.9, { frame: 0xe6decc, mull: 2 });
    });
    b.paint(0x1f3a2e).box(-1.8, 2.9, z1, 1.8, 3.2, z1 + 4.0, { nz: null });
    b.paint(0xd8d0bc, Surf.Metal).box(-1.75, 0.1, z1 + 3.85, -1.6, 2.9, z1 + 4.0).box(1.6, 0.1, z1 + 3.85, 1.75, 2.9, z1 + 4.0);
    chimney(b, -8, -3, 1.2, 1.0, top + 4, top + 5.4, 0xd6ccb6, Surf.Stone);
    chimney(b, 8, -3, 1.2, 1.0, top + 4, top + 5.4, 0xd6ccb6, Surf.Stone);
    frontGarden(b, rng, z1);
    parkedCar(b, rng, 4.5, z1 + 5.5, Math.PI / 2, 0x1c1c1c);
  } else {
    // vertical-garden condo: deep planted balconies wrapping front & sides, rooftop trees
    const C = 4.2, x0 = -3 * C, x1 = 3 * C, z0 = -2 * C, z1 = C, fl = 7, top = fl * fh;
    ww(b, x0, z0, x1, z1, 0, top, 0xece9e2, 3, fh);
    lobby(b, -4.2, 4.2, z1, 2.9, 0xece9e2);
    for (let f = 1; f < fl; f++) {
      const y = f * fh, green = [0x4f7a34, 0x5a8a3a, 0x3f6b2e][f % 3];
      balcBand(b, 'pz', z1, x0 - 1.8, x1 + 1.8, y, 2.2, 0xf4f2ec, 0xf4f2ec, Surf.Plain, 0.5, green);
      balcBand(b, 'px', x1, z0, z1, y, 1.8, 0xf4f2ec, 0xf4f2ec, Surf.Plain, 0.5, green);
      balcBand(b, 'nx', x0, z0, z1, y, 1.8, 0xf4f2ec, 0xf4f2ec, Surf.Plain, 0.5, green);
    }
    flatRoof(b, x0, z0, x1, z1, top, 0.9, 0.25, 0xece9e2, 0x5f8a3a);
    for (const [x, z] of [[-8, -4], [0, -5], [8, -3], [-4, 0.5], [5, 0]] as [number, number][]) { b.paint(0x5b4330, Surf.Wood).cylinder(x, z, top, 1.8, 0.15, 0.12, 5, { top: false }); b.paint(0x4f7a34, Surf.Foliage).blob(x, top + 2.8, z, 1.7, 1.5, 1.7, 0, 0.2, x + z); }
    frontGarden(b, rng, z1 + 2.2);
  }
}

function lobbyFront(b: ModelBuilder, x0: number, x1: number, z: number): void {
  b.paint(0xd8d2c4).box(x0 - 1, 3.0, z, x1 + 1, 3.3, z + 2.6, { nz: null, bottom: { color: 0xe8e4dc } });
  b.paint(0xfff0c8, Surf.Emissive).box(x0, 2.95, z + 0.5, x1, 3.0, z + 2.1, { top: null, nz: null, px: null, nx: null, pz: null, bottom: { color: 0xfff0c8, surf: Surf.Emissive } });
}

/** Manicured front: paved entry court, planters, hedges and trees between building front zf and the street. */
function frontGarden(b: ModelBuilder, rng: RNG, zf: number): void {
  paveSlab(b, -6, zf, 6, 16, 0xd4cfc4, 0.1);
  for (const x of [-4.5, 4.5]) planter(b, x, zf + 3, 1.6, 1.6, 0, 0x8f8a80, 0x4f7a34, x);
  hedgeBox(b, -15.6, 14.4, -6.5, 15.2, 1.1, 0x355e28);
  hedgeBox(b, 6.5, 14.4, 15.6, 15.2, 1.1, 0x355e28);
  for (const x of [-12, -8.5, 8.5, 12]) tree(b, rng, x, Math.min(zf + 4, 12), 0.95, 'round');
  bushRow(b, -14, zf + 1.0, -7, zf + 1.0, 4, 0.6, 0x4a7434, zf);
  bushRow(b, 7, zf + 1.0, 14, zf + 1.0, 4, 0.6, 0x4a7434, zf + 3);
  paveSlab(b, -15.8, -15.8, 15.8, -10.5, ASPH, 0.08);
}

// ---------------------------------------------------------------------------------------------- COURTYARD BLOCK (R$$) 3x3
function courtyard(b: ModelBuilder, v: number, rng: RNG): void {
  paveSlab(b, -24, -24, 24, 24, 0xc3beb3, 0.08);
  const C = 3.0, fh = 3.2, R = 7 * C, r = 3 * C; // 42 m block, 18 m court
  if (v === 0) {
    // O-shaped perimeter block with gate passage, ochre render, mansard attic, green court
    const col = 0xd4a070, trimC = 0xf0e8d8, fl = 6, top = fl * fh;
    ww(b, -R, r, -1 * C, R, 0, top, col, 0, fh, null);
    ww(b, 1 * C, r, R, R, 0, top, col, 0, fh, null);
    ww(b, -1 * C, r, 1 * C, R, fh, top, col, 0, fh, null, { px: null, nx: null });
    b.paint(0x3a3634).box(-1 * C, 0, r, 1 * C, fh, R, { top: { color: 0x5a5450 }, pz: null, nz: null, px: { color: 0x9a8a78 }, nx: { color: 0x9a8a78 } });
    b.paint(0x5a5450).quad([-C, fh - 0.01, R], [C, fh - 0.01, R], [C, fh - 0.01, r], [-C, fh - 0.01, r]);
    ww(b, -R, -R, R, -r, 0, top, col, 0, fh, null);
    ww(b, -R, -r, -r, r, 0, top, col, 0, fh, null, { pz: null, nz: null });
    ww(b, r, -r, R, r, 0, top, col, 0, fh, null, { pz: null, nz: null });
    // arch frame around the gate
    inFace(b, 'pz', R, () => { b.paint(trimC); fq(b, -C - 0.4, 0, -C, fh + 0.4, 0.06); fq(b, C, 0, C + 0.4, fh + 0.4, 0.06); fq(b, -C - 0.4, fh, C + 0.4, fh + 0.4, 0.06); });
    for (const [a, c, d, e] of [[-R, r, R, R], [-R, -R, R, -r], [-R, -r, -r, r], [r, -r, R, r]] as [number, number, number, number][]) {
      bandRing(b, a, c, d, e, top, 0.4, 0.35, trimC);
      roofMansard(b, (a + d) / 2, (c + e) / 2, d - a, e - c, top + 0.4, 3.0, 1.2, P(0x8a4a38, Surf.RoofTiles), P(0x6c6962, Surf.RoofFlat), 0.1);
    }
    band(b, -R, -R, R, R, fh - 0.1, 0.3, 0.08, trimC, false);
    // courtyard garden
    lawnSlab(b, -r, -r, r, r, 0x5e8d3c, 0.12);
    paveSlab(b, -1.2, -r, 1.2, r, 0xd8d0c0, 0.14);
    paveSlab(b, -r, -1.2, r, 1.2, 0xd8d0c0, 0.14);
    for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]] as [number, number][]) tree(b, rng, x, z, 1.0, 'round');
    fountainTiny(b, 0, 0);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; bush(b, Math.cos(a) * 7.8, Math.sin(a) * 7.8, 0.6, 0x4a7434, i); }
    for (const x of [-15, -6, 6, 15]) { b.paint(0x5a4432).box(x - 0.8, 0.08, 22.2, x + 0.8, 0.11, 23.8, { bottom: null }); tree(b, rng, x, 23, 0.85, 'round'); }
  } else if (v === 1) {
    // U open to the street: garden court with fountain & gate, cream stucco, hipped tile roofs, court balconies
    const col = 0xe8dcc0, fl = 6, top = fl * fh, roof = P(0xa65a3c, Surf.RoofTiles);
    ww(b, -R, -R, R, -r, 0, top, col, 0, fh, null);
    ww(b, -R, -r, -r, R, 0, top, col, 0, fh, null, { nz: null });
    ww(b, r, -r, R, R, 0, top, col, 0, fh, null, { nz: null });
    roofHip(b, 0, (-R - r) / 2, 2 * R, R - r, top, 3.4, roof, { over: 0.5, trim: col });
    roofHip(b, (-R - r) / 2, (R - r) / 2, R - r, R + r, top, 3.4, roof, { over: 0.5, trim: col });
    roofHip(b, (R + r) / 2, (R - r) / 2, R - r, R + r, top, 3.4, roof, { over: 0.5, trim: col });
    band(b, -R, -R, R, R, fh - 0.1, 0.3, 0.08, 0xd0c4a8, false);
    const ys = [fh, 2 * fh, 3 * fh, 4 * fh, 5 * fh];
    balcs(b, 'px', -r, [-4.5, 4.5, 13.5], ys, 2.4, 1.2, 0xf4f0e6, 0xf4f0e6, Surf.Plain, 1.0);
    balcs(b, 'nx', r, [-4.5, 4.5, 13.5], ys, 2.4, 1.2, 0xf4f0e6, 0xf4f0e6, Surf.Plain, 1.0);
    balcs(b, 'pz', -r, [-4.5, 4.5], ys, 2.4, 1.2, 0xf4f0e6, 0xf4f0e6, Surf.Plain, 1.0);
    inFace(b, 'pz', -r, () => door(b, 0, 0.1, 2.0, 2.6, 0x5a3a24, { transom: true, frame: 0xf4f0e6, lamp: true }));
    lawnSlab(b, -r, -r, r, R, 0x5e8d3c, 0.12);
    paveSlab(b, -1.5, -r, 1.5, 24, 0xd8ccae, 0.14);
    paveSlab(b, -r, 4, r, 7, 0xd8ccae, 0.14);
    fountainTiny(b, 0, 5.5);
    for (const [x, z] of [[-5.5, -3], [5.5, -3], [-5.5, 12], [5.5, 12]] as [number, number][]) tree(b, rng, x, z, 1.0, 'round');
    flowerBed(b, -7.5, 8.5, -2.5, 10.5, 0xc4506a); flowerBed(b, 2.5, 8.5, 7.5, 10.5, 0xd9a13c);
    lowWall(b, -r, R - 0.4, -1.8, R, 1.0, 0xe2d4b6, Surf.Plain, 0xa65a3c);
    lowWall(b, 1.8, R - 0.4, r, R, 1.0, 0xe2d4b6, Surf.Plain, 0xa65a3c);
    for (const x of [-15, 15]) { b.paint(0x5a4432).box(x - 0.8, 0.08, 22.2, x + 0.8, 0.11, 23.8, { bottom: null }); tree(b, rng, x, 23, 0.85, 'round'); }
  } else {
    // U open to the back with stepped modern wings, roof gardens, playground court
    const fronts: [number, number, number, number, number][] = [[-R, r, R, R, 7], [-R, -R, -r, r, 6], [r, -R, R, r, 5]];
    const cols = [0xdedcd6, 0xcac6bc, 0xb8b4aa];
    fronts.forEach(([a, c, d, e, n], i) => {
      ww(b, a, c, d, e, 0, n * fh, cols[i], 3 === 3 ? 0 : 0, fh, P(0x5f8a3a, Surf.Foliage), i === 0 ? {} : { pz: null });
      parapet(b, a, c, d, e, n * fh, 0.6, 0.25, 0x9a968e);
    });
    b.paint(0x3a3d42).box(-R + 0.01, 0, R - 0.1, R - 0.01, fh, R + 0.01, { top: null, bottom: null, nz: null, px: null, nx: null });
    lobby(b, -4.5, 4.5, R, 2.9, 0xdedcd6, 0x2a2c2e, 2.0);
    for (let f = 1; f < 7; f++) balcBand(b, 'nz', r, -r, r, f * fh, 1.6, 0xf2f2ee, 0xa8bcc8);
    for (let f = 1; f < 6; f++) balcBand(b, 'px', -r, -R + 1, r - 0.5, f * fh, 1.6, 0xf2f2ee, 0xa8bcc8);
    for (let f = 1; f < 5; f++) balcBand(b, 'nx', r, -R + 1, r - 0.5, f * fh, 1.6, 0xf2f2ee, 0xa8bcc8);
    for (let f = 1; f < 7; f++) balcBand(b, 'pz', R, -R + 1.5, -6, f * fh, 1.2, 0xf2f2ee, 0xa8bcc8);
    for (let f = 1; f < 7; f++) balcBand(b, 'pz', R, 6, R - 1.5, f * fh, 1.2, 0xf2f2ee, 0xa8bcc8);
    lawnSlab(b, -r, -24, r, r, 0x5e8d3c, 0.12);
    playsetMini(b, -3, -6);
    for (const [x, z] of [[4, -2], [5, -12], [-5, -16]] as [number, number][]) tree(b, rng, x, z, 1.0, 'round');
    paveSlab(b, -2, -24, 2, r, 0xd0cabe, 0.14);
    for (const [x, z] of [[-15, -3], [-12, 5], [15, -6]] as [number, number][]) { b.paint(0x4f7a34, Surf.Foliage).blob(x, (x < 0 ? 6 : 5) * fh + 0.9, z, 1.4, 1.0, 1.4, 0, 0.2, x); }
    roofMech(b, rng, -R + 2, r + 2, R - 2, R - 2, 7 * fh, 3, true);
  }
}

function fountainTiny(b: ModelBuilder, x: number, z: number): void {
  b.paint(0xd6cfc0).cylinder(x, z, 0, 0.6, 2.0, 2.0, 12, { top: false, smooth: false });
  b.paint(0x4fa6c9, Surf.Water).cylinder(x, z, 0.5, 0.02, 1.85, 1.85, 12);
  b.paint(0xd6cfc0).cylinder(x, z, 0.5, 1.3, 0.2, 0.15, 6);
}

export const midModelsA = {
  res_walkup: (b: ModelBuilder, v: number, rng: RNG) => { setLot(8, 8, 14); walkup(b, v, rng); },
  res_tenement: (b: ModelBuilder, v: number, rng: RNG) => { setLot(16, 16, 20); tenement(b, v, rng); },
  res_rowhouses: (b: ModelBuilder, v: number, rng: RNG) => { setLot(16, 8, 12); rowhouses(b, v, rng); },
  res_apartment: (b: ModelBuilder, v: number, rng: RNG) => { setLot(16, 16, 22); apartment(b, v, rng); },
  res_condo: (b: ModelBuilder, v: number, rng: RNG) => { setLot(16, 16, 30); condo(b, v, rng); },
  res_courtyard: (b: ModelBuilder, v: number, rng: RNG) => { setLot(24, 24, 25); courtyard(b, v, rng); },
};
