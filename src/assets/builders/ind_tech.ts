/**
 * Industrial / HIGH-TECH models: ind_tech_campus, ind_lab, ind_datacenter.
 */
import type { ModelBuilders } from '../registry';
import type { ModelBuilder, ColorLike } from '../ModelBuilder';
import { PALETTE } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { signBox, bench } from '../kit';
import {
  type V3, flat, ground, wallQuad, tube, disc, strut, tank, carLow, fenceRect, floodLight, roofUnit, parking, tree,
  solarRow, lathe, boxTruck, emitSteam, CAR_COLORS2,
  lightDot, lights, securityLights, pool, Y_OVER, Y_POOL,
} from './ind_kit';

const LAWN = 0x6f9a45;
const LAWN2 = 0x7aa34d;
const PATH = 0xd8d4ca;
const WHITE = 0xf2f2f0;

/** Green roof (planted slab inset from the parapet) at height y. */
function greenRoof(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, inset = 0.6): void {
  b.paint(0xb8b8b2, Surf.Plain).box(x0, y, z0, x1, y + 0.5, z1, { bottom: null });
  b.paint(0x6d9a44, Surf.Foliage);
  flat(b, x0 + inset, z0 + inset, x1 - inset, z1 - inset, y + 0.52);
}

/** Rows of solar panels on a roof rect (facing +Z). */
function roofSolar(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, pitch = 2.6): void {
  for (let z = z0 + 1.2; z < z1 - 0.8; z += pitch) solarRow(b, (x0 + x1) / 2, z, x1 - x0 - 1.2, 1.7, 0.45, y + 0.3, 0x1d2a44, Surf.GlassCurtain, 3, false);
}

function path(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, color: ColorLike = PATH): void {
  b.paint(color, Surf.Pavement);
  flat(b, x0, z0, x1, z1, Y_OVER);
}

/** Glass curtain block with a light top band and roof. */
function glassBlock(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, h: number, tint: number, floor = 3.6, band: ColorLike = WHITE): void {
  b.paint(0x8aa0b0, Surf.GlassCurtain, tint, floor).box(x0, 0, z0, x1, h, z1, { top: { color: 0x9a9ea2, surf: Surf.RoofFlat } });
  b.paint(band, Surf.Plain);
  b.box(x0 - 0.15, h - 0.2, z0 - 0.15, x1 + 0.15, h + 0.7, z1 + 0.15, { bottom: null, top: null });
  b.box(x0 - 0.15, -0.0, z0 - 0.15, x1 + 0.15, 0.5, z1 + 0.15, { bottom: null, top: null });
}

/** Pond with stone edge. */
function pond(b: ModelBuilder, x: number, z: number, rx: number, rz: number, seg = 10): void {
  const pts = (r: number, y: number): V3[] => {
    const o: V3[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      o.push([x + Math.cos(a) * rx * r, y, z + Math.sin(a) * rz * r]);
    }
    return o;
  };
  const e = pts(1.12, 0.17), w = pts(1.0, 0.14);
  b.paint(0xc8c2b4, Surf.Stone);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    b.quad(w[i], e[i], e[j], w[j]);
  }
  b.paint(0x3f7ea6, Surf.Water);
  for (let i = 0; i < seg; i++) b.tri([x, 0.14, z], w[(i + 1) % seg], w[i]);
}

