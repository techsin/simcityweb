/**
 * Airports (transport group): tr_airport_small (8x6 cells) and tr_airport_large (12x8 cells).
 * Layout (both): runway along X at the back (-Z), parallel taxiway, apron, terminal + tower, parking at the front (+Z).
 */
import type { ModelBuilder } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { lampPost } from '../kit';
import {
  flat, stripe, dashed, runwayNumber, lightDot, floodMast, frustum, obox, vault, tree, shrub, carLite, parking,
  serviceVehicle, airliner, turboprop, gaPlane, LIVERIES, shade, quadF, poolRect, poolSoft, type Livery,
} from './tr_kit';

// ---------------------------------------------------------------------------------------------- palette
const C = {
  grass: 0x80a04e,
  grassDark: 0x6f8f45,
  runway: 0x2e3033,
  taxi: 0x3a3c40,
  apron: 0xaba79f,
  white: 0xf2f2ee,
  yellow: 0xf0c020,
  edgeLight: 0xfff1c8,
  green: 0x33ff66,
  red: 0xff3322,
  blue: 0x3a6cff,
  road: 0x3b3c40,
  sidewalk: 0xc9c4b8,
};
const Y = { grass: 0.04, rwy: 0.12, rwyMark: 0.17, apron: 0.14, apronMark: 0.19 };

// ---------------------------------------------------------------------------------------------- runway / taxiways
interface RunwayOpts {
  keys: number; // piano keys per side
  lightPitch: number;
  dash: [number, number];
  numH: number;
  aim: boolean;
}
function runway(b: ModelBuilder, x0: number, x1: number, zc: number, w: number, o: RunwayOpts): void {
  const z0 = zc - w / 2, z1 = zc + w / 2;
  b.paint(C.runway, Surf.Pavement).box(x0, 0, z0, x1, Y.rwy, z1, { bottom: null });
  const y = Y.rwyMark;
  b.paint(C.white, Surf.Plain);
  // edge lines
  flat(b, x0 + 1, z0 + 0.5, x1 - 1, z0 + 1.0, y);
  flat(b, x0 + 1, z1 - 1.0, x1 - 1, z1 - 0.5, y);
  // threshold piano keys
  const keyW = Math.min(1.5, (w / 2 - 2.2) / (o.keys * 1.9));
  const keyL = o.numH * 1.5;
  for (const [xs, dir] of [[x0 + 2, 1], [x1 - 2, -1]] as [number, number][]) {
    for (let k = 0; k < o.keys; k++)
      for (const sd of [-1, 1]) {
        const zz = zc + sd * (1.4 + k * keyW * 1.9);
        flat(b, xs, zz, xs + dir * keyL, zz + sd * keyW, y);
      }
    // threshold bar
    flat(b, xs + dir * (keyL + 1.2), z0 + 1.4, xs + dir * (keyL + 2.0), z1 - 1.4, y);
  }
  // designators
  const dw = o.numH * 0.46, dt = o.numH * 0.12;
  const tw = dw * 2 + dt * 1.6;
  const nx0 = x0 + 2 + keyL + 4;
  runwayNumber(b, '09', nx0, zc - tw / 2, [1, 0], [0, 1], dw, o.numH, dt, y);
  runwayNumber(b, '27', x1 - 2 - keyL - 4, zc + tw / 2, [-1, 0], [0, -1], dw, o.numH, dt, y);
  // aiming point bars
  const cx0 = nx0 + o.numH + 3;
  const cx1 = x1 - 2 - keyL - 4 - o.numH - 3;
  if (o.aim) {
    const aL = o.numH * 1.4, aW = w * 0.09;
    for (const sd of [-1, 1]) {
      flat(b, cx0 + 4, zc + sd * 2.4, cx0 + 4 + aL, zc + sd * (2.4 + aW), y);
      flat(b, cx1 - 4, zc + sd * 2.4, cx1 - 4 - aL, zc + sd * (2.4 + aW), y);
    }
  }
  // centreline
  dashed(b, cx0, zc, cx1, zc, Math.max(0.45, w * 0.028), y, o.dash[0], o.dash[1]);
  // edge lights (white), threshold (green) / end (red)
  for (let x = x0 + 3; x <= x1 - 3 + 0.01; x += o.lightPitch) {
    lightDot(b, x, Y.grass, z0 - 0.7, 0.65, C.edgeLight);
    lightDot(b, x, Y.grass, z1 + 0.7, 0.65, C.edgeLight);
  }
  for (let zz = z0 + 1.5; zz <= z1 - 1.5 + 0.01; zz += (w - 3) / 6) {
    lightDot(b, x0 + 0.6, Y.rwy, zz, 0.55, C.green);
    lightDot(b, x1 - 0.6, Y.rwy, zz, 0.55, C.red);
  }
}

