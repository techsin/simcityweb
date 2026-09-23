/**
 * Mid-distance LOD geometry for network props (cached per model / variant).
 *  - trees (median / street trees): the TreeRenderer impostor (28 tris) scaled to the model's bounds and tinted with
 *    its average foliage colour
 *  - everything else (streetlights, traffic lights, crossing gates): "pole + crown" — a 3-sided prism for the mast
 *    and one box for whatever sits in the top part (lamp arm + head, signal heads), painted with the dominant surface
 *    of each part; a lamp head keeps an emissive underside so it still glows at night. ~16 triangles.
 */
import * as THREE from 'three';
import { ModelBuilder, type Paint } from '../../../assets/ModelBuilder';
import { Surf } from '../../../core/types';
import { getImpostorGeometries, natureStats } from '../../world/fallbackTrees';

const cache = new Map<string, THREE.BufferGeometry | null>();

function treeProxy(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const st = natureStats(g);
  const imp = getImpostorGeometries().broad.clone();
  const sxz = (st.radius / 0.42) * 0.92;
  imp.scale(sxz, st.height, sxz);
  const col = imp.getAttribute('color') as THREE.BufferAttribute;
  const srf = imp.getAttribute('surf') as THREE.BufferAttribute;
  for (let i = 0; i < col.count; i++) {
    if (Math.abs(srf.getX(i) - Surf.Foliage) < 0.5) col.setXYZ(i, st.color.r, st.color.g, st.color.b);
  }
  imp.computeBoundingBox();
  imp.computeBoundingSphere();
  return imp;
}

interface Part { area: number; paint: Paint; emisArea: number; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

function poleCrown(g: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  const srf = g.getAttribute('surf') as THREE.BufferAttribute;
  if (!pos || !col || !srf || g.index) return null;
  if (!g.boundingBox) g.computeBoundingBox();
  const H = g.boundingBox!.max.y;
  if (H < 1) return null;
  const split = H * 0.55;
  // mast axis + thickness from the geometry near the ground
  let px = 0, pz = 0, pr = 0.12;
  {
    let n0 = 0, mnx = Infinity, mxx = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > Math.min(1.2, H * 0.2)) continue;
      const x = pos.getX(i), z = pos.getZ(i);
      px += x; pz += z; n0++;
      mnx = Math.min(mnx, x); mxx = Math.max(mxx, x);
    }
    // (footings / base plates are wider than the mast)
    if (n0) { px /= n0; pz /= n0; pr = THREE.MathUtils.clamp((mxx - mnx) * 0.3, 0.06, 0.2); }
  }
  const mk = (): Part & { groups: Map<string, { a: number; r: number; g: number; b: number; s: number; p: number; f: number }> } =>
    ({ area: 0, paint: { color: 0x888888 }, emisArea: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity, groups: new Map() });
  const pole = mk(), crown = mk();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    const area = n.subVectors(b, a).cross(c.clone().sub(a)).length() / 2;
    if (area <= 0) continue;
    const midY = (a.y + b.y + c.y) / 3;
    // the crown is what sticks out sideways in the upper part (lamp arm + head, mast arm + signals); the mast itself
    // (near the axis) belongs to the pole
    const off = Math.hypot((a.x + b.x + c.x) / 3 - px, (a.z + b.z + c.z) / 3 - pz);
    const part = midY > split && off > Math.max(pr * 2.5, 0.35) ? crown : pole;
    const type = Math.round(srf.getX(i));
    if (type === Surf.Emissive) part.emisArea += area;
    const key = type + '|' + Math.round(srf.getY(i));
    let gr = part.groups.get(key);
    if (!gr) part.groups.set(key, (gr = { a: 0, r: 0, g: 0, b: 0, s: type, p: Math.round(srf.getY(i)), f: srf.getZ(i) }));
    gr.a += area;
    gr.r += col.getX(i) * area; gr.g += col.getY(i) * area; gr.b += col.getZ(i) * area;
    part.area += area;
    for (const v of [a, b, c]) {
      if (v.x < part.x0) part.x0 = v.x; if (v.x > part.x1) part.x1 = v.x;
      if (v.y < part.y0) part.y0 = v.y; if (v.y > part.y1) part.y1 = v.y;
      if (v.z < part.z0) part.z0 = v.z; if (v.z > part.z1) part.z1 = v.z;
    }
  }
  for (const p of [pole, crown]) {
    let best: { a: number; r: number; g: number; b: number; s: number; p: number; f: number } | null = null;
    for (const gr of p.groups.values()) if (gr.s !== Surf.Emissive && (!best || gr.a > best.a)) best = gr;
    if (best) p.paint = { color: new THREE.Color(best.r / best.a, best.g / best.a, best.b / best.a), surf: best.s, pattern: best.p, floor: best.f };
  }
  const mb = new ModelBuilder();
  // tall crowns (mast arm + hanging signal heads) keep only the arm: a solid box would read as a sign board
  const cy0 = crown.y1 - crown.y0 > 0.8 ? Math.max(crown.y0, crown.y1 - Math.max(0.4, 0.35 * (crown.y1 - crown.y0))) : crown.y0;
  const top = crown.area > 0 ? Math.max(split, (cy0 + crown.y1) / 2) : pole.y1;
  mb.paint(pole.area > 0 ? pole.paint : crown.paint);
  const pts: [number, number][] = [0, 1, 2].map((k) => [px + Math.cos((k * 2 * Math.PI) / 3) * pr, pz + Math.sin((k * 2 * Math.PI) / 3) * pr]);
  for (let k = 0; k < 3; k++) {
    const [x0, z0] = pts[k], [x1, z1] = pts[(k + 1) % 3];
    // CCW from outside (vertices ordered by increasing angle -> outward normal needs reversed winding)
    mb.quad([x1, 0, z1], [x0, 0, z0], [x0, top, z0], [x1, top, z1]);
  }
  if (crown.area > 0) {
    const { x0, x1, y0, y1, z0, z1 } = crown;
    void y0;
    mb.paint(crown.paint);
    mb.box(x0, cy0, z0, x1, y1, z1, { top: crown.paint, bottom: crown.emisArea > crown.area * 0.08 ? { color: 0xfff0cc, surf: Surf.Emissive } : null });
  }
  const out = mb.build();
  return out;
}

/** mid-distance proxy for a prop model (null = keep the full model) */
export function propLodGeometry(key: string, model: string, g: THREE.BufferGeometry): THREE.BufferGeometry | null {
  if (cache.has(key)) return cache.get(key)!;
  let p: THREE.BufferGeometry | null = null;
  try {
    p = model.startsWith('tree_') || model === 'bush' ? treeProxy(g) : model === 'util_power_pylon' ? null : poleCrown(g);
  } catch (e) {
    console.warn('[props] LOD failed for', key, e);
  }
  const full = g.getAttribute('position').count / 3;
  if (p && p.getAttribute('position').count / 3 > full * 0.6) p = null;
  if (p) p.name = key + '#lod';
  cache.set(key, p);
  return p;
}
