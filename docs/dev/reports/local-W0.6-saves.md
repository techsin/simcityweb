# local-W0.6-saves — saves through the host (T020, NOTE-031)

Implementation complete on `local/W0.6-saves`, based on `93069fa`. Changes are uncommitted. TypeScript and
`git diff --check` pass. Runtime gates remain pending: Vitest cannot start in this sandbox (`spawn EPERM`),
so this report does **not** claim the suite, bot, browser checks, or five consecutive runs under load passed.

Read: WORKER_DESIGN §§1, 4, 5.3, 6, Appendix A and R6/R7/R14; the W0.1–W0.5 and integration reports;
the save code/tests, App, CityScene, BudgetPanel, SimHost and SimCore. The applicable bot reference from the
brief/integration is **196,101 in 2015**, superseding T020's older 194,432 reference.

## Result and ownership

`LocalSimHost` remains the only playable host. Its FIFO `save` captures a copied city record, fingerprint,
summary, command watermark and dirty-event counter before any IDB await. Successful puts advance the recovery
base, clear obsolete IDB/localStorage recovery, and acknowledge the captured values. App uses those values
for its clean state and region summary; thumbnail generation stays on main. Camera commands precede saves.

`snapshot` finishes local encoding and localStorage persistence synchronously before returning its promise,
including beforeunload/pagehide. Its metadata describes that snapshot. App still skips unchanged snapshots,
and only acknowledges a successful snapshot. An idle callback retained from a previous city cannot snapshot
the next city. Local exit retries remain through the host; the non-local branch never re-saves a replica.

The existing W1.1a non-enumerable brand is shared, not duplicated. `host.state` is `HostState`; all three
serialization entry points reject that type and throw `ReplicaSaveError` for an actual branded object,
including a cast. No simulation algorithm, command tag/gesture, query, watch, view, guard holder, null view,
or `abort('dispose')` path was replaced. The new dirty listeners use the scene signal and host disposal.
Late scene save/exit acknowledgements cannot revive an exited scene.

## Change per file

| File | Change |
|---|---|
| `src/main.ts` | Uses host save/snapshot/recovery APIs for every active-city persistence path; ack-based clean state and tile summary; camera before App saves; stale idle/save-queue guards; placeholder gets a local host. |
| `src/game/CityScene.ts` | Passes persistence identity to the host; carries manual/autosave/exit reasons through onSave; exposes existing camera storage to App; guards disposed saves and exits. |
| `src/ui/panels/BudgetPanel.ts` | Deletes direct tax/funding writes from catch paths; failed host calls only log. |
| `src/worker/SimHost.ts` | Isolated W0.6 types, persistence options, FIFO save/synchronous snapshot, dirty counter and cleanup; optional boot modules preserve the no-systems placeholder. |
| `src/worker/SimCore.ts` | Isolated authoritative `copySave`/`putSave` block; only city/IDB helpers enter the persistence import graph. |
| `src/save/state.ts` | Shared brand, `HostState`, savable type, `ReplicaSaveError` and assertion. |
| `src/save/serialize.ts` | Savable parameter and runtime brand refusal; serialization format/algorithm unchanged. |
| `src/save/cities.ts` | CityRecord/key, city get/put/load/save/delete, copied record creation and recovery-base ownership. |
| `src/save/index.ts` | Re-exports city and brand APIs; region import/export and compression remain here. |
| `src/save/fingerprint.ts` | Unchanged fingerprint algorithm and dirty-event list moved out of App. |
| `src/save/bundleCodec.ts` | Unchanged version-1 binary codec, without browser compression. |
| `src/save/bundle.ts` | Re-exports that codec; retains file packing and gzip helpers. |
| `src/save/recoveryCodec.ts` | Unchanged delta/XOR/string codecs; explicit-base, explicit-time snapshot builder; marker types and pure rebuild. |
| `src/save/recoveryIdb.ts` | Snapshot/journal puts, marker reads, adoption, validation and scoped deletion; IDB half of save cleanup. |
| `src/save/recoveryLs.ts` | Synchronous payload/marker/journal slot; marker-only peek, payload read, reserve handling and LS cleanup. |
| `src/save/recovery.ts` | Local composition and compatibility exports; awaited two-store cleanup; restore updates the stored recovery base. |
| `tests/save/fixtures.ts` | Small region/storage fixtures and explicit promise gates. |
| `tests/save/brand.test.ts` | Compile-time refusals and runtime refusals on the actual W1.1a replica. |
| `tests/save/bundleCodec.test.ts` | Frozen version-1 bytes, public re-exports, value round trip and buffer ownership. |
| `tests/save/cities.test.ts` | Record/load isolation and recovery-base updates only after successful puts. |
| `tests/save/fingerprint.test.ts` | Dirty plain edits/historic flags and read-only camera/derived-layer exclusion. |
| `tests/save/snapshotCodec.test.ts` | Pure builder timestamps/base identity, owned payload, lean/full rebuild. |
| `tests/save/recoveryIdb.test.ts` | Adoption/validation/deletion, delayed completion and real KV wrapper's explicit IDB commit. |
| `tests/save/recoveryLs.test.ts` | Synchronous writes, cheap peek, quota/corruption, journal reserve and scoped cleanup. |
| `tests/save/host.test.ts` | Captured acks, FIFO/failure, synchronous unload snapshots, cleanup ordering and signal lifetime. |
| `tests/save/recovery.test.ts` | Explicit clock, cheap region fixture, awaited cleanup; same-timestamp negative control. Existing lifecycle cases retained. |
| `tests/save/recoveryCodec.test.ts` | Pure bundle imports; same clock/fixture fix in the kill-tab lifecycle case. Existing legacy-byte tests retained. |
| `tests/game/citySaves.test.ts` | Real scene save/exit methods with deferred persistence, camera/reason ordering and late-reply guards. |
| `tests/game/panelCommands.test.ts` | Throwing host cannot write tax/funding state; aborted sliders stay silent. |
| `tests/worker/commands.test.ts` | Existing headless comparisons serialize the authoritative local sim, not HostState. |
| `tests/worker/localSimHost.test.ts` | Same adjustment for deterministic save/load continuation comparisons. |
| `tests/worker/views.test.ts` | Same adjustment for existing view-purity comparisons. |
| `tests/worker/hygiene.test.ts` | Enables both W0.6 gates and scans the split save modules for detaching APIs. |
| `docs/dev/reports/local-W0.6-saves.md` | This report, including the full moved-site inventory and pending gates. |
| `docs/dev/qa-W0.6-saves.md` | Browser checklist, including kill-tab recovery and lead-run acceptance gates. |

