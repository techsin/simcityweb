# T073 — FEEL-16 local smog haze, QA fix round 2

Branch `local/T073-smog`. Round 1 is committed at `deb0ad9`; these NOTE-071 fixes are **uncommitted**.
The desktop worker reports round 1's full gate green and real-GPU FEEL-16 Acceptance checks passed. Its supplemental
`qa_round1.md` identified B1–B3 below; B4 (twilight dimming alongside the sun, with moonlight untouched) is
informational and keeps its behavior. Round 2 has not been browser-tested here.

## Changes per file

- `src/render/world/WorldView.ts`:
  - **B1 / NOTE-071:** the monthly snapshot reads catalog metadata with the renderers' existing `getDef` API.
    A building counts as polluted when `BF.Polluted` is set **or** `def.pollution.air > 0`. Buildings whose catalog
    category is exactly `park` or `civic` are excluded from both counts. Other categories, including utilities,
    transport, and non-emitting growables, remain eligible. Unknown defs still use flags. This is the lead's
    **reading of the plan under NOTE-071**, not an independent plan change. No pollution raster or sim-system read.
  - **B2:** density share and visible tint each ease with a **one-second time constant**. At the 2 Hz sample,
    the tint target is `smoothstep(0.25, 0.6, targetShare)`; this target is eased directly. Thresholding no longer
    delays arriving tint or cuts departing tint short. Density still multiplies the original climate/time/zoom
    haze by `1 + 2.5 * value`. Air-history blending remains
    `0.8 * localShare + 0.2 * min(localShare, latestAirHistory)`, with invalid history treated as zero.
  - **B3:** a fresh, branded replica of the same city keeps both eased values, while discarding its old monthly
    snapshot and rebuilding from the replacement. A direct `setState`, an unbranded/local reset, a same-object
    reset, or a different city starts from zero. The existing reset callback is reused; no new subscriptions.
    Identity checks size, seed, start year, name, region, and tile. `CityState` has no city UUID; the explicit
    resync path plus existing `REPLICA` brand distinguishes replica adoption from `Simulation.replaceState`.
- `src/render/world/PostFX.ts`: existing `uSmog` now carries the **eased tint factor** (0..1), consumed directly
  by the brown-grey composite tint. No shader-side threshold on the eased value. Still only one added uniform
  relative to pre-T073, no extra pass, texture sample, render target, or draw call.
- `src/render/world/Sky.ts`: the same eased tint directly controls sun/disk attenuation, from 1 to 0.75. No second
  threshold. Existing twilight policy, moonlight, LUT parameters, and LUT/PMREM refresh cadence are unchanged.
- `tests/render/smog.test.ts`: updated easing assertions; added symmetric partial-strength tint/density fade,
  immediate tint onset, below-threshold exact-zero tint, eventual exact-zero clean tail, and explicit adoption
  preservation versus reset coverage. Radius, 2 Hz sampling, history, monthly caching, and shader checks remain.
- `tests/render/smogWiring.test.ts`: updated tint-uniform and sun semantics; added exact-zero clean-city uniform
  checks and a reset matrix covering same-city replica resync, changed seed/name/region/tile, real/local reset,
  and a same-replica reset. All quality tiers and data overlays remain covered.
- `tests/render/smogEmitters.test.ts` (new): emitting factory/plant plus flagged homes; park/civic exclusion;
  all-excluded neutrality; positive/zero/negative/missing air versus noise-only metadata; missing defs; monthly
  cached emitter decisions. Uses actual catalog metadata, with temporary test metadata restored afterward.
- This report records the decisions, check results, and round-2 browser checklist.

**No infra hunks, no other source files edited, no cloud-held files edited, no cloud requests.** Importing the
existing replica brand from `src/save/state.ts` only reads its marker; that file is untouched. No simulation,
save schema, systemData, action, balance, or RNG changes.

The monthly rebuild remains O(buildings), only after invalidation and at most once per absolute game month
(initialization/resync rebuilds are exceptions). At 2 Hz an exact 32-cell circle checks at most nine spatial
buckets. Between samples only the two scalar easing updates run; no per-frame map scan or catalog lookup.
Low still changes density only. Data overlays disable density gain, tint, and sun dimming.

## Expected in/out times (B2)

Both directions use `1 - exp(-dt)` on the **visible tint itself**, including partial-strength tint. From the
first sample of the new district:

| Fraction of transition completed | Arriving | Leaving |
|---|---:|---:|
| 50% | 0.693 s | 0.693 s |
| 90% | 2.303 s | 2.303 s |
| 95% | 2.996 s | 2.996 s |

Sampling adds **0–0.5 s** each way, plus frame quantization: expect **about 3.0–3.5 s to 95%** after the camera move
at 60 fps. Tint begins on the first eased frame after the sample, with no extra threshold wait. These are scalar
expectations, not a new GPU measurement. The faint exponential tail snaps to exact zero below `1e-5` (at most
about 11.52 s after sampling a clean target). A fresh clean city is exactly zero from its first frame.

## Gates and diagnostics

