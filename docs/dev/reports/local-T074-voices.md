# T074 — the city's voice and weather

The sections before “QA round 2” record the original implementation and its historical gates. The QA round-2
section supersedes their weather pacing, district sampling/fade limitations, and Vitest status. “Round 3” closes
T060 FEEL-01's QA findings F1–F3 in the news ticker (NOTE-077). “Round 4” at the end moves the weather calendar from
`src/render/world/Weather.ts` to `src/sim/economy/weatherCalendar.ts` (NOTE-081); it supersedes where the FEEL-23
sections place `weather(day, seed, climate)`.

Original status: typecheck and supplemental headless probes pass; the 128×15 seed-7 population is unchanged, and
all 20 yearly hashes match base on both Medium and Hard after the specified advice/news exclusions. Vitest cannot
start in this sandbox. Real-GPU/browser/audio checks remain for the lead. FEEL-13's literal dB bound down to exact
silence remains an explicit exception below, not a passed acceptance gate. Changes are uncommitted.

## FEEL-20 — headlines that react to events

Implemented 26 event headline types in `src/sim/economy/eventHeadlines.ts`. Building events queue completed openings,
first homes/shops/factories/towers and the 100th park; existing simulation news queues blackout, strike, strike-ended
and bankruptcy-averted stories; resolved emergencies queue a thank-you story. Gerald's original bag headline can lead
to his road repair and then his commemorative plaque. Event picks use a hash of the event, day and city seed: delay
is 1–10 days, each type has a rolling 360-day trigger/post cooldown, and no event draw touches `sim.rng`.

`src/sim/economy/advisors.ts` adds a separate feed initialization/daily call and the optional saved event record.
The existing flavor-headline schedule, `rng.int` and `rng.next` calls remain in place. Its existing 720-day flavor
repeat guard is stronger than FEEL-20's 360-day requirement. All new posts use ordinary `info` news with advisor
`news`; existing `Notifications.ts` applies FEEL-02a's automatic toast budget. Located openings use the existing
ticker camera flight.

Event data lives only under `systemData.advisors.events`. Before the first daily advisor pass, an event writes an
optional `{events}` envelope, without creating the normal flavor schedule early. Feed initialization restores that
envelope before the advisor's first daily pass creates its normal record, so saving while the new city is paused
does not lose an opening or move the first-headline day. Old saves without event data take a silent baseline.
Park counts represent cumulative openings since that baseline and persist across removal/load. The emergency
thank-you copy says the incident was resolved; it does not assert that there were no losses.

New test file: `tests/sim/eventHeadlines.test.ts` (13 tests):

- Ten seeded landmark openings each post within days 1–10, with clickable location coordinates.
- Construction completion, duplicate building changes and burnt buildings.
- One blackout story for repeated source notices; another only after the rolling-year cooldown.
- All 26 event types have distinct copy and never repeat text within 360 days.
- Stable hashes and unchanged simulation RNG state; ordinary flavor schedule/RNG draws with and without event news.
- Pending opening save/load before the first daily pass; JSON continuation and the older city's unchanged first-headline day.
- Silent old-save baseline, Gerald's ordered stories, and the 100th park across removal/save/load.
- Family firsts and actual residential/commercial towers are independent; industrial campuses never announce a tower.
- Farms never announce a factory or suppress the first actual factory.

Validation status at completion of this item:

- The final `npx tsc --noEmit` passes, including all new test files.
- Quiet-gated `npx vitest run tests/sim/milestoneNews.test.ts --maxWorkers=1` could not start: Vite's
  `externalize-deps`/`windowsSafeRealPathSync` subprocess failed with `spawn EPERM`. New/existing single-file test
  execution therefore remains unverified here.
- `npx tsx -e 'console.log(1)'` and the quiet-gated bot command could not start: `tsx` is absent and npm's cache-only
  mode returned `ENOTCACHED`. Subsequent direct-Node runs passed; exact commands and results are in the final gates section.
- Lead reruns, one at a time through the quiet gate:
  `npx tsx tools/simbot.ts --size 128 --years 15 --seed 7` (expected residents
  `[61124, 93804, 37971]`, total **192,899** in 2015), and
  `npx tsx tools/simbot.ts --size 256 --years 20 --seed 7` (compare every yearly state hash to base after omitting
  `news` and `systemData.advisors`, as required by FH-03). No simulation balance change is intended.

Plan/code differences and requests:

- The cited advisor line numbers have moved; the existing flavor block is now near the end of `daily()`.
- “Saves” are implemented as emergency rescues/resolutions. Manual file persistence has no simulation event and
  is not treated as an event in the city's world. No cloud-held save or worker change is required.
- Snow headline gating belongs to FEEL-23 below, when the shared pure weather function exists.
- No infra hunks and no out-of-scope source files in this item.

Browser checklist for the lead:

- [ ] Complete a landmark in ten seeded cities; its headline arrives within ten game days and clicking flies to it.
- [ ] Cause one blackout with repeated utility reports; exactly one delayed event story appears.
- [ ] Observe event stories over a game year: no event copy repeats inside 360 days; existing flavor copy retains its two-year guard.
- [ ] Save/load while paused immediately after a placement and while a delayed story is pending; both continuations post on the same day.
- [ ] Trigger many openings together and verify the existing toast budget still applies while news remains available in the ticker.

## FEEL-29 — rare sightings

Added five visitors in `src/render/city/Sightings.ts`: balloon flotilla, whale, visiting blimp, observatory light and
Gerald's ribbon cutting. A headline's map coordinates are also the rendered visitor's anchor, so the existing ticker
click flies to it. The renderer follows actual news, retains each visitor for 30 real seconds, and never respawns
an expired visitor from the same headline. It caches the news tail and current day instead of searching the log on
every frame. Reset/disposal releases every visitor geometry/material; disposal prevents later updates from rebuilding.

Pure helpers in `src/sim/economy/eventHeadlines.ts` choose a hash-based date in a fixed slot for each type, so the
five dates never collide. Each type repeats exactly 6,000 game days apart (more than 15 game years), giving at most
two in every rolling 30-game-year window, including across cycle boundaries. The advisor's separate daily call posts
the exact matching text/position on the scheduled day, with a saved guard against replay. There is no simulation RNG
draw, and no saved state outside `news` and `systemData.advisors` changes.

Whales require the largest edge-connected water body (at least 64 cells), a clear 5×5 patch and an actual visible
shore within eight cells. Inland ponds, narrow edge channels and an entirely water-covered map are skipped.
Observatory lights require a completed, unburnt observatory; Gerald requires a dry road. Missing habitats skip that
occurrence. Balloons and blimps need no facility. Observatory copy does not claim evening: simulation dates do not
contain the camera's independent day/night clock.

`src/render/world/WorldView.ts` adds small, separate constructor/update/reset/dispose calls for the visitor group.
No T073 smog hunks, building/effects renderer files or infra files are edited. This item's helper functions and the
earlier FEEL-20 module are task-owned; no source outside the named files is changed.

New test file: `tests/render/sightings.test.ts` (8 tests), using `THREE.Scene` without WebGL:

- All five visitors appear only with their headline and use its exact anchor.
- Thirty-second expiry, repeated-headline suppression, resource reset/disposal and disposed update suppression.
- Cached news discovery between day/tail changes.
- Ten seeds: unique dates, 6,000-day spacing and at most two sightings in rolling 30-year windows.
- Same-day located news and the advisors daily integration, duplicate-post guard and unchanged RNG state.
- Missing/invalid habitats; whale placement on open coastal water; pure helper leaves input state unchanged.

Final typecheck and supplemental sighting assertions pass. Vitest execution remains blocked by `spawn EPERM`.
The direct-Node bot population and both difficulties' yearly-hash comparisons passed (final gates below).
No cloud-held file request is needed for this item.

Browser checklist for the lead:

- [ ] See each of the five visitor models at its headline's coordinates and click the ticker to fly there.
- [ ] Confirm a whale is visibly off an actual coast, the light belongs to a completed observatory and Gerald is on a road.
- [ ] Confirm each model remains visible long enough to inspect after an ultra-speed packet, expires after 30 real seconds and does not restart from old news.
- [ ] Reload/reset and exit the city without lingering visitor meshes/resources or duplicate sighting news.
- [ ] Check the news log over 30 game years: each type appears at most twice, always with its corresponding visible visitor.

## FEEL-23 — weather that matches the headlines

Added `src/render/world/Weather.ts`: a pure `weather(day, seed, climate)` calendar with deterministic three-day
spells, spring/autumn rain, December–February temperate/alpine snow, tropical rain and desert haze. It imports
three only as a type, so simulation/headline imports do not pull the graphics runtime into the worker. The renderer
receives three through its constructor and uses one transparent, depth-tested point cloud with depth writes off:
256/512/768/1,024 particles on Low/Medium/High/Ultra. It reuses its geometry/uniforms and follows the camera target.

