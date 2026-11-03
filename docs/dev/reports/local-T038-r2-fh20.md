# T038: R2's incremental Fireworks.collectLaunchSites, and FH-20's Emergency palette

Task: `docs/dev/queue/T038-r2-fireworks-fh20.md`. Plan items: `docs/WORKER_DESIGN.md` §6 row R2 (and §3.4's "the
remaining spike is render-side: `collectLaunchSites` walking every building"); `docs/POLISH_PLAN.md` FH-20 (round 1
takes only the Emergency view's palette). NOTEs naming T038: 033, 035, 037, 038, 042, 044.

The desktop wrote the code as a Codex lane on `local/T038-r2-fh20` (base `93069fa`, 2 commits) and stopped at the
Oct 28 usage limit with no report and no `.done`. The cloud carries it over on `cloud/t038`.

## Cloud carry-over (Nov 3)

Scratch files named `t038work/…` are in `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t038work/`,
and `co/t038-devbase` (the clean export of dev used as "before") is in `…/scratchpad/co/t038-devbase`.

### Gap list (required against done, at the start)

| # | required (task file, plan, NOTEs) | state on `local/T038-r2-fh20` |
|---|---|---|
| 1 | R2: `Fireworks.collectLaunchSites` incremental, kept up to date from building events, instead of a full scan at New Year | code done (`LaunchSiteIndex`, wired in `CityObjectsView`); WIP commit, to verify line by line |
| 2 | R2: measure the scan's cost at 1M before and after, in the quiet slot ("sized on R1") | **not done** (the harness had a `timeLaunchSites` helper and no runner, no numbers) |
| 3 | gate: New Year launch sites identical to the full scan on bot256_y60 and dense1m | tests written (random building events on both fixtures); to re-run here. No run through a real New Year |
| 4 | FH-20: the colour-blind-safe Emergency palette, keyed on `colourVision`; until the key lands, standard behind a constant | done behind `EMERGENCY_COLOUR_VISION = 'standard'`. The key has since landed in dev (T036 step 1), hidden by NOTE-042 (`A11Y_WIRED.colourVision = false`); the constant's comment still said "has not landed" |
| 5 | FH-20: distances with the plan's method (Machado 2009, linear RGB), above the floor (120) for deuteranopia and protanopia | test written (reproduces the plan's 66 / 56 / 79 / 124 reference values first) |
| 6 | FH-08 / FH-20: the texts name legend labels, never colours | safe-mode notes done; one note named "Out of reach" for the third band, which is the second band's label |
| 7 | gate: screenshots of the Emergency view in each mode | **not done** |
| 8 | gates: tsc, the full vitest | not run on the merged tree |
| 9 | report, `.done` | **not done** |
| 10 | base: 197 commits behind dev | merge needed |

### What was done

**Merge.** `origin/claude/beautiful-johnson-u2jqoz` @ `48991d7` merged into `cloud/t038` (from `local/T038-r2-fh20` @
`f581523`): no conflicts. Dev did not touch `Fireworks.ts`, `CityObjectsView.ts` or `render/world/overlays.ts` since
`93069fa`; tsc clean after the merge.

