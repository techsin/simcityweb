/** fake-idb.mjs: the IndexedDB calls of journal.mjs's page read, over a store with get(store, key). */
export function fakeIndexedDB(
  kv: { get(store: any, key: string): Promise<unknown> },
  options?: { exists?: boolean; fail?: Error | null },
): { opened: { name: string; closed: boolean }[]; open(name: string): unknown };
