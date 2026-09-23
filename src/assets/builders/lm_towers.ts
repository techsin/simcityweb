/**
 * Landmark towers: observation/TV tower, twin-spire megatower, clock tower, lighthouse, obelisk.
 * (park/landmark asset agent) Budget <= 8000 tris each.
 */
import { ModelBuilder, type Paint } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import {
  type P2, type V3, type ProfPt, lathe, tree, lamp, parkBench, flowerBed, shrub, fountain, disc, annulus, rect, ribbon, cylWall, flatPoly, blobPoly,
  path, person, ribbonQuads, GRASS_LUSH, PATH_PAVE,
} from './park_lib';
import { prismEdges, polyZ, gothicArch, roundArch, openingZ, beacon, planePoly } from './lm_lib';

const TAU = Math.PI * 2;
const P = (color: number, surf: Surf = Surf.Plain, pattern = 0, floor = 3.3): Paint => ({ color, surf, pattern, floor });

// ================================================================================================ OBSERVATION / TV TOWER
function spireTower(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 16;
  // warm uplight washes only the lower ~70 m of shaft and fins; higher up the LED fin strips, the glazed lift strips and
  // the pod bands carry the night silhouette (a 330 m reach made the whole shaft a flat glowing stick)
  const concrete = P(0xd4d0c6, Surf.Plain, 1, 70);
  // plaza with three lawn wedges between the fins
  b.paint(0xc6c1b6, Surf.Pavement).slab(-E, -E, E, E, 0.1);
  b.paint(0xaea89b, Surf.Pavement);
  annulus(b, 0, 0, 0.115, 9.2, 10.2, 30);
  const fins = [Math.PI / 2, Math.PI / 2 + TAU / 3, Math.PI / 2 + (2 * TAU) / 3];
  for (const a of fins) {
    const am = a + Math.PI / 3;
    const pts: P2[] = [];
    for (let k = -3; k <= 3; k++) {
      const t = am + (k / 3) * 0.62;
      pts.push([Math.cos(t) * 15.2, Math.sin(t) * 15.2]);
    }
    pts.push([Math.cos(am + 0.3) * 10.8, Math.sin(am + 0.3) * 10.8], [Math.cos(am - 0.3) * 10.8, Math.sin(am - 0.3) * 10.8]);
    const cl = pts.map(([x, z]) => [Math.max(-15.6, Math.min(15.6, x)), Math.max(-15.6, Math.min(15.6, z))] as P2);
    b.paint(GRASS_LUSH, Surf.Foliage);
    flatPoly(b, cl, 0.14);
    tree(b, rng, Math.cos(am) * 12.8, Math.sin(am) * 12.8, 0.9, 'round');
  }
  // glass lobby drum around the base
  lathe(b, 0, 0, [[9.0, 0.1, P(0x8fb0c4, Surf.GlassPlain, 2)], [9.0, 6.4, P(0xd6d4ce, Surf.Metal)], [9.5, 6.8], [9.5, 7.6, P(0xcfccc4, Surf.RoofFlat)], [5.8, 7.6]], 30, 30);
  // three tapered fins (buttresses) + LED edge strips
  const finPoly: P2[] = [[5.2, 0.1], [14.6, 0.1], [14.6, 3.4], [13.0, 24], [9.8, 66], [7.2, 104], [5.6, 122], [5.0, 122]];
  for (const a of fins) {
    b.push().rotateY(-a).rotateX(-Math.PI / 2);
    b.paint(concrete).extrude(finPoly, -1.6, 3.2, { top: true, bottom: true });
    b.pop();
    const W = (r: number, y: number): V3 => [Math.cos(a) * r, y, Math.sin(a) * r];
    b.paint(0xfff3dc, Surf.Emissive);
    for (let k = 2; k < finPoly.length - 2; k++) b.beam(W(finPoly[k][0] + 0.05, finPoly[k][1]), W(finPoly[k + 1][0] + 0.05, finPoly[k + 1][1]), 0.32);
  }
  // core shaft with entasis + ring grooves, main pod, upper shaft, sky pod (single revolved profile)
  const rAt = (y: number) => 6.3 - (y / 330) * 2.1;
  const prof: ProfPt[] = [[rAt(7.6), 7.6, concrete]];
  // each pour section above a ring groove is a shade darker: a gentle tonal gradient up the shaft by day, and at
  // night the moonlit shaft recedes toward the top instead of reading as one flat bright stick
  const pour = [0xcdc9bf, 0xc5c1b7, 0xbdb9af, 0xb5b1a7, 0xaeaaa0];
  [60, 118, 176, 234, 292].forEach((yb, i) => {
    prof.push([rAt(yb), yb], [rAt(yb) + 0.35, yb + 0.6], [rAt(yb) + 0.35, yb + 1.8], [rAt(yb + 2.4), yb + 2.4, P(pour[i], Surf.Plain, 1, 70)]);
  });
  prof.push(
    [rAt(322), 322, P(0xc8c6c0, Surf.Metal)],
    // pod soffit: warm night-only glow (reads as the pod's uplit underside from the street)
    [6.8, 328.5, P(0xa89c84, Surf.Emissive, 10)], [12.4, 336.4, P(0x7fa2c0, Surf.GlassCurtain, 5, 3.4)], [13.2, 337.4], [13.2, 342.2, P(0x9ee8ff, Surf.Emissive, 6)],
    [13.8, 342.8], [13.8, 343.8, P(0xe8e8e4, Surf.Metal)], [12.9, 344.4, P(0x6f8fae, Surf.GlassCurtain, 5, 3.0)], [12.9, 350.4, P(0xf1f0ec, Surf.Metal)],
    [11.9, 351.4], [8.4, 355.2], [4.2, 357.6, P(pour[4], Surf.Plain, 1, 70)], [3.6, 398, P(0xe8e8e4, Surf.Metal)], [5.8, 400.6, P(0x6f8fae, Surf.GlassCurtain, 5, 2.6)],
    [5.8, 405.2, P(0x9ee8ff, Surf.Emissive, 6)], [6.1, 405.6], [6.1, 406.3, P(0xe8e8e4, Surf.Metal)], [3.0, 409], [2.4, 409.5],
  );
  lathe(b, 0, 0, prof, 24, 28);
  // antenna mast with aviation paint bands
  const ant: ProfPt[] = [];
  const bands = 8;
  for (let i = 0; i <= bands; i++) {
    const y = 409.5 + (i / bands) * 64;
    const r = 1.9 - (i / bands) * 1.05;
    ant.push([r, y, i % 2 ? P(0xf2f0ea, Surf.Metal) : P(0xd0402e, Surf.Metal)]);
  }
  ant.push([0.45, 492, P(0xd0402e, Surf.Metal)], [0.12, 494], [0, 494]);
  lathe(b, 0, 0, ant, 10, 40);
  for (const y of [410, 440, 470, 493.6]) {
    const r = y > 490 ? 0.1 : 1.9 - ((y - 409.5) / 64) * 1.05;
    beacon(b, r + 0.1, y, 0, 0.5);
    beacon(b, -r - 0.1, y, 0, 0.5);
  }
  // glazed elevator strips on the core between the fins (glow at night)
  for (const a of fins) {
    const am = a + Math.PI / 3;
    const c = Math.cos(am), s = Math.sin(am);
    b.paint(0x8fb0c4, Surf.GlassPlain).beam([c * (rAt(8) - 0.2), 8, s * (rAt(8) - 0.2)], [c * (rAt(320) - 0.2), 320, s * (rAt(320) - 0.2)], 1.4);
  }
  // pod: vertical mullion ribs over the glass bands + outdoor sky deck ring with railing
  b.paint(0xe8e8e4, Surf.Metal);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU + TAU / 48;
    const c = Math.cos(a), s = Math.sin(a);
    b.beam([c * 13.3, 337.4, s * 13.3], [c * 13.3, 342.2, s * 13.3], 0.22);
    b.beam([c * 13.0, 344.4, s * 13.0], [c * 13.0, 350.4, s * 13.0], 0.22);
  }
  lathe(b, 0, 0, [[14.6, 352.6, P(0xdedcd6, Surf.Metal)], [14.6, 353.1], [12.0, 353.1]], 24, 30);
  b.paint(0xb9bcc0, Surf.Metal).ring(0, 354.2, 0, 14.4, 0.1, 24);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    b.beam([Math.cos(a) * 12.2, 351.3, Math.sin(a) * 12.2], [Math.cos(a) * 14.3, 352.7, Math.sin(a) * 14.3], 0.3);
  }
  // antenna dishes on the upper shaft
  b.paint(0xf1f1ee, Surf.Metal);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4;
    b.push().translate(Math.cos(a) * 3.9, 372, Math.sin(a) * 3.9).rotateY(-a).rotateZ(-Math.PI / 2);
    lathe(b, 0, 0, [[0.2, 0], [2.3, 0.7], [2.45, 0.95], [0, 0.35]], 10);
    b.pop();
  }
  for (let i = 0; i < 5; i++) person(b, rng, rng.range(-12, 12), rng.range(11, 15), 0.1, rng.range(0, TAU));
  for (const [x, z] of [[-11, 13], [11, 13], [0, -14.5]] as P2[]) lamp(b, x, z, 4.5, 2, [{ color: 0xc6c1b6, y: 0.1, dy: 0.03 }]);
}

