/**
 * Utility / WASTE models: incinerator (waste-to-energy), recycling center, landfill tile.
 */
import type { ModelBuilders } from '../registry';
import type { ModelBuilder, ColorLike } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { signBox } from '../kit';
import {
  flat, ground, wallQuad, wallDisc, tube, disc, strut, conveyor, orientedBox, tank, smokestack, carLow, forklift,
  fenceRect, floodLight, roofUnit, officeBlock, heap, wallRun, tree, CAR_COLORS2,
} from './ind_kit';

const CONCRETE = 0xa39e94;
const DIRT = 0x7a6a52;
const BAG_COLORS = [0xe8e8e2, 0x2a2a2a, 0x3a5a8a, 0x8a8a84, 0x6a5a48, 0xd8d0b0, 0x4a6a4a, 0xb04030, 0xd9a324, 0x9ab0c0];

/** Garbage truck (rear loader), faces +Z locally (~40 tris). */
function garbageTruck(b: ModelBuilder, x: number, z: number, rot: number, body: ColorLike = 0x2e7d4f, cab: ColorLike = 0xf2f2ee, tilt = 0, y = 0.05): void {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(0x1e1e1e, Surf.Metal).box(-1.1, 0, -4.2, 1.1, 1.0, 4.0, { top: null });
  b.paint(cab, Surf.Metal).box(-1.2, 1.0, 2.2, 1.2, 3.1, 4.1);
  b.paint(0x1a2027, Surf.Metal);
  wallQuad(b, 'pz', 4.1, -1.05, 1.05, 2.1, 2.9);
  b.push().translate(0, 1.0, -4.2).rotateX(-tilt);
  b.paint(body, Surf.Metal).box(-1.25, 0, 0.2, 1.25, 2.6, 6.2);
  b.paint(0x55595e, Surf.Metal).box(-1.2, 0.1, -0.6, 1.2, 2.3, 0.2);
  b.pop();
  b.pop();
}

/** Bulldozer (~60 tris). Faces +Z locally. */
function bulldozer(b: ModelBuilder, x: number, y: number, z: number, rot: number): void {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(0x2a2a2a, Surf.Metal).box(-1.9, 0, -2.2, -1.0, 1.0, 2.2).box(1.0, 0, -2.2, 1.9, 1.0, 2.2);
  b.paint(0xe6a817, Surf.Metal).box(-1.0, 0.5, -1.9, 1.0, 2.1, 1.9);
  b.paint(0xe6a817, Surf.Metal).box(-0.9, 2.1, -1.8, 0.9, 3.4, -0.2, { top: { color: 0xe6a817, surf: Surf.Metal } });
  b.paint(0x1a2027, Surf.Metal);
  wallQuad(b, 'pz', -0.2, -0.8, 0.8, 2.3, 3.2);
  b.paint(0xd9a324, Surf.Metal);
  b.push().translate(0, 0, 2.9).rotateX(-0.2);
  b.box(-2.2, 0, -0.2, 2.2, 1.4, 0.25);
  b.pop();
  strut(b, [-1.5, 0.7, 2.2], [-1.5, 0.7, 2.8], 0.2);
  strut(b, [1.5, 0.7, 2.2], [1.5, 0.7, 2.8], 0.2);
  b.paint(0x2a2a2a, Surf.Metal);
  strut(b, [0.4, 2.1, 1.2], [0.4, 3.0, 1.2], 0.14);
  b.pop();
}

/** Garbage heap: mottled mound + many small bags / debris pieces on the surface. */
function garbageHeap(b: ModelBuilder, rng: RNG, x: number, z: number, r: number, h: number, y0 = 0, n = 12, base: ColorLike = 0x716555, sx = 1, sz = 1): void {
  b.push().translate(0, y0, 0);
  heap(b, rng, x, z, r, h, base, Surf.Plain, 10, sx, sz);
  for (let i = 0; i < 2; i++) {
    const a = rng.next() * Math.PI * 2, d = rng.range(0.25, 0.5);
    heap(b, rng, x + Math.cos(a) * r * d * sx, z + Math.sin(a) * r * d * sz, r * 0.45, h * (1 - 0.5 * d) + 0.35, rng.pick([0x7a6e5e, 0x5e5850, 0x8a7a62, 0x6a6a64]), Surf.Plain, 6);
  }
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * 0.9;
    const px = x + Math.cos(a) * r * d * sx, pz = z + Math.sin(a) * r * d * sz;
    const py = (d <= 0.55 ? h * (1 - 0.509 * d) : 0.72 * h * (1 - (d - 0.55) / 0.45)) - 0.12;
    b.push().translate(px, py, pz).rotateY(rng.next() * 3).rotateX(rng.range(-0.5, 0.5));
    b.paint(rng.pick(BAG_COLORS), rng.chance(0.25) ? Surf.Metal : Surf.Plain);
    const s = rng.range(0.3, 0.75);
    b.box(-s * 0.6, 0, -s * 0.5, s * 0.6, s * 0.6, s * 0.5, { bottom: null });
    b.pop();
  }
  b.pop();
}

