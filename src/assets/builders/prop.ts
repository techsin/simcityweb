/**
 * Procedural models for the 'prop' group: street furniture, billboards, container stacks, construction sites, rubble.
 * Budget <= 200 tris. Origin at the base center; props with a direction (streetlight arm, traffic light arm) point
 * their arm toward -X; signal faces / billboard faces / bench fronts face +Z.
 * construction_site and rubble fill a whole 16 x 16 m cell edge to edge (the renderer stretches them to the lot).
 */
import type { ModelBuilders } from '../registry';
import type { ModelBuilder, Paint } from '../ModelBuilder';
import type { RNG } from '../../core/rng';
import { Surf } from '../../core/types';
import { limb, lathe, leafBlob, tintSince, mark, polyOut, quadOut, jitterHex, mixHex, type V3 } from './nat_geom';
import { P, profileSolid, lamp } from './veh_parts';

const POLE = 0x3b4046; // dark grey-green painted steel
const GALV = 0x9aa0a6; // galvanized steel
const LAMP_WARM = P(0xffdca0, Surf.Emissive);
const CONCRETE = 0xa9a59c;

/** Streetlight arm + cobra-head luminaire toward direction s (-1 = -X). */
function lightArm(b: ModelBuilder, s: number, top: number) {
  b.paint(POLE, Surf.Metal);
  limb(b, [[0, top - 0.5, 0], [s * 0.55, top + 0.05, 0], [s * 2.2, top + 0.22, 0]], [0.07, 0.06, 0.05], { seg: 4 });
  const x0 = s * 2.05, x1 = s * 3.05;
  b.paint(0x4a5057, Surf.Metal).box(x0, top + 0.02, -0.26, x1, top + 0.3, 0.26, { bottom: { color: 0x33373c, surf: Surf.Metal } });
  b.paint(LAMP_WARM).box(x0 + s * 0.08, top - 0.16, -0.22, x1 - s * 0.1, top + 0.02, 0.22, { top: null, bottom: LAMP_WARM });
}

/** Traffic signal head facing +Z (dir = 1) or +X (dir = 2); lit: 0 red, 1 amber, 2 green. 16 tris. */
function signalHead(b: ModelBuilder, x: number, y: number, z: number, dir: 1 | 2, lit: number) {
  b.paint(0x1f2124, Surf.Metal);
  if (dir === 1) b.box(x - 0.2, y - 0.55, z - 0.16, x + 0.2, y + 0.55, z + 0.16);
  else b.box(x - 0.16, y - 0.55, z - 0.2, x + 0.16, y + 0.55, z + 0.2);
  const cols = [0xff2a1a, 0xffa31a, 0x2aff7a];
  const dim = [0x3a1210, 0x3a2a10, 0x103a22];
  for (let i = 0; i < 3; i++) {
    const cy = y + 0.34 - i * 0.34;
    const paint: Paint = i === lit ? P(cols[i], Surf.Emissive) : P(dim[i], Surf.Metal);
    b.paint(paint);
    const r = 0.12;
    if (dir === 1) quadOut(b, [x - r, cy - r, z + 0.17], [x + r, cy - r, z + 0.17], [x + r, cy + r, z + 0.17], [x - r, cy + r, z + 0.17], [0, 0, 1]);
    else quadOut(b, [x + 0.17, cy - r, z - r], [x + 0.17, cy - r, z + r], [x + 0.17, cy + r, z + r], [x + 0.17, cy + r, z - r], [1, 0, 0]);
  }
}

/** Shipping container along X (40 ft or 20 ft) with a darker door end at +X. 10 tris. */
function box40(b: ModelBuilder, x: number, y: number, z: number, long: boolean, col: number, alongZ = false) {
  const L = long ? 12.19 : 6.06, W = 2.44, H = 2.59;
  const door = { color: mixHex(col, 0x202020, 0.25), surf: Surf.Corrugated };
  const top = { color: mixHex(col, 0x9a9a9a, 0.15), surf: Surf.Metal };
  b.paint(col, Surf.Corrugated);
  if (!alongZ) b.box(x - L / 2, y, z - W / 2, x + L / 2, y + H, z + W / 2, { px: door, top });
  else b.box(x - W / 2, y, z - L / 2, x + W / 2, y + H, z + L / 2, { pz: door, top });
}
const CONTAINER_COLS = [0x2a6fa8, 0xb84a2a, 0x3e7d4a, 0xd8a23a, 0x8a8f94, 0xc9ccd0, 0x6b2f5a, 0xd06a2a, 0x2f4f7f, 0x9b2f2a, 0x4a8a8a];

