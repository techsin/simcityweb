/**
 * Procedural models for the 'nature' group: trees, bushes, rocks. Instanced by the tens of thousands, so every model
 * stays <= 120 triangles (most 70-110). Origin at trunk base (0,0,0); trunks extend slightly below ground (y = -0.4)
 * so they never float on slopes. Foliage uses Surf.Foliage (wind sway above 1.5 m), trunks Surf.Wood (static).
 *
 * Shading tricks (free at runtime):
 *  - foliage blobs get normals blended toward the crown center => one soft volume with lumpy silhouette
 *  - per-vertex tint: darker/cooler lower crown, warmer sun-kissed tops (see nat_geom.foliageShade)
 */
import type { ModelBuilders } from '../registry';
import type { ModelBuilder } from '../ModelBuilder';
import type { RNG } from '../../core/rng';
import { Surf } from '../../core/types';
import { leafBlob, limb, lathe, tier, tintSince, foliageShade, mark, jitterHex, mixHex, triOut, vnorm, vadd, vscale, vcross, vsub, type V3 } from './nat_geom';

// ------------------------------------------------------------------ palettes (sRGB)
const BARK = 0x5b4532;
const BARK_DARK = 0x46362a;
const BARK_GREY = 0x6d6358;
const BIRCH_BARK = 0xe4e0d4;
const PINE_BARK = 0x6a4a36;
const PINE_UPPER = 0x9c6441;
const PALM_BARK = 0x8c7659;
const PALM_BARK_DARK = 0x6f5c45;

const LEAF_OAK = [0x4d7b2d, 0x5a8534, 0x44732b, 0x3d6828];
const LEAF_MAPLE = [0x5f8e37, 0xd4782a, 0xb8382a];
const LEAF_MAPLE_ALT = [0x6c9a3c, 0xe2a23a, 0xcf5a2a];
const LEAF_BIRCH = [0x729c40, 0x7ea545, 0x6a963e];
const LEAF_PINE = [0x3f6a30, 0x3a6233, 0x46713a, 0x37602f];
const LEAF_SPRUCE = [0x2c4e2c, 0x4b6558, 0x325831];
const LEAF_PALM = [0x4f8030, 0x5a8a36, 0x4c7a33];
const LEAF_CYPRESS = [0x34542d, 0x2f4d2b];

// ------------------------------------------------------------------ shared tree parts
/** Straight tapered trunk from below ground to `top`. 2*seg tris. */
function trunk(b: ModelBuilder, top: V3, r0: number, r1: number, color: number, seg = 5) {
  b.paint(color, Surf.Wood);
  limb(b, [[0, -0.4, 0], top], [r0, r1], { seg });
}

/** Branch limb from p0 to p1. 2*seg tris. */
function branch(b: ModelBuilder, p0: V3, p1: V3, r0: number, r1: number, color: number, seg = 4) {
  b.paint(color, Surf.Wood);
  limb(b, [p0, p1], [r0, r1], { seg });
}

/**
 * Broadleaf crown: 1 central blob + (n-1) satellite blobs around it, all shaded as one volume.
 * Returns the crown's vertical extent for tinting. 20 tris per blob.
 */
function crown(b: ModelBuilder, rng: RNG, cx: number, cy: number, cz: number, rx: number, ry: number, n: number, colors: number[], o: { spread?: number; jitter?: number; topBlob?: boolean; flatTop?: number } = {}) {
  const nc: V3 = [cx, cy - ry * 0.15, cz];
  const spread = o.spread ?? 0.46;
  const jitter = o.jitter ?? 0.16;
  const blobs: { c: V3; r: V3 }[] = [];
  blobs.push({ c: [cx, cy + ry * 0.08, cz], r: [rx * 0.7, ry * 0.8, rx * 0.7] });
  const sat = o.topBlob ? n - 2 : n - 1;
  const a0 = rng.range(0, Math.PI * 2);
  for (let i = 0; i < sat; i++) {
    const a = a0 + (i / sat) * Math.PI * 2 + rng.range(-0.35, 0.35);
    const d = rx * spread * rng.range(0.85, 1.1);
    const s = rng.range(0.52, 0.66);
    blobs.push({ c: [cx + Math.cos(a) * d, cy + ry * rng.range(-0.28, 0.08), cz + Math.sin(a) * d], r: [rx * s, ry * s * rng.range(0.9, 1.08), rx * s] });
  }
  if (o.topBlob) blobs.push({ c: [cx + rng.range(-0.15, 0.15) * rx, cy + ry * 0.45, cz + rng.range(-0.15, 0.15) * rx], r: [rx * 0.5, ry * 0.5, rx * 0.5] });
  for (const bl of blobs) {
    b.paint(jitterHex(rng, rng.pick(colors), 0.1), Surf.Foliage);
    leafBlob(b, rng, bl.c, bl.r, { jitter, soft: 0.62, nc });
  }
}

