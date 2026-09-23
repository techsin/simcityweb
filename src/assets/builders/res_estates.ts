/**
 * Residential low-density large lots: ranch (R$$), villa (R$$$), mansion (R$$$).
 * (owned by the residential asset agent)
 */
import type { ModelBuilder, ColorLike, Paint } from '../ModelBuilder';
import type { RNG } from '../../core/rng';
import { Surf } from '../../core/types';
import {
  P, TRIM, LAWN_LUSH, CONCRETE, inFace, U, fq, win, wins, door, garageDoor, steps, roofGable, roofHip, roofShed, roofMansard,
  dormer, chimney, lawnSlab, paveSlab, bush, bushRow, flowerBed, tree, boardFence, chainFence, lowWall, hedgeBox, mailbox,
  gardenShed, grill, patioSet, lounger, poolRect, parkedCar, planter, parapet, flatRoof, setLot, band, capPoly, type WinStyle,
} from './res_util';
import { body, porch, roofGambrel } from './res_houses';

// ---------------------------------------------------------------------------------------------- local helpers
/** Classical column: plinth + round shaft + capital. */
function column(b: ModelBuilder, x: number, z: number, y0: number, y1: number, r: number, color: ColorLike, seg = 8): void {
  b.paint(color).box(x - r * 1.35, y0, z - r * 1.35, x + r * 1.35, y0 + 0.3, z + r * 1.35, { bottom: null });
  b.paint(color).cylinder(x, z, y0 + 0.3, y1 - y0 - 0.6, r, r * 0.88, seg, { top: false });
  b.paint(color).box(x - r * 1.35, y1 - 0.3, z - r * 1.35, x + r * 1.35, y1, z + r * 1.35, { bottom: null, top: null });
}

/** Round paved disc (drives, terraces). */
function disc(b: ModelBuilder, x: number, z: number, r: number, h: number, color: ColorLike, surf: Surf = Surf.Pavement, seg = 20): void {
  b.paint(color, surf).cylinder(x, z, 0, h, r, r, seg, { top: true, smooth: false });
}

function fountain(b: ModelBuilder, x: number, z: number, r = 2.2, stone: ColorLike = 0xd6cfc0): void {
  b.paint(stone).cylinder(x, z, 0, 0.55, r, r, 14, { top: false, smooth: false });
  b.paint(0x4fa6c9, Surf.Water).cylinder(x, z, 0.45, 0.02, r - 0.15, r - 0.15, 14, { top: true });
  b.paint(stone).cylinder(x, z, 0.45, 1.2, 0.25, 0.2, 8, { top: false });
  b.paint(stone).cylinder(x, z, 1.65, 0.25, 0.9, 1.0, 10, { top: false });
  b.paint(0x6fc0dd, Surf.Water).cylinder(x, z, 1.85, 0.03, 0.85, 0.85, 10, { top: true });
  b.paint(stone).cylinder(x, z, 1.85, 0.7, 0.12, 0.08, 6, { top: true });
}

function tennisCourt(b: ModelBuilder, cx: number, cz: number, alongX: boolean, surface: ColorLike = 0x3f7a58): void {
  // compact court: 28 x 14 incl. runoff, playing area 23.8 x 11
  const L = 28, W = 14;
  if (!alongX) { b.push().translate(cx, 0, cz).rotateY(Math.PI / 2); tennisCourt(b, 0, 0, true, surface); b.pop(); return; }
  b.paint(0x7a4a3a, Surf.Pavement).box(cx - L / 2, 0, cz - W / 2, cx + L / 2, 0.1, cz + W / 2);
  b.paint(surface, Surf.Pavement).box(cx - 11.9, 0.1, cz - 5.5, cx + 11.9, 0.12, cz + 5.5, { bottom: null, px: null, nx: null, pz: null, nz: null });
  b.paint(0xf2f2f2);
  const line = (x0: number, z0: number, x1: number, z1: number) => b.quad([x0, 0.13, z1], [x1, 0.13, z1], [x1, 0.13, z0], [x0, 0.13, z0]);
  line(cx - 11.9, cz - 5.5, cx + 11.9, cz - 5.4); line(cx - 11.9, cz + 5.4, cx + 11.9, cz + 5.5);
  line(cx - 11.9, cz - 5.5, cx - 11.8, cz + 5.5); line(cx + 11.8, cz - 5.5, cx + 11.9, cz + 5.5);
  line(cx - 6.4, cz - 4.1, cx - 6.3, cz + 4.1); line(cx + 6.3, cz - 4.1, cx + 6.4, cz + 4.1);
  line(cx - 6.4, cz - 0.05, cx + 6.4, cz + 0.05);
  line(cx - 11.9, cz - 4.2, cx + 11.9, cz - 4.1); line(cx - 11.9, cz + 4.1, cx + 11.9, cz + 4.2);
  b.paint(0xeeeeee).quad2([cx, 0.12, cz - 6], [cx, 0.12, cz + 6], [cx, 1.0, cz + 6], [cx, 1.0, cz - 6]);
  const x0 = cx - L / 2, x1 = cx + L / 2, z0 = cz - W / 2, z1 = cz + W / 2;
  b.paint(0x2c3a32, Surf.Metal);
  b.quad2([x0, 0.1, z0], [x1, 0.1, z0], [x1, 3, z0], [x0, 3, z0]);
  b.quad2([x0, 0.1, z1], [x0 + 6, 0.1, z1], [x0 + 6, 3, z1], [x0, 3, z1]);
  b.quad2([x1 - 6, 0.1, z1], [x1, 0.1, z1], [x1, 3, z1], [x1 - 6, 3, z1]);
  b.quad2([x0, 0.1, z0], [x0, 0.1, z1], [x0, 3, z1], [x0, 3, z0]);
  b.quad2([x1, 0.1, z0], [x1, 0.1, z1], [x1, 3, z1], [x1, 3, z0]);
  b.paint(0x1e2622, Surf.Metal);
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]] as [number, number][]) b.box(x - 0.06, 0, z - 0.06, x + 0.06, 3.05, z + 0.06, { bottom: null });
}

/** Gate: two pillars + iron gate panels across a drive opening at z (front), x in [x0, x1]. */
function gate(b: ModelBuilder, x0: number, x1: number, z: number, pillar: ColorLike = 0xd8d0c0, iron: ColorLike = 0x222426, h = 2.2): void {
  for (const x of [x0 - 0.4, x1 + 0.4]) {
    b.paint(pillar, Surf.Stone).box(x - 0.4, 0, z - 0.4, x + 0.4, h, z + 0.4, { bottom: null });
    b.paint(0xefe9dc).box(x - 0.5, h, z - 0.5, x + 0.5, h + 0.2, z + 0.5, { bottom: null });
    b.paint(0xffe2a8, Surf.Emissive).box(x - 0.18, h + 0.2, z - 0.18, x + 0.18, h + 0.55, z + 0.18, { bottom: null });
  }
  b.paint(iron, Surf.Metal);
  b.quad2([x0, 0.1, z], [x1, 0.1, z], [x1, h - 0.3, z], [x0, h - 0.3, z]);
  b.box(x0, h - 0.4, z - 0.04, x1, h - 0.3, z + 0.04, { bottom: null });
}

/** Big glass wall (floor to ceiling) in face space, with thin mullions every `step`. */
function glassWall(b: ModelBuilder, u0: number, u1: number, y0: number, y1: number, frame: ColorLike = 0x2a2c2e, step = 1.6): void {
  b.paint(frame);
  fq(b, u0 - 0.08, y0, u1 + 0.08, y1 + 0.08, 0.04);
  b.paint(0x2a3440, Surf.GlassPlain);
  fq(b, u0, y0 + 0.05, u1, y1, 0.07);
  b.paint(frame);
  const n = Math.max(1, Math.round((u1 - u0) / step));
  for (let i = 1; i < n; i++) {
    const u = u0 + ((u1 - u0) * i) / n;
    fq(b, u - 0.04, y0, u + 0.04, y1, 0.09);
  }
}

/** Thin flat roof slab with overhang (modern). */
function slabRoof(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, t: number, edge: ColorLike, top: ColorLike = 0x6e6a64): void {
  b.paint(edge).box(x0, y, z0, x1, y + t, z1, { top: null, bottom: { color: edge } });
  b.paint(top, Surf.RoofFlat).quad([x0, y + t, z1], [x1, y + t, z1], [x1, y + t, z0], [x0, y + t, z0]);
}

