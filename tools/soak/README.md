# T019 production soak harness

Run from the repository root, **one run at a time, between timing runs**. The harness lowers its own, the build launcher's, and Chromium's process priority to below normal and records the result. Priority is not isolation: do not overlap this with a benchmark, fixture generation, another browser run, or another soak.

Only new files under `tools/soak/` belong to this change. No application hooks are added. Runs build and exercise the checked-out production app; they never import `/src/` into the live game. Changes are intentionally uncommitted.

## Two required 20-minute smokes

With dependencies and Playwright Chromium already installed, and the documented dense1m fixture available:

```powershell
node tools/soak/run.mjs --city dense1m --minutes 20 --cycle-minutes 5
node tools/soak/run.mjs --city small --minutes 20 --cycle-minutes 5
```

Run the second command after the first finishes and while no timing run is scheduled. Each gets a fresh Chromium process and isolated storage. The default fixture is `tools/bench/.fixtures/fixtures/dense1m_s7.metropolis`; `SIM_FIXTURES` or `--fixture PATH` overrides it. Missing input is a failure with an explanation, never a silently substituted small city.

If dense1m is missing, build it separately before scheduling the smoke:

```powershell
cmd.exe /d /s /c "npm run fixtures -- --only snap,dense1m"
```

This is existing project tooling, not part of the soak. See [test cities](../../docs/dev/TEST_CITIES.md). Alternatively, use the shared 991,493-resident `vet_s7_y43.region.metropolis` (or its `.city.metropolis` companion) for the **large** smoke:

```powershell
node tools/soak/run.mjs --city vet --fixture "C:\path\to\cities\vet_s7_y43.region.metropolis" --minutes 20 --cycle-minutes 5
```

Replace that example fixture path with its actual location. `small_s7_y10` is not the small scenario: `--city small` founds a new 64×64 flat sandbox city with seed 7, verifies that it initially has zero buildings, builds roads (including an edge connection), two wind turbines, a water tower, a clinic and a fire station (without fire cover the clinic, the only clickable service building, burnt down 15 minutes into an ultra run), zones R/C/I, and waits up to three minutes for an occupied growable. All construction uses player input. Sandbox prevents a new settlement's treasury from ending a multi-hour run; no money, population, buildings or simulation fields are injected.

The duration starts **after** build, loading and small-city establishment. The action cycle starts at minute 0 and then every five minutes. A final save/exit and retention measurement run after the duration, so total wall time exceeds 20 minutes. An action cycle overrunning its cadence is a failure. Do not reload, navigate, attach DevTools, or interact with the game during a run.

For the final multi-hour verification, after both smokes pass on the intended merged revision:

```powershell
node tools/soak/run.mjs --city dense1m --hours 4 --cycle-minutes 5
node tools/soak/run.mjs --city small --hours 4 --cycle-minutes 5
```

`--hours` defaults to 4. Use the duration agreed for #28. `--minutes` and `--hours` are mutually exclusive. `node tools/soak/run.mjs --help` lists all options. No install, fixture generation, commit, push, or queue-marker action happens automatically.

## What a run does

