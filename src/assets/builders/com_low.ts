/**
 * Commercial low-density models: corner store, gas station, diner, strip mall, restaurant, boutique.
 */
import { ModelBuilder } from '../ModelBuilder';
import type { ModelBuildFn } from '../registry';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { bench } from '../kit';
import * as K from './com_kit';
import { P, C, box, up, down, faceZ, faceX } from './com_kit';

type B = ModelBuilder;

/** Lot interior pavement (warm grey so white buildings don't read as sugar cubes) + lighter front sidewalk. */
const LOT = 0xb3aea2, WALK = 0xc2bdb2;
function lotBase(b: B, X: number, Z: number, walk = 1.8) {
  up(b, -X, -Z, X, Z, 0.03, K.pav(LOT));
  if (walk > 0) up(b, -X, Z - walk, X, Z, 0.045, K.pav(WALK));
}
function grass(b: B, x0: number, z0: number, x1: number, z1: number) {
  up(b, x0, z0, x1, z1, 0.07, K.foliage(C.grass));
}
/** Small projecting "OPEN" blade sign (0.8 x 0.5 m neon red) on the +Z facade at x, from z outward. */
function openSign(b: B, rng: RNG, x: number, y: number, z: number) {
  box(b, x - 0.05, y, z, x + 0.05, y + 0.5, z + 0.8, K.metal(0x222222), undefined, { nz: null, px: K.emis(0xff3b30, 8), nx: K.emis(0xff3b30, 8) });
  b.push().rotateY(Math.PI / 2);
  K.letters(b, rng, -(z + 0.4), y + 0.12, x + 0.06, 0.66, 0.26, 0xffffff, { n: 4, words: 1, surf: Surf.Plain });
  b.pop();
}

// ============================================================================================ CORNER STORE (1x1)
function cornerBrick(b: B, rng: RNG) {
  lotBase(b, 8, 8);
  grass(b, -3.6, -8, 8, -6.75);
  const x0 = -7, x1 = 6, z0 = -6.5, z1 = 3, h = 4.7;
  box(b, x0, 0, z0, x1, h, z1, P(0x9c4a36, Surf.Brick), K.roofP());
  K.parapet(b, x0 - 0.12, z0 - 0.12, x1 + 0.12, z1 + 0.12, h, 0.55, 0.35, P(0xd9cfb8, Surf.Stone));
  const green = 0x264d3a;
  faceZ(b, -6.2, 5.2, 0, 0.5, z1 + 0.015, K.plain(green));
  K.storefront(b, -6.0, 5.0, z1, { y1: 3.0, frame: green, doors: [3.9], transom: 2.5 });
  K.signBoard(b, rng, -6.3, 5.3, 3.35, 4.4, z1, K.plain(green), 0xfff1c9);
  K.awning(b, -6.3, 5.3, z1, 3.3, 1.5, 0.7, [0x2f7d4a, 0xf2efe6], 0.85);
  K.onSide(b, 'px', () => {
    faceZ(b, -2.6, 4.2, 0, 0.5, x1 + 0.015, K.plain(green));
    K.storefront(b, -2.4, 4.0, x1, { y1: 3.0, frame: green, transom: 2.5 });
    K.awning(b, -2.6, 4.2, x1, 3.3, 1.3, 0.6, [0x2f7d4a, 0xf2efe6], 0.85);
  });
  // produce stand under the awning
  box(b, -5.8, 0, 3.25, -2.6, 0.75, 4.0, P(0x9a7a4e, Surf.Wood), null);
  up(b, -5.8, 3.25, -4.75, 4.0, 0.8, K.foliage(0xb8322a));
  up(b, -4.75, 3.25, -3.7, 4.0, 0.8, K.foliage(0xe98a2a));
  up(b, -3.7, 3.25, -2.6, 4.0, 0.8, K.foliage(0x7aa83a));
  // side yard props
  K.dumpster(b, -5.2, -7.3, 0x2f5d3a);
  box(b, 6.6, 0, -5, 7.4, 1.2, -3.6, K.metal(0xe8e8e8), undefined, { px: K.emis(0x3a8fe0) });
  K.ac(b, -3, h, -3, 1.1);
  K.ac(b, 1.5, h, -4.2, 0.9);
  box(b, -6.3, h, -5.8, -4.0, h + 2.2, -3.8, K.plain(0xb0aca3), K.roofP(0x77777a));
  openSign(b, rng, 5.65, 2.1, z1);
  K.tree(b, rng, -6.5, 6.8, 0.6);
}

function cornerConvenience(b: B, rng: RNG) {
  lotBase(b, 8, 8);
  grass(b, -8, -8, 8, -6.35);
  K.asphalt(b, -8, 0.2, 8, 6.5);
  const x0 = -7.3, x1 = 7.3, z0 = -6.2, z1 = -0.4, h = 4.4;
  const wall = K.plain(0xf0ede4);
  box(b, x0, 0, z0, x1, h, z1, wall, K.roofP());
  K.parapet(b, x0, z0, x1, z1, h, 0.4, 0.25, wall);
  // tri-color fascia (lit)
  const bands: [number, number, number][] = [[3.2, 3.55, 0xf28c28], [3.55, 3.9, 0x1f8a4c], [3.9, 4.25, 0xd8262e]];
  for (const [ya, yb, c] of bands) {
    faceZ(b, x0, x1, ya, yb, z1 + 0.02, K.emis(c, 7));
    faceX(b, z0 + 3, z1, ya, yb, x1 + 0.02, K.plain(c), 1);
  }
  K.storefront(b, -6.6, 6.6, z1, { y1: 2.9, y0: 0.35, frame: 0xdcdcdc, doors: [0], pitch: 1.65 });
  K.canopy(b, x0, x1, z1, 2.95, 1.0, 0.18, K.plain(0xf5f3ee));
  // parking row in front (cars nose to store)
  K.stallsX(b, rng, -7.4, 7.4, 0.7, -1, 0.55);
  // curb stops
  box(b, -7.6, 0.06, 0.25, 7.6, 0.2, 0.55, K.plain(C.concrete));
  // pylon
  K.pylon(b, 6.9, 7.2, 5.2, 1.7, [{ h: 1.3, color: 0xf28c28 }, { h: 0.9, color: 0xf6f2e8, k: 5 }], { poles: 1 });
  K.pylonLetters(b, rng, 6.9, 7.2, 4.22, 0.66, 1.45, 0x1a1a1a, { both: true, n: 4 });
  K.pylonLetters(b, rng, 6.9, 7.2, 3.1, 0.44, 1.4, 0xd8262e, { both: true, n: 5 });
  K.roofEdge(b, x0, z0, x1, z1, h + 0.4, 0x2fd07a);
  K.tree(b, rng, -6.9, 7.2, 0.55);
  // ice box + propane cage on the side
  box(b, -8, 0, -3.5, -7.4, 1.2, -1.2, K.metal(0xeeeeee), undefined, { nx: K.emis(0x4aa3ff) });
  box(b, -8, 0, -5.8, -7.4, 1.6, -4.0, K.metal(0x8a9096));
  K.ac(b, -4, h, -4.0, 1.1);
  K.ac(b, 0, h, -4.6, 1.0);
  K.ac(b, 4, h, -3.2, 0.9);
}

function cornerWestern(b: B, rng: RNG) {
  up(b, -8, -8, 8, 8, 0.03, K.pav(0xb09f82));
  up(b, -8, 5.4, 8, 8, 0.05, K.pav(WALK));
  grass(b, -8, -8, 8, -6.9);
  const wood = P(0xa3473a, Surf.Wood);
  const trim = K.plain(0xefe6d2);
  const x0 = -5.5, x1 = 5.5, z0 = -6.5, z1 = 2.2, h = 3.8;
  box(b, x0, 0, z0, x1, h, z1, wood, null);
  b.paint(0x6c6f72, Surf.RoofTiles).gableRoof(0, (z0 + z1) / 2, x1 - x0, z1 - z0, h, 1.8, 'z', 0.35, wood);
  // false front with stepped top
  box(b, x0 - 0.3, 0, z1, x1 + 0.3, 6.0, z1 + 0.35, P(0xe8dcc0, Surf.Wood), trim);
  box(b, -2.6, 6.0, z1, 2.6, 6.7, z1 + 0.35, P(0xe8dcc0, Surf.Wood), trim);
  box(b, x0 - 0.45, 5.9, z1 - 0.05, x1 + 0.45, 6.1, z1 + 0.5, trim);
  // painted sign + gooseneck lamps
  box(b, -4.6, 4.1, z1 + 0.35, 4.6, 5.5, z1 + 0.45, K.plain(0x7a2a22));
  K.letters(b, rng, 0, 4.45, z1 + 0.47, 8, 0.7, 0xf2e6c8, { surf: Surf.Plain, words: 2, n: 9 });
  for (const lx of [-3, 0, 3]) {
    box(b, lx - 0.04, 5.55, z1 + 0.35, lx + 0.04, 5.65, z1 + 0.9, K.metal(0x333333));
    box(b, lx - 0.2, 5.4, z1 + 0.75, lx + 0.2, 5.6, z1 + 1.05, K.emis(0xffe2a8));
  }
  // porch deck + roof + posts
  box(b, x0 - 0.3, 0, z1 + 0.35, x1 + 0.3, 0.35, 5.2, P(0x8b6a47, Surf.Wood));
  box(b, x0 - 0.3, 3.3, z1 + 0.35, x1 + 0.3, 3.45, 5.3, P(0x7b7f82, Surf.Metal), undefined, { bottom: P(0x8b6a47, Surf.Wood) });
  for (const px of [-5.6, -1.9, 1.9, 5.6]) box(b, px - 0.12, 0.35, 4.9, px + 0.12, 3.3, 5.14, trim, null);
  // windows & door
  K.storefront(b, -4.6, -1.3, z1 + 0.35, { y0: 0.9, y1: 2.9, frame: 0xefe6d2, pitch: 0.9, surround: 0.15 });
  K.storefront(b, 1.3, 4.6, z1 + 0.35, { y0: 0.9, y1: 2.9, frame: 0xefe6d2, pitch: 0.9, surround: 0.15 });
  K.storefront(b, -0.7, 0.7, z1 + 0.35, { y0: 0.35, y1: 2.6, frame: 0xefe6d2, pitch: 2, surround: 0.15 });
  // barrels, bench, soda machine
  for (const [bx, bz] of [[-4.9, 4.4], [-4.1, 4.6], [4.8, 4.5]] as [number, number][]) b.paint(0x7a5634, Surf.Wood).cylinder(bx, bz, 0.35, 1.0, 0.36, 0.36, 7, { topPaint: P(0x5b4330, Surf.Wood) });
  box(b, 2.4, 0.35, 3.9, 4.0, 0.8, 4.3, P(0x6b4a2e, Surf.Wood));
  box(b, 6.0, 0, 0.2, 6.9, 1.9, 1.0, K.plain(0xc8202a), undefined, { pz: K.emis(0xff4a3a) });
  K.tree(b, rng, -6.6, -4.5, 0.7);
  K.tree(b, rng, 6.6, -4.0, 0.72);
  K.tree(b, rng, 6.6, 6.9, 0.58);
}