/** Taxiway strip along X with a yellow centreline and blue edge lights on one side. */
function taxiway(b: ModelBuilder, x0: number, x1: number, zc: number, w: number, lightsZ: number | null, pitch: number): void {
  b.paint(C.taxi, Surf.Pavement).box(x0, 0, zc - w / 2, x1, Y.rwy, zc + w / 2, { bottom: null });
  b.paint(C.yellow, Surf.Plain);
  stripe(b, x0 + 2, zc, x1 - 2, zc, 0.35, Y.rwyMark);
  if (lightsZ !== null) for (let x = x0 + 4; x < x1 - 2; x += pitch) lightDot(b, x, Y.grass, lightsZ, 0.55, C.blue);
}
/** Connector from taxiway (za) to runway edge (zb) at x; with hold-short bars. */
function connector(b: ModelBuilder, x: number, za: number, zb: number, w: number): void {
  b.paint(C.taxi, Surf.Pavement).box(x - w / 2, 0, Math.min(za, zb), x + w / 2, Y.rwy - 0.01, Math.max(za, zb), { bottom: null });
  b.paint(C.yellow, Surf.Plain);
  stripe(b, x, za, x, zb, 0.35, Y.rwyMark);
  const zh = zb + (za - zb) * 0.45;
  const d = Math.sign(za - zb);
  flat(b, x - w / 2 + 0.4, zh, x + w / 2 - 0.4, zh + d * 0.3, Y.rwyMark);
  flat(b, x - w / 2 + 0.4, zh + d * 0.6, x + w / 2 - 0.4, zh + d * 0.9, Y.rwyMark);
  for (const k of [0, 1]) dashed(b, x - w / 2 + 0.4, zh + d * (1.3 + k * 0.6), x + w / 2 - 0.4, zh + d * (1.3 + k * 0.6), 0.3, Y.rwyMark, 0.9, 0.7);
}

// ---------------------------------------------------------------------------------------------- buildings
/** ATC tower: base block, tapered shaft, service floor, faceted glazed cab (glows at night), roof, mast + beacon. */
function controlTower(b: ModelBuilder, x: number, z: number, H: number, s: number, baseW: number, baseD: number): void {
  // base building
  b.paint(0xe6e3dc, Surf.WallWindows, 2, 3.4).boxC(x, z, baseW, baseD, 0, 4.4 * s + 2, { top: { color: 0x8e8b84, surf: Surf.RoofFlat } });
  const yCab = H - 5.2 * s;
  b.paint(0xe9e7e1, Surf.Plain).cylinder(x, z, 0, yCab - 2.6 * s, 2.3 * s, 1.85 * s, 10, { top: false });
  // service floor with ribbon windows
  b.paint(0xf0eee8, Surf.WallWindows, 2, 2.6 * s).cylinder(x, z, yCab - 2.6 * s, 2.6 * s, 3.0 * s, 3.3 * s, 10, { smooth: false, top: true });
  // cab: outward-sloping glazing
  b.paint(0x2a3a48, Surf.GlassPlain).cylinder(x, z, yCab, 3.2 * s, 3.4 * s, 4.1 * s, 8, { smooth: false, top: false });
  b.paint(0x2f3336, Surf.Metal).cylinder(x, z, yCab, 0.25, 3.45 * s, 3.45 * s, 8, { smooth: false, top: true });
  // roof + mast
  b.paint(0xdcdad4, Surf.Metal).cylinder(x, z, yCab + 3.2 * s, 0.7 * s, 4.4 * s, 3.6 * s, 8, { smooth: false, top: true });
  b.paint(0xb8bcc0, Surf.Metal).cylinder(x, z, yCab + 3.9 * s, H - yCab - 3.9 * s - 0.4, 0.12, 0.06, 5, { top: false });
  lightDot(b, x, H - 0.45, z, 0.5, C.red);
  lightDot(b, x + 1.4 * s, yCab + 3.9 * s, z, 0.55, 0x66ff99);
}

