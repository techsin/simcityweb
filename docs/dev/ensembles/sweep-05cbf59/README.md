# Fixed-tax sweep, 9 members per rate, 128x15 s7, dev 05cbf59 (B2 + T041 + T062 tooling)

Run on the cloud, Nov 10, for REVIEW-T041 finding 2 and NOTE-097. Each rate is one NOTE-062 9-member ensemble: the
control plus ±§100 and ±§200 funds nudges at day 1 and at the later timing.

- **Runner:** tools/simEnsemble.mts, as merged in 05cbf59, byte-identical to 78bf434.
- **Command:** `node --experimental-strip-types tools/simEnsemble.mts --tree <dev 05cbf59> --size 128 --years 15 --seed 7
  --runs 9 --jobs 2 --out-dir <dir> --quiet-gate <nice-15 gate> -- --tax=N`.
- **Files:** the summary .json and the .md of each rate are here. The raw members (and their action logs) stay in the
  cloud's scratch and are available on request.
- **Check member** on the same tree: control residents [ 61580, 93090, 37566 ] = 192,236, cache key 2454b65a….

| Tax | Members | Population 2015, median [min, max] | Step | Approval 2015 | Funds 2015 (median) | Lowest year-end funds |
|---:|---:|---|---:|---:|---:|---:|
| 9% | 9 | 197,042 [193,666, 198,749] |  | 81.4 | 170,094 | 7,856 |
| 10% | 9 | 193,926 [190,453, 194,598] | -1.58% | 78.3 | 301,037 | 4,832 |
| 11% | 9 | 184,679 [177,364, 185,682] | -4.77% | 75.0 | 689,318 | 6,874 |
| 12% | 9 | 172,187 [170,955, 178,353] | -6.76% | 71.6 | 1,031,681 | 7,412 |
| 13% | 9 | 161,256 [158,484, 165,591] | -6.35% | 68.7 | 1,131,188 | 8,540 |
| 14% | 9 | 166,645 [161,052, 168,105] | +3.34% | 61.4 | 1,943,939 | 10,279 |
| 15% | 9 | 162,824 [156,426, 164,913] | -2.29% | 57.9 | 2,766,980 | 7,952 |
| 16% | 9 | 154,564 [141,056, 157,811] | -5.07% | 54.6 | 2,998,784 | 8,576 |
| 17% | 9 | 119,505 [101,187, 130,418] | -22.68% | 48.5 | 2,810,719 | 13,572 |
| 20% | 9 | 83,295 [83,295, 94,465] | -30.30% | 36.1 | 2,589,611 | 13,007 |

The funds columns come from the raw members: the median of each member's 2015 year-end funds, and the lowest year-end
balance of any member.

## Reading

- **Above 10%, each point costs 5-7% of the median population**, up to 13%.
- **13-16% is a real plateau, not noise:** 14% beats 13%'s best member. The bot reinvests its growing surplus there.
- **16→17% loses 22.7%**, the first one-point step above 10%. That is NEW-05's own rule, so
  `TAX_GROWTH_WARNING_RATE` = 17 (it was 14, from the pre-B2 base).
- **Year-end funds peak at 16%** (median §3.0M) and fall after it, so from 17% a higher rate loses both residents and
  money. Maxing out taxes does not pay.
- **Approval falls steadily**, from 81 at 9% to 36 at 20%.
