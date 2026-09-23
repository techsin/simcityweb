/**
 * Procedural models for the 'park' group. See src/assets/manifest.ts for ids, footprints and descriptions,
 * and src/assets/ModelBuilder.ts for the modeling API. Shared helpers live in ./park_lib.ts, the big 6x6 venues
 * (zoo, golf, stadium, amusement park) in ./park_venues.ts.
 */
import type { ModelBuilders } from '../registry';
import { ModelBuilder, PALETTE } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { car } from '../kit';
import {
  type P2, type V3, lawnPatchwork, path, pond, tree, shrub, flowerBed, roundBed, hedgeBox, lamp, parkBench, bin, fountain,
  bleachers, floodMast, railFence, panelFence, goal, person, umbrella, disc, annulus, ribbon, rect, rectLines, line, arcPts,
  cylWall, lathe, flatPoly, blobPoly, spline, track3D, shade, inPoly, lotModels,
  GRASS_LUSH, GRASS_DARK, MEADOW, PATH_GRAVEL, PATH_PAVE, PATH_RED, STONE_RIM, FLOWERS, LAMP_GLOW,
} from './park_lib';
import { venueModels } from './park_venues';

const TAU = Math.PI * 2;
const WHITE_LINE = 0xf2f2ee;

// ------------------------------------------------------------------------------------------------ shared bits
/** Hexagonal / octagonal gazebo with columns and a pointed roof. */
function gazebo(b: ModelBuilder, x: number, z: number, r: number, sides = 6, roof = 0x7a4a36, trim = 0xf1ede2): number {
  b.paint(0xd9d2c3, Surf.Stone).prism(x, z, r + 0.4, sides, 0, 0.45, Math.PI / sides);
  b.paint(trim, Surf.Wood);
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU + Math.PI / sides;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    b.box(px - 0.12, 0.45, pz - 0.12, px + 0.12, 3.0, pz + 0.12, { top: null, bottom: null });
  }
  // railing ring (low) between columns
  b.paint(trim, Surf.Wood);
  for (let i = 0; i < sides; i++) {
    if (i === Math.floor(sides / 4)) continue; // entrance gap (faces +Z-ish)
    const a0 = (i / sides) * TAU + Math.PI / sides, a1 = ((i + 1) / sides) * TAU + Math.PI / sides;
    b.beam([x + Math.cos(a0) * r, 1.3, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, 1.3, z + Math.sin(a1) * r], 0.1);
  }
  b.paint(trim, Surf.Wood).prism(x, z, r + 0.25, sides, 3.0, 0.35, Math.PI / sides);
  b.paint(roof, Surf.RoofTiles);
  lathe(b, x, z, [[r + 0.7, 3.25], [r * 0.35, 4.9], [0.12, 5.4], [0, 5.9]], sides, 50, Math.PI / sides, Math.PI / sides + TAU);
  b.paint(0xd4b25a, Surf.Metal).cylinder(x, z, 5.8, 0.6, 0.05, 0.02, 4);
  return 6.4;
}

/** Picnic table (~30 tris). */
function picnicTable(b: ModelBuilder, x: number, z: number, rot = 0): void {
  b.push().translate(x, 0, z).rotateY(rot);
  b.paint(0x8a6440, Surf.Wood).box(-0.9, 0.72, -0.4, 0.9, 0.78, 0.4);
  b.box(-0.9, 0.42, -0.85, 0.9, 0.47, -0.6).box(-0.9, 0.42, 0.6, 0.9, 0.47, 0.85);
  b.paint(0x6b4a30, Surf.Wood).box(-0.7, 0, -0.8, -0.6, 0.72, 0.8, { top: null }).box(0.6, 0, -0.8, 0.7, 0.72, 0.8, { top: null });
  b.pop();
}

/** Boulder (20 tris). */
function boulder(b: ModelBuilder, rng: RNG, x: number, z: number, r: number, color = 0x8d8a82): void {
  b.paint(shade(color, rng.range(0.9, 1.1)), Surf.Stone).blob(x, r * 0.35, z, r, r * 0.7, r * rng.range(0.7, 1), 0, 0.25, rng.next() * 10);
}

/** Paved square tile pattern (checker of two tones) over rect — used for plazas. */
function tiles(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, size: number, c1: number, c2: number, y: number): void {
  b.paint(c1, Surf.Pavement).slab(x0, z0, x1, z1, y);
  b.paint(c2, Surf.Pavement);
  const nx = Math.round((x1 - x0) / size), nz = Math.round((z1 - z0) / size);
  const sx = (x1 - x0) / nx, sz = (z1 - z0) / nz;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) if ((i + j) % 2 === 0) rect(b, x0 + i * sx, z0 + j * sz, x0 + (i + 1) * sx, z0 + (j + 1) * sz, y + 0.004);
}

/** Tree in a square stone planter. */
function planterTree(b: ModelBuilder, rng: RNG, x: number, z: number, s = 2.4, kind: 'oak' | 'round' | 'cone' | 'cherry' | 'poplar' = 'round', ts = 0.95): void {
  b.paint(0xbdb6a6, Surf.Stone).box(x - s / 2, 0, z - s / 2, x + s / 2, 0.55, z + s / 2, { top: null });
  b.paint(0xbdb6a6, Surf.Stone);
  rect(b, x - s / 2, z - s / 2, x + s / 2, z - s / 2 + 0.25, 0.55);
  rect(b, x - s / 2, z + s / 2 - 0.25, x + s / 2, z + s / 2, 0.55);
  rect(b, x - s / 2, z - s / 2 + 0.25, x - s / 2 + 0.25, z + s / 2 - 0.25, 0.55);
  rect(b, x + s / 2 - 0.25, z - s / 2 + 0.25, x + s / 2, z + s / 2 - 0.25, 0.55);
  b.paint(0x4c3a2a, Surf.Plain);
  rect(b, x - s / 2 + 0.25, z - s / 2 + 0.25, x + s / 2 - 0.25, z + s / 2 - 0.25, 0.48);
  tree(b, rng, x, z, ts, kind);
}

/** Stepping-stone / disc stones along a polyline. */
function steppingStones(b: ModelBuilder, rng: RNG, pts: P2[], every = 1.1): void {
  b.paint(0xbab4a6, Surf.Stone);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const l = Math.hypot(bx - ax, bz - az);
    for (let t = acc; t < l; t += every) {
      const x = ax + ((bx - ax) * t) / l, z = az + ((bz - az) * t) / l;
      b.cylinder(x + rng.range(-0.15, 0.15), z + rng.range(-0.15, 0.15), 0, 0.1, rng.range(0.32, 0.45), undefined, 7);
    }
    acc = (acc + Math.ceil((l - acc) / every) * every) - l;
  }
}

// ------------------------------------------------------------------------------------------------ park_small
function parkSmall(b: ModelBuilder, v: number, rng: RNG): void {
  const E = 8;
  lawnPatchwork(b, rng, -E, -E, E, E, GRASS_LUSH, 3);
  if (v === 0) {
    // pocket park with a round fountain plaza
    b.paint(PATH_PAVE, Surf.Pavement);
    disc(b, 0, -0.8, 0.09, 3.9, 20);
    b.paint(0xa39c8d, Surf.Stone);
    annulus(b, 0, -0.8, 0.1, 3.6, 3.95, 20);
    path(b, [[0, 8], [0.3, 5.5], [0, 2.8]], 2.0, PATH_PAVE);
    path(b, [[-3.4, -2.2], [-5.5, -3.2], [-8, -3.0]], 1.6, PATH_PAVE);
    path(b, [[3.3, -2.5], [5.6, -4.8], [6.6, -8]], 1.6, PATH_PAVE);
    fountain(b, 0, -0.8, 1.7, 1, { seg: 16 });
    for (const a of [0.9, 2.25, 3.9, 5.4]) parkBench(b, Math.cos(a) * 3.0, -0.8 + Math.sin(a) * 3.0, Math.atan2(-Math.cos(a), -Math.sin(a)));
    tree(b, rng, -5.6, -6.0, 1.0, 'oak');
    tree(b, rng, 5.5, 3.3, 0.95, 'round');
    tree(b, rng, -5.3, 4.6, 0.9, 'cherry');
    tree(b, rng, 2.4, -6.3, 0.85, 'round');
    roundBed(b, rng, 4.8, 6.2, 0.9, [0xe0475a, 0xf2c14e]);
    flowerBed(b, rng, -6.6, 0.2, -4.4, 2.2, { colors: [0xf28ab2, 0xffffff, 0x9b6ad6] });
    shrub(b, rng, -2.3, 6.4, 0.7);
    shrub(b, rng, 2.2, 6.6, 0.6);
    lamp(b, -1.6, 4.6, 3.8, 0);
    lamp(b, 1.8, -4.8, 3.8, 0);
    bin(b, 1.5, 4.2);
  } else if (v === 1) {
    // tree grove with a curving path and picnic spot
    const p = path(b, [[-4.5, 8], [-3.5, 4], [0, 1], [3.5, -2.2], [5, -5], [8, -6]], 1.8, PATH_GRAVEL);
    const spots: [number, number, number, 'oak' | 'round' | 'cone' | 'birch' | 'maple'][] = [
      [-5.6, -5.4, 1.05, 'oak'], [-1.2, -5.8, 0.9, 'cone'], [2.5, -6.2, 0.8, 'birch'], [-5.8, 1.0, 0.95, 'round'],
      [5.4, 2.4, 1.0, 'oak'], [2.4, 5.8, 0.85, 'maple'], [-6.2, -1.9, 0.8, 'birch'],
    ];
    for (const [x, z, s, k] of spots) tree(b, rng, x, z, s, k);
    picnicTable(b, -2.4, -2.2, 0.4);
    parkBench(b, 1.6, 2.6, -0.75 + Math.PI);
    parkBench(b, -1.7, 4.9, Math.PI / 2 - 0.3);
    roundBed(b, rng, 4.2, -1.2, 0.8, [0xf07b3f, 0xf2c14e, 0xe0475a]);
    for (let i = 0; i < 4; i++) shrub(b, rng, rng.range(-7, 7), rng.range(6, 7.3), rng.range(0.5, 0.8));
    lamp(b, -2.6, 4.8, 3.8, 1);
    lamp(b, 3.8, -3.6, 3.8, 1);
    bin(b, 0.9, 0.0);
    void p;
  } else if (v === 2) {
    // formal flower garden with low hedge border and brick cross paths
    b.paint(PATH_RED, Surf.Pavement);
    rect(b, -1.0, -7.2, 1.0, 8, 0.09);
    rect(b, -7.2, -1.0, 7.2, 1.0, 0.091);
    b.paint(PATH_RED, Surf.Pavement);
    disc(b, 0, 0, 0.095, 2.6, 18);
    roundBed(b, rng, 0, 0, 1.5, [0xe0475a, 0xffffff, 0xf2c14e]);
    const beds: [number, number, number, number][] = [[-6.6, -6.6, -1.8, -1.8], [1.8, -6.6, 6.6, -1.8], [-6.6, 1.8, -1.8, 6.6], [1.8, 1.8, 6.6, 6.6]];
    const pal = [[0xf28ab2, 0xffffff], [0x9b6ad6, 0xf2c14e], [0xf2c14e, 0xe0475a], [0xffffff, 0xf07b3f]];
    beds.forEach(([x0, z0, x1, z1], i) => {
      hedgeBox(b, x0, z0, x1, z0 + 0.5, 0.6, 0x3a6a2c);
      hedgeBox(b, x0, z1 - 0.5, x1, z1, 0.6, 0x3a6a2c);
      hedgeBox(b, x0, z0 + 0.5, x0 + 0.5, z1 - 0.5, 0.6, 0x3a6a2c);
      hedgeBox(b, x1 - 0.5, z0 + 0.5, x1, z1 - 0.5, 0.6, 0x3a6a2c);
      flowerBed(b, rng, x0 + 0.8, z0 + 0.8, x1 - 0.8, z1 - 0.8, { colors: pal[i], border: null, spacing: 0.8 });
    });
    b.paint(0x3a6a2c, Surf.Foliage).cone(-7.0, -7.0, 0, 2.6, 0.7, 6).cone(7.0, -7.0, 0, 2.6, 0.7, 6);
    tree(b, rng, -6.8, 7.1, 0.7, 'cherry');
    tree(b, rng, 6.8, 7.1, 0.7, 'cherry');
    parkBench(b, -3.3, -1.5, 0);
    parkBench(b, 3.3, 1.5, Math.PI);
    lamp(b, -1.5, 6.5, 3.6, 1);
    lamp(b, 1.5, -6.5, 3.6, 1);
  } else {
    // little pond with willow, stepping stones and boulders
    const poly = pond(b, rng, -2.2, -2.8, 4.4, 3.2, { reeds: 6, rot: 0.3 });
    const ss = spline([[3.2, 8], [3.4, 4.5], [2.2, 1.6], [3.8, -1.5], [5.6, -5], [5.5, -8]], 4);
    steppingStones(b, rng, ss, 1.05);
    tree(b, rng, 2.6, -5.2, 0.9, 'willow');
    tree(b, rng, -6.4, 4.5, 0.9, 'birch');
    tree(b, rng, -4.5, 6.2, 0.8, 'birch');
    tree(b, rng, 6.4, 2.8, 0.85, 'round');
    boulder(b, rng, 1.9, -0.2, 0.7);
    boulder(b, rng, -6.6, -1.2, 0.9);
    boulder(b, rng, 1.2, -4.6, 0.5);
    parkBench(b, -1.5, 3.3, Math.PI);
    shrub(b, rng, -6.6, 0.6, 0.7);
    shrub(b, rng, 6.8, -2.0, 0.6, 0x6b8f3a);
    flowerBed(b, rng, -5.5, 1.6, -3.6, 2.7, { colors: [0x9b6ad6, 0xf28ab2], border: null });
    lamp(b, 1.3, 4.2, 3.6, 1);
    // lily pads
    b.paint(0x4f8a3a, Surf.Foliage);
    for (let i = 0; i < 5; i++) {
      const x = -2.2 + rng.range(-2.5, 2.5), z = -2.8 + rng.range(-1.6, 1.6);
      if (inPoly(poly, x, z)) disc(b, x, z, 0.11, rng.range(0.25, 0.4), 6);
    }
  }
}

