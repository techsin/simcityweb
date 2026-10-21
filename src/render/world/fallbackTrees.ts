/**
 * Fallback nature models + far-LOD impostors.
 *  - fallback models are used ONLY while the asset team's builder for an id is not registered (avoids magenta boxes)
 *  - impostors (broadleaf blob / conifer cone, ~20 tris) are used by TreeRenderer beyond the LOD distance; their
 *    foliage vertex color is white so the per-instance color (species average) tints them.
 * Foliage patterns (materials.ts): broadleaf impostors 3 (the tint already carries the season of the model variant they
 * stand for: never recoloured by the shader), conifer impostors 4 (evergreen), like the nature models (nature.ts).
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ModelBuilder } from '../../assets/ModelBuilder';
import { getModelGeometry, hasModel } from '../../assets/registry';
import { RNG, hashString } from '../../core/rng';
import { Surf } from '../../core/types';

type Fn = (b: ModelBuilder, v: number, r: RNG) => void;
type V3 = [number, number, number];

/** nature-model foliage patterns (materials.ts): 3 deciduous (variant-seasonal), 4 evergreen */
const FOL_DECID = 3;
const FOL_EVER = 4;
const EVERGREEN = new Set(['tree_pine', 'tree_spruce', 'tree_palm', 'tree_cypress']);
let leafPattern = FOL_DECID;
const leaf = (b: ModelBuilder, c: number) => b.paint(c, Surf.Foliage, leafPattern);
const bark = (b: ModelBuilder, c = 0x5b4330) => b.paint(c, Surf.Wood);

const FALLBACK: Record<string, Fn> = {
  tree_oak: (b, v, r) => {
    const h = 9 + v * 1.2;
    bark(b).cylinder(0, 0, 0, h * 0.45, 0.45, 0.32, 5, { top: false });
    const greens = [0x44692a, 0x4d722c, 0x3d6226, 0x557a30];
    leaf(b, greens[v % 4]);
    b.blob(0, h * 0.62, 0, 3.6, 2.8, 3.6, 0, 0.18, v + 1);
    b.blob(r.range(-1.5, 1.5), h * 0.8, r.range(-1.5, 1.5), 2.6, 2.1, 2.6, 0, 0.2, v + 7);
    b.blob(r.range(-2, 2), h * 0.55, r.range(-2, 2), 2.2, 1.8, 2.2, 0, 0.2, v + 13);
  },
  tree_maple: (b, v) => {
    const h = 8 + v;
    bark(b).cylinder(0, 0, 0, h * 0.42, 0.35, 0.25, 5, { top: false });
    leaf(b, [0x4f7429, 0x5f7d2c, 0xb0562a][v % 3]);
    b.blob(0, h * 0.65, 0, 3.2, 3.0, 3.2, 0, 0.14, v + 3);
    b.blob(0.8, h * 0.85, -0.5, 2.2, 1.8, 2.2, 0, 0.2, v + 5);
  },
  tree_birch: (b, v) => {
    const h = 10 + v;
    bark(b, 0xe4e0d4).cylinder(0, 0, 0, h * 0.6, 0.22, 0.15, 5, { top: false });
    leaf(b, [0x7a9a42, 0x6f9140, 0x86a04a][v % 3]);
    b.blob(0, h * 0.68, 0, 1.9, 3.0, 1.9, 0, 0.2, v + 9);
    b.blob(0.5, h * 0.88, 0.3, 1.4, 1.7, 1.4, 0, 0.2, v + 11);
  },
  tree_pine: (b, v) => {
    const h = 13 + v * 1.5;
    bark(b, 0x6a4a32).cylinder(0, 0, 0, h * 0.5, 0.35, 0.25, 5, { top: false });
    leaf(b, [0x2f5a2a, 0x345f2c, 0x2a5226, 0x3a6630][v % 4]);
    b.cone(0, 0, h * 0.35, h * 0.35, 3.0, 7);
    b.cone(0, 0, h * 0.55, h * 0.3, 2.3, 7);
    b.cone(0, 0, h * 0.72, h * 0.28, 1.5, 6);
  },
  tree_spruce: (b, v) => {
    const h = 11 + v * 1.5;
    bark(b, 0x4a3526).cylinder(0, 0, 0, h * 0.2, 0.3, 0.25, 5, { top: false });
    leaf(b, [0x23452a, 0x284d2e, 0x1f3f26][v % 3]);
    b.cone(0, 0, h * 0.12, h * 0.55, 2.6, 8);
    b.cone(0, 0, h * 0.45, h * 0.55, 1.8, 7);
  },
  tree_palm: (b, v, r) => {
    const h = 9 + v * 1.5;
    bark(b, 0x8a7050);
    const lean = r.range(-0.8, 0.8);
    b.pipe([0, 0, 0], [lean, h * 0.5, lean * 0.4], 0.3, 5);
    b.pipe([lean, h * 0.5, lean * 0.4], [lean * 2.2, h, lean], 0.24, 5);
    leaf(b, [0x4f8a2a, 0x5a9530, 0x468024][v % 3]);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + v;
      const cx = lean * 2.2, cz = lean;
      const ex = cx + Math.cos(a) * 4.2, ez = cz + Math.sin(a) * 4.2;
      const px = -Math.sin(a) * 0.7, pz = Math.cos(a) * 0.7;
      b.quad2([cx, h + 0.2, cz], [cx + Math.cos(a) * 2 + px, h + 0.5, cz + Math.sin(a) * 2 + pz], [ex, h - 1.6, ez], [cx + Math.cos(a) * 2 - px, h + 0.5, cz + Math.sin(a) * 2 - pz]);
    }
  },
  tree_cypress: (b, v) => {
    const h = 10 + v * 2;
    bark(b).cylinder(0, 0, 0, 1.2, 0.3, 0.25, 5, { top: false });
    leaf(b, 0x2c4a28);
    b.blob(0, h * 0.5, 0, 1.3, h * 0.48, 1.3, 0, 0.1, v + 21);
  },
  tree_cactus: (b, v) => {
    const h = 3 + v;
    leaf(b, 0x5f7f3a);
    b.cylinder(0, 0, 0, h, 0.35, 0.3, 6, { top: true });
    b.cylinder(0.5, 0, h * 0.4, h * 0.35, 0.22, 0.2, 5, { top: true });
    b.box(0.25, h * 0.4, -0.12, 0.6, h * 0.48, 0.12);
    if (v % 2 === 0) b.cylinder(-0.55, 0, h * 0.5, h * 0.3, 0.2, 0.18, 5, { top: true });
  },
  bush: (b, v) => {
    leaf(b, [0x4d7a30, 0x5a8434, 0x6a8a3c, 0x7a6a3a][v % 4]);
    b.blob(0, 0.7, 0, 1.3, 0.9, 1.3, 0, 0.25, v + 31);
    b.blob(0.7, 0.5, 0.4, 0.8, 0.6, 0.8, 0, 0.25, v + 37);
  },
  rock: (b, v) => {
    b.paint([0x8a8680, 0x7a766e, 0x94908a, 0x6e6a64][v % 4], Surf.Stone);
    b.blob(0, 0.5, 0, 1.4 + v * 0.3, 0.9 + v * 0.2, 1.1 + v * 0.2, 0, 0.3, v + 41);
  },
};

