# T045 — LG-08 transit-oriented development

Base: `fb1531f`; branch `local/T045-lg08-tod`. Changes are uncommitted. No push, commit, merge or `.done` file.

## Changes

- `src/sim/economy/growth.ts`: connected passenger stations create tower lots within an inclusive Euclidean radius of 6 cells from `centerCell`. Existing downtown/hash eligibility remains. `stationLotMask` is the pure geometry function; `stationTowerLots` caches its result by traffic identity/graph version and station/network edits. Station discovery uses existing `TRAFFIC_OF_STATE`, `stopAttached`, `infoOf` and `isFunctional`; unrelated growable updates do not rebuild the mask. `GrowthLimits.stationTower` exposes eligibility through the existing inspection queries. Grand Central has an 8-cell hook keyed to model `lm_grand_central`.
- `src/sim/economy/desirability.ts`: the same mask adds exactly +0.04 to R$$, CO$$ and CO$$$ before clamping, including zoned and unzoned evaluation. The breakdown registers a `station` / “Near a station” term. Overlapping stations do not stack; other DevTypes retain their weights. The existing 33 weighted inputs stay intact; the flat bonus is an auxiliary input.
- `src/sim/economy/tuning.ts`: `TOD` constants beside downtown tuning; `APPROVAL.commuteStart = 15`, with the existing −0.25-per-minute coefficient.
- **Outside the task's named production files:** `src/sim/economy/approval.ts`, one self-contained assignment in `approvalSystem`'s update: use `APPROVAL.commuteStart` and charge only when the resident survey contains people. This prevents an empty city's fallback 25-minute value from costing approval.
- `tests/sim/transitDevelopment.test.ts`: 16 cases covering exact radii, edge clipping/overlaps, train partners and map-edge links, subway attachment, immediate cuts before graph rebuild, completion/burn/abandonment/removal, same-centre mode changes, cache reuse, excluded modes/missing traffic, save reconstruction, query/RNG side effects, tower caps, all affected DevTypes and pre-clamp arithmetic, and resident-weighted commute approval at 15/16/25 minutes.
- This report is the task's requested report artifact.

**Infra hunks: none.** No B2 hold is needed. No cloud-held files were edited. No new persisted keys, settings or RNG draws. This task intentionally changes balance on all difficulties through station eligibility/appeal and commute approval; it does not add difficulty-specific rules.

## Checks

- `npx tsc --noEmit`: passed.
- `git diff --check`: passed.
- Quiet-gated `npx vitest run tests/sim/transitDevelopment.test.ts --maxWorkers=1`: could not start. Vite's config loading failed in `externalize-deps` / `optimizeSafeRealPathSync` with `spawn EPERM`; no Vitest cases executed.
- A scratch-only rolldown + `node:assert/strict` probe executed the same 16 synchronous cases: **16 passed, 0 failed**. This is explicitly not a Vitest result. Diagnostics: `tod-focused-probe.json` and `tod-focused-probe.log` in the supplied scratch folder.
- Full Vitest, existing-file regression tests and browser/GPU checks remain for the lead, as instructed. Suggested individual regressions: `tests/sim/growth.test.ts`, `tests/sim/desirability.test.ts`, `tests/sim/approval.test.ts`, `tests/infra/transitFacilities.test.ts`, `tests/worker/hygiene.test.ts`, `tests/worker/querySideEffects.test.ts` and the inspector/replica suites.

## Bot gates

The specified rules are implemented, but the item is **not acceptance-green**. The 2060 transit-loss and timing gates pass; the 2040 loss, base-population floor, stage concentration and commute-approval gates fail. No stronger radius/bonus or lower threshold was substituted for the requested values.

| Run | 2040 population | 2060 population | Final residents [$, $$, $$$] | Mean total system CPU ms/day |
|---|---:|---:|---|---:|
| Pre-edit dev, `256x60 s7 --subway` | 885,499 | 1,491,542 | [416853, 724509, 350180] | 5.5223 |
| T045, `256x60 s7 --subway` | 887,126 | 1,387,188 | [376335, 674621, 336232] | 5.6964 |
| T045, `256x60 s7 --subway --skip transit` | 874,649 | 1,226,552 | [357511, 581049, 287992] | 5.2764 |

| Acceptance line | Measurement | Result |
|---|---|---|
| Skip transit costs ≥4% in 2040 | 1.4065%; skip would need ≤851,640 versus the observed 874,649 | FAIL |
| Skip transit costs ≥10% in 2060 | 11.5800%; skip must be ≤1,248,469, observed 1,226,552 | PASS |
| Base year-60 population ≥0.99×dev | 0.930036×dev (−6.9964%); required ≥1,476,627, observed 1,387,188. Also below the b3 flags-off floor of 1,498,697 | FAIL |
| Mean ms/day increase ≤3 | +0.1742 system CPU ms/day versus the fresh same-strategy dev run | PASS, single-run headless observation |
| Near-station average stage ≥1.5×city | 2060: 4.23346 / 3.99569 = 1.05951× across all growables; functional-only ratio 1.05895× | FAIL |
| Skip-transit commute term nonzero from 2030 | Zero at every annual checkpoint 2030–2060. Resident-survey commute: 9.55266 min in 2030, 11.75828 in 2040, 12.31903 in 2060 (max annual checkpoint 13.22955), all below 15 | FAIL |

Station stage checkpoints in the T045 transit run:

| Year | Connected stations | City average, all growables | Within 6 tiles | Ratio |
|---|---:|---:|---:|---:|
| 2030 | 24 | 3.08265 | 3.46071 | 1.12264× |
| 2040 | 24 | 3.52008 | 3.67626 | 1.04437× |
| 2060 | 25 | 3.99569 | 4.23346 | 1.05951× |