// ------------------------------------------------------------------------------------------------ park_plaza
function parkPlaza(b: ModelBuilder, v: number, rng: RNG): void {
  const E = 16;
  if (v === 0) {
    // classic fountain plaza: radial paving, big tiered fountain, planters, lamps
    b.paint(0xd2cab8, Surf.Pavement).slab(-E, -E, E, E, 0.1);
    b.paint(0xb3a893, Surf.Pavement);
    annulus(b, 0, 0, 0.105, 6.6, 7.4, 28);
    annulus(b, 0, 0, 0.105, 11.2, 11.8, 32);
    b.paint(0xbfb39c, Surf.Pavement);
    rect(b, -1.2, 7.4, 1.2, E, 0.104);
    rect(b, -1.2, -E, 1.2, -7.4, 0.104);
    rect(b, 7.4, -1.2, E, 1.2, 0.104);
    rect(b, -E, -1.2, -7.4, 1.2, 0.104);
    fountain(b, 0, 0, 4.6, 3, { seg: 24 });
    for (const [x, z] of [[-10, -10], [10, -10], [-10, 10], [10, 10]] as P2[]) planterTree(b, rng, x, z, 3.2, 'oak', 1.0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + TAU / 16;
      parkBench(b, Math.cos(a) * 8.9, Math.sin(a) * 8.9, Math.atan2(-Math.cos(a), -Math.sin(a)));
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      lamp(b, Math.cos(a) * 12.9, Math.sin(a) * 12.9, 4.4, 0);
    }
    // corner flower beds
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      flowerBed(b, rng, sx > 0 ? 12.6 : -15.2, sz > 0 ? 3.0 : -6.0, sx > 0 ? 15.2 : -12.6, sz > 0 ? 6.0 : -3.0, { spacing: 0.7 });
      flowerBed(b, rng, sx > 0 ? 3.0 : -6.0, sz > 0 ? 12.6 : -15.2, sx > 0 ? 6.0 : -3.0, sz > 0 ? 15.2 : -12.6, { spacing: 0.7 });
    }
    // cafe corner
    for (const [x, z, c] of [[-13.2, -13.2, 0xc0392b], [-10.2, -14.3, 0xecf0f1]] as [number, number, number][]) umbrella(b, x, z, c, 1.3, 2.4);
    for (let i = 0; i < 7; i++) person(b, rng, rng.range(-12, 12), rng.range(-12, 12), 0.1, rng.range(0, TAU));
  } else if (v === 1) {
    // modern plaza: granite bands, long reflecting pool with jets, lawn strips + tree grid, sculpture
    b.paint(0xc4c2bc, Surf.Pavement).slab(-E, -E, E, E, 0.1);
    b.paint(0xa9a7a1, Surf.Pavement);
    for (let i = -7; i <= 7; i += 2) rect(b, -E, i * 2 - 0.5, E, i * 2 + 0.5, 0.104);
    // reflecting pool
    b.paint(0x777570, Surf.Stone).box(-10, 0.1, -9, 10, 0.5, -3, { top: null });
    b.paint(0x8a8883, Surf.Stone);
    rect(b, -10, -9, 10, -8.6, 0.5); rect(b, -10, -3.4, 10, -3, 0.5); rect(b, -10, -8.6, -9.6, -3.4, 0.5); rect(b, 9.6, -8.6, 10, -3.4, 0.5);
    b.paint(0x2f5f78, Surf.Water);
    rect(b, -9.6, -8.6, 9.6, -3.4, 0.42);
    b.paint(0xd6ecf4, Surf.Water);
    for (let i = 0; i < 9; i++) b.cone(-8 + i * 2, -6, 0.42, 1.2 + (i % 2) * 0.6, 0.12, 5, true);
    // lawn strips with a tree grid
    for (const z0 of [-15, 4.5]) {
      for (const [x0, x1] of [[-15, -3], [3, 15]]) {
        b.paint(GRASS_LUSH, Surf.Foliage).box(x0, 0.1, z0, x1, 0.32, z0 + 3.2);
        b.paint(0x8f8d88, Surf.Stone).box(x0 - 0.2, 0.1, z0 - 0.2, x1 + 0.2, 0.3, z0 + 3.4, { top: null });
        for (let k = 0; k < 3; k++) tree(b, rng, x0 + 2 + k * 4, z0 + 1.6, 0.95, 'round');
      }
    }
    // long concrete bench blocks
    b.paint(0xd8d5cd, Surf.Pavement);
    for (const x of [-7, 0, 7]) b.box(x - 2.2, 0.1, 10.6, x + 2.2, 0.55, 11.3);
    b.paint(0x9a6a44, Surf.Wood);
    for (const x of [-7, 0, 7]) b.box(x - 2.2, 0.55, 10.6, x + 2.2, 0.62, 11.3, { bottom: null });
    // sculpture: tilted steel ring
    b.push().translate(-11.5, 0, 12.5).rotateY(0.6);
    b.paint(0xc0392b, Surf.Metal);
    b.push().translate(0, 3.0, 0).rotateZ(0.25);
    track3D(b, arcPts(0, 0, 2.6, 0, TAU, 20).map(([x, y]) => [x, y, 0] as V3), 0.5, 0.5, { closed: true });
    b.pop();
    b.paint(0x5a5c60, Surf.Metal).box(-0.6, 0.1, -0.6, 0.6, 0.5, 0.6);
    b.pop();
    for (const x of [-14, 14]) for (const z of [-1, 9]) lamp(b, x, z, 5.0, 2);
    for (const x of [-4.5, 4.5]) lamp(b, x, 1.2, 5.0, 2);
    for (let i = 0; i < 6; i++) person(b, rng, rng.range(-13, 13), rng.range(-1, 14), 0.1, rng.range(0, TAU));
  } else {
    // civic square: statue, four lawns with hedges, diagonal walks, kiosk and flags
    b.paint(0xcfc6b2, Surf.Pavement).slab(-E, -E, E, E, 0.1);
    const lawnQ: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [sx, sz] of lawnQ) {
      const x0 = sx > 0 ? 3.2 : -14.8, x1 = sx > 0 ? 14.8 : -3.2, z0 = sz > 0 ? 3.2 : -14.8, z1 = sz > 0 ? 14.8 : -3.2;
      // lawn triangle-ish: rect minus diagonal walk
      const inner: P2 = [sx > 0 ? x0 : x1, sz > 0 ? z0 : z1];
      const poly: P2[] = [
        [inner[0] + sx * 3.2, inner[1]], [sx > 0 ? x1 : x0, inner[1]], [sx > 0 ? x1 : x0, sz > 0 ? z1 : z0], [inner[0], sz > 0 ? z1 : z0], [inner[0], inner[1] + sz * 3.2],
      ];
      const mid: P2 = [inner[0] + sx * 5.3, inner[1] + sz * 5.3];
      b.paint(GRASS_LUSH, Surf.Foliage);
      flatPoly(b, [poly[0], poly[1], [poly[1][0], mid[1] - sz * 1.4], [mid[0] + sx * 1.4, poly[2][1]], poly[3], poly[4]], 0.14);
      b.paint(0x3a6a2c, Surf.Foliage);
      ribbon(b, [poly[0], poly[1], poly[2], poly[3], poly[4]], 0.5, 0.75, { sides: true, y0: 0.1 });
      tree(b, rng, sx > 0 ? x1 - 2.2 : x0 + 2.2, sz > 0 ? z1 - 2.2 : z0 + 2.2, 1.0, 'oak');
      roundBed(b, rng, inner[0] + sx * 5.6, inner[1] + sz * 2.4, 0.9);
    }
    // central statue on pedestal with steps
    b.paint(0xbfb6a2, Surf.Stone).box(-3.2, 0.1, -3.2, 3.2, 0.4, 3.2).box(-2.4, 0.4, -2.4, 2.4, 0.7, 2.4);
    b.paint(0xe2dccd, Surf.Stone).box(-1.2, 0.7, -1.2, 1.2, 3.6, 1.2);
    b.paint(0xc9c0ab, Surf.Stone).box(-1.45, 3.6, -1.45, 1.45, 3.9, 1.45);
    // bronze figure (abstract: robed figure with raised arm)
    b.paint(0x4d6b58, Surf.Metal);
    lathe(b, 0, 0, [[0.75, 3.9], [0.55, 5.0], [0.42, 5.9], [0.5, 6.3], [0.2, 6.5], [0, 6.5]], 8);
    b.blob(0, 6.8, 0, 0.3, 0.34, 0.3, 0, 0.05, 2);
    b.beam([0.35, 6.1, 0], [0.9, 7.4, 0.3], 0.2);
    // kiosk (newsstand) and flags
    b.paint(0x2f5d4a, Surf.Plain).box(11.0, 0.1, -1.3, 13.6, 2.6, 1.3);
    b.paint(0x1e2b25, Surf.GlassPlain).box(10.95, 0.9, -1.35, 13.65, 2.1, 1.35, { top: null, bottom: null, px: null });
    b.paint(0x7c2f2a, Surf.RoofTiles).pyramid(12.3, 0, 3.4, 3.4, 2.6, 1.3);
    umbrella(b, 8.4, -1.6, 0xc0392b, 1.2, 2.3);
    umbrella(b, 8.4, 1.8, 0xecf0f1, 1.2, 2.3);
    for (const x of [-4, 0, 4]) {
      b.paint(0xdddddd, Surf.Metal).cylinder(x, -14.6, 0.1, 8.5, 0.08, 0.05, 5);
      b.paint([0x2e6fb5, 0xc0392b, 0xf1c40f][(x / 4 + 1) | 0], Surf.Plain).quad2([x, 8.4, -14.6], [x + 1.9, 8.4, -14.6], [x + 1.9, 7.2, -14.6], [x, 7.2, -14.6]);
    }
    for (const [x, z] of [[-3.8, 6], [3.8, 6], [-3.8, -6], [3.8, -6]] as P2[]) lamp(b, x, z, 4.2, 1);
    for (const [x, z, r] of [[0, 5.1, Math.PI], [0, -5.1, 0], [5.1, 0, -Math.PI / 2], [-5.1, 0, Math.PI / 2]] as V3[]) parkBench(b, x, z, r);
    for (let i = 0; i < 6; i++) person(b, rng, rng.range(-3, 3) + (i % 2 ? 6 : -6), rng.range(-8, 8), 0.1, rng.range(0, TAU));
  }
}