## Every moved persistence site

Before lines are from **93069fa**; after lines refer to this worktree. Unchanged entry triggers are included
where their downstream target changed. No active-city path in App calls a raw serializer or snapshot writer.

| Before | After |
|---|---|
| `main.ts:136` cityFingerprint | `save/fingerprint.ts:7`; App and core share it. |
| `main.ts:150` CHANGE_EVENTS | `save/fingerprint.ts:21`. |
| `main.ts:565` subscriptions / `:566`, `:720` cleanup | `worker/SimHost.ts:511` signal-bound counter; `:501` disposal. |
| `main.ts:212`, `:214`, `:216` hidden snapshot/save | `main.ts:189`, `:191`, `:193` → snapshotNow and saveCurrentCity('hidden') → host. |
| `main.ts:218` beforeunload | `main.ts:195` → `:605` mirror when present, otherwise `:611` local host snapshot. |
| `main.ts:219`, `:221` pagehide | `main.ts:196`, `:198` → the same synchronous host/mirror path. |
| `main.ts:613`, `:614` periodic idle/direct snapshot | `main.ts:588`, `:589` → `:611` host.snapshot('periodic'); idle callback checks its city. |
| `main.ts:634` raw snapshot writer | `main.ts:605`, `:611` → `worker/SimHost.ts:376` → `save/recovery.ts:33`. |
| `main.ts:587` currentState | `main.ts:562` reads host.state, never a saved App-owned state reference. |
| `main.ts:593` isDirty | `main.ts:568` reads host state/counter. |
| `main.ts:550` Scene onSave(state) | `main.ts:527` onSave ignores the state argument and forwards reason. |
| `main.ts:646` SaveStatus/manual save | `main.ts:627` → scene.save(false) or saveCurrentCity → host.save('manual'). |
| `main.ts:653` saveCurrentCity(state) | `main.ts:634` stores camera, then forwards reason. |
| `main.ts:659` saveCityState(state) | `main.ts:640` queues reason and checks the captured city/model. |
| `main.ts:675` saveCity | `main.ts:655` host.save → `worker/SimHost.ts:361` → `worker/SimCore.ts:113`, `:119`. |
| `main.ts:676`, `:677` clean bookkeeping | `main.ts:656`, `:657` from the saved copy's ack. |
| `main.ts:682` clearRecoveryAfterSave | `worker/SimCore.ts:122` IDB; `worker/SimHost.ts:369` LS; `main.ts:662` re-arms recovery from the result. |
| `main.ts:694` post-await summarizeCity | `worker/SimCore.ts:116` summary captured with copy → `main.ts:666`; thumbnail stays `main.ts:676`. |
| `main.ts:699`, `:713` exit retry | `main.ts:680`, `:694` local-only host.save('exit'). |
| `main.ts:719` failed-exit snapshot | `main.ts:700` → host snapshot or mirror. |
| `main.ts:536` placeholder applyRegionEffects | `main.ts:543`–`:546` LocalSimHost.start({}) → existing SimCore.boot region effects. |
| `main.ts:507` loadCity | `main.ts:484`, still authoritative local load (worker boot is W1). |
| `main.ts:464` new-city saveCity | `main.ts:441`, intentionally retained: freshly generated authoritative state (§4.5). |
| `game/CityScene.ts:175` host construction | `game/CityScene.ts:176`, `:180` includes city persistence identity. |
| `game/CityScene.ts:244` context save (pill/menu) | `game/CityScene.ts:246` → save(false) → App host save. |
| `game/CityScene.ts:786` Ctrl+S | `game/CityScene.ts:788` → the same manual save. |
| `game/CityScene.ts:850`, `:853` monthly autosave | `game/CityScene.ts:852`, `:855` → save(true), reason 'autosave'. |
| `game/CityScene.ts:520`, `:859` camera-before-save | `game/CityScene.ts:522`, `:862`; also callable by App hidden/retry paths. |
| `game/CityScene.ts:862` onSave(sim.state) | `game/CityScene.ts:865` onSave(host.state, reason); App routes through host. |
| `game/CityScene.ts:877`, `:881` exit save | `game/CityScene.ts:882`, `:887`, reason 'exit'; capture after acknowledgement. |
| `ui/panels/BudgetPanel.ts:174` tax fallback write | Deleted; `:171` host.act remains. |
| `ui/panels/BudgetPanel.ts:232` funding fallback write | Deleted; `:229` host.act remains. |

