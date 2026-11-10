# NOTE-083 (lead → desktop worker), 10 Nov: B2 is in dev. A new bot reference, and wave 2 can go

B2 merged as 2dd0fe5 (dev a7b7215, which also carries the LG-06 plan amendment). Its full vitest passed 3,027 tests.

## 1. NEW BOT REFERENCE: residents [ 61828, 95515, 40772 ] = 198,115 (128x15 seed 7)

The change is by design: the headless schedule follows B2's pieces and cost() estimates. **From now on every gate on
a tree that contains 2dd0fe5 expects 198,115.** A lane gated on an older base keeps comparing to 192,899 on that base.
Its merged-tree gate (your train) uses 198,115. Any lane that changes the sim by design states its new number against
198,115.

## 2. Wave 2 can merge now, in NOTE-057's order (T043 is cut)

T041, then T042, T047, T049, T046, T055, then T044 and T045 after their final gates. For each lane:
1. merge dev (B2) in, re-gate it (tsc, full vitest, the bot), and send "DONE <lane>";
2. the cloud reviews it;
3. you merge it in a train.

**The SIM lanes follow NOTE-053 and NOTE-062:**
- T041 merges first.
- Then T062's runner builds dev's 9-member ensembles on the B2 + T041 dev (the A/A envelope, the three base rows,
  `--skip dirty`, `--subway`). With T043 cut, its `--neglect` rows are dropped.
- Then T044's and T045's final gates. Run the ensembles in your quiet slot, 3-4 members at a time.

## 3. Unblocked now (they waited for B2)

- **The SIM polish items:** round 2 LG-09; round 3 LG-15 (its damage charge is now disasters-only, see the plan),
  LG-16, LG-18, LG-19, LG-04; round 4 LG-17, LG-22, LG-23, LG-25, LG-26, LG-11.
  - Their balance gates use NOTE-053/062's ensembles on the dev with T041.
  - Start the ones whose files do not overlap the wave-2 lanes.
- **T079: S5, the frame budget** (WORKER_DESIGN's S5 row): real-GPU timing in your clean window.
- **T096: the FEEL-07 firsts producer.**
- **T063, infrastructure save/load continuity (T057's follow-up): the cloud takes this one.** It is sim-only and needs
  no browser, so you have one lane fewer.

## 4. B2's Desktop QA (docs/dev/reports/local-B2-step-split.md)

- **Item 1, required:** the quiet-machine gate-4 re-measure. B2's gate 4 (per-run median of the all-task max step at
  most 5 ms from a load, with GC-overlapping steps excluded; first cold run per piece kind at most 8 ms; p99 at most
  3 ms and warm max at most 5 ms strict) was not confirmed on the busy cloud. Run it in your clean timing window with
  nothing else running. Report "QA B2 gate 4: PASS/FAIL" with the numbers.
- **Item 2, optional:** the profile window.
