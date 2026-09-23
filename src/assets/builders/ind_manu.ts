/**
 * Industrial / MANUFACTURING models: ind_warehouse, ind_assembly_plant, ind_depot.
 */
import type { ModelBuilders } from '../registry';
import type { ModelBuilder, ColorLike } from '../ModelBuilder';
import { PALETTE } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { signBox } from '../kit';
import {
  type Face, flat, ground, wallQuad, wallRow, wallDisc, tube, dome, hCyl, strut, lattice, tank, smokestack, semi, boxTruck, carLow, forklift, pallets, fenceRect, floodLight, roofUnit, officeBlock, parking, containerAt, barrelRoof, tree, lightDot, CAR_COLORS2, CONTAINER_COLORS, TRUCK_COLORS
} from './ind_kit';

const APRON = 0x8f8b84;
const ASPHALT = PALETTE.asphalt;
const GRASS = 0x6f9a45;

/** Dock doors on a wall face: dark door + light frame + small bumper strip. ~6 tris each. */
function docks(b: ModelBuilder, face: Face, plane: number, a0: number, a1: number, n: number, doorColor: ColorLike = 0x3a3d40, frame: ColorLike = 0xd8d8d4): number[] {
  const step = (a1 - a0) / n;
  const centers: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = a0 + step * (i + 0.5);
    centers.push(c);
    b.paint(frame, Surf.Plain);
    wallQuad(b, face, plane, c - 1.75, c + 1.75, 0.9, 4.6, 0.02);
    b.paint(doorColor, Surf.Corrugated);
    wallQuad(b, face, plane, c - 1.5, c + 1.5, 1.2, 4.3, 0.05);
    b.paint(0x1c1c1c, Surf.Plain);
    wallQuad(b, face, plane, c - 1.6, c + 1.6, 0.9, 1.2, 0.08);
    // dock light above the door
    const o = 0.35;
    if (face === 'pz') lightDot(b, c, 5.1, plane + o, 0.28);
    else if (face === 'nz') lightDot(b, c, 5.1, plane - o, 0.28);
    else if (face === 'px') lightDot(b, plane + o, 5.1, c, 0.28);
    else lightDot(b, plane - o, 5.1, c, 0.28);
  }
  return centers;
}

/** Warehouse shell: walls with a stripe band, returns roof height. */
function shell(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h: number, wall: ColorLike, stripe: ColorLike | null, roof: 'flat' | 'gable' | 'barrel' | 'none', roofColor: ColorLike = 0xb9bcbf, surf = Surf.Corrugated): void {
  b.paint(wall, surf).box(x0, 0, z0, x1, h, z1, { top: roof === 'flat' ? { color: roofColor, surf: Surf.RoofFlat } : null });
  if (stripe !== null) {
    b.paint(stripe, Surf.Plain);
    wallQuad(b, 'pz', z1, x0, x1, h - 1.6, h - 0.6);
    wallQuad(b, 'nz', z0, x0, x1, h - 1.6, h - 0.6);
    wallQuad(b, 'px', x1, z0, z1, h - 1.6, h - 0.6);
    wallQuad(b, 'nx', x0, z0, z1, h - 1.6, h - 0.6);
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (roof === 'flat') {
    b.paint(0xa9adb0, Surf.Metal);
    b.box(x0 - 0.05, h, z0 - 0.05, x1 + 0.05, h + 0.45, z0 + 0.2, { bottom: null });
    b.box(x0 - 0.05, h, z1 - 0.2, x1 + 0.05, h + 0.45, z1 + 0.05, { bottom: null });
    b.box(x0 - 0.05, h, z0 + 0.2, x0 + 0.2, h + 0.45, z1 - 0.2, { bottom: null, pz: null, nz: null });
    b.box(x1 - 0.2, h, z0 + 0.2, x1 + 0.05, h + 0.45, z1 - 0.2, { bottom: null, pz: null, nz: null });
  } else if (roof === 'gable') {
    b.paint(roofColor, Surf.Metal).gableRoof(cx, cz, x1 - x0, z1 - z0, h, Math.min(2.2, (z1 - z0) * 0.08), 'x', 0.35, { color: wall, surf });
  } else if (roof === 'barrel') {
    b.paint(roofColor, Surf.Metal);
    barrelRoof(b, cx, cz, x1 - x0, z1 - z0, h, (z1 - z0) * 0.14, 6, wall);
  }
}

/** Row of skylights on a flat roof. */
function skylights(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, n: number): void {
  b.paint(0x9fb4c0, Surf.GlassCurtain, 5);
  const step = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const z = z0 + step * (i + 0.5);
    b.box(x0, y, z - 0.9, x1, y + 0.35, z + 0.9, { bottom: null });
  }
}

function logo(b: ModelBuilder, face: Face, plane: number, a: number, y: number, c1: ColorLike, c2: ColorLike): void {
  b.paint(c1, Surf.Plain);
  wallDisc(b, face, plane, a, y, 1.6, 10, 0.05);
  b.paint(c2, Surf.Plain);
  wallDisc(b, face, plane, a + 0.3, y + 0.2, 0.9, 8, 0.08);
}

