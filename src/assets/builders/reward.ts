/**
 * Procedural models for the 'reward' group (business deals / mayor rewards): military base, casino, toxic dump,
 * missile range, research center. See src/assets/manifest.ts and src/assets/builders/civ_kit.ts (shared helpers).
 */
import type { ModelBuilders } from '../registry';
import type { ModelBuilder, ColorLike } from '../ModelBuilder';
import type { RNG } from '../../core/rng';
import { PALETTE } from '../ModelBuilder';
import { Surf } from '../../core/types';
import {
  CIV, FLAGS, pnt, flat, stripe, disc, annulus, vrect, triH, quadH, vault, helipad, flag, wallSign, meshFence, tree, palm, conifer,
  lamp, miniCar, parking, cruiser, bus, jet, helicopter, guardTower, dish, radarBar, tank, antennaMast, planter, benchAt, CAR_COLS,
  colonnade, type V3,
} from './civ_kit';

// ------------------------------------------------------------------------------------------------ local helpers
function slabC(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, color: ColorLike, surf: Surf, h = 0.08, y0 = 0) {
  b.paint(color, surf).slab(x0, z0, x1, z1, h, y0);
}
/** Perimeter fence cheap enough for huge lots: posts every `spacing` m + mesh panel + top rail. */
function perimeter(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h: number, gap?: [number, number], spacing = 12, post: ColorLike = 0x5a5f64) {
  const run = (ax: number, az: number, bx: number, bz: number) => meshFence(b, ax, az, bx, bz, h, 0x8f969c, post, spacing);
  run(x0, z0, x1, z0);
  run(x0, z0, x0, z1);
  run(x1, z0, x1, z1);
  if (gap) {
    run(x0, z1, gap[0], z1);
    run(gap[1], z1, x1, z1);
  } else run(x0, z1, x1, z1);
}
/** Irregular blob polygon (x,z) around a center */
function blobPoly(rng: RNG, cx: number, cz: number, rx: number, rz: number, n = 9, jitter = 0.3): [number, number][] {
  const pts: [number, number][] = [];
  const a0 = rng.next() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const k = 1 + rng.range(-jitter, jitter);
    pts.push([cx + Math.cos(a) * rx * k, cz + Math.sin(a) * rz * k]);
  }
  return pts;
}
/** Up-facing flat polygon (fan from centroid; for star-shaped blobs). */
function flatPoly(b: ModelBuilder, pts: [number, number][], y: number) {
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    triH(b, [cx, y, cz], [ax, y, az], [bx, y, bz], [0, 1, 0]);
  }
}
/** Alternating yellow/black diagonal hazard stripes on a +Z facing rect (local), rotated by rotY about origin. */
function hazardRect(b: ModelBuilder, x0: number, y0: number, x1: number, y1: number, z: number, n: number, rotY = 0) {
  b.push().rotateY(rotY);
  const w = (x1 - x0) / n, sk = (y1 - y0) * 0.5;
  for (let i = 0; i < n; i++) {
    b.paint(i % 2 ? 0x1a1a1a : 0xf2c21a, Surf.Plain);
    const xa = x0 + i * w, xb = xa + w;
    const clampX = (x: number) => Math.max(x0, Math.min(x1, x));
    b.quad([clampX(xa), y0, z], [clampX(xb), y0, z], [clampX(xb + sk), y1, z], [clampX(xa + sk), y1, z]);
  }
  b.pop();
}
/** Hazard warning sign (yellow diamond on a post). */
function warnSign(b: ModelBuilder, x: number, z: number, rotY = 0, h = 2.2) {
  b.push().translate(x, 0, z).rotateY(rotY);
  b.paint(0x5a5f64, Surf.Metal).box(-0.05, 0, -0.05, 0.05, h, 0.05, { top: null, bottom: null });
  b.paint(0x1a1a1a, Surf.Plain).quad2([0, h - 0.95, 0.07], [0.62, h - 0.33, 0.07], [0, h + 0.29, 0.07], [-0.62, h - 0.33, 0.07]);
  b.paint(0xf2c21a, Surf.Emissive).quad([0, h - 0.82, 0.1], [0.5, h - 0.33, 0.1], [0, h + 0.16, 0.1], [-0.5, h - 0.33, 0.1]);
  b.pop();
}
/** Steel drum; tipped = lying on its side (along X). 15-18 tris */
function barrel(b: ModelBuilder, x: number, z: number, color: ColorLike, tipped = false, rot = 0, y = 0) {
  b.paint(color, Surf.Metal);
  if (!tipped) b.cylinder(x, z, y, 0.9, 0.3, 0.3, 5, { smooth: false });
  else {
    b.push().translate(x, y + 0.3, z).rotateY(rot).rotateZ(Math.PI / 2);
    b.cylinder(0, 0, -0.45, 0.9, 0.3, 0.3, 5, { smooth: false, bottom: true });
    b.pop();
  }
}
/** Olive military truck (~40 tris) along local Z. */
function armyTruck(b: ModelBuilder, x: number, z: number, rot: number, color: ColorLike = 0x5a6040) {
  b.push().translate(x, 0.08, z).rotateY(rot);
  b.paint(color, Surf.Metal).box(-1.2, 0.5, 1.2, 1.2, 2.5, 3.2);
  b.paint(0x1c2228, Surf.GlassPlain);
  vrect(b, -1.0, 1.6, 1.0, 2.3, 3.22);
  b.paint(0x6b7050, Surf.Plain).box(-1.25, 0.6, -3.6, 1.25, 3.0, 1.1);
  b.paint(0x151515, Surf.Plain).box(-1.15, 0, -3.0, 1.15, 0.6, 2.6, { top: null, pz: null, nz: null });
  b.pop();
}
/** Humvee-like jeep (~20 tris) */
function jeep(b: ModelBuilder, x: number, z: number, rot: number, color: ColorLike = 0x6b6e4a) {
  b.push().translate(x, 0.08, z).rotateY(rot);
  b.paint(color, Surf.Metal).box(-1.1, 0.35, -2.3, 1.1, 1.3, 2.3);
  b.paint(0x1c2228, Surf.GlassPlain).box(-1.0, 1.3, -1.2, 1.0, 1.85, 0.8, { top: pnt(color, Surf.Metal) });
  b.pop();
}
/** Hangar: walls + barrel roof (ridge along Z), door on -Z end (faces the apron). */
function hangar(b: ModelBuilder, cx: number, cz: number, w: number, d: number, wallH: number, rise: number, roof: ColorLike, open: boolean) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  b.paint(0x9ea38c, Surf.Corrugated).box(x0, 0, z0, x1, wallH, z1, { top: null });
  vault(b, cx, cz, w + 0.8, d + 0.6, wallH, rise, 10, pnt(roof, Surf.Corrugated), pnt(0x9ea38c, Surf.Corrugated), 'z');
  // door on -Z end
  b.push().rotateY(Math.PI);
  b.paint(open ? 0x16181a : 0x80867a, open ? Surf.Plain : Surf.Corrugated);
  vrect(b, -cx - w * 0.42, 0, -cx + w * 0.42, wallH + rise * 0.55, -z0 + 0.35);
  b.paint(0xf2c21a, Surf.Plain);
  vrect(b, -cx - w * 0.44, wallH + rise * 0.55, -cx + w * 0.44, wallH + rise * 0.55 + 0.35, -z0 + 0.36);
  b.pop();
  // big number on the camera-facing end
  b.paint(0xe8e8e0, Surf.Plain);
  vrect(b, cx - 1.4, wallH + rise * 0.15, cx + 1.4, wallH + rise * 0.45, z1 + 0.35);
}

