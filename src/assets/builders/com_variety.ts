/** Additional street-shop and office silhouettes; legacy commercial builders keep their saved appearances. */
import type { ModelBuilder, Paint } from '../ModelBuilder';
import type { ModelBuildFn, ModelBuilders } from '../registry';
import type { RNG } from '../../core/rng';
import { Surf } from '../../core/types';
import * as K from './com_kit';
import { P, box, up, faceZ } from './com_kit';

type B = ModelBuilder;
type CornerRoof = 'hip' | 'gable' | 'steps';
type ShopsRoof = 'hip' | 'gables' | 'terrace';
type OfficeRoof = 'steps' | 'sawtooth' | 'vault';

const SHOP_WALLS = [0x8fa88c, 0x87a6b9, 0xc9a46f, 0xb47b75, 0xa39ab4, 0xd5c8a5];
const SHOP_TRIM = [0x264d43, 0x344b68, 0x714237, 0x57344d, 0x354d53, 0x63523e];
const PITCHED_ROOFS = [0x557f72, 0x4b5768, 0xa45d42, 0x6a6656, 0x596c72, 0x7c5144];
const OFFICE_WALLS = [0xe2d4b4, 0x8aa9a3, 0xb97959, 0xa5a7b1];
const OFFICE_TRIM = [0x765839, 0x315a58, 0xe4d5b9, 0x484b60];

function pavedLot(b: B, half: number) {
  up(b, -half, -half, half, half, 0.03, K.pav(0xbeb7a8));
  up(b, -half, half - 1.6, half, half, 0.05, K.pav(0xd2cbbc));
}

function roofDormer(b: B, x: number, z: number, y: number, wall: Paint, roof: number) {
  box(b, x - 0.7, y, z - 0.9, x + 0.7, y + 1.3, z, wall, null);
  K.storefront(b, x - 0.45, x + 0.45, z, { y0: y + 0.25, y1: y + 1.05, frame: 0xe8e1d2, pitch: 0.9, surround: 0.06 });
  b.paint(roof, Surf.RoofTiles).gableRoof(x, z - 0.45, 1.6, 1.0, y + 1.3, 0.55, 'z', 0.08, wall);
}

function cornerShop(b: B, v: number, rng: RNG, roof: CornerRoof) {
  pavedLot(b, 8);
  const x0 = -6.6, x1 = 6.6, z0 = -6.2, z1 = 2.6, h = roof === 'gable' ? 4.7 : 4.4;
  const k = (v + (roof === 'hip' ? 2 : roof === 'steps' ? 3 : 0)) % SHOP_WALLS.length;
  const wall = P(SHOP_WALLS[k], roof === 'gable' ? Surf.Wood : roof === 'steps' ? Surf.Brick : Surf.Plain);
  const trim = SHOP_TRIM[k], tile = PITCHED_ROOFS[k];
  box(b, x0, 0, z0, x1, h, z1, wall, roof === 'steps' ? K.roofP() : null);
  K.bandRect(b, x0, z0, x1, z1, 0, 0.45, P(0x938a7b, Surf.Stone), 0.05);
  if (roof === 'hip') {
    b.paint(tile, Surf.RoofTiles).hipRoof(0, -1.8, 13.2, 8.8, h, 2.25, 0.35);
    box(b, -4.9, h + 0.2, -4.9, -4.1, h + 2.8, -4.0, P(0xc5b79d, Surf.Stone));
  } else if (roof === 'gable') {
    b.paint(tile, Surf.Metal).gableRoof(0, -1.8, 13.2, 8.8, h, 2.1, 'z', 0.35, wall);
    faceZ(b, -0.8, 0.8, h + 0.4, h + 1.1, z1 + 0.02, K.plain(trim));
    K.storefront(b, -0.6, 0.6, z1 + 0.03, { y0: h + 0.5, y1: h + 1.0, frame: 0xe9e2d1, surround: 0.05 });
  } else {
    K.parapet(b, x0, z0, x1, z1, h, 0.45, 0.25, P(0xeee2c7, Surf.Stone));
    box(b, -5.7, h + 0.45, z1 - 0.25, 5.7, h + 1.05, z1 + 0.05, wall, P(0xeee2c7, Surf.Stone));
    box(b, -3.1, h + 1.05, z1 - 0.25, 3.1, h + 1.65, z1 + 0.05, wall, P(0xeee2c7, Surf.Stone));
    K.ac(b, v % 2 ? -3.4 : 3.4, h, -3.8, 1.0);
  }
  const door = v % 2 ? -3.8 : 3.8;
  K.storefront(b, -5.9, 5.9, z1, { y0: 0.5, y1: 3.0, frame: trim, doors: [door], pitch: 1.65, transom: 2.45 });
  K.signBoard(b, rng, -5.9, 5.9, 3.3, 4.1, z1, K.plain(trim), 0xffe3aa, 0.18, { n: 6, words: 1 });
  if (roof === 'gable') K.canopy(b, -6.1, 6.1, z1, 3.2, 1.8, 0.18, P(tile, Surf.Metal));
  else K.awning(b, -6.1, 6.1, z1, 3.2, 1.5, 0.55, [trim, 0xeee6d2], 1.1, 0.22);
  K.onSide(b, 'px', () => K.storefront(b, -1.7, 4.9, x1, { y0: 0.8, y1: 2.8, frame: trim, pitch: 1.65, surround: 0.08 }));
  for (const x of [-5.1, 5.1]) K.planter(b, rng, x - 0.65, 5.4, x + 0.65, 6.5, 0.5, 0x8c8273);
  box(b, -2.0, 0.45, 5.7, 1.1, 0.65, 6.25, P(0x89684b, Surf.Wood), undefined, { bottom: P(0x89684b, Surf.Wood) });
  K.dumpster(b, v % 2 ? -4.6 : 4.6, -7.05, 0x475c50);
}