The flags-off `128x15 s7` run ends at **[62429, 91718, 36580] = 190,727** in 2015, versus the supplied dev reference **[61124, 93804, 37971] = 192,899**: **−2,172 (−1.1260%)**. Its 2015 resident-survey commute is 7.96880 minutes and its annual commute term is zero. The changed threshold can affect earlier monthly approval and subsequent deterministic growth even when the year-end term is zero. No extra RNG draws were added.

All requested bot configurations were checked. The lead still needs the normal CLI/Vitest/browser confirmation and a balance/design decision for the failed targets. In particular, the specified 15-minute threshold does not activate at these no-transit annual checkpoints, and the specified station rules do not produce the requested stage ratio. Monthly commute terms were not separately sampled; the zero 2030 checkpoint already fails the gate. This report does not claim a full replay-hash or real-GPU timing verification.

The requested CLI commands are:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --subway
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --subway --skip transit
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

`npx tsx` is unavailable here (`ENOTCACHED`, restricted network). Instead, installed rolldown bundled the unchanged `SimBot`, `parseArgs`, `botSystems` and diagnostic imports into scratch-only Node ESM. The pre-edit bundle captures `fb1531f` production code before any edits. All bot executions use the quiet gate, sequentially. The probe writes exact annual rows and final residents, rather than the CLI's rounded population display.

Scratch root:

```text
C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T045/scratch
```

Actual completed commands (run from the worktree):

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T045/scratch/tod-gates-dev.mjs --size 256 --years 60 --seed 7 --subway --out C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T045/scratch/dev-subway-256x60-s7.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T045/scratch/tod-launch.mjs --size 256 --years 60 --seed 7 --subway --out C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T045/scratch/tod-final-subway-256x60-s7.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T045/scratch/tod-launch.mjs --size 256 --years 60 --seed 7 --subway --skip transit --out C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T045/scratch/tod-final-skip-transit-256x60-s7.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T045/scratch/tod-launch.mjs --size 128 --years 15 --seed 7 --out C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T045/scratch/tod-final-128x15-s7.json
```

Stage method: each catalog growable counted once, station and growable centres measured with `centerCell`, Euclidean distance ≤6 to a functional attached train/subway station. Both all growables and functional growables are recorded at 2030/2040/2060. Timings use the bot's existing total system timers divided by simulated days; diagnostic callbacks and bot actions are excluded. These are single-run headless observations, not a browser/GPU timing claim.

An initial diagnostic run, `tod-subway-256x60-s7.json`, preceded the empty-city guard and is superseded by `tod-final-*`; it is not the final implementation's gate result.

## Plan/code differences and routed requests

1. The threshold was the literal `30` in `approval.ts`; `APPROVAL.commute` was the penalty coefficient, −0.25. The one-line outside-owned-file hunk is necessary to implement the specified threshold. Empty resident surveys retain a zero commute cost.
2. `TrafficSystem.graphVersion` covers the road graph only. Station addition/removal/completion and immediate tunnel edits can change `stopAttached` without changing it. The cache therefore also listens to station/network edits; graph-version-only invalidation would be stale.
3. Grand Central has an asset, not a simulation catalog/reward definition or passenger attachment role. The 8-tile hook is implemented; real Grand Central connectivity cannot be verified until LG-02 lands. CONTENT/SIM request: register its final definition with model `lm_grand_central` and the intended train/subway attachment roles. Do not infer connectivity merely from the building's presence.
4. The plan's historical 1.547M baseline is stale. This work records a fresh same-strategy dev `--subway` comparison. The repository's existing b3 flags-off 2060 reference is 1,513,835 (99% floor 1,498,697); it is a different strategy from the fresh `--subway` baseline.
5. **GUIDE/cloud-held request:** `src/ui/inspectorModel.ts`, `growthRows`: render the requested “Stage 5 max: not a tower site — a subway or train station within 6 tiles allows towers here” guidance as a dedicated row when the downtown cap binds (the generic string path skips text of 80+ characters). When `stationTower` is true, replace the downtown attribution with a station-site explanation. No new Worker query is required: the existing inspection wrapper spreads the boolean. No hunk in `InfoPanel.ts` was needed here.
6. **GUIDE request:** `src/ui/panels/StatsPanel.ts`, its stats update near `commuteModes(s.commuteByMode)`: place the requested “Riders save N minutes compared with driving” wording in the Transit card using mirrored `ctx.state.stats.commuteByMode.transitSaved`. The existing `statsModel.commuteModes` already supplies equivalent explanatory text through `modeNote`, so much of this display requirement is already present. Retain its handling of negative savings as slower trips. No new counter or Worker query is needed.

## Browser checklist for the lead

- [ ] Connect two subway stations, or connect a passenger train station to another station/the map edge; high-density lots within 6 centre-cell tiles become tower sites, subject to population, desirability, demand and utilities.
- [ ] A lone/disconnected station, bus stop or freight station does not create tower sites. Cutting the line, removing its partner, or burning/abandoning a station removes eligibility; rebuilding restores it.
- [ ] R$$, CO$$ and CO$$$ Why? views show “Near a station” at +4 points. Other types and overlapping station catchments receive no extra bonus.
- [ ] A populated city with a resident-weighted commute above 15 minutes shows a negative commute approval term at the monthly update; an empty city has no commute penalty.
- [ ] Save/load an existing city and verify station effects reconstruct and play continues in local and Worker modes.
- [ ] After GUIDE lands its requested changes, verify the downtown hint and Transit minutes-saved line.
- [ ] Once LG-02 supplies Grand Central's connected simulation definition, verify its 8-tile radius.
- [ ] Verify visual station-area skyline concentration and rerun any unmet bot acceptance gates after the lead resolves their design/baseline questions.
