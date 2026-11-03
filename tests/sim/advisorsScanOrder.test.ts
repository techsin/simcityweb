/**
 * B3 (A1's save / load claim, docs/dev/B3_DESIGN.md §4): the advisors' month scans do not depend on the order of the
 * runtime's building lists. A running game swap-removes from rt.plopped / rt.growables, a loaded game rebuilds them in
 * Map order (ascending id): the facility scan lists its buildings in ascending id (civicFirst the lowest), the outage
 * scan takes the lowest id of equally occupied buildings, the bus-stop place the lowest id — so a game loaded before
 * the scans finds the same "Show me" places as the game it continues.
 */
import { describe, expect, it } from 'vitest';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { removeBuilding } from '../../src/sim/economy/buildings';
import { MONTH_SCAN_DAYS, advisorData, advisorsSystem } from '../../src/sim/economy/advisors';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { newState, place } from '../infra/cityGen';

/** a town of plopped facilities (plants, pumps, schools, bus stops, unpowered police stations) and equally occupied homes
 *  without power, every list in ascending id */
function town(): { st: CityState; ids: Record<string, number[]> } {
  const st = newState(64);
  st.systemData.infraVersion = 1;
  st.systemData.infraLayers = { utilities: true, traffic: false, pollution: false, services: false };
  st.stats.population = 20000;
  const ids: Record<string, number[]> = { first: [], plants: [], pumps: [], schools: [], police: [], stops: [], homes: [], firstHome: [] };
  const pl = (k: string, def: string, x: number, z: number, flags = BF.Plopped | BF.Powered | BF.Watered) => ids[k].push(place(st, def, x, z, { flags }).id);
  pl('first', 'civ_police_station', 2, 2);
  for (let k = 0; k < 3; k++) pl('plants', 'util_coal_plant', 4 + 6 * k, 6);
  for (let k = 0; k < 3; k++) pl('pumps', 'util_water_pump', 4 + 6 * k, 14);
  for (let k = 0; k < 3; k++) pl('schools', 'civ_elementary_school', 4 + 6 * k, 20);
  for (let k = 0; k < 3; k++) pl('stops', 'tr_bus_stop', 4 + 6 * k, 36);
  // (last: the swap-remove of the first plopped building moves the last of these to the front)
  for (let k = 0; k < 4; k++) pl('police', 'civ_police_station', 4 + 6 * k, 28, BF.Plopped | BF.Watered); // (no power)
  ids.firstHome.push(place(st, 't_r1', 2, 44, { pop: 50, flags: BF.Powered | BF.Watered }).id);
  for (let k = 0; k < 4; k++) ids.homes.push(place(st, 't_r1', 4 + 4 * k, 48, { pop: 50, flags: BF.Watered }).id); // (dark, equal)
  return { st, ids };
}
/** the month scans of days 28 and 29 (zone + outages, facilities, predicted places) */
function scan(st: CityState) {
  const rt = new EconRuntime();
  const adv = advisorsSystem(rt);
  const sim = new Simulation(st, [adv]);
  return {
    sim, rt,
    run() {
      st.day = 30 + MONTH_SCAN_DAYS[0];
      adv.daily!(sim);
      st.day = 30 + MONTH_SCAN_DAYS[1];
      adv.daily!(sim);
      return structuredClone(advisorData(st).scan!);
    },
  };
}
const centre = (st: CityState, b: Building) => Math.min(st.size - 1, b.z + (b.d >> 1)) * st.size + Math.min(st.size - 1, b.x + (b.w >> 1));

describe('B3: the advisors\' month scans do not depend on the order of the runtime\'s lists', () => {
  it('a running game after swap-removes and its loaded copy scan the same facilities, outages and places', () => {
    const { st, ids } = town();
    const g = scan(st);
    g.rt.ensureLists();
    // bulldoze the first plopped building and the first home: the runtime moves the last of each list into the gap
    removeBuilding(g.sim, st.buildings.get(ids.first[0])!);
    removeBuilding(g.sim, st.buildings.get(ids.firstHome[0])!);
    g.rt.ensureLists();
    const asc = (list: readonly Building[]) => list.every((b, k) => k === 0 || b.id > list[k - 1].id);
    expect(asc(g.rt.plopped)).toBe(false);
    expect(asc(g.rt.growables)).toBe(false);
    expect(g.rt.plopped[0].id).toBe(ids.police[3]);
    expect(g.rt.growables[0].id).toBe(ids.homes[3]);
    const live = g.run();
    // the loaded copy: lists in Map order
    const copy = deserializeCity(structuredClone(serializeCity(st, { copy: true })));
    const h = scan(copy);
    h.rt.ensureLists();
    expect(asc(h.rt.plopped) && asc(h.rt.growables)).toBe(true);
    expect(h.run()).toStrictEqual(live);
    // the lists in ascending id, the lowest unpowered civic building, the lowest id of the equally occupied dark homes
    const fac = live.fac!;
    expect(fac.plants).toEqual(ids.plants);
    expect(fac.tiered).toEqual([...ids.schools, ...ids.police]);
    expect(fac.civicUnpowered).toBe(4);
    expect(fac.civicFirst).toBe(ids.police[0]);
    expect(live.zone!.outP).toBe(4);
    expect(live.zone!.outPAt).toBe(centre(st, st.buildings.get(ids.homes[0])!));
  });
});
