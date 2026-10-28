# B3 work in progress (paused Oct 28, 00:45 UTC by the 5-hour limit and the wind-down)

**State:**
- The build agent had committed four of the design's steps: A0, T1, T2 and P3.
- It was partway through A1, the conditional last step. That work is in `uncommitted-A1.diff`, which includes the new
  `tests/sim/advisorsPredict.test.ts` and its notes in B3_DESIGN.md.
- Gates and verification have not run.

**To restore the branch:**
1. Branch from `a59f08f`, the base the design names.
2. Commit `docs/dev/B3_DESIGN.md` (rev 2, which is `a942542` in the original branch).
3. `git am` the four patches.
4. `git apply` the diff.

**To resume the workflow:**
1. Copy `docs/dev/wip/journals/b3-wf_96cfa1e8-a78.jsonl` back to the workflow's journal path, if the container lost it.
2. Rebuild the worktree as above.
3. Edit `docs/dev/workflows/b3-month-spread.js` so that its build step continues from the restored commits, and guard
   `gatesPrompt` against a null `build`.
