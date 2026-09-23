/**
 * Procedural models for the 'transport' group. See src/assets/manifest.ts for ids, footprints and descriptions,
 * and src/assets/ModelBuilder.ts for the modeling API.
 *
 * Small lots (bus stop, subway entrance, parking garage) live here; the big lots are in
 *   tr_air.ts  (airports), tr_port.ts (seaport, ferry terminal — water on +Z), tr_rail.ts (train + freight stations).
 * Shared helpers: tr_kit.ts.
 */
import type { ModelBuilders } from '../registry';
import type { ModelBuilder } from '../ModelBuilder';
import type { RNG } from '../../core/rng';
import { Surf } from '../../core/types';
import { bench, lampPost } from '../kit';
import { airModels } from './tr_air';
import { portModels } from './tr_port';
import { railModels } from './tr_rail';
import { flat, dashed, tree, shrub, carLite, vault, obox, quadF, panel, disc, lightDot, CAR_COLS, type V3 } from './tr_kit';

// ---------------------------------------------------------------------------------------------- bus stop
function busStop(b: ModelBuilder, rng: RNG): void {
  // lawn at the back, sidewalk + tactile strip along the street edge
  b.paint(0x76a04a, Surf.Foliage).slab(-8, -8, 8, 2.4, 0.06);
  b.paint(0xc9c4b8, Surf.Pavement).box(-8, 0, 2.4, 8, 0.14, 8, { bottom: null });
  b.paint(0xa8a398, Surf.Pavement).box(-8, 0, 7.55, 8, 0.2, 8, { bottom: null });
  b.paint(0xe0b822, Surf.Plain);
  flat(b, -3.6, 6.6, 3.6, 7.1, 0.16);
  // paved path into the little park + a seat corner
  b.paint(0xc9c4b8, Surf.Pavement).box(-1.1, 0, -5.5, 1.1, 0.1, 2.4, { bottom: null });
  b.paint(0xc9c4b8, Surf.Pavement).box(-6, 0, -7.2, 6, 0.1, -3.8, { bottom: null });
  bench(b, -3.2, -6.6, 0);
  bench(b, 3.2, -6.6, 0);
  // ---- shelter: steel frame, glass back + side, thin roof with downlight, ad lightbox
  const sx0 = -3.3, sx1 = 3.3, sz0 = 4.0, sz1 = 5.9, H = 2.65;
  b.paint(0x33373b, Surf.Metal);
  for (const x of [sx0, sx1]) for (const z of [sz0, sz1 - 0.1]) b.box(x - 0.06, 0.14, z - 0.06, x + 0.06, H, z + 0.06, { top: null, bottom: null });
  b.paint(0x8fb3c4, Surf.GlassCurtain, 4, 2.4).box(sx0, 0.3, sz0 - 0.03, sx1, 2.35, sz0 + 0.03, { top: null, bottom: null });
  b.paint(0x8fb3c4, Surf.GlassCurtain, 4, 2.4).box(sx0 - 0.03, 0.3, sz0, sx0 + 0.03, 2.35, sz1 - 0.4, { top: null, bottom: null });
  b.paint(0x3d4247, Surf.Metal).box(sx0 - 0.25, H, sz0 - 0.3, sx1 + 0.25, H + 0.16, sz1 + 0.35, { bottom: { color: 0xd9d6cf, surf: Surf.Plain } });
  b.paint(0xfff3d6, Surf.Emissive).box(sx0 + 0.3, H - 0.05, sz0 + 0.4, sx1 - 0.3, H, sz0 + 0.7, { top: null });
  // ad lightbox on the right end
  b.paint(0x2b2e32, Surf.Metal).box(sx1 - 0.08, 0.2, sz0 + 0.1, sx1 + 0.12, 2.3, sz1 - 0.3);
  b.paint(0x2a8fd8, Surf.Emissive).box(sx1 + 0.12, 0.35, sz0 + 0.2, sx1 + 0.15, 2.15, sz1 - 0.4, { top: null, bottom: null, nx: null, pz: null, nz: null });
  b.paint(0xf4b73a, Surf.Emissive).box(sx1 - 0.11, 0.35, sz0 + 0.2, sx1 - 0.08, 2.15, sz1 - 0.4, { top: null, bottom: null, px: null, pz: null, nz: null });
  // bench inside + bin
  bench(b, -0.8, sz0 + 0.55, 0);
  b.paint(0x4a5a4a, Surf.Metal).cylinder(sx0 - 0.8, sz1 + 0.2, 0.14, 0.9, 0.28, 0.28, 8, { top: true, topPaint: { color: 0x222222, surf: Surf.Metal } });
  // bus stop sign pole with emissive flag + timetable
  const px = -5.2, pz = 6.9;
  b.paint(0x8a9096, Surf.Metal).cylinder(px, pz, 0.14, 3.2, 0.06, 0.06, 6, { top: false });
  b.paint(0x1f4fa0, Surf.Metal).box(px - 0.05, 2.5, pz - 0.45, px + 0.05, 3.3, pz + 0.45);
  b.paint(0xf5f7ff, Surf.Emissive);
  panel(b, 'x', 1, px + 0.06, pz - 0.3, pz + 0.3, 2.65, 3.15);
  panel(b, 'x', -1, px - 0.06, pz - 0.3, pz + 0.3, 2.65, 3.15);
  b.paint(0xf1c40f, Surf.Plain).box(px - 0.2, 1.3, pz - 0.02, px + 0.2, 1.9, pz + 0.12);
  // planter + small trees + shrubs in the lawn
  tree(b, rng, -5.4, -1.6, 4.4);
  tree(b, rng, 5.3, -2.4, 4.0);
  shrub(b, rng, -6.6, 1.6, 0.8);
  shrub(b, rng, 6.4, 1.3, 0.9);
  shrub(b, rng, 2.6, 1.4, 0.7);
  // bike rack (inverted-U hoops) with a parked bike
  b.paint(0x7a8086, Surf.Metal);
  for (let i = 0; i < 3; i++) bikeHoop(b, 4.6 + i * 0.8, 3.15);
  b.paint(0xb03a2e, Surf.Metal);
  obox(b, [4.95, 0.55, 2.55], [4.95, 0.55, 3.75], 0.07, 0.07);
  b.paint(0x222222, Surf.Metal);
  for (const z of [2.55, 3.75]) for (const sg of [1, -1] as const) disc(b, [4.95 + sg * 0.03, 0.47, z], 0.33, 8, 'x', sg);
  lampPost(b, 6.8, 6.9, 4.0);
}

