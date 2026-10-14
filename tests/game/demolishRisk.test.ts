/**
 * Final fixes N1 (preview part): bulldozing the only conductor between a plant and the homes, or a pump that bridged
 * the grid, cut occupied buildings off — demolishRisk.utilityCut replays utilities.ts's connectivity without what the
 * demolition removes and the bulldozer / rezoning / road drag confirm says so ("Cuts power to 3 buildings …"). A
 * redundant tile cuts nothing and asks nothing.
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF, type CityState } from '../../src/sim/CityState';
import { bulldozeCut, demolishRisks, sideDemolishRisks, utilityCut } from '../../src/game/demolishRisk';
import { CityActions } from '../../src/sim/actions';
import { getUtilities } from '../../src/sim/systems/infra';
import { newSim, newState, place, roadLine, setRoad } from '../infra/cityGen';

const ON = BF.Powered | BF.Watered;

/**
 * plant (2×2 at 2,10) — a single road tile (4,10) — a street along x = 5 (z 4..20) with five homes on its east side
 * (x = 6, z = 12..16) and a water pump on it (6,6): the tile (4,10) is the plant's only link to the homes
 */
function town(): { st: CityState; homes: number[]; pump: number; plant: number } {
  const st = newState(32);
  st.systemData.infraVersion = 1; // utilities simulated
  const plant = place(st, 't_coal', 2, 10, { flags: BF.Plopped | BF.Powered }).id;
  setRoad(st, 4, 10);
  roadLine(st, 5, 4, 5, 20, Network.Road);
  const pump = place(st, 't_pump', 6, 6, { flags: BF.Plopped | ON }).id;
  const homes: number[] = [];
  for (let z = 12; z <= 16; z++) {
    st.zone[st.idx(6, z)] = Zone.ResMed;
    homes.push(place(st, 't_r2', 6, z, { pop: 20, flags: ON }).id);
  }
  return { st, homes, pump, plant };
}

const tile = (x: number, z: number) => ({ x0: x, z0: z, x1: x + 1, z1: z + 1 });

