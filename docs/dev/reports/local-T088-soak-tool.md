# local-T088-soak-tool: the soak tool runs on current dev again, and its days/s gate measures running seconds (NOTE-081)

Branch `local/T088-soak-tool`, base `825ee224` plus the task commit `057cc184`. Everything is under `tools/soak/`;
nothing under `src/` changes. The changes are uncommitted, as the lane rules ask.

**Both findings of T082 are fixed, and the selftest now fails on the first one:**
- `Driver.save()` reads the saved city through `c.scene.sim.state` (the App's city record has had no `state` since
  W0.6). With the old line back, 3 of the 16 selftests fail, two of them with T082's own error
  (`TypeError: Cannot read properties of undefined (reading 'day')`).
- The 15 days/s floor reads the sim's days per **running** second. T082's loaded dense1m hour, read again with this
  `report.mjs`, passes every line at **17.82 days/s** (12.62 per city second, now informative).

**Not verified here:** anything in a browser. The lead's 1-hour soak is the check; the list is at the end.

Scripts named `scratch/...` below are in the lane's scratch folder (`scratchpad\lanes\T088\scratch`), not in the
tree. T082's data is in `scratchpad\qa\T082`.

## What changed, per file

No hunk is outside `tools/soak/**`, and none is in `src/sim/infra`.

