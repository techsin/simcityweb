/**
 * Millennium Tower: 4x4 visitor landmark, stepped glass shaft, panoramic sky decks and a silver needle.
 * Two silhouettes: blue glass with one halo, silver glass with paired decks. Budget <= 8000 tris.
 * LOD proxies and night-window detail use the same renderer / shared material as lm_towers.ts.
 */
import { ModelBuilder, type Paint } from '../ModelBuilder';
import type { ModelBuilders } from '../registry';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { type P2, type ProfPt, lathe, lotModels, rect, tree, lamp, parkBench, GRASS_LUSH } from './park_lib';
import { beacon, prismEdges } from './lm_lib';

const TAU = Math.PI * 2;
const P = (color: number, surf: Surf = Surf.Plain, pattern = 0, floor = 4): Paint => ({ color, surf, pattern, floor });

function chamfer(hx: number, hz: number, c: number): P2[] {
  return [[hx, -hz + c], [hx, hz - c], [hx - c, hz], [-hx + c, hz], [-hx, hz - c], [-hx, -hz + c], [-hx + c, -hz], [hx - c, -hz]];
}

/** Panoramic gallery: flared silver soffit, two glazed floors, an overhanging rim and radial roof ribs. */
function skyDeck(b: ModelBuilder, y: number, r: number, tint: number): void {
  const metal = P(0xd4d9dc, Surf.Metal), glass = P(0x849eaf, Surf.GlassCurtain, tint);
  const prof: ProfPt[] = [
    [r * 0.57, y - 8, metal], [r, y - 0.8], [r, y, glass], [r, y + 8, metal],
    [r + 1.2, y + 8.6], [r + 1.2, y + 9.4, P(0x91a8b6, Surf.Emissive, 10)],
    [r + 1.2, y + 10.0, metal], [r - 0.5, y + 10.6], [r * 0.48, y + 14], [0, y + 14],
  ];
  lathe(b, 0, 0, prof, 24, 28);
  b.paint(metal);
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * TAU, c = Math.cos(a), s = Math.sin(a);
    b.beam([c * (r + 0.08), y, s * (r + 0.08)], [c * (r + 0.08), y + 8, s * (r + 0.08)], 0.22);
    if (i % 2 === 0) b.beam([c * (r + 0.1), y + 10.4, s * (r + 0.1)], [c * r * 0.48, y + 14.2, s * r * 0.48], 0.28);
  }
}

