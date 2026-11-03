/** LG-03's unique project sites. Geometry and dressing use only the registry's local asset seed. */
import { ModelBuilder } from '../ModelBuilder';
import type { ModelBuilders } from '../registry';
import type { RNG } from '../../core/rng';
import { Surf } from '../../core/types';
import { lattice, parking, roofUnit } from './ind_kit';
import { surface } from './lm_lib';
import { annulus, lamp, lotModels, parkBench, person, rect, rectPoly, tree, type V3 } from './park_lib';

const TAU = Math.PI * 2;
const PAVE = 0xc5c2b7, WHITE = 0xe5e6df, STEEL = 0x78959a, GLASS = 0x638d9a;
const roof = { color: 0x87938e, surf: Surf.RoofFlat };

/** Smooth toroidal cladding; the inner wall's normal points into the central opening. */
function torus(b: ModelBuilder, x: number, y: number, z: number, radius: number, tube: number, seg = 32, rows = 8): void {
  const at = (i: number, j: number): [V3, V3] => {
    const a = i * TAU / seg, c = j * TAU / rows, ca = Math.cos(a), sa = Math.sin(a), cc = Math.cos(c), sc = Math.sin(c);
    return [[x + ca * (radius + tube * cc), y + tube * sc, z + sa * (radius + tube * cc)], [ca * cc, sc, sa * cc]];
  };
  for (let i = 0; i < seg; i++) for (let j = 0; j < rows; j++) {
    const [a, na] = at(i, j), [c, nc] = at(i + 1, j), [d, nd] = at(i + 1, j + 1), [e, ne] = at(i, j + 1);
    b.triN(a, d, c, na, nd, nc).triN(a, e, d, na, ne, nd);
  }
}

function spire(b: ModelBuilder, x: number, z: number, y: number, height: number, radius: number, seg: number): void {
  const normal = (a: number): V3 => {
    const len = Math.hypot(1, radius / height);
    return [Math.cos(a) / len, radius / height / len, Math.sin(a) / len];
  };
  for (let i = 0; i < seg; i++) {
    const a = i * TAU / seg, c = (i + 1) * TAU / seg;
    b.triN([x + Math.cos(a) * radius, y, z + Math.sin(a) * radius], [x, y + height, z], [x + Math.cos(c) * radius, y, z + Math.sin(c) * radius], normal(a), normal((a + c) / 2), normal(c));
  }
}

function siteLamp(b: ModelBuilder, x: number, z: number, half: number, h = 5): void {
  lamp(b, x, z, h, 1, [{ color: PAVE, y: 0.1, clip: [rectPoly(-half, -half, half, half)] }]);
}

