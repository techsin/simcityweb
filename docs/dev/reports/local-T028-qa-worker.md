# T028 worker acceptance harness — review follow-up

Date: 2026-10-27. Branch: `local/T028-qa-worker`.
Base and inspected HEAD: `a2578da29d8f67d1b218b1ce5e86e3ae7d3f9545`.

The review fixes are implemented in `tools/qa-worker.mjs` and `tools/qa-worker/**`.
This report is the additional file explicitly authorized in the review request. No existing tracked file or
`src/**` file was edited. Changes remain uncommitted; no push or queue DONE marker was made.
No browser acceptance result is claimed: the source review and browser-free tests cannot establish that gate.

## Run

Run these sequentially from the worktree, using the repo's Vite/Playwright dependencies and installed Chromium:

```powershell
node tools/qa-worker.mjs --help
node tools/qa-worker.mjs --host local --out "$env:TEMP/qa-worker-local.json"
node tools/qa-worker.mjs --only freeze --out "$env:TEMP/qa-worker-freeze.json"
node tools/qa-worker.mjs --only freeze --headed --out "$env:TEMP/qa-worker-freeze-headed.json"
node tools/qa-worker.mjs --break-ack zone --out "$env:TEMP/qa-worker-broken-zone.json"
node tools/qa-worker.mjs --drop-ack dispatch --out "$env:TEMP/qa-worker-probe-dispatch.json"
```

The full positive run must exit 0 with all implemented checks PASS. Known unavailable checks print SKIPPED with
reasons. `--only` selects one check plus its prerequisites, so it does not establish full acceptance. `--help` lists
command names and aliases, including `save`, `exit`, `onboarding`, `info-demolish`, `speed-keys` and `data-view`.

The broken-build run deliberately exits **1**. Require **PASS broken-build control**: one production-host transform
must have occurred, exactly the selected operation's check must fail on an actual pending ticket, and all other
observed commands, checks and cleanup must succeed. Missing input, a failed probe read, or any unrelated failure
rejects the control. Exit 1 alone is never evidence of a successful negative control.

The separate `--drop-ack dispatch` observer control should fail its dispatch ack check after the reload/exit
sessions. It verifies that an unused fault survives session replacement; it does not substitute for the real
broken-build control. Both controls keep predictions and actual local mutations intact.

Default Chromium uses the real GPU. `--executable PATH` chooses an executable. Cloud fallback:

```sh
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/qa-worker.mjs --swiftshader --out /tmp/qa-worker-cloud.json
```

SwiftShader is identified in the report and cannot establish the desktop GPU gate. The harness always builds
production assets into an owned temporary directory, serves them with its own Vite preview, and uses one browser.
Exit codes: 0 successful selected checks; 1 failed check/control build; 2 invalid arguments; 3 entirely skipped;
130/143 SIGINT/SIGTERM. See [README](../../../tools/qa-worker/README.md) for details and W1 integration options.

## Review findings and fixes

