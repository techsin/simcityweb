/**
 * Big 6x6 park venues: zoo, golf course, stadium, amusement park. (park/landmark asset agent)
 * Budget: <= 3000 tris each, so geometry is spent where it reads from the game camera.
 */
import type { ModelBuilders } from '../registry';
import { ModelBuilder, PALETTE, type Paint } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { car } from '../kit';
import {
  type P2, type V3, type ProfPt, lawnPatchwork, path, pond, tree, shrub, flowerBed, roundBed, lamp, parkBench, fountain, floodMast, railFence,
  panelFence, goal, person, umbrella, disc, annulus, ribbon, rect, rectLines, line, arcPts, cylWall, lathe, loftRing, roundRectPath, flatPoly,
  blobPoly, spline, track3D, shade, stripedCone, stripedWall, offsetPoly, orientQuad, wall, inPoly, festoon, ribbonQuads, treeClump, lawnPools,
  lawnPathPool, rectPoly, circlePoly, hedgeBox, YL, type PoolSpec,
  GRASS_LUSH, GRASS_DARK, MEADOW, PATH_GRAVEL, PATH_PAVE,
} from './park_lib';

const TAU = Math.PI * 2;
const WHITE_LINE = 0xf2f2ee;

// ================================================================================================ STADIUM
function parkStadium(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 48;
  // plaza + corner greens
  // plaza 0.08 < lamp pools 0.092 < band 0.105 < corner greens 0.12
  const plazaC = 0xc2beb4;
  b.paint(plazaC, Surf.Pavement).slab(-E, -E, E, E, 0.08);
  b.paint(0xaea99e, Surf.Pavement);
  annulus(b, 0, 0, 0.105, 44.5, 46.2, 40);
  const greens: P2[][] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.paint(GRASS_LUSH, Surf.Foliage);
    const tri: P2[] = [[sx * 47.5, sz * 47.5], [sx * 33, sz * 47.5], [sx * 47.5, sz * 33]];
    greens.push(tri);
    flatPoly(b, tri, 0.12);
    for (let k = 0; k < 2; k++) tree(b, rng, sx * (44.5 - k * 4.2), sz * (43.5 + k * 1.2), 0.9, 'round');
  }
  // --- pitch (glows under the floodlights at night)
  const PW = 50, PD = 32;
  const inner = roundRectPath(0, 0, 58, 42, 12, 7);
  // floodlit pitch (Emissive 12, painted 0.7x): base 0.095 < stripes 0.11 < lines 0.125
  b.paint(0x264b1b, Surf.Emissive, 12);
  flatPoly(b, offsetPoly(inner, 0.2), 0.095);
  for (let i = 0; i < 10; i++) {
    b.paint(i % 2 ? 0x264b1b : 0x2e5520, Surf.Emissive, 12);
    rect(b, -PW / 2 - 1.5 + ((PW + 3) * i) / 10, -PD / 2 - 1.5, -PW / 2 - 1.5 + ((PW + 3) * (i + 1)) / 10, PD / 2 + 1.5, 0.11);
  }
  b.paint(shade(WHITE_LINE, 0.7), Surf.Emissive, 12);
  const y = 0.125, w = 0.14;
  rectLines(b, -PW / 2, -PD / 2, PW / 2, PD / 2, w, y);
  line(b, 0, -PD / 2, 0, PD / 2, w, y);
  ribbon(b, arcPts(0, 0, 4.6, 0, TAU, 20), w, y, { closed: true });
  for (const s of [-1, 1]) {
    const gx = (s * PW) / 2;
    rectLines(b, Math.min(gx, gx - s * 8), -10, Math.max(gx, gx - s * 8), 10, w, y);
    rectLines(b, Math.min(gx, gx - s * 3), -4.5, Math.max(gx, gx - s * 3), 4.5, w, y);
    ribbon(b, arcPts(gx - s * 5.5, 0, 4.6, s > 0 ? Math.PI - 0.9 : -0.9, s > 0 ? Math.PI + 0.9 : 0.9, 8), w, y);
    goal(b, gx + s * 0.05, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 6, 2.2);
  }
  // --- seating bowl (single loft): outer facade up, rim, upper tier down, box level, lower tier down, pitch wall
  // night: cool floodlit outer shell (fades up to the rim), a warm lit concourse ribbon under the rim and a
  // ground-floor concourse of individually lit glazing bays (not one uniform glowing band)
  const facade: Paint = { color: 0xd9d7d0, surf: Surf.Plain, pattern: 2, floor: 18 };
  const concourse: Paint = { color: 0x9fb6c4, surf: Surf.GlassPlain, pattern: 0 };
  const plinth: Paint = { color: 0xb9b6ae, surf: Surf.Plain, pattern: 2, floor: 18 };
  const ribbonC: Paint = { color: 0xe0a55c, surf: Surf.Emissive, pattern: 10 };
  const rim: Paint = { color: 0xd9d6ce, surf: Surf.Plain, pattern: 2, floor: 18 };
  const seatsUp: Paint = { color: 0x2c5fa8, surf: Surf.RoofTiles };
  const seatsLo: Paint = { color: shade(0x2f6bbd, 0.7), surf: Surf.Emissive, pattern: 12 };
  const seatsLoB: Paint = { color: shade(0x24508f, 0.7), surf: Surf.Emissive, pattern: 12 };
  const boxes: Paint = { color: 0x1d2630, surf: Surf.GlassPlain };
  const soffit: Paint = { color: 0x55595e, surf: Surf.Plain };
  const walk: Paint = { color: 0x8e8b84, surf: Surf.Pavement };
  const ads: Paint = { color: 0x2d7fd0, surf: Surf.Emissive };
  const prof: ProfPt[] = [
    [16, 0.05, concourse], [16, 3.9, plinth], [16, 5.5, facade], [16, 15.4, ribbonC], [16, 16.6, facade], [16, 18, rim], [15.3, 18.6, rim], [14.6, 18, seatsUp], [7.2, 10.6, boxes], [7.2, 9.3, soffit], [8.2, 9.3, soffit],
    [8.2, 7.0, seatsLo], [1.4, 1.5, walk], [0.5, 1.5, ads], [0.5, 0.05],
  ];
  // seat blocks: alternate two blues by sector
  const aisle: Paint = { color: 0x24508f, surf: Surf.RoofTiles };
  const kUp = prof.findIndex((p) => p[2] === seatsUp), kLo = prof.findIndex((p) => p[2] === seatsLo);
  loftRing(b, inner, prof, 30, (i, k) => (i % 4 < 2 ? (k === kUp ? aisle : k === kLo ? seatsLoB : null) : null));
  // facade: vertical fins every other path point
  // (fins run down to the ground so the lit concourse glazing reads as bays)
  b.paint(0xcfcdc6, Surf.Plain, 2, 18);
  const outer = offsetPoly(inner, 16.25);
  for (let i = 0; i < outer.length; i += 2) {
    const [x, z] = outer[i];
    b.beam([x, 0.05, z], [x, 18.4, z], 0.45);
  }
  // --- roof canopy ring with emissive floodlight edge
  const canopy: ProfPt[] = [
    [17.2, 23.2, { color: 0xf1f0ec, surf: Surf.Metal }], [17.2, 24.2, { color: 0xf4f4f2, surf: Surf.Metal }], [8.8, 26.1, { color: 0xfafaff, surf: Surf.Emissive }],
    [8.8, 25.4, { color: 0x6b7077, surf: Surf.Metal }], [17.2, 23.2],
  ];
  loftRing(b, inner, canopy, 20);
  // canopy columns + radial trusses
  const colPts = offsetPoly(inner, 16.6);
  const trussIn = offsetPoly(inner, 9.4);
  b.paint(0xdcdcd8, Surf.Metal);
  for (let i = 1; i < colPts.length; i += 3) {
    const [x, z] = colPts[i];
    b.beam([x, 18, z], [x, 23.5, z], 0.5);
    const [ix, iz] = trussIn[i];
    b.beam([x, 24.3, z], [ix, 26.2, iz], 0.3);
  }
  // big screens above the ends
  for (const s of [-1, 1]) {
    b.push().translate(s * 40.6, 0, 0).rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
    b.paint(0x2a2d31, Surf.Metal).box(-7, 19, -0.6, 7, 23, 0.4);
    b.paint(0x2a4f7a, Surf.Emissive).box(-6.5, 19.4, -0.62, 6.5, 22.6, -0.6, { top: null, bottom: null, nx: null, px: null, pz: null });
    b.pop();
  }
  // --- 4 floodlight masts at the corners
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) floodMast(b, sx * 40.5, sz * 34.5, 44, 0, 0, { lattice: true, lamps: [3, 3, 2.5, 1.2] });
  // --- main entrance (+Z): canopy with glowing name board, flags, ticket booths
  b.paint(0xe9e7e1, Surf.Metal).box(-12, 6.5, 36.4, 12, 7.3, 41.5);
  b.paint(0x28323c, Surf.Metal).box(-9, 7.3, 38.8, 9, 10.2, 39.4);
  // name board: blue LED screen with yellow crest + score blocks (0.75x: saturated colour, not clipped white)
  b.paint(0x3a8fe0, Surf.Emissive, 3).box(-8.4, 7.7, 39.4, 8.4, 9.8, 39.45, { top: null, bottom: null, nx: null, px: null, nz: null });
  b.paint(0xffd23f, Surf.Emissive, 3);
  for (const [x0, x1, y0, y1] of [[-7.9, -6.0, 7.95, 9.55], [-4.6, 1.2, 8.55, 9.3], [2.6, 4.1, 8.0, 9.5], [4.9, 6.4, 8.0, 9.5]]) {
    b.quad([x0, y0, 39.47], [x1, y0, 39.47], [x1, y1, 39.47], [x0, y1, 39.47]);
  }
  b.paint(0xeef4ff, Surf.Emissive, 2).quad([-4.6, 7.95, 39.47], [1.2, 7.95, 39.47], [1.2, 8.25, 39.47], [-4.6, 8.25, 39.47]);
  b.paint(0x7c8288, Surf.Metal);
  for (const x of [-11, -4, 4, 11]) b.box(x - 0.25, 0, 41.0, x + 0.25, 6.5, 41.5);
  for (const x of [-30, -24, 24, 30]) {
    b.paint(0x3a3e44, Surf.Metal).box(x - 1.3, 0.08, 40.5, x + 1.3, 2.8, 42.5);
    b.paint(0xc0392b, Surf.Plain).box(x - 1.5, 2.8, 40.3, x + 1.5, 3.1, 42.7);
  }
  for (let i = 0; i < 6; i++) {
    const x = -15 + i * 6;
    b.paint(0xdddddd, Surf.Metal).cylinder(x, 45.5, 0.08, 10, 0.1, 0.06, 5);
    b.paint([0x2c5fa8, 0xffffff, 0xc0392b][i % 3], Surf.Plain).quad2([x, 9.9, 45.5], [x + 2.4, 9.9, 45.5], [x + 2.4, 8.4, 45.5], [x, 8.4, 45.5]);
  }
  const pools: PoolSpec[] = [{ color: plazaC, y: 0.08, dy: 0.012 }, { color: GRASS_LUSH, y: 0.12, clip: greens, dy: 0.015 }];
  for (const x of [-38, -20, 20, 38]) lamp(b, x, 44.5, 5.5, 2, pools);
  for (const [x, z] of [[-46, 20], [46, 20], [-46, -20], [46, -20], [0, -46.5]] as P2[]) lamp(b, x, z, 5.5, 2, pools);
  for (let i = 0; i < 4; i++) person(b, rng, rng.range(-20, 20), rng.range(41, 46), 0.08, rng.range(0, TAU));
}

