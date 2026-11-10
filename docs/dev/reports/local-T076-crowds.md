# T076 — FEEL-25 street life

Branch `local/T076-crowds`, base `1c2019c`. Changes are uncommitted.

The visual renderer is implemented. **Exact local customer / visitor / rider data and live rain still need owner
integration** (requests below). TypeScript passes. Vitest cannot collect tests in this sandbox (`spawn EPERM`).
The real-GPU 0.8 ms gate, real-city visibility, full suite and bot remain for the lead.

## Changes per file

- `src/render/city/Pedestrians.ts` (new): one opaque InstancedMesh, four coat colours, the existing pedestrian's
  two bottomless boxes (20 triangles), optional umbrellas in the same draw (36 triangles in rain). The coat shader
  preserves the head / handle colours and inherits the city material's lighting, overlay and underground dimming.
  Cell / slot hashes choose positions, coats, walking speeds and phases; no simulation RNG is used.
- `src/render/city/CityObjectsView.ts`: small lifecycle wiring, optional hour / crowd / rain feeds, network
  invalidation, quality changes, reset / replacement, disposal, draw accounting and a `prof.pedestrians` counter.
- **Outside the named source files:** `src/game/CityScene.ts`, `createViews()`'s `octx`: one additional property,
  `getTimeOfDay: () => world.timeOfDay`. The objects view previously had no access to the rendered hour. This is
  visual wiring only; it does not read simulation systems or issue mutations.
- `tests/render/pedestrians.test.ts` (new): 19 cases, including all four presets, default 38-degree FOV at 120 m
  in top-down and default oblique poses, night thinning, distance / quality caps, movement on both sidewalk axes,
  bridge heights, invalid paths, local work bounds, replica-only reads, optional density feeds, geometry, colours,
  determinism, unchanged mirrored records and upload ranges.
- `tests/render/pedestriansView.test.ts` (new): 2 integration cases for feeds, hour / rain, one-draw accounting,
  quality, network changes, reset / replacement, resource disposal and listener teardown.
- `docs/dev/reports/local-T076-crowds.md`: this report.

**Infra hunks: none. Cloud-held files changed: none.** No save format, systemData key, simulation, balance or bot
code changes. Medium / Hard behavior and old-save continuation are expected to remain identical, but were not
verified by bot hashes here.

## Cost and behavior

- Spawn discovery is limited to 350 m of the camera, with a margin for the sidewalk offset / path. A compacted
  instance is removed beyond 600 m, including a margin for the model's extent, or outside the camera frustum.
- Caps: LOW 120, Medium 300, High / Ultra 600. No pedestrian shadow passes; the visible batch adds one main-pass
  draw. Empty / distant views add no pedestrian draw or instance upload.
- Discovery scans a local spiral, at most 80 cells per frame, and reads at most four neighboring building-grid
  positions per sampled road cell. It never iterates the city's buildings. It refreshes once per second after a
  scan finishes, or after network invalidation / a camera move of more than three cells. The previous roster remains
  visible while a new scan completes. An empty full scan takes at most 26 frame slices.
- Only uniform straight sidewalk cells are used. Walkers move back and forth inside their own cell, never through
  road junctions. Highways, tunnels, rail crossings, width transitions and highway-overpass crossing cells are
  excluded. Ordinary road bridges use their deck surface.
- Daytime activity peaks from 09:00–19:00, with gradual shoulders and 15% at 03:00. Thinning applies after distance /
  frustum compaction, so at the same pose / visual time the night count is exactly `floor(dayCount * 0.15)`.

## Acceptance and checks