// ---------------------------------------------------------------------------------------------- RANCH (R$$) 32 x 32
function ranch(b: ModelBuilder, v: number, rng: RNG): void {
  lawnSlab(b, -16, -16, 16, 16, LAWN_LUSH);
  if (v === 0) {
    // L-shaped hip-roof ranch, beige siding over brick wainscot, 2-car garage wing forward
    const sid = P(0xd8cfbd, Surf.Wood), brick = P(0x9a5c46, Surf.Brick);
    body(b, -13, -5, 5, 3, 0.3, 3.0, sid);
    body(b, 5, -5, 12, 6.5, 0.1, 3.0, sid, CONCRETE);
    b.paint(brick).box(-13.05, 0.3, -5.05, 5, 1.1, 3.05, { top: null, bottom: null, px: null });
    const roof = P(0x5a5048, Surf.RoofTiles);
    roofHip(b, -4, -1, 18, 8, 3.0, 2.1, roof, { over: 0.6 });
    roofHip(b, 8.5, 0.75, 7, 11.5, 3.0, 2.0, roof, { over: 0.6 });
    porch(b, -8, 1.5, 3, 1.8, 0.3, 3.0, roof, { posts: 4, rail: null, deck: 0xbab2a4 });
    inFace(b, 'pz', 3, () => {
      door(b, -2.0, 0.3, 1.0, 2.15, 0x2f4a37, { lite: true, lamp: true, sidelights: true });
      win(b, -5.6, 1.0, 3.0, 1.5, { mull: 3, sill: TRIM, shutter: 0x2f4a37 });
      win(b, -10.8, 1.1, 1.3, 1.3, { mull: 2, shutter: 0x2f4a37 });
      win(b, 2.8, 1.1, 1.3, 1.3, { mull: 2, shutter: 0x2f4a37 });
    });
    inFace(b, 'pz', 6.5, () => garageDoor(b, 8.5, 0.1, 5.0, 2.2, 0xece8de, TRIM, true));
    wins(b, 'nx', 5, [4.8], 1.1, 1.2, 1.1, { mull: 2 });
    wins(b, 'nx', -13, [-3.0, 0.5], 1.1, 1.2, 1.3, { mull: 2 });
    wins(b, 'px', 12, [-2.5, 1.5], 1.1, 1.0, 1.0, { mull: 2 });
    wins(b, 'nz', -5, [-11, -7.5, -4, 0, 3], 1.1, 1.2, 1.3, { mull: 2 });
    inFace(b, 'nz', -5, () => win(b, U('nz', -5.8), 0.3, 2.4, 2.1, { mull: 1 }));
    chimney(b, -8.5, -2.0, 1.1, 1.0, 3.0, 6.0, 0x9a5c46);
    paveSlab(b, 5.8, 6.5, 11.2, 16, CONCRETE, 0.1);
    paveSlab(b, -2.6, 4.8, -1.4, 9.2, 0xc4bdb0, 0.08);
    paveSlab(b, -2.6, 8.2, 5.8, 9.2, 0xc4bdb0, 0.08);
    parkedCar(b, rng, 7.2, 10.5, Math.PI);
    paveSlab(b, -11, -9.5, -3, -5, 0xbcae98, 0.1);
    patioSet(b, -8.5, -7.5, 0xb84a3a); patioSet(b, -5.2, -7.8, 0xb84a3a);
    grill(b, -3.8, -6.0);
    bushRow(b, -12.5, 3.8, -8.5, 3.8, 3, 0.6, 0x4a7434, 1);
    bushRow(b, 1.8, 3.8, 4.5, 3.8, 2, 0.6, 0x4a7434, 5);
    flowerBed(b, -12, 6.0, -9.0, 7.0, 0xc4506a);
    tree(b, rng, -9.5, 11.5, 1.3, 'wide');
    tree(b, rng, 13.5, -12.5, 1.2, 'round');
    tree(b, rng, -13.5, -13.0, 1.1, 'cone');
    tree(b, rng, 2.0, -13.0, 1.2, 'wide');
    hedgeBox(b, -15.8, -15.8, 15.8, -15.0, 1.4);
    mailbox(b, 5.2, 15.2);
  } else if (v === 1) {
    // long side-gable ranch, board & batten, full-length porch, carport
    const bb = P(0x9aa596, Surf.Corrugated);
    body(b, -8, -4, 13, 4, 0.35, 3.0, bb);
    const roof = P(0x3e4146, Surf.RoofTiles);
    roofGable(b, 2.5, 0, 21, 8, 3.0, 2.3, 'x', roof, { gable: bb, over: 0.6, rake: 0.4 });
    porch(b, -7, 12, 4, 2.2, 0.35, 3.0, roof, { posts: 6, rail: TRIM, gap: [1.2, 2.8] });
    inFace(b, 'pz', 4, () => {
      door(b, 2.0, 0.35, 1.0, 2.15, 0x9a3a2a, { lite: true, lamp: true });
      for (const x of [-5.5, -2.5, 6.0, 9.5]) win(b, x, 1.05, 1.4, 1.4, { mull: 2, sill: TRIM });
    });
    inFace(b, 'pz', 6.2, () => steps(b, 2.0, 1.5, 1, 0.35, 0.35, 0xb5ada0));
    wins(b, 'px', 13, [-1.5, 1.5], 1.1, 1.0, 1.2, { mull: 2 });
    wins(b, 'nz', -4, [-6, -2, 4, 8, 11], 1.1, 1.2, 1.3, { mull: 2 });
    wins(b, 'nx', -8, [1.8], 1.1, 1.0, 1.2, { mull: 2 });
    chimney(b, 8.5, 1.2, 1.0, 1.0, 3.5, 6.4, 0x8a8274, Surf.Stone);
    // carport
    b.paint(0x5a5d62, Surf.Metal).box(-14.5, 2.5, -4.2, -8, 2.75, 5, { bottom: undefined });
    b.paint(TRIM);
    for (const [x, z] of [[-14.2, -3.9], [-14.2, 4.7], [-8.3, 4.7]] as [number, number][]) b.box(x - 0.1, 0, z - 0.1, x + 0.1, 2.5, z + 0.1, { bottom: null, top: null });
    paveSlab(b, -14.6, -4.4, -8.0, 16, 0xa9a397, 0.1);
    parkedCar(b, rng, -11.3, 0.6, 0.0);
    paveSlab(b, 1.4, 6.9, 2.6, 16, 0xc4bdb0, 0.08);
    // backyard garden
    for (let i = 0; i < 4; i++) {
      b.paint(0x5a4432).box(2 + i * 2.2, 0, -13.8, 3.4 + i * 2.2, 0.25, -8.5);
      b.paint(0x5f8f3a, Surf.Foliage).box(2.15 + i * 2.2, 0.25, -13.6, 3.25 + i * 2.2, 0.6, -8.7, { bottom: null });
    }
    gardenShed(b, 13.0, -12.5, 3.0, 2.6, 0x9aa596, 0x3e4146, 0);
    b.paint(0x777067, Surf.Stone).cylinder(-6, -9, 0, 0.4, 0.9, 0.9, 8);
    for (let i = 0; i < 4; i++) b.paint(0x8a6a48, Surf.Wood).box(-6 + Math.cos(i * 1.57) * 2.2 - 0.6, 0, -9 + Math.sin(i * 1.57) * 2.2 - 0.25, -6 + Math.cos(i * 1.57) * 2.2 + 0.6, 0.45, -9 + Math.sin(i * 1.57) * 2.2 + 0.25, { bottom: null });
    boardFence(b, -15.8, -15.8, 15.8, -15.8, 1.2, 0x8a7458);
    tree(b, rng, -12.5, -11, 1.3, 'wide');
    tree(b, rng, 12.5, 10.5, 1.2, 'round');
    tree(b, rng, -3.5, 12.0, 1.0, 'round', 0xa0662a);
    bushRow(b, -6.5, 6.6, -1.0, 6.6, 3, 0.55, 0x4a7434, 3);
    mailbox(b, -8.6, 15.2);
  } else if (v === 2) {
    // U-shaped painted-brick ranch around a pool court
    const brick = P(0xe6e1d8, Surf.Brick);
    body(b, -13, -2, 13, 5, 0.3, 3.1, brick);
    body(b, -13, -11, -7, -2, 0.3, 3.1, brick);
    body(b, 7, -11, 13, -2, 0.3, 3.1, brick);
    const roof = P(0x2f3236, Surf.RoofTiles);
    roofHip(b, 0, 1.5, 26, 7, 3.1, 2.2, roof, { over: 0.55 });
    roofHip(b, -10, -6.5, 6, 9, 3.1, 2.0, roof, { over: 0.55 });
    roofHip(b, 10, -6.5, 6, 9, 3.1, 2.0, roof, { over: 0.55 });
    const ws: WinStyle = { mull: 2, frame: 0x2a2c2e, shutter: 0x2a2c2e };
    inFace(b, 'pz', 5, () => {
      door(b, -1.0, 0.3, 1.1, 2.3, 0x2a2c2e, { transom: true, lamp: true, frame: 0xd8d2c4 });
      for (const x of [-10.5, -7.5, -4.5, 3.0]) win(b, x, 1.0, 1.2, 1.5, ws);
      garageDoor(b, 7.2, 0.3, 2.6, 2.2, 0x2a2c2e, null);
      garageDoor(b, 10.4, 0.3, 2.6, 2.2, 0x2a2c2e, null);
    });
    b.paint(0x2a2c2e).box(-2.4, 2.8, 5, 0.4, 2.95, 6.3, { nz: null });
    inFace(b, 'pz', 5, () => steps(b, -1.0, 2.0, 1, 0.3, 0.45, 0xd8d2c4));
    wins(b, 'nz', -2, [-4, 0, 4], 0.3, 1.6, 2.2, { mull: 1, frame: 0x2a2c2e });
    wins(b, 'px', -7, [-8.5, -4.5], 1.0, 1.2, 1.5, { mull: 2, frame: 0x2a2c2e });
    wins(b, 'nx', 7, [-8.5, -4.5], 1.0, 1.2, 1.5, { mull: 2, frame: 0x2a2c2e });
    wins(b, 'nx', -13, [-8, -4, 2], 1.0, 1.2, 1.5, ws);
    wins(b, 'px', 13, [-8, -4], 1.0, 1.2, 1.5, ws);
    wins(b, 'nz', -11, [-10, 10], 1.0, 1.2, 1.5, { mull: 2, frame: 0x2a2c2e });
    chimney(b, -4.5, 1.5, 1.0, 1.0, 4.0, 6.5, 0xe6e1d8);
    poolRect(b, -4.5, -12.5, 4.5, -5.0, 0xe8e2d4, 1.4);
    lounger(b, -5.6, -3.4, Math.PI); lounger(b, -4.4, -3.4, Math.PI);
    patioSet(b, 3.8, -3.6, 0x2a3a5a);
    paveSlab(b, 5.4, 5, 12.2, 16, 0xb4aea3, 0.1);
    paveSlab(b, -1.6, 6.3, -0.4, 16, 0xc8c2b6, 0.08);
    parkedCar(b, rng, 10.4, 9.5, Math.PI);
    hedgeBox(b, -12.6, 5.6, -3.0, 6.4, 1.0, 0x3a6a2e);
    hedgeBox(b, 1.0, 5.6, 4.6, 6.4, 1.0, 0x3a6a2e);
    hedgeBox(b, -15.8, -15.8, 15.8, -15.0, 1.6);
    tree(b, rng, -10, 11.5, 1.3, 'round');
    tree(b, rng, 1.5, 12.5, 1.1, 'round');
    tree(b, rng, 14, -13.5, 1.0, 'cone');
    tree(b, rng, -14, -13.5, 1.0, 'cone');
    mailbox(b, 4.8, 15.2);
  } else if (v === 3) {
    // mid-century modern: low wide gable, deep eaves, glass walls, stone chimney wall, carport
    const wood = P(0x8a6448, Surf.Wood), white = P(0xebe8e0), stone = P(0x9c9486, Surf.Stone);
    body(b, -12, -5, 6, 3, 0.2, 3.2, white, 0x7e7a72);
    b.paint(wood).box(-12.02, 0.2, -5.02, -6, 3.2, 3.02, { top: null, bottom: null, px: null });
    b.paint(stone).box(-3.0, 0, -5.4, -2.2, 4.4, 3.4, { bottom: null });
    roofGable(b, -3, -1, 18, 8, 3.2, 1.2, 'x', P(0x55504a, Surf.RoofTiles), { gable: P(0x2a2c2e, Surf.GlassPlain), over: 1.3, rake: 1.0, t: 0.25, trim: 0xe8e4da });
    inFace(b, 'pz', 3, () => {
      glassWall(b, -1.6, 5.6, 0.25, 3.0, 0x2a2c2e, 1.8);
      door(b, -4.4, 0.2, 1.1, 2.3, 0xc8742a, { frame: 0x2a2c2e });
      win(b, -9.0, 2.0, 5.0, 0.9, { frame: 0x2a2c2e, ft: 0.06, mull: 1 });
    });
    inFace(b, 'nz', -5, () => glassWall(b, U('nz', 5.6), U('nz', -1.6), 0.25, 3.0, 0x2a2c2e, 1.8));
    wins(b, 'nz', -5, [-10, -7.5], 1.8, 1.8, 1.0, { frame: 0x2a2c2e, ft: 0.06 });
    wins(b, 'px', 6, [-3, 1], 1.0, 1.4, 1.8, { frame: 0x2a2c2e, ft: 0.06 });
    // flat carport on thin posts
    slabRoof(b, 6.6, -3.5, 13.8, 4.5, 2.7, 0.22, 0xe8e4da, 0x6e6a64);
    b.paint(0x2a2c2e, Surf.Metal);
    for (const [x, z] of [[13.4, -3.1], [13.4, 4.1], [7.0, 4.1]] as [number, number][]) b.box(x - 0.07, 0, z - 0.07, x + 0.07, 2.7, z + 0.07, { bottom: null, top: null });
    paveSlab(b, 7.0, -3.5, 13.6, 16, 0x9f9a92, 0.1);
    parkedCar(b, rng, 10.3, 0.5, 0, 0x5d8a8a);
    for (let i = 0; i < 6; i++) paveSlab(b, -4.9, 3.6 + i * 2.0, -3.9, 4.6 + i * 2.0, 0xcfc9bd, 0.09);
    // back pool
    poolRect(b, -8, -13, 2, -8.5, 0xd8d2c4, 1.3);
    lounger(b, 3.5, -12, 0.2); lounger(b, 4.6, -12, 0.1);
    b.paint(0xd8d2c4, Surf.Pavement).box(-12, 0, -8.5, 6, 0.12, -5, { bottom: null });
    for (let i = 0; i < 6; i++) bush(b, -11.4 + i * 1.4, 3.9, 0.45, 0x7f9a4a, i + 30);
    tree(b, rng, -12.0, 11.5, 1.1, 'column');
    tree(b, rng, -9.8, 12.2, 1.0, 'column');
    tree(b, rng, 1.0, 11.0, 1.3, 'wide');
    tree(b, rng, 13.0, -12.5, 1.1, 'round');
    hedgeBox(b, -15.8, -15.8, 15.8, -15.0, 1.4);
    mailbox(b, 6.5, 15.2, 0xc8742a);
  } else if (v === 4) {
    // Spanish-style ranch: stucco, terracotta, arcade porch, courtyard wall with fountain, pool
    const st = P(0xe8dcc0), roof = P(0xa65a3c, Surf.RoofTiles);
    body(b, -12, -6, 7, 2, 0.2, 3.3, st, 0xb8a888);
    body(b, 7, -6, 13, 6, 0.1, 3.1, st, 0xb8a888);
    roofHip(b, -2.5, -2, 19, 8, 3.3, 1.8, roof, { over: 0.5, trim: 0xe8dcc0 });
    roofHip(b, 10, 0, 6, 12, 3.1, 1.7, roof, { over: 0.5, trim: 0xe8dcc0 });
    // arcade: thick square piers + beam
    b.paint(0xbfae90, Surf.Pavement).box(-10, 0, 2, 6, 0.2, 4.6, { nz: null });
    b.paint(st.color);
    for (let i = 0; i < 5; i++) { const x = -9.6 + i * 3.8; b.box(x - 0.35, 0.2, 3.9, x + 0.35, 2.6, 4.6, { bottom: null, top: null }); }
    b.box(-10, 2.6, 2, 6, 3.2, 4.6, { nz: null });
    roofShed(b, -2, 3.3, 16, 2.6, 3.2, 0.2, 'nz', roof, { over: 0.35, rake: 0.2, t: 0.15, trim: 0xe8dcc0 });
    inFace(b, 'pz', 2, () => {
      door(b, -2.0, 0.2, 1.2, 2.3, 0x5a3a24, { surf: Surf.Wood, frame: 0x5a3a24 });
      for (const x of [-8.0, -5.0, 1.5, 4.5]) win(b, x, 0.9, 1.2, 1.5, { frame: 0x5a3a24, mull: 2 });
    });
    inFace(b, 'pz', 6, () => { garageDoor(b, 8.6, 0.1, 2.5, 2.2, 0x6b4a2e, 0xe8dcc0); garageDoor(b, 11.4, 0.1, 2.5, 2.2, 0x6b4a2e, 0xe8dcc0); });
    wins(b, 'nz', -6, [-10, -6, -2, 2, 5], 1.0, 1.1, 1.4, { frame: 0x5a3a24, mull: 2 });
    wins(b, 'nx', -12, [-3.5, -0.5], 1.0, 1.1, 1.4, { frame: 0x5a3a24, mull: 2 });
    wins(b, 'px', 13, [-3, 1], 1.0, 1.0, 1.2, { frame: 0x5a3a24, mull: 2 });
    chimney(b, -7.5, -3.5, 1.0, 1.0, 3.0, 6.0, 0xe8dcc0, Surf.Plain);
    // courtyard wall with gate opening + fountain
    lowWall(b, -12, 9.5, -3.2, 9.9, 1.3, 0xe2d4b6, Surf.Plain, 0xa65a3c);
    lowWall(b, -0.8, 9.5, 6.0, 9.9, 1.3, 0xe2d4b6, Surf.Plain, 0xa65a3c);
    lowWall(b, -12.4, 4.6, -12, 9.9, 1.3, 0xe2d4b6, Surf.Plain, 0xa65a3c);
    paveSlab(b, -11.8, 4.6, 5.8, 9.5, 0xd2c09a, 0.1);
    fountainSmall(b, -6.5, 7.0);
    planter(b, 2.5, 7.0, 1.4, 1.4, 0.1, 0xa65a3c, 0x5a8a3a, 2);
    paveSlab(b, -3.2, 9.5, -0.8, 16, 0xd2c09a, 0.08);
    paveSlab(b, 7.4, 6, 12.6, 16, 0xc2b494, 0.1);
    parkedCar(b, rng, 11.4, 10.0, Math.PI);
    poolRect(b, -9, -13.5, 0, -9, 0xd8c8a8, 1.2);
    lounger(b, 2.0, -12, 0); lounger(b, 3.2, -12, 0);
    tree(b, rng, -14, 13, 1.0, 'column', 0x3f5a2e);
    tree(b, rng, 4.5, 13, 1.0, 'column', 0x3f5a2e);
    tree(b, rng, 12.5, -12.5, 1.2, 'wide', 0x6a7a44);
    tree(b, rng, -13.5, -12.5, 1.1, 'round', 0x6a7a44);
    mailbox(b, 6.8, 15.2);
  } else {
    // T-shaped ranch with 3-car garage and big backyard pool
    const sid = P(0x7d8f9e, Surf.Wood), roof = P(0x3c3f44, Surf.RoofTiles);
    body(b, -13, -3, 6, 4, 0.35, 3.1, sid);
    body(b, -5, -10, 1, -3, 0.35, 3.1, sid);
    body(b, 6, -4, 14, 5, 0.1, 3.0, sid, CONCRETE);
    roofGable(b, -3.5, 0.5, 19, 7, 3.1, 2.2, 'x', roof, { gable: sid, over: 0.5 });
    roofGable(b, -2, -6.5, 6, 7, 3.1, 2.1, 'z', roof, { gable: sid, over: 0.5 });
    roofHip(b, 10, 0.5, 8, 9, 3.0, 2.0, roof, { over: 0.5 });
    // front gable accent over entry
    roofGable(b, -3.0, 4.5, 4.0, 2.0, 3.1, 1.6, 'z', roof, { gable: P(TRIM, Surf.Wood), over: 0.2, rake: 0.3 });
    b.paint(TRIM).box(-4.9, 0.35, 5.2, -4.7, 3.0, 5.4).box(-1.3, 0.35, 5.2, -1.1, 3.0, 5.4);
    b.paint(0xc8c2b6, Surf.Pavement).box(-5, 0, 4, -1, 0.35, 5.5, { nz: null });
    inFace(b, 'pz', 4, () => {
      door(b, -3.0, 0.35, 1.0, 2.2, 0x7e2a26, { sidelights: true, lamp: true });
      for (const x of [-10.5, -7.5, 1.0, 3.8]) win(b, x, 1.1, 1.4, 1.4, { mull: 2, sill: TRIM });
    });
    inFace(b, 'pz', 5, () => { for (const x of [7.4, 10, 12.6]) garageDoor(b, x, 0.1, 2.3, 2.2, 0xece8de, TRIM, true); });
    wins(b, 'nx', -13, [-1.5, 2], 1.1, 1.0, 1.3, { mull: 2 });
    wins(b, 'nx', -5, [-8, -5], 1.1, 1.0, 1.3, { mull: 2 });
    wins(b, 'px', 1, [-8, -5], 1.1, 1.0, 1.3, { mull: 2 });
    wins(b, 'nz', -10, [-3.5, -0.5], 0.35, 1.2, 2.2, { mull: 1 });
    wins(b, 'nz', -3, [-11, -8, 3.5], 1.1, 1.2, 1.3, { mull: 2 });
    paveSlab(b, 6.2, 5, 13.8, 16, CONCRETE, 0.1);
    paveSlab(b, -3.6, 5.5, -2.4, 9.0, 0xc8c2b6, 0.08);
    paveSlab(b, -3.6, 8.0, 6.2, 9.0, 0xc8c2b6, 0.08);
    parkedCar(b, rng, 10, 9.5, Math.PI);
    // pool deck and pool
    poolRect(b, 3.5, -14, 13, -7, 0xe4dccb, 1.6);
    lounger(b, 5, -5.2, Math.PI); lounger(b, 6.2, -5.2, Math.PI); lounger(b, 7.4, -5.2, Math.PI);
    patioSet(b, -9, -6.5, 0x3a6a8a); patioSet(b, -9.5, -9.8, 0x3a6a8a);
    b.paint(0xd4ccbc, Surf.Pavement).box(-12, 0, -11.5, -5, 0.1, -3, { bottom: null });
    grill(b, -6.2, -4.0);
    hedgeBox(b, -15.8, -15.8, 15.8, -15.0, 1.6, 0x3a6a2e);
    hedgeBox(b, 15.0, -15.8, 15.8, 4.0, 1.6, 0x3a6a2e);
    hedgeBox(b, -15.8, -15.8, -15.0, 4.0, 1.6, 0x3a6a2e);
    bushRow(b, -12.4, 4.7, -6.5, 4.7, 4, 0.55, 0x4a7434, 5);
    tree(b, rng, -9, 11.5, 1.3, 'round');
    tree(b, rng, 1.5, 12.0, 1.2, 'wide');
    tree(b, rng, -13.5, -13.5, 1.0, 'cone');
    mailbox(b, 5.8, 15.2);
  }
}

