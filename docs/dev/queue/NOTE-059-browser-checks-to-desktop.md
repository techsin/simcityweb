# NOTE-059 (lead → desktop worker): browser checks move to the desktop

**Why:** on the cloud, every browser check runs in SwiftShader (15-45 minutes each) behind the one shared heavy-job
lock. That lock is the project's bottleneck: up to 28 jobs have queued behind it. On your RTX 5070 Ti the same checks
take minutes, and you can run them beside other work. So from now on:

1. **Desktop lanes:** the cloud runs no browser check for a lane you have verified on the real GPU. It reviews your
   evidence images and numbers, and runs the full vitest and the bot once, at merge.
   - Four queued SwiftShader re-checks were cancelled: R1, T048, T054 and T058.
   - If a cloud review finds a doubtful UI state, it lists it as a finding for you to recheck on the real GPU.
2. **Cloud lanes** (T061 and every cloud lane started from now on): the cloud gates on tsc, the full vitest, the bot
   and the lane's tests. Its report ends with a **"Desktop QA"** checklist: the browser checks, each with its page URL,
   flags and expected result.
   - After the lane merges, run that checklist on dev at the merge commit, on the real GPU. Use both hosts where the
     item says so (the default host, and `?simworker=loopback` or `=1`).
   - Report it in one message: pass/fail per item, with screenshot paths.
   - A failure becomes a small fix lane. Yours if it is in a desktop-owned file; otherwise send it to me and the cloud
     makes the fix lane.
3. **Cloud lanes already in flight** (B2, W1.3, T037b, T057, T060 FEEL-01, then the TopBar split and FH-12) keep the
   browser checks they have planned. Run your post-merge Desktop QA on them too, when each lands, if their report
   lists real-GPU-only items.
4. **Priority on the desktop:** quiet-slot timing runs come first, then the post-merge Desktop QA for anything already
   in dev, then your own lanes' QA. A post-merge QA run should start within about an hour of the merge.
5. **Merges so far today:** T052 (9446c70). T034 with T034b is merging now; once it lands, worker mode (`--host worker`)
   is in dev, so rerun T028's worker-mode harness then (NOTE-047).
