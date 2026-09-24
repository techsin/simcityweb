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
import { leafBlob, limb, lathe, tier, tintSince, foliageShade, mark, jitterHex, mixHex, shadeHex, triOut, vnorm, vadd, vscale, vcross, vsub, type V3 } from './nat_geom';

// ------------------------------------------------------------------ palettes (sRGB)
const BARK = 0x5b4532;
const BARK_DARK = 0x46362a;
const BARK_GREY = 0x6d6358;
const BIRCH_BARK = 0xe4e0d4;
const PINE_BARK = 0x6a4a36;
const PINE_UPPER = 0x9c6441;
const PALM_BARK = 0x8c7659;
const PALM_BARK_DARK = 0x6f5c45;

const LEAF_OAK = [0x46692a, 0x53732f, 0x3d6127, 0x5b7a35];
const LEAF_BIRCH = [0x62893b, 0x6b9040, 0x5a8138];
const LEAF_PINE = [0x36552c, 0x33502e, 0x3d5c31, 0x304c29];
const LEAF_SPRUCE = [0x2c4e2c, 0x335a33, 0x3b584c];
const LEAF_PALM = [0x4a7430, 0x557c35, 0x46702f];
const LEAF_CYPRESS = [0x34542d, 0x2f4d2b];
// seasonal crowns (variant layout: nat_season.ts)
const OAK_ORANGE = [0xc8641e, 0xd27a2a, 0xb85a1c];
const OAK_RED = [0xa8321e, 0xb8442a, 0x92291a];
const BIRCH_YELLOW = [0xd9a520, 0xe2b53c, 0xc99419];
const MAPLE_BLOSSOM = [0xf0c4d0, 0xf6dde4, 0xe6a9bc];
/** white, faintly pink spring blossom (ornamental street-tree look) */
const OAK_BLOSSOM = [0xf0d0dc, 0xf6e2e9, 0xe6bccd];
/** bare-winter twigs: warm grey-brown (oak, maple), purple-brown (birch); light enough not to read as black */
const TWIG = 0x8c7b6a;
const TWIG_BIRCH = 0x806259;

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
interface CrownOpts {
  spread?: number;
  jitter?: number;
  topBlob?: boolean;
  /** satellite blob vertical offset range, in units of ry */
  yLo?: number;
  yHi?: number;
  /** fraction of faces darkened to fake canopy gaps (no extra tris) */
  gaps?: number;
  /** per-blob color override (blob index 0 = central, last = top blob when topBlob) */
  blobColor?: (i: number, n: number) => number | null;
}
function crown(b: ModelBuilder, rng: RNG, cx: number, cy: number, cz: number, rx: number, ry: number, n: number, colors: number[], o: CrownOpts = {}) {
  const nc: V3 = [cx, cy - ry * 0.15, cz];
  const spread = o.spread ?? 0.46;
  const jitter = o.jitter ?? 0.16;
  const yLo = o.yLo ?? -0.28, yHi = o.yHi ?? 0.08;
  const blobs: { c: V3; r: V3 }[] = [];
  blobs.push({ c: [cx, cy + ry * 0.08, cz], r: [rx * 0.7, ry * 0.8, rx * 0.7] });
  const sat = o.topBlob ? n - 2 : n - 1;
  const a0 = rng.range(0, Math.PI * 2);
  for (let i = 0; i < sat; i++) {
    const a = a0 + (i / sat) * Math.PI * 2 + rng.range(-0.35, 0.35);
    const d = rx * spread * rng.range(0.85, 1.1);
    const s = rng.range(0.52, 0.66);
    blobs.push({ c: [cx + Math.cos(a) * d, cy + ry * rng.range(yLo, yHi), cz + Math.sin(a) * d], r: [rx * s, ry * s * rng.range(0.9, 1.08), rx * s] });
  }
  if (o.topBlob) blobs.push({ c: [cx + rng.range(-0.15, 0.15) * rx, cy + ry * 0.45, cz + rng.range(-0.15, 0.15) * rx], r: [rx * 0.5, ry * 0.5, rx * 0.5] });
  blobs.forEach((bl, i) => {
    const col = jitterHex(rng, o.blobColor?.(i, blobs.length) ?? rng.pick(colors), 0.1);
    b.paint(col, Surf.Foliage);
    const gaps = o.gaps ?? 0;
    const dark = shadeHex(col, 0.8);
    leafBlob(b, rng, bl.c, bl.r, { jitter, soft: 0.62, nc, faceColor: gaps > 0 ? () => (rng.chance(gaps) ? dark : null) : undefined });
  });
}

