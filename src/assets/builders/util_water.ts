/**
 * Utility / WATER models: pump station, water tower, treatment plant, desalination plant.
 */
import type { ModelBuilders } from '../registry';
import type { ModelBuilder, ColorLike } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { signBox } from '../kit';
import {
  type V3, flat, ground, wallQuad, wallRow, tube, disc, dome, lathe, hCyl, strut, pipeRun, tank, carLow, fenceRect, floodLight, roofUnit, officeBlock, tree, parapet, boxTruck, CAR_COLORS2
} from './ind_kit';

const CONCRETE = 0xa39e94;
const WATER = 0x3f7ea6;
const PIPE_BLUE = 0x2f6fa8;

/** Round clarifier: concrete ring wall, water, center column, rotating bridge. ~120 tris. */
function clarifier(b: ModelBuilder, x: number, z: number, r: number, h = 2.6, ang = 0.6, water: ColorLike = WATER): void {
  b.paint(0xc5c1b8, Surf.Plain);
  lathe(b, x, z, [[r + 0.5, 0], [r + 0.5, h], [r, h], [r, h - 0.4]], 18);
  b.paint(water, Surf.Water);
  disc(b, x, z, h - 0.35, r, 18);
  b.paint(0x8a9a8a, Surf.Water);
  lathe(b, x, z, [[r * 0.28, h - 0.3], [r * 0.24, h - 0.3]], 12);
  b.paint(0xc5c1b8, Surf.Plain);
  tube(b, x, z, 0, h + 0.8, 0.9, 0.9, 8);
  disc(b, x, z, h + 0.8, 0.9, 8);
  // bridge
  b.paint(0xd8dadc, Surf.Metal);
  const ex = x + Math.cos(ang) * (r + 0.3), ez = z + Math.sin(ang) * (r + 0.3);
  const px = -Math.sin(ang) * 0.6, pz = Math.cos(ang) * 0.6;
  strut(b, [x + px, h + 0.9, z + pz], [ex + px, h + 0.9, ez + pz], 0.25);
  strut(b, [x - px, h + 0.9, z - pz], [ex - px, h + 0.9, ez - pz], 0.25);
  b.paint(0xe6a817, Surf.Metal);
  strut(b, [x + px, h + 1.9, z + pz], [ex + px, h + 1.9, ez + pz], 0.1);
  b.paint(0x55595e, Surf.Metal).boxC(ex, ez, 1.2, 1.2, h, 1.2);
}

/** Rectangular open basin with water and walkway walls. */
function basin(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h: number, splits: number, water: ColorLike = WATER, alongX = true): void {
  b.paint(0xc5c1b8, Surf.Plain).box(x0, 0, z0, x1, h, z1, { top: null });
  b.paint(0xb0aca2, Surf.Plain);
  flat(b, x0, z0, x1, z0 + 0.5, h);
  flat(b, x0, z1 - 0.5, x1, z1, h);
  flat(b, x0, z0, x0 + 0.5, z1, h);
  flat(b, x1 - 0.5, z0, x1, z1, h);
  b.paint(water, Surf.Water);
  flat(b, x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 0.5, h - 0.35);
  b.paint(0xb0aca2, Surf.Plain);
  for (let i = 1; i < splits; i++) {
    if (alongX) {
      const zz = z0 + ((z1 - z0) * i) / splits;
      b.box(x0, h - 0.4, zz - 0.3, x1, h, zz + 0.3, { bottom: null });
    } else {
      const xx = x0 + ((x1 - x0) * i) / splits;
      b.box(xx - 0.3, h - 0.4, z0, xx + 0.3, h, z1, { bottom: null });
    }
  }
}

