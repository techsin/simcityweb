/**
 * Industrial / AGRICULTURE models: ind_farm_field, ind_farm_barn, ind_greenhouse.
 */
import type { ModelBuilders } from '../registry';
import type { ModelBuilder, ColorLike } from '../ModelBuilder';
import { PALETTE } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { fence } from '../kit';
import {
  bicone, cone, dome, flat, gambrelRoof, ground, hCyl, lathe, strut, tank, tractor, tree, tube, wallQuad, wallRow,
  disc, smokestack, boxTruck, pallets, carLow, CAR_COLORS2, lattice, barrelRoof, poplar,
} from './ind_kit';

const DIRT = 0x8a6e4b;
const DIRT_DARK = 0x6e5238;
const GRAVEL = 0x9c958a;
const HEDGE = [0x3f6b2e, 0x466f33, 0x38602a];

// ------------------------------------------------------------------------------------------------ field helpers
/** Hedgerow along a line (axis-aligned) broken into segments of varying height with bushy crowns. */
function hedgerow(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, w = 1.6, hMin = 1.3, hMax = 2.3, bushes = 3): void {
  const alongX = Math.abs(z1 - z0) < Math.abs(x1 - x0);
  const len = alongX ? x1 - x0 : z1 - z0;
  const nSeg = Math.max(1, Math.round(Math.abs(len) / 14));
  for (let i = 0; i < nSeg; i++) {
    const t0 = i / nSeg, t1 = (i + 1) / nSeg;
    const h = rng.range(hMin, hMax);
    b.paint(rng.pick(HEDGE), Surf.Foliage);
    if (alongX) b.box(x0 + (x1 - x0) * t0, 0, z0 - w / 2 + rng.range(-0.15, 0.15), x0 + (x1 - x0) * t1, h, z0 + w / 2);
    else b.box(x0 - w / 2 + rng.range(-0.15, 0.15), 0, z0 + (z1 - z0) * t0, x0 + w / 2, h, z0 + (z1 - z0) * t1);
  }
  for (let i = 0; i < bushes; i++) {
    const t = rng.range(0.08, 0.92);
    const x = alongX ? x0 + (x1 - x0) * t : x0;
    const z = alongX ? z0 : z0 + (z1 - z0) * t;
    b.paint(rng.pick(HEDGE), Surf.Foliage);
    bicone(b, x, 1.9, z, rng.range(1.2, 1.5), rng.range(0.9, 1.4), 1.8, 6, rng.next() * 3);
  }
}

/** Crop block: Field-surface top (rows run along X) with foliage/soil sides. */
function crop(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h: number, top: ColorLike, side: ColorLike = top, sideSurf = Surf.Foliage): void {
  b.paint(side, sideSurf).box(x0, 0, z0, x1, h, z1, { top: { color: top, surf: Surf.Field } });
}

function track(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, color: ColorLike = DIRT): void {
  b.paint(color, Surf.Pavement);
  flat(b, x0, z0, x1, z1, 0.08);
}

function roundBale(b: ModelBuilder, x: number, z: number, alongX: boolean, color: ColorLike = 0xc9a954): void {
  b.paint(color, Surf.Plain);
  hCyl(b, x, 0.75, z, 1.3, 0.75, alongX ? 'x' : 'z', 6);
}

/** Combine harvester (~70 tris). Faces +Z by default. */
function combine(b: ModelBuilder, x: number, z: number, rot: number, color: ColorLike): void {
  b.push().translate(x, 0.05, z).rotateY(rot);
  b.paint(0x1c1c1c, Surf.Plain);
  hCyl(b, 0, 0.8, 1.2, 3.2, 0.8, 'x', 6);
  b.paint(color, Surf.Metal).box(-1.5, 0.8, -3.2, 1.5, 2.8, 2.0);
  b.paint(0x2a3138, Surf.Metal).box(-0.9, 2.8, 0.4, 0.9, 3.65, 2.0, { top: { color: 0xe8e8e8, surf: Surf.Metal } });
  b.paint(color, Surf.Metal).box(-4.0, 0.3, 2.4, 4.0, 1.2, 4.2); // header
  b.paint(0xd9c24a, Surf.Metal).box(-4.0, 0.9, 3.6, 4.0, 1.4, 4.3, { bottom: null }); // reel
  b.paint(color, Surf.Metal);
  strut(b, [-1.4, 2.7, -1.0], [-5.0, 3.3, -0.6], 0.45); // unloading auger
  b.pop();
}