function cornerDeli(b: B, rng: RNG) {
  lotBase(b, 8, 8);
  grass(b, -8, -8, 8, -6.85);
  const pts: K.V2[] = [[-7, -6.5], [6.5, -6.5], [6.5, 1.0], [3.5, 4.0], [-7, 4.0]];
  const h = 5.3;
  K.prismPts(b, pts, 0, h, P(0xc9a86a, Surf.Brick), null);
  const grown: K.V2[] = [[-7.15, -6.65], [6.65, -6.65], [6.65, 1.06], [3.56, 4.15], [-7.15, 4.15]];
  K.loft(b, grown, grown, h, h + 0.55, P(0xe0d6c2, Surf.Stone), K.roofP());
  K.loft(b, grown, grown, 3.25, 3.45, P(0xe0d6c2, Surf.Stone), null);
  const red = 0xb8262b, frame = 0x2a2a2e;
  // front
  K.storefront(b, -6.3, 2.6, 4.0, { y1: 3.0, frame, transom: 2.4, pitch: 1.5 });
  K.awning(b, -6.4, 2.8, 4.0, 3.2, 1.3, 0.6, [red], 1, 0.35);
  // transom band windows above awning
  K.storefront(b, -6.3, 2.6, 4.0, { y0: 3.75, y1: 4.7, frame, pitch: 1.1, surround: 0.08 });
  // chamfer: door + sign
  b.push().rotateY(Math.PI / 4);
  K.storefront(b, 0.3, 3.2, 5.3, { y1: 2.9, frame, doors: [1.75], doorW: 1.6, pitch: 3 });
  K.signBoard(b, rng, 0.1, 3.4, 3.7, 4.9, 5.3, K.plain(0x1f2a44), 0xffd35a, 0.2, { n: 4, words: 1 });
  b.pop();
  // right side
  K.onSide(b, 'px', () => {
    K.storefront(b, -0.6, 5.8, 6.5, { y1: 3.0, frame, transom: 2.4, pitch: 1.6 });
    K.awning(b, -0.7, 5.9, 6.5, 3.2, 1.2, 0.55, [red], 1, 0.35);
  });
  K.bladeSign(b, -6.6, 4.0, 3.6, 1.4, 0.9, 0xff4a3a);
  // cafe table + hydrant
  K.umbrella(b, -4.5, 6.3, 1.1, 0xf2efe6, 2.3);
  b.paint(0xc8202a, Surf.Metal).cylinder(7.3, 5.3, 0, 0.7, 0.16, 0.14, 6);
  K.roofJunk(b, rng, -6, -5.5, 5, 2.5, h + 0.55, 2, false);
  K.bandPts(b, grown, h + 0.35, h + 0.55, K.emis(0xff3b30, 6), 0.03);
  openSign(b, rng, 3.15, 2.1, 4.0);
  K.tree(b, rng, -6.6, 7.0, 0.58);
}

function cornerModern(b: B, rng: RNG) {
  lotBase(b, 8, 8);
  grass(b, -8, -8, 8, -6.7);
  const x0 = -6.5, x1 = 6.5, z0 = -6.5, z1 = 1.5, h = 4.6;
  const dark = K.plain(0x5a5f66);
  box(b, x0, 0, z0, x1, h, z1, dark, K.foliage(0x7c9a4e));
  K.parapet(b, x0, z0, x1, z1, h, 0.35, 0.2, dark);
  // wood-clad right bay
  box(b, 3.8, 0, z1, 6.5, h, z1 + 0.25, P(0xb57c48, Surf.Wood));
  K.storefront(b, -5.8, 3.4, z1, { y0: 0.15, y1: 3.9, frame: 0x222326, doors: [-1.6], pitch: 1.55, surround: 0.08 });
  // thin cantilever canopy with LED edge and roof letters
  K.canopy(b, -7.2, 7.2, z1 + 0.25, 4.05, 2.6, 0.28, K.plain(0xf3f1ec), K.emis(0xfff3dc, 3));
  K.letters(b, rng, -1.5, 4.36, z1 + 2.4, 7.5, 1.2, 0x2fd6ff, { mixed: true, k: 7 });
  K.roofEdge(b, x0, z0, x1, z1, h + 0.35, 0xff8a2a);
  // planters, bench, bike rack
  K.planter(b, rng, -7.4, 4.8, -4.8, 6.0, 0.55, 0x9a958c, true);
  K.planter(b, rng, 4.8, 4.8, 7.4, 6.0, 0.55, 0x9a958c, true);
  box(b, -2.5, 0.4, 5.3, 1.0, 0.5, 5.8, P(0xa87a50, Surf.Wood), undefined, { bottom: P(0xa87a50, Surf.Wood) });
  for (const rx of [1.8, 2.6, 3.4]) b.paint(0x777b80, Surf.Metal).beam([rx, 0, 5.2], [rx, 0.8, 5.2], 0.06).beam([rx, 0.8, 5.2], [rx, 0.8, 6.2], 0.06).beam([rx, 0.8, 6.2], [rx, 0, 6.2], 0.06);
  K.ac(b, -3, h, -4, 0.9);
  K.ac(b, 2.5, h, -4.5, 0.9);
  K.shrub(b, rng, -7.0, -7.0, 0.8);
  K.shrub(b, rng, 7.0, -3.0, 0.9);
}

function cornerPharmacy(b: B, rng: RNG) {
  lotBase(b, 8, 8);
  grass(b, -8, 4.9, -3.2, 6.2);
  K.asphalt(b, 1.8, -7.8, 8, 6.6);
  const x0 = -7.5, x1 = 1.2, z0 = -7.3, z1 = 3.0, h = 4.8;
  const wall = K.plain(0xd9c6a2);
  box(b, x0, 0, z0, x1, h, z1, wall, K.roofP());
  K.parapet(b, x0, z0, x1, z1, h, 0.5, 0.25, K.plain(0xc4b08c));
  K.storefront(b, -6.9, 0.6, z1, { y1: 2.9, frame: 0xdedede, doors: [-1.3], pitch: 1.8 });
  K.signBoard(b, rng, -7.4, 1.1, 3.15, 4.45, z1, K.plain(0x1d4f91), 0xffffff, 0.3, { words: 1 });
  K.canopy(b, -7.4, 1.1, z1, 2.95, 0.8, 0.15, K.plain(0x1d4f91));
  // green cross blade (lit)
  const g = K.emis(0x2fe05a, 7);
  K.roofEdge(b, x0, z0, x1, z1, h + 0.5, 0x3a8dff);
  box(b, 1.95, 3.4, 1.55, 2.25, 5.6, 2.25, g);
  box(b, 1.95, 4.15, 0.8, 2.25, 4.85, 3.0, g);
  box(b, 1.2, 4.45, 1.8, 1.95, 4.6, 2.0, K.metal(0x333333));
  // side parking
  K.stallsZ(b, rng, -7.2, 1.4, 2.4, -1, 0.65);
  box(b, 1.5, 0, -7.6, 1.8, 0.18, 3.0, K.plain(C.concrete));
  // side facade window strip
  K.onSide(b, 'px', () => K.storefront(b, -2.7, 4.0, x1, { y1: 2.6, y0: 0.9, frame: 0xdedede, pitch: 1.7 }));
  for (const bx of [2.3, 7.4]) box(b, bx - 0.12, 0, 7.0, bx + 0.12, 0.9, 7.24, K.metal(0xe0c040));
  K.ac(b, -4.5, h, -4.5, 1.1);
  K.ac(b, -1.5, h, -3.0, 0.9);
  K.tree(b, rng, -6.5, 6.1, 0.85);
}


