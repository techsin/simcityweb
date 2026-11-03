# T028 report: the worker-mode acceptance harness (desktop, real GPU)

## Final results (NOTE-047 item 1)

**Verdict: done for loopback mode.**
- The harness runs every acceptance item of the task through the real tools on the real GPU, and all of them pass on
  `?simworker=loopback`.
- Worker mode skips with a clear line until T034 (W1.2) is in dev; the journal restore waits for T039 (W1.3).
- The harness also found a real bug outside its own code: Worker plan step S0 (J0) had never landed. It is fixed
  separately in T059.

Branch `local/T028-qa-worker`, history:
- `c703887`: the Oct 27 Codex lane, on `a2578da`;
- `28a4862`: dev `821a8d6` merged in, cleanly;
- the review rounds: `8ef8f7c`, `f22933f`, `abb8ed1`.

### Environment

RTX 5070 Ti (driver 610.47), ANGLE D3D11, Playwright's Chromium 141.0.7390.37 with the real GPU, Windows 10 19045. The
harness builds its own production bundle (vite build + vite preview).

The V8 flags for the protector probe are
`--js-flags=--allow-natives-syntax --no-maglev --no-optimize-on-next-call-optimizes-to-maglev`, recorded in every run's
JSON.

### Runs on the real GPU (round 3, `abb8ed1`)

| Run | Tree | Result |
|---|---|---|
| `--host loopback` | the harness + T059 (J0) | **53 passed, 0 failed, 3 skipped** (the skips: no error card in a healthy build; the W1.3 journal; the --break-ack-only check) |
| `--host local --w1` | the harness + T059 | **51 passed, 0 failed, 5 skipped** |
| `--host loopback` | the harness on dev (no J0) | 51 passed, **2 failed**: "protector at end" and "protector after freeze": the main protector is intact at boot, then invalidated after LOD activity |
| `--host local --w1` | the harness on dev | 49 passed, **2 failed**: the same two protector checks |
| `--host loopback --only freeze` (round 2) | dev | pass: frozen 15,012 ms, 0 frames while frozen, the sim advanced 48 ms after the page became visible |
| `--break-ack zone` (round 2), loopback and local | dev | **the control works:** the temporary build withholds `zone.done`, and only that acknowledgement fails (exit 1 is expected) |
| `--drop-ack dispatch` (round 2) | dev | fails only its dropped dispatch ack, as designed |
| `--host worker` | dev | exit 3, 55 skipped: "worker host not in this build; requires T034 / W1.2 WorkerSimHost" |

What the loopback run (+J0) covers:
- **All 23 UI commands, with transported acknowledgements, through the real tools and panels:**
  - speed: TopBar, keys 1/2/3, PauseMenu resume, Onboarding Play;
  - zone and dezone, network, power line, subway, plop, bulldoze, the InfoPanel Demolish;
  - trees, a held terraform brush that reaches flat (one release sound, no toast);
  - tax, funding, loan and repay, an ordinance, settings, setHistoric;
  - triggerDisaster, dismissAlert;
  - dispatch through the banner and DispatchTool, and Send nearest.
- **Ghosts:** two real strokes, exact then provisional, with both ghosts kept through the ack.
- **Packet replies and cause tags:** each dispatch event carries its original seq and tag.
- **The recovery mirror:** the App's pagehide wrote 7 whitelisted edits bound to the snapshot.
- **Saves:** Ctrl+S's camera ticket and the manual save reply are acknowledged in order. Save → reload → Continue
  preserves the day, funds, nextBuildingId, the camera, the layers and the player's edits.
- **The region:** exit to the region and back to a playable city.
- **The replica:** authoritative = replica = `3826532553`.
- **Panels and views:** every Appendix A panel and a data view open and render.
- **Health:** 0 console errors, 0 page exceptions, 0 crashes, and full cleanup.

### The protector finding (J0, now T059)

`src/render/city/buildings/lodBuilder.ts:138` posted the LOD job arrays with a transfer list from the main thread, so
the first LOD job detached ArrayBuffers there and invalidated the main isolate's ArrayBuffer-detaching protector.
- WORKER_DESIGN §6 row S0 asks for `w.postMessage(msg)` with no transfer list. It never landed.
- T059 (`local/T059-s0-lod-transfer`) makes that change.
- The A/B above shows the effect: on dev the main protector is intact at boot and invalidated by the end of the run;
  with T059 it stays intact at boot, at the end and after the freeze, on both hosts.

### Remaining for this task

- Worker-mode acceptance, once T034 is in dev: rerun with `--host worker`. The checks are written and skip cleanly
  today.
- The close-page journal restore, once T039 (W1.3) lands.
- The protector check passes on dev only after T059 merges. Until then, a dev run reports the J0 bug, correctly.

Logs and JSON outputs are in the worker's scratch (`t028/r3/`, plus `t028/` for round 2 and `t028/round1/`).

## Review round 3 — f22933f

The lead reran the round-2 harness on **Chromium 141 / RTX 5070 Ti**. Read the supplied logs in
`C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/t028/`
and its `x59/` subdirectory. `x59` is the lead's temporary merge with `local/T059-s0-lod-transfer`, which changes
the main LOD post to clone-only. These are results for **f22933f**, before the fix below; no browser was launched here.

