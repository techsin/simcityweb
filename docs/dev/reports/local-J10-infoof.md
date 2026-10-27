# local-J10-infoof: exact lookup hoisting in utilities and demographics (WASM_PLAN §6 J10, T007)

Branch `local/J10-infoof`, base `614609f` (J6 dropped, NOTE-003). Files: `src/sim/infra/utilities.ts`,
`src/sim/economy/demographics.ts`, `tests/sim/exact/j10*.ts`, and the gate tools `tools/bench/exact/*` (method as in
`local-J2-traffic.md`).

## What changed
- **`infoOf` itself.** It already caches per building in the live tree (`common.ts`, outside J10's files), and
  `rt.defOf` caches the def per id (see J6). So J10 removes repeated lookups instead of adding a cache.
- **`UtilitiesSystem.prepareUses`.** The treatment scan's `infoOf` results are kept in a reused array (`useInfo`) and
  read back in the next loop over the same building-list prefix, instead of a second `infoOf` per building. The array is
  cleared on `init`. `infoOf` returns the same cached object either way.
- **`demographics.ts`.** `updateDemographics` computes `demoOf(def)` once and passes it to `targetFrom` and
  `wfShare`, instead of twice. `targetShares` keeps its signature.

## Gates

| Gate | Result |
|---|---|
| Differential test `tests/sim/exact/j10.test.ts` | 4/4 pass |
| City level, 120 days at design cadence | sha256 identical to base on all three fixtures |
| Bot 128×15 seed 7 | identical; 194,432 in 2015 |
| `tsc` / full vitest | clean / 1,093 passed, 6 skipped; only the Windows-CRLF `binary.test` fails, also on base |

Speed. CPU time, both arm orders, protector intact, every arm deterministic:

| What | Combined | 95 % CI |
|---|---|---|
| Full utilities pass in place, dense1m (600 per sample) | **1.055×** (1.95 ms base) | fwd [1.057, 1.088], rev [1.03, 1.06] |
| Population system's daily step in place (800 per sample) | 1.013× | fwd [1.000, 1.024], rev [1.00, 1.05] |
| Whole day, design cadence, dense1m (180 days, 80 pairs) | 1.004 | [0.996, 1.009] |
| Whole day, design cadence, bot256 live (270 days, 80 pairs) | 0.992 | [0.992, 1.002] |

Gate passed: every CI lower bound is ≥ 0.99. J10 is small. It is the base for J11 (same file), which is branched from
this commit.

**Who wrote what.**
- **Codex** (max effort, about 11 minutes): the code and the test.
- **Me (Claude):** the brief (including what J6 showed about `rt.defOf`), the review and all gates.
