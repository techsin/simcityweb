/** The authoritative side's IndexedDB store (§4.2, §4.3): the loopback core writes it as LocalSimHost does, and W1.3's
 *  worker with persistence 'worker-idb' on its own connection. A save's put sets this realm's recovery base and deletes
 *  the snapshot and journal records it makes obsolete (the IDB part of clearRecoveryAfterSave). Kept out of
 *  protocolInbox.ts, whose writes go through whichever store the transport injects (R14's 'main' among them). */
import { getRecoveryBase } from '../save/cities';
import { openKV } from '../save/db';
import { storeRecoveryIdb } from '../save/recoveryIdb';
import type { InboxStore } from './protocolInbox';
import type { SimCore } from './SimCore';

export function idbStore(core: SimCore): InboxStore {
  return {
    putSave: async (copy) => ({ recoveryDropped: await core.putSave(copy) }),
    putSnapshot: async ({ marker, payload }) => { const kv = await openKV(); await storeRecoveryIdb(kv, marker, payload); return kv.persistent; },
    recoveryBase: getRecoveryBase,
  };
}
