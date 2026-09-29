/**
 * The simulation modules the traffic driver needs (src/wasm/kernels/trafficDriver.ts TrafficDriverDeps), from the
 * benchmark tree: the imports below are redirected into the frozen 24f8609 tree by plugins.mjs (--tree snap).
 * The module namespaces are copied into PLAIN objects: a bundler's namespace object exposes live bindings through
 * getters, which would add a getter call to every helper call in the driver's building walk (the original traffic.ts
 * calls its imports directly).
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

const plain = <T extends object>(ns: T): T => ({ ...ns });

export const deps = {
  Network: plain(Network as unknown as object), params: plain(params), common: plain(common), graph: plain(graph), transit: plain(transit),
  workerShare, REGION_JOBS_FOR_RESIDENTS, BF: plain(BF as unknown as object),
} as unknown as TrafficDriverDeps;
export const P: TrafficParams = trafficParams(params as never, Network as never);
export const fairSearch: FairSearch = makeFairSearch({
  NET_TIME: params.NET_TIME, RAMP_PENALTY: params.RAMP_PENALTY, SUBWAY_TIME: params.SUBWAY_TIME, BUS_TIME_FACTOR: params.BUS_TIME_FACTOR, HIGHWAY: Network.Highway,
});