All paths in that table are under `src/`. The internal module moves are:

| Before | After |
|---|---|
| `save/index.ts:27`, `:43` CityRecord/cityKey | `save/cities.ts:7`, `:15`. |
| `save/index.ts:49`, `:52`, `:53` save/record/put | `save/cities.ts:21`, `:73`, `:81`. |
| `save/index.ts:58`, `:60` load/get | `save/cities.ts:30`, `:77`. |
| `save/index.ts:68`, `:74`, `:80` serialized load/has/delete | `save/cities.ts:40`, `:46`, `:52`. |
| `save/serialize.ts:220` serializer | `save/serialize.ts:221`, guarded by `save/state.ts:15`. |
| `save/bundle.ts:11`, `:18`, `:65` version/encode/decode | `save/bundleCodec.ts:11`, `:18`, `:65`; old module re-exports. |
| `save/bundle.ts:103`, `:113`, `:118`, `:125`, `:131` file helpers | `save/bundle.ts:5`, `:15`, `:20`, `:27`, `:33`. |
| `save/recovery.ts:27`, `:28`, `:32`, `:40` codec constants | `save/recoveryCodec.ts:8`, `:9`, `:11`, `:19`. |
| `save/recovery.ts:108`, `:161` XOR codec | `save/recoveryCodec.ts:87`, `:140`. |
| `save/recovery.ts:194`, `:207` delta types | `save/recoveryCodec.ts:173`, `:186`. |
| `save/recovery.ts:258`, `:307` city delta codec | `save/recoveryCodec.ts:237`, `:286`. |
| `save/recovery.ts:339`, `:365` pack/unpack | `save/recoveryCodec.ts:318`, `:344`. |
| `save/recovery.ts:384`, `:388`, `:391`, `:394` recovery base | `save/cities.ts:57`, `:60`, `:63`, `:66`; compatibility exports retained. |
| `save/recovery.ts:399`, `:413`, `:417`, `:436`, `:446`, `:524` types/date label | `save/recoveryCodec.ts:362`, `:376`, `:380`, `:397`, `:407`, `:435`. |
| `save/recovery.ts:458` encode/write composition | `save/recoveryCodec.ts:416` builder; `save/recoveryLs.ts:16` LS; `save/recoveryIdb.ts:12` IDB; composition `save/recovery.ts:33`. |
| `save/recovery.ts:531`, `:555` LS read/peek | `save/recoveryLs.ts:51`, `:42`; new IDB-only peek `save/recoveryIdb.ts:20`. |
| `save/recovery.ts:563` LS adoption | `save/recovery.ts:56` composition + `save/recoveryIdb.ts:30`. |
| `save/recovery.ts:583` has snapshot | `save/recovery.ts:49` + `save/recoveryIdb.ts:24`. |
| `save/recovery.ts:600` find/validate | `save/recovery.ts:56` + `save/recoveryIdb.ts:39`. |
| `save/recovery.ts:632` rebuild | `save/recoveryCodec.ts:443`. |
| `save/recovery.ts:641` restore | `save/recovery.ts:71` + `save/cities.ts:81`. |
| `save/recovery.ts:652` discard | `save/recovery.ts:80`, `save/recoveryLs.ts:64`, `save/recoveryIdb.ts:70`. |
| `save/recovery.ts:673` clear after save | `save/recovery.ts:86` awaited composition; `save/recoveryLs.ts:73`, `save/recoveryIdb.ts:76`. |

