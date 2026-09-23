/**
 * Procedural models for the 'civic' group (police, fire, health, education, government, culture, misc).
 * See src/assets/manifest.ts for ids / footprints and src/assets/builders/civ_kit.ts for the shared helpers.
 *
 * Readability rules used here (SC4 style): police = blue fascia + cruisers + flag; fire = red brick, red bay doors,
 * hose tower + engine; health = white + emissive red cross + helipad + ambulance bay; schools = playground, courts,
 * buses, flag; government = limestone, columns, pediments, domes, clocks, flags.
 */
import type { ModelBuilders } from '../registry';
import type { ModelBuilder, ColorLike } from '../ModelBuilder';
import type { RNG } from '../../core/rng';
import { PALETTE } from '../ModelBuilder';
import { Surf } from '../../core/types';
import {
  vdisc, inscription, glyphBars,
  CIV, FLAGS, pnt, flat, stripe, disc, annulus, vrect, clockFace, windowsOnFace, doorOnFace, colonnade, colonnadeZ, steps, portico,
  domeOnDrum, vault, redCross, helipad, flag, wallSign, pylonSign, meshFence, meshFenceRect, ironFence, gatePier, tree, cypress,
  conifer, flowerBed, planter, hedgeBox, lamp, benchAt, fountain, miniCar, parking, parkingZ, cruiser, fireEngine, ambulance, bus,
  helicopter, basketballCourt, tennisCourt, runningTrack, bleachers, playground, gravestone, guardTower, antennaMast, CAR_COLS,
} from './civ_kit';

// ------------------------------------------------------------------------------------------------ local helpers
const lawnC = 0x6c9a45;
const lawnDark = 0x5a8a3c;

function grass(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, color: ColorLike = lawnC, h = 0.06) {
  b.paint(color, Surf.Foliage).slab(x0, z0, x1, z1, h);
}
const SW = CIV.signWhite;
function pave(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, color: ColorLike = PALETTE.sidewalk, h = 0.1) {
  b.paint(color, Surf.Pavement).slab(x0, z0, x1, z1, h);
}
function asphalt(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h = 0.08) {
  b.paint(CIV.asphalt, Surf.Pavement).slab(x0, z0, x1, z1, h);
}
/** Walled block with its own roof paint. */
function block(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, h: number, wall: ColorLike, surf: Surf, pattern = 0, floor = 3.6, roof: ColorLike = 0x8a8680) {
  b.paint(wall, surf, pattern, floor).box(x0, y0, z0, x1, y0 + h, z1, { top: pnt(roof, Surf.RoofFlat) });
}
/** Parapet ring on a flat roof (4 thin boxes). */
function parapet(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, color: ColorLike, h = 0.8, t = 0.3) {
  b.paint(color, Surf.Plain);
  b.box(x0, y, z0, x1, y + h, z0 + t, { bottom: null }).box(x0, y, z1 - t, x1, y + h, z1, { bottom: null });
  b.box(x0, y, z0 + t, x0 + t, y + h, z1 - t, { bottom: null, pz: null, nz: null }).box(x1 - t, y, z0 + t, x1, y + h, z1 - t, { bottom: null, pz: null, nz: null });
}
/** Band / fascia wrapped around a block (slightly proud of the wall). */
function band(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, color: ColorLike, surf: Surf = Surf.Plain, out = 0.12) {
  // sides only + a thin top ring (so a band at roof level doesn't cover the roof)
  const X0 = x0 - out, X1 = x1 + out, Z0 = z0 - out, Z1 = z1 + out, yt = y + h, t = out + 0.35;
  b.paint(color, surf).box(X0, y, Z0, X1, yt, Z1, { top: null });
  b.paint(color, Surf.Plain);
  flat(b, X0, Z1 - t, X1, Z1, yt);
  flat(b, X0, Z0, X1, Z0 + t, yt);
  flat(b, X0, Z0 + t, X0 + t, Z1 - t, yt);
  flat(b, X1 - t, Z0 + t, X1, Z1 - t, yt);
}
function acUnits(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, y: number, n: number) {
  for (let i = 0; i < n; i++) {
    const x = rng.range(x0 + 1.2, x1 - 1.2), z = rng.range(z0 + 1.2, z1 - 1.2);
    b.paint(0xa8acb0, Surf.Metal).boxC(x, z, 1.8, 1.4, y, 1.0, { bottom: null });
    b.paint(0x3a3d40, Surf.Metal).cylinder(x, z, y + 1.0, 0.08, 0.5, 0.5, 6);
  }
}
/** Canopy slab on thin posts. */
function canopy(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, color: ColorLike = CIV.trim, posts: [number, number][] = [], t = 0.35) {
  b.paint(color, Surf.Plain).box(x0, y, z0, x1, y + t, z1, { bottom: pnt(0xe8e4da, Surf.Plain) });
  b.paint(0x8a8d90, Surf.Metal);
  for (const [px, pz] of posts) b.boxC(px, pz, 0.25, 0.25, 0, y);
}
function treeRow(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, n: number, s = 1) {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    tree(b, rng, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, s);
  }
}
/** Blue police lamp on a post (classic station lamp). */
function policeLamp(b: ModelBuilder, x: number, z: number, h = 3.2) {
  b.paint(0x1e2530, Surf.Metal).cylinder(x, z, 0, h, 0.1, 0.07, 5, { top: false });
  b.paint(0x3f7bff, Surf.Emissive).boxC(x, z, 0.5, 0.5, h, 0.55);
  b.paint(0x1e2530, Surf.Metal).boxC(x, z, 0.65, 0.65, h + 0.55, 0.12, { bottom: null });
}
/** Roll-up garage / bay door (frame, door, window strip, slats) on +Z face at z. */
function bayDoor(b: ModelBuilder, cx: number, z: number, w: number, h: number, color: ColorLike, open = false, frame: ColorLike = CIV.trim) {
  b.paint(frame, Surf.Plain);
  vrect(b, cx - w / 2 - 0.35, 0, cx + w / 2 + 0.35, h + 0.35, z + 0.03);
  if (open) {
    b.paint(0x17191c, Surf.Plain);
    vrect(b, cx - w / 2, 0, cx + w / 2, h, z + 0.07);
    b.paint(color, Surf.Plain);
    vrect(b, cx - w / 2, h - 0.6, cx + w / 2, h, z + 0.11);
    return;
  }
  b.paint(color, Surf.Metal);
  vrect(b, cx - w / 2, 0, cx + w / 2, h, z + 0.07);
  b.paint(0x2a3440, Surf.GlassPlain);
  vrect(b, cx - w / 2 + 0.3, h * 0.62, cx + w / 2 - 0.3, h * 0.74, z + 0.11);
  const c = typeof color === 'number' ? color : 0x888888;
  b.paint((c >> 1) & 0x7f7f7f, Surf.Plain);
  for (const f of [0.25, 0.45, 0.85]) vrect(b, cx - w / 2, h * f, cx + w / 2, h * f + 0.06, z + 0.11);
}
/** Stepped hip-roofed pavilion roof on a block */
function hipOn(b: ModelBuilder, cx: number, cz: number, w: number, d: number, y: number, h: number, color: ColorLike, overhang = 0.4) {
  b.paint(color, Surf.RoofTiles).hipRoof(cx, cz, w, d, y, h, overhang);
}

// ================================================================================================= POLICE
function policeKiosk(b: ModelBuilder, _v: number, rng: RNG) {
  pave(b, -8, -8, 8, 8, 0xc8c3b8);
  grass(b, -7.6, -7.6, -1, -4.8, lawnDark);
  // kiosk
  const x0 = -5.2, x1 = 1.2, z0 = -4.4, z1 = 0.8, h = 3.3;
  b.paint(0xeeeeea, Surf.Plain).box(x0, 0.1, z0, x1, h, z1, { top: null });
  b.paint(CIV.policeBlue, Surf.Plain).box(x0 - 0.1, 0.1, z0 - 0.1, x1 + 0.1, 0.6, z1 + 0.1, { top: null });
  // big windows + door on front and right side
  windowsOnFace(b, 'pz', z1, x0 + 0.4, x1 - 2.2, 0.1, 1, 3, 2, 1.5, 1.6, 0xe8e8e8, 0x2a3440, 0.9, true);
  doorOnFace(b, 'pz', z1, x1 - 1.2, 1.1, 2.3, 0x28303a);
  windowsOnFace(b, 'px', x1, -z1 + 0.3, -z0 - 0.3, 0.1, 1, 3, 2, 1.6, 1.5, 0xe8e8e8, 0x2a3440, 0.9, true);
  // blue fascia + roof slab
  b.paint(CIV.policeBlue, Surf.Plain).box(x0 - 0.5, h, z0 - 0.5, x1 + 0.5, h + 0.55, z1 + 0.7, { top: pnt(0x7d7f82, Surf.RoofFlat), bottom: pnt(0xdad8d2) });
  wallSign(b, (x0 + x1) / 2 - 0.4, h + 0.28, z1 + 0.72, 3.4, 0.36, SW, 'pz', CIV.policeBlue, undefined, CIV.policeBlue);
  // roof lantern (blue lamp)
  b.paint(0x2a2d33, Surf.Metal).boxC(-2, -1.8, 0.6, 0.6, h + 0.55, 0.3);
  b.paint(0x4d8bff, Surf.Emissive).boxC(-2, -1.8, 0.45, 0.45, h + 0.85, 0.5);
  b.paint(0x2a2d33, Surf.Metal).pyramid(-2, -1.8, 0.65, 0.65, h + 1.35, 0.35);
  acUnits(b, rng, -4.8, -4, -3.2, -2.5, h + 0.55, 1);
  // parking pad with cruiser
  asphalt(b, 2.4, -7.5, 7.6, 3.5, 0.13);
  b.paint(0xf2f2f2, Surf.Plain);
  flat(b, 2.5, -7.4, 2.65, 3.4, 0.16);
  flat(b, 7.35, -7.4, 7.5, 3.4, 0.16);
  cruiser(b, 5.0, -1.8, 0.04, 0.13);
  // street furniture
  flag(b, -6.6, 5.6, 6.4, FLAGS.police, 0, 1.2);
  benchAt(b, -1.6, 5.9, Math.PI);
  planter(b, -4.4, 5.6, 0.75);
  planter(b, 1.0, 5.6, 0.75);
  for (const x of [3.2, 5.0, 6.8]) b.paint(0xf2c230, Surf.Metal).cylinder(x, 5.2, 0, 0.8, 0.13, 0.13, 6);
  tree(b, rng, -6.2, -6.2, 0.75);
}

function policeStation(b: ModelBuilder, _v: number, rng: RNG) {
  // ground
  grass(b, -16, 2, 5, 16);
  grass(b, -16, -6.5, 5, 2);
  asphalt(b, 5, -16, 16, 16);
  asphalt(b, -16, -16, 5, -6.5);
  pave(b, -7.5, 3.5, -0.5, 14.4, PALETTE.sidewalk, 0.1);
  pave(b, -16, 14.4, 16, 16, PALETTE.sidewalk, 0.12);
  // main building: 3 storeys, tan brick-look with windows, blue fascia band
  const x0 = -15, x1 = 4, z0 = -5.5, z1 = 3.5, fl = 3.6, H = fl * 3;
  block(b, x0, z0, x1, z1, 0, H, 0xcdb998, Surf.WallWindows, 0, fl);
  band(b, x0, z0, x1, z1, 0, 0.9, 0x6d6a66, Surf.Stone, 0.08);
  band(b, x0, z0, x1, z1, H - 0.2, 1.1, CIV.policeBlue, Surf.Plain, 0.15);
  parapet(b, x0 - 0.15, z0 - 0.15, x1 + 0.15, z1 + 0.15, H + 0.9, CIV.policeBlue, 0.3, 0.3);
  // entrance pavilion: glass + blue canopy
  const ex0 = -7, ex1 = -1;
  b.paint(0xe9e6df, Surf.Plain).box(ex0, 0, z1, ex1, 5.2, z1 + 2.2, { top: pnt(0x8a8680, Surf.RoofFlat) });
  b.paint(0x5d86a8, Surf.GlassCurtain, 0, 2.6).box(ex0 + 0.5, 0.1, z1 + 2.2, ex1 - 0.5, 4.2, z1 + 2.25, { top: null });
  canopy(b, ex0 - 0.8, z1 + 2.0, ex1 + 0.8, z1 + 4.4, 4.3, CIV.policeBlue, [[ex0 - 0.5, z1 + 4.1], [ex1 + 0.5, z1 + 4.1]]);
  wallSign(b, (ex0 + ex1) / 2, 4.47, z1 + 4.42, 5.2, 0.34, SW, 'pz', CIV.policeBlue, undefined, CIV.policeBlue);
  b.paint(CIV.concreteLight, Surf.Stone).box(ex0 - 0.4, 0, z1, ex1 + 0.4, 0.3, z1 + 3.1);
  steps(b, (ex0 + ex1) / 2, z1 + 3.6, 5, 2, 0.15, 0.25, CIV.concreteLight);
  policeLamp(b, ex0 - 0.9, z1 + 5.2);
  policeLamp(b, ex1 + 0.9, z1 + 5.2);
  // badge emblem on a blue plaque on the facade above the entrance
  b.paint(CIV.policeBlue, Surf.Plain).boxC((ex0 + ex1) / 2, z1 + 0.05, 1.9, 0.12, 6.3, 1.9);
  b.paint(CIV.gold, Surf.Metal);
  vdisc(b, (ex0 + ex1) / 2, 7.25, z1 + 0.15, 0.72, 8, 'pz');
  // roof: AC units, radio mast, stair hut
  acUnits(b, rng, x0 + 1, z0 + 1, x1 - 5, z1 - 1, H + 0.9, 3);
  b.paint(0xbcb6aa, Surf.Plain).boxC(x1 - 3, z0 + 2.5, 3, 3, H + 0.9, 2.4);
  antennaMast(b, x0 + 2, z0 + 1.5, H + 0.9, 4.5);
  // sallyport / garage wing at the back right
  block(b, -3, -15, 4.5, -6.5, 0, 4.2, 0xbfb29a, Surf.Plain, 0, 3.6);
  band(b, -3, -15, 4.5, -6.5, 0, 0.8, 0x6d6a66, Surf.Stone, 0.06);
  band(b, -3, -15, 4.5, -6.5, 3.6, 0.6, CIV.policeBlue);
  // two sallyport doors facing the back lot (-X face)
  b.push().rotateY(-Math.PI / 2);
  bayDoor(b, -12.9, 3.06, 3.0, 3.1, 0xd8d8d8);
  bayDoor(b, -8.7, 3.06, 3.0, 3.1, 0xd8d8d8);
  b.pop();
  // back lot with cruisers (behind fence)
  b.paint(0xf2f2f2, Surf.Plain);
  for (let i = 0; i < 4; i++) flat(b, -15 + i * 2.9 + 2.8, -15.4, -15 + i * 2.9 + 2.95, -10.4, 0.11);
  cruiser(b, -13.5, -12.9, Math.PI);
  cruiser(b, -10.6, -12.9, Math.PI + 0.03);
  cruiser(b, -4.8, -12.9, Math.PI);
  miniCar(b, -7.7, -12.9, Math.PI, 0x2b2d31);
  // side lot stalls along the drive
  b.paint(0xf2f2f2, Surf.Plain);
  for (let i = 0; i < 6; i++) flat(b, 11.2, -12 + i * 3.0, 15.6, -11.86 + i * 3.0, 0.11);
  cruiser(b, 13.4, -10.5, Math.PI / 2);
  cruiser(b, 13.4, -4.5, Math.PI / 2 + 0.04);
  miniCar(b, 13.4, -1.5, -Math.PI / 2, 0x8a1c1c);
  miniCar(b, 13.4, 1.5, Math.PI / 2, 0xb8bcc2);
  cruiser(b, 8.0, 9.5, 0.02);
  // fences
  meshFence(b, -15.8, -15.8, 4.5, -15.8, 2.4);
  meshFence(b, -15.8, -15.8, -15.8, -6, 2.4);
  // front lawn: flags, trees, shrubs
  flag(b, -13, 10.5, 9, FLAGS.nation, 0, 1.4);
  flag(b, -12, 12.8, 8, FLAGS.police, 0, 1.2);
  tree(b, rng, -14, 6.5, 0.9);
  tree(b, rng, 2.5, 7.5, 0.9);
  hedgeBox(b, -14.6, 4.2, -8, 5.0, 0.9);
  hedgeBox(b, 0.5, 4.2, 4.5, 5.0, 0.9);
  lamp(b, 6.0, 13.8);
}