// ================================================================================================= MILITARY BASE
function militaryBase(b: ModelBuilder, _v: number, rng: RNG) {
  const S = 64;
  slabC(b, -S, -S, S, S, 0x8e9960, Surf.Foliage, 0.05);
  // runway along X with markings
  const rz0 = -57, rz1 = -41, rx0 = -62, rx1 = 62;
  slabC(b, rx0, rz0, rx1, rz1, 0x2e2f32, Surf.Pavement, 0.1);
  b.paint(0xf2f2f2, Surf.Plain);
  const rc = (rz0 + rz1) / 2, yM = 0.11;
  flat(b, rx0 + 1, rz0 + 0.6, rx1 - 1, rz0 + 0.9, yM);
  flat(b, rx0 + 1, rz1 - 0.9, rx1 - 1, rz1 - 0.6, yM);
  for (let x = rx0 + 20; x < rx1 - 20; x += 9) flat(b, x, rc - 0.3, x + 5, rc + 0.3, yM);
  for (const end of [-1, 1]) {
    const xe = end < 0 ? rx0 + 2 : rx1 - 6;
    for (let i = 0; i < 6; i++) {
      const zz = rz0 + 1.8 + i * 2.2;
      if (Math.abs(zz + 0.4 - rc) < 1.2) continue;
      flat(b, xe, zz, xe + 4, zz + 0.9, yM);
    }
    const xt = end < 0 ? rx0 + 12 : rx1 - 16;
    flat(b, xt, rz0 + 3, xt + 4, rz0 + 4.2, yM);
    flat(b, xt, rz1 - 4.2, xt + 4, rz1 - 3, yM);
  }
  // taxiway + connectors + apron
  slabC(b, -58, -38, 36, -33, 0x3a3b3e, Surf.Pavement, 0.09);
  slabC(b, -58, -41, -52, -33, 0x3a3b3e, Surf.Pavement, 0.09);
  slabC(b, 30, -41, 36, -33, 0x3a3b3e, Surf.Pavement, 0.09);
  b.paint(0xf2c21a, Surf.Plain);
  flat(b, -55, -35.6, 33, -35.4, 0.1);
  slabC(b, -60, -33, 22, -15, 0xa6a499, Surf.Pavement, 0.09);
  // jets on the apron (nose toward the runway = -Z)
  const jets: [number, number][] = [[-50, -24], [-38, -24], [-26, -24], [-14, -24], [2, -26]];
  jets.forEach(([x, z], i) => jet(b, x, z, Math.PI + (i === 4 ? 0.5 : 0), i === 4 ? 0x7a8288 : CIV.jetGrey, 0.09));
  b.paint(0xf2c21a, Surf.Plain);
  for (const [x, z] of jets.slice(0, 4)) flat(b, x - 0.15, z - 10, x + 0.15, z + 8, 0.1);
  // hangars (doors face the apron)
  hangar(b, -48, -5, 17, 19, 3.5, 8, 0x6b7254, false);
  hangar(b, -28, -5, 17, 19, 3.5, 8, 0x6b7254, true);
  hangar(b, -8, -5, 17, 19, 3.5, 8, 0x6b7254, false);
  jet(b, -28, -13.5, Math.PI, CIV.jetGrey, 0.09);
  // control tower
  const tx = 14, tz = -8;
  b.paint(0xd8d4c8, Surf.Plain).boxC(tx, tz, 8, 6, 0, 4, { top: pnt(0x8a8680, Surf.RoofFlat) });
  b.paint(0xd8d4c8, Surf.Plain).boxC(tx, tz, 3.6, 3.6, 4, 12);
  b.paint(0xd8d4c8, Surf.Plain).boxC(tx, tz, 6.4, 6.4, 16, 0.6);
  b.paint(0x2c3a44, Surf.GlassPlain).prism(tx, tz, 3.3, 8, 16.6, 2.8, Math.PI / 8, { top: false });
  b.paint(0x5a5f64, Surf.Metal).prism(tx, tz, 3.8, 8, 19.4, 0.5, Math.PI / 8);
  antennaMast(b, tx + 1.5, tz, 19.9, 3.2);
  b.paint(0x6aa0ff, Surf.Emissive).boxC(tx - 1.5, tz, 0.4, 0.4, 19.9, 0.6);
  // radar: big dish on a lattice tower + rotating bar radar
  const dx = 42, dz = -22;
  b.paint(0x7f8488, Surf.Metal);
  for (const [ox, oz] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) b.beam([dx + ox, 0, dz + oz], [dx + ox * 0.4, 12, dz + oz * 0.4], 0.3);
  b.paint(0xd8d4c8, Surf.Plain).boxC(dx, dz, 3.2, 3.2, 12, 1.2);
  dish(b, dx, 14.8, dz, 5.2, 1.8, 0.7, -0.5, 0xeeeeee, 12, 3);
  b.paint(0x7f8488, Surf.Metal).cylinder(dx, dz, 13.2, 1.8, 0.5, 0.5, 6);
  b.paint(0xd8d4c8, Surf.Plain).boxC(52, -22, 7, 6, 0, 4, { top: pnt(0x8a8680, Surf.RoofFlat) });
  radarBar(b, 52, -22, 4, 7, 0.9);
  // barracks rows (tan, gable roofs)
  for (let i = 0; i < 4; i++) {
    const bz = 8 + i * 11;
    b.paint(CIV.armyTan, Surf.WallWindows, 0, 3.4).box(24, 0, bz - 3.8, 58, 6.8, bz + 3.8, { top: null });
    b.paint(0x5d6446, Surf.RoofTiles).gableRoof(41, bz, 34, 7.6, 6.8, 2.2, 'x', 0.5, pnt(CIV.armyTan, Surf.Plain));
    b.paint(0x5a4a36, Surf.Wood);
    vrect(b, 40.2, 0, 41.8, 2.3, bz + 3.82);
  }
  slabC(b, 20, 2, 22, 50, 0xb3aa98, Surf.Pavement, 0.09);
  // HQ + parade ground + flags
  b.paint(0xcfc6ae, Surf.WallWindows, 1, 3.8).box(-22, 0, 20, 8, 7.6, 30, { top: pnt(0x8a8680, Surf.RoofFlat) });
  b.paint(0x5d6446, Surf.Plain).box(-22.2, 7.0, 19.8, 8.2, 8.0, 30.2, { top: null });
  b.paint(0xcfc6ae, Surf.Plain).box(-10.5, 4.6, 30, -3.5, 5.3, 33.3, { top: pnt(0x8a8680, Surf.RoofFlat) });
  colonnade(b, -10, -4, 32.8, 0, 4.6, 4, 0.25);
  b.paint(0x2a3440, Surf.GlassPlain);
  vrect(b, -8.5, 0, -5.5, 3.2, 30.05);
  slabC(b, -22, 34, 8, 50, 0xb9b2a0, Surf.Pavement, 0.09);
  b.paint(0xf2f2f2, Surf.Plain);
  annulus(b, -7, 42, 4.0, 4.4, 12, 0.1);
  flag(b, -7, 42, 12, FLAGS.nation, 0, 1.2);
  flag(b, -16, 36, 9, FLAGS.military);
  flag(b, 2, 36, 9, FLAGS.military);
  // gate: road from front edge, guard booth + barrier
  slabC(b, 12, -15, 18, 64, 0x3a3b3e, Surf.Pavement, 0.09);
  slabC(b, -22, 50, 18, 54, 0x3a3b3e, Surf.Pavement, 0.09);
  b.paint(0xcfc6ae, Surf.Plain).boxC(20.5, 58, 3, 3, 0, 3.0, { top: pnt(0x5d6446) });
  b.paint(0x2a3440, Surf.GlassPlain).boxC(20.5, 58, 3.1, 2.4, 1.1, 1.4, { top: null });
  hazardRect(b, 12.2, 1.0, 18, 1.3, 57, 6);
  b.paint(0x5a5f64, Surf.Metal).boxC(12.2, 57, 0.4, 0.4, 0, 1.4);
  jeep(b, 15, 46, 0.1);
  // fuel farm + vehicles
  tank(b, -48, 32, 4, 6.5, 0xd8d8d0, 0x5d6446);
  tank(b, -38, 32, 4, 6.5, 0xd8d8d0, 0x5d6446);
  tank(b, -48, 42, 4, 6.5, 0xd8d8d0, 0x5d6446);
  armyTruck(b, -36, 44, Math.PI / 2);
  for (let i = 0; i < 5; i++) armyTruck(b, 27 + i * 5, 52, 0, i % 2 ? 0x5a6040 : 0x6b6e4a);
  jeep(b, 54, 52, 0);
  jeep(b, 58, 52, 0.05);
  // helipad + helicopter
  helipad(b, -46, 55, 0.05, 6);
  helicopter(b, -46, 0.2, 55, 0.8, 0x4f5638);
  // perimeter + a few trees
  perimeter(b, -63, -63, 63, 63, 2.8, [11.5, 18.5], 21);
  for (const x of [-58, -30, 28, 42, 58]) tree(b, rng, x, 60.5, 1.1);
}

