/**
 * Landmark buildings: gothic cathedral, shell opera house, medieval castle, glass pyramid, observatory,
 * triumphal arch, giant observation wheel. (park/landmark asset agent) Budget <= 8000 tris each.
 */
import { ModelBuilder, type Paint } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import {
  type P2, type V3, type ProfPt, lathe, tree, lamp, parkBench, flowerBed, roundBed, shrub, fountain, disc, annulus, rect, ribbon, cylWall, flatPoly,
  path, person, lawnPatchwork, lawnPools, rectPoly, ribbonQuads, roundRectPath, offsetPoly, track3D, orientQuad, orientTri, hedgeBox, umbrella, GRASS_LUSH, PATH_GRAVEL, PATH_PAVE,
  type PoolSpec,
} from './park_lib';
import { polyZ, polyX, gothicArch, roundArch, openingZ, archFrameZ, prismEdges, merlons, merlonRing, surface, beacon } from './lm_lib';

const TAU = Math.PI * 2;
const P = (color: number, surf: Surf = Surf.Plain, pattern = 0, floor = 3.3): Paint => ({ color, surf, pattern, floor });

/** Triangular gable prism: triangle (x0..x1 base at y0, apex y1) extruded between z0 (back) and z1 (front). */
function gablePrism(b: ModelBuilder, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
  const xm = (x0 + x1) / 2;
  polyZ(b, [[x0, y0], [x1, y0], [xm, y1]], z1, 1);
  polyZ(b, [[x0, y0], [x1, y0], [xm, y1]], z0, -1);
  orientQuad(b, [x0, y0, z0], [x0, y0, z1], [xm, y1, z1], [xm, y1, z0], [-(y1 - y0), x1 - xm, 0]);
  orientQuad(b, [x1, y0, z0], [x1, y0, z1], [xm, y1, z1], [xm, y1, z0], [y1 - y0, x1 - xm, 0]);
}

/** Rose window on a +Z facing plane at (cx, cy, z): stone frame, glowing glass, petals, tracery. */
function roseWindow(b: ModelBuilder, cx: number, cy: number, z: number, r: number, seg = 20): void {
  const circle = (rr: number, n: number, ox = cx, oy = cy): P2[] => Array.from({ length: n }, (_, i) => [ox + Math.cos((i / n) * TAU) * rr, oy + Math.sin((i / n) * TAU) * rr] as P2);
  b.paint(0xd6ccb4, Surf.Stone);
  polyZ(b, circle(r + 0.7, seg), z + 0.02, 1, [circle(r, seg)]);
  b.paint(0x1d2748, Surf.Emissive, 11);
  polyZ(b, circle(r, seg), z + 0.01, 1);
  // petals
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, da = TAU / n / 2.4;
    b.paint(i % 2 ? 0x4a1d28 : 0x35204a, Surf.Emissive, 11);
    polyZ(b, [[cx + Math.cos(a) * r * 0.32, cy + Math.sin(a) * r * 0.32], [cx + Math.cos(a - da) * r * 0.88, cy + Math.sin(a - da) * r * 0.88], [cx + Math.cos(a) * r * 0.97, cy + Math.sin(a) * r * 0.97], [cx + Math.cos(a + da) * r * 0.88, cy + Math.sin(a + da) * r * 0.88]], z + 0.03, 1);
  }
  b.paint(0x6a5424, Surf.Emissive, 11);
  polyZ(b, circle(r * 0.28, 10), z + 0.04, 1);
  // tracery spokes + inner ring
  b.paint(0xd9cfb6, Surf.Stone);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + TAU / n / 2, w = 0.09 * r;
    const c = Math.cos(a), s = Math.sin(a);
    polyZ(b, [[cx + c * r * 0.3 - s * w, cy + s * r * 0.3 + c * w], [cx + c * r - s * w, cy + s * r + c * w], [cx + c * r + s * w, cy + s * r - c * w], [cx + c * r * 0.3 + s * w, cy + s * r * 0.3 - c * w]], z + 0.05, 1);
  }
  polyZ(b, circle(r * 0.34, 12), z + 0.05, 1, [circle(r * 0.27, 12)]);
}

