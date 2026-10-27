# Worker acceptance harness (T028)

Base: **a2578da29d8f67d1b218b1ce5e86e3ae7d3f9545**, branch `local/T028-qa-worker`.
Implements the browser gate in WORKER_DESIGN §5.4, its Appendix A command paths, and R16's freeze test.
Code changes are confined to this directory and `tools/qa-worker.mjs`; nothing under `src/` changes.
The review follow-up and validation record are in [the T028 report](../../docs/dev/reports/local-T028-qa-worker.md).

## Run on the desktop

```powershell
node tools/qa-worker.mjs --help
node tools/qa-worker.mjs --host local --out "$env:TEMP/qa-worker-local.json"
node tools/qa-worker.mjs --only freeze --out "$env:TEMP/qa-worker-freeze.json"
node tools/qa-worker.mjs --break-ack zone --out "$env:TEMP/qa-worker-broken-zone.json"
node tools/qa-worker.mjs --drop-ack dispatch --out "$env:TEMP/qa-worker-probe-control.json"
```

Run these sequentially. The positive run must exit **0**, with every current command, save/Continue, freeze and
console gate **PASS**. `--only` runs the named check and its explicit prerequisites; other checks print SKIPPED.
Use an operation name, `freeze`, `save`, `exit`, `onboarding`, `info-demolish`, `speed-keys`, `data-view`, or a
`panel:NAME` alias (the full list is in `--help`). An isolated run is a diagnostic, not the full acceptance gate.

`--break-ack OP` creates a **real broken production build**: a Vite transform replaces LocalSimHost's resolved
`done` for that operation with a promise that never settles, including the promise tracked by gestures. It
implies `--only OP`, leaves `src/` unchanged, and fails closed if the initializer changes or is absent/duplicated.
Require **PASS broken-build control** as well as exit **1**: exactly the target command's ack check must fail with
an issued, pending ticket. A missing command, broken probe read, unrelated failure or cleanup failure cannot pass
the control. Its intentional ack failure remains FAIL in the log/JSON and preserves the ordinary failure exit code.

`--drop-ack OP` is a separate observer fault, useful for debugging the oracle. It withholds the first returned
ticket for that operation, carrying the unused fault across reload/exit until consumed. It is not the broken-build
gate. Both controls must run separately from the positive gate, in one browser at a time.

Dependencies are the repo's Vite and Playwright packages and Playwright's Chromium installation. `--executable PATH`
selects another Chromium. Default launch uses the real GPU (`--enable-gpu --ignore-gpu-blocklist --use-angle=default`)
and rejects software renderers, including SwiftShader, llvmpipe and WARP / Microsoft Basic Render Driver.
`--headed` shows the browser. Each invocation creates one browser and one
fresh context: it does not touch a normal browser profile. The fixture is disposable.

The runner always calls `vite.build()` using the project production config, into its own temporary directory, then
`vite.preview()` on a new loopback port. It never attaches to another lane's server or reuses a stale `dist/`.
The browser, Vite preview (`server.close()`) and temporary build are closed in `finally`. The runner owns SIGINT
and SIGTERM and disables Playwright's automatic process exits. Interrupting a build waits for the build to finish
before deleting its output. At startup, stale `metropolis-qa-worker-*` builds are swept: dead recorded owner PIDs,
or unowned legacy directories older than 24 hours. Live owners, permission-denied PID checks, recent unowned dirs
and linked directories are retained. Every removal checks the resolved path within the system temp directory.
No existing tool or package script is changed.
`--help` imports neither Vite nor Playwright and works without installed browsers.

Cloud example:

```sh
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/qa-worker.mjs --host local --swiftshader --out /tmp/qa-worker-cloud.json
```

SwiftShader uses §5.4's `--use-angle=swiftshader --enable-unsafe-swiftshader`, plus the existing screenshot tools'
WebGL flags. Both GPU modes include `--js-flags=--allow-natives-syntax`. Software-rendered runs are identified in
the output and do not establish the desktop GPU gate. The one-second freeze-resume limit is never relaxed.

Every check prints `PASS`, `FAIL` or `SKIPPED` and a reason. Failures produce exit 1, argument errors exit 2.
An entirely skipped future-host run exits **3**; SIGINT/SIGTERM exit **130/143**. The optional JSON contains the
base and actual HEAD, browser/GPU, check results, command seq/args/acks, save correlation, continuity markers,
freeze evidence, cleanup diagnostics, errors and warnings.
Console warnings are diagnostic; **every console error, page exception and browser crash fails** (no allowlist).
Increase `--ack-timeout MS` (default 8000) or `--boot-timeout MS` (default 180000) on slow machines.

## What runs now

The URL starts with `?quickstart=1&size=256`, with `simworker=0`, `seed=7`, `terrain=flat` and `difficulty=sandbox`.
Sandbox funds and a flat preset keep construction independent of unlock progression. This is a QA fixture, not the
128×15 bot reference. The runner requires `__ready`, real views/actions, and the requested `scene.host.kind`.

