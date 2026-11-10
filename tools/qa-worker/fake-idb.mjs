/**
 * Selftests only: the few IndexedDB calls journal.mjs's page read makes (open, one read-only transaction, get), over a
 * store with `get(store, key)`: the tests' KV, which is also what the hosts under test write. `exists: false` is a
 * browser without the App's database (open asks for an upgrade); `fail` rejects every get.
 */
export function fakeIndexedDB(kv, { exists = true, fail = null } = {}) {
  const opened = [];
  return {
    opened,
    open(name) {
      const request = { result: null, error: null, transaction: null };
      queueMicrotask(() => {
        if (!exists) {
          // the read aborts the upgrade it did not ask for, and the open then fails
          request.transaction = { abort() { queueMicrotask(() => { request.error = new Error('the upgrade was aborted'); request.onerror?.(); }); } };
          request.onupgradeneeded?.();
          return;
        }
        const db = { name, closed: false, close() { this.closed = true; } };
        db.transaction = (stores) => {
          const names = [stores].flat(), tx = { error: null }, reads = [];
          tx.objectStore = (store) => {
            if (!names.includes(store)) throw new Error(`NotFoundError: ${store} is outside the transaction`);
            return { get(key) {
              const read = { result: undefined };
              reads.push(Promise.resolve().then(() => { if (fail) throw fail; return kv.get(store, key); }).then((value) => { read.result = value; }));
              return read;
            } };
          };
          // after the caller's synchronous gets, as a real transaction completes once its requests have
          queueMicrotask(() => Promise.all(reads).then(() => tx.oncomplete?.(), (e) => { tx.error = e; tx.onabort?.(); }));
          return tx;
        };
        opened.push(db);
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    },
  };
}
