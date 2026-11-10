# NOTE-101 (lead → desktop worker), 10 Nov: the ensemble check member on dev with T041; please verify its cache key

Thanks for MERGED T041 (95705b5f, log 1f37700c). The dev bot reference is now 192,236.

## The check member (NOTE-089)

- **Run-id `check-1f37700`, committed on dev in a1e8103** at docs/dev/ensembles/check-1f37700/.
- **Tree:** a clean detached checkout of dev 1f37700c3de8ac5e632f31858a732b237b02a2c2 (parent 95705b5f), with
  node_modules from a checkout whose package.json and package-lock.json are identical to dev's.
- **Runner:** tools/simEnsemble.mts from local/T062-sim-aa-envelope @ 78bf434. The command:

  ```
  node --experimental-strip-types tools/simEnsemble.mts --tree <dev 1f37700> --size 128 --years 15 --seed 7 --runs 9 --jobs 2 --out-dir <dir> --quiet-gate <cloud gate> --members control
  ```

  The cloud's quiet gate runs each member under `nice -n 15`, with no other change.
- **Result:** control residents [ 61580, 93090, 37566 ] = **192,236**, equal to your gate. Cache key
  `3ee67f02fa1e021fb2ff1326dc4aa9252d5f47ab8facd670dfb941b38f6297d1`.
- **Files:** the member's .json, .ndjson (annual rows), .spec.json, and the partial summary .json and .md. There are no
  action logs. The two .log files are ignored by the repo's `*.log` rule, so they are not in git; the annual rows are
  in the .ndjson.

**Please verify the cache key against your machine and reply "ENS OK check-1f37700"** (or the mismatch). On your OK the
cloud starts the 36 long members on the same tree: 256x60 s11 base, s7 base, s7 `--skip dirty` and s7 `--subway`, 9
each, `--jobs 2`.

## Running now on the cloud (REVIEW-T041 and NOTE-097; no agents)

- The fixed-tax sweep at 128x15 s7, `--tax=` 9, 10, 11, 12, 13, 14, 15, 17 and 20, 9 members each.
- Hard at 128x15 s7, 9 members. It reports how many members go below §0 at any point.

A member takes about a minute here, so the results come in about 45-60 minutes. Then `TAX_GROWTH_WARNING_RATE` and its
comment are set from the medians, and Hard gets a verdict.

## Also

- The cloud's T041 advisor-copy fix (advisors.ts:1899 and its test) lands on dev shortly.
- T070: noted the continuity fix in rewards.init (b30f1ec9, also T093's finding). Re-gate T070 against the new
  reference (192,236 plus honours) and give the numbers in the DONE.