/** Inverted-U bike hoop in the YZ plane at x (24 tris). */
function bikeHoop(b: ModelBuilder, x: number, z: number): void {
  obox(b, [x, 0.12, z - 0.4], [x, 0.85, z - 0.4], 0.06, 0.06, { ends: false });
  obox(b, [x, 0.12, z + 0.4], [x, 0.85, z + 0.4], 0.06, 0.06, { ends: false });
  obox(b, [x, 0.85, z - 0.43], [x, 0.85, z + 0.43], 0.06, 0.06);
}

// ---------------------------------------------------------------------------------------------- subway entrance
function subwayEntrance(b: ModelBuilder, rng: RNG): void {
  // plaza pavers with a darker border; planters at the corners
  b.paint(0xb3aea3, Surf.Pavement).box(-8, 0, -8, 8, 0.12, 8, { bottom: null });
  b.paint(0xcfcac0, Surf.Pavement).box(-7.2, 0, -7.2, 7.2, 0.15, 7.6, { bottom: null });
  for (const [x, z] of [[-5.6, -5.4], [5.6, -5.4]] as [number, number][]) {
    b.paint(0x8a857c, Surf.Stone).box(x - 1.6, 0, z - 1.6, x + 1.6, 0.55, z + 1.6, { bottom: null, top: { color: 0x5a4632, surf: Surf.Plain } });
    tree(b, rng, x, z, 5.4);
  }
  // ---- stairwell (descending toward -Z): parapet walls + treads fading into darkness
  const w0 = -2.1, w1 = 2.1, zTop = 3.6, zBot = -4.2;
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const za = zTop - ((zTop - zBot) * i) / steps, zb = zTop - ((zTop - zBot) * (i + 1)) / steps;
    const k = Math.pow(1 - t, 1.6);
    const c = Math.round(18 + 150 * k);
    b.paint((c << 16) | (c << 8) | Math.round(c * 0.97), Surf.Plain);
    flat(b, w0, zb, w1, za, 0.16);
    b.paint(Math.round(c * 0.6) * 0x10101, Surf.Plain);
    flat(b, w0, za - 0.12, w1, za, 0.165);
  }
  b.paint(0x0b0c0d, Surf.Plain);
  flat(b, w0, zBot - 0.8, w1, zBot, 0.16);
  // parapet walls (granite) with steel handrail
  b.paint(0x6f6b66, Surf.Stone);
  b.box(w0 - 0.35, 0, zBot - 1.1, w0, 1.05, zTop, { bottom: null });
  b.box(w1, 0, zBot - 1.1, w1 + 0.35, 1.05, zTop, { bottom: null });
  b.box(w0 - 0.35, 0, zBot - 1.1, w1 + 0.35, 1.05, zBot - 0.75, { bottom: null });
  // ---- curved glass canopy over the stairs (open toward the street)
  b.paint(0x9cc0d4, Surf.GlassCurtain, 5, 1.2);
  vault(b, 0, (zTop + zBot - 0.9) / 2 + 0.1, 4.9, zTop - zBot + 1.1, 2.3, 1.35, 'z', { seg: 8, endMask: [true, false] });
  // steel ribs + side glass
  b.paint(0x3b4046, Surf.Metal);
  for (const z of [zTop + 0.2, (zTop + zBot) / 2 - 0.3, zBot - 0.9]) vault(b, 0, z, 5.05, 0.18, 2.3, 1.42, 'z', { seg: 8, ends: null });
  for (const sx of [-1, 1]) for (const z of [zTop + 0.2, zBot - 0.9]) b.box(sx * 2.45 - 0.06, 1.05, z - 0.09, sx * 2.45 + 0.06, 2.3, z + 0.09, { top: null, bottom: null });
  b.paint(0x9cc0d4, Surf.GlassCurtain, 5, 1.2);
  for (const sx of [-1, 1]) b.box(sx * 2.42 - 0.03, 1.05, zBot - 0.9, sx * 2.42 + 0.03, 2.3, zTop + 0.2, { top: null, bottom: null });
  // glowing band on the canopy's front rib
  b.paint(0x1f4fa0, Surf.Metal).box(-2.5, 2.3, zTop + 0.2, 2.5, 2.55, zTop + 0.34, { bottom: null });
  // ---- totem sign with emissive "M" logo (glows at night)
  const tx = 3.9, tz = 5.0, ty = 3.7, ts = 1.3;
  b.paint(0x2c3035, Surf.Metal).box(tx - 0.13, 0.15, tz - 0.13, tx + 0.13, ty, tz + 0.13, { top: null, bottom: null });
  b.paint(0xf4f4f0, Surf.Emissive).boxC(tx, tz, ts, ts, ty, ts);
  b.paint(0xd42a2a, Surf.Emissive);
  mLogo(b, [tx, ty + ts / 2, tz + ts / 2 + 0.02], ts * 0.72, 'z', 1);
  mLogo(b, [tx, ty + ts / 2, tz - ts / 2 - 0.02], ts * 0.72, 'z', -1);
  mLogo(b, [tx + ts / 2 + 0.02, ty + ts / 2, tz], ts * 0.72, 'x', 1);
  mLogo(b, [tx - ts / 2 - 0.02, ty + ts / 2, tz], ts * 0.72, 'x', -1);
  // plaza dressing: benches, lamps, bike rack, kiosk, bollards
  bench(b, -5.6, 1.4, Math.PI / 2);
  bench(b, 5.8, 0.4, -Math.PI / 2);
  lampPost(b, -4.2, 6.8, 4.2);
  lampPost(b, 6.8, -1.8, 4.2);
  b.paint(0x2a5d44, Surf.Metal).box(-7.0, 0.15, 3.2, -4.8, 2.5, 5.0, { top: { color: 0x3a3d40, surf: Surf.Metal } });
  b.paint(0xfff1d0, Surf.GlassPlain).box(-4.82, 0.9, 3.4, -4.78, 2.1, 4.8, { top: null, bottom: null, nx: null, pz: null, nz: null });
  b.paint(0x55595e, Surf.Metal);
  for (let i = 0; i < 4; i++) bikeHoop(b, -1.5 + i * 0.9, -6.6);
  for (let x = -6.5; x <= 6.6; x += 2.6) if (Math.abs(x) > 2.8) b.paint(0x3a3d40, Surf.Metal).cylinder(x, 7.75, 0.15, 0.85, 0.12, 0.12, 6, { top: true });
}

