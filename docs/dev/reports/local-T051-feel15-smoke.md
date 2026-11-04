# T051: smoke that reads output

Round 1 is committed as `745fa6e`; round 2 as `51a04e0`. Round 3 starts at `d8e007c`, containing T040's test
fix and dev `759bbd4`. The worker reports that merged base passed 225 files / 2,268 tests and the identical bot.
Round-3 changes are uncommitted; no push or `.done` file. Read NOTE-054 and NOTE-048's standing worker rule.

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

### Round-3 verification

Verification is queued through the quiet gate while a real-GPU timing run holds the machine; results pending.

### Round-3 compatibility difference and cloud handoff

This checkout's PacketSimHost/LoopbackSimHost utilities object still has only `waterQualityAt`. A required view
method would make it structurally incomplete until T061 (d) lands, and the direct caller would throw while
constructing a plant view. To preserve NOTE-054's explicitly expected interim "unavailable" behavior, (a) makes
the capability temporarily optional and (e) guards the caller with `?.(id) ?? null`. These are the only differences
from the signature/caller shown in the task. The Local reader itself is present and real. No forbidden forwarding
file was edited. After T061 provides the reader on both packet hosts, the optional marker/guard may be tightened
if the lead wants a required interface; forwarding remains cloud-owned.

Round-3 browser checklist:

- [ ] Local host: inspect 15% and full coal grids; expect activity 0.25/1 and <=40% of full particles.
- [ ] Change one grid's load and advance a month: its plume follows its own grid. Check zero staffing/power stops it.
- [ ] After T061 forwarding lands, repeat on loopback and real worker; verify unavailable before the first stream.
- [ ] Confirm unchanged months send no utilities stream, and significant load/add/remove changes send one after
  completion; load/resync and explicit empty snapshots leave no stale producer data.
- [ ] Full Vitest and real-GPU smoke/frame checks remain with the lead.

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

## Remaining lead/browser gates

No browser/GPU measurement, full Vitest run or old-save playthrough was performed. The two fireworks fixture cases
need the optional `SIM_FIXTURES` files; the hygiene skip is pre-existing. Plant-grid correctness in the running
game cannot be verified until the view/transport/caller request above lands.

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