// ================================================================================================ AMUSEMENT PARK
/** Classic open ferris wheel in the XY plane centered (x, hub, z). */
function ferrisWheel(b: ModelBuilder, x: number, z: number, R: number, hub: number, n: number, rng: RNG): void {
  const seg = 24, hw = 1.1;
  // A-frame supports on both sides
  b.paint(0xd0d4d8, Surf.Metal);
  for (const s of [-1, 1]) {
    const zz = z + s * (hw + 0.5);
    b.beam([x - R * 0.42, 0, zz + s * 2.2], [x, hub, zz], 0.55);
    b.beam([x + R * 0.42, 0, zz + s * 2.2], [x, hub, zz], 0.55);
    b.beam([x - R * 0.21, hub * 0.5, zz + s * 1.1], [x + R * 0.21, hub * 0.5, zz + s * 1.1], 0.3);
  }
  b.paint(0x8a9096, Surf.Metal);
  b.push().translate(x, hub, z).rotateX(Math.PI / 2);
  b.cylinder(0, 0, -hw - 0.6, 2 * hw + 1.2, 0.9, 0.9, 8);
  b.pop();
  // rims (flat bands, double sided) — emissive so they trace a glowing circle at night
  for (const s of [-1, 1]) {
    const zz = z + s * hw;
    b.paint(0xfff4dc, Surf.Emissive);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
      const r0 = R - 0.35, r1 = R + 0.35;
      b.quad2([x + Math.cos(a0) * r0, hub + Math.sin(a0) * r0, zz], [x + Math.cos(a1) * r0, hub + Math.sin(a1) * r0, zz], [x + Math.cos(a1) * r1, hub + Math.sin(a1) * r1, zz], [x + Math.cos(a0) * r1, hub + Math.sin(a0) * r1, zz]);
    }
    // spokes
    b.paint(0xe6e9ec, Surf.Metal);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.12;
      const ex = x + Math.cos(a) * R, ey = hub + Math.sin(a) * R;
      const px = -Math.sin(a) * 0.09, py = Math.cos(a) * 0.09;
      b.quad2([x + px, hub + py, zz], [ex + px, ey + py, zz], [ex - px, ey - py, zz], [x - px, hub - py, zz]);
    }
  }
  // gondolas hanging from cross bars
  const cols = [0xc9463a, 0xd9ae2a, 0x2f7fb8, 0x2ea860, 0x8a55a8, 0xd0752a];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const gx = x + Math.cos(a) * R, gy = hub + Math.sin(a) * R;
    b.paint(0xb9bec3, Surf.Metal).box(gx - 0.1, gy - 0.1, z - hw, gx + 0.1, gy + 0.1, z + hw, { bottom: null });
    b.paint(cols[i % cols.length], Surf.Emissive, 10).box(gx - 0.9, gy - 2.5, z - 0.8, gx + 0.9, gy - 1.1, z + 0.8);
  }
  void rng;
}

/** Teacup ride: turntable, central hub, pastel cups, striped canopy on posts. */
function teacups(b: ModelBuilder, x: number, z: number, y0: number): void {
  b.paint(0xb58f4a, Surf.Metal).cylinder(x, z, y0, 0.45, 6.2, 6.2, 14);
  b.paint(0xd8d2c4, Surf.Plain).cylinder(x, z, y0 + 0.45, 1.2, 1.1, 0.9, 8);
  const cols = [0xd688a4, 0x86b4d2, 0xd9c35a, 0x8fc49a, 0xb49ad8, 0xe0a070];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    const cx = x + Math.cos(a) * 3.9, cz = z + Math.sin(a) * 3.9;
    b.paint(cols[i], Surf.Plain);
    lathe(b, cx, cz, [[0.55, y0 + 0.45], [1.05, y0 + 0.75], [1.2, y0 + 1.35], [1.05, y0 + 1.35]], 8);
    b.paint(0xd8d2c4, Surf.Plain).cylinder(cx, cz, y0 + 0.9, 0.12, 0.35, 0.35, 6);
  }
  b.paint(0x8a8f96, Surf.Metal);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    b.cylinder(x + Math.cos(a) * 6.6, z + Math.sin(a) * 6.6, 0, 4.2, 0.1, 0.1, 4, { top: false });
  }
  stripedCone(b, x, z, 4.2, 2.4, 7.2, 12, 0x2e7ab0, 0xd8d2c4, true);
}