// ================================================================================================ GOTHIC CATHEDRAL
function cathedral(b: ModelBuilder, _v: number, rng: RNG): void {
  const EX = 24, EZ = 32;
  const stone = 0xcdc1a6, stoneL = 0xd8ceb8, stoneD = 0xb3a68a, roofC = 0x55616c;
  const win = P(stone, Surf.WallWindows, 8, 14);
  const front = P(stone, Surf.Stone, 1, 60), frontD = P(stoneD, Surf.Stone, 1, 60), frontL = P(stoneL, Surf.Stone, 1, 60);
  lawnPatchwork(b, rng, -EX, -EZ, EX, EZ, GRASS_LUSH, 3);
  // parvis (paved square) in front + side walks
  b.paint(0xc4bcaa, Surf.Pavement).slab(-EX, 24.6, EX, EZ, 0.1);
  b.paint(0xaea591, Surf.Pavement);
  for (let i = -5; i <= 5; i++) rect(b, i * 4.2 - 0.25, 25.5, i * 4.2 + 0.25, EZ, 0.115);
  path(b, [[-22, 25], [-21.5, 0], [-18, -26]], 2.2, PATH_GRAVEL);
  path(b, [[22, 25], [21.5, 0], [18, -26]], 2.2, PATH_GRAVEL);

  // ---- nave, aisles, transept, choir, apse
  const NW = 7, WALL = 28, AIS = 14;
  b.paint(win).box(-NW, 0, -4, NW, WALL, 16, { top: null });
  b.paint(roofC, Surf.RoofTiles).gableRoof(0, 6, NW * 2, 20, WALL, 12, 'z', 0.5, P(stone, Surf.Stone));
  b.paint(win).box(-NW, 0, -22, NW, WALL, -14, { top: null, nz: null });
  b.paint(roofC, Surf.RoofTiles).gableRoof(0, -18, NW * 2, 8, WALL, 12, 'z', 0.5, P(stone, Surf.Stone));
  for (const s of [-1, 1]) {
    for (const [z0, z1] of [[-4, 16], [-22, -14]]) {
      b.paint(win).box(s * NW, 0, z0, s * 12, AIS, z1, { top: null });
      b.paint(roofC, Surf.RoofTiles).shedRoof(s * 9.5, (z0 + z1) / 2, 5, z1 - z0, AIS, 2.6, s > 0 ? 'nx' : 'px');
    }
  }
  // transept
  b.paint(win).box(-19, 0, -14, 19, WALL, -4, { top: null });
  b.paint(roofC, Surf.RoofTiles).gableRoof(0, -9, 38, 10, WALL, 11, 'x', 0.5, P(stone, Surf.Stone));
  for (const s of [-1, 1]) {
    b.push().rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2).translate(9, 0, 0);
    roseWindow(b, 0, 19.5, 19.02, 2.8, 16);
    const door = gothicArch(0, 3.0, 5.2, 4);
    openingZ(b, door, 19.0, 1, 0x1d2748, Surf.Emissive, 11);
    archFrameZ(b, door, 19.0, 1, 0.6, 0.5, P(stoneL, Surf.Stone));
    b.pop();
    // transept corner buttresses
    b.paint(stoneD, Surf.Stone);
    for (const z of [-14.6, -3.4]) b.box(s * 19 - 0.8, 0, z - 0.8, s * 19 + 0.8, 24, z + 0.8).pyramid(s * 19, z, 1.6, 1.6, 24, 5);
  }
  // apse (semicircular, -Z end)
  b.paint(win);
  cylWall(b, 0, -22, 0, WALL, NW, NW, 7, false, Math.PI, TAU);
  b.paint(roofC, Surf.RoofTiles);
  lathe(b, 0, -22, [[NW + 0.5, WALL - 0.3], [0, WALL + 12]], 7, 60, Math.PI, TAU);
  b.paint(stoneD, Surf.Stone);
  for (let i = 1; i < 7; i++) {
    const a = Math.PI + (i / 7) * Math.PI;
    const c = Math.cos(a), s = Math.sin(a);
    b.push().translate(c * 8.3, 0, -22 + s * 8.3).rotateY(-a + Math.PI / 2);
    b.box(-0.7, 0, -1.2, 0.7, 17, 1.2).pyramid(0, 0, 1.4, 1.4, 17, 4.5);
    b.pop();
    b.beam([c * 8.3, 16, -22 + s * 8.3], [c * (NW + 0.2), 24.5, -22 + s * (NW + 0.2)], 0.7);
  }
  // flying buttresses along nave & choir
  for (const zb of [13.5, 8.5, 3.5, -1.2, -16.5, -20.5]) {
    for (const s of [-1, 1]) {
      b.paint(stoneD, Surf.Stone).box(s * 13.1 - 0.8, 0, zb - 0.75, s * 13.1 + 0.8, 19, zb + 0.75);
      b.paint(stoneL, Surf.Stone).pyramid(s * 13.1, zb, 1.6, 1.5, 19, 5.2);
      b.paint(stoneD, Surf.Stone).beam([s * 12.7, 18.2, zb], [s * (NW + 0.2), 25.5, zb], 0.8).beam([s * 12.7, 14.6, zb], [s * (NW + 0.2), 20.2, zb], 0.55);
    }
  }
  // crossing flèche (lead)
  const lead = 0x59636b;
  b.paint(lead, Surf.Metal).prism(0, -9, 2.4, 8, 38, 6.5, Math.PI / 8);
  b.paint(0x3e464d, Surf.Metal);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    b.beam([Math.cos(a) * 2.45, 39.5, -9 + Math.sin(a) * 2.45], [Math.cos(a) * 2.45, 43.5, -9 + Math.sin(a) * 2.45], 0.25);
  }
  lathe(b, 0, -9, [[2.6, 44.5, P(lead, Surf.Metal)], [0.15, 72], [0, 72.4]], 8, 10, Math.PI / 8, Math.PI / 8 + TAU);
  b.paint(0xd4af37, Surf.Metal).box(-0.06, 72, -9.06, 0.06, 74.2, -8.94).box(-0.6, 73.2, -9.06, 0.6, 73.4, -8.94);

  // ---- west front: twin towers + central gable with rose window + portals
  const FZ = 24.2; // central facade plane
  b.paint(front).box(-5, 0, 16, 5, 34, FZ);
  b.paint(front);
  gablePrism(b, -5, 5, 34, 42, 16, FZ);
  b.paint(frontL).box(-5.3, 33.6, FZ - 0.2, 5.3, 34.4, FZ + 0.3);
  roseWindow(b, 0, 24.5, FZ, 3.5, 20);
  // gallery of niches
  b.paint(0x5a4e40, Surf.Plain);
  for (let i = 0; i < 5; i++) polyZ(b, gothicArch(-3.6 + i * 1.8, 1.0, 18.6, 3, 16.8), FZ + 0.03, 1);
  b.paint(stoneL, Surf.Stone).box(-5.2, 16.2, FZ - 0.1, 5.2, 16.8, FZ + 0.5).box(-5.2, 20.2, FZ - 0.1, 5.2, 20.7, FZ + 0.4);
  // central portal with archivolt + gablet
  const portal = gothicArch(0, 4.6, 7, 5);
  openingZ(b, portal, FZ, 1, 0x1d2748, Surf.Emissive, 11);
  archFrameZ(b, portal, FZ, 1, 1.0, 0.9, frontL);
  b.paint(stoneL, Surf.Stone);
  gablePrism(b, -3.9, 3.9, 11.4, 15.6, FZ, FZ + 0.9);
  for (const s of [-1, 1]) {
    const tx = s * 9.5;
    const T0 = 16, T1 = 25.2, TH = 47;
    // tower body + corner buttresses + string courses
    b.paint(front).box(tx - 4.5, 0, T0, tx + 4.5, TH, T1, { top: P(stoneD, Surf.RoofFlat) });
    b.paint(frontD);
    for (const [cx2, cz2] of [[tx - 4.5, T1], [tx + 4.5, T1], [tx - 4.5, T0], [tx + 4.5, T0]] as P2[]) {
      b.box(cx2 - 0.8, 0, cz2 - 0.8, cx2 + 0.8, 30, cz2 + 0.8).box(cx2 - 0.6, 30, cz2 - 0.6, cx2 + 0.6, 42, cz2 + 0.6);
      b.pyramid(cx2, cz2, 1.2, 1.2, 42, 3.5);
    }
    b.paint(frontL).box(tx - 4.8, 16.2, T0 - 0.3, tx + 4.8, 16.8, T1 + 0.3).box(tx - 4.8, 30, T0 - 0.3, tx + 4.8, 30.7, T1 + 0.3);
    // side portal
    const sp = gothicArch(tx, 3.0, 5.6, 4);
    openingZ(b, sp, T1, 1, 0x1d2748, Surf.Emissive, 11);
    archFrameZ(b, sp, T1, 1, 0.7, 0.6, frontL);
    // lancet windows (mid) and belfry louvres on all faces
    for (let k = 0; k < 4; k++) {
      b.push().translate(tx, 0, (T0 + T1) / 2).rotateY((k * Math.PI) / 2);
      if (k !== 0) openingZ(b, gothicArch(0, 1.6, 23, 3, 19), 4.5, 1, 0x2a2f48, Surf.Emissive, 11);
      for (const x of [-1.5, 1.5]) openingZ(b, gothicArch(x, 1.8, 40.5, 4, 33), 4.5, 1, 0x2a2420);
      b.pop();
    }
    // parapet, pinnacles and the octagonal spire
    b.paint(stoneL, Surf.Stone).box(tx - 4.9, TH, T0 - 0.4, tx + 4.9, TH + 1.2, T1 + 0.4, { top: null });
    b.paint(stoneL, Surf.Stone);
    for (const [cx2, cz2] of [[tx - 4.2, T1 - 0.3], [tx + 4.2, T1 - 0.3], [tx - 4.2, T0 + 0.3], [tx + 4.2, T0 + 0.3]] as P2[]) {
      b.box(cx2 - 0.45, TH + 1.2, cz2 - 0.45, cx2 + 0.45, TH + 3.2, cz2 + 0.45, { top: null });
      b.pyramid(cx2, cz2, 0.9, 0.9, TH + 3.2, 4.2);
    }
    const sprof: [number, number][] = [[4.1, TH + 1.2], [3.9, TH + 3.0], [4.2, TH + 3.6], [3.3, TH + 12], [3.55, TH + 12.6], [2.2, TH + 24], [2.4, TH + 24.6], [0.1, TH + 38.5], [0, TH + 39]];
    const scz = (T0 + T1) / 2;
    lathe(b, tx, scz, [[sprof[0][0], sprof[0][1], P(0xcfc3a8, Surf.Stone, 1, 60)], ...sprof.slice(1)], 8, 20, Math.PI / 8, Math.PI / 8 + TAU);
    // crockets: small pyramids every 4 m on the 8 arrises
    const rAt = (y: number): number => {
      for (let k = 0; k < sprof.length - 1; k++) if (y >= sprof[k][1] && y <= sprof[k + 1][1]) return sprof[k][0] + ((sprof[k + 1][0] - sprof[k][0]) * (y - sprof[k][1])) / (sprof[k + 1][1] - sprof[k][1]);
      return 0;
    };
    b.paint(0xc6b99c, Surf.Stone);
    for (let y = TH + 5; y < TH + 36; y += 4) {
      const rr = rAt(y) + 0.12;
      for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + (k * Math.PI) / 4;
        b.pyramid(tx + Math.cos(a) * rr, scz + Math.sin(a) * rr, 0.42, 0.42, y, 0.62);
      }
    }
    b.paint(0xd4af37, Surf.Metal).box(tx - 0.07, TH + 38.6, 20.54, tx + 0.07, TH + 40.8, 20.66).box(tx - 0.6, TH + 39.8, 20.54, tx + 0.6, TH + 40.0, 20.66);
  }
  // ---- grounds
  for (const [x, z] of [[-21, 28.5], [21, 28.5], [-21.5, 10], [21.5, 10], [-21, -12], [21, -12], [-16, -29], [16, -29]] as P2[]) tree(b, rng, x, z, 0.95, rng.chance(0.5) ? 'oak' : 'round');
  // parvis pool + pools on the darker paving bands (bands stay continuous by day and read through the light at night)
  const bandPool: PoolSpec = { color: 0xaea591, y: 0.115, dy: 0.03, clip: Array.from({ length: 11 }, (_, k) => rectPoly((k - 5) * 4.2 - 0.25, 25.5, (k - 5) * 4.2 + 0.25, EZ)) };
  for (const x of [-15, -7, 7, 15]) lamp(b, x, 30.8, 4.4, 0, [{ color: 0xc4bcaa, y: 0.1, dy: 0.03 }, bandPool]);
  for (const x of [-11, 11]) parkBench(b, x, 30.5, Math.PI);
  roundBed(b, rng, -14.5, 27.4, 1.1);
  roundBed(b, rng, 14.5, 27.4, 1.1);
  for (let i = 0; i < 8; i++) person(b, rng, rng.range(-12, 12), rng.range(25.5, 31), 0.1, rng.range(0, TAU));
}