// ------------------------------------------------------------------------------------------------ ind_farm_field
function farmField(b: ModelBuilder, v: number, rng: RNG): void {
  const H = 32; // half size
  const E = H - 1.3; // hedge line
  // base: meadow edge grass
  ground(b, -H, -H, H, H, v === 3 ? 0x6f9a45 : 0x7d9a4a, Surf.Foliage, 0.04);
  // track position (enters from the front)
  const tx = [-18, 14, -6, 20, -22, 2][v];
  const tw = 3.6;
  // hedgerows: back + sides always, front with gate gap
  hedgerow(b, rng, -E, -E, E, -E);
  if (v !== 4) hedgerow(b, rng, -E, -E + 1, -E, E - 1, 1.6, 1.2, 2.2, 2);
  hedgerow(b, rng, E, -E + 1, E, E - 1, 1.6, 1.2, 2.2, 2);
  if (v % 2 === 0) {
    hedgerow(b, rng, -E, E, tx - tw / 2 - 1.5, E, 1.4, 1.0, 1.6, 1);
    hedgerow(b, rng, tx + tw / 2 + 1.5, E, E, E, 1.4, 1.0, 1.6, 1);
  } else {
    // wooden post fence along the front
    fence(b, -E, E, tx - tw / 2 - 1, E, 1.2, 0x8b6a47, 4);
    fence(b, tx + tw / 2 + 1, E, E, E, 1.2, 0x8b6a47, 4);
  }
  // field interior bounds
  const fx0 = -E + 1.4, fx1 = E - 1.4, fz0 = -E + 1.4, fz1 = E - 1.6;
  const ta = tx - tw / 2, tb = tx + tw / 2;
  switch (v) {
    case 0: {
      // WHEAT: golden standing crop, partly harvested strip with round bales + combine
      track(b, ta, fz0, tb, H);
      const hz = -2; // harvest line (z) on the right side of track
      crop(b, fx0, fz0, ta - 0.6, fz1, 0.75, 0xcfa543, 0xb8903a);
      crop(b, tb + 0.6, fz0, fx1, hz, 0.75, 0xd2aa48, 0xb8903a);
      // stubble
      b.paint(0xbfa468, Surf.Field).box(tb + 0.6, 0, hz, fx1, 0.14, fz1);
      for (let i = 0; i < 9; i++) roundBale(b, rng.range(tb + 3, fx1 - 2), rng.range(hz + 3, fz1 - 2), rng.chance(0.5));
      combine(b, 12, hz + 1.2, Math.PI * 0.5, 0x3f8f3a);
      tractor(b, tb + 4, fz1 - 4, Math.PI * 0.15, 0xc0392b);
      break;
    }
    case 1: {
      // CORN: tall dense green canopy with a cross track
      track(b, ta, fz0, tb, H);
      track(b, fx0, -4, fx1, -0.6);
      crop(b, fx0, fz0, ta - 0.5, -4.6, 2.4, 0x4f8228, 0x44702a);
      crop(b, tb + 0.5, fz0, fx1, -4.6, 2.4, 0x55892a, 0x44702a);
      crop(b, fx0, 0, ta - 0.5, fz1, 2.2, 0x5f9030, 0x4d7a2a);
      crop(b, tb + 0.5, 0, fx1, fz1, 1.2, 0x86a53e, 0x6e8f33); // younger crop
      // grain wagon + tractor on the track
      b.paint(0xc0392b, Surf.Metal).box(tb + 1.2, 0.8, -3.6, tb + 7.2, 2.6, -1.0);
      b.paint(0x1c1c1c, Surf.Plain);
      hCyl(b, tb + 4.2, 0.5, -2.3, 2.9, 0.5, 'z', 6);
      tractor(b, tb + 9.5, -2.3, Math.PI * 0.5, 0x2f6b2a);
      break;
    }
    case 2: {
      // VEGETABLES: strips of mixed crops (rows along X) + wheel-line irrigation
      track(b, ta, fz0, tb, H);
      const crops: [ColorLike, number][] = [
        [0x7fb24a, 0.35], [0x6e5238, 0.12], [0x86a8a0, 0.4], [0x7a3f5e, 0.3], [0x5f9a3a, 0.32], [0xd07a2a, 0.3], [0x9bc25a, 0.28], [0x6e5238, 0.1],
      ];
      let z = fz0;
      let k = rng.int(0, 3);
      while (z < fz1 - 1) {
        const w = Math.min(rng.range(5.5, 9.5), fz1 - z);
        const [c, h] = crops[k++ % crops.length];
        const sideC = h < 0.15 ? DIRT_DARK : 0x5a7a34;
        crop(b, fx0, z, ta - 0.5, z + w - 0.5, h, c, sideC, h < 0.15 ? Surf.Plain : Surf.Foliage);
        const [c2, h2] = crops[(k + 3) % crops.length];
        crop(b, tb + 0.5, z, fx1, z + w - 0.5, h2, c2, h2 < 0.15 ? DIRT_DARK : 0x5a7a34, h2 < 0.15 ? Surf.Plain : Surf.Foliage);
        b.paint(DIRT, Surf.Pavement);
        flat(b, fx0, z + w - 0.5, fx1, z + w, 0.06);
        z += w;
      }
      // wheel-line irrigator along X on the right half
      b.paint(0xc8ccd0, Surf.Metal);
      const iz = rng.range(-8, 4);
      strut(b, [tb + 2, 1.4, iz], [fx1 - 1, 1.4, iz], 0.28);
      for (let x = tb + 3; x < fx1 - 1; x += 7) {
        strut(b, [x - 0.8, 0, iz], [x, 1.4, iz], 0.12);
        strut(b, [x + 0.8, 0, iz], [x, 1.4, iz], 0.12);
      }
      // farm stand shed near the front
      b.paint(0xe9e2cf, Surf.Wood).box(tb + 2, 0, fz1 - 5, tb + 7, 2.4, fz1 - 1.5);
      b.paint(0x7a4a32, Surf.RoofTiles).gableRoof(tb + 4.5, fz1 - 3.25, 5, 3.5, 2.4, 1.1, 'x', 0.4, { color: 0xe9e2cf, surf: Surf.Wood });
      // produce crates
      for (let i = 0; i < 4; i++) b.paint(rng.pick([0xd07a2a, 0x7fb24a, 0xc0392b]), Surf.Wood).boxC(tb + 2.6 + i * 1.3, fz1 - 0.7, 1.1, 0.9, 0, 0.6);
      break;
    }
    case 3: {
      // ORCHARD: mown grass rows between tree rows
      track(b, ta, fz0, tb, H, 0x9a8a60);
      b.paint(0x78a24c, Surf.Field).box(fx0, 0, fz0, ta - 0.5, 0.1, fz1);
      b.paint(0x78a24c, Surf.Field).box(tb + 0.5, 0, fz0, fx1, 0.1, fz1);
      const rows = 8;
      const green = rng.pick([0x4f7f32, 0x5a8a36, 0x46752e]);
      const fruit = rng.chance(0.5);
      for (let r = 0; r < rows; r++) {
        const z = fz0 + 2.8 + r * ((fz1 - fz0 - 5.2) / (rows - 1));
        for (let x = fx0 + 2.5; x < fx1 - 1.5; x += 6.6) {
          if (Math.abs(x - tx) < tw / 2 + 2.2) continue;
          const s = rng.range(0.9, 1.1);
          b.paint(fruit && r % 2 ? 0x5f8a3a : green, Surf.Foliage);
          bicone(b, x, 2.0 * s, z, 1.9 * s, 1.3 * s, 1.5 * s, 5, rng.next() * 3);
        }
      }
      // fruit crates stack + small tractor
      for (let i = 0; i < 6; i++) b.paint(0x9a7a4e, Surf.Wood).boxC(tb + 2 + (i % 3) * 1.4, fz1 - 1.5 - Math.floor(i / 3) * 1.4, 1.2, 1.2, 0, 1.0);
      tractor(b, tb + 7, fz1 - 3, Math.PI * 0.6, 0x2f6b2a);
      break;
    }
    case 4: {
      // VINEYARD: trellised rows running along Z (down-slope), grassy alleys
      track(b, ta, fz0, tb, H, 0xa89a78);
      b.paint(0x8a8a50, Surf.Field).box(-E, 0, fz0, fx1, 0.08, fz1);
      const pitch = 2.9;
      for (let x = -E + 1.4; x < fx1 - 0.3; x += pitch) {
        if (Math.abs(x - tx) < tw / 2 + 0.8) continue;
        b.paint(rng.pick([0x4d7a2c, 0x557f30, 0x4a7430]), Surf.Foliage).box(x - 0.4, 0.5, fz0 + 1, x + 0.4, 1.7, fz1 - 1.5, { bottom: null });
        b.paint(0x6b5238, Surf.Wood);
        strut(b, [x, 0, fz1 - 1.3], [x, 1.9, fz1 - 1.3], 0.16);
      }
      // stone tool house at the front
      b.paint(0xc8b99a, Surf.Stone).box(tb + 1.5, 0, fz1 - 5.5, tb + 6.5, 2.5, fz1 - 1.8);
      b.paint(0xa4442e, Surf.RoofTiles).gableRoof(tb + 4, fz1 - 3.65, 5, 3.7, 2.5, 1.1, 'x', 0.35, { color: 0xc8b99a, surf: Surf.Stone });
      // row of cypresses along the track
      for (let z = fz0 + 4; z < fz1 - 6; z += 9) {
        b.paint(0x2f5a2e, Surf.Foliage);
        bicone(b, ta - 0.1, 1.6, z, 0.9, 1.9, 1.6, 5, z);
      }
      break;
    }
    default: {
      // SUNFLOWERS (left) + LAVENDER rows (right)
      track(b, ta, fz0, tb, H);
      crop(b, fx0, fz0, ta - 0.5, fz1, 1.9, 0xdcb21c, 0x5f8a2e);
      // a few darker sunflower heads patches (flower centers) via a slightly lower inner block
      b.paint(0x6e5238, Surf.Field).box(tb + 0.5, 0, fz0, fx1, 0.1, fz1);
      for (let z = fz0 + 1; z < fz1 - 0.6; z += 2.0) {
        b.paint(rng.pick([0x8a6fc0, 0x9170c8, 0x7f63b3]), Surf.Foliage).box(tb + 1.2, 0.1, z, fx1 - 0.6, 0.85, z + 1.05, { bottom: null });
      }
      // bee hives
      for (let i = 0; i < 4; i++) b.paint(rng.pick([0xf2f0ea, 0xe3c35a, 0x7fa0c0]), Surf.Wood).boxC(ta - 2 - i * 1.6, fz1 + 0.4, 0.8, 0.8, 0, 0.9);
      break;
    }
  }
}

