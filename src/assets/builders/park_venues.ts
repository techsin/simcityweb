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
  blobPoly, spline, track3D, shade, stripedCone, stripedWall, offsetPoly, orientQuad, wall, inPoly,
  GRASS_LUSH, GRASS_DARK, MEADOW, PATH_GRAVEL, PATH_PAVE,
} from './park_lib';

const TAU = Math.PI * 2;
const WHITE_LINE = 0xf2f2ee;

// ================================================================================================ STADIUM
function parkStadium(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 48;
  // plaza + corner greens
  b.paint(0xc9c5bb, Surf.Pavement).slab(-E, -E, E, E, 0.08);
  b.paint(0xb4afa4, Surf.Pavement);
  annulus(b, 0, 0, 0.085, 44.5, 46.2, 40);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.paint(GRASS_LUSH, Surf.Foliage);
    flatPoly(b, [[sx * 47.5, sz * 47.5], [sx * 33, sz * 47.5], [sx * 47.5, sz * 33]], 0.1);
    for (let k = 0; k < 3; k++) tree(b, rng, sx * (44.5 - k * 3.2), sz * (41.2 + k * 1.6 - k * 0.2) + (k === 0 ? sz * 3 : 0), 0.9, 'round');
  }
  // --- pitch (glows under the floodlights at night)
  const PW = 50, PD = 32;
  const inner = roundRectPath(0, 0, 58, 42, 12, 7);
  b.paint(0x376c27, Surf.Emissive);
  flatPoly(b, offsetPoly(inner, 0.2), 0.09);
  for (let i = 0; i < 10; i++) {
    b.paint(i % 2 ? 0x356a25 : 0x40792d, Surf.Emissive);
    rect(b, -PW / 2 - 1.5 + ((PW + 3) * i) / 10, -PD / 2 - 1.5, -PW / 2 - 1.5 + ((PW + 3) * (i + 1)) / 10, PD / 2 + 1.5, 0.1);
  }
  b.paint(WHITE_LINE, Surf.Emissive);
  const y = 0.11, w = 0.14;
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
  const facade: Paint = { color: 0xe9e7e1, surf: Surf.Metal };
  const concourse: Paint = { color: 0x9fb6c4, surf: Surf.GlassPlain };
  const rim: Paint = { color: 0xd9d6ce, surf: Surf.Plain };
  const seatsUp: Paint = { color: 0x2c5fa8, surf: Surf.RoofTiles };
  const seatsLo: Paint = { color: 0x2f6bbd, surf: Surf.RoofTiles };
  const boxes: Paint = { color: 0x1d2630, surf: Surf.GlassPlain };
  const soffit: Paint = { color: 0x55595e, surf: Surf.Plain };
  const walk: Paint = { color: 0x8e8b84, surf: Surf.Pavement };
  const ads: Paint = { color: 0x2d7fd0, surf: Surf.Emissive };
  const prof: ProfPt[] = [
    [16, 0.05, concourse], [16, 5.5, facade], [16, 18, rim], [15.3, 18.6, rim], [14.6, 18, seatsUp], [7.2, 10.6, boxes], [7.2, 9.3, soffit], [8.2, 9.3, soffit],
    [8.2, 7.0, seatsLo], [1.4, 1.5, walk], [0.5, 1.5, ads], [0.5, 0.05],
  ];
  loftRing(b, inner, prof, 30);
  // facade: vertical white fins every other path point + entrance portals at the four axes
  b.paint(0xf6f5f1, Surf.Metal);
  const outer = offsetPoly(inner, 16.25);
  for (let i = 0; i < outer.length; i += 2) {
    const [x, z] = outer[i];
    b.beam([x, 5.5, z], [x, 18.4, z], 0.45);
  }
  // --- roof canopy ring with emissive floodlight edge
  const canopy: ProfPt[] = [
    [17.2, 23.2, { color: 0xf1f0ec, surf: Surf.Metal }], [17.2, 24.2, { color: 0xf4f4f2, surf: Surf.Metal }], [6.2, 26.6, { color: 0xfafaff, surf: Surf.Emissive }],
    [6.2, 25.9, { color: 0x6b7077, surf: Surf.Metal }], [17.2, 23.2],
  ];
  loftRing(b, inner, canopy, 20);
  // canopy columns + radial trusses
  const colPts = offsetPoly(inner, 16.6);
  const trussIn = offsetPoly(inner, 7.0);
  b.paint(0xdcdcd8, Surf.Metal);
  for (let i = 1; i < colPts.length; i += 3) {
    const [x, z] = colPts[i];
    b.beam([x, 18, z], [x, 23.5, z], 0.5);
    const [ix, iz] = trussIn[i];
    b.beam([x, 24.3, z], [ix, 26.7, iz], 0.3);
  }
  // big screens above the ends
  for (const s of [-1, 1]) {
    b.push().translate(s * 40.6, 0, 0).rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
    b.paint(0x2a2d31, Surf.Metal).box(-7, 19, -0.6, 7, 23, 0.4);
    b.paint(0x2a4f7a, Surf.Emissive).box(-6.5, 19.4, -0.62, 6.5, 22.6, -0.6, { top: null, bottom: null, nx: null, px: null, pz: null });
    b.pop();
  }
  // --- 4 floodlight masts at the corners
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) floodMast(b, sx * 40.5, sz * 34.5, 44, 0, 0, { bank: 4.5, lattice: true });
  // --- main entrance (+Z): canopy with glowing name board, flags, ticket booths
  b.paint(0xe9e7e1, Surf.Metal).box(-12, 6.5, 36.4, 12, 7.3, 41.5);
  b.paint(0x28323c, Surf.Metal).box(-9, 7.3, 38.8, 9, 10.2, 39.4);
  b.paint(0xffffff, Surf.Emissive).box(-8.4, 7.7, 39.4, 8.4, 9.8, 39.45, { top: null, bottom: null, nx: null, px: null, nz: null });
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
  for (const x of [-38, -20, 20, 38]) lamp(b, x, 44.5, 5.5, 2);
  for (let i = 0; i < 10; i++) person(b, rng, rng.range(-20, 20), rng.range(41, 46), 0.08, rng.range(0, TAU));
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
  const cols = [0xe74c3c, 0xf1c40f, 0x3498db, 0x2ecc71, 0x9b59b6, 0xe67e22];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const gx = x + Math.cos(a) * R, gy = hub + Math.sin(a) * R;
    b.paint(0xb9bec3, Surf.Metal).box(gx - 0.1, gy - 0.1, z - hw, gx + 0.1, gy + 0.1, z + hw, { bottom: null });
    b.paint(cols[i % cols.length], Surf.Plain).box(gx - 0.9, gy - 2.5, z - 0.8, gx + 0.9, gy - 1.1, z + 0.8);
  }
  void rng;
}

