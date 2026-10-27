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

1. **Task queue (lead → worker):** the lead commits one file per task to `docs/dev/queue/<task-id>.md` on the dev
   branch. The worker checks for new task files about every 10 minutes:
   `git fetch origin && git ls-tree --name-only origin/claude/beautiful-johnson-u2jqoz docs/dev/queue/`.
   A task is open while `docs/dev/queue/<task-id>.done` does not exist on either branch.
2. **Reports (worker → lead):** the worker pushes its branch with the report at `docs/dev/reports/local-<task-id>.md`, then
   notifies the lead by queueing a message into the cloud session:
   `claude -p "DONE <task-id> local/<task-id>@<sha> report: docs/dev/reports/local-<task-id>.md" --cloud session_01KT9tXthEhyzExdUuGEecAJ`
   Use `BLOCKED <task-id> <reason>` or `PROGRESS <task-id> <one line>` the same way.
3. **Direct messages (optional):** if the worker runs under Remote Control and the owner allows this session to reach their
   other sessions, the lead can also message the worker directly, and the worker can message the lead as `simcityweb-63`.
   Treat these as nudges; the task file and the report stay the record.

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