// ------------------------------------------------------------------------------------------------ ind_farm_barn
function silo(b: ModelBuilder, x: number, z: number, r: number, h: number, body: ColorLike, domeC: ColorLike, surf = Surf.Plain, bands = true): void {
  b.paint(body, surf);
  tube(b, x, z, 0, h, r, r, 12);
  if (bands) {
    b.paint(0x8a8680, Surf.Metal);
    for (let y = 2.5; y < h - 1; y += 2.6) tube(b, x, z, y, 0.18, r + 0.05, r + 0.05, 12);
  }
  b.paint(domeC, Surf.Metal);
  dome(b, x, z, h, r, r * 0.6, 12, 3);
  // chute / ladder
  b.paint(0x5a5d60, Surf.Metal);
  strut(b, [x + r + 0.3, 0, z], [x + r + 0.3, h + 0.4, z], 0.35);
}

function grainBin(b: ModelBuilder, x: number, z: number, r: number, h: number, color: ColorLike = 0xbfc4c8): void {
  b.paint(0x9a978f, Surf.Pavement);
  disc(b, x, z, 0.12, r + 0.6, 10);
  b.paint(color, Surf.Corrugated);
  tube(b, x, z, 0, h, r, r, 14);
  b.paint(0xd0d4d7, Surf.Metal);
  lathe(b, x, z, [[r + 0.2, h - 0.1], [0.7, h + r * 0.55], [0.0, h + r * 0.62]], 14);
}

