/**
 * The recovery-mirror row: what W1.3 stores when the page goes away (WORKER_DESIGN §4.3; docs/dev/reports/cloud-W1.3.md).
 *
 * A packet host's page keeps T033's journal mirror, bound to the last save or to the last snapshot of that save. The
 * App's pagehide writes it synchronously: localStorage's marker and journal, and a small IndexedDB record
 * `recovery/<regionId>:<tileKey>#journal`. The next boot replays the IndexedDB record:
 *  - loopback: the page's core reads it;
 *  - worker, persistence 'worker-idb': the worker reads it from its own connection to the same database, where it also
 *    wrote the save and the snapshot the journal is bound to;
 *  - worker, persistence 'main' (its IndexedDB fell back to memory): main reads it and passes it in `init.journal`, and
 *    main stored that save and snapshot.
 * So with a store that persists the row is the same on every packet host: the edit is in both copies, and both are
 * bound to records IndexedDB really holds (a journal bound to anything else is discarded at boot). Without a store that
 * persists nothing survives a reload: the App writes no recovery data, a worker host has no mirror (W1.3 decision 6),
 * and the row is skipped with that reason. LocalSimHost recovers from snapshots and has no journal.
 */
import { assert } from './harness.mjs';

/** Never journaled (§4.3 "Excluded ops"; holdCalendar is the New Year's own op): not city state, or not replayable. */
export const JOURNAL_EXCLUDED = ['setSpeed', 'resume', 'setCamera', 'dispatch', 'dispatchBest', 'dismissAlert', 'setSettings', 'triggerDisaster', 'holdCalendar'];

/** Page side: which recovery path this city runs on. Read-only. */
export function recoveryMode() {
  const app = window.__metropolis, city = app.city, host = city.scene.host;
  return {
    kind: host.kind,
    // WorkerSimHost only: who writes the city's saves and snapshots
    persistence: typeof host.persistence === 'string' ? host.persistence : null,
    // App.persistent: the page's store survives a reload (IndexedDB, not the in-memory fallback)
    storePersistent: typeof app.persistent === 'boolean' ? app.persistent : null,
    // SimHost.recovery: the page's journal mirror, which the App's unload handlers write
    mirror: host.recovery != null,
    regionId: app.region?.data?.id ?? null, tileKey: city.tile?.key ?? null,
  };
}

/** Page side: the App's own pagehide handler writes the mirror; returns the localStorage slot it left. The pageshow
 *  that follows tells the App the page is not unloading after all. No city serialization or command bypass. */
export function writeAtPagehide() {
  const read = (key) => JSON.parse(localStorage.getItem(key) ?? 'null');
  try {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    return { journal: read('metropolis.recovery.journal'), marker: read('metropolis.recovery') };
  } finally { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); }
}

/**
 * Page side: the city's recovery records in IndexedDB, through a connection of the harness's own (the worker's
 * records are in the same origin's database). The journal record whole; with `base`, also the snapshot record's marker
 * and the stored save's `savedAt`, which a journal has to be bound to. Never rejects: a failure comes back as `error`.
 */
export function readRecoveryIdb({ regionId, tileKey, base = false }) {
  return new Promise((resolve) => {
    const key = `${regionId}:${tileKey}`, out = { key, journal: null, snapshot: null, savedAt: null };
    let open;
    try { open = indexedDB.open('metropolis'); }
    catch (e) { resolve({ ...out, error: `open: ${e?.message ?? e}` }); return; }
    // the App created the database: an upgrade here means it does not exist, and this read must not create it
    open.onupgradeneeded = () => open.transaction.abort();
    open.onerror = () => resolve({ ...out, error: `open: ${open.error?.message ?? 'failed'}` });
    open.onsuccess = () => {
      const db = open.result;
      const done = (extra) => { db.close(); resolve({ ...out, ...extra }); };
      try {
        const tx = db.transaction(base ? ['recovery', 'cities'] : ['recovery'], 'readonly');
        const journal = tx.objectStore('recovery').get(key + '#journal');
        const snapshot = base ? tx.objectStore('recovery').get(key) : null;
        const city = base ? tx.objectStore('cities').get(key) : null;
        tx.oncomplete = () => {
          const m = snapshot?.result?.marker;
          done({ journal: journal.result ?? null, savedAt: city?.result?.savedAt ?? null,
            snapshot: m ? { at: m.at, baseSavedAt: m.baseSavedAt, regionId: m.regionId, tileKey: m.tileKey, bytes: m.bytes } : null });
        };
        tx.onabort = () => done({ error: `read: ${tx.error?.message ?? 'transaction aborted'}` });
      } catch (e) { done({ error: `read: ${e?.message ?? e}` }); }
    };
  });
}

