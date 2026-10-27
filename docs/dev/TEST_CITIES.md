# Test cities and WASM fixtures

Everything here is generated, not committed: the shared test cities live in session scratch, and the WASM fixtures
live in the gitignored `tools/bench/.fixtures/`. A container reset deletes both. **One command rebuilds all of it:**

```
npm run fixtures -- --cities /tmp/claude-0/-home-user-simcityweb/<session>/scratchpad/cities
```

On this machine (4 cores, other agents running) that takes about 10 minutes. Leave out `--cities DIR` to build only
the WASM fixtures, or use `--only cities --cities DIR` to build only the cities. `npm run fixtures -- --help` lists the
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
| `fixtures/bot256_s7_y60.metropolis` | `sim-profile/fixtures/botgrow.ts` on snap: the 24f8609 SimBot, 256 map, seed 7, 60 years | 652,568 residents, 11,276 buildings, 13,828 road + 81 rail cells | 4.35 MB | 5 min (190 s CPU) |

**`snap/`** contains:
- the frozen tree that `tests/wasm/trafficCore.test.ts` B/C/D and the benches' `--tree snap` run on. The snapshot leaves
  out the `*.test.*` and `*.spec.*` files, because vitest collects test files anywhere under the repo, including
  dot directories. `tsc` and vite's dependency scan skip dot directories.
- a `node_modules` link to the repository's.
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
- Two rebuilds give the same content: the counts, the sha256 of the content minus `savedAt` (printed by the script),
  and an every-field comparison.

**Tests that use them** (all skip when their file is absent):
- `tests/wasm/trafficCore.test.ts` B/C/D: snap; C dense1m also uses `dense1m_s7`.
- `tests/wasm/roadTransitSearch.test.ts`: `dense1m_s7` and `stress1m_testdefs_s7`.
- `tests/wasm/servicesTierEngine.test.ts`: `dense1m_s7` and `bot256_s7_y60`, two tests each.

Three more WASM tests read captures from `node_modules/.cache/sim-bench/{econ,fieldPasses,populationAggregateProbe}`.
They are `desirabilityLandValueBands`, `fieldPasses` and `populationAggregateProbe`. The benches write these captures
from the fixtures above (the `capture` suite of `npm run bench:econ`, `bench:fields` and
`node tools/bench/populationAggregateProbe.bench.mjs capture`). `npm run fixtures` does not build them.
