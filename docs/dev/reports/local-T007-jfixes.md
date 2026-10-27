# local-T007-jfixes: the exact JS fixes of the million-population plan (WASM_PLAN PI-4), by Codex â€” summary

T007 on the Windows worker. All fixes branch from `614609f`, the commit T005 measured. Codex wrote each fix at max
reasoning effort in its own worktree; I briefed, reviewed every diff and ran every gate. One report per fix
(`local-J<n>-*.md`); this file sums them up.

## Outcome

| Fix | Status | Containing system, in place | Whole day, design cadence (dense1m 1.12M / bot256 live 1.37M) | Branch |
|---|---|---|---|---|
| **J2** traffic: radix sort of match keys, cached stop x/z, reused scratch | **done** | traffic cycle **1.17Ã—** | **1.071Ã— [1.056, 1.096]** / **1.026Ã— [1.012, 1.049]** | `local/J2-traffic@b991d0c` |
| **J4** nimby: indexOf row-pair skip, 4-cell word scan | **done** | `rebuildNimby` **1.13Ã—** | 1.002Ã— [1.000, 1.008] / 1.004Ã— [0.994, 1.014] | `local/J4-nimby@a2558a1` |
| **J7** fire + building list (partial) | **done, partial** | fire daily step **1.41Ã—** | 1.013Ã— [1.006, 1.018] / 1.000Ã— [0.996, 1.008] | `local/J7-fire@494e9b7` |
| **J8** blur: 4-row horizontal, fused vertical | **done** | `blur3` **1.57Ã—** | 1.014Ã— [0.998, 1.016] / 1.004Ã— [1.002, 1.012] | `local/J8-blur@acb34be` |
| **J10** infoOf / demoOf reuse | **done** | utilities pass **1.055Ã—**, population daily 1.013Ã— | 1.004Ã— [0.996, 1.009] / 0.992Ã— [0.992, 1.002] | `local/J10-infoof@dde4e6d` |
| J3 services | dropped (NOTE-006) | round 1: 1.000Ã—; round 2: **0.839Ã—** | round 2: 0.983 / 0.967 | not pushed |
| J6 population def index | dropped (NOTE-003) | population daily **0.956Ã—** | 0.993 / 0.997 (short runs) | not pushed |
| J11 utilities single pass | dropped (NOTE-007) | utilities pass â‰ˆ **0.95Ã—** vs J10 | 0.996 [0.978, 1.000] / 1.004 | not pushed |
| J5, J9, J0, J1 | not in T007 (wait for the sim close-out / render round 2 / the worker host) | | | |

All five pushed fixes are bit-identical to `614609f`, and all pass "not slower" (every whole-day CI lower bound
â‰¥ 0.99). J2 is the only one with a clear whole-day gain on its own (+7 % on dense1m). The others are clear wins
inside their systems but below about 1 % of the day each.

## Gates (identical for every fix)

- **Exactness.**
  - A frozen test-only copy of the pre-fix code and a differential test with â‰¥ 10k randomized and adversarial cases
    (`tests/sim/exact/*`).
  - City level: sha256 of `serializeCity({copy:true})` plus per-key digests, identical to base after 120 days at
    design cadence on dense1m, bot256 y60 (snap, 652k) and bot256 y60 (live, 1.37M), via `tools/bench/exact/cityDigest.ts`.
  - The 128Ã—15 seed-7 bot table identical (194,432 in 2015; with the full action log for J11 and later).
- **Speed** (`tools/bench/exact/abDay.ts` = T005's `pi1Day.ts` with `--armB` and `--kernel`).
  - CPU time; two isolates, one per code version; protector intact in both; fixtures loaded with zlib + `decodeBundle`.
  - Every round rebuilds the city and times the same window.
  - **Both arm orders.** The A/A runs showed a 1.3â€“1.8 % arm-position bias, so every A/B ran with the fix as arm B and
    as arm A, and the two were combined.
  - Kernels: 32 rounds per order. Whole day: 180 / 270-day chunks Ã— 40 rounds per order (worst-case tick error
    0.8â€“0.9 %). Long-run A/A floor: 0.998 [0.991, 1.004] / 1.000 [0.996, 1.006].
- `npx tsc --noEmit` clean. `npx vitest run` passes everywhere except the Windows-only `tests/wasm/binary.test.ts`
  (CRLF changes the Rust-source hash), which fails identically on base. T012's `.gitattributes` fixes it.

## Dropped fixes: the numbers
- **J3 (services).**
  - Round 1 (fused `finalizeTier`, f64 transit-disk table, Map/entry reuse): exact; services pass 1.000Ã—; whole day
    1.000 / 1.030 (short runs). It also duplicated `computeTransitCoverage` into `catchments.ts`.
  - Round 2 (typed cache records, cached reaches read in place): exact; services pass 0.837Ã— / 0.841Ã— (both orders);
    whole day 0.983 [0.967, 0.988] / 0.967 [0.964, 0.972]. It also broke `tests/wasm/servicesTierEngine.test.ts`,
    because the parked port reads the private cache structures.
  - The plan's 1.07â€“1.14Ã— was measured on 24f8609's services.
- **J6 (population def index).** Exact. Population daily step 0.977Ã— / 0.936Ã— (both orders; combined 0.956Ã—, lower
  bound 0.929); whole day 0.99â€“1.00. The live `rt.defOf` already caches the def per building id (added after 24f8609,
  where B0 was measured), so a second index only adds work.
- **J11 (utilities).**
  - Exact, including J10's own test once its comparison skips per-pass scratch fields.
  - Utilities pass 0.973Ã— [0.945, 0.993] / 0.926Ã— [0.911, 0.950] against J10; whole day 0.996 [0.978, 1.000] /
    1.004 [0.992, 1.008].
  - Only the provably exact part (typed geometry records reused by the results loops) was possible. The single
    merged pass is not, because the results depend on whole-pass totals.

## Findings along the way
- **NaN payload bits are not stable across V8 tiers.**
  - J8's byte-exact blur test failed under load on a different case each run. An A/A (the unmodified original against
    its own frozen copy) failed the same way.
  - The exact tests now compare any two NaNs as equal and keep everything else bit-exact. The sim produces no NaN
    fields, so the city digests are unaffected.
- **Arm-position bias.** About 1.5 % against the second worker in kernel A/As, hence the both-order design. Future
  A/Bs on this machine should keep it.
- **Load sensitivity.** J7's first long run overlapped the start of eight Codex lanes and read 0.994 / 1.000 (lower
  bounds 0.981 / 0.989). The idle redo read 1.013 / 1.000. Timing runs here need the lanes idle, as NOTE-002 says.

## Codex
- Codex wrote all code and tests (codex-cli 0.163.0, max reasoning effort, workspace-write sandbox per worktree), about
  10â€“15 minutes and 85kâ€“210k tokens per fix.
- Its sandbox could not start vitest (`spawn EPERM`), so I ran every test.
- J3 got a second round, briefed with the measured round-1 result. Round 2 was exact but slower.
