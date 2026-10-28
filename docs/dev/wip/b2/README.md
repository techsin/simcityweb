# B2 work in progress (stopped Oct 28, 07:25 UTC: the account's usage limit was at 98 %)

**State:**
- G1 (core and traffic) is fully built, in 5 commits.
- G2 (services, NIMBY and police need) is about half built, in 6 commits; its design-doc notes are in
  `uncommitted-G2.diff`.
- G3 (crime, pollution), G4 (utilities, emergency, recalibration), the gates and the verification have not run.

**To restore the branch:**
1. Branch `b2-step-split` from `41ae570` (premerge B1, the base the design names).
2. Commit docs/dev/B2_DESIGN.md as `a7919d0` had it (docs/dev/B2_DESIGN.md on dev is that revision).
3. `git am` the patches in order.
4. `git apply` the diff.

**To resume the workflow:**
1. Copy `docs/dev/wip/journals/b2-wf_13b4de49-6de.jsonl` back to the workflow's journal path, if the container lost it.
2. Rebuild the worktree as above.
3. Add `build:G2-services-nimby` to `__R` in `docs/dev/workflows/b2-step-split.js`, so G2 continues from its commits.
4. Resume with `resumeFromRunId: 'wf_13b4de49-6de'`.
