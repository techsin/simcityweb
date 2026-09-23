/**
 * Industrial / DIRTY industry models: ind_workshop, ind_scrapyard, ind_smokestack_factory, ind_refinery.
 */
import type { ModelBuilders } from '../registry';
import type { ModelBuilder, ColorLike } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { signBox } from '../kit';
import {
  type V3, flat, ground, wallQuad, wallRow, tube, disc, cone, dome, lathe, hCyl, strut, lattice, pipeRun, conveyor,
  tank, sphereTank, smokestack, semi, boxTruck, carLow, forklift, pallets, drums, heap, fenceRect, wallRun,
  floodLight, roofUnit, parapet, officeBlock, emitSmoke, emitSteam, lights, CAR_COLORS2, orientedBox,
  pool, poolRect, lightDot, Y_OVER, Y_MARK, RESET_PAINT, SODIUM, stairLights,
} from './ind_kit';

const YARD = 0x9f9a90;
const WS_YARD = 0x76716a;
const YARD_DARK = 0x7f7a72;
const RUST = [0x7a4f36, 0x6a4632, 0x8b5a3a, 0x5e4a3c, 0x7a6048];

/** Irregular dark oil stains (6-gon fans) stacked >= 6 mm apart above the markings layer. */
function oilStains(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const x = rng.range(x0, x1), z = rng.range(z0, z1), r = rng.range(0.6, 1.6);
    b.paint(rng.pick([0x3e3c3a, 0x46433f, 0x4e4a45]), Surf.Pavement);
    const y = Y_MARK + i * 0.006;
    const pts: V3[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rng.next() * 0.5;
      const rr = r * rng.range(0.6, 1.2);
      pts.push([x + Math.cos(a) * rr, y, z + Math.sin(a) * rr * 0.8]);
    }
    for (let k = 0; k < 6; k++) b.tri([x, y, z], pts[(k + 1) % 6], pts[k]);
  }
}

/** Patched asphalt areas on a grimy yard. */
function asphaltPatches(b: ModelBuilder, rects: [number, number, number, number][]): void {
  b.paint(0x55565a, Surf.Pavement);
  for (const [x0, z0, x1, z1] of rects) flat(b, x0, z0, x1, z1, Y_OVER);
}

/** Junk along a fence line: engine blocks, pallets, tyres (cheap boxes). */
function fenceJunk(b: ModelBuilder, rng: RNG, x0: number, x1: number, z: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * (i + rng.range(0.2, 0.8))) / n;
    const k = rng.int(0, 2);
    if (k === 0) b.paint(rng.pick([0x4a4d50, 0x5a5048, 0x3e4044]), Surf.Metal).boxC(x, z, 0.9, 0.7, 0, 0.7);
    else if (k === 1) pallets(b, x, z, rng.range(0.3, 1.3));
    else { b.paint(0x1c1c1c, Surf.Plain); tube(b, x, z, 0, rng.range(0.9, 1.8), 0.5, 0.5, 6); disc(b, x, z, 0.9, 0.5, 6); }
  }
}

/** Open scrap skip (roll-off) with rusty fill. */
function skip(b: ModelBuilder, x: number, z: number, color: ColorLike, alongX = true, fill: ColorLike = 0x5e4a3c): void {
  const w = alongX ? 4.8 : 2.4, d = alongX ? 2.4 : 4.8;
  b.paint(color, Surf.Metal, 1).boxC(x, z, w, d, 0, 1.6, { top: null });
  b.paint(fill, Surf.Plain);
  flat(b, x - w / 2 + 0.1, z - d / 2 + 0.1, x + w / 2 - 0.1, z + d / 2 - 0.1, 1.3);
}

/** Tyre stack column. */
function tyres(b: ModelBuilder, x: number, z: number, h: number): void {
  b.paint(0x1c1c1c, Surf.Plain);
  tube(b, x, z, 0, h, 0.5, 0.5, 6);
  b.paint(0x0e0e0e, Surf.Plain);
  disc(b, x, z, h, 0.5, 6);
}

/** Surface height of heap() at normalized radius d (0..1). */
function heapY(h: number, d: number): number {
  return d <= 0.55 ? h * (1 - 0.509 * d) : Math.max(0, 0.72 * h * (1 - (d - 0.55) / 0.45));
}

/** Scrap heap: layered jagged mounds + debris boxes on the surface + protruding beams. */
function scrapHeap(b: ModelBuilder, rng: RNG, x: number, z: number, r: number, h: number, base: ColorLike, n = 14, sticks = 5, sx = 1, sz = 1): void {
  heap(b, rng, x, z, r, h, base, Surf.Plain, 8, sx, sz);
  const tints = [0x6a4a36, 0x55504a, 0x7a5a42, 0x4a4540, 0x6e6258];
  const subs = r > 4 ? 3 : 1;
  for (let i = 0; i < subs; i++) {
    const a = rng.next() * Math.PI * 2, d = rng.range(0.35, 0.55);
    heap(b, rng, x + Math.cos(a) * r * d * sx, z + Math.sin(a) * r * d * sz, r * 0.45, heapY(h, d) + h * 0.18, rng.pick(tints), Surf.Plain, 6);
  }
  const cols = [0x7a4f36, 0x6a4632, 0x8b5a3a, 0x5e4a3c, 0x55595e, 0x8a9096, 0x3e4a5a, 0x8a7a5a, 0x4a3a2e, 0x9a6a3a, 0x2e5f8a, 0xb0b4b8];
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * 0.9;
    const px = x + Math.cos(a) * r * d * sx, pz = z + Math.sin(a) * r * d * sz;
    const py = heapY(h, d) - 0.25;
    b.push().translate(px, py, pz).rotateY(rng.next() * 3).rotateX(rng.range(-0.6, 0.6)).rotateZ(rng.range(-0.4, 0.4));
    b.paint(rng.pick(cols), rng.chance(0.5) ? Surf.Metal : Surf.Plain);
    const w = rng.range(0.6, 2.4), dd = rng.range(0.3, 1.3), hh = rng.range(0.25, 0.9);
    b.box(-w / 2, 0, -dd / 2, w / 2, hh, dd / 2);
    b.pop();
  }
  b.paint(0x4a4540, Surf.Metal);
  for (let i = 0; i < sticks; i++) {
    const a = rng.next() * Math.PI * 2, d = rng.range(0.1, 0.7);
    const px = x + Math.cos(a) * r * d * sx, pz = z + Math.sin(a) * r * d * sz;
    const py = heapY(h, d) - 0.4;
    const a2 = rng.next() * Math.PI * 2, L = rng.range(2, 4.5);
    strut(b, [px, py, pz], [px + Math.cos(a2) * L * 0.7, py + L * 0.5, pz + Math.sin(a2) * L * 0.7], rng.range(0.12, 0.3));
  }
}