`src/sim/economy/advisors.ts` gates snowball/snow-day stories on actual snow days and April-showers stories on actual
rain days. Meteor and heatwave copy also checks the calendar. The existing scheduled RNG draws are retained.
`src/render/world/WorldView.ts` adds a separate weather update: precipitation, darker overcast sky/direct light,
roof snow, road wetness and desert haze. `src/audio/ambience.ts` adds one persistent filtered rain bed, smoothly
scaled by rain intensity/camera distance; `src/game/CityScene.ts` forwards the same calendar's rain value through
the existing half-second ambience tick and a reused parameter object.

Two minimal source hunks outside T074's named files are required for the requested visible surfaces:

- **`src/assets/materials.ts`**: optional cosmetic `uWeatherSnow`, bound in `patchSurfaceMaterial`, adds a dusting to
  upward-facing roof surface codes 3/4. The normal dry material is unchanged at zero snow.
- **`src/render/city/roads/roadMaterial.ts`**: optional cosmetic `uRoadWet`, bound into the existing road material,
  darkens asphalt/sidewalk albedo and lowers roughness during rain. Road roughness is generated inside that shader,
  so setting the material's ordinary roughness property would not implement the requested sheen.

Neither hunk changes geometry, simulation inputs or RNG. No `src/sim/infra/*`, cloud-held, building-renderer or
building-effects file is edited. The sky can be adjusted through existing exposed uniforms, so no `Sky.ts` edit is
needed. Plan/code difference: climate is an optional third argument to the named pure function, needed to distinguish
desert/tropical weather while preserving a two-argument temperate default.

New tests:

- `tests/render/weather.test.ts` (6 tests): ten-seed/two-year deterministic three-day calendar; climate/season rules;
  no random draw or runtime three import; forced headline bag across all dates/climates matches particle weather;
  quality caps, depth settings, reused seed buffer, untouched city/RNG data, resource cleanup and replica replacement;
  roof/road `onBeforeCompile` uniforms and shader expressions.
- `tests/audio/weatherAmbience.test.ts` (3 tests): rain gain crossfade/clamp/distance, stable audio source/node count
  over repeated parameter changes, and rain-source stop/processing-chain cleanup, using `MockContext`.

Final typecheck and `tests/t074-probe.mjs` pass, including all dates/climates for snow/rain copy, shader uniform
hooks, the High particle cap, rain gains and cleanup. These supplemental assertions are separate from the
blocked Vitest startup. The direct-Node bot results are recorded below.

Acceptance GPU timing (≤0.5 ms at 1080p High), the visual roof dusting/road sheen and actual rain-bed audibility
are **unverified**: the user reserved browser/real-GPU checks for the lead. No browser or audio rendering tool ran.
No additional cloud-held-file request is needed.

Browser checklist for the lead:

- [ ] On a forced/current snow day, see falling flakes and a roof dusting while the snow headline posts that same game day; no snow copy on clear/rain/haze days.
- [ ] On a rain day, see darker overcast sky and wet-road sheen and hear the rain bed; all fade with the same weather calendar.
- [ ] Check desert haze and tropical rain without snow, across season boundaries and after load/reset.
- [ ] Measure incremental GPU cost at 1080p High: at most 0.5 ms for weather, with no more than 768 precipitation points.
- [ ] Compare yearly bot hashes outside `news`/`systemData.advisors` and confirm the unchanged 128×15 s7 resident totals.

## FEEL-13 — hear the camera's district

`src/audio/ambience.ts` adds a read-only, clipped 7×7 land-use sample. It counts facility footprint cells,
industrial/commercial/high-density zones and rail cells, using only the mirrored building map and grid arrays.
The caller supplies the output object. Below 700 m it reads each of the 49 interior cells once per input grid;
above that boundary it retains the last local mix and applies a distance fade, reaching −18 dB at 1,500 m and
continuing downward above it. Empty/outside samples clear the mix. Completed park, airport, seaport/ferry and
train/freight definitions take precedence over their underlying zones; incomplete/burnt facilities do not count.

Four district beds reuse existing sources and add exactly six persistent processing nodes: an industry gain fed by
the traffic/drone source, a moving bandpass and gain for a distant playground/chatter texture, a crowd gain fed by
the existing city murmur, and a transport bandpass/gain fed by existing wind noise. The playground texture suggests
distant voices through moving formants; it contains no recorded or intelligible speech. Industrial districts have
the low mechanical thrum, downtown has the murmur, and transport combines airport jet swells, low rail rumble and
harbour wash. Jet swells recur every 30–60 audio seconds using the independent audio random stream. Train/harbour
horns and harbour gulls replace the existing horn/gull scheduler's contextual choice, rather than adding another
concurrent scheduler or source family. Contextual horn/gull gains include the same distance attenuation. Existing
construction and base seasonal/weather ambience retain their behavior. Both new people beds are halved at night.

`src/game/CityScene.ts` adds one separate call in `updateAmbience`, using `this.host.state` and caller-owned mix/
parameter objects on the existing half-second timer. The existing optional `setAmbience` API forwards the district
mix alongside FEEL-23's rain value. No new simulation mutation, saved key or simulation RNG draw is introduced.
No infra, cloud-held or out-of-scope source file is touched by this item.

District gain retargets anchor their current automated value, then crossfade over 1.5 s. Above gain 0.045
(approximately −26.9 dB in the gain control), log ramps change no faster than 1 dB per 100 ms. Linear tails below
that explicit threshold reach actual silence continuously. **The literal acceptance limit at every gain down to
zero is not claimed:** a finite crossfade to/from zero has unbounded dB change near silence. The threshold is a
documented measurement boundary, not a measured audibility guarantee. The live/offline rendered audio still needs
the lead's judgment and measurement; the unit test does not hide this distinction.

New test file: `tests/audio/districtAmbience.test.ts` (8 tests):

- Exact 49-cell reads, edge clipping, out-of-map clearing, caller object reuse and no high-altitude resampling.
- Facility footprint/zone/rail classification and input immutability, including burnt and incomplete facilities.
- Host-state wiring and allocation-free sampler source structure.
- All six district families switch the dominant one of four beds within 1.5 s, without a gain discontinuity.
- People gains are exactly halved at night; every bed's settled gain is at least 18 dB lower at/above 1,500 m.
- Exactly six extra persistent processors, unchanged source count, stable nodes through two minutes of changes,
  and processing-chain cleanup.
- Two minutes of continuous gain retargets; 100 ms log-gain checks above the explicitly documented quiet tail.
- Jet intervals of 30–60 audio seconds and contextual use of the existing gull/train/harbour horn scheduler.

Final typecheck and supplemental district assertions pass: 49-cell sampling, district dominance, night scaling,
settled distance attenuation, six persistent processors and two minutes of gain retargeting above the stated floor.
Transient voice methods are stubbed for that allocation probe; peak native node counts including contextual
horn/gull overlap still need the audio renderer. No rendered-audio acceptance result is claimed.

Exact audio-lab follow-up: in `src/audio/lab/main.ts`, `renderAmbience()`, add a 120-second moving-district scenario
that feeds `Ambience.set({district})`, logs all four `districtLevel()` gains every 100 ms and records native node
counts; expose that scenario through `tools/render-audio.mjs`. Report the quiet-tail boundary separately. These
out-of-scope lab/tool files are unchanged. This is not a request for any cloud-held source file.

Plan/code differences: six land-use signatures share four simultaneous beds, keeping the six-node cap. The existing
camera-control distance is the height proxy already used for ambience zoom; this change does not introduce a new
camera-height convention. The zero-gain dB limit and missing lab scenario are explicit verification limitations.
There are no requests for cloud-held files.

Browser/audio checklist for the lead:

- [ ] Move below 700 m between industry, parks/playgrounds, downtown, airports, rail and harbour; the dominant bed switches within two real seconds, including the half-second sampling delay.
- [ ] Hear the playground chatter/birds, city crowd, industrial thrum, 30–60-second airport jet swells, rail rumble/horn and harbour gull/horn; assess their procedural sound quality.
- [ ] Compare identical park/crowd views by day/night: the location people beds halve at night.
- [ ] Above 1,500 m, measure at least 18 dB attenuation of every new location bed and contextual accent.
- [ ] Render two minutes of district movement: six extra processing nodes, continuous fades and the measured 100 ms gain changes, reporting the quiet-tail exception explicitly.
- [ ] Exit/restart or replace the city while ambience is active; no lingering district graph, extra source family or stale map reads remain.

## Final gates and handoff

All processes ran from this worktree, one at a time. Every Vitest/bot attempt used
`node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs`.
No browser, full suite, bench, commit, branch/worktree operation or `.done` file was used. Diagnostic results are
recorded here; the supplied scratch directory is outside this session's writable root.