// ================================================================================================ OPERA HOUSE
/**
 * One shell ("sail") facing +Z in local space: feet at (+-W/2, 0, 0), apex (0, H, lean), rear foot (0, 0, -D).
 * Front opening closed by a tilted bronze glass wall with mullions.
 */
function shell(b: ModelBuilder, W: number, H: number, D: number, lean: number, nu = 12, nv = 6): void {
  const g = (s: number) => Math.pow(Math.max(0, 1 - Math.abs(s)), 0.72);
  const A = (s: number): V3 => [(W / 2) * s, H * g(s), lean * g(s)];
  const C = (s: number): V3 => [(W / 2) * s * 0.98, H * g(s) * 1.02, -D * 0.52 + lean * g(s) * 0.25];
  const R: V3 = [0, 0, -D];
  const f = (u: number, v: number): V3 => {
    const s = u * 2 - 1;
    const a = A(s), c = C(s);
    const k0 = (1 - v) * (1 - v), k1 = 2 * (1 - v) * v, k2 = v * v;
    return [a[0] * k0 + c[0] * k1 + R[0] * k2, a[1] * k0 + c[1] * k1 + R[1] * k2, a[2] * k0 + c[2] * k1 + R[2] * k2];
  };
  b.paint(0xebe7dc, Surf.RoofTiles);
  surface(b, f, nu, nv, [0, H * 0.25, -D * 0.35]);
  // edge lip along the arch: gives the shell a visible thickness and traces a glowing outline at night
  b.paint(0xd9d4c8, Surf.Emissive);
  const lip: V3[] = [];
  for (let i = 0; i <= nu; i++) {
    const a = A((i / nu) * 2 - 1);
    lip.push([a[0], a[1], a[2] + 0.05]);
  }
  track3D(b, lip, 0.9, 0.5, { bottom: true });
  // glass wall: tilted fan under the arch (bronze, warm at night)
  b.paint(0x6a5238, Surf.GlassCurtain, 2, 3.2);
  const G = (s: number): V3 => {
    const a = A(s);
    return [a[0] * 0.97, a[1] * 0.96, a[2] * 0.55];
  };
  for (let i = 0; i < nu; i++) orientTri(b, [0, 0, 0], G((i / nu) * 2 - 1), G(((i + 1) / nu) * 2 - 1), [0, -0.3, 1]);
  b.paint(0x8a7a66, Surf.Metal);
  for (let k = 1; k < 6; k++) {
    const s = -0.85 + (k - 1) * 0.425;
    const top = G(s);
    b.beam([top[0], 0, 0], top, 0.14);
  }
}

function operaHouse(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 32;
  // plaza + waterfront promenade suggestion
  b.paint(0xc7bfb0, Surf.Pavement).slab(-E, -E, E, E, 0.1);
  b.paint(0xb2a998, Surf.Pavement);
  for (let i = -7; i <= 7; i++) rect(b, i * 4.3 - 0.3, 16, i * 4.3 + 0.3, E, 0.115);
  // podium (granite) with dark foyer glazing band
  const PY = 6.5;
  b.paint(0xc19f87, Surf.Stone).box(-27, 0.1, -27, 27, PY, 16, { top: P(0xc9c0b0, Surf.Pavement) });
  b.paint(0x2e2620, Surf.GlassPlain, 2).box(-27.05, 1.2, -24, 27.05, 4.6, 12, { top: null, bottom: null, pz: null, nz: null });
  b.paint(0xb99579, Surf.Stone);
  for (let x = -24; x <= 24; x += 6) b.box(x - 0.4, 0.1, 16, x + 0.4, PY, 16.5, { bottom: null });
  // grand staircase in front of the main hall
  const st0 = -21, st1 = 5, steps = 13;
  for (let i = 0; i < steps; i++) {
    const zf = 16 + (steps - i) * 0.85;
    b.paint(0xd9cbb6, Surf.Stone).box(st0, 0.1, 16, st1, ((i + 1) / steps) * PY, zf, { nx: i === 0 ? undefined : null, px: i === 0 ? undefined : null });
  }
  b.paint(0xc9a58c, Surf.Stone).box(st0 - 1.2, 0.1, 16, st0, PY + 0.4, 27.2).box(st1, 0.1, 16, st1 + 1.2, PY + 0.4, 27.2);
  // ---- shells: main hall (x=-8), second hall (x=+12), restaurant on the plaza
  const put = (x: number, z: number, rot: number, W: number, H: number, D: number, lean: number, y = PY) => {
    b.push().translate(x, y, z).rotateY(rot);
    shell(b, W, H, D, lean);
    b.pop();
  };
  put(-8, 11.5, 0, 20, 27, 17, 6);
  put(-8, 3, 0, 24, 40, 22, 8);
  put(-8, -14, Math.PI, 22, 31, 17, 6);
  put(-8, -22.5, Math.PI, 15, 19, 11, 4);
  put(13, 8.5, 0, 16, 22, 15, 5);
  put(13, 1, 0, 19, 31, 18, 6.5);
  put(13, -15, Math.PI, 17, 24, 14, 5);
  put(20.5, 24, 0, 10, 12, 8, 3, 0.1);
  put(20.5, 19.5, Math.PI, 8.5, 9, 6.5, 2.5, 0.1);
  // podium railings along the edges
  b.paint(0x8a8c8e, Surf.Metal);
  for (const [ax, az, bx2, bz] of [[-27, -27, 27, -27], [-27, -27, -27, 16], [27, -27, 27, 16]] as [number, number, number, number][]) b.beam([ax, PY + 1.0, az], [bx2, PY + 1.0, bz], 0.08);
  // waterfront promenade + trees on the city side
  b.paint(0x8e8b84, Surf.Stone).box(-E, 0.1, -E, E, 0.6, -29.5);
  for (let x = -28; x <= 28; x += 8) lamp(b, x, -30.6, 4.2, 1, [{ color: 0x8e8b84, y: 0.6, dy: 0.02, clip: [rectPoly(-32, -32, 32, -29.5)] }]);
  for (const z of [-20, -8, 4]) tree(b, rng, -30, z, 0.95, 'round');
  for (const z of [-20, -8, 4]) tree(b, rng, 30, z, 0.95, 'round');
  // plaza pool + pools on the darker paving bands
  const bandPool: PoolSpec = { color: 0xb2a998, y: 0.115, dy: 0.03, clip: Array.from({ length: 15 }, (_, k) => rectPoly((k - 7) * 4.3 - 0.3, 16, (k - 7) * 4.3 + 0.3, E)) };
  for (const x of [-27, -12, 8, 28]) lamp(b, x, 29, 4.4, 2, [{ color: 0xc7bfb0, y: 0.1, dy: 0.03 }, bandPool]);
  for (const [x, z, c] of [[25, 28, 0xf4f2ea], [28, 25, 0xf4f2ea], [15.5, 27.5, 0xf4f2ea]] as [number, number, number][]) umbrella(b, x, z, c, 1.5, 2.5);
  for (let i = 0; i < 10; i++) person(b, rng, rng.range(-24, 10), rng.range(20, 31), 0.1, rng.range(0, TAU));
}