/** Swinging pirate ship: hull along Z hanging from a pivot at height h, A-frame towers either side. */
function pirateShip(b: ModelBuilder, x: number, z: number, h: number, swing: number): void {
  b.paint(0x5a3a28, Surf.Wood);
  for (const s of [-1, 1]) {
    b.beam([x + s * 4.2, 0.12, z - 5.5], [x + s * 3.8, h, z], 0.45).beam([x + s * 4.2, 0.12, z + 5.5], [x + s * 3.8, h, z], 0.45);
  }
  b.paint(0x3a3e44, Surf.Metal).beam([x - 4, h, z], [x + 4, h, z], 0.5);
  b.push().translate(x, h, z).rotateX(swing);
  b.paint(0x6a4a30, Surf.Wood);
  for (const s of [-1, 1]) for (const dz of [-2.5, 2.5]) b.beam([s * 1.2, 0, 0], [s * 1.3, -h + 2.6, dz], 0.25);
  const hull: P2[] = [[-1.7, -6.5], [1.7, -6.5], [2.1, -3], [2.1, 3], [1.7, 6.5], [-1.7, 6.5], [-2.1, 3], [-2.1, -3]];
  const HY = -h + 1.2;
  b.push().translate(0, HY, 0);
  b.paint(0x7a4a2c, Surf.Wood).extrude([[0, -7.4], [1.4, -6.5], [2.1, -3], [2.1, 3], [1.4, 6.5], [0, 7.4], [-1.4, 6.5], [-2.1, 3], [-2.1, -3], [-1.4, -6.5]], 0, 1.9, { topPaint: { color: 0x9a7a55, surf: Surf.Wood } });
  b.paint(0xb03a2e, Surf.Plain).extrude(hull.map(([a, c]) => [a * 1.02, c * 1.02] as P2), 1.2, 0.25, { top: false });
  b.paint(0x5a3a28, Surf.Wood).cylinder(0, 0, 1.9, 5.5, 0.14, 0.1, 5);
  b.paint(0xd8d2c4, Surf.Plain).quad2([0, 6.6, -0.1], [0, 6.6, 2.4], [0, 3.2, 2.8], [0, 3.2, -0.1]);
  b.paint(0x2b2b2b, Surf.Plain).quad2([0, 7.4, 0], [0, 7.4, -1.4], [0, 6.8, -1.4], [0, 6.8, 0]);
  b.pop();
  b.pop();
}