| Gate | Observed result |
|---|---|
| `npx tsc --noEmit` | Pass, final source and new test files |
| `git diff --check` | Pass |
| `node --experimental-transform-types --loader ./tests/t074-loader.mjs tests/t074-probe.mjs` | Pass: event/continuation, sightings, weather/headline dates, shaders, rain and district assertions |
| 128×15 s7 Medium | **192,899** in 2015; residents **[61124, 93804, 37971]**, unchanged |
| 256×20 s7 Medium, base versus branch | **20/20 yearly hashes identical**; 2020 **283,841**, residents **[100754, 124171, 58916]** |
| 256×20 s7 Hard, base versus branch | **20/20 yearly hashes identical**; 2020 **236,633**, residents **[96469, 99918, 40246]** |
| Vitest | Startup blocked by `spawn EPERM` in Vite's `externalize-deps` / `windowsSafeRealPathSync`; no tests claimed passed |
| Weather GPU / browser / rendered audio | Left to lead; no measurements fabricated |
| Literal FEEL-13 1 dB / 100 ms limit to zero | **Not met in the linear near-silence tails**; bounded above gain 0.045 only |

Exact successful bot command:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types --loader ./tests/t074-loader.mjs tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

The requested `quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7` was also attempted; `tsx` is not
installed/cached and npm returned `ENOTCACHED`. The successful command above uses Node 22's native TS transform
and a small extension resolver; it neither changes bot rules nor installs packages.

`tests/t074-audit.mjs` uses the same `SimBot`, full systems and default flags, hashes `serializeCity(copy: true)`
with sorted object keys and raw typed-array bytes, pins only `savedAt`, and omits only `data.news` and
`data.systemData.advisors`. Base and branch ran in separate processes. For the base process, the loader's
`T074_BASE_ADVISORS` pointed to a temporary UTF-8 copy of `git show 1c2019c:src/sim/economy/advisors.ts`; that fixture
has been removed. This is sufficient because advisors is the only pre-existing simulation source edited here.
Exact audit commands (each run once with the base override, then without it):

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types --loader ./tests/t074-loader.mjs tests/t074-audit.mjs --size 256 --years 20 --seed 7 --difficulty medium
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types --loader ./tests/t074-loader.mjs tests/t074-audit.mjs --size 256 --years 20 --seed 7 --difficulty hard
```

2020 digests, equal on base and branch:

- Medium: `bc25b9dd5a8cc60f456ac96b24a610664822c0ebc17356be98893f9229d503b4`
- Hard: `135ac001b54df647b80f06dc1201b2b63a19b779d6ddb9e7371ec1c3ac46ba38`

New Vitest files awaiting execution (38 tests): `tests/sim/eventHeadlines.test.ts`, `tests/render/sightings.test.ts`,
`tests/render/weather.test.ts`, `tests/audio/weatherAmbience.test.ts`, `tests/audio/districtAmbience.test.ts`.
Quiet-gated startup failures were observed for `milestoneNews`, `eventHeadlines` and `sightings`; a final
`districtAmbience` attempt waited behind an active timing run and its own waiting process was cancelled. No other
process was stopped. Run each file through the quiet gate with `npx vitest run <file> --maxWorkers=1`.

Existing directly affected tests left for the lead, by name:

```text
tests/audio/ambience.test.ts
tests/game/cameraControls.test.ts
tests/game/cityDisposeCanvas.test.ts
tests/game/citySaves.test.ts
tests/game/fallbackRetention.test.ts
tests/game/graphicsFirstRun.test.ts
tests/game/graphicsRestore.test.ts
tests/game/miniMapSeason.test.ts
tests/game/quakeShakePlop.test.ts
tests/game/thumbsRetention.test.ts
tests/game/toastBudget.test.ts
tests/game/zoneStatus.test.ts
tests/infra/feedbackGarbage.test.ts
tests/render/exitRetention.test.ts
tests/render/freshLoad.test.ts
tests/render/lighting.test.ts
tests/render/pendingPreviews.test.ts
tests/render/seasons.test.ts
tests/sim/advisors.test.ts
tests/sim/advisorsFeedback.test.ts
tests/sim/advisorsPredict.test.ts
tests/sim/advisorsRuins.test.ts
tests/sim/advisorsScanOrder.test.ts
tests/sim/advisorsTexts.test.ts
tests/sim/exact/advisorsScan.test.ts
tests/sim/foundingDay.test.ts
tests/sim/milestoneNews.test.ts
tests/sim/monthSpread.test.ts
tests/sim/taxHighAdvice.test.ts
tests/worker/hygiene.test.ts
tests/worker/worldResync.test.ts
```

No simulation balance change is intended. No infra hunks or cloud-held file edits/requests. The only out-of-task
source hunks are the two small shader hooks listed in FEEL-23. Full-suite, GPU and audio/browser acceptance checks
remain with the lead, using the item checklists above.

## QA round 2 — B1–B11

Read the complete `qa_round1.md` against lane HEAD `8846fa8`, including the merged T057 save/load and T060 ticker
code. This section supersedes the original status above. All changes remain uncommitted. No simulation RNG draws,
balance edits, infra hunks, worker/save changes, or cloud-held-file requests.

### FEEL-20 — B4, B6, B10

- `eventHeadlines.ts`: 28 event types now include separate library and museum copy. Named facility openings wait
  for completion, an intact/nonabandoned lot and edge road access; adding a road starts the usual 1–10-day delay.
  Posting rechecks access and cancels bulldozed lots. Optional `events.waiting` IDs preserve newly completed roadless
  facilities across saves. Legacy pending records without a building ID recheck the building at their coordinates.
  Old saves without event data still take a silent baseline. Blackout retrospectives remain pending while
  `powerSupply <= 0`, then post after power returns.
- **Outside the original named source files:** `Notifications.ts` has small B4/B9 hooks. Overflow drops the oldest
  event story before ordinary good/reward news. Existing FEEL-01 rotation, arrival order, clause formatting, hold
  timing and toast budget are preserved; event news remains `info` from the news desk and adds no toast path.
- Tests: `eventHeadlines.test.ts` **17 passed**; `eventTicker.test.ts` **4 passed**, including ordinary good/reward
  retention through event bursts. Existing `newsTicker.test.ts` **20 passed**.

### FEEL-29 — B8, B9

- `Sightings.ts`: construction/reset baselines the actual existing news objects. Only subsequently posted headlines
  can spawn a visitor, including new posts on the same game day. Load, re-entry and reset no longer replay old news.
  `WorldView.ts` passes the state into construction/reset. The 30-real-second visitor lifetime is unchanged.
- `eventHeadlines.ts`: balloons and blimps anchor to a built-up cell nearest the area-weighted centre of completed,
  intact buildings, so a coastal city's map-centre water cell is not chosen. Empty cities retain the map-centre
  fallback. `Notifications.ts` passes per-kind ticker focus distances: balloons/blimp 700 m, Gerald 150 m, whale
  350 m, observatory 450 m.
- Tests: `sightings.test.ts` **10 passed**, including old-news baselines, same-day new arrivals, coastal anchors,
  persistence guards and deterministic scheduling; `eventTicker.test.ts` exercises the focus distances.

### FEEL-23 — B1, B2, B11 and the two public seams

- `Weather.ts` keeps its pure deterministic three-game-day calendar. A separate presentation holds its chosen target
  for **20 real seconds**, then eases rain/snow/haze with a **4-second time constant**. Ultra-speed dates cannot
  change that target faster. Initial entry/load starts on that city's current weather; an explicit reset prevents
  carrying a prior city's envelope across a load. New same-day snow headlines receive a small particle-only
  cue lasting four real seconds while the broad lighting, surface and audio envelope continues smoothly. Thus snow
  copy still has visible flakes on its game day without reintroducing whole-frame luminance or rain-bed pulses.
  Rain particles, roads and bed always use the shared eased amount, including when an April headline arrives
  during a clear hold. Headline dates follow the deterministic calendar; broad visible weather follows real-time holds.
- The one reused point cloud has distance-scaled width/height and perspective-scaled, capped point sizes at 120 m
  and 300 m. Its footprint caps at 1,200 m, fading beyond 1,500 m to zero at 2,500 m. Rain/snow subsets share the
  same draw call; High remains capped at 768 points. Night RGB falls to 8% of daytime. No extra geometry, draw
  pass, shadow sample count or audio source is added by this round.
- `WorldView.ts` uses the shown amounts for wet roads, roof snow, haze and overcast. Overcast increases the existing
  shadow filter radius and fill, while reducing direct/environment light. Optional ground snow tint was left out;
  the existing roof dusting remains. GPU cost and native appearance need the lead's measurement.
- `CityScene.ts` now feeds audio the **shown** rain via `world.rainAmount()` on the existing half-second ambience
  tick, rather than sampling the fast calendar independently.
- **Pedestrian hook:** public `Weather.rainAmount()` and `Weather.isRaining()`; the former is also bridged through
  `WorldView.rainAmount()`. **Outside the original named source files:** `render/contracts.ts` adds the optional
  `WorldViewApi.rainAmount()` signature, preserving stand-in views. The pedestrians lane can pass
  `getRain: () => world.rainAmount()` without an import from that lane.
- **Reduced-flashing hook:** `Weather.flashAmount(strength, reducedFlashing)` is the single gate for future flash
  contributions and returns zero when gated. Weather currently generates no lightning or other flashes; this round
  does not add a setting or import the settings lane.
- Tests: `weather.test.ts` **6 passed**, `weatherPacing.test.ts` **9 passed**, `weatherAmbience.test.ts` **4 passed**.
  They cover all headline dates/climates, 1x/2x/ultra presentation, the real-time hold, per-frame sun-intensity
  changes below 1%, same-day headline flakes, volume/night/far uniforms, overcast lighting, city reset, rain-audio
  continuity and hooks. Actual GPU timing/visibility and sound remain native QA checks.

### FEEL-13 — B3, B5, B7

- `ambience.ts` samples the current 7×7 district at every distance; the existing distance factor supplies the fade.
  Zone contributions require a completed, unburnt building, and farms never contribute industry. Bare rail remains
  a transport signature. The sampler still reuses caller scratch and reads only the host replica.
- Every positive-to-positive district gain change now uses an exponential ramp bounded to **10 dB/s**, including
  sparse/far targets below the old 0.045 threshold. Native `cancelAndHoldAtTime` preserves the old ramp on retarget;
  exact audio-clock envelope anchors avoid stale `.value` and the one-sample mid-rise dip. Silence boundaries alone
  step at `min(target, 0.0064)`, with the final step to zero 20 ms after the exponential tail. This replaces every
  old linear tail. The six-extra-processor budget is unchanged.
- The boundary is −29.90 dB relative to the maximum 0.2 local gain. Its audibility must be checked in the native mix;
  this is not a universal dBFS claim. Every positive target below that boundary is still ramped at the full bound.
  Settled dense beds cross within 1.5 s, or 2 s including sampling. A universal 2 s dominance guarantee for arbitrary
  tiny positive incoming targets conflicts with the strict rate bound: 0.2 versus 0.0000002 requires 6 s at equal
  opposing 10 dB/s slopes. This implementation preserves the rate bound and avoids overshooting sparse targets.
  That extreme case is a remaining plan/acceptance conflict, not a claimed universal two-second pass.
- Tests: `districtAmbience.test.ts` **11 passed**: every-altitude sampling, completed zones/farms, dense crossover,
  night/distance gains, six processors, two-minute positive-gain ratios at all levels, tiny targets, exact retarget
  samples and jet/contextual accents. `mockAudio.ts` now preserves exponential hold curves; the older
  `ambience.test.ts` stub gains one hold method. These minimal existing-test-support hunks are outside the original
  new-tests-only list and model the native automation required by B7.

### Gates and remaining desktop checks

`npx tsc --noEmit` passed. The standard quiet-gated Vitest command still hits `spawn EPERM` in Vite's Windows config
resolver, and native config with the default fork pool hits the same sandbox restriction. Native config plus a
single **thread** worker succeeds. Every file below ran separately and serially through the quiet gate:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types node_modules/vitest/vitest.mjs run <file> --maxWorkers=1 --configLoader native --pool=threads
```

