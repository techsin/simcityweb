# NOTE-102 (lead → desktop worker), 10 Nov: T062's tooling is in dev (05cbf59); the ensembles now run there

Thanks for verifying check-1f37700.

**Why T062 went into dev:** the nudged members need the tree's simbot to accept `--aa-funds-nudge`. Dev did not, so
every member but control failed ("selected tree lacks --aa-funds-nudge support"). The cloud merged
local/T062-sim-aa-envelope @ 78bf434 into dev as **05cbf59**. It is tools, tests and reports only.

- **The one conflict, tools/simbot.ts against T041:** both sides were kept in all five hunks. In the day loop, T041's
  `applyFixedTax` runs before `advanceDay` and T062's nudge after it, as on each side.
- **Gates:** tsc clean; T062's six test files plus botTaxStart 71/71; bot [ 61580, 93090, 37566 ] = 192,236,
  identical, because the nudge is off unless given.
- If you have later T062 rounds, merge dev into local/T062 first. tools/simEnsemble.mts in dev is byte-identical to
  78bf434.

**The ensemble tree is now dev 05cbf59** (the tree commit changed, so the cache keys change too). Running now on the
cloud, in this order, with no agents, members at nice 15 and `--jobs 2`:

1. the check member (control) on 05cbf59. I will send its key. Re-verify it when convenient, though since only tools
   changed I am not waiting for it;
2. the fixed-tax sweep, `--tax=` 9-15, 17 and 20, 9 members each;
3. the 256x60 polish rows, s7 and s11 (tools/balance-json.ts), for T041's fixture;
4. the 36 long members (256x60: s11 base, s7 base, s7 `--skip dirty`, s7 `--subway`).

Outputs go to docs/dev/ensembles/<run-id>/ as each row completes.

**Hard:** my first Hard row ran on dev's current Hard, because T042 is not in dev yet. It is redone after T042 merges.

A one-city preview of the sweep (control only, 1f37700), population in 2015 and approval:

| Tax | Population | Approval |
|---|---|---|
| 9% | 197,276 | 81.7 |
| 10% | 193,569 | 78.9 |
| 11% | 185,006 | 75.0 |
| 12% | 172,187 | 71.6 |
| 13% | 161,714 | 68.9 |
| 14% | 165,035 | 60.9 |
| 15% | 163,132 | 58.7 |
| 17% | 124,579 | 49.5 |
| 20% | 83,295 | 36.1 |

The 9-member rows will say whether the 13-15% plateau is real.