// ------------------------------------------------------------------------------------------------ util_incinerator
function incinerator(b: ModelBuilder, rng: RNG): void {
  const H = 24;
  ground(b, -H, -H, H, H, CONCRETE, Surf.Pavement, 0.05);
  b.paint(0x6f9a45, Surf.Foliage);
  flat(b, -H, 19.5, H, H, 0.07);
  // bunker + boiler hall (tall, dark cladding, sloping roof)
  b.paint(0x4a5560, Surf.Corrugated).box(-6, 0, -21, 14, 25, 7);
  b.paint(0x5d6873, Surf.Metal).shedRoof(4, -7, 20, 28, 25, 7, 'nz');
  b.paint(0xe67e22, Surf.Plain);
  for (let i = 0; i < 4; i++) wallQuad(b, 'pz', 7, -4 + i * 5, -2.8 + i * 5, 2, 24);
  b.paint(0x9fb4c0, Surf.GlassCurtain, 5, 3.6);
  wallQuad(b, 'px', 14, -18, 4, 17, 23);
  // tipping hall with truck bays
  b.paint(0xb9bec2, Surf.Corrugated).box(-22.5, 0, -14, -6, 13, 12);
  b.paint(0x8e9296, Surf.Metal).gableRoof(-14.25, -1, 16.5, 26, 13, 1.4, 'z', 0.3, { color: 0xb9bec2, surf: Surf.Corrugated });
  b.paint(0xe67e22, Surf.Plain);
  wallQuad(b, 'pz', 12, -22.5, -6, 10.4, 11.4);
  for (let i = 0; i < 3; i++) {
    const cx = -20 + i * 5.2;
    b.paint(0x2a2d30, Surf.Plain);
    wallQuad(b, 'pz', 12, cx - 1.9, cx + 1.9, 0, 6.2);
    b.paint(0xe6a817, Surf.Plain);
    wallQuad(b, 'pz', 12, cx - 2.1, cx + 2.1, 6.2, 6.6);
  }
  garbageTruck(b, -20, 17, Math.PI, 0x2e7d4f);
  garbageTruck(b, -9.6, 15.5, Math.PI * 1.05, 0xe67e22);
  // flue-gas treatment + ducts
  b.paint(0xc5c9cc, Surf.Corrugated).box(14, 0, -21, 22.5, 20, -6);
  b.paint(0x8e9296, Surf.Metal).box(13.8, 20, -21.2, 22.7, 20.6, -5.8);
  for (let i = 0; i < 3; i++) {
    b.paint(0xd8dadc, Surf.Metal);
    tube(b, 16 + i * 2.6, -3, 0, 11, 1.1, 1.1, 8);
    disc(b, 16 + i * 2.6, -3, 11, 1.1, 8);
  }
  b.paint(0x7f8388, Surf.Metal);
  orientedBox(b, [18, 16, -6], [18.5, 16, 0.2], 2.6, 2.6);
  // the stack
  smokestack(b, 18.5, 2.8, 52, 2.3, 1.8, 'concrete', 14);
  b.paint(0xe67e22, Surf.Plain);
  tube(b, 18.5, 2.8, 44, 1.6, 1.87, 1.85, 14);
  // weighbridge + gatehouse + admin, parking
  b.paint(0x55595e, Surf.Metal);
  flat(b, -3, 12, 1.5, 22, 0.1);
  b.paint(0xe6e8e8, Surf.Plain).box(2.5, 0, 14, 5.5, 3, 17);
  b.paint(0x2a3440, Surf.GlassPlain);
  wallQuad(b, 'nx', 2.5, 14.5, 16.5, 1.1, 2.5);
  officeBlock(b, 7, 10, 23, 18.5, 7.5, 0xe6e4de, 2, 3.6);
  for (let i = 0; i < 4; i++) carLow(b, 9 + i * 2.8, 21.5, 0, rng.pick(CAR_COLORS2));
  b.paint(0x5a5b5e, Surf.Pavement);
  flat(b, 7, 19.5, 23, 23.5, 0.08);
  tank(b, -2, -15, 2.4, 9, 0xb8b4ac, { roof: 'cone', seg: 10, surf: Surf.Plain });
  floodLight(b, -23, -23, 12);
  floodLight(b, 1, 9, 10);
  for (let i = 0; i < 3; i++) tree(b, rng, -21 + i * 8, 22, 6.5, 1.6);
}

