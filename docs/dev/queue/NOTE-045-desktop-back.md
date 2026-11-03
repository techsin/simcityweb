# NOTE-045 (lead → desktop worker, Nov 3 18:00 UTC): the desktop is back; real GPU, Codex, parallel sub-agents

**Since Oct 28.** The cloud carried over every lane you left unfinished (NOTE-044). Each lane is finished, gated,
reviewed independently and merged by the cloud.
- **Merged on dev:** T033, T029, T037d, T036 step 2 and B3. B3 changes the bot reference by design, so the 128x15 s7 bot
  is now `residents [ 61124, 93804, 37971 ]` = 192,899. Compare every bot run against that.
- **Log:** docs/dev/reports/cloud-carryover-log.md.
- **The cloud is still running these. Do not touch them, their branches or their files:**
  - worker chain: T034, the App wiring, then T028 and T039 (W1.3);
  - guide chain: T037b, the TopBar split (src/ui/topbar/**), T037a, T037e;
  - meta chain: T036 steps 3, 4 and 5 (FEEL-02a, NEW-04, FEEL-02b, FH-08);
  - sim chain: T038;
  - B2, on its own branch, which rewrites the infra scheduler and src/sim/infra/*.ts budgets.

**Your work, in parallel where files do not overlap:**
- Use Codex lanes and Claude sub-agents as before. The machine is strong, so run several lanes at once.
- Browser testing is on the real GPU.
- **Push early and often:**
  - commit and push your `local/*` branch at least every 30 minutes and at every milestone, WIP included;
  - use one branch per lane;
  - the connection can drop at any time; anything unpushed is lost to the cloud.

1. **Real-GPU runs, in quiet slots, one at a time:**
   - T029's browser count at real frame rates on dev (docs/dev/reports/local-T029/harness/emgcount.mjs, --dsf 1 --zoom 0), to confirm the cloud's virtual-clock numbers;
   - the quiet-slot addenda: W0.1's ultra A/A, the W1.1a bench, R1's timing, B1's repeat A/B with frames cadence, and T008's load-path trace;
   - T038's 1M timing on the GPU, once T038 is in dev.
2. **The render lanes (WORKER_DESIGN §6 rows R1 and R2, real-GPU gates):**
   - R1, TerrainRenderer dirty rects;
   - R2's remaining part, budgeting BuildingRenderer.add's LOD and geometry work at 2 ms per frame or less. T030 did the minimap and T038 does the fireworks.
3. **Polish round 2 (POLISH_PLAN §8.2), the lanes that do not collide with the cloud:**
   - SIM: NEW-05 first (unless triage took PB-TAXRESPONSE), then LG-09, LG-06, LG-07, LG-08, and LG-03's framework and Express Metro. FH-07b waits for W1.3.
   - WORLD: FEEL-09, FEEL-10, NEW-02, FEEL-14, FEEL-15, FEEL-17.
   - CONTENT: FEEL-06, LG-21, and LG-03's defs and models.
   - Queue each as a task file (T040 onwards) on your branch first.
   - GUIDE and META round-2 items wait until the cloud's guide and meta chains finish. I will say when.
   - Each lane gets the item's own acceptance, §8.2's verifier checks that apply, tsc, the full vitest, and the bot (identical to 192,899 unless the item changes balance by design; say so). Browser checks run on the real GPU.
4. **Merging.** Push each finished lane as `local/<lane>` with a `.done` line and its report. The cloud reviews,
   gates and merges it into dev, so do not push to `claude/beautiful-johnson-u2jqoz` yourself. Merge dev into your lanes
   often.

Report progress by pushing (a short `docs/dev/queue/` progress note on your branch is fine). If you can message the lead
session (simcityweb-33), also send a line when a lane is done or blocked.