// ------------------------------------------------------------------ builders
export const models: ModelBuilders = {
  // Broadleaf oak: stout trunk, forked branches, wide lumpy crown. 108 tris.
  tree_oak(b, v, rng) {
    const H = [11.5, 13, 9.5, 12.5][v] * rng.range(0.95, 1.04);
    const wide = [1.0, 0.82, 1.22, 1.05][v];
    const tTop = H * [0.44, 0.48, 0.4, 0.42][v];
    const lean: V3 = [rng.range(-0.35, 0.35), tTop, rng.range(-0.35, 0.35)];
    const rT = [0.42, 0.38, 0.4, 0.5][v];
    trunk(b, lean, rT, rT * 0.62, v === 3 ? BARK_DARK : BARK, 6);
    const ba = rng.range(0, Math.PI * 2);
    for (let i = 0; i < 2; i++) {
      const a = ba + i * Math.PI + rng.range(-0.4, 0.4);
      const p0: V3 = [lean[0] * 0.85, tTop * 0.86, lean[2] * 0.85];
      const p1: V3 = [p0[0] + Math.cos(a) * H * 0.2 * wide, tTop + H * 0.16, p0[2] + Math.sin(a) * H * 0.2 * wide];
      branch(b, p0, p1, rT * 0.45, rT * 0.18, BARK);
    }
    const ry = (H - tTop) * 0.56;
    const rx = H * 0.36 * wide;
    const cy = H - ry * 0.95;
    const m = mark(b);
    crown(b, rng, lean[0], cy, lean[2], rx, ry, 4, [LEAF_OAK[v], LEAF_OAK[(v + 1) % 4]]);
    tintSince(b, m, foliageShade(cy - ry, cy + ry));
  },

  // Rounded maple: dense round crown; v1 autumn orange, v2 autumn red. 106 tris.
  tree_maple(b, v, rng) {
    const H = [9.5, 10.5, 9][v] * rng.range(0.95, 1.05);
    const tTop = H * 0.36;
    const lean: V3 = [rng.range(-0.25, 0.25), tTop, rng.range(-0.25, 0.25)];
    trunk(b, lean, 0.34, 0.22, v === 0 ? BARK : BARK_GREY, 5);
    const a = rng.range(0, Math.PI * 2);
    branch(b, [lean[0], tTop * 0.9, lean[2]], [lean[0] + Math.cos(a) * 1.6, tTop + 1.8, lean[2] + Math.sin(a) * 1.6], 0.17, 0.07, BARK);
    const ry = (H - tTop) * 0.55;
    const rx = H * 0.34;
    const cy = H - ry;
    const m = mark(b);
    const cols = v === 0 ? [LEAF_MAPLE[0], LEAF_MAPLE_ALT[0]] : v === 1 ? [LEAF_MAPLE[1], LEAF_MAPLE_ALT[1], 0xc9642a] : [LEAF_MAPLE[2], LEAF_MAPLE_ALT[2], 0x9c2b24];
    crown(b, rng, lean[0], cy, lean[2], rx, ry, 5, cols, { spread: 0.42, topBlob: true, jitter: 0.13 });
    tintSince(b, m, foliageShade(cy - ry, cy + ry, 1, v === 0 ? 1 : 0.5));
  },

  // Slender birch: white trunk (wood lines read as bark marks), narrow airy light-green crown. v2 twin-stem. 90-100 tris.
  tree_birch(b, v, rng) {
    const H = [11.5, 12.5, 10.5][v] * rng.range(0.95, 1.05);
    const stems: { top: V3; r: number }[] = v === 2
      ? [{ top: [0.7, H * 0.8, 0.2], r: 0.16 }, { top: [-0.6, H * 0.72, -0.25], r: 0.14 }]
      : [{ top: [rng.range(-0.4, 0.4), H * 0.84, rng.range(-0.4, 0.4)], r: 0.2 }];
    b.paint(BIRCH_BARK, Surf.Wood);
    for (const s of stems) {
      if (stems.length > 1) limb(b, [[s.top[0] * 0.1, -0.4, s.top[2] * 0.1], s.top], [s.r, s.r * 0.45], { seg: 4 });
      else {
        const mid: V3 = [s.top[0] * 0.4 + rng.range(-0.15, 0.15), s.top[1] * 0.5, s.top[2] * 0.4 + rng.range(-0.15, 0.15)];
        limb(b, [[s.top[0] * 0.1, -0.4, s.top[2] * 0.1], mid, s.top], [s.r, s.r * 0.75, s.r * 0.4], { seg: 4 });
      }
    }
    // dark base band (birch trunks are dark & rough at the bottom)
    b.paint(0x4a4540, Surf.Wood);
    limb(b, [[stems[0].top[0] * 0.1, -0.4, stems[0].top[2] * 0.1], [stems[0].top[0] * 0.14, 0.9, stems[0].top[2] * 0.14]], [stems[0].r * 1.12, stems[0].r * 1.02], { seg: 4 });
    const m = mark(b);
    // oval main crown + 3 lower side clumps hanging off it (airy, slightly weeping silhouette)
    const y0 = H * 0.38, y1 = H;
    const main = stems[0].top;
    const cy = H * 0.64;
    const cx = (stems.length > 1 ? 0 : main[0] * 0.8), cz = (stems.length > 1 ? 0 : main[2] * 0.8);
    const nc: V3 = [cx, cy - H * 0.05, cz];
    b.paint(jitterHex(rng, LEAF_BIRCH[v], 0.06), Surf.Foliage);
    leafBlob(b, rng, [cx, cy, cz], [1.75, H * 0.3, 1.6], { jitter: 0.15, soft: 0.6, nc });
    const a0 = rng.range(0, Math.PI * 2);
    for (let i = 0; i < 3; i++) {
      const a = a0 + i * 2.1 + rng.range(-0.3, 0.3);
      const y = H * (0.47 + 0.09 * i) + rng.range(-0.3, 0.3);
      const d = 1.35 - 0.12 * i;
      b.paint(jitterHex(rng, LEAF_BIRCH[(v + i) % 3], 0.08), Surf.Foliage);
      leafBlob(b, rng, [cx + Math.cos(a) * d, y, cz + Math.sin(a) * d], [1.2 - 0.1 * i, 1.6, 1.15 - 0.1 * i], { jitter: 0.18, soft: 0.6, nc });
    }
    tintSince(b, m, foliageShade(y0, y1, 0.9, 0.3));
  },

  // Pine: tall bare trunk (reddish upper bark), 3-4 jagged cone tiers with gaps between them. 84 tris.
  tree_pine(b, v, rng) {
    const H = [14, 17, 12, 19][v] * rng.range(0.95, 1.05);
    const nT = [3, 4, 3, 4][v];
    const yb = H * [0.44, 0.48, 0.38, 0.52][v];
    const lx = rng.range(-0.3, 0.3), lz = rng.range(-0.3, 0.3);
    b.paint(PINE_BARK, Surf.Wood);
    limb(b, [[0, -0.4, 0], [lx * 0.5, yb, lz * 0.5], [lx, H * 0.9, lz]], [0.34, 0.24, 0.1], {
      seg: 5,
      segPaint: (i) => b.paint(i === 0 ? PINE_BARK : PINE_UPPER, Surf.Wood),
    });
    const m = mark(b);
    const R = H * 0.2;
    const leaf = LEAF_PINE[v];
    const span = H - yb;
    for (let k = 0; k < nT; k++) {
      const t = k / nT;
      const y = yb + span * t * 0.92;
      const r = R * (1 - 0.55 * t) * rng.range(0.9, 1.08);
      const h = k === nT - 1 ? H - y : span / nT * 1.35;
      const ox = lx * (y / H) + rng.range(-0.25, 0.25), oz = lz * (y / H) + rng.range(-0.25, 0.25);
      b.paint(jitterHex(rng, leaf, 0.08), Surf.Foliage);
      tier(b, rng, ox, oz, y, h, r, { n: 8, droop: r * 0.28, jag: 0.62, under: mixHex(leaf, 0x1a2418, 0.45), lean: [rng.range(-0.2, 0.2), rng.range(-0.2, 0.2)] });
    }
    tintSince(b, m, foliageShade(yb - 1, H, 0.8));
  },

  // Dense conical spruce, tiers from near the ground; v1 blue spruce. 90 tris.
  tree_spruce(b, v, rng) {
    const H = [11.5, 14, 9][v] * rng.range(0.95, 1.05);
    trunk(b, [0, 1.6, 0], 0.3, 0.22, BARK_DARK, 5);
    const m = mark(b);
    const nT = 5;
    const y0 = 0.6;
    const R = H * [0.27, 0.25, 0.3][v];
    const leaf = LEAF_SPRUCE[v];
    for (let k = 0; k < nT; k++) {
      const t = k / nT;
      const y = y0 + (H - y0) * t * 0.86;
      const r = R * (1 - 0.8 * t) * rng.range(0.94, 1.05) + 0.25;
      const h = k === nT - 1 ? H - y : (H - y0) / nT * 1.9;
      b.paint(jitterHex(rng, leaf, 0.06), Surf.Foliage);
      tier(b, rng, rng.range(-0.1, 0.1), rng.range(-0.1, 0.1), y, h, r, { n: 8, droop: r * 0.32, jag: 0.66, under: mixHex(leaf, 0x10170f, 0.5) });
    }
    tintSince(b, m, foliageShade(0, H, 0.85));
  },

  // Palm: curved segmented trunk with alternating ring bark, wide drooping tented fronds (3 segments each). 88-110 tris.
  tree_palm(b, v, rng) {
    const H = [12.5, 10, 8.5][v] * rng.range(0.95, 1.05);
    const bend = [1.7, 0.35, 2.3][v];
    const az = rng.range(0, Math.PI * 2);
    const dx = Math.cos(az), dz = Math.sin(az);
    const tH = H - [0.9, 1.5, 0.8][v];
    const path: V3[] = [];
    const radii: number[] = [];
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      const off = bend * t * t;
      path.push([dx * off, -0.4 + (tH + 0.4) * t, dz * off]);
      radii.push(i === 0 ? 0.42 : 0.3 - 0.08 * t);
    }
    limb(b, path, radii, { seg: 5, segPaint: (i) => b.paint(i % 2 ? PALM_BARK : PALM_BARK_DARK, Surf.Wood) });
    const top = path[3];
    const m = mark(b);
    const nF = [7, 8, 7][v];
    const L = [5.4, 4.3, 4.6][v];
    const leaf = LEAF_PALM[v];
    const fa0 = rng.range(0, Math.PI * 2);
    for (let k = 0; k < nF; k++) {
      const a = fa0 + (k / nF) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const d: V3 = [Math.cos(a), 0, Math.sin(a)];
      const s: V3 = [-Math.sin(a), 0, Math.cos(a)];
      const upper = k % 2 === 0;
      const len = L * rng.range(0.88, 1.08) * (upper ? 0.92 : 1.05);
      // spine: base -> rising -> arching -> drooping tip
      const rise = (v === 1 ? 0.5 : 0.34) * (upper ? 1.25 : 0.8);
      const droop = (v === 1 ? 0.3 : 0.55) * (upper ? 0.8 : 1.15);
      const sp: V3[] = [
        vadd(top, vadd(vscale(d, 0.15), [0, 0.2, 0])),
        vadd(top, vadd(vscale(d, len * 0.36), [0, len * rise * 0.55, 0])),
        vadd(top, vadd(vscale(d, len * 0.7), [0, len * (rise * 0.55 - droop * 0.35), 0])),
        vadd(top, vadd(vscale(d, len), [0, len * (rise * 0.4 - droop), 0])),
      ];
      const ws = [0.14, len * 0.17, len * 0.13, 0];
      b.paint(jitterHex(rng, leaf, 0.1), Surf.Foliage);
      for (let i = 0; i < 3; i++) {
        const up = frondUp(sp[i], sp[i + 1]);
        const Lp0 = vadd(sp[i], vadd(vscale(s, ws[i]), [0, -ws[i] * 0.45, 0])), Rp0 = vadd(sp[i], vadd(vscale(s, -ws[i]), [0, -ws[i] * 0.45, 0]));
        const Lp1 = vadd(sp[i + 1], vadd(vscale(s, ws[i + 1]), [0, -ws[i + 1] * 0.45, 0])), Rp1 = vadd(sp[i + 1], vadd(vscale(s, -ws[i + 1]), [0, -ws[i + 1] * 0.45, 0]));
        if (i < 2) {
          fTri(b, sp[i], Lp0, Lp1, up); fTri(b, sp[i], Lp1, sp[i + 1], up);
          fTri(b, sp[i], sp[i + 1], Rp1, up); fTri(b, sp[i], Rp1, Rp0, up);
        } else {
          fTri(b, sp[i], Lp0, sp[i + 1], up); fTri(b, sp[i], sp[i + 1], Rp0, up);
        }
      }
    }
    if (v === 0) {
      b.paint(0x6b5a2e, Surf.Plain);
      octa(b, vadd(top, [0, -0.3, 0]), 0.55, 0.45);
    }
    tintSince(b, m, foliageShade(top[1] - L * 0.6, top[1] + L * 0.3, 0.75));
  },

  // Italian cypress: tall narrow flame-shaped spindle with a lump for irregularity. 90 tris.
  tree_cypress(b, v, rng) {
    const H = [11, 13.5][v] * rng.range(0.95, 1.05);
    const R = [1.25, 1.0][v];
    trunk(b, [0, 1.0, 0], 0.2, 0.16, BARK_DARK, 5);
    const m = mark(b);
    const leaf = LEAF_CYPRESS[v];
    b.paint(leaf, Surf.Foliage);
    lathe(b, rng.range(-0.05, 0.05), rng.range(-0.05, 0.05), [[0, 0.45], [0.5 * R, 0.55], [0.92 * R, 0.17 * H], [R, 0.38 * H], [0.84 * R, 0.6 * H], [0.48 * R, 0.82 * H], [0, H]], 6, { jitter: 0.12, rng, twist: 0.45 });
    b.paint(jitterHex(rng, leaf, 0.08), Surf.Foliage);
    const a = rng.range(0, Math.PI * 2);
    const ly = H * rng.range(0.3, 0.5);
    leafBlob(b, rng, [Math.cos(a) * R * 0.45, ly, Math.sin(a) * R * 0.45], [R * 0.75, H * 0.16, R * 0.75], { jitter: 0.15, soft: 0.7, nc: [0, ly, 0] });
    tintSince(b, m, foliageShade(0, H, 0.8));
  },

  // v0/v1 saguaro with arms (flat-shaded ribs), v2 agave rosettes with a century-plant flower stalk. 80-110 tris.
  tree_cactus(b, v, rng) {
    if (v < 2) {
      const H = [5.2, 6.2][v] * rng.range(0.95, 1.05);
      const col = [0x5b7c43, 0x66864a][v];
      b.paint(col, Surf.Plain);
      limb(b, [[0, -0.3, 0], [0, H - 0.4, 0]], [0.4, 0.36], { seg: 8, smooth: false });
      lathe(b, 0, 0, [[0.36, H - 0.4], [0, H]], 8, { smooth: false });
      const arms = v === 0 ? 2 : 3;
      const a0 = rng.range(0, Math.PI * 2);
      for (let i = 0; i < arms; i++) {
        const a = a0 + (i / arms) * Math.PI * 2 + rng.range(-0.4, 0.4);
        const d: V3 = [Math.cos(a), 0, Math.sin(a)];
        const y0 = H * rng.range(0.3, 0.5);
        const up = H * rng.range(0.24, 0.34);
        const reach = rng.range(1.0, 1.25);
        b.paint(jitterHex(rng, col, 0.05), Surf.Plain);
        limb(b, [vadd(vscale(d, 0.25), [0, y0, 0]), vadd(vscale(d, reach), [0, y0 + 0.45, 0]), vadd(vscale(d, reach + 0.05), [0, y0 + 0.45 + up, 0])], [0.25, 0.25, 0.22], { seg: 6, smooth: false, cap: true });
      }
      return;
    }
    // agave (century plant): big blue-green rosette + a pup, tall flower stalk with golden flower clusters
    const leafC = 0x7d9a86;
    const rosette = (cx: number, cz: number, n: number, len: number, rng2: RNG) => {
      const a0 = rng2.range(0, Math.PI * 2);
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * Math.PI * 2 + rng2.range(-0.2, 0.2);
        const el = (k % 2 ? 0.95 : 0.5) + rng2.range(-0.12, 0.12);
        const l = len * rng2.range(0.8, 1.1);
        const d: V3 = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
        const s: V3 = [-Math.sin(a), 0, Math.cos(a)];
        const B: V3 = [cx, 0.05, cz];
        const T = vadd(B, vscale(d, l));
        const M = vadd(vadd(B, vscale(d, l * 0.32)), [0, 0.06, 0]);
        const w = l * 0.16;
        const Lp = vadd(M, vscale(s, w)), Rp = vadd(M, vscale(s, -w));
        b.paint(jitterHex(rng2, leafC, 0.08), Surf.Plain);
        const nUp = vnorm(vcross(vsub(Lp, B), vsub(T, B)));
        const n1 = nUp[1] >= 0 ? nUp : vscale(nUp, -1);
        triOut(b, B, Lp, T, n1); triOut(b, B, T, Rp, n1);
        triOut(b, B, Lp, T, vscale(n1, -1)); triOut(b, B, T, Rp, vscale(n1, -1));
      }
    };
    rosette(0, 0, 11, 2.1, rng);
    rosette(1.9, 0.9, 6, 1.0, rng.fork('pup'));
    const H = 5.6 * rng.range(0.92, 1.05);
    b.paint(0x7c7448, Surf.Wood);
    limb(b, [[0, 0.2, 0], [0.12, H * 0.55, 0.05], [0.25, H - 0.3, 0.1]], [0.12, 0.08, 0.04], { seg: 4 });
    for (let i = 0; i < 4; i++) {
      const t = 0.6 + i * 0.11;
      const a = rng.range(0, Math.PI * 2);
      b.paint(i % 2 ? 0xd9b440 : 0xc49e30, Surf.Foliage);
      octa(b, [0.25 * t + Math.cos(a) * 0.4, H * t, 0.1 * t + Math.sin(a) * 0.4], 0.5 - i * 0.05, 0.28);
    }
  },

  // Shrubs: v0 green round, v1 pink azalea in bloom, v2 tall lilac, v3 low dark evergreen spread. 60-80 tris.
  bush(b, v, rng) {
    const H = [1.6, 1.35, 2.2, 1.0][v] * rng.range(0.92, 1.08);
    const base = [0x4f7d32, 0x4a7a33, 0x557f36, 0x355b2c][v];
    const flower = [0, 0xd8709e, 0xa487c9, 0][v];
    const n = v === 3 ? 4 : 3;
    const W = [1.2, 1.1, 1.2, 1.5][v];
    const m = mark(b);
    const nc: V3 = [0, H * 0.4, 0];
    const a0 = rng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const d = i === 0 ? 0 : W * 0.5;
      const s = i === 0 ? 1 : rng.range(0.7, 0.85);
      const ry = H * 0.55 * s;
      const c: V3 = [Math.cos(a) * d, ry * 0.85 - 0.08, Math.sin(a) * d];
      b.paint(jitterHex(rng, base, 0.1), Surf.Foliage);
      leafBlob(b, rng, c, [W * 0.75 * s, ry, W * 0.72 * s], {
        jitter: 0.18,
        soft: 0.6,
        nc,
        floorY: -0.05,
        // blossoms cover the sunny upper faces; lower faces stay leafy green
        faceColor: flower ? (_i, _cen, nrm) => (nrm[1] > 0.05 + rng.range(-0.25, 0.25) ? mixHex(jitterHex(rng, flower, 0.07), base, rng.range(0, 0.3)) : null) : undefined,
      });
    }
    tintSince(b, m, foliageShade(0, H, 0.9));
  },

  // Rocks: v0 boulder, v1 cluster of 3, v2 big boulder, v3 mossy pair. Faceted, sunk into the ground. 40-80 tris.
  rock(b, v, rng) {
    const greys = [0x6e6c67, 0x6b6056, 0x74706a, 0x5d5b56];
    const moss = 0x56693a;
    const rockBlob = (c: V3, r: V3, detail: number, col: number, mossy: number) => {
      b.paint(jitterHex(rng, col, 0.05), Surf.Plain);
      leafBlob(b, rng, c, r, {
        detail,
        jitter: detail ? 0.14 : 0.22,
        soft: 0.22,
        floorY: -0.05,
        faceColor: (_i, _c, nrm) => (nrm[1] > 0.5 && rng.chance(mossy) ? mixHex(col, moss, rng.range(0.4, 0.8)) : rng.chance(0.3) ? jitterHex(rng, col, 0.12) : null),
      });
    };
    if (v === 0) rockBlob([0, 0.35, 0], [1.3, 0.85, 1.05], 1, greys[0], 0.15);
    else if (v === 1) {
      rockBlob([0, 0.5, 0], [1.1, 1.0, 0.95], 0, greys[1], 0.1);
      rockBlob([1.3, 0.2, 0.5], [0.7, 0.55, 0.6], 0, greys[1], 0.1);
      rockBlob([-0.6, 0.15, 1.1], [0.55, 0.4, 0.5], 0, greys[0], 0.1);
    } else if (v === 2) rockBlob([0, 1.1, 0], [2.4, 2.0, 1.9], 1, greys[2], 0.12);
    else {
      rockBlob([0, 0.45, 0], [1.4, 0.95, 1.1], 0, greys[3], 0.85);
      rockBlob([1.4, 0.2, -0.7], [0.8, 0.55, 0.7], 0, greys[3], 0.85);
    }
    const top = v === 2 ? 3 : 1.4;
    tintSince(b, 0, (p) => {
      const k = 0.62 + 0.38 * Math.min(1, Math.max(0, p[1] / top));
      return [k, k, k];
    });
  },
};

