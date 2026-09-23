/**
 * Justice: arrests, jail stock, courthouse (SIM_DEPTH_SPEC WP7) — PHASE 0 STUB with the final signatures.
 *
 * WP7 implements the monthly model (arrests from arrest potential + emergency arrests, sentenced share, inmates stock,
 * beds / holding cells, overflow -> policeMul / crimeMul, prison riots). The stub reproduces the legacy rule exactly:
 *   policeMul = 0.75 when population > 25,000 and there is no functional jail, else 1; crimeMul = 1.
 * Consumers: services (police effectiveness, WP2-3), crime (WP3-3). Headless: no DOM / three.js.
 */
import type { CityState } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import { buildingList, infoOf, isFunctional } from './common';

export interface JusticeFactors {
  /** multiplier on police effectiveness */
  policeMul: number;
  /** multiplier on raw crime */
  crimeMul: number;
}

const cache = new WeakMap<CityState, { day: number; n: number; next: number; pop: number; f: JusticeFactors }>();

/** police / crime multipliers from the justice system (legacy jail rule until WP7) */
export function justiceFactors(st: CityState): JusticeFactors {
  const c = cache.get(st);
  const pop = st.stats.population;
  if (c && c.day === st.day && c.n === st.buildings.size && c.next === st.nextBuildingId && c.pop === pop) return c.f;
  let hasJail = false;
  if (pop > 25000) {
    const list = buildingList(st);
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      if (infoOf(st, b).isJail && isFunctional(b)) { hasJail = true; break; }
    }
  }
  const f: JusticeFactors = { policeMul: pop > 25000 && !hasJail ? 0.75 : 1, crimeMul: 1 };
  cache.set(st, { day: st.day, n: st.buildings.size, next: st.nextBuildingId, pop, f });
  return f;
}

/** crime.ts reports the month's arrest potential (sum over buildings of crime x occupants x police reach). STUB: no-op */
export function addArrestPotential(_st: CityState, _v: number): void {
  // WP7
}

/** the justice system (monthly). STUB: mirrors the legacy factors into stats.justice (display only) */
export class JusticeSystem implements SimSystem {
  readonly name = 'justice';

  init(sim: Simulation): void {
    this.publish(sim.state);
  }

  monthly(sim: Simulation): void {
    this.publish(sim.state);
  }

  private publish(st: CityState): void {
    const j = st.stats.justice;
    if (!j) return;
    const f = justiceFactors(st);
    j.policeMul = f.policeMul;
    j.crimeMul = f.crimeMul;
  }
}

export function getJustice(sim: Simulation): JusticeSystem | undefined {
  return sim.getSystem<JusticeSystem>('justice');
}
