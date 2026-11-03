# T051: smoke that reads output

Implemented on the supplied T040 base. Changes are uncommitted; no push or `.done` file, per the lane instructions.
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
