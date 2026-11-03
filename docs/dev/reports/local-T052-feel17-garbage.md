# T052 / FEEL-17: kerbside garbage

Implemented the view-layer feature. TypeScript and 102 targeted tests pass (one existing skip). The seed-7 128x15 bot retains residents `[61124, 93804, 37971]` = **192,899** in 2015. Changes are uncommitted; no push or `.done` file.

The real-GPU gates remain for the lead. **The landfill-connection clearing deadline is not guaranteed by the existing flag timing**, as explained below.

## Changes by file

- `src/render/city/props/PropRenderer.ts`: one additional InstancedMesh for bags and bins, one material, no shadow-caster draws or material groups. Alternate position/normal/colour attributes select the shape per instance; shorter geometry is padded with degenerate triangles, so both variants cost **28 submitted triangles per visible instance**. CPU compaction excludes each prop at distances >=900 m, including camera height. Only day, relevant building/terrain changes or camera movement repack the mesh. Capacity growth and teardown dispose owned resources.
- `src/render/city/CityObjectsView.ts`: small integration hunks in existing building/terrain listeners, rebuild, frame update and draw-call statistics. Reads mirrored records and event-time `state.day`; no new listeners or host queries. Existing unsubscribe/dispose ownership stays in place.
- `src/assets/builders/prop.ts`: dark tied bag (28 triangles) and green bin with grey lid/handle (24 triangles); neither builder draws RNG.
- `tests/render/garbage.test.ts` (new): 18 cases covering all four lot fronts, rectangular footprints, terrain height, buildup/clearing, in-place mirrored records, repeated events, reversals, sparse frames, removal/reset/id reuse, exact 900 m culling, shader variant selection, one-mesh geometry, capacity/disposal and no mutation/RNG.
- **Outside named files:** `src/assets/builders/polish_stubs.ts`: removes the garbage stub and narrows its comment. `registerAllModels()` registers stubs last, so retaining this entry would overwrite the finished models.
- **Outside named files:** `src/assets/manifest.ts`: moves only `garbage_pile` from placeholder to prop and replaces its stub description, preserving id, footprint, variants and height range.
- **Outside named files / existing test:** `tests/assets/manifest.test.ts`: removes only `garbage_pile` from the neutral-labelled-stub list; its two-variant assertion remains. New tests cover the finished props instead.
- This report is the requested report artifact. **No `src/sim/infra/*` hunks. No cloud-held files changed.**

## Timing and determinism

Every newly flagged lot immediately gets one item, then reaches its id-hashed total of 1–4 in an id-hashed 30–60 days. Clearing takes 30–60 days from the mirrored flag clearing. Unrelated building events do not restart either ramp; reversals retain the currently visible count. Frame cadence does not affect the result. Fixed frontage slots avoid reshuffling as counts change.

Loaded/reset flagged lots start mature: flag-on dates are not saved or mirrored. Cosmetic transition state is renderer-owned, with no simulation writes, added simulation RNG draws, new systemData keys or save changes. Medium/Hard simulation paths are untouched. The bot result matches the specified baseline; separate full-state hash comparisons were not run.

## Checked gates

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass, including the new tests |
| `git diff --check` | Pass |
| `tests/render/garbage.test.ts` | 18 passed |
| `tests/assets/manifest.test.ts` | 20 passed |
| `tests/worker/hygiene.test.ts` | 17 passed, 1 existing skip |
| `tests/render/freshLoad.test.ts` | 12 passed |
| `tests/render/lod.test.ts` | 35 passed |
| 128x15 seed-7 bot | Exact required resident vector and total |
| Full vitest | Left for lead, per instruction |
| Browser / real GPU / screenshots | Left for lead, per instruction |

All vitest commands ran serially through the quiet gate. The default config loader failed with `spawn EPERM`; native config loading then reached the fork-pool restriction. The supported native config loader plus thread pool succeeded, using this command separately for each test file above:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types node_modules/vitest/vitest.mjs run tests/render/garbage.test.ts --maxWorkers=1 --configLoader native --pool=threads
```

The requested bot command was attempted:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

It failed with npm `ENOTCACHED`: tsx is not installed or available in the offline cache. No dependencies changed. The same bot ran successfully using Node 22's native TypeScript transformation and a scratch-only resolver for extensionless `.ts`/`index.ts` imports:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T052/scratch/resolve-types.mjs tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

Output: lane scratch `bot128_s7_y15_native.txt`; failed tsx attempt: `bot128_s7_y15.txt`. Successful run: **2015, `[61124, 93804, 37971]`, total 192,899**, exit 0. No 256x60 run was needed or performed; GPU acceptance can use the existing 287k or bot256_s7_y20/y60 fixtures. The original tsx command can be rerun when tsx is available; expected numbers are unchanged.

## Plan/code differences and requests

- `PollutionSystem.garbageApply()` (`src/sim/infra/pollution.ts`) clears `BF.NoGarbage` only once accumulated garbage drops below `NO_GARBAGE_THRESHOLD=.35`. With `GARBAGE_DECAY=.35` and `POLL_PERIOD=12`, a saturated lot requires three served passes: `1 -> .65 -> .4225 -> .274625`. That can delay the flag clearing by up to 36 days at nominal cadence after service resumes. Adding the requested 30–60 day visual clearing can therefore take up to **96 days after service resumes**, rather than guaranteeing >=90% gone within 60 days of connecting a landfill. The implementation honours the mirrored-flag-only rule and both visual ramps; it does not change simulation balance or read internal pickup state. The lead needs to resolve this acceptance conflict; the connection-based deadline is unverified and cannot be guaranteed from this flag alone.
- The final garbage asset still had a registered stub and a test requiring grey STUB lettering. The three minimal outside-file hunks above retire that interface correctly.
- Existing `CityObjectsViewContext` has no AbortSignal. No new listener was introduced: the feature uses the view's existing subscriptions and disposal.
- **Cloud-held file requests: none.** No new worker field/query is required for the implemented flag-driven behaviour. A different collection-based trigger would require a separate spec/interface decision.

## Lead browser checklist

- [ ] At 300 m, count NoGarbage lots and lots with visible bag/bin props: >=90%; inspect all four fronts, narrow lots, slopes and both variants. Capture screenshots.
- [ ] Observe a new flag transition: immediate one item, buildup to 1–4 over 30–60 days. Clear the flag: all props gone within 60 days; check reversals and pause/pan.
- [ ] Connect an adequate, road-connected landfill; record connection day, flag-clear days and visible clearing after 60 days. Assess the timing conflict above explicitly.
- [ ] Pan/zoom across 900 m: props disappear at the distance cut on every quality setting; no garbage draw when none are near.
- [ ] On the 287k save or existing bot256_s7_y20/y60 fixture, compare the same camera/quality with garbage disabled/enabled: **+1 main draw call**, **<=5% more triangles**. Geometry tests establish the 28-triangle cost, not the real-GPU percentage; nearby off-screen instances are still submitted.
- [ ] Load an older save, reset/reload, demolish flagged buildings and exit/re-enter the city; confirm mature flagged props and no stale instances. Capture before/after landfill and near/far screenshots.
- [ ] Run the full vitest suite and the preferred tsx bot command when available. No browser, full suite, benchmarks, commits, pushes or `.done` files were made here.
