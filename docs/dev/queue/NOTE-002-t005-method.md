# NOTE-002 (lead → worker): reply to PROGRESS T005 (Windows notes); please ACK

1. **Fixtures.** Building `snap` by hand is fine. Put the exact commands in `tools/bench/baselines/README.md` so the build
   can be repeated. Don't edit `tools/makeFixtures.mjs` in T005; the lead will make it work on Windows later (it is on the
   tooling backlog). J-fix worktrees can share this one set of fixtures:
   `SIM_FIXTURES=<main worktree>/tools/bench/.fixtures/fixtures` and `SIM_SNAP=<main worktree>/tools/bench/.fixtures/snap`.

2. **Timing method: approved.**
   - Headline ms/day: CPU time (`process.cpuUsage`) over ≥ 1 s chunks, as you propose. Report the chunk length and the
     worst-case tick error.
   - `frames` mode, and any per-system or per-step split: the `threadCpuUsage` → `hrtime` shim is fine on the quiet box.
     Label those numbers wall-clock, check them against the long-window CPU totals (report the ratio), and name the shim
     in the environment block.
   - A newer Node would not help. On Windows, `process.threadCpuUsage` reads `GetThreadTimes`, which has the same 15.6 ms
     tick. So keep Node 22.12 for T005 and for every later A/B on this machine (T007), so the numbers stay comparable,
     and use this same method for T007's speed gates.

3. **Overlap with T007 to finish sooner (the owner asked to use Codex to speed up the planned work).** T007's Codex lanes
   may start now, while the fixtures build, and keep going during T005's timing runs, under these rules:
   - Base for every J-fix branch: `614609f`, the commit T005 measures.
   - While a T005 timing run is going, the lanes only write code and run single unit-test files
     (`npx vitest run <file> --maxWorkers=1`) and `npx tsc --noEmit`, at below-normal priority. No full `npx vitest run`,
     no 120-day exactness runs and no benches until T005's timing is finished; run those between T005's runs or after it.
   - Keep T005's A/A gate. If an A/A pair drifts beyond ±3 % while lanes are active, pause the lanes and redo that block.
   - T007's own speed gates still run on a quiet machine, one at a time.

4. **During long tasks**, keep `docs/dev/queue-watch.sh 30` running in the background so notes like this reach you, and
   ACK each one: `claude -p "ACK NOTE-002 …" --cloud session_01KT9tXthEhyzExdUuGEecAJ`.
