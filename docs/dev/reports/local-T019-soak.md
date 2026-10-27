# local-T019-soak: the multi-hour soak harness for the final verification (T019, #28)

Branch `local/T019-soak`, base **`8182828`**: the dev head when the smoke runs began. The lane started at `8f0bf66`;
the branch has new files only, so moving its base changed nothing in them.

Everything is under `tools/soak/`. Nothing under `src/` changes. The harness is plain Node ESM (`.mjs`), so there is no
TypeScript to typecheck. `tools/soak/README.md` maps every requirement to the code and lists the options.

## What it does

**One run:**
- builds the production bundle into the run folder (`npm run build`) and serves it with `vite preview`;
- drives headless Chromium on the real GPU through Playwright and CDP, with coordinate input only (the T013 probe
  pitfall);
- refuses a software renderer or a dev build.

**Cities:**
- `--city dense1m`: `tools/bench/.fixtures` dense1m, 1.12M residents;
- `--city vet`: the shared vet_s7_y43 save, 991k;
- `--city small`: a newly founded 64² sandbox city, built only by player input:
  - roads with an edge connection, two wind turbines, a water tower, a clinic and a fire station, and R/C/I zones;
  - the run waits for an occupied growable.

**Every `--cycle-minutes` K, a fixed action cycle,** each step verified by its effect on the game:
1. inspect a growable and a service building;
2. open every panel and a few data views;
3. zone, build a road and bulldoze;
4. save, exit to the region and re-enter;
5. switch quality LOW, HIGH and back to ULTRA.

**Recorded every 15 s:**
- the JS heap and DOM counts, from CDP with an objectGroup on every call;
- frame-time p50, p99 and max, and long tasks (≥ 50 ms);
- sim days per second;
- console errors, page crashes and WebGL context losses. Losses the game's own renderer disposal causes are counted
  apart from unexpected ones.

**After every exit**, with a forced GC: the CityScene, CityState and WebGLRenderer counts, and the heap.

**Output:**
- `run.json` (written as it goes), `events.jsonl` and `summary.md`, with one pass/fail line for each of:
  - the full duration and every cycle completed;
  - a real GPU and a production build;
  - post-exit heap growth below 16 MiB/hour (configurable);
  - 0 cities left after every exit;
  - no errors;
  - no crashes and no unexpected context loss;
  - telemetry present, and the simulation advances.
- `node tools/soak/selftest.mjs` checks the CLI, the metric math, the failure gates, the CDP cleanup and the helper
  bundling, without a browser: 9/9 pass.

## How to run it

It is a browser run, so schedule it between timing runs. Each run gets a fresh Chromium process and its own storage.

```
node tools/soak/run.mjs --city dense1m --minutes 20 --cycle-minutes 5
node tools/soak/run.mjs --city small --minutes 20 --cycle-minutes 5
node tools/soak/run.mjs --city small --hours 4 --cycle-minutes 5
```

Each run writes `tools/soak/.runs/<time>-<city>-<pid>/` (`run.json`, `summary.md`, `events.jsonl`, `build.log`).
The duration starts after the build, the load and the small city's establishment, so the wall time is longer.

## The smoke runs (20 minutes, 5-minute cycles, 1920×1080, ULTRA, speed 3)

**Both pass every line:** 7 of 7 on dense1m and 7 of 7 on the small city.

| Line | dense1m | small |
|---|---|---|
| Duration and every cycle | 4/4 cycles; 20.00/20.00 min | 4/4 cycles; 20.00/20.00 min |
| Real GPU and production build | ANGLE (NVIDIA, RTX 5070 Ti, D3D11) | the same |
| Post-exit heap growth | 5.06 MiB/hour < 16 (4 samples over 14.4 min) | 0.00 MiB/hour < 16 (4 samples over 14.3 min) |
| Cities left after every exit | 0 scenes, 0 states and 1 renderer (the region's) after all 5 exits | the same, after all 5 exits |
| Errors | console 0, page 0, harness 0 | console 0, page 0, harness 0 |
| Crashes and context losses | 0 crashes, 0 unexpected losses (13 intentional, from renderer disposal) | 0 crashes, 0 unexpected losses (10 intentional) |
| Telemetry and the simulation | 129,881 city frames; 17,435 sim days in 1,111.7 s (15.68 days/s) | 140,521 city frames; 18,635 sim days in 1,112.1 s (16.76 days/s) |

From the runs' samples (one every 15 s) and the forced-GC exits:

| City | Cycles | Frame p50 (median of samples) | Frame p99 (median / worst sample) | Frame max | Long tasks (count, longest) | Heap after each exit (MiB, forced GC) | Cities left after exits |
|---|---|---|---|---|---|---|---|
| dense1m | 4/4 | 8 ms | 16 / 2840 ms | 4193 ms | 277, 4194 ms | 23.8, 28.1, 28.2, 29.1, 29.2 | 0 / 0 after all 5 |
| small | 4/4 | 8 ms | 9 / 9 ms | 3023 ms | 36, 3029 ms | 21.2, 24.4, 24.3, 24.4, 24.4 | 0 / 0 after all 5 |

The worst frames come from the action cycles: saves, exits, re-entries and the quality switches. The summary counts
them as frame delivery times, not GPU times. Long tasks include the cycles and the probes.

## Fixes the smoke runs needed

1. **Inspecting a growable in the dense core.** The chosen growable could sit behind taller buildings, so the click
   selected another building. `inspect()` now keeps its candidate list and logs each miss. It then falls back to a
   screen scan: it focuses the map centre and finds a building of that kind with the scene's own
   `objects.pickBuilding`. Both paths click through one `select()` helper, which checks that the inspector shows that
   building.
2. **Intentional context losses counted as unexpected.** The harness marked `forceContextLoss`. But three's renderer
   disposal calls the extension's `loseContext()`, so every exit counted as an unexpected loss. The telemetry now
   wraps `loseContext`, and the selftest's mock follows.
3. **The small city lost its only clickable service building.** The clinic burnt down 15 minutes into the first small
   run (cycle 4), because it had no fire cover, and the inspect step failed as it should. The setup now also builds a
   fire station on the second road.

## What is left for #28

- **The lead sets the heap threshold and the duration.** The default 16 MiB/hour is a harness policy, not a project
  baseline. dense1m grew 5.06 MiB/hour over its 20 minutes.
- **The long runs:** both scenarios for the agreed hours, on the final merged revision, between timing runs.
  - Check the per-exit counts, the renderer deltas, the heap slope, the errors and the context-loss events.
  - A 20-minute smoke does not establish a multi-hour memory trend.

## Who wrote what

- **Codex** (max effort): the harness, its README and the selftest. Its sandbox could not start a browser or vite, so
  it ran no smoke run.
- **Me (Claude):** the brief and the review, both smoke runs, the three fixes above and this report.
