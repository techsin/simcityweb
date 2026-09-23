/**
 * Procedural models for the 'vehicle' group. Front faces +Z, centered at the origin, wheels touch y = 0
 * (ships/boats: waterline at y = 0). Budget <= 250 tris (cars ~140-165).
 *
 * Bodies are side-profile extrusions (veh_parts.profileSolid) with per-edge paints: glass windshields, dark trim
 * bumpers; greenhouses are narrower at the roof (tumblehome). Car glass uses a dark reflective Metal so it does not
 * glow at night; bus / train / plane windows use Surf.GlassPlain so passenger cabins are lit at night.
 * Headlights = warm Emissive quads at +Z, taillights = red Emissive quads at -Z.
 */
import type { ModelBuilders } from '../registry';
import type { ModelBuilder, Paint } from '../ModelBuilder';
import { Surf } from '../../core/types';
import { P, profileSolid, axle, lamp, headLamp, tailLamps, sideRect, sideQuad, topQuad, arch, CAR_PAINT, CAR_GLASS, TAIL, AMBER, TRIM, CHASSIS, TIRE, BEACON_RED, BEACON_BLUE, type PP } from './veh_parts';
import { limb, triOut, quadOut, polyOut, vnorm, type V3 } from './nat_geom';

const GLASS_LIT = P(0x2a3440, Surf.GlassPlain);
const GRILLE = P(0x1a1b1d, Surf.Metal);
const CHROME = P(0xc8ccd0, Surf.Metal);
const WHITE = 0xeeeeea;

/** car body paint: metallic flake (pattern 2) for silvers/greys/champagnes, solid paint (pattern 1) otherwise */
const METALLIC = new Set([0xb9bec4, 0x5d646b, 0xc9b995, 0xa6977a, 0x3a3e44]);
const carPaint = (c: number): Paint => P(c, Surf.Metal, METALLIC.has(c) ? 2 : 1);
/** solid painted body panels of trucks, buses, trains, planes */
const body1 = (c: number): Paint => P(c, Surf.Metal, 1);

// ------------------------------------------------------------------ passenger cars
interface CarShape {
  hw: number;
  r: number;
  zf: number;
  zr: number;
  body: PP[];
  green: PP[];
  /** headlight: x0,x1,y0,y1,z */
  head: [number, number, number, number, number];
  tail: [number, number, number, number, number];
  grille?: [number, number, number, number, number];
}

function sedanShape(): CarShape {
  const r = 0.33, zf = 1.42, zr = -1.4, s = 0.3;
  return {
    hw: 0.9, r, zf, zr,
    body: [
      { z: -2.28, y: s },
      ...arch(zr, r, s),
      ...arch(zf, r, s),
      { z: 2.28, y: s, p: P(TRIM) },
      { z: 2.36, y: 0.52 },
      { z: 2.33, y: 0.74 },
      { z: 2.18, y: 0.84 },
      { z: 1.15, y: 0.98 },
      { z: -1.3, y: 1.0 },
      { z: -2.2, y: 0.96 },
      { z: -2.34, y: 0.78 },
      { z: -2.36, y: 0.5, p: P(TRIM) },
    ],
    green: [
      { z: 1.15, y: 0.97, w: 0.95, p: CAR_GLASS },
      { z: 0.3, y: 1.43, w: 0.78 },
      { z: -0.8, y: 1.44, w: 0.78, p: CAR_GLASS },
      { z: -1.38, y: 0.99, w: 0.95, p: null },
    ],
    head: [0.5, 0.8, 0.64, 0.74, 2.36],
    tail: [0.42, 0.86, 0.74, 0.93, -2.37],
    grille: [-0.42, 0.42, 0.54, 0.7, 2.37],
  };
}
function hatchShape(): CarShape {
  const r = 0.31, zf = 1.28, zr = -1.22, s = 0.3;
  return {
    hw: 0.87, r, zf, zr,
    body: [
      { z: -1.98, y: s },
      ...arch(zr, r, s),
      ...arch(zf, r, s),
      { z: 1.98, y: s, p: P(TRIM) },
      { z: 2.04, y: 0.52 },
      { z: 2.0, y: 0.74 },
      { z: 1.84, y: 0.84 },
      { z: 0.98, y: 0.98 },
      { z: -1.9, y: 1.0 },
      { z: -2.02, y: 0.8 },
      { z: -2.04, y: 0.5, p: P(TRIM) },
    ],
    green: [
      { z: 0.98, y: 0.97, w: 0.95, p: CAR_GLASS },
      { z: 0.18, y: 1.46, w: 0.8 },
      { z: -1.62, y: 1.44, w: 0.8, p: CAR_GLASS },
      { z: -1.94, y: 0.99, w: 0.93, p: null },
    ],
    head: [0.45, 0.76, 0.64, 0.75, 2.03],
    tail: [0.5, 0.84, 0.78, 1.02, -2.04],
    grille: [-0.36, 0.36, 0.52, 0.66, 2.05],
  };
}
function suvShape(): CarShape {
  const r = 0.38, zf = 1.45, zr = -1.45, s = 0.44;
  return {
    hw: 0.95, r, zf, zr,
    body: [
      { z: -2.34, y: s },
      ...arch(zr, r, s),
      ...arch(zf, r, s),
      { z: 2.3, y: 0.42, p: P(TRIM) },
      { z: 2.4, y: 0.66 },
      { z: 2.38, y: 0.96 },
      { z: 2.2, y: 1.08 },
      { z: 1.25, y: 1.18 },
      { z: -2.28, y: 1.2 },
      { z: -2.4, y: 0.96 },
      { z: -2.42, y: 0.62, p: P(TRIM) },
    ],
    green: [
      { z: 1.25, y: 1.17, w: 0.95, p: CAR_GLASS },
      { z: 0.5, y: 1.78, w: 0.86 },
      { z: -2.18, y: 1.8, w: 0.86, p: CAR_GLASS },
      { z: -2.34, y: 1.2, w: 0.95, p: null },
    ],
    head: [0.52, 0.86, 0.86, 0.98, 2.4],
    tail: [0.62, 0.9, 1.0, 1.3, -2.42],
    grille: [-0.45, 0.45, 0.68, 0.94, 2.41],
  };
}

function drawCar(b: ModelBuilder, sh: CarShape, body: Paint) {
  profileSolid(b, sh.body, sh.hw, body);
  profileSolid(b, sh.green, sh.hw, body, { cap: CAR_GLASS });
  axle(b, sh.zf, sh.r, sh.hw - 0.08);
  axle(b, sh.zr, sh.r, sh.hw - 0.08);
  const [hx0, hx1, hy0, hy1, hz] = sh.head;
  headLamp(b, hx0, hx1, hy0, hy1, hz);
  const [tx0, tx1, ty0, ty1] = sh.tail;
  tailLamps(b, [sh.body, sh.green], sh.hw, tx0, tx1, ty0, ty1);
  if (sh.grille) {
    const [gx0, gx1, gy0, gy1, gz] = sh.grille;
    lamp(b, gx0, gx1, gy0, gy1, gz, 1, GRILLE, false);
  }
}