| Acceptance | Evidence / remaining gate |
|---|---|
| 50k city at 120 m: at least 20 walkers by day; at 03:00 at most 20% | Short headless runtime probe passed on a synthetic 50k grid at the game's 38-degree FOV / 16:9. All presets: top-down **38 day / 5 night**, default 52-degree tilt / 45-degree yaw **61 / 9**. Actual building occlusion / visible people in a real city still require the browser check. New unit tests cover these poses. |
| At most 0.8 ms and one draw call | Single material / InstancedMesh, no groups and no shadow casting; real CityObjectsView headless probe checked **+1** in its draw accounting. Saturated synthetic probe reached **120 / 300 / 600 / 600** caps. **CPU / GPU timing and actual GL draw counts are unverified**, including LOW and dense1m. |
| Limits / appearance / rain changes | Probe checked spawn distances, sidewalk heights, far hiding, dry 20-triangle and rain 36-triangle geometry. Four colours / bridge / lifecycle / read-budget checks are in the new tests. Rain is available through the optional feed but has no live weather producer on this base. |
| TypeScript | `npx tsc --noEmit` **passed**, after the final source and test changes. |
| Patch whitespace | `git diff --check` **passed**. |
| Targeted Vitest | Every file below was attempted singly through quietrun with `--maxWorkers=1`; all failed **before collection**, in Vite config loading / `optimizeSafeRealPathSync`, with `spawn EPERM`. No test-pass claim. |
| 128x15 seed 7 bot / determinism | **Not run**, left to the lead per task. Expected residents **[61124, 93804, 37971] = 192899**, year 2015. No balance change is intended. |

Targeted test files attempted:

- `tests/render/pedestrians.test.ts`
- `tests/render/pedestriansView.test.ts`
- `tests/render/garbageView.test.ts`
- `tests/render/fireworks.test.ts`
- `tests/render/exitRetention.test.ts`
- `tests/game/cityTeardown.test.ts`
- `tests/game/cityDisposeCanvas.test.ts`
- `tests/game/citySaves.test.ts`
- `tests/worker/hygiene.test.ts`

Each command was:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run <file-above> --maxWorkers=1
```

The additional `--configLoader native` attempt failed because this Node 22.12 loader does not load the `.ts` config.
A short diagnostic probe bundled the real source in process with the locally installed rolldown, used Node asserts,
and ran through quietrun; it used neither Vitest nor WebGL and measured no timing. Its final results are
`probe-results.json` under the supplied T076 scratch folder. A second part exercised the real CityObjectsView:
**38 / 5** day / night, 36 rain triangles, **+1** draw accounting, state replacement and disposal passed
(`integration-probe-results.json`). `probe.mjs`, `targeted-remainder.log` and the startup diagnostics are there as
well. No full suite, benchmark or browser was run.

Lead's bot command (no new strategy flags; explicit existing default difficulty):

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --difficulty medium
```

Required result: year 2015 population **192899**, residents **61124 / 93804 / 37971**. Medium / Hard yearly state
hash comparisons and old-save continuation are not newly measured. The full suite remains with the lead.

## Plan versus code / owner requests

1. **Worker crowd data is absent.** `TrafficView` exposes route samples and truck volume, not local customers /
   riders. `visitors` is a subscribed Tourism layer, so normal play cannot safely depend on it. The fallback uses
   always-mirrored nearby `pop` / `jobs`, retail definitions, road traffic, and city `tourists`, `tripsTransit` and
   `tripsWalk` totals. This is a density proxy, not the exact local counts requested by the plan.

   **Request to the cloud:** in `src/worker/SimHost.ts`'s `TrafficView`, `src/worker/protocol.ts`'s traffic stream,
   `src/worker/recorder.ts`'s stream construction, and `src/worker/replica.ts`'s traffic application, add an optional
   bounded road-cell / coarse-chunk crowd-density stream. Populate customers from commercial customer assignments,
   visitors from the completed tourism layer, and riders from stop loads / bus-rider assignment; refresh after the
   completed relevant passes and return null until ready. No per-building inspector watches and no new sim RNG.
   Then `CityScene.createViews()` can pass `getPedestrianActivity: (cell) => host.traffic...` to the existing
   `PedestrianFeed` seam (`{ customers, visitors, riders } | null`). Keep the key optional for old hosts / saves.
   The worker owner may need a small, separately committed infra read hunk to export the completed density;
   **this lane made no infra change**.