function farmhouse(b: ModelBuilder, x: number, z: number, w: number, d: number, wall: ColorLike, roof: ColorLike, wallSurf: Surf, rot = 0): void {
  b.push().translate(x, 0, z).rotateY(rot);
  b.paint(wall, wallSurf === Surf.WallWindows ? Surf.WallWindows : wallSurf, 0, 2.9).box(-w / 2, 0, -d / 2, w / 2, 5.6, d / 2);
  if (wallSurf !== Surf.WallWindows) {
    b.paint(0x2a3440, Surf.GlassPlain);
    wallRow(b, 'pz', d / 2, -w / 2 + 0.6, w / 2 - 0.6, 3.6, 4.9, 3, 1.0);
    wallQuad(b, 'pz', d / 2, -w / 2 + 0.8, -w / 2 + 1.8, 0.9, 2.1);
    wallQuad(b, 'pz', d / 2, w / 2 - 1.8, w / 2 - 0.8, 0.9, 2.1);
    wallRow(b, 'px', w / 2, -d / 2 + 0.6, d / 2 - 0.6, 1.0, 2.2, 2, 1.0);
    wallRow(b, 'nx', -w / 2, -d / 2 + 0.6, d / 2 - 0.6, 3.6, 4.9, 2, 1.0);
  }
  b.paint(roof, Surf.RoofTiles).gableRoof(0, 0, w, d, 5.6, 2.8, 'x', 0.45, { color: wall, surf: wallSurf === Surf.WallWindows ? Surf.Plain : wallSurf });
  // porch
  b.paint(0xf2efe6, Surf.Wood).box(-w / 2 + 0.6, 0, d / 2, w / 2 - 0.6, 0.4, d / 2 + 2.0);
  b.paint(roof, Surf.RoofTiles).box(-w / 2 + 0.4, 2.8, d / 2, w / 2 - 0.4, 3.0, d / 2 + 2.1, { bottom: { color: 0xe8e4da, surf: Surf.Plain } });
  b.paint(0xf2efe6, Surf.Wood);
  for (const px of [-w / 2 + 0.7, 0, w / 2 - 0.7]) strut(b, [px, 0.4, d / 2 + 1.9], [px, 2.8, d / 2 + 1.9], 0.18);
  // chimney
  b.paint(0x7d4a33, Surf.Brick).boxC(w / 2 - 1.3, 0.3, 0.8, 0.8, 5.6, 3.6);
  b.pop();
}