// ============================================================================================ GAS STATION (2x2)
interface GasBrand { main: number; stripe: number; store: ReturnType<typeof P>; trim: number; logo: number }
const GAS_BRANDS: GasBrand[] = [
  { main: 0xc8102e, stripe: 0xffffff, store: P(0xe4d9c3, Surf.Brick), trim: 0xc8102e, logo: 0xff3322 },
  { main: 0x117a44, stripe: 0xf5c518, store: P(0xe9e2cf, Surf.Plain), trim: 0x117a44, logo: 0x3bdc6a },
  { main: 0x1d4f9c, stripe: 0x39d3ff, store: P(0xd7dadd, Surf.Plain), trim: 0x2a2d33, logo: 0x2fb8ff },
];
/** Canopy over pump islands: box with lit underside, stripe band, 1 m brand roof stripe, lit pad beneath. */
function gasCanopy(b: B, br: GasBrand, cx0: number, cz0: number, cx1: number, cz1: number, cy: number, ct: number, white: boolean) {
  up(b, cx0 + 0.2, cz0 + 0.2, cx1 - 0.2, cz1 - 0.2, 0.05, P(0x86827a, Surf.Emissive, 9));
  box(b, cx0, cy, cz0, cx1, cy + ct, cz1, K.plain(br.main), K.roofP(0xe6e6e6), { bottom: K.emis(0xd6d3cc, K.CANOPY_K) });
  K.bandRect(b, cx0, cz0, cx1, cz1, cy + ct * 0.35, cy + ct * 0.62, K.emis(br.stripe, 8), 0.04);
  if (white) K.bandRect(b, cx0, cz0, cx1, cz1, cy + ct - 0.12, cy + ct, K.plain(0xf2f2f2), 0.05);
  const yr = cy + ct + 0.01, sw = 1.0, rp = K.plain(br.main);
  up(b, cx0, cz1 - sw, cx1, cz1, yr, rp);
  up(b, cx0, cz0, cx1, cz0 + sw, yr, rp);
  up(b, cx0, cz0 + sw, cx0 + sw, cz1 - sw, yr, rp);
  up(b, cx1 - sw, cz0 + sw, cx1, cz1 - sw, yr, rp);
}
/** Pump: white base + brand head with lit displays on the two faces toward the lanes (axis 'x' = lanes on +-X). */
function pump(b: B, br: GasBrand, x: number, z: number, axis: 'x' | 'z') {
  const [hx, hz] = axis === 'x' ? [0.32, 0.5] : [0.5, 0.32];
  box(b, x - hx, 0.22, z - hz, x + hx, 1.45, z + hz, K.plain(0xf2f2f2));
  const disp = K.emis(0xbfe6ff, 5);
  box(b, x - hx - 0.02, 1.45, z - hz - 0.02, x + hx + 0.02, 2.05, z + hz + 0.02, K.plain(br.main), undefined, axis === 'x' ? { px: disp, nx: disp } : { pz: disp, nz: disp });
}
function gasStation(b: B, v: number, rng: RNG) {
  const br = GAS_BRANDS[v % 3];
  up(b, -16, -16, 16, 16, 0.03, K.pav(0xbcb8ae));
  // grass strips + trees
  up(b, -16, -16, -13.4, 16, 0.07, K.foliage(C.grass));
  up(b, -13.4, 14.2, -7.5, 16, 0.07, K.foliage(C.grass));
  up(b, 9.5, 14.2, 16, 16, 0.07, K.foliage(C.grass));
  for (const tz of [-12.5, -3, 6.5]) K.tree(b, rng, -14.7, tz, 0.72);
  K.tree(b, rng, 12.8, 15.0, 0.55);
  K.shrub(b, rng, 10.4, 15.1, 0.7);
  const cy = 4.9;
  if (v !== 2) {
    // canopy with two islands running toward the street
    const cx0 = -9.6, cx1 = 9.6, cz0 = -0.8, cz1 = 9.8, ct = 1.0;
    gasCanopy(b, br, cx0, cz0, cx1, cz1, cy, ct, false);
    faceZ(b, -2.2, 2.2, cy + 0.12, cy + ct - 0.1, cz1 + 0.09, K.emis(br.logo, 8));
    for (const ix of [-4.5, 4.5]) {
      box(b, ix - 0.65, 0, 0.3, ix + 0.65, 0.22, 8.7, K.plain(0xd8d4ca));
      up(b, ix - 0.66, 0.2, ix + 0.66, 0.6, 0.23, K.plain(0xe8c547));
      up(b, ix - 0.66, 8.4, ix + 0.66, 8.8, 0.23, K.plain(0xe8c547));
      for (const cz of [1.0, 8.0]) box(b, ix - 0.25, 0.22, cz - 0.25, ix + 0.25, cy, cz + 0.25, K.plain(br.main), null);
      for (const pz of [3.0, 6.0]) pump(b, br, ix, pz, 'x');
    }
    K.car(b, -7.4, 4.3, 0.02, rng.pick(K.CAR_COLORS), 0.06, false, rng.chance(0.4));
    K.car(b, 1.6, 3.9, Math.PI, rng.pick(K.CAR_COLORS), 0.06, true, rng.chance(0.4));
    if (rng.chance(0.6)) K.car(b, 7.5, 5.0, -0.03, rng.pick(K.CAR_COLORS), 0.06, false, rng.chance(0.4));
  } else {
    // canopy turned 90 degrees: three islands running along the street, cars queue side-on
    const cx0 = -8.8, cx1 = 5.2, cz0 = -2.4, cz1 = 13.2, ct = 1.3;
    gasCanopy(b, br, cx0, cz0, cx1, cz1, cy, ct, true);
    faceZ(b, -3.9, 0.3, cy + 0.15, cy + ct - 0.12, cz1 + 0.09, K.emis(br.logo, 8));
    faceX(b, 3.0, 8.0, cy + 0.15, cy + ct - 0.12, cx1 + 0.09, K.emis(br.logo, 8), 1);
    for (const iz of [0.9, 5.4, 9.9]) {
      box(b, -6.4, 0, iz - 0.65, 2.8, 0.22, iz + 0.65, K.plain(0xd8d4ca));
      up(b, -6.4, iz - 0.66, -6.0, iz + 0.66, 0.23, K.plain(0xe8c547));
      up(b, 2.4, iz - 0.66, 2.8, iz + 0.66, 0.23, K.plain(0xe8c547));
      for (const cx of [-5.6, 2.0]) box(b, cx - 0.25, 0.22, iz - 0.25, cx + 0.25, cy, iz + 0.25, K.plain(0xe8e8e8), null);
      for (const px of [-3.3, -0.3]) pump(b, br, px, iz, 'z');
    }
    for (const [lz, fill] of [[3.15, 0.8], [7.65, 0.6], [12.1, 0.45]] as [number, number][]) {
      if (rng.chance(fill)) K.car(b, rng.range(-3.6, -1.2), lz, rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2, rng.pick(K.CAR_COLORS), 0.06, rng.chance(0.25), rng.chance(0.4));
    }
  }
  // convenience store
  const sx0 = -12.8, sx1 = 3.5, sz0 = -15.2, sz1 = -7.6, sh = 4.4;
  box(b, sx0, 0, sz0, sx1, sh, sz1, br.store, K.roofP());
  K.parapet(b, sx0, sz0, sx1, sz1, sh, 0.45, 0.25, K.plain(br.trim));
  K.roofEdge(b, sx0, sz0, sx1, sz1, sh + 0.45, br.logo);
  K.storefront(b, -11.8, 0.6, sz1, { y1: 2.9, frame: v === 2 ? 0x2a2d33 : 0xdedede, doors: [-5.6], pitch: 1.8 });
  K.signBoard(b, rng, sx0 + 0.3, sx1 - 0.3, 3.1, 4.25, sz1, K.plain(br.main), br.stripe === 0xffffff ? 0xffffff : br.stripe, 0.2, { words: 2 });
  K.canopy(b, sx0, sx1, sz1, 2.95, 1.3, 0.15, K.plain(br.main));
  box(b, 1.2, 0, -7.4, 3.2, 1.2, -6.6, K.metal(0xefefef), undefined, { pz: K.emis(0x4aa3ff) });
  box(b, -12.6, 0, -7.4, -11.0, 1.6, -6.6, K.metal(0x8a9096));
  K.stallsX(b, rng, -12.6, -4.4, -6.3, -1, 0.6);
  K.ac(b, -9, sh, -12.5, 1.1);
  K.ac(b, -3, sh, -11, 1.0);
  // dumpster enclosure
  box(b, 5.0, 0, -15.6, 5.25, 1.8, -12.8, P(0xb5a58a, Surf.Brick));
  box(b, 5.0, 0, -15.6, 8.6, 1.8, -15.35, P(0xb5a58a, Surf.Brick));
  K.dumpster(b, 6.8, -14.4, 0x2f5d3a);
  // price pylon (logo panel with letters + three price rows)
  const px = -11.2, pz = 13.6, ph = 7.6;
  K.pylon(b, px, pz, ph, 2.5, [{ h: 1.7, color: br.logo, k: 8 }, { h: 0.6, color: 0x1a1a1a, surf: Surf.Plain }, { h: 0.6, color: 0x1a1a1a, surf: Surf.Plain }, { h: 0.6, color: 0x1a1a1a, surf: Surf.Plain }], { poles: 2, pole: 0x6a6e73, frame: 0x333333, cap: br.main });
  K.pylonLetters(b, rng, px, pz, ph - 1.3, 0.9, 2.2, 0xffffff, { n: 4 });
  let yy = ph - 1.7 - 0.12;
  for (let r = 0; r < 3; r++) {
    faceZ(b, px - 1.05, px - 0.2, yy - 0.45, yy - 0.15, pz + 0.27, K.plain(0xeeeeee));
    for (let d = 0; d < 3; d++) faceZ(b, px + d * 0.33 - 0.05, px + d * 0.33 + 0.2, yy - 0.5, yy - 0.1, pz + 0.27, K.emis(r === 0 ? 0xff6a2a : 0xffc233, 8));
    yy -= 0.72;
  }
  if (v === 2) {
    // automatic car wash
    const wx0 = 7.0, wx1 = 15.0, wz0 = -15.2, wz1 = -2.2;
    box(b, wx0, 0, wz0, wx1, 5.0, wz1, K.plain(0xeceeef), K.roofP());
    K.bandRect(b, wx0, wz0, wx1, wz1, 4.0, 4.6, K.plain(br.main), 0.03);
    K.roofEdge(b, wx0, wz0, wx1, wz1, 5.0, br.stripe, 0.3);
    faceZ(b, 8.6, 13.4, 0, 3.8, wz1 + 0.03, K.plain(0x20252b));
    faceZ(b, 8.8, 13.2, 0.1, 3.6, wz1 + 0.05, P(0x2a3440, Surf.GlassPlain));
    K.letters(b, rng, 11, 4.08, wz1 + 0.07, 4.2, 0.46, br.stripe, { n: 4, words: 1 });
    K.onSide(b, 'px', () => K.storefront(b, 3.5, 13.5, wx1, { y0: 2.4, y1: 3.6, frame: 0x2a2d33, pitch: 2.0, surround: 0.06 }));
    for (const s2 of [-1, 1]) box(b, 11 + s2 * 1.7 - 0.25, 0, -1.8, 11 + s2 * 1.7 + 0.25, 1.1, -1.3, K.plain(br.main));
  } else {
    // vacuum / air islands
    K.stallsZ(b, rng, -9, -1.5, 10.6, 1, 0.5);
    for (const vz of [-6.3, -3.6]) {
      box(b, 10.2, 0, vz - 0.15, 10.5, 2.4, vz + 0.15, K.metal(br.main), null);
      box(b, 10.2, 2.4, vz - 0.2, 11.6, 2.6, vz + 0.2, K.metal(0xdadada));
    }
    box(b, 13.5, 0, -12.8, 14.3, 1.4, -12.2, K.plain(br.main), undefined, { pz: K.emis(br.stripe === 0xffffff ? 0xff3b30 : br.stripe, 6) });
  }
}

