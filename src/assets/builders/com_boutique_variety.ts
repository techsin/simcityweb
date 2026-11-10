/** Boutique roof families; the original five boutique appearances remain in com_low.ts. */
import type { ModelBuilder, Paint } from '../ModelBuilder';
import type { ModelBuildFn, ModelBuilders } from '../registry';
import type { RNG } from '../../core/rng';
import { Surf } from '../../core/types';
import * as K from './com_kit';
import { P, box, up, faceZ } from './com_kit';

type B = ModelBuilder;
const STONE = [0xdfd1b7, 0xc5d0c7, 0xe1c3b4, 0xbec9d5, 0xd3c4d7];
const DARK = [0x3d4649, 0x4f3d4a, 0x3b5150, 0x494255, 0x575149];
const TRIM = [0x806747, 0x526961, 0x81584d, 0x4a596b, 0x695374];
const TILE = [0x587b70, 0x596776, 0x8b5d49, 0x62644e, 0x746579];

function boutiqueLot(b: B, rng: RNG, trim: number) {
  up(b, -8, -8, 8, 8, 0.03, K.pav(0xc8c1b2));
  up(b, -8, 6.3, 8, 8, 0.05, K.pav(0xd9d2c4));
  for (const x of [-4.9, 4.9]) K.planter(b, rng, x - 0.9, 4.9, x + 0.9, 6.0, 0.65, trim);
  box(b, -1.7, 0.4, 5.6, 1.7, 0.6, 6.1, P(0x887153, Surf.Wood), undefined, { bottom: P(0x887153, Surf.Wood) });
}

function boutiqueFront(b: B, v: number, rng: RNG, z: number, trim: number, wall: Paint) {
  for (const [a, e] of [[-5.6, -1.8], [1.8, 5.6]] as [number, number][]) {
    K.storefront(b, a, e, z, { y0: 0.65, y1: 3.8, frame: trim, pitch: 1.9, transom: 3.2, surround: 0.09 });
    K.awning(b, a - 0.15, e + 0.15, z, 4.05, 1.15, 0.45, [trim], 1, 0.18);
  }
  K.storefront(b, -1.25, 1.25, z, { y0: 0.15, y1: 3.45, frame: trim, doors: [0], doorW: 1.8, surround: 0.1 });
  for (const x of [-6.0, -1.55, 1.55, 6.0]) box(b, x - 0.2, 0, z, x + 0.2, 4.4, z + 0.22, wall, null);
  K.signBoard(b, rng, -4.8, 4.8, 4.35, 5.05, z + 0.05, K.plain(trim), 0xeed7a6, 0.13, { n: 7, words: 1, surf: Surf.Plain });
  for (const x of [-1.7, 1.7]) box(b, x - 0.12, 2.7, z + 0.25, x + 0.12, 3.1, z + 0.55, K.emis(0xffdeb0, 3));
  if (v % 2) K.facadeFlag(b, -5.7, 6.1, z + 0.2, trim, 1.7);
  else K.facadeFlag(b, 5.7, 6.1, z + 0.2, trim, 1.7);
}

function displayUpper(b: B, x: number, z: number, y0: number, y1: number, trim: number) {
  K.storefront(b, x - 0.8, x + 0.8, z, { y0, y1, frame: trim, pitch: 0.8, transom: y1 - 0.4, surround: 0.08 });
}

const boutiqueHip: ModelBuildFn = (b, v, rng) => {
  const k = v % 5, trim = TRIM[k], wall = P(STONE[k], Surf.Stone);
  const x0 = -6.4, x1 = 6.4, z0 = -6, z1 = 2.8, top = 7.6;
  boutiqueLot(b, rng, trim);
  box(b, x0, 0, z0, x1, top, z1, wall, null);
  K.bandRect(b, x0, z0, x1, z1, 0, 0.55, P(0xa59b8a, Surf.Stone), 0.08);
  K.cornice(b, x0, z0, x1, z1, top - 0.25, 0.25, 0.2, K.plain(0xeee5d2), null);
  b.paint(TILE[k], Surf.RoofTiles).hipRoof(0, -1.6, 12.8, 8.8, top, 2.3, 0.35);
  const cx = [-4.8, -2.4, 0, 2.4, 4.8][k];
  box(b, cx - 0.4, top + 0.6, -4.7, cx + 0.4, top + 2.8, -3.9, wall, K.plain(0xeee5d2));
  boutiqueFront(b, v, rng, z1, trim, wall);
  for (const x of [-4.3, 0, 4.3]) displayUpper(b, x, z1, 5.45, 6.95, trim);
  K.onSide(b, 'px', () => {
    for (const x of [-1.6, 2.8, 5.0]) displayUpper(b, x, x1, 5.4, 6.9, trim);
  });
};