// ================================================================================================ TWIN SPIRES
function notchedSquare(cx: number, cz: number, h: number, n: number): P2[] {
  return [
    [h, -h + n], [h, h - n], [h - n, h - n], [h - n, h], [-h + n, h], [-h + n, h - n], [-h, h - n], [-h, -h + n], [-h + n, -h + n], [-h + n, -h], [h - n, -h], [h - n, -h + n],
  ].map(([x, z]) => [cx + x, cz + z] as P2);
}

/** Chamfered square plan (8 sides: 4 main faces + 4 diagonal chamfers of cut length c). */
function chamferSquare(cx: number, cz: number, h: number, c: number): P2[] {
  return [[h, -h + c], [h, h - c], [h - c, h], [-h + c, h], [-h, h - c], [-h, -h + c], [-h + c, -h], [h - c, -h]].map(([x, z]) => [cx + x, cz + z] as P2);
}

function twinSpires(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 24;
  // plaza + podium (towers stand on the lot diagonal so they can be wide and still leave a 14 m skybridge gap)
  const plazaC = 0xc4bfb4;
  b.paint(plazaC, Surf.Pavement).slab(-E, -E, E, E, 0.1);
  b.paint(0xaba496, Surf.Pavement);
  for (let i = 0; i <= 5; i++) rect(b, 2 + i * 4 - 0.4, 14.5, 2 + i * 4 + 0.4, 23.6, 0.115);
  const podH = 12;
  b.paint(0x2c3a46, Surf.GlassPlain, 2).box(-22.5, 0.1, -22.5, 22.5, 4.6, 14);
  b.paint(0xbfb8aa, Surf.WallWindows, 2, 3.4).box(-23, 4.6, -23, 23, podH, 14.4, { top: P(0x8e948b, Surf.RoofFlat) });
  b.paint(0xcfcbc2, Surf.Metal).box(-23.2, podH, -23.2, 23.2, podH + 0.8, 14.6, { top: null });
  b.paint(0xcfcbc2, Surf.Metal).box(4, 4.2, 14, 20, 4.8, 18.5);
  // podium roof gardens (the free quadrants)
  b.paint(GRASS_LUSH, Surf.Foliage).slab(3, -21, 21, 2, 0.4, podH);
  b.paint(GRASS_LUSH, Surf.Foliage).slab(-21, -21, -3, -2, 0.4, podH);
  b.push().translate(0, podH + 0.4, 0);
  for (const [x, z] of [[8, -6], [16, -1], [-8, -16], [-16, -8]] as P2[]) tree(b, rng, x, z, 0.7, 'round');
  b.pop();
  // two towers: A front-left, B back-right
  const towers: P2[] = [[-12.5, 12.5], [12.5, -12.5]];
  const sections: [number, number, number, number][] = [
    [0.1, 110, 10.8, 3.6], [111.6, 200, 9.8, 4.3], [201.6, 262, 8.6, 2.9], [263.6, 300, 7.2, 2.4],
  ];
  const ribbon = P(0xb8bec4, Surf.WallWindows, 2, 3.9);
  const chamferGlass = P(0x8a98a6, Surf.GlassCurtain, 4, 3.9);
  const band = P(0xcfd2d5, Surf.Metal);
  for (const [tx, tz] of towers) {
    for (let si = 0; si < sections.length; si++) {
      const [y0, y1, h, c] = sections[si];
      const poly = chamferSquare(tx, tz, h, c);
      prismEdges(b, poly, y0, y1, (i) => (i % 2 === 0 ? ribbon : chamferGlass), P(0x8e948b, Surf.RoofFlat));
      // stainless fins at the 8 vertices + mid-face mullion fins
      b.paint(0xd2d6da, Surf.Metal);
      for (let k = 0; k < 8; k++) {
        const [px, pz] = poly[k];
        const ox = px - tx, oz = pz - tz, l = Math.hypot(ox, oz);
        b.beam([px + (ox / l) * 0.2, y0, pz + (oz / l) * 0.2], [px + (ox / l) * 0.2, y1, pz + (oz / l) * 0.2], 0.5);
      }
      for (const [nx, nz] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as P2[]) b.beam([tx + nx * (h + 0.15), y0, tz + nz * (h + 0.15)], [tx + nx * (h + 0.15), y1, tz + nz * (h + 0.15)], 0.35);
      // setback band + glowing ring
      prismEdges(b, chamferSquare(tx, tz, h + 0.4, c), y1, y1 + 1.2, () => band, band);
      if (si < sections.length - 1) {
        const nn = sections[si + 1];
        prismEdges(b, chamferSquare(tx, tz, nn[2] + 0.1, nn[3]), y1 + 1.2, y1 + 1.6, () => P(0xcfe8ff, Surf.Emissive), null);
      }
      // crown blades on the top section
      if (si === sections.length - 1) {
        b.paint(0xdfe2e4, Surf.Metal);
        for (let k = 0; k < 8; k++) {
          const [px, pz] = poly[k];
          b.beam([px, y1, pz], [tx + (px - tx) * 0.5, y1 + 16, tz + (pz - tz) * 0.5], 0.45);
        }
      }
    }
    // crown: stacked octagonal rings with light gaps, pinnacle and spire
    const crown: ProfPt[] = [
      [6.6, 301.2, P(0xcfd2d5, Surf.Metal)], [6.6, 305, P(0xcfe8ff, Surf.Emissive)], [6.0, 305.8, P(0xcfd2d5, Surf.Metal)], [5.4, 310.5, P(0xcfe8ff, Surf.Emissive)],
      [4.8, 311.3, P(0xcfd2d5, Surf.Metal)], [4.0, 316, P(0xcfe8ff, Surf.Emissive)], [3.5, 316.8, P(0xcfd2d5, Surf.Metal)], [2.2, 324], [1.2, 334], [0.8, 334.5],
      [0.55, 356, P(0xd8dadc, Surf.Metal)], [0.2, 366], [0, 366.5],
    ];
    lathe(b, tx, tz, crown, 8, 25, Math.PI / 8, Math.PI / 8 + TAU);
    beacon(b, tx, 366.3, tz, 0.4);
    beacon(b, tx, 345, tz + 0.6, 0.35);
  }
  // skybridge between the facing chamfers (14 m), double deck, with V legs down to the towers
  const by0 = 168;
  b.push().rotateY(Math.PI / 4);
  const L = 7.4, W = 2.9;
  b.paint(0xdfe2e4, Surf.Metal).box(-L, by0 - 0.9, -W - 0.3, L, by0, W + 0.3);
  b.paint(0x33414e, Surf.GlassPlain, 2).box(-L, by0, -W, L, by0 + 3.6, W, { top: null, bottom: null });
  b.paint(0xdfe2e4, Surf.Metal).box(-L, by0 + 3.6, -W - 0.3, L, by0 + 4.4, W + 0.3, { bottom: null });
  b.paint(0x33414e, Surf.GlassPlain, 2).box(-L, by0 + 4.4, -W, L, by0 + 8.0, W, { top: null, bottom: null });
  b.paint(0xdfe2e4, Surf.Metal).box(-L, by0 + 8.0, -W - 0.3, L, by0 + 8.8, W + 0.3, { bottom: null });
  b.paint(0xcfe8ff, Surf.Emissive).box(-L, by0 - 0.9, W + 0.3, L, by0 - 0.5, W + 0.35, { top: null, bottom: null, nx: null, px: null, nz: null });
  b.paint(0xcfe8ff, Surf.Emissive).box(-L, by0 - 0.9, -W - 0.35, L, by0 - 0.5, -W - 0.3, { top: null, bottom: null, nx: null, px: null, pz: null });
  b.paint(0xdfe2e4, Surf.Metal);
  for (const s of [-1, 1]) for (const zz of [-W + 0.6, W - 0.6]) b.beam([s * 1.2, by0 - 0.9, zz], [s * 6.9, by0 - 38, zz], 1.0);
  b.box(-1.8, by0 - 2.8, -W, 1.8, by0 - 0.9, W);
  b.pop();
  // plaza dressing (front-right quadrant)
  fountain(b, 12, 19.5, 2.8, 1, { seg: 16, y: 0.1 });
  tree(b, rng, 21.5, 20.5, 0.9, 'round');
  tree(b, rng, 4, 21.5, 0.8, 'round');
  for (const x of [15.5, 18.5, 21.5]) {
    b.paint(0xcfcfcf, Surf.Metal).cylinder(x, 15.5, 0.1, 10, 0.1, 0.06, 5);
    b.paint([0xc0392b, 0x2e6fb5, 0xf1c40f][Math.round((x - 15.5) / 3)], Surf.Plain).quad2([x, 9.9, 15.5], [x - 2.2, 9.9, 15.5], [x - 2.2, 8.5, 15.5], [x, 8.5, 15.5]);
  }
  for (const [x, z] of [[6, 16], [20, 23], [6, 23]] as P2[]) lamp(b, x, z, 5.5, 2, [{ color: plazaC, y: 0.1, dy: 0.03 }]);
  for (let i = 0; i < 6; i++) person(b, rng, rng.range(3, 21), rng.range(15, 23), 0.1, rng.range(0, TAU));
}

