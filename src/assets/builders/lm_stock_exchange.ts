/**
 * Stock Exchange (3x3): columned trading hall, bronze market frieze, stepped office
 * tower and bull sculpture. Limestone / stone tower or granite / bronze-glass tower.
 * Full model <= 8000 tris; distant LOD uses the renderer's existing massing proxy.
 */
import { ModelBuilder, type Paint } from '../ModelBuilder';
import type { ModelBuilders } from '../registry';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { lathe, lotModels, tree, lamp, parkBench, person, rect, rectPoly, type P2 } from './park_lib';
import { archFrameZ, openingZ, roundArch } from './lm_lib';

const TAU = Math.PI * 2;
const P = (color: number, surf: Surf = Surf.Plain, pattern = 0, floor = 3.3): Paint => ({ color, surf, pattern, floor });

/** Small bronze bull on the forecourt; +Z is its lowered head. */
function marketBull(b: ModelBuilder, x: number, z: number): void {
  b.paint(0x8c8b80, Surf.Stone).box(x - 1.9, 0.1, z - 2.4, x + 1.9, 0.55, z + 2.4);
  b.paint(0x6b795b, Surf.Metal, 3);
  b.box(x - 0.7, 1.5, z - 1.5, x + 0.7, 2.7, z + 0.7);
  b.box(x - 0.8, 1.8, z - 0.3, x + 0.8, 3.0, z + 0.6);
  b.beam([x, 2.4, z + 0.5], [x, 1.7, z + 1.5], 0.8);
  b.box(x - 0.5, 1.35, z + 1.2, x + 0.5, 2.1, z + 1.9);
  for (const sx of [-1, 1]) {
    for (const zz of [-1.1, 0.5]) b.beam([x + sx * 0.55, 1.7, z + zz], [x + sx * 0.7, 0.55, z + zz + 0.15], 0.24);
    b.beam([x + sx * 0.4, 2, z + 1.5], [x + sx * 1.1, 2.2, z + 1.4], 0.17);
    b.beam([x + sx * 1.1, 2.2, z + 1.4], [x + sx * 1.2, 2.65, z + 1.65], 0.12);
  }
  b.beam([x, 2.4, z - 1.4], [x + 0.7, 1.2, z - 1.9], 0.12);
}