1. Records checked-out HEAD, branch, named base ref, dirty status, platform and Node version. Runs `npm run build -- --outDir tools/soak/.runs/<run>/dist`, including the package's `tsc --noEmit` gate. On Windows this goes through `cmd.exe` so PowerShell does not consume the forwarded Vite option. Starts Vite **preview**, bound to `127.0.0.1` on strict port 5199 (override with `--port`). Build, preview and browser failures produce failing reports.
2. Bundles small setup helpers with the installed rolldown. For a large fixture it uses the game's decoder, migrations, serializer and `tools/citySaves.ts` region wrapper. It requires a one-city region and at least 900,000 initial residents. The original fixture is read only and its SHA-256 is recorded. A disposable, same-origin empty document stores the prepared region through the game's IndexedDB adapter. Navigation destroys that helper document before the production app loads; only persisted save data carries over. The normal Load Region → Open → city → Play UI is then driven by coordinates.
3. Launches full Playwright Chromium (`channel: chromium`), headless, 1920×1080 at DPR 1, with GPU enabled and ANGLE default. The actual WebGL unmasked renderer must identify hardware; SwiftShader, WARP, Basic Render Driver, llvmpipe and unknown/generic renderers fail. There is no software fallback. Fallback app modules also fail. The GPU is checked again on each re-entry.
4. Plays at graphics **Ultra** and simulation speed 3. The emergency setting is “Keep going,” so incidents do not silently pause the soak. Normal autosaves remain enabled. New Year fireworks remain enabled; automatic camera movement is disabled to keep coordinate actions stable. Actions pause the sim and verify each result through plain-value reads.
5. Repeats the fixed cycle: inspect a live growable and open **Why?**; inspect a health/fire/police/education service; open every registered panel; select Zones, Desirability, Traffic and Power, then None; zone three empty cells, build a three-cell road, bulldoze that road and dezone the temporary cells; save and verify completion; exit to the region; measure retention; re-enter the saved tile; select **Low → High → Ultra**, then resume speed 3. All twelve current panels are covered: advisors, budget, data views, demographics, emergencies, graphs, help, inspector, ordinances, rewards, settings and statistics. A changed panel inventory fails explicitly. Action sites are found from the actual terrain; existing buildings are not cleared to make room. Failure to find/click/verify an action aborts with a failed step, never a coverage skip.

## T013 retention precautions

