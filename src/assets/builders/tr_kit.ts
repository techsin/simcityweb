/**
 * Transport-group helper kit (owned by the transport asset agent).
 * Cheap, reusable pieces for airports, ports, rail yards and parking: decals/markings, lights, vaults, frustums,
 * aircraft, trucks, containers with face culling, rail track, gantry cranes, trees, low-poly cars.
 * All coordinates are model space (meters, lot centered at origin, front = +Z, y up).
 */
import * as THREE from 'three';
import { ModelBuilder, type ColorLike, type Paint } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';

export type V3 = [number, number, number];

// ---------------------------------------------------------------------------------------------- vector utils
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Colour helper: sRGB hex scaled (returns a linear THREE.Color, accepted by ModelBuilder.paint). */
export function shade(c: ColorLike, k: number): THREE.Color {
  const col = c instanceof THREE.Color ? c.clone() : Array.isArray(c) ? new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace) : new THREE.Color(c as THREE.ColorRepresentation);
  return col.multiplyScalar(k);
}

/** Flat triangle, winding auto-corrected so the face normal points along `dir`. */
export function triF(b: ModelBuilder, a: V3, c: V3, d: V3, dir: V3): void {
  const n = cross(sub(c, a), sub(d, a));
  if (dot(n, dir) < 0) b.tri(a, d, c);
  else b.tri(a, c, d);
}
/** Flat quad a-c-d-e (in order around the perimeter), facing `dir`. */
export function quadF(b: ModelBuilder, a: V3, c: V3, d: V3, e: V3, dir: V3): void {
  triF(b, a, c, d, dir);
  triF(b, a, d, e, dir);
}
/** Smooth triangle with per-vertex normals; winding auto-corrected to agree with the normals. */
export function triS(b: ModelBuilder, a: V3, c: V3, d: V3, na: V3, nc: V3, nd: V3): void {
  const n = cross(sub(c, a), sub(d, a));
  const avg = add(add(na, nc), nd);
  if (dot(n, avg) < 0) b.triN(a, d, c, na, nd, nc);
  else b.triN(a, c, d, na, nc, nd);
}

// ---------------------------------------------------------------------------------------------- decals / markings
/** Up-facing quad (ground marking / decal) at height y. 2 tris. */
export function flat(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number): void {
  if (x0 > x1) [x0, x1] = [x1, x0];
  if (z0 > z1) [z0, z1] = [z1, z0];
  b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
}
/** Up-facing strip of width w from (ax,az) to (bx,bz). 2 tris. */
export function stripe(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, w: number, y: number): void {
  const dx = bx - ax, dz = bz - az;
  const L = Math.hypot(dx, dz) || 1;
  const nx = (-dz / L) * (w / 2), nz = (dx / L) * (w / 2);
  quadF(b, [ax + nx, y, az + nz], [bx + nx, y, bz + nz], [bx - nx, y, bz - nz], [ax - nx, y, az - nz], [0, 1, 0]);
}
/** Dashed strip along a segment. */
export function dashed(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, w: number, y: number, dash: number, gap: number): void {
  const L = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / L, uz = (bz - az) / L;
  for (let t = 0; t < L - 0.01; t += dash + gap) {
    const t1 = Math.min(L, t + dash);
    stripe(b, ax + ux * t, az + uz * t, ax + ux * t1, az + uz * t1, w, y);
  }
}

/** 7-segment digit strokes: a b c d e f g */
const SEG: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg' };
/**
 * Paint a runway designator (7-segment style) as ground decals. (ox, oz) = bottom-left of the text block in world,
 * `up` = unit world direction of the text's up, `right` = text's right. Digit w x h, stroke t.
 */
export function runwayNumber(b: ModelBuilder, text: string, ox: number, oz: number, up: [number, number], right: [number, number], w: number, h: number, t: number, y: number): void {
  const P = (u: number, v: number): [number, number] => [ox + right[0] * u + up[0] * v, oz + right[1] * u + up[1] * v];
  const rect = (u0: number, v0: number, u1: number, v1: number) => {
    const a = P(u0, v0), c = P(u1, v0), d = P(u1, v1), e = P(u0, v1);
    quadF(b, [a[0], y, a[1]], [c[0], y, c[1]], [d[0], y, d[1]], [e[0], y, e[1]], [0, 1, 0]);
  };
  let u = 0;
  for (const ch of text) {
    const s = SEG[ch] ?? '';
    const hm = h / 2;
    if (s.includes('a')) rect(u, h - t, u + w, h);
    if (s.includes('b')) rect(u + w - t, hm, u + w, h - t);
    if (s.includes('c')) rect(u + w - t, t, u + w, hm);
    if (s.includes('d')) rect(u, 0, u + w, t);
    if (s.includes('e')) rect(u, t, u + t, hm);
    if (s.includes('f')) rect(u, hm, u + t, h - t);
    if (s.includes('g')) rect(u + t, hm - t / 2, u + w - t, hm + t / 2);
    u += w + t * 1.6;
  }
}

// ---------------------------------------------------------------------------------------------- lights
/** Small emissive light "dot" (4-sided pyramid, 4 tris). Glows at night. */
export function lightDot(b: ModelBuilder, x: number, y: number, z: number, s: number, color: ColorLike): void {
  b.paint(color, Surf.Emissive).pyramid(x, z, s, s, y, s * 0.9);
}
/** Small emissive cube (6 faces minus bottom = 10 tris). */
export function lightBox(b: ModelBuilder, x: number, y: number, z: number, s: number, color: ColorLike): void {
  b.paint(color, Surf.Emissive).boxC(x, z, s, s, y, s, { bottom: null });
}