2. **FEEL-23 weather is absent.** There is no `Weather.ts` or rain view API on this base. No independent weather
   calendar was invented. **Request to the FEEL-23 owner:** expose its current visual rain boolean from the weather /
   world view, then pass it as `getRain` in `src/game/CityScene.ts:createViews()`'s `octx`. The pedestrian geometry
   already switches umbrellas in the same batch when that callback returns true. Live rain-day matching remains
   pending that integration.

3. **The person helper is private.** `src/assets/builders/transport.ts:person()` is not an exported / registered
   pedestrian asset. Its exact two-box dimensions are reproduced in the owned new file to avoid editing CONTENT's
   asset file. Feet are placed by RoadSurface rather than the bus-stop model's fixed 0.14 m lift.

4. **Rendered hour needed one external hunk.** `uTime` is elapsed real time; it is not time of day. The tiny
   `CityScene` callback is necessary to follow the world's fixed-hour settings and automatic clock. Other callers
   without that optional callback use the existing night uniform as a day / late-night fallback.

## Browser checklist for the lead

- [ ] Real 50k city, 120 m camera distance, same street pose: count / see at least 20 daytime walkers; fixed 03:00
  has at most 20% of daytime. Check default oblique and close top-down views, including LOW.
- [ ] Check movement, four coats, intact skin colour, road / avenue / one-way sidewalks, slopes and bridge deck
  heights. No walkers on highways, in tunnels / rail crossings, through junction asphalt or demolished roads.
- [ ] Pan / orbit / zoom: discovery settles without a frame spike; no new walkers beyond 350 m, none drawn beyond
  600 m. Far / empty views draw no pedestrians. HIGH→LOW→HIGH remains capped at 600→120→600.
- [ ] On a dense 1M city and LOW, include discovery / moving-camera frames: pedestrian CPU cost **<=0.8 ms**,
  **one** extra main-pass draw, zero pedestrian shadow draws; verify the round's overall frame budget as well.
  `objects.prof.pedestrians / objects.prof.frames` exposes the subsystem mean; inspect frame tails separately.
- [ ] Once FEEL-23 is wired, matching rain days show umbrellas in the same one draw; dry days restore the plain
  model, and pause / fixed-hour settings follow the world correctly.
- [ ] Save / load, reset / worker resync, graphics restoration, quality changes and exit / re-enter: old rosters
  disappear, the new city repopulates, and no pedestrian resources / event listeners retain the previous city.

## QA round 2 — B1 / B2 / B3

Round 1 is committed at `754b007`; the lead reports its full gate green. Read the supplied `qa_round1.md`, including
the measured blinking, avenue-pole collisions and 30 fps discovery starvation. The following changes are
**uncommitted**, on top of that commit; earlier sections describe round 1.

### Changes per file

- `src/render/city/Pedestrians.ts`:
  - **B1:** each seed gets an independent activity rank, `hash(seed ^ 0x5bd1e995) / 2^32`. A completed roster is
    ordered by that rank once; frames count all spatially eligible walkers and filter against each walker's own
    threshold. The retained prefix is capped at `floor(eligible * min(1, activity * 1.33))`. Thus changed discovery
    order or an unrelated edge crossing cannot shift every later walker's keep decision. There is no per-frame
    sort, extra pose pass, simulation RNG draw or unbounded storage.
  - **B2:** avenue walkers use the 7.72 m line on both sides / axes, clearing the 7.35 m streetlight poles while
    keeping the 0.45 m body on the sidewalk. Other road-type offsets are unchanged.
  - **B3:** only start / recenter discovery while no scan is running. Movement and dirty requests wait for the
    current bounded scan to finish; its live-camera tests and the last completed roster keep working meanwhile.
- `tests/render/pedestrians.test.ts`: update the old exact-15%-count assertion to test the requested hash thinning
  and strict night quota. Its four-preset day/night, cap, distance, placement, determinism and read-budget tests stay.
- `tests/render/pedestrianThinning.test.ts` (new, 6 cases): fixed 07:00 / 21:00 identity stability through actual
  screen-edge crossings and repeated rebuilds; changed discovery origin with shared identities; unchanged night
  rebuild, changing night eligibility, binding one-to-six-walker quota, and nested hour thresholds.