describe('demolition previews: utility cuts (final fixes N1)', () => {
  it('bulldozing the single road tile between a plant and the homes is a risk: their power is cut', () => {
    const { st, homes } = town();
    const cut = bulldozeCut(st, tile(4, 10))!;
    expect(cut).not.toBeNull();
    expect(cut.power.sort()).toEqual([...homes].sort());
    expect(cut.water).toEqual([]); // the pump needs no power and stays on the street
    expect(cut.res).toBe(100);
    expect(cut.text).toBe('Cuts power to 5 buildings (100 residents)');
    const risk = demolishRisks(st, tile(4, 10), 0)!;
    expect(risk).not.toBeNull();
    expect(risk.items[0]).toBe('Cuts power to 5 buildings (100 residents)');
    expect(risk.title).toBe('Demolish this area?');
  });

  it('a redundant tile cuts nothing and asks nothing', () => {
    const { st } = town();
    setRoad(st, 4, 11); // a second link from the plant to the street
    expect(bulldozeCut(st, tile(4, 10))).toBeNull();
    expect(demolishRisks(st, tile(4, 10), -5)).toBeNull();
    // a home at the end of the street: nobody else hangs on it
    expect(bulldozeCut(st, tile(6, 16))).toBeNull();
    // a power line around the gap works as well as a road
    const t2 = town();
    for (const [x, z] of [[3, 9], [4, 9]]) t2.st.powerLines[t2.st.idx(x, z)] = 1;
    expect(bulldozeCut(t2.st, tile(4, 10))).toBeNull();
  });

  it('a pump that bridged the grid: power is cut, and its water loss is the last-water-source line', () => {
    const st = newState(32);
    st.systemData.infraVersion = 1;
    place(st, 't_coal', 2, 10, { flags: BF.Plopped | BF.Powered });
    // the plant reaches the street only through the pump's lot
    const pump = place(st, 't_pump', 4, 10, { flags: BF.Plopped | ON });
    roadLine(st, 5, 4, 5, 20, Network.Road);
    for (let z = 12; z <= 14; z++) { st.zone[st.idx(6, z)] = Zone.ResMed; place(st, 't_r2', 6, z, { pop: 30, flags: ON }); }
    const risk = demolishRisks(st, { x0: pump.x, z0: pump.z, x1: pump.x + 1, z1: pump.z + 1 }, 0)!;
    expect(risk.title).toBe('Demolish Water pump?');
    expect(risk.items[0]).toMatch(/^Your only water source — 90 residents will lose water/);
    // (the water part of the cut is the line above: no "power and water" double count)
    expect(risk.items[1]).toBe('Cuts power to 3 buildings (90 residents)');
  });

  it('a water cut: the only road between the pump and medium-density homes (power still runs on lines)', () => {
    const { st, homes } = town();
    // power reaches both halves of the street without (5,10): lines (3,9)-(4,9) north, (4,11) south
    for (const [x, z] of [[3, 9], [4, 9], [4, 11]]) st.powerLines[st.idx(x, z)] = 1;
    const cut = bulldozeCut(st, tile(5, 10))!;
    expect(cut.power).toEqual([]);
    expect(cut.water.sort()).toEqual([...homes].sort());
    expect(cut.text).toBe('Cuts water to 5 buildings (100 residents)');
    // both at once: no line to the south half
    st.powerLines[st.idx(4, 11)] = 0;
    expect(bulldozeCut(st, tile(5, 10))!.text).toBe('Cuts power and water to 5 buildings (100 residents)');
  });

  it('a pump needs power: cutting its grid dries the homes it feeds', () => {
    const { st, homes, pump } = town();
    st.buildings.get(pump)!.def = 'util_water_pump'; // powerUse 0.5: no power, no water
    const cut = bulldozeCut(st, tile(4, 10))!;
    expect(cut.power.sort()).toEqual([...homes].sort());
    expect(cut.water.sort()).toEqual([...homes].sort());
    expect(cut.text).toBe('Cuts power and water to 5 buildings (100 residents)');
  });

  it('rezoning a home that bridged the grid asks first (side demolitions), a road drag over it does not', () => {
    const st = newState(32);
    st.systemData.infraVersion = 1;
    place(st, 't_coal', 2, 10, { flags: BF.Plopped | BF.Powered });
    st.zone[st.idx(4, 10)] = Zone.ResLow;
    const bridge = place(st, 't_r1', 4, 10, { pop: 4, flags: BF.Powered }); // conducts between plant and street
    roadLine(st, 5, 4, 5, 20, Network.Road);
    for (let z = 12; z <= 14; z++) { st.zone[st.idx(6, z)] = Zone.ResLow; place(st, 't_r1', 6, z, { pop: 8, flags: BF.Powered }); }
    const risk = sideDemolishRisks(st, [bridge.id], 5)!;
    expect(risk).not.toBeNull();
    expect(risk.items).toEqual(['1 building will be demolished — 4 residents will be lost', 'Cuts power to 3 buildings (24 residents)']);
    // a road drag through the lot: the new road conducts in its place
    expect(sideDemolishRisks(st, [bridge.id], 5, { add: { cells: [{ x: 4, z: 10 }], pipes: true } })).toBeNull();
    // rail conducts power too (no pipes)
    expect(utilityCut(st, { buildings: [bridge.id], add: { cells: [{ x: 4, z: 10 }], pipes: false } })).toBeNull();
  });

  it('only buildings that have the utility now and are occupied count; no utilities layer: no cut', () => {
    const { st, homes } = town();
    st.buildings.get(homes[0])!.pop = 0;
    st.buildings.get(homes[1])!.flags &= ~BF.Powered;
    st.buildings.get(homes[2])!.flags |= BF.Abandoned;
    expect(bulldozeCut(st, tile(4, 10))!.power.length).toBe(2);
    const st2 = town().st;
    st2.systemData.infraVersion = undefined;
    expect(bulldozeCut(st2, tile(4, 10))).toBeNull();
  });

  it('matches the utilities system: after the bulldoze the cut homes are dark, the others lit', () => {
    const { st, homes } = town();
    const extra = place(st, 't_r2', 3, 12, { pop: 20, flags: ON }).id; // beside the plant: keeps its power
    st.zone[st.idx(3, 12)] = Zone.ResMed;
    const sim = newSim(st);
    // the town as the utilities system sees it: every home powered
    for (const id of [...homes, extra]) expect(st.buildings.get(id)!.flags & BF.Powered).toBeTruthy();
    const cut = bulldozeCut(st, tile(4, 10))!;
    expect(cut.power.sort()).toEqual([...homes].sort());
    expect(new CityActions(sim).bulldoze(tile(4, 10)).ok).toBe(true);
    getUtilities(sim)!.compute(sim);
    for (const id of homes) expect(st.buildings.get(id)!.flags & BF.Powered).toBe(0);
    expect(st.buildings.get(extra)!.flags & BF.Powered).toBeTruthy();
  });
});

