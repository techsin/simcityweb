/** Render-demo output buildings have staff so industrial and plant plume previews remain usable. */
import { describe, expect, it } from 'vitest';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import { buildDemoCity } from '../../src/render/city/demoCity';
import { getDef } from '../../src/sim/catalog';

describe('render demo staffing', () => {
  it('fills industrial and power jobs while retaining the other synthetic building staffing', () => {
    const state = buildDemoCity({ size: 128, seed: 7, buildings: true, fill: 0.8 });
    const buildings = [...state.buildings.values()];
    const industrial = buildings.filter((b) => MANIFEST_BY_ID[b.def]?.group === 'industrial');
    const plants = buildings.filter((b) => getDef(b.def)?.category === 'power');
    const others = buildings.filter((b) => !industrial.includes(b) && !plants.includes(b));
    expect(industrial.length).toBeGreaterThan(0);
    expect(plants.length).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);
    for (const b of [...industrial, ...plants]) {
      expect(b.capacity).toBeGreaterThan(0);
      expect(b.jobs).toBe(b.capacity);
    }
    expect(others.every((b) => b.jobs === 0)).toBe(true);
  });
});
