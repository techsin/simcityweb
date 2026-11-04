# T057: save / load continuity (cloud lane)

Branch `cloud/t057`, from dev `821a8d6`; dev `50a6b29` merged in (`7c19719`). Task:
docs/dev/queue/T057-save-load-continuity.md. No NOTE names T057 (NOTE-001 to NOTE-052 checked, on dev too); NOTE-044 (the
lead's decision on B3's second gates) is where the finding comes from.

**Status: partial.** The economy systems continue bit for bit from every save (the digest with the economy systems: both
fixtures, 32 of 32 saves; dev: 0 of 32), every key that still differs right after a load is an infrastructure key, named
with its cause, every gate is green, and nothing in `src/sim/infra/*` changed, so the branch is merge-safe now. Left: the
infrastructure systems' continuity, which needs `src/sim/infra/*` (B2 is rewriting it): a follow-up lane on dev once B2
is in (decision 1).

## Cloud carry-over (Nov 3)

### Gap list (what was required, against what was done when this lane started)

A new lane: nothing was done on any branch. Sources: the task file, NOTE-044, B3's report (`cloud-B3.md`, decision 3 and
"Scope of the continuity claim" in B3_DESIGN §4), B3's evidence (`b3work/gates1/sl2`, `b3work/gates2/sl`, the harness
`b3work/gates2/slgate.ts`) and B2's design R9 (B2 keeps save / load "exactly as today").

