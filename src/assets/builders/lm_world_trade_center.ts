/** World Trade Center: silver twin slabs or staggered teal towers above an exchange plaza. 4x4, <= 8000 tris. */
import { ModelBuilder, type Paint } from '../ModelBuilder';
import type { ModelBuilders } from '../registry';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { type P2, disc, lamp, lotModels, parkBench, person, rect, rectPoly, tree, tube } from './park_lib';
import { beacon, prismEdges } from './lm_lib';

const TAU = Math.PI * 2;
const P = (color: number, surf: Surf = Surf.Plain, pattern = 0, floor = 4): Paint => ({ color, surf, pattern, floor });

function plan(x: number, z: number, h: number, cut: number): P2[] {
  const pts: P2[] = cut === 0 ? [[h, -h], [h, h], [-h, h], [-h, -h]] : [
    [h, -h + cut], [h, h - cut], [h - cut, h], [-h + cut, h], [-h, h - cut], [-h, -h + cut], [-h + cut, -h], [h - cut, -h],
  ];
  return pts.map(([px, pz]) => [x + px, z + pz]);
}

function officeTower(b: ModelBuilder, x: number, z: number, height: number, stepped: boolean, mast: boolean): void {
  const steel = 0xcbd0d2, dark = 0x404c53, cut = stepped ? 1.5 : 0;
  const glass = P(stepped ? 0x72969d : 0x929eaa, Surf.GlassCurtain, stepped ? 1 : 4);
  const sections: [number, number, number][] = stepped
    ? [[24, height * 0.4, 10.5], [height * 0.4, height * 0.4 + 120, 9], [height * 0.4 + 120, height, 7.5]]
    : [[24, height, 10.5]];
  // Every wall edge lies on the shared 1.5 m panel grid; office floors stay on the 4 m grid through setbacks.
  for (let i = 0; i < sections.length; i++) {
    const [rawY0, rawY1, half] = sections[i], y0 = Math.round(rawY0 / 4) * 4, y1 = Math.round(rawY1 / 4) * 4;
    // (no cap: the steel coping drawn after the ribs caps the section with its flat roof)
    prismEdges(b, plan(x, z, half, cut), y0, y1, () => glass, null);
    b.paint(steel, Surf.Metal);
    for (let side = 0; side < 4; side++) {
      b.push().translate(x, 0, z).rotateY(side * Math.PI / 2);
      const end = half - cut - 1.5;
      for (let px = -end; px <= end; px += 1.5) b.box(px - 0.13, y0, half, px + 0.13, y1, half + 0.28, { top: null, nz: null });
      b.pop();
    }
    for (const [px, pz] of plan(x, z, half, cut)) b.box(px - 0.22, y0, pz - 0.22, px + 0.22, y1, pz + 0.22, { top: null });
    // Steel coping whose cap is the section's flat roof: one cap at y1, so the roof cannot z-fight a second one.
    prismEdges(b, plan(x, z, half + 0.35, cut), y1 - 0.8, y1, () => P(steel, Surf.Metal), P(0x858d8d, Surf.RoofFlat));
    if (i > 0) {
      // Low planting beds on the exposed setback roof, with their tops marked as low foliage.
      b.paint(0x57764a, Surf.Foliage, 4, -1);
      for (const s of [-1, 1]) b.box(x - half + 1.5, y0 + 0.05, z + s * (half + 0.9) - 0.28, x + half - 1.5, y0 + 0.45, z + s * (half + 0.9) + 0.28);
    }
  }
  // Recessed service floors interrupt the glazing and rib rhythm, as on large office buildings.
  for (const y of stepped ? [Math.round(height * 0.4 / 4) * 4 - 4, Math.round((height * 0.4 + 120) / 4) * 4 - 4] : [112, 224]) {
    const half = stepped && y > height * 0.4 ? 9 : 10.5;
    prismEdges(b, plan(x, z, half + 0.4, cut), y, y + 4, () => P(dark, Surf.Metal), null);
    for (const yy of [y, y + 1.3, y + 2.6, y + 3.8]) prismEdges(b, plan(x, z, half + 0.44, cut), yy, yy + 0.15, () => P(steel, Surf.Metal), null);
  }
  // Branching columns around the sky lobby stand above the podium, supporting the fine facade ribs.
  for (let side = 0; side < 4; side++) {
    b.push().translate(x, 0, z).rotateY(side * Math.PI / 2);
    b.paint(0x748a94, Surf.GlassPlain, 2).box(-10.5, 12.2, 10.3, 10.5, 24, 10.5, { top: null, nz: null });
    b.paint(steel, Surf.Metal);
    for (const px of [-7.5, 0, 7.5]) {
      b.box(px - 0.35, 12.2, 10.5, px + 0.35, 18, 11.1);
      for (const dx of [-1.5, 0, 1.5]) b.beam([px, 18, 10.8], [px + dx, 24, 10.8], 0.38);
    }
    b.pop();
  }
  const half = stepped ? 7.5 : 10.5;
  prismEdges(b, plan(x, z, half + 0.25, cut), height - 4, height - 0.8, () => P(dark, Surf.Corrugated), null);
  // Night-only crown light (x2, 1.6 m) under the coping, clear of the ribs: each tower top reads as a lit ring at night.
  prismEdges(b, plan(x, z, half + 0.4, cut), height - 2.8, height - 1.2, () => P(0xa8c4d8, Surf.Emissive, 11), null);
  b.paint(dark, Surf.Corrugated).box(x - 3, height, z - 3, x + 3, height + 3.2, z + 3, { top: P(steel, Surf.RoofFlat) });
  if (mast) {
    b.paint(steel, Surf.Metal).cylinder(x, z, height + 3.2, 2.8, 1.5, 0.85, 8);
    // The white bands of the mast are night-only lit, so at night it reads as a lit dashed line above the roof.
    for (let i = 0; i < 5; i++) {
      if (i % 2) b.paint(0xa95142, Surf.Metal);
      else b.paint(0xd3d5d2, Surf.Emissive, 10);
      b.cylinder(x, z, height + 6 + i * 8, 8, 0.85 - i * 0.13, 0.72 - i * 0.13, 6);
    }
    b.paint(steel, Surf.Metal).cylinder(x, z, height + 46, 8, 0.2, 0.05, 6);
    beacon(b, x, height + 54, z, 0.45);
  } else {
    for (const s of [-1, 1]) beacon(b, x + s * (half - 0.5), height + 0.1, z - half + 0.5, 0.4);
  }
}

