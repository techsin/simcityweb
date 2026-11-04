/** LG-02's two skyline rewards: full geometry and the same distant LOD proxy used by existing towers. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { ModelBuilder } from '../../src/assets/ModelBuilder';
import type { ManifestEntry } from '../../src/assets/manifest';
import type { ModelBuildFn } from '../../src/assets/registry';
import { models as millennium } from '../../src/assets/builders/lm_millennium_tower';
import { models as crown } from '../../src/assets/builders/lm_metropolis_crown';
import { RNG } from '../../src/core/rng';
import { Surf } from '../../src/core/types';
import { makeLodProxy } from '../../src/render/city/buildings/lodProxy';

// Pending manifest entries: registration is deliberately left to the integration hunk.
const entries: ManifestEntry[] = [
  {
    id: 'lm_millennium_tower', group: 'landmark', footprint: [4, 4], variants: 2, height: [530, 590],
    desc: 'Millennium Tower: stepped glass skyscraper with panoramic sky decks, silver needle and reflecting-pool plaza.',
  },
  {
    id: 'lm_metropolis_crown', group: 'landmark', footprint: [4, 4], variants: 2, height: [600, 650],
    desc: 'Metropolis Crown: fluted civic skyscraper with an open bronze coronet, sky hall and formal garden plaza.',
  },
];
const models: Record<string, ModelBuildFn> = { ...millennium, ...crown };

function build(entry: ManifestEntry, variant: number, seed: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const b = new ModelBuilder();
  models[entry.id](b, variant, new RNG(seed), entry);
  const g = b.build();
  g.name = `${entry.id}#${variant}`;
  const proxy = makeLodProxy(g.name, g);
  expect(proxy, `${g.name} has a useful distant LOD`).not.toBeNull();
  return [g, proxy!];
}

/** Hash every vertex attribute, including surface patterns, floor heights and colours; ignore three.js UUIDs. */
function fingerprint(g: THREE.BufferGeometry): string {
  const hash = createHash('sha256');
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    hash.update(`${name}:${a.itemSize}:${a.count}:${a.normalized};`);
    hash.update(new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength));
  }
  return hash.digest('hex');
}

function windowArea(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position'), s = g.getAttribute('surf');
  let area = 0;
  for (let i = 0; i < p.count; i += 3) {
    if (s.getX(i) !== Surf.WallWindows && s.getX(i) !== Surf.GlassCurtain) continue;
    const ux = p.getX(i + 1) - p.getX(i), uy = p.getY(i + 1) - p.getY(i), uz = p.getZ(i + 1) - p.getZ(i);
    const vx = p.getX(i + 2) - p.getX(i), vy = p.getY(i + 2) - p.getY(i), vz = p.getZ(i + 2) - p.getZ(i);
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    expect(s.getZ(i)).toBe(4);
  }
  return area;
}

describe('Millennium Tower and Metropolis Crown', () => {
  for (const entry of entries) for (let variant = 0; variant < entry.variants; variant++) {
    for (const seed of [7, 11]) {
      it(`${entry.id} variant ${variant}, seed ${seed}: budgets, lot bounds, windows and deterministic LODs`, () => {
        const levels = build(entry, variant, seed);
        // Build another seed in between to expose accidental shared helper state.
        const other = build(entry, variant, seed + 1);
        const repeat = build(entry, variant, seed);
        try {
          const counts = levels.map((g) => g.getAttribute('position').count / 3);
          expect(counts[0]).toBeGreaterThan(0);
          expect(counts[0]).toBeLessThanOrEqual(8000);
          expect(counts[1]).toBeLessThanOrEqual(200);
          expect(counts[1]).toBeLessThanOrEqual(counts[0] * 0.5);
          for (let lod = 0; lod < levels.length; lod++) {
            const g = levels[lod], bounds = g.boundingBox!;
            expect(g.index).toBeNull();
            expect(g.getAttribute('position').count % 3).toBe(0);
            for (const name of ['position', 'normal', 'color', 'surf']) {
              const a = g.getAttribute(name) as THREE.BufferAttribute;
              expect(a.itemSize).toBe(3);
              expect(a.count).toBe(g.getAttribute('position').count);
              expect(a.array.every(Number.isFinite), `${g.name} ${name}`).toBe(true);
            }
            expect(bounds.min.x).toBeGreaterThanOrEqual(-entry.footprint[0] * 8 - 0.5);
            expect(bounds.max.x).toBeLessThanOrEqual(entry.footprint[0] * 8 + 0.5);
            expect(bounds.min.z).toBeGreaterThanOrEqual(-entry.footprint[1] * 8 - 0.5);
            expect(bounds.max.z).toBeLessThanOrEqual(entry.footprint[1] * 8 + 0.5);
            expect(bounds.min.y).toBeGreaterThanOrEqual(0);
            expect(bounds.max.y).toBeLessThanOrEqual(entry.height[1]);
            expect(windowArea(g), `${g.name} keeps a substantial night-window facade`).toBeGreaterThan(1000);
            expect(fingerprint(g)).toBe(fingerprint(repeat[lod]));
          }
          expect(levels[0].boundingBox!.max.y).toBeGreaterThanOrEqual(entry.height[0]);
          expect(levels[0].boundingBox!.clone().expandByScalar(0.6).containsBox(levels[1].boundingBox!)).toBe(true);
          expect(fingerprint(levels[0])).not.toBe(fingerprint(other[0]));
          const surf = levels[0].getAttribute('surf');
          let nightGlow = 0;
          for (let i = 0; i < surf.count; i++) if (surf.getX(i) === Surf.Emissive && surf.getY(i) === 10) nightGlow++;
          expect(nightGlow).toBeGreaterThan(0);
          console.info(`${entry.id} v${variant} seed ${seed}: LOD0 ${counts[0]}, LOD1 ${counts[1]} triangles`);
        } finally {
          for (const g of [...levels, ...other, ...repeat]) g.dispose();
        }
      });
    }
  }

  it('gives each variant a different skyline at both LOD levels', () => {
    for (const entry of entries) {
      const a = build(entry, 0, 7), b = build(entry, 1, 7);
      try {
        for (let lod = 0; lod < a.length; lod++) {
          expect(fingerprint(a[lod])).not.toBe(fingerprint(b[lod]));
          expect(Math.abs(a[lod].boundingBox!.max.y - b[lod].boundingBox!.max.y)).toBeGreaterThan(20);
        }
      } finally {
        for (const g of [...a, ...b]) g.dispose();
      }
    }
  });
});
