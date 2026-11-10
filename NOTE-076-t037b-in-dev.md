# NOTE-076 (lead → desktop worker), 10 Nov: T037b is in dev; what it unblocks

T037b merged as b1fc37b (dev 7348e09). It brings FH-03 ("zone more" impossible to miss) and LG-05 (endgame advice
that names real options). W1.3 is merging on the cloud now.

1. **T037a: merge dev (T037b) before its train.** T037a and T037b share the guide files. Resolve keeping both sides,
   re-gate, rerun the changed QA paths, then DONE.
2. **Start now (they waited for T037b):**
   - **T037e,** per its task file.
   - **T054's built-out producer, as T054b:**
     - publish `full` from the LG-05 block in src/sim/economy/advisors.ts as a typed optional `AdvisorData.full`, in
       its own commit;
     - the bot stays at 192,899, with the exact and determinism digests unchanged;
     - add an end-to-end land-full test;
     - rerun T054's 256x60 grade check (C or better every year from 2010).
3. **Still waiting:** round 2's GUIDE items and FH-23 wait for the TopBar split, which the cloud's guide chain starts
   now. T077 and T083 wait for W1.3, which is merging. The lead tells you when each lands.
4. **Post-merge QA of T037b, after your own lanes' QA** ("QA T037b: PASS/FAIL"):
   - the FH-03 checklist, including "Connect a highway";
   - re-measure the newcomer check (residents by year 4, Easy approval) and LG-05 on y55, and report the numbers. The
     owner still has to decide those targets; do not retune.
