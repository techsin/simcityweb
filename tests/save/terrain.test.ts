/** Terrain + region generation: determinism, neighbouring-city edge matching, speed, buildable land. */
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120_000 });
import { createRegionData, generateRegionTerrain, layoutTiles, RegionModel, REGION_PRESETS } from '../../src/region/RegionModel';
import { createCityState, terrainStats } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { REGION_H, REGION_W } from '../../src/core/constants';
import type { TerrainPreset } from '../../src/core/types';

describe('region generation', () => {
  it('is deterministic from the seed and covers the region with tiles', () => {
    const a = createRegionData({ seed: 77, preset: 'azure-coast', id: 'a' });
    const b = createRegionData({ seed: 77, preset: 'azure-coast', id: 'b' });
    expect(a.data.tiles).toEqual(b.data.tiles);
    expect(a.model.terrain.heights[12345]).toBe(b.model.terrain.heights[12345]);
    const covered = new Uint8Array(REGION_W * REGION_H);
    for (const t of a.data.tiles) for (let z = t.z; z < t.z + t.size; z++) for (let x = t.x; x < t.x + t.size; x++) covered[z * REGION_W + x]++;
    expect([...covered].every((c) => c === 1)).toBe(true);
    const sizes = new Set(a.data.tiles.map((t) => t.size));
    expect(sizes.has(1) && sizes.has(2) && sizes.has(4)).toBe(true);
  });

  it('every preset produces land and water', () => {
    for (const p of REGION_PRESETS) {
      const t = generateRegionTerrain(5, p.id, { samplesPerUnit: 8 });
      let land = 0, water = 0;
      for (const h of t.heights) h > 0 ? land++ : water++;
      expect(land, p.id).toBeGreaterThan(t.heights.length * 0.25);
      expect(water, p.id).toBeGreaterThan(0);
    }
    expect(layoutTiles(1).length).toBeGreaterThan(10);
  });

  it('neighbouring cities sampled from the region match exactly at shared edges', () => {
    const { model } = createRegionData({ seed: 9, preset: 'greenvale' });
    let checked = 0;
    for (const a of model.data.tiles) {
      const b = model.data.tiles.find((t) => t.x === a.x + a.size && t.z <= a.z && t.z + t.size > a.z);
      if (!b || checked > 6) continue;
      const ca = createCityState(model.cityConfigFor(a), { sampler: model.samplerForTile(a), skipTrees: true });
      const cb = createCityState(model.cityConfigFor(b), { sampler: model.samplerForTile(b), skipTrees: true });
      // shared edge: a's east edge (x = Na) vs b's west edge (x = 0); world z must coincide
      const Na = ca.size, Nb = cb.size;
      const cellsA = Na / a.size, cellsB = Nb / b.size; // cells per region unit (64)
      for (let k = 0; k <= Na; k++) {
        const worldZ = a.z * cellsA + k; // in cells
        const kb = worldZ - b.z * cellsB;
        if (kb < 0 || kb > Nb) continue;
        expect(ca.heights[k * (Na + 1) + Na]).toBe(cb.heights[kb * (Nb + 1) + 0]);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('region model regenerates identically from saved data', () => {
    const { data, model } = createRegionData({ seed: 1234, preset: 'twin-rivers' });
    const again = new RegionModel(structuredClone(data));
    for (const [x, z] of [[100, 200], [8000, 8000], [15000, 3000]]) expect(again.heightAt(x, z)).toBe(model.heightAt(x, z));
  });
});

describe('city terrain presets', () => {
  const presets: TerrainPreset[] = ['flat', 'plains', 'hills', 'mountains', 'river', 'coast', 'islands', 'lakes'];
  it('keeps buildable land (except mountains / islands) and is fast', () => {
    for (const p of presets) {
      const cfg = defaultCityConfig({ terrain: p, size: 256, seed: 99 });
      createCityState(cfg);
      const t0 = performance.now();
      const st = createCityState(cfg);
      const dt = performance.now() - t0;
      const s = terrainStats(st);
      // target < 150 ms on a quiet machine (typically 60-110 ms); lenient bound so loaded CI machines don't flake
      expect(dt, `${p} took ${dt.toFixed(0)} ms`).toBeLessThan(3000);
      if (p !== 'mountains' && p !== 'islands') expect(s.buildable, p).toBeGreaterThan(0.45);
      if (p === 'river' || p === 'coast' || p === 'islands' || p === 'lakes') expect(s.water, p).toBeGreaterThan(0.02);
    }
  });

  it('low-res previews look like the full-size map', () => {
    const cfg = defaultCityConfig({ terrain: 'coast', size: 256, seed: 5 });
    const full = createCityState(cfg);
    const pv = createCityState({ ...cfg, size: 64 }, { logicalSize: 256 });
    const a = terrainStats(full), b = terrainStats(pv, 10);
    expect(Math.abs(a.water - b.water)).toBeLessThan(0.08);
  });
});
