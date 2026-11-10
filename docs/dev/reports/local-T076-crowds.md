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
