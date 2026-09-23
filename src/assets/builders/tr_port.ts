/**
 * Waterfront transport lots: tr_seaport (6x6) and tr_ferry_terminal (2x2).
 * WATER IS ON +Z: the lot's +Z edge is the waterline / quay edge. Land-side access is from -Z (and the sides).
 */
import type { ModelBuilder } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { lampPost, bench } from '../kit';
import {
  flat, stripe, dashed, lightDot, floodMast, obox, vault, tree, carLite, semi, containerBlock, trackX, freightCar,
  gantry, bollard, quadF, shade, poolRect, poolSoft, CONTAINER_COLS, CAR_COLS, type V3,
} from './tr_kit';

const P = {
  quay: 0x9e9a91,
  yard: 0x4c4d50,
  yardLine: 0xe8e4d8,
  yellow: 0xf0c020,
  coping: 0x8f8a80,
  fender: 0x1c1d1f,
  white: 0xf2f0ea,
};

// ---------------------------------------------------------------------------------------------- STS crane
/**
 * Ship-to-shore container crane with its boom RAISED (idle position) so it stays inside the lot.
 * Rails along X at zl (land) and zs (sea). ~330 tris.
 */
function stsCrane(b: ModelBuilder, cx: number, zl: number, zs: number, color: number, boomDeg: number): void {
  const legX = 8.2, top = 29.5;
  const dark = shade(color, 0.72);
  // legs
  b.paint(color, Surf.Metal);
  for (const sx of [-1, 1]) for (const zz of [zl, zs]) b.box(cx + sx * legX - 0.7, 1.3, zz - 0.8, cx + sx * legX + 0.7, top, zz + 0.8, { top: null, bottom: null });
  // bogies on the rails
  b.paint(0x3a3d41, Surf.Metal);
  for (const zz of [zl, zs]) for (const sx of [-1, 1]) b.box(cx + sx * legX - 3.2, 0, zz - 0.9, cx + sx * legX + 3.2, 1.4, zz + 0.9, { bottom: null });
  // side-frame portal beams (along Z) and top cross beams (along X)
  b.paint(color, Surf.Metal);
  for (const sx of [-1, 1]) b.box(cx + sx * legX - 0.6, 13.5, zl, cx + sx * legX + 0.6, 15.2, zs);
  for (const zz of [zl, zs]) b.box(cx - legX - 0.7, top - 1.8, zz - 0.9, cx + legX + 0.7, top, zz + 0.9);
  // X bracing in the side frames above the portal beam
  for (const sx of [-1, 1]) {
    obox(b, [cx + sx * legX, 15.2, zl + 0.6], [cx + sx * legX, top - 1.8, zs - 0.6], 0.45, 0.45, { ends: false });
    obox(b, [cx + sx * legX, 15.2, zs - 0.6], [cx + sx * legX, top - 1.8, zl + 0.6], 0.45, 0.45, { ends: false });
  }
  // twin girders (backreach) along Z
  const zb = zl - 11, zh = zs + 1.5;
  for (const sx of [-1, 1]) b.box(cx + sx * 2.4 - 0.6, top, zb, cx + sx * 2.4 + 0.6, top + 2.2, zh, { bottom: undefined });
  // machinery house on the backreach
  b.paint(0xeeece6, Surf.WallWindows, 4, 3.6).box(cx - 3.6, top + 2.2, zb + 0.4, cx + 3.6, top + 6.0, zb + 7.5, { bottom: null, top: { color: 0xeeece6, surf: Surf.Metal } });
  b.paint(dark, Surf.Metal).box(cx - 3.7, top + 6.0, zb + 0.3, cx + 3.7, top + 6.3, zb + 7.6, { bottom: null });
  // operator cab under the girder (sea side)
  b.paint(0xeeece6, Surf.Metal).box(cx - 1.4, top - 4.2, zs - 3.6, cx + 1.4, top - 1.8, zs - 1.2, { top: null });
  b.paint(0x24303a, Surf.GlassPlain).box(cx - 1.42, top - 3.6, zs - 1.22, cx + 1.42, top - 2.3, zs - 1.18, { top: null, bottom: null, nz: null });
  // trolley
  b.paint(0xd8d6d0, Surf.Metal).box(cx - 3.0, top + 2.2, zl + 2, cx + 3.0, top + 3.8, zl + 6, { bottom: null });
  // A-frame (apex) + raised boom
  const apexY = top + 16, apexZ = zs - 5;
  b.paint(color, Surf.Metal);
  for (const sx of [-1, 1]) {
    obox(b, [cx + sx * 2.4, top + 2.2, zl + 1], [cx + sx * 1.6, apexY, apexZ], 0.9, 0.9, { ends: false });
    obox(b, [cx + sx * 2.4, top + 2.2, zs - 0.5], [cx + sx * 1.6, apexY, apexZ], 0.9, 0.9, { ends: false });
  }
  b.box(cx - 2.4, apexY - 0.4, apexZ - 0.7, cx + 2.4, apexY + 0.8, apexZ + 0.7);
  const a = (boomDeg * Math.PI) / 180, L = 23;
  const hinge: V3 = [0, top + 1.2, zh - 0.6];
  const tipY = hinge[1] + Math.sin(a) * L, tipZ = hinge[2] + Math.cos(a) * L;
  for (const sx of [-1, 1]) obox(b, [cx + sx * 2.2, hinge[1], hinge[2]], [cx + sx * 1.6, tipY, tipZ], 1.0, 1.6, { ends: true });
  b.box(cx - 2.2, tipY - 0.6, tipZ - 0.9, cx + 2.2, tipY + 0.4, tipZ + 0.3);
  // stays: apex -> boom tip (hoist ropes) and apex -> backreach end
  b.paint(0x2a2b2d, Surf.Metal);
  for (const sx of [-1, 1]) {
    obox(b, [cx + sx * 1.6, apexY, apexZ], [cx + sx * 1.6, tipY - 0.8, tipZ - 0.4], 0.22, 0.22, { ends: false });
    obox(b, [cx + sx * 1.6, apexY, apexZ], [cx + sx * 2.4, top + 2.2, zb + 0.4], 0.28, 0.28, { ends: false });
  }
  // aviation + work lights
  lightDot(b, cx, apexY + 0.8, apexZ, 0.6, 0xff3322);
  lightDot(b, cx, tipY + 0.4, tipZ - 0.3, 0.6, 0xff3322);
  b.paint(0xfff0d0, Surf.Emissive);
  for (const zz of [zl + 3, zs - 5]) b.box(cx - 2, top - 0.35, zz - 0.4, cx + 2, top - 0.1, zz + 0.4, { top: null });
}