function sedan(b: ModelBuilder, color: number) {
  drawCar(b, sedanShape(), carPaint(color));
}

// ------------------------------------------------------------------ trucks / buses helpers
/** Cab-over / boxy cab profile. front z = zF, rear z = zB, floor y0, roof yR. windshield from yW0 to yW1. */
function boxCab(zB: number, zF: number, y0: number, yR: number, yW0: number, yW1: number, slope = 0.18, roundTop = 0.25): PP[] {
  return [
    { z: zB, y: y0 },
    { z: zF - 0.05, y: y0, p: P(TRIM) },
    { z: zF + 0.03, y: y0 + 0.35 },
    { z: zF, y: yW0, p: CAR_GLASS },
    { z: zF - slope, y: yW1 },
    { z: zF - slope - roundTop, y: yR },
    { z: zB, y: yR },
  ];
}

/** side windows of a cab (both sides). */
function cabWindows(b: ModelBuilder, x: number, z0: number, z1: number, y0: number, y1: number, slant = 0.15) {
  sideQuad(b, x, [[z0, y0], [z1, y0], [z1 - slant, y1], [z0, y1]], CAR_GLASS);
}

// ------------------------------------------------------------------ builders
export const models: ModelBuilders = {
  car_sedan(b, v) {
    sedan(b, [CAR_PAINT[0], CAR_PAINT[1], CAR_PAINT[2], CAR_PAINT[3], CAR_PAINT[4], CAR_PAINT[5]][v]);
  },

  car_hatch(b, v) {
    drawCar(b, hatchShape(), carPaint([0xc23b2e, CAR_PAINT[2], CAR_PAINT[8], CAR_PAINT[0], CAR_PAINT[6], 0xd6a332][v]));
  },

  car_suv(b, v) {
    const sh = suvShape();
    const col = [CAR_PAINT[1], CAR_PAINT[0], CAR_PAINT[5], CAR_PAINT[7], CAR_PAINT[4]][v];
    drawCar(b, sh, carPaint(col));
    // roof rails
    b.paint(TRIM, Surf.Metal);
    for (const s of [1, -1]) b.box(s * 0.66, 1.79, -1.95, s * 0.74, 1.87, 0.35, { nz: null, pz: null });
  },

  car_pickup(b, v) {
    const col = [0xa33126, CAR_PAINT[2], CAR_PAINT[4], CAR_PAINT[5]][v];
    const body = carPaint(col);
    const r = 0.38, zf = 1.75, zr = -1.6, s = 0.46, hw = 0.97;
    profileSolid(b, [
      { z: -2.64, y: s },
      ...arch(zr, r, s),
      ...arch(zf, r, s),
      { z: 2.6, y: 0.45, p: P(TRIM) },
      { z: 2.68, y: 0.7 },
      { z: 2.66, y: 1.0 },
      { z: 2.5, y: 1.12 },
      { z: 1.2, y: 1.2 },
      { z: -0.58, y: 1.2, p: P(0x2b2b2d) }, // bed floor (liner)
      { z: -2.62, y: 1.2 },
      { z: -2.68, y: 0.95 },
      { z: -2.7, y: 0.62, p: P(TRIM) },
    ], hw, body);
    profileSolid(b, [
      { z: 1.2, y: 1.19, w: 0.95, p: CAR_GLASS },
      { z: 0.42, y: 1.86, w: 0.86 },
      { z: -0.5, y: 1.87, w: 0.86, p: CAR_GLASS },
      { z: -0.58, y: 1.2, w: 0.95, p: null },
    ], hw, body, { cap: CAR_GLASS });
    // bed walls + tailgate
    b.paint(body);
    for (const sx of [1, -1]) b.box(sx * (hw - 0.09), 1.2, -2.6, sx * hw, 1.55, -0.62, { pz: null });
    b.box(-hw, 1.2, -2.7, hw, 1.55, -2.6, { nx: null, px: null });
    axle(b, zf, r, hw - 0.06);
    axle(b, zr, r, hw - 0.06);
    headLamp(b, 0.55, 0.9, 0.84, 0.98, 2.68);
    lamp(b, -0.5, 0.5, 0.6, 0.96, 2.69, 1, GRILLE, false);
    lamp(b, 0.72, 0.94, 1.0, 1.45, -2.71, -1, TAIL);
  },

  car_taxi(b) {
    const sh = sedanShape();
    drawCar(b, sh, P(0xf2b705, Surf.Metal, 1));
    // checker stripe + roof sign
    sideRect(b, sh.hw + 0.012, -1.25, 1.1, 0.8, 0.88, P(0x1b1b1b));
    b.paint(0x222222, Surf.Plain).box(-0.36, 1.43, -0.32, 0.36, 1.47, 0.08);
    b.paint(0xfff1b8, Surf.Emissive).box(-0.32, 1.47, -0.28, 0.32, 1.66, 0.04);
  },

  car_police(b) {
    const sh = sedanShape();
    drawCar(b, sh, carPaint(0x15171a));
    // white doors
    sideQuad(b, sh.hw + 0.012, [[-1.05, 0.42], [1.1, 0.42], [1.1, 0.95], [-1.05, 0.97]], P(0xf2f2ee, Surf.Metal, 1));
    sideRect(b, sh.hw + 0.02, -0.2, 0.6, 0.62, 0.72, P(0x1a3a8a));
    // light bar
    b.paint(0x222222, Surf.Metal).box(-0.62, 1.43, -0.18, 0.62, 1.49, 0.14);
    b.paint(BEACON_RED).box(-0.6, 1.49, -0.15, -0.04, 1.62, 0.11, {});
    b.paint(BEACON_BLUE).box(0.04, 1.49, -0.15, 0.6, 1.62, 0.11, {});
    // push bar
    b.paint(TRIM, Surf.Metal).box(-0.5, 0.35, 2.38, 0.5, 0.8, 2.46, { nz: null });
  },

  car_van(b, v) {
    const col = [WHITE, CAR_PAINT[0], 0x1f3558, 0xc6462a][v];
    const body = body1(col);
    const r = 0.36, zf = 1.95, zr = -1.75, s = 0.42, hw = 1.0;
    profileSolid(b, [
      { z: -2.78, y: s },
      ...arch(zr, r, s),
      ...arch(zf, r, s),
      { z: 2.72, y: 0.4, p: P(TRIM) },
      { z: 2.8, y: 0.62 },
      { z: 2.76, y: 0.95 },
      { z: 2.55, y: 1.1 },
      { z: 2.0, y: 1.26, p: CAR_GLASS },
      { z: 1.25, y: 2.3 },
      { z: 0.95, y: 2.45 },
      { z: -2.7, y: 2.45 },
      { z: -2.8, y: 2.3 },
      { z: -2.8, y: 0.7 },
      { z: -2.82, y: 0.45, p: P(TRIM) },
    ], hw, body);
    axle(b, zf, r, hw - 0.06);
    axle(b, zr, r, hw - 0.06);
    const x = hw + 0.012;
    cabWindows(b, x, 1.08, 1.92, 1.32, 2.1, 0.55);
    if (v === 1) {
      // passenger van: window band with pillars
      sideRect(b, x, -2.45, 0.85, 1.4, 2.1, CAR_GLASS);
      for (const z of [-1.3, -0.15]) sideRect(b, x + 0.008, z - 0.08, z + 0.08, 1.4, 2.1, body);
    } else if (v === 2) {
      sideRect(b, x, -2.6, 0.9, 1.05, 1.25, P(0xe0b030));
    } else if (v === 3) {
      sideRect(b, x, -2.6, 0.95, 0.75, 2.05, P(0xf2f0ea));
      sideRect(b, x + 0.008, -2.2, -0.3, 1.1, 1.7, P(0xc6462a));
    }
    headLamp(b, 0.55, 0.9, 0.86, 1.0, 2.79);
    lamp(b, -0.45, 0.45, 0.66, 0.92, 2.8, 1, GRILLE, false);
    lamp(b, 0.78, 0.95, 0.85, 1.45, -2.81, -1, TAIL);
  },

  bus(b, v) {
    const col = [0xf0f0ec, 0xb82a22][v];
    const accent = [0x1f5aa6, 0xe8e2d6][v];
    const body = body1(col);
    const r = 0.5, zf = 3.55, zr = -2.55, s = 0.36, hw = 1.27;
    profileSolid(b, [
      { z: -5.95, y: s },
      ...arch(zr, r, s),
      ...arch(zf, r, s),
      { z: 5.95, y: 0.34, p: P(TRIM) },
      { z: 6.02, y: 0.95 },
      { z: 6.02, y: 1.05, p: GLASS_LIT },
      { z: 5.95, y: 2.72 },
      { z: 5.82, y: 3.0 },
      { z: 5.55, y: 3.12, w: 0.97 },
      { z: -5.6, y: 3.12, w: 0.97 },
      { z: -5.9, y: 2.95 },
      { z: -6.0, y: 1.0 },
      { z: -6.02, y: 0.36, p: P(TRIM) },
    ], hw, body);
    axle(b, zf, r, hw - 0.1);
    axle(b, zr, r, hw - 0.1);
    const x = hw + 0.012;
    // livery skirt, window band, pillars, doors (doors on the curb side = -X)
    sideRect(b, x, -5.95, 5.98, 0.5, 1.08, body1(accent));
    sideRect(b, x, -5.4, 5.3, 1.22, 2.66, GLASS_LIT);
    for (const z of [-3.6, -1.6, 0.4, 2.4]) sideRect(b, x + 0.01, z - 0.1, z + 0.1, 1.22, 2.66, body);
    sideRect(b, x + 0.02, 4.45, 5.55, 0.42, 2.66, GLASS_LIT, -1);
    sideRect(b, x + 0.02, -0.55, 0.65, 0.42, 2.66, GLASS_LIT, -1);
    // route sign, lights
    lamp(b, -0.85, 0.85, 2.76, 2.98, 5.96, 1, AMBER, false);
    headLamp(b, 0.75, 1.1, 0.55, 0.8, 6.04);
    lamp(b, 0.95, 1.18, 0.55, 1.2, -6.04, -1, TAIL);
    lamp(b, -0.6, 0.6, 2.72, 2.9, -5.93, -1, AMBER, false);
    // roof AC pod
    b.paint(0xd8d8d4, Surf.Metal, 1).box(-0.85, 3.12, -2.2, 0.85, 3.28, 0.8);
  },

  truck_box(b, v) {
    const cab = body1([WHITE, 0xb52b22, WHITE, 0x1f3f7a][v]);
    const boxCol = [0xf2f0ea, 0xefeee8, 0x2c5f9e, 0xe9c23c][v];
    const hwC = 1.14, hw = 1.25, r = 0.46;
    profileSolid(b, boxCab(2.2, 4.0, 0.95, 2.95, 1.5, 2.72), hwC, cab);
    cabWindows(b, hwC + 0.012, 2.9, 3.78, 1.6, 2.45, 0.12);
    // cargo box, chassis, bumper
    b.paint(boxCol, v === 2 ? Surf.Corrugated : Surf.Plain).box(-hw, 1.05, -4.0, hw, 3.5, 2.12);
    b.paint(CHASSIS, Surf.Metal).box(-0.55, 0.55, -3.9, 0.55, 1.05, 2.25, { top: null });
    b.paint(TRIM, Surf.Metal).box(-1.1, 0.48, -4.08, 1.1, 0.72, -3.92, { nx: null, px: null });
    // livery band on the box
    if (v === 1) sideRect(b, hw + 0.012, -3.8, 1.9, 1.3, 1.7, P(0xb52b22));
    if (v === 0) sideRect(b, hw + 0.012, -3.2, 1.0, 1.9, 3.0, P(0x2e7d4f));
    if (v === 3) sideRect(b, hw + 0.012, -3.8, 1.9, 2.9, 3.2, P(0x1f3f7a));
    axle(b, 3.05, r, hwC - 0.05);
    axle(b, -2.35, r, hwC);
    headLamp(b, 0.62, 1.0, 1.02, 1.18, 4.04);
    lamp(b, -0.5, 0.5, 1.02, 1.3, 4.04, 1, GRILLE, false);
    lamp(b, 0.9, 1.15, 1.12, 1.4, -4.01, -1, TAIL);
  },

  truck_semi(b, v) {
    const cabCol = [0xa82620, WHITE, 0x1f3f7a][v];
    const cab = body1(cabCol);
    const hw = 1.25;
    // tractor chassis
    b.paint(CHASSIS, Surf.Metal).box(-0.55, 0.6, 0.8, 0.55, 1.12, 7.4, { top: null });
    if (v === 0) {
      // US conventional: long hood + sleeper with roof fairing
      profileSolid(b, [{ z: 5.5, y: 1.08 }, { z: 7.7, y: 1.08, p: P(TRIM) }, { z: 7.9, y: 1.3 }, { z: 7.9, y: 1.45 }, { z: 5.5, y: 1.45 }], hw, cab); // fenders
      profileSolid(b, [{ z: 5.5, y: 1.4 }, { z: 7.95, y: 1.4 }, { z: 8.02, y: 1.75 }, { z: 7.9, y: 2.15 }, { z: 5.5, y: 2.36 }], 0.92, cab);
      profileSolid(b, [{ z: 2.4, y: 1.1 }, { z: 5.55, y: 1.1 }, { z: 5.55, y: 2.36, p: CAR_GLASS }, { z: 4.85, y: 3.2 }, { z: 3.95, y: 3.28 }, { z: 3.35, y: 3.95 }, { z: 2.4, y: 3.95 }], hw, cab);
      cabWindows(b, hw + 0.012, 4.3, 5.35, 2.4, 3.05, 0.5);
      lamp(b, -0.62, 0.62, 1.45, 2.05, 8.03, 1, CHROME, false);
      headLamp(b, 0.66, 0.9, 1.5, 1.64, 7.97);
      // exhaust stacks + fuel tanks
      b.paint(CHROME);
      for (const s of [1, -1]) limb(b, [[s * 1.12, 1.3, 2.35], [s * 1.12, 4.05, 2.35]], [0.1, 0.09], { seg: 4 });
      b.paint(0xc0c4c8, Surf.Metal);
      for (const s of [1, -1]) b.box(s * 0.6, 0.62, 3.3, s * 1.18, 1.12, 4.8, { bottom: null, [s > 0 ? 'nx' : 'px']: null });
    } else {
      // EU cab-over, tall flat front
      profileSolid(b, boxCab(4.85, 8.05, 1.1, 3.85, 1.95, 3.15, 0.12, 0.35), hw, cab);
      cabWindows(b, hw + 0.012, 6.9, 7.9, 2.05, 3.0, 0.08);
      lamp(b, -0.8, 0.8, 1.5, 1.9, 8.1, 1, GRILLE, false);
      headLamp(b, 0.75, 1.12, 1.2, 1.36, 8.1);
      b.paint(0xc0c4c8, Surf.Metal);
      for (const s of [1, -1]) b.box(s * 0.6, 0.62, 3.4, s * 1.18, 1.12, 4.7, { bottom: null, [s > 0 ? 'nx' : 'px']: null });
      // roof deflector
      b.paint(cab).box(-1.1, 3.85, 5.0, 1.1, 4.0, 6.2);
    }
    // trailer
    if (v < 2) {
      const tcol = v === 0 ? 0xd4d7da : 0x2f5d95;
      b.paint(tcol, v === 0 ? Surf.Corrugated : Surf.Plain).box(-1.28, 1.3, -8.05, 1.28, 4.05, v === 0 ? 1.9 : 3.3);
      if (v === 1) sideRect(b, 1.292, -7.6, 2.8, 3.3, 3.8, P(0xf0c420));
      if (v === 0) sideRect(b, 1.292, -7.9, 1.7, 1.36, 1.46, P(0xc8322a)); // reflective stripe
    } else {
      b.paint(CHASSIS, Surf.Metal).box(-1.2, 1.1, -8.0, 1.2, 1.32, 3.1);
      b.paint(0xb84a2a, Surf.Corrugated).box(-1.22, 1.32, -7.6, 1.22, 3.92, 2.6, { px: { color: 0x8e3a22, surf: Surf.Corrugated }, nz: { color: 0x8e3a22, surf: Surf.Corrugated } });
    }
    b.paint(CHASSIS, Surf.Metal).box(-0.9, 0.95, -7.9, 0.9, 1.3, v === 0 ? 1.6 : 2.6, { top: null, pz: null });
    lamp(b, 0.9, 1.2, 1.4, 1.7, -8.07, -1, TAIL);
    const ax = (z: number, hwO: number) => axle(b, z, 0.52, hwO, { seg: 6, hub: null });
    ax(v === 0 ? 6.75 : 6.6, 1.12);
    ax(2.75, 1.2);
    ax(1.45, 1.2);
    ax(-5.6, 1.22);
    ax(-6.9, 1.22);
  },

  fire_truck(b) {
    const red = body1(0xb81d18);
    const hw = 1.25;
    profileSolid(b, boxCab(2.75, 5.05, 1.05, 2.98, 1.75, 2.75, 0.13, 0.22), hw, red);
    cabWindows(b, hw + 0.012, 3.0, 3.85, 1.85, 2.6, 0);
    cabWindows(b, hw + 0.012, 4.0, 4.85, 1.85, 2.6, 0.08);
    b.paint(red).box(-hw, 1.0, -5.0, hw, 2.9, 2.75);
    b.paint(CHASSIS, Surf.Metal).box(-0.6, 0.55, -4.9, 0.6, 1.05, 4.9, { top: null });
    // white stripe + roll-up compartment doors
    sideRect(b, hw + 0.012, -5.0, 5.05, 1.5, 1.66, P(0xf2f0ea));
    sideRect(b, hw + 0.02, -4.7, -2.95, 1.1, 2.75, P(0xb8bcc0, Surf.Corrugated));
    sideRect(b, hw + 0.02, -2.1, 2.45, 1.1, 2.75, P(0xb8bcc0, Surf.Corrugated));
    // light bar + rear beacons
    b.paint(BEACON_RED).box(-0.75, 2.98, 3.55, 0.75, 3.14, 3.85);
    lamp(b, 0.95, 1.2, 2.5, 2.8, -5.01, -1, BEACON_RED);
    // ladder: turntable, rails, rungs
    b.paint(0x9a9ea3, Surf.Metal).box(-0.65, 2.9, -4.3, 0.65, 3.22, -3.0);
    b.paint(0xd5d8dc, Surf.Metal);
    for (const s of [1, -1]) b.box(s * 0.38, 3.22, -4.8, s * 0.5, 3.42, 4.5, { nz: null, pz: null });
    for (let i = 0; i < 9; i++) topQuad(b, -0.38, -4.4 + i * 1.0, 0.38, -4.25 + i * 1.0, 3.38, P(0xd5d8dc, Surf.Metal));
    axle(b, 3.9, 0.5, hw - 0.05);
    axle(b, -2.7, 0.5, hw - 0.02);
    headLamp(b, 0.7, 1.05, 1.18, 1.34, 5.09);
    lamp(b, -0.55, 0.55, 1.15, 1.6, 5.09, 1, CHROME, false);
    lamp(b, 0.95, 1.2, 1.1, 1.4, -5.01, -1, TAIL);
  },

  ambulance(b) {
    const white = body1(0xf4f4f0);
    const r = 0.4, zf = 2.45;
    profileSolid(b, [
      { z: 1.2, y: 0.5 },
      ...arch(zf, r, 0.5),
      { z: 3.35, y: 0.48, p: P(TRIM) },
      { z: 3.42, y: 0.72 },
      { z: 3.4, y: 1.0 },
      { z: 3.2, y: 1.16 },
      { z: 2.62, y: 1.3, p: CAR_GLASS },
      { z: 1.92, y: 2.25 },
      { z: 1.7, y: 2.36 },
      { z: 1.2, y: 2.36 },
    ], 1.02, white);
    cabWindows(b, 1.032, 1.35, 2.35, 1.35, 2.08, 0.45);
    // patient module with rear wheel arch
    profileSolid(b, [{ z: -3.4, y: 0.62 }, ...arch(-2.0, r, 0.62), { z: 1.25, y: 0.62 }, { z: 1.25, y: 2.86 }, { z: -3.4, y: 2.86 }], 1.2, white);
    const x = 1.212;
    sideRect(b, x, -3.4, 1.25, 1.2, 1.42, P(0xc8201c));
    sideRect(b, 1.032, 1.25, 3.38, 0.9, 1.05, P(0xc8201c));
    sideRect(b, x + 0.008, -1.45, -0.75, 1.62, 2.62, P(0xc8201c));
    sideRect(b, x + 0.008, -1.6, -0.6, 1.95, 2.3, P(0xc8201c));
    topQuad(b, -0.18, -1.6, 0.18, -0.5, 2.87, P(0xc8201c));
    topQuad(b, -0.55, -1.23, 0.55, -0.87, 2.871, P(0xc8201c));
    // light bar + module corner lights
    b.paint(BEACON_RED).box(-0.6, 2.36, 1.45, -0.02, 2.5, 1.7);
    b.paint(BEACON_BLUE).box(0.02, 2.36, 1.45, 0.6, 2.5, 1.7);
    lamp(b, 0.85, 1.15, 2.6, 2.8, 1.26, 1, BEACON_RED);
    lamp(b, 0.85, 1.15, 2.6, 2.8, -3.41, -1, BEACON_RED);
    lamp(b, -0.5, 0.5, 1.3, 2.4, -3.405, -1, CAR_GLASS, false);
    axle(b, zf, r, 0.98);
    axle(b, -2.0, r, 1.1);
    headLamp(b, 0.55, 0.9, 0.86, 1.0, 3.43);
    lamp(b, -0.42, 0.42, 0.62, 0.92, 3.43, 1, GRILLE, false);
    lamp(b, 0.85, 1.12, 0.8, 1.2, -3.41, -1, TAIL);
  },

  garbage_truck(b) {
    const hw = 1.25;
    const cab = body1(0xf0f0ec);
    const green = body1(0x3c7a3a);
    profileSolid(b, boxCab(2.15, 4.35, 1.0, 3.0, 1.75, 2.78, 0.12, 0.22), hw, cab);
    cabWindows(b, hw + 0.012, 3.2, 4.15, 1.85, 2.62, 0.08);
    b.paint(CHASSIS, Surf.Metal).box(-0.6, 0.55, -4.2, 0.6, 1.0, 4.2, { top: null });
    // compactor body + tailgate hopper
    profileSolid(b, [{ z: -3.2, y: 1.0 }, { z: 2.05, y: 1.0 }, { z: 2.05, y: 3.3 }, { z: -3.2, y: 3.42 }], hw, green);
    profileSolid(b, [{ z: -3.22, y: 0.95 }, { z: -3.22, y: 3.42 }, { z: -4.0, y: 3.2 }, { z: -4.45, y: 2.4 }, { z: -4.5, y: 1.25 }, { z: -4.2, y: 0.95 }], hw - 0.03, body1(0x2f5f2d));
    lamp(b, -0.9, 0.9, 1.2, 2.1, -4.505, -1, P(0x1c1d1f), false);
    sideRect(b, hw + 0.012, -3.2, 2.05, 1.45, 1.7, P(0xf2c230));
    b.paint(0xffa020, Surf.Emissive).box(-0.2, 3.0, 2.6, 0.2, 3.22, 2.9);
    b.paint(TRIM, Surf.Metal).box(-1.1, 0.5, -4.6, 1.1, 0.72, -4.3);
    axle(b, 3.25, 0.5, hw - 0.05);
    axle(b, -1.9, 0.5, hw - 0.02);
    headLamp(b, 0.7, 1.05, 1.16, 1.32, 4.39);
    lamp(b, -0.55, 0.55, 1.12, 1.6, 4.39, 1, GRILLE, false);
    lamp(b, 0.95, 1.18, 1.3, 1.9, -4.51, -1, TAIL);
  },

  train_loco(b, v) {
    const bogie = (z: number) => b.paint(CHASSIS, Surf.Metal).box(-1.3, 0.45, z - 1.9, 1.3, 1.15, z + 1.9);
    if (v === 0) {
      // diesel road-switcher: walkway deck, short nose, cab, long hood
      const bodyC = body1(0x234a86);
      const yel = P(0xe8b421, Surf.Plain);
      b.paint(yel).box(-1.52, 1.15, -9.95, 1.52, 1.55, 9.95, { top: { color: 0x3a3c40, surf: Surf.Metal } });
      bogie(6.4);
      bogie(-6.4);
      b.paint(0x2a2c30, Surf.Metal).box(-1.2, 0.55, -3.4, 1.2, 1.15, 3.4, { top: null });
      profileSolid(b, [{ z: 8.55, y: 1.55 }, { z: 9.92, y: 1.55 }, { z: 9.92, y: 2.7 }, { z: 9.6, y: 3.0 }, { z: 8.55, y: 3.0 }], 0.95, bodyC);
      profileSolid(b, [{ z: 6.2, y: 1.55 }, { z: 8.6, y: 1.55 }, { z: 8.6, y: 3.05, p: CAR_GLASS }, { z: 8.45, y: 3.95 }, { z: 8.1, y: 4.3 }, { z: 6.2, y: 4.3 }], 1.45, bodyC);
      sideRect(b, 1.462, 6.55, 8.2, 3.1, 3.8, CAR_GLASS);
      b.paint(bodyC).box(-1.05, 1.55, -9.8, 1.05, 3.95, 6.2);
      // nose stripes, hood louvers, radiator fans, exhaust
      lamp(b, -0.95, 0.95, 1.8, 2.1, 9.93, 1, yel, false);
      sideRect(b, 1.062, -9.4, -5.6, 2.2, 3.5, body1(0x1a2a44));
      sideRect(b, 1.062, -2.0, 1.5, 2.6, 3.5, body1(0x1a2a44));
      topQuad(b, -0.8, -9.2, 0.8, -6.0, 3.962, P(0x1c1e22, Surf.Metal));
      b.paint(0x222222, Surf.Metal).box(-0.25, 3.95, 3.2, 0.25, 4.25, 3.9);
      headLamp(b, 0.25, 0.55, 2.3, 2.5, 9.93);
      headLamp(b, 0.75, 0.92, 1.62, 1.78, 9.93);
      lamp(b, 0.55, 0.85, 3.5, 3.7, -9.81, -1, TAIL);
    } else {
      // electric: full-width body with raked cabs at both ends, pantograph
      const red = body1(0xb3261e);
      b.paint(CHASSIS, Surf.Metal).box(-1.35, 1.0, -9.6, 1.35, 1.3, 9.6, { top: null });
      bogie(6.0);
      bogie(-6.0);
      profileSolid(b, [
        { z: -9.85, y: 1.2 },
        { z: 9.85, y: 1.2 },
        { z: 9.95, y: 2.35, p: CAR_GLASS },
        { z: 9.45, y: 3.45 },
        { z: 8.9, y: 4.05, w: 0.94, p: P(0x5a5e63, Surf.Metal) },
        { z: -8.9, y: 4.05, w: 0.94 },
        { z: -9.45, y: 3.45, p: CAR_GLASS },
        { z: -9.95, y: 2.35 },
      ], 1.45, red);
      sideRect(b, 1.462, -9.0, 9.0, 1.6, 1.8, P(0xf2f0ea));
      for (const s of [1, -1]) sideQuad(b, 1.462, [[s * 8.2, 2.45], [s * 9.3, 2.45], [s * 9.05, 3.35], [s * 8.2, 3.35]], CAR_GLASS);
      // pantograph
      b.paint(0x3a3c40, Surf.Metal).box(-0.6, 4.05, 3.5, 0.6, 4.3, 5.5);
      b.paint(0x8a8e93, Surf.Metal);
      b.beam([0, 4.3, 3.8], [0, 4.95, 4.9], 0.08);
      b.beam([0, 4.95, 4.9], [0, 5.35, 4.1], 0.07);
      b.beam([-0.9, 5.35, 4.1], [0.9, 5.35, 4.1], 0.07);
      b.paint(0x4a4d52, Surf.Metal).box(-0.8, 4.05, -5.5, 0.8, 4.35, -2.0);
      headLamp(b, 0.45, 0.85, 1.6, 1.8, 9.93);
      lamp(b, 0.45, 0.85, 1.6, 1.8, -9.93, -1, TAIL);
    }
  },

  train_car(b, v) {
    const bogie = (z: number) => b.paint(CHASSIS, Surf.Metal).box(-1.25, 0.45, z - 1.4, 1.25, 1.1, z + 1.4);
    bogie(7.0);
    bogie(-7.0);
    if (v === 0) {
      // passenger coach
      const body = body1(0xdfe2e4);
      profileSolid(b, [{ z: -9.85, y: 1.1 }, { z: 9.85, y: 1.1 }, { z: 9.85, y: 3.72 }, { z: 9.6, y: 4.12, w: 0.92 }, { z: -9.6, y: 4.12, w: 0.92 }, { z: -9.85, y: 3.72 }], 1.45, body);
      const x = 1.462;
      sideRect(b, x, -9.85, 9.85, 1.3, 1.62, body1(0x1f5aa6));
      sideRect(b, x, -8.6, 8.6, 2.15, 3.2, GLASS_LIT);
      for (const z of [-5.8, -3.0, -0.2, 2.6, 5.4]) sideRect(b, x + 0.008, z - 0.12, z + 0.12, 2.15, 3.2, body);
      for (const z of [-9.2, 9.2]) sideRect(b, x + 0.016, z - 0.55, z + 0.55, 1.2, 3.35, P(0x3a4452, Surf.Metal));
      b.paint(0x2a2c30, Surf.Metal).box(-1.0, 0.6, -4.5, 1.0, 1.1, 4.5, { top: null });
      topQuad(b, -0.9, -9.4, 0.9, 9.4, 4.13, P(0x8e9398, Surf.Metal));
    } else if (v === 1) {
      // boxcar
      const col = 0x8a3b24;
      b.paint(CHASSIS, Surf.Metal).box(-1.35, 0.95, -9.9, 1.35, 1.2, 9.9, { top: null });
      b.paint(col, Surf.Corrugated).box(-1.45, 1.2, -9.7, 1.45, 4.1, 9.7, { top: { color: 0x6e3020, surf: Surf.Metal } });
      sideRect(b, 1.462, -1.6, 1.6, 1.3, 3.95, P(0x74311f, Surf.Corrugated));
      sideRect(b, 1.47, -1.6, -1.45, 1.3, 3.95, P(0x3a2a22, Surf.Metal));
      sideRect(b, 1.47, 1.45, 1.6, 1.3, 3.95, P(0x3a2a22, Surf.Metal));
      sideRect(b, 1.462, -8.5, -4.5, 3.2, 3.6, P(0xe8e2d6));
      for (const z of [-9.5, 9.3]) sideRect(b, 1.462, z, z + 0.2, 1.3, 3.9, P(0xd0c040));
    } else {
      // tank car
      const col = 0x1f2124;
      b.paint(CHASSIS, Surf.Metal).box(-1.3, 0.95, -9.9, 1.3, 1.25, 9.9);
      b.paint(col, Surf.Metal, 1);
      limb(b, [[0, 2.65, -9.3], [0, 2.65, 9.3]], [1.42, 1.42], { seg: 10, cap: true, capStart: true, rot: Math.PI / 10 });
      b.paint(0x2c2e31, Surf.Metal);
      limb(b, [[0, 3.9, -0.6], [0, 4.25, -0.6]], [0.55, 0.5], { seg: 6, cap: true });
      sideRect(b, 1.43, 6.5, 7.5, 2.3, 2.9, P(0xf08a1c));
      sideRect(b, 1.43, -8.8, -3.5, 3.0, 3.25, P(0xe8e8e2));
    }
  },

  airplane(b, v) {
    const white = body1(0xf4f5f6);
    const tailC = [0x1d3f7a, 0xc0282a][v];
    const accent = body1(tailC);
    const cy = 4.3;
    // fuselage (8-sided, flats on the sides)
    b.paint(white);
    limb(b, [[0, cy - 0.15, 19.6], [0, cy, 17.3], [0, cy, -11.5], [0, cy + 0.65, -16.8], [0, cy + 1.35, -19.9]], [0.35, 1.9, 2.0, 1.3, 0.3], { seg: 8, rot: Math.PI / 8 });
    const xs = 2.0 * Math.cos(Math.PI / 8) + 0.015;
    sideRect(b, xs, -11.0, 15.8, cy + 0.22, cy + 0.46, GLASS_LIT);
    sideRect(b, xs, -11.4, 16.4, cy - 0.34, cy - 0.12, accent);
    // cockpit windows
    b.paint(0x1a222c, Surf.Metal);
    for (const s of [1, -1]) triOut(b, [s * 0.25, cy + 1.25, 17.9], [s * 1.05, cy + 0.95, 17.55], [s * 0.6, cy + 1.55, 17.25], [s * 0.4, 1, 0.6]);
    // wings (swept, dihedral) + winglets
    const wing = (s: number) => {
      const rl: V3 = [s * 0.5, 3.05, 3.2], rt: V3 = [s * 0.5, 3.05, -4.6], tl: V3 = [s * 17.2, 4.5, -7.6], tt: V3 = [s * 17.2, 4.5, -9.9];
      plate(b, rl, rt, tl, tt, 0.5, 0.14, s);
      b.paint(accent);
      const w0: V3 = [s * 17.1, 4.5, -8.0], w1: V3 = [s * 17.1, 4.5, -9.8], w2: V3 = [s * 17.5, 6.3, -10.4], w3: V3 = [s * 17.5, 6.3, -9.5];
      quadOut(b, w0, w1, w2, w3, [s, 0, 0]);
      quadOut(b, w0, w1, w2, w3, [-s, 0, 0]);
      b.paint(white);
    };
    b.paint(white);
    wing(1);
    wing(-1);
    // engines
    for (const s of [1, -1]) {
      b.paint(v === 0 ? 0xd9dcdf : tailC, Surf.Metal, 1);
      limb(b, [[s * 5.9, 2.35, 3.0], [s * 5.9, 2.4, -1.4]], [1.05, 0.75], { seg: 8, rot: Math.PI / 8 });
      b.paint(0x202226, Surf.Metal);
      const ring: V3[] = [];
      for (let k = 0; k < 8; k++) {
        const a = ((k + 0.5) / 8) * Math.PI * 2;
        ring.push([s * 5.9 + Math.cos(a) * 1.0, 2.35 + Math.sin(a) * 1.0, 3.01]);
      }
      polyOut(b, ring, [0, 0, 1]);
    }
    // tailplane + fin
    b.paint(white);
    for (const s of [1, -1]) plate(b, [s * 0.3, cy + 1.0, -14.8], [s * 0.3, cy + 1.2, -18.1], [s * 6.4, cy + 1.5, -18.6], [s * 6.4, cy + 1.6, -19.9], 0.3, 0.1, s);
    b.paint(accent);
    fin(b, [0, cy + 1.6, -13.2], [0, cy + 1.4, -19.6], [0, 11.6, -18.3], [0, 11.6, -20.3], 0.36, 0.14);
    // landing gear
    b.paint(0x55585c, Surf.Metal).box(-0.1, 0.5, 16.0, 0.1, cy - 1.5, 16.25, { top: null });
    b.paint(TIRE).box(-0.3, 0, 15.75, 0.3, 0.72, 16.5, { top: null });
    for (const s of [1, -1]) {
      b.paint(0x55585c, Surf.Metal).box(s * 2.8, 0.6, -1.3, s * 3.05, 3.1, -1.0, { top: null });
      b.paint(TIRE).box(s * 2.55, 0, -1.8, s * 3.3, 1.0, -0.5, { top: null });
    }
  },

  ship_container(b, v, rng) {
    const hullC = 0x1d3d5c;
    // plan outline (x, z): flat-ish transom stern, full body, pointed bow
    const plan: [number, number][] = [[-10.5, -74], [10.5, -74], [12, -64], [12, 44], [10.2, 58], [6.2, 68], [0, 75], [-6.2, 68], [-10.2, 58], [-12, 44], [-12, -64]];
    b.paint(0x8a2a22, Surf.Metal).extrude(plan, -3, 4.5, { top: false });
    b.paint(hullC, Surf.Metal).extrude(plan, 1.5, 8.5, { topPaint: { color: 0x6b3a2c, surf: Surf.Plain } });
    // forecastle
    b.paint(hullC, Surf.Metal).extrude([[12, 56], [10.2, 58], [6.2, 68], [0, 75], [-6.2, 68], [-10.2, 58], [-12, 56]], 10, 2.4, { topPaint: { color: 0x5e6468, surf: Surf.Plain } });
    // accommodation block + bridge + funnel (stern)
    b.paint(0xf2f0ea, Surf.WallWindows, 0, 2.8).box(-8, 10, -64, 8, 27, -55);
    b.paint(0xf2f0ea, Surf.Plain).box(-12, 27, -60, 12, 29.5, -55.5, { pz: { color: 0x2a3440, surf: Surf.GlassPlain } });
    b.paint(0xc8322a, Surf.Plain).box(-2.5, 10, -71, 2.5, 31, -66, { top: { color: 0x1a1a1a, surf: Surf.Plain } });
    // container bays: 8 bays x (port, starboard) stacks
    const cols = [0x2a6fa8, 0xb84a2a, 0x3e7d4a, 0xd8a23a, 0x8a8f94, 0x6b2f5a, 0xc9ccd0, 0x2f4f7f, 0xa33b2b, 0x4a8a8a];
    const bayL = 12.6;
    for (let i = 0; i < 8; i++) {
      const z0 = -52 + i * (bayL + 0.9), z1 = z0 + bayL;
      const taper = i === 7 ? 2.2 : 0;
      const hA = 10 + 2.6 * rng.int(3, 6), hB = 10 + 2.6 * rng.int(3, 6);
      const cA = rng.pick(cols), cB = rng.pick(cols);
      const W = 11.3 - taper;
      b.paint(cA, Surf.Corrugated).box(-W, 10, z0, 0, hA, z1, hA >= hB ? {} : { px: null });
      b.paint(cB, Surf.Corrugated).box(0, 10, z0, W, hB, z1, hB > hA ? {} : { nx: null });
    }
    void v;
  },

  boat_small(b, v) {
    if (v === 0) {
      // motorboat ~8 m
      hull(b, 8.2, 1.3, 1.0, -0.45, 0xf4f4f0, 0x1f4f8a);
      b.paint(0xf4f4f0, Surf.Plain).box(-1.0, 1.0, 0.2, 1.0, 1.55, 2.2, { top: { color: 0xe8e2d0, surf: Surf.Plain } });
      b.paint(CAR_GLASS);
      quadOut(b, [-1.0, 1.55, 0.25], [1.0, 1.55, 0.25], [0.9, 2.1, -0.15], [-0.9, 2.1, -0.15], [0, 0.6, 1]);
      quadOut(b, [-1.0, 1.55, 0.25], [1.0, 1.55, 0.25], [0.9, 2.1, -0.15], [-0.9, 2.1, -0.15], [0, -0.6, -1]);
      b.paint(0x9a7a52, Surf.Wood).slab(-1.05, -3.6, 1.05, 0.1, 0.06, 1.0);
      b.paint(0x303236, Surf.Metal).box(-0.35, 0.2, -4.35, 0.35, 1.15, -3.95);
    } else if (v === 1) {
      // sailboat ~7.5 m, mast 9 m
      hull(b, 7.6, 1.25, 0.85, -0.5, 0xf2f2ee, 0x7a1c22);
      b.paint(0xe8e4da, Surf.Plain).box(-0.75, 0.85, -0.8, 0.75, 1.35, 1.4);
      b.paint(0x1a222c, Surf.GlassPlain).box(-0.76, 1.0, -0.4, 0.76, 1.2, 1.0, { top: null, pz: null, nz: null });
      b.paint(0xc8ccd0, Surf.Metal);
      limb(b, [[0, 0.85, 1.2], [0, 9.0, 1.2]], [0.08, 0.05], { seg: 4 });
      b.beam([0, 1.9, 1.15], [0, 1.9, -2.9], 0.07);
      b.paint(0xf6f4ee, Surf.Plain);
      const main: V3[] = [[0, 2.0, 1.05], [0, 8.7, 1.1], [0, 1.95, -2.8]];
      triOut(b, main[0], main[1], main[2], [1, 0, 0]);
      triOut(b, main[0], main[1], main[2], [-1, 0, 0]);
      const jib: V3[] = [[0, 1.0, 3.5], [0, 8.2, 1.3], [0, 1.1, 1.45]];
      b.paint(0xe9e2d0, Surf.Plain);
      triOut(b, jib[0], jib[1], jib[2], [1, 0, 0]);
      triOut(b, jib[0], jib[1], jib[2], [-1, 0, 0]);
    } else {
      // motor yacht ~12 m
      hull(b, 12.2, 1.8, 1.3, -0.6, 0xf6f6f2, 0x2b2d31);
      b.paint(0xf6f6f2, Surf.Plain).box(-1.45, 1.3, -3.2, 1.45, 2.6, 2.4, { top: { color: 0xeae6dc, surf: Surf.Plain } });
      b.paint(0x1a222c, Surf.GlassPlain).box(-1.46, 1.75, -2.9, 1.46, 2.35, 2.2, { top: null, nz: null });
      b.paint(0xf6f6f2, Surf.Plain).box(-1.1, 2.6, -2.4, 1.1, 3.5, 0.8, { top: { color: 0xeae6dc, surf: Surf.Plain } });
      b.paint(0x1a222c, Surf.GlassPlain).box(-1.11, 2.9, -2.1, 1.11, 3.3, 0.81, { top: null, nz: null });
      b.paint(0x2a2c30, Surf.Metal).box(-0.9, 3.5, -1.2, 0.9, 3.62, 0.4);
      b.paint(0xc8ccd0, Surf.Metal);
      limb(b, [[0, 3.5, -0.8], [0, 4.6, -1.0]], [0.06, 0.04], { seg: 4 });
      b.paint(0x9a7a52, Surf.Wood).slab(-1.4, -5.8, 1.4, -3.2, 0.05, 1.3);
    }
  },
};