// ================================================================================================ CLOCK TOWER
/** Clock dial on the local +Z face (call inside a transform where the face is the XY plane at z=0). */
function clockFace(b: ModelBuilder, r: number, hour: number, minute: number): void {
  const circle = (rr: number, n: number): P2[] => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * TAU) * rr, Math.sin((i / n) * TAU) * rr] as P2);
  b.paint(0xb8913a, Surf.Metal);
  polyZ(b, [[-r - 0.55, -r - 0.55], [r + 0.55, -r - 0.55], [r + 0.55, r + 0.55], [-r - 0.55, r + 0.55]], 0.02, 1, [circle(r + 0.05, 24)]);
  b.box(-r - 0.55, -r - 0.55, -0.1, r + 0.55, -r - 0.35, 0.12, { bottom: null });
  b.paint(0xf5ecd2, Surf.Emissive);
  polyZ(b, circle(r + 0.06, 24), 0.0, 1);
  b.paint(0x2b2622, Surf.Plain);
  polyZ(b, circle(r + 0.06, 24), 0.04, 1, [circle(r - 0.18, 24)]);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const c = Math.cos(a), s = Math.sin(a);
    const w = i % 3 === 0 ? 0.16 : 0.08;
    polyZ(b, [[c * (r - 0.3) - s * w, s * (r - 0.3) + c * w], [c * (r - 0.75) - s * w, s * (r - 0.75) + c * w], [c * (r - 0.75) + s * w, s * (r - 0.75) - c * w], [c * (r - 0.3) + s * w, s * (r - 0.3) - c * w]], 0.05, 1);
  }
  const hand = (ang: number, len: number, w: number, z: number) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    polyZ(b, [[-s * w - c * 0.3, c * w - s * 0.3], [c * len - s * w * 0.4, s * len + c * w * 0.4], [c * len + s * w * 0.4, s * len - c * w * 0.4], [s * w - c * 0.3, -c * w - s * 0.3]], z, 1);
  };
  hand(Math.PI / 2 - (hour / 12) * TAU - (minute / 60) * (TAU / 12), r * 0.52, 0.16, 0.08);
  hand(Math.PI / 2 - (minute / 60) * TAU, r * 0.82, 0.1, 0.1);
  b.paint(0xb8913a, Surf.Metal).box(-0.14, -0.14, 0.05, 0.14, 0.14, 0.16);
}