function policeHQ(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 24;
  asphalt(b, -s, -s, s, -4);
  pave(b, -s, -4, s, s, 0xcdc8bd);
  grass(b, -22.5, 8, -7, 22, lawnC, 0.14);
  grass(b, 7, 8, 22.5, 22, lawnC, 0.14);
  // podium (2 floors) + tower (8 floors)
  const fl = 3.8;
  // podium
  block(b, -21, -10, 21, 4, 0, fl * 2, 0xdedbd3, Surf.WallWindows, 2, fl);
  band(b, -21, -10, 21, 4, fl * 2 - 0.9, 1.4, CIV.policeBlue, Surf.Plain, 0.12);
  // glass lobby cut into podium front
  b.paint(0x5d86a8, Surf.GlassCurtain, 5, 3.8).box(-7, 0.1, 4, 7, fl * 2 - 0.3, 4.4, { top: null });
  canopy(b, -9, 4.2, 9, 9.5, 4.6, 0xeae7e0, [[-8.5, 9], [8.5, 9], [0, 9]], 0.4);
  wallSign(b, 0, 4.8, 9.55, 9, 0.5, SW, 'pz', CIV.policeBlue, undefined, CIV.policeBlue);
  // tower
  const tx0 = -13, tx1 = 13, tz0 = -9, tz1 = 1;
  const TH = fl * 7;
  b.paint(0x4d78a0, Surf.GlassCurtain, 0, fl).box(tx0, fl * 2, tz0, tx1, fl * 2 + TH, tz1, { top: pnt(0x7d7a75, Surf.RoofFlat) });
  // concrete end cores with blue stripe
  for (const x of [tx0 - 2.4, tx1]) {
    block(b, x, tz0 - 0.5, x + 2.4, tz1 + 0.5, fl * 2, TH + 1.2, CIV.policeBlue, Surf.Plain);
    b.paint(0xf2f2f0, Surf.Plain).box(x + 0.9, fl * 2, tz1 + 0.5, x + 1.5, fl * 2 + TH - 0.8, tz1 + 0.56, { top: null });
  }
  // horizontal fins on glass
  for (let f = 3; f <= 8; f++) b.paint(0xe4e1da, Surf.Plain).box(tx0, f * fl - 0.2, tz1, tx1, f * fl + 0.1, tz1 + 0.5);
  const roofY = fl * 2 + TH;
  parapet(b, tx0, tz0, tx1, tz1, roofY, 0xe4e1da, 0.9);
  // navy crown band with the HQ sign (+Z and +X faces)
  band(b, tx0 - 2.4, tz0 - 0.5, tx1 + 2.4, tz1 + 0.5, roofY - 0.4, 1.55, CIV.navy, Surf.Plain, 0.1);
  wallSign(b, 0, roofY + 0.4, tz1 + 0.62, 12, 0.9, SW, 'pz', CIV.navy, undefined, CIV.policeBlue);
  wallSign(b, tx1 + 2.52, roofY + 0.4, (tz0 + tz1) / 2, 8.5, 0.9, SW, 'px', CIV.navy, undefined, CIV.policeBlue);
  // rooftop helipad + helicopter
  helipad(b, -4, -4, roofY + 0.2, 4.8, 0x3f7bff);
  helicopter(b, -4.4, roofY + 0.34, -4.2, 0.6, 0x1f3f7a, 0xf2f2f2);
  b.paint(0xbcb8b0, Surf.Plain).boxC(7.5, -4, 5, 6, roofY, 2.8);
  antennaMast(b, 9, -5.5, roofY + 2.8, 3.5);
  acUnits(b, rng, 4.5, -8, 11.5, 0.5, roofY + 2.8, 0);
  // podium roof clutter
  acUnits(b, rng, -20, -9, -14, 3, fl * 2 + 0.5, 3);
  acUnits(b, rng, 14, -9, 20, 3, fl * 2 + 0.5, 3);
  // secure parking behind podium: fence + gatehouse + barrier + rows of cruisers
  meshFence(b, -23.5, -23.5, 23.5, -23.5, 2.6);
  meshFence(b, -23.5, -23.5, -23.5, -10, 2.6);
  meshFence(b, 23.5, -23.5, 23.5, -14, 2.6);
  b.paint(0xdedbd3, Surf.Plain).boxC(21.2, -12.2, 2.6, 2.6, 0, 2.8, { top: pnt(CIV.policeBlue) });
  b.paint(0x2a3440, Surf.GlassPlain).boxC(21.2, -12.2, 2.7, 2.0, 1.0, 1.4, { top: null });
  b.paint(0xd23a2a, Surf.Plain).box(17.2, 1.0, -11.1, 20.2, 1.15, -10.95);
  b.paint(0xf2f2f2, Surf.Plain);
  for (let i = 0; i <= 13; i++) flat(b, -21 + i * 2.9 - 0.07, -22.8, -21 + i * 2.9 + 0.07, -17.8, 0.11);
  for (let i = 0; i < 13; i++) {
    const x = -21 + i * 2.9 + 1.45;
    if (i % 4 === 3) miniCar(b, x, -20.3, Math.PI, rng.pick(CAR_COLS));
    else if (rng.chance(0.85)) cruiser(b, x, -20.3, Math.PI + rng.range(-0.04, 0.04));
  }
  for (let i = 0; i < 5; i++) cruiser(b, -18 + i * 3, -13.5, 0.03 * i);
  // front plaza: flags + planters + trees
  for (let i = 0; i < 3; i++) flag(b, -5 + i * 3.8, 17.5, 10, [FLAGS.nation, FLAGS.city, FLAGS.police][i], 0, 1.4);
  treeRow(b, rng, -20, 12, -10, 12, 3, 1);
  treeRow(b, rng, 10, 12, 20, 12, 3, 1);
  treeRow(b, rng, -20, 19, -10, 19, 3, 0.9);
  treeRow(b, rng, 10, 19, 20, 19, 3, 0.9);
  policeLamp(b, -9.5, 10.5, 3.4);
  policeLamp(b, 9.5, 10.5, 3.4);
  // drop-off lane in front of the lobby
  asphalt(b, -7, 10.2, 7, 13.8, 0.14);
  b.paint(0xf2f2f2, Surf.Plain);
  flat(b, -6.8, 11.95, 6.8, 12.05, 0.17);
  cruiser(b, -2.5, 11.1, Math.PI / 2, 0.14);
}

function jail(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 32;
  b.paint(0x9a9c88, Surf.Foliage).slab(-s, -s, s, s, 0.05);
  // perimeter wall
  const w0 = -29, w1 = 29, wz0 = -30, wz1 = 18, WH = 6;
  const wall = 0x9d998f, coping = pnt(0xcfcac0);
  b.paint(wall, Surf.Plain);
  b.box(w0, 0, wz0, w1, WH, wz0 + 0.8, { top: coping });
  b.box(w0, 0, wz0 + 0.8, w0 + 0.8, WH, wz1, { top: coping });
  b.box(w1 - 0.8, 0, wz0 + 0.8, w1, WH, wz1, { top: coping });
  b.box(w0 + 0.8, 0, wz1 - 0.8, -5, WH, wz1, { top: coping });
  b.box(5, 0, wz1 - 0.8, w1 - 0.8, WH, wz1, { top: coping });
  // razor wire: two pale coils on outriggers
  const wire = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
    b.paint(0xd0d4d8, Surf.Metal);
    b.beam([ax - nx * 0.25, WH + 0.25, az - nz * 0.25], [bx - nx * 0.25, WH + 0.25, bz - nz * 0.25], 0.18);
    b.beam([ax + nx * 0.25, WH + 0.55, az + nz * 0.25], [bx + nx * 0.25, WH + 0.55, bz + nz * 0.25], 0.18);
    b.paint(0x6a6e72, Surf.Metal);
    const k = Math.max(1, Math.round(len / 12));
    for (let i = 0; i <= k; i++) {
      const t = i / k, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      b.beam([x - nx * 0.3, WH, z - nz * 0.3], [x + nx * 0.3, WH + 0.65, z + nz * 0.3], 0.07);
    }
  };
  wire(w0, wz0 + 0.4, w1, wz0 + 0.4);
  wire(w0 + 0.4, wz0, w0 + 0.4, wz1);
  wire(w1 - 0.4, wz0, w1 - 0.4, wz1);
  wire(w0, wz1 - 0.4, -5, wz1 - 0.4);
  wire(5, wz1 - 0.4, w1, wz1 - 0.4);
  // inner ground (yard gravel)
  b.paint(0x8f8a7c, Surf.Pavement).slab(w0 + 0.8, wz0 + 0.8, w1 - 0.8, wz1 - 0.8, 0.08);
  // guard towers at corners
  for (const [x, z] of [[w0 + 1.2, wz0 + 1.2], [w1 - 1.2, wz0 + 1.2], [w0 + 1.2, wz1 - 1.2], [w1 - 1.2, wz1 - 1.2]] as [number, number][]) guardTower(b, x, z, 13.5, 0xc8c3b6);
  // gatehouse / sallyport at front
  const fl = 3.6;
  block(b, -7, 12, 7, 22, 0, fl * 2, 0xc9c3b5, Surf.WallWindows, 4, fl);
  band(b, -7, 12, 7, 22, fl * 2 - 0.2, 0.7, 0x6d6f73);
  bayDoor(b, 0, 22, 4.2, 3.6, 0x5a5f64);
  wallSign(b, 0, 5.2, 22.02, 6, 0.5, SW, 'pz', 0x3a3d42, undefined, 0x2a2d32);
  // cell blocks (3 long blocks, slit windows)
  const cellCol = 0xcbb892;
  for (const [cz, len] of [[-22, 44], [-10, 44]] as [number, number][]) {
    block(b, -len / 2, cz - 4.5, len / 2, cz + 4.5, 0, fl * 3, cellCol, Surf.WallWindows, 4, fl, 0x66645e);
    band(b, -len / 2, cz - 4.5, len / 2, cz + 4.5, 0, 1.2, 0x77746c, Surf.Plain, 0.06);
    band(b, -len / 2, cz - 4.5, len / 2, cz + 4.5, fl * 3 - 0.2, 0.6, 0x5a5854);
    b.paint(0x2c3a44, Surf.GlassPlain).box(-len / 2 + 3, fl * 3, cz - 0.8, len / 2 - 3, fl * 3 + 0.5, cz + 0.8, { bottom: null });
    acUnits(b, rng, -len / 2 + 2, cz + 1.2, len / 2 - 2, cz + 3.8, fl * 3, 2);
  }
  // central spine connecting blocks
  block(b, -3, -18, 3, -14, 0, fl * 2, cellCol, Surf.Plain, 0, fl);
  block(b, -3, -6, 3, 12, 0, fl * 2, cellCol, Surf.WallWindows, 4, fl);
  // exercise yard: basketball court + fenced yard + grass
  b.paint(0x6f9a45, Surf.Foliage).slab(-27, -3, -5, 10, 0.12);
  // inmates in orange jumpsuits
  for (const [x, z] of [[-22, 2], [-20.8, 2.6], [-15, 6], [-12, 1], [-11.2, 1.8], [-8, 7], [13, 1], [15.5, 5.5], [21, 3], [22, 7.5]] as [number, number][]) {
    b.paint(0xe8741e, Surf.Plain).boxC(x, z, 0.5, 0.32, x < 0 ? 0.12 : 0.21, 1.25);
    b.paint(0x8a6446, Surf.Plain).boxC(x, z, 0.26, 0.26, (x < 0 ? 0.12 : 0.21) + 1.25, 0.3);
  }
  basketballCourt(b, 17, 3.5, true, 0x7a7f84, 0x8a8f94);
  meshFenceRect(b, -26.5, -2.5, -5.5, 9.5, 3.2);
  // prison bus and patrol car in front
  asphalt(b, -30, 22.5, 30, 31, 0.09);
  bus(b, -16, 26, Math.PI / 2, 0xe8e8e4, false, 0.09);
  cruiser(b, 14, 26.5, -Math.PI / 2, 0.09);
  cruiser(b, 20, 26.5, -Math.PI / 2, 0.09);
  miniCar(b, 25, 26.5, -Math.PI / 2, rng.pick(CAR_COLS), 0.09);
  // floodlight poles in the yard
  for (const [x, z] of [[-16, -2], [8, -2], [8, 10]] as [number, number][]) {
    b.paint(0x5a5f64, Surf.Metal).cylinder(x, z, 0, 10, 0.15, 0.1, 5, { top: false });
    b.paint(0xfff5d0, Surf.Emissive).boxC(x, z, 1.4, 0.6, 10, 0.6);
  }
  flag(b, 9, 24.5, 10, FLAGS.nation, 0, 1.4);
}

