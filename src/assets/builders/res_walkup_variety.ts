/** Additional walk-up roof families; the original model and its saved variants stay unchanged. */
import type { ModelBuilder } from '../ModelBuilder';
import type { ModelBuilders } from '../registry';
import type { RNG } from '../../core/rng';
import { Surf } from '../../core/types';
import { acUnit } from '../kit';
import {
  P, band, bay, chimney, door, fireEscape, inFace, ironRail, isMirrorTwin, lightPool, parapet, paveSlab, planter,
  roofGable, roofHip, setLot, steps, stoopRails, trashCans, tree, win, wins,
} from './res_util';

type Roof = 'hip' | 'monitor' | 'gables';

/** One look: wall, trim, roof. */
type Look = readonly [wall: number, trim: number, roof: number];

// the hip walk-up keeps its six round-1 palettes (its mirrored twins repeat them)
const HIP_WALLS = [0xc78e7b, 0x9b705d, 0xd9b083, 0xb08077, 0xd0a398, 0xb58e60];
const HIP_ROOFS = [0x63867d, 0x6a7861, 0x646f86, 0xa1684c, 0x527e82, 0x7d7255];
// roof families, each far from the others: deck tiles, sedum, tar and pale membrane on the flat roofs; clay tile,
// green slate, blue slate and pale lead on the gables
const DECK = 0xa0624b, SEDUM = 0x7f8c68, TAR = 0x45423f, PALE = 0xcfcbc0;
const CLAY = 0xa35a42, GREEN = 0x5c7a66, SLATE = 0x3f4852, LEAD = 0xbab6aa;
const WHITE = 0xf1eee6, CREAM = 0xe8dfc9, STONE = 0xc9bca4, STEEL = 0x3a4448;
/**
 * Twelve looks for the monitor and gables walk-ups: six wall families (variants 0-5: two pale, two mid-tone, two dark),
 * and for the mirrored twins (6-11) the same walls under another roof; the two families of a tone never share a roof.
 * QA round 3: their first palettes were six shades of one hue (wall and roof colours within dE 13 and 22).
 */
const LOOKS: Record<'monitor' | 'gables', readonly Look[]> = {
  // loft blocks: white-painted, red, charcoal and buff brick, sage and pale blue paint
  monitor: [
    [0xe8e4da, STEEL, DECK], [0x8e4636, STONE, TAR], [0x55585c, STONE, DECK], [0xc4a472, WHITE, SEDUM], [0x8f9a7a, CREAM, DECK], [0xa9bcc6, WHITE, TAR],
    [0xe8e4da, STEEL, SEDUM], [0x8e4636, STONE, PALE], [0x55585c, STONE, SEDUM], [0xc4a472, WHITE, PALE], [0x8f9a7a, CREAM, TAR], [0xa9bcc6, WHITE, PALE],
  ],
  // paired gabled houses: cream, plum, brown brick, dusty rose, sage and pale blue
  gables: [
    [0xe3d5b6, WHITE, CLAY], [0x5e3f58, CREAM, SLATE], [0x7a4636, STONE, CLAY], [0xc0959d, WHITE, GREEN], [0x869d7e, CREAM, CLAY], [0xc6d5df, WHITE, SLATE],
    [0xe3d5b6, WHITE, GREEN], [0x5e3f58, CREAM, LEAD], [0x7a4636, STONE, GREEN], [0xc0959d, WHITE, LEAD], [0x869d7e, CREAM, SLATE], [0xc6d5df, WHITE, LEAD],
  ],
};

