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
 * instances when `lotTwigs.version` changes (a quality switch at runtime).
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

/** the geometry the building renderer registers for lot model `g`: stripped while the strip is on */
export function lotTwigGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return (lotTwigs.strip && stripWinterTwigs(g)) || g;
}

/** its batch key: `key` + '#lt' for a stripped model (both versions can coexist in a batch) */
export function lotTwigKey(key: string, g: THREE.BufferGeometry): string {
  return lotTwigs.strip && stripWinterTwigs(g) ? key + '#lt' : key;
}
