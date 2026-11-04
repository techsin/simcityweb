# T036s4 · FEEL-02b quiet autosave

**Final (desktop, real GPU): done.** The autosave floor, silent autosaves (only the minimap chip) and the backoff after a failed autosave pass on the real GPU; the results, gates and B1-B8 are in docs/dev/reports/local-R1-meta-NEW-04.md, T036 step 4's final section.

## Cloud carry-over (Nov 3)

Verified on `cloud/t036s4` with dev (T034's WorkerSimHost, T040) merged in. Everything is in the NEW-04 report's
section of the same name: the gap list, the line-by-line check of the round-4 snapshot `091a181` (src and tests equal
to `cb58ab8`), and the gates. Those are tsc clean, and 15 files / 145 tests passed, among them the 29 of
autosaveFloor.test.ts. Five mutation checks of the floor, the silence, the backoff, the one sound per streak and the
pill are all caught. On the worker host, `persistence` reaches the CityScene and the replica's `month` event drives
`onMonth`, so the floor and the silent autosave apply there unchanged. Remaining: the recovery check after W1.3 (T039).

## Review round 4 · NOTE-058 failure streaks

Round 3 is committed (`ad1b095`, `37c7605`, `9a53182`). This round is one uncommitted autosave-failure change following NOTE-058; it supersedes round 3's zero-error-sound policy.

- `src/game/CityScene.ts`: named initial delay, multiplier and cap give a real-time retry schedule of 60 seconds, 2, 4, 8 and then 15 minutes, capped at 15 minutes. Each deadline starts at failure completion on `performance.now()`. The first autosave failure in a streak plays one error sound; later failures are silent. Manual Ctrl+S keeps its own feedback and does not escalate or reset an existing failed-autosave streak unless it succeeds. Successful autosaves, manual saves and external/hidden save acknowledgements reset the streak. A partial city acknowledgement followed by a failed region write retains the prior failure streak. Storage dialogs still suppress automatic attempts, and explicit Retry remains available.
- `src/ui/StorageDialog.ts`: a small condition revision advances after successful, lock-protected region deletion. The next eligible save resets the backoff/streak while retaining the normal minute floor. Refused/failed deletion, Export and Close do not reset it. A cleanup notification arriving during an in-flight save is retained for the next attempt.
- `tests/game/autosaveFloor.test.ts`: fake timers drive ultra month ends every 1,500ms. Repeated failures must occur at `[60000, 120000, 240000, 480000, 960000, 1860000, 2760000]`ms, with exactly one error sound and no pills. Additional cases cover auto/manual/hidden success resets, cleanup (including during a save), manual failure feedback and partial region-save failures. `tests/game/storageDialog.test.ts` covers successful cleanup versus failure/refusal/Export/Close. The existing `citySaves.test.ts` fixture learns the new revision and failure state.

Validation: **TypeScript passes; all 17 serial quiet-gated test files pass, 163 passed / one existing hygiene skip.** This also clears the round-3 pending targeted checks. The NEW-04 round-4 table lists every file/result. `git diff --check` and UTF-8/no-BOM checks pass. The native config-loader/thread-pool invocation below was used after the timing block ended. Three committed round-3 fixture issues were corrected without changing assertions: the save-chip callback has a callable type, the deliberately partial region fixture uses an explicit `unknown` cast, and the storage-dialog db mock exposes the real `MemoryKV` needed by its existing fixture import. No other production behavior changed.

No browser, full suite or bot was run here; those gates remain with the lead. The worker's unchanged bot acceptance remains residents `[61124, 93804, 37971]` = **192,899** in 2015; the exact command is below. No balance, save schema, simulation RNG or infra change. `main.ts` and `recoveryLs.ts` are unchanged (+0/−0); no cloud-held file is edited.

**Known host issue — T061 item 7:** NOTE-058 assigns B9's lost exception name in Worker-protocol save replies to T061. Until it lands, the loopback quota-dialog check is a known host issue owned by T061, not a T036s4 failure. The additional Worker live-export payload request remains in the NEW-04 report.

Round-4 browser rechecks:

- [ ] At ultra, keep storage failing and dismiss the error dialog between eligible attempts: delays grow through 1/2/4/8/15 minutes and remain capped; one error sound per streak, no autosave pills.
- [ ] Leave a storage dialog open across month ends: no autosave attempts. Retry remains usable; Close/Export alone do not reset the streak.
- [ ] Allow a save to succeed, or free storage via Manage storage, then fail again: the next streak begins with a one-minute delay and one error sound. Ctrl+S retains its own pill/sound.
- [ ] Loopback quota classification: known host issue, **T061 item 7**; recheck after that host fix lands.

## Review round 3

The worker measured five autosaves in five minutes at ultra on a 304k city (minimum gap 60.37s), zero chimes/pills, and the correct 1×/Ctrl+S behavior. This round addresses the failed-save and dialog cases from that QA:

1. `CityScene.ts`: a failed automatic attempt restarts the 60-second floor, automatic saves skip while a storage dialog is open, and automatic failures play no error sound. Manual saves keep their feedback; explicit Retry remains available within the minute.
2. `storage.css`: the 300px-wide backup reminder now sits at top-center, 150px below the top, at z4. It stays visible between the side panels and above the tile actions, below dialogs and the lock banner. No RegionScreen markup change is required.
3. `CityScene.onKey` checks `storageDialogOpen()` beside confirmation state. Tests cover 3, Space, Escape and Ctrl+S while dialogs are open.
4. Lost-owner failures cancel pending pills and show no error dialog/sound. The disabled chip wording, settings/recovery copy, fresh takeover summaries and live host-snapshot exports are detailed in the NEW-04 round-3 section. `main.ts` and `recoveryLs.ts` are unchanged; no infra or balance change.

Round-3 validation is blocked by the shared `QUIET` flag: the gated TypeScript command never started during about 50 minutes of waiting, and only this lane's waiter was cancelled. No new TypeScript or Vitest result is claimed. `git diff --check` and UTF-8/no-BOM checks pass; main.ts is +0/−0 this round. The NEW-04 report lists all 17 pending targeted files and the browser rechecks. Original bot acceptance remains worker-verified at 192,899. B9's worker exception-name transport remains pending. The report also records the Worker snapshot request needed to export a built live payload when recovery persistence fails; the local-host behavior has new regression tests awaiting execution. No worker file was edited. Changes are uncommitted.

Branch: `local/T036s4-storage`; base: `821a8d6`. Initial implementation is committed as WIP (`2f040cc`, `8229b70`); review-round fixes remain uncommitted. No `.done` file was changed.

## Review round 1

The latest validation supersedes the initial-run limitations below: TypeScript passes, and **17 serial quiet-gated test files pass: 131 passed, one existing hygiene skip**. This includes `autosaveFloor.test.ts` (11), `citySaves.test.ts` (7), both originally failing files, all region tests, and the new coordination/recovery extraction tests. See the NEW-04 report's review table for every file/result and the working native-loader command.

`main.ts` is reduced from **+109/−24 to +44/−26** against `821a8d6`. Region lifecycle and Found handling are in new `src/region/regionLock.ts`; quota/save checks are in `db.ts`; recovery decisions and error routing are in `StorageDialog.ts`. The `recordSaved()` acknowledgement bridge and autosave behavior are preserved. `recoveryLs.ts` remains the original four added guard lines, with no review edit. No infra or simulation change.

The worker independently verified the unchanged bot total **192,899**, residents `[61124, 93804, 37971]`. It was not rerun in this review. Full-suite confirmation and the browser/W1.3 checklist below remain for the lead. Cloud quota-name and persistence-fence requests are unchanged. Review changes are uncommitted.

## Changes by file

- `src/game/CityScene.ts`: a monotonic `performance.now()` floor of 60,000 ms, initialized on scene entry and reset after every successful save. Month eligibility stays pending until the first month end meeting both the game-month setting and real-time floor. App/hidden saves call `recordSaved()` too. Read-only regions cannot autosave or manually save. An explicit guided Retry bypasses the automatic floor while retaining silent autosave feedback, including when the city write succeeded but its subsequent region write failed.
- `src/ui/Modals.ts`: `SavePill.saving(true)` and its completion never show the pill; successful autosaves play no sound in CityScene. Manual saves retain their pill/chime. Pause-menu Save follows region write permission; exit remains usable in a read-only tab.
- `src/ui/panels/SettingsPanel.ts` and `src/region/ui/dialogs.ts`: both enabled labels now read “Every N game months, at most once a minute”.
- `src/main.ts`: tiny optional `recordSaved()` scene contract and notification following a successful `host.save`, including saves made outside CityScene. The surrounding storage/error/lock hunks are listed in the NEW-04 report.
- New `tests/game/autosaveFloor.test.ts`: first eligible 1× month, five silent ultra autosaves in five simulated minutes, manual/hidden resets, slow-write completion, read-only/off settings, quota Retry, partial-save Retry despite the floor, silent SavePill and pause-menu permission.
- **Outside-named existing test:** `tests/game/citySaves.test.ts` fixture/expectation adjustments for the real floor and guided-error routing.
- `src/ui/hud.css` needed no change: autosave is silenced in SavePill without changing the manual pill's CSS.
- **Infra hunks:** none. No simulation, balance, save schema or RNG change.

## Validation and gates left

- **PASS:** `npx tsc --noEmit`; `git diff --check`.
- **PASS:** native Node storage-helper probe, described in the NEW-04 report. This does not claim to execute the autosave UI tests.
- **Unit tests pending:** Vitest startup failed with Vite `spawn EPERM` on the quiet-gated `tests/storageDb.test.ts` command. No Vitest test ran, including the new floor tests or existing `citySaves.test.ts`. Run those single files through the quiet gate with `--maxWorkers=1`; the full suite remains for the lead.
- **Bot pending:** the command below failed before simulation with npm `ENOTCACHED` for `tsx`. Its output is in the task scratch folder as `bot128x15_s7.log`. No observed bot numbers; expected unchanged 2015 residents are `[61124, 93804, 37971]` = **192,899**.

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

No browser, full suite, benchmarks or 256-tile bot was run.

## Plan versus code / cloud handoff

- W0.6's existing `opts.onSave` → App → `host.save` route is preserved; recovery remains through the host. No state is serialized by the UI.
- Host acknowledgements are the available save signal; there is no saved-time watch. `recordSaved()` supplies the tiny App integration for hidden saves.
- The Worker's future 30-second floor is not in this base. The UI's 60-second floor will remain the larger limit.
- The post-W1.3 crash/journal acceptance is deferred as the task requires. Worker quota-name and ownership-fence requests are specified by file/function in `local-R1-meta-NEW-04.md`; no worker file was edited.

## Browser acceptance checklist for the lead

- [ ] With the real Worker and a 100k+ city, run five minutes at ultra: **at most five autosaves, zero autosave chimes, zero autosave pills**; only the minimap save chip updates.
- [ ] At 1× with the default three-month setting, manually save, then observe no autosave at 45 seconds and an autosave at the first month end at least 60 seconds later (normally the fourth game month).
- [ ] Confirm Ctrl+S still shows its pill/chime, and hidden/App saves restart the one-minute floor.
- [ ] Force a partial city-save/region-save failure, then click Retry inside the minute. Confirm a real retry with silent autosave feedback.
- [ ] Confirm autosaves remain off after another tab takes the region lock and resume only after takeover reloads current data.
- [ ] **After W1.3:** kill the tab 50 seconds after an autosave. Restore must offer a snapshot at most **30 real seconds / 90 game days** old, plus every journaled edit.