function walkup(b: ModelBuilder, v: number, rng: RNG, roof: Roof, twin = false): void {
  setLot(8, 8, 14);
  const C = 2.2, x0 = -3 * C, x1 = 3 * C, z0 = -3 * C, z1 = 2 * C, fh = 3.2;
  const floors = roof === 'monitor' && v % 2 === 0 ? 4 : 3, top = floors * fh;
  const look = roof === 'hip' ? undefined : LOOKS[roof][v + (twin ? 6 : 0)];
  const wall = look ? look[0] : HIP_WALLS[v], roofC = look ? look[2] : HIP_ROOFS[v], trim = look ? look[1] : v % 2 ? 0xe4dbcb : 0xf1e8d8;
  const doorX = v % 2 ? 2.2 : -2.2, doorC = [0x324b40, 0x5a303b, 0x32495b, 0x633b2d, 0x35434a, 0x6c573b][(v + (twin ? 3 : 0)) % 6];
  paveSlab(b, -8, -8, 8, 8, 0xbab4a9, 0.08);
  b.paint(0xa49c8d, Surf.Stone).box(x0, 0, z0, x1, 0.6, z1, { top: null });
  b.paint(wall, Surf.WallWindows, 1, fh).box(x0, fh, z0, x1, top, z1, { bottom: null, top: null });
  // A painted entrance storey leaves the upper window grid aligned with the original walk-up's columns.
  b.paint(wall, roof === 'hip' ? Surf.Plain : Surf.Brick).box(x0, 0.6, z0, x1, fh, z1, { top: null, bottom: null });
  band(b, x0, z0, x1, z1, fh - 0.15, 0.25, 0.12, trim, false);
  inFace(b, 'pz', z1, () => {
    door(b, doorX, 0.6, 1.25, 2.15, doorC, { transom: true, frame: trim, lamp: true });
    for (const x of [-5.5, -1.1, 1.1, 5.5]) {
      if (Math.abs(x - doorX) < 1.5) continue;
      win(b, x, 0.95, 1.0, 1.65, { frame: trim, mull: 2, sill: trim });
    }
    steps(b, doorX, 1.8, 2, 0.3, 0.35, 0xa49c8d, 0, Surf.Stone);
    stoopRails(b, doorX, 1.8, 2, 0.3, 0.35);
  });
  for (const face of ['px', 'nx'] as const) wins(b, face, face === 'px' ? x1 : x0, [-5.5, -1.1, 3.3], 0.95, 1.0, 1.65, { frame: trim });
  wins(b, 'nz', z0, [-3.3, 1.1, 5.5], 0.95, 1.0, 1.65, { frame: trim });
  lightPool(b, doorX - 1.2, z1 + 0.75, doorX + 1.2, z1 + 3.1, 0xbab4a9, 0.085);

  if (roof === 'hip') {
    // Copper-toned hip roof, wide pale eaves and an offset bay distinguish the stucco walk-up.
    band(b, x0, z0, x1, z1, top - 0.3, 0.3, 0.3, trim, false);
    roofHip(b, 0, (z0 + z1) / 2, x1 - x0, z1 - z0, top, 2.2 + (v % 3) * 0.25, P(roofC, Surf.RoofTiles), { over: 0.4, trim, ridge: 0x8f9c8e });
    inFace(b, 'pz', z1, () => bay(b, -doorX - 1.1, fh, top - 0.35, 3.2, 0.85, P(wall), { winY: [fh + 0.65, 2 * fh + 0.65], winH: 1.75, frame: trim, roof: P(roofC, Surf.RoofTiles), roofH: 0.6 }));
    chimney(b, v % 2 ? -4.4 : 4.4, -3.8, 0.7, 0.9, top + 0.7, top + 3.0, wall, Surf.Plain);
    for (const x of [-5.5, 0, 5.5]) planter(b, x, z1 + 1.7, 1.0, 0.65, 0.08, 0x9d7860, 0x4f7a34, v + x);
  } else if (roof === 'monitor') {
    // A raised glazed monitor and stepped front parapet give the flat roof a clear industrial silhouette.
    b.paint(roofC, Surf.RoofFlat).quad([x0, top, z1], [x1, top, z1], [x1, top, z0], [x0, top, z0]);
    parapet(b, x0, z0, x1, z1, top, 0.55, 0.25, wall, trim);
    const panelX = v % 2 ? -2.2 : 2.2;
    b.paint(wall).box(panelX - 2.1, top + 0.55, z1 - 0.25, panelX + 2.1, top + 0.9, z1, { bottom: null, top: P(trim) });
    b.paint(wall).box(panelX - 1.1, top + 0.9, z1 - 0.25, panelX + 1.1, top + 1.15, z1, { bottom: null, top: P(trim) });
    const monitorX = v % 2 ? 1.1 : -1.1, monitorZ = -2.1;
    b.paint(0x5a7377, Surf.Metal).box(monitorX - 1.8, top, -4.6, monitorX + 1.8, top + 0.15, 0.4, { bottom: null, top: null });
    b.paint(0x344d57, Surf.GlassPlain).box(monitorX - 1.8, top + 0.15, -4.6, monitorX + 1.8, top + 0.7, 0.4, { bottom: null, top: null });
    roofGable(b, monitorX, monitorZ, 3.6, 5.0, top + 0.7, 0.45, 'z', P(0x5a7377, Surf.Metal), { over: 0.12, rake: 0.12, trim, gable: P(0x344d57, Surf.GlassPlain) });
    acUnit(b, monitorX > 0 ? -4.4 : 4.4, top, -4.4, 0.7);
    for (let f = 1; f < floors; f++) band(b, x0, z0, x1, z1, f * fh + 0.55, 0.12, 0.07, trim, false);
    inFace(b, 'pz', z1, () => fireEscape(b, -doorX, Array.from({ length: floors - 1 }, (_, i) => (i + 1) * fh), 3.2, 0x35434a));
  } else {
    // Paired slate front gables and brick party-wall piers break up the broad facade into two narrow houses.
    for (const cx of [-3.3, 3.3]) {
      roofGable(b, cx, (z0 + z1) / 2, 6.6, z1 - z0, top, 2.4 + (v % 3) * 0.3, 'z', P(roofC, Surf.RoofTiles), { over: 0.18, rake: 0.28, trim, gable: P(wall, Surf.Brick) });
      inFace(b, 'pz', z1, () => win(b, cx, top + 0.5, 0.85, 1.0, { frame: trim, mull: 2 }));
    }
    for (const x of [x0, 0, x1]) b.paint(trim).box(x - 0.11, 0.6, z1, x + 0.11, top, z1 + 0.18, { bottom: null });
    for (const f of [1, 2]) band(b, x0, z0, x1, z1, f * fh - 0.15, 0.2, 0.1, trim, false);
    chimney(b, v % 2 ? -4.4 : 4.4, -4.4, 0.65, 1.0, top + 0.5, top + 2.3, wall);
    ironRail(b, x0, z1 + 1.4, doorX - 1.1, z1 + 1.4, 0.8);
    ironRail(b, doorX + 1.1, z1 + 1.4, x1, z1 + 1.4, 0.8);
  }
  trashCans(b, doorX > 0 ? -7.0 : 6.1, -7.1, 2);
  tree(b, rng, doorX > 0 ? -5.8 : 5.8, 6.8, 0.6, v % 2 ? 'column' : 'round');
}

export const walkupVarietyModels: ModelBuilders = {
  res_walkup_hip: (b, v, rng) => walkup(b, v, rng, 'hip'),
  res_walkup_monitor: (b, v, rng) => walkup(b, v, rng, 'monitor', isMirrorTwin('res_walkup_monitor', v, rng)),
  res_walkup_gables: (b, v, rng) => walkup(b, v, rng, 'gables', isMirrorTwin('res_walkup_gables', v, rng)),
};