// ================================================================================================= CASINO
function casino(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 24;
  slabC(b, -s, -s, s, s, 0xd9d2c3, Surf.Pavement, 0.1);
  const gold = 0xd9a93a, magenta = 0xff2fa8, cream = 0xefe3c4;
  // podium (casino floor) with gold glass front + neon bands
  b.paint(cream, Surf.Plain).box(-22.5, 0, -23, 22.5, 9, 2, { top: pnt(0x9a9084, Surf.RoofFlat) });
  b.paint(0x8a6a2a, Surf.GlassCurtain, 2, 4.5).box(-18, 0.1, 2, 18, 8, 2.1, { top: null });
  b.paint(magenta, Surf.Emissive).box(-22.7, 8.1, -23.2, 22.7, 8.5, 2.2, { top: null, bottom: null });
  b.paint(gold, Surf.Emissive).box(-22.7, 9.0, -23.2, 22.7, 9.35, 2.2, { top: null, bottom: null });
  b.paint(gold, Surf.Emissive);
  for (let x = -21; x <= 21; x += 3) b.boxC(x, 2.25, 0.25, 0.25, 7.2, 0.25);
  // curved hotel tower (crescent in plan)
  const outer: [number, number][] = [], inner: [number, number][] = [];
  const n = 10, R0 = 30, R1 = 23.5, czc = 12;
  for (let i = 0; i <= n; i++) {
    const a = -0.62 + (1.24 * i) / n;
    outer.push([Math.sin(a) * R0, czc - Math.cos(a) * R0]);
    inner.push([Math.sin(a) * R1, czc - Math.cos(a) * R1]);
  }
  const crescent = [...outer, ...inner.slice().reverse()];
  const TH = 46;
  b.paint(0xc89a3a, Surf.GlassCurtain, 2, 3.4).extrude(crescent, 9, TH - 9, { topPaint: pnt(0x9a9084, Surf.RoofFlat) });
  // gold spandrel bands every few floors (only the curved front face)
  b.paint(gold, Surf.Metal);
  for (const y of [9 + 3.4 * 3, 9 + 3.4 * 6, 9 + 3.4 * 9]) {
    for (let i = 0; i < n; i++) {
      const off = (x: number, z: number): [number, number] => {
        const dx = -x, dz = czc - z, l = Math.hypot(dx, dz) || 1;
        return [x + (dx / l) * 0.12, z + (dz / l) * 0.12];
      };
      const [ax, az] = off(...inner[i]), [bx2, bz2] = off(...inner[i + 1]);
      const mx = (ax + bx2) / 2, mz = (az + bz2) / 2;
      quadH(b, [ax, y, az], [bx2, y, bz2], [bx2, y + 0.5, bz2], [ax, y + 0.5, az], [-mx, 0, czc - mz]);
    }
  }
  // crown: stacked emissive neon rings + top fin
  b.paint(magenta, Surf.Emissive).extrude(crescent.map(([x, z]) => [x * 1.01, czc + (z - czc) * 1.01] as [number, number]), TH - 3.5, 0.5, { top: false });
  b.paint(gold, Surf.Emissive).extrude(crescent.map(([x, z]) => [x * 1.01, czc + (z - czc) * 1.01] as [number, number]), TH, 0.6, { top: false });
  b.paint(cream, Surf.Plain).extrude(crescent.map(([x, z]) => [x * 0.9, czc + (z - czc) * 0.99] as [number, number]), TH + 0.6, 2.2, { topPaint: pnt(0x9a9084) });
  // vertical gold fins at the tower ends
  for (const e of [0, n]) {
    const [ox, oz] = outer[e];
    b.paint(gold, Surf.Metal).boxC(ox * 0.93, oz + 1.4, 1.4, 5.0, 9, TH - 5.5);
  }
  // roof sign on the tower
  wallSign(b, 0, TH + 4.6, -18 + 0.25, 16, 2.6, 0xffe9a8, 'pz', 0x3a1030, magenta);
  // porte-cochere with glowing underside
  b.paint(gold, Surf.Metal).box(-9, 6, 2, 9, 7.2, 12, { bottom: pnt(0xfff0c0, Surf.Emissive) });
  b.paint(magenta, Surf.Emissive).box(-9.1, 6.3, 12, 9.1, 6.8, 12.1, { top: null, bottom: null });
  b.paint(gold, Surf.Metal);
  for (const [px, pz] of [[-8.5, 11.4], [8.5, 11.4]] as [number, number][]) b.cylinder(px, pz, 0, 6, 0.35, 0.35, 8);
  miniCar(b, -3, 8.5, Math.PI / 2, 0x141414, 0.1);
  miniCar(b, 3.5, 8.3, Math.PI / 2, 0xf2f2f2, 0.1);
  // giant marquee pylon sign
  const sx = 17, sz = 17;
  b.paint(0x2a2a2e, Surf.Metal).boxC(sx, sz, 1.2, 1.2, 0, 13);
  b.paint(0x3a1030, Surf.Metal).boxC(sx, sz, 5.4, 1.4, 12, 11);
  b.paint(magenta, Surf.Emissive);
  vrect(b, sx - 2.4, 16.5, sx + 2.4, 22.4, sz + 0.72);
  b.paint(gold, Surf.Emissive);
  vrect(b, sx - 2.4, 12.6, sx + 2.4, 15.8, sz + 0.72);
  b.push().translate(sx, 0, sz).rotateY(Math.PI);
  b.paint(magenta, Surf.Emissive);
  vrect(b, -2.4, 16.5, 2.4, 22.4, 0.72);
  b.paint(gold, Surf.Emissive);
  vrect(b, -2.4, 12.6, 2.4, 15.8, 0.72);
  b.pop();
  b.paint(0xfff6d0, Surf.Emissive);
  for (let i = 0; i < 6; i++) b.boxC(sx - 2.5 + i, sz + 0.8, 0.2, 0.1, 23.1, 0.2);
  // star on top
  b.paint(gold, Surf.Emissive);
  const star: V3[] = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? 0.8 : 2.0;
    star.push([sx + Math.cos(a) * r, 25.6 + Math.sin(a) * r, sz + 0.1]);
  }
  for (let i = 0; i < 10; i++) b.tri([sx, 25.6, sz + 0.1], star[i], star[(i + 1) % 10]);
  for (let i = 0; i < 10; i++) b.tri([sx, 25.6, sz - 0.1], star[(i + 1) % 10], star[i]);
  // fountain pool with lit jets
  const pz0 = 11, pz1 = 22.5, px0 = -22.5, px1 = -6;
  b.paint(0xcfc2a0, Surf.Stone).box(px0, 0, pz0, px1, 0.55, pz1);
  b.paint(0x2f86c0, Surf.Water).box(px0 + 0.5, 0.5, pz0 + 0.5, px1 - 0.5, 0.62, pz1 - 0.5, { bottom: null });
  b.paint(0xbfefff, Surf.Emissive);
  for (let i = 0; i < 5; i++) {
    const jx = px0 + 2.5 + i * 3.1, jz = (pz0 + pz1) / 2 + (i % 2 ? 2.2 : -2.2);
    b.cylinder(jx, jz, 0.5, 3.5 + (i % 3) * 1.8, 0.2, 0.06, 5, { top: false });
  }
  b.cylinder((px0 + px1) / 2, (pz0 + pz1) / 2, 0.5, 8, 0.35, 0.08, 6, { top: false });
  // palms + planters + lamps
  for (const [x, z] of [[-4, 20.5], [5, 20.5], [11, 14], [-20, 5], [20, 5], [20.3, 11]] as [number, number][]) palm(b, rng, x, z, 0.95);
  for (const x of [-12, 12]) lamp(b, x, 4.2, 5);
  // rooftop pool deck on the podium
  b.paint(0xe8dcc0, Surf.Pavement).boxC(-14, -3.8, 10.4, 6.4, 9, 0.18, { bottom: null });
  b.paint(0x3fb0d8, Surf.Water).boxC(-14, -3.8, 9, 5, 9, 0.26, { bottom: null });
  b.paint(0xe8dcc0, Surf.Pavement).boxC(13, -3.8, 8.4, 5.4, 9, 0.18, { bottom: null });
  b.paint(0x3fb0d8, Surf.Water).boxC(13, -3.8, 7, 4, 9, 0.26, { bottom: null });
  b.push().translate(0, 9, 0);
  for (const x of [-19.2, -8.8, 8.2, 17.8]) planter(b, x, -1.2, 0.6);
  for (let i = 0; i < 5; i++) benchAt(b, -17 + i * 1.6, -0.2, 0);
  b.pop();
}

