# local-W0.3-5-integration: W0.3, W0.4 and W0.5 as one branch (T020, NOTE-029)

Branch `local/W0.3-5-integration`, from the dev head **`4c90468`**. It has three merge commits, in order:

| Merge | Lane head | Conflicts |
|---|---|---|
| `a4040fc` Merge local/W0.3-queries | `eb88d1b` | none |
| `3962193` Merge local/W0.4-livepolicy | `f9e57a8` | `src/worker/SimCore.ts` (1 hunk), `src/worker/SimHost.ts` (1 hunk) |
| `8db31cf` Merge local/W0.5-views | `6a0b186` | `src/worker/SimHost.ts` (5 hunks); one follow-on edit in W0.3's test helper |

Each lane's own report is on its branch and in this tree:
- `docs/dev/reports/local-W0.3-queries.md`;
- `docs/dev/reports/local-W0.4-livepolicy.md`;
- `docs/dev/reports/local-W0.5-views.md`.

## Every conflict hunk and its resolution

Every hunk is a union. Each lane adds its own members to the same host classes: W0.3 its watches and queries, W0.4
its policy and settings, W0.5 its views. One member existed in two forms (hunk 5.3).

**The W0.4 merge**
1. **`SimCore.ts`, the imports.** W0.3's `./queries` import and W0.4's policy imports (`Emitter`, the
   `emergencyPolicy` functions, the policy types). Kept both.
2. **`SimHost.ts`, after W0.3's `LocalWatch` class.** W0.3's query/watch block against W0.4's `PolicySnapshot` /
   `PolicyView` types.
   - Git matched the shared closing `}`, so each side ended inside its own block.
   - Kept both, and restored `LocalWatch`'s closing brace between them.
   - Moved W0.4's `import type … from './protocol'` up into the import block.

**The W0.5 merge (`SimHost.ts`)**
1. **The import block and the W0.3/W0.4 type blocks**, against W0.5's imports. Kept the W0.3 and W0.4 blocks.
   - W0.5's three new imports (`SampleRoute` / `TrafficSystem`, `UtilitiesSystem`, `ViewState`) joined the import
     block; `ViewState` joined the existing `./protocol` line.
   - Its three duplicates of existing imports were dropped.
2. **`LocalSimHostOptions`:** W0.3's `now?` (the watch clock) and W0.5's `signal?`. Kept both.
3. **The host's fields.**
   - Kept W0.3's `watches`, `queries` and `queryClock`, and W0.5's `views` and `news`.
   - Dropped W0.3's stand-in `readonly emergency: DispatchView = { … }` and its interface member. Its own report
     marks it as "a minimal dispatch view block for the W0.5 merge".
   - W0.5's `get emergency(): EmergencyView` replaces it. `EmergencyView` is a strict superset of `DispatchView`, which
     stays exported because `DispatchTool` types its helpers with it.
4. **The constructor:** W0.3's `queryClock` setup and W0.5's `views` / `news` setup. Kept both.
5. **`dispose()`:** W0.3's watch disposal and W0.5's news disposal. Kept both.
6. **Follow-on, `tests/game/queryHost.ts`** (W0.3's fake host): its `emergency` now has `EmergencyView`'s three extra
   members (`active`, `layersReady`, `stationList`), so it type-checks against the merged host.

## Gates on the integration

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` (full, 2 workers, below-normal) | 157 files and 1,568 tests passed, 10 skipped. In each of the two runs one case of `tests/save/recovery.test.ts` failed, and a different case each time (also once on W0.3's own run); see the note below |
| `tests/save/recovery.test.ts` alone | 13/13 three times on the integration and three times on the base `4c90468` |
| S1 rules | W0.4's liveSlowdown rule on and passing; W0.5's CityScene check passing; the W0.3 rule skipped as "W0.3b" (NOTE-028) |
| 128 × 15 seed-7 bot | **196,101** in 2015 |
| Old saves load and continue | 6 of 6, every number identical to `2ba03fa` (the sim is the same at `4c90468`): load, 45 days, reload and round trip |

**One test fix on the integration (`d4534e3`).** W0.5's view-purity test compared two `serializeCity` copies, and each
stamps `savedAt` with `Date.now()`. On the integration the two calls fell a millisecond apart, and the test failed on
`savedAt` alone. It now pins `Date.now`, and passes 3 of 3.

**`recovery.test.ts` is load-sensitive, and it predates this branch.** Under the full suite with other work on the
machine, one of its cases fails now and then, a different one each time. Alone it passes every time, on the
integration and on the base. None of W0.3-W0.5 touches `src/save`.

## Browser gates

**Pending.** T014's speed reviewer has the machine. Then three fresh QA testers run on this tree, with `4c90468` as the base:
- W0.3: the Appendix A checklist and the inspector screenshot diff;
- W0.4: the uncovered fire at ultra, dismissals and settings, and the pill at 1024x600 and 1280x720;
- W0.5: every data view and variant by screenshot diff, the ticker past 200 news items on bot256_y60, and the three views.
Each also runs the leak probe, fresh and hostile.