// ================================================================================================= FIRE
function fireStation(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 16;
  grass(b, -s, -s, s, s);
  pave(b, -14, 4.5, 6, 16, 0xcfcac0, 0.1);
  asphalt(b, 7, -6, 15.5, 15.5);
  // firehouse: 2 storeys red brick, 3 bays
  const x0 = -14, x1 = 6, z0 = -8, z1 = 4.5, H1 = 5.0, H = 8.6;
  b.paint(CIV.brick, Surf.Brick).box(x0, 0, z0, x1, H, z1, { top: pnt(0x77726c, Surf.RoofFlat) });
  // stone string course + cornice
  band(b, x0, z0, x1, z1, H1, 0.4, CIV.limestone, Surf.Plain, 0.1);
  band(b, x0, z0, x1, z1, H - 0.1, 0.6, CIV.limestone, Surf.Plain, 0.18);
  parapet(b, x0 - 0.18, z0 - 0.18, x1 + 0.18, z1 + 0.18, H + 0.5, CIV.brickDark, 0.5, 0.35);
  // bays
  const bays = [-10.5, -4, 2.5];
  bays.forEach((bx, i) => bayDoor(b, bx, z1, 4.2, 4.3, 0xc4211b, i === 1));
  // upper windows + sign
  windowsOnFace(b, 'pz', z1, x0 + 0.5, x1 - 0.5, H1, 1, 3.6, 7, 1.0, 1.7, CIV.limestone, 0x2a3440, 0.5);
  // raised central parapet with the station name board
  b.paint(CIV.brick, Surf.Brick).box(-9, H, z1 - 0.35, 1, H + 2.2, z1, { top: pnt(CIV.limestone) });
  b.paint(CIV.limestone, Surf.Plain).box(-9.2, H + 2.2, z1 - 0.45, 1.2, H + 2.5, z1 + 0.1);
  wallSign(b, -4, H + 1.25, z1 + 0.02, 7.6, 0.9, SW, 'pz', CIV.fireRed, undefined, CIV.fireRed);
  windowsOnFace(b, 'px', x1, -z1 + 0.6, -z0 - 0.6, 0, 2, 4.4, 4, 1.0, 1.8, CIV.limestone, 0x2a3440, 1.3);
  windowsOnFace(b, 'nx', -x0, z0 + 0.6, z1 - 0.6, 0, 2, 4.4, 4, 1.0, 1.8, CIV.limestone, 0x2a3440, 1.3);
  // side door
  doorOnFace(b, 'px', x1, -2.5, 1.2, 2.4, 0x6b1c16, 0x2a2020);
  // fire engine pulling out of middle bay, ladder truck parked on apron
  fireEngine(b, -4, 6.8, 0, false);
  fireEngine(b, 2.5, 9.2, 0.02, true);
  // emissive red lights above bays
  b.paint(CIV.bayLight, Surf.Emissive);
  for (const bx of bays) b.boxC(bx, z1 + 0.15, 0.35, 0.3, 4.7, 0.25);
  // hose drying tower (brick, pyramid roof)
  const tx = 10.5, tz = -10;
  b.paint(CIV.brick, Surf.Brick).boxC(tx, tz, 4.2, 4.2, 0, 12);
  b.paint(CIV.limestone, Surf.Plain).boxC(tx, tz, 4.7, 4.7, 11.6, 0.5);
  b.paint(0x2a3440, Surf.GlassPlain);
  vrect(b, tx - 0.5, 9.0, tx + 0.5, 11.0, tz + 2.12);
  vrect(b, tx - 0.5, 5.0, tx + 0.5, 6.6, tz + 2.12);
  b.paint(0x4a4f55, Surf.RoofTiles).pyramid(tx, tz, 4.8, 4.8, 12.1, 2.2);
  b.paint(0xe8e8e8, Surf.Metal).cylinder(tx, tz, 14.3, 0.1, 0.12, 0.05, 4);
  // connecting low wing
  block(b, x1, -9, 8.4, -4, 0, 4, CIV.brick, Surf.Brick);
  // staff cars + flag + tree + hydrant
  miniCar(b, 11.5, -1, Math.PI / 2, rng.pick(CAR_COLS));
  miniCar(b, 11.5, 2.2, -Math.PI / 2, rng.pick(CAR_COLS));
  miniCar(b, 11.5, 5.4, Math.PI / 2, rng.pick(CAR_COLS));
  b.paint(0xf2f2f2, Surf.Plain);
  for (let i = 0; i < 4; i++) flat(b, 9, -2.6 + i * 3.2, 14, -2.46 + i * 3.2, 0.11);
  flag(b, -15, 14.5, 8, FLAGS.nation, 0, 1.4);
  b.paint(0xd02a1e, Surf.Metal).cylinder(-12, 14.8, 0, 0.8, 0.18, 0.15, 6).boxC(-12, 14.8, 0.6, 0.18, 0.45, 0.18);
  tree(b, rng, -12, -13, 1);
  tree(b, rng, -4, -13.5, 0.9);
  tree(b, rng, 3, -13, 1);
}

function fireHQ(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 24;
  grass(b, -s, -s, s, s);
  pave(b, -22, 3, 14, 24, 0xcfcac0, 0.1);
  asphalt(b, 14, -24, 24, 24);
  asphalt(b, -24, -24, 14, -12);
  // main building: 5 bays + 3-storey office block
  const x0 = -22, x1 = 14, z0 = -10, z1 = 3, H1 = 5.4;
  b.paint(CIV.brick, Surf.Brick).box(x0, 0, z0, x1, H1 + 3.8, z1, { top: pnt(0x77726c, Surf.RoofFlat) });
  band(b, x0, z0, x1, z1, H1, 0.4, CIV.limestone, Surf.Plain, 0.1);
  band(b, x0, z0, x1, z1, H1 + 3.7, 0.55, CIV.limestone, Surf.Plain, 0.16);
  const bays = [-18.6, -12.4, -6.2, 0, 6.2];
  bays.forEach((bx, i) => bayDoor(b, bx, z1, 4.4, 4.6, 0xc4211b, i === 1 || i === 3));
  windowsOnFace(b, 'pz', z1, x0 + 0.6, x1 - 0.6, H1, 1, 3.8, 11, 1.0, 1.8, CIV.limestone, 0x2a3440, 0.6);
  b.paint(CIV.bayLight, Surf.Emissive);
  for (const bx of bays) b.boxC(bx, z1 + 0.15, 0.35, 0.3, 5.05, 0.25);
  // office tower block on the right (3 storeys + parapet), red horizontal band
  const ox0 = 8, ox1 = 14;
  b.paint(0xd9cfbd, Surf.WallWindows, 1, 4.0).box(ox0, 0, z0 - 4, ox1 + 0.35, 16, z1 - 5, { top: pnt(0x77726c, Surf.RoofFlat) });
  band(b, ox0, z0 - 4, ox1 + 0.35, z1 - 5, 14.8, 1.4, CIV.fireRed, Surf.Plain, 0.14);
  wallSign(b, (ox0 + ox1 + 0.35) / 2, 15.5, z1 - 4.85, 5.2, 0.9, SW, 'pz', CIV.fireRed, undefined, CIV.fireRed);
  // training tower: open concrete frame, 6 levels
  const tx0 = -22, tz0 = -22;
  const th = 20;
  b.paint(0xc9c3b8, Surf.Plain);
  for (const [dx, dz] of [[0, 0], [6, 0], [0, 6], [6, 6]]) b.box(tx0 + dx, 0, tz0 + dz, tx0 + dx + 0.6, th, tz0 + dz + 0.6);
  for (let l = 1; l <= 6; l++) {
    const y = (l * th) / 6.3;
    b.paint(0xb8b2a6, Surf.Plain).box(tx0, y, tz0, tx0 + 6.6, y + 0.3, tz0 + 6.6);
    b.paint(0x3a1f1a, Surf.Plain);
    vrect(b, tx0 + 1.5, y - 2.2, tx0 + 3.2, y - 0.3, tz0 + 6.62);
  }
  b.paint(CIV.fireRed, Surf.Plain).box(tx0 - 0.1, th - 1.2, tz0 - 0.1, tx0 + 6.7, th, tz0 + 6.7, { top: pnt(0x77726c, Surf.RoofFlat) });
  // external stair (zig-zag beams) + hose tower detail
  for (let l = 0; l < 6; l++) {
    const ya = (l * th) / 6.3, yb = ((l + 1) * th) / 6.3;
    b.paint(0xd4d8dc, Surf.Metal);
    b.beam([tx0 + 6.75, ya, tz0 + (l % 2 ? 6 : 0.6)], [tx0 + 6.75, yb, tz0 + (l % 2 ? 0.6 : 6)], 0.18);
    // landing at the top of each flight
    const lz = l % 2 ? 0 : 5.4;
    b.paint(0xb8bcc0, Surf.Metal).box(tx0 + 6.6, yb - 0.12, tz0 + lz, tx0 + 7.3, yb, tz0 + lz + 1.2);
  }
  // training yard: burn building (sooty) + drill ground
  b.paint(0x7a7570, Surf.Pavement).slab(-14, -22.5, 12, -12.5, 0.12);
  b.paint(0x55504b, Surf.Plain).boxC(-6, -18, 6, 5, 0, 4.2);
  b.paint(0x1c1a18, Surf.Plain);
  vrect(b, -7.5, 1, -5.5, 3.2, -15.46);
  b.paint(0x2a2622, Surf.Plain);
  b.quad([-7.7, 3.2, -15.44], [-5.3, 3.2, -15.44], [-4.9, 4.2, -15.44], [-8.1, 4.2, -15.44]);
  b.paint(0x1c1a18, Surf.Plain);
  b.push().rotateY(Math.PI / 2);
  vrect(b, 17.2, 1.8, 18.8, 3.2, -2.96);
  b.paint(0x2a2622, Surf.Plain);
  b.quad([17.0, 3.2, -2.94], [19.0, 3.2, -2.94], [19.3, 4.2, -2.94], [16.7, 4.2, -2.94]);
  b.pop();
  b.paint(0x2a2622, Surf.Plain);
  for (let l = 1; l <= 6; l += 2) vrect(b, tx0 + 1.3, (l * th) / 6.3 - 0.3, tx0 + 3.4, (l * th) / 6.3 + 0.6, tz0 + 6.64);
  // trucks
  fireEngine(b, -12.4, 5.0, 0, false);
  fireEngine(b, 0, 8.3, 0.03, true);
  fireEngine(b, -3, -16.5, Math.PI / 2 + 0.2, false);
  ambulance(b, 19, 14, 0);
  ambulance(b, 19, -8, Math.PI);
  // side parking
  parkingZ(b, rng, 14.5, -23.5, 23.8, 8, 0.55, CAR_COLS, false);
  // front details
  flag(b, -20.5, 19.5, 10, FLAGS.nation, 0, 1.4);
  flag(b, -17.5, 21.5, 9, FLAGS.fire, 0, 1.2);
  pylonSign(b, 8, 21, 5.5, 2.4, SW, CIV.brick, 1.2, CIV.fireRed);
  treeRow(b, rng, -21, 12, -21, 18, 2, 1);
  treeRow(b, rng, 11, 17, 11, 11, 1, 1);
  b.paint(0xd02a1e, Surf.Metal).cylinder(-8, 22.5, 0, 0.8, 0.18, 0.15, 6);
}

// ================================================================================================= HEALTH
function clinic(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 16;
  grass(b, -s, -s, s, s);
  parking(b, rng, -15.2, 4.4, 5.6, 14.6, 0.55);
  asphalt(b, 5.6, -8, 15.5, 15.5);
  pave(b, -15.5, 1.5, 9, 4.4, PALETTE.sidewalk, 0.12);
  // building
  const x0 = -14, x1 = 8.6, z0 = -10, z1 = 1.5, H = 4.8;
  block(b, x0, z0, x1, z1, 0, H, CIV.hospitalWhite, Surf.WallWindows, 2, 4.8);
  band(b, x0, z0, x1, z1, H - 0.3, 0.9, 0xf7f7f5, Surf.Plain, 0.2);
  b.paint(0x2c9a9a, Surf.Plain).box(x0 - 0.22, H + 0.3, z1 + 0.05, x1 + 0.22, H + 0.45, z1 + 0.24, { top: null });
  // raised front volume w/ glass entry
  block(b, -7.5, z1 - 3, -1, z1 + 1.5, 0, 6.2, 0xf7f7f5, Surf.Plain);
  b.paint(0x6c9cb0, Surf.GlassCurtain, 5, 3.1).box(-7.0, 0.1, z1 + 1.5, -1.5, 4.8, z1 + 1.55, { top: null });
  redCross(b, -4.25, 5.2, z1 + 1.62, 2.2, 'pz', null);
  canopy(b, -8.5, z1 + 1.4, 0, z1 + 3.2, 3.4, 0xf7f7f5, [[-8.2, z1 + 3.0], [-0.3, z1 + 3.0]], 0.3);
  acUnits(b, rng, 0, z0 + 1, 7, z1 - 3.5, H, 3);
  // big roof cross (reads from the sky / game camera)
  b.paint(0xf7f7f5, Surf.Plain);
  flat(b, -13, -8, -7, -2, H + 0.03);
  b.paint(CIV.crossRed, Surf.Emissive);
  flat(b, -10.7, -7.2, -9.3, -2.8, H + 0.06);
  flat(b, -12.2, -5.7, -10.7, -4.3, H + 0.06);
  flat(b, -9.3, -5.7, -7.8, -4.3, H + 0.06);
  // ambulance bay canopy on the right with EMERGENCY strip
  canopy(b, 7.2, -7.5, 15, 1.2, 4.4, 0xf2f2ef, [[14.6, -7.1], [14.6, 0.8]], 0.4);
  b.paint(CIV.emergency, Surf.Emissive).box(8, 4.45, 1.21, 14.4, 4.72, 1.3, { top: null });
  b.push().translate(11.2, 4.585, 1.3);
  glyphBars(b, 5.6, 0.27, 0.03, 0xf2f2ef);
  b.pop();
  ambulance(b, 11.2, -2.5, 0);
  // pylon sign with red cross near the street
  b.paint(0xf2f2ef, Surf.Plain).boxC(-12.5, 14.4, 1.8, 0.5, 0, 4.2);
  redCross(b, -12.5, 3.3, 14.66, 1.4, 'pz', null);
  redCross(b, -12.5, 3.3, 14.14, 1.4, 'nz', null);
  // landscaping
  treeRow(b, rng, -13, -13, 6, -13, 4, 0.9);
  hedgeBox(b, -15.2, 1.6, -8.8, 2.4, 0.8);
  flowerBed(b, 0.5, 1.8, 5, 3.9, 0xd8577a);
}