function parkAmusement(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 48;
  lawnPatchwork(b, rng, -E, -E, E, E, GRASS_LUSH, 0);
  // ~60% paved: big front concourse + back promenades (paving 0.12 < lamp pools 0.132 < ride pads 0.15)
  const pave = 0xc9b99c, padC = 0xb3a488;
  const PY = YL.path;
  const front: P2[] = [[-34, -12], [34, -12], [34, 47.8], [-34, 47.8]];
  b.paint(pave, Surf.Pavement);
  flatPoly(b, front, PY);
  const pw = path(b, [[-8, -12], [-14, -18], [-22, -21.5], [-34, -22]], 6, pave, PY);
  const pb = path(b, [[4, -12], [4, -20], [-2, -34], [-12, -42]], 5, pave, PY);
  const pr = path(b, [[34, 0], [40, 6], [44, 20], [44, 36]], 5, pave, PY);
  const paveClip = [front, ...ribbonQuads(pw, 6), ...ribbonQuads(pb, 5), ...ribbonQuads(pr, 5)];
  const pools: PoolSpec[] = [{ color: pave, y: PY, clip: paveClip, dy: 0.012 }];
  // lawn islands with trees inside the concourse (raised planters with kerbs)
  for (const [x0, z0, x1, z1] of [[-33, 30, -30, 44], [30, 12, 33, 20], [-10, 8, -5, 13], [5, 8, 10, 13]] as [number, number, number, number][]) {
    b.paint(0x8f887a, Surf.Stone).box(x0 - 0.2, 0, z0 - 0.2, x1 + 0.2, 0.3, z1 + 0.2, { top: null });
    b.paint(GRASS_LUSH, Surf.Foliage).box(x0, 0, z0, x1, 0.32, z1, { bottom: null });
    tree(b, rng, (x0 + x1) / 2, (z0 + z1) / 2, 0.8, 'round');
  }
  // central hub pad + fountain
  b.paint(padC, Surf.Pavement);
  disc(b, 0, 4, 0.15, 12, 24);
  fountain(b, 0, 4, 4.2, 1, { seg: 12, y: 0.15 });

  // --- entrance gate
  for (const s of [-1, 1]) {
    b.paint(0xd8d2c4, Surf.Plain).box(s * 6.5 - 1.4, 0, 42, s * 6.5 + 1.4, 9, 44.8);
    stripedCone(b, s * 6.5, 43.4, 9, 4.2, 2.2, 8, 0xc9342b, 0xd8d2c4, true);
  }
  b.paint(0x2b2f36, Surf.Metal).box(-5.2, 7, 43.1, 5.2, 9.2, 43.7);
  b.paint(0xffd166, Surf.Emissive).box(-4.8, 7.3, 43.7, 4.8, 8.9, 43.75, { top: null, bottom: null, nx: null, px: null, nz: null });
  for (const x of [-11.5, 11.5]) {
    b.paint(0x2e78ae, Surf.Plain).box(x - 1.3, 0, 43, x + 1.3, 2.6, 45.2);
    b.paint(0xd9ae2a, Surf.Plain).pyramid(x, 44.1, 3.0, 2.6, 2.6, 1.2);
  }

  // --- ferris wheel (back-left) with lit gondolas
  ferrisWheel(b, -27, -30, 19, 23, 12, rng);
  b.paint(padC, Surf.Pavement).slab(-37, -36, -17, -24, 0.15);

  // lake under the coaster
  pond(b, rng, 22, -22, 9, 6.5, { n: 14, rimSides: false, rimW: 0.7, water: 0x2e6a80 });
  // --- roller coaster (right half): spline through 3D control points (x, z, y)
  const C: [number, number, number][] = [
    [8, 14, 1.6], [18, 14, 1.6], [28, 14, 1.8], [37, 11, 3], [42, 3, 6], [43, -8, 12.5], [43, -19, 19.5], [42.5, -28, 25], [39, -36, 26], [32, -41, 20],
    [26, -42.5, 8], [20, -42.5, 2.4],
    // loop (entering heading -X)
    [14, -42.5, 2.2], [9.5, -42, 6.2], [8.2, -41.6, 12], [11.2, -41.2, 16.4], [15.8, -40.8, 12.2], [14.3, -40.4, 6.2], [9, -40, 2.4],
    [3, -38, 3], [-1, -31, 5.5], [2, -22, 8.5], [11, -18, 9.5], [18, -22, 8], [21, -30, 6], [28, -30, 5], [33, -22, 7], [31, -12, 9], [23, -5, 6.5], [14, 1, 4],
    [7, 7, 2.5], [5, 12, 1.8],
  ];
  const ctrl = C.map(([x, z, yy]) => [x, yy, z] as V3);
  const pts = splineClosed3(ctrl, 2);
  b.paint(0xc02c26, Surf.Metal);
  track3D(b, pts, 1.5, 0.45, { closed: true, bottom: false });
  b.paint(0xd0d0cc, Surf.Metal);
  const loopStart = 12 * 2, loopEnd = 19 * 2;
  for (let i = 0; i < pts.length; i += 4) {
    const [px, py, pz] = pts[i];
    if (py < 2.5 || (i >= loopStart && i < loopEnd)) continue;
    b.beam([px, 0, pz], [px, py - 0.45, pz], 0.35);
  }
  for (const zz of [-44.5, -38.5]) b.beam([6, 0, zz], [11.5, 16, -41.2], 0.4).beam([17, 0, zz], [11.5, 16, -41.2], 0.4);
  // station
  b.paint(0x2e78ae, Surf.Plain).box(10, 0, 15.8, 26, 3.2, 17.2);
  b.paint(0xd9ae2a, Surf.Metal).box(9.5, 4.2, 11.8, 26.5, 4.5, 17.4);
  b.paint(0xc8c8c4, Surf.Metal);
  for (const x of [10, 18, 26]) b.box(x - 0.15, 0, 11.9, x + 0.15, 4.2, 12.2);
  b.paint(0xffe3a3, Surf.Emissive, 10).box(9.5, 4.0, 17.4, 26.5, 4.2, 17.45, { top: null, bottom: null, nx: null, px: null, nz: null });
  for (let k = 0; k < 4; k++) b.paint(k === 0 ? 0xd9ae2a : 0x1f5fa8, Surf.Metal).box(12 + k * 2.4, 1.6, 13.4, 14.1 + k * 2.4, 2.5, 14.6);

  // --- drop tower (front-right): emissive bands every 8 m + glowing crown
  const dtx = 38, dtz = 38;
  b.paint(padC, Surf.Pavement).cylinder(dtx, dtz, 0, 0.6, 5, 5, 12);
  b.paint(0xcfd2d5, Surf.Metal).cylinder(dtx, dtz, 0.6, 52, 1.3, 1.0, 8);
  b.paint(0xc9463a, Surf.Metal).cylinder(dtx, dtz, 14, 2.2, 3.2, 3.2, 12);
  b.paint(0x8fdcff, Surf.Emissive, 10);
  for (let y = 8; y <= 48; y += 8) {
    const r = 1.3 - ((y - 0.6) / 52) * 0.3 + 0.06;
    cylWall(b, dtx, dtz, y, y + 0.55, r, r, 8);
  }
  b.paint(0x2b2f36, Surf.Metal).cylinder(dtx, dtz, 52.6, 2.2, 2.4, 2.0, 8);
  b.paint(0x7fdbff, Surf.Emissive).cylinder(dtx, dtz, 54.8, 1.6, 2.0, 1.2, 8);
  b.paint(0xe74c3c, Surf.Emissive).cylinder(dtx, dtz, 56.4, 1.2, 0.2, 0.1, 4);

  // --- carousel (left) with night-lit canopy stripes + valance lights
  const cx = -22, cz = 22;
  b.paint(0xb58f4a, Surf.Metal).cylinder(cx, cz, 0, 0.7, 6.4, 6.4, 12);
  b.paint(0xd8d2c4, Surf.Plain).cylinder(cx, cz, 0.7, 5.2, 1.2, 1.2, 10, { top: false });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const hx = cx + Math.cos(a) * 4.6, hz = cz + Math.sin(a) * 4.6;
    b.paint(0xb58f4a, Surf.Metal).cylinder(hx, hz, 0.7, 4.5, 0.06, 0.06, 3, { top: false });
    b.push().translate(hx, 1.4 + (i % 2) * 0.4, hz).rotateY(-a);
    b.paint([0xd8d2c4, 0x3a2a1a, 0xd9ae2a, 0xc8b49a][i % 4], Surf.Plain).box(-0.25, 0, -0.8, 0.25, 0.7, 0.8, { bottom: null });
    b.pop();
  }
  stripedWall(b, cx, cz, 5.4, 6.2, 6.5, 14, 0xc9342b, 0xd8d2c4, true);
  b.paint(0xffe3a3, Surf.Emissive);
  cylWall(b, cx, cz, 5.1, 5.4, 6.5, 6.5, 14);
  stripedCone(b, cx, cz, 6.2, 3.4, 6.9, 14, 0xc9342b, 0xd8d2c4, true);
  b.paint(0xffd166, Surf.Emissive).cylinder(cx, cz, 9.6, 1.2, 0.35, 0.1, 6);

  // --- teacups (front-left)
  b.paint(padC, Surf.Pavement);
  disc(b, -21, 37.5, 0.15, 7.6, 16);
  teacups(b, -21, 37.5, 0.15);

  // --- big top circus tent (left, on its own pad)
  const tx = -21, tz = -2;
  b.paint(padC, Surf.Pavement);
  disc(b, tx, tz, 0.15, 11.4, 18);
  stripedWall(b, tx, tz, 0, 4.5, 9.5, 14, 0x2e5aa8, 0xd8d2c4, true);
  stripedCone(b, tx, tz, 4.5, 7.5, 10.2, 14, 0x2e5aa8, 0xd8d2c4, true);
  b.paint(0xc9342b, Surf.Plain).cylinder(tx, tz, 11.5, 2.5, 0.12, 0.08, 4).quad2([tx, 14, tz], [tx + 2, 13.5, tz], [tx, 13, tz], [tx, 13, tz]);

  // --- log flume on the far left: raised wooden channel with water, lift, drop and splash pool
  const F: [number, number, number][] = [
    [-41, 34, 1.2], [-44.5, 24, 1.2], [-45, 10, 1.6], [-44.5, -4, 3.5], [-43.5, -16, 7.5], [-40, -21, 8], [-37.5, -15, 7.6], [-38, -2, 7.2], [-38.5, 12, 6.6],
    [-38.5, 20, 5.6], [-39, 26, 1.4], [-39.5, 30, 1.2],
  ];
  const fl = splineClosed3(F.map(([x, z, yy]) => [x, yy, z] as V3), 2);
  b.paint(0x7a5a3a, Surf.Wood);
  track3D(b, fl, 2.6, 0.9, { closed: true, bottom: false });
  b.paint(0x3c8aa6, Surf.Water);
  track3D(b, fl.map(([x, y, z]) => [x, y + 0.02, z] as V3), 1.8, 0.05, { closed: true, bottom: false });
  b.paint(0x5a4330, Surf.Wood);
  for (let i = 0; i < fl.length; i += 3) {
    const [px, py, pz] = fl[i];
    if (py > 2.2) b.beam([px, 0, pz], [px, py - 0.9, pz], 0.3);
  }
  pond(b, rng, -41.5, 31.5, 4.2, 3.4, { n: 12, rimSides: false, rimW: 0.6, water: 0x3a8aa6, y: 0.06 });
  for (const k of [3, 9, 16]) {
    const [px, py, pz] = fl[k];
    b.paint(0x8a5a34, Surf.Wood).box(px - 0.6, py + 0.05, pz - 1.3, px + 0.6, py + 0.6, pz + 1.3);
  }

  // --- pirate ship (back, between wheel and coaster)
  b.paint(padC, Surf.Pavement).slab(-15, -26, -3, -12.5, 0.15);
  pirateShip(b, -9, -19.5, 11, 0.42);

  // --- swing ride (chair-o-plane)
  const sx = 17, sz = 32;
  b.paint(padC, Surf.Pavement).cylinder(sx, sz, 0, 0.3, 6.5, 6.5, 10);
  b.paint(0xd9ae2a, Surf.Metal).cylinder(sx, sz, 0.3, 12, 0.6, 0.45, 8);
  b.push().translate(sx, 12.3, sz).rotateZ(0.14);
  stripedCone(b, 0, 0, 0, 1.6, 4.2, 12, 0x2e7ab0, 0xd8d2c4, true);
  b.paint(0xffe3a3, Surf.Emissive).cylinder(0, 0, -0.5, 0.5, 4.2, 4.2, 12, { top: false });
  b.paint(0xc8ccd0, Surf.Metal);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const ox = Math.cos(a) * 4.0, oz = Math.sin(a) * 4.0, ex = Math.cos(a) * 6.2, ez = Math.sin(a) * 6.2;
    b.beam([ox, -0.4, oz], [ex, -6.5, ez], 0.05);
    b.paint([0xc9463a, 0x2ea860, 0xd9ae2a][i % 3], Surf.Plain).box(ex - 0.3, -6.9, ez - 0.3, ex + 0.3, -6.5, ez + 0.3);
    b.paint(0xc8ccd0, Surf.Metal);
  }
  b.pop();

  // --- six food stalls with striped awnings and lit counters
  const stalls: [number, number, number][] = [[-7.4, 34, 1], [-7.4, 27, 1], [7.4, 34, -1], [7.4, 27, -1], [-13, -6, 1], [13, -6, -1]];
  stalls.forEach(([xx, zz, s], i) => {
    const c = [0xc9463a, 0x2e78ae, 0x2ea860, 0xd08a1e, 0x8a55a8, 0xc9463a][i];
    b.paint(0xd8d2c4, Surf.Plain).box(xx - 1.2, PY, zz - 1.8, xx + 1.2, 2.6, zz + 1.8);
    for (let k = 0; k < 4; k++) b.paint(k % 2 ? 0xd8d2c4 : c, k % 2 ? Surf.Emissive : Surf.Plain, k % 2 ? 10 : 0).box(xx - 1.4, 2.6, zz - 2.0 + k, xx + 1.4, 2.9, zz - 1.0 + k);
    b.paint(0xffe3a3, Surf.Emissive).box(xx + s * 1.21, 1.9, zz - 1.4, xx + s * 1.26, 2.4, zz + 1.4, { top: null, bottom: null });
  });
  for (const [x, z, c] of [[-5, -8, 0xc9463a], [9, 20, 0x2e78ae], [-9, 20, 0x2ea860], [22, 20, 0xd9ae2a]] as [number, number, number][]) umbrella(b, x, z, c, 1.5, 2.6);

  // --- festoon string lights along the promenade and around the hub
  festoon(b, [[-4.2, 46], [-4.2, 16]], 8, PY);
  festoon(b, [[4.2, 46], [4.2, 16]], 8, PY);
  festoon(b, arcPts(0, 4, 13.2, 0.35, TAU - 0.35 + 0.0001, 8).map(([x, z]) => [x, z] as P2), 12, PY);
  // trees + lamps with pools
  for (const [x, z, k] of [[-46, 44, 'round'], [46, 22, 'cone'], [-46, -44, 'oak'], [26, 44, 'round']] as [number, number, 'oak'][]) tree(b, rng, x, z, 1.0, k);
  for (const [x, z] of [[-14, 28], [14, 28], [-14, 14], [14, 14], [22, -8], [-26, 10], [28, 38], [-30, -16]] as P2[]) lamp(b, x, z, 4.4, 1, pools);
  for (let i = 0; i < 6; i++) person(b, rng, rng.range(-3, 3), rng.range(16, 40), PY, rng.range(0, TAU));
}