/** Thin tapered plate (wings / stabilizers): root LE, root TE, tip LE, tip TE; s = side sign. 10 tris. */
function plate(b: ModelBuilder, rl: V3, rt: V3, tl: V3, tt: V3, th0: number, th1: number, s: number) {
  const up = (p: V3, t: number): V3 => [p[0], p[1] + t / 2, p[2]];
  const dn = (p: V3, t: number): V3 => [p[0], p[1] - t / 2, p[2]];
  const RLu = up(rl, th0), RTu = up(rt, th0 * 0.5), TLu = up(tl, th1), TTu = up(tt, th1 * 0.5);
  const RLd = dn(rl, th0), RTd = dn(rt, th0 * 0.5), TLd = dn(tl, th1), TTd = dn(tt, th1 * 0.5);
  quadOut(b, RLu, TLu, TTu, RTu, [0, 1, 0]);
  quadOut(b, RLd, TLd, TTd, RTd, [0, -1, 0]);
  quadOut(b, RLu, TLu, TLd, RLd, vnorm([0, 0, 1]));
  quadOut(b, RTu, TTu, TTd, RTd, [0, 0, -1]);
  quadOut(b, TLu, TTu, TTd, TLd, [s, 0, 0]);
}

/** Vertical fin: bottom LE, bottom TE, top LE, top TE (x = 0 plane), thickness at root/top. 10 tris. */
function fin(b: ModelBuilder, bl: V3, bt: V3, tl: V3, tt: V3, th0: number, th1: number) {
  const o = (p: V3, t: number, s: number): V3 => [p[0] + (s * t) / 2, p[1], p[2]];
  for (const s of [1, -1]) quadOut(b, o(bl, th0, s), o(bt, th0 * 0.4, s), o(tt, th1 * 0.4, s), o(tl, th1, s), [s, 0, 0]);
  quadOut(b, o(bl, th0, 1), o(tl, th1, 1), o(tl, th1, -1), o(bl, th0, -1), vnorm([0, 0.3, 1]));
  quadOut(b, o(bt, th0 * 0.4, 1), o(tt, th1 * 0.4, 1), o(tt, th1 * 0.4, -1), o(bt, th0 * 0.4, -1), [0, 0, -1]);
  quadOut(b, o(tl, th1, 1), o(tt, th1 * 0.4, 1), o(tt, th1 * 0.4, -1), o(tl, th1, -1), [0, 1, 0]);
}

