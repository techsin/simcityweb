/**
 * Shared modeling helpers for the 'civic' and 'reward' builders (civic.ts / reward.ts).
 * Classical architecture pieces (columns, porticos, domes, clocks), service signage (red cross, helipad),
 * sports/landscape pieces (courts, track, playground, graves) and cheap local vehicles (cruiser, fire engine,
 * ambulance, buses, jets, helicopter). All coordinates in model space (meters, lot centered, front = +Z).
 */
import { ModelBuilder, PALETTE, type ColorLike, type Paint } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';

export type V3 = [number, number, number];
export type Face = 'pz' | 'nz' | 'px' | 'nx';
/** rotateY angle that maps a local +Z facing element to the given face */
export const FACE_ROT: Record<Face, number> = { pz: 0, px: Math.PI / 2, nz: Math.PI, nx: -Math.PI / 2 };

export const pnt = (color: ColorLike, surf: Surf = Surf.Plain, pattern = 0, floor = 3.3): Paint => ({ color, surf, pattern, floor });

/** Civic palette (sRGB). */
export const CIV = {
  limestone: 0xddd3bf,
  limestoneWarm: 0xd2c19f,
  marble: 0xeeeae1,
  granite: 0x8f8b86,
  graniteDark: 0x5f5d5a,
  copper: 0x6fa591,
  copperDark: 0x4f8574,
  lead: 0x7f878f,
  gold: 0xd9ac3c,
  policeBlue: 0x1d4f9c,
  navy: 0x1a2b4f,
  fireRed: 0xb5231d,
  brick: 0x9a4a35,
  brickDark: 0x7a3a2a,
  hospitalWhite: 0xf1f0ec,
  crossRed: 0xe3261f,
  schoolBrick: 0xb86b45,
  schoolYellow: 0xf3b714,
  busYellow: 0xf2b300,
  concrete: 0xbdb9b0,
  concreteLight: 0xd6d2c8,
  asphalt: 0x38393c,
  gravel: 0xb3aa98,
  glassDark: 0x1c232c,
  trim: 0xf4f1e8,
  bronze: 0x6b5a3a,
  army: 0x6b6e4a,
  armyTan: 0xb9a57a,
  jetGrey: 0x8e979f,
};

// ---------------------------------------------------------------------------------------------- winding helpers
function crossN(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** triangle oriented so its normal points along `hint` */
export function triH(b: ModelBuilder, a: V3, c1: V3, c2: V3, hint: V3) {
  if (dot(crossN(a, c1, c2), hint) >= 0) b.tri(a, c1, c2);
  else b.tri(a, c2, c1);
}
/** quad oriented so its normal points along `hint` */
export function quadH(b: ModelBuilder, a: V3, c1: V3, c2: V3, d: V3, hint: V3) {
  if (dot(crossN(a, c1, c2), hint) >= 0) b.quad(a, c1, c2, d);
  else b.quad(d, c2, c1, a);
}
/** smooth-shaded triangle (per-vertex normals), winding fixed from the normals */
export function triS(b: ModelBuilder, a: V3, c1: V3, c2: V3, na: V3, n1: V3, n2: V3) {
  const hint: V3 = [na[0] + n1[0] + n2[0], na[1] + n1[1] + n2[1], na[2] + n1[2] + n2[2]];
  if (dot(crossN(a, c1, c2), hint) >= 0) b.triN(a, c1, c2, na, n1, n2);
  else b.triN(a, c2, c1, na, n2, n1);
}

// ---------------------------------------------------------------------------------------------- flat ground pieces
/** Up-facing rectangle (decal / marking) at height y. 2 tris. */
export function flat(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number) {
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (z0 > z1) [z0, z1] = [z1, z0];
  b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
}
/** Up-facing stripe between two ground points, width w. 2 tris. */
export function stripe(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, w: number, y: number) {
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const nx = (-(bz - az) / len) * (w / 2), nz = ((bx - ax) / len) * (w / 2);
  quadH(b, [ax + nx, y, az + nz], [bx + nx, y, bz + nz], [bx - nx, y, bz - nz], [ax - nx, y, az - nz], [0, 1, 0]);
}
/** Up-facing disc. seg tris. */
export function disc(b: ModelBuilder, cx: number, cz: number, r: number, seg: number, y: number) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    b.tri([cx, y, cz], [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r]);
  }
}
/** Up-facing ring (annulus) or arc of a ring. 2*seg tris. */
export function annulus(b: ModelBuilder, cx: number, cz: number, r0: number, r1: number, seg: number, y: number, a0 = 0, a1 = Math.PI * 2) {
  for (let i = 0; i < seg; i++) {
    const t0 = a0 + ((a1 - a0) * i) / seg, t1 = a0 + ((a1 - a0) * (i + 1)) / seg;
    const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
    quadH(b, [cx + c0 * r0, y, cz + s0 * r0], [cx + c1 * r0, y, cz + s1 * r0], [cx + c1 * r1, y, cz + s1 * r1], [cx + c0 * r1, y, cz + s0 * r1], [0, 1, 0]);
  }
}
/** Thin raised slab of an arbitrary convex/concave polygon (x,z points). */
export function polySlab(b: ModelBuilder, pts: [number, number][], h: number, y0 = 0) {
  b.extrude(pts, y0, h);
}
/** Round thin slab (plaza / pool / fountain basin). */
export function roundSlab(b: ModelBuilder, cx: number, cz: number, r: number, seg: number, h: number, y0 = 0) {
  b.cylinder(cx, cz, y0, h, r, r, seg, { smooth: false });
}

// ---------------------------------------------------------------------------------------------- facade details
/** Vertical disc facing local +Z (after rotation by face). seg tris. */
export function vdisc(b: ModelBuilder, cx: number, cy: number, cz: number, r: number, seg: number, face: Face = 'pz') {
  b.push().translate(cx, cy, cz).rotateY(FACE_ROT[face]);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    b.tri([0, 0, 0], [Math.cos(a0) * r, Math.sin(a0) * r, 0], [Math.cos(a1) * r, Math.sin(a1) * r, 0]);
  }
  b.pop();
}
/** Vertical rectangle facing +Z in local space (x0..x1, y0..y1 at z), rotated by face around (px,pz). 2 tris. */
export function vrect(b: ModelBuilder, x0: number, y0: number, x1: number, y1: number, z: number) {
  b.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
}

/** Clock face (emissive dial, dark rim + hands) on a wall, ~30 tris. (cx,cy,cz) = dial center ON the wall surface. */
export function clockFace(b: ModelBuilder, cx: number, cy: number, cz: number, r: number, face: Face = 'pz', rim: ColorLike = 0x2b2b2b) {
  b.push().translate(cx, cy, cz).rotateY(FACE_ROT[face]);
  const seg = 14;
  b.paint(rim, Surf.Metal);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    b.tri([0, 0, 0.03], [Math.cos(a0) * r * 1.12, Math.sin(a0) * r * 1.12, 0.03], [Math.cos(a1) * r * 1.12, Math.sin(a1) * r * 1.12, 0.03]);
  }
  b.paint(0xfff3d6, Surf.Emissive);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    b.tri([0, 0, 0.06], [Math.cos(a0) * r, Math.sin(a0) * r, 0.06], [Math.cos(a1) * r, Math.sin(a1) * r, 0.06]);
  }
  // hands at ~10:10
  b.paint(0x1a1a1a, Surf.Plain);
  const hand = (ang: number, len: number, w: number) => {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const px = -dy * w, py = dx * w;
    b.quad([px, py, 0.09], [-px, -py, 0.09], [dx * len - px, dy * len - py, 0.09], [dx * len + px, dy * len + py, 0.09]);
  };
  hand(Math.PI * 0.83, r * 0.62, r * 0.07);
  hand(Math.PI * 0.2, r * 0.85, r * 0.05);
  b.pop();
}

/**
 * Window openings as quads on a +Z facing facade plane (local space), transformed by `face` around origin.
 * Draws a light frame quad + dark glass quad per window (4 tris each). Glass = GlassPlain (lit at night).
 */