- In the game document, input is only `page.mouse` / `page.keyboard`. Coordinates come from `page.evaluate`, which returns numbers, strings, booleans and plain records only. Camera movement uses the minimap and mouse wheel. DOM scrolling uses the mouse wheel. There are no locators, element/JS handles, DOM clicks, synthetic DOM events, or calls to app action methods. Polls use plain evaluations, not `waitForFunction` handles. The sole setup exception is fixture persistence in the disposable document, before any city exists.
- Prototypes are captured by identity from the actual production instances, so minified constructor names do not matter. The only persistent strong probe references are `CityScene.prototype`, `CityState.prototype` and `WebGLRenderer.prototype`, never an instance. Initial live-count sanity requires one scene, one state and at least one renderer. Prototype identity must stay the same across re-entry.
- Every object-producing CDP command (`Runtime.evaluate`, `Runtime.queryObjects`, `Runtime.callFunctionOn`) has an explicit unique `objectGroup`. A `finally` releases it on success and failure. Query arrays exist only within that group, and only their numeric lengths leave it. Scalar-only `Runtime.getHeapUsage`, `Memory.getDOMCounters`, `HeapProfiler.collectGarbage`, `Runtime.discardConsoleEntries`, and group release have no objectGroup parameter in CDP and create no remote-object handles.
- Each exit settles for 20 seconds (configurable with `--exit-settle-seconds`, minimum 16 to outlast toolbar thumbnail disposal), clears inspector console storage after copying its error text, and collects garbage three times before counting. No page reload or browser/context close is used as evidence that an exited city was collected.
- Console callbacks copy text and never access `msg.args()`. The installed Playwright version also caches console argument handles internally, even if the listener only reads text. An init-script console wrapper therefore converts object/function/symbol arguments to strings **before** native console calls, retaining error stack/message text, assertion semantics and primitive formatting. Arbitrary objects appear as type labels; their properties/graphs are not serialized. This intentionally changes rich console-object formatting to prevent probe-induced retention. The observer/RAF callbacks retain only scalars and fixed-size histograms; canvas/context bookkeeping uses weak collections. WebGL loss listeners do not capture canvases or scenes. Intentional disposal (three's `renderer.forceContextLoss()`, which calls `WEBGL_lose_context.loseContext()`) is marked with a weak reference and logged separately from unexpected loss.

## Evidence and gates

Each run writes a new directory under gitignored `tools/soak/.runs/` and prints its path:

| File | Contents |
| --- | --- |
| `run.json` | Metadata, options, production build status, GPU identity, samples, completed/failed action steps, every exit's counts, error totals/examples and final gate results. Replaced atomically at each checkpoint. |
| `events.jsonl` | Append-only JSON event stream with timestamps, sample data, individual panel/overlay/quality actions, inspection targets, errors, crashes, interrupts and exit measurements. Survives a hard kill up to the last completed append. |
| `summary.md` | Short PASS/FAIL lines, heap slope, retention counts and what remains for #28. Updated during the run; an unfinished run is always FAIL. |
| `build.log` | Build stdout and stderr. |
| `dist/`, `helpers/`, `input.region.metropolis` | This run's production output, disposable setup helpers and prepared copy of a large fixture. |

Telemetry defaults to every 15 seconds, including during action waits. Each sample includes CDP JS heap used/total/backing-store fields as available and DOM document/node/listener counts, city and region RAF frame p50/p99/max, long-task count/total/max for tasks **≥50 ms**, simulation-day delta and days/second, current population/buildings/speed/quality, and context-loss records. Console errors, uncaught page errors, page crashes and unexpected browser disconnects are recorded independently of sampling.

Frame p50/p99 use bounded, 1 ms upper-bound histogram bins (overflow at 60 seconds); maximum frame interval is exact. These measure delivered RAF intervals, not GPU duration. Long-task/frame data includes saves, action cycles and measurement overhead. Simulation rate uses adjacent city-frame day deltas, includes pauses while in the city, and excludes region intervals and re-entry gaps. Startup measurements have `elapsedMs: null`. No observer accumulates unbounded arrays in the page.

The summary requires:

- The full requested duration, all scheduled cycles with every required step, and a final region exit.
- Successful production build, a verified hardware GPU, telemetry availability and advancing simulation.
- Post-exit JS heap growth **strictly below 16 MiB/hour**, adjustable with `--heap-mib-per-hour`. This is a provisional harness policy, not a project-approved memory budget. It fits ordinary least squares to elapsed hours versus used heap in MiB after forced GC. The first exit is warm-up and excluded from the slope (it precedes the first quality-switch cycle); at least three later exit samples are required. Live-city heaps are logged but not mixed into this regression because population and geometry can grow legitimately. Twenty minutes at five-minute cadence yields four cycles plus the final exit, leaving four slope points. Very short diagnostic runs may correctly fail for insufficient data.
- **Zero CityScenes and zero CityStates after every exit**, including the warm-up exit. Renderer counts and deltas are reported; a region has its own renderer, so zero total WebGLRenderers is not a valid expectation.
- Zero console/page/harness errors, page crashes, unexpected browser disconnects or unexpected WebGL context losses. Expected disposal losses are visible but do not fail this gate. Error examples in the checkpoint are capped at 200; totals and the JSONL stream are not capped. Missing measurements never become zero/pass.

Exit status is 0 only when every gate passes, 1 for failures/incomplete/interrupted runs, and 2 for invalid arguments. Ctrl+C/SIGTERM request cleanup and a failing summary. Browser operations and cleanup have timeouts; a dead GPU can take those timeout periods to unwind. A hard kill cannot promise a final write: use the last checkpoint and JSONL tail. Reports are local evidence, not sent anywhere.

## Files and browser-free verification

| Source | Responsibility |
| --- | --- |
| `run.mjs` | Production build/preview, fixture setup, browser lifecycle, priority, scheduler and checkpoint logging. |
| `driver.mjs` | Coordinate UI driver, new small city, verified action cycle and complete panel inventory. |
| `telemetry.mjs` | Bounded browser observers, real-GPU check, grouped CDP probes and post-GC memory/counts. |
| `fixture-entry.mjs`, `seed-entry.mjs` | Node region preparation and disposable-document IndexedDB seeding; bundled at runtime. |
| `options.mjs`, `report.mjs` | CLI, timeouts, trend calculation and pass/fail policy. |
| `selftest.mjs` | Browser-free checks of CLI, metric math, failure gates, CDP cleanup, helper bundling and failed-run artifacts. |

```powershell
node tools/soak/selftest.mjs
node tools/soak/run.mjs --help
```

All new executable sources are plain Node ESM `.mjs`; there is no new TypeScript. `node --test tools/soak/selftest.mjs` also works on an unrestricted machine; the plain Node form avoids the test runner's child-process requirement in restricted environments. The self-test intentionally creates one **FAIL** artifact for a nonexistent fixture; it is not a smoke result.

The task report, `docs/dev/reports/local-T019-soak.md`, has both 20-minute smoke results and what is left for #28. Each run's `run.json` records, under `provenance`, the revision it tested.