function clockTower(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 8;
  b.paint(0xc4bca9, Surf.Pavement).slab(-E, -E, E, E, 0.1);
  b.paint(0xaba28e, Surf.Pavement);
  for (const r of [5.6, 6.6]) {
    rect(b, -r, -r, r, -r + 0.3, 0.115); rect(b, -r, r - 0.3, r, r, 0.115); rect(b, -r, -r + 0.3, -r + 0.3, r - 0.3, 0.115); rect(b, r - 0.3, -r + 0.3, r, r - 0.3, 0.115);
  }
  const stone = 0xd4c39c, stoneL = 0xe2d4b3, stoneD = 0xb3a07c;
  // plinth + steps
  b.paint(stoneD, Surf.Stone).box(-4.9, 0.1, -4.9, 4.9, 2.4, 4.9);
  b.paint(stoneD, Surf.Stone).box(-2.4, 0.1, 4.9, 2.4, 0.9, 5.9).box(-2.4, 0.1, 5.9, 2.4, 0.5, 6.7);
  openingZ(b, gothicArch(0, 1.8, 2.4 + 1.6, 4, 2.4), 3.8, 1, 0x3a2a1e);
  // shaft: floodlit stone with vertical panel strips and dark lancet slits, corner pilasters, string courses
  const H0 = 2.4, H1 = 50;
  b.paint(stone, Surf.Stone, 1, 50).box(-3.8, H0, -3.8, 3.8, H1, 3.8, { top: null });
  for (let k = 0; k < 4; k++) {
    b.push().rotateY((k * Math.PI) / 2);
    b.paint(stoneL, Surf.Stone, 1, 50);
    for (let i = -2; i <= 2; i++) b.box(i * 1.25 - 0.175, H0 + 0.6, 3.8, i * 1.25 + 0.175, H1, 3.92, { bottom: null, nz: null });
    for (let y = H0 + 3.6; y < H1 - 2; y += 6) {
      for (const x of [-0.625, 0.625]) openingZ(b, gothicArch(x, 0.5, y + 1.6, 3, y), 3.8, 1, 0x241e19);
    }
    b.pop();
  }
  b.paint(stoneL, Surf.Stone);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(sx * 3.35 - 0.5, H0, sz * 3.35 - 0.5, sx * 3.35 + 0.5, H1 + 0.6, sz * 3.35 + 0.5, { top: null });
  for (const yb of [14, 26, 38]) b.paint(stoneL, Surf.Stone).box(-4.0, yb, -4.0, 4.0, yb + 0.55, 4.0);
  b.paint(stoneL, Surf.Stone).box(-4.35, H1, -4.35, 4.35, H1 + 1.0, 4.35);
  // clock stage (gilded bands at its base and top)
  const C0 = H1 + 1.0, C1 = C0 + 9.2;
  b.paint(0xd4af37, Surf.Metal).box(-4.2, C0, -4.2, 4.2, C0 + 0.35, 4.2, { bottom: null }).box(-4.25, C1 - 0.35, -4.25, 4.25, C1, 4.25, { bottom: null });
  b.paint(stone, Surf.Stone).box(-4.1, C0, -4.1, 4.1, C1, 4.1, { top: null });
  b.paint(stoneL, Surf.Stone);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(sx * 3.75 - 0.5, C0, sz * 3.75 - 0.5, sx * 3.75 + 0.5, C1, sz * 3.75 + 0.5, { top: null });
  for (let k = 0; k < 4; k++) {
    b.push().rotateY((k * Math.PI) / 2).translate(0, C0 + 4.6, 4.11);
    clockFace(b, 3.0, 10, 9);
    b.pop();
  }
  b.paint(stoneL, Surf.Stone).box(-4.4, C1, -4.4, 4.4, C1 + 0.8, 4.4);
  // belfry with arched openings + corner pinnacles
  const B0 = C1 + 0.8, B1 = B0 + 6.6;
  b.paint(stone, Surf.Stone).box(-3.7, B0, -3.7, 3.7, B1, 3.7, { top: null });
  for (let k = 0; k < 4; k++) {
    b.push().rotateY((k * Math.PI) / 2);
    for (const x of [-1.5, 1.5]) openingZ(b, gothicArch(x, 1.7, B0 + 4.2, 4, B0 + 0.8), 3.7, 1, 0x4a3218, Surf.Emissive);
    b.pop();
  }
  b.paint(stoneL, Surf.Stone).box(-4.0, B1, -4.0, 4.0, B1 + 0.7, 4.0);
  b.paint(stoneL, Surf.Stone);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    b.box(sx * 3.6 - 0.35, B1 + 0.7, sz * 3.6 - 0.35, sx * 3.6 + 0.35, B1 + 2.0, sz * 3.6 + 0.35, { top: null });
    b.pyramid(sx * 3.6, sz * 3.6, 0.8, 0.8, B1 + 2.0, 2.6);
  }
  // steep slate roof with dormers, iron lantern spire, gilded finial
  const R0 = B1 + 0.7;
  b.paint(0x3c4855, Surf.RoofTiles).pyramid(0, 0, 7.4, 7.4, R0, 13.5);
  for (let k = 0; k < 4; k++) {
    b.push().rotateY((k * Math.PI) / 2);
    b.paint(stoneL, Surf.Stone).box(-0.7, R0 + 2.2, 2.2, 0.7, R0 + 4.4, 3.4, { top: null });
    b.paint(0x3c4855, Surf.RoofTiles).gableRoof(0, 2.8, 1.4, 1.2, R0 + 4.4, 1.0, 'z', 0.15);
    b.paint(0xd4af37, Surf.Metal).cylinder(0, 2.8, R0 + 5.35, 0.5, 0.06, 0.02, 4);
    openingZ(b, roundArch(0, 0.8, R0 + 3.6, 4, R0 + 2.6), 3.4, 1, 0x4a3218, Surf.Emissive);
    b.pop();
  }
  const S0 = R0 + 13.5;
  b.paint(0x2c3035, Surf.Metal).cylinder(0, 0, S0 - 1.5, 5.5, 0.35, 0.12, 6);
  b.paint(0xd4af37, Surf.Metal).blob(0, S0 + 2.2, 0, 0.4, 0.4, 0.4, 0, 0, 1);
  b.paint(0xd4af37, Surf.Metal).cylinder(0, 0, S0 + 4, 1.4, 0.06, 0.02, 4);
  // dressing
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    lamp(b, sx * 7.0, sz * 7.0, 3.8, 0, [{ color: 0xc4bca9, y: 0.1, dy: 0.03 }]);
    if (sz < 0) tree(b, rng, sx * 6.3, -6.3, 0.55, 'round');
  }
  flowerBed(b, rng, -4.8, 5.4, -2.9, 7.3, { spacing: 0.7 });
  flowerBed(b, rng, 2.9, 5.4, 4.8, 7.3, { spacing: 0.7 });
  parkBench(b, -6.6, 1.2, Math.PI / 2);
  parkBench(b, 6.6, 1.2, -Math.PI / 2);
  person(b, rng, -1.5, 7.3, 0.1, 0.4);
  person(b, rng, 5.5, -1.5, 0.1, 2.0);
}