export function windowsOnFace(
  b: ModelBuilder, face: Face, planeOffset: number, uFrom: number, uTo: number, y0: number, rows: number, floorH: number,
  cols: number, winW: number, winH: number, frame: ColorLike = CIV.trim, glass: ColorLike = 0x2a3440, sill = 0.9,
) {
  b.push().rotateY(FACE_ROT[face]);
  const span = uTo - uFrom;
  const pitch = span / cols;
  for (let r = 0; r < rows; r++) {
    const wy0 = y0 + r * floorH + sill, wy1 = wy0 + winH;
    for (let c = 0; c < cols; c++) {
      const cx = uFrom + pitch * (c + 0.5);
      b.paint(frame, Surf.Plain);
      vrect(b, cx - winW / 2 - 0.18, wy0 - 0.22, cx + winW / 2 + 0.18, wy1 + 0.18, planeOffset + 0.04);
      b.paint(glass, Surf.GlassPlain);
      vrect(b, cx - winW / 2, wy0, cx + winW / 2, wy1, planeOffset + 0.09);
    }
  }
  b.pop();
}

/** Door (dark glass with frame) on a face. */
export function doorOnFace(b: ModelBuilder, face: Face, planeOffset: number, u: number, w: number, h: number, frame: ColorLike = 0x3a3a3a, glass: ColorLike = 0x20262e, y0 = 0) {
  b.push().rotateY(FACE_ROT[face]);
  b.paint(frame, Surf.Metal);
  vrect(b, u - w / 2 - 0.2, y0, u + w / 2 + 0.2, y0 + h + 0.2, planeOffset + 0.04);
  b.paint(glass, Surf.GlassPlain);
  vrect(b, u - w / 2, y0, u + w / 2, y0 + h, planeOffset + 0.09);
  b.pop();
}

/** Row of columns along X (at z), with plinth and capital. ~36 tris per column. */
export function colonnade(b: ModelBuilder, x0: number, x1: number, z: number, y0: number, h: number, n: number, r: number, color: ColorLike = CIV.marble, seg = 8) {
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1);
    b.paint(color, Surf.Plain);
    b.boxC(x, z, r * 2.5, r * 2.5, y0, 0.35, { top: null });
    b.cylinder(x, z, y0 + 0.35, h - 0.75, r, r * 0.86, seg, { top: false });
    b.boxC(x, z, r * 2.6, r * 2.6, y0 + h - 0.4, 0.4, { top: null });
  }
}
/** Columns along Z (for side colonnades). */
export function colonnadeZ(b: ModelBuilder, x: number, z0: number, z1: number, y0: number, h: number, n: number, r: number, color: ColorLike = CIV.marble, seg = 8) {
  for (let i = 0; i < n; i++) {
    const z = n === 1 ? (z0 + z1) / 2 : z0 + ((z1 - z0) * i) / (n - 1);
    b.paint(color, Surf.Plain);
    b.boxC(x, z, r * 2.5, r * 2.5, y0, 0.35, { top: null });
    b.cylinder(x, z, y0 + 0.35, h - 0.75, r, r * 0.86, seg, { top: false });
    b.boxC(x, z, r * 2.6, r * 2.6, y0 + h - 0.4, 0.4, { top: null });
  }
}

/** Stair flight rising toward -Z: bottom step front edge at zFront. Returns z of the top landing edge. */
export function steps(b: ModelBuilder, cx: number, zFront: number, w: number, n: number, rise: number, run: number, color: ColorLike = CIV.limestone, zBack?: number): number {
  const zb = zBack ?? zFront - n * run - 0.5;
  b.paint(color, Surf.Stone);
  for (let i = 0; i < n; i++) {
    b.box(cx - w / 2, 0, zb, cx + w / 2, (i + 1) * rise, zFront - i * run, { nz: null });
  }
  return zFront - n * run;
}

/**
 * Classical portico on the +Z side: columns at zFront-ish, entablature and pediment (gable along Z).
 * w = width, depth = portico depth (toward -Z from zFront), y0 = floor level of the portico, colH = column height.
 */
export function portico(
  b: ModelBuilder, cx: number, zFront: number, w: number, depth: number, y0: number, colH: number, n: number,
  opts: { col?: ColorLike; stone?: ColorLike; roof?: ColorLike; pedH?: number; r?: number; seg?: number } = {},
) {
  const col = opts.col ?? CIV.marble, stone = opts.stone ?? CIV.limestone, roof = opts.roof ?? CIV.lead;
  const r = opts.r ?? Math.min(0.55, w / n / 5);
  const zc = zFront - 0.9;
  colonnade(b, cx - w / 2 + 1.0, cx + w / 2 - 1.0, zc, y0, colH, n, r, col, opts.seg ?? 8);
  // entablature (architrave + frieze + cornice)
  const ye = y0 + colH;
  b.paint(stone, Surf.Plain).box(cx - w / 2 + 0.2, ye, zFront - depth, cx + w / 2 - 0.2, ye + 1.1, zFront - 0.2, { nz: null });
  b.paint(CIV.trim, Surf.Plain).box(cx - w / 2, ye + 1.1, zFront - depth, cx + w / 2, ye + 1.45, zFront, { nz: null });
  // pediment (gable roof along Z)
  const pedH = opts.pedH ?? w * 0.18;
  b.paint(roof, Surf.RoofTiles).gableRoof(cx, zFront - depth / 2, w, depth, ye + 1.45, pedH, 'z', 0.15, pnt(stone, Surf.Stone));
  // tympanum inset shadow line
  b.paint(CIV.trim, Surf.Plain).box(cx - w / 2 + 0.1, ye + 1.45, zFront - 0.05, cx + w / 2 - 0.1, ye + 1.6, zFront + 0.12, { nz: null });
  return ye + 1.45 + pedH;
}

/**
 * Faceted drum (stone) with windows on alternating facets, then dome + lantern + finial.
 * Returns top height.
 */
export function domeOnDrum(
  b: ModelBuilder, cx: number, cz: number, y0: number, r: number,
  opts: { drumH?: number; seg?: number; dome?: ColorLike; domeSurf?: Surf; drum?: ColorLike; scaleY?: number; lantern?: boolean; colonnade?: boolean; clock?: boolean } = {},
): number {
  const seg = opts.seg ?? 16;
  const drumH = opts.drumH ?? r * 0.9;
  const drum = opts.drum ?? CIV.limestone;
  // base ring (stepped)
  b.paint(drum, Surf.Stone).cylinder(cx, cz, y0, 0.8, r + 0.9, r + 0.9, seg, { smooth: false });
  // peristyle columns ring
  if (opts.colonnade) {
    const n = seg;
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * (r + 0.55), z = cz + Math.sin(a) * (r + 0.55);
      b.paint(CIV.marble, Surf.Plain).cylinder(x, z, y0 + 0.8, drumH - 1.4, 0.26, 0.23, 6, { top: false });
    }
    b.paint(drum, Surf.Stone).cylinder(cx, cz, y0 + drumH - 0.6, 0.6, r + 0.9, r + 0.9, seg, { smooth: false });
  }
  // drum facets
  const rd = opts.colonnade ? r - 0.4 : r;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0: V3 = [cx + Math.cos(a0) * rd, y0 + 0.8, cz + Math.sin(a0) * rd];
    const p1: V3 = [cx + Math.cos(a1) * rd, y0 + 0.8, cz + Math.sin(a1) * rd];
    const am = (a0 + a1) / 2;
    const out: V3 = [Math.cos(am), 0, Math.sin(am)];
    b.paint(drum, Surf.Stone);
    quadH(b, p0, p1, [p1[0], y0 + drumH, p1[2]], [p0[0], y0 + drumH, p0[2]], out);
    if (i % 2 === 0) {
      // window: inset dark glass on the facet
      const t0 = 0.3, t1 = 0.7;
      const q0: V3 = [p0[0] + (p1[0] - p0[0]) * t0 + out[0] * 0.05, 0, p0[2] + (p1[2] - p0[2]) * t0 + out[2] * 0.05];
      const q1: V3 = [p0[0] + (p1[0] - p0[0]) * t1 + out[0] * 0.05, 0, p0[2] + (p1[2] - p0[2]) * t1 + out[2] * 0.05];
      const wy0 = y0 + 0.8 + drumH * 0.2, wy1 = y0 + drumH * 0.82;
      b.paint(0x2a3440, Surf.GlassPlain);
      quadH(b, [q0[0], wy0, q0[2]], [q1[0], wy0, q1[2]], [q1[0], wy1, q1[2]], [q0[0], wy1, q0[2]], out);
    }
  }
  const yd = y0 + drumH;
  // cornice ring
  b.paint(CIV.trim, Surf.Plain).cylinder(cx, cz, yd, 0.5, r + 0.35, r + 0.35, seg, { smooth: false });
  // dome
  const sy = opts.scaleY ?? 1.0;
  b.paint(opts.dome ?? CIV.copper, opts.domeSurf ?? Surf.RoofTiles).sphere(cx, yd + 0.5, cz, r, seg, 10, { hemi: true, scaleY: sy });
  let top = yd + 0.5 + r * sy;
  if (opts.lantern ?? true) {
    const lr = Math.max(0.6, r * 0.16);
    b.paint(drum, Surf.Stone).cylinder(cx, cz, top - 0.3, lr * 2.2, lr, lr, 8, { smooth: false, top: false });
    b.paint(0xfff0c8, Surf.Emissive).cylinder(cx, cz, top + lr * 0.5, lr * 1.0, lr * 0.8, lr * 0.8, 8, { top: false });
    b.paint(opts.dome ?? CIV.copper, Surf.Plain).cone(cx, cz, top - 0.3 + lr * 2.2, lr * 1.4, lr * 1.25, 8);
    top = top - 0.3 + lr * 3.6;
    b.paint(CIV.gold, Surf.Metal).cylinder(cx, cz, top, lr * 1.5, 0.07, 0.03, 4, { top: false });
    top += lr * 1.5;
  }
  return top;
}

