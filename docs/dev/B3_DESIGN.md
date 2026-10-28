# B3: spreading the month-boundary work (design, rev 2)

Design for docs/WASM_PLAN.md row B3 and docs/WORKER_DESIGN.md §6 row S4. Base: a59f08f, branch `b3-month-spread`.
It is built on the three B3 maps (tourism; population, EQ/HQ and advisors; the whole month day). The numbers below
come from their runs on this machine: wall clock, idle-gated, interleaved B/W, base code.

**Rev 2** folds in the two design reviews (determinism / save-load, and gameplay / latency). What changed against rev 1
(51b06ed), by review item:
- **A0 is new** (gameplay R1): the advisors' map scans in small top-level kernels, bit-identical; day 28 is gated.
- **A1 is the last step and conditional** (gameplay R2): it ships only if day 29 passes its own gate; the measured
  prototype numbers are in §3.2.
- **`TOURISM_DAY = 26`**, not 27 (gameplay O1): an even day, so P3's odd sample days never coincide with the pass.
- **The venue pass runs in ascending building id** (determinism R1): records, sums, splats and historic sites no longer
  depend on the order of `rt.plopped` / `rt.growables`, which a loaded game rebuilds in Map order.
- **The pass is fresh when `pass.m === ⌈day / 30⌉`** (determinism R2); `refresh` calls the attract step directly.
- **P3 also edits the frozen J10 reference** `tests/sim/exact/j10Original.ts` (determinism R3).
- **The continuity test bulldozes and plops** between the pass and the tick, and before the first save (determinism R4).
- **The culture detail of the Tourism tab stays with the tick's bar** (gameplay R5): `pass.tc`.
- **The outcome is stated plainly** (§1, §5, §8; gameplay R3) and **the gate statistic is per month** (gameplay R4).
- **Tourism jobs ±30 %** gets a probe (§8; gameplay R6). **STATUS.md is not edited** (gameplay R7).
- Optional items adopted: determinism O1–O13 (fresh arrays, the pass written last, the daily's structure, the stricter
  validator, clamps, `tc` / `dump` in the pass, edge cases, the A1 leftovers, corrections); gameplay O1, O3–O9. Not
  adopted: gameplay O2 (§3.1, "Rejected"), O10 is the gates agent's (§8).

## 1. The decision

Five commits, in this order. Each one can be reverted on its own; A1, the last, can be dropped without touching the
others.