## NOTE-031: timing dependence

The lifecycle tests used real `Date.now()` to establish strict ordering. Production rejects
`record.savedAt >= marker.at`, but most tests never explicitly advanced the clock after saving. Two cases used
5 ms sleeps to obtain ordering. Cleanup returned a synchronous boolean while deletion continued in the
background; its test waited `setTimeout(0)` as a proxy for completion. Neither elapsed time nor one timer turn
is a persistence-completion contract.

There was also unnecessary synchronous work inside the test deadlines: `setup()` and `secondCity()` repeatedly
called `createRegionData`, generating the region's height/forest fields to get only an id, name and tile keys.
The existing comment recorded a 140-second case under load and a timeout continuing into the next case; the
300-second timeout did not remove that dependence. That continuation can outlive the next beforeEach's shared
KV/localStorage setup. The fixture does not need terrain; the codec tests still exercise real city arrays.

Changes:

- Explicit `Date.now` spy and deliberate timestamp increments in the recovery lifecycle tests; a negative control
  exercises equal save/snapshot timestamps, followed by a newer, restorable snapshot. No sleep supplies ordering.
- Minimal real RegionData records replace region terrain generation; lifecycle timeout overrides are removed.
- Composed `clearRecoveryAfterSave` returns `Promise<boolean>` and callers await actual IDB deletion, with no
  zero-delay timer. Both halves still begin their work immediately when the KV is already open.
- Tests restore globals/mocks and clear the base. Delayed-promise tests hold puts/deletes until explicitly released;
  another test checks `commit()` happens before yielding and acknowledgement waits for transaction completion.
- The IDB half reports newer IDB-only snapshots too. The LS half preserves a newer snapshot already based on the
  completed save if it arrived while IDB cleanup was pending. Obsolete deltas still get deleted and re-armed.

These remove the identified clock/completion/workload dependencies. **The lead's exact failing assertion and
the five-under-load gate could not be reproduced here**, because Vitest fails before collection. No runtime pass
or definitive attribution of the historical failure beyond the inspected dependencies is claimed.

## Tests and hygiene

New tests, by suite/test name (parameterized cases shown together):

- `brand.test.ts` / **replica save refusals**: rejects the actual W1.1a replica at all three entry points, even after
  a cast. `typeRefusals` also checks three `@ts-expect-error` calls under tsc.
- `bundleCodec.test.ts` / **bundleCodec**: keeps version-1 bytes/public re-exports; round-trips typed views, maps,
  sets and special values without aliasing buffers.
- `cities.test.ts` / **city records**: copies arrays/plain data and independently loads/looks up/deletes records;
  advances the recovery base only after a successful put completes.
- `fingerprint.test.ts` / **cityFingerprint**: detects paused plain-data edits and historic flags; ignores camera
  and derived layers without changing them.
- `snapshotCodec.test.ts` / **recovery snapshot builder**: supplied base/timestamp and owned bytes; lean primary
  data and refusal to use another city as a base.
- `recoveryIdb.test.ts` / **recovery IDB records**: separate snapshot/journal keys and newer-only adoption;
  exact-base/newer-time/existing-region validation; await both deletions and preserve other cities; synchronous
  put/commit and transaction-completion acknowledgement.
- `recoveryLs.test.ts` / **recovery localStorage slot**: synchronous write/marker-only peek; journal reserve and
  IDB-only flag; quota/corrupt-data handling; city-scoped cleanup and preservation of new-base snapshots.