const fbCache = new Map<string, THREE.BufferGeometry>();

/** Geometry for a nature model: the registered asset if available, otherwise a built-in fallback. */
export function getNatureGeometry(id: string, variant: number): THREE.BufferGeometry {
  if (hasModel(id) || !FALLBACK[id]) return getModelGeometry(id, variant);
  const key = `${id}#${variant}`;
  let g = fbCache.get(key);
  if (g) return g;
  const b = new ModelBuilder();
  leafPattern = EVERGREEN.has(id) ? FOL_EVER : FOL_DECID;
  FALLBACK[id](b, variant, new RNG(hashString(key)));
  g = b.build();
  g.name = 'fallback:' + key;
  fbCache.set(key, g);
  return g;
}

let _impostors: { broad: THREE.BufferGeometry; conifer: THREE.BufferGeometry } | null = null;
/** unit-height impostors (1 m tall, ~0.4 m radius): scaled per instance to the species bounding box */
export function getImpostorGeometries() {
  if (_impostors) return _impostors;
  const broad = new ModelBuilder();
  broad.paint(0x4a3624, Surf.Wood).cylinder(0, 0, 0, 0.42, 0.07, 0.05, 4, { top: false });
  broad.paint(0xffffff, Surf.Foliage, FOL_DECID).blob(0, 0.63, 0, 0.44, 0.36, 0.44, 0, 0.14, 3);
  const con = new ModelBuilder();
  con.paint(0x4a3624, Surf.Wood).cylinder(0, 0, 0, 0.22, 0.06, 0.05, 4, { top: false });
  con.paint(0xffffff, Surf.Foliage, FOL_EVER).cone(0, 0, 0.1, 0.58, 0.38, 7);
  con.cone(0, 0, 0.42, 0.58, 0.27, 6);
  _impostors = { broad: broad.build(), conifer: con.build() };
  return _impostors;
}