// ================================================================================================ LIGHTHOUSE
function lighthouse(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 8;
  // waterfront headland: +Z faces the water (wet sand + rocks), cottage and access path at -Z
  b.paint(0xcdbd98, Surf.Pavement).slab(-E, -E, E, E, 0.06);
  b.paint(0x9a8a6c, Surf.Pavement);
  flatPoly(b, [[-E, 4.6], [E, 3.8], [E, E], [-E, E]], 0.075);
  b.paint(0x7d9a52, Surf.Foliage);
  flatPoly(b, blobPoly(rng, -1.0, -2.2, 6.6, 5.4, 14, 0.2).map(([x, z]) => [Math.max(-7.9, Math.min(7.9, x)), Math.max(-7.9, Math.min(3.2, z))] as P2), 0.09);
  const rockC = [0x8d8a84, 0x7b7872, 0x9a968e];
  const rocks: [number, number, number][] = [[6.2, 6.4, 1.5], [3.2, 7.0, 1.2], [-1.2, 7.1, 1.0], [-4.6, 6.6, 1.4], [-6.9, 5.2, 1.1], [6.8, 3.2, 1.0], [0.9, 6.0, 0.7], [-6.8, 0.8, 0.9]];
  rocks.forEach(([x, z, r], i) => b.paint(rockC[i % 3], Surf.Stone).blob(x, r * 0.35, z, r, r * 0.7, r * 0.9, 0, 0.25, x + z));
  // keeper's cottage (back-left) + path from the rear edge
  const hx = -4.3, hz = -4.8;
  b.paint(0xdad6cc, Surf.WallWindows, 0, 3.0).box(hx - 2.6, 0.1, hz - 2.0, hx + 2.6, 3.0, hz + 2.0);
  b.paint(0xa4442e, Surf.RoofTiles).gableRoof(hx, hz, 5.2, 4.0, 3.0, 1.8, 'x', 0.35, { color: 0xdad6cc, surf: Surf.Plain });
  b.paint(0x8d8a84, Surf.Brick).box(hx + 1.3, 3.4, hz - 0.6, hx + 1.9, 5.4, hz);
  b.paint(0x2e4a6a, Surf.Plain).box(hx - 0.5, 0.1, hz + 2.0, hx + 0.5, 2.1, hz + 2.05);
  const pth = path(b, [[1.6, -8], [1.4, -5.5], [1.2, -2.6]], 1.1, 0xb8ab8e, 0.12);
  // tower: octagonal plinth + banded tapered shaft
  const tx = 1.2, tz = 0.4;
  b.paint(0x9a958b, Surf.Stone).prism(tx, tz, 3.7, 8, 0.1, 1.5, Math.PI / 8);
  // soft warm uplight from the plinth (fades 70% over the first 10 m) so the striped tower still reads at night
  const red = P(0xb8362a, Surf.Plain, 1, 10), white = P(0xdad7cf, Surf.Plain, 1, 10);
  const y0 = 1.5, y1 = 25.2;
  const prof: ProfPt[] = [];
  const nb = 6;
  for (let i = 0; i <= nb; i++) {
    const y = y0 + ((y1 - y0) * i) / nb;
    const r = 3.0 - (0.95 * i) / nb;
    prof.push([r, y, i % 2 ? red : white]);
  }
  prof.push([2.05, y1 + 0.01, P(0x2b2d31, Surf.Metal)], [3.05, y1 + 0.3], [3.05, y1 + 0.75], [1.9, y1 + 0.75, P(0xb03026, Surf.Metal)]);
  lathe(b, tx, tz, prof, 16, 30);
  // door (landward) + small windows
  b.paint(0x2e4a6a, Surf.Plain).box(tx - 0.5, 1.5, tz - 3.05, tx + 0.5, 3.4, tz - 2.9);
  b.paint(0x1d2630, Surf.GlassPlain);
  for (const [y, a] of [[7.5, -1.2], [12.5, 0.4], [17.5, -1.0], [21.8, 0.6]] as P2[]) {
    const r = 3.0 - (0.95 * (y - y0)) / (y1 - y0) + 0.02;
    b.push().translate(tx + Math.cos(a) * r, y, tz + Math.sin(a) * r).rotateY(Math.PI / 2 - a);
    b.box(-0.35, 0, -0.08, 0.35, 1.0, 0.08);
    b.pop();
  }
  // gallery railing
  b.paint(0x2b2d31, Surf.Metal);
  b.ring(tx, y1 + 1.8, tz, 2.95, 0.07, 16);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    b.box(tx + Math.cos(a) * 2.95 - 0.04, y1 + 0.75, tz + Math.sin(a) * 2.95 - 0.04, tx + Math.cos(a) * 2.95 + 0.04, y1 + 1.8, tz + Math.sin(a) * 2.95 + 0.04, { top: null, bottom: null });
  }
  // lantern room: red base, full-height lit glazing (warm white, 2x night-only glow: the signature light at night,
  // plain pale glass by day) between dark astragals
  const L0 = y1 + 0.75;
  b.paint(0xb03026, Surf.Metal).cylinder(tx, tz, L0, 1.0, 1.9, 1.9, 12);
  b.paint(0xfff1c8, Surf.Emissive, 11);
  const RL = 1.55;
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * TAU, a1 = ((i + 1) / 8) * TAU;
    const p0: V3 = [tx + Math.cos(a0) * RL, L0 + 1.0, tz + Math.sin(a0) * RL], p1: V3 = [tx + Math.cos(a1) * RL, L0 + 1.0, tz + Math.sin(a1) * RL];
    b.quad2(p0, p1, [p1[0], L0 + 3.6, p1[2]], [p0[0], L0 + 3.6, p0[2]]);
  }
  b.paint(0x1f2226, Surf.Metal);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    b.beam([tx + Math.cos(a) * 1.6, L0 + 1.0, tz + Math.sin(a) * 1.6], [tx + Math.cos(a) * 1.6, L0 + 3.6, tz + Math.sin(a) * 1.6], 0.1);
  }
  b.paint(0x1f2226, Surf.Metal).ring(tx, L0 + 1.6, tz, 1.6, 0.08, 12);
  b.ring(tx, L0 + 3.1, tz, 1.6, 0.08, 12);
  b.paint(0xb03026, Surf.Metal);
  lathe(b, tx, tz, [[2.05, L0 + 3.6], [1.85, L0 + 4.4], [1.2, L0 + 5.2], [0.45, L0 + 5.7], [0, L0 + 5.8]], 12);
  b.paint(0x1f2226, Surf.Metal).blob(tx, L0 + 6.1, tz, 0.35, 0.35, 0.35, 0, 0, 1);
  b.cylinder(tx, tz, L0 + 6.3, 1.8, 0.05, 0.02, 4);
  // dressing
  parkBench(b, 5.0, -2.6, -Math.PI / 2 - 0.4);
  lamp(b, 2.6, -5.8, 3.4, 0, [{ color: 0x7d9a52, y: 0.09, dy: 0.02 }, { color: 0xb8ab8e, y: 0.12, clip: ribbonQuads(pth, 1.1) }]);
  shrub(b, rng, -1.4, -6.6, 0.8);
  shrub(b, rng, -6.8, -1.6, 0.7);
  person(b, rng, 3.8, 3.6, 0.1, 0.4);
}

