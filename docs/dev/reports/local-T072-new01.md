# T072-new01: visual variety

Branch `local/T072-new01`, base `1c2019c`. Changes are uncommitted.

Implemented three new roof/facade models for each of the four requested families. Economic building choices,
capacities and the simulation RNG stay unchanged. **The 2020 all-growables twin gate is not met** under the
growth code's six-cell lot-edge Chebyshev distance; the 2040 gate passes. Browser art acceptance remains for the lead.

## Changes by file

- `src/assets/builders/res_walkup_variety.ts` (new): hip, glazed monitor and paired-gable walk-ups, with six authored
  palettes each and their mirrored variants. Original walk-up geometry and variant indices are untouched.
- `src/assets/builders/residential.ts`: import/register the new walk-up builders.
- `src/assets/builders/com_variety.ts` (new): hip/gable/stepped corner stores; hip/paired-gable/terraced shops and
  apartments; stepped/sawtooth/vaulted office blocks. Six palettes per small model and four per office model,
  plus mirrors. Each family has three different roof silhouettes and colour sets. Four mature forecourt trees keep
  each new office plaza visible in winter LOD proxies; this fixes the existing LOD suite's foliage regression from
  adding numerous office models whose original tiny trees fell below the proxy's foliage-share threshold.
- `src/assets/builders/commercial.ts`: register the new commercial builders through the existing roof-tone wrapper.
- `src/assets/manifest.ts`: **minimal hunk outside the task's explicit `owns` list, but named by NEW-01**. Append
  twelve model entries through `FACADE_MODELS`, retaining each original entry's footprint, effective variant count,
  mirror split and height guidance. Original manifest entries remain unchanged. The existing gallery discovers them
  through the manifest; no `gallery.html` edit is necessary.
- `src/sim/catalog.ts`: append eighteen hidden facade defs for the six existing stage/dev defs. Copy every economic
  stat; explicitly retain the walk-up's apartment household form (the stage-3 generic fallback would be a house).
  Exclude facade defs from the original weighted growth and wealth-swap pools. Add `growthDefId` and `facadeDefs`.
- `src/sim/economy/growth.ts`: isolated facade helper and final call after the original def/raw-variant decision.
  Hash tile coordinates and building id, scan actual facade models once, avoid a same-model/variant neighbor where
  possible, then use the existing same-def/farthest preference. Legacy scans project facade ids to their original
  defs, keeping future alternate-def decisions unchanged. No RNG draws, raw-variant changes or new persisted keys.
- `tests/assets/visualVariety.test.ts` and `tests/sim/visualVariety.test.ts` (new): geometry/roof/colour budgets,
  determinism, catalog/household equivalence, exclusion from weighted pools, neighbor spreading and fallback,
  canonical legacy decisions, street repetition, Medium/Hard economic snapshot equality and save continuity.

**Infrastructure hunks:** none. **Cloud-held files:** none. **Renderer changes/requests:** none.

## Checks

`npx tsc --noEmit` passed. `git diff --check` passed.

Every test file below ran individually through the quiet gate, one process at a time:

| Test file | Result |
|---|---:|
| `tests/assets/visualVariety.test.ts` | 18 passed |
| `tests/sim/visualVariety.test.ts` | 22 passed |
| `tests/assets/manifest.test.ts` | 20 passed |
| `tests/sim/catalog.test.ts` | 9 passed |
| `tests/sim/growth.test.ts` | 12 passed |
| `tests/worker/hygiene.test.ts` | 18 passed |
| `tests/render/lod.test.ts` | 35 passed |

**134 tests passed across seven individually run files.** All new models remain inside their footprint/height
guidance and the 1,500-triangle growable budget; office plaza trees survive their distant winter proxies.

The standard `npx vitest run ... --maxWorkers=1` invocation failed before loading tests with Vite
`externalize-deps: spawn EPERM`. The working equivalent uses native config loading and one thread worker:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types node_modules/vitest/vitest.mjs run tests/sim/visualVariety.test.ts --maxWorkers=1 --pool=threads --configLoader=native
```

The Medium/Hard continuity tests compare the entire serialized city after canonicalizing only facade def ids,
including numeric building fields, layers, budget, statistics, history, news and systemData/RNG. Raw save hashes
intentionally differ where a new facade def id is stored; existing saved buildings and raw variants are preserved.

## Bot and numerical acceptance

The requested standard command was attempted through the gate:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

It failed because `tsx` is neither installed nor cached (`ENOTCACHED`; network is restricted). Node 22's local
TypeScript transform with a scratch extension-resolution loader successfully ran the same unmodified bot:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/ts-loader.mjs --import file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/capture-bot.mjs tools/simbot.ts --size 128 --years 15 --seed 7
```