function shopFront(b: B, v: number, rng: RNG, z: number, trim: number) {
  for (const [a, e] of [[-5.9, -0.8], [0.8, 5.9]] as [number, number][]) {
    K.storefront(b, a, e, z, { y0: 0.4, y1: 2.8, frame: trim, doors: [(a + e) / 2], pitch: 1.4, transom: 2.2 });
    K.awning(b, a - 0.12, e + 0.12, z, 2.95, 1.25, 0.5, [trim, 0xeee7d6], 0.9, 0.2);
    K.signBoard(b, rng, a, e, 3.1, 3.8, z, K.plain(trim), v % 2 ? 0xffe3aa : 0xc1e5f0, 0.15, { n: 4, words: 1 });
  }
  K.door(b, 0, z, 1.1, 2.5, 0x45342a, 0xe8dfcc);
}

function shopsApartments(b: B, v: number, rng: RNG, roof: ShopsRoof) {
  pavedLot(b, 8);
  const x0 = -6.4, x1 = 6.4, z0 = -6.4, z1 = 3.2;
  const k = (v + (roof === 'gables' ? 1 : roof === 'terrace' ? 3 : 0)) % SHOP_WALLS.length;
  const trim = SHOP_TRIM[k], tile = PITCHED_ROOFS[k];
  const wall = P(SHOP_WALLS[k], Surf.WallWindows, 2, 3.2);
  const top = roof === 'hip' ? 10.4 : 12.8;
  box(b, x0, 0, z0, x1, 4.0, z1, P(0xd3c6ac, Surf.Stone), null);
  box(b, x0, 4.0, z0, x1, top, z1, wall, roof === 'terrace' ? K.roofP() : null);
  K.cornice(b, x0, z0, x1, z1, 3.85, 0.2, 0.12, K.plain(0xebe3d2), null);
  shopFront(b, v, rng, z1, trim);
  if (roof === 'hip') {
    b.paint(tile, Surf.RoofTiles).hipRoof(0, -1.6, 12.8, 9.6, top, 3.0, 0.3);
    for (const x of [-3.2, 3.2]) roofDormer(b, x, z1 - 0.4, top + 0.3, K.plain(SHOP_WALLS[k]), tile);
    box(b, 4.7, top + 1.0, -4.8, 5.5, top + 3.8, -3.9, P(0xd0c3ab, Surf.Stone));
  } else if (roof === 'gables') {
    for (const x of [-3.2, 3.2]) {
      b.paint(tile, Surf.RoofTiles).gableRoof(x, -1.6, 6.4, 9.6, top, 2.4, 'z', 0.2, K.plain(SHOP_WALLS[k]));
      K.storefront(b, x - 0.65, x + 0.65, z1 + 0.02, { y0: top + 0.4, y1: top + 1.2, frame: 0xe8e1d2, pitch: 1.3, surround: 0.06 });
    }
    for (const x of [-4.8, 4.8]) box(b, x - 0.25, 4.0, z1, x + 0.25, top + 0.25, z1 + 0.3, K.plain(0xeee5d0), null);
  } else {
    K.parapet(b, x0, z0, x1, z1, top, 0.65, 0.22, K.plain(0xe9dfcc));
    box(b, -4.8, top, -4.8, 3.2, top + 3.2, -1.6, wall, K.roofP(0x8c938b));
    K.cornice(b, -4.8, -4.8, 3.2, -1.6, top + 3.2, 0.3, 0.2, K.plain(trim));
    up(b, -5.9, -0.6, 5.9, 2.2, top + 0.03, P(0x9c805d, Surf.Wood));
    b.push().translate(0, top, 0);
    for (const x of [-4.5, 0, 4.5]) K.planter(b, rng, x - 0.6, 1.0, x + 0.6, 2.0, 0.55, trim);
    K.umbrella(b, 4.2, -3.6, 1.1, 0xe5d9b7, 2.3);
    b.pop();
  }
  // Projecting sill bands and a narrow iron balcony break the upper-floor grid.
  for (const y of roof === 'hip' ? [4.4, 7.6] : [7.0, 10.2]) {
    box(b, -2.8, y, z1, 2.8, y + 0.18, z1 + 0.8, K.plain(0xe9e1ce), undefined, { bottom: K.plain(0xe9e1ce) });
    b.paint(trim, Surf.Metal).quad2([-2.8, y + 0.18, z1 + 0.78], [2.8, y + 0.18, z1 + 0.78], [2.8, y + 1.0, z1 + 0.78], [-2.8, y + 1.0, z1 + 0.78]);
  }
  K.planter(b, rng, -6.5, 5.6, -4.6, 6.7, 0.55, 0x817a6e);
  K.planter(b, rng, 4.6, 5.6, 6.5, 6.7, 0.55, 0x817a6e);
  K.dumpster(b, v % 2 ? -4.2 : 4.2, -7.1, 0x475c50);
}