// ------------------------------------------------------------------------------------------------ park_playground
function playTower(b: ModelBuilder, x: number, z: number, deck: number, size: number, post: number, roof: number, rail: number): void {
  const h = size / 2;
  b.paint(post, Surf.Wood);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(x + dx * h - 0.08, 0, z + dz * h - 0.08, x + dx * h + 0.08, deck + 1.6, z + dz * h + 0.08, { bottom: null });
  b.paint(0xc9a36b, Surf.Wood).box(x - h, deck - 0.12, z - h, x + h, deck, z + h);
  b.paint(rail, Surf.Plain);
  b.quad2([x - h, deck, z - h], [x + h, deck, z - h], [x + h, deck + 0.8, z - h], [x - h, deck + 0.8, z - h]);
  b.quad2([x - h, deck, z - h], [x - h, deck, z + h], [x - h, deck + 0.8, z + h], [x - h, deck + 0.8, z - h]);
  b.paint(roof, Surf.Plain).pyramid(x, z, size + 0.4, size + 0.4, deck + 1.6, 1.0);
}

function parkPlayground(b: ModelBuilder, v: number, rng: RNG): void {
  const E = 8;
  lawnPatchwork(b, rng, -E, -E, E, E, GRASS_LUSH, 2);
  if (v === 0) {
    // rubber surface (terracotta) + sandbox, wooden towers, slide, swings
    b.paint(0xb85a3e, Surf.Pavement).slab(-6.6, -6.6, 6.6, 3.6, 0.09);
    b.paint(0x3f7fbf, Surf.Pavement);
    disc(b, -3.6, 1.0, 0.095, 1.8, 14);
    // sandbox
    b.paint(0x8a6a44, Surf.Wood).box(2.2, 0, 4.2, 6.4, 0.35, 7.2);
    b.paint(0xe3cf95, Surf.Plain).box(2.45, 0.3, 4.45, 6.15, 0.33, 6.95, { nx: null, px: null, nz: null, pz: null });
    b.paint(0xe74c3c, Surf.Plain).box(3.2, 0.33, 5.2, 3.6, 0.6, 5.6);
    b.paint(0xf1c40f, Surf.Plain).box(5.0, 0.33, 5.8, 5.5, 0.5, 6.3);
    // towers + bridge + slide
    playTower(b, -3.8, -3.8, 1.5, 1.8, 0x8a6440, 0xd63a2f, 0x2e86c1);
    playTower(b, 0.8, -3.8, 1.9, 1.8, 0x8a6440, 0x2e86c1, 0xf1c40f);
    b.paint(0xc9a36b, Surf.Wood).box(-2.9, 1.55, -4.3, -0.1, 1.65, -3.3);
    b.paint(0x2e86c1, Surf.Metal).beam([-2.9, 2.3, -4.3], [-0.1, 2.6, -4.3], 0.06).beam([-2.9, 2.3, -3.3], [-0.1, 2.6, -3.3], 0.06);
    // slide from the tall tower toward +X
    b.paint(0xf1c40f, Surf.Plain);
    track3D(b, [[1.7, 1.95, -3.8], [3.2, 1.2, -3.8], [4.4, 0.35, -3.8], [5.0, 0.3, -3.8]], 0.7, 0.12);
    b.paint(0xd4ac0d, Surf.Plain);
    track3D(b, [[1.7, 2.2, -3.45], [3.2, 1.45, -3.45], [4.4, 0.6, -3.45], [5.0, 0.55, -3.45]], 0.06, 0.25);
    track3D(b, [[1.7, 2.2, -4.15], [3.2, 1.45, -4.15], [4.4, 0.6, -4.15], [5.0, 0.55, -4.15]], 0.06, 0.25);
    // climbing ladder on the small tower
    b.paint(0x2e86c1, Surf.Metal);
    for (const dx of [-0.4, 0.4]) b.beam([-3.8 + dx, 0, -2.2], [-3.8 + dx, 1.5, -2.9], 0.07);
    for (let k = 1; k < 4; k++) b.beam([-4.2, k * 0.38, -2.2 - k * 0.18], [-3.4, k * 0.38, -2.2 - k * 0.18], 0.05);
    // swing set (A-frames)
    b.paint(0xc0392b, Surf.Metal);
    const sx0 = -5.8, sx1 = -1.2, sz = 1.4, sh = 2.6;
    for (const x of [sx0, sx1]) {
      b.beam([x, 0, sz - 0.9], [x, sh, sz], 0.1).beam([x, 0, sz + 0.9], [x, sh, sz], 0.1);
    }
    b.beam([sx0, sh, sz], [sx1, sh, sz], 0.12);
    for (const x of [-4.8, -3.5, -2.2]) {
      b.paint(0x9aa0a6, Surf.Metal).beam([x - 0.2, sh, sz], [x - 0.2, 0.55, sz], 0.03).beam([x + 0.2, sh, sz], [x + 0.2, 0.55, sz], 0.03);
      b.paint(0x2b2d31, Surf.Plain).box(x - 0.25, 0.5, sz - 0.12, x + 0.25, 0.56, sz + 0.12);
    }
    // spring riders + seesaw
    b.paint(0x27ae60, Surf.Plain).blob(3.4, 0.75, 1.0, 0.45, 0.3, 0.25, 0, 0.05, 1);
    b.paint(0xe67e22, Surf.Plain).blob(5.0, 0.75, 1.6, 0.45, 0.3, 0.25, 0, 0.05, 2);
    b.paint(0x555a60, Surf.Metal).cylinder(3.4, 1.0, 0, 0.5, 0.06, 0.06, 4).cylinder(5.0, 1.6, 0, 0.5, 0.06, 0.06, 4);
    b.paint(0x8e44ad, Surf.Plain).box(1.2, 0.1, -0.2, 1.6, 0.45, 0.2);
    b.paint(0xf1c40f, Surf.Wood).beam([1.4, 0.7, -2.0 + 3.4], [1.4, 0.25, -0.6 - 2.2], 0.25);
    // benches, trees, fence
    parkBench(b, -5.2, 5.6, 0);
    parkBench(b, -2.6, 5.9, 0);
    tree(b, rng, -6.9, -6.8, 0.72, 'round');
    tree(b, rng, 6.8, -6.9, 0.72, 'oak');
    tree(b, rng, 6.8, 2.2, 0.62, 'round');
    for (const [ax, az, bx2, bz] of [[-7.4, -7.4, 7.4, -7.4], [-7.4, -7.4, -7.4, 7.4], [7.4, -7.4, 7.4, 7.4], [-7.4, 7.4, -1, 7.4], [1, 7.4, 7.4, 7.4]] as [number, number, number, number][]) {
      railFence(b, ax, az, bx2, bz, 0.9, 2.5, 0x2e86c1, 1);
    }
    lamp(b, 0, 6.8, 3.6, 1);
  } else {
    // modern pastel playground: climbing dome, big slide tower with spiral slide, merry-go-round
    b.paint(0x5aa7a0, Surf.Pavement).slab(-6.8, -6.8, 6.8, 5.0, 0.09);
    b.paint(0xf3b562, Surf.Pavement);
    disc(b, -3.2, -2.8, 0.095, 3.0, 18);
    b.paint(0xf28ab2, Surf.Pavement);
    disc(b, 3.4, 1.8, 0.095, 2.2, 16);
    b.paint(0x8fc1e3, Surf.Pavement);
    disc(b, 3.6, -4.0, 0.095, 2.1, 16);
    // climbing dome (geodesic-ish lattice)
    b.paint(0xe74c3c, Surf.Metal);
    const R = 2.4, cx = -3.2, cz = -2.8;
    const ringsY = [0, 0.9, 1.7, 2.25];
    const ringsR = ringsY.map((y) => Math.sqrt(Math.max(0, R * R - y * y)));
    for (let j = 0; j < ringsY.length; j++) {
      const seg = 10;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * TAU + j * 0.3, a1 = ((i + 1) / seg) * TAU + j * 0.3;
        if (j > 0) b.beam([cx + Math.cos(a0) * ringsR[j], ringsY[j] + 0.1, cz + Math.sin(a0) * ringsR[j]], [cx + Math.cos(a1) * ringsR[j], ringsY[j] + 0.1, cz + Math.sin(a1) * ringsR[j]], 0.07);
        if (j < ringsY.length - 1) b.beam([cx + Math.cos(a0) * ringsR[j], ringsY[j] + 0.1, cz + Math.sin(a0) * ringsR[j]], [cx + Math.cos(a0 + 0.3) * ringsR[j + 1], ringsY[j + 1] + 0.1, cz + Math.sin(a0 + 0.3) * ringsR[j + 1]], 0.07);
      }
    }
    // slide tower with spiral slide
    b.paint(0xf5f5f0, Surf.Plain).cylinder(3.6, -4.0, 0.1, 3.0, 0.9, 0.9, 10);
    b.paint(0x8fc1e3, Surf.Plain).cone(3.6, -4.0, 3.1, 1.3, 1.25, 10, false);
    b.paint(0xf3b562, Surf.Plain);
    const hel: V3[] = [];
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * TAU * 1.1 + Math.PI;
      hel.push([3.6 + Math.cos(a) * 1.7, 2.6 - (i / 18) * 2.3, -4.0 + Math.sin(a) * 1.7]);
    }
    track3D(b, hel, 0.7, 0.15);
    // merry-go-round
    b.paint(0xf28ab2, Surf.Metal).cylinder(3.4, 1.8, 0.1, 0.35, 1.5, 1.5, 12);
    b.paint(0xf5f5f0, Surf.Metal);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      b.beam([3.4, 0.45, 1.8], [3.4 + Math.cos(a) * 1.3, 1.1, 1.8 + Math.sin(a) * 1.3], 0.06);
    }
    // balance beams / stepping posts
    b.paint(0xf3b562, Surf.Wood);
    for (let i = 0; i < 5; i++) b.cylinder(-5.8 + i * 0.9, 3.0 + Math.sin(i) * 0.5, 0.09, 0.3 + (i % 3) * 0.2, 0.22, 0.22, 6);
    b.paint(0x8fc1e3, Surf.Wood).box(-1.2, 0.3, 3.6, 1.8, 0.45, 3.9);
    // sand pit with digger
    b.paint(0xe3cf95, Surf.Plain).box(-1.0, 0, -6.2, 1.2, 0.2, -3.9);
    // parents' benches, trees, fence
    for (const x of [-4.8, -2.0, 2.0, 4.8]) parkBench(b, x, 6.3, 0, 0xd9d4c7);
    tree(b, rng, -7.0, 6.9, 0.7, 'birch');
    tree(b, rng, 7.0, 6.9, 0.7, 'birch');
    tree(b, rng, 6.9, -7.0, 0.72, 'round');
    tree(b, rng, -7.0, -7.0, 0.66, 'round');
    for (const [ax, az, bx2, bz] of [[-7.5, -7.5, 7.5, -7.5], [-7.5, -7.5, -7.5, 5.4], [7.5, -7.5, 7.5, 5.4]] as [number, number, number, number][]) railFence(b, ax, az, bx2, bz, 1.0, 2.5, 0xf5f5f0, 1);
    lamp(b, -0.2, 5.9, 3.8, 2);
  }
}