function fountainSmall(b: ModelBuilder, x: number, z: number): void {
  b.paint(0xd6c7a6).cylinder(x, z, 0, 0.6, 1.3, 1.3, 10, { top: false, smooth: false });
  b.paint(0x4fa6c9, Surf.Water).cylinder(x, z, 0.5, 0.02, 1.15, 1.15, 10);
  b.paint(0xd6c7a6).cylinder(x, z, 0.5, 1.0, 0.15, 0.12, 6);
}

// ---------------------------------------------------------------------------------------------- VILLA (R$$$) 32 x 32
function villa(b: ModelBuilder, v: number, rng: RNG): void {
  lawnSlab(b, -16, -16, 16, 16, 0x5a8c3a);
  if (v === 0) {
    // modern white cubes, cantilevered upper volume, roof pavilion, pool in the front garden
    const white = P(0xefede8), wood = P(0x9a7250, Surf.Wood);
    body(b, -10, -9, 6, 0, 0.2, 3.4, white, 0x8f8b84);
    b.paint(0x44474b).box(-10.2, 3.4, -9.2, 6.2, 3.7, 0.2, { bottom: undefined, top: null });
    b.paint(white).box(-6, 3.7, -8, 11, 7.0, 1.5, { top: null, bottom: undefined });
    flatRoof(b, -6, -8, 11, 1.5, 7.0, 0.35, 0.15, 0xefede8, 0x6a6660);
    // roof pavilion
    b.paint(0x2a2c2e).box(-2.5, 7.0, -6.5, 3.5, 9.4, -2.0, { top: null, bottom: null });
    slabRoof(b, -3.2, -7.2, 4.2, -1.3, 9.4, 0.25, 0xefede8);
    inFace(b, 'pz', -2.0, () => glassWall(b, -2.3, 3.3, 7.0, 9.2, 0x2a2c2e, 1.5));
    b.paint(wood).box(-14, 0.0, -8, -10, 7.6, -3, { bottom: null });
    inFace(b, 'pz', 0, () => { glassWall(b, -9.6, 1.0, 0.25, 3.2, 0x2a2c2e, 1.8); door(b, 3.5, 0.2, 1.4, 2.8, 0x9a7250, { surf: Surf.Wood, frame: 0x2a2c2e }); });
    inFace(b, 'pz', 1.5, () => { win(b, -1.0, 4.4, 9.0, 1.9, { frame: 0x2a2c2e, ft: 0.08, mull: 1 }); win(b, 7.5, 4.4, 5.0, 1.9, { frame: 0x2a2c2e, ft: 0.08 }); });
    inFace(b, 'nz', -9, () => glassWall(b, U('nz', 5.6), U('nz', -9.6), 0.25, 3.2, 0x2a2c2e, 1.8));
    wins(b, 'nz', -8, [-3, 5], 4.4, 4.0, 1.9, { frame: 0x2a2c2e, ft: 0.08 });
    wins(b, 'px', 11, [-5, -1.5], 4.4, 2.2, 1.9, { frame: 0x2a2c2e, ft: 0.08 });
    // carport under cantilever
    paveSlab(b, 6.2, -8, 11, 1.5, 0x9f9a92, 0.1);
    parkedCar(b, rng, 8.6, -3.5, 0, 0x2b2d31);
    paveSlab(b, 6.4, 1.5, 10.8, 16, 0x9f9a92, 0.1);
    gate(b, 6.6, 10.6, 14.5, 0xefede8, 0x2a2c2e, 1.9);
    // pool + deck in front garden
    b.paint(0x9a7250, Surf.Wood).box(-14.5, 0, 0.2, 3.5, 0.2, 9.5, { bottom: null });
    b.paint(0x3fb0d8, Surf.Water).box(-13.5, 0, 3.0, -1.0, 0.22, 7.8, { bottom: null });
    for (const x of [-11.8, -10.4, -9.0]) lounger(b, x, 1.6, Math.PI, 0xf2f0ea);
    hedgeBox(b, -15.8, 14.6, 5.4, 15.4, 1.6, 0x355e28);
    hedgeBox(b, -15.8, -15.8, -15.0, 14.6, 1.8, 0x355e28);
    hedgeBox(b, 12.0, 14.6, 15.8, 15.4, 1.6, 0x355e28);
    tree(b, rng, -4.5, 12.0, 0.9, 'column');
    tree(b, rng, -2.5, 12.0, 0.9, 'column');
    tree(b, rng, -0.5, 12.0, 0.9, 'column');
    tree(b, rng, 13.5, -12.5, 1.2, 'wide');
    tree(b, rng, -12, -12.5, 1.1, 'round');
    for (let i = 0; i < 5; i++) bush(b, 1.5 + i * 0.9, 1.2, 0.45, 0x8a9a52, i + 3);
  } else if (v === 1) {
    // Mediterranean: cream stucco, terracotta hips, loggia, wrought-iron balcony, cypresses, pool behind
    const st = P(0xece0c4), roof = P(0xb0603f, Surf.RoofTiles), trim = 0xf6efe0;
    body(b, -10, -7, 5, 1, 0.3, 6.6, st, 0xc8b89a);
    roofHip(b, -2.5, -3, 15, 8, 6.6, 2.4, roof, { over: 0.55, trim: 0xece0c4 });
    body(b, 5, -6, 13, 0, 0.3, 3.6, st, 0xc8b89a);
    roofHip(b, 9, -3, 8, 6, 3.6, 1.8, roof, { over: 0.5, trim: 0xece0c4 });
    // projecting entry bay 3 storeys with hip
    body(b, -4.5, 1, -0.5, 2.8, 0.3, 7.6, st, 0xc8b89a);
    roofHip(b, -2.5, 1.9, 4, 1.8, 7.6, 1.2, roof, { over: 0.4, trim: 0xece0c4 });
    // loggia along the front of the main block (left of entry)
    b.paint(0xd8c8a8, Surf.Pavement).box(-10, 0, 1, -4.5, 0.3, 3.8, { nz: null, px: null });
    for (const x of [-9.6, -7.3, -5.0]) column(b, x, 3.4, 0.3, 3.3, 0.22, trim);
    b.paint(st.color).box(-10, 3.3, 1, -4.5, 3.8, 3.8, { nz: null, px: null });
    b.paint(0x222426, Surf.Metal).box(-10, 3.8, 3.72, -4.5, 4.8, 3.8, { bottom: null });
    inFace(b, 'pz', 2.8, () => {
      door(b, -2.5, 0.3, 1.4, 2.6, 0x5a3a24, { surf: Surf.Wood, transom: true, frame: trim, lamp: true });
      win(b, -2.5, 4.3, 1.2, 1.9, { frame: trim, mull: 2 });
    });
    // wrought iron balcony over the entry
    b.paint(0xd8c8a8).box(-3.6, 4.1, 2.8, -1.4, 4.25, 3.6, { nz: null });
    b.paint(0x222426, Surf.Metal).quad2([-3.6, 4.25, 3.6], [-1.4, 4.25, 3.6], [-1.4, 5.1, 3.6], [-3.6, 5.1, 3.6]);
    inFace(b, 'pz', 1, () => {
      for (const x of [-8.5, -6.0]) win(b, x, 0.9, 1.2, 2.0, { frame: trim, mull: 2 });
      for (const x of [-8.5, -6.0, 1.5, 3.8]) win(b, x, 4.2, 1.1, 1.6, { frame: trim, mull: 2, shutter: 0x55704a });
      for (const x of [1.5, 3.8]) win(b, x, 0.9, 1.2, 2.0, { frame: trim, mull: 2, shutter: 0x55704a });
    });
    wins(b, 'pz', 0, [7.0, 11.0], 0.9, 1.3, 1.9, { frame: trim, mull: 2, shutter: 0x55704a });
    wins(b, 'nx', -10, [-5, -1], 0.9, 1.1, 1.8, { frame: trim, mull: 2 });
    wins(b, 'nx', -10, [-5, -1], 4.2, 1.1, 1.5, { frame: trim, mull: 2 });
    wins(b, 'nz', -7, [-8, -5, -2, 1, 4], 4.2, 1.1, 1.5, { frame: trim, mull: 2 });
    wins(b, 'nz', -7, [-8, -2, 4], 0.4, 1.6, 2.4, { frame: trim, mull: 1 });
    wins(b, 'px', 13, [-3], 0.9, 1.2, 1.6, { frame: trim, mull: 2 });
    chimney(b, -8.0, -5.0, 1.0, 1.0, 6.0, 9.6, 0xece0c4, Surf.Plain);
    // gravel forecourt, gate, cypress-lined drive
    paveSlab(b, -9, 4.2, 12, 10, 0xd9ccaa, 0.08);
    paveSlab(b, 3.0, 10, 7.0, 16, 0xd9ccaa, 0.08);
    fountainSmall(b, -3.0, 7.0);
    gate(b, 3.2, 6.8, 14.8, 0xe2d4b6, 0x222426);
    lowWall(b, -15.8, 14.4, 2.4, 15.2, 1.5, 0xe2d4b6, Surf.Plain, 0xb0603f);
    lowWall(b, 7.6, 14.4, 15.8, 15.2, 1.5, 0xe2d4b6, Surf.Plain, 0xb0603f);
    parkedCar(b, rng, 9.0, 6.5, -Math.PI / 2, 0xe8e6e0);
    for (const z of [11.0, 13.0]) { tree(b, rng, 1.8, z, 1.1, 'column', 0x34502a); tree(b, rng, 8.2, z, 1.1, 'column', 0x34502a); }
    poolRect(b, -8, -14, 2, -10.0, 0xe2d6bc, 1.4);
    for (const x of [4.0, 5.2]) lounger(b, x, -12.5, 0.1);
    patioSet(b, 9.5, -9.5, 0xe8dcc0);
    tree(b, rng, -13.5, -12.5, 1.1, 'wide', 0x6a7a44);
    tree(b, rng, 13.0, -12.0, 1.0, 'wide', 0x6a7a44);
    hedgeBox(b, -15.8, -15.8, 15.8, -15.0, 1.8, 0x355e28);
    for (let i = 0; i < 4; i++) planter(b, -8 + i * 2.2, 4.8, 0.8, 0.8, 0.08, 0xb0603f, 0x6a8a3a, i);
  } else if (v === 2) {
    // prairie-modern: stone walls, wood, long thin overhanging roofs
    const stone = P(0xa89c88, Surf.Stone), wood = P(0x7a5a40, Surf.Wood), glassF = 0x2a2c2e;
    body(b, -12, -8, 8, 0, 0.2, 3.4, stone, 0x7e7a72);
    b.paint(wood).box(-7.5, 3.4, -9, 4.5, 6.8, -1.5, { top: null, bottom: undefined });
    slabRoof(b, -13.8, -9.8, 10.0, 1.8, 3.4, 0.35, 0xe8e4da);
    slabRoof(b, -9.0, -10.6, 6.2, 0.2, 6.8, 0.35, 0xe8e4da);
    inFace(b, 'pz', 0, () => { glassWall(b, -6.0, 5.0, 0.25, 3.3, glassF, 1.6); door(b, -9.2, 0.2, 1.3, 2.6, 0x3a2a22, { surf: Surf.Wood, frame: glassF }); });
    inFace(b, 'pz', -1.5, () => win(b, -1.5, 4.0, 10.0, 2.2, { frame: glassF, ft: 0.08, mull: 3 }));
    inFace(b, 'nz', -8, () => glassWall(b, U('nz', 7.0), U('nz', -5.0), 0.25, 3.3, glassF, 1.6));
    wins(b, 'nz', -9, [-4, 2], 4.0, 4.0, 2.0, { frame: glassF, ft: 0.08 });
    wins(b, 'px', 8, [-6, -2], 0.9, 1.6, 2.0, { frame: glassF, ft: 0.08 });
    wins(b, 'nx', -12, [-5], 0.9, 1.6, 2.0, { frame: glassF, ft: 0.08 });
    b.paint(0x8a8274, Surf.Stone).box(-12.8, 0, -4.8, -11.6, 8.2, -3.2, { bottom: null });
    // garage wing
    body(b, 8, -7, 14.5, 0, 0.1, 3.0, stone, 0x7e7a72);
    inFace(b, 'pz', 0, () => { garageDoor(b, 9.7, 0.1, 2.6, 2.3, 0x5a4432, null); garageDoor(b, 12.8, 0.1, 2.6, 2.3, 0x5a4432, null); });
    slabRoof(b, 7.8, -7.6, 15.2, 1.0, 3.0, 0.3, 0xe8e4da);
    paveSlab(b, 8.2, 1.0, 14.2, 16, 0x8f8a82, 0.1);
    gate(b, 8.6, 13.8, 14.8, 0xa89c88, 0x2a2c2e, 1.8);
    parkedCar(b, rng, 12.8, 5.0, Math.PI, 0xb8bcc2);
    // terrace + pool side
    b.paint(0xcfc8b8, Surf.Pavement).box(-14.5, 0, 1.8, 6, 0.15, 6.5, { bottom: null });
    b.paint(0x3fb0d8, Surf.Water).box(-13.5, 0, 6.5, -3.0, 0.17, 10.5, { bottom: null });
    b.paint(0xcfc8b8, Surf.Pavement).box(-14.5, 0, 10.5, -2.0, 0.15, 11.5, { bottom: null });
    b.paint(0xcfc8b8, Surf.Pavement).box(-3.0, 0, 6.5, -2.0, 0.15, 10.5, { bottom: null });
    for (const x of [-1.0, 0.4, 1.8]) lounger(b, x, 4.0, Math.PI);
    hedgeBox(b, -15.8, 14.4, 7.8, 15.3, 1.7, 0x355e28);
    for (let i = 0; i < 7; i++) bush(b, -1 + i * 1.2, 9.5, 0.55, 0x7f9a4a, i + 9);
    tree(b, rng, 3.0, 12.5, 1.2, 'wide');
    tree(b, rng, -13.0, -13.0, 1.1, 'round');
    tree(b, rng, 12.5, -12.5, 1.2, 'wide');
  } else if (v === 3) {
    // Tuscan farmhouse with 3-storey tower, ochre stucco, pergola, pool
    const ochre = P(0xd8b278), roof = P(0xa45a3a, Surf.RoofTiles), trim = 0xf0e6d0;
    body(b, -11, -6, 4, 1, 0.3, 6.4, ochre, 0xb09470);
    roofGable(b, -3.5, -2.5, 15, 7, 6.4, 2.2, 'x', roof, { gable: ochre, over: 0.5, rake: 0.4, trim: 0xd8b278 });
    body(b, 4, -5, 12, 0, 0.3, 3.5, P(0xcfa56c), 0xb09470);
    roofGable(b, 8, -2.5, 8, 5, 3.5, 1.6, 'x', roof, { gable: P(0xcfa56c), over: 0.4, trim: 0xcfa56c });
    body(b, 1, -1, 5, 3, 0.3, 9.6, ochre, 0xb09470);
    roofHip(b, 3, 1, 4, 4, 9.6, 1.5, roof, { over: 0.5, trim: 0xd8b278 });
    const ws: WinStyle = { frame: trim, mull: 2, shutter: 0x6a7a55, sill: trim };
    inFace(b, 'pz', 3, () => { door(b, 3, 0.3, 1.3, 2.5, 0x5a3a24, { surf: Surf.Wood, frame: trim, lamp: true }); win(b, 3, 4.2, 1.0, 1.5, ws); win(b, 3, 7.4, 1.0, 1.2, { frame: trim, mull: 2 }); });
    inFace(b, 'pz', 1, () => { for (const x of [-9, -6, -3]) { win(b, x, 1.0, 1.1, 1.7, ws); win(b, x, 4.2, 1.0, 1.5, ws); } win(b, -0.3, 4.2, 1.0, 1.5, ws); });
    wins(b, 'pz', 0, [6.5, 10], 1.0, 1.1, 1.6, ws);
    wins(b, 'nx', -11, [-4.5, -0.8], 1.0, 1.0, 1.6, ws);
    wins(b, 'nx', -11, [-4.5, -0.8], 4.2, 1.0, 1.5, ws);
    wins(b, 'nz', -6, [-9, -6, -3, 0, 3], 4.2, 1.0, 1.5, ws);
    wins(b, 'px', 5, [1.0], 7.4, 1.0, 1.2, { frame: trim, mull: 2 });
    wins(b, 'px', 12, [-2.5], 1.0, 1.1, 1.6, ws);
    // pergola on the right with vines
    b.paint(0x7a5a3c, Surf.Wood);
    for (const [x, z] of [[6, 1], [12, 1], [6, 5], [12, 5]] as [number, number][]) b.box(x - 0.15, 0, z - 0.15, x + 0.15, 2.8, z + 0.15, { bottom: null });
    for (let i = 0; i < 6; i++) b.box(5.8 + i * 1.25, 2.8, 0.2, 6.0 + i * 1.25, 3.0, 5.8, { bottom: null });
    b.paint(0x5a7a34, Surf.Foliage).box(5.8, 3.0, 0.4, 12.2, 3.25, 3.2, { bottom: null });
    b.paint(0xc8b490, Surf.Pavement).box(5.5, 0, 0, 12.5, 0.12, 5.5, { bottom: null });
    patioSet(b, 9, 3.0, 0xf0e6d0);
    // gravel drive with cypress allée
    paveSlab(b, -9, 3, 1, 9, 0xd8c8a0, 0.08);
    paveSlab(b, -6, 9, -2, 16, 0xd8c8a0, 0.08);
    for (const z of [10, 12.5]) { tree(b, rng, -7.2, z, 1.1, 'column', 0x34502a); tree(b, rng, -0.8, z, 1.1, 'column', 0x34502a); }
    gate(b, -5.8, -2.2, 15.0, 0xd8b278, 0x222426, 1.8);
    parkedCar(b, rng, -5.0, 5.5, Math.PI / 2, 0x3e5e3a);
    poolRect(b, -1, -14, 9, -9.5, 0xdccaa4, 1.3);
    lounger(b, 11.5, -12, 0); lounger(b, 12.7, -12, 0);
    for (let i = 0; i < 4; i++) tree(b, rng, -13 + i * 3.2, -12.5, 0.8, 'round', 0x6a7a44);
    lowWall(b, -15.8, 14.6, -6.6, 15.2, 1.1, 0xb8a888, Surf.Stone, 0xd8c8a8);
    lowWall(b, -1.4, 14.6, 15.8, 15.2, 1.1, 0xb8a888, Surf.Stone, 0xd8c8a8);
    for (let i = 0; i < 3; i++) planter(b, 7 + i * 2.5, 9.5, 1.0, 1.0, 0.0, 0xa45a3a, 0x6a8a3a, i + 1);
  } else if (v === 4) {
    // modern farmhouse: white board & batten, black metal gables, glass link, porch, pool
    const bb = P(0xf0eee8, Surf.Corrugated), metal = P(0x2e3033, Surf.Metal), black = 0x1f2124;
    body(b, -12, -5, -2, 2, 0.3, 6.0, bb);
    roofGable(b, -7, -1.5, 10, 7, 6.0, 3.6, 'z', metal, { gable: bb, over: 0.3, rake: 0.3, trim: black, t: 0.1 });
    body(b, 3, -6, 12, 0, 0.3, 3.4, bb);
    roofGable(b, 7.5, -3, 9, 6, 3.4, 2.8, 'x', metal, { gable: bb, over: 0.3, rake: 0.3, trim: black, t: 0.1 });
    b.paint(0x2a3440, Surf.GlassPlain).box(-2, 0.3, -4, 3, 3.3, 0, { top: null, bottom: null });
    b.paint(black).box(-2.1, 3.3, -4.1, 3.1, 3.55, 0.1, { bottom: undefined });
    porch(b, -12, -2, 2, 2.6, 0.3, 3.3, metal, { posts: 4, post: black, rail: null, deck: 0x8a7058 });
    inFace(b, 'pz', 2, () => {
      door(b, -7, 0.3, 1.2, 2.4, 0x1f2124, { frame: black, lite: true, lamp: true });
      for (const x of [-10.3, -3.7]) win(b, x, 0.8, 1.4, 2.0, { frame: black, ft: 0.07, mull: 2 });
      for (const x of [-9.4, -4.6]) win(b, x, 3.9, 1.2, 1.5, { frame: black, ft: 0.07, mull: 2 });
      win(b, -7, 6.6, 1.0, 1.4, { frame: black, ft: 0.07 });
    });
    inFace(b, 'pz', 0, () => { garageDoor(b, 5.5, 0.3, 2.6, 2.4, 0x2e3033, null, true); garageDoor(b, 9.0, 0.3, 2.6, 2.4, 0x2e3033, null, true); });
    wins(b, 'nx', -12, [-3.5, 0.2], 0.8, 1.2, 1.9, { frame: black, ft: 0.07, mull: 2 });
    wins(b, 'nx', -12, [-1.5], 3.9, 1.2, 1.5, { frame: black, ft: 0.07 });
    wins(b, 'nz', -5, [-10, -7, -4], 3.9, 1.2, 1.5, { frame: black, ft: 0.07 });
    wins(b, 'nz', -5, [-9, -5], 0.5, 2.0, 2.3, { frame: black, ft: 0.07, mull: 1 });
    wins(b, 'px', 12, [-3], 1.0, 1.2, 1.5, { frame: black, ft: 0.07 });
    chimney(b, -3.2, -3.0, 1.0, 1.0, 5.5, 9.8, 0xf0eee8, Surf.Plain);
    paveSlab(b, 3.8, 0, 11.2, 16, 0x9f9a92, 0.1);
    gate(b, 4.4, 10.6, 15.0, 0x2e3033, 0x1f2124, 1.7);
    paveSlab(b, -7.6, 4.6, -6.4, 16, 0xc8c2b6, 0.08);
    parkedCar(b, rng, 9.0, 5.0, Math.PI, 0x1f3f7a);
    poolRect(b, -13, -14, -2, -9, 0xd8d2c4, 1.3);
    for (const x of [0, 1.2, 2.4]) lounger(b, x, -12, 0);
    hedgeBox(b, -15.8, 14.6, 3.2, 15.3, 1.3, 0x355e28);
    hedgeBox(b, 11.8, 14.6, 15.8, 15.3, 1.3, 0x355e28);
    for (let i = 0; i < 5; i++) bush(b, -11.4 + i * 1.6, 5.3, 0.55, 0x4a7434, i + 40);
    tree(b, rng, -12.5, 10.5, 1.3, 'wide');
    tree(b, rng, 13.0, -12.5, 1.1, 'round');
    tree(b, rng, 5.5, -12.5, 1.0, 'round');
  } else {
    // Hamptons shingle style: grey cedar shingles, white trim, gables, wrap porch, pool house
    const sh = P(0x9a978e, Surf.Wood), roof = P(0x5a5a5c, Surf.RoofTiles);
    body(b, -11, -6, 5, 1, 0.5, 6.4, sh);
    roofGable(b, -3, -2.5, 16, 7, 6.4, 3.4, 'x', roof, { gable: sh, over: 0.45, rake: 0.3 });
    body(b, -8.5, 1, -3.5, 3, 0.5, 6.4, sh);
    roofGable(b, -6, 1.2, 5, 3.6, 6.4, 2.8, 'z', roof, { gable: sh, over: 0.4, rake: 0.3 });
    body(b, 5, -5, 12, 0, 0.3, 3.4, sh);
    roofGable(b, 8.5, -2.5, 7, 5, 3.4, 2.2, 'x', roof, { gable: sh, over: 0.4 });
    for (const x of [-0.5, 2.5]) dormer(b, x, 0.2, 1, 6.4, 3.4 / 3.5, 1.4, 1.6, P(0x9a978e, Surf.Wood), roof);
    porch(b, -3.5, 5, 1, 2.6, 0.5, 3.4, roof, { posts: 4, post: TRIM, rail: TRIM, gap: [0.2, 1.8] });
    porch(b, -11.8, -8.5, 1, 2.6, 0.5, 3.4, roof, { posts: 2, post: TRIM, rail: TRIM });
    inFace(b, 'pz', 1, () => { door(b, 1.0, 0.5, 1.1, 2.3, 0x2c3b57, { sidelights: true, lamp: true }); win(b, 3.6, 1.2, 1.2, 1.6, { mull: 3 }); win(b, -2.2, 1.2, 1.2, 1.6, { mull: 3 }); });
    inFace(b, 'pz', 3, () => { win(b, -6, 1.2, 2.2, 1.6, { mull: 3 }); win(b, -6, 3.9, 1.6, 1.4, { mull: 3 }); win(b, -6, 6.9, 0.9, 0.9, { mull: 2 }); });
    inFace(b, 'pz', 0, () => { garageDoor(b, 7, 0.3, 2.6, 2.3, TRIM, TRIM, true); garageDoor(b, 10.2, 0.3, 2.6, 2.3, TRIM, TRIM, true); });
    wins(b, 'nx', -11, [-4.5, -1.5], 1.2, 1.1, 1.5, { mull: 3 });
    wins(b, 'nx', -11, [-4.5, -1.5], 3.9, 1.1, 1.4, { mull: 3 });
    wins(b, 'nz', -6, [-9, -6, -3, 0, 3], 3.9, 1.1, 1.4, { mull: 3 });
    wins(b, 'nz', -6, [-7.5, -1.5, 2.5], 1.0, 1.8, 1.8, { mull: 3 });
    wins(b, 'px', 12, [-2.5], 1.0, 1.2, 1.4, { mull: 2 });
    chimney(b, -9.5, -3.2, 1.1, 1.1, 6.0, 10.5, 0x9a6a58);
    chimney(b, 3.5, -4.2, 1.0, 1.0, 6.0, 10.0, 0x9a6a58);
    // gravel drive loop + gate
    paveSlab(b, 5.4, 0, 11.6, 16, 0xd8d0bc, 0.08);
    paveSlab(b, -2, 3.6, 5.4, 8.5, 0xd8d0bc, 0.08);
    gate(b, 6.0, 11.0, 15.0, 0xefe9dc, 0x2a2a2a, 1.6);
    parkedCar(b, rng, 1.5, 6.0, -Math.PI / 2, 0x1f3f7a);
    hedgeBox(b, -15.8, 14.5, 5.0, 15.4, 2.0, 0x355e28);
    hedgeBox(b, 12.0, 14.5, 15.8, 15.4, 2.0, 0x355e28);
    hedgeBox(b, -15.8, -15.8, -15.0, 14.5, 2.0, 0x355e28);
    // pool + pool house
    poolRect(b, -8, -14.5, 3, -9.5, 0xe6e0d2, 1.3);
    body(b, 7.5, -15.2, 12.5, -11.2, 0.15, 2.8, sh);
    roofHip(b, 10, -13.2, 5, 4, 2.8, 1.5, roof, { over: 0.35 });
    wins(b, 'nx', 7.5, [-13.2], 0.4, 2.0, 2.1, { mull: 1 });
    for (const z of [-13.5, -11.5]) lounger(b, 5.0, z, -Math.PI / 2);
    bushRow(b, -11, 4.2, -9.2, 4.2, 2, 0.6, 0x5a8a3a, 2);
    for (let i = 0; i < 6; i++) bush(b, -14 + i * 1.3, 8.5, 0.7, i % 2 ? 0x8f86c0 : 0x5a8a3a, i + 50, 0.9);
    tree(b, rng, -12.5, 11.0, 1.2, 'wide');
    tree(b, rng, 13.3, -6, 1.1, 'round');
  }
}