/** High-mast floodlight: slim pole + head frame + emissive lamp panel facing down/outwards. ~34 tris. */
export function floodMast(b: ModelBuilder, x: number, z: number, h: number, rot = 0, pole: ColorLike = 0x8e949a): void {
  b.paint(pole, Surf.Metal).cylinder(x, z, 0, h, 0.32, 0.18, 6, { top: false });
  b.push().translate(x, h, z).rotateY(rot);
  b.paint(0x3a3e42, Surf.Metal).box(-1.6, -0.2, -0.35, 1.6, 0.5, 0.35, { bottom: null });
  b.paint(0xfff2d6, Surf.Emissive).box(-1.5, -0.35, -0.3, 1.5, -0.2, 0.3, { top: null });
  b.pop();
}

// ---------------------------------------------------------------------------------------------- shapes
/** Frustum / pipe between two points (radius r0 at a, r1 at e). roll rotates facets around the axis. */
export function frustum(b: ModelBuilder, a: V3, e: V3, r0: number, r1: number, seg: number, opts: { roll?: number; top?: boolean; bottom?: boolean; smooth?: boolean; topPaint?: Paint } = {}): void {
  const dx = e[0] - a[0], dy = e[1] - a[1], dz = e[2] - a[2];
  const L = Math.hypot(dx, dy, dz);
  if (L < 1e-5) return;
  const yaw = Math.atan2(dx, dz);
  const th = Math.acos(Math.max(-1, Math.min(1, dy / L)));
  b.push().translate(a[0], a[1], a[2]).rotateY(yaw).rotateX(th).rotateY(opts.roll ?? 0);
  b.cylinder(0, 0, 0, L, r0, r1, seg, { smooth: opts.smooth ?? true, top: opts.top ?? false, bottom: opts.bottom ?? false, topPaint: opts.topPaint });
  b.pop();
}

/** Oriented box: a rectangular beam of section (w x h) from point a to point e, with `up` roughly world +Y. */
export function obox(b: ModelBuilder, a: V3, e: V3, w: number, h: number, faces: { ends?: boolean; bottom?: boolean } = {}): void {
  const bottom = faces.bottom ? b.getPaint() : null;
  const dx = e[0] - a[0], dy = e[1] - a[1], dz = e[2] - a[2];
  const hl = Math.hypot(dx, dz);
  const L = Math.hypot(dx, dy, dz);
  if (L < 1e-5) return;
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.atan2(dy, hl);
  b.push().translate(a[0], a[1], a[2]).rotateY(yaw).rotateX(-pitch);
  const ends = faces.ends ?? true;
  b.box(-w / 2, -h / 2, 0, w / 2, h / 2, L, { bottom, pz: ends ? undefined : null, nz: ends ? undefined : null });
  b.pop();
}

/** Thin plate through 4 perimeter points, thickness t along `up`. 12 tris. */
export function plate(b: ModelBuilder, p: V3[], t: number, up: V3): void {
  const o = mul(up, t / 2);
  const top = p.map((q) => add(q, o));
  const bot = p.map((q) => sub(q, o));
  quadF(b, top[0], top[1], top[2], top[3], up);
  quadF(b, bot[0], bot[1], bot[2], bot[3], mul(up, -1));
  const cen = mul(add(add(p[0], p[1]), add(p[2], p[3])), 0.25);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const mid = mul(add(p[i], p[j]), 0.5);
    quadF(b, top[i], top[j], bot[j], bot[i], sub(mid, cen));
  }
}

export interface VaultOpts {
  seg?: number;
  /** paint for the arched end walls (null = none). Default: current paint. */
  ends?: Paint | null;
  /** world offsets (min, max) of the two end walls along the vault axis, relative to the centre (default ±len/2) */
  endAt?: [number, number];
  /** which end walls to draw: [min end, max end] along the world axis (default both) */
  endMask?: [boolean, boolean];
  /** paint for the underside (double-sided shell for canopies); omitted = no underside */
  under?: Paint;
}
/**
 * Barrel vault / curved roof. The vault RUNS along `axis` (length `len`), the arc spans `span` across the other
 * horizontal axis with springing line at y0 and crown at y0 + rise (rise <= span/2). Smooth normals.
 */