// ------------------------------------------------------------------------------------------------ sports
function parkBasketball(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 8;
  lawnPatchwork(b, rng, -E, -E, E, E, GRASS_LUSH, 2);
  // court: 14.4 x 14 half court, hoop at the back
  b.paint(0x3a5f7a, Surf.Pavement).slab(-7.5, -7.5, 7.5, 7.2, 0.08);
  b.paint(0x4a7a9c, Surf.Pavement);
  rect(b, -7.2, -7.0, 7.2, 6.9, 0.085);
  b.paint(0xc9573a, Surf.Pavement);
  rect(b, -2.45, -7.0, 2.45, -1.2, 0.09);
  flatPoly(b, [[1.8, 6.9], ...arcPts(0, 6.9, 1.8, TAU, Math.PI, 8)], 0.09);
  b.paint(WHITE_LINE, Surf.Plain);
  const y = 0.095, w = 0.08;
  rectLines(b, -7.2, -7.0, 7.2, 6.9, w, y);
  rectLines(b, -2.45, -7.0, 2.45, -1.2, w, y);
  ribbon(b, arcPts(0, -1.2, 1.8, Math.PI, TAU, 10), w, y);
  ribbon(b, arcPts(0, -1.2, 1.8, 0, Math.PI, 10), w, y);
  const hoopZ = -5.6;
  ribbon(b, [[-6.6, -7.0], [-6.6, hoopZ + 0.5], ...arcPts(0, hoopZ, 6.63, Math.PI - 0.09, 0.09, 18).reverse().reverse(), [6.6, hoopZ + 0.5], [6.6, -7.0]] as P2[], w, y);
  ribbon(b, arcPts(0, 6.9, 1.8, Math.PI, TAU, 8), w, y);
  // hoop: pole, arm, backboard, rim
  b.paint(0x2b2f33, Surf.Metal).box(-0.12, 0, -7.4, 0.12, 3.5, -7.16, { bottom: null });
  b.beam([0, 3.3, -7.3], [0, 3.3, -6.3], 0.14);
  b.paint(0xf4f4f0, Surf.Plain).box(-0.9, 2.9, -6.3, 0.9, 3.95, -6.24);
  b.paint(0xc0392b, Surf.Plain).box(-0.3, 3.05, -6.23, 0.3, 3.5, -6.22, { nx: null, px: null, top: null, bottom: null, nz: null });
  b.paint(0xe67e22, Surf.Metal);
  b.ring(0, 3.05, -5.97, 0.24, 0.035, 10);
  b.paint(0xeeeeee, Surf.Plain).cylinder(0, -5.97, 2.7, 0.33, 0.14, 0.23, 6, { top: false });
  // fence (see-through) and floodlights
  for (const [ax, az, bx2, bz] of [[-7.7, -7.7, 7.7, -7.7], [-7.7, -7.7, -7.7, 7.2], [7.7, -7.7, 7.7, 7.2], [-7.7, 7.2, -2, 7.2], [2, 7.2, 7.7, 7.2]] as [number, number, number, number][]) railFence(b, ax, az, bx2, bz, 3.2, 2.6, 0x5c666e, 2);
  floodMast(b, -7.6, -7.3, 4.2, 0, 0, { bank: 0.8 });
  floodMast(b, 7.6, 7.0, 4.2, 0, -1, { bank: 0.8 });
  parkBench(b, 5.8, 6.0, Math.PI);
  bin(b, -6.8, 6.4);
  // a basketball + players for scale
  b.paint(0xd35400, Surf.Plain).blob(1.2, 0.2, 0.6, 0.12, 0.12, 0.12, 0, 0, 1);
  person(b, rng, -1.6, -2.5, 0.08, 2.4);
  person(b, rng, 0.6, -3.4, 0.08, 3.6);
  person(b, rng, 2.4, 1.2, 0.08, 3.4);
}

function tennisCourt(b: ModelBuilder, cx: number, color: number): void {
  const s = 0.56;
  const hl = (23.77 * s) / 2, hw = (10.97 * s) / 2, hs = (8.23 * s) / 2, sv = 6.4 * s;
  b.paint(color, Surf.Pavement);
  rect(b, cx - hw - 0.6, -hl - 0.6, cx + hw + 0.6, hl + 0.6, 0.09);
  b.paint(WHITE_LINE, Surf.Plain);
  const y = 0.095, w = 0.06;
  rectLines(b, cx - hw, -hl, cx + hw, hl, w, y);
  line(b, cx - hs, -hl, cx - hs, hl, w, y);
  line(b, cx + hs, -hl, cx + hs, hl, w, y);
  line(b, cx - hs, -sv, cx + hs, -sv, w, y);
  line(b, cx - hs, sv, cx + hs, sv, w, y);
  line(b, cx, -sv, cx, sv, w, y);
  // net
  b.paint(0x2a2d30, Surf.Metal).cylinder(cx - hw - 0.4, 0, 0, 1.07, 0.05, 0.05, 5).cylinder(cx + hw + 0.4, 0, 0, 1.07, 0.05, 0.05, 5);
  b.paint(0x33373b, Surf.Plain).quad2([cx - hw - 0.4, 0.1, 0], [cx + hw + 0.4, 0.1, 0], [cx + hw + 0.4, 0.95, 0], [cx - hw - 0.4, 0.95, 0]);
  b.paint(0xf4f4f4, Surf.Plain).box(cx - hw - 0.4, 0.93, -0.03, cx + hw + 0.4, 1.02, 0.03, { bottom: null });
}

function parkTennis(b: ModelBuilder, _v: number, rng: RNG): void {
  lawnPatchwork(b, rng, -16, -8, 16, 8, GRASS_LUSH, 3);
  b.paint(0x3f7a5a, Surf.Pavement).slab(-12, -7.6, 12, 7.6, 0.08);
  tennisCourt(b, -5.4, 0x3d6f9e);
  tennisCourt(b, 5.4, 0x3d6f9e);
  // fence with dark-green windscreens on the ends
  const fx = 12, fz = 7.6, fh = 3.4;
  for (const [ax, az, bx2, bz] of [[-fx, -fz, fx, -fz], [-fx, fz, -1.2, fz], [1.2, fz, fx, fz], [-fx, -fz, -fx, fz], [fx, -fz, fx, fz]] as [number, number, number, number][]) railFence(b, ax, az, bx2, bz, fh, 3.0, 0x4a5258, 2);
  for (const [ax, az, bx2, bz] of [[-fx, -fz, fx, -fz], [-fx, fz, -1.2, fz], [1.2, fz, fx, fz]] as [number, number, number, number][]) panelFence(b, ax, az, bx2, bz, 0.1, 2.1, 0x24453a);
  panelFence(b, -fx, -fz, -fx, -2.5, 0.1, 2.1, 0x24453a);
  panelFence(b, fx, 2.5, fx, fz, 0.1, 2.1, 0x24453a);
  // side lawns: benches, small shelter, trees, lights
  parkBench(b, -14, -2.2, Math.PI / 2);
  parkBench(b, -14, 1.6, Math.PI / 2);
  b.paint(0x8a6440, Surf.Wood).box(13.2, 0, -3.2, 15.4, 2.6, -3.0, { bottom: null });
  b.paint(0x5c3e2a, Surf.RoofTiles).box(12.9, 2.6, -3.6, 15.6, 2.8, 0.2, { bottom: null });
  b.paint(0x8a6440, Surf.Wood).box(13.2, 0, -0.2, 13.4, 2.6, 0, { bottom: null }).box(15.2, 0, -0.2, 15.4, 2.6, 0, { bottom: null });
  parkBench(b, 14.3, -2.0, 0);
  tree(b, rng, -14.4, -6.2, 0.6, 'round');
  tree(b, rng, -14.2, 5.6, 0.58, 'oak');
  tree(b, rng, 14.4, 5.2, 0.6, 'round');
  tree(b, rng, 14.6, -6.4, 0.55, 'cone');
  for (const x of [-11.9, 0, 11.9]) {
    floodMast(b, x, -7.5, 4.2, x * 0.6, 0, { bank: 0.8 });
    floodMast(b, x, 7.5, 4.2, x * 0.6, 0, { bank: 0.8 });
  }
  person(b, rng, -5.4, -5.2, 0.09, 0);
  person(b, rng, -5.0, 4.8, 0.09, Math.PI);
  person(b, rng, 4.6, -5.6, 0.09, 0.3);
  person(b, rng, 6.2, 5.0, 0.09, Math.PI);
}