function stockExchange(b: ModelBuilder, v: number, rng: RNG): void {
  const stone = v === 0 ? 0xcfc8b9 : 0x8e9694, trim = v === 0 ? 0xe2d9c4 : 0xc5c9bf;
  const bronze = v === 0 ? 0x8b7852 : 0xa18a59, pave = v === 0 ? 0xbdb6a8 : 0xaeb4b1;
  const lit = P(stone, Surf.Stone, 1, 25), edge = P(trim, Surf.Stone, 1, 25);
  b.paint(pave, Surf.Pavement).slab(-24, -24, 24, 24, 0.1);
  b.paint(0x878a83, Surf.Pavement);
  for (const x of [-12, -6, 0, 6, 12]) rect(b, x - 0.18, 21.5, x + 0.18, 24, 0.115);
  b.paint(0xa39c8e, Surf.Stone).box(-20, 0.1, -20, 20, 2, 10.4);
  // Tall civic windows light the trading floor; the office tiers use the tower window conventions.
  b.paint(lit).box(-19.2, 2, -19.2, 19.2, 8, 9.6, { top: null });
  // (the cornice box's cap is the hall roof: the hall box has no cap of its own under it)
  b.paint(stone, Surf.WallWindows, 7, 8).box(-19.2, 8, -19.2, 19.2, 16, 9.6, { pz: lit, top: null });
  b.paint(edge).box(-19.7, 16, -19.7, 19.7, 17, 10.1);
  for (const s of [-1, 1]) {
    b.paint(edge);
    for (const z of [-19.2, -12.8, -6.4, 0, 9.6]) b.box(s * 19.2 - 0.22, 2, z - 0.35, s * 19.2 + 0.22, 16, z + 0.35);
    // Low glazed roof monitors flank the office tower.
    b.paint(0x688482, Surf.GlassPlain, 2).box(s * 16 - 1.6, 17, -15, s * 16 + 1.6, 19, 2);
    b.paint(bronze, Surf.Metal, 3).hipRoof(s * 16, -6.5, 3.6, 17.4, 19, 1, 0.1);
  }
  b.paint(lit).box(-17.6, 0.1, 10.4, 17.6, 2, 15.6, { nz: null });
  for (let i = 0; i < 7; i++) b.paint(trim, Surf.Stone).box(-13, 0.1, 15.6 + i * 0.7, 13, 2 - i * 0.27, 16.3 + i * 0.7, { nz: null });
  for (const x of [-9.6, 0, 9.6]) {
    const arch = roundArch(x, 4.4, 8.8, 8, 2);
    openingZ(b, arch, 9.6, 1, 0x536969, Surf.GlassPlain, 2);
    archFrameZ(b, arch, 9.6, 1, 0.45, 0.25, edge);
    b.paint(bronze, Surf.Metal).box(x - 0.07, 2, 9.65, x + 0.07, 10.6, 9.8);
    b.box(x - 2.1, 5.8, 9.65, x + 2.1, 6, 9.8);
  }
  for (const x of [-15.4, -11, -6.6, -2.2, 2.2, 6.6, 11, 15.4]) {
    b.paint(edge).box(x - 0.8, 2, 13, x + 0.8, 2.65, 14.6);
    lathe(b, x, 13.8, [[0.65, 2.65], [0.55, 3.1], [0.48, 13.6], [0.7, 13.9], [0.7, 14.4]], 12);
    b.box(x - 0.85, 14.4, 12.95, x + 0.85, 15, 14.65);
  }
  b.paint(edge).box(-18.1, 15, 9.6, 18.1, 17.6, 15.1);
  b.paint(trim, Surf.Stone).gableRoof(0, 12.3, 37.2, 6.2, 17.6, 6.3, 'z', 0.2, edge);
  // Bronze rising-market relief and a narrow quotation ribbon; no emissive office walls.
  b.paint(bronze, Surf.Metal, 3);
  for (let i = 0; i < 5; i++) b.box(-2.8 + i * 1.15, 18.5, 15.62, -2.1 + i * 1.15, 19.3 + i * 0.55, 15.8);
  b.paint(0x293c3a, Surf.Metal).box(-16.4, 15.5, 15.12, 16.4, 16.6, 15.2);
  for (let i = 0; i < 24; i++) {
    const x = -15.5 + i * 1.32, y = 15.75 + rng.range(0, 0.3);
    b.paint(i % 4 === 0 ? 0xba965c : 0x88aa8c, Surf.Emissive, 10);
    b.box(x, y, 15.21, x + 0.7, y + 0.16, 15.24, { top: null, nx: null, px: null, nz: null });
  }
  // Setbacks remain large enough to read at city zoom; floors and window bays are origin-aligned.
  const tiers: [number, number, number, number, number][] = v === 0
    ? [[12.8, -19.2, 3.2, 17, 44], [9.6, -16, 0, 44, 60], [6.4, -12.8, -3.2, 60, 68]]
    : [[12, -18, 3, 17, 48], [9, -15, 0, 48, 68], [6, -12, -3, 68, 80]];
  const wall = v === 0 ? P(0xc5c0b0, Surf.WallWindows, 2, 4) : P(0x7f8c81, Surf.GlassCurtain, 2, 4);
  const roof = P(0x69736b, Surf.RoofFlat);
  for (const [hw, z0, z1, y0, y1] of tiers) {
    // The cornice box's cap is the setback roof. The tier box and its piers end inside the cornice without caps
    // of their own, so no two faces of different paint share the roof plane (they z-fought when both capped y1).
    b.paint(wall).box(-hw, Math.max(20, y0), z0, hw, y1, z1, { top: null });
    if (y0 < 20) b.paint(lit).box(-hw, y0, z0, hw, 20, z1);
    b.paint(v === 0 ? trim : bronze, v === 0 ? Surf.Stone : Surf.Metal);
    b.box(-hw - 0.35, y1 - 0.6, z0 - 0.35, hw + 0.35, y1, z1 + 0.35, { top: roof });
    for (const x of [-hw, 0, hw]) {
      for (const z of [z0, z1]) b.box(x - 0.18, y0, z - 0.18, x + 0.18, y1, z + 0.18, { top: null });
    }
    for (const x of [-hw, hw]) b.box(x - 0.18, y0, (z0 + z1) / 2 - 0.18, x + 0.18, y1, (z0 + z1) / 2 + 0.18, { top: null });
    // Small night-only crown bands, separate from the procedurally lit windows.
    b.paint(0xa99f7b, Surf.Emissive, 10).box(-hw - 0.36, y1 - 0.85, z0 - 0.36, hw + 0.36, y1 - 0.65, z1 + 0.36, { top: null });
  }
  const top = v === 0 ? 68 : 80, cz = v === 0 ? -8 : -7.5;
  b.paint(bronze, Surf.Metal, 3).hipRoof(0, cz, v === 0 ? 13.5 : 12.7, 10.3, top, v === 0 ? 4 : 5, 0.1);
  b.paint(0x8b9c94, Surf.GlassPlain, 2).box(-1.5, top + 3, cz - 1.5, 1.5, top + 5.2, cz + 1.5);
  b.paint(bronze, Surf.Metal).pyramid(0, cz, 3.4, 3.4, top + 5.2, 1.4);
  // Forecourt sculpture, flagpoles and clipped gardens.
  marketBull(b, 17.2, 18.7);
  for (const s of [-1, 1]) {
    b.paint(0x96978a, Surf.Stone).box(s * 21.4 - 1, 0.1, -16, s * 21.4 + 1, 0.6, 8);
    b.paint(0x507747, Surf.Foliage).box(s * 21.4 - 0.8, 0.6, -15.8, s * 21.4 + 0.8, 1.4, 7.8);
    tree(b, rng, s * 21.4, -21.3, 0.55, 'round');
    b.paint(0xb3b9b5, Surf.Metal).cylinder(s * 21, 15.2, 0.1, 10, 0.08, 0.04, 6);
    b.paint(v === 0 ? 0x385e77 : 0x8d4c44, Surf.Plain).quad2([s * 21, 9.8, 15.2], [s * 21 - s * 2.8, 9.6, 15.3], [s * 21 - s * 2.8, 8.1, 15.3], [s * 21, 8.3, 15.2]);
    lamp(b, s * 10.5, 22.6, 4.2, 0, [
      { color: pave, y: 0.1, dy: 0.03, clip: [rectPoly(-24, 20.6, 24, 24)] },
      { color: 0x878a83, y: 0.115, dy: 0.03, clip: [-12, -6, 0, 6, 12].map((x) => rectPoly(x - 0.18, 21.5, x + 0.18, 24)) },
    ]);
  }
  parkBench(b, -17.2, 18.5, Math.PI);
  for (const [x, z] of [[-6, 22], [4, 21.5], [9, 23], [-15, 21.2]] as P2[]) person(b, rng, x, z, 0.1, rng.range(0, TAU));
}

export const models: ModelBuilders = lotModels({ lm_stock_exchange: stockExchange });
