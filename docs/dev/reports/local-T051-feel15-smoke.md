# T051: smoke that reads output

**Closing status:** round 1 is committed as `745fa6e`, round 2 as `51a04e0`, and round 3 as `142c612` and
`97691ad`; the QA documentation is committed as `5fe3ac2`. Round 3 is committed and pushed. The final code gate
on **`97691ad`** passed, and the real-GPU QA below passes every FEEL-15 acceptance line. REVIEW-T051 / NOTE-064
accept the lane with the five minor findings recorded in the new review round below.

| Gate on 97691ad | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | Clean |
| Full Vitest | `npx vitest run` | 243 files / 2,443 tests passed |
| 128x15 seed-7 bot | `SIMBOT_LOG=1 npx tsx tools/simbot.ts --size 128 --years 15 --seed 7` | 2015 residents **[61124, 93804, 37971] = 192,899**, identical to dev |

These are the completed gates on the QA'd code tree, not new runs of the review fixes. The review fixes passed
TypeScript and all 29 focused tests below. The earlier quiet-gate blockage is retained only as historical context.

## Review round: NOTE-064 minor fixes

1. **Plume-cache scope (`src/render/city/effects/Effects.ts`).** Keep `PlumeState` and its key only for models in
   `SMOKY` or the exported emitter maps. Homes, shops and offices retain the direct fire/construction path without
   a plume-cache entry. The lead measured about 9.8 MB of unnecessary heap and 25-39 ms per rebuild on the
   11,495-building QA city before this fix; no new after-fix timing is claimed.
2. **Disaster extras across rebuild/resync (`Effects.ts`, `src/render/city/CityObjectsView.ts`).** Add
   `Effects.clearBuildings()` to clear building emitters and plume history while preserving transient extras;
   `CityObjectsView.rebuildAll()` uses it. `Effects.clear()` retains the full-clear behavior. This prevents a
   resync from ending meteor or fire/riot smoke that is installed only once.
3. **Demo smoke (`src/render/city/demoCity.ts`, `src/render/city/demo.ts`).** Staff the demo's industrial and power
   buildings to capacity, and supply the demo view with a fixed `getPlantLoad: () => 0.8`, restoring smoke in
   `demo-city.html` and `tools/shoot-city.mjs`. These are demo-fixture changes, not simulation balance changes.
4. **Zero-output plants: no code change this round.** Follow up with **T061**: when
   `UtilitiesSystem.producerInfo(id)?.output <= 0`, return null from `localViews().utilities.plantLoad` and use -1
   in `recorder.utilitiesStream`. This will distinguish a powered but non-producing plant from the literal
   `max(0.25, load)` floor retained here. The lead accepts the current behavior as a minor.
5. **Report record (this file).** Record the commits, completed gate commands/results and QA coverage at the top;
   mark the earlier blocked narrative as historical and point the round-3 checklist to the evidence below.

**Review-round verification: passed.** TypeScript passed through the quiet gate:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsc --noEmit
```

The standard gated `npx vitest run tests/render/smokePlumes.test.ts --maxWorkers=1` launch failed before tests
with `spawn EPERM` while bundling Vite's config. The established native-config/thread-pool workaround passed;
each file below ran separately and sequentially through the quiet gate, without repository config changes:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types node_modules/vitest/vitest.mjs run <file> --maxWorkers=1 --configLoader native --pool threads
```

| Review-round test file | Result |
|---|---|
| `tests/render/smokePlumes.test.ts` | 21 passed |
| `tests/render/smokeView.test.ts` | 7 passed |
| `tests/render/demoCity.test.ts` | 1 passed |

Total: **29 passed**, including eight new cases. The plume cases verify no cache entry for a home, shop or
office, including switching from a smoky model and retaining fire/dust. They also verify that building-only clear
preserves transient particles and their original expiry while full clear removes them. The view cases drive real
meteor, fire and riot effects through a state-replacement/reset rebuild. The demo case verifies full industrial/
power staffing and unchanged staffing for other demo models. `git diff --check` passes; changed files are valid
UTF-8 without a BOM. No full suite, bot, browser or timing run was repeated for these small review fixes; their
completed `97691ad` gates and QA evidence remain above/below. All review fixes are uncommitted; no `.done` edit.

## Round 3: approved plant-load input, split for separate commits

**(a) `src/worker/SimHost.ts` and `tests/worker/plantLoadLocal.test.ts`.** Adds
`UtilitiesView.plantLoad?(id): number | null` (temporarily optional until T061 forwarding); the Local view delegates to the existing public
`UtilitiesSystem.plantLoad(id)`. Missing systems, negative values and non-finite values become null. Five new
tests cover reader identity through lazy system attachment/removal, valid values and normalization.

**(b) `src/worker/protocol.ts`.** Adds optional `Streams.utilities` with
`plantLoads: { ids: Uint32Array; loads: Float32Array }`. Ready/resync and Packet already share Streams, so no
protocol-version bump or other message-path edit is needed. Older messages without this member still decode.

