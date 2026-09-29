/**
 * The simulation modules the traffic driver needs (src/wasm/kernels/trafficDriver.ts TrafficDriverDeps), from the
 * benchmark tree: the imports below are redirected into the frozen 24f8609 tree by plugins.mjs (--tree snap).
 */
import { Network } from '../../../src/core/types';
import * as params from '../../../src/sim/infra/params';
import * as common from '../../../src/sim/infra/common';
import * as graph from '../../../src/sim/infra/graph';
import * as transit from '../../../src/sim/infra/transit';
import { workerShare } from '../../../src/sim/economy/demographics';
import { REGION_JOBS_FOR_RESIDENTS } from '../../../src/sim/economy/tuning';
import { BF } from '../../../src/sim/CityState';
import type { TrafficDriverDeps } from '../../../src/wasm/kernels/trafficDriver';
import { trafficParams, type TrafficParams } from '../../../src/wasm/kernels/trafficLayout';
import { makeFairSearch, type FairSearch } from '../../../src/wasm/js/roadTransitSearch';

export const deps = { Network, params, common, graph, transit, workerShare, REGION_JOBS_FOR_RESIDENTS, BF } as unknown as TrafficDriverDeps;
export const P: TrafficParams = trafficParams(params as never, Network as never);
export const fairSearch: FairSearch = makeFairSearch({
  NET_TIME: params.NET_TIME, RAMP_PENALTY: params.RAMP_PENALTY, SUBWAY_TIME: params.SUBWAY_TIME, BUS_TIME_FACTOR: params.BUS_TIME_FACTOR, HIGHWAY: Network.Highway,
});