function expressMetro(b: ModelBuilder, _v: number, rng: RNG): void {
  b.paint(PAVE, Surf.Pavement).slab(-16, -16, 16, 16, 0.1);
  b.paint(0x668348, Surf.Foliage).slab(-16, -16, -13, 16, 0.12).slab(13, -16, 16, 16, 0.12);
  // Operations hall behind the pair of glazed subway entrance canopies.
  b.paint(WHITE, Surf.WallWindows, 2, 3.6).box(-12, 0.1, -14, 12, 7.2, -3.6, { top: roof });
  b.paint(STEEL, Surf.Metal).box(-12.3, 7.2, -14.2, 12.3, 7.7, -3.4);
  b.paint(0x38768f, Surf.Metal).box(-12, 5.4, -3.6, 12, 6.3, -3.4);
  b.paint(GLASS, Surf.GlassPlain, 2).box(-8, 0.15, -3.6, 8, 4.5, -2.8, { top: null });
  b.paint(WHITE, Surf.Plain).box(7.5, 7.7, -12, 11.5, 10.4, -7.5);
  b.paint(GLASS, Surf.GlassPlain, 2).box(7.3, 10.4, -12.2, 11.7, 11.6, -7.3);
  b.paint(STEEL, Surf.Metal).box(7.1, 11.6, -12.4, 11.9, 12, -7.1);
  for (const x of [-7, 7]) {
    b.paint(0x24363c, Surf.Plain).box(x - 3, 0.1, 0, x + 3, 0.2, 11.8);
    for (let i = 0; i < 9; i++) {
      const z = 3.3 + i * 0.95;
      b.paint(0x8c9491, Surf.Stone).box(x - 2.7, 0.2, z, x + 2.7, 0.22 + i * 0.035, z + 0.65);
    }
    b.paint(STEEL, Surf.Metal);
    for (const dx of [-3.1, 3.1]) {
      b.box(x + dx - 0.1, 0.1, -0.1, x + dx + 0.1, 4.7, 0.1);
      b.box(x + dx - 0.1, 0.1, 10.7, x + dx + 0.1, 4.7, 10.9);
      b.beam([x + dx, 1.3, 0], [x + dx, 1.3, 11.8], 0.12);
    }
    b.paint(GLASS, Surf.GlassPlain, 2).gableRoof(x, 5.4, 6.6, 11.4, 4.6, 1.8, 'z', 0.12);
    b.paint(STEEL, Surf.Metal).box(x - 3.4, 4.45, 11, x + 3.4, 4.8, 11.4);
    b.paint(0x225a76, Surf.Metal).box(x - 2, 3.2, 11.45, x + 2, 4.3, 11.7);
    // A legible geometric M, front-facing and night lit.
    b.paint(0xcbe5db, Surf.Emissive, 10);
    for (const s of [-1, 1]) {
      b.beam([x + s * 0.85, 3.4, 11.74], [x + s * 0.85, 4.1, 11.74], 0.13);
      b.beam([x + s * 0.85, 4.1, 11.74], [x, 3.5, 11.74], 0.13);
    }
  }
  for (const x of [-12, 12]) siteLamp(b, x, 13, 16, 4);
  parkBench(b, 0, 6, Math.PI / 2);
  for (const [x, z] of [[-10.5, 13.8], [3, 13], [11, 0]]) person(b, rng, x, z, 0.1, rng.range(0, TAU));
}

function fusionPlant(b: ModelBuilder, _v: number, rng: RNG): void {
  b.paint(0x6b884b, Surf.Foliage).slab(-48, -48, 48, 48, 0.06);
  b.paint(PAVE, Surf.Pavement).slab(-44, -43, 44, 43, 0.1).slab(-5, 43, 5, 48, 0.1);
  const x = -12, z = -11;
  // The sealed reactor is a toroidal hall, with a central diagnostics lantern. No smoke or steam emitters.
  b.paint(0xb6c0b9, Surf.Stone).cylinder(x, z, 0.1, 2.4, 24, 24, 32);
  b.paint(WHITE, Surf.Corrugated).cylinder(x, z, 2.5, 15, 22, 22, 32);
  b.paint(0xb6c6c6, Surf.Metal);
  torus(b, x, 18, z, 16, 7, 32, 8);
  b.paint(0x75b6ba, Surf.Emissive, 10).cylinder(x, z, 15.2, 0.8, 22.15, 22.15, 32, { top: false });
  b.paint(WHITE, Surf.Plain).cylinder(x, z, 18, 16, 5.8, 4.7, 16);
  b.paint(GLASS, Surf.GlassPlain, 2).cylinder(x, z, 34, 5, 4.7, 4.7, 16);
  b.paint(STEEL, Surf.Metal);
  spire(b, x, z, 39, 3, 5.7, 16);
  b.cylinder(x, z, 42, 5.5, 0.25, 0.14, 6);
  b.paint(0xff6a4a, Surf.Emissive, 10).boxC(x, z, 0.45, 0.45, 47.5, 0.5);
  b.paint(STEEL, Surf.Metal);
  for (let i = 0; i < 16; i++) {
    const a = i * TAU / 16, ca = Math.cos(a), sa = Math.sin(a);
    b.beam([x + ca * 22.1, 2.5, z + sa * 22.1], [x + ca * 22.1, 17, z + sa * 22.1], 0.24);
  }
  // Turbine hall, heat exchangers and the front switchyard connect the reactor to the grid.
  b.paint(WHITE, Surf.Corrugated).box(14, 0.1, -37, 42, 14, 10, { top: roof });
  b.paint(GLASS, Surf.GlassPlain, 2).box(14, 10, 10, 42, 13, 10.04, { top: null, nz: null });
  b.paint(STEEL, Surf.Metal).box(8, 6, -7, 14, 11, 2);
  for (const rz of [-27, -14, -1]) roofUnit(b, 28, 14, rz, 12, 6, 2, 0xb7c8c4);
  b.paint(WHITE, Surf.WallWindows, 2, 3.6).box(-41, 0.1, 27, 4, 10.8, 40, { top: roof });
  for (const tx of [16, 27, 38]) {
    b.paint(0x727f7c, Surf.Metal).boxC(tx, 29, 7, 9, 0.1, 4.8);
    for (const dx of [-2, 0, 2]) b.box(tx + dx - 0.15, 0.5, 23.9, tx + dx + 0.15, 4.2, 24.4);
    b.paint(0xc1b294, Surf.Metal);
    for (const dz of [-2, 2]) b.cylinder(tx, 29 + dz, 4.8, 2, 0.35, 0.3, 6);
  }
  b.paint(STEEL, Surf.Metal).beam([16, 6.2, 27], [38, 6.2, 27], 0.18);
  for (const [lx, lz] of [[-39, 20], [39, 17], [7, 39]]) siteLamp(b, lx, lz, 44, 7);
  for (const [tx, tz] of [[-43, -40], [-42, 43], [42, 43]]) tree(b, rng, tx, tz, 0.65, 'cone');
}