/** Stroked "M" logo on a vertical face (centre c, size s). */
function mLogo(b: ModelBuilder, c: V3, s: number, axis: 'x' | 'z', sign: 1 | -1): void {
  const h = s / 2, t = s * 0.14;
  const dir: V3 = axis === 'x' ? [sign, 0, 0] : [0, 0, sign];
  const P = (u: number, v: number): V3 => (axis === 'x' ? [c[0], c[1] + v, c[2] - sign * u] : [c[0] + sign * u, c[1] + v, c[2]]);
  const bar = (u0: number, v0: number, u1: number, v1: number) => {
    // thick line from (u0,v0) to (u1,v1)
    const du = u1 - u0, dv = v1 - v0, L = Math.hypot(du, dv);
    const nu = (-dv / L) * (t / 2), nv = (du / L) * (t / 2);
    quadF(b, P(u0 + nu, v0 + nv), P(u1 + nu, v1 + nv), P(u1 - nu, v1 - nv), P(u0 - nu, v0 - nv), dir);
  };
  bar(-h + t / 2, -h, -h + t / 2, h);
  bar(h - t / 2, -h, h - t / 2, h);
  bar(-h + t / 2, h - t / 2, 0, -h * 0.25);
  bar(0, -h * 0.25, h - t / 2, h - t / 2);
}