export function vault(b: ModelBuilder, cx: number, cz: number, span: number, len: number, y0: number, rise: number, axis: 'x' | 'z', opts: VaultOpts = {}): void {
  const seg = opts.seg ?? 8;
  const a = span / 2;
  rise = Math.min(rise, a);
  const R = (a * a + rise * rise) / (2 * rise);
  const yc = y0 + rise - R;
  const phi = Math.asin(Math.min(1, a / R));
  const shell = b.getPaint();
  b.push().translate(cx, 0, cz);
  if (axis === 'z') b.rotateY(Math.PI / 2);
  const L2 = len / 2;
  const pts: { z: number; y: number; n: V3 }[] = [];
  for (let i = 0; i <= seg; i++) {
    const ang = -phi + (2 * phi * i) / seg;
    pts.push({ z: R * Math.sin(ang), y: yc + R * Math.cos(ang), n: [0, Math.cos(ang), Math.sin(ang)] });
  }
  for (let i = 0; i < seg; i++) {
    const p = pts[i], q = pts[i + 1];
    const A: V3 = [-L2, p.y, p.z], B: V3 = [L2, p.y, p.z], C: V3 = [L2, q.y, q.z], D: V3 = [-L2, q.y, q.z];
    triS(b, A, B, C, p.n, p.n, q.n);
    triS(b, A, C, D, p.n, q.n, q.n);
  }
  if (opts.under) {
    b.paint(opts.under);
    for (let i = 0; i < seg; i++) {
      const p = pts[i], q = pts[i + 1];
      const A: V3 = [-L2, p.y - 0.05, p.z], B: V3 = [L2, p.y - 0.05, p.z], C: V3 = [L2, q.y - 0.05, q.z], D: V3 = [-L2, q.y - 0.05, q.z];
      const np = mul(p.n, -1), nq = mul(q.n, -1);
      triS(b, A, B, C, np, np, nq);
      triS(b, A, C, D, np, nq, nq);
    }
  }
  if (opts.ends !== null) {
    b.paint(opts.ends ?? shell);
    const [m0, m1] = opts.endAt ?? [-L2, L2];
    const mask = opts.endMask ?? [true, true];
    const list: [number, number][] = [];
    // for axis 'z' the local frame is rotated: local x = -world offset, local +X = world -Z
    if (mask[0]) list.push(axis === 'x' ? [m0, -1] : [-m0, 1]);
    if (mask[1]) list.push(axis === 'x' ? [m1, 1] : [-m1, -1]);
    for (const [x, dir] of list) {
      for (let i = 0; i < seg; i++) {
        const p = pts[i], q = pts[i + 1];
        triF(b, [x, y0, 0], [x, p.y, p.z], [x, q.y, q.z], [dir, 0, 0]);
      }
    }
  }
  b.pop();
  b.paint(shell);
}

// ---------------------------------------------------------------------------------------------- vegetation
/** Deterministic lot tree: trunk + foliage blob, total height ~h (≈30 tris). */
export function tree(b: ModelBuilder, rng: RNG, x: number, z: number, h = 7, color?: ColorLike): void {
  const s = h / 7;
  b.paint(0x5b4330, Surf.Wood).cylinder(x, z, 0, h * 0.45, 0.22 * s, 0.15 * s, 5, { top: false });
  const g = color ?? rng.pick([0x4f7a32, 0x5a8a3a, 0x46702f, 0x628f3e]);
  b.paint(g, Surf.Foliage).blob(x, h * 0.62, z, h * 0.3, h * 0.33, h * 0.3, 0, 0.1, rng.next() * 10);
}
/** Low shrub clump (20 tris). */
export function shrub(b: ModelBuilder, rng: RNG, x: number, z: number, r = 1.1): void {
  b.paint(rng.pick([0x4a7a34, 0x3f6b2e, 0x5b8a3c]), Surf.Foliage).blob(x, r * 0.55, z, r, r * 0.7, r, 0, 0.15, rng.next() * 10);
}

// ---------------------------------------------------------------------------------------------- vehicles
export const CAR_COLS = [0xb8bcc2, 0x2b2d31, 0xf1f1ef, 0x8a1c1c, 0x1f3f7a, 0x5d6b73, 0x3e5e3a, 0xc9a13b, 0x6b2f4a, 0xd96b2b, 0x9aa3ab, 0xe7e4dc];

/** Cheap car (20 tris), heading +Z when rot = 0. */
export function carLite(b: ModelBuilder, x: number, z: number, rot: number, color: ColorLike, y = 0.08): void {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(color, Surf.Metal).box(-0.88, 0.18, -2.2, 0.88, 0.85, 2.2, { bottom: null });
  b.paint(0x262b31, Surf.Metal).box(-0.78, 0.85, -1.15, 0.78, 1.38, 0.95, { bottom: null, top: { color, surf: Surf.Metal } });
  b.pop();
}

/** Parking lot: asphalt + stall lines (top quads) + cheap cars. Stalls side by side along X; rows along Z. */
export function parking(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, fill = 0.65, opts: { asphalt?: ColorLike; line?: ColorLike; slab?: boolean; y?: number } = {}): void {
  const y = opts.y ?? 0;
  if (opts.slab !== false) b.paint(opts.asphalt ?? 0x3b3c40, Surf.Pavement).box(x0, y, z0, x1, y + 0.08, z1, { bottom: null });
  const stallW = 2.6, stallD = 5.0, aisle = 6.2;
  const pitch = stallD * 2 + aisle;
  b.paint(opts.line ?? 0xe8e8e2, Surf.Plain);
  const rows: [number, number][] = [];
  for (let rz = z0 + 0.4; rz + stallD <= z1 - 0.2; rz += pitch) {
    rows.push([rz, Math.PI]);
    if (rz + stallD + aisle + stallD <= z1 - 0.2) rows.push([rz + stallD + aisle, 0]);
  }
  const nStall = Math.floor((x1 - x0 - 0.8) / stallW);
  const sx0 = (x0 + x1) / 2 - (nStall * stallW) / 2;
  for (const [rz] of rows) for (let i = 0; i <= nStall; i++) flat(b, sx0 + i * stallW - 0.06, rz, sx0 + i * stallW + 0.06, rz + stallD, y + 0.1);
  for (const [rz, face] of rows)
    for (let i = 0; i < nStall; i++) if (rng.chance(fill)) carLite(b, sx0 + (i + 0.5) * stallW + rng.range(-0.1, 0.1), rz + stallD / 2, face + rng.range(-0.04, 0.04), rng.pick(CAR_COLS), y + 0.08);
}

