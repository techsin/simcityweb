/**
 * FH-05 (polish round 1, GUIDE): what a building does to the monthly budget, said before it is placed (headless: mirrored
 * state reads only, no DOM; tests/game/budgetDelta.test.ts pins it).
 *  - budgetEffect / reservesText: the plop tip's and the build card's "Monthly budget: +§259 → −§280 after this" (T037c's
 *    helper, moved here from src/game/tools/Tool.ts, which re-exports it for the tools and the toolbar).
 *  - The finance advisor's "A small surplus of §150 — a Fire Station costs about §540 a month" (the wording itself is
 *    src/ui/panels/AdvisorsPanel.ts's): askedServices finds the services the other advisors' open issues ask for — by
 *    advice id, never by text — and the lot beside each issue's place (serviceLot); quotedUpkeep is the monthly upkeep
 *    the plop tip quotes for one more there. The card and the tip must agree, so the card takes the tip's own figure
 *    (the spot's "Upkeep here", NOTE-043), not the city-wide expectedUpkeep of the build card: in a 1,550-resident
 *    town that estimate reads §171 for a Fire Station that costs §85 beside the homes.
 */
import { Network } from '../../core/types';
import type { CityState } from '../../sim/CityState';
import { getDef } from '../../sim/catalog';
import type { BuildingDef } from '../../sim/catalogTypes';
import type { OpenAdvice } from '../../sim/economy/advisors';
import { lotTouchesRoad } from '../../sim/economy/buildings';
import { money, moneySigned } from '../format';
import { upkeepEstimate } from '../upkeepModel';

/** FH-05: no text counts more months of reserves than this ("the treasury runs dry in 1119 months" played a loss down) */
export const RESERVE_MONTHS_MAX = 60;

/** FH-05: what placing a building does to the monthly budget (the plop tip's line, the build card's row) */
export interface BudgetEffect {
  /** last month's recurring net (§ / month) */
  before: number;
  /** before + the building's monthly effect */
  after: number;
  /** "+§259 → −§280 after this" (a venue or an airport: ", before its income (up to §1,500 when busy)") */
  text: string;
  /** below zero after it: how long the treasury lasts at that rate ("≈ 7 months of reserves"); '' otherwise */
  reserves: string;
  /** below zero after it: the line is red */
  bad: boolean;
}

/**
 * FH-05: "Monthly budget: +§259 → −§280 after this", before a building is placed: a Fire Station read ≈§539/mo while
 * the town made +§259/mo, and players overbuilt services without knowing it (shots2/024, shots2/078).
 * Before: last month's recurring net, the top bar's figure (mirrored budget.lastIncome / lastExpense; one-offs such as
 * construction, loan money and refunds left out). After: before minus the upkeep the tip quotes (`upkeep`: the spot's
 * "Upkeep here", the card's city-wide estimate or the catalog figure), plus a business deal's income, which pays as it
 * is; a venue's or an airport's income follows its visitors and traffic, so it is named, not counted. Below zero after
 * it, the line turns red and says how long the treasury lasts at that rate, never more than 60 months. Mirrored reads
 * only: no computeMonthlyBudget per mouse move (a Worker watch, WORKER_DESIGN §2.8).
 * null without a budget report yet (a city's first month: the top bar's "No report yet"), in a sandbox (money is no
 * object), or when the building changes nothing.
 */
export function budgetEffect(st: Pick<CityState, 'budget' | 'funds'>, def: Pick<BuildingDef, 'category' | 'income'>, upkeep: number, sandbox = false,
  opts: { venueNote?: boolean } = {}): BudgetEffect | null {
  const b = st.budget;
  if (sandbox || !b) return null;
  let before = 0, report = false;
  for (const k in b.lastIncome) { report = true; if (!k.startsWith('oneoff:')) before += b.lastIncome[k] || 0; }
  for (const k in b.lastExpense) { report = true; if (!k.startsWith('oneoff:')) before -= b.lastExpense[k] || 0; }
  const deal = def.category === 'reward' ? def.income ?? 0 : 0;
  const change = deal - Math.max(0, upkeep || 0);
  if (!report || Math.round(change) === 0) return null;
  const after = before + change;
  const venue = def.category === 'reward' || opts.venueNote === false ? 0 : def.income ?? 0;
  const text = `${moneySigned(before)} → ${moneySigned(after)} after this${venue > 0 ? `, before its income (up to ${money(venue)} when busy)` : ''}`;
  const bad = Math.round(after) < 0;
  return { before, after, text, reserves: bad ? reservesText(st.funds, -after) : '', bad };
}

/** how long `funds` last at a loss of `loss` § a month (FH-05): "≈ 7 months of reserves", never more than 60 months */
export function reservesText(funds: number, loss: number): string {
  if (!(funds > 0)) return 'no reserves left';
  const months = funds / loss;
  if (months < 1) return 'less than a month of reserves';
  if (months > RESERVE_MONTHS_MAX) return 'more than 5 years of reserves';
  const n = Math.floor(months);
  return `≈ ${n} month${n === 1 ? '' : 's'} of reserves`;
}

// ------------------------------------------------------------------------------------------------ the finance advisor
/** last month's recurring income (§ / month: taxes and deals; one-offs such as loan money and refunds left out), the
 *  measure of a "healthy" surplus */
export function recurringIncome(st: Pick<CityState, 'budget'>): number {
  const inc = st.budget?.lastIncome;
  let income = 0;
  for (const k in inc) if (!k.startsWith('oneoff:')) income += inc[k] || 0;
  return income;
}

