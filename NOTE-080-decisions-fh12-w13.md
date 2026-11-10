# NOTE-080 (lead → desktop worker), 10 Nov: two owner decisions, FH-12 in dev, and W1.3's follow-ups before W1.4

## 1. LG-06 is cut from this release (the owner chose option A)

- **T043 is not merged.** Keep its branch, the 425-run evidence and the report. Take it off the wave-2 merge list.
- **Stop all T043 work, and the 60-year ensembles queued for it.** The freed bot slots go to T044 and T045's final
  gates.
- **The B2, GUIDE and META requests that existed only for LG-06 are withdrawn:** B2's scar refresh, the GUIDE label
  and the META banner.
- **For a future version, the owner confirms two things:**
  - a city is never charged for calls it was not shown or could not answer;
  - the next design keys off calls the player saw and ignored, with approval's small-town fade-in.
- The lead amends POLISH_PLAN (LG-06 deferred, with the reason and its acceptance unchanged) and re-scopes LG-15's
  damage charge to disasters only.

## 2. FH-12 is in dev (d2a9e2d, dev 825ee22)

- **META's rounds 3 and 4 are unblocked: LG-12, LG-14, LG-13 and LG-24.** Start them as lanes when you have a free
  coding agent. LG-12 and LG-14 come first.
- T078 (FEEL-21) shares the title-screen dialogs with FH-12. Merge dev into T078 before its train.
- **Post-merge QA of FH-12** ("Start your first city" on the title screen), after your own lanes' QA: "QA FH-12:
  PASS/FAIL".

## 3. W1.3's follow-ups, all needed before W1.4 (the worker on by default)

The lead reviewed W1.3's 22 decisions. The owner decided the crash-dialog question: **discard, and say so.**

**New lane T089 (after T086, because both touch main.ts; or fold it into T086 if that stays small):**
- **(a) Decision 3:** in onWorkerCrash, for 'restart' and 'local', call `discardRecoverySnapshot(city)` before
  playCity, so the crashed session's worker snapshot can never come back. Reword openSimCrashDialog so it says that
  unsaved progress since the last save is lost unless you choose Recover.
  - Test: crash after a worker snapshot, choose Restart, make an edit, crash again, choose Recover. Expect the save
    plus the new edit, never the old snapshot.
- **(b) Decision 20 (data loss):**
  - readRecoveryJournal deletes a journal only when no stored snapshot could still take it; skip the delete while
    recovery/<key> holds the snapshot its base names.
  - In onWorkerCrash, when restoreRecovery returns anything but 'recovered', boot with replay=false (or return to the
    region) instead of replaying.
  - recovery.test cases: a restore that fails on quota, and a boot with a pending snapshot; the journal survives in
    both.

**Add to T083:**
- **Decision 19:** in simWorker.ts drain(), end the unit after a snapshot too
  (`if (m.t === 'save' || m.t === 'snapshot') return true`), with a workerRecovery case "save:copy ends its unit".
- **Decision 21's tests must name each write.** A read-only tab boots a city with (i) a save-bound journal and (ii) a
  pending snapshot plus its journal, and makes no record write and no recovery delete. Plus a takeover during a
  session, after which the old tab's worker stops writing. Include decision 20's path 1, the worker realm's boot-time
  journal delete.

**Low priority, before the final verification:** T090, decision 7 (edits lost after a lost `snapped` or `saved`
reply). Store the copy's cmd and a worker-session id in the snapshot marker and the record's top level, not in
SerializedCity, so the save version is unchanged. Rebind a same-session journal to the newer base, keeping ops after
its cmd. Add tests that drop each reply.

**W1.4's gate (T080) also needs:** W1.3's Desktop QA D1-D5 and D7 PASS on dev, including D7's 1M save cost (the worker
copy at most 60 ms, main at most 2 ms); D4b added from (a) above; T083, T089 and setOnboarding's journal entry (in
T037a) in dev.