| Supplied run | PASS / FAIL / SKIPPED | Remaining failure |
| --- | --- | --- |
| dev loopback | 50 / 3 / 3 | Main protector initialization at boot, end and after freeze. |
| dev local | 47 / 0 / 9 | None; optional protector/verify gates were disabled. |
| dev local --w1 | 48 / 3 / 5 | Same three main protector initialization failures. |
| T059 merge loopback | 50 / 3 / 3 | Same three failures despite clone-only LOD posts. |
| T059 merge local --w1 | 48 / 3 / 5 | Same three failures. |

The isolated freeze passed **8 / 0 / 48**: **15007 ms**, **0** frozen frames, **45.2 ms** visible resume. Both real
broken-ack controls passed their control verdict and exited **1**, **9 / 1 / 47**, with only pending zone seq **4**
(loopback) / **5** (local) failing. `--drop-ack dispatch` retained pending dispatch seq **13**; its dispatch check
and aggregate ack check failed for that same ticket, alongside the three known protector initialization failures
(**46 / 5 / 5**). Worker mode exits **3**, **55 skips**, because T034 is absent. The earlier Onboarding, Query/InfoPanel, dispatch input, lifecycle
and negative-control harness fixes now pass their relevant gates. No new host/packet/query/ack defect is demonstrated.

### Finding and fix

**High / harness, reviewed f22933f `tools/qa-worker/w1.mjs:17-28`:** the bit-16 initialization test rejected
Chromium's **41, 41, 41, 41** statuses even though native syntax was working. Optimization-status bit assignments
vary by V8 version; the numeric value alone does not establish the active tier. Accepting another bit or relaxing
status equality would not prove that the typed-array loop retained the detachment dependency the check needs.

The probe now establishes TurboFan synchronously before application imports using
`%PrepareFunctionForOptimization` and `%OptimizeFunctionOnNextCall`, and checks the actual active tier with
`%ActiveTierIsTurbofan`. `%GetOptimizationStatus` remains diagnostic only. The sampled typed array stays attached;
a transfer of a different buffer must invalidate its isolate-wide dependency and stop the probe remaining in
TurboFan. Failure is sticky, including across an attempted reinstall. Missing native syntax, unsupported intrinsics
and failure to establish the required tier fail closed with their actual diagnostic.

**High / harness, reviewed f22933f `checks.mjs:278-287`, fixed `w1.mjs:98`:** reload replaces the probe's global.
A retained renderer isolate could then compile a new loop with explicit detached-buffer checks after an earlier
invalidation, hiding it. The save/reload path now checkpoints main and sim before navigation and retains any failure
for the later protector gates, while allowing the save/Continue UI checks to finish. Browser check names/counts are unchanged.