**(c) `src/worker/recorder.ts`, `src/worker/replica.ts` and `tests/worker/plantLoadStream.test.ts`.** The recorder
enumerates live building records whose definition has `powerOut > 0`, including incinerators, on full ready/resync
or when a completed utilities group is delivered. It respects the existing 250 ms utilities-group throttle and
does not poll loads on ordinary packets or view/focus changes. Publication is completed-pass-triggered and samples
flush-time values, matching NOTE-020 / WORKER_DESIGN F4: a delivery may include newer in-progress writes if a prior
completion was waiting under the throttle. After a completed
pass it publishes only if a producer was added/removed, availability changed, or any load differs by more than
**0.005 of the 0..1 share** (0.5 percentage points) from the **last sent** snapshot. Smaller drift accumulates.
The comparison uses Float32 wire values, matching the existing UtilitiesSystem load store; numerical boundaries
therefore follow Float32 precision. A full snapshot always includes all producer ids; unknown loads use -1.
The replica owns scalar id-to-load values, returns null before data arrives or for unavailable values, clears on
adopt or an explicit empty snapshot, and retains the last map for an omitted stream. New arrays are allocated only
for published snapshots. Twelve new clone-only packet tests cover these rules and owned buffers.

**(e) `src/game/CityScene.ts` and `tests/render/smokeLocalHost.test.ts`.** Adds the requested single caller property
`getPlantLoad: (id: number) => this.host.utilities.plantLoad?.(id) ?? null` in `createViews`. Three headless tests exercise the
actual caller and CityObjectsView using a real LocalSimHost and UtilitiesSystem: disconnected coal grids at 15%
and full load, the 25% activity floor, monthly load changes, shutdown and unavailable local data. Only the outer
DOM/WebGL world shell is replaced; the producer/read/activity/particle paths are real. The third test removes the
optional capability from a host fixture, matching the packet hosts' current water-only view, and verifies the real
object renderer stays active with no plume rather than falling back because the caller threw.

The five source files above are explicitly approved this round, including worker/game files outside the original
two render-owned files. **No infra hunks, host-forwarding edits, save changes or RNG draws.** The round-2 hook and
all existing smoke files remain untouched. T061 owns (d); LoopbackSimHost.ts, WorkerSimHost.ts, protocolInbox.ts,
simWorker and WorkerLink were not edited.

### Round-3 verification (completed; earlier quiet-gate attempt is historical)

The final commands and results on `97691ad` are recorded in the closing status above. The full suite included
the new local-reader, packet-stream and view integration tests. There is no standalone `recorder.test.ts`;
`plantLoadStream.test.ts` exercises the real recorder through clone-only packets. The real-GPU QA below records
the subsequent browser checks on that same code tree.

The earlier attempt was blocked by the quiet gate on 2026-11-03. At 20:22 EST, `QUIET` had been refreshed at
20:04:31. Only the lane's queued TypeScript command was canceled before it started; the flag and timing
processes were untouched. No gate result was claimed at that point. That temporary blockage and its pending-test
list are superseded by the completed `97691ad` gates above.

### Round-3 compatibility difference and cloud handoff

This checkout's PacketSimHost/LoopbackSimHost utilities object still has only `waterQualityAt`. A required view
method would make it structurally incomplete until T061 (d) lands, and the direct caller would throw while
constructing a plant view. To preserve NOTE-054's explicitly expected interim "unavailable" behavior, (a) makes
the capability temporarily optional and (e) guards the caller with `?.(id) ?? null`. These are the only differences
from the signature/caller shown in the task. The Local reader itself is present and real. No forbidden forwarding
file was edited. After T061 provides the reader on both packet hosts, the optional marker/guard may be tightened
if the lead wants a required interface; forwarding remains cloud-owned.

Round-3 browser checklist and coverage:

- [x] Local 15% and full coal load: **QA rows 3 and 3a**, activity floor 0.25 and <=40% of full particles.
  Distinct disconnected grids are covered by `smokeLocalHost.test.ts`; that specific browser check remains open.
- [x] Monthly activity refresh and zero staffing/power shutdown: **QA rows 2, 4a and 10**. Independent grid-load
  changes are covered by `smokeLocalHost.test.ts`; the browser cities each had one grid.
- [ ] After T061 forwarding lands, repeat plant-load visuals on loopback and the real worker. **QA rows 6, 7 and 8**
  cover their currently expected unavailable behavior and ready/resync snapshots; they do not verify T061.
- [x] Unchanged months and significant-change stream publication: **QA rows 6 and 7**; load/resync cleanup:
  **QA row 8**. Explicit empty snapshots are covered by `plantLoadStream.test.ts`, not by the browser QA.
- [x] Full Vitest: **243 files / 2,443 tests on 97691ad**. Real-GPU smoke checks: **QA rows 1-11**; row 10's
  frame measurements are indicative. Formal shared-hook timing and other lanes' interactions remain lead-owned.

## Round 2: shared budget hook (historical; committed 51a04e0)

The no-registration fixture blocker below was fixed by T040 and merged before round 3; the worker's full merged
gate is green. The remainder records the checks made in the round-2 worktree before that fix.

- `src/render/city/buildings/BuildingRenderer.ts`: registers `activityWork` from a field initializer beside the
  activity fields. Its cheap `pending()` performs the month comparison and creates a monthly iterator only when
  output buildings exist; it does not enumerate buildings or compute activity. `step()` consumes at most one
  candidate. Consumed unchanged/skipped entries report progress; an exhausted/absent iterator reports false.
  The event-driven changed set remains. All four activity reset assignments now live in the work's `clear()`.
  Restored the `addBudgetedWork` declaration that the merge conflict had removed.
