# T062 — shared SIM A/A envelope

Current final-gate workflow: [NOTE-062 runner and observers](sim-aa-envelope.md#note-062-final-gate-runner-and-observers), amending NOTE-053. Earlier rounds below retain historical measurements and interim verdicts; final gates use the lead's current rules on dev including B2 and T041.

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
  This historical no-fork result remains unchanged; current NOTE-053 gates use ensemble medians and bands.
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
- NOTE-053 now replaces the earlier NOTE-048/052 margin rules with ensemble medians and bands. The original
  measurements above predate T041; Round 4 below supplies its separate ensemble measurement.

Left for the lead:

- The post-T041 measurement was outstanding at Round 1; Round 4 completes it with NOTE-053 ensembles on the supplied signed NEW-05 option-B tree.
- The full suite and standard real-GPU/browser smoke, as instructed. Hard-specific hash runs and old-save
  continuation were not run; no simulation formulas or save format changed in this task.
- No browser checks appear in T062's acceptance/gates. Browser checklist: **N/A**.
- Review/commit/push as desired. No commit, push, merge or `.done` file was made, per the session rules.


## Round 2 — Fork-noise envelopes (historical)

Report-only follow-up on committed `3833c8d`. [The new section](sim-aa-envelope.md#fork-noise-envelopes) records every first command/log fork, year-10-onward metric delta, cross-size range, exact command and source hash. Only this note and the report changed in the repository; diagnostic runners and output remain in the lane scratch. The original report bytes and all baseline fixtures are preserved. No production code, infra, cloud-held or outside-scope hunks; no cloud requests.

- **17 runs completed**, sequentially through the quiet gate: three controls, +§10/+§100/+§1,000/+§10,000 on all three rows, and +§10 on days 1,800/4,320 of 128×15 s7.
- **Recommend +§10 on day 1 as the minimal tested common probe**, with the reported directional-shift diagnostic retained. It first forks on days **3,720 / 4,260 / 4,590**. This is a tested-grid minimum, not a sub-§10 threshold search.
- +§10 endpoints: **191,754 / 1,287,517 / 1,362,916**, against unchanged controls **192,899 / 1,513,835 / 1,427,340**. All three population losses exceed half the diagnostic bands: investigate before calling this unbiased noise. Larger-nudge envelopes are non-monotonic; do not choose a wider tolerance by endowment size.
- Day 1,800 reproduces the 128×15 day-1 commands/logs/metrics; day 4,320 reproduces the unnudged commands/logs/metrics and retains exactly §10 more funds from year 12. No 256×60 timing probe was run.
- Gates: `npx tsc --noEmit` passed; `tests/sim/botAaFundsNudge.test.ts` **11 passed** (quiet gate, native loader, threads). Independent scratch validator passed **705 annual observations, 135 unchanged control hashes/rows, 56 envelopes, first-action indices and timing comparisons**. Original flags-off 128×15 s7 stays **192,899**, residents `[61124,93804,37971]`.
- Plan/code difference: the specified +§1 probe never forks; +§10 does, but its shared negative endpoint pattern means this calibration cannot be presented as proven unbiased noise. No balance calibration or baseline re-recording was made.
- Outstanding at Round 2: the systematic-direction investigation and post-T041 measurement. Rounds 3–4 add the signed/timed probes and T041 ensembles. Full-suite/GPU/browser checks remain separate. Browser Acceptance checklist: **N/A**. Hard/save-specific checks and exact sub-§10 thresholds were not measured.
- Changes remain uncommitted; no push, merge or `.done` file.


## Round 3 — NOTE-052 symmetric protocol

The [new authoritative section](sim-aa-envelope.md#note-052-symmetric-fork-noise-protocol-round-3) selects **X=§100**, the smallest tested common size. §10 fails: seed-11 −§10 on day 1 never forks, retains identical full logs/commands and all annual metrics, and keeps exactly §10 less cash. All twelve selected ±§100 probes on days 1/1441 fork their complete action logs. No balance re-recording.

Changes: report and this handoff; new `tools/simAaForkEnvelope.mts` provides tree-parameterised one-command-per-row collection with quiet-gated children and verified reuse; new `tests/sim/botAaForkEnvelope.test.ts` checks its protocol semantics. No simulation, infra, cloud-held or outside-scope edits or cloud requests. Changes are uncommitted; no push, merge or `.done` file.

| Row | Population envelope | Air envelope | Approval-point envelope | I-HT fraction envelope |
|---|---:|---:|---:|---:|
| 128x15_s7 | 2767 | 0.00560960939425 | 1.92919785979 | 0 |
| 256x60_s7 | 133913 | 0.0248380385345 | 5.50529078302 | 0.0511209163901 |
| 256x60_s11 | 87489 | 0.0406407867526 | 5.42848638277 | 0.103251506482 |

No metric has a common nudge-sign, reverse-sign, both-up or both-down pattern across every row at either timing, using endpoints, means or every annual checkpoint. Pairwise agreement within each row still occurs with different directions between rows: day-1 endpoint population is down/down/up; mean approval is up/down/down at both timings. The main report lists all five such endpoint/mean cases with numbers.

Gates: tsc passed; funds-nudge tests 11 passed; protocol tests 7 passed, sequential quiet-gated single files. Fifteen selected complete runs / 675 annual records; independent validation of 12 log forks, 12 pooled envelopes, 135 unchanged control hashes/rows and 24 pre-year-5 hashes/rows. Five extra §10 probes completed; the redundant active +§10 long timing attempt was stopped once that size failed and its partial data is excluded. All exact bot/runner/test commands, first decisions, annual tables and percentages are in the report. Original controls remain 192,899 / 1,513,835 / 1,427,340.

NOTE-053 supersedes NOTE-052's base and variant margin rules. Use ensemble medians and dev bands for base gates, and variant/base medians at the same lane commit for targets; Round 4 contains the current workflow. Day1441 means the first simulated bot-loop day of year5; calendar rollover occurs at1440. The earlier size-response evidence remains historical.

The T041 remeasurement outstanding at Round 3 is completed in Round 4. Interpretation of the direction diagnostics and full-suite/GPU checks remain separate. Hard/save-specific continuations and sub-grid thresholds were not run. Browser Acceptance checklist: N/A; T062 names no browser checks.


## Round 4 — NOTE-053 ensembles

The [NOTE-053 section](sim-aa-envelope.md#note-053-sim-ensembles-round-4) contains dev and T041’s six five-member ensembles, all four annual median/min-max tables, 135 yearly population median deltas, excursion years, exact commands and the lane gate workflow. The old active ±1% and single-envelope margin guidance is replaced throughout both reports.

| Row | Dev final population median | T041 final population median | Median change | Outside ±3% years, all / from year 10 | Reopen NOTE-050 at endpoint? |
|---|---:|---:|---:|---:|---|
| 128×15 s7 | 191588 | 193098 | 0.78815% | 5 / 0 | no |
| 256×60 s7 | 1461087 | 1477908 | 1.15127% | 36 / 31 | no |
| 256×60 s11 | 1483518 | 1468252 | -1.02904% | 50 / 44 | no |

T041’s signed endpoint allowance remains closed. No common quarter-band systematic shift occurs in any metric. The ordinary NOTE-053 comparison is a separate diagnostic and names all three rows for nine-member stage two; it is not reported as a passing final base gate. Future lane gates must perform the named stage, using matching nine-member references and lane ensembles.

Files: new `tools/simEnsemble.mts` collects/reuses five or nine members with bounded quiet-gated concurrency and JSON/Markdown bands; new `tools/simEnsembleStats.ts` implements statistics and verdicts; new `tools/simEnsembleCompare.mts` implements base/variant/sign-off CLI checks; `tools/simAaForkEnvelope.mts` has a small optional-variant/noInfra observer hunk and current rule strings; new stats/runner test files; this note and the main report. No infra/cloud-held/outside-scope hunks or cloud requests. T041aa remains untouched/clean.

Checks: tsc passed; `botEnsembleStats` 15, `botSimEnsembleRunner` 7, `botAaForkEnvelope` 7 and `botAaFundsNudge` 11 tests passed, sequential quiet-gated single files. Fifteen dev members reused, fifteen T041 members measured with jobs=3, and one requested isolated control replay. Independent validation covered 1,350 annual records, 1,080 bands, 432 base verdicts, 135 sign-off verdicts and 48 pre-year-5 state matches. Parallel/alone control identity: 15/15 state hashes and rows, 1,689 actions and 1,123 full-log entries. Cache repeat: all thirty raw files unchanged in content and mtime, no member reruns.

Protocol details: year-5 pulse day1441; systematic endpoints15/60/60; literal inclusive half-band proximity also flags passes; the provided quiet gate waits at launch and does not preempt active members. The same-commit variant guard and no-compensation/default-strategy rule stand. The main report explains cherry-picking 3833c8d and retaining both bot hunks on conflicts.

Left for final lane gates: named nine-member stages and actual variants; full-suite/GPU and old-save checks. NOTE-050’s large-effect sweep checks were not rerun. Browser Acceptance checklist: N/A. All changes uncommitted; no commit, push, merge or `.done` file.

Round 5 (NOTE-055): the interim T043/T044/T045 campaign on the original dev simulation is complete, including every required nine-member stage. Paste-ready lane reports, target margins, exact commands and independent verification are in `scratch/note053-lanes/{T043,T044,T045}.md` and `SUMMARY.md`, under the full scratch root linked in the main report’s Round 5 note. The original 15 dev members were reused; 170 new members ran, with a verified maximum of four concurrent bots. Only short report-location notes changed in this worktree; no source, fixture or measurement-tree edits. Post-T041 final gates and the lanes’ own spatial/monthly/browser/timing probes remain separate.

## Round 5 desktop follow-up — NOTE-062

The [current report section](sim-aa-envelope.md#note-062-final-gate-runner-and-observers) documents the new final-gate rules, observer definitions, exact commands and proof paths. Changes are uncommitted on HEAD `818a040`; no commit, push, merge or `.done` file.

- `tools/simEnsemble.mts`: nine directly for bases/long variants, five plus stage two for short variants, explicit roles, no third stage, known-compatible cached-member reuse, parent provenance, optional-observation bands and long-row member/stall tables.
- `tools/simEnsembleStats.ts`: disjoint-band streaks, nine-member zero-I-HT exemption/activation, optional metrics including net approval, and strict under-100k stall diagnostics.
- `tools/simEnsembleCompare.mts`: new verdict/report fields, actual matching raw-member projection for five-member short variants, strict raw origin checks, both sides' endpoints/stall counts and origin tables.
- `tools/simBotObservations.ts` (new) and `tools/simAaForkEnvelope.mts` (observation-hook hunk): monthly commute EMA/net approval, resident commute, industry demand/job/retool readings, dated reward/ordinance logs and selected-tree bundling. Original `YearRow`, actions and decision logs stay unchanged.
- Tests: existing stats/runner tests updated; new `botEnsembleNote062.test.ts` and `botObservations.test.ts`. Both reports updated. No `src/**`, `simbot.ts`, infra, cloud-held or baseline-fixture edits; no cloud requests or out-of-scope hunks.

Checks: TypeScript passed; **56 tests** passed in six sequential quiet-gated single files: stats 15, NOTE-062 8, runner 9, observations 6, fork envelope 7, funds nudge 11. Native-loader/thread mode was used as in prior rounds. The actual native CLI was also exercised, catching and correcting source-extension loading before the smoke.

Exactly one two-member 128×15 s7 smoke ran, jobs=2. Both members retained all 15 annual original rows/digests and full command/decision logs. The control remains **192,899**, residents **[61124,93804,37971]**; +§100/day1 remains **190,132**. New approval-action logs contain 24/25 entries. Report-only checks reused 27 nine-member dev base records with unchanged raw bytes/mtimes, generated member columns and reproduced T043 seed 11's 44-year disjoint shift; no 256×60 bot ran. Proofs and generated tables are in `scratch/note062`, under the full scratch root in the main report.

Differences/limits: stored data and pure industrialStrategy reads avoid initializing getters; old trees/caches lack retool/commute observations and are explicitly unavailable. Five-member short variants project actual matched first-stage base/dev members from nine-member caches. The named commute term is smoothed independently with the same monthly EMA; approval's separate clamp term remains included. No fresh long-run calibration or verdict was inferred from the short smoke. Final measurements after B2/T041, lane diagnosis, monthly/spatial probes, full-suite/save checks and controlled timing remain outstanding. Browser Acceptance checklist for this runner-only follow-up: **N/A**.
