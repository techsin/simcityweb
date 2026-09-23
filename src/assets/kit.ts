/**
 * Shared detail kit for asset builders: lot dressing and small props drawn INTO a ModelBuilder.
 * Keep things cheap (tri counts noted). All coordinates are model space (meters, lot centered, front = +Z).
 */
import { ModelBuilder, PALETTE, type ColorLike } from './ModelBuilder';
import { Surf } from '../core/types';
import type { RNG } from '../core/rng';

export const CAR_COLORS = [0xb8bcc2, 0x2b2d31, 0xf1f1ef, 0x8a1c1c, 0x1f3f7a, 0x5d6b73, 0x3e5e3a, 0xc9a13b, 0x6b2f4a, 0xd96b2b];

/** Lawn slab over rect (2 tris + sides). */
export function lawn(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, color: ColorLike = PALETTE.grass, h = 0.06) {
  b.paint(color, Surf.Foliage).slab(x0, z0, x1, z1, h);
}

/** Pavement / concrete slab. */
export function pavement(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, color: ColorLike = PALETTE.sidewalk, h = 0.1) {
  b.paint(color, Surf.Pavement).slab(x0, z0, x1, z1, h);
}

/** Simple low-poly car (~26 tris) centered at (x,z), heading along +Z if rot = 0. */
export function car(b: ModelBuilder, x: number, z: number, rot: number, color: ColorLike, y = 0.1) {
  b.push().translate(x, y, z).rotateY(rot);
  b.paint(color, Surf.Metal).box(-0.9, 0.25, -2.2, 0.9, 0.95, 2.2, { bottom: null });
  b.paint(0x1a1f26, Surf.GlassPlain).box(-0.8, 0.95, -1.1, 0.8, 1.45, 1.0, { bottom: null });
  b.paint(color, Surf.Metal).box(-0.78, 1.45, -1.0, 0.78, 1.5, 0.9, { bottom: null, nx: null, px: null, pz: null, nz: null });
  b.paint(0x151515).box(-0.95, 0.0, -1.6, 0.95, 0.35, -1.0, { top: null }).box(-0.95, 0.0, 1.0, 0.95, 0.35, 1.6, { top: null });
  b.pop();
}

/**
 * Parking lot with striped stalls. Stalls run along X, cars nose toward -Z/+Z alternately per row.
 * fill = probability a stall has a car. (~ 2 tris per stall line + 26 per car)
 */
export function parkingLot(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, fill = 0.6) {
  b.paint(PALETTE.asphalt, Surf.Pavement).slab(x0, z0, x1, z1, 0.08);
  const stallW = 2.7, stallD = 5.2, aisle = 6.0;
  const rowPitch = stallD * 2 + aisle;
  for (let rz = z0 + 0.6; rz + stallD <= z1 - 0.3; rz += rowPitch) {
    for (const [zA, facing] of [[rz, 0], [rz + stallD + aisle, Math.PI]] as [number, number][]) {
      if (zA + stallD > z1 - 0.3) continue;
      for (let sx = x0 + 0.5; sx + stallW <= x1 - 0.4; sx += stallW) {
        b.paint(PALETTE.parkingLine, Surf.Plain).box(sx - 0.06, 0.08, zA, sx + 0.06, 0.1, zA + stallD, { bottom: null });
        if (rng.chance(fill)) car(b, sx + stallW / 2, zA + stallD / 2, facing, rng.pick(CAR_COLORS), 0.08);
      }
    }
  }
}

/** Picket / chain fence along a straight line (posts + 1 rail, ~12 tris per segment). */
export function fence(b: ModelBuilder, ax: number, az: number, bx: number, bz: number, h = 1.1, color: ColorLike = PALETTE.white, spacing = 2.5) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.round(len / spacing));
  b.paint(color, Surf.Wood);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    b.box(x - 0.07, 0, z - 0.07, x + 0.07, h, z + 0.07, { bottom: null });
  }
  b.beam([ax, h * 0.75, az], [bx, h * 0.75, bz], 0.08);
  b.beam([ax, h * 0.35, az], [bx, h * 0.35, bz], 0.08);
}

