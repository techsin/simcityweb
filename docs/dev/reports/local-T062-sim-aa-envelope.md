# T062 — shared SIM A/A envelope

Implemented on `local/T062-sim-aa-envelope`, HEAD `0df76bce1a663ee44957cf47cfecdb8b18eed187`,
whose parent/base is dev `9fcc2ec`. The task file's `683d02b` base is stale; this measures the worktree supplied
by the lead. The deliverable is [sim-aa-envelope.md](sim-aa-envelope.md).

Changes:

- `tools/simbot.ts`: optional finite signed `--aa-funds-nudge N` (also `=N`); adds only to `funds` after the
  first `advanceDay`, before the mayor's daily rule, exactly once. Setup, strategy, RNG and default output stay
  unchanged. Saved bot provenance includes the option only when supplied.
- `tools/simAaEnvelope.mts`: parameterised `--tree` runner, six sequential quiet-gated independent processes,
  full-precision annual JSON/NDJSON and deterministic hashes, Markdown tables and absolute/relative envelopes.
  Uses the selected tree's local Rolldown; completed matching-source runs can resume. A fresh output directory
  is required for the post-T041 measurement; the deliverable gives its command.
- `tests/sim/botAaFundsNudge.test.ts`: parsing/invalid amounts, signed and zero nudges, day-1 funds-only state
  comparison, no RNG draws, no repeat across 720 days, and flags-off versus zero annual/state identity.
- `docs/dev/reports/sim-aa-envelope.md`: measured pairs, commands, NOTE-048 usage and provenance.
- This file: handoff and verification notes.

No infra hunks, cloud-held edits, edits outside the named files/new tests, new saved keys or cloud requests.
The bot is expressly exempt from hosts in `WORKER_DESIGN.md` §5.2 and keeps its headless API.

Verification:

- `npx tsc --noEmit`: passed.
- `tests/sim/botAaFundsNudge.test.ts`: **11 passed**, exit 0. The ordinary command cannot load Vite's config
  (`spawn EPERM`); the runner loader hits a CommonJS import error and the native loader's default fork pool also
  hits `spawn EPERM`. The supported native loader plus thread pool passes through the quiet gate:

  ```powershell
  node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/node_modules/vitest/vitest.mjs run tests/sim/botAaFundsNudge.test.ts --maxWorkers=1 --configLoader native --pool threads
  ```

- The independent pre-edit 128×15 s7 process and instrumented flags-off process have identical **15/15 annual
  serialized-state SHA256s and every non-timing yearly row field**. Both end with residents
  `[61124, 93804, 37971]` = **192,899** in 2015. The deliverable records the hashes.
- `tests/sim/botLongGame.test.ts`: **28 passed**, exit 0, using the same quiet gate/native-loader/thread-pool
  command with that file name. This checks the existing options and default strategy isolation.
- Six A/A runs: **all complete**, exit 0, on one simulation source fingerprint. End populations, base / +§1:
  **192,899 / 192,899** (128×15 s7), **1,513,835 / 1,513,835** (256×60 s7), and
  **1,427,340 / 1,427,340** (256×60 s11). The deliverable contains every exact command and annual table.
- Every population, air, approval and I-HT share envelope is **0**, absolute and relative. Funds are exactly
  §1 higher at all 135 annual checkpoints of the nudged runs; the four measured metrics never diverge.
  The measured base band is therefore `max(the item's tolerance, ±1%)`; no larger perturbation was substituted.
- The independent raw-data check confirms all twelve zero maxima and [1, 1] annual funds-delta ranges.
  `--report-only` reproduced the generated report content exactly without rerunning any simulation.

Environment and plan differences:

- `tsx` is absent and npm's restricted cache cannot fetch it (`ENOTCACHED`). The repository documents local
  Rolldown as the fallback in `tools/balance-json.ts`; all actual simulations use bundled code and the quiet
  gate. The deliverable gives both actual child commands and the exact equivalent `simbot.ts` commands.
- Node child-process output pipes are restricted here. The runner collects git metadata through temporary
  files and launches bots with inherited output, with no synchronous child launches.
- The newcomer profile starts on day 90; for that optional combination the nudge applies on its first day
  from founding (day 91). The six specified default-profile runs apply it on absolute day 1.
- NOTE-048 replaces the older item tolerances with the maximum of the item's tolerance, 1%, and the measured
  envelope. All three rows shifting in the same direction by more than half the tolerance still require
  investigation. T041 must be measured separately; it has not been merged or simulated here.

Left for the lead:

- The post-T041 six-run remeasurement on the signed NEW-05 option-B dev tree.
- The full suite and standard real-GPU/browser smoke, as instructed. Hard-specific hash runs and old-save
  continuation were not run; no simulation formulas or save format changed in this task.
- No browser checks appear in T062's acceptance/gates. Browser checklist: **N/A**.
- Review/commit/push as desired. No commit, push, merge or `.done` file was made, per the session rules.
