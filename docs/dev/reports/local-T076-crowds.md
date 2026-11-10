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
