/**
 * Low-quality strip of the lot trees' winter twig crowns (seasons). The kit and park trees carry a bare winter crown
 * (park_lib twigCrown / bareCrown: Foliage pattern 5 twig sprays + limb blades of Wood pattern 5, BARE_WOOD, and the
 * inner trunks of tree clumps; their leaf lobes are painted with the swap marker, floor >= 1 on patterns 1-2) that the
 * vertex shader swaps in while the tree is bare (materials.ts, FOLIAGE_WINTER): all year these are submitted
 * triangles, hidden inside the leaf crowns. The low quality preset (weak machines) draws the lot models without them,
 * so its triangle counts match the models without winter crowns: no pattern-5 faces, and the crowns' swap marker
 * cleared, so a bare crown stays a whole crown in the twig colour (the Foliage shader's bare look) instead of
 * collapsing to a bare trunk.
 *
 * The forest renderer publishes the quality (setLotTwigStrip, TreeRenderer: low quality = no outer ring / edge band
 * either); the building renderer registers lot model geometry through lotTwigGeometry / lotTwigKey and rebuilds its
 * instances when `lotTwigs.version` changes (a quality switch at runtime). At every quality the registered geometry
 * also has its small raised plants (roof / terrace planters) marked LOW foliage (markLowPlants).
 */
import * as THREE from 'three';
import { Surf } from '../../core/types';

/** strip on (low quality) + a counter bumped on every change */
export const lotTwigs = { strip: false, version: 0 };

export function setLotTwigStrip(on: boolean): void {
  if (on === lotTwigs.strip) return;
  lotTwigs.strip = on;
  lotTwigs.version++;
}

/** pattern of the winter-only faces: Foliage twig sprays and Wood limbs / inner trunks (park_lib FOL_TWIG, BARE_WOOD) */
const WINTER = 5;

const _stripped = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry | null>();

/**
 * `g` (a non-indexed lot model: position / normal / color / surf, see ModelBuilder.build) without its winter twig
 * crowns (pattern-5 Foliage and Wood faces) and with its crowns' swap marker cleared; null when it has neither (cached
 * per geometry).
 */
export function stripWinterTwigs(g: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const hit = _stripped.get(g);
  if (hit !== undefined) return hit;
  const srf = g.getAttribute('surf') as THREE.BufferAttribute | undefined;
  let out: THREE.BufferGeometry | null = null;
  if (srf && !g.index) {
    const S = srf.array as ArrayLike<number>, tris = srf.count / 3;
    const keep = new Uint8Array(tris);
    let kept = 0, marked = false;
    for (let t = 0; t < tris; t++) {
      const o = t * 9, type = S[o], p = S[o + 1];
      const foliage = Math.abs(type - Surf.Foliage) < 0.5;
      if (Math.abs(p - WINTER) < 0.5 && (foliage || Math.abs(type - Surf.Wood) < 0.5)) continue;
      if (foliage && p > 0.5 && p < 2.5 && S[o + 2] >= 1) marked = true;
      keep[t] = 1;
      kept++;
    }
    if (kept < tris || marked) {
      out = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
        const n = a.itemSize, src = a.array as ArrayLike<number>, dst = new Float32Array(kept * 3 * n);
        let w = 0;
        for (let t = 0; t < tris; t++) {
          if (!keep[t]) continue;
          for (let i = t * 3 * n, e = i + 3 * n; i < e; i++) dst[w++] = src[i];
        }
        if (name === 'surf') {
          // (crowns that swapped to their twigs while bare stay crowns: floor 1 + r -> r, still a per-tree random)
          for (let i = 0; i < dst.length; i += 3) {
            if (Math.abs(dst[i] - Surf.Foliage) < 0.5 && dst[i + 1] > 0.5 && dst[i + 1] < 2.5 && dst[i + 2] >= 1) dst[i + 2] -= 1;
          }
        }
        out.setAttribute(name, new THREE.BufferAttribute(dst, n, a.normalized));
      }
      out.computeBoundingBox();
      out.computeBoundingSphere();
      out.name = g.name + '#lt';
    }
  }
  _stripped.set(g, out);
  return out;
}

/** model height (m) of the Foliage shader's LOW class (materials.ts: LOW foliage below ~2.5 m), and the height of a
 *  small plant */
const LOW_H = 2.5;
/** linear luminance below which the shader keeps a pattern-0 face evergreen (materials.ts, everK) */
const DARK = 0.108;