/** Dirt lot + plywood hoarding around the 16 x 16 cell with a gate gap on the street (+Z) side. 40 tris. */
function siteBase(b: ModelBuilder, rng: RNG) {
  b.paint(0x8a6e4b, Surf.Plain);
  quadOut(b, [-8, 0.08, -8], [8, 0.08, -8], [8, 0.08, 8], [-8, 0.08, 8], [0, 1, 0]);
  b.paint(0x7a5f40, Surf.Plain);
  quadOut(b, [rng.range(-6, -2), 0.085, rng.range(-6, -2)], [rng.range(2, 6), 0.085, rng.range(-7, -3)], [rng.range(3, 7), 0.085, rng.range(2, 6)], [rng.range(-7, -3), 0.085, rng.range(1, 5)], [0, 1, 0]);
  const t = 0.07, h = 2.0;
  b.paint(0xc4ab7e, Surf.Wood);
  const nz = { nz: null, pz: null, top: null }, nx = { nx: null, px: null, top: null };
  b.box(-8, 0, -8, -8 + t, h, 8, nz);
  b.box(8 - t, 0, -8, 8, h, 8, nz);
  b.box(-8 + t, 0, -8, 8 - t, h, -8 + t, nx);
  b.box(-8 + t, 0, 8 - t, -2.6, h, 8, nx);
  b.box(2.6, 0, 8 - t, 8 - t, h, 8, nx);
  // safety stripe on the street side
  b.paint(0xe8b421, Surf.Plain);
  for (const [a, c] of [[-8, -2.6], [2.6, 8]]) quadOut(b, [a, 1.55, 8.005], [c, 1.55, 8.005], [c, 1.8, 8.005], [a, 1.8, 8.005], [0, 0, 1]);
}

/** Small portable toilet / site office helpers. */
function portaloo(b: ModelBuilder, x: number, z: number) {
  b.paint(0x2f6fb5, Surf.Plain).box(x - 0.6, 0.08, z - 0.6, x + 0.6, 2.3, z + 0.6, { top: { color: 0xe8e8e2, surf: Surf.Plain } });
}
function siteOffice(b: ModelBuilder, x: number, z: number, rotY = 0) {
  b.push().translate(x, 0.08, z).rotateY(rotY);
  b.paint(0xe8e4da, Surf.Corrugated).box(-3, 0, -1.2, 3, 2.6, 1.2, { pz: { color: 0xe8e4da, surf: Surf.Corrugated } });
  b.paint(0x2a3440, Surf.Metal);
  quadOut(b, [-2.2, 1.2, 1.21], [-0.6, 1.2, 1.21], [-0.6, 2.0, 1.21], [-2.2, 2.0, 1.21], [0, 0, 1]);
  b.pop();
}

/** Jagged broken wall stub (profile in the z/y plane, thickness 2*hw), placed with a transform by the caller. ~18 tris. */
function brokenWall(b: ModelBuilder, rng: RNG, len: number, hMax: number, hw: number, paint: Paint) {
  const n = 4;
  const pts: { z: number; y: number }[] = [{ z: -len / 2, y: 0 }, { z: len / 2, y: 0 }];
  for (let i = n; i >= 0; i--) {
    const z = -len / 2 + (len * i) / n + (i > 0 && i < n ? rng.range(-0.3, 0.3) : 0);
    const y = hMax * (i % 2 === 0 ? rng.range(0.55, 1.0) : rng.range(0.15, 0.5));
    pts.push({ z, y });
  }
  profileSolid(b, pts, hw, paint);
}

