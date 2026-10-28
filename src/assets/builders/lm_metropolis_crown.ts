/**
 * Metropolis Crown: 4x4 civic showpiece, fluted setback tower and an open bronze coronet above a sky hall.
 * Broad eight-point crown / slender twelve-point crown. Budget <= 8000 tris; standard tower LOD and night windows.
 */
import { ModelBuilder, type Paint } from '../ModelBuilder';
import type { ModelBuilders } from '../registry';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { type P2, type V3, type ProfPt, lathe, lotModels, rect, annulus, disc, tree, lamp, parkBench, GRASS_LUSH } from './park_lib';
import { beacon, prismEdges } from './lm_lib';

const TAU = Math.PI * 2;
const P = (color: number, surf: Surf = Surf.Plain, pattern = 0, floor = 4): Paint => ({ color, surf, pattern, floor });

function chamfer(hx: number, hz: number, c: number): P2[] {
  return [[hx, -hz + c], [hx, hz - c], [hx - c, hz], [-hx + c, hz], [-hx, hz - c], [-hx, -hz + c], [-hx + c, -hz], [hx - c, -hz]];
}

/** Open pointed arches splay out from the sky hall; the empty spaces between them remain part of the silhouette. */
function coronet(b: ModelBuilder, y: number, v: number, bronze: Paint): void {
  const n = v === 0 ? 8 : 12, r = v === 0 ? 19 : 21;
  const glass = P(0x6a9798, Surf.GlassCurtain, 1), roof = P(0x546a65, Surf.RoofFlat);
  const prof: ProfPt[] = [
    [11, y - 4, bronze], [15, y - 0.8], [15, y, glass], [15, y + 12, bronze],
    [16.5, y + 13], [16.5, y + 15, P(0xb3935e, Surf.Emissive, 10)],
    [16.5, y + 16, bronze], [14.5, y + 17, roof], [0, y + 17],
  ];
  lathe(b, 0, 0, prof, 24, 25);
  // Recessed lantern stays below the points, leaving an open crown rather than a filled conical roof.
  b.paint(bronze).prism(0, 0, 6.5, 8, y + 17, 3, Math.PI / 8, { top: false });
  b.paint(glass).prism(0, 0, 6.5, 8, y + 20, 20, Math.PI / 8, { topPaint: bronze });
  b.paint(bronze).prism(0, 0, 7, 8, y + 40, 1.2, Math.PI / 8, { topPaint: roof });
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + Math.PI / n, da = Math.PI / n;
    const tipY = y + (v === 1 && i % 2 ? 64 : 80);
    const at = (ang: number, rad: number, h: number): V3 => [Math.cos(ang) * rad, h, Math.sin(ang) * rad];
    const left = at(a - da, 15.8, y + 17), tip = at(a, r, tipY), right = at(a + da, 15.8, y + 17);
    b.paint(bronze).beam(left, tip, 1.35).beam(tip, right, 1.35);
    b.beam(at(a, 14.8, y), at(a, 14.8, y + 12), 0.42);
    // A second inner chevron and short ties make the golden blades read as structure from close viewpoints.
    const inner = at(a, r - 1.8, tipY - 10);
    b.beam(at(a - da, 14.4, y + 17), inner, 0.55).beam(inner, at(a + da, 14.4, y + 17), 0.55);
    b.beam(inner, tip, 0.7);
    // Gold night-only light (x2) on the outer face of every blade, 1 m wide so the coronet reads from the city camera.
    b.paint(0xc9a05a, Surf.Emissive, 11);
    b.beam(at(a - da, 16.4, y + 18), at(a, r + 0.7, tipY - 1), 1.0);
    b.beam(at(a, r + 0.7, tipY - 1), at(a + da, 16.4, y + 18), 1.0);
    if (i % (v === 0 ? 2 : 3) === 0) beacon(b, Math.cos(a) * r, tipY, Math.sin(a) * r, 0.4);
  }
  // An open annular belt ties the crown feet; unlike a solid disk, it does not fill the space around the lantern.
  b.paint(bronze);
  lathe(b, 0, 0, [[16, y + 23], [16, y + 24.2], [15.4, y + 24.2], [15.4, y + 23], [16, y + 23]], 24, 25);
}

