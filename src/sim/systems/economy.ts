/**
 * Economy / growth systems (owned by the sim-core agent), in run order:
 *   land value → desirability → population (construction, occupancy, stats) → tourism (WP4) → demand → growth → budget
 *   → rewards / unlocks → approval (EQ/HQ) → advisors & news → history.
 * All share one EconRuntime (indices / scratch); persistent data lives in state.systemData.economy.
 */
import type { SimSystem } from '../Simulation';
import { EconRuntime } from '../economy/runtime';
import { landValueSystem } from '../economy/landValue';
import { desirabilitySystem } from '../economy/desirability';
import { populationSystem } from '../economy/population';
import { tourismSystem } from '../economy/tourism';
import { demandSystem } from '../economy/demand';
import { growthSystem } from '../economy/growth';
import { budgetSystem } from '../economy/budget';
import { rewardsSystem } from '../economy/rewards';
import { approvalSystem } from '../economy/approval';
import { advisorsSystem } from '../economy/advisors';
import { historySystem } from '../economy/history';

export function economySystems(): SimSystem[] {
  const rt = new EconRuntime();
  return [
    landValueSystem(rt),
    desirabilitySystem(rt),
    populationSystem(rt),
    tourismSystem(rt),
    demandSystem(rt),
    growthSystem(rt),
    budgetSystem(rt),
    rewardsSystem(rt),
    approvalSystem(rt),
    advisorsSystem(rt),
    historySystem(),
  ];
}

/** get the shared economy runtime from a simulation (profiling / UI helpers); undefined if not installed */
export function economyRuntime(systems: readonly SimSystem[]): EconRuntime | undefined {
  return (systems.find((s) => s.name === 'economy.population') as unknown as { rt?: EconRuntime } | undefined)?.rt;
}