const boutiqueGable: ModelBuildFn = (b, v, rng) => {
  const k = (v + 3) % 5, trim = TRIM[k], wall = P(STONE[k], Surf.Plain);
  const x0 = -6.4, x1 = 6.4, z0 = -6.2, z1 = 2.8, top = 7.8;
  boutiqueLot(b, rng, trim);
  box(b, x0, 0, z0, x1, top, z1, wall, null);
  K.bandRect(b, x0, z0, x1, z1, 0, 0.6, P(DARK[k], Surf.Stone), 0.08);
  b.paint(TILE[k], Surf.Metal).gableRoof(0, -1.7, 12.8, 9, top, 2.7, 'z', 0.3, wall);
  boutiqueFront(b, v, rng, z1, trim, wall);
  for (const x of [-4.4, 4.4]) displayUpper(b, x, z1, 5.45, 7.05, trim);
  K.storefront(b, -1.4, 1.4, z1, { y0: 5.45, y1: 8.5, frame: trim, pitch: 1.4, transom: 7.1, surround: 0.1 });
  K.discSign(b, 0, 9.25, z1 + 0.08, 0.5, P(0x9eb2b8, Surf.GlassPlain), K.metal(trim), 10, 0.1);
  for (const x of [-5.8, 5.8]) box(b, x - 0.18, 5.2, z1, x + 0.18, top + 0.25, z1 + 0.25, P(DARK[k], Surf.Stone), null);
  K.onSide(b, 'px', () => K.storefront(b, -1.8, 4.8, x1, { y0: 5.45, y1: 7.05, frame: trim, pitch: 1.65, surround: 0.08 }));
  box(b, -2.2, 5.3, z1, 2.2, 5.45, z1 + 0.7, wall, undefined, { bottom: wall });
  faceZ(b, -2.2, 2.2, 5.45, 6.2, z1 + 0.68, K.metal(trim));
};

const boutiqueTerrace: ModelBuildFn = (b, v, rng) => {
  const k = (v + 1) % 5, trim = TRIM[k], wall = P(DARK[k], Surf.Stone);
  const x0 = -6.6, x1 = 6.6, z0 = -6.2, z1 = 2.8, top = 8.4;
  boutiqueLot(b, rng, trim);
  box(b, x0, 0, z0, x1, top, z1, wall, K.roofP());
  K.cornice(b, x0, z0, x1, z1, top, 0.35, 0.18, K.metal(trim));
  boutiqueFront(b, v, rng, z1, trim, P(STONE[k], Surf.Stone));
  K.storefront(b, -5.5, 5.5, z1, { y0: 5.5, y1: 7.65, frame: trim, pitch: 2.2, surround: 0.1 });
  K.onSide(b, 'px', () => K.storefront(b, -1.5, 4.8, x1, { y0: 5.5, y1: 7.65, frame: trim, pitch: 2.1, surround: 0.08 }));
  const deck = top + 0.36;
  up(b, -6.2, -5.8, 6.2, 2.4, deck, P(0x947b5a, Surf.Wood));
  box(b, -5.6, deck, -5.4, 0.8, deck + 2.0, -1.8, P(0x74949c, Surf.GlassPlain), null);
  box(b, -5.9, deck + 2.0, -5.7, 1.1, deck + 2.3, -1.5, K.metal(trim), K.roofP(0xa7a18f), { bottom: K.plain(STONE[k]) });
  b.push().translate(0, deck, 0);
  for (const x of [-4.7, 0, 4.7]) K.planter(b, rng, x - 0.65, 1.2, x + 0.65, 2.2, 0.55, trim);
  K.umbrella(b, 3.7, -3.6, 1.35, STONE[k], 2.3, 0x4a4036);
  b.pop();
  // The open front railing leaves the shop's terrace visible from the street.
  b.paint(trim, Surf.Metal).beam([-6.2, deck + 0.85, 2.4], [6.2, deck + 0.85, 2.4], 0.07);
  for (let x = -6.2; x < 6.3; x += 3.1) box(b, x - 0.04, deck, 2.36, x + 0.04, deck + 0.85, 2.44, K.metal(trim), null);
};

export const boutiqueVarietyModels: ModelBuilders = {
  com_boutique_hip: boutiqueHip,
  com_boutique_gable: boutiqueGable,
  com_boutique_terrace: boutiqueTerrace,
};