/**
 * Why this host or mode has no journal to check (the row's SKIPPED text), or null when the row must run. Where W1.3
 * keeps a journal, a host without the mirror throws: that is a failure, never a skip.
 */
export function journalSkip(host, mode) {
  if (host === 'local') return 'LocalSimHost uses snapshot recovery; the command journal belongs to packet hosts';
  assert(mode?.kind === host, `recovery mode read failed or the page runs another host: ${JSON.stringify(mode)}`);
  assert(typeof mode.storePersistent === 'boolean', 'App.persistent is not readable: update recoveryMode() against src/main.ts');
  if (host === 'worker') {
    assert(mode.persistence === 'worker-idb' || mode.persistence === 'main',
      `WorkerSimHost.persistence reads ${JSON.stringify(mode.persistence)}; W1.3 has 'worker-idb' and 'main'`);
    assert(mode.storePersistent || mode.persistence === 'main', "the worker cannot run 'worker-idb' while the page's store is in memory");
  }
  if (!mode.storePersistent) {
    return `no journal by design: the page's store does not persist (IndexedDB fell back to memory), so nothing survives a reload and the App writes no recovery data at pagehide${
      host === 'worker' && !mode.mirror ? "; W1.3 then runs persistence 'main' without a journal mirror (cloud-W1.3 decision 6)" : ''}`;
  }
  assert(mode.mirror, `the page's store persists, so W1.3 keeps the journal mirror on this ${host} host${mode.persistence ? ` (persistence '${mode.persistence}')` : ''}, but host.recovery is null`);
  assert(mode.regionId && mode.tileKey, `the city's region and tile are not readable: ${JSON.stringify(mode)}`);
  return null;
}

/** the row's label for the mode, and who wrote the journal's base and replays the journal at the next boot */
const modeLabel = (host, mode) => host === 'worker' ? `worker, persistence '${mode.persistence}'` : host;
const owner = (host, mode) => host === 'loopback' ? 'the loopback core wrote it and replays the journal at boot'
  : mode.persistence === 'worker-idb' ? 'the worker wrote it on its own connection and replays the journal at boot'
    : "main stored it and passes the journal in init.journal: the worker's IndexedDB was unavailable";
const sameBase = (a, b) => a?.kind === b?.kind && a?.savedAt === b?.savedAt && a?.at === b?.at && a?.baseSavedAt === b?.baseSavedAt;

/**
 * The row's verdict from what one pagehide left: `ls` (writeAtPagehide) and `idb` (readRecoveryIdb with `base`), for
 * the UI edit `{seq, op}` made just before. Returns the PASS text or throws.
 *
 * An error with `rebased` says the journal's base and the stored records disagree. A save or a snapshot that lands
 * between the edit and the reads does that once, legitimately (the edit is then in the new base, and the copies were
 * read on either side of it); the caller repeats the edit once, and a second such error is the failure.
 */
