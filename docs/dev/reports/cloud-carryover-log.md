# Cloud carry-over merge log (from Nov 3)

One line per merge: lane, merge commit, gates.

- t033 (T033, W1.1b recovery mirror): merge d101122, 2026-11-03; tsc clean; full vitest 203 files passed, 1 skipped, 2,038 tests passed, 4 skipped (475 s); bot residents [ 59288, 95301, 41512 ], 196k in 2015, year rows equal to dev 923428d
- t029 (T029, emergency policy part 1: in range never slows; the 30 s cooldown): merge 3aff6e0, 2026-11-03; tsc clean; full vitest 204 files passed, 1 skipped, 2,056 tests passed, 4 skipped (469 s); bot residents [ 59288, 95301, 41512 ], 196k in 2015, year rows equal to dev d101122 apart from the timing columns
- t037d (T037d, guide chain: FH-06 approval a newcomer can read; FH-09 tax panel and taxHigh): merge f85d538, 2026-11-03; tsc clean; full vitest 208 files passed, 1 skipped, 2,087 tests passed, 4 skipped (468 s); bot residents [ 59288, 95301, 41512 ], 196k in 2015, year rows equal to dev 44f39b1 apart from the timing columns
