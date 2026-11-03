# T033 — W1.1b recovery mirror against the loopback core

Branch `local/W1.1b-recovery`, base `local/W0-complete` at **0fe14c2**. Changes are **uncommitted**;
no push or queue `.done` file, as requested. The mirror and authoritative recovery seams are implemented and
typechecked. Runtime acceptance remains with the lead: Vitest cannot start in this sandbox.

Read WORKER_DESIGN §§1, 2.2, 4, 5.3 and R7/R14/O6; the W0.6 and W1.1a reports; recovery/city/brand code;
SimHost/SimCore save paths; loopbackCore, protocol, recorder; and the current bulldoze implementation.

## Change per file

| File | Change |
|---|---|
| `src/worker/recoveryMirror.ts` | New page-side mirror: cloned command arguments, explicit whitelist, failed-ack removal, idempotent ordinance sets, bulldoze ack charge, save/snapshot base transitions, synchronous LS plus immediate IDB journal write, half-reserve snapshot request, and city-signal disposal. |
| `src/worker/SimCore.ts` | Separate W1.1b block: build authoritative snapshots with the journal reserve; validate and replay a matching journal through `applyCommand` after init; preserve the recorded bulldoze net charge. Existing boot, command, local save and teardown behavior is unchanged. |
| `src/worker/SimHost.ts` | Separate type-only W1.1b block replaces the placeholder mirror interface with the implemented type. LocalSimHost still has `recovery = null`. |
| `src/save/recoveryCodec.ts` | Small support block: shared reserve, whitelist, the journal's optional bulldoze `cost`, and pure city/base/sequence validation. Existing delta encoding and CityRecord formats are unchanged. |
| `src/save/recoveryIdb.ts` | Small support block: read and discard mismatched journals; adopt a validated LS journal, including a newer edit list within the same millisecond. Existing snapshot APIs and cleanup are unchanged. |
| `src/save/recoveryLs.ts` | Small support hunk: expose journal JSON reading and re-export the reserve from the pure codec. Existing storage format, quota behavior and snapshot API remain intact. |
| `tests/worker/recovery.test.ts` | Seventeen focused cases against the unchanged LoopbackCore, real CityActions, and W0.6 storage/codec helpers. |
| `docs/dev/reports/local-W1.1b-recovery.md` | This report and merge contract. |

The three `src/save/recovery*.ts` support hunks are outside the strictly named new worker file/host paths.
They are needed to share the whitelist and budget without importing localStorage into SimCore, and to read/adopt
the journal slots W0.6 already writes. They are additive apart from relocating the reserve with its old export
preserved. No edit to `protocol.ts`, `recorder.ts`, `loopbackCore.ts`, T031's files, simulation algorithms, App,
CityScene, `cities.ts`, or the brand/refusal paths.

## Contract for the T032 merge

The base has no LoopbackSimHost. The test fixture supplies command/reply delivery around the existing LoopbackCore;
it does not invent or modify the concurrent lane's host. Attach the following after merging T032:

1. Construct `RecoveryMirror` with city identity, the actual loaded record's `savedAt`, command watermark,
   plain `RecoveryInfo`, an already opened KV, and **the city's signal**. Set `requestSnapshot` to request
   `host.snapshot('journal')`. The mirror installs no window/document listeners; W0.6 App already calls
   `recovery.writeNow` for unload/hidden/exit.
2. Call `onCommand(seq, op, args)` when posting, and `onAck(seq, result)` when applying the authoritative ack.
   In-flight commands remain journaled. Pass the real result, never the prediction. Ack `cells` are not retained.
3. Call `onSaving()` before issuing each FIFO save request. On success call `onSaved(savedAt, cmd, info)`;
   on failure call `onSaveFailed()`. A successful save clears the payload and binds the remaining edits to that
   save. The supplied `info` should describe the saved copy, not the state after an IDB await.
4. Cut `core.copyRecoverySnapshot(...)` and `cmd` in the same synchronous unit. Store its payload through
   `storeRecoveryIdb` during normal execution. Apply `onSnapped(marker, payload, cmd)` with the reply, after the
   packet log. It rejects another city, another save, a non-newer snapshot, or a regressed watermark.
5. For authoritative replay, identify/load the base, call `readRecoveryJournal(kv, base)`, and then
   `core.replayRecoveryJournal(journal, base)` after boot/init and before ticking. `base` holds only
   `{regionId, tileKey, savedAt, snapshot?}`. The result lists applied/failed sequences; a mismatched journal
   returns null. Snapshot reconstruction uses W0.6's pure codec on the authoritative side.

