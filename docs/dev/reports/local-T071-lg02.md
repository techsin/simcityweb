# T071 LG-02: late-game landmarks

Worktree branch `local/T071-lg02`, starting HEAD `c868c13d21ff246b96296ee42be86c64dc675629` (task commit over `ed31192`). Changes are uncommitted. No worker, save, UI, renderer, other worktree or branch was changed.

## Behavior and files

| File | Change |
|---|---|
| `src/sim/economy/rewards.ts` | Separate LG-02 helper and table block: seven permanent population unlocks at 200k, 300k, 400k, 650k, 800k, 1M and 1.5M, with descriptions of their actual effects. Existing monthly announcements, reward refs and silent old-save initialization are reused. |
| `src/sim/catalog.ts` | Seven unique, paid landmarks, library/green service tiers, transit coverage, jobs, prestige, visit income and a separate CAP_RELIEF block. |
| `src/sim/economy/approval.ts` | Separate Crown helper adds exactly 3 to the existing civic term while complete and intact; removal, construction, abandonment and ruins remove the bonus. |
| `src/sim/economy/tourism.ts` | Separate attraction rows; Grand Central's connected train mode contributes a rail connection. Removing a bus-only hub preserves other train stations' saved connection contributions. No pass format change. |
| `src/assets/manifest.ts` | Removes only the seven LG-02 pending-catalog wrappers and their now-unused helper. All existing builders and geometry are unchanged. |
| **Outside named files:** `src/sim/economy/budget.ts` | Small, separate Stock Exchange hook: operating exchange multiplies only CO$$/CO$$$ tax receipts by 1.05 before ledger rounding. Tax rates and other tax rows are unchanged. |
| **Outside named files:** `src/sim/economy/population.ts` | Small plopped-job aggregation branch: the World Trade Center's 8,000 CO$$$ jobs enter commercial capacity, employment and tax totals once, rather than civic totals. |
| **Outside named files:** `tools/simbot.ts` | Two-line Grand Central-only branch reuses `placeVenue()` after the existing affordability check. The first gate run exposed that the civic path's sparse lot search never bought Grand Central in 60 years; the full landmark search buys it without changing any earlier reward path. |
| **INFRA, outside named files:** `src/sim/infra/common.ts` | Appends the Hub enum value and classifies Grand Central by model/id. Existing values are unchanged. |
| **INFRA, outside named files:** `src/sim/infra/transit.ts` | Recognizes Hub as a stop and uses its 18-tile radius in fallback transit coverage. |
| **INFRA, outside named files:** `src/sim/infra/traffic.ts` | Hub-only attachment map and graph transfers for bus/train/subway; one building/stop/load key; counts toward each linked line, supplies a 40-bus depot and 2,000 parking spaces; closes when incomplete, ruined, abandoned or lacking utilities. Bus fleet requires a road. Ordinary stops keep their prior paths. |
| **INFRA, outside named files:** `src/sim/infra/transportFacilities.ts` | Hub report/facts, connected use factor and effect metric; preserves the no-traffic fallback. |
| **INFRA, outside named files:** `src/sim/infra/facilities.ts` | Two table entries only: Grand Central transit-use hook and Crown +3 civic fact. |
| **Outside named files, existing test:** `tests/sim/ranks.test.ts` | Two-line setup hunk pre-unlocks rewards in the rank-persistence case. Its 750k-to-1M jump now legitimately unlocks two landmarks, so a rank-only no-news assertion needs independent reward state. |

Five new test files are listed below. No other source files were edited. All infra changes are confined to the above hooks, with no moved code or refactor; keep these hunks separate when rebasing on B2.

## Content choices

The plan fixes two visitor draws and three cap amounts. Unspecified commercial relief and draws are paired against the existing comparison formula, `legacy tourism jobs = C relief × 0.05`; visitors produce `0.5` shop jobs each. No existing draw, cap, tuning constant or RNG stream changes.

| Landmark | Cost / monthly upkeep | Reference draw | CAP_RELIEF |
|---|---|---:|---|
| Central Library | 150,000 / 1,600 | 1,000 | R 12k, C 12k |
| Grand Central | 250,000 / 2,000 | 2,400 | R 30k, C 30k |
| Stock Exchange | 300,000 / 1,400 | 1,200 | C 15k, CO$$$ 40k |
| Botanical Dome | 400,000 / 1,800 | 3,500 | R 50k, C 35k |
| World Trade Center | 650,000 / 3,500 | 5,000 | C 60k |
| Millennium Tower | 1,000,000 / 4,000 | 7,000 | R 50k, C 70k |
| Metropolis Crown | 1,500,000 / 4,500 | 6,500 | R 60k, C 80k |

Library: library tier, 20,000 students. Dome: green tier, 80,000 capacity. Stock prestige is 0.5 / 18 tiles; Millennium prestige is 0.7 / 26 tiles. Millennium's reference monthly ticket income is 2,500 and scales through the existing visit-income formula. Crown civic pride does not depend on utility supply; its tourist operation does. The existing `CITY_RANKS` already awards the Megalopolis title at 1.5M, so no duplicate title state was added.

