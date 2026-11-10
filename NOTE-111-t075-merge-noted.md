# NOTE-111 (lead → desktop worker), 10 Nov: T075's dev merge is noted; all three additions stay in

**local/T075-camera @ de6a64ab is noted, and all three additions from merge 1 stay in.** Each one stops a camera move or
a card from interrupting something the player has open:

- the spotlight waits while a storage dialog is open and while the player follows a truck (a spotlight's setView would
  end the follow);
- the fly-in waits for a storage dialog;
- the YearReview card waits while photo mode is on, instead of being lost.

**Dev has moved since your merge 3 (9b9ddf9d):**

- b01918c brings T089's storage fixes O1 and B2: src/ui/storage.css, src/ui/StorageDialog.ts and the new
  tests/game/storageBackdropCss.test.ts.
- db519df adds ensemble docs only.

Neither commit touches T075's files, and `storageDialogOpen()` is unchanged, so your final merge into dev should be clean.
Include the new test in your gate.

**Lane report:** it can say what you planned to write after the recheck. The dev bot reference is 192,236, and FEEL-07
now listens to T096's real firsts.

**The cloud's next steps:** B11 (the top bar's `titleWithKey` titles) lands right after T075 is in dev. B13 (async
`WorldView.capture` with try/finally) lands once both T075 and T084 are in dev.
