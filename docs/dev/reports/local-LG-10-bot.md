# local-LG-10-bot: bot strategies for the long-game systems, round 1 (POLISH_PLAN LG-10; T024)

Branch `local/LG-10-bot`, base **`8182828`** (the dev-branch head when the task started). One file changes,
`tools/simbot.ts`, plus a new test file. No `src/` file, no fixture rows (nothing was asked to be recorded under
`polish` yet: every flag is off by default, so today's rows stand).

## The rules as built

Each rule is behind its own flag, off by default; `--profile newcomer` refuses them (as it refuses `--tax`, `--spendy`
and `--skip`), and `--skip` / `--neglect` keep working. `--help` lists them.

| Flag | What the bot does |
|---|---|
| `--subway` | From 150k residents: one line from the core to the three densest developed 8 × 8 residential blocks (each home counted once, ties in map order), entrances every 8 tiles on the nearest walkable lot within 4 tiles with a tunnel spur. The first plan stays put; missing entrances retry without re-routing. |
| `--late-ordinances` | Considers the 14 ordinances the base bot never enacts, each with its own "useful now" test (water / power conservation above 60 % of supply, sewage mandate under 90 % treated, quiet zones on noise, clean power act with smokestack plants, pollution controls and the clean air act on polluted air with low unemployment, tire recycling, brownfield cleanup on soil pollution, tourism promotion, youth curfew on crime, parking fines on long commutes or a deficit, legalized gambling on a deficit, nuclear-free zone when supply is ample without a nuclear plant), and enacts it only when its whole monthly bill fits the net income and three months of it can be spent. |
| `--venues` | Buys the zoo even when the residential cap never asks for it, and one passenger train station with rail to the map edge, when affordable. |
| `--tax=N` | Fixed tax rates from setup (for NEW-05's sweep). |
| `--expand` | **Not built.** The plan's expansion rule needs LG-19's facility expansion, which this base does not have; the flag is documented in `--help` as landing with LG-19. |

`--megaprojects`, `--arcology` and `--charter=X` land with their items (LG-03, LG-04, LG-17).

## Gates

### G-DET: flags off, bit-identical

Two-process method: base (`8182828`) and branch each run in its own process; after every year a sha256 of
`serializeCity(st, { copy: true })` (keys sorted, typed arrays as raw bytes, `Date.now` pinned).

| Run | Years | Result |
|---|---|---|
| 256 × 60 seed 7 | 60 | **every yearly hash identical**; 1,368,806 in 2060 |
| 256 × 60 seed 11 | 60 | **every yearly hash identical**; 1,500,564 in 2060 |
| 128 × 15 seed 7 | 15 | **every yearly hash identical**; **194,432** in 2015 |

### The GATE SUMMARY with the flags on

How each run was measured:
- A gate script ran one bot run per process and recorded the GATE SUMMARY inputs every year, measured the way
  `tests/sim/balance.test.ts` measures them.
- The tourism ratio is econData's tourism jobs over the legacy formula (`demandContext().tourism`), as a 12-month
  mean of monthly samples.
- The 12 runs ran 6 at a time at below-normal priority, so ms/day carries that batch's load. G-MS therefore compares
  each run with the flags-off run of the same city from the same batch.
- G-STEP is recorded, not gated, because B2 changes the steps later. It is the largest estimated step per task:
  `task.cost()`, read before each step, as `tests/infra/catchments.test.ts` samples it.

**Every gate passes on every run, so there is no miss to name or attribute.**

| Run (256 × 60 s7 unless named) | Population, last year (vs flags off) | Lowest approval from year 30 | Tourism ratio from year 15 | Mean ms/day (vs flags off) |
|---|---|---|---|---|
| flags off | 1,368,806 in 2060 | 79.6 | 0.93–1.18 | 7.74 (reference) |
| `--subway` | 1,417,991 in 2060 (+3.6 %) | 79.8 | 0.93–1.18 | 7.63 (−0.11) |
| `--late-ordinances` | 1,427,091 in 2060 (+4.3 %) | 77.9 | 0.76–1.16 | 8.21 (+0.47) |
| `--venues` | 1,357,064 in 2060 (−0.9 %) | 79.1 | 0.92–1.18 | 7.73 (±0.00) |
| `--tax=12` | 1,042,999 in 2060 (−23.8 %) | 68.0 | 0.71–1.08 | 7.46 (−0.28) |
| all three rules | 1,485,923 in 2060 (+8.6 %) | 78.4 | 0.76–1.19 | 8.21 (+0.48) |
| flags off, seed 11 | 1,500,564 in 2060 | 78.1 | 0.89–1.29 | 6.95 (reference) |
| flags off, 128 × 15 s7 | 194,432 in 2015 | – | 1.12–1.12 | 4.22 (reference) |

### What each rule did on 256 × 60 s7

From the bot's own dated log, in the same deterministic runs.

**`--subway`:**
- It planned the line at 150k residents, in Aug 2013.
- It built it in Mar 2023: the tunnels and 16 of 17 entrances.
- The rule spends through `canSpendOpt`, which keeps the venue fund untouched. The line was built five months after
  the bot bought its last venue from that fund (International Airport, Oct 2022).
- The 17th entrance never finds a walkable lot within 4 tiles. It retries every 90 days, and each retry logs a line;
  nothing is spent.
- The line arrives 10 years after its trigger. That is for LG-08, whose towers grow around stations.

**`--late-ordinances`:** it enacted 11 of the 14 ordinances it considers.
- Nuclear-free zone (Feb 2002, $0 a month), repealed in Mar 2026 before the bot bought nuclear power.
- Parking fines (Mar 2002; they earn $88 a month).
- Quiet zones, the clean power act, brownfield cleanup and tourism promotion (all Nov 2021).
- Water conservation (Jan 2022) and power conservation (Jan 2023).
- Tire recycling (Feb 2035), industrial pollution controls (Jan 2038) and the clean air act (Feb 2053).
- Never enacted: the sewage mandate, the youth curfew and legalized gambling.
- The run's lowest tourism ratio, 0.76, is in 2017, before any of the 2021 ordinances. The two 2002 ordinances shift
  the city's timeline, and the run's venues open in other months (the amusement park in Jun 2017 instead of
  Oct 2017).

**`--venues`:**
- The passenger train station with rail to the map edge came in Dec 2022, and the zoo in Jan 2023.
- With the zoo, the city's tourism ratio stays at 0.92–1.18 (flags off: 0.93–1.18). Its population is 0.9 % lower
  in 2060.

**`--tax=12`:** 12 % from setup costs 23.8 % of the 2060 population, and the lowest approval from year 30 falls to
68.0 (flags off: 79.6). This is a data point for NEW-05's sweep, which the flag is for.

### Every gate, run by run

#### flags off (256 × 60 s7)

| gate | result | detail |
|---|---|---|
| G-POP | PASS | y15 178,121, y60 1,368,806; lowest vs phase 0 1.058 |
| G-APPR | PASS | lowest from year 30 79.6 |
| G-FUNDS | PASS | lowest daily 4,863 |
| G-EQ | PASS | best by year 30 118.9 |
| G-UNEMP | PASS | worst \|unemployment − (1 − accW)\| 0.001 |
| G-EMG | PASS | auto lowest 94.3 %; failed 0.2 % (46/22326) from year 10 |
| G-JAIL | PASS | worst overflow from year 20 0.141 |
| G-AB | PASS | worst abandoned 1.4 % |
| G-TOUR | PASS | ratio from year 15 0.93–1.18 |
| G-MS | PASS | mean ms/day 7.74 vs 7.74 (+0.00) |
| G-STEP | recorded | largest estimated steps (ms): traffic 2.8, services 2.3, pollution 2.3 |

#### --subway (256 × 60 s7)

| gate | result | detail |
|---|---|---|
| G-POP | PASS | y15 178,121, y60 1,417,991; lowest vs phase 0 1.058 |
| G-APPR | PASS | lowest from year 30 79.8 |
| G-FUNDS | PASS | lowest daily 4,863 |
| G-EQ | PASS | best by year 30 119.3 |
| G-UNEMP | PASS | worst \|unemployment − (1 − accW)\| 0.001 |
| G-EMG | PASS | auto lowest 94.3 %; failed 0.2 % (36/22373) from year 10 |
| G-JAIL | PASS | worst overflow from year 20 0.145 |
| G-AB | PASS | worst abandoned 1.4 % |
| G-TOUR | PASS | ratio from year 15 0.93–1.18 |
| G-MS | PASS | mean ms/day 7.63 vs 7.74 (-0.11) |
| G-STEP | recorded | largest estimated steps (ms): traffic 2.8, services 2.3, pollution 2.3 |

#### --late-ordinances (256 × 60 s7)

| gate | result | detail |
|---|---|---|
| G-POP | PASS | y15 183,930, y60 1,427,091; lowest vs phase 0 1.058 |
| G-APPR | PASS | lowest from year 30 77.9 |
| G-FUNDS | PASS | lowest daily 5,165 |
| G-EQ | PASS | best by year 30 121.0 |
| G-UNEMP | PASS | worst \|unemployment − (1 − accW)\| 0.000 |
| G-EMG | PASS | auto lowest 93.7 %; failed 0.1 % (16/22703) from year 10 |
| G-JAIL | PASS | worst overflow from year 20 0.149 |
| G-AB | PASS | worst abandoned 0.4 % |
| G-TOUR | PASS | ratio from year 15 0.76–1.16 |
| G-MS | PASS | mean ms/day 8.21 vs 7.74 (+0.47) |
| G-STEP | recorded | largest estimated steps (ms): traffic 2.8, services 2.3, pollution 2.3 |

#### --venues (256 × 60 s7)

| gate | result | detail |
|---|---|---|
| G-POP | PASS | y15 178,121, y60 1,357,064; lowest vs phase 0 1.058 |
| G-APPR | PASS | lowest from year 30 79.1 |
| G-FUNDS | PASS | lowest daily 4,863 |
| G-EQ | PASS | best by year 30 118.9 |
| G-UNEMP | PASS | worst \|unemployment − (1 − accW)\| 0.000 |
| G-EMG | PASS | auto lowest 94.3 %; failed 0.1 % (33/22005) from year 10 |
| G-JAIL | PASS | worst overflow from year 20 0.143 |
| G-AB | PASS | worst abandoned 1.4 % |
| G-TOUR | PASS | ratio from year 15 0.92–1.18 |
| G-MS | PASS | mean ms/day 7.73 vs 7.74 (-0.00) |
| G-STEP | recorded | largest estimated steps (ms): traffic 2.8, services 2.3, pollution 2.3 |

#### --tax=12 (256 × 60 s7)

| gate | result | detail |
|---|---|---|
| G-POP | PASS | y15 179,354, y60 1,042,999; lowest vs phase 0 1.056 |
| G-APPR | PASS | lowest from year 30 68.0 |
| G-FUNDS | PASS | lowest daily 4,404 |
| G-EQ | PASS | best by year 30 130.4 |
| G-UNEMP | PASS | worst \|unemployment − (1 − accW)\| 0.000 |
| G-EMG | PASS | auto lowest 95.5 %; failed 0.1 % (29/19826) from year 10 |
| G-JAIL | PASS | worst overflow from year 20 0.140 |
| G-AB | PASS | worst abandoned 0.7 % |
| G-TOUR | PASS | ratio from year 15 0.71–1.08 |
| G-MS | PASS | mean ms/day 7.46 vs 7.74 (-0.28) |
| G-STEP | recorded | largest estimated steps (ms): traffic 2.8, services 2.3, pollution 2.3 |

#### all three rules (256 × 60 s7)

| gate | result | detail |
|---|---|---|
| G-POP | PASS | y15 183,930, y60 1,485,923; lowest vs phase 0 1.058 |
| G-APPR | PASS | lowest from year 30 78.4 |
| G-FUNDS | PASS | lowest daily 5,165 |
| G-EQ | PASS | best by year 30 120.6 |
| G-UNEMP | PASS | worst \|unemployment − (1 − accW)\| 0.000 |
| G-EMG | PASS | auto lowest 93.7 %; failed 0.1 % (27/22971) from year 10 |
| G-JAIL | PASS | worst overflow from year 20 0.146 |
| G-AB | PASS | worst abandoned 0.4 % |
| G-TOUR | PASS | ratio from year 15 0.76–1.19 |
| G-MS | PASS | mean ms/day 8.21 vs 7.74 (+0.48) |
| G-STEP | recorded | largest estimated steps (ms): traffic 2.8, services 2.3, pollution 2.3 |

#### flags off, seed 11 (256 × 60 s11)

| gate | result | detail |
|---|---|---|
| G-POP | PASS | y15 182,390, y60 1,500,564; lowest vs phase 0 0.961 |
| G-APPR | PASS | lowest from year 30 78.1 |
| G-FUNDS | PASS | lowest daily 3,939 |
| G-EQ | PASS | best by year 30 122.0 |
| G-UNEMP | PASS | worst \|unemployment − (1 − accW)\| 0.000 |
| G-EMG | PASS | auto lowest 93.3 %; failed 0.2 % (36/22890) from year 10 |
| G-JAIL | PASS | worst overflow from year 20 0.148 |
| G-AB | PASS | worst abandoned 1.1 % |
| G-TOUR | PASS | ratio from year 15 0.89–1.29 |
| G-MS | PASS | mean ms/day 6.95 vs 6.95 (+0.00) |
| G-STEP | recorded | largest estimated steps (ms): traffic 2.8, services 2.3, pollution 2.3 |

#### flags off (128 × 15 s7)

| gate | result | detail |
|---|---|---|
| G-POP | PASS | y15 194,432; lowest vs phase 0 1.076 |
| G-FUNDS | PASS | lowest daily 5,292 |
| G-EQ | PASS | best by year 15 103.0 |
| G-UNEMP | PASS | worst \|unemployment − (1 − accW)\| 0.000 |
| G-EMG | PASS | auto lowest 98.5 %; failed 0.0 % (0/528) from year 10 |
| G-AB | PASS | worst abandoned 0.5 % |
| G-TOUR | PASS | ratio from year 15 1.12–1.12 |
| G-MS | PASS | mean ms/day 4.22 vs 4.22 (+0.00) |
| G-STEP | recorded | largest estimated steps (ms): services 2.3, traffic 1.1, pollution 0.6 |

### The plan's targets (reported, not gated here)

Each target belongs to the item that owns its content, as the plan's acceptance lists show. LG-10 only makes them
measurable.

| Target | Run | Value | Plan target | Owner |
|---|---|---|---|---|
| Bank months in 2045 | flags off | 18.1 (funds 8,825,225; expenses 488,017 a month) | ≤ 12 | LG-03 mega-projects (its acceptance, with `--megaprojects`) and the §5 long-game targets |
| Bank months in 2045 | all three rules | 17.5 (funds 9,149,613; expenses 523,465 a month) | ≤ 12 | as above |
| Unemployment in 2060 | flags off | 9.2 % | ≤ 6 % | LG-04 arcologies (its acceptance) |
| Unemployment in 2060 | all three rules | 8.3 % | ≤ 6 % | as above |
| `--skip transit` at 2040 | 256 × 60 s7 | 877,866 vs 884,258 (−0.7 %) | ≥ 4 % fewer | LG-08 transit-oriented growth |
| `--skip transit` at 2060 | 256 × 60 s7 | 1,340,250 vs 1,368,806 (−2.1 %) | ≥ 10 % fewer | LG-08 |
| `--skip dirty` at year 15 | 128 × 15 s7 | 0.49 × the flags-off population; mean air 36.3 % cleaner | ≥ 0.8 ×; ≥ 15 % cleaner | LG-07 clean and dirty industry |
| `--neglect` at year 60 | 256 × 60 s7 | population −1.7 %, funds +39.1 %, approval 79.3 vs 81.5 | population ≥ 2 % below base; funds no higher than base; the approval cost unchanged or larger | LG-06 neglect costs |
| `--neglect` at year 60 | 256 × 60 s11 | population −5.8 %, funds +2.5 %, approval 74.1 vs 79.6 | as above | LG-06 |

How today's values compare with the plan's "today" figures:
- The plan's figures are from an older base, and some have moved.
- **`--skip dirty`:** 0.49 × here, against the plan's 0.61 ×. The cost of skipping dirty industry has grown, so
  LG-07 has further to go.
- **`--neglect`:** the plan has +0.4 % and +1.6 % population. Here neglect already costs people (−1.7 % and −5.8 %),
  but it still saves money (funds +39.1 % and +2.5 %). That is LG-06's remaining target.
- **The late rules move bank months and unemployment only a little** (18.1 → 17.5 months, 9.2 % → 8.3 %). They do not
  replace LG-03's and LG-04's content.

## Tests

`tests/sim/botLongGame.test.ts` (new, 28 cases) covers:
- option parsing and fixed taxes;
- the subway plan, the ordinance choices and the venues;
- the flags' compatibility with `--skip`, `--neglect` and `--profile newcomer`.

| Check | Result |
|---|---|
| `botLongGame.test.ts` with `tests/sim/botVenues.test.ts` | 38 passed |
| `npx tsc --noEmit` | clean |
| Full suite | 132 files passed, 1 skipped; 1,182 tests passed, 12 skipped (34 s) |

## Who wrote what

- **Codex** (max effort): the flags and the test file.
- **Me (Claude):**
  - the brief and the review;
  - the two-process hash runs;
  - the gate script, which records the GATE SUMMARY inputs every year, measured as `tests/sim/balance.test.ts`
    measures them, with the tourism ratio from `demandContext()` and the estimated step costs sampled as
    `tests/infra/catchments.test.ts` samples them;
  - the 12 gate runs and the tables;
  - the four bot-log runs behind "What each rule did".