function hospital(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 24;
  grass(b, -s, -s, s, s);
  parking(b, rng, -23.5, 6.5, -5.5, 23.5, 0.6);
  asphalt(b, 11, -3.5, 23.5, 23.5);
  pave(b, -5.5, 3, 11, 23.5, 0xd2cdc2);
  grass(b, -3.5, 12, 9, 22.5, lawnDark, 0.14);
  const fl = 3.8;
  // left wing (4 floors), right wing (3 floors) - ribbon windows, white
  block(b, -22, -18, -9, 2, 0, fl * 4, CIV.hospitalWhite, Surf.WallWindows, 2, fl);
  parapet(b, -22, -18, -9, 2, fl * 4, 0xe6e6e2, 0.7);
  block(b, 9, -18, 22, -5, 0, fl * 3, CIV.hospitalWhite, Surf.WallWindows, 2, fl);
  parapet(b, 9, -18, 22, -5, fl * 3, 0xe6e6e2, 0.7);
  acUnits(b, rng, -21, -17, -10, 1, fl * 4, 3);
  acUnits(b, rng, 10, -17, 21, -6, fl * 3, 2);
  // tower (8 floors) with a blue-grey vertical core
  const tx0 = -9, tx1 = 9, tz0 = -18, tz1 = -3, TH = fl * 8;
  block(b, tx0, tz0, tx1, tz1, 0, TH, 0xf4f3ef, Surf.WallWindows, 2, fl);
  b.paint(0x7fa6bf, Surf.GlassCurtain, 5, fl).box(-2.2, fl, tz1, 2.2, TH + 1.5, tz1 + 0.6, { top: pnt(0xe6e6e2) });
  band(b, tx0, tz0, tx1, tz1, TH, 1.0, 0xe9e9e5, Surf.Plain, 0.15);
  // helipad on tower roof
  helipad(b, 0, -10.5, TH + 1.0, 6.3, 0xf2c230, true);
  b.paint(0xe9e9e5, Surf.Plain).boxC(7.6, -10.5, 2.6, 8, TH + 1.0, 2.2);
  // big red crosses on tower top (front + side)
  redCross(b, -5.5, TH - 1.8, tz1 + 0.12, 3.2, 'pz', 0xffffff);
  redCross(b, tx1 + 0.12, TH - 1.8, -10.5, 3.2, 'px', 0xffffff);
  // lobby podium with glazed front + canopy
  block(b, -9, -3, 9, 3, 0, 5.2, 0xf4f3ef, Surf.Plain);
  b.paint(0x6c9cb0, Surf.GlassCurtain, 5, 2.6).box(-7.5, 0.1, 3, 7.5, 4.5, 3.05, { top: null });
  canopy(b, -8, 3, 8, 8.5, 4.2, 0xf7f7f5, [[-7.5, 8.1], [7.5, 8.1]], 0.35);
  wallSign(b, 0, 4.37, 8.52, 7, 0.4, SW, 'pz', 0x2c7a9a, undefined, CIV.healthTeal);
  // emergency entrance on right wing
  canopy(b, 11, -5, 22, 1.5, 4.4, 0xf2f2ef, [[11.4, 1.1], [21.6, 1.1]], 0.45);
  b.paint(CIV.emergency, Surf.Emissive).box(11.5, 4.45, 1.51, 21.5, 4.8, 1.6, { top: null });
  b.push().translate(16.5, 4.625, 1.6);
  glyphBars(b, 8, 0.35, 0.03, 0xf2f2ef);
  b.pop();
  ambulance(b, 14.2, -1.2, 0);
  ambulance(b, 18.6, -0.6, 0.05);
  ambulance(b, 17, 12, Math.PI + 0.1);
  // pylon sign + trees
  b.paint(0xf2f2ef, Surf.Plain).boxC(10, 21.5, 2, 0.6, 0, 5.0);
  redCross(b, 10, 4.0, 21.82, 1.6, 'pz', null);
  treeRow(b, rng, -2.5, 20.5, 8, 20.5, 3, 0.9);
  treeRow(b, rng, -2.5, 14, 8, 14, 3, 0.8);
  treeRow(b, rng, -22, -21.5, 21, -21.5, 6, 0.9);
}

function medicalCenter(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 32;
  grass(b, -s, -s, s, s);
  const fl = 3.8;
  // podium
  block(b, -29, -29, 29, -4, 0, fl * 2, 0xf1f0ec, Surf.WallWindows, 2, fl);
  band(b, -29, -29, 29, -4, fl * 2 - 0.3, 0.8, 0x2c8a9a, Surf.Plain, 0.14);
  // tower A (12 floors) glass w/ white fins
  const ax0 = -25, ax1 = -7, az0 = -26, az1 = -10, AH = fl * 12;
  b.paint(0x6f97b3, Surf.GlassCurtain, 5, fl).box(ax0, fl * 2, az0, ax1, AH, az1, { top: pnt(0x8a8680, Surf.RoofFlat) });
  for (let i = 0; i <= 6; i++) {
    const x = ax0 + (i * (ax1 - ax0)) / 6;
    b.paint(0xf4f4f1, Surf.Plain).box(x - 0.25, fl * 2, az1, x + 0.25, AH + 0.8, az1 + 0.7, { bottom: null });
  }
  band(b, ax0, az0, ax1, az1, AH, 0.8, 0xf4f4f1, Surf.Plain, 0.1);
  helipad(b, (ax0 + ax1) / 2, (az0 + az1) / 2, AH + 0.8, 7.2, 0xf2c230, true);
  redCross(b, ax1 + 0.12, AH - 2.8, -18, 3.4, 'px', 0xffffff);
  redCross(b, -16, AH - 3, az1 + 0.8, 4.0, 'pz', 0xffffff);
  // tower B (9 floors) white ribbon
  const bx0 = 5, bx1 = 25, bz0 = -26, bz1 = -13, BH = fl * 9;
  block(b, bx0, bz0, bx1, bz1, 0, BH, 0xf5f4f0, Surf.WallWindows, 2, fl);
  band(b, bx0, bz0, bx1, bz1, BH, 1.4, 0x2c8a9a, Surf.Plain, 0.12);
  redCross(b, 15, BH - 1.9, bz1 + 0.12, 3.4, 'pz', 0xffffff);
  acUnits(b, rng, bx0 + 1, bz0 + 1, bx1 - 1, bz1 - 1, BH + 1.4, 4);
  // skybridge
  b.paint(0x7fa6bf, Surf.GlassCurtain, 5, 3.5).box(ax1, 22, -21, bx0, 25.5, -17, { top: pnt(0xf4f4f1) });
  // entrance pavilion (glass, curved-ish front) + canopy
  b.paint(0x6c9cb0, Surf.GlassCurtain, 5, 3.8).box(-8, 0.1, -4, 4, 7.2, 0, { top: pnt(0xf4f4f1) });
  canopy(b, -10, -1, 6, 5, 4.4, 0xf7f7f5, [[-9.6, 4.6], [5.6, 4.6]], 0.4);
  wallSign(b, -2, 4.6, 5.02, 8, 0.45, SW, 'pz', 0x2c7a9a, undefined, CIV.healthTeal);
  // emergency canopy right side
  canopy(b, 17, -4, 29, 3, 4.4, 0xf2f2ef, [[17.4, 2.6], [28.6, 2.6]], 0.45);
  b.paint(CIV.emergency, Surf.Emissive).box(17.5, 4.45, 3.01, 28.5, 4.8, 3.1, { top: null });
  b.push().translate(23, 4.625, 3.1);
  glyphBars(b, 9, 0.35, 0.03, 0xf2f2ef);
  b.pop();
  ambulance(b, 20, 0, 0);
  ambulance(b, 24.5, 0.5, 0.04);
  asphalt(b, 16.5, -4, 31, 31);
  ambulance(b, 23.5, 16, Math.PI);
  // healing garden in front: paths, pond, trees
  pave(b, -31, 5, 16.5, 7.5, 0xd2cdc2);
  pave(b, -4.5, 7.5, -0.5, 31, 0xd2cdc2);
  b.paint(0x4a8fb8, Surf.Water);
  disc(b, -16, 18, 5.5, 14, 0.12);
  b.paint(0xd2cdc2, Surf.Plain);
  annulus(b, -16, 18, 5.5, 6.3, 14, 0.13);
  for (let i = 0; i < 7; i++) tree(b, rng, -28 + (i % 4) * 4.5, 10 + Math.floor(i / 4) * 16 + rng.range(-1, 1), 0.95);
  tree(b, rng, -9, 26, 1);
  tree(b, rng, -8, 12, 1);
  parking(b, rng, 0.5, 9, 16, 30.5, 0.6);
  for (let i = 0; i < 4; i++) benchAt(b, -22 + i * 4, 8.6, 0);
  lamp(b, -1, 28);
  lamp(b, -1, 16);
  // pylon
  b.paint(0xf2f2ef, Surf.Plain).boxC(-8, 29.5, 2.2, 0.6, 0, 5.5);
  redCross(b, -8, 4.4, 29.82, 1.8, 'pz', null);
}


// ================================================================================================= EDUCATION
function elementarySchool(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 24;
  grass(b, -s, -s, s, s);
  const brick = CIV.schoolBrick;
  const fl = 3.8;
  // main 2-storey classroom wing
  const x0 = -21, x1 = 7, z0 = -5, z1 = 5;
  b.paint(brick, Surf.Brick).box(x0, 0, z0, x1, fl * 2, z1, { top: pnt(0x7d7872, Surf.RoofFlat) });
  windowsOnFace(b, 'pz', z1, x0 + 0.5, -10.5, 0, 2, fl, 4, 1.9, 1.7, CIV.trim, 0x2a3440, 1.0);
  windowsOnFace(b, 'pz', z1, -3.5, x1 - 0.5, 0, 2, fl, 3, 1.9, 1.7, CIV.trim, 0x2a3440, 1.0);
  windowsOnFace(b, 'nz', -z0, -x1 + 0.5, -x0 - 0.5, 0, 2, fl, 8, 1.9, 1.7, CIV.trim, 0x2a3440, 1.0);
  windowsOnFace(b, 'nx', -x0, z0 + 1, z1 - 1, 0, 2, fl, 2, 1.6, 1.7, CIV.trim, 0x2a3440, 1.0);
  band(b, x0, z0, x1, z1, fl * 2 - 0.1, 0.55, CIV.limestone, Surf.Plain, 0.12);
  // entrance pavilion with gable, clock, sign, colored door frame
  const ex = -7;
  b.paint(brick, Surf.Brick).box(ex - 3.5, 0, z1 - 1, ex + 3.5, 8.6, z1 + 1.6);
  b.paint(0x5c5f63, Surf.RoofTiles).gableRoof(ex, z1 + 0.3, 7, 2.6, 8.6, 1.9, 'z', 0.3, pnt(brick, Surf.Brick));
  clockFace(b, ex, 7.6, z1 + 1.62, 0.6, 'pz');
  wallSign(b, ex, 4.4, z1 + 1.62, 5.2, 0.6, SW, 'pz', CIV.schoolGreen, undefined, CIV.schoolGreen);
  b.paint(CIV.schoolYellow, Surf.Plain);
  vrect(b, ex - 1.7, 0, ex + 1.7, 3.4, z1 + 1.63);
  doorOnFace(b, 'pz', z1 + 1.64, ex, 2.6, 2.8, 0x2a2e33);
  canopy(b, ex - 2.4, z1 + 1.6, ex + 2.4, z1 + 3.6, 3.5, CIV.schoolYellow, [[ex - 2.1, z1 + 3.3], [ex + 2.1, z1 + 3.3]], 0.25);
  // gym with barrel roof
  b.paint(0xd9c9a8, Surf.Plain).box(x1, 0, -5, 19, 6.2, 5, { top: null });
  b.paint(brick, Surf.Brick).box(x1, 0, -5.05, 19.05, 1.2, 5.05, { top: null });
  vault(b, 13, 0, 12.4, 10.4, 6.2, 2.2, 8, pnt(0x3f7f6f, Surf.Metal), pnt(0xd9c9a8, Surf.Plain), 'z');
  windowsOnFace(b, 'pz', 5, 8.5, 17.5, 3.4, 1, 3, 4, 1.6, 1.4, CIV.trim, 0x2a3440, 0.8);
  // roof clutter
  acUnits(b, rng, x0 + 1, z0 + 1, x1 - 1, z1 - 1, fl * 2, 3);
  // back: playground + court
  playground(b, -14, -15, 13, 11);
  basketballCourt(b, 8, -15, true, 0x3f7fa8, 0xd9853a);
  meshFence(b, -7.3, -23.6, 23.4, -23.6, 3.0, 0x8f969c);
  meshFence(b, 23.4, -23.6, 23.4, -6.4, 3.0, 0x8f969c);
  // front: bus loop, staff parking, lawn, flag, trees
  asphalt(b, -23.5, 14, 11.5, 20);
  b.paint(0xf2d21b, Surf.Plain);
  flat(b, -23, 16.9, 11, 17.1, 0.11);
  bus(b, -14.5, 18.4, Math.PI / 2, CIV.busYellow, true);
  bus(b, -1.5, 18.4, Math.PI / 2 + 0.01, CIV.busYellow, true);
  parking(b, rng, 12, 6, 23.5, 23.5, 0.5);
  pave(b, -9, 5, -5, 14, 0xd2cdc2);
  flag(b, -13, 10.5, 9, FLAGS.nation, 0, 1.4);
  pylonSign(b, 5, 12, 5, 1.6, SW, brick, 1.1, CIV.schoolGreen);
  tree(b, rng, -20, 9.5, 1);
  tree(b, rng, -16, 11.5, 0.9);
  tree(b, rng, 1, 9, 1);
  hedgeBox(b, -21, 5.4, -10, 6.2, 0.8);
  hedgeBox(b, -4, 5.4, 6, 6.2, 0.8);
}