/**
 * Indexed copy of a small non-indexed geometry with shared corners and smooth normals: a GPU's vertex cache then shades
 * each corner once per instance (micro impostors: 6 instead of 24 vertices), and at 1-2 px the facets do not show.
 */
function indexedSmooth(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = g.clone();
  src.deleteAttribute('normal');
  const out = mergeVertices(src, 1e-4);
  out.computeVertexNormals();
  src.dispose();
  return out;
}

let _micro: { broad: THREE.BufferGeometry; conifer: THREE.BufferGeometry; top: THREE.BufferGeometry; ringLow: THREE.BufferGeometry } | null = null;
/** y of the micro broadleaf's lower apex (its waist is at 0.63, its upper apex at 1) */
export const MICRO_LOW_APEX = 0.28;
/**
 * The outer ring's low-camera mini crown (ringLow) at the full low-camera weight, in the impostors' unit frame (height
 * 1, the regular impostor's crown: radius 0.44 around y 0.63, from y 0.27; its trunk below): a 3-sided barrel crown -
 * upper apex at 1, two rings of radius RING_LOW_R at RING_LOW_UY / RING_LOW_LY, lower apex at RING_LOW_APEX - on a
 * thin 3-sided trunk spike (radius RING_LOW_TRUNK_R at the foot, its tip at RING_LOW_TRUNK_Y inside the crown).
 * Seen from the side at a grazing angle that reads as a round crown on its trunk, like the regular impostors in front
 * of it (a double pyramid reads as a floating diamond, or with its lower apex near the foot as a lit cone over a dark
 * spike). TreeRenderer's ring shader (RING_LOW_VERT) eases it in with the low-camera weight lw from `top` (lw = 0: the
 * rings at the waist, the lower apex and the trunk folded into it) and shades it with the normals of the round crown
 * (roundness from the crown's centre, ringLowNormal).
 */
export const RING_LOW_APEX = 0.28;
export const RING_LOW_R = 0.55;
export const RING_LOW_UY = 0.8;
export const RING_LOW_LY = 0.47;
export const RING_LOW_TRUNK_R = 0.09;
export const RING_LOW_TRUNK_Y = 0.6;
/** waist of the micro broadleaf / `top` (radius, y): where ringLow's crown folds to at lw = 0 */
export const MICRO_WAIST_R = 0.46;
export const MICRO_WAIST_Y = 0.63;
/**
 * The round crown's normal at a point of ringLow's crown (rest position, the lw = 1 shape): from the centre of the
 * ellipsoid through its apexes and rings (centre y (1 + RING_LOW_APEX) / 2, semi-axes RING_LOW_R, (1 - RING_LOW_APEX)
 * / 2). The ring shader blends the geometry's normals (`top`'s for the upper fan) into these with lw; same formula.
 */
