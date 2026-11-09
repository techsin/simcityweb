# Handoff, 4 Nov 2026 03:45 UTC: the lead's cloud session stops at its usage limit

**The usage limit is shared.** The cloud lead, every workflow agent and the desktop all draw on one plan limit,
so the cloud workflows below stop with it. This note and the bundles were pushed straight to dev at 03:45, without
waiting for the merge lock.
- **T040's merge (desk7) was mid-push:** its merge commit 3b98d02 was in the container's main checkout. If it is
  not in dev when you look, redo T040's merge from `bundles/cloud_t040.bundle`.
- **T058's merge (desk5):** the same applies.

Read this first when you pick the project up. The desktop worker also paused at about 03:10 UTC; its last state is
in its messages, summarised under 4 below.

## 1. Dev (`claude/beautiful-johnson-u2jqoz`)

- **Head at handoff:** 086152a, T034's carry-over log line.
- **Bot reference:** `residents [ 61124, 93804, 37971 ]` = 192,899 (128×15 seed 7, 2015).
- **Merged on Nov 3-4:**
  - T033 (d101122);
  - T029 (3aff6e0);
  - T037d (f85d538);
  - T036 step 2 (b71b2c2);
  - B3 (530d570);
  - T038 (c3aaaed);
  - T036 step 3 (0e7c2b0);
  - T052 (9446c70);
  - T034 with T034b, W1.2 the sim in a real Web Worker behind `?simworker=1` (5c40d77).
- **Mid-merge at handoff:** T040 (desk7) landed after this note as fe21e41; T053 (desk8) and T058 (desk5) were still merging. Their merge agents
  push only after the full vitest and the bot pass. If the session died before they pushed, the main checkout
  holds an unpushed merge commit. Re-run that merge from the bundle (section 3), or let the resumed chain redo it.
- **Lead decisions** are in docs/dev/queue/NOTE-048 … NOTE-059. The ones that change gates:
  - **NOTE-053:** SIM balance rows are judged on 5-run ensemble medians (9 runs near a threshold), with X = §100.
  - **NOTE-050:** NEW-05 (T041) is signed as option B.
  - **NOTE-056 and NOTE-058:** LG-03 round 2 is judged on the framework and Express Metro; the "≥ 3 projects"
    target and the 2045 funds target wait for round 3.
  - **NOTE-057:** the merge order. Wave 1 now; wave 2 after B2.
  - **NOTE-059:** browser checks run on the desktop. The cloud skips them for desktop lanes, and cloud lanes end
    their report with a "Desktop QA" list.
  - **The B2 gate-4 amendment:** in the b2m brief, and in section 2 below.

## 2. Cloud workflows running at handoff

They stop when the session stops. Each row gives its run ID, its lane or lanes, the step it was on, and what is
left. The scripts are in `workflows/` here; the lock tools are in `tools/`.

| chain | run ID | lane(s) | step at handoff | then |
|---|---|---|---|---|
| b2m | wf_4a40edd0-dfd | B2 integration (b2-step-split + dev) | finish | review, merge. **Unblocks wave 2.** |
| worker | wf_a246713f-76f | W1.3 (T039), cloud/w13 | finish:w13 | review, merge |
| worker3 | wf_06aeda2d-d71 | T061 worker host fixes, items 1-7 + F1-F3 | finish | review, merge |
| guide | wf_43f14c6d-2a2 | T037b, then the TopBar split | review:t037b | merge, then topbar |
| sim2 | wf_34e2e628-27f | T057 save/load continuity | finish | review, merge (holds for B2 if infra) |
| meta2 | wf_7749c1e1-231 | T060: FEEL-01, then FH-12 | finish:t060feel01 | then FH-12 |
| desk1 | wf_f5a58cba-a0d | R1 (T021) | finish | review, merge |
| desk2 | wf_564ff2b9-da1 | T048 | review | merge (before T036s5, NOTE-057) |
| desk3 | wf_c6c5a88b-778 | T059, then T028 | finish:t059 | then T028 |
| desk5 | wf_7658232a-322 | T058 | merge | done |
| desk6 | wf_2c7d6b2f-51a | T054 | fix | rereview, merge |
| desk7 | wf_f58cd6f0-465 | T040 | merge | done |
| desk8 | wf_b364d705-e0b | T053 | review | merge |
| desk9 | wf_61138dc2-48d | T036 step 5 (FH-08) | finish | review, merge |
| desk10 | wf_62e02cb7-fe2 | T036 step 4 (NEW-04 + FEEL-02b), local/T036s4-storage @ 3e7c299 | finish | review, merge |