function frontStrip(b: ModelBuilder, rng: RNG, x0: number, x1: number, z0: number, z1: number, trees: number): void {
  b.paint(GRASS, Surf.Foliage);
  flat(b, x0, z0, x1, z1, 0.07);
  if (z1 - z0 < 4) {
    // too narrow for trees: clipped hedge segments
    for (let i = 0; i < trees; i++) {
      const cx = x0 + ((x1 - x0) * (i + 0.5)) / trees, hw = Math.min(3.5, (x1 - x0) / trees / 2 - 0.6);
      b.paint(0x3f6b2e, Surf.Foliage).box(cx - hw, 0, z0 + 0.4, cx + hw, 1.1, z1 - 0.4, { bottom: null });
    }
    return;
  }
  for (let i = 0; i < trees; i++) tree(b, rng, x0 + ((x1 - x0) * (i + 0.5)) / trees, (z0 + z1) / 2, 6.5, Math.min(2.4, (z1 - z0) * 0.4));
}

// ------------------------------------------------------------------------------------------------ ind_warehouse
function warehouse(b: ModelBuilder, v: number, rng: RNG): void {
  const HX = 24, HZ = 16;
  ground(b, -HX, -HZ, HX, HZ, APRON, Surf.Pavement, 0.05);
  switch (v) {
    case 0: {
      // white + blue, flat roof with skylights, side docks on +X with 3 semis, glass office front-left
      const x0 = -22.5, x1 = 2, z0 = -14.5, z1 = 11;
      shell(b, x0, z0, x1, z1, 11, 0xe6e8e8, 0x2e6fb5, 'flat');
      skylights(b, x0 + 2, z0 + 2, x1 - 2, z1 - 2, 11, 4);
      roofUnit(b, -4, 11, -10, 2.4, 3.2, 1.6);
      roofUnit(b, -16, 11, 6, 2.4, 3.2, 1.6);
      logo(b, 'pz', z1, x1 - 4, 7.2, 0x2e6fb5, 0xe6e8e8);
      b.paint(0x2a3440, Surf.GlassCurtain, 0, 3.3);
      b.box(x0, 0, z1, x0 + 10, 6.6, z1 + 0.6, { top: { color: 0xd8d8d4, surf: Surf.Plain } });
      const cz = docks(b, 'px', x1, z0 + 1, z1 - 2, 5, 0x2e6fb5);
      b.paint(ASPHALT, Surf.Pavement);
      flat(b, x1, z0, HX - 0.5, z1, 0.07);
      for (let i = 0; i < 3; i++) semi(b, x1 + 8.4, cz[i * 2], Math.PI * 0.5, rng.pick(TRUCK_COLORS), rng.pick([0xf2f2ee, 0xd8d8d0, 0x2e6fb5]), { stripe: 0x2e6fb5, tractor: i !== 1 });
      frontStrip(b, rng, x0, x1, z1 + 1.2, HZ - 0.4, 0);
      for (let i = 0; i < 4; i++) carLow(b, x0 + 13 + i * 2.7, 13.6, 0, rng.pick(CAR_COLORS2));
      floodLight(b, HX - 1, -HZ + 1, 9);
      break;
    }
    case 1: {
      // grey + red, low gable roof, 7 front docks with parked trailers
      const x0 = -22.5, x1 = 22.5, z0 = -14.5, z1 = -2.5;
      shell(b, x0, z0, x1, z1, 11.5, 0xb9bcbf, 0xc0392b, 'gable', 0x9ea3a8);
      const cx = docks(b, 'pz', z1, x0 + 8, x1 - 1, 7, 0x6a6e72);
      b.paint(0x2a3440, Surf.GlassPlain);
      wallRow(b, 'pz', z1, x0 + 0.8, x0 + 7, 1.2, 2.6, 2, 2.2);
      wallRow(b, 'pz', z1, x0 + 0.8, x0 + 7, 4.4, 5.8, 2, 2.2);
      signBox(b, x0 + 1, 8.2, z1, x0 + 7, 9.8, z1 + 0.25, 0xc0392b, 0xf2f2ee);
      b.paint(ASPHALT, Surf.Pavement);
      flat(b, x0, z1, x1, 13.2, 0.07);
      for (let i = 0; i < cx.length; i++) {
        if (rng.chance(0.25)) continue;
        semi(b, cx[i], z1 + 8.3, 0, 0x2b2d31, rng.pick([0xf2f2ee, 0xe8e6de, 0xc0392b, 0xd8d8d0]), { tractor: i === 3, stripe: rng.chance(0.4) ? 0xc0392b : undefined });
      }
      fenceRect(b, -HX + 0.4, -HZ + 0.4, HX - 0.4, HZ - 0.4, 2.2, 0x8a9096, [-8, 8], 8, 1);
      b.paint(GRASS, Surf.Foliage);
      flat(b, -HX, 13.6, HX, HZ, 0.08);
      break;
    }
    case 2: {
      // cream + green, barrel-vault roof, side docks with box trucks
      const x0 = -22.5, x1 = 5, z0 = -14.5, z1 = 9.5;
      shell(b, x0, z0, x1, z1, 9.5, 0xd8d2c0, 0x2e7d4f, 'barrel', 0xc5c9cc);
      const cz = docks(b, 'px', x1, z0 + 1, z1 - 1, 4, 0x2e7d4f);
      logo(b, 'pz', z1, x0 + 5, 6.5, 0x2e7d4f, 0xd8d2c0);
      b.paint(0x2a3440, Surf.GlassPlain);
      wallQuad(b, 'pz', z1, x0 + 9, x0 + 12, 0.1, 2.8);
      wallRow(b, 'pz', z1, x0 + 13, x1 - 2, 1.4, 3.0, 4, 2.4);
      b.paint(ASPHALT, Surf.Pavement);
      flat(b, x1, z0, HX - 0.5, HZ - 0.5, 0.07);
      for (let i = 0; i < 3; i++) boxTruck(b, x1 + 4.6, cz[i], Math.PI * 0.5, 0xf2f2ee, rng.pick([0x2e7d4f, 0xf2f2ee, 0xd8d2c0]));
      semi(b, 14, 12.5, -Math.PI * 0.5, 0x2e7d4f, 0xf2f2ee, { stripe: 0x2e7d4f });
      frontStrip(b, rng, x0, x1 - 1, z1 + 1, HZ - 0.4, 3);
      for (let i = 0; i < 4; i++) pallets(b, x1 + 1.5, z0 + 1.5 + i * 1.4, rng.range(0.5, 1.5));
      break;
    }
    case 3: {
      // modern logistics: dark grey + orange, tall, glass office corner box, front docks w/ shelters
      const x0 = -22.5, x1 = 22.5, z0 = -14.5, z1 = -1.5;
      shell(b, x0, z0, x1, z1, 13, 0x55595e, 0xe67e22, 'flat', 0x9a9ea2);
      skylights(b, x0 + 4, z0 + 1.5, x1 - 4, z1 - 1.5, 13, 3);
      // office box: 2 floors glass w/ orange frame
      b.paint(0x2a3440, Surf.GlassCurtain, 3, 3.6).box(x0, 0, z1, x0 + 11, 7.4, z1 + 3, { top: { color: 0xe67e22, surf: Surf.Plain } });
      b.paint(0xe67e22, Surf.Plain).box(x0 - 0.1, 7.4, z1 - 0.1, x0 + 11.1, 8.0, z1 + 3.1);
      const cx = docks(b, 'pz', z1, x0 + 13, x1 - 1, 6, 0x2b2d31, 0xe67e22);
      b.paint(0x1c1e20, Surf.Plain);
      for (const c of cx) b.box(c - 1.9, 0.9, z1, c + 1.9, 5.0, z1 + 0.6, { bottom: null, nz: null });
      b.paint(ASPHALT, Surf.Pavement);
      flat(b, x0, z1 + 3, x1, 14.5, 0.07);
      semi(b, cx[1], z1 + 8.3, 0, 0xe67e22, 0xf2f2ee, { stripe: 0xe67e22 });
      semi(b, cx[4], z1 + 8.3, 0, 0x2b2d31, 0xf2f2ee, { tractor: false, stripe: 0xe67e22 });
      for (let i = 0; i < 5; i++) carLow(b, x0 + 1.5 + i * 2.7, 9.8, Math.PI, rng.pick(CAR_COLORS2));
      signBox(b, x1 - 12, 10.2, z1, x1 - 2, 12.2, z1 + 0.3, 0xe67e22, 0x2b2d31);
      b.paint(GRASS, Surf.Foliage);
      flat(b, -HX, 14.8, HX, HZ, 0.08);
      floodLight(b, -8, 13.5, 9);
      floodLight(b, 12, 13.5, 9);
      break;
    }
    case 4: {
      // multi-tenant units: brick base + corrugated upper, 4 units w/ roll-up doors & colored signs
      const x0 = -22.5, x1 = 22.5, z0 = -14.5, z1 = 3;
      b.paint(0xa36a4a, Surf.Brick).box(x0, 0, z0, x1, 3.2, z1, { top: null });
      b.paint(0xd4d0c4, Surf.Corrugated).box(x0, 3.2, z0, x1, 10, z1, { bottom: null, top: null });
      b.paint(0xa9adb0, Surf.Metal).sawtoothRoof(0, (z0 + z1) / 2, x1 - x0, z1 - z0, 10, 1.8, 4, { color: 0x9fb4c0, surf: Surf.GlassCurtain, pattern: 5, floor: 1.0 });
      const cols = [0xc0392b, 0x2e6fb5, 0xf1c40f, 0x2e7d4f];
      for (let i = 0; i < 4; i++) {
        const ux0 = x0 + i * 11.25;
        b.paint(0x8a4a36, Surf.Plain);
        if (i > 0) wallQuad(b, 'pz', z1, ux0 - 0.2, ux0 + 0.2, 0, 10);
        b.paint(0xc8ccd0, Surf.Corrugated);
        wallQuad(b, 'pz', z1, ux0 + 1.2, ux0 + 5.6, 0, 4.4);
        b.paint(0x2a3440, Surf.GlassPlain);
        wallQuad(b, 'pz', z1, ux0 + 6.6, ux0 + 8.0, 0, 2.4);
        wallQuad(b, 'pz', z1, ux0 + 8.4, ux0 + 10.4, 1.0, 2.4);
        signBox(b, ux0 + 6.4, 5.0, z1, ux0 + 10.6, 6.2, z1 + 0.2, cols[i], 0xf2f2ee);
        b.paint(cols[i], Surf.Plain);
        wallQuad(b, 'pz', z1, ux0 + 1.2, ux0 + 5.6, 4.4, 4.8);
      }
      b.paint(ASPHALT, Surf.Pavement);
      flat(b, x0, z1, x1, 13.5, 0.07);
      for (let i = 0; i < 4; i++) {
        const ux0 = x0 + i * 11.25;
        if (rng.chance(0.7)) boxTruck(b, ux0 + 3.4, z1 + 4.3, 0, 0xf2f2ee, rng.pick([0xf2f2ee, cols[i]]));
        carLow(b, ux0 + 8.2, z1 + 3.4, Math.PI, rng.pick(CAR_COLORS2));
        if (rng.chance(0.6)) carLow(b, ux0 + 10.4, z1 + 3.6, Math.PI, rng.pick(CAR_COLORS2));
      }
      frontStrip(b, rng, -HX, HX, 13.8, HZ - 0.3, 5);
      break;
    }
    default: {
      // cold storage: tall white insulated box, rooftop condensers, reefers at front docks, engine room
      const x0 = -22.5, x1 = 16, z0 = -14.5, z1 = -0.6;
      shell(b, x0, z0, x1, z1, 14, 0xf2f2ee, 0x3f7fd0, 'flat', 0xc5c9cc, Surf.Plain);
      b.paint(0x3f7fd0, Surf.Plain);
      wallQuad(b, 'pz', z1, x0, x1, 0, 0.9);
      for (let i = 0; i < 8; i++) roofUnit(b, x0 + 3 + (i % 4) * 9, 14, -11 + Math.floor(i / 4) * 7, 3.2, 2.0, 1.4, 0xd8dadc);
      logo(b, 'pz', z1, x1 - 5, 10.5, 0x3f7fd0, 0xf2f2ee);
      const cx = docks(b, 'pz', z1, x0 + 1, x1 - 9, 5, 0x3f7fd0, 0xf2f2ee);
      // engine room + piping
      b.paint(0xb9bcbf, Surf.Corrugated).box(x1, 0, z0 + 2, 22.5, 6, z0 + 12);
      b.paint(0x9aa0a6, Surf.Metal);
      b.pipe([x1 + 1, 6.4, z0 + 4], [x1 + 1, 6.4, z0 + 10], 0.3, 6);
      b.pipe([x1, 6.4, z0 + 4], [x1 + 4, 6.4, z0 + 4], 0.3, 6);
      tank(b, 19.5, z0 + 15, 1.3, 5.5, 0xe8e8e2, { roof: 'dome', seg: 8 });
      b.paint(ASPHALT, Surf.Pavement);
      flat(b, x0, z1, HX - 0.5, 14, 0.07);
      for (let i = 0; i < cx.length; i++) {
        if (i === 2) continue;
        semi(b, cx[i], z1 + 8.3, 0, 0x2b2d31, 0xf6f6f2, { tractor: i === 0 || i === 3, stripe: 0x3f7fd0 });
        if (!(i === 0 || i === 3)) b.paint(0x9aa0a6, Surf.Metal).boxC(cx[i], z1 + 13.3, 2.2, 0.9, 1.9, 1.8);
      }
      b.paint(GRASS, Surf.Foliage);
      flat(b, -HX, 14.3, HX, HZ, 0.08);
      break;
    }
  }
}

