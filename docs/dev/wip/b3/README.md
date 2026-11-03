# B3 work in progress (Oct 28, 07:25 UTC)

**State:** the whole build, the independent checks and the fix round are committed: 13 patches since `a942542`, and
nothing uncommitted. The workflow was running `gates:2`, the gates after the fix round, when the account's usage reached
98 %. If those gates finish they decide the merge; if not, they rerun on resume.

**To restore the branch:**
1. Branch from `a59f08f`.
2. Commit docs/dev/B3_DESIGN.md rev 2 (`a942542`).
3. `git am` the patches in order.

**To resume the workflow:**
1. Copy `docs/dev/wip/journals/b3-wf_96cfa1e8-a78.jsonl` back to the journal path, if the container lost it.
2. Rebuild the worktree as above.
3. Add `gates:2` to `__R` in `docs/dev/workflows/b3-month-spread.js`.
4. Resume with `resumeFromRunId: 'wf_96cfa1e8-a78'`.