// ------------------------------------------------------------------------------------------------ util_water_pump
function waterPump(b: ModelBuilder, rng: RNG): void {
  ground(b, -8, -8, 8, 8, 0x6f9a45, Surf.Foliage, 0.04);
  b.paint(CONCRETE, Surf.Pavement);
  flat(b, -7, -7, 7, 3.5, 0.07);
  flat(b, -1.4, 3.5, 1.4, 8, 0.07);
  // pump house
  b.paint(0x9c5a42, Surf.Brick).box(-6.5, 0, -6.5, 1.5, 4.4, -0.5);
  b.paint(0x4a5058, Surf.RoofTiles).gableRoof(-2.5, -3.5, 8, 6, 4.4, 1.7, 'x', 0.35, { color: 0x9c5a42, surf: Surf.Brick });
  b.paint(0x2e4f7a, Surf.Wood);
  wallQuad(b, 'pz', -0.5, -4.8, -3.0, 0, 2.6);
  b.paint(0x2a3440, Surf.GlassPlain);
  wallQuad(b, 'pz', -0.5, -1.6, -0.2, 1.4, 3.0);
  wallRow(b, 'nx', -6.5, -6, -1, 1.4, 3.0, 2, 1.0);
  b.paint(0xe8e8e0, Surf.Plain);
  wallQuad(b, 'pz', -0.5, -5.8, -5.2, 3.4, 4.0);
  // pump unit: motor + volute on a skid
  b.paint(0x9a978f, Surf.Plain).box(2.5, 0, -6, 6.5, 0.4, -2);
  b.paint(0x2f6fa8, Surf.Metal);
  hCyl(b, 4.8, 1.3, -4, 2.2, 0.8, 'x', 10);
  b.paint(0x1f4f7a, Surf.Metal).box(2.9, 0.4, -4.7, 3.8, 1.8, -3.3);
  b.paint(0x2f6fa8, Surf.Metal);
  tube(b, 6.0, -4, 0.4, 2.2, 0.7, 0.7, 10);
  disc(b, 6.0, -4, 2.6, 0.7, 10);
  // pipes: suction from ground, discharge into the house and out to the street
  b.paint(PIPE_BLUE, Surf.Metal);
  pipeRun(b, [[6.0, 0, -7.2], [6.0, 1.2, -7.2], [6.0, 1.2, -4.6]], 0.42, 8);
  pipeRun(b, [[6.0, 2.2, -4], [6.0, 2.2, -1.2], [1.5, 2.2, -1.2]], 0.42, 8);
  pipeRun(b, [[4.0, 1.0, -1.2], [4.0, 1.0, 3.0], [4.0, -0.2, 3.0]], 0.38, 8);
  b.paint(0xc0392b, Surf.Metal);
  for (const [px, pz] of [[6.0, -2.4], [4.0, 1.4]] as [number, number][]) {
    strut(b, [px, 2.3, pz], [px, 3.2, pz], 0.1);
    b.push().translate(px, 3.25, pz);
    b.cylinder(0, 0, 0, 0.08, 0.45, 0.45, 8, { top: true });
    b.pop();
  }
  // valve pit + surge vessel
  b.paint(0xb8b4ac, Surf.Plain).box(2.8, 0, 2.4, 5.2, 0.5, 4.2);
  b.paint(0x55595e, Surf.Metal);
  flat(b, 3.0, 2.6, 5.0, 4.0, 0.52);
  tank(b, -5, 2, 0.9, 3.0, 0xe8e8e2, { roof: 'dome', seg: 10 });
  fenceRect(b, -7.5, -7.5, 7.5, 7.5, 1.8, 0x8a9096, [-1.6, 1.6], 3.8, 2);
  signBox(b, 2, 0.4, 7.2, 5.5, 1.4, 7.4, 0x2f6fa8, 0xe8e8e4);
  tree(b, rng, -5.5, 5.8, 6.5, 1.6);
  floodLight(b, 7, -7, 5.5);
}