/** Striped pitch (mowing pattern) over rect, stripes along `axis`. */
function mownPitch(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, n: number, c1: number, c2: number, y: number, axis: 'x' | 'z', surf = Surf.Foliage): void {
  for (let i = 0; i < n; i++) {
    b.paint(i % 2 ? c1 : c2, surf);
    if (axis === 'x') rect(b, x0 + ((x1 - x0) * i) / n, z0, x0 + ((x1 - x0) * (i + 1)) / n, z1, y);
    else rect(b, x0, z0 + ((z1 - z0) * i) / n, x1, z0 + ((z1 - z0) * (i + 1)) / n, y);
  }
}

function parkSoccer(b: ModelBuilder, _v: number, rng: RNG): void {
  lawnPatchwork(b, rng, -24, -16, 24, 16, GRASS_DARK, 3);
  // pitch 42 x 23 along X
  const x0 = -21, x1 = 21, z0 = -9.5, z1 = 13.5, zc = (z0 + z1) / 2;
  mownPitch(b, x0 - 1.2, z0 - 1.2, x1 + 1.2, z1 + 1.2, 12, 0x3f7a2c, 0x4a8a34, 0.09, 'x', Surf.Emissive);
  b.paint(WHITE_LINE, Surf.Plain);
  const y = 0.1, w = 0.12;
  rectLines(b, x0, z0, x1, z1, w, y);
  line(b, 0, z0, 0, z1, w, y);
  ribbon(b, arcPts(0, zc, 4.2, 0, TAU, 24), w, y, { closed: true });
  disc(b, 0, zc, y + 0.002, 0.2, 6);
  for (const s of [-1, 1]) {
    const gx = s * x1;
    rectLines(b, Math.min(gx, gx - s * 7), zc - 7.5, Math.max(gx, gx - s * 7), zc + 7.5, w, y);
    rectLines(b, Math.min(gx, gx - s * 2.6), zc - 3.6, Math.max(gx, gx - s * 2.6), zc + 3.6, w, y);
    disc(b, gx - s * 5.2, zc, y + 0.002, 0.18, 6);
    ribbon(b, arcPts(gx - s * 5.2, zc, 4.2, s > 0 ? Math.PI - 0.95 : -0.95, s > 0 ? Math.PI + 0.95 : 0.95, 8), w, y);
    goal(b, gx + s * 0.05, zc, s > 0 ? -Math.PI / 2 : Math.PI / 2, 5, 2);
  }
  // stands at the back with a roof, team shelters at the front
  bleachers(b, 0, -11.4, 24, 5, 0, { seat: 0x2d6fb5, roof: 0xd8d8d2, rise: 0.42, depth: 0.78 });
  for (const x of [-6, 6]) {
    b.paint(0x2b2f33, Surf.Metal).box(x - 2.2, 0, 14.7, x + 2.2, 0.5, 15.4);
    b.paint(0x9fb8c8, Surf.GlassPlain).box(x - 2.2, 0.1, 15.3, x + 2.2, 2.2, 15.4, { bottom: null });
    b.paint(0x9fb8c8, Surf.GlassPlain).box(x - 2.2, 2.2, 14.3, x + 2.2, 2.3, 15.4, { bottom: null });
  }
  // clubhouse at the back corners
  b.paint(0xa35a42, Surf.Brick).box(-23.2, 0, -15.4, -14.2, 3.4, -11.6);
  b.paint(0x6f7378, Surf.RoofFlat).box(-23.4, 3.4, -15.6, -14.0, 3.6, -11.4, { bottom: null });
  b.paint(0x2e3a44, Surf.GlassPlain).box(-22.0, 0.9, -11.62, -15.4, 2.4, -11.58, { top: null, bottom: null, nx: null, px: null, nz: null });
  b.paint(0x3a5a78, Surf.Metal).box(14.6, 0, -15.2, 23.2, 2.8, -11.8);
  b.paint(0xe8e6e0, Surf.RoofFlat).box(14.4, 2.8, -15.4, 23.4, 3.0, -11.6, { bottom: null });
  // floodlights (kept low to respect the lot height guidance)
  for (const [x, z] of [[-23.0, -10.8], [23.0, -10.8], [-23.0, 15.0], [23.0, 15.0], [0, 15.4]] as P2[]) floodMast(b, x, z, 6.4, x * 0.4, zc, { bank: 1.2 });
  // trees, benches
  for (const [x, z] of [[-23, 3], [23, 4], [-12.5, 15.2], [12.5, 15.2]] as P2[]) tree(b, rng, x, z, 0.7, 'round');
  for (let i = 0; i < 8; i++) person(b, rng, rng.range(x0 + 3, x1 - 3), rng.range(z0 + 2, z1 - 2), 0.09, rng.range(0, TAU));
}

function parkBaseball(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 24;
  lawnPatchwork(b, rng, -E, -E, E, E, GRASS_DARK, 3);
  const hx = 0, hz = 16.5; // home plate
  const R = 32; // fence radius
  const dirAt = (a: number): P2 => [Math.sin(a), -Math.cos(a)]; // a=0 -> center field (-Z)
  const P = (a: number, r: number): P2 => [hx + dirAt(a)[0] * r, hz + dirAt(a)[1] * r];
  const Q = Math.PI / 4;
  // outfield grass fan (lit at night) with mowing arcs
  const fan = (r0: number, r1: number, n = 16): P2[] => [...arcPts(0, 0, r1, -Q, Q, n).map(([c, s]) => P(Math.atan2(s, c), r1)), ...(r0 > 0 ? arcPts(0, 0, r0, Q, -Q, n).map(([c, s]) => P(Math.atan2(s, c), r0)) : [[hx, hz] as P2])];
  const bands = [0, 8, 13, 18, 23, 28, R];
  for (let i = 0; i < bands.length - 1; i++) {
    b.paint(i % 2 ? 0x3f7a2c : 0x4a8a34, Surf.Emissive);
    flatPoly(b, fan(bands[i], bands[i + 1] - (i === bands.length - 2 ? 2.4 : 0)), 0.08);
  }
  // warning track
  b.paint(0xa4744c, Surf.Pavement);
  flatPoly(b, fan(R - 2.4, R, 18), 0.08);
  // infield dirt fan + home circle
  b.paint(0xb07a4f, Surf.Pavement);
  flatPoly(b, fan(0, 18.5, 14), 0.09);
  disc(b, hx, hz, 0.09, 3.2, 14);
  // infield grass diamond
  const base = 12.5;
  const b1 = P(Q, base), b2 = P(0, base * Math.SQRT2), b3 = P(-Q, base);
  const cxI = (b1[0] + b3[0]) / 2, czI = (hz + b2[1]) / 2;
  const shrinkP = (p: P2, k: number): P2 => [cxI + (p[0] - cxI) * k, czI + (p[1] - czI) * k];
  b.paint(0x4a8a34, Surf.Emissive);
  flatPoly(b, [shrinkP([hx, hz], 0.8), shrinkP(b1, 0.8), shrinkP(b2, 0.8), shrinkP(b3, 0.8)], 0.1);
  // pitcher's mound
  const mound = P(0, 8.6);
  b.paint(0xb07a4f, Surf.Pavement).cylinder(mound[0], mound[1], 0.09, 0.2, 2.4, 2.0, 12);
  b.paint(0xf4f4f4, Surf.Plain).box(mound[0] - 0.3, 0.29, mound[1] - 0.08, mound[0] + 0.3, 0.31, mound[1] + 0.08, { bottom: null });
  // bases + plate
  for (const p of [b1, b2, b3]) b.paint(0xf4f4f4, Surf.Plain).box(p[0] - 0.3, 0.09, p[1] - 0.3, p[0] + 0.3, 0.18, p[1] + 0.3, { bottom: null });
  b.paint(0xf4f4f4, Surf.Plain);
  flatPoly(b, [[hx - 0.25, hz], [hx + 0.25, hz], [hx + 0.25, hz - 0.2], [hx, hz - 0.45], [hx - 0.25, hz - 0.2]], 0.1);
  // foul lines
  b.paint(WHITE_LINE, Surf.Plain);
  const fl = P(Q, R), fr = P(-Q, R);
  line(b, hx, hz, fl[0], fl[1], 0.12, 0.105);
  line(b, hx, hz, fr[0], fr[1], 0.12, 0.105);
  // outfield fence (green panels) + yellow cap + foul poles
  const fence = arcPts(0, 0, R, -Q, Q, 16).map(([c, s]) => P(Math.atan2(s, c), R));
  for (let i = 0; i < fence.length - 1; i++) {
    panelFence(b, fence[i][0], fence[i][1], fence[i + 1][0], fence[i + 1][1], 0, 2.4, 0x1f4d34);
    b.paint(0xf1c40f, Surf.Plain).beam([fence[i][0], 2.4, fence[i][1]], [fence[i + 1][0], 2.4, fence[i + 1][1]], 0.1);
  }
  b.paint(0xf1c40f, Surf.Metal).cylinder(fl[0], fl[1], 0, 9, 0.12, 0.1, 5).cylinder(fr[0], fr[1], 0, 9, 0.12, 0.1, 5);
  // scoreboard beyond center field
  const sb = P(0, R + 3.6);
  b.paint(0x2a2d31, Surf.Metal).box(sb[0] - 0.2, 0, sb[1] - 0.3, sb[0] + 0.2, 5, sb[1] + 0.3);
  b.box(sb[0] - 5.2, 5, sb[1] - 0.4, sb[0] + 5.2, 9.4, sb[1] + 0.4);
  b.paint(0x1c2a3a, Surf.Emissive).box(sb[0] - 4.8, 5.4, sb[1] + 0.41, sb[0] + 4.8, 8.2, sb[1] + 0.45, { bottom: null, top: null, nx: null, px: null, nz: null });
  b.paint(0xf5d76e, Surf.Emissive).box(sb[0] - 4.2, 8.4, sb[1] + 0.41, sb[0] + 4.2, 9.1, sb[1] + 0.45, { bottom: null, top: null, nx: null, px: null, nz: null });
  // backstop (curved fence) behind home
  const bs = arcPts(hx, hz, 5.8, Math.PI * 0.12, Math.PI * 0.88, 6);
  for (let i = 0; i < bs.length - 1; i++) {
    railFence(b, bs[i][0], bs[i][1], bs[i + 1][0], bs[i + 1][1], 5.5, 3, 0x5c666e, 3);
    panelFence(b, bs[i][0], bs[i][1], bs[i + 1][0], bs[i + 1][1], 0, 1.2, 0x1f4d34);
  }
  // dugouts along the baselines (outside the foul lines)
  for (const s of [-1, 1]) {
    const a = s * Q;
    const pd = P(a, 7.5);
    const nx = Math.cos(a) * s * -1, nz0 = Math.sin(a) * s * -1; // unused orientation helpers
    void nx; void nz0;
    const off: P2 = [pd[0] + s * 3.2, pd[1] + 3.2];
    b.push().translate(off[0], 0, off[1]).rotateY(s > 0 ? -Q - Math.PI / 2 + Math.PI : Q + Math.PI / 2 - Math.PI);
    b.paint(0x8e8b84, Surf.Pavement).box(-4, 0, -1.1, 4, 1.4, 1.1, { pz: null });
    b.paint(0x2c3e50, Surf.Metal).box(-4.1, 1.4, -1.2, 4.1, 1.6, 1.3);
    b.paint(s > 0 ? 0x2d6fb5 : 0xc0392b, Surf.Plain).box(-3.8, 0.1, -1.0, 3.8, 0.5, -0.4);
    b.pop();
  }
  // bleachers behind the dugouts, angled to face the diamond
  for (const s of [-1, 1]) {
    const p = P(s * Q, 13);
    b.push().translate(p[0] + s * 7.2, 0, p[1] + 7.2);
    bleachers(b, 0, 0, 11, 5, s > 0 ? -Q * 3 : Q * 3, { seat: 0x2d6fb5, frame: 0x9a978f, rise: 0.4, depth: 0.75 });
    b.pop();
  }
  // lights
  for (const [x, z] of [[-21.5, 21.0], [21.5, 21.0], [-23, -7], [23, -7], [-10, -22.5], [10, -22.5]] as P2[]) floodMast(b, x, z, 14, x * 0.3, 2, { bank: 2.0, lattice: true });
  // trees + parking strip at the front corners
  for (const [x, z] of [[-21.5, -21.5], [21.5, -21.5], [-6, -23], [6, -23]] as P2[]) tree(b, rng, x, z, 1.0, 'round');
  for (const [x, z] of [[-17, 22.8], [-13.4, 22.8], [15.5, 22.8]] as P2[]) car(b, x, z, Math.PI / 2, rng.pick([0xb8bcc2, 0x8a1c1c, 0x1f3f7a, 0xf1f1ef]), 0.08);
  for (let i = 0; i < 6; i++) {
    const p = i < 3 ? P(rng.range(-0.6, 0.6), rng.range(20, 27)) : [b1, b2, b3][i - 3];
    person(b, rng, p[0] + 0.4, p[1] + 0.4, 0.09, rng.range(0, TAU));
  }
  person(b, rng, mound[0], mound[1], 0.29, Math.PI);
  person(b, rng, hx + 0.6, hz - 0.3, 0.09, -Math.PI / 2);
}

