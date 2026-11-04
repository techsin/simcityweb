/** New LG-02 art, tested directly until its manifest / registration merge. No renderer or WebGL context needed. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { ModelBuilder } from '../../src/assets/ModelBuilder';
import type { ManifestEntry } from '../../src/assets/manifest';
import { models as botanical } from '../../src/assets/builders/lm_botanical_dome';
import { models as trade } from '../../src/assets/builders/lm_world_trade_center';
import { hashString, RNG } from '../../src/core/rng';
import { Surf } from '../../src/core/types';
import { makeLodProxy } from '../../src/render/city/buildings/lodProxy';

const builders = { ...botanical, ...trade };
const entries: ManifestEntry[] = [
  { id: 'lm_botanical_dome', group: 'landmark', footprint: [4, 4], variants: 2, height: [26, 32], desc: 'Botanical Dome: triangulated glass conservatories, vent lanterns, glazed entrance, lily pools and planted gardens.' },
  { id: 'lm_world_trade_center', group: 'landmark', footprint: [4, 4], variants: 2, height: [390, 415], desc: 'World Trade Center: ribbed silver twins or stepped teal office towers, broadcast mast, conference podium and globe plaza.' },
];

function build(entry: ManifestEntry, variant: number, seed: number): [BufferGeometry, BufferGeometry] {
  const b = new ModelBuilder();
  builders[entry.id](b, variant, new RNG(seed), entry);
  const full = b.build();
  full.name = `${entry.id}#${variant}`;
  const lod = makeLodProxy(full.name, full);
  if (!lod) {
    full.dispose();
    throw new Error(`${full.name}: missing usable LOD proxy`);
  }
  return [full, lod];
}

function digest(g: BufferGeometry, names = Object.keys(g.attributes).sort()): string {
  const hash = createHash('sha256');
  for (const name of names) {
    const a = g.getAttribute(name);
    hash.update(`${name}:${a.itemSize}:${a.count}`);
    hash.update(new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength));
  }
  return hash.digest('hex');
}

function nightGlass(g: BufferGeometry, id: string): boolean {
  const surf = g.getAttribute('surf');
  for (let i = 0; i < surf.count; i++) {
    const type = surf.getX(i), pattern = surf.getY(i);
    if (id === 'lm_botanical_dome' && type === Surf.GlassPlain && (pattern === 2 || pattern === 3)) return true;
    if (id === 'lm_world_trade_center' && type === Surf.GlassCurtain && (pattern === 1 || pattern === 4) && surf.getZ(i) === 4) return true;
  }
  return false;
}

for (const entry of entries) describe(entry.id, () => {
  for (let v = 0; v < entry.variants; v++) it(`variant ${v}: budget, lot bounds, night glass and seeded determinism at both LODs`, () => {
    const key = `${entry.id}#${v}`;
    for (const seed of [hashString(key), 1, 42]) {
      const a = build(entry, v, seed), b = build(entry, v, seed);
      try {
        const counts = a.map((g) => g.getAttribute('position').count / 3);
        if (seed === hashString(key)) console.info(`${key}: LOD 0 = ${counts[0]}, LOD 1 = ${counts[1]} triangles`);
        for (let lod = 0; lod < a.length; lod++) {
          const g = a[lod], label = `${key}, seed ${seed}, LOD ${lod}`;
          expect(Number.isInteger(counts[lod]), label).toBe(true);
          expect(counts[lod], label).toBeGreaterThan(0);
          expect(counts[lod], label).toBeLessThanOrEqual(8000);
          expect(digest(g), label).toBe(digest(b[lod]));
          for (const name of ['position', 'normal', 'color', 'surf']) {
            const attr = g.getAttribute(name);
            expect(attr.count, `${label}: ${name}`).toBe(counts[lod] * 3);
            expect(Array.from(attr.array).every(Number.isFinite), `${label}: finite ${name}`).toBe(true);
          }
          const bounds = g.boundingBox!;
          const hx = entry.footprint[0] * 8, hz = entry.footprint[1] * 8;
          expect(bounds.min.x, label).toBeGreaterThanOrEqual(-hx - 0.5);
          expect(bounds.max.x, label).toBeLessThanOrEqual(hx + 0.5);
          expect(bounds.min.z, label).toBeGreaterThanOrEqual(-hz - 0.5);
          expect(bounds.max.z, label).toBeLessThanOrEqual(hz + 0.5);
          expect(bounds.min.y, label).toBeGreaterThanOrEqual(0);
          expect(nightGlass(g, entry.id), `${label}: lit glass retained`).toBe(true);
        }
        expect(a[0].boundingBox!.max.y).toBeGreaterThanOrEqual(entry.height[0]);
        expect(a[0].boundingBox!.max.y).toBeLessThanOrEqual(entry.height[1]);
        expect(counts[1]).toBeLessThanOrEqual(200);
        expect(counts[1]).toBeLessThanOrEqual(counts[0] * 0.5);
      } finally {
        for (const g of [...a, ...b]) g.dispose();
      }
    }
  });

  it('has two different silhouettes for the same seed', () => {
    const a = build(entry, 0, 73), b = build(entry, 1, 73);
    try {
      for (let lod = 0; lod < a.length; lod++) expect(digest(a[lod], ['position'])).not.toBe(digest(b[lod], ['position']));
    } finally {
      for (const g of [...a, ...b]) g.dispose();
    }
  });
});