function farmBarn(b: ModelBuilder, v: number, rng: RNG): void {
  const H = 16;
  ground(b, -H, -H, H, H, 0x7f9c4c, Surf.Foliage, 0.04);
  switch (v) {
    case 0: {
      // classic red gambrel barn + concrete silos + white farmhouse
      track(b, -10.5, -4, -7.5, H, GRAVEL);
      track(b, -9, -11, 12, -1.5, GRAVEL);
      const bx = 3.5, bz = -7.5, bw = 13, bd = 14;
      b.paint(0x9c3326, Surf.Wood).box(bx - bw / 2, 0, bz - bd / 2, bx + bw / 2, 5.2, bz + bd / 2);
      b.paint(0x5b5f63, Surf.RoofTiles);
      gambrelRoof(b, bx, bz, bw, bd, 5.2, 3.2, 2.6, 0x9c3326, Surf.Wood);
      // white trim + big doors (front)
      b.paint(0xf2efe6, Surf.Wood);
      wallQuad(b, 'pz', bz + bd / 2, bx - 2.6, bx + 2.6, 0, 4.4);
      b.paint(0x9c3326, Surf.Wood);
      wallQuad(b, 'pz', bz + bd / 2 + 0.02, bx - 2.3, bx + 2.3, 0, 4.1);
      b.paint(0xf2efe6, Surf.Plain);
      strut(b, [bx - 2.3, 0.1, bz + bd / 2 + 0.1], [bx + 2.3, 4.0, bz + bd / 2 + 0.1], 0.15);
      strut(b, [bx + 2.3, 0.1, bz + bd / 2 + 0.1], [bx - 2.3, 4.0, bz + bd / 2 + 0.1], 0.15);
      wallQuad(b, 'pz', bz + bd / 2, bx - 1.0, bx + 1.0, 6.2, 7.6);
      b.paint(0x2a2a2a, Surf.Plain);
      wallQuad(b, 'pz', bz + bd / 2 + 0.02, bx - 0.8, bx + 0.8, 6.35, 7.45);
      // cupola
      b.paint(0xf2efe6, Surf.Wood).boxC(bx, bz, 1.4, 1.4, 10.6, 1.2);
      b.paint(0x5b5f63, Surf.RoofTiles).pyramid(bx, bz, 1.9, 1.9, 11.8, 1.1);
      // silos
      silo(b, 12, -11.5, 2.3, 13.5, 0xcfc8b8, 0x9aa0a6);
      silo(b, 12.2, -5.8, 2.0, 11.5, 0xc8c0ae, 0x9aa0a6);
      // farmhouse
      farmhouse(b, -8.5, 8.5, 9, 6.5, 0xf2efe6, 0x4f555c, Surf.Wood);
      lawnPatch(b, -H + 0.5, 3, -2.6, H - 0.5);
      // paddock with white fence + tractor
      fence(b, 0, 2, 14.5, 2, 1.2, 0xf2efe6, 3);
      fence(b, 14.5, 2, 14.5, 14.5, 1.2, 0xf2efe6, 3);
      fence(b, 14.5, 14.5, 0, 14.5, 1.2, 0xf2efe6, 3);
      fence(b, 0, 14.5, 0, 2, 1.2, 0xf2efe6, 3);
      for (let i = 0; i < 3; i++) roundBale(b, rng.range(3, 11), rng.range(5, 12), rng.chance(0.5));
      tractor(b, -3, -3.5, Math.PI * 0.35, 0x2f6b2a);
      tree(b, rng, -13, -12, 9, 2.6);
      tree(b, rng, -3.5, 12.8, 8, 2.4);
      break;
    }
    case 1: {
      // modern steel machine shed + grain bin battery + grain leg
      track(b, -H, -2, H, 2.5, GRAVEL);
      track(b, 2, 2.5, 6, H, GRAVEL);
      const sw = 16, sd = 11, sx = -6.5, sz = -9.5;
      b.paint(0x6f7f6a, Surf.Corrugated).box(sx - sw / 2, 0, sz - sd / 2, sx + sw / 2, 5.5, sz + sd / 2);
      b.paint(0xc9ccce, Surf.Metal).gableRoof(sx, sz, sw, sd, 5.5, 1.8, 'x', 0.4, { color: 0x6f7f6a, surf: Surf.Corrugated });
      b.paint(0xd8dadc, Surf.Corrugated);
      wallQuad(b, 'pz', sz + sd / 2, sx - 6.5, sx - 1, 0, 4.6);
      wallQuad(b, 'pz', sz + sd / 2, sx + 1, sx + 6.5, 0, 4.6);
      // bins
      grainBin(b, 5.5, -11, 3.6, 8.2);
      grainBin(b, 12.2, -11, 3.2, 7.2);
      grainBin(b, 12.4, -4.6, 2.6, 6.4, 0xb3b8bc);
      // grain leg (lattice tower + spouts)
      b.paint(0x8a9096, Surf.Metal);
      lattice(b, 9, -6.5, 0, 14.5, 0.7, 0.55, 0.7, 0.55, 5, 0.18);
      b.paint(0xbfc4c8, Surf.Metal).boxC(9, -6.5, 1.8, 1.8, 14.5, 1.4);
      strut(b, [9, 14.2, -6.5], [5.5, 11.6, -11], 0.35);
      strut(b, [9, 14.2, -6.5], [12.2, 10.2, -11], 0.35);
      strut(b, [9, 14.2, -6.5], [12.4, 9.0, -4.6], 0.35);
      // dryer
      b.paint(0x3f6f9a, Surf.Metal).box(1.5, 0, -5.5, 4.5, 6.5, -3.5);
      // farmhouse (beige)
      farmhouse(b, -8.5, 9.5, 9.5, 6.5, 0xe0d2b0, 0x6b4a36, Surf.Wood);
      lawnPatch(b, -H + 0.5, 3.2, -1.5, H - 0.5);
      tractor(b, 8, 6, -Math.PI * 0.2, 0xc0392b);
      boxTruck(b, 11.5, 9, Math.PI, 0x2e6fb5, 0xd8d8d0);
      tree(b, rng, -13, 12.8, 9, 2.6);
      tree(b, rng, 13, 12.8, 8, 2.4);
      break;
    }
    case 2: {
      // dairy: long white free-stall barn, blue Harvestore silos, wrapped bales, brick farmhouse
      track(b, 6, -2, 9, H, GRAVEL);
      b.paint(0xa89c86, Surf.Pavement);
      flat(b, -H + 0.5, -14.5, H - 0.5, -2, 0.07);
      const bx = -5, bz = -8.8, bw = 20, bd = 10;
      b.paint(0xf0ede4, Surf.Plain).box(bx - bw / 2, 0, bz - bd / 2, bx + bw / 2, 3.6, bz + bd / 2);
      b.paint(0x2e2f33, Surf.Plain);
      wallQuad(b, 'pz', bz + bd / 2, bx - bw / 2 + 0.5, bx + bw / 2 - 0.5, 1.5, 3.3);
      wallQuad(b, 'nz', bz - bd / 2, bx - bw / 2 + 0.5, bx + bw / 2 - 0.5, 1.5, 3.3);
      b.paint(0x9c3326, Surf.Metal).gableRoof(bx, bz, bw, bd, 3.6, 2.6, 'x', 0.7, { color: 0xf0ede4, surf: Surf.Plain });
      b.paint(0xd8d4c8, Surf.Metal).boxC(bx, bz, bw - 2, 1.2, 6.15, 0.35);
      // milk house
      b.paint(0xf0ede4, Surf.Plain).box(bx + bw / 2, 0, bz - 2.5, bx + bw / 2 + 4, 3.2, bz + 2.5);
      b.paint(0x9c3326, Surf.Metal).gableRoof(bx + bw / 2 + 2, bz, 4, 5, 3.2, 1.3, 'z', 0.3, { color: 0xf0ede4, surf: Surf.Plain });
      // Harvestore silos
      silo(b, 11.6, -11.6, 2.4, 14.5, 0x243f63, 0x2c4d78, Surf.Metal, false);
      silo(b, 11.6, -5.6, 2.1, 12.5, 0x243f63, 0x2c4d78, Surf.Metal, false);
      b.paint(0xd8d0bc, Surf.Plain);
      for (const [x, z] of [[11.6, -11.6], [11.6, -5.6]] as [number, number][]) {
        tube(b, x, z, 12.2, 0.6, x > 0 && z < -8 ? 2.42 : 2.12, undefined, 12);
      }
      // wrapped bales (white) in a row
      for (let i = 0; i < 6; i++) roundBale(b, -13 + i * 1.5, -0.2, false, 0xf2f2ee);
      // brick farmhouse
      farmhouse(b, -7, 9.5, 9, 6.5, 0x9c4a36, 0x3c3f44, Surf.Brick);
      lawnPatch(b, -H + 0.5, 3.2, 4.5, H - 0.5);
      // manure lagoon / feed bunker
      b.paint(0x8e8b84, Surf.Pavement).box(-14.5, 0, -1, -9, 1.0, 2.5, { bottom: null });
      b.paint(0x7a8a3a, Surf.Plain);
      flat(b, -14, -0.6, -9.5, 2.1, 1.02);
      tractor(b, 2, 0.5, Math.PI * 0.5, 0x2f6b2a);
      tree(b, rng, 12.8, 12.8, 9, 2.7);
      tree(b, rng, -13, 13, 7, 2.3);
      break;
    }
    default: {
      // old weathered wooden barn, stone farmhouse, farm windmill, haystacks, coop
      track(b, 5, -3, 8.5, H, DIRT);
      track(b, -12, -4.5, 8.5, -1.5, DIRT);
      const bx = -4, bz = -9, bw = 12, bd = 10;
      b.paint(0x7a6650, Surf.Wood).box(bx - bw / 2, 0, bz - bd / 2, bx + bw / 2, 4.8, bz + bd / 2);
      b.paint(0x8b5a3a, Surf.Corrugated).gableRoof(bx, bz, bw, bd, 4.8, 3.6, 'x', 0.6, { color: 0x7a6650, surf: Surf.Wood });
      // lean-to
      b.paint(0x6e5c48, Surf.Wood).box(bx + bw / 2, 0, bz - bd / 2 + 1, bx + bw / 2 + 4, 3.0, bz + bd / 2 - 1);
      b.paint(0x8b5a3a, Surf.Corrugated).shedRoof(bx + bw / 2 + 2, bz, 4, bd - 2, 3.0, 1.2, 'nx');
      b.paint(0x2a2622, Surf.Plain);
      wallQuad(b, 'pz', bz + bd / 2, bx - 2.2, bx + 2.2, 0, 3.8);
      // stone farmhouse
      farmhouse(b, -8.5, 9.3, 9, 6.5, 0xb8ab94, 0x6b4a36, Surf.Stone);
      lawnPatch(b, -H + 0.5, 3.4, -1.6, H - 0.5);
      // windmill (Aermotor style)
      const wx = 10.5, wz = -9;
      b.paint(0x8a9096, Surf.Metal);
      lattice(b, wx, wz, 0, 11, 1.4, 0.35, 1.4, 0.35, 4, 0.16);
      b.paint(0x9aa0a6, Surf.Metal).boxC(wx, wz + 0.3, 0.6, 1.4, 11, 0.6);
      b.paint(0xd8dadc, Surf.Metal);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        b.quad2([wx + c * 0.5, 11.3 + s * 0.5, wz + 1.0], [wx + c * 2.3 - s * 0.35, 11.3 + s * 2.3 + c * 0.35, wz + 1.0],
          [wx + c * 2.3 + s * 0.35, 11.3 + s * 2.3 - c * 0.35, wz + 1.0], [wx + c * 0.5, 11.3 + s * 0.5, wz + 1.0]);
      }
      b.paint(0xc0392b, Surf.Metal).quad2([wx, 11.1, wz - 0.3], [wx, 11.5, wz - 0.3], [wx, 12.0, wz - 2.6], [wx, 10.8, wz - 2.6]);
      // stock tank
      b.paint(0x8a9096, Surf.Metal);
      tube(b, wx - 2.5, wz + 3, 0, 0.8, 1.4, 1.4, 10);
      b.paint(0x4f7f9a, Surf.Water);
      disc(b, wx - 2.5, wz + 3, 0.7, 1.35, 10);
      // haystacks, coop, fence
      for (let i = 0; i < 2; i++) {
        b.paint(0xc9a954, Surf.Plain);
        lathe(b, 11 + i * 3.6, 3 + i * 2.5, [[1.6, 0], [1.7, 1.5], [1.1, 2.8], [0, 3.4]], 7);
      }
      b.paint(0xd9c9a0, Surf.Wood).box(8, 0, 9.5, 11.5, 1.8, 12.5);
      b.paint(0x8b5a3a, Surf.Corrugated).shedRoof(9.75, 11, 3.5, 3, 1.8, 0.6, 'nz');
      fence(b, 3.5, 7.5, 14.5, 7.5, 1.1, 0x8b6a47, 3.5);
      fence(b, 14.5, 7.5, 14.5, 14.5, 1.1, 0x8b6a47, 3.5);
      tractor(b, 1.5, -1, -Math.PI * 0.3, 0x2e6fb5);
      tree(b, rng, -12.8, -2, 10, 2.8);
      tree(b, rng, 1, 12.8, 8, 2.5);
      poplar(b, rng, 14.5, -14.5, 12);
      break;
    }
  }
}