// ================================================================================================ OBELISK
function obelisk(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 8;
  const marble = 0xe2dccd, stoneD = 0xbab19e;
  const paveC = 0xcbc5b9;
  b.paint(paveC, Surf.Pavement).slab(-E, -E, E, E, 0.1);
  const oz = -2.2;
  // grass verges with low clipped hedges along the sides
  for (const s of [-1, 1]) {
    b.paint(GRASS_LUSH, Surf.Foliage).box(s * 7.9, 0.1, -7.9, s * 7.3, 0.2, 7.9);
  }
  // stepped plinth with an inscription die and bronze plaques
  b.paint(stoneD, Surf.Stone, 1, 70).box(-4.9, 0.1, oz - 4.9, 4.9, 0.55, oz + 4.9);
  b.paint(stoneD, Surf.Stone, 1, 70).box(-4.35, 0.55, oz - 4.35, 4.35, 1.0, oz + 4.35);
  b.paint(0xcfc7b4, Surf.Stone, 1, 70).box(-3.85, 1.0, oz - 3.85, 3.85, 1.45, oz + 3.85);
  b.paint(marble, Surf.Stone, 1, 70).box(-3.5, 1.45, oz - 3.5, 3.5, 3.0, oz + 3.5);
  b.paint(stoneD, Surf.Stone).box(-3.65, 2.8, oz - 3.65, 3.65, 3.15, oz + 3.65);
  for (let k = 0; k < 4; k++) {
    b.push().translate(0, 0, oz).rotateY((k * Math.PI) / 2);
    b.paint(0x6a5a3a, Surf.Metal, 3).box(-1.6, 1.7, 3.5, 1.6, 2.6, 3.56, { bottom: null });
    b.pop();
  }
  // tapered shaft (floodlit marble) + pyramidion (square: 4 segments rotated 45 degrees)
  const hb = 3.0, ht = 1.95, yb = 3.15, yt = 64;
  const S2 = Math.SQRT2;
  lathe(b, 0, oz, [[hb * S2, yb, P(marble, Surf.Stone, 1, 70)], [ht * S2, yt, P(0xe6e1d4, Surf.Plain, 1, 70)], [0, yt + 6.2]], 4, 10, Math.PI / 4, Math.PI / 4 + TAU);
  b.paint(0xd4af37, Surf.Metal).pyramid(0, oz, 0.5, 0.5, yt + 5.7, 0.8);
  beacon(b, 0, yt + 6.4, oz, 0.35);
  // observation windows near the top (proud of the tapering face)
  b.paint(0x2a2e33, Surf.Plain);
  const hwAt = (y: number) => hb + ((ht - hb) * (y - yb)) / (yt - yb);
  for (let k = 0; k < 4; k++) {
    b.push().translate(0, 0, oz).rotateY((k * Math.PI) / 2);
    for (const x of [-0.5, 0.5]) b.box(x - 0.18, yt - 3.2, hwAt(yt - 2.4) - 0.02, x + 0.18, yt - 2.4, hwAt(yt - 3.2) + 0.1, { bottom: null });
    b.pop();
  }
  // edge light strips (arrises) — crisp silhouette at night
  b.paint(0xfff4dc, Surf.Emissive);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    b.beam([sx * (hb + 0.02), yb, oz + sz * (hb + 0.02)], [sx * (ht + 0.02), yt, oz + sz * (ht + 0.02)], 0.1);
  }
  // ring of 12 flagpoles around the plinth (ellipse to fit the 16 m lot)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + TAU / 24;
    const x = Math.cos(a) * 6.6, z = oz + Math.sin(a) * 5.45;
    b.paint(0xcfcfcf, Surf.Metal).cylinder(x, z, 0.1, 9, 0.07, 0.045, 4, { top: false });
    b.paint(0x2e5aa8, Surf.Plain).quad2([x, 8.9, z], [x + 1.25, 8.8, z], [x + 1.25, 7.95, z], [x, 7.95, z]);
  }
  // reflecting pool in front with coping and two low jets at the far end
  const z0 = 3.7, z1 = 7.6;
  b.paint(0xb2a996, Surf.Stone).box(-6.4, 0.1, z0, 6.4, 0.45, z1, { top: null });
  b.paint(0xb2a996, Surf.Stone);
  rect(b, -6.4, z0, 6.4, z0 + 0.35, 0.45); rect(b, -6.4, z1 - 0.35, 6.4, z1, 0.45); rect(b, -6.4, z0 + 0.35, -6.05, z1 - 0.35, 0.45); rect(b, 6.05, z0 + 0.35, 6.4, z1 - 0.35, 0.45);
  b.paint(0x2c5566, Surf.Water);
  rect(b, -6.05, z0 + 0.35, 6.05, z1 - 0.35, 0.38);
  b.paint(0xc4dde6, Surf.Emissive, 10);
  for (const x of [-4.8, 4.8]) b.cone(x, 6.7, 0.38, 1.1, 0.14, 5, true);
  // uplight fixtures at the plinth corners
  b.paint(0x2e3033, Surf.Metal);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(sx * 4.6 - 0.2, 0.55, oz + sz * 4.6 - 0.2, sx * 4.6 + 0.2, 0.8, oz + sz * 4.6 + 0.2);
  b.paint(0xfff4dc, Surf.Emissive);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(sx * 4.6 - 0.14, 0.8, oz + sz * 4.6 - 0.14, sx * 4.6 + 0.14, 0.86, oz + sz * 4.6 + 0.14, { bottom: null });
  for (const x of [-7.25, 7.25]) lamp(b, x, 5.6, 4.0, 1, [{ color: paveC, y: 0.1, dy: 0.02 }]);
  for (let i = 0; i < 3; i++) person(b, rng, rng.range(-5, 5), rng.range(3.1, 3.5), 0.1, rng.range(0, TAU));
  void planePoly; void disc; void cylWall; void ribbon; void PATH_PAVE; void flowerBed; void fountain; void annulus; void polyZ;
}

export const towerModels = {
  lm_spire_tower: spireTower,
  lm_twin_spires: twinSpires,
  lm_clock_tower: clockTower,
  lm_lighthouse: lighthouse,
  lm_obelisk: obelisk,
};