/** Closed Catmull-Rom spline in 3D. */
function splineClosed3(ctrl: V3[], perSeg: number): V3[] {
  const n = ctrl.length;
  const out: V3[] = [];
  for (let s = 0; s < n; s++) {
    const p0 = ctrl[(s - 1 + n) % n], p1 = ctrl[s], p2 = ctrl[(s + 1) % n], p3 = ctrl[(s + 2) % n];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b2: number, c: number, d: number) => 0.5 * (2 * b2 + (-a + c) * t + (2 * a - 5 * b2 + 4 * c - d) * t2 + (-a + 3 * b2 - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])]);
    }
  }
  return out;
}

// ================================================================================================ ZOO
function elephant(b: ModelBuilder, x: number, z: number, rot: number, s = 1): void {
  b.push().translate(x, 0, z).rotateY(rot).scale(s);
  const c = 0x8c8a86;
  b.paint(c, Surf.Plain).blob(0, 2.0, 0, 1.1, 1.0, 1.7, 0, 0.06, 3);
  for (const [lx, lz] of [[-0.55, -1.0], [0.55, -1.0], [-0.55, 0.9], [0.55, 0.9]]) b.box(lx - 0.28, 0, lz - 0.28, lx + 0.28, 1.4, lz + 0.28, { bottom: null });
  b.blob(0, 2.5, 1.9, 0.7, 0.7, 0.65, 0, 0.05, 5);
  b.paint(shade(c, 0.9), Surf.Plain).beam([0, 2.3, 2.45], [0, 0.6, 2.75], 0.3);
  b.quad2([0.5, 3.0, 1.7], [1.35, 2.6, 1.3], [1.2, 1.7, 1.4], [0.55, 2.0, 1.8]);
  b.quad2([-0.55, 2.0, 1.8], [-1.2, 1.7, 1.4], [-1.35, 2.6, 1.3], [-0.5, 3.0, 1.7]);
  b.paint(0xf1ede2, Surf.Plain).beam([0.3, 2.1, 2.3], [0.35, 1.7, 2.9], 0.1).beam([-0.3, 2.1, 2.3], [-0.35, 1.7, 2.9], 0.1);
  b.pop();
}

function giraffe(b: ModelBuilder, x: number, z: number, rot: number, s = 1): void {
  b.push().translate(x, 0, z).rotateY(rot).scale(s);
  const c = 0xd9a441;
  b.paint(c, Surf.Plain).box(-0.45, 1.9, -0.9, 0.45, 2.7, 0.9);
  for (const [lx, lz] of [[-0.3, -0.75], [0.3, -0.75], [-0.3, 0.75], [0.3, 0.75]]) b.box(lx - 0.1, 0, lz - 0.1, lx + 0.1, 1.95, lz + 0.1, { bottom: null, top: null });
  b.beam([0, 2.5, 0.75], [0, 4.9, 1.5], 0.35);
  b.paint(shade(c, 0.95), Surf.Plain).box(-0.22, 4.7, 1.3, 0.22, 5.1, 2.1);
  b.paint(0x7a4f24, Surf.Plain).box(-0.46, 2.2, -0.5, 0.46, 2.5, 0.2, { bottom: null, top: null });
  b.pop();
}

function zebra(b: ModelBuilder, x: number, z: number, rot: number): void {
  b.push().translate(x, 0, z).rotateY(rot);
  b.paint(0xeeeeea, Surf.Plain).box(-0.3, 0.8, -0.8, 0.3, 1.35, 0.8);
  b.paint(0x2a2a2a, Surf.Plain).box(-0.31, 0.85, -0.5, 0.31, 1.3, -0.3, { bottom: null }).box(-0.31, 0.85, 0.1, 0.31, 1.3, 0.3, { bottom: null });
  b.paint(0xeeeeea, Surf.Plain).beam([0, 1.2, 0.7], [0, 1.7, 1.1], 0.25);
  for (const [lx, lz] of [[-0.18, -0.6], [0.18, 0.6]]) b.box(lx - 0.08, 0, lz - 0.08, lx + 0.08, 0.8, lz + 0.08, { top: null, bottom: null });
  b.pop();
}

function lion(b: ModelBuilder, x: number, z: number, rot: number, y = 0): void {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(0xc89a55, Surf.Plain).box(-0.35, 0.4, -0.8, 0.35, 0.9, 0.7);
  b.paint(0x8a5a2b, Surf.Plain).box(-0.45, 0.55, 0.6, 0.45, 1.25, 1.1);
  b.paint(0xc89a55, Surf.Plain).box(-0.2, 0.7, 1.1, 0.2, 1.05, 1.35).box(-0.3, 0, -0.6, 0.3, 0.45, 0.5, { top: null, bottom: null });
  b.pop();
}

/** Low stone wall around a polygon (with optional gap edge index). */
function lowWall(b: ModelBuilder, poly: P2[], h = 1.0, t = 0.5, color = 0xa89f8d, skip = -1): void {
  b.paint(color, Surf.Stone);
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    if (i === skip) continue;
    const a = poly[i], c = poly[(i + 1) % n];
    b.beam([a[0], 0, a[1]], [c[0], 0, c[1]], t);
    void h;
  }
}