/** Same permanent tower in the fairground and its future standalone reward. */
function expoTower(b: ModelBuilder): void {
  b.paint(0xcec7b4, Surf.Stone).cylinder(0, 0, 0.1, 2, 12, 12, 24);
  b.paint(WHITE, Surf.Plain).cylinder(0, 0, 2.1, 58, 3.1, 2, 12);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + Math.PI / 2;
    b.paint(WHITE, Surf.Plain).beam([Math.cos(a) * 9.5, 2.1, Math.sin(a) * 9.5], [Math.cos(a) * 2, 57, Math.sin(a) * 2], 1.8);
  }
  b.paint(STEEL, Surf.Metal).cylinder(0, 0, 57, 3.5, 3.1, 11, 24);
  b.paint(GLASS, Surf.GlassPlain, 2).cylinder(0, 0, 60.5, 5, 10.8, 10.8, 24);
  b.paint(0xb8d4d1, Surf.Emissive, 10).cylinder(0, 0, 65.5, 0.8, 11.4, 11.4, 24);
  b.paint(STEEL, Surf.Metal);
  spire(b, 0, 0, 66.3, 5.7, 11.4, 24);
  b.paint(WHITE, Surf.Plain).cylinder(0, 0, 72, 16, 0.8, 0.35, 8);
  spire(b, 0, 0, 88, 6.5, 0.35, 8);
  b.paint(0xd1e9df, Surf.Emissive, 10).cylinder(0, 0, 78, 1, 0.65, 0.65, 8, { top: false });
  b.paint(0xff7660, Surf.Emissive, 10).boxC(0, 0, 0.35, 0.35, 94.5, 0.5);
}