/** Aircraft hangar: corrugated walls, curved (barrel vault) roof along Z, big door on the -Z face. */
function hangar(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, wallH: number, rise: number, doorOpen: number): void {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  b.paint(0xc7cacd, Surf.Corrugated).box(x0, 0, z0, x1, wallH, z1, { top: null });
  b.paint(0x9ea4aa, Surf.Metal);
  vault(b, cx, cz, w + 0.6, d + 0.6, wallH, rise, 'z', { seg: 8, ends: { color: 0xc7cacd, surf: Surf.Corrugated }, endAt: [-d / 2, d / 2] });
  // door (on -Z face)
  const dw = w * 0.86, dh = wallH + rise * 0.55;
  b.paint(0x8c939a, Surf.Corrugated).box(cx - dw / 2, 0, z0 - 0.35, cx + dw / 2, dh, z0 - 0.05, { bottom: null });
  if (doorOpen > 0) b.paint(0x17191c, Surf.Plain).box(cx - (dw * doorOpen) / 2, 0, z0 - 0.42, cx + (dw * doorOpen) / 2, dh - 0.6, z0 - 0.36, { bottom: null, top: null, pz: null, px: null, nx: null });
  // door header + lights
  b.paint(0x5c6166, Surf.Metal).box(cx - dw / 2 - 0.3, dh, z0 - 0.5, cx + dw / 2 + 0.3, dh + 0.7, z0, { bottom: null });
  for (const sx of [-1, 1]) lightDot(b, cx + sx * (w / 2 - 0.5), wallH + 0.1, z0 + 0.3, 0.45, C.red);
  lightDot(b, cx, wallH + rise + 0.05, z0 + 1.0, 0.5, C.red);
  // apron-side floods over the door
  b.paint(0xfff0d0, Surf.Emissive);
  for (const sx of [-0.3, 0.3]) b.box(cx + sx * dw - 0.8, dh + 0.1, z0 - 0.75, cx + sx * dw + 0.8, dh + 0.4, z0 - 0.5, { top: null });
}

/** Vertical fuel / storage tank with a shallow cone roof (~40 tris). */
function tank(b: ModelBuilder, x: number, z: number, r: number, h: number, color: number): void {
  b.paint(color, Surf.Metal).cylinder(x, z, 0, h, r, r, 12, { top: false });
  b.paint(shade(color, 0.85), Surf.Metal).cone(x, z, h, r * 0.18, r, 12);
  b.paint(0x7a7f85, Surf.Metal).box(x - r - 0.1, h - 0.9, z - 0.2, x - r + 0.1, h, z + 0.2, { bottom: null });
}

/**
 * Jet bridge from terminal face (at zFace, height yT) to aircraft door (dx, dz, yD). Rotunda at (rx, rz).
 * ~70 tris
 */
function jetBridge(b: ModelBuilder, zFace: number, yT: number, rx: number, rz: number, dx: number, dz: number, yD: number): void {
  const skin = 0xb7bcc2;
  // fixed link: terminal -> rotunda
  b.paint(skin, Surf.Corrugated).box(rx - 1.3, yT, rz, rx + 1.3, yT + 2.8, zFace, { bottom: { color: 0x6c7176, surf: Surf.Metal } });
  b.paint(0x33373b, Surf.Metal).cylinder(rx, rz, 0, yT, 0.55, 0.55, 6, { top: false });
  b.paint(0xa9aeb4, Surf.Metal).cylinder(rx, rz, yT - 0.3, 3.4, 2.0, 2.0, 8, { top: true });
  // moving tunnel: rotunda -> cab
  const ang = Math.atan2(dx - rx, dz - rz);
  const ux = Math.sin(ang), uz = Math.cos(ang);
  const cabX = dx - ux * 1.6, cabZ = dz - uz * 1.6;
  b.paint(skin, Surf.Corrugated);
  obox(b, [rx + ux * 1.6, yT + 1.35, rz + uz * 1.6], [cabX, yD + 1.35, cabZ], 2.5, 2.7, { ends: false, bottom: true });
  // window strip on the tunnel (glows at night)
  b.paint(0x2a323a, Surf.GlassPlain);
  obox(b, [rx + ux * 2, yT + 1.75, rz + uz * 2], [cabX - ux * 0.4, yD + 1.75, cabZ - uz * 0.4], 2.56, 0.7, { ends: false });
  // cab + canopy against the aircraft
  b.push().translate(cabX, 0, cabZ).rotateY(ang);
  b.paint(0x9aa0a6, Surf.Metal).box(-1.7, yD, -1.3, 1.7, yD + 3.0, 1.6, { bottom: { color: 0x6c7176, surf: Surf.Metal } });
  b.paint(0x2c2f33, Surf.Metal).box(-1.4, yD + 0.1, 1.6, 1.4, yD + 2.8, 2.0, { bottom: null });
  // drive column + wheel bogie
  b.paint(0x33373b, Surf.Metal).box(-1.2, 0.5, -2.8, -0.9, yD, -2.4, { top: null, bottom: null }).box(0.9, 0.5, -2.8, 1.2, yD, -2.4, { top: null, bottom: null });
  b.paint(0x1f2124, Surf.Metal).box(-1.6, 0.1, -3.1, 1.6, 0.8, -2.1, { bottom: null });
  b.pop();
}