function lawnPatch(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number): void {
  b.paint(0x6f9a45, Surf.Foliage);
  flat(b, x0, z0, x1, z1, 0.07);
}

// ------------------------------------------------------------------------------------------------ ind_greenhouse
/** Venlo-type multi-span glasshouse: ridges along Z, spans across X. */
function venlo(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h: number, span: number, glassPattern = 4, frame: ColorLike = 0xe8ecee): void {
  b.paint(0xb8c4c8, Surf.GlassCurtain, glassPattern, 1.2).box(x0, 0, z0, x1, h, z1, { top: null });
  const n = Math.max(1, Math.round((x1 - x0) / span));
  const sw = (x1 - x0) / n;
  const rh = sw * 0.24;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * sw, c = a + sw / 2, e = a + sw;
    b.paint(0xc8d4d8, Surf.GlassCurtain, glassPattern, 1.2);
    b.quad([a, h, z1], [c, h + rh, z1], [c, h + rh, z0], [a, h, z0]);
    b.quad([c, h + rh, z1], [e, h, z1], [e, h, z0], [c, h + rh, z0]);
    b.paint(frame, Surf.Metal);
    b.tri([a, h, z1], [e, h, z1], [c, h + rh, z1]);
    b.tri([e, h, z0], [a, h, z0], [c, h + rh, z0]);
  }
  // gutters / frame lines
  b.paint(frame, Surf.Metal);
  for (let i = 0; i <= n; i++) strut(b, [x0 + i * sw, h + 0.05, z0], [x0 + i * sw, h + 0.05, z1], 0.14);
}

