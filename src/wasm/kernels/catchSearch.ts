/**
 * roadTimeMulti / roadDistMulti of src/sim/infra/catchments.ts with the WebAssembly kernels (bit-identical; JS runs
 * whenever wasm is unavailable, disabled with ?simwasm=search:js, or the arguments are unusual). Integration: services.ts
 * imports these two functions from here instead of './catchments'.
 */
import * as js from '../../sim/infra/catchments';
import { DRIVE_COST, RAMP_COST, WALK_COST } from '../../sim/infra/params';
import { Network } from '../../core/types';
import { makeCatchmentSearchKernels } from './catchSearchBind';

export { catchSearchStats, makeCatchmentSearchKernels, type CatchSearchApi, type CatchSearchParams } from './catchSearchBind';

const k = makeCatchmentSearchKernels(js, { WALK_COST, DRIVE_COST, RAMP_COST, HIGHWAY: Network.Highway, STREET: Network.Street });
export const roadTimeMulti = k.roadTimeMulti;
export const roadDistMulti = k.roadDistMulti;