// ------------------------------------------------------------------------------------------------ ind_tech_campus
function techCampus(b: ModelBuilder, v: number, rng: RNG): void {
  const H = 24;
  ground(b, -H, -H, H, H, LAWN, Surf.Foliage, 0.05);
  switch (v) {
    case 0: {
      // twin glass pavilions linked by a glass bridge, green + solar roofs, water plaza, parking
      glassBlock(b, -21.5, -21, -4, -3, 14, 5, 3.5);
      greenRoof(b, -21.5, -21, -12, -3, 14);
      roofSolar(b, -12, -20.5, -4.5, -3.5, 14.2);
      glassBlock(b, 4, -15, 21.5, 3.5, 10.5, 1, 3.5);
      greenRoof(b, 4, -15, 21.5, 3.5, 10.5);
      b.paint(0x8aa0b0, Surf.GlassCurtain, 5, 3.5).box(-4, 6.5, -10, 4, 10, -6.5, { top: { color: WHITE, surf: Surf.Plain }, bottom: { color: WHITE, surf: Surf.Plain } });
      path(b, -21.5, -3, 21.5, 7.5);
      pond(b, -9, 2.2, 6, 2.6);
      path(b, -1.5, 7.5, 1.5, H);
      parking(b, rng, 5, 9, 22.5, 23, 0.6, 12);
      for (let i = 0; i < 4; i++) tree(b, rng, -20 + i * 5.2, 12.5 + (i % 2) * 5, 8, 2.6);
      for (let i = 0; i < 3; i++) tree(b, rng, -20 + i * 7, 20.5, 7, 2.3);
      tree(b, rng, 22, -20, 8, 2.2);
      for (let i = 0; i < 4; i++) tree(b, rng, 22.2, -12 + i * 5, 7.5, 1.7);
      for (let i = 0; i < 3; i++) tree(b, rng, -22.3, -18 + i * 6.5, 8, 1.6);
      signBox(b, -6, 0, 21.5, 0, 1.4, 22, 0x3fb0d8, 0xe8e8e4);
      break;
    }
    case 1: {
      // horseshoe courtyard building opening to the front, green roof, pond courtyard
      const outer: [number, number][] = [[-20, -21], [20, -21], [20, 8], [10, 8], [10, -11], [-10, -11], [-10, 8], [-20, 8]];
      b.paint(WHITE, Surf.WallWindows, 2, 3.8);
      b.extrude(outer, 0, 15.2, { topPaint: { color: 0x6d9a44, surf: Surf.Foliage } });
      b.paint(0x2a3440, Surf.GlassCurtain, 0, 3.8);
      wallQuad(b, 'pz', -11, -10, 10, 0.2, 15);
      b.paint(0xb8b8b2, Surf.Plain);
      for (const [x0, z0, x1, z1] of [[-20, -21, 20, -20.6], [-20, 7.6, -10, 8], [10, 7.6, 20, 8]] as [number, number, number, number][]) b.box(x0, 15.2, z0, x1, 15.8, z1, { bottom: null });
      roofSolar(b, -18, -20, 18, -12, 15.2);
      // courtyard
      path(b, -10, -11, 10, 8, 0xd0cbbd);
      b.paint(LAWN2, Surf.Foliage);
      flat(b, -8.5, -9.5, 8.5, 5, Y_POOL);
      pond(b, 0, -3, 4.5, 3);
      tree(b, rng, -6, 2.5, 8, 2.4);
      tree(b, rng, 6, -7, 8, 2.4);
      bench(b, 4, 3, 0);
      path(b, -2, 8, 2, H);
      parking(b, rng, -23, 10.5, -4, 23, 0.6, 10);
      for (let i = 0; i < 4; i++) tree(b, rng, 7 + i * 4.8, 13 + (i % 2) * 5, 7.5, 2.3);
      tree(b, rng, 21.5, -2, 8, 2.2);
      for (let i = 0; i < 3; i++) tree(b, rng, 22.2, 1.5 + i * 3.4, 7, 1.5);
      for (let i = 0; i < 4; i++) tree(b, rng, -22.3, -19 + i * 7.5, 8, 1.6);
      break;
    }
    case 2: {
      // three staggered white boxes rising in height, glass atria between, planted roof terraces
      const blocks: [number, number, number, number, number][] = [[-21.5, -2, -8, 13, 8], [-8, -12, 6, 4, 12.4], [6, -21.5, 21.5, -5, 17]];
      for (const [x0, z0, x1, z1, h] of blocks) {
        b.paint(WHITE, Surf.WallWindows, 2, 4.1).box(x0, 0, z0, x1, h, z1, { top: null });
        greenRoof(b, x0, z0, x1, z1, h, 0.8);
      }
      roofSolar(b, 7, -21, 21, -12, 17.2);
      b.paint(0x8aa0b0, Surf.GlassCurtain, 5, 4.1).box(-9.5, 0, -1, -7, 7.6, 4, { top: { color: WHITE, surf: Surf.Plain } });
      b.paint(0x8aa0b0, Surf.GlassCurtain, 5, 4.1).box(5, 0, -8, 7.5, 11.6, -3, { top: { color: WHITE, surf: Surf.Plain } });
      for (const [x, z] of [[-17, 4], [-12, 9], [-2, -5], [13, -15]] as [number, number][]) {
        const y = x < -8 ? 8.5 : x < 6 ? 12.9 : 17.5;
        b.paint(PALETTE.trunk, Surf.Wood);
        strut(b, [x, y, z], [x, y + 1.6, z], 0.25);
        b.paint(0x5a8a3a, Surf.Foliage).blob(x, y + 2.6, z, 1.6, 1.4, 1.6, 0, 0.15, x);
      }
      path(b, -21.5, 13, 21.5, 16);
      path(b, 7, -5, 10, 13);
      parking(b, rng, 10, -3.5, 23, 12.5, 0.6, 8);
      for (let i = 0; i < 5; i++) tree(b, rng, -20 + i * 9, 20.5, 8, 2.5);
      for (let i = 0; i < 3; i++) tree(b, rng, -21.5, -20 + i * 6, 7.5, 2.0);
      pond(b, -2, 8.5, 3.6, 2, 8);
      break;
    }
    case 3: {
      // glass office tower + low green-roofed wing, water plaza, parking
      glassBlock(b, 4, -21, 17, -7, 21, 0, 3.6);
      b.paint(0xd8dadc, Surf.Metal).box(6, 21.7, -19, 15, 24, -9, { bottom: null });
      b.paint(WHITE, Surf.WallWindows, 2, 3.5).box(-21.5, 0, -19, 4, 7, -8, { top: null });
      greenRoof(b, -21.5, -19, 4, -8, 7);
      roofSolar(b, -20.5, -18.5, -9, -8.5, 7.3);
      // roof terrace: deck, planters, parasols, benches
      b.paint(0xb08a62, Surf.Wood);
      flat(b, -7.5, -17.5, 2.5, -9.5, 7.6);
      for (let i = 0; i < 3; i++) {
        const tx = -5.5 + i * 3.4;
        b.paint(0xf2f2f0, Surf.Plain);
        strut(b, [tx, 7.6, -13.5], [tx, 9.6, -13.5], 0.08);
        b.paint(i === 1 ? 0xe67e22 : 0x2e8b8b, Surf.Plain);
        lathe(b, tx, -13.5, [[1.2, 9.3], [0, 9.9]], 6);
        b.paint(0x8a6a47, Surf.Wood).boxC(tx, -11.5, 1.6, 0.5, 7.6, 0.45);
      }
      b.paint(0x5a8a3a, Surf.Foliage).box(-7.5, 7.6, -17.5, 2.5, 8.3, -16.8, { bottom: null });
      b.paint(0x2a3440, Surf.GlassCurtain, 5, 3.5).box(-3, 0, -8, 4, 4.2, -5, { top: { color: WHITE, surf: Surf.Plain } });
      path(b, -21.5, -7, 21.5, 4);
      pond(b, 11, -2, 5, 2.4, 10);
      for (let i = 0; i < 4; i++) {
        b.paint(0xeef2f4, Surf.Emissive);
        disc(b, 7 + i * 2.8, -2, 0.16, 0.2, 5);
      }
      path(b, -1, 4, 1.5, H);
      parking(b, rng, -23, 6, -3, 23, 0.6, 12);
      for (let i = 0; i < 4; i++) tree(b, rng, 5 + i * 5, 9 + (i % 2) * 7, 8, 2.5);
      tree(b, rng, 21.5, -19, 8, 2.2);
      tree(b, rng, 21.5, 20, 8, 2.2);
      tree(b, rng, -22.2, -21.5, 7, 1.5);
      // logo pylon + EV chargers at the parking
      b.paint(0xf2f2f0, Surf.Plain).box(0.2, 0, 15.5, 1.2, 7.5, 17.5);
      b.paint(0x2e6fb5, Surf.Emissive, 3);
      wallQuad(b, 'px', 1.2, 15.8, 17.2, 4.8, 7.1);
      wallQuad(b, 'nx', 0.2, 15.8, 17.2, 4.8, 7.1);
      for (let i = 0; i < 4; i++) {
        b.paint(0xe8ecee, Surf.Plain).boxC(-21.6 + i * 2.7, 6.5, 0.4, 0.3, Y_OVER, 1.5);
        b.paint(0x3fd07f, Surf.Emissive, 4);
        wallQuad(b, 'pz', 6.65, -21.75 + i * 2.7, -21.45 + i * 2.7, 1.05, 1.35, 0.02);
      }
      for (let i = 0; i < 3; i++) tree(b, rng, 21.8, -3 + i * 5.5, 7.5, 1.8);
      signBox(b, 2, 0, 21.8, 8, 1.4, 22.2, 0x2e6fb5, 0xe8e8e4);
      break;
    }
    default: {
      // low timber + glass pavilions around a central quad, solar carports over the parking
      const pav: [number, number, number, number, number][] = [[-21.5, -21.5, -4, -11, 8], [4, -21.5, 21.5, -11, 10], [-21.5, -7, -12, 9, 8], [12, -7, 21.5, 9, 7.5]];
      for (const [x0, z0, x1, z1, h] of pav) {
        b.paint(0x9a7050, Surf.Wood).box(x0, 0, z0, x1, h, z1, { top: null });
        b.paint(0x2a3440, Surf.GlassCurtain, 3, h / 2);
        const alongX = x1 - x0 > z1 - z0;
        if (alongX) { wallQuad(b, 'pz', z1, x0 + 0.8, x1 - 0.8, 0.8, h - 1.2); wallQuad(b, 'nz', z0, x0 + 0.8, x1 - 0.8, 0.8, h - 1.2); }
        else { wallQuad(b, x0 < 0 ? 'px' : 'nx', x0 < 0 ? x1 : x0, z0 + 0.8, z1 - 0.8, 0.8, h - 1.2); wallQuad(b, x0 < 0 ? 'nx' : 'px', x0 < 0 ? x0 : x1, z0 + 0.8, z1 - 0.8, 0.8, h - 1.2); }
        greenRoof(b, x0, z0, x1, z1, h, 0.7);
      }
      roofSolar(b, 5, -21, 21, -11.5, 10.2);
      // quad
      path(b, -12, -11, 12, 9, 0xd0cbbd);
      b.paint(LAWN2, Surf.Foliage);
      flat(b, -9, -8, 9, 6.5, Y_POOL);
      tree(b, rng, -5, -3, 9, 3);
      tree(b, rng, 5, 2, 9, 3);
      bench(b, 0, 5, 0);
      path(b, -2, 9, 2, H);
      // solar carport parking at the front
      b.paint(PALETTE.asphalt, Surf.Pavement);
      flat(b, -23, 11, 23, 23, Y_OVER);
      for (const zc of [14, 20]) {
        for (let i = 0; i < 12; i++) {
          if (Math.abs(-21 + i * 3.7 + 1.3) < 3) continue;
          if (rng.chance(0.65)) carLow(b, -21 + i * 3.7 + 1.3, zc, zc < 17 ? Math.PI : 0, rng.pick(CAR_COLORS2));
        }
        b.paint(0x8a9096, Surf.Metal);
        for (const x of [-18, -8, 8, 18]) strut(b, [x, 0, zc], [x, 3.4, zc], 0.3);
        solarRow(b, -12.2, zc, 20, 5.2, 0.12, 3.2, 0x1d2a44, Surf.GlassCurtain, 3, false);
        solarRow(b, 12.2, zc, 20, 5.2, 0.12, 3.2, 0x1d2a44, Surf.GlassCurtain, 3, false);
      }
      break;
    }
  }
}

