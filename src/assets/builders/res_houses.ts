/**
 * Residential low-density models: shack, cottage, townhouse row, suburban, ranch, villa, mansion.
 * (owned by the residential asset agent)
 */
import type { ModelBuilder, ColorLike, Paint } from '../ModelBuilder';
import type { RNG } from '../../core/rng';
import { Surf } from '../../core/types';
import {
  P, TRIM, LAWN, LAWN_LUSH, LAWN_DRY, DIRT, CONCRETE, FLOWERS,
  inFace, U, fq, win, wins, door, garageDoor, steps, roofGable, roofHip, roofShed, dormer, chimney,
  lawnSlab, paveSlab, bush, bushRow, flowerBed, tree, picket, boardFence, chainFence, lowWall, hedgeBox, mailbox,
  trampoline, gardenShed, playset, grill, patioSet, lounger, poolRect, acBox, trashCans, propaneTank, satDish, parkedCar,
  laundry, planter, parapet, flatRoof, setLot, band, type WinStyle,
} from './res_util';

// ---------------------------------------------------------------------------------------------- local helpers
/** Walls box (no top/bottom) on an optional foundation plinth. */
export function body(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, fy: number, y1: number, wall: Paint, found: ColorLike = 0x8d8880): void {
  if (fy > 0) b.paint(found, Surf.Plain).box(x0 - 0.06, 0, z0 - 0.06, x1 + 0.06, fy, z1 + 0.06, { top: null });
  b.paint(wall).box(x0, fy, z0, x1, y1, z1, { top: null, bottom: null });
}

/** Gambrel (barn) roof, ridge along x. */
export function roofGambrel(b: ModelBuilder, cx: number, cz: number, w: number, d: number, y0: number, h: number, roof: Paint, gable: Paint, over = 0.35, trim: ColorLike = TRIM): void {
  const half = d / 2;
  const xa = cx - w / 2 - 0.25, xb = cx + w / 2 + 0.25;
  const zk = half * 0.62, yk = y0 + h * 0.62, yr = y0 + h;
  const ze = half + over, ye = y0 - over * (yk - y0) / (half - zk);
  b.paint(roof);
  // front lower, front upper, back upper, back lower
  b.quad([xa, ye, cz + ze], [xb, ye, cz + ze], [xb, yk, cz + zk], [xa, yk, cz + zk]);
  b.quad([xa, yk, cz + zk], [xb, yk, cz + zk], [xb, yr, cz], [xa, yr, cz]);
  b.quad([xb, yk, cz - zk], [xa, yk, cz - zk], [xa, yr, cz], [xb, yr, cz]);
  b.quad([xb, ye, cz - ze], [xa, ye, cz - ze], [xa, yk, cz - zk], [xb, yk, cz - zk]);
  b.paint(trim);
  for (const x of [xa, xb]) {
    const s = x === xb ? 1 : -1;
    const pts: [number, number][] = [[cz + ze, ye], [cz + zk, yk], [cz, yr], [cz - zk, yk], [cz - ze, ye]];
    for (let i = 0; i < 4; i++) {
      const [za, ya] = pts[i], [zb, yb] = pts[i + 1];
      if (s > 0) b.quad([x, ya - 0.14, za], [x, yb - 0.14, zb], [x, yb, zb], [x, ya, za]);
      else b.quad([x, ya, za], [x, yb, zb], [x, yb - 0.14, zb], [x, ya - 0.14, za]);
    }
  }
  b.paint(gable);
  const gz = half, gk = half * 0.62 * (half / (half + 0.0001));
  for (const s of [1, -1]) {
    const x = cx + s * w / 2;
    const A: [number, number, number] = [x, y0, cz + gz], B: [number, number, number] = [x, yk - 0.05, cz + gk * 0.98], C: [number, number, number] = [x, yr - 0.05, cz];
    const D: [number, number, number] = [x, yk - 0.05, cz - gk * 0.98], E: [number, number, number] = [x, y0, cz - gz];
    if (s > 0) { b.tri(A, E, D); b.tri(A, D, C); b.tri(A, C, B); }
    else { b.tri(E, A, B); b.tri(E, B, C); b.tri(E, C, D); }
  }
}

/** Covered porch across the front of a wall at zw (front +z). */
export function porch(
  b: ModelBuilder, x0: number, x1: number, zw: number, dp: number, fy: number, yTop: number, roof: Paint,
  o: { deck?: ColorLike; post?: ColorLike; posts?: number; rail?: ColorLike | null; gap?: [number, number]; postW?: number; kind?: 'shed' | 'gable' | 'flat'; pier?: ColorLike } = {},
): void {
  const deck = o.deck ?? 0x9a8670;
  b.paint(deck, Surf.Wood).box(x0, 0, zw, x1, fy, zw + dp, { nz: null });
  const n = o.posts ?? 3, pw = o.postW ?? 0.18;
  const zp = zw + dp - 0.2;
  const yl = yTop - 0.35;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? (x0 + x1) / 2 : x0 + 0.2 + (i / (n - 1)) * (x1 - x0 - 0.4);
    if (o.pier) {
      b.paint(o.pier, Surf.Stone).box(x - pw * 1.3, fy, zp - pw * 1.3, x + pw * 1.3, fy + 0.9, zp + pw * 1.3, { bottom: null });
      b.paint(o.post ?? TRIM).box(x - pw, fy + 0.9, zp - pw, x + pw * 0.8, yl, zp + pw * 0.8, { bottom: null, top: null });
    } else b.paint(o.post ?? TRIM).box(x - pw / 2, fy, zp - pw / 2, x + pw / 2, yl, zp + pw / 2, { bottom: null, top: null });
  }
  if (o.rail !== null) {
    b.paint(o.rail ?? TRIM, Surf.Corrugated);
    const g = o.gap;
    const segs: [number, number][] = g ? [[x0 + 0.1, g[0]], [g[1], x1 - 0.1]] : [[x0 + 0.1, x1 - 0.1]];
    for (const [a, c] of segs) if (c - a > 0.3) b.quad2([a, fy, zp], [c, fy, zp], [c, fy + 0.85, zp], [a, fy + 0.85, zp]);
  }
  const kind = o.kind ?? 'shed';
  if (kind === 'shed') roofShed(b, (x0 + x1) / 2, zw + dp / 2, x1 - x0, dp, yl, 0.35, 'nz', roof, { over: 0.3, rake: 0.15, t: 0.14 });
  else if (kind === 'flat') {
    b.paint(roof.color, Surf.Plain).box(x0 - 0.15, yl, zw, x1 + 0.15, yl + 0.3, zw + dp + 0.2, { bottom: null, nz: null });
  } else {
    b.paint(o.post ?? TRIM).box(x0, yl, zw, x1, yl + 0.2, zw + dp, { bottom: null, nz: null, top: null });
    roofGable(b, (x0 + x1) / 2, zw + dp / 2, x1 - x0, dp + 0.4, yl + 0.2, (x1 - x0) * 0.32, 'z', roof, { over: 0.25, rake: 0.2, gable: P(o.post ?? TRIM) });
  }
}

const shutterWin = (shutter: ColorLike, frame: ColorLike = TRIM): WinStyle => ({ frame, shutter, sill: frame, mull: 2 });