// ------------------------------------------------------------------------------------------------ ind_workshop
function workshop(b: ModelBuilder, v: number, rng: RNG): void {
  const H = 16;
  ground(b, -H, -H, H, H, WS_YARD, Surf.Pavement, 0.05);
  const clip: [number, number, number, number] = [-H, -H, H, H];
  switch (v) {
    case 0: {
      // AUTO REPAIR: block building, 3 roll-up doors, sign, cars waiting, tire stacks
      const x0 = -14.5, x1 = 6, z0 = -14.5, z1 = -3;
      b.paint(0xcfc6b0, Surf.Plain).box(x0, 0, z0, x1, 5.2, z1, { top: { color: 0x8e8b84, surf: Surf.RoofFlat } });
      parapet(b, x0, z0, x1, z1, 5.2, 0.5, 0.25, 0xb8ae98);
      b.paint(0x2f5f9a, Surf.Plain);
      wallQuad(b, 'pz', z1, x0, x1, 4.0, 5.2);
      for (let i = 0; i < 3; i++) {
        const cx = x0 + 3.2 + i * 4.8;
        if (i === 1) b.paint(0x2a2d30, Surf.GlassPlain, 2); // open bay: lit workshop interior at night
        else b.paint(0xc5c9cc, Surf.Corrugated);
        wallQuad(b, 'pz', z1, cx - 1.8, cx + 1.8, 0, 3.6);
      }
      lights(b, [[x0 + 5.6, 3.9, z1 + 0.3], [x0 + 10.4, 3.9, z1 + 0.3]], 0.25);
      carLow(b, x0 + 8, z1 - 3, 0, 0x8a1c1c);
      b.paint(0x2a3440, Surf.GlassPlain);
      wallQuad(b, 'pz', z1, x1 - 5.5, x1 - 0.8, 0.9, 3.0);
      signBox(b, x1 - 6.5, 5.6, z1 - 0.3, x1 - 0.5, 7.2, z1 - 0.1, 0xe8e2c0);
      b.paint(0xc0392b, Surf.Emissive);
      wallQuad(b, 'pz', z1 - 0.02, x1 - 6.2, x1 - 0.8, 6.0, 6.8, 0.1);
      // yard: waiting cars, tow truck, tire stacks
      for (let i = 0; i < 5; i++) carLow(b, -12 + i * 3.2, 5 + (i % 2) * 0.5, Math.PI + rng.range(-0.1, 0.1), rng.pick(CAR_COLORS2));
      boxTruck(b, 11, -6, 0, 0xf1c40f, 0x2b2d31);
      for (let i = 0; i < 6; i++) tyres(b, 8.6 + (i % 3) * 1.1, -12.9 + Math.floor(i / 3) * 1.1, rng.range(1.0, 2.1));
      drums(b, rng, 12.5, -13.5, 3, 2, [0x2e6fb5, 0xb03a2e, 0x3d3f42]);
      b.paint(0x3e6b3e, Surf.Metal, 1).box(1, 0, -16 + 0.8, 4.5, 1.6, -16 + 2.6); // dumpster
      skip(b, 13.2, 2.5, 0x2e6fb5, false);
      fenceRect(b, -15.5, -15.5, 15.5, 15.5, 2.0, 0x8a9096, [-15.5, 15.5], 4.5, 2);
      asphaltPatches(b, [[-13, 1.5, -4, 9.5], [2, 3, 10, 12]]);
      oilStains(b, rng, -14, 0, 14, 12, 6);
      fenceJunk(b, rng, -14, -2, -15, 5);
      floodLight(b, 7.5, -1, 7, WS_YARD, 7, clip);
      b.paint(0xe9e7e0, Surf.Plain).box(-15, 0, 13.5, -13, 3.4, 13.8);
      signBox(b, -15, 3.4, 13.4, -10, 5.0, 13.8, 0x3f7fd0);
      break;
    }
    case 1: {
      // METAL FAB: tall corrugated shed, steel stock racks, yard gantry
      const sx0 = -14.5, sx1 = 6.5, sz0 = -14.5, sz1 = 0.5;
      b.paint(0x5f7384, Surf.Corrugated).box(sx0, 0, sz0, sx1, 7.2, sz1);
      b.paint(0xb9bec2, Surf.Metal).gableRoof((sx0 + sx1) / 2, (sz0 + sz1) / 2, sx1 - sx0, sz1 - sz0, 7.2, 1.8, 'x', 0.35, { color: 0x5f7384, surf: Surf.Corrugated });
      b.paint(0xdfe2e4, Surf.Corrugated);
      wallQuad(b, 'pz', sz1, -9, -3, 0, 5.8);
      b.paint(0x2a2d30, Surf.GlassPlain, 2); // open door: lit shop floor at night
      wallQuad(b, 'pz', sz1, 0, 4.5, 0, 5.0);
      lightDot(b, 2.25, 5.5, sz1 + 0.3, 0.25);
      b.paint(0xe8e8e0, Surf.GlassPlain);
      wallRow(b, 'px', sx1, sz0 + 1, sz1 - 1, 5.2, 6.4, 4, 2.2);
      b.paint(0xf1c40f, Surf.Plain);
      wallQuad(b, 'pz', sz1, sx0, sx1, 6.4, 7.0);
      // yard gantry crane over stock
      b.paint(0xe6a817, Surf.Metal, 1);
      const gx0 = 8.5, gx1 = 14.5, gz0 = -13, gz1 = 5;
      for (const x of [gx0, gx1]) {
        strut(b, [x, 0, gz0], [x, 7.5, gz0], 0.5);
        strut(b, [x, 0, gz1], [x, 7.5, gz1], 0.5);
        b.box(x - 0.3, 7.5, gz0 - 0.3, x + 0.3, 8.3, gz1 + 0.3);
      }
      b.paint(0xf1c40f, Surf.Metal, 1).box(gx0 - 0.3, 8.3, -4.4, gx1 + 0.3, 9.1, -3.6);
      b.paint(0x333333, Surf.Metal).boxC(11.5, -4, 1.2, 1.2, 7.4, 0.9);
      strut(b, [11.5, 7.4, -4], [11.5, 3.2, -4], 0.06);
      // steel stock racks
      b.paint(0x55595e, Surf.Metal);
      for (let r = 0; r < 3; r++) {
        const z = -11 + r * 5;
        for (const x of [9.5, 13.5]) strut(b, [x, 0, z], [x, 1.6, z], 0.2);
        b.paint(rng.pick([0x6a6e72, 0x7a5a42, 0x8a9096]), Surf.Metal).box(9, 0.5, z - 1.4, 14, 1.2, z + 1.4);
        b.paint(0x55595e, Surf.Metal);
      }
      // front yard: pallets, dumpster, gas cylinders, pickup
      for (let i = 0; i < 4; i++) pallets(b, -13 + i * 1.5, 4, rng.range(0.4, 1.4));
      skip(b, -11.5, 8.1, 0x2e6fb5);
      b.paint(0x3d7a3d, Surf.Metal, 1);
      for (let i = 0; i < 5; i++) { tube(b, -7 + i * 0.6, 2.2, 0, 1.5, 0.22, 0.22, 5); disc(b, -7 + i * 0.6, 2.2, 1.5, 0.22, 5); }
      carLow(b, -2, 9, 0.1, rng.pick(CAR_COLORS2));
      carLow(b, 1.5, 9.3, -0.05, rng.pick(CAR_COLORS2));
      semi(b, 4, 11, Math.PI * 0.5, 0x2b2d31, null, { tractor: true });
      asphaltPatches(b, [[-8, 2, 1, 11], [3, 7, 11, 14]]);
      oilStains(b, rng, -12, 2, 12, 12, 5);
      fenceRect(b, -15.5, -15.5, 15.5, 15.5, 2.0, 0x8a9096, [-6, 15.5], 5, 2);
      fenceJunk(b, rng, -14, -7, 15, 4);
      for (let i = 0; i < 4; i++) tyres(b, -14.6, -13 + i * 1.1, rng.range(0.9, 1.8));
      floodLight(b, 15, -15, 8, WS_YARD, 7, clip);
      floodLight(b, -3, 2, 7, WS_YARD, 5.5, clip);
      break;
    }
    case 2: {
      // BRICK SAW-TOOTH WORKSHOP with chimney, barrels, forklift
      const x0 = -15, x1 = 7, z0 = -15, z1 = 1;
      b.paint(0x8a4634, Surf.Brick).box(x0, 0, z0, x1, 5.2, z1, { top: null });
      b.paint(0x5c5f63, Surf.RoofTiles).sawtoothRoof((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 5.2, 2.6, 4, { color: 0x9fb4c0, surf: Surf.GlassCurtain, pattern: 4, floor: 1.2 });
      b.paint(0x2a3440, Surf.GlassPlain);
      wallRow(b, 'pz', z1, x0 + 0.5, x1 - 0.5, 1.4, 4.2, 5, 2.0);
      b.paint(0x6b3d2e, Surf.Wood);
      wallQuad(b, 'px', x1, -10, -4, 0, 4.2);
      b.paint(0x6a6e72, Surf.Plain);
      wallQuad(b, 'pz', z1, x0, x1, 4.6, 5.2);
      smokestack(b, 5, -13, 12.5, 0.8, 0.6, 'brick', 8, { light: false });
      // lean-to store
      b.paint(0x7d4a33, Surf.Brick).box(x1, 0, -15, 12, 3.2, -8);
      b.paint(0x8b5a3a, Surf.Corrugated).shedRoof(9.5, -11.5, 5, 7, 3.2, 0.8, 'nx');
      drums(b, rng, 9, -5, 4, 3, [0x2e6fb5, 0xb03a2e, 0x3d7a3d, 0x555555]);
      for (let i = 0; i < 6; i++) pallets(b, rng.range(-12, 2), rng.range(4, 10), rng.range(0.3, 1.5));
      forklift(b, 5, 6, Math.PI * 0.8);
      boxTruck(b, 11, 8, Math.PI, 0xf2f2ee, 0x8a2f2f);
      b.paint(0x7a7a7a, Surf.Corrugated).box(-14.5, 0, 11, -8.5, 2.6, 13.4); // container store
      fenceRect(b, -15.5, -15.5, 15.5, 15.5, 1.8, 0x55595e, [3, 14], 5, 2);
      asphaltPatches(b, [[-13, 2.5, -5, 9.5], [2, 3, 12, 13]]);
      oilStains(b, rng, -12, 2, 12, 12, 6);
      fenceJunk(b, rng, -14, 1, 15, 6);
      skip(b, -6, 12.4, 0x3d7a3d);
      lights(b, [[-9, 4.4, z1 + 0.3], [-1, 4.4, z1 + 0.3]], 0.25);
      floodLight(b, 1.5, 4, 7, WS_YARD, 6, clip);
      break;
    }
    default: {
      // LUMBER / WOOD SHOP: wood-clad shed, open lumber lean-to, cyclone dust collector, log pile
      const x0 = -15, x1 = 3, z0 = -15, z1 = -3;
      b.paint(0x8b6a47, Surf.Wood).box(x0, 0, z0, x1, 6, z1);
      b.paint(0x4d5a4a, Surf.Corrugated).gableRoof((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 6, 2.2, 'x', 0.5, { color: 0x8b6a47, surf: Surf.Wood });
      b.paint(0x2a2622, Surf.Plain);
      wallQuad(b, 'pz', z1, -12, -6, 0, 4.6);
      b.paint(0x2a3440, Surf.GlassPlain);
      wallRow(b, 'pz', z1, -4, 2, 1.2, 2.6, 2, 1.4);
      // open lean-to on posts with lumber stacks
      b.paint(0x5c6166, Surf.Corrugated).shedRoof(9, -9, 12, 12, 4.6, 0.8, 'nx');
      b.paint(0x6b5238, Surf.Wood);
      for (const [px, pz] of [[3.3, -14.8], [14.8, -14.8], [3.3, -3.2], [14.8, -3.2]] as [number, number][]) strut(b, [px, 0, pz], [px, 4.6, pz], 0.3);
      for (let i = 0; i < 4; i++) b.paint(rng.pick([0xc9a46a, 0xb8905a, 0xd4b27a]), Surf.Wood).box(5, 0, -13.5 + i * 2.6, 13, rng.range(0.9, 1.8), -11.8 + i * 2.6);
      // cyclone dust collector
      b.paint(0x9aa0a6, Surf.Metal);
      lattice(b, -3, -15 + 2.2, 6, 9, 0.9, 0.9, 0.9, 0.9, 1, 0.14, { rings: false });
      tube(b, -3, -12.8, 9, 2.4, 1.3, 1.3, 10);
      cone(b, -3, -12.8, 11.4, 0.6, 1.3, 10);
      b.paint(0x9aa0a6, Surf.Metal);
      lathe(b, -3, -12.8, [[0.25, 7.2], [1.3, 9]], 10);
      pipeRun(b, [[-3, 11.2, -12.8], [-3, 11.2, -9], [-3, 6.3, -9]], 0.3, 6);
      // log pile + log truck
      b.paint(0x6b5238, Surf.Wood);
      for (let r = 0; r < 3; r++)
        for (let i = 0; i < 4 - r; i++) hCyl(b, -10 + i * 1.0 + r * 0.5, 0.45 + r * 0.85, 4.5, 7, 0.45, 'x', 6);
      semi(b, 5, 7, Math.PI * 0.5, 0x3d7a3d, null, { tractor: true });
      b.paint(0x6b5238, Surf.Wood);
      b.paint(0x333333, Surf.Metal).box(-3, 0.05, 6.0, 9.4, 1.3, 8.0, { bottom: null });
      b.paint(0x6b5238, Surf.Wood);
      for (let i = 0; i < 3; i++) hCyl(b, 3.2 + i * 0.1, 1.7 + (i % 2) * 0.55, 6.4 + i * 0.6, 8.5, 0.38, 'x', 6);
      forklift(b, -1, 8, -Math.PI * 0.3, 0xe67e22);
      b.paint(0xc9a46a, Surf.Plain);
      lathe(b, 12, 12, [[2.2, 0], [1.2, 1.2], [0, 1.7]], 7); // sawdust pile
      fenceRect(b, -15.5, -15.5, 15.5, 15.5, 1.8, 0x8b6a47, [-4, 6], 4, 2);
      asphaltPatches(b, [[-8, 9.5, 2, 15]]);
      oilStains(b, rng, -6, 10, 10, 14, 3);
      lights(b, [[-9, 5.2, z1 + 0.3], [8.9, 4.2, -3]], 0.25);
      floodLight(b, 0.5, 11, 7, WS_YARD, 5.5, clip);
      break;
    }
  }
}

// ------------------------------------------------------------------------------------------------ ind_scrapyard
function wreck(b: ModelBuilder, rng: RNG, x: number, z: number, rot: number, y = 0.05): void {
  const c = rng.pick([0x7a5a42, 0x5e6b73, 0x6b2f2f, 0x3e5e3a, 0x8a7a5a, 0x4a4f55, 0x9a8f7a, 0x2f3f5f]);
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(c, Surf.Plain).box(-0.9, 0.0, -2.2, 0.9, 0.75, 2.2);
  b.paint(0x2a2a2a, Surf.Plain).box(-0.8, 0.75, -1.0, 0.8, 1.15, 0.8, { top: { color: c, surf: Surf.Plain } });
  b.pop();
}
function crushed(b: ModelBuilder, rng: RNG, x: number, y: number, z: number, rot: number): void {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(rng.pick([0x7a5a42, 0x5e6b73, 0x6b3a2f, 0x3e5e3a, 0x8a7a5a, 0x4a4f55, 0x2f3f5f]), Surf.Metal).box(-0.95, 0, -2.1, 0.95, 0.55, 2.1);
  b.pop();
}

/** Material handler with magnet: base, elevated cab, boom + stick. Returns nothing. */
function materialHandler(b: ModelBuilder, x: number, z: number, yaw: number, color: ColorLike = 0xe6a817): void {
  b.push().translate(x, 0, z).rotateY(yaw);
  b.paint(0x2a2a2a, Surf.Metal).box(-1.8, 0, -2.6, -0.8, 1.0, 2.6).box(0.8, 0, -2.6, 1.8, 1.0, 2.6);
  b.paint(color, Surf.Metal, 1).box(-1.3, 1.0, -1.6, 1.3, 2.4, 1.6);
  b.paint(0x55595e, Surf.Metal, 1).box(-0.5, 2.4, -0.5, 0.5, 4.5, 0.5, { top: null });
  b.paint(color, Surf.Metal, 1).box(-0.8, 4.5, -0.6, 0.8, 6.3, 1.2);
  b.paint(0x1d232a, Surf.GlassPlain, 1);
  wallQuad(b, 'pz', 1.2, -0.7, 0.7, 5.0, 6.1);
  b.paint(color, Surf.Metal, 1);
  orientedBox(b, [0, 2.6, -0.3], [0, 10.5, 6.5], 0.8, 0.9);
  orientedBox(b, [0, 10.8, 6.6], [0, 4.5, 10.2], 0.6, 0.7);
  b.paint(0x2a2a2a, Surf.Metal);
  strut(b, [0, 4.6, 10.3], [0, 3.2, 10.3], 0.08);
  tube(b, 0, 10.3, 2.6, 0.5, 1.1, 1.1, 8);
  disc(b, 0, 10.3, 3.1, 1.1, 8);
  b.pop();
}

/** Small crawler crane with a lattice boom and hook (~90 tris). Faces +Z locally. */
function smallCrane(b: ModelBuilder, x: number, z: number, yaw: number, color: ColorLike = 0xd35400): void {
  b.push().translate(x, 0, z).rotateY(yaw);
  b.paint(0x2a2a2a, Surf.Metal, 1).box(-1.6, 0, -2.2, -0.7, 0.9, 2.2).box(0.7, 0, -2.2, 1.6, 0.9, 2.2);
  b.paint(color, Surf.Metal, 1).box(-1.2, 0.9, -1.8, 1.2, 2.4, 1.4);
  b.paint(0x1d232a, Surf.GlassPlain, 1).box(0.3, 2.4, 0.2, 1.1, 3.4, 1.3, { top: { color, surf: Surf.Metal, pattern: 1 } });
  b.paint(color, Surf.Metal, 1);
  lattice(b, 0, 7.5, 2.0, 2.4, 0.35, 0.35, 0.35, 0.35, 1, 0.1, { rings: false, diag: false });
  strut(b, [-0.4, 2.2, 0.8], [-0.2, 11.5, 6.8], 0.22);
  strut(b, [0.4, 2.2, 0.8], [0.2, 11.5, 6.8], 0.22);
  strut(b, [0, 2.4, -1.6], [0, 11.6, 6.8], 0.06);
  b.paint(0x2a2a2a, Surf.Metal);
  strut(b, [0, 11.5, 6.9], [0, 4.2, 6.9], 0.05);
  b.boxC(0, 6.9, 0.5, 0.5, 3.8, 0.45);
  b.pop();
}

function scrapyard(b: ModelBuilder, v: number, rng: RNG): void {
  const H = 16;
  const SG = 0x6e6558;
  ground(b, -H, -H, H, H, SG, Surf.Pavement, 0.05);
  // perimeter corrugated wall with gate on the front
  const wc = [0x7a7f84, 0x8b5a3a, 0x5f6b5a][v];
  wallRun(b, -15.6, -15.6, 15.6, -15.6, 2.6, wc);
  wallRun(b, -15.6, -15.6, -15.6, 15.6, 2.6, wc);
  wallRun(b, 15.6, -15.6, 15.6, 15.6, 2.6, wc);
  const gate: [number, number] = v === 1 ? [4, 11] : [-11, -4];
  wallRun(b, -15.6, 15.6, gate[0], 15.6, 2.6, wc);
  wallRun(b, gate[1], 15.6, 15.6, 15.6, 2.6, wc);
  b.paint(0xd9a324, Surf.Plain);
  if (gate[1] < 8) wallQuad(b, 'pz', 15.7, gate[1] + 0.5, gate[1] + 6, 1.2, 2.3);
  else wallQuad(b, 'pz', 15.7, gate[0] - 6, gate[0] - 0.5, 1.2, 2.3);
  switch (v) {
    case 0: {
      // car salvage rows + crushed stacks + crusher + office trailer
      for (let r = 0; r < 4; r++) {
        const z = -13 + r * 5.2;
        for (let i = 0; i < 6; i++) {
          if (rng.chance(0.15)) continue;
          wreck(b, rng, -13.5 + i * 2.3, z, Math.PI * 0.5 + rng.range(-0.25, 0.25));
          if (rng.chance(0.3)) wreck(b, rng, -13.5 + i * 2.3, z, Math.PI * 0.5 + rng.range(-0.4, 0.4), 1.2);
        }
      }
      for (let s = 0; s < 3; s++) {
        const n = rng.int(3, 6);
        for (let k = 0; k < n; k++) crushed(b, rng, 5 + s * 2.4, 0.05 + k * 0.58, -12, rng.range(-0.15, 0.15));
      }
      // tall crushed-car stack (~3 m, 2 wide) + small crawler crane feeding the crusher
      for (let k = 0; k < 5; k++) for (let j = 0; j < 2; j++) crushed(b, rng, 5.6 + j * 2.1, 0.05 + k * 0.58, -6.6, rng.range(-0.1, 0.1));
      smallCrane(b, 4.2, 0.4, Math.PI * 0.85);
      // crusher machine
      b.paint(0x2e6fb5, Surf.Metal, 1).box(10, 0, -14.5, 14.5, 2.6, -6);
      b.paint(0x55595e, Surf.Metal, 1).box(10.5, 2.6, -13.5, 14, 4.2, -11);
      // office trailer
      b.paint(0xe9e2cf, Surf.Plain).box(6, 0.3, 8, 14.5, 3.1, 11.2);
      b.paint(0x2a3440, Surf.GlassPlain);
      wallRow(b, 'pz', 11.2, 6.5, 14, 1.3, 2.4, 3, 1.4);
      signBox(b, 7, 3.2, 10.8, 13, 4.3, 11.1, 0xe67e22);
      forklift(b, 3, 3, Math.PI * 0.4, 0xe6a817);
      b.paint(0x1c1c1c, Surf.Plain);
      heap(b, rng, 12, 1, 2.4, 1.8, 0x1f1f1f, Surf.Plain, 7);
      floodLight(b, 1.5, 14.6, 8, SG, 6.5, [-H, -H, H, H]);
      floodLight(b, 15, -3.5, 8, SG, 6, [-H, -H, H, H]);
      break;
    }
    case 1: {
      // ferrous scrap heaps + material handler with magnet + roll-off bins
      scrapHeap(b, rng, -8, -8, 7.0, 7.6, 0x5e4436, 22, 7, 1.0, 0.9);
      scrapHeap(b, rng, 4, -10.5, 5.2, 4.8, 0x5a524a, 12, 4, 1.2, 0.8);
      scrapHeap(b, rng, -9, 7, 5, 4.0, 0x6e5240, 12, 4);
      materialHandler(b, 6, 2, -Math.PI * 0.75);
      // roll-off bins
      for (let i = 0; i < 3; i++) {
        const cz = -13.5 + i * 3.6;
        skip(b, 12.4, cz, rng.pick([0x2e6fb5, 0x3d7a3d, 0xb03a2e]));
      }
      // weighbridge + scale house
      b.paint(0x55595e, Surf.Metal);
      flat(b, 4.5, 6, 10.5, 15, Y_MARK);
      b.paint(0xe9e2cf, Surf.Plain).box(11.5, 0, 10, 14.8, 2.8, 13.5);
      b.paint(0x2a3440, Surf.GlassPlain);
      wallQuad(b, 'nx', 11.5, 10.5, 13, 1.2, 2.3);
      semi(b, 7.5, 7, Math.PI, 0x2b2d31, 0x7a7f84, {});
      floodLight(b, -15, 14.8, 9, SG, 7.5, [-H, -H, H, H]);
      floodLight(b, 15, -2.5, 9, SG, 6.5, [-H, -H, H, H]);
      lightDot(b, 11.3, 2.5, 11.7, 0.25);
      break;
    }
    default: {
      // baler shed + metal bales stacks + mixed heap + container bins
      b.paint(0x55595e, Surf.Metal);
      for (const [px, pz] of [[-14.5, -14.5], [-2, -14.5], [-14.5, -5], [-2, -5]] as [number, number][]) strut(b, [px, 0, pz], [px, 6.5, pz], 0.35);
      b.paint(0xa9adb0, Surf.Corrugated).gableRoof(-8.25, -9.75, 13, 10, 6.5, 1.4, 'x', 0.3, { color: 0x8a9096, surf: Surf.Corrugated });
      b.paint(0xe67e22, Surf.Metal, 1).box(-12, 0, -13, -4, 2.6, -8);
      b.paint(0x55595e, Surf.Metal, 1).box(-11, 2.6, -12, -7, 4.4, -9);
      // bale stacks
      const bc = [0x7a5a42, 0x8a9096, 0x2e5f8a, 0x9a8a5a, 0xb03a2e, 0x6a6e72];
      for (let s = 0; s < 3; s++)
        for (let row = 0; row < 3; row++)
          for (let k = 0; k < 3 - (row === 2 ? 1 : 0); k++) {
            if (rng.chance(0.1)) continue;
            b.paint(rng.pick(bc), Surf.Metal).boxC(2 + s * 4.3 + k * 1.35 - 1.35, -12, 1.2, 1.2, row * 1.2, 1.2);
          }
      for (let i = 0; i < 8; i++) b.paint(rng.pick(bc), Surf.Metal).boxC(rng.range(2, 13), rng.range(-7, -3), 1.2, 1.2, 0, 1.2);
      scrapHeap(b, rng, -6, 6, 6, 5.0, 0x5e5246, 16, 5, 1.2, 0.8);
      scrapHeap(b, rng, 1.5, 7, 3.4, 2.6, 0x7a7670, 8, 2);
      for (let i = 0; i < 2; i++) {
        b.paint(i ? 0x2f7f6f : 0xd9a324, Surf.Corrugated).box(8.5, 0, 2 + i * 3.4, 14.8, 2.6, 4.4 + i * 3.4);
      }
      forklift(b, 6, -1, Math.PI * 0.2, 0xc0392b);
      boxTruck(b, -12, 11, Math.PI * 0.5, 0xf2f2ee, 0x3d7a3d);
      floodLight(b, 14.8, -14.8, 9, SG, 7, [-H, -H, H, H]);
      floodLight(b, 2, 14.8, 8, SG, 6, [-H, -H, H, H]);
      lights(b, [[-14.2, 6.0, -5.2], [-2.3, 6.0, -5.2]], 0.28);
      break;
    }
  }
}

// ------------------------------------------------------------------------------------------------ ind_smokestack_factory
function brickWindows(b: ModelBuilder, face: 'pz' | 'nz' | 'px' | 'nx', plane: number, a0: number, a1: number, y0: number, y1: number, n: number, w: number): void {
  b.paint(0x2a3440, Surf.GlassPlain);
  wallRow(b, face, plane, a0, a1, y0, y1, n, w);
}

function factory(b: ModelBuilder, v: number, rng: RNG): void {
  const H = 24;
  const G = [YARD, 0x8c867c, 0x7a756c, 0xb4ac9c][v];
  const clip: [number, number, number, number] = [-H, -H, H, H];
  ground(b, -H, -H, H, H, G, Surf.Pavement, 0.05);
  switch (v) {
    case 0: {
      // VICTORIAN BRICK WORKS: saw-tooth hall, boiler house, twin brick stacks, water tower, coal pile, office
      const x0 = -22.5, x1 = 6, z0 = -22.5, z1 = 4;
      b.paint(0x8a4634, Surf.Brick).box(x0, 0, z0, x1, 8, z1, { top: null });
      b.paint(0x55585c, Surf.RoofTiles).sawtoothRoof((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 8, 3.2, 6, { color: 0x9fb4c0, surf: Surf.GlassCurtain, pattern: 4, floor: 1.0 });
      brickWindows(b, 'pz', z1, x0 + 1, x1 - 1, 1.6, 6.6, 8, 1.8);
      brickWindows(b, 'px', x1, z0 + 1, z1 - 1, 1.6, 6.6, 6, 1.8);
      b.paint(0x6a3226, Surf.Brick);
      wallQuad(b, 'pz', z1, x0, x1, 7.3, 8.0);
      // boiler house
      const bx0 = 9, bx1 = 22.5, bz0 = -22.5, bz1 = -7;
      b.paint(0x7d4030, Surf.Brick).box(bx0, 0, bz0, bx1, 13, bz1);
      b.paint(0x4c5055, Surf.RoofTiles).gableRoof((bx0 + bx1) / 2, (bz0 + bz1) / 2, bx1 - bx0, bz1 - bz0, 13, 3.4, 'z', 0.4, { color: 0x7d4030, surf: Surf.Brick });
      brickWindows(b, 'px', bx1, bz0 + 1, bz1 - 1, 3, 11, 4, 1.6);
      brickWindows(b, 'pz', bz1, bx0 + 1, bx1 - 1, 3, 11, 3, 1.8);
      smokestack(b, 12.5, -3.5, 36, 1.9, 1.25, 'brick', 12);
      smokestack(b, 19, -3.5, 30, 1.6, 1.1, 'brick', 12);
      b.paint(0x5a3024, Surf.Brick).box(10.5, 0, -6, 21, 3, -1.2);
      // flue pipe
      b.paint(0x55595e, Surf.Metal);
      pipeRun(b, [[6, 6, -8], [9, 6, -8]], 0.8, 8);
      // water tower on steel legs
      b.paint(0x55595e, Surf.Metal);
      lattice(b, -18, 8, 0, 11, 1.8, 1.8, 1.8, 1.8, 2, 0.22, { diag: true });
      tank(b, -18, 8, 2.6, 4.2, 0x6f7a6a, { y0: 11, roof: 'cone', roofColor: 0x4c5055 });
      // coal pile + rail wagons
      heap(b, rng, 17, 8, 5, 3.4, 0x242322, Surf.Plain, 9, 1.1, 0.9);
      for (let i = 0; i < 2; i++) b.paint(0x4a3a2e, Surf.Metal).box(8 + i * 7.5, 0.9, 16.5, 14.5 + i * 7.5, 3.0, 19.5, { top: { color: 0x242322, surf: Surf.Plain } });
      b.paint(0x5a5550, Surf.Metal);
      flat(b, 7, 17.2, 23, 18.8, 0.08);
      // office front left
      b.paint(0x9c4a36, Surf.WallWindows, 1, 3.6).box(-22.5, 0, 9, -8, 7.2, 16, { top: { color: 0x7a7670, surf: Surf.RoofFlat } });
      b.paint(0x6a3226, Surf.Plain).box(-22.7, 7.2, 8.8, -7.8, 7.8, 16.2, { bottom: null });
      yardBits(b, rng, -6, 8, 5, 20);
      semi(b, -2, 14.5, Math.PI * 0.5, 0x8a2f2f, 0x8a8a84, {});
      floodLight(b, 7.5, 6.5, 10, G, 8, clip, undefined, SODIUM);
      floodLight(b, -6.5, 22.5, 9, G, 6.5, clip, undefined, SODIUM);
      lights(b, [[6.3, 6.2, -2], [-12, 6.8, 4.3], [9.3, 10.5, -7.3], [22.8, 10.5, -14]]);
      break;
    }
    case 1: {
      // STEEL WORKS: rusty hall with monitor roof, blast furnace + stoves, skip conveyor, red/white stack
      const x0 = -22.5, x1 = 4, z0 = -8, z1 = 14;
      b.paint(0x7a5a42, Surf.Corrugated).box(x0, 0, z0, x1, 15, z1);
      b.paint(0x5a5550, Surf.Metal).gableRoof((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 15, 2.2, 'x', 0.3, { color: 0x7a5a42, surf: Surf.Corrugated });
      b.paint(0x6a4a36, Surf.Corrugated).box(x0 + 2, 17.2 - 0.6, (z0 + z1) / 2 - 2.2, x1 - 2, 19.2, (z0 + z1) / 2 + 2.2);
      b.paint(0x4a4540, Surf.Metal).gableRoof((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 - 4, 4.4, 19.2, 0.9, 'x', 0.3);
      b.paint(0x9fb4c0, Surf.GlassCurtain, 4, 1.2);
      wallQuad(b, 'pz', (z0 + z1) / 2 + 2.2, x0 + 2.5, x1 - 2.5, 17, 18.8);
      b.paint(0x2a2622, Surf.Plain);
      wallQuad(b, 'pz', z1, -14, -7, 0, 9);
      b.paint(0x9fb4c0, Surf.GlassPlain);
      wallRow(b, 'pz', z1, x0 + 1, x1 - 1, 11, 13.5, 6, 2.6);
      // blast furnace
      const fx = 13, fz = -13;
      b.paint(0x5a5550, Surf.Corrugated).box(fx - 6, 0, fz - 5, fx + 6, 7, fz + 5);
      b.paint(0x3e3a36, Surf.Metal);
      lathe(b, fx, fz, [[4.6, 7], [5.0, 13], [4.2, 22], [3.0, 27], [2.4, 30]], 12);
      b.paint(0x55595e, Surf.Metal).boxC(fx, fz, 5, 5, 30, 3.5);
      b.paint(0x55595e, Surf.Metal);
      lattice(b, fx, fz, 7, 30, 5.6, 3.4, 5.6, 3.4, 4, 0.3, { rings: true, diag: false });
      lights(b, [[fx + 5.4, 13, fz + 5.4], [fx - 5.4, 13, fz + 5.4], [fx + 4.4, 24, fz + 4.4], [fx - 4.4, 24, fz - 4.4], [fx, 30.8, fz + 2.5], [21.2, 22.5, -10.6]]);
      // uptakes -> downcomer -> dust catcher
      b.paint(0x6a6e72, Surf.Metal);
      pipeRun(b, [[fx, 34, fz], [fx, 36.5, fz], [fx - 6.5, 36.5, fz + 2], [fx - 8, 16, fz + 3]], 0.9, 8);
      tank(b, fx - 8, fz + 3, 2.6, 8, 0x6a6e72, { y0: 8, roof: 'cone' });
      b.paint(0x6a6e72, Surf.Metal);
      cone(b, fx - 8, fz + 3, 8, -3, 2.6, 10);
      strut(b, [fx - 8, 0, fz + 3], [fx - 8, 5, fz + 3], 1.2);
      // hot blast stoves
      for (let i = 0; i < 3; i++) {
        const sz = -21 + i * 5.2;
        b.paint(0x8e8a84, Surf.Metal);
        tube(b, 21.2, sz, 0, 22, 2.3, 2.3, 12);
        dome(b, 21.2, sz, 22, 2.3, 2.0, 12, 2);
      }
      b.paint(0x55595e, Surf.Metal);
      pipeRun(b, [[21.2, 15, -21], [21.2, 15, -10.6], [17.5, 15, -13]], 0.8, 6);
      // skip conveyor
      conveyor(b, [6, 1.2, 8], [fx - 1, 28, fz + 4.5], 2.4, 0x6a4a36, 0x3e3a36, 3);
      // stack
      smokestack(b, -3, -18, 44, 2.4, 1.6, 'redwhite', 12);
      // ore piles
      heap(b, rng, -15, -16, 5.5, 3.6, 0x8a4a32, Surf.Plain, 9, 1.2, 1.0);
      heap(b, rng, 16, 11, 4.5, 3.0, 0x3a3634, Surf.Plain, 8);
      heap(b, rng, 7, 18, 3.4, 2.2, 0x6a625a, Surf.Plain, 7);
      semi(b, -12, 19.5, Math.PI * 0.5, 0x2e6fb5, 0x8a8a84, {});
      floodLight(b, 22.5, 22.5, 10, G, 8, clip, undefined, SODIUM);
      floodLight(b, 4.5, 0.5, 10, G, 7, clip, undefined, SODIUM);
      break;
    }
    case 2: {
      // CHEMICAL WORKS: concrete hall, tank farm in bund, sphere tank, pipe rack, concrete stack, column
      const x0 = -22.5, x1 = -2, z0 = -22.5, z1 = -5;
      b.paint(0xa9a394, Surf.WallWindows, 4, 5).box(x0, 0, z0, x1, 11, z1, { top: { color: 0x8e8b84, surf: Surf.RoofFlat } });
      parapet(b, x0, z0, x1, z1, 11, 0.8, 0.3, 0x958f82);
      for (let i = 0; i < 4; i++) roofUnit(b, x0 + 3 + i * 4.5, 11, -16, 2.4, 3, 1.6);
      b.paint(0x2e7d4f, Surf.Plain);
      wallQuad(b, 'pz', z1, x0, x1, 9.6, 10.6);
      b.paint(0x6a6e72, Surf.Metal);
      wallRow(b, 'pz', z1, x0 + 1, x1 - 1, 0.1, 4.5, 3, 4);
      // bund + tanks
      b.paint(0xa9a59c, Surf.Pavement).box(1, 0, -22.5, 22.5, 0.9, -3, { bottom: null });
      b.paint(0x8f8a80, Surf.Pavement);
      flat(b, 1.4, -22.1, 22.1, -3.4, 0.5);
      const tc = [0xd6d0c2, 0xd6d0c2, 0x4f6f4f, 0xd6d0c2];
      let t = 0;
      for (const [x, z] of [[6.5, -17.5], [16.5, -17.5], [6.5, -8.5], [16.5, -8.5]] as [number, number][]) {
        tank(b, x, z, 3.6, 9 + (t % 2) * 2, tc[t], { y0: 0.5, roof: 'dome', stair: t === 1, stairLights: t < 2, rim: 0x9aa0a6, base: 0x6a6258, flood: 7 });
        t++;
      }
      sphereTank(b, -15, 6, 4.2, 0xd6d0c2, 0x6a6e72, 10, 6, 7);
      // pipe rack along z=1
      b.paint(0x55595e, Surf.Metal);
      for (let x = -21; x <= 21; x += 7) {
        strut(b, [x, 0, -0.5], [x, 5, -0.5], 0.35);
        strut(b, [x, 0, 2.5], [x, 5, 2.5], 0.35);
        strut(b, [x, 5, -0.5], [x, 5, 2.5], 0.3);
      }
      const pc = [0x8e949a, 0x8e949a, 0xc9a13b, 0x8e949a];
      for (let i = 0; i < 4; i++) {
        b.paint(pc[i], Surf.Metal);
        b.pipe([-22, 5.4, -0.1 + i * 0.8], [22, 5.4, -0.1 + i * 0.8], 0.3, 6);
      }
      b.paint(0x9aa0a6, Surf.Metal);
      pipeRun(b, [[6.5, 5.4, 0], [6.5, 5.4, -5], [6.5, 8, -5]], 0.3, 6);
      pipeRun(b, [[-8, 5.4, 1], [-8, 5.4, -5]], 0.4, 6);
      // column
      b.paint(0xcac4b6, Surf.Metal);
      tube(b, 5, 9, 0, 24, 1.3, 1.3, 10);
      dome(b, 5, 9, 24, 1.3, 0.9, 10, 2);
      b.paint(0x55595e, Surf.Metal);
      for (const y of [8, 16, 23]) tube(b, 5, 9, y, 0.3, 2.1, 2.1, 10);
      // concrete stack
      smokestack(b, 18, 11, 38, 1.9, 1.3, 'concrete', 12);
      b.paint(0x8e8b84, Surf.Plain).box(14, 0, 14, 22.5, 4, 22.5, { top: { color: 0x7a7670, surf: Surf.RoofFlat } });
      officeBlock(b, -9, 12, 7, 20, 7.2, 0xdad6cc, 2, 3.6);
      yardBits(b, rng, -22, 12, -12, 22);
      floodLight(b, -1, -2.5, 10, G, 7, clip, undefined, SODIUM);
      floodLight(b, 12, 22.5, 9, G, 6.5, clip, undefined, SODIUM);
      lights(b, [[1.2, 0.95, -22.8], [22.8, 0.95, -12], [-2, 5.8, 3], [-18, 5.8, 3], [5, 16.4, 11.4]]);
      break;
    }
    default: {
      // CEMENT WORKS: preheater tower, inclined rotary kiln, clinker cooler, cement silos, steel stack
      const px = -16, pz = -16;
      b.paint(0xb8b3a8, Surf.Plain).box(px - 5.5, 0, pz - 5.5, px + 5.5, 12, pz + 5.5, { top: { color: 0x9a968e, surf: Surf.RoofFlat } });
      b.paint(0x8e8b84, Surf.Metal);
      lattice(b, px, pz, 12, 32, 5.2, 4.6, 5.2, 4.6, 4, 0.3, { rings: true, diag: true });
      b.paint(0xc5c1b8, Surf.Metal);
      for (let k = 0; k < 4; k++) {
        const y = 14 + k * 4.8;
        const ox = k % 2 ? 1.8 : -1.8;
        tube(b, px + ox, pz, y + 1.2, 2.2, 1.8, 1.8, 10);
        cone(b, px + ox, pz, y + 1.2, -1.6, 1.8, 10);
      }
      b.paint(0x9a968e, Surf.Plain).boxC(px, pz, 9.5, 9.5, 32, 0.6);
      smokestack(b, px + 3, pz - 3, 44, 1.9, 1.4, 'steel', 10);
      lights(b, [[px + 5.4, 18, pz + 5.4], [px - 5.4, 24, pz + 5.4], [px + 5, 30, pz - 5]]);
      // kiln on piers (runs along X in the middle of the lot)
      const kz = -5;
      const ka: V3 = [px + 5, 7.5, kz], kb: V3 = [15.5, 4.2, kz];
      b.paint(0xb8b3a8, Surf.Plain).box(px + 2, 0, pz + 5.5, px + 6, 9.5, kz + 2.5);
      b.paint(0x5a524a, Surf.Metal);
      b.pipe(ka, kb, 2.0, 10);
      b.paint(0x4a4540, Surf.Metal);
      for (const tt of [0.25, 0.55, 0.85]) {
        const p: V3 = [ka[0] + (kb[0] - ka[0]) * tt, ka[1] + (kb[1] - ka[1]) * tt, kz];
        b.pipe([p[0] - 0.4, p[1] + 0.012, kz], [p[0] + 0.4, p[1], kz], 2.35, 10);
        b.paint(0xa9a59c, Surf.Plain).box(p[0] - 1.2, 0, kz - 2.2, p[0] + 1.2, p[1] - 1.8, kz + 2.2);
        b.paint(0x4a4540, Surf.Metal);
      }
      // clinker cooler + burner building
      b.paint(0xb8b3a8, Surf.Corrugated).box(15, 0, kz - 6, 22.5, 9, kz + 5, { top: { color: 0x8e8b84, surf: Surf.RoofFlat } });
      // cement silos row at the back right + roof gallery
      for (let i = 0; i < 3; i++) {
        const sx = 1.5 + i * 7.4, sz = -19.5;
        b.paint(0xd2cec6, Surf.Plain, 1, 12);
        tube(b, sx, sz, 0, 27, 3.5, 3.5, 12);
        disc(b, sx, sz, 27, 3.5, 12);
      }
      b.paint(0x8e8b84, Surf.Corrugated).box(-1.5, 27, -21.5, 19.5, 29.5, -17.5, { bottom: { color: 0x8e8b84 } });
      conveyor(b, [19, 9, kz - 5], [16.5, 28, -17.6], 2.0, 0x9a968e, 0x6a6e72, 2);
      // packing plant + trucks at the front
      b.paint(0xc5c1b8, Surf.Corrugated).box(-22.5, 0, 5, -5, 9, 16);
      b.paint(0x8e8b84, Surf.Metal).gableRoof(-13.75, 10.5, 17.5, 11, 9, 1.4, 'x', 0.3, { color: 0xc5c1b8, surf: Surf.Corrugated });
      b.paint(0x2e6fb5, Surf.Plain);
      wallQuad(b, 'pz', 16, -22.5, -5, 7.2, 8.2);
      b.paint(0x3a3d40, Surf.Metal);
      wallRow(b, 'pz', 16, -21, -6, 0.1, 4.5, 3, 3.6);
      // lit loading doors: lamp over each door + sodium pool on the apron
      for (const dc of [-18.5, -13.5, -8.5]) {
        lightDot(b, dc, 5.0, 16.35, 0.26, SODIUM);
        poolRect(b, dc - 1.8, 16.1, dc + 1.8, 20.6, G);
      }
      boxTruck(b, 17, 17.5, Math.PI * 0.5, 0xe9e7e0, 0x9a968e);
      semi(b, -3, 20.5, Math.PI * 0.5, 0xc0392b, 0xd2cec6, {});
      floodLight(b, 2, 2.5, 10, G, 7, clip, undefined, SODIUM);
      floodLight(b, 23, 22.5, 9, G, 6, clip, undefined, SODIUM);
      lights(b, [[4.7, 9.9, kz + 2.3], [15.2, 7, kz + 5.3], [22.8, 7, kz - 3]]);
      // raw meal / limestone stockpiles
      heap(b, rng, 9, 10, 5.5, 3.2, 0xc8c0ae, Surf.Plain, 9, 1.2, 0.8);
      heap(b, rng, 19, 11, 3.4, 2.2, 0x8a8278, Surf.Plain, 8);
      conveyor(b, [3, 0.5, 10], [-3.5, 8.5, kz + 3], 1.6, 0x9a968e, 0x6a6e72, 1);
      break;
    }
  }
}

function yardBits(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number): void {
  drums(b, rng, x0 + 1, z0 + 1, 3, 2, [0x2e6fb5, 0xb03a2e, 0x3d7a3d, 0x555555]);
  for (let i = 0; i < 3; i++) pallets(b, rng.range(x0 + 3, x1 - 1), rng.range(z0 + 1, z1 - 1), rng.range(0.4, 1.4));
}

// ------------------------------------------------------------------------------------------------ ind_refinery
const RF_GROUND = 0x86827a, RF_GRAVEL = 0x77736b, RF_ROAD = 0x5a5b5e;

/** Distillation column: darker base band, shell, cap, platforms, ladder with a dim sodium stair light every ~6 m + top. */
function column(b: ModelBuilder, x: number, z: number, r: number, h: number, color: ColorLike = 0xd8d8d2, rings = 2, seg = 8): void {
  const rb = r * (1 - 0.08 * (3 / h));
  b.paint(0xa8a49a, Surf.Metal);
  tube(b, x, z, 0, 3, r, rb, seg);
  b.paint(color, Surf.Metal);
  tube(b, x, z, 3, h - 3, rb, r * 0.92, seg);
  dome(b, x, z, h, r * 0.92, r * 0.6, seg, 2);
  b.paint(0x55595e, Surf.Metal);
  for (let i = 1; i <= rings; i++) tube(b, x, z, (h * i) / (rings + 0.5), 0.3, r + 0.7, r + 0.7, seg);
  strut(b, [x + r + 0.5, 0, z], [x + r + 0.5, h, z], 0.3);
  stairLights(b, x + r + 0.85, z + 0.3, 0, h - 2);
  lightDot(b, x, h + r * 0.6 + 0.35, z, 0.3, SODIUM);
  b.paint(RESET_PAINT, Surf.Metal);
}

/** Flare stack: light lattice + riser + emissive flame; registers a smoke emitter above the flame. */
function flare(b: ModelBuilder, x: number, z: number, h: number): void {
  b.paint(0x9a1f1a, Surf.Metal);
  lattice(b, x, z, 0, h - 5, 2.2, 0.7, 2.2, 0.7, 2, 0.24, { rings: false });
  b.paint(0xc0392b, Surf.Metal);
  tube(b, x, z, 0, h - 2.5, 0.5, 0.5, 5);
  b.paint(0xe8e8e2, Surf.Metal);
  tube(b, x, z, h - 2.5, 2.5, 0.55, 0.55, 5);
  b.paint(0xff8a1c, Surf.Emissive);
  lathe(b, x, z, [[0.4, h], [1.1, h + 1.6], [0.7, h + 3.4], [0, h + 5.2]], 5);
  b.paint(0xffd35a, Surf.Emissive);
  lathe(b, x + 0.1, z, [[0.3, h + 0.2], [0.6, h + 1.4], [0, h + 2.8]], 4);
  lightDot(b, x + 1.0, h * 0.5, z, 0.3, 0xff2a1a);
  emitSmoke([x, h + 5.6, z]);
  b.paint(RESET_PAINT, Surf.Metal);
}

/** Muted refinery pipe palette: ~70% greys, 20% off-white, 10% safety yellow. */
function pipeColor(rng: RNG): number {
  const r = rng.next();
  return r < 0.35 ? 0x8e949a : r < 0.7 ? 0xb8bcc0 : r < 0.9 ? 0xe6e4dc : 0xc9a13b;
}

/** Pipe rack: bents every ~14 m with n parallel pipes on top; work lights on alternate bents. */
function pipeRack(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, n: number, rng: RNG, spacing = 14): void {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const len = alongX ? x1 - x0 : z1 - z0;
  const bents = Math.max(2, Math.round(Math.abs(len) / spacing) + 1);
  const lp: V3[] = [];
  b.paint(0x55595e, Surf.Metal);
  for (let i = 0; i < bents; i++) {
    const t = i / (bents - 1);
    const cx = x0 + (x1 - x0) * t, cz = z0 + (z1 - z0) * t;
    const [ax, az, bx, bz] = alongX ? [cx, cz - 1.8, cx, cz + 1.8] : [cx - 1.8, cz, cx + 1.8, cz];
    strut(b, [ax, 0, az], [ax, y, az], 0.35);
    strut(b, [bx, 0, bz], [bx, y, bz], 0.35);
    strut(b, [ax, y, az], [bx, y, bz], 0.3);
    if (i % 2 === 1) lp.push([ax, y - 0.6, az]);
  }
  for (let k = 0; k < n; k++) {
    const off = -1.4 + (2.8 * k) / Math.max(1, n - 1);
    const r = rng.range(0.22, 0.42);
    b.paint(pipeColor(rng), Surf.Metal);
    if (alongX) b.pipe([x0, y + r + 0.15, z0 + off], [x1, y + r + 0.15, z1 + off], r, 5);
    else b.pipe([x0 + off, y + r + 0.15, z0], [x1 + off, y + r + 0.15, z1], r, 5);
  }
  lights(b, lp);
}

/** Horizontal process vessel on two saddles (~44 tris). */
function vessel(b: ModelBuilder, x: number, z: number, len: number, r: number, axis: 'x' | 'z', color: ColorLike = 0xe6e4dc, y = 0): void {
  b.paint(0x8e8b84, Surf.Plain);
  const d = len * 0.3;
  if (axis === 'x') b.boxC(x - d, z, 0.8, r * 1.6, y, r + 0.3).boxC(x + d, z, 0.8, r * 1.6, y, r + 0.3);
  else b.boxC(x, z - d, r * 1.6, 0.8, y, r + 0.3).boxC(x, z + d, r * 1.6, 0.8, y, r + 0.3);
  b.paint(color, Surf.Metal);
  hCyl(b, x, y + r + 0.4, z, len, r, axis, 6);
}

/** Tank truck (tractor + cylindrical tank trailer), faces +X. ~50 tris. */
function tankTruck(b: ModelBuilder, x: number, z: number, cab: ColorLike, tankC: ColorLike = 0xe8e8e2): void {
  semi(b, x - 1.5, z, Math.PI * 0.5, cab, null, { tractor: true });
  b.paint(0x2a2a2a, Surf.Metal, 1).box(x - 9.5, 0.05, z - 1.0, x + 3.5, 1.2, z + 1.0, { top: null });
  b.paint(tankC, Surf.Metal);
  hCyl(b, x - 3, 2.4, z, 12, 1.25, 'x', 6);
}

/** Shared lot: ground, fence + gate, office (front-left, or front-right when mirrored), roads, process gravel, lawns. */
function refineryCommon(b: ModelBuilder, mirror: boolean): void {
  ground(b, -32, -32, 32, 32, RF_GROUND, Surf.Pavement, 0.05);
  const m = mirror ? -1 : 1;
  const gate: [number, number] = mirror ? [2, 10] : [-10, -2];
  fenceRect(b, -31.5, -31.5, 31.5, 31.5, 2.2, 0x8a9096, gate, 32, 1);
  if (mirror) officeBlock(b, 16, 21.5, 29, 29, 7, 0xdedad2, 2, 3.5);
  else officeBlock(b, -29, 21.5, -16, 29, 7, 0xdedad2, 2, 3.5);
  b.paint(RF_ROAD, Surf.Pavement);
  flat(b, gate[0], 14, gate[1], 32, Y_OVER);
  flat(b, -31, 11, 31, 14, Y_OVER);
  flat(b, -31, -11, 31, -8.5, Y_OVER);
  b.paint(RF_GRAVEL, Surf.Pavement);
  flat(b, -24, -7.5, 30, 10, Y_OVER);
  b.paint(0x6f9a45, Surf.Foliage);
  const lx0 = mirror ? 11 : -31, lx1 = mirror ? 31 : -11;
  flat(b, lx0, 15, lx1, 20.5, Y_OVER);
  flat(b, lx0, 29.5, lx1, 31.5, Y_OVER);
  // gate + road lights (sodium)
  floodLight(b, (gate[0] + gate[1]) / 2 + m * 5.2, 15.2, 10, RF_ROAD, 4.4, undefined, undefined, SODIUM);
}

function refinery(b: ModelBuilder, v: number, rng: RNG): void {
  refineryCommon(b, v === 1);
  switch (v) {
    case 0: {
      // OIL REFINERY: floating-roof tank farm at the back, crude unit columns, box heater, 2 pipe racks, loading rack, flare
      b.paint(0x8e8a80, Surf.Pavement).box(-30.5, 0, -30.5, 30.5, 0.8, -12.5, { bottom: null, px: null, nx: null, nz: null });
      // tank farm: shells floodlit warm from the bund at night, sodium lights on the rims, a lit bund floor
      tank(b, -21.5, -22, 6.8, 12, 0xe8e6de, { y0: 0.05, roof: 'flat', roofColor: 0x9ea2a6, seg: 10, rim: 0x9aa0a6, flood: 8 });
      tank(b, -5.5, -22, 6.8, 12, 0xdedcd2, { y0: 0.05, roof: 'flat', roofColor: 0x9ea2a6, seg: 10, flood: 8 });
      tank(b, 9.5, -22, 6.0, 11, 0xe8e6de, { y0: 0.05, roof: 'flat', roofColor: 0x9ea2a6, seg: 10, rim: 0x9aa0a6, flood: 7.5 });
      tank(b, 24, -25, 4.0, 10, 0x55654f, { y0: 0.05, roof: 'cone', seg: 8, flood: 7 });
      tank(b, 24, -16, 4.0, 10, 0x55654f, { y0: 0.05, roof: 'cone', seg: 8, flood: 7 });
      lights(b, [[-21.5, 12.6, -15], [-5.5, 12.6, -15], [9.5, 11.6, -15.8], [24, 11.2, -12]], 0.3, SODIUM);
      pool(b, -13.5, -21, 8, 0x8e8a80, 0.86);
      pipeRack(b, -28, -9.7, 28, -9.7, 6, 4, rng, 18);
      pipeRack(b, -2, -8, -2, 10.5, 5, 3, rng, 9);
      column(b, 4, 2, 2.2, 42, 0xd8d6ce, 2);
      column(b, 10, -2, 1.5, 31, 0xd8d6ce, 1);
      // structure with vessels
      b.paint(0x6a6e72, Surf.Metal);
      lattice(b, -11, 2, 0, 16, 5, 5, 3.5, 3.5, 3, 0.3, { rings: true, diag: false });
      b.paint(0x8e9296, Surf.Metal).boxC(-11, 2, 10.4, 7.4, 10.6, 0.3);
      b.paint(0xe6e4dc, Surf.Metal);
      hCyl(b, -11, 12.4, 2, 8, 1.4, 'x', 6);
      b.paint(0xb8bcc0, Surf.Metal);
      tube(b, -12.5, 0.5, 0, 10.6, 1.1, 1.1, 8);
      lights(b, [[-16, 5.6, -1.5], [-6, 5.6, 5.5], [-16, 11, 5.5], [-6, 11, -1.5], [-11, 16.4, 2]], 0.3, SODIUM);
      vessel(b, -19.5, 7.5, 7, 1.2, 'x');
      // box heater (floodlit brick-red casing) + stacks
      b.paint(0x8a4a38, Surf.Plain, 1, 9).box(18, 0, -4, 27, 9, 2, { top: { color: 0x55595e, surf: Surf.Metal } });
      smokestack(b, 20.5, -1, 27, 0.9, 0.8, 'steel', 6);
      smokestack(b, 24.5, -1, 27, 0.9, 0.8, 'steel', 6);
      lights(b, [[18, 9.4, 2.3], [27, 9.4, 2.3], [22.5, 9.4, -4.3]], 0.3, SODIUM);
      pool(b, 7, 0.5, 6.5, RF_GRAVEL);
      b.paint(0x8e949a, Surf.Metal);
      pipeRun(b, [[4, 6.6, -9], [4, 6.6, -0.5]], 0.45, 5);
      // truck loading rack (front right)
      b.paint(0xe8e8e2, Surf.Metal).box(6, 6.2, 17, 27, 6.6, 27);
      b.paint(0xc0392b, Surf.Plain);
      wallQuad(b, 'pz', 27, 6, 27, 6.2, 6.6);
      b.paint(0x55595e, Surf.Metal);
      for (const [px, pz] of [[7, 18], [26, 18], [7, 26], [26, 26]] as [number, number][]) strut(b, [px, 0, pz], [px, 6.2, pz], 0.4);
      poolRect(b, 6.5, 17.5, 26.5, 26.5, RF_GROUND);
      lights(b, [[10, 6.0, 22], [16.5, 6.0, 22], [23, 6.0, 22]], 0.3, 0xfff2d8);
      tankTruck(b, 18, 21.5, 0x2e6fb5, 0xd9d9d0);
      flare(b, -26, 6, 48);
      floodLight(b, -6, 9.5, 11, RF_GRAVEL, 8, undefined, undefined, SODIUM);
      floodLight(b, 14, -7, 11, RF_GRAVEL, 7, undefined, undefined, SODIUM);
      break;
    }
    case 1: {
      // PETROCHEMICAL (mirrored lot): sphere tanks, cracking unit frame, columns, cooling cells (steam), heater + stack, flare
      sphereTank(b, -22, -22, 5.0, 0xe8e6de, 0x6a6e72, 8, 4, 8);
      sphereTank(b, -9, -22, 5.0, 0xe8e6de, 0x6a6e72, 8, 4, 8);
      tank(b, 11, -22, 6.8, 14, 0xdedcd4, { roof: 'dome', seg: 10, flood: 9 });
      lights(b, [[-22, 6.8, -16.6], [-9, 6.8, -16.6], [11, 14.8, -15]], 0.3, SODIUM);
      pool(b, -15.5, -17.5, 6, RF_GROUND);
      // cracking unit
      b.paint(0x6a6e72, Surf.Metal);
      lattice(b, -6, 3, 0, 24, 7, 7, 4.5, 4.5, 3, 0.34, { rings: true, diag: false });
      b.paint(0x8e9296, Surf.Metal).boxC(-6, 3, 14.6, 9.6, 8, 0.3).boxC(-6, 3, 14.6, 9.6, 16, 0.3);
      lights(b, [[-13.2, 8.6, 7.6], [1.2, 8.6, -1.6], [-13.2, 16.6, -1.6], [1.2, 16.6, 7.6], [-6, 24.6, 3], [-13.2, 24.4, 7.6], [1.2, 24.4, -1.6]], 0.3, SODIUM);
      b.paint(0xd8d6ce, Surf.Metal);
      tube(b, -10, 3, 0, 34, 1.6, 1.4, 8);
      dome(b, -10, 3, 34, 1.4, 1.0, 8, 2);
      stairLights(b, -8.3, 3.3, 24, 33, 4.5);
      column(b, 8, 1, 1.8, 42, 0xe8e6de, 2);
      column(b, 12.5, 6, 1.2, 30, 0xd8d6ce, 1);
      // mechanical draft cooling tower cells with steam
      b.paint(0x9aa6ac, Surf.Corrugated).box(16, 0, 1, 29.5, 8, 9, { top: { color: 0x7f8a90, surf: Surf.Metal } });
      for (let i = 0; i < 3; i++) {
        const cx = 18.5 + i * 4.5;
        b.paint(0x7f8a90, Surf.Metal);
        tube(b, cx, 5, 8, 2.0, 1.9, 2.1, 8);
        b.paint(0x2e3134, Surf.Metal);
        disc(b, cx, 5, 9.9, 2.0, 8);
        emitSteam([cx, 10.5, 5]);
      }
      lights(b, [[16, 8.4, 9.3], [29.5, 8.4, 9.3]], 0.3, SODIUM);
      pipeRack(b, -28, -11.5, 28, -11.5, 6.5, 4, rng, 18);
      pipeRack(b, 3, -10, 3, 10.5, 5.5, 3, rng, 10);
      flare(b, 26, -26, 46);
      // heater + stack on the free front-left
      b.paint(0x8a4a38, Surf.Plain, 1, 8).box(-28, 0, 15, -19, 8, 22, { top: { color: 0x55595e, surf: Surf.Metal } });
      smokestack(b, -21, 18.5, 32, 1.2, 1.0, 'concrete', 8);
      lights(b, [[-28.3, 8.3, 22.3], [-19, 8.3, 22.3]], 0.3, SODIUM);
      floodLight(b, 6, 9.5, 11, RF_GRAVEL, 7, undefined, undefined, SODIUM);
      floodLight(b, -16, -6.5, 11, RF_GRAVEL, 6, undefined, undefined, SODIUM);
      break;
    }
    default: {
      // GAS PROCESSING / LNG: two big double-wall tanks, columns, bullet vessels, compressor house, flare (front right)
      for (const [x, z] of [[-18, -18], [5, -20]] as [number, number][]) {
        b.paint(0xeceae4, Surf.Plain, 1, 13);
        tube(b, x, z, 0, 22, 10, 10, 14);
        b.paint(0xdedcd4, Surf.Metal);
        dome(b, x, z, 22, 10, 3.2, 14, 3);
        b.paint(0x9aa0a6, Surf.Metal).boxC(x, z, 3, 3, 25.2, 1.4);
        b.paint(0x55595e, Surf.Metal);
        strut(b, [x + 10.4, 0, z - 2], [x + 7, 22, z + 7], 0.5);
        // stair lights up the external stair (every ~6 m)
        for (const t of [0.27, 0.54, 0.81]) lightDot(b, x + 10.4 - 3.4 * t + 0.5, 22 * t + 0.4, z - 2 + 9 * t, 0.3, SODIUM, 2);
        lights(b, [[x, 25.6, z], [x + 10.2, 22.4, z], [x - 10.2, 22.4, z]], 0.3, SODIUM);
      }
      column(b, 22, -22, 1.6, 36, 0xd8d6ce, 2);
      column(b, 26, -15, 1.2, 28, 0xd8d6ce, 1);
      column(b, 20.5, -12, 1.0, 22, 0xc5c7c6, 1);
      for (let i = 0; i < 3; i++) vessel(b, 1 + i * 4.4, 6.5, 12, 1.6, 'z', i === 1 ? 0xd8d6ce : 0xe6e4dc);
      b.paint(0xc8ccd0, Surf.Corrugated).box(-29, 0, -3, -13, 10, 9);
      b.paint(0x9aa0a6, Surf.Metal).gableRoof(-21, 3, 16, 12, 10, 1.6, 'x', 0.3, { color: 0xc8ccd0, surf: Surf.Corrugated });
      b.paint(0x2e6fb5, Surf.Plain);
      wallQuad(b, 'pz', 9, -29, -13, 8.2, 9.2);
      b.paint(0x2a2d30, Surf.GlassPlain, 2);
      wallQuad(b, 'pz', 9, -25, -20, 0, 5);
      smokestack(b, -15, -1, 26, 0.9, 0.8, 'steel', 8);
      pipeRack(b, -12, 2.5, 28, 2.5, 6, 4, rng);
      pipeRack(b, 16, -7, 16, 10, 5.5, 3, rng, 9);
      lights(b, [[-2, 5.4, 12.6], [7, 5.4, 12.6], [-13, 10.6, 3], [-29, 10.6, 3], [-21, 5.5, 9.3]], 0.3, SODIUM);
      flare(b, 27, 22, 42);
      floodLight(b, 10, 9.5, 11, RF_GRAVEL, 7, undefined, undefined, SODIUM);
      floodLight(b, -12, -8, 11, RF_ROAD, 2.4, undefined, undefined, SODIUM);
      pool(b, 23, -17.5, 6, RF_GROUND);
      tankTruck(b, 8, 24, 0x2e6fb5);
      break;
    }
  }
}

export const dirtyModels: ModelBuilders = {
  ind_workshop: (b, v, rng) => workshop(b, v, rng),
  ind_scrapyard: (b, v, rng) => scrapyard(b, v, rng),
  ind_smokestack_factory: (b, v, rng) => factory(b, v, rng),
  ind_refinery: (b, v, rng) => refinery(b, v, rng),
};
