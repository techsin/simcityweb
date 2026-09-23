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
  P, TRIM, inFace, U, fq, win, wins, door, steps, roofGable, roofHip, roofMansard, chimney, lawnSlab, paveSlab, bush,
  bushRow, flowerBed, tree, lowWall, hedgeBox, trashCans, parkedCar, laundry, planter, parapet, flatRoof, setLot, band,
  fireEscape, balcony, bay, capPoly, spread, bandRing, type WinStyle, type Face,
} from './res_util';
import { roofGambrel } from './res_houses';

// ---------------------------------------------------------------------------------------------- local helpers
const ROOF = 0x6c6962;

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
function cornice(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, color: ColorLike, front: Face[] = ['pz'], brackets = true, out = 0.55, roof: ColorLike | null = ROOF): void {
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

/** Sidewalk-ish paved front strip. */
function frontPave(b: ModelBuilder, x0: number, x1: number, z0: number, z1: number, color: ColorLike = 0xc3beb3): void {
  paveSlab(b, x0, z0, x1, z1, color, 0.1);
}

/** Street tree in a small pit on a paved strip. */
function streetTree(b: ModelBuilder, rng: RNG, x: number, z: number, s = 1): void {
  b.paint(0x5a4432).box(x - 0.8, 0.1, z - 0.8, x + 0.8, 0.13, z + 0.8, { bottom: null });
  tree(b, rng, x, z, s, 'round');
}

/** Iron area railing (thin dark panel + top rail). */
function railing(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, h = 1.0, color: ColorLike = 0x1f2224): void {
  b.paint(color, Surf.Metal);
  b.quad2([ax, 0.1, az], [bx, 0.1, bz], [bx, h, bz], [ax, h, az]);
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
    inFace(b, 'nx', x0, () => { b.paint(0xb8a47a); fq(b, U('nx', -4.5), 5.0, U('nx', 2.0), 8.2, 0.03); b.paint(0x7a3a2a); fq(b, U('nx', -3.8), 6.8, U('nx', 1.3), 7.8, 0.04); });
  }
  // ground floor openings: door + stoop at center, windows at pattern columns
  const ws: WinStyle = { frame: trimC, mull: 2, sill: trimC, head: trimC };
  inFace(b, 'pz', z1, () => {
    door(b, 0, 0.9, 1.2, 2.2, [0x3a2a22, 0x2f4a37, 0x6b2a26, 0x2a2a2a, 0x3a2a22, 0x2c3b57][v], { transom: true, frame: trimC, lamp: true });
    for (const x of [-5.5, -3.3, 3.3, 5.5]) win(b, x, 1.0, 0.9, 1.6, ws);
    steps(b, 0, 1.9, 3, 0.3, 0.3, 0xa29c90, 0, Surf.Stone);
  });
  railing(b, -0.95, z1 + 0.9, -0.95, z1 + 0.05, 1.3);
  railing(b, 0.95, z1 + 0.9, 0.95, z1 + 0.05, 1.3);
  if (!sideBlank) {
    wins(b, 'px', x1, [-5.5, -3.3, -1.1, 1.1, 3.3], 1.0, 0.9, 1.6, { frame: trimC, sill: trimC });
    wins(b, 'nx', x0, [-5.5, -3.3, -1.1, 1.1, 3.3], 1.0, 0.9, 1.6, { frame: trimC, sill: trimC });
  }
  wins(b, 'nz', z0, [-5.5, -1.1, 3.3], 1.0, 0.9, 1.6, { frame: trimC });
  // string course over the base
  band(b, x0, z0, x1, z1, fh - 0.15, 0.3, 0.12, trimC, false);
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
    const st = 0xa8a49a, top = 6 * fh, R = 6 * C, r = 2 * C;
    b.paint(P(0x8c887e)).box(-R, 0, -R, R, fh, R, { top: null });
    ww(b, -R, r, R, R, fh, top, st, 1, fh);
    ww(b, -R, -R, R, -r, fh, top, st, 1, fh);
    ww(b, -R, -r, -r, r, fh, top, st, 1, fh, P(ROOF, Surf.RoofFlat), { pz: null, nz: null });
    ww(b, r, -r, R, r, fh, top, st, 1, fh, P(ROOF, Surf.RoofFlat), { pz: null, nz: null });
    // light well floor
    paveSlab(b, -r, -r, r, r, 0x77736a, 0.15);
    laundry(b, rng, [-r, 10, -1], [r, 10, 1], 4);
    laundry(b, rng, [-r, 13, 2], [r, 13, 1], 4);
    inFace(b, 'pz', R, () => {
      door(b, 0, 0.3, 2.0, 2.5, 0x4a3a2e, { transom: true, frame: 0xe0dcd2, lamp: true });
      for (const x of [-12.1, -9.9, -7.7, -5.5, -3.3, 3.3, 5.5, 7.7, 9.9, 12.1]) win(b, x, 0.8, 0.9, 1.6, { frame: 0xe0dcd2, sill: 0xe0dcd2 });
      steps(b, 0, 2.6, 1, 0.3, 0.4, 0x9a968c);
    });
    wins(b, 'px', R, spread(-R, R, 12), 0.8, 0.9, 1.6, { frame: 0xe0dcd2 });
    band(b, -R, -R, R, R, fh - 0.2, 0.35, 0.12, 0x8c887e, false);
    bandRing(b, -R, -R, R, R, top, 0.4, 0.3, 0xc8c4ba);
    b.paint(ROOF, Surf.RoofFlat);
    for (const [a0, c0, a1, c1] of [[-R, r, R, R], [-R, -R, R, -r], [-R, -r, -r, r], [r, -r, R, r]]) b.quad([a0, top + 0.4, c1], [a1, top + 0.4, c1], [a1, top + 0.4, c0], [a0, top + 0.4, c0]);
    for (const [x, z, w, d] of [[-9, 9, 3, 2.5], [8, -9, 3.5, 3], [9, 8, 2.4, 2.4]] as [number, number, number, number][]) bulkhead(b, x, z, w, d, top + 0.4, 2.4, 0x8c887e);
    rooftopWaterTank(b, -9, top + 0.4, -9, 1.0);
    for (const [x, z] of [[-4, 10.5], [4, -10.5], [-10.5, -2]] as [number, number][]) acUnit(b, x, top + 0.4, z);
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
    lowWall(b, -2 * C, 12.9, -1.2, 13.2, 1.1, 0x1f2224, Surf.Metal, 0x1f2224);
    lowWall(b, 1.2, 12.9, 2 * C, 13.2, 1.1, 0x1f2224, Surf.Metal, 0x1f2224);
    inFace(b, 'pz', -1 * C, () => { door(b, 0, 0.1, 1.8, 2.5, 0x2f4a37, { transom: true, frame: trimC, lamp: true }); b.paint(0x2f4a37).box(-1.6, 2.9, 0, 1.6, 3.05, 1.2, { nz: null }); });
    for (const x of [-4 * C, 4 * C]) cornice(b, x - 2 * C, -1 * C, x + 2 * C, 6 * C, top, 0xe6dcc6, ['pz'], true, 0.45);
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
    const stone = P(0x6e4a3a, Surf.Stone), trimC = 0x8a6a58;
    for (let i = 0; i < 4; i++) {
      const xa = -14 + i * 7, xb = xa + 7, du = i % 2 === 0 ? xa + 1.6 : xb - 1.6;
      const side = { px: i === 3 ? undefined : null, nx: i === 0 ? undefined : null };
      b.paint(P(0x5e4032, Surf.Stone)).box(xa, 0, z0, xb, 1.8, z1, { top: null, ...side });
      b.paint(stone).box(xa, 1.8, z0, xb, 11.1, z1, { top: P(ROOF, Surf.RoofFlat), ...side });
      cornice(b, xa, z0, xb, z1, 11.1, i % 2 === 0 ? 0x2e2a28 : 0x4a3e36, ['pz'], true, 0.5);
      const ws: WinStyle = { frame: 0x3a2a22, mull: 1, sill: trimC, head: trimC };
      inFace(b, 'pz', z1, () => {
        door(b, du, 1.8, 1.2, 2.6, 0x3a2418, { surf: Surf.Wood, transom: true, frame: trimC, lamp: false });
        const wx = i % 2 === 0 ? [xa + 3.9, xa + 5.7] : [xa + 1.3, xa + 3.1];
        for (const x of wx) win(b, x, 2.4, 1.0, 2.3, ws);
        for (const x of [xa + 1.4, xa + 3.5, xa + 5.6]) { win(b, x, 5.9, 0.95, 1.9, ws); win(b, x, 8.8, 0.95, 1.7, ws); }
        for (const x of wx) win(b, x, 0.3, 0.9, 1.0, { frame: 0x2a2a2a });
        steps(b, du, 1.7, 6, 0.3, 0.33, 0x6a4a3a, 0, Surf.Stone);
      });
      for (const s of [-1, 1]) railing(b, du + s * 0.9, z1 + 2.0, du + s * 0.9, z1 + 0.1, 2.4, 0x1c1c1c);
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
    const stucco = P(0xefebe2), brick = P(0xb89a6a, Surf.Brick), iron = 0x1c1c1c;
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
        door(b, du, 0.6, 1.1, 2.4, [0x1c1c1c, 0x2c3b57, 0x7e2a26, 0x2f4a37][i], { transom: true, frame: 0xf6f2e8 });
        for (const x of wxs) win(b, x, 0.9, 1.0, 2.2, { frame: 0xf6f2e8, mull: 2 });
        for (const x of [xa + 1.5, xa + 3.5, xa + 5.5]) { win(b, x, 4.6, 1.0, 2.1, { frame: 0xf6f2e8, mull: 2, sill: 0xf6f2e8 }); win(b, x, 7.4, 0.95, 1.5, { frame: 0xf6f2e8, mull: 2, sill: 0xf6f2e8 }); }
        steps(b, du, 1.8, 2, 0.3, 0.35, 0xe0dcd2);
      });
      // balcony railing on first floor
      b.paint(0xf6f2e8).box(xa + 0.3, 4.4, z1, xb - 0.3, 4.55, z1 + 0.5, { nz: null });
      b.paint(iron, Surf.Metal).quad2([xa + 0.3, 4.55, z1 + 0.48], [xb - 0.3, 4.55, z1 + 0.48], [xb - 0.3, 5.4, z1 + 0.48], [xa + 0.3, 5.4, z1 + 0.48]);
      // portico
      b.paint(0xf6f2e8).box(du - 1.0, 3.0, z1, du + 1.0, 3.3, z1 + 1.4, { nz: null });
      for (const s of [-1, 1]) b.paint(0xf6f2e8).cylinder(du + s * 0.8, z1 + 1.2, 0.6, 2.4, 0.13, 0.12, 6, { top: false });
      const dx = (xa + xb) / 2;
      b.paint(0x4a5058).box(dx - 0.7, 10.6, z1 - 1.7, dx + 0.7, 11.8, z1 - 0.6, { bottom: null });
      inFace(b, 'pz', z1 - 0.6, () => win(b, dx, 10.7, 0.7, 0.9, { frame: 0xf6f2e8 }));
      railing(b, xa + 0.2, 7.0, du - 0.9, 7.0, 1.1, iron);
      railing(b, du + 0.9, 7.0, xb - 0.2, 7.0, 1.1, iron);
      wins(b, 'nz', z0, [xa + 2, xa + 5], 1.0, 1.0, 2.0, { frame: 0xf6f2e8 });
      wins(b, 'nz', z0, [xa + 2, xa + 5], 4.6, 1.0, 1.9, { frame: 0xf6f2e8 });
      if (i > 0) chimney(b, xa, -1.5, 0.9, 2.0, 11.8, 12.6, 0xb89a6a);
    }
    for (const x of [-7, 7]) streetTree(b, rng, x, 7.2, 0.8);
  } else if (v === 2) {
    // Boston bow-fronts: red brick, rounded full-height bows, black shutters, flat roofs
    const brick = P(0x8f4a38, Surf.Brick), trimC = 0xe8e2d4;
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
      bandRing(b, xa, z0, xb, z1, 10.4, 0.45, 0.35, trimC, ROOF);
      parapet(b, xa, z0, xb, z1, 10.85, 0.5, 0.2, 0x8f4a38);
      const du = xa + 1.4;
      inFace(b, 'pz', z1, () => {
        door(b, du, 1.2, 1.1, 2.4, 0x1c1c1c, { transom: true, frame: trimC, lamp: true });
        win(b, du, 5.0, 0.95, 1.8, { frame: trimC, mull: 2, shutter: 0x1c1c1c });
        win(b, du, 8.0, 0.95, 1.8, { frame: trimC, mull: 2, shutter: 0x1c1c1c });
        steps(b, du, 1.6, 4, 0.3, 0.3, 0x9a948a, 0, Surf.Stone);
      });
      for (const s of [-1, 1]) railing(b, du + s * 0.85, z1 + 1.2, du + s * 0.85, z1 + 0.1, 1.8);
      wins(b, 'nz', z0, [xa + 2.5, xb - 2.5], 1.9, 1.0, 1.9, { frame: trimC });
      wins(b, 'nz', z0, [xa + 2.5, xb - 2.5], 5.0, 1.0, 1.8, { frame: trimC });
      chimney(b, xb - 0.5, -3.5, 0.9, 1.4, 10.4, 12.2, 0x8f4a38);
      lowWall(b, bx - br, z1 + 1.35, bx + br, z1 + 1.45, 0.9, 0x1c1c1c, Surf.Metal, 0x1c1c1c);
    }
    wins(b, 'px', 14, [-4.5, -1.5], 5.0, 1.0, 1.8, { frame: trimC });
    wins(b, 'nx', -14, [-4.5, -1.5], 5.0, 1.0, 1.8, { frame: trimC });
    for (const x of [-9, 6]) streetTree(b, rng, x, 7.2, 0.8);
  } else if (v === 3) {
    // San Francisco "painted ladies": pastel Victorians, 2-storey angled bays, ornate front gables
    const cols = [0xa9c2d4, 0xe8d49a, 0xb5d1b8, 0xe2b8b8], trims = [0xf4f0e6, 0x5a3a4a, 0xf4f0e6, 0x3e5a6a];
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
      railing(b, xb - 2.1, z1 + 1.6, xb - 2.1, z1 + 0.1, 2.2, tr);
    }
    wins(b, 'px', 14, [-4.5, -1.5], 5.3, 0.9, 1.7, { frame: 0x3e5a6a });
    wins(b, 'nx', -14, [-4.5, -1.5], 5.3, 0.9, 1.7, { frame: 0xf4f0e6 });
    for (const x of [-7, 7]) streetTree(b, rng, x, 7.2, 0.75);
  } else if (v === 4) {
    // Bath / Georgian terrace in honey limestone: parapet, entablature, fanlit doors, area railings
    const stone = P(0xd8c49a, Surf.Stone), trimC = 0xe8dcc0;
    b.paint(P(0xc8b48a, Surf.Stone)).box(-14, 0, z0, 14, 1.0, z1, { top: null });
    b.paint(stone).box(-14, 1.0, z0, 14, 10.2, z1, { top: P(ROOF, Surf.RoofFlat) });
    band(b, -14, z0, 14, z1, 3.9, 0.3, 0.1, trimC, false);
    bandRing(b, -14, z0, 14, z1, 9.6, 0.6, 0.35, trimC, ROOF);
    parapet(b, -14, z0, 14, z1, 10.2, 0.9, 0.25, 0xd8c49a, trimC);
    for (let i = 0; i < 4; i++) {
      const xa = -14 + i * 7, du = xa + (i % 2 === 0 ? 1.5 : 5.5);
      inFace(b, 'pz', z1, () => {
        door(b, du, 1.0, 1.1, 2.4, [0x2f4a37, 0x7e2a26, 0x2c3b57, 0xa8823a][i], { transom: true, frame: 0xf2ead8 });
        for (const x of (i % 2 === 0 ? [xa + 3.6, xa + 5.6] : [xa + 1.4, xa + 3.4])) win(b, x, 1.4, 1.0, 2.0, { frame: 0xf6f2e8, mull: 3 });
        for (const x of [xa + 1.5, xa + 3.5, xa + 5.5]) { win(b, x, 4.5, 1.0, 2.3, { frame: 0xf6f2e8, mull: 3, head: trimC }); win(b, x, 7.6, 1.0, 1.5, { frame: 0xf6f2e8, mull: 3 }); }
        steps(b, du, 1.6, 3, 0.33, 0.33, 0xc8b48a, 0, Surf.Stone);
      });
      b.paint(0x1c1c1c, Surf.Metal).box(du - 0.6, 3.7, z1, du + 0.6, 3.75, z1 + 0.4, { nz: null });
      if (i > 0) chimney(b, xa, -1.5, 1.0, 2.4, 10.2, 11.8, 0xd8c49a, Surf.Stone);
      wins(b, 'nz', z0, [xa + 2, xa + 5], 1.4, 1.0, 2.0, { frame: 0xf6f2e8 });
      wins(b, 'nz', z0, [xa + 2, xa + 5], 4.5, 1.0, 2.2, { frame: 0xf6f2e8 });
    }
    railing(b, -14, 6.8, 14, 6.8, 1.1);
    for (let i = 0; i < 4; i++) bush(b, -12.5 + i * 7 + (i % 2 ? -1.0 : 4.0), 5.3, 0.55, 0x3f6a2d, i);
    for (const x of [-7, 7]) streetTree(b, rng, x, 7.3, 0.8);
  } else {
    // Amsterdam canal houses: 5 narrow brick houses with step / neck / bell gables and hoist beams
    const cols = [0x5a3a2e, 0x7a4032, 0x3e3a38, 0x8a5a3e, 0x6a4a3a];
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
        door(b, xa + 1.3, 0.6, 1.0, 2.3, [0x2f4a37, 0x1c1c1c, 0x7e2a26, 0x2c3b57, 0x2f4a37][i], { transom: true, frame: tr });
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

export const midModelsA = {
  res_walkup: (b: ModelBuilder, v: number, rng: RNG) => { setLot(8, 8, 14); walkup(b, v, rng); },
  res_tenement: (b: ModelBuilder, v: number, rng: RNG) => { setLot(16, 16, 20); tenement(b, v, rng); },
  res_rowhouses: (b: ModelBuilder, v: number, rng: RNG) => { setLot(16, 8, 12); rowhouses(b, v, rng); },
};
void [TRIM, roofHip, roofGambrel, lawnSlab, bushRow, flowerBed, hedgeBox, parkedCar, planter, flatRoof, balcony, spread];
