/** LG-07: educated workers avoid dirty factories, and old industrial soil costs homes and wealthy offices appeal. */
import { describe, expect, it } from 'vitest';
import { DevType, Zone } from '../../src/core/types';
import { Simulation } from '../../src/sim/Simulation';
import { desirabilityBreakdown, desirabilitySystem } from '../../src/sim/economy/desirability';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { DESIR_WEIGHTS } from '../../src/sim/economy/tuning';
import { removeBuilding } from '../../src/sim/economy/buildings';
import { getOrdinance, setOrdinanceEnabled } from '../../src/sim/economy/ordinances';
import { PollutionSystem } from '../../src/sim/infra/pollution';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { makeCity } from './helpers';
import { newState, place } from '../infra/cityGen';

describe('LG-07 dirty industry costs', () => {
  it('I-D loses 0.03 appeal per 10 EQ above 90; clean industry and other development keep their appeal', () => {
    const { st, sim } = makeCity({ size: 16 }, []);
    const rt = new EconRuntime(), system = desirabilitySystem(rt);
    const unzoned = st.idx(4, 4), industrial = st.idx(5, 4);
    st.zone[industrial] = Zone.IndMed;
    st.stats.eq = 90;
    system.init!(sim);
    const before = st.desirability.map((a) => a.slice());
    for (const eq of [50, 90, 95, 100, 110, 150]) {
      st.stats.eq = eq;
      system.init!(sim);
      for (const i of [unzoned, industrial]) {
        const br = desirabilityBreakdown(st, rt, DevType.ID, i);
        const penalty = br.terms.find((t) => t.id === 'dirtyEducation');
        const lost = eq <= 90 ? 0 : (eq - 90) * 0.003;
        expect(before[DevType.ID][i] - br.value).toBeCloseTo(lost, 6);
        expect(br.terms.reduce((sum, t) => sum + t.value, 0)).toBeCloseTo(br.raw, 12);
        expect(br.value).toBeCloseTo(Math.max(-1, Math.min(1, br.raw)), 6);
        if (eq > 90) {
          expect(penalty?.value).toBeCloseTo(-lost, 12);
          expect(penalty?.detail).toContain('educated workers avoid smokestacks');
        } else expect(penalty).toBeUndefined();
      }
      for (const dev of [DevType.R1, DevType.R2, DevType.R3, DevType.CS1, DevType.CO3, DevType.IA, DevType.IM, DevType.IHT]) {
        expect(st.desirability[dev][unzoned]).toBe(before[dev][unzoned]);
      }
    }
  });

  it('contaminated soil lowers every residential tier and CO$$$ in both stored layers and the inspector', () => {
    const { st, sim } = makeCity({ size: 16 }, []);
    const rt = new EconRuntime(), system = desirabilitySystem(rt);
    const lots = [st.idx(4, 4), st.idx(5, 4), st.idx(6, 4)];
    st.zone[lots[1]] = Zone.ResMed;
    st.zone[lots[2]] = Zone.ComHigh;
    system.init!(sim);
    const before = st.desirability.map((a) => a.slice());
    for (const i of lots) st.soil[i] = 0.6;
    system.init!(sim);
    for (const dev of [DevType.R1, DevType.R2, DevType.R3, DevType.CO3]) {
      const i = dev <= DevType.R3 ? lots[1] : lots[2];
      const br = desirabilityBreakdown(st, rt, dev, i);
      const soil = br.terms.find((t) => t.id === 'soil')!;
      expect(soil.value).toBeLessThan(0);
      expect(soil.value).toBeCloseTo(DESIR_WEIGHTS[dev].soil * 0.6, 6);
      expect(before[dev][i] - br.value).toBeCloseTo(-soil.value, 6);
      expect(br.value).toBeCloseTo(Math.max(-1, Math.min(1, br.raw)), 6);
      expect(soil.detail).toContain('Brownfield Cleanup');
    }
    for (const dev of [DevType.CO2, DevType.CS3, DevType.ID, DevType.IM]) {
      expect(st.desirability[dev][lots[0]]).toBe(before[dev][lots[0]]);
    }
  });

  it('I-D soil survives demolition and save/load; Brownfield Cleanup restores site appeal faster', () => {
    const st = newState(16);
    const factory = place(st, 't_id', 5, 5, { jobs: 40 });
    const pollution = new PollutionSystem(), sim = new Simulation(st, [pollution]);
    const i = st.idx(5, 5);
    for (let month = 0; month < 36; month++) {
      st.day += 30;
      pollution.compute(sim, false);
    }
    const contaminated = st.soil[i];
    expect(contaminated).toBeGreaterThan(0.03);
    removeBuilding(sim, factory);
    expect(st.soil[i]).toBe(contaminated);
    st.stats.population = 10000;
    const saved = serializeCity(st, { copy: true });
    const resume = (cleanup: boolean) => {
      const copy = deserializeCity(structuredClone(saved));
      expect(copy.soil[i]).toBe(contaminated);
      expect(copy.buildings.has(factory.id)).toBe(false);
      if (cleanup) expect(setOrdinanceEnabled(copy, 'brownfield_cleanup', true).ok).toBe(true);
      const p = new PollutionSystem(), s = new Simulation(copy, [p]);
      for (let month = 0; month < 12; month++) {
        copy.day += 30;
        p.compute(s, false);
      }
      const rt = new EconRuntime();
      rt.attach(s);
      return { copy, rt };
    };
    const ordinary = resume(false), cleaned = resume(true);
    expect(ordinary.copy.soil[i]).toBeGreaterThan(0.9 * contaminated);
    expect(cleaned.copy.soil[i]).toBeLessThan(0.95 * ordinary.copy.soil[i]);
    for (const dev of [DevType.R1, DevType.R2, DevType.R3, DevType.CO3]) {
      const term = (city: ReturnType<typeof resume>) => desirabilityBreakdown(city.copy, city.rt, dev, i).terms.find((t) => t.id === 'soil')!.value;
      expect(term(cleaned)).toBeGreaterThan(term(ordinary));
      expect(term(cleaned)).toBeLessThan(0);
    }
  });

  it('industry ordinances describe the retooling ramp and Brownfield Cleanup names the affected development', () => {
    for (const id of ['pollution_controls', 'clean_air_act']) {
      const ordinance = getOrdinance(id)!;
      expect(ordinance.description).toContain('12 months');
      expect(ordinance.description).toContain('50% to manufacturing');
      expect(ordinance.description).toContain('25% to high-tech above EQ 70');
    }
    expect(getOrdinance('brownfield_cleanup')!.effectText).toContain('homes and CO$$$');
  });
});