**44 files, 457 tests passed** (unique files and final case counts; one initial rain-test settling tolerance was
corrected before its passing run):

```text
tests/audio/ambience.test.ts
tests/audio/background.test.ts
tests/audio/director.test.ts
tests/audio/districtAmbience.test.ts
tests/audio/ducking.test.ts
tests/audio/oneShot.test.ts
tests/audio/weatherAmbience.test.ts
tests/game/cameraStart.test.ts
tests/game/cameraControls.test.ts
tests/game/cityDisposeCanvas.test.ts
tests/game/citySaves.test.ts
tests/game/cityTeardown.test.ts
tests/game/emergencyBanner.test.ts
tests/game/eventTicker.test.ts
tests/game/fallbackRetention.test.ts
tests/game/graphicsFirstRun.test.ts
tests/game/graphicsRestore.test.ts
tests/game/inspectorRetention.test.ts
tests/game/newYearPacing.test.ts
tests/game/newyear.test.ts
tests/game/newsTicker.test.ts
tests/game/notificationsQuestion.test.ts
tests/game/panelsNews.test.ts
tests/game/quakeShakePlop.test.ts
tests/game/rewardToast.test.ts
tests/game/settingsSchema.test.ts
tests/game/thumbsPendingRetention.test.ts
tests/game/thumbsRetention.test.ts
tests/game/toastBudget.test.ts
tests/game/uiSoundsRetention.test.ts
tests/game/views.test.ts
tests/render/cutShadows.test.ts
tests/render/exitRetention.test.ts
tests/render/pendingPreviews.test.ts
tests/render/seasons.test.ts
tests/render/shadows.test.ts
tests/render/sightings.test.ts
tests/render/weather.test.ts
tests/render/weatherPacing.test.ts
tests/sim/breakdownRetention.test.ts
tests/sim/eventHeadlines.test.ts
tests/worker/hygiene.test.ts
tests/worker/localSimHost.test.ts
tests/worker/worldResync.test.ts
```

The requested bot command was attempted through the quiet gate:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

`tsx` is absent and npm returned `ENOTCACHED`. The same bot ran with Node 22 native TypeScript transformation and an
inline extension resolver (no repository helper, install, bot edits or strategy flags). Reproducible PowerShell:

