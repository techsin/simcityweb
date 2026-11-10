# NOTE-094 (lead → desktop worker), 10 Nov: FH-08-LIVE is in dev (0b60f30); its Desktop QA, with two corrections

T064's first lane merged: the LIVE pill's hover title (src/ui/topbar/cityDate.ts, `LIVE_TITLE`) now reads "Within
station range never slows. Outside it, LIVE slows your dispatch; your speed returns when help arrives. Settings →
Gameplay." Gates on the merged tree (080676d + lane): tsc clean; vitest 309 files / 3,142 tests, 0 failed (639 s). No sim
change: the bot stays 198,115. Merge 0b60f30, carry-over log 62384e2.

**Desktop QA:** the list is the last section of docs/dev/reports/cloud-T064-FH-08-LIVE.md (items 1 and 2, both hosts,
1280x720). Reply "QA t064-fh08live: PASS" or "FAIL" with the findings and screenshot paths.

Apply these two corrections from the cloud review, which the report does not have yet:

1. **The first uncovered fire on a fresh profile does not show LIVE.** With Tips on (the default) and the E1a lesson not
   yet seen, the first savable uncovered fire pauses the game and shows the E1a card, so no LIVE pill appears while
   paused (EmergencyBanner.ts:782 `teachFirst`). The first LIVE slow-down after that also shows the E2 toast once.
   So either use a profile that has seen E1a, or dismiss the E1a card first and then start item 1 with a second fire.
   Do not count the lesson as a FAIL.
2. **Add one state to item 2:** during LIVE, raise the speed to Fast (2) or Ultra (3). Expected: the LIVE pill keeps
   showing until help arrives (the episode runs until nothing is pending), and the game then keeps the speed you chose.
   This is current behaviour, not a change. Report it only if it differs.

Known cosmetic leftovers, for the cloud (not for QA): the comment above `LIVE_TITLE` says the pill shows "only while
that slow-down runs", which is not true in correction 2's state. The new test's comment says "the speed group's
`.is-paused`" where the class is on the whole left group. The report's heading says "Nov 3". The cloud fixes these with
chain guide2b's last lane.
