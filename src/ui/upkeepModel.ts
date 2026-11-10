/**
 * One upkeep estimate everywhere (headless, no DOM; tests pin it) — final fixes P3 / N6: the build menu quoted a
 * typical-load figure that ignored the city (Museum ≈§3,555 against §389 in the inspector, Elementary §702 against
 * §949), the Rewards panel the catalog upkeep (§650), the inspector the actual cost. The build menu, its tooltip and
 * the Rewards panel now quote, for a facility that pays running costs per person served (schools, clinics, hospitals,
 * police / fire stations, parks — economy/opex.ts), what one typically costs in this city (expectedUpkeep with the
 * city's unserved need, capped at a typical load) and the most it can cost: "up to §B at full use"
 * (facilities.fullUseUpkeep: every seat / its whole patrol capacity in use). The words are the facility facts'
 * (facilities.ts facilityDefFacts: "≈§A/mo typical in this city · up to §B at full use" — lead decision 20b / final
 * fixes UI-1: the city-wide typical load, which in a big city is 2-11x what one more changes at a given spot; the plop
 * tool says that one, "Upkeep here ≈§A/mo now", placement.ts upkeepHere).
 */
import type { CityState } from '../sim/CityState';
import type { BuildingDef } from '../sim/catalogTypes';
import { expectedUpkeep, landmarkUpkeep, opexActive, opexTierOf } from '../sim/economy/opex';
import { fullUseUpkeep } from '../sim/infra/facilities';
import { money } from './format';

export interface UpkeepEstimate {
  /** what one typically costs in this city (§ / month at 100 % funding; the typical-load estimate, not the cost at a
   *  given spot) */
  now: number;
  /** the most it can cost: every seat / its whole capacity in use (§ / month) */
  full: number;
  /** "≈§A/mo typical in this city · up to §B at full use" (lead decision 20b, option i) */
  title: string;
  /** LG-02 QA B2, a landmark with a service tier: "§1,600 / month + §0.60 per learner served" (the build card's note;
   *  a running-cost facility's is its facility fact) */
  formula?: string;
}

/** the estimate of a running-cost facility (null for a def with a flat upkeep — also every def of a city that charges
 *  no running costs, an economy-only simulation: its upkeep is the catalog's) */
export function upkeepEstimate(st: CityState | null, def: BuildingDef | undefined): UpkeepEstimate | null {
  if (!def || !((def.upkeep ?? 0) > 0) || (st && !opexActive(st))) return null;
  if (!opexTierOf(def)) return landmarkEstimate(st, def);
  const now = expectedUpkeep(st, def);
  const full = Math.max(now, fullUseUpkeep(def, st));
  return { now, full, title: `≈${money(now)}/mo typical in this city · up to ${money(full)} at full use` };
}

/**
 * LG-02 QA B2: a landmark with a service tier (Observatory, Central Library, Botanical Dome) stated its flat catalog
 * upkeep while the budget also books the tier's running costs of the people it serves (economy/opex.ts landmarkUpkeep:
 * "§1,600/mo" against §6,197 booked). The same estimate and words as a running-cost facility's, from the budget's own
 * rate; null while the city does not charge that tier (the flat upkeep is the truth then) and for every other def.
 */
function landmarkEstimate(st: CityState | null, def: BuildingDef): UpkeepEstimate | null {
  const u = landmarkUpkeep(st, def);
  if (!u) return null;
  // (the facility facts' formula words, facilities.ts facilityDefFacts: "§72 / month + §0.60 per pupil served")
  const each = `§${u.rate < 0.1 ? u.rate.toFixed(3) : u.rate.toFixed(2)}`;
  return {
    now: u.now, full: u.full, title: `≈${money(u.now)}/mo typical in this city · up to ${money(u.full)} at full use`,
    formula: `${money(def.upkeep ?? 0)} / month + ${each} per ${u.unit} served`,
  };
}