/**
 * Lofted boat hull: deck outline at yDeck, narrower keel outline at yKeel (V-hull), transom at the stern.
 * L = length, hw = max half-beam. stripe = sheer stripe color. ~34 tris.
 */
function hull(b: ModelBuilder, L: number, hw: number, yDeck: number, yKeel: number, col: number, stripe: number) {
  const h = L / 2;
  // half outline (x >= 0) from stern to bow
  const half: [number, number][] = [[0.82, -h], [1.0, -h * 0.45], [0.96, h * 0.15], [0.72, h * 0.58], [0.34, h * 0.86], [0, h]];
  const deck: V3[] = [], keel: V3[] = [], mid: V3[] = [];
  const pts = [...half.map(([x, z]) => [x, z] as [number, number]), ...half.slice(0, -1).reverse().map(([x, z]) => [-x, z] as [number, number])];
  const yMid = yDeck - (yDeck - yKeel) * 0.28;
  for (const [x, z] of pts) {
    const bowRise = z > h * 0.5 ? ((z - h * 0.5) / (h * 0.5)) * 0.35 : 0;
    deck.push([x * hw, yDeck + bowRise, z]);
    mid.push([x * hw * 0.97, yMid + bowRise * 0.7, z * 0.995]);
    keel.push([x * hw * 0.45, yKeel, z * 0.9 - h * 0.05]);
  }
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const out = vnorm([deck[i][0] + deck[j][0], 0, (deck[i][2] + deck[j][2]) * 0.2 + (i === n - 1 ? -1 : 0)]);
    b.paint(stripe, Surf.Metal, 1);
    quadOut(b, deck[i], deck[j], mid[j], mid[i], out);
    b.paint(col, Surf.Metal, 1);
    quadOut(b, mid[i], mid[j], keel[j], keel[i], vnorm([out[0], -0.5, out[2]]));
  }
  b.paint(0xe9e4d6, Surf.Plain);
  polyOut(b, deck, [0, 1, 0]);
}
