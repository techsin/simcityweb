/** Additional terrace roof families, keeping the original rowhouses and their saved variants unchanged. */
import type { ModelBuilder } from '../ModelBuilder';
import type { ModelBuilders } from '../registry';
import { Surf } from '../../core/types';
import {
  P, band, bay, chimney, door, inFace, isMirrorTwin, lightPool, mixHex, paveSlab, planter, roofGable, roofHip,
  roofMansard, steps, stoopRails, win, wins,
} from './res_util';

type Roof = 'hip' | 'gables' | 'mansard';
/** One look of a row: wall colour and material, trim, roof. Its four homes share it in two close tones. */
type Look = readonly [wall: number, surf: Surf, trim: number, roof: number];

// roof families, within a model each at least dE 27 from the others: clay tile, green slate, blue slate and pale lead
// on the hip and gabled rows; red-brown tile and copper in place of clay and green on the mansards
const CLAY = 0xa35a42, GREEN = 0x5c7a66, SLATE = 0x3f4852, LEAD = 0xbab6aa, TILE = 0x7a4536, COPPER = 0x5f8f7a;
const WHITE = 0xf1eee6, CREAM = 0xe8dfc9, STONE = 0xc9bca4;
/**
 * Twelve looks per model: six wall families (variants 0-5: a dominant hue and material each, two pale, two mid-tone and
 * two dark), and for the mirrored twins (6-11) the same walls under another roof. The two families of a tone never share
 * a roof. QA round 3: the first palettes rotated one set of six colours over the four homes, so every variant of a model
 * showed the same mix (wall and roof colours within dE 5).
 */
const LOOKS: Record<Roof, readonly Look[]> = {
  // rendered terraces under one long roof: white, red brick, blue-grey, tan, pale sage, charcoal brick
  hip: [
    [0xf0ebe0, Surf.Plain, 0xd6cdb9, CLAY], [0x8f4a3a, Surf.Brick, STONE, SLATE], [0x7791ab, Surf.Plain, WHITE, SLATE],
    [0xc9a467, Surf.Plain, CREAM, GREEN], [0xcfdcc6, Surf.Plain, WHITE, SLATE], [0x55575c, Surf.Brick, STONE, CLAY],
    [0xf0ebe0, Surf.Plain, 0xd6cdb9, GREEN], [0x8f4a3a, Surf.Brick, STONE, LEAD], [0x7791ab, Surf.Plain, WHITE, CLAY],
    [0xc9a467, Surf.Plain, CREAM, LEAD], [0xcfdcc6, Surf.Plain, WHITE, LEAD], [0x55575c, Surf.Brick, STONE, GREEN],
  ],
  // gabled brick and clapboard homes: white boards, red brick, sage boards, buff brick, pale blue boards, charcoal brick
  gables: [
    [0xf0ede4, Surf.Wood, 0xe2dfd6, CLAY], [0x8f4a3a, Surf.Brick, STONE, SLATE], [0x7d9678, Surf.Wood, CREAM, SLATE],
    [0xb8955f, Surf.Brick, WHITE, GREEN], [0xb7c9d6, Surf.Wood, WHITE, SLATE], [0x4a4847, Surf.Brick, 0xb4aa98, CLAY],
    [0xf0ede4, Surf.Wood, 0xe2dfd6, GREEN], [0x8f4a3a, Surf.Brick, STONE, LEAD], [0x7d9678, Surf.Wood, CREAM, CLAY],
    [0xb8955f, Surf.Brick, WHITE, LEAD], [0xb7c9d6, Surf.Wood, WHITE, LEAD], [0x4a4847, Surf.Brick, 0xb4aa98, GREEN],
  ],
  // mansard terraces: limestone, red brick, granite, golden sandstone, white stucco, brownstone
  mansard: [
    [0xdcd3c0, Surf.Stone, WHITE, TILE], [0x8a4636, Surf.Brick, STONE, SLATE], [0x636b75, Surf.Stone, 0xd0d2d2, SLATE],
    [0xc29648, Surf.Stone, CREAM, COPPER], [0xefebe2, Surf.Plain, 0xd6cdb9, SLATE], [0x5e4034, Surf.Stone, 0x8a6a58, TILE],
    [0xdcd3c0, Surf.Stone, WHITE, COPPER], [0x8a4636, Surf.Brick, STONE, LEAD], [0x636b75, Surf.Stone, 0xd0d2d2, TILE],
    [0xc29648, Surf.Stone, CREAM, LEAD], [0xefebe2, Surf.Plain, 0xd6cdb9, LEAD], [0x5e4034, Surf.Stone, 0x8a6a58, COPPER],
  ],
};
const DOORS = [0x294f42, 0x5e3136, 0x304b62, 0x594538, 0x38464c, 0x665337];

