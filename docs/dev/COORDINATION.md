# Cloud lead + local GPU worker

How the cloud session (the lead) and Claude Code on the owner's computer (the local worker) share the work.
Git is the shared state; messages are only nudges. Anything a machine needs to know lives in the repo.

## Roles

| | Cloud lead (claude.ai cloud session) | Local worker (owner's computer) |
|---|---|---|
| Runs | Planning, sim/UI/code fixes, audits, node tests and bot runs, integration, commits on the dev branch | Work that needs a real GPU or lots of RAM: render perf on real hardware, art review shots, long soak tests, 1M+ population profiling; optional Codex runs (separate quota) |
| Branch | `claude/beautiful-johnson-u2jqoz` (the only branch the lead pushes) | `local/<task-id>`, cut from the dev branch at the commit named in the task; never pushes to the dev branch |
| Merges | Reviews and merges `local/*` work into the dev branch | — |

## Channels

1. **Task queue (lead → worker):** the lead commits one file per task (and any note for the worker) to
   `docs/dev/queue/` on the dev branch. The worker waits on `docs/dev/queue-watch.sh 30` in the background: it fetches
   every 30 s and exits, waking the worker, only when the queue folder changes (it prints the new files). The worker then
   re-reads every task file without a matching `docs/dev/queue/<task-id>.done`, works the open ones, and restarts the watcher.
   This is the only lead → worker channel: a cloud session may not message a Remote Control session or fire a scheduled
   task bound to it (only that session itself or a person can), by design.
2. **Reports (worker → lead):** the worker pushes its branch with the report at `docs/dev/reports/local-<task-id>.md`, then
   tells the lead at once by queueing a message into the cloud session:
   `claude -p "DONE <task-id> local/<task-id>@<sha> report: docs/dev/reports/local-<task-id>.md" --cloud session_01KT9tXthEhyzExdUuGEecAJ`
   Use `ACK <task-id>`, `BLOCKED <task-id> <reason>` or `PROGRESS <task-id> <one line>` the same way. The lead also watches
   `local/*` branches on GitHub every 2 minutes, so a lost message costs at most that.
3. **Owner nudges (optional):** the worker created a poke-only scheduled task bound to itself
   (`trig_01Hpn2papFZYkWa2ifKYw7D7`, "Metropolis lead → local GPU worker"). The owner can run it from the Claude app to
   wake the worker by hand; the lead cannot.

## Task file format

```
# <task-id>: <title>
base: <commit on the dev branch to branch from>
owns: <files or areas the worker may change; everything else read-only>
do: <what to do, with the method>
gates: <what must hold before reporting DONE>
report: docs/dev/reports/local-<task-id>.md (what to put in it)
```

## Rules for the local worker

- Work in a dedicated clone of `techsin/simcityweb`; never on a fork. Keep the clone clean between tasks.
- One task at a time per worker session; stay inside `owns`.
- Real-GPU measurements: launch Chromium with hardware acceleration (no SwiftShader flags) and report the GPU, driver,
  browser version and OS in every report. Compare sides only within your own runs (interleaved A/B, a fresh browser
  per side per rep for fresh pages, ≥ 8 reps, medians + 90 % bootstrap CIs + A/A copies), like the cloud reviewers.
- Look at every screenshot you cite; commit small evidence (tables, a few PNGs) under `docs/dev/reports/local-<task-id>/`
  and keep bulky evidence out of git.
- Codex (if the owner allows it): use it for an independent second review or for a well-specified implementation step,
  then check its output yourself; say in the report which parts came from Codex.
- No secrets, no credentials, no personal data in commits or messages.
- Shared limits: local Claude sessions use the same weekly usage pool as the cloud session, so the lead moves GPU work to
  the worker instead of running it in the cloud as well.

## Starting the worker (owner, once)

```
git clone https://github.com/techsin/simcityweb && cd simcityweb
git checkout claude/beautiful-johnson-u2jqoz && npm ci && npx playwright install chromium
claude remote-control        # or: claude --remote-control "metropolis-gpu"
```
Then tell the worker: "You are the Metropolis local GPU worker. Follow docs/dev/COORDINATION.md: check the task queue every
10 minutes and work the open tasks." Keep the computer awake while it works.