// ================================================================================================ CASTLE
function castle(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 32;
  const stone = 0x9e9482, stoneL = 0xb3a994, stoneD = 0x847a69, slate = 0x4a5868;
  const lit = P(stone, Surf.Stone, 1, 20), litL = P(stoneL, Surf.Stone, 1, 20);
  lawnPatchwork(b, rng, -E, -E, E, E, 0x6f9a45, 4);
  // walls square: x [-20, 20], z [-22, 16]
  const X0 = -20, X1 = 20, Z0 = -22, Z1 = 16, WT = 2.4, WH = 11;
  // moat
  const moat = roundRectPath(0, (Z0 + Z1) / 2, X1 - X0 + 10, Z1 - Z0 + 10, 7, 4);
  b.paint(0x7a6a4a, Surf.Pavement);
  ribbon(b, moat, 6.2, 0.07, { closed: true });
  b.paint(0x3f6f7e, Surf.Water);
  ribbon(b, moat, 4.6, 0.1, { closed: true });
  // courtyard ground
  b.paint(0xb6a684, Surf.Pavement).slab(X0, Z0, X1, Z1, 0.12);
  // curtain walls (front wall split by the gate), floodlit from the base
  b.paint(lit);
  b.box(X0, 0, Z0, X1, WH, Z0 + WT);
  b.box(X0, 0, Z0, X0 + WT, WH, Z1);
  b.box(X1 - WT, 0, Z0, X1, WH, Z1);
  b.box(X0, 0, Z1 - WT, -4, WH, Z1).box(4, 0, Z1 - WT, X1, WH, Z1);
  b.paint(stoneL, Surf.Stone);
  merlons(b, X0 + 4, Z0 + 0.35, X1 - 4, Z0 + 0.35, WH, 0.7);
  merlons(b, X0 + 0.35, Z0 + 4, X0 + 0.35, Z1 - 4, WH, 0.7);
  merlons(b, X1 - 0.35, Z0 + 4, X1 - 0.35, Z1 - 4, WH, 0.7);
  merlons(b, X0 + 4, Z1 - 0.35, -9.5, Z1 - 0.35, WH, 0.7);
  merlons(b, 9.5, Z1 - 0.35, X1 - 4, Z1 - 0.35, WH, 0.7);
  // corner towers with witch-hat roofs + pennants
  for (const [cx, cz] of [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]] as P2[]) {
    lathe(b, cx, cz, [[4.6, 0, lit], [4.3, 15.5], [5.1, 16.4, P(stoneL, Surf.Stone)], [5.1, 17.4], [4.4, 17.4]], 14, 30);
    b.paint(slate, Surf.RoofTiles);
    lathe(b, cx, cz, [[5.5, 17.1], [2.2, 23.5], [0.15, 28.5], [0, 28.6]], 14, 40);
    b.paint(0x2c2e30, Surf.Metal).cylinder(cx, cz, 28.4, 3.2, 0.05, 0.04, 4);
    b.paint(0xc0392b, Surf.Plain).quad2([cx, 31.5, cz], [cx + 2.2, 31.0, cz], [cx, 30.4, cz], [cx, 30.4, cz]);
    b.paint(0x6e4a22, Surf.Emissive, 10);
    for (const a of [0.6, 2.2, 3.8, 5.4]) {
      const ox = Math.cos(a), oz = Math.sin(a);
      if (Math.abs(cx + ox * 4.5) < Math.abs(cx) || Math.abs(cz + oz * 4.5 - (Z0 + Z1) / 2) < Math.abs(cz - (Z0 + Z1) / 2)) continue;
      b.push().translate(cx + ox * 4.45, 8, cz + oz * 4.45).rotateY(Math.PI / 2 - a);
      b.box(-0.18, 0, -0.1, 0.18, 1.6, 0.1);
      b.pop();
    }
  }
  // square mid-wall towers on the sides
  for (const s of [-1, 1]) {
    const cx = s * 20, cz = -3;
    b.paint(lit).box(cx - 3.5, 0, cz - 3.5, cx + 3.5, 15, cz + 3.5);
    b.paint(stoneL, Surf.Stone);
    merlons(b, cx - 3.5, cz - 3.2, cx + 3.5, cz - 3.2, 15, 0.6, { w: 0.8, gap: 0.7 });
    merlons(b, cx - 3.5, cz + 3.2, cx + 3.5, cz + 3.2, 15, 0.6, { w: 0.8, gap: 0.7 });
    merlons(b, cx - 3.2, cz - 2.6, cx - 3.2, cz + 2.6, 15, 0.6, { w: 0.8, gap: 0.7 });
    merlons(b, cx + 3.2, cz - 2.6, cx + 3.2, cz + 2.6, 15, 0.6, { w: 0.8, gap: 0.7 });
  }
  // gatehouse: twin drum towers + gate block with portcullis + drawbridge
  for (const s of [-1, 1]) {
    lathe(b, s * 6.8, Z1, [[3.9, 0, lit], [3.7, 17], [4.3, 17.6, P(stoneL, Surf.Stone)], [4.3, 18.2], [3.4, 18.2]], 12, 30);
    b.paint(stoneL, Surf.Stone);
    merlonRing(b, s * 6.8, Z1, 3.95, 18.2, 10, 0.6, 1.2);
    b.paint(0xff9a3a, Surf.Emissive, 8).box(s * 6.8 - 0.25, 7.3, Z1 + 3.7, s * 6.8 + 0.25, 8.2, Z1 + 4.0);
  }
  b.paint(lit).box(-4.2, 0, Z1 - 3, 4.2, 14, Z1 + 1.8);
  b.paint(stoneL, Surf.Stone);
  merlons(b, -4.2, Z1 + 1.5, 4.2, Z1 + 1.5, 14, 0.6, { w: 0.8, gap: 0.7 });
  const gate = roundArch(0, 4.2, 4.6, 6);
  openingZ(b, gate, Z1 + 1.8, 1, 0x241e18);
  archFrameZ(b, gate, Z1 + 1.8, 1, 0.8, 0.4, P(stoneL, Surf.Stone));
  b.paint(0x2a2b2d, Surf.Metal);
  for (let i = -2; i <= 2; i++) b.box(i * 0.8 - 0.07, 1.8, Z1 + 1.86, i * 0.8 + 0.07, 6.3, Z1 + 1.95);
  for (let k = 0; k < 3; k++) b.box(-2.0, 2.4 + k * 1.3, Z1 + 1.86, 2.0, 2.55 + k * 1.3, Z1 + 1.97);
  b.paint(0x7a5a3a, Surf.Wood).box(-2.4, 0.2, Z1 + 1.8, 2.4, 0.5, Z1 + 8.8);
  b.paint(0x2a2b2d, Surf.Metal).beam([-2.2, 0.5, Z1 + 8.6], [-2.6, 8.5, Z1 + 1.9], 0.1).beam([2.2, 0.5, Z1 + 8.6], [2.6, 8.5, Z1 + 1.9], 0.1);
  // keep: tall square tower with corner turrets
  const kx = -5, kz = -9, kh = 30, ks = 7.5;
  b.paint(litL).box(kx - ks, 0, kz - ks, kx + ks, kh, kz + ks, { top: P(stoneD, Surf.RoofFlat) });
  // three arched slit windows per face on two levels (warm glow at night)
  for (let k = 0; k < 4; k++) {
    b.push().translate(kx, 0, kz).rotateY((k * Math.PI) / 2);
    for (const yl of [11, 20]) for (const x of [-3.6, 0, 3.6]) openingZ(b, roundArch(x, 0.8, yl + 1.7, 4, yl), ks, 1, 0x6e4a22, Surf.Emissive, 10);
    b.pop();
  }
  b.paint(stoneD, Surf.Stone).box(kx - ks - 0.4, kh - 1.6, kz - ks - 0.4, kx + ks + 0.4, kh, kz + ks + 0.4, { bottom: P(stoneD, Surf.Stone) });
  b.paint(stoneL, Surf.Stone);
  merlons(b, kx - ks + 1.8, kz - ks, kx + ks - 1.8, kz - ks, kh, 0.7);
  merlons(b, kx - ks + 1.8, kz + ks, kx + ks - 1.8, kz + ks, kh, 0.7);
  merlons(b, kx - ks, kz - ks + 1.8, kx - ks, kz + ks - 1.8, kh, 0.7);
  merlons(b, kx + ks, kz - ks + 1.8, kx + ks, kz + ks - 1.8, kh, 0.7);
  b.paint(slate, Surf.RoofTiles).pyramid(kx, kz, ks * 1.5, ks * 1.5, kh, 6.5);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const tx = kx + sx * ks, tz = kz + sz * ks;
    lathe(b, tx, tz, [[0.6, kh - 6, P(stoneL, Surf.Stone)], [2.0, kh - 3], [2.0, kh + 4.5], [2.3, kh + 4.8]], 10, 50);
    b.paint(slate, Surf.RoofTiles);
    lathe(b, tx, tz, [[2.4, kh + 4.6], [0.1, kh + 11], [0, kh + 11.1]], 10, 40);
  }
  b.paint(0x2c2e30, Surf.Metal).cylinder(kx, kz, kh + 6, 7, 0.07, 0.05, 4);
  b.paint(0x2e5aa8, Surf.Plain).quad2([kx, kh + 12.8, kz], [kx + 3, kh + 12.8, kz], [kx + 3, kh + 11.0, kz], [kx, kh + 11.0, kz]);
  // great hall + chapel + stables
  b.paint(0xc2bba9, Surf.WallWindows, 7, 9).box(5, 0, -19.4, 17.4, 9, -8);
  b.paint(0x5b4c44, Surf.RoofTiles).gableRoof(11.2, -13.7, 12.4, 11.4, 9, 6.5, 'x', 0.5, P(0xc2bba9, Surf.Stone));
  b.paint(stoneD, Surf.Stone).box(8, 12, -14.5, 9.2, 17.5, -13.2).box(14, 12, -14.5, 15.2, 17.5, -13.2);
  b.paint(0xc9c1ae, Surf.WallWindows, 7, 7).box(7, 0, 0, 14, 7, 9);
  b.paint(slate, Surf.RoofTiles).gableRoof(10.5, 4.5, 7, 9, 7, 4.2, 'z', 0.4, P(0xc9c1ae, Surf.Stone));
  b.paint(stoneL, Surf.Stone).box(9.7, 9, 8.2, 11.3, 12, 9.6);
  b.paint(slate, Surf.RoofTiles).pyramid(10.5, 8.9, 1.9, 1.9, 12, 3.6);
  b.paint(0x7a5a3a, Surf.Wood).box(-17.6, 0, 1, -13, 3.6, 12.5);
  b.paint(0x6b4a36, Surf.RoofTiles).shedRoof(-15.3, 6.75, 4.6, 11.5, 3.6, 1.4, 'nx');
  // well + market carts in the courtyard
  b.paint(stoneD, Surf.Stone);
  cylWall(b, -1, 6, 0.1, 1.1, 1.3, 1.3, 10);
  annulus(b, -1, 6, 1.1, 0.95, 1.3, 10);
  b.paint(0x2f5566, Surf.Water);
  disc(b, -1, 6, 0.9, 0.95, 10);
  b.paint(0x6b4a36, Surf.Wood).box(-2.4, 1.1, 5.9, -2.2, 3.2, 6.1).box(0.2, 1.1, 5.9, 0.4, 3.2, 6.1);
  b.paint(0x6b4a36, Surf.RoofTiles).gableRoof(-1, 6, 3.2, 2.2, 3.2, 0.9, 'x', 0.2);
  for (const [x, z, c] of [[-10, 10, 0xc0392b], [-7, 11.5, 0x2e5aa8]] as [number, number, number][]) {
    b.paint(0x8a6440, Surf.Wood).box(x - 1, 0.1, z - 0.7, x + 1, 1.0, z + 0.7);
    b.paint(c, Surf.Plain).box(x - 1.2, 2.0, z - 0.9, x + 1.2, 2.2, z + 0.9);
  }
  // torches on the inner walls
  b.paint(0xff9a3a, Surf.Emissive, 8);
  for (const [x, z] of [[-12, Z1 - WT - 0.1], [12, Z1 - WT - 0.1], [-12, Z0 + WT + 0.1], [12, Z0 + WT + 0.1]] as P2[]) b.box(x - 0.25, 6, z - 0.25, x + 0.25, 6.9, z + 0.25);
  // approach road + trees around
  path(b, [[0, Z1 + 8.8], [0.5, 26], [0, 32]], 4.4, 0xb9a888, 0.1);
  for (const [x, z] of [[-29, 29], [29, 29], [-29, -29], [29, -29], [-10, 29.5], [12, 29.5], [-29.5, 6], [29.5, -8]] as P2[]) tree(b, rng, x, z, 1.0, rng.chance(0.5) ? 'oak' : 'cone');
  for (let i = 0; i < 5; i++) person(b, rng, rng.range(-10, 10), rng.range(-3, 12), 0.12, rng.range(0, TAU));
}