/**
 * Barrel vault roof. axis 'x': ridge along X, arc spans Z (width d). Smooth-shaded. endPaint: fill the end
 * arches (null = no ends). Tris: seg*2 + 2*seg (ends).
 */
export function vault(b: ModelBuilder, cx: number, cz: number, w: number, d: number, y0: number, rise: number, seg: number, roof: Paint, endPaint: Paint | null, axis: 'x' | 'z' = 'x') {
  const s = (axis === 'x' ? d : w) / 2;
  const L = (axis === 'x' ? w : d) / 2;
  const R = (s * s + rise * rise) / (2 * rise);
  const yc = y0 + rise - R;
  const phi = Math.asin(Math.min(1, s / R));
  const P = (t: number, l: number): V3 => {
    const ph = -phi + (2 * phi * t);
    const across = Math.sin(ph) * R, y = yc + Math.cos(ph) * R;
    return axis === 'x' ? [cx + l, y, cz + across] : [cx + across, y, cz + l];
  };
  const N = (t: number): V3 => {
    const ph = -phi + (2 * phi * t);
    return axis === 'x' ? [0, Math.cos(ph), Math.sin(ph)] : [Math.sin(ph), Math.cos(ph), 0];
  };
  b.paint(roof);
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg;
    const a = P(t0, -L), bb = P(t1, -L), c = P(t1, L), dd = P(t0, L);
    const n0 = N(t0), n1 = N(t1);
    triS(b, a, bb, c, n0, n1, n1);
    triS(b, a, c, dd, n0, n1, n0);
  }
  if (endPaint) {
    b.paint(endPaint);
    for (const side of [-1, 1]) {
      const hint: V3 = axis === 'x' ? [side, 0, 0] : [0, 0, side];
      const base: V3 = axis === 'x' ? [cx + side * L, y0, cz] : [cx, y0, cz + side * L];
      for (let i = 0; i < seg; i++) {
        triH(b, base, P(i / seg, side * L), P((i + 1) / seg, side * L), hint);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------- service signage
/** Red cross sign: white panel + emissive red cross, facing `face`. s = panel size. ~22 tris */
export function redCross(b: ModelBuilder, cx: number, cy: number, cz: number, s: number, face: Face = 'pz', panel: ColorLike | null = 0xffffff) {
  b.push().translate(cx, cy, cz).rotateY(FACE_ROT[face]);
  if (panel !== null) b.paint(panel, Surf.Plain).box(-s / 2, -s / 2, -0.1, s / 2, s / 2, 0.1);
  b.paint(CIV.crossRed, Surf.Emissive);
  const a = s * 0.36, t = s * 0.12, z = 0.13;
  vrect(b, -t, -a, t, a, z);
  vrect(b, -a, -t, -t, t, z);
  vrect(b, t, -t, a, t, z);
  b.pop();
}

/** Helipad at height y: dark pad, yellow ring, white H, corner lights. ~60 tris */
export function helipad(b: ModelBuilder, cx: number, cz: number, y: number, r: number) {
  b.paint(0x4a4d52, Surf.Pavement);
  b.cylinder(cx, cz, y, 0.12, r, r, 16, { smooth: false });
  b.paint(0xf2c230, Surf.Plain);
  annulus(b, cx, cz, r * 0.72, r * 0.82, 16, y + 0.13);
  b.paint(0xf5f5f5, Surf.Plain);
  const hs = r * 0.42, hw = r * 0.12;
  flat(b, cx - hs, cz - hs, cx - hs + hw, cz + hs, y + 0.14);
  flat(b, cx + hs - hw, cz - hs, cx + hs, cz + hs, y + 0.14);
  flat(b, cx - hs + hw, cz - hw / 2, cx + hs - hw, cz + hw / 2, y + 0.14);
  b.paint(0x7dff6a, Surf.Emissive);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.boxC(cx + Math.cos(a) * r * 0.93, cz + Math.sin(a) * r * 0.93, 0.3, 0.3, y + 0.12, 0.2);
  }
}

/** Flag on a pole with horizontal stripes and a slight wave. ~26 tris + 8/stripe */
export function flag(b: ModelBuilder, x: number, z: number, h: number, colors: ColorLike[], y0 = 0, size = 1) {
  b.paint(0xe2e2e2, Surf.Metal).cylinder(x, z, y0, h, 0.09 * size, 0.06 * size, 5);
  b.paint(CIV.gold, Surf.Metal).boxC(x, z, 0.2 * size, 0.2 * size, y0 + h, 0.2 * size);
  const fw = 2.3 * size, fh = 1.45 * size;
  const top = y0 + h - 0.15;
  const n = colors.length;
  for (let i = 0; i < n; i++) {
    const ya = top - (fh * i) / n, yb = top - (fh * (i + 1)) / n;
    b.paint(colors[i], Surf.Plain);
    b.quad2([x, yb, z], [x + fw * 0.5, yb, z + 0.22 * size], [x + fw * 0.5, ya, z + 0.22 * size], [x, ya, z]);
    b.quad2([x + fw * 0.5, yb, z + 0.22 * size], [x + fw, yb, z], [x + fw, ya, z], [x + fw * 0.5, ya, z + 0.22 * size]);
  }
}

/** Stripe presets for flags */
export const FLAGS = {
  nation: [0xb22234, 0xf4f4f4, 0x2a3f7a] as ColorLike[],
  city: [0x2e6fb5, 0xf4f4f4, 0x2e6fb5] as ColorLike[],
  police: [0x1d3f8c, 0x1d3f8c] as ColorLike[],
  fire: [0xc0271f, 0xf2f2f2, 0xc0271f] as ColorLike[],
  school: [0x2a6f3a, 0xf3c200] as ColorLike[],
  college: [0x7a1f2b, 0xe8d9a8] as ColorLike[],
  military: [0x4a5a2e, 0x4a5a2e, 0xd9c26a] as ColorLike[],
  casino: [0xd41c8c, 0xf2c230] as ColorLike[],
};

/** Emissive sign panel on a +Z/face wall: frame + glowing face. ~12 tris */
export function wallSign(b: ModelBuilder, cx: number, cy: number, cz: number, w: number, h: number, color: ColorLike, face: Face = 'pz', frame: ColorLike = 0x222222, band?: ColorLike) {
  b.push().translate(cx, cy, cz).rotateY(FACE_ROT[face]);
  b.paint(frame, Surf.Metal).box(-w / 2 - 0.1, -h / 2 - 0.1, 0, w / 2 + 0.1, h / 2 + 0.1, 0.18);
  b.paint(color, Surf.Emissive);
  vrect(b, -w / 2, -h / 2, w / 2, h / 2, 0.2);
  if (band !== undefined) {
    b.paint(band, Surf.Emissive);
    vrect(b, -w / 2 + 0.15, -h * 0.12, w / 2 - 0.15, h * 0.12, 0.22);
  }
  b.pop();
}

/** Standing monument sign / pylon at the lot front with an emissive panel on both faces. */
export function pylonSign(b: ModelBuilder, x: number, z: number, w: number, h: number, color: ColorLike, base: ColorLike = CIV.granite, top = 1.8) {
  b.paint(base, Surf.Stone).boxC(x, z, w + 0.4, 0.7, 0, 0.5);
  b.paint(base, Surf.Plain).boxC(x, z, w, 0.5, 0.5, h);
  b.paint(color, Surf.Emissive);
  vrect(b, x - w / 2 + 0.2, 0.5 + h - top, x + w / 2 - 0.2, 0.5 + h - 0.25, z + 0.27);
  b.quad([x + w / 2 - 0.2, 0.5 + h - top, z - 0.27], [x - w / 2 + 0.2, 0.5 + h - top, z - 0.27], [x - w / 2 + 0.2, 0.5 + h - 0.25, z - 0.27], [x + w / 2 - 0.2, 0.5 + h - 0.25, z - 0.27]);
}

// ---------------------------------------------------------------------------------------------- fences & walls
/** Security fence: posts + mesh panel (corrugated look) + top rail. ~4 tris panel + 8/post */
export function meshFence(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, h = 2.4, color: ColorLike = 0x8f969c, post: ColorLike = 0x5a5f64, spacing = 3.5) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / spacing));
  b.paint(post, Surf.Metal);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    b.box(x - 0.06, 0, z - 0.06, x + 0.06, h + 0.1, z + 0.06, { top: null });
  }
  b.paint(color, Surf.Corrugated);
  b.quad2([ax, 0.08, az], [bx, 0.08, bz], [bx, h, bz], [ax, h, az]);
  b.paint(post, Surf.Metal);
  b.beam([ax, h, az], [bx, h, bz], 0.07);
}
/** Closed fence loop around rect */
export function meshFenceRect(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h = 2.4, color?: ColorLike, post?: ColorLike, gap?: [number, number]) {
  meshFence(b, x0, z0, x1, z0, h, color, post);
  meshFence(b, x1, z0, x1, z1, h, color, post);
  meshFence(b, x0, z0, x0, z1, h, color, post);
  if (gap) {
    meshFence(b, x0, z1, gap[0], z1, h, color, post);
    meshFence(b, gap[1], z1, x1, z1, h, color, post);
  } else meshFence(b, x0, z1, x1, z1, h, color, post);
}
/** Iron railing fence (dark posts + 2 rails). */
export function ironFence(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, h = 1.6, color: ColorLike = 0x23262a, spacing = 3.2) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / spacing));
  b.paint(color, Surf.Metal);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    b.box(x - 0.06, 0, z - 0.06, x + 0.06, h, z + 0.06, { bottom: null, top: null });
  }
  b.beam([ax, h * 0.9, az], [bx, h * 0.9, bz], 0.06);
  b.beam([ax, 0.25, az], [bx, 0.25, bz], 0.06);
  b.paint(color, Surf.Plain).quad2([ax, 0.3, az], [bx, 0.3, bz], [bx, h * 0.85, bz], [ax, h * 0.85, az]);
}