function parkAmusement(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 48;
  lawnPatchwork(b, rng, -E, -E, E, E, GRASS_LUSH, 2);
  // promenades (warm pavement)
  const pave = 0xd8c9ad;
  path(b, [[0, 48], [0, 30], [0, 12]], 7, pave);
  b.paint(pave, Surf.Pavement);
  disc(b, 0, 4, 0.095, 13, 24);
  path(b, [[-10, -2], [-18, -8], [-26, -8.5], [-36, -6]], 5.5, pave);
  path(b, [[8, 12], [18, 20], [30, 26], [40, 30]], 5, pave);
  path(b, [[-9, 12], [-18, 20], [-28, 25], [-40, 32]], 5, pave);
  path(b, [[4, -8], [4, -20], [-4, -34], [-12, -40]], 4.5, pave);
  // central fountain
  fountain(b, 0, 4, 4.2, 1, { seg: 12 });

  // --- entrance gate
  for (const s of [-1, 1]) {
    b.paint(0xf3efe6, Surf.Plain).box(s * 6.5 - 1.4, 0, 42, s * 6.5 + 1.4, 9, 44.8);
    stripedCone(b, s * 6.5, 43.4, 9, 4.2, 2.2, 8, 0xd63a2f, 0xf6f1e4);
  }
  b.paint(0x2b2f36, Surf.Metal).box(-5.2, 7, 43.1, 5.2, 9.2, 43.7);
  b.paint(0xffd166, Surf.Emissive).box(-4.8, 7.3, 43.7, 4.8, 8.9, 43.75, { top: null, bottom: null, nx: null, px: null, nz: null });
  for (const x of [-11.5, 11.5]) {
    b.paint(0x2e86c1, Surf.Plain).box(x - 1.3, 0, 43, x + 1.3, 2.6, 45.2);
    b.paint(0xf1c40f, Surf.Plain).pyramid(x, 44.1, 3.0, 2.6, 2.6, 1.2);
  }

  // --- ferris wheel (back-left)
  ferrisWheel(b, -27, -30, 19, 23, 12, rng);
  b.paint(0x8e8b84, Surf.Pavement).slab(-37, -36, -17, -24, 0.12);

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
  b.paint(0xd6312b, Surf.Metal);
  track3D(b, pts, 1.5, 0.45, { closed: true, bottom: false });
  // supports (skip the loop section and anything low)
  b.paint(0xf2f2ee, Surf.Metal);
  const loopStart = 12 * 2, loopEnd = 19 * 2;
  for (let i = 0; i < pts.length; i += 4) {
    const [px, py, pz] = pts[i];
    if (py < 2.5 || (i >= loopStart && i < loopEnd)) continue;
    b.beam([px, 0, pz], [px, py - 0.45, pz], 0.35);
  }
  // loop A-legs
  for (const zz of [-44.5, -38.5]) {
    b.beam([6, 0, zz], [11.5, 16, -41.2], 0.4).beam([17, 0, zz], [11.5, 16, -41.2], 0.4);
  }
  // station
  b.paint(0x2e86c1, Surf.Plain).box(10, 0, 15.8, 26, 3.2, 17.2);
  b.paint(0xf1c40f, Surf.Metal).box(9.5, 4.2, 11.8, 26.5, 4.5, 17.4);
  b.paint(0xdddddd, Surf.Metal);
  for (const x of [10, 18, 26]) b.box(x - 0.15, 0, 11.9, x + 0.15, 4.2, 12.2);
  // coaster train in the station
  for (let k = 0; k < 4; k++) {
    b.paint(k === 0 ? 0xf1c40f : 0x1f5fa8, Surf.Metal).box(12 + k * 2.4, 1.6, 13.4, 14.1 + k * 2.4, 2.5, 14.6);
  }

  // --- drop tower (front-right) — tall vertical accent with glowing crown
  const dtx = 36, dtz = 38;
  b.paint(0x8e8b84, Surf.Pavement).cylinder(dtx, dtz, 0, 0.6, 5, 5, 12);
  b.paint(0xe9ecef, Surf.Metal).cylinder(dtx, dtz, 0.6, 52, 1.3, 1.0, 8);
  b.paint(0xe74c3c, Surf.Metal).cylinder(dtx, dtz, 14, 2.2, 3.2, 3.2, 12);
  b.paint(0x2b2f36, Surf.Metal).cylinder(dtx, dtz, 52.6, 2.2, 2.4, 2.0, 8);
  b.paint(0x7fdbff, Surf.Emissive).cylinder(dtx, dtz, 54.8, 1.6, 2.0, 1.2, 8);
  b.paint(0xe74c3c, Surf.Emissive).cylinder(dtx, dtz, 56.4, 1.2, 0.2, 0.1, 4);

  // --- carousel (left-front)
  const cx = -20, cz = 20;
  b.paint(0xd4b25a, Surf.Metal).cylinder(cx, cz, 0, 0.7, 6.4, 6.4, 12);
  b.paint(0xf6f1e4, Surf.Plain).cylinder(cx, cz, 0.7, 5.2, 1.2, 1.2, 10, { top: false });
  b.paint(0xd4b25a, Surf.Metal);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const hx = cx + Math.cos(a) * 4.6, hz = cz + Math.sin(a) * 4.6;
    b.paint(0xd4b25a, Surf.Metal).cylinder(hx, hz, 0.7, 4.5, 0.06, 0.06, 3, { top: false });
    b.push().translate(hx, 1.4 + (i % 2) * 0.4, hz).rotateY(-a);
    b.paint([0xffffff, 0x3a2a1a, 0xf1c40f, 0xe8d4b8][i % 4], Surf.Plain).box(-0.25, 0, -0.8, 0.25, 0.7, 0.8, { bottom: null });
    b.pop();
  }
  stripedWall(b, cx, cz, 5.4, 6.2, 6.5, 14, 0xd63a2f, 0xf6f1e4);
  b.paint(0xffe3a3, Surf.Emissive);
  cylWall(b, cx, cz, 5.1, 5.4, 6.5, 6.5, 14);
  stripedCone(b, cx, cz, 6.2, 3.4, 6.9, 14, 0xd63a2f, 0xf6f1e4);
  b.paint(0xffd166, Surf.Emissive).cylinder(cx, cz, 9.6, 1.2, 0.35, 0.1, 6);

  // --- big top circus tent + small tents (left)
  const tx = -33, tz = 3;
  stripedWall(b, tx, tz, 0, 4.5, 9.5, 14, 0x2e5aa8, 0xf6f1e4);
  stripedCone(b, tx, tz, 4.5, 7.5, 10.2, 14, 0x2e5aa8, 0xf6f1e4);
  b.paint(0xd63a2f, Surf.Plain).cylinder(tx, tz, 11.5, 2.5, 0.12, 0.08, 4).quad2([tx, 14, tz], [tx + 2, 13.5, tz], [tx, 13, tz], [tx, 13, tz]);
  for (const [x, z, c1] of [[-40, 18, 0xf1c40f], [-12, -20, 0xd63a2f]] as [number, number, number][]) {
    stripedWall(b, x, z, 0, 2.2, 3, 8, c1, 0xf6f1e4);
    stripedCone(b, x, z, 2.2, 2.6, 3.4, 8, c1, 0xf6f1e4);
  }

  // --- swing ride (chair-o-plane)
  const sx = 17, sz = 32;
  b.paint(0x8e8b84, Surf.Pavement).cylinder(sx, sz, 0, 0.3, 6.5, 6.5, 10);
  b.paint(0xf1c40f, Surf.Metal).cylinder(sx, sz, 0.3, 12, 0.6, 0.45, 8);
  b.push().translate(sx, 12.3, sz).rotateZ(0.14);
  stripedCone(b, 0, 0, 0, 1.6, 4.2, 12, 0x2e86c1, 0xf6f1e4);
  b.paint(0xffe3a3, Surf.Emissive).cylinder(0, 0, -0.5, 0.5, 4.2, 4.2, 12, { top: false });
  b.paint(0xc8ccd0, Surf.Metal);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const ox = Math.cos(a) * 4.0, oz = Math.sin(a) * 4.0, ex = Math.cos(a) * 6.2, ez = Math.sin(a) * 6.2;
    b.beam([ox, -0.4, oz], [ex, -6.5, ez], 0.05);
    b.paint([0xe74c3c, 0x2ecc71, 0xf1c40f][i % 3], Surf.Plain).box(ex - 0.3, -6.9, ez - 0.3, ex + 0.3, -6.5, ez + 0.3);
    b.paint(0xc8ccd0, Surf.Metal);
  }
  b.pop();

  // --- food stalls with striped awnings along the main promenade
  for (let i = 0; i < 2; i++) {
    for (const s of [-1, 1]) {
      const zz = 34 - i * 6, xx = s * 6.6;
      const c = [0xe74c3c, 0x2e86c1, 0x27ae60, 0xf39c12][(i + (s > 0 ? 1 : 0)) % 4];
      b.paint(0xf6f1e4, Surf.Plain).box(xx - 1.4 * s - 1.2, 0, zz - 1.8, xx - 1.4 * s + 1.2, 2.6, zz + 1.8);
      b.paint(c, Surf.Plain).box(xx - 1.4 * s - 1.4, 2.6, zz - 2.0, xx - 1.4 * s + 1.4, 2.9, zz + 2.0);
      b.paint(0xffe3a3, Surf.Emissive).box(xx - 1.4 * s + 1.21 * -s, 1.9, zz - 1.4, xx - 1.4 * s + 1.26 * -s, 2.4, zz + 1.4, { top: null, bottom: null });
    }
  }
  for (const [x, z, c] of [[-5, -12, 0xe74c3c], [9, 18, 0x2e86c1], [-9, 18, 0x27ae60]] as [number, number, number][]) umbrella(b, x, z, c, 1.5, 2.6);
  // trees + lamps
  for (const [x, z, k] of [[-46, 44, 'round'], [-46, 34, 'oak'], [46, 22, 'round'], [-46, -44, 'oak'], [-4, 22, 'cherry'], [-24, 44, 'round']] as [number, number, 'oak'][]) tree(b, rng, x, z, 1.0, k);
  for (const [x, z] of [[-4, 26], [4, 26], [11, -2], [-11, 9]] as P2[]) lamp(b, x, z, 4.4, 1);
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
  lawnPatchwork(b, rng, -E, -E, E, E, GRASS_LUSH, 3);
  const pave = 0xd3c3a0;
  // main loop path near the edges, entrance axis, center spur to the monkey island
  const loop = path(b, [[0, 30], [24, 30], [38, 15], [38, -14], [26, -35], [0, -39], [-26, -35], [-38, -14], [-38, 15], [-24, 30]], 4.2, pave, 0.09, 4, true);
  path(b, [[0, 48], [0, 30]], 6, pave);
  b.paint(pave, Surf.Pavement);
  disc(b, 0, 32, 0.095, 6.5, 16);
  path(b, [[0, 30], [0, 14], [0, 7]], 3.4, pave);
  path(b, [[0, -39], [0, -24], [0, -11]], 3.4, pave);

  // enclosure helper: ground polygon + low stone wall
  const encl = (cx: number, cz: number, rx: number, rz: number, ground: number, rot = 0): P2[] => {
    const poly = blobPoly(rng, cx, cz, rx, rz, 9, 0.14, rot);
    b.paint(ground, Surf.Foliage);
    flatPoly(b, poly, 0.1);
    b.paint(0xa89f8d, Surf.Stone);
    for (let i = 0; i < poly.length; i++) orientWallSeg(b, poly[i], poly[(i + 1) % poly.length], 1.1, 0.45);
    return poly;
  };
  const S = 1.3; // animals slightly exaggerated so they read from the game camera

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
  lion(b, -21.5, 12, 0.5, 1.9);
  lion(b, -15, 9.5, 2.0, 0);
  tree(b, rng, -13, 17, 0.9, 'acacia');

  // 3) savanna with giraffes and zebras (inside loop, back-right)
  encl(20, -17, 12.5, 12, 0xbfb472, -0.15);
  giraffe(b, 16, -18, 0.5, 1.2 * S);
  giraffe(b, 23, -13, 2.6, 1.05 * S);
  giraffe(b, 25, -21, 4.0, 1.2 * S);
  zebra(b, 14, -11, 1.2);
  zebra(b, 16.5, -9.5, 1.4);
  tree(b, rng, 27, -12, 1.1, 'acacia');
  tree(b, rng, 13, -24, 0.95, 'acacia');

  // 4) penguin pool (inside loop, front-right)
  encl(20, 13, 11, 8.5, 0xe4e7ea, 0.1);
  pond(b, rng, 21, 13, 7, 4.8, { rim: 0xf4f6f8, water: 0x3a88b0, rimW: 0.9, n: 14, rimSides: false });
  boulderZ(b, rng, 12.5, 14, 1.2);
  for (let i = 0; i < 6; i++) {
    const x = 13.5 + (i % 3) * 0.9 + rng.range(-0.2, 0.2), z = 9 + Math.floor(i / 3) * 1.1 + rng.range(-0.2, 0.2);
    b.paint(0x1d1f22, Surf.Plain).cylinder(x, z, 0.1, 0.7, 0.22, 0.14, 5, { top: false });
    b.paint(0xf4f4f0, Surf.Plain).box(x - 0.12, 0.2, z + 0.1, x + 0.12, 0.6, z + 0.23, { bottom: null });
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

  // 7) tropical house (front-right corner): brick hall with a glass barrel roof
  b.paint(0x8a5a44, Surf.Brick).box(27, 0, 33, 45, 4.2, 42);
  b.push().translate(36, 4.2, 37.5).rotateZ(Math.PI / 2);
  b.paint(0x9fc2b8, Surf.GlassPlain).cylinder(0, 0, -9, 18, 4.5, 4.5, 10, { top: true, bottom: true });
  b.pop();
  b.paint(0x2e3a44, Surf.GlassPlain).box(33, 0.3, 41.95, 39, 3.2, 42.05, { top: null, bottom: null, nx: null, px: null, nz: null });

  // entrance gate with thatched huts + sign
  for (const s of [-1, 1]) {
    b.paint(0x8a6440, Surf.Wood).cylinder(s * 6.5, 42, 0, 5.5, 2.0, 2.0, 8);
    b.paint(0xc9a86a, Surf.Plain).cone(s * 6.5, 42, 5.3, 3.4, 3.0, 8, false);
  }
  b.paint(0x5b4330, Surf.Wood).box(-6.5, 5.6, 41.4, 6.5, 7.0, 42.6);
  b.paint(0xf5d76e, Surf.Emissive).box(-4.6, 5.8, 42.6, 4.6, 6.8, 42.65, { top: null, bottom: null, nx: null, px: null, nz: null });
  // cafe umbrellas by the plaza
  for (const [x, z, c] of [[10, 36, 0x27ae60], [13.5, 39, 0xf1c40f], [-10, 36, 0xe67e22]] as [number, number, number][]) umbrella(b, x, z, c, 1.4, 2.4);
  // greenery around the loop
  for (const [x, z, k] of [[-45, -44, 'cone'], [-44, -26, 'oak'], [45, -44, 'cone'], [44, -26, 'round'], [0, -45, 'oak'], [45, 10, 'oak'], [-45, 8, 'round'], [-16, 43, 'round']] as [number, number, 'oak'][]) tree(b, rng, x, z, 1.0, k);
  for (const i of [5, 16, 27]) {
    const [x, z] = loop[i % loop.length];
    lamp(b, x + 2.6, z, 4.2, 1);
  }
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
  lawnPatchwork(b, rng, -E, -E, E, E, 0x4f7d31, 5);
  const fairC = 0x86bf57, greenC = 0x9ad866, teeC = 0x8fcc5e, sand = 0xeadcae;
  const hole = (ctrl: P2[], w0: number, w1: number, greenR: number, bunkers: P2[]) => {
    const spine = spline(ctrl, 5);
    b.paint(fairC, Surf.Foliage);
    flatPoly(b, spinePoly(spine, (t) => w0 + (w1 - w0) * t + Math.sin(t * 9) * 1.2), 0.075);
    const tee = ctrl[0], g = ctrl[ctrl.length - 1];
    b.paint(teeC, Surf.Foliage).box(tee[0] - 2.2, 0, tee[1] - 2.2, tee[0] + 2.2, 0.2, tee[1] + 2.2);
    b.paint(greenC, Surf.Foliage);
    flatPoly(b, blobPoly(rng, g[0], g[1], greenR, greenR * 0.8, 12, 0.15), 0.085);
    // pin
    b.paint(0xf4f4f4, Surf.Metal).cylinder(g[0], g[1], 0.08, 2.6, 0.04, 0.04, 4);
    b.paint(0xe74c3c, Surf.Plain).quad2([g[0], 2.6, g[1]], [g[0] + 0.9, 2.35, g[1]], [g[0], 2.1, g[1]], [g[0], 2.1, g[1]]);
    b.paint(sand, Surf.Pavement);
    for (const [bx, bz] of bunkers) flatPoly(b, blobPoly(rng, bx, bz, rng.range(2.0, 3.2), rng.range(1.4, 2.2), 9, 0.25, rng.range(0, 3)), 0.09);
  };
  hole([[-38, 18], [-36, 2], [-30, -14], [-32, -30]], 5.5, 4.5, 4.2, [[-35, -26], [-27.5, -33], [-33.5, -8]]);
  hole([[-18, -38], [-4, -36], [12, -38], [28, -34]], 5, 4.2, 4.0, [[24, -30], [31, -38.5], [6, -33]]);
  hole([[40, -24], [38, -8], [30, 6], [22, 14]], 5.5, 4, 4.5, [[26, 17.5], [18.5, 11], [36, 0]]);
  hole([[-14, -18], [-4, -10], [2, 2], [-6, 12]], 4.6, 4, 3.8, [[-10, 14.5], [-1, 15]]);
  // water hazard between holes
  pond(b, rng, 14, -14, 8, 5.5, { rimW: 0.4, rim: 0x6b8a4a, reeds: 6, rot: 0.4 });
  // cart path
  b.paint(0xb9b4a8, Surf.Pavement);
  ribbon(b, spline([[-24, 30], [-26, 14], [-22, -6], [-24, -24], [-10, -30], [16, -28], [34, -18], [34, 0], [26, 24], [8, 30], [-8, 32]], 5), 1.6, 0.095);
  // clubhouse (front-left) + parking
  const hx = -22, hz = 38;
  b.paint(PATH_PAVE, Surf.Pavement).slab(-40, 31, -4, 47.5, 0.1);
  b.paint(0xf2eee4, Surf.WallWindows, 1, 3.4).box(hx - 11, 0.1, hz - 5, hx + 11, 7.0, hz + 4);
  b.paint(0x3d4a5a, Surf.RoofTiles).hipRoof(hx, hz - 0.5, 22, 9, 7.0, 3.6, 0.6);
  b.paint(0xf2eee4, Surf.Plain);
  for (let i = 0; i < 6; i++) b.cylinder(hx - 7.5 + i * 3, hz + 6.2, 0.1, 4.2, 0.22, 0.2, 6);
  b.paint(0x3d4a5a, Surf.RoofTiles).box(hx - 9, 4.3, hz + 4, hx + 9, 4.6, hz + 6.8, { bottom: null });
  b.paint(0x2c3e50, Surf.Plain).box(hx - 3, 7.8, hz - 1, hx + 3, 10.4, hz + 0.5);
  b.paint(0x3d4a5a, Surf.RoofTiles).pyramid(hx, hz - 0.25, 6.6, 2.2, 10.4, 1.0);
  for (let i = 0; i < 7; i++) car(b, -1.5 - i * 0.0 + (i % 2) * 0, 32.5 + i * 2.2, Math.PI / 2, rng.pick([0xb8bcc2, 0x2b2d31, 0xf1f1ef, 0x1f3f7a, 0x8a1c1c]), 0.1);
  b.paint(PALETTE.asphalt, Surf.Pavement).slab(-4, 31, 6, 47.5, 0.1);
  for (let i = 0; i < 5; i++) car(b, 1.5, 33 + i * 3, Math.PI / 2, rng.pick([0xb8bcc2, 0x2b2d31, 0xf1f1ef, 0x1f3f7a, 0x8a1c1c]), 0.1);
  // putting green near the clubhouse
  b.paint(greenC, Surf.Foliage);
  flatPoly(b, blobPoly(rng, 16, 38, 7, 4.5, 12, 0.15), 0.085);
  for (const [x, z] of [[13, 37], [19, 39.5]] as P2[]) b.paint(0xf4f4f4, Surf.Metal).cylinder(x, z, 0.08, 1.2, 0.03, 0.03, 4);
  // trees lining the holes
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
  for (const [x, z] of [[-30, 36], [-14, 36], [-4, 44]] as P2[]) lamp(b, x, z, 4.2, 0);
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