Grand Central enables each mode according to that mode's existing connection rules. A road-connected bus hub can operate without a train or subway partner; a lone rail/tunnel line does not become connected merely because buses run. The existing shared stop-load/crowding model also applies to the hub; a busy multimodal hub shares that load across its facility model. Detailed routed-commuter calibration remains a lead integration check.

## Tests and gates

The normal Vite config loader initially failed before tests with sandbox `spawn EPERM`. The supported native config loader and thread pool worked. Every Vitest invocation was a **single file**, sequentially, through the required quiet gate:

```powershell
$env:NODE_OPTIONS = '--experimental-transform-types'
node $quietrun npx vitest run <file> --maxWorkers=1 --pool=threads --configLoader=native
```

`$quietrun` is the shared `scratchpad/lanes/quietrun.mjs` from the task. No full suite, browser or benchmark was run.

New files:

- `tests/sim/lg02Landmarks.test.ts`: exact unlock thresholds, one announcement, population-drop permanence, old saves without new keys, existing title, catalog effects, actual service-tier pass, economy-only cap fallback, Crown lifecycle, paid visits, bus-only-hub removal, and the extended synthetic tourism case through all seven purchases with and without hotel shortages.
- `tests/sim/lateLandmarkEconomy.test.ts`: 10 cases for Medium/Hard tax parity without an exchange, office-only 5%, operational gating, demolition and typed WTC employment without civic double counting.
- `tests/infra/grandCentral.test.ts`: 7 cases for one stop key, connected station counts, fleet/parking, cross-mode transfers, lone-line gating, 18-tile coverage and closure.
- `tests/render/lateGameLandmarkIntegration.test.ts`: 8 cases for all finished manifest entries and all 14 registered variants, gallery group membership, night surfaces and complete seasonal crown/twig pairing.
- `tests/sim/grandCentralBot.test.ts`: 3 cases for buying Grand Central from a fragmented park block, building missing access roads first, and no changes before its unlock.

Existing affected files checked: `catalog`, `ranks`, `milestoneNews`, `approval`, `approvalGuide`, `tourism`, `employment`, `transitFacilities`, `facilities`, `traffic`, `trafficRegion`, `manifest`, `lateGameLandmarks`, `botanicalDomeWorldTradeCenter`, `millennium_crown`, `economy`, `demographics`, `difficultyRules`, `monthSpread`, `worker/hygiene`, `botVenues`, `botLongGame` (all `.test.ts` in their existing directories).

These **27 files / 373 tests pass**, including **45 new tests**. Final `npx tsc --noEmit` and `git diff --check` are clean; all 20 changed/new files validate as UTF-8 without a BOM. The full suite and real-GPU timing/render checks remain for the lead.

## Bot measurements

The requested `npx tsx` command could not start because `tsx` is not installed/cached and network access is unavailable (`ENOTCACHED`). Native Node 22 TypeScript transformation plus a scratch-only extension resolver runs the same exported `SimBot`, `parseArgs` and `botSystems(false)`, without source/build changes. Every bot invocation uses the quiet gate, one process at a time. The probe observes monthly tourism jobs / `demandContext().tourism`, first population crossings, unlock events and purchases, and writes yearly/raw monthly data under the task's scratch folder.

Requested simbot commands, with the shared quiet-gate path represented by `$quietrun`:

```powershell
node $quietrun npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
node $quietrun npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet
node $quietrun npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet
```

Actual measurement command form (`$loader` is the file URL of `scratch/native-loader.mjs`, `$probe` is the absolute `scratch/lg02-gate-probe.mjs` path):

```powershell
node $quietrun node --no-warnings --experimental-transform-types --loader $loader $probe --size 128 --years 15 --seed 7 --quiet
node $quietrun node --no-warnings --experimental-transform-types --loader $loader $probe --size 256 --years 60 --seed 7 --quiet
node $quietrun node --no-warnings --experimental-transform-types --loader $loader $probe --size 256 --years 60 --seed 11 --quiet
```

The native direct CLI run finished with residents `[61124, 93804, 37971]` = **192,899**, exactly as required. Final observed-gate results follow below.

The extended synthetic case stays within **1.164957–1.218595** with enough hotel rooms and **0.934061–1.061229** with a shortage, through all seven purchases. Diagnostics: `scratch/synthetic-final.jsonl`.

The corrected 256×60 seed-7 run buys **all seven**. In 2060 it has **1,584,602** residents `[411993, 782605, 390004]`. Annual 12-month mean tourism ratios from year 15 are **0.840242–1.137762**; checking **every rolling 12-month window** from year 15 gives **0.834626–1.139379**, within 0.7–1.3. Diagnostics: `scratch/gate-256x60-s7.{json,jsonl,log}`.

