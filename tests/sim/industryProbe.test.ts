/** NOTE-048: the saved-city probe plans a real empty, served block without editing its inputs or using RNG. */
import { describe, expect, it } from 'vitest';
import { selectIndustrySite } from '../../tools/industryProbe';
import { BF } from '../../src/sim/CityState';
import { Network } from '../../src/core/types';
import { Simulation } from '../../src/sim/Simulation';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { removeBuilding } from '../../src/sim/economy/buildings';
import { newState, place } from '../infra/cityGen';

function site() {
  const st = newState(16), sim = new Simulation(st), rt = new EconRuntime();
  rt.attach(sim);
  st.stats.population = 1e6;
  st.landValue.fill(0.8); st.campus.fill(0.5); rt.coarseSkill.fill(1);
  place(st, 'civ_elementary_school', 0, 0, { jobs: 40, flags: BF.Plopped | BF.Powered });
  st.network[st.idx(1, 3)] = Network.Road;
  for (let x = 4; x < 10; x++) {
    const i = st.idx(x, 3);
    st.network[i] = Network.Road; st.powered[i] = st.watered[i] = 1;
  }
  return { st, rt, sim };
}

describe('industry mechanism probe site planning', () => {
  it('accepts utilities on the existing frontage, chooses exactly 6×6, and consumes no RNG or city writes', () => {
    const { st, rt, sim } = site();
    const before = structuredClone(st), rng = sim.rng.state;
    const a = selectIndustrySite(st, rt, 24, { x: 4, z: 4 });
    expect(a.site?.rect).toEqual({ x0: 4, z0: 4, x1: 10, z1: 10 });
    expect(a.site?.fits.some((f) => f.serviced > 0 && f.eligible > 0)).toBe(true);
    expect(a.site?.school.distance).toBeCloseTo(Math.hypot(5.5, 5.5), 9);
    expect(a.site?.school.tier).toBe('elementary');
    expect(a.site?.isolated).toBe(true);
    expect(selectIndustrySite(st, rt, 24, { x: 4, z: 4 })).toEqual(a);
    expect(structuredClone(st)).toEqual(before);
    expect(sim.rng.state).toBe(rng);
  });

  it('rejects occupied cells, absent water and schools outside the explicitly reported radius', () => {
    const { st, rt } = site(), origin = { x: 4, z: 4 };
    expect(selectIndustrySite(st, rt, 2, origin).site).toBeNull();
    st.watered.fill(0);
    expect(selectIndustrySite(st, rt, 24, origin).site).toBeNull();
    for (let x = 4; x < 10; x++) st.watered[st.idx(x, 3)] = 1;
    place(st, 't_r2', 9, 9);
    expect(selectIndustrySite(st, rt, 24, origin).site).toBeNull();
  });

  it.each(['civ_library', 'civ_museum'])('%s alone does not qualify as a school or college', (def) => {
    const { st, rt, sim } = site();
    const school = [...st.buildings.values()].find((b) => b.def === 'civ_elementary_school')!;
    removeBuilding(sim, school);
    const b = place(st, def, 0, 0, { jobs: 20, flags: BF.Plopped | BF.Powered });
    st.network[st.idx(1, b.d)] = Network.Road;
    expect(selectIndustrySite(st, rt, 24, { x: 4, z: 4 }).site).toBeNull();
  });
});