// ================================================================================================ GLASS PYRAMID
function glassPyramid(b: ModelBuilder, cx: number, cz: number, half: number, h: number, y0: number, courses: number, rafters: number): void {
  const apex: V3 = [cx, y0 + h, cz];
  const corners: V3[] = [[cx - half, y0, cz + half], [cx + half, y0, cz + half], [cx + half, y0, cz - half], [cx - half, y0, cz - half]];
  b.paint(0xa9bcc6, Surf.GlassPlain, 2);
  for (let i = 0; i < 4; i++) orientTri(b, corners[i], corners[(i + 1) % 4], apex, [corners[i][0] + corners[(i + 1) % 4][0] - 2 * cx, 0.5, corners[i][2] + corners[(i + 1) % 4][2] - 2 * cz]);
  // structural lattice: horizontal courses + rafters, then heavier hips and base frame
  const lerp3 = (a: V3, c: V3, t: number): V3 => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
  b.paint(0xa9b2ba, Surf.Metal);
  for (let i = 0; i < 4; i++) {
    const a = corners[i], c = corners[(i + 1) % 4];
    const mid = lerp3(a, c, 0.5);
    const out: V3 = [mid[0] - cx, 0, mid[2] - cz];
    const ol = Math.hypot(out[0], out[2]);
    const off = (p: V3): V3 => [p[0] + (out[0] / ol) * 0.06, p[1] + 0.05, p[2] + (out[2] / ol) * 0.06];
    // Louvre-style diamond lattice: two diagonal beam families parallel to the two hip edges
    const nd = courses;
    for (let k = 1; k < nd; k++) {
      const t = k / nd;
      const base = lerp3(a, c, t);
      b.beam(off(base), off(lerp3(apex, c, t)), 0.12);
      b.beam(off(base), off(lerp3(a, apex, t)), 0.12);
    }
    void rafters;
  }
  b.paint(0x6f7a84, Surf.Metal);
  for (let i = 0; i < 4; i++) {
    b.beam(corners[i], apex, 0.32);
    b.beam(corners[i], corners[(i + 1) % 4], 0.35);
  }
  // uplight strip along the base
  b.paint(0xfff1d0, Surf.Emissive);
  for (let i = 0; i < 4; i++) {
    const a = corners[i], c = corners[(i + 1) % 4];
    const mx = (a[0] + c[0]) / 2 - cx, mz = (a[2] + c[2]) / 2 - cz, l = Math.hypot(mx, mz);
    b.beam([a[0] + (mx / l) * 0.5, y0, a[2] + (mz / l) * 0.5], [c[0] + (mx / l) * 0.5, y0, c[2] + (mz / l) * 0.5], 0.18);
  }
}

function pyramidPlaza(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 24;
  b.paint(0xc9c4b8, Surf.Pavement).slab(-E, -E, E, E, 0.1);
  b.paint(0xb3ad9f, Surf.Pavement);
  for (const r of [17.4, 21.5]) {
    rect(b, -r, -r, r, -r + 0.6, 0.115); rect(b, -r, r - 0.6, r, r, 0.115); rect(b, -r, -r + 0.6, -r + 0.6, r - 0.6, 0.115); rect(b, r - 0.6, -r + 0.6, r, r - 0.6, 0.115);
  }
  const oz = -1;
  b.paint(0xc8c2b5, Surf.Stone).box(-16.4, 0.1, oz - 16.4, 16.4, 0.45, oz + 16.4);
  glassPyramid(b, 0, oz, 16, 30, 0.45, 9, 7);
  // small pyramids at the front corners
  for (const s of [-1, 1]) {
    b.paint(0xc8c2b5, Surf.Stone).box(s * 18 - 3.5, 0.1, 17.5, s * 18 + 3.5, 0.35, 23.4);
    glassPyramid(b, s * 18, 20.4, 3.2, 5.6, 0.35, 3, 3);
  }
  // triangular fountain basins on the sides and back, pointing outward
  const basin = (tip: P2, b0: P2, b1: P2) => {
    const poly: P2[] = [tip, b0, b1];
    b.paint(0x9e988c, Surf.Stone);
    ribbon(b, poly, 0.7, 0.55, { closed: true, sides: true, y0: 0.1 });
    b.paint(0x3f7fa0, Surf.Water);
    flatPoly(b, poly, 0.42);
    b.paint(0xc4dde6, Surf.Emissive, 10);
    const cxp = (tip[0] + b0[0] + b1[0]) / 3, czp = (tip[1] + b0[1] + b1[1]) / 3;
    for (const t of [0.25, 0.5, 0.75]) {
      const x = b0[0] + (b1[0] - b0[0]) * t, z = b0[1] + (b1[1] - b0[1]) * t;
      b.cone(x + (cxp - x) * 0.45, z + (czp - z) * 0.45, 0.42, 1.8, 0.13, 5, true);
    }
    b.cone(cxp, czp, 0.42, 3.0, 0.2, 6, true);
  };
  basin([23, oz], [18, oz - 7], [18, oz + 7]);
  basin([-23, oz], [-18, oz + 7], [-18, oz - 7]);
  basin([0, -23.2], [-7, -18.2], [7, -18.2]);
  // benches, lamps, trees, visitors
  for (const s of [-1, 1]) {
    for (const z of [-10, 8]) parkBench(b, s * 17.4, z, s > 0 ? -Math.PI / 2 : Math.PI / 2);
    // plaza pool + pools on the two darker paving frames
    const frames: P2[][] = [];
    for (const r of [17.4, 21.5]) frames.push(rectPoly(-r, -r, r, -r + 0.6), rectPoly(-r, r - 0.6, r, r), rectPoly(-r, -r + 0.6, -r + 0.6, r - 0.6), rectPoly(r - 0.6, -r + 0.6, r, r - 0.6));
    const pp: PoolSpec[] = [{ color: 0xc9c4b8, y: 0.1, dy: 0.03 }, { color: 0xb3ad9f, y: 0.115, dy: 0.03, clip: frames }];
    lamp(b, s * 6, 18.5, 4.8, 2, pp);
    lamp(b, s * 21.5, -12, 4.8, 2, pp);
    lamp(b, s * 21.5, 11, 4.8, 2, pp);
    tree(b, rng, s * 21.8, -21.8, 0.9, 'round');
    tree(b, rng, s * 12, -21.9, 0.8, 'round');
  }
  for (let i = 0; i < 10; i++) person(b, rng, rng.range(-15, 15), rng.range(16.5, 23), 0.1, rng.range(0, TAU));
}

