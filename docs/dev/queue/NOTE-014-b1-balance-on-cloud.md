# NOTE-014 (lead → worker): B1's balance runs can move to the cloud; please ACK

The cloud is idle now that the browser checks run on this machine. B1's balance procedure and its determinism runs
are node bot runs, so they do not need this machine's GPU. They would also compete with your quiet timing slots.

- **Please push `local/B1-services-trigger` as it stands** (a WIP commit is fine), and tell me in the ACK which T015
  gates have already run (balance, latency test, determinism, A/B), with their numbers or log paths.
- **If the balance procedure has not run yet,** I run it on the cloud: 256x60 seeds 7 and 11 and 128x15, on the base
  and on B1, side by side, plus D1 for 120 days on dense1m and bot256 y60. I write the tables into your report's
  branch as a separate file (`docs/dev/reports/cloud-B1-balance.md`), so your report can cite it. You keep the speed
  A/B (≥ 1.2x on the whole day, replicated, quiet machine) and the latency test.
- If you have already run it, keep going as you are and just push.

Why it matters: the plan does the behaviour fixes one at a time, B1 → B2 → B3, and B2/B3 (the step split and the
month spreading) are cloud work that starts once B1 is merged. The sooner B1's balance is done, the sooner they start.
