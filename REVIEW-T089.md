# REVIEW-T089 (cloud lead → desktop worker): PASS

Reviewed origin/local/T089-crash-discard @ 49a08074 (gated at dc563f92, base 05cbf59; stacked on T086) against dev
dd1793e. This is a single-pass lead review (wind-down): the src diff read, the gates and the real-GPU QA taken from the
DONE.

**Lead's note:** PASS. Merge T089, with T086 under it, on a full gate against current dev. Dev has moved past 05cbf59:
FEEL-03, T096, NOTE-107 and the ensemble docs. FEEL-03 touched src/game/CityScene.ts, which T089 also edits, so the
fast path does not apply. Then message "MERGED". **For W1.4 (task #38), T089 closes the crash-discard item and W1.3
decision 20.** The two storage-dialog fixes below are the cloud's, right after the merge.

## What was checked

- **The crash dialog's three paths (main.ts):**
  - Recover replays the journal only when the restore returned 'recovered'.
  - A restore that left the copy stored (store full, the region open in another tab, the copy unreadable) returns to
    the region with the tile selected and a toast naming why. It opens no city over the copy, as the recovery gate
    does.
  - Restart and Continue call `discardRecoverySnapshot`, so a crashed session cannot come back (the owner's choice,
    NOTE-080).
- **Journals (recoveryIdb.ts):** a journal bound to a still-stored snapshot is not deleted by a boot of the save
  underneath (`extendsStoredSnapshot`). A snapshot record that cannot be read counts as held, which is the safe
  default (W1.3 decision 20).
- **Takeover (regionStorage):** "Use it here instead" waits for a city entry in flight (`busy`, 50 ms polls), then
  holds `busy` itself while the region reopens. That closes T086 B1's writer-without-Recover hole. If the player left
  the region during the wait, nothing reopens.
- **The lock query (regionLock.ts):** `heldElsewhere()` uses `navigator.locks.query()` without queuing a request.
  That is the right call, since a queued request would jump the holder's `ifAvailable` re-acquire. It returns null when
  unknown, or on the BroadcastChannel fallback.
- **Keyboard (from the QA):** Recover is focused within 69 ms, Enter picks it, Space picks nothing, and the game keys
  are blocked behind the dialog while the camera keys still work. That matches NOTE-092.
- **The B1 and B3 doc corrections in 49a08074:** accepted. D4's "may offer the restarted session's own snapshot, which
  brings back none of the crashed session's edits" is the honest statement.

## The cloud's, after the merge (you asked who takes O1)

- **O1 (Medium):** `.storage-back { z-index: 130 }` loses to `.modal-back { z-index: 40 }` through stylesheet order, so
  in the city the toolbar and HUD draw above "Storage full" and take clicks through it. Fix:
  `.modal-back.storage-back { z-index: 130; }`.
- **B2 (trivial):** `if (modalOpen()) return;` at StorageDialog.ts:91, so Recover does not keep a pressed look after
  Space.

Both files are in T089's diff, so the cloud lands them as one small commit right after T089 merges, with tsc and the
storage tests. **Desktop QA for both:** "Storage full" in a city draws above the toolbar and blocks clicks; Space on
Recover over a storage dialog leaves no pressed look.
