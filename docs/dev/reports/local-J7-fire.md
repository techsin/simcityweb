# local-J7-fire: allocation-free building list and fire loops (WASM_PLAN §6 J7, partial; T007)

Branch `local/J7-fire`, base `614609f`. Files: `src/sim/infra/common.ts`, `src/sim/infra/fire.ts`,
`tests/sim/exact/fireList*.ts`, and the gate tools `tools/bench/exact/*` (method as in `local-J2-traffic.md`).

## Partial: why the maintained list is not in it
J7 asks to maintain the 17k-building list on add and remove instead of rebuilding it daily. Buildings are added,
removed and re-inserted in files J7 may not touch (CityState, actions, growth, load and replaceState). From inside
`common.ts`, size + `nextBuildingId` cannot prove that the Map's content and order are unchanged: a delete followed by a
re-insert of the same id, a replaced state, or a re-inserted building can leave both equal. So the daily refresh stays.
A maintained list needs hooks at the mutation sites; it could be a follow-up with a wider file scope.

## What changed
- **`buildingList` (common.ts).** The refresh overwrites the cached array by index and shortens it only when it
  shrinks, instead of `arr.length = 0` + `push`, which reallocated the backing store every day. Same contents, same
  order, for every caller.
- **Fire loops (fire.ts).**
  - `for (const [id, f] of this.fires)` becomes `for (const id of this.fires.keys()) { const f = this.fires.get(id)!; … }`
    in the daily step, the incident sync and `persist`. That drops the per-entry `[id, f]` tuple.
  - Same iteration order, including deletions during iteration. The values are the same objects, mutated in place.

## Gates

| Gate | Result |
|---|---|
| Differential test against the frozen originals | 7/7 pass: 10,000 list-mutation cases and 1,172 fire days compared |
| City level, 120 days at design cadence | sha256 identical to base on all three fixtures |
| Bot 128×15 seed 7 | identical; 194,432 in 2015 |
| `tsc` / full vitest | clean / passes except the Windows-CRLF `binary.test` (also on base) |

Speed. CPU time, both arm orders, protector intact, every arm deterministic:

| What | Combined | 95 % CI |
|---|---|---|
| Fire system's daily step in place, day advanced (4,000 per sample) | **1.41×** (0.21 ms base) | fwd [1.39, 1.44], rev [1.362, 1.433] |
| Whole day, design cadence, dense1m (180 days, 80 pairs) | 1.013 | [1.006, 1.018] |
| Whole day, design cadence, bot256 live 1.37M (270 days, 80 pairs) | 1.000 | [0.996, 1.008] |

A first long run gave 0.994 / 1.000 (lower bounds 0.981 / 0.989). It overlapped the start of eight Codex lanes, the
heaviest load of any timing run. Under NOTE-002 I redid it on the idle machine; the numbers above are the redo. The plan
measured 0.40 ms/day and 0.58 MB/day for the full J7. This partial version gets most of the fire-step gain.

**Who wrote what.**
- **Codex** (max effort): the code and the tests. It declined the maintained list for the reason above.
- **Me (Claude):** the brief, the review and all gates.