function greenhouse(b: ModelBuilder, v: number, rng: RNG): void {
  const HX = 24, HZ = 16;
  ground(b, -HX, -HZ, HX, HZ, 0x9c958a, Surf.Pavement, 0.04);
  switch (v) {
    case 0: {
      // one large Venlo block + packing shed with docks + water tank
      b.paint(0x6f9a45, Surf.Foliage);
      flat(b, -HX, 11.5, HX, HZ, 0.06);
      venlo(b, -22.5, -14.5, 12, 7.5, 4.3, 4.0);
      // packing shed on the right
      b.paint(0xe6e8e8, Surf.Corrugated).box(13.5, 0, -14.5, 22.5, 6.2, 4);
      b.paint(0xb9bec2, Surf.Metal).gableRoof(18, -5.25, 9, 18.5, 6.2, 0.9, 'z', 0.3, { color: 0xe6e8e8, surf: Surf.Corrugated });
      b.paint(0x2e7d4f, Surf.Plain);
      wallQuad(b, 'px', 22.5, -13.5, 3, 4.6, 5.4);
      b.paint(0x6a6e72, Surf.Metal);
      wallRow(b, 'nx', 13.5, -12, 2, 0.1, 3.6, 3, 3.0);
      b.paint(0x5c6166, Surf.Metal);
      wallQuad(b, 'pz', 4, 15, 21, 0.1, 4.2);
      boxTruck(b, 18, 8.8, 0, 0xf2f2ee, 0x2e7d4f);
      // water basin & tank
      tank(b, -18, 11.3, 2.6, 5.2, 0x3a5a3a, { roof: 'flat', roofColor: 0x2e3a2e });
      b.paint(0x4f7f9a, Surf.Water);
      flat(b, -13, 9, -3, 11, 0.12);
      pallets(b, 11, 10, 1.4);
      pallets(b, 9.5, 10.2, 0.9);
      for (let i = 0; i < 3; i++) carLow(b, -2 + i * 3, 13.2, 0, rng.pick(CAR_COLORS2));
      break;
    }
    case 1: {
      // hoop polytunnels along Z + packing barn
      b.paint(0x7d9a4a, Surf.Foliage);
      flat(b, -HX, -HZ, HX, HZ, 0.05);
      const n = 5;
      for (let i = 0; i < n; i++) {
        const cx = -20 + i * 7.2;
        b.paint(0xeef1ee, Surf.Plain);
        polytunnel(b, cx, -14.5, 6.0, 25, 3.4);
      }
      b.paint(DIRT, Surf.Pavement);
      flat(b, -23.5, 10.5, 23.5, 13, 0.07);
      // barn
      b.paint(0x8a4a38, Surf.Wood).box(14, 0, -14.5, 23, 5, -1);
      b.paint(0x5b5f63, Surf.Corrugated).gableRoof(18.5, -7.75, 9, 13.5, 5, 1.8, 'z', 0.4, { color: 0x8a4a38, surf: Surf.Wood });
      b.paint(0x2a2622, Surf.Plain);
      wallQuad(b, 'pz', -1, 16, 21, 0, 3.8);
      // produce bins + tractor
      for (let i = 0; i < 6; i++) b.paint(rng.pick([0x9a7a4e, 0x8a6a42]), Surf.Wood).boxC(15.5 + (i % 3) * 1.6, 2 + Math.floor(i / 3) * 1.6, 1.3, 1.3, 0, 1.1);
      tractor(b, 18, 7, Math.PI * 0.5, 0xc0392b);
      tank(b, 21, 7, 1.4, 3.2, 0x2e2f33, { roof: 'flat' });
      break;
    }
    default: {
      // three separate gable glasshouses (one whitewashed), boiler house with stack, reservoir
      b.paint(0x6f9a45, Surf.Foliage);
      flat(b, -HX, 9, HX, HZ, 0.06);
      for (let i = 0; i < 3; i++) {
        const cx = -17 + i * 11;
        const tint = i === 1 ? 0 : 4;
        b.paint(i === 1 ? 0xdfe6e6 : 0xb8c4c8, Surf.GlassCurtain, tint, 1.2).box(cx - 4.5, 0, -14.5, cx + 4.5, 3.0, 7);
        b.paint(i === 1 ? 0xeef1ef : 0xc8d4d8, i === 1 ? Surf.Plain : Surf.GlassCurtain, 4, 1.2)
          .gableRoof(cx, -3.75, 9, 21.5, 3.0, 2.2, 'z', 0.1, { color: 0xc8d4d8, surf: Surf.GlassCurtain, pattern: 4, floor: 1.2 });
        b.paint(0xf0f2f2, Surf.Metal);
        strut(b, [cx, 5.25, -14.6], [cx, 5.25, 7.1], 0.18);
      }
      // boiler house + small stack
      b.paint(0x9c4a36, Surf.Brick).box(15, 0, -14.5, 22.5, 4.5, -7);
      b.paint(0x5b5f63, Surf.RoofTiles).gableRoof(18.75, -10.75, 7.5, 7.5, 4.5, 1.6, 'x', 0.3, { color: 0x9c4a36, surf: Surf.Brick });
      smokestack(b, 20.8, -12.6, 7.3, 0.5, 0.42, 'steel', 8, { light: false });
      // reservoir pond
      b.paint(0x8e8b84, Surf.Pavement).box(15, 0, -5, 22.5, 0.6, 5, { bottom: null });
      b.paint(0x3f7ea6, Surf.Water);
      flat(b, 15.4, -4.6, 22.1, 4.6, 0.62);
      // packing shed front
      b.paint(0xe6e8e8, Surf.Corrugated).box(-22.5, 0, 9.5, -8, 4.2, 14.5);
      b.paint(0xb9bec2, Surf.Metal).gableRoof(-15.25, 12, 14.5, 5, 4.2, 0.8, 'x', 0.3, { color: 0xe6e8e8, surf: Surf.Corrugated });
      b.paint(0x5c6166, Surf.Metal);
      wallRow(b, 'pz', 14.5, -21, -9.5, 0.1, 3.4, 2, 3.4);
      for (let i = 0; i < 3; i++) carLow(b, -3 + i * 3, 12.8, 0, rng.pick(CAR_COLORS2));
      boxTruck(b, 9, 12.4, Math.PI * 0.5, 0xf2f2ee, 0xc0392b);
      break;
    }
  }
}