// ------------------------------------------------------------------------------------------------ util_water_tower
function waterTower(b: ModelBuilder): void {
  ground(b, -8, -8, 8, 8, 0x6f9a45, Surf.Foliage, 0.04);
  b.paint(0x9c958a, Surf.Pavement);
  flat(b, -6.5, -6.5, 6.5, 6.5, 0.07);
  flat(b, -1.3, 6.5, 1.3, 8, 0.07);
  const legs = 6, rb = 5.6, rt = 4.5, yt = 21;
  const col = 0x9cc2de;
  b.paint(0xa9a59c, Surf.Plain);
  const P = (i: number, y: number): V3 => {
    const a = (i / legs) * Math.PI * 2 + Math.PI / 6;
    const r = rb + (rt - rb) * (y / yt);
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  for (let i = 0; i < legs; i++) {
    const p = P(i, 0);
    b.boxC(p[0], p[2], 1.1, 1.1, 0, 0.6);
  }
  b.paint(0x7fa6c4, Surf.Metal);
  for (let i = 0; i < legs; i++) strut(b, P(i, 0.6), P(i, yt + 0.8), 0.55);
  // bracing: horizontal ring + X panels at two levels
  for (const [ya, yb] of [[1.5, 10.5], [10.5, 19.5]] as [number, number][]) {
    for (let i = 0; i < legs; i++) {
      const j = (i + 1) % legs;
      strut(b, P(i, ya), P(j, yb), 0.14);
      strut(b, P(j, ya), P(i, yb), 0.14);
      strut(b, P(i, yb), P(j, yb), 0.2);
    }
  }
  // riser
  b.paint(0x7fa6c4, Surf.Metal);
  tube(b, 0, 0, 0.6, yt, 0.9, 0.9, 10);
  // tank (spheroid) with balcony
  b.paint(col, Surf.Plain);
  lathe(b, 0, 0, [[0.9, yt - 0.2], [3.4, yt + 0.7], [5.7, yt + 2.6], [6.6, yt + 5.0], [6.6, yt + 6.6], [5.9, yt + 8.6], [3.8, yt + 10.0], [0, yt + 10.5]], 18);
  b.paint(0xf2f2ee, Surf.Plain);
  lathe(b, 0, 0, [[6.62, yt + 5.3], [6.62, yt + 6.4]], 18);
  b.paint(0x55595e, Surf.Metal);
  tube(b, 0, 0, yt + 2.9, 0.18, 7.2, 7.2, 18);
  lathe(b, 0, 0, [[7.2, yt + 3.0], [6.2, yt + 3.0]], 18);
  tube(b, 0, 0, yt + 3.9, 0.08, 7.2, 7.2, 18);
  // ladder + finial + beacon
  strut(b, [5.9, 0.6, -1.6], [5.0, yt + 3, -1.4], 0.25);
  strut(b, [0, yt + 10.4, 0], [0, yt + 12, 0], 0.18);
  b.paint(0xff2a1a, Surf.Emissive).boxC(0, 0, 0.4, 0.4, yt + 12, 0.4);
  // small valve house
  b.paint(0xc8b8a0, Surf.Plain).box(2.2, 0, 3.4, 5.2, 2.6, 5.8);
  b.paint(0x7a4a36, Surf.RoofTiles).gableRoof(3.7, 4.6, 3, 2.4, 2.6, 0.8, 'x', 0.2, { color: 0xc8b8a0, surf: Surf.Plain });
  fenceRect(b, -7.5, -7.5, 7.5, 7.5, 1.8, 0x8a9096, [-1.4, 1.4], 4, 2);
}

// ------------------------------------------------------------------------------------------------ util_water_treatment
function waterTreatment(b: ModelBuilder, rng: RNG): void {
  const H = 24;
  ground(b, -H, -H, H, H, 0x6f9a45, Surf.Foliage, 0.04);
  b.paint(CONCRETE, Surf.Pavement);
  flat(b, -23.5, -23.5, 23.5, 11.5, 0.06);
  clarifier(b, -13.5, -13.5, 8.6, 2.8, 0.7);
  clarifier(b, 5, -14, 8.2, 2.8, 2.4, 0x4a8290);
  // digesters (domed)
  for (const [x, z] of [[19, -18.5], [19, -8.5]] as [number, number][]) {
    b.paint(0xc8b8a0, Surf.Plain);
    tube(b, x, z, 0, 8.5, 4.1, 4.1, 14);
    b.paint(0x9aa0a6, Surf.Metal);
    dome(b, x, z, 8.5, 4.1, 2.2, 14, 2);
    b.paint(0x55595e, Surf.Metal);
    strut(b, [x, 10.7, z], [x, 11.8, z], 0.3);
  }
  b.paint(0x55595e, Surf.Metal);
  strut(b, [19, 9, -14.4], [19, 9, -12.6], 0.9);
  // aeration basins (middle band)
  basin(b, -23, -2.5, 12, 10, 2.4, 3, 0x5a8c7a);
  b.paint(0xeef4f0, Surf.Water);
  for (let i = 0; i < 3; i++) flat(b, -22 + i * 12, 0, -14 + i * 12, 2.5, 2.1);
  // filter building + chemical tanks
  b.paint(0xe0dcd2, Surf.WallWindows, 4, 4).box(13.5, 0, -2.5, 23.5, 7, 11, { top: { color: 0x8e8b84, surf: Surf.RoofFlat } });
  parapet(b, 13.5, -2.5, 23.5, 11, 7, 0.6, 0.25, 0xc5c1b8);
  roofUnit(b, 18, 7, 4, 3, 3, 1.4);
  tank(b, 10, 13.5, 1.6, 5, 0xe8e8e2, { roof: 'dome', seg: 10 });
  tank(b, 13.8, 13.5, 1.6, 5, 0xe8e8e2, { roof: 'dome', seg: 10 });
  // pipes
  b.paint(PIPE_BLUE, Surf.Metal);
  pipeRun(b, [[-13.5, 3.4, -4.9], [-13.5, 3.4, -3.5], [-2, 3.4, -3.5], [5, 3.4, -5.8]], 0.5, 6, true);
  b.paint(0x2e7d4f, Surf.Metal);
  pipeRun(b, [[13.5, 3.2, 2], [11, 3.2, 2]], 0.45, 6);
  pipeRun(b, [[12, 2.2, -2.5], [12, 2.2, -5.5], [15, 2.2, -8.5]], 0.45, 6, true);
  // control building front-left
  officeBlock(b, -23, 13, -8, 21.5, 7.5, 0xe6e4de, 2, 3.6);
  b.paint(PIPE_BLUE, Surf.Plain);
  wallQuad(b, 'pz', 21.5, -23, -8, 6.0, 6.6);
  b.paint(0x5a5b5e, Surf.Pavement);
  flat(b, -6, 11.5, -2, 24, 0.07);
  for (let i = 0; i < 4; i++) carLow(b, 0 + i * 2.8, 16.5, 0, rng.pick(CAR_COLORS2));
  b.paint(0x5a5b5e, Surf.Pavement);
  flat(b, -1.5, 13.5, 11, 19.5, 0.065);
  for (let i = 0; i < 4; i++) tree(b, rng, 5 + i * 5, 21.8, 7, 1.9);
  floodLight(b, -23, 12, 9);
  fenceRect(b, -23.6, -23.6, 23.6, 23.6, 2.0, 0x8a9096, [-6.5, -1.5], 12, 1);
}

// ------------------------------------------------------------------------------------------------ util_desalination
function desalination(b: ModelBuilder, rng: RNG): void {
  const H = 24;
  ground(b, -H, -H, H, H, CONCRETE, Surf.Pavement, 0.05);
  // two long membrane (RO) halls along X
  for (const [z0, z1] of [[-21.5, -11.5], [-8, 2]] as [number, number][]) {
    b.paint(0xeef0f0, Surf.Corrugated).box(-22.5, 0, z0, 11, 11, z1);
    b.paint(0xb9bec2, Surf.Metal).gableRoof(-5.75, (z0 + z1) / 2, 33.5, z1 - z0, 11, 1.3, 'x', 0.3, { color: 0xeef0f0, surf: Surf.Corrugated });
    b.paint(0x1a8fb8, Surf.Plain);
    wallQuad(b, 'pz', z1, -22.5, 11, 8.4, 9.4);
    wallQuad(b, 'px', 11, z0, z1, 8.4, 9.4);
    b.paint(0x9fb4c0, Surf.GlassPlain);
    wallRow(b, 'pz', z1, -22, 10.5, 5, 7.2, 7, 3);
    roofUnit(b, -16, 12.3, (z0 + z1) / 2, 2.4, 3, 1.4);
    roofUnit(b, 2, 12.3, (z0 + z1) / 2, 2.4, 3, 1.4);
  }
  // high-pressure pipe racks between halls
  b.paint(0x55595e, Surf.Metal);
  for (let x = -20; x <= 8; x += 7) {
    strut(b, [x, 0, -10.2], [x, 4, -10.2], 0.25);
    strut(b, [x, 0, -9.3], [x, 4, -9.3], 0.25);
  }
  b.paint(0x2f6fa8, Surf.Metal);
  b.pipe([-22, 4.35, -10.2], [11, 4.35, -10.2], 0.35, 6);
  b.paint(0x9aa0a6, Surf.Metal);
  b.pipe([-22, 4.35, -9.3], [11, 4.35, -9.3], 0.35, 6);
  // product water tanks
  tank(b, 18, -16, 5.2, 12, 0xe8e8e2, { roof: 'cone', rim: 0x9aa0a6, seg: 14, stair: true });
  tank(b, 18, -3, 4.2, 10, 0xe8e8e2, { roof: 'cone', rim: 0x9aa0a6, seg: 14 });
  // pretreatment basins (front, sea side) + big intake pipes from the front edge
  basin(b, -22.5, 6, 2, 17, 2.4, 3, 0x4a8aa0, false);
  b.paint(0x2f6fa8, Surf.Metal);
  for (const x of [-18, -14]) pipeRun(b, [[x, 1.3, 23.9], [x, 1.3, 17.6]], 1.1, 10);
  b.paint(0x4f6a5a, Surf.Metal);
  pipeRun(b, [[6, 0.9, 23.9], [6, 0.9, 8], [11, 0.9, 3]], 0.7, 8);
  // intake pump house + chemical tanks + control building
  b.paint(0xd8d8d2, Surf.Plain).box(-12, 0, 18.5, -4, 5, 23);
  b.paint(0x1a8fb8, Surf.Plain);
  wallQuad(b, 'pz', 23, -12, -4, 3.8, 4.4);
  for (let i = 0; i < 3; i++) tank(b, 9 + i * 3.4, 12, 1.4, 5.5, 0xe8e2d0, { roof: 'dome', seg: 10 });
  officeBlock(b, 13, 14.5, 23, 21.5, 7, 0xe6e4de, 2, 3.5);
  b.paint(0x2f6fa8, Surf.Metal);
  pipeRun(b, [[2, 1.6, 12], [8.6, 1.6, 12]], 0.4, 6);
  for (let i = 0; i < 3; i++) carLow(b, 15 + i * 2.8, 10.5, 0, rng.pick(CAR_COLORS2));
  boxTruck(b, -1, 21, Math.PI * 0.5, 0xf2f2ee, 0x1a8fb8);
  floodLight(b, 23, -23, 11);
  floodLight(b, -23, 4, 11);
}


export const waterModels: ModelBuilders = {
  util_water_pump: (b, _v, rng) => waterPump(b, rng),
  util_water_tower: (b) => waterTower(b),
  util_water_treatment: (b, _v, rng) => waterTreatment(b, rng),
  util_desalination: (b, _v, rng) => desalination(b, rng),
};