| s7 landmark | First population crossing (day) | Unlock (day) | Delay to monthly check | Purchase (day) | First year-end population row |
|---|---:|---:|---:|---:|---:|
| Central Library | 5747 | 5760 | 13 | 8340 | 2016 |
| Grand Central | 7451 | 7470 | 19 | 9240 | 2021 |
| Stock Exchange | 8931 | 8940 | 9 | 8940 | 2025 |
| Botanical Dome | 11889 | 11910 | 21 | 11910 | 2034 |
| World Trade Center | 13473 | 13500 | 27 | 13500 | 2038 |
| Millennium Tower | 15538 | 15540 | 2 | 15540 | 2044 |
| Metropolis Crown | 20381 | 20400 | 19 | 20400 | 2057 |

Every unlock occurs at the first monthly check after its threshold crossing. The bot waits to afford the Library and Grand Central, as its existing reserve rules require. **The plan's historical annual population rows are not reproduced exactly:** Dome, Millennium and Crown first appear above threshold in 2034/2044/2057 here, versus the quoted 2033/2043/2056. Unlock calendar dates are a different convention from year-end bot rows (for example, day 11910 is in calendar 2033, before row 2034). No date gate was added to force the old labels. The new landmarks intentionally change high-population cities through their requested cap, service, transit, job, tax and approval effects; the 128×15 baseline remains unchanged.

The 256×60 seed-11 run ends at **1,477,199** residents `[386947, 723124, 367128]`. Annual tourism ratios are **0.932676–1.272763**; every rolling 12-month window from year 15 stays within **0.910579–1.272763**. It buys the six landmarks it reaches; it never reaches 1.5M, so the Crown correctly stays locked. Its first year-end threshold rows are 2016, 2021, 2025, 2034, 2038 and 2043. Diagnostics: `scratch/gate-256x60-s11.{json,jsonl,log}`.

Both long runs use the default LG-10-capable bot strategy. The existing venue fund buys landmarks without an extra flag; `--venues` adds a zoo and ordinary passenger station, rather than enabling landmark buying. No optional strategy flags were enabled in these three base gates.

G-POP against every phase-0 year in the existing fixture also passes on the long runs: s7's minimum ratio is **1.069747**, y15 **181,278**, y60 **1,584,602**; s11's minimum ratio is **0.952760**, y15 **182,428**, y60 **1,477,199**. These satisfy the 0.9× yearly, 150k y15 and 950k y60 bounds.

Not checked here: the full Vitest suite, real-GPU rendering/timing, the complete aggregate GATE SUMMARY (funds/emergencies/etc.), optional strategy variants, and the independent two-process yearly hash audit. Targeted save-continuation tests and Worker hygiene pass; the lead retains the integration checks. The final 128×15 monthly tourism observer could not start while the timing run held `QUIET`; only this lane's queued command was cancelled. **The 128×15 rolling tourism ratio and yearly phase-0 population comparison remain for the lead.** Its required population parity was already confirmed by the direct CLI run above. No measurement remains running from this lane.

## Art pipeline and browser handoff

All seven models have two variants. Existing art tests check both variants, full geometry ≤8,000 triangles, proxy LOD ≤200, bounds, heights, deterministic geometry and night metadata; the new integration test builds through the actual model registry. No builder failed these headless checks. `gallery.html` already loads `src/gallery/main.ts`, which enumerates the manifest and all variants, so no HTML edit is needed. The gallery has no month/climate URL option: use the existing seasonal-uniform inspection workflow for January checks.

Real-GPU checks remain for the lead:

- [ ] All seven models, both variants, in the landmark gallery at default and street/close zoom: day, night and temperate January. Check every shot and gallery flags/console.
- [ ] Night windows and signature clock, crown, sky-deck and mast lighting; close-up tower tops; winter bare deciduous trees and retained evergreens.
- [ ] Place all seven from Rewards; verify footprint/rotation, thumbnails, unique-placement lock, lock progress and unlock toast/ref.
- [ ] Library and Dome inspector show their service tier, capacity, coverage, funding and strike response.
- [ ] Grand Central connects independently to bus, a working rail line and a paired subway line; inspect 18-tile coverage, buses, 2,000 spaces, park-and-ride commuting and +30k R/C relief. Remove/reconnect utilities and lines; check live and loopback hosts.
- [ ] Stock Exchange raises office receipts only; WTC has 8,000 CO$$$ slots without civic double count; Millennium earns visit-scaled income.
- [ ] Crown contributes +3 civic approval; demolition/ruins remove it; Megalopolis title appears at 1.5M; save/load continues with all seven.
- [ ] Existing landmarks and ordinary town/dense-city renders remain visually unchanged.

## Plan/code differences and cloud requests

- The task note says a 128×15 city never reaches 150k; this base reaches 192,899. The first new unlock is 200k, so the promised unchanged run still applies.
- The named files cannot express a multi-mode transit hub, office-only tax revenue or commercial plopped employment by catalog data alone. The minimal source exceptions are itemized above.
- The synthetic extension lives in a new test file, as §7.4 asks, rather than editing the existing tourism test.
- The existing title and automatic gallery enumeration are reused. There are no new systemData keys, save formats, worker commands, UI reads/mutations or RNG draws.
- **Cloud-held file requests: none.** No worker/save/App/TopBar/advisor or building/effects-renderer edits are required.