/** Warehouse / CFS shed: corrugated walls, low gable roof (ridge along X), loading doors on `doorSide`. */
function shed(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h: number, wall: number, roof: number, doors: number, doorSide: 1 | -1, stripeCol?: number): void {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  b.paint(wall, Surf.Corrugated).box(x0, 0, z0, x1, h, z1, { top: null });
  b.paint(roof, Surf.RoofTiles).gableRoof(cx, cz, w, d, h, Math.min(2.2, d * 0.1), 'x', 0.4, { color: wall, surf: Surf.Corrugated });
  if (stripeCol !== undefined) b.paint(stripeCol, Surf.Plain).box(x0 - 0.05, h - 1.6, z0 - 0.05, x1 + 0.05, h - 0.8, z1 + 0.05, { top: null, bottom: null });
  const zf = doorSide > 0 ? z1 : z0;
  b.paint(0x5d646b, Surf.Metal);
  const pitch = w / doors;
  for (let i = 0; i < doors; i++) {
    const dx = x0 + pitch * (i + 0.5);
    quadF(b, [dx - 1.6, 0.9, zf + doorSide * 0.04], [dx + 1.6, 0.9, zf + doorSide * 0.04], [dx + 1.6, 4.2, zf + doorSide * 0.04], [dx - 1.6, 4.2, zf + doorSide * 0.04], [0, 0, doorSide]);
  }
  // loading dock apron
  b.paint(0x9d9990, Surf.Pavement).box(x0 + 0.5, 0, doorSide > 0 ? z1 : z0 - 2.2, x1 - 0.5, 1.0, doorSide > 0 ? z1 + 2.2 : z0, { bottom: null });
}

