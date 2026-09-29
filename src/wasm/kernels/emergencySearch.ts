/**
 * ChunkedSearch / DispatchSearch of src/sim/infra/emergency.ts with the WebAssembly kernels (bit-identical; every
 * start / step / run falls back to an exact JS port on the same arrays when wasm is unavailable or disabled with
 * ?simwasm=search:js). Integration: emergency.ts constructs these classes (`new ChunkedSearch()`, `new
 * DispatchSearch()`) instead of its own.
 */
import { NET_TIME, RAMP_PENALTY } from '../../sim/infra/params';
import { Network } from '../../core/types';
import { makeEmergencySearchKernels } from './emergencySearchBind';

export { emergencySearchStats, makeEmergencySearchKernels, type ChunkedSearchLike, type DispatchSearchLike } from './emergencySearchBind';

const k = makeEmergencySearchKernels({ NET_TIME, RAMP_PENALTY, HIGHWAY: Network.Highway });
export const ChunkedSearch = k.ChunkedSearch;
export const DispatchSearch = k.DispatchSearch;