- `tests/render/pedestriansQa.test.ts` (new, 3 cases): both avenue axes over full pacing cycles, body / lamp and
  sidewalk clearance; continuous 132 m/s LOW pan at 30 fps, completed scans, visible frames, instance and work caps.
- `docs/dev/reports/local-T076-crowds.md`: this QA round-2 section.

No round-2 edit outside these files, no infra hunk and no cloud-held file edit. CityObjectsView / CityScene wiring,
the umbrella seam, geometry, material, 350 / 600 m cuts and 120 / 300 / 600 / 600 caps are unchanged. No new owner
request; the pre-existing exact-density / weather requests above remain with their owners.

**Strict quota boundary:** at 03:00, `0.15 * 1.33 = 0.1995`, so even an unusually night-heavy view remains below
20%. If the eligible count falls enough to lower a binding quota, one kept walker must disappear to obey that
limit; absolute identity stability in that case is mathematically incompatible with the strict cap. Lowest-rank
selection makes this a deterministic boundary change, rather than the old mass reshuffling. With quota slack,
each eligible walker's own threshold alone determines its presence.

### Round-2 validation

| Check | Result |
|---|---|
| `npx tsc --noEmit`, including all new tests | **PASS** |
| `git diff --check` | **PASS** |
| `pedestrianThinning.test.ts`, `pedestriansQa.test.ts`, `pedestrians.test.ts`, `pedestriansView.test.ts` | Each attempted singly through quietrun, `--maxWorkers=1`; **all blocked before collection by Vite `spawn EPERM`**, as in the earlier sandbox attempt. No Vitest-pass claim for round 2. |
| Own short headless regression probe, real source, Node asserts, through quietrun | **PASS**; detailed results below. This is not Vitest or GPU timing. |
| Full suite / bot / real-GPU QA | Not rerun here; round-2 lead gates remain. Simulation / RNG / save behavior is untouched. Expected 128x15 seed-7 Medium residents remain **[61124, 93804, 37971] = 192899** in 2015; use the exact bot command above. |

Headless probe evidence (`round2-probe.mjs`, `round2-probe-results.json` in the supplied lane scratch folder):

- **B1:** both fixed 07:00 and 21:00 survived **12** actual eligibility crossings, repeated rebuilds and **42,583**
  identity comparisons apiece with no unexpected keep/drop changes; shifting the discovery origin preserved all
  **84** shared eligible identities in each case. Three-am quotas were checked across changing eligibility; the
  adversarial one-to-six eligible-walker cases produced **0, 0, 0, 0, 0, 1** kept walkers.
- **B2:** **108,000** horizontal and **90,000** vertical avenue poses, including walking past the lamp line: minimum
  body-to-pole clearance **0.02497 m**, minimum body-to-sidewalk-edge clearance **0.05503 m**; zero intersections.
- **B3:** the continuous four-second 132 m/s LOW pan at 30 fps completed **4** full 2,025-cell searches, first drew
  walkers on frame **26**, and drew them on **95 / 120** frames. Maximum feed calls in one frame: **26**, below the
  unchanged 80-cell discovery budget. The LOW instance cap held.
- A second short count / lifecycle probe (`round2-counts.mjs`, `round2-counts-results.json`) kept the synthetic 50k
  city at **38 day / 5 night** top-down, **61 / 5** default oblique, all presets; saturated caps remained
  **120 / 300 / 600 / 600**. Spawn / far-hide checks, rain geometry, +1 draw accounting, replacement and disposal
  passed. `integration-round2-counts-results.json` records the integration part.

`round2-vitest.log` records the four startup failures. No browser, full suite, bot or benchmark was run by this lane.

### Round-2 browser checklist

- [ ] Re-run `func.mjs`'s still / slow-pan pop checks at 07:00 and 21:00 in the 56k and 1.1M cities; verify the
  widespread mid-screen blinking is gone. Recheck 03:00 stays <=20% of the same daytime set.