// ---------------------------------------------------------------------------------------------- seaport
function seaport(b: ModelBuilder, rng: RNG): void {
  // ground: quay apron (concrete) + container yard (asphalt) + back area
  b.paint(P.quay, Surf.Pavement).box(-48, 0, 24, 48, 0.15, 46.8, { bottom: null });
  b.paint(P.yard, Surf.Pavement).box(-48, 0, -48, 48, 0.12, 24, { bottom: null });
  // quay wall: coping stones + face going down to the water, rubber fenders
  b.paint(P.coping, Surf.Stone).box(-48, -3, 46.8, 48, 0.35, 48, { bottom: null });
  b.paint(P.yellow, Surf.Plain);
  flat(b, -48, 46.3, 48, 46.6, 0.2);
  for (let x = -44; x <= 44; x += 8) {
    b.paint(P.fender, Surf.Plain).box(x - 0.9, -2.2, 48, x + 0.9, 0.2, 48.35, { bottom: null });
    bollard(b, x + 4, 47.4, 0.35);
  }
  // crane rails
  const zl = 28, zs = 42;
  b.paint(0x77726b, Surf.Metal);
  for (const zz of [zl, zs]) flat(b, -48, zz - 0.25, 48, zz + 0.25, 0.2);
  // lane markings on the quay apron
  b.paint(P.yardLine, Surf.Plain);
  dashed(b, -47, 35, 47, 35, 0.25, 0.2, 4, 3);
  // STS cranes (idle, booms raised)
  poolRect(b, -47.5, 29, 47.5, 41, 0.175, P.quay, 0.5);
  stsCrane(b, -30, zl, zs, 0xc0392b, 80);
  stsCrane(b, -2, zl, zs, 0x2e6fb5, 84);
  stsCrane(b, 26, zl, zs, 0xc0392b, 78);
  // trucks under / near the cranes
  semi(b, -12, 37.5, Math.PI / 2, 0x2e6fb5, rng.pick(CONTAINER_COLS), 0.15);
  semi(b, 14, 31.5, -Math.PI / 2, 0xe8e6e0, rng.pick(CONTAINER_COLS), 0.15);
  semi(b, 38, 37.5, Math.PI / 2, 0xc0392b, null, 0.15);
  // ---- container yard blocks with RTGs
  b.paint(P.yardLine, Surf.Plain);
  for (const zz of [-16.5, 7.5, 22.5]) dashed(b, -47, zz, 47, zz, 0.22, 0.17, 4, 3);
  stripe(b, -2.5, -15, -2.5, 22, 0.22, 0.17);
  const blocks: [number, number, number, number][] = [
    // x0, z0, bays, rows
    [-44.5, -14.5, 3, 7],
    [1.5, -14.5, 3, 7],
    [-44.5, 9.8, 3, 4],
    [1.5, 9.8, 3, 4],
  ];
  for (const [x0, z0, bays, rows] of blocks) containerBlock(b, rng, x0, z0, bays, rows, rows > 5 ? 4 : 3, { minTier: 1 });
  // RTG cranes straddling the big blocks
  gantry(b, -24, -16, 6.5, 17.5, 7.4, 0xe0a81c, { trolleyAt: -6 });
  gantry(b, 28, -16, 6.5, 17.5, 7.4, 0xe0a81c, { trolleyAt: 1 });
  semi(b, -9, 4.5, -Math.PI / 2, 0xe0e0dc, null, 0.12);
  semi(b, 38, -18.5, Math.PI / 2, 0x3e5e3a, rng.pick(CONTAINER_COLS), 0.12);
  // ---- rail spur along X with a container train
  trackX(b, -48, 48, -22, { sleeperPitch: 1.6, y: 0.1 });
  for (let i = 0; i < 4; i++) freightCar(b, rng, -38 + i * 17.8, -22, 'flat', 0x444444, 0.5);
  // ---- warehouses + maintenance shed + admin
  shed(b, -46, -46, -10, -28, 10, 0xc9ccd0, 0x8b9096, 5, 1, 0x1f5fa0);
  shed(b, -6, -46, 20, -32, 8.5, 0xd8d2c4, 0x7d8388, 3, 1);
  semi(b, -38, -18.6, -Math.PI / 2 + 0.02, 0xe36a1e, 0xe8e8e2, 0.12);
  // admin / control building (east edge)
  b.paint(0x79a9c9, Surf.GlassCurtain, 5, 3.6).box(38, 0, -46, 46.5, 14.4, -28, { top: { color: 0x8a8780, surf: Surf.RoofFlat }, nx: { color: 0xe8e5de, surf: Surf.WallWindows, pattern: 2, floor: 3.6 } });
  b.paint(0x2e6fb5, Surf.Metal).box(37.8, 14.4, -46.2, 46.7, 15.3, -27.8, { bottom: null });
  b.paint(0xeaf2ff, Surf.Emissive).box(38.6, 12.6, -27.9, 45.9, 13.6, -27.8, { top: null, bottom: null, nz: null, px: null, nx: null });
  // truck gate: lanes in from the -Z street, canopy with booths
  b.paint(0x404145, Surf.Pavement).box(23, 0, -48, 37, 0.15, -24, { bottom: null });
  b.paint(P.yardLine, Surf.Plain);
  for (const x of [26.5, 30, 33.5]) dashed(b, x, -47.5, x, -25, 0.2, 0.2, 2.5, 2);
  b.paint(0xe8e8e4, Surf.Metal).box(22.5, 5.2, -41, 37.5, 5.7, -35.5, { bottom: { color: 0xc8c4bc, surf: Surf.Plain } });
  b.paint(0xfff2d8, Surf.Emissive).box(23.5, 5.05, -38.5, 36.5, 5.2, -38, { top: null });
  for (const x of [23, 37]) b.paint(0x5a5f64, Surf.Metal).box(x - 0.25, 0, -38.5, x + 0.25, 5.2, -38, { top: null, bottom: null });
  for (const x of [26.5, 30, 33.5]) b.paint(0xd9d4c8, Surf.WallWindows, 6, 3).box(x - 0.6, 0, -39.4, x + 0.6, 2.6, -37.2, { top: { color: 0x9a968e, surf: Surf.RoofFlat } });
  b.paint(0xd23a2a, Surf.Plain);
  for (const x of [24.8, 28.3, 31.8]) b.box(x - 1.5, 1.0, -36.6, x + 1.5, 1.12, -36.45, { bottom: null });
  // floodlight masts
  for (const [x, z] of [[-24, 23.6], [14, 23.6], [-47, -26], [47, 8]] as [number, number][]) floodMast(b, x, z, 26, Math.abs(x) > 40 ? Math.PI / 2 : 0);
  lampPost(b, 22, -44, 6);
  poolSoft(b, -41, -26, 6.5, 0.145, P.yard);
  poolSoft(b, 41, 8, 6.5, 0.145, P.yard);
  poolRect(b, 23, -41, 37, -35.5, 0.17, 0x404145, 0.95);
  tree(b, rng, 21.5, -30, 6);
}