| # | required | state at the start | left for this lane |
|---|---|---|---|
| 1 | Classify every key that differs right after a load (saved but restored wrong / not saved and rebuilt differently / rebuild order) | B3 listed the keys (47–74 per save), not their causes | **all** |
| 2 | Fix the causes at the root (save what must be saved, or rebuild exactly and in a stable order) | none | **all**; fixes in `src/sim/infra/*` in their own commits, the lane then holds for B2 |
| 3 | A regression test: a small city saved on several days of the month continues bit-exact for 30 days | none (tests/save/grownCity.test.ts allows ±1 %; monthSpread's continuity runs tourism + budget + approval only) | **write it**, failing with each fix reverted |
| 4 | Gate: the full-game digest equal on all 16 saves of both fixtures, or each remaining key named with a reason | 0 / 16 and 0 / 16 (B3, on its base and on B3) | **re-run on dev and on the lane** |
| 5 | Gates: tsc, the full vitest, the bot identical to dev (`residents [ 61124, 93804, 37971 ]`), old saves still load (the recovery codec suites) | — | **run them** |
| 6 | Report and done marker | — | **write them** |

### Gap list at the resume (the run was stopped at the 22:16 restart)

The first run wrote and committed every fix and test (`2cbb869` … `0e9c387`), the classification and the decisions, and
had run the digest gate in economy mode on dev and on the lane. Left when it stopped:

| # | left | done in the resume |
|---|---|---|
| R1 | dev had moved 16 commits (`50a6b29`: src/game, src/ui, docs; nothing in src/sim, src/save or src/worker) | merged (`7c19719`), no conflict |
| R2 | the gates: the lane's all-systems digest, the bot (lane and dev), the full vitest, tsc: all interrupted, no result | re-run on the merged tree (below) |
| R3 | the revert table was written before the last two fixes (`832438f`, `0e9c387`) | every revert re-run on the final tree (`t057work/out/revert5.log`): the same first failures |
| R4 | the hooks' contract ("a game that saves continues exactly like one that does not") was claimed, not tested: the continuity test serializes both games every day | a new case (test 2 below, `f67307c`), shown to catch an injected side effect |
| R5 | decision 3 cited save sizes "below" that were never written; the hooks' cost unmeasured | measured on both fixtures (below) |
| R6 | the report uncommitted, no done marker | committed with the marker line |

The code was re-read line by line against dev (the hooks, each system's record and resume path, the codec); no defect
found. Two paths were checked beyond the tests: every save path calls `serializeCity` on the live state (SimCore's
`createCityRecord` and the recovery snapshot), so the hooks always run before a record is read; and an init runs only on
a new or loaded state (the constructor, `replaceState`), so a record left in systemData from the load is never read back
on a later day. The replica's ready snapshot (recorder.ts) keeps only `SYSTEM_KEYS` of systemData, so the records never
reach the main thread.

### The method

- **The harness:** B3's `slgate.ts` (`b3work/gates2/slgate.ts`, copied unchanged to `t057work/tools/slgate.ts`): game A
  is the fixture loaded and run 120 days at design cadence (`advanceDay` + scheduler `flush`); each of 16 saves
  (`serializeCity` + `encodeBundle`, the bytes of a file) is loaded into a new `Simulation(createSystems())` and run to
  the same day; the whole-city sha256 and a per-key digest map are compared right after the load, a day later, at the
  first month tick and at the end. B3's 16 save days per fixture are kept (dense1m: k = 4, 25, 27–29, 39, 44, 54–60,
  76, 115; bot256: 4, 26, 28–30, 40, 45, 55–61, 77, 116).
- **The attribution tool** (new, `t057work/tools/sldiag.ts`): it loads a save into a new Simulation whose systems'
  `init()` run one at a time, and after the deserialize and after each init prints the keys that now differ from the
  uninterrupted game (cells, max |d|, building fields and flag bits, stats values, systemData paths), then follows both
  games N days. That separates the three classes of the task: a key that differs **after the deserialize** is restored
  wrong (none is) or is a derived layer that is not saved; a key that an **init** makes differ is rebuilt differently at
  load; a key that differs only **days later** is state the save did not carry (a schedule, a cache, an order).
- It ran on the 128² 10-year bot city (`scratchpad/cities/small_s7_y10.city.metropolis`, 101k residents, 2.5 s a run)
  for the iteration, and on both fixtures for the tables below.

### Classification of every key, and what was fixed

#### The economy keys (fixed in this lane)

| key(s) right after a load, or the first to diverge | system | class (task's terms) | cause | fix |
|---|---|---|---|---|
| `stats.avgLandValue` | land value | saved, but rebuilt differently | init re-averaged the stored layer (the uninterrupted game publishes at the end of its sweep, from the band's own sums) | the band's sums are saved and restored; the saved stat is kept |
| (days later) `layers.landValue`, then everything | land value | not saved, rebuilt differently | the plopped splats are patched incrementally in float32 (a recompute sums in another order), the static terrain part is recomputed from today's terrain while the game may still hold an older one (and a spread pass may be in progress), the landfill splats likewise, the splats and flag flips queued by the player's edits between two days are lost | `systemData.lvRun` (save hook): the sums, the splats sparse, the factors applied, the parks factor, the landfill pass day, the dirty flags, the static part and the pass in progress while the terrain is newer, the queue and the flag flips |
| `stats.employed`, `jobsByDev`, `jobCapByDev`, `unemployment` (+ `population`, `residents`, `cohorts*`, `workforce` on dense1m) | population | saved, but rebuilt differently | init re-aggregated the buildings as they are at the end of the day; the game aggregates mid-day (growth and the infra passes change buildings after it) | the saved stats are kept; the runtime outputs of the last aggregation (totals, coarse residents / wealth grids, job fill, access, employment ratio) are saved (`systemData.popRun`) |
| (days later) `buildings.opt.*`, `buildings.health`, `buildings.pop` | population | not saved, rebuilt differently | the home records (access record folded with the cohorts at its fill, the demographics schedule: last update day, next update day at a random per-building phase, last population, the hiring factor, the workforce mirror) were rebuilt at load: every home stale, a fresh random schedule, buildings not yet met by the game marked as met; the refill days and the rubble clocks reset | the records (14 words a home) and the refill days and rubble clocks in `popRun`; a building the game had not met is not marked as met |
| (days later) the survey sums, EQ / HQ sums, population's slices, the budget's lines | economy runtime | rebuild order | `rt.growables` / `rt.plopped` / `rt.constructing` are swap-removed in a running game and rebuilt in Map order at load; every list-order float sum and slice then runs in another order (B3's code check named `rt.plopped`) | the three orders are saved (`systemData.econLists`) and restored |
| `sd.economy.approvalTerms`, `approvalRaw`, `res*` | approval | saved, but rebuilt differently | init re-surveyed today's homes and recomputed every term (L7 kept only the tourism term) | a resumed init keeps every saved term; the month's fire / disaster counts and the coverage at homes (the advisors read it) are saved (`systemData.approvalRun`); the day's survey cache is not (decision 4) |
| (days later) `buildings.count`, `nextBuildingId`, `sd.simRng` | growth | not saved, rebuilt differently | growth draws its lots from a candidate list it rebuilds every 10 days; the load rebuilt it from today's empty cells, on a new 10-day schedule (the draw index then picks another cell) | the list, its zone counts, its day and its dirty flag are saved (`systemData.growthRun`) |
| (days later) `stats.demand`, `sd.economy.demandAbs` | demand | not saved, rebuilt differently | the demand context (plopped cap relief × use and funding, freight boost, connections) is rebuilt on a change and monthly; the load rebuilt it from today's buildings and funding | the context and its dirty flag (`systemData.demandRun`) |
| (days later) `layers.desirability`, then `buildings` | desirability | not saved, rebuilt differently | the tax / ordinance shift is taken at a sweep's start, the coarse freight access and traffic's per-cell freight access of industry on a network change and mid-month; the load took today's taxes, buildings and traffic | the shift, both freight rasters (the per-cell one sparse) and the network flag (`systemData.desRun`) |
| `stats.power*` / `water*` / `garbage*` (no-infra mode only) | budget | saved, but rebuilt differently | init re-estimated the utilities; the game estimates weekly | a loaded city keeps its last weekly estimate |

The records are written by **save hooks** (`src/sim/persist.ts`): `serializeCity` runs the hooks of the state it
saves before it reads it, so nothing is mirrored into systemData during the game. A hook only writes the record its own
system reads at init, and is idempotent; a game that saves continues exactly like one that does not (test 2 below). A save without the records (from before T057)
loads exactly as before.

#### The infrastructure keys (remaining: they wait for B2)

Every remaining key is written by an infrastructure system's `init()` at the load, or is a derived layer it does not
rebuild. The pattern is the same in each system: `init()` resets the pass schedule to the load day and runs one full
synchronous pass (traffic: a whole assignment cycle), so the saved outputs are recomputed from the end-of-day city, the
next passes fall on other days, and what a pass carries to the next one is lost. All of it is in `src/sim/infra/*`,
which B2 rewrites into pieces (`b2-step-split`, about 12k changed lines) while keeping save / load "exactly as today"
(B2_DESIGN R9). No infrastructure file is changed in this lane (decision 1).

| system (file) | keys right after the load | class | what a resume needs (for the lane on B2's code) |
|---|---|---|---|
| utilities (utilities.ts) | `stats.powerDemand`, `powerSupply`, `waterDemand`, `waterSupply`, `tapWater`; `layers.powered`, `watered`; `buildings.flags` (Powered / Watered); `data.news` (on bot256 it first differs after this init: `t057work/out/diag_lane_bot256.txt`) | saved, rebuilt differently: a full pass at init, `lastServe` / `lastFull` = the load day | the schedule (`lastServe`, `lastFull`, `soft`, the dirty flags, the added / removed queue), the grid labels (or a proof that a fresh labelling equals the patched one), the plant loads and producer records, the outage-news state; no pass at init |
| traffic (traffic.ts) | `layers.traffic`, `congestion`, `commute`; `derived.parking`; `stats.avgTraffic`, `avgCommute`, `tripsCar` / `tripsTransit` / `tripsWalk`, `commuteByMode`; `sd.infraTransport` | saved, rebuilt differently: a whole cycle at init (`runCycleSync`) from the saved prices, RNG, cycle count and MSA iteration | the cycle schedule (`lastCycleStart`), the MSA's per-node volumes, the per-building results (`accessById`, `commuteById`, `jobFillById`, car-less shares, the matching's per-site arrays), the park & ride and overflow searches and garages, the sample routes: well over 100 fields, many per node or per building. The largest item, and B2 restructures exactly this code (G1) |
| pollution (pollution.ts) | `layers.airPollution`, `noise`, `waterPollution`, `garbage`; `stats.avgAir`, `avgNoise`, `avgPollution`, `avgWaterPollution`, `garbageProduced` / `Capacity` / `Recycled`; `buildings.flags` (Polluted / Noisy / NoGarbage); derived `treeCover` (rebuilt at init from today's trees; 3 of the 16 bot256 saves) | saved, rebuilt differently: `compute(sim, true)` at init, `lastRun` = the load day | `lastRun` (POLL_PERIOD 12), the water ground state (B2 R9 names it as a reload leak), the park / route caches where a rebuild differs; no pass at init |
| services (services.ts) | `layers.policeCov`, `fireCov`, `healthCov`, `eduCov`, `parkCov`, `transitCov`; `stats.needs`; derived `eduElemCov`, `eduHighCov`, `eduCollegeCov`, `greenCov`, `playCov`, `shopAccess`, `stigma`, `accessCommute` | saved coverage rebuilt differently (a pass at init); the derived layers are not saved and are rebuilt from today's city (`accessCommute` / `shopAccess` by the access pass every ACCESS_PERIOD 30 days, `stigma` by NIMBY every second pass) | the pass schedule (`lastPass`, `lastAccess`, NIMBY's turn), the derived layers or their inputs at their pass, the tracked inputs (`inputs`, `funded`), the reach caches where a rebuild differs |
| crime (crime.ts) | `layers.crime`, `stats.avgCrime` | saved, rebuilt differently: a pass at init, `lastRun` = the load day | `lastRun` (CRIME_PERIOD 20); no pass at init |
| emergency (emergency.ts) | derived `respFire`, `respPolice`, `respMedical`; `sd.emergency` | the response layers are not saved and not rebuilt at init (0 until the response pass); `genBuild`: the game assigns `undefined`, a load restores no key (a representation difference) | the response layers (or a response pass at init from the saved stations); `delete p.genBuild` instead of assigning `undefined` |

Everything that differs on later days descends from these keys.

### What this lane did (commits on `cloud/t057`)

| commit | what |
|---|---|
| `2cbb869` | the save hooks (`src/sim/persist.ts`, called by `serializeCity`); the continuity records of the economy runtime's list orders, land value, population, approval and growth; budget's no-infra estimate kept at load; the regression test; monthSpread's venue-order case |
| `0ab38bc` | land value's record by a save hook with sparse splats; `CONTINUITY_RECORDS`; recovery snapshots leave the records out when lean or over budget; serialize.test's old-save cases drop them |
| `bebb5fa` | smaller records (14 of the 16 words of a home record, the waterfront bonus sparse) |
| `832438f` | demand's context and desirability's shift and freight rasters; the test's budget edit |
| `1a013ab`, `07ffc06` | the advisors' scan-order case and J10's original-vs-current case under the kept list order / the new record |
| `0e9c387` | approval's record leaves the survey cache out (querySideEffects: a query may fill it) |
| `7c19719` | merge of dev `50a6b29` (the resume) |
| `f67307c` | the test's third case: saving is not a game event (the resume) |

No file in `src/sim/infra/*`, `src/worker/*`, `src/game/*`, `src/ui/*` or `src/render/*` changed. The economy part does
not wait for B2 and can merge alone.

#### The regression tests (`tests/save/loadContinuity.test.ts`)

1. **A small city saved on several days of the month continues bit-exact for 30 days** (the economy systems): a 64²
   SimBot city grown two years, saved as a file on days 3, 11, 13, 17, 26, 28, 29 and 30 of a month. Day 13
   follows a player edit between two days (a park bulldozed; an 8-cell street built and zoned for homes, which grow on it
   within the 30 days), and day 25 a budget edit (a tax rate, the parks funding); every loaded game gets the same edits on
   their days. The whole serialized city, per key, equals the uninterrupted game's right after each load and on each of
   the 30 days after it; the IndexedDB path (a structured clone) holds the same city as the file.
2. **Saving is not a game event** (the hooks' contract in `src/sim/persist.ts`): the same 48² SimBot city runs a year
   twice, one game serialized after every day (360 saves); the whole city, the records aside, is equal at the end. It
   guards the contract rather than a fix (with the fixes reverted there are no hooks and it passes), so it was checked
   with injected side effects instead: growth's hook marking its candidate list dirty makes 31 keys differ (caught). Two
   other injections, land value's hook forcing a full splat recompute and population's invalidating its record cache,
   are not caught: on that city the recompute gives the same bits, so they change nothing.
3. **Recovery snapshots leave the continuity records out when lean or over their budget, and the city still loads.**

Each fails with its fix reverted (each file put back to dev's version, alone, in an export of the final tree
`co/t057-revert`; re-run in the resume, `t057work/out/revert5.log`; the unchanged tree passes 3 of 3 before and after):

| reverted | first failure (test 1, unless named) | also |
|---|---|---|
| landValue.ts | `save on day 723 (dom 3): right after the load: [stats.avgLandValue]` | test 3: `lvRun` missing |
| runtime.ts (list orders) | `save on day 723 (dom 3): day 724: [buildings, sd.popRun, …(2)]` | test 3: `econLists` missing |
| population.ts + demographics.ts | `save on day 723 (dom 3): day 724: [buildings]` | test 3: `popRun` missing |
| approval.ts | `save on day 723 (dom 3): right after the load: [sd.economy]` | test 3: `approvalRun` missing |
| growth.ts | `save on day 733 (dom 13): day 743: [sd.simRng]` | test 3: `growthRun` missing |
| budget.ts | `save on day 723 (dom 3): right after the load: [stats.garbageProduced, …(2)]` | |
| demand.ts | `save on day 746 (dom 26): day 747: [sd.economy, stats.demand, …(1)]` | test 3: `demandRun` missing |
| desirability.ts | `save on day 746 (dom 26): day 747: [buildings, layers]` | test 3: `desRun` missing |
| serialize.ts (the hooks) | `save on day 723 (dom 3): right after the load: [sd.economy, stats.avgLandValue]` | test 3: `econLists` missing |
| recoveryCodec.ts | test 3 only: `expected [ Array(7) ] to deeply equal []` (the lean / over-budget snapshot kept all 7 records) | |

### Gates (the resume, on the merged tree)

Scratch paths below are under `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/`.
Every heavy run held the shared lock for that one command; dev is a clean export of `50a6b29` (`co/t057-devbase`; its
src/sim, src/save and src/worker equal `821a8d6`'s, the base of the dev digest runs).

| gate | result | evidence |
|---|---|---|
| **1. the full-game save / load digest** (task gate 1), all systems, 16 saves per fixture, 120 days | still 0 / 16 equal at the end on both fixtures, as on dev; right after a load **37–49 keys differ on dense1m** (dev 54–67) and **38–53 on bot256** (dev 49–71). The 20 keys gone on both are every economy key (approval's 10 `sd.economy` keys: the record itself, its terms, the raw value and the 7 survey values; `stats.avgLandValue`; population's 9 stats); no key is new; every key left is an infrastructure key of the table above (`data.news`, `derived.treeCover` included). At the end the lane differs in its 7 record keys too, which descend from the infra keys | `t057work/out/sl_lane/lane_all_*.{txt,json}`, `t057work/out/sl_dev/dev_all_*.{txt,json}`; bundle of `7c19719` (src as `f67307c`); 45 s and 60 s |
| 1b. the same digest, economy systems only | **lane: 16 / 16 and 16 / 16 equal** at the end, right after the load and a day later; **dev: 0 / 16 and 0 / 16** | `t057work/out/sl_lane/lane_economy_*.txt`, `t057work/out/sl_dev/dev_economy_*.txt` (first run, same sim code) |
| 2. tsc | exit 0, no output (8 s, under sem) | `t057work/out/tsc.txt` |
| 3. the full vitest (SIM_FIXTURES, SIM_SNAP set) | **221 files passed, 2 skipped; 2,203 tests passed, 8 skipped**; exit 0; 494.6 s | `t057work/out/vitest_full.txt` |
| 4. the bot, 128² × 15 years, seed 7 | lane **residents [ 61124, 93804, 37971 ]**, dev the same; the whole output identical apart from the two timing columns (econms, totalms) and the run time (29.4 s vs 24.8 s) | `t057work/out/bot_lane.txt`, `t057work/out/bot_dev.txt` |
| 5. old saves still load | the save and recovery suites (bundleCodec, cities, recovery, recoveryCodec, recoveryIdb, recoveryLs, serialize, serializePhase0, snapshotCodec, worker/recovery, loadContinuity): **11 files, 81 tests passed**; both fixtures are files from before T057, loaded by the lane as game A in gate 1 | `t057work/out/vitest_save.txt` |
| 6. each new test fails with its fix reverted | 10 of 10 reverts fail as tabled; the tree passes 3 of 3 before and after | `t057work/out/revert5.log`, `t057work/out/revert5/*.txt` |
| 7. the new contract case catches a side effect | the growth-hook injection fails it (31 keys) | `t057work/out/lc_mut1.txt` (`lc_mut2.txt`, `lc_mut3.txt`: the two harmless injections) |
| 8. save size and hook cost | decision 3 | `t057work/out/hookcost.txt` |
| browser | none required (decision 7) | — |

### Decisions (taken on the conservative reading; the lead may amend)

1. **No infrastructure fix in this lane; the economy part merges now.** The task allows infra fixes in their own commits
   with the lane held for B2. They are not written here, because:
   - B2 rewrites every infra pass into pieces (`b2-step-split`: traffic +3,935 lines, services +2,030, pollution +1,876,
     utilities +1,267) and, by its R9, keeps today's load behaviour, so a resume written now against the pre-B2 passes
     would have to be rewritten and re-proven on B2's code, and would collide with it at the merge;
   - traffic, whose cycle state every other system reads (commute, congestion, access, freight), needs well over 100
     fields saved; with it unresolved no infra key could become equal on the fixtures;
   - B2 was not near a merge when the lane started (its gate 4 had failed); at the resume its fix round was done and
     its integration with dev under way, so the follow-up can start soon.
   The table above gives, per system, what a resume needs. Recommended: a follow-up lane on dev once B2 is in, with this
   lane's mechanism (a save hook per system, a record in systemData, the init's resume path, `sldiag.ts` to find the next
   key). The lane is therefore **not** "holds for B2": no commit touches `src/sim/infra/*`.
2. **The gate reading.** "The full-game digest equal on all saves, or each remaining key named with a reason": the
   digest is still unequal on every save (it cannot be equal while any infra key differs), and every key that differs
   right after a load is now an infrastructure key, named above with its system and cause. With the infrastructure
   systems left out (the same saves, the economy systems), both fixtures continue bit for bit from all 16 saves, where
   dev continues from none.
3. **Save size and the hooks' cost** (the lead's trade-off). The records add bytes to every save. They are compact
   (sparse rasters, 14 words per home, ids for the list orders) and written only at a save; the dense part is land
   value's static terrain raster, saved only while it is older than the terrain. Measured on both fixtures after 3 days
   (`t057work/tools/hookcost.ts`, `t057work/out/hookcost.txt`, under the lock):

   | fixture | buildings | save (bundle) | of it the records | gzip | all hooks | serializeCity (copy) |
   |---|---|---|---|---|---|---|
   | dense1m | 17,157 | 12.91 MB | 1.63 MB (+14.5 %): popRun 1.11, lvRun 0.41, econLists 0.07, desRun 0.04 | 4.20 MB (+18.4 %) | 5.5 ms (median of 7; 4.3–19.2) | 41.4 ms |
   | bot256 | 11,277 | 11.95 MB | 1.41 MB (+13.3 %): popRun 0.73, lvRun 0.58, econLists 0.05, desRun 0.04 | 4.82 MB (+9.9 %) | 3.1 ms (2.3–14.3) | 38.3 ms |

   growthRun, demandRun and approvalRun are under 5 KB each. The hooks run on the save's own path (the worker, before
   the bytes are written) and on the replica's ready snapshot, not daily. Recovery snapshots leave the records out when
   lean, or when they would not fit the localStorage budget, before any layer is dropped (a restored city then rebuilds
   that state, as before T057; snapshot recovery is approximate by design, since it drops recomputed layers too).
4. **The survey cache is not saved.** Approval's cached resident survey of the day is filled by queries too
   (querySideEffects caught it: a save must not depend on reads), and the simulation reuses it only on its own day. A
   resumed init surveys the load day for the breakdown's details, as the init did before.
5. **Tests that assumed the old load behaviour** were adjusted to load both the new record and an old save without it:
   monthSpread's venue-order case and the advisors' scan-order case (a loaded copy now keeps the game's list order; the
   Map order of an old save is still checked), J10's original-vs-current case (the original code writes no population
   record; both arms load the save without it), serialize.test's two old-save cases (an old save has no records).
6. **Design cadence only.** As in B3's harness, the continuity claim is for design cadence (each day's due passes run
   that day). With frames (the live game) or the headless day budget, an infra pass can be in progress at a save, and
   the scheduler's credit / carry (B2 R9: not reset by `replaceState`) are not saved either; that belongs with the infra
   resume.
7. **No browser check**: the task names none, and nothing in `src/game`, `src/ui` or `src/render` changed. The browser
   save path is the worker's (`SimCore` → `createCityRecord` → `serializeCity`, where the hooks run), which the worker
   suites of the full vitest exercise headless; the records are typed arrays and plain objects that the IndexedDB
   structured clone keeps (test 1's last check). STATUS.md is the lead's and is not edited.
8. **Status partial, not ready.** Every gate is green and the branch is merge-safe now (no infrastructure file, the bot
   identical), but one item of the task is left by decision 1: the infrastructure systems' continuity (the keys of the
   second table), for a follow-up lane on B2's code. Not "blocked / holds for B2", because no commit here needs B2.
9. **B2 overlap.** `b2-step-split` also edits three of this lane's files (`demographics.ts`: `targetFrom`;
   `desirability.ts` and `landValue.ts`: the breakdown's context cache), in other hunks than this lane's, so the two
   should merge without a conflict. Whichever merges second should re-run test 1 and the economy-mode digest (gate 1b),
   since B2 may reorder what the economy systems read from the infra passes.