/** Stone gate pier with lamp/cap. */
export function gatePier(b: ModelBuilder, x: number, z: number, h = 2.4, color: ColorLike = CIV.limestone) {
  b.paint(color, Surf.Stone).boxC(x, z, 0.9, 0.9, 0, h);
  b.paint(CIV.trim, Surf.Plain).boxC(x, z, 1.1, 1.1, h, 0.25);
  b.paint(0xfff0c8, Surf.Emissive).boxC(x, z, 0.4, 0.4, h + 0.25, 0.45);
}

// ---------------------------------------------------------------------------------------------- vegetation
/** Round deciduous tree ~34 tris */
export function tree(b: ModelBuilder, rng: RNG, x: number, z: number, s = 1, color?: ColorLike) {
  const k = s * rng.range(0.85, 1.15);
  b.paint(PALETTE.trunk, Surf.Wood).cylinder(x, z, 0, 2.4 * k, 0.22 * k, 0.15 * k, 5, { top: false });
  const g = color ?? rng.pick([0x4f7a32, 0x5a8a3a, 0x486f30, 0x66903d]);
  b.paint(g, Surf.Foliage).blob(x, 3.9 * k, z, 2.3 * k, 2.0 * k, 2.3 * k, 0, 0.16, rng.next() * 10);
}
/** Columnar cypress ~16 tris */
export function cypress(b: ModelBuilder, rng: RNG, x: number, z: number, s = 1) {
  const k = s * rng.range(0.85, 1.15);
  b.paint(0x2c4f2a, Surf.Foliage).cylinder(x, z, 0, 6.5 * k, 0.75 * k, 0.1, 7, { top: false });
}
/** Conifer ~14 tris */
export function conifer(b: ModelBuilder, rng: RNG, x: number, z: number, s = 1) {
  const k = s * rng.range(0.85, 1.15);
  b.paint(PALETTE.trunk, Surf.Wood).cylinder(x, z, 0, 1.2 * k, 0.2 * k, 0.2 * k, 4, { top: false });
  b.paint(0x2f5a2e, Surf.Foliage).cone(x, z, 1.0 * k, 6.0 * k, 1.9 * k, 7);
}
/** Palm tree ~40 tris */
export function palm(b: ModelBuilder, rng: RNG, x: number, z: number, s = 1) {
  const k = s * rng.range(0.9, 1.15);
  const h = 7.5 * k;
  const lean = rng.range(-0.5, 0.5);
  b.paint(0x7a6448, Surf.Wood).pipe([x, 0, z], [x + lean, h, z + lean * 0.4], 0.22 * k, 5);
  const tx = x + lean, tz = z + lean * 0.4;
  b.paint(0x3f7a2e, Surf.Foliage);
  const n = 7;
  const a0 = rng.next() * 6;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz * 0.45 * k, pz = dx * 0.45 * k;
    const mid: V3 = [tx + dx * 1.8 * k, h + 0.3 * k, tz + dz * 1.8 * k];
    const tip: V3 = [tx + dx * 3.3 * k, h - 1.2 * k, tz + dz * 3.3 * k];
    b.tri([tx, h, tz], [mid[0] + px, mid[1], mid[2] + pz], tip);
    b.tri([tx, h, tz], tip, [mid[0] - px, mid[1], mid[2] - pz]);
    b.tri([tx, h, tz], tip, [mid[0] + px, mid[1], mid[2] + pz]);
    b.tri([tx, h, tz], [mid[0] - px, mid[1], mid[2] - pz], tip);
  }
}
/** Flower bed (colored foliage slab with a stone curb) */
export function flowerBed(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, color: ColorLike = 0xd0485a, alt: ColorLike = 0xf2efe6) {
  b.paint(CIV.concreteLight, Surf.Plain).box(x0, 0, z0, x1, 0.35, z1);
  b.paint(0x4f7f36, Surf.Foliage).box(x0 + 0.2, 0.35, z0 + 0.2, x1 - 0.2, 0.45, z1 - 0.2, { bottom: null });
  // rows of flowers along the long axis, alternating two colors
  const alongX = x1 - x0 >= z1 - z0;
  const span = alongX ? z1 - z0 - 0.6 : x1 - x0 - 0.6;
  const n = Math.max(1, Math.min(4, Math.floor(span / 0.9)));
  const pitch = span / n;
  for (let i = 0; i < n; i++) {
    b.paint(i % 2 ? alt : color, Surf.Foliage);
    const a = (alongX ? z0 : x0) + 0.3 + i * pitch + pitch * 0.18, c = a + pitch * 0.64;
    if (alongX) b.box(x0 + 0.45, 0.45, a, x1 - 0.45, 0.72, c, { bottom: null });
    else b.box(a, 0.45, z0 + 0.45, c, 0.72, z1 - 0.45, { bottom: null });
  }
}
/** Round planter with small shrub */
export function planter(b: ModelBuilder, x: number, z: number, r = 0.8) {
  b.paint(CIV.concrete, Surf.Plain).cylinder(x, z, 0, 0.6, r, r, 8, { smooth: false });
  b.paint(0x4d7a36, Surf.Foliage).blob(x, 1.0, z, r * 0.9, r * 0.7, r * 0.9, 0, 0.15, x + z);
}
/** Hedge */
export function hedgeBox(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h = 1.0, color: ColorLike = PALETTE.hedge) {
  b.paint(color, Surf.Foliage).box(x0, 0, z0, x1, h, z1, { bottom: null });
}