- [ ] Re-run avenue pole checks on both axes through full walking cycles: no body / pole intersection and bodies
  remain on the sidewalks.
- [ ] Re-run `pan30` at 132 m/s, LOW, continuous keyboard motion: searches finish and streets keep repopulating.
- [ ] Recheck 120 / 300 / 600 / 600 caps, 350 / 600 m cuts, exactly one extra main-pass draw, no shadow draws and
  <=0.8 ms frame cost, including roster completion / sorting frames. Umbrella integration stays with T074.

## QA round 3 — B3 at 30 fps, N1, the hand-over

Round 2 is committed at `d182317`. The real-GPU recheck passed B1 and B2; **B3 failed at 30 fps**: the 132 m/s
keyboard pan at 120 m drew 5.2 walkers on average against 20.1 at 60 fps and 82 at rest, none at all in 44 of 119
frames, 55 popping in mid-screen at the roster swaps. A search tested the cells in view in its first frames but only
swapped its roster in after all 26 frames (0.87 s at 30 fps), by when the view had moved 114 m. **N1:** after a camera
jump during a search the walkers took up to 45 frames at 60 fps and 49 (1.63 s) at 30 fps to return. The changes below
are **uncommitted**, on top of `d182317`.

### Changes per file

- `src/render/city/Pedestrians.ts`:
  - **B3, a search budget per second:** `discover()` takes the frame's `dt` and searches
    `Math.min(320, Math.max(80, Math.round(80 * 60 * dt)))` cells (`CELLS_PER_FRAME`, `MAX_CELLS_PER_FRAME`): 80 a
    frame at 60 fps and faster, 160 at 30, 240 at 20, 320 at 15 and below. A 2,025-cell search takes 26 / 13 / 9 / 7
    frames, 0.43-0.47 s at 60-15 fps (0.7 s at 10 fps, where the slice stays at 320). The game's `dt` is the real frame
    time clamped to 0.1 s (`CityScene.loop`), also while the sim is paused.
  - **N1, abandon a search the camera has left:** `REACH = ceil(350 / 16) = 22` cells is the half-side of the square
    the spiral covers (`SEARCH_CELLS = 45² = 2,025`). A running search continues while the camera cell stays within 22
    cells of its centre (each axis); once the camera is outside that square the search is dropped and a new one starts
    in the same frame, centred on the camera. With no search running, the start rules are round 2's (invalidation, a
    move of more than 3 cells, the 1 s refresh).
  - **The progressive hand-over (the optional item):** while a search runs, `update()` draws its finds at once, then
    the previous roster's walkers on the cells it has not reached yet, in the order the spiral reaches them
    (`spiralIndex()`; the previous roster's slots are keyed and sorted once when the search starts, `passed` counts the
    ones it has passed). A previous-roster cell is drawn only while the search would still take it (`taken()`: inside
    the 338 m spawn test and in view), so what is drawn is what the finished search will hold, and the cap (counted on
    in-view walkers, 120 / 300 / 600) cuts the far end of that order. Nothing pops in at a roster swap any more: the
    new roster's walkers were drawn as the search found them.
  - **Screen-edge grace:** a cell the previous roster holds stays while a 12 m sphere around its middle is in view
    (walkers pace up to 9.8 m from it; the rest allows for a sloping deck), so a walker no longer vanishes a few metres
    inside the screen edge when the middle of its cell leaves the view. Only while the roster has places to spare: a
    full roster spends them on cells in view. New cells still enter when their middle is in view.
  - **The night quota with two rosters in a frame:** the per-roster rank order (`order`, its comparator sort) is gone.
    When the quota binds, `thin()` keeps the lowest ranks among the walkers written that frame (one sort of at most 600
    ranks, only in such frames). Each walker's own seed threshold (B1) and the `activity * 1.33` quota are unchanged.
  - Unchanged: B2's 7.72 m avenue line, the caps, the 350 / 600 m cuts, the one InstancedMesh draw, no shadow, the
    density inputs (mirrored state and the optional feed only), no RNG beyond the cell / slot hashes.
