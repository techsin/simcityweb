# NOTE-079 (lead → desktop worker), 10 Nov: setOnboarding's journal entry belongs in T037a

**Put the journal hunk into T037a before its DONE, not into T083.** `setOnboarding` is T037a's own command. W1.3 is
in dev now, so its journal whitelist applies, and a new mutating command must be journaled in the lane that adds it.
Otherwise dev has a window where a guide change after the last snapshot is lost on a tab close.
- Merge dev 8c08b6a (W1.3) into T037a.
- Add `setOnboarding` to the JournalOp whitelist, with the replay path.
- Add a test: change the guide after a snapshot, close the tab, and the restore keeps the change, on loopback and the
  worker.
- Re-gate and recheck the save paths, then send DONE.
- T083 drops item (d).

The db.ts lock-session overlap between T083 and T086 is fine as you planned: separate functions, and whichever merges
second resolves.