/** Parked GA / service apron dressing near an aircraft at (x,z) nose +Z. */
function turnaround(b: ModelBuilder, rng: RNG, x: number, z: number, s: number, side: number): void {
  serviceVehicle(b, x - side * 6 * s, z + 3 * s, rng.range(-0.2, 0.2) + Math.PI / 2, 'tug');
  serviceVehicle(b, x - side * 5.5 * s, z - 6 * s, Math.PI / 2 * side, rng.chance(0.5) ? 'fuel' : 'catering');
}

function flagPoleLite(b: ModelBuilder, x: number, z: number, h: number): void {
  b.paint(0xdddddd, Surf.Metal).cylinder(x, z, 0, h, 0.08, 0.05, 5, { top: false });
  b.paint(0x2e6fb5, Surf.Plain);
  quadF(b, [x, h - 0.2, z], [x + 2, h - 0.2, z], [x + 2, h - 1.4, z], [x, h - 1.4, z], [0, 0, 1]);
  quadF(b, [x, h - 0.2, z], [x + 2, h - 0.2, z], [x + 2, h - 1.4, z], [x, h - 1.4, z], [0, 0, -1]);
}

// ---------------------------------------------------------------------------------------------- small airport
function airportSmall(b: ModelBuilder, rng: RNG): void {
  // ground
  b.paint(C.grass, Surf.Foliage).slab(-64, -48, 64, 48, Y.grass);
  // runway + taxiway
  runway(b, -62.5, 62.5, -38, 14, { keys: 3, lightPitch: 12, dash: [6, 5], numH: 5, aim: false });
  taxiway(b, -56, 56, -24, 6, -27.7, 16);
  connector(b, -52, -27, -31, 6);
  connector(b, 52, -27, -31, 6);
  // apron
  b.paint(C.apron, Surf.Pavement).box(-50, 0, -21, 34, Y.apron, 4, { bottom: null });
  b.paint(C.taxi, Surf.Pavement).box(-8, 0, -21.5, 4, Y.rwy, -21, { bottom: null });
  b.paint(C.yellow, Surf.Plain);
  stripe(b, -47, -17.5, 31, -17.5, 0.3, Y.apronMark);
  stripe(b, -18, -17.5, -18, -1, 0.3, Y.apronMark);
  stripe(b, 8, -17.5, 8, -2, 0.3, Y.apronMark);
  flat(b, -21, -1.3, -15, -1.0, Y.apronMark);
  b.paint(C.white, Surf.Plain);
  dashed(b, -48, 1.6, 32, 1.6, 0.25, Y.apronMark, 2, 2);
  // hangar apron + hangar
  b.paint(C.apron, Surf.Pavement).box(34, 0, -21, 62, Y.apron, 4, { bottom: null });
  hangar(b, 37, -16, 61, 3, 5.2, 5.2, 0.45);
  // terminal: glass hall under a barrel roof + office annex
  const tz0 = 7, tz1 = 19;
  b.paint(0x3e4c58, Surf.GlassPlain).box(-36, 0, tz0, 2, 3.2, tz1, {
    px: { color: 0xe8e5de, surf: Surf.Plain },
    nx: { color: 0xe8e5de, surf: Surf.Plain },
    top: null,
  });
  b.paint(0x6e8fa8, Surf.GlassCurtain, 5, 2.2).box(-36, 3.2, tz0, 2, 5.4, tz1, {
    nz: { color: 0x2a323a, surf: Surf.GlassPlain },
    px: { color: 0xe8e5de, surf: Surf.Plain },
    nx: { color: 0xe8e5de, surf: Surf.Plain },
    top: { color: 0x8e8b84, surf: Surf.RoofFlat },
  });
  b.paint(0xd8dce0, Surf.Metal);
  vault(b, -17, 13, 16, 40, 5.4, 2.6, 'x', { seg: 8, ends: { color: 0xe8e5de, surf: Surf.Plain }, endAt: [-19, 19], under: { color: 0xc8a878, surf: Surf.Wood } });
  b.paint(0xd8d4ca, Surf.WallWindows, 2, 3.2).box(-47, 0, 8, -36, 4.6, 18, { top: { color: 0x7f7c76, surf: Surf.RoofFlat } });
  // entrance canopy + sign
  b.paint(0xe8e8e4, Surf.Metal).box(-26, 3.6, tz1, -8, 3.9, tz1 + 4, { bottom: { color: 0xcfcac0, surf: Surf.Plain } });
  b.paint(0xfff4dc, Surf.Emissive).box(-24, 3.5, tz1 + 3.4, -10, 3.6, tz1 + 3.7, { top: null });
  for (const x of [-25.5, -8.5]) b.paint(0x5a5f64, Surf.Metal).box(x - 0.15, 0, tz1 + 3.6, x + 0.15, 3.6, tz1 + 3.9, { top: null, bottom: null });
  b.paint(0x1f3f7a, Surf.Metal).box(-22, 6.3, tz1 + 1.7, -12, 7.5, tz1 + 1.9);
  b.paint(0xf4f6ff, Surf.Emissive).box(-21.6, 6.5, tz1 + 1.9, -12.4, 7.3, tz1 + 1.98, { top: null, bottom: null, nz: null, px: null, nx: null });
  // curb road + access road + parking
  b.paint(C.road, Surf.Pavement).box(-48, 0, 21, 16, 0.1, 25.5, { bottom: null });
  b.paint(C.white, Surf.Plain);
  dashed(b, -46, 23.25, 14, 23.25, 0.18, 0.13, 2.5, 2.5);
  b.paint(C.road, Surf.Pavement).box(6, 0, 25.5, 14, 0.1, 48, { bottom: null });
  b.paint(C.sidewalk, Surf.Pavement).box(-48, 0, 19, 4, 0.16, 21, { bottom: null });
  parking(b, rng, -44, 27, 4, 45, 0.4);
  carLite(b, -20, 22.2, Math.PI / 2, 0xf1c40f, 0.1);
  carLite(b, -28, 22.2, Math.PI / 2, 0xf1f1ef, 0.1);
  serviceVehicle(b, -38, 23.2, Math.PI / 2, 'bus');
  // tower
  controlTower(b, 22, 12, 22, 0.78, 9, 7);
  // fuel tanks with bund
  b.paint(0xbdb9b0, Surf.Plain).box(-62, 0, 6, -50, 0.9, 18, { bottom: null, top: { color: 0x9a968e, surf: Surf.Pavement } });
  tank(b, -58.5, 9.5, 2.6, 4.2, 0xeceae4);
  tank(b, -53.5, 14.5, 2.6, 4.2, 0xeceae4);
  // aircraft
  turboprop(b, -18, -12, 0, 0.82, LIVERIES[0]);
  airliner(b, 8, -9.5, 0, 0.55, LIVERIES[1]);
  gaPlane(b, 42, -12, 0.35, 0xf4f4f2, 0xc8262d);
  gaPlane(b, 52, -14, -0.2, 0xf4f4f2, 0x1f4fa0);
  gaPlane(b, 29, -12.5, 0.15, 0xf2e6c8, 0x2e7d4f);
  gaPlane(b, -40, -34, Math.PI / 2, 0xf4f4f2, 0xe36a1e, Y.rwy);
  serviceVehicle(b, -12, -3, Math.PI / 2, 'tug');
  serviceVehicle(b, 15, -2, 0, 'fuel');
  // apron floods
  floodMast(b, -30, 3, 14, 0);
  floodMast(b, 20, 3, 14, 0);
  poolRect(b, -44, -15.5, 30, 3.6, Y.apron + 0.025, C.apron, 0.6);
  poolRect(b, -26, 19.1, -8, 21, 0.18, C.sidewalk, 0.5);
  for (const x of [-2, -30]) poolSoft(b, x, 23.3, 2.2, 0.115, C.road);
  // windsock
  b.paint(0xdddddd, Surf.Metal).cylinder(-50, -29, 0, 5, 0.08, 0.06, 5, { top: false });
  b.paint(0xff7a1a, Surf.Plain);
  frustum(b, [-50, 4.8, -29], [-47.4, 4.5, -29.6], 0.45, 0.22, 6);
  // landscaping
  for (const x of [-58, -36, -14, 24, 44, 60]) tree(b, rng, x, 45.5, rng.range(6, 7.2));
  for (const [x, z] of [[-61, 30], [-60, 40], [58, 30]] as [number, number][]) tree(b, rng, x, z, rng.range(5.5, 7));
  for (let x = -44; x <= 0; x += 11) shrub(b, rng, x, 20, 0.8);
  // GA T-hangar row + flight school / FBO with a small lot
  b.paint(C.apron, Surf.Pavement).box(30, 0, 4, 62, Y.apron, 7.5, { bottom: null });
  b.paint(0xd9d4c8, Surf.Corrugated).box(31, 0, 7.5, 62, 3.6, 16, { top: null });
  b.paint(0x7b8189, Surf.Metal).gableRoof(46.5, 11.75, 31, 8.5, 3.6, 1.1, 'x', 0.35, { color: 0xd9d4c8, surf: Surf.Corrugated });
  b.paint(0x6f767e, Surf.Metal);
  for (let i = 0; i < 5; i++) quadF(b, [32 + i * 6, 0.1, 7.44], [36.6 + i * 6, 0.1, 7.44], [36.6 + i * 6, 3.1, 7.44], [32 + i * 6, 3.1, 7.44], [0, 0, -1]);
  b.paint(0xe9e4d8, Surf.WallWindows, 2, 3.3).box(30, 0, 27, 44, 6.8, 36, { top: { color: 0x7f7c76, surf: Surf.RoofFlat } });
  b.paint(0x1f3f7a, Surf.Metal).box(30, 6.8, 27, 44, 7.3, 36);
  b.paint(C.road, Surf.Pavement).box(14, 0, 36.5, 44, 0.1, 44, { bottom: null });
  for (const x of [20, 25.5, 36]) carLite(b, x, 40.2, 0, rng.pick([0xb8bcc2, 0x2b2d31, 0x8a1c1c]), 0.1);
  flagPoleLite(b, 46, 30, 8);
  lampPost(b, -2, 24, 5);
  lampPost(b, -30, 24, 5);
}