// ================================================================================================= TOXIC DUMP
function toxicDump(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 32;
  slabC(b, -s, -s, s, s, 0x6e6347, Surf.Pavement, 0.05);
  // stains
  b.paint(0x8a8b3a, Surf.Pavement);
  for (const [x, z, r] of [[-10, 12, 7], [12, 6, 6], [-20, -18, 6]] as [number, number, number][]) flatPoly(b, blobPoly(rng, x, z, r, r * 0.8, 9, 0.35), 0.06);
  // access road + gravel pad
  slabC(b, -3, 14, 3, 32, 0x55524a, Surf.Pavement, 0.08);
  slabC(b, -30, -30, 30, -10, 0x7d7564, Surf.Pavement, 0.07);
  // ooze pools: dark sludge rim + emissive green
  const pools: [number, number, number, number][] = [[-12, 12, 8, 5.5], [13, 6, 6, 4.5], [11, 23.5, 3.5, 2.5]];
  for (const [x, z, rx, rz] of pools) {
    const poly = blobPoly(rng, x, z, rx, rz, 10, 0.18);
    b.paint(0x2e3320, Surf.Pavement).extrude(poly.map(([px, pz]) => [x + (px - x) * 1.18, z + (pz - z) * 1.18] as [number, number]), 0, 0.12);
    b.paint(0x3ccf1c, Surf.Emissive).extrude(poly, 0.05, 0.14, { top: false });
    b.paint(0x3ccf1c, Surf.Emissive);
    flatPoly(b, poly, 0.19);
  }
  // barrel yard: rows on the gravel pad, some tipped over
  const cols = [0xd8b21c, 0xd8b21c, 0xb2561f, 0x2c5e9e, 0x3f6a2e, 0x9a9a92];
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 11; i++) {
      if (rng.chance(0.12)) continue;
      const x = -28 + i * 1.5 + (r % 2) * 0.5, z = -27 + r * 5.2;
      if (i % 4 === 0) b.paint(0x8a6a3a, Surf.Wood).boxC(x + 0.7, z + 0.7, 2.8, 2.8, 0.05, 0.15);
      barrel(b, x, z, rng.pick(cols), false, 0, 0.2);
      barrel(b, x, z + 1.35, rng.pick(cols), false, 0, 0.2);
    }
  }
  for (let i = 0; i < 7; i++) barrel(b, rng.range(-26, 6), rng.range(-9, 2), rng.pick(cols), true, rng.range(0, 3), 0);
  for (let i = 0; i < 6; i++) barrel(b, rng.range(-6, 4), rng.range(4, 10), rng.pick(cols), rng.chance(0.5), rng.range(0, 3), 0);
  // stacked barrels pyramid
  for (let l = 0; l < 3; l++) for (let i = 0; i < 3 - l; i++) barrel(b, 20 + i * 0.62 + l * 0.31, 17, l === 1 ? 0xb2561f : 0xd8b21c, true, Math.PI / 2, l * 0.54);
  // processing shed (rusty corrugated) with hazard-striped door
  const hx0 = 8, hx1 = 28, hz0 = -29, hz1 = -15;
  b.paint(0x8f7a5a, Surf.Corrugated).box(hx0, 0, hz0, hx1, 6.5, hz1, { top: null });
  b.paint(0x6e5a44, Surf.Corrugated).gableRoof((hx0 + hx1) / 2, (hz0 + hz1) / 2, hx1 - hx0, hz1 - hz0, 6.5, 1.6, 'x', 0.4, pnt(0x8f7a5a, Surf.Corrugated));
  b.paint(0x202020, Surf.Plain);
  vrect(b, 12, 0, 18, 4.8, hz1 + 0.03);
  hazardRect(b, 11.6, 4.8, 18.4, 5.4, hz1 + 0.05, 8);
  wallSign(b, 23, 4.2, hz1 + 0.05, 5, 1.4, 0xf2c21a, 'pz', 0x1a1a1a);
  // leaking tanks with hazard bands + spill
  tank(b, 22, -5, 3.2, 7, 0xc9c6b8, 0xf2c21a);
  tank(b, 22, 4, 3.2, 7, 0x9aa08a, 0xf2c21a);
  b.paint(0x3ccf1c, Surf.Emissive);
  flatPoly(b, blobPoly(rng, 18.5, 1, 2.2, 1.6, 8, 0.3), 0.08);
  b.paint(0x6a7a5a, Surf.Metal).pipe([22, 1.5, -1.8], [22, 1.5, 0.8], 0.35, 6);
  // excavator
  b.push().translate(-18, 0, 3).rotateY(0.6);
  b.paint(0xe0a81c, Surf.Metal).box(-1.8, 0.8, -1.6, 1.8, 2.8, 1.6);
  b.paint(0x2a2a2a, Surf.Plain).box(-2.0, 0, -2.2, -1.1, 0.9, 2.2).box(1.1, 0, -2.2, 2.0, 0.9, 2.2);
  b.paint(0x1c2228, Surf.GlassPlain).box(-1.6, 2.8, -1.4, 0.2, 3.9, 0.4, { top: pnt(0xe0a81c, Surf.Metal) });
  b.paint(0xe0a81c, Surf.Metal).beam([0.8, 2.6, 0.5], [1.2, 5.0, 4.0], 0.5).beam([1.2, 5.0, 4.0], [1.0, 1.2, 6.0], 0.4);
  b.paint(0x555555, Surf.Metal).box(0.4, 0.1, 5.6, 1.6, 1.2, 6.8);
  b.pop();
  // dirt mounds
  b.paint(0x5e5238, Surf.Pavement);
  for (const [x, z, r] of [[-25, 22, 4.5], [24, 24, 5.5], [-26, 8, 3.5]] as [number, number, number][]) b.blob(x, 0, z, r, r * 0.45, r * 0.9, 0, 0.25, x);
  // dead trees
  for (const [x, z] of [[-6, 20], [5, 28], [-28, -2], [28, 13]] as [number, number][]) {
    b.paint(0x5a5044, Surf.Wood).cylinder(x, z, 0, 4.5, 0.25, 0.1, 5, { top: false });
    b.beam([x, 2.8, z], [x + 1.4, 4.4, z + 0.5], 0.14).beam([x, 3.4, z], [x - 1.1, 4.8, z - 0.6], 0.12);
  }
  // hazard fence with signs, gate at the road
  perimeter(b, -31, -31, 31, 31, 2.6, [-3.5, 3.5], 7.5, 0xd8b21c);
  for (const [x, z, r] of [[-15, 31.2, 0], [15, 31.2, 0], [31.2, 0, Math.PI / 2], [31.2, 18, Math.PI / 2], [-31.2, 10, -Math.PI / 2]] as [number, number, number][]) warnSign(b, x, z, r, 2.4);
  hazardRect(b, -3.5, 1.0, 3.5, 1.3, 31, 7);
  // tanker truck
  b.push().translate(0, 0.08, 20).rotateY(0.05);
  b.paint(0xe8e8e0, Surf.Metal).box(-1.2, 0.5, 3.0, 1.2, 2.8, 5.2);
  b.paint(0x1c2228, Surf.GlassPlain);
  vrect(b, -1.0, 1.7, 1.0, 2.6, 5.22);
  b.paint(0xc9c6b8, Surf.Metal);
  b.push().translate(0, 2.0, -2).rotateX(Math.PI / 2);
  b.cylinder(0, 0, -4.8, 9.6, 1.25, 1.25, 8, { top: true, bottom: true });
  b.pop();
  b.paint(0xf2c21a, Surf.Plain).box(-1.27, 1.6, -4, 1.27, 2.4, 0, { top: null, bottom: null });
  b.pop();
}