function highSchool(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 32;
  grass(b, -s, -s, s, s);
  // athletics: running track + football field + bleachers
  runningTrack(b, 0, -16.5, 26, 10.3, 3.9);
  bleachers(b, 0, 0.8, 24, 5, -1, 0x9aa0a6, 0x7a1f2b);
  b.paint(0x5a5f64, Surf.Metal);
  for (const x of [-28.5, 28.5]) {
    b.cylinder(x, -16.5, 0, 14, 0.2, 0.15, 5, { top: false });
    b.paint(0xfff5d0, Surf.Emissive).boxC(x, -16.5, 0.6, 2.4, 14, 1.2);
    b.paint(0x5a5f64, Surf.Metal);
  }
  const fl = 3.8;
  const brick = 0xa55a3c;
  // main building (3 storeys)
  const x0 = -30, x1 = 6, z0 = 5, z1 = 16;
  b.paint(brick, Surf.Brick).box(x0, 0, z0, x1, fl * 3, z1, { top: pnt(0x7d7872, Surf.RoofFlat) });
  windowsOnFace(b, 'pz', z1, x0 + 0.6, -16, 0, 3, fl, 6, 1.6, 1.8, CIV.trim, 0x2a3440, 1.0);
  windowsOnFace(b, 'pz', z1, -8, x1 - 0.6, 0, 3, fl, 5, 1.6, 1.8, CIV.trim, 0x2a3440, 1.0);
  windowsOnFace(b, 'nz', -z0, -x1 + 0.6, -x0 - 0.6, 0, 3, fl, 12, 1.6, 1.8, CIV.trim, 0x2a3440, 1.0);
  windowsOnFace(b, 'nx', -x0, z0 + 1, z1 - 1, 0, 3, fl, 3, 1.6, 1.8, CIV.trim, 0x2a3440, 1.0);
  band(b, x0, z0, x1, z1, fl * 3 - 0.1, 0.6, CIV.limestone, Surf.Plain, 0.14);
  // entrance block (taller, stone) with columns + sign
  const ex = -12;
  b.paint(CIV.limestoneWarm, Surf.Stone).box(ex - 4, 0, z1 - 1, ex + 4, 13.2, z1 + 1.2, { top: pnt(0x7d7872, Surf.RoofFlat) });
  // three tall framed windows between limestone piers
  windowsOnFace(b, 'pz', z1 + 1.2, ex - 3.3, ex + 3.3, 5.8, 1, 6, 3, 1.3, 5.5, CIV.limestone, 0x2a3440, 0.3, true);
  colonnade(b, ex - 3.2, ex + 3.2, z1 + 3.2, 0, 4.2, 4, 0.45, CIV.marble, 6);
  canopy(b, ex - 3.8, z1 + 1.2, ex + 3.8, z1 + 3.8, 4.2, CIV.limestone);
  b.paint(0x5c5f63, Surf.RoofTiles).gableRoof(ex, z1 + 2.5, 7.6, 2.6, 4.55, 1.3, 'z', 0.15, pnt(CIV.limestone, Surf.Stone));
  wallSign(b, ex, 12.3, z1 + 1.22, 6.4, 0.8, SW, 'pz', CIV.maroon, undefined, CIV.maroon);
  doorOnFace(b, 'pz', z1 + 1.22, ex, 3.2, 3.0);
  acUnits(b, rng, x0 + 1, z0 + 1, x1 - 1, z1 - 1, fl * 3, 4);
  // gym + auditorium with barrel roof
  b.paint(0xd4c4a3, Surf.Plain).box(8, 0, 3, 30, 8, 17, { top: null });
  b.paint(brick, Surf.Brick).box(7.95, 0, 2.95, 30.05, 1.5, 17.05, { top: null });
  vault(b, 19, 10, 22, 14, 8, 3.2, 10, pnt(0x7a1f2b, Surf.Metal), pnt(0xd4c4a3, Surf.Plain), 'x');
  windowsOnFace(b, 'pz', 17, 9.5, 28.5, 4.2, 1, 3, 6, 2.0, 2.4, CIV.trim, 0x2a3440, 0.8);
  // front: parking (right), buses + lawn + flag (left)
  parking(b, rng, 4, 18, 31.5, 31.5, 0.6);
  asphalt(b, -31.5, 23, 4, 29);
  bus(b, -22, 26, Math.PI / 2, CIV.busYellow, true);
  bus(b, -9.5, 26, Math.PI / 2, CIV.busYellow, true);
  pave(b, -14.5, 17.2, -9.5, 23, 0xd2cdc2);
  flag(b, -5, 20.5, 10, FLAGS.nation, 0, 1.4);
  flag(b, -1.5, 20.5, 9, FLAGS.college, 0, 1.2);
  // scoreboard at the far end of the field
  b.paint(0x3a3d40, Surf.Metal).boxC(16.5, -31.2, 0.3, 0.3, 0, 4.2).boxC(21.5, -31.2, 0.3, 0.3, 0, 4.2);
  b.paint(0x1c1e22, Surf.Plain).boxC(19, -31.2, 7, 0.4, 4.2, 3.2);
  b.paint(CIV.maroon, Surf.Plain).boxC(19, -31.2, 7.2, 0.5, 7.4, 0.6);
  b.paint(0xffb030, Surf.Emissive);
  vrect(b, 16.2, 5.0, 18.0, 6.3, -30.98);
  vrect(b, 20.0, 5.0, 21.8, 6.3, -30.98);
  treeRow(b, rng, -29, 20, -19, 20, 3, 1);
  tree(b, rng, 1.5, 19.6, 0.9);
}

function college(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 40;
  grass(b, -s, -s, s, s, 0x6a9844);
  // quad lawn + paths
  grass(b, -19, -12, 19, 26, 0x76a64c, 0.085);
  b.paint(0xd6ceba, Surf.Pavement);
  b.slab(-1.6, -12, 1.6, 39.5, 0.1);
  b.slab(-37, 5.4, 37, 8.6, 0.1);
  b.paint(0xd6ceba, Surf.Plain);
  stripe(b, -17, -10, -1.5, 5, 2.2, 0.115);
  stripe(b, 17, -10, 1.5, 5, 2.2, 0.115);
  stripe(b, -17, 24, -1.5, 9, 2.2, 0.115);
  stripe(b, 17, 24, 1.5, 9, 2.2, 0.115);
  annulus(b, 0, 7, 3.4, 5.4, 14, 0.145);
  // statue on the quad
  b.paint(CIV.granite, Surf.Stone).boxC(0, 7, 2.2, 2.2, 0, 1.8);
  b.paint(0x5d6a52, Surf.Metal).cylinder(0, 7, 1.8, 1.6, 0.42, 0.34, 6).blob(0, 3.75, 7, 0.28, 0.32, 0.28, 0, 0.05, 2);
  // library (north) with portico + dome
  const lz0 = -37, lz1 = -17;
  b.paint(CIV.granite, Surf.Stone).box(-15.5, 0, lz0 - 0.5, 15.5, 1.5, lz1 + 0.5);
  b.paint(CIV.limestone, Surf.Stone).box(-15, 1.5, lz0, 15, 12, lz1, { top: pnt(0x8a8680, Surf.RoofFlat) });
  windowsOnFace(b, 'pz', lz1, -14, -8, 1.5, 2, 5, 2, 1.4, 3.2, CIV.trim, 0x2a3440, 1.0);
  windowsOnFace(b, 'pz', lz1, 8, 14, 1.5, 2, 5, 2, 1.4, 3.2, CIV.trim, 0x2a3440, 1.0);
  windowsOnFace(b, 'px', 15, -lz1 + 1, -lz0 - 1, 1.5, 2, 5, 5, 1.4, 3.2, CIV.trim, 0x2a3440, 1.0);
  windowsOnFace(b, 'nx', 15, lz0 + 1, lz1 - 1, 1.5, 2, 5, 5, 1.4, 3.2, CIV.trim, 0x2a3440, 1.0);
  band(b, -15, lz0, 15, lz1, 11.3, 0.7, CIV.trim, Surf.Plain, 0.2);
  portico(b, 0, lz1 + 4.5, 15, 4.5, 1.5, 8.5, 6, { r: 0.5 });
  steps(b, 0, lz1 + 7.8, 13, 5, 0.3, 0.66);
  domeOnDrum(b, 0, -28, 12, 6.5, { drumH: 3.8, seg: 16, dome: CIV.copper, scaleY: 1.05 });
  // academic halls (brick, hip roofs) west & east
  const hallBrick = 0xa4563d;
  const hall = (x0: number, x1: number, z0: number, z1: number, fl: number, n: number, roof: ColorLike) => {
    b.paint(hallBrick, Surf.WallWindows, 1, fl).box(x0, 0, z0, x1, fl * n, z1, { top: null });
    band(b, x0, z0, x1, z1, 0, 0.9, CIV.limestoneWarm, Surf.Stone, 0.06);
    band(b, x0, z0, x1, z1, fl * n - 0.4, 0.5, CIV.trim, Surf.Plain, 0.14);
    hipOn(b, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, fl * n + 0.1, 4.2, roof, 0.5);
  };
  hall(-37, -23, -33, 2, 4.0, 3, 0x4a525c);
  hall(-37, -23, 11, 24, 4.0, 2, 0x4a525c);
  hall(23, 37, -33, -8, 4.0, 3, 0x4a525c);
  // modern science building (glass + white)
  b.paint(0x5d8fa8, Surf.GlassCurtain, 1, 4.0).box(24, 0, -2, 37, 12, 22, { top: null });
  b.paint(0xf1efe8, Surf.Plain).box(23.4, 12, -2.6, 37.6, 13.0, 22.6, { top: null });
  b.paint(0x5f8f45, Surf.Foliage);
  flat(b, 24, -2, 37, 22, 12.6);
  for (const f of [4, 8]) b.paint(0xf1efe8, Surf.Plain).box(23.7, f - 0.2, -2.3, 37.3, f + 0.25, 22.3, { top: null, bottom: null });
  for (const z of [3.5, 10, 16.5]) b.paint(0xf1efe8, Surf.Plain).box(23.4, 0, z - 0.4, 24.1, 12, z + 0.4, { top: null });
  b.paint(0xe6e2d8, Surf.Plain).box(29, 13, 4, 34, 15.5, 9, { bottom: null });
  // porticoed entries on the halls facing the quad
  colonnadeZ(b, -22, -12, -4, 0, 6.5, 4, 0.35, CIV.marble, 6);
  b.paint(CIV.trim, Surf.Plain).box(-23, 6.5, -13, -21.4, 7.3, -3);
  // bell tower (campanile) at front-left of quad with clocks
  const tx = -29, tz = 31;
  b.paint(0x9c5139, Surf.Brick).boxC(tx, tz, 5, 5, 0, 24);
  b.paint(CIV.limestone, Surf.Plain).boxC(tx, tz, 5.6, 5.6, 0, 1.2).boxC(tx, tz, 5.6, 5.6, 23.6, 0.6);
  clockFace(b, tx, 21, tz + 2.5, 1.35, 'pz');
  clockFace(b, tx + 2.5, 21, tz, 1.35, 'px');
  clockFace(b, tx - 2.5, 21, tz, 1.35, 'nx');
  // belfry: corner piers + open arches
  b.paint(CIV.limestone, Surf.Stone);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.boxC(tx + dx * 2.1, tz + dz * 2.1, 0.8, 0.8, 24.2, 4.2);
  b.paint(0x2a2a2a, Surf.Plain).boxC(tx, tz, 3.4, 3.4, 24.2, 4.2, { top: null });
  b.paint(CIV.gold, Surf.Metal).cylinder(tx, tz, 25, 1.4, 0.9, 0.6, 8);
  b.paint(CIV.limestone, Surf.Plain).boxC(tx, tz, 5.4, 5.4, 28.4, 0.6);
  b.paint(CIV.copper, Surf.RoofTiles).pyramid(tx, tz, 5.2, 5.2, 29, 6.5);
  b.paint(CIV.gold, Surf.Metal).cylinder(tx, tz, 35.4, 1.2, 0.08, 0.03, 4, { top: false });
  // gate + fence along the front
  gatePier(b, -4, 38.3, 2.8);
  gatePier(b, 4, 38.3, 2.8);
  ironFence(b, -39.5, 38.3, -4.5, 38.3, 1.6);
  ironFence(b, 4.5, 38.3, 39.5, 38.3, 1.6);
  // trees
  for (const [x, z] of [[-17, -10], [17, -10], [-17, 16], [17, 16], [-11, 24], [11, 24], [-17, 1], [17, 1], [12, 32], [20, 30], [30, 30], [-14, 33]] as [number, number][]) tree(b, rng, x, z, 1.05);
  for (let i = 0; i < 4; i++) benchAt(b, -12 + i * 8, 4.6, 0);
  lamp(b, -3, 20);
  lamp(b, 3, 20);
  lamp(b, -3, 32);
  lamp(b, 3, 32);
}