describe('utility cuts against the utilities system (random towns)', () => {
  /** small seeded RNG */
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** a 40² town: a few roads, power lines, plants, pumps (some needing power) and homes, flags from the real system */
  function randomTown(seed: number) {
    const R = rng(seed);
    const st = newState(40);
    const N = 40;
    const ri = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));
    for (let k = 0; k < 7; k++) {
      if (R() < 0.5) { const z = ri(1, N - 2), x0 = ri(0, 20), x1 = ri(x0 + 3, N - 1); roadLine(st, x0, z, x1, z, R() < 0.2 ? Network.Rail : Network.Road); }
      else { const x = ri(1, N - 2), z0 = ri(0, 20), z1 = ri(z0 + 3, N - 1); roadLine(st, x, z0, x, z1, Network.Road); }
    }
    for (let k = 0; k < 3; k++) { const z = ri(1, N - 2), x0 = ri(0, 30); for (let x = x0; x < x0 + ri(2, 8) && x < N; x++) if (!st.network[st.idx(x, z)]) st.powerLines[st.idx(x, z)] = 1; }
    const free = (x: number, z: number, w: number, d: number) => {
      for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) {
        if (xx >= N || zz >= N) return false;
        const i = st.idx(xx, zz);
        if (st.network[i] || st.powerLines[i] || st.building[i] >= 0) return false;
      }
      return true;
    };
    const put = (def: string, w: number, d: number, opts: Parameters<typeof place>[4] = {}) => {
      for (let t = 0; t < 40; t++) {
        const x = ri(0, N - w), z = ri(0, N - d);
        if (free(x, z, w, d)) return place(st, def, x, z, opts);
      }
      return null;
    };
    for (let k = 0; k < 2; k++) put('t_coal', 2, 2, { flags: BF.Plopped });
    // (big producers that need power: a short network would ration by distance, which is no cut)
    for (let k = 0; k < 3; k++) put(R() < 0.5 ? 'util_water_pump' : 'util_water_tower', 1, 1, { flags: BF.Plopped });
    for (let k = 0; k < 70; k++) {
      const med = R() < 0.6;
      const b = put(med ? 't_r2' : 't_r1', 1, 1, { pop: ri(1, 30) });
      if (b) st.zone[st.idx(b.x, b.z)] = med ? Zone.ResMed : Zone.ResLow;
    }
    st.config.sandbox = true; // (demolition fees: no money checks)
    const sim = newSim(st);
    return { st, sim, R, ri };
  }

  /** a grid / pipe network with some supply but not enough (brownout ordering: losses that are no cut) */
  function rationed(sim: ReturnType<typeof newSim>): boolean {
    const u = getUtilities(sim)!;
    for (const b of sim.state.buildings.values()) {
      const g = u.gridInfo(sim, b.x, b.z), w = u.waterInfo(sim, b.x, b.z);
      if ((g && g.supply > 0 && g.shortage) || (w && w.supply > 0 && w.shortage)) return true;
    }
    return false;
  }

  it('the detour shortcut, the full flood fill and the real recompute agree', () => {
    let cuts = 0, trials = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { st, sim, ri } = randomTown(seed);
      // ample supply: no brownout ordering, so a cut is exactly a lost connection
      if (rationed(sim)) continue;
      for (let k = 0; k < 3; k++) {
        const x = ri(0, 37), z = ri(0, 37), w = ri(1, 3), d = ri(1, 3);
        const rect = { x0: x, z0: z, x1: x + w, z1: z + d };
        const fast = bulldozeCut(st, rect);
        const ids = new Set<number>();
        for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) { const id = st.building[st.idx(xx, zz)]; if (id >= 0) ids.add(id); }
        const full = utilityCut(st, { buildings: [...ids], clear: rect }, true);
        expect(fast?.power ?? [], `seed ${seed} rect ${JSON.stringify(rect)} power`).toEqual(full?.power ?? []);
        expect(fast?.water ?? [], `seed ${seed} rect ${JSON.stringify(rect)} water`).toEqual(full?.water ?? []);
        trials++;
        if (k === 2) {
          // ground truth: bulldoze it and let the utilities system recompute
          const before = new Map<number, number>();
          for (const b of st.buildings.values()) if (!ids.has(b.id) && (b.pop > 0 || b.jobs > 0)) before.set(b.id, b.flags);
          const res = new CityActions(sim).bulldoze(rect);
          if (!res.ok) { expect(res.reason).toBe('Nothing to bulldoze'); continue; }
          getUtilities(sim)!.compute(sim);
          if (rationed(sim)) continue;
          for (const [id, f0] of before) {
            const b = st.buildings.get(id)!;
            if (f0 & BF.Powered && !(b.def === 't_coal')) expect(!(b.flags & BF.Powered), `seed ${seed} power ${id}`).toBe(!!fast?.power.includes(id));
            if (f0 & BF.Watered && b.def === 't_r2') expect(!(b.flags & BF.Watered), `seed ${seed} water ${id}`).toBe(!!fast?.water.includes(id));
          }
          if (fast) cuts++;
        }
      }
    }
    expect(trials).toBeGreaterThan(60);
    expect(cuts).toBeGreaterThan(0);
  });
});