/** Hedge box. */
export function hedge(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h = 1.2, color: ColorLike = PALETTE.hedge) {
  b.paint(color, Surf.Foliage).box(x0, 0, z0, x1, h, z1, { bottom: null });
}

/** Small lot tree (trunk + 1-2 blobs, ~48 tris). */
export function lotTree(b: ModelBuilder, rng: RNG, x: number, z: number, scale = 1, kind: 'round' | 'cone' = rng.chance(0.7) ? 'round' : 'cone') {
  const s = scale * rng.range(0.8, 1.2);
  b.paint(PALETTE.trunk, Surf.Wood).cylinder(x, z, 0, 2.2 * s, 0.22 * s, 0.16 * s, 5, { top: false });
  const g = rng.pick([0x4f7a32, 0x5a8a3a, 0x3f6b2e, 0x6b8f3a]);
  if (kind === 'round') {
    b.paint(g, Surf.Foliage).blob(x, 3.6 * s, z, 2.1 * s, 1.9 * s, 2.1 * s, 0, 0.15, rng.next() * 10);
  } else {
    b.paint(0x2f5a2e, Surf.Foliage).cone(x, z, 1.4 * s, 5.5 * s, 1.7 * s, 7);
  }
}

/** Rooftop HVAC unit (~10 tris). */
export function acUnit(b: ModelBuilder, x: number, y: number, z: number, s = 1) {
  b.paint(0xa8acb0, Surf.Metal).box(x - 0.9 * s, y, z - 0.7 * s, x + 0.9 * s, y + 0.9 * s, z + 0.7 * s, { bottom: null });
  b.paint(0x3a3d40, Surf.Metal).cylinder(x, z, y + 0.9 * s, 0.08, 0.5 * s, 0.5 * s, 8, { top: true });
}

/** Scatter rooftop clutter (AC units, vents, access hut) on a flat roof rect at height y. */
export function roofClutter(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, y: number, amount = 3) {
  const w = x1 - x0, d = z1 - z0;
  if (w < 4 || d < 4) return;
  // parapet
  b.paint(PALETTE.concreteDark, Surf.Plain);
  const t = 0.25, ph = 0.8;
  b.box(x0, y, z0, x1, y + ph, z0 + t, { bottom: null }).box(x0, y, z1 - t, x1, y + ph, z1, { bottom: null });
  b.box(x0, y, z0 + t, x0 + t, y + ph, z1 - t, { bottom: null }).box(x1 - t, y, z0 + t, x1, y + ph, z1 - t, { bottom: null });
  for (let i = 0; i < amount; i++) {
    const cx = rng.range(x0 + 1.5, x1 - 1.5), cz = rng.range(z0 + 1.5, z1 - 1.5);
    acUnit(b, cx, y, cz, rng.range(0.7, 1.3));
  }
  if (rng.chance(0.6) && w > 8 && d > 8) {
    const hx = rng.range(x0 + 2, x1 - 4), hz = rng.range(z0 + 2, z1 - 4);
    b.paint(PALETTE.concrete, Surf.Plain).box(hx, y, hz, hx + 2.6, y + 2.6, hz + 2.2, { bottom: null });
  }
}

/** Water tank on legs (classic NYC rooftop), ~40 tris. */
export function rooftopWaterTank(b: ModelBuilder, x: number, y: number, z: number, s = 1) {
  b.paint(PALETTE.metalDark, Surf.Metal);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(x + dx * 0.9 * s - 0.08, y, z + dz * 0.9 * s - 0.08, x + dx * 0.9 * s + 0.08, y + 1.6 * s, z + dz * 0.9 * s + 0.08);
  b.paint(0x7a5a3a, Surf.Wood).cylinder(x, z, y + 1.6 * s, 2.4 * s, 1.3 * s, 1.3 * s, 8, { top: false });
  b.paint(PALETTE.roofGrey, Surf.Plain).cone(x, z, y + 4.0 * s, 0.8 * s, 1.35 * s, 8, false);
}

/** Awning over a storefront on the +Z face at height y (w wide), colored stripes. */
export function awning(b: ModelBuilder, cx: number, zFace: number, w: number, y: number, color: ColorLike, depth = 1.4) {
  b.paint(color, Surf.Plain);
  b.quad2([cx - w / 2, y, zFace], [cx + w / 2, y, zFace], [cx + w / 2, y - 0.7, zFace + depth], [cx - w / 2, y - 0.7, zFace + depth]);
  b.box(cx - w / 2, y - 1.0, zFace + depth - 0.05, cx + w / 2, y - 0.7, zFace + depth + 0.02, { bottom: null });
}