export function ringLowNormal(x: number, y: number, z: number): [number, number, number] {
  const a2 = RING_LOW_R * RING_LOW_R, b = (1 - RING_LOW_APEX) / 2, yc = (1 + RING_LOW_APEX) / 2;
  const nx = x / a2, ny = (y - yc) / (b * b), nz = z / a2, l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
/**
 * Micro impostors for trees that project to 1-2 px (far zoom): same unit bounds as getImpostorGeometries, foliage only
 * (white, tinted per instance), 3-sided (at 1-2 px, with random per-tree yaws, as round as a 4-sided shape, a quarter
 * fewer triangles). Broadleaf = double pyramid (6 tris, 5 vertices), conifer = pyramid (3 tris, 4 vertices); indexed
 * with smooth normals (TreeRenderer's instanced meshes only). `top` = the broadleaf's upper half (3 tris, 4 vertices)
 * for the outer ring's far blocks seen from high cameras: its lower half hides under the upper one from above (and a
 * conifer's instance stretches the upper half onto the conifer pyramid anyway). `ringLow` = the low cameras' mini crown
 * on its trunk (see RING_LOW_*; 15 tris, 12 vertices): its upper fan's normals are `top`'s (blended into the round
 * crown's by the shader), so with the low-camera weight at 0, where the shader folds it into `top`, the swap between the
 * two is invisible.
 */
export function getMicroImpostorGeometries() {
  if (_micro) return _micro;
  const ring = (r: number, y: number): [number, number, number][] => [0, 1, 2].map((i) => [r * Math.cos(i * 2.0944 + 0.5236), y, r * Math.sin(i * 2.0944 + 0.5236)]);
  const broad = new ModelBuilder();
  broad.paint(0xffffff, Surf.Foliage, FOL_DECID);
  const e = ring(MICRO_WAIST_R, MICRO_WAIST_Y);
  for (let i = 0; i < 3; i++) {
    const a = e[i], b = e[(i + 1) % 3];
    broad.tri(b, a, [0, 1.0, 0]);
    broad.tri(a, b, [0, MICRO_LOW_APEX, 0]);
  }
  const con = new ModelBuilder();
  con.paint(0xffffff, Surf.Foliage, FOL_EVER);
  const c = ring(0.4, 0.1);
  for (let i = 0; i < 3; i++) con.tri(c[(i + 1) % 3], c[i], [0, 1.0, 0]);
  const top = new ModelBuilder();
  top.paint(0xffffff, Surf.Foliage, FOL_DECID);
  for (let i = 0; i < 3; i++) top.tri(e[(i + 1) % 3], e[i], [0, 1.0, 0]);
  const topG = indexedSmooth(top.build());
  // ringLow: crown (white foliage) with explicit normals - the upper fan's are `top`'s (the waist vertex at the same
  // angle), the lower ring's and the lower apex's the round crown's - merged into shared corners as they are
  const tn = topG.getAttribute('normal'), tpos = topG.getAttribute('position');
  const topN = (i: number): V3 => {
    const a = i * 2.0944 + 0.5236;
    for (let k = 0; k < tpos.count; k++) {
      if (Math.abs(tpos.getY(k) - MICRO_WAIST_Y) > 1e-4) continue;
      if (Math.abs(Math.atan2(tpos.getZ(k), tpos.getX(k)) - Math.atan2(Math.sin(a), Math.cos(a))) < 1e-3) return [tn.getX(k), tn.getY(k), tn.getZ(k)];
    }
    throw new Error('micro top: no waist vertex at ' + i);
  };
  const U = ring(RING_LOW_R, RING_LOW_UY), Lr = ring(RING_LOW_R, RING_LOW_LY);
  const T: V3 = [0, 1, 0], Bt: V3 = [0, RING_LOW_APEX, 0], up: V3 = [0, 1, 0], dn: V3 = [0, -1, 0];
  const low = new ModelBuilder();
  low.paint(0xffffff, Surf.Foliage, FOL_DECID);
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const nUi = topN(i), nUj = topN(j), nLi = ringLowNormal(...Lr[i]), nLj = ringLowNormal(...Lr[j]);
    low.triN(U[j], U[i], T, nUj, nUi, up);
    low.triN(U[j], Lr[j], Lr[i], nUj, nLj, nLi);
    low.triN(U[j], Lr[i], U[i], nUj, nLi, nUi);
    low.triN(Lr[i], Lr[j], Bt, nLi, nLj, dn);
  }
  const crownG = mergeVertices(low.build(), 1e-4);
  // trunk spike (bark; smooth normals)
  const trunk = new ModelBuilder();
  trunk.paint(0x4a3624, Surf.Wood);
  const K = ring(RING_LOW_TRUNK_R, 0);
  for (let i = 0; i < 3; i++) trunk.tri(K[(i + 1) % 3], K[i], [0, RING_LOW_TRUNK_Y, 0]);
  const trunkG = indexedSmooth(trunk.build());
  const ringLow = mergeGeometries([crownG, trunkG])!;
  crownG.dispose();
  trunkG.dispose();
  _micro = { broad: indexedSmooth(broad.build()), conifer: indexedSmooth(con.build()), top: topG, ringLow };
  _micro.broad.name = 'impostor-micro-broad';
  _micro.conifer.name = 'impostor-micro-conifer';
  _micro.top.name = 'impostor-micro-top';
  _micro.ringLow.name = 'impostor-micro-ringlow';
  return _micro;
}

/**
 * Teardown of a world view (WorldView.dispose): every renderer that drew a cached tree geometry (built-in fallbacks,
 * impostors, micro impostors) keeps a dispose listener on it, which keeps that renderer — its canvas and the city scene
 * around it — reachable after the view is gone. dispose() makes each such renderer drop its GPU buffers and the
 * listener; the geometries stay cached and upload again on next use.
 */
export function releaseTreeGeometries(): void {
  for (const g of fbCache.values()) g.dispose();
  _impostors?.broad.dispose();
  _impostors?.conifer.dispose();
  if (_micro) for (const g of [_micro.broad, _micro.conifer, _micro.top, _micro.ringLow]) g.dispose();
}