// ------------------------------------------------------------------------------------------------ util_recycling_center
function bales(b: ModelBuilder, rng: RNG, x0: number, z0: number, nx: number, nz: number, tiers: number, cols: ColorLike[]): void {
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const t = rng.int(1, tiers);
      for (let k = 0; k < t; k++) b.paint(rng.pick(cols), Surf.Plain).boxC(x0 + i * 1.3, z0 + j * 1.3, 1.2, 1.2, k * 1.1, 1.1);
    }
}

function recycling(b: ModelBuilder, rng: RNG): void {
  const H = 24;
  ground(b, -H, -H, H, H, CONCRETE, Surf.Pavement, 0.05);
  b.paint(0x6f9a45, Surf.Foliage);
  flat(b, -H, 20, H, H, 0.07);
  // sorting hall
  b.paint(0x2e7d4f, Surf.Corrugated).box(-22.5, 0, -22.5, 5, 10, -3);
  b.paint(0xc5c9cc, Surf.Metal).gableRoof(-8.75, -12.75, 27.5, 19.5, 10, 1.6, 'x', 0.3, { color: 0x2e7d4f, surf: Surf.Corrugated });
  b.paint(0xf2f2ee, Surf.Plain);
  wallQuad(b, 'pz', -3, -22.5, 5, 7.6, 8.4);
  b.paint(0x2e7d4f, Surf.Plain);
  wallDisc(b, 'pz', -3, -18.5, 5.2, 1.7, 10, 0.05);
  b.paint(0xf2f2ee, Surf.Plain);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    wallQuad(b, 'pz', -2.9, -18.5 + Math.cos(a) * 0.9 - 0.3, -18.5 + Math.cos(a) * 0.9 + 0.3, 5.2 + Math.sin(a) * 0.9 - 0.3, 5.2 + Math.sin(a) * 0.9 + 0.3, 0.1);
  }
  b.paint(0x2a2d30, Surf.Plain);
  wallQuad(b, 'pz', -3, -13, -7, 0, 5.5);
  wallQuad(b, 'pz', -3, -4, 2, 0, 5.5);
  roofUnit(b, -16, 11.4, -14, 3, 3, 1.6);
  // feed hopper + inclined conveyor into the hall
  b.paint(0x55595e, Surf.Metal).box(7, 0, -12, 11, 3.2, -8);
  b.paint(0xe6a817, Surf.Metal);
  b.tri([6.6, 3.2, -7.6], [11.4, 3.2, -7.6], [9, 1.5, -10]);
  conveyor(b, [9, 2.8, -10], [3.5, 9.2, -10], 1.6, 0xe6a817, 0x55595e, 1);
  // storage bays with bales (right side)
  const bayX = [9, 14, 19];
  for (const x of [...bayX, 24]) wallRun(b, x - 0.5, -22.5, x - 0.5, -14.5, 3.2, 0xa9a59c, Surf.Plain, 0.4);
  wallRun(b, 8.5, -22.8, 23.5, -22.8, 3.2, 0xa9a59c, Surf.Plain, 0.4);
  bales(b, rng, 9.3, -21.5, 3, 5, 3, [0x3f7fd0, 0xe8e8e2, 0x6a9ac8]);
  bales(b, rng, 14.3, -21.5, 3, 5, 3, [0xc0392b, 0xf1c40f, 0x2e7d4f, 0x3f7fd0, 0xe67e22, 0xe8e8e2]);
  bales(b, rng, 19.3, -21.5, 3, 5, 2, [0xb8bcc2, 0x9aa0a6, 0xc8ccd0]);
  heap(b, rng, 17, -7, 3.6, 2.4, 0x5a8a6a, Surf.Metal, 8);
  heap(b, rng, 21, -4, 2.4, 1.8, 0x8a6a42, Surf.Plain, 7);
  // roll-off bins row at the front
  const binC = [0x3f7fd0, 0x2e7d4f, 0xf1c40f, 0xc0392b, 0x55595e];
  for (let i = 0; i < 5; i++) {
    const x = -21 + i * 4.3;
    b.paint(binC[i], Surf.Metal).box(x - 1.3, 0, 1, x + 1.3, 1.8, 6.4, { top: null });
    b.paint(0x5a5550, Surf.Plain);
    flat(b, x - 1.2, 1.1, x + 1.2, 6.3, 1.5);
  }
  bales(b, rng, 1, 3, 2, 3, 2, [0x3f7fd0, 0xe8e8e2]);
  garbageTruck(b, 10, 8, Math.PI * 0.5, 0x2e7d4f);
  garbageTruck(b, 16, 14, -Math.PI * 0.4, 0x3f7fd0);
  forklift(b, 6, -1, Math.PI * 0.3, 0xe6a817);
  officeBlock(b, -22.5, 11, -10, 18.5, 6.5, 0xe6e4de, 2, 3.4);
  signBox(b, -8, 0.4, 19.5, -2, 2.2, 19.9, 0x2e7d4f, 0xe8e8e4);
  for (let i = 0; i < 3; i++) carLow(b, -4 + i * 2.8, 14, 0, rng.pick(CAR_COLORS2));
  floodLight(b, 23, 0, 10);
  fenceRect(b, -23.6, -23.6, 23.6, 19.5, 2.0, 0x8a9096, [-1, 13], 10, 1);
  tree(b, rng, 17, 22, 6, 1.6);
  tree(b, rng, 21.5, 22, 6, 1.6);
}

