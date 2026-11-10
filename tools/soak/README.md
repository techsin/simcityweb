# T019 production soak harness

Run from the repository root, **one run at a time, between timing runs**. The harness lowers its own, the build launcher's, and Chromium's process priority to below normal and records the result. Priority is not isolation: do not overlap this with a benchmark, fixture generation, another browser run, or another soak.

**The final 4-hour soaks need the machine to themselves.** A cycle that is still running when the next one is due stops the run, and at below-normal priority any other load takes the CPU and the GPU from the cycle. In T082's 1-hour runs a dense1m cycle took about 90 s while the machine was quiet and up to 197 s beside other lanes' test runs, against a limit of 300 s. See [the cadence limit](#the-cadence-limit).

Only new files under `tools/soak/` belong to this change. No application hooks are added. Runs build and exercise the checked-out production app; they never import `/src/` into the live game. Changes are intentionally uncommitted.

## Two required 20-minute smokes

With dependencies and Playwright Chromium already installed, and the documented dense1m fixture available:

```powershell
node tools/soak/run.mjs --city dense1m --minutes 20 --cycle-minutes 5
node tools/soak/run.mjs --city small --minutes 20 --cycle-minutes 5
```

Run the second command after the first finishes and while no timing run is scheduled. Each gets a fresh Chromium process and isolated storage. The default fixture is `tools/bench/.fixtures/fixtures/dense1m_s7.metropolis`; `SIM_FIXTURES` (the folder that holds that file) or `--fixture PATH` overrides it. Missing input is a failure with an explanation, never a silently substituted small city.

That folder is generated and gitignored, so **a fresh worktree has no fixture**. The failure then says how to get one: build it in the tree, or point at one that exists, for example another worktree's `tools/bench/.fixtures/fixtures` through `SIM_FIXTURES`. A relative `--fixture` path is taken from the repository root. To build dense1m (under a minute) before scheduling the smoke:

```powershell
cmd.exe /d /s /c "npm run fixtures -- --only snap,dense1m"
```

This is existing project tooling, not part of the soak. See [test cities](../../docs/dev/TEST_CITIES.md). Alternatively, use the shared 991,493-resident `vet_s7_y43.region.metropolis` (or its `.city.metropolis` companion) for the **large** smoke:

```powershell
node tools/soak/run.mjs --city vet --fixture "C:\path\to\cities\vet_s7_y43.region.metropolis" --minutes 20 --cycle-minutes 5
```

Replace that example fixture path with its actual location. `small_s7_y10` is not the small scenario: `--city small` founds a new 64×64 flat sandbox city with seed 7, verifies that it initially has zero buildings, builds roads (including an edge connection), two wind turbines, a water tower, a clinic and a fire station (without fire cover the clinic, the only clickable service building, burnt down 15 minutes into an ultra run), zones R/C/I, and waits up to three minutes for an occupied growable. All construction uses player input. Sandbox prevents a new settlement's treasury from ending a multi-hour run; no money, population, buildings or simulation fields are injected.

The duration starts **after** build, loading and small-city establishment. The action cycle starts at minute 0 and then every five minutes. A final save/exit and retention measurement run after the duration, so total wall time exceeds 20 minutes. An action cycle overrunning its cadence is a failure (below). Do not reload, navigate, attach DevTools, or interact with the game during a run.

### The cadence limit

A cycle that is still running when the next one is due stops the run. With the default `--cycle-minutes 5` that is a cycle that ends 300 s or more after its scheduled start; the last cycle of a run has no next one. The limit is the cadence itself and is not configurable apart from it.

The failure names the cycle, how long it took and its three slowest steps, and says what usually causes it: a busy machine. The harness, the build and Chromium run at below-normal priority, so a benchmark, a test run, another browser or another soak slows every step. Run the soak again with the machine to itself. If the machine was idle, the slowest steps show where the game kept the driver waiting. `--cycle-minutes` changes the cadence for a diagnostic run; NOTE-026's final check uses 5.

For the final multi-hour verification, after both smokes pass on the intended merged revision:

```powershell
node tools/soak/run.mjs --city dense1m --hours 4 --cycle-minutes 5 --min-days-per-sec 15
node tools/soak/run.mjs --city small --hours 4 --cycle-minutes 5
```

These are NOTE-026's parameters for #28: 4 hours each, one at a time, with the machine to themselves, on the production build of the final merged revision. Heap growth must be ≤ 16 MiB/hour over the run and ≤ 8 MiB/hour over its second half; the second-half line is n/a for a run under 1 hour. The dense city must also hold 15 days/s at ULTRA, measured per second the sim ran (NOTE-081; see [the simulation rate](#the-simulation-rate)). `--hours` defaults to 4. `--minutes` and `--hours` are mutually exclusive. `node tools/soak/run.mjs --help` lists all options. No install, fixture generation, commit, push, or queue-marker action happens automatically.

## What a run does

1. Records checked-out HEAD, branch, named base ref, dirty status, platform and Node version. Runs `npm run build -- --outDir tools/soak/.runs/<run>/dist`, including the package's `tsc --noEmit` gate. On Windows this goes through `cmd.exe` so PowerShell does not consume the forwarded Vite option. Starts Vite **preview**, bound to `127.0.0.1` on strict port 5199 (override with `--port`). Build, preview and browser failures produce failing reports.
2. Bundles small setup helpers with the installed rolldown. For a large fixture it uses the game's decoder, migrations, serializer and `tools/citySaves.ts` region wrapper. It requires a one-city region and at least 900,000 initial residents. The original fixture is read only and its SHA-256 is recorded. A disposable, same-origin empty document stores the prepared region through the game's IndexedDB adapter. Navigation destroys that helper document before the production app loads; only persisted save data carries over. The normal Load Region → Open → city → Play UI is then driven by coordinates.
3. Launches full Playwright Chromium (`channel: chromium`), headless, 1920×1080 at DPR 1, with GPU enabled and ANGLE default. The actual WebGL unmasked renderer must identify hardware; SwiftShader, WARP, Basic Render Driver, llvmpipe and unknown/generic renderers fail. There is no software fallback. Fallback app modules also fail. The GPU is checked again on each re-entry.
4. Plays at graphics **Ultra** and simulation speed 3. The emergency setting is “Keep going” and tips are off, so incidents do not silently pause the soak: with tips on, the first emergency that no station covers pauses the game for its lesson whatever the emergency setting says (FH-08). Normal autosaves remain enabled. New Year fireworks and the year in review remain enabled; automatic camera movement is disabled (`newYearCamera`, `cameraMoments`) to keep coordinate actions stable. Actions pause the sim and verify each result through plain-value reads.
5. Repeats the fixed cycle: inspect a live growable and open **Why?**; inspect a health/fire/police/education service; open every registered panel; select Zones, Desirability, Traffic and Power, then None; zone three empty cells, build a three-cell road, bulldoze that road and dezone the temporary cells; save and verify completion; exit to the region; measure retention; re-enter the saved tile; select **Low → High → Ultra**, then resume speed 3. All twelve current panels are covered: advisors, budget, data views, demographics, emergencies, graphs, help, inspector, ordinances, rewards, settings and statistics. A changed panel inventory fails explicitly. Action sites are found from the actual terrain; existing buildings are not cleared to make room. Failure to find/click/verify an action aborts with a failed step, never a coverage skip.

## Simulation host

The soak measures the **main-thread host** only: `LocalSimHost`, the game's default until Worker step W1.4. It opens the game without `?simworker`, reads `scene.host.kind` on every entry to the city, and fails with that reason on anything but `'local'`.

A worker or loopback host does give the page a `sim` (a facade over its replica), so the driver's reads would go on there. What would no longer hold is the evidence: the heap slope and the zero-city counts come from the page's thread (CDP on the page target), so a simulation in a Web Worker would pass unmeasured. Soaking the worker host needs its heap per CDP target and a check that the worker is gone after each exit. This harness has neither.

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
| `run.json` | Metadata, options, production build status, GPU identity, the simulation host, samples, completed/failed action steps, every exit's counts, error totals/examples and final gate results. Replaced atomically at each checkpoint. `schemaVersion` 2 since T088: a sample's `sim.daysPerSecond` became `daysPerRunningSecond` and `daysPerCitySecond`. |
| `events.jsonl` | Append-only JSON event stream with timestamps, sample data, individual panel/overlay/quality actions, inspection targets, errors, crashes, interrupts and exit measurements. Survives a hard kill up to the last completed append. |
| `summary.md` | Short PASS/FAIL lines, heap slope, retention counts and what remains for #28. Updated during the run; an unfinished run is always FAIL. |
| `build.log` | Build stdout and stderr. |
| `dist/`, `helpers/`, `input.region.metropolis` | This run's production output, disposable setup helpers and prepared copy of a large fixture. |

Telemetry defaults to every 15 seconds, including during action waits. Each sample includes CDP JS heap used/total/backing-store fields as available and DOM document/node/listener counts, city and region RAF frame p50/p99/max, long-task count/total/max for tasks **≥50 ms**, the simulation-day delta with its city and running seconds and both rates, current population/buildings/speed/quality, and context-loss records. Console errors, uncaught page errors, page crashes and unexpected browser disconnects are recorded independently of sampling.

Frame p50/p99 use bounded, 1 ms upper-bound histogram bins (overflow at 60 seconds); maximum frame interval is exact. These measure delivered RAF intervals, not GPU duration. Long-task/frame data includes saves, action cycles and measurement overhead. Startup measurements have `elapsedMs: null`. No observer accumulates unbounded arrays in the page.

### The simulation rate

Sim days are day deltas between adjacent frames of the same city, so the region screen and the gap of a re-entry are never bridged. They are divided by two clocks:

- **Running seconds** (`sim.runningSeconds`): frame time in the city while the sim's speed is above 0. **Days per running second is the sim's rate, and the number `--min-days-per-sec` gates** (NOTE-081). A cycle's pauses (the inspections, panels, edits and the save) and its time on the region screen are out of it. Each cycle's last seconds are in it: a loaded city resumes at speed 1, and the harness presses speed 3 only after the quality switches, about 14 s later in T082's dense1m run and 8 s in the small city. That keeps the number a little under the rate of plain speed-3 play, never over it.
- **City seconds** (`sim.citySeconds`): all frame time in the city, pauses included. Days per city second is **informative only**. It falls as the cycles get longer, so it measured the machine's load as much as the sim: T082's dense1m hour read 12.62 days/s per city second on a loaded machine (15.02 in its one quiet 10-minute window) while the sim ran at 17.82 days/s per running second and 18.99 between cycles.

Two rules keep the floor as strict as it was before NOTE-081, when every pause counted against it:

- **Only a cycle's pauses leave the rate.** Between cycles the harness leaves the city to play at speed 3, so a pause there is something else's: an emergency lesson, a dialog, an error. Those seconds (city seconds minus running seconds in the samples of phase `playing-ultra`) are added to the running seconds before the division, so a sim that stands paused most of the time cannot pass the floor on the few seconds it ran. They came to under 0.1 s in each of T082's hours, where the number is plain days per running second. The samples are 15 s apart, so the last seconds before a cycle can go uncounted.
- **No play, no rate.** A run needs running time and at least one sample of a city left to play; otherwise the rate is n/a and the floor's line fails. T082's unpatched run died in its first cycle with 3 sim days over 0.1 running seconds, which is no measurement of 28 days/s.

The summary shows both rates and the seconds paused between cycles on the telemetry line, and both rates again on the floor's own line when `--min-days-per-sec` is set.

The summary requires:

- The full requested duration, all scheduled cycles with every required step, and a final region exit.
- Successful production build, a verified hardware GPU, telemetry availability and advancing simulation.
- Post-exit JS heap growth **strictly below 16 MiB/hour**, adjustable with `--heap-mib-per-hour`. This is a provisional harness policy, not a project-approved memory budget. It fits ordinary least squares to elapsed hours versus used heap in MiB after forced GC. The first exit is warm-up and excluded from the slope (it precedes the first quality-switch cycle); at least three later exit samples are required. Live-city heaps are logged but not mixed into this regression because population and geometry can grow legitimately. Twenty minutes at five-minute cadence yields four cycles plus the final exit, leaving four slope points. Very short diagnostic runs may correctly fail for insufficient data.
- Second-half heap growth **at most 8 MiB/hour** (NOTE-026), adjustable with `--late-heap-mib-per-hour`. It is the same fit over the post-warm-up exits from the midpoint of their span on, and it catches a slow, steady leak that the warm-up would hide. From 1 hour on it needs at least three such samples; a run under 1 hour reports it as n/a.
- With `--min-days-per-sec N` (off by default; 15 for dense1m at ULTRA in the final check): the sim's days per **running** second at least N. The floor is NOTE-026's; NOTE-081 changed only its denominator, from city seconds to the seconds the sim ran (plus any it stood paused between cycles). A run with no rate fails this line. See [the simulation rate](#the-simulation-rate).
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
| `options.mjs`, `report.mjs` | CLI, timeouts, the missing-fixture message, trend calculation, pass/fail policy and the cadence limit. |
| `selftest.mjs` | Browser-free checks of CLI, metric math, failure gates, CDP cleanup, helper bundling, failed-run artifacts, the page reads and the driver's save, exit and re-entry steps. |
| `mockpage.mjs` | For the selftest only: the stand-in page those steps run on, and the scan of the tool's own page reads. |

```powershell
node tools/soak/selftest.mjs
node tools/soak/run.mjs --help
```

All new executable sources are plain Node ESM `.mjs`; there is no new TypeScript. `node --test tools/soak/selftest.mjs` also works on an unrestricted machine; the plain Node form avoids the test runner's child-process requirement in restricted environments. The self-test intentionally creates one **FAIL** artifact for a nonexistent fixture; it is not a smoke result.

### The page the selftest runs on

**Run the selftest before a soak, after any change to the app.** The driver reads the game through `window.__metropolis`: the App, its city record, the scene, its sim and the city state. When the app drops or renames one of those members, a real run fails minutes in. T082's soak stopped 68 s into its first cycle on `window.__metropolis.city.state`, which Worker step W0.6 had removed, while the selftest of the time passed 10 of 10 on a hand-written page that still had it.

The selftest's page now takes its shape from one place, the source:

- `pageShape()` reads the members that `App` and its `city` record (`src/main.ts`), `CityScene`, `Simulation` and `CityState` declare, with rolldown's parser.
- `MockPage` has exactly those names. It gives a stand-in value only to a name the source still declares, so a member that the app drops is missing on the page too. `Driver.save()`, `exit()`, `enter()` and the telemetry then fail on it as they do in a browser.
- `pageReads()` scans `driver.mjs`, `telemetry.mjs` and `run.mjs` for every path read off `window.__metropolis`, through local aliases and destructuring. Each member must still be declared. This covers the steps that the selftest does not run (the canvas work), and reads that fail without an error: a missing `saveFailed` reads as "not failed".

The scan follows `const` and `let` declarations only. Keep page reads in that form: a value that reaches a name through an assignment, a conditional or a function argument is not followed. The selftest does not check DOM selectors, key bindings or members below those five objects (a panel, the camera): only a real run does.

The task reports: `docs/dev/reports/local-T019-soak.md` has both 20-minute smoke results and what is left for #28; `docs/dev/reports/local-T088-soak-tool.md` has the T088 changes (the stale page read, the simulation rate, the cadence and fixture messages). Each run's `run.json` records, under `provenance`, the revision it tested.