// ------------------------------------------------------------------------------------------------ park_large
function parkLarge(b: ModelBuilder, v: number, rng: RNG): void {
  const E = 32;
  lawnPatchwork(b, rng, -E, -E, E, E, GRASS_LUSH, 6);
  if (v === 0) {
    // meadow & pond park: pond left-back, loop path, gazebo on the right, woodland edge
    b.paint(MEADOW, Surf.Foliage);
    flatPoly(b, blobPoly(rng, 12, 12, 12, 9, 14, 0.3), 0.075);
    const pondPoly = pond(b, rng, -11, -9, 13, 9, { reeds: 10, n: 22, rot: 0.2 });
    const loop = path(b, [[-26, 6], [-14, 6.5], [-1, 3], [8, -4], [14, -17], [4, -25], [-14, -23], [-26, -16], [-28, -4]], 2.4, PATH_GRAVEL, 0.09, 5, true);
    path(b, [[0, 32], [1, 22], [-2, 12], [-3, 4.5]], 3.0, PATH_GRAVEL);
    path(b, [[32, 4], [22, 2], [12, -2], [9, -5]], 2.2, PATH_GRAVEL);
    // gazebo on the right with a little plaza
    b.paint(PATH_GRAVEL, Surf.Pavement);
    disc(b, 17, -14, 0.092, 4.6, 14);
    gazebo(b, 17, -14, 2.6, 6, 0x6e3b2a);
    // wooden footbridge over the pond's west inlet
    // entrance plaza with flower bed
    b.paint(PATH_PAVE, Surf.Pavement);
    disc(b, 0.5, 26, 0.095, 4.2, 16);
    roundBed(b, rng, 0.5, 26, 2.2);
    for (const x of [-4.5, 5.5]) lamp(b, x, 29.5, 4.2, 0);
    // benches along the loop facing the pond
    const benchIdx = [3, 10, 16, 30, 38];
    for (const i of benchIdx) {
      const [x, z] = loop[i % loop.length];
      const dx = -11 - x, dz = -9 - z;
      const l = Math.hypot(dx, dz) || 1;
      parkBench(b, x - (dx / l) * 1.9, z - (dz / l) * 1.9, Math.atan2(dx, dz));
    }
    for (const i of [0, 7, 14, 21, 28, 35]) {
      const [x, z] = loop[i % loop.length];
      lamp(b, x + 1.8, z + 1.2, 4.2, 0);
    }
    // woodland: tree clusters along the edges, solitary trees in the meadow
    const trees: [number, number, number, 'oak' | 'round' | 'cone' | 'birch' | 'maple' | 'willow' | 'poplar'][] = [
      [-28, -28, 1.1, 'cone'], [-22, -29, 1.0, 'oak'], [-15, -29.5, 1.2, 'cone'], [-8, -29, 1.0, 'round'], [0, -29.5, 1.1, 'oak'],
      [8, -29, 1.2, 'cone'], [16, -28, 1.0, 'round'], [24, -28, 1.15, 'oak'], [29, -22, 1.0, 'cone'], [28, -8, 1.1, 'poplar'],
      [29, 12, 1.0, 'oak'], [28, 26, 1.1, 'round'], [-29, -20, 1.0, 'round'], [-29, 14, 1.2, 'oak'], [-28, 26, 1.0, 'maple'],
      [-20, 20, 1.05, 'oak'], [-10, 15, 0.95, 'birch'], [-4, -18, 1.0, 'willow'], [-24, 1, 0.9, 'willow'], [12, 13, 1.25, 'oak'],
      [20, 22, 0.9, 'maple'], [-16, 28, 1.0, 'round'], [16, 29, 1.0, 'round'], [5, 9, 0.85, 'birch'],
    ];
    for (const [x, z, s, k] of trees) tree(b, rng, x, z, s, k);
    for (let i = 0; i < 6; i++) shrub(b, rng, rng.range(-30, 30), rng.range(-30, -26), rng.range(0.8, 1.3));
    // picnic in the meadow
    b.paint(0xd64541, Surf.Plain);
    rect(b, 14, 8, 16.2, 9.8, 0.1);
    picnicTable(b, 20.5, 15.5, 0.3);
    for (let i = 0; i < 5; i++) person(b, rng, rng.range(8, 22), rng.range(4, 20), 0.07, rng.range(0, TAU));
    void pondPoly;
  } else {
    // lake park: central lake with island & boathouse, promenade, formal garden at the front, woods behind
    const lake = pond(b, rng, -2, -6, 18, 12, { reeds: 8, n: 24, rim: 0xc2b8a0, rimW: 1.2 });
    b.paint(GRASS_LUSH, Surf.Foliage);
    flatPoly(b, blobPoly(rng, -5, -8, 4, 3, 10, 0.2), 0.16);
    tree(b, rng, -5, -8, 1.0, 'willow');
    // promenade around the lake
    const prom = path(b, [[-24, -6], [-18, 10], [0, 12], [18, 9], [24, -6], [16, -22], [-2, -24], [-20, -20]], 3.0, PATH_PAVE, 0.09, 5, true);
    path(b, [[0, 32], [0, 12]], 4.0, PATH_PAVE);
    // formal garden at the front (either side of the entrance)
    for (const s of [-1, 1]) {
      const x0 = s > 0 ? 4 : -26, x1 = s > 0 ? 26 : -4;
      hedgeBox(b, x0, 28.6, x1, 29.4, 0.9, 0x3a6a2c);
      flowerBed(b, rng, x0 + 1.5, 20, x1 - 1.5, 22.5, { spacing: 1.1 });
      flowerBed(b, rng, x0 + 1.5, 24.2, x1 - 1.5, 26.8, { spacing: 1.1, colors: [0xf28ab2, 0xffffff, 0x9b6ad6] });
      for (let k = 0; k < 4; k++) b.paint(0x3a6a2c, Surf.Foliage).cone(x0 + 2.5 + k * ((x1 - x0 - 5) / 3), 18.2, 0, 2.4, 0.8, 6);
    }
    fountain(b, 0, 23.5, 2.6, 2, { seg: 16 });
    // boathouse + pier on the east shore with pedal boats
    b.paint(0xe8e2d4, Surf.Wood).box(19, 0, -14, 26, 3.2, -8);
    b.paint(0x2f5d7a, Surf.RoofTiles).gableRoof(22.5, -11, 7, 6, 3.2, 2.0, 'z', 0.4, { color: 0xe8e2d4, surf: Surf.Wood });
    b.paint(0x7a5a3a, Surf.Wood).box(11, 0.25, -12, 19, 0.45, -10);
    for (const [x, z, c] of [[13, -13.6, 0xf1c40f], [16, -13.8, 0xe74c3c], [14, -8.5, 0x3498db]] as [number, number, number][]) {
      b.paint(c, Surf.Plain).box(x - 1, 0.1, z - 0.6, x + 1, 0.55, z + 0.6);
      b.paint(0xffffff, Surf.Plain).box(x - 0.4, 0.55, z - 0.5, x + 0.4, 1.0, z + 0.5);
    }
    // cafe pavilion with umbrellas (north-west)
    b.paint(PATH_PAVE, Surf.Pavement).slab(-27, 6, -17, 15, 0.1);
    b.paint(0xf1ede2, Surf.Plain).box(-26.5, 0.1, 6.5, -21.5, 3.2, 10.5);
    b.paint(0x2e3a44, Surf.GlassPlain).box(-21.55, 0.5, 7, -21.45, 2.6, 10, { top: null, bottom: null, nx: null, pz: null, nz: null });
    b.paint(0x7a2f2a, Surf.RoofTiles).hipRoof(-24, 8.5, 5.4, 4.4, 3.2, 1.4, 0.3);
    for (const [x, z, c] of [[-19, 8, 0xc0392b], [-19, 12.5, 0xecf0f1], [-23, 13, 0x2e86c1]] as [number, number, number][]) umbrella(b, x, z, c, 1.4, 2.4);
    // woods at the back
    for (let i = 0; i < 12; i++) {
      const x = -29 + (i / 11) * 58 + rng.range(-1.5, 1.5);
      const z = -28.5 + rng.range(-1.5, 2.5) + (i % 2) * 2;
      tree(b, rng, x, z, rng.range(0.95, 1.25), i % 3 === 0 ? 'cone' : i % 3 === 1 ? 'oak' : 'round');
    }
    for (const [x, z, k] of [[-29, -12, 'oak'], [-29, 0, 'poplar'], [29, 0, 'poplar'], [29, 12, 'oak'], [29, -18, 'round'], [-12, 16, 'cherry'], [12, 16, 'cherry'], [-29, 20, 'round'], [29, 22, 'maple']] as [number, number, 'oak'][]) tree(b, rng, x, z, 1.0, k);
    // benches + lamps along the promenade
    for (let i = 2; i < prom.length; i += 6) {
      const [x, z] = prom[i];
      const dx = -2 - x, dz = -6 - z, l = Math.hypot(dx, dz) || 1;
      if (i % 12 === 2) parkBench(b, x - (dx / l) * 2.2, z - (dz / l) * 2.2, Math.atan2(dx, dz));
      else lamp(b, x - (dx / l) * 2.1, z - (dz / l) * 2.1, 4.2, 1);
    }
    for (let i = 0; i < 6; i++) {
      const p = prom[rng.int(0, prom.length - 1)];
      person(b, rng, p[0], p[1], 0.09, rng.range(0, TAU));
    }
    void lake;
  }
}