/** Semi truck with a container / box trailer (≈40 tris), heading +Z when rot = 0; total length ~16.5 m. */
export function semi(b: ModelBuilder, x: number, z: number, rot: number, cab: ColorLike, load: ColorLike | null, y = 0.08): void {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(0x2b2d30, Surf.Metal).box(-1.1, 0.3, -8.0, 1.1, 1.15, 5.2, { bottom: null });
  b.paint(cab, Surf.Metal).box(-1.25, 0.5, 5.2, 1.25, 3.3, 8.2, { bottom: null });
  b.paint(0x1d2228, Surf.Metal).box(-1.1, 2.0, 8.2, 1.1, 3.0, 8.26, { bottom: null, top: null, nz: null });
  if (load !== null) b.paint(load, Surf.Corrugated).box(-1.25, 1.2, -8.0, 1.25, 3.95, 4.4, { bottom: null });
  b.pop();
}

/** Small airport service vehicle (tug / catering / fuel bowser). ~20 tris */
export function serviceVehicle(b: ModelBuilder, x: number, z: number, rot: number, kind: 'tug' | 'fuel' | 'catering' | 'bus', y = 0.1): void {
  b.push().translate(x, y, z).rotateY(rot);
  if (kind === 'tug') {
    b.paint(0xe0b020, Surf.Metal).box(-0.9, 0.2, -1.4, 0.9, 1.1, 1.4, { bottom: null });
    // two baggage carts behind
    b.paint(0x8a9096, Surf.Metal).box(-0.8, 0.3, -4.6, 0.8, 1.3, -2.0, { bottom: null });
    b.paint(0x8a9096, Surf.Metal).box(-0.8, 0.3, -7.6, 0.8, 1.3, -5.0, { bottom: null });
  } else if (kind === 'fuel') {
    b.paint(0xf2f0ea, Surf.Metal).box(-1.1, 0.3, 2.0, 1.1, 2.6, 3.6, { bottom: null });
    b.paint(0xd9d6cf, Surf.Metal);
    frustum(b, [0, 1.6, -3.6], [0, 1.6, 1.9], 1.15, 1.15, 8, { roll: Math.PI / 8, top: true, bottom: true });
  } else if (kind === 'catering') {
    b.paint(0xf2f0ea, Surf.Metal).box(-1.1, 0.3, 2.2, 1.1, 2.4, 3.6, { bottom: null });
    b.paint(0x2e6fb5, Surf.Metal).box(-1.2, 1.6, -3.0, 1.2, 4.2, 2.0, { bottom: null });
  } else {
    b.paint(0xe9e6de, Surf.Metal).box(-1.3, 0.3, -6.0, 1.3, 3.0, 6.0, { bottom: null });
    b.paint(0x1d2228, Surf.Metal).box(-1.32, 1.6, -5.5, 1.32, 2.6, 5.5, { top: null, bottom: null, nz: null, pz: null });
  }
  b.pop();
}

// ---------------------------------------------------------------------------------------------- aircraft
export interface Livery {
  body: ColorLike;
  tail: ColorLike;
  stripe: ColorLike;
  engine?: ColorLike;
}
export const LIVERIES: Livery[] = [
  { body: 0xf4f4f2, tail: 0x1f4fa0, stripe: 0x1f4fa0 },
  { body: 0xf4f4f2, tail: 0xc8262d, stripe: 0xc8262d, engine: 0xc8262d },
  { body: 0xf4f4f2, tail: 0x0f7f6f, stripe: 0xe0b020 },
  { body: 0xf1f1ee, tail: 0xe36a1e, stripe: 0x3a3a3a, engine: 0xe36a1e },
  { body: 0xe9edf2, tail: 0x5a2b82, stripe: 0x5a2b82 },
  { body: 0xf4f4f2, tail: 0x16305c, stripe: 0xb8b8b8, engine: 0x16305c },
];

/**
 * Twin-jet airliner (A320/737-ish; wide = twin-aisle proportions). Nose points +Z when rot = 0.
 * At s = 1: length ~37 m, span ~35 m, fin top ~11.5 m. ~220 tris.
 */