Tools are selected through toolbar categories, tabs and cards; panels open through TopBar buttons or the Data
toolbar button. The banner selects DispatchTool; the driver does not re-select it. Terrain points are projected with the real camera and
validated using `pickCell`. Synthetic `PointerEvent`s go through the canvas's actual down/move/up handlers.
Panel controls receive normal Playwright clicks/keyboard input. Camera framing and cleanup use the context API.
It never calls tool `down`/`up` methods, patches a picker, writes simulation state,
or calls `host.act` to bypass UI input. The temporary observer forwards the original methods, tags and gestures.
Added freeze/resume/visibility listeners use `ctx.signal`; patches restore on host disposal. Argument cloning is
best-effort and occurs after the real act call, so non-cloneable diagnostic arguments cannot interrupt the app.

| Appendix A command path | Assertions |
| --- | --- |
| ZoneTool: `zone`, `dezone`, `bulldoze` | Real drag, issuing gesture, ack and changed map/building |
| NetworkTool: `buildNetwork`, `buildPowerLine`, `buildSubway` | Real drag, gesture, ack and every path cell |
| PlopTool: `plop` | Ack, intended origin and created building |
| BrushTool: `plantTrees`, `terraform` | Raise held until at least three successful acks; Level held through paid work and two `Nothing to change` acks; one gesture, release sound timestamp at/after `settledAt`, exactly one release sound and no toast |
| BudgetPanel: `setTax`, `setFunding` | Slider keyboard input, void ticket settlement, resulting values |
| BudgetPanel: `takeLoan`, `repayLoan` | Successful ack, loan list and repayment principal/months guard |
| OrdinancesPanel: `setOrdinance` | Toggle, successful ack and ordinance list |
| QueryTool / InfoPanel: `setHistoric`, Demolish | Naturally grown historic building; separate park demolished through the inspector, with panel gesture, footprint and removal checked |
| TopBar / keyboard / PauseMenu / Onboarding: `setSpeed`, `resume` | Source strings, tickets, Space and keys 1/2/3; Play; save/exit to region, old city's abort and return through the region city list |
| DisasterTool: `triggerDisaster` | Pointer-started fire, boolean ack and burning site |
| DispatchTool: `dispatch` | Wait for that banner's `settleUntil`; Choose station must activate DispatchTool targeting its incident before station input; tag, incident, sent/ETA ack |
| EmergencyBanner: `dispatchBest` | Wait for the second fire's banner to settle; Send nearest ack must name that second incident |
| CityScene: `setCamera`, save | Ctrl+S invokes `save(false)`; its synchronous camera ticket is correlated to that save call, excluding the periodic storeCamera path |

The neighbourhood is built entirely through these tools: a connected road, turbines, water tower, fire stations,
zoning and two distant fire sites. Growth runs via normal frames at Ultra, then pauses. The fire sites are just beyond
automatic dispatch range but within the fire deadline. Missing growth, refused construction and absent controls fail;
they are never silently counted as skips. Read-only panels (graphs, stats, advisors, data views, demographics,
emergencies and rewards) also open through the UI and render. The Data panel selects Power, verifies the active
view and clears it with None. Error-overlay Pause is explicitly SKIPPED: a healthy production fixture has no error
card, and injecting an application error conflicts with the zero-console-errors gate. It needs a separate error fixture.

The ack observer records `ticket.done` independently of `predicted`, including void replies. It requires all 21
current ops, increasing ticket sequences within each session, and no pending/rejected tickets. Positive exact
predictions or visible state changes alone cannot satisfy it. Brush saturation is an explicitly expected refusal.

Save/reload uses the same context and IndexedDB. It removes `quickstart` with `history.replaceState`, reloads the
title screen, sets `window.__ready = false`, and clicks **Continue**. It pauses the arriving city through the Space
keyboard path before waiting for the new real views. Day, funds, nextBuildingId and saved camera join the existing
layer hashes, identity, policies, loans, plopped buildings and Historic marker. The actual restored camera is also
checked (0.2 units/degrees, 1 unit of distance tolerance), then simulation days must advance. These selected
persistence markers are **not** a substitute for W1's exact-state digest.

Freeze runs last. CDP `Page.setWebLifecycleState(frozen)` lasts **15 seconds measured outside the page**, with
`active` in cleanup. **§5.4/R16 does not account for Chromium leaving the page hidden after `active`.** The harness
reads `document.visibilityState` with `page.evaluate`, without rAF polling. If hidden, headless mode uses
`Browser.getWindowForTarget` and `Browser.setWindowBounds` (minimized, then normal); headed mode uses
`page.bringToFront()`. Staying hidden produces a specific FAIL, and cleanup avoids a hidden-page speed-button click.

