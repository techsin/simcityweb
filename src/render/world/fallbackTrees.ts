/**
 * Fallback nature models + far-LOD impostors.
 *  - fallback models are used ONLY while the asset team's builder for an id is not registered (avoids magenta boxes)
 *  - impostors (broadleaf blob / conifer cone, ~20 tris) are used by TreeRenderer beyond the LOD distance; their
 *    foliage vertex color is white so the per-instance color (species average) tints them.
 */
import * as THREE from 'three';
import { ModelBuilder } from '../../assets/ModelBuilder';
import { getModelGeometry, hasModel } from '../../assets/registry';
import { RNG, hashString } from '../../core/rng';
import { Surf } from '../../core/types';

type Fn = (b: ModelBuilder, v: number, r: RNG) => void;

const leaf = (b: ModelBuilder, c: number) => b.paint(c, Surf.Foliage);
const bark = (b: ModelBuilder, c = 0x5b4330) => b.paint(c, Surf.Wood);

const FALLBACK: Record<string, Fn> = {
  tree_oak: (b, v, r) => {
    const h = 9 + v * 1.2;
    bark(b).cylinder(0, 0, 0, h * 0.45, 0.45, 0.32, 5, { top: false });
    const greens = [0x4f7a2c, 0x5a8531, 0x46702a, 0x608a36];
    leaf(b, greens[v % 4]);
    b.blob(0, h * 0.62, 0, 3.6, 2.8, 3.6, 0, 0.18, v + 1);
    b.blob(r.range(-1.5, 1.5), h * 0.8, r.range(-1.5, 1.5), 2.6, 2.1, 2.6, 0, 0.2, v + 7);
    b.blob(r.range(-2, 2), h * 0.55, r.range(-2, 2), 2.2, 1.8, 2.2, 0, 0.2, v + 13);
  },
  tree_maple: (b, v) => {
    const h = 8 + v;
    bark(b).cylinder(0, 0, 0, h * 0.42, 0.35, 0.25, 5, { top: false });
    leaf(b, [0x5e8a33, 0xc0602a, 0xa8402a][v % 3]);
    b.blob(0, h * 0.65, 0, 3.2, 3.0, 3.2, 0, 0.14, v + 3);
    b.blob(0.8, h * 0.85, -0.5, 2.2, 1.8, 2.2, 0, 0.2, v + 5);
  },
  tree_birch: (b, v) => {
    const h = 10 + v;
    bark(b, 0xe4e0d4).cylinder(0, 0, 0, h * 0.6, 0.22, 0.15, 5, { top: false });
    leaf(b, [0x8aaa48, 0x7fa345, 0x94b050][v % 3]);
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
  broad.paint(0x3a2a1c, Surf.Wood).cylinder(0, 0, 0, 0.35, 0.05, 0.04, 4, { top: false });
  broad.paint(0xffffff, Surf.Foliage).blob(0, 0.62, 0, 0.42, 0.38, 0.42, 0, 0.12, 3);
  const con = new ModelBuilder();
  con.paint(0x3a2a1c, Surf.Wood).cylinder(0, 0, 0, 0.2, 0.05, 0.04, 4, { top: false });
  con.paint(0xffffff, Surf.Foliage).cone(0, 0, 0.12, 0.88, 0.36, 7);
  _impostors = { broad: broad.build(), conifer: con.build() };
  return _impostors;
}

/** Average foliage color (linear) + bounding box of a nature geometry, for impostor tinting & scaling. */
export function natureStats(g: THREE.BufferGeometry): { color: THREE.Color; height: number; radius: number } {
  const col = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  const srf = g.getAttribute('surf') as THREE.BufferAttribute | undefined;
  const c = new THREE.Color(0, 0, 0);
  let n = 0;
  if (col && srf) {
    for (let i = 0; i < col.count; i++) {
      const s = srf.getX(i);
      if (Math.abs(s - Surf.Foliage) < 0.5 || Math.abs(s - Surf.Stone) < 0.5) {
        c.r += col.getX(i); c.g += col.getY(i); c.b += col.getZ(i);
        n++;
      }
    }
  }
  if (n) c.multiplyScalar(1 / n);
  else c.setRGB(0.1, 0.2, 0.08);
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox!;
  const height = Math.max(0.5, bb.max.y);
  const radius = Math.max(0.3, Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2);
  return { color: c, height, radius };
}