// ---------------------------------------------------------------------------------------------- SHACK
function shack(b: ModelBuilder, v: number, rng: RNG): void {
  // patchy dry yard
  lawnSlab(b, -8, -8, 8, 8, v === 1 ? 0x8f9656 : LAWN_DRY);
  b.paint(DIRT, Surf.Pavement);
  for (let i = 0; i < 5; i++) {
    const x = rng.range(-6, 6), z = rng.range(-6, 6), s = rng.range(1.2, 2.6);
    b.box(x - s, 0, z - s * 0.7, x + s, 0.075, z + s * 0.7, { bottom: null });
  }
  if (v === 0) {
    // weathered plank shack w/ rusty corrugated shed roof and lean-to porch
    b.paint(0x77716a).box(-3.2, 0, -3.7, 3.2, 0.35, 0.7, { top: null }); // cinder blocks
    body(b, -3, -3.5, 3, 0.5, 0.35, 2.7, P(0x857462, Surf.Wood));
    roofShed(b, 0, -1.5, 6, 4, 2.7, 0.55, 'nz', P(0x8b5a3a, Surf.Corrugated), { over: 0.4, rake: 0.3, t: 0.08, trim: 0x6a4a34, fill: P(0x857462, Surf.Wood) });
    // front stoop + tin lean-to
    b.paint(0x8a7a66, Surf.Wood).box(-2.4, 0, 0.5, 0.4, 0.35, 2.2, { nz: null });
    b.paint(0x5a4a3a, Surf.Wood).box(-2.3, 0.35, 2.0, -2.15, 2.2, 2.15, { bottom: null }).box(0.15, 0.35, 2.0, 0.3, 2.2, 2.15, { bottom: null });
    roofShed(b, -1, 1.35, 2.8, 1.7, 2.1, 0.35, 'nz', P(0x9a9a92, Surf.Corrugated), { over: 0.2, rake: 0.1, t: 0.05, trim: 0x707070 });
    inFace(b, 'pz', 0.5, () => {
      door(b, -1.0, 0.35, 0.85, 1.95, 0x5c4a38, { frame: 0x4a3c2e, surf: Surf.Wood });
      win(b, 1.6, 1.1, 0.9, 0.8, { frame: 0x5a4a3a });
    });
    inFace(b, 'px', 3, () => {
      win(b, U('px', -1.5), 1.1, 0.8, 0.8, { frame: 0x5a4a3a });
      // boarded window
      b.paint(0x9a8a70, Surf.Wood);
      fq(b, U('px', -2.8) - 0.5, 1.0, U('px', -2.8) + 0.5, 2.0, 0.08);
    });
    wins(b, 'nx', -3, [-1.5], 1.1, 0.8, 0.8, { frame: 0x5a4a3a });
    // blue tarp + mismatched patch on the roof
    const ry = (z: number) => 2.7 + (0.5 - z) * (0.55 / 4) + 0.06;
    b.paint(0x2a4a7a).quad([-1.4, ry(-0.4), -0.4], [1.2, ry(-0.4), -0.4], [1.3, ry(-2.9), -2.9], [-1.3, ry(-2.9), -2.9]);
    b.paint(0x9a9a92, Surf.Corrugated).quad([1.6, ry(-1.8), -1.8], [2.9, ry(-1.8), -1.8], [2.9, ry(-3.3), -3.3], [1.6, ry(-3.3), -3.3]);
    // stovepipe
    b.paint(0x3a3a3a, Surf.Metal).cylinder(2.0, -2.6, 2.9, 1.6, 0.12, 0.12, 6);
    // yard junk + rusty car
    parkedCar(b, rng, 5.2, 3.6, 0.2, 0x7a4b36, 0.05);
    b.paint(0x2a2a2a).cylinder(-5.6, 3.5, 0, 0.25, 0.4, 0.4, 8).cylinder(-5.3, 3.9, 0.25, 0.25, 0.4, 0.4, 8);
    b.paint(0x4a6a8a, Surf.Metal).cylinder(-4.8, -4.8, 0, 0.9, 0.3, 0.3, 6);
    b.paint(0x8a5a3a, Surf.Metal).cylinder(-4.1, -5.2, 0, 0.9, 0.3, 0.3, 6);
    b.paint(0xd8d4c8).box(4.2, 0, -5.8, 4.9, 0.9, -5.1, { bottom: null });
    // sagging fence with gaps
    boardFence(b, -7.6, 7.2, -3.0, 7.2, 1.1, 0x7a6a58);
    boardFence(b, 1.5, 7.2, 3.6, 7.2, 1.0, 0x6e604f);
    boardFence(b, -7.6, 7.2, -7.6, -2, 1.1, 0x7a6a58);
    laundry(b, rng, [-6.5, 1.9, -1.5], [-6.5, 1.9, -6.5], 3);
    b.paint(0x5a4a3a, Surf.Wood).box(-6.58, 0, -1.58, -6.42, 1.95, -1.42).box(-6.58, 0, -6.58, -6.42, 1.95, -6.42);
    tree(b, rng, 5.5, -5.2, 0.9, 'round', 0x6a7a3a);
  } else if (v === 1) {
    // single-wide trailer home
    const x0 = -6.6, x1 = 6.0, z0 = -3.9, z1 = -0.3;
    b.paint(0x8e8b84).box(x0 + 0.2, 0, z0 + 0.1, x1 - 0.2, 0.62, z1 - 0.1, { top: null });
    body(b, x0, z0, x1, z1, 0.6, 3.0, P(0xe2ddcf, Surf.Corrugated));
    b.paint(0x6d8a9a).box(x0 - 0.02, 1.85, z0 - 0.02, x1 + 0.02, 2.05, z1 + 0.02, { top: null, bottom: null });
    b.paint(0xc9c6bc, Surf.Metal).box(x0 - 0.1, 3.0, z0 - 0.1, x1 + 0.1, 3.12, z1 + 0.1, { bottom: null });
    b.paint(0xc9c6bc, Surf.Metal).gableRoof((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 + 0.2, z1 - z0 + 0.2, 3.12, 0.25, 'x', 0.02);
    const ws: WinStyle = { frame: 0xb8bcc0, ft: 0.06 };
    wins(b, 'pz', z1, [-5.2, -2.6, 2.6, 4.8], 1.35, 1.0, 0.85, ws);
    wins(b, 'nz', z0, [-4.5, -1.0, 3.2], 1.35, 1.0, 0.85, ws);
    wins(b, 'px', x1, [-2.1], 1.35, 0.9, 0.85, ws);
    inFace(b, 'pz', z1, () => door(b, 0.2, 0.62, 0.85, 1.95, 0xd8d4c6, { frame: 0xb8bcc0, lite: true, lamp: true }));
    // deck + steps + awning
    b.paint(0x8f7c66, Surf.Wood).box(-1.4, 0, z1, 1.8, 0.6, z1 + 2.2, { nz: null });
    inFace(b, 'pz', z1 + 2.2, () => steps(b, 0.2, 1.1, 2, 0.3, 0.3, 0x8f7c66, 0, Surf.Wood));
    b.paint(0xd8d8d0, Surf.Metal).box(-1.6, 2.55, z1, 2.0, 2.62, z1 + 2.3, { nz: null });
    b.paint(0xb0b0b0, Surf.Metal).box(1.85, 0.6, z1 + 2.15, 1.95, 2.55, z1 + 2.25).box(-1.55, 0.6, z1 + 2.15, -1.45, 2.55, z1 + 2.25);
    propaneTank(b, -7.2, -2.0);
    satDish(b, 4.5, 3.1, -1.5, 0.8);
    // lawn chairs & grill
    b.paint(0x3d8a5a).box(-3.8, 0, 1.6, -3.2, 0.45, 2.2, { bottom: null }).box(-3.0, 0, 1.8, -2.4, 0.45, 2.4, { bottom: null });
    grill(b, 3.2, 1.5);
    // gravel pad + pickup-ish car
    paveSlab(b, 3.6, 1.2, 7.6, 8, 0x9a948a, 0.07);
    parkedCar(b, rng, 5.6, 4.6, 0, 0x8a2b24);
    chainFence(b, -7.7, 7.4, 3.2, 7.4, 1.2);
    chainFence(b, -7.7, 7.4, -7.7, -7.6, 1.2);
    tree(b, rng, -5.8, -6.2, 0.9, 'round');
    trashCans(b, -6.6, 0.6, 2);
  } else if (v === 2) {
    // tar-paper cabin w/ low gable and patched lean-to
    b.paint(0x6e6a64).box(-3.9, 0, -3.1, 1.9, 0.3, 1.3, { top: null });
    body(b, -3.8, -3.0, 1.8, 1.2, 0.3, 2.6, P(0x6e6356, Surf.Wood));
    roofGable(b, -1.0, -0.9, 5.6, 4.2, 2.6, 1.1, 'x', P(0x3a3b3d, Surf.RoofTiles), { over: 0.3, rake: 0.2, t: 0.1, trim: 0x4a4540, gable: P(0x6e6356, Surf.Wood) });
    // lean-to in different boards
    body(b, 1.8, -2.4, 4.6, 0.8, 0.0, 2.3, P(0x93846e, Surf.Wood));
    roofShed(b, 3.2, -0.8, 2.8, 3.2, 2.0, 0.45, 'nx', P(0x8f928c, Surf.Corrugated), { over: 0.25, rake: 0.2, t: 0.05, trim: 0x707070, fill: P(0x93846e, Surf.Wood) });
    inFace(b, 'pz', 1.2, () => {
      door(b, -2.4, 0.3, 0.85, 1.95, 0x4a3c2e, { frame: 0x3a3028, surf: Surf.Wood });
      win(b, -0.3, 1.1, 0.9, 0.9, { frame: 0x3a3028, mull: 2 });
    });
    wins(b, 'pz', 0.8, [3.4], 1.0, 0.7, 0.6, { frame: 0x5a4a3a });
    wins(b, 'nx', -3.8, [-0.9], 1.1, 0.8, 0.8, { frame: 0x3a3028 });
    inFace(b, 'pz', 1.2, () => steps(b, -2.4, 1.0, 1, 0.3, 0.35, 0x77716a));
    chimney(b, -3.0, -2.2, 0.6, 0.6, 2.6, 4.3, 0x8a7a6a, Surf.Stone);
    // tar-paper patches on the roof
    b.paint(0x55504a).quad([-3.0, 2.6 + 0.45 * (1.1 / 2.1) + 0.05, 0.75], [-1.8, 2.6 + 0.45 * (1.1 / 2.1) + 0.05, 0.75], [-1.8, 2.6 + 1.2 * (1.1 / 2.1) + 0.05, 0.0], [-3.0, 2.6 + 1.2 * (1.1 / 2.1) + 0.05, 0.0]);
    // outhouse-style shed & wood pile
    gardenShed(b, 5.6, -5.6, 1.5, 1.5, 0x7a6a56, 0x5a5a58, 0.1);
    b.paint(0x7a5a3c, Surf.Wood);
    for (let i = 0; i < 4; i++) b.push().translate(-6.2, 0.2 + i * 0.32, -4.5).rotateX(Math.PI / 2).cylinder(0, 0, -1.2, 2.4, 0.18, 0.18, 6, { top: true, bottom: true }).pop();
    // junk car on blocks + tires
    parkedCar(b, rng, -4.8, 4.2, Math.PI / 2 + 0.15, 0x4e5a52, 0.18);
    b.paint(0x1f1f1f).cylinder(3.6, 4.9, 0, 0.25, 0.4, 0.4, 8).cylinder(4.3, 5.4, 0, 0.25, 0.4, 0.4, 8);
    b.paint(0xc6c2b6).box(2.0, 0, 4.2, 3.9, 0.45, 5.0, { bottom: null }).box(2.0, 0.45, 4.2, 3.9, 0.95, 4.45, { bottom: null });
    chainFence(b, -7.7, 7.3, -1.8, 7.3, 1.2);
    chainFence(b, 0.8, 7.3, 7.7, 7.3, 1.2);
    chainFence(b, 7.7, 7.3, 7.7, -2.0, 1.2);
    tree(b, rng, 6.0, 1.0, 1.0, 'cone');
    tree(b, rng, -6.2, -1.2, 0.8, 'round', 0x6d7f3c);
  } else {
    // cinder-block bungalow, faded mint stucco, flat roof, barred windows
    const x0 = -3.8, x1 = 3.8, z0 = -4.0, z1 = 1.4;
    body(b, x0, z0, x1, z1, 0.2, 3.0, P(0xa7bba9), 0x7e7a72);
    b.paint(0x77736a, Surf.RoofFlat).quad([x0, 3.0, z1], [x1, 3.0, z1], [x1, 3.0, z0], [x0, 3.0, z0]);
    parapet(b, x0, z0, x1, z1, 3.0, 0.45, 0.2, 0xa0b3a2, 0xc2c6bb);
    // awning over the door
    b.paint(0x9aa0a0, Surf.Corrugated).box(-2.8, 2.35, z1, -0.2, 2.42, z1 + 1.3, { nz: null });
    b.paint(0x777777, Surf.Metal).box(-2.75, 0, z1 + 1.2, -2.65, 2.35, z1 + 1.3).box(-0.35, 0, z1 + 1.2, -0.25, 2.35, z1 + 1.3);
    paveSlab(b, -3.0, z1, 0.0, z1 + 1.6, 0x9a968c, 0.12);
    const barred = (x: number) => {
      win(b, x, 1.0, 1.1, 1.0, { frame: 0xd8d8d0 });
      b.paint(0x2a2a2a, Surf.Metal);
      for (let i = -2; i <= 2; i++) fq(b, x + i * 0.22 - 0.025, 1.0, x + i * 0.22 + 0.025, 2.0, 0.13);
    };
    inFace(b, 'pz', z1, () => {
      door(b, -1.5, 0.2, 0.9, 2.0, 0x8a4a3a, { frame: 0xd8d8d0 });
      barred(1.8);
    });
    inFace(b, 'px', x1, () => { barred(U('px', -1.2)); });
    inFace(b, 'nx', x0, () => { barred(U('nx', -1.5)); });
    inFace(b, 'nz', z0, () => { barred(U('nz', 1.5)); });
    acBox(b, x1 + 0.45, -2.8, 1.2);
    satDish(b, 2.8, 3.0, -3.0, 0.9);
    // old sofa in the yard & car on dirt
    b.paint(0x7a5a4a).box(-6.8, 0, 2.6, -4.8, 0.45, 3.5, { bottom: null }).box(-6.8, 0.45, 2.6, -4.8, 0.95, 2.9, { bottom: null });
    paveSlab(b, 4.4, -2.0, 7.6, 8.0, 0x8a7a60, 0.075);
    parkedCar(b, rng, 6.0, 2.6, Math.PI, 0x5a6878);
    chainFence(b, -7.7, 7.4, -2.2, 7.4, 1.3);
    chainFence(b, -0.6, 7.4, 3.9, 7.4, 1.3);
    chainFence(b, -7.7, 7.4, -7.7, -7.7, 1.3);
    chainFence(b, -7.7, -7.7, 7.7, -7.7, 1.3);
    trashCans(b, -5.8, -2.6, 3, 0x3b4a5a);
    tree(b, rng, -5.5, -5.5, 1.0, 'round', 0x7b8a3c);
    bush(b, 5.8, -6.0, 1.0, 0x6b7a3a, 3);
  }
}

// ---------------------------------------------------------------------------------------------- COTTAGE
function cottage(b: ModelBuilder, v: number, rng: RNG): void {
  lawnSlab(b, -8, -8, 8, 8, LAWN);
  if (v === 0) {
    // classic side-gable cottage, white siding, porch on the left half
    const wall = P(0xeeeae0, Surf.Wood);
    body(b, -4.5, -4.8, 4.5, 1.8, 0.45, 3.2, wall);
    roofGable(b, 0, -1.5, 9, 6.6, 3.2, 2.7, 'x', P(0x4a4d52, Surf.RoofTiles), { gable: wall });
    porch(b, -4.3, 0.7, 1.8, 2.1, 0.45, 3.1, P(0x4a4d52, Surf.RoofTiles), { posts: 3, gap: [-1.9, -0.5] });
    inFace(b, 'pz', 1.8, () => {
      door(b, -1.2, 0.45, 0.95, 2.1, 0x8a2e2a, { lite: true, lamp: true });
      win(b, -3.2, 1.2, 1.1, 1.35, { mull: 2, sill: TRIM });
      win(b, 2.6, 1.2, 1.7, 1.35, { mull: 3, sill: TRIM, shutter: 0x2f3e52 });
    });
    wins(b, 'px', 4.5, [-3.2, -0.2], 1.2, 1.0, 1.3, { mull: 2, sill: TRIM });
    wins(b, 'nx', -4.5, [-3.2, -0.2], 1.2, 1.0, 1.3, { mull: 2, sill: TRIM });
    wins(b, 'nz', -4.8, [-2.5, 2.5], 1.2, 1.0, 1.3, { mull: 2 });
    chimney(b, 3.2, -2.6, 0.8, 0.8, 3.0, 6.4);
    inFace(b, 'pz', 3.9, () => steps(b, -1.2, 1.4, 2, 0.225, 0.3, 0x9a8670, 0, Surf.Wood));
    paveSlab(b, -1.8, 4.4, -0.6, 8.0, 0xc8c2b4, 0.08);
    flowerBed(b, 0.9, 1.9, 4.4, 2.6, 0xc4506a);
    picket(b, -7.6, 7.0, -1.9, 7.0);
    picket(b, -0.5, 7.0, 7.6, 7.0);
    picket(b, -7.6, 7.0, -7.6, -1.0);
    picket(b, 7.6, 7.0, 7.6, -1.0);
    hedgeBox(b, -7.8, -7.8, 7.8, -7.0, 1.3);
    tree(b, rng, 5.6, -5.6, 1.1, 'round');
    bush(b, -6.2, 1.2, 0.9, 0x4a7434, 2);
    bush(b, 6.0, 3.8, 0.8, 0x557f35, 5);
    mailbox(b, -2.4, 7.5);
  } else if (v === 1) {
    // narrow gable-front cottage (shotgun), butter yellow, full porch under a front gable
    const wall = P(0xe0c98c, Surf.Wood);
    body(b, -3.2, -6.0, 3.2, 2.0, 0.6, 3.4, wall);
    roofGable(b, 0, -2.0, 6.4, 8.0, 3.4, 2.4, 'z', P(0x5b4a3e, Surf.RoofTiles), { gable: wall, over: 0.4, rake: 0.35 });
    porch(b, -3.2, 3.2, 2.0, 2.2, 0.6, 3.3, P(0x5b4a3e, Surf.RoofTiles), { posts: 4, gap: [-0.7, 0.7], kind: 'shed' });
    inFace(b, 'pz', 2.0, () => {
      door(b, 0, 0.6, 0.95, 2.2, 0x2f4a37, { transom: true, lamp: true });
      win(b, -1.9, 1.2, 0.9, 1.6, { mull: 2, shutter: 0x3f5a46, sill: TRIM });
      win(b, 1.9, 1.2, 0.9, 1.6, { mull: 2, shutter: 0x3f5a46, sill: TRIM });
    });
    // gable window
    inFace(b, 'pz', 2.0, () => win(b, 0, 4.1, 0.8, 0.8, { mull: 2 }));
    wins(b, 'px', 3.2, [-4.8, -2.4, 0.3], 1.2, 0.9, 1.5, { mull: 2, sill: TRIM });
    wins(b, 'nx', -3.2, [-4.8, -1.2], 1.2, 0.9, 1.5, { mull: 2, sill: TRIM });
    wins(b, 'nz', -6.0, [1.2], 1.2, 0.9, 1.3, { mull: 2 });
    inFace(b, 'pz', 4.2, () => steps(b, 0, 1.4, 2, 0.3, 0.3, 0x9a8670, 0, Surf.Wood));
    paveSlab(b, -0.6, 4.8, 0.6, 8.0, 0xc8c2b4, 0.08);
    // gravel side drive + small car
    paveSlab(b, 4.2, -5.0, 7.2, 8.0, 0xa39c90, 0.07);
    parkedCar(b, rng, 5.7, 0.8, 0, 0x2b4a6a);
    picket(b, -7.6, 7.2, -0.9, 7.2, 0.9);
    picket(b, 0.9, 7.2, 3.9, 7.2, 0.9);
    flowerBed(b, -3.0, 4.4, -1.0, 5.2, 0xd9a13c);
    flowerBed(b, 1.0, 4.4, 3.0, 5.2, 0xd9a13c);
    boardFence(b, -7.7, -1.0, -7.7, -7.7, 1.6);
    boardFence(b, -7.7, -7.7, 7.7, -7.7, 1.6);
    tree(b, rng, -5.8, -4.5, 1.2, 'wide');
    bush(b, -5.5, 3.0, 0.9, 0x4a7434, 4);
  } else if (v === 2) {
    // 1.5-storey Cape Cod: steep roof, 2 dormers, shingles, central door w/ hood, shutters
    const wall = P(0x9fb0b2, Surf.Wood);
    const x0 = -5.0, x1 = 5.0, z0 = -4.6, z1 = 2.2;
    body(b, x0, z0, x1, z1, 0.4, 3.1, wall);
    const h = 3.5, k = h / 3.4;
    roofGable(b, 0, -1.2, 10, 6.8, 3.1, h, 'x', P(0x6b5a4a, Surf.RoofTiles), { gable: P(0x9fb0b2, Surf.Wood), over: 0.35 });
    for (const x of [-2.4, 2.4]) dormer(b, x, 1.1, z1, 3.1, k, 1.5, 1.7, P(0x9fb0b2, Surf.Wood), P(0x6b5a4a, Surf.RoofTiles));
    inFace(b, 'pz', z1, () => {
      door(b, 0, 0.4, 1.0, 2.1, 0x7e2a26, { sidelights: true, lamp: false });
      for (const x of [-3.4, -1.8, 1.8, 3.4]) win(b, x, 1.15, 0.95, 1.35, shutterWin(0x2e3a4a));
    });
    // door hood (small gable canopy)
    b.paint(TRIM).box(-1.0, 2.55, z1, 1.0, 2.7, z1 + 0.9, { nz: null });
    roofGable(b, 0, z1 + 0.45, 2.0, 1.0, 2.7, 0.6, 'z', P(0x6b5a4a, Surf.RoofTiles), { over: 0.1, rake: 0.1, t: 0.08, gable: P(TRIM) });
    wins(b, 'px', x1, [-3.2, -0.2], 1.15, 1.0, 1.35, shutterWin(0x2e3a4a));
    wins(b, 'px', x1, [-1.2], 3.8, 0.8, 1.0, { mull: 2 });
    wins(b, 'nx', x0, [-2.8, 0.2], 1.15, 1.0, 1.35, shutterWin(0x2e3a4a));
    wins(b, 'nz', z0, [-3, 0, 3], 1.15, 1.0, 1.35, { mull: 2 });
    // exterior brick chimney on the -x gable
    chimney(b, x0 - 0.4, -1.2, 0.8, 1.1, 0, 7.3);
    inFace(b, 'pz', z1, () => steps(b, 0, 1.8, 2, 0.2, 0.35, 0xb5ada0));
    paveSlab(b, -0.7, z1 + 0.7, 0.7, 8.0, 0xb9b2a6, 0.08);
    picket(b, -7.6, 7.1, -0.9, 7.1);
    picket(b, 0.9, 7.1, 7.6, 7.1);
    bushRow(b, -4.6, 2.9, -1.4, 2.9, 3, 0.55, 0x4a7a3a, 1);
    bushRow(b, 1.4, 2.9, 4.6, 2.9, 3, 0.55, 0x4a7a3a, 7);
    flowerBed(b, -7.2, 5.6, -2.0, 6.6, 0xc4506a);
    hedgeBox(b, -7.8, -7.8, 7.8, -7.0, 1.4);
    tree(b, rng, 6.0, -5.5, 1.15, 'round');
    tree(b, rng, -6.2, -5.2, 1.0, 'cone');
    mailbox(b, 1.6, 7.6, 0x2e3a4a);
  } else if (v === 3) {
    // L-shaped brick cottage with cross gable and bay window
    const brick = P(0x9c5a44, Surf.Brick);
    body(b, -5.0, -4.8, 3.0, 0.6, 0.3, 3.1, brick, 0x6e6a62);
    body(b, 0.2, 0.6, 4.6, 3.6, 0.3, 3.1, brick, 0x6e6a62);
    const roof = P(0x3d4650, Surf.RoofTiles);
    roofGable(b, -1.0, -2.1, 8.0, 5.4, 3.1, 3.0, 'x', roof, { gable: brick });
    roofGable(b, 2.4, -0.6, 4.4, 8.4, 3.1, 2.6, 'z', roof, { gable: P(0xe8e0cc, Surf.Wood) });
    inFace(b, 'pz', 3.6, () => {
      win(b, 2.4, 1.1, 1.8, 1.45, { mull: 3, sill: 0xd8d0c0, head: 0xd8d0c0 });
      win(b, 2.4, 4.0, 0.7, 0.7, { mull: 2 });
    });
    inFace(b, 'pz', 0.6, () => {
      door(b, -1.0, 0.3, 0.95, 2.1, 0x2c3b57, { lite: true, lamp: true });
      win(b, -3.4, 1.1, 1.1, 1.45, { mull: 2, sill: 0xd8d0c0, head: 0xd8d0c0 });
    });
    // little porch roof in the L
    b.paint(0xe8e0cc).box(-2.0, 2.45, 0.6, 0.2, 2.6, 2.0, { nz: null, px: null });
    b.paint(TRIM).box(-1.95, 0.3, 1.8, -1.8, 2.45, 1.95);
    roofShed(b, -0.9, 1.3, 2.2, 1.4, 2.6, 0.3, 'nz', roof, { over: 0.2, rake: 0.1, t: 0.1 });
    b.paint(0xb5ada0, Surf.Pavement).box(-2.0, 0, 0.6, 0.2, 0.3, 2.0, { nz: null });
    wins(b, 'px', 4.6, [1.5, 2.8], 1.1, 0.9, 1.3, { mull: 2, sill: 0xd8d0c0 });
    wins(b, 'px', 3.0, [-3.6, -1.5], 1.1, 1.0, 1.3, { mull: 2, sill: 0xd8d0c0 });
    wins(b, 'nx', -5.0, [-3.2, -0.8], 1.1, 1.0, 1.3, { mull: 2, sill: 0xd8d0c0 });
    wins(b, 'nz', -4.8, [-3.0, 0.8], 1.1, 1.0, 1.3, { mull: 2 });
    chimney(b, -3.8, -3.2, 0.9, 0.9, 3.0, 6.9, 0x8a4a38);
    paveSlab(b, -1.6, 2.0, -0.4, 8.0, 0xc2bcaf, 0.08);
    lowWall(b, -7.6, 7.0, -2.0, 7.3, 0.7, 0x9c5a44, Surf.Brick);
    lowWall(b, 0.0, 7.0, 7.6, 7.3, 0.7, 0x9c5a44, Surf.Brick);
    bushRow(b, 0.6, 4.3, 4.4, 4.3, 3, 0.6, 0x3f6a2d, 3);
    flowerBed(b, -4.8, 1.0, -2.3, 1.8, 0xe6e0d0);
    hedgeBox(b, -7.8, -7.8, -7.0, 6.0, 1.4);
    hedgeBox(b, 7.0, -7.8, 7.8, 6.0, 1.4);
    tree(b, rng, 5.5, -5.0, 1.2, 'wide');
    tree(b, rng, -6.0, 4.0, 0.9, 'cone');
  } else if (v === 4) {
    // craftsman bungalow, low front gable, deep porch w/ tapered columns on stone piers
    const wall = P(0x8e9a78, Surf.Wood);
    body(b, -4.6, -5.2, 4.6, 1.6, 0.6, 3.4, wall, 0x7a756c);
    const roof = P(0x5a4638, Surf.RoofTiles);
    roofGable(b, 0, -1.8, 9.2, 6.8, 3.4, 2.0, 'z', roof, { gable: P(0xd6c9a4, Surf.Wood), over: 0.7, rake: 0.6, trim: 0xd6c9a4 });
    porch(b, -4.6, 4.6, 1.6, 2.8, 0.6, 3.35, roof, { posts: 2, postW: 0.34, pier: 0x8a8274, post: 0xd6c9a4, rail: 0xd6c9a4, gap: [-0.8, 0.8], kind: 'gable' });
    inFace(b, 'pz', 1.6, () => {
      door(b, 0, 0.6, 1.0, 2.1, 0x6b4a2e, { frame: 0xd6c9a4, surf: Surf.Wood, lite: true, lamp: true });
      win(b, -2.6, 1.3, 1.8, 1.3, { frame: 0xd6c9a4, mull: 3, sill: 0xd6c9a4 });
      win(b, 2.6, 1.3, 1.8, 1.3, { frame: 0xd6c9a4, mull: 3, sill: 0xd6c9a4 });
    });
    const ws: WinStyle = { frame: 0xd6c9a4, mull: 2, sill: 0xd6c9a4 };
    wins(b, 'px', 4.6, [-4.0, -1.6, 0.4], 1.3, 1.0, 1.3, ws);
    wins(b, 'nx', -4.6, [-3.5, -0.6], 1.3, 1.0, 1.3, ws);
    wins(b, 'nz', -5.2, [-2.2, 2.2], 1.3, 1.0, 1.3, ws);
    chimney(b, -4.9, -3.0, 0.9, 1.0, 0, 6.2, 0x8a8274, Surf.Stone);
    inFace(b, 'pz', 4.4, () => steps(b, 0, 1.6, 2, 0.3, 0.32, 0x9a8f80));
    paveSlab(b, -0.7, 5.0, 0.7, 8.0, 0xbdb6a8, 0.08);
    // side drive to a detached garage in the back
    paveSlab(b, 5.2, -7.6, 7.8, 8.0, 0x9d978c, 0.07);
    body(b, 4.6, -7.8, 7.9, -4.6, 0, 2.6, P(0x8e9a78, Surf.Wood));
    roofGable(b, 6.25, -6.2, 3.3, 3.2, 2.6, 1.1, 'z', roof, { gable: P(0xd6c9a4, Surf.Wood), over: 0.2, rake: 0.1 });
    inFace(b, 'pz', -4.6, () => garageDoor(b, U('pz', 6.25), 0, 2.6, 2.1, 0xd6c9a4, 0xd6c9a4));
    bushRow(b, -4.2, 5.0, -1.5, 5.0, 3, 0.55, 0x4a7434, 11);
    bushRow(b, 1.5, 5.0, 4.2, 5.0, 3, 0.55, 0x4a7434, 13);
    lowWall(b, -7.6, 7.0, -1.0, 7.4, 0.55, 0x8a8274);
    lowWall(b, 1.0, 7.0, 4.8, 7.4, 0.55, 0x8a8274);
    tree(b, rng, -6.0, -5.0, 1.25, 'wide');
    tree(b, rng, -6.3, 3.2, 0.8, 'round');
  } else {
    // gambrel "Dutch" cottage, barn red with white trim, shed in back
    const wall = P(0x94493c, Surf.Wood);
    body(b, -4.4, -4.6, 4.4, 1.6, 0.4, 2.9, wall);
    roofGambrel(b, 0, -1.5, 8.8, 6.2, 2.9, 3.6, P(0x3f4145, Surf.RoofTiles), wall, 0.4);
    // shed dormer across the front
    const dz = 1.3;
    b.paint(wall).box(-2.6, 3.3, -1.5, 2.6, 5.5, dz, { top: null, nz: null });
    roofShed(b, 0, (dz - 1.5) / 2, 5.2, dz + 1.5, 5.5, 0.35, 'nz', P(0x3f4145, Surf.RoofTiles), { over: 0.2, rake: 0.1, t: 0.1 });
    inFace(b, 'pz', dz, () => { win(b, -1.4, 3.8, 0.9, 0.95, { mull: 2 }); win(b, 1.4, 3.8, 0.9, 0.95, { mull: 2 }); });
    inFace(b, 'pz', 1.6, () => {
      door(b, 0, 0.4, 1.0, 2.1, 0xeeeae0, { lite: true, lamp: true, transom: false });
      win(b, -2.6, 1.1, 1.2, 1.3, { mull: 2, shutter: 0xeeeae0, sill: TRIM });
      win(b, 2.6, 1.1, 1.2, 1.3, { mull: 2, shutter: 0xeeeae0, sill: TRIM });
    });
    // small gable hood
    b.paint(TRIM).box(-0.9, 2.6, 1.6, 0.9, 2.72, 2.5, { nz: null });
    wins(b, 'px', 4.4, [-2.6, -0.2], 1.1, 1.0, 1.3, { mull: 2 });
    wins(b, 'px', 4.4, [-1.5], 3.6, 0.9, 1.0, { mull: 2 });
    wins(b, 'nx', -4.4, [-1.5], 1.1, 1.0, 1.3, { mull: 2 });
    wins(b, 'nx', -4.4, [-1.5], 3.6, 0.9, 1.0, { mull: 2 });
    wins(b, 'nz', -4.6, [-2.5, 2.5], 1.1, 1.0, 1.3, { mull: 2 });
    inFace(b, 'pz', 1.6, () => steps(b, 0, 1.6, 2, 0.2, 0.35, 0xb5ada0));
    paveSlab(b, -0.7, 2.3, 0.7, 8.0, 0xbdb6a8, 0.08);
    gardenShed(b, -5.8, -6.2, 2.2, 1.8, 0x94493c, 0x3f4145, 0);
    picket(b, -7.6, 7.2, -0.9, 7.2, 1.0);
    picket(b, 0.9, 7.2, 7.6, 7.2, 1.0);
    picket(b, 7.6, 7.2, 7.6, -7.6, 1.0);
    flowerBed(b, -4.2, 1.8, -1.0, 2.5, 0xe6e0d0);
    flowerBed(b, 1.0, 1.8, 4.2, 2.5, 0xc4506a);
    tree(b, rng, 5.8, -5.0, 1.1, 'round', 0x9a6a2a);
    tree(b, rng, -5.8, 3.5, 1.0, 'round');
    bush(b, 5.8, 3.4, 0.9, 0x4a7434, 9);
  }
}


// ---------------------------------------------------------------------------------------------- TOWNHOUSE ROW (R$)
function townhouseRow(b: ModelBuilder, v: number, rng: RNG): void {
  lawnSlab(b, -16, -8, 16, 8, LAWN);
  const z0 = -5, z1 = 3;
  if (v === 0 || v === 2) {
    // 4 units, wood siding in alternating muted colors; v0 shared side-gable, v2 individual front gables
    const cols = v === 0 ? [0xe6dcc2, 0x9fae94, 0x8fa3b5, 0xd2b48f] : [0xc9b8a0, 0xe9e4d6, 0xa6b7a6, 0xb89a8c];
    const roofC = v === 0 ? 0x4a4d52 : 0x5b4a3e;
    for (let i = 0; i < 4; i++) {
      const x0 = -14 + i * 7, x1 = x0 + 7;
      const wall = P(cols[i], Surf.Wood);
      b.paint(0x8d8880).box(x0, 0, z0 - 0.06, x1, 0.5, z1 + 0.06, { top: null, px: i === 3 ? undefined : null, nx: i === 0 ? undefined : null });
      b.paint(wall).box(x0, 0.5, z0, x1, 6.0, z1, { top: null, bottom: null, px: i === 3 ? undefined : null, nx: i === 0 ? undefined : null });
      if (v === 2) roofGable(b, x0 + 3.5, (z0 + z1) / 2, 7, z1 - z0, 6.0, 2.9, 'z', P(roofC, Surf.RoofTiles), { gable: wall, over: 0.35, rake: 0.25 });
      const flip = i % 2 === 1;
      const du = flip ? 5.2 : 1.8, wu = flip ? 1.9 : 5.1;
      inFace(b, 'pz', z1, () => {
        door(b, x0 + du, 0.5, 0.95, 2.1, [0x7e2a26, 0x2c3b57, 0x2f4a37, 0x6b4a2e][i], { lite: true, lamp: true, transom: v === 2 });
        win(b, x0 + wu, 1.2, 1.6, 1.4, { mull: 3, sill: TRIM });
        win(b, x0 + 1.8, 3.8, 1.1, 1.3, { mull: 2, sill: TRIM });
        win(b, x0 + 5.2, 3.8, 1.1, 1.3, { mull: 2, sill: TRIM });
        if (v === 2) win(b, x0 + 3.5, 6.6, 0.8, 0.8, { mull: 2 });
        steps(b, x0 + du, 1.3, 2, 0.25, 0.32, 0xb0a99c);
      });
      // door canopy
      b.paint(TRIM).box(x0 + du - 0.9, 2.85, z1, x0 + du + 0.9, 3.0, z1 + 0.9, { nz: null });
      wins(b, 'nz', z0, [x0 + 2, x0 + 5], 1.2, 1.1, 1.3, { mull: 2 });
      wins(b, 'nz', z0, [x0 + 2, x0 + 5], 3.8, 1.1, 1.3, { mull: 2 });
      // walk + tiny front garden + divider fence
      paveSlab(b, x0 + du - 0.6, z1 + 0.64, x0 + du + 0.6, 8, 0xc2bcaf, 0.08);
      if (i > 0) picket(b, x0, z1 + 0.1, x0, 7.0, 0.8);
      if (i % 2 === 0) flowerBed(b, x0 + wu - 1.3, z1 + 0.3, x0 + wu + 1.3, z1 + 1.1, FLOWERS[i]);
      else bushRow(b, x0 + wu - 1.2, z1 + 0.8, x0 + wu + 1.2, z1 + 0.8, 2, 0.55, 0x4a7434, i * 5);
      trashCans(b, x0 + (flip ? 1.0 : 5.6), -6.8, 2);
      if (i > 0) boardFence(b, x0, z0, x0, -8, 1.7);
    }
    if (v === 0) {
      const roof = P(roofC, Surf.RoofTiles);
      roofGable(b, 0, (z0 + z1) / 2, 28, z1 - z0, 6.0, 2.8, 'x', roof, { gable: P(cols[0], Surf.Wood) });
      // re-paint right gable in the last unit's color
      b.paint(cols[3], Surf.Wood).tri([14.01, 6.0, z1], [14.01, 6.0, z0], [14.01, 8.8, -1]);
      for (const x of [-7, 0, 7]) chimney(b, x, -1.6, 0.8, 1.0, 7.0, 9.8, 0x8a4a38);
      wins(b, 'px', 14, [-3.2, 1.0], 1.2, 1.0, 1.3, { mull: 2 });
      wins(b, 'nx', -14, [-3.2, 1.0], 3.8, 1.0, 1.3, { mull: 2 });
    } else {
      wins(b, 'px', 14, [-1.0], 3.8, 1.0, 1.3, { mull: 2 });
      wins(b, 'nx', -14, [-1.0], 3.8, 1.0, 1.3, { mull: 2 });
    }
    picket(b, -15.6, 7.2, 15.6, 7.2, 0.9);
    tree(b, rng, -15, -6.8, 0.8, 'round');
    tree(b, rng, 15, 6.0, 0.9, 'round');
  } else if (v === 1) {
    // 3 brick units with flat roofs, stepped parapets & cornices, stoops
    const bricks = [0x8f4a3a, 0x7a4636, 0xb08a60];
    const heights = [7.2, 7.8, 7.2];
    for (let i = 0; i < 3; i++) {
      const x0 = -14 + i * (28 / 3), x1 = x0 + 28 / 3;
      const hy = heights[i];
      const wall = P(bricks[i], Surf.Brick);
      b.paint(0x8a857c).box(x0, 0, z0 - 0.06, x1, 0.9, z1 + 0.06, { top: null, px: i === 2 ? undefined : null, nx: i === 0 ? undefined : null });
      b.paint(wall).box(x0, 0.9, z0, x1, hy, z1, { top: null, bottom: null, px: i === 2 ? undefined : null, nx: i === 0 ? undefined : null });
      b.paint(0x6c6860, Surf.RoofFlat).quad([x0, hy - 0.3, z1], [x1, hy - 0.3, z1], [x1, hy - 0.3, z0], [x0, hy - 0.3, z0]);
      band(b, x0, z1 - 0.3, x1, z1, hy - 0.5, 0.5, 0.22, 0xd8d0bf);
      band(b, x0, z1 - 0.3, x1, z1, 3.55, 0.18, 0.06, 0xd8d0bf);
      const cx = (x0 + x1) / 2;
      inFace(b, 'pz', z1, () => {
        door(b, x0 + 2.0, 0.9, 1.0, 2.2, [0x2a2a2a, 0x2f4a37, 0x7e2a26][i], { transom: true, frame: 0xd8d0bf, lamp: true });
        win(b, cx + 1.6, 1.5, 1.0, 1.6, { mull: 2, sill: 0xd8d0bf, head: 0xd8d0bf, frame: 0xe9e4d8 });
        for (const x of [x0 + 2.0, cx + 0.2, cx + 2.4]) win(b, x, 4.2, 0.95, 1.6, { mull: 2, sill: 0xd8d0bf, head: 0xd8d0bf, frame: 0xe9e4d8 });
        steps(b, x0 + 2.0, 1.4, 3, 0.3, 0.3, 0xa9a397);
        stoopRailsLocal(b, x0 + 2.0, 1.4, 3, 0.3, 0.3);
      });
      wins(b, 'nz', z0, [x0 + 2.5, x1 - 2.5], 1.5, 1.0, 1.4, { mull: 2, frame: 0xe9e4d8 });
      wins(b, 'nz', z0, [x0 + 2.5, x1 - 2.5], 4.2, 1.0, 1.4, { mull: 2, frame: 0xe9e4d8 });
      acBox(b, cx + 1.5, -2.0, hy - 0.3);
      paveSlab(b, x0 + 1.3, z1 + 0.9, x0 + 2.7, 8, 0xbab4a6, 0.08);
      lowWall(b, x0 + 3.0, 6.9, x1 - 0.3, 7.2, 0.6, 0x3a3a3a, Surf.Metal, 0x2a2a2a);
      bushRow(b, cx - 0.2, z1 + 1.6, x1 - 1.0, z1 + 1.6, 2, 0.6, 0x3f6a2d, i * 3 + 1);
      if (i > 0) boardFence(b, x0, z0, x0, -8, 1.7, 0x6f5a46);
    }
    b.paint(0x7c776e).box(-14 + 28 / 3 - 0.2, 7.2, z0, -14 + 28 / 3, 7.8, z1, { bottom: null });
    b.paint(0x7c776e).box(14 - 28 / 3, 7.2, z0, 14 - 28 / 3 + 0.2, 7.8, z1, { bottom: null });
    chimney(b, -12.5, -4.0, 0.9, 0.7, 6.9, 8.6, 0x8f4a3a);
    chimney(b, 12.5, -4.0, 0.9, 0.7, 6.9, 8.6, 0xb08a60);
    wins(b, 'px', 14, [-1.0], 4.2, 0.9, 1.4, { mull: 2, frame: 0xe9e4d8 });
    wins(b, 'nx', -14, [-1.0], 4.2, 0.9, 1.4, { mull: 2, frame: 0xe9e4d8 });
    tree(b, rng, -15.0, 6.2, 0.9, 'round');
    tree(b, rng, 15.0, 6.2, 0.9, 'round');
    trashCans(b, 10.5, -7.0, 3);
  } else {
    // post-war council terrace: pebble-dash render, hipped tile roof, paired doors under shared canopies
    const wall = P(0xc9c2b2);
    b.paint(0x8a857c).box(-14, 0, z0 - 0.06, 14, 0.35, z1 + 0.06, { top: null });
    b.paint(wall).box(-14, 0.35, z0, 14, 5.8, z1, { top: null, bottom: null });
    // colored lower band per unit (brick plinth)
    for (let i = 0; i < 4; i++) {
      const x0 = -14 + i * 7;
      b.paint(0x8c5a44, Surf.Brick).box(x0 + (i === 0 ? -0.04 : 0), 0.35, z1, x0 + 7 + (i === 3 ? 0.04 : 0), 1.1, z1 + 0.05, { top: null, bottom: null, nz: null });
    }
    roofHip(b, 0, (z0 + z1) / 2, 28, z1 - z0, 5.8, 2.6, P(0x8a4a36, Surf.RoofTiles), { over: 0.35, trim: 0xe9e6de });
    for (const x of [-7, 7]) chimney(b, x, -1.0, 1.2, 0.7, 7.0, 9.4, 0x8c5a44);
    chimney(b, 0, -1.0, 1.2, 0.7, 7.0, 9.4, 0x8c5a44);
    const doorsC = [0x2c3b57, 0x7e2a26, 0x2f4a37, 0xa8823a];
    for (let i = 0; i < 4; i++) {
      const x0 = -14 + i * 7;
      const du = i % 2 === 0 ? 6.0 : 1.0;
      const wu = i % 2 === 0 ? 2.6 : 4.4;
      inFace(b, 'pz', z1, () => {
        door(b, x0 + du, 0.35, 0.9, 2.1, doorsC[i], { lite: true, frame: 0xe9e6de });
        win(b, x0 + wu, 1.1, 2.4, 1.4, { mull: 3, frame: 0xe9e6de, sill: 0x9a948a });
        win(b, x0 + wu, 3.6, 1.8, 1.3, { mull: 2, frame: 0xe9e6de, sill: 0x9a948a });
        win(b, x0 + du, 3.8, 0.8, 1.0, { mull: 1, frame: 0xe9e6de });
      });
      wins(b, 'nz', z0, [x0 + 2, x0 + 5], 1.1, 1.2, 1.3, { mull: 2, frame: 0xe9e6de });
      wins(b, 'nz', z0, [x0 + 2, x0 + 5], 3.6, 1.2, 1.2, { mull: 2, frame: 0xe9e6de });
      paveSlab(b, x0 + du - 0.6, z1, x0 + du + 0.6, 8, 0xb4ae9f, 0.08);
      hedgeBox(b, x0 + (i % 2 === 0 ? 0.2 : 2.0), 6.6, x0 + (i % 2 === 0 ? 5.0 : 6.8), 7.4, 0.9, 0x456e30);
      trashCans(b, x0 + (i % 2 === 0 ? 4.4 : 1.8), z1 + 1.0, 2, [0x3d5a45, 0x3b4a5a, 0x5a4a3a, 0x3d5a45][i]);
      if (i > 0) boardFence(b, x0, z0, x0, -8, 1.6, 0x7a654e);
    }
    // shared canopies over paired doors
    for (const x of [-7, 7]) b.paint(0xe9e6de).box(x - 1.7, 2.6, z1, x + 1.7, 2.75, z1 + 1.0, { nz: null });
    wins(b, 'px', 14, [-1.0], 3.6, 0.9, 1.2, { mull: 2, frame: 0xe9e6de });
    wins(b, 'nx', -14, [-1.0], 3.6, 0.9, 1.2, { mull: 2, frame: 0xe9e6de });
    satDish(b, 4.0, 4.0, z1 + 0.05, 0.2);
    tree(b, rng, 15.0, -6.5, 0.8, 'round');
    tree(b, rng, -15.0, -6.5, 0.8, 'cone');
  }
}

function stoopRailsLocal(b: ModelBuilder, u: number, w: number, n: number, rise: number, run: number): void {
  b.paint(0x222426, Surf.Metal);
  const L = n * run;
  for (const s of [-1, 1]) {
    const x = u + s * (w / 2 - 0.05);
    b.beam([x, rise + 0.85, L - run * 0.5], [x, n * rise + 0.85, 0.05], 0.05);
    b.box(x - 0.03, 0, L - run * 0.55, x + 0.03, rise + 0.9, L - run * 0.45);
  }
}

// ---------------------------------------------------------------------------------------------- SUBURBAN (R$$) 16 x 32
function backyard(b: ModelBuilder, rng: RNG, zHouse: number, kind: number, fenceC: ColorLike = 0x8a6c4c): void {
  // fence around the backyard
  boardFence(b, -7.8, zHouse, -7.8, -15.8, 1.8, fenceC);
  boardFence(b, -7.8, -15.8, 7.8, -15.8, 1.8, fenceC);
  boardFence(b, 7.8, -15.8, 7.8, zHouse, 1.8, fenceC);
  if (kind === 0) {
    trampoline(b, 3.4, -11.5, 1.8);
    paveSlab(b, -6.5, zHouse - 3.2, -1.0, zHouse, 0xb9ae9a, 0.1);
    patioSet(b, -4.6, zHouse - 1.8, 0xc75b4a);
    grill(b, -1.8, zHouse - 2.5);
    tree(b, rng, -4.5, -12.5, 1.1, 'wide');
  } else if (kind === 1) {
    gardenShed(b, 5.4, -13.6, 2.6, 2.2, 0xd8d0bc, 0x5a5d62, 0);
    playset(b, -3.6, -11.0, 0.1, 0x3a7ab8);
    b.paint(0x8a7058, Surf.Wood).box(-6.0, 0, zHouse - 3.6, 1.0, 0.45, zHouse, { nz: null });
    patioSet(b, -2.6, zHouse - 1.8, 0x3a6a8a);
    tree(b, rng, 5.0, -8.8, 1.0, 'round');
  } else if (kind === 2) {
    // above-ground pool
    b.paint(0x5d8fb0, Surf.Metal).cylinder(2.6, -11.4, 0, 1.25, 3.0, 3.0, 14, { top: false });
    b.paint(0x4fb3d8, Surf.Water).cylinder(2.6, -11.4, 1.0, 0.15, 2.9, 2.9, 14);
    paveSlab(b, -6.5, zHouse - 3.0, -0.5, zHouse, 0xb2aa9c, 0.1);
    grill(b, -1.5, zHouse - 1.6);
    tree(b, rng, -5.2, -13.0, 1.0, 'round');
  } else {
    // vegetable garden + shed + tree
    for (let i = 0; i < 3; i++) {
      b.paint(0x5a4432).box(-6.8, 0, -14.8 + i * 1.8, -2.2, 0.25, -13.8 + i * 1.8);
      b.paint(0x5f8f3a, Surf.Foliage).box(-6.6, 0.25, -14.6 + i * 1.8, -2.4, 0.55, -14.0 + i * 1.8, { bottom: null });
    }
    gardenShed(b, 5.2, -13.8, 2.4, 2.0, 0x8a9a8a, 0x4a4d52, 0);
    paveSlab(b, -6.5, zHouse - 3.0, 2.0, zHouse, 0xc0b6a4, 0.1);
    patioSet(b, -1.0, zHouse - 1.6, 0xe0d8c0);
    tree(b, rng, 4.2, -9.0, 1.0, 'round', 0xa0662a);
  }
}

function frontYard(b: ModelBuilder, rng: RNG, treeX: number, bushZ: number, x0: number, x1: number, mailX: number): void {
  tree(b, rng, treeX, 11.5, 1.1, 'round');
  bushRow(b, x0, bushZ, x1, bushZ, Math.max(2, Math.round((x1 - x0) / 1.5)), 0.55, 0x4a7434, treeX * 3);
  mailbox(b, mailX, 15.2);
}

function suburban(b: ModelBuilder, v: number, rng: RNG): void {
  lawnSlab(b, -8, -16, 8, 16, LAWN_LUSH);
  const roofDark = P(0x45484d, Surf.RoofTiles);
  if (v === 0) {
    // 2-storey colonial, white siding, black shutters, portico, side 2-car garage
    const wall = P(0xeeebe2, Surf.Wood);
    body(b, -7, -4, 1, 4, 0.45, 6.0, wall);
    roofGable(b, -3, 0, 8, 8, 6.0, 2.7, 'x', roofDark, { gable: wall });
    body(b, 1, -3, 7, 4.5, 0.1, 3.0, wall, CONCRETE);
    roofGable(b, 4, 0.75, 6, 7.5, 3.0, 1.9, 'x', roofDark, { gable: wall, rake: 0.2 });
    const sh = shutterWin(0x24272b);
    inFace(b, 'pz', 4, () => {
      door(b, -3, 0.45, 1.0, 2.15, 0x7e2a26, { sidelights: true });
      win(b, -5.6, 1.2, 1.05, 1.45, sh); win(b, -0.4, 1.2, 1.05, 1.45, sh);
      for (const x of [-5.6, -3, -0.4]) win(b, x, 3.9, 1.0, 1.35, sh);
    });
    inFace(b, 'pz', 4.5, () => garageDoor(b, 4, 0.1, 4.8, 2.2, 0xeeebe2, TRIM, true));
    // portico
    b.paint(0xc8c2b6, Surf.Pavement).box(-4.4, 0, 4, -1.6, 0.45, 5.6, { nz: null });
    b.paint(TRIM).box(-4.25, 0.45, 5.25, -4.0, 2.95, 5.5).box(-2.0, 0.45, 5.25, -1.75, 2.95, 5.5);
    b.paint(TRIM).box(-4.45, 2.95, 4, -1.55, 3.2, 5.7, { nz: null });
    roofGable(b, -3, 4.85, 2.9, 1.7, 3.2, 0.75, 'z', roofDark, { over: 0.1, rake: 0.15, t: 0.1, gable: P(TRIM) });
    inFace(b, 'pz', 5.6, () => steps(b, -3, 1.6, 2, 0.225, 0.32, 0xc8c2b6));
    wins(b, 'nx', -7, [-2, 1.5], 1.2, 1.0, 1.4, sh);
    wins(b, 'nx', -7, [-2, 1.5], 3.9, 1.0, 1.35, sh);
    wins(b, 'px', 1, [-2, 1.5], 3.9, 1.0, 1.35, sh);
    wins(b, 'px', 7, [0.5], 1.0, 0.9, 1.0, { mull: 2 });
    wins(b, 'nz', -4, [-5.5, -0.8], 1.2, 1.0, 1.4, { mull: 2 });
    wins(b, 'nz', -4, [-5.5, -3, -0.5], 3.9, 1.0, 1.35, { mull: 2 });
    inFace(b, 'nz', -4, () => win(b, U('nz', -3.2), 0.45, 1.8, 2.1, { mull: 1 }));
    chimney(b, -7.45, 0, 0.9, 1.2, 0, 9.4);
    paveSlab(b, 1.6, 4.5, 6.4, 16, CONCRETE, 0.1);
    paveSlab(b, -3.6, 6.2, -2.4, 16, 0xc8c2b6, 0.08);
    parkedCar(b, rng, 4.9, 8.6, Math.PI);
    frontYard(b, rng, -5.5, 4.8, -6.6, -4.6, 1.0);
    bushRow(b, -1.2, 4.8, 0.6, 4.8, 2, 0.5, 0x4a7434, 4);
    backyard(b, rng, -4, 0);
  } else if (v === 1) {
    // split-level: 1-storey wing + raised 2-level part with tuck-under garage; tan brick + beige siding
    const brick = P(0xa7765a, Surf.Brick), sid = P(0xd9cdb3, Surf.Wood);
    body(b, -7, -4, -1, 3.5, 0.5, 3.4, sid);
    roofGable(b, -4, -0.25, 6, 7.5, 3.4, 1.7, 'x', P(0x5b4a3e, Surf.RoofTiles), { gable: sid, over: 0.6 });
    b.paint(brick).box(-1, 0, -5, 7, 2.6, 2.5, { top: null, nx: null });
    b.paint(sid).box(-1, 2.6, -5, 7, 5.6, 2.5, { top: null, bottom: null });
    roofHip(b, 3, -1.25, 8, 7.5, 5.6, 1.8, P(0x5b4a3e, Surf.RoofTiles), { over: 0.6 });
    inFace(b, 'pz', 2.5, () => {
      garageDoor(b, 4.4, 0.0, 4.4, 2.2, 0xe7e1d2, 0xe7e1d2);
      win(b, 0.8, 0.9, 1.2, 1.1, { mull: 2, frame: 0xe7e1d2 });
      win(b, 1.4, 3.3, 2.2, 1.4, { mull: 3, frame: 0xe7e1d2 });
      win(b, 4.8, 3.3, 1.6, 1.4, { mull: 2, frame: 0xe7e1d2 });
    });
    inFace(b, 'pz', 3.5, () => {
      door(b, -2.2, 0.5, 0.95, 2.1, 0x55707e, { lite: true, lamp: true, frame: 0xe7e1d2 });
      win(b, -5.0, 1.2, 2.4, 1.4, { mull: 3, frame: 0xe7e1d2, shutter: 0x6b4a2e });
      steps(b, -2.2, 1.4, 2, 0.25, 0.32, 0xb8b0a2);
    });
    wins(b, 'nx', -7, [-2.2, 1.2], 1.2, 1.0, 1.3, { mull: 2, frame: 0xe7e1d2 });
    wins(b, 'px', 7, [-3.5, -0.5], 3.3, 1.0, 1.3, { mull: 2, frame: 0xe7e1d2 });
    wins(b, 'px', 7, [-2.0], 0.9, 1.0, 1.1, { mull: 2, frame: 0xe7e1d2 });
    wins(b, 'nz', -5, [0.8, 5.2], 3.3, 1.1, 1.3, { mull: 2, frame: 0xe7e1d2 });
    wins(b, 'nz', -4, [-5.5, -2.5], 1.2, 1.1, 1.3, { mull: 2, frame: 0xe7e1d2 });
    chimney(b, -5.8, -1.6, 0.9, 0.9, 3.5, 6.2, 0xa7765a);
    paveSlab(b, 2.0, 2.5, 6.8, 16, CONCRETE, 0.1);
    paveSlab(b, -2.8, 4.8, -1.6, 9.5, 0xc0b8aa, 0.08);
    paveSlab(b, -2.8, 8.5, 2.0, 9.5, 0xc0b8aa, 0.08);
    parkedCar(b, rng, 4.4, 10.5, Math.PI);
    frontYard(b, rng, -5.0, 4.3, -6.4, -3.4, 1.6);
    backyard(b, rng, -5, 1, 0x7a6a5a);
  } else if (v === 2) {
    // single-storey L with forward "snout" garage, hip roofs, stucco + stone
    const st = P(0xd8c7a8), stone = P(0xa39a88, Surf.Stone);
    body(b, -7, -5.5, 1.8, 3.0, 0.3, 3.2, st, 0x8f887c);
    body(b, 1.8, -3.5, 7.2, 5.8, 0.1, 3.0, st, CONCRETE);
    b.paint(stone).box(-7.04, 0.3, 2.96, -3.6, 1.2, 3.05, { top: null, bottom: null });
    roofHip(b, -2.6, -1.25, 8.8, 8.5, 3.2, 2.2, P(0x6a5647, Surf.RoofTiles), { over: 0.5 });
    roofHip(b, 4.5, 1.15, 5.4, 9.3, 3.0, 2.0, P(0x6a5647, Surf.RoofTiles), { over: 0.5 });
    inFace(b, 'pz', 5.8, () => garageDoor(b, 4.5, 0.1, 4.4, 2.1, 0xe8e2d4, 0xe8e2d4));
    inFace(b, 'pz', 3.0, () => {
      door(b, 0.4, 0.3, 1.0, 2.1, 0x6b4a2e, { surf: Surf.Wood, lite: true, lamp: true, frame: 0xe8e2d4 });
      win(b, -5.2, 1.1, 2.2, 1.4, { mull: 3, frame: 0xe8e2d4, shutter: 0x6a5647 });
      win(b, -2.2, 1.1, 1.3, 1.4, { mull: 2, frame: 0xe8e2d4, shutter: 0x6a5647 });
    });
    wins(b, 'nx', 1.8, [4.5], 1.0, 0.8, 1.0, { frame: 0xe8e2d4 });
    wins(b, 'nx', -7, [-3.5, 0.5], 1.1, 1.1, 1.3, { mull: 2, frame: 0xe8e2d4 });
    wins(b, 'px', 7.2, [-1.0], 1.0, 0.9, 1.0, { frame: 0xe8e2d4 });
    wins(b, 'nz', -5.5, [-5.5, -2.2, 0.4], 1.1, 1.1, 1.3, { mull: 2, frame: 0xe8e2d4 });
    b.paint(0xc0b8a8, Surf.Pavement).box(-0.6, 0, 3.0, 1.8, 0.3, 4.4, { nz: null });
    paveSlab(b, 2.3, 5.8, 6.7, 16, CONCRETE, 0.1);
    paveSlab(b, -0.4, 4.4, 0.8, 9, 0xc0b8aa, 0.08);
    paveSlab(b, -0.4, 8.0, 2.3, 9.0, 0xc0b8aa, 0.08);
    parkedCar(b, rng, 4.5, 12.0, Math.PI - 0.05);
    flowerBed(b, -6.8, 3.2, -3.8, 4.0, 0xd9a13c);
    frontYard(b, rng, -4.5, 3.6, -3.3, -0.8, 1.9);
    backyard(b, rng, -5.5, 2, 0x9a8a78);
  } else if (v === 3) {
    // 2-storey craftsman foursquare w/ deep porch, detached garage in back along a side drive
    const sid = P(0x5d6f7e, Surf.Wood);
    body(b, -7, -5, 2.6, 3.0, 0.6, 6.2, sid);
    roofHip(b, -2.2, -1, 9.6, 8, 6.2, 2.6, P(0x4f5a48, Surf.RoofTiles), { over: 0.7, trim: 0xece8de });
    // front hip dormer
    b.paint(sid).box(-3.4, 7.2, -0.5, -1.0, 8.4, 2.4, { top: null, nz: null });
    roofHip(b, -2.2, 0.95, 2.4, 2.9, 8.4, 0.7, P(0x4f5a48, Surf.RoofTiles), { over: 0.25, trim: 0xece8de });
    inFace(b, 'pz', 2.4, () => win(b, -2.2, 7.45, 1.4, 0.7, { mull: 3, frame: 0xece8de }));
    porch(b, -7, 2.6, 3.0, 2.6, 0.6, 3.4, P(0x4f5a48, Surf.RoofTiles), { posts: 3, postW: 0.3, pier: 0x9a8f80, post: 0xece8de, rail: 0xece8de, gap: [-3.3, -1.7], kind: 'shed' });
    const ws: WinStyle = { mull: 2, frame: 0xece8de, sill: 0xece8de };
    inFace(b, 'pz', 3.0, () => {
      door(b, -2.5, 0.6, 1.0, 2.15, 0x9a5a2a, { surf: Surf.Wood, lite: true, lamp: true, frame: 0xece8de });
      win(b, -5.2, 1.3, 1.9, 1.4, { mull: 3, frame: 0xece8de });
      win(b, 0.6, 1.3, 1.9, 1.4, { mull: 3, frame: 0xece8de });
      win(b, -4.8, 4.1, 1.1, 1.3, ws); win(b, 0.4, 4.1, 1.1, 1.3, ws);
    });
    inFace(b, 'pz', 5.6, () => steps(b, -2.5, 1.5, 2, 0.3, 0.32, 0x9a8f80));
    wins(b, 'px', 2.6, [-3.5, 0.5], 1.3, 1.0, 1.3, ws);
    wins(b, 'px', 2.6, [-3.5, 0.5], 4.1, 1.0, 1.3, ws);
    wins(b, 'nx', -7, [-3.5, 0.5], 1.3, 1.0, 1.3, ws);
    wins(b, 'nx', -7, [-3.5, 0.5], 4.1, 1.0, 1.3, ws);
    wins(b, 'nz', -5, [-5, -0.8], 1.3, 1.0, 1.3, ws);
    wins(b, 'nz', -5, [-5, -2.4, 0.2], 4.1, 1.0, 1.3, ws);
    chimney(b, -7.35, -2.5, 0.8, 1.1, 0, 9.0, 0x8a4a38);
    // side drive to detached garage
    paveSlab(b, 3.6, -12.5, 7.0, 16, 0xb7b1a5, 0.1);
    body(b, 2.2, -15.6, 7.6, -9.6, 0.1, 2.8, sid, CONCRETE);
    roofGable(b, 4.9, -12.6, 5.4, 6.0, 2.8, 1.6, 'z', P(0x4f5a48, Surf.RoofTiles), { gable: sid, trim: 0xece8de });
    inFace(b, 'pz', -9.6, () => garageDoor(b, 5.1, 0.1, 3.0, 2.2, 0xece8de, 0xece8de, true));
    parkedCar(b, rng, 5.3, 1.0, Math.PI);
    paveSlab(b, -3.1, 5.9, -1.9, 16, 0xc0b8aa, 0.08);
    frontYard(b, rng, -5.4, 6.2, -6.4, -3.8, 3.0);
    boardFence(b, -7.8, -5, -7.8, -15.8, 1.8, 0x7a6450);
    boardFence(b, -7.8, -15.8, 2.2, -15.8, 1.8, 0x7a6450);
    boardFence(b, 3.0, -5.0, 3.0, -9.6, 1.8, 0x7a6450);
    playset(b, -3.8, -11.5, 0.2, 0xc9483a);
    paveSlab(b, -6.5, -8.0, -1.0, -5.0, 0xb9ae9a, 0.1);
    grill(b, -2.0, -6.8);
  } else if (v === 4) {
    // modern suburban: flat roofs, cantilevered upper volume, white render + charcoal + wood cladding
    const white = P(0xe9e7e1), dark = P(0x44474b), wood = P(0x9a7250, Surf.Wood);
    body(b, -7, -4, 2.2, 3.0, 0.15, 3.3, white, 0x8f8b84);
    b.paint(wood).box(-6.2, 3.3, -4.6, 1.4, 6.4, 4.4, { top: null, bottom: undefined });
    b.paint(0x4a4d52, Surf.RoofFlat).quad([-6.3, 6.5, 4.5], [1.5, 6.5, 4.5], [1.5, 6.5, -4.7], [-6.3, 6.5, -4.7]);
    b.paint(dark).box(-6.4, 6.4, -4.8, 1.6, 6.65, 4.6, { top: null });
    b.paint(dark).box(-6.4, 6.65, -4.8, 1.6, 6.66, 4.6, { bottom: null, px: null, nx: null, pz: null, nz: null });
    // garage volume (charcoal) with roof deck
    body(b, 2.2, -2.8, 7.4, 4.0, 0.1, 3.3, dark, CONCRETE);
    flatRoof(b, 2.2, -2.8, 7.4, 4.0, 3.3, 0.9, 0.12, 0x44474b, 0x77736c, 0x3a3c40);
    b.paint(0x44474b).box(-7.1, 3.3, -4.1, 2.2, 3.5, 3.1, { bottom: null });
    inFace(b, 'pz', 4.0, () => garageDoor(b, 4.8, 0.1, 4.4, 2.3, 0x6a6e73, null));
    inFace(b, 'pz', 3.0, () => {
      door(b, 0.8, 0.15, 1.1, 2.3, 0x9a7250, { surf: Surf.Wood, frame: 0x2a2c2e, sidelights: true });
      win(b, -4.2, 0.4, 4.6, 2.5, { frame: 0x2a2c2e, ft: 0.08, mull: 1 });
    });
    inFace(b, 'pz', 4.4, () => { win(b, -3.8, 4.0, 3.6, 1.7, { frame: 0x2a2c2e, ft: 0.08 }); win(b, 0.2, 4.4, 1.0, 1.3, { frame: 0x2a2c2e, ft: 0.08 }); });
    wins(b, 'nx', -6.2, [-2.0, 1.8], 4.0, 1.2, 1.6, { frame: 0x2a2c2e, ft: 0.08 });
    wins(b, 'px', 1.4, [-2.8], 4.0, 1.2, 1.6, { frame: 0x2a2c2e, ft: 0.08 });
    wins(b, 'nx', -7, [-1.0], 0.4, 2.4, 2.5, { frame: 0x2a2c2e, ft: 0.08 });
    inFace(b, 'nz', -4.0, () => win(b, U('nz', -3.0), 0.2, 5.0, 2.6, { frame: 0x2a2c2e, ft: 0.08, mull: 1 }));
    wins(b, 'nz', -4.6, [-4.5, -1.0], 4.0, 1.6, 1.6, { frame: 0x2a2c2e, ft: 0.08 });
    b.paint(0x9a7250, Surf.Wood).box(2.4, 3.3, -2.6, 7.2, 3.4, 3.8, { bottom: null });
    planter(b, 6.4, 2.8, 1.2, 0.8, 3.4, 0x3a3c40, 0x4f7a34, 3);
    // driveway, pavers, ornamental grasses
    paveSlab(b, 2.6, 4.0, 7.0, 16, 0x9a9690, 0.1);
    for (let i = 0; i < 5; i++) paveSlab(b, 0.2, 4.4 + i * 2.2, 1.4, 5.4 + i * 2.2, 0xc8c4bc, 0.09);
    parkedCar(b, rng, 4.8, 8.8, Math.PI, 0x2b2d31);
    hedgeBox(b, -7.6, 13.5, -0.6, 14.5, 0.9, 0x3f6b2e);
    for (let i = 0; i < 4; i++) bush(b, -6.3 + i * 1.6, 4.4, 0.5, 0x8a9a52, i + 20);
    tree(b, rng, -4.8, 9.5, 1.0, 'column');
    tree(b, rng, -2.6, 10.2, 0.9, 'column');
    boardFence(b, -7.8, -4, -7.8, -15.8, 1.9, 0x5a5048);
    boardFence(b, -7.8, -15.8, 7.8, -15.8, 1.9, 0x5a5048);
    boardFence(b, 7.8, -15.8, 7.8, -2.8, 1.9, 0x5a5048);
    b.paint(0x9a7250, Surf.Wood).box(-7.0, 0, -8.5, 0.5, 0.2, -4.0, { nz: undefined });
    lounger(b, -5.5, -7.0, Math.PI); lounger(b, -4.3, -7.0, Math.PI);
    poolRect(b, -5.8, -14.2, 1.8, -10.6, 0xd8d2c4, 0.8);
    tree(b, rng, 5.0, -12.0, 1.0, 'round');
  } else if (v === 5) {
    // brick-front 2-storey with hip roof, tall entry gable & front-gable 2-car garage
    const brick = P(0x9a5a46, Surf.Brick), sid = P(0xd3cbbb, Surf.Wood);
    b.paint(0x8d8880).box(-7.06, 0, -5.06, 1.06, 0.4, 3.06, { top: null });
    b.paint(sid).box(-7, 0.4, -5, 1, 6.0, 3, { top: null, bottom: null, pz: null });
    b.paint(brick).box(-7, 0.4, 2.9, 1, 6.0, 3, { top: null, bottom: null, nz: null, px: null, nx: null });
    roofHip(b, -3, -1, 8, 8, 6.0, 2.6, P(0x4d4a48, Surf.RoofTiles), { over: 0.4 });
    // 2-storey entry bump with front gable
    b.paint(brick).box(-4.3, 0.4, 3, -1.7, 6.6, 4.0, { top: null, nz: null });
    roofGable(b, -3, 3.3, 2.6, 2.2, 6.6, 1.7, 'z', P(0x4d4a48, Surf.RoofTiles), { gable: brick, over: 0.25, rake: 0.2 });
    inFace(b, 'pz', 4.0, () => {
      door(b, -3, 0.4, 1.1, 2.3, 0x3a2a22, { surf: Surf.Wood, transom: true, frame: 0xe8e2d6, lamp: true });
      win(b, -3, 4.0, 1.2, 1.6, { mull: 2, frame: 0xe8e2d6 });
    });
    inFace(b, 'pz', 3, () => {
      win(b, -5.8, 1.1, 1.3, 1.5, { mull: 2, frame: 0xe8e2d6, sill: 0xd0c8b8 });
      win(b, -0.3, 1.1, 1.3, 1.5, { mull: 2, frame: 0xe8e2d6, sill: 0xd0c8b8 });
      win(b, -5.8, 3.9, 1.2, 1.4, { mull: 2, frame: 0xe8e2d6, sill: 0xd0c8b8 });
      win(b, -0.3, 3.9, 1.2, 1.4, { mull: 2, frame: 0xe8e2d6, sill: 0xd0c8b8 });
    });
    body(b, 1, -4, 7.3, 5.0, 0.1, 3.0, sid, CONCRETE);
    b.paint(brick).box(1, 0.1, 4.95, 7.3, 3.0, 5.02, { top: null, bottom: null, nz: null, px: null, nx: null });
    roofGable(b, 4.15, 0.5, 6.3, 9, 3.0, 2.3, 'z', P(0x4d4a48, Surf.RoofTiles), { gable: brick, over: 0.35, rake: 0.3 });
    inFace(b, 'pz', 5.02, () => { garageDoor(b, 2.65, 0.1, 2.5, 2.1, 0xe8e2d6, 0xe8e2d6, true); garageDoor(b, 5.65, 0.1, 2.5, 2.1, 0xe8e2d6, 0xe8e2d6, true); win(b, 4.15, 3.6, 0.8, 0.8, { mull: 2, frame: 0xe8e2d6 }); });
    wins(b, 'nx', -7, [-3.5, 0.5], 1.1, 1.1, 1.4, { mull: 2 });
    wins(b, 'nx', -7, [-3.5, 0.5], 3.9, 1.1, 1.4, { mull: 2 });
    wins(b, 'px', 1, [-3.5], 3.9, 1.1, 1.4, { mull: 2 });
    wins(b, 'nz', -5, [-5.5, -2.5, 0], 3.9, 1.1, 1.4, { mull: 2 });
    inFace(b, 'nz', -5, () => win(b, U('nz', -3.5), 0.4, 2.4, 2.1, { mull: 1 }));
    inFace(b, 'pz', 4.0, () => steps(b, -3, 2.0, 2, 0.2, 0.35, 0xbab3a6));
    paveSlab(b, 1.3, 5.0, 7.0, 16, CONCRETE, 0.1);
    paveSlab(b, -3.6, 4.7, -2.4, 7.5, 0xc4bdb0, 0.08);
    paveSlab(b, -3.6, 6.5, 1.3, 7.5, 0xc4bdb0, 0.08);
    parkedCar(b, rng, 5.6, 9.5, Math.PI + 0.04);
    parkedCar(b, rng, 2.7, 11.8, Math.PI);
    frontYard(b, rng, -5.5, 3.8, -6.6, -4.8, 0.9);
    bushRow(b, -1.2, 3.8, 0.4, 3.8, 2, 0.5, 0x3f6a2d, 8);
    backyard(b, rng, -5, 3);
  } else if (v === 6) {
    // Tudor revival: brick ground floor, half-timbered steep cross gable, tall front chimney
    const brick = P(0x8a5040, Surf.Brick), stucco = P(0xe6dcc6);
    body(b, -7, -5, 3, 2.6, 0.3, 3.2, brick, 0x6e6a62);
    b.paint(stucco).box(-7, 3.2, -5, 3, 5.4, 2.6, { top: null, bottom: null });
    roofGable(b, -2, -1.2, 10, 7.6, 5.4, 3.4, 'x', P(0x4a4540, Surf.RoofTiles), { gable: stucco, over: 0.35 });
    // front cross gable wing
    body(b, -6.4, 2.6, -2.2, 4.6, 0.3, 3.2, brick, 0x6e6a62);
    b.paint(stucco).box(-6.4, 3.2, 2.6, -2.2, 5.4, 4.6, { top: null, bottom: null, nz: null });
    roofGable(b, -4.3, 2.1, 4.2, 5.0, 5.4, 3.6, 'z', P(0x4a4540, Surf.RoofTiles), { gable: stucco, over: 0.3, rake: 0.35 });
    // half timbering on the front gable
    inFace(b, 'pz', 4.6, () => {
      b.paint(0x3a2c24, Surf.Wood);
      fq(b, -6.4, 3.15, -2.2, 3.35, 0.06);
      for (const x of [-6.2, -5.2, -3.4, -2.4]) fq(b, x - 0.09, 3.35, x + 0.09, x < -4.3 ? 3.35 + (x + 6.4) * 1.7 : 3.35 + (-2.2 - x) * 1.7, 0.06);
      b.quad([-5.2, 3.35, 0.06], [-5.0, 3.35, 0.06], [-4.2, 5.3, 0.06], [-4.4, 5.3, 0.06]);
      b.quad([-3.6, 3.35, 0.06], [-3.4, 3.35, 0.06], [-4.2, 5.3, 0.06], [-4.4, 5.3, 0.06]);
      win(b, -4.3, 3.9, 1.3, 1.1, { frame: 0x3a2c24, mull: 3 });
      win(b, -4.3, 1.0, 1.8, 1.5, { frame: 0xd8d0c0, mull: 3, head: 0xd8d0c0 });
    });
    inFace(b, 'pz', 2.6, () => {
      door(b, -0.8, 0.3, 1.0, 2.2, 0x5a3a26, { surf: Surf.Wood, frame: 0xd8d0c0, lamp: true });
      win(b, 1.6, 1.0, 1.3, 1.4, { frame: 0xd8d0c0, mull: 3 });
      win(b, 0.6, 3.7, 1.0, 1.1, { frame: 0x3a2c24, mull: 2 });
      b.paint(0x3a2c24, Surf.Wood);
      for (const x of [-1.9, -0.2, 1.4, 2.9]) fq(b, x - 0.09, 3.2, x + 0.09, 5.4, 0.06);
      fq(b, -2.2, 3.15, 3.0, 3.33, 0.06);
    });
    chimney(b, -1.6, 3.1, 1.0, 0.8, 0, 9.2, 0x8a5040);
    wins(b, 'px', 3, [-3.5, -0.5], 1.0, 1.0, 1.3, { mull: 3, frame: 0xd8d0c0 });
    wins(b, 'px', 3, [-1.2], 5.8, 0.9, 1.0, { mull: 2, frame: 0x3a2c24 });
    wins(b, 'nx', -7, [-3.5, 0.5], 1.0, 1.0, 1.3, { mull: 3, frame: 0xd8d0c0 });
    wins(b, 'nz', -5, [-5, -2, 1], 1.0, 1.0, 1.3, { mull: 3, frame: 0xd8d0c0 });
    // detached garage at the back via side drive
    paveSlab(b, 3.8, -13, 7.2, 16, 0xa8a296, 0.1);
    body(b, 3.2, -15.6, 7.8, -10.0, 0.1, 2.7, brick, CONCRETE);
    roofGable(b, 5.5, -12.8, 4.6, 5.6, 2.7, 2.0, 'z', P(0x4a4540, Surf.RoofTiles), { gable: stucco });
    inFace(b, 'pz', -10.0, () => garageDoor(b, 5.5, 0.1, 3.0, 2.2, 0x5a3a26, 0xd8d0c0));
    parkedCar(b, rng, 5.5, 4.5, Math.PI);
    paveSlab(b, -1.4, 2.6, -0.2, 9.5, 0xb8aa94, 0.08);
    paveSlab(b, -1.4, 8.5, 3.8, 9.5, 0xb8aa94, 0.08);
    hedgeBox(b, -7.6, 14.6, 3.2, 15.4, 1.0, 0x3f6b2e);
    tree(b, rng, -5.0, 10.0, 1.2, 'wide');
    bushRow(b, 0.4, 3.2, 2.8, 3.2, 2, 0.55, 0x4a7434, 17);
    boardFence(b, -7.8, -5, -7.8, -15.8, 1.8, 0x6a5a48);
    boardFence(b, -7.8, -15.8, 3.2, -15.8, 1.8, 0x6a5a48);
    boardFence(b, 3.2, -5, 3.2, -10, 1.8, 0x6a5a48);
    flowerBed(b, -6.8, -9.0, -1.0, -8.0, 0xc4506a);
    tree(b, rng, -3.5, -12.8, 1.0, 'round', 0x5a7a3a);
  } else {
    // Dutch colonial (gambrel), sage siding, attached garage w/ sunroom, playset in back
    const sid = P(0x9aa88a, Surf.Wood);
    body(b, -7, -4.5, 1.6, 3.2, 0.45, 3.2, sid);
    roofGambrel(b, -2.7, -0.65, 8.6, 7.7, 3.2, 4.4, P(0x7a4536, Surf.RoofTiles), sid, 0.4);
    // long shed dormer
    b.paint(sid).box(-6.0, 3.5, -0.8, 0.6, 6.0, 2.2, { top: null, nz: null });
    roofShed(b, -2.7, 0.7, 6.6, 3.0, 6.0, 0.4, 'nz', P(0x7a4536, Surf.RoofTiles), { over: 0.2, rake: 0.1, t: 0.1 });
    inFace(b, 'pz', 2.2, () => { for (const x of [-5, -2.7, -0.4]) win(b, x, 4.0, 1.0, 1.3, { mull: 2, sill: TRIM }); });
    inFace(b, 'pz', 3.2, () => {
      door(b, -2.7, 0.45, 1.0, 2.15, 0x7e2a26, { lite: true, frame: TRIM });
      win(b, -5.2, 1.2, 1.1, 1.4, shutterWin(0x2f4a37));
      win(b, -0.3, 1.2, 1.1, 1.4, shutterWin(0x2f4a37));
    });
    b.paint(TRIM).box(-3.7, 2.8, 3.2, -1.7, 2.95, 4.2, { nz: null });
    b.paint(TRIM).box(-3.6, 0.45, 4.0, -3.45, 2.8, 4.15).box(-1.95, 0.45, 4.0, -1.8, 2.8, 4.15);
    b.paint(0xbdb6a8, Surf.Pavement).box(-3.8, 0, 3.2, -1.6, 0.45, 4.3, { nz: null });
    inFace(b, 'pz', 4.3, () => steps(b, -2.7, 1.6, 2, 0.225, 0.3, 0xbdb6a8));
    // garage + sunroom
    body(b, 1.6, -4.5, 7.4, 3.8, 0.1, 3.0, sid, CONCRETE);
    roofGable(b, 4.5, -0.35, 5.8, 8.3, 3.0, 1.7, 'z', P(0x7a4536, Surf.RoofTiles), { gable: sid });
    inFace(b, 'pz', 3.8, () => garageDoor(b, 4.5, 0.1, 4.4, 2.2, TRIM, TRIM, true));
    b.paint(TRIM).box(1.6, 0.3, -7.6, 5.4, 2.8, -4.5, { top: null, pz: null });
    wins(b, 'nz', -7.6, [2.3, 3.5, 4.7], 0.8, 1.0, 1.7, { frame: TRIM });
    wins(b, 'px', 5.4, [-6.8, -5.4], 0.8, 1.0, 1.7, { frame: TRIM });
    roofShed(b, 3.5, -6.05, 3.8, 3.1, 2.8, 0.5, 'pz', P(0x7a4536, Surf.RoofTiles), { over: 0.2, rake: 0.15, t: 0.1 });
    wins(b, 'nx', -7, [-2.5, 1.0], 1.2, 1.0, 1.3, shutterWin(0x2f4a37));
    wins(b, 'nx', -7, [-0.7], 4.3, 0.9, 1.1, { mull: 2 });
    wins(b, 'nz', -4.5, [-5.5, -1.0], 1.2, 1.0, 1.3, { mull: 2 });
    chimney(b, -7.4, -0.8, 0.9, 1.1, 0, 8.6);
    paveSlab(b, 2.0, 3.8, 7.0, 16, CONCRETE, 0.1);
    paveSlab(b, -3.3, 4.9, -2.1, 16, 0xc0b8aa, 0.08);
    parkedCar(b, rng, 4.5, 7.8, Math.PI);
    frontYard(b, rng, -5.8, 3.9, -6.6, -4.2, 1.5);
    bushRow(b, -1.2, 3.9, 1.0, 3.9, 2, 0.5, 0x4a7434, 11);
    boardFence(b, -7.8, -4.5, -7.8, -15.8, 1.8);
    boardFence(b, -7.8, -15.8, 7.8, -15.8, 1.8);
    boardFence(b, 7.8, -15.8, 7.8, -4.5, 1.8);
    playset(b, -3.6, -11.6, 0, 0x2e7a4a);
    tree(b, rng, 4.2, -12.0, 1.0, 'wide');
    trampoline(b, -5.0, -7.6, 1.4);
  }
}

export const houseModels = {
  res_shack: (b: ModelBuilder, v: number, rng: RNG) => { setLot(8, 8, 5); shack(b, v, rng); },
  res_cottage: (b: ModelBuilder, v: number, rng: RNG) => { setLot(8, 8, 8); cottage(b, v, rng); },
  res_townhouse_row: (b: ModelBuilder, v: number, rng: RNG) => { setLot(16, 8, 11); townhouseRow(b, v, rng); },
  res_suburban: (b: ModelBuilder, v: number, rng: RNG) => { setLot(8, 16, 9); suburban(b, v, rng); },
};