/** Small octahedron (8 tris): coconut clusters, flower heads. */
function octa(b: ModelBuilder, c: V3, r: number, ry: number) {
  const ax: V3[] = [[r, 0, 0], [0, 0, r], [-r, 0, 0], [0, 0, -r]];
  for (let i = 0; i < 4; i++) {
    const p = vadd(c, ax[i]), q = vadd(c, ax[(i + 1) % 4]);
    const mid = vadd(ax[i], ax[(i + 1) % 4]);
    triOut(b, vadd(c, [0, ry, 0]), p, q, vnorm(vadd(mid, [0, 0.5, 0])));
    triOut(b, vadd(c, [0, -ry, 0]), p, q, vnorm(vadd(mid, [0, -0.5, 0])));
  }
}

/** "Top side" direction of a frond segment: world up projected perpendicular to the segment. */
function frondUp(a: V3, c: V3): V3 {
  const t = vnorm(vsub(c, a));
  const up: V3 = [0, 1, 0];
  return vnorm(vsub(up, vscale(t, t[1])));
}
/** Frond triangle facing `up` with normals softened toward it. */
function fTri(b: ModelBuilder, p0: V3, p1: V3, p2: V3, up: V3) {
  const n = vnorm(vcross(vsub(p1, p0), vsub(p2, p0)));
  const f = n[0] * up[0] + n[1] * up[1] + n[2] * up[2] >= 0 ? n : vscale(n, -1);
  const nn = vnorm(vadd(vscale(f, 0.45), vscale(up, 0.55)));
  if (f === n) b.triN(p0, p1, p2, nn, nn, nn);
  else b.triN(p0, p2, p1, nn, nn, nn);
}