function parkZoo(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 48;
  lawnPatchwork(b, rng, -E, -E, E, E, GRASS_LUSH, 3, YL.lawn, [[0, 0, 40, 40]]);
  const pave = 0xc4b393;
  // main loop path near the edges, entrance axis, center spur to the monkey island
  const loop = path(b, [[0, 30], [24, 30], [38, 15], [38, -14], [26, -35], [0, -39], [-26, -35], [-38, -14], [-38, 15], [-24, 30]], 4.2, pave, YL.path, 4, true);
  const axis = path(b, [[0, 48], [0, 30]], 6, pave);
  b.paint(pave, Surf.Pavement);
  disc(b, 0, 32, YL.top, 6.5, 16);
  const spur1 = path(b, [[0, 30], [0, 14], [0, 7]], 3.4, pave);
  const spur2 = path(b, [[0, -39], [0, -24], [0, -11]], 3.4, pave);
  const pathQuads = [...ribbonQuads(loop, 4.2, true), ...ribbonQuads(axis, 6), ...ribbonQuads(spur1, 3.4), ...ribbonQuads(spur2, 3.4)];
  const pools = [...lawnPathPool(pathQuads, pave), { color: pave, y: YL.top, clip: [circlePoly(0, 32, 6.5, 16)] } as PoolSpec];
  // clipped hedge strips flanking the entrance axis
  for (const s of [-1, 1]) hedgeBox(b, s * 3.4 - 0.4, 38.5, s * 3.4 + 0.4, 47.2, 1.3, 0x3d6127);

  // enclosure helper: ground polygon + low stone wall
  const encl = (cx: number, cz: number, rx: number, rz: number, ground: number, rot = 0): P2[] => {
    const poly = blobPoly(rng, cx, cz, rx, rz, 9, 0.14, rot);
    b.paint(ground, Surf.Foliage);
    flatPoly(b, poly, 0.1);
    b.paint(0xa89f8d, Surf.Stone);
    for (let i = 0; i < poly.length; i++) orientWallSeg(b, poly[i], poly[(i + 1) % poly.length], 1.1, 0.45);
    return poly;
  };
  const S = 1.6; // animals exaggerated so they read from the game camera

  // 1) elephants (inside loop, back-left)
  encl(-20, -18, 12.5, 11, 0xb89a6a, 0.2);
  pond(b, rng, -24, -22, 4.6, 3, { rim: 0x9a8a6a, rimW: 0.6, n: 12, rimSides: false });
  elephant(b, -16, -15, 0.8, S);
  elephant(b, -21, -12.5, 2.4, S * 0.75);
  tree(b, rng, -13, -24, 1.0, 'acacia');
  boulderZ(b, rng, -28, -13, 1.2);
  boulderZ(b, rng, -25, -9.5, 0.9);

  // 2) lions on rocks (inside loop, front-left)
  encl(-20, 13, 11.5, 9, 0xb3a869, -0.1);
  for (const [x, z, r] of [[-22, 12, 2.6], [-19, 15.5, 1.9], [-25.5, 15, 2.0]] as V3[]) boulderZ(b, rng, x, z, r);
  b.push().translate(-21.5, 1.9, 12).scale(S).translate(21.5, -1.9, -12);
  lion(b, -21.5, 12, 0.5, 1.9);
  b.pop();
  b.push().translate(-15, 0, 9.5).scale(S).translate(15, 0, -9.5);
  lion(b, -15, 9.5, 2.0, 0);
  b.pop();
  tree(b, rng, -13, 17, 0.9, 'acacia');

  // 3) savanna with giraffes and zebras (inside loop, back-right)
  encl(20, -17, 12.5, 12, 0xbfb472, -0.15);
  giraffe(b, 16, -18, 0.5, S);
  giraffe(b, 23, -13, 2.6, 0.9 * S);
  giraffe(b, 25, -21, 4.0, S);
  for (const [x, z, r] of [[14, -11, 1.2], [16.5, -9.5, 1.4]] as V3[]) {
    b.push().translate(x, 0, z).scale(S).translate(-x, 0, -z);
    zebra(b, x, z, r);
    b.pop();
  }
  tree(b, rng, 27, -12, 1.1, 'acacia');
  tree(b, rng, 13, -24, 0.95, 'acacia');

  // 4) penguin pool (inside loop, front-right)
  encl(20, 13, 11, 8.5, 0xe4e7ea, 0.1);
  pond(b, rng, 21, 13, 7, 4.8, { rim: 0xf4f6f8, water: 0x3a88b0, rimW: 0.9, n: 14, rimSides: false });
  boulderZ(b, rng, 12.5, 14, 1.2);
  for (let i = 0; i < 6; i++) {
    const x = 13.5 + (i % 3) * 1.3 + rng.range(-0.2, 0.2), z = 8.6 + Math.floor(i / 3) * 1.6 + rng.range(-0.2, 0.2);
    b.paint(0x1d1f22, Surf.Plain).cylinder(x, z, 0.1, 1.1, 0.35, 0.22, 5, { top: false });
    b.paint(0xd8d8d2, Surf.Plain).box(x - 0.19, 0.3, z + 0.16, x + 0.19, 0.95, z + 0.36, { bottom: null });
  }

  // 5) monkey island in the middle: moat, rocky island, climbing frame, tree
  const mx = 0, mz = -2;
  b.paint(0x3a7a8c, Surf.Water);
  disc(b, mx, mz, 0.1, 6.6, 16);
  b.paint(0xa89f8d, Surf.Stone);
  cylWall(b, mx, mz, 0, 0.8, 7.1, 7.1, 16);
  annulus(b, mx, mz, 0.8, 6.6, 7.1, 16);
  b.paint(0x7a8a4a, Surf.Foliage).cylinder(mx, mz, 0, 0.6, 4.2, 3.9, 10);
  boulderZ(b, rng, mx - 1.2, mz - 1.5, 1.8);
  b.paint(0x8a6440, Surf.Wood);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.beam([mx + 1.6 + dx * 1.1, 0.5, mz + 0.8 + dz * 1.1], [mx + 1.6 + dx * 0.4, 5.5, mz + 0.8 + dz * 0.4], 0.2);
  b.box(mx + 0.8, 3.2, mz, mx + 2.4, 3.4, mz + 1.6);
  b.beam([mx + 1.6, 5.2, mz + 0.8], [mx - 2, 3.5, mz + 2.5], 0.08);
  tree(b, rng, mx - 2.2, mz + 1.4, 0.8, 'oak');

  // 6) aviary dome (front-left corner, outside the loop)
  const ax = -36, az = 37, R = 9;
  b.paint(0x7aa05a, Surf.Foliage);
  disc(b, ax, az, 0.1, R, 14);
  tree(b, rng, ax - 2.5, az - 1.5, 0.85, 'round');
  tree(b, rng, ax + 3, az + 2, 0.75, 'palm');
  pond(b, rng, ax + 2, az - 3.5, 2.2, 1.5, { rimW: 0.5, n: 10, rimSides: false });
  b.paint(0xe8ecef, Surf.Metal);
  const sph = (a: number, t: number): V3 => [ax + Math.cos(a) * R * Math.cos(t), R * Math.sin(t), az + Math.sin(a) * R * Math.cos(t)];
  for (const t of [0.5, 0.95]) {
    const seg = 12;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
      b.quad2(sph(a0, t), sph(a1, t), sph(a1, t + 0.05), sph(a0, t + 0.05));
    }
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2, da = 0.04;
    for (let k = 0; k < 4; k++) {
      const t0 = (k / 4) * 1.45, t1 = ((k + 1) / 4) * 1.45;
      b.quad2(sph(a - da, t0), sph(a + da, t0), sph(a + da, t1), sph(a - da, t1));
    }
  }
  b.paint(0xdfe8ee, Surf.GlassPlain);
  lathe(b, ax, az, [[R * 0.25, R * 0.99], [0, R * 1.0]], 8);

  // 7) tropical house (front-right corner): brick hall with a glowing glass barrel roof on metal ribs
  b.paint(0x8a5a44, Surf.Brick).box(27, 0, 33, 45, 4.2, 42);
  b.push().translate(36, 4.2, 37.5).rotateZ(Math.PI / 2);
  b.paint(0xbcd8cf, Surf.GlassPlain, 2).cylinder(0, 0, -9, 18, 4.5, 4.5, 10, { top: true, bottom: true });
  b.pop();
  b.paint(0x5d6770, Surf.Metal);
  for (let i = 0; i < 10; i++) {
    const x = 27.4 + (i * 17.2) / 9;
    const rib: V3[] = [];
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * Math.PI;
      rib.push([x, 4.2 + Math.sin(a) * 4.6, 37.5 + Math.cos(a) * 4.6]);
    }
    track3D(b, rib, 0.18, 0.18);
  }
  // visitor restaurant by the entrance (16 x 10, hip roof, glazed band, terrace umbrellas)
  b.paint(0xc9bca2, Surf.Plain).box(-25, 0, 34.5, -9, 4.2, 44.5);
  b.paint(0x2e3a44, Surf.GlassPlain, 2).box(-24.6, 0.8, 44.5, -9.4, 3.2, 44.56, { top: null, bottom: null, nx: null, px: null, nz: null });
  b.paint(0x2e3a44, Surf.GlassPlain, 2).box(-8.96, 0.8, 35.2, -8.9, 3.2, 43.8, { top: null, bottom: null, nx: null, pz: null, nz: null });
  b.paint(0x6b3f2e, Surf.RoofTiles).hipRoof(-17, 39.5, 16, 10, 4.2, 3.0, 0.6);
  b.paint(0xb3a488, Surf.Pavement).slab(-8.8, 34.5, -4.4, 44.5, YL.top);
  b.paint(0x2e3a44, Surf.GlassPlain).box(33, 0.3, 41.95, 39, 3.2, 42.05, { top: null, bottom: null, nx: null, px: null, nz: null });

  // entrance gate with thatched huts + sign
  for (const s of [-1, 1]) {
    b.paint(0x8a6440, Surf.Wood).cylinder(s * 6.5, 42, 0, 5.5, 2.0, 2.0, 8);
    b.paint(0xc9a86a, Surf.Plain).cone(s * 6.5, 42, 5.3, 3.4, 3.0, 8, false);
  }
  b.paint(0x5b4330, Surf.Wood).box(-6.5, 5.6, 41.4, 6.5, 7.0, 42.6);
  b.paint(0xf5d76e, Surf.Emissive).box(-4.6, 5.8, 42.6, 4.6, 6.8, 42.65, { top: null, bottom: null, nx: null, px: null, nz: null });
  // terrace umbrellas
  for (const [x, z, c] of [[-6.6, 36.5, 0x2ea860], [-6.6, 40, 0xd9ae2a], [-6.6, 43.3, 0xd0752a]] as [number, number, number][]) umbrella(b, x, z, c, 1.4, 2.4);
  // greenery: tree clumps (~25 crowns) + a few solitary trees around the loop
  treeClump(b, rng, -44, -40, 4.5, 6);
  treeClump(b, rng, 43, -40, 4.5, 6);
  treeClump(b, rng, 0, -44.5, 5, 5);
  treeClump(b, rng, 44.5, 22, 3.5, 4);
  treeClump(b, rng, -44.5, 24, 3.5, 4);
  for (const [x, z, k] of [[-44, -8, 'oak'], [44, -4, 'round'], [9, 20, 'round'], [-9, -22, 'oak']] as [number, number, 'oak'][]) tree(b, rng, x, z, 1.0, k);
  for (const i of [3, 9, 15, 21, 27, 33]) {
    const [x, z] = loop[i % loop.length];
    const l = Math.hypot(x, z) || 1;
    lamp(b, x + (x / l) * 2.9, z + (z / l) * 2.9, 4.2, 1, pools);
  }
  for (const x of [-5, 5]) lamp(b, x, 36.8, 4.2, 1, pools);
  // shrubs softening the paths between the enclosures
  for (const [x, z, r] of [[-6, 22, 1.2], [6, 22, 1.1], [-7, -30, 1.2], [7, -30, 1.3], [-33, 0, 1.1]] as V3[]) shrub(b, rng, x, z, r);
  for (let i = 0; i < 4; i++) {
    const p = loop[rng.int(0, loop.length - 1)];
    person(b, rng, p[0] + rng.range(-1, 1), p[1] + rng.range(-1, 1), 0.09, rng.range(0, TAU));
  }
}