// ------------------------------------------------------------------------------------------------ ind_lab
function exhaustStacks(b: ModelBuilder, x: number, z: number, y: number, n: number, h = 4.5): void {
  for (let i = 0; i < n; i++) {
    b.paint(0xd8dadc, Surf.Metal);
    tube(b, x + i * 1.8, z, y, h, 0.38, 0.3, 6);
    b.paint(0x2e3134, Surf.Metal);
    disc(b, x + i * 1.8, z, y + h, 0.3, 6);
  }
}

function lab(b: ModelBuilder, v: number, rng: RNG): void {
  const H = 16;
  ground(b, -H, -H, H, H, LAWN, Surf.Foliage, 0.05);
  switch (v) {
    case 0: {
      // white 3-storey lab, penthouse + exhaust stacks, glass entrance canopy, parking
      const x0 = -14, x1 = 8, z0 = -14, z1 = 2;
      b.paint(WHITE, Surf.WallWindows, 2, 4.0).box(x0, 0, z0, x1, 12.4, z1, { top: { color: 0x9a9ea2, surf: Surf.RoofFlat } });
      b.paint(0xd0d4d6, Surf.Plain).box(x0 - 0.1, 12.2, z0 - 0.1, x1 + 0.1, 13, z1 + 0.1, { bottom: null });
      // louvred penthouse (vertical corrugated bands) + six 7 m exhaust stacks
      b.paint(0xa4a8ac, Surf.Corrugated).box(-9, 12.4, -11, 1, 16, -5);
      b.paint(0xc4c8cc, Surf.Corrugated);
      for (let x = -8.4; x < 0.6; x += 1.5) wallQuad(b, 'pz', -5, x, x + 0.7, 12.9, 15.5, 0.05);
      for (let z = -10.4; z < -5.4; z += 1.5) wallQuad(b, 'px', 1, z, z + 0.7, 12.9, 15.5, 0.05);
      exhaustStacks(b, -8, -3, 12.4, 6, 7);
      // vertical white fins on the +Z facade
      b.paint(WHITE, Surf.Plain);
      for (let x = x0 + 1.05; x <= x1 - 0.5; x += 2.1) if (x < -5.4 || x > 1.4) b.box(x - 0.12, 0.5, z1, x + 0.12, 12.4, z1 + 0.7, { bottom: null, nz: null });
      roofUnit(b, 4, 12.4, -10, 3, 2.4, 1.6);
      b.paint(0x2a3440, Surf.GlassCurtain, 5, 4.0).box(-5, 0, z1, 1, 8, z1 + 1.2, { top: { color: WHITE, surf: Surf.Plain } });
      b.paint(WHITE, Surf.Plain).box(-6.5, 4.2, z1, 2.5, 4.6, z1 + 4);
      path(b, -3.5, z1, -0.5, H);
      path(b, -14, z1 + 4, 8, z1 + 6);
      parking(b, rng, 9, -14, 15.5, 14, 0.7, 8);
      for (let i = 0; i < 3; i++) tree(b, rng, -12 + i * 4.6, 11.5, 7, 2.2);
      tree(b, rng, 5, 11.5, 7, 2.2);
      signBox(b, -13, 0, 13.8, -8, 1.2, 14.2, 0x2e8b57, 0xe8e8e4);
      break;
    }
    case 1: {
      // glass box with vertical white fins, rooftop screen, lawn
      const x0 = -12.5, x1 = 12.5, z0 = -13, z1 = 1.5;
      b.paint(0x8aa0b0, Surf.GlassCurtain, 4, 3.8).box(x0, 0, z0, x1, 15.2, z1, { top: { color: 0x9a9ea2, surf: Surf.RoofFlat } });
      b.paint(WHITE, Surf.Plain);
      for (let x = x0 + 1; x <= x1 - 0.5; x += 2.1) b.box(x - 0.15, 0, z1, x + 0.15, 15.6, z1 + 0.8, { bottom: null, nz: null });
      for (let z = z0 + 1; z <= z1 - 0.5; z += 2.4) b.box(x1, 0, z - 0.15, x1 + 0.8, 15.6, z + 0.15, { bottom: null, nx: null });
      b.paint(0xe6e8e8, Surf.Corrugated).box(-8, 15.2, -10, 6, 18, -3, { bottom: null });
      exhaustStacks(b, -9.5, -11.5, 15.2, 3, 4);
      path(b, -2, z1, 2, H);
      path(b, -14, 5, 14, 7);
      for (let i = 0; i < 6; i++) carLow(b, -13 + i * 2.8, 11, Math.PI, rng.pick(CAR_COLORS2));
      b.paint(PALETTE.asphalt, Surf.Pavement);
      flat(b, -14.5, 8, -0.5, 14, Y_OVER);
      tree(b, rng, 6, 11, 7.5, 2.3);
      tree(b, rng, 11.5, 11, 7.5, 2.3);
      tree(b, rng, 13.5, -12, 7, 2.0);
      break;
    }
    case 2: {
      // L-shaped white wings + cylindrical glass atrium at the corner
      b.paint(0xeceae4, Surf.WallWindows, 5, 3.6).box(-14, 0, -14, 4, 11, -6, { top: { color: 0x9a9ea2, surf: Surf.RoofFlat } });
      b.paint(0xeceae4, Surf.WallWindows, 5, 3.6).box(-14, 0, -6, -6, 11, 10, { top: { color: 0x9a9ea2, surf: Surf.RoofFlat } });
      b.paint(0x8aa0b0, Surf.GlassCurtain, 5, 3.6);
      tube(b, -1.5, -2, 0, 13.5, 5, 5, 14);
      b.paint(WHITE, Surf.Plain);
      disc(b, -1.5, -2, 13.5, 5.3, 14);
      tube(b, -1.5, -2, 13.1, 0.6, 5.3, 5.3, 14);
      roofUnit(b, -10, 11, -12, 3, 2.4, 1.6);
      roofUnit(b, -10, 11, 4, 3, 2.4, 1.6);
      exhaustStacks(b, -2, -12, 11, 3, 4);
      b.paint(LAWN2, Surf.Foliage);
      flat(b, 4, -4, 15.5, 15.5, Y_OVER);
      path(b, 1, 2.5, 4, H);
      pond(b, 9.5, 5, 3.6, 2.4, 8);
      for (let i = 0; i < 4; i++) carLow(b, 7 + i * 2.8, -12, Math.PI * 0.5 * 0 + Math.PI, rng.pick(CAR_COLORS2));
      b.paint(PALETTE.asphalt, Surf.Pavement);
      flat(b, 5, -15.5, 15.5, -8.5, Y_OVER);
      tree(b, rng, -11, 13, 7, 2.2);
      tree(b, rng, 13, 12.5, 7, 2.2);
      break;
    }
    case 3: {
      // lab with cryogenic tank farm, chillers, stair tower
      b.paint(0xe6e8e8, Surf.WallWindows, 4, 3.6).box(-14, 0, -12, 5, 10.2, 4, { top: { color: 0x9a9ea2, surf: Surf.RoofFlat } });
      b.paint(0x3f7fd0, Surf.Plain).box(-14.1, 9.4, -12.1, 5.1, 10.4, 4.1, { bottom: null, top: null });
      b.paint(0x2a3440, Surf.GlassCurtain, 0, 3.6).box(-6, 0, 4, -1, 13, 6.5, { top: { color: 0xd8d8d4, surf: Surf.Plain } });
      for (let i = 0; i < 4; i++) roofUnit(b, -11 + i * 4.2, 10.2, -5, 3, 4, 1.8, 0xc8ccd0);
      exhaustStacks(b, -12, -10, 10.2, 3, 3.5);
      // tank yard behind a fence
      b.paint(0x9c958a, Surf.Pavement);
      flat(b, 7, -15, 15.5, 2, Y_OVER);
      for (let i = 0; i < 3; i++) tank(b, 9.5 + (i % 2) * 3.6, -12.5 + i * 4.2, 1.2, 9 + (i % 2), WHITE, { roof: 'dome', seg: 8 });
      b.paint(0x9aa0a6, Surf.Metal);
      b.pipe([9.5, 1.2, -12.5], [5, 1.2, -12.5], 0.18, 5);
      fenceRect(b, 7, -15, 15.5, 2, 2.2, 0x8a9096, undefined, 4, 2);
      path(b, -5, 6.5, -2, H);
      parking(b, rng, -15.5, 8, -6, 15.5, 0.6, 6);
      for (let i = 0; i < 3; i++) tree(b, rng, 2 + i * 5, 11.5, 7, 2.2);
      break;
    }
    default: {
      // stepped terraces with planted green roofs, glass + timber
      const tiers: [number, number, number, number, number, number][] = [
        [-14, -14, 12, 4, 0, 5], [-14, -14, 7, -1, 5, 10], [-14, -14, 2, -6, 10, 15],
      ];
      for (const [x0, z0, x1, z1, y0, y1] of tiers) {
        b.paint(0x8aa0b0, Surf.GlassCurtain, 1, 3.4).box(x0, y0, z0, x1, y1 - 0.6, z1, { top: null, bottom: null });
        b.paint(0x9a7050, Surf.Wood).box(x0 - 0.1, y1 - 0.6, z0 - 0.1, x1 + 0.1, y1, z1 + 0.1, { bottom: null, top: null });
        b.paint(0x6d9a44, Surf.Foliage);
        flat(b, x0, z0, x1, z1, y1);
      }
      for (const [x, z, y] of [[9, 1, 5], [4, -3.5, 10], [-2, -8, 15], [-10, 1, 5]] as [number, number, number][]) {
        b.paint(0x4f7f35, Surf.Foliage).blob(x, y + 1.0, z, 1.3, 1.1, 1.3, 0, 0.15, x + z);
      }
      exhaustStacks(b, -12, -12, 15, 2, 3);
      path(b, -2, 4, 1, H);
      b.paint(LAWN2, Surf.Foliage);
      flat(b, 3, 6, 15.5, 15.5, Y_OVER);
      pond(b, 9, 10.5, 4, 2.6, 8);
      parking(b, rng, -15.5, 6, -3, 15.5, 0.6, 6);
      tree(b, rng, 14, -8, 7, 2.2);
      tree(b, rng, 14, -2, 7, 2.2);
      break;
    }
  }
}