**The desktop's WIP, verified line by line** (`7241068` R2, `f581523` FH-20):
- `LaunchSiteIndex` keeps one cached entry per building (def category, footprint, its candidate site) from
  `buildingAdded` / `buildingChanged` / `buildingRemoved` and from `BuildingRenderer.onVisual` (terrain-driven rebuilds
  that emit no building event). It keeps the best 24 parks, 8 landmarks and 5 roofs per group with the full scan's tie
  rule (an insertion rank equal to the `Map` order: a replacement record keeps its rank, a remove + add gets a new one),
  re-ranks a group from the cache only when a kept winner leaves or changes its key, and re-scans the bounds only when an
  edge building moves or leaves. Ground heights are read at the show (the terrain can change silently), and so are
  pop/jobs: the centre is still one pass over the buildings with the full scan's arithmetic and order, so it stays
  bit-identical. The waterfront scan is unchanged (it walks the developed bounds' cells, not the buildings).
- `collectLaunchSites` is unchanged in behaviour: its tail moved into `finishLaunchSites` / `collectWaterfrontSites`,
  shared with the index.
- Wiring: the renderer applies each event first, then the index reads its visual; removal drops the index entry before
  the renderer's `onVisual(null)`; `rebuildAll` builds a fresh index after the renderer's pass; `dispose` clears it.
  Checked every direct `BuildingRenderer` mutation (`add`, `changed`, `remove`, `terrainChanged`, its own `rebuildAll`
  on a lot-twig quality switch): each ends in `onVisual`.
- The palette: `overlayDef` / `overlayLegend` take an optional colour vision, default `EMERGENCY_COLOUR_VISION =
  'standard'`. Standard output is identical to dev for every overlay and variant (89 overlay/variant pairs, deep-equal
  defs and legends, and `OVERLAYS`; `t038work/samedefs.mts`). Safe modes change only the Emergency view: the plan's
  palette `#2a7de1` auto / `#f5a623` near / `#9b1d6a` far / `#c8ccd2` none, same bands, alphas, titles, labels, layers.

**Fixed:**
1. *Safe-mode text.* The roadless-building note said "Out of reach on a single building". A roadless building takes the
   third band, whose label is "You must dispatch" (fire: "Too far"); "Just out of reach" is the second band. The note
   now names the third band's label (`A single building marked “You must dispatch”` / `“Too far”`). Standard text
   unchanged.
2. *Null index.* `CityObjectsView.launchSites()` dereferenced `launchSiteIndex!`, which is null inside `rebuildAll`'s
   building pass and after `dispose`. It now falls back to the full scan (same sites).
3. *Stale comment.* `EMERGENCY_COLOUR_VISION`'s comment said T036's key had not landed. It has (hidden by NOTE-042);
   the comment now says so and names the wiring rule.
4. *Timing harness.* `tests/render/fireworksHarness.ts` had a `timeLaunchSites` helper with no runner and per-call
   allocating visuals. It is replaced by `tools/bench/fireworksSites.ts` (below); the harness keeps the shared source
   and the stand-in visual (`standInVisual`), used by both.

**New tests** (each fails with its fix reverted: 3 failures with the old `overlays.ts` and `CityObjectsView.ts`, among
them `expected 'Out of reach on a single building: no…' to contain '“Too far”'` and `TypeError: Cannot read properties
of null (reading 'collect')`):
- `emergencyPalette.test.ts`: the safe-mode roadless note names the third band's label; the palette takes every
  `AppSettings.colourVision` value (`COLOUR_VISIONS`), the setting's default gives the default palette, and tsc checks
  that `ColourVision` and `EmergencyColourVision` are the same set of names.
- `fireworks.test.ts`: a show asking for sites during `rebuildAll`'s building pass gets the full scan's sites.
- The desktop's 19 tests fail against dev's three source files (run: 19 failed), so they test the change.

**R2 timing at 1M** (`tools/bench/fireworksSites.ts`, node 22.22, 4-core Xeon 2.1 GHz, under the timing lock;
"before" is dev's own `collectLaunchSites` loaded from the clean export `co/t038-devbase` @ `48991d7`; visuals are
deterministic stand-ins held in a `Map`, as `BuildingRenderer.getVisual` holds them). Warm: 30 interleaved rounds × 20
calls per variant, the order rotated each round; A/A = before against itself. Cold: the first call in a fresh process
(as at New Year, once a game year), interleaved A, B, A, B: 7 processes per variant in run 1, 5 in run 2. Two
independent runs (`t038work/timing1.json`, `timing2.json`):

| fixture | run | before warm (median / p90) | after warm | after / before | A/A | before cold 1st call (median, range) | after cold 1st call | index build at load |
|---|---|---|---|---|---|---|---|---|
| dense1m_s7 (17,154 buildings, 1.12M residents) | 1 | 1.918 / 2.778 ms | 0.396 / 0.557 ms | 0.206 | 1.004 | 15.5 ms (13.8-20.2) | 4.4 ms (3.8-6.8) | 23.6 ms cold, 18.2 warm |
| | 2 | 1.759 / 2.589 ms | 0.378 / 0.528 ms | 0.215 | 1.005 | 17.6 ms (13.6-22.6) | 9.4 ms (3.9-13.3) | 25.7 ms cold, 25.5 warm |
| bot256_s7_y60 (11,276 buildings) | 1 | 1.306 / 1.700 ms | 0.294 / 0.412 ms | 0.225 | 1.008 | 9.7 ms (8.9-14.0) | 5.8 ms (2.9-6.2) | 20.2 ms cold, 11.0 warm |
| | 2 | 1.216 / 1.582 ms | 0.239 / 0.304 ms | 0.197 | 0.994 | 10.3 ms (8.2-13.3) | 5.6 ms (4.2-5.9) | 20.7 ms cold, 12.5 warm |

- Warm, the show's site collection is 0.20-0.23× the full scan, in both runs. Cold, on its first call (the case at New
  Year), it is 0.29-0.60×, about half: the cold numbers spread widely on this shared machine.

- What the show still pays: one pass over the buildings for the pop/jobs centre, the centre snap and the waterfront
  scan (0.029 / 0.028 ms of it). The first-call cost after the change is mostly that pass running cold.