- `tests/render/pedestrians.test.ts`: the read-bound test (`bounds nearby discovery work at 1M, …`) now checks the
  four-building-reads-a-cell bound at 80 / 80 / 160 / 320 / 320 cells for dt 0, 1/60, 1/30, 0.1 and 1 s. New:
  `searches by the second: at %i fps a frame takes %i cells, and a search the same time` (144 / 60 / 30 / 20 / 15 /
  10 fps); `draws the same walkers while a new search takes the street over (%s, %i:00, %i a cell from the feed)` (a
  twin that only walks must draw the same walkers in every frame: 12 / 21 / 03 h, and LOW, MEDIUM and HIGH rosters
  at their caps); `hands every cell over exactly once wherever a frame's slice ends: the spiral's order on all four
  sides of a ring` (every slice from 80 to 320 cells in steps of 7).
- `tests/render/pedestriansQa.test.ts`: round 2's 30 fps pan test is replaced by `draws as many walkers through a
  132 m/s LOW pan at 30 fps as at 60 fps, and no frame of it is empty`; new `keeps the pan populated at %i fps, %i
  cells a frame` (20 / 15 / 10 fps), `keeps a faster, wider pan populated too: 330 m/s from 300 m on HIGH`, `abandons a
  running search at %i fps when the camera jumps %i cells, and starts again at once` (30 cells at 60 and 30 fps, 23 at
  60), `lets a running search finish when the camera moves %i cells (QA B3: a pan must not restart it)` (4 / 10 / 22),
  `never drops a walker that is still in view while the camera pans at %i m/s` (20 / 132), `spends a full roster on
  the view: a slow LOW pan in a busy city stays near the cap`, `lets go at once of walkers the running search will not
  take: a zoom-out past the spawn distance`, `keeps a full HIGH roster steady while the camera orbits and pans: next to
  no walker missing for a frame`, `hands the street over to a new search without a blink or a walker over the cap (%s,
  %i a cell, %i m)` (LOW / MEDIUM / HIGH full, HIGH sparse). The avenue lamp tests are unchanged.
- `tests/render/pedestrianThinning.test.ts`: new `keeps each walker's own decision and the night cap through a fast
  pan, a search always running (%i:00)` (07 / 21 / 03 h) and `shows exactly the walkers ranked under the activity of
  %f h, the lowest ranks when the quota cuts, in any roster order` (03 / 05:30 / 07 / 21 / 23 h, against the walkers'
  own hashes).
- `docs/dev/reports/local-T076-crowds.md`: this section.

No other file, no infra hunk, no cloud-held file. No save, sim, balance or RNG change.

### Numbers (node, no WebGL)

The tests' grid city (streets every 4 cells, 3 walkers a cell from the feed), the default 120 m oblique view, 13:00,
the QA's pan: 4 s at rest, then the target moves 4 s; drawn walkers a frame, averaged over the pan's last 3 s:

| pan | slice (cells a frame) | round 2: drawn avg, empty frames | round 3: drawn avg, fewest, empty frames |
|---|---|---|---|
| 132 m/s LOW, 60 fps | 80 | 25.9, 0 of 180 | **53.8**, 36, 0 |
| 132 m/s LOW, 30 fps | 160 | 5.4, **40 of 90** | **54.3**, 37, 0 |
| 132 m/s LOW, 20 fps | 240 | 0.5, 49 of 60 | 55.6, 38, 0 |
| 132 m/s LOW, 15 fps | 320 | 10.0, 16 of 45 | 56.9, 36, 0 |
| 132 m/s LOW, 10 fps | 320 | 11.3, 11 of 30 | 49.4, 22, 0 |
| 330 m/s from 300 m, HIGH, 60 fps | 80 | 77.3, 0 of 180 | 151.6, 109, 0 |
| 330 m/s from 300 m, HIGH, 30 fps | 160 | 11.1, 52 of 90 | 153.4, 111, 0 |

68 walkers at rest (201 at 300 m); a search from scratch at each pose of the pan would find 70 on average (195). Seven
searches finish in the 4 s pan at both 30 and 60 fps (round 2: four at 30 fps), none abandoned. (The QA's page-side
emulation of the per-second budget in the 56k city: 26.3 drawn on average at 30 fps, against 20.1 at 60.)

- **Pop-ins** (the QA's `pops` v2: a walker appearing inside the inner 90 % of both frames): at 132 m/s 56-58 a
  second at 30 and 60 fps, none vanishing (round 2: 14 / 49, fewer at 30 fps because hardly any were drawn). They now
  appear at the leading edge, a median 0.24-0.26 and at most 0.49-0.50 of the way from the edge to the centre (round 2:
  median 0.52, up to 0.93-0.96), at most 22 / 17 in one frame (round 2: 20 / 30). These are cells entering the view
  between two searches (one every 0.43 s; the view moves 57 m meanwhile); only a search that leads the camera removes
  them (see the choices below). At 330 m/s from 300 m they reach the centre in both rounds.
- **N1:** the camera jumps 30 cells sideways 5 frames into a search: 80 % of the walkers are back after 3 frames at
  60 fps and 2 at 30 fps, the new search is done after 26 / 13 frames (0.43 s); 23 cells: 3 frames. Round 2 drew
  nothing for the 21 / 13 frames the old search still ran, then searched again. Over 24 jumps at different moments
  (30 and 23 cells): 3-4 frames at 60 fps, 2 at 30 fps, whether a search was running or not (round 2: 26 / 13). A jump
  inside the reach (8-15 cells) while a search runs: 5-26 frames at 60 fps, 4-13 at 30 fps (round 2: 25-46 / 14-24).
- **Small moves** of 4, 10 and 22 cells during a search leave it running from its own centre to its 26th frame; the
  next one then starts at the camera.
- **Hand-over:** with a still camera the drawn set is the previous roster's in every frame of a new search (twin
  test, all slice sizes). The screen-edge grace keeps every in-view walker through 20 and 132 m/s pans (over 10,000
  checks); orbiting a full HIGH roster at 300 m, a walker in view comes back after missing frames 11 times in 6 s (114
  times without the early drop of previous-roster cells the search would not take). A slow LOW pan in a busy city
  keeps 113 of the 120 on average (a fresh search at its end: 113).

**Per-frame cost** of `Pedestrians.update` (node / V8 on this machine, no WebGL), in the busiest case found: a 150°
view straight down from 100 m over a street every other row with buildings on both sides (the density proxy), the
roster at the 600 cap, the camera panning at 132 m/s, so a search always runs and two rosters are drawn:

| slice | p50 | p95 | p99 | first frame of a search (keys sorted), median |
|---|---|---|---|---|
| 320 cells (15 fps and below) | 0.060 ms | 0.075 ms | 0.078 ms | 0.072 ms |
| 240 cells (20 fps) | 0.056 ms | 0.067 ms | 0.070 ms | 0.066 ms |
| 160 cells (30 fps) | 0.052 ms | 0.066 ms | 0.069 ms | 0.064 ms |
| 80 cells (60 fps) | 0.047 ms | 0.062 ms | 0.064 ms | 0.062 ms |
| no search running | 0.040 ms | | | |

The worst frame's 320 cells cost about 0.01 ms more than 80; the whole update stays under 0.1 ms here, a tenth of the
0.8 ms line. LOW (cap 120) stays under 0.031 ms at p99, the game's 120 m view under 0.014 ms. An earlier run of the
same probe on a loaded machine gave p99 up to 1.1 ms for round 2's code and round 3's alike (worst-slice medians
0.10-0.13 ms). Real-GPU numbers remain for the clean timing run (below).

### Round-3 validation

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** |
| `git diff --check` | **PASS** |
| `pedestrians.test.ts`, `pedestriansQa.test.ts`, `pedestrianThinning.test.ts`, `pedestriansView.test.ts`, one vitest process through quietrun, `--maxWorkers=1` | **PASS, 70 of 70** (32 / 22 / 14 / 2) |
| The other tests that build a `CityObjectsView` (`garbageView`, `fireworks`, `exitRetention`, `newyear`, `newYearPacing`, `pacingProbe`), the same way | **PASS**, 48 passed, 6 skipped (`pacingProbe` needs `PACING_SAVE`) |
| 128x15 seed-7 bot through quietrun (`npx tsx tools/simbot.ts --size 128 --years 15 --seed 7`) | **identical**: 2015 residents **[61124, 93804, 37971] = 192,899** (the bot imports no render code) |
| Mutations of `Pedestrians.ts` against the four files (each written into the file, tsc and the four files run, the file restored byte for byte) | **19 of 19 caught**: round 2's fixed 80 cells a frame (14 tests fail), no 320 ceiling (2), no 80 floor (46), never abandon (3), round 1's restart after 3 cells (6), abandon at half the reach (1) or a cell late (1), the previous roster never giving way (19), `spiralIndex()` off by one on one side (1) or with two sides swapped (13), the previous roster cut from its near end (3) or kept in its stored order (8), no early drop of cells the search would not take (2), no cap on the two rosters (3), the quota by truncation (5), `thin()` keeping the highest ranks (6), no screen-edge grace (2), the grace in a full roster too (1), round 2's finds waiting for the whole search (8) |
| Full suite, browser, real-GPU timing | left for the lead, as before |

**Timing script.** `run_ab.sh` (the QA's one-command A/B, ~29 min now) has a fourth window, `pan30`: the 160 m circle
of the `pan` window at the keyboard's 132 m/s, with the page's animation frames throttled to 30 a second
(`pan30.mjs`), so the search's 160-cell slices are measured; `ab-tables.mjs` counts it in the verdict. The scripts
before the change are kept as `ab.pre-r3.mjs`, `ab-tables.pre-r3.mjs` and `run_ab.pre-r3.sh`. Checked without a
browser only: `node --check`, and a node simulation of the throttle (60 / 120 / 144 Hz displays: 28.9-30.1 frames a
second, never two within 30 ms, the pan at 132 m/s, the display rate restored afterwards). Vite serves the tree's
files, so the run measures this uncommitted round as well as a commit of it.

### Choices for the lead

1. **Leading-edge pop-ins remain** (above): a new cell's walkers appear up to half-way in from the leading edge at
   132 m/s. Removing them needs discovery to lead the camera (test cells against a frustum moved ahead by the
   camera's velocity times the search time, or scan the view's footprint first). Not done; say if wanted.
2. **The reach is the search's whole square (22 cells).** A jump inside it while a search runs waits for that search
   (up to 26 frames = 0.43 s at 60 fps, 13 at 30), as round 1 always did. A smaller reach would recover sooner from
   medium jumps but restart searches on fast zoomed-out pans (the keyboard pan at 300 m, 330 m/s, moves the camera 9
   cells a search).
3. **Zooming out past the spawn distance** drops the walkers beyond 338 m at the first frame of the next search rather
   than at its end, 0.43 s later. The end state is round 2's.

### Round-3 browser recheck list

- [ ] `pan30rt.mjs`, real frames at 30 fps, real keyboard, LOW, 56k city: the drawn average close to the 60 fps run
  (round 2: 5.2 against 20.1), no empty frame, pop-ins only near the leading edge, no burst at a roster swap.
- [ ] `pan2.mjs` jumps, 30 cells sideways at 12 moments, 60 and 30 fps: most walkers back within a few frames whether
  or not a search was running (N1: 27-45 frames, up to 49 at 30 fps).
- [ ] `pops.mjs`: still 0 a second at 07 / 21 / 03 h with the camera still; 03:00 at most 20 % (B1 unchanged).
- [ ] Caps 120 / 300 / 600 / 600 at the fullest 1.1M pose, the 350 / 600 m cuts, exactly one main-pass draw and none
  in the shadow pass; avenue poles (B2 unchanged).
- [ ] `run_ab.sh` in a clean slot: `Pedestrians.update` max and frames over 0.8 ms in every window, the new `pan30`
  included; frame CPU / GPU deltas at most 0.8 ms.