// ------------------------------------------------------------------------------------------------ park_garden
function parkGarden(b: ModelBuilder, v: number, rng: RNG): void {
  const E = 16;
  lawnPatchwork(b, rng, -E, -E, E, E, GRASS_LUSH, 2);
  if (v === 0) {
    // hedge maze: DFS maze on a 7x7 grid (cell 3.8 m) with a gazebo-fountain in the middle
    const N = 7, C = 3.8, H = 1.9, T = 0.6;
    const ox = -(N * C) / 2, oz = -(N * C) / 2 - 0.6;
    b.paint(PATH_GRAVEL, Surf.Pavement).slab(ox, oz, ox + N * C, oz + N * C, 0.08);
    // walls: hWall[r][c] = wall on the north side of cell (r,c) (r = 0..N), vWall[r][c] = wall on west side (c = 0..N)
    const hW: boolean[][] = Array.from({ length: N + 1 }, () => Array(N).fill(true));
    const vW: boolean[][] = Array.from({ length: N }, () => Array(N + 1).fill(true));
    const seen: boolean[][] = Array.from({ length: N }, () => Array(N).fill(false));
    const mid = (N - 1) / 2;
    const stack: [number, number][] = [[mid, mid]];
    seen[mid][mid] = true;
    while (stack.length) {
      const [r, c] = stack[stack.length - 1];
      const nb: [number, number, number][] = [];
      if (r > 0 && !seen[r - 1][c]) nb.push([r - 1, c, 0]);
      if (r < N - 1 && !seen[r + 1][c]) nb.push([r + 1, c, 1]);
      if (c > 0 && !seen[r][c - 1]) nb.push([r, c - 1, 2]);
      if (c < N - 1 && !seen[r][c + 1]) nb.push([r, c + 1, 3]);
      if (!nb.length) { stack.pop(); continue; }
      const [nr, nc, d] = rng.pick(nb);
      if (d === 0) hW[r][c] = false;
      else if (d === 1) hW[r + 1][c] = false;
      else if (d === 2) vW[r][c] = false;
      else vW[r][c + 1] = false;
      seen[nr][nc] = true;
      stack.push([nr, nc]);
    }
    // open center 3x3 plaza + entrance (front middle) + exit (back middle)
    hW[N][mid] = false;
    hW[0][mid] = false;
    for (let r = mid - 1; r <= mid + 1; r++) for (let c = mid - 1; c <= mid + 1; c++) {
      if (r > mid - 1) hW[r][c] = false;
      if (c > mid - 1) vW[r][c] = false;
    }
    const hedgeC = 0x3a6a2c;
    // merge wall runs to save triangles
    for (let r = 0; r <= N; r++) {
      let c = 0;
      while (c < N) {
        if (!hW[r][c]) { c++; continue; }
        let e = c;
        while (e < N && hW[r][e]) e++;
        hedgeBox(b, ox + c * C - T / 2, oz + r * C - T / 2, ox + e * C + T / 2, oz + r * C + T / 2, H, hedgeC);
        c = e;
      }
    }
    for (let c = 0; c <= N; c++) {
      let r = 0;
      while (r < N) {
        if (!vW[r][c]) { r++; continue; }
        let e = r;
        while (e < N && vW[e][c]) e++;
        hedgeBox(b, ox + c * C - T / 2, oz + r * C + T / 2, ox + c * C + T / 2, oz + e * C - T / 2, H, shade(hedgeC, 1.06));
        r = e;
      }
    }
    const cz = oz + (mid + 0.5) * C, cx = ox + (mid + 0.5) * C;
    b.paint(0xd8d0bf, Surf.Pavement);
    disc(b, cx, cz, 0.1, 4.6, 16);
    fountain(b, cx, cz, 2.0, 2, { seg: 16 });
    for (const a of [0.4, 2.0, 3.6, 5.2]) parkBench(b, cx + Math.cos(a) * 3.8, cz + Math.sin(a) * 3.8, Math.atan2(-Math.cos(a), -Math.sin(a)));
    // entrance topiaries + lamps
    const ez = oz + N * C;
    for (const s of [-1, 1]) {
      b.paint(0x2f5a2e, Surf.Foliage).cone(cx + s * 2.6, ez + 1.6, 0, 3.0, 0.8, 7);
      b.paint(0x3f6b2e, Surf.Foliage).blob(cx + s * 4.6, 0.9, ez + 1.4, 0.9, 0.9, 0.9, 0, 0.08, s + 2);
      lamp(b, cx + s * 1.8, ez + 1.2, 3.6, 1);
    }
    for (const [x, z] of [[-14.6, -14.6], [14.6, -14.6], [-14.6, 14.2], [14.6, 14.2]] as P2[]) tree(b, rng, x, z, 0.8, 'cherry');
  } else {
    // parterre: gravel cross + ring, boxwood knots, flower beds, pergola with climbing roses at the back
    b.paint(PATH_GRAVEL, Surf.Pavement).slab(-14, -10, 14, 16, 0.08);
    b.paint(0xe2d8bf, Surf.Pavement);
    annulus(b, 0, 3, 0.085, 5.5, 7.0, 28);
    rect(b, -1.2, -10, 1.2, 16, 0.086);
    rect(b, -14, 1.8, 14, 4.2, 0.087);
    fountain(b, 0, 3, 3.0, 2, { seg: 20 });
    const box = 0x3a6a2c;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x0 = sx > 0 ? 2.4 : -13.2, x1 = sx > 0 ? 13.2 : -2.4, z0 = sz > 0 ? 5.4 : -9.2, z1 = sz > 0 ? 15.2 : 0.6;
      // boxwood frame
      hedgeBox(b, x0, z0, x1, z0 + 0.45, 0.55, box);
      hedgeBox(b, x0, z1 - 0.45, x1, z1, 0.55, box);
      hedgeBox(b, x0, z0 + 0.45, x0 + 0.45, z1 - 0.45, 0.55, box);
      hedgeBox(b, x1 - 0.45, z0 + 0.45, x1, z1 - 0.45, 0.55, box);
      // inner diagonal knot
      b.paint(box, Surf.Foliage);
      ribbon(b, [[x0 + 0.6, z0 + 0.6], [x1 - 0.6, z1 - 0.6]], 0.4, 0.5, { sides: true });
      ribbon(b, [[x0 + 0.6, z1 - 0.6], [x1 - 0.6, z0 + 0.6]], 0.4, 0.5, { sides: true });
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      // flower triangles between the diagonals
      const cols = sx * sz > 0 ? [0xe0475a, 0xf28ab2] : [0xf2c14e, 0x9b6ad6];
      flowerBed(b, rng, mx - 1.5, z0 + 1.2, mx + 1.5, z0 + 2.6, { colors: cols, border: null, spacing: 0.7 });
      flowerBed(b, rng, mx - 1.5, z1 - 2.6, mx + 1.5, z1 - 1.2, { colors: cols, border: null, spacing: 0.7 });
      flowerBed(b, rng, x0 + 1.0, mz - 1.0, x0 + 2.6, mz + 1.0, { colors: [cols[1], cols[0]], border: null, spacing: 0.7 });
      flowerBed(b, rng, x1 - 2.6, mz - 1.0, x1 - 1.0, mz + 1.0, { colors: [cols[1], cols[0]], border: null, spacing: 0.7 });
      b.paint(0x2f5a2e, Surf.Foliage).cone(mx, mz, 0.08, 2.4, 0.6, 7);
      // corner topiary balls
      b.paint(0x3f6b2e, Surf.Foliage).blob(sx > 0 ? x1 - 0.2 : x0 + 0.2, 0.9, sz > 0 ? z1 - 0.2 : z0 + 0.2, 0.7, 0.7, 0.7, 0, 0.05, 3);
    }
    // pergola along the back
    const pz0 = -14.8, pz1 = -11.4;
    b.paint(0xd9d2c3, Surf.Pavement).slab(-13, pz0, 13, pz1, 0.1);
    b.paint(0xf1ede2, Surf.Wood);
    for (let i = 0; i <= 6; i++) {
      const x = -12.5 + i * (25 / 6);
      b.box(x - 0.15, 0.1, pz0 + 0.2, x + 0.15, 2.8, pz0 + 0.5, { top: null }).box(x - 0.15, 0.1, pz1 - 0.5, x + 0.15, 2.8, pz1 - 0.2, { top: null });
    }
    b.box(-12.8, 2.8, pz0 + 0.15, 12.8, 3.05, pz0 + 0.55).box(-12.8, 2.8, pz1 - 0.55, 12.8, 3.05, pz1 - 0.15);
    for (let i = 0; i <= 14; i++) {
      const x = -12.5 + i * (25 / 14);
      b.box(x - 0.08, 3.05, pz0 - 0.2, x + 0.08, 3.25, pz1 + 0.2);
    }
    // climbing roses on top (foliage clumps with pink)
    for (let i = 0; i < 7; i++) {
      const x = -11 + i * 3.7 + rng.range(-0.5, 0.5);
      b.paint(i % 2 ? 0x4f7a32 : 0x5a8a38, Surf.Foliage).blob(x, 3.35, (pz0 + pz1) / 2, 1.6, 0.4, 1.4, 0, 0.2, i);
      b.paint(rng.pick([0xe0475a, 0xf28ab2, 0xffffff]), Surf.Foliage).blob(x + 0.6, 3.5, (pz0 + pz1) / 2 + 0.3, 0.6, 0.25, 0.5, 0, 0.2, i + 9);
    }
    for (const x of [-9, -3, 3, 9]) parkBench(b, x, pz1 - 1.2, 0, 0xf1ede2);
    // side hedges and trees
    hedgeBox(b, -15.6, -15.6, -14.8, 15.6, 1.6, 0x345e2a);
    hedgeBox(b, 14.8, -15.6, 15.6, 15.6, 1.6, 0x345e2a);
    for (const [x, z] of [[-14.2, 15], [14.2, 15]] as P2[]) lamp(b, x + (x < 0 ? 1 : -1) * 0.6, z - 0.5, 3.6, 0);
    for (const z of [-6, 8]) {
      tree(b, rng, -14.9, z, 0.75, 'poplar');
      tree(b, rng, 14.9, z, 0.75, 'poplar');
    }
  }
}

