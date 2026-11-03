# local-J8-blur: exact restructured blur loops (WASM_PLAN §6 J8, T007)

Branch `local/J8-blur`, base `614609f`. Files: `src/sim/infra/blur.ts`, `tests/sim/exact/blur*.ts`, and the gate tools
`tools/bench/exact/{abDay,cityDigest}.ts` (method as in `local-J2-traffic.md`).

## What changed (`blur.ts`)
- **`boxH`.** The running sum now runs over four rows at a time, each with its own accumulator, in the original
  per-row order. The `if (x + r < N)` / `if (x − r >= 0)` tests are split into fixed loop ranges, for both 2r ≤ N and
  r > N − r, including r ≥ N. I traced each range against the original's adds and subtracts.
- **`boxV`.** The three sweeps per row (add the incoming row, write, subtract the outgoing row) are fused into one. The
  column sums are a `Float64Array`, so there is no extra rounding.
- **Fallback.** Both use the original loops when `src` / `dst` share a buffer or the inputs are unusual (non-integer N
  or r, short arrays).

## Gates

| Gate | Result |
|---|---|
| Differential test against the frozen `blurOriginal.ts` | 10/10 pass, 12,801 scenarios, byte for byte |
| City level, 120 days at design cadence | sha256 identical to base on all three fixtures |
| Bot 128×15 seed 7 | identical; 194,432 in 2015 |
| `tsc` / full vitest | clean / passes except the Windows-CRLF `binary.test` (also on base) |

**Test fix (mine).** The original test compared NaN payload bits and failed under load on a different case each run.
An A/A (the unmodified original against its own frozen copy) failed the same way: V8 does not keep NaN payload bits
stable across its tiers. `sameBytes` now treats any two NaNs as equal; every other value, −0 and the infinities stay
bit-exact. After the fix: 3/3 passes under full-suite load. The sim never produces NaN fields, and the city digests are
identical regardless.

Speed. CPU time, both arm orders, protector intact, every arm deterministic:

| What | Combined | 95 % CI |
|---|---|---|
| `blur3` in place (256² field, r = 2 and r = 1, 1,200 calls per sample) | **1.567×** (1.00 → 0.64 ms) | fwd 1.572, rev [1.540, 1.574] |
| Whole day, design cadence, dense1m (180 days, 80 pairs) | 1.014 | [0.998, 1.016] |
| Whole day, design cadence, bot256 live (270 days, 80 pairs) | 1.004 | [1.002, 1.012] |

The plan measured `blur3` at 1.81× [1.78, 1.86]. The gain here is smaller because `blurDown` / `upsampleAdd`, which
are unchanged, are part of the timed call. The whole-day gate passes.

**Who wrote what.**
- **Codex** (max effort): the port from `tools/bench/blurJsOpt.ts` and the tests.
- **Me (Claude):** the brief, the review of every branch of the split loops, the NaN test fix, and all gates.