// ================================================================================================= MISSILE RANGE
function missile(b: ModelBuilder, x: number, z: number, y0: number, h: number, r: number, color: ColorLike = 0xf2f2ee, bandC: ColorLike = 0x1a1a1a) {
  b.paint(color, Surf.Metal).cylinder(x, z, y0, h * 0.8, r, r, 10, { top: false });
  b.paint(bandC, Surf.Plain).cylinder(x, z, y0 + h * 0.52, h * 0.06, r + 0.02, r + 0.02, 10, { top: false });
  b.paint(color, Surf.Metal).cylinder(x, z, y0 + h * 0.8, h * 0.2, r, 0, 10, { top: false });
  b.paint(0xc0271f, Surf.Plain);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const dx = Math.cos(a), dz = Math.sin(a);
    b.quad2([x + dx * r, y0, z + dz * r], [x + dx * (r + 1.2), y0, z + dz * (r + 1.2)], [x + dx * (r + 0.3), y0 + h * 0.18, z + dz * (r + 0.3)], [x + dx * r, y0 + h * 0.22, z + dz * r]);
  }
}
function missileRange(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 48;
  slabC(b, -s, -s, s, s, 0xa8986a, Surf.Foliage, 0.05);
  // scrub patches
  b.paint(0x8a8a58, Surf.Foliage);
  for (let i = 0; i < 6; i++) flatPoly(b, blobPoly(rng, rng.range(-40, 40), rng.range(-40, 40), rng.range(4, 8), rng.range(3, 6), 8, 0.3), 0.06);
  // service roads
  const road = 0xb7b0a0;
  slabC(b, -3, -40, 3, 48, road, Surf.Pavement, 0.08);
  slabC(b, -40, -4, 40, 2, road, Surf.Pavement, 0.08);
  slabC(b, 20, -30, 26, -4, road, Surf.Pavement, 0.08);
  // --- main pad with gantry + tall rocket
  const px = -22, pz = -22;
  b.paint(0x2a2622, Surf.Pavement);
  flatPoly(b, blobPoly(rng, px, pz, 17, 15, 12, 0.25), 0.07);
  b.paint(0xc4c0b6, Surf.Pavement).boxC(px, pz, 18, 18, 0, 0.9);
  b.paint(0x1a1818, Surf.Plain);
  flat(b, px - 2.5, pz - 8.9, px + 2.5, pz + 8.9, 0.92);
  b.paint(0x3a3634, Surf.Pavement);
  stripe(b, px, pz + 9, px, pz + 20, 6, 0.08);
  missile(b, px, pz, 0.9, 25, 1.35);
  // gantry tower (orange lattice)
  const gx = px - 5.5, gz = pz, gw = 4, GH = 29;
  b.paint(0xd2541c, Surf.Metal);
  for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.boxC(gx + ox * gw / 2, gz + oz * gw / 2, 0.45, 0.45, 0.9, GH - 0.9);
  for (let l = 1; l <= 6; l++) {
    const y = 0.9 + (l * (GH - 0.9)) / 6.5;
    b.box(gx - gw / 2, y, gz - gw / 2, gx + gw / 2, y + 0.35, gz + gw / 2, { bottom: null });
    if (l % 2 === 0) b.beam([gx + gw / 2, y, gz - 0.3], [px - 1.2, y, gz - 0.3], 0.4);
  }
  b.beam([gx - gw / 2, 0.9, gz + gw / 2 + 0.1], [gx + gw / 2, 12, gz + gw / 2 + 0.1], 0.25);
  b.beam([gx - gw / 2, 12, gz + gw / 2 + 0.1], [gx + gw / 2, 24, gz + gw / 2 + 0.1], 0.25);
  b.paint(0xff3322, Surf.Emissive).boxC(gx, gz, 0.5, 0.5, GH, 0.5);
  // lightning masts
  for (const [ox, oz] of [[9, 9], [-9, 9], [9, -9]]) antennaMast(b, px + ox, pz + oz, 0, 22, 0xdedede);
  // --- second pad: mobile launcher truck with angled missile
  const qx = 23, qz = -34;
  b.paint(0x2a2622, Surf.Pavement);
  flatPoly(b, blobPoly(rng, qx, qz, 10, 8, 10, 0.3), 0.07);
  b.paint(0xc4c0b6, Surf.Pavement).boxC(qx, qz, 14, 12, 0, 0.5);
  b.push().translate(qx, 0.5, qz).rotateY(0.2);
  b.paint(0x5a6040, Surf.Metal).box(-1.4, 0.4, -6, 1.4, 1.8, 6);
  b.box(-1.4, 0.4, 6, 1.4, 3.2, 8.2);
  b.paint(0x1c2228, Surf.GlassPlain);
  vrect(b, -1.2, 2.0, 1.2, 3.0, 8.22);
  b.paint(0x151515, Surf.Plain).box(-1.35, 0, -5, 1.35, 0.5, 7.5, { top: null, pz: null, nz: null });
  b.push().translate(0, 1.9, -4.5).rotateX(-0.85);
  missile(b, 0, 0, 0, 12, 0.7, 0xf2f2ee, 0xc0271f);
  b.paint(0x4a5034, Surf.Metal).box(-0.9, -0.3, -0.9, 0.9, 0.1, 0.9);
  b.pop();
  b.pop();
  // --- third pad: burnt empty pad with blast deflector
  const rx = 28, rz = 22;
  b.paint(0x1e1b18, Surf.Pavement);
  flatPoly(b, blobPoly(rng, rx, rz, 13, 11, 12, 0.3), 0.07);
  b.paint(0x8a857a, Surf.Pavement).boxC(rx, rz, 12, 12, 0, 0.6);
  b.paint(0x5a5550, Surf.Plain);
  quadH(b, [rx - 5, 0.6, rz - 4], [rx + 5, 0.6, rz - 4], [rx + 5, 4.5, rz - 7], [rx - 5, 4.5, rz - 7], [0, 0.6, 1]);
  b.paint(0x2a2622, Surf.Pavement);
  for (let i = 0; i < 3; i++) disc(b, rx + rng.range(-10, 10), rz + rng.range(8, 16), rng.range(2, 3.5), 9, 0.09);
  // bunkers: earth-covered vaults with concrete fronts
  for (const [bx, bz, rot] of [[-30, 14, 0], [-16, 16, 0], [8, -18, Math.PI / 2]] as [number, number, number][]) {
    b.push().translate(bx, 0, bz).rotateY(rot);
    vault(b, 0, 0, 9, 12, 0, 4.2, 8, pnt(0x7d7a52, Surf.Foliage), pnt(0x6f6c48, Surf.Foliage), 'z');
    b.paint(0xb8b4aa, Surf.Plain).box(-4.8, 0, 6, 4.8, 4.6, 6.8);
    b.paint(0x2a2c2e, Surf.Metal);
    vrect(b, -1.5, 0, 1.5, 2.8, 6.82);
    b.pop();
  }
  // control blockhouse with slit windows, radar dish, antennas
  const cx = -24, cz = 32;
  b.paint(0xbab5aa, Surf.Plain).box(cx - 9, 0, cz - 6, cx + 9, 5, cz + 6, { top: pnt(0x8a8680, Surf.RoofFlat) });
  b.paint(0x1c2228, Surf.GlassPlain);
  vrect(b, cx - 7, 3.2, cx + 7, 3.9, cz + 6.02);
  b.push().rotateY(Math.PI / 2);
  vrect(b, -cz - 4, 3.2, -cz + 4, 3.9, cx + 9.02);
  b.pop();
  dish(b, cx + 4, 7.5, cz - 1, 3.4, 1.2, -0.8, -0.8, 0xeeeeee, 12, 3);
  b.paint(0x8a8d90, Surf.Metal).cylinder(cx + 4, cz - 1, 5, 2.4, 0.4, 0.4, 6);
  antennaMast(b, cx - 6, cz - 3, 5, 12);
  antennaMast(b, cx - 3, cz - 3, 5, 8);
  // observation tower + LOX spheres + fuel tanks
  guardTower(b, 10, 10, 14, 0xc8c3b6);
  for (const [sx, sz] of [[-38, -4 - 10], [-38, -24]] as [number, number][]) {
    b.paint(0x7f8488, Surf.Metal);
    for (const [ox, oz] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) b.beam([sx + ox, 0, sz + oz], [sx + ox * 0.6, 3, sz + oz * 0.6], 0.3);
    b.paint(0xf0f0ec, Surf.Metal).sphere(sx, 6, sz, 3.3, 12, 8);
  }
  tank(b, 36, -10, 3, 6, 0xe6e6e2, 0xc0271f);
  // vehicles
  armyTruck(b, 0, 8, 0);
  jeep(b, 6, -2, Math.PI / 2);
  jeep(b, -10, 26, 0.2);
  bus(b, -35, 43, Math.PI / 2, 0xe8e8e4, false, 0.08, 0x2a3440);
  // perimeter with gate on the main road
  perimeter(b, -47, -47, 47, 47, 2.6, [-4, 4], 14);
  warnSign(b, -6, 47.2, 0, 2.4);
  warnSign(b, 6, 47.2, 0, 2.4);
}