const _low = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * `g` with its small raised plants marked LOW foliage (paint floor -1, materials.ts Foliage): the shader's LOW class
 * goes by model height, so shrubs in roof / terrace planters took the crowns' seasons (a grey-brown lump in winter, the
 * colours of a tree in autumn); marked, they go dormant like the shrubs on the ground. A small plant: connected pattern-0
 * foliage (faces joined by shared corners) less than LOW_H tall reaching above LOW_H (lower ones are LOW already,
 * taller ones are crowns); dark-painted (evergreen) faces keep their paint. Only the surf attribute is copied; `g`
 * itself when there is none (cached per geometry).
 */
export function markLowPlants(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const hit = _low.get(g);
  if (hit) return hit;
  let out = g;
  const srf = g.getAttribute('surf') as THREE.BufferAttribute | undefined, pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
  const col = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (srf && pos && !g.index) {
    const S = srf.array as ArrayLike<number>, P = pos.array as ArrayLike<number>, C = col ? (col.array as ArrayLike<number>) : null;
    const tris = pos.count / 3;
    const plant = (t: number) => Math.abs(S[t * 9] - Surf.Foliage) < 0.5 && S[t * 9 + 1] < 0.5 && S[t * 9 + 2] >= 0;
    let any = false;
    for (let t = 0; t < tris && !any; t++) if (plant(t) && Math.max(P[t * 9 + 1], P[t * 9 + 4], P[t * 9 + 7]) > LOW_H) any = true;
    if (any) {
      // union-find over the pattern-0 foliage faces, joined by their corners (positions to 1 cm)
      const parent = new Int32Array(tris).fill(-1);
      const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
      const corner = new Map<number, number>();
      for (let t = 0; t < tris; t++) {
        if (!plant(t)) continue;
        parent[t] = t;
        for (let k = 0; k < 3; k++) {
          const o = t * 9 + k * 3;
          const q = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * 100))) + 32768;
          const key = (q(P[o]) * 65536 + q(P[o + 1])) * 65536 + q(P[o + 2]);
          const f = corner.get(key);
          if (f === undefined) corner.set(key, t);
          else { const a = find(f), b = find(t); if (a !== b) parent[a] = b; }
        }
      }
      const y0 = new Float32Array(tris).fill(Infinity), y1 = new Float32Array(tris).fill(-Infinity);
      for (let t = 0; t < tris; t++) {
        if (parent[t] < 0) continue;
        const r = find(t), o = t * 9;
        y0[r] = Math.min(y0[r], P[o + 1], P[o + 4], P[o + 7]);
        y1[r] = Math.max(y1[r], P[o + 1], P[o + 4], P[o + 7]);
      }
      let dst: Float32Array | null = null;
      for (let t = 0; t < tris; t++) {
        if (parent[t] < 0) continue;
        const r = find(t);
        if (!(y1[r] > LOW_H && y1[r] - y0[r] < LOW_H)) continue;
        if (C) {
          let lum = 0;
          for (let k = 0; k < 3; k++) { const o = t * 9 + k * 3; lum += 0.2126 * C[o] + 0.7152 * C[o + 1] + 0.0722 * C[o + 2]; }
          if (lum / 3 < DARK) continue;
        }
        dst ??= Float32Array.from(S);
        dst[t * 9 + 2] = dst[t * 9 + 5] = dst[t * 9 + 8] = -1;
      }
      if (dst) {
        out = new THREE.BufferGeometry();
        for (const [name, a] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) out.setAttribute(name, name === 'surf' ? new THREE.BufferAttribute(dst, 3) : a);
        out.boundingBox = g.boundingBox?.clone() ?? null;
        out.boundingSphere = g.boundingSphere?.clone() ?? null;
        if (!out.boundingBox) out.computeBoundingBox();
        if (!out.boundingSphere) out.computeBoundingSphere();
        out.name = g.name + '#lp';
      }
    }
  }
  _low.set(g, out);
  return out;
}

/** the geometry the building renderer registers for lot model `g`: small raised plants marked LOW (markLowPlants),
 *  and without the winter twig crowns while the strip is on */
export function lotTwigGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = markLowPlants(g);
  return (lotTwigs.strip && stripWinterTwigs(m)) || m;
}

/** its batch key: `key` + '#lt' for a stripped model (both versions can coexist in a batch) */
export function lotTwigKey(key: string, g: THREE.BufferGeometry): string {
  return lotTwigs.strip && stripWinterTwigs(markLowPlants(g)) ? key + '#lt' : key;
}
