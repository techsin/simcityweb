/**
 * Landmark towers: observation/TV tower, twin-spire megatower, clock tower, lighthouse, obelisk.
 * (park/landmark asset agent) Budget <= 8000 tris each.
 */
import { ModelBuilder, type Paint } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import {
  type P2, type V3, type ProfPt, lathe, tree, lamp, parkBench, flowerBed, shrub, fountain, disc, annulus, rect, ribbon, cylWall, flatPoly, blobPoly,
  path, person, GRASS_LUSH, PATH_PAVE,
} from './park_lib';
import { prismEdges, polyZ, gothicArch, roundArch, openingZ, beacon, planePoly } from './lm_lib';

const TAU = Math.PI * 2;
const P = (color: number, surf: Surf = Surf.Plain, pattern = 0, floor = 3.3): Paint => ({ color, surf, pattern, floor });

// ================================================================================================ OBSERVATION / TV TOWER
function spireTower(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 16;
  const concrete = P(0xdcd8cf, Surf.Plain);
  // plaza with three lawn wedges between the fins
  b.paint(0xcfcac0, Surf.Pavement).slab(-E, -E, E, E, 0.1);
  b.paint(0xb9b3a6, Surf.Pavement);
  annulus(b, 0, 0, 0.105, 9.2, 10.2, 30);
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
  lathe(b, 0, 0, [[9.0, 0.1, P(0x8fb0c4, Surf.GlassPlain)], [9.0, 6.4, P(0xe6e4de, Surf.Metal)], [9.5, 6.8], [9.5, 7.6, P(0xcfccc4, Surf.RoofFlat)], [5.8, 7.6]], 30, 30);
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
  for (const yb of [60, 118, 176, 234, 292]) {
    prof.push([rAt(yb), yb], [rAt(yb) + 0.35, yb + 0.6], [rAt(yb) + 0.35, yb + 1.8], [rAt(yb + 2.4), yb + 2.4]);
  }
  prof.push(
    [rAt(322), 322, P(0xc8c6c0, Surf.Metal)],
    [6.8, 328.5], [12.4, 336.4, P(0x7fa2c0, Surf.GlassCurtain, 5, 3.4)], [13.2, 337.4], [13.2, 342.2, P(0x9ee8ff, Surf.Emissive)],
    [13.8, 342.8], [13.8, 343.8, P(0xe8e8e4, Surf.Metal)], [12.9, 344.4, P(0x6f8fae, Surf.GlassCurtain, 5, 3.0)], [12.9, 350.4, P(0xf1f0ec, Surf.Metal)],
    [11.9, 351.4], [8.4, 355.2], [4.2, 357.6, concrete], [3.6, 398, P(0xe8e8e4, Surf.Metal)], [5.8, 400.6, P(0x6f8fae, Surf.GlassCurtain, 5, 2.6)],
    [5.8, 405.2, P(0x9ee8ff, Surf.Emissive)], [6.1, 405.6], [6.1, 406.3, P(0xe8e8e4, Surf.Metal)], [3.0, 409], [2.4, 409.5],
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
  for (const [x, z] of [[-11, 13], [11, 13], [0, -14.5]] as P2[]) lamp(b, x, z, 4.5, 2);
}

// ================================================================================================ TWIN SPIRES
function notchedSquare(cx: number, cz: number, h: number, n: number): P2[] {
  return [
    [h, -h + n], [h, h - n], [h - n, h - n], [h - n, h], [-h + n, h], [-h + n, h - n], [-h, h - n], [-h, -h + n], [-h + n, -h + n], [-h + n, -h], [h - n, -h], [h - n, -h + n],
  ].map(([x, z]) => [cx + x, cz + z] as P2);
}

function twinSpires(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 24;
  // plaza + podium
  b.paint(0xd2cdc2, Surf.Pavement).slab(-E, -E, E, E, 0.1);
  b.paint(0xb9b2a4, Surf.Pavement);
  for (let i = -5; i <= 5; i++) rect(b, i * 4 - 0.4, 12, i * 4 + 0.4, 23.6, 0.105);
  const podH = 15;
  b.paint(0x2c3a46, Surf.GlassPlain).box(-22.5, 0.1, -22.5, 22.5, 5, 12);
  b.paint(0xcfc8ba, Surf.WallWindows, 2, 3.4).box(-23, 5, -23, 23, podH, 12.5, { top: P(0x9aa097, Surf.RoofFlat) });
  b.paint(0xe9e5dc, Surf.Metal).box(-23.2, podH, -23.2, 23.2, podH + 0.8, 12.7, { top: null });
  // entrance canopy
  b.paint(0xe9e5dc, Surf.Metal).box(-8, 4.6, 12, 8, 5.2, 16.5);
  // podium roof gardens
  b.paint(GRASS_LUSH, Surf.Foliage).slab(-21, 2, 21, 11, 0.4, podH);
  b.push().translate(0, podH + 0.4, 0);
  for (const x of [-18, -6, 6, 18]) tree(b, rng, x, 8.5, 0.7, 'round');
  b.pop();
  // two towers
  const towers = [-13.2, 13.2];
  const tz = -5;
  const sections: [number, number, number, number][] = [
    [podH, 150, 8.2, 2.2], [151.6, 238, 7.4, 1.95], [239.6, 306, 6.5, 1.7], [307.6, 346, 5.5, 1.4],
  ];
  const glassA = P(0x8a98a6, Surf.GlassCurtain, 4, 3.9);
  const glassB = P(0x8aa9c8, Surf.GlassCurtain, 5, 3.9);
  const band = P(0xdfe2e4, Surf.Metal);
  for (const tx of towers) {
    for (let si = 0; si < sections.length; si++) {
      const [y0, y1, h, n] = sections[si];
      const poly = notchedSquare(tx, tz, h, n);
      prismEdges(b, poly, y0, y1, (i) => (i % 3 === 0 ? glassA : glassB), P(0x9aa097, Surf.RoofFlat));
      // corner fins
      b.paint(0xe6e8ea, Surf.Metal);
      for (const k of [0, 1, 3, 4, 6, 7, 9, 10]) {
        const [px, pz] = poly[k];
        const ox = px - tx, oz = pz - tz;
        const l = Math.hypot(ox, oz);
        b.beam([px + (ox / l) * 0.15, y0, pz + (oz / l) * 0.15], [px + (ox / l) * 0.15, y1, pz + (oz / l) * 0.15], 0.45);
      }
      // crown blades: the top section's corner fins continue up and lean in
      if (si === sections.length - 1) {
        b.paint(0xeef0f2, Surf.Metal);
        for (const k of [0, 1, 3, 4, 6, 7, 9, 10]) {
          const [px, pz] = poly[k];
          b.beam([px, y1, pz], [tx + (px - tx) * 0.55, y1 + 14, tz + (pz - tz) * 0.55], 0.4);
        }
      }
      // setback band + glowing ring
      const nb = notchedSquare(tx, tz, h + 0.35, n);
      prismEdges(b, nb, y1, y1 + 1.2, () => band, band);
      if (si < sections.length - 1) {
        const nn = sections[si + 1];
        prismEdges(b, notchedSquare(tx, tz, nn[2] + 0.1, nn[3]), y1 + 1.2, y1 + 1.6, () => P(0xcfe8ff, Surf.Emissive), null);
      }
    }
    // crown: stacked octagonal rings with light gaps, pinnacle and spire
    const crown: ProfPt[] = [
      [5.2, 347.2, P(0xdfe2e4, Surf.Metal)], [5.2, 351, P(0xcfe8ff, Surf.Emissive)], [4.8, 351.8, P(0xdfe2e4, Surf.Metal)], [4.4, 356.5, P(0xcfe8ff, Surf.Emissive)],
      [4.0, 357.3, P(0xdfe2e4, Surf.Metal)], [3.4, 362, P(0xcfe8ff, Surf.Emissive)], [3.0, 362.8, P(0xdfe2e4, Surf.Metal)], [1.9, 372], [1.1, 386], [0.7, 386.5],
      [0.55, 420, P(0xe8eaec, Surf.Metal)], [0.2, 436], [0, 436.5],
    ];
    lathe(b, tx, tz, crown, 8, 25, Math.PI / 8, Math.PI / 8 + TAU);
    beacon(b, tx, 436.3, tz, 0.4);
    beacon(b, tx, 400, tz + 0.6, 0.35);
  }
  // skybridge (double deck) with V legs
  const by0 = 168, zb0 = tz - 2.8, zb1 = tz + 2.8, bx = 5.4;
  b.paint(0xeef0f2, Surf.Metal).box(-bx, by0 - 0.8, zb0 - 0.3, bx, by0, zb1 + 0.3);
  b.paint(0x33414e, Surf.GlassPlain).box(-bx, by0, zb0, bx, by0 + 3.6, zb1, { top: null, bottom: null });
  b.paint(0xeef0f2, Surf.Metal).box(-bx, by0 + 3.6, zb0 - 0.3, bx, by0 + 4.4, zb1 + 0.3, { bottom: null });
  b.paint(0x33414e, Surf.GlassPlain).box(-bx, by0 + 4.4, zb0, bx, by0 + 8.0, zb1, { top: null, bottom: null });
  b.paint(0xeef0f2, Surf.Metal).box(-bx, by0 + 8.0, zb0 - 0.3, bx, by0 + 8.8, zb1 + 0.3, { bottom: null });
  b.paint(0xcfe8ff, Surf.Emissive).box(-bx, by0 - 0.8, zb1 + 0.3, bx, by0 - 0.4, zb1 + 0.35, { top: null, bottom: null, nx: null, px: null, nz: null });
  b.paint(0xeef0f2, Surf.Metal);
  for (const s of [-1, 1]) for (const zz of [zb0 + 0.5, zb1 - 0.5]) b.beam([s * 1.0, by0 - 0.8, zz], [s * 5.1, 128, zz], 0.9);
  b.box(-1.4, by0 - 2.4, zb0, 1.4, by0 - 0.8, zb1);
  // plaza dressing
  fountain(b, -12, 18.5, 3.0, 1, { seg: 16 });
  fountain(b, 12, 18.5, 3.0, 1, { seg: 16 });
  for (const x of [-21.5, 21.5]) tree(b, rng, x, 18.5, 1.0, 'round');
  for (const x of [-5, 0, 5]) {
    b.paint(0xdddddd, Surf.Metal).cylinder(x, 21.5, 0.1, 11, 0.1, 0.06, 5);
    b.paint([0xc0392b, 0x2e6fb5, 0xf1c40f][(x / 5 + 1) | 0], Surf.Plain).quad2([x, 10.9, 21.5], [x + 2.4, 10.9, 21.5], [x + 2.4, 9.4, 21.5], [x, 9.4, 21.5]);
  }
  for (const x of [-17, -7, 7, 17]) lamp(b, x, 14, 5.5, 2);
  for (let i = 0; i < 8; i++) person(b, rng, rng.range(-20, 20), rng.range(13, 23), 0.1, rng.range(0, TAU));
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
  b.paint(0xcac2b0, Surf.Pavement).slab(-E, -E, E, E, 0.1);
  b.paint(0xb3aa96, Surf.Pavement);
  for (const r of [5.6, 6.6]) {
    rect(b, -r, -r, r, -r + 0.3, 0.105); rect(b, -r, r - 0.3, r, r, 0.105); rect(b, -r, -r + 0.3, -r + 0.3, r - 0.3, 0.105); rect(b, r - 0.3, -r + 0.3, r, r - 0.3, 0.105);
  }
  const stone = 0xd4c39c, stoneL = 0xe2d4b3, stoneD = 0xb3a07c;
  // plinth + steps
  b.paint(stoneD, Surf.Stone).box(-4.9, 0.1, -4.9, 4.9, 2.4, 4.9);
  b.paint(stoneD, Surf.Stone).box(-2.4, 0.1, 4.9, 2.4, 0.9, 5.9).box(-2.4, 0.1, 5.9, 2.4, 0.5, 6.7);
  openingZ(b, gothicArch(0, 1.8, 2.4 + 1.6, 4, 2.4), 3.8, 1, 0x3a2a1e);
  // shaft with punched windows, corner pilasters, string courses
  const H0 = 2.4, H1 = 50;
  b.paint(stone, Surf.WallWindows, 1, 6.0).box(-3.8, H0, -3.8, 3.8, H1, 3.8, { top: null });
  b.paint(stoneL, Surf.Stone);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(sx * 3.35 - 0.5, H0, sz * 3.35 - 0.5, sx * 3.35 + 0.5, H1 + 0.6, sz * 3.35 + 0.5, { top: null });
  for (const yb of [14, 26, 38]) b.paint(stoneL, Surf.Stone).box(-4.0, yb, -4.0, 4.0, yb + 0.55, 4.0);
  b.paint(stoneL, Surf.Stone).box(-4.35, H1, -4.35, 4.35, H1 + 1.0, 4.35);
  // clock stage
  const C0 = H1 + 1.0, C1 = C0 + 9.2;
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
    openingZ(b, roundArch(0, 0.8, R0 + 3.6, 4, R0 + 2.6), 3.4, 1, 0x4a3218, Surf.Emissive);
    b.pop();
  }
  const S0 = R0 + 13.5;
  b.paint(0x2c3035, Surf.Metal).cylinder(0, 0, S0 - 1.5, 5.5, 0.35, 0.12, 6);
  b.paint(0xd4af37, Surf.Metal).blob(0, S0 + 2.2, 0, 0.4, 0.4, 0.4, 0, 0, 1);
  b.paint(0xd4af37, Surf.Metal).cylinder(0, 0, S0 + 4, 1.4, 0.06, 0.02, 4);
  // dressing
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    lamp(b, sx * 7.0, sz * 7.0, 3.8, 0);
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
  // rocky headland: grass, sand, rocks
  b.paint(0xd9c9a0, Surf.Pavement).slab(-E, -E, E, E, 0.06);
  b.paint(0x7d9a52, Surf.Foliage);
  flatPoly(b, blobPoly(rng, -1.5, -1.5, 6.4, 6.0, 14, 0.2), 0.1);
  const rockC = [0x8d8a84, 0x7b7872, 0x9a968e];
  const rocks: [number, number, number][] = [[6.2, 5.8, 1.5], [3.4, 6.6, 1.1], [-5.8, 6.4, 1.3], [6.6, -1.5, 1.2], [-6.8, 1.0, 1.0], [0.6, 6.9, 0.9], [6.5, 2.3, 0.9], [-6.2, -6.2, 1.3]];
  for (const [x, z, r] of rocks) b.paint(rockC[(x * 7 + z) & 1 ? 0 : 2], Surf.Stone).blob(x, r * 0.35, z, r, r * 0.7, r * 0.9, 0, 0.25, x + z);
  // keeper's cottage
  const hx = -4.3, hz = -4.2;
  b.paint(0xf2f0ea, Surf.WallWindows, 0, 3.0).box(hx - 2.6, 0.1, hz - 2.0, hx + 2.6, 3.0, hz + 2.0);
  b.paint(0xa4442e, Surf.RoofTiles).gableRoof(hx, hz, 5.2, 4.0, 3.0, 1.8, 'x', 0.35, { color: 0xf2f0ea, surf: Surf.Plain });
  b.paint(0x8d8a84, Surf.Brick).box(hx + 1.3, 3.4, hz - 0.6, hx + 1.9, 5.4, hz);
  b.paint(0x2e4a6a, Surf.Plain).box(hx - 0.5, 0.1, hz + 2.0, hx + 0.5, 2.1, hz + 2.05);
  // path
  path(b, [[2.5, 8], [1.9, 5.5], [1.6, 3.8]], 1.1, 0xc8bca0, 0.12);
  // tower: octagonal plinth + banded tapered shaft
  const tx = 1.6, tz = 0.8;
  b.paint(0x9a958b, Surf.Stone).prism(tx, tz, 3.7, 8, 0.1, 1.5, Math.PI / 8);
  const red = P(0xc0392b, Surf.Plain), white = P(0xf2f0ea, Surf.Plain);
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
  // door + small windows
  b.paint(0x2e4a6a, Surf.Plain).box(tx - 0.5, 1.5, tz + 2.9, tx + 0.5, 3.4, tz + 3.05);
  b.paint(0x1d2630, Surf.GlassPlain);
  for (const [y, a] of [[7.5, 1.2], [12.5, 0.4], [17.5, 1.0], [21.8, 0.6]] as P2[]) {
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
  // lantern room: red base, glowing lamp glass with astragals, dome, vent ball, rod
  const L0 = y1 + 0.75;
  b.paint(0xb03026, Surf.Metal).cylinder(tx, tz, L0, 1.0, 1.9, 1.9, 12);
  b.paint(0xfff1b8, Surf.Emissive).cylinder(tx, tz, L0 + 1.0, 2.6, 1.55, 1.55, 12, { top: false });
  b.paint(0x1f2226, Surf.Metal);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    b.beam([tx + Math.cos(a) * 1.6, L0 + 1.0, tz + Math.sin(a) * 1.6], [tx + Math.cos(a) * 1.6, L0 + 3.6, tz + Math.sin(a) * 1.6], 0.1);
  }
  b.paint(0x1f2226, Surf.Metal).ring(tx, L0 + 2.3, tz, 1.6, 0.08, 12);
  b.paint(0xb03026, Surf.Metal);
  lathe(b, tx, tz, [[2.05, L0 + 3.6], [1.85, L0 + 4.4], [1.2, L0 + 5.2], [0.45, L0 + 5.7], [0, L0 + 5.8]], 12);
  b.paint(0x1f2226, Surf.Metal).blob(tx, L0 + 6.1, tz, 0.35, 0.35, 0.35, 0, 0, 1);
  b.cylinder(tx, tz, L0 + 6.3, 1.8, 0.05, 0.02, 4);
  // dressing: bench, lamp-lit path, a gull-less sky
  parkBench(b, 5.2, 1.6, -Math.PI / 2 + 0.3);
  shrub(b, rng, -1.2, 4.8, 0.8);
  shrub(b, rng, -6.4, -2.4, 0.7);
  person(b, rng, 3.4, 4.9, 0.1, 2.6);
}

