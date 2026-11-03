import type { CityState } from '../sim/CityState';

/**
 * The replica brand. It lives in the save layer, below src/worker (worker/replica.ts imports save/serialize): the
 * replica sets it in `adopt`, and the save guards below refuse any state that carries it.
 */
export const REPLICA = Symbol('Metropolis replica');
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