The V8 primary sources expose the explicit tier predicate in
[runtime-test.cc](https://raw.githubusercontent.com/v8/v8/main/src/runtime/runtime-test.cc) and define the current
status bits in [runtime.h](https://raw.githubusercontent.com/v8/v8/main/src/runtime/runtime.h). These are current
upstream sources, not a pinned Chromium 141 bitfield claim; the probe therefore uses the predicate directly.

`PROTECTOR_V8_FLAGS` centralizes these process-wide flags in `w1.mjs`:

```text
--allow-natives-syntax --no-maglev --no-optimize-on-next-call-optimizes-to-maglev
```

`run.mjs` supplies them to Chromium as the single argument
`--js-flags=--allow-natives-syntax --no-maglev --no-optimize-on-next-call-optimizes-to-maglev` and records the flags
in JSON `details.v8Flags`. The flags and tier assertion apply to main and the dedicated simulation worker named
`sim`. Independent LOD workers remain outside the sim-isolate gate and are resumed normally. The exact
[V8 14.1 flag definitions](https://raw.githubusercontent.com/v8/v8/ad8af0fc661d278e87627fcaa3a7cf795ee80dd8/src/flags/flag-definitions.h)
expose these tier controls. No application or performance-harness code changed; these flags apply to the acceptance harness.

### Files, commands and validation

| File | Change this round |
| --- | --- |
| `tools/qa-worker/w1.mjs` | Central V8 flags; explicit TurboFan baseline and active-tier check; numeric status diagnostics; sticky failed baseline. |
| `tools/qa-worker/run.mjs` | Use the shared Chromium V8 flags and record them in report details. |
| `tools/qa-worker/checks.mjs` | Checkpoint the old isolate before reload without masking or aborting the save/Continue checks. |
| `tools/qa-worker/protector-selftest.mjs` | Repeated clean and clone success; unrelated-buffer transfer detaches and fails persistently; reinstall cannot reset failure; unsupported native syntax fails closed. |
| `tools/qa-worker/selftest.mjs` | Simulated native-tier regressions for status 41, status drift, missing TurboFan, sticky failure and reload retention. |
| `tools/qa-worker/README.md`, this report | Exact flags/commands, supplied GPU results, classification and remaining browser controls. |

Run from this worktree, one process at a time:

```powershell
$root = 'C:/Users/techsin/Desktop/projects/simcityweb-T028'
node "$root/tools/qa-worker/selftest.mjs"
node --allow-natives-syntax --no-maglev --no-optimize-on-next-call-optimizes-to-maglev "$root/tools/qa-worker/protector-selftest.mjs"
node --no-maglev --no-optimize-on-next-call-optimizes-to-maglev "$root/tools/qa-worker/protector-selftest.mjs"
```

**43 Node selftests passed, 0 failed.** New test names:

- protector probe: active TurboFan passes with status 41; status drift alone cannot fail it
- protector probe: numeric status cannot substitute for an active TurboFan dependency
- protector gate: reload cannot erase an earlier isolate invalidation

Both native commands above passed on **Node 22.12.0**. Repeated clean/clone checks retained TurboFan (**status 81**);
the unrelated buffer detached (**byteLength 0**) and the dependency deoptimized (**status 129**, TurboFan false),
with failure preserved through repeated checks and reinstallation. Omitting native syntax failed closed with
SyntaxError. These Node results do not establish the new Chromium tier path.
Syntax checks of `run.mjs` and `checks.mjs` passed. `git diff --check` and UTF-8-without-BOM checks passed.
No browser, production build, Vitest, bench, bot, commit, push, merge or DONE marker is part of this review.
**Infra/outside-owned source hunks: none. Cloud-held file changes or new requests: none.** The existing J0 request
is addressed by the lead's separate T059 branch; it is not implemented in this worktree. No balance/RNG/simulation
changes; the unchanged optional seed-7 bot expectation remains **[61124, 93804, 37971] = 192899**, unrerun.

### Browser controls left for the lead

Use the same [README commands](../../../tools/qa-worker/README.md) against each build prepared by the lead:

- [ ] Clean T059 merge: full loopback and local `--w1` keep main intact at boot, end and after freeze; all other applicable checks pass. Repeat the >=15000 ms freeze gate with <=1000 ms visible resume, 0 frozen frames and 0 overlays/errors.
- [ ] dev with main LOD transfers: after LOD activity, main protector fails. This is the expected render-side J0 failure, distinct from unavailable/unsupported-probe initialization.
- [ ] Deliberate transfer control: a transfer of an unrelated main-thread buffer detaches it and makes the probe fail persistently; clean polls and clones pass. The native selftest exercises this without a browser; Chromium behavior remains to be confirmed by the two builds.
- [ ] Both real broken-zone builds still exit 1 with **PASS broken-build control**, exactly their pending-zone acknowledgement failure, and no unrelated failure on the clone-only build.
- [ ] `--drop-ack dispatch` still fails only its transported dispatch acknowledgement on the clone-only build; worker preflight remains exit 3 until T034. When T034 lands, require the same intact baseline in exactly one dedicated `sim` worker.

Plan versus code: the acceptance check still measures loss of an optimized typed-array loop's detachment
dependency; it now requires an explicit TurboFan tier instead of decoding a version-dependent bitfield. The forced
tier is harness-only, and the browser's native intrinsic behavior and dev/T059 contrast remain unverified here.
The prior report below is preserved as historical evidence.

## Review round 1 — 8ef8f7c

Read all eight `.log`/`.json` pairs in
`C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/t028/`:
loopback, freeze, broken-zone, broken-local-zone, probe-control, local, local-verify and worker.
These are the lead's **Chromium 141 / RTX 5070 Ti** results from the pre-fix build; no browser was launched here.

| Supplied run | PASS / FAIL / SKIPPED | Evidence |
| --- | --- | --- |
| loopback | 42 / 8 / 6 | Ghosts, brush, replica verify, journal, save/Continue and exit passed; dispatch never issued a ticket. |
| local | 42 / 5 / 9 | Same Onboarding/Query failures; both dispatch commands passed; freeze failed. |
| local-verify | 43 / 7 / 6 | Same reference failures, plus unrelated LOD probe initialization failures. |
| freeze | 7 / 1 / 48 | Day **91** before arming, **1369** later frames; no freeze/resume/visible timestamps despite 15004 ms external sleep. |
| broken-zone | 8 / 2 / 47 | One transform; real pending zone **seq 4**; poll deadline misclassified it as missing-command. |
| broken-local-zone | 8 / 2 / 47 | One transform; real pending zone **seq 5**; same poll bug. |
| probe-control | 42 / 8 / 6 | Dispatch never posted, so its observer fault was not consumed; not yet a valid negative control result. |
| worker | 0 / 0 / 55 | Expected absent-host skip; exit 3. |

### Classification, fixes and exact source evidence

| Severity / classification | Location | Finding and fix |
| --- | --- | --- |
| High / harness | `tools/qa-worker/driver.mjs:104`; `src/ui/hud.css:407-415` | Play exists but its non-current step action intentionally has opacity 0 and pointer-events none until the row is hovered. Hover the actual Play row, wait with a trial click for actionability, then observe the real click. No forced click, style mutation or direct command. |
| High / harness | `tools/qa-worker/driver.mjs:4,76,101`; `src/game/tools/ToolController.ts:130,170` | Query is the default tool and intentionally has activeId null; the old assertion demanded string query even after a successful toolbar click. Validate actual tool.id query plus null activeId. This fixes the shared InfoPanel Demolish/setHistoric failures; missing historic ack coverage was consequential. |
| High / harness | `tools/qa-worker/w1.mjs:16,60-64,82`; `tools/qa-worker/run.mjs:87` | Chromium already receives --allow-natives-syntax; the old error means native syntax parsed but optimization was not established. LOD render workers were wrongly required to pass the simulation-isolate gate. Probe only main and the dedicated worker named sim, resume LOD workers, warm synchronously before application imports, retain status diagnostics and fail closed. The precise Chromium cold/debugger optimization cause remains unverified without a rerun. |
| High / harness, loopback-only race | `tools/qa-worker/checks.mjs:361`; `tools/qa-worker/driver.mjs:114,139` | Async dispatchOptions caused DispatchTool.refreshOptions (`src/game/tools/DispatchTool.ts:205-212`) to run its initial fitCamera (`:179`) after harness station focus. Wait for the intended incident, station in watch and rendered options, and fitPending false before station focus. Camera settling now uses the 8-second ack deadline with actual/expected coordinates, not the 180-second boot deadline. |
| High / harness | `tools/qa-worker/harness.mjs:119-133` | poll slept the final remaining interval, then launched another healthy page read with about 1 ms left. That read raced its deadline and changed an issued pending ticket into missing-command. End polling after the final sleep, recheck the deadline after any oversleep, and allow one polling interval of read grace at the boundary. Genuine stalled/failed reads remain distinct and cannot pass a control. Retain the pending seq in the acknowledgement-deadline diagnostic and the unchanged strict broken-build verdict. |
| High / harness | `tools/qa-worker/lifecycle.mjs:8`; `tools/qa-worker/freeze.mjs:14,56-101`; `tools/qa-worker/page.mjs:125` | Playwright 1.56.1 enables focus emulation on its owning CDP session (`node_modules/playwright-core/lib/server/chromium/crPage.js:438`), holding a stay-visible capture handle. A new CDP session cannot release that owner's handle. A version/shape-guarded adapter disables it on the actual owner; minimize and confirm hidden, require a trusted native DOM freeze via Runtime binding, hold >=15000 ms, require trusted resume, restore visible, then require progress <=1000 ms. Restore focus/visibility in cleanup. No synthetic lifecycle event/timestamp or relaxed threshold. |

Dispatch is **not a demonstrated host bug**. In both loopback runs there are **zero dispatch/dispatchBest tickets**
and **89 resolved setCamera tickets** while the active tool is dispatch, all at `{x:1544,z:2032,distance:1447}`.
The requested station focus was `{x:1128,z:2024,distance:520}`. Timeout happened before pointer input and before
`DispatchTool.ts:358` could call host.act. Local's initial watch is synchronous, so it fits before the harness focuses:
dispatch returned **sent 1 / ETA 5.1**, dispatchBest **sent 1 / ETA 5.3**. Reviewed queued transport, packet watch
production/reception, T029 policy and dispatch acknowledgements; no worker/query/ack source change is warranted.

Failed Onboarding Play does **not** explain the isolated/reference freeze failures: explicit TopBar setSpeed(3)
acknowledged, the pre-freeze progress check passed, and freeze.json already shows day 91 (spring start is day 90).
Local/local-verify also reached CDP freeze and recorded 1349/1381 frames without lifecycle events. Full loopback's
before-freeze failure followed its undelivered dispatch input and waiting fires; it is not evidence of a lost host
speed ack. New JSON records preFreezeDay/runningDay and the real native lifecycle separately.

Primary Chromium explanation: [EmulationHandler focus emulation](https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/protocol/emulation_handler.cc)
holds a non-hidden capturer. Installed Playwright source establishes ownership. The adapter uses
`page._connection.toImpl(page).delegate._mainFrameSession._client`; it fails explicitly if version 1.56.1 or that
shape changes. It does not patch Playwright or application files. This version-specific harness dependency and the
actual minimize/freeze behavior must be verified on the lead's GPU rerun.

### Separate source finding / request to the lead

**High, render-side J0 divergence, not an observed dispatch/LoopbackSimHost bug:**
`src/render/city/buildings/lodBuilder.ts:138`, **LodProxyBuilder.post(job)**, still calls
`postMessage(msg, [msg.position.buffer, msg.color.buffer, msg.surf.buffer])` from main. The arrays are already
slice copies, so change that call to **`this.workers[k].postMessage(msg)`**, retaining all surrounding behavior.
WORKER_DESIGN J0 requires clone-only main posts to keep main's detachment protector intact. The Node native control
confirms a transfer invalidates the probe. The old LOD initialization failure stopped check() before it read main;
the supplied output therefore does not establish main's status. The fixed harness keeps the main gate strict and
will report that status even alongside worker failures. Route this minimal hunk to the render owner; **no src file
was edited here**. `lodWorker.ts` transfers affect only that independent render isolate and need no sim-gate change.
No change request for src/worker/**, App wiring, or another cloud-held file.

### Round 1 files and validation

| File | Change this round |
| --- | --- |
| `tools/qa-worker/driver.mjs` | Hover/trial-click Play; default Query identity; await packet options/initial fit; bounded diagnostic camera polling. |
| `tools/qa-worker/checks.mjs` | Use the Play helper and await/record dispatch readiness before station input. |
| `tools/qa-worker/harness.mjs` | Current review base and final-interval polling fix; strict control classification retained. |
| `tools/qa-worker/w1.mjs` | Main/sim-only protector, synchronous warm-up, optimization-status diagnostics, main failure collection. |
| `tools/qa-worker/lifecycle.mjs` (new) | Guarded adapter for the installed Playwright owner's focus emulation. |
| `tools/qa-worker/freeze.mjs` | Real hidden/freeze/resume handshake through native CDP binding; progress evidence and restored visibility/focus. |
| `tools/qa-worker/page.mjs` | Capture lifecycle data, emit native binding evidence, reset progress baseline on real visibility return. |
| `tools/qa-worker/selftest.mjs` | Ten new browser-free regressions and updated visibility restoration test. |
| `tools/qa-worker/protector-selftest.mjs` (new) | Native clone/transfer and unavailable-native-syntax controls. |
| `tools/qa-worker/README.md`, this report | Current behavior, classifications, exact commands and rerun requirements. |

**40 Node selftests passed, 0 failed**. Added names:

- broken controls: healthy asynchronous pending reads end as ack timeout, with the actual ticket seq
- broken controls: an overslept polling interval never starts a fresh read after the deadline
- Query toolbar: null activeId is the selected default QueryTool, never a failed selection
- Onboarding Play: hover the row, wait for a real actionable button, then issue the click
- Dispatch input waits for packet watch data and the initial tool camera fit before station focus
- protector gate: LOD workers resume without a sim probe; missing sim and invalid main still fail
- protector gate: the sim worker is probed before startup and initialization failure stays a failure
- freeze adapter: disable focus emulation on Playwright owning session, failing closed on API or version drift
- freeze setup: requires a genuinely hidden page before attempting frozen lifecycle
- freeze control: a CDP frozen acknowledgement without a real DOM freeze fails and restores focus/visibility

Both commands also passed:

```powershell
node --allow-natives-syntax C:/Users/techsin/Desktop/projects/simcityweb-T028/tools/qa-worker/protector-selftest.mjs
node C:/Users/techsin/Desktop/projects/simcityweb-T028/tools/qa-worker/protector-selftest.mjs
```

The first proves initial warm-up and clones pass while a transfer negative control fails; the second proves
unsupported native syntax fails closed. No browser, production build, Vitest, perf run or bot was launched in this
round. No TypeScript/simulation/balance/RNG changes. The earlier typecheck/fixture limitations below remain historical;
this review's requested validation is Node-only. `node --check tools/qa-worker/checks.mjs` also passed;
the browser-free `--host worker` preflight still exits **3**. `git diff --check` passed and all 11 changed files
are valid UTF-8 without a BOM. All changes remain uncommitted.
**Infra/outside-owned source hunks: none.**

Round 1 rerun checklist (exact commands remain in README):

- [ ] Local and local --w1: Play emits `(1,onboarding)` after actual hover/actionability; Query reaches both inspector actions and setHistoric acknowledges.
- [ ] Loopback: dispatch readiness JSON precedes station focus; actual dispatch and dispatchBest tickets appear, sent>0/finite ETA; packet/cause gates run. No 180-second camera wait.
- [ ] Main protector remains strict; report a main invalidation separately from the removed LOD false gate. Worker named sim still requires pre-import initialization when T034 exists.
- [ ] Isolated headless/headed freeze and full-run freeze: actual hidden state, trusted native freeze/resume, >=15000 ms external and document intervals, 0 frozen frames, visible progress <=1000 ms, 0 overlays/errors, focus restored.
- [ ] Both real broken-zone controls: exit 1, one target `ack-timeout` with seq>0, **PASS broken-build control**, no unrelated errors. A true read timeout still invalidates a control.
- [ ] Probe-control: the first actual dispatch consumes the observer fault; its pending ticket fails the ack check after session replacement.
- [ ] Full loopback retains 23-op coverage, ghosts/brush/save/reload/region teardown and zero-console-error gates; worker remains 55 skips / exit 3 until T034.

No bot rerun is needed for these harness changes; the unchanged expected seed-7 128x15 residents remain
**[61124, 93804, 37971] = 192899**. The exact optional quiet-gated command remains in the initial report below.

## Initial implementation record (before the lead's GPU review)

Date: 2026-11-03. Worktree/branch: `simcityweb-T028`, `local/T028-qa-worker`. Reviewed HEAD: **28a4862**.
Read the full task and WORKER_DESIGN (including §5.4, Appendix A and R16), the previous report, the harness,
and current T031 HostActions/PendingEdits/tool commits, T032 packet host/replica/replies/resyncs, T033
RecoveryMirror, cause-tag/ack APIs and relevant UI callers. No AGENTS.md or CLAUDE.md was found in the
worktree or its ancestor directories checked.

**Loopback is now the default runnable browser path**, using `?simworker=loopback`, current shared digest,
protector, pending/provisional/ghost checks, UI playability and exit teardown. Worker uses the same host switch
and skips before browser startup with **worker host not in this build** until T034 exists. Runtime fallback
is a failure. **No browser acceptance result is claimed**: browsers were expressly prohibited for this turn.

## Review findings and fixes

Locations below point to the resulting implementation of each fix, so they remain useful for review.

| Severity | File:line | Finding and fix |
| --- | --- | --- |
| High | `tools/qa-worker/run.mjs:19`, `harness.mjs:61` | Old gate blocked loopback without a future --w1 flag and claimed only LocalSimHost existed. Current CityScene selects LoopbackSimHost. Loopback is enabled/default; --host worker detects the missing host file before Vite/Playwright import, with the required clear skip. |
| High | `tools/qa-worker/run.mjs:48`, `w1.mjs:82` | Shared digest/query were treated as absent. Automatically build the existing `src/worker/queries.ts` exactDigest export and call `host.query('verify', {})` against the paused replica. No invented hash or replica serialization. |
| High | `tools/qa-worker/harness.mjs:139` | Ack oracle rejected legitimate exact predicted failures at seq 0, making held Level saturation fail in loopback. Accept them only as explicitly allowed exact unposted refusals with false prediction/result; they never satisfy transported ack coverage. |
| High | `tools/qa-worker/harness.mjs:154`, `checks.mjs:422` | Strict sequence increase rejected legitimate coalesced sliders. Allow repeated sequence only for matching setter/key and actual shared done promise identity; all new transported tickets must increase. |
| Medium | `tools/qa-worker/page.mjs:45` | Probe omitted predictions/pending state, so it could not distinguish exact, provisional, transported and unposted results. Record each separately, plus actual promise identity and replica applied watermark. Probe-only drop control cannot consume a seq-0 refusal. |
| High | `tools/qa-worker/checks.mjs:92`, `page.mjs:81` | No pending ghost or hover acceptance despite T031. Two actual canvas strokes in one task force exact then provisional predictions. Observe actual mesh presence, pending claims/hover and clear after Ack replay; require zero reservations/meshes after settlement. |
| High | `tools/qa-worker/driver.mjs:18` | Installing the observer at scene construction could instrument the loading/null world, missing real ghosts. Pause arrival through real Space early, then install after real views and __ready. Setup pause is not counted as command acceptance. |
| Medium | `tools/qa-worker/page.mjs:143`, `checks.mjs:317` | Teardown lacked signal-bound plain evidence and could inspect a replacement null world. End observers on ctx.signal, archive plain data, then measure the captured original world's resources after all synchronous disposal completes. Require abort(dispose), zero pending/ghosts, then playable region return. |
| High | `tools/qa-worker/checks.mjs:452` | Incident lookup reached through ctx.sim.getSystem. Use host.emergency's mirrored incidents and poll for readiness. |
| Medium | `tools/qa-worker/page.mjs:63`, `checks.mjs:378` | Dispatch checked only the input tag; packet replies/resync outcomes were unobserved. Check actual emergency dispatched replay cause seq/tag, cleared cause, reply cmd <= replica.applied and zero unexpected resyncs in healthy acceptance. A resync-lost outcome remains a rejected ticket, never a fabricated ack. |
| Medium | `tools/qa-worker/checks.mjs:201`, `checks.mjs:342` | Stale skips hid existing setSettings/dismissAlert. Use Settings Emergency alerts All and a separate fire site's real close button before dispatching the available fleet; require void ticket settlement and resulting mirrored policy. Coverage now requires 23 UI ops. |
| High | `tools/qa-worker/page.mjs:100` | Save observer dropped the current second SaveReason argument, changing exit saves to manual saves. Forward all arguments unchanged; regression checks save(false, 'exit'). |
| Medium | `tools/qa-worker/page.mjs:93`, `checks.mjs:258` | Save checks described old App persistence and observed only camera/save pill. Also require real host.save(manual) reply and cmd >= its own camera seq, delivered after commands replay. |
| Medium | `tools/qa-worker/checks.mjs:236` | Recovery was wholly marked absent despite integrated T033 mirror. Drive a real UI edit, invoke the real App pagehide handler, inspect its ordered base-bound whitelisted journal, then balance the synthetic lifecycle with pageshow. Worker close-page replay remains a separate W1.3 gate. |
| High | `tools/qa-worker/build.mjs:12` | Broken-build transform only supported local mode. Add actual PacketSimHost.ack settlement withholding for loopback/worker, preserving mutations/replay/other acks; fail closed on source drift and retain strict negative-control verdict. |
| High | `tools/qa-worker/fixture.test.ts:26` | Fixture tested only local; sim.runDays throws on the loopback facade. Parameterize both modes, use loopback's deterministic harness + drain only in node tests, and use host.emergency/host.state. Add real commitAction provisional/ghost/cause/query/abort/correction tests. |
| High, caught during fix review | `tools/qa-worker/checks.mjs:344` | A proposed third fire site at x118 would cluster into first x122. Place at x135 (gap4 from x130 exceeds FIRE_CLUSTER_R3), before dispatch consumes the fleet, and assert distinct incidents. |
| Medium | `tools/qa-worker/README.md:1`, `harness.mjs:3` | Old base, future-host instructions and 196101 bot number were stale. Replace with current commands, explicit skips/limits and the supplied 192899 reference. |

The retained October fixes were also checked: true build transform rather than observer-only control, safe argument
cloning after act, issuing-tool gestures, held brush settlement/sound timing, banner settleUntil waits, readiness reset,
save correlation, lifecycle resume oracle, primary-error preservation, owned-build cleanup and signal handling.

## Files changed

| File | Change |
| --- | --- |
| `tools/qa-worker/harness.mjs` | Current base/default host, switches/check prerequisites, 23 ops, refusal and coalescing validation. |
| `tools/qa-worker/run.mjs` | Loopback enabled, absent-worker preflight, automatic shared digest/protector, host-specific fault transform. |
| `tools/qa-worker/build.mjs` | Real packet-host broken-ack transform with strict anchors/evidence; local transform retained. |
| `tools/qa-worker/w1.mjs` | Current exactDigest and explicit verify query arguments. |
| `tools/qa-worker/page.mjs` | Prediction/pending/promise/mesh/cause/packet/save/gesture evidence; preserve save args; signal disposal and captured-world teardown. |
| `tools/qa-worker/driver.mjs` | Real-view observer installation after early arrival pause; plain session archives; real banner close support. |
| `tools/qa-worker/checks.mjs` | Ghost/provisional/hover, current settings/dismissal, mirror journal, save watermark, cause/reply, teardown and current ack coverage. |
| `tools/qa-worker/selftest.mjs` | Current CLI plus refusal/coalescing, save reason, packet broken-build and teardown/real-view/control regressions. |
| `tools/qa-worker/fixture.test.ts` | Both real host fixture modes and three real commitAction lifecycle tests. |
| `tools/qa-worker/README.md` | Exact desktop/cloud commands, controls, numeric acceptance evidence, available gates and limits. |
| `docs/dev/reports/local-T028-qa-worker.md` | This explicitly requested report. |

No hunk outside the named files. **Infra hunks: none. Cloud-held file changes/requests: none.**
`tools/qa-worker.mjs`, `freeze.mjs` and `tools/bench/browser-check.mjs` remain unchanged.
Changes are uncommitted; no push, merge, branch switch or DONE file.

## Validation and loopback results

| Check | Result |
| --- | --- |
| `node tools/qa-worker/selftest.mjs` | **30 passed, 0 failed**, latest run after fixes. |
| `npx tsc --noEmit` | **PASS**, including the new fixture tests. |
| quiet-gated `npx vitest run tools/qa-worker/fixture.test.ts --maxWorkers=1` | **Could not start**: Vite loading vite.config.ts failed `[plugin externalize-deps] Error: spawn EPERM` in Windows real-path resolution. **0 tests executed**, not a fixture failure/pass. No alternate config or dependency workaround. |
| `node tools/qa-worker.mjs --host worker` | **55 SKIPPED, 0 failed**, each says worker host not in this build; Node exit **3** verified with PowerShell LASTEXITCODE. No build or browser. |
| `git diff --check` | **PASS**. |
| Changed-file encoding | **UTF-8, no BOM** verified. Scratch `validation.json` and `worker-preflight.json` record the non-browser results. |
| Loopback browser/live-frame, real GPU, production build, protector/CDP | **Not run by instruction**. Numeric targets below are requirements, not measured results. |
| Bot/full Vitest/perf | **Not run by instruction/scope**. No balance, RNG or sim behavior changes. |

Selftest names (all passed):

1. CLI: loopback runs by default; worker shares the host switch; local W1 is optional
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
24. loopback oracle: exact unposted refusals are classified without satisfying transported ack coverage
25. loopback oracle: only same-key sliders sharing the actual promise may coalesce sequences
26. probe: forwards save reason and observes the real host save watermark
27. broken loopback build: only target settlement is withheld; packet mutation and other acks still complete
28. probe: abort teardown measures the original world even after the scene replaces it
29. ready: instruments the arriving real view after loading views are replaced
30. probe control: an exact unposted refusal cannot consume the dropped transported ack

Fixture test names (typechecked; execution blocked before test discovery):

- QA local fixture grows an inspectable building and supports both manual dispatch commands
- QA loopback fixture grows an inspectable building and supports both manual dispatch commands
- QA loopback tool lifecycle > settles provisional edits after tagged replay, retaining ghosts through each Ack
- QA loopback tool lifecycle > clears pending ghosts and watches on city abort without late feedback
- QA loopback tool lifecycle > routes several authoritative refusals to the issuing tool once per gesture

## Commands and remaining real-GPU gates

The [README](../../../tools/qa-worker/README.md) contains the full absolute worktree/scratch setup and exact commands
for local, loopback, worker, isolated ghosts/freeze, controls and SwiftShader. Main acceptance invocations:

```powershell
Set-Location 'C:/Users/techsin/Desktop/projects/simcityweb-T028'
node C:/Users/techsin/Desktop/projects/simcityweb-T028/tools/qa-worker.mjs --host loopback --out C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T028r/scratch/loopback.json
node C:/Users/techsin/Desktop/projects/simcityweb-T028/tools/qa-worker.mjs --host loopback --break-ack zone --out C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T028r/scratch/broken-zone.json
node C:/Users/techsin/Desktop/projects/simcityweb-T028/tools/qa-worker.mjs --host worker --out C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T028r/scratch/worker.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tools/qa-worker/fixture.test.ts --maxWorkers=1
```

No bot is needed for a harness-only change. If the lead repeats the supplied invariant, run from this worktree:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

Capture its stdout to the supplied scratch folder using a UTF-8 writer. Expected 2015 residents remain
**[61124, 93804, 37971] = 192899**; Medium/Hard and old-save continuation are unchanged by design.
No 256×60 bot, simulation hash or timing number is claimed/required for this harness-only lane.

Browser acceptance checklist (all left for the lead):

- [ ] Full loopback production run exits 0 on real GPU with actual host.kind loopback and real 256-cell views.
- [ ] All **23** UI ops have transported acks; no pending/rejected tickets; exact seq-0 refusals and valid slider coalescing accepted separately. Observed gestures settle with **<=1** failure each.
- [ ] **2** rapid strokes give exact then provisional, **2** visible pending meshes and live hover/claims, then **0** pending edits/ghosts after Ack. Visually confirm neutral pending style and no blink.
- [ ] Raise **>=3** successful acks; held Level paid work then **>=2** flat refusals, **1** settled gesture, **1** post-settlement release sound, **0** early release sounds/toasts.
- [ ] Both distinct dispatch paths preserve target, sent>0/finite ETA, issuing cause seq/tag; third distinct alert dismisses. Settings policy command acknowledges.
- [ ] Packet qres/saved replies have cmd<=applied; **0** unexpected resyncs; authoritative/replica exact digests equal. Protector intact at boot/end/after freeze.
- [ ] Ctrl+S includes its camera in host save cmd; reload/Continue preserves day/funds/next id/layer/policy/building/camera markers and advances days afterwards.
- [ ] PauseMenu save/exit aborts old city, **0** pending/ghost resources in captured old world, then region return is playable. Exercise Ctrl+C/SIGTERM cleanup; no owned preview/build/browser remains.
- [ ] RecoveryMirror pagehide journal contains the UI zone in an ordered matching-base suffix; excludes nonjournal ops. Worker close-page restoration is a separate W1.3/T039 follow-up.
- [ ] Freeze **>=15000 ms**, **0** frozen frames, visible sim resume **<=1000 ms**, **0** crash/error overlays and **0** console errors/page exceptions/crashes. Repeat isolated headless/headed freeze if needed.
- [ ] Broken loopback build exits **1** with **PASS broken-build control**, one target pending-ack failure, **0** unrelated/cleanup failures. Separately exercise cross-session --drop-ack dispatch.
- [ ] Appendix A panels/tools, every overlay/variant, inspector/watch target changes, emergency LIVE, MiniMap/news, New Year, vehicle animation, save/region lifecycle all remain visually/playably correct. Panel/Power smoke checks are automated; full parity is manual.
- [ ] Error-overlay Pause in a separate intentional error fixture (healthy zero-error run explicitly skips it).
- [ ] Repeat worker mode when T034 lands; exactly **1** sim worker, protectors intact in both isolates, same current gates. From T039/W1.3, close-page journal restore must preserve the in-flight edit.

## Plan versus current code and verification limits

- Original task says new-files-only, local-only and push/DONE; this T028r request explicitly authorizes finishing
  the existing harness/report and requires uncommitted changes, no push/DONE. The newer request was followed.
- T031/T032/T033 are present: exact/provisional HostActions, seq-0 exact refusals, coalesced setters, tagged replay,
  replies inside packets, fresh-state resync and RecoveryMirror. No worker/main/cloud code workaround was made.
- §5.4 calls verify dev-only while requiring production QA; the current verify handler/export are present in production.
  The harness builds the actual shared export as an additional production entry.
- Ctrl+S already reaches host.save via App and camera ordering. Both paths are now observed; no fake save ticket.
- `holdCalendar` is newer than the Appendix A command table. Any observed ticket is validated, but this short fixture
  does not force midnight; New Year remains a manual Appendix A check.
- W1.3 worker close-page restore remains explicitly skipped; current loopback mirror write is exercised separately.
- Chromium's hidden-after-active behavior still requires visibility restoration and the later resume/visible timing origin.
- Error-overlay Pause and complete overlay/consumer screenshot parity remain separate manual checks, clearly unclaimed.
- browser-check.mjs already has production wasm kernel checks; its planned real-game worker/actions/save extension
  remains a W1.2 follow-up. This lane's current game actions/save gate is qa-worker.mjs; no existing bench was changed.
- No production build, real browser/GPU, CDP/protector, live loopback fixture, browser broken-build control or actual
  persistence/recovery UI timing was verified. Vitest was blocked by sandbox spawn EPERM; it must be rerun outside
  this restriction. Node oracle success does not establish those browser gates.