// ================================================================================================ OBSERVATORY
function observatory(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 16;
  lawnPatchwork(b, rng, -E, -E, E, E, GRASS_LUSH, 3);
  const stone = 0xd6cfc1, stoneD = 0xbab19f;
  // terrace + steps
  b.paint(stoneD, Surf.Stone).box(-15.2, 0, -13.5, 15.2, 1.2, 8.4, { top: P(0xc9c2b3, Surf.Pavement) });
  for (let i = 0; i < 4; i++) b.paint(0xc6bead, Surf.Stone).box(-4.5, 0, 8.4, 4.5, 1.2 - i * 0.3, 8.4 + (i + 1) * 0.7, { nz: null });
  const walk = path(b, [[0, 16], [0.3, 13], [0, 11.2]], 3.0, PATH_GRAVEL, 0.12);
  // main drum with arched windows + cornice
  const cx = 0, cz = -3, R = 7.2;
  lathe(b, cx, cz, [[R, 1.2, P(stone, Surf.WallWindows, 7, 4.4)], [R, 9.4, P(stoneD, Surf.Stone)], [R + 0.5, 9.9], [R + 0.5, 10.5], [R - 0.1, 10.5]], 24, 30);
  // dome (white) with the observing slit + opened shutter + telescope
  const DR = 7.3, DY = 10.5;
  b.paint(0xdcdcd6, Surf.Plain);
  b.sphere(cx, DY, cz, DR, 24, 12, { hemi: true });
  const phi = 0.45; // slit direction (toward +Z, turned a little toward +X)
  const dx = Math.sin(phi), dz = Math.cos(phi);
  const meridian = (off: number, rr: number, e0: number, e1: number, n: number): V3[] => {
    const out: V3[] = [];
    const ox = Math.cos(phi) * off, oz = -Math.sin(phi) * off;
    for (let i = 0; i <= n; i++) {
      const e = e0 + ((e1 - e0) * i) / n;
      const rad = Math.sqrt(Math.max(0, rr * rr - off * off));
      out.push([cx + ox + Math.cos(e) * rad * dx, DY + Math.sin(e) * rad, cz + oz + Math.cos(e) * rad * dz]);
    }
    return out;
  };
  b.paint(0x121416, Surf.Plain);
  track3D(b, meridian(0, DR + 0.04, 0.05, Math.PI * 0.62, 12), 1.9, 0.08);
  b.paint(0x6a1c1c, Surf.Emissive, 10);
  track3D(b, meridian(0, DR + 0.08, 0.1, Math.PI * 0.58, 12), 0.5, 0.05);
  b.paint(0xdfe1e3, Surf.Metal);
  track3D(b, meridian(1.2, DR + 0.25, 0.05, Math.PI * 0.62, 12), 0.3, 0.3);
  track3D(b, meridian(-1.2, DR + 0.25, 0.05, Math.PI * 0.62, 12), 0.3, 0.3);
  track3D(b, meridian(2.3, DR + 0.35, 0.05, Math.PI * 0.55, 10), 1.6, 0.15);
  const el = 0.75;
  b.paint(0xf4f4f2, Surf.Metal).pipe([cx + dx * 1.5, DY + 1.0, cz + dz * 1.5], [cx + dx * Math.cos(el) * 9, DY + 1.0 + Math.sin(el) * 9, cz + dz * Math.cos(el) * 9], 0.7, 10);
  b.paint(0x2b2d31, Surf.Metal).pipe([cx + dx * Math.cos(el) * 8.6, DY + 1.0 + Math.sin(el) * 8.6, cz + dz * Math.cos(el) * 8.6], [cx + dx * Math.cos(el) * 9.1, DY + 1.0 + Math.sin(el) * 9.1, cz + dz * Math.cos(el) * 9.1], 0.72, 10);
  // wings with copper domes
  for (const s of [-1, 1]) {
    const wx = s * 11.3;
    b.paint(stone, Surf.WallWindows, 7, 4.4).box(wx - 3.9, 1.2, -7.5, wx + 3.9, 6.8, 1.5, { top: P(0xcfc8b8, Surf.RoofFlat) });
    b.paint(stoneD, Surf.Stone).box(wx - 4.2, 6.8, -7.8, wx + 4.2, 7.4, 1.8);
    b.paint(stoneD, Surf.Stone).cylinder(wx, -3, 7.4, 1.0, 2.8, 2.8, 14);
    b.paint(0x7aa592, Surf.Metal, 3).sphere(wx, 8.4, -3, 2.7, 14, 8, { hemi: true });
    b.paint(0x121416, Surf.Plain).box(wx - 0.3, 8.6, -0.6, wx + 0.3, 10.8, -0.3);
    b.paint(0x6a1c1c, Surf.Emissive, 10).box(wx - 0.1, 8.7, -0.62, wx + 0.1, 10.6, -0.58, { top: null, bottom: null, nx: null, px: null, nz: null });
  }
  // portico: columns, entablature, pediment
  b.paint(stone, Surf.Stone);
  for (const x of [-3.3, -1.1, 1.1, 3.3]) b.cylinder(x, 6.6, 1.2, 5.2, 0.38, 0.33, 10);
  b.paint(stoneD, Surf.Stone).box(-4.3, 6.4, 3.4, 4.3, 7.4, 7.4);
  b.paint(stone, Surf.Stone);
  gablePrism(b, -4.3, 4.3, 7.4, 9.4, 3.4, 7.4);
  b.paint(0x3a3028, Surf.Plain).box(-1.1, 1.2, 4.18, 1.1, 4.4, 4.24);
  // grounds: trees, armillary sphere, lamps, benches
  for (const [x, z, k] of [[-13.5, 12.5, 'cone'], [13.5, 12.5, 'round'], [-14, -14.5, 'oak'], [13.8, -14.6, 'cone'], [-7.5, 13.6, 'round']] as [number, number, 'oak'][]) tree(b, rng, x, z, 0.85, k);
  b.paint(0xb8913a, Surf.Metal).cylinder(8.5, 12.5, 0, 1.3, 0.15, 0.1, 6);
  b.ring(8.5, 2.3, 12.5, 1.0, 0.07, 12);
  b.push().translate(8.5, 2.3, 12.5).rotateX(Math.PI / 2);
  b.ring(0, 0, 0, 1.0, 0.07, 12);
  b.pop();
  // (path pool clipped to the actual gravel ribbon, not a wider rect that spilled gravel colour onto the lawn by day)
  for (const x of [-3.4, 3.4]) lamp(b, x, 13.8, 3.8, 1, [...lawnPools(), { color: PATH_GRAVEL, y: 0.12, clip: ribbonQuads(walk, 3.0) }]);
  parkBench(b, -10, 11, 0.2);
  for (let i = 0; i < 4; i++) person(b, rng, rng.range(-5, 5), rng.range(9, 14), 0.1, rng.range(0, TAU));
}