// ---------------------------------------------------------------------------------------------- ferry terminal
function ferryTerminal(b: ModelBuilder, rng: RNG): void {
  // ground: land-side plaza + queue lanes; pier deck over the water edge
  b.paint(0xc6c1b6, Surf.Pavement).box(-16, 0, -16, 3.5, 0.12, 2, { bottom: null });
  b.paint(0x3e3f43, Surf.Pavement).box(3.5, 0, -16, 16, 0.1, 5, { bottom: null });
  b.paint(P.white, Surf.Plain);
  for (const x of [7.5, 11.5]) dashed(b, x, -15, x, 3.5, 0.15, 0.14, 2, 2);
  // quay edge (stone) between the lanes and the linkspan
  b.paint(P.coping, Surf.Stone).box(-16, -2.5, 2, 16, 0.3, 5, { bottom: null });
  b.paint(P.yellow, Surf.Plain);
  flat(b, 3.5, 4.4, 16, 4.7, 0.34);
  // pier: timber deck on piles reaching the +Z edge
  const deckY = 1.1;
  b.paint(0x8a6e52, Surf.Wood).box(-15.5, deckY - 0.35, 5, 1.5, deckY, 15.8, { bottom: { color: 0x5a4838, surf: Surf.Wood } });
  b.paint(0x4a3b2e, Surf.Wood);
  for (const x of [-15, -9.5, -4, 1]) for (const z of [8.5, 12.2, 15.4]) b.cylinder(x, z, -2.5, deckY - 0.35 + 2.5, 0.22, 0.22, 5, { top: false });
  b.paint(0x8f8b86, Surf.Metal).box(-16, 0.1, 2, 2, deckY, 5, { bottom: null, top: { color: 0x8a6e52, surf: Surf.Wood } });
  // pier railings
  b.paint(0xe8e6e0, Surf.Metal);
  obox(b, [-15.4, deckY + 1.0, 5.2], [-15.4, deckY + 1.0, 15.6], 0.08, 0.08);
  obox(b, [1.4, deckY + 1.0, 5.2], [1.4, deckY + 1.0, 12.5], 0.08, 0.08);
  for (const z of [6, 9, 12, 15.4]) {
    b.box(-15.46, deckY, z - 0.04, -15.34, deckY + 1.0, z + 0.04, { top: null, bottom: null });
    if (z < 13) b.box(1.34, deckY, z - 0.04, 1.46, deckY + 1.0, z + 0.04, { top: null, bottom: null });
  }
  bollard(b, -12, 15.2, deckY);
  bollard(b, -2, 15.2, deckY);
  bench(b, -12, 9, Math.PI / 2);
  bench(b, -12, 12, Math.PI / 2);
  // ---- terminal building: glass hall under a sweeping curved roof
  b.paint(0x5f9c96, Surf.GlassCurtain, 1, 3.2).box(-15, 0, -13.5, 2.5, 6.4, 0.5, {
    nz: { color: 0xe5e1d8, surf: Surf.WallWindows, pattern: 6, floor: 3.2 },
    nx: { color: 0xe5e1d8, surf: Surf.Plain },
    top: { color: 0x8e8b84, surf: Surf.RoofFlat },
  });
  b.paint(0xe2e5e8, Surf.Metal);
  vault(b, -6.25, -6.5, 17.5, 19.4, 6.4, 2.4, 'x', { seg: 8, ends: { color: 0xe2e5e8, surf: Surf.Metal }, endAt: [-8.75, 8.75], under: { color: 0xc49a6c, surf: Surf.Wood } });
  // name sign on the land side + entrance canopy
  b.paint(0x0f4c5c, Surf.Metal).box(-12, 4.6, -13.9, -3, 5.8, -13.5);
  b.paint(0xe8fbff, Surf.Emissive).box(-11.7, 4.8, -13.98, -3.3, 5.6, -13.9, { top: null, bottom: null, pz: null, px: null, nx: null });
  b.paint(0xe8e8e4, Surf.Metal).box(-13, 3.3, -16, -1, 3.6, -13.5, { bottom: { color: 0xcfcac0, surf: Surf.Plain } });
  for (const x of [-12.6, -1.4]) b.paint(0x5a5f64, Surf.Metal).box(x - 0.12, 0, -15.8, x + 0.12, 3.3, -15.56, { top: null, bottom: null });
  // enclosed boarding bridge (upper level -> pier head) with glazing
  b.paint(0xd4d8dc, Surf.Metal).box(-8.4, 4.2, 0.5, -5.4, 4.5, 14.2, { bottom: { color: 0x9aa0a6, surf: Surf.Metal } });
  b.paint(0x3a5a66, Surf.GlassPlain).box(-8.4, 4.5, 0.5, -5.4, 6.3, 14.2, { top: { color: 0xd4d8dc, surf: Surf.Metal }, nz: null, pz: null });
  b.paint(0x7a8086, Surf.Metal);
  for (const z of [5.5, 10.5]) b.box(-7.2, 0, z - 0.25, -6.6, 4.2, z + 0.25, { top: null, bottom: null });
  // pier-head stair tower
  b.paint(0xe5e1d8, Surf.Plain).box(-9, deckY, 12.4, -4.8, 7.2, 15.6, { top: { color: 0x7f7c76, surf: Surf.RoofFlat } });
  b.paint(0x2a3a44, Surf.GlassPlain).box(-8.6, deckY + 0.6, 15.6, -5.2, 6.6, 15.65, { top: null, bottom: null, nz: null, px: null, nx: null });
  lightDot(b, -6.9, 7.2, 14, 0.4, 0xff3322);
  // ---- vehicle linkspan: hinged steel ramp + lifting gantry
  const rx0 = 5, rx1 = 13.5;
  b.paint(0x55595e, Surf.Metal);
  quadF(b, [rx0, 0.32, 5], [rx1, 0.32, 5], [rx1, 1.6, 15.8], [rx0, 1.6, 15.8], [0, 1, 0]);
  b.paint(P.yellow, Surf.Plain);
  quadF(b, [rx0 + 0.4, 0.36, 5.2], [rx0 + 0.7, 0.36, 5.2], [rx0 + 0.7, 1.64, 15.6], [rx0 + 0.4, 1.64, 15.6], [0, 1, 0]);
  quadF(b, [rx1 - 0.7, 0.36, 5.2], [rx1 - 0.4, 0.36, 5.2], [rx1 - 0.4, 1.64, 15.6], [rx1 - 0.7, 1.64, 15.6], [0, 1, 0]);
  b.paint(0x33373b, Surf.Metal);
  for (const x of [rx0, rx1]) obox(b, [x, 0.9, 5], [x, 2.2, 15.8], 0.25, 1.2);
  b.paint(0x2e6fb5, Surf.Metal);
  for (const x of [rx0 - 0.6, rx1 + 0.6]) b.box(x - 0.5, 0, 13.3, x + 0.5, 9.2, 14.3, { bottom: null });
  b.box(rx0 - 1.1, 8.2, 13.3, rx1 + 1.1, 9.4, 14.3);
  b.paint(0x222222, Surf.Metal);
  for (const x of [rx0 + 0.8, rx1 - 0.8]) b.box(x - 0.05, 1.9, 13.75, x + 0.05, 8.2, 13.85, { top: null, bottom: null });
  lightDot(b, rx0 - 0.6, 9.4, 13.8, 0.4, 0xff3322);
  lightDot(b, rx1 + 0.6, 9.4, 13.8, 0.4, 0xff3322);
  // queued cars + ticket booth
  for (let i = 0; i < 3; i++) {
    carLite(b, 5.5, -1 - i * 5.4, 0, rng.pick(CAR_COLS), 0.1);
    if (i < 2) carLite(b, 9.5, -2 - i * 5.4, 0, rng.pick(CAR_COLS), 0.1);
  }
  carLite(b, 13.8, -4, 0, 0xf1f1ef, 0.1);
  b.paint(0xe8e8e4, Surf.Metal).box(4, 3.4, -14.6, 16, 3.7, -11.4, { bottom: { color: 0xc8c4bc, surf: Surf.Plain } });
  b.paint(0xfff2d8, Surf.Emissive).box(4.5, 3.25, -13.2, 15.5, 3.4, -12.8, { top: null });
  poolRect(b, 4, -14.6, 16, -11.4, 0.115, 0x3e3f43, 0.95);
  b.paint(0xd9d4c8, Surf.WallWindows, 6, 2.8).box(8.8, 0, -13.8, 10.2, 2.5, -12.2, { top: { color: 0x9a968e, surf: Surf.RoofFlat } });
  b.paint(0x5a5f64, Surf.Metal);
  for (const x of [4.3, 15.7]) b.box(x - 0.12, 0, -13.1, x + 0.12, 3.4, -12.9, { top: null, bottom: null });
  // plaza dressing
  lampPost(b, 2.8, -6, 5);
  lampPost(b, 2.8, 4, 5);
  lampPost(b, -15.2, 4.2, 4.5);
  tree(b, rng, -14.2, -14.4, 5);
  tree(b, rng, 2.2, -14.6, 4.6);
  b.paint(0xe8e6e0, Surf.Metal).cylinder(-15.3, 1.2, 0, 9.4, 0.07, 0.05, 5, { top: false });
  b.paint(0x2e6fb5, Surf.Plain);
  quadF(b, [-15.3, 9.2, 1.2], [-15.3, 9.2, 3.2], [-15.3, 8.0, 3.2], [-15.3, 8.0, 1.2], [1, 0, 0]);
  quadF(b, [-15.3, 9.2, 1.2], [-15.3, 9.2, 3.2], [-15.3, 8.0, 3.2], [-15.3, 8.0, 1.2], [-1, 0, 0]);
}

export const portModels = {
  tr_seaport: (b: ModelBuilder, _v: number, rng: RNG) => seaport(b, rng),
  tr_ferry_terminal: (b: ModelBuilder, _v: number, rng: RNG) => ferryTerminal(b, rng),
};