// ---------------------------------------------------------------------------------------------- parking garage
function parkingGarage(b: ModelBuilder, rng: RNG): void {
  const x0 = -14, x1 = 14, z0 = -14.5, z1 = 11;
  const decks = [3.1, 6.2, 9.3, 12.4];
  const roofY = decks[decks.length - 1];
  const slabT = 0.38;
  const conc = 0xcfcbc2, concDark = 0xa9a59c, accent = 0x2e7fb8;
  // ground: sidewalk band + driveway + ground floor asphalt, landscaped strip at the sides
  b.paint(0x7aa04c, Surf.Foliage).slab(-16, -16, 16, 16, 0.05);
  b.paint(0xc9c4b8, Surf.Pavement).box(-16, 0, 11, 16, 0.14, 16, { bottom: null });
  b.paint(0x404145, Surf.Pavement).box(x0, 0, z0, x1, 0.1, z1, { bottom: null });
  b.paint(0x404145, Surf.Pavement).box(3.5, 0, 11, 12.5, 0.15, 16, { bottom: null });
  b.paint(0xf2f0ea, Surf.Plain);
  dashed(b, 8, 11.2, 8, 15.8, 0.15, 0.2, 1.2, 0.8);
  // perimeter columns (full height)
  b.paint(concDark, Surf.Plain);
  const colX = [x0, -7, 0, 7, x1], colZ = [z0, z0 + (z1 - z0) / 3, z0 + (2 * (z1 - z0)) / 3, z1];
  for (const x of colX) for (const z of [z0, z1]) b.box(x - 0.28, 0, z - 0.28, x + 0.28, roofY, z + 0.28, { top: null, bottom: null });
  for (const z of colZ.slice(1, -1)) for (const x of [x0, x1]) b.box(x - 0.28, 0, z - 0.28, x + 0.28, roofY, z + 0.28, { top: null, bottom: null });
  // decks: slab + spandrel ring + ceiling lights
  const rampX0 = x0 + 0.35, rampX1 = -8.2, rampZ0 = -12, rampZ1 = 2.5;
  for (const y of decks) {
    const roof = y === roofY;
    b.paint(conc, Surf.Plain);
    const top = { color: roof ? 0x55565a : 0x77787b, surf: Surf.Pavement };
    if (!roof) b.box(x0, y - slabT, z0, x1, y, z1, { top });
    else {
      b.box(x0, y - slabT, rampZ1, x1, y, z1, { top });
      b.box(rampX1, y - slabT, z0, x1, y, rampZ1, { top });
      b.box(x0, y - slabT, z0, rampX1, y, rampZ0, { top });
    }
    // spandrel ring (outer face + top + inner face)
    const t = 0.22, sh = 1.05;
    b.paint(roof ? 0xe4e1da : conc, Surf.Plain);
    b.box(x0 - 0.25, y, z1 - t + 0.25, x1 + 0.25, y + sh, z1 + 0.25, { bottom: null });
    b.box(x0 - 0.25, y, z0 - 0.25, x1 + 0.25, y + sh, z0 + t - 0.25, { bottom: null });
    b.box(x0 - 0.25, y, z0 + t - 0.25, x0 - 0.25 + t, y + sh, z1 - t + 0.25, { bottom: null });
    b.box(x1 + 0.25 - t, y, z0 + t - 0.25, x1 + 0.25, y + sh, z1 - t + 0.25, { bottom: null });
    // slab edge band (darker) under the spandrel
    b.paint(roof ? accent : concDark, Surf.Plain).box(x0 - 0.27, y - slabT, z1 + 0.2, x1 + 0.27, y, z1 + 0.27, { top: null, bottom: null, nz: null });
    b.paint(roof ? accent : concDark, Surf.Plain).box(x1 + 0.2, y - slabT, z0 - 0.27, x1 + 0.27, y, z1 + 0.27, { top: null, bottom: null, nx: null });
    // ceiling light strips of the level below (visible through the openings, glow at night)
    const ly = y - slabT - 0.1;
    b.paint(0xf4f8ff, Surf.Emissive);
    b.box(x0 + 1.2, ly, z1 - 1.6, x1 - 1.2, ly + 0.1, z1 - 1.4, { top: null, nz: null, px: null, nx: null, bottom: { color: 0xf4f8ff, surf: Surf.Emissive } });
    b.box(x1 - 1.6, ly, z0 + 1.2, x1 - 1.4, ly + 0.1, z1 - 1.2, { top: null, nz: null, pz: null, nx: null, bottom: { color: 0xf4f8ff, surf: Surf.Emissive } });
    b.box(x0 + 1.4, ly, z0 + 1.2, x0 + 1.6, ly + 0.1, z1 - 1.2, { top: null, nz: null, pz: null, px: null, bottom: { color: 0xf4f8ff, surf: Surf.Emissive } });
    b.box(x0 + 1.2, ly, z0 + 1.4, x1 - 1.2, ly + 0.1, z0 + 1.6, { top: null, pz: null, px: null, nx: null, bottom: { color: 0xf4f8ff, surf: Surf.Emissive } });
  }
  // parked cars on every level (perimeter rows show through the openings)
  const levelY = [0.1, ...decks];
  const nX = 10, pitch = 2.6, sx0 = -((nX - 1) * pitch) / 2;
  for (const y of levelY) {
    const roof = y === roofY;
    const ground = y < 1;
    for (let i = 0; i < nX; i++) {
      const x = sx0 + i * pitch;
      if (!(ground && x > 2.5)) if (rng.chance(roof ? 0.5 : 0.7)) carLite(b, x, z1 - 3.0, 0, rng.pick(CAR_COLS), y);
      if (!(roof && x < rampX1 + 1.4)) if (rng.chance(roof ? 0.45 : 0.45)) carLite(b, x, z0 + 3.0, Math.PI, rng.pick(CAR_COLS), y);
    }
    for (let z = z0 + 7.2; z <= z1 - 7; z += pitch) {
      if (rng.chance(0.6)) carLite(b, x1 - 3.0, z, Math.PI / 2, rng.pick(CAR_COLS), y);
      if (!roof && rng.chance(0.4)) carLite(b, x0 + 3.0, z, -Math.PI / 2, rng.pick(CAR_COLS), y);
    }
    if (roof) {
      // central double row + stall lines
      for (let i = 0; i < 7; i++) {
        const x = -5.2 + i * pitch;
        if (rng.chance(0.45)) carLite(b, x, -3.6, Math.PI, rng.pick(CAR_COLS), y);
        if (rng.chance(0.45)) carLite(b, x, 1.4, 0, rng.pick(CAR_COLS), y);
      }
      b.paint(0xeeeeea, Surf.Plain);
      for (let i = 0; i <= nX; i++) {
        const x = sx0 - pitch / 2 + i * pitch;
        flat(b, x - 0.06, z1 - 5.4, x + 0.06, z1 - 0.6, y + 0.03);
        if (x > rampX1) flat(b, x - 0.06, z0 + 0.6, x + 0.06, z0 + 5.4, y + 0.03);
      }
      for (let i = 0; i <= 7; i++) flat(b, -6.5 + i * pitch - 0.06, -6.0, -6.5 + i * pitch + 0.06, 3.8, y + 0.03);
    }
  }
  // roof ramp (descending toward the front) with inner curb wall
  b.paint(0x606166, Surf.Pavement);
  quadF(b, [rampX0, roofY, rampZ0], [rampX1, roofY, rampZ0], [rampX1, decks[2], rampZ1], [rampX0, decks[2], rampZ1], [0, 1, 0]);
  b.paint(0xf2f0ea, Surf.Plain);
  const rm = (rampX0 + rampX1) / 2;
  quadF(b, [rm - 0.08, roofY + 0.03, rampZ0 + 0.5], [rm + 0.08, roofY + 0.03, rampZ0 + 0.5], [rm + 0.08, decks[2] + 0.03, rampZ1 - 0.5], [rm - 0.08, decks[2] + 0.03, rampZ1 - 0.5], [0, 1, 0]);
  b.paint(conc, Surf.Plain);
  obox(b, [rampX1 + 0.12, roofY + 0.5, rampZ0], [rampX1 + 0.12, decks[2] + 0.5, rampZ1], 0.24, 1.0);
  // ---- stair / lift core with glazing and big emissive "P"
  const cx0 = x0 - 0.2, cx1 = -9.2, cz0 = z1 - 0.3, cz1 = 14.6, cH = 15.6;
  b.paint(0xd6d2ca, Surf.Plain).box(cx0, 0, cz0, cx1, cH, cz1, {
    pz: { color: 0x86aec6, surf: Surf.GlassCurtain, pattern: 5, floor: 3.1 },
    top: { color: 0x8a8780, surf: Surf.RoofFlat },
  });
  b.paint(0xd6d2ca, Surf.Plain).box(cx0 + 0.6, cH, cz0 + 0.5, cx1 - 0.8, cH + 1.4, cz1 - 0.6, { top: { color: 0x8a8780, surf: Surf.RoofFlat } });
  const pX = (cx0 + cx1) / 2, pY0 = cH - 3.6, pS = 2.8;
  b.paint(0x1f5fb0, Surf.Emissive).box(pX - pS / 2, pY0, cz1, pX + pS / 2, pY0 + pS, cz1 + 0.12);
  b.paint(0xffffff, Surf.Emissive);
  const pz = cz1 + 0.14, u = pS / 2;
  panel(b, 'z', 1, pz, pX - u * 0.5, pX - u * 0.22, pY0 + pS * 0.14, pY0 + pS * 0.86);
  panel(b, 'z', 1, pz, pX - u * 0.22, pX + u * 0.45, pY0 + pS * 0.74, pY0 + pS * 0.86);
  panel(b, 'z', 1, pz, pX - u * 0.22, pX + u * 0.45, pY0 + pS * 0.44, pY0 + pS * 0.56);
  panel(b, 'z', 1, pz, pX + u * 0.33, pX + u * 0.55, pY0 + pS * 0.44, pY0 + pS * 0.86);
  // entrance: barrier arms, pay station, green "IN" sign
  b.paint(0x5a5f64, Surf.Metal).box(7.6, 0.15, 10.4, 8.4, 1.25, 11.2, { bottom: null });
  b.paint(0xd23a2a, Surf.Plain).box(4.2, 1.0, 10.72, 7.6, 1.1, 10.88, { bottom: null });
  b.paint(0xf2f2ee, Surf.Plain).box(8.4, 1.0, 10.72, 11.8, 1.1, 10.88, { bottom: null });
  b.paint(0x2bd45a, Surf.Emissive).box(4.5, 3.0 + 0.3, z1 + 0.27, 7.5, 3.0 + 0.9, z1 + 0.32, { top: null, bottom: null, nz: null, px: null, nx: null });
  b.paint(0xff4030, Surf.Emissive).box(8.5, 3.0 + 0.3, z1 + 0.27, 11.5, 3.0 + 0.9, z1 + 0.32, { top: null, bottom: null, nz: null, px: null, nx: null });
  // roof lights + aviation-style corner lights
  for (const [x, z] of [[-6, -7], [9, -7], [-3, 7.5], [9, 7.5]] as [number, number][]) {
    b.push().translate(0, roofY, 0);
    lampPost(b, x, z, 4.0);
    b.pop();
  }
  lightDot(b, x1, roofY + 1.05, z0, 0.35, 0xff3322);
  // landscaping at the sides
  shrub(b, rng, 15.1, -8, 0.85);
  shrub(b, rng, 15.1, -1, 0.8);
  shrub(b, rng, 15.1, 6, 0.85);
  tree(b, rng, 13.6, 13.6, 5.5);
  shrub(b, rng, -15.2, -6, 0.8);
  shrub(b, rng, -15.2, 2, 0.8);
  shrub(b, rng, 14.4, 13.2, 0.8);
}

export const models: ModelBuilders = {
  tr_bus_stop: (b, _v, rng) => busStop(b, rng),
  tr_subway_station: (b, _v, rng) => subwayEntrance(b, rng),
  tr_parking_garage: (b, _v, rng) => parkingGarage(b, rng),
  ...railModels,
  ...portModels,
  ...airModels,
};