function rowhouses(b: ModelBuilder, v: number, roof: Roof, twin: boolean): void {
  const z0 = -6.5, z1 = 3.5, top = 8.4, rise = 0.3, stairN = 3;
  const [wall0, surf, trim, roofC] = LOOKS[roof][v + (twin ? 6 : 0)];
  paveSlab(b, -16, -8, 16, 8, 0xc3beb3, 0.08);
  if (roof === 'hip') {
    // One long tiled roof unifies the rendered terrace; chimneys and alternating doors mark its four homes.
    roofHip(b, 0, (z0 + z1) / 2, 28, z1 - z0, top, 1.6 + (v % 3) * 0.2, P(roofC, Surf.RoofTiles), { over: 0.35, trim, ridge: mixHex(roofC, 0xd8c8a8, 0.3) });
  }
  for (let i = 0; i < 4; i++) {
    const xa = -14 + i * 7, xb = xa + 7, cx = (xa + xb) / 2, reverse = (i + v) % 2 !== 0;
    // (the second tone is a touch warmer and darker on pale walls, lighter on dark ones)
    const du = reverse ? xb - 1.4 : xa + 1.4, wallC = reverse ? mixHex(wall0, 0x6a5a4a, 0.12) : wall0;
    const wall = P(wallC, surf), baseC = mixHex(wallC, 0x665b4a, 0.25), tileC = reverse ? mixHex(roofC, 0x1e2226, 0.12) : roofC;
    const side = { px: i === 3 ? undefined : null, nx: i === 0 ? undefined : null };
    b.paint(baseC, Surf.Stone).box(xa, 0, z0, xb, stairN * rise, z1, { bottom: null, top: null, ...side });
    b.paint(wall).box(xa, stairN * rise, z0, xb, top, z1, { bottom: null, top: null, ...side });
    band(b, xa, z0, xb, z1, 3.7, 0.18, 0.08, trim, false);
    band(b, xa, z0, xb, z1, top - 0.25, 0.25, 0.18, trim, false);
    inFace(b, 'pz', z1, () => {
      door(b, du, stairN * rise, 1.1, 2.3, DOORS[(i + v + (twin ? 3 : 0)) % 6], { surf: Surf.Wood, transom: true, frame: trim, lamp: true });
      steps(b, du, 1.65, stairN, rise, 0.34, baseC, 0, Surf.Stone);
      stoopRails(b, du, 1.65, stairN, rise, 0.34, 0x2d3032);
      if (roof === 'gables') {
        bay(b, reverse ? xa + 2.3 : xb - 2.3, 0.9, top - 0.25, 3.0, 0.85, wall, { winY: [1.3, 4.0, 6.7], winH: 1.45, frame: trim, cap: trim });
        for (const y of [4.0, 6.7]) win(b, du, y, 0.95, 1.45, { frame: trim, mull: 1 });
      } else {
        for (const x of reverse ? [xa + 1.4, xa + 3.2] : [xa + 3.8, xa + 5.6]) win(b, x, 1.3, 1.0, 1.7, { frame: trim, mull: 1 });
        for (const y of [4.0, 6.7]) for (const x of [xa + 2.1, xa + 4.9]) win(b, x, y, 1.0, 1.45, { frame: trim, mull: 1 });
      }
    });
    for (const y of [1.3, 4.0]) wins(b, 'nz', z0, [xa + 2.1, xa + 4.9], y, 1.0, 1.6, { frame: trim });
    lightPool(b, du - 1.0, z1 + 1.05, du + 1.0, z1 + 3.4, 0xc3beb3, 0.085);

    if (roof === 'gables') {
      // Individual steep gables and full-height bays keep the rhythm of four narrow homes along the frontage.
      roofGable(b, cx, (z0 + z1) / 2, 7, z1 - z0, top, 2.0 + ((v + i) % 3) * 0.2, 'z', P(tileC, Surf.RoofTiles), { over: 0.18, rake: 0.18, trim, gable: wall });
      inFace(b, 'pz', z1, () => win(b, cx, top + 0.5, 0.85, 0.85, { frame: trim, mull: 2 }));
    } else if (roof === 'mansard') {
      // Steep mansards with pale dormers sit above the entrance storeys; the flat top takes a muted tone of the slopes.
      const roofY = top + 0.2;
      band(b, xa, z0, xb, z1, top, 0.2, 0.25, trim, false);
      roofMansard(b, cx, (z0 + z1) / 2, 7, z1 - z0, roofY, 2.1 + (v % 3) * 0.2, 1.1, P(tileC, Surf.RoofTiles), P(mixHex(roofC, 0x6c6962, 0.4), Surf.RoofFlat), 0.18);
      const zf = z1 - 0.12, dx = cx + (reverse ? -0.45 : 0.45);
      b.paint(trim).box(dx - 0.75, top + 0.45, zf - 2.2, dx + 0.75, top + 1.95, zf, { bottom: null, top: P(roofC, Surf.RoofTiles) });
      inFace(b, 'pz', zf, () => win(b, dx, top + 0.9, 0.85, 0.95, { frame: trim, mull: 2 }));
      b.paint(trim).box(du - 0.8, 3.55, z1, du + 0.8, 3.7, z1 + 0.65, { bottom: null, nz: null });
    }
    // (boarded homes keep a brick stack)
    if (i % 2 === v % 2) chimney(b, xb - 0.45, -3.8, 0.65, 0.9, top + 0.5, top + 2.7, surf === Surf.Wood ? 0x8a5040 : wallC, surf === Surf.Wood ? Surf.Brick : surf);
    if (i === 0 || i === 3) planter(b, reverse ? xa + 1.1 : xb - 1.1, 6.0, 1.0, 0.8, 0.08, 0x8f7f68, 0x3c633c, v + i);
  }
  for (const face of ['px', 'nx'] as const) for (const y of [1.3, 4.0]) wins(b, face, face === 'px' ? 14 : -14, [-4.3, -1.0], y, 1.0, 1.6, { frame: trim });
}

const rows = (id: string, roof: Roof): ModelBuilders[string] => (b, v, rng) => rowhouses(b, v, roof, isMirrorTwin(id, v, rng));

export const rowhouseVarietyModels: ModelBuilders = {
  res_rowhouses_hip: rows('res_rowhouses_hip', 'hip'),
  res_rowhouses_gables: rows('res_rowhouses_gables', 'gables'),
  res_rowhouses_mansard: rows('res_rowhouses_mansard', 'mansard'),
};
