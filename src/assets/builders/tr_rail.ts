/**
 * Rail transport lots: tr_train_station (4x2) and tr_freight_station (4x2).
 * Platforms / loading tracks run along X at the back (-Z); street is at +Z.
 */
import type { ModelBuilder } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { lampPost, bench } from '../kit';
import {
  flat, stripe, dashed, lightDot, floodMast, obox, vault, tree, shrub, carLite, semi, containerBlock, trackX, freightCar,
  gantry, quadF, disc, halfDisc, panel, CONTAINER_COLS, CAR_COLS, type V3,
} from './tr_kit';

// ---------------------------------------------------------------------------------------------- helpers
/** Clock face on a vertical wall (axis/sign = facing direction). Emissive dial glows at night. ~26 tris */
function clock(b: ModelBuilder, c: V3, r: number, axis: 'x' | 'z', sign: 1 | -1): void {
  const off = (d: number): V3 => (axis === 'x' ? [c[0] + sign * d, c[1], c[2]] : [c[0], c[1], c[2] + sign * d]);
  b.paint(0x2b2d2f, Surf.Metal);
  disc(b, off(0.04), r * 1.14, 10, axis, sign);
  b.paint(0xf3ecd8, Surf.Emissive);
  disc(b, off(0.08), r, 10, axis, sign);
  b.paint(0x1a1a1a, Surf.Plain);
  // hands: hour -> ~10 o'clock, minute -> ~2 o'clock
  const hand = (ang: number, len: number, w: number) => {
    const p = off(0.11);
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const px = -uy * w, py = ux * w;
    const P2 = (a: number, bb: number): V3 => (axis === 'x' ? [p[0], p[1] + bb, p[2] + a] : [p[0] + a, p[1] + bb, p[2]]);
    const sgn = axis === 'x' ? -sign : sign; // keep clockwise sense on both axes
    quadF(b, P2(sgn * px, py), P2(sgn * (ux * len + px), uy * len + py), P2(sgn * (ux * len - px), uy * len - py), P2(-sgn * px, -py), axis === 'x' ? [sign, 0, 0] : [0, 0, sign]);
  };
  hand((150 * Math.PI) / 180, r * 0.55, r * 0.07);
  hand((30 * Math.PI) / 180, r * 0.85, r * 0.05);
}