// ------------------------------------------------------------------------------------------------ ind_assembly_plant
function assembly(b: ModelBuilder, v: number, rng: RNG): void {
  const HX = 32, HZ = 24;
  ground(b, -HX, -HZ, HX, HZ, APRON, Surf.Pavement, 0.05);
  switch (v) {
    case 0: {
      // CAR PLANT: white saw-tooth main shed, paint shop with stacks, office front, finished-car lot, parking
      const x0 = -30.5, x1 = 16, z0 = -22.5, z1 = 6;
      b.paint(0xe6e8e8, Surf.Corrugated).box(x0, 0, z0, x1, 12, z1, { top: null });
      b.paint(0xb9bcbf, Surf.Metal).sawtoothRoof((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 12, 3, 7, { color: 0x9fb4c0, surf: Surf.GlassCurtain, pattern: 5, floor: 1.0 });
      b.paint(0x2e6fb5, Surf.Plain);
      wallQuad(b, 'pz', z1, x0, x1, 9.8, 10.8);
      wallQuad(b, 'px', x1, z0, z1, 9.8, 10.8);
      docks(b, 'px', x1, z0 + 2, z0 + 14, 3, 0x2e6fb5);
      // paint shop (taller block) + stacks
      b.paint(0xd8dadc, Surf.Plain).box(-6, 0, -22.5, 10, 17, -12, { top: { color: 0x9a9ea2, surf: Surf.RoofFlat } });
      for (let i = 0; i < 3; i++) roofUnit(b, -3 + i * 5, 17, -17, 3, 3.6, 2.0);
      smokestack(b, 7, -20, 24, 0.7, 0.6, 'steel', 8, { light: false });
      smokestack(b, 7, -15, 24, 0.7, 0.6, 'steel', 8, { light: false });
      // office front
      officeBlock(b, -30.5, 7.5, -12, 15.5, 11, 0xdfe3e6, 2, 3.6);
      logo(b, 'pz', 15.5, -26, 8.5, 0x2e6fb5, 0xdfe3e6);
      // finished car lot (right side)
      b.paint(ASPHALT, Surf.Pavement);
      flat(b, 18, -22.5, 31, 6, 0.07);
      const cc = [0xc0392b, 0xf1f1ef, 0x2b2d31, 0x1f3f7a, 0xb8bcc2];
      for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) carLow(b, 20 + r * 3.1, -20.5 + i * 4.8, 0, cc[(r + i) % cc.length]);
      semi(b, 25, 15, -Math.PI * 0.5, 0x2b2d31, null, { tractor: true });
      b.paint(0x8a9096, Surf.Metal).box(10, 1.0, 13.8, 22, 1.3, 16.2); // car carrier deck
      for (let i = 0; i < 3; i++) carLow(b, 12 + i * 4.2, 15, Math.PI * 0.5, cc[i], 1.3);
      // staff parking
      parking(b, rng, -10, 7.5, 8, 22.5, 0.7, 14);
      frontStrip(b, rng, -30.5, -12, 17, HZ - 0.5, 3);
      break;
    }
    case 1: {
      // HEAVY MANUFACTURING: high-bay hall with big door + outdoor crane runway, annex, parking
      const x0 = -30.5, x1 = 12, z0 = -22.5, z1 = 4;
      b.paint(0x7f8c9a, Surf.Corrugated).box(x0, 0, z0, x1, 17, z1);
      b.paint(0xa9adb0, Surf.Metal).gableRoof((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 17, 2.6, 'z', 0.4, { color: 0x7f8c9a, surf: Surf.Corrugated });
      b.paint(0xd8dadc, Surf.Corrugated);
      wallQuad(b, 'px', x1, z0 + 4, z1 - 4, 0, 13);
      b.paint(0xf1c40f, Surf.Plain);
      wallQuad(b, 'px', x1, z0 + 3.4, z1 - 3.4, 13, 13.6);
      b.paint(0xe8e8e0, Surf.GlassPlain);
      wallRow(b, 'pz', z1, x0 + 1, x1 - 1, 12, 15, 8, 3.2);
      // annex offices
      officeBlock(b, x0, z1, -12, z1 + 9, 8, 0xe8e6de, 2, 3.6);
      // crane runway outside the big door
      b.paint(0xe6a817, Surf.Metal);
      for (const z of [z0 + 5, z1 - 5]) {
        for (const x of [x1 + 5, x1 + 14]) strut(b, [x, 0, z], [x, 12, z], 0.8);
        b.box(x1, 12, z - 0.4, x1 + 15, 12.8, z + 0.4);
      }
      b.paint(0xf1c40f, Surf.Metal).box(x1 + 8, 12.8, z0 + 4.2, x1 + 9.2, 14, z1 - 4.2);
      b.paint(0x333333, Surf.Metal).boxC(x1 + 8.6, -9, 1.6, 1.6, 11.6, 1.2);
      strut(b, [x1 + 8.6, 11.6, -9], [x1 + 8.6, 4, -9], 0.08);
      // big fabricated parts on the yard
      b.paint(0x2e6fb5, Surf.Metal);
      hCyl(b, x1 + 9, 2.2, -4, 12, 2.1, 'x', 10);
      b.paint(0x6a6e72, Surf.Metal).box(x1 + 4, 0, -19, x1 + 14, 2.4, -14);
      b.paint(ASPHALT, Surf.Pavement);
      flat(b, x1, z0, HX - 0.5, z1, 0.07);
      parking(b, rng, -10, 7, 30, 22.5, 0.6, 16);
      semi(b, 22, 1, Math.PI * 0.5, 0x2b2d31, null, { tractor: true });
      b.paint(0x55595e, Surf.Metal).box(10, 0.05, 0, 19, 1.3, 2.2, { bottom: null });
      frontStrip(b, rng, -30.5, -12, 14, HZ - 0.5, 3);
      break;
    }
    case 2: {
      // ELECTRONICS / APPLIANCES: two parallel white/blue sheds linked by a bridge, roof units, side docks
      const cols: [number, number][] = [[-22.5, -9], [-5, 8.5]];
      for (const [z0, z1] of cols) {
        shell(b, -30.5, z0, 18, z1, 12, 0xeceeee, 0x1f5fa8, 'flat', 0xb4b8bc, Surf.Plain);
        b.paint(0x1f5fa8, Surf.Plain);
        wallQuad(b, 'pz', z1, -30.5, 18, 0, 1.2);
        for (let i = 0; i < 4; i++) roofUnit(b, -26 + i * 11, 12, (z0 + z1) / 2, 3, 3.6, 1.8);
        b.paint(0x9fb4c0, Surf.GlassCurtain, 5);
        b.box(-28, 12, (z0 + z1) / 2 - 0.8 - 4, 14, 12.35, (z0 + z1) / 2 + 0.8 - 4, { bottom: null });
      }
      // bridge
      b.paint(0x2a3440, Surf.GlassCurtain, 0, 3).box(-8, 5, -9, -2, 9, -5, { top: { color: 0x9a9ea2, surf: Surf.RoofFlat } });
      docks(b, 'px', 18, -22, -10, 3, 0x1f5fa8);
      docks(b, 'px', 18, -4.5, 8, 3, 0x1f5fa8);
      b.paint(ASPHALT, Surf.Pavement);
      flat(b, 18, -22.5, HX - 0.5, 8.5, 0.07);
      for (const z of [-19, -13, -1.5, 4.5]) boxTruck(b, 22.6, z, Math.PI * 0.5, 0xf2f2ee, z < -10 ? 0x1f5fa8 : 0xf2f2ee);
      semi(b, 29, -6, 0, 0x1f5fa8, 0xf2f2ee, { stripe: 0x1f5fa8 });
      // glass entrance lobby at front
      b.paint(0x2a3440, Surf.GlassCurtain, 5, 3.6).box(-26, 0, 8.5, -14, 7.2, 12, { top: { color: 0xd8d8d4, surf: Surf.Plain } });
      signBox(b, -25, 7.4, 11.6, -15, 9.0, 12, 0x1f5fa8, 0xf2f2ee);
      parking(b, rng, -10, 10, 30, 22.5, 0.65, 16);
      frontStrip(b, rng, -30.5, -11, 13.5, HZ - 0.5, 3);
      break;
    }
    default: {
      // FOOD / BREWERY: brick office + production shed + row of stainless fermentation tanks + malt silos
      const x0 = -30.5, x1 = 6, z0 = -22.5, z1 = 2;
      b.paint(0xe0d8c4, Surf.WallWindows, 4, 5).box(x0, 0, z0, x1, 12, z1);
      b.paint(0x8a4a36, Surf.RoofTiles).gableRoof((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 12, 3.2, 'x', 0.4, { color: 0xe0d8c4, surf: Surf.Plain });
      b.paint(0x2e5f3a, Surf.Plain);
      wallQuad(b, 'pz', z1, x0, x1, 9.8, 10.8);
      // brewhouse brick with tall glass front
      b.paint(0x9c4a36, Surf.Brick).box(-30.5, 0, 3.5, -12, 14, 15);
      b.paint(0x2a3440, Surf.GlassPlain);
      wallRow(b, 'pz', 15, -30, -12.5, 1.2, 12, 4, 3.0);
      b.paint(0x5c5f63, Surf.RoofTiles).gableRoof(-21.25, 9.25, 18.5, 11.5, 14, 3, 'x', 0.3, { color: 0x9c4a36, surf: Surf.Brick });
      smokestack(b, -14.5, 5.5, 22, 0.8, 0.65, 'brick', 8, { light: false });
      // fermentation tanks (two rows)
      for (let r = 0; r < 2; r++)
        for (let i = 0; i < 5; i++) {
          const x = 9.5 + i * 4.6, z = -20 + r * 5.2;
          b.paint(0xc8ccd0, Surf.Metal);
          tube(b, x, z, 2.2, 13, 1.9, 1.9, 10);
          dome(b, x, z, 15.2, 1.9, 0.9, 10, 1);
          b.paint(0xc8ccd0, Surf.Metal);
          lattice(b, x, z, 0, 2.2, 1.4, 1.2, 1.4, 1.2, 1, 0.12, { rings: false, diag: false });
        }
      b.paint(0x9aa0a6, Surf.Metal);
      b.pipe([8, 15.5, -17.4], [30, 15.5, -17.4], 0.3, 6);
      // malt silos
      for (let i = 0; i < 3; i++) tank(b, 11 + i * 5.2, -5, 2.2, 16, 0xd8d8d2, { roof: 'cone', seg: 10 });
      b.paint(ASPHALT, Surf.Pavement);
      flat(b, 7, 0, HX - 0.5, 16, 0.07);
      semi(b, 22, 4, Math.PI * 0.5, 0x2e5f3a, 0xe8e2cf, { stripe: 0x2e5f3a });
      boxTruck(b, 12, 12, Math.PI * 0.5, 0xf2f2ee, 0x2e5f3a);
      parking(b, rng, -10, 5, 6, 22.5, 0.6, 10);
      frontStrip(b, rng, 8, 31, 17, HZ - 0.5, 4);
      frontStrip(b, rng, -30.5, -11, 16.5, HZ - 0.5, 3);
      break;
    }
  }
}

// ------------------------------------------------------------------------------------------------ ind_depot
function containerStack(b: ModelBuilder, rng: RNG, x: number, z: number, rows: number, tiers: number, alongZ = false, long = true): void {
  const L = long ? 12.2 : 6.1;
  for (let r = 0; r < rows; r++) {
    const h = rng.int(1, tiers);
    for (let t = 0; t < h; t++) {
      const cx = alongZ ? x + r * 2.55 : x;
      const cz = alongZ ? z : z + r * 2.55;
      containerAt(b, cx, 0.05 + t * 2.6, cz, long, rng.pick(CONTAINER_COLORS), alongZ);
    }
  }
}

/** Rubber-tyred gantry crane spanning along X over [x0,x1] at z (legs at z±d/2). */
function rtg(b: ModelBuilder, x0: number, x1: number, z: number, d: number, h: number, color: ColorLike = 0xe6a817): void {
  b.paint(color, Surf.Metal);
  for (const x of [x0, x1]) {
    strut(b, [x, 0.8, z - d / 2], [x, h, z - d / 2], 0.7);
    strut(b, [x, 0.8, z + d / 2], [x, h, z + d / 2], 0.7);
    b.box(x - 0.5, 0, z - d / 2 - 0.8, x + 0.5, 0.9, z + d / 2 + 0.8);
    b.box(x - 0.4, h * 0.45, z - d / 2, x + 0.4, h * 0.45 + 0.6, z + d / 2, { bottom: null });
  }
  b.box(x0 - 0.6, h, z - d / 2 - 0.6, x1 + 0.6, h + 1.2, z - d / 2 + 0.6);
  b.box(x0 - 0.6, h, z + d / 2 - 0.6, x1 + 0.6, h + 1.2, z + d / 2 + 0.6);
  b.paint(0xd8dadc, Surf.Metal).box(x0 + (x1 - x0) * 0.35, h + 1.2, z - d / 2 - 0.4, x0 + (x1 - x0) * 0.35 + 3, h + 2.6, z + d / 2 + 0.4);
  b.paint(0x2b2d31, Surf.Metal).box(x0 + (x1 - x0) * 0.35 + 0.5, h - 1.8, z - 1.3, x0 + (x1 - x0) * 0.35 + 2.5, h - 1.2, z + 1.3);
}

function depot(b: ModelBuilder, v: number, rng: RNG): void {
  const H = 16;
  ground(b, -H, -H, H, H, 0x8a867e, Surf.Pavement, 0.05);
  switch (v) {
    case 0: {
      // container yard with RTG gantry over the stacks
      for (let i = 0; i < 2; i++) containerStack(b, rng, -8 + i * 13.3, -12.5, 4, 4, false, true);
      for (let i = 0; i < 2; i++) containerStack(b, rng, -8 + i * 13.3, -1, 3, 3, false, true);
      rtg(b, -15, 15, -8.7, 12.5, 12.5);
      b.paint(0xe9e7e0, Surf.Plain).box(10, 0, 8.5, 15, 3, 12);
      b.paint(0x2a3440, Surf.GlassPlain);
      wallRow(b, 'pz', 12, 10.3, 14.7, 1.2, 2.4, 2, 1.6);
      semi(b, -3, 9, Math.PI * 0.5, 0x2e6fb5, null, { tractor: true });
      containerAt(b, -5.5, 1.3, 9, true, rng.pick(CONTAINER_COLORS));
      b.paint(0x2b2d31, Surf.Metal).box(-12, 0.05, 8, 1.5, 1.3, 10, { bottom: null, top: null });
      semi(b, -2, 13.5, -Math.PI * 0.5, 0xc0392b, null, { tractor: true });
      floodLight(b, 15, -15, 13);
      floodLight(b, -15, 5.5, 13);
      fenceRect(b, -15.6, -15.6, 15.6, 15.6, 2.2, 0x8a9096, [-12, 8], 6, 1);
      break;
    }
    case 1: {
      // truck cross-dock terminal: long narrow shed with docks both sides + trucks + fuel island
      const x0 = -15, x1 = 15, z0 = -6, z1 = 2;
      shell(b, x0, z0, x1, z1, 7, 0xe6e8e8, 0xd35400, 'flat', 0xb4b8bc);
      b.paint(0x2a2d30, Surf.Plain).box(x0 - 0.1, 6.2, z1, x1 + 0.1, 6.5, z1 + 1.4).box(x0 - 0.1, 6.2, z0 - 1.4, x1 + 0.1, 6.5, z0);
      docks(b, 'pz', z1, x0 + 1, x1 - 1, 6, 0xd35400);
      docks(b, 'nz', z0, x0 + 1, x1 - 1, 6, 0xd35400);
      b.paint(ASPHALT, Surf.Pavement);
      flat(b, -H + 0.3, z1, H - 0.3, 15.5, 0.07);
      flat(b, -H + 0.3, -15.7, H - 0.3, z0, 0.07);
      for (let i = 0; i < 6; i++) {
        const cx = x0 + 1 + (28 / 6) * (i + 0.5);
        if (i % 2 === 0) boxTruck(b, cx, z1 + 4.2, 0, 0xf2f2ee, rng.pick([0xd35400, 0xf2f2ee]));
        if (i % 3 !== 1) boxTruck(b, cx, z0 - 4.2, Math.PI, 0xf2f2ee, rng.pick([0xd35400, 0xf2f2ee, 0x2b2d31]));
      }
      // fuel island canopy
      b.paint(0xf2f2ee, Surf.Plain).box(-12, 4.2, 9.5, -4, 4.8, 14);
      b.paint(0xd35400, Surf.Plain);
      wallQuad(b, 'pz', 14, -12, -4, 4.2, 4.8);
      b.paint(0x8a9096, Surf.Metal);
      strut(b, [-11, 0, 11.7], [-11, 4.2, 11.7], 0.35);
      strut(b, [-5, 0, 11.7], [-5, 4.2, 11.7], 0.35);
      b.paint(0x55595e, Surf.Metal).boxC(-8, 11.7, 1, 0.6, 0, 1.6);
      semi(b, 6, 11.5, Math.PI * 0.5, 0x2b2d31, 0xf2f2ee, { stripe: 0xd35400 });
      forklift(b, 14, -10, Math.PI * 0.5);
      break;
    }
    default: {
      // container depot with reach stacker, empties stacks (short boxes), office cabins, wash bay
      for (let i = 0; i < 3; i++) containerStack(b, rng, -9.5 + i * 13.5 - (i === 2 ? 8.2 : 0), -13, 3, 3, false, i !== 2);
      containerStack(b, rng, -14, -2, 5, 2, true, false);
      containerStack(b, rng, 12.5, -1.5, 2, 4, true, false);
      // reach stacker
      b.push().translate(2, 0, 1).rotateY(-0.4);
      b.paint(0xc0392b, Surf.Metal).box(-1.6, 0.4, -3.5, 1.6, 2.2, 3.5);
      b.paint(0x1c1c1c, Surf.Plain);
      hCyl(b, 0, 0.8, 2.5, 3.6, 0.8, 'x', 6);
      hCyl(b, 0, 0.8, -2.5, 3.6, 0.8, 'x', 6);
      b.paint(0x2a3138, Surf.Metal).box(-1.5, 2.2, -0.5, -0.2, 4.2, 1.2, { top: { color: 0xc0392b, surf: Surf.Metal } });
      b.paint(0xc0392b, Surf.Metal);
      strut(b, [0.6, 2.4, -3], [0.6, 9.5, 5.5], 0.9);
      b.paint(0xf1c40f, Surf.Metal).box(-2.6, 8.4, 5.2, 2.6, 9.4, 6.4);
      containerAt(b, 0, 6.0, 5.8, false, 0x2e6fb5);
      b.pop();
      // office cabins stacked
      b.paint(0xe9e7e0, Surf.Plain).box(8, 0.2, 9, 14.8, 2.9, 11.6).box(8, 2.9, 9, 14.8, 5.6, 11.6);
      b.paint(0x2a3440, Surf.GlassPlain);
      wallRow(b, 'pz', 11.6, 8.3, 14.5, 1.2, 2.3, 3, 1.3);
      wallRow(b, 'pz', 11.6, 8.3, 14.5, 3.9, 5.0, 3, 1.3);
      b.paint(0x55595e, Surf.Metal);
      strut(b, [7.6, 0, 11.2], [7.6, 5.6, 9.4], 0.2);
      semi(b, -6, 11, Math.PI * 0.5, 0x2b2d31, null, { tractor: true });
      containerAt(b, -8.5, 1.3, 11, true, rng.pick(CONTAINER_COLORS));
      b.paint(0x2b2d31, Surf.Metal).box(-15, 0.05, 10, -1.5, 1.3, 12, { bottom: null, top: null });
      floodLight(b, 15, -15, 12);
      fenceRect(b, -15.6, -15.6, 15.6, 15.6, 2.2, 0x8a9096, [-15.6, 6], 6, 1);
      break;
    }
  }
}


export const manuModels: ModelBuilders = {
  ind_warehouse: (b, v, rng) => warehouse(b, v, rng),
  ind_assembly_plant: (b, v, rng) => assembly(b, v, rng),
  ind_depot: (b, v, rng) => depot(b, v, rng),
};
