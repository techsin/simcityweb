/** LG-02 library / station / exchange: full geometry and the same distant LOD path as the existing towers. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ModelBuilder } from '../../src/assets/ModelBuilder';
import { MANIFEST_BY_ID, type ManifestEntry } from '../../src/assets/manifest';
import type { ModelBuilders } from '../../src/assets/registry';
import { models as library } from '../../src/assets/builders/lm_central_library';
import { models as station } from '../../src/assets/builders/lm_grand_central';
import { models as exchange } from '../../src/assets/builders/lm_stock_exchange';
import { RNG, hashString } from '../../src/core/rng';
import { Surf } from '../../src/core/types';
import { makeLodProxy } from '../../src/render/city/buildings/lodProxy';

// The registered entries (catalog defs pending, LG-02), so the footprints and height ranges checked here are the manifest's.
const entries: ManifestEntry[] = ['lm_central_library', 'lm_grand_central', 'lm_stock_exchange'].map((id) => MANIFEST_BY_ID[id]);
const models: ModelBuilders = { ...library, ...station, ...exchange };
const tris = (g: THREE.BufferGeometry) => (g.index?.count ?? g.getAttribute('position').count) / 3;

function build(entry: ManifestEntry, v: number, seed: number): THREE.BufferGeometry[] {
  const b = new ModelBuilder();
  models[entry.id](b, v, new RNG(seed), entry);
  const full = b.build();
  full.name = `${entry.id}#${v}`;
  const proxy = makeLodProxy(full.name, full);
  expect(proxy, `${full.name} must have a usable distant LOD`).not.toBeNull();
  return [full, proxy!];
}

/** Hash every vertex attribute (including normals and night-window metadata), excluding random Three.js UUIDs. */
function signature(g: THREE.BufferGeometry): string {
  const hash = createHash('sha256');
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    hash.update(`${name}:${a.itemSize}:${a.normalized}:`);
    hash.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
  }
  if (g.index) hash.update(Buffer.from(g.index.array.buffer, g.index.array.byteOffset, g.index.array.byteLength));
  return hash.digest('hex');
}

function check(g: THREE.BufferGeometry, entry: ManifestEntry, level: number): void {
  expect(tris(g)).toBeGreaterThan(0);
  expect(tris(g)).toBeLessThanOrEqual(8000);
  if (level === 1) expect(tris(g)).toBeLessThanOrEqual(200);
  for (const a of Object.values(g.attributes) as THREE.BufferAttribute[]) {
    expect(a.count).toBe(g.getAttribute('position').count);
    expect(a.array.every(Number.isFinite)).toBe(true);
  }
  const bounds = g.boundingBox!;
  expect(bounds.min.x).toBeGreaterThanOrEqual(-entry.footprint[0] * 8 - 0.5);
  expect(bounds.max.x).toBeLessThanOrEqual(entry.footprint[0] * 8 + 0.5);
  expect(bounds.min.z).toBeGreaterThanOrEqual(-entry.footprint[1] * 8 - 0.5);
  expect(bounds.max.z).toBeLessThanOrEqual(entry.footprint[1] * 8 + 0.5);
  expect(bounds.min.y).toBeGreaterThanOrEqual(-0.01);
  expect(bounds.max.y).toBeLessThanOrEqual(entry.height[1]);
  if (level === 0) expect(bounds.max.y).toBeGreaterThanOrEqual(entry.height[0]);
  const surf = g.getAttribute('surf');
  let windows = 0;
  for (let i = 0; i < surf.count; i++) {
    const type = surf.getX(i), pattern = surf.getY(i);
    if (type === Surf.WallWindows || type === Surf.GlassCurtain || (type === Surf.GlassPlain && pattern !== 1)) windows++;
  }
  expect(windows, `${entry.id} LOD ${level} keeps night windows`).toBeGreaterThan(0);
}

describe('late-game landmark models', () => {
  it('stays within budget and footprint at every variant / LOD, deterministically for a seed', () => {
    const counts: { model: string; variant: number; full: number; distant: number }[] = [];
    for (const entry of entries) for (let v = 0; v < entry.variants; v++) {
      const seed = hashString(`${entry.id}#${v}`);
      const first = build(entry, v, seed);
      try {
        first.forEach((g, level) => check(g, entry, level));
        expect(tris(first[1])).toBeLessThanOrEqual(tris(first[0]) * 0.5);
        counts.push({ model: entry.id, variant: v, full: tris(first[0]), distant: tris(first[1]) });
        // Interleave another seed before rebuilding, catching accidental shared mutable builder state.
        for (const nextSeed of [7, 11, seed]) {
          const next = build(entry, v, nextSeed);
          try {
            next.forEach((g, level) => check(g, entry, level));
            if (nextSeed === seed) expect(next.map(signature)).toEqual(first.map(signature));
          } finally {
            next.forEach((g) => g.dispose());
          }
        }
      } finally {
        first.forEach((g) => g.dispose());
      }
    }
    console.table(counts);
  });

  it('gives each landmark two different silhouettes even with the same seed', () => {
    for (const entry of entries) {
      const a = build(entry, 0, 7), b = build(entry, 1, 7);
      try {
        expect(a[0].boundingBox!.max.y).not.toBe(b[0].boundingBox!.max.y);
        expect(signature(a[0])).not.toBe(signature(b[0]));
      } finally {
        [...a, ...b].forEach((g) => g.dispose());
      }
    }
  });
});