**128×15 s7: PASS**, residents `[61124, 93804, 37971]` = **192,899** in 2015, exactly the requested baseline.
Full output is `scratch/bot128x15_s7.log` in the task's supplied scratch directory.

The following gated probe imports the same `SimBot`, `parseArgs` and full systems; no strategy flags or sim changes.
It records rows and twins in 2020/2040. A twin means the same model (or def) **and raw variant** within six cells,
using lot-edge Chebyshev distance as `variantScan` does; count each growable with at least one such neighbor once.

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/ts-loader.mjs C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/variety-gates.mjs --size 256 --years 60 --seed 7
```

| Checkpoint | Growables | Same-model twins (≤5%) | Same-def twins (≤2%) |
|---|---:|---:|---:|
| 2020, population 283,841 | 8,023 | 444 = **5.5341%, FAIL** | 444 = **5.5341%, FAIL** |
| 2040, population 885,236 | 9,624 | 70 = **0.7273%, PASS** | 64 = **0.6650%, PASS** |

The 60-year run completed at **1,513,835** residents in 2060: `[412608, 738176, 363051]`.
Rows and checkpoint counts are in `scratch/variety-256x60-s7.json`.

Projecting facade ids back to their original models gives 6.0950% / 5.8208% in 2020 and 5.3096% / 1.6833% in 2040
(same-model / same-def). These are same-state diagnostic projections, not a separate baseline run.

A second, justified diagnostic run attributed the unresolved 2020 gate:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/ts-loader.mjs C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/variety-gates.mjs --size 256 --years 20 --seed 7
```

Its output is `scratch/variety-256x20-s7.json`; it reproduces
the same 2020 population and twin counts. **All 1,609 growables across the four requested families have zero twins.**
Every remaining same-model/same-def twin is outside those families:

| Unchanged model | Buildings with a twin in 2020 |
|---|---:|
| `res_rowhouses` | 182 |
| `com_boutique` | 173 |
| `res_cottage` | 38 |
| `res_shack` | 16 |
| `ind_depot` | 14 |
| `res_townhouse_row` | 13 |
| `res_suburban` | 8 |
| Total | **444** |

**Lead scope request:** extend the next variety item to rowhouses (`src/assets/builders/res_mid.ts`, `rowhouses`)
and boutiques (`src/assets/builders/com_low.ts`, `bout*` builders), with catalog/manifest facade families using this
lane's existing mechanism. Those two models account for 355/444 remaining twins. They are outside NEW-01's four
named families at this base; no unrelated model or balance changes were made to conceal the acceptance mismatch.

## Plan versus current code

- `altsFor`/`create` already implement the plan's exhausted-variant alternate-def rule. Re-implementing it or simply
  increasing manifest counts would change capacity substitutions. This lane adds a separate stat-identical visual
  choice after that decision, and canonicalizes subsequent legacy scans.
- Walk-ups already had twelve effective variants, including six authored mirror-twin archetypes; the other targets
  have twelve/eight effective variants. New model ids preserve all existing mirror splits and seeds.
- The plan allows capacity changes and `polish` balance rows. This implementation needs no economic balance changes;
  stored facade identities are the intentional state difference.
- The plan's older 12–14% twin baseline and its four dominant models do not match the present code under the
  explicitly documented lot-edge metric. The remaining 2020 miss is entirely in other models, attributed above.

## Remaining lead gates and browser checklist

No browser, full Vitest suite, benchmark, real-GPU run or other worktree was used. The full two-process baseline
year-hash audit and G-STEP/performance timing remain for the lead; canonicalize facade ids for the economic audit.
The 2020 repetition miss remains open, with the scope request above. No cloud-held-file change is requested.

Lead's standard bot replay command (when `tsx` is available), if independently repeating the large-city row and
exporting checkpoints for the browser art review:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --save-years 20,40 --save-prefix C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/variety_
```

- [ ] A/B each of the four target families at **300 m** and **700 m**, including the distant LOD transition.
- [ ] Review **10 suburb screenshots**: no street has more than **two identical facades in a row**.
- [ ] Check hip/monitor/gable walk-ups, all three shop roofs, all three corner-store roofs and all three office crowns.
- [ ] Check roof/facade colours, night windows, shadows, mirrored variants, entrances and lot bounds in the game.
- [ ] Load an old city: existing buildings retain their appearances; new growth adds the facade families.
- [ ] Save/reload a new facade city and check appearance/continuation in the normal and Worker paths.
- [ ] Recheck full tests, G-DET and G-STEP, and resolve the 2020 all-growables twin miss before final acceptance.