| step | system | change | behaviour |
|---|---|---|---|
| **A0** | advisors | The month's map scans (`scanZones`, `scanOutages`, `scanRubble`) in small top-level kernels: the zone flood fill, the empty-lot classification and `lotFitAny`'s wide search each in their own function, without per-call closures | bit-identical |
| **T1** | tourism | The per-venue and per-cell loops of the monthly update out of the `update()` closure into small top-level functions (§9's patch) | bit-identical |
| **T2** | tourism | The **venue pass** on `TOURISM_DAY = 26`: venues (in ascending id), historic sites, hotel rooms, beaches, hotels, the totals, the venue records and the visitor raster. Saved as `systemData.tourismPass` v1, so a city loaded on any day continues exactly. The tick keeps only **attractiveness and migration** (≈ 0.1 ms), which need the month's resident survey | changes the bot (by design) |
| **P3** | population | The employment sample (every 4 days) and the demographics sample (every 32 days) on odd phases; ticks fall on multiples of 30, which are always even. The `'demographics'` layer event on dom 1 instead of the tick | changes the bot (by design) |
| **A1** | advisors | On day 29, after the month scans, predict the coming tick's announcements with the tick's own filter, look up their "Show me" places and save them in `AdvisorData.scan.places`; on the tick, an announced advice uses its saved place. **Adopted only if day 29 passes its gate (§8)** | deterministic; expected bit-identical on the bot |

**Not moved:**
- **The budget** stays on the boundary, and `budget.ts` is unchanged. It costs 0.7–1.0 ms when warm, and every input is tick-time state (§3.4).
- **EQ/HQ** is already off the tick (day 25, in daily slices).
- **Emergency** belongs to other branches.

**The outcome, plainly** (warm months, the design's model from the base runs, §5):
- **Warm months pass** in five of the six cells. The worst warm month after T2 is 8.5 ms (dense1m design unit), 10.0
  (dense1m frames unit), 10.9 (dense1m month frame), 7.4, 7.0 and 5.9 (bot256 design unit, frames unit, month frame).
  **A1 and P3 must carry the two dense1m frames cells**: their worst month (d11040) is a demographics-sample tick with a
  costly place lookup, exactly what P3 and A1 remove.
- **The ticks right after a load do not pass, in any cell.** The 1st tick after a load is +13 to +21 ms from a dom-16
  save and +34 to +53 ms from a dom-28 save (C_ runs, T2 alone). The 2nd and 3rd ticks (the m_ runs' months 1–2; the
  runs' 40 warm-up days contain the 1st tick) stay at a median of +10.2 to +14.3 ms after T2. The cause is cold JIT code,
  mostly the budget's per-cell loop in `budget.ts` (lead decision L1). **Every session starts with a load, so at 1M the
  target is missed for roughly the first 90 sim days of play.**
- **bot256 at design cadence, matched excess** (the literal unit minus the infra steps a normal day also runs) stays at
  +26.4 ms median (p90 60.5): its services access pass lands on the month day (L4, not month work).
- The new work lands on normal days: day 26 gains ≈ 1.5 ms (≤ 2.6), and with A1 day 29 gains 0.7–1.4 ms at the median
  (with tails, §3.2). **Day 28** (the zone scan) is a JIT problem today (warm p90 +14.0 ms at dense1m design); A0 is its fix.

**The reading the lead is asked to approve** (§8): per cell, the worst warm month's median-over-runs excess ≤ +10 ms,
over ≥ 12 warm months, at design cadence on the **no-steps** excess (with the literal and matched excess printed next to
it), in frames on the unit and the month frame; the same statistic for dom 26, 28 and 29. The first three ticks after a
load are reported, not gated (L1, L2).

## 2. Where the month tick stands today

The plan's figures predate part B's final fixes: tourism 18–28 ms, EQ/HQ 12–18, advisors 14, budget 7–10, a month
frame of 73–105 ms. They, and the lead's quick profile (tourism 12.6 / max 21.2, budget 7.1), come from the **first
ticks after loading an old save**:
- full-pass fallbacks: the resident survey 13–19 ms, the hotel-room and historic growables 1–2 ms;
- cold JIT code;
- all of it read in 4 ms thread-CPU quanta.

Ticks at 1M (month map, 6 runs per cell; warm = months 3–10 after the load, cold = months 1–2):

| hook on the month day (ms) | dense1m design: warm median / p90 / max, then cold median | bot256 design: warm median / p90 / max, then cold median |
|---|---|---|
| all monthly hooks | 4.9 / 11.6 / 17.1, cold 13.7 | 4.7 / 7.7 / 12.3, cold 11.3 |
| `economy.tourism.monthly` | 1.8 / 7.1 / 8.6, cold 6.0 (of which the raster 1.0 / 5.5 / 6.8) | 1.3 / 3.6 / 7.9, cold 3.0 |
| `economy.budget.monthly` | 0.9 / 1.7 / 2.8, cold 6.0 (cell loop: warm 0.3, cold 2.7–5.6) | 0.7 / 1.2 / 1.6, cold 4.2 |
| `economy.advisors.monthly` | 0.7 / 2.9 / 7.9, cold 1.7 (place lookups 0–5.75) | 1.1 / 3.4 / 5.0, cold 3.3 |
| `emergency.monthly` | 0.6 / 1.2 / 3.0 | 0.4 / 0.8 / 1.2 |
| daily-hook extras on dom 0 (demand's caps refresh 0.45, fire's slice aliasing, population's samples) | 0.7 / 4.3 / 6.0 | 0.2 / 2.0 / 3.2 |

What part B already moved off the tick:
- the resident survey (`systemData.survey`, 30 daily slices);
- tourism's hotel rooms and historic sites (`tourismAcc`, 30 slices);
- EQ/HQ (`eqHqDaily`: 30 slices, applied on `EQHQ_DAY = 25`; 0.08–0.21 ms a day, 0.01–0.19 ms for the step);
- the advisors' map scans (`MONTH_SCAN_DAYS = [28, 29]`).

Population has no monthly hook.

The month-day medians already pass the target. The tails fail, in order of size:
1. tourism's raster and venue pass, which spike in cold JIT code (3–12 ms);
2. the advisors' place lookups (up to 5.75 ms on 36–55 % of ticks);
3. cold budget code on the first two ticks after a load;
4. population's demographics sample on one tick in sixteen.

And one day before the tick fails too: **day 28**, the zone scan (gameplay review R1). In the month-map base runs
(no-steps unit excess over the median normal day), dense1m at design cadence has warm-month day 28 at median 2.9, p90
14.0, max 23.3 ms; `advisors.daily` exceeds 8 ms on 14 of 48 warm day-28s; the per-month median across runs at d11218
is +13.2. In cold months the day-28 median is +12.4 to +18.7 in all four cells. The cause is JIT, not data: the headless
runs end in identical states, yet the d11188 scan costs 16.0 ms in one run and 2.3 ms in two others, and
`map-pop-adv/runs/deopt_dense1m.txt` shows `scanZones` ("insufficient type feedback", "wrong call target": the per-call
`isZ` closure), `scanOutages` and `scanRubble` deoptimizing.

## 3. The design, system by system

### 3.1 Tourism

**T1, the kernels (bit-identical).** Apply `tourism-jit-hygiene.patch` (§9), with the venue loop named `venueLoop`. It
extracts four top-level functions:
- `venueLoop`, the venue loop;
- `splatVenues`;
- `visitorsLayer`, the 1 − e^(−Σ) loop over every cell;
- `coarseBlur3`.

The operations and their order are unchanged. Inside the big once-a-month closure, V8 ran these loops in baseline code
while it compiled the closure for OSR on a background thread (12–73 ms). At dense1m, from the 3rd tick after a load:
- tourism median 4.0 → 1.7 ms, p90 7.2 → 2.5, max 12.5 → 2.5;
- cold 1 − e^(−Σ) ticks: 18 of 33 → 1 of 33.

City digests after 120 days of bot256 at design cadence are identical to the base.

**T2, the schedule.** `update()` is split in two:

- **`venuePass(sim, acc)`** runs in `tourism.daily()` on `day % 30 === TOURISM_DAY`, after that day's slice. It runs
  after population and before demand, growth and the other dailies of the day; desirability reads the new raster from
  day 27.
  1. `A = data.attractiveness` from the last tick, then `aF`, `sizeF` and `drawMul`, as today. There is **no resident
     survey**: off the tick it would be a full pass of 2–19 ms.
  2. **Canonical order** (determinism R1). The plopped buildings the pass reads — the `ATTRACTIONS` venues and the
     colleges — are collected from `rt.plopped` into a scratch list and **sorted by ascending building id**. Everything
     the pass builds follows that list: the records Map, gross, culture, the college seats, the connection counts, and
     `ven` / `spl`. The historic ids (the window's `hist`, or the full pass's list) are sorted ascending too, before
     they are summed and splatted. Why: `EconRuntime.dropFromList` swap-removes, but a loaded game rebuilds
     `rt.plopped` and `rt.growables` in Map order, so after any removal the two games would sum and splat in different
     orders; the float sums and the Float32 splat accumulation are not order-free (the reviewer's E1: `st.visitors`
     differed in 10 of 12 removal patterns). Hotel rooms (integer jobs × 1.5) and `historicBase` (integer × 3) are exact
     in any order. Building ids grow with every new building and are never reused, so ascending id is also the Map order
     of `st.buildings`, in both games.
  3. `venueLoop` builds the records Map, gross, culture, the college seats, and the **counts** of operating large
     airports, small airports, train stations (after `stopAttached`) and seaports. Today these are 0/1 flags; the hotels'
     overnight share and the tick's connection score still use `count > 0`.
  4. Historic sites and rooms come from `tourismAcc` v2 when all 30 slices are in and the pass was called from the
     daily. Otherwise (init, the tick's fallback, `refresh`, or an incomplete window) one full growables pass runs
     (1–2 ms, once per load).
  5. Beaches, unchanged.
  6. Hotels: overnight, shortage, `kEff`, and `r.visits = r.gross × kEff`. The pass writes `econData` `touristsGross`,
     `tourists`, `overnight`, `hotelShortage` and `tourism`, plus `stats.tourists` and `stats.hotelRooms`. These writes
     are unchanged.
  7. The **splat list** `spl` holds one `[cx, cz, v]` per splat: venues in record order, then historic buildings in id
     order, then beach blocks in block order. Only entries with `v > 0` go in; `splat()` skips the others, and adding 0
     to a block sum changes nothing.
  8. `rasterize(st, rt, spl)` is one top-level function. It fills the scratch with 0, then runs
     `splat(acc, N, cx, cz, v)` and `raw[blockOf(cx, cz)] += v` per entry, then `visitorsLayer`, then `coarseBlur3`.
     `blockOf` uses `floor(cx)`, which equals `b.x + (b.w >> 1)`, and the block centre for beaches. So the block sums are
     the ones the present code makes.
  9. It updates the `TourismState` WeakMap, emits `layerUpdated` `'tourism'`, and **writes `systemData.tourismPass` as
     its last step** (determinism O2): a throw inside the guarded daily leaves the old pass, whose `m` is then stale, and
     the tick's fallback recomputes from scratch instead of reading a half-written pass. `ven` and `spl` are fresh
     arrays for every pass (O1): `serializeCity` without `copy` aliases `systemData`, so a reused buffer could rewrite a
     saved pass.
- **The attract step** runs in `tourism.monthly()`.
  1. If `tourismPass` is missing, invalid or **not fresh**, `venuePass(sim, null)` runs first. The pass is fresh when
     `pass.m === ⌈st.day / 30⌉`, which equals `st.monthIndex` on a tick day (determinism R2). The fallback is defensive:
     day 26 and `init` always leave a fresh pass, including for older saves.
  2. `sv = residentSurvey(st, rt, inf)`. Tourism stays the first monthly caller, so this completes approval's slices.
  3. `toxicDumpOperating`, then `attractScores(..., culture = pass.culture, conn = pass.conn[k] > 0 ? 1 : 0, ...)`.
  4. It writes `attractiveness`, `attractByWealth` and `attractTerms`, the stats, `migration`, and `migrants` (students =
     `STUDENTS_PER_SEAT × pass.seats`). Then it sets **`pass.tc = pass.culture` and `pass.dump`**: the culture visits
     and the toxic waste dump of this tick, which the attractiveness breakdown reads (gameplay R5: the Tourism tab's
     culture detail stays with the culture bar of the same tick, instead of showing day 26's visits next to the last
     tick's bar for four days a month). Saving them makes the breakdown right after a load bit-equal too (O6).
- The system object gains **`refresh(sim)`**: `venuePass(sim, null)`, then the attract step directly (no freshness
  test, so no second pass). It is today's whole update, "now". Tests, tools and init's fallback use it.

`TOURISM_DAY = 26` is exported from `tourism.ts` next to `TOURISM_SLICES`. It follows the `EQHQ_DAY` pattern: a module
constant, so `tuning.ts` stays untouched. Day 26 was chosen because:
- It is free. Day 15 has the facility scan and the freight refresh, 20 the commercial core, 25 the EQ/HQ step, and
  28–29 the advisor scans. Dom 26 is idle in every cell of the month map (median excess −0.6 to +0.1 ms).
- **It is even** (gameplay O1). P3 puts the employment sample on days ≡ 1 mod 4 and the demographics sample on days
  ≡ 17 mod 32, all odd; a day of the month has the parity of its day number (30 is even). Day 27 would carry the
  employment sample every other month and the demographics sample (0.5–2 ms, up to 6 in frames) one month in 16.
- It is 4 days before the tick it feeds (rev 1's 27: 3). Day 29 would be fresher, but it would stack the pass on the
  scans and on A1.

**State** (in `st.systemData`; plain data, with typed arrays for the bulk):

```ts
/** systemData.tourismAcc v2 (was v1): the hotel rooms / historic ids of the 30 days up to and with the next
 *  TOURISM_DAY; m = ceil((day − TOURISM_DAY) / 30), as eqHqMonth in demographics.ts */
interface TourismAcc { v: 2; m: number; done: number; rooms: number; hist: number[] }

/** systemData.tourismPass v1: the last venue pass (read by the month tick and by init()) and what the last tick scored */
interface TourismPass {
  v: 1;
  /** the tick it feeds: ceil(day / 30) at the pass. It stays that (never monthIndex): written on day 26 of a month it
   *  equals the coming tick's monthIndex; written on the tick it would equal monthIndex at once, and every tick would
   *  re-run the pass */
  m: number;
  culture: number;   // Σ gross visits of operating landmark / culture venues (onRemoved subtracts, ≥ 0)
  conn: number[];    // operating [large airports, small airports, train stations, seaports] (onRemoved decrements, ≥ 0)
  seats: number;     // Σ college seats × op
  kEff: number;      // effective / gross visits after the hotel limit
  beach: number; historic: number; beachCells: number;   // tourismSummary: beach and historic after kEff, as the base
  ven: Float64Array; // [id, gross, op] per venue record, in pass order (visits = gross × kEff); op-0 venues included
  spl: Float64Array; // [cx, cz, v] per visitor splat, in pass order
  tc: number;        // the culture visits the last tick scored (the breakdown's detail; onRemoved subtracts, ≥ 0)
  dump: boolean;     // a toxic waste dump operated at the last tick (the breakdown's clean-air detail)
}
```

**The daily** (determinism O3: `eqHqDaily`'s structure):
1. A missing record, or a `v !== 2` one, becomes `{ v: 2, m: -1, done: 0, rooms: 0, hist: [] }`.
2. When `m` differs, the sums start over.
3. If slice `day % 30` is not done, it is added. (No early return: the pass below must run on a done slice too.)
4. On `TOURISM_DAY` it runs `venuePass(sim, window complete ? acc : null)`, then `a.m = m + 1` with the sums cleared.

**`init()`:**
- **A loaded city with a valid `tourismPass`** takes the **restore path**. Valid (determinism O4): `v === 1`; `ven`
  and `spl` are `Float64Array`s (a Float32Array would corrupt ids above 2^24) of length ≡ 0 mod 3; `m`, `culture`,
  `seats`, `kEff`, `beach`, `historic`, `beachCells` and `tc` finite; `conn` an array of 4 finite numbers; `dump` a
  boolean. `m` is not compared with the day: a pass written by init on dom 1–25 legitimately carries `monthIndex + 1`.
  The restore runs no venue loop and no survey:
  - records from `ven`, for buildings that still stand and whose def is still in `ATTRACTIONS`, with `def`, `kind`,
    `capacity` and `draw` from `ATTRACTIONS`;
  - st.visitors and rt.coarseVisitors via `rasterize(spl)`;
  - `TourismState` from the pass;
  - then `layerUpdated` `'tourism'`.

  This rebuilds exactly the records and the raster of the uninterrupted game, at the cost of one raster build (≈ 0.5–1
  ms at 1M). The survey at load is unaffected: approval's `init` still takes it.
- **Otherwise** (a new city, or a save from before B3), today's path runs: `savedOutputs` → `refresh` →
  `restoreOutputs`. The `tourismPass` this writes stands until the next pass. On dom 26–29 it also feeds the coming
  tick, so there (gameplay O6) only the attract outputs are put back (attractiveness, its terms, migration, migrants):
  the totals stay those of init's pass, next to its records, as in a B3 game on those days.

**`onRemoved`** keeps today's behaviour: the record is deleted, and its visits leave `tourists`, `touristsGross`,
`tourism` and `stats.tourists` at once. It also updates the pass (determinism O5: clamped at 0):
- a landmark or culture venue: `pass.culture = max(0, pass.culture − r.gross)`, and `pass.tc` likewise (the base's
  `ts.culture`);
- an operating airport, train station or seaport: `pass.conn[k] = max(0, pass.conn[k] − 1)`.

So the coming tick's culture and connection scores no longer count a venue bulldozed after day 26. `ven` and `spl` stay
as they are: the raster keeps a removed venue's splat until the next pass, as it does today, and a restore skips ids that
no longer stand.

**Small cleanups:**
- `VenueRecord.access` and `TourismState.scores` have no reader. They are dropped, not saved.
- `TourismState` holds the records and the pass they came from; `tourismSummary` and `attractivenessBreakdown` read the
  pass (`beach`, `historic`, `beachCells`, `tc`, `dump`).
- `rt.timing` keys stay readable by the profilers:
  - on the tick: `tourism` (the tick total), `tourism.survey`, `tourism.attract`;
  - on day 26: `tourism.pass` (the total), `tourism.venues`, `tourism.beach`, `tourism.hotels`, `tourism.splat`.

Rejected alternatives (from the tourism map, and the reviews):
- *Raster later from a snapshot* (proposal 2). After T1 it saves only ≈ 1 ms on the tick. The records and the raster
  come from different days, so exact loads need two snapshots.
- *Daily venue slices* (proposal 3). It needs the most new state and changes the most behaviour, for about the same tick.
- *T1 alone*. Take T2's numbers in §5 and add the 1.7–2.5 ms that T1 leaves on the tick: the dense1m p90 would be ≈ 11–13 ms.
- *Re-evaluating the connection venues and colleges on the tick* (gameplay O2: drop `conn`, `seats` and `culture` from
  the pass). It would restore tick-time semantics for an airport that loses power on dom 27–29, but the college seats
  are a float sum of `capacity × venueOp`, which needs the sorted list again on the tick, and the reviewed restore and
  continuity cases (determinism R4) are built on the pass's fields. The edge cases it fixes are listed in §6.

### 3.2 Advisors (A0, A1)

**A0, the scan kernels (bit-identical; gameplay R1).** The day-28 zone scan is split the way T1 split tourism:
- `scanZones` keeps the result object and calls two kernels: `fillZoneBlocks` (the 4-connected flood fill with the
  per-tile counts) and `classifyLots` (the empty ready lots: lot fit and the DevTypes that clear growth's floor). A
  deopt in the rarely-reached lot code no longer discards the fill's optimized code.
- The per-call `isZ` closure (a new call target on every scan: "wrong call target") becomes the module-level `isGrowZone`.
- `lotFitAny` calls `lotFit`, then its wide search in its own function `lotFitWide`; its per-call `rd` closure becomes
  the module-level `roadAtXZ`.
- `scanOutages` keeps the loop over the growables and moves the rare branches (the water test of a building without
  `BF.Watered`, the outage counts) into `waterNeedMet` and `addOutage`; `scanRubble` moves its rubble branch into
  `addRubble`.

The operations and their order are unchanged (integer counts and cell indices only), so the scans, and the city, are
bit-identical. Gate: cityDigest equal to the base; dom-28 warm worst-month ≤ +10 ms at dense1m design cadence.

**A1, the predicted places** (map P1 and its working prototype, §9). **It is the last commit, and it ships only if day
29 passes its gate (§8)**; otherwise B3 ships A0 + T1 + T2 + P3 without it.

- **The prediction.** `advisors.daily` runs it on `MONTH_SCAN_DAYS[1]` (day 29), right after `scanFacilities`,
  `scanJam` and `respOut`: `a0.scan.places = predictPlaces(st, a0.scan)`.
  - It skips (no places) when `a0.scan.zone` is missing (gameplay O5): otherwise `gather` would run a fallback zone scan
    on day 29 and the tick another one (an old save loaded after day 28's dailies).
  - `predictPlaces` runs `gather(st, 'predict', scans)`: the tick's rule set on the saved scans, with three differences:
    - it is read-only: no stall-window writes (the `mode === 'month'` branch);
    - it uses `freshLocate`;
    - it skips the garbage rule's `residentSurvey()`, which off the tick is a full pass over the homes (1.5–1.8 ms at
      1M): `depthRules`' `Scans` argument carries a `predict` flag (determinism O8: no module-level mode variable).
  - It then applies **the tick's own announcement test**, one function shared by `monthly()` and the prediction
    (gameplay O3: they cannot drift), for the tick day `T = (⌊day / 30⌋ + 1) × 30`, in priority order:
    - confirm: `seen[id]` must be set and `T − seen ≥ CONFIRM_DAYS`;
    - cooldown × 2^min(3, streak);
    - `quietIf`, against the news of the 90 days before `T` (`recentNews` takes the day);
    - at most `ADVICE_PER_MONTH`.
  - For each predicted announcement with a lazy place, it calls `where()` and stores `places[id] = [x, z]`, or
    `[-1, -1]` when there is none.
- **On the tick**, an announced advice with a lazy place and a saved `places[id]` takes that place without a lookup.
  `[-1, -1]` behaves like a lookup that found nothing today: no place, and the Advisors panel looks it up again when it
  lists the issue (determinism O8 settled: the same as the base's empty lookup). Any other announced advice is looked up
  as today.
- **Unchanged on the tick:** texts, the choice of what to announce, cooldowns, streak, `seen`, posts, toasts and the issue list.
- **State.** `MonthScans` gains `places?: Record<string, [number, number]>`. It is saved and consumed with
  `AdvisorData.scan`, which the tick already reads and deletes. It is versioned by presence, like the other `MonthScans`
  fields. A scan without `places` (an older save) is looked up on the tick, as today. `AdvisorData` stays at `v: 1`.
- **What the prototype measured** (gameplay R2; h_ runs, warm months, A1 alone against the base):
  - dense1m day-29 unit excess: p90 2.8 → 5.2 ms, max 4.0 → 61.8;
  - bot256 day 29: median 0.4 → 2.6, p90 3.6 → 6.0;
  - the medians of the day-29 and tick advisor hooks together: 1.66 → 2.15 ms (dense1m), 1.86 → 2.98 (bot256): A1
    raises the total advisor work;
  - the tick saves 0.2–0.3 ms at the median and about 2 ms at the p90 (`advisors.monthly` max 6.1 → 2.2 ms on dense1m,
    5.6 → 1.9 on bot256);
  - predictions: dense1m 15 used, 3 wasted, 0 missing; bot256 18 / 0 / 0. The 62.9 ms predict (dense1m d11039) fell in
    the month where all five dense1m prototype runs predicted 2 places and used 1, a systematic waste; the base's tick
    that month (d11040) cost 2.7–4.4 ms. The base has the same class of spike on a tick (bot256 pristine_2, d21690,
    62.9 ms): cold lookup code. **A1 moves that risk to day 29, and a wasted prediction can add a spike the base never
    has.** d11040 is a demographics-sample tick; with P3 under it the prediction is re-tested (§8).
  - deterministic, and bit-identical to the base after 90 days on both fixtures; the 128×15 bot is identical row for row.
- **A cache interaction** (determinism O9): the day-29 lookups fill services' per-pass `clustersOf` cache earlier than
  the base does. The bot reads `unservedClusters` (simbot.ts:1449), and the tier coverage layers are written tier by tier
  during a services pass, so a cluster cached mid-pass on day 29 can differ from one computed at the bot's own call. This
  stays deterministic. "Bot table identical" stays A1's gate; re-run it after B2 (which re-splits the services steps) merges.
- **Rejected:**
  - two-phase rule evaluation (map P2): medium risk, it only moves the cold gather;
  - banded scans (month map P5): normal-day latency, not the tick.

### 3.3 Population and EQ/HQ (P3)

EQ/HQ needs nothing: it is already 30 slices plus a step on day 25. Population has no monthly hook. The only periodic
population work that can coincide with a tick is its two samples in `aggregate()` (population.ts:336–337):

```ts
/** phases of the periodic samples (B3): odd, so neither lands on a month tick (ticks are multiples of 30: even) */
const OCC_PHASE = 1;    // employment sample: day % OCC_PERIOD === OCC_PHASE      (was 0: every other tick)
const DEMO_PHASE = 17;  // demographics sample: day % DEMO_AGG_DAYS === DEMO_PHASE (was 0: 1 tick in 16)
const sample = first || st.day % OCC_PERIOD === OCC_PHASE;
const demo = first || st.day % DEMO_AGG_DAYS === DEMO_PHASE;
```

- **Cost removed from the tick:**
  - the employment sample, 0.1–0.3 ms on every other tick;
  - the demographics sample, +0.5–2 ms in `population.daily` on its day at dense1m (up to +6 in frames), on one tick in 16.

  The second matters for the acceptance runs: d11040 is a demographics-sample tick and month 3 of every dense1m run.
- **The `'demographics'` layer event** moves from dom 0 to dom 1 (`day % DEMOGRAPHICS_EVENT_DAYS === 1`; gameplay O8).
  It has no sim listener; the Demographics overlay rebuilds on it while shown, which today lands in the main-thread
  month frame.
- **Save state:** none. `wfNow`, `popGrids` and the occupancy cursor are already saved, and their phase follows `st.day`
  after a load.
- **Coupling.** `tests/sim/exact/j10.test.ts` runs the live `populationSystem` against the frozen
  `populationSystemOriginal` and compares the whole state and every event every day (determinism R3: rev 1's grep missed
  it). The frozen copy `tests/sim/exact/j10Original.ts` takes the same two phases and the event day, and its header says
  so. `tests/wasm/populationAggregateProbe.test.ts` compares frozen arms with each other, not with the live phase.
  `tools/bench/populationAggregateProbe/core.ts` keeps its own phase-0 day kinds, which it uses only as weights. The
  coupling check is the full vitest suite (O12), not a grep.

### 3.4 Budget (stays on the boundary)

- `computeMonthlyBudget` and `settle` stay on the tick, unchanged. Every input is tick-time state:
  - the stats written by that day's dailies;
  - funding, taxes, ordinances and loans, which the player can change up to the tick;
  - the tourism visits and attractiveness (from day 26 and the tick after T2);
  - the strike draws on `sim.rng`, in the tick's draw order.
- Warm cost: 0.7–1.0 ms.
- Its cold cost on the first 1–2 ticks after a load (4–10 ms) is JIT. 73–77 % of it is the per-cell network loop:
  2.7–5.6 ms cold against 0.24–0.58 warm. Moving that loop to another day would only move a cold spike; banding it with
  dirty tracking (month map P2) risks a stale band whenever a writer emits no event. The fix is a bit-identical J-fix in
  `budget.ts`, outside B3's files: lead decision L1.

### 3.5 The month calendar after B3

| day of the month | work (B3 changes in bold) |
|---|---|
| 0, the tick | **dailies:** the slices (survey, tourismAcc, EQ/HQ) and demand's caps refresh. **monthlies:** fire, emergency, disasters, justice, **tourism (attractiveness + migration only)**, budget, rewards, approval, **advisors (saved places)**, history. Then the `month` event |
| **1** | **population: the `'demographics'` layer event** |
| 7 | population: prune the outage records |
| 15 | justice: facility scan (`FACILITY_SCAN_DAY`); desirability: freight refresh |
| 20 | growth: commercial core (`CORE_DAY`) |
| 25 | population: EQ/HQ step (`EQHQ_DAY`) |
| **26** | **tourism: venue pass, hotels, totals, records, visitor raster (`TOURISM_DAY`)** |
| 28 | advisors: zone scan (**A0 kernels**) |
| 29 | advisors: facility, jam and response scans, **plus the predicted places (A1)** |
| **odd days** | **population: employment sample (day ≡ 1 mod 4), demographics sample (day ≡ 17 mod 32)** |

Where P3's samples land (determinism O13; a latency matter only): the employment sample falls on dom 1, 5, …, 25 and 29
in even months (monthIndex even) and on dom 3, 7, …, 27 in odd months; so it meets the EQ/HQ step (25) and day 29 every
other month. The demographics sample moves by 2 days of the month per sample and lands on every odd dom once in 15
samples (16 months), day 29 included. Neither ever lands on dom 0, 26 or 28. A test pins the calendar (§7, test 10).

## 4. Saves and loads

**Keys, versions and fallbacks:**

| key | version | written | fallback |
|---|---|---|---|
| `systemData.tourismAcc` | v1 → **v2** (the window ends on day 26) | daily | A v1 record is replaced by an empty v2. The first pass takes the full growables pass (1–2 ms, once) |
| `systemData.tourismPass` | **new, v1** | day 26 (`m`, totals, records, raster); the tick (`tc`, `dump`); init's and the tick's fallbacks | Missing or invalid: init runs today's approximate rebuild; the tick runs a pass when it is not fresh |
| `AdvisorData.scan.places` | new optional field, versioned by presence (A1) | day 29 | Absent: the tick looks the places up, as today |
| population | none | — | — |

**A save taken mid-month.** Let the next tick be `T_k` at day 30k. Saves always fall between days (`saveCity` awaits
before it serializes), so "a save on dom d" holds the state after day d's dailies (and the tick's monthlies on dom 0).

| save on | the last pass | at load | at `T_k` |
|---|---|---|---|
| dom 0–25 | day 26 of the previous month (`m = k − 1`) | records and raster restored exactly from it; `tourismAcc` continues its window | The loaded game runs its own day-26 pass, with saved `A`, saved slices and the same state, in the same (id) order, then the tick. Same as uninterrupted |
| dom 26–29 | day 26 of this month (`m = k`) | records and raster restored exactly | The tick reads the saved `culture`, `conn` and `seats` (already decremented for venues bulldozed since). The budget reads the restored records. With A1 the advisors read `scan.places` on the tick |

So a save on any day continues the tourism state and the next tick's outputs bit for bit:
- totals, attractiveness, migration;
- venue income and the tourism income line;
- the raster, which desirability reads;
- the attractiveness breakdown's details (`tc`, `dump`).

This holds wherever the rest of the economy continues exactly. It is stricter than the base, which rebuilds the records
and the raster approximately at load (map table H: visits 5–11 % off, `st.visitors` 5–12 % off). Without `ven`, a save on
dom 26–29 would regress against the base: the tick's venue income would then come from records rebuilt at load.

**Scope of the continuity claim** (determinism O11). The base itself is not whole-city exact across a load: infra
re-init, float32 building fields, and an extra news item on bot256. After removals of *growables*, whole-city continuity
is also limited by approval's survey slices, population's float coarse sums and the EQ/HQ sums, which all run in bucket
order after a load and live outside B3's files. So continuity is tested per month-state on an economy-only town (§7) that
removes and adds **plopped** buildings, as in tests/sim/finalFixesEcon.test.ts, and not with fixture digests.

**Size.** `ven` + `spl` at dense1m: 445 venues → ≈ 2.7k doubles ≈ 21 kB, against bundles of 3.5–4.3 MB. The bundle codec
stores typed arrays in its binary blob. The recovery codec carries `systemData` (the `data` part) as-is through
`encodeBundle`, as a raw blob that the localStorage budget never drops (determinism O10: rev 1 said it XOR-codes them; it
does not, and at ≈ 21 kB it need not).

## 5. Expected month-day unit at 1M

**Method.** The month map's 24 base runs (6 per cell; months 3–10 warm, 1–2 cold; year days included) were replayed month
by month:

  *after* = measured excess − `economy.tourism.monthly` + (`tourism.survey` + `tourism.attract`).

The second term is the part that stays on the tick. A1's and P3's further gains are taken from the instrumented runs
(`adv.m.placed`, `population.daily`). The scripts are listed in §9.

| cell | normal day | warm today: median / p90 / max | warm after T2 | warm after T2: worst month (median over runs) | warm after T2 + A1 + P3 (est.) | cold today → after T2 (median) |
|---|---|---|---|---|---|---|
| design, dense1m, unit | 7.9 | 5.8 / 15.0 / 18.9 | 3.5 / 8.8 / 11.8 | 8.5 | ≈ 3 / ≈ 7.5 / ≈ 10 | 14.9 → 10.6 |
| design, bot256, unit | 7.6 | 5.1 / 8.8 / 14.2 | 2.3 / 7.1 / 11.0 | 7.4 | ≈ 2 / ≈ 6 / ≈ 10 | 12.5 → 10.2 |
| frames ultra, dense1m, unit | 7.5 | 6.2 / 16.7 / 29.9 | 2.8 / 9.0 / 18.8 | **10.0** | ≈ 2.5 / ≈ 7.5 / ≈ 13 | 15.7 → 10.9 |
| frames ultra, dense1m, month frame | 10.3 | 6.4 / 18.8 / 28.7 | 2.5 / 10.6 / 20.4 | **10.9** | ≈ 2.3 / ≈ 8.5 / ≈ 14 | 19.2 → 14.3 |
| frames ultra, bot256, unit | 6.8 | 3.8 / 8.3 / 20.4 | 2.6 / 7.1 / 18.5 | 7.0 | ≈ 2.4 / ≈ 6.5 / ≈ 18 | 14.5 → 10.4 |
| frames ultra, bot256, month frame | 9.4 | 3.1 / 9.1 / 21.2 | 1.8 / 6.9 / 19.7 | 5.9 | ≈ 1.7 / ≈ 6.5 / ≈ 19 | 14.5 → 10.8 |

"normal day" and "today" are measured. "After T2" is modelled from the measured hooks of the same months. "T2 + A1 + P3"
is a rougher estimate. All values are ms of excess over the normal day, except "normal day", which is the median normal
day itself. The pooled p90 (6 runs × 8 months) is in effect the worst month, because the headless runs are deterministic
and replicate the same 8 month states (gameplay R4); the "worst month" column is the statistic §8 gates. Normal days
have a warm p90 excess of 2.3 to 3.4 ms, so the bar is reachable.

**Read plainly** (gameplay R3):
- the dense1m frames cells hinge on one month, d11040, a demographics-sample tick with a costly place lookup, which only
  P3 and A1 address;
- the 2nd and 3rd ticks after a load stay at a median of +10.2 to +14.3 ms in all six cells after T2;
- the 1st tick after a load (C_ runs, T2 alone): from a dom-16 save, design 18.0 → 13.2 (dense1m) and 26.8 → 20.9
  (bot256), month frame 26.5 → 19.6 and 28.2 → 19.6; from a dom-28 save 40–60 → 34–53, because population's post-load
  refill (20–39 ms a day for 4 days after any load) lands on the tick (L2). On that first tick, A1 takes another
  ≈ 2.6 ms off dense1m (its lookups) and nothing off bot256, where the cold gather dominates;
- at design cadence the literal excess depends on the infra phase (−48 ms at dense1m, +56 at bot256 for the same code),
  and bot256's matched excess stays +26.4 ms (median; p90 60.5): its services step on month days runs 29–31 ms against
  18–20 ms on other services days (L4).

**What remains on the tick after B3 (warm):**
- budget 0.7–1.0;
- the advisors' gather 0.5–1.0;
- emergency 0.4–0.6;
- tourism's attract step 0.1–0.5;
- approval and history ≈ 0.2;
- demand's caps refresh on dom 0, 0.4–0.5.

**The remaining maxima** are not month work:
- population's "wrong map" deopt cascades (+6–8 ms on a few days);
- GC;
- budget code still cold at month 3 in frames at bot256 (4–7 ms; L1).

**The new loads off the tick:**
- Day 26 gains the pass at T1-kernel cost (tourism map, variant E2): venues 0.40 / 0.57 / 1.08, splats 0.53 / 0.84 /
  0.92, exp 0.37 / 0.60, blur 0.03 / 0.05, beaches 0.1–0.2, hotels 0.03, plus the id sort of ≈ 450 venues (≈ 0.02). That
  is ≈ 1.5 median / 2.3 p90 / 2.6 max on a day whose base excess is −0.6 to +0.1.
- Day 28 keeps the zone scan, after A0 in kernels (the gate decides how much of its +14 ms p90 A0 removes).
- Day 29, with A1, gains 0.7–1.4 ms at the median and has the tail of §3.2.
- The mean cost per day barely changes. The tourism work moves; building the snapshot costs ≈ 0.05 ms; A1 adds one more
  gather a month, ≈ 0.03 ms a day on average. So `totalMsPerDay` stays within noise.

**The main-thread host.** The month frame becomes ≈ one normal-day frame + 2–3 ms at the median, which meets the plan's
"< 20 ms" up to the p90. The exceptions are autosave months: `CityScene.onMonth` serializes for 50–130 ms at 1M (L5). The
Tourism overlay refresh also leaves the month frame (for day 26), and so does the Demographics overlay's (for dom 1).

## 6. What the player and each consumer sees, and when

| output | today | after B3 | readers |
|---|---|---|---|
| venue records (`venueVisits`) | tick | **day 26** | budget's venue income on the tick; inspector "Tourists"; `tourismSummary`; simbot; `onRemoved` |
| `touristsGross`, `tourists`, `overnight`, `hotelShortage`, `tourism`; `stats.tourists`, `stats.hotelRooms` | tick | **day 26** | demand (CS jobs): from day 1 → **from day 26**. growth (hotel weights): from day 1 → day 26. budget's tourism line, approval's pride term, advisors' hotel rule and history on the tick: **values 4 days old**. `facilityScan` (day 15): 15 → 19 days old |
| `st.visitors`, `rt.coarseVisitors`, `layerUpdated` `'tourism'` | tick | **day 26** | desirability's bands from day 27 (the same staleness, shifted); the Tourism overlay. `coarseVisitors` has no reader |
| attractiveness (city, by wealth, terms), its culture / clean-air details; stats | tick | tick | the next pass's draw, budget's `aF`, advisors, history, UI |
| `migration`, `migrants` | tick | tick | demand from the next day |
| advisor posts, texts, choices, issue list | tick | tick | news feed, toasts, Advisors panel |
| advisor "Show me" place of a predicted announcement (A1) | tick | **day 29** (one day older) | the news item's x/z |
| employment / demographics samples | day ≡ 0 mod 4 / mod 32 | **day ≡ 1 mod 4 / 17 mod 32** | demand, desirability, stats |
| `layerUpdated` `'demographics'` | dom 0 | **dom 1** | the Demographics overlay |
| budget settlement, approval, rewards, emergency, history, `month` event | tick | tick | unchanged |

**Edge cases.** Each is at most 4 days of staleness (or one month for an old save's first tick), deterministic, and
documented in the code:
- A venue that opens on dom 27–29 has no record at its first tick, so it earns its catalog income (`venueIncomeFactor`
  gives 1, the existing "opened after the last update" rule). It gets a record on the next day 26.
- A venue that closes on dom 27–29 keeps that month's visits, unless it burns: `computeMonthlyBudget` already pays
  nothing for a burnt venue. Conversely (determinism O7), a venue that was closed on day 26 (op 0: a power cut, no road,
  a strike) and reopens on dom 27–29 has a record with op 0, so `venueIncomeFactor` gives 0 at the tick, where the base
  pays it.
- A college bulldozed, or an airport that loses power, on dom 27–29 still counts for that tick's students or
  connections. A bulldozed venue does not, because `onRemoved` updates the pass.
- An ordinance, a tax or a funding change on dom 27–29 that changes venue visits (the tourism promotion ordinance, a
  venue's service funding) reaches tourism at the next day 26, about 27 days later instead of at the tick; the
  ordinance's cost is still charged at that tick (determinism O7, gameplay O7).
- A save from before B3 loaded on dom 26–29: the tick reads init's load-time pass with the old save's attractiveness put
  back; tourists and the tourism line come from init's pass (gameplay O6). Loaded on dom 0–25: the old save's totals
  are put back and stay until day 26 (determinism O7), as today until the tick.
- The inspector's "— (next month)" for a venue without a record means "until day 26". The wording is in facilities.ts,
  which is out of scope.

## 7. Tests

**Changed:**
- `tests/sim/tourism.test.ts`: the `tourismMonth` helper calls the system's `refresh(sim)` (both steps), so the existing
  tests keep their meaning. The 256² cost test also logs the pass and the attract step separately. Its PERF_STRICT budget
  (< 6 ms) applies to the pass. In that test the attract step includes a full survey, because the test steps `st.day` by hand.
- `tests/sim/finalFixesEcon.test.ts`, "tourism: the hotel rooms and historic sites gathered in daily slices equal one
  full pass": the windows end on day 26. A runs to 56; B loses `tourismAcc` on day 55 and takes the full pass on 56.
  Compare after 56 and after the tick at 60. `done` resets after the pass.
- `tests/sim/exact/j10Original.ts`: the two P3 phases and the event day (determinism R3).

**New, in tests/sim/monthSpread.test.ts (T2, P3):**
1. **Schedule.** On a town with a castle, a hotel and a historic home:
   - the totals, records and raster change on day 26 and on no other day;
   - `layerUpdated` `'tourism'` is emitted on day 26 only;
   - on the tick, only attractiveness, its terms, migration and migrants change, and `tourismPass.m === st.monthIndex`.
2. **Continuity on every day of the month** (determinism R4). An economy-only town (finalFixesEcon's `town()`) with
   venues (castle, museum, zoo, small and large airports, train station), hotels, historic homes, a college and a lake
   for beaches. A script of player actions runs in every game at the end of its day:
   - (a) day 30: bulldoze a venue that is **not the last plopped building** (the swap-remove reorders `rt.plopped`; a
     load rebuilds Map order);
   - (b) day 58: bulldoze a landmark and the operating large airport (saves on 58–60 carry a decremented
     `pass.culture` / `conn` and a `ven` id whose building is gone);
   - (c) day 58: plop a new venue (no record until day 86, so `venueIncomeFactor` is 1 on day 60 in both games).

   For each save day s = 31…60: `serializeCity({copy})` → `deserializeCity` → `new Sim(economySystems())`, then both
   games run to day 91 (passes on 56 and 86, ticks on 60 and 90). With `Object.is` / byte equality:
   - right after the load: every `venueVisits`, `tourismSummary`, `attractivenessBreakdown` and `st.visitors`;
   - at days 60 and 90: the econData tourism totals, attractiveness, `attractTerms`, migration and migrants; the stats;
     `lastIncome['tourism']` and every `facility:*` line; `st.visitors`.
3. **Fallbacks:**
   - (a) Delete `tourismPass` before loading on dom 10 and on dom 28. Init rebuilds (records exist, raster > 0 at the
     venues). On dom 28 the tick uses init's pass; with the pass deleted after init, it runs its own.
   - (b) A v1 `tourismAcc` becomes v2, and the first pass's sums equal the sliced sums of an uninterrupted run.
   - (c) A pass that fails the validator (a Float32Array `ven`, a short `conn`) takes the fallback.
4. **Removal between the pass and the tick.** Bulldoze a landmark and the only large airport on day 28. The totals drop
   at once, as today. `pass.culture`, `pass.tc` and `pass.conn[0]` drop (never below 0). The tick's
   `attractTerms.connect` equals the value with no large airport.
5. **Determinism.** Two runs of the same city give identical `serializeCity` digests after a year (12 passes, 12 ticks).
6. **Slicing units.** The window month (`m = ⌈(day − 26)/30⌉`) covers each slice exactly once per window; the pass reads
   the window only from the daily; the venue order is ascending id whatever the order of `rt.plopped`.
9. **P3.** Over days 1…960, no month tick is an employment or a demographics sample day, the samples still recur every 4
   and 32 days, and the `'demographics'` event comes on dom 1. The existing save/load tests of `wfNow` and `popGrids`
   stay green.
10. **The calendar** (gameplay O9): the month offsets (`EQHQ_DAY`, `TOURISM_DAY`, `MONTH_SCAN_DAYS`, `CORE_DAY`,
    `FACILITY_SCAN_DAY`, the prune day, the P3 phases) never fall on dom 0, and the heavy ones are pairwise distinct.

**New, for A0 and A1, in tests/sim/advisors.test.ts and tests/sim/advisorsPredict.test.ts:**
- A0: the kernels give the same `ZoneScan` as a frozen copy of the base's `scanZones` on random zone maps (lots, odd
  tiles, steep tiles, outages, rubble).
6. A lazy-place rule (`noElementary`, at the biggest unserved cluster): after day 29, `scan.places[id]` is set. The
   tick's news item carries that x/z, and the rule's `where` is not called on the tick.
7. **Predict is read-only** (gameplay O4). All of `st.systemData` (survey, popGrids, outages included), `st.news`,
   econData and the RNG state are deep-equal before and after `predictPlaces`; `residentSurvey` is not called and no
   zone scan runs (module spies). Without `scan.zone` the prediction is empty.
8. **Saves on day 28 and day 29** (determinism R4 d). The loaded games post the same news (text, x, z) on the tick as
   the uninterrupted one: the day-28 save predicts on day 29 itself. With `scan.places` deleted, the tick looks the place
   up and, in a steady city, finds the same one. The existing "month scans are saved with the city" test covers `places`
   in its `structuredClone` check.

## 8. Verification gates

| step | gates |
|---|---|
| A0 | tsc; vitest; cityDigest of bot256 and dense1m after 120 days at design cadence = base; 128×15 seed-7 bot identical (194,432 in 2015); **dom 28: worst warm month ≤ +10 ms at dense1m design cadence** (timing) |
| T1 | tsc; vitest; cityDigest of bot256 after 120 days at design cadence = base (`9f9a4666…eb54`); 128×15 seed-7 bot identical |
| T2, P3 | tsc; vitest including tests 1–6, 9 and 10; determinism (two runs, same digest) |
| A1 | tsc; vitest including tests 6–8; digests after 90 days equal to T2 + P3 on both fixtures; bot table identical (also after B2). If either differs, say why: a day-29 place that differs from the tick's. **Day 29: the worst warm month and the p90 ≤ the tick's bar after B3; otherwise drop A1** (gameplay R2 b). Name the rule wasted at d11040 and the filter term that differs, with P3 under it (gameplay R2 a; §10) |

**The balance procedure** (docs/SIM_DEPTH_SPEC.md, "Balance procedure"): runs of 256×60 seeds 7 and 11 and 128×15 seed
7, against the lead's base runs in `scratchpad/balance/base/`. Acceptance on 256 seed 7:
- population ≥ 150k at year 15, ≥ 950k at year 60, and ≥ 0.9× the baseline;
- approval ≥ 50 from year 30, and funds ≥ 0;
- EQ ≥ 100 by year 30;
- **tourism jobs within ±30 %** (gameplay R6): neither the balance-json rows nor the bot's table has a tourism-jobs
  column, and tools are outside B3's files. A scratch probe (`b3work/implementer/tourismJobs.ts`) runs the bot's city
  and logs per year `econData.tourism` against `demandContext(st, rt).tourism` (the legacy formula, demand.ts:57), for B
  and W on 256×60 seed 7; the ratio must stay within 0.7–1.3 and within ±30 % of B's;
- `totalMsPerDay` ≤ baseline + 3.

If 256×60 seed 7 lands under 0.9× the baseline (gameplay O10: the bot moves ±9–15 % at year 60 from step-boundary
changes alone), run T2-only and P3-only to attribute it, and use seed 11 and 128×15 as corroboration.

**The bot output changes by design** (T2, P3). Expect the change to stay within the run-to-run chaos margin. The new
128×15 seed-7 2015 population goes in the hand-off report; docs/dev/STATUS.md (the 194,432 gate line) is the lead's and
is not edited here (gameplay R7). Add the B3 rows to tests/sim/fixtures/balance-baseline.json under a new key, leaving
the old rows untouched (the B1 precedent).

**Acceptance timing** with `monthbench` (§9) through `tgate.py`:
- B = b3base against W = b3 after T2 + P3 (and again with A1), ≥ 3 interleaved runs per side;
- warm 40 days, then **≥ 360 days** (12 warm months, which also cover a year tick);
- four cells: dense1m and bot256, each at design cadence and in frames (speed 3, 60 fps, renderMs 6).

Judge (gameplay R4, the statistic the lead is asked to approve):
- per month, the median over the ≥ 3 runs of a side; the **worst warm month ≤ +10 ms**, with the per-month table printed;
- at design cadence the **no-steps** excess, with the literal and matched excess next to it; in frames the month-day unit
  and the month frame;
- the same statistic for **dom 26, 28 and 29** (and dom 27 printed): the days that carry the moved work (gameplay R1);
- months 1–2 after the load, the max, and the C_ first-tick runs (dom-16 and dom-28 saves) are reported, not gated (L1, L2).

## 9. Files, functions, artefacts

**Touched:**
- `src/sim/economy/tourism.ts`:
  - `TOURISM_DAY`;
  - the `TourismAcc` v2 and `TourismPass` v1 types and a validator;
  - the kernels `venueLoop`, `rasterize`, `visitorsLayer` and `coarseBlur3`;
  - `tourismSystem`: `venuePass`, the attract step, `refresh`, `daily`, `monthly`, `init` (the restore path) and `onRemoved`;
  - the header comment's schedule.
- `src/sim/economy/advisors.ts`:
  - A0: `fillZoneBlocks`, `classifyLots`, `lotFitWide`, `isGrowZone`, `roadAtXZ`, `waterNeedMet`, `addOutage`, `addRubble`;
  - A1: `MonthScans.places`; `gather`'s `'predict'` mode and `depthRules`' `Scans.predict`; the shared announcement test;
    `recentNews`' day; `predictPlaces`, the day-29 hook and the tick's use of saved places.
- `src/sim/economy/population.ts`: `OCC_PHASE`, `DEMO_PHASE` and the `'demographics'` event day.
- The tests in §7, and `tests/sim/exact/j10Original.ts`.

**Not touched:**
- `budget.ts`, `demographics.ts`, `tuning.ts`, `params.ts`;
- every infra, UI and save file;
- `tools/simbot.ts`: its API is unchanged;
- docs/dev/STATUS.md.

**Session artefacts** (scratch, not in the repo), under `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/b3work/`:
- T1 patch: `map-tourism/patch/tourism-jit-hygiene.patch`. It applies cleanly to W, and tsc exits 0.
- A1 prototype: `predictPlaces` in `map-pop-adv/proto/src/sim/economy/advisors.ts`, applied by `map-pop-adv/scripts/patch_proto.py`.
- Timing:
  - `tools/monthbench.ts`, bundled with `tools/bundle.mjs --tree <worktree>`;
  - `tools/tgate.py` and `tools/monthagg.py`;
  - saves from dom 16 and 28: `map-month/fixtures/*_d{16,28}.metropolis`.
- The tourism-jobs probe: `implementer/tourismJobs.ts` (§8).
- The §5 model: `designer/model.py` (the m_ runs), `model_i.py` (the instrumented runs), `model_c.py` (first ticks after a
  load), `doms.py` (days 26–29) and `resid.py` (per-tick residuals).

## 10. Risks, and decisions for the lead

**Risks:**
1. **Behaviour (T2).** Tourism numbers are sampled 4 days before the tick that settles them, and the daily consumers see
   them 4 days earlier (§6). Balance effects are expected within noise. The balance procedure decides.
2. **Determinism.** Fixed days, no RNG, the same operations in a canonical (id) order within each pass. Mid-month loads
   restore copies, not recomputations.
3. **Old saves.** `tourismAcc` v1 costs one full growables pass. A missing `tourismPass` gives today's approximate
   rebuild until the next day 26. A scan without `places` is looked up on the tick. Nothing fails to load.
4. **A1 mispredictions** cost a wasted lookup on day 29 plus a fresh one on the tick: no behaviour change. A predicted
   place can be a day older than a tick lookup would be, whenever a coverage layer changes between days 29 and 0.
   Places are keyed by rule id, so a rule whose variant changes between those days keeps the day-29 spot.
5. **Cold code moves; it does not disappear.** The pass on day 26 and the lookups on day 29 can still spike after a load:
   one 63.7 ms day 29 in 33 in the prototype. T1 keeps the pass small (≤ 2.6 ms warm).
6. **Merge risk.** `tourism.ts`, `advisors.ts` and `population.ts` are in no other branch's files. Nothing in `tuning.ts`,
   the infra or the UI changes.
7. **Tests that call `monthly()` directly.** Tourism's must use `refresh`. The advisors' monthly calls keep working:
   without `places` they look up as today.

**Decisions for the lead** (outside B3's files):
- **L0, the reading of the target** (§1, §8): warm months, worst month over ≥ 12, ≤ +10 ms, no-steps excess at design
  cadence; ticks 1–3 after a load reported, not gated. Please approve or amend it explicitly.
- **L1, budget cold code.** In `computeMonthlyBudget`, move the per-cell network / bridge / power-line / subway / landfill
  count into a top-level function, and build `income` and `expense` with a fixed key order. That removes the "wrong map"
  deopt on the 2nd tick after a load. Integer counts and the same float sums in cell order make it bit-identical.
  Expected: the cell loop on ticks 1–2 after a load drops from 2.7–5.6 ms to under 1 ms. That is an analogy with T1,
  whose 1 − e^(−Σ) loop went from 2.4 / 5.3 / 9.2 to 0.4 / 0.6 ms; it is unmeasured, so measure it with the C_ runs
  before adopting. This is what would take the cold ticks under +10 in frames at dense1m. A warm-up call at load (month
  map P3) is the other, also unproven, option.
- **L2, population's post-load refill.** 20–39 ms a day for the first 4 days after any load. It is not month work, but a
  save from dom 26–29 puts it on the tick (month frame 65–83 ms). It is a W1 load-latency item: spread the refill, or
  keep the records warm.
- **L3, day 28 after A0.** If A0 does not bring dom 28's worst warm month under +10 ms at dense1m design cadence (today
  median 2.9, p90 14.0, max 23.3; per-month median +13.2 at d11218; cold +12.4 to +18.7 in all four cells), the rest is
  a banding item (month map P5) for W1's latency.
- **L4, de-phase the services access pass.** `ACCESS_PERIOD = 30 = DAYS_PER_MONTH` puts the access pass on one fixed day
  of the month: for bot256, the tick, +8–16 ms in the flush (matched excess +26.4 median). A period of 29 or 31 would
  drift instead. This belongs to S2/B2.
- **L5, the autosave on the main-thread month frame.** 50–130 ms at 1M. This belongs to W1.3.
- **L6, small items.** Demand's caps refresh on dom 0 (0.4–1.5 ms, demand.ts). The inspector's "(next month)" wording
  (facilities.ts).
