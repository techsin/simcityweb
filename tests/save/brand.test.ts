import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveCity } from '../../src/save/cities';
import { setKV } from '../../src/save/db';
import { writeRecoverySnapshot } from '../../src/save/recovery';
import { serializeCity } from '../../src/save/serialize';
import { REPLICA, ReplicaSaveError, type HostState } from '../../src/save/state';
import type { CityState } from '../../src/sim/CityState';
import { LoopbackCore } from '../../src/worker/loopbackCore';
import { PersistentMemoryKV, smallCity } from './fixtures';

const info = { cityName: 'Replica', population: 0, funds: 0 };
// Checked by tsc, never invoked: callers cannot serialize even a possibly branded host state.
function typeRefusals(state: HostState): void {
  // @ts-expect-error host.state may be a replica
  serializeCity(state);
  // @ts-expect-error host.state may be a replica
  void saveCity('r', 't', state);
  // @ts-expect-error host.state may be a replica
  writeRecoverySnapshot('r', 't', state, info);
}
void typeRefusals;
afterEach(() => vi.restoreAllMocks());

describe('replica save refusals', () => {
  it('rejects the actual W1.1a replica at all three entry points, even after a cast', async () => {
    const kv = new PersistentMemoryKV(); setKV(kv);
    const put = vi.spyOn(kv, 'put'), loop = new LoopbackCore(smallCity(), { modules: {} });
    try {
      const replica = loop.replica.state;
      expect(replica[REPLICA]).toBe(true);
      expect(Object.getOwnPropertyDescriptor(replica, REPLICA)?.enumerable).toBe(false);
      const cast = replica as CityState;
      expect(() => serializeCity(cast)).toThrow(ReplicaSaveError);
      await expect(saveCity('r', 't', cast)).rejects.toThrow(ReplicaSaveError);
      expect(() => writeRecoverySnapshot('r', 't', cast, info)).toThrow(ReplicaSaveError);
      expect(put).not.toHaveBeenCalled();
      expect(() => serializeCity(loop.primary)).not.toThrow();
    } finally { loop.dispose(); }
  });
});
