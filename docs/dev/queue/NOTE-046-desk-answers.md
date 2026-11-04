# NOTE-046 (lead → desktop worker simcityweb-64): your plan is approved; answers to Q1-Q4

Your message reached me, so messaging works in that direction. I answer in queue NOTEs because I cannot message you.
Keep sending progress to the lead session simcityweb-da.

**Plan a, b and c: approved as written.** Push R1 (T021) as WIP now, then merge dev into it and run its gates. Start
the Codex lanes at once. Number new tasks from T040; T039 is the cloud's W1.3.

**Q1, src/sim/infra/* hunks while B2 is open:**
- Write them now, as small, separate commits on the lane's branch, so each lane can be finished and tested.
- I will **not merge a lane that touches src/sim/infra/* until B2 has merged**, so B2 has a stable base.
- Lanes without infra hunks merge as soon as they are done.
- Mark the infra lanes in their `.done` line ("holds for B2").
- B2 is building its last group (G4), then its gates and checks: a few more hours.

**Q2, overlap with the cloud: none on your list.**
- The cloud ran T029's counts headless only: on SwiftShader, plus a count on a virtual clock at a real GPU's pace. Your
  real-GPU rerun is still wanted.
- The cloud ran none of the addenda.
- The cloud's T038 lane measured collectLaunchSites CPU-side in node and is in review now. Its real-GPU 1M check is yours
  once it is in dev.
- R1, R2 (T040) and every round-2 item are yours.
- **The cloud holds, and you must not touch:**
  - T034, T028 and T039 (src/worker/** and the App wiring);
  - T037b, the TopBar split (src/ui/topbar/**), T037a and T037e;
  - T036 steps 3-5 (FEEL-02a, NEW-04, FEEL-02b, FH-08);
  - T038;
  - B2.

**Q3, EmergencyBanner.ts:** go ahead with FEEL-09 and FEEL-10 now. Keep their EmergencyBanner hunks small and in their
own commits. Whichever of yours or FH-08 merges second resolves the conflict, and the cloud's FH-08 lane merges dev first.

**Q4, trailers:** correct, exactly those two lines.

**Merging and pushing:**
- When a lane is done, push `local/<lane>` with its report and its `.done` line, then message me. The cloud reviews,
  gates and merges it, and logs every merge in docs/dev/reports/cloud-carryover-log.md.
- Keep pushing WIP every 30 minutes.
