# tools/leakprobe: the browser exit-leak gate

Exit to region must free the whole previous city. This gate plays a city in headless Chromium on the real GPU and runs
the same cycle each time:
1. query one growable building;
2. Esc;
3. Save & exit to region.

After each exit it forces a GC and counts the live `CityScene` and `CityState` objects through CDP. Both must be 0 at
+3 s on every cycle.

The node tests (`tests/game/*Retention*.test.ts`, `tests/game/cityTeardown.test.ts`) check the teardown in isolation.
This gate checks the same teardown in the real browser.

## Run it

```sh
npm ci
npm run fixtures -- --only cities --cities <dir>          # the shared test cities (docs/dev/TEST_CITIES.md)
node tools/leakprobe/leakprobe.mjs --city <dir>/small_s7_y10.region.metropolis --mode fresh
node tools/leakprobe/leakprobe.mjs --city <dir>/small_s7_y10.region.metropolis --mode persistent
node tools/leakprobe/leakprobe.mjs --city <dir>/small_s7_y10.region.metropolis --mode persistent --hostile
```

The script starts its own vite server on `--port` (default 5310) and stops it at the end. It refuses to start if the
port is already in use: another tree's server there would mean measuring the wrong code. The exit code is 0 on PASS
and 1 on FAIL; the console prints one line per cycle.

| option | meaning |
|---|---|
| `--city <file>` | a region file (`*.region.metropolis`); it is imported through Load Region, then played |
| `--mode fresh` | one browser launched by Playwright for the run (a fresh profile) |
| `--mode persistent` | one Chromium started with a remote-debugging port and its own user-data dir, kept for the run; every step connects over CDP and disconnects again (the T013 playtester's setup) |
| `--hostile` | run each cycle the way the T013 playtester's harness did (see below) |
| `--cycles N` | default 3 |
| `--size WxH` | default 1280x720 |
| `--census` | also list the event listeners left on every detached DOM tree after each exit |
| `--out file.json` | the result: per cycle the counts at +3 s (and the census) |

A run takes about 40 s (fresh) to 60 s (persistent, hostile) on the RTX 5070 Ti desktop with the 101k-resident test city.

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