export function airliner(b: ModelBuilder, x: number, z: number, rot: number, s: number, liv: Livery, opts: { wide?: boolean; y?: number } = {}): void {
  const wide = opts.wide ?? false;
  const R = wide ? 2.9 : 2.0;
  const hc = wide ? 4.2 : 3.2;
  const zb0 = wide ? -19 : -12, zb1 = wide ? 16 : 11;
  const eng = liv.engine ?? 0xc9ccd0;
  b.push().translate(x, opts.y ?? 0.1, z).rotateY(rot).scale(s, s, s);
  const roll = Math.PI / 8;
  // fuselage
  b.paint(liv.body, Surf.Metal);
  frustum(b, [0, hc, zb0], [0, hc, zb1], R, R, 8, { roll });
  frustum(b, [0, hc, zb1], [0, hc - 0.25 * R, zb1 + 2.4 * R / 2], R, R * 0.66, 8, { roll });
  frustum(b, [0, hc - 0.25 * R, zb1 + 1.2 * R], [0, hc - 0.45 * R, zb1 + 2.4 * R], R * 0.66, R * 0.18, 8, { roll, top: true });
  frustum(b, [0, hc, zb0], [0, hc + 0.55 * R, zb0 - 4.2 * R], R, R * 0.2, 8, { roll, top: true });
  // cockpit windshield + cabin windows + cheatline (on the vertical facets at x = ±R*cos(22.5°))
  const xs = R * 0.924 + 0.03;
  b.paint(0x1a2028, Surf.Metal).box(-R * 0.55, hc + 0.2 * R, zb1 + 0.5 * R, R * 0.55, hc + 0.52 * R, zb1 + 1.1 * R, { bottom: null });
  for (const sd of [-1, 1]) {
    const dir: V3 = [sd, 0, 0];
    b.paint(0x1d242c, Surf.Metal);
    quadF(b, [sd * xs, hc + 0.12 * R, zb0 + 1], [sd * xs, hc + 0.12 * R, zb1 - 0.5], [sd * xs, hc + 0.3 * R, zb1 - 0.5], [sd * xs, hc + 0.3 * R, zb0 + 1], dir);
    b.paint(liv.stripe, Surf.Metal);
    quadF(b, [sd * xs, hc - 0.2 * R, zb0 - 1], [sd * xs, hc - 0.2 * R, zb1 + 0.4], [sd * xs, hc - 0.05 * R, zb1 + 0.4], [sd * xs, hc - 0.05 * R, zb0 - 1], dir);
  }
  // wings (low, swept, dihedral)
  const span = wide ? 27 : 17.5;
  const rootLE = wide ? 5 : 3, rootTE = wide ? -7 : -4.2;
  const sweep = wide ? 12.5 : 7.2;
  const tipChord = wide ? 2.4 : 1.8;
  const wy = hc - R * 0.55;
  const dih = span * 0.08;
  b.paint(shade(liv.body, 0.92), Surf.Metal);
  for (const sd of [-1, 1]) {
    plate(b, [[sd * R * 0.8, wy, rootLE], [sd * span, wy + dih, rootLE - sweep], [sd * span, wy + dih, rootLE - sweep - tipChord], [sd * R * 0.8, wy, rootTE]], 0.35, [0, 1, 0]);
  }
  // horizontal stabiliser
  const zt = zb0 - 4.2 * R;
  const hs = wide ? 10 : 6.4;
  for (const sd of [-1, 1]) {
    plate(b, [[sd * R * 0.3, hc + 0.3 * R, zt + 5.6], [sd * hs, hc + 0.3 * R + 1, zt + 1.6], [sd * hs, hc + 0.3 * R + 1, zt + 0.4], [sd * R * 0.3, hc + 0.3 * R, zt + 2.0]], 0.25, [0, 1, 0]);
  }
  // vertical fin (tail colour)
  b.paint(liv.tail, Surf.Metal);
  const finH = wide ? 10.5 : 8.2;
  plate(b, [[0, hc + 0.5 * R, zt + 8.5], [0, hc + 0.5 * R + finH, zt + 2.2], [0, hc + 0.5 * R + finH, zt + 0.3], [0, hc + 0.5 * R, zt + 1.5]], 0.35, [1, 0, 0]);
  // engines under the wings
  const ex = wide ? 9.5 : 5.8;
  const er = wide ? 1.6 : 1.0;
  const ez = rootLE - sweep * (ex / span) + (wide ? 2.4 : 1.6);
  for (const sd of [-1, 1]) {
    b.paint(eng, Surf.Metal);
    frustum(b, [sd * ex, wy - er * 0.72, ez - (wide ? 5.5 : 4.2)], [sd * ex, wy - er * 0.72, ez], er * 0.8, er, 8, { top: true, topPaint: { color: 0x202326, surf: Surf.Metal } });
  }
  // landing gear (dark stubs, read as a gap under the fuselage)
  b.paint(0x26282b, Surf.Metal);
  b.box(-R * 0.7, 0, -1.6, R * 0.7, hc - R * 0.8, 0.2, { bottom: null, top: null });
  b.box(-0.25, 0, zb1 - 0.5, 0.25, hc - R * 0.8, zb1 + 0.4, { bottom: null, top: null });
  b.pop();
}

