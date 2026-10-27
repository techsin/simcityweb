# local-FH-04-easy: Easy becomes a real first-city mode; Medium and Hard stay bit-identical (POLISH_PLAN FH-04; T022)

Branch `local/FH-04-easy`, base **`b60b2d3`** (the dev-branch head when the task started).

**One gate is not met:** the FH-10 newcomer on Easy. Its town never grows past its four starting blocks on any
difficulty, which is FH-10's documented stall until FH-03's zone-more warning exists. FH-04's own rules lift its
approval by 13.7 points, but not to 50 (details below). Every other gate passes.

## What changed

- **`src/sim/economy/tuning.ts`:** `DIFFICULTY_RULES`, one row per difficulty.
  - Fields: `income`, `fadeCrime`, `fadeMonthlyEmergencies`, `defaultDisasters` and `blurb`.
  - `DIFFICULTY_INCOME` moves into the table with its values unchanged (1.2 / 1.0 / 0.85 / 1.0).
  - `difficultyRules(d)` reads a row. An unknown saved difficulty gets Medium's row, as the income multiplier always
    fell back to 1.
  - The blurbs are FH-11's card lines: "§250k, +20% taxes, forgiving first years · Recommended for your first city",
    "§100k, the intended balance", "§40k, −15% taxes, tight from day one" and "unlimited money, everything unlocked".
- **`src/sim/economy/approval.ts`** (`update()`, plus `approvalBreakdown`):
  - On Easy, the crime term is multiplied by the same `smoothstep(needsPop0, needsPop1)` fade as the outage terms
    (2k → 8k surveyed residents).
  - On Easy, the monthly emergency losses (failed, late, deaths) get the remembered term's fade. Riot days stay at
    full weight.
  - The breakdown's crime term carries the detail `new-town grace` while the fade applies, including when the term is 0,
    so the later hover can read "Crime −3 (new-town grace)".
  - **Medium, Hard and Sandbox keep today's expressions literally.** The crime multiply is skipped by the flag, and the
    emergency line is the old expression in its own branch, so not even the floating-point order changes.
- **`src/sim/config.ts`:** the New City default `disasters` comes from the row, so it is off for Easy only. A saved
  city keeps its saved `config.disasters`.
- **`src/sim/economy/budget.ts`:** the income multiplier is read through the row.
- **`tests/sim/difficultyRules.test.ts`** (new, 32 tests):
  - the table rows, the blurbs and the unknown-difficulty fallback;
  - New City defaults and saved overrides; income per difficulty;
  - both fades, on and off by difficulty, at 7 populations;
  - the grace note, including its zero-term case;
  - the emergency cap, riot days, and the fire fallback;
  - old Easy, Medium, Hard and Sandbox saves loading and continuing for three months.

## Gates

| Gate | Result |
|---|---|
| Medium and Hard bit-identical, by the two-process method | **identical**: every yearly state hash, base and branch, on 256 × 60 s7 and s11 and 128 × 15 s7, both difficulties (270 year-hashes) |
| 128 × 15 s7 Medium | **194,432** in 2015, base and branch |
| Easy 128 × 15 s7: approval ≥ 55 in every year 2001–06 | **met:** 60.3, 61.3, 63.0, 64.6, 60.8, 58.9 (base Easy: 53.5, 61.5, 63.5, 64.5, 60.7, 58.8) |
| FH-10 newcomer on Easy: approval ≥ 50 from year 2 | **not met:** 37.8–39.2 % from year 2 (Medium: 23.6–26.1 %) |
| FH-10 newcomer on Easy: ≥ 2× the Medium newcomer's population in year 6 | **not met:** 100 vs 100 residents (1.00×) |
| Easy's funds by 2015 (record) | **§1,244,279** (base Easy §840,425; Medium §168,308). The plan expected about §925k; accepted for this mode |
| Old Easy and Medium saves load and continue | tests: Easy gets both fades at once (intended, FH-04 Risk); Medium, Hard and Sandbox terms unchanged |
| `npx tsc --noEmit` / `npx vitest run` | clean / **129 files passed, 1 skipped; 1,155 tests passed, 12 skipped, 0 failed** |

**Method.** `yearRows.mts`, a scratch script, runs one bot per process: the CLI's defaults (plains, water 0.2) at the
given size, years, seed and difficulty.
- After every year it records the exact population, approval and funds.
- It also records a sha256 of `serializeCity(st, { copy: true })`, with keys sorted, typed arrays hashed as raw bytes,
  and `Date.now` pinned so the save timestamp drops out.
- Base (`b60b2d3`) and branch run in separate processes, and their yearly hashes are compared.
- It reproduces the known numbers: 194,432 in 2015, and FH-10's newcomer table year for year.

## The newcomer gate, and why FH-04 cannot meet it alone

| year | Medium pop / approval | **Easy pop / approval** | Easy's top terms (points) |
|---:|---|---|---|
| 1 | 97 / 26.6 % | 97 / **38.9 %** | air pollution −7.3, residential taxes −7.0, city services at homes −5.4 |
| 2 | 100 / 25.5 % | 100 / **39.2 %** | residential taxes −7.0, air pollution −6.6, city services −5.4 |
| 4 | 100 / 25.4 % | 100 / 39.2 % | the same |
| 6 | 100 / 25.4 % | 100 / 39.2 % | the same |
| 10 | 112 / 26.1 % | 112 / 40.5 % | residential taxes −7.0, city services −5.4, air pollution −4.9 |

- **What FH-04 does here.** It removes the crime term: −13.8 points at 100 residents on Medium, 0 on Easy. That is the
  whole difference between the columns.
- **What keeps approval under 50.** The three terms left (taxes, air pollution from the coal plant, services at homes)
  total about −19. None of them is an FH-04 rule.
- **Why the population cannot double.** The newcomer profile expands only on zone-more *warnings*. Today the advisor
  posts that cue as an info message, so the town never grows past its four starting 4 × 4 blocks, on any difficulty
  (FH-10's round-2 report says the same). FH-04 does not touch growth.
- **Suggestion.** Re-run this gate after FH-03 lands the zone-more warning (FH-10's report names it as the missing cue),
  or give the gate to FH-03 / FH-10.
- I did not tune anything toward it.

## Still to do (per T022)

Re-run the two-process check after the lead merges check 4's branches (T022: "I will say when").

## Who wrote what

- **Codex** (max effort): the table, both fades, the grace detail, the config and budget hunks, and 31 of the 32 tests.
  It could not run vitest in its sandbox (`spawn EPERM`), so none of its tests had run before review; all 31 pass.
- **Me (Claude):**
  - the brief and the review;
  - the blurbs, replaced with FH-11's text (Codex had written its own);
  - `difficultyRules()` and its fallback test;
  - every gate: the two-process hash runs (18 bot runs), the Easy and newcomer rows, tsc and the full vitest.
