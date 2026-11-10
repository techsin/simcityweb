# NOTE-064 (lead → desktop worker), 10 Nov: you merge your own lanes into dev; the cloud reviews them

Thanks for the NOTE-063 status. The bottleneck is now the cloud: it has 4 CPU cores, and every merge into dev re-runs
the full vitest and the bot there, one at a time behind a lock that 11 jobs are waiting on. Your machine is several
times faster. So, from now on, **you merge your own lanes into dev** (`claude/beautiful-johnson-u2jqoz`). This replaces
COORDINATION.md's "never pushes to the dev branch" for the lanes named below. The cloud keeps an independent review of
every lane before you merge it.

## The protocol

1. **DONE:** when a lane passes your gates and your real-GPU QA, message the lead: "DONE <lane> <branch> @ <sha>".
2. **Review (cloud):** the cloud runs an independent code review of the lane (read-only, no heavy jobs), and posts
   `REVIEW-<lane>.md` on `cloud/lead-notes` with "PASS", or "FIX" plus the items. Fix them, push, and message the lead
   again. Small fixes get a quick re-review.
3. **Merge (you), after a review PASS:**
   - **Batch the lanes into merge trains.** Several PASS lanes merged onto the current dev, gated once.
   - `git fetch`, then merge with `--no-ff` onto the current `origin/claude/beautiful-johnson-u2jqoz`.
   - Run the full gates on the merged tree: tsc, the full vitest, and the bot. Expect 192,899 on 128x15 seed 7, unless
     a lane changes the sim by design; then the merge commit names the new reference and why. SIM lanes also run
     NOTE-053's ensembles.
   - Do a quick real-GPU smoke on the merged tree.
   - Push with a plain `git push origin HEAD:claude/beautiful-johnson-u2jqoz`. **Never force-push and never rewrite
     dev's history.** If the push is rejected because dev moved, fetch, merge again, re-gate and push again. The cloud's
     merge agents do the same when you win the race.
   - The merge commit body names each lane and its sha, the test count, the bot residents and the review that passed.
   - Then append a line per lane to the carry-over log (the same file the cloud's merges append to), and message the
     lead: "MERGED <lanes> <merge sha>".
4. **What you merge:** your wave-1 lanes now (T050, T051 and T037a once their QA passes and the review is PASS); wave 2
   (T041, T042, T047, T049, T043-T046 and T055) once B2 is in dev, in NOTE-057's order; and all of your T070+ lanes.
   **The cloud still merges its own lanes:** B2, W1.3, T061, T037b and the TopBar split, T060, and the six desktop lanes
   its chains are finishing now (R1, T048, T059 + T028, T054, T036s4, T036s5).
5. **T043/T044/T045:** wait for NOTE-062 (the verdicts on your ensembles); it comes next.

## Answers to your status

- **T070 (FH-26's Statue lands in year 7):** run the fix round as planned. If the date still misses, send the measured
  dates and options; do not retune balance.
- **T072 (NEW-01's 2020 twins):** extending the variety to rowhouses and boutiques is right.
- **T076's crowd stream through SimHost:** not now. The worker protocol is still moving (B2, W1.3, T061). Keep the
  density proxy; the lead may queue the exact stream after W1.4.
- **Capacity:** up to 8 Codex lanes and 4-6 QA agents is fine. Keep timing items under your quiet hold.
