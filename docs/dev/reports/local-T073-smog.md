# T073 — FEEL-16 local smog haze

Branch `local/T073-smog`, based on dev `1c2019c`. Changes are uncommitted.

## Changes per file

- `src/render/world/WorldView.ts`: `DistrictSmog` snapshots mirrored building centers and `BF.Polluted` into
  32-cell buckets after pollution/building changes, at most once per absolute game month (plus initialization or
  replica replacement). At 2 Hz it checks at most nine buckets and an exact 32-cell circle, counting each building
  once. Smog is `0.8 * localShare + 0.2 * min(localShare, latestAirHistory)`, with invalid history treated as zero.
  This keeps clean districts neutral even with stale dirty-air history. The scalar eases with a three-second
  exponential time constant. Existing event callbacks invalidate the snapshot; reset drops it. Haze gains
  `1 + 2.5 * smog`. All data overlays disable the effect; Low keeps density only.
- `src/render/world/PostFX.ts`: one new float uniform, `uSmog`, in the existing composite. Above 0.25 it applies
  brown-grey chromaticity `(0.55, 0.50, 0.42)`, normalized around green, reaching full strength at 0.6. The zero
  branch preserves existing grading. No new pass, render target, texture sample, or draw call.
- `src/render/world/Sky.ts`: a camera-local CPU scalar dims daytime direct light and the existing sun-disk value,
  smoothly to 75% at smog 0.6. Moonlight is unchanged. Smog does not change sky-LUT parameters, LUT invalidation,
  or environment refresh cadence.
- `tests/render/smog.test.ts` (new, 17 cases): radius/centers, unique counts, history handling, clean neutrality,
  2 Hz sampling including uneven frames, three-second easing, dirty/monthly cache rules, replica replacement,
  and the single-uniform/zero-branch shader contract without WebGL.
- `tests/render/smogWiring.test.ts` (new, seven cases): all four quality tiers, every data overlay, invalidation
  through existing callbacks and unsubscribe cleanup, sun threshold/floor, actual Sky update dimming, unchanged
  moonlight, and no additional LUT/PMREM refresh from smog.
- This report is the only documentation change. **No infra hunks, no source hunks outside the three owned files,
  and no cloud-held files changed.** No simulation, save schema, systemData key, command, or RNG draw changes.

The monthly rebuild is O(buildings). A 2 Hz sample only visits nearby buckets; the remaining per-frame work is
scalar easing and atmosphere values. No new event subscriptions were added: the existing WorldView callbacks and
their existing disposal cleanup are reused.

## Acceptance and checks

| Gate | Result |
|---|---|
| Dirty district (at least 60% Polluted): frame R−B rises by at least six 8-bit levels | **Pending real-GPU comparison.** Tint is implemented; no browser was run. Check Medium/High/Ultra; Low has the plan's density-only exception. |
| No change when nothing is polluted | Exact-zero cache result passed the native Node probe. Tests cover empty/clean districts with stale air history, plus zero shader branch. Pixel comparison remains for the lead. |
| One uniform added | Source diff adds only `uSmog`; the new PostFX test checks its declaration, shared uniform object, and neutral branch. |
| `npx tsc --noEmit` | **Passed**, including both new test files. |
| New focused Vitest files, through quietrun | **Startup blocked:** both files fail before collection while Vite loads `vite.config.ts`: `externalize-deps`, `windowsSafeRealPathSync`, `spawn EPERM`. No test pass is claimed. |
| Existing focused tests / worker hygiene | **Left to lead:** common Vitest startup failure prevents execution. Files listed below. |
| Native Node functional probe | **Passed:** exact circular radius/centers; monthly dirty snapshot/no repeated scan; high-history clean neutrality/replica replacement; three-second easing; 2 Hz uneven-frame cadence. This does not replace Vitest or GPU checks. |
| `git diff --check` | **Passed.** |
| 128 × 15 seed-7 bot | **Could not start:** `tsx` is absent from the offline npm cache (`ENOTCACHED`). Expected unchanged 2015 residents `[61124, 93804, 37971]`, total **192,899**; not measured here. |
| Medium/Hard determinism; old-save continuation | Render-only changes; expected unchanged. Two-process hashes and continuation runs were not performed. |
| Full Vitest / browser / real-GPU frame budget | Left to lead as requested. No full suite, bench, or browser run. |