| Check | Round-2 result |
|---|---|
| `npx tsc --noEmit`, including all three smog test files | **Passed.** |
| Focused Vitest, through quietrun | **Startup blocked:** Vite config loading fails before collection with `externalize-deps` / `windowsSafeRealPathSync` / `spawn EPERM`. No round-2 Vitest pass claimed. |
| Short native Node diagnostic | **Five checks passed:** emitters/denominator; dirty monthly cache; symmetric tint/density easing and exact-zero tail; production `setState` resync/reset routing; clean high-history exact-zero values. |
| `git diff --check` | **Passed.** |
| 128 × 15 seed-7 bot, through quietrun | **Could not start:** `tsx` is unavailable in the offline npm cache (`ENOTCACHED`). Expected unchanged 2015 residents `[61124, 93804, 37971]`, total **192,899**, not remeasured here. |
| Full Vitest, two-process Medium/Hard hashes, old-save continuation | Not run here. Round-1 full gate is green per desktop worker; round-2 focused/full reruns remain with lead. |
| Real-GPU acceptance, transition timings, and frame cost | Not run here, per lane rules; browser checklist below. |

The native diagnostic extracts the production `DistrictSmog` class and `WorldView.setState` method verbatim and
runs them using Node type stripping, actual Three math helpers, and small metadata/state stand-ins. It does not
replace Vitest or GPU QA. Scratch files: `smog-round2-probe.mts`, `smog-round2-probe.txt`,
`vitest-round2-smog.txt`, and `simbot-round2-128x15-s7.txt`.

Exact attempted commands from this worktree:

```powershell
npx tsc --noEmit
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/render/smog.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

The bot uses default Medium, plains, water 0.2, default profile, no strategy flags. Check all three wealth counts
as well as their 192,899 total; no 256 × 60 run is needed for this render-only fix.

Rerun these files separately with the same quietrun prefix and `npx vitest run <file> --maxWorkers=1`:

- `tests/render/smog.test.ts`, `tests/render/smogWiring.test.ts`, `tests/render/smogEmitters.test.ts`.
- Existing render coverage: `tests/render/lighting.test.ts`, `tests/render/shadows.test.ts`,
  `tests/render/cutShadows.test.ts`, `tests/render/seasons.test.ts`, `tests/render/exitRetention.test.ts`,
  `tests/render/pendingPreviews.test.ts`.
- Existing worker coverage: `tests/worker/worldResync.test.ts`, `tests/worker/hygiene.test.ts`.

## Plan/code notes

- NOTE-071 supplies the emitter/denominator and whole-transition readings above. The original plan's global
  constant haze reference is obsolete; the existing climate/time/zoom baseline is preserved.
- The raw pollution raster remains unnecessary. The flag and catalog metadata are read only when building the
  monthly snapshot; the city's air history is mirrored plain data. Old saves need no new keys.
- The old QA clean fixture cleared `BF.Polluted` but retained emitting factories/plants. Under NOTE-071 that is
  **not a clean district**. For the unchanged-clean comparison use a neighborhood with neither eligible flagged
  buildings nor positive-air-emitting defs. Stale city air history alone still gives exactly zero smog.
- Supplemental round-1 QA reported R−B +8.9 on the qualifying dirty view, Low density-only and all data views
  correct, and moonlight unchanged. It left controlled frame-cost timing pending. These historical measurements
  are not claimed as round-2 results.

## Round-2 browser checklist

- [ ] **B1:** revisit the bot industrial core (220,104) and dense1m industrial cores. Confirm factories/plants count
  without flags and `park`/`civic` categories do not dilute the share. Check brown-grey tint and sun dimming on
  Medium/High/Ultra; repeat the ≥6-level frame-average R−B Acceptance comparison over a qualifying dirty district.
- [ ] **B2:** pan dirty → clean and clean → dirty from settled endpoints. Measure 50/90/95% transitions against
  0.693/2.303/2.996 s plus up to 0.5 s sampling lag, each way. No multi-second initial brown delay; no abrupt
  disappearance on leaving. Also check a district whose target tint is below full strength.
- [ ] **B3:** loopback and worker resync at a fixed dirty view: preserve raw `value`, `tint`, and current uniform;
  rebuild once from the fresh replica without the former clean-frame flash. Direct/local reset and a different
  city must start from zero.
- [ ] **Clean baseline:** use a genuinely clean/empty district with no flags or emitting defs, and stale air
  history 0.9. Confirm density gain/tint/sun values exactly match base across tiers, day/dusk/night, and climates.
- [ ] **Quality/overlays/B4:** Low density-only; all 25 data overlays disable the whole smog effect. Normal view
  restores it. Twilight policy remains as round 1, and moonlight stays unchanged.
- [ ] **Cost/cadence:** monthly rebuild limit after hundreds of invalidations; 2 Hz nearby sampling; all other
  frames avoid map/catalog traversal. Repeat the controlled large-save rest/pan timing gate; no new draws/passes.
- [ ] Rerun focused/full Vitest and the exact bot command above; check **192,899** and its three wealth counts.