// ---------------------------------------------------------------------------------------------- site furniture
export function lamp(b: ModelBuilder, x: number, z: number, h = 4.5, color: ColorLike = 0x2a2c2e) {
  b.paint(color, Surf.Metal).cylinder(x, z, 0, h, 0.09, 0.06, 5, { top: false });
  b.paint(0xfff0c8, Surf.Emissive).boxC(x, z, 0.4, 0.4, h, 0.45);
  b.paint(color, Surf.Metal).boxC(x, z, 0.55, 0.55, h + 0.45, 0.12, { bottom: null });
}
export function benchAt(b: ModelBuilder, x: number, z: number, rot = 0) {
  b.push().translate(x, 0, z).rotateY(rot);
  b.paint(0x7a5a3a, Surf.Wood).box(-0.9, 0.42, -0.25, 0.9, 0.5, 0.25).box(-0.9, 0.5, -0.3, 0.9, 0.95, -0.22, { bottom: null });
  b.paint(0x333333, Surf.Metal).box(-0.8, 0, -0.2, -0.7, 0.42, 0.2, { top: null }).box(0.7, 0, -0.2, 0.8, 0.42, 0.2, { top: null });
  b.pop();
}
/** Fountain: basin, water, central jet column. ~70 tris */
export function fountain(b: ModelBuilder, cx: number, cz: number, r: number, tiers = 2, stone: ColorLike = CIV.limestone) {
  b.paint(stone, Surf.Stone).cylinder(cx, cz, 0, 0.6, r, r, 16, { smooth: false, top: false });
  b.paint(stone, Surf.Plain);
  annulus(b, cx, cz, r - 0.35, r, 16, 0.6);
  b.paint(0x4a8fb8, Surf.Water);
  disc(b, cx, cz, r - 0.35, 16, 0.45);
  let y = 0.45, rr = r * 0.45;
  for (let t = 0; t < tiers; t++) {
    b.paint(stone, Surf.Stone).cylinder(cx, cz, y, 1.0, 0.25 * (tiers - t + 1), 0.2 * (tiers - t + 1), 8);
    y += 1.0;
    b.paint(stone, Surf.Plain).cylinder(cx, cz, y, 0.25, rr, rr * 1.05, 10, { smooth: false });
    b.paint(0x5aa0c8, Surf.Water);
    disc(b, cx, cz, rr * 0.9, 10, y + 0.26);
    rr *= 0.55;
  }
  b.paint(0xd8eef8, Surf.Water).cylinder(cx, cz, y, 1.2, 0.12, 0.05, 6, { top: false });
}

// ---------------------------------------------------------------------------------------------- vehicles (cheap)
/** Cheap car ~24 tris */
export function miniCar(b: ModelBuilder, x: number, z: number, rot: number, color: ColorLike, y = 0.08) {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(color, Surf.Metal).box(-0.88, 0.22, -2.2, 0.88, 0.88, 2.2);
  b.paint(0x1a1f26, Surf.GlassPlain).box(-0.78, 0.88, -1.1, 0.78, 1.36, 0.95, { top: pnt(color, Surf.Metal) });
  b.paint(0x151515, Surf.Plain).box(-0.84, 0, -1.7, 0.84, 0.3, 1.7, { top: null, pz: null, nz: null });
  b.pop();
}
export const CAR_COLS: ColorLike[] = [0xb8bcc2, 0x2b2d31, 0xf1f1ef, 0x8a1c1c, 0x1f3f7a, 0x5d6b73, 0x3e5e3a, 0xc9a13b, 0x6b2f4a, 0x9aa3ab];

/** Parking lot with stall lines; stalls along X in rows (cars face ±Z). Returns number of cars. */
export function parking(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, fill = 0.6, colors: ColorLike[] = CAR_COLS, asphalt: ColorLike = CIV.asphalt, surface = true) {
  if (surface) b.paint(asphalt, Surf.Pavement).slab(x0, z0, x1, z1, 0.08);
  const stallW = 2.7, stallD = 5.0, aisle = 6.0;
  const rowPitch = stallD * 2 + aisle;
  let cars = 0;
  for (let rz = z0 + 0.5; rz + stallD <= z1 - 0.3; rz += rowPitch) {
    for (const [zA, facing] of [[rz, 0], [rz + stallD + aisle, Math.PI]] as [number, number][]) {
      if (zA + stallD > z1 - 0.3) continue;
      b.paint(0xeeeeee, Surf.Plain);
      for (let sx = x0 + 0.5; sx <= x1 - 0.4 + 1e-6; sx += stallW) flat(b, sx - 0.07, zA, sx + 0.07, zA + stallD, 0.1);
      for (let sx = x0 + 0.5; sx + stallW <= x1 - 0.4 + 1e-6; sx += stallW) {
        if (rng.chance(fill)) {
          miniCar(b, sx + stallW / 2, zA + stallD / 2, facing + rng.range(-0.05, 0.05), rng.pick(colors), 0.08);
          cars++;
        }
      }
    }
  }
  return cars;
}
/** Parking lot rotated: stalls along Z in columns (cars face ±X). */
export function parkingZ(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, fill = 0.6, colors: ColorLike[] = CAR_COLS, surface = true) {
  if (surface) b.paint(CIV.asphalt, Surf.Pavement).slab(x0, z0, x1, z1, 0.08);
  const stallW = 2.7, stallD = 5.0, aisle = 6.0;
  const pitch = stallD * 2 + aisle;
  for (let rx = x0 + 0.5; rx + stallD <= x1 - 0.3; rx += pitch) {
    for (const [xA, facing] of [[rx, Math.PI / 2], [rx + stallD + aisle, -Math.PI / 2]] as [number, number][]) {
      if (xA + stallD > x1 - 0.3) continue;
      b.paint(0xeeeeee, Surf.Plain);
      for (let sz = z0 + 0.5; sz <= z1 - 0.4 + 1e-6; sz += stallW) flat(b, xA, sz - 0.07, xA + stallD, sz + 0.07, 0.1);
      for (let sz = z0 + 0.5; sz + stallW <= z1 - 0.4 + 1e-6; sz += stallW) {
        if (rng.chance(fill)) miniCar(b, xA + stallD / 2, sz + stallW / 2, facing + rng.range(-0.05, 0.05), rng.pick(colors), 0.08);
      }
    }
  }
}

/** Police cruiser (white w/ navy doors, red/blue emissive light bar) ~52 tris */
export function cruiser(b: ModelBuilder, x: number, z: number, rot: number, y = 0.08) {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(0xf3f3f1, Surf.Metal).box(-0.9, 0.22, -2.35, 0.9, 0.9, 2.35);
  b.paint(CIV.navy, Surf.Metal).box(-0.92, 0.32, -1.2, 0.92, 0.84, 1.1, { top: null, pz: null, nz: null });
  b.paint(0x151a20, Surf.GlassPlain).box(-0.8, 0.9, -1.15, 0.8, 1.38, 0.95, { top: pnt(0xf3f3f1, Surf.Metal) });
  b.paint(0xff2a2a, Surf.Emissive).box(-0.62, 1.38, -0.2, -0.02, 1.52, 0.12);
  b.paint(0x2a5cff, Surf.Emissive).box(0.02, 1.38, -0.2, 0.62, 1.52, 0.12);
  b.paint(0x151515, Surf.Plain).box(-0.85, 0, -1.75, 0.85, 0.3, 1.75, { top: null, pz: null, nz: null });
  b.pop();
}

/** Fire engine (red, ladder on top) ~100 tris; length ~9.6 along local Z. */
export function fireEngine(b: ModelBuilder, x: number, z: number, rot: number, ladder = true, y = 0.1) {
  b.push().translate(x, y, z).rotateY(rot);
  const red = 0xc4211b;
  b.paint(red, Surf.Metal).box(-1.25, 0.4, -4.8, 1.25, 2.7, 2.3);
  b.paint(red, Surf.Metal).box(-1.25, 0.4, 2.3, 1.25, 2.95, 4.8);
  b.paint(0x151a20, Surf.GlassPlain);
  vrect(b, -1.1, 1.75, 1.1, 2.75, 4.82);
  b.push().rotateY(Math.PI / 2);
  vrect(b, -4.6, 1.75, -2.6, 2.75, 1.27);
  b.pop();
  b.push().rotateY(-Math.PI / 2);
  vrect(b, 2.6, 1.75, 4.6, 2.75, 1.27);
  b.pop();
  b.paint(0xf2f2f2, Surf.Plain).box(-1.27, 1.2, -4.82, 1.27, 1.42, 4.82, { top: null });
  b.paint(0xd8d8d8, Surf.Metal).box(-1.2, 0.35, 4.8, 1.2, 0.8, 5.0);
  b.paint(0xff2a2a, Surf.Emissive).box(-0.9, 2.95, 3.8, 0.9, 3.15, 4.2);
  if (ladder) {
    b.paint(0xcfd3d6, Surf.Metal);
    b.box(-0.75, 2.9, -4.9, -0.55, 3.2, 3.2, { bottom: null });
    b.box(0.55, 2.9, -4.9, 0.75, 3.2, 3.2, { bottom: null });
    for (let i = 0; i < 5; i++) {
      const zz = -4.4 + i * 1.8;
      b.box(-0.55, 3.0, zz, 0.55, 3.1, zz + 0.12, { bottom: null, px: null, nx: null });
    }
  } else {
    b.paint(0xd8d8d8, Surf.Metal).box(-1.0, 2.7, -4.4, 1.0, 3.0, 1.8, { bottom: null });
  }
  b.paint(0x151515, Surf.Plain).box(-1.2, 0, -4.0, 1.2, 0.45, 4.0, { top: null, pz: null, nz: null });
  b.pop();
}