// ================================================================================================ TRIUMPHAL ARCH
function triumphalArch(b: ModelBuilder, _v: number, rng: RNG): void {
  const EX = 16, EZ = 8;
  const stone = 0xd6cbb2, stoneL = 0xe0d6c0, stoneD = 0xb9ad93;
  // floodlit masonry (Stone pattern 1, reach 36 m)
  const S = (c: number): Paint => P(c, Surf.Stone, 1, 36);
  const paveC = 0xc6bfaf;
  b.paint(paveC, Surf.Pavement).slab(-EX, -EZ, EX, EZ, 0.1);
  b.paint(0xafa796, Surf.Pavement);
  annulus(b, 0, 0, 0.115, 7.2, 7.8, 24);
  const HW = 14, HD = 5.5, H = 34, OW = 5, SP = 17;
  // arch body: front/back faces with the passage cut out
  const face: P2[] = [[-HW, 0.1], [-OW, 0.1], ...Array.from({ length: 13 }, (_, i) => {
    const a = Math.PI - (i / 12) * Math.PI;
    return [Math.cos(a) * OW, SP + Math.sin(a) * OW] as P2;
  }), [OW, 0.1], [HW, 0.1], [HW, H], [-HW, H]];
  b.paint(S(stone));
  polyZ(b, face, HD, 1);
  polyZ(b, face, -HD, -1);
  b.box(-HW, 0.1, -HD, HW, H, HD, { pz: null, nz: null, bottom: null });
  // jambs + glowing vault (lit from within at night)
  b.paint(S(stoneD));
  orientQuad(b, [-OW, 0.1, -HD], [-OW, 0.1, HD], [-OW, SP, HD], [-OW, SP, -HD], [1, 0, 0]);
  orientQuad(b, [OW, 0.1, -HD], [OW, 0.1, HD], [OW, SP, HD], [OW, SP, -HD], [-1, 0, 0]);
  b.paint(0x86745a, Surf.Emissive);
  for (let i = 0; i < 12; i++) {
    const a0 = Math.PI - (i / 12) * Math.PI, a1 = Math.PI - ((i + 1) / 12) * Math.PI;
    const am = (a0 + a1) / 2;
    orientQuad(b, [Math.cos(a0) * OW, SP + Math.sin(a0) * OW, -HD], [Math.cos(a1) * OW, SP + Math.sin(a1) * OW, -HD], [Math.cos(a1) * OW, SP + Math.sin(a1) * OW, HD], [Math.cos(a0) * OW, SP + Math.sin(a0) * OW, HD], [-Math.cos(am), -Math.sin(am), 0]);
  }
  // coffer ribs inside the vault
  b.paint(0x9a8a70, Surf.Stone);
  for (const z of [-3.2, -1, 1, 3.2]) {
    const rib: V3[] = Array.from({ length: 9 }, (_, i) => {
      const a = Math.PI - (i / 8) * Math.PI;
      return [Math.cos(a) * (OW - 0.05), SP + Math.sin(a) * (OW - 0.05), z] as V3;
    });
    track3D(b, rib, 0.35, 0.25);
  }
  // plinth, imposts, entablature, attic, top cornice
  b.paint(S(stoneD));
  b.box(-HW - 0.6, 0.1, -HD - 0.6, -OW, 2.4, HD + 0.6).box(OW, 0.1, -HD - 0.6, HW + 0.6, 2.4, HD + 0.6);
  b.paint(S(stoneL));
  b.box(-HW - 0.3, SP - 0.6, -HD - 0.3, -OW, SP + 0.2, HD + 0.3).box(OW, SP - 0.6, -HD - 0.3, HW + 0.3, SP + 0.2, HD + 0.3);
  b.box(-HW - 0.7, 25.4, -HD - 0.7, HW + 0.7, 27.0, HD + 0.7);
  b.box(-HW - 0.5, H - 0.2, -HD - 0.5, HW + 0.5, H + 0.9, HD + 0.5);
  for (const s of [-1, 1] as const) {
    // engaged columns with capitals
    b.paint(S(stoneL));
    for (const x of [-12.6, -6.4, 6.4, 12.6]) {
      b.cylinder(x, s * HD, 2.4, 22.3, 0.7, 0.62, 10, { top: false });
      b.box(x - 0.9, 24.6, s * HD - 0.9, x + 0.9, 25.4, s * HD + 0.9, { bottom: null });
    }
    // deep relief panels (0.6 m) with figures standing 0.55 m proud
    for (const px of [-9.5, 9.5]) {
      b.paint(S(0xcabfa6)).box(px - 2.2, 5.5, Math.min(s * HD - s * 0.05, s * HD + s * 0.6), px + 2.2, 14.5, Math.max(s * HD - s * 0.05, s * HD + s * 0.6));
      b.paint(S(0xb4a88e));
      const zf = s * HD + s * 0.6;
      for (const fx of [-1.25, 0, 1.25]) {
        const fy = 6.6 + (fx === 0 ? 0.5 : 0);
        b.box(px + fx - 0.35, fy, Math.min(zf, zf + s * 0.55), px + fx + 0.35, fy + 3.4, Math.max(zf, zf + s * 0.55));
        b.box(px + fx - 0.22, fy + 3.45, Math.min(zf, zf + s * 0.5), px + fx + 0.22, fy + 4.0, Math.max(zf, zf + s * 0.5));
        b.box(px + fx - 0.62, fy + 1.4, Math.min(zf, zf + s * 0.4), px + fx + 0.62, fy + 3.0, Math.max(zf, zf + s * 0.4));
      }
      b.box(px - 2.0, 13.2, Math.min(zf, zf + s * 0.35), px + 2.0, 13.6, Math.max(zf, zf + s * 0.35));
    }
    // inscription panel on the attic + keystone
    b.paint(S(0xc9bea6)).box(-8.5, 28.2, Math.min(s * HD - s * 0.05, s * HD + s * 0.25), 8.5, 32.6, Math.max(s * HD - s * 0.05, s * HD + s * 0.25));
    b.paint(0x8a7c62, Surf.Plain);
    for (let i = 0; i < 9; i++) rectZ(b, -7 + i * 1.75, 29.8, 1.1, 0.5, s * (HD + 0.27), s);
    b.paint(S(stoneL)).box(-0.7, SP + OW - 1.6, Math.min(s * HD - s * 0.05, s * HD + s * 0.45), 0.7, SP + OW + 0.6, Math.max(s * HD - s * 0.05, s * HD + s * 0.45));
    // uplight strip on the plinth top
    b.paint(0xfff1d0, Surf.Emissive).box(-HW, 2.4, s * (HD + 0.35) - 0.12, -9.5 - 2.3, 2.55, s * (HD + 0.35) + 0.12).box(-9.5 + 2.3, 2.4, s * (HD + 0.35) - 0.12, -OW - 0.2, 2.55, s * (HD + 0.35) + 0.12);
    b.box(OW + 0.2, 2.4, s * (HD + 0.35) - 0.12, 9.5 - 2.3, 2.55, s * (HD + 0.35) + 0.12).box(9.5 + 2.3, 2.4, s * (HD + 0.35) - 0.12, HW, 2.55, s * (HD + 0.35) + 0.12);
  }
  // blind side arches on the ±X faces
  for (const s of [-1, 1] as const) {
    b.push().rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2);
    const side = roundArch(0, 4.6, 9, 8, 2.4);
    openingZ(b, side, HW, 1, 0x8d8068, Surf.Stone);
    archFrameZ(b, side, HW, 1, 0.7, 0.35, S(stoneL));
    b.pop();
  }
  // bronze quadriga group on top
  const bronze = 0x4f6b5a;
  b.paint(S(stoneD)).box(-5.5, H + 0.9, -3.2, 5.5, H + 2.6, 3.2);
  b.paint(bronze, Surf.Metal, 3);
  const TY = H + 2.6;
  for (const hx of [-2.7, -0.9, 0.9, 2.7]) {
    b.box(hx - 0.35, TY + 1.3, 0.2, hx + 0.35, TY + 2.2, 2.4);
    for (const lz of [0.5, 2.1]) b.box(hx - 0.3, TY, lz - 0.12, hx + 0.3, TY + 1.35, lz + 0.12, { top: null, bottom: null });
    b.beam([hx, TY + 2.0, 2.2], [hx, TY + 3.3, 2.9], 0.4);
    b.box(hx - 0.2, TY + 3.0, 2.8, hx + 0.2, TY + 3.5, 3.4);
  }
  b.box(-2, TY + 0.6, -2.4, 2, TY + 2.0, -0.2);
  b.cylinder(-2.1, -1.3, TY, 0.01, 1.1, 1.1, 10);
  b.push().translate(0, TY + 1.0, -1.3).rotateZ(Math.PI / 2);
  b.cylinder(0, 0, -2.25, 4.5, 1.0, 1.0, 10);
  b.pop();
  lathe(b, 0, -1.3, [[0.55, TY + 2.0], [0.4, TY + 4.2], [0.32, TY + 4.8], [0, TY + 5.1]], 8);
  b.beam([0.3, TY + 4.4, -1.3], [0.9, TY + 6.2, -0.9], 0.18);
  for (const s of [-1, 1]) b.quad2([0, TY + 4.4, -1.6], [s * 1.8, TY + 5.8, -2.2], [s * 1.2, TY + 3.2, -2.0], [0, TY + 3.4, -1.6]);
  // eternal flame under the arch + lamps + bollards
  b.paint(bronze, Surf.Metal, 3).cylinder(0, 0, 0.1, 0.6, 0.5, 0.8, 10);
  b.paint(0xff8c2a, Surf.Emissive).cone(0, 0, 0.7, 1.0, 0.45, 6, true);
  for (const [x, z] of [[-15, 7], [15, 7], [-15, -7], [15, -7]] as P2[]) lamp(b, x, z, 4.6, 1, [{ color: paveC, y: 0.1, dy: 0.03 }]);
  b.paint(0x2e3033, Surf.Metal);
  for (let x = -12; x <= 12; x += 3) if (Math.abs(x) > 3) b.cylinder(x, 7.4, 0.1, 0.9, 0.16, 0.14, 6);
  for (let i = 0; i < 6; i++) person(b, rng, rng.range(-12, 12), rng.range(6.2, 7.6), 0.1, rng.range(0, TAU));
}
/** small flat rectangle on a Z-facing plane */
function rectZ(b: ModelBuilder, x: number, y: number, w: number, h: number, z: number, dir: 1 | -1): void {
  polyZ(b, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], z, dir);
}

