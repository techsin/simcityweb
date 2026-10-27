# T035 — polish round 1's interfaces: NewsItem.ref and the art-pipeline stubs

## Review and gates (the local worker)

Branch `local/R1-interfaces` on `local/W0.3-5-integration` (`93069fa`). It holds two Codex lanes, one commit each:
the SIM part (`NewsItem.ref`) and the CONTENT part (the placeholder models). I reviewed both against
docs/POLISH_PLAN.md §7.4 and §7.6.

**`NewsItem.ref`** (`src/sim/CityState.ts`, `src/sim/Simulation.ts`):
- `NewsItem.ref?: { advice?: string; reward?: string }`, set by a new optional sixth argument of
  `CityState.notify` and `Simulation.notify`. The ref is copied on write, so a caller that reuses its object cannot
  change a posted item.
- A call without a ref leaves the key absent (not `undefined`), so old news and old saves keep their exact shape. The
  generic save path already carries the field, and the format version is unchanged.
- Nothing in the sim reads it: the bot is identical.

**The worker's news stream must carry `ref` (a request for T032).** T032 owns protocol.ts and recorder.ts. The
recorder copies news items whole today, so `ref` should pass through as it is. T032's brief asks it to keep that
copy whole and to say so. An end-to-end test (advice, reward, and legacy news without a ref) belongs wherever the two
branches first meet.

**The placeholder models** (`src/assets/builders/polish_stubs.ts`, `src/assets/manifest.ts`,
`src/assets/builders/index.ts`):
- 18 new model ids with 22 variants, in a new `placeholder` asset group:
  - LG-03's projects;
  - LG-04's arcologies (two massing variants each);
  - LG-19's shared level badges and Small Park levels;
  - LG-20's honours;
  - LG-15's Emergency Operations Center;
  - FEEL-17's kerbside garbage (two variants) and FEEL-18's For Lease sign.
- Each is a neutral massing block labelled STUB. A content lane moves its entry to the final group and replaces the
  builder when the art lands.
- Only the gallery (`?group=placeholder`) lists the group. demo.ts filters by the R / C / I groups, and no sim
  catalog def names these ids, so nothing places them in a city.
- The 162 existing manifest entries are unchanged.

My one change, in review: the lane had also stubbed the seven LG-02 landmarks. Their real art is T010's
(`local/LG-02-art`), which the lead merges first. It registers `lm_central_library`, `lm_grand_central`,
`lm_stock_exchange`, `lm_botanical_dome`, `lm_world_trade_center`, `lm_millennium_tower` and `lm_metropolis_crown`,
so six of the stubs would have collided with it, and a seventh (`lm_grand_central_station`) would have duplicated
`lm_grand_central` under another name. The lane removed all seven. No other pushed branch registers any of the 18
remaining ids (I checked every `origin/local/*` and `origin/claude/*` branch).

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` (full, with the fixtures; both parts) | **161 files passed, 1 skipped; 1,599 tests passed, 10 skipped** |
| The manifest test (`tests/assets/manifest.test.ts`) | passes (in the full suite) |
| The 128 × 15 seed-7 bot, with the action log | identical to `93069fa`, line for line (**196,101** in 2015) |
| Old saves (two 10-year cities, a 21- and a 43-year veteran, the old-format region and city) | identical to `93069fa`: every file loads, continues 45 days and reloads identically (6 of 6) |
| The gallery render of each placeholder | pending: my browser slot, after the T014 timing runs |

## The lanes' summaries (Codex)

SIM part:
- `src/sim/CityState.ts`: adds `NewsItem.ref` and the optional sixth `notify` argument. It copies supplied refs;
  legacy calls keep `ref` absent.
- `src/sim/Simulation.ts`: forwards `ref` to storage and to the news event.
- `tests/sim/newsRef.test.ts`: emits the stored advice and reward refs independently of the headline; keeps legacy
  calls unchanged, including absent ref keys and the RNG state; keeps posted refs stable when the caller reuses its
  metadata.
- `tests/save/newsRef.test.ts` ("saved news refs"): round-trips; snapshots nested refs independently of later live
  changes; loads and re-saves old news without adding refs or changing the format version.

CONTENT part:
- `polish_stubs.ts`: neutral blocks with geometric "STUB" labels, including the expansion badges.
- `manifest.ts`: the ids, footprints, variants and budgets, under the `placeholder` group.
- `index.ts`: registers the new builders.
- `tests/assets/manifest.test.ts`: reserves the round 2-3 stub ids without adding unfinished models to catalog groups;
  keeps the specified lots and the Small Park footprint through both expansion levels; provides two variants for the
  arcologies and the garbage props; checks registration, bounds, budgets and labels.

Plan-vs-code differences:
- §7.4 has no explicit model list; the ids come from the items' descriptions.
- The `placeholder` group keeps the catalog test's rule (every building-group model has a building def) without
  editing sim files.
- Sizes the plan does not give are provisional, marked in the manifest comment.
- The park levels keep the 1 × 1 lot, because the existing Plaza and Garden models are 2 × 2.
- NEW-01's existing-model variants are untouched.