function millenniumTower(b: ModelBuilder, v: number, rng: RNG): void {
  const E = 32, tint = v === 0 ? 5 : 4;
  const plaza = 0xc2c3bb, silver = P(0xcbd2d8, Surf.Metal), roof = P(0x828f92, Surf.RoofFlat);
  const glass = P(0x8ba8be, Surf.GlassCurtain, tint), corner = P(0x6c8d9f, Surf.GlassCurtain, 0);
  b.paint(plaza, Surf.Pavement).slab(-E, -E, E, E, 0.1);
  b.paint(0x8d9b9f, Surf.Pavement);
  for (const x of [-8, 8]) rect(b, x - 0.25, 22.5, x + 0.25, E, 0.115);
  for (const z of [-28.5, 29.5]) rect(b, -30, z, 30, z + 0.35, 0.115);

  // Low podium and a sheltered +Z entrance; the central approach stays clear between the reflecting pools.
  b.paint(0xa4adb0, Surf.Stone, 2, 24).box(-24, 0.1, -25.5, 24, 4, 21);
  b.paint(0x8299a8, Surf.GlassPlain, 2).box(-24, 4, -25.5, 24, 12, 21, { top: null });
  b.paint(silver).box(-24.5, 12, -26, 24.5, 13, 21.5, { top: roof });
  b.paint(0xadb8bc, Surf.Stone).box(-21, 13, -22.5, 21, 16, 18, { top: roof });
  b.paint(silver);
  for (let x = -21; x <= 21; x += 6) b.box(x - 0.18, 4, 21, x + 0.18, 12, 21.2);
  b.box(-8, 4.8, 20.8, 8, 5.4, 25.5, { bottom: silver });
  for (const x of [-7.5, 7.5]) b.box(x - 0.18, 0.1, 24.5, x + 0.18, 4.8, 24.85);
  b.paint(0x344956, Surf.GlassPlain, 0).box(-5, 0.1, 21.01, 5, 4.8, 21.08, { nz: null });
  b.paint(0x8ca3ab, Surf.Emissive, 10).box(-7.6, 4.85, 25.5, 7.6, 5.1, 25.56);

  // All main facade edges follow 1.5 m curtain panels; setbacks and floor bases follow the 4 m floor grid.
  const tiers: [number, number, number, number][] = v === 0
    ? [[16, 144, 18, 4.5], [144, 268, 15, 4.5], [268, 372, 12, 3], [372, 432, 9, 3]]
    : [[16, 160, 19.5, 6], [160, 296, 16.5, 4.5], [296, 408, 12, 3], [408, 468, 7.5, 3]];
  for (let ti = 0; ti < tiers.length; ti++) {
    const [y0, y1, h, cut] = tiers[ti], hz = h - (v === 1 ? 1.5 : 0);
    const poly = chamfer(h, hz, cut);
    prismEdges(b, poly, y0, y1, (i) => i % 2 ? corner : glass, roof);
    b.paint(silver);
    for (const [x, z] of poly) {
      b.beam([x * 1.008, y0, z * 1.008], [x * 1.008, y1, z * 1.008], 0.6);
    }
    // Paired fins give the broad faces a vertical rhythm without modelling every window.
    for (const s of [-1, 1]) for (const side of [-1, 1]) {
      const ux = side * Math.min(6, h - cut - 1.5), uz = side * Math.min(6, hz - cut - 1.5);
      b.box(ux - 0.16, y0, s * hz - 0.3, ux + 0.16, y1, s * hz + 0.3, { top: null });
      b.box(s * h - 0.3, y0, uz - 0.16, s * h + 0.3, y1, uz + 0.16, { top: null });
    }
    prismEdges(b, chamfer(h + 0.45, hz + 0.45, cut), y1 - 1.2, y1, () => silver, roof);
    if (ti < tiers.length - 1) {
      const next = tiers[ti + 1][2], nz = next - (v === 1 ? 1.5 : 0);
      b.paint(0x53654f, Surf.Foliage).slab(-next + cut, hz - 1.5, next - cut, hz - 0.7, 0.45, y1);
      b.paint(0x53654f, Surf.Foliage).slab(-next + cut, -hz + 0.7, next - cut, -hz + 1.5, 0.45, y1);
      b.paint(silver);
      for (const s of [-1, 1]) {
        b.beam([s * (h - 0.3), y1 - 20, 0], [s * (next + 0.3), y1 + 12, 0], 0.85);
        b.beam([0, y1 - 20, s * (hz - 0.3)], [0, y1 + 12, s * (nz + 0.3)], 0.85);
      }
    }
  }

  const deckY = v === 0 ? 432 : 468;
  skyDeck(b, deckY, v === 0 ? 14 : 16, tint);
  if (v === 1) {
    b.paint(silver).prism(0, 0, 6, 8, deckY + 14, 2, Math.PI / 8, { top: false });
    b.paint(glass).prism(0, 0, 6, 8, deckY + 16, 28, Math.PI / 8, { topPaint: roof });
    skyDeck(b, 512, 10, tint);
  }
  const needleY = v === 0 ? 446 : 526, top = v === 0 ? 536 : 588;
  const needle: ProfPt[] = [
    [6.5, needleY, silver], [4.5, needleY + 12], [2.5, needleY + 24],
    [1.2, needleY + 28], [0.55, top - 10], [0.18, top], [0, top],
  ];
  lathe(b, 0, 0, needle, 12, 30);
  b.paint(silver);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + (v === 0 ? Math.PI / 4 : 0), c = Math.cos(a), s = Math.sin(a);
    b.beam([c * 7, needleY - 2, s * 7], [c * 2, needleY + 32, s * 2], 0.7);
  }
  beacon(b, 0, top - 0.4, 0, 0.4);

  // Reflecting pools, planted side courts and seating give the tourist landmark a pedestrian scale.
  for (const s of [-1, 1]) {
    const x0 = s * 17 - 6, x1 = s * 17 + 6;
    b.paint(0x8e9c9f, Surf.Stone).box(x0, 0.1, 24, x1, 0.3, 28.5);
    b.box(x0, 0.3, 24, x1, 0.45, 24.5).box(x0, 0.3, 28, x1, 0.45, 28.5);
    b.box(x0, 0.3, 24.5, x0 + 0.5, 0.45, 28).box(x1 - 0.5, 0.3, 24.5, x1, 0.45, 28);
    b.paint(0x5b9cae, Surf.Water);
    rect(b, s * 17 - 5.5, 24.5, s * 17 + 5.5, 28, 0.4);
    b.paint(0x8e9c9f, Surf.Stone).box(s * 27 - 2, 0.1, -24, s * 27 + 2, 0.5, 14);
    b.paint(GRASS_LUSH, Surf.Foliage).slab(s * 27 - 1.7, -23.7, s * 27 + 1.7, 13.7, 0.08, 0.5);
    b.push().translate(0, 0.58, 0);
    for (const z of [-20, 9]) tree(b, rng, s * 27, z, 0.6, v === 0 ? 'round' : 'poplar');
    b.pop();
    for (const z of [-8, 0]) parkBench(b, s * 30, z, s * Math.PI / 2);
    for (const z of [-28.5, 21]) lamp(b, s * 28, z, 4.2, 2);
  }
}

export const models: ModelBuilders = lotModels({ lm_millennium_tower: millenniumTower });