// ================================================================================================ GIANT OBSERVATION WHEEL
function observationWheel(b: ModelBuilder, _v: number, rng: RNG): void {
  const EX = 24, EZ = 16;
  b.paint(0xc6c0b4, Surf.Pavement).slab(-EX, -EZ, EX, EZ, 0.1);
  // terminal building (curved glass, roof deck)
  const term = roundRectPath(0, -1, 34, 17, 6, 4);
  b.paint(0x7faab0, Surf.GlassPlain, 2);
  b.extrude(term, 0.1, 12.4, { topPaint: P(0xcac5ba, Surf.Pavement) });
  b.paint(0xe8e6e0, Surf.Metal);
  b.extrude(offsetPoly(term, 0.35), 12.4, 0.7, { top: false });
  b.extrude(offsetPoly(term, 0.35), 4.6, 0.4, { top: false });
  b.extrude(offsetPoly(term, 0.35), 8.6, 0.4, { top: false });
  b.paint(GRASS_LUSH, Surf.Foliage);
  for (const s of [-1, 1]) b.slab(s * 11 - 3.5, -6, s * 11 + 3.5, 3, 0.35, 13.1);
  // boarding platform under the wheel
  b.paint(0x8e8b84, Surf.Pavement).box(-5, 13.1, -3.5, 5, 13.6, 3.5);
  // wheel geometry
  const hub = 37.2, R = 20.4, Rc = 22.2, n = 24, seg = 36, hw = 1.4;
  const W = (a: number, r: number, z: number): V3 => [Math.cos(a) * r, hub + Math.sin(a) * r, z];
  // legs (A-frames front and back) + ties
  b.paint(0xeef0f2, Surf.Metal);
  for (const s of [-1, 1]) {
    b.pipe([-12.5, 0.1, s * 12.5], [0, hub, s * 3.6], 0.85, 8);
    b.pipe([12.5, 0.1, s * 12.5], [0, hub, s * 3.6], 0.85, 8);
    b.beam([-6.6, 17, s * 8.2], [6.6, 17, s * 8.2], 0.5);
  }
  // hub + spindle
  b.paint(0xb9bec3, Surf.Metal);
  b.push().translate(0, hub, 0).rotateX(Math.PI / 2);
  b.cylinder(0, 0, -3.9, 7.8, 0.8, 0.8, 10);
  b.cylinder(0, 0, -2.6, 5.2, 1.9, 1.9, 14, { bottom: true });
  b.pop();
  // rims + inner chord + truss + cable spokes
  b.paint(0xf2f3f4, Surf.Metal);
  for (const z of [-hw, hw]) {
    b.push().translate(0, hub, z);
    b.ring(0, 0, 0, R, 0.55, seg, 'xy');
    b.pop();
  }
  b.push().translate(0, hub, 0);
  b.ring(0, 0, 0, R - 2.4, 0.4, seg, 'xy');
  b.pop();
  b.paint(0xdfe3e6, Surf.Metal);
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU, a1 = ((i + 0.5) / seg) * TAU;
    b.beam(W(a, R - 2.4, 0), W(a1, R, hw), 0.18);
    b.beam(W(a, R - 2.4, 0), W(a1, R, -hw), 0.18);
  }
  b.paint(0xc9ced3, Surf.Metal);
  for (let i = 0; i < seg; i += 2) {
    const a = (i / seg) * TAU;
    for (const s of [-1, 1]) {
      const p0 = W(a, 1.9, s * 2.6), p1 = W(a + 0.09, R - 2.4, 0);
      const px = -Math.sin(a) * 0.06, py = Math.cos(a) * 0.06;
      b.quad2([p0[0] + px, p0[1] + py, p0[2]], [p1[0] + px, p1[1] + py, p1[2]], [p1[0] - px, p1[1] - py, p1[2]], [p0[0] - px, p0[1] - py, p0[2]]);
    }
  }
  // LED rings on the rim faces (glow at night)
  b.paint(0xbfe8ff, Surf.Emissive);
  for (const s of [-1, 1] as const) {
    const z = s * (hw + 0.29);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
      orientQuad(b, W(a0, R - 0.2, z), W(a1, R - 0.2, z), W(a1, R + 0.2, z), W(a0, R + 0.2, z), [0, 0, s]);
    }
  }
  // capsules (glass pods along Z, mounted outside the rim)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.07;
    const [px, py] = W(a, Rc, 0);
    b.paint(0xc7ccd1, Surf.Metal).beam(W(a, R + 0.3, 0), [px - Math.cos(a) * 1.2, py - Math.sin(a) * 1.2, 0], 0.3);
    b.push().translate(px, py, 0).rotateX(Math.PI / 2);
    b.paint(0x9fc3d6, Surf.GlassPlain, 2).cylinder(0, 0, -1.7, 3.4, 1.3, 1.3, 10, { top: false });
    b.paint(0xeef0f2, Surf.Metal);
    lathe(b, 0, 0, [[1.32, 1.7], [0.9, 2.1], [0, 2.25]], 10);
    lathe(b, 0, 0, [[0, -2.25], [0.9, -2.1], [1.32, -1.7]], 10);
    b.pop();
  }
  beacon(b, 0, hub + R + 0.4, 0, 0.5);
  // plaza: fountains, queue rails, ticket kiosk, trees, flags
  fountain(b, -15, 11.5, 2.4, 1, { seg: 14 });
  fountain(b, 15, 11.5, 2.4, 1, { seg: 14 });
  b.paint(0x9aa0a6, Surf.Metal);
  for (let k = 0; k < 4; k++) b.beam([-6, 0.9, 9 + k * 1.3], [6, 0.9, 9 + k * 1.3], 0.06);
  b.paint(0x2e3a44, Surf.Metal).box(7.5, 0.1, 11.5, 10.5, 2.8, 13.5);
  b.paint(0xffd166, Surf.Emissive).box(7.6, 2.0, 13.5, 10.4, 2.6, 13.55, { top: null, bottom: null, nx: null, px: null, nz: null });
  for (const [x, z] of [[-22, 13.5], [22, 13.5], [-22, -13.5], [22, -13.5]] as P2[]) tree(b, rng, x, z, 0.9, 'round');
  for (const x of [-19, 19]) lamp(b, x, 8.5, 4.6, 2, [{ color: 0xc6c0b4, y: 0.1, dy: 0.03 }]);
  for (let i = 0; i < 10; i++) person(b, rng, rng.range(-12, 12), rng.range(8.5, 15), 0.1, rng.range(0, TAU));
}

export const hallModels = {
  lm_cathedral: cathedral,
  lm_opera_house: operaHouse,
  lm_castle: castle,
  lm_pyramid: pyramidPlaza,
  lm_observatory: observatory,
  lm_arch: triumphalArch,
  lm_ferris_wheel: observationWheel,
};

void flowerBed; void shrub; void hedgeBox; void polyX; void prismEdges; void PATH_PAVE; void disc;
