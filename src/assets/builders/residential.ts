/**
 * Procedural models for the 'residential' group. See src/assets/manifest.ts for ids, footprints and descriptions,
 * and src/assets/ModelBuilder.ts for the modeling API.
 */
import type { ModelBuilders } from '../registry';
import { PALETTE } from '../ModelBuilder';
import { Surf } from '../../core/types';

export const models: ModelBuilders = {
  // Example model (to be replaced by the residential asset agent).
  res_cottage(b, v, rng) {
    const wall = rng.pick([PALETTE.stucco, PALETTE.stuccoPink, PALETTE.stuccoBlue, PALETTE.white]);
    b.paint(PALETTE.grass, Surf.Foliage).slab(-8, -8, 8, 8, 0.08);
    b.paint(PALETTE.sidewalk, Surf.Pavement).slab(-1, 2, 1, 8, 0.1);
    b.paint(wall, Surf.WallWindows, 0, 3.0).boxC(0, -1, 9, 7, 0, 3.4);
    b.paint(rng.pick([PALETTE.roofRed, PALETTE.roofGrey, PALETTE.roofBrown]), Surf.RoofTiles).gableRoof(0, -1, 9, 7, 3.4, 2.6, 'x', 0.5, { color: wall, surf: Surf.Plain });
    b.paint(PALETTE.white, Surf.Wood).boxC(0, 3.0, 3, 1.2, 0, 2.6);
    b.paint(0x4a3a2a).boxC(2.5, -2, 0.8, 0.8, 5.0, 1.6);
  },
};