// ================================================================================================= CULTURE / GOVERNMENT
function library(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 16;
  grass(b, -s, -s, s, s);
  pave(b, -9, 8.8, 9, 16, 0xd6d0c4);
  // podium + main block (stone), tall windows
  b.paint(CIV.granite, Surf.Stone).box(-13, 0, -13, 13, 1.2, 2.5);
  b.paint(CIV.limestone, Surf.Stone).box(-12.2, 1.2, -12.2, 12.2, 10.0, 1.8, { top: pnt(0x8a8680, Surf.RoofFlat) });
  windowsOnFace(b, 'pz', 1.8, -12, -7.4, 1.2, 1, 4.5, 2, 1.3, 4.6, CIV.trim, 0x2a3440, 1.3);
  windowsOnFace(b, 'pz', 1.8, 7.4, 12, 1.2, 1, 4.5, 2, 1.3, 4.6, CIV.trim, 0x2a3440, 1.3);
  windowsOnFace(b, 'px', 12.2, -1.8 + 0.5, 12.2 - 0.5, 1.2, 1, 4.5, 5, 1.3, 4.6, CIV.trim, 0x2a3440, 1.3);
  windowsOnFace(b, 'nx', 12.2, -12.2 + 0.5, 1.8 - 0.5, 1.2, 1, 4.5, 5, 1.3, 4.6, CIV.trim, 0x2a3440, 1.3);
  band(b, -12.2, -12.2, 12.2, 1.8, 9.2, 0.8, CIV.trim, Surf.Plain, 0.2);
  // banners
  b.paint(0x9a2b2b, Surf.Plain);
  vrect(b, -9.9, 3.2, -8.9, 7.8, 1.84);
  vrect(b, 8.9, 3.2, 9.9, 7.8, 1.84);
  // portico (+ frieze inscription, night up-lights on the podium)
  b.paint(CIV.granite, Surf.Stone).box(-7.8, 0, 1.8, 7.8, 1.2, 6.2);
  portico(b, 0, 6.0, 14, 4.2, 1.2, 7.4, 6, { r: 0.42 });
  inscription(b, 0, 1.2 + 7.4 + 0.55, 5.8, 7.5, 0.7, CIV.bronzeDark);
  steps(b, 0, 8.8, 12.4, 4, 0.3, 0.65);
  doorOnFace(b, 'pz', 1.86, 0, 2.4, 4.0, 0x3a2c20, 0x2a2018, 1.2);
  // roof lantern: dark glass with metal ribs + copper hip
  b.paint(0x3a4450, Surf.GlassCurtain, 3, 1.4).box(-3, 10.0, -8, 3, 11.4, -2, { top: null });
  b.paint(0x3a3d40, Surf.Metal);
  for (const x of [-3, -1, 1, 3]) b.box(x - 0.08, 10.0, -2.08, x + 0.08, 11.4, -1.96, { bottom: null });
  hipOn(b, 0, -5, 6.4, 6.4, 11.4, 1.6, CIV.copper, 0.15);
  // lions on plinths flanking the steps
  for (const sx of [-1, 1]) {
    const lx = sx * 7.0, lz = 8.0;
    b.paint(CIV.granite, Surf.Stone).boxC(lx, lz, 1.4, 2.6, 0, 1.3);
    b.paint(CIV.limestoneWarm, Surf.Plain);
    b.blob(lx, 1.85, lz - 0.2, 0.5, 0.45, 1.0, 0, 0.06, sx + 3);
    b.blob(lx, 2.35, lz + 0.75, 0.42, 0.45, 0.4, 0, 0.1, sx + 5);
  }
  // grounds
  tree(b, rng, -12.5, 7.5, 0.95);
  tree(b, rng, 12.5, 7.5, 0.95);
  tree(b, rng, -12.5, 13.5, 0.85);
  tree(b, rng, 12.5, 13.5, 0.85);
  benchAt(b, -5, 12.8, Math.PI);
  benchAt(b, 5, 12.8, Math.PI);
  lamp(b, -8.4, 9.5, 4);
  lamp(b, 8.4, 9.5, 4);
  hedgeBox(b, -15, -15, 15, -14.2, 1.1);
  b.paint(0x2e5f9f, Surf.Metal).boxC(3.2, 14.6, 0.8, 0.7, 0, 1.2);
}

function museum(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 24;
  grass(b, -s, -s, s, s);
  pave(b, -22.5, 10.5, 22.5, 23.5, 0xd8d2c6);
  pave(b, -23, -1, -13, 10.5, 0xd8d2c6);
  // podium + central block
  b.paint(CIV.granite, Surf.Stone).box(-14, 0, -18, 14, 1.5, 6.5);
  b.paint(CIV.limestone, Surf.Stone).box(-13, 1.5, -17, 13, 12.3, 1.8, { top: pnt(0x8a8680, Surf.RoofFlat) });
  band(b, -13, -17, 13, 1.8, 11.5, 0.8, CIV.trim, Surf.Plain, 0.22);
  // portico (8 columns) + steps
  portico(b, 0, 6.5, 22, 4.7, 1.5, 8.3, 8, { r: 0.5, pedH: 3.0 });
  inscription(b, 0, 1.5 + 8.3 + 0.55, 6.3, 10, 0.7, CIV.bronzeDark);
  steps(b, 0, 10.5, 20, 5, 0.3, 0.8);
  doorOnFace(b, 'pz', 1.86, 0, 3.0, 5.0, 0x3a2c20, 0x2a2018, 1.5);
  // banners between columns
  const banC = [0xc0392b, 0x2e6fb5, 0xd9a324];
  for (let i = 0; i < 3; i++) {
    b.paint(banC[i], Surf.Plain);
    vrect(b, -6.5 + i * 6.5 - 0.6, 4.0, -6.5 + i * 6.5 + 0.6, 8.8, 1.9);
  }
  // dome on drum
  domeOnDrum(b, 0, -8.5, 12.3, 4.9, { drumH: 1.6, seg: 16, dome: 0x8d959c, domeSurf: Surf.RoofTiles, scaleY: 0.85, lanternScale: 0.75 });
  // classical west wing
  b.paint(CIV.limestone, Surf.Stone).box(-22.5, 0, -15, -13, 9.5, -1, { top: pnt(0x8a8680, Surf.RoofFlat) });
  band(b, -22.5, -15, -13, -1, 8.9, 0.6, CIV.trim, Surf.Plain, 0.18);
  windowsOnFace(b, 'pz', -1, -22, -13.5, 0, 1, 4, 3, 1.3, 4.2, CIV.trim, 0x2a3440, 2.4);
  // modern east wing: faceted glass "crystal" with a thin white roof plate and fins
  const cw: [number, number][] = [[13, -19], [22.5, -19], [22.5, -4], [18.5, 0.5], [13, -1]];
  b.paint(0x7fb3cf, Surf.GlassCurtain, 5, 3.6).extrude(cw, 0, 10.5, { top: false });
  b.paint(0xf2f0eb, Surf.Plain).extrude(cw.map(([x, z]) => [x + (x > 17 ? 0.4 : -0.4), z + (z > -10 ? 0.5 : -0.4)] as [number, number]), 10.5, 0.7, { topPaint: pnt(0xdcd8d0, Surf.RoofFlat) });
  b.paint(0xf2f0eb, Surf.Plain);
  for (const [x, z] of cw) b.boxC(x, z, 0.6, 0.6, 0, 10.5, { top: null });
  // sculpture plaza: reflecting pool, red arch, stacked cubes, bronze sphere
  b.paint(0xcfc9bc, Surf.Stone).boxC(0, 17.5, 13, 5, 0, 0.35);
  b.paint(0x3f7ea6, Surf.Water).boxC(0, 17.5, 12, 4, 0.1, 0.3, { bottom: null });
  b.paint(0xc63a2a, Surf.Metal);
  const ax = -15, az = 17;
  let prev: [number, number, number] | null = null;
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    const p: [number, number, number] = [ax + Math.cos(a) * 3.2, Math.sin(a) * 5.5, az];
    if (prev) b.beam(prev, p, 0.55);
    prev = p;
  }
  b.push().translate(15, 0, 17).rotateY(0.5);
  b.paint(0xb8bec4, Surf.Metal).boxC(0, 0, 2.2, 2.2, 0, 2.2);
  b.rotateY(0.6);
  b.paint(0x2f4f8f, Surf.Plain).boxC(0, 0, 1.7, 1.7, 2.2, 1.7);
  b.rotateY(0.5);
  b.paint(CIV.gold, Surf.Metal).boxC(0, 0, 1.2, 1.2, 3.9, 1.2);
  b.pop();
  b.paint(CIV.granite, Surf.Stone).boxC(-18, 5, 1.6, 1.6, 0, 1.4);
  b.paint(0x7a5d34, Surf.Metal).sphere(-18, 2.4, 5, 1.0, 10, 8);
  // trees + lamps
  tree(b, rng, -21, 21, 1);
  tree(b, rng, 21, 21, 1);
  tree(b, rng, -21, -20, 1);
  tree(b, rng, 21, -21.5, 1);
  tree(b, rng, 0, -21.5, 1);
  for (const x of [-10, 10]) lamp(b, x, 12, 4.2);
  benchAt(b, -6, 21, Math.PI);
  benchAt(b, 6, 21, Math.PI);
}

function cityHall(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 32;
  grass(b, -s, -s, s, s);
  const plaza = 0xd3cdc0;
  pave(b, -14, 6, 14, 31.5, plaza);
  pave(b, -31.5, 6, 31.5, 10, plaza);
  pave(b, -31.5, -3, -26, 6, plaza);
  pave(b, 26, -3, 31.5, 6, plaza);
  b.paint(0xc2bba9, Surf.Plain);
  for (let i = 0; i < 6; i++) flat(b, -14, 12 + i * 3.6, 14, 12.15 + i * 3.6, 0.13);
  // main block (3 floors, arched windows) + granite plinth
  const fl = 4.8;
  const lime = CIV.limestone;
  b.paint(lime, Surf.WallWindows, 7, fl).box(-26, 0, -22, 26, 14.6, -3, { top: pnt(0x8a8680, Surf.RoofFlat) });
  band(b, -26, -22, 26, -3, 0, 1.1, CIV.granite, Surf.Stone, 0.1);
  band(b, -26, -22, 26, -3, 14.0, 0.8, CIV.trim, Surf.Plain, 0.25);
  parapet(b, -26.1, -22.1, 26.1, -2.9, 14.8, lime, 0.9, 0.35);
  // end pavilions with hip roofs
  for (const sx of [-1, 1]) {
    const px0 = sx < 0 ? -27.5 : 19, px1 = sx < 0 ? -19 : 27.5;
    b.paint(lime, Surf.WallWindows, 7, fl).box(px0, 0, -23, px1, 16.4, -1.4, { top: pnt(0x8a8680, Surf.RoofFlat) });
    band(b, px0, -23, px1, -1.4, 0, 1.1, CIV.granite, Surf.Stone, 0.1);
    band(b, px0, -23, px1, -1.4, 15.8, 0.7, CIV.trim, Surf.Plain, 0.25);
    hipOn(b, (px0 + px1) / 2, -12.2, px1 - px0, 21.6, 16.5, 3.4, CIV.lead, 0.3);
  }
  // central pavilion + portico + podium + grand stairs
  b.paint(lime, Surf.Stone).box(-11, 0, -22.35, 11, 17.2, -1.0, { top: pnt(0x8a8680, Surf.RoofFlat) });
  band(b, -11, -22.35, 11, -1.0, 16.5, 0.8, CIV.trim, Surf.Plain, 0.25);
  b.paint(CIV.granite, Surf.Stone).box(-11.4, 0, -1.0, 11.4, 2.4, 4.0);
  portico(b, 0, 4.0, 20, 5.0, 2.4, 11, 8, { r: 0.6, pedH: 3.3 });
  steps(b, 0, 9.4, 18, 8, 0.3, 0.68);
  doorOnFace(b, 'pz', -0.94, 0, 3.2, 5.4, 0x3a2c20, 0x2a2018, 2.4);
  windowsOnFace(b, 'pz', -0.94, -9, 9, 2.4, 2, 5.2, 4, 1.4, 3.2, CIV.trim, 0x2a3440, 0.9);
  // attic with clocks, drum, dome
  b.paint(lime, Surf.Stone).box(-8, 17.2, -19, 8, 21.4, -3, { top: pnt(0x8a8680, Surf.RoofFlat) });
  band(b, -8, -19, 8, -3, 20.9, 0.5, CIV.trim, Surf.Plain, 0.2);
  clockFace(b, 0, 19.3, -2.98, 1.5, 'pz');
  clockFace(b, 8.02, 19.3, -11, 1.5, 'px');
  clockFace(b, -8.02, 19.3, -11, 1.5, 'nx');
  domeOnDrum(b, 0, -11, 21.4, 7, { drumH: 6.2, seg: 16, colonnade: true, dome: CIV.copper, scaleY: 1.12 });
  // plaza: fountain, flags, lamps, planters
  fountain(b, 0, 21.5, 4.6, 2);
  const flagCols = [FLAGS.nation, FLAGS.city];
  for (let i = 0; i < 4; i++) {
    for (const sx of [-1, 1]) flag(b, sx * 11.5 - (sx > 0 ? 3.2 : 0), 12.5 + i * 5.2, 10, flagCols[(i + (sx > 0 ? 1 : 0)) % 2], 0, 1.4);
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) lamp(b, sx * 13.3, 14.5 + i * 7, 4.5);
    benchAt(b, sx * 6.5, 27, Math.PI);
  }
  // lawns: trees + hedges
  for (const sx of [-1, 1]) {
    hedgeBox(b, sx > 0 ? 14.5 : -31, 10.5, sx > 0 ? 31 : -14.5, 11.3, 1.0);
    for (const [x, z] of [[20, 16], [28, 16], [20, 25.5], [27.5, 28.5]] as [number, number][]) tree(b, rng, sx * x, z, 1.1);
    flowerBed(b, sx > 0 ? 16 : -26, 19.5, sx > 0 ? 26 : -16, 21.5, sx > 0 ? 0xc84a5a : 0xe0b43a);
  }
  // service parking behind
  parking(b, rng, -30, -31.5, 30, -23.5, 0.5);
}