// ============================================================================================ DINER (1x1)
function stadiumPts(cx: number, cz: number, len: number, wid: number, segs = 4): K.V2[] {
  const r = wid / 2, hl = len / 2 - r;
  const pts: K.V2[] = [];
  for (let i = 0; i <= segs; i++) { const a = -Math.PI / 2 + (i * Math.PI) / segs; pts.push([cx + hl + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  for (let i = 0; i <= segs; i++) { const a = Math.PI / 2 + (i * Math.PI) / segs; pts.push([cx - hl + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return pts;
}
function dinerChrome(b: B, rng: RNG) {
  lotBase(b, 8, 8, 1.1);
  grass(b, 6.7, -8, 8, 0.3);
  K.asphalt(b, -8, 0.4, 8, 6.9);
  const cz = -3.3;
  const pts = stadiumPts(0, cz, 13, 5.4, 3);
  const steel = P(0xd9dde2, Surf.Metal);
  K.prismPts(b, pts, 0, 0.7, K.plain(0x2a2a2e), null);
  K.prismPts(b, pts, 0.7, 1.2, steel, null);
  K.prismPts(b, pts, 1.2, 2.4, P(0x2a3440, Surf.GlassPlain), null);
  K.prismPts(b, pts, 2.4, 2.75, K.plain(0xc8202a), null);
  K.prismPts(b, pts, 2.75, 3.25, steel, null);
  K.loft(b, pts, K.scalePts(pts, 0.93, 0.62, 0, cz), 3.25, 3.85, P(0xc9ced4, Surf.Metal), P(0xb9bec4, Surf.Metal));
  // window mullions on the straight front
  for (let i = -3; i <= 3; i++) faceZ(b, i * 1.1 - 0.05, i * 1.1 + 0.05, 1.2, 2.4, cz + 2.72, K.metal(0xd9dde2));
  // vestibule
  box(b, -1.3, 0, -0.9, 1.3, 3.0, 0.9, steel, P(0xb9bec4, Surf.Metal));
  K.storefront(b, -0.9, 0.9, 0.9, { y0: 0.05, y1: 2.5, frame: 0xc8202a, doors: [0], doorW: 1.4, surround: 0.1 });
  // rooftop neon sign
  for (const lx of [-2.6, 2.6]) box(b, lx - 0.08, 3.7, cz - 0.1, lx + 0.08, 4.4, cz + 0.1, K.metal(0x444444), null);
  box(b, -3.4, 4.35, cz - 0.15, 3.4, 5.55, cz + 0.15, K.plain(0x1a1a1a));
  K.letters(b, rng, 0, 4.55, cz + 0.17, 6.2, 0.82, 0xff3b30, { n: 5, words: 1 });
  faceZ(b, -3.3, 3.3, 4.4, 4.46, cz + 0.17, K.emis(0x2fd6ff, 7));
  faceZ(b, -3.3, 3.3, 5.44, 5.5, cz + 0.17, K.emis(0x2fd6ff, 7));
  // kitchen annex at back
  box(b, -5.2, 0, -7.7, -0.8, 3.1, -5.6, K.plain(0xeeeae2), K.roofP());
  b.paint(0x9aa0a6, Surf.Metal).cylinder(-2.0, -6.6, 3.1, 1.6, 0.3, 0.3, 6);
  K.dumpster(b, 3.0, -7.0, 0x3a5d8a);
  // parking + pole sign
  K.stallsX(b, rng, -7.6, 7.6, 1.3, -1, 0.5);
  K.pylon(b, 6.9, 7.4, 7.0, 1.9, [{ h: 1.6, color: 0xff3b30 }, { h: 0.7, color: 0xffd23f }], { poles: 1, frame: 0xd9dde2, cap: 0x2fd6ff });
  K.tree(b, rng, -7.0, 7.3, 0.55);
}
function dinerBurger(b: B, rng: RNG) {
  up(b, -8, -8, 8, 8, 0.03, K.pav(C.asphalt));
  up(b, -5.0, 4.6, -1.2, 8, 0.06, K.foliage(C.grass));
  up(b, -1.0, 1.2, 0.8, 8, 0.07, K.pav(C.sidewalk));
  up(b, 1.6, 7.0, 8, 8, 0.07, K.pav(C.sidewalk));
  const x0 = -5.0, x1 = 1.6, z0 = -6.2, z1 = 1.0, wh = 3.1;
  box(b, x0, 0, z0, x1, wh, z1, P(0x9b4b35, Surf.Brick), null);
  K.storefront(b, -4.4, 1.0, z1, { y0: 0.7, y1: 2.8, frame: 0x3a3a3a, doors: [-0.1], pitch: 1.6 });
  K.onSide(b, 'px', () => K.storefront(b, -0.4, 5.4, x1, { y0: 0.7, y1: 2.8, frame: 0x3a3a3a, pitch: 1.6 }));
  K.bandRect(b, x0, z0, x1, z1, wh - 0.3, wh, K.emis(0xffc933, 7), 0.05);
  K.loft(b, K.rectPts(x0 - 0.45, z0 - 0.45, x1 + 0.45, z1 + 0.45), K.rectPts(x0 + 0.7, z0 + 0.7, x1 - 0.7, z1 - 0.7), wh, wh + 1.5, P(0xb3322a, Surf.RoofTiles), K.roofP());
  box(b, -2.8, wh + 1.5, -4.2, -0.8, wh + 2.3, -2.7, K.metal(0xa9adb1));
  // drive-thru: pick-up window on the -X side, painted lane line + arrows, menu board
  K.onSide(b, 'nx', () => K.storefront(b, -4.2, -2.6, -x0, { y0: 0.9, y1: 2.3, frame: 0xffc933, pitch: 2, surround: 0.1 }));
  const lane = K.plain(0xe0bb3a), arrow = K.plain(0xf2f0ea);
  up(b, -7.68, -7.6, -7.52, 4.4, 0.08, lane);
  up(b, -7.68, -7.68, 1.6, -7.52, 0.08, lane);
  for (const az of [2.2, -2.4]) {
    up(b, -6.5, az, -6.1, az + 1.3, 0.085, arrow);
    b.paint(arrow).tri([-6.9, 0.085, az], [-5.7, 0.085, az], [-6.3, 0.085, az - 0.9]);
  }
  box(b, -7.7, 0, -7.2, -7.5, 2.0, -5.4, K.metal(0x333333), undefined, { px: K.emis(0xffd23f, 6) });
  // pylon: lit panels with letters on both faces + logo disc on top
  const px = 6.6, pz = 6.6;
  K.pylon(b, px, pz, 7.1, 2.5, [{ h: 1.7, color: 0xffc933 }, { h: 0.8, color: 0xd8262e }], { poles: 1, pole: 0xd8262e, frame: 0xd8262e });
  K.pylonLetters(b, rng, px, pz, 5.72, 1.05, 2.2, 0x1a1a1a, { both: true, n: 5 });
  K.pylonLetters(b, rng, px, pz, 4.64, 0.48, 2.1, 0xfff4e0, { both: true, n: 6 });
  box(b, px - 0.1, 7.1, pz - 0.1, px + 0.1, 7.35, pz + 0.1, K.metal(0xd8262e), null);
  K.discSign(b, px, 8.15, pz - 0.12, 0.8, K.emis(0xffc933, 8), K.metal(0xd8262e), 12, 0.24);
  // parking along side
  K.stallsZ(b, rng, -7.4, 3.6, 2.5, -1, 0.65);
  // patio
  K.umbrella(b, -3.1, 6.2, 1.1, 0xd8262e, 2.3);
  K.tree(b, rng, -6.5, 7.0, 0.5);
}
function dinerGoogie(b: B, rng: RNG) {
  lotBase(b, 8, 8, 1.0);
  grass(b, 5.4, -8, 8, 1.8);
  K.asphalt(b, -8, 2.2, 8, 7.0);
  const x0 = -6.6, x1 = 4.4, z0 = -6.2, z1 = 0.6;
  const rz0 = z0 - 0.6, rz1 = 3.0, ry0 = 3.3, ry1 = 6.3;
  const ry = (z: number) => ry0 + ((z - rz0) * (ry1 - ry0)) / (rz1 - rz0);
  const yF = ry(z1) - 0.3, yB = ry(z0) - 0.3;
  const stone = P(0xbfa98a, Surf.Stone);
  faceZ(b, x0, x1, 0, yF, z1, K.plain(0xf1ebdc));
  faceZ(b, x0, x1, 0, yB, z0, K.plain(0xf1ebdc), -1);
  b.paint(stone).quad([x1, 0, z1], [x1, 0, z0], [x1, yB, z0], [x1, yF, z1]);
  b.paint(stone).quad([x0, 0, z0], [x0, 0, z1], [x0, yF, z1], [x0, yB, z0]);
  K.storefront(b, x0 + 0.5, x1 - 0.5, z1, { y0: 0.35, y1: yF - 0.35, frame: 0xf1ebdc, doors: [-1.1], pitch: 1.4, transom: 2.6 });
  // boomerang roof slab flaring toward the front
  const T: K.V3[] = [[x0 - 0.6, ry(rz0), rz0], [x1 + 0.6, ry(rz0), rz0], [x1 + 1.4, ry(rz1), rz1], [x0 - 1.1, ry(rz1), rz1]];
  const t = 0.32;
  const Bt: K.V3[] = T.map(([x, y, z]) => [x, y - t, z] as K.V3);
  b.paint(0xf4f1e8, Surf.Plain).quad(T[3], T[2], T[1], T[0]);
  b.paint(0xe7dfcb, Surf.Plain).quad(Bt[0], Bt[1], Bt[2], Bt[3]);
  b.paint(0x2fb0a8, Surf.Plain);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; b.quad(Bt[j], Bt[i], T[i], T[j]); }
  // googie pylon with starburst
  const gx = 6.2, gz = 5.6;
  b.paint(0x2fb0a8, Surf.Plain).beam([gx - 0.9, 0, gz], [gx, 5.6, gz], 0.35).beam([gx + 0.9, 0, gz], [gx, 5.6, gz], 0.35);
  box(b, gx - 1.1, 2.3, gz - 0.2, gx + 1.1, 3.7, gz + 0.2, K.metal(0xf1ebdc), undefined, { pz: K.emis(0xff8a2a, 7), nz: K.emis(0xff8a2a, 7) });
  b.paint(0xffd23f, Surf.Emissive, 8).blob(gx, 5.9, gz, 0.35, 0.35, 0.35, 0, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    b.paint(0xffe27a, Surf.Emissive, 7).beam([gx, 5.9, gz], [gx + Math.cos(a) * 1.0, 5.9 + Math.sin(a) * 0.8, gz + (i % 2 ? 0.4 : -0.4)], 0.09);
  }
  // parking, planters with palms
  K.stallsX(b, rng, -7.6, 3.2, 2.4, -1, 0.55);
  box(b, -7.6, 0, 0.9, -5.2, 0.55, 2.1, stone, K.foliage(0x5b8a3c));
  K.palm(b, rng, -6.4, 1.5, 0.66);
  K.palm(b, rng, 6.2, -5.4, 0.66);
  K.ac(b, -3, yB + 0.1, -5.0, 0.8);
  K.tree(b, rng, -7.0, 7.35, 0.5);
}
const diner: ModelBuildFn = (b, v, rng) => [dinerChrome, dinerBurger, dinerGoogie][v % 3](b, rng);

// ============================================================================================ STRIP MALL (3x2)
function stripMall(b: B, v: number, rng: RNG) {
  up(b, -24, -16, 24, 16, 0.03, K.pav(C.sidewalk));
  const L = v === 3;
  const bz0 = -15.5, bz1 = -5.6, h = 5.2;
  const bx0 = L ? -9.8 : -22.5, bx1 = 22.5;
  const walls = [K.plain(0xe3d3b5), K.plain(0xdcdcd8), P(0x9a5a44, Surf.Brick), K.plain(0xe7e0d0)][v];
  const trim = [0xc98a5a, 0x3a3e44, 0xf0ece2, 0x2e5f8a][v];
  // parking
  const px0 = L ? -9.4 : -24;
  K.asphalt(b, px0, -2.4, 24, 14.5);
  K.stallsX(b, rng, px0 + 0.8, 23.2, -2.1, -1, 0.42);
  K.stallsX(b, rng, px0 + 0.8, 23.2, 9.1, 1, 0.38);
  up(b, -24, 14.5, 24, 16, 0.07, K.foliage(C.grass));
  for (const tx of [-18, -6, 6, 17]) K.tree(b, rng, tx, 15.0, 0.62);
  K.lotLamp(b, L ? -4 : -12, 6.2, 7.2, [0, Math.PI]);
  K.lotLamp(b, 10, 6.2, 7.2, [0, Math.PI]);
  // main row
  box(b, bx0, 0, bz0, bx1, h, bz1, walls, K.roofP());
  const units = L ? 4 : 5;
  const uw = (bx1 - bx0) / units;
  const colors = rng.shuffle(K.NEON.slice());
  for (let u = 0; u < units; u++) {
    const a = bx0 + u * uw, e = a + uw;
    const door = rng.chance(0.5) ? a + 1.6 : e - 1.6;
    K.storefront(b, a + 0.6, e - 0.6, bz1, { y0: 0.4, y1: 3.0, frame: v === 1 ? 0x2a2d33 : 0x3a3a3a, doors: [door], pitch: 1.9 });
    const lc = colors[u % colors.length];
    if (u % 2 === (v & 1)) K.signBoard(b, rng, a + 1.2, e - 1.2, 3.95, 5.3, bz1, K.plain(v === 1 ? 0x2a2d33 : 0x5a2a1e), lc, 0.18);
    else K.letters(b, rng, (a + e) / 2, 4.02, bz1 + 0.03, uw - 2.4, 1.1, lc, { mixed: rng.chance(0.5) });
    if (u > 0) box(b, a - 0.25, 0, bz1, a + 0.25, h + (v === 1 ? 0.9 : 0.5), bz1 + 0.3, K.plain(trim));
  }
  K.parapet(b, bx0, bz0, bx1, bz1, h, 0.5, 0.25, K.plain(trim));
  K.roofEdge(b, bx0, bz0, bx1, bz1, h + 0.5, [0xff8a2a, 0x2fd6ff, 0x4dff88, 0x3a8dff][v]);
  // walkway cover
  const wz1 = -2.7;
  if (v === 0) {
    // tile arcade roof + central tower
    b.paint(0xb5583a, Surf.RoofTiles).quad([bx0, 3.5, wz1], [bx1, 3.5, wz1], [bx1, 4.4, bz1], [bx0, 4.4, bz1]);
    down(b, bx0, bz1, bx1, wz1, 3.45, K.plain(0xe3d3b5));
    faceZ(b, bx0, bx1, 3.1, 3.5, wz1, K.plain(0xe3d3b5));
    for (let x = bx0 + 0.3; x <= bx1; x += uw / 2) box(b, x - 0.3, 0, wz1 - 0.6, x + 0.3, 3.5, wz1, K.plain(0xe3d3b5), null);
    box(b, -4.6, 0, -8, 4.6, 7.0, -5.2, K.plain(0xe8dac0), null);
    faceZ(b, -3.5, 3.5, 5.0, 6.4, -5.18, K.plain(0x7a3a24));
    K.letters(b, rng, 0, 5.2, -5.15, 6.4, 1.0, 0xffc933, { words: 2 });
    b.paint(0xb5583a, Surf.RoofTiles).pyramid(0, -6.6, 10.0, 3.6, 7.0, 1.4);
  } else if (v === 2) {
    // green standing-seam roof on white columns + cupola
    b.paint(0x3f6b53, Surf.Metal).quad([bx0, 3.6, wz1], [bx1, 3.6, wz1], [bx1, 4.7, bz1], [bx0, 4.7, bz1]);
    down(b, bx0, bz1, bx1, wz1, 3.55, K.plain(0xf0ece2));
    faceZ(b, bx0, bx1, 3.3, 3.6, wz1, K.plain(0xf0ece2));
    for (let x = bx0 + 0.3; x <= bx1; x += uw / 2) b.paint(0xf4f1ea, Surf.Plain).cylinder(x, wz1 - 0.35, 0, 3.4, 0.22, 0.2, 6, { top: false });
    box(b, -1.4, h, -12, 1.4, h + 1.8, -9.2, K.plain(0xf4f1ea), null);
    b.paint(0x3f6b53, Surf.Metal).pyramid(0, -10.6, 3.2, 3.2, h + 1.8, 1.4);
    b.paint(0x3f6b53, Surf.Metal).gableRoof(0, -7.0, 9.4, 3.4, h, 2.0, 'z', 0.25, K.plain(0xf0ece2));
    K.discSign(b, 0, h + 0.75, -5.28, 0.45, K.emis(0xfff1d6, 4), K.plain(0xf0ece2), 10, 0.08);
  } else {
    K.canopy(b, bx0, bx1, bz1, 3.45, bz1 < 0 ? wz1 - bz1 : 2.9, 0.4, K.plain(v === 1 ? 0x2a2d33 : 0x2e5f8a), v === 1 ? K.emis(0x2fd6ff, 5) : undefined);
    for (let x = bx0 + 0.2; x <= bx1; x += uw) box(b, x - 0.15, 0, wz1 - 0.35, x + 0.15, 3.45, wz1 - 0.05, K.metal(0x8a9096), null);
    if (v === 1) {
      box(b, bx0 + uw * 1 - 0.25, 0, bz1 - 0.2, bx0 + uw * 1.6, 6.8, bz1 + 0.4, K.plain(0xe27d3a));
      box(b, bx0 + uw * 3.4, 0, bz1 - 0.2, bx0 + uw * 4 + 0.25, 6.8, bz1 + 0.4, K.plain(0x2a8f8a));
      K.verticalLetters(b, rng, bx0 + uw * 1.3 - 0.12, 4.1, 6.6, bz1 + 0.42, 0.6, 0xfff1d6);
      K.verticalLetters(b, rng, bx0 + uw * 3.7 + 0.12, 4.1, 6.6, bz1 + 0.42, 0.6, 0xffc933);
    }
  }
  if (L) {
    // anchor tenant wing on the left
    const ax0 = -22.5, ax1 = -10.2, az0 = -15.5, az1 = 4.2, ah = 6.8;
    box(b, ax0, 0, az0, ax1, ah, az1, K.plain(0xd9d2c2), K.roofP());
    K.parapet(b, ax0, az0, ax1, az1, ah, 0.5, 0.25, K.plain(0x2e5f8a));
    K.onSide(b, 'px', () => {
      // local x = -world z ; world z [-14, 3] -> local [-3, 14]
      K.storefront(b, -3.2, 5.5, ax1, { y0: 0.2, y1: 3.8, frame: 0x2a2d33, doors: [-0.6, 3.2], pitch: 1.5 });
      box(b, -3.6, 4.2, ax1, 13.5, 6.4, ax1 + 0.3, K.plain(0x2e5f8a));
      K.letters(b, rng, 5, 4.55, ax1 + 0.32, 14, 1.45, 0xffc933, { n: 6, words: 1 });
    });
    K.stallsZ(b, rng, -0.5, 12, -9.1, 1, 0.0);
    K.roofJunk(b, rng, ax0 + 1, az0 + 1, ax1 - 1, az1 - 1, ah, 4, false);
  }
  // pylon sign at the corner
  const pan: K.PylonPanel[] = [{ h: 1.4, color: trim === 0xf0ece2 ? 0x3f6b53 : trim }];
  for (let i = 0; i < 4; i++) pan.push({ h: 0.62, color: colors[(i + 1) % colors.length] });
  K.pylon(b, 21.2, 14.6, 7.9, 2.6, pan, { poles: 2, pole: 0x6a6e73, frame: 0x2a2a2a, cap: 0xdedede });
  K.roofJunk(b, rng, bx0 + 1, bz0 + 1, bx1 - 1, bz1 - 1, h, 5, false);
}

// ============================================================================================ RESTAURANT (2x1)
/** String of festoon lights between two poles: 3 sagging segments (mid -0.4 m), thin warm emissive beams. */
function stringLights(b: B, a: K.V3, c: K.V3, sag = 0.4) {
  const p = K.emis(0xffc870, 3);
  let prev = a;
  for (let i = 1; i <= 3; i++) {
    const t = i / 3;
    const pt: K.V3 = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t - sag * 4 * t * (1 - t) * (i < 3 ? 1 : 0), a[2] + (c[2] - a[2]) * t];
    b.paint(p).beam(prev, pt, 0.04);
    prev = pt;
  }
}
function restTrattoria(b: B, rng: RNG) {
  lotBase(b, 16, 8);
  grass(b, -16, -8, 5.0, -6.3);
  up(b, 5.2, -6.6, 15.4, 6.4, 0.06, K.pav(C.plazaWarm));
  const x0 = -14.6, x1 = 4.6, z0 = -5.6, z1 = 1.4, h = 4.2;
  const st = K.plain(0xd89a6a);
  box(b, x0, 0, z0, x1, h, z1, st, null);
  b.paint(0xa8452e, Surf.RoofTiles).gableRoof((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, h, 2.2, 'x', 0.5, st);
  box(b, -11, h + 0.6, -2.8, -9.8, h + 3.2, -1.6, P(0x9c4a36, Surf.Brick));
  const green = 0x2f6b3a;
  for (const [wa, wb] of [[-13.4, -10.2], [-9.0, -5.8], [0.8, 3.6]] as [number, number][]) {
    K.storefront(b, wa, wb, z1, { y0: 0.7, y1: 2.9, frame: 0x3a2a1e, pitch: 1.1 });
    K.awning(b, wa - 0.2, wb + 0.2, z1, 3.3, 1.1, 0.55, [green], 1, 0.28);
  }
  K.storefront(b, -3.6, -1.0, z1, { y0: 0.05, y1: 2.7, frame: 0x3a2a1e, doors: [-2.3], doorW: 1.9 });
  K.signBoard(b, rng, -4.4, -0.2, 3.0, 3.9, z1, K.plain(0x2f4a2a), 0xffc933, 0.15, { mixed: true });
  for (const px of [-4.9, 0.3]) { box(b, px - 0.35, 0, z1 + 0.2, px + 0.35, 0.6, z1 + 0.9, K.plain(0x8e5b3a)); K.coneTree(b, rng, px, z1 + 0.55, 0.45); }
  // patio
  for (const [ux, uz, c] of [[7.8, -3.4, 0xc8352b], [12.6, -3.4, 0xf2efe6], [7.8, 2.4, 0xf2efe6], [12.6, 2.4, 0xc8352b]] as [number, number, number][]) K.umbrella(b, ux, uz, 1.35, c, 2.6);
  box(b, 15.0, 0, -6.6, 15.5, 0.9, 6.6, K.foliage(C.hedge));
  box(b, 5.2, 0, 6.2, 15.5, 0.9, 6.7, K.foliage(C.hedge));
  for (const [sx, sz] of [[5.6, -6.4], [15.2, -6.4], [5.6, 6.0], [15.2, 6.0]] as [number, number][]) box(b, sx - 0.06, 0, sz - 0.06, sx + 0.06, 3.3, sz + 0.06, K.metal(0x333333), null);
  stringLights(b, [5.6, 3.2, -6.4], [15.2, 3.2, 6.0]);
  stringLights(b, [15.2, 3.2, -6.4], [5.6, 3.2, 6.0]);
  stringLights(b, [5.6, 3.2, 6.0], [15.2, 3.2, 6.0], 0.3);
  stringLights(b, [5.6, 3.2, -6.4], [15.2, 3.2, -6.4], 0.3);
  K.tree(b, rng, -14.0, 5.8, 0.65);
  K.tree(b, rng, -8.6, 6.8, 0.58);
}
function restCafe(b: B, rng: RNG) {
  lotBase(b, 16, 8);
  up(b, 7.8, -8, 16, 8, 0.06, K.foliage(C.grass));
  box(b, -15.0, 0, -7.2, -9.0, 4.9, 1.0, P(0xa87a50, Surf.Wood), K.roofP());
  faceZ(b, -12.4, -11.6, 0.3, 4.4, 1.03, P(0x2a3440, Surf.GlassPlain));
  box(b, -9.0, 0, -6.2, 6.0, 4.2, 1.0, K.plain(0xe9e6df), null);
  K.storefront(b, -8.6, 5.6, 1.0, { y0: 0.1, y1: 4.0, frame: 0x2b2b2b, doors: [-2.5], pitch: 1.5, surround: 0 });
  K.onSide(b, 'px', () => K.storefront(b, -0.6, 5.8, 6.0, { y0: 0.1, y1: 4.0, frame: 0x2b2b2b, pitch: 1.6, surround: 0 }));
  box(b, -9.8, 4.2, -6.8, 7.2, 4.5, 2.8, K.plain(0xf5f3ef), K.roofP(0xb9b6ae), { bottom: K.plain(0xd8d2c6) });
  // brand fascia band (teal, softly lit) along the roof slab edge + neon script on top
  faceZ(b, -9.8, 7.2, 4.22, 4.48, 2.83, K.emis(0x1fae9a, 5));
  faceX(b, -6.8, 2.8, 4.22, 4.48, 7.23, K.emis(0x1fae9a, 5), 1);
  K.letters(b, rng, -1.3, 4.52, 2.6, 7, 0.85, 0xff4fc3, { mixed: true, words: 1 });
  // timber pergola over the patio
  const tim = P(0x8b6a47, Surf.Wood);
  for (let i = 0; i < 6; i++) { const x = -8.6 + i * 2.8; b.paint(tim).beam([x, 3.0, 2.9], [x, 3.0, 7.0], 0.15); }
  b.paint(tim).beam([-8.8, 3.0, 6.9], [5.6, 3.0, 6.9], 0.15);
  for (const x of [-8.6, 5.4]) box(b, x - 0.08, 0, 6.82, x + 0.08, 3.0, 6.98, tim, null);
  // patio
  for (const ux of [-6.8, -2.0, 2.8]) K.umbrella(b, ux, 4.8, 1.3, 0xf4f2ee, 2.6, 0x3a3a3a);
  for (const px of [-8.8, -4.4, 0.4, 4.8]) K.planter(b, rng, px - 1.0, 6.9, px + 1.0, 7.5, 0.7, 0x55595f);
  K.tree(b, rng, 10.5, -3.5, 0.9);
  K.tree(b, rng, 13.2, 3.0, 0.8);
  K.tree(b, rng, -12.4, 5.6, 0.65);
  bench(b, 11.5, 5.8);
}
function restPub(b: B, rng: RNG) {
  lotBase(b, 16, 8);
  grass(b, -16, -8, -13.7, 6.2);
  up(b, 5.2, -7.2, 15.6, 7.0, 0.06, K.pav(0xb5a78e));
  const x0 = -13.2, x1 = 4.4, z0 = -6.6, z1 = 0.0;
  box(b, x0, 0, z0, x1, 3.8, z1, P(0x6e3b2a, Surf.Brick), null);
  box(b, x0, 3.8, z0, x1, 7.2, z1, P(0x7a4432, Surf.WallWindows, 1, 3.6), null);
  b.paint(0x464c55, Surf.RoofTiles).gableRoof((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 7.2, 2.6, 'x', 0.35, P(0x6e3b2a, Surf.Brick));
  for (const cx of [x0 + 1.2, x1 - 1.2]) box(b, cx - 0.5, 7.2, -4.2, cx + 0.5, 10.6, -3.2, P(0x6e3b2a, Surf.Brick));
  // painted pub front
  const pg = K.plain(0x1f3d2e);
  box(b, x0 + 0.4, 0, z1, x1 - 0.4, 3.7, z1 + 0.3, pg, K.plain(0x1f3d2e));
  K.storefront(b, -12.2, -6.8, z1 + 0.3, { y0: 0.9, y1: 2.6, frame: 0xc9a24a, pitch: 0.9, surround: 0.08 });
  K.storefront(b, -2.8, 3.2, z1 + 0.3, { y0: 0.9, y1: 2.6, frame: 0xc9a24a, pitch: 0.9, surround: 0.08 });
  K.door(b, -4.8, z1 + 0.3, 1.3, 2.3, 0x5a1a14, 0xc9a24a);
  box(b, x0 + 0.6, 2.85, z1 + 0.3, x1 - 0.6, 3.55, z1 + 0.42, pg);
  K.letters(b, rng, -4.4, 2.97, z1 + 0.44, 14, 0.46, 0xffd88a, { words: 2, n: 10 });
  K.bladeSign(b, x1 - 0.9, z1 + 0.3, 4.3, 1.3, 1.1, 0xffd88a, 0x1f3d2e);
  for (const lx of [-6.0, -3.6]) box(b, lx - 0.15, 2.35, z1 + 0.35, lx + 0.15, 2.75, z1 + 0.65, K.emis(0xffc870));
  // beer garden
  for (const [tx, tz] of [[7.8, -4.0], [12.4, -4.0], [7.8, 1.5], [12.4, 1.5]] as [number, number][]) {
    box(b, tx - 1.0, 0.7, tz - 0.4, tx + 1.0, 0.78, tz + 0.4, P(0x8b6a47, Surf.Wood));
    box(b, tx - 1.0, 0.4, tz - 0.85, tx + 1.0, 0.46, tz - 0.6, P(0x8b6a47, Surf.Wood));
    box(b, tx - 1.0, 0.4, tz + 0.6, tx + 1.0, 0.46, tz + 0.85, P(0x8b6a47, Surf.Wood));
  }
  K.umbrella(b, 7.8, -4.0, 1.4, 0x1f4d32, 2.6, 0x8b6a47);
  K.umbrella(b, 12.4, 1.5, 1.4, 0x1f4d32, 2.6, 0x8b6a47);
  fenceLine(b, 5.2, 7.0, 15.6, 7.0);
  fenceLine(b, 15.6, 7.0, 15.6, -7.2);
  K.tree(b, rng, 13.6, 4.9, 0.7);
  K.tree(b, rng, -14.4, 5.2, 0.62);
  K.tree(b, rng, -9.0, 6.9, 0.56);
}
function fenceLine(b: B, ax: number, az: number, bx: number, bz: number, h = 1.1, color = 0x5a3e28) {
  const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 2.6));
  for (let i = 0; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
    box(b, x - 0.07, 0, z - 0.07, x + 0.07, h, z + 0.07, P(color, Surf.Wood), null);
  }
  b.paint(color, Surf.Wood).beam([ax, h * 0.8, az], [bx, h * 0.8, bz], 0.08).beam([ax, h * 0.4, az], [bx, h * 0.4, bz], 0.08);
}
function restAsian(b: B, rng: RNG) {
  lotBase(b, 16, 8);
  grass(b, -16, -8, -12.8, 6.2);
  up(b, 6.0, -6.8, 15.4, 6.6, 0.06, K.pav(0xdcd6c8));
  const x0 = -11.6, x1 = 4.4, z0 = -6.4, z1 = 0.8;
  box(b, x0 - 1.0, 0, z0 - 0.8, x1 + 1.0, 0.5, z1 + 2.0, P(0x8e8b84, Surf.Stone));
  box(b, x0, 0.5, z0, x1, 4.0, z1, P(0x4a3024, Surf.Wood), null);
  K.storefront(b, x0 + 0.8, x1 - 0.8, z1, { y0: 0.9, y1: 3.4, frame: 0x2a1a12, doors: [-3.6], pitch: 0.8, transom: 2.6, surround: 0.1 });
  const red = K.plain(0x9e1b1b);
  for (let x = x0 + 0.2; x <= x1; x += 3.2) box(b, x - 0.18, 0.5, z1 + 1.35, x + 0.18, 4.05, z1 + 1.71, red, null);
  b.paint(0x3f5a5a, Surf.RoofTiles).hipRoof((x0 + x1) / 2, (z0 + z1) / 2 + 0.5, x1 - x0, z1 - z0 + 1.2, 4.0, 1.9, 0.9);
  box(b, -7.6, 4.6, -4.4, 0.4, 6.9, -0.4, P(0x4a3024, Surf.Wood), null);
  faceZ(b, -7.0, -0.2, 6.0, 6.7, -0.37, P(0x2a3440, Surf.GlassPlain));
  b.paint(0x3f5a5a, Surf.RoofTiles).hipRoof(-3.6, -2.4, 8.0, 4.0, 6.9, 1.3, 0.8);
  const gold = K.metal(0xc9a24a);
  b.paint(gold).beam([-5.6, 8.2, -2.4], [-1.6, 8.2, -2.4], 0.2);
  b.paint(gold).beam([x0 - 0.9, 3.83, z1 + 1.3], [x1 + 0.9, 3.83, z1 + 1.3], 0.2);
  box(b, -3.75, 8.1, -2.55, -3.45, 8.7, -2.25, gold);
  for (let x = x0 + 1.8; x < x1; x += 3.2) box(b, x - 0.3, 2.8, z1 + 1.85, x + 0.3, 3.6, z1 + 2.45, K.emis(0xff3322, 7));
  box(b, x0 - 0.8, 1.2, z1 + 2.0, x0 - 0.1, 3.8, z1 + 2.3, K.metal(0x2a1a12), undefined, { pz: K.emis(0xff4030, 7) });
  // torii gate
  const gz = 5.6, gx = -3.6;
  for (const s of [-1.6, 1.6]) box(b, gx + s - 0.2, 0, gz - 0.2, gx + s + 0.2, 3.6, gz + 0.2, red, null);
  box(b, gx - 2.4, 3.6, gz - 0.3, gx + 2.4, 3.95, gz + 0.3, K.plain(0x1e1e1e));
  box(b, gx - 1.9, 2.9, gz - 0.15, gx + 1.9, 3.15, gz + 0.15, red);
  // zen garden + pond + bamboo
  b.paint(C.water, Surf.Water).cylinder(11.8, 2.4, 0, 0.12, 2.4, 2.4, 9, { smooth: false });
  for (const [rx, rz, rr] of [[8.2, -3.8, 0.9], [9.8, -4.6, 0.6], [13.6, -3.0, 0.75]] as [number, number, number][]) b.paint(0x8a8680, Surf.Stone).blob(rx, rr * 0.4, rz, rr, rr * 0.7, rr, 0, 0.2, rx);
  for (let i = 0; i < 5; i++) box(b, 14.6 - i * 0.3, 0, -6.2 + i * 0.5, 14.72 - i * 0.3, 4.5 + (i % 2), -6.08 + i * 0.5, K.foliage(0x6a9a3a), null);
  K.coneTree(b, rng, 7.2, 5.4, 0.5);
  K.tree(b, rng, -14.4, 5.4, 0.6);
}
const restaurant: ModelBuildFn = (b, v, rng) => [restTrattoria, restCafe, restPub, restAsian][v % 4](b, rng);

// ============================================================================================ BOUTIQUE (1x1)
function upperWindow(b: B, cx: number, y0: number, y1: number, z: number, w: number, frame: number, surround?: number) {
  if (surround !== undefined) faceZ(b, cx - w / 2 - 0.25, cx + w / 2 + 0.25, y0 - 0.2, y1 + 0.3, z + 0.01, K.plain(surround));
  K.storefront(b, cx - w / 2, cx + w / 2, z + 0.01, { y0, y1, frame, pitch: w / 2, transom: y0 + (y1 - y0) * 0.72, surround: 0.07 });
}
function boutLimestone(b: B, rng: RNG) {
  lotBase(b, 8, 8);
  grass(b, -8, -8, 8, -6.95);
  const stone = P(0xd8ccb4, Surf.Stone);
  const z1 = 3.0, h = 8.2;
  box(b, -7, 0, -6.5, 7, h, z1, stone, null);
  K.cornice(b, -7, -6.5, 7, z1, 7.8, 0.5, 0.3, P(0xe6dcc6, Surf.Stone));
  up(b, -6.9, -6.4, 6.9, z1 - 0.1, 8.31, K.roofP());
  K.cornice(b, -7, -6.5, 7, z1, 4.3, 0.25, 0.12, P(0xe6dcc6, Surf.Stone));
  for (const px of [-6.7, -2.2, 2.2, 6.7]) box(b, px - 0.3, 0, z1, px + 0.3, 7.8, z1 + 0.22, stone, null);
  const blk = 0x1e1f22;
  for (const [a, e] of [[-6.0, -2.9], [2.9, 6.0]] as [number, number][]) {
    K.storefront(b, a, e, z1, { y0: 0.6, y1: 3.7, frame: blk, pitch: 1.1, transom: 3.0 });
    K.awning(b, a - 0.2, e + 0.2, z1 + 0.2, 4.05, 1.0, 0.55, [blk], 1, 0.22);
  }
  K.storefront(b, -1.5, 1.5, z1, { y0: 0.05, y1: 3.2, frame: blk, doors: [0], doorW: 2.0 });
  K.letters(b, rng, 0, 3.55, z1 + 0.05, 3.4, 0.5, 0xffd88a, { mixed: true, words: 1 });
  for (const wx of [-4.45, 0, 4.45]) upperWindow(b, wx, 4.9, 7.3, z1, 1.7, 0x2a2a2a, 0xcfc2a8);
  K.facadeFlag(b, 0, 7.45, z1 + 0.2, 0x1d3a6b, 2.2);
  for (const tx of [-1.9, 1.9]) { box(b, tx - 0.4, 0, 3.7, tx + 0.4, 0.6, 4.5, K.plain(0x2e2f33)); b.paint(0x3f6b2e, Surf.Foliage).blob(tx, 1.15, 4.1, 0.55, 0.55, 0.55, 0, 0.1, tx); }
  K.onSide(b, 'px', () => { for (const wz of [-3.2, 1.8]) upperWindow(b, wz, 4.9, 7.3, 7.0, 1.6, 0x2a2a2a); });
  K.ac(b, -3, 8.31, -3.5, 0.9);
  K.tree(b, rng, 6.4, 6.8, 0.58);
}
function boutWhite(b: B, rng: RNG) {
  lotBase(b, 8, 8);
  grass(b, -8, -8, 8, -7.0);
  const wh = K.plain(0xf4f2ee), z1 = 2.4, h = 8.6;
  box(b, -7, 0, -6.5, 7, h, z1, wh, null);
  // coping + green roof
  K.cornice(b, -7, -6.5, 7, z1, h, 0.25, 0.1, K.plain(0xe6e1d6));
  up(b, -6.9, -6.4, 6.9, z1 - 0.1, h + 0.26, K.foliage(0x7c9a4e));
  // stone plinth
  K.bandRect(b, -7, -6.5, 7, z1, 0, 0.6, P(0x9a948a, Surf.Stone), 0.12);
  K.storefront(b, -5.8, 5.8, z1, { y0: 0.6, y1: 7.2, frame: 0xcfc9bd, pitch: 2.9, doors: [0], doorW: 2.2, transom: 4.3, surround: 0 });
  const zf = z1 + 0.9;
  box(b, -6.5, 0, z1, -5.8, 7.9, zf, wh);
  box(b, 5.8, 0, z1, 6.5, 7.9, zf, wh);
  box(b, -6.5, 7.2, z1, 6.5, 7.9, zf, wh, undefined, { bottom: wh });
  box(b, -5.8, 0, z1, 5.8, 0.6, zf, P(0x9a948a, Surf.Stone));
  // gold letters on a projecting frame above the portal
  box(b, -3.6, 7.95, z1 + 0.2, 3.6, 8.6, zf + 0.2, K.metal(0x2a2a2a));
  K.letters(b, rng, 0, 8.02, zf + 0.22, 6.8, 0.5, 0xffd88a, { words: 1, n: 7 });
  K.onSide(b, 'px', () => K.storefront(b, -0.8, 0.8, 7, { y0: 0.7, y1: 7.6, frame: 0xcfc9bd, pitch: 2, surround: 0 }));
  for (const px of [-3.9, 3.9]) {
    box(b, px - 0.6, 0, 3.8, px + 0.6, 0.7, 5.0, P(0x9a948a, Surf.Stone), K.foliage(0x4d7a36));
    K.coneTree(b, rng, px, 4.4, 0.42);
  }
  K.tree(b, rng, -6.4, 6.8, 0.58);
}
function boutGranite(b: B, rng: RNG) {
  lotBase(b, 8, 8);
  grass(b, -8, -8, 8, -6.9);
  const g = P(0x3c3c40, Surf.Stone), z1 = 2.8, h = 8.0;
  box(b, -7, 0, -6.5, 7, h, z1, g, K.roofP());
  K.cornice(b, -7, -6.5, 7, z1, h - 0.4, 0.4, 0.15, K.metal(0x8a6a3a), null);
  K.cornice(b, -7, -6.5, 7, z1, h, 0.25, 0.2, K.metal(0x8a6a3a));
  up(b, -6.9, -6.4, 6.9, z1 - 0.1, h + 0.26, K.roofP());
  K.roofEdge(b, -7.2, -6.7, 7.2, z1 + 0.2, h + 0.25, 0xffb060, 0.2);
  const bronze = 0x8a6a3a;
  K.storefront(b, -6.1, -2.7, z1, { y0: 0.4, y1: 6.9, frame: bronze, pitch: 1.2, transom: 3.6 });
  K.storefront(b, 2.7, 6.1, z1, { y0: 0.4, y1: 6.9, frame: bronze, pitch: 1.2, transom: 3.6 });
  K.storefront(b, -1.7, 1.7, z1, { y0: 0.05, y1: 6.9, frame: bronze, pitch: 1.7, doors: [0], doorW: 2.0, transom: 3.6 });
  K.canopy(b, -2.4, 2.4, z1, 3.8, 1.8, 0.28, K.metal(bronze), K.emis(0xffd88a, 5));
  K.facadeFlag(b, -4.4, 7.0, z1, 0x6b1f2a, 2.2);
  K.facadeFlag(b, 4.4, 7.0, z1, 0x6b1f2a, 2.2);
  K.letters(b, rng, 0, 4.1, z1 + 1.7, 4.2, 0.55, 0xffe6b0, { words: 1, n: 5 });
  for (const tx of [-4.4, 4.4]) { box(b, tx - 1.0, 0, 3.4, tx + 1.0, 0.7, 4.3, K.metal(bronze), K.foliage(0x3f6b2e)); K.shrub(b, rng, tx, 3.85, 0.6); }
  K.onSide(b, 'px', () => upperWindow(b, -1.5, 4.4, 6.9, 7.0, 2.2, bronze));
  K.ac(b, 3, h + 0.25, -3.5, 1.0);
  K.tree(b, rng, -6.4, 6.8, 0.58);
}
function boutParis(b: B, rng: RNG) {
  lotBase(b, 8, 8);
  grass(b, -8, -8, 8, -7.0);
  const st = P(0xe9dec6, Surf.Stone), z1 = 2.4;
  box(b, -7, 0, -6.5, 7, 7.0, z1, st, null);
  K.cornice(b, -7, -6.5, 7, z1, 6.8, 0.35, 0.25, P(0xf1e8d4, Surf.Stone), null);
  K.loft(b, K.rectPts(-7.2, -6.7, 7.2, z1 + 0.2), K.rectPts(-6.1, -5.6, 6.1, z1 - 0.9), 7.15, 9.2, P(0x4f5660, Surf.RoofTiles), K.roofP(0x6a6e73));
  const bur = 0x5a1a24;
  box(b, -6.6, 0, z1, 6.6, 3.6, z1 + 0.25, K.plain(bur));
  K.storefront(b, -5.9, -1.3, z1 + 0.25, { y0: 0.7, y1: 2.8, frame: 0xc9a24a, pitch: 1.15, surround: 0.06 });
  K.storefront(b, 1.3, 5.9, z1 + 0.25, { y0: 0.7, y1: 2.8, frame: 0xc9a24a, pitch: 1.15, surround: 0.06 });
  K.storefront(b, -0.8, 0.8, z1 + 0.25, { y0: 0.05, y1: 2.8, frame: 0xc9a24a, doors: [0], doorW: 1.4, surround: 0.06 });
  K.letters(b, rng, 0, 3.02, z1 + 0.27, 10, 0.42, 0xffd88a, { words: 2, mixed: true });
  K.awning(b, -6.6, 6.6, z1 + 0.25, 2.95, 1.2, 0.55, [bur, 0xefe6d2], 0.75, 0.25);
  // balcony + french windows
  box(b, -6.9, 4.0, z1, 6.9, 4.15, z1 + 0.8, st, undefined, { bottom: st });
  b.paint(0x1e1e1e, Surf.Metal).beam([-6.85, 5.0, z1 + 0.75], [6.85, 5.0, z1 + 0.75], 0.06);
  faceZ(b, -6.85, 6.85, 4.15, 4.95, z1 + 0.76, K.metal(0x2a2a2a));
  for (const wx of [-5.1, -1.7, 1.7, 5.1]) upperWindow(b, wx, 4.2, 6.5, z1, 1.2, 0xe9e2d2);
  for (const dx of [-3.4, 0, 3.4]) {
    box(b, dx - 0.7, 7.2, z1 - 1.1, dx + 0.7, 8.5, z1 - 0.1, st, null);
    faceZ(b, dx - 0.45, dx + 0.45, 7.35, 8.3, z1 - 0.08, P(0x2a3440, Surf.GlassPlain));
    b.paint(0x4f5660, Surf.RoofTiles).gableRoof(dx, z1 - 0.6, 1.4, 1.0, 8.5, 0.6, 'z', 0.1, st);
  }
  for (const cx of [-6.2, 6.2]) box(b, cx - 0.4, 8.6, -3.0, cx + 0.4, 10.0, -1.6, P(0xe0d4bc, Surf.Stone));
  K.tree(b, rng, 6.5, 6.9, 0.56);
}
function boutLoft(b: B, rng: RNG) {
  lotBase(b, 8, 8);
  grass(b, -8, -8, 8, -6.9);
  const br = P(0x9c4a36, Surf.Brick), z1 = 2.6, h = 8.6;
  box(b, -7, 0, -6.5, 7, h, z1, br, K.roofP());
  K.parapet(b, -7.05, -6.55, 7.05, z1 + 0.05, h, 0.4, 0.3, P(0xd6cbb6, Surf.Stone));
  const blk = 0x1c1c1e;
  K.storefront(b, -6.2, 6.2, z1, { y0: 0.4, y1: 3.5, frame: blk, pitch: 1.0, transom: 2.75, doors: [3.6] });
  K.storefront(b, -6.0, 6.0, z1, { y0: 4.6, y1: 7.8, frame: blk, pitch: 0.8, transom: 6.8, surround: 0.1 });
  faceZ(b, -6.0, 6.0, 5.66, 5.74, z1 + 0.07, K.metal(blk));
  K.canopy(b, -6.6, 6.6, z1, 3.75, 1.3, 0.14, K.metal(blk));
  K.bladeSign(b, -6.5, z1, 4.7, 2.4, 1.0, 0xffe0a0, blk);
  for (const tx of [-5.0, -1.2]) { box(b, tx - 0.5, 0, 4.2, tx + 0.5, 0.5, 5.0, K.metal(0x2e2f33), K.foliage(0x4d7a36)); K.shrub(b, rng, tx, 4.6, 0.55); }
  K.onSide(b, 'px', () => { for (const wz of [-3.4, 0.6]) K.storefront(b, wz - 1.2, wz + 1.2, 7, { y0: 4.6, y1: 7.6, frame: blk, pitch: 0.8, surround: 0.1 }); });
  K.roofJunk(b, rng, -6.5, -6, 0, -2, h, 2, false);
  K.roofEdge(b, -7.05, -6.55, 7.05, z1 + 0.05, h + 0.4, 0xffb060, 0.3);
  // rooftop terrace: deck, lawn, planters, umbrella
  up(b, 0.4, -4.6, 6.5, 2.0, h + 0.02, P(0x8b6a47, Surf.Wood));
  up(b, -6.6, -1.6, 0.2, 2.0, h + 0.02, K.foliage(0x77a34f));
  b.push().translate(0, h, 0);
  for (const px of [1.2, 5.8]) K.planter(b, rng, px - 0.5, 1.0, px + 0.5, 1.9, 0.5, 0x2e2f33, false);
  K.shrub(b, rng, 1.2, 1.45, 0.5);
  K.shrub(b, rng, 5.8, 1.45, 0.5);
  K.umbrella(b, 3.5, -1.6, 1.2, 0xe27d3a, 2.3, 0x3a3a3a);
  b.pop();
  K.tree(b, rng, 6.3, 6.8, 0.58);
}
const boutique: ModelBuildFn = (b, v, rng) => [boutLimestone, boutWhite, boutGranite, boutParis, boutLoft][v % 5](b, rng);

const cornerStore: ModelBuildFn = (b, v, rng) => [cornerBrick, cornerConvenience, cornerWestern, cornerDeli, cornerModern, cornerPharmacy][v % 6](b, rng);

export const lowModels: Record<string, ModelBuildFn> = {
  com_corner_store: cornerStore,
  com_gas_station: (b, v, rng) => gasStation(b, v, rng),
  com_diner: diner,
  com_strip_mall: (b, v, rng) => stripMall(b, v, rng),
  com_restaurant: restaurant,
  com_boutique: boutique,
};
