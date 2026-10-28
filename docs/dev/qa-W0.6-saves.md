# W0.6 saves — browser checklist

For the lead on `local/W0.6-saves`, base `93069fa`. **Not run in this sandbox.** Keep LocalSimHost selected.
Use a disposable region plus copies of existing saves. Record browser, build, city, day, funds and population.
Keep the console open for errors. See [the report](reports/local-W0.6-saves.md) for implementation and pending gates.

## Save paths and camera

- [ ] Found a new city; the initial save persists and the city opens normally. Reload and continue.
- [ ] With the city paused, make a visible zoning/road edit. Save via Ctrl+S, the save pill/status control and the
  pause menu in separate trials. The saving/saved indicator and sound occur once; reload preserves each edit.
- [ ] Change tax, service funding, a historic flag and an ordinance while paused. Each makes the city dirty and
  survives save/reload. Normal commands retain their tags/gestures and optimistic display behavior.
- [ ] Move and rotate the camera, save immediately, then exit/re-enter. The saved view returns. Repeat by hiding
  the tab immediately after moving the camera, without clicking Save.
- [ ] Enable autosave every three months and run through several intervals at normal and ultra speeds. Continue
  editing during an autosave; completion must not mark later changes clean. Save again and reload.
- [ ] Hide a dirty tab, then return. Hidden snapshot/full save complete; the pill is accurate, and a reload includes
  the changes. Repeat with a full save already in progress; no overlapping writes or stale region summary.
- [ ] Save and exit to the region. The tile's name, population, year, funds and captured thumbnail agree with the
  saved city. Re-enter, then switch to a second city and back; neither city receives the other's pending save/snapshot.
- [ ] Exit during an autosave and during lazy renderer/system startup. No late success/error sound, canvas capture,
  toast or return-to-region callback revives the disposed city. Check null views and the existing teardown probe.

## Recovery, including killing the tab

- [ ] Save a baseline, disable autosave, make visible edits and advance time. Stay visible until a periodic recovery
  snapshot is recorded (30 seconds while dirty; `window.__metropolis.lastSnapshot` exposes its outcome).
  Record the snapshot's city/day/funds and edited cells, and wait for its IDB write to settle.
- [ ] **Kill the tab's renderer using the browser task manager**, without normal navigation/close handlers. Reopen
  the game. Accept “Recover unsaved progress?” and confirm the snapshot's day, money, buildings, roads/zones and
  budget. Derived layers from a lean snapshot may refresh after load. No journal replay is expected in W0.6.
- [ ] Save the recovered city, reload, and continue for a month. It must load normally and not offer the same recovery
  again. Compare primary state with the snapshot recorded before killing the tab.
- [ ] Repeat with a bulldoze followed by growth (41, 42 or 43 buildings if using the codec fixture). Confirm the
  removed building stays removed and the new building retains its rotation/footprint after recovery.
- [ ] Separately make paused edits and immediately **close/reload normally**. The beforeunload/pagehide local
  snapshot includes those edits even without waiting for a promise or periodic snapshot.
- [ ] Produce recovery for city A, dismiss the prompt with “later”, then play city B and produce recovery there.
  Both remain available; restoring or discarding one does not remove the other.
- [ ] Save a city after a recovery snapshot. The old delta is no longer offered. With a deliberately delayed save,
  take a snapshot before completion: the old-base delta is dropped and a fresh one is scheduled while still dirty.
- [ ] Deny localStorage payload writes while keeping IDB available: in DevTools, wrap `Storage.prototype.setItem` so
  it throws a QuotaExceededError for the key `metropolis.recovery.data`. Recovery still works from IDB. Then lose
  the IDB recovery record while keeping a valid LS snapshot (DevTools → Application → IndexedDB → the `recovery` store,
  delete the city's entry): startup adopts the LS snapshot. There is no fault harness in the repo; these are manual
  steps.
- [ ] Force a full-save failure, then exit. Local retry/recovery must preserve progress, report the failure, and not
  falsely mark it clean. Remove the fault, recover, save and re-enter.

## Existing behavior and acceptance gates

- [ ] Region export/import still round-trips .metropolis files, including existing files; imported cities load.
- [ ] Old saves load, run 45 days, save/reload and continue with the same results as the integration baseline.
- [ ] Play at all speeds, edit while paused, open budget/inspector/data views and trigger a LIVE emergency. Existing
  commands, queries/watches, policy, sounds and views still work. No new replica writes or serialization errors.
- [ ] Run both W0.6 hygiene rules. W1.2 and W0.3b skips remain assigned to their respective lanes.
- [ ] Run all tests, including each new save module, actual-replica brand refusals, host delayed-storage tests,
  scene saves and BudgetPanel failure tests listed in the report.
- [ ] Run the **full suite five consecutive times under normal background load**, recording each exit code and
  any failing assertion/timeout. Do not substitute a passing isolated recovery test for this NOTE-031 gate.
- [ ] Run the 128×15 seed-7 bot: **196,101 in 2015**. Record its output and compare with `93069fa`.
- [ ] Run the existing fresh/hostile teardown check after repeated city entry/save/exit cycles; detached controls
  must retain no city listeners, and aborted scenes must not process late save acknowledgements.

Record pass/fail, exact reproduction steps and logs beside each item. The sandbox only verified TypeScript and
diff whitespace; Vitest startup was blocked by `spawn EPERM` before test collection.