/** Emissive sign box (glows at night). */
export function signBox(b: ModelBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: ColorLike, frame: ColorLike = 0x222222) {
  b.paint(frame, Surf.Metal).box(x0 - 0.05, y0 - 0.05, z0 - 0.05, x1 + 0.05, y1 + 0.05, z1 + 0.05);
  b.paint(color, Surf.Emissive).box(x0, y0, z1 + 0.01, x1, y1, z1 + 0.06, { top: null, bottom: null, nx: null, px: null, nz: null });
}

/** Flag pole with flag (~20 tris). */
export function flagPole(b: ModelBuilder, x: number, z: number, h = 9, flag: ColorLike = 0x2e6fb5) {
  b.paint(0xdddddd, Surf.Metal).cylinder(x, z, 0, h, 0.09, 0.06, 5);
  b.paint(flag, Surf.Plain).quad2([x, h - 0.2, z], [x + 2.2, h - 0.2, z], [x + 2.2, h - 1.5, z], [x, h - 1.5, z]);
}

/** Street / park lamp post with emissive head (~20 tris). */
export function lampPost(b: ModelBuilder, x: number, z: number, h = 4.5) {
  b.paint(0x2a2c2e, Surf.Metal).cylinder(x, z, 0, h, 0.08, 0.06, 5, { top: false });
  b.paint(0xfff0c8, Surf.Emissive).boxC(x, z, 0.35, 0.35, h, 0.35);
}

/** Bench (~18 tris). */
export function bench(b: ModelBuilder, x: number, z: number, rot = 0) {
  b.push().translate(x, 0, z).rotateY(rot);
  b.paint(0x7a5a3a, Surf.Wood).box(-0.9, 0.42, -0.25, 0.9, 0.5, 0.25).box(-0.9, 0.5, -0.3, 0.9, 0.95, -0.22);
  b.paint(0x333333, Surf.Metal).box(-0.8, 0, -0.2, -0.7, 0.42, 0.2).box(0.7, 0, -0.2, 0.8, 0.42, 0.2);
  b.pop();
}

/** Pool with deck (~20 tris). */
export function pool(b: ModelBuilder, cx: number, cz: number, w: number, d: number) {
  b.paint(0xe8e2d4, Surf.Pavement).boxC(cx, cz, w + 1.6, d + 1.6, 0, 0.14);
  b.paint(0x3fb0d8, Surf.Water).boxC(cx, cz, w, d, 0.0, 0.16, { bottom: null });
}

/** Stack of pallets / crates / barrels for industrial yards. */
export function yardClutter(b: ModelBuilder, rng: RNG, x0: number, z0: number, x1: number, z1: number, n = 6) {
  for (let i = 0; i < n; i++) {
    const x = rng.range(x0 + 1, x1 - 1), z = rng.range(z0 + 1, z1 - 1);
    const k = rng.int(0, 2);
    if (k === 0) b.paint(0x9a7a4e, Surf.Wood).boxC(x, z, 1.2, 1.0, 0, rng.range(0.5, 1.6));
    else if (k === 1) b.paint(rng.pick([0x2e6fb5, 0xb03a2e, 0x3d7a3d, 0x555555]), Surf.Metal).cylinder(x, z, 0, 0.9, 0.3, 0.3, 6);
    else b.paint(rng.pick([0xb03a2e, 0x2e6fb5, 0xd9a324, 0x2f7f6f, 0x7a7a7a]), Surf.Corrugated).boxC(x, z, 2.4, 6.0, 0, 2.6);
  }
}

/** Shipping container (6m or 12m) along X. */
export function container(b: ModelBuilder, x: number, y: number, z: number, long: boolean, color: ColorLike, rotY = 0) {
  b.push().translate(x, y, z).rotateY(rotY);
  const L = long ? 12.2 : 6.1;
  b.paint(color, Surf.Corrugated).box(-L / 2, 0, -1.22, L / 2, 2.6, 1.22);
  b.pop();
}