| Finding | Change and evidence required by the harness |
| --- | --- |
| 1. Frozen page stays hidden; rAF waits hang and cleanup masks failure | `freeze.mjs` evaluates visibility after `active`. Headless restores the target window via minimized/normal bounds; headed calls `bringToFront`. Visibility polling uses Node timers and `page.evaluate`. Persistent hidden state has a specific failure. Timing starts at the later browser resume/visible timestamp. Freeze is the last behavioural check; failed freeze prevents its protector follow-up. Cleanup skips hidden-page clicks and retains secondary errors without replacing the primary one. |
| 1. Missing evidence / isolated run | `--only freeze` runs boot, overlay/console checks, freeze and cleanup. JSON includes external freeze/resume/visibility UTC timestamps, browser lifecycle timestamps, freeze duration, frames at freeze/resume and all frames during freeze (must be zero). |
| 2. EmergencyBanner settle window swallows clicks | The driver waits for `performance.now() > scene.emgBanner.banners.get(incident).settleUntil` and the specific button to be available. Choose station must make DispatchTool active with `inc` equal to the banner incident before station input; no tool re-selection occurs. Both dispatch args name the intended incident, and Send nearest must name the distinct second fire. |
| 3. Probe-only negative control and vacuous exit 1 | `--break-ack OP` installs a Vite pre-transform of the exact LocalSimHost `done` initializer. The built host and gesture tracker receive the never-settling promise. No source file is changed. The transform fails on source drift, duplicate transforms or absence from the bundle. Typed failure evidence and the strict control verdict reject unrelated failures; a separate check drains all non-target tickets. |
| 3. Drop control lost across reload | Driver archives plain command rows per session and carries `dropAck` until a row records consumption. A browser-free regression covers an unused first session, a dropped second-session ack and an unaffected third session. |
| 4. Frame-rate-dependent raised terrain | The real Raise pointer remains held until at least three successful acknowledgements. Only then does Level run to paid work followed by flat/no-change acks. There is no fixed 100 ms raise fixture. |
| 5. Continue inherits title readiness | The harness sets `window.__ready = false` immediately before Continue and waits for the arriving city's real views. It pauses arrival through the real Space key path before that wait, preserving continuity markers. The region return does the same readiness reset. |
| 6. Ctrl+C leaks build output | CLI owns SIGINT/SIGTERM; Playwright's process signal handlers are disabled. Interrupted waits release into normal cleanup; preview uses `server.close()`. Startup sweeps dead-owner temporary builds and legacy unowned builds older than 24 hours, retaining live/recent/linked paths. Recursive deletion verifies the resolved direct child of the system temp directory. |
| 7. Weak continuity markers | Saved/loaded comparisons now include exact day, funds, nextBuildingId and saved camera. Actual restored camera target, distance, yaw and base tilt are checked separately, alongside existing layer/policy/building markers. |
| 8. Periodic camera store can impersonate Ctrl+S | Probe wraps `CityScene.save` and correlates only synchronous commands within that particular call to its save ID. Ctrl+S must start a non-auto save and acknowledge its own `setCamera`; periodic calls have no save ID. Save completion and persistence still must succeed. |
| 9. No proof release sound follows settlement | Gesture probe records `settledAt`. The single release sound must have `sound.at >= settledAt`; flat saturation still requires no toast or early release sound. |
| 10. Missing Appendix A routes | Added InfoPanel Demolish, PauseMenu save/exit to region and region-list return, keys 1/2/3, Onboarding Play, actual toolbar category/tab/card selection, TopBar panel buttons, and Power/None data-view selection. Error-overlay Pause is explicitly SKIPPED because the healthy fixture has no error card; an intentional error fixture conflicts with this run's zero-console-errors requirement. |
| Nits: WARP, cloning, skipped exit | GPU rejection includes WARP / Microsoft Basic Render Driver. Argument snapshots occur after the original act and cloning errors are caught. An all-skipped run exits 3. |
| Nits: test discovery, output paths, help | README states that `fixture.test.ts` belongs to the default Vitest suite; actual sandbox startup failure is recorded below instead of implying exclusion. All output examples use system temp paths. `--w1` help alignment is corrected. |

## Files

| File | Change |
| --- | --- |
| `tools/qa-worker.mjs` | Browser-free CLI, explicit signal ownership and exit codes. |
| `tools/qa-worker/harness.mjs` | Check selection/prerequisites, CLI flags, typed ack failure evidence, strict broken-build verdict and cleanup error preservation. |
| `tools/qa-worker/run.mjs` | Production build/preview, transform wiring, disabled Playwright signal exits, stale-build sweep and Vite cleanup. |
| `tools/qa-worker/build.mjs` | Real broken-build transform, temp ownership and safe stale-directory removal. |
| `tools/qa-worker/page.mjs` | Safe ticket snapshots, save correlation, settlement/lifecycle timing, frame evidence, plain session archives and stronger markers. |
| `tools/qa-worker/driver.mjs` | Real toolbar/TopBar input, banner settlement, active-tool strokes, early arrival pause and cross-session fault tracking. |
| `tools/qa-worker/checks.mjs` | Added UI paths; incident assertions; deterministic brush setup; correlated save and continuity; freeze last; non-target ack isolation. |
| `tools/qa-worker/freeze.mjs` | Hidden-state restoration, resume oracle, evidence collection and cleanup that preserves primary errors. |
| `tools/qa-worker/selftest.mjs` | Browser-free regressions for the review findings and failure oracle. |
| `tools/qa-worker/fixture.test.ts` | Existing harness fixture test retained: real LocalSimHost growth and two manual dispatches. Included in default Vitest discovery. |
| `tools/qa-worker/w1.mjs` | Existing gated per-isolate protector and shared-digest verification retained. |
| `tools/qa-worker/README.md` | Updated usage, control verdicts, coverage, lifecycle caveat, cleanup and remaining gates. |
| `docs/dev/reports/local-T028-qa-worker.md` | This requested review and validation record. |

## Validation

Passed here:

