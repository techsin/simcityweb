# tools/leakprobe: browser exit and Budget growth gates

Exit to region must free the whole previous city. This gate plays a city in headless Chromium on the real GPU and runs
the same cycle each time:
1. query one growable building;
2. Esc;
3. Save & exit to region.

Before each cycle it counts the live `CityScene` and `CityState` objects through CDP. Both must be at least 1: a
prototype imported from the wrong module instance must fail here, rather than pass with zeroes after exit. After
each exit both must be 0 at +3 s. Every measurement discards console entries before each of three forced GCs.

The node tests (`tests/game/*Retention*.test.ts`, `tests/game/cityTeardown.test.ts`) check the teardown in isolation.
This gate checks the same teardown in the real browser.

## Run it

```sh
npm ci
npm run fixtures -- --only cities --cities <dir>          # the shared test cities (docs/dev/TEST_CITIES.md)
node tools/leakprobe/leakprobe.mjs --city <dir>/small_s7_y10.region.metropolis --mode fresh
node tools/leakprobe/leakprobe.mjs --city <dir>/small_s7_y10.region.metropolis --mode persistent
node tools/leakprobe/leakprobe.mjs --city <dir>/small_s7_y10.region.metropolis --mode fresh --hostile
node tools/leakprobe/leakprobe.mjs --city <dir>/small_s7_y10.region.metropolis --mode persistent --hostile
node tools/leakprobe/leakprobe.mjs --city <dir>/small_s7_y10.region.metropolis --mode budget --out budget.json
node tools/leakprobe/leakprobe.mjs --help
```

The script starts its own vite server on `--port` (default 5310) and stops it at the end. It refuses to start if the
port is already in use: another tree's server there would mean measuring the wrong code. The exit code is 0 on PASS
and 1 on FAIL (2 for invalid arguments); the console prints the in-city and after-exit counts per cycle. `--help`
exits 0 without a city file, Playwright import, Vite server or browser.

| option | meaning |
|---|---|
| `--city <file>` | a region file (`*.region.metropolis`); it is imported through Load Region, then played |
| `--mode fresh` | one browser launched by Playwright for the run (a fresh profile) |
| `--mode persistent` | one Chromium started with a remote-debugging port and its own user-data dir, kept for the run; every step connects over CDP and disconnects again (the T013 playtester's setup) |
| `--mode budget` | a fresh browser; Budget stays open through Taxes, then Services; see below |
| `--hostile` | run each cycle the way the T013 playtester's harness did (see below) |
| `--cycles N` | default 3; Budget defaults to 1 |
| `--months N` | Budget: full game months per tab, at least 40; default 40 |
| `--size WxH` | default 1280x720 |
| `--census` | also list the event listeners left on every detached DOM tree after each exit |
| `--port N` | Vite port, default 5310; persistent Chromium uses N+1000 for CDP |
| `--out file.json` | per cycle: in-city positive control, counts at +3 s (and census); Budget includes each tab's baseline and samples, including a failing sample |
| `--scene-module URL`, `--state-module URL` | override the prototype imports for a negative check; defaults `/src/game/CityScene.ts`, `/src/sim/CityState.ts` |
| `--help` | browser-free usage |

A run takes about 40 s (fresh) to 60 s (persistent, hostile) on the RTX 5070 Ti desktop with the 101k-resident test city.
Budget takes longer: 80+ game months plus six 15 s measurement settles at the default settings.

## `--mode budget`

T025 checks that monthly Budget rebuilds do not accumulate sliders and detached subtrees while the city is alive.
Through Settings clicks it selects Uncovered emergencies: Keep going, turns off Autosave and New Year celebrations,
and disables Notifications. These are declared setup in the fresh browser profile; they keep the calendar at speed 3
and reduce unrelated transient DOM. It opens Budget, measures Taxes for at least 40 full months, then Services for
at least 40 full months. `--months` raises that duration per tab; `--hostile` cannot be combined with this mode.

Each tab gets its own baseline and samples halfway through and at the end. Budget stays open throughout. At each
checkpoint the Pause button stops the calendar, then the harness waits 15 s for toasts and closing DOM before GC;
the intervals between checkpoints run at speed 3 through the keyboard command path. The harness reads actual game
days and checks the open panel, selected tab and speed while waiting; it fails on an interruption or a 5 minute
timeout per interval. It never advances the simulation or sets its speed through `page.evaluate`.

Both `HTMLInputElement` (CDP `Runtime.queryObjects`, including detached inputs) and total DOM `nodes`
(`Memory.getDOMCounters`, including detached trees) must be within **+/-5%** of that tab's baseline at both samples.
The JSON also records days, elapsed months, attached Budget input counts, documents, JS listeners and heap MB to
diagnose any failure. The normal in-city positive control and post-exit zero-city check apply too.

To check the regression on base **2ba03fa**, copy only the current `tools/leakprobe/` directory into a separate base
worktree and run the same Budget command there with a different `--port` and `--out`. Its application files must stay
at the base. The old slider abort hook should fail the growth assertion; the fixed tree should pass. These are real
Chromium / GPU checks, not substitutes for the node tests.

## Wrong-module negative check

With the normal prototype URLs the in-city counts must be positive. Force a second instance of either module with a
query suffix (use a fresh run; no HMR edits while measuring):

```sh
node tools/leakprobe/leakprobe.mjs --city <dir>/small_s7_y10.region.metropolis --scene-module '/src/game/CityScene.ts?leakprobe=wrong' --out wrong-scene.json
node tools/leakprobe/leakprobe.mjs --city <dir>/small_s7_y10.region.metropolis --state-module '/src/sim/CityState.ts?leakprobe=wrong' --out wrong-state.json
```

Each must exit 1 with `in-city positive control failed`, before querying a building or exiting. A missing module or
export fails prototype resolution too, but that does not replace this zero-instance negative check.

## What the input may and may not do

- **Input:** real `page.mouse` / `page.keyboard` at coordinates.
- **`page.evaluate`:** reads positions and state as plain values only. It also finds a growable building with the
  scene's own pick.
- **Counts:** CDP with an `objectGroup` on every call that returns objects, released after use. A remote-object
  handle pins what it points to.
- **No Playwright locators or element handles on the city's DOM in the normal modes.** The T013 audit found that a
  locator click on a HUD element alone could keep the exited city alive. Close-out c4 narrowed it down: Playwright's
  `locator.getAttribute()` on a node of the city's inspector does it, while `count()` and `boundingBox()` do not.

## `--hostile`

Each cycle replays the T013 playtester's cycle (`s02_cycle.js`, one growable) step for step, on one connection:
- the game paused for the session;
- Playwright locator calls on the inspector (its section count; the WHY? header's `count`, `getAttribute`,
  `boundingBox`);
- a screenshot and locator-checked Escapes;
- unpause and a `getByText` exit.

That harness keeps one node of the exited city's DOM alive, as an extension or DevTools can. Before close-out c4 that
node's listeners kept the whole city: base `5a16942` fails this mode, 1 / 2 / 3 cities after 3 exits in the persistent
browser. Since c4 every city-lifetime listener goes with the city's AbortSignal, so the held node reaches nothing and
this mode passes too.