/** a service the advisors ask for, with the monthly upkeep the plop tip quotes for one more (the finance card's line) */
export interface ServiceQuote {
  /** the building's name ("Fire Station") */
  name: string;
  /** § / month (quotedUpkeep) */
  upkeep: number;
}

/** a footprint on the map: its origin and size (cells) */
export interface Lot { x: number; z: number; w: number; d: number }

/** a service an open advice asks for; `lot`: where its upkeep is quoted (null: the advice names no place, or no road
 *  runs near it — the city-wide estimate stands in) */
export interface AskedService { def: BuildingDef; lot: Lot | null }

/**
 * The building each service advice asks for (src/sim/economy/advisors.ts rule id → catalog id): what "Build a Fire
 * Station near here" tells the player to place — the cheapest kind where the text names two (a clinic or a hospital, a
 * college or a library), none of them locked behind a reward. Left out: advice whose fix depends on its wording
 * (schoolOvercrowded: the school's tier; plantFireReach: a road or a station; jailOvercrowded), and the utilities — a
 * town needs its power and water whatever its surplus.
 */
export const ASKED_SERVICE: Readonly<Record<string, string>> = {
  noFireResponse: 'civ_fire_station', noFire: 'civ_fire_station', plantNoFire: 'civ_fire_station',
  noPolice: 'civ_police_station', policeOverloaded: 'civ_police_station', crime: 'civ_police_station',
  noElementary: 'civ_elementary_school', noHigh: 'civ_high_school', noCollege: 'civ_library',
  seniorsHealth: 'civ_clinic', slowAmbulances: 'civ_clinic', hospitalOvercrowded: 'civ_clinic', hqLow: 'civ_clinic',
  playgrounds: 'park_playground', parks: 'park_small',
};

/** how far (cells, each way) from an advice's place a lot beside a road is looked for: a place is the middle of an
 *  8 × 8 block (uncoveredHotspots), the centre of the unserved people in one (unservedClusters) or a facility's own
 *  centre, so the roads of its block are in range */
const LOT_SEARCH = 6;

/**
 * The lot whose upkeep stands for an advice at cell (x, z): the footprint of `def` nearest to that cell — centred on a
 * cell as the plop tool centres one on the cursor (PlopTool.origin), unrotated — that lies on dry land off the networks
 * with a road along one of its sides. The place an advice names is the middle of a block as often as not, and a service
 * no road touches reaches nobody (placement.ts servedHere: its "Upkeep here" is the bare building's). Buildings on the
 * lot are not checked: the upkeep next door is the same. null: no such lot within LOT_SEARCH cells.
 */
export function serviceLot(st: CityState, def: Pick<BuildingDef, 'footprint'>, x: number, z: number): Lot | null {
  const N = st.size, [w, d] = def.footprint;
  const cx = Math.round(x) - ((w - 1) >> 1), cz = Math.round(z) - ((d - 1) >> 1);
  let best: Lot | null = null, bestDist = Infinity;
  for (let dz = -LOT_SEARCH; dz <= LOT_SEARCH; dz++) {
    for (let dx = -LOT_SEARCH; dx <= LOT_SEARCH; dx++) {
      const dist = dx * dx + dz * dz;
      const x0 = cx + dx, z0 = cz + dz;
      if (dist >= bestDist || x0 < 0 || z0 < 0 || x0 + w > N || z0 + d > N) continue;
      let dry = true;
      for (let zz = z0; zz < z0 + d && dry; zz++) for (let xx = x0; xx < x0 + w && dry; xx++) dry = !st.water[zz * N + xx] && st.network[zz * N + xx] === Network.None;
      if (!dry || !lotTouchesRoad(st, x0, z0, w, d)) continue;
      best = { x: x0, z: z0, w, d };
      bestDist = dist;
    }
  }
  return best;
}

/**
 * The services the open issues ask for, one entry per building in the list's order (highest priority first), each with
 * the lot beside the first of its issues that names a place. By the advice's id — its ref when a variant's fix is
 * another rule's (OpenAdvice.ref) — never by its text.
 */
export function askedServices(st: CityState, open: readonly Pick<OpenAdvice, 'id' | 'ref' | 'x' | 'z'>[]): AskedService[] {
  const places = new Map<string, { x: number; z: number } | null>();
  for (const o of open) {
    const id = o.ref ?? o.id;
    if (!Object.prototype.hasOwnProperty.call(ASKED_SERVICE, id)) continue;
    const defId = ASKED_SERVICE[id];
    if (places.get(defId)) continue;
    places.set(defId, o.x !== undefined && o.z !== undefined ? { x: o.x, z: o.z } : null);
  }
  const out: AskedService[] = [];
  for (const [defId, at] of places) {
    const def = getDef(defId);
    if (def) out.push({ def, lot: at ? serviceLot(st, def, at.x, at.z) : null });
  }
  return out;
}

/**
 * The monthly upkeep (§, 100 % funding) the plop tip quotes for one more `def` (PlopTool.spotNotes): a facility that pays
 * running costs per person served costs `here` — its spot's "Upkeep here", the upkeepContext query's reply — and, while
 * that is null (no reply yet, no spot, no need raster), what one typically costs in this city (upkeepEstimate, the
 * build card's figure); any other building its catalog upkeep.
 */
export function quotedUpkeep(st: CityState | null, def: BuildingDef, here: number | null): number {
  const est = upkeepEstimate(st, def);
  return est ? here ?? est.now : def.upkeep ?? 0;
}
