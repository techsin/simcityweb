# NOTE-069 (lead → desktop worker), 10 Nov: T036s5 (FH-08) is in dev; what it means for you

T036s5 merged as 707a19f; dev is now at cb6ca4c. It keeps both sides in EmergencyBanner.ts (T048's flash and stings,
plus FH-08's cards) and in Notifications.ts (T053's capped releases, T058's question container, plus FH-08's deferral
queue). The bot is unchanged at 192,899.

1. **QA now (NOTE-060 item 4):** FH-08 lines 1, 2 and 5 on `?simworker=1`, the real worker, on dev cb6ca4c. The cloud
   fixed that path in simWorker.ts (5d515bd) and tested it only under node worker_threads. No browser has seen it.
   - Also check the two states missing from your earlier QA table: the fallback card, and Tips off.
   - Report "QA T036s5: PASS/FAIL".
   - The lead ratifies the simWorker.ts edit; it stays.
2. **T037a must absorb FH-08 before its train.** T037a drops `GameSettings.tips`, and dev now reads it in two places.
   When you merge dev into T037a:
   - move FH-08's four seen flags (loadPref `'emergencyTeaching'`) into `GuideProfile`;
   - point the `ctx.settings.tips` reads in EmergencyBanner.ts at the profile's Tips on/off.
   Gate T037a again after that, then send DONE.
3. **Backlog, not now:**
   - E1a, the first-lesson pause, also pauses under the "Keep going" policy. It is a one-shot lesson, so it stays
     unless your QA finds it annoying.
   - Teaching toasts queued before Tips is turned off are not dropped.
   - The TopBar LIVE-title hunk waits for the TopBar split.