```powershell
$weatherLoaderSource = @'
export async function resolve(specifier, context, next) { try { return await next(specifier, context); } catch (error) { if (specifier.startsWith('.') || specifier.startsWith('file:')) { for (const suffix of ['.ts', '/index.ts']) { try { return await next(specifier + suffix, context); } catch {} } } throw error; } }
'@
$weatherLoader = 'data:text/javascript,' + [uri]::EscapeDataString($weatherLoaderSource)
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types --loader $weatherLoader tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

Observed 2015 residents **[61124, 93804, 37971] = 192,899**, unchanged. News differs by design. No new Medium/Hard
state-hash comparison, full suite, browser, real-GPU timing or native audio render ran this round. The lead's reported
2,469-test/full-bot pass is the pre-round baseline, not a result claimed for these edits. No larger bot run is needed
for these QA fixes; the original yearly hash audit and full suite remain with the lead. Bot output/result is recorded
here; the supplied external scratch folder is outside this session's writable workspace.

Browser/audio checklist for round 2:

- [ ] B1: watch rain/snow/clear transitions at 1x, 2x and ultra for a few minutes: no luminance steps or rain-bed
  pulsing, targets hold at least 20 real seconds, surfaces/audio ease together; paused load/reset uses the loaded city.
- [ ] Snow headlines and flakes appear on the same game day; rain gives road sheen and a sustained rain bed.
- [ ] B2/B11: inspect precipitation at 120 m, 300 m, 1,500 m and far out, by day and night; no glowing points,
  softer overcast shadows, roof dusting, and at most **0.5 ms incremental GPU at 1080p High**.
- [ ] B3/B5: move between completed industry, farms, empty zones, parks, downtown, rail, harbour and airports at
  300 m, 900 m and 1,500 m; the district follows the camera and location beds settle at least 18 dB down at 1,500 m.
- [ ] B7: render two minutes of district movement with sparse/distant targets and mid-rise retargets; measure every
  positive 100 ms gain interval, check the silence boundary's audibility and six extra processors; assess the noted
  extreme-density two-second dominance conflict. People beds halve at night; jets remain 30–60 audio seconds apart.
- [ ] B4/B6/B10: burst openings alongside ordinary good/reward news; retain ordinary ticker entries/FEEL-01 clauses
  and toast budget; no recovery story before grid power returns; libraries/museums use their own copy; connect a
  roadless completed facility, remove/reconnect its road before posting, and save/load both pending cases.
- [ ] B8/B9: load/re-enter with old sighting news and see no returning visitor; post each new sighting, confirm its
  30-real-second lifetime, airborne built-up anchor and useful per-kind ticker camera framing; disposal leaves no mesh.
- [ ] Repeat original event-delay/repeat-guard, 30-year sighting-frequency and weather-climate checks; compare bot
  hashes outside `news`/`systemData.advisors` and retain the exact seed-7 resident total above.

## Round 3: closes T060 FEEL-01's QA findings F1-F3 (NOTE-077)

Base: `local/T074-voices` at `a76b9a4` (current dev merged in, full gate green). The real-GPU QA of dev's news ticker
(`qa/cloudT057T060/qa.md`, T060 FEEL-01) failed it on F1 and F2 and found F3 in the lane's own tool. NOTE-077 folds
the three into this lane because it already edits `src/ui/Notifications.ts`. All changes are uncommitted. There is
no logic, random draw, balance, save or worker change, and `src/game/CityScene.ts` and every cloud-held file are
untouched. Vitest and tsx start normally in this session, so every command below is the standard one through the
quiet gate.

### Changes per file

**F1, a clause that ended on "incl."**

- `src/ui/Notifications.ts` (`NOT_A_STOP`, `:45`): `incl`, `approx`, `est`, `max`, `min` and `etc` join the nine
  abbreviations whose ". " is no sentence end. They match whole words, as before: "contest." still ends a sentence.
  Old saves keep "incl." summaries in their news log, and this is what fixes those.
- **`src/sim/infra/disasters.ts` (an infra file: four one-line text hunks, nothing moved):** "including" for "incl."
  in the tornado (`:360`), earthquake (`:390`) and meteor (`:441`) summaries, and in the header comment that quotes
  the tornado's (`:22`). No logic and no random draw.
- **Outside the named files, minimal:** `tests/infra/feedbackRuins.test.ts` (7 lines) and
  `tests/sim/advisorsRuins.test.ts` (2 lines) assert the summary texts, so they follow the wording. The pinned
  tornado of `feedbackRuins` (its path, the burnt ids, the disasters' random stream) is unchanged.

What the ticker shows now; the tooltip, the toast and the news feed keep the whole text:

| Summary | Clause in the ticker |
|---|---|
| `Tornado: 15 buildings destroyed, including your Fire Station, Medical Clinic, 2 Elementary Schools and 6 more — bulldoze the rubble and rebuild.` | `Tornado: 15 buildings destroyed, including your Fire Station, Medical Clinic, 2 Elementary…` |
| `Earthquake! Magnitude 6.4: 24 buildings destroyed (including your Fire Station, Medical Clinic, 2 Elementary Schools and 6 more), 3 fires, people trapped in 2.` | `Earthquake! Magnitude 6.4: 24 buildings destroyed (including your Fire Station, Medical…` |
| `Meteor strike! 15 buildings destroyed, including your Fire Station, Medical Clinic, 2 Elementary Schools and 6 more.` | `Meteor strike! 15 buildings destroyed, including your Fire Station, Medical Clinic, 2…` |
| `Tornado: 16 buildings destroyed, including your Fire Station — bulldoze the rubble and rebuild.` | `Tornado: 16 buildings destroyed, including your Fire Station` |
| An old save's `Meteor strike! 15 buildings destroyed, incl. your Fire Station, Medical Clinic, 2 Elementary Schools and 6 more.` | `Meteor strike! 15 buildings destroyed, incl. your Fire Station, Medical Clinic, 2…` (it was `Meteor strike! 15 buildings destroyed, incl.`) |
| An old save's `Earthquake! Magnitude 6.4: 24 buildings destroyed (incl. your Fire Station, Medical Clinic, 2 Elementary Schools and 6 more), 3 fires, people trapped in 2.` | `Earthquake! Magnitude 6.4: 24 buildings destroyed (incl. your Fire Station, Medical…` (it was `Earthquake! Magnitude 6.4: 24 buildings destroyed (incl.`) |

**F2, the ticker's clock ran 7-23 % fast**

- `src/ui/Notifications.ts`: `NewsTicker.frame()` (`:389`) steps by the real time since the frame before and by
  nothing else; `Math.max(dt, real)` is gone. The step limit stays: `MAX_STEP_S`, 1 s a frame. The clock is
  injectable through a third constructor argument, `now: () => number` (`:173`, `performance.now` by default), as
  `NewYearCelebration` and `SimCore` have one. `frame(_dt?)` keeps an optional parameter that it does not use, so
  `CityScene` still calls `this.ticker.frame(dt)` and that shared file needs no hunk. The first frame starts the
  clock; it used to count the scene's dt. Newest first, the 0.5 s entry, the hover hold, the queue and round 2's
  burst order are untouched code. The private fields QA's scripts read (`clock`, `cur`, `queue`, `list`) keep their
  names.
- Existing tests that drove the ticker with `dt` now step its clock:
  - `tests/game/newsTicker.test.ts`: `make()` injects the clock, so the `performance.now` spy is gone; its frames
    still pass the scene's dt. One assertion sat exactly on the end of a turn and now allows the one frame the
    acceptance allows.
  - `tests/game/eventTicker.test.ts` (this lane's, round 2): the injected clock replaces the spy.
  - `tests/game/views.test.ts` (dev's; **outside the named files**): it called `frame(6)` on a clock that had moved
    1.1 s. Each headline now arrives after the one before it has had its 5 s, in frames of at most 1 s.
  - `tests/game/panelsNews.test.ts` (dev's; **outside the named files**): it called `frame(1 / 60)` with no clock at
    all. Its helper now injects one and returns a `frame()` that is 1/60 s later.

**F3, the tool's check B2 could pass without testing**

- `tools/qa-ticker.mjs`: a `watchTurn(text)` helper (`:178`) watches the 200-character item frame by frame from the
  moment it shows to the end of its turn, as check C watches its headlines. B2 (`:256`) passes only when all of this
  holds: the item was seen as the current one; its end was out of view at first; its start and then its end came
  into the view's opaque part; its transform never moved back; its end was still in view on the last frame of its
  turn; and the turn ended within 60 s. The 3.5 s sleep and the `: true` fallback are gone. The end screenshot is
  taken when the end is in view.

### Tests

`npx tsc --noEmit` passes on the final tree, and `git diff --check` is clean. Every test file ran alone, one process
at a time:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run <file> --maxWorkers=1
```

**36 files: 514 tests passed, 9 skipped, none failed.**

New tests, all in `tests/game/newsTicker.test.ts` (20 tests before, 35 now):

- `QA F1: a disaster summary that names the facilities it destroyed is never cut at an abbreviation`: the three
  summaries with the facilities QA saw, in the new wording and as old saves hold them; the five other abbreviations;
  whole-word matching.
- `QA F1: the summaries the sim posts when a tornado, an earthquake and a meteor destroy city facilities`: the texts
  come from the real disasters system. Each clause is the start of its summary and reaches the facilities, and in the
  ticker the tooltip has the whole summary.
- `FEEL-01 QA F2: the ticker runs on real time alone, whatever the frame jitter and the game speed` (13 tests):
  - `a 5 s hold lasts 5 s and a burst's 3 s hold 3 s, each within one frame: <profile>`, six profiles;
  - `the 0.5 s entry, the 1 s rests and the 60 px/s scroll run on that clock: <profile>`, six profiles;
  - `a frame takes at most 1 s of real time, hover holds the clock, and the scene's dt never moves it`.

  A profile is a frame loop as `CityScene` makes it: seeded jitter in the time between rAF timestamps and in how far
  into its frame the ticker runs, the game's calendar running at that speed, and the scene's dt passed in. The six:
  paused; 1x; 2x; ultra, with every 25th frame 90 ms longer; ultra at 160 frames a second; 1x on a slow machine
  (120-240 ms frames, so the scene clamps its dt at 0.1 s).
- The F2 tests see the bug. With the old stepping put back for one run, those 13 fail and the other 22 pass: the 5 s
  hold lasts 4.90 s paused, 4.71 s at 1x, 4.63 s at 2x, 4.62 s at ultra, 4.63 s at 160 frames a second and 4.998 s
  on the slow machine.

The ticker and `Notifications.ts` (17 files: 213 passed, 7 skipped):

| File | Result |
|---|---|
| `tests/game/newsTicker.test.ts` | 35 passed |
| `tests/game/eventTicker.test.ts` | 4 passed (round 2's burst order and focus distances) |
| `tests/game/tickerProbe.test.ts` | 3 skipped (it needs `TICKER_SAVE`; with a save, see below) |
| `tests/game/views.test.ts` | 3 passed |
| `tests/game/panelsNews.test.ts` | 5 passed |
| `tests/game/graphicsRestore.test.ts` | 10 passed (the scene loop with a stand-in ticker) |
| `tests/game/toastBudget.test.ts` | 10 passed |
| `tests/game/notificationsQuestion.test.ts` | 6 passed |
| `tests/game/rewardToast.test.ts` | 7 passed |
| `tests/game/cityTeardown.test.ts` | 4 passed |
| `tests/game/emergencyTeaching.test.ts` | 35 passed |
| `tests/game/emergencyTeachingToasts.test.ts` | 12 passed |
| `tests/game/graphicsFirstRun.test.ts` | 21 passed |
| `tests/game/pacingProbe.test.ts` | 4 skipped (the toast pacing probe; it needs `PACING_SAVE`) |
| `tests/game/storageDialog.test.ts` | 32 passed |
| `tests/worker/emergencyTeachingHost.test.ts` | 11 passed |
| `tests/worker/hygiene.test.ts` | 18 passed |

Disasters, determinism and news texts (19 files: 301 passed, 2 skipped). `tests/sim/exact/` has no test of the
disasters system itself; the tests that pin tornadoes, earthquakes and meteors are the first three rows and `hosts`.

| File | Result |
|---|---|
| `tests/infra/feedbackRuins.test.ts` | 11 passed (the pinned tornado: path, burnt ids, random stream) |
| `tests/sim/advisorsRuins.test.ts` | 19 passed |
| `tests/save/continuity.test.ts` | 2 passed (a tornado and an earthquake across a save: same path, damage and next rolls) |
| `tests/infra/environment.test.ts` | 10 passed |
| `tests/infra/treesDamaged.test.ts` | 3 passed |
| `tests/worker/hosts.test.ts` | 5 passed (a scripted tornado: equal full-save hashes on the three hosts) |
| `tests/worker/replicaLive.test.ts` | 2 passed, 2 skipped (its own skips) |
| `tests/render/terrainRects.test.ts` | 16 passed |
| `tests/render/terrainReplica.test.ts` | 1 passed |
| `tests/render/terrainGrowth.test.ts` | 1 passed (60 years of the 128 bot city with disasters on; 317 s) |
| `tests/infra/emergency.test.ts` | 25 passed |
| `tests/infra/fireDuplicates.test.ts` | 12 passed |
| `tests/sim/exact/fireList.test.ts` | 7 passed (exact: the fire system's `disaster` and `news` event streams) |
| `tests/sim/eventHeadlines.test.ts` | 17 passed |
| `tests/sim/milestoneNews.test.ts` | 10 passed |
| `tests/sim/advisorsTexts.test.ts` | 6 passed |
| `tests/game/uiRuins.test.ts` | 11 passed |
| `tests/game/uiRubble.test.ts` | 6 passed |
| `tests/game/guideCopy.test.ts` | 137 passed |

`tests/game/tickerProbe.test.ts` with a real city, for information. The save is
`C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/qa/T053/cities/big_s7_y60.city.metropolis`,
the 256 seed-7 bot city in 2060 with 1.51M residents. `TICKER_ONLY=1x` and `TICKER_ONLY=2x` passed, one test each:

```text
[ticker probe] 1x: 266 s, 55 items (15 gave way, 0 still waiting at the end), visible after: median 4.9 s, p90 10.3 s, max 11.0 s
[ticker probe] 1x: 10 headlines, visible after 5.1 4.4 6.6 5.4 3.6 5.8 10.9 11.0 5.4 4.9 s; longest run within 15 s: 10
[ticker probe] 2x: 111 s, 67 items (30 gave way, 12 still waiting at the end), visible after: median 6.8 s, p90 13.0 s, max 14.3 s
[ticker probe] 2x: 10 headlines, visible after 5.1 9.5 7.0 13.0 7.6 9.1 13.0 14.3 11.9 10.6 s; longest run within 15 s: 10
```

The probe's frame time is its clock, so F2 does not move these numbers: the 2x line is the same with the old
stepping put back.

### Bot and digests

```text
SIMBOT_LOG=1 node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

`residents [ 61124, 93804, 37971 ]` = **192,899** in 2015, unchanged (funds $146k, 2,818 buildings, approval 81,
loans 0, unlocked 38). The same command ran on the clean tree before any edit and on the final tree. With the
run-to-run timings removed (the `done in` time, the `ms/day` line and the two ms columns of the year rows), all
1,187 lines of the two outputs are identical: the 15 year rows, the 1,111 lines of the action log, the last income
and expense and the last news. The bot plays with disasters off, so none of the three summaries is in its news.

For the wording itself a scratch probe ran 16 scripted disasters before and after the change in `disasters.ts`:
tornado, meteor and earthquake over the `feedbackRuins` town and over four seeds of its landmark town on the infra
systems, and a tornado, an earthquake and a meteor in one town over 60 days on all of the game's systems
(`createSystems()`). In all 16 the saved city without its news has the same SHA-256, the news list with the wording
put back has the same SHA-256, the news count is the same and `systemData.infraDisasters.rng` is the same. 17
summaries changed from "incl." to "including" and none still says "incl.". Two runs before the change gave the same
file, so the probe is deterministic. The first scenario's random stream ends at 2831950729, the value
`feedbackRuins` pins.

The outputs of this round (the same folder also has one `vt-*.log` per test file):

```text
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r3/bot-base.log
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r3/bot-after.log
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r3/botdiff.mjs
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r3/disaster-digest.mts
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r3/digest-before.json
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r3/digest-after.json
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r3/summary-ticker.txt
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r3/summary-disasters.txt
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r3/summary-final.txt
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r3/vt-newsTicker-oldstep.log
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r3/tickerprobe-big.txt
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r3/watchturn-sim.mjs
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r3/watchturn-sim.log
```

### Plan against code

- QA offered two fixes for F1, the list or the wording. NOTE-077 asks for both, and both are needed: the wording for
  new summaries, the list for the ones old saves hold.
- QA wrote that the unit tests drive the ticker with `dt`. `newsTicker.test.ts` and `eventTicker.test.ts` moved the
  clock by the same amount as `dt`, so the two agreed there. The tests that leaned on `dt` alone were `views.test.ts`
  and `panelsNews.test.ts`.
- The fix makes every wait in the real game longer by what the clock ran fast. QA's waits were measured on that
  clock: 20 of 20 headlines within 11.0 s at 1x and 2x; at Ultra the slowest headline took 10.3-14.5 s, and 21.6 s on
  loopback. Expect up to about 14 % more at 2x (about 12.5 s, inside the 15 s gate) and up to about 23 % more at
  Ultra, which the plan reports and does not gate.
- The probe above takes 14.3 s for its slowest headline at 2x, against a 15 s limit. That city has more than twice
  the residents of QA's 652k one, and the number was the same before round 3.
- A rotation of one long item starts its scroll over on every turn (`show()`: the same item again starts over at
  rest). "Scrolls through once" holds per turn; B2 judges one turn. Unchanged.

### Not verified here

- No browser ran. `tools/qa-ticker.mjs` passes `node --check`, and its new B2 was not executed in a page. Its
  in-page watcher and its pass expression, both read from the tool's source, gave the expected verdict on 9 simulated
  timelines: 4 that must pass (60, 160 and 8 frames a second; a watch that starts mid-scroll) and 5 that must fail
  (a turn cut before the end is in view; a turn already over when the watch begins, which is what the old check let
  pass; a scroll that loops; an item that never gives way; a short item). QA's `mk-lane-ticker.mjs` builds its copy of
  the tool by exact string replacement: its 13 replacements still find their targets in the edited tool, and the copy
  parses.
- F1 and F2 in the real game: the visible clause, and the 5 s and 3 s holds, 60 px/s and the 0.5 s entry on the real
  GPU and the three hosts.
- The full vitest suite and the benches are left to the lead.

### Browser recheck for the lead

- [ ] F1: with the Disasters tool, drop a meteor, an earthquake and a tornado on a district with a station, a clinic
  and schools. The ticker shows "… destroyed, including your Fire Station, …" up to a word and "…", or up to the
  tornado's " — ", and never ends on "incl."; the tooltip, the toast and the news feed have the whole text.
- [ ] F1, old saves: load a save that holds an "incl." summary, or inject one with the line below. The ticker shows
  it past "incl.".

  ```text
  sim.notify('Meteor strike! 15 buildings destroyed, incl. your Fire Station, Medical Clinic, 2 Elementary Schools and 6 more.', 'disaster')
  ```
- [ ] F2: `tkclock.mjs`. The ticker's clock advances 15.0 s in 15.0 s paused, at 1x, 2x and Ultra, on the default
  host and the worker; it was 16.0-18.5 s. A 5 s hold lasts 5.0 s plus at most a frame and a burst's hold 3.0 s (they
  were 4.2-4.75 s and 2.34-2.88 s). The scroll runs at 60 css px/s, and an item is at rest 0.5 s after it shows (it
  was 0.41-0.44 s).
- [ ] F3: `tools/qa-ticker.mjs` on the real GPU at 1280x720 and at 1920x1080 (QA's `lane-qa-ticker.mjs` copy takes
  the size; rebuild it with `mk-lane-ticker.mjs`), 10 of 10. B2's line reports `frames` above 0, `endOutAtFirst`
  true, `endInAtLast` true and `movedBack` false. Expect `turnS` about 6.0 s (QA measured 5.4-5.9 s for this item on
  the fast clock) and `endInS` a second less. A2's wait reads about 5.0 s; it was 4.88-4.90 s.
- [ ] Pacing on the right clock (QA items 5f, 6c and check C): 10 headlines at 1x and at 2x are still each fully
  visible within 15 s. Record the new figures; the old ones are from the fast clock. Ultra stays reported only.
- [ ] Unchanged: the newest item within 1 s, hover holds and resumes, a click flies to the place or opens the feed,
  the queue cap, and round 2's B4 order (event stories give way before ordinary good news and rewards).

## Round 4 (NOTE-081): the weather calendar lives under src/sim

Base: `local/T074-voices` at `55bc0dec` (current dev merged in, full gate green). NOTE-081: sim code must not import
from src/render, even type-only. Round 1 had `src/sim/economy/advisors.ts` import `weather` from
`src/render/world/Weather.ts`, so a renderer module loaded with the sim worker, with `SimCore` and with the bot. This
round moves the calendar and changes nothing else: the same weather on the same day, the same headlines, round 2's
holds and easing, the same hooks. All changes are uncommitted. There is no logic, random draw, balance, save or
worker change and no infra hunk.

### Changes per file

- **New `src/sim/economy/weatherCalendar.ts`** (23 lines): `weather(day, seed, climate)` and `WeatherState`, moved
  from the renderer's module with the body unchanged. It imports the `Climate` type from `src/core/types` and
  `headlineHash` from `./eventHeadlines`, and nothing else: no src/render, no three, no DOM. It takes no simulation
  and draws from no random stream. It is still a hash of the day's three-day spell, the seed and the climate.
- `src/sim/economy/advisors.ts` (`:91`, one line): `import { weather } from './weatherCalendar'`. The file is on the
  cloud-held list for its GUIDE hunks; this line is the lane's own import from round 1 and no GUIDE hunk.
- `src/render/world/Weather.ts`: the function and the interface are gone, and the `Climate` import with them. The
  module imports both from the calendar and keeps the visuals:
  - the particle cloud, its shaders and its uniforms;
  - the 20 s hold and the 4 s easing (`WEATHER_HOLD_SECONDS`, `WEATHER_EASE_SECONDS`, `WeatherAmounts`, `shown`), the
    same-day snow cue and `reset()`;
  - `rainAmount()` and `isRaining()` for the pedestrians lane, and `flashAmount(strength, reducedFlashing)`, the single
    flash gate.

  `update()` is unchanged and still returns the calendar's state for the day. Three is still a type-only import and
  still comes in through the constructor.
- **One line there is a choice for the lead:** `export { weather, type WeatherState }` (`:13`) keeps the two names
  importable from the renderer's module. It is a re-export of the sim's function, so the direction is render to sim,
  which the rule allows. It is there because two things outside this round's files still ask the renderer's module:
  - the lane's `tests/render/weather.test.ts`, `tests/render/weatherPacing.test.ts` and
    `tests/audio/weatherAmbience.test.ts`, which this round leaves untouched;
  - QA's page scripts: nine files under `qa/T074` (`cmds/f23_*.mjs`, `cmds/news_run.mjs`, `js/wxcal.js`,
    `js/survey256.js`) call `WX.weather` after `import('/src/render/world/Weather.ts')`.

  To have the renderer's module export visuals only: delete `:12-13`, point those three tests and the QA scripts at
  `src/sim/economy/weatherCalendar.ts`, and delete the last test of `tests/sim/weatherCalendar.test.ts`.
- New tests: `tests/sim/simImports.test.ts` and `tests/sim/weatherCalendar.test.ts` (below).
- Not touched: `src/sim/infra/overlays.ts` and every other infra file, `WorldView.ts`, `CityScene.ts`,
  `render/contracts.ts`, `audio/ambience.ts`, and every existing test.

### Imports from src/render, src/ui and src/game inside src/sim

The search parsed the sources; it did not grep them. Before the move: 62 files under src/sim and 492 module
references, counting type-only imports, re-exports, `import()` calls and `import()` types. After it: 63 files, 494.

- **One, and it is this lane's:** `src/sim/economy/advisors.ts:91` to `src/render/world/Weather.ts`, a runtime
  import from round 1 (`061eb48b`). Moved, as above. `git log --all -G"from '(\.\./)+render/" -- src/sim` lists that
  commit and no other, in any ref.
- **None** into src/ui or src/game, and none that is type-only. src/core names nothing outside src/core.
- **`src/sim/infra/overlays.ts` has no import from src/render.** Its imports (`:17-27`) are src/core and src/sim.
  What a search for `render/` finds there is the doc comment at `:990`, which cites
  `src/render/world/overlays.ts` (curbCells). No commit in any ref ever gave the file such an import. So the exception
  NOTE-081 names needs no exemption: the new test has none, names the file and says why. The file is untouched.
- **What the import dragged along.** Before, `src/render/world/Weather.ts` was one of the 97 modules that load with
  `src/worker/simWorker.ts`, and it loaded with `src/worker/SimCore.ts` and `tools/simbot.ts` too, each time through
  `advisors.ts`. Now no module of src/render loads with any of the three; `weatherCalendar.ts` takes its place. The
  calendar itself loads with 7 modules (4 of src/sim, 2 of src/core, `src/assets/manifest.ts`) and no package.
- **The lane's other imports across layers** (rounds 1-3) all point down, so none needed moving:
  - render to sim: `Sightings.ts` and `Weather.ts` import `eventHeadlines`, and `CityState` as a type;
  - ui to sim: `Notifications.ts` imports `eventHeadlines`;
  - game to audio: `CityScene.ts` imports `ambience`;
  - audio to sim: `src/audio/ambience.ts` imports `BF` from `sim/CityState` and `getDef` from `sim/catalog` (round
    1's district sampler). It is the first import of src/sim in src/audio.
- For information, outside "sim code" and outside this lane: seven modules of src/game and src/ui load with the
  worker through src/worker's own imports (`queries.ts`, `inspect.ts`, `SimCore.ts`, `protocolInbox.ts`):
  `game/demolishRisk`, `game/emergencyPolicy`, `game/fallback/FallbackActions`, `game/tools/placement`,
  `ui/statsModel`, `ui/format` and `ui/zoneStatus`. That is dev's worker code. The lane has no hunk in src/worker.

### Tests

`npx tsc --noEmit` passes on the final tree, and `git diff --check` is clean. Every test file ran alone, one process
at a time:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run <file> --maxWorkers=1
```

New tests (7).

`tests/sim/simImports.test.ts` (4 tests). It parses the sources as `tests/worker/hygieneScan.ts` does, so a comment
or a string that names a path is no import:

- `the scan reads every way a module names another, type-only ones too, and no comment or string`: `import`, `import
  type`, `import { type X }`, `export ... from`, `export type ... from`, `export * from`, `import()` as a call and as
  a type, `import x = require()` and `require()`. A line comment, a string and a doc comment worded like
  `overlays.ts:990` are no reference.
- `no file under src/sim/economy imports from src/render, src/ui or src/game, type-only imports included`.
- `nor does the rest of src/sim: src/sim/infra/overlays.ts cites the renderer in a comment, which is no import`.
- `the weather calendar names sim and core modules alone, and nothing that loads with it is the renderer or a
  package`: what the module names itself, type-only included, and its runtime import graph. No three anywhere.

A failure names the line: `src/sim/economy/advisors.ts:91 -> src/render/world/Weather`.

`tests/sim/weatherCalendar.test.ts` (3 tests):

- `names the same weather on the same day as before the move: 4 climates, 16 seeds, 10 game years each`: 230,410
  rows of climate, seed, day, kind and intensity, the number of days of each kind per climate, and the SHA-256 of the
  table. The digest, `d4ad2949...a70e`, was taken from `src/render/world/Weather.ts` on the clean tree before the
  edit.
- `gives a seed one weather for three whole game days, and each climate its own reading of that spell`: seed 7's
  first snow (days 6-8, intensity 0.57) and first rain (day 60, 0.74); the same spell is snow in alpine, rain in
  tropical and haze in desert.
- `is the one calendar: the renderer module hands out this function under its old name`: the re-export is the sim's
  function itself.

The lane's files and the hygiene gate, on the final tree (12 files: 133 passed, none failed). None of the ten
existing files was edited:

| File | Result |
|---|---|
| `tests/sim/eventHeadlines.test.ts` | 17 passed |
| `tests/render/weather.test.ts` | 6 passed |
| `tests/render/weatherPacing.test.ts` | 9 passed |
| `tests/render/sightings.test.ts` | 10 passed |
| `tests/audio/weatherAmbience.test.ts` | 4 passed |
| `tests/audio/districtAmbience.test.ts` | 11 passed |
| `tests/audio/ambience.test.ts` | 12 passed |
| `tests/game/eventTicker.test.ts` | 4 passed |
| `tests/game/newsTicker.test.ts` | 35 passed |
| `tests/worker/hygiene.test.ts` | 18 passed |
| `tests/sim/simImports.test.ts` | 4 passed (new) |
| `tests/sim/weatherCalendar.test.ts` | 3 passed (new) |

Also run, because `advisors.ts` or `WorldView`'s weather is in their import graph (22 files: 207 passed, 1 skipped).
These ran before the last edit, which reworded one comment in `Weather.ts`; `tsc` and the 12 files above ran after
it.

| File | Result |
|---|---|
| `tests/sim/advisors.test.ts` | 32 passed |
| `tests/sim/advisorsTexts.test.ts` | 6 passed |
| `tests/sim/advisorsFeedback.test.ts` | 17 passed |
| `tests/sim/advisorsPredict.test.ts` | 3 passed |
| `tests/sim/advisorsRuins.test.ts` | 19 passed |
| `tests/sim/advisorsScanOrder.test.ts` | 1 passed |
| `tests/sim/exact/advisorsScan.test.ts` | 3 passed |
| `tests/sim/milestoneNews.test.ts` | 10 passed |
| `tests/sim/monthSpread.test.ts` | 12 passed |
| `tests/sim/foundingDay.test.ts` | 5 passed |
| `tests/sim/taxHighAdvice.test.ts` | 2 passed |
| `tests/worker/protocol.test.ts` | 8 passed |
| `tests/worker/hosts.test.ts` | 6 passed, 1 skipped (its own skip) |
| `tests/worker/localSimHost.test.ts` | 4 passed |
| `tests/worker/worldResync.test.ts` | 1 passed |
| `tests/render/seasons.test.ts` | 33 passed |
| `tests/render/lighting.test.ts` | 11 passed |
| `tests/render/exitRetention.test.ts` | 5 passed |
| `tests/render/freshLoad.test.ts` | 12 passed |
| `tests/render/pendingPreviews.test.ts` | 3 passed |
| `tests/game/graphicsRestore.test.ts` | 10 passed |
| `tests/game/cityTeardown.test.ts` | 4 passed in each of 4 runs; one run also exited 1 (see "Not verified here") |

The new tests see what they guard. Each line is one change to one file, one test run and the file put back byte for
byte (`mutate.mjs`; the SHA-256 of all five files matched afterwards):

| Change | Tests that failed |
|---|---|
| `advisors.ts` imports `weather` from the renderer again (round 1's line) | `no file under src/sim/economy imports ...` |
| a type-only import of the renderer in `weatherCalendar.ts` | that test and `the weather calendar names sim and core modules alone ...` |
| a type-only import of `src/game` in `src/sim/config.ts` | `nor does the rest of src/sim ...` |
| an `import('../../ui/...')` type in `weatherCalendar.ts` | `no file under src/sim/economy imports ...` and `the weather calendar names ...` |
| `weatherCalendar.ts` imports three | `the weather calendar names sim and core modules alone ...` |
| `eventHeadlines.ts`, which loads with the calendar, imports three | `the weather calendar names sim and core modules alone ...` |
| intensity over 47 steps instead of 46 | `names the same weather on the same day ...` and `gives a seed one weather ...` |
| four-day spells | the same two |
| winter chance 36 instead of 35 | `names the same weather on the same day ...` |
| the renderer's module exports a wrapper of its own | `is the one calendar ...` |

### Bot and digests

```text
SIMBOT_LOG=1 node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

`residents [ 61124, 93804, 37971 ]` = **192,899** in 2015, unchanged (funds $146k, 2,818 buildings, approval 81,
loans 0, unlocked 38). The command ran twice on the clean tree before any edit, once after the move and once on the
final tree. With the run-to-run timings removed (the `done in` time, the `ms/day` line and the two ms columns of the
year rows), all 1,187 lines are identical in the four outputs: the 15 year rows, the 1,111 lines of the action log,
the last income and expense and the last news. The two clean runs agree with each other, so the comparison is sound.

The calendar itself, before and after. `calendar-digest.mts` writes the table the new test pins (230,410 rows). It
ran against `src/render/world/Weather.ts` on the clean tree, then against `src/sim/economy/weatherCalendar.ts` and
against the renderer's re-export on the edited tree. The three files are identical byte for byte (SHA-256
`d4ad29498b9649977221a0fb94982c67e23a7470fa4a75729a38bc0f9843a70e`).

The headlines, end to end. The bot prints only its last 12 news items, so `news-digest.mts` plays the same bot (the
CLI's systems and defaults) and records every news item the sim posts in the 15 years, the SHA-256 of the whole saved
city at the end of each year (news and `systemData.advisors` included, only `savedAt` pinned) and the advisors' saved
record at the end. "Before" is a `git archive` of `55bc0dec`'s `src` and `tools` in the scratch folder; it differs
from the worktree in the three source files above and in nothing else.

| City | News items | Before against after |
|---|---|---|
| the bot's (temperate) | 412 | identical: all news, 15 yearly digests, advisors record |
| the same, climate set to alpine | 413 | identical |
| the same, climate set to tropical | 412 | identical |
| the same, climate set to desert | 421 | identical |

The three other climates are the bot's city with `config.climate` changed after the terrain is made: cities for this
comparison only, not balance numbers. In the four runs the calendar gates 21 headlines, and each sits on a day the
calendar agrees with: 6 snow headlines on snow days, 4 "April showers" on rain days, 6 meteor showers on clear days,
and 5 heatwaves on days without rain. The temperate city's, from the log: "Snow day!" on day 1473 (snow), "April
showers" on day 1891 (rain), "Snowfall turns Botville into a snowball battlefield" on days 1825 and 4336 (snow).

The outputs of this round (the same folder also has one `vt-*.log` per test run):

```text
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/bot-base.log
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/bot-base2.log
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/bot-after.log
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/bot-final.log
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/botdiff.mjs
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/calendar-digest.mts
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/calendar-before.txt
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/calendar-after-sim.txt
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/calendar-after-render.txt
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/news-digest.mts
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/news-before.summary.txt
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/news-after.summary.txt
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/graph-before.log
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/graph-after.log
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/closure.log
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/mutate.mjs
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/summary-mutations.txt
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/summary-final.txt
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/summary-advisors.txt
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T074/scratch/r4/summary-graph.txt
```

### Plan against code

- **NOTE-081's exception does not exist.** `src/sim/infra/overlays.ts` imports nothing from src/render (above). The
  rule has no exception today.
- **The gate is wider than the task's sentence.** The task asks for a test over src/sim/economy. NOTE-081 states the
  rule for all sim code, and with no exception to carve out, the third test covers the rest of src/sim too. To keep
  the gate to src/sim/economy, delete that one test.
- **POLISH_PLAN's FEEL-23 puts the pure function in the new `src/render/world/Weather.ts`** (its "Files" line,
  `docs/POLISH_PLAN.md:2712`). NOTE-081 overrides it; the plan does not name `src/sim/economy/weatherCalendar.ts`.
- **The re-export** in `Weather.ts` is the choice described under "Changes per file".
- `Weather.ts` took three through its constructor so that the sim's import of it would not pull the graphics runtime
  into the worker. With the calendar out, nothing of the sim reaches the module, so that indirection is no longer
  needed. It stays: there is no behaviour change this round, and round 1's test pins it.

### Not verified here

- No browser, no real GPU, no `vite build`, no full suite and no bench ran. Nothing on screen should change: the
  renderer calls the same function with the same arguments.
- QA's page scripts under `qa/T074` were read, not run. They keep working through the re-export.
- The bot's wall time is no measurement on this machine: 21.4 s and 24.4 s on the clean tree, 31.6 s and 48.2 s
  after, while other lanes' processes ran. Every system slowed together (utilities 2.5 to 3.2 ms a day), and the
  advisors' own cost stayed between 0.05 and 0.14 ms a day in all four runs. The moved function has the same body.
- `tests/game/cityTeardown.test.ts` is not on this round's list. Its 4 tests passed in each of 4 runs, and one of the
  4 runs also exited 1 on an unhandled rejection after the tests: `requestAnimationFrame is not a function` at
  `src/ui/thumbs.ts:125`. It is the load flake NOTE-012 describes, through a window its fix left open, and it has
  nothing of this round in it. The file's `afterAll` waits until no stubbed frame is pending, but the thumbnail pump
  can be inside `await this.render(job)` at that moment, with no frame pending; it asks for the next frame after the
  stubs are gone. The machine was loaded (the run's transform took 22 s against 4.6 s in round 3).

### Browser recheck for the lead

- [ ] Nothing visible changes. One spot check is enough: on a snow day and on a rain day of the calendar, the flakes,
  the roof dusting, the road sheen and the rain bed are there as before, and a snow headline still falls on a snow
  day.
- [ ] QA's FEEL-23 scripts still run as they are (`WX.weather` through the re-export). If the re-export goes, they
  import `/src/sim/economy/weatherCalendar.ts`.
- [ ] The worker host loads: the worker's bundle now holds `weatherCalendar.ts` and no module of src/render
  (`tests/worker/hygiene.test.ts` builds that graph and passes; a city on the worker host is the real check).