export function journalVerdict({ host, mode, edit, ls, idb }) {
  const moved = (reason) => Object.assign(new Error(reason), { rebased: true });
  const holds = (journal) => journal.ops.some((op) => op.seq === edit.seq && op.op === edit.op);
  const journal = ls?.journal, marker = ls?.marker;
  assert(journal?.v === 1 && Array.isArray(journal.ops), `pagehide wrote no journal to localStorage (metropolis.recovery.journal)${
    marker?.journalIdbOnly ? '; its marker says the journal outgrew the localStorage reserve and went to IndexedDB alone, which this short fixture should never reach' : ''}`);
  if (!holds(journal)) {
    // every command up to fromCmd is in the base itself: a snapshot or save taken after the edit holds it
    if (Number.isSafeInteger(journal.fromCmd) && journal.fromCmd >= edit.seq) {
      throw moved(`the journal's ${journal.base?.kind} base already contains the UI edit (seq ${edit.seq}, fromCmd ${journal.fromCmd}), so the journal no longer lists it`);
    }
    throw new Error('pagehide did not journal the UI edit');
  }
  assert(journal.ops.every((op, i) => op.seq > journal.fromCmd && (!i || op.seq > journal.ops[i - 1].seq)), 'journal suffix has invalid watermarks/order');
  const excluded = journal.ops.filter((op) => JOURNAL_EXCLUDED.includes(op.op)).map((op) => op.op);
  assert(!excluded.length, `journal retained an excluded command: ${excluded.join(', ')}`);
  assert(journal.regionId === mode.regionId && journal.tileKey === mode.tileKey,
    `journal names ${journal.regionId}:${journal.tileKey}, the city is ${mode.regionId}:${mode.tileKey}`);
  const base = journal.base, snapshot = base?.kind === 'snapshot', savedAt = snapshot ? base.baseSavedAt : base?.savedAt;
  assert((snapshot ? Number.isFinite(base.at) : base?.kind === 'save') && Number.isFinite(savedAt), `journal has no valid base: ${JSON.stringify(base)}`);
  // the marker is how the title screen finds the slot: a journal alone, or the snapshot the journal extends
  assert(marker?.regionId === mode.regionId && marker.tileKey === mode.tileKey, `localStorage marker (metropolis.recovery) is missing or names another city: ${JSON.stringify(marker)}`);
  assert(marker.kind === (snapshot ? 'snapshot' : 'journal') && marker.baseSavedAt === savedAt && marker.at === (snapshot ? base.at : journal.at),
    `localStorage marker ${JSON.stringify({ kind: marker.kind, at: marker.at, baseSavedAt: marker.baseSavedAt })} does not describe the journal (at ${journal.at}) and its base ${JSON.stringify(base)}`);

  assert(!idb?.error, `IndexedDB could not be read: ${idb?.error}`);
  const name = `recovery/${idb?.key}#journal`, stored = idb?.journal;
  assert(stored?.v === 1 && Array.isArray(stored.ops), `pagehide left no journal record in IndexedDB (${name}), which W1.3 writes wherever the page's store persists`);
  if (!sameBase(stored.base, base) || stored.fromCmd !== journal.fromCmd) {
    throw moved(`IndexedDB ${name} is bound to ${JSON.stringify(stored.base)} from command ${stored.fromCmd}, the localStorage copy to ${JSON.stringify(base)} from command ${journal.fromCmd}`);
  }
  assert(holds(stored), `IndexedDB ${name} does not hold the UI edit that the localStorage copy holds`);
  // bound to records the database holds: the next boot discards a journal bound to anything else
  if (idb.savedAt !== savedAt) throw moved(`the journal is bound to the save of ${savedAt}, but IndexedDB cities/${idb.key} holds the save of ${idb.savedAt}`);
  if (snapshot && (idb.snapshot?.at !== base.at || idb.snapshot.baseSavedAt !== savedAt)) {
    throw moved(`the journal is bound to the snapshot of ${base.at}, but IndexedDB recovery/${idb.key} holds ${JSON.stringify(idb.snapshot)}`);
  }
  return `${modeLabel(host, mode)}: App pagehide wrote ${journal.ops.length} whitelisted edits bound to ${base.kind}; UI ${edit.op} seq ${edit.seq} retained in localStorage and in IndexedDB ${name}; `
    + `IndexedDB holds that ${snapshot ? 'snapshot and its save' : 'save'} (${owner(host, mode)})`;
}