function worldTradeCenter(b: ModelBuilder, v: number, rng: RNG): void {
  const E = 32, pave = v === 0 ? 0xc6c3bb : 0xc1c6c4;
  b.paint(pave, Surf.Pavement).slab(-E, -E, E, E, 0.1);
  b.paint(0xa8aaa7, Surf.Pavement);
  for (const x of [-27, -9, 9, 27]) rect(b, x - 0.2, 18, x + 0.2, E, 0.115);
  // Retail / conference podium, roof terrace and the main entrance facing the street (+Z).
  b.paint(0x7d929c, Surf.GlassPlain, 2).box(-28.5, 0.1, -24, 28.5, 8, 16.5);
  b.paint(0xb9b8ae, Surf.WallWindows, 5, 4).box(-28.5, 8, -24, 28.5, 12, 16.5, { top: P(0xa7aaa1, Surf.RoofFlat) });
  b.paint(0xd0d2cc, Surf.Stone).box(-28.8, 11.6, -24.3, 28.8, 12.2, 16.8);
  b.paint(0x52704b, Surf.Foliage, 4, -1).box(-24, 12.2, -23, 24, 12.6, -21.8);
  b.paint(0xd0d2cc, Surf.Stone);
  for (let x = -24; x <= 24; x += 6) b.box(x - 0.22, 0.1, 16.5, x + 0.22, 11.6, 16.8);
  b.paint(0xcbd0d2, Surf.Metal).box(-6, 6.4, 16.5, 6, 7, 21, { bottom: P(0x897e69, Surf.Emissive, 10), nz: null });
  for (const x of [-5.5, 5.5]) b.paint(0xcbd0d2, Surf.Metal).box(x - 0.16, 0.1, 20, x + 0.16, 6.4, 20.32);
  if (v === 0) {
    officeTower(b, -15, -6, 336, false, true);
    officeTower(b, 15, -6, 336, false, false);
  } else {
    officeTower(b, -13.5, -10.5, 360, true, true);
    officeTower(b, 13.5, 3, 312, true, false);
  }
  // Bronze globe in a reflecting basin marks the trading plaza; three open rings keep the silhouette light.
  b.paint(0x9f9e97, Surf.Stone);
  tube(b, 16, 25, 0.1, 0.55, 4.4, 4.05, 24);
  b.paint(0x3c7186, Surf.Water);
  disc(b, 16, 25, 0.38, 4.05, 24);
  b.paint(0x9f9e97, Surf.Stone).cylinder(16, 25, 0.38, 1.45, 0.9, 0.7, 10);
  b.push().translate(16, 4.1, 25).rotateZ(0.35);
  b.paint(0xb69655, Surf.Metal, 3).ring(0, 0, 0, 2.35, 0.16, 24, 'xy');
  b.rotateY(Math.PI / 2).ring(0, 0, 0, 2.35, 0.16, 24, 'xy');
  b.ring(0, 0, 0, 2.35, 0.16, 24);
  b.pop();
  for (let i = 0; i < 5; i++) {
    const x = -24 + i * 3.5;
    b.paint(0xcbd0d2, Surf.Metal).cylinder(x, 22, 0.1, 9, 0.09, 0.06, 5);
    b.paint([0x3b69a0, 0xb85745, 0xe0c16b, 0x4d8567, 0xe1ded0][(i + v) % 5], Surf.Plain)
      .quad2([x, 8.9, 22], [x + 2.2, 8.7, 22.25], [x + 2.2, 7.4, 22.25], [x, 7.6, 22]);
  }
  for (const s of [-1, 1]) {
    tree(b, rng, s * 28.5, -28, 0.85, 'cone');
    b.paint(0x9f9e97, Surf.Stone).box(s * 27 - 2, 0.1, 25, s * 27 + 2, 0.45, 29);
    b.paint(0x5c7b4e, Surf.Foliage).box(s * 27 - 1.8, 0.45, 25.2, s * 27 + 1.8, 0.5, 28.8);
    b.push().translate(0, 0.5, 0);
    tree(b, rng, s * 27, 27, 0.65, 'round');
    b.pop();
    lamp(b, s * 5, 28.5, 4.5, 2, [{ color: pave, y: 0.1, dy: 0.03, clip: [rectPoly(-8.7, 21, 8.7, E)] }]);
  }
  for (const x of [-23, -17, -11]) parkBench(b, x, 29.5);
  for (let i = 0; i < 6; i++) person(b, rng, rng.range(-3.5, 7), rng.range(22, 30.5), 0.1, rng.range(0, TAU));
}

// The renderer supplies LOD 1 via its shared massing proxy; curtain surfaces preserve office night windows there.
export const models: ModelBuilders = lotModels({ lm_world_trade_center: worldTradeCenter });