/** Hoop tunnel (half-ellipse cross-section) running along Z from z0, length L. */
function polytunnel(b: ModelBuilder, cx: number, z0: number, w: number, L: number, h: number): void {
  const seg = 6;
  const pts: [number, number][] = [];
  for (let i = 0; i <= seg; i++) {
    const t = Math.PI * (1 - i / seg);
    pts.push([cx + Math.cos(t) * w / 2, Math.sin(t) * h]);
  }
  const z1 = z0 + L;
  for (let i = 0; i < seg; i++) {
    const [xa, ya] = pts[i], [xb, yb] = pts[i + 1];
    b.quad([xa, ya, z1], [xb, yb, z1], [xb, yb, z0], [xa, ya, z0]);
  }
  // end walls
  b.paint(0xd6dcd8, Surf.Plain);
  for (let i = 0; i < seg; i++) {
    const [xa, ya] = pts[i], [xb, yb] = pts[i + 1];
    b.tri([cx, 0, z1], [xb, yb, z1], [xa, ya, z1]);
    b.tri([cx, 0, z0], [xa, ya, z0], [xb, yb, z0]);
  }
  b.paint(0x5c6166, Surf.Plain);
  wallQuad(b, 'pz', z1, cx - 0.9, cx + 0.9, 0, 2.2);
}

// keep unused-import linting quiet for helpers we may use later
void cone; void barrelRoof;

export const agriModels: ModelBuilders = {
  ind_farm_field: (b, v, rng) => farmField(b, v, rng),
  ind_farm_barn: (b, v, rng) => farmBarn(b, v, rng),
  ind_greenhouse: (b, v, rng) => greenhouse(b, v, rng),
};
