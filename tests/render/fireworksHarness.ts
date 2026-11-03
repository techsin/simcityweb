/** Headless R2 source for the tests and tools/bench/fireworksSites.ts. Visuals are deterministic stand-ins. */
import { CELL_SIZE } from '../../src/core/constants';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import type { SiteSource } from '../../src/render/city/effects/Fireworks';

export type SiteVisual = NonNullable<ReturnType<SiteSource['visualOf']>>;

/** the stand-in for BuildingRenderer's visual: world centre, base and a height from the building's fields */
export function standInVisual(b: Pick<Building, 'x' | 'z' | 'w' | 'd' | 'flags' | 'capacity' | 'variant' | 'baseY'>): SiteVisual {
  const height = b.flags & BF.Burnt ? 3 : 24 + (b.capacity % 200) + b.variant * 8;
  return { cx: (b.x + b.w / 2) * CELL_SIZE, cz: (b.z + b.d / 2) * CELL_SIZE, baseY: b.baseY, top: b.baseY + height };
}

export function fireworksSiteSource(st: CityState): SiteSource {
  return {
    get buildings() { return st.buildings.values(); },
    defOf: getDef,
    visualOf: (id) => {
      const b = st.buildings.get(id);
      return b ? standInVisual(b) : null;
    },
    size: st.size, water: st.water, cellSize: CELL_SIZE,
    groundAt: (x, z) => st.heightAt(x, z, CELL_SIZE),
    network: st.network, building: st.building,
  };
}