| File | Change |
|---|---|
| `driver.mjs` | **The stale line** (`save()`'s last read), exactly as the task gives it. **The host check:** `readyCity()` also reads `scene.host.kind` and throws on anything but `'local'` (exported as `SIM_HOST`). **An injectable clock:** `delay`, `wait` and `click` take time from `this.clock` (default: `performance.now` and `sleep`, as before), so the selftest runs the driver's waits to their limits in no real time. |
| `telemetry.mjs` | A sample's `sim.daysPerSecond` is now two fields, `daysPerRunningSecond` and `daysPerCitySecond`. The seeded settings add `tips: false` and `cameraMoments: false` (below). `Probe.capturePrototypes`' page code moved from a template string into the function `pagePrototypes`, serialized the same way, so the selftest can scan and run it. |
| `report.mjs` | `assess()`: running seconds, both rates, the floor on days per running second, with two rules that keep the bar where it was (below). `cadenceOverrun()`: the cadence limit as a pure function, with the message. `markdown()`: both rates, the rate's paragraph, `Simulation host:`, "with the machine to themselves", and a `Fixture:` line that no longer says "newly founded 64×64 city" for a dense run that failed before its fixture loaded. |
| `run.mjs` | Calls `cadenceOverrun()` and `missingFixture()`. Samples drained while the cycle's first pause is clicked carry the phase `cycle-pause`, so `playing-ultra` labels only a city left to play. `schemaVersion` 2. The logged settings list the two new keys. |
| `options.mjs` | `missingFixture()`, the `fixtureFrom` option (`'--fixture'`, `'SIM_FIXTURES'` or `'default'`) that it words its first sentence from, the `--city vet` error, three help lines. |
| `mockpage.mjs` (new) | For the selftest only: `pageShape()`, `pageReads()`, `checkReads()` and `MockPage` (below). |
| `selftest.mjs` | 10 tests became 16 (below). The telemetry test runs on the shared mock page. |
| `README.md` | The machine line and "The cadence limit"; the fresh-worktree fixture; "Simulation host"; "The simulation rate"; "The page the selftest runs on"; the settings sentence; the file table. |

### The page the selftest runs on (task item 2)

The task asks for a mock "shaped like the real App record ... so the next removed field is caught", deriving "its
shape from one place". A hand-written mock cannot catch a removed field: it keeps the field. So the one place is
the source:

- **`pageShape()`** parses `src/main.ts`, `src/game/CityScene.ts`, `src/sim/Simulation.ts` and
  `src/sim/CityState.ts` with rolldown's parser (`rolldown/parseAst`; the soak already bundles with rolldown) and
  returns the member names of `App`, its `city` record type, `CityScene`, `Simulation` and `CityState`.
- **`MockPage`** builds each object with exactly those names and gives a stand-in value only to a name the source
  still declares. `evaluate()` runs the function's source in a `vm` realm and returns plain values, as Playwright
  does. Its mouse and keyboard act on a small game model: the region screen, the city, the pause menu, a save that
  is not finished at the driver's first look, an exit and a load.
- **`pageReads()`** scans `driver.mjs`, `telemetry.mjs` and `run.mjs` for every path read off
  `window.__metropolis`, through `const` aliases, optional chains and destructuring: 51 distinct paths in the
  driver, 11 in the telemetry, 1 in `run.mjs`. `checkReads()` holds each member against `pageShape()`.

The static half matters because the selftest cannot run the canvas steps, and because some removals fail without
an error: with `saveFailed` gone, `!c.saveFailed` reads as "not failed". On a copy of the source with `lastSave`
and `saveFailed` taken out of the record, `simReady` renamed in `CityScene` and `powerLines` renamed in
`CityState`, the check lists exactly those four reads (`scratch/probe_removed.mjs`; the tree's `src` untouched).

Limits, also in the README: the scan follows `const` and `let` declarations only, and the selftest checks no DOM
selector, no key binding and no member below those five objects.

## The simulation rate (task item 3)

`runningSeconds` was already collected: frame time in the city while `sim.speed > 0`. The floor's rate is now
`simDays / runningSeconds`; days per city second is printed next to it and gates nothing.

T082's runs, read again with this `report.mjs` (`scratch/reassess.mjs`; samples of `schemaVersion` 1 have the
fields it needs):

| Run | Sim days | Running s | City s | **Days per running second** | Days per city second | Floor 15 |
|---|---:|---:|---:|---:|---:|---|
| dense1m, 1 hour, loaded machine | 41,932 | 2,353.4 | 3,322.7 | **17.82** | 12.62 | **PASS** (was FAIL) |
| small, 1 hour, loaded machine (floor switched on) | 51,116 | 2,695.0 | 3,242.4 | **18.97** | 15.76 | PASS |
| dense1m unpatched, died after 68 s | 3 | 0.1 | 60.9 | no rate | 0.05 | FAIL (was FAIL) |

- **The gated number is a little under the rate of plain speed-3 play, never over it.** A loaded city resumes at
  speed 1, and the harness presses speed 3 only after the quality switches: a median of 14.1 s per cycle in T082's
  dense1m run (8.0 s in the small city), in which those samples made 0.6 and 1.5 days/s. Between cycles alone, the
  dense run made 18.99 days/s. I kept `runningSeconds` as collected, as the task says, so the lead's numbers stay
  comparable with T082's column "days/s while the sim ran".
- **Expect a higher rate than T082's on current dev.** At T082's revision (`146c885`) the soak's `autosaveMonths: 3`
  meant an autosave every 4.5 s at speed 3. FEEL-02b's floor (T036 step 4, merged after it) allows one a minute.

**Two rules I added, because the plain formula does loosen the bar in two cases.** Before NOTE-081 every pause
counted against the floor. With `simDays / runningSeconds` alone:
1. **A sim that something other than a cycle pauses would pass on the seconds it ran.** So the seconds the sim
   stood paused while the harness had left it to play (city seconds minus running seconds, in the samples of phase
   `playing-ultra`) are added to the running seconds before the division. They come to 0.04 s and 0.01 s in T082's
   two hours, so both numbers above are plain days per running second. The summary prints them ("0.0 s paused
   between cycles"), and the floor's line says so when they are 0.05 s or more.
2. **T082's unpatched run would read 28.22 days/s (3 days over 0.1 s) and PASS that line.** So a rate needs running
   time and at least one sample of a city left to play; otherwise it is "no rate" and the line fails.

Both are in `assess()` (the `idleSeconds` line and the `playing.length` condition) and each has a selftest case. If
the lead wants the plain formula, removing them is those two places plus that test's cases.

## Tests

`node tools/soak/selftest.mjs`: **16 of 16 pass** (10 before). `node --test tools/soak/selftest.mjs` gives the same.
It ran through the quiet gate: 0.4 s with the machine free, up to 30 s at 100 % CPU.

| # | Test | New or changed |
|---|---|---|
| 1 | CLI units, fixture selection and unsafe/ambiguous arguments | |
| 2 | heap regression uses hours/MiB and rejects insufficient or zero-span data | |
| 3 | summary fails missing actions, retained cities, missing counts, crashes, errors, loss and unmeasured runs | |
| 4 | NOTE-026: the second-half slope catches a late leak the whole-run slope passes; short runs are n/a; the days/s floor | its samples now carry a phase and running seconds |
| 5 | NOTE-081: the days/s floor reads running seconds: a cycle's pauses do not fail it, a slow, stalled or unmeasured sim does | **new** |
| 6 | hardware gate rejects software and unknown renderers | |
| 7 | queryObjects never leaks remote handles, including failures | |
| 8 | bounded telemetry measures frame stalls and sim progress across visits without bridging region gaps; a pause is city time, not running time | on the shared mock page; a paused stretch; both rate fields |
| 9 | the game loads the profile the soak seeds: Ultra, "Keep going", tips off, no camera moves, no first-run quality pick | **new** |
| 10 | context loss marks intentional disposal once, then detects later unexpected loss | |
| 11 | real helper bundles compile without changing app code or launching Chromium | |
| 12 | missing fixture produces honest FAIL JSON and Markdown without a build/browser | the how-to in the failure; the `Fixture:` line |
| 13 | a missing fixture says how to build or point at one; a cycle past its cadence names the busy machine | **new** |
| 14 | every member the tool reads off window.__metropolis is one the source still declares (T082: city.state) | **new** |
| 15 | Driver.save() on a page shaped like the real App record waits for the save and returns the saved city | **new** (the task's case) |
| 16 | the save, exit and re-entry steps run on that page; the driver refuses a simulation host it does not measure | **new** |

- **Test 9** runs `installTelemetry`'s seeding, then the game's own loaders on it (`src/region/settings.ts` and
  `src/game/settings.ts`, bundled as a run bundles its helpers; the city's settings loaded over the app's, as
  `CityScene` does). A renamed key or a profile the game no longer counts as an existing one fails it: on a copy of
  the source with `tips` renamed, the loader keeps the new key at `true` (`scratch/probe_settings.mjs`).
- **Test 15** also takes a member out of the shape and expects the failure a browser gives: without `city.tile`
  or `scene.sim` a `page.evaluate: TypeError`, without `city.lastSave` "Timed out: completed successful save"
  (the wait's 2 minutes pass on the selftest's jumping clock).
- **Test 16** runs `play`, `pause`, `save`, `exit`, `enter` (with `readyCity`) and `clear`, and `pagePrototypes` on
  both visits.

**Mutation checks.** Each was applied to the tree, the selftest run, and the file restored byte for byte
(`scratch/mutate.sh`, `scratch/mutate_all.sh`, `scratch/mutate_clock.sh`).

| Mutation | Fails |
|---|---|
| the old `save()` line back (`c.state.day`) | 14 (`window.__metropolis.city.state`), 15 and 16 (T082's TypeError) |
| the floor on days per city second again | 5 |
| paused-between-cycles seconds left out of the rate | 5 |
| a rate without a city left to play | 5 |
| no host check | 16 |
| the limit moved by one (`<=`); the last cycle not exempt; the old cadence text | 13, each |
| no build command in the fixture message | 13 |
| the summary's `Fixture:` line as before | 12 |
| `daysPerRunningSecond` computed from city time; running time counted while paused | 8, each |
| `tips: false` and `cameraMoments: false` not seeded; the app's profile key not seeded | 9, each |
| the mock keeps a stand-in the source does not declare (a hand-written mock) | 15, 16 |
| a page function reading a member that does not exist (`city.view`) | 14, 16 |
| the driver sleeping for real, past its injected clock | 15, 16, through the selftest's stop hook (its minute cut to 2 s for this check). Before the hook existed this mutation hung the selftest, which is why it has one |

## Gates

| Gate | Result |
|---|---|
| `node tools/soak/selftest.mjs` | **16 of 16** |
| `npx tsc --noEmit` | exit 0, no output. `tools/` is in the tsconfig, but without `allowJs` no `.mjs` is checked, and no `.ts` file imports the soak tool |
| `node tools/soak/run.mjs --help`; `--city vet` without a fixture (exit 2, the new text) | as expected |
| `node tools/soak/run.mjs --city dense1m --minutes 20` in this worktree, which has no fixture | exit 1 at once, before the build, with the new message; `summary.md` and `run.json` (`schemaVersion` 2) written |
| The 128x15 seed-7 bot | not run: nothing under `src/` changes |
| **A real 1-hour soak on the real GPU, machine quiet** | **the lead's**: see the checklist |

## Plan against code

1. **"On `?simworker=1` the page has no sim" is not what the code does.** A worker or loopback host gives the
   scene a `sim` too: `PacketSimHost.sim` is a facade whose `state` is the replica's `CityState`
   (`src/worker/LoopbackSimHost.ts`). The driver's reads would go on. What fails is the evidence: the heap samples
   and the `queryObjects` counts come from the page's CDP session, so a simulation in a worker would pass
   unmeasured.
   **What the soak supports: the main-thread host only.** It never asks for the worker (the URL is its own), reads
   `scene.host.kind` on every entry and fails with that reason on `'worker'`, `'loopback'` or an unreadable kind.
2. **For the lead to decide: W1.4 makes the worker the default, and STATUS.md puts #28's 4-hour soaks after W1.4.**
   From then on this harness fails at its first `readyCity()`, by design. Either the final soaks force the main
   thread (W1.4's "Simulation thread: Main thread" setting, seeded like the other settings once its key exists), or
   the harness gets worker support first: the worker's heap per CDP target (W1.4's own acceptance measures heap
   "with CDP per target") and a check that the worker is gone after each exit. I built neither: it needs a browser.
3. **With tips on, the first emergency that no station covers pauses the game under "Keep going" too** (FH-08,
   merged after T082's revision: `speedPolicy`'s lesson hold does not look at the policy). Run against the real
   `src/game/emergencyPolicy.ts` (`scratch/probe_lesson.mjs`): under `'ignore'` an E1a lesson takes speed 3 to 0 and
   holds it until the player sets a speed; with `teachFirst` off nothing changes. In a soak the sim would stand
   paused from that emergency to the end of the next cycle, up to about 6 minutes. The README promises that
   incidents do not pause the soak, so the seeded settings now have `tips: false`. At this base `settings.tips`
   gates only FH-08's four lessons.
4. **`cameraMoments: false` is seeded ahead of its feature.** The key is in the settings schema (default on); its
   consumer, FEEL-07's spotlight camera, is in T075 and not in dev. The harness already turns `newYearCamera` off
   for the same reason: its actions are screen coordinates. It changes nothing today.
5. **The year in review (LG-21, merged after T082's revision) stays on.** At speed 3 its card shows every 5 game
   years, about every 90 s, for 15 s, at the bottom centre with `z-index: 31`, above the panel layer (30). By
   reading: any key, minimap click or canvas click closes it, and a new card needs a new year, which a paused cycle
   cannot bring. So the worst case is a panel click that waits up to 15 s for a card (the driver retries a click
   for 30 s). It is on the checklist.
6. **Every other page read is current.** Besides the scan: `panels.get / order / panels / isOpen`, `pause.isOpen`,
   `toolbar.flyoutOpen`, `tools.activeId`, the info panel's `target` and `open`, `worldView`'s members,
   `objects.pickBuilding`, `ctx.overlay`, the 12 panel ids and the overlay numbers are as the driver expects. Of
   the files changed between T082's revision (`146c885`) and this base, I read `main.ts`, `CityScene.ts`,
   `TopBar.ts`, `Modals.ts` (the pause menu still says "Save & exit to region" while the tab holds the region's
   lock), `RegionScreen.ts`, `TitleScreen.ts`, `dialogs.ts`, `save/db.ts` and `regionLock.ts` for the selectors and
   the flow. NEW-04's write guard (`requireStoreSaveAccess`) lets the fixture seeder's `kv.put` through: the guard
   refuses only a document whose own lock on that region is not writable, and the seeder's document has no lock.
7. **`run.json` changed shape**, hence `schemaVersion` 2: `samples[].sim.daysPerSecond` became two fields,
   `initialCity` has `host`, `options` has `fixtureFrom`, `result` has `runningSeconds`, `idleSeconds` and both
   rates, and a new phase label `cycle-pause` exists. T082's scratch scripts read none of the renamed fields.

## Requests for cloud-held files

None.

## What I could not verify

- **Any real run.** On current dev that covers: the seeded fixture under NEW-04's region lock, the host read, the
  `pagePrototypes` function form in `Runtime.evaluate`, `tips: false` keeping the sim running, the Gazette card
  beside a cycle, and the rate numbers.
- **The wiring of the cadence stop and of the `cycle-pause` label** in `run.mjs`' loop. `cadenceOverrun()` and its
  limit are tested; the loop itself needs a browser. Checklist item 6 shows the message in a few minutes.
- **The selectors and key bindings**, beyond reading the files that changed since T082's revision.

## Browser checklist (the lead, real GPU, machine quiet)

1. `node tools/soak/selftest.mjs`: 16 of 16.
2. **The 1-hour dense soak** (T082 passed `--fixture <its dense1m_s7.region.metropolis>`):
   `node tools/soak/run.mjs --city dense1m --hours 1 --cycle-minutes 5 --min-days-per-sec 15`
   - the first cycle's `save` step passes (T082's stop, 68 s in), and all 12 cycles complete;
   - the summary's second line ends "Simulation host: local.";
   - "Simulation rate at the floor: N days/s per running second >= 15; M days/s per city second ... is
     informative", with N at 17.8 or more (T082's loaded hour; 18.8 in its quiet window, and more is likely with
     the autosave floor);
   - the telemetry line reads "0.0 s paused between cycles";
   - `run.json`: `schemaVersion` 2, `initialCity.host` `"local"`, samples with `sim.daysPerRunningSecond`;
   - the other lines as in T082's hour: 0 cities after every exit, 0 errors, heap slopes under 16 and 8.
3. **No emergency lesson:** banners may show, but none with the "Emergency! ... Send nearest / Emergency view /
   Got it" card, and the speed stays at 3 between cycles.
4. **The year in review:** a card may appear between cycles. If a cycle's panel click waits, it is at most 15 s. A
   step that fails with "No unobscured click target" while a card is up is a finding for this lane.
5. **The small city**, for the second scenario: `node tools/soak/run.mjs --city small --hours 1 --cycle-minutes 5`.
6. **The cadence stop, in a few minutes** (the build, the small city's founding, then one cycle):
   `node tools/soak/run.mjs --city small --minutes 5 --cycle-minutes 1`. A small-city cycle takes 66 to 82 s, so
   the run stops after cycle 1 with "Action cycle 1 took N s and was still running when the next one was due (one
   every 60 s, --cycle-minutes 1) ... The usual cause is a busy machine ... slowest steps: ...". The exit code is 1.
7. **The fixture message:** in a worktree without `tools/bench/.fixtures`, `node tools/soak/run.mjs --city dense1m
   --minutes 20` stops at once with the build command and the two ways to point at a fixture (seen here).

## Who wrote what

Claude (the lane's implementer): the changes, the selftest, the mutation checks and this report. No Codex lane.
