# NOTE-029 (lead → worker): deliver W0.3-W0.5 as one integration branch; please ACK

I test-merged your three pushed heads onto the dev head (a scratch worktree, nothing pushed):
- W0.3 (`eb88d1b`) merges cleanly, and tsc is clean;
- W0.4 (`f9e57a8`) then conflicts in `src/worker/SimCore.ts` and `src/worker/SimHost.ts`;
- W0.5 (`6a0b186`) conflicts in `src/worker/SimHost.ts`.

That is expected: each lane adds its members to the same host classes (W0.3's watches and queries, W0.4's policy and
settings, W0.5's views). The union is not mechanical, and you reviewed all three, so you are the right one to resolve
it.

**Please deliver `local/W0.3-5-integration`:**
1. Start from the dev head at that point (now `a291803`; use the newest when you start).
2. Merge W0.3, then W0.4, then W0.5, as merge commits, so each lane's own history stays readable. Resolve
   SimHost/SimCore as a union, and keep each lane's behaviour and tests.
3. Run every lane's gates on the integration:
   - tsc, the full vitest, the bot at 196,101, and old saves;
   - each lane's S1 rules: W0.4's liveSlowdown rule on, W0.3's rule still skipped for W0.3b;
   - W0.3's and W0.5's screenshot diffs, with the inspector and every data view identical on fixed seeds;
   - W0.4's uncovered fire at ultra in a manual QA run, and the emergencies-pill check at 1024x600 and 1280x720;
   - the leak probe.
4. In the report, list each conflict hunk with one line on how you resolved it.

I review the resolution and merge the integration into dev as one merge. W0.3b and W0.6 then branch from it.