/** Low wall segment along a->c (box rotated to the segment). */
function orientWallSeg(b: ModelBuilder, a: P2, c: P2, h: number, t: number): void {
  const dx = c[0] - a[0], dz = c[1] - a[1];
  const l = Math.hypot(dx, dz);
  b.push().translate(a[0], 0, a[1]).rotateY(Math.atan2(dx, dz));
  b.box(-t / 2, 0, 0, t / 2, h, l, { bottom: null, nz: null, pz: null });
  b.pop();
}

function boulderZ(b: ModelBuilder, rng: RNG, x: number, z: number, r: number): void {
  b.paint(shade(0x9a9184, rng.range(0.85, 1.1)), Surf.Stone).blob(x, r * 0.4, z, r, r * 0.75, r * rng.range(0.75, 1.0), 0, 0.22, rng.next() * 10);
}

// ================================================================================================ GOLF
/** Polygon around a spine with per-point half widths. */
function spinePoly(spine: P2[], hw: (t: number) => number): P2[] {
  const L: P2[] = [], R: P2[] = [];
  for (let i = 0; i < spine.length; i++) {
    const p = spine[Math.max(0, i - 1)], q = spine[Math.min(spine.length - 1, i + 1)];
    const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
    const w = hw(i / (spine.length - 1));
    L.push([spine[i][0] - (dz / l) * w, spine[i][1] + (dx / l) * w]);
    R.push([spine[i][0] + (dz / l) * w, spine[i][1] - (dx / l) * w]);
  }
  return [...L, ...R.reverse()];
}

