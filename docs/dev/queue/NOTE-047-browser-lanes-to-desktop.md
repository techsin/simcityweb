# NOTE-047 (lead → desktop worker): five browser-heavy lanes move to you; plus a real-GPU check of FH-21

On the cloud, browser checks run on SwiftShader behind one shared lock, and that lock is the cloud's bottleneck. These
lanes are now **yours**. The cloud has dropped them from its chains, and no cloud worktree touches their files.

**Lanes. Run them in parallel with your NOTE-045 work, one branch each, pushed every 30 minutes.**

1. **T028, the worker-mode acceptance harness** (task docs/dev/queue/T028-qa-worker-harness.md, WORKER_DESIGN §5.4).
   - Branch: local/T028-qa-worker (c703887). A Codex lane wrote it on base a2578da, about 140 commits behind dev, and
     it stopped in the middle of a review fix round. Review the code first, then merge dev.
   - Run it in **loopback mode** now: dev has T031 and T032, so you can test ghosts, playability and teardown.
   - Run it in **worker mode** once T034 is in dev; the cloud's worker chain merges it soon.
   - Report every acceptance item's numbers.
2. **T037a, the onboarding framework: FH-01, FH-02 and FH-22** (POLISH_PLAN §4 and the items, in full).
   - Branch: local/R1-guide-a (decacb4), a Codex lane on base 93069fa that nobody has reviewed. Review it, then merge
     dev. Expect conflicts with W0.3b, W0.6, T037b, T037c, T037d and the cloud's TopBar split (src/ui/topbar/**)
     once that merges.
   - **NOTE-042 item 1 is yours:** the per-profile pref (GuideProfile through FH-22's loadPref) is the single source of
     truth for tips. Drop GameSettings.tips; T036 step 1 added it and nothing reads it. The Settings toggle reads and
     writes the profile pref.
   - Run the browser checks on the real GPU.
3. **T037e (NOTE-043): FH-05's other half**, the finance advisor's wording in AdvisorsPanel and its two acceptance
   items.
   - Also move T037c's budget helper from src/game/tools/Tool.ts into src/ui/guide/budgetDelta.ts. Behaviour does not
     change, and the tests move with it.
   - Start it after T037b is in dev, because the cloud is finishing T037b now. Append a line for each sub-lane to
     docs/dev/queue/T037-polish-r1-guide.done.
4. **T036 step 4: NEW-04 and FEEL-02b's autosave floor.**
   - NEW-04: a second tab on the same region gets a Web Lock per region (D16). Test it with real multi-tab browser
     checks.
   - FEEL-02b: the autosave floor (D6). Build on host.save and host.snapshot.
   - FEEL-02b's recovery check waits for W1.3 (T039, on the cloud).
5. **T036 step 5: FH-08, the first emergency teaches dispatch.**
   - T029 and W0.3b are both in dev. Build on EmergencyBanner, EmergenciesPanel and host.policy as they are now.
   - You also hold the round-2 FEEL-09 and FEEL-10 hunks in EmergencyBanner, so order those branches yourself.
6. **A real-GPU recheck of FH-21** (in dev from T036 step 2, b71b2c2). Run first-run quality detection (detectQuality()),
   the slow-frame prompt and the lost-context path on the RTX 5070 Ti; the cloud could only test them on SwiftShader.
   - Report the detected tier and whether the prompt behaves.
   - A fix, if one is needed, is a small lane.

**The cloud keeps:** B2, T034, W1.3 (T039), T037b, the TopBar split, T036 step 3 (FEEL-02a) and T038.

When a lane is done, push it with its report and `.done` line, then message me. The cloud reviews, gates and merges it.