/** High-wing twin turboprop (ATR/Dash-8-ish). Nose +Z. At s=1 ~ 23 m long, 27 m span. ~190 tris. */
export function turboprop(b: ModelBuilder, x: number, z: number, rot: number, s: number, liv: Livery, y = 0.1): void {
  const R = 1.4, hc = 2.4;
  b.push().translate(x, y, z).rotateY(rot).scale(s, s, s);
  const roll = Math.PI / 8;
  b.paint(liv.body, Surf.Metal);
  frustum(b, [0, hc, -7], [0, hc, 8], R, R, 8, { roll });
  frustum(b, [0, hc, 8], [0, hc - 0.3, 10.6], R, R * 0.35, 8, { roll, top: true });
  frustum(b, [0, hc, -7], [0, hc + 0.9, -12.5], R, R * 0.25, 8, { roll, top: true });
  const xs = R * 0.924 + 0.03;
  for (const sd of [-1, 1]) {
    b.paint(0x1d242c, Surf.Metal);
    quadF(b, [sd * xs, hc + 0.15, -6], [sd * xs, hc + 0.15, 7.5], [sd * xs, hc + 0.42, 7.5], [sd * xs, hc + 0.42, -6], [sd, 0, 0]);
    b.paint(liv.stripe, Surf.Metal);
    quadF(b, [sd * xs, hc - 0.35, -7.5], [sd * xs, hc - 0.35, 8.5], [sd * xs, hc - 0.1, 8.5], [sd * xs, hc - 0.1, -7.5], [sd, 0, 0]);
  }
  b.paint(0x1a2028, Surf.Metal).box(-0.75, hc + 0.3, 8.3, 0.75, hc + 0.8, 9.2, { bottom: null });
  // high straight wing
  const wy = hc + R * 0.95;
  b.paint(shade(liv.body, 0.93), Surf.Metal);
  plate(b, [[-13.5, wy, 1.6], [13.5, wy, 1.6], [13.5, wy, -0.6], [-13.5, wy, -0.6]], 0.3, [0, 1, 0]);
  // T-tail
  b.paint(liv.tail, Surf.Metal);
  plate(b, [[0, hc + R * 0.6, -6.5], [0, hc + 6.2, -10.8], [0, hc + 6.2, -12.6], [0, hc + R * 0.6, -12.2]], 0.3, [1, 0, 0]);
  plate(b, [[-4.2, hc + 6.2, -10.8], [4.2, hc + 6.2, -10.8], [4.2, hc + 6.2, -12.5], [-4.2, hc + 6.2, -12.5]], 0.22, [0, 1, 0]);
  // nacelles + props
  for (const sd of [-1, 1]) {
    b.paint(liv.engine ?? liv.body, Surf.Metal);
    b.box(sd * 4.1 - 0.55, wy - 1.2, -2.8, sd * 4.1 + 0.55, wy - 0.05, 2.6, { bottom: null });
    b.paint(0x202326, Surf.Metal);
    b.box(sd * 4.1 - 1.9, wy - 0.72, 2.7, sd * 4.1 + 1.9, wy - 0.52, 2.8, { bottom: null });
    b.box(sd * 4.1 - 0.1, wy - 2.5, 2.7, sd * 4.1 + 0.1, wy + 1.3, 2.8, { bottom: null });
  }
  b.paint(0x26282b, Surf.Metal).box(-1.4, 0, -0.8, 1.4, hc - R * 0.8, 0.8, { bottom: null, top: null });
  b.pop();
}

/** Small single-prop GA plane (Cessna-ish, high wing). Nose +Z. ~70 tris at ~8.5 m long / 11 m span. */
export function gaPlane(b: ModelBuilder, x: number, z: number, rot: number, body: ColorLike, trim: ColorLike, y = 0.1): void {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(body, Surf.Metal);
  b.box(-0.6, 0.7, -1.0, 0.6, 1.9, 2.4, { bottom: null });
  frustum(b, [0, 1.3, -1.0], [0, 1.6, -5.8], 0.62, 0.2, 6, { top: true });
  frustum(b, [0, 1.25, 2.4], [0, 1.2, 3.6], 0.6, 0.3, 6, { top: true });
  b.paint(0x1f262e, Surf.Metal).box(-0.62, 1.4, 0.4, 0.62, 1.95, 1.9, { bottom: null, top: null });
  b.paint(body, Surf.Metal);
  plate(b, [[-5.5, 2.05, 1.4], [5.5, 2.05, 1.4], [5.5, 2.05, 0.0], [-5.5, 2.05, 0.0]], 0.14, [0, 1, 0]);
  plate(b, [[-1.8, 1.6, -4.9], [1.8, 1.6, -4.9], [1.8, 1.6, -5.8], [-1.8, 1.6, -5.8]], 0.1, [0, 1, 0]);
  b.paint(trim, Surf.Metal);
  plate(b, [[0, 1.6, -4.4], [0, 3.1, -5.4], [0, 3.1, -6.0], [0, 1.6, -6.0]], 0.12, [1, 0, 0]);
  b.paint(0x202326, Surf.Metal).box(-0.9, 0.0, 0.6, 0.9, 0.7, 0.9, { bottom: null, top: null });
  b.pop();
}

// ---------------------------------------------------------------------------------------------- containers / rail
export const CONTAINER_COLS = [0x3f9fcf, 0x2e7d4f, 0xc9962a, 0x1d3d7a, 0xe36a1e, 0xb03a2e, 0x8a8f94, 0x7a4a33, 0xe8e8e2, 0xa8322a, 0xb8327a, 0x557a8c, 0x6f7f3a, 0xd9c23a];

/** Shipping container along local X (long = 40ft 12.2 m, else 20ft 6.1 m). top=false omits the lid (stacked). */
export function ctr(b: ModelBuilder, x: number, y: number, z: number, long: boolean, color: ColorLike, top = true, rotY = 0): void {
  const L = long ? 12.19 : 6.06;
  b.push().translate(x, y, z).rotateY(rotY);
  b.paint(color, Surf.Corrugated).box(-L / 2, 0, -1.22, L / 2, 2.59, 1.22, { bottom: null, top: top ? undefined : null });
  b.pop();
}

/**
 * Container yard block: `bays` columns along X (40ft each), `rows` along Z, random tier heights up to maxTier.
 * Only the topmost container of each column gets a lid. Returns number of containers.
 */