- The per-event cost of keeping the index (dense1m / bot256, run 1; run 2 alike): a `buildingChanged` 3 / 1 µs median
  (max 0.09-0.13 ms); a remove + add 2 / 1 µs median (max 1.4-2.1 / 0.23 ms, one-offs); a kept winner removed (the
  group re-ranked from the cache) 0.32-0.37 / 0.13-0.15 ms; an edge building removed (the bounds re-scan) 0.19-0.21 /
  0.15 ms.
- The index build moves the definition and visual reads to load and reset: 11-26 ms at 1M, once.

**The identity gate through a real New Year** (both fixtures, the sim run to its next `'year'` event):
- `--year` (the tool, index fed from the sim's events, visuals kept the way the renderer keeps them): dense1m 239 days,
  6,236 building events, 9 checks; bot256_y60 360 days, 15,870 events, 13 checks; every month boundary and the New Year
  identical to both full scans (this tree's and dev's).
- The production wiring (`CityObjectsView` with the real `BuildingRenderer` visuals): dense1m 10 checks, bot256_y60
  14 checks, load + every month + New Year, all identical (30 and 34 sites: centre, parks, plazas, landmarks, 5 roofs).
  This ran twice: once from the scratch script `t038work/realview.mts`, and once through the committed tool's `--view`
  in run 2. Also small_s7_y10 (2,765 buildings, 3,754 events): 14 checks identical. `--year` was identical in run 2 too.
- The fixture tests (`fireworks fixture identity`): 140 random add/remove/change events on each fixture, identical
  after every 7th; they ran (not skipped) here.

**FH-20 distances** (Machado 2009 at full severity, applied in linear RGB, clipped, measured in displayed sRGB on the
0-255 scale: the plan's method; the test first reproduces the plan's own 66 / 56 / 79 / 124):

| palette (legend tokens) | deuteranopia: closest pair | protanopia: closest pair | tritanopia: closest pair | normal |
|---|---|---|---|---|
| standard `#3fb45a` / `#f0a030` / `#c8322a` / `#6a4c93` | 66.5 (auto / near) | 56.0 (auto / near) | 127.4 | 117.2 |
| safe `#2a7de1` / `#f5a623` / `#9b1d6a` / `#c8ccd2` | **135.4** (auto / far) | **138.3** (auto / far) | 104.0 (near / none) | 177.3 |

All six safe pairs are above the floor of 120 under deuteranopia and protanopia, for each of the three responders, in
both safe modes (the test). The plan's two tritanopia problem pairs (auto against near and far) are 255.9 and 232.5.

**Screenshots of the Emergency view in each mode** (the real game in Chromium on SwiftShader, 1280×720, quality low,
small_s7_y10: 128², 101,602 residents, 13 fire and 13 police stations; the city paused; the Data views panel open on
Emergency with its legend; fire and police each; 0 page errors). The setting is not wired (decision 2), so each mode
ran from its own tree: the lane's worktree for standard, and two scratch copies of it that differ only in the
constant (`EMERGENCY_COLOUR_VISION = 'red-green'` / `'blue-yellow'`). Each tree had its own vite server and cache,
removed afterwards. Script `t038work/shots.mjs`; results `local-T038-r2-fh20/shots.json` (legend stops, notes and the
panel's text per shot).
- standard: `local-T038-r2-fh20/emergency-standard-fire.jpg`, `emergency-standard-police.jpg`. Green auto-dispatch
  over most of the city, an amber "Just out of reach" strip at the bottom corner, red single roadless lots, purple
  swatch for no station; the legend and notes as on dev.
- red-green safe: `emergency-red-green-fire.jpg`, `emergency-red-green-police.jpg`. Blue auto-dispatch, the same strip
  orange, the roadless lots magenta, the no-station swatch grey; the notes name labels only ("Auto-dispatch: …",
  "Just out of reach: …", "A single building marked “Too far”" / "“You must dispatch”").
- blue-yellow safe: `emergency-blue-yellow-fire.jpg`, `emergency-blue-yellow-police.jpg`: the same safe palette.
- Seen, not changed: the hover tip's "Auto-dispatch · 3.1 min to spare" stays green in the safe modes. It is the
  inspector's `tone: 'pos'` theme colour (`inspectorModel.ts:555`), FH-20's round-3 theme tokens ("good vs bad (HUD)"),
  and it carries the label, so colour is not its only cue.
(The full-size PNGs are in the scratchpad `t038work/shots/`.)

### Gates

| gate | result |
|---|---|
| tsc (sem) | clean after the merge, and on the final tree |
| the full vitest (lock), `cloud/t038` @ `759e988` | **218 files passed, 1 skipped; 2,171 tests passed, 4 skipped, 0 failed** (463.5 s) |
| the lane's own tests | `fireworks.test.ts` 14 and `emergencyPalette.test.ts` 9, all passed, the two fixture tests run (not skipped) |
| New Year launch sites identical to the full scan, bot256_y60 and dense1m | **identical**: a real New Year on both fixtures through the index fed by sim events (22 checks) and through the production `CityObjectsView` with real visuals (24 checks); random events on both (fixture tests) |
| the palette's distances above the floor, deuteranopia and protanopia | **135.4 and 138.3** (closest pairs) against the floor of 120 |
| screenshots of the Emergency view in each mode | 6 shots, standard / red-green / blue-yellow × fire / police |
| R2's 1M timing, before and after (two runs) | dense1m: warm 1.92 / 1.76 → 0.40 / 0.38 ms (0.21×), cold first call 15.5 / 17.6 → 4.4 / 9.4 ms; bot256_y60: warm 1.31 / 1.22 → 0.29 / 0.24 ms (0.20-0.23×), cold 9.7 / 10.3 → 5.8 / 5.6 ms; A/A 0.994-1.008 |
| the bot | **not run, not required**: the lane changes no file under `src/sim`, `src/worker`, `src/game` or `src/save` (`git diff --name-only` against dev: `src/render/city/CityObjectsView.ts`, `src/render/city/effects/Fireworks.ts`, `src/render/world/overlays.ts`, tests, `tools/bench/fireworksSites.ts`, this report) |

### Decisions

1. **The default stays the standard palette.** The task file says "until that key lands, use the standard palette
   behind a constant", and the lead's carry-over brief calls the code done with standard by default. POLISH_PLAN FH-20
   reads wider: "Emergency colours that work for everyone, in round 1", and its Acceptance says "The Emergency pairs
   pass in every mode from round 1". The standard palette does not pass (66.5 / 56.0). I kept the task file's narrower,
   later reading: no change to what every player sees. Making the safe palette the default for everyone is one line
   (`EMERGENCY_COLOUR_VISION`, or `overlayDef`'s choice of `EMERGENCY_STANDARD`), for the lead or the owner to decide.
2. **`AppSettings.colourVision` is not wired.** The key exists in dev now (T036 step 1) but is hidden
   (`A11Y_WIRED.colourVision = false`, NOTE-042: the lane that wires it shows the control in the same change). Wiring it
   means TerrainRenderer's two `overlayDef` calls, the UI legend path (`mods.overlayLegend`), a refresh on change, and
   the flag and controls in META's settings files, all outside T038's `owns`. A Colour vision control that recolours
   only the Emergency view, while zones, desirability and the HUD stay as they are (FH-20 round 3), would read as
   broken by NOTE-042's own rule. So `overlayDef` / `overlayLegend` take the setting's values as they are (a test checks
   the names match), and the wiring lane passes the setting through.
3. **Red-green and blue-yellow share the one safe palette in round 1.** It is the plan's palette, and FH-20's floor is
   for deuteranopia and protanopia only. Under tritanopia its closest pair is near / none at 104.0, below 120. Blue-yellow's own
   Emergency colours belong with its round-3 theme work.
4. **AC2 ("the real game on R1", R2's gate column) is a real-GPU frame measurement** and cannot run here. As the lead
   asked, `collectLaunchSites` was timed as CPU work in node, against dev's own function, with interleaved runs and an
   A/A, under the lock. The stand-in visuals replace only the renderer's `Map` lookup, which they reproduce.
5. **What the change buys is smaller than "a full scan at New Year" suggested.** At 1M the full scan is 1.2-1.9 ms warm and
   10-18 ms on its cold first call (dense1m has 17,154 buildings). After the change the show pays 0.24-0.40 ms warm and
   4-9 ms cold: one pass over the buildings for the pop/jobs centre, needed for exactness because pop and jobs change
   without events. In exchange, building the index costs 11-26 ms once at load and reset. Keeping the centre
   incremental would break the bit-identity gate, so it stays as written.
6. **Safe-mode screenshots come from scratch copies with the constant flipped**, because the setting is not wired.
   No URL flag or runtime hook was added to the product for the evidence.

### Remaining

Nothing for T038's round-1 scope. For the lead: decisions 1 (the default palette), 2 (who wires `colourVision`, with
the control) and 3 (blue-yellow's own Emergency colours, round 3). AC2 for R2 is a real-GPU run on R1, with BuildingRenderer's
and MiniMap's R2 parts, which are not in this task.
