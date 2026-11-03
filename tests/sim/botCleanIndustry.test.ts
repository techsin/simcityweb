/** NOTE-048: clean-only power and industrial site planning; default strategy and RNG stay on their existing path. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimBot } from '../../tools/simbot';
import { DevType, Network, Zone } from '../../src/core/types';

afterEach(() => vi.restoreAllMocks());

function bot(clean = true) {
  const b = new SimBot({ size: 96, years: 1, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0,
    quiet: true, noInfra: true, ...(clean ? { skip: ['dirty'] } : {}) }, []);
  b.st.heights.fill(1);
  b.st.water.fill(0);
  b.st.trees.fill(0);
  b.st.funds = 1e6;
  b.st.stats.population = 200000;
  b.st.stats.demand.fill(-1);
  b.st.desirability[DevType.IM].fill(0.6);
  b.st.desirability[DevType.IHT].fill(0.6);
  return b;
}

function town(b: SimBot) {
  const home = b.byKey.get(b.cbx + ',' + b.cbz)!;
  const factory = b.byKey.get((b.cbx + 1) + ',' + b.cbz)!;
  const campus = b.byKey.get((b.cbx - 1) + ',' + b.cbz)!;
  home.use = 'R'; home.developed = true;
  factory.use = 'I'; campus.use = 'C';
  b.blocks = [home, factory, campus];
  b.byKey = new Map(b.blocks.map((o) => [o.bx + ',' + o.bz, o]));
  return { home, factory, campus };
}

function layer(b: SimBot, block: SimBot['blocks'][number], dev: DevType, value: number) {
  for (let z = block.z0; z < block.z1; z++) for (let x = block.x0; x < block.x1; x++) b.st.desirability[dev][z * b.N + x] = value;
}

function factoryRemnant(b: SimBot) {
  const block = b.blocks.find((o) => o.use === 'I')!;
  b.blocks = [block];
  b.buildBlockRoads(block);
  block.developed = true; block.zone = Zone.IndHigh;
  for (let z = block.z0; z < block.z1; z++) for (let x = block.x0; x < block.x1; x++) {
    const i = z * b.N + x;
    b.st.zone[i] = Zone.IndHigh;
    b.st.building[i] = 1;
  }
  return block;
}

describe('bot: clean-only industry strategy', () => {
  it.each([false, true])('substitutes gas for coal only with skip dirty: %s', (clean) => {
    const b = bot(clean), rng = b.sim.rng.state;
    const place = vi.spyOn(b, 'placeUtility').mockReturnValue(true);
    Object.assign(b.st.stats, { powerDemand: 200, powerSupply: 0 });
    b.ensurePower();
    expect(place.mock.calls.map(([def]) => def)).toEqual([clean ? 'util_gas_plant' : 'util_coal_plant']);
    place.mockClear();
    b.st.unlocked.add('nuclear_power');
    b.st.stats.powerDemand = 1000;
    b.ensurePower();
    expect(place.mock.calls.map(([def]) => def)).toEqual(['util_nuclear_plant']);
    expect(b.sim.rng.state).toBe(rng);
  });

  it('rejects fragmented frontage and counts a complete lot once per front cell', () => {
    const b = bot(), block = factoryRemnant(b), rng = b.sim.rng.state;
    for (let z = block.z0; z < block.z1; z++) for (let x = block.x0; x < block.x1; x++) {
      if (x === block.x0 || x === block.x1 - 1 || z === block.z0 || z === block.z1 - 1) b.st.building[z * b.N + x] = -1;
    }
    expect(b.cleanIndustryRoom()).toBe(0);
    for (let z = block.z0; z < block.z1; z++) for (let x = block.x0; x < block.x1; x++) b.st.building[z * b.N + x] = 1;
    const x = block.x0 + 3, z = block.z0;
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) b.st.building[(z + dz) * b.N + x + dx] = -1;
    expect(b.cleanIndustryRoom()).toBe(2);
    expect(b.cleanIndustryRoom(true)).toBe(2);
    b.st.powerLines[(z + 1) * b.N + x] = 1;
    expect(b.cleanIndustryRoom()).toBe(0);
    b.st.powerLines[(z + 1) * b.N + x] = 0;
    b.st.network[(z - 1) * b.N + x] = Network.None;
    expect(b.cleanIndustryRoom()).toBe(0);
    expect(b.sim.rng.state).toBe(rng);
  });

  it('requires utilities on a complete footprint or its road front when infra is present', () => {
    const b = bot(), block = factoryRemnant(b);
    const x = block.x0 + 3, z = block.z0;
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) b.st.building[(z + dz) * b.N + x + dx] = -1;
    b.st.systemData.infraVersion = 1;
    expect(b.cleanIndustryRoom()).toBe(0);
    b.st.powered[(z - 1) * b.N + x] = 1;
    b.st.watered[(z - 1) * b.N + x + 1] = 1;
    expect(b.cleanIndustryRoom()).toBe(2);
    b.st.heights[(z + 1) * (b.N + 1) + x] = 30;
    expect(b.cleanIndustryRoom()).toBe(0);
  });

  it('prefers a stage-ready vacant campus site without changing its use or drawing RNG', () => {
    const b = bot(), { factory, campus } = town(b), rng = b.sim.rng.state, funds = b.funds;
    layer(b, factory, DevType.IHT, -0.1);
    layer(b, campus, DevType.IHT, 0.6);
    expect(b.cleanIndustryBlock()).toBe(campus);
    expect(campus).toMatchObject({ use: 'C', developed: false, zone: Zone.None });
    expect(b.funds).toBe(funds);
    expect(b.sim.rng.state).toBe(rng);
    expect(b.st.network.some(Boolean)).toBe(false);
    campus.developed = true;
    expect(b.cleanIndustryBlock()).toBe(factory);
  });

  it('does not choose a campus on occupied, wet, powerline-blocked or steep land', () => {
    const b = bot(), { factory, campus } = town(b);
    layer(b, factory, DevType.IHT, -0.1);
    const i = campus.z0 * b.N + campus.x0;
    for (const kind of ['occupied', 'wet', 'powerline', 'steep']) {
      for (let z = campus.z0; z < campus.z1; z++) for (let x = campus.x0; x < campus.x1; x++) {
        const at = z * b.N + x;
        b.st.building[at] = kind === 'occupied' ? 1 : -1;
        b.st.water[at] = kind === 'wet' ? 1 : 0;
        b.st.powerLines[at] = kind === 'powerline' ? 1 : 0;
      }
      b.st.heights.fill(1);
      if (kind === 'steep') for (let z = campus.z0; z <= campus.z1; z++) for (let x = campus.x0; x <= campus.x1; x++) b.st.heights[z * (b.N + 1) + x] = (x + z) % 2 ? 30 : 1;
      expect(b.cleanIndustryBlock()).toBe(factory);
    }
    expect(b.st.zone[i]).toBe(Zone.None);
  });

  it('uses clean-site planning only for the clean zoning branch and assigns successful new industry', () => {
    for (const clean of [false, true]) {
      const b = bot(clean), { factory, campus } = town(b);
      layer(b, factory, DevType.IHT, -0.1);
      b.st.stats.demand[DevType.IM] = 0.3;
      const room = vi.spyOn(b, 'cleanIndustryRoom');
      const plan = vi.spyOn(b, 'cleanIndustryBlock');
      b.zoning();
      expect(room).toHaveBeenCalledTimes(clean ? 1 : 0);
      expect(plan).toHaveBeenCalledTimes(clean ? 1 : 0);
      expect(clean ? campus : factory).toMatchObject({ developed: true, use: 'I', zone: clean ? Zone.IndHigh : Zone.IndMed });
      expect(clean ? factory.developed : campus.developed).toBe(false);
    }
  });

  it('keeps the existing investment gate and preserves a site whose zoning fails', () => {
    const b = bot(), { factory, campus } = town(b);
    layer(b, factory, DevType.IHT, -0.1);
    b.st.stats.demand[DevType.IM] = 0.3;
    b.st.funds = 0;
    b.zoning();
    expect(campus.developed).toBe(false);
    b.st.funds = 1e6;
    vi.spyOn(b.A, 'zone').mockReturnValue({ ok: false, cost: 0, reason: 'No site' });
    b.zoning();
    expect(campus).toMatchObject({ use: 'C', developed: false, zone: Zone.None });
  });
});