export function containerBlock(b: ModelBuilder, rng: RNG, x0: number, z0: number, bays: number, rows: number, maxTier: number, opts: { minTier?: number; long?: boolean; palette?: number[] } = {}): number {
  const long = opts.long ?? true;
  const L = long ? 12.19 : 6.06;
  const pal = opts.palette ?? CONTAINER_COLS;
  let n = 0;
  for (let i = 0; i < bays; i++)
    for (let r = 0; r < rows; r++) {
      const tiers = rng.int(opts.minTier ?? 0, maxTier);
      const x = x0 + i * (L + 0.9) + L / 2, z = z0 + r * 2.74 + 1.22;
      for (let t = 0; t < tiers; t++) {
        const c = shade(rng.pick(pal), rng.range(0.82, 1.05));
        ctr(b, x, t * 2.59, z, long, c, t === tiers - 1);
        n++;
      }
    }
  return n;
}

/** Rail track along X from x0 to x1 at z: ballast bed, sleepers (quads), two rails. */
export function trackX(b: ModelBuilder, x0: number, x1: number, z: number, opts: { ballast?: boolean; sleeperPitch?: number; y?: number } = {}): void {
  const y = opts.y ?? 0;
  if (opts.ballast !== false) b.paint(0x77706a, Surf.Pavement).box(x0, y, z - 1.7, x1, y + 0.22, z + 1.7, { bottom: null });
  const pitch = opts.sleeperPitch ?? 1.25;
  b.paint(0x4e4136, Surf.Wood);
  for (let x = x0 + 0.4; x < x1 - 0.2; x += pitch) flat(b, x, z - 1.25, x + 0.3, z + 1.25, y + 0.25);
  b.paint(0x8f8b86, Surf.Metal);
  for (const dz of [-0.72, 0.72]) b.box(x0, y + 0.25, z + dz - 0.05, x1, y + 0.4, z + dz + 0.05, { bottom: null, px: null, nx: null });
}

/** Freight car on a track along X (centered at x,z). kind: flat w/ containers, boxcar, tanker, hopper. ~30-50 tris */
export function freightCar(b: ModelBuilder, rng: RNG, x: number, z: number, kind: 'flat' | 'box' | 'tank' | 'hopper', color: ColorLike, y = 0.4): void {
  const L = 17;
  b.paint(0x2c2d30, Surf.Metal).box(x - L / 2, y + 0.4, z - 1.3, x + L / 2, y + 1.2, z + 1.3, { bottom: null });
  if (kind === 'flat') {
    ctr(b, x - 3.1, y + 1.2, z, false, rng.pick(CONTAINER_COLS));
    if (rng.chance(0.8)) ctr(b, x + 3.1, y + 1.2, z, false, rng.pick(CONTAINER_COLS));
  } else if (kind === 'box') {
    b.paint(color, Surf.Corrugated).box(x - L / 2 + 0.3, y + 1.2, z - 1.4, x + L / 2 - 0.3, y + 4.2, z + 1.4, { bottom: null });
  } else if (kind === 'tank') {
    b.paint(color, Surf.Metal);
    frustum(b, [x - L / 2 + 0.6, y + 2.6, z], [x + L / 2 - 0.6, y + 2.6, z], 1.45, 1.45, 8, { roll: Math.PI / 8, top: true, bottom: true });
  } else {
    b.paint(color, Surf.Metal).box(x - L / 2 + 0.5, y + 1.2, z - 1.45, x + L / 2 - 0.5, y + 3.9, z + 1.45, { bottom: null });
    b.paint(0x4a3f33, Surf.Plain);
    flat(b, x - L / 2 + 0.8, z - 1.2, x + L / 2 - 0.8, z + 1.2, y + 3.7);
  }
}

/**
 * Portal gantry crane (rail-mounted / rubber-tyred). Legs at z0 and z1 (span along Z), x = centre, width wx along X.
 * Girders at height h along Z; trolley + cab. ~130 tris.
 */
export function gantry(b: ModelBuilder, x: number, z0: number, z1: number, h: number, wx: number, color: ColorLike, opts: { trolleyAt?: number; overhang?: number; lights?: boolean } = {}): void {
  const t = 0.8;
  const ov = opts.overhang ?? 0;
  const za = Math.min(z0, z1) - ov, zb = Math.max(z0, z1) + ov;
  b.paint(color, Surf.Metal);
  for (const sx of [-1, 1])
    for (const zz of [z0, z1]) b.box(x + sx * wx / 2 - t / 2, 0.6, zz - t / 2, x + sx * wx / 2 + t / 2, h, zz + t / 2, { bottom: null, top: null });
  // bogies / sill beams run along the rails (X)
  b.paint(shade(color, 0.7), Surf.Metal);
  for (const zz of [z0, z1]) b.box(x - wx / 2 - 1.2, 0, zz - 0.6, x + wx / 2 + 1.2, 1.1, zz + 0.6, { bottom: null });
  b.paint(color, Surf.Metal);
  // girders along Z (two), end portal beams along X
  for (const sx of [-1, 1]) b.box(x + sx * wx / 2 - 0.55, h, za, x + sx * wx / 2 + 0.55, h + 1.6, zb);
  for (const zz of [z0, z1]) b.box(x - wx / 2, h - 1.2, zz - 0.5, x + wx / 2, h, zz + 0.5);
  // knee braces in the portal planes (keep the span under the girders clear)
  for (const sx of [-1, 1]) for (const zz of [z0, z1]) obox(b, [x + sx * wx / 2, h - 3.2, zz], [x + sx * (wx / 2 - 3.2), h - 1.1, zz], 0.4, 0.4, { ends: false });
  // trolley + cab
  const tz = opts.trolleyAt ?? (z0 + z1) / 2;
  b.paint(0xd8d6d0, Surf.Metal).box(x - wx / 2 + 0.2, h + 0.3, tz - 1.6, x + wx / 2 - 0.2, h + 2.4, tz + 1.6, { bottom: null });
  b.paint(0x33363a, Surf.Metal).box(x - 1.3, h - 2.4, tz - 1.2, x + 1.3, h - 0.2, tz + 1.2, { top: null });
  b.paint(0x1d242c, Surf.GlassPlain).box(x - 1.32, h - 2.0, tz + 1.2, x + 1.32, h - 0.6, tz + 1.24, { top: null, bottom: null, nz: null });
  // hoist ropes + spreader
  b.paint(0x2a2a2a, Surf.Metal);
  b.box(x - 0.05, h * 0.45, tz - 0.9, x + 0.05, h - 2.4, tz - 0.8, { top: null, bottom: null });
  b.box(x - 0.05, h * 0.45, tz + 0.8, x + 0.05, h - 2.4, tz + 0.9, { top: null, bottom: null });
  b.paint(0xd9a324, Surf.Metal).box(x - 6.1, h * 0.45 - 0.5, tz - 1.2, x + 6.1, h * 0.45, tz + 1.2, { bottom: null });
  if (opts.lights ?? true) {
    lightDot(b, x - wx / 2, h + 1.6, za + 0.4, 0.45, 0xff3322);
    lightDot(b, x + wx / 2, h + 1.6, zb - 0.4, 0.45, 0xff3322);
    b.paint(0xfff0d0, Surf.Emissive).box(x - wx / 2 + 0.6, h - 0.35, tz + 2.2, x + wx / 2 - 0.6, h - 0.1, tz + 2.6, { top: null });
  }
}