// ================================================================================================ OBELISK
function obelisk(b: ModelBuilder, _v: number, rng: RNG): void {
  const E = 8;
  const marble = 0xebe6da, stoneD = 0xc4bba8;
  b.paint(0xd6d0c4, Surf.Pavement).slab(-E, -E, E, E, 0.1);
  // paving pattern: radiating joints + a ring around the monument
  const oz = -2.4;
  b.paint(0xc5beb0, Surf.Pavement);
  annulus(b, 0, oz, 0.105, 5.45, 5.8, 24, Math.PI * 0.95, Math.PI * 2.05);
  // grass verges with low clipped hedges along the sides
  for (const s of [-1, 1]) {
    b.paint(GRASS_LUSH, Surf.Foliage).box(s * 7.9, 0.1, -7.9, s * 6.7, 0.2, 7.9);
    b.paint(0x3f6b2e, Surf.Foliage).box(s * 7.8, 0.2, -7.6, s * 7.2, 0.9, 2.6);
  }
  // stepped plinth with an inscription die and bronze plaques
  b.paint(stoneD, Surf.Stone).box(-5.3, 0.1, oz - 5.3, 5.3, 0.55, oz + 5.3);
  b.paint(stoneD, Surf.Stone).box(-4.75, 0.55, oz - 4.75, 4.75, 1.0, oz + 4.75);
  b.paint(0xd9d1bf, Surf.Stone).box(-4.2, 1.0, oz - 4.2, 4.2, 1.45, oz + 4.2);
  b.paint(marble, Surf.Stone).box(-3.8, 1.45, oz - 3.8, 3.8, 3.0, oz + 3.8);
  b.paint(stoneD, Surf.Stone).box(-3.95, 2.8, oz - 3.95, 3.95, 3.15, oz + 3.95);
  for (let k = 0; k < 4; k++) {
    b.push().translate(0, 0, oz).rotateY((k * Math.PI) / 2);
    b.paint(0x6a5a3a, Surf.Metal).box(-1.6, 1.7, 3.8, 1.6, 2.6, 3.86, { bottom: null });
    b.pop();
  }
  // tapered shaft + pyramidion (square: 4 segments rotated 45 degrees)
  const hb = 3.0, ht = 1.95, yb = 3.15, yt = 64;
  const S2 = Math.SQRT2;
  lathe(b, 0, oz, [[hb * S2, yb, P(marble, Surf.Stone)], [ht * S2, yt, P(0xf1ede4, Surf.Plain)], [0, yt + 6.2]], 4, 10, Math.PI / 4, Math.PI / 4 + TAU);
  b.paint(0xd4af37, Surf.Metal).pyramid(0, oz, 0.5, 0.5, yt + 5.7, 0.8);
  beacon(b, 0, yt + 6.4, oz, 0.35);
  // observation windows near the top (as in the classic monuments)
  b.paint(0x2a2e33, Surf.Plain);
  for (let k = 0; k < 4; k++) {
    b.push().translate(0, 0, oz).rotateY((k * Math.PI) / 2);
    for (const x of [-0.5, 0.5]) b.box(x - 0.18, yt - 3.2, ht + 0.02, x + 0.18, yt - 2.4, ht + 0.07, { bottom: null });
    b.pop();
  }
  // edge light strips (arrises) — crisp silhouette at night
  b.paint(0xfff4dc, Surf.Emissive);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    b.beam([sx * (hb + 0.02), yb, oz + sz * (hb + 0.02)], [sx * (ht + 0.02), yt, oz + sz * (ht + 0.02)], 0.1);
  }
  // uplight fixtures at the plinth corners
  b.paint(0x2e3033, Surf.Metal);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(sx * 4.95 - 0.2, 0.55, oz + sz * 4.95 - 0.2, sx * 4.95 + 0.2, 0.8, oz + sz * 4.95 + 0.2);
  b.paint(0xfff4dc, Surf.Emissive);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(sx * 4.95 - 0.14, 0.8, oz + sz * 4.95 - 0.14, sx * 4.95 + 0.14, 0.86, oz + sz * 4.95 + 0.14, { bottom: null });
  // reflecting pool in front with coping and two low jets at the far end
  const z0 = 3.5, z1 = 7.5;
  b.paint(0xbdb4a2, Surf.Stone).box(-6.4, 0.1, z0, 6.4, 0.45, z1, { top: null });
  b.paint(0xbdb4a2, Surf.Stone);
  rect(b, -6.4, z0, 6.4, z0 + 0.35, 0.45); rect(b, -6.4, z1 - 0.35, 6.4, z1, 0.45); rect(b, -6.4, z0 + 0.35, -6.05, z1 - 0.35, 0.45); rect(b, 6.05, z0 + 0.35, 6.4, z1 - 0.35, 0.45);
  b.paint(0x2c5566, Surf.Water);
  rect(b, -6.05, z0 + 0.35, 6.05, z1 - 0.35, 0.38);
  b.paint(0xd6ecf4, Surf.Water);
  for (const x of [-4.8, 4.8]) b.cone(x, 6.6, 0.38, 1.1, 0.14, 5, true);
  // flags, lamps, benches, visitors
  for (const [x, z] of [[-6.2, -7.4], [6.2, -7.4], [-6.2, 1.8], [6.2, 1.8]] as P2[]) {
    b.paint(0xdddddd, Surf.Metal).cylinder(x, z, 0.1, 9, 0.08, 0.05, 5);
    b.paint(0x2e5aa8, Surf.Plain).quad2([x, 8.9, z], [x + (x > 0 ? -1.8 : 1.8), 8.9, z], [x + (x > 0 ? -1.8 : 1.8), 7.7, z], [x, 7.7, z]);
  }
  for (const x of [-7.25, 7.25]) lamp(b, x, 5.5, 4.0, 1);
  parkBench(b, -6.4, -3.2, Math.PI / 2);
  parkBench(b, 6.4, -3.2, -Math.PI / 2);
  for (let i = 0; i < 3; i++) person(b, rng, rng.range(-5, 5), rng.range(2.4, 3.2), 0.1, rng.range(0, TAU));
  void planePoly; void disc; void cylWall; void ribbon; void PATH_PAVE;
}

export const towerModels = {
  lm_spire_tower: spireTower,
  lm_twin_spires: twinSpires,
  lm_clock_tower: clockTower,
  lm_lighthouse: lighthouse,
  lm_obelisk: obelisk,
};