// ------------------------------------------------------------------------------------------------ park_marina
function boat(b: ModelBuilder, rng: RNG, x: number, z: number, len: number, rot: number, kind: 'motor' | 'sail' | 'cabin'): void {
  b.push().translate(x, 0, z).rotateY(rot);
  const w = len * 0.34, hw = w / 2;
  const hull: P2[] = [[-len / 2, -hw * 0.85], [len * 0.2, -hw], [len / 2, 0], [len * 0.2, hw], [-len / 2, hw * 0.85]];
  const hc = rng.pick([0xf4f4f0, 0xf4f4f0, 0x1f3f7a, 0xe8e2d0]);
  b.paint(hc, Surf.Plain);
  b.extrude(hull.map(([a, c]) => [a, c] as P2), -0.2, 0.9, { topPaint: { color: 0xc8b28a, surf: Surf.Wood } });
  b.paint(rng.pick([0x1f3f7a, 0xc0392b, 0x2e86c1]), Surf.Plain).extrude(hull.map(([a, c]) => [a * 1.01, c * 1.01] as P2), 0.55, 0.12, { top: false });
  if (kind === 'motor') {
    b.paint(0xf4f4f0, Surf.Plain).box(-len * 0.2, 0.7, -hw * 0.6, len * 0.12, 1.4, hw * 0.6);
    b.paint(0x1a2330, Surf.GlassPlain).box(len * 0.12, 0.7, -hw * 0.55, len * 0.18, 1.3, hw * 0.55, { bottom: null });
  } else if (kind === 'cabin') {
    b.paint(0xf4f4f0, Surf.Plain).box(-len * 0.3, 0.7, -hw * 0.7, len * 0.2, 1.6, hw * 0.7);
    b.paint(0x1a2330, Surf.GlassPlain).box(-len * 0.28, 1.0, -hw * 0.71, len * 0.18, 1.4, hw * 0.71, { top: null, bottom: null });
    b.paint(0xf4f4f0, Surf.Plain).box(-len * 0.25, 1.6, -hw * 0.6, len * 0.05, 2.2, hw * 0.6);
  } else {
    b.paint(0xdedede, Surf.Metal).cylinder(len * 0.08, 0, 0.7, 5.6, 0.08, 0.05, 5);
    b.beam([len * 0.08, 1.7, 0], [-len * 0.4, 1.7, 0], 0.08);
    b.paint(0x2e5aa8, Surf.Plain).cylinder(-len * 0.16, 0, 1.75, 0.01, 0.2, 0.2, 5);
    b.push().translate(len * 0.08, 1.7, 0).rotateZ(Math.PI / 2);
    b.paint(0x2e5aa8, Surf.Plain).cylinder(0, 0, 0, len * 0.46, 0.17, 0.12, 6);
    b.pop();
    b.paint(0xf4f4f0, Surf.Plain).box(-len * 0.3, 0.7, -hw * 0.5, len * 0.0, 1.1, hw * 0.5);
  }
  b.pop();
}

function parkMarina(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 16;
  const quayZ = -3.5;
  // water basin (+Z half) and land (-Z)
  b.paint(0x2f6f8a, Surf.Water).slab(-E, quayZ, E, E, 0.03);
  lawnPatchwork(b, rng, -E, -E, E, quayZ - 4.5, GRASS_LUSH, 2);
  b.paint(0xc9b99a, Surf.Wood).slab(-E, quayZ - 4.5, E, quayZ, 0.6);
  b.paint(0x8e8878, Surf.Stone).box(-E, -0.6, quayZ - 0.4, E, 0.62, quayZ + 0.1, { bottom: null });
  // bollards + lamps on the quay
  b.paint(0x2b2f33, Surf.Metal);
  for (let x = -14; x <= 14; x += 4) b.cylinder(x, quayZ - 0.6, 0.6, 0.45, 0.16, 0.13, 6);
  for (const x of [-12, -4, 4, 12]) {
    b.push().translate(0, 0.6, 0);
    lamp(b, x + 2, quayZ - 3.6, 3.8, 0);
    b.pop();
  }
  // clubhouse / harbormaster (white clapboard, blue roof) + parking
  b.paint(0xf1efe8, Surf.Wood).box(-14.5, 0, -15, -5.5, 3.6, -9);
  b.paint(0x2f5d8a, Surf.RoofTiles).gableRoof(-10, -12, 9, 6, 3.6, 2.2, 'x', 0.4, { color: 0xf1efe8, surf: Surf.Wood });
  b.paint(0x24323d, Surf.GlassPlain).box(-13.8, 0.8, -8.98, -6.2, 2.8, -8.95, { top: null, bottom: null, nx: null, px: null, nz: null });
  b.paint(0xf1efe8, Surf.Wood).box(-7.2, 0, -14.4, -5.6, 5.6, -12.8);
  b.paint(0x24323d, Surf.GlassPlain).box(-7.3, 4.2, -14.5, -5.5, 5.2, -12.7, { top: null, bottom: null });
  b.paint(0x2f5d8a, Surf.RoofTiles).pyramid(-6.4, -13.6, 2.2, 2.2, 5.6, 0.7);
  b.paint(PALETTE.asphalt, Surf.Pavement).slab(-3, -15.5, 15, -9, 0.08);
  b.paint(0xeeeeee, Surf.Plain);
  for (let x = -2; x <= 14; x += 3) line(b, x, -15.2, x, -11.5, 0.1, 0.09);
  for (const x of [-0.5, 5.5, 11.5]) car(b, x, -13.3, 0, rng.pick([0xb8bcc2, 0x8a1c1c, 0x1f3f7a, 0xf1f1ef, 0x2b2d31]), 0.08);
  // boat on a trailer
  boat(b, rng, 10.5, -8.4 + 0.2, 6, 0, 'motor');
  // docks: main pier + finger piers on pilings
  const deckY = 0.5;
  b.paint(0x9a7a55, Surf.Wood).box(-1.2, deckY - 0.2, quayZ, 1.2, deckY, 15.3);
  const fingers = [1.5, 6, 10.5];
  for (const fz of fingers) {
    b.paint(0x9a7a55, Surf.Wood).box(-13.5, deckY - 0.2, fz - 0.55, -1.2, deckY, fz + 0.55).box(1.2, deckY - 0.2, fz - 0.55, 13.5, deckY, fz + 0.55);
  }
  b.paint(0x9a7a55, Surf.Wood).box(-13.5, deckY - 0.2, 14.5, 13.5, deckY, 15.5);
  b.paint(0x4a3a2a, Surf.Wood);
  for (const fz of [...fingers, 15]) for (const x of [-13.2, -7, 7, 13.2]) b.cylinder(x, fz + 0.6, -0.6, 1.8, 0.15, 0.15, 5);
  // moored boats between the fingers (pointing along X)
  const slots: [number, number, number][] = [];
  for (const [za, zb] of [[fingers[0], fingers[1]], [fingers[1], fingers[2]], [fingers[2], 14.5]]) {
    const zm = (za + zb) / 2;
    for (const x of [-10.2, -4.4, 4.4, 10.2]) slots.push([x, zm, x < 0 ? Math.PI : 0]);
  }
  slots.forEach(([x, z, r], i) => {
    if (i === 5 || i === 10) return;
    const kinds: ('motor' | 'sail' | 'cabin')[] = ['sail', 'motor', 'cabin', 'sail'];
    boat(b, rng, x, z, rng.range(5.2, 6.6), r, kinds[(i + (i >> 2)) % 4]);
  });
  // buoys and a life-ring post
  b.paint(0xe74c3c, Surf.Plain).cylinder(-15, 12, 0, 0.8, 0.3, 0.2, 6).cylinder(15, 12, 0, 0.8, 0.3, 0.2, 6);
  for (const x of [-1.0, 1.0]) {
    b.push().translate(0, deckY, 0);
    lamp(b, x, 8, 3.2, 1);
    b.pop();
  }
  tree(b, rng, 14.4, -14.6, 0.8, 'round');
  tree(b, rng, -1.5, -15.0, 0.7, 'round');
  for (let i = 0; i < 4; i++) person(b, rng, rng.range(-12, 12), quayZ - rng.range(1, 4), 0.6, rng.range(0, TAU));
}

// ------------------------------------------------------------------------------------------------ exports
export const models: ModelBuilders = lotModels({
  park_small: parkSmall,
  park_plaza: parkPlaza,
  park_playground: parkPlayground,
  park_basketball: parkBasketball,
  park_tennis: parkTennis,
  park_soccer: parkSoccer,
  park_baseball: parkBaseball,
  park_large: parkLarge,
  park_garden: parkGarden,
  park_marina: parkMarina,
  ...venueModels,
});

// keep some helpers referenced for tree-shaking friendliness of optional imports
void cylWall; void FLOWERS; void LAMP_GLOW; void STONE_RIM;
