/** Additional terrace roof families, keeping the original rowhouses and their saved variants unchanged. */
import type { ModelBuilder } from '../ModelBuilder';
import type { ModelBuilders } from '../registry';
import { Surf } from '../../core/types';
import {
  P, band, bay, chimney, door, inFace, lightPool, mixHex, paveSlab, planter, roofGable, roofHip,
  roofMansard, steps, stoopRails, win, wins,
} from './res_util';

type Roof = 'hip' | 'gables' | 'mansard';

const WALLS = {
  hip: [0xd0bba0, 0xc6a984, 0xb7ad98, 0xd0c3ad, 0xbdb89d, 0xcab9ae],
  gables: [0x8a4e3c, 0x6f5f67, 0x9e7255, 0x84664c, 0x7b514a, 0x927064],
  mansard: [0xd4cbb9, 0xbab5ae, 0xe0d7c1, 0xbdb5a4, 0xd3c2a8, 0xc0b8b2],
};
const ROOFS = {
  hip: [0xa65f47, 0x98714d, 0x856b58, 0xa97b58, 0x8e5c4a, 0x9c7760],
  gables: [0x4e5e69, 0x5c5261, 0x5e6a63, 0x46545e, 0x6e6063, 0x53646a],
  mansard: [0x3d515c, 0x55615f, 0x495566, 0x605f69, 0x465d62, 0x636b72],
};
const DOORS = [0x294f42, 0x5e3136, 0x304b62, 0x594538, 0x38464c, 0x665337];

function rowhouses(b: ModelBuilder, v: number, roof: Roof): void {
  const z0 = -6.5, z1 = 3.5, top = 8.4, trim = v % 2 ? 0xe1d5bf : 0xf0e5d1;
  const roofC = ROOFS[roof][v], rise = 0.3, stairN = 3;
  paveSlab(b, -16, -8, 16, 8, 0xc3beb3, 0.08);
  if (roof === 'hip') {
    // One long tiled roof unifies the rendered terrace; chimneys and alternating doors mark its four homes.
    roofHip(b, 0, (z0 + z1) / 2, 28, z1 - z0, top, 1.6 + (v % 3) * 0.2, P(roofC, Surf.RoofTiles), { over: 0.35, trim, ridge: 0xb99b78 });
  }
  for (let i = 0; i < 4; i++) {
    const xa = -14 + i * 7, xb = xa + 7, cx = (xa + xb) / 2, reverse = (i + v) % 2 !== 0;
    const du = reverse ? xb - 1.4 : xa + 1.4, wallC = WALLS[roof][(v + i) % 6];
    const wall = P(wallC, roof === 'gables' ? Surf.Brick : Surf.Stone), baseC = mixHex(wallC, 0x665b4a, 0.25);
    const side = { px: i === 3 ? undefined : null, nx: i === 0 ? undefined : null };
    b.paint(baseC, Surf.Stone).box(xa, 0, z0, xb, stairN * rise, z1, { bottom: null, top: null, ...side });
    b.paint(wall).box(xa, stairN * rise, z0, xb, top, z1, { bottom: null, top: null, ...side });
    band(b, xa, z0, xb, z1, 3.7, 0.18, 0.08, trim, false);
    band(b, xa, z0, xb, z1, top - 0.25, 0.25, 0.18, trim, false);
    inFace(b, 'pz', z1, () => {
      door(b, du, stairN * rise, 1.1, 2.3, DOORS[(i + v) % 6], { surf: Surf.Wood, transom: true, frame: trim, lamp: true });
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
      // Individual steep gables and full-height bays keep a brick brownstone rhythm along the frontage.
      const tile = P(ROOFS.gables[(v + i) % 6], Surf.RoofTiles);
      roofGable(b, cx, (z0 + z1) / 2, 7, z1 - z0, top, 2.0 + ((v + i) % 3) * 0.2, 'z', tile, { over: 0.18, rake: 0.18, trim, gable: wall });
      inFace(b, 'pz', z1, () => win(b, cx, top + 0.5, 0.85, 0.85, { frame: trim, mull: 2 }));
    } else if (roof === 'mansard') {
      // Slate mansards with pale dormers sit above the limestone Georgian entrance storeys.
      const roofY = top + 0.2, tile = P(ROOFS.mansard[(v + i) % 6], Surf.RoofTiles);
      band(b, xa, z0, xb, z1, top, 0.2, 0.25, trim, false);
      roofMansard(b, cx, (z0 + z1) / 2, 7, z1 - z0, roofY, 2.1 + (v % 3) * 0.2, 1.1, tile, P(roofC, Surf.RoofFlat), 0.18);
      const zf = z1 - 0.12, dx = cx + (reverse ? -0.45 : 0.45);
      b.paint(trim).box(dx - 0.75, top + 0.45, zf - 2.2, dx + 0.75, top + 1.95, zf, { bottom: null, top: P(roofC, Surf.RoofTiles) });
      inFace(b, 'pz', zf, () => win(b, dx, top + 0.9, 0.85, 0.95, { frame: trim, mull: 2 }));
      b.paint(trim).box(du - 0.8, 3.55, z1, du + 0.8, 3.7, z1 + 0.65, { bottom: null, nz: null });
    }
    if (i % 2 === v % 2) chimney(b, xb - 0.45, -3.8, 0.65, 0.9, top + 0.5, top + 2.7, wallC, roof === 'gables' ? Surf.Brick : Surf.Stone);
    if (i === 0 || i === 3) planter(b, reverse ? xa + 1.1 : xb - 1.1, 6.0, 1.0, 0.8, 0.08, 0x8f7f68, 0x3c633c, v + i);
  }
  for (const face of ['px', 'nx'] as const) for (const y of [1.3, 4.0]) wins(b, face, face === 'px' ? 14 : -14, [-4.3, -1.0], y, 1.0, 1.6, { frame: trim });
}

export const rowhouseVarietyModels: ModelBuilders = {
  res_rowhouses_hip: (b, v) => rowhouses(b, v, 'hip'),
  res_rowhouses_gables: (b, v) => rowhouses(b, v, 'gables'),
  res_rowhouses_mansard: (b, v) => rowhouses(b, v, 'mansard'),
};