function mayorHouse(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 16;
  grass(b, -s, -s, s, s, 0x6ea447);
  // circular gravel drive + fountain
  b.paint(0xd8cdb4, Surf.Pavement);
  annulus(b, 0, 9.2, 2.4, 5.6, 16, 0.09);
  b.slab(-2.2, 13.8, 2.2, 16, 0.12);
  b.slab(-3, 2.6, 3, 4.2, 0.12);
  fountain(b, 0, 9.2, 2.0, 1);
  // main house: brick w/ stone quoins, 2 floors, hip roof, chimneys
  const x0 = -9.5, x1 = 9.5, z0 = -9, z1 = 0, fl = 3.8;
  const brick = 0x9c4a36;
  b.paint(brick, Surf.Brick).box(x0, 0, z0, x1, fl * 2, z1, { top: null });
  band(b, x0, z0, x1, z1, 0, 0.7, CIV.limestone, Surf.Stone, 0.08);
  band(b, x0, z0, x1, z1, fl * 2 - 0.3, 0.5, CIV.trim, Surf.Plain, 0.2);
  b.paint(CIV.limestone, Surf.Stone);
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) b.boxC(x, z, 0.9, 0.9, 0, fl * 2);
  windowsOnFace(b, 'pz', z1, x0 + 0.6, -3.6, 0, 2, fl, 3, 1.1, 1.9, CIV.trim, 0x2a3440, 0.9);
  windowsOnFace(b, 'pz', z1, 3.6, x1 - 0.6, 0, 2, fl, 3, 1.1, 1.9, CIV.trim, 0x2a3440, 0.9);
  windowsOnFace(b, 'pz', z1 + 0.06, -1.2, 1.2, fl, 1, fl, 1, 1.1, 1.9, CIV.trim, 0x2a3440, 0.9);
  windowsOnFace(b, 'px', x1, -z1 + 0.8, -z0 - 0.8, 0, 2, fl, 3, 1.1, 1.9, CIV.trim, 0x2a3440, 0.9);
  windowsOnFace(b, 'nx', -x0, z0 + 0.8, z1 - 0.8, 0, 2, fl, 3, 1.1, 1.9, CIV.trim, 0x2a3440, 0.9);
  hipOn(b, 0, (z0 + z1) / 2, x1 - x0, z1 - z0, fl * 2 + 0.2, 3.2, 0x464c55, 0.5);
  for (const x of [-6.2, 6.2]) {
    b.paint(brick, Surf.Brick).boxC(x, -4.5, 1.2, 2.4, fl * 2, 4.6);
    b.paint(CIV.limestone, Surf.Plain).boxC(x, -4.5, 1.4, 2.6, fl * 2 + 4.6, 0.25);
  }
  // portico (4 columns) + steps
  b.paint(CIV.limestone, Surf.Stone).box(-4, 0, z1, 4, 0.6, 2.8);
  portico(b, 0, 2.8, 7.4, 2.8, 0.6, 6.4, 4, { r: 0.3, pedH: 1.5, roof: 0x464c55 });
  steps(b, 0, 3.8, 5.4, 2, 0.3, 0.5);
  doorOnFace(b, 'pz', z1 + 0.06, 0, 1.6, 2.8, 0x2a2f36, 0x1e2a36, 0.6);
  // gate, iron fence, hedges
  gatePier(b, -2.8, 14.9, 2.4);
  gatePier(b, 2.8, 14.9, 2.4);
  ironFence(b, -15.6, 14.9, -3.3, 14.9, 1.7);
  ironFence(b, 3.3, 14.9, 15.6, 14.9, 1.7);
  ironFence(b, -15.6, -15.6, -15.6, 14.9, 1.7);
  ironFence(b, 15.6, -15.6, 15.6, 14.9, 1.7);
  ironFence(b, -15.6, -15.6, 15.6, -15.6, 1.7);
  for (const sx of [-1, 1]) {
    hedgeBox(b, sx * 8, 3, sx * 14.5, 3.8, 0.8);
    hedgeBox(b, sx * 8, 11.8, sx * 14.5, 12.6, 0.8);
    hedgeBox(b, sx * 8, 3.8, sx * 8.8, 11.8, 0.8);
    flowerBed(b, sx > 0 ? 9.8 : -13.8, 5.2, sx > 0 ? 13.8 : -9.8, 10.4, 0xb85a6e, 0xe0d8c8);
  }
  flag(b, -6.5, 6.5, 9, FLAGS.city, 0, 1.4);
  miniCar(b, 4.0, 8.4, 0.3, 0x141414, 0.09);
  // back garden
  for (const [x, z] of [[-12, -12], [-3, -13.5], [6, -12.5], [12.5, -8], [-13, -3]] as [number, number][]) tree(b, rng, x, z, 1.05);
  conifer(b, rng, 13, 1, 0.9);
  conifer(b, rng, -13, 1, 0.9);
}

function courthouse(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 24;
  grass(b, -s, -s, s, s);
  pave(b, -12, 10, 12, 24, 0xd6d0c4);
  // podium
  b.paint(CIV.granite, Surf.Stone).box(-17, 0, -20.5, 17, 2.4, 5.2);
  // cella with arched windows
  const top = 14.85;
  b.paint(CIV.limestone, Surf.WallWindows, 7, 4.8).box(-15.5, 2.4, -19.5, 15.5, top, -1.5, { top: null, pz: pnt(CIV.limestone, Surf.Stone) });
  b.paint(CIV.trim, Surf.Plain).box(-16, top - 0.8, -20, 16, top, -1.5, { top: null });
  // full-width portico + continuous temple roof
  const roofC = 0x5f9a86;
  portico(b, 0, 5.0, 32, 6.5, 2.4, 11, 8, { r: 0.62, pedH: 4.8, roof: roofC });
  inscription(b, 0, 2.4 + 11 + 0.55, 4.8, 14, 0.7, CIV.bronzeDark);
  b.paint(roofC, Surf.RoofTiles).gableRoof(0, -10.75, 32, 18.5, top + 0.6, 4.8, 'z', 0.2, pnt(CIV.limestone, Surf.Stone));
  doorOnFace(b, 'pz', -1.44, 0, 3.0, 5.6, 0x3a2c20, 0x2a2018, 2.4);
  windowsOnFace(b, 'pz', -1.44, -14, -4, 2.4, 2, 5.4, 3, 1.3, 3.2, CIV.trim, 0x2a3440, 0.8);
  windowsOnFace(b, 'pz', -1.44, 4, 14, 2.4, 2, 5.4, 3, 1.3, 3.2, CIV.trim, 0x2a3440, 0.8);
  // clock cupola on the ridge
  const ry = top + 0.6 + 4.8;
  b.paint(CIV.limestone, Surf.Stone).boxC(0, -10.75, 4, 4, ry - 0.9, 3.4);
  for (const f of ['pz', 'px', 'nx', 'nz'] as const) {
    const off = f === 'pz' ? [0, 2.02] : f === 'nz' ? [0, -2.02] : f === 'px' ? [2.02, 0] : [-2.02, 0];
    clockFace(b, off[0], ry + 1.2, -10.75 + off[1], 0.9, f);
  }
  b.paint(CIV.trim, Surf.Plain).boxC(0, -10.75, 4.5, 4.5, ry + 2.5, 0.3);
  b.paint(roofC, Surf.RoofTiles).sphere(0, ry + 2.8, -10.75, 1.8, 12, 8, { hemi: true, scaleY: 0.95 });
  b.paint(CIV.gold, Surf.Metal).cylinder(0, -10.75, ry + 4.4, 0.35, 0.08, 0.03, 4, { top: false });
  // statue of justice on the apex (gold)
  b.paint(CIV.gold, Surf.Metal).cylinder(0, 4.6, top + 0.6 + 4.8, 1.6, 0.35, 0.22, 6).blob(0, top + 7.3, 4.6, 0.25, 0.28, 0.25, 0, 0.05, 1);
  b.beam([-0.9, top + 6.7, 4.6], [0.9, top + 6.7, 4.6], 0.08);
  // wide steps
  steps(b, 0, 10.4, 30, 8, 0.3, 0.68);
  // flags, lamps, justice statues, planters, trees, hedges
  flag(b, -14, 20, 10, FLAGS.nation, 0, 1.4);
  flag(b, 14 - 3.2, 20, 10, FLAGS.city, 0, 1.4);
  for (const sx of [-1, 1]) {
    lamp(b, sx * 15.8, 9.6, 4.2);
    lamp(b, sx * 11, 16.5, 4.2);
    planter(b, sx * 8, 12.5, 0.9);
    // justice statue on a plinth flanking the steps
    b.paint(CIV.granite, Surf.Stone).boxC(sx * 13, 11.6, 1.6, 1.6, 0, 1.6);
    b.paint(CIV.gold, Surf.Metal).cylinder(sx * 13, 11.6, 1.6, 1.5, 0.34, 0.22, 6).blob(sx * 13, 3.35, 11.6, 0.22, 0.26, 0.22, 0, 0.05, 2);
    b.beam([sx * 13 - 0.7, 2.9, 11.6], [sx * 13 + 0.7, 2.9, 11.6], 0.07);
    tree(b, rng, sx * 19.5, 11, 1.05);
    tree(b, rng, sx * 19.5, 19.5, 1.05);
    tree(b, rng, sx * 21, -8, 1);
    tree(b, rng, sx * 21, -18, 1);
    hedgeBox(b, sx > 0 ? 12.6 : -23, 23, sx > 0 ? 23 : -12.6, 23.7, 0.9);
    benchAt(b, sx * 6.5, 21.5, Math.PI);
  }
}

function cemetery(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 24;
  grass(b, -s, -s, s, s, 0x5f8f42);
  // paths
  b.paint(0xcfc4ab, Surf.Pavement);
  b.slab(-1.5, -11, 1.5, 24, 0.09);
  b.slab(-22.5, 1, 22.5, 3.4, 0.09);
  // chapel
  const cz0 = -22.5, cz1 = -11;
  const stone = 0xcdbf9f;
  b.paint(stone, Surf.Stone).box(-4.5, 0, cz0, 4.5, 4.8, cz1, { top: null });
  b.paint(0x4a4f57, Surf.RoofTiles).gableRoof(0, (cz0 + cz1) / 2, 9, cz1 - cz0, 4.8, 3.3, 'z', 0.35, pnt(stone, Surf.Stone));
  doorOnFace(b, 'pz', cz1, 0, 1.5, 2.6, 0x3a2c20, 0x2e2218);
  b.paint(0x6a4a8a, Surf.GlassPlain);
  // rose window
  b.push().translate(0, 5.6, cz1 + 0.06);
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2, a1 = ((i + 1) / 10) * Math.PI * 2;
    b.tri([0, 0, 0], [Math.cos(a0) * 0.9, Math.sin(a0) * 0.9, 0], [Math.cos(a1) * 0.9, Math.sin(a1) * 0.9, 0]);
  }
  b.pop();
  windowsOnFace(b, 'px', 4.5, -cz1 + 1, -cz0 - 1, 0, 1, 4, 4, 0.7, 2.4, 0xb8aa8a, 0x3a3050, 1.2);
  windowsOnFace(b, 'nx', 4.5, cz0 + 1, cz1 - 1, 0, 1, 4, 4, 0.7, 2.4, 0xb8aa8a, 0x3a3050, 1.2);
  // bell turret
  b.paint(stone, Surf.Stone).boxC(0, cz1 + 0.9, 1.6, 1.6, 7.0, 1.4);
  b.paint(0x4a4f57, Surf.RoofTiles).pyramid(0, cz1 + 0.9, 1.9, 1.9, 8.4, 1.4);
  b.paint(CIV.gold, Surf.Metal).box(-0.04, 9.8, cz1 + 0.86, 0.04, 9.95, cz1 + 0.94);
  // graves in quadrants
  const colors = [0xa8a8a4, 0x8e8e8a, 0xc4c0b8, 0x77767a, 0xb9b3a6];
  const quads: [number, number, number, number][] = [[-21.5, 5.5, -3.5, 21.5], [3.5, 5.5, 21.5, 21.5], [-21.5, -21, -6.5, -1], [6.5, -21, 21.5, -8]];
  quads.forEach(([x0, z0, x1, z1]) => {
    for (let z = z0 + 0.8; z <= z1 - 0.8; z += 2.7) {
      for (let x = x0 + 0.7; x <= x1 - 0.6; x += 2.5) {
        if (rng.chance(0.13)) continue;
        const kind = rng.weighted([0, 1, 2, 3], [0.6, 0.18, 0.08, 0.14]);
        const gx = x + rng.range(-0.1, 0.1);
        gravestone(b, gx, z, kind, rng.pick(colors));
        if (rng.chance(0.1)) {
          // flowers / wreath in front of the stone
          b.paint(rng.pick([0xc8324a, 0xe8c04a, 0xf2efe6, 0x9a4ab0]), Surf.Foliage).box(gx - 0.24, 0.06, z + 0.16, gx + 0.24, 0.3, z + 0.48, { bottom: null, nz: null, px: null, nx: null });
        }
      }
    }
  });
  // mausoleums (back right)
  for (const mx of [10, 17]) {
    b.paint(0xd8d2c4, Surf.Stone).boxC(mx, -3.8, 4, 4.6, 0, 3.0);
    b.paint(0x8a8c8e, Surf.Plain).gableRoof(mx, -3.8, 4, 4.6, 3.0, 1.1, 'z', 0.25, pnt(0xd8d2c4, Surf.Stone));
    b.paint(0x2e2a26, Surf.Plain);
    vrect(b, mx - 0.6, 0, mx + 0.6, 2.1, -1.48);
    colonnade(b, mx - 1.5, mx + 1.5, -1.2, 0, 3.0, 2, 0.18, CIV.marble, 6);
  }
  // angel memorial at the crossing
  b.paint(CIV.granite, Surf.Stone).boxC(0, 2.2, 1.4, 1.4, 0.09, 1.6);
  b.paint(0xe6e2d8, Surf.Plain).cylinder(0, 2.2, 1.7, 1.3, 0.35, 0.2, 6).blob(0, 3.2, 2.2, 0.2, 0.22, 0.2, 0, 0.05, 4);
  b.quad2([-0.1, 2.3, 2.1], [-0.9, 2.9, 1.9], [-0.7, 3.6, 1.9], [-0.1, 2.9, 2.1]);
  b.quad2([0.1, 2.3, 2.1], [0.1, 2.9, 2.1], [0.7, 3.6, 1.9], [0.9, 2.9, 1.9]);
  // cypress avenue + shade trees
  for (let z = 7; z <= 21; z += 4.6) {
    cypress(b, rng, -2.6, z, 0.95);
    cypress(b, rng, 2.6, z, 0.95);
  }
  for (const [x, z] of [[-20.5, -20.5], [20.5, 20], [-20.5, 20], [20.5, -20.5], [-12, -9.5]] as [number, number][]) tree(b, rng, x, z, 1.0);
  benchAt(b, -7, 3.9, Math.PI);
  benchAt(b, 7, 3.9, Math.PI);
  // enclosure: stone front wall + iron fence
  b.paint(0xb8ab8e, Surf.Stone);
  b.box(-23.6, 0, 23, -3.2, 0.8, 23.6).box(3.2, 0, 23, 23.6, 0.8, 23.6);
  gatePier(b, -3, 23.3, 2.6, 0xb8ab8e);
  gatePier(b, 3, 23.3, 2.6, 0xb8ab8e);
  ironFence(b, -23.3, 23.3, -3.6, 23.3, 1.9);
  ironFence(b, 3.6, 23.3, 23.3, 23.3, 1.9);
  ironFence(b, -23.5, -23.5, 23.5, -23.5, 1.8);
  ironFence(b, -23.5, -23.5, -23.5, 23.3, 1.8);
  ironFence(b, 23.5, -23.5, 23.5, 23.3, 1.8);
}

