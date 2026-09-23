/**
 * Vehicle modeling helpers (owned by the nature-vehicle-prop asset agent).
 * Vehicles face +Z, are centered at the origin and their wheels touch y = 0.
 *
 *  - profileSolid(): extrude a side-view profile polygon (z, y) across the width (X). Each profile point can carry
 *    its own half-width factor (tumblehome, tapered noses) and a paint for the band edge starting at that point
 *    (glass windshields, dark bumpers...). Downward-facing bands are skipped (never visible from the city camera).
 *  - axle(): an octagonal / hexagonal tire prism spanning both wheels of an axle + hub caps.
 *  - lamp() / sideQuad(): emissive light quads and flat decals/windows on the ±X sides.
 */
import * as THREE from 'three';
import type { ModelBuilder, Paint, ColorLike } from '../ModelBuilder';
import { Surf } from '../../core/types';
import { triOut, quadOut, polyOut, type V3 } from './nat_geom';

export const P = (color: ColorLike, surf: Surf = Surf.Plain, pattern?: number, floor?: number): Paint => ({ color, surf, pattern, floor });

// ------------------------------------------------------------------ shared palette
export const TIRE = 0x1d1d1f;
export const HUB = 0xb4b8bc;
export const TRIM = 0x26282b; // black plastic trim / bumpers
export const CHASSIS = 0x2a2b2e;
export const CAR_GLASS = P(0x1c2530, Surf.GlassPlain, 1); // vehicle glass: reflective, never lit at night
export const HEAD = P(0xfff2d8, Surf.Emissive);
export const TAIL = P(0xff0804, Surf.Emissive, 3);
/** Emergency beacons: red at 0.75x, blue at 1x emissive intensity. */
export const BEACON_RED = P(0xff0a06, Surf.Emissive, 3);
export const BEACON_BLUE = P(0x0a30ff, Surf.Emissive, 4);
export const AMBER = P(0xffa020, Surf.Emissive);

/** Realistic car paint palette (sRGB): silver, black, white, dark red, navy, grey, green, beige, blue, burgundy, champagne, graphite. */
export const CAR_PAINT = [0xb9bec4, 0x1d1f23, 0xe9e9e5, 0x7c1d22, 0x1f2f55, 0x5d646b, 0x2f4a38, 0xc9b995, 0x2d5f94, 0x5a1e2c, 0xa6977a, 0x3a3e44];

export interface PP {
  z: number;
  y: number;
  /** half-width factor at this point (default 1) */
  w?: number;
  /** paint of the band edge from this point to the next one; null = skip that edge; undefined = side paint */
  p?: Paint | null;
}

export interface ProfileOpts {
  /** paint for the ±X caps (default: side paint) */
  cap?: Paint;
  /** skip caps (e.g. when windows cover them) */
  noCaps?: boolean;
  /** x offset of the solid center */
  x?: number;
  /** keep downward facing bands (default false) */
  keepBottom?: boolean;
}

/** Extrude a side profile (points in z/y, any winding) across x in [-hw, hw]. */
export function profileSolid(b: ModelBuilder, pts: PP[], hw: number, side: Paint, o: ProfileOpts = {}): void {
  const n = pts.length;
  const cx = o.x ?? 0;
  // orientation in (z, y)
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    area += a.z * c.y - c.z * a.y;
  }
  const ccw = area > 0;
  const X = (p: PP, s: number) => cx + s * hw * (p.w ?? 1);
  // caps
  if (!o.noCaps) {
    b.paint(o.cap ?? side);
    const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p.z, p.y)), []);
    for (const s of [1, -1]) {
      for (const [i, j, k] of tris) {
        const A = pts[i], B = pts[j], C = pts[k];
        triOut(b, [X(A, s), A.y, A.z], [X(B, s), B.y, B.z], [X(C, s), C.y, C.z], [s, 0, 0]);
      }
    }
  }
  // bands
  for (let i = 0; i < n; i++) {
    const A = pts[i], C = pts[(i + 1) % n];
    if (A.p === null) continue;
    const dz = C.z - A.z, dy = C.y - A.y;
    // outward normal in (z,y): for CCW polygon it's (dy, -dz)
    let nz = dy, ny = -dz;
    if (!ccw) { nz = -nz; ny = -ny; }
    const l = Math.hypot(nz, ny) || 1;
    nz /= l; ny /= l;
    if (!o.keepBottom && ny < -0.7) continue;
    b.paint(A.p ?? side);
    quadOut(b, [X(A, 1), A.y, A.z], [X(C, 1), C.y, C.z], [X(C, -1), C.y, C.z], [X(A, -1), A.y, A.z], [0, ny, nz]);
  }
  b.paint(side);
}

/**
 * Wheel pair on one axle: prism along X from -hwOut to +hwOut (the middle is hidden under the body).
 * r = rolling radius (flat bottom touches y=0). seg 8 (28 tris) or 6 (20 tris) + 4 tris of hub caps.
 */
