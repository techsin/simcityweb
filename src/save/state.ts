import type { CityState } from '../sim/CityState';
import { REPLICA } from '../worker/replica';

export { REPLICA };
export type HostState = CityState & { readonly [REPLICA]?: true };
export type SavableCityState = CityState & { readonly [REPLICA]?: never };

export class ReplicaSaveError extends Error {
  constructor() {
    super('A simulation replica cannot be saved; use host.save or host.snapshot');
    this.name = 'ReplicaSaveError';
  }
}

export function assertSavableCity(state: HostState): asserts state is SavableCityState {
  if (state[REPLICA]) throw new ReplicaSaveError();
}
