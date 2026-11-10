# T086-storage-takeover: fix lane for T036s4's post-merge QA fail (NOTE-074): the takeover during a city load, the lock notice over the emergency banner, and two small lock follow-ups
base: dev (current head); branch local/T086-storage-takeover
owns: src/ui/StorageDialog.ts and src/ui/storage.css (the lock notice and the takeover); src/region/regionLock.ts;
  src/save/db.ts (the lock session, only for B5/B3); a MINIMAL hunk in src/main.ts (playCity / enterCity / the
  Recover gate): the cloud's W1.3 and T061 also touch main.ts, and T061 is merging now; src/ui/EmergencyBanner.ts
  only for STACK_TOP if B2 is solved that way; new tests.
do (the QA report is in the scratch folder as qa_T036s4dev.md: read all of it first, it has file:line for each bug):
  - **B1 (major): "Use it here instead" clicked while the read-only tab is still loading the city** (3 of 3, click
    0.35-0.41 s after Continue; the load takes about 3 s). The tab ends with the region screen and the city both alive;
    it becomes the writer without the Recover dialog, so the first tab's unsaved progress is lost (its snapshot is
    overwritten 30 s later and deleted by the autosave at about 63 s); its saves do not update the region's tile
    summary. Cause: the notice is above the loading screen (src/ui/storage.css:9, z 95 against 50); the takeover
    (src/ui/StorageDialog.ts:345-354, src/region/regionLock.ts:55-57) only tears down a city already in App.city;
    playCity then continues into enterCity (src/main.ts:572-617). Fix: the takeover waits until App.busy is false
    before its teardown, so it can never leave the region screen and a city both alive; the notice hides while a
    `.loading` screen is up. Add a regression test for the click mid-load: no Recover bypass, no snapshot loss, and
    the tile summary updates on the new writer's saves.
  - **B2: the notice covers the emergency banner** (at 1280x720, 68 % of Jump and of Send nearest is covered and a
    real click on either is blocked; at 1920x1080 the banner's title row and all of Dismiss; src/ui/storage.css:10
    against src/ui/emergency.css:6-9). Dock the notice bottom-centre while a city is open, or add its height to
    STACK_TOP (src/ui/EmergencyBanner.ts:84), whichever keeps Jump, Send nearest and Dismiss clickable at 1280x720
    and 1080p, including with FH-08's teaching cards and the folded-stack fallback card.
  - **B5** (a read-only tab is never told the region became free: src/save/db.ts:364-389; queue a plain lock request
    and offer the takeover when it is granted) and **B6** ("Later" on a Recover dialog opened from the title's
    Continue keeps the region's lock: src/main.ts:557-558; dispose the storage session when the gate declines):
    include both if they stay small.
  - **B3** (BroadcastChannel fallback: after a reload the only tab is read-only for up to 15 s; src/save/db.ts:414
    trusts the old lease before probing): include it only if it is a one-line timing change; otherwise record it.
  - **B4:** skip (no player can reach it); record it in the report.
gates:
  - tsc; your new tests and every existing storage, lock, recovery and banner test (tests/**/recoveryGateScope*,
    tests/**/storage*, tests/**/regionLock*, tests/game/emergency*) through quietrun; the bot identical (192,899).
  - I run the full vitest, the bot, and the whole T036s4 real-GPU QA script again (all of it, not only B1).
report: docs/dev/reports/local-T086-storage-takeover.md, with a browser checklist.