- `drainBuilds()`, `clear()` and `dispose()` are byte-identical to `6bf60ee`. The registration method,
  `stepBudgetedWork()` and `drainBudgetedWork()` also match that commit exactly. No hook-policy edits were made.
  Geometry and activity now follow the hook's alternating turns across frames, rather than round 1's geometry
  priority on every frame. The first turn after construction/clear remains geometry-first. This is the requested
  scheduling change; unavailable plant loads, activity arithmetic, plume steps and emitter rate limiting are unchanged.
- `src/render/city/CityObjectsView.ts` (**outside the original task's two named source files, explicitly requested
  this round**): moved the existing plant-load assignment after the `onVisual` block, before initial rebuild.
- `src/render/city/effects/Effects.ts`: moved `PlumeState` beside the plume-owning Effects class, away from `Emit`.
  No effect behavior changed.
- `tests/render/smokeActivity.test.ts`: adds one hook/deadline integration case. Two 0.75 ms geometry builds and
  one 0.75 ms activity unit occupy the first frame (**2.25 ms**); the other activity unit finishes next frame.
  The case also verifies registration, cheap pending checks, and clear-through-hook with registration retained.
  The earlier geometry-first test is now named for the initial turn; its assertions remain unchanged.
- This report. **No infra, worker, simulation, save, RNG or other source hunks.** T040's two test files are untouched.

### Round-2 verification and remaining test-fixture blocker

TypeScript passed through the quiet gate:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsc --noEmit
```

Every requested test file ran separately and sequentially with the existing native-config/thread-pool workaround:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types node_modules/vitest/vitest.mjs run <file> --maxWorkers=1 --configLoader native --pool threads
```

| Test file | Round-2 result |
|---|---|
| `tests/render/smokeActivity.test.ts` | 16 passed |
| `tests/render/smokePlumes.test.ts` | 17 passed |
| `tests/render/smokeView.test.ts` | 4 passed |
| `tests/render/buildingWork.test.ts` | 9 passed, **2 failed** (fixture assumption below) |
| `tests/render/buildingBudget.test.ts` | 22 passed, unchanged |
| `tests/render/lod.test.ts` | 35 passed, unchanged |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 skipped |

Total: **120 passed, 2 failed, 1 skipped**. `git diff --check` and method-text comparison against `6bf60ee` pass.

**The unchanged buildingWork gate is not green.** Its first parameterized case, “preserves build order, frame counts
and clock checks with no registered work” (0.65 ms and 3.25 ms entries), constructs a normal renderer. Required
field-initializer registration means that renderer now has an idle activity work. The unchanged hook selects
`drainBudgetedWork()` by registration count, even when every work is idle. An empty drain therefore reads the clock
once, while the old unregistered drain reads it zero times. At line 112, the cases expect 29/26 reads but see 30/27.
The other nine hook cases pass; the activity adapter and actual geometry/LOD cases pass.

Exact lead request: in `tests/render/buildingWork.test.ts`'s first parameterized compatibility case only, make its
two fixtures actually have no registered work by emptying their private `budgetedWorks` arrays before the clock
is installed. Keep all assertions and the other nine cases unchanged. This isolates the scenario the test names;
it does not change production scheduling. I have left that file untouched per the instruction and asked whether
the lead will apply the fixture change or authorize it here. No hook workaround was added.