function worldExpo(b: ModelBuilder, _v: number, rng: RNG): void {
  b.paint(PAVE, Surf.Pavement).slab(-48, -48, 48, 48, 0.1);
  for (const s of [-1, 1]) b.paint(0x789151, Surf.Foliage).slab(s * 42, -44, s * 47, 32, 0.12);
  b.push().translate(0, 0, -5);
  expoTower(b);
  b.pop();
  const pavilions = [[-28, -27, 0xc07b59], [28, -27, 0x789caa], [-28, 12, 0xa4aa62], [28, 12, 0xa57d9d]];
  for (const [x, z, color] of pavilions) {
    b.paint(GLASS, Surf.GlassPlain, 2).boxC(x, z, 22, 20, 0.1, 6.5, { top: null });
    b.paint(color, Surf.Metal).pyramid(x, z, 23, 21, 6.6, z < 0 ? 13 : 8);
    b.paint(WHITE, Surf.Plain).boxC(x, z + 10.1, 23, 1, 6.4, 0.5);
    for (const dx of [-10, 0, 10]) b.boxC(x + dx, z + 10.3, 0.3, 0.4, 0.1, 6.3);
    b.paint(color, Surf.Metal).boxC(x, z + 11, 8, 2.2, 3.6, 0.4);
  }
  // Paired reflecting pools and the flag-lined entrance promenade.
  for (const x of [-13, 13]) {
    b.paint(0xaaa68f, Surf.Stone).boxC(x, 34, 8, 13, 0.1, 0.45);
    b.paint(0x5296a4, Surf.Water).boxC(x, 34, 7.3, 12.3, 0.52, 0.05);
  }
  for (let i = 0; i < 8; i++) {
    const x = -38.5 + i * 11;
    b.paint(STEEL, Surf.Metal).cylinder(x, 43, 0.1, 7, 0.1, 0.07, 5);
    b.paint(pavilions[i % 4][2], Surf.Plain).quad2([x, 7, 43], [x + 3, 6.7, 43.25], [x + 3, 5.1, 43.25], [x, 5.4, 43]);
  }
  for (const x of [-42, 42]) for (const z of [-5, 35]) siteLamp(b, x, z, 48, 6);
  for (const [x, z] of [[-42, -41], [42, -41], [-43, 25], [43, 25]]) tree(b, rng, x, z, 0.65, 'oak');
  for (const x of [-5, 5]) parkBench(b, x, 26, Math.PI / 2);
  for (const [x, z] of [[-4, 38], [4, 31], [7, 20], [-15, 23], [20, -4], [-20, -6]]) person(b, rng, x, z, 0.1, rng.range(0, TAU));
}

function towerLot(b: ModelBuilder, _v: number, rng: RNG): void {
  b.paint(PAVE, Surf.Pavement).slab(-16, -16, 16, 16, 0.1);
  expoTower(b);
  for (const x of [-13, 13]) {
    siteLamp(b, x, 12, 16, 4);
    b.paint(0x74904c, Surf.Foliage).slab(x - 1.5, -14, x + 1.5, -6, 0.15);
  }
  parkBench(b, -6, 13);
  person(b, rng, 4, 13, 0.1, 1.1);
}

function rocket(b: ModelBuilder, x: number, z: number): void {
  b.paint(0x555b5d, Surf.Metal).cylinder(x, z, 1, 3, 4.1, 3.4, 12);
  b.paint(WHITE, Surf.Metal).cylinder(x, z, 4, 35, 3.2, 3.2, 16, { top: false });
  b.paint(0x34434b, Surf.Plain).cylinder(x, z, 29, 2.8, 3.23, 3.23, 16, { top: false });
  b.paint(WHITE, Surf.Metal).cylinder(x, z, 39, 7, 3.2, 2.4, 16);
  spire(b, x, z, 46, 8, 2.4, 16);
  for (const dx of [-5, 5]) {
    b.paint(0xc9d1cf, Surf.Metal).cylinder(x + dx, z, 3, 24, 1.6, 1.6, 10);
    spire(b, x + dx, z, 27, 4, 1.6, 10);
    b.paint(0x465058, Surf.Metal).cylinder(x + dx, z, 1.6, 1.4, 1.9, 1.2, 10);
  }
  b.paint(0x416d83, Surf.Metal);
  for (let i = 0; i < 4; i++) {
    b.push().translate(x, 0, z).rotateY(i * Math.PI / 2);
    b.quad2([2.8, 4, 0], [5.5, 4, 0], [4.3, 10, 0], [2.8, 12, 0]);
    b.pop();
  }
}

function dish(b: ModelBuilder, x: number, z: number, y: number): void {
  b.paint(STEEL, Surf.Metal).cylinder(x, z, y, 3, 0.7, 0.5, 8);
  b.push().translate(x, y + 5, z).rotateX(0.4);
  b.paint(WHITE, Surf.Metal);
  surface(b, (u, v) => [Math.cos(u * TAU) * v * 6.5, v * v * 2.5, Math.sin(u * TAU) * v * 6.5], 20, 3, [0, -3, 0], true);
  b.paint(STEEL, Surf.Metal);
  for (const a of [0, TAU / 3, TAU * 2 / 3]) b.beam([Math.cos(a) * 6.5, 2.5, Math.sin(a) * 6.5], [0, 6, 0], 0.12);
  b.paint(0x576d75, Surf.Metal).boxC(0, 0, 0.7, 0.7, 5.8, 0.8);
  b.pop();
}