Signal-bound listeners record freeze, resume and visible timestamps in the same browser clock. The first new sim
day must occur within **1000 ms of the later of resume and visible**. Pre-freeze/hidden progress cannot satisfy it.
JSON evidence includes those timestamps, external UTC request/confirmation timestamps, frozen duration, frame
counts at freeze/resume and every frame observed while frozen (expected zero). There must be no crash overlay.
Cleanup failures are retained separately and cannot replace the primary failure.

## W1 switches and plan/code differences

Default runs explicitly skip `protector at boot`, `replica verify`, `protector after freeze`, and `protector at end`.
`--host loopback` or `--host worker` without `--w1` prints skips for the whole requested host and opens no browser.
Once those implementations land:

```powershell
node tools/qa-worker.mjs --host loopback --w1 --digest-module src/worker/<actual-digest-module>.ts
node tools/qa-worker.mjs --host worker --w1 --digest-module src/worker/<actual-digest-module>.ts
```

Enabled gates fail closed: local fallback, missing query, missing digest export, missing sim worker, unsupported
native probe or unavailable CDP attachment is a **FAIL**. They do not downgrade a requested W1 run to local acceptance.
`w1.mjs` installs the existing S1 optimized typed-array protector probe before page scripts, and uses CDP auto-attach
with `waitForDebuggerOnStart` to install it before each worker starts. It probes the worker named `sim`, not the LOD
worker. Worker mode requires exactly one sim isolate. Local/loopback have only the main sim isolate.

Differences requiring follow-up by the owning lanes:

- At this base `CityScene` constructs `LocalSimHost` directly. W1.1a has recorder/replica infrastructure, but neither
  `LoopbackSimHost` nor `WorkerSimHost` is selectable yet. W1.1b/W1.2 must add selection.
- `SimHost` has no `query` method and the tree has no `exactDigest` export. `--digest-module` names the eventual shared
  module exporting `exactDigest(state)`; the production build includes it as an extra entry, preserving its exports.
  The paused, drained harness compares `await host.query('verify')` (the design's numeric digest) with
  `exactDigest(host.state)`. No guessed digest algorithm or replica serialization is used. The design calls this
  query “dev” while §5.4 runs a production build: its QA availability must be resolved by W1's owner.
- §5.4 assumes Ctrl+S goes through `host.save`; today it goes through `CityScene.save` and App persistence.
  The harness exercises the current keyboard path and persistence evidence without fabricating a save ack.
- `dismissAlert` and `setSettings` do not exist in this base's command API (W0.4/W0.5). They print a separate skip.
  Their existing UI implementations cannot establish a host-command round trip.
- Journal recovery is a separate **SKIPPED** W1.3 gate. This task does not implement a speculative journal contract.
- `tools/soak/` is absent. The production pattern comes from `tools/bench/browser-check.mjs`; it already has prod
  mode and needs no edit for this harness. `tools/leakprobe/` and `tools/shoot*.mjs` supplied browser/input patterns.
- The user authorized the report during review follow-up. The work remains uncommitted; no DONE marker or push.

## Checks in this sandbox / remaining gates

```powershell
node tools/qa-worker/selftest.mjs
npx vitest run tools/qa-worker/fixture.test.ts --maxWorkers=1
npx tsc --noEmit
```

`selftest.mjs` uses Node's test runner, outside Vitest discovery. It covers the ack oracle, actual build transform,
strict control verdict, save correlation, cross-session fault injection, lifecycle restoration, timing and cleanup.
`fixture.test.ts` checks growth and both manual dispatch paths against real LocalSimHost and **is included in the
default Vitest suite**; the command above also runs it alone. See the report for this sandbox's actual results.

Desktop gates: the full LocalSimHost run, isolated headless/headed freeze, the real `--break-ack` control and the
cross-session `--drop-ack dispatch` diagnostic. Exercise Ctrl+C cleanup during a run. Full suites and the bot
(128×15 seed 7: 196,101 in 2015) remain the lead's checks. W1 paths cannot run against the current host.

| New file | Purpose |
| --- | --- |
| `../qa-worker.mjs` | Browser-free CLI entry and exit status |
| `harness.mjs` | Arguments, reporting and ack oracle |
| `run.mjs` | Owned production build, preview, browser, console capture and cleanup |
| `build.mjs` | Temporary-build fault transform, ownership and stale-directory cleanup |
| `driver.mjs` | Real tool/panel input and fixture construction helpers |
| `page.mjs` | Temporary ticket/gesture/feedback observer, picking and persistence markers |
| `checks.mjs` | Command, brush, save, freeze and consumer checks |
| `freeze.mjs` | Visibility restoration, freeze evidence and resume deadline |
| `w1.mjs` | Gated per-isolate protector and shared-digest verification |
| `selftest.mjs` | Browser-free acceptance-oracle tests |
| `fixture.test.ts` | Real-sim validation of fixture assumptions |
| `README.md` | Run instructions, gate status and integration differences |
