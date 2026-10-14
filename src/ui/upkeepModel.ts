/**
 * One upkeep estimate everywhere (headless, no DOM; tests pin it) — final fixes P3 / N6: the build menu quoted a
 * typical-load figure that ignored the city (Museum ≈§3,555 against §389 in the inspector, Elementary §702 against
 * §949), the Rewards panel the catalog upkeep (§650), the inspector the actual cost. The build menu, its tooltip and
 * the Rewards panel now quote, for a facility that pays running costs per person served (schools, clinics, hospitals,
 * police / fire stations, parks — economy/opex.ts), what one more of it costs in this city now (expectedUpkeep with
 * the city's unserved need) and the most it can cost: "up to §B at full use" (facilities.fullUseUpkeep: every seat /
 * its whole patrol capacity in use, so a full school is never above it). The wording matches the plop tool (lane
 * ui-tools) and the facility facts (facilities.ts facilityDefFacts: "≈§A/mo typical in this city · up to §B at full use" —
 * lead decision 20b: the city-wide typical load, not what one more changes at a given spot).
 */
import type { CityState } from '../sim/CityState';
import type { BuildingDef } from '../sim/catalogTypes';
import { expectedUpkeep, opexActive, opexTierOf } from '../sim/economy/opex';
import { fullUseUpkeep } from '../sim/infra/facilities';
import { money } from './format';

export interface UpkeepEstimate {
  /** what one more costs in this city now (§ / month at 100 % funding) */
  now: number;
  /** the most it can cost: every seat / its whole capacity in use (§ / month) */
  full: number;
  /** "≈§A/mo typical in this city · up to §B at full use" (lead decision 20b, option i) */
  title: string;
}

/** the estimate of a running-cost facility (null for a def with a flat upkeep — also every def of a city that charges
 *  no running costs, an economy-only simulation: its upkeep is the catalog's) */
export function upkeepEstimate(st: CityState | null, def: BuildingDef | undefined): UpkeepEstimate | null {
  if (!def || !opexTierOf(def) || !((def.upkeep ?? 0) > 0) || (st && !opexActive(st))) return null;
  const now = expectedUpkeep(st, def);
  const full = Math.max(now, fullUseUpkeep(def));
  return { now, full, title: `≈${money(now)}/mo typical in this city · up to ${money(full)} at full use` };
}