function spaceCenter(b: ModelBuilder, _v: number, rng: RNG): void {
  b.paint(0x7c9358, Surf.Foliage).slab(-64, -64, 64, 64, 0.06);
  b.paint(PAVE, Surf.Pavement).slab(-59, -57, 57, 34, 0.1).slab(-8, 34, 8, 64, 0.1);
  b.paint(0x999d95, Surf.Pavement).cylinder(-23, -21, 0.1, 0.4, 26, 26, 32);
  b.paint(0x4d5350, Surf.Pavement).box(-27, 0.5, -47, -19, 0.6, -9);
  b.paint(WHITE, Surf.Plain);
  annulus(b, -23, -21, 0.52, 22, 22.4, 32);
  rocket(b, -23, -21);
  b.paint(0xb08559, Surf.Metal);
  lattice(b, -37, -21, 0.5, 58, 3.8, 3.8, 3.8, 3.8, 7, 0.45, { rings: true });
  for (const y of [16, 30, 43, 51]) b.box(-34, y, -22, -26.4, y + 0.7, -20);
  b.paint(0xff785c, Surf.Emissive, 10).boxC(-37, -21, 0.6, 0.6, 58, 0.6);
  // Vehicle assembly hall and a glass-fronted mission-control campus.
  b.paint(WHITE, Surf.Corrugated).box(13, 0.1, -49, 54, 21, -13, { top: null });
  b.paint(0x99aeb0, Surf.Metal).gableRoof(33.5, -31, 41, 36, 21, 6, 'z', 0.25);
  b.paint(0x566d76, Surf.Metal).box(18, 0.1, -13, 49, 18, -12.8, { top: null });
  b.paint(WHITE, Surf.WallWindows, 2, 3.6).box(17, 0.1, 17, 55, 14.4, 42, { top: roof });
  b.paint(GLASS, Surf.GlassPlain, 2).box(21, 0.1, 42, 51, 7, 44, { top: roof });
  b.paint(WHITE, Surf.Plain).box(40, 14.4, 20, 51, 21.6, 31, { top: roof });
  b.paint(GLASS, Surf.GlassPlain, 2).box(39.7, 21.6, 19.7, 51.3, 25.2, 31.3);
  b.paint(STEEL, Surf.Metal).box(39.5, 25.2, 19.5, 51.5, 25.7, 31.5);
  dish(b, 26, 28, 14.4);
  for (const z of [-5, 7, 19]) {
    b.paint(WHITE, Surf.Metal).cylinder(-52, z, 0.1, 8, 3.7, 3.7, 12).sphere(-52, 8.1, z, 3.7, 12, 6, { hemi: true, scaleY: 0.45 });
  }
  b.paint(STEEL, Surf.Metal).pipe([-52, 1.3, -5], [-52, 1.3, 19], 0.3, 6).pipe([-52, 1.3, -5], [-34, 1.3, -5], 0.3, 6);
  parking(b, rng, -56, 38, -14, 59, 0.4, 5);
  for (const [x, z] of [[-57, -51], [54, -7], [12, 46], [-10, 32]]) siteLamp(b, x, z, 64, 9);
  for (const [x, z] of [[20, 55], [32, 55], [50, 55], [-59, 25]]) tree(b, rng, x, z, 0.8, 'cone');
  b.paint(0x375a70, Surf.Metal).box(-7, 0.1, 56, 7, 3.5, 57);
  b.paint(0xcce3e0, Surf.Emissive, 10);
  rect(b, -6, 55.5, 6, 56, 0.12);
}

export const models: ModelBuilders = lotModels({
  tr_express_metro: expressMetro,
  util_fusion_plant: fusionPlant,
  lm_world_expo: worldExpo,
  lm_expo_tower: towerLot,
  rw_space_center: spaceCenter,
});