function officeLobby(b: B, rng: RNG, trim: number) {
  K.storefront(b, -9.6, 9.6, 4.5, { y0: 0.1, y1: 4.0, frame: trim, doors: [-1.3, 1.3], pitch: 2.4, surround: 0.08 });
  K.canopy(b, -4.2, 4.2, 4.5, 4.1, 3.2, 0.3, K.metal(trim), K.emis(0xe9dfc5, K.CANOPY_K));
  for (const x of [-11, 11]) for (const z of [6.8, 11.2]) {
    K.planter(b, rng, x - 1.3, z - 1.2, x + 1.3, z + 1.2, 0.6, 0x938b7c);
    K.tree(b, rng, x, z, 2.0);
  }
  up(b, -3.0, 8.1, 3.0, 15.4, 0.07, K.pav(0xd9d2c4));
  box(b, 4.2, 0, 13.8, 10.2, 1.4, 14.3, K.plain(trim));
  K.letters(b, rng, 7.2, 0.4, 14.32, 5.2, 0.65, 0xffe2ac, { n: 6, words: 1, surf: Surf.Plain });
}

function officeBlock(b: B, v: number, rng: RNG, roof: OfficeRoof) {
  pavedLot(b, 16);
  const k = (v + (roof === 'sawtooth' ? 1 : roof === 'vault' ? 2 : 0)) % OFFICE_WALLS.length;
  const trim = OFFICE_TRIM[k];
  const wall = P(OFFICE_WALLS[k], Surf.WallWindows, 5, 3.6);
  const x0 = -12.0, x1 = 12.0, z0 = -12.0, z1 = 4.5;
  const top = roof === 'steps' ? 28.8 : roof === 'sawtooth' ? 32.4 : 36.0;
  box(b, -10.2, 0, -10.2, 10.2, 4.5, z1, P(0x38424a, Surf.GlassPlain), null);
  box(b, x0, 4.5, z0, x1, top, z1, wall, K.roofP(), { bottom: K.plain(0xa49d8e) });
  officeLobby(b, rng, trim);
  for (let y = 7.2; y < top; y += 7.2) K.bandRect(b, x0, z0, x1, z1, y - 0.25, y, K.plain(trim), 0.08);
  if (roof === 'steps') {
    box(b, -9, top, -10.5, 9, top + 7.2, 2.4, wall, K.roofP(0xa1937d));
    K.bandRect(b, -9, -10.5, 9, 2.4, top + 6.6, top + 7.2, K.metal(trim), 0.1);
    box(b, -5.7, top + 7.2, -8.7, 5.7, top + 10.8, -0.3, wall, K.roofP(0xa1937d));
    K.bandRect(b, -5.7, -8.7, 5.7, -0.3, top + 10.3, top + 11.1, K.metal(trim), 0.1);
    K.ac(b, v % 2 ? -2.4 : 2.4, top + 10.8, -5, 1.2);
  } else if (roof === 'sawtooth') {
    K.parapet(b, x0, z0, x1, z1, top, 0.4, 0.2, K.metal(trim));
    for (let i = 0; i < 3; i++) {
      const a = -11.4 + i * 7.6, e = a + 7.3, high = top + 3.6;
      b.paint(PITCHED_ROOFS[k], Surf.Metal).quad([a, top + 0.4, 3.8], [e, high, 3.8], [e, high, -11.4], [a, top + 0.4, -11.4]);
      b.paint(0x80b2b6, Surf.GlassPlain).quad([e, top + 0.4, -11.4], [e, high, -11.4], [e, high, 3.8], [e, top + 0.4, 3.8]);
      b.paint(K.plain(trim)).tri([a, top + 0.4, 3.8], [e, top + 0.4, 3.8], [e, high, 3.8]);
      b.tri([a, top + 0.4, -11.4], [e, high, -11.4], [e, top + 0.4, -11.4]);
    }
    for (const x of [-9, -3, 3, 9]) box(b, x - 0.12, 4.5, z1, x + 0.12, top + 0.4, z1 + 0.6, K.metal(trim));
  } else {
    K.parapet(b, x0, z0, x1, z1, top, 0.65, 0.22, K.plain(trim));
    box(b, -6.8, top, -10.2, 6.8, top + 2.0, 2.6, K.plain(trim), null);
    const cy = top + 2.0, radius = 6.8, rise = 3.6;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 8, e = (i + 1) * Math.PI / 8;
      const ax = Math.cos(a) * radius, ay = cy + Math.sin(a) * rise;
      const ex = Math.cos(e) * radius, ey = cy + Math.sin(e) * rise;
      b.paint(PITCHED_ROOFS[k], Surf.Metal).quad([ax, ay, 2.6], [ax, ay, -10.2], [ex, ey, -10.2], [ex, ey, 2.6]);
      b.paint(0x8bb4bd, Surf.GlassPlain).tri([0, cy, 2.6], [ax, ay, 2.6], [ex, ey, 2.6]);
      b.paint(K.plain(trim)).tri([0, cy, -10.2], [ex, ey, -10.2], [ax, ay, -10.2]);
    }
    for (const x of [-9.3, 9.3]) K.ac(b, x, top, -5.4, 1.15);
  }
}

const corner = (roof: CornerRoof): ModelBuildFn => (b, v, rng) => cornerShop(b, v, rng, roof);
const shops = (roof: ShopsRoof): ModelBuildFn => (b, v, rng) => shopsApartments(b, v, rng, roof);
const office = (roof: OfficeRoof): ModelBuildFn => (b, v, rng) => officeBlock(b, v, rng, roof);

export const varietyModels: ModelBuilders = {
  com_corner_store_hip: corner('hip'),
  com_corner_store_gable: corner('gable'),
  com_corner_store_steps: corner('steps'),
  com_shops_apartments_hip: shops('hip'),
  com_shops_apartments_gables: shops('gables'),
  com_shops_apartments_terrace: shops('terrace'),
  com_office_block_steps: office('steps'),
  com_office_block_sawtooth: office('sawtooth'),
  com_office_block_vault: office('vault'),
};
