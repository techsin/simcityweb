Everything is done: the save options, the three shared cities, `npm run fixtures`, and docs/dev/TEST_CITIES.md. Three things differ from the brief: dense1m is rebuilt with the original generator rather than taken from the vet run's year 43; the snapshot leaves out its test files; and I added two extra outputs (bot256 and the bench captures). No previously skipped test fails.

**Files changed** (the lead's WIP commits up to 0d5a186 already contain everything except my last doc edit; I made no git changes):
- `tools/simbot.ts`: new `--save-years a,b` and `--save-prefix P`, with input checks (bad input exits 2) and a `--help` entry. After each listed year's row the bot saves the city; the save notes go to stderr, so stdout stays the plain run's output.
- New `tools/citySaves.ts`: uses the game's `serializeCity` and `encodeBundle`, gzipped with `node:zlib` (the format `unpackFile` reads) so the bot loop can write synchronously.
  - `Py<N>.city.metropolis`: the city alone; loads with `deserializeCity(await unpackFile(bytes))`.
  - `Py<N>.region.metropolis`: a one-city region in Export-region format, on the driest tile of the city's size.
  - `Py<N>.READY`: written last, as JSON with population, file sizes, sha256 and the command. Every file appears atomically (temp file, then rename).
- New `tools/makeFixtures.mjs` and `npm run fixtures`. It bundles each generator with rolldown and runs it with plain node, so it needs no tsx and no network. Targets: snap, dense1m, stress1m, bot256 and captures, plus the cities with `--cities DIR`. It keeps existing outputs unless `--force`, checks every rebuild against expected numbers, and runs `git fetch --unshallow` if 24f8609 is missing.
- New `tools/bench/fixturePaths.ts`. Path defaults now point at `tools/bench/.fixtures/{fixtures,snap}`; `SIM_FIXTURES` and `SIM_SNAP` still override. Changed in:
  - `tests/wasm/{trafficCore,roadTransitSearch,servicesTierEngine}.test.ts`
  - `tools/bench/{trafficCore,roadTransitSearch}/fixtures.ts`
  - `tools/bench/{trafficCore,roadTransitSearch,populationAggregateProbe,fieldPasses}.bench.mjs` and `populationAggregateProbe/plugins.mjs`
- `.gitignore` gets `/tools/bench/.fixtures/`; new `docs/dev/TEST_CITIES.md`.

**Shared cities** in `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/cities/`, each name with `.city.metropolis`, `.region.metropolis` and `.READY`:

| City | Residents | Buildings | City file | Region file | Wall time |
|---|---:|---:|---:|---:|---|
| `small_s7_y10` | 101,650 | 2,765 | 1,148,776 B | 1,149,864 B | 29 s |
| `vet_s7_y21` | 304,083 | 9,223 | 4,378,430 B | 4,379,691 B | READY at 94 s, before the run went on |
| `vet_s7_y43` | 991,493 | 11,495 | 4,564,610 B | 4,566,317 B | 200 s for the whole run |

- **Runs:** the vet job ran in the background with nice 5 and `oom_score_adj` 800; a repeat took 205 s wall and 167 s CPU and gave identical files.
- **Loaded in node:** all three load from both files and run 3 days. Road nodes are 3,521, 10,918 and 13,799.
- **Loaded in the browser** with real clicks (Load Region → Import file… → Open → city row → Play), with 0 page or console errors:
  - small_s7_y10: Jan 2010, about 101,800 residents and rising.
  - vet_s7_y21: Jan 6, 2021, 304,378 then 304,774 residents 20 s later.
  - Screenshots: `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/simB/tooling/shots/small_s7_y10_05_city.png`, `vet_s7_y21_05_city.png`, `vet_s7_y21_03_region.png`, `small_s7_y10_02_imported.png`.

**Saving does not change the simulation.**
- 128×15 seed 7 gives 194,432 in 2015.
- Plain run against saving every year, with the full action log on: every non-timing column, the whole action log and the news are identical (1,201 lines).
- The year-15 save written after 14 earlier saves matches the end-only save in every field.
- I re-checked on the current live tree with saves at years 5, 10 and 15.
- The table cannot be byte-identical in full: the `econms` and `totalms` columns are CPU timings that also differ between two plain runs.

**WASM fixtures** in `/home/user/simcityweb/tools/bench/.fixtures/`:
- **`snap/`:** `git archive 24f8609` plus a `node_modules` link (292 files, 6.2 MB). trafficCore.test.ts imports 14 source modules from it, none of which imports a package.
  - Its `*.test.*` files are left out: vitest collects test files inside dot directories too, so it would run the snapshot's 29 old test files.
  - I checked that vitest and tsc ignore the folder.
- **`fixtures/dense1m_s7.metropolis`** (3.53 MB, 13 s): the original generator (`sim-profile/fixtures/dense1m.ts`) run on the snapshot with target 1,150,000. It reproduces the documented original exactly: 1,118,755 residents, 17,154 buildings, 23,141 road nodes, 30,084 transit nodes.
  - Why not vet y43: it runs in the 24f8609 tree but has 991,493 residents, below the `> 1,000,000` the trafficCore dense1m test asserts, and it has no subway.
- **`fixtures/stress1m_testdefs_s7.metropolis`** (0.19 MB): reproducible from `tests/infra/cityGen.ts`. 1,034,100 residents, 36,003 road cells; built on the live tree it differs only in 4 default stats fields.
- **`fixtures/bot256_s7_y60.metropolis`** (4.35 MB, about 5 min), extra: 652,568 residents, matching the documented 653k. servicesTierEngine's second fixture.
- **Captures** (extra target, 45 MB) in `/home/user/simcityweb/node_modules/.cache/sim-bench/{populationAggregateProbe,econ,fieldPasses}`, written by the benches' own capture runs.
- Rebuilds give identical content, checked with digests and field-by-field.
- `npm run fixtures` took 336 s for the fixtures at load about 25, and 356 s more for the captures at load 45.

**Test results**
- `tsc --noEmit` is clean.
- The three fixture test files: 60 passed, 0 skipped.
- The three capture test files (populationAggregateProbe, desirabilityLandValueBands, fieldPasses): 61 passed.
- Full `npx vitest run --testTimeout=900000` at load 40–60, before the captures existed:
  - Files: 113 passed, 2 failed, 1 skipped.
  - Tests: 1,079 passed, 2 failed, 6 skipped.
  - The 2 failures are wall-clock limits that pass alone: `tests/infra/perf.test.ts` (107.8 ms vs 100) and `tests/save/terrain.test.ts` (3,686 ms vs 3,000).
- **Skipped count went from 18 to 6.** trafficCore's 10 and roadTransitSearch's 2 now run and pass; servicesTierEngine's 4 fixture tests now exist and pass. With the captures in place, only the 3 `BALANCE`-gated tests still skip.

**Notes**
- Imported regions show no overview image in Load Region until the region is first opened; this is the known polish note.
- `tests/sim/botFallback.test.ts`'s USAGE check does not list the new flags; that file was outside my task.

All my processes are stopped, and my vite cache and bundle cache are removed. Logs and scripts are in `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/simB/tooling/`.
