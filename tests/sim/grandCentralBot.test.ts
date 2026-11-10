import { describe, expect, it } from 'vitest';
import { SimBot } from '../../tools/simbot';
import { BF } from '../../src/sim/CityState';
import { CATALOG } from '../../src/sim/catalog';
import { lotTouchesRoad, placeBuilding } from '../../src/sim/economy/buildings';

function bot() {
  const b = new SimBot({ size: 96, years: 1, seed: 7, difficulty: 'medium', terrain: 'flat', water: 0, quiet: true, noInfra: true });
  b.st.funds = 1e6;
  b.st.stats.population = 300000;
  b.st.unlocked.clear();
  b.st.unlocked.add('lm_grand_central');
  b.st.budget.lastExpense = { 'service:police': 10000 };
  const park = b.blocks.find((blk) => blk.use === 'P' && blk.ring < 3)!;
  for (const blk of b.blocks) if (blk !== park && blk.use === 'P') blk.use = 'R';
  return { b, park };
}

const FILLER = CATALOG.find((def) => def.category === 'growable' && def.footprint[0] === 1 && def.footprint[1] === 1)!;
function fill(b: SimBot, x: number, z: number) {
  placeBuilding(b.sim, {
    id: b.st.nextBuildingId++, def: FILLER.id, x, z, w: 1, d: 1, rot: 0, variant: 0, pop: 2, jobs: 0, capacity: FILLER.capacity ?? 2,
    wealth: 1, built: 1, age: 400, flags: BF.Powered | BF.Watered, baseY: 5, health: 1, unhappy: 0,
  });
}

describe('LG-02 bot Grand Central placement', () => {
  it('finds a free 4×3 lot between the corner and midpoint candidates of a built-up park block', () => {
    const { b, park } = bot();
    b.buildBlockRoads(park);
    park.developed = true;
    const lx = park.x0 + 1, lz = park.z0;
    for (let z = park.z0; z < park.z1; z++) for (let x = park.x0; x < park.x1; x++) {
      if (x >= lx && x < lx + 4 && z >= lz && z < lz + 3) continue;
      fill(b, x, z);
    }
    expect(b.placeNear('lm_grand_central', b.line(b.cbx), b.line(b.cbz), ['P'], true, Infinity, true)).toBeNull();
    b.rewards();
    const hub = [...b.st.buildings.values()].find((building) => building.def === 'lm_grand_central')!;
    expect(b.count('lm_grand_central')).toBe(1);
    expect([hub.x, hub.z]).toEqual([lx, lz]);
    expect(lotTouchesRoad(b.st, hub.x, hub.z, hub.w, hub.d)).toBe(true);
  });

  it('builds the roads of an undeveloped park block before buying the hub', () => {
    const { b, park } = bot();
    const neighbor = b.blocks.find((blk) => Math.abs(blk.bx - park.bx) + Math.abs(blk.bz - park.bz) === 1)!;
    neighbor.developed = true;
    expect(b.st.network.some((cell) => cell !== 0)).toBe(false);
    expect(b.placeNear('lm_grand_central', b.line(b.cbx), b.line(b.cbz), ['P'], true, Infinity, true)).toBeNull();
    b.rewards();
    const hub = [...b.st.buildings.values()].find((building) => building.def === 'lm_grand_central')!;
    expect(b.count('lm_grand_central')).toBe(1);
    expect(park.developed).toBe(true);
    expect(lotTouchesRoad(b.st, hub.x, hub.z, hub.w, hub.d)).toBe(true);
  });

  it('leaves the city untouched before the 300k unlock', () => {
    const { b } = bot();
    b.st.stats.population = 299999;
    b.st.unlocked.delete('lm_grand_central');
    const funds = b.st.funds, buildings = b.st.buildings.size, network = b.st.network.slice();
    b.rewards();
    expect(b.st.funds).toBe(funds);
    expect(b.st.buildings.size).toBe(buildings);
    expect(b.st.network).toEqual(network);
    expect(b.count('lm_grand_central')).toBe(0);
  });
});