/** Ambulance (white, red stripe, light bar) ~60 tris; length ~6.4 */
export function ambulance(b: ModelBuilder, x: number, z: number, rot: number, y = 0.08) {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(0xf6f6f4, Surf.Metal).box(-1.1, 0.35, -3.2, 1.1, 2.8, 1.2);
  b.paint(0xf6f6f4, Surf.Metal).box(-1.0, 0.35, 1.2, 1.0, 2.0, 3.2);
  b.paint(0x151a20, Surf.GlassPlain);
  vrect(b, -0.9, 1.3, 0.9, 1.95, 3.22);
  b.paint(CIV.crossRed, Surf.Plain).box(-1.12, 1.25, -3.22, 1.12, 1.55, 1.22, { top: null, pz: null });
  b.paint(0xff2020, Surf.Emissive).box(-1.0, 2.8, 0.9, -0.5, 2.98, 1.15).box(0.5, 2.8, 0.9, 1.0, 2.98, 1.15);
  b.paint(0x2a5cff, Surf.Emissive).box(-0.3, 2.8, 0.9, 0.3, 2.98, 1.15);
  b.paint(0x151515, Surf.Plain).box(-1.05, 0, -2.4, 1.05, 0.4, 2.4, { top: null, pz: null, nz: null });
  b.pop();
}

/** Bus (city or school) ~50 tris; length 11-12 along local Z. */
export function bus(b: ModelBuilder, x: number, z: number, rot: number, color: ColorLike, school = false, y = 0.08, band: ColorLike = 0x151a20) {
  b.push().translate(x, y, z).rotateY(rot);
  const L = school ? 10.6 : 11.8;
  const zb = -L / 2, zf = L / 2 - (school ? 1.3 : 0);
  b.paint(color, Surf.Metal).box(-1.25, 0.4, zb, 1.25, 3.05, zf);
  if (school) b.paint(color, Surf.Metal).box(-1.15, 0.4, zf, 1.15, 1.7, L / 2);
  b.paint(band, Surf.GlassPlain).box(-1.27, 1.75, zb + 0.6, 1.27, 2.65, zf - 0.3, { top: null });
  b.paint(0x151a20, Surf.GlassPlain);
  vrect(b, -1.1, 1.3, 1.1, 2.7, zf + 0.02);
  if (school) b.paint(0x1a1a1a, Surf.Plain).box(-1.27, 1.05, zb - 0.02, 1.27, 1.25, zf + 0.02, { top: null });
  else b.paint(0xe8e8e8, Surf.Metal).box(-0.9, 3.05, zb + 1.5, 0.9, 3.35, zb + 4.5, { bottom: null });
  b.paint(0x151515, Surf.Plain).box(-1.2, 0, zb + 1.5, 1.2, 0.45, zf - 1.2, { top: null, pz: null, nz: null });
  b.pop();
}

/** Fighter jet ~70 tris; nose toward local +Z, length ~15 m. */
export function jet(b: ModelBuilder, x: number, z: number, rot: number, color: ColorLike = CIV.jetGrey, y = 0) {
  b.push().translate(x, y, z).rotateY(rot);
  const fy = 1.6;
  b.paint(color, Surf.Metal);
  // fuselage (tapered prism along Z)
  b.push().translate(0, fy, 0).rotateX(Math.PI / 2);
  b.cylinder(0, 0, -6.5, 10.5, 0.75, 0.75, 6, { smooth: false, top: false, bottom: true });
  b.pop();
  b.push().translate(0, fy, 4.0).rotateX(Math.PI / 2);
  b.cone(0, 0, 0, 3.8, 0.75, 6, false);
  b.pop();
  // wings (delta) as thin extrusions
  const wing: [number, number][] = [[0.5, 2.5], [5.2, -3.2], [5.2, -4.2], [0.5, -4.0]];
  b.extrude(wing, fy - 0.1, 0.14);
  b.extrude(wing.map(([px, pz]) => [-px, pz] as [number, number]), fy - 0.1, 0.14);
  // tail planes
  const tail: [number, number][] = [[0.4, -4.6], [2.6, -6.4], [2.6, -6.9], [0.4, -6.5]];
  b.extrude(tail, fy - 0.05, 0.1);
  b.extrude(tail.map(([px, pz]) => [-px, pz] as [number, number]), fy - 0.05, 0.1);
  // twin fins
  for (const s of [-1, 1]) {
    b.quad2([s * 0.55, fy + 0.4, -4.3], [s * 0.55, fy + 0.4, -6.5], [s * 0.8, fy + 3.0, -6.8], [s * 0.8, fy + 3.0, -5.9]);
  }
  // canopy
  b.paint(0x1c2632, Surf.GlassPlain).blob(0, fy + 0.7, 3.0, 0.5, 0.45, 1.5, 0, 0.02, 3);
  // gear
  b.paint(0x222222, Surf.Plain).box(-1.2, 0, -1.8, 1.2, fy - 0.6, -1.2, { top: null }).box(-0.15, 0, 4.4, 0.15, fy - 0.6, 4.8, { top: null });
  b.pop();
}

/** Helicopter ~70 tris at height y (skids at y). nose local +Z. */
export function helicopter(b: ModelBuilder, x: number, y: number, z: number, rot: number, color: ColorLike, stripe?: ColorLike) {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(color, Surf.Metal).blob(0, 1.5, 0.4, 1.2, 1.1, 2.3, 0, 0.02, 5);
  b.paint(0x1c2632, Surf.GlassPlain).blob(0, 1.7, 1.6, 0.95, 0.75, 1.1, 0, 0.02, 7);
  b.paint(color, Surf.Metal).beam([0, 1.7, -1.5], [0, 2.1, -6.2], 0.45);
  b.box(-0.08, 2.0, -6.6, 0.08, 3.2, -5.8);
  if (stripe !== undefined) b.paint(stripe, Surf.Plain).box(-1.1, 1.25, -1.0, 1.1, 1.5, 1.8, { top: null, bottom: null, pz: null, nz: null });
  b.paint(0x2a2a2a, Surf.Metal);
  b.box(-1.0, 0, -1.2, -0.85, 0.12, 2.2, { bottom: null }).box(0.85, 0, -1.2, 1.0, 0.12, 2.2, { bottom: null });
  b.box(-0.9, 0.1, -0.5, 0.9, 0.45, -0.35, { bottom: null }).box(-0.9, 0.1, 1.2, 0.9, 0.45, 1.35, { bottom: null });
  b.cylinder(0, 0.4, 2.5, 0.5, 0.15, 0.15, 5);
  b.box(-0.2, 3.0, -5.3, 0.2, 3.06, 5.3, { bottom: null }).box(-5.3, 3.0, -0.2, 5.3, 3.06, 0.2, { bottom: null });
  b.pop();
}

