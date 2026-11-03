# local-J4-nimby: exact NIMBY rebuild fixes (WASM_PLAN §6 J4, T007)

Branch `local/J4-nimby`, base `614609f`. Files: `src/sim/infra/nimby.ts`, `tests/sim/exact/nimby*.ts`, and the gate
tools `tools/bench/exact/{abDay,cityDigest}.ts` (method as in `local-J2-traffic.md`).

## What changed (`rebuildNimby`)
- **Landfill pass.**
  - `Uint8Array.indexOf(Zone.Landfill)` jumps over 2×2 row pairs that contain no landfill cell.
  - Row pairs that do contain one run the original per-block loop unchanged.
  - Blocks with no landfill never splat, so the splats, their order and `touches` are identical.
- **Corridor pass.**
  - Network cells are read 4 at a time through a `Uint32Array` view (when the view is 4-aligned).
  - A word is skipped only when none of its bytes is `Highway` or `Rail`. The test is the exact zero-byte test
    `(v − 0x01010101) & ~v & 0x80808080` on `word ^ (value × 0x01010101)`; it is byte-order independent, and JS's
    int32 wrap keeps the subtraction right.
  - Matching words, the tail and unaligned views use the original loop, in index order.

## Gates

| Gate | Result |
|---|---|
| Differential test against the frozen `nimbyOriginal.ts` | 5/5 pass, 14,178 cases. Rasters are compared byte for byte, `nimbyCost` exactly. Covers unaligned views at offsets 0–8, byte values 128–255 and NaN / ±∞ / −0 landfill fills |
| City level, 120 days at design cadence | sha256 identical to base on dense1m, bot256 y60 snap and bot256 y60 live (1.37M) |
| Bot 128×15 seed 7 | identical table; 194,432 in 2015 |
| `tsc` / full vitest | clean / 1,094 passed, 6 skipped; only the Windows-CRLF `binary.test` fails, also on base |

Speed. CPU time, both arm orders, protector intact, every arm deterministic:

| What | Combined | 95 % CI |
|---|---|---|
| `rebuildNimby` in place, dense1m (1,000 calls per sample) | **1.129×** (0.83 → 0.73 ms) | fwd [1.116, 1.129], rev [1.106, 1.131] |
| Whole day, design cadence, dense1m (180 days per sample, 80 pairs) | 1.002 | [1.000, 1.008] |
| Whole day, design cadence, bot256 live (270 days per sample, 80 pairs) | 1.004 | [0.994, 1.014] |
| A/A noise floor of these long runs | 0.998 / 1.000 | [0.991, 1.004] / [0.996, 1.006] |

Gate: not slower; every CI lower bound is ≥ 0.99. The plan measured the kernel at 1.25–1.28×. Here the whole
`rebuildNimby` gains 1.13×, because the building splats, which this fix leaves alone, are part of what is timed.

**Who wrote what.**
- **Codex** (max effort, about 10 minutes): the code and the tests. Its sandbox could not run vitest.
- **Me (Claude):** the brief, the review (the zero-byte test, order and `touches` invariance, the frozen copy compared
  verbatim against 614609f) and all gates.