function parkGolf(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 48;
  lawnPatchwork(b, rng, -E, -E, E, E, 0x4f7d31, 3);
  const fairA = 0x7fb24f, fairB = 0x74a547, greenC = 0x8fcc5e, teeC = 0x86c05a, sand = 0xd9cba0;
  const hole = (ctrl: P2[], w0: number, w1: number, greenR: number, bunkers: P2[]) => {
    const spine = spline(ctrl, 6);
    // two-tone mowing stripes across the fairway (alternating every 2 spine steps)
    const n = spine.length;
    const hwAt = (t: number) => w0 + (w1 - w0) * t + Math.sin(t * 9) * 1.2;
    const Lp: P2[] = [], Rp: P2[] = [];
    for (let i = 0; i < n; i++) {
      const p = spine[Math.max(0, i - 1)], q = spine[Math.min(n - 1, i + 1)];
      const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
      const w = hwAt(i / (n - 1));
      Lp.push([spine[i][0] - (dz / l) * w, spine[i][1] + (dx / l) * w]);
      Rp.push([spine[i][0] + (dz / l) * w, spine[i][1] - (dx / l) * w]);
    }
    for (let i = 0; i < n - 1; i++) {
      b.paint(Math.floor(i / 2) % 2 ? fairA : fairB, Surf.Foliage);
      flatPoly(b, [Lp[i], Lp[i + 1], Rp[i + 1], Rp[i]], YL.path);
    }
    const tee = ctrl[0], g = ctrl[ctrl.length - 1];
    b.paint(teeC, Surf.Foliage).box(tee[0] - 2.2, 0, tee[1] - 2.2, tee[0] + 2.2, 0.25, tee[1] + 2.2);
    b.paint(greenC, Surf.Foliage);
    flatPoly(b, blobPoly(rng, g[0], g[1], greenR, greenR * 0.8, 12, 0.15), YL.top);
    // pin with a 1.5 m flag
    b.paint(0xd8d8d2, Surf.Metal).cylinder(g[0], g[1], 0.1, 3.0, 0.05, 0.05, 4);
    b.paint(0xd6362c, Surf.Plain).quad2([g[0], 3.0, g[1]], [g[0] + 1.5, 2.6, g[1]], [g[0], 2.2, g[1]], [g[0], 2.2, g[1]]);
    b.paint(sand, Surf.Pavement);
    for (const [bx, bz] of bunkers) flatPoly(b, blobPoly(rng, bx, bz, rng.range(2.0, 3.2), rng.range(1.4, 2.2), 9, 0.25, rng.range(0, 3)), YL.top + 0.015);
  };
  hole([[-38, 18], [-36, 2], [-30, -14], [-32, -30]], 5.5, 4.5, 4.2, [[-35, -26], [-27.5, -33], [-33.5, -8]]);
  hole([[-18, -38], [-4, -36], [12, -38], [28, -34]], 5, 4.2, 4.0, [[24, -30], [31, -38.5], [6, -33]]);
  hole([[40, -24], [38, -8], [30, 6], [22, 14]], 5.5, 4, 4.5, [[26, 17.5], [18.5, 11], [36, 0]]);
  hole([[-14, -18], [-4, -10], [2, 2], [-6, 12]], 4.6, 4, 3.8, [[-10, 14.5], [-1, 15]]);
  // water hazard between holes
  pond(b, rng, 14, -14, 8, 5.5, { rimW: 0.4, rim: 0x6b8a4a, reeds: 6, rot: 0.4 });
  // cart path (short spur from the clubhouse to the first tees)
  b.paint(0xa9a397, Surf.Pavement);
  ribbon(b, spline([[-24, 30], [-27, 22], [-32, 17], [-30, 6], [-24, -2]], 5), 1.2, YL.path);
  // clubhouse (front-left) + parking
  const hx = -22, hz = 38;
  b.paint(PATH_PAVE, Surf.Pavement).slab(-40, 31, -4, 47.5, YL.path);
  const cream = 0xe9dfc8;
  b.paint(cream, Surf.Plain).box(hx - 11, 0.1, hz - 5, hx + 11, 7.0, hz + 4);
  // glazed bands (ground floor + upper floor) on the front and back
  for (const zf of [hz + 4.02, hz - 5.02]) {
    for (const [y0, y1] of [[0.9, 3.0], [4.4, 6.0]]) b.paint(0x2e3a44, Surf.GlassPlain, 2).box(hx - 10.2, y0, zf - 0.03, hx + 10.2, y1, zf + 0.03, { top: null, bottom: null, nx: null, px: null });
  }
  b.paint(0x3d4a5a, Surf.RoofTiles).hipRoof(hx, hz - 0.5, 22, 9, 7.0, 3.6, 0.6);
  // veranda: deck, columns, roof, railing
  b.paint(0x9a7a55, Surf.Wood).box(hx - 9.4, 0.1, hz + 4, hx + 9.4, 0.5, hz + 7.2);
  b.paint(cream, Surf.Plain);
  for (let i = 0; i < 7; i++) b.cylinder(hx - 9 + i * 3, hz + 6.9, 0.5, 3.8, 0.2, 0.18, 6);
  b.beam([hx - 9.2, 1.3, hz + 7.05], [hx + 9.2, 1.3, hz + 7.05], 0.1);
  b.paint(0x3d4a5a, Surf.RoofTiles).box(hx - 9.6, 4.3, hz + 4, hx + 9.6, 4.6, hz + 7.5, { bottom: null });
  b.paint(0x2c3e50, Surf.Plain).box(hx - 3, 7.8, hz - 1, hx + 3, 10.4, hz + 0.5);
  b.paint(0x3d4a5a, Surf.RoofTiles).pyramid(hx, hz - 0.25, 6.6, 2.2, 10.4, 1.0);
  for (let i = 0; i < 7; i++) car(b, -1.5 - i * 0.0 + (i % 2) * 0, 32.5 + i * 2.2, Math.PI / 2, rng.pick([0xb8bcc2, 0x2b2d31, 0xf1f1ef, 0x1f3f7a, 0x8a1c1c]), 0.1);
  b.paint(PALETTE.asphalt, Surf.Pavement).slab(-4, 31, 6, 47.5, YL.path);
  for (let i = 0; i < 5; i++) car(b, 1.5, 33 + i * 3, Math.PI / 2, rng.pick([0xb8bcc2, 0x2b2d31, 0xf1f1ef, 0x1f3f7a, 0x8a1c1c]), 0.1);
  // putting green near the clubhouse
  b.paint(greenC, Surf.Foliage);
  flatPoly(b, blobPoly(rng, 16, 38, 7, 4.5, 12, 0.15), 0.085);
  for (const [x, z] of [[13, 37], [19, 39.5]] as P2[]) b.paint(0xf4f4f4, Surf.Metal).cylinder(x, z, 0.08, 1.2, 0.03, 0.03, 4);
  // tree clumps lining the holes
  for (const [x, z, r, n] of [[-44, -2, 4, 5], [-24, -14, 4, 5], [-6, -44.5, 5, 6], [34, -44, 4, 5], [45, -18, 3, 4], [42, 10, 4, 5], [8, 20, 3.5, 4], [-20, 14, 3.5, 4]] as [number, number, number, number][]) treeClump(b, rng, x, z, r, n);
  const trees: [number, number, 'oak' | 'cone' | 'round' | 'poplar'][] = [
    [-45, 12, 'cone'], [-45, -4, 'oak'], [-44, -20, 'cone'], [-44, -40, 'round'], [-24, 4, 'oak'], [-22, -16, 'round'], [-12, -44, 'cone'],
    [2, -45, 'oak'], [18, -45, 'cone'], [40, -42, 'round'], [45, -30, 'cone'], [45, -8, 'oak'], [44, 12, 'round'], [18, 0, 'oak'],
    [10, 18, 'round'], [-18, 20, 'cone'], [40, 30, 'oak'], [30, 42, 'round'], [-44, 30, 'oak'], [4, -22, 'round'],
    [-42, -30, 'cone'], [-20, -44, 'round'], [26, -45, 'round'], [46, -18, 'oak'], [8, -12, 'cone'], [-14, 0, 'round'], [-26, 24, 'round'],
    [36, 22, 'cone'], [21, 26, 'oak'], [-8, 24, 'round'],
  ];
  for (const [x, z, k] of trees) tree(b, rng, x, z, rng.range(0.95, 1.25), k);
  // golfers + carts
  for (const [x, z] of [[-36, 16], [-31, -28], [23, 13], [-5, 11]] as P2[]) person(b, rng, x, z, 0.08, rng.range(0, TAU));
  for (const [x, z, r] of [[-25, 12, 0.3], [30, -20, 2.0]] as V3[]) {
    b.push().translate(x, 0.1, z).rotateY(r);
    b.paint(0xf4f4f0, Surf.Plain).box(-0.7, 0.3, -1.2, 0.7, 0.9, 1.2);
    b.paint(0x2e7d4f, Surf.Plain).box(-0.75, 1.9, -1.1, 0.75, 2.0, 0.9);
    b.paint(0x888888, Surf.Metal).box(-0.65, 0.9, 0.7, -0.55, 1.9, 0.8).box(0.55, 0.9, 0.7, 0.65, 1.9, 0.8);
    b.pop();
  }
  for (const [x, z] of [[-30, 32.5], [-14, 32.5], [-36, 44]] as P2[]) lamp(b, x, z, 4.2, 0, [{ color: PATH_PAVE, y: YL.path, dy: 0.012, clip: [rectPoly(-40, 31, -4, 47.5)] }]);
}

export const venueModels: ModelBuilders = {
  park_stadium: parkStadium,
  park_amusement: parkAmusement,
  park_zoo: parkZoo,
  park_golf: parkGolf,
};

// silence unused-import lint for optional helpers kept for iteration
void shrub; void flowerBed; void roundBed; void parkBench; void railFence; void panelFence; void disc; void track3D; void orientQuad; void wall;
void GRASS_DARK; void MEADOW; void PATH_GRAVEL; void lowWall;