**How to resume a chain in the same session after a restart:**
1. Keep the run's exact args.
2. Add every in-flight agent label (one that started but has no result in
   `subagents/workflows/<run>/journal.jsonl`) to `resume`.
3. Call `Workflow({scriptPath, resumeFromRunId})`.

Completed agents replay from cache.

**In a NEW session the run cache is gone.** Relaunch a chain fresh:
- `desk-chain.js` for a desktop lane (`desk: true`; no browser, a light verify).
- `cloud-chain.js` for a cloud lane (its browser checks go to the desktop).
- `carryover-chain.js` is the original.

Restore the lane's branch from its bundle (section 3) first. The finish step then picks up the branch as it is.
Briefs to copy are in the session transcript; the B2 brief is summarised below.

**B2 (b2m) at handoff.** b2-step-split (W, 1abb357) is B1-based and must be merged with dev (B3's month spread and
the rest). b2m's finish agent was doing that merge, with uncommitted work in `wip/co_b2m.uncommitted.patch`.
- **The gates:** tsc, the full vitest, the bot (it changes by design; record the new reference), exactness and
  determinism, the save/load checks, one gate-4 hold, and B2's 256×60 balance check.
- **The amended gate 4:** per-run median of the all-task max step ≤ 5 ms in each from-load window, steps that
  overlap a GC excluded; the first cold run of each piece kind ≤ 8 ms. p99 ≤ 3 ms and the warm max ≤ 5 ms stay
  strict.
- **Before the amendment:** B1's max step was 33 ms; W's per-run median was 3.7-3.9 ms. The cold first-run residue
  (transit.search 5.8 ms) goes to S5.

## 3. Unmerged work that existed only in the cloud container

`bundles/*.bundle` hold every unmerged cloud branch: `git bundle create <dev>..<branch>`, based on dev 086152a.
To restore one:

    git fetch docs/dev/handoff/2026-11-04/bundles/b2-step-split.bundle b2-step-split:b2-step-split
    git fetch docs/dev/handoff/2026-11-04/bundles/cloud_w13.bundle cloud/w13:cloud/w13

| branch | commits | what it holds |
|---|---|---|
| b2-step-split | 49 | **B2**: the step split and the recalibrated cost(), with its fix round, B1-based. |
| cloud/b2m | 54 | **B2 integration in progress**: b2-step-split with dev merged in by the b2m chain. Start here. |
| cloud/w13 | 9 | **W1.3**, persistence in the worker (its own IndexedDB, the journal and boot replay). Contains T034. |
| cloud/t037b | 24 | **T037b**: LG-05 built-out advice, FH-03, and the rest of GUIDE sub-lane b, finished and in review. |
| cloud/t057 | 10 | **T057**: save/load continuity, in progress. |
| cloud/t060feel01 | 6 | **T060 FEEL-01**: the news ticker, in progress. |
| cloud/r1, t048, t059, t054, t053, t036s5, t036s4, t058, t040 | 9-17 each | The desktop lanes plus the cloud's dev merges and review fixes. The desktop's own work is safe on `local/*`. |

`wip/*.uncommitted.patch` hold the uncommitted changes of the agents that were mid-step, as of 03:45 UTC: b2m,
t036s4, t054 and w13. Apply one with `git apply` in that branch's worktree if you want the partial step; otherwise
let the step redo it.

## 4. The desktop worker: final handoff at 03:52 UTC (its plan limit was reached)

**Its final state:** every desktop branch is committed and pushed, and matches its remote.
- **Done, with a .done:** T042, T047, T058, T054, T059, T040, T041, T053, T036s5, T036s4, T048, R1 and T028.
  T052 is in dev.
- **Stopped unfinished, with no result:**
  - T037a's first full real-GPU QA (gated green at 8971260, 2,278 tests);
  - the T049/T050/T051 real-GPU QA (all gated green; T051 at 142c612).
  - Their briefs are only in the desktop's scratchpad (qa/T037a_brief.md and qa/T049-T051_brief.md).