- `node tools/qa-worker.mjs --help`: works without importing Vite or Playwright.
- `node tools/qa-worker.mjs --host worker`: every check SKIPPED with the W1.2 reason; verified Node exit code 3.
- `node tools/qa-worker.mjs --only typo`: FAIL arguments; verified Node exit code 2.
- `node --check`: all ten harness `.mjs` files.
- `node tools/qa-worker/selftest.mjs`: 23 tests passed, listed below.
- `npx tsc --noEmit`: passed.
- `git diff --check` and tracked-file scope inspection: no existing tracked-file modifications.

Browser-free tests by name:

1. CLI: defaults, host validation and explicit W1 gate
2. ack oracle: missing, pending, rejected, refused and malformed tickets fail
3. ack oracle: deferred tickets must ALL settle, including void results
4. deadlines: an unresponsive browser read fails without waiting for its promise
5. ack oracle: issuing gestures and dispatch tags are mandatory
6. probe: observes real tickets without changing args, tags, gestures or results; restores on dispose
7. negative control: a real mutation and exact prediction cannot hide a withheld ack
8. probe: late acks after city abort cannot turn into PASS
9. freeze probe: pre-freeze and hidden progress cannot satisfy visible resume; timestamps and frames recorded
10. save markers: byte ranges, day, funds, nextBuildingId and saved camera are continuity markers
11. probe: non-cloneable arguments do not throw into the application command path
12. save correlation: periodic setCamera cannot impersonate a CityScene.save call
13. drop-ack: survives reload until consumed, and is not applied again in a third session
14. ready: stale title readiness and null views cannot pass the city gate
15. only: freeze is isolated; dispatch and save include their explicit prerequisites
16. broken build: production transform replaces the actual host done initializer, fails closed on drift
17. broken build verdict: only the targeted pending ack failure counts; unrelated failures never pass
18. broken build verdict: a failing probe read after a pending ack is not an ack timeout
19. freeze oracle: deadline starts at later resume/visible; hidden, delayed and frozen-frame evidence fails
20. freeze restore: headless minimizes/normalizes, headed brings to front, hidden timeout is specific
21. cleanup: secondary failure preserves primary error and reports cleanup evidence
22. exit status: an entirely skipped run is distinct from acceptance
23. control reporting: report-write failure never announces a successful negative control

Attempted `npx vitest run tools/qa-worker/fixture.test.ts --maxWorkers=1`. Vite failed to load `vite.config.ts`:
`[plugin externalize-deps] Error: spawn EPERM` from its Windows real-path resolver. Vitest did not run the test.
The trace resolves the shared dependencies under the sibling `simcityweb-W11a/node_modules`; those files were
not edited. No alternate config, dependency change or source workaround was introduced.

Left for the lead's machine: the single fixture test, full LocalSimHost browser gate, isolated headless/headed
freeze, real broken-build control, cross-session probe control, Ctrl+C/SIGTERM cleanup during a browser run,
and the full suites/bot. No production build, real GPU, Chromium lifecycle or actual UI timing was verified here.
The bot's required 128×15 seed-7 reference remains 196,101 in 2015; it was not rerun and no bot source changed.

## Plan/code differences and skips

- §5.4/R16 omits the hidden state left by Chromium's frozen/active lifecycle sequence. This harness restores
  visibility and uses the requested later-of-resume-and-visible timing origin; the one-second limit is unchanged.
- Only LocalSimHost is selectable at this base. Loopback/worker modes, protector checks in the applicable isolates
  and replica verification stay SKIPPED unless `--w1` is explicitly enabled after W1.1b/W1.2. Requested W1 gates
  fail if their actual APIs/isolate are absent; they do not silently accept local fallback.
- `SimHost.query('verify')` and the shared `exactDigest(state)` export are not present. The future
  `--digest-module PATH` supplies the real shared export as a production entry. The design calls verification
  “dev” while the acceptance run uses production assets; the owning lane must make that contract available.
- Ctrl+S currently uses `CityScene.save` and App persistence, not `host.save`. The harness observes that actual
  path and its setCamera ack; it does not invent a save ticket.
- `dismissAlert` / `setSettings` commands await W0.4/W0.5; journal recovery awaits W1.3 and remains SKIPPED.
- Error-overlay Pause remains an explicit fixture limitation, not a PASS. Panels/data-view assertions are smoke
  and state checks, not complete visual QA of every Appendix A consumer.
- `tools/soak/` is absent; existing leakprobe/shoot tools and the already-production-capable browser-check script
  supplied the repo patterns. No existing browser tool needed modification.