`onSaving` pins only the suffix needed by an outstanding save. This covers a snapshot delivered while an earlier
copy is being put: when that save completes, commands after its watermark must still exist to form a save-based
journal. Without an outstanding save, snapshots release covered commands immediately. FIFO failure/completion
releases the pin, so commands do not accumulate for the whole session when autosave is disabled.

**Protocol/recorder requests (not edited here):**

- Preserve the ack's `cost` and, when T026 is merged, its `refund`/`refundNote`; the existing `encodeAck` only
  removes `cells`, which is sufficient for this base. Add the optional bulldoze journal `cost` to the canonical
  `Journal.ops` type when consolidating the protocol. This lane uses the structurally compatible
  `RecoveryJournal` extension, so structured clones and W0.6 storage already preserve it.
- `ready.savedAt` must be the loaded/completed record timestamp. W1.1a's `ChangeRecorder.ready()` currently uses
  the newly serialized ready snapshot's timestamp; that is not a recovery base identity. The T033 fixture takes
  the identity from the stored record instead. Save/snapshot replies must retain their copy's command watermark.

## Tests by name

All are in `tests/worker/recovery.test.ts`, suite **RecoveryMirror**:

1. `restores a loopback snapshot plus the journal at the snapshot day`
2. `restores from the journal alone after save then unload, including an unacknowledged edit`
3. `drops snapshots from older saves, other cities, and older command watermarks`
4. `drops the payload on a delayed saved reply and keeps edits newer than that copy`
5. `keeps the snapshot and journal when a full save fails`
6. `discards a journal when the stored record changed, including a LocalSimHost save`
7. `replays historic and ordinance toggles as idempotent sets`
8. `journals only the explicit op whitelist and rejects excluded ops at replay too`
9. `replays every whitelisted action in FIFO order with the same city and RNG`
10. `removes failed acks, copies posted arguments, and drops commands that fail on the earlier base`
11. `carries the bulldoze ack charge and preserves it when the replay quote changes`
12. `fits payload plus journal in the reserve and uses IDB when the LS journal is missing`
13. `requests a snapshot at half the reserve and writes an oversized journal to IDB only`
14. `adopts the newer LS edit list when an IDB unload write failed at the same timestamp`
15. `carries replayed edits after a failed boot save and trims them at the first successful save`
16. `writes without serializing or retaining a recovery city, and stops on city abort`
17. `refuses the actual loopback replica at all three save entry points`

The existing `tests/save/recoveryIdb.test.ts` case **issues the IDB put and explicit commit before yielding,
and waits for transaction completion** covers the real KV wrapper's journal `commit()` behavior. The new mirror
tests check that its journal put starts synchronously. No timer sleeps establish ordering; timestamps are explicit.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | Pass. |
| `git diff --check` | Pass. |
| `npx vitest run tests/worker/recovery.test.ts --maxWorkers=1` | Blocked before collection: Vite `externalize-deps`, `spawn EPERM` in `optimizeSafeRealPathSync` / `windowsSafeRealPathSync`, through the shared `simcityweb-W11a/node_modules`. No runtime pass claimed. |
| Full Vitest, including save/host/hygiene regressions | Not run; lead's machine gate. |
| 128×15 seed-7 bot: **196,101 in 2015** | Not run; lead's machine gate. No simulation algorithm or normal command path changes. |
| Browser, old-save continuation, kill-tab/unload survival | Not run; lead's machine gates. |

## Design versus this base / boundaries

- **FH-07a is absent.** `ActionResult` and bulldoze expose neither `refund` nor `refundNote`; only signed net
  `cost`. That authoritative amount is journaled. A successful replay reconciles its funds/monthly net charge to
  that amount; no wall-clock refund window is recomputed. The old result cannot reconstruct a separate gross
  fee/refund breakdown. Unacknowledged bulldozes have no known authoritative charge and use the replay result.
  T026 integration must extend the metadata when its fields exist; simulation files were not patched here.
- **O6:** the mirror accepts no CityState or SerializedCity, calls no serializer/deserializer, and retains no
  recovery base city. It keeps identifiers, UI metadata, encoded bytes, and commands. The authoritative loopback
  core continues using W0.6's existing recovery-base owner; no second base is introduced on the page.
- **R14:** no real-worker wiring or W1.2 journal is introduced. Worker persistence remains T034's `'main'` lane.
- **W1.3 restoration/boot is still separate.** W0.6's public title-screen finder/restore composition is snapshot-only.
  Its `restoreRecoverySnapshot` saves and deletes recovery; it does not atomically rebind a journal. `KV` has no
  multi-store transaction API for that §4.3 operation. Those APIs are deliberately unchanged. The new tests rebuild
  the selected snapshot on the authoritative side and replay its matching journal before saving; they do not
  claim to test the future title-screen transaction. W1.3 must add journal-only offers, atomic snapshot rebind,
  and the replay-save-before-ready handshake before enabling that UI. `readLsJournal`/`adoptRecoveryJournal` are
  the reusable adoption pieces, not an automatic title-screen integration.