- **Still running unattended:** T062's NOTE-053 ensembles for T043/T044/T045, a Codex job. Its outputs go to the
  desktop's scratchpad (lanes/T062/scratch/note053-lanes/T04x.md), and its worktree edits to
  local/T062-sim-aa-envelope-snap every 25 min. Nobody pastes them into the lane reports until a later session.
- **Left for later:**
  - T055's model QA (gated green, 2,364 tests, bot 193,831);
  - T046's report update (Express Metro completes on 1 Feb 2025, Fusion in 2039, Expo in 2041; lowest balance
    §4,481);
  - the T043/T044/T045 verdicts from those ensembles;
  - T053 R4-1;
  - T037e and T054's producer (they need T037b), the TopBar hunks, and FH-08 after FEEL-10;
  - merging dev into later lanes as wave 1 lands;
  - T056's timing blocks.

### The earlier status, at 03:10 UTC

Every desktop lane branch is pushed (`local/*`, plus `local/*-snap` snapshots).

- **DONE, waiting for the cloud to merge:**
  - in cloud chains now: T058, T054, T059 (4fb8bf2 adds a tsc fix after the chain's base), T040, T053, T048, R1
    and T028;
  - T036s5 (bdb92a9);
  - holding for B2: T041 (ea0856d), T042 (a8257e9) and T047 (7111b02).
- **T036s4 is DONE** at 3e7c299 (03:50 UTC; every round-1 bug fixed on the real GPU), and the cloud's desk10 chain
  is verifying it.
- **Gated green, real-GPU QA was still running:** T037a (8971260+), and T049/T050/T051 (T051 at 142c612).
- **Running:** T055 (857b445; its model QA has not started), and T062's NOTE-053 ensembles for T043/T044/T045.
  T043/T044/T045 hold until those ensembles exist.
- **Not started:**
  - T046's report update;
  - T055's model QA;
  - T053 R4-1 (in the backlog);
  - T037e and T054's built-out producer (they need T037b);
  - the TopBar hunks (they need the TopBar split);
  - FH-08's rebase onto FEEL-10;
  - T056's timing blocks;
  - the wave-2 final gates;
  - merging dev into later lanes as wave 1 lands.
- **Cloud follow-up:** after T059 merges, also merge `local/T059` @ 4fb8bf2 or later: the docs, the .done and the
  test-file tsc fix.

## 5. Where to continue, in order

1. **Let the in-flight merges finish:** T040, T058, then T048, T053, T054, T059 + T028, R1 and T036s5, in
   NOTE-057's wave-1 order.
2. **B2:** finish b2m (integrate, gate, merge). Then wave 2 in NOTE-057's order: T041, T042, T047, T049,
   T043-T046, T055. Each SIM lane's final gate uses NOTE-053's ensembles on the dev that holds T041.
3. **The cloud lanes:** T061 (worker host fixes), W1.3, T037b and then the TopBar split, T057, then T060's FH-12.
   After that, FEEL-21 and FH-23. Then round 2's GUIDE items: FH-18, FH-17, FH-14, FEEL-19, FH-15, FH-16, FH-13,
   FEEL-03, NEW-06, NEW-07.
4. **When the desktop returns:** the Desktop QA lists of merged cloud lanes (NOTE-059), T028 in worker mode now that
   T034 is in dev, the remaining desktop QA, and the not-started items above.
5. **Then:** S5 and W1.4 (the worker on by default), rounds 3 and 4, and the final verification, soak, README and
   build.

**Still waiting on the user:**
- T037b's newcomer target (283 residents by year 4 against 5,000; Easy approval 39 %), and LG-05 never firing on
  y55.
- An OK to delete about 12 GB of stale `/tmp/<21-char>/ssr` folders left by vitest. The cloud disk had 4.6 GB free.
  The command is in the session.

## 6. Machine notes (cloud)

- **The shared lock.** Every heavy command (the full vitest, the bot, browsers, timing) runs behind
  `tools/lock.sh timing`, and only one runs at a time. That lock is the bottleneck: 15-28 waiters at a time.
- **`tools/fairlock3.sh`** hands the lock to the next waiter in this order: merges first, then short jobs, then the
  full vitest, then browser runs. It does that without signals.
  - **Never SIGSTOP a waiter.** The waiting agent's shell returns 147 and the work is duplicated.
- **Disk.** vitest leaves a ~9 MB `/tmp/<21-char>/ssr` folder on every run. Clean the old ones, with approval, when
  the disk gets low.
