/**
 * Model registry. Each builder module (src/assets/builders/*.ts) exports `models: ModelBuilders` — a map of
 * manifest id -> build function. The registry builds + caches BufferGeometries per (id, variant).
 */
import * as THREE from 'three';
import { ModelBuilder } from './ModelBuilder';
import { RNG, hashString } from '../core/rng';
import { MANIFEST_BY_ID, type ManifestEntry } from './manifest';

/**
 * Build function: draw the model into `b`. `variant` in [0, entry.buildVariants ?? entry.variants).
 * `rng` is seeded by (id, variant) — mirrored twins get their own seed so their rng-driven details differ.
 */
export type ModelBuildFn = (b: ModelBuilder, variant: number, rng: RNG, entry: ManifestEntry) => void;
export type ModelBuilders = Record<string, ModelBuildFn>;

const builders = new Map<string, ModelBuildFn>();
const cache = new Map<string, THREE.BufferGeometry>();

export function registerModels(defs: ModelBuilders): void {
  for (const [id, fn] of Object.entries(defs)) {
    if (!MANIFEST_BY_ID[id]) console.warn(`[assets] model "${id}" is not in the manifest`);
    builders.set(id, fn);
  }
}

export function hasModel(id: string): boolean {
  return builders.has(id);
}

export function registeredModelIds(): string[] {
  return [...builders.keys()];
}

/** Fallback placeholder: a grey box sized from the manifest. */
function placeholder(b: ModelBuilder, entry: ManifestEntry | undefined) {
  const w = (entry?.footprint[0] ?? 1) * 16 - 3;
  const d = (entry?.footprint[1] ?? 1) * 16 - 3;
  const h = entry ? (entry.height[0] + entry.height[1]) / 2 : 8;
  b.paint(0xff00ff).boxC(0, 0, w, d, 0, h);
}

export function getModelGeometry(id: string, variant = 0): THREE.BufferGeometry {
  const entry = MANIFEST_BY_ID[id];
  const nv = entry?.variants ?? 1;
  const v = ((variant % nv) + nv) % nv;
  const key = `${id}#${v}`;
  let g = cache.get(key);
  if (g) return g;
  const b = new ModelBuilder();
  const fn = builders.get(id);
  const bv = entry?.buildVariants ?? nv;
  const baseV = v % bv;
  const mirrored = !!entry?.mirror && v >= bv;
  try {
    if (fn && entry) fn(b, baseV, new RNG(hashString(key)), entry);
    else placeholder(b, entry);
  } catch (e) {
    console.error(`[assets] failed to build ${key}`, e);
    placeholder(b, entry);
  }
  if (b.triangleCount === 0) placeholder(b, entry);
  g = b.build();
  if (mirrored) mirrorX(g);
  g.name = key;
  cache.set(key, g);
  return g;
}

/** Mirror a non-indexed geometry across X (positions + normals) and fix triangle winding. */
function mirrorX(g: THREE.BufferGeometry): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const attrs = Object.values(g.attributes) as THREE.BufferAttribute[];
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, -pos.getX(i));
    nrm.setX(i, -nrm.getX(i));
  }
  // swap vertices 1 and 2 of every triangle in every attribute
  for (const a of attrs) {
    const arr = a.array as Float32Array;
    const n = a.itemSize;
    for (let t = 0; t + 2 < a.count; t += 3) {
      const o1 = (t + 1) * n, o2 = (t + 2) * n;
      for (let k = 0; k < n; k++) {
        const tmp = arr[o1 + k];
        arr[o1 + k] = arr[o2 + k];
        arr[o2 + k] = tmp;
      }
    }
    a.needsUpdate = true;
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
}

export function clearModelCache(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}
