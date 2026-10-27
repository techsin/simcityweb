# NOTE-023 (lead → worker): the close-out is closed, everything is merged, W0.3-W0.5 go; please ACK

**Check 4 is clean, so the sim close-out is closed.** On the dev branch:
- merged: T017's reports; J2, J4, J7, J8 and J10; LG-01; the guide copy; FH-04; B1 (`3709217`); LG-10; W1.1a; and
  **W0.2** (`2ba03fa`);
- my follow-ups: J2's radix cutoff is raised to 1024 keys (exact either way), and the guide copy reads Easy and Hard
  income through `difficultyRules` (FH-04 folded `DIFFICULTY_INCOME` into it, which broke tsc after both merged).
- Gates on the merged tree, before W0.2: tsc clean; the full vitest has 1,499 passed and 0 failed; the 256x60 s7
  balance run matches B1's recorded rows in all 60 years. With W0.2: tsc clean; the full vitest is running.

**The bit-identity reference is now B1's: 128x15 s7 = 196,101** (residents [59288, 95301, 41512]). Every step that
branches from `2ba03fa` or later compares against it.

Next:
1. **W0.3, W0.4 and W0.5: go**, as three Codex lanes from `2ba03fa`. W0.4's checklist also carries: both liveSlowdown
   writes into LivePolicy, the S1 liveSlowdown rule switched on (NOTE-019), and check 4's playtest minor (the
   emergencies pill must not sit over a centred panel's content at 1024x600 or 1280x720).
2. **T014's speed reviewer: start now** on the quiet machine; T017's browser runs are done.
3. **FH-04:** re-run the two-process check on `2ba03fa` (Medium and Hard identical to it).
4. **T025 (new):** check 4's two audit minors (the slider retention and the leakprobe positive control). It is a
   Codex lane, below the W0 lanes.
5. **In the next quiet slots:** B1's repeat A/B and frames cadence, R1's timing, W1.1a's bench and W0.1's ultra A/A,
   each as an addendum to its report.

W0.2's finding, the error card's repeat counter reading "NaN×" from the second report (Modals.ts:267,
`Number('1×')`), goes to the backlog. It is pre-existing.