// ================================================================================================= RESEARCH CENTER
function researchCenter(b: ModelBuilder, _v: number, rng: RNG) {
  const s = 32;
  slabC(b, -s, -s, s, s, 0x6c9a45, Surf.Foliage, 0.06);
  // plaza + reflecting pool + drive
  slabC(b, -14, 8, 14, 31.5, 0xd8d4cc, Surf.Pavement, 0.1);
  b.paint(0x2f6f9f, Surf.Water).boxC(0, 20, 16, 5, 0.05, 0.12, { bottom: null });
  b.paint(0xe8e6e0, Surf.Plain);
  annulus(b, 0, -8, 21.5, 22.5, 20, 0.11, 0.35 * Math.PI + Math.PI / 2, Math.PI / 2 + Math.PI * 2 - 0.35 * Math.PI);
  // curved glass ring building (open toward the front)
  const R0 = 21, R1 = 13.5, cz = -8, a0 = Math.PI / 2 + 0.42 * Math.PI, a1 = Math.PI / 2 + 2 * Math.PI - 0.42 * Math.PI;
  const n = 18;
  const outer: [number, number][] = [], inner: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    outer.push([Math.cos(a) * R0, cz + Math.sin(a) * R0]);
    inner.push([Math.cos(a) * R1, cz + Math.sin(a) * R1]);
  }
  const ring = [...outer, ...inner.slice().reverse()];
  const H = 20;
  b.paint(0x7fb0d0, Surf.GlassCurtain, 5, 4).extrude(ring, 0, H, { top: false });
  b.paint(0xf4f4f2, Surf.Plain).extrude(ring.map(([x, z]) => [x * 1.02, cz + (z - cz) * 1.02] as [number, number]), H, 1.2, { topPaint: pnt(0xe2e2de, Surf.RoofFlat) });
  const ringOut = ring.map(([x, z]) => [x * 1.012, cz + (z - cz) * 1.012] as [number, number]);
  for (const f of [4, 8, 12, 16]) b.paint(0xf4f4f2, Surf.Plain).extrude(ringOut, f - 0.25, 0.35, { top: false });
  // solar panels on the roof ring
  b.paint(0x1f3a5f, Surf.GlassCurtain, 3, 2);
  for (let i = 1; i < n; i += 2) {
    const [ox, oz] = outer[i], [ix, iz] = inner[i];
    const mx = (ox + ix) / 2, mz = (oz + iz) / 2;
    b.boxC(mx, mz, 2.4, 2.4, H + 1.2, 0.3, { bottom: null });
  }
  // central glass dome in the courtyard + slender white tower
  b.paint(0x9cc6e0, Surf.GlassCurtain, 5, 2.5).sphere(0, 0.1, cz, 9, 16, 10, { hemi: true, scaleY: 0.85 });
  b.paint(0xf4f4f2, Surf.Plain).cylinder(0, cz, 7.6, 0.6, 2.4, 2.4, 12);
  const tx = -2, tz = cz - 2;
  b.paint(0xf4f4f2, Surf.Plain).cylinder(tx, tz, 0, 33, 1.8, 1.4, 10, { smooth: false });
  b.paint(0x7fb0d0, Surf.GlassCurtain, 5, 3).cylinder(tx, tz, 29, 4, 3.6, 3.6, 12, { smooth: false });
  b.paint(0xf4f4f2, Surf.Plain).cylinder(tx, tz, 33, 0.6, 3.9, 3.9, 12, { smooth: false });
  antennaMast(b, tx, tz, 33.6, 6);
  b.paint(0x6fdcff, Surf.Emissive).cylinder(tx, tz, 28.5, 0.4, 3.7, 3.7, 12, { top: false });
  // radio telescope array (back right)
  const dishes: [number, number, number, number][] = [[24, -24, 6, 7], [27, -8, 3.4, 5], [27.5, 2.5, 3.2, 4.6]];
  for (const [x, z, r, h] of dishes) {
    b.paint(0xd8d8d4, Surf.Plain).boxC(x, z, r * 0.9, r * 0.9, 0, 1.0);
    b.paint(0xbfc3c7, Surf.Metal).cylinder(x, z, 1.0, h - 1.0, 0.6, 0.45, 8);
    dish(b, x, h + 0.4, z, r, r * 0.35, 0.75, -0.5 + x * 0.01, 0xf2f2f0, 12, 3);
  }
  // low lab wing (back left) with ribbon windows + solar array
  b.paint(0xf1f0ec, Surf.WallWindows, 2, 4).box(-30, 0, -30, -17, 8, -12, { top: pnt(0x8a8680, Surf.RoofFlat) });
  b.paint(0x1f3a5f, Surf.GlassCurtain, 3, 2);
  for (let i = 0; i < 4; i++) {
    b.push().translate(-23.5, 8.3, -27 + i * 4).rotateX(-0.35);
    b.box(-5, 0, -1.2, 5, 0.12, 1.2, { bottom: null });
    b.pop();
  }
  // parking (front right) + trees + sign
  parking(b, rng, 15, 8, 31.5, 31.5, 0.55);
  for (const [x, z] of [[-28, 10], [-22, 16], [-28, 22], [-19, 28], [-26, 28.5], [-17, 10], [-29, -6]] as [number, number][]) tree(b, rng, x, z, 1);
  for (const x of [-11, 11]) lamp(b, x, 28, 4.5);
  b.paint(0xf4f4f2, Surf.Plain).boxC(-8, 30.5, 6, 0.6, 0, 1.6);
  b.paint(0x6fdcff, Surf.Emissive);
  vrect(b, -10.6, 0.5, -5.4, 1.2, 30.82);
  benchAt(b, -5, 16, 0);
  benchAt(b, 5, 16, 0);
  conifer(b, rng, -14, -26, 1);
  miniCar(b, 0, 26, Math.PI / 2, 0xf2f2f2, 0.1);
}

export const models: ModelBuilders = {
  rw_military_base: militaryBase,
  rw_casino: casino,
  rw_toxic_dump: toxicDump,
  rw_missile_range: missileRange,
  rw_research_center: researchCenter,
};

void [PALETTE, cruiser, CAR_COLS];
