# Worker acceptance harness (T028r)

Reviewed at **28a4862**, branch `local/T028-qa-worker`. Implements WORKER_DESIGN §5.4 and R16 against
production assets. **Loopback runs now and is the default.** `--host` selects local, loopback or worker;
the URL uses `simworker=0`, `simworker=loopback` or `simworker=1` respectively. A requested host must actually
boot; local fallback cannot pass a loopback/worker gate. No files under `src/` are modified.

## Desktop commands

Run sequentially from this worktree. Each browser command creates one disposable Chromium context, builds
production assets in an owned temporary directory and serves them on its own Vite preview port.

```powershell
$root = 'C:/Users/techsin/Desktop/projects/simcityweb-T028'
$scratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T028r/scratch'
Set-Location $root
node "$root/tools/qa-worker.mjs" --help
node "$root/tools/qa-worker.mjs" --host loopback --out "$scratch/loopback.json"
node "$root/tools/qa-worker.mjs" --host local --out "$scratch/local.json"
node "$root/tools/qa-worker.mjs" --host worker --out "$scratch/worker.json"
```

Worker currently prints **`worker host not in this build; requires T034 / W1.2 WorkerSimHost`** for every
check and exits **3**, before importing Vite/Playwright or opening a browser. Once `src/worker/WorkerSimHost.ts`
lands, the same command runs the real gate. If its App selection is missing or falls back to local, it fails.

Loopback automatically enables the shared `src/worker/queries.ts` exact digest and the main-isolate protector.
Worker adds the protector in the dedicated worker named `sim`. `--w1` remains an optional local-mode switch
for these checks; `--digest-module PATH` can override the shared export if its owning lane moves it.

Focused diagnostics and controls:

```powershell
node "$root/tools/qa-worker.mjs" --host loopback --only ghosts --out "$scratch/ghosts.json"
node "$root/tools/qa-worker.mjs" --host loopback --only freeze --out "$scratch/freeze.json"
node "$root/tools/qa-worker.mjs" --host loopback --only freeze --headed --out "$scratch/freeze-headed.json"
node "$root/tools/qa-worker.mjs" --host loopback --break-ack zone --out "$scratch/broken-zone.json"
node "$root/tools/qa-worker.mjs" --host local --break-ack zone --out "$scratch/broken-local-zone.json"
node "$root/tools/qa-worker.mjs" --host loopback --drop-ack dispatch --out "$scratch/probe-control.json"
node "$root/tools/qa-worker.mjs" --host local --w1 --out "$scratch/local-verify.json"
```

The positive full run must exit **0** with every applicable check PASS. `--only` runs a named check plus
prerequisites and cannot establish full acceptance. Other aliases include command names, `save`, `exit`,
`onboarding`, `speed-keys`, `info-demolish`, `data-view`, `packets`, `recovery` and `panel:NAME` (see `--help`).

`--break-ack OP` transforms the **actual host** in the temporary build. Local mode replaces its resolved
`done` initializer; packet modes withhold the selected command's ticket resolution in `PacketSimHost.ack`.
The real mutation and replica replay still happen; the tool and its gesture receive the unresolved promise.
Source drift, duplicate transforms and missing build inclusion fail closed. Require **PASS broken-build control**
and exit **1**: exactly the selected check must fail on a transported pending ticket; unrelated/probe/cleanup
failures invalidate the control. This leaves source files untouched.

`--drop-ack OP` is a separate observer control. It withholds the first transported ticket, carrying the unused
fault across city sessions. Predictions and unposted refusals cannot consume it. It is not the broken-build gate.

## GPU, lifecycle and cleanup

Default Chromium requests the real GPU and rejects SwiftShader, llvmpipe, WARP and Microsoft Basic Render Driver.
`--executable PATH` selects Chromium; `--headed` shows it. For the cloud only:

```sh
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/qa-worker.mjs --host loopback --swiftshader --out /tmp/qa-worker-loopback.json
```

SwiftShader uses §5.4's flags and is marked in the report; it cannot establish the desktop GPU gate. Both modes
include `--js-flags=--allow-natives-syntax`. One browser runs at a time. No normal browser profile is used.

Freeze runs last: CDP frozen for **at least 15000 ms** measured outside the page, then active. Chromium may leave
the page hidden after active: headed uses `bringToFront`; headless restores minimized/normal window bounds.
Polling visibility never depends on rAF. The first new sim day must arrive **within 1000 ms of the later of resume
and visible**, with **0 frames during freeze**, **0 crash overlays** and an intact protector afterwards.
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
| RecoveryMirror | App pagehide writes a base-bound ordered whitelisted journal containing a real UI edit; excluded commands absent; worker close-page replay remains W1.3/T039 |
| Consumers | Onboarding Play, keys 1/2/3, Space, PauseMenu resume, InfoPanel Historic/Demolish; graphs, stats, advisors, data views, demographics, emergencies, rewards; Power view then None |
| Freeze/errors | >= **15000 ms** frozen, <= **1000 ms** visible resume, **0** frozen frames, **0** overlays/console errors/page exceptions/crashes |

The probe forwards original arguments, tags, gestures and promises (apart from the explicit observer fault).
It records predictions separately from acknowledgements, observes real pending mesh creation/removal, packets,
replayed causes, save replies and gesture settlement. It attaches after real views replace loading views;
subscriptions end with `ctx.signal`, patches restore on abort/dispose, and archives hold plain diagnostics only.

## Non-browser checks and limits

```powershell
node "$root/tools/qa-worker/selftest.mjs"
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tools/qa-worker/fixture.test.ts --maxWorkers=1
npx tsc --noEmit
```

The Node selftest tests the oracle/control/probe without Vite or a browser. The Vitest fixture is in normal test
discovery and validates real local/loopback growth and dispatch plus provisional dependencies, ghosts, tagged replay,
query read-after-write, correction deduplication and abort cleanup. It uses deterministic design cadence only in
the node fixture; the browser uses live frames. Current results are in the [report](../../docs/dev/reports/local-T028-qa-worker.md).

Error-overlay Pause remains explicitly SKIPPED in the healthy fixture and needs a separate error fixture.
Close-page worker journal restoration is explicitly SKIPPED until W1.3/T039. `holdCalendar` is an additional
automatic New Year op: any observed ticket must settle, but this short command fixture does not force midnight.
Full visual parity of every overlay variant, New Year and other Appendix A consumers remains manual QA.
No browser, build, perf run, full Vitest suite or bot was launched for T028r. No balance, simulation or RNG code changes;
the supplied seed-7 reference remains residents **[61124, 93804, 37971] = 192899** in 2015, unverified here.

`tools/bench/browser-check.mjs` already supports production assets and is unchanged. No source/infra/cloud-held
files were edited; no commit, push or DONE marker was made.