function conventionCenter(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 32;
  pave(b, -s, -s, s, s, 0xd0cbc1);
  // main exhibition hall: white walls + big barrel vault
  const hx0 = -29.5, hx1 = 29.5, hz0 = -30, hz1 = -3;
  b.paint(0xe9e7e1, Surf.Plain).box(hx0, 0, hz0, hx1, 12, hz1, { top: null });
  b.paint(0x7aa6c4, Surf.GlassCurtain, 5, 4).box(hx0 - 0.05, 3.5, hz0 + 1.5, hx0, 10.5, hz1 - 1.5, { top: null, pz: null, nz: null, px: null });
  b.paint(0x7aa6c4, Surf.GlassCurtain, 5, 4).box(hx1, 3.5, hz0 + 1.5, hx1 + 0.05, 10.5, hz1 - 1.5, { top: null, pz: null, nz: null, nx: null });
  vault(b, 0, (hz0 + hz1) / 2, hx1 - hx0 + 1, hz1 - hz0 + 1, 12, 10, 16, pnt(0xc9ced3, Surf.Metal), pnt(0x3a4450, Surf.GlassCurtain, 3, 4), 'x');
  // ridge skylight strip
  b.paint(0x2a3440, Surf.GlassPlain).box(hx0 + 2, 22.02, (hz0 + hz1) / 2 - 1.4, hx1 - 2, 22.2, (hz0 + hz1) / 2 + 1.4, { bottom: null });
  // roof seam ribs along X
  b.paint(0x8f969c, Surf.Metal);
  {
    const d = hz1 - hz0 + 1, sHalf = d / 2, rise = 10;
    const R = (sHalf * sHalf + rise * rise) / (2 * rise), yc = 12 + rise - R;
    for (const t of [-0.75, -0.45, -0.15, 0.15, 0.45, 0.75]) {
      const zz = (hz0 + hz1) / 2 + t * sHalf;
      const yy = yc + Math.sqrt(R * R - (t * sHalf) ** 2) + 0.05;
      b.box(hx0 - 0.5, yy, zz - 0.2, hx1 + 0.5, yy + 0.25, zz + 0.2, { bottom: null });
    }
  }
  // glass lobby with curved front (arc in plan) + low vault
  const pts: [number, number][] = [];
  const seg = 12;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const x = -25 + 50 * t;
    pts.push([x, 5 + 4.5 * Math.sin(Math.PI * t)]);
  }
  pts.push([25, -3], [-25, -3]);
  b.paint(0x6c9cc0, Surf.GlassCurtain, 5, 4.2).extrude(pts, 0, 11, { top: false });
  const roofPts: [number, number][] = pts.map(([x, z], i) => (i <= seg ? [x * 1.04, z + 1.6] : [x * 1.04, z]) as [number, number]);
  b.paint(0xf1efea, Surf.Plain).extrude(roofPts, 11, 0.9, { topPaint: pnt(0xdad7d0, Surf.RoofFlat) });
  // slim lobby columns
  b.paint(0xe0ddd6, Surf.Metal);
  for (let i = 1; i < seg; i += 2) {
    const [x, z] = pts[i];
    b.cylinder(x * 1.02, z + 1.0, 0, 11, 0.22, 0.22, 6, { top: false });
  }
  // big sign on the roof edge + entrance canopy
  wallSign(b, 0, 12.6, 11.2, 22, 1.4, SW, 'pz', 0x1f3f7a, undefined, CIV.navy);
  canopy(b, -8, 9.5, 8, 15, 5.2, 0xf1efea, [[-7.5, 14.6], [7.5, 14.6]], 0.5);
  // plaza: flags of many colors, drop-off lane, planters, trees, lamps
  asphalt(b, -31.5, 16.5, 31.5, 22.5, 0.14);
  b.paint(0xf2f2f2, Surf.Plain);
  for (let x = -29; x < 30; x += 6) flat(b, x, 19.45, x + 3, 19.55, 0.17);
  bus(b, -16, 18.2, Math.PI / 2, 0xe8ecef, false, 0.14);
  miniCar(b, 4, 20.6, -Math.PI / 2, CIV.busYellow, 0.14);
  miniCar(b, 10, 20.6, -Math.PI / 2, 0xb8bcc2, 0.14);
  const flagSet: ColorLike[][] = [[0xc0392b, 0xf4f4f4], [0x2e6fb5, 0xf2c230], [0x2a8a4a, 0xf4f4f4, 0xc0392b], [0xf4f4f4, 0x2e6fb5], [0xd9a324, 0x1a1a1a], [0x7a1f8a, 0xf4f4f4], [0x1f7fbf, 0xf4f4f4, 0x1f7fbf]];
  for (let i = 0; i < 7; i++) flag(b, -21 + i * 7, 25.5, 10, flagSet[i]);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) planter(b, sx * (16 + i * 5), 12.5, 0.9);
    tree(b, rng, sx * 29, 12, 1.1);
    tree(b, rng, sx * 29, 28, 1.1);
    lamp(b, sx * 11, 28.5, 4.6);
    lamp(b, sx * 25, 28.5, 4.6);
  }
  // ring sculpture
  b.paint(0xc9ced3, Surf.Metal).ring(0, 3.2, 28.2, 2.6, 0.35, 16, 'xy');
  b.paint(CIV.granite, Surf.Stone).boxC(0, 28.2, 2.2, 1.2, 0, 0.6);
}

function busDepot(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 24;
  asphalt(b, -s, -s, s, s);
  const agency = 0x2c8c6c;
  // garage hall with barrel roof (ridge along Z) and 4 open bays
  const gx0 = -23, gx1 = 9, gz0 = -23, gz1 = -3;
  b.paint(0xaab4bc, Surf.Corrugated).box(gx0, 0, gz0, gx1, 7, gz1, { top: null });
  vault(b, (gx0 + gx1) / 2, (gz0 + gz1) / 2, gx1 - gx0 + 0.6, gz1 - gz0 + 0.6, 7, 3.6, 12, pnt(0x8b949b, Surf.Metal), pnt(0xaab4bc, Surf.Corrugated), 'z');
  b.paint(agency, Surf.Plain).box(gx0 - 0.08, 5.6, gz1, gx1 + 0.08, 6.4, gz1 + 0.1, { top: null });
  const bays = [-19, -11, -3, 5];
  bays.forEach((x) => bayDoor(b, x, gz1, 6, 5, 0x9aa3ab, true, 0xe2e4e6));
  bus(b, -11, -6.2, 0, 0xe8ecef, false, 0.08);
  bus(b, 5, -7.8, 0, agency, false, 0.08);
  wallSign(b, -7, 8.2, gz1 + 0.12, 9, 0.9, SW, 'pz', agency, undefined, agency);
  // office annex
  block(b, 11, -23, 23, -13, 0, 7.4, 0xe4e2dc, Surf.WallWindows, 2, 3.7);
  band(b, 11, -23, 23, -13, 6.8, 0.8, agency, Surf.Plain, 0.14);
  acUnits(b, rng, 12, -22, 22, -14, 7.6, 2);
  // fuel / wash canopy with a bus
  canopy(b, 12, -9.5, 23, 1.5, 5.2, 0xf0f0ee, [[12.4, -9.1], [22.6, -9.1], [12.4, 1.1], [22.6, 1.1]], 0.6);
  b.paint(agency, Surf.Plain).box(12, 5.3, 1.51, 23, 5.7, 1.56, { top: null });
  // fuel island with two pumps
  b.paint(0xc9c4b8, Surf.Pavement).boxC(19.3, -4, 1.4, 7.5, 0, 0.25);
  b.paint(0xd0d4d8, Surf.Metal).boxC(19.3, -6, 0.9, 0.7, 0.25, 1.7).boxC(19.3, -2, 0.9, 0.7, 0.25, 1.7);
  b.paint(agency, Surf.Emissive);
  vrect(b, 18.95, 1.3, 19.65, 1.75, -1.63);
  bus(b, 15.2, -4.2, 0, agency, false, 0.08);
  // yard: rows of parked buses
  b.paint(0xf2f2f2, Surf.Plain);
  for (let i = 0; i <= 8; i++) flat(b, -22.3 + i * 4.6 - 0.06, 3, -22.3 + i * 4.6 + 0.06, 17, 0.11);
  for (let i = 0; i < 8; i++) {
    if (i === 5) continue;
    bus(b, -20 + i * 4.6, 10, rng.chance(0.5) ? 0 : Math.PI, i % 3 === 1 ? 0xe8ecef : agency, false, 0.08);
  }
  // fence, gate booth, sign, trees
  meshFence(b, -23.6, 23.4, 12, 23.4, 2.2);
  meshFence(b, -23.6, -23.6, -23.6, 23.4, 2.2);
  meshFence(b, 23.6, -12, 23.6, 23.4, 2.2);
  b.paint(0xe4e2dc, Surf.Plain).boxC(20, 20, 2.4, 2.4, 0, 2.8, { top: pnt(agency) });
  b.paint(0x2a3440, Surf.GlassPlain).boxC(20, 20, 2.5, 1.8, 1.0, 1.3, { top: null });
  pylonSign(b, 20, 15.5, 3.4, 4.0, SW, agency, 1.6, agency);
}

function statue(b: ModelBuilder, _v: number, rng: RNG) {
  grass(b, -8, -8, 8, 8, 0x6ea447);
  // octagonal plaza
  const oct: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
    oct.push([Math.cos(a) * 7.4, Math.sin(a) * 7.4]);
  }
  b.paint(0xd6d0c4, Surf.Pavement).extrude(oct, 0, 0.12);
  b.paint(0xc2bba9, Surf.Plain);
  annulus(b, 0, 0, 3.6, 3.9, 8, 0.15, Math.PI / 8, Math.PI / 8 + Math.PI * 2);
  // stepped pedestal: granite with a marble cornice and a gold plaque
  b.paint(CIV.granite, Surf.Stone).boxC(0, 0, 4.4, 4.4, 0, 0.45).boxC(0, 0, 3.5, 3.5, 0.45, 0.4);
  b.paint(0x7d7a74, Surf.Stone).boxC(0, 0, 2.5, 2.5, 0.85, 2.3);
  b.paint(CIV.marble, Surf.Plain).boxC(0, 0, 2.9, 2.9, 3.15, 0.3);
  b.paint(CIV.gold, Surf.Metal);
  vrect(b, -0.95, 1.4, 0.95, 2.6, 1.29);
  // bronze mayor: legs, frock coat, torso, head, raised arm, arm with scroll
  const br = 0x6d5b3c;
  const y0 = 3.45;
  b.paint(br, Surf.Metal);
  b.boxC(0, 0, 1.5, 1.0, y0, 0.15);
  b.boxC(-0.24, 0.05, 0.34, 0.4, y0 + 0.15, 1.35).boxC(0.24, -0.05, 0.34, 0.4, y0 + 0.15, 1.35);
  b.cylinder(0, 0, y0 + 1.0, 1.2, 0.62, 0.46, 7);
  b.cylinder(0, 0, y0 + 2.2, 0.6, 0.46, 0.4, 7);
  b.boxC(0, 0, 1.15, 0.55, y0 + 2.55, 0.25);
  b.blob(0, y0 + 3.1, 0.02, 0.24, 0.3, 0.26, 0, 0.04, 2);
  b.beam([0.5, y0 + 2.65, 0], [0.95, y0 + 3.45, 0.45], 0.2);
  b.blob(0.98, y0 + 3.55, 0.48, 0.12, 0.12, 0.12, 0, 0.05, 3);
  b.beam([-0.5, y0 + 2.65, 0], [-0.62, y0 + 1.8, 0.28], 0.2);
  b.paint(0xd9c9a0, Surf.Plain).cylinder(-0.62, 0.35, y0 + 1.6, 0.5, 0.08, 0.08, 5);
  // flower beds, benches, lamps, hedges
  for (const [x, z] of [[-5.6, -5.6], [5.6, -5.6], [-5.6, 5.6], [5.6, 5.6]] as [number, number][]) {
    b.paint(0x4d7a36, Surf.Foliage).boxC(x, z, 2.2, 2.2, 0, 0.45);
    b.paint(rng.pick([0xb85a6e, 0xc8a85a, 0xa8566a]), Surf.Foliage).blob(x, 0.55, z, 0.75, 0.35, 0.75, 0, 0.2, x * 3 + z);
  }
  benchAt(b, 0, 5.8, Math.PI);
  benchAt(b, -5.8, 0, Math.PI / 2);
  benchAt(b, 5.8, 0, -Math.PI / 2);
  for (const [x, z] of [[-3.6, 5.2], [3.6, 5.2], [-3.6, -5.2], [3.6, -5.2]] as [number, number][]) lamp(b, x, z, 3.6, 0x2a2c2e, 0.3);
  tree(b, rng, 0, -6.2, 0.75);
}

export const models: ModelBuilders = {
  civ_police_kiosk: policeKiosk,
  civ_police_station: policeStation,
  civ_police_hq: policeHQ,
  civ_jail: jail,
  civ_fire_station: fireStation,
  civ_fire_hq: fireHQ,
  civ_clinic: clinic,
  civ_hospital: hospital,
  civ_medical_center: medicalCenter,
  civ_elementary_school: elementarySchool,
  civ_high_school: highSchool,
  civ_college: college,
  civ_library: library,
  civ_museum: museum,
  civ_city_hall: cityHall,
  civ_mayor_house: mayorHouse,
  civ_courthouse: courthouse,
  civ_cemetery: cemetery,
  civ_convention_center: conventionCenter,
  civ_bus_depot: busDepot,
  civ_statue: statue,
};