// ---------------------------------------------------------------------------------------------- passenger station
function trainStation(b: ModelBuilder, rng: RNG): void {
  const stone = 0xd9ceb4, stoneLight = 0xe8dfca, brick = 0x9e5238, slate = 0x4d545d, copper = 0x6c9785;
  // base paving + front plaza
  b.paint(0xc9c1b0, Surf.Pavement).box(-32, 0, -6.5, 32, 0.1, 16, { bottom: null });
  b.paint(0xb5ad9c, Surf.Pavement).box(-10, 0, 8, 10, 0.14, 15.5, { bottom: null });
  // ---- platform along the back edge (rails run just outside the lot at -Z)
  b.paint(0xb9b5ad, Surf.Pavement).box(-32, 0, -16, 32, 1.0, -6.5, { bottom: null });
  b.paint(0xe9e7e0, Surf.Plain);
  flat(b, -32, -16, 32, -15.5, 1.03);
  b.paint(0xf0c020, Surf.Plain);
  flat(b, -32, -15.1, 32, -14.85, 1.03);
  // canopy: curved shell on slender columns, bright soffit + light strip
  b.paint(0x55606a, Surf.Metal);
  vault(b, 0, -11.2, 8.6, 63, 5.0, 1.2, 'x', { seg: 6, ends: { color: 0x55606a, surf: Surf.Metal }, under: { color: 0xe6e0d2, surf: Surf.Plain } });
  b.paint(0x2f4f45, Surf.Metal);
  for (let x = -28; x <= 28.1; x += 8) {
    b.cylinder(x, -11.2, 1.0, 5.1, 0.17, 0.17, 6, { top: false });
    obox(b, [x, 4.6, -11.2], [x, 5.6, -13.8], 0.14, 0.14, { ends: false });
    obox(b, [x, 4.6, -11.2], [x, 5.6, -8.6], 0.14, 0.14, { ends: false });
  }
  b.paint(0xfff1d0, Surf.Emissive).box(-30, 6.0, -11.45, 30, 6.1, -10.95, { top: null });
  // platform furniture: benches, name signs, departure board
  b.push().translate(0, 1.0, 0);
  for (const x of [-24, -8, 8, 24]) bench(b, x, -9.4, Math.PI);
  b.pop();
  b.paint(0x2f4f45, Surf.Metal);
  for (const x of [-1.4, 1.4]) b.box(x - 0.04, 4.4, -8.9, x + 0.04, 5.95, -8.8, { top: null, bottom: null });
  for (const x of [-16, 16]) {
    b.paint(0x2f4f45, Surf.Metal).box(x - 1.6, 1, -11.3, x - 1.45, 3.4, -11.1, { top: null, bottom: null }).box(x + 1.45, 1, -11.3, x + 1.6, 3.4, -11.1, { top: null, bottom: null });
    b.paint(0x1f3f7a, Surf.Metal).box(x - 1.7, 2.6, -11.35, x + 1.7, 3.3, -11.05);
    b.paint(0xf4f6ff, Surf.Emissive).box(x - 1.5, 2.7, -11.4, x + 1.5, 3.2, -11.0, { top: null, bottom: null, px: null, nx: null });
  }
  b.paint(0x222629, Surf.Metal).box(-1.8, 3.2, -9.0, 1.8, 4.4, -8.7);
  b.paint(0xffb640, Surf.Emissive).box(-1.6, 3.35, -9.05, 1.6, 4.25, -8.65, { top: null, bottom: null, px: null, nx: null });

  // ---- wings (brick, arched windows, slate hip roofs)
  for (const [x0, x1] of [[-31, -12], [12, 31]] as [number, number][]) {
    b.paint(brick, Surf.WallWindows, 7, 4.2).box(x0, 0, -6.5, x1, 9, 6.2, { top: null });
    b.paint(stoneLight, Surf.Plain).box(x0 - 0.2, 8.5, -6.7, x1 + 0.2, 9.2, 6.4, { bottom: null, top: null });
    b.paint(stoneLight, Surf.Stone).box(x0 - 0.15, 0, -6.65, x1 + 0.15, 1.0, 6.35, { top: null, bottom: null });
    b.paint(slate, Surf.RoofTiles).hipRoof((x0 + x1) / 2, -0.15, x1 - x0, 12.7, 9.2, 3.0, 0.35);
    b.paint(0x7a4030, Surf.Brick).box((x0 + x1) / 2 - 4.6, 10.5, -2.4, (x0 + x1) / 2 - 3.6, 13.0, -1.4, { bottom: null });
  }
  // ---- central hall: stone walls, copper barrel roof, giant arched window
  const hz0 = -6.5, hz1 = 8;
  b.paint(stone, Surf.Stone).box(-12, 0, hz0, 12, 12.5, hz1, {
    px: { color: stone, surf: Surf.WallWindows, pattern: 7, floor: 4.2 },
    nx: { color: stone, surf: Surf.WallWindows, pattern: 7, floor: 4.2 },
    top: null,
  });
  b.paint(stoneLight, Surf.Plain).box(-12.35, 12.1, hz0 - 0.35, 12.35, 12.8, hz1 + 0.35, { bottom: null, top: null });
  b.paint(copper, Surf.RoofTiles);
  vault(b, 0, (hz0 + hz1) / 2, 24.6, hz1 - hz0 + 1.0, 12.8, 4.6, 'z', { seg: 10, ends: { color: stone, surf: Surf.Stone }, endAt: [-(hz1 - hz0) / 2, (hz1 - hz0) / 2] });
  // arched window: stone surround, glazing, mullions
  const wz = hz1 + 0.02, wr = 5.4, wyc = 10.2;
  b.paint(stoneLight, Surf.Stone);
  panel(b, 'z', 1, wz, -wr - 0.7, wr + 0.7, 2.6, wyc);
  halfDisc(b, [0, wyc, wz], wr + 0.7, 10, 'z', 1);
  b.paint(0x33485a, Surf.GlassPlain);
  panel(b, 'z', 1, wz + 0.05, -wr, wr, 3.2, wyc);
  halfDisc(b, [0, wyc, wz + 0.05], wr, 10, 'z', 1);
  b.paint(0x3b3f44, Surf.Metal);
  for (const x of [-wr * 0.5, 0, wr * 0.5]) {
    const top = wyc + Math.sqrt(wr * wr - x * x);
    panel(b, 'z', 1, wz + 0.09, x - 0.1, x + 0.1, 3.2, top);
  }
  panel(b, 'z', 1, wz + 0.09, -wr, wr, wyc - 0.1, wyc + 0.1);
  panel(b, 'z', 1, wz + 0.09, -wr, wr, 6.6, 6.8);
  // keystone + doors + entrance canopy with sign
  b.paint(stoneLight, Surf.Stone).box(-0.7, wyc + wr + 0.1, wz, 0.7, wyc + wr + 1.2, wz + 0.25, { bottom: null });
  b.paint(0x2a2f33, Surf.GlassPlain);
  panel(b, 'z', 1, wz + 0.03, -5, 5, 0.1, 2.9);
  b.paint(0x3b3f44, Surf.Metal).box(-8, 3.4, hz1, 8, 3.7, hz1 + 3.6, { bottom: { color: 0xd8d2c6, surf: Surf.Plain } });
  b.paint(0xfff1d0, Surf.Emissive).box(-7.5, 3.3, hz1 + 3.0, 7.5, 3.4, hz1 + 3.3, { top: null });
  for (const x of [-7.6, 7.6]) b.paint(0x3b3f44, Surf.Metal).box(x - 0.12, 0, hz1 + 3.2, x + 0.12, 3.4, hz1 + 3.45, { top: null, bottom: null });
  b.paint(0x14305e, Surf.Metal).box(-5, 3.7, hz1 + 3.25, 5, 4.6, hz1 + 3.6);
  b.paint(0xf2f5ff, Surf.Emissive).box(-4.7, 3.85, hz1 + 3.6, 4.7, 4.45, hz1 + 3.66, { top: null, bottom: null, nz: null, px: null, nx: null });
  // ---- clock tower (east), stone with copper pyramid roof + finial
  const tx0 = 13.5, tx1 = 19.5, tz0 = 0.4, tz1 = 6.4, tH = 19;
  b.paint(stone, Surf.Stone).box(tx0, 0, tz0, tx1, tH, tz1, { top: null });
  b.paint(stoneLight, Surf.Plain).box(tx0 - 0.3, tH - 0.6, tz0 - 0.3, tx1 + 0.3, tH, tz1 + 0.3, { bottom: null });
  b.paint(copper, Surf.RoofTiles).pyramid((tx0 + tx1) / 2, (tz0 + tz1) / 2, tx1 - tx0 + 0.6, tz1 - tz0 + 0.6, tH, 4.2);
  b.paint(0x3b3f44, Surf.Metal).cylinder((tx0 + tx1) / 2, (tz0 + tz1) / 2, tH + 3.8, 1.4, 0.06, 0.03, 5, { top: false });
  const tcx = (tx0 + tx1) / 2, tcz = (tz0 + tz1) / 2;
  clock(b, [tcx, 15.2, tz1], 1.9, 'z', 1);
  clock(b, [tx1, 15.2, tcz], 1.9, 'x', 1);
  clock(b, [tx0, 15.2, tcz], 1.9, 'x', -1);
  clock(b, [tcx, 15.2, tz0], 1.9, 'z', -1);
  // belfry openings
  b.paint(0x24272a, Surf.Plain);
  panel(b, 'z', 1, tz1 + 0.02, tcx - 1.2, tcx + 1.2, 10.6, 12.8);
  panel(b, 'x', 1, tx1 + 0.02, tcz - 1.2, tcz + 1.2, 10.6, 12.8);
  // ---- front plaza: taxi rank, planters, lamps, bike racks
  b.paint(0x3e3f43, Surf.Pavement).box(12, 0, 12.2, 31.5, 0.11, 15.6, { bottom: null });
  b.paint(0xf2f0ea, Surf.Plain);
  dashed(b, 13, 12.35, 31, 12.35, 0.15, 0.15, 1.5, 1);
  for (const x of [16, 22, 28]) carLite(b, x, 13.9, -Math.PI / 2, 0xf1c40f, 0.11);
  b.paint(0x3e3f43, Surf.Pavement).box(-31.5, 0, 12.2, -14, 0.11, 15.6, { bottom: null });
  carLite(b, -27, 13.9, Math.PI / 2, rng.pick(CAR_COLS), 0.11);
  carLite(b, -18, 13.9, Math.PI / 2, rng.pick(CAR_COLS), 0.11);
  for (const [x, z] of [[-12, 10.5], [12, 10.5], [-30, 9.5], [30, 9.5]] as [number, number][]) {
    b.paint(0x8f887a, Surf.Stone).cylinder(x, z, 0, 0.6, 1.3, 1.3, 8, { top: true, topPaint: { color: 0x4d3b2a, surf: Surf.Plain } });
    tree(b, rng, x, z, rng.range(6.5, 7.5));
  }
  for (const x of [-20, -6, 6, 20]) lampPost(b, x, 11.6, 4.6);
  b.paint(0x55595e, Surf.Metal);
  for (let i = 0; i < 5; i++) b.box(-24 + i * 0.9, 0, 9.2, -23.92 + i * 0.9, 0.9, 10.4, { bottom: null });
  bench(b, -8, 9.4, 0);
  bench(b, 8, 9.4, 0);
  shrub(b, rng, -31, 7.5, 0.8);
  shrub(b, rng, 31, 7.5, 0.8);
}

