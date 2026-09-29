/**
 * Population aggregate PROBE bound to the live constants (benchmark only — the probe answers "layout vs language" for
 * the population system; nothing in the sim calls it). See tools/bench/populationAggregateProbe.bench.mjs.
 *
 *   POPAGG_CONSTANTS   the constants of the probed loop, read from the live tuning / types / CityState modules
 *   popAggSoAJs        arm C: the JS loop over the building SoA (src/wasm/js/populationAggregateProbe.ts)
 *   popAggSoAWasm      arm D: the wasm kernel (populationAggregateProbeBind.ts), falling back to popAggSoAJs
 *   makeDefIndex()     arm B's def-index cache over the live catalog (getDef)
 */
import { BF } from '../../sim/CityState';
import { DEV_TYPE_COUNT, DevType } from '../../core/types';
import { COARSE, COHORT_BASE, WORKFORCE_RATIO } from '../../sim/economy/tuning';
import { getDef } from '../../sim/catalog';
import { DefIndex, aggregateSoA, type PopAggConstants } from '../js/populationAggregateProbe';
import { makePopAggKernels, type PopAggSoAFn } from './populationAggregateProbeBind';

export { POPAGG_KERNEL, makePopAggKernels, type PopAggBindStats, type PopAggSoAFn, type PopAggWasm } from './populationAggregateProbeBind';

export const POPAGG_CONSTANTS: PopAggConstants = {
  COARSE,
  WORKFORCE_RATIO,
  COHORT_BASE,
  DEV_TYPE_COUNT,
  R_MAX: DevType.R3,
  MASK_SKIP: BF.Abandoned | BF.Burnt,
  MASK_CONSTR: BF.Constructing,
};

/** arm C over the live constants */
export const popAggSoAJs: PopAggSoAFn = (soa, inp, g, t, coh, out) => aggregateSoA(soa, POPAGG_CONSTANTS, inp, g, t, coh, out);
/** arm D (wasm when available, else popAggSoAJs) */
export const popAggSoAWasm: PopAggSoAFn = makePopAggKernels(POPAGG_CONSTANTS, popAggSoAJs);

/** a def index over the live catalog */
export function makeDefIndex(): DefIndex {
  return new DefIndex((id) => getDef(id), DEV_TYPE_COUNT);
}