- `host.test.ts` / **LocalSimHost persistence**: ack describes the authoritative copy during delayed IDB; FIFO and
  recovery from failed writes; each of beforeunload/pagehide/hidden/periodic/exit writes synchronously; new-base
  snapshot survives delayed cleanup; edit counters ignore derived events and stop on abort/dispose.
- `citySaves.test.ts` / **CityScene saves through App host persistence**: manual/autosave camera-first order and
  deferred success; exit pause/save/capture/return order; failed exit save; disposed exit; silent late success/failure.
- `panelCommands.test.ts` / **panel commands**: a throwing host leaves tax/funding unchanged; disposed sliders stay silent.
- `recovery.test.ts` / **write -> find -> restore**: same-timestamp stale/newer-snapshot restorable negative control.

Existing string-packing, delta, multi-city lifecycle and pre-fix codec cases remain, as do all other save tests
(`serialize`, `serializePhase0`, `continuity`, `grownCity`, `terrain`, `regionEffects`). Existing worker command,
save/load-continuation and view-purity comparisons retain their assertions, using the authoritative local sim.

Enabled exactly these two migration gates:

- `W0.6: UI, game and render never write into the replica outside src/worker`
- `W0.6: SimCore import graph excludes bundle.ts, save/index.ts and recoveryLs.ts`

`W1.2: simWorker import graph excludes bundle.ts, save/index.ts and recoveryLs.ts` stays skipped. The W0.3b
reach-in rule also stays with that lane. The S1 detaching-API scan now covers the split save modules, excluding
only the existing browser export entry points `bundle.ts` and `index.ts`.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Pass, including brand type refusals. |
| `git diff --check` | Pass. |
| `npx vitest run tests/save/recovery.test.ts --maxWorkers=1` | Startup blocked: Vite externalize-deps, `spawn EPERM`, no tests collected. |
| `npx vitest run tests/worker/hygiene.test.ts --maxWorkers=1` | Same startup block, before collection. Stack passes through `optimizeSafeRealPathSync` / `windowsSafeRealPathSync` in the shared W11a node_modules. |
| Other individual runtime tests / full suite / full suite five times under load | Not run; lead runs them on the machine. |
| 128×15 seed-7 bot = 196,101 in 2015; old saves load and continue | Not run here. |
| Browser/manual kill-tab recovery | Not run here; checklist at `docs/dev/qa-W0.6-saves.md`. |

## Design versus this base

- W1.1a already defines/adopts the runtime brand in `worker/replica.ts`. Reusing it from `save/state.ts` is necessary:
  a second symbol would fail to guard existing replicas. This adds a deferred-function import cycle through
  serialize/state/replica; no top-level serialization or brand read is introduced. The runtime test is pending.
- Local has no packet history. Its ack carries `pktSeq: 0`, the real command sequence, and the dirty-event count
  captured with the copy. App uses that count; the per-packet counter history and RecoveryMirror implementation
  belong to the later hosts. `recovery` remains null on LocalSimHost.
- `SnapshotWhy` extends the existing protocol's periodic/hidden/journal reasons with local unload/exit reasons.
  The protocol already names autosave `'autosave'`; §3.4's `'auto'` prose is not its literal value.
- `CityScene.onSave` also serves `src/ui/demo.ts`, outside this lane. Its state argument is retained as HostState
  for compatibility, but App ignores it and routes the reason through host.save. No raw scene state is serialized.
- App still loads authoritative local saves before constructing the scene. The placeholder now boots an empty
  local host so region effects and saves have the same owner. Worker boot/loading/crash fallback and the `{saved}`
  worker exit handshake do not exist in this base and remain W1 work. No replica-to-local fallback was added.
- The codec/IDB/LS split is complete. Page-side recovery composition adopts LS snapshots, then IDB find reads the
  recovery and city/region stores. The IDB module never imports the LS module. Journal storage primitives/reserve
  are present; journal recording/replay/restoration and the worker's min(30 s, 90 sim days) cadence remain W1.3.
  Local keeps its current 30-second recovery cadence and synchronous unload encoding.
- Composed cleanup is now awaitable; callers/tests were updated. The CityRecord, bundle and delta versions are
  unchanged. Region export/import retain their browser packing functions and do not set the active city's base.

The W0.6 additions to SimHost and SimCore are explicitly marked blocks. `queries.ts`, simulation modules,
protocol/replica implementation, teardown infrastructure and the other lane's files were not edited.