// ---------------------------------------------------------------------------------------------- sports & play
/** Basketball court with lines and two hoops (long axis along X if alongX). ~70 tris */
export function basketballCourt(b: ModelBuilder, cx: number, cz: number, alongX = true, surface: ColorLike = 0x3f6f8f, key: ColorLike = 0xb5553a) {
  const L = 28, W = 15;
  const w = alongX ? L : W, d = alongX ? W : L;
  b.paint(0x5a5f63, Surf.Pavement).boxC(cx, cz, w + 2, d + 2, 0, 0.1);
  b.paint(surface, Surf.Plain).boxC(cx, cz, w, d, 0.1, 0.03, { pz: null, nz: null, px: null, nx: null });
  b.paint(0xf2f2f2, Surf.Plain);
  const y = 0.15;
  const lw = 0.12;
  flat(b, cx - w / 2, cz - d / 2, cx + w / 2, cz - d / 2 + lw, y);
  flat(b, cx - w / 2, cz + d / 2 - lw, cx + w / 2, cz + d / 2, y);
  flat(b, cx - w / 2, cz - d / 2, cx - w / 2 + lw, cz + d / 2, y);
  flat(b, cx + w / 2 - lw, cz - d / 2, cx + w / 2, cz + d / 2, y);
  if (alongX) flat(b, cx - lw / 2, cz - d / 2, cx + lw / 2, cz + d / 2, y);
  else flat(b, cx - w / 2, cz - lw / 2, cx + w / 2, cz + lw / 2, y);
  annulus(b, cx, cz, 1.7, 1.85, 12, y);
  b.paint(key, Surf.Plain);
  for (const s of [-1, 1]) {
    const a = s < 0 ? -L / 2 : L / 2 - 5.8;
    if (alongX) flat(b, cx + a, cz - 2.45, cx + a + 5.8, cz + 2.45, y - 0.01);
    else flat(b, cx - 2.45, cz + a, cx + 2.45, cz + a + 5.8, y - 0.01);
  }
  // hoops
  for (const s of [-1, 1]) {
    b.push().translate(alongX ? cx + s * (L / 2 + 0.6) : cx, 0, alongX ? cz : cz + s * (L / 2 + 0.6)).rotateY(alongX ? (s > 0 ? -Math.PI / 2 : Math.PI / 2) : (s > 0 ? Math.PI : 0));
    b.paint(0x333333, Surf.Metal).box(-0.1, 0, -0.1, 0.1, 3.3, 0.1, { bottom: null });
    b.paint(0xf5f5f5, Surf.Plain).box(-0.9, 2.9, 0.9, 0.9, 3.95, 1.0);
    b.paint(0xe86a1a, Surf.Metal).box(-0.25, 3.0, 1.0, 0.25, 3.05, 1.5, { bottom: null });
    b.paint(0x333333, Surf.Metal).box(-0.06, 3.1, 0.1, 0.06, 3.2, 0.9, { bottom: null });
    b.pop();
  }
}
/** Tennis court along Z with net. ~40 tris */
export function tennisCourt(b: ModelBuilder, cx: number, cz: number, surface: ColorLike = 0x4f7f5a, outer: ColorLike = 0x3f6b8a) {
  const L = 23.8, W = 11;
  b.paint(outer, Surf.Pavement).boxC(cx, cz, W + 5, L + 6, 0, 0.1);
  b.paint(surface, Surf.Plain);
  flat(b, cx - W / 2, cz - L / 2, cx + W / 2, cz + L / 2, 0.12);
  b.paint(0xf2f2f2, Surf.Plain);
  const y = 0.13, lw = 0.1;
  flat(b, cx - W / 2, cz - L / 2, cx + W / 2, cz - L / 2 + lw, y);
  flat(b, cx - W / 2, cz + L / 2 - lw, cx + W / 2, cz + L / 2, y);
  flat(b, cx - W / 2, cz - L / 2, cx - W / 2 + lw, cz + L / 2, y);
  flat(b, cx + W / 2 - lw, cz - L / 2, cx + W / 2, cz + L / 2, y);
  flat(b, cx - lw / 2, cz - 6.4, cx + lw / 2, cz + 6.4, y);
  flat(b, cx - W / 2, cz - 6.4, cx + W / 2, cz - 6.4 + lw, y);
  flat(b, cx - W / 2, cz + 6.4 - lw, cx + W / 2, cz + 6.4, y);
  b.paint(0x222222, Surf.Plain).quad2([cx - W / 2 - 0.5, 0.1, cz], [cx + W / 2 + 0.5, 0.1, cz], [cx + W / 2 + 0.5, 1.0, cz], [cx - W / 2 - 0.5, 1.0, cz]);
}
/**
 * Running track (stadium oval, straights along X) with a football field inside.
 * straight = length of straight, r = inner radius of the bends, lanes width lw.
 */
export function runningTrack(b: ModelBuilder, cx: number, cz: number, straight: number, r: number, lw = 5, trackColor: ColorLike = 0xa8452f) {
  const seg = 10;
  const y = 0.1;
  // base
  b.paint(trackColor, Surf.Pavement);
  b.box(cx - straight / 2, 0, cz - r - lw, cx + straight / 2, y, cz - r, { bottom: null });
  b.box(cx - straight / 2, 0, cz + r, cx + straight / 2, y, cz + r + lw, { bottom: null });
  annulus(b, cx + straight / 2, cz, r, r + lw, seg, y, -Math.PI / 2, Math.PI / 2);
  annulus(b, cx - straight / 2, cz, r, r + lw, seg, y, Math.PI / 2, Math.PI * 1.5);
  // lane lines
  b.paint(0xf0e8e0, Surf.Plain);
  for (const f of [0.33, 0.66]) {
    const rr = r + lw * f;
    flat(b, cx - straight / 2, cz - rr - 0.06, cx + straight / 2, cz - rr + 0.06, y + 0.025);
    flat(b, cx - straight / 2, cz + rr - 0.06, cx + straight / 2, cz + rr + 0.06, y + 0.025);
  }
  // infield grass
  b.paint(0x5f9a3e, Surf.Foliage);
  b.box(cx - straight / 2, 0, cz - r, cx + straight / 2, y, cz + r, { bottom: null });
  for (const s of [-1, 1]) {
    for (let i = 0; i < seg; i++) {
      const a0 = -Math.PI / 2 + (Math.PI * i) / seg, a1 = -Math.PI / 2 + (Math.PI * (i + 1)) / seg;
      const ox = cx + s * straight / 2;
      triH(b, [ox, y, cz], [ox + s * Math.cos(a0) * r, y, cz + Math.sin(a0) * r], [ox + s * Math.cos(a1) * r, y, cz + Math.sin(a1) * r], [0, 1, 0]);
    }
  }
  // football field markings (field ~ straight wide x 2r*0.8 deep)
  const fd = r * 1.5;
  const L = straight / 2 + Math.sqrt(Math.max(0, r * r - (fd / 2) * (fd / 2))) - 0.6;
  const ez = L * 0.15;
  const fw = (L - ez) * 2;
  b.paint(0xf5f5f5, Surf.Plain);
  const yl = y + 0.03;
  flat(b, cx - fw / 2, cz - fd / 2, cx + fw / 2, cz - fd / 2 + 0.15, yl);
  flat(b, cx - fw / 2, cz + fd / 2 - 0.15, cx + fw / 2, cz + fd / 2, yl);
  const nLines = 10;
  for (let i = 0; i <= nLines; i++) {
    const x = cx - fw / 2 + (fw * i) / nLines;
    flat(b, x - 0.08, cz - fd / 2, x + 0.08, cz + fd / 2, yl);
  }
  // end zones
  b.paint(0x2f6f9f, Surf.Plain);
  flat(b, cx - fw / 2 - ez, cz - fd / 2, cx - fw / 2, cz + fd / 2, yl - 0.015);
  b.paint(0xb03a2e, Surf.Plain);
  flat(b, cx + fw / 2, cz - fd / 2, cx + fw / 2 + ez, cz + fd / 2, yl - 0.015);
  // goal posts
  b.paint(0xf2d21b, Surf.Metal);
  for (const s of [-1, 1]) {
    const gx = cx + s * (fw / 2 + ez * 0.9);
    b.box(gx - 0.1, 0, cz - 0.1, gx + 0.1, 3.0, cz + 0.1, { bottom: null });
    b.box(gx - 0.08, 3.0, cz - 2.8, gx + 0.08, 3.15, cz + 2.8);
    b.box(gx - 0.07, 3.0, cz - 2.8, gx + 0.07, 8.0, cz - 2.65, { bottom: null });
    b.box(gx - 0.07, 3.0, cz + 2.65, gx + 0.07, 8.0, cz + 2.8, { bottom: null });
  }
}
/** Bleachers along X facing +Z or -Z (steps). */
export function bleachers(b: ModelBuilder, cx: number, cz: number, w: number, rows: number, facing: 1 | -1, color: ColorLike = 0x9aa0a6, seatColor: ColorLike = 0x2f5f9f) {
  const run = 0.8, rise = 0.45;
  for (let i = 0; i < rows; i++) {
    const zFront = cz + facing * (rows * run / 2 - i * run);
    const zBackR = cz - facing * (rows * run / 2);
    b.paint(i % 2 ? color : seatColor, Surf.Plain);
    b.box(cx - w / 2, 0, Math.min(zFront, zBackR), cx + w / 2, (i + 1) * rise, Math.max(zFront, zBackR), facing > 0 ? { nz: null } : { pz: null });
  }
  b.paint(color, Surf.Metal).box(cx - w / 2, 0, cz - facing * (rows * run / 2) - 0.1, cx + w / 2, rows * rise + 1.0, cz - facing * (rows * run / 2) + 0.1);
}
/** Playground: rubber pad, play tower w/ slide & roof, swings, sandbox. ~140 tris */
export function playground(b: ModelBuilder, cx: number, cz: number, w = 14, d = 11) {
  b.paint(0xc2573f, Surf.Pavement).boxC(cx, cz, w, d, 0, 0.1);
  // tower
  const tx = cx - w * 0.2, tz = cz - d * 0.1;
  b.paint(0x2e6fb5, Surf.Metal);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(tx + dx * 1.1 - 0.08, 0, tz + dz * 1.1 - 0.08, tx + dx * 1.1 + 0.08, 3.2, tz + dz * 1.1 + 0.08, { bottom: null });
  b.paint(0xe8c21a, Surf.Plain).boxC(tx, tz, 2.6, 2.6, 1.5, 0.2);
  b.paint(0xd83a2a, Surf.Plain).pyramid(tx, tz, 2.9, 2.9, 3.2, 1.4);
  // slide
  b.paint(0x38a860, Surf.Metal).quad2([tx + 1.3, 1.6, tz - 0.5], [tx + 1.3, 1.6, tz + 0.5], [tx + 4.3, 0.2, tz + 0.5], [tx + 4.3, 0.2, tz - 0.5]);
  // climbing bridge
  b.paint(0xe8c21a, Surf.Plain).boxC(tx - 2.6, tz, 2.6, 1.0, 1.2, 0.15);
  // swings
  const sx = cx + w * 0.22, sz = cz + d * 0.22;
  b.paint(0xd83a2a, Surf.Metal);
  for (const s of [-1, 1]) {
    b.beam([sx + s * 2.2, 0, sz - 0.9], [sx + s * 2.2, 2.6, sz], 0.12);
    b.beam([sx + s * 2.2, 0, sz + 0.9], [sx + s * 2.2, 2.6, sz], 0.12);
  }
  b.beam([sx - 2.3, 2.6, sz], [sx + 2.3, 2.6, sz], 0.12);
  b.paint(0x222222, Surf.Plain);
  for (const s of [-1, 1]) b.boxC(sx + s * 0.9, sz, 0.5, 0.25, 0.55, 0.06);
  // sandbox
  b.paint(0x8b6a47, Surf.Wood).boxC(cx + w * 0.2, cz - d * 0.28, 3.4, 3.0, 0, 0.3);
  b.paint(0xe3cf95, Surf.Plain).boxC(cx + w * 0.2, cz - d * 0.28, 3.0, 2.6, 0.1, 0.24, { pz: null, nz: null, px: null, nx: null });
}