Exact attempted commands (from this worktree):

```powershell
npx tsc --noEmit
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/render/smog.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx vitest run tests/render/smogWiring.test.ts --maxWorkers=1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

The bot uses default Medium, plains, water 0.2, default profile, no strategy flags. The rerun must reproduce all
three wealth counts and their 192,899 total in 2015. No 256 × 60 run is needed for this render-only item.

Rerun each test file separately using the same quietrun prefix and `npx vitest run <file> --maxWorkers=1`:

- New: `tests/render/smog.test.ts`, `tests/render/smogWiring.test.ts`.
- Existing render coverage: `tests/render/lighting.test.ts`, `tests/render/shadows.test.ts`,
  `tests/render/cutShadows.test.ts`, `tests/render/seasons.test.ts`, `tests/render/exitRetention.test.ts`,
  `tests/render/pendingPreviews.test.ts`.
- Existing worker coverage: `tests/worker/worldResync.test.ts`, `tests/worker/hygiene.test.ts`.

Diagnostics in the supplied T073 scratch folder: `vitest-smog.txt`, `simbot-128x15-s7.txt`, `smog-probe.mts`, and
`smog-probe.txt`. The probe extracts the production DistrictSmog class verbatim and executes it with Node's type
stripping against small read-model stand-ins; it is a functional diagnostic, not a timing run.

## Plan versus current code

- The plan's constant global-haze reference is obsolete: WorldView already varies haze by climate, golden hour,
  and camera distance. The multiplier preserves that baseline.
- FEEL-16 explicitly specifies building flags rather than the pollution raster. Exact mirrored flags and monthly
  mirrored `history.air` are available; the raw air raster is only subscribed in its overlay. No sim read or new
  worker subscription is used.
- `BF.Polluted` currently applies to residential/commercial buildings and can also represent severe water
  pollution. Pure factory/plant blocks may therefore have no smog under the specified flag metric. This follows
  FEEL-16 literally; the air simulation was not changed.
- The plan leaves the history blend weights and tint ramp unspecified; the values above keep the signal local
  and clean districts neutral. Easing uses a three-second time constant, so visual comparisons should allow
  about 12–15 seconds to settle after a camera move.
- **Cloud-held file requests: none.** Existing host-backed state/events and reset accessor supply the needed data.

## Browser checklist for the lead

- [ ] On Medium, High, and Ultra, compare the same fixed camera/time/climate over a district with at least 60%
  Polluted buildings within 32 cells. Allow 12–15 real seconds to settle. Measure frame-average R−B against the
  clean/control frame: increase must be at least six 8-bit levels. Confirm brown-grey haze and a dimmer sun.
- [ ] Pan between dirty and clean districts: updates sample at 2 Hz and ease smoothly, without LUT/PMREM refresh
  spikes caused by the camera-local smog value.
- [ ] On an entirely clean/empty city, compare baseline pixels at day/dusk/night and across climates; stale air
  history alone must not change the frame. After leaving dirty air, allow easing to finish.
- [ ] Open each data overlay, including Air and Emergency: smog density gain, tint, and sun dimming are disabled;
  returning to normal world restores them.
- [ ] Switch all four quality tiers. Low changes only haze density; Medium/High/Ultra also tint and dim the sun.
  Check both daytime and moonlit night; the moon keeps its brightness.
- [ ] Change pollution/buildings, advance to the following game month, and confirm the snapshot updates once;
  repeated pollution events in one month do not rebuild the map-sized cache repeatedly. Reload/resync and confirm
  no stale district values survive.
- [ ] On the 287k save, check all quality tiers while panning and at rest, including a monthly rebuild frame:
  remain within the round's +1.0 ms/frame and +3-draw-call budget. This implementation adds zero draws/passes.
- [ ] Re-run focused/full Vitest and the exact bot command above; verify the unchanged resident counts.
