# Test cities and WASM fixtures

Everything here is generated, not committed: the shared test cities live in session scratch, and the WASM fixtures
live in the gitignored `tools/bench/.fixtures/`. A container reset deletes both. **One command rebuilds all of it:**

```
npm run fixtures -- --cities /tmp/claude-0/-home-user-simcityweb/<session>/scratchpad/cities
```

On this machine (4 cores) that takes about 10 minutes when it is quiet and up to 25 minutes while other agents run
browsers. Leave out `--cities DIR` to build only the WASM fixtures and captures, or use `--only cities --cities DIR`
to build only the cities. `npm run fixtures -- --help` lists the
options. An output that already exists is kept unless you pass `--force`.

The script is `tools/makeFixtures.mjs`. It needs no tsx and no network: each generator is bundled with rolldown (a
vite dependency) into `node_modules/.cache/sim-fixtures/` and run with plain node. Its processes set
`oom_score_adj` 800, so under memory pressure the kernel kills them before the agent session.

## Shared test cities

These are bot cities (`tools/simbot.ts`, seed 7, medium difficulty, plains terrain, water 0.2), saved by
`--save-years` at the end of the listed years. They are built from the tree you run the command in.

| Name | Run | Residents | Buildings | `.city.metropolis` | `.region.metropolis` | Saved after |
|---|---|---:|---:|---:|---:|---|
| `small_s7_y10` | 128 map, 10 years | 101,650 | 2,765 | 1.15 MB | 1.15 MB | 29 s |
| `vet_s7_y21` | 256 map, one 43-year run | 304,083 | 9,223 | 4.38 MB | 4.38 MB | 76–94 s |
| `vet_s7_y43` | same run | 991,493 | 11,495 | 4.56 MB | 4.57 MB | 200–205 s |

- **Times:** wall clock on Oct 27 at load 10–12. The whole 43-year run used 167 s of CPU (164 s user, 2.6 s sys).
  Each save adds about 1 s of CPU.
- **Determinism:** two runs give identical cities; the content of every layer, building and data field matched (only
  `savedAt` differs). The `vet` cities have the populations of the lost `Vet y21` (304k) and `r3_y43` (991k) saves.
- **Each name has three files:**
  - `<name>.city.metropolis` holds the city alone, i.e. `packFile(serializeCity(st))`. Load it in node with
    `deserializeCity(await unpackFile(bytes))`, the way `tools/bench/roadTransitSearch/fixtures.ts` loads fixtures.
  - `<name>.region.metropolis` is a one-city region file in the format the game's *Export region* writes
    (`src/save/index.ts` `buildRegionFile`). The region is a seeded Greenvale region named after the file. The city
    sits on the driest tile of its size (medium for 128, large for 256), and the tile carries the city summary. In the
    game: **Load Region → Import file… → Open → click the city under Cities → Play**. The region has no overview
    image until the game draws one when the region first opens.
  - `<name>.READY` is written last, once both files are complete, so other processes can wait for it. It holds a
    small JSON summary: year, day, residents, buildings, funds, both file paths with byte sizes and sha256, the bot
    options and the command. In the 43-year run, `vet_s7_y21.READY` appears about 80 s before the run ends.
- **Files appear atomically:** each is written to a temp file and renamed into place.

Build a city by hand:

```
npx tsx tools/simbot.ts --size 128 --years 10 --seed 7 --quiet --save-years 10 --save-prefix <dir>/small_s7_
npx tsx tools/simbot.ts --size 256 --years 43 --seed 7 --quiet --save-years 21,43 --save-prefix <dir>/vet_s7_
```

- `--save-years a,b` saves the city at the end of those years, where year 1 is the end of the first year.
  `--save-prefix P` gives `Py<N>.city.metropolis`, `Py<N>.region.metropolis` and `Py<N>.READY`.
- Saving uses the game's own save code (`tools/citySaves.ts`: `serializeCity` + `encodeBundle`, gzip via
  `node:zlib`, the stream format `unpackFile` reads).
- **Saving does not change the run.**
  - Its notes go to stderr, so stdout is byte-identical to a plain run except the two timing columns (`econms`,
    `totalms`) and the `done in` and `ms/day by system` lines. Those are CPU-time measurements and differ between any
    two runs, with or without saving.
  - Checked on 128×15 seed 7, saving every year against not saving, with `SIMBOT_LOG=1`: the 22 other table columns,
    the full action log, the news and the final lines are identical (1,201 lines). 2015 has 194,432 residents. The
    year-15 city saved after 14 earlier saves matches, in every field, the one saved without them.

Compare two runs:

```
norm() { awk '/^20[0-9][0-9] /{NF-=2; print; next} !/^done in/ && !/^ms\/day by system/' "$1"; }
diff <(norm plain.out) <(norm saving.out)
```

## WASM test and benchmark fixtures

`npm run fixtures` builds these into `tools/bench/.fixtures/`, which is gitignored. Each test or bench reads
`$SIM_FIXTURES` or `$SIM_SNAP` first, then this directory; `npm run fixtures` writes to the same place.