// ---------------------------------------------------------------------------------------------- misc structures
/** Gravestone ~6-10 tris */
export function gravestone(b: ModelBuilder, x: number, z: number, kind: number, color: ColorLike) {
  b.paint(color, Surf.Stone);
  if (kind === 0) b.box(x - 0.32, 0, z - 0.08, x + 0.32, 0.85, z + 0.08, { px: null, nx: null });
  else if (kind === 1) {
    b.box(x - 0.07, 0, z - 0.07, x + 0.07, 1.25, z + 0.07, { bottom: null, px: null, nx: null });
    b.box(x - 0.35, 0.78, z - 0.07, x + 0.35, 0.92, z + 0.07, { bottom: null });
  } else if (kind === 2) {
    b.box(x - 0.25, 0, z - 0.25, x + 0.25, 0.4, z + 0.25, { bottom: null });
    b.pyramid(x, z, 0.4, 0.4, 0.4, 1.4);
  } else {
    b.box(x - 0.45, 0, z - 0.8, x + 0.45, 0.3, z + 0.8, { bottom: null });
    b.box(x - 0.3, 0.3, z - 0.72, x + 0.3, 0.9, z - 0.62, { px: null, nx: null });
  }
}

/** Guard tower on a concrete shaft with glazed cabin + searchlight. ~70 tris */
export function guardTower(b: ModelBuilder, x: number, z: number, h: number, color: ColorLike = CIV.concrete) {
  b.paint(color, Surf.Plain).boxC(x, z, 1.8, 1.8, 0, h - 3.0);
  b.paint(color, Surf.Plain).boxC(x, z, 3.6, 3.6, h - 3.2, 0.4);
  b.paint(0x26303a, Surf.GlassPlain).boxC(x, z, 3.0, 3.0, h - 2.8, 1.6, { top: null });
  b.paint(color, Surf.Plain).boxC(x, z, 3.2, 3.2, h - 1.2, 0.2, { top: null });
  b.paint(0x4a4f55, Surf.Plain).pyramid(x, z, 4.0, 4.0, h - 1.0, 1.0);
  b.paint(0xfff5d0, Surf.Emissive).boxC(x, z, 0.5, 0.5, h, 0.4);
}

/** Paraboloid dish (double-sided) with feed horn. Local axis +Y, then tilted by tiltX (radians) and rotY. ~150 tris */
export function dish(b: ModelBuilder, cx: number, cy: number, cz: number, r: number, depth: number, tiltX: number, rotY: number, color: ColorLike = 0xeeeeee, seg = 12, rings = 3) {
  b.push().translate(cx, cy, cz).rotateY(rotY).rotateX(tiltX);
  const P = (j: number, i: number): V3 => {
    const rho = (r * j) / rings;
    const a = (i / seg) * Math.PI * 2;
    return [Math.cos(a) * rho, depth * (rho / r) * (rho / r), Math.sin(a) * rho];
  };
  b.paint(color, Surf.Plain);
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = P(j, i), bb = P(j, i + 1), c = P(j + 1, i + 1), d = P(j + 1, i);
      if (j === 0) {
        b.tri(a, c, d);
        b.tri(a, d, c);
      } else {
        b.quad(a, bb, c, d);
        b.quad(d, c, bb, a);
      }
    }
  }
  // rim
  b.paint(0xbfc3c7, Surf.Metal);
  // feed struts
  const f = r * r / (4 * depth);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    b.beam([Math.cos(a) * r * 0.95, depth * 0.9, Math.sin(a) * r * 0.95], [0, f, 0], 0.12);
  }
  b.boxC(0, 0, 0.6, 0.6, f - 0.3, 0.6);
  b.pop();
}

/** Radar antenna (rotating bar type) on a mast. */
export function radarBar(b: ModelBuilder, x: number, z: number, y: number, w = 7, rot = 0.4) {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(0x5a5f64, Surf.Metal).cylinder(0, 0, 0, 0.8, 0.35, 0.3, 6);
  b.paint(0xe6e6e6, Surf.Plain).box(-w / 2, 0.8, -0.3, w / 2, 2.2, 0.3);
  b.paint(0x5a5f64, Surf.Metal).box(-w / 2, 0.8, 0.3, w / 2, 2.2, 0.8, { bottom: null });
  b.pop();
}

/** Storage tank (vertical cylinder w/ dome top). ~60 tris */
export function tank(b: ModelBuilder, x: number, z: number, r: number, h: number, color: ColorLike = 0xe6e6e2, band?: ColorLike, seg = 10) {
  b.paint(color, Surf.Metal).cylinder(x, z, 0, h, r, r, seg, { top: false });
  b.sphere(x, h, z, r, seg, 4, { hemi: true, scaleY: 0.25 });
  if (band !== undefined) b.paint(band, Surf.Plain).cylinder(x, z, h * 0.6, h * 0.12, r + 0.03, r + 0.03, seg, { top: false });
}

/** Tall lattice mast / antenna with emissive red tip. */
export function antennaMast(b: ModelBuilder, x: number, z: number, y0: number, h: number, color: ColorLike = 0xd9d9d9) {
  b.paint(color, Surf.Metal);
  b.cylinder(x, z, y0, h, 0.35, 0.08, 4, { smooth: false, top: false });
  b.paint(0xff3322, Surf.Emissive).boxC(x, z, 0.3, 0.3, y0 + h, 0.3);
}
