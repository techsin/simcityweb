# T028b report: the worker-mode acceptance harness after W1.3 and T059

Branch `local/T028b-harness`, on dev `43679b3` plus the task file (`176a7e8`). All changes are uncommitted in the
worktree. No file under `src/` changed. No browser, build, bench or bot was run here (the task's rule); what a browser
has to confirm is in *Real-GPU run* and *Not verified*.

## What dev had (the task's "check against dev")

- **Two tools share the name.** `tools/qa-worker.mjs` is T034's W1.2 browser QA (boot, tools, crash, recover,
  watchdog, fallback, region pre-spawn). It had `--port`, no `--host`, hard-coded SwiftShader, no `--help`, and it
  ignored options it did not know. T028's host-generic acceptance harness is `tools/qa-worker/**`, launched by
  `tools/qa-worker/cli.mjs` since the T028 merge. It had `--host local|loopback|worker`; the real GPU was its unnamed
  default (with the SwiftShader check inside `host ready`); it always served on a free port.
- **`recovery mirror`.** Dev no longer asserted a journal on every worker host: the T028 merge (`29ed7b1`) made the
  row skip a worker host whose page holds no journal mirror. With W1.3 in dev the worker host has that mirror
  wherever the page's store persists, so the row would have run and probably passed. Two holes were left: it read
  localStorage only (the worker's boot replay reads the IndexedDB record), and a W1.3 worker that lost its mirror
  would have been SKIPPED, which is a check that stops testing without failing.
- **Protectors.** As the QA found: `w1.mjs` `check()` asserted the main isolate first and never read the sim worker
  after a main failure. T059 is in this tree (`lodBuilder.ts` posts without a transfer list).

## What changed

### 1. `recovery mirror` asserts what W1.3 stores, per persistence mode (`journal.mjs`, new)

What W1.3 stores when the page goes away (cloud-W1.3 G5-G7 and decision 6, `recoveryMirror.ts` `writeNow`,
`recoveryLs.ts`, `recoveryIdb.ts`, `WorkerSimHost.ts`):

| Host, mode | Journal at pagehide | The base it is bound to | Row |
|---|---|---|---|
| local | none (snapshots) | | SKIPPED, as before |
| loopback, store persists | the page's mirror: localStorage marker and journal, IndexedDB `recovery/<region>:<tile>#journal` | the loopback core's save and snapshot records | runs |
| worker, `'worker-idb'` | the same page mirror; the worker's boot replay reads the IndexedDB record on its own connection | the worker's own save (`cities/<key>`) and snapshot (`recovery/<key>`) records | runs |
| worker, `'main'`, store persists (the worker's IndexedDB fell back to memory) | the same page mirror; main reads it for `init.journal` | main stores the worker's save and snapshot records | runs |
| packet host, store in memory | none: the App writes no recovery data (`snapshotNow` returns), and the worker host has no mirror | | SKIPPED with that reason, after the mode is checked for consistency |

The row now:
1. reads the mode from the page: `host.kind`, `WorkerSimHost.persistence`, `App.persistent`, `host.recovery`, the
   city's region and tile;
2. **fails** (it used to skip) when the store persists and the host has no journal mirror; skips only for local and
   for a store in memory, with the reason as the row's text;
3. makes the real zone stroke and dispatches the App's own `pagehide`, as before;
4. asserts the localStorage journal as before (the UI edit, order and watermarks, no excluded command; the excluded
   list is now the design's whole list), plus its city and its marker (`kind`, `at`, `baseSavedAt`);
5. waits for the IndexedDB journal record of that same write and asserts it holds the edit and is bound to the same
   base;
6. asserts IndexedDB holds that base: `cities/<key>.savedAt`, and the snapshot record when the journal extends a
   snapshot. A journal bound to anything else is discarded at the next boot (`journalMatches`), so this is what
   makes the stored journal replayable.

The PASS text names the mode, for example `worker, persistence 'worker-idb': App pagehide wrote 11 whitelisted edits
bound to snapshot; UI zone seq 89 retained in localStorage and in IndexedDB recovery/quickstart:…#journal; IndexedDB
holds that snapshot and its save (the worker wrote it on its own connection and replays the journal at boot)`.
JSON: `details.recoveryMode`, `recoveryJournal`, `recoveryStores`.

**A race the old row already had, now handled.** A periodic snapshot (or a save) that lands between the stroke's ack
and the reads moves the journal's base: the edit is then in the snapshot, not in the journal, and the row failed with
"pagehide did not journal the UI edit". Nothing is lost in that case, and the attempt shows nothing either way. The
row now recognises it (the base's watermark already contains the edit, or the two copies and the stored records sit on
either side of the move), repeats the stroke once on the next cell (148,154), and fails if the second attempt
disagrees too (while paused, periodic snapshots are at least 30 s apart). JSON `details.recoveryRebased` records it.

`recovery journal` (the close-page restore) stays SKIPPED; its text now points at `tools/qa-journal.mjs` (*Choices*).

### 2. One protector row per isolate (`w1.mjs`, `checks.mjs`)

- Six rows: `protector at boot / main isolate`, `protector at boot / sim worker`, and the same for `at end` and
  `after freeze` (they replace `protector at boot`, `protector at end`, `protector after freeze`).
- `watchProtectors().read()` reads both isolates once and returns a verdict for each. It never throws: an isolate's
  failure, or a read that fails, is that row's FAIL and the other row is still read. JSON `details.protectors` holds
  each row's probe.
- On `--host worker` the sim row needs exactly one dedicated worker named `sim`. On loopback and local the
  simulation runs in the main isolate: the sim row is **SKIPPED** with that reason, not passed.
- Earlier failures are kept per isolate. The reload replaces the page's isolate and ends the city's worker, so
  both are read just before it (as `beforeReload` did, now attributed to the isolate that failed). **New:** the city's
  worker also ends at exit to region, so it is read just before the exit as well. Before, a worker run read only the
  first worker (before the reload) and the third (at the end); the worker of the city entered by Continue was never
  read. A row that fails for an earlier isolate also says what the current one reads.
- A worker that could not be probed at birth fails the sim rows on every host: it cannot be ruled out as the sim
  worker (before, it failed the single row on every host too).

### 3. `--host`, `--gpu`, `--port`

- **Harness (`cli.mjs`).** `--gpu` names the default: `--enable-gpu --ignore-gpu-blocklist --use-angle=default`
  (`launch.mjs`, recorded in JSON `details.gpuFlags`), and `host ready` fails unless `WEBGL_debug_renderer_info` is
  available and names a renderer that is not SwiftShader, llvmpipe, WARP or Microsoft Basic Render Driver. New: a
  masked renderer string fails too (it used to pass the regex). `--gpu` with `--swiftshader` is refused (exit 2).
  `--port N` serves the build on 127.0.0.1:N with `strictPort`; a port that is taken fails `production build`
  before the build starts (`build.mjs` `assertPortFree`). Without `--port` a free port, as before. The harness builds
  the tree it lives in (unchanged).
- **`tools/qa-worker.mjs`.** `--host worker|loopback|local …` hands the whole run to the harness, in the same
  process and with the same arguments, so the command line WORKER_DESIGN §5.4 and the W1.3 QA list (D2) use works
  on dev. Without `--host` it runs its own W1.2 steps as before, and gains `--gpu` (the same flags, and a step
  `gpu: WEBGL_debug_renderer_info names a real GPU…` after boot that stops the run on a software renderer),
  `--help`, and exit 2 on an unknown option or a missing value (a mistyped `--gpu` used to run on SwiftShader
  unnoticed). Its top-level side effects (output folder, log file, signal handlers, timer) moved into the run block
  at the end of the file, so a `--host` run starts none of them; the steps themselves are unchanged.

### 4. Selftests

See *Tests*. Besides the new cases, two existing selftests failed here about 3 times in 7 before any change: this
machine was saturated (16 cores at 100 %, a 50 ms timer firing up to 170 ms late), and both gave the oracle 100 ms
to make a second read one 50 ms interval after the first. Their budget is now 5 s; they still end at the read they
wait for, so nothing is slower and nothing is weaker. The final selftest passed 6 runs in a row under the same load
(and 8 in a row one case earlier).

## Files

| File | Change |
|---|---|
| `tools/qa-worker/journal.mjs` (new) | The recovery row: the page reads (`recoveryMode`, `writeAtPagehide`, `readRecoveryIdb`), `journalSkip` and `journalVerdict` |
| `tools/qa-worker/launch.mjs` (new) | `GPU` and `SWIFTSHADER` flags (moved from `run.mjs`, which re-exports them), `pageRenderer`, `realGpuProblem`; shared with `tools/qa-worker.mjs` |
| `tools/qa-worker/w1.mjs` | `protectorRows`; `watchProtectors` returns `read` and `checkpoint` in place of `check` and `beforeReload`, with failures kept per isolate |
| `tools/qa-worker/checks.mjs` | `protectorCheck` and `recoveryMirror` (exported for the tests); the six row names in `BROWSER_CHECKS`; the checkpoint before exit to region; `host ready` uses the shared GPU check; the `recovery journal` text |
| `tools/qa-worker/harness.mjs` | `--gpu`, `--port`, the help text; `Skipped` (a check's own "does not apply here", which `Report.check` records as SKIPPED); `recoveryMirrorSkip` removed |
| `tools/qa-worker/run.mjs` | `--port` into `vite.preview`, checked free before the build; the GPU flags from `launch.mjs`, recorded in the JSON |
| `tools/qa-worker/build.mjs` | `assertPortFree` |
| `tools/qa-worker.mjs` | `--host` hand-over, `--gpu`, `--help`, strict options, as above |
| `tools/qa-worker/selftest.mjs` | 24 new or rewritten cases, 2 budgets (65 cases in all, from 45) |
| `tools/qa-worker/fake-idb.mjs` (new) | Selftests only: the IndexedDB calls of the page read, over a store with `get(store, key)` |
| `tools/qa-worker/{checks,harness,fake-idb}.d.mts` (new) | Types of what the vitest file imports, as `tools/qa-worker-control.d.mts` |
| `tests/worker/qaWorkerJournal.test.ts` (new) | The recovery row on what the real hosts store |
| `tests/worker/qaWorkerSelftest.test.ts` (new) | Runs the node selftest under vitest, so the suite sees a broken harness (neither vitest nor tsc loads `tools/qa-worker/*.mjs`) |
| `tools/qa-worker/README.md` | The rows, options, commands and the per-mode table |

No `src/sim/infra/*` hunk. No hunk outside the task's named files except the two new tests.
`tools/qa-worker-control.mjs` (T061's helper, not named by the task) is untouched.

## Tests

**`tests/worker/qaWorkerJournal.test.ts`** (vitest, 6 cases, all pass). It runs the harness's own row function and
page reads on records written by the hosts' own code: the loopback host and the real worker under node
`worker_threads` (workerHarness's `bootIdb` / `bootNode`), with the App stood in for by the one call its pagehide
handler makes (`host.recovery?.writeNow('pagehide')` when the store persists) and IndexedDB by a facade over the
tests' KV, which the real worker also writes through the bridge.
- `worker, persistence worker-idb: passes on the page's two journal copies and on the worker's own save and snapshot records`
- `worker, persistence main (its IndexedDB fell back to memory): passes on the journal and on the records main stored`
- `worker with a store that does not persist: no journal by design, so the row is SKIPPED with that reason and edits nothing`
- `a worker host without the mirror while its store persists (W1.2's shape) is a FAIL, where the old row skipped`
- `loopback: passes on the page's copies and the core's records; a snapshot inside the window repeats the edit once`
- `the IndexedDB copy is asserted: a page that writes only localStorage fails, as does a journal bound to a save the database does not hold`

**`tests/worker/qaWorkerSelftest.test.ts`** (vitest, 1 case, passes): `tools/qa-worker/selftest.mjs passes`. It
starts the node selftest below as a child process (as `tests/perf/protector.test.ts` starts its child) and fails on
any `not ok` line; in a sandbox that cannot start a process it reports itself skipped.

**`tools/qa-worker/selftest.mjs`** (`node tools/qa-worker/selftest.mjs`, 65 cases, all pass). New or rewritten:
- `CLI: --gpu states the real GPU (the default), --swiftshader is its opposite, --port names the preview port`
- `--port: a port that is taken is refused before the build; a free one is left free` (it listens on a free
  127.0.0.1 port for a moment)
- `GPU launch: --gpu is the three real-GPU flags; only an unmasked, non-software renderer stands for a real GPU`
- `GPU check: the page reads the city context's unmasked renderer, and a scratch context only without a city`
- `tools/qa-worker.mjs: --host hands the run to this harness; --gpu, --help and its own options stay the W1.2 script's`
  (it starts that script five times; each call ends in `--help` or exit 2, before Vite or Playwright is imported;
  where a sandbox cannot start a process, the case reports itself skipped)
- `recovery mirror: only a host or mode without a journal by design skips; a packet host that should journal never does`
- `recovery mirror: passes on what W1.3 stores for each packet mode, bound to a save or to a snapshot of it`
- `recovery mirror: each stored copy is asserted: the localStorage journal and marker, the IndexedDB record, and the base they are bound to`
- `recovery mirror: the excluded list and the page reads follow the source` (pins `App.persistent`,
  `WorkerSimHost.persistence` and its journal rule, `host.recovery`, the localStorage keys, the database name and
  the record keys against `src/`, so a rename fails here and not on the GPU run)
- `recovery mirror: the page reads the mode from the App and its host, never writing`
- `recovery mirror: the App's own pagehide writes; pageshow follows even when a handler throws`
- `recovery mirror: the page reads the journal record, and with it the snapshot marker and the save it is bound to`
- `recovery mirror row: a real edit, the App's pagehide, then both stores, for each packet mode`
- `recovery mirror row: a host that should journal and does not is a FAIL; a mode without a journal is SKIPPED with its reason`
- `recovery mirror row: one snapshot inside the window repeats the edit once; a second disagreement fails`
- `report: a check that finds it does not apply is SKIPPED with its reason, never PASS`
- `protector rows: the two isolates are read and judged separately; neither failure hides the other`
- `protector rows: LOD workers resume without a sim probe; without a sim worker the row is skipped, or fails where the host needs one`
- `protector rows: the sim worker is probed before startup; a baseline that could not be made fails its row on every host`
- `protector rows: a reload cannot erase an earlier invalidation; the row keeps failing and also says what the new isolate reads`
- `protector rows: a city's worker that ends at exit to region keeps its invalidation in the later sim rows`
- `protector rows: a read that fails is that isolate's failure, never an exception that ends the other's read`
- `run wiring: the departing isolates are read before the reload and before exit; the preview takes --port; Chromium takes the GPU flags`
- `protector rows: each point of the run reports its two rows from one reading; skips say why`
- changed: `CLI: loopback runs by default; …` (the new defaults), and the budgets of `ack oracle: deferred tickets
  must ALL settle, including void results` and `broken build verdict: a failing probe read after a pending ack is not
  an ack timeout`.

**Each new test fails with its change broken or reverted.** 37 mutations, one at a time, each restored and compared
after (scratch `mutate.mjs`, log `mutate-2.log`, on the final code; the 37th, through the vitest wrapper, was run on
its own): all 37 fail their test. They cover the old
behaviours (a main failure ending the read before the sim worker; a host without a mirror skipped; the IndexedDB
copy, the base, the snapshot record, the marker and the excluded list not checked; a store in memory not skipped),
the checkpoints, the retry and its limit, the wait for the IndexedDB put, `Skipped` read as PASS, `--gpu` / `--port`
parsing, the port check, the renderer check, and `tools/qa-worker.mjs`'s `--host`, options and GPU flags. Five of
them run against the real hosts.

## Gates checked here

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 (before the change and after) |
| `node tools/qa-worker/selftest.mjs`, through quietrun | 65 passed, 0 failed, 6 runs in a row. Before the change: 45 cases, 2 of them failing in 3 of 7 runs (*Selftests* above) |
| `npx vitest run tests/worker/qaWorkerJournal.test.ts tests/worker/qaWorkerSelftest.test.ts tests/worker/qaWorkerControl.test.ts tools/qa-worker/fixture.test.ts --maxWorkers=1`, through quietrun | 4 files, 13 tests passed (6 + 1 + 1 + 5) |
| `tests/worker/hygiene.test.ts` (it scans `tests/worker/**`, where the new tests live) | 18 passed. In one earlier run, one case that scans `src/ui` and `src/game` (`W0.2: speed writers live only in src/worker or src/sim`) hit its 5 s timeout at 12.7 s on this saturated machine; it does not read this lane's files, and it passed in the three runs after |
| Native protector selftests (README's two commands) | both PASS (V8 status 81 → 129) |
| `node --check` on `tools/qa-worker.mjs` and every `tools/qa-worker/*.mjs` | clean |
| `--port` mechanics | a scratch probe (`port-probe.mjs`) made the harness's `vite.preview` call with this tree's Vite 8.3 on an empty dist: the given port is used, a taken port is refused ("Port N is already in use"), port 0 picks a free one. No build |
| The bot | not run: no file under `src/` changed (`git status` lists `tools/qa-worker*`, the two new tests and this report) |

Logs are in the lane's scratch folder (`selftest-*.log`, `vitest-*.log`, `tsc-*.log`, `mutate-1.log`, `mutate-2.log`).

## Real-GPU run (left for the lead)

From the root of the tree to gate, one at a time; `$s` is a scratch folder that exists, `5692` any free port:

```
npx tsc --noEmit
node tools/qa-worker/selftest.mjs
npx vitest run tests/worker/qaWorkerJournal.test.ts tests/worker/qaWorkerSelftest.test.ts tests/worker/qaWorkerControl.test.ts tools/qa-worker/fixture.test.ts --maxWorkers=1
node tools/qa-worker/cli.mjs --host worker   --gpu --port 5692 --out $s/worker.json
node tools/qa-worker/cli.mjs --host loopback --gpu --port 5692 --out $s/loopback.json
node tools/qa-worker/cli.mjs --host local --w1 --gpu --port 5692 --out $s/local-w1.json
node tools/qa-worker/cli.mjs --host local    --gpu --port 5692 --out $s/local.json
```

`node tools/qa-worker.mjs --host worker --gpu --port 5692 --out $s/worker.json` is the same run as the
`--host worker` line.

Expected, if nothing else moved since the run at `cb6ca4c` (59 rows in each run; exit 0):

| Run | PASS / FAIL / SKIPPED | The rows of this lane |
|---|---|---|
| `--host worker` | 56 / 0 / 3 | all six protector rows PASS; `recovery mirror` PASS, text starting `worker, persistence 'worker-idb':` |
| `--host loopback` | 53 / 0 / 6 | three `… / main isolate` rows PASS; three `… / sim worker` rows SKIPPED ("no dedicated sim worker on this host…"); `recovery mirror` PASS, text starting `loopback:` |
| `--host local --w1` | 51 / 0 / 8 | as loopback for the protector rows; `recovery mirror` SKIPPED (LocalSimHost) |
| `--host local` | 47 / 0 / 12 | all six protector rows SKIPPED ("use --w1…"); `recovery mirror` SKIPPED |

The other three skips are the old ones (`Appendix A / error overlay Pause`, `recovery journal`, `other command
acknowledgements`). In every run `host ready` ends with `real GPU: ANGLE (NVIDIA, …)`, and `production build` names
the port.

T034's own script on the real GPU, no longer needing a copy:
`node tools/qa-worker.mjs --gpu --port 5692 --quality high --out $s/w12` (a folder). Expected: the PASS set of the
QA's hand-edited copy (37 at `cb6ca4c`, before W1.3) plus the new `gpu:` step.

## Plan against code

1. **Item 3 reads as one harness; dev has two tools** (above). I did both halves: the harness got `--gpu` and
   `--port`, and `tools/qa-worker.mjs` got `--host` (by handing over) and `--gpu`. `--host loopback|local` cannot mean
   anything inside T034's own steps (crash, watchdog, fallback need the real worker), so there it selects the harness.
   `--out` is a folder for T034's steps and a JSON file for the harness; both help texts say so.
2. **"The two protector rows should now pass on every host."** On loopback and local there is no sim worker, so
   those three rows are SKIPPED with their reason rather than passed without a read. Plain `--host local` skips all
   six unless `--w1` is given, as T028 designed it; `--host local --w1` is the run that reads the main isolate.
3. **`checks.mjs:235-236`** was the QA copy's line. On dev the row already skipped by the page's mirror (`29ed7b1`);
   the change here is described under *What changed*, 1.
4. **§5.4's "from W1.3" step** (close the page mid-edit, recovery offers the journal and restores the edit) is not in
   this harness; W1.3 made it `tools/qa-journal.mjs` (its decision 10). See *Choices*.
5. `harness.mjs` still prints `base 8ef8f7c` in `--help` and records it in the JSON; `details.head` is the real HEAD.
   Left alone.

## Choices that need the lead

- **The close-page restore is still not a row here.** Writing it means a second reload cycle with the title's
  recovery dialog inside the acceptance flow, which cannot be developed without a browser (the T028 carry-over
  declined it for the same reason). `tools/qa-journal.mjs` covers it. If you want it folded in, it is a desktop lane.
- **`tools/qa-journal.mjs` has no `--gpu`** (it launches Chromium with default flags) and is outside this task's
  files. The same small hunk as in `tools/qa-worker.mjs` would give it one, from `tools/qa-worker/launch.mjs`.
- **The checkpoint before exit to region is new behaviour** in a run I could not make. It issues the calls
  `protector at boot` already makes (one CDP evaluate on the sim worker's session), on a paused city, and records
  rather than throws.
- **Unknown options now stop `tools/qa-worker.mjs`** (exit 2). T034's and T061's documented command lines use only
  its listed options.
- **`tests/worker/qaWorkerSelftest.test.ts` puts the node selftest in the vitest suite** (3 to 7 s here, one child
  process). It is what makes a source rename that breaks the harness visible at merge time: the selftest pins the
  `--break-ack` anchors and the seams the rows read. Delete the file if the suite should not start a process.

## Requests for cloud-held files

None.

## Not verified (no browser here)

- The six protector rows and the two checkpoints against real CDP. The reads are the calls the old check made;
  the new control flow is tested against a CDP double.
- The page reads of the recovery row in Chromium: `App.persistent`, `app.region.data.id`, `city.tile.key`
  (property names in the production build, as the harness already relies on for `city.saving` and the like), and the
  IndexedDB read (the same calls `tools/qa-journal.mjs` makes, in one transaction over `recovery` and `cities`). It
  loads the stored city record once to read its `savedAt`.
- That a W1.3 worker run really reports `'worker-idb'` under Playwright's Chromium 141 on this machine (the cloud's
  qa-journal run did, on SwiftShader). If the worker's IndexedDB falls back there, the row says `persistence 'main'`,
  and the App's own console error fails `console errors`.
- The retry cell (148,154): free by the fixture's layout, never zoned in a run.
- `--port` and `--gpu` with the real build and browser; `tools/qa-worker.mjs --gpu` (the QA's hand-edited copy,
  with the same three flags, passed 37 of 37).
- The rest of the harness against today's dev. I only checked, as strings, that the selectors and labels of
  `driver.mjs` and `checks.mjs` (about 80 of them) still occur in `src/` after the TopBar split, and read the two
  TopBar ones in their new files (`.speed button[title=…]` in `topbar/cityDate.ts`, `button[data-panel=…]` in
  `topbar/panelButtons.ts`: unchanged). That is not a DOM check.

## Browser checklist

- [ ] `--host worker --gpu`: exit 0; `host ready` reads `worker` and `real GPU: ANGLE (…)`, never SwiftShader.
- [ ] Worker: `protector at boot|at end|after freeze / main isolate` and `… / sim worker` all PASS, each with its
      own probe (`intact: {"intact":true,"turbofan":true,…}`).
- [ ] Worker: `recovery mirror` PASS, with `worker, persistence 'worker-idb'`, "retained in localStorage and in
      IndexedDB recovery/…#journal" and "IndexedDB holds that save" or "that snapshot and its save". If it reads
      `persistence 'main'`, the worker's IndexedDB fell back: report it with the console error.
- [ ] Worker: no `details.recoveryRebased` in the JSON (present only if a snapshot landed inside the window; the row
      then passed on its second edit).
- [ ] `--host loopback --gpu`: the three main-isolate rows PASS, the three sim-worker rows SKIPPED with their
      reason; `recovery mirror` PASS with `loopback:`.
- [ ] `--host local --w1 --gpu`: the three main-isolate rows PASS; `--host local --gpu`: all six SKIPPED ("use --w1").
- [ ] `--port 5692`: `production build` reads "on 127.0.0.1:5692 (--port)"; a run on a taken port fails that row at
      once with "--port 5692 is already in use on 127.0.0.1", before any build, and opens no browser.
- [ ] `node tools/qa-worker.mjs --host worker --gpu --port 5692 --out $s/worker.json` gives the same rows.
- [ ] `node tools/qa-worker.mjs --gpu --port 5692 --quality high --out $s/w12`: the step `gpu:
      WEBGL_debug_renderer_info names a real GPU…` PASS, then T034's own steps.
- [ ] Optional controls, unchanged: `--host worker --break-ack zone` and `--host loopback --drop-ack dispatch`.