// ---------------------------------------------------------------------------------------------- MANSION (R$$$) 48 x 48
function mansion(b: ModelBuilder, v: number, rng: RNG): void {
  lawnSlab(b, -24, -24, 24, 24, 0x5a8c3a);
  if (v === 0) {
    // Georgian red brick: portico with pediment, hip roof + dormers, wings, circular drive w/ fountain, pool, tennis
    const brick = P(0x8f4a38, Surf.Brick), stone = 0xe8e2d4, roof = P(0x4a5058, Surf.RoofTiles);
    body(b, -12, -8, 12, 4, 0.8, 8.8, brick, 0xb8b0a0);
    roofHip(b, 0, -2, 24, 12, 8.8, 3.6, roof, { over: 0.45, trim: stone });
    band(b, -12, -8, 12, 4, 8.3, 0.5, 0.2, stone, false);
    for (const [x, z] of [[-12, 4], [12, 4]] as [number, number][]) b.paint(stone).box(x - 0.25, 0.8, z - 0.25, x + 0.25, 8.3, z + 0.25, { bottom: null, top: null });
    for (const x of [-6, 0, 6]) dormer(b, x, 1.6, 4, 8.8, 3.6 / 6, 1.6, 1.9, P(stone), roof, stone, -1.5);
    for (const x of [-9, 9]) chimney(b, x, -2, 1.2, 3.2, 8.5, 13.4, 0x8f4a38);
    const ws: WinStyle = { frame: stone, mull: 2, sill: stone };
    inFace(b, 'pz', 4, () => {
      for (const x of [-10, -7.2, -4.4, 4.4, 7.2, 10]) { win(b, x, 1.8, 1.2, 2.0, ws); win(b, x, 5.4, 1.2, 1.9, ws); }
      door(b, 0, 0.8, 1.6, 2.8, 0x2a2a2a, { transom: true, sidelights: true, frame: stone });
      win(b, 0, 5.4, 1.6, 1.9, ws);
    });
    wins(b, 'nz', -8, [-10, -6, -2, 2, 6, 10], 1.8, 1.2, 2.0, { frame: stone });
    wins(b, 'nz', -8, [-10, -6, -2, 2, 6, 10], 5.4, 1.2, 1.9, { frame: stone });
    // portico
    b.paint(stone, Surf.Stone).box(-4.2, 0, 4, 4.2, 0.8, 8.2, { nz: null });
    inFace(b, 'pz', 8.2, () => steps(b, 0, 5.0, 3, 0.27, 0.4, stone, 0, Surf.Stone));
    for (const x of [-3.4, -1.15, 1.15, 3.4]) column(b, x, 7.5, 0.8, 7.6, 0.34, 0xf2eee4, 6);
    b.paint(0xf2eee4).box(-4.2, 7.6, 4, 4.2, 8.4, 8.2, { nz: null });
    roofGable(b, 0, 6.1, 8.4, 4.2, 8.4, 2.0, 'z', P(0x4a5058, Surf.RoofTiles), { gable: P(0xf2eee4), over: 0.15, rake: 0.25, trim: 0xf2eee4 });
    // wings
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? -20 : 12, x1 = s < 0 ? -12 : 20;
      body(b, x0, -6, x1, 2, 0.8, 5.0, brick, 0xb8b0a0);
      flatRoof(b, x0, -6, x1, 2, 5.0, 0.9, 0.3, 0xe8e2d4, 0x6a6660);
      wins(b, 'pz', 2, [x0 + 2, x0 + 4.7, x1 - 1.8].map((x) => x), 1.6, 1.2, 2.2, ws);
      wins(b, s < 0 ? 'nx' : 'px', s < 0 ? x0 : x1, [-4, -0.5], 1.6, 1.2, 2.2, { frame: stone });
    }
    // circular drive with fountain
    disc(b, 0, 15, 8.5, 0.09, 0xd8ccb0, Surf.Pavement, 16);
    b.paint(0x5e9040, Surf.Foliage).cylinder(0, 15, 0, 0.12, 4.6, 4.6, 12, { top: true, smooth: false });
    fountain(b, 0, 15, 2.3);
    paveSlab(b, -2.5, 22, 2.5, 24, 0xd8ccb0, 0.09);
    paveSlab(b, -2.5, 8.2, 2.5, 9.0, 0xd8ccb0, 0.09);
    gate(b, -2.5, 2.5, 23.0, 0xd8d0c0, 0x222426, 2.4);
    // formal hedges and gardens
    hedgeBox(b, -23.8, 22.6, -4.0, 23.6, 1.6, 0x355e28);
    hedgeBox(b, 4.0, 22.6, 23.8, 23.6, 1.6, 0x355e28);
    for (const s of [-1, 1]) {
      hedgeBox(b, s * 11 - 5, 17, s * 11 + 5, 17.8, 0.8, 0x3a6a2e);
      flowerBed(b, s * 11 - 3.5, 11.0, s * 11 + 3.5, 14.8, s < 0 ? 0xc4506a : 0xe6e0d0);
      tree(b, rng, s * 19, 14, 1.3, 'round');
    }
    // back: pool + tennis court
    poolRect(b, -19, -20, -9, -14, 0xe8e2d4, 1.6);
    for (const x of [-15, -13]) lounger(b, x, -11.5, Math.PI);
    tennisCourt(b, 9.5, -16.2, true);
    tree(b, rng, -21, -9.5, 1.2, 'wide');
    tree(b, rng, -6, -21, 1.1, 'round');
  } else if (v === 1) {
    // French chateau: limestone, slate mansards with dormers, corner pavilions, parterre & gravel forecourt
    const lime = P(0xdad2c0, Surf.Stone), slate = P(0x444a52, Surf.RoofTiles), top = P(0x3a3f45, Surf.RoofFlat), trim = 0xf0ebe0;
    body(b, -13, -9, 13, 2, 0.6, 8.6, lime, 0xb8b0a0);
    roofMansard(b, 0, -3.5, 26, 11, 8.6, 3.8, 2.0, slate, top, 0.3);
    band(b, -13, -9, 13, 2, 8.3, 0.35, 0.18, trim, false);
    // corner pavilions (taller, steeper)
    for (const s of [-1, 1]) {
      const cx = s * 13;
      body(b, cx - 4, -10, cx + 4, 4, 0.6, 9.4, lime, 0xb8b0a0);
      band(b, cx - 4, -10, cx + 4, 4, 9.1, 0.35, 0.18, trim, false);
      roofMansard(b, cx, -3, 8, 14, 9.4, 4.8, 2.4, slate, top, 0.3);
      b.paint(0x2e3238, Surf.Metal).box(cx - 1.6, 14.2, -8.6, cx + 1.6, 14.4, 2.6, { bottom: null });
      inFace(b, 'pz', 4, () => { win(b, cx, 1.5, 1.4, 2.6, { frame: trim, mull: 2, head: trim }); win(b, cx, 5.4, 1.4, 2.4, { frame: trim, mull: 2, head: trim }); });
      wins(b, s < 0 ? 'nx' : 'px', cx + s * 4, [-7, -3, 1], 1.5, 1.3, 2.6, { frame: trim, mull: 2 });
      wins(b, s < 0 ? 'nx' : 'px', cx + s * 4, [-7, -3, 1], 5.4, 1.3, 2.3, { frame: trim });
      chimney(b, cx + s * 1.5, -6, 1.2, 0.8, 12.0, 15.6, 0xdad2c0, Surf.Stone);
    }
    // central pavilion bump with pediment & roof dormers
    body(b, -3.5, 2, 3.5, 3.4, 0.6, 9.2, lime, 0xb8b0a0);
    roofGable(b, 0, 2.2, 7, 2.8, 9.2, 2.0, 'z', slate, { gable: P(trim), over: 0.1, rake: 0.2, trim });
    inFace(b, 'pz', 3.4, () => { door(b, 0, 0.6, 1.8, 3.0, 0x2e3a4a, { transom: true, frame: trim }); win(b, -2.0, 5.4, 1.2, 2.3, { frame: trim, mull: 2 }); win(b, 2.0, 5.4, 1.2, 2.3, { frame: trim, mull: 2 }); win(b, 0, 5.4, 1.2, 2.3, { frame: trim, mull: 2 }); });
    inFace(b, 'pz', 2, () => { for (const x of [-7.5, -5.2, 5.2, 7.5]) { win(b, x, 1.5, 1.2, 2.6, { frame: trim, mull: 2, head: trim }); win(b, x, 5.4, 1.2, 2.3, { frame: trim, mull: 2 }); } });
    for (const x of [-6.5, 6.5]) dormer(b, x, 0.9, 2.3, 8.6, 3.8 / 2.0, 1.3, 1.8, P(trim), slate, trim, -0.2);
    wins(b, 'nz', -9, [-7.5, -3.75, 0, 3.75, 7.5], 1.5, 1.2, 2.6, { frame: trim });
    wins(b, 'nz', -9, [-7.5, -3.75, 0, 3.75, 7.5], 5.4, 1.2, 2.3, { frame: trim });
    b.paint(0xd8cfbe, Surf.Stone).box(-5, 0, 3.4, 5, 0.6, 5.6, { nz: null });
    inFace(b, 'pz', 5.6, () => steps(b, 0, 6, 2, 0.3, 0.45, 0xd8cfbe, 0, Surf.Stone));
    // gravel forecourt + fountain + parterres
    paveSlab(b, -9, 5.6, 9, 14, 0xd8ccae, 0.08);
    paveSlab(b, -2.2, 14, 2.2, 24, 0xd8ccae, 0.08);
    fountain(b, 0, 10, 2.4, 0xe0d8c8);
    for (const s of [-1, 1]) {
      const cx = s * 16;
      hedgeBox(b, cx - 6.5, 7.5, cx + 6.5, 8.1, 0.7, 0x2f5a26);
      hedgeBox(b, cx - 6.5, 19.5, cx + 6.5, 20.1, 0.7, 0x2f5a26);
      hedgeBox(b, cx - 6.5, 8.1, cx - 5.9, 19.5, 0.7, 0x2f5a26);
      hedgeBox(b, cx + 5.9, 8.1, cx + 6.5, 19.5, 0.7, 0x2f5a26);
      hedgeBox(b, cx - 5.9, 13.5, cx + 5.9, 14.1, 0.6, 0x2f5a26);
      flowerBed(b, cx - 5.4, 8.8, cx + 5.4, 13.0, 0xc4506a);
      b.paint(0x2f5a26, Surf.Foliage).cylinder(cx, 16.8, 0, 1.4, 1.6, 0.4, 6, { top: true });
    }
    gate(b, -2.2, 2.2, 23.2, 0xdad2c0, 0x1c1e20, 2.6);
    lowWall(b, -23.8, 22.8, -3.0, 23.6, 1.0, 0xcfc6b2, Surf.Stone, 0xe8e2d4);
    lowWall(b, 3.0, 22.8, 23.8, 23.6, 1.0, 0xcfc6b2, Surf.Stone, 0xe8e2d4);
    parkedCar(b, rng, 5.5, 8.5, Math.PI / 2 + 0.3, 0x2b2d31);
    tennisCourt(b, -9.5, -17, true, 0x7a4a3a);
    poolRect(b, 6, -20, 18, -15, 0xe6e0d2, 1.4);
    tree(b, rng, 21, -21, 1.3, 'wide');
    tree(b, rng, 1, -20, 1.2, 'round');
  } else if (v === 2) {
    // neoclassical plantation style: white, full-height colonnade, hip roof, tree allee drive
    const white = P(0xf0ede4), roof = P(0x3e4248, Surf.RoofTiles), trim = 0xfaf8f2;
    body(b, -14, -9, 14, 3, 0.9, 9.4, white, 0xc8c2b4);
    roofHip(b, 0, -1.5, 30, 17, 9.4, 3.8, roof, { over: 0.2, trim });
    // colonnade porch (under the extended hip roof)
    b.paint(0xd8d2c4, Surf.Stone).box(-14.5, 0, 3, 14.5, 0.9, 6.8, { nz: null });
    for (let i = 0; i < 8; i++) column(b, -13 + i * (26 / 7), 6.1, 0.9, 9.4, 0.38, trim, 6);
    b.paint(trim).box(-15, 9.0, 3, 15, 9.4, 7.0, { nz: null, top: null });
    // gallery balcony
    b.paint(trim).box(-14.4, 4.9, 3, 14.4, 5.1, 5.8, { nz: null });
    b.paint(trim, Surf.Corrugated).quad2([-14.4, 5.1, 5.8], [14.4, 5.1, 5.8], [14.4, 6.0, 5.8], [-14.4, 6.0, 5.8]);
    inFace(b, 'pz', 5.8, () => steps(b, 0, 7, 3, 0.3, 0.45, 0xd8d2c4, 0, Surf.Stone));
    const ws: WinStyle = { frame: trim, mull: 2, shutter: 0x2f3e36 };
    inFace(b, 'pz', 3, () => {
      for (const x of [-11, -7.5, -4, 4, 7.5, 11]) { win(b, x, 1.6, 1.3, 2.5, ws); win(b, x, 5.8, 1.3, 2.3, ws); }
      door(b, 0, 0.9, 1.8, 2.8, 0x2f3e36, { transom: true, sidelights: true, frame: trim });
      door(b, 0, 5.1, 1.4, 2.5, 0x2f3e36, { frame: trim, lite: true });
    });
    wins(b, 'nx', -14, [-6, -2], 1.6, 1.3, 2.4, ws);
    wins(b, 'nx', -14, [-6, -2], 5.8, 1.3, 2.2, ws);
    wins(b, 'px', 14, [-6, -2], 1.6, 1.3, 2.4, ws);
    wins(b, 'px', 14, [-6, -2], 5.8, 1.3, 2.2, ws);
    wins(b, 'nz', -9, [-10, -5, 0, 5, 10], 1.6, 1.3, 2.4, { frame: trim });
    wins(b, 'nz', -9, [-10, -5, 0, 5, 10], 5.8, 1.3, 2.2, { frame: trim });
    for (const x of [-9, 9]) chimney(b, x, -3, 1.6, 1.0, 11.0, 14.2, 0x9a5a46);
    for (const x of [-3.5, 3.5]) dormer(b, x, 5.0, 7.0, 9.4, 3.8 / 8.5, 1.6, 1.8, P(trim), roof, trim, 1.5);
    // allee drive
    paveSlab(b, -2.5, 6.8, 2.5, 24, 0xd8ccae, 0.08);
    paveSlab(b, -8, 6.8, 8, 12, 0xd8ccae, 0.08);
    for (const z of [14, 18, 22]) { tree(b, rng, -5.2, z, 1.25, 'round'); tree(b, rng, 5.2, z, 1.25, 'round'); }
    parkedCar(b, rng, 5.0, 9.5, -Math.PI / 2, 0xe8e6e0);
    for (const s of [-1, 1]) {
      hedgeBox(b, s * 16 - 6, 9, s * 16 + 6, 9.8, 1.0, 0x355e28);
      flowerBed(b, s * 16 - 5, 11, s * 16 + 5, 13, 0xd9a13c);
      bushRow(b, s * 15 - 4, 16, s * 15 + 4, 16, 3, 0.8, 0x4a7434, s + 3);
      tree(b, rng, s * 19, -19, 1.35, 'wide');
    }
    poolRect(b, -7, -20, 7, -14, 0xe8e2d4, 1.6);
    for (const x of [-3, 3]) lounger(b, x, -12, Math.PI);
    gardenShed(b, 16, -14, 5, 4, 0xf0ede4, 0x3e4248, 0);
    hedgeBox(b, -23.8, -23.8, 23.8, -23.0, 2.0, 0x355e28);
    lowWall(b, -23.8, 23.0, -3.2, 23.6, 0.9, 0xf0ede4, Surf.Plain, 0xfaf8f2);
    lowWall(b, 3.2, 23.0, 23.8, 23.6, 0.9, 0xf0ede4, Surf.Plain, 0xfaf8f2);
  } else {
    // contemporary estate: symmetric white volumes, glass core, cantilevered roof, infinity pool, tennis court
    const white = P(0xf1efea), stone = P(0xb8ad98, Surf.Stone), glassF = 0x2a2c2e;
    // glass core 2 storeys
    b.paint(0x2a3440, Surf.GlassPlain).box(-6, 0.4, -6, 6, 7.4, 2, { top: null, bottom: null });
    b.paint(glassF);
    inFace(b, 'pz', 2, () => { for (let i = 1; i < 8; i++) fq(b, -6 + i * 1.5 - 0.05, 0.4, -6 + i * 1.5 + 0.05, 7.4, 0.03); fq(b, -6, 3.7, 6, 3.95, 0.03); });
    slabRoof(b, -9, -8, 9, 5, 7.4, 0.5, 0xf1efea, 0x6e6a64);
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? -18 : 6, x1 = s < 0 ? -6 : 18;
      body(b, x0, -8, x1, 1, 0.4, 3.8, stone, 0x8f8b84);
      b.paint(white).box(x0 - (s < 0 ? 1 : 0), 3.8, -8.6, x1 + (s > 0 ? 1 : 0), 7.2, 2.6, { bottom: undefined, top: null });
      flatRoof(b, x0 - (s < 0 ? 1 : 0), -8.6, x1 + (s > 0 ? 1 : 0), 2.6, 7.2, 0.3, 0.15, 0xf1efea, 0x6e6a64);
      inFace(b, 'pz', 1, () => glassWall(b, x0 + 1, x1 - 1, 0.45, 3.6, glassF, 2.0));
      inFace(b, 'pz', 2.6, () => win(b, (x0 + x1) / 2, 4.6, x1 - x0 - 3, 1.9, { frame: glassF, ft: 0.08, mull: 3 }));
      wins(b, s < 0 ? 'nx' : 'px', s < 0 ? x0 - 1 : x1 + 1, [-5, -1], 4.6, 2.4, 1.9, { frame: glassF, ft: 0.08 });
      wins(b, 'nz', -8.6, [x0 + 3, x1 - 3], 4.6, 3.6, 1.9, { frame: glassF, ft: 0.08 });
      inFace(b, 'nz', -8, () => glassWall(b, U('nz', x1 - 1), U('nz', x0 + 1), 0.45, 3.6, glassF, 2.0));
    }
    inFace(b, 'pz', 2, () => door(b, 0, 0.4, 2.2, 3.0, 0x5a4432, { surf: Surf.Wood, frame: glassF }));
    b.paint(0xd8d2c4, Surf.Pavement).box(-9, 0, 2, 9, 0.4, 5, { nz: null });
    inFace(b, 'pz', 5, () => steps(b, 0, 6, 2, 0.2, 0.5, 0xd8d2c4));
    // long reflecting / infinity pool in front
    b.paint(0xd8d2c4, Surf.Pavement).box(-17, 0, 5, 17, 0.14, 12, { bottom: null });
    b.paint(0x2f9fc8, Surf.Water).box(-15, 0, 7, -3, 0.16, 11, { bottom: null });
    b.paint(0x2f9fc8, Surf.Water).box(3, 0, 7, 15, 0.16, 11, { bottom: null });
    for (const x of [-13, -11.5, -10, 10, 11.5, 13]) lounger(b, x, 6.0, Math.PI);
    // drive + garage court on the right side
    paveSlab(b, -3, 12, 3, 24, 0x9f9a92, 0.1);
    paveSlab(b, -9, 12, 9, 16, 0x9f9a92, 0.1);
    gate(b, -3, 3, 23.0, 0xb8ad98, 0x2a2c2e, 2.0);
    parkedCar(b, rng, -5.0, 14.0, Math.PI / 2, 0x2b2d31);
    parkedCar(b, rng, 5.5, 14.0, -Math.PI / 2, 0xf1f1ef);
    hedgeBox(b, -23.8, 22.8, -4, 23.6, 1.8, 0x355e28);
    hedgeBox(b, 4, 22.8, 23.8, 23.6, 1.8, 0x355e28);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) tree(b, rng, s * (12 + i * 3), 19.5, 0.9, 'column');
      tree(b, rng, s * 20.5, 8, 1.3, 'wide');
    }
    tennisCourt(b, -10, -16.5, true, 0x3a5a8a);
    b.paint(0xd8d2c4, Surf.Pavement).box(8, 0, -22, 20, 0.12, -11, { bottom: null });
    patioSet(b, 11, -15, 0xf1efea); patioSet(b, 16, -15, 0xf1efea);
    b.paint(0x8a7058, Surf.Wood).box(9, 0.12, -21, 19, 0.3, -18, { bottom: null });
    tree(b, rng, 21, -21, 1.3, 'wide');
  }
}

export const estateModels = {
  res_ranch: (b: ModelBuilder, v: number, rng: RNG) => { setLot(16, 16, 7); ranch(b, v, rng); },
  res_villa: (b: ModelBuilder, v: number, rng: RNG) => { setLot(16, 16, 12); villa(b, v, rng); },
  res_mansion: (b: ModelBuilder, v: number, rng: RNG) => { setLot(24, 24, 15); mansion(b, v, rng); },
};
void [roofGambrel, capPoly, parapet, flowerBed];
type _P = Paint;