/**
 * Bare winter deciduous tree: trunk with a central leader, 3 main limbs forking into branches, and fans of thin
 * double-sided "twig spray" blades at every branch tip (Surf.Foliage: they sway and give far impostors a grey-brown
 * winter tint). Reads as a see-through twiggy silhouette, not a crown. ~110-120 tris.
 */
interface BareOpts {
  H: number;
  /** trunk fork height */
  tTop: number;
  /** horizontal reach of the limbs, in units of H */
  spread: number;
  rT: number;
  bark: number;
  twig: number;
  /** twigs per main limb */
  twigs?: [number, number, number];
  /** 0 = limbs spread out wide (oak), 1 = steep and upright (birch) */
  upright?: number;
  /** twig sprays hang down (birch) */
  droop?: number;
  /** dark bark band at the base (birch) */
  baseBand?: number;
}
function bareTree(b: ModelBuilder, rng: RNG, o: BareOpts) {
  const { H, tTop, spread, rT, bark } = o;
  const up = o.upright ?? 0;
  const lean: V3 = [rng.range(-0.3, 0.3), tTop, rng.range(-0.3, 0.3)];
  const leader: V3 = [lean[0] * 1.4 + rng.range(-0.2, 0.2), H * (0.74 + 0.12 * up), lean[2] * 1.4 + rng.range(-0.2, 0.2)];
  b.paint(bark, Surf.Wood);
  limb(b, [[0, -0.4, 0], lean, leader], [rT, rT * 0.62, rT * 0.2], { seg: 4 });
  if (o.baseBand !== undefined) {
    b.paint(o.baseBand, Surf.Wood);
    limb(b, [[0, -0.4, 0], [lean[0] * 0.25, 0.9, lean[2] * 0.25]], [rT * 1.12, rT * 1.02], { seg: 3 });
    b.paint(bark, Surf.Wood);
  }
  const reach = H * spread;
  const tips: { p: V3; d: V3 }[] = [{ p: leader, d: vnorm(vsub(leader, lean)) }];
  const a0 = rng.range(0, Math.PI * 2);
  const twigs = o.twigs ?? [2, 2, 2];
  for (let i = 0; i < 3; i++) {
    const a = a0 + i * 2.09 + rng.range(-0.3, 0.3);
    const f = rng.range(0.2, 0.7);
    const p0: V3 = [lean[0] + (leader[0] - lean[0]) * f * 0.4, tTop + (leader[1] - tTop) * f * 0.35, lean[2] + (leader[2] - lean[2]) * f * 0.4];
    const r1 = reach * rng.range(0.5, 0.62) * (1 - 0.35 * up);
    const p1: V3 = [p0[0] + Math.cos(a) * r1, p0[1] + (H - p0[1]) * (0.3 + 0.25 * up) * rng.range(0.85, 1.15), p0[2] + Math.sin(a) * r1];
    limb(b, [p0, p1], [rT * 0.5, rT * 0.3], { seg: 4 });
    for (let k = 0; k < twigs[i]; k++) {
      const a2 = a + (k === 0 ? -0.6 : 0.6) + rng.range(-0.25, 0.25);
      const r2 = reach * rng.range(0.4, 0.52) * (1 - 0.3 * up);
      const p2: V3 = [p1[0] + Math.cos(a2) * r2, p1[1] + (H - p1[1]) * rng.range(0.5, 0.82), p1[2] + Math.sin(a2) * r2];
      limb(b, [p1, p2], [rT * 0.28, rT * 0.07], { seg: 3 });
      tips.push({ p: p2, d: vnorm(vsub(p2, p1)) });
    }
    if (!twigs[i]) tips.push({ p: p1, d: vnorm(vsub(p1, p0)) });
  }
  // twigs: 3 slender double-sided spikes per tip (a narrow base tapering to a point), fanned in a cone around the
  // branch direction: a brushy fringe of fine twigs up close, a grey-brown haze from afar (never flat wedges)
  const m = mark(b);
  const L = (H - tTop) * 0.26;
  const droop = o.droop ?? 0;
  for (const { p, d } of tips) {
    const side0 = vcross(d, [0, 1, 0]);
    const sa: V3 = Math.hypot(side0[0], side0[1], side0[2]) > 0.1 ? vnorm(side0) : [1, 0, 0];
    const sb = vnorm(vcross(sa, d));
    const ph = rng.range(0, Math.PI * 2);
    for (let k = 0; k < 3; k++) {
      b.paint(jitterHex(rng, k === 1 ? shadeHex(o.twig, 0.82) : o.twig, 0.07), Surf.Foliage);
      const an = ph + (k / 3) * Math.PI * 2;
      const cone = rng.range(0.45, 0.8);
      const dir = vnorm(vadd(vadd(d, vadd(vscale(sa, Math.cos(an) * cone), vscale(sb, Math.sin(an) * cone))), [0, 0.25 - droop, 0]));
      const side = vnorm(vcross(dir, Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      const len = L * rng.range(0.8, 1.2);
      const base = vadd(p, vscale(dir, -len * 0.1));
      const tip = vadd(p, vscale(dir, len));
      const w = len * 0.11;
      const q0 = vadd(base, vscale(side, w)), q1 = vadd(base, vscale(side, -w));
      const n = vnorm(vcross(vsub(q1, tip), vsub(q0, tip)));
      triOut(b, tip, q1, q0, n);
      triOut(b, tip, q0, q1, vscale(n, -1));
    }
  }
  tintSince(b, m, foliageShade(tTop, H, 0.5, 0));
}

// ------------------------------------------------------------------ builders
export const models: ModelBuilders = {
  // Broadleaf oak: stout trunk, forked branches, wide lumpy crown. 108 tris.
  // v0 v1 v2 v4 green, v3 autumn orange, v5 autumn red, v6 bare winter, v7 spring blossom (<= 120 tris).
  // Layout: nat_season.ts.
  tree_oak(b, v, rng) {
    // crown shape per variant (the old v3 green shape moved to v4 so v3 can be TreeRenderer's autumn slot)
    const s = [0, 1, 2, 0, 3, 2, 1, 2][v] ?? 0;
    const H = [11.5, 13, 9.5, 12.5][s] * rng.range(0.95, 1.04);
    const wide = [1.0, 0.95, 1.22, 1.05][s];
    const tTop = H * [0.36, 0.4, 0.33, 0.37][s];
    const rT = [0.42, 0.38, 0.4, 0.5][s];
    if (v === 6) {
      bareTree(b, rng, { H, tTop, spread: 0.46 * wide, rT, bark: BARK, twig: TWIG });
      return;
    }
    const lean: V3 = [rng.range(-0.35, 0.35), tTop, rng.range(-0.35, 0.35)];
    trunk(b, lean, rT, rT * 0.62, s === 3 ? BARK_DARK : BARK, 6);
    const ba = rng.range(0, Math.PI * 2);
    for (let i = 0; i < 2; i++) {
      const a = ba + i * Math.PI + rng.range(-0.4, 0.4);
      const p0: V3 = [lean[0] * 0.85, tTop * 0.86, lean[2] * 0.85];
      const p1: V3 = [p0[0] + Math.cos(a) * H * 0.2 * wide, tTop + H * 0.16, p0[2] + Math.sin(a) * H * 0.2 * wide];
      branch(b, p0, p1, rT * 0.45, rT * 0.18, BARK);
    }
    const ry = (H - tTop) * 0.5;
    const rx = H * 0.42 * wide;
    const cy = H - ry * 0.95;
    const m = mark(b);
    const autumn = v === 3 || v === 5;
    const blossom = v === 7;
    const cols = v === 3 ? OAK_ORANGE : v === 5 ? OAK_RED : blossom ? OAK_BLOSSOM : [LEAF_OAK[s], LEAF_OAK[(s + 1) % 4]];
    // autumn: one straggler blob (still-green on the orange tree, orange on the red one); blossom: one blob of fresh
    // spring leaves
    const blobColor = autumn || blossom ? (i: number) => (i === 2 ? (blossom ? 0x86a846 : v === 3 ? 0x7d7a2c : 0xc8641e) : null) : undefined;
    crown(b, rng, lean[0], cy, lean[2], rx, ry, 4, cols, { spread: 0.55, jitter: 0.22, yLo: -0.35, yHi: 0.1, gaps: blossom ? 0.15 : 0.25, blobColor });
    tintSince(b, m, foliageShade(cy - ry, cy + ry, blossom ? 0.7 : 1, autumn || blossom ? 0.2 : 1));
  },

  // Rounded maple: dense round crown; v0 v3 green, v1 autumn orange, v2 autumn red, v4 bare winter, v5 spring
  // blossom. 106 tris (bare <= 120).
  tree_maple(b, v, rng) {
    const H = [9.5, 10.5, 9, 11, 10, 9.5][v] * rng.range(0.95, 1.05);
    const tTop = H * (v === 3 ? 0.4 : 0.36);
    if (v === 4) {
      bareTree(b, rng, { H, tTop, spread: 0.4, rT: 0.34, bark: BARK_GREY, twig: TWIG, upright: 0.25 });
      return;
    }
    const lean: V3 = [rng.range(-0.25, 0.25), tTop, rng.range(-0.25, 0.25)];
    trunk(b, lean, 0.34, 0.22, v === 0 || v === 3 ? BARK : BARK_GREY, 5);
    const a = rng.range(0, Math.PI * 2);
    branch(b, [lean[0], tTop * 0.9, lean[2]], [lean[0] + Math.cos(a) * 1.6, tTop + 1.8, lean[2] + Math.sin(a) * 1.6], 0.17, 0.07, BARK);
    const ry = (H - tTop) * (v === 3 ? 0.66 : 0.62);
    const rx = H * (v === 3 ? 0.32 : 0.36);
    const cy = H - ry * 0.95;
    const m = mark(b);
    const cols = v === 0 ? [0x4f7a36, 0x5a8139] : v === 3 ? [0x5d7f3a, 0x4a7032, 0x55793a] : v === 5 ? MAPLE_BLOSSOM : v === 1 ? [0xc0601c, 0xd5842a, 0xa84a18] : [0x9e2a1a, 0xb3401e, 0x7f2217];
    // autumn: one off-colour straggler blob; red variant has the darkest blob on top. Blossom: one leafy green blob.
    const blobColor = v === 0 || v === 3 ? undefined : v === 5 ? (i: number) => (i === 2 ? 0x6f8f3e : null) : (i: number, n: number) => (i === 2 ? (v === 1 ? 0x8f8a2c : 0xc0601c) : v === 2 && i === n - 1 ? 0x7f2217 : null);
    crown(b, rng, lean[0], cy, lean[2], rx, ry, 5, cols, { spread: 0.42, topBlob: true, jitter: 0.13, blobColor });
    tintSince(b, m, foliageShade(cy - ry, cy + ry, v === 5 ? 0.7 : 1, v === 0 || v === 3 ? 1 : 0.2));
  },

  // Slender birch: white trunk (wood lines read as bark marks), narrow airy light-green crown. v2 twin-stem,
  // v3 autumn yellow, v4 bare winter. 90-100 tris (bare <= 120).
  tree_birch(b, v, rng) {
    if (v === 4) {
      const H = 12 * rng.range(0.95, 1.05);
      bareTree(b, rng, { H, tTop: H * 0.42, spread: 0.3, rT: 0.24, bark: BIRCH_BARK, twig: TWIG_BIRCH, upright: 1, twigs: [2, 2, 1], droop: 0.55, baseBand: 0x4a4540 });
      return;
    }
    const s = v === 3 ? 0 : v;
    const H = [11.5, 12.5, 10.5][s] * rng.range(0.95, 1.05);
    const stems: { top: V3; r: number }[] = s === 2
      ? [{ top: [0.7, H * 0.8, 0.2], r: 0.19 }, { top: [-0.6, H * 0.72, -0.25], r: 0.17 }]
      : [{ top: [rng.range(-0.4, 0.4), H * 0.84, rng.range(-0.4, 0.4)], r: 0.24 }];
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
    const leaf = v === 3 ? BIRCH_YELLOW : LEAF_BIRCH;
    b.paint(jitterHex(rng, leaf[s], 0.06), Surf.Foliage);
    leafBlob(b, rng, [cx, cy, cz], [2.2, H * 0.27, 2.0], { jitter: 0.24, soft: 0.6, nc });
    const a0 = rng.range(0, Math.PI * 2);
    for (let i = 0; i < 3; i++) {
      const a = a0 + i * 2.1 + rng.range(-0.3, 0.3);
      const y = H * (0.44 + 0.1 * i) + rng.range(-0.3, 0.3);
      const d = 1.9 - 0.15 * i;
      // autumn: the lowest side clump stays greenish-yellow
      b.paint(jitterHex(rng, v === 3 && i === 0 ? 0xa9a83a : leaf[(s + i) % 3], 0.08), Surf.Foliage);
      leafBlob(b, rng, [cx + Math.cos(a) * d, y, cz + Math.sin(a) * d], [1.45 - 0.1 * i, 1.5, 1.35 - 0.1 * i], { jitter: 0.24, soft: 0.6, nc });
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
      const r = R * (1 - 0.45 * t) * rng.range(0.85, 1.12);
      const h = k === nT - 1 ? Math.min(H - y, (span / nT) * 1.1) : (span / nT) * 1.35;
      const ox = lx * (y / H) + rng.range(-0.6, 0.6), oz = lz * (y / H) + rng.range(-0.6, 0.6);
      b.paint(jitterHex(rng, leaf, 0.08), Surf.Foliage);
      tier(b, rng, ox, oz, y, h, r, { n: 8, droop: r * 0.28, jag: 0.62, under: mixHex(leaf, 0x1a2418, 0.45), lean: [rng.range(-0.2, 0.2), rng.range(-0.2, 0.2)] });
    }
    if (v === 0 || v === 2) {
      // one offset side tier breaks the symmetric stack (+16 tris)
      const a = rng.range(0, Math.PI * 2);
      const y = yb + span * 0.35;
      const r = R * 0.55;
      b.paint(jitterHex(rng, leaf, 0.08), Surf.Foliage);
      tier(b, rng, lx * (y / H) + Math.cos(a), lz * (y / H) + Math.sin(a), y, (span / nT) * 1.1, r, { n: 8, droop: r * 0.3, jag: 0.62, under: mixHex(leaf, 0x1a2418, 0.45) });
    }
    tintSince(b, m, foliageShade(yb - 1, H, 0.8));
  },

  // Dense conical spruce, tiers from near the ground; v1 tall green, v2 muted blue spruce. 90 tris.
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
      const dead = k === 1; // one old, dry, hanging frond
      const len = L * rng.range(0.88, 1.08) * (upper ? 0.92 : 1.05);
      // spine: base -> rising -> arching -> drooping tip
      const rise = (v === 1 ? 0.5 : 0.34) * (upper ? 1.25 : 0.8);
      const droop = (v === 1 ? 0.3 : 0.55) * (upper ? 0.8 : 1.15) * (dead ? 1.6 : 1);
      const sp: V3[] = [
        vadd(top, vadd(vscale(d, 0.15), [0, 0.2, 0])),
        vadd(top, vadd(vscale(d, len * 0.36), [0, len * rise * 0.55, 0])),
        vadd(top, vadd(vscale(d, len * 0.7), [0, len * (rise * 0.55 - droop * 0.35), 0])),
        vadd(top, vadd(vscale(d, len), [0, len * (rise * 0.4 - droop), 0])),
      ];
      const ws = [0.14, len * 0.17, len * 0.13, 0];
      b.paint(jitterHex(rng, dead ? 0x8a7648 : leaf, 0.1), Surf.Foliage);
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

  // v0/v1 saguaro with arms (flat-shaded ribs), v2 barrel-cactus cluster in bloom. 80-112 tris.
  tree_cactus(b, v, rng) {
    if (v < 2) {
      const H = [5.2, 6.2][v] * rng.range(0.95, 1.05);
      const col = [0x4b6a3a, 0x557241][v];
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
    // barrel-cactus cluster: 4 ribbed (flat-shaded 8-seg) barrels with domed caps, 2 golden flower crowns. 112 tris.
    const spots: [number, number, number, number][] = [[0, 0, 0.55, 1.3], [0.95, 0.35, 0.42, 0.85], [-0.55, 0.8, 0.38, 0.7], [0.3, -0.95, 0.35, 0.6]];
    spots.forEach(([x, z, r, h], i) => {
      const c = jitterHex(rng, 0x5a7440, 0.07);
      b.paint(c, Surf.Plain);
      const rr = r * rng.range(0.95, 1.05), hh = h * rng.range(0.95, 1.05);
      limb(b, [[x, -0.2, z], [x, hh, z]], [rr * 0.9, rr], { seg: 8, smooth: false, rot: i * 0.3 });
      lathe(b, x, z, [[rr, hh], [0, hh + rr * 0.45]], 8, { smooth: false });
      if (i < 2) {
        b.paint(0xd9a030, Surf.Plain);
        octa(b, [x, hh + rr * 0.45, z], rr * 0.4, 0.13);
      }
    });
  },

  // Shrubs: v0 green round, v1 low dark evergreen spread, v2 pink azalea in bloom, v3 lilac. 4 blobs, 80 tris.
  bush(b, v, rng) {
    const H = [1.6, 1.0, 1.35, 2.2][v] * rng.range(0.92, 1.08);
    const base = [0x4f7d32, 0x355b2c, 0x4a7a33, 0x557f36][v];
    const flower = [0, 0, 0xc26a8e, 0x9a82b8][v];
    const n = 4;
    const W = [1.2, 1.5, 1.1, 1.2][v];
    const m = mark(b);
    const nc: V3 = [0, H * 0.4, 0];
    const a0 = rng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const d = i === 0 ? 0 : W * 0.5;
      const s = i === 0 ? 1 : rng.range(0.68, 0.82);
      const ry = H * 0.55 * s;
      const c: V3 = [Math.cos(a) * d, ry * 0.85 - 0.18, Math.sin(a) * d];
      b.paint(jitterHex(rng, base, 0.1), Surf.Foliage);
      leafBlob(b, rng, c, [W * 0.75 * s, ry, W * 0.72 * s], {
        jitter: 0.22,
        soft: 0.6,
        nc,
        floorY: -0.3,
        // blossoms only on the sunny upper faces; lower faces stay leafy green
        faceColor: flower ? (_i, _cen, nrm) => (nrm[1] > 0.25 ? mixHex(jitterHex(rng, flower, 0.07), base, rng.range(0, 0.3)) : null) : undefined,
      });
    }
    tintSince(b, m, foliageShade(0, H, 0.9));
  },

  // Rocks: v0 boulder, v1 cluster of 3, v2 big boulder, v3 mossy pair. Faceted, sunk into the ground. 40-80 tris.
  rock(b, v, rng) {
    const greys = [0x6e6c67, 0x6b6056, 0x74706a, 0x5d5b56];
    const moss = 0x56693a;
    const rockBlob = (c: V3, r: V3, detail: number, col: number, mossy: number, floorY: number) => {
      b.paint(jitterHex(rng, col, 0.05), Surf.Plain);
      leafBlob(b, rng, c, r, {
        detail,
        jitter: detail ? 0.14 : 0.22,
        soft: 0.22,
        floorY,
        faceColor: (_i, _c, nrm) => (nrm[1] > 0.5 && rng.chance(mossy) ? mixHex(col, moss, rng.range(0.4, 0.8)) : rng.chance(0.3) ? jitterHex(rng, col, 0.12) : null),
      });
    };
    // buried 30-40%: centres sunk by 0.35 ry, bottoms squashed at -0.45 ry
    const R = (c: V3, r: V3, detail: number, col: number, mossy: number) => rockBlob([c[0], c[1] - 0.35 * r[1], c[2]], r, detail, col, mossy, -0.45 * r[1]);
    if (v === 0) R([0, 0.35, 0], [1.3, 0.85, 1.05], 1, greys[0], 0.15);
    else if (v === 1) {
      R([0, 0.5, 0], [1.1, 1.0, 0.95], 0, greys[1], 0.1);
      R([1.3, 0.2, 0.5], [0.7, 0.55, 0.6], 0, greys[1], 0.1);
      R([-0.6, 0.15, 1.1], [0.55, 0.4, 0.5], 0, greys[0], 0.1);
    } else if (v === 2) R([0, 1.24, 0], [2.4, 2.4, 1.9], 1, greys[2], 0.12);
    else {
      R([0, 0.45, 0], [1.4, 0.95, 1.1], 0, greys[3], 0.85);
      R([1.4, 0.2, -0.7], [0.8, 0.55, 0.7], 0, greys[3], 0.85);
    }
    const top = v === 2 ? 3.0 : 1.0;
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
