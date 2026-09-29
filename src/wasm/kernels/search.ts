/**
 * src/sim/infra/search.ts with the WebAssembly kernels: drop-in replacement (same exports, bit-identical results; JS
 * runs whenever wasm is unavailable, disabled with ?simwasm=search:js / SIM_WASM=search:js, or the arguments are
 * unusual). `new Search()` returns a search whose arrays live in wasm memory (see searchBind.ts).
 */
import * as js from '../../sim/infra/search';
import { BUS_TIME_FACTOR, NET_TIME, RAMP_PENALTY, SUBWAY_TIME } from '../../sim/infra/params';
import { Network } from '../../core/types';
import { makeSearchKernels } from './searchBind';

export { SEARCH_KERNEL, makeSearchKernels, searchWasmStats, type SearchApi, type SearchParams } from './searchBind';
export type { TransitNet } from '../../sim/infra/search';

const k = makeSearchKernels(js, { NET_TIME, RAMP_PENALTY, SUBWAY_TIME, BUS_TIME_FACTOR, HIGHWAY: Network.Highway });
export const Search = k.Search;
export type Search = js.Search;
export const Seeds = k.Seeds;
export type Seeds = js.Seeds;
export const roadSearch = k.roadSearch;
export const transitSearch = k.transitSearch;
export const accumulate = k.accumulate;