| Output | What | Numbers (checked on every rebuild) | Size | Build |
|---|---|---|---:|---:|
| `snap/` | `git archive 24f8609` | 292 files, 6.2 MB | | 1 s |
| `fixtures/dense1m_s7.metropolis` | `sim-profile/fixtures/dense1m.ts` on snap: target 1,150,000, 120 warm days, seed 7 | 1,118,755 residents, 17,154 buildings, 23,141 road cells, 30,084 transit nodes (23,141 road + 6,943 subway) | 3.53 MB | 13 s |
| `fixtures/stress1m_testdefs_s7.metropolis` | `sim-profile/fixtures/stress.ts` on snap: `stressCity(256, 7, { popScale: 1.55, jobsPerWorker: 1.05 })`, test defs | 1,034,100 residents, 19,484 buildings, 36,003 road cells | 0.19 MB | < 1 s |
| `fixtures/bot256_s7_y60.metropolis` | `sim-profile/fixtures/botgrow.ts` on snap: the 24f8609 SimBot, 256 map, seed 7, 60 years | 652,568 residents, 11,276 buildings, 13,828 road + 81 rail cells | 4.35 MB | 4–5 min (190 s CPU) |
| `node_modules/.cache/sim-bench/` `populationAggregateProbe/`, `econ/`, `fieldPasses/` | captures of dense1m and bot256 (fieldPasses also bot256 with a synthetic coast), written on snap by the benches' own capture runs | 2 + 2 + 3 files, byte-identical on a rebuild | 45 MB | 6 min at load 45 (50 s CPU) |

The content sha256 that the script prints (content minus `savedAt`) was `d8e217f3…` for dense1m, `3ba552f9…` for
stress1m and `5cfc7236…` for bot256 on every rebuild so far.

**`snap/`** contains:
- the frozen tree that `tests/wasm/trafficCore.test.ts` B/C/D and the benches' `--tree snap` run on. trafficCore
  imports 14 modules from it: `src/sim/infra/{traffic,params,common,graph,transit}.ts`,
  `src/sim/{Simulation,CityState}.ts`, `src/sim/systems/index.ts`, `src/sim/economy/{demographics,tuning}.ts`,
  `src/core/types.ts`, `src/save/{serialize,bundle}.ts` and `tests/infra/cityGen.ts`.
- no `*.test.*` or `*.spec.*` files. Vitest collects test files anywhere under the repo, dot directories included,
  so the snapshot leaves them out. `tsc` and vite's dependency scan skip dot directories.
- a `node_modules` link to the repository's, for tools run inside the snapshot (the 24f8609 sources themselves import
  only `node:` built-ins).
- copies of the three `tools/bench/sim-profile/fixtures` generators, which were added after 24f8609. They are refreshed
  from the live tree on every run so they build against the frozen `src`.
- a `.commit` marker.

If the clone is shallow and 24f8609 is missing, the script runs `git fetch --unshallow` first.

**These are the profiler's original fixtures of Sep 28, rebuilt exactly.**
- The numbers match `docs/WASM_PLAN.md` and `docs/WORKER_DESIGN.md`: 1,118,755 residents, 17,154 buildings, 23,141
  road cells and a 30,084-node transit network for dense1m; about 1.03M and 36k road nodes for stress1m; 653k and
  13,909 network cells for bot256.
- The fixtures were saved with the 24f8609 tree, so they run in it (trafficCore C loads dense1m with the frozen save
  code). The live tree also loads them as old saves.
- `dense1m` needs a target of 1,150,000. The generator's default of 1,000,000 gives 985,989 residents.
- Built on the live tree instead, dense1m changes (1,150,423 residents, 17,121 buildings). stress1m stays identical
  apart from 4 stats fields that newer code adds.
- The bot cities are no substitute for dense1m. `vet_s7_y43` runs in the 24f8609 tree, but it has 991,493 residents,
  below the `> 1,000,000` that trafficCore's dense1m test asserts, and it has no subway (dense1m has 6,943 subway
  cells and 3,086 stops).
- Two rebuilds give the same content: the counts, the digest and an every-field comparison.

**Tests that use them.** Every one skips when its input is absent.

| Test file | Input | Tests that run with the fixtures |
|---|---|---|
| `tests/wasm/trafficCore.test.ts` | snap; C dense1m also `dense1m_s7` | B, C (8, 2 of them on dense1m) and D: 10 |
| `tests/wasm/roadTransitSearch.test.ts` | `dense1m_s7`, `stress1m_testdefs_s7` | 2 |
| `tests/wasm/servicesTierEngine.test.ts` | `dense1m_s7`, `bot256_s7_y60` | 2 per fixture: 4 |
| `tests/wasm/populationAggregateProbe.test.ts` | the `populationAggregateProbe` captures | 1 |
| `tests/wasm/desirabilityLandValueBands.test.ts` | the `econ` captures | 1 |
| `tests/wasm/fieldPasses.test.ts` | the `fieldPasses` captures | 1 |

## Test results with the rebuilt fixtures (Oct 27)

| Run | Result | Time (load) |
|---|---|---|
| The three fixture files (trafficCore, roadTransitSearch, servicesTierEngine) | 3 files, 60 tests passed, 0 skipped. dense1m trafficCore C: 92 s | 445 s (25–35) |
| The three capture files | 3 files, 61 tests passed, 0 skipped | 194 s (45) |
| Full `npx vitest run --testTimeout=900000`, before the captures existed | 113 files passed, 2 failed, 1 skipped; 1,079 tests passed, 2 failed, 6 skipped | 1,968 s (40–60) |

- **The 2 failures are wall-clock limits.** `tests/infra/perf.test.ts` measured 107.8 ms against 100.
  `tests/save/terrain.test.ts` measured 3,686 ms against 3,000. Both passed when run alone (2/2 and 6/6).
- **Skipped tests:** 6, down from 18 before the rebuild. The 12 that now run are trafficCore's 10 and
  roadTransitSearch's 2. servicesTierEngine's 4 fixture tests are only registered when their files exist, so they are
  new rather than formerly skipped.
- **With the captures**, the only skipped tests left are the 3 gated by `BALANCE`: `tests/sim/balance.test.ts` (2) and
  `tests/sim/botRules.test.ts` (1).
