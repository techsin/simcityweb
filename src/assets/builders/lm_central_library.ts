/**
 * Central Library (3x3): columned entrance, reading-room crown and two stack wings.
 * Limestone / copper dome or brick / octagonal lantern. Full model <= 8000 tris;
 * the renderer generates the distant massing proxy, as for the existing landmark towers.
 */
import { ModelBuilder, type Paint } from '../ModelBuilder';
import type { ModelBuilders } from '../registry';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { lathe, lotModels, tree, lamp, parkBench, person, rect, rectPoly, type P2, type ProfPt } from './park_lib';
import { archFrameZ, openingZ, polyZ, roundArch } from './lm_lib';

const TAU = Math.PI * 2;
const P = (color: number, surf: Surf = Surf.Plain, pattern = 0, floor = 3.3): Paint => ({ color, surf, pattern, floor });

function centralLibrary(b: ModelBuilder, v: number, rng: RNG): void {
  const stone = v === 0 ? 0xd5cbb7 : 0xba8065, trim = v === 0 ? 0xe7decb : 0xe1cdb1;
  const roof = v === 0 ? 0x52796d : 0x4a5765, pave = 0xc8c1b2;
  const lit = P(trim, Surf.Stone, 1, 26), wingH = v === 0 ? 16 : 20;
  b.paint(pave, Surf.Pavement).slab(-24, -24, 24, 24, 0.1);
  b.paint(0xa59c8b, Surf.Pavement);
  for (const x of [-12, 0, 12]) rect(b, x - 0.25, 20.8, x + 0.25, 24, 0.115);
  // Stack wings: civic windows on 3.2 m bays and 4 m floors, kept on the model-origin grid.
  b.paint(0xb1a38d, Surf.Stone).box(-19.8, 0.1, -19.8, 19.8, 2.4, 10.2);
  for (const s of [-1, 1]) {
    const x = s * 14.4;
    b.paint(stone, Surf.WallWindows, 7, 4).box(x - 4.8, 4, -19.2, x + 4.8, wingH, 9.6, { top: null });
    b.paint(lit).box(x - 4.8, 2.4, -19.2, x + 4.8, 4, 9.6);
    b.box(x - 5.1, wingH, -19.5, x + 5.1, wingH + 0.6, 9.9);
    b.paint(roof, Surf.RoofTiles);
    if (v === 0) b.hipRoof(x, -4.8, 10.2, 29.4, wingH + 0.6, 3.2, 0.2);
    else b.gableRoof(x, -4.8, 10.2, 29.4, wingH + 0.6, 4.2, 'z', 0.2, lit);
    b.paint(trim, Surf.Stone);
    for (const z of [-19.2, -12.8, -6.4, 0, 9.6]) {
      b.box(s * 19.2 - 0.2, 2.4, z - 0.3, s * 19.2 + 0.2, wingH, z + 0.3);
    }
    b.paint(0xb9aa92, Surf.Stone).box(x - 4.9, 8, -19.3, x + 4.9, 8.35, 9.7);
    // Raised skylights cap the wing ridges.
    b.paint(roof, Surf.Metal, 3).box(x - 1.2, wingH + 2.6, -12, x + 1.2, wingH + 3.8, 1.6);
    b.paint(0x76908d, Surf.GlassPlain, 2).box(x - 1.2, wingH + 3.8, -12, x + 1.2, wingH + 5.0, 1.6, { top: null });
    b.paint(roof, Surf.Metal, 3).box(x - 1.4, wingH + 5.0, -12.2, x + 1.4, wingH + 5.3, 1.8);
    for (const z of [-12, -8.6, -5.2, -1.8, 1.6]) {
      b.paint(trim, Surf.Metal).box(x - 1.25, wingH + 3.8, z - 0.06, x + 1.25, wingH + 5.0, z + 0.06, { top: null });
    }
  }
  b.paint(stone, Surf.WallWindows, 7, 4).box(-9.6, 4, -19.2, 9.6, wingH, -9.6, { top: P(roof, Surf.RoofFlat) });
  b.paint(lit).box(-9.6, 2.4, -19.2, 9.6, 4, -9.6);
  b.box(-9.9, wingH, -19.5, 9.9, wingH + 0.6, -9.3);
  // Reading room, deep portico and a broad staircase facing +Z.
  b.paint(stone, Surf.WallWindows, 7, 5).box(-9.6, 5, -9.6, 9.6, 20, 9.6, { pz: lit, top: P(roof, Surf.RoofFlat) });
  b.paint(lit).box(-9.6, 2.4, -9.6, 9.6, 5, 9.6);
  b.box(-10, 20, -10, 10, 20.8, 10);
  b.paint(0xb9ac95, Surf.Stone).box(-10.8, 0.1, 10.2, 10.8, 2.4, 15.8, { nz: null });
  for (let i = 0; i < 8; i++) {
    const z = 15.8 + i * 0.6;
    b.paint(trim, Surf.Stone).box(-10.8, 0.1, z, 10.8, 2.4 - i * 0.28, z + 0.6, { nz: null });
  }
  for (const x of [-6.4, 0, 6.4]) {
    const arch = roundArch(x, 3.4, 9.2, 8, 2.4);
    openingZ(b, arch, 9.6, 1, 0x4c6570, Surf.GlassPlain, 2);
    archFrameZ(b, arch, 9.6, 1, 0.35, 0.25, lit);
    b.paint(0x746042, Surf.Metal).box(x - 0.06, 2.4, 9.64, x + 0.06, 10.6, 9.75);
    b.box(x - 1.6, 6.2, 9.64, x + 1.6, 6.32, 9.75);
  }
  for (const x of [-8, -4.8, -1.6, 1.6, 4.8, 8]) {
    b.paint(lit).box(x - 0.65, 2.4, 13.8, x + 0.65, 3, 15.1);
    lathe(b, x, 14.45, [[0.55, 3], [0.48, 3.4], [0.43, 12.6], [0.62, 12.8], [0.62, 13.3]], 10);
    b.box(x - 0.72, 13.3, 13.73, x + 0.72, 13.8, 15.17);
  }
  b.paint(lit).box(-10.4, 13.8, 9.6, 10.4, 15.1, 15.5);
  b.paint(trim, Surf.Stone).gableRoof(0, 12.5, 21.6, 6.4, 15.1, 4.6, 'z', 0.15, lit);
  // Open-book relief in the tympanum: pale floodlit pages with text lines on a dark cover and spine.
  b.paint(0x4a3526, Surf.Plain);
  polyZ(b, [[-2.4, 15.92], [0, 15.5], [2.4, 15.92], [2.4, 18.2], [0, 17.82], [-2.4, 18.2]], 15.84);
  b.paint(P(0xefe7d4, Surf.Plain, 1, 26));
  polyZ(b, [[-2.2, 16.1], [0, 15.7], [0, 17.7], [-2.2, 18]], 15.88);
  polyZ(b, [[0, 15.7], [2.2, 16.1], [2.2, 18], [0, 17.7]], 15.88);
  b.paint(0x6b5a48, Surf.Plain);
  for (const s of [-1, 1]) for (const c of [16.2, 16.7, 17.2]) {
    // lines follow the pages' slope (they rise 0.4 m over the 2.2 m page width, away from the spine)
    const at = (a: number, dy: number): P2 => [s * a, c + 0.1818 * a + dy];
    polyZ(b, [at(0.25, -0.06), at(1.95, -0.06), at(1.95, 0.06), at(0.25, 0.06)], 15.91);
  }
  b.box(-0.1, 15.55, 15.84, 0.1, 17.85, 15.93, { nz: null });
  b.paint(trim, Surf.Stone);
  for (let i = -9; i <= 9; i++) b.box(i * 1.05 - 0.18, 14.65, 15.5, i * 1.05 + 0.18, 15.15, 15.8);
  // Variant silhouettes: rounded copper dome versus a taller octagonal glazed lantern.
  const seg = v === 0 ? 24 : 8, cz = -1.8;
  const drum: ProfPt[] = [
    [8.5, 20.8, lit], [8.5, 21.6, P(0x6c8d8a, Surf.GlassPlain, 2)],
    [8.1, v === 0 ? 25 : 28, lit], [8.7, v === 0 ? 25.4 : 28.4],
  ];
  lathe(b, 0, cz, drum, seg);
  const base = v === 0 ? 25.4 : 28.4;
  b.paint(roof, Surf.Metal, 3);
  const cap: ProfPt[] = v === 0
    ? [[8.7, base], [8.5, 27.2], [7.4, 29.7], [5.4, 32], [2.4, 33.6], [0.65, 34], [0, 34.2]]
    : [[8.7, base], [8.7, 29.1], [3.4, 34.2], [1.2, 34.6], [1.2, 35.3], [0, 36.2]];
  lathe(b, 0, cz, cap, seg);
  for (let k = 0; k < seg; k += v === 0 ? 2 : 1) {
    const a = (k / seg) * TAU;
    b.paint(trim, Surf.Stone).beam([Math.cos(a) * 8.45, 21.6, cz + Math.sin(a) * 8.45], [Math.cos(a) * 8.1, base - 0.4, cz + Math.sin(a) * 8.1], 0.25);
    b.paint(0x93a48b, Surf.Metal, 3);
    for (let j = 0; j < cap.length - 2; j++) {
      b.beam([Math.cos(a) * (cap[j][0] + 0.04), cap[j][1] + 0.06, cz + Math.sin(a) * (cap[j][0] + 0.04)],
        [Math.cos(a) * (cap[j + 1][0] + 0.04), cap[j + 1][1] + 0.06, cz + Math.sin(a) * (cap[j + 1][0] + 0.04)], 0.14);
    }
  }
  const top = v === 0 ? 34.2 : 36.2;
  b.paint(0xb89a55, Surf.Metal).cylinder(0, cz, top, 1.3, 0.12, 0.04, 6);
  // Reading gardens stay clear of the entrance and stair run.
  for (const s of [-1, 1]) {
    b.paint(0xa69b87, Surf.Stone).box(s * 16 - 3.8, 0.1, 13.2, s * 16 + 3.8, 0.45, 20.2);
    b.paint(0x6f944b, Surf.Foliage).box(s * 16 - 3.4, 0.45, 13.6, s * 16 + 3.4, 0.55, 19.8);
    tree(b, rng, s * 17, 16, 0.65, v === 0 ? 'round' : 'cherry');
    parkBench(b, s * 16, 21.1, Math.PI);
    lamp(b, s * 11.8, 22, 4.2, 0, [
      { color: pave, y: 0.1, dy: 0.03, clip: [rectPoly(-24, 20.7, 24, 24)] },
      { color: 0xa59c8b, y: 0.115, dy: 0.03, clip: [-12, 0, 12].map((x) => rectPoly(x - 0.25, 20.8, x + 0.25, 24)) },
    ]);
  }
  for (const [x, z] of [[-5, 21.5], [4, 22.2], [7, 20.8], [-21.5, 6]] as P2[]) person(b, rng, x, z, 0.1, rng.range(0, TAU));
}

export const models: ModelBuilders = lotModels({ lm_central_library: centralLibrary });