// ------------------------------------------------------------------------------------------------ util_landfill_tile
function landfill(b: ModelBuilder, v: number, rng: RNG): void {
  const S = 8, Y = 0.35;
  // seamless fill: dirt block edge to edge
  b.paint(DIRT, Surf.Pavement).box(-S, 0, -S, S, Y, S);
  // inner tire tracks (never touching the edges)
  b.paint(0x66583f, Surf.Pavement);
  const ta = rng.range(-3, 3);
  flat(b, -6.5, ta - 0.4, 6.5, ta + 0.4, Y + 0.01);
  flat(b, -6.5, ta + 1.3, 6.5, ta + 2.1, Y + 0.01);
  switch (v) {
    case 0: {
      garbageHeap(b, rng, -2.5, -2, 4.6, 3.4, Y, 30);
      garbageHeap(b, rng, 3.6, 3.2, 3.0, 2.2, Y, 16, 0x6e6658);
      for (let i = 0; i < 10; i++) b.paint(rng.pick(BAG_COLORS), Surf.Plain).boxC(rng.range(-6.5, 6.5), rng.range(-6.5, 6.5), 0.7, 0.6, Y, 0.45);
      break;
    }
    case 1: {
      garbageHeap(b, rng, -1.2, -3, 5.0, 2.8, Y, 24, 0x716555, 1.1, 0.8);
      b.paint(0x6e6450, Surf.Plain);
      heap(b, rng, 2, 3.2, 3.2, 0.9, 0x6e6450, Surf.Plain, 7, 1.4, 0.7);
      bulldozer(b, 3.5, Y, 1.0, -Math.PI * 0.55);
      break;
    }
    case 2: {
      // capped / covered mound with methane vents
      heap(b, rng, 0, 0, 7.0, 2.4, 0x7d7050, Surf.Plain, 10, 1.0, 1.0);
      b.push().translate(0, Y, 0);
      b.paint(0x7f8f4a, Surf.Foliage);
      heap(b, rng, -1.0, -0.8, 4.6, 2.2, 0x7f8f4a, Surf.Foliage, 8);
      b.pop();
      b.paint(0x8a9096, Surf.Metal);
      for (const [x, z] of [[-3, 2.5], [2.5, -2.5], [2.8, 2.8]] as [number, number][]) {
        strut(b, [x, Y + 1.2, z], [x, Y + 3.6, z], 0.3);
        b.paint(0x55595e, Surf.Metal).boxC(x, z, 0.6, 0.6, Y + 3.6, 0.35);
        b.paint(0x8a9096, Surf.Metal);
      }
      for (let i = 0; i < 6; i++) b.paint(rng.pick(BAG_COLORS), Surf.Plain).boxC(rng.range(-6.5, 6.5), rng.range(-6.5, 6.5), 0.6, 0.5, Y, 0.4);
      break;
    }
    default: {
      garbageHeap(b, rng, -3, 2.5, 3.8, 2.6, Y, 22);
      garbageHeap(b, rng, 3.5, -3.5, 3.0, 1.8, Y, 14, 0x7a7060);
      garbageTruck(b, 1.6, 3.0, -Math.PI * 0.35, 0x2e7d4f, 0xf2f2ee, 0.3, Y);
      for (let i = 0; i < 6; i++) b.paint(rng.pick(BAG_COLORS), Surf.Plain).boxC(rng.range(-6.5, 6.5), rng.range(-6.5, 6.5), 0.6, 0.5, Y, 0.4);
      break;
    }
  }
}


export const wasteModels: ModelBuilders = {
  util_incinerator: (b, _v, rng) => incinerator(b, rng),
  util_recycling_center: (b, _v, rng) => recycling(b, rng),
  util_landfill_tile: (b, v, rng) => landfill(b, v, rng),
};