/** Mooring bollard (18 tris). */
export function bollard(b: ModelBuilder, x: number, z: number, y = 0.15): void {
  b.paint(0x2b2d31, Surf.Metal).cylinder(x, z, y, 0.7, 0.28, 0.36, 6, { top: true });
}

/** Flat disc (triangle fan) centred at c, facing ±X or ±Z. seg tris. */
export function disc(b: ModelBuilder, c: V3, r: number, seg: number, axis: 'x' | 'z', sign: 1 | -1): void {
  const dir: V3 = axis === 'x' ? [sign, 0, 0] : [0, 0, sign];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (a: number): V3 => (axis === 'x' ? [c[0], c[1] + Math.sin(a) * r, c[2] + Math.cos(a) * r] : [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2]]);
    triF(b, c, p(a0), p(a1), dir);
  }
}

/** Half-disc (arch top) fan in a vertical plane; spans angles 0..PI above centre c. */
export function halfDisc(b: ModelBuilder, c: V3, r: number, seg: number, axis: 'x' | 'z', sign: 1 | -1): void {
  const dir: V3 = axis === 'x' ? [sign, 0, 0] : [0, 0, sign];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI, a1 = ((i + 1) / seg) * Math.PI;
    const p = (a: number): V3 => (axis === 'x' ? [c[0], c[1] + Math.sin(a) * r, c[2] + Math.cos(a) * r] : [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, c[2]]);
    triF(b, c, p(a0), p(a1), dir);
  }
}

/** Vertical rectangle facing ±X / ±Z (2 tris). For axis 'z': spans x in [u0,u1] at z = w; axis 'x': z in [u0,u1] at x = w. */
export function panel(b: ModelBuilder, axis: 'x' | 'z', sign: 1 | -1, w: number, u0: number, u1: number, y0: number, y1: number): void {
  if (axis === 'z') quadF(b, [u0, y0, w], [u1, y0, w], [u1, y1, w], [u0, y1, w], [0, 0, sign]);
  else quadF(b, [w, y0, u0], [w, y0, u1], [w, y1, u1], [w, y1, u0], [sign, 0, 0]);
}

/**
 * Baked "light pool" on the ground: an Emissive decal whose colour is ~0.7x the ground colour, so by day it matches
 * the surrounding pavement (albedo + mild emission) and at night it reads as lit ground under a lamp / floodlight.
 * Place it between the ground slab top and the markings layer. seg tris.
 */
export function pool(b: ModelBuilder, x: number, z: number, r: number, y: number, ground: ColorLike, seg = 10, k = 0.7): void {
  const c = shade(ground, k);
  c.r *= 1.05;
  c.b *= 0.88;
  b.paint(c, Surf.Emissive);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    triF(b, [x, y, z], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [0, 1, 0]);
  }
}
/** Rectangular light pool (2 tris). */
export function poolRect(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, ground: ColorLike, k = 0.7): void {
  const c = shade(ground, k);
  c.r *= 1.05;
  c.b *= 0.88;
  b.paint(c, Surf.Emissive);
  flat(b, x0, z0, x1, z1, y);
}
/** Soft light pool for DARK ground (asphalt): brighter inner disc + dimmer outer ring (24 tris). */
export function poolSoft(b: ModelBuilder, x: number, z: number, r: number, y: number, ground: ColorLike): void {
  pool(b, x, z, r * 0.55, y + 0.004, ground, 8, 1.15);
  const c = shade(ground, 0.8);
  c.r *= 1.05;
  c.b *= 0.88;
  b.paint(c, Surf.Emissive);
  const ri = r * 0.55, seg = 8;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const P = (a: number, rr: number): V3 => [x + Math.cos(a) * rr, y, z + Math.sin(a) * rr];
    quadF(b, P(a0, ri), P(a0, r), P(a1, r), P(a1, ri), [0, 1, 0]);
  }
}
