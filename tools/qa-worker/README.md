# Worker acceptance harness (T028, T028b)

Implements WORKER_DESIGN §5.4 and R16 against production assets. **Loopback is the default.** `--host` selects
local, loopback or worker; the URL uses `simworker=0`, `simworker=loopback` or `simworker=1` respectively. A requested
host must actually boot; local fallback cannot pass a loopback/worker gate. No files under `src/` are modified.

**Launcher: `tools/qa-worker/cli.mjs`.** `tools/qa-worker.mjs` is a different tool: T034's W1.2 browser QA (boot,
tools, crash/recover/watchdog/fallback, region pre-spawn on `?simworker=1`), which T034's and T061's gates use. Since
T028b, `node tools/qa-worker.mjs --host worker|loopback|local ...` starts **this** harness with the same arguments
(the command line WORKER_DESIGN §5.4 and the W1.3 QA list name); without `--host` that file runs its own W1.2 steps,
on SwiftShader unless `--gpu` is given. Consolidating the two is a backlog item after W1.4.

T028b (after W1.3 and T059) changed three things here:
- **Protectors: one row per isolate**, `protector <when> / main isolate` and `protector <when> / sim worker`, at boot,
  at end and after freeze. Neither isolate's failure ends the other's read.
- **`recovery mirror` asserts what W1.3 stores** for the host's persistence mode, in localStorage and in IndexedDB.
  It no longer skips a worker host that has no journal mirror while its store persists: that is a FAIL.
- **`--gpu`** (the default, now with a name) and **`--port N`**.

## Desktop commands

Run sequentially from the worktree. Each browser command creates one disposable Chromium context, builds the tree
this harness lives in into an owned temporary directory, and serves it with its own Vite preview on 127.0.0.1, on
`--port N` or on a free port.

```powershell
# from the root of the tree to gate: the harness builds and serves the tree it lives in
$scratch = "$env:TEMP/qa-worker"; New-Item -ItemType Directory -Force $scratch | Out-Null
node tools/qa-worker/cli.mjs --help
node tools/qa-worker/cli.mjs --host worker --gpu --port 5692 --out "$scratch/worker.json"
node tools/qa-worker/cli.mjs --host loopback --gpu --port 5692 --out "$scratch/loopback.json"
node tools/qa-worker/cli.mjs --host local --w1 --gpu --port 5692 --out "$scratch/local-w1.json"
node tools/qa-worker/cli.mjs --host local --gpu --port 5692 --out "$scratch/local.json"
# the same harness through the name the design uses:
node tools/qa-worker.mjs --host worker --gpu --port 5692 --out "$scratch/worker.json"
```

On a tree without `src/worker/WorkerSimHost.ts`, worker prints **`worker host not in this build; requires T034 /
W1.2 WorkerSimHost`** for every check and exits **3**, before importing Vite/Playwright or opening a browser. If the
App's host selection is missing or falls back to local, the run fails.

Loopback automatically enables the shared `src/worker/queries.ts` exact digest and the main-isolate protector.
Worker adds the protector in the dedicated worker named `sim`. `--w1` remains an optional local-mode switch
for these checks (plain `--host local` skips them, with that reason); `--digest-module PATH` can override the shared
export if its owning lane moves it.

Focused diagnostics and controls:

```powershell
node tools/qa-worker/cli.mjs --host worker --only recovery --out "$scratch/recovery.json"
node tools/qa-worker/cli.mjs --host loopback --only ghosts --out "$scratch/ghosts.json"
node tools/qa-worker/cli.mjs --host loopback --only freeze --out "$scratch/freeze.json"
node tools/qa-worker/cli.mjs --host loopback --only freeze --headed --out "$scratch/freeze-headed.json"
node tools/qa-worker/cli.mjs --host loopback --break-ack zone --out "$scratch/broken-zone.json"
node tools/qa-worker/cli.mjs --host local --break-ack zone --out "$scratch/broken-local-zone.json"
node tools/qa-worker/cli.mjs --host loopback --drop-ack dispatch --out "$scratch/probe-control.json"
```

