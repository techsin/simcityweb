# local-J2-traffic: exact traffic fixes (WASM_PLAN §6 J2, T007)

Branch `local/J2-traffic`, base `614609f` (the commit T005 measured). Files: `src/sim/infra/traffic.ts`,
`tests/sim/exact/traffic*.ts`, and the gate tools `tools/bench/exact/{abDay,cityDigest}.ts`. `search.ts` is not
changed.

## What changed (`traffic.ts`)
- **Radix sort of the match keys** (`sortCandidates`, used by `roundMatch`).
  - An 11-bit LSD radix sort of the packed `(cost, origin)` keys replaces `Float64Array.prototype.sort`. It skips passes
    whose digit is constant, and its scratch and histogram are reused.
  - Below 64 keys, and for any key that is not a safe non-negative integer (NaN, −0, negative, ≥ 2⁵³), it keeps the
    native sort.
  - Exact: for those keys, ascending numeric order is a total order, and equal keys are identical numbers, so both sorts
    produce the same sequence. I checked every pass's digit extraction (low and high 32-bit words, divisor
    2^(11p) then `>>> 0`) against the histogram digits.
- **Precomputed stop x / z.**
  - `stX` / `stZ` are filled where the stop bins are built and used in `nearStops` and the transfer pass, instead of
    `cell % N` and `(cell − x) / N` on every visit. They hold the same integers.
- **Reused scratch.** These used to allocate fresh arrays on every call:
  - the stop-bin fill counters;
  - `routeCand`, `routeW` and `routeCum`;
  - `poolU`, `poolO`, `poolTk` and `poolCarTk`;
  - the inbound pass's `desire`, `bestNode`, `connSum`, `scale` and `connIn`.

  Each is zero-filled (or −1-filled) exactly as a fresh array would be. `poolTk` / `poolCarTk` keep exactly length
  `nc`, and every reader goes through `this.poolTk`. `routeCand` / `routeW` are handed to the overflow records
  (`ovRouteCand`), so a guard gives the round new arrays whenever the record still holds the current ones. The records
  get fresh arrays after they are consumed.
- **Not done:** the optional fairx road-search tweaks (`search.ts`). Codex did not find them clearly exact.

## Gates

| Gate | Result |
|---|---|
| Differential test `tests/sim/exact/traffic.test.ts` against the frozen `trafficOriginal.ts` (614609f) | 7/7 pass: 13,500 randomized and adversarial cases (sort keys with collisions, equal keys, extremes) and 30 traffic cycles on generated cities, compared bit for bit |
| City level, 120 days at design cadence (`cityDigest.ts`, zlib + `decodeBundle`) | sha256 of `serializeCity({copy:true})` **identical** to base on dense1m (`b26404cad936a56f…`), bot256 y60 snap (`77548607dfdf7e1d…`) and bot256 y60 live, 1.37M (`4f7375ac88a0282c…`); all per-key digests equal |
| Bot 128×15 seed 7 | yearly table identical to base; 2015: 194,432 residents |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 1,096 passed, 6 skipped. 1 failed: `tests/wasm/binary.test.ts` (Rust-source hash; CRLF on this Windows checkout), which fails the same way on the base tree |

**Speed.** Method:
- `tools/bench/exact/abDay.ts`, which is T005's `pi1Day.ts`;
- two isolates, one per code version, protector intact in both, fixtures loaded with zlib + `decodeBundle`;
- every round rebuilds the city and times the same window;
- process CPU time; 32 interleaved rounds per arm order, and both orders, because this session's A/A runs show a
  1.3–1.8 % arm-position bias;
- Node 22.12, Windows 10, Ryzen 7 9800X3D, idle machine.

| What | Fix as arm B | Fix as arm A | Combined (both orders) |
|---|---|---|---|
| Traffic cycle (`invalidate` + `runCycleSync`, dense1m 1.12M, 60 cycles per sample) | 1.164× [1.155, 1.175] (17.6 → 15.1 ms) | 1.172× [1.156, 1.189] | **1.168×** |
| Whole day, design cadence, dense1m (60 days per sample) | 1.081× | 1.058× [1.040, 1.072] | **1.071× [1.056, 1.096]** (64 pairs pooled) |
| Whole day, design cadence, bot256 live 1.37M (90 days) | 1.030× | 1.024× [1.012, 1.049] | **1.026× [1.012, 1.049]** |
| A/A traffic cycle (base vs base) | 0.986 [0.985, 0.993] | | |

**Gate passed:** not slower, with every CI lower bound ≥ 0.99. It beats the plan's measured effect (cycle
1.065× in node), because this tree also removes the per-call allocations. Every arm ended bit-identical to the other
(D1) with the protector intact.

## Who wrote what
- **Codex** (codex-cli 0.163.0, max reasoning effort, about 11 minutes, 07:08–07:19 UTC): the `traffic.ts` changes, the
  frozen copy and the differential test. Codex could not run vitest in its sandbox (`spawn EPERM`).
- **Me (Claude):**
  - the brief and the review: sort order and digit extraction, aliasing of reused scratch, overflow-record ownership;
  - running every gate: the unit test, city digests, bot, tsc, full vitest, and the speed A/Bs with the harness and
    the arm-order design.