/**
 * Opaque mid-distance proxy of a BARE (see-through twig) nature tree, for LODs that cannot draw see-through (props'
 * street trees, propLod): a trunk and a slim twig spindle (~55% of the crown's radius, from a third of the height up)
 * in the twig colour, so the ground shows around a bare tree as it does between its twigs - not a brown ball the size
 * of the summer crown. Foliage pattern 3 (never recoloured: the model variant carries the season). 16 tris, base at
 * y = 0 like the model. null for a solid crown (natureStats.open <= 0.3: use the regular impostor).
 */
export function bareTreeProxy(g: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const st = natureStats(g);
  if (st.open <= 0.3) return null;
  const H = st.height, R = st.radius;
  const b = new ModelBuilder();
  b.paint(0x4a3624, Surf.Wood).cylinder(0, 0, 0, H * 0.55, Math.max(0.12, R * 0.06), Math.max(0.08, R * 0.04), 4, { top: false });
  const q = Math.SQRT1_2, r = R * 0.55, y0 = H * 0.34, yw = H * 0.62;
  const e: [number, number, number][] = [[r * q, yw, r * q], [-r * q, yw, r * q], [-r * q, yw, -r * q], [r * q, yw, -r * q]];
  b.paint(st.raw.clone().multiplyScalar(0.8), Surf.Foliage, FOL_DECID);
  for (let i = 0; i < 4; i++) {
    const a = e[i], c = e[(i + 1) % 4];
    b.tri(c, a, [0, H, 0]);
    b.tri(a, c, [0, y0, 0]);
  }
  const out = b.build();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** what shows between the twigs of a bare crown seen from afar (branch shadows, forest floor) - linear */
const SEE_THROUGH = new THREE.Color(0.035, 0.034, 0.028);
const _ta = new THREE.Vector3(), _tb = new THREE.Vector3(), _tc = new THREE.Vector3();

/**
 * Average foliage color (linear) + bounding box of a nature geometry, for impostor tinting & scaling. Models without
 * foliage / stone (rocks, cacti: Surf.Plain) average every non-wood surface instead. See-through bare crowns (twig
 * sprays: little foliage area for their size, twig-coloured) report their open fraction (`open`, 0 = solid crown) and
 * blend `color` toward SEE_THROUGH by it, so a SOLID impostor matches the darker average a leafless tree has from afar;
 * `raw` is the unblended foliage average (for see-through impostors: TreeRenderer lets the ground show instead).
 */
export function natureStats(g: THREE.BufferGeometry): { color: THREE.Color; raw: THREE.Color; height: number; radius: number; open: number } {
  const col = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  const srf = g.getAttribute('surf') as THREE.BufferAttribute | undefined;
  const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
  const c = new THREE.Color(0, 0, 0);
  let n = 0;
  let area = 0;
  if (col && srf) {
    for (let pass = 0; pass < 2 && !n; pass++) {
      for (let i = 0; i < col.count; i++) {
        const s = srf.getX(i);
        const use = pass === 0 ? Math.abs(s - Surf.Foliage) < 0.5 || Math.abs(s - Surf.Stone) < 0.5 : Math.abs(s - Surf.Wood) >= 0.5;
        if (use) {
          c.r += col.getX(i); c.g += col.getY(i); c.b += col.getZ(i);
          n++;
          if (pass === 0 && pos && i % 3 === 0 && i + 2 < pos.count && Math.abs(s - Surf.Foliage) < 0.5) {
            _ta.fromBufferAttribute(pos, i); _tb.fromBufferAttribute(pos, i + 1); _tc.fromBufferAttribute(pos, i + 2);
            area += _tb.sub(_ta).cross(_tc.sub(_ta)).length() / 2;
          }
        }
      }
    }
  }
  if (n) c.multiplyScalar(1 / n);
  else c.setRGB(0.1, 0.2, 0.08);
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox!;
  const height = Math.max(0.5, bb.max.y);
  const radius = Math.max(0.3, Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2);
  // open fraction of a twig crown: foliage area vs its (double-sided) crown shell, only for twig colours (red > green);
  // models without foliage (rocks, cacti) are solid
  const cover = Math.min(1, area / (Math.PI * radius * radius * 2.2));
  const twig = area > 0 ? Math.min(1, Math.max(0, (c.r - c.g) / 0.02)) : 0;
  const open = twig * (1 - cover);
  const raw = c.clone();
  if (open > 0) c.lerp(SEE_THROUGH, open * 0.6);
  return { color: c, raw, height, radius, open };
}