Round-2 bot passed again: exit 0, Medium/plains, 2015 residents
**[61124, 93804, 37971] = 192,899**, identical to the baseline. The command reused round 1's scratch-only
resolver because `tsx` is unavailable in this offline environment:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --experimental-loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T051/scratch/resolve-ts.mjs tools/simbot.ts --size 128 --years 15 --seed 7
```

Output: the assigned T051 scratch directory's `simbot-128-y15-s7-round2-native.log`. No balance or simulation
code changed. The prescribed `npx tsx` command and its original offline-cache failure are recorded below.

### Round-2 handoff

- Plant-load transport/caller wiring remains with the lead, as requested; the unavailable path is unchanged.
  No new cloud-held-file request is added this round. The original exact request remains below.
- The required unchanged `buildingWork` gate needs the fixture decision above. Full Vitest and browser/GPU checks
  remain lead-owned; no browser, full suite, benchmark, Hard bot or 256x60 bot was run.
- [ ] Resolve the no-registration compatibility fixture and rerun `buildingWork.test.ts`.
- [ ] After plant-load wiring lands, verify 0/340 refinery = 0 particles and 15% coal <=40% of full particles
  (uncapped variant 0 remains 10/36 = 27.78%).
- [ ] In a growth burst across a month boundary, verify geometry and activity take alternating hook turns and
  preserve T040's 2 ms deadline plus one indivisible unit; include the other lanes' work after merge.
- [ ] Verify same-step plume updates avoid reconstruction, positive reconstruction stays monthly, and shutdown,
  fire, construction, load/reset and LOW/HIGH behavior match the round-1 checklist below.

## Round-1 report (historical verification before commit 745fa6e)

Implemented on the supplied T040 base; the following records round 1's changes and checks.
Read T040's report first, POLISH_PLAN FEEL-15 and sections 7.2–7.4 / 6.4–6.5, WORKER_DESIGN section 6 and its
read-model/query sections, and the named renderer/effects code. No applicable AGENTS.md or CLAUDE.md was present.

**Remaining integration dependency:** this base's `UtilitiesView` exposes only `waterQualityAt`. It has no plant
load, and mirrored building records contain none. The render side accepts the exact load through the callback
below, but the normal CityScene does not supply it yet. Therefore the live 15% coal acceptance gate remains open;
the renderer/particle tests establish it with injected view data. Unknown load draws no operational plume.

## Changes per file

- `src/render/city/buildings/BuildingRenderer.ts`: adds `BuildingVisual.activity` and its sampled month. Industry
  uses mirrored `jobs / capacity`, clamped to 1; generators use `max(0.25, min(1, plantLoad(id)))`. Unpowered,
  constructing, abandoned, burnt, invalid/zero-capacity, or below-10%-staffed buildings have zero activity. Exactly
  10% is active. A callback returning null, negative or non-finite plant load means unavailable, not full load.
  Maintains a set of industry/generator entries and a monthly iterator, since rolling staffing patches do not
  emit `buildingChanged`. Event changes enter a deduplicated set. Refreshes and their visual callbacks run inside
  the existing 2 ms geometry deadline, without geometry allocation or a per-frame full-city scan. Geometry keeps
  T040's mandatory first admission; activity uses remaining time, or its own bounded slice when no geometry waits.
  Clear/remove/dispose discard activity work, and queued structural changes retain their old visual until swap.
- `src/render/city/effects/Effects.ts`: quantizes positive activity to 25/50/75/100% particle strengths (zero is
  separate). Scales exported smoke, steam, light exhaust and the geometry fallback; fire and construction dust
  retain their counts. Same-step callbacks preserve emitter objects and GPU attribute versions, even in a new
  month. Positive plume reconstruction is limited to once per building per month. Shutdown zeros existing
  operational emitter counts in place immediately; restart/another positive step waits for the next allowed
  month. Removal and clear release plume history.
- **Outside the task's two named source files:** `src/render/city/CityObjectsView.ts` has two small integration
  hunks: optional `getPlantLoad` in the context, assigned before initial rebuild; and `effects.clear()` before a
  full building rebuild. The latter prevents an old city's same-id/same-month plume cache from suppressing a
  replacement city's initial output, and removes old emitter groups. No other existing source files changed.
- New tests: `tests/render/smokeActivity.test.ts`, `smokePlumes.test.ts`, and `smokeView.test.ts` cover the activity
  inputs/budget, particle steps/cache/rate limit, and the actual CityObjectsView callback/reset path respectively.
- This task-named report. **No `src/sim/infra/*` hunks, held-file edits, simulation/save changes or RNG draws.**

## Verification

`npx tsc --noEmit` passed. `git diff --check` passed. All Vitest/bot commands ran sequentially through the quiet
gate; no browser, full suite, bench, other worktree, commit or branch operation was used.

The prescribed Vitest invocation failed before tests with `spawn EPERM` while Vite loaded its config. T040's
existing native-config/thread-pool workaround succeeds, without changing repository config. Each test file is
run separately with:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types node_modules/vitest/vitest.mjs run <file> --maxWorkers=1 --configLoader native --pool threads
```

| Test file | Result |
|---|---|
| `tests/render/smokeActivity.test.ts` | 15 passed |
| `tests/render/smokePlumes.test.ts` | 17 passed |
| `tests/render/smokeView.test.ts` | 4 passed |
| `tests/render/buildingBudget.test.ts` | 22 passed, including final scheduler revision |
| `tests/render/fireworks.test.ts` | 12 passed, 2 skipped, including final reset revision |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 skipped |

Total: **87 passed, 3 skipped**, including **36 new tests**.

Acceptance evidence:

- The real `ind_refinery.id.4` with jobs/capacity **0/340** has activity **0** and **0 particles**.
- Per-plant callback load **0.15** gives activity **0.25**. Actual coal variant 0 emitters produce **10 particles**
  versus **36** at full load: **27.78%**, below **40%**. A short Node probe recorded these counts in
  `scratch/coal-particles.json`; tests also cover steam/exhaust and all four steps.
- Same-step updates have no emitter reconstruction or GPU-buffer upload. Repeated positive step changes within
  one month retain the prior emitter list; a later month permits one replacement. Immediate zero retains emitter
  object identity and only zeros operational counts, leaving all eight fire emitters unchanged.
- Budget tests charge output reads 0.65 ms each: four entries consume **2.6 ms**, the 2 ms deadline plus one
  indivisible entry. Another case charges an output entry 3.25 ms and verifies geometry was admitted first.
  These are deterministic scheduling checks, not GPU timings.

### Bot

The requested command was attempted and failed because `tsx` is absent from the offline npm cache (`ENOTCACHED`):

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

The same unchanged bot completed with Node's TypeScript transformer and a scratch-only extension resolver,
following T040's precedent:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --experimental-loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T051/scratch/resolve-ts.mjs tools/simbot.ts --size 128 --years 15 --seed 7
```

Exit 0; Medium / plains; 2015 residents **[61124, 93804, 37971] = 192,899**, exactly the required baseline.
Output files under the assigned T051 scratch directory: `simbot-128-y15-s7-tsx.log` (failed prescribed launch) and
`simbot-128-y15-s7-native.log` (successful run). No balance changes are expected. No Hard run, 256x60 run or
two-process yearly hashes were needed/run for this renderer-only change. The full suite remains with the lead.

## Plan/code differences and exact cloud request

1. **Missing view input, not approximated:** add `UtilitiesView.plantLoad(id: number): number | null` in
   `src/worker/SimHost.ts`. In `localViews().utilities`, delegate to the existing
   `UtilitiesSystem.plantLoad(id)`, normalizing missing/negative/non-finite values to null.
2. **Mirror it for loopback and real worker:** in `src/worker/protocol.ts`, add an optional utilities stream
   snapshot, e.g. `{ plantLoads: { ids: Uint32Array; loads: Float32Array } }`, shared by ready/resync and packets.
   In `recorder.ts`'s `streams()`, publish all live `powerOut > 0` producer loads (including incinerators) on
   full ready/resync and after a utilities pass, independently of overlay/focus. An empty snapshot clears removed
   producers; an omitted stream preserves the previous snapshot. Use the existing read-only plantLoad API; no
   infra mutation/refactor is requested. In `replica.ts`, own the id-to-load map, clear it on adopt, apply the
   optional stream, and expose null before data arrives. In `LoopbackSimHost.ts` and the cloud's WorkerSimHost
   view, forward `utilities.plantLoad` to that replica map. Keep the new packet member optional for older packets.
3. **Final caller wiring:** in `src/game/CityScene.ts`'s CityObjectsView creation/context block, add
   `getPlantLoad: (id) => this.host.utilities.plantLoad(id)`. The receiving context and renderer assignment are
   already included in this lane's minimal CityObjectsView hunk. This caller edit is left with the lead alongside
   the held worker API so this branch compiles before that API exists. No App/main.ts edit is requested.
4. Inspector queries already return an exact numeric grid load, but using them here would depart from the task's
   named input paths. No inspector polling, aggregate city-load estimate or simulation read was added.
5. **Rate-limit scope:** at-most-once-per-month applies to activity-driven operational emitter reconstruction.
   Model/placement changes, fire, construction, removal and full load/reset retain their existing lifecycle
   rebuild behavior. Immediate zero changes particle counts and uploads buffers without reconstructing emitters.
   Other positive changes can remain at their previous step until the next month. A continuous stream of
   indivisible geometry builds exceeding the entire deadline can delay monthly output work; preserving T040's
   first-geometry admission and overshoot bound takes priority.
6. Literal plant floor semantics also allow quarter-strength smoke at reported load 0, provided the plant is
   powered and >=10% staffed. The task does not distinguish a generator shut down by policy but powered by another
   plant; no unmirrored policy/output factor was invented.

## Round-1 lead/browser checklist (historical)

This was the original handoff before the approved round-3 input work and the real-GPU QA below. At that point no
browser/GPU measurement, full Vitest run or old-save playthrough had been performed. The completed gates and QA
rows now supersede the covered items; the QA's own coverage notes identify checks that remain open. The two
fireworks fixture cases needed optional `SIM_FIXTURES` files, and the hygiene skip was pre-existing.

- [ ] Complete the UtilitiesView transport/caller request; verify distinct disconnected grids use their own loads.
- [ ] Inspect a real **0/340 refinery**: no operational smoke; fill >=10% jobs and advance a month to see smoke return.
- [ ] Inspect a **15% coal plant** and a full-load equivalent, same variant/quality: <=40% of full particles
  (uncapped variant 0 expectation: **10 versus 36**, **27.78%**). Include gas exhaust and nuclear steam.
- [ ] Vary staffing/load repeatedly within one month: <=1 positive operational reconstruction per building;
  same-step changes leave emitter/buffer versions unchanged. Power loss or <10% staffing stops the plume once
  the budgeted update drains; a same-month restart may wait for the next month.
- [ ] Fire and construction dust retain their existing appearance/counts; abandonment, burn-down, removal and
  queued model swaps leave no persistent operational plume. Selection/picking/fireworks remain correct.
- [ ] Load/reset cities reusing the same building ids/month; smoke initializes from the new city immediately.
  Continue an old save and switch LOW/HIGH; inspect smoke after the geometry/activity backlog settles.
- [ ] On the real GPU, check T040's 2 ms scheduling/one-entry overshoot and the polish feedback frame budget during
  growth/month boundaries. Full Vitest, visual playability and GPU timing remain lead-owned checks.

## Real-GPU QA on the desktop (10 Nov, 97691ad against dev 1c2019c)

**Verdict: every FEEL-15 Acceptance line passes** on the RTX 5070 Ti (ANGLE D3D11, driver 610.47, Chromium 141), on the default host, `?simworker=loopback` and `?simworker=1`. Gate on 97691ad: tsc, vitest 243 files / 2,443 tests, the bot identical (192,899). The QA agent's report follows; its three low findings (two older than this lane) go to the polish backlog, not to a fix round.

### QA: T051 · FEEL-15 · smoke that reads output (real GPU)

Folder (`QA` below): `C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\qa\T051`.
I did not edit either tree. T051 was served by its own Vite on 5643, and the dev checkout (A/B base) on 5646. Vite used a
wrapper config in `QA\cfg` (it imports the tree's `vite.config.ts` and adds only COOP/COEP headers and a cache dir in my
folder), so nothing was written into the trees. Every server and browser I started is stopped, and both trees are clean
(`git status`: T051 0 lines; dev only the pre-existing `?? .claude/`).

QUIET: the flag came up at 19:26:52 while my first session was running. I saw it at 19:33 and closed my browser. The
timing run's browsers started at 19:36:58, after mine had closed. After that my driver closes itself the moment QUIET
appears, and I launched nothing until the flag cleared at 19:44.

#### Environment

| | |
|---|---|
| GPU | `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11)` (WEBGL_debug_renderer_info, every session), driver 610.47 |
| Browser | Chromium 141.0.7390.37, the headless shell that the tree's Playwright 1.56.1 launches by default (`chromium.launch({headless:true, args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=default']})` plus no background throttling); 1280x720, DPR 1, cross-origin isolated. Playwright 1.56.1 maps to revision 1194. `ms-playwright\chromium-1234` is Chromium 151.0.7922.34 and was not used. |
| OS / Node | Windows 10 Education 10.0.19045, Node 22.12.0 |
| T051 | `C:\Users\techsin\Desktop\projects\simcityweb-T051`, local/T051-feel15-smoke, **97691ad** (clean): dev 87c7c9c (T040, T053) merged over the plant-load round, whose last commit is 142c612 |
| A/B base | `C:\Users\techsin\Desktop\projects\simcityweb` at dev **1c2019c** (clean, read-only: T040 included, T051 not) |
| Cities | `small_s7_y10` (128², 101,602 residents, 2,765 buildings, one grid: coal #5092, gas #656, 6 wind turbines; 51 plume industries); `vet_s7_y43` (256², 991,343 residents, 11,495 buildings, 3 coal, 1 gas, 2 nuclear; about 405 output buildings). Both imported programmatically. HIGH, fixed hour 13, no tips, autosave or New Year. |
| Hosts | default = `LocalSimHost` (`utilities.plantLoad` present); `?simworker=loopback` = `LoopbackSimHost`; `?simworker=1` = `WorkerSimHost` (simWorker.ts running). On both packet hosts `utilities.plantLoad` is absent (T061 not landed). |
| Harness | `QA\drv.mjs` (driver), `QA\send.mjs`, `QA\lib.js` (page helpers: particle counts per building, a stale-plume audit, month runner), `QA\cmds\*.mjs` (one per check), `QA\run_*.sh` (batches). "Particles" means a building's operational emitter counts (smoke, steam, exhaust) in `Effects.emitters`. "Step" is `Effects.plumes.step`. |

#### Results

| # | Item | Result | Measured | Evidence |
|---|---|---|---|---|
| 1 | The 0/340 refinery (no workers) shows no smoke (default host) | **PASS** | Refinery #535 (ind_refinery.id.4), sim held. As loaded 326/340: 54 particles (step 4). Set to 0/340 (record change + buildingChanged): **0** at once (counts zeroed in place). 17/340 (5 %): 0. Phase-independent picture (brightest of 24 frames over 4 s): the luminance of the box beside the stacks went 146.3 → 125.3 on T051 (plume gone) and 146.7 → 147.8 on dev (plume stays). Dev at 0/340: **54** particles. Naturally (labour shortage): 46 plume buildings under 10 % staffed, 0 particles. | `ev\ab_refinery_0of340.jpg`; `out\t051h_refinery.json`, `out\t051_refinery_max.json`, `out\dev_refinery_max.json`, `out\devh_refinery.json` |
| 2 | Industrial plume steps with staffing: four steps, zero when unpowered or under 10 % staffed | **PASS** | Every month boundary at ultra, after the refresh drains, all plume buildings checked against `ceil(min(1, jobs/cap) × 4)`, or 0 when unpowered or under 10 %. Mild shortage (540 homes bulldozed): steps 3 and 4, 51/51 match for 3 months; particle ratio to the building's own full count: step 3 0.778-0.80, step 4 1.0. Deep shortage (1,615 homes): step 2 (0.50), then step 1 (0.278-0.30), then 46 at step 0 with 0 particles; 51/51 match for 6 months. Unpowered refinery #647: 78 → 0 at once (dev: 78). Factory #3841: 157/170 → 36 p, 61/170 → 18, 19/170 (11 %) → 10, 14/170 (8 %) → 0. Loopback showed exactly 10 % (17/170) as step 1. | `ev\t051_staff_sheet.jpg`; `out\t051h2_staff_mild.json`, `out\t051h_staff.json` |
| 3 | Default host: a coal plant at 15 % of its grid's load shows at most 40 % of its full-load particles | **PASS** | Coal #5092 with 2 coal plants and 2 gas plants added to its grid: load **0.153**, activity 0.25 (the floor), step 1, **10** particles. The same plant at load 0.796 (added plants removed, utilities funding 10 %): step 4, **36**. **27.8 %**. As loaded (0.398): step 2, 18. A/B: dev shows 36 at load 0.14 (always full). Big city: coal 10/36 at load 0.152 against 0.92. | `ev\t051_coal_15_vs_full.jpg`, `ev\ab_coal_dev_vs_t051.jpg`; `out\t051h_coal_add2.json`, `out\t051h_coal_full.json`, `out\devh_coal_add2.json` |
| 3a | Gas exhaust and nuclear steam (lane checklist) | **PASS** | Gas #656: 10 vs 36 (27.8 %). Nuclear #25949 and #35045 (7 nuclear plants added, then removed): **14 vs 52 (26.9 %)**; as loaded (0.506) step 3, 40. | `ev\t051_nuclear_15_vs_full.jpg`; `out\t051h_big_add.json`, `out\t051h_big_full.json` |
| 4 | Emitters rebuild at most once per building per month (several months at ultra) | **PASS** (activity-driven); see bug 2 for lifecycle | `Effects.onBuilding` wrapped, counting per (building, month). 9 runs, 5,793 building-months (small city: growth 2 × 12 months, coal phases, two shortages; big city: 4 and 10 months; loopback and worker 8 months each). **Activity-driven rebuilds: 423, never more than 1 per building-month.** Plus 3,070 creations, 41 lifecycle rebuilds and 137 immediate stops (in place, no rebuild). Counting lifecycle too (fire, abandonment): 3 building-months reached 2 (activity step, then a fire or abandonment in the same month). Plain growth over 12 months: T051 had 0 activity rebuilds and 2 lifecycle; dev had **48** list replacements (it also rebuilds the dust at each construction quarter) and up to 3 list constructions in a building-month. | `out\rebuild_table.json`, `out\*rebuild*.json` |
| 4a | Mid-month staffing changes (event path; lane checklist) | **PASS** | Refinery #809 in one held month: 60 % → 30 % → 95 %: plume stays at step 4, same list. 5 % → 0 at once (in place). 80 % and 45 %: stays at 0. Next month: one rebuild (step 4, sim staffing 302/340). | `out\t051h_ratelimit.json` |
| 5 | Fire, construction dust, burn-down (lane checklist) | **PASS** | The player's fire on unstaffed factory #3841: 0 plume + **118** fire particles. On staffed #2628: 18 + 118. Dev gives the same 118, and keeps the full plume (36) on the unstaffed one. After the fire, plumes follow staffing (see bug 2). 20 constructing buildings: all have dust (6), none a plume. Burnt rubble: no plume (audit). | `ev\t051_fire_a.jpg`; `out\t051h_fire.json`, `out\devh_fire.json` |
| 6 | `?simworker=loopback`: plants "unavailable" (expected until T061); clean degradation | **PASS (as expected)** | `plantLoad` absent, so load null, activity 0, **no plume on coal or gas**: expected, not a failure. The replica's own map is filled by T051's stream (0.4081 against the core's 0.4130, which is drift under 0.005 accumulating as designed; 0.1559 = 0.1559 later). Industry follows the mirrored staffing: 49-51/49-51 every month, steps 2 → 1 → 0 (40 at step 0, 0 particles). Stale audit clean throughout: no orphan emitters, no particles without activity, no plant particles without load, no wrong or stale steps. Bulldozing refinery #1241 (78 p) removes its emitters. Utilities streams per month for months 120-128: 0, 1, 1, 0, 5, 5, 1, 0, 0, out of 2,099 packets (never every packet; unchanged months send none). | `out\t051lb_*.json` |
| 7 | `?simworker=1` (real worker): the same | **PASS (as expected)** | Same as loopback: plants show no plume (load unavailable), replica map filled (0.3976 from the Ready). Industry 51/51 every month (steps 2 → 1 → 0, 43-45 at 0). Audit clean. Bulldoze clean. Streams per month: 0, 1, 1, 1, 6, 5, 1, 0, 0 out of 513 packets. | `ev\t051w_staff_sheet.jpg`, `ev\t051w_coal_unavailable.jpg`; `out\t051w_*.json` |
| 8 | Load and resync: smoke starts from the new state (lane checklist) | **PASS** | Resync forced through the replica's own resync request on loopback and on the worker: one 'reset', the adopt carried the full plant-load snapshot (8 ids), and the audit was clean afterwards (46/45 groups, 9/6 operating, 0 stale). Local: repeated re-imports of the same city (same ids and month, a new scene each time): plumes as at first load, audit clean. | `out\t051lb_resync.json`, `out\t051w_resync.json` |
| 9 | LOW / HIGH at runtime (lane checklist) | **PASS** (see bug 3, pre-existing) | Big city, HIGH → LOW → 2 months → HIGH: audit clean at every point; LOW smoke capped at 2,500. | `out\t051h_*` (eval output in the run log) |
| 10 | Activity refresh at speed and the hook (lane checklist, indicative) | **PASS** | Big city, 9 months at ultra (about 90 frames a month): every output building refreshed every month (lag 0, 1 only just after a boundary). A burst of 150 plops just before a boundary: the 411-unit refresh finished in 2 frames (262 units in a 2.0 ms frame with 4 builds, then 149 in 0.85 ms), and 17 frames interleaved both kinds. Over 52 working frames: p50 0.15 ms, p95 1.73 ms, max 5.3 ms (one frame: 1 unit + 2 geometry builds, T040's indivisible build). Indicative only: other agents' browsers were running. | `out\t051h_big_stale.json`, `out\t051h2_big_stale.json`, `out\t051h2_hook_summary.json` |
| 11 | Console and page errors (all hosts and sessions) | **PASS** | 0 page errors. The console showed only the baseline: the harness's `WEBGL_CONTEXT_LOST menu-bg-canvas attached=false` and D3D compiler warnings X4122 / X4000 (plus X3595 on quality switches); dev shows the same. | `out\*_errors.json` |

#### Bugs and deviations

1. **Low (pre-existing, kept by T051's cache): plume emitters are placed at the building's pop-in scale.**
   - **What happens.** `place()` folds the pop-in animation into `v.sy` (`BuildingRenderer.ts:2092-2093`). `Effects.onBuilding` places emitters at `baseY + ly * v.sy` (`Effects.ts:280`). The plume key at `Effects.ts:264` has no `sy`, so later same-step calls return early. A plume built during the pop therefore sits low until the building's next step change or lifecycle change.
   - **How often.** 5 of 278 operational builds in the T051 runs that logged it. Three were at sy **0.863** (construction finished with staff already above 10 %: refinery #5904 on loopback and the worker, #35400 locally): emitters 14 % low, inside the stack top. Two were at sy 0.977 (a monthly refresh during the pop). The ones I followed corrected themselves 1-2 months later, when staffing changed step. By the code, dev builds a finished industry's plume at the pop scale every time (it does not wait for staff) and never rebuilds it, so this is not a T051 regression.
   - **Fix.** Place operational emitters at full height when not constructing (`const sy = v.constructing ? v.sy : 1` for the smoke and steam entries in `Effects.ts:280`). Or keep the pop factor out of `v.sy` and apply it only to the instance matrix in `place()`.
2. **Low / deviation from the strictest reading: lifecycle rebuilds bypass the monthly limit.**
   - **What happens.** A key change (fire start or end, abandonment, construction finished) always rebuilds at the current step (`Effects.ts:266-277`). In 3 of 5,793 building-months the emitters were built twice: an activity step, then a fire or abandonment.
   - **The reverse case.** A lifecycle rebuild at zero activity holds a returning plume off for the rest of the month. Factory #2628 at 26 % staffing after its fire showed no plume until the boundary, then step 4. This is the documented scope of the lane report's item 5, and fire must start at once.
   - **Fix, if the strict reading is wanted.** On a key change with `previous.month === v.activityMonth` and `previous.step > 0`, keep `previous.step` for the operational part, so that only fire and dust follow the lifecycle. Otherwise accept and document it.
3. **Low (pre-existing, not T051): the smoke cap changes only at the next emitter change after a quality switch.**
   - **What happens.** `CityObjectsView.setQuality` sets `effects.maxSmoke` without marking the buffer dirty (`CityObjectsView.ts:282`; dev has the identical line at :278). After HIGH → LOW the 991k city kept 6,948 smoke instances (cap 2,500) while paused. After LOW → HIGH it stayed at 2,500 until something changed.
   - **Why T051 makes it a little worse.** Same-step updates no longer set dirty.
   - **Fix.** Make `maxSmoke` a setter in `Effects.ts` (around :222) that sets `this.dirty = true`, or call an `effects.markDirty()` after line 282.
4. **Note: the refresh restarts every month even when it has not finished** (`BuildingRenderer.ts:940-944`).
   - Under sustained geometry pressure for a whole month, buildings late in the set could be skipped. I never saw it: the 991k city finished every month within 1-2 frames.
   - Suggested hardening: start a new scan only once the current one is done, and rescan right after it if the month changed.
5. **Note (outside FEEL-15): the refinery's flare-tip flames are model geometry and stay lit at 0/340.** They are visible in `ev\ab_refinery_0of340.jpg`. They are not smoke particles.
6. **Expected, not a failure: no power-plant plume at all on `?simworker=loopback` and `?simworker=1` until T061.** The replica already holds correct loads (`Replica.plantLoad`), but the packet hosts' `utilities` view does not expose them (`LoopbackSimHost.ts:255`; `CityScene.ts:526` falls back to null). Nothing went stale: no errors, no plant particles, audit clean before and after resync.

#### Lane checklist (report draft) covered

- Round 3:
  - Covered:
    - local 15 % and full coal grids (activity 0.25 and 0.796; 27.8 %);
    - zero staffing and power stop the plume;
    - packet hosts unavailable before and after streams;
    - unchanged months send no utilities stream, and changes send one after a pass;
    - load and resync leave no stale producer data.
  - Not covered:
    - distinct disconnected grids (both test cities are single-grid);
    - an explicit empty snapshot;
    - the repeat on packet hosts after T061.
- Round 2:
  - Covered:
    - 0/340 = 0 particles, and 15 % coal 10 vs 36;
    - month-boundary burst (alternating turns, 2 ms plus one build; indicative);
    - same-step updates with no reconstruction, positive rebuilds monthly;
    - shutdown, fire, construction, load/reset, LOW/HIGH.
  - Not covered: other lanes' merged work in the same hook.
- Round 1:
  - Covered:
    - refinery returns after ≥ 10 % plus a month (#809, #3841);
    - gas exhaust and nuclear steam;
    - mid-month variation (≤ 1 positive reconstruction, immediate stop, same-month restart waits);
    - fire and dust counts unchanged;
    - removal and burn-down leave no plume;
    - reset with the same ids and month;
    - LOW/HIGH.
  - Not covered:
    - queued model swaps specifically;
    - selection, picking and fireworks interaction.

#### Evidence (8 screenshots, each viewed)

`ev\ab_refinery_0of340.jpg`, `ev\t051_staff_sheet.jpg`, `ev\t051_coal_15_vs_full.jpg`, `ev\ab_coal_dev_vs_t051.jpg`,
`ev\t051_nuclear_15_vs_full.jpg`, `ev\t051_fire_a.jpg`, `ev\t051w_staff_sheet.jpg`, `ev\t051w_coal_unavailable.jpg`.
The measurements are in `out\` (`rebuild_table.json` summarises the 10 rebuild runs). Full command outputs are in
`run\<session>\q\*.out.json`.