function metropolisCrown(b: ModelBuilder, v: number, rng: RNG): void {
  const E = 32, plaza = 0xc6bda9;
  const bronze = P(v === 0 ? 0xb9a06a : 0xc8b78d, Surf.Metal);
  const stone = P(0xc7baa0, Surf.Stone, 1, 40), roof = P(0x7d8277, Surf.RoofFlat);
  const windows = P(0xc3b599, Surf.WallWindows, 5), glass = P(0x739c9c, Surf.GlassCurtain, 1);
  b.paint(plaza, Surf.Pavement).slab(-E, -E, E, E, 0.1);
  b.paint(0x9c9077, Surf.Pavement);
  for (const x of [-9, 9]) rect(b, x - 0.3, 23, x + 0.3, E, 0.115);
  annulus(b, 0, 27, 0.12, 2.5, 3.1, 24);
  b.paint(0xb2a17c, Surf.Pavement);
  disc(b, 0, 27, 0.125, 1.4, 12);

  // Ceremonial hall and wide front stair, with a level approach around either end of the plinth.
  b.paint(stone).box(-24, 0.1, -24, 24, 1.2, 23);
  for (let i = 0; i < 4; i++) b.box(-7.5, 0.1, 23 + i * 0.65, 7.5, 1.2 - i * 0.275, 23.65 + i * 0.65);
  b.paint(0x7c9696, Surf.GlassPlain, 2).box(-22.5, 1.2, -22.5, 22.5, 12, 21, { top: null });
  b.paint(stone);
  for (const x of [-21, -15, -9, 9, 15, 21]) b.box(x - 0.45, 1.2, 21, x + 0.45, 12, 22);
  b.box(-23, 12, -23, 23, 15.6, 22.5, { top: roof });
  b.paint(bronze).box(-23.3, 15.6, -23.3, 23.3, 16, 22.8, { top: roof });
  b.paint(0x314b4e, Surf.GlassPlain, 0).box(-5, 1.2, 21.01, 5, 6.8, 21.08);
  b.paint(bronze).box(-7.5, 7.2, 21, 7.5, 7.8, 24, { bottom: bronze });
  // Small crown above the doors echoes the skyline silhouette.
  b.paint(stone).box(-4.2, 8.2, 21, 4.2, 12, 22.55);
  for (let i = -2; i <= 2; i++) {
    b.paint(bronze).beam([i * 1.4, 9, 22.7], [i * 1.7, 10.8 + (i === 0 ? 0.8 : 0), 22.7], 0.28);
  }
  b.paint(bronze).box(-3.2, 8.8, 22.5, 3.2, 9.2, 22.9);

  const tiers: [number, number, number, number][] = v === 0
    ? [[16, 176, 21, 6], [176, 344, 18, 4.5], [344, 480, 15, 4.5], [480, 528, 12, 3]]
    : [[16, 200, 19.5, 4.5], [200, 376, 16.5, 4.5], [376, 516, 13.5, 3], [516, 568, 10.5, 3]];
  for (let ti = 0; ti < tiers.length; ti++) {
    const [y0, y1, h, cut] = tiers[ti], hz = h - (v === 0 ? 0 : 3);
    const poly = chamfer(h, hz, cut);
    prismEdges(b, poly, y0, y1, (i) => (i + v) % 2 ? glass : windows, roof);
    // Fluted bronze piers and two stone ribs per face distinguish the civic tower from the glass Millennium.
    b.paint(bronze);
    for (const [x, z] of poly) {
      b.beam([x * 1.012, y0, z * 1.012], [x * 1.012, y1 + 2.4, z * 1.012], 0.9);
    }
    // The ribs stay 1.5 m clear of the chamfer corners (the piers stand there) and stop under the bronze band, so
    // neither their caps nor their faces meet the band caps or the pier faces.
    b.paint(stone);
    const ux = Math.min(4.5, h - cut - 1.5), uz = Math.min(4.5, hz - cut - 1.5);
    for (const s of [-1, 1]) for (const k of [-1, 1]) {
      b.box(k * ux - 0.4, y0, s * hz - 0.5, k * ux + 0.4, y1 - 2.0, s * hz + 0.5);
      b.box(s * h - 0.5, y0, k * uz - 0.4, s * h + 0.5, y1 - 2.0, k * uz + 0.4);
    }
    prismEdges(b, chamfer(h + 0.6, hz + 0.6, cut), y1 - 2.0, y1 - 0.8, () => bronze, roof);
    prismEdges(b, chamfer(h + 0.3, hz + 0.3, cut), y1 - 0.8, y1, () => stone, roof);
    if (ti < tiers.length - 1) {
      b.paint(0x4e6944, Surf.Foliage);
      for (const s of [-1, 1]) b.box(s * (h - 1.1) - 0.4, y1, -hz + cut + 1, s * (h - 1.1) + 0.4, y1 + 0.8, hz - cut - 1);
    }
  }
  coronet(b, v === 0 ? 528 : 568, v, bronze);

  // Formal gardens, quiet pools and flags face the street; no dressing extends past the 64 m lot.
  for (const s of [-1, 1]) {
    const x0 = s * 17.5 - 6, x1 = s * 17.5 + 6;
    b.paint(stone).box(x0, 0.1, 25, x1, 0.35, 29.5);
    b.box(x0, 0.35, 25, x1, 0.55, 25.5).box(x0, 0.35, 29, x1, 0.55, 29.5);
    b.box(x0, 0.35, 25.5, x0 + 0.5, 0.55, 29).box(x1 - 0.5, 0.35, 25.5, x1, 0.55, 29);
    b.paint(0x60999d, Surf.Water);
    rect(b, s * 17.5 - 5.5, 25.5, s * 17.5 + 5.5, 29, 0.5);
    b.paint(stone).box(s * 27 - 2, 0.1, -25, s * 27 + 2, 0.55, 15);
    b.paint(GRASS_LUSH, Surf.Foliage).slab(s * 27 - 1.7, -24.7, s * 27 + 1.7, 14.7, 0.08, 0.55);
    b.push().translate(0, 0.63, 0);
    for (const z of [-21, -6, 10]) tree(b, rng, s * 27, z, 0.65, 'cone');
    b.pop();
    for (const z of [-14, 2]) parkBench(b, s * 30, z, s * Math.PI / 2);
    for (const z of [-28.5, 22]) lamp(b, s * 28, z, 4.6, 0);
    b.paint(bronze).cylinder(s * 9.5, 27, 0.1, 8.5, 0.11, 0.07, 6);
    b.paint(v === 0 ? 0x355e79 : 0x875d45, Surf.Plain);
    b.quad2([s * 9.5, 8.4, 27], [s * 11.8, 8.1, 27.15], [s * 11.8, 6.7, 27.15], [s * 9.5, 7, 27]);
  }
}

export const models: ModelBuilders = lotModels({ lm_metropolis_crown: metropolisCrown });