export function axle(b: ModelBuilder, z: number, r: number, hwOut: number, o: { seg?: number; tire?: ColorLike; hub?: ColorLike | null; hubR?: number; y?: number } = {}): void {
  const seg = o.seg ?? 8;
  const R = r / Math.cos(Math.PI / seg);
  const cy = (o.y ?? 0) + r;
  const ring: [number, number][] = [];
  for (let k = 0; k < seg; k++) {
    const a = ((k + 0.5) / seg) * Math.PI * 2 - Math.PI / 2;
    ring.push([cy + Math.sin(a) * R, z + Math.cos(a) * R]);
  }
  b.paint(o.tire ?? TIRE, Surf.Plain);
  for (let k = 0; k < seg; k++) {
    const [y0, z0] = ring[k], [y1, z1] = ring[(k + 1) % seg];
    const am = ((k + 1) / seg) * Math.PI * 2 - Math.PI / 2;
    quadOut(b, [hwOut, y0, z0], [hwOut, y1, z1], [-hwOut, y1, z1], [-hwOut, y0, z0], [0, Math.sin(am), Math.cos(am)]);
  }
  for (const s of [1, -1]) {
    for (let k = 1; k < seg - 1; k++) {
      triOut(b, [s * hwOut, ring[0][0], ring[0][1]], [s * hwOut, ring[k][0], ring[k][1]], [s * hwOut, ring[k + 1][0], ring[k + 1][1]], [s, 0, 0]);
    }
  }
  if (o.hub !== null) {
    // octagonal hub cap (6 tris per side)
    const h = (o.hubR ?? 0.55) * r;
    b.paint(o.hub ?? HUB, Surf.Metal);
    for (const s of [1, -1]) {
      const x = s * (hwOut + 0.012);
      const pts: V3[] = [];
      for (let k = 0; k < 8; k++) {
        const a = ((k + 0.5) / 8) * Math.PI * 2;
        pts.push([x, cy + Math.sin(a) * h, z + Math.cos(a) * h]);
      }
      polyOut(b, pts, [s, 0, 0]);
    }
  }
}

/** Light / decal quad on a plane z = const, facing +Z (dir 1) or -Z (dir -1). Mirrored pair when mirror=true. */
export function lamp(b: ModelBuilder, x0: number, x1: number, y0: number, y1: number, z: number, dir: 1 | -1, paint: Paint, mirror = true): void {
  b.paint(paint);
  const one = (a: number, c: number) => quadOut(b, [a, y0, z], [c, y0, z], [c, y1, z], [a, y1, z], [0, 0, dir]);
  one(x0, x1);
  if (mirror) one(-x1, -x0);
}

/** Headlight pair: like lamp() with HEAD paint, 20% larger around its center. */
export function headLamp(b: ModelBuilder, x0: number, x1: number, y0: number, y1: number, z: number, paint: Paint = HEAD): void {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = ((x1 - x0) / 2) * 1.2, hy = ((y1 - y0) / 2) * 1.2;
  lamp(b, cx - hx, cx + hx, cy - hy, cy + hy, z, 1, paint);
}

/** Rear-most (dir -1) or front-most (dir 1) z of the given profile polygons at height y (null if none crosses y). */
export function profileZAt(polys: PP[][], y: number, dir: 1 | -1): number | null {
  let best: number | null = null;
  for (const pts of polys) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      if ((a.y - y) * (c.y - y) > 0 || a.y === c.y) continue;
      const z = a.z + ((y - a.y) / (c.y - a.y)) * (c.z - a.z);
      if (best === null || z * dir > best * dir) best = z;
    }
  }
  return best;
}

/**
 * Tail-light pair that hugs a slanted rear profile, plus 0.3 m wrap-around quads on both sides (x = ±(hw + 0.012)).
 * x0..x1 = lamp span (mirrored), y0..y1 = height. ~12 tris.
 */
export function tailLamps(b: ModelBuilder, polys: PP[][], hw: number, x0: number, x1: number, y0: number, y1: number, paint: Paint = TAIL): void {
  const z0 = (profileZAt(polys, y0, -1) ?? -2) - 0.012;
  const z1 = (profileZAt(polys, y1, -1) ?? z0) - 0.012;
  b.paint(paint);
  for (const s of [1, -1]) {
    const a = s * x0, c = s * x1;
    quadOut(b, [a, y0, z0], [c, y0, z0], [c, y1, z1], [a, y1, z1], [0, 0, -1]);
  }
  sideQuad(b, hw + 0.012, [[z0 + 0.02, y0], [z0 + 0.32, y0], [z1 + 0.32, y1], [z1 + 0.02, y1]], paint);
}

/** Flat quad on the side plane x = ±x (facing outward), given (z, y) corners. Both sides when side = 0. */
export function sideQuad(b: ModelBuilder, x: number, c: [number, number][], paint: Paint, side: 1 | -1 | 0 = 0): void {
  b.paint(paint);
  for (const s of side === 0 ? [1, -1] : [side]) {
    const q = c.map(([z, y]) => [s * x, y, z] as V3);
    if (q.length === 4) quadOut(b, q[0], q[1], q[2], q[3], [s, 0, 0]);
    else triOut(b, q[0], q[1], q[2], [s, 0, 0]);
  }
}

/** Axis-aligned slanted-free rectangle on the side: z0..z1, y0..y1. */
export function sideRect(b: ModelBuilder, x: number, z0: number, z1: number, y0: number, y1: number, paint: Paint, side: 1 | -1 | 0 = 0): void {
  sideQuad(b, x, [[z0, y0], [z1, y0], [z1, y1], [z0, y1]], paint, side);
}

/** Horizontal quad facing up (top decals, rungs, hatches). */
export function topQuad(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, paint: Paint): void {
  b.paint(paint);
  quadOut(b, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0]);
}

/** Wheel-arch notch helper: returns profile points for an arch around axle z (bottom edge, traversed rear->front). */
export function arch(z: number, r: number, yBottom: number, clear = 0.06): PP[] {
  const top = 2 * r + clear;
  return [
    { z: z - r * 1.38, y: yBottom },
    { z: z - r * 1.02, y: top },
    { z: z + r * 1.02, y: top },
    { z: z + r * 1.38, y: yBottom },
  ];
}