// ------------------------------------------------------------------------------------------------ ind_datacenter
/** Chiller unit with 2 fan discs (~26 tris). */
function chiller(b: ModelBuilder, x: number, y: number, z: number, w = 2.4, d = 4.2, h = 1.8, color: ColorLike = 0xc8ccd0): void {
  b.paint(color, Surf.Metal).box(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2);
  b.paint(0x2e3134, Surf.Metal);
  disc(b, x, z - d * 0.25, y + h + 0.02, w * 0.38, 6);
  disc(b, x, z + d * 0.25, y + h + 0.02, w * 0.38, 6);
}

/** Generator set (container) with exhaust stack. */
function genset(b: ModelBuilder, x: number, z: number, color: ColorLike = 0xd8dadc): void {
  b.paint(color, Surf.Corrugated).box(x - 1.3, 0, z - 3.0, x + 1.3, 2.9, z + 3.0);
  b.paint(0x55595e, Surf.Metal);
  tube(b, x + 0.6, z - 1.8, 2.9, 1.6, 0.22, 0.22, 5);
}

function datacenter(b: ModelBuilder, v: number, rng: RNG): void {
  const HX = 24, HZ = 16;
  const DG = 0x9c958a;
  ground(b, -HX, -HZ, HX, HZ, DG, Surf.Pavement, 0.05);
  b.paint(LAWN, Surf.Foliage);
  flat(b, -HX, 11, HX, HZ, Y_OVER);
  fenceRect(b, -23.3, -15.3, 23.3, 10.5, 2.6, 0x8a9096, [2, 8], 6, 2, true);
  // security lights along the fence every ~12 m (6 m posts, cool LED + light pools inside the fence)
  securityLights(b, -22.6, 9.8, -22.6, -11, 10.4, DG, 6, [1, 0]);
  securityLights(b, 22.6, 9.8, 22.6, -11, 10.4, DG, 6, [-1, 0]);
  securityLights(b, -10.6, -14.6, 10.6, -14.6, 12, DG, 6, [0, 1]);
  // guard house at the gate (lit window)
  b.paint(0xe6e8e8, Surf.Plain).box(8.8, 0, 7.5, 11.5, 3.0, 10);
  b.paint(0x2a3440, Surf.GlassPlain, 2);
  wallQuad(b, 'nx', 8.8, 7.8, 9.7, 1.1, 2.6);
  wallQuad(b, 'pz', 10, 9.1, 11.2, 1.1, 2.6);
  lightDot(b, 8.4, 3.2, 8.8, 0.26, 0xe8f0ff);
  b.paint(PALETTE.asphalt, Surf.Pavement);
  flat(b, 2, 4, 8, HZ, Y_POOL);
  b.paint(0xc0392b, Surf.Plain);
  strut(b, [2.2, 1.0, 11], [7.8, 1.0, 11], 0.12);
  switch (v) {
    case 0: {
      // single big windowless hall, panel strips, rooftop chiller rows, generator row, transformers
      const x0 = -22, x1 = 12, z0 = -14, z1 = 3;
      b.paint(0xcfd2d4, Surf.Plain).box(x0, 0, z0, x1, 11, z1, { top: { color: 0x9a9ea2, surf: Surf.RoofFlat } });
      b.paint(0xb4b8bc, Surf.Plain);
      for (let x = x0 + 2; x < x1 - 1; x += 4) wallQuad(b, 'pz', z1, x, x + 0.6, 0, 11);
      b.paint(0x2e6fb5, Surf.Plain);
      wallQuad(b, 'pz', z1, x0, x1, 9.4, 10.2);
      b.paint(0x3fa0ff, Surf.Emissive, 3);
      wallQuad(b, 'pz', z1, x0, x1, 8.9, 9.2, 0.05);
      b.paint(0x55595e, Surf.Corrugated);
      wallQuad(b, 'pz', z1, x1 - 6, x1 - 2, 0, 4);
      lightDot(b, x1 - 4, 4.6, z1 + 0.35, 0.26, 0xe8f0ff);
      b.paint(0xa9adb0, Surf.Metal).box(x0 - 0.1, 11, z0 - 0.1, x1 + 0.1, 11.8, z1 + 0.1, { bottom: null, top: null });
      for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) chiller(b, x0 + 3.5 + i * 5.4, 11, z0 + 3.6 + r * 5.2);
      for (let i = 0; i < 4; i++) genset(b, 15 + (i % 2) * 3.6, -12 + Math.floor(i / 2) * 7.2);
      // transformer yard
      for (let i = 0; i < 2; i++) {
        b.paint(0x6a7a6a, Surf.Metal).box(14 + i * 4.2, 0, 0, 17 + i * 4.2, 2.8, 3.2);
        b.paint(0x8a9096, Surf.Metal);
        for (let k = 0; k < 3; k++) strut(b, [14.6 + i * 4.2 + k * 0.9, 2.8, 1.6], [14.6 + i * 4.2 + k * 0.9, 4.2, 1.6], 0.14);
      }
      for (let i = 0; i < 4; i++) carLow(b, -20 + i * 2.8, 7.6, Math.PI, rng.pick(CAR_COLORS2));
      break;
    }
    case 1: {
      // three white modules with blue band, ground-level coolers between, water tanks
      for (let m = 0; m < 3; m++) {
        const x0 = -22 + m * 12.3, x1 = x0 + 10;
        b.paint(0xf0f0ec, Surf.Plain).box(x0, 0, -14, x1, 12, 1, { top: { color: 0xa9adb0, surf: Surf.RoofFlat } });
        b.paint(0x1f5fa8, Surf.Plain);
        wallQuad(b, 'pz', 1, x0, x1, 1.0, 1.8);
        wallQuad(b, 'pz', 1, x0 + 0.8, x0 + 1.6, 1.8, 11);
        b.paint(0x3fa0ff, Surf.Emissive, 3);
        wallQuad(b, 'pz', 1, x0 + 2, x1, 1.95, 2.2, 0.05);
        // louvre bands 8-11 m
        b.paint(0xb8bcc0, Surf.Corrugated);
        wallQuad(b, 'pz', 1, x0 + 2, x1 - 0.6, 8, 11, 0.04);
        wallQuad(b, 'nz', -14, x0 + 0.6, x1 - 0.6, 8, 11, 0.04);
        b.paint(0x55595e, Surf.Metal);
        wallQuad(b, 'pz', 1, x1 - 3.5, x1 - 1, 0, 3);
        lightDot(b, x1 - 2.25, 3.5, 1.35, 0.24, 0xe8f0ff);
        for (let i = 0; i < 2; i++) roofUnit(b, x0 + 3 + i * 4, 12, -6, 2.4, 6, 1.6, 0xc8ccd0);
      }
      for (let i = 0; i < 5; i++) chiller(b, 16.5, 0, -12.5 + i * 4.6, 3, 4, 2.2);
      for (let i = 0; i < 2; i++) chiller(b, 20.8, 0, -12.5 + i * 4.6, 3, 4, 2.2);
      tank(b, 20.8, -0.5, 1.8, 7, 0xe8e8e2, { roof: 'dome', seg: 10 });
      tank(b, 20.8, 5, 1.8, 7, 0xe8e8e2, { roof: 'dome', seg: 10 });
      for (let i = 0; i < 3; i++) genset(b, -20 + i * 3.6, 6.2, 0x55595e);
      for (let i = 0; i < 3; i++) carLow(b, -6 + i * 2.8, 7, Math.PI, rng.pick(CAR_COLORS2));
      break;
    }
    default: {
      // dark hall with teal accent, fully solar roof, round fan cooling towers (steam) on the side
      const x0 = -22, x1 = 9, z0 = -14, z1 = 3;
      b.paint(0x3a3f45, Surf.Plain).box(x0, 0, z0, x1, 10, z1, { top: { color: 0x7a7e82, surf: Surf.RoofFlat } });
      b.paint(0x16a085, Surf.Emissive);
      wallQuad(b, 'pz', z1, x0, x1, 8.6, 9.0);
      wallQuad(b, 'px', x1, z0, z1, 8.6, 9.0);
      b.paint(0x2a2e33, Surf.Plain);
      for (let x = x0 + 1.5; x < x1 - 1; x += 3) wallQuad(b, 'pz', z1, x, x + 1.8, 0.4, 8.2);
      for (let z = z0 + 1.2; z < z1 - 0.5; z += 2.4) solarRow(b, (x0 + x1) / 2, z, x1 - x0 - 1.6, 1.8, 0.4, 10.3, 0x1d2a44, Surf.GlassCurtain, 3, false);
      for (let i = 0; i < 3; i++) {
        const cz = -11 + i * 6.2;
        b.paint(0x9aa6ac, Surf.Corrugated);
        lathe(b, 16, cz, [[2.7, 0], [2.6, 4.5], [2.2, 6.2]], 12);
        b.paint(0x7f8a90, Surf.Metal);
        tube(b, 16, cz, 6.2, 1.2, 2.2, 2.3, 12);
        b.paint(0x2e3134, Surf.Metal);
        disc(b, 16, cz, 7.3, 2.2, 10);
        emitSteam([16, 8.2, cz]);
      }
      for (let i = 0; i < 3; i++) genset(b, 21, -11 + i * 6.8, 0x55595e);
      b.paint(0x9aa0a6, Surf.Metal);
      b.pipe([x1, 3, -9], [13.3, 3, -9], 0.35, 6);
      b.pipe([x1, 3, -3], [13.3, 3, -3], 0.35, 6);
      for (let i = 0; i < 4; i++) carLow(b, -20 + i * 2.8, 7.4, Math.PI, rng.pick(CAR_COLORS2));
      boxTruck(b, -4, 7.5, Math.PI * 0.5, 0xf2f2ee, 0x3a3f45);
      break;
    }
  }
}

export const techModels: ModelBuilders = {
  ind_tech_campus: (b, v, rng) => techCampus(b, v, rng),
  ind_lab: (b, v, rng) => lab(b, v, rng),
  ind_datacenter: (b, v, rng) => datacenter(b, v, rng),
};