// ---------------------------------------------------------------------------------------------- freight yard
function freightStation(b: ModelBuilder, rng: RNG): void {
  // ground: gravel yard + asphalt front + two loading tracks
  b.paint(0x5f5c56, Surf.Pavement).box(-32, 0, -16, 32, 0.08, 16, { bottom: null });
  b.paint(0x45464a, Surf.Pavement).box(-32, 0, -4.3, 32, 0.1, 16, { bottom: null });
  trackX(b, -32, 32, -12.5, { sleeperPitch: 1.5 });
  trackX(b, -32, 32, -7.5, { sleeperPitch: 1.5, ballast: true });
  // freight cars
  freightCar(b, rng, -21, -12.5, 'flat', 0x444444);
  freightCar(b, rng, -3.2, -12.5, 'flat', 0x444444);
  freightCar(b, rng, 14.6, -12.5, 'tank', 0x2d2f33);
  freightCar(b, rng, -22, -7.5, 'box', 0x7a3b2b);
  freightCar(b, rng, -4.2, -7.5, 'box', 0x2e5a7a);
  freightCar(b, rng, 13.6, -7.5, 'hopper', 0x6b6f3a);
  // ---- transit shed with loading platform + cantilever canopy over track 2
  const sx0 = -31, sx1 = -8;
  b.paint(0x9d9990, Surf.Pavement).box(sx0, 0, -5.9, sx1, 1.2, -3.8, { bottom: null });
  b.paint(0xc9b48a, Surf.Corrugated).box(sx0, 0, -3.8, sx1, 7, 5.5, { top: null });
  b.paint(0x6e757c, Surf.Metal).gableRoof((sx0 + sx1) / 2, 0.85, sx1 - sx0, 9.3, 7, 1.6, 'x', 0.4, { color: 0xc9b48a, surf: Surf.Corrugated });
  b.paint(0x6e757c, Surf.Metal);
  quadF(b, [sx0, 6.2, -3.8], [sx1, 6.2, -3.8], [sx1, 5.4, -9.4], [sx0, 5.4, -9.4], [0, 1, 0.1]);
  quadF(b, [sx0, 6.1, -3.8], [sx1, 6.1, -3.8], [sx1, 5.3, -9.4], [sx0, 5.3, -9.4], [0, -1, -0.1]);
  b.paint(0x4a4f55, Surf.Metal);
  for (let x = sx0 + 1; x <= sx1 - 0.9; x += 5.5) obox(b, [x, 3.6, -3.8], [x, 5.8, -8.2], 0.16, 0.16, { ends: false });
  b.paint(0x5d646b, Surf.Metal);
  for (let i = 0; i < 4; i++) panel(b, 'z', -1, -3.84, sx0 + 2 + i * 5.6, sx0 + 5.4 + i * 5.6, 1.2, 4.6);
  for (let i = 0; i < 3; i++) panel(b, 'z', 1, 5.54, sx0 + 3 + i * 7, sx0 + 6.6 + i * 7, 0.1, 4.2);
  b.paint(0xfff0d0, Surf.Emissive).box(sx0 + 1, 5.25, -8.9, sx1 - 1, 5.4, -8.6, { top: null });
  // company stripe
  b.paint(0x1f5fa0, Surf.Plain).box(sx0 - 0.03, 5.6, -3.83, sx1 + 0.03, 6.4, 5.53, { top: null, bottom: null });
  // ---- rail-mounted gantry over tracks + container stack + truck lane
  b.paint(0x77726b, Surf.Metal);
  for (const zz of [-15.2, 9.2]) flat(b, -6, zz - 0.2, 31.5, zz + 0.2, 0.12);
  containerBlock(b, rng, -5, -4.0, 2, 3, 3, { minTier: 1 });
  containerBlock(b, rng, 22, -4.0, 1, 3, 2, { long: false, minTier: 1 });
  gantry(b, 10, -15.2, 9.2, 10.8, 13, 0xe0a81c, { trolleyAt: -7.5, overhang: 0.8 });
  semi(b, 2, 6.8, Math.PI / 2, 0xc0392b, CONTAINER_COLS[3], 0.1);
  // ---- front: office, gate, parked trucks
  b.paint(0xe2ddd2, Surf.WallWindows, 2, 3.2).box(19, 0, 10.2, 31, 6.6, 15, { top: { color: 0x7f7c76, surf: Surf.RoofFlat } });
  b.paint(0x1f5fa0, Surf.Metal).box(18.9, 6.6, 10.1, 31.1, 7.1, 15.1);
  b.paint(0xeaf2ff, Surf.Emissive).box(20, 5.4, 15.0, 27, 6.2, 15.08, { top: null, bottom: null, nz: null, px: null, nx: null });
  carLite(b, 16.5, 12.8, 0, rng.pick(CAR_COLS), 0.1);
  carLite(b, 13.5, 12.8, 0, rng.pick(CAR_COLS), 0.1);
  semi(b, -16, 11.5, -Math.PI / 2, 0xe8e6e0, CONTAINER_COLS[5], 0.1);
  semi(b, -21, 7.9, Math.PI / 2, 0x2e6fb5, null, 0.1);
  // gate barrier + booth
  b.paint(0xd9d4c8, Surf.WallWindows, 6, 2.8).box(3, 0, 13.8, 5, 2.6, 15.4, { top: { color: 0x9a968e, surf: Surf.RoofFlat } });
  b.paint(0xc0392b, Surf.Plain).box(5, 1.0, 14.5, 10.5, 1.15, 14.65);
  b.paint(0xf2f2ee, Surf.Plain);
  stripe(b, 4, 12.5, 12, 12.5, 0.3, 0.14);
  // yard lights + fence along the front
  floodMast(b, -2, 9.5, 14, 0);
  floodMast(b, 31, -4.6, 14, Math.PI / 2);
  b.paint(0x8a9096, Surf.Metal);
  obox(b, [-31.8, 1.8, 15.6], [2.5, 1.8, 15.6], 0.06, 0.06);
  for (let x = -31.8; x <= 2.6; x += 3.1) b.box(x - 0.05, 0, 15.55, x + 0.05, 1.9, 15.65, { top: null, bottom: null });
  lightDot(b, 10, 10.8 + 1.6, -15.2 - 0.4, 0.4, 0xff3322);
}

export const railModels = {
  tr_train_station: (b: ModelBuilder, _v: number, rng: RNG) => trainStation(b, rng),
  tr_freight_station: (b: ModelBuilder, _v: number, rng: RNG) => freightStation(b, rng),
};
