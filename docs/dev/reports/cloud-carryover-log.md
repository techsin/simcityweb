# Cloud carry-over merge log (from Nov 3)

One line per merge: lane, merge commit, gates.

- t033 (T033, W1.1b recovery mirror): merge d101122, 2026-11-03; tsc clean; full vitest 203 files passed, 1 skipped, 2,038 tests passed, 4 skipped (475 s); bot residents [ 59288, 95301, 41512 ], 196k in 2015, year rows equal to dev 923428d
- t029 (T029, emergency policy part 1: in range never slows; the 30 s cooldown): merge 3aff6e0, 2026-11-03; tsc clean; full vitest 204 files passed, 1 skipped, 2,056 tests passed, 4 skipped (469 s); bot residents [ 59288, 95301, 41512 ], 196k in 2015, year rows equal to dev d101122 apart from the timing columns
- t037d (T037d, guide chain: FH-06 approval a newcomer can read; FH-09 tax panel and taxHigh): merge f85d538, 2026-11-03; tsc clean; full vitest 208 files passed, 1 skipped, 2,087 tests passed, 4 skipped (468 s); bot residents [ 59288, 95301, 41512 ], 196k in 2015, year rows equal to dev 44f39b1 apart from the timing columns
- t036s2 (T036 step 2, meta chain: NOTE-042 hidden controls, FH-11 good first city, FEEL-05 spring start, FH-21 graphics first run): merge b71b2c2, 2026-11-03; tsc clean; full vitest 212 files passed, 1 skipped, 2,129 tests passed, 4 skipped (471 s); bot residents [ 59288, 95301, 41512 ], 196k in 2015, year rows equal to dev 5b12abe apart from the timing columns
- b3 (B3, chain sim: WASM_PLAN B3 / WORKER_DESIGN S4, the month-boundary work spread over the month): merge 530d570, 2026-11-03; tsc clean; full vitest 216 files passed, 1 skipped, 2,148 tests passed, 4 skipped (447 s); bot residents [ 61124, 93804, 37971 ], 193k (192,899) in 2015, changed by design (B3 T2 + P3; dev 4432beb [ 59288, 95301, 41512 ], 196,101, -1.6%), year rows equal to the lane's own run apart from the timing columns