The positive full run must exit **0** with every applicable check PASS. `--only` runs a named check plus
prerequisites and cannot establish full acceptance (the protector rows are not selectable: they read SKIPPED, "not
selected", in such a run). Other aliases include command names, `save`, `exit`, `onboarding`, `speed-keys`,
`info-demolish`, `data-view`, `packets`, `recovery` and `panel:NAME` (see `--help`).

`--break-ack OP` transforms the **actual host** in the temporary build. Local mode replaces its resolved
`done` initializer; packet modes withhold the selected command's ticket resolution in `PacketSimHost.ack`.
The real mutation and replica replay still happen; the tool and its gesture receive the unresolved promise.
Source drift, duplicate transforms and missing build inclusion fail closed. Require **PASS broken-build control**
and exit **1**: exactly the selected check must fail on a transported pending ticket; unrelated/probe/cleanup
failures invalidate the control. This leaves source files untouched.

`--drop-ack OP` is a separate observer control. It withholds the first transported ticket, carrying the unused
fault across city sessions. Predictions and unposted refusals cannot consume it. It is not the broken-build gate.

## GPU, lifecycle and cleanup

`--gpu` is the default: Chromium is launched with `--enable-gpu --ignore-gpu-blocklist --use-angle=default`
(`launch.mjs`, shared with `tools/qa-worker.mjs --gpu`; recorded in JSON `details.gpuFlags`), and `host ready` reads
the city's own WebGL context. It fails unless `WEBGL_debug_renderer_info` is available and names a renderer that is
not SwiftShader, llvmpipe, WARP or Microsoft Basic Render Driver; a masked renderer string names no GPU and fails
too. `--gpu` and `--swiftshader` together are refused (exit 2). `--port N` serves the build on 127.0.0.1:N; a port
that is taken fails `production build` before the build starts (never a neighbouring port, and no browser opens).
Without it the system picks a free port. The URL is in JSON `details.url`. `--executable PATH` selects Chromium;
`--headed` shows it. For the cloud only:

```sh
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/qa-worker/cli.mjs --host loopback --swiftshader --out /tmp/qa-worker-loopback.json
```

SwiftShader uses §5.4's flags and is marked in the report; it cannot establish the desktop GPU gate. Both modes
include this single Chromium argument, centralized as `PROTECTOR_V8_FLAGS` in `w1.mjs` and recorded in JSON
`details.v8Flags`:

```text
--js-flags=--allow-natives-syntax --no-maglev --no-optimize-on-next-call-optimizes-to-maglev
```

The spaces belong inside the one argument supplied by the harness; no shell quoting is needed for the commands
above. These flags keep `%OptimizeFunctionOnNextCall` on TurboFan. The probe requires
`%ActiveTierIsTurbofan` after synchronous pre-import warm-up; numeric optimization status is diagnostic only.
It never accepts a Maglev status or a changed optimization tier as an intact baseline. Unsupported intrinsics
or failure to establish TurboFan fail closed. One browser runs at a time. No normal browser profile is used.

**Two protector rows at each point** (at boot, at end, after freeze), from one reading of both isolates
(`w1.mjs` `read`, `checks.mjs` `protectorCheck`; JSON `details.protectors` holds each row's probe):
- `protector <when> / main isolate`: the page's probe, installed before application code.
- `protector <when> / sim worker`: the probe of the one dedicated worker named `sim`, installed while the worker is
  paused at birth. On `--host worker` exactly one such worker must exist. On loopback and local the simulation runs in
  the main isolate, so this row is SKIPPED with that reason (plain `--host local` without `--w1` skips both rows).
- Neither isolate's failure, nor a read that fails, ends the other's read: each row has its own verdict.
- Isolates are replaced during the run: the reload gives the page a fresh isolate, and each city session a fresh
  worker (three workers in a worker run: the first city, the city after Continue, the city re-entered from the
  region). Before the reload (both isolates) and before exit to region (the city's worker) the gate reads what is
  about to go away and keeps any failure for that isolate's later rows, so a fresh isolate cannot erase it. Such a row
  FAILs and also says what the current isolate reads. A worker that could not be probed at birth fails the sim rows
  on every host, since it cannot be ruled out as the sim worker.

Freeze runs last. Playwright 1.56.1 keeps pages visible through focus emulation on its owning CDP session; a separate
session cannot release that handle. `lifecycle.mjs` uses the installed in-process bridge to disable focus emulation
on that owner, validates the version/shape, then minimizes and confirms real hidden visibility. An unsupported
Playwright version fails with an adapter diagnostic. No dependency or application code is patched.

The harness requires a **trusted DOM freeze event**, received through a CDP Runtime binding, before starting the
**at least 15000 ms** external hold. It then sends active, requires trusted resume, restores normal window bounds
(plus `bringToFront` when headed), and restores focus emulation in cleanup. Polling visibility never depends on rAF.
CDP acknowledgement alone cannot pass as a freeze; no lifecycle events or timestamps are synthesized.
The first new sim day must arrive **within 1000 ms of the later of resume
and visible**, with **0 frames during freeze**, **0 crash overlays** and an intact protector afterwards.
A crash overlay is an error card, Vite's overlay, W1.2's "The simulation stopped" dialog
(`openSimCrashDialog`) or the App's `city.crashed` flag; the same read runs after the freeze and at the end.
The JSON includes external timestamps, page lifecycle timestamps, frame counts and resume delay.

SIGINT/SIGTERM close the browser, preview and owned temporary build. Playwright's automatic signal exits are
disabled. Existing stale-build ownership/path checks remain. Exercise interruption cleanup on the real machine.
Every console error, page exception and browser crash fails; warnings are retained as diagnostics.
Exit codes: 0 success, 1 failure (including the intentional broken build), 2 arguments, 3 entirely skipped,
130/143 interruption. The report preserves primary and cleanup failures. Timeouts are adjustable with
`--ack-timeout MS` (8000) and `--boot-timeout MS` (180000); freeze thresholds never change.

## Coverage and numeric evidence

The fixture opens `?quickstart=1&size=256&terrain=flat&difficulty=sandbox&seed=7&simworker=loopback`, requires
`__ready` and real actions/world/objects, and grows through normal live frames. Tools are selected with real
toolbar/category/tab/card clicks. Ground points are projected with the real camera and verified by `pickCell`.
Synthetic canvas pointer events go through normal handlers. Panel inputs use UI clicks/keyboard events.
No test calls tool methods, mutates city state, patches a picker or uses host commands to bypass UI input.

| Check | Required evidence |
| --- | --- |
| Commands | **23** current UI ops each have a positive transported sequence and settled ack, including void setters, settings and alert dismissal; no rejected/pending tickets |
| Exact/provisional | Exact failures use **seq 0**, are classified as unposted refusals, and cannot satisfy command ack coverage; coalesced slider calls may share only the same key and actual promise |
| Pending ghosts | **2** rapid real zoning strokes: exact then provisional; **2** actual visible ghost meshes; claim/hover active during pending work; each ghost clears after applied Ack; **0** pending reservations and meshes afterwards |
| Corrections | All observed gestures settle and issue **at most 1** failure correction each; real commitAction regression also forces an exact mismatch and subsequent provisional failures |
| Brush | Raise until **at least 3** paid acks; Level through paid work and **at least 2** flat refusals; **1** gesture, **1** release sound after settlement, **0** early release sounds, **0** toasts |
| Dispatch | Two distinct UI-started fires; Choose station preserves its target and tool tag; Send nearest targets the second fire; both return sent > 0 and finite ETA; dispatched replay preserves cause seq/tag |
| Replies/verify | Query replies ride in observed packets with cmd <= applied; cause clears outside replay; **0** unexpected resyncs; numeric authoritative digest equals replica digest while paused/drained |
| Save/Continue | Ctrl+S's own camera ticket precedes host.save(manual)'s reply; save cmd includes camera; day/funds/next id/layer hashes/policies/buildings/camera preserved on reload/Continue; sim days advance afterwards |
| Teardown | PauseMenu save/exit aborts the city with reason dispose; **0** pending edits and ghost meshes; return through region city list reaches fresh playable views |
| RecoveryMirror | After a real UI edit, the App's own pagehide leaves an ordered whitelisted journal with that edit and no excluded command in **localStorage** (with a marker that describes it) and in **IndexedDB** `recovery/<region>:<tile>#journal`; both copies are bound to the same base, and IndexedDB holds that base: the save (`cities/<key>.savedAt`), and the snapshot record when the journal extends one. The row's text names the mode: `loopback`, `worker, persistence 'worker-idb'` (the worker wrote the base and replays the journal) or `worker, persistence 'main'` (main stored it and passes the journal at init). SKIPPED only where there is no journal by design: local (snapshots), and a store that does not persist. A packet host whose store persists and that has no journal mirror is a **FAIL** |
| Protectors | **6** rows: main isolate and sim worker, each at boot, at end and after freeze (see above) |
| Consumers | Onboarding Play, keys 1/2/3, Space, PauseMenu resume, InfoPanel Historic/Demolish; graphs, stats, advisors, data views, demographics, emergencies, rewards; Power view then None |
| Freeze/errors | >= **15000 ms** frozen, <= **1000 ms** visible resume, **0** frozen frames, **0** overlays/console errors/page exceptions/crashes |

Onboarding Play first hovers its step row to expose NOTE-042's hidden action, then performs a trial click before
the observed real click. Query selection uses the actual `query` tool and its intentional null `activeId`.
Dispatch input waits for its packet-backed options and initial automatic camera fit before focusing the station;
camera timeouts include actual/expected coordinates and use the acknowledgement deadline, not the boot deadline.

The probe forwards original arguments, tags, gestures and promises (apart from the explicit observer fault).
It records predictions separately from acknowledgements, observes real pending mesh creation/removal, packets,
replayed causes, save replies and gesture settlement. It attaches after real views replace loading views;
subscriptions end with `ctx.signal`, patches restore on abort/dispose, and archives hold plain diagnostics only.

### The recovery mirror row (`journal.mjs`)

What W1.3 stores when the page goes away (WORKER_DESIGN §4.3, docs/dev/reports/cloud-W1.3.md), and what the row reads:

| Host, mode | Journal at pagehide | The base it is bound to | Row |
| --- | --- | --- | --- |
| local | none: LocalSimHost recovers from snapshots | | SKIPPED |
| loopback, store persists | the page's mirror: localStorage + IndexedDB `#journal` | the loopback core's save and snapshot records | runs |
| worker, `'worker-idb'` | the same page mirror; the worker's boot replay reads the IndexedDB record | the worker's own save and snapshot records, on its connection to the same database | runs |
| worker, `'main'`, store persists (the worker's IndexedDB fell back to memory) | the same page mirror; main reads the record and passes it in `init.journal` | main stores the worker's save and snapshot records | runs |
| any packet host, store in memory | none: the App writes no recovery data, and the worker host has no mirror (W1.3 decision 6) | | SKIPPED, after checking the mode is consistent |

The row reads the mode from the page (`host.kind`, `WorkerSimHost.persistence`, `App.persistent`, `host.recovery`),
makes a real zone stroke, dispatches the App's own `pagehide` (then `pageshow`), and reads localStorage and, through a
connection of its own, IndexedDB. A save or snapshot that lands between the stroke and the reads moves the journal's
base, so the copies disagree once, legitimately; the row then repeats the stroke on the next cell, once (JSON
`details.recoveryRebased`). A second disagreement fails. The mode, the journal and the stores read are in JSON
`details.recoveryMode`, `recoveryJournal` and `recoveryStores`.

The close-page restore itself (kill the tab mid-edit, the title offers the journal, the next boot replays it) is
W1.3's own scenario, `tools/qa-journal.mjs`; the `recovery journal` row stays SKIPPED and says so.

## Non-browser checks and limits

```powershell
node tools/qa-worker/selftest.mjs
node --allow-natives-syntax --no-maglev --no-optimize-on-next-call-optimizes-to-maglev tools/qa-worker/protector-selftest.mjs
node --no-maglev --no-optimize-on-next-call-optimizes-to-maglev tools/qa-worker/protector-selftest.mjs
npx vitest run tests/worker/qaWorkerJournal.test.ts tests/worker/qaWorkerSelftest.test.ts tests/worker/qaWorkerControl.test.ts tools/qa-worker/fixture.test.ts --maxWorkers=1
npx tsc --noEmit
```

`tests/worker/qaWorkerJournal.test.ts` runs the recovery mirror row without a browser on what the hosts really store:
the loopback host and the real worker (node `worker_threads`, with persistence `'worker-idb'`, `'main'`, and a store
in memory), with the App stood in for by the one call its pagehide handler makes.
`tests/worker/qaWorkerSelftest.test.ts` runs the Node selftest as a child process, so the vitest suite sees a harness
that a source change broke (neither vitest nor tsc loads these `.mjs` files). The Node selftest covers the rest
of T028b: the options, the GPU check, the two-row protector gate against a CDP double, the row's verdicts and page
reads, and `tools/qa-worker.mjs`'s `--host`, `--gpu` and `--help` (it starts that script, which ends before any
build or browser).

The Node selftest tests the oracle/control/probe without Vite or a browser. It covers the pending-ticket polling
deadline, real UI action preparation, packet-watch camera race, required sim-only protector gate, and actual-freeze
setup/cleanup. The first native command requires repeated clean polls and a typed-array clone to remain intact,
then transfers an unrelated buffer and requires byteLength 0 and persistent probe failure. Reinstalling the probe
must not reset that failed baseline. The second command omits native-syntax support and must fail closed.
The protector warms synchronously before application imports, records V8 optimization statuses for diagnostics,
and remains strict for main and the worker named `sim`; independent `lod-proxies-*` workers do not belong to the
simulation gate.
The Vitest fixture is in normal test
discovery and validates real local/loopback growth and dispatch plus provisional dependencies, ghosts, tagged replay,
query read-after-write, correction deduplication and abort cleanup. It uses deterministic design cadence only in
the node fixture; the browser uses live frames. Current results are in the [report](../../docs/dev/reports/local-T028-qa-worker.md).

Error-overlay Pause remains explicitly SKIPPED in the healthy fixture and needs a separate error fixture.
The close-page journal restore is `tools/qa-journal.mjs`'s (above). `holdCalendar` is an additional
automatic New Year op: any observed ticket must settle, but this short command fixture does not force midnight.
Full visual parity of every overlay variant, New Year and other Appendix A consumers remains manual QA.

The protector's positive evidence is Chromium 141 (Playwright 1.56.1, which `lifecycle.mjs` requires): there a
main-thread transfer invalidates the probe (dev before T059 failed these rows, T059 passes them). A V8 that tracks
array buffer views (Chromium 153) keeps the protector through a no-view or one-view transfer, so if Playwright's
Chromium moves, add a page-side positive control before trusting "intact" (`tools/qa-worker.mjs` has one for the
worker isolate).

`tools/bench/browser-check.mjs` already supports production assets and is unchanged. The harness changes no file
under `src/`. Results and history: [T028](../../docs/dev/reports/local-T028-qa-worker.md),
[T028b](../../docs/dev/reports/local-T028b-harness.md).