- The mirror accepts a matching, renumbered `ready.journal` for a failed boot save; creating that message and
  performing the boot save remain the future persistence owner's job. A normal completed core save already
  deletes old IDB journals, and the new base validation rejects late stale copies after LocalSimHost saves.
- W0.6's codec budgets typed-array delta data; metadata/primary-only oversized snapshots can still exceed the
  reserve-adjusted limit. The existing LS writer refuses those payloads and keeps the normally stored IDB copy.
  It also marks journals larger than 128 KiB IDB-only. The mirror requests another snapshot at half the reserve;
  scheduling the min(30 s, 90 sim days) cadence remains the host/App integration, outside this lane.

Runtime behavior, the actual T032 packet integration, atomic W1.3 restore, real-worker recovery, and browser unload
durability could not be verified here. None of those is presented as a completed runtime gate.

## Cloud carry-over (Nov 3)

The desktop stopped mid-integration. The cloud lane finisher took over on `cloud/t033`, from `local/W1.1b-recovery`
(b777b79) with dev `923428d` merged in (no conflicts). Everything above was written before T031, T032 and T026 merged,
against a base without `LoopbackSimHost`; it was re-run and re-checked here, not trusted.

### Gap list (required versus done, before this carry-over)

Read: the task file; NOTE-032, NOTE-037, NOTE-038 and NOTE-044 (the NOTEs that name T033); WORKER_DESIGN §4.1-§4.5,
§5.3's `recovery.test.ts` row, §6's W1.1 and W1.3 rows, R7 and O6; POLISH_PLAN FH-07a with its Acceptance and Risk;
the T031 and T032 reports' T033 hand-offs; this report; the diff against dev.

| # | Required | State on the desktop branch |
|---|---|---|
| G1 | `SimHost.recovery` stays the page's narrow `writeNow` seam | **Broken.** The lane re-exported its whole mirror class as `SimHost.RecoveryMirror`; with T032 merged, tsc fails twice (PacketSimHost's writer, loopbackHost.test's stub). |
| G2 | The mirror wired into the host: posts, acks, saves (`onSaving`, `saved`, failures), snapshots and resync | **Missing.** The mirror exists only as a unit; no host constructs or feeds it. In `?simworker=loopback` the page has no journal, and PacketSimHost's `snapped` handler writes localStorage without a journal (`storeRecoveryLs(marker, payload)`), which deletes any LS journal. |
| G3 | The loopback core replays a journal bound to its loaded save after init and before the first tick (§4.3) | **Missing.** `SimCore.replayRecoveryJournal` exists, but nothing calls it; tests call it by hand. |
| G4 | FH-07a: a bulldoze carries the refund it was charged | **Partial.** Written before T026: it keeps the ack's net `cost` only and books any difference on one line. With FH-07a merged the ack has `refund`; a replay at the base's day re-dates the refund rule (a day-20 bulldoze becomes a same-day one), so the gross refund must be carried and both budget lines reconciled. |
| G5 | Excluded ops never journaled, including `holdCalendar` (NOTE-041 / T031: on the wire, not in `JournalOp`) | **Partial.** The whitelist excludes it, but no test names it. |
| G6 | The snapshot budget reserves the journal through one shared constant | **Duplicated.** T032's ProtocolInbox builds snapshots with a literal `128 * 1024`; the lane added a second builder (`SimCore.copyRecoverySnapshot`) that no host uses. |
| G7 | A save or snapshot reply in a packet dropped by a resync | **Gap (T032 x T033).** The resync rejects those requests as "interrupted" although the write happened: the mirror never learns the new base (its journal stays bound to a replaced save and is discarded at restore), and the app reports "Saving failed". |
| G8 | Restoring: the localStorage journal is moved into IndexedDB at title time "as today" (§4.3 Restoring) | **Missing.** `findRecoverySnapshot` adopts only a payload and then clears the whole LS slot, journal included. |
| G9 | `recovery.test.ts` as §5.3 lists it | **Unit level only**, all 17 against a hand-driven core; no case through `LoopbackSimHost`. Never run on the desktop (Vitest could not start there). |
| G10 | tsc, the full vitest, the bot at 196,101 | **Not run** (tsc now fails, G1). |

Out of scope, left to T039 (W1.3) as the plan rows say: the worker's own journal read and boot replay with the
save-before-ready handshake, `LocalSimHost`'s boot replay, the title screen's journal-only offer, and the snapshot
cadence of min(30 s, 90 sim days).