// ---------------------------------------------------------------------------------------------- large airport
function airportLarge(b: ModelBuilder, rng: RNG): void {
  b.paint(C.grass, Surf.Foliage).slab(-96, -64, 96, 64, Y.grass);
  // runway, taxiway, connectors
  const rz = -50;
  runway(b, -95, 95, rz, 25, { keys: 4, lightPitch: 11.5, dash: [8, 6], numH: 7, aim: true });
  taxiway(b, -90, 92, -30, 8, -34.6, 14);
  for (const x of [-84, -22, 42, 86]) connector(b, x, -34, -37.5, 8);
  // apron
  b.paint(C.apron, Surf.Pavement).box(-94, 0, -26, 95, Y.apron, 13, { bottom: null });
  const ym = Y.apronMark;
  b.paint(C.yellow, Surf.Plain);
  stripe(b, -90, -23, 92, -23, 0.35, ym);
  const gates: { x: number; wide: boolean; liv: Livery }[] = [
    { x: -56, wide: false, liv: LIVERIES[0] },
    { x: -27, wide: false, liv: LIVERIES[1] },
    { x: 2, wide: false, liv: LIVERIES[2] },
    { x: 37, wide: true, liv: LIVERIES[5] },
  ];
  for (const g of gates) {
    stripe(b, g.x, -23, g.x, 8.5, 0.35, ym);
    flat(b, g.x - 3, 8.6, g.x + 3, 9.0, ym);
  }
  // service road (white dashes) along the terminal
  b.paint(C.white, Surf.Plain);
  dashed(b, -92, 11.2, 92, 11.2, 0.25, ym, 2.5, 2.5);
  // red equipment-restraint lines between stands
  b.paint(0xc8322a, Surf.Plain);
  for (const x of [-41.5, -12.5, 18]) stripe(b, x, 10.2, x, 4, 0.3, ym);

  // ---- terminal: glazed hall, 4 barrel-vault roof shells running front-to-back
  const tx0 = -68, tx1 = 46, tz0 = 14, tz1 = 32, th = 11;
  // ground level: storefront glazing (glows warm at night); upper level: curtain wall
  b.paint(0x3e4c58, Surf.GlassPlain).box(tx0, 0, tz0, tx1, 5.3, tz1, {
    px: { color: 0xe6e4de, surf: Surf.Plain },
    nx: { color: 0xe6e4de, surf: Surf.Plain },
    top: null,
  });
  b.paint(0x6f93ad, Surf.GlassCurtain, 5, 5.5).box(tx0, 5.3, tz0, tx1, th, tz1, {
    nz: { color: 0x5d86a8, surf: Surf.GlassCurtain, pattern: 0, floor: 5.5 },
    px: { color: 0xe6e4de, surf: Surf.Plain },
    nx: { color: 0xe6e4de, surf: Surf.Plain },
    top: { color: 0x8e8b84, surf: Surf.RoofFlat },
  });
  // mid-level floor slab line (reads as two levels)
  b.paint(0xdedbd4, Surf.Plain).box(tx0 - 0.2, 5.3, tz1, tx1 + 0.2, 5.9, tz1 + 0.35, { bottom: null });
  b.paint(0xdedbd4, Surf.Plain).box(tx0 - 0.2, 5.3, tz0 - 0.35, tx1 + 0.2, 5.9, tz0, { bottom: null });
  const nV = 4, vw = (tx1 - tx0) / nV;
  for (let i = 0; i < nV; i++) {
    const cx = tx0 + vw * (i + 0.5);
    b.paint(0xd9dde1, Surf.Metal);
    vault(b, cx, (tz0 + tz1) / 2, vw, tz1 - tz0 + 7, th, 4.6, 'z', {
      seg: 8, ends: { color: 0x7fa2bb, surf: Surf.GlassCurtain, pattern: 5, floor: 3 }, endAt: [-(tz1 - tz0) / 2, (tz1 - tz0) / 2],
      under: { color: 0xc9a77a, surf: Surf.Wood },
    });
  }
  // valley gutters between shells
  b.paint(0x8a8f94, Surf.Metal);
  for (let i = 1; i < nV; i++) b.box(tx0 + vw * i - 0.5, th, tz0 - 3.5, tx0 + vw * i + 0.5, th + 0.5, tz1 + 3.5, { bottom: null });
  // landside canopy over the curb with downlights
  b.paint(0xeeeeea, Surf.Metal).box(-62, 7.2, tz1 + 0.2, 40, 7.6, tz1 + 6.5, { bottom: { color: 0xd6d1c6, surf: Surf.Plain } });
  b.paint(0xfff2d8, Surf.Emissive).box(-60, 7.05, tz1 + 5.6, 38, 7.2, tz1 + 6.0, { top: null });
  b.paint(0x6a7076, Surf.Metal);
  for (let x = -60; x <= 38.1; x += 14) b.box(x - 0.2, 0, tz1 + 5.6, x + 0.2, 7.2, tz1 + 6.0, { top: null, bottom: null });
  // signage on the landside facade
  for (const x of [-40, -6, 28]) {
    b.paint(0x14305e, Surf.Metal).box(x - 6, 8.4, tz1 + 0.35, x + 6, 10.0, tz1 + 0.6);
    b.paint(0xeaf2ff, Surf.Emissive).box(x - 5.6, 8.65, tz1 + 0.6, x + 5.6, 9.75, tz1 + 0.68, { top: null, bottom: null, nz: null, px: null, nx: null });
  }
  // rooftop plant between shells hidden; roof beacons
  lightDot(b, tx0 + 1, th + 4.6, (tz0 + tz1) / 2, 0.6, C.red);
  lightDot(b, tx1 - 1, th + 4.6, (tz0 + tz1) / 2, 0.6, C.red);

  // ---- gates: jet bridges + aircraft + turnaround vehicles
  for (const g of gates) {
    const s = g.wide ? 0.62 : 0.78;
    const R = g.wide ? 2.9 : 2.0;
    const noseLocal = g.wide ? 16 + 2.4 * R : 11 + 2.4 * R;
    const zp = 8.2 - noseLocal * s;
    airliner(b, g.x, zp, 0, s, g.liv, { wide: g.wide, y: Y.apron });
    const doorZ = zp + (g.wide ? 12.5 : 8.8) * s;
    const doorX = g.x + (R * 0.924 + 0.3) * s;
    const hc = g.wide ? 4.2 : 3.2;
    jetBridge(b, tz0, 4.4, g.x + 6.5, 9.4, doorX + 1.3, doorZ, hc * s + Y.apron - 1.0);
    turnaround(b, rng, g.x, zp, s, 1);
  }
  // taxiing + departing aircraft
  airliner(b, -30, -30, -Math.PI / 2, 0.78, LIVERIES[3], { y: Y.rwy });
  airliner(b, 55, rz, Math.PI / 2, 0.78, LIVERIES[4], { y: Y.rwy });

  // ---- maintenance hangar + GA stand
  hangar(b, 59, -5, 94, 13, 7, 8.5, 0.35);
  airliner(b, 76.5, -15.5, 0, 0.42, LIVERIES[2], { y: Y.apron });
  // ---- control tower
  controlTower(b, 78, 26, 35, 1.05, 14, 10);
  // ---- fuel farm
  b.paint(0xbdb9b0, Surf.Plain).box(-94, 0, 15, -72, 1.0, 38, { bottom: null, top: { color: 0x9a968e, surf: Surf.Pavement } });
  tank(b, -88, 21, 4.2, 7.5, 0xeceae4);
  tank(b, -78, 21, 4.2, 7.5, 0xeceae4);
  tank(b, -88, 32, 4.2, 7.5, 0xeceae4);
  b.paint(0xd9a324, Surf.Metal);
  frustum(b, [-78, 1.6, 26], [-78, 1.6, 36.5], 0.5, 0.5, 6);
  frustum(b, [-78, 1.6, 36.5], [-70, 1.6, 36.5], 0.5, 0.5, 6);

  // ---- landside: curb road, access roads, parking
  b.paint(C.road, Surf.Pavement).box(-70, 0, tz1 + 0.5, 56, 0.1, 41.5, { bottom: null });
  b.paint(C.sidewalk, Surf.Pavement).box(-66, 0, tz1, 44, 0.18, tz1 + 3.2, { bottom: null });
  b.paint(C.white, Surf.Plain);
  dashed(b, -68, 38.3, 54, 38.3, 0.2, 0.14, 3, 3);
  b.paint(C.road, Surf.Pavement).box(46, 0, 41.5, 56, 0.1, 64, { bottom: null });
  b.paint(C.road, Surf.Pavement).box(-70, 0, 41.5, -62, 0.1, 64, { bottom: null });
  b.paint(C.white, Surf.Plain);
  dashed(b, 51, 42, 51, 63.5, 0.2, 0.14, 3, 3);
  parking(b, rng, -60, 43, 44, 62, 0.36);
  // curbside vehicles
  serviceVehicle(b, -48, 36.4, Math.PI / 2, 'bus');
  serviceVehicle(b, 12, 36.4, Math.PI / 2, 'bus');
  for (const x of [-30, -24, -8, 0, 24, 30]) carLite(b, x + rng.range(-1, 1), 36.4, Math.PI / 2, rng.chance(0.6) ? 0xf1c40f : rng.pick([0x2b2d31, 0xf1f1ef]), 0.1);
  for (const x of [-56, -12, 40]) carLite(b, x, 40, -Math.PI / 2, rng.pick([0x2b2d31, 0x8a1c1c, 0xb8bcc2]), 0.1);
  // apron floodlight masts along the service road
  for (const x of [-41.5, -12.5, 18, 54]) {
    floodMast(b, x, 12.2, 20, 0);
  }
  // floodlit stand area (reads as a slightly darker concrete zone by day)
  poolRect(b, -70, -21, 54, 12.6, Y.apron + 0.025, C.apron, 0.6);
  poolRect(b, -62, tz1 + 0.3, 40, tz1 + 3.1, 0.2, C.sidewalk, 0.5);
  for (const x of [-52, -20, 24]) poolSoft(b, x, 48.2, 5, 0.09, C.road);
  // tower-side staff parking + trees
  parking(b, rng, 62, 44, 94, 62, 0.35);
  for (const x of [-90, -78, -50, -30, -10, 10, 30, 64, 80]) tree(b, rng, x, 62, rng.range(6.5, 7.5));
  for (const [x, z] of [[-90, 46], [-80, 53], [-90, 56], [92, 32], [64, 36]] as [number, number][]) tree(b, rng, x, z, rng.range(6, 8));
  for (const x of [-52, -20, 24]) lampPost(b, x, 42.2, 6);
  // windsock by the runway
  b.paint(0xdddddd, Surf.Metal).cylinder(-70, -35.2, 0, 6, 0.08, 0.06, 5, { top: false });
  b.paint(0xff7a1a, Surf.Plain);
  frustum(b, [-70, 5.8, -35.2], [-67, 5.4, -35.8], 0.5, 0.25, 6);
  // ILS localizer bar & glide-slope hut
  b.paint(0xd0d0d0, Surf.Metal).box(-95.5, 0, -52, -94.8, 1.8, -48);
  b.paint(0xe8e4dc, Surf.Plain).box(-68, 0, -36.6, -65, 2.4, -34.8, { top: { color: 0xc0392b, surf: Surf.Plain } });
}

export const airModels = {
  tr_airport_small: (b: ModelBuilder, _v: number, rng: RNG) => airportSmall(b, rng),
  tr_airport_large: (b: ModelBuilder, _v: number, rng: RNG) => airportLarge(b, rng),
};
