# NOTE-037 (lead → worker): continue, but one item at a time, finishing each; no new Codex lanes; please ACK

On your STATUS: the daily (5-hour) limit reset, but the weekly limit is what NOTE-035 is about. It does not reset until
Mon 2 Nov, 15:00 UTC. I've asked the owner whether "continue as before" means full parallel again. Until they answer:
- work one item at a time, and finish each one fully;
- start no new Codex lanes. T035b, T037b, T037c, T036 and the TopBar split wait for the reset.
If the owner says full speed, I'll send a note.

**Dev now** (`claude/beautiful-johnson-u2jqoz`):
- `cee02aa` merges W0-complete (3e17a36), T014 and T025. The cloud's tsc is clean; its full suite and bot run now.
- T026 and T008 merge next. T008 carries my fix commit for the cloud gates' findings: the hide fade anchors its ramp,
  rests count from the fade's start, and the mock AudioParam is now Chromium-like.
- **T010 waits for the reset.** The cloud art review found a major: every Stock Exchange setback roof z-fights. The
  RoofFlat cap and the cornice cap are coplanar at y1, about 1,000 m² per variant. Three minors go with it: the WTC
  roofs have the same construction, Grand Central v1's vault-foot strips sit 3.8 mm apart, and the Crown v1's ribs 4 mm.
  The registration needs pendingCatalog (T035b). One fix round after the reset covers all of it.
- **T014 finding 1:** your own evidence shows ring on minus ring off is about 0 µs per frame. So the far orbit is not a
  ring segment, and I am not using the ring allowance. I accept it as a **minor on magnitude** instead: +93 µs per frame,
  on the first far orbit of a fresh HIGH page only; warm, it is 0.58x base, and the page's pooled sum is 0.95x base.
  Two items go to POLISH_BACKLOG, re-measured in the final verification:
  - one hidden HIGH far-orbit pose in warmView;
  - a trace of the dense city's extra tasks outside the callback on its first far orbit (827 vs 468 per 60 frames).
  Render round 2 is closed.

**Your order, one at a time:**
1. **T027's camera QA** (running): finish, push, `.done`.
2. **W0.3-W0.5 browser QA on dev `cee02aa`** against base `4c90468`. The cloud's run died at the 5-hour limit with no
   results.
   - Use the three briefs QA03, QA04 and QA05 in `docs/dev/workflows/w0-integration-qa.js`: W0.3 Appendix A consumers;
     W0.4 live policy, the pill and check 4's pill-over-panel minor; W0.5's three views, the ticker and the data views;
     each with the leak probe.
   - Skip the items your W0-complete session already covered.
   - One session, one report, `docs/dev/reports/local-W0.3-5-qa.md`.
3. **The gated lanes, in this order:**
   - T030's timing gate; add the dense-city first-far-orbit trace above if it is the same harness;
   - T038's 1M timing, screenshots and report;
   - T037d's browser checklist;
   - T028's harness runs.
4. **Then the W1 lanes, one at a time:** T032, T031, T033, T034, then T029. Merge dev's head into each lane when its
   turn comes, not all now, so each merges once. Then gate and review it.

Keep sub-agents to the minimum each item needs.
