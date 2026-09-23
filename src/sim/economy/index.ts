/**
 * Public economy API for UI / meta / sim-infra (sim-core). Import from here rather than individual modules.
 *
 *  UI panels:   listRewards, listOrdinances, capHints, computeMonthlyBudget, loanOffer / maxLoanAmount,
 *               demandInfo (demand, caps, targets, cap-binding flags), econData (raw persistent data)
 *  sim-infra:   ordinanceEffect (effect keys documented in ordinances.ts), serviceEffectiveness, onStrike
 *  shared:      placeBuilding / removeBuilding (keep grid, map, milestones and events consistent)
 */
import type { CityState } from '../CityState';
import { econData } from './runtime';

export { econData, infraFlags, type EconData } from './runtime';
export { listRewards, REWARDS, REWARD_BY_ID, type RewardInfo, type RewardKind } from './rewards';
export { listOrdinances, ordinanceEffect, getOrdinance, ORDINANCES, blockedByOrdinance, type OrdinanceInfo } from './ordinances';
export { computeMonthlyBudget, serviceEffectiveness, onStrike, type BudgetBreakdown } from './budget';
export { loanOffer, maxLoanAmount, outstandingDebt, loanRate, type LoanOffer } from './loans';
export { capHints, taxFactor } from './demand';
export { placeBuilding, removeBuilding, demolishFee, frontHasRoad } from './buildings';
export { popMaxStage, desirMaxStage } from './growth';
export { residentCoverage } from './approval';
export { HISTORY_CAP } from './history';
export { CURRENCY, formatMoney } from './format';
export { networkCellCost, zoneCellCost, POWERLINE_COST, SUBWAY_COST, BRIDGE_COST_MUL, NETWORK_INFO, ZONE_COST } from './tuning';

export interface DemandInfo {
  /** displayed demand per DevType, −1..1 (same as stats.demand) */
  demand: number[];
  /** absolute demand (residents / jobs) per DevType, smoothed */
  absolute: number[];
  /** target capacity per DevType after caps and modifiers */
  target: number[];
  /** demand cap per DevType */
  cap: number[];
  /** true when the cap limits that DevType (show a "capped" badge) */
  capped: boolean[];
}

/** Everything the RCI demand panel needs. */
export function demandInfo(state: CityState): DemandInfo {
  const d = econData(state);
  return {
    demand: state.stats.demand.slice(),
    absolute: d.demandAbs.map(Math.round),
    target: d.target.slice(),
    cap: state.stats.demandCap.slice(),
    capped: d.capBinding.map((v) => v === 1),
  };
}