export const models: ModelBuilders = {
  // Street light: plinth, tapered pole, curved arm(s) toward -X, cobra head with warm emissive lens. 60 / 98 tris.
  streetlight(b, v) {
    const top = 9.0;
    b.paint(CONCRETE, Surf.Pavement).box(-0.28, 0, -0.28, 0.28, 0.5, 0.28);
    b.paint(POLE, Surf.Metal);
    limb(b, [[0, 0.5, 0], [0, top, 0]], [0.13, 0.08], { seg: 6 });
    lightArm(b, -1, top);
    if (v === 1) lightArm(b, 1, top);
  },

  // Traffic light: pole, mast arm over the road toward -X, two heads facing +Z (green), pole heads (+Z green, +X red),
  // street name sign. ~110 tris.
  traffic_light(b) {
    b.paint(CONCRETE, Surf.Pavement).box(-0.3, 0, -0.3, 0.3, 0.3, 0.3);
    b.paint(GALV, Surf.Metal);
    limb(b, [[0, 0.3, 0], [0, 5.8, 0]], [0.14, 0.1], { seg: 6, cap: true });
    b.beam([0, 5.35, 0], [-5.6, 5.5, 0], 0.14);
    b.beam([0, 4.6, 0], [-1.6, 5.37, 0], 0.07);
    signalHead(b, -2.9, 4.85, 0.1, 1, 2);
    signalHead(b, -5.2, 4.9, 0.1, 1, 2);
    signalHead(b, 0.0, 3.0, 0.3, 1, 2);
    signalHead(b, 0.3, 3.0, 0.0, 2, 0);
    // street name sign (double sided)
    b.paint(0x1f6b3a, Surf.Plain);
    quadOut(b, [-0.4, 5.75, 0.08], [-2.0, 5.75, 0.08], [-2.0, 6.05, 0.08], [-0.4, 6.05, 0.08], [0, 0, 1]);
    quadOut(b, [-0.4, 5.75, 0.07], [-2.0, 5.75, 0.07], [-2.0, 6.05, 0.07], [-0.4, 6.05, 0.07], [0, 0, -1]);
    b.paint(0xf2f2ee, Surf.Plain);
    quadOut(b, [-0.55, 5.86, 0.085], [-1.85, 5.86, 0.085], [-1.85, 5.94, 0.085], [-0.55, 5.94, 0.085], [0, 0, 1]);
  },

  // Park bench facing +Z: cast iron frames, 3 seat slats, 2 back slats. ~100 tris.
  bench(b) {
    b.paint(0x2a2c2e, Surf.Metal);
    for (const x of [-0.82, 0.82]) {
      b.beam([x, 0, 0.22], [x, 0.44, 0.18], 0.07);
      b.beam([x, 0, -0.24], [x, 0.9, -0.34], 0.07);
      b.beam([x, 0.42, 0.26], [x, 0.44, -0.28], 0.06);
      b.beam([x, 0.62, 0.24], [x, 0.64, -0.3], 0.06);
    }
    b.paint(0x8a5f38, Surf.Wood);
    for (let i = 0; i < 3; i++) {
      const z = 0.2 - i * 0.16;
      b.box(-0.95, 0.44, z - 0.065, 0.95, 0.48, z + 0.065);
    }
    b.push().translate(0, 0, -0.3).rotateX(-0.2);
    b.box(-0.95, 0.52, -0.02, 0.95, 0.64, 0.02);
    b.box(-0.95, 0.72, -0.02, 0.95, 0.86, 0.02);
    b.pop();
  },

  // v0 classic round two-tier stone fountain with water veil; v1 modern square basin with a jet grid. 100-150 tris.
  fountain(b, v) {
    const stone = 0xc9c1b0;
    const water = 0x4f9cc0;
    const spray = 0xcfe6ef;
    if (v === 0) {
      b.paint(stone, Surf.Stone);
      lathe(b, 0, 0, [[2.6, 0], [2.6, 0.5], [2.35, 0.55], [2.3, 0.3]], 10, { smooth: false });
      b.paint(water, Surf.Water);
      lathe(b, 0, 0, [[2.32, 0.34], [0, 0.34]], 10);
      b.paint(stone, Surf.Stone);
      lathe(b, 0, 0, [[0.42, 0.3], [0.28, 1.2], [1.15, 1.5], [1.15, 1.62], [1.0, 1.62]], 8, { smooth: true });
      b.paint(water, Surf.Water);
      lathe(b, 0, 0, [[1.02, 1.56], [0, 1.56]], 8);
      b.paint(spray, Surf.Water);
      lathe(b, 0, 0, [[1.18, 1.52], [1.55, 0.36]], 8);
      lathe(b, 0, 0, [[0.16, 1.5], [0.06, 3.1], [0, 3.25]], 5);
      lathe(b, 0, 0, [[0.5, 1.58], [0.12, 2.2], [0, 2.3]], 6);
    } else {
      const R = 3.2, t = 0.35, h = 0.55;
      b.paint(0x9b9a96, Surf.Stone);
      b.box(-R, 0, -R, R, h, -R + t);
      b.box(-R, 0, R - t, R, h, R);
      b.box(-R, 0, -R + t, -R + t, h, R - t, { nz: null, pz: null });
      b.box(R - t, 0, -R + t, R, h, R - t, { nz: null, pz: null });
      b.paint(water, Surf.Water).box(-R + t, 0, -R + t, R - t, 0.4, R - t, { nx: null, px: null, nz: null, pz: null });
      b.paint(spray, Surf.Water);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        if (i === 0 && j === 0) continue;
        lathe(b, i * 1.7, j * 1.7, [[0.1, 0.4], [0.02, 1.9], [0, 2.0]], 4);
      }
      lathe(b, 0, 0, [[0.22, 0.4], [0.08, 3.2], [0, 3.35]], 5);
      // abstract sculpture: stacked polished blocks
      b.paint(0x3a3c40, Surf.Metal).box(-0.5, 0.4, -0.5, 0.5, 0.9, 0.5);
    }
  },

  // Billboard, emissive ad panel facing +Z. v0 monopole "soda" ad with gooseneck lamps, v1 two-post "travel" ad. ~100-130 tris.
  billboard(b, v) {
    const frame = 0x3a3d42;
    if (v === 0) {
      const y0 = 7.2, y1 = 11.2, hw = 6.4;
      b.paint(GALV, Surf.Metal);
      limb(b, [[0, 0, 0], [0, y0 + 0.3, 0]], [0.42, 0.34], { seg: 8 });
      b.paint(frame, Surf.Metal).box(-hw - 0.15, y0 - 0.15, -0.45, hw + 0.15, y1 + 0.15, -0.05);
      b.box(-1.2, y0 - 0.6, -0.4, 1.2, y0 - 0.15, 0.1);
      b.paint(0x55585c, Surf.Metal).box(-hw, y0 - 0.25, -0.05, hw, y0 - 0.18, 0.9);
      // ad: red background, white wave, dark bottle, text bars, yellow logo
      const z = -0.04;
      ad(b, -hw, hw, y0, y1, z, 0xd62828);
      adQuad(b, [[-hw, y0 + 0.9], [hw, y0 + 0.3], [hw, y0 + 0.9], [-hw, y0 + 1.5]], z + 0.01, 0xf4f1ea);
      adQuad(b, [[-5.2, y0 + 0.5], [-3.6, y0 + 0.5], [-3.6, y1 - 0.5], [-5.2, y1 - 0.5]], z + 0.02, 0x5a0d10);
      adQuad(b, [[-5.0, y1 - 1.6], [-3.8, y1 - 1.6], [-3.8, y1 - 1.0], [-5.0, y1 - 1.0]], z + 0.03, 0xf4f1ea);
      adQuad(b, [[-2.4, y1 - 1.4], [4.2, y1 - 1.4], [4.2, y1 - 0.6], [-2.4, y1 - 0.6]], z + 0.02, 0xfdfbf6);
      adQuad(b, [[-2.4, y1 - 2.2], [2.2, y1 - 2.2], [2.2, y1 - 1.8], [-2.4, y1 - 1.8]], z + 0.02, 0xfde9c8);
      adCircle(b, 4.9, y0 + 2.0, 0.8, z + 0.02, 0xf5c518);
      // gooseneck lamps over the panel
      for (const x of [-3.6, 0, 3.6]) {
        b.paint(frame, Surf.Metal);
        b.beam([x, y1 + 0.1, -0.2], [x, y1 + 0.55, 0.9], 0.07);
        b.paint(LAMP_WARM).box(x - 0.25, y1 + 0.42, 0.8, x + 0.25, y1 + 0.6, 1.2);
      }
    } else {
      const y0 = 4.4, y1 = 8.6, hw = 7.0;
      b.paint(0x6b6f74, Surf.Metal);
      for (const x of [-4.2, 4.2]) b.box(x - 0.25, 0, -0.55, x + 0.25, y0 + 0.2, -0.05);
      b.beam([-4.2, 1.2, -0.3], [4.2, y0 - 0.4, -0.3], 0.12);
      b.paint(frame, Surf.Metal).box(-hw - 0.15, y0 - 0.15, -0.35, hw + 0.15, y1 + 0.15, -0.05);
      const z = -0.04;
      ad(b, -hw, hw, y0, y1, z, 0x3fa7e0);
      adQuad(b, [[-hw, y0], [hw, y0], [hw, y0 + 1.3], [-hw, y0 + 1.1]], z + 0.01, 0x1fb5a8);
      adQuad(b, [[-hw, y0], [hw, y0], [hw, y0 + 0.55], [-hw, y0 + 0.4]], z + 0.02, 0xf1d9a0);
      adCircle(b, -4.6, y1 - 1.4, 0.9, z + 0.01, 0xffd23a);
      adQuad(b, [[-1.8, y1 - 1.3], [5.8, y1 - 1.3], [5.8, y1 - 0.5], [-1.8, y1 - 0.5]], z + 0.02, 0xfdfbf6);
      adQuad(b, [[-1.8, y1 - 2.1], [3.6, y1 - 2.1], [3.6, y1 - 1.7], [-1.8, y1 - 1.7]], z + 0.02, 0x0f3a66);
      adQuad(b, [[3.9, y0 + 1.6], [6.3, y0 + 1.6], [6.3, y0 + 2.4], [3.9, y0 + 2.4]], z + 0.02, 0xe8453c);
      b.paint(0x55585c, Surf.Metal).box(-hw, y0 - 0.25, -0.05, hw, y0 - 0.18, 0.8);
    }
  },

  // Stacks of 20/40 ft containers in varied colors. v0 two tiers, v1 three tiers, v2 mixed staggered. 60-120 tris.
  container_stack(b, v, rng) {
    const col = () => rng.pick(CONTAINER_COLS);
    if (v === 0) {
      for (let i = 0; i < 3; i++) box40(b, 0, 0, -2.6 + i * 2.6, true, col());
      box40(b, -3.0, 2.6, -1.3, false, col());
      box40(b, 1.5, 2.6, 1.3, true, col());
    } else if (v === 1) {
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) box40(b, -3.1 + i * 12.4 - 3.1, 0, -1.3 + j * 2.6, true, col());
      box40(b, -6.2, 2.6, -1.3, true, col());
      box40(b, -6.2, 2.6, 1.3, true, col());
      box40(b, 6.2, 2.6, -1.3, true, col());
      box40(b, -6.2, 5.2, 1.3, true, col());
      box40(b, 3.1, 0, 4.2, false, col(), true);
    } else {
      for (let i = 0; i < 3; i++) box40(b, -6.4 + i * 6.3, 0, 0, false, col());
      box40(b, -3.25, 2.6, 0, false, col());
      box40(b, 2.9, 2.6, 0, false, col());
      box40(b, 0, 0, 3.2, true, col());
      box40(b, 5.3, 0, -3.4, false, col(), true);
      box40(b, 5.3, 2.6, -3.4, false, col(), true);
    }
  },

  // Construction site dressing filling the cell: dirt, hoarding with gate on +Z; v0 tower crane, v1 concrete frame with
  // scaffolding, v2 excavation with excavator + pile rig. <= 200 tris.
  construction_site(b, v, rng) {
    siteBase(b, rng);
    const yel = P(0xe8b421, Surf.Metal);
    const WARN = P(0xff3020, Surf.Emissive);
    if (v === 0) {
      // foundation slab + column stubs
      b.paint(CONCRETE, Surf.Pavement).box(-5, 0.08, -2, 5, 0.5, 6);
      b.paint(0x9d998f, Surf.Plain);
      for (const [x, z] of [[-4.5, -1.5], [4.5, -1.5]]) b.box(x - 0.3, 0.5, z - 0.3, x + 0.3, 3.2, z + 0.3, { bottom: null });
      // tower crane at (-5,-5): mast, slewing unit, cab, jib along +X, counter-jib + counterweight, tower head, ties, hook + load
      const mx = -5.2, mz = -5.2, H = 21;
      b.paint(yel).box(mx - 0.8, 0.08, mz - 0.8, mx + 0.8, H, mz + 0.8);
      b.paint(yel).box(mx - 1.0, H, mz - 1.0, mx + 1.0, H + 1.0, mz + 1.0, { bottom: null });
      b.paint(0xf2f0ea, Surf.Plain).box(mx + 1.0, H - 0.6, mz - 0.1, mx + 2.4, H + 0.8, mz + 1.0, { pz: { color: 0x2a3440, surf: Surf.Metal } });
      b.paint(yel).box(mx - 0.5, H + 1.0, mz - 0.5, mx + 13.0, H + 2.0, mz + 0.5);
      b.box(mx - 7.5, H + 1.0, mz - 0.7, mx - 0.5, H + 1.7, mz + 0.7);
      b.paint(0x8a8a86, Surf.Pavement).box(mx - 7.4, H - 0.8, mz - 0.8, mx - 5.2, H + 1.0, mz + 0.8, { top: null });
      b.paint(yel);
      b.pyramid(mx, mz, 1.0, 1.0, H + 2.0, 3.8);
      b.paint(0x55585c, Surf.Metal);
      b.beam([mx, H + 5.7, mz], [mx + 12.5, H + 2.0, mz], 0.08);
      b.beam([mx, H + 5.7, mz], [mx - 7.2, H + 1.7, mz], 0.08);
      const hx = mx + 8.5;
      b.beam([hx, H + 1.0, mz], [hx, 7.0, mz], 0.05);
      b.paint(yel).box(hx - 0.35, 6.4, mz - 0.35, hx + 0.35, 7.0, mz + 0.35, { bottom: null });
      b.paint(0x7a5a3a, Surf.Wood).box(hx - 1.6, 5.0, mz - 0.6, hx + 1.6, 5.6, mz + 0.6);
      // aviation warning light on the tower head
      b.paint(WARN).box(mx - 0.12, H + 5.8, mz - 0.12, mx + 0.12, H + 6.05, mz + 0.12, { bottom: null });
      siteOffice(b, 4.5, -6.3);
      portaloo(b, 6.9, 2.5);
    } else if (v === 1) {
      // 3-storey concrete frame with slabs, columns, scaffolding + netting on the street side
      const x0 = -5.5, x1 = 5.5, z0 = -5.5, z1 = 3.5, fh = 3.2;
      b.paint(CONCRETE, Surf.Pavement);
      for (let f = 0; f < 3; f++) b.box(x0, f * fh + (f === 0 ? 0.08 : 0), z0, x1, f * fh + 0.3 + (f === 0 ? 0.08 : 0), z1);
      b.paint(0x9d998f, Surf.Plain);
      for (const [x, z, h] of [[x0 + 0.3, z0 + 0.3, 2.6], [x1 - 0.3, z0 + 0.3, 1.2], [x0 + 0.3, z1 - 0.3, 2.6], [x1 - 0.3, z1 - 0.3, 2.6]]) {
        b.box(x - 0.25, 0.3, z - 0.25, x + 0.25, 2 * fh + 0.3 + h, z + 0.25, { bottom: null });
      }
      // block masonry wall going up on the ground floor
      b.paint(0xb9b2a4, Surf.Stone).box(x0 + 0.1, 0.38, z0 + 0.05, x1 - 0.1, fh, z0 + 0.3);
      // scaffolding on the +Z face: standards, ledgers, plank decks
      b.paint(0xc8ccd0, Surf.Metal);
      const sz = z1 + 1.1;
      for (let i = 0; i <= 3; i++) b.beam([x0 + i * (x1 - x0) / 3, 0.08, sz], [x0 + i * (x1 - x0) / 3, 3 * fh + 1.0, sz], 0.07);
      for (let f = 1; f <= 3; f++) b.beam([x0, f * fh + 0.2, sz], [x1, f * fh + 0.2, sz], 0.06);
      for (let f = 1; f <= 3; f++) topQuadP(b, x0, z1 + 0.35, x1, sz, f * fh + 0.18, P(0x8a6a42, Surf.Wood));
      // green safety netting along +X side (double sided)
      b.paint(0x3f7a4a, Surf.Plain);
      const nx = x1 + 1.0;
      quadOut(b, [nx, 0.5, z0], [nx, 0.5, z1], [nx, 3 * fh + 0.6, z1], [nx, 3 * fh + 0.6, z0], [1, 0, 0]);
      quadOut(b, [nx, 0.5, z0], [nx, 0.5, z1], [nx, 3 * fh + 0.6, z1], [nx, 3 * fh + 0.6, z0], [-1, 0, 0]);
      // pallets of blocks
      b.paint(0xb9b2a4, Surf.Stone).box(-7.0, 0.08, 5.2, -5.4, 1.2, 6.6);
      portaloo(b, 6.8, -6.8);
    } else {
      // excavation pit, spoil heap, bored piles, pile rig, excavator
      b.paint(0x6a5238, Surf.Plain);
      quadOut(b, [-6.5, 0.1, -6.5], [3.0, 0.1, -6.5], [3.0, 0.1, 2.5], [-6.5, 0.1, 2.5], [0, 1, 0]);
      const m = mark(b);
      b.paint(0x7a5c3c, Surf.Plain);
      leafBlob(b, rng, [5.2, 0.3, -4.8], [2.4, 1.6, 2.2], { jitter: 0.2, soft: 0.3, floorY: 0.06 });
      tintSince(b, m, (p) => { const k = 0.8 + 0.2 * Math.min(1, p[1] / 1.6); return [k, k, k]; });
      b.paint(CONCRETE, Surf.Plain);
      for (const [x, z] of [[-4.5, -4.5], [-1.5, -4.5], [1.2, -4.5], [-4.5, -1.2]]) limb(b, [[x, 0.1, z], [x, 1.1, z]], [0.4, 0.4], { seg: 4, cap: true, rot: 0.4 });
      b.paint(0x3a3d42, Surf.Metal).box(-5.2, 0.1, 0.4, -3.2, 0.8, 1.9);
      b.paint(yel).box(-4.7, 0.8, 0.5, -3.3, 2.4, 1.8);
      b.box(-4.65, 2.4, 0.55, -4.25, 15.5, 0.95, { bottom: null });
      b.paint(WARN).box(-4.55, 15.5, 0.65, -4.35, 15.7, 0.85, { bottom: null });
      b.push().translate(3.8, 0.1, 3.4).rotateY(-2.3);
      b.paint(0x2a2b2e, Surf.Metal);
      b.box(-1.5, 0, -2.0, -0.9, 0.8, 2.0, { bottom: null });
      b.box(0.9, 0, -2.0, 1.5, 0.8, 2.0, { bottom: null });
      b.paint(yel).box(-1.2, 0.8, -1.6, 1.2, 1.9, 1.2, { bottom: null });
      b.paint(0x2a3440, Surf.Metal).box(-1.15, 1.9, 0.2, -0.1, 2.9, 1.2, { bottom: null });
      b.paint(yel);
      b.beam([0.4, 1.6, 1.0], [0.4, 3.8, 3.6], 0.35);
      b.beam([0.4, 3.8, 3.6], [0.4, 1.2, 5.2], 0.25);
      b.paint(0x3a3c40, Surf.Metal).box(-0.2, 0.2, 4.8, 1.0, 1.2, 5.6);
      b.pop();
    }
  },

  // Burnt-out lot filling the cell: ash ground, rounded debris heaps, scorched broken walls, fallen charred beams,
  // tumbled blocks. v0 brick/wood fire ruin, v1 concrete ruin with rebar and a burnt car. <= 200 tris.
  rubble(b, v, rng) {
    b.paint(0x4a4440, Surf.Plain);
    quadOut(b, [-8, 0.05, -8], [8, 0.05, -8], [8, 0.05, 8], [-8, 0.05, 8], [0, 1, 0]);
    b.paint(0x2c2826, Surf.Plain);
    polyOut(b, [[rng.range(-7, -4), 0.06, rng.range(-7, -3)], [rng.range(3, 6), 0.06, rng.range(-7.5, -5)], [rng.range(5, 7.5), 0.06, rng.range(0, 4)], [rng.range(0, 3), 0.06, rng.range(5, 7.5)], [rng.range(-7, -4), 0.06, rng.range(3, 6)]], [0, 1, 0]);
    const heapCols = v === 0 ? [0x2c2724, 0x3b322d, 0x4a3a30, 0x563428, 0x34302c] : [0x625e58, 0x53504b, 0x6f6a64, 0x3a3734];
    const m = mark(b);
    // broken walls along the old building's back (-Z) and left (-X) sides
    const wallPaint = v === 0 ? P(0x7a4432, Surf.Brick) : P(0x7e7a72, Surf.Plain);
    b.push().translate(-5.8, 0, -1.2);
    brokenWall(b, rng, 8.6, 2.3, 0.18, wallPaint);
    b.pop();
    b.push().translate(-1.6, 0, -5.8).rotateY(Math.PI / 2);
    brokenWall(b, rng, 7.8, 1.8, 0.18, wallPaint);
    b.pop();
    // soot: walls darken toward their broken tops
    tintSince(b, m, (p) => { const k = 1 - 0.55 * Math.min(1, p[1] / 2.3); return [k, k * 0.96, k * 0.93]; });
    const m2 = mark(b);
    const heaps: [number, number, number, number, number][] = v === 0
      ? [[-2.4, -2.2, 3.4, 1.3, 2.8], [2.6, 1.0, 2.8, 1.0, 2.4], [-1.2, 3.6, 2.2, 0.75, 1.9]]
      : [[-1.5, -1.4, 3.8, 1.5, 3.0], [3.2, 2.4, 2.5, 0.95, 2.2], [-4.0, 3.6, 2.2, 0.7, 1.8]];
    for (const [x, z, rx, ry, rz] of heaps) {
      b.paint(rng.pick(heapCols), Surf.Plain);
      leafBlob(b, rng, [x, ry * 0.2, z], [rx, ry, rz], {
        jitter: 0.16,
        soft: 0.55,
        floorY: 0.06,
        faceColor: () => (rng.chance(0.5) ? jitterHex(rng, rng.pick(heapCols), 0.08) : null),
      });
    }
    tintSince(b, m2, (p) => { const k = 0.7 + 0.3 * Math.min(1, p[1] / 1.4); return [k, k, k]; });
    // tumbled blocks / bricks chunks
    for (let i = 0; i < 4; i++) {
      const x = rng.range(-6, 6), z = rng.range(-6, 6);
      b.push().translate(x, 0.05, z).rotateY(rng.range(0, Math.PI)).rotateX(rng.range(-0.4, 0.4));
      b.paint(v === 0 ? rng.pick([0x6b3a2c, 0x3a3430, 0x7a4432]) : rng.pick([0x8e8a82, 0x6e6a64]), v === 0 ? Surf.Brick : Surf.Plain);
      const s = rng.range(0.5, 0.9);
      b.box(-s, -0.1, -s * 0.6, s, s * 0.7, s * 0.6);
      b.pop();
    }
    // fallen charred beams (v0) / twisted rebar (v1)
    b.paint(v === 0 ? 0x1f1b19 : 0x5a3a2a, v === 0 ? Surf.Wood : Surf.Metal);
    const nBeams = v === 0 ? 4 : 3;
    for (let i = 0; i < nBeams; i++) {
      const [hx, hz] = rng.pick(heaps);
      const x = hx + rng.range(-1.5, 1.5), z = hz + rng.range(-1.5, 1.5), a = rng.range(0, Math.PI), L = rng.range(3, 5);
      const dx = (Math.cos(a) * L) / 2, dz = (Math.sin(a) * L) / 2;
      b.beam([x - dx, rng.range(0.1, 0.4), z - dz], [x + dx, rng.range(0.6, 1.5), z + dz], v === 0 ? 0.24 : 0.06);
    }
    if (v === 1) {
      b.push().translate(4.6, 0.05, -4.4).rotateY(0.6);
      b.paint(0x2a2522, Surf.Metal).box(-0.9, 0.2, -2.2, 0.9, 0.95, 2.2);
      b.paint(0x1a1716, Surf.Metal).box(-0.8, 0.95, -1.0, 0.8, 1.35, 0.9, { bottom: null });
      b.pop();
    }
  },
};

/** Up-facing quad helper. */
function topQuadP(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, y: number, paint: Paint) {
  b.paint(paint);
  quadOut(b, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, 1, 0]);
}

/** Emissive ad background quad on the +Z panel face. */
function ad(b: ModelBuilder, x0: number, x1: number, y0: number, y1: number, z: number, col: number) {
  lamp(b, x0, x1, y0, y1, z, 1, P(col, Surf.Emissive), false);
}
/** Emissive ad shape (convex quad in x/y) at depth z. */
function adQuad(b: ModelBuilder, c: [number, number][], z: number, col: number) {
  b.paint(col, Surf.Emissive);
  quadOut(b, [c[0][0], c[0][1], z], [c[1][0], c[1][1], z], [c[2][0], c[2][1], z], [c[3][0], c[3][1], z], [0, 0, 1]);
}
/** Emissive octagon (logo / sun) at depth z. */
function adCircle(b: ModelBuilder, cx: number, cy: number, r: number, z: number, col: number) {
  b.paint(col, Surf.Emissive);
  const pts: V3[] = [];
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
  }
  polyOut(b, pts, [0, 0, 1]);
}

