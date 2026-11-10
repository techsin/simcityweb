# T045 — LG-08 transit-oriented development

Branch `local/T045-lg08-tod`; FX5 starts from `1f231e7bffcf0effe42834a94594d077d4a7be61`, whose parent is
`59f7ce9aff92ceecb3f1fc1ff815100b92dfe5f4`. This FX3/FX5 diagnostic and report update is uncommitted; no `.done` file is written.
Older implementation, test, single-run and ensemble records are retained below with their original provenance.

**Current lead disposition: HOLD under NOTE-062.** The nine-member s11 no-flag median ends at **1,394,211**
against dev **1,483,518** (−6.019947%), **74,471.82 people below the 0.99× floor**. Early population increases and
the 128×15 cleaner-air moves still fail the written rules; D2 has not signed them. Approval is now judged net of
each member's smoothed commute contribution and remains **OPEN pending FX2**, not a raw-approval pass or fail.
Monthly nine-member commute activation remains **OPEN pending FX1**. Nothing here authorizes a merge or a balance
change: final gates run after B2, T041 and the preceding SIM lanes reach dev.

## FX5: NOTE-053 rules with NOTE-062 amendments

Read in full for this update: `NOTE-062.md` in the shared lane scratchpad;
`ebb88bd:docs/dev/queue/NOTE-053-sim-ensembles.md`; and T062's `note053-lanes/T045.md` and `SUMMARY.md`.
The latter two are the complete pre-NOTE-062 campaign exports. Their population tolerance of zero and raw
approval totals are superseded below; their raw medians/bands and member paths remain evidence. NOTE-048's
single-run/A/A rule and the historical single-run headlines below are no longer the current gate protocol.

### Origin and limits of these measurements

- **Lane:** measured tree `f8b3f145a379694adedb1e26bb825886d49282a2`, parent
  `59f7ce9aff92ceecb3f1fc1ff815100b92dfe5f4`. This is the parent lane plus T062's funds-nudge instrumentation
  from `3833c8d`, used only for measurement. A read-only diff to current HEAD shows no changes in `src/sim`,
  `src/core` or `src/assets`; `tools/simbot.ts` differs by that instrumentation, which is absent from production.
- **Dev:** cached simulation `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`, before B2/T041. Five original dev
  members were reused; added members came from an exact read-only extraction. Member JSON retains its own
  origin, cache key and command. This comparison does not rename old dev as the final dev.
- **Evidence root:**
  `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes`.
  `T045.manifest.json` names all summaries/raw members; `commands.json` records the campaign; `T045.audit.json`
  and `validation.json` retain its independent audit. The tables below are read-only reductions of those files.
- **B2 separation is not present in the measured/current lane trees.** `stopAttached()` still refreshes attachment
  state and clears `attachDirty`, while `stepCost()` uses that flag for its PREP estimate. Thus subway reads can
  fork the headless schedule through estimated budget/credit/carry, even without a new RNG draw or an immediate
  serialized-city mutation. As of NOTE-062, **B2 is not in dev yet**, and has not been merged here. The
  final comparison must record whether B2 has separated query freshness from scheduler work accounting.

### Protocol, fixed before the final runs

1. **NOTE-053 as written:** compare the per-year lane median with the matched dev reference's median and min–max band,
   for every completed year from 10. A base check passes only if the lane median is **inside dev's band** and
   `abs(lane median − dev median) ≤ max(item tolerance, half of dev's band width)`. Both conditions apply.
   Population tolerance is **1% of that year's dev median, two-sided**; approval net of commute, air and I-HT
   have tolerance **0**. A favorable direction does not exempt T045; T044's one-sided exceptions do not transfer.
2. **Separate population floors:** each no-flag row must also meet `median(lane) ≥ 0.99 × median(dev)` at its
   endpoint, including 128×15 at year 15. The same floor applies to subway versus dev subway. A wide dev band
   cannot waive this additional floor.
3. **Variants:** compare median(variant) with median(base) at the same lane commit. Transit loss remains at least
   **1% in 2040** and **10% in 2060**. NOTE-053 literally requires all three rows to move in the same direction
   **at year 60** by more than one quarter of dev's band. The 128×15 row has no year 60. T062 operationally used
   mixed endpoints 15/60/60; that calculation is reported separately, not silently presented as a written
   amendment. The literal three-row year-60 reading cannot be evaluated from these rows; the lead must settle
   that ambiguity before final implementation of the check.
4. **NOTE-062 member amendment:** all final base rows and all 256×60 variant rows run **nine members directly**:
   control, ±§100 and ±§200 once on day 1 and day 1441. A 128×15 variant uses five members and NOTE-053's
   second stage when within half a dev band of its threshold. Cached members may be reused. **Nine is final;
   there is no third stage or extra-member search.** Fewer failures at nine than five do not establish noise.
5. **Disjoint bands:** if the entire lane min–max band lies outside dev's for at least **three consecutive
   years**, report a real shift and its mechanism regardless of the other rows. This is additional to the
   three-row check; overlap does not convert a failing median into a pass.
6. **Only the stated zero-width exception:** a year with all nine dev I-HT shares exactly zero does not gate
   that metric; report the first year the lane median leaves zero. Air retains its written rule. There is no
   general air/I-HT favorable-direction waiver, percentage floor or missing-data exemption.
7. **ApprovalNetCommute:** derive each member's commute contribution with the same initialization, monthly
   updates and smoothing as that member's recorded approval, then form
   `approvalNetCommute(member, year) = recorded approval − smoothed commute contribution`.
   Take the median and band **after** this per-member derivation and judge with tolerance zero. Subtracting the
   current annual raw term from displayed approval, or subtracting two independently calculated medians, is not
   this metric. Report the term's own median/band per year. FX2 has not supplied it, so all three amended
   approval verdicts are **OPEN**; raw approval failures below are descriptive history only.

### Interim verdicts on the measured dev

The following population/air/I-HT counts were recomputed from the nine-member summaries with tolerance 1% for
population and NOTE-062's zero-I-HT exception. Approval is deliberately excluded from a combined failure count
until FX2 supplies the amended metric.

| No-flag row | Population, years ≥10 | Air, years ≥10 | I-HT share | ApprovalNetCommute | Endpoint floor |
|---|---|---|---|---|---|
| 128×15 s7 | **FAIL**, 2012 and 2014 (2/6) | **FAIL**, 2010–2014 (5/6) | PASS in 3 gated years; 3 zero-band years not gated | **OPEN — FX2** | PASS: 193,438 ≥189,672.12 |
| 256×60 s7 | **FAIL**, 2010, 2011, 2018, 2020, 2022 (5/51) | PASS (0/51 failures) | PASS in 29 gated years; 22 zero-band years not gated | **OPEN — FX2** | PASS: 1,496,254 ≥1,446,476.13 |
| 256×60 s11 | **FAIL**, 22/51, including every year 2050–2060 | **FAIL**, 15/51 | **FAIL**, 2051–2060 (10/40 gated); 11 zero-band years not gated | **OPEN — FX2** | **FAIL:** 1,394,211 <1,468,682.82 |

I-HT first nonzero lane median: **never** in 128×15, **2052** on s7, **2010** on s11. In particular, the
pre-amendment export's s11 I-HT failures in 2047–2050 are now **not gated**, because dev's entire band is zero.
Later favorable I-HT departures still fail when dev's band has width. The s11 air failures remain 2012, 2013,
2016, 2018–2026, 2028, 2029 and 2032; cleaner air is not a general exemption for this lane.

The s11 median is below dev's minimum throughout **2050–2060**; this is distinct from disjoint entire bands.
No population, air or I-HT pair in the supplied summaries has three consecutive wholly disjoint band years
(s11 population has 2011 alone; air has 2016 alone). That additional rule therefore adds no new current verdict
for those three metrics; approval-net disjointness is **OPEN**. T062's operational mixed-endpoint 15/60/60 check
does not trigger for population/air/I-HT because the directions/quarter-band conditions do not all agree. That
does not claim evaluation of NOTE-053's literal three-row year-60 wording. Approval-net's three-row check also
remains **OPEN**, rather than inheriting the raw-approval result.

| Variant / separate check | Nine-member measurement | Current disposition |
|---|---|---|
| Transit loss in 2040 | subway 888,704 [885201,891505]; skip 875,976 [867226,882641]; loss **1.432198%**, margin **3,840.96 people** | PASS ≥1%; nine-member verdict final on this base |
| Transit loss in 2060 | subway 1,497,147 [1283912,1587140]; skip 1,265,455 [1179555,1366306]; loss **15.475568%**, margin **81,977.3 people** | PASS ≥10% on this base |
| Subway floor in 2060 | lane 1,497,147; dev subway 1,491,542 [1306531,1552165]; floor 1,476,626.58, margin **20,520.42 people** | PASS, matched strategy |
| Monthly commute activation from Jan 2030 | median of all nine skip members must be negative each month; weakest member must be reported | **OPEN — FX1 monthly probe**; one control or annual traffic mean cannot establish it |
| Stage-6+ near-station share | `--subway` control's final census **4.673862446×**, threshold 2× | Retained **single-control PASS** under NOTE-062; not an ensemble median or evidence from `maxStage` |
| ms/day | NOTE-062/NOTE-055 require one same-strategy pair in its own quiet timing slot | Historical pair retained below; **OPEN for final-dev timing**, concurrent campaign CPU is not timing evidence |

The retained stage census is **45/130 (34.615385%)** stage-6+ buildings within six tiles of a connected station,
against **661/8925 (7.406162%)** citywide. Mean stages over tower-eligible types are **4.851851852 near stations**
and **4.136494433 citywide**, diagnostic only. It is a realised-building census, not a maximum-stage permission check.

### D2 items, separate from the written gate verdicts

Early population-up failures on all three rows and 128×15 cleaner-air failures stay **FAIL, pending FX4 and D2**.
They may be signed as a by-design base move only if FX4 names the mechanism, the changes stay within **+3%**,
and they repeat on final dev. Staying below +3% alone is not a pass and is not a retrospective tolerance change.
The first differing approval-gated bot decision is not yet identified. FX4 is explicitly **WAIT**: the user will
provide FX1 next. This update performs no speculative diagnosis run or balance change while that log is absent.

The s11 late regression is not covered by that early D2 option. If on final dev its no-flag median remains below
dev's band in 2050–2060 **or** below 0.99×dev at year 60, **LG-08 does not merge**. Return start/coefficient trade-offs
to the lead against s11 and s7 year-60 base, Jan-2030 activation, and 2040/2060 transit loss. Do not add compensation,
free approval, alter the default bot, weaken a specified cost, or move an LG-08-induced stall to an “outside LG-08”
backlog item. No such backlog change is made in FX5.

### Per-member endpoint and stall columns (read-only derivation)

`S` means 2050→2060 population growth **<100,000**; `G` means at least 100,000. These flags/counts are reported,
not gated. They were derived from each existing member's `rows[].population` at years 50/60, using the paths in
`T045.manifest.json`; no FX2 approval metric is inferred. IDs encode the signed funds nudge and its day.

| Member | s7 lane 2060 | Gain | Flag | s7 dev 2060 | Gain | Flag |
|---|---:|---:|---|---:|---:|---|
| control | 1,520,331 | 242,276 | G | 1,513,835 | 248,094 | G |
| p100-d1 | 1,497,363 | 233,039 | G | 1,379,922 | 117,959 | G |
| m100-d1 | 1,519,049 | 250,865 | G | 1,461,087 | 189,499 | G |
| p100-d1441 | 1,497,363 | 233,039 | G | 1,504,801 | 243,852 | G |
| m100-d1441 | 1,458,575 | 185,052 | G | 1,461,087 | 189,499 | G |
| p200-d1 | 1,456,284 | 186,791 | G | 1,522,489 | 249,500 | G |
| m200-d1 | 1,408,194 | 141,707 | G | 1,438,474 | 175,613 | G |
| p200-d1441 | 1,496,254 | 210,661 | G | 1,542,590 | 271,208 | G |
| m200-d1441 | 1,256,440 | 73,578 | S | 1,341,715 | 139,257 | G |

Stalled: **s7 lane 1/9; dev 0/9**.

| Member | s11 lane 2060 | Gain | Flag | s11 dev 2060 | Gain | Flag |
|---|---:|---:|---|---:|---:|---|
| control | 1,261,054 | 78,639 | S | 1,427,340 | 155,237 | G |
| p100-d1 | 1,409,102 | 165,838 | G | 1,483,518 | 216,565 | G |
| m100-d1 | 1,336,265 | 113,938 | G | 1,498,791 | 244,718 | G |
| p100-d1441 | 1,323,259 | 114,924 | G | 1,503,201 | 240,951 | G |
| m100-d1441 | 1,272,478 | 102,396 | G | 1,472,527 | 210,888 | G |
| p200-d1 | 1,544,601 | 272,530 | G | 1,467,836 | 192,149 | G |
| m200-d1 | 1,441,588 | 170,963 | G | 1,504,163 | 227,698 | G |
| p200-d1441 | 1,424,463 | 153,844 | G | 1,511,108 | 240,837 | G |
| m200-d1441 | 1,394,211 | 129,572 | G | 1,465,363 | 201,961 | G |

Stalled: **s11 lane 1/9; dev 0/9**. The formal flag finds only one stalled lane member; FX4 must not invent two
under this definition. Any broader “low-growth” pair selection must be named separately when FX1 arrives.

| Member | Subway 2060 / gain / flag | Skip transit 2060 / gain / flag | Dev subway 2060 / gain / flag |
|---|---|---|---|
| control | 1,483,601 / 215,043 / G | 1,179,555 / 22,938 / S | 1,491,542 / 220,461 / G |
| p100-d1 | 1,499,653 / 224,763 / G | 1,247,398 / 87,578 / S | 1,384,807 / 111,089 / G |
| m100-d1 | 1,537,767 / 266,503 / G | 1,292,020 / 111,859 / G | 1,514,352 / 245,403 / G |
| p100-d1441 | 1,499,653 / 224,763 / G | 1,247,398 / 87,578 / S | 1,480,884 / 214,487 / G |
| m100-d1441 | 1,476,271 / 203,198 / G | 1,366,306 / 100,363 / G | 1,514,352 / 245,403 / G |
| p200-d1 | 1,497,147 / 226,978 / G | 1,229,823 / 65,052 / S | 1,552,165 / 272,798 / G |
| m200-d1 | 1,436,809 / 166,892 / G | 1,308,054 / 132,201 / G | 1,462,188 / 195,634 / G |
| p200-d1441 | 1,587,140 / 303,480 / G | 1,296,553 / 59,598 / S | 1,542,327 / 274,435 / G |
| m200-d1441 | 1,283,912 / 96,513 / S | 1,265,455 / 48,413 / S | 1,306,531 / 97,746 / S |

Stalled: **lane subway 1/9; skip transit 6/9; dev subway 1/9**.

### Work left and final-base reruns

**FX1/FX2 OPEN; FX4 WAIT for the user's FX1.** FX1 must provide per-member term/resCommute and dated
approval-gated actions; the monthly skip probe must establish the all-nine monthly median and weakest member.
FX2 must supply correctly smoothed per-member `approvalNetCommute` and the annual term median/band. FX5's
report-only endpoint/stall derivation above does not close those missing metrics.

After B2, T041 and all preceding SIM lanes merge, use that exact final dev for nine-member dev/lane no-flag
128×15 s7, 256×60 s7/s11, and nine-member lane subway/skip-transit plus dev subway on 256×60 s7. Collect monthly
commute on every skip member, the single-control stage census (with dev comparison), one isolated quiet-slot
timing pair and the 128 reference movement. Repeat FX4 there if s11 still misses. No extra members are allowed.
The lead sends final verdicts from those tables. FX5 starts no bots, tests, builds, browser, benchmark or timing run.

## FX3: fallback diagnostic (separate measure-only work)

**Measure only; six paired runs complete, no balance change.** The diagnostic uses archived source from measured T045 commit
`f8b3f145a379694adedb1e26bb825886d49282a2` (parent `59f7ce9`). Its hooks are inserted only into scratch copies of
that source. `tests/sim/transitFallbackObserver.ts` holds the standalone collector and
`tests/sim/transitFallbackObserver.test.ts` its fixtures; neither imports production simulation code. The collector
keeps traffic history, survey diagnostics and alternative approval histories outside `CityState`. No production or
infra hunk, RNG draw, bot decision or balance constant changes. It makes no diagnostic call to `stopAttached` or
`residentSurvey`. The entire archived `src/**` tree matches current HEAD. The archived bot retains T062's optional
funds-nudge branch, absent at HEAD; none of these controls enables it. Both captures use the same 84 original
module hashes, aggregate SHA `46cd8e8e354ae651673247018ce702731949b091383565e602c806b502753a80`.

The source mechanism is unchanged: traffic PREP fixes its origin list, while the city can change before FINAL2.
FINAL2 clears the commute raster and stamps only surviving selected origins. An omitted ID can retain an older
positive `commuteById` result while its raster is zero. Approval reads that raster and charges 25 minutes. The
observer records this condition rather than asking traffic to refresh an attachment or route.

The survey hooks observe the homes that approval actually samples, with their population and commute raster on
each sampling day. They follow the same accumulator through all 30 daily slices, its resets, and the selected
full-pass fallback if slices are incomplete. The selected survey is copied before its accumulator is cleared;
tourism's earlier monthly call and approval's reuse of that cached survey do not count it twice. The production
accumulator's population `W` and commuter-minute numerator `N` are authoritative. Checks compare the category
weights with `W`, the observed sample sum with `N`, and the calculated actual term with the recorded term. This
does not substitute a month-end home census, `stats.population`, or outage population for the survey's weights.

Traffic PREP and FINAL2 hooks copy primitive origin metadata and the last completed assignment's selected IDs.
A home enters the narrow **stale routed** category only if its latest selected result matched workers, was not
cut off, had positive minutes, still matches the prepared/current geometry and centre, and its ID is absent from
the last completed assignment when the survey samples its non-positive raster. A newer unmatched or cut-off
result replaces older valid history. New/unmeasured homes, selected-but-unmatched homes, cut-offs, disabled
traffic, geometry mismatches and other current zero results remain separate categories. Unmatched records
distinguish zero workers, no road entries, no assigned workers and non-positive result minutes. Examples retain
PREP/final/sample dates and weights, with at most three examples per category per survey.

Two external shadows quantify the term contribution on the **unchanged realised city path**. Let `E` be only the
stale-routed resident weight and `R` its retained-route commuter-minute sum. The carry shadow's mean is
`(N − 25E + R) / W`. The exclusion shadow's mean is `(N − 25E) / (W − E)`; if no weight remains, its diagnostic
commute term is zero. Neither shadow removes any other fallback category. Both apply the approved
`−0.25 × max(0, mean − 8)` after aggregation and retain the original `smoothstep(2000, 8000, W)` population fade.
The correction is signed: retained routes longer than 25 minutes can increase the shadow penalty. Each shadow
replaces only the commute term in the realised unclamped raw total, clamps that total to 0–100, then advances its
own approval EMA at the existing rate. Initialization snaps a fresh city's shadow to its raw target; a resumed
city keeps its saved EMA until subsequent monthly ticks. These values never feed approval, growth or the bot.

### Resident weight and approval contribution

These are **January checkpoints** (day 10800 and 14400), using approval's actual sliced-survey weight, not the
annual traffic mean or the city's end-of-day population. All fallback weight outside the narrow target in these
four surveys is **never observed routed**. Selected-but-unmatched, cut-off, disabled, geometry-mismatch and
current-zero categories each have zero weight here; the raw monthly files retain all categories and examples.

| s7 control / January | Survey weight W | All 25-minute fallback weight | Omitted routed E / sampled homes | E / W | Never observed routed |
|---|---:|---:|---:|---:|---:|
| Subway 2030 | 553,647 | 2,540 | 44 / 4 | 0.007947302% | 2,496 |
| Skip transit 2030 | 553,317 | 3,627 | 29 / 1 | 0.005241119% | 3,598 |
| Subway 2040 | 887,883 | 5,290 | 0 / 0 | 0% | 5,290 |
| Skip transit 2040 | 875,021 | 3,260 | 248 / 2 | 0.028342177% | 3,012 |

All four surveys have the full population fade, 1. Deltas below are **shadow minus actual**, in approval points.
Carry/exclude replace only E; the other 25-minute fallback weight remains charged. The term delta equals the raw
approval delta to rounding at these checkpoints, because none of these four changed totals hits the clamp.

| s7 control / January | Actual mean / term | Carry mean / term | Carry raw Δ / EMA Δ | Exclude mean / term | Exclude raw Δ / EMA Δ |
|---|---|---|---|---|---|
| Subway 2030 | 9.881743454 / −0.470435863 | 9.880416032 / −0.470104008 | +0.000331855 / +0.000253889 | 9.880541865 / −0.470135466 | +0.000300397 / +0.000268879 |
| Skip transit 2030 | 8.937546637 / −0.234386659 | 8.937048580 / −0.234262145 | +0.000124514 / +0.000079578 | 8.936704740 / −0.234176185 | +0.000210474 / +0.000108788 |
| Subway 2040 | 10.509131427 / −0.627282857 | 10.509131427 / −0.627282857 | 0 / +0.000076537 | 10.509131427 / −0.627282857 | 0 / +0.000076913 |
| Skip transit 2040 | 11.008914313 / −0.752228578 | 11.004142854 / −0.751035713 | +0.001192865 / +0.000401123 | 11.004947810 / −0.751236953 | +0.000991626 / +0.000352788 |

The subway's 2040 EMA delta persists from earlier months even though its current E is zero. Across **January–December
2030** (12 months, day 10800 through 11130), the totals below sum monthly survey weights; they are not counts of
distinct people. The ordinary even-sample median is the mean of the sixth and seventh sorted monthly terms.

| s7 control, 2030 | Sum W | Sum E / share | Never observed routed / share | Months E > 0 | Median actual / carry / exclude term |
|---|---:|---:|---:|---:|---|
| Subway | 6,814,654 | 51 / 0.000748387% | 32,224 / 0.472863332% | 2/12 | −0.463683378 / −0.463683378 / −0.463683378 |
| Skip transit | 6,804,442 | 29 / 0.000426192% | 30,400 / 0.446766980% | 1/12 | −0.256000001 / −0.256000001 / −0.256000001 |

Every actual and both shadow terms are negative in **all 12/12 months** in each control. In the skip control,
the actual terms range from **−0.292506947 to −0.230998858**. Thus this narrow fallback case does not create the
control's 2030 activation on the unchanged city path. This is **not** NOTE-062's median across nine skip members
each month and does not close that gate or establish its weakest member.

Over all 480 monthly surveys through 2040, the maximum E/W is **0.047669994%** in subway and **0.067456076%** in
skip transit. Maximum absolute carry-term deltas are **0.002446122 / 0.002243946** points respectively; maximum
absolute carry-EMA deltas are **0.000827202 / 0.000679436**. These bounds describe these controls only.

### What this establishes about the 2040 loss

The diagnostic controls end at **888,952 subway** and **877,353 skip transit**: **11,599 people, 1.304794860% loss**.
Plain and observed populations are equal. The campaign's separate nine-member medians remain 888,704 versus
875,976, **1.432198%**, as reported in FX5; these new controls do not replace them.

At January 2040 the observed approval gap is **0.842288458** points. The carry shadow narrows it by
**0.000324586** points; the exclusion shadow by **0.000275875**. These are fixed-path approval contributions,
**not a population-loss attribution**. The causal change in 2040 population loss from changing the fallback is
**UNKNOWN, not zero**: a changed approval can change approval-gated purchases, growth, RNG use and later city
paths. Small raw/EMA deltas alone cannot rule out such a fork. No changed-fallback simulation was run.

**Option for the lead, not implemented:** separately calibrate retaining a previous valid commute for this narrow
omitted-origin case, with explicit geometry/validity/lifetime rules; the carry shadow is its fixed-path signal.
Exclusion is a second diagnostic convention, not a proposed free-approval fix. Either production change would be
a calibration amendment and would need approval and the final-dev ensemble gates. For this round, **keep the
25-minute fallback unchanged**. FX4 still waits for T062's dated approval-gated-action log; these message hashes
and survey examples do not substitute for FX1 or identify the first differing purchase.

### Observation neutrality, tests and exact commands

All three plain/observed pairs have identical ordinary annual rows, normalized serialized-state hashes, simulation
and traffic RNG state, and cumulative bot-message SHA at **all 95 annual checkpoints** (15 + 40 + 40). Every pair
also has an identical final hash and message digest. CPU timing fields are omitted from the comparison; these
instrumented runs are not timing evidence. The message SHA covers `say` output, not a full approval-gated action log.

| Pair | Annual checks | Final population / residents | Normalized final state SHA-256 |
|---|---:|---|---|
| 128×15 s7, no flags | 15/15 | **193,844 [66507, 90953, 36384]** | `dc0ca8e04309ea12a4d4c26f09a549dd14d5c467a39411e347a604e5510e92ba` |
| 256×40 s7 subway | 40/40 | **888,952 [220254, 430916, 237782]** | `0e56b80ee92dbdf6c18f91b21462b93b57c6355cfcb6b9c33891afe4f7765af6` |
| 256×40 s7 subway, skip transit | 40/40 | **877,353 [205960, 431483, 239910]** | `de09301c27f6a9a719389da9636888bb0ae54b86ae5b2890ff2e9b2c082533a7` |

The 128×15 default reference remains **193,844 [66507, 90953, 36384]**. The compact paired assertions and numerical
reduction are `fx3/note062-v2/summary.json` under this lane's scratch folder; individual files retain every annual
checkpoint and all 180/480 monthly records. `capture.metadata.json`, `sourceSnapshot`, `instrumentedSource`,
`probe-source.mts` and `observer-source.ts` preserve the captured inputs. The archive SHA is
`228d421f69749230624ef12e3bfa85a00ed5ee890d461e09c9ebee713b722977`; the frozen collector SHA is
`e35481956beb52710da5317b8236a087571bb3a4ec5268771de32c3a29ccb6c8`.

| Check run this round | Result |
|---|---|
| `tests/sim/transitFallbackObserver.test.ts` | **12 passed**: stale eligibility, other fallback categories, newer failed/cut results, geometry, signed correction, sampled weights/reset/cache, clamp/EMA/resume, bounded examples and reconstruction guards |
| `tests/sim/difficultyRules.test.ts` | **32 passed**, including all eight old-save difficulty/disaster cases |
| `tests/sim/transitDevelopment.test.ts` | **19 passed** |
| `npx tsc --noEmit` | **PASS** |
| Paired JSON/state/RNG/message assertions | **95/95 annual checkpoints PASS** |

All bots and Vitest runs went through the quiet gate, with **one bot process at a time**. Native config loading
and the thread pool use the already established workaround for this sandbox's process-spawn restriction. Full
Vitest, browser/GPU checks and timing runs are left to the lead as instructed. Exact commands from the worktree:

```powershell
$taskRoot = 'C:/Users/techsin/Desktop/projects/simcityweb-T045'
$taskLane = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes'
$taskQuiet = "$taskLane/quietrun.mjs"
$taskScratch = "$taskLane/T045/scratch"

git archive --format=tar --output="$taskScratch/fx3-f8b3f14-source.tar" f8b3f145a379694adedb1e26bb825886d49282a2 src tools package.json tsconfig.json
node "$taskScratch/fx3-launch.mjs" --capture --name plain --revision note062-v2 --source-tar "$taskScratch/fx3-f8b3f14-source.tar" --source-commit f8b3f145a379694adedb1e26bb825886d49282a2 --expect-commute-start 8
node "$taskScratch/fx3-launch.mjs" --capture --name observed --revision note062-v2 --source-tar "$taskScratch/fx3-f8b3f14-source.tar" --source-commit f8b3f145a379694adedb1e26bb825886d49282a2 --expect-commute-start 8

node $taskQuiet node "$taskScratch/fx3-launch.mjs" --name plain --revision note062-v2 --size 128 --years 15 --seed 7 --out "$taskScratch/fx3/note062-v2/plain/s7-128.json"
node $taskQuiet node "$taskScratch/fx3-launch.mjs" --name observed --revision note062-v2 --size 128 --years 15 --seed 7 --out "$taskScratch/fx3/note062-v2/observed/s7-128.json"
node $taskQuiet node "$taskScratch/fx3-launch.mjs" --name plain --revision note062-v2 --size 256 --years 40 --seed 7 --subway --out "$taskScratch/fx3/note062-v2/plain/s7-256-subway.json"
node $taskQuiet node "$taskScratch/fx3-launch.mjs" --name observed --revision note062-v2 --size 256 --years 40 --seed 7 --subway --out "$taskScratch/fx3/note062-v2/observed/s7-256-subway.json"
node $taskQuiet node "$taskScratch/fx3-launch.mjs" --name plain --revision note062-v2 --size 256 --years 40 --seed 7 --subway --skip transit --out "$taskScratch/fx3/note062-v2/plain/s7-256-skip.json"
node $taskQuiet node "$taskScratch/fx3-launch.mjs" --name observed --revision note062-v2 --size 256 --years 40 --seed 7 --subway --skip transit --out "$taskScratch/fx3/note062-v2/observed/s7-256-skip.json"

node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/sim/transitFallbackObserver.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/fx3-observer-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/sim/difficultyRules.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/fx3-difficulty-rules-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/sim/transitDevelopment.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/fx3-transit-development-vitest.json"
node $taskQuiet npx tsc --noEmit
node "$taskScratch/fx3-summary.mjs" s7-128 s7-256-subway s7-256-skip
```

The launcher executes an immutable captured `SimBot` with the shown size/year/seed/strategy arguments; it is a
scratch probe, not a modified `tools/simbot.ts`. Existing output/capture paths deliberately refuse overwriting.
These are 40-year diagnostics for FX3's 2030/2040 question, not new 60-year acceptance runs. Final dev is not
ready while B2/T041 and the preceding SIM lanes are outstanding; the final ensemble, monthly nine-member gate,
stage census and isolated timing pair remain as listed in FX5.

### Current-round file and owner summary

- `tests/sim/transitFallbackObserver.ts`: new standalone diagnostic collector; no runtime import from the app.
- `tests/sim/transitFallbackObserver.test.ts`: new 12-case diagnostic validation file.
- `docs/dev/reports/local-T045-lg08-tod.md`: FX3 evidence and FX5's amended HOLD verdicts; historical records retained.
- **Infra hunks: none. Outside-owned production hunks: none. Cloud-held files: untouched; no new cloud request.**
  The existing B2 attachment-query/scheduler request and Worker retained-inspector-watch request remain with their
  owners. Transit stats' **“Riders save N minutes” waits for PB-COMMUTE**; Grand Central's definition stays with LG-02.
- **Decisions for the lead:** any fallback calibration is a separate option; D2 must explicitly sign the diagnosed
  early-year moves after FX4/final-dev repeat; settle NOTE-053's literal three-row year-60 versus 15/60/60 ambiguity.
  The s11 late regression remains LG-08's blocker, with no compensation or unrelated balance change here.

Browser checklist, left to the lead (no browser opened this round):

- [ ] Near-station Why term is +0.04 only for R$$, CO$$ and CO$$$, and follows connected stations/radius.
- [ ] Stage-5 inspector note reads through the host; connect/disconnect updates a retained inspector after its
      pending Worker invalidation fix, and realised stage-6+ station development is visible.
- [ ] An old save adopts the approved 8-minute term without a new grace mechanism; approval's EMA moves normally.
- [ ] Grand Central's eight-tile hook works once LG-02 supplies its definition; PB-COMMUTE owns the deferred stats line.

## Historical records below (superseded gate protocols)

The remaining single-run/A/A verdicts and the appended pre-NOTE-062 campaign judgement retain their historical
meaning only. FX5 above is the current disposition. Test results remain attributed to the round that ran them.

## Round 4: old-save difficulty regression

**Old saves adopt LG-08's current commute rule when the simulation initializes.** There is no new load-only grace
or grandfathered threshold. The existing resident-population grace still applies to commute on every difficulty;
Easy's crime and emergency fades remain separate difficulty rules. The base-row/fork-noise question stays with
the lead under NOTE-052; this round changes no production code or balance.

The failing fixture has one occupied R$$ home with **5,000 residents** and explicitly disables the traffic layer.
Its survey therefore uses **`COMMUTE_FALLBACK = 25` minutes**, rather than a measured commute cell:

```text
resident-weighted commute = 25 × 5000 / 5000 = 25 minutes
population grace = smoothstep(2000, 8000, 5000) = 0.5
commute term = −0.25 × max(0, 25 − 8) × 0.5 = −4.25 × 0.5 = −2.125
```

`deserializeCity` alone preserves the historical saved `commute: 0`. Constructing `Simulation` calls
`approvalSystem.init`, which surveys the loaded home and recomputes raw terms immediately using the current
constants. The fixture is a resumed city (day 45 with saved terms), so initialization keeps its saved approval
EMA **42.25**. At day 60, after the first 15 simulated days, and each following month, approval moves toward the
new raw total by `approval += (raw − approval) × APPROVAL.ema`, currently **0.3**. Immediate raw-term adoption does
not mean an immediate jump in the displayed approval. No save migration, new setting or additional grace is added.

`tests/sim/difficultyRules.test.ts` retains the historical fixture and derives only the expected commute term
from `APPROVAL`, `COMMUTE_FALLBACK`, the fixture's resident count and the existing grace constants. It does not
hard-code −2.125. New assertions pin the saved zero term, fallback survey and negative term after initialization.
The full term-object equality, exact raw sum, saved EMA, three monthly EMA updates, income, saved configuration /
disasters and untouched serialized payload checks remain. Both hunks stay entirely inside the old-save test
block; local dynamic imports avoid a separate import hunk, leaving T042's lines 62–80 untouched.

Round-4 checks ran one process at a time; every test and bot command passed through the quiet gate:

| Test file | Passed | Existing skipped |
|---|---:|---:|
| `tests/sim/difficultyRules.test.ts` | 32, including all eight old-save cases | 0 |
| `tests/sim/transitDevelopment.test.ts` | 19 | 0 |
| `tests/game/transitInspector.test.ts` | 2 | 0 |
| `tests/game/inspectorModel.test.ts` | 11 | 0 |
| `tests/game/inspectorNotes.test.ts` | 10 | 0 |
| `tests/worker/hygiene.test.ts` | 17 | 1 |

**91 passed, one existing W1.2 skip, zero failures.** `npx tsc --noEmit` passes. The fresh 128×15 s7 bot remains
**193,844**, residents **[66507, 90953, 36384]**. Its final normalized state hash is unchanged from round 3:
`dc0ca8e04309ea12a4d4c26f09a549dd14d5c467a39411e347a604e5510e92ba`.
The fresh capture contains the same 84 production modules, aggregate SHA256
`5e8c06796d9c95ae27133c60e44354cd11fd026fd0bd561fb0ee6549031aa884`, as the previous measured capture.
The 256×60 rows below were not rerun for this test-only correction and remain the prior evidence.

Actual commands, using the absolute `$taskRoot`, `$taskScratch` and `$taskQuiet` values defined below:

```powershell
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/sim/difficultyRules.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round4-difficulty-rules-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/sim/transitDevelopment.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round4-transit-development-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/game/transitInspector.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round4-transit-inspector-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/game/inspectorModel.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round4-inspector-model-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/game/inspectorNotes.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round4-inspector-notes-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/worker/hygiene.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round4-worker-hygiene-vitest.json"
npx tsc --noEmit
node "$taskScratch/round2-launch.mjs" --capture --name production --revision round4-oldsave --source-commit 7fbb0f437560f1cc6644aa422ad9ac07cd1c2ebc --expect-commute-start 8
node $taskQuiet node "$taskScratch/round2-launch.mjs" --name production --revision round4-oldsave --size 128 --years 15 --seed 7 --out "$taskScratch/round2/round4-oldsave/production/s7-128-base.json"
```

The last command's ordinary CLI equivalent is
`node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 128 --years 15 --seed 7`.
As before, tsx is unavailable here; the actual launcher uses the unchanged SimBot entry points with local
Rolldown. No infra or Worker hunk, cloud-held file change or new owner request is needed for round 4. Full Vitest
and browser checks remain with the lead. In the browser, verify that loading an old city shows current raw
commute pressure with the existing population grace, preserves the saved approval initially, and moves the EMA
on the following month ticks. Earlier owner requests and the broader browser checklist remain below.

## Historical Round 2: approved criteria and single-run evidence

NOTE-048 also introduces the shared SIM A/A rule. All three flags-off rows — 128×15 s7 and 256×60 s7/s11 — must
be compared with fresh dev in every year from year 10, within the maximum of the item's tolerance, 1% and that
row's A/A envelope. Population, mean air at homes, approval and I-HT share are retained in the annual evidence.
The report must investigate a same-direction shift above half the tolerance across all three rows, even if each
row is individually inside its band. Final lane gates must be remeasured after B2 and T041 merge, using the shared
envelope for that exact dev base.

NOTE-048 approves start **8 minutes at −0.25**, retaining the existing new-town grace. Its 2040 loss target changes
from 4% to **1%** because most individual bot commutes then are below 8.5 minutes: the sanctioned station/tower,
+0.04 appeal and commute mechanisms cannot reach 4% without strengthening unrelated balance and moving other
lanes' bases. The amended 1% is above the original roughly 0.7% loss. Radius, appeal, catalog, demand, growth
budget and lot fit remain unchanged. The 2060 loss target remains 10%; the skyline gate becomes tower share
≥2×city, with the tower-capable-type mean stage diagnostic only.

The authoritative fresh probe makes **no attachment/growth query during simulated days**. Monthly and annual
observations read existing fields; the stage census runs only after the final day. Its normalized serialized-state
hashes immediately before and after the final census are equal. Those hashes establish no immediate persisted
mutation; final-only placement also ensures that cache changes cannot affect this run's later scheduling.

| Fresh run, base `683d02b` | Population 2030 | 2040 | 2050 | 2060 | Final residents [$, $$, $$$] | System CPU ms/day |
|---|---:|---:|---:|---:|---|---:|
| Production, flags off | 554,269 | 889,302 | 1,278,055 | 1,520,331 | [425890, 734632, 359809] | 5.54806 |
| Fresh dev, flags off | 550,399 | 885,236 | 1,265,741 | 1,513,835 | [412608, 738176, 363051] | 5.05394 |
| Production 8/−0.25, `--subway` | 554,789 | 888,952 | 1,268,558 | 1,483,601 | [414550, 716757, 352294] | 5.374398148 |
| Fresh dev, `--subway` | 551,849 | 885,499 | 1,271,081 | 1,491,542 | [416853, 724509, 350180] | 5.583472222 |
| Production `--subway --skip transit` | 554,373 | 877,353 | 1,156,617 | 1,179,555 | [289184, 592462, 297909] | 5.231388889 |

| Fresh flags-off row | Dev final population | Production final population | Endpoint drift | Signed largest annual drift | First year outside ±1% | Outside / checked years | Result |
|---|---:|---:|---:|---|---:|---:|---|
| 128×15 s7 | 192,899 | 193,844 | +0.48989% | +1.34464% in 2012 | 2012 | 1 / 6 | **FAIL** |
| 256×60 s7 | 1,513,835 | 1,520,331 | +0.42911% | +1.92675% in 2010 | 2010 | 13 / 51 | **FAIL** |
| 256×60 s11 | 1,427,340 | 1,261,054 | −11.65006% | −12.29426% in 2052 | 2010 | 18 / 51 | **FAIL** |

| Flags-off s11 | 2030 | 2040 | 2050 | 2060 | Final residents [$, $$, $$$] | System CPU ms/day |
|---|---:|---:|---:|---:|---|---:|
| Production | 552,068 | 885,597 | 1,182,415 | 1,261,054 | [357957, 602952, 300145] | 5.11593 |
| Fresh dev | 551,235 | 888,193 | 1,272,103 | 1,427,340 | [388629, 696075, 342636] | 4.29514 |

Production subway artifact: `round2/final8neutral/production/s7-256-subway.json`; final SHA256
`ea62f775b9c26f8e2bf022a2655192cd3567d411751534a18188b4d4e3411b61`. Its complete final hash equals the separate
milestone-observer run, which also ended at 1,483,601. The earlier approved historical threshold-8 calibration
ended at 1,503,592 with a different observer schedule; those values must not be mixed into a fresh paired
population or timing comparison.
The fresh dev subway final hash is `61ddc095373a49b89e2854c6fa520ed14c5325ab9df2916d71cdaef9324c26fe`.
Production is **−0.5324%** versus this fresh same-strategy dev endpoint, passing the original year-60 population
floor. That endpoint result does not establish compliance with the separate annual flags-off rule, which fails
as shown above. The s11 flags-off final residents are production **[357957, 602952, 300145]** versus dev
**[388629, 696075, 342636]**. Its production/dev final hashes are respectively
`c32d49be830de57cfaeb9981e218b7393adb9e5c6e370f44c8339c3ac7353113` and
`1f002f447e8f1eb822b2478f5204cf4f6edf86765ce948f991f608b9a89ed7eb`.
The fresh skip-transit hash is `18d3320a3540c3d4820204f33bd15d62e9c192c63ff55d922194512588491625`, exactly equal
to the historical threshold-8 skip run. All three fresh completed transit/dev/skip runs have identical normalized
hashes before and after their final census.
The fresh dev flags-off s7 final hash is `e44ee52a8dcb4942b542a6feee1dc462789556c06c30a891f17752f0bf570ac6`,
matching this lane's historical flags-off dev hash. The fresh 128×15 pair ends at production
**[66507, 90953, 36384] = 193,844** versus dev **[61124, 93804, 37971] = 192,899**. The artifacts are
`round2/final8neutral/production/s7-128-base.json` and `dev/s7-128-base.json`; their hashes are respectively
`dc0ca8e04309ea12a4d4c26f09a549dd14d5c467a39411e347a604e5510e92ba` and
`fff071b3ed431644dda2f66fdfd32723afb162410f97e1b7723d026a3469f254`. The latter matches this lane's historical
128 dev digest. These are this lane's hash encoding; no equality with T062's separately encoded digests is claimed.
The completed production flags-off s7 artifact is `round2/final8neutral/production/s7-256-base.json`, hash
`3312f6e931392147ab4ed05dddaa4885bf9d8cda7270167c943c7eb322b9b04d`.

| Amended acceptance line | Fresh measurement/status |
|---|---|
| Transit loss ≥1% in 2040 | **(888,952 − 877,353) / 888,952 = 1.304794860% — PASS** |
| Transit loss ≥10% in 2060 | **(1,483,601 − 1,179,555) / 1,483,601 = 20.493785054% — PASS** |
| Subway year-60 population ≥0.99×dev | **0.994676× — PASS** |
| Shared annual flags-off base rule | all three rows exceed the measured ±1% band — **FAIL** |
| System ms/day rises by ≤3 | **−0.209074074 ms/day — PASS** in fresh same-strategy headless observation; strict G-MS same-city timing remains separate |
| Near-centre stage-6+ share ≥2×city in 2060 | **(45/130) / (661/8,925) = 4.673862446× — PASS** |
| Tower-capable DevType mean stage, diagnostic only | **near 4.851851852; city 4.136494433** |
| Skip-transit commute term non-zero from 2030 | **31/31 annual and 361/361 monthly checkpoints negative; 0 zeros — PASS** |
| Report the 128×15 seed-7 movement | **193,844**, residents **[66507, 90953, 36384]**: **+945 (+0.48989%)** versus dev |

The share census counts each catalog growable once, including lower-stage buildings whose DevType lacks a tower
definition. Distance is centre-to-centre Euclidean ≤6 from functional, connected train/subway stations. The
separate diagnostic mean includes every growable of a DevType with at least one stage-6+ catalog definition,
regardless of its present stage or density. These denominators implement NOTE-048 rather than silently changing
the population counted by the share gate.
Fresh dev's corresponding census is **4/72** near stations and **668/8,787** citywide. These are comparison
observations; the amended acceptance gate applies to the production station-area concentration.

### Annual base evidence and systematic shift

The following diagnostics accompany the failed population gate. Peak values are the largest **absolute** annual
production-minus-dev difference from 2010 onward; endpoint values retain their sign. Air uses `stats.avgAir`,
approval uses points, and I-HT share differences use percentage points with agriculture excluded.

| Flags-off row | Peak / endpoint population drift | Peak / endpoint air difference | Peak / endpoint approval difference | Peak / endpoint I-HT share difference |
|---|---|---|---|---|
| 128×15 s7 | 1.34464% / +0.48989% | 0.00260 / −0.00260 | 2.66124 / −2.66124 | 0 / 0 pp |
| 256×60 s7 | 1.92675% / +0.42911% | 0.01728 / −0.00753 | 5.09422 / −1.10389 | 3.21824 / −3.11594 pp |
| 256×60 s11 | 12.29426% / −11.65006% | 0.01695 / +0.00922 | 5.96307 / −4.46600 | 8.62901 / +5.52220 pp |

The three endpoints do not all move in one direction. The shared-year check nevertheless triggers in **every
year 2010–2013**: all three population shifts are positive and exceed half the 1% band. This requires investigation
under NOTE-048 and is not dismissed because the endpoints later differ in sign.

| Shared year | 128×15 s7 drift | 256×60 s7 drift | 256×60 s11 drift | All three >+0.5% |
|---|---:|---:|---:|---|
| 2010 | +0.64174% | +1.92675% | +1.18704% | yes |
| 2011 | +0.72823% | +1.89994% | +1.20351% | yes |
| 2012 | +1.34464% | +1.25653% | +2.08577% | yes |
| 2013 | +0.51526% | +1.27272% | +1.28754% | yes |

All six flags-off final censuses have **zero connected passenger stations**. The default bot's subway and late
venue placement are opt-in; station permission/appeal is inactive on these rows. The changed commute threshold
is active: in 2010 the production commute terms are **−0.18985 / −0.08310 / −0.19348** for the three rows, while
all dev terms are zero. At the 128-row peak in 2012, both terms are zero, showing why a later population difference
cannot be read as a linear response to that checkpoint's term. At s11's 2052 trough, production survey commute is
**12.46019** versus dev **11.28720**, with commute terms **−1.11505 / 0**. Approval changes demand/allowance and
subsequent existing seeded choices; no added RNG calls or default-bot strategy changes explain away the failure.

Full annual values, raw jobs by type, population extrema, monthly counts and provenance are retained in scratch
`round2/final8neutral/report/summary.json`, `summary.md` and `annualcomparison.csv`. The CSV contains all **108**
year-pairs (6 + 51 + 51); it is the full-precision evidence behind the rounded tables here. No A/A slack applies.

### Fresh annual skip-transit commute evidence

All **361/361** monthly checkpoints from January 2030 through the closing January 2060 snapshot are negative,
with no zeros. In 2030 the sliced survey ranges **8.92400–9.17003** and the term **−0.29251 to −0.23100**;
the full 2030–2060 monthly term range is **−1.17279 to −0.23100**. The annual values below are direct checkpoint
means, not the distribution of individual journeys cited in NOTE-048's 2040 amendment.

| Year | Traffic average, minutes | Resident survey, minutes | Commute term |
|---|---:|---:|---:|
| 2030 | 8.86915 | 8.93755 | −0.23439 |
| 2031 | 9.06154 | 9.06257 | −0.26564 |
| 2032 | 9.51407 | 9.44068 | −0.36017 |
| 2033 | 9.54403 | 9.59690 | −0.39922 |
| 2034 | 9.71681 | 9.80049 | −0.45012 |
| 2035 | 9.85049 | 9.79488 | −0.44872 |
| 2036 | 10.07024 | 10.30990 | −0.57748 |
| 2037 | 10.43037 | 10.41203 | −0.60301 |
| 2038 | 10.56797 | 10.72205 | −0.68051 |
| 2039 | 11.22998 | 11.12310 | −0.78077 |
| 2040 | 11.19289 | 11.00891 | −0.75223 |
| 2041 | 11.11249 | 11.03152 | −0.75788 |
| 2042 | 11.32530 | 11.31196 | −0.82799 |
| 2043 | 11.67747 | 11.77671 | −0.94418 |
| 2044 | 11.65460 | 11.66356 | −0.91589 |
| 2045 | 10.54526 | 11.55051 | −0.88763 |
| 2046 | 11.93421 | 11.95902 | −0.98975 |
| 2047 | 10.68276 | 11.58656 | −0.89664 |
| 2048 | 11.86320 | 12.32366 | −1.08091 |
| 2049 | 12.03264 | 11.78573 | −0.94643 |
| 2050 | 11.49752 | 11.29888 | −0.82472 |
| 2051 | 12.08231 | 11.61008 | −0.90252 |
| 2052 | 11.54023 | 11.75200 | −0.93800 |
| 2053 | 12.41964 | 12.08745 | −1.02186 |
| 2054 | 12.52481 | 11.75668 | −0.93917 |
| 2055 | 11.42366 | 11.54539 | −0.88635 |
| 2056 | 11.96097 | 12.25782 | −1.06446 |
| 2057 | 12.22024 | 12.36277 | −1.09069 |
| 2058 | 11.63509 | 11.88032 | −0.97008 |
| 2059 | 11.93211 | 12.07860 | −1.01965 |
| 2060 | 12.03599 | 12.34299 | −1.08575 |

### Why the historical calibration is separate

All **84 imported production modules are byte-identical** between the historical approved start-8 capture and
the fresh start-8 capture (`source-comparison.json` in scratch). The sim/core/save/bot and asset/manifest git diffs
from `6e62a61` to current HEAD are also empty. The diagnostic call schedule changed: the historical probe queried
station/growth state every year from 2020, while the first round-2 probe used milestones; the authoritative fresh
probe uses only a final census.

A pre-existing query/scheduler dependency explains why a cache read can affect future simulation work without an
immediate CityState write. `TrafficSystem.stopAttached` calls `refreshAttach`, which clears `attachDirty`.
`TrafficSystem.stepCost` adds `0.3 × size² / 65536` estimated milliseconds to PREP while that flag is dirty. The
headless scheduler uses this estimate for budget admission, priority credit and next-day carry. An external query
can therefore remove 0.3 estimated ms at size 256 (0.075 at 128) before scheduling. Terrain, transport and network
edits set the flag again. This is a verified source-level mechanism; an exact first-divergence replay has not been
performed. The identical fresh milestone/final-only outcome is recorded, without claiming all query schedules
are neutral or attributing the historical difference to newly added RNG calls.

**B2/cloud request, no local infra hunk:** in `src/sim/infra/traffic.ts`, `stopAttached`/`refreshAttach`/`stepCost`,
separate attachment-query cache freshness from estimated scheduler work accounting. In
`src/sim/infra/scheduler.ts`, preserve budget/credit/carry choices when a read-only attachment query occurs.
Add a paired replay with identical edits and different query frequencies, checking subsequent state and scheduled
work. A matching immediate serialized hash alone cannot detect this runtime-cache dependency. This lane changes
neither file.

The historical **1.2448%** threshold-8 cost relative to the recovered start-15 control remains the explicit evidence
approved in NOTE-048. It is not a newly measured cost against the fresh 1,483,601 result: no fresh final-only
start-15 counterfactual has yet been run. The historical rejected −0.125 sensitivity trial is retained below;
there is no new tuning sweep.

### Fresh commands and outstanding verification

The absolute `$taskRoot`, `$taskScratch` and `$taskQuiet` variables are defined in the historical command section
below. These are all **nine completed** authoritative commands; every bot process ran sequentially through the
quiet gate:

```powershell
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name production --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round2/final8neutral/production/s7-256-subway.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name dev --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round2/final8neutral/dev/s7-256-subway.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name production --size 256 --years 60 --seed 7 --subway --skip transit --out "$taskScratch/round2/final8neutral/production/s7-256-skip-transit.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name production --size 256 --years 60 --seed 7 --out "$taskScratch/round2/final8neutral/production/s7-256-base.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name dev --size 256 --years 60 --seed 7 --out "$taskScratch/round2/final8neutral/dev/s7-256-base.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name production --size 128 --years 15 --seed 7 --out "$taskScratch/round2/final8neutral/production/s7-128-base.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name dev --size 128 --years 15 --seed 7 --out "$taskScratch/round2/final8neutral/dev/s7-128-base.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name production --size 256 --years 60 --seed 11 --out "$taskScratch/round2/final8neutral/production/s11-256-base.json"
node $taskQuiet node "$taskScratch/round2-launch.mjs" --revision final8neutral --name dev --size 256 --years 60 --seed 11 --out "$taskScratch/round2/final8neutral/dev/s11-256-base.json"
```

Fresh dev is captured from an archive of `683d02b`; production is an immutable capture of the worktree. Neither
uses a temporary production switch or changes another worktree. `npx tsx` remains unavailable in this environment;
the launcher bundles unchanged SimBot entry points with installed rolldown. Each capture records all 84 imported
source files, their hashes, bundle hash, source archive/PAX commit or worktree base, and simulation options.
The equivalent ordinary simbot arguments below apply to **both source captures** for each paired base/subway
configuration; skip transit applies to production only. They are equivalences, not executed tsx commands or a
request to switch this worktree:

```powershell
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 128 --years 15 --seed 7 --difficulty medium --terrain plains --water 0.2 --quiet
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 256 --years 60 --seed 7 --difficulty medium --terrain plains --water 0.2 --quiet
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 256 --years 60 --seed 11 --difficulty medium --terrain plains --water 0.2 --quiet
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 256 --years 60 --seed 7 --difficulty medium --terrain plains --water 0.2 --quiet --subway
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 256 --years 60 --seed 7 --difficulty medium --terrain plains --water 0.2 --quiet --subway --skip transit
```

Round-2 `npx tsc --noEmit` passes. Ordinary Vitest config loading failed with `spawn EPERM`, but the installed
native loader and thread pool resolve that startup issue. Each file below was run separately through the quiet
gate: **59 passed, 1 pre-existing skip, 0 failures across five files**.

| Test file | Passed | Existing skipped |
|---|---:|---:|
| `tests/sim/transitDevelopment.test.ts` | 19 | 0 |
| `tests/game/transitInspector.test.ts` | 2 | 0 |
| `tests/game/inspectorModel.test.ts` | 11 | 0 |
| `tests/game/inspectorNotes.test.ts` | 10 | 0 |
| `tests/worker/hygiene.test.ts` | 17 | 1 |

The existing hygiene skip is **“worker migration hygiene gates W1.2: simWorker import graph excludes bundle.ts,
save/index.ts and recoveryLs.ts”**; T045 does not add or hide a skipped case.

Actual commands:

```powershell
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/sim/transitDevelopment.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round2/transit-development-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/game/transitInspector.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round2/transit-inspector-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/game/inspectorModel.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round2/inspector-model-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/game/inspectorNotes.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round2/inspector-notes-vitest.json"
node $taskQuiet node --experimental-strip-types "$taskRoot/node_modules/vitest/vitest.mjs" run tests/worker/hygiene.test.ts --maxWorkers=1 --configLoader native --pool threads --reporter=json --outputFile="$taskScratch/round2/worker-hygiene-vitest.json"
```

The filesystem audit (`round2/final8neutral/final-audit.json`) passes: all 84 current production modules still
match the capture byte-for-byte; all nine runs have the expected options/day counts, one final census and equal
before/after-census state hashes; all changed files/new tests are valid UTF-8 without BOM. No full suite, browser
or GPU run is performed here. G-STEP estimated-step, G-AB abandonment and strict same-city G-MS checks remain for
the lead; evolving-city bot CPU alone does not establish them. The earlier scratch assertion adapters also passed
19 sim + 2 inspector cases, but the real Vitest results above supersede that fallback for validation.

The completed [shared A/A report at T062 commit
`3833c8d2379d3350663e624fe30be7867c559310`](https://github.com/techsin/simcityweb/blob/3833c8d2379d3350663e624fe30be7867c559310/docs/dev/reports/sim-aa-envelope.md)
is now available from both cached T062 refs and has been read in full. It measures underlying commit
`0df76bce1a663ee44957cf47cfecdb8b18eed187`, a queue-only commit atop `9fcc2ec`; its task's `683d02b` label was stale.
A read-only git diff from `683d02b` to that underlying commit is empty across `src/sim`, `src/core`, `src/assets`
and `tools/simbot.ts`, proving compatibility of the simulation sources used for this comparison.

| Shared A/A row | Population envelope | Air envelope | Approval envelope | I-HT share envelope | Base final population |
|---|---:|---:|---:|---:|---:|
| 128×15 s7 | 0 | 0 | 0 | 0 | 192,899 |
| 256×60 s7 | 0 | 0 | 0 | 0 | 1,513,835 |
| 256×60 s11 | 0 | 0 | 0 | 0 | 1,427,340 |

All twelve absolute and relative envelopes are **exactly zero** over completed years 10 onward. The nudged run
has exactly §1 more funds in every annual observation, so the perturbation was applied. This measured +§1 result
does not estimate the noise of a larger perturbation. The current population band is therefore **±1% in every
year from year 10**, and the zero envelope supplies no variant-target forgiveness. Final envelopes/gates still
require remeasurement on the post-T041 base.

For compatibility with the shared report, I-HT share is `jobsByDev[11] / sum(jobsByDev[9..11])`, excluding
agriculture, or zero with no such industrial jobs. The fresh probe retains raw `jobsByDev`; its convenience
`ihtShare` field includes agriculture. The comparison reader recomputes the canonical share from those raw job
arrays and does not use the convenience field; no simulation rerun was needed for this diagnostic correction.

## Changes and ownership

- `src/sim/economy/growth.ts`: connected passenger stations create tower lots within an inclusive Euclidean radius
  of 6 cells from `centerCell`. Existing downtown/hash eligibility remains. `stationLotMask` is the pure geometry
  function; `stationTowerLots` caches its result by traffic identity/graph version and station/network edits.
  Discovery uses existing `TRAFFIC_OF_STATE`, `stopAttached`, `infoOf` and `isFunctional`; unrelated growable
  updates do not rebuild the mask. `GrowthLimits.stationTower` exposes eligibility through existing inspection
  queries. An 8-cell Grand Central hook uses model `lm_grand_central`.
- `src/sim/economy/desirability.ts`: the shared mask adds exactly +0.04 to R$$, CO$$ and CO$$$ before clamping,
  for zoned and unzoned evaluation. The breakdown registers `station` / “Near a station”. Overlaps do not stack;
  other DevTypes retain their weights. The existing 33 weighted inputs remain, with the flat bonus as an auxiliary
  input.
- `src/sim/economy/tuning.ts`: `TOD` constants beside downtown tuning; NOTE-048's approved
  `APPROVAL.commuteStart = 8`, retaining the existing −0.25-per-minute coefficient. Recovery previously used 15;
  radius/appeal and the other constants are unchanged.
- **Outside the task's named production files:** `src/sim/economy/approval.ts`, `approvalSystem`'s update. The WIP
  replaced the literal threshold with `APPROVAL.commuteStart` and made an empty resident survey cost zero. Recovery
  adds one assignment, `T.commute *= fadeIn`, immediately after the existing surveyed-resident 2k→8k smoothstep.
  This applies existing new-town grace to commute approval and leaves measured values, including genuine cut-off
  journeys, intact. It is not a difficulty-specific rule.
- `tests/sim/transitDevelopment.test.ts`: **19 cases** covering exact radii, edge clipping and union, train partners
  and map-edge links, subway attachment and immediate cuts, station completion/burn/abandonment/removal,
  same-centre mode changes, cache reuse, excluded modes/missing traffic, save reconstruction, query/RNG side effects,
  tower caps, all affected DevTypes, pre-clamp appeal, Medium/Hard commute grace, the resident-weighted threshold
  and genuine measured 25/120-minute journeys.
- **Inspector hunk, newly authorized by NOTE-048:** `src/ui/inspectorModel.ts`, `growthRows`, now belongs to T045;
  its isolated hint change and `tests/game/transitInspector.test.ts` are complete. The test covers the packet-host
  fresh-query path as well as the row text; no new query or Worker field is introduced. Retained-watch invalidation
  after a remote command while paused is a separate pre-existing Worker limitation, requested below.
- `docs/dev/POLISH_BACKLOG.md`: a CONTENT/SIM follow-up for the R$ station-area permission/realization gap,
  without changing catalog, demand, allowance or fit mechanics in LG-08. Grand Central remains LG-02.
- This report is the requested artifact. Diagnostic launchers, immutable bundles, source snapshots and output
  remain in the user-designated scratch folder.

**Infra hunks: none. No B2 hunk hold; the query/scheduler request above is for its owner.** The inspector hunk is
explicitly reassigned by NOTE-048; no other cloud-held file is changed. No new persisted keys/settings or added RNG calls. Old saves
reconstruct the derived station mask. The station rules and commute threshold intentionally change balance on all
difficulties; this report does not claim Medium/Hard state identity after an intentional balance change.

## Historical Round 1 recovery evidence

Everything from this section through the historical command log records the earlier `fb1531f` calibration with
yearly stage queries. “Current” in those historical tables means the then-current start-15 recovery, not the
approved round-2 production threshold. These results explain the approved decision and rejected alternative;
the fresh matrix above governs the current gates.

Three independent ablations kept the other two features off. Every run is 256×60, seed 7, with `--subway`.
Station masks remain available even when station tower eligibility is disabled.

| Variant | Tower rule | Appeal bonus | Commute start | Population 2030 | 2040 | 2050 | 2060 |
|---|---|---|---|---:|---:|---:|---:|
| Towers only | on | 0 | 30 | 552,882 | 891,848 | 1,278,198 | 1,499,585 |
| Desirability only | off | +0.04 | 30 | 551,265 | 885,867 | 1,265,205 | 1,501,196 |
| Commute only, no grace | off | 0 | 15 | 554,560 | 888,432 | 1,272,993 | 1,402,785 |
| TOD-only control | on | +0.04 | 30 | 551,497 | 885,026 | 1,271,437 | 1,522,545 |
| Current: full TOD plus grace | on | +0.04 | 15 | 551,497 | 885,026 | 1,271,437 | 1,522,545 |

The original full WIP without recovery grace ended at **1,387,188**. The independent ablations isolate the early
commute-approval change before attributing that late loss to tower eligibility or appeal.

The residential target factor in `demand.ts:285` is `1 + APPROVAL_R * (approval - 50) / 50`, with
`APPROVAL_R = 0.06`. A small approval change therefore has a small direct target effect. It can nevertheless
change subsequent growth demand, allowance and candidate eligibility, and lead existing seeded choices down a
different path. The observed late ablation loss is not a linear population response to two early approval terms.
There are no added RNG calls; this does not promise the same sequence of existing calls after branching changes.

The no-grace commute-only run records exactly two negative observations in its first 36 monthly observations:

| Day | Current residents | Traffic average, minutes | Sliced resident-survey commute | Commute term |
|---|---:|---:|---:|---:|
| 30 | 82 | 31.86877 | 25 | −2.5 |
| 60 | 438 | 11.94665 | 19.56633 | −1.14158 |

Unmeasured occupied homes contribute the existing 25-minute fallback to the resident survey. Its monthly slices
also differ from a fresh current-population sample: at day 30 there are 23 measured and 59 unmeasured residents;
at day 60, 266 measured and 172 unmeasured. Displayed population is not the exact sliced survey weight.
Recovery retains real measured commutes and changes only the population grace applied to approval. The recovered
transit and skip-transit runs record no negative term in their first 36 monthly observations.

Full TOD with the 15-minute threshold plus grace and the old-30-minute TOD-only control finish with the same
normalized serialized-city SHA256:

`53326669e4da0222f38e4c5b6b12e2908f7db9e4449aadc0ccff26bc2aa7a353`

The digest uses `serializeCity(copy: true)`, `savedAt = 0`, sorted object keys and tagged raw typed-array bytes,
in separate simulation processes. This establishes equality of their persisted final city; it does not claim that
every intermediate state was hashed or that either final city equals dev's full saved state.

## Historical Round 1 gate matrix

These are fresh runs of the current 15-minute-plus-grace implementation. The flags-off run also matches the
recorded b3 population counts; no fresh dev flags-off full-state comparison was performed.

| Run | Population 2030 | 2040 | 2050 | 2060 | Final residents [$, $$, $$$] | System CPU ms/day |
|---|---:|---:|---:|---:|---|---:|
| Default, flags off | 550,399 | 885,236 | 1,265,741 | 1,513,835 | [412608, 738176, 363051] | not used for timing comparison |
| `--subway` | 551,497 | 885,026 | 1,271,437 | 1,522,545 | [413270, 744567, 364708] | 6.05245 |
| `--subway --skip transit` | 554,294 | 884,648 | 1,256,629 | 1,423,887 | [413630, 677412, 332845] | 6.79074 |

The fresh pre-edit dev `--subway` reference is **1,491,542** in 2060, residents
**[416853, 724509, 350180]**, at **5.52227 system CPU ms/day**. The recovered transit run is **+2.07859%** against
that same-strategy population reference.

| Acceptance line | Current measurement | Result |
|---|---|---|
| Skip transit costs ≥4% of people in 2040 | (885,026 − 884,648) / 885,026 = **0.0427106%** | FAIL |
| Skip transit costs ≥10% in 2060 | (1,522,545 − 1,423,887) / 1,522,545 = **6.47981%** | FAIL |
| Base year-60 population ≥0.99×dev | **1.0207859×** fresh dev `--subway`; also above b3 flags-off floor 1,498,697 | PASS |
| Mean system ms/day rises by ≤3 | **+0.53019 ms/day** against fresh same-strategy dev | PASS, single-run headless observation |
| Near-station mean stage ≥1.5×city | **4.34247 / 4.0524 = 1.07158×** in 2060 | FAIL |
| Skip-transit commute term non-zero from 2030 | **0 in every recorded monthly checkpoint**, 2030 through the closing January 2060 snapshot | FAIL |
| Report the 128×15 seed-7 change | **[61124, 93804, 37971] = 192,899**, exactly the supplied resident counts | Restored |

The restored 128×15 artifact is `round1-candidate-fade15/final-128x15-s7.json` (digest prefix `fff071…`). Matching
resident counts do not establish full saved-state identity with dev. The fresh flags-off 256×60 final digest is
`e44ee52a8dcb4942b542a6feee1dc462789556c06c30a891f17752f0bf570ac6`; the recovered skip-transit digest is
`2759287d0add0eb63c742fe7783476f91cee329217808284502ea279f092e741`.

### Skyline checkpoints

Each catalog growable is counted once. Acceptance distance is Euclidean ≤6 between station and building
`centerCell`, using functional, attached train/subway stations. Actual growth eligibility is evaluated at
`lotCell`, the front-middle cell, so both interpretations are recorded.

| Year | Connected stations | City mean stage | Mean within 6 centre-cell tiles | Ratio | Near buildings | Near stage 6+ |
|---|---:|---:|---:|---:|---:|---:|
| 2030 | 10 | 3.10386 | 3.50588 | 1.12952× | 85 | 1 |
| 2040 | 10 | 3.51262 | 3.65060 | 1.03928× | 83 | 3 |
| 2050 | 10 | 3.93423 | 4.00000 | 1.01672× | 75 | 9 |
| 2060 | 10 | 4.05240 | 4.34247 | 1.07158× | 73 | 23 |

At 2060 all 73 near-centre lots are high density. Their stage-1…8 histogram is **[0, 0, 26, 21, 3, 21, 2, 0]**;
the city's is **[21, 105, 1923, 4868, 1195, 596, 90, 0]**. Derived growth limits permit stage ≥6 on **62/73** near
lots, including **52** with an effective stage-8 cap. **65** near buildings have front cells newly opened by the
station rule relative to the original downtown hash. This is permission, not proof of sufficient demand,
banked growth allowance, catalog capacity gain or a fitting footprint. The front-mask ratio is **1.06604×**;
the functional-only centre-distance ratio is **1.07131×**, so these counting choices do not resolve the miss.

The recovered bot's frozen subway route has 10 connected stations, versus 25 in the original full WIP. Early
approval changes can therefore change subsequent route/layout choices without added RNG calls. Its station mask
covers **684 cells**, with **321** high-density cells in 2030 and **319** in 2060, a small part of the 256×256 map.
The completed actual rejection counters below distinguish permission from selection and fit. Counter timing is
excluded from acceptance timing.

The 2060 near-centre breakdown also shows why a permissive stage cap overstates realizable tower opportunity:

| DevType | Near buildings | Actual stage 6+ | Effective cap ≥6 | First catalog tower: stage / capacity |
|---|---:|---:|---:|---|
| R$ | 35 | 5 | 35 | 6 / 800 |
| R$$ | 4 | 1 | 2 | 6 / 1,100 |
| R$$$ | 11 | 8 | 9 | 6 / 1,300 |
| CS$ | 13 | 0 | 7 | none |
| CS$$ | 2 | 1 | 1 | 6 / 700 |
| CS$$$ | 1 | 1 | 1 | 7 / 1,200 |
| CO$$ | 3 | 3 | 3 | 6 / 1,400 |
| CO$$$ | 4 | 4 | 4 | 6 / 1,600 |

There is no industry in this near-station sample. All catalog towers require high density; CS$, I-A, I-D and I-M
have no stage-6+ definitions at all, while CS$$$ first gets one at stage 7. In particular, 13/73 near buildings are
CS$ shops, all actually stage 3. All seven offices are stage 6. R$ has the largest permission/realization gap: all
35 permit stage ≥6, but only five have reached it. The late counters show why selection, rather than R$ geometry
once selected, is the main measured restriction. No local tower quota was added: station-mask eligibility returns
true while retaining every original downtown tower right. The actual tower fraction is **23/73 = 31.50685%** near
stations versus **686/8,798 = 7.79723%** citywide, an observed concentration despite the mean-stage gate miss.

### Actual growth selection and rejection counters

A separate immutable diagnostic injected scalar counters into the existing growth branches, without extra RNG
calls, repeated geometry calls or extra candidate walks. “Near” below means the existing station mask at the
actual front `lotCell`. Early redevelopment guards occur before that existing coordinate calculation and are not
silently assigned to the near subset. The denominators differ: **front attempts** are calls surviving those early
guards; **catalog definitions** are entries visited in the existing candidate loop; **selected definitions** can
have several attempted origins; **origins** are individual positions checked. These quantities must not be added
as if they were the same attempts.

| Near-front redevelopment period | Front attempts | No DevType picked | Stage blocks | Tower definitions selected | Selected definitions exhausted | Tower successes |
|---|---:|---:|---:|---:|---:|---:|
| 2021–2030 | 2,784 | 692 | 219 | 54 | 53 | 1 |
| 2031–2040 | 3,922 | 1,003 | 298 | 247 | 245 | 2 |
| 2041–2050 | 3,602 | 559 | 411 | 418 | 411 | 7 |
| 2051–2060 | 3,465 | 1,098 | 386 | 445 | 431 | 14 |

Tower catalog filters count stage-6+ definitions, using the original first-failing precedence: stage range,
maximum affordable capacity (`capMax`), then minimum capacity gain (`capMin`). They include repeated visits across
different actual front attempts; accepted definitions are not automatically selected or fitted.

| Period | Tower definitions considered | Rejected stage | Rejected `capMax` | Rejected minimum gain | Accepted definitions |
|---|---:|---:|---:|---:|---:|
| 2021–2030 | 4,471 | 614 | 3,789 | 13 | 55 |
| 2031–2040 | 6,369 | 745 | 5,355 | 22 | 247 |
| 2041–2050 | 6,318 | 584 | 5,240 | 76 | 418 |
| 2051–2060 | 4,392 | 701 | 3,105 | 141 | 445 |

In 2051–2060, the 445 selected near-front tower redevelopments tried **1,459 origins**: **986** first failed the
combined zone/network/water/power-line cell check, **414** met an occupant of the same or higher stage, **45**
failed aggregate replacement-capacity gain, and **14** succeeded. Those counts sum to 1,459; no other origin
failure reason occurred in this late subset.

Residential totals combine new growth and redevelopment. The no-allowance/eligible columns count **DevType visits
inside the existing picker**, while `capMax` counts **catalog definitions**, and selected/success counts **tower picks**.

| Near-front R checks, 2051–2060 | Picker: no allowance | Picker: eligible | Tower definitions rejected `capMax` | Tower picks | Tower successes |
|---|---:|---:|---:|---:|---:|
| R$ | 1,700 | 727 | 791 | 5 | 5 |
| R$$ | 1,689 | 738 | 1,233 | 0 | 0 |
| R$$$ | 1,802 | 602 | 826 | 6 | 5 |

R$$$ also recorded 23 low-desirability picker visits. All five selected late R$ towers fitted; none was lost to
physical fit. Its measured bottleneck is demand/allowance and the affordability filter before selection. Most of
the aggregate selected-tower fit failures are commercial. This does not make the global bank a single pool: each
DevType has its own demand and allowance.

Across the whole city in 2051–2060, capacity spending was **52,991 new / 367,905 redevelopment**, or **87.41%**
redevelopment. Near stations it was **592 new / 10,438 redevelopment**, or **94.6328%** redevelopment. These are
growth capacity units, not resident counts. The measurements do **not** support the blanket claim that empty-lot
growth starves late upgrades; they show the actual residential filters and the separate commercial fit problem.

The counter run finishes at **1,522,545**, residents **[413270, 744567, 364708]**, with the same normalized final
hash `53326669e4da0222f38e4c5b6b12e2908f7db9e4449aadc0ccff26bc2aa7a353` in a **third independent process**.
That observed state equality validates the counter run against the retained candidate. All **721 recorded
snapshots** over the full run have commute term **0**; maximum sliced survey commute is the early fallback **25**,
suppressed by grace. This closes the earlier 2003–2029 monthly-capture gap. Counter CPU is excluded from timing.
Evidence: `growth-counters/fade15-final/run.json`, `summary.txt` and `compact.json` in scratch; the capture metadata
also records exact source anchors and source hashes.

### Annual skip-transit commute evidence

Each cell is **traffic average / sliced resident survey / commute approval term**. “WIP” is committed WIP
`731fffa` without recovery grace; “current” is the recovered 15-minute implementation. These are the 31 annual
checkpoints from `round1-v2/recovery-evidence.md`.

| Year | WIP skip transit | Current skip transit |
|---|---|---|
| 2030 | 9.58274 / 9.55266 / 0 | 8.30046 / 8.32415 / 0 |
| 2031 | 9.67434 / 9.86951 / 0 | 8.50779 / 8.50023 / 0 |
| 2032 | 9.96565 / 9.94948 / 0 | 8.52211 / 8.58234 / 0 |
| 2033 | 10.16574 / 10.18616 / 0 | 8.82044 / 8.77349 / 0 |
| 2034 | 10.09806 / 10.34868 / 0 | 8.92894 / 8.87295 / 0 |
| 2035 | 10.53658 / 10.65852 / 0 | 9.01438 / 9.12921 / 0 |
| 2036 | 10.86632 / 10.76637 / 0 | 9.64267 / 9.45629 / 0 |
| 2037 | 11.00435 / 11.21214 / 0 | 9.80186 / 9.66361 / 0 |
| 2038 | 11.45847 / 11.34403 / 0 | 9.84718 / 9.91127 / 0 |
| 2039 | 12.06874 / 11.64853 / 0 | 10.08736 / 10.23392 / 0 |
| 2040 | 11.80291 / 11.75828 / 0 | 9.95576 / 10.23703 / 0 |
| 2041 | 11.09028 / 11.50815 / 0 | 10.38936 / 10.48988 / 0 |
| 2042 | 12.04907 / 12.48725 / 0 | 10.85845 / 10.80302 / 0 |
| 2043 | 12.61813 / 12.03988 / 0 | 10.91336 / 10.80204 / 0 |
| 2044 | 11.52735 / 11.99935 / 0 | 11.21985 / 11.07096 / 0 |
| 2045 | 12.38589 / 12.79783 / 0 | 10.75310 / 10.91522 / 0 |
| 2046 | 12.02578 / 12.47173 / 0 | 10.81247 / 10.98004 / 0 |
| 2047 | 13.05907 / 13.22955 / 0 | 11.00142 / 10.86369 / 0 |
| 2048 | 12.13244 / 12.53491 / 0 | 10.05002 / 10.25241 / 0 |
| 2049 | 12.46930 / 12.77898 / 0 | 10.25823 / 10.32766 / 0 |
| 2050 | 11.58954 / 12.20817 / 0 | 10.76139 / 10.43124 / 0 |
| 2051 | 12.33552 / 12.38225 / 0 | 10.47866 / 10.52334 / 0 |
| 2052 | 12.20557 / 12.69638 / 0 | 10.74671 / 10.88333 / 0 |
| 2053 | 13.74807 / 12.44525 / 0 | 10.65566 / 10.83331 / 0 |
| 2054 | 12.13921 / 12.19036 / 0 | 11.02603 / 11.44005 / 0 |
| 2055 | 12.15988 / 12.25002 / 0 | 10.96008 / 11.08160 / 0 |
| 2056 | 12.61830 / 12.57523 / 0 | 10.74649 / 11.01107 / 0 |
| 2057 | 12.43510 / 12.91544 / 0 | 10.52463 / 10.84697 / 0 |
| 2058 | 13.06632 / 13.12875 / 0 | 11.15800 / 11.29923 / 0 |
| 2059 | 12.95618 / 13.17855 / 0 | 10.73989 / 10.77699 / 0 |
| 2060 | 12.26061 / 12.31903 / 0 | 10.53620 / 11.00728 / 0 |

Monthly capture confirms zero terms at all **361** recorded current skip-transit checkpoints from January 2030
through January 2060. In 2030 the resident survey ranges **8.32415–8.45724** minutes; the transit run's annual
2030 survey is **10.17102**, higher than skip transit. Threshold 15 cannot activate on these values. Thresholds
10 and 9.5 would not activate the recovered 2030 skip-transit case either.

## Historical threshold-8 proposal, original coefficient

This was a scratch-only proposal, subsequently approved by NOTE-048: full TOD, existing 2k→8k grace, start
**8 minutes**, coefficient **−0.25**. Production was then at start 15. Eight is the nearest whole-minute start below the recovered skip-transit 2030
survey mean 8.32415; this is not a claim of a globally minimal balance change.

| Year | Proposal `--subway` population | Proposal skip population | Skip commute approval term |
|---|---:|---:|---:|
| 2030 | 554,789 | 554,373 | −0.234386659 |
| 2040 | 888,965 | 877,353 | −0.752228578 |
| 2050 | 1,272,635 | 1,156,617 | −0.824719416 |
| 2060 | 1,503,592 | 1,179,555 | −1.085747221 |

Final transit residents are **[418450, 729932, 355210]**; skip residents are **[289184, 592462, 297909]**.
The transit result is **+0.807889%** versus fresh dev subway, but **−1.2448%** versus the retained-15 recovery
base 1,522,545: it is not literally neutral. Its system CPU is **7.51023 ms/day**, about **+1.98796** versus fresh
dev, within the +3 headless limit in this observation. Skip CPU is **6.64227 ms/day**.

| Acceptance line | Threshold 8 / coefficient −0.25 | Result |
|---|---|---|
| 2040 transit population loss ≥4% | (888,965 − 877,353) / 888,965 = **1.306238%** | FAIL |
| 2060 transit population loss ≥10% | (1,503,592 − 1,179,555) / 1,503,592 = **21.55086%** | PASS |
| Base ≥0.99×fresh dev subway | 1,503,592 versus 1,491,542 reference; also above b3 floor 1,498,697 | PASS |
| Commute term non-zero from 2030 | All **31/31 annual** and **361/361 monthly** skip checkpoints negative | PASS |
| Mean stage near stations ≥1.5×city | **1.139642798×** in 2060 | FAIL |

All 12 proposal-skip monthly terms in 2030 are negative, ranging **−0.29251 to −0.231**; the resident survey ranges
**8.92400–9.17003** minutes. Across January 2030 through the closing January 2060 snapshot, all 361 recorded terms
are negative, with no zeros; the recorded range is **−1.17279 to −0.231**. The complete 31-row annual proposal-skip
traffic/survey/term table and monthly-per-year counts are retained in
[the full proposal evidence](/C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T045/scratch/round1-proposal-start8/proposal-evidence.md).

Final normalized hashes:

- Transit: `3d46e23dd34aaa1a41333eb136dd79130df23417483c8404138d4affcb68958e`.
- Skip: `18d3320a3540c3d4820204f33bd15d62e9c192c63ff55d922194512588491625`.

### Rejected half-coefficient sensitivity trial

Because the original coefficient costs 1.2448% versus the recovered base, one shallower-coefficient trial was
measured: **start 8, coefficient −0.125, same TOD and grace**, frozen revision `proposal-start8-half`.

| Year | Transit population | Commute approval term |
|---|---:|---:|
| 2030 | 553,239 | −0.285322744 |
| 2040 | 889,064 | −0.469522523 |
| 2050 | 1,178,326 | −0.574341725 |
| 2060 | 1,259,756 | −0.478701956 |

Final residents are **[351213, 604283, 304260]**. The normalized final hash is
`0265e25d5d5d628d1633d857a8bfc509e7d28ab0c85eeb648cfd6b39841268e8`.
This trial **fails the primary base-population floor**: 1,259,756 is below the required 1,476,627 versus fresh dev
subway (**−15.540025%** versus dev), and also below the b3 flags-off floor. It is **rejected**, not a recommended proposal. No half-coefficient
skip-transit run was performed because the base already failed. No additional weaker-coefficient sweep is being
used to chase another seeded path.

The paired start-8/−0.25 rows remain the measured alternative: their base is within 1% of fresh dev, but they cost
1.2448% versus the recovered start-15 base. There was **no validated zero-movement solution**. NOTE-048 approved
the original-coefficient proposal and its stated cost; the half-coefficient trial remains rejected. The historical
growth-counter run is complete above.

## Historical validation and remaining checks

- `npx tsc --noEmit`: passed after the recovery change.
- `git diff --check`: passed. The four production files match the frozen tested candidate after line-ending
  normalization; all six reviewed source/test/report files are valid UTF-8 without a BOM. Evidence:
  `recovery-file-verification.json` in scratch.
- Quiet-gated `npx vitest run tests/sim/transitDevelopment.test.ts --maxWorkers=1`: startup failed with
  **`spawn EPERM`** during Vite configuration loading (`externalize-deps` / `optimizeSafeRealPathSync`). No Vitest
  cases executed; this is not a passing Vitest result.
- The scratch-only installed-rolldown plus `node:assert/strict` runner executed the same 19 synchronous cases:
  **19 passed, 0 failed**. Evidence: `tod-focused-probe.log` / `tod-focused-probe.json`.
- Full Vitest, existing-file regression tests and browser/GPU checks remain for the lead. No full suite or browser
  was run by this lane. Relevant individual regressions include `tests/sim/growth.test.ts`,
  `tests/sim/desirability.test.ts`, `tests/sim/approval.test.ts`, `tests/infra/transitFacilities.test.ts`,
  `tests/worker/hygiene.test.ts`, `tests/worker/querySideEffects.test.ts` and inspector/replica suites.
- Timings are single-run headless system CPU observations, using existing bot timers divided by simulated days,
  excluding bot actions and diagnostic callbacks. They do not establish browser/GPU timing.
- Final-state hashes and query/RNG tests were checked; no two-process every-year Medium/Hard replay comparison
  is claimed. The counter-only diagnostic completed with matching final state and all-month commute capture;
  the half-coefficient trial failed and was stopped before a skip-transit run.

## Historical reproduction and actual bot commands

All bot runs were sequential and quiet-gated. `npx tsx` is unavailable (`ENOTCACHED`, restricted network), so installed
rolldown bundled unchanged `SimBot`, `parseArgs`, `botSystems` and diagnostics into immutable scratch Node ESM.
The pre-edit dev bundle captured production before edits. Ablations changed exact source anchors only in scratch;
there are no production environment switches. Candidate captures record original/transformed source hashes and
single-match counts. Final candidate artifacts match the production recovery assignment.

These PowerShell task variables shorten the actual commands. Paths are absolute; no PowerShell file rewrites are
used:

```powershell
$taskRoot = 'C:/Users/techsin/Desktop/projects/simcityweb-T045'
$taskScratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T045/scratch'
$taskQuiet = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
Set-Location -LiteralPath $taskRoot

# Fresh pre-edit dev, same subway strategy.
node $taskQuiet node "$taskScratch/tod-gates-dev.mjs" --size 256 --years 60 --seed 7 --subway --out "$taskScratch/dev-subway-256x60-s7.json"

# Three independent ablations, then the old-threshold TOD control.
node $taskQuiet node "$taskScratch/round1-launch.mjs" --variant towers-only --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round1/towers-only-256x60-s7-subway.json"
node $taskQuiet node "$taskScratch/round1-launch.mjs" --variant desir-only --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round1/desir-only-256x60-s7-subway.json"
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision v2 --variant commute-only --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round1-v2/commute-only-256x60-s7-subway.json"
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision v2 --variant tod-only --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round1-v2/tod-only-256x60-s7-subway.json"

# Current 15-minute threshold plus existing new-town grace: all completed.
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision candidate-fade15 --variant wip-fade-15 --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round1-candidate-fade15/final-subway-256x60-s7.json"
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision candidate-fade15 --variant wip-fade-15 --size 256 --years 60 --seed 7 --subway --skip transit --out "$taskScratch/round1-candidate-fade15/final-skip-transit-256x60-s7.json"
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision candidate-fade15 --variant wip-fade-15 --size 256 --years 60 --seed 7 --out "$taskScratch/round1-candidate-fade15/final-base-256x60-s7.json"
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision candidate-fade15 --variant wip-fade-15 --size 128 --years 15 --seed 7 --out "$taskScratch/round1-candidate-fade15/final-128x15-s7.json"
```

The ordinary CLI equivalents for the four final configurations, once tsx is available, are:

```powershell
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 256 --years 60 --seed 7
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 256 --years 60 --seed 7 --subway
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 256 --years 60 --seed 7 --subway --skip transit
node $taskQuiet npx tsx "$taskRoot/tools/simbot.ts" --size 128 --years 15 --seed 7
```

Completed final evidence is summarized in `round1-v2/recovery-evidence.md`, with original small summaries in
`round1/tod-parts-summary.txt` and `round1-v2/commute-summary.txt`. WIP `tod-final-*` outputs are superseded by
`round1-candidate-fade15/final-*`; they are not recovery gate results.

The completed threshold-8/−0.25 proposal used these quiet-gated commands against its immutable frozen-source
capture. They measure a proposal and do not change production:

```powershell
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision proposal-start8 --variant wip-fade-8 --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round1-proposal-start8/proposal-subway-256x60-s7.json"
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision proposal-start8 --variant wip-fade-8 --size 256 --years 60 --seed 7 --subway --skip transit --out "$taskScratch/round1-proposal-start8/proposal-skip-transit-256x60-s7.json"
```

The single rejected half-coefficient sensitivity trial used:

```powershell
node $taskQuiet node "$taskScratch/round1-launch.mjs" --revision proposal-start8-half --variant wip-fade-8 --size 256 --years 60 --seed 7 --subway --out "$taskScratch/round1-proposal-start8-half/proposal-subway-256x60-s7.json"
```

Completed counter-only diagnostic command, excluded from timing:

```powershell
node $taskQuiet node "$taskScratch/growth-counter-launch.mjs" --variant wip-fade-15 --tag fade15-final --size 256 --years 60 --seed 7 --subway --out "$taskScratch/growth-counters/fade15-final/run.json"
```

## Plan/code differences and owner requests

1. `APPROVAL.commute` was the −0.25 coefficient; the threshold was a literal `30` in `approval.ts`. The minimal
   outside-owned-file assignment implements the requested threshold. The additional recovery line reuses existing
   population grace because a hamlet's fallback-heavy monthly survey otherwise changes the subsequent bot path.
   It does not replace genuine measured journeys with the traffic average.
2. `TrafficSystem.graphVersion` covers the road graph. Station addition/removal/completion and immediate tunnel
   edits can change `stopAttached` without changing it. The cache must also listen to station/network edits.
3. Grand Central has an asset but no simulation catalog/reward definition with passenger attachment roles.
   **CONTENT/SIM request:** its final LG-02 definition should use model `lm_grand_central` and the intended
   train/subway connectivity semantics. The 8-tile hook exists; real Grand Central connectivity remains unverified.
4. Historical plan/b3 and `683d02b` single-run/A/A rows are context only. Current acceptance uses NOTE-053 as
   written with NOTE-062's amendments and FX5's HOLD disposition, followed by final remeasurement after B2/T041
   and preceding SIM lanes merge. The 2040 threshold is 1%, and the 2060
   stage-6+ share threshold is 2×city. NOTE-048's reason for the 2040 amendment is that most individual 2040 bot
   commutes are below 8.5 minutes; this is not a claim that a newly measured population mean is below 8.5.
5. **Inspector ownership reassigned:** NOTE-048 authorizes T045's isolated `src/ui/inspectorModel.ts`,
   `growthRows` hunk. The long downtown-cap hint needs a dedicated row because the generic path skips text of
   80+ characters. Station eligibility is already carried by the inspection query; no Worker row is requested.
6. **GUIDE request:** `src/ui/panels/StatsPanel.ts`, its update near `commuteModes(s.commuteByMode)`: add “Riders
   save N minutes compared with driving” using mirrored `ctx.state.stats.commuteByMode.transitSaved`. Existing
   `statsModel.commuteModes` already supplies equivalent `modeNote` text. Keep negative savings truthful as slower
   trips. No new counter or Worker query is needed. NOTE-048 defers this Stats line to PB-COMMUTE; it is not
   implemented by T045. The inspector exception above does not transfer other UI ownership.
7. **B2/cloud request:** the attachment query/scheduler dependency is detailed in the round-2 section. This lane
   makes no infra changes and requests owner-side query-frequency replay coverage.
8. **Worker/cloud request:** in `src/worker/queries.ts`, `watchSignature`'s early inspector branch returns
   `inspectSignature(...)` without the command epoch. A retained inspector watch can therefore stay stale while
   paused after a remote transport edit, although a fresh packet-host query returns the correct eligibility/hint.
   The minimal proposed owner change is
   ``return `${inspectSignature(sim, args as InspectBuildingArgs | InspectCellArgs)}:${commands}`;``
   in that branch, preserving the existing 1 Hz cap. Add a packet-watch regression that retains the inspector,
   cuts/reconnects the station line via a remote command while paused, and observes the updated hint. This is an
   existing signature change beyond additive query-entry authorization, so T045 does not edit Worker files.

## Decisions for the lead

- **Current disposition: HOLD, not a final merge gate.** Use the FX5 nine-member medians/bands and NOTE-062's
  rules. The s11 median is 1,394,211, 74,471.82 below its 0.99× floor. If the specified late median/band or floor
  failure survives on final dev, LG-08 does not merge and the approved 8/−0.25 setting returns with the requested
  trade-off table. The old single-run peak drifts and zero +§1 A/A envelope do not decide this ensemble verdict.
- **D2 remains separate:** early population-up/128 cleaner-air failures stay FAIL until FX4 names a mechanism,
  the +3% bound is respected, and final-dev repetition supports a D2 signature. FX4 is WAIT for the user's FX1.
  ApprovalNetCommute and monthly nine-member commute activation/weakest-member checks are OPEN, not inferred
  from raw approval, annual traffic averages or the one control run. No extra members or compensating balance
  change is authorized. Radius/appeal and the existing new-town grace remain fixed.
- **Permission/realization follow-up:** the requested CONTENT/SIM backlog entry is present. No local quota exists
  to remove: near-station permission already retains all original downtown rights. Catalog, demand, growth
  allowance or footprint changes require their own later balance lane; historical counters are evidence, not
  authority to extend LG-08's scope. This historical R$ content follow-up does not outsource an LG-08-induced
  stall; NOTE-062 requires that stall's diagnosis and trade-off to remain with LG-08. FX5 edits no backlog.
- **Owner work and remaining checks:** route the concrete attachment-query/scheduler request to B2, keep the
  Stats line with PB-COMMUTE and Grand Central with LG-02, and run the remaining full Vitest/browser/GPU checks.
  Route retained-inspector watch invalidation to the Worker owner. The inspector payload/text hunk is isolated
  and authorized here; retained-watch reactivity is not claimed to pass. No `.done` is written.

## Browser checklist for the lead

- [ ] Connect two subway stations, or a passenger train station to another station/the map edge. High-density lots
  within 6 centre-cell tiles become tower sites, subject to population, desirability, demand and utilities.
- [ ] A lone/disconnected station, bus stop or freight station creates no tower sites. Cutting the line, removing
  its partner, or burning/abandoning a station removes eligibility; rebuilding restores it.
- [ ] R$$, CO$$ and CO$$$ Why? views show “Near a station” at +4 points. Other types and overlapping catchments
  receive no extra bonus.
- [ ] Above the new-town grace range, a resident-weighted commute over 8 minutes shows a negative monthly
  approval term. A hamlet's term fades over 2k→8k sampled residents; an empty city costs zero. Genuine cut-off
  journeys remain penalized, including when the reported traffic average is zero.
- [ ] Save/load an existing city; station effects reconstruct and play continues in local and Worker modes.
- [ ] Verify the isolated station/downtown inspector hint. Check the Transit minutes-saved line after PB-COMMUTE.
- [ ] Keep an inspector open while paused; remotely cut/reconnect the station line and verify the hint updates
  within the existing watch cap after the Worker owner fixes command-epoch invalidation. A fresh query alone
  does not pass this retained-watch check.
- [ ] After LG-02 supplies Grand Central's connected definition, verify its 8-tile radius.
- [ ] Inspect station-area skyline variety/concentration. Browser inspection alone does not establish NOTE-048's
  numerical stage-6+ share gate; use the final census and fresh paired bot evidence.

## Historical T062 campaign export (pre-NOTE-062 evaluator)

The following archived campaign export retains the raw medians, bands, commands and original evaluator results
copied at `1f231e7`. It is **not the current verdict**: its population tolerance-zero interpretation is corrected
to two-sided 1% in FX5, its raw approval counts do not judge approvalNetCommute, and its zero-band I-HT failures
are subject to NOTE-062's exception. Do not reuse its mixed-unit overall minimum or combined 108-failure total as
an amended approval verdict. Final gates run on dev containing B2, T041 and preceding SIM lanes.

# T045 (LG-08): NOTE-053 ensemble judgement

Measurement tree: `C:/Users/techsin/Desktop/projects/simcityweb-T045m`, commit `f8b3f145a379694adedb1e26bb825886d49282a2`. Read-only measurements; no fixture re-recording.

Reference: the cached dev simulation used to start the lanes, before T041, at `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`. The five original flags-off dev members are reused. Additional dev members use an exact read-only source extraction at that commit in scratch, retaining the original dev cache identity. Original member provenance remains in each JSON. This is an interim judgement; repeat the final gate after T041 lands.

The ensemble uses control, ±§100 on days 1/1441, and adds ±§200 at both timings where stage two is required. All new commands use `--jobs 4`, run sequentially across the campaign, and launch every bot through the quiet gate.

**Archived evaluator assumption, superseded by NOTE-062:** the original export treated population tolerance as
zero and kept a one-row floor. FX5 above instead uses two-sided 1% population tolerance **plus** the band clause,
and separate floors for all three no-flag rows and matched subway. The raw tables retain the old passing
interval/margin columns for traceability; they are not recalibrated approval-net or D2 verdicts. Funds remain
additional raw-annual diagnostics, not a base gate.

NOTE-048 approves the 8-minute/−0.25 commute rule and changes the transit-loss target to ≥1% in 2040, retaining ≥10% in 2060. The skyline target is a stage-6+ share near connected stations ≥2×city, replacing the old mean-stage ratio.

## Verdicts and margins

| Check | Members | Verdict | Worst signed margin (simulation units) | Detail |
|---|---:|---|---:|---|
| Base 128x15_s7, all four metrics, every year ≥10 | 9 | fail | -380 | 7/24 metric-year failures; worst population in 2014. Signed margins have different units; inspect per-metric tables below. |
| Base 256x60_s7, all four metrics, every year ≥10 | 9 | fail | -536 | 6/204 metric-year failures; worst population in 2022. Signed margins have different units; inspect per-metric tables below. |
| Base 256x60_s11, all four metrics, every year ≥10 | 9 | fail | -64206 | 95/204 metric-year failures; worst population in 2054. Signed margins have different units; inspect per-metric tables below. |
| Flags-off year-60 population ≥0.99×dev | 9 | pass | 49777.87 people | observed 1496254, boundary 1446476.13; half dev band 100437.5. |
| Transit loss ≥1% in 2040 | 9 | pass | 3840.96 people | observed 875976, boundary 879816.96; loss 1.432198%; half dev band 5853.5. |
| Transit loss ≥10% in 2060 | 9 | pass | 81977.3 people | observed 1265455, boundary 1347432.3; loss 15.475568%; half dev band 100437.5. |
| Diagnostic only: subway year-60 population ≥0.99×the supplied flags-off dev (different strategies) | 9 | pass | 50670.87 people | observed 1497147, boundary 1446476.13; half dev band 100437.5. |
| Subway year-60 population ≥0.99×same-strategy dev subway | 9 | pass | 20520.42 people | observed 1497147, boundary 1476626.58; half dev band 122817. |

The 128×15 screen moves from dev median **191588** to lane median **193438**, Δ **1850** (**0.965614%**).

The task places the ≥0.99×dev floor under the subway run, and the lane’s prior report interprets it as a same-strategy dev-subway comparison. The worker’s current campaign supplies flags-off dev ensembles. The tables therefore show both the explicit flags-off base floor and the subway result against that supplied flags-off dev; the latter uses different bot strategies and does not establish the historical same-strategy subway floor.
A same-strategy dev-subway ensemble is also supplied and judged separately in the target table.

## Systematic-shift check

The existing runner uses each row’s last year (15/60/60), since the short row has no year 60. A same-direction endpoint shift is real only when all three deltas strictly exceed one quarter of the corresponding dev band.

| Metric | Row | Endpoint | Dev median | Lane median | Δ median | Quarter dev band | Systematic result |
|---|---|---|---:|---:|---:|---:|---|
| Population | 128x15_s7 | 15 (2015) | 191588 | 193438 | 1850 | 1481.5 | no three-row systematic shift |
| Population | 256x60_s7 | 60 (2060) | 1461087 | 1496254 | 35167 | 50218.75 | no three-row systematic shift |
| Population | 256x60_s11 | 60 (2060) | 1483518 | 1394211 | -89307 | 20942 | no three-row systematic shift |
| Approval points | 128x15_s7 | 15 (2015) | 80.906099 | 81.414993 | 0.508894 | 0.681771 | no three-row systematic shift |
| Approval points | 256x60_s7 | 60 (2060) | 80.164557 | 78.536264 | -1.628293 | 0.58944 | no three-row systematic shift |
| Approval points | 256x60_s11 | 60 (2060) | 80.441199 | 79.188666 | -1.252533 | 0.554882 | no three-row systematic shift |
| Air at homes | 128x15_s7 | 15 (2015) | 0.092873 | 0.090916 | -0.001957 | 0.001402 | no three-row systematic shift |
| Air at homes | 256x60_s7 | 60 (2060) | 0.168895 | 0.171832 | 0.002937 | 0.006934 | no three-row systematic shift |
| Air at homes | 256x60_s11 | 60 (2060) | 0.17075 | 0.161386 | -0.009363 | 0.010757 | no three-row systematic shift |
| I-HT share | 128x15_s7 | 15 (2015) | 0 | 0 | 0 | 0.000832 | no three-row systematic shift |
| I-HT share | 256x60_s7 | 60 (2060) | 0.114822 | 0.071239 | -0.043583 | 0.022562 | no three-row systematic shift |
| I-HT share | 256x60_s11 | 60 (2060) | 0.08191 | 0.13585 | 0.05394 | 0.026448 | no three-row systematic shift |

## Second-stage accounting

A five-member base boundary or target within half of dev’s band triggers nine members on both sides, including passing boundaries. The nine-member median is final; a near boundary at nine members does not trigger another stage.

| Role | Row | Five-member trigger | Final member count |
|---|---|---|---:|
| dev | 128x15_s7 | Base annual boundary within half of dev band | 9 |
| base | 128x15_s7 | Base annual boundary within half of dev band | 9 |
| dev | 256x60_s7 | Base annual boundary within half of dev band; Flags-off year-60 population ≥0.99×dev; Transit loss ≥1% in 2040 | 9 |
| base | 256x60_s7 | Base annual boundary within half of dev band; Flags-off year-60 population ≥0.99×dev | 9 |
| dev | 256x60_s11 | Base annual boundary within half of dev band | 9 |
| base | 256x60_s11 | Base annual boundary within half of dev band | 9 |
| subway | 256x60_s7 | Transit loss ≥1% in 2040; Subway year-60 population ≥0.99×same-strategy dev subway | 9 |
| skipTransit | 256x60_s7 | Transit loss ≥1% in 2040 | 9 |
| devSubway | 256x60_s7 | Subway year-60 population ≥0.99×same-strategy dev subway | 9 |

| Target | Five-member median judgement | Five-member signed margin | Final judgement | Final signed margin |
|---|---|---:|---|---:|
| Flags-off year-60 population ≥0.99×dev | needs stage two | 50886.87 | pass | 49777.87 |
| Transit loss ≥1% in 2040 | needs stage two | 2463.96 | pass | 3840.96 |
| Transit loss ≥10% in 2060 | pass | 102289.7 | pass | 81977.3 |
| Diagnostic only: subway year-60 population ≥0.99×the supplied flags-off dev (different strategies) | needs stage two | 53176.87 | pass | 50670.87 |
| Subway year-60 population ≥0.99×same-strategy dev subway | needs stage two | 23026.42 | pass | 20520.42 |

## What these rows cannot judge

- The stage-6+ share within six tiles of connected stations and the tower-eligible mean-stage diagnostic need the lane’s final spatial census. `maxStage` is not a share or distance measure; this campaign does not claim that gate passes.
- The commute approval term must be non-zero from 2030. The raw annual `botRow.commute` is `stats.avgCommute` from traffic, while approval uses its sliced resident-weighted survey (`data.resCommute`) and population grace. The ordinary bot profile records neither that survey nor the term, so the campaign cannot infer activation from traffic averages. The lane’s monthly term probe remains required.
- The ≤3 ms/day increase requires controlled same-strategy system timing. The ensemble observer deliberately removes timing fields from annual evidence, and four concurrent bots do not supply a controlled timing comparison. No timing verdict is inferred.
- Browser behavior, the inspector hint, attachment invalidation, old-save adoption, Worker parity and Grand Central connectivity require the lane’s own tests/browser checks. No browser was opened here.

## Median and min–max tables

Air is the balance metric at homes (lower is cleaner); I-HT share is a fraction of I-D+I-M+I-HT jobs, excluding agriculture. Funds are the full-precision `funds` field from each raw annual observation; each row independently takes its median/min/max, without subtracting nudges or using the rounded `botRow.funds`.

### dev: 128x15_s7 (9 members)

| Year | Population median [min, max] | Approval median [min, max] | Air median [min, max] | I-HT share median [min, max] | Funds § median [min, max] |
|---|---:|---:|---:|---:|---:|
| 10 (2010) | 100141 [96401, 101380] | 70.851885 [69.040174, 72.44259] | 0.072499 [0.069177, 0.07448] | 0 [0, 0] | 74057 [64517, 74678] |
| 11 (2011) | 116914 [113300, 118282] | 73.4709 [72.926969, 75.225277] | 0.074557 [0.073473, 0.07642] | 0 [0, 0] | 87155 [73895, 90394] |
| 12 (2012) | 134932 [131160, 136360] | 75.295956 [75.01476, 76.995475] | 0.072193 [0.070805, 0.073749] | 0 [0, 0] | 103092 [85334, 115060] |
| 13 (2013) | 153902 [149266, 154998] | 76.930783 [76.329242, 78.138895] | 0.078771 [0.076572, 0.080118] | 0 [0, 0.007138] | 120801 [107393, 128275] |
| 14 (2014) | 172301 [168028, 173724] | 78.565686 [77.615033, 79.404951] | 0.085386 [0.083328, 0.087247] | 0 [0, 0.003329] | 132621 [111771, 156159] |
| 15 (2015) | 191588 [187528, 193454] | 80.906099 [78.829218, 81.5563] | 0.092873 [0.090884, 0.096493] | 0 [0, 0.003328] | 170447 [145192, 208987] |

### dev: 256x60_s7 (9 members)

| Year | Population median [min, max] | Approval median [min, max] | Air median [min, max] | I-HT share median [min, max] | Funds § median [min, max] |
|---|---:|---:|---:|---:|---:|
| 10 (2010) | 99145 [96440, 99363] | 63.851905 [62.176938, 64.779444] | 0.070438 [0.068175, 0.080263] | 0 [0, 0] | 42371 [26643, 51649] |
| 11 (2011) | 112884 [109928, 113636] | 62.116397 [61.170749, 63.222933] | 0.069488 [0.058694, 0.08135] | 0 [0, 0.017684] | 69040 [60182, 76628] |
| 12 (2012) | 129086 [126172, 130667] | 62.579908 [61.051415, 68.097209] | 0.05573 [0.053562, 0.059056] | 0 [0, 0.015851] | 86781 [81539, 94892] |
| 13 (2013) | 145600 [143285, 147798] | 64.755906 [62.28397, 70.665331] | 0.055748 [0.05209, 0.060272] | 0 [0, 0.014119] | 98690 [87209, 105438] |
| 14 (2014) | 162743 [160481, 164908] | 66.185627 [63.605992, 70.428778] | 0.057469 [0.050478, 0.060113] | 0 [0, 0.007913] | 112450 [102596, 122624] |
| 15 (2015) | 181682 [179070, 184286] | 69.005076 [64.572029, 71.447718] | 0.056323 [0.049402, 0.060483] | 0 [0, 0.007292] | 130814 [127985, 141308] |
| 16 (2016) | 200727 [198438, 203611] | 69.995104 [66.073285, 71.473263] | 0.055139 [0.049743, 0.061915] | 0 [0, 0.007049] | 132108 [122459, 148924] |
| 17 (2017) | 220398 [217756, 222690] | 69.547312 [67.338227, 71.724746] | 0.055625 [0.05213, 0.06452] | 0 [0, 0.00699] | 160591 [142508, 163997] |
| 18 (2018) | 241134 [238379, 242772] | 69.996074 [67.194316, 71.33413] | 0.058331 [0.052673, 0.065623] | 0 [0, 0.006777] | 181873 [154560, 194102] |
| 19 (2019) | 262375 [259752, 264696] | 71.172907 [67.2256, 72.503893] | 0.056366 [0.052276, 0.068398] | 0 [0, 0.004477] | 194624 [168594, 208210] |
| 20 (2020) | 284938 [281431, 287103] | 72.137169 [70.045944, 73.422542] | 0.055381 [0.051697, 0.059821] | 0 [0, 0.004442] | 234291 [204537, 255398] |
| 21 (2021) | 309055 [305041, 310742] | 73.058709 [72.411282, 76.68465] | 0.055526 [0.051048, 0.061836] | 0 [0, 0.004414] | 250400 [234637, 261976] |
| 22 (2022) | 332098 [327623, 333926] | 75.431064 [72.317795, 76.886389] | 0.055605 [0.049979, 0.064391] | 0 [0, 0.00439] | 321712 [237551, 339841] |
| 23 (2023) | 356659 [351550, 357912] | 76.228809 [73.460378, 77.299529] | 0.059101 [0.050737, 0.065704] | 0 [0, 0] | 321595 [272214, 664889] |
| 24 (2024) | 380531 [376917, 382300] | 76.613249 [73.998838, 77.957952] | 0.061226 [0.052972, 0.069464] | 0 [0, 0] | 599245 [358398, 1069410] |
| 25 (2025) | 406143 [402631, 407893] | 76.847449 [73.900218, 78.213305] | 0.061168 [0.057127, 0.069714] | 0 [0, 0] | 929733 [440582, 1531668] |
| 26 (2026) | 433030 [429660, 434886] | 76.505994 [74.148121, 77.964325] | 0.058854 [0.057654, 0.07121] | 0 [0, 0] | 1374669 [607747, 2098006] |
| 27 (2027) | 461632 [458481, 463349] | 77.763571 [75.669575, 78.840311] | 0.061842 [0.057955, 0.06949] | 0 [0, 0] | 1818890 [990654, 2760282] |
| 28 (2028) | 491442 [486939, 492668] | 77.890958 [75.924164, 78.730433] | 0.06446 [0.058058, 0.073884] | 0 [0, 0] | 2440250 [1469227, 2925269] |
| 29 (2029) | 522372 [516424, 523222] | 78.665187 [75.946768, 80.008889] | 0.067122 [0.062519, 0.079002] | 0 [0, 0] | 2883283 [1768544, 3056612] |
| 30 (2030) | 553169 [547698, 554269] | 80.046819 [77.065152, 81.049478] | 0.070346 [0.065754, 0.080669] | 0 [0, 0] | 3400247 [2300710, 3472531] |
| 31 (2031) | 584845 [578264, 586165] | 81.189545 [77.22447, 81.342604] | 0.074498 [0.071388, 0.086414] | 0 [0, 0] | 3670182 [2919571, 3849671] |
| 32 (2032) | 616271 [609732, 617587] | 81.870756 [78.113537, 82.205682] | 0.080718 [0.076235, 0.092153] | 0 [0, 0] | 3969154 [3605385, 4067577] |
| 33 (2033) | 649366 [642446, 650402] | 82.021286 [79.810819, 82.775621] | 0.082977 [0.080073, 0.09682] | 0 [0, 0] | 4221845 [3919920, 4405751] |
| 34 (2034) | 681383 [674866, 682905] | 81.876241 [79.969538, 82.721619] | 0.088946 [0.085412, 0.101078] | 0 [0, 0] | 4536952 [4254946, 4655266] |
| 35 (2035) | 715266 [707692, 716674] | 82.321277 [79.824437, 82.746021] | 0.094088 [0.088873, 0.107079] | 0 [0, 0] | 4939942 [4636220, 5025393] |
| 36 (2036) | 747267 [740445, 749944] | 81.682529 [80.058075, 82.240793] | 0.098577 [0.09656, 0.112797] | 0 [0, 0] | 5379794 [4991995, 5494391] |
| 37 (2037) | 781483 [773598, 784083] | 81.705085 [79.349048, 82.108048] | 0.111185 [0.100352, 0.122397] | 0 [0, 0] | 5796999 [5290716, 5965661] |
| 38 (2038) | 816400 [808253, 819015] | 81.336567 [79.565357, 82.107769] | 0.113757 [0.104651, 0.132841] | 0 [0, 0] | 6280322 [5610573, 6496932] |
| 39 (2039) | 849116 [844325, 853580] | 81.141469 [80.614922, 82.10792] | 0.117955 [0.110534, 0.13891] | 0 [0, 0] | 6785965 [5978985, 7026577] |
| 40 (2040) | 885781 [878794, 890501] | 81.936279 [80.308075, 82.773166] | 0.123398 [0.116073, 0.139514] | 0 [0, 0] | 7045688 [6385428, 7380337] |
| 41 (2041) | 922651 [913777, 928329] | 81.517374 [80.768678, 82.685078] | 0.125318 [0.119679, 0.14338] | 0 [0, 0] | 7389842 [6844546, 7686531] |
| 42 (2042) | 954296 [948309, 964043] | 81.318185 [80.254576, 82.517725] | 0.131582 [0.126007, 0.147672] | 0 [0, 0] | 7703730 [7361488, 8054442] |
| 43 (2043) | 990452 [986884, 1001176] | 81.418462 [79.844569, 82.582742] | 0.136369 [0.130339, 0.155298] | 0 [0, 0] | 7954439 [7870948, 8597524] |
| 44 (2044) | 1029252 [1021771, 1041125] | 81.07317 [79.716275, 81.605984] | 0.140589 [0.138719, 0.158979] | 0 [0, 0.002702] | 8393651 [8221580, 9292449] |
| 45 (2045) | 1066213 [1055686, 1079331] | 80.763918 [79.310177, 81.188186] | 0.1457 [0.14248, 0.160587] | 0 [0, 0.010754] | 8730004 [8725138, 9972715] |
| 46 (2046) | 1106293 [1092663, 1118481] | 80.540855 [79.007583, 81.000507] | 0.150068 [0.144261, 0.166444] | 0 [0, 0.02938] | 9262304 [9096525, 10675884] |
| 47 (2047) | 1144132 [1127604, 1152537] | 79.998508 [78.95312, 81.058885] | 0.149999 [0.143483, 0.167729] | 0 [0, 0.035157] | 9776999 [9419262, 11395191] |
| 48 (2048) | 1186078 [1167763, 1189173] | 80.458667 [77.94694, 80.868642] | 0.155346 [0.147753, 0.172724] | 0 [0, 0.050934] | 10180120 [9763121, 12132905] |
| 49 (2049) | 1225463 [1185004, 1235776] | 80.561099 [78.807668, 80.951111] | 0.156569 [0.14735, 0.16969] | 0 [0, 0.062206] | 10608104 [10107626, 12906332] |
| 50 (2050) | 1265741 [1202458, 1272989] | 80.318955 [78.991205, 80.844737] | 0.159403 [0.154533, 0.177092] | 0 [0, 0.073241] | 11039626 [10426197, 13645964] |
| 51 (2051) | 1310245 [1243720, 1315846] | 79.678009 [78.273839, 80.753433] | 0.16415 [0.152604, 0.178799] | 0.010851 [0, 0.078228] | 11421235 [10731681, 14354466] |
| 52 (2052) | 1342501 [1259287, 1355405] | 79.773212 [78.304435, 80.636975] | 0.160637 [0.153368, 0.177894] | 0.025653 [0, 0.091159] | 11818888 [11029117, 15131835] |
| 53 (2053) | 1361273 [1266114, 1397353] | 79.536204 [77.678528, 80.754847] | 0.164037 [0.155334, 0.174626] | 0.035398 [0, 0.101934] | 12220993 [11305006, 15905784] |
| 54 (2054) | 1389189 [1282793, 1434433] | 79.908776 [78.675529, 81.011342] | 0.16413 [0.152679, 0.182994] | 0.046938 [0.001336, 0.10184] | 12660670 [11605219, 16723062] |
| 55 (2055) | 1401036 [1291560, 1463953] | 79.811388 [77.450356, 81.1146] | 0.16822 [0.156632, 0.175749] | 0.050612 [0.018379, 0.116942] | 13194127 [11957760, 17596513] |
| 56 (2056) | 1419186 [1304234, 1479068] | 80.066278 [77.580319, 81.022311] | 0.168069 [0.154205, 0.186111] | 0.065149 [0.030167, 0.124758] | 13766735 [12346118, 18517931] |
| 57 (2057) | 1418230 [1322291, 1487910] | 80.258158 [77.712266, 80.946544] | 0.170842 [0.153725, 0.181636] | 0.074023 [0.038866, 0.130134] | 14374276 [12771605, 19454163] |
| 58 (2058) | 1442416 [1335743, 1521883] | 80.014802 [78.340443, 80.926879] | 0.168051 [0.153829, 0.187011] | 0.089536 [0.040372, 0.135843] | 15009259 [13241820, 20403512] |
| 59 (2059) | 1447648 [1344677, 1537176] | 79.883671 [77.412821, 80.662289] | 0.169666 [0.15611, 0.185163] | 0.097398 [0.044402, 0.136353] | 15670344 [13680976, 20861965] |
| 60 (2060) | 1461087 [1341715, 1542590] | 80.164557 [78.183649, 80.54141] | 0.168895 [0.155473, 0.183209] | 0.114822 [0.047377, 0.137624] | 16348805 [14078118, 21369469] |

### dev: 256x60_s11 (9 members)

| Year | Population median [min, max] | Approval median [min, max] | Air median [min, max] | I-HT share median [min, max] | Funds § median [min, max] |
|---|---:|---:|---:|---:|---:|
| 10 (2010) | 96965 [95898, 97480] | 64.513165 [61.866754, 65.072707] | 0.0654 [0.05669, 0.07417] | 0 [0, 0.025153] | 38008 [27919, 64833] |
| 11 (2011) | 111116 [110004, 111424] | 62.939346 [61.809728, 64.042029] | 0.059306 [0.051073, 0.06456] | 0 [0, 0.022382] | 67058 [54169, 72471] |
| 12 (2012) | 126617 [125426, 127871] | 63.031628 [61.631207, 65.24692] | 0.052271 [0.048214, 0.056295] | 0 [0, 0.020624] | 85764 [80636, 92088] |
| 13 (2013) | 143996 [141572, 145099] | 63.77372 [62.408336, 65.627238] | 0.050503 [0.047794, 0.055597] | 0 [0, 0.019488] | 102478 [88127, 105816] |
| 14 (2014) | 162461 [158959, 163214] | 68.721816 [64.001443, 70.23553] | 0.053548 [0.046244, 0.057348] | 0 [0, 0.019166] | 110428 [90432, 118515] |
| 15 (2015) | 181549 [178036, 182428] | 69.9904 [66.291755, 71.14672] | 0.051467 [0.045746, 0.056549] | 0 [0, 0.018812] | 133265 [130439, 136967] |
| 16 (2016) | 201032 [198458, 202147] | 70.958706 [70.40255, 72.311562] | 0.052439 [0.044153, 0.056537] | 0 [0, 0.018644] | 138533 [125668, 149763] |
| 17 (2017) | 220235 [217287, 221560] | 71.213611 [70.174724, 72.37161] | 0.057306 [0.050383, 0.062885] | 0 [0, 0.018692] | 169189 [137106, 176403] |
| 18 (2018) | 240111 [237922, 242097] | 71.758047 [70.817567, 73.153183] | 0.054557 [0.050128, 0.060823] | 0 [0, 0.018765] | 183191 [154360, 188639] |
| 19 (2019) | 261751 [258901, 264481] | 72.793509 [72.031699, 74.568255] | 0.052887 [0.050402, 0.056052] | 0 [0, 0.018578] | 203788 [168062, 231609] |
| 20 (2020) | 284274 [280865, 287234] | 73.809515 [72.9964, 76.716866] | 0.052379 [0.04963, 0.055717] | 0 [0, 0.018524] | 221230 [198850, 301614] |
| 21 (2021) | 307076 [303929, 310168] | 76.552718 [75.184065, 77.754084] | 0.052287 [0.049701, 0.057203] | 0 [0, 0.018588] | 266087 [204744, 334021] |
| 22 (2022) | 331227 [327213, 333566] | 77.209454 [76.047912, 77.489004] | 0.054574 [0.050176, 0.058413] | 0 [0, 0.018576] | 357683 [269413, 393488] |
| 23 (2023) | 354705 [350807, 357155] | 77.293919 [76.288757, 77.933607] | 0.057738 [0.054987, 0.062385] | 0 [0, 0.018594] | 476492 [308155, 713774] |
| 24 (2024) | 379628 [375350, 381880] | 76.818427 [76.460377, 78.169196] | 0.059957 [0.057229, 0.065666] | 0 [0, 0.018571] | 821008 [594360, 1124265] |
| 25 (2025) | 405373 [400281, 406789] | 76.912012 [76.264005, 78.004875] | 0.062913 [0.05815, 0.06689] | 0 [0, 0.018577] | 1244820 [902296, 1569954] |
| 26 (2026) | 431452 [426244, 432624] | 77.534774 [76.564683, 78.244625] | 0.061408 [0.056411, 0.067051] | 0 [0, 0.018445] | 1680013 [1309626, 2100883] |
| 27 (2027) | 459324 [454626, 460015] | 77.591061 [76.516536, 78.806732] | 0.063114 [0.057175, 0.069608] | 0 [0, 0.018408] | 2227773 [1804380, 2689425] |
| 28 (2028) | 488133 [484568, 489945] | 78.003959 [77.091076, 80.15943] | 0.06298 [0.058385, 0.071639] | 0 [0, 0.018405] | 2756573 [2244698, 2957885] |
| 29 (2029) | 518809 [515169, 520829] | 80.266762 [78.817776, 81.600923] | 0.065344 [0.061447, 0.075015] | 0 [0, 0.018529] | 2966249 [2640915, 3072822] |
| 30 (2030) | 549130 [545987, 551504] | 81.440401 [79.232013, 81.86017] | 0.069741 [0.062872, 0.076904] | 0 [0, 0.018519] | 3246439 [2971634, 3472856] |
| 31 (2031) | 580247 [577395, 583309] | 81.860673 [80.92348, 82.372373] | 0.074493 [0.067505, 0.083421] | 0 [0, 0.017914] | 3549363 [3172140, 3771250] |
| 32 (2032) | 613277 [608730, 615409] | 82.080383 [81.539946, 82.817546] | 0.077513 [0.071208, 0.085898] | 0 [0, 0.017426] | 3790838 [3406729, 4029002] |
| 33 (2033) | 645069 [641046, 648681] | 82.361918 [81.444775, 83.294922] | 0.083733 [0.074329, 0.090831] | 0 [0, 0.013508] | 4084698 [3715844, 4280047] |
| 34 (2034) | 678240 [671270, 681039] | 82.482752 [81.614885, 82.96945] | 0.086747 [0.076779, 0.101734] | 0 [0, 0.009776] | 4480286 [4107017, 4616285] |
| 35 (2035) | 711356 [705812, 714537] | 82.529374 [81.232581, 82.892147] | 0.093835 [0.083873, 0.100117] | 0 [0, 0.009151] | 4870205 [4544326, 5033704] |
| 36 (2036) | 744626 [738362, 749055] | 82.583011 [81.851181, 83.806878] | 0.10081 [0.090213, 0.107488] | 0 [0, 0.004347] | 5306015 [4922672, 5490944] |
| 37 (2037) | 778119 [773730, 782802] | 82.648757 [82.041069, 83.143764] | 0.103446 [0.093099, 0.113785] | 0 [0, 0.004136] | 5654823 [5196252, 6001301] |
| 38 (2038) | 813825 [807517, 817770] | 82.24961 [81.422337, 82.954038] | 0.108827 [0.097531, 0.11928] | 0 [0, 0.004098] | 5884291 [5505634, 6393761] |
| 39 (2039) | 845902 [841049, 853196] | 82.56106 [81.556214, 83.179825] | 0.117282 [0.103999, 0.126057] | 0 [0, 0.004111] | 6112238 [5808683, 6768071] |
| 40 (2040) | 883512 [878323, 889836] | 82.922116 [81.945484, 83.257913] | 0.119225 [0.106316, 0.129887] | 0 [0, 0] | 6414471 [6152429, 7345912] |
| 41 (2041) | 914777 [913253, 927072] | 82.302044 [81.131021, 82.881996] | 0.124134 [0.111427, 0.142697] | 0 [0, 0] | 6704447 [6548207, 7949616] |
| 42 (2042) | 955849 [947049, 962805] | 82.168555 [81.583607, 82.855949] | 0.128761 [0.115737, 0.144575] | 0 [0, 0] | 7100105 [6983085, 8410469] |
| 43 (2043) | 993905 [981631, 999561] | 82.004656 [81.005473, 82.462452] | 0.132343 [0.116848, 0.146611] | 0 [0, 0] | 7514338 [7389209, 8636589] |
| 44 (2044) | 1031139 [1017766, 1038005] | 81.673885 [80.856138, 82.351654] | 0.139037 [0.127841, 0.153304] | 0 [0, 0] | 8001817 [7833541, 8989118] |
| 45 (2045) | 1069790 [1055287, 1076009] | 81.362027 [80.198059, 82.471228] | 0.143253 [0.133344, 0.158265] | 0 [0, 0] | 8507837 [8266064, 9304880] |
| 46 (2046) | 1109236 [1094324, 1115154] | 81.156899 [80.386412, 81.554803] | 0.151972 [0.13572, 0.159906] | 0 [0, 0] | 9042759 [8742386, 9648293] |
| 47 (2047) | 1147038 [1132339, 1152325] | 80.616788 [79.541246, 81.87627] | 0.157108 [0.13841, 0.169139] | 0 [0, 0] | 9555408 [9210307, 9993204] |
| 48 (2048) | 1186645 [1169316, 1190815] | 81.300278 [79.779126, 81.823414] | 0.153944 [0.140154, 0.171809] | 0 [0, 0] | 9993095 [9692855, 10379593] |
| 49 (2049) | 1230333 [1209924, 1233587] | 80.534175 [79.830502, 81.423558] | 0.155267 [0.144445, 0.173847] | 0 [0, 0] | 10484040 [10187215, 10757000] |
| 50 (2050) | 1266953 [1254073, 1276465] | 80.822172 [79.830743, 81.321436] | 0.163261 [0.140626, 0.174208] | 0 [0, 0] | 10927327 [10665374, 11236727] |
| 51 (2051) | 1310276 [1295571, 1317330] | 80.421799 [79.663376, 80.892828] | 0.16144 [0.146473, 0.175127] | 0 [0, 0.010019] | 11343174 [11060561, 11729023] |
| 52 (2052) | 1353432 [1335822, 1358146] | 80.532339 [79.593908, 80.725192] | 0.163856 [0.143862, 0.180875] | 0.005203 [0, 0.012521] | 11738398 [11428427, 12226556] |
| 53 (2053) | 1391300 [1372356, 1404494] | 80.814111 [79.313848, 81.187269] | 0.161633 [0.142825, 0.182658] | 0.016105 [0, 0.025] | 12233339 [11771694, 12752917] |
| 54 (2054) | 1410655 [1388950, 1450423] | 80.42361 [79.70135, 81.510728] | 0.164057 [0.14336, 0.180829] | 0.025673 [0, 0.031626] | 12758952 [12131215, 13334195] |
| 55 (2055) | 1428499 [1386414, 1468215] | 80.740354 [79.93082, 81.717258] | 0.165501 [0.144886, 0.184044] | 0.028589 [0, 0.04063] | 13278437 [12509588, 13954462] |
| 56 (2056) | 1444001 [1400344, 1478360] | 80.375631 [80.110601, 80.922619] | 0.163848 [0.144752, 0.179428] | 0.041271 [0, 0.056866] | 13804516 [12922715, 14587716] |
| 57 (2057) | 1456317 [1403945, 1487877] | 80.329177 [79.076655, 81.11718] | 0.168617 [0.14591, 0.186551] | 0.048963 [0, 0.086366] | 14357197 [13341360, 15252986] |
| 58 (2058) | 1462768 [1414561, 1491615] | 80.212966 [79.518843, 80.863566] | 0.168696 [0.142471, 0.182266] | 0.050926 [0, 0.098987] | 14921944 [13770775, 15956600] |
| 59 (2059) | 1482680 [1416617, 1504263] | 80.102785 [79.690658, 80.827008] | 0.16267 [0.147304, 0.182974] | 0.070867 [0, 0.100958] | 15515611 [14255061, 16694398] |
| 60 (2060) | 1483518 [1427340, 1511108] | 80.441199 [79.137167, 81.356695] | 0.17075 [0.147485, 0.190513] | 0.08191 [0, 0.10579] | 16119047 [14770707, 17447223] |

### base: 128x15_s7 (9 members)

| Year | Population median [min, max] | Approval median [min, max] | Air median [min, max] | I-HT share median [min, max] | Funds § median [min, max] |
|---|---:|---:|---:|---:|---:|
| 10 (2010) | 100893 [99965, 103110] | 72.215613 [68.203665, 73.091384] | 0.069482 [0.065759, 0.075183] | 0 [0, 0] | 74358 [73517, 78443] |
| 11 (2011) | 117848 [116970, 120003] | 74.223519 [72.924826, 75.257041] | 0.071182 [0.070028, 0.07657] | 0 [0, 0] | 86166 [83479, 101853] |
| 12 (2012) | 136367 [135444, 137900] | 76.045791 [74.860981, 76.635998] | 0.068899 [0.068455, 0.073731] | 0 [0, 0] | 103541 [94677, 117815] |
| 13 (2013) | 154705 [154168, 156903] | 77.667704 [76.674236, 78.308776] | 0.076568 [0.071662, 0.078524] | 0 [0, 0] | 118031 [99527, 137717] |
| 14 (2014) | 174104 [173205, 175759] | 78.45512 [77.515704, 79.332031] | 0.083366 [0.07866, 0.084225] | 0 [0, 0] | 143969 [120500, 152678] |
| 15 (2015) | 193438 [192507, 196065] | 81.414993 [78.703774, 82.109841] | 0.090916 [0.087048, 0.092259] | 0 [0, 0] | 170422 [147859, 183007] |

### base: 256x60_s7 (9 members)

| Year | Population median [min, max] | Approval median [min, max] | Air median [min, max] | I-HT share median [min, max] | Funds § median [min, max] |
|---|---:|---:|---:|---:|---:|
| 10 (2010) | 99805 [96327, 100661] | 63.766704 [61.149211, 64.954071] | 0.071413 [0.068668, 0.093602] | 0 [0, 0] | 61927 [28903, 67380] |
| 11 (2011) | 113853 [110242, 114613] | 62.814081 [60.645472, 63.983095] | 0.063985 [0.060567, 0.086314] | 0 [0, 0] | 72361 [60882, 80726] |
| 12 (2012) | 130372 [125513, 131336] | 63.683548 [62.311963, 69.200914] | 0.057667 [0.053702, 0.065109] | 0 [0, 0] | 90664 [73291, 93015] |
| 13 (2013) | 146299 [141787, 147520] | 65.119033 [61.825443, 69.054131] | 0.057213 [0.052236, 0.064121] | 0 [0, 0] | 95204 [81805, 104823] |
| 14 (2014) | 164018 [159309, 165392] | 66.820458 [63.552755, 70.388871] | 0.056556 [0.050228, 0.066803] | 0 [0, 0] | 114539 [94830, 121141] |
| 15 (2015) | 183457 [177335, 185050] | 69.668167 [64.9593, 71.76116] | 0.054361 [0.049202, 0.070026] | 0 [0, 0] | 133187 [127316, 141545] |
| 16 (2016) | 203263 [196879, 203926] | 70.501708 [68.354865, 71.621632] | 0.056934 [0.049802, 0.069603] | 0 [0, 0] | 146993 [124981, 151082] |
| 17 (2017) | 222540 [217488, 223632] | 71.013004 [69.794856, 71.800009] | 0.061546 [0.05368, 0.074329] | 0 [0, 0] | 153095 [139693, 178336] |
| 18 (2018) | 242866 [238224, 244206] | 70.814482 [70.4978, 72.219855] | 0.064442 [0.052688, 0.070544] | 0 [0, 0] | 177329 [155971, 185075] |
| 19 (2019) | 264535 [260508, 266333] | 71.848884 [69.642209, 72.671516] | 0.058408 [0.052282, 0.065339] | 0 [0, 0] | 198907 [163987, 216220] |
| 20 (2020) | 287400 [282806, 290104] | 72.977411 [70.394822, 73.832165] | 0.058285 [0.052341, 0.062898] | 0 [0, 0] | 225188 [184552, 246008] |
| 21 (2021) | 310568 [306244, 312760] | 74.924547 [70.88797, 75.833436] | 0.056412 [0.05366, 0.0626] | 0 [0, 0] | 247787 [222348, 280178] |
| 22 (2022) | 334462 [330883, 335970] | 76.359858 [72.446576, 76.737218] | 0.056623 [0.053866, 0.060869] | 0 [0, 0] | 269425 [226553, 337979] |
| 23 (2023) | 357684 [354838, 359532] | 76.007566 [72.944774, 76.988528] | 0.060227 [0.054656, 0.064371] | 0 [0, 0] | 327440 [291722, 454909] |
| 24 (2024) | 382124 [378218, 384181] | 76.184779 [73.34452, 76.866991] | 0.06287 [0.058462, 0.068351] | 0 [0, 0] | 631341 [364359, 759147] |
| 25 (2025) | 407842 [405054, 409528] | 76.446113 [74.094739, 77.55497] | 0.065589 [0.058608, 0.069345] | 0 [0, 0] | 989562 [656538, 1123626] |
| 26 (2026) | 434490 [430648, 436617] | 76.984334 [73.974635, 77.388534] | 0.064043 [0.058816, 0.069626] | 0 [0, 0] | 1440595 [1024677, 1574173] |
| 27 (2027) | 462137 [458413, 464707] | 77.461451 [74.69292, 78.127499] | 0.065978 [0.058794, 0.067805] | 0 [0, 0] | 1859886 [1354174, 1999523] |
| 28 (2028) | 491657 [486493, 494483] | 77.521854 [74.64115, 78.237953] | 0.065029 [0.058856, 0.067669] | 0 [0, 0] | 2459785 [1845578, 2615035] |
| 29 (2029) | 522194 [516384, 524671] | 77.958858 [75.610839, 79.358571] | 0.069373 [0.060252, 0.071893] | 0 [0, 0] | 2899014 [2138757, 3052961] |
| 30 (2030) | 552954 [547583, 555979] | 79.510084 [76.500017, 81.314327] | 0.071792 [0.06292, 0.075809] | 0 [0, 0] | 3467398 [2696912, 3529129] |
| 31 (2031) | 584181 [579491, 588317] | 80.547634 [77.075764, 81.699816] | 0.075751 [0.066503, 0.079447] | 0 [0, 0] | 3815392 [3316212, 3891183] |
| 32 (2032) | 616709 [611574, 621027] | 81.492145 [78.059505, 81.906458] | 0.080733 [0.071353, 0.082406] | 0 [0, 0] | 4047164 [3752656, 4217398] |
| 33 (2033) | 649003 [644225, 653428] | 81.793223 [78.958502, 83.023822] | 0.083485 [0.075699, 0.08569] | 0 [0, 0] | 4315853 [4049983, 4525629] |
| 34 (2034) | 681630 [677535, 686441] | 81.300185 [79.003782, 82.826087] | 0.088671 [0.076605, 0.093503] | 0 [0, 0] | 4638107 [4422144, 4769982] |
| 35 (2035) | 714097 [711073, 718917] | 81.678426 [78.670559, 82.713387] | 0.094067 [0.07887, 0.100035] | 0 [0, 0] | 5015830 [4831513, 5190584] |
| 36 (2036) | 747726 [744674, 752615] | 80.796887 [78.471831, 82.48538] | 0.101557 [0.089381, 0.106607] | 0 [0, 0] | 5485871 [5226967, 5600058] |
| 37 (2037) | 781782 [777748, 786585] | 80.891989 [78.564335, 82.103706] | 0.104384 [0.093884, 0.111011] | 0 [0, 0] | 5840926 [5642709, 6104131] |
| 38 (2038) | 816683 [812495, 822163] | 80.841399 [78.811854, 82.234106] | 0.109974 [0.093873, 0.119032] | 0 [0, 0] | 6318326 [6129588, 6544881] |
| 39 (2039) | 852575 [846176, 856092] | 80.960475 [79.374252, 82.276002] | 0.114525 [0.102247, 0.122037] | 0 [0, 0] | 6673130 [6507831, 7059129] |
| 40 (2040) | 886962 [883388, 891864] | 81.343604 [79.076315, 82.512457] | 0.123709 [0.105879, 0.128556] | 0 [0, 0] | 7145817 [6917785, 7640626] |
| 41 (2041) | 922717 [920330, 930563] | 81.08065 [78.643991, 82.59512] | 0.128823 [0.116608, 0.133266] | 0 [0, 0] | 7482173 [7300280, 8014411] |
| 42 (2042) | 959300 [952770, 967176] | 81.136591 [78.316157, 82.306035] | 0.130584 [0.120984, 0.138195] | 0 [0, 0] | 7869255 [7759353, 8476986] |
| 43 (2043) | 996811 [990717, 1004766] | 81.165148 [78.383998, 81.965667] | 0.13672 [0.120754, 0.150027] | 0 [0, 0] | 8267125 [8099490, 8880015] |
| 44 (2044) | 1031347 [1027864, 1039148] | 80.29362 [77.495271, 81.729538] | 0.140445 [0.127016, 0.151311] | 0 [0, 0.014722] | 8722022 [8470891, 9485748] |
| 45 (2045) | 1069207 [1066667, 1073574] | 79.966431 [79.157552, 81.386266] | 0.148581 [0.128158, 0.157007] | 0 [0, 0.031345] | 9232778 [8856506, 10127834] |
| 46 (2046) | 1107271 [1102365, 1116949] | 79.63525 [78.198681, 80.978305] | 0.146531 [0.130014, 0.159668] | 0 [0, 0.034288] | 9654841 [9253964, 10768452] |
| 47 (2047) | 1145756 [1141692, 1153498] | 79.465842 [77.522211, 80.421353] | 0.151186 [0.139783, 0.163529] | 0 [0, 0.048285] | 9998972 [9675938, 11467443] |
| 48 (2048) | 1187007 [1160334, 1202151] | 79.820106 [78.581902, 81.151647] | 0.152234 [0.132063, 0.167734] | 0 [0, 0.054255] | 10396789 [10099762, 12154414] |
| 49 (2049) | 1225266 [1165289, 1241119] | 79.570806 [78.251407, 80.988061] | 0.159876 [0.142931, 0.170673] | 0 [0, 0.064601] | 10785035 [10505729, 12900248] |
| 50 (2050) | 1268184 [1182862, 1285593] | 79.449944 [78.267429, 81.333944] | 0.161183 [0.142952, 0.17113] | 0 [0, 0.072252] | 11186254 [10888948, 13618378] |
| 51 (2051) | 1312584 [1187793, 1327351] | 79.01355 [77.964813, 80.420885] | 0.163105 [0.149001, 0.17819] | 0 [0, 0.077209] | 11537907 [11271140, 14288036] |
| 52 (2052) | 1350533 [1196825, 1357754] | 79.084369 [77.981114, 80.388199] | 0.164705 [0.145123, 0.178214] | 0.0064 [0, 0.091464] | 11905384 [11609705, 14943418] |
| 53 (2053) | 1394939 [1203986, 1405494] | 79.049333 [78.011883, 80.011445] | 0.162212 [0.142651, 0.176089] | 0.0143 [0, 0.099753] | 12254442 [11946531, 15622959] |
| 54 (2054) | 1413586 [1214865, 1436011] | 79.589127 [78.184368, 80.746457] | 0.162055 [0.149793, 0.175057] | 0.022374 [0, 0.112197] | 12656110 [12312383, 16349079] |
| 55 (2055) | 1433609 [1216494, 1453571] | 79.292209 [78.115669, 80.426761] | 0.164717 [0.146508, 0.176449] | 0.032746 [0, 0.124326] | 13057182 [12702866, 17075942] |
| 56 (2056) | 1454275 [1220807, 1470342] | 78.925527 [78.095636, 80.829254] | 0.170223 [0.150051, 0.18584] | 0.036327 [0, 0.135826] | 13491968 [13102757, 17848246] |
| 57 (2057) | 1471662 [1233390, 1485501] | 79.066686 [78.007272, 80.918187] | 0.166209 [0.151658, 0.181184] | 0.048173 [0, 0.15287] | 13944964 [13558285, 18652535] |
| 58 (2058) | 1482212 [1239573, 1498817] | 79.021368 [78.538809, 81.175727] | 0.172405 [0.150933, 0.179669] | 0.057354 [0, 0.164295] | 14437494 [14035528, 19463748] |
| 59 (2059) | 1485043 [1252293, 1510814] | 78.919735 [78.154327, 81.195575] | 0.172519 [0.147589, 0.191729] | 0.063074 [0, 0.16983] | 14952046 [14532230, 20305016] |
| 60 (2060) | 1496254 [1256440, 1520331] | 78.536264 [78.085477, 80.331851] | 0.171832 [0.154908, 0.190418] | 0.071239 [0, 0.169344] | 15496979 [15054435, 21148878] |

### base: 256x60_s11 (9 members)

| Year | Population median [min, max] | Approval median [min, max] | Air median [min, max] | I-HT share median [min, max] | Funds § median [min, max] |
|---|---:|---:|---:|---:|---:|
| 10 (2010) | 98588 [97312, 99239] | 62.34115 [59.564429, 64.179255] | 0.068042 [0.063988, 0.073968] | 0.011507 [0, 0.019063] | 59970 [38239, 68160] |
| 11 (2011) | 112761 [111697, 113666] | 62.520596 [60.373376, 63.250733] | 0.059732 [0.057833, 0.062314] | 0.010419 [0, 0.03724] | 66754 [48404, 71677] |
| 12 (2012) | 128821 [126887, 129550] | 62.976866 [61.526176, 64.035101] | 0.058289 [0.053516, 0.059161] | 0.009602 [0, 0.032776] | 86885 [63511, 91711] |
| 13 (2013) | 145063 [143268, 146355] | 63.9106 [61.482789, 64.560277] | 0.055725 [0.051859, 0.057635] | 0.009408 [0, 0.027754] | 102217 [96825, 105193] |
| 14 (2014) | 163449 [161053, 164301] | 65.309423 [63.968069, 68.811547] | 0.055164 [0.050955, 0.060081] | 0.009044 [0, 0.023251] | 105236 [97223, 116253] |
| 15 (2015) | 182422 [180541, 183546] | 69.412091 [68.286611, 69.878624] | 0.054755 [0.052947, 0.060886] | 0.007649 [0, 0.021553] | 132853 [128813, 134612] |
| 16 (2016) | 201972 [199908, 203259] | 69.994162 [68.841191, 70.887109] | 0.060211 [0.056903, 0.067934] | 0.006903 [0, 0.01567] | 147281 [143334, 148392] |
| 17 (2017) | 221834 [220257, 224275] | 70.179885 [68.942524, 72.131049] | 0.062745 [0.059013, 0.066001] | 0.006504 [0, 0.012716] | 150427 [138039, 166618] |
| 18 (2018) | 242497 [240643, 245578] | 71.110678 [68.89898, 72.400815] | 0.064043 [0.055227, 0.066137] | 0.006252 [0, 0.010334] | 181423 [159565, 194149] |
| 19 (2019) | 264414 [261484, 267372] | 71.463439 [69.690161, 73.900814] | 0.058022 [0.054013, 0.064399] | 0.001577 [0, 0.008796] | 181443 [169739, 214992] |
| 20 (2020) | 286680 [284039, 290891] | 72.888913 [71.321966, 75.408151] | 0.058243 [0.053881, 0.063146] | 0 [0, 0.008717] | 222745 [186613, 235916] |
| 21 (2021) | 310034 [307559, 314964] | 72.899423 [72.486703, 76.028911] | 0.059 [0.053514, 0.063682] | 0 [0, 0.008717] | 255454 [203269, 298327] |
| 22 (2022) | 333269 [330612, 338312] | 74.491468 [73.175195, 77.594433] | 0.061384 [0.055541, 0.067552] | 0 [0, 0.008728] | 282798 [218423, 345826] |
| 23 (2023) | 357015 [354581, 362506] | 76.228676 [72.682105, 77.504944] | 0.062296 [0.057453, 0.068679] | 0 [0, 0.008742] | 344711 [256723, 661735] |
| 24 (2024) | 381553 [377995, 387163] | 75.993698 [72.272321, 77.01467] | 0.066151 [0.060331, 0.070993] | 0 [0, 0.008737] | 431106 [347569, 1010534] |
| 25 (2025) | 407190 [403731, 411485] | 76.03409 [72.961967, 77.523765] | 0.068466 [0.062541, 0.073518] | 0 [0, 0.008694] | 721074 [481517, 1454306] |
| 26 (2026) | 433234 [429055, 437629] | 76.371722 [74.224208, 77.907145] | 0.06914 [0.062028, 0.075539] | 0 [0, 0.008695] | 1060353 [676471, 1979480] |
| 27 (2027) | 461453 [456856, 465065] | 76.932484 [73.424759, 77.893342] | 0.066989 [0.063765, 0.073544] | 0 [0, 0.008696] | 1389086 [1053169, 2594771] |
| 28 (2028) | 490335 [485734, 493495] | 77.017163 [73.520908, 79.287554] | 0.070046 [0.061939, 0.076404] | 0 [0, 0.008697] | 1900573 [1505170, 2979129] |
| 29 (2029) | 520729 [515999, 523527] | 77.509737 [74.760411, 81.10573] | 0.072961 [0.065963, 0.076361] | 0 [0, 0.008675] | 2234771 [1793731, 3029671] |
| 30 (2030) | 551648 [546635, 554603] | 78.438929 [75.609358, 80.897437] | 0.076201 [0.069993, 0.081466] | 0 [0, 0.008554] | 2880221 [2380503, 3437822] |
| 31 (2031) | 582621 [577631, 585909] | 78.76092 [75.46014, 81.696786] | 0.080226 [0.071233, 0.084951] | 0 [0, 0.007747] | 3462914 [3015240, 3797225] |
| 32 (2032) | 614477 [609435, 617804] | 80.040413 [77.406856, 81.21733] | 0.085091 [0.074722, 0.088566] | 0 [0, 0.007283] | 3802934 [3612474, 4077255] |
| 33 (2033) | 647124 [641761, 650441] | 80.301667 [76.441675, 82.086424] | 0.089552 [0.075847, 0.091746] | 0 [0, 0.004662] | 4152528 [3984784, 4369371] |
| 34 (2034) | 679325 [673214, 681529] | 80.596939 [76.943669, 82.075708] | 0.094699 [0.081086, 0.101154] | 0 [0, 0.000732] | 4518536 [4399508, 4630976] |
| 35 (2035) | 712455 [706013, 714481] | 80.420354 [78.320375, 82.667365] | 0.099574 [0.08618, 0.105314] | 0 [0, 0.000699] | 4871085 [4675447, 5016785] |
| 36 (2036) | 745401 [739954, 747598] | 80.75302 [78.054193, 82.126595] | 0.10438 [0.092222, 0.108496] | 0 [0, 0.000684] | 5234540 [4947276, 5405402] |
| 37 (2037) | 779800 [774221, 781717] | 80.546078 [78.225702, 82.021612] | 0.111016 [0.101145, 0.120577] | 0 [0, 0.000677] | 5524120 [5223880, 5703251] |
| 38 (2038) | 813642 [808774, 818403] | 80.131396 [77.769821, 81.07917] | 0.115916 [0.105588, 0.119128] | 0 [0, 0.000679] | 5839452 [5559635, 6131425] |
| 39 (2039) | 850633 [843625, 853111] | 79.849776 [77.621902, 82.03762] | 0.120515 [0.107345, 0.12539] | 0 [0, 0.000683] | 6179389 [5892558, 6580519] |
| 40 (2040) | 884767 [878891, 887639] | 80.259669 [77.218423, 81.977626] | 0.124523 [0.110749, 0.128784] | 0 [0, 0.000683] | 6580521 [6260258, 7098407] |
| 41 (2041) | 919393 [913042, 923116] | 79.84247 [77.141359, 81.615005] | 0.12733 [0.117083, 0.133867] | 0 [0, 0.000683] | 7021118 [6688759, 7658661] |
| 42 (2042) | 955674 [949227, 960410] | 79.888446 [77.203352, 81.940665] | 0.133745 [0.12056, 0.137301] | 0 [0, 0.000695] | 7494685 [7176379, 8245836] |
| 43 (2043) | 989973 [987019, 998712] | 79.481837 [77.259153, 81.782119] | 0.131742 [0.121364, 0.147596] | 0 [0, 0.017135] | 7924555 [7589321, 8809276] |
| 44 (2044) | 1029229 [1019602, 1037824] | 79.479338 [77.035945, 80.47923] | 0.13938 [0.125804, 0.151151] | 0 [0, 0.026582] | 8511728 [8059155, 9490596] |
| 45 (2045) | 1065576 [1055060, 1075070] | 79.291934 [76.171337, 80.459077] | 0.141357 [0.130722, 0.152355] | 0 [0, 0.04346] | 9146734 [8570722, 10225311] |
| 46 (2046) | 1106206 [1091856, 1113713] | 78.879259 [76.389599, 79.973131] | 0.143724 [0.134398, 0.15868] | 0 [0, 0.058489] | 9775412 [9017861, 10942747] |
| 47 (2047) | 1144354 [1124568, 1152676] | 78.832784 [76.060275, 80.056338] | 0.150713 [0.135237, 0.161026] | 0.005939 [0, 0.073837] | 10462465 [9526340, 11741081] |
| 48 (2048) | 1186766 [1148827, 1192250] | 78.815334 [76.446938, 80.391814] | 0.151245 [0.133104, 0.156841] | 0.015826 [0, 0.089849] | 11180044 [10043209, 12552304] |
| 49 (2049) | 1223139 [1159882, 1234162] | 78.352092 [76.022768, 80.065179] | 0.154156 [0.145972, 0.162424] | 0.018322 [0, 0.10303] | 11915365 [10568328, 13392085] |
| 50 (2050) | 1243264 [1170082, 1272071] | 78.402297 [75.902564, 80.193804] | 0.152849 [0.145799, 0.169482] | 0.027627 [0, 0.117172] | 12473461 [11060633, 14237089] |
| 51 (2051) | 1280572 [1182562, 1316077] | 78.296965 [75.710994, 79.455673] | 0.161419 [0.145471, 0.167406] | 0.031509 [0, 0.122985] | 13264762 [11541506, 15134117] |
| 52 (2052) | 1301309 [1188069, 1357255] | 78.186875 [76.050859, 79.307737] | 0.156905 [0.147843, 0.173124] | 0.052457 [0, 0.13463] | 14097699 [12017108, 16068336] |
| 53 (2053) | 1319909 [1210069, 1399479] | 78.726026 [76.003999, 79.599566] | 0.159397 [0.142484, 0.176143] | 0.065576 [0, 0.140914] | 14923733 [12449490, 16586876] |
| 54 (2054) | 1324744 [1220783, 1449861] | 78.564753 [75.650166, 80.097636] | 0.155754 [0.147536, 0.171325] | 0.07174 [0, 0.150285] | 15781011 [12935494, 17042306] |
| 55 (2055) | 1340518 [1231760, 1482868] | 78.648991 [75.881841, 79.727576] | 0.164192 [0.149661, 0.16985] | 0.081442 [0.010379, 0.151346] | 16667086 [13395627, 17519562] |
| 56 (2056) | 1351653 [1230762, 1498800] | 78.491431 [75.599772, 79.677537] | 0.160506 [0.142997, 0.171985] | 0.092602 [0.024852, 0.157839] | 17498286 [13877526, 18127172] |
| 57 (2057) | 1371210 [1237788, 1520321] | 78.595444 [75.227097, 80.385738] | 0.161708 [0.148154, 0.180696] | 0.105868 [0.029101, 0.166144] | 17926358 [14395102, 18919123] |
| 58 (2058) | 1385711 [1246846, 1530327] | 79.092677 [75.845284, 80.579784] | 0.159664 [0.146026, 0.17067] | 0.111186 [0.03762, 0.171267] | 18369146 [14919909, 19712108] |
| 59 (2059) | 1396156 [1257668, 1541900] | 78.801706 [75.142517, 80.279399] | 0.15642 [0.142946, 0.170458] | 0.123244 [0.042116, 0.177912] | 18762074 [15442091, 20492900] |
| 60 (2060) | 1394211 [1261054, 1544601] | 79.188666 [75.479611, 80.581182] | 0.161386 [0.147366, 0.176198] | 0.13585 [0.045395, 0.183416] | 19327827 [15945616, 21274706] |

### subway: 256x60_s7 (9 members)

| Year | Population median [min, max] | Approval median [min, max] | Air median [min, max] | I-HT share median [min, max] | Funds § median [min, max] |
|---|---:|---:|---:|---:|---:|
| 10 (2010) | 99805 [96327, 100661] | 63.766704 [61.149211, 64.954071] | 0.071413 [0.068668, 0.093602] | 0 [0, 0] | 61927 [28903, 67380] |
| 11 (2011) | 113853 [110242, 114613] | 62.814081 [60.645472, 63.983095] | 0.063985 [0.060567, 0.086314] | 0 [0, 0] | 72361 [60882, 80726] |
| 12 (2012) | 130372 [125513, 131336] | 63.683548 [62.311963, 69.200914] | 0.057667 [0.053702, 0.065109] | 0 [0, 0] | 90664 [73291, 93015] |
| 13 (2013) | 146299 [141787, 147520] | 65.119033 [61.825443, 69.054131] | 0.057213 [0.052236, 0.064121] | 0 [0, 0] | 95204 [81805, 104823] |
| 14 (2014) | 164018 [159309, 165392] | 66.820458 [63.552755, 70.388871] | 0.056556 [0.050228, 0.066803] | 0 [0, 0] | 114539 [94830, 121141] |
| 15 (2015) | 183457 [177335, 185050] | 69.668167 [64.9593, 71.76116] | 0.054361 [0.049202, 0.070026] | 0 [0, 0] | 133187 [127316, 141545] |
| 16 (2016) | 203263 [196879, 203926] | 70.501708 [68.354865, 71.621632] | 0.056934 [0.049802, 0.069603] | 0 [0, 0] | 146993 [124981, 151082] |
| 17 (2017) | 222540 [217488, 223632] | 71.013004 [69.794856, 71.800009] | 0.061546 [0.05368, 0.074329] | 0 [0, 0] | 153095 [139693, 178336] |
| 18 (2018) | 242866 [238224, 244206] | 70.814482 [70.4978, 72.219855] | 0.064442 [0.052688, 0.070544] | 0 [0, 0] | 177329 [155971, 185075] |
| 19 (2019) | 264535 [260508, 266333] | 71.848884 [69.642209, 72.671516] | 0.058408 [0.052282, 0.065339] | 0 [0, 0] | 198907 [163987, 216220] |
| 20 (2020) | 287400 [282806, 290104] | 72.977411 [70.394822, 73.832165] | 0.058285 [0.052341, 0.062898] | 0 [0, 0] | 225188 [184552, 246008] |
| 21 (2021) | 310568 [306244, 312760] | 74.924547 [70.88797, 75.833436] | 0.056412 [0.05366, 0.0626] | 0 [0, 0] | 247787 [222348, 280178] |
| 22 (2022) | 334462 [330883, 335970] | 76.359858 [72.446576, 76.737218] | 0.056623 [0.053866, 0.060869] | 0 [0, 0] | 269425 [226553, 337979] |
| 23 (2023) | 357919 [354838, 359174] | 75.80771 [72.944774, 76.988528] | 0.060469 [0.054656, 0.064064] | 0 [0, 0] | 327440 [291722, 420254] |
| 24 (2024) | 382520 [378594, 383658] | 76.218921 [73.34452, 77.458326] | 0.064183 [0.058811, 0.068024] | 0 [0, 0] | 574820 [321465, 717514] |
| 25 (2025) | 407687 [404288, 409874] | 76.452521 [73.888877, 77.654484] | 0.064863 [0.056624, 0.067471] | 0 [0, 0] | 909132 [606072, 1079447] |
| 26 (2026) | 434022 [430416, 436430] | 76.482193 [73.328681, 77.9934] | 0.064077 [0.057696, 0.067402] | 0 [0, 0] | 1342895 [941711, 1500277] |
| 27 (2027) | 462759 [458114, 464825] | 77.39438 [74.610262, 78.026033] | 0.063832 [0.058959, 0.066421] | 0 [0, 0] | 1732403 [1222112, 1909971] |
| 28 (2028) | 491523 [486930, 494260] | 77.836594 [74.873108, 78.127682] | 0.065712 [0.058232, 0.067844] | 0 [0, 0] | 2309676 [1710344, 2514154] |
| 29 (2029) | 522608 [517104, 524867] | 78.034589 [75.588862, 78.955879] | 0.06967 [0.062224, 0.072142] | 0 [0, 0] | 2732355 [1992979, 2954125] |
| 30 (2030) | 553318 [547458, 555841] | 79.086785 [76.156402, 80.368224] | 0.072182 [0.063578, 0.072931] | 0 [0, 0] | 3415455 [2513349, 3485387] |
| 31 (2031) | 585183 [579646, 588175] | 80.881927 [76.755335, 81.625455] | 0.075874 [0.068453, 0.080135] | 0 [0, 0] | 3750330 [3131524, 3825726] |
| 32 (2032) | 616561 [611504, 621068] | 80.953814 [77.916543, 82.321093] | 0.079681 [0.072072, 0.082236] | 0 [0, 0] | 4036765 [3757396, 4233845] |
| 33 (2033) | 649055 [644231, 653598] | 81.604119 [78.545771, 82.728838] | 0.08596 [0.073117, 0.089288] | 0 [0, 0] | 4311612 [4048301, 4509109] |
| 34 (2034) | 681898 [676985, 687293] | 81.563132 [78.732822, 82.568611] | 0.088456 [0.076994, 0.092334] | 0 [0, 0] | 4610332 [4400175, 4804982] |
| 35 (2035) | 715794 [710723, 718963] | 81.583892 [78.728348, 82.399192] | 0.091973 [0.080886, 0.095609] | 0 [0, 0] | 4957461 [4794149, 5195282] |
| 36 (2036) | 748121 [744510, 751692] | 81.42835 [78.395537, 82.556335] | 0.100249 [0.088803, 0.104652] | 0 [0, 0] | 5367643 [5271108, 5665416] |
| 37 (2037) | 783241 [778238, 786566] | 81.530489 [77.810763, 81.948708] | 0.106533 [0.093151, 0.109669] | 0 [0, 0] | 5754535 [5683861, 6090049] |
| 38 (2038) | 815965 [813738, 820691] | 80.666343 [78.092389, 81.801436] | 0.110131 [0.097057, 0.118983] | 0 [0, 0] | 6238586 [5988973, 6381300] |
| 39 (2039) | 852386 [849520, 856500] | 81.016158 [78.55266, 82.178521] | 0.116316 [0.099139, 0.120453] | 0 [0, 0] | 6723256 [6350396, 6900017] |
| 40 (2040) | 888704 [885201, 891505] | 81.4663 [79.15136, 82.957376] | 0.119763 [0.105385, 0.12622] | 0 [0, 0] | 7047383 [6756140, 7456275] |
| 41 (2041) | 923277 [921543, 928816] | 80.719343 [80.329433, 82.670782] | 0.127662 [0.108013, 0.131618] | 0 [0, 0] | 7372518 [7215568, 8083433] |
| 42 (2042) | 958470 [954307, 964137] | 80.49561 [79.574306, 82.345689] | 0.131523 [0.116559, 0.13824] | 0 [0, 0] | 7811594 [7685071, 8466534] |
| 43 (2043) | 997050 [992409, 1001918] | 80.575252 [79.555891, 82.398605] | 0.130108 [0.11865, 0.144857] | 0 [0, 0] | 8323914 [8001012, 9025596] |
| 44 (2044) | 1035842 [1030994, 1040964] | 80.992057 [78.639615, 81.992759] | 0.13985 [0.128383, 0.145809] | 0 [0, 0] | 8816351 [8350525, 9677655] |
| 45 (2045) | 1070449 [1066858, 1079058] | 80.174425 [79.103414, 81.13914] | 0.148749 [0.132113, 0.154087] | 0 [0, 0.003314] | 9223543 [8749998, 10334697] |
| 46 (2046) | 1109496 [1103520, 1113850] | 79.333414 [79.097413, 80.919687] | 0.151226 [0.131688, 0.156413] | 0 [0, 0.02095] | 9763966 [9169277, 10987365] |
| 47 (2047) | 1150637 [1142827, 1155557] | 79.925734 [78.193747, 80.964899] | 0.152831 [0.137567, 0.156687] | 0 [0, 0.038593] | 10202078 [9599768, 11662858] |
| 48 (2048) | 1191833 [1167186, 1201276] | 79.560469 [79.20706, 81.148158] | 0.152438 [0.133154, 0.162401] | 0 [0, 0.050638] | 10650804 [9939638, 12345769] |
| 49 (2049) | 1230748 [1180886, 1241539] | 79.789114 [78.406903, 80.483067] | 0.158391 [0.136573, 0.166861] | 0 [0, 0.061252] | 11104074 [10217919, 13023129] |
| 50 (2050) | 1271264 [1187399, 1283660] | 79.282725 [78.444375, 80.705176] | 0.159655 [0.137711, 0.172245] | 0 [0, 0.072917] | 11547424 [10466095, 13685023] |
| 51 (2051) | 1317166 [1200455, 1330774] | 79.25367 [78.080172, 80.89853] | 0.162777 [0.143089, 0.171692] | 0 [0, 0.079262] | 11923639 [10727802, 14322971] |
| 52 (2052) | 1356259 [1216150, 1363251] | 78.894107 [78.101153, 79.935793] | 0.162208 [0.138785, 0.169161] | 0 [0, 0.078511] | 12326860 [10985870, 14989610] |
| 53 (2053) | 1398433 [1224778, 1408482] | 78.953871 [78.491368, 80.069578] | 0.163966 [0.13845, 0.176317] | 0.013588 [0, 0.094038] | 12737658 [11237271, 15697129] |
| 54 (2054) | 1424145 [1220205, 1458135] | 79.686394 [78.609206, 81.022668] | 0.159459 [0.141819, 0.171091] | 0.017187 [0, 0.104807] | 13242197 [11522418, 16445541] |
| 55 (2055) | 1444114 [1224941, 1483248] | 79.332997 [78.108409, 80.254476] | 0.166865 [0.144149, 0.171822] | 0.03358 [0, 0.110073] | 13745534 [11825194, 17218591] |
| 56 (2056) | 1445237 [1231784, 1509627] | 79.714555 [78.495601, 80.321103] | 0.164866 [0.148283, 0.182773] | 0.041547 [0, 0.111107] | 14274217 [12158248, 18041227] |
| 57 (2057) | 1464578 [1243985, 1531989] | 79.267358 [78.372144, 80.665139] | 0.170781 [0.145951, 0.17253] | 0.051465 [0, 0.125084] | 14819738 [12519826, 18909528] |
| 58 (2058) | 1471518 [1257070, 1550981] | 79.100511 [77.318745, 80.427205] | 0.167707 [0.13753, 0.178382] | 0.064477 [0, 0.139019] | 15395373 [12890171, 19791330] |
| 59 (2059) | 1490077 [1274662, 1578247] | 79.453448 [78.185937, 80.414795] | 0.169599 [0.144711, 0.178136] | 0.088996 [0, 0.154488] | 15999856 [13296854, 20726037] |
| 60 (2060) | 1497147 [1283912, 1587140] | 79.324971 [78.761438, 80.57552] | 0.170989 [0.14719, 0.176127] | 0.112148 [0, 0.163249] | 16624794 [13723486, 21690332] |

### skipTransit: 256x60_s7 (9 members)

| Year | Population median [min, max] | Approval median [min, max] | Air median [min, max] | I-HT share median [min, max] | Funds § median [min, max] |
|---|---:|---:|---:|---:|---:|
| 10 (2010) | 99897 [96286, 100581] | 64.719945 [62.688762, 65.351255] | 0.073163 [0.064221, 0.082583] | 0 [0, 0.020027] | 48668 [36713, 65730] |
| 11 (2011) | 114156 [110064, 114602] | 63.573983 [61.812477, 64.485362] | 0.062425 [0.06078, 0.073345] | 0 [0, 0.018263] | 70802 [60390, 78121] |
| 12 (2012) | 130336 [125986, 131097] | 64.045183 [61.980048, 67.538119] | 0.056783 [0.053761, 0.06202] | 0 [0, 0.01651] | 88799 [71342, 93065] |
| 13 (2013) | 146537 [141440, 147253] | 64.622823 [62.55325, 68.269274] | 0.056102 [0.051911, 0.059341] | 0 [0, 0.015344] | 98620 [91118, 104218] |
| 14 (2014) | 164107 [159403, 165736] | 68.264438 [66.521431, 70.047763] | 0.054612 [0.050425, 0.061483] | 0 [0, 0.014877] | 112830 [101179, 122015] |
| 15 (2015) | 183689 [178466, 184822] | 69.763602 [69.063137, 71.61923] | 0.052259 [0.049682, 0.065652] | 0 [0, 0.014766] | 133958 [114316, 137953] |
| 16 (2016) | 202353 [198170, 204090] | 70.666783 [69.944077, 71.192006] | 0.056414 [0.049608, 0.069464] | 0 [0, 0.014757] | 146488 [135613, 152720] |
| 17 (2017) | 222118 [217492, 224177] | 70.520795 [69.856434, 71.686129] | 0.059691 [0.05312, 0.067424] | 0 [0, 0.01475] | 157404 [141465, 172962] |
| 18 (2018) | 242666 [238101, 244435] | 70.852842 [69.332325, 73.058077] | 0.058775 [0.053069, 0.070544] | 0 [0, 0.015] | 175747 [158057, 188511] |
| 19 (2019) | 264224 [259371, 266557] | 72.176262 [69.185139, 75.479275] | 0.057119 [0.052595, 0.061337] | 0 [0, 0.01493] | 196213 [188034, 227864] |
| 20 (2020) | 287126 [282570, 289260] | 74.931603 [70.431098, 76.159065] | 0.059105 [0.053447, 0.064022] | 0 [0, 0.014964] | 223757 [191915, 264878] |
| 21 (2021) | 310101 [305748, 312088] | 75.81105 [71.990355, 76.410685] | 0.059619 [0.05629, 0.064077] | 0 [0, 0.014748] | 265627 [240840, 318483] |
| 22 (2022) | 332800 [328624, 335570] | 76.055642 [72.726371, 76.881391] | 0.061234 [0.055978, 0.068164] | 0 [0, 0.014743] | 275303 [218412, 504130] |
| 23 (2023) | 357092 [351918, 359697] | 76.178644 [72.655386, 77.163622] | 0.065013 [0.058228, 0.072672] | 0 [0, 0.014735] | 502775 [281670, 855605] |
| 24 (2024) | 381601 [375788, 384965] | 76.324364 [72.446976, 77.377164] | 0.067358 [0.061201, 0.075291] | 0 [0, 0.014787] | 855982 [414922, 1258970] |
| 25 (2025) | 406275 [401482, 410139] | 76.06 [72.79105, 77.334508] | 0.071957 [0.060792, 0.07956] | 0 [0, 0.014786] | 1289258 [721679, 1721124] |
| 26 (2026) | 432950 [426930, 436717] | 76.459116 [73.454879, 77.145523] | 0.070244 [0.061912, 0.082826] | 0 [0, 0.014791] | 1804862 [1105727, 2292022] |
| 27 (2027) | 459994 [454259, 465532] | 77.02027 [74.326632, 78.541746] | 0.069825 [0.064112, 0.078127] | 0 [0, 0.014809] | 2335238 [1439787, 2778841] |
| 28 (2028) | 488608 [483174, 495060] | 77.803546 [74.615215, 79.997921] | 0.070887 [0.064354, 0.085459] | 0 [0, 0.014806] | 2891042 [1993290, 2974435] |
| 29 (2029) | 519489 [512412, 525304] | 79.714106 [74.588522, 81.140104] | 0.076794 [0.067612, 0.086557] | 0 [0, 0.014754] | 2860546 [2380580, 3025824] |
| 30 (2030) | 549618 [541617, 555061] | 80.029797 [76.02882, 81.307419] | 0.081078 [0.072088, 0.094228] | 0 [0, 0.014748] | 3096307 [3018265, 3347028] |
| 31 (2031) | 581290 [572169, 586945] | 80.413096 [77.316917, 81.868519] | 0.085366 [0.076094, 0.098826] | 0 [0, 0.01485] | 3496399 [3274773, 3698366] |
| 32 (2032) | 612088 [604111, 618006] | 80.890138 [77.064437, 81.993745] | 0.090429 [0.079201, 0.101872] | 0 [0, 0.014183] | 3806976 [3548062, 3930568] |
| 33 (2033) | 643723 [634306, 650076] | 80.310204 [77.251814, 82.132937] | 0.097363 [0.083966, 0.112673] | 0 [0, 0.013569] | 4172786 [3902177, 4326761] |
| 34 (2034) | 676797 [666143, 681964] | 80.57721 [77.050375, 82.245599] | 0.105922 [0.086865, 0.118878] | 0 [0, 0.013002] | 4515835 [4300379, 4720763] |
| 35 (2035) | 708785 [699908, 713098] | 80.761592 [77.412344, 81.819859] | 0.106575 [0.092446, 0.118964] | 0 [0, 0.007342] | 4880158 [4608163, 4980658] |
| 36 (2036) | 740893 [732869, 746134] | 80.491453 [77.845903, 82.206365] | 0.115594 [0.100665, 0.129874] | 0 [0, 0.006943] | 5243031 [4887379, 5282224] |
| 37 (2037) | 774369 [765334, 779841] | 80.070729 [76.827368, 81.474692] | 0.125782 [0.105814, 0.137979] | 0 [0, 0.006638] | 5552435 [5180533, 5676297] |
| 38 (2038) | 807729 [798954, 814480] | 80.072673 [76.266423, 81.293254] | 0.132199 [0.105587, 0.142349] | 0 [0, 0.002076] | 5838337 [5483063, 6145572] |
| 39 (2039) | 841630 [832962, 847177] | 80.051254 [77.027403, 81.307311] | 0.128846 [0.113681, 0.146723] | 0 [0, 0] | 6177497 [5805165, 6642053] |
| 40 (2040) | 875976 [867226, 882641] | 79.961815 [76.459861, 81.059147] | 0.137235 [0.122975, 0.152257] | 0 [0, 0] | 6584716 [6190416, 7220258] |
| 41 (2041) | 910212 [902257, 917508] | 79.171175 [76.670271, 81.155376] | 0.149642 [0.123493, 0.160336] | 0 [0, 0] | 7025307 [6605495, 7709384] |
| 42 (2042) | 944292 [937679, 954516] | 79.082894 [76.144973, 80.614943] | 0.148556 [0.129772, 0.16712] | 0 [0, 0] | 7540559 [7079890, 8350839] |
| 43 (2043) | 981433 [972387, 988644] | 78.871509 [76.581415, 80.07453] | 0.151415 [0.134679, 0.170203] | 0 [0, 0] | 7960423 [7590476, 8867309] |
| 44 (2044) | 1018813 [1008016, 1028446] | 78.621694 [75.474428, 80.107707] | 0.164618 [0.138073, 0.171017] | 0 [0, 0.00085] | 8540140 [7991956, 9073914] |
| 45 (2045) | 1055648 [1047814, 1070124] | 78.871375 [75.268964, 79.940151] | 0.167684 [0.145793, 0.174274] | 0 [0, 0.006346] | 8953987 [8416116, 9616550] |
| 46 (2046) | 1093320 [1082083, 1109914] | 78.063117 [75.460516, 79.591247] | 0.171246 [0.1438, 0.181816] | 0 [0, 0.019269] | 9468877 [8820936, 10264207] |
| 47 (2047) | 1130469 [1122156, 1146119] | 78.13582 [75.777972, 80.116787] | 0.176218 [0.145506, 0.182212] | 0 [0, 0.02954] | 9888866 [9250401, 10885480] |
| 48 (2048) | 1150171 [1137590, 1180769] | 78.443707 [75.846965, 80.255136] | 0.171347 [0.153867, 0.195212] | 0 [0, 0.038428] | 10455599 [9694698, 11530593] |
| 49 (2049) | 1156463 [1146555, 1220866] | 78.326882 [75.576826, 78.897223] | 0.180248 [0.156325, 0.185448] | 0 [0, 0.050437] | 11030201 [10169399, 12197496] |
| 50 (2050) | 1175853 [1156617, 1265943] | 77.767059 [75.669897, 79.187949] | 0.176565 [0.152007, 0.19007] | 0 [0, 0.054239] | 11616682 [10656215, 12884139] |
| 51 (2051) | 1193094 [1161016, 1305283] | 77.831286 [75.324908, 78.500487] | 0.178724 [0.164074, 0.188822] | 0 [0, 0.06189] | 12133874 [11018226, 13579373] |
| 52 (2052) | 1207256 [1169934, 1330457] | 77.675978 [74.407945, 78.507809] | 0.169174 [0.161435, 0.189615] | 0 [0, 0.081473] | 12662454 [11371032, 14304704] |
| 53 (2053) | 1221312 [1168766, 1347476] | 77.43845 [75.145544, 78.251214] | 0.184862 [0.163951, 0.193385] | 0 [0, 0.105738] | 13219041 [11737630, 15016883] |
| 54 (2054) | 1234114 [1176689, 1356728] | 77.699796 [75.464738, 78.67536] | 0.17815 [0.160624, 0.19171] | 0 [0, 0.11041] | 13791276 [12129500, 15737961] |
| 55 (2055) | 1247247 [1177426, 1358431] | 77.834505 [75.238258, 78.593716] | 0.180925 [0.163767, 0.189249] | 0 [0, 0.126059] | 14384516 [12528389, 16479042] |
| 56 (2056) | 1251852 [1177394, 1355034] | 77.80115 [75.614705, 78.611911] | 0.177102 [0.170726, 0.196858] | 0 [0, 0.132957] | 14986384 [12898280, 17237810] |
| 57 (2057) | 1271978 [1178037, 1364627] | 77.721993 [75.429422, 78.390342] | 0.186602 [0.163006, 0.195487] | 0 [0, 0.136188] | 15605899 [13250182, 17982789] |
| 58 (2058) | 1270951 [1177863, 1362534] | 77.674759 [75.227528, 78.509421] | 0.182559 [0.164267, 0.1999] | 0 [0, 0.145996] | 16228099 [13603884, 18755139] |
| 59 (2059) | 1270759 [1179280, 1368762] | 77.778016 [75.408904, 78.568145] | 0.185731 [0.160799, 0.195992] | 0 [0, 0.156001] | 16860878 [13950380, 19513550] |
| 60 (2060) | 1265455 [1179555, 1366306] | 77.608125 [75.629919, 78.213827] | 0.186909 [0.170068, 0.199309] | 0 [0, 0.167265] | 17481480 [14317297, 20277318] |

### devSubway: 256x60_s7 (9 members)

| Year | Population median [min, max] | Approval median [min, max] | Air median [min, max] | I-HT share median [min, max] | Funds § median [min, max] |
|---|---:|---:|---:|---:|---:|
| 10 (2010) | 99145 [96440, 99363] | 63.851905 [62.176938, 64.779444] | 0.070438 [0.068175, 0.080263] | 0 [0, 0] | 42371 [26643, 51649] |
| 11 (2011) | 112884 [109928, 113636] | 62.116397 [61.170749, 63.222933] | 0.069488 [0.058694, 0.08135] | 0 [0, 0.017684] | 69040 [60182, 76628] |
| 12 (2012) | 129086 [126172, 130667] | 62.579908 [61.051415, 68.097209] | 0.05573 [0.053562, 0.059056] | 0 [0, 0.015851] | 86781 [81539, 94892] |
| 13 (2013) | 145600 [143285, 147798] | 64.755906 [62.28397, 70.665331] | 0.055748 [0.05209, 0.060272] | 0 [0, 0.014119] | 98690 [87209, 105438] |
| 14 (2014) | 162743 [160481, 164908] | 66.185627 [63.605992, 70.428778] | 0.057469 [0.050478, 0.060113] | 0 [0, 0.007913] | 112450 [102596, 122624] |
| 15 (2015) | 181682 [179070, 184286] | 69.005076 [64.572029, 71.447718] | 0.056323 [0.049402, 0.060483] | 0 [0, 0.007292] | 130814 [127985, 141308] |
| 16 (2016) | 200727 [198438, 203611] | 69.995104 [66.073285, 71.473263] | 0.055139 [0.049743, 0.061915] | 0 [0, 0.007049] | 132108 [122459, 148924] |
| 17 (2017) | 220398 [217756, 222690] | 69.547312 [67.338227, 71.724746] | 0.055625 [0.05213, 0.06452] | 0 [0, 0.00699] | 160591 [142508, 163997] |
| 18 (2018) | 241134 [238379, 242772] | 69.996074 [67.194316, 71.33413] | 0.058331 [0.052673, 0.065623] | 0 [0, 0.006777] | 181873 [154560, 194102] |
| 19 (2019) | 262375 [259752, 264696] | 71.172907 [67.2256, 72.503893] | 0.056366 [0.052276, 0.068398] | 0 [0, 0.004477] | 194624 [168594, 208210] |
| 20 (2020) | 284938 [281431, 287103] | 72.137169 [70.045944, 73.422542] | 0.055381 [0.051697, 0.059821] | 0 [0, 0.004442] | 234291 [204537, 255398] |
| 21 (2021) | 309055 [305041, 310742] | 73.058709 [72.411282, 76.68465] | 0.055526 [0.051048, 0.061836] | 0 [0, 0.004414] | 250400 [234637, 261976] |
| 22 (2022) | 332098 [327623, 333926] | 75.431064 [72.317795, 76.886389] | 0.055605 [0.049979, 0.064391] | 0 [0, 0.00439] | 295589 [237551, 339841] |
| 23 (2023) | 356659 [351550, 357807] | 76.228809 [73.460378, 77.092123] | 0.059101 [0.050737, 0.065704] | 0 [0, 0] | 313224 [272214, 618468] |
| 24 (2024) | 380632 [376374, 382332] | 76.683745 [74.982393, 77.091135] | 0.059615 [0.054713, 0.069341] | 0 [0, 0] | 566388 [358398, 1015306] |
| 25 (2025) | 406292 [402707, 407954] | 76.718565 [74.249924, 77.6607] | 0.061331 [0.056443, 0.069844] | 0 [0, 0] | 881009 [406263, 1446359] |
| 26 (2026) | 433462 [429059, 434291] | 77.251873 [74.45417, 77.686176] | 0.061497 [0.056618, 0.070798] | 0 [0, 0] | 1303248 [560589, 2005057] |
| 27 (2027) | 462136 [456945, 462653] | 78.156847 [75.778819, 78.582609] | 0.062979 [0.057814, 0.070022] | 0 [0, 0] | 1693439 [928666, 2645916] |
| 28 (2028) | 492291 [486178, 492745] | 78.290434 [76.212057, 78.688517] | 0.061989 [0.058196, 0.073813] | 0 [0, 0] | 2285572 [1356290, 2994484] |
| 29 (2029) | 522426 [516964, 523339] | 78.724089 [76.686865, 79.527008] | 0.066167 [0.062159, 0.078386] | 0 [0, 0] | 2721802 [1600698, 3092418] |
| 30 (2030) | 553508 [547654, 554540] | 79.872195 [77.260983, 81.461792] | 0.069945 [0.063531, 0.082838] | 0 [0, 0] | 3375605 [2085875, 3504819] |
| 31 (2031) | 585250 [578877, 586263] | 81.101491 [77.700336, 81.629454] | 0.071232 [0.069004, 0.086634] | 0 [0, 0] | 3706020 [2664141, 3867720] |
| 32 (2032) | 617731 [610169, 618842] | 81.955747 [78.497168, 82.646834] | 0.076736 [0.071788, 0.092136] | 0 [0, 0] | 4040769 [3308236, 4138559] |
| 33 (2033) | 649567 [642658, 651081] | 82.387596 [80.307142, 82.994395] | 0.081236 [0.075141, 0.093406] | 0 [0, 0] | 4331033 [3860783, 4391693] |
| 34 (2034) | 681189 [674946, 683562] | 82.305139 [79.644126, 82.781339] | 0.084257 [0.08087, 0.102551] | 0 [0, 0] | 4675867 [4178695, 4846160] |
| 35 (2035) | 713397 [707762, 715790] | 82.30628 [79.924468, 82.880202] | 0.093649 [0.087305, 0.107208] | 0 [0, 0] | 5043608 [4553067, 5123218] |
| 36 (2036) | 747192 [740374, 749866] | 81.917822 [79.757459, 82.649431] | 0.099733 [0.089247, 0.11516] | 0 [0, 0] | 5425042 [5011201, 5605644] |
| 37 (2037) | 780271 [774398, 783106] | 81.67427 [80.011113, 82.91241] | 0.1078 [0.100065, 0.122054] | 0 [0, 0] | 5726302 [5255822, 6109065] |
| 38 (2038) | 816652 [810339, 817985] | 81.558622 [80.139829, 82.122983] | 0.111818 [0.106954, 0.124889] | 0 [0, 0] | 6167780 [5518955, 6466284] |
| 39 (2039) | 851904 [843375, 853346] | 81.139738 [79.820489, 82.863372] | 0.116386 [0.108082, 0.137837] | 0 [0, 0] | 6585521 [5805101, 7010361] |
| 40 (2040) | 886950 [878464, 888680] | 81.907521 [80.736905, 82.371962] | 0.122655 [0.108755, 0.144571] | 0 [0, 0] | 7090830 [6148666, 7311259] |
| 41 (2041) | 923072 [915874, 926069] | 81.140311 [79.802696, 82.325791] | 0.125734 [0.11265, 0.142923] | 0 [0, 0] | 7563180 [6539334, 7738557] |
| 42 (2042) | 958932 [949768, 961801] | 81.301805 [80.025125, 82.669377] | 0.135165 [0.120456, 0.15027] | 0 [0, 0] | 7893863 [6982478, 8338386] |
| 43 (2043) | 993923 [983766, 1002425] | 81.409094 [80.592374, 82.244966] | 0.137027 [0.12671, 0.142499] | 0 [0, 0] | 8165651 [7402809, 8901232] |
| 44 (2044) | 1032835 [1022997, 1044116] | 80.730179 [79.865988, 81.82146] | 0.14224 [0.129796, 0.15914] | 0 [0, 0] | 8561702 [7641895, 9585621] |
| 45 (2045) | 1069267 [1061972, 1081889] | 80.965517 [79.610622, 81.109532] | 0.14926 [0.132896, 0.165463] | 0 [0, 0.004869] | 8919952 [8026766, 10263223] |
| 46 (2046) | 1107690 [1099069, 1113470] | 80.309221 [78.92808, 81.22901] | 0.149383 [0.137903, 0.170999] | 0 [0, 0.016027] | 9251739 [8436696, 10959622] |
| 47 (2047) | 1148871 [1135280, 1157728] | 79.972539 [78.986181, 80.474629] | 0.153155 [0.142712, 0.167687] | 0 [0, 0.02436] | 9729084 [8838145, 11676169] |
| 48 (2048) | 1185373 [1168944, 1192974] | 80.303491 [79.036158, 81.085345] | 0.158975 [0.139941, 0.165249] | 0 [0, 0.030116] | 10066941 [9287225, 12409471] |
| 49 (2049) | 1228919 [1190872, 1231249] | 80.337658 [78.310526, 80.863702] | 0.160219 [0.142177, 0.17231] | 0 [0, 0.040262] | 10428859 [9744740, 13150072] |
| 50 (2050) | 1268949 [1208785, 1279367] | 79.835079 [78.542749, 80.44545] | 0.165983 [0.143988, 0.174732] | 0 [0, 0.051315] | 10782373 [10159297, 13856408] |
| 51 (2051) | 1309887 [1219916, 1314242] | 80.035538 [78.341513, 80.513393] | 0.166412 [0.149622, 0.179387] | 0.004116 [0, 0.062559] | 11084493 [10578400, 14502479] |
| 52 (2052) | 1352475 [1232315, 1362375] | 79.242426 [78.105934, 80.374808] | 0.160963 [0.146227, 0.175075] | 0.013524 [0, 0.069473] | 11410876 [10975357, 15209582] |
| 53 (2053) | 1387227 [1242313, 1405821] | 79.736208 [78.234746, 80.0905] | 0.165049 [0.143565, 0.177848] | 0.027627 [0, 0.075115] | 11752460 [11373428, 15924015] |
| 54 (2054) | 1412295 [1255403, 1446363] | 80.28737 [79.035482, 80.721345] | 0.164222 [0.141203, 0.179692] | 0.046085 [0.016847, 0.092955] | 12173090 [11796292, 16675576] |
| 55 (2055) | 1425385 [1271208, 1478467] | 79.684715 [77.585642, 80.239883] | 0.170152 [0.146717, 0.174353] | 0.057629 [0.025112, 0.095454] | 12620661 [12219048, 17478283] |
| 56 (2056) | 1446023 [1273606, 1496945] | 79.91298 [77.68666, 80.705854] | 0.169582 [0.148786, 0.179179] | 0.061378 [0.032351, 0.1023] | 13107506 [12687129, 18311058] |
| 57 (2057) | 1460402 [1280460, 1517574] | 79.84412 [78.676498, 80.694316] | 0.168334 [0.14918, 0.179993] | 0.071252 [0.042242, 0.112809] | 13568470 [13086702, 19179258] |
| 58 (2058) | 1474478 [1287544, 1532240] | 79.841962 [78.766419, 80.756977] | 0.171796 [0.143472, 0.185646] | 0.082776 [0.049895, 0.114613] | 14017138 [13476548, 20058240] |
| 59 (2059) | 1486576 [1300523, 1545077] | 79.992447 [78.4958, 80.782552] | 0.169282 [0.143559, 0.19046] | 0.092341 [0.065407, 0.121316] | 14507882 [13872337, 20940360] |
| 60 (2060) | 1491542 [1306531, 1552165] | 80.173191 [77.582609, 81.015684] | 0.167729 [0.14735, 0.185077] | 0.092932 [0.065621, 0.129243] | 15019316 [14290870, 21855662] |

## Year-by-year base comparison tables

### 128x15_s7: base comparisons (9 members)

| Year | Metric | Dev median | Lane median | Δ median | Δ % | Dev band | Active pass interval | Signed margin | Verdict |
|---|---|---:|---:|---:|---:|---|---|---:|---|
| 10 (2010) | Population | 100141 | 100893 | 752 | 0.750941 | [96401, 101380] | [97651.5, 101380] | 487 | pass |
| 10 (2010) | Approval points | 70.851885 | 72.215613 | 1.363728 | 1.924758 | [69.040174, 72.44259] | [69.150677, 72.44259] | 0.226977 | pass |
| 10 (2010) | Air at homes | 0.072499 | 0.069482 | -0.003017 | -4.161376 | [0.069177, 0.07448] | [0.069847, 0.07448] | -0.000365 | fail |
| 10 (2010) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 11 (2011) | Population | 116914 | 117848 | 934 | 0.798878 | [113300, 118282] | [114423, 118282] | 434 | pass |
| 11 (2011) | Approval points | 73.4709 | 74.223519 | 0.752619 | 1.024377 | [72.926969, 75.225277] | [72.926969, 74.620054] | 0.396535 | pass |
| 11 (2011) | Air at homes | 0.074557 | 0.071182 | -0.003376 | -4.527753 | [0.073473, 0.07642] | [0.073473, 0.076031] | -0.002292 | fail |
| 11 (2011) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 12 (2012) | Population | 134932 | 136367 | 1435 | 1.063499 | [131160, 136360] | [132332, 136360] | -7 | fail |
| 12 (2012) | Approval points | 75.295956 | 76.045791 | 0.749835 | 0.99585 | [75.01476, 76.995475] | [75.01476, 76.286314] | 0.240523 | pass |
| 12 (2012) | Air at homes | 0.072193 | 0.068899 | -0.003293 | -4.561806 | [0.070805, 0.073749] | [0.070805, 0.073665] | -0.001906 | fail |
| 12 (2012) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 13 (2013) | Population | 153902 | 154705 | 803 | 0.521761 | [149266, 154998] | [151036, 154998] | 293 | pass |
| 13 (2013) | Approval points | 76.930783 | 77.667704 | 0.736921 | 0.957901 | [76.329242, 78.138895] | [76.329242, 77.835609] | 0.167906 | pass |
| 13 (2013) | Air at homes | 0.078771 | 0.076568 | -0.002203 | -2.797218 | [0.076572, 0.080118] | [0.076998, 0.080118] | -0.000431 | fail |
| 13 (2013) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.007138] | [0, 0.003569] | 0 | pass |
| 14 (2014) | Population | 172301 | 174104 | 1803 | 1.046425 | [168028, 173724] | [169453, 173724] | -380 | fail |
| 14 (2014) | Approval points | 78.565686 | 78.45512 | -0.110566 | -0.140731 | [77.615033, 79.404951] | [77.670727, 79.404951] | 0.784393 | pass |
| 14 (2014) | Air at homes | 0.085386 | 0.083366 | -0.00202 | -2.365348 | [0.083328, 0.087247] | [0.083427, 0.087247] | -0.00006 | fail |
| 14 (2014) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.003329] | [0, 0.001664] | 0 | pass |
| 15 (2015) | Population | 191588 | 193438 | 1850 | 0.965614 | [187528, 193454] | [188625, 193454] | 16 | pass |
| 15 (2015) | Approval points | 80.906099 | 81.414993 | 0.508894 | 0.628993 | [78.829218, 81.5563] | [79.542558, 81.5563] | 0.141307 | pass |
| 15 (2015) | Air at homes | 0.092873 | 0.090916 | -0.001957 | -2.10733 | [0.090884, 0.096493] | [0.090884, 0.095678] | 0.000032 | pass |
| 15 (2015) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.003328] | [0, 0.001664] | 0 | pass |

### 256x60_s7: base comparisons (9 members)

| Year | Metric | Dev median | Lane median | Δ median | Δ % | Dev band | Active pass interval | Signed margin | Verdict |
|---|---|---:|---:|---:|---:|---|---|---:|---|
| 10 (2010) | Population | 99145 | 99805 | 660 | 0.665692 | [96440, 99363] | [97683.5, 99363] | -442 | fail |
| 10 (2010) | Approval points | 63.851905 | 63.766704 | -0.085201 | -0.133435 | [62.176938, 64.779444] | [62.550651, 64.779444] | 1.012741 | pass |
| 10 (2010) | Air at homes | 0.070438 | 0.071413 | 0.000975 | 1.383764 | [0.068175, 0.080263] | [0.068175, 0.076482] | 0.003238 | pass |
| 10 (2010) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 11 (2011) | Population | 112884 | 113853 | 969 | 0.858403 | [109928, 113636] | [111030, 113636] | -217 | fail |
| 11 (2011) | Approval points | 62.116397 | 62.814081 | 0.697683 | 1.123187 | [61.170749, 63.222933] | [61.170749, 63.142489] | 0.328408 | pass |
| 11 (2011) | Air at homes | 0.069488 | 0.063985 | -0.005503 | -7.918719 | [0.058694, 0.08135] | [0.058694, 0.080816] | 0.005291 | pass |
| 11 (2011) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.017684] | [0, 0.008842] | 0 | pass |
| 12 (2012) | Population | 129086 | 130372 | 1286 | 0.996235 | [126172, 130667] | [126838.5, 130667] | 295 | pass |
| 12 (2012) | Approval points | 62.579908 | 63.683548 | 1.10364 | 1.76357 | [61.051415, 68.097209] | [61.051415, 66.102806] | 2.419257 | pass |
| 12 (2012) | Air at homes | 0.05573 | 0.057667 | 0.001937 | 3.476293 | [0.053562, 0.059056] | [0.053562, 0.058477] | 0.000809 | pass |
| 12 (2012) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.015851] | [0, 0.007926] | 0 | pass |
| 13 (2013) | Population | 145600 | 146299 | 699 | 0.480082 | [143285, 147798] | [143343.5, 147798] | 1499 | pass |
| 13 (2013) | Approval points | 64.755906 | 65.119033 | 0.363127 | 0.560763 | [62.28397, 70.665331] | [62.28397, 68.946586] | 2.835063 | pass |
| 13 (2013) | Air at homes | 0.055748 | 0.057213 | 0.001465 | 2.627738 | [0.05209, 0.060272] | [0.05209, 0.059839] | 0.002626 | pass |
| 13 (2013) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.014119] | [0, 0.007059] | 0 | pass |
| 14 (2014) | Population | 162743 | 164018 | 1275 | 0.783444 | [160481, 164908] | [160529.5, 164908] | 890 | pass |
| 14 (2014) | Approval points | 66.185627 | 66.820458 | 0.634831 | 0.959167 | [63.605992, 70.428778] | [63.605992, 69.59702] | 2.776562 | pass |
| 14 (2014) | Air at homes | 0.057469 | 0.056556 | -0.000913 | -1.588661 | [0.050478, 0.060113] | [0.052652, 0.060113] | 0.003557 | pass |
| 14 (2014) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.007913] | [0, 0.003956] | 0 | pass |
| 15 (2015) | Population | 181682 | 183457 | 1775 | 0.976982 | [179070, 184286] | [179074, 184286] | 829 | pass |
| 15 (2015) | Approval points | 69.005076 | 69.668167 | 0.663091 | 0.960931 | [64.572029, 71.447718] | [65.567232, 71.447718] | 1.779551 | pass |
| 15 (2015) | Air at homes | 0.056323 | 0.054361 | -0.001962 | -3.484227 | [0.049402, 0.060483] | [0.050783, 0.060483] | 0.003578 | pass |
| 15 (2015) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.007292] | [0, 0.003646] | 0 | pass |
| 16 (2016) | Population | 200727 | 203263 | 2536 | 1.263408 | [198438, 203611] | [198438, 203313.5] | 50.5 | pass |
| 16 (2016) | Approval points | 69.995104 | 70.501708 | 0.506605 | 0.723772 | [66.073285, 71.473263] | [67.295115, 71.473263] | 0.971554 | pass |
| 16 (2016) | Air at homes | 0.055139 | 0.056934 | 0.001795 | 3.255869 | [0.049743, 0.061915] | [0.049743, 0.061224] | 0.004291 | pass |
| 16 (2016) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.007049] | [0, 0.003524] | 0 | pass |
| 17 (2017) | Population | 220398 | 222540 | 2142 | 0.971878 | [217756, 222690] | [217931, 222690] | 150 | pass |
| 17 (2017) | Approval points | 69.547312 | 71.013004 | 1.465692 | 2.107475 | [67.338227, 71.724746] | [67.354053, 71.724746] | 0.711742 | pass |
| 17 (2017) | Air at homes | 0.055625 | 0.061546 | 0.005921 | 10.644334 | [0.05213, 0.06452] | [0.05213, 0.061821] | 0.000274 | pass |
| 17 (2017) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.00699] | [0, 0.003495] | 0 | pass |
| 18 (2018) | Population | 241134 | 242866 | 1732 | 0.718273 | [238379, 242772] | [238937.5, 242772] | -94 | fail |
| 18 (2018) | Approval points | 69.996074 | 70.814482 | 0.818408 | 1.16922 | [67.194316, 71.33413] | [67.926167, 71.33413] | 0.519648 | pass |
| 18 (2018) | Air at homes | 0.058331 | 0.064442 | 0.006111 | 10.47675 | [0.052673, 0.065623] | [0.052673, 0.064806] | 0.000364 | pass |
| 18 (2018) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.006777] | [0, 0.003389] | 0 | pass |
| 19 (2019) | Population | 262375 | 264535 | 2160 | 0.823249 | [259752, 264696] | [259903, 264696] | 161 | pass |
| 19 (2019) | Approval points | 71.172907 | 71.848884 | 0.675977 | 0.949767 | [67.2256, 72.503893] | [68.533761, 72.503893] | 0.655009 | pass |
| 19 (2019) | Air at homes | 0.056366 | 0.058408 | 0.002042 | 3.623626 | [0.052276, 0.068398] | [0.052276, 0.064427] | 0.006018 | pass |
| 19 (2019) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.004477] | [0, 0.002239] | 0 | pass |
| 20 (2020) | Population | 284938 | 287400 | 2462 | 0.864048 | [281431, 287103] | [282102, 287103] | -297 | fail |
| 20 (2020) | Approval points | 72.137169 | 72.977411 | 0.840242 | 1.164784 | [70.045944, 73.422542] | [70.44887, 73.422542] | 0.445131 | pass |
| 20 (2020) | Air at homes | 0.055381 | 0.058285 | 0.002904 | 5.24374 | [0.051697, 0.059821] | [0.051697, 0.059443] | 0.001158 | pass |
| 20 (2020) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.004442] | [0, 0.002221] | 0 | pass |
| 21 (2021) | Population | 309055 | 310568 | 1513 | 0.489557 | [305041, 310742] | [306204.5, 310742] | 174 | pass |
| 21 (2021) | Approval points | 73.058709 | 74.924547 | 1.865838 | 2.553888 | [72.411282, 76.68465] | [72.411282, 75.195393] | 0.270846 | pass |
| 21 (2021) | Air at homes | 0.055526 | 0.056412 | 0.000886 | 1.595653 | [0.051048, 0.061836] | [0.051048, 0.06092] | 0.004508 | pass |
| 21 (2021) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.004414] | [0, 0.002207] | 0 | pass |
| 22 (2022) | Population | 332098 | 334462 | 2364 | 0.711838 | [327623, 333926] | [328946.5, 333926] | -536 | fail |
| 22 (2022) | Approval points | 75.431064 | 76.359858 | 0.928794 | 1.231315 | [72.317795, 76.886389] | [73.146767, 76.886389] | 0.526531 | pass |
| 22 (2022) | Air at homes | 0.055605 | 0.056623 | 0.001018 | 1.830805 | [0.049979, 0.064391] | [0.049979, 0.062812] | 0.006188 | pass |
| 22 (2022) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.00439] | [0, 0.002195] | 0 | pass |
| 23 (2023) | Population | 356659 | 357684 | 1025 | 0.287389 | [351550, 357912] | [353478, 357912] | 228 | pass |
| 23 (2023) | Approval points | 76.228809 | 76.007566 | -0.221243 | -0.290236 | [73.460378, 77.299529] | [74.309234, 77.299529] | 1.291962 | pass |
| 23 (2023) | Air at homes | 0.059101 | 0.060227 | 0.001126 | 1.905292 | [0.050737, 0.065704] | [0.051618, 0.065704] | 0.005477 | pass |
| 23 (2023) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 24 (2024) | Population | 380531 | 382124 | 1593 | 0.418626 | [376917, 382300] | [377839.5, 382300] | 176 | pass |
| 24 (2024) | Approval points | 76.613249 | 76.184779 | -0.42847 | -0.559263 | [73.998838, 77.957952] | [74.633692, 77.957952] | 1.551087 | pass |
| 24 (2024) | Air at homes | 0.061226 | 0.06287 | 0.001644 | 2.685372 | [0.052972, 0.069464] | [0.052981, 0.069464] | 0.006593 | pass |
| 24 (2024) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 25 (2025) | Population | 406143 | 407842 | 1699 | 0.418326 | [402631, 407893] | [403512, 407893] | 51 | pass |
| 25 (2025) | Approval points | 76.847449 | 76.446113 | -0.401336 | -0.52225 | [73.900218, 78.213305] | [74.690905, 78.213305] | 1.755208 | pass |
| 25 (2025) | Air at homes | 0.061168 | 0.065589 | 0.00442 | 7.226457 | [0.057127, 0.069714] | [0.057127, 0.067462] | 0.001873 | pass |
| 25 (2025) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 26 (2026) | Population | 433030 | 434490 | 1460 | 0.337159 | [429660, 434886] | [430417, 434886] | 396 | pass |
| 26 (2026) | Approval points | 76.505994 | 76.984334 | 0.47834 | 0.625232 | [74.148121, 77.964325] | [74.597892, 77.964325] | 0.979991 | pass |
| 26 (2026) | Air at homes | 0.058854 | 0.064043 | 0.005188 | 8.815797 | [0.057654, 0.07121] | [0.057654, 0.065632] | 0.001589 | pass |
| 26 (2026) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 27 (2027) | Population | 461632 | 462137 | 505 | 0.109394 | [458481, 463349] | [459198, 463349] | 1212 | pass |
| 27 (2027) | Approval points | 77.763571 | 77.461451 | -0.302121 | -0.388512 | [75.669575, 78.840311] | [76.178203, 78.840311] | 1.283247 | pass |
| 27 (2027) | Air at homes | 0.061842 | 0.065978 | 0.004136 | 6.688534 | [0.057955, 0.06949] | [0.057955, 0.06761] | 0.001631 | pass |
| 27 (2027) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 28 (2028) | Population | 491442 | 491657 | 215 | 0.043749 | [486939, 492668] | [488577.5, 492668] | 1011 | pass |
| 28 (2028) | Approval points | 77.890958 | 77.521854 | -0.369105 | -0.473873 | [75.924164, 78.730433] | [76.487824, 78.730433] | 1.03403 | pass |
| 28 (2028) | Air at homes | 0.06446 | 0.065029 | 0.000569 | 0.882553 | [0.058058, 0.073884] | [0.058058, 0.072373] | 0.006971 | pass |
| 28 (2028) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 29 (2029) | Population | 522372 | 522194 | -178 | -0.034075 | [516424, 523222] | [518973, 523222] | 1028 | pass |
| 29 (2029) | Approval points | 78.665187 | 77.958858 | -0.70633 | -0.897894 | [75.946768, 80.008889] | [76.634127, 80.008889] | 1.324731 | pass |
| 29 (2029) | Air at homes | 0.067122 | 0.069373 | 0.002252 | 3.354442 | [0.062519, 0.079002] | [0.062519, 0.075364] | 0.00599 | pass |
| 29 (2029) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 30 (2030) | Population | 553169 | 552954 | -215 | -0.038867 | [547698, 554269] | [549883.5, 554269] | 1315 | pass |
| 30 (2030) | Approval points | 80.046819 | 79.510084 | -0.536735 | -0.670526 | [77.065152, 81.049478] | [78.054656, 81.049478] | 1.455428 | pass |
| 30 (2030) | Air at homes | 0.070346 | 0.071792 | 0.001446 | 2.055016 | [0.065754, 0.080669] | [0.065754, 0.077804] | 0.006012 | pass |
| 30 (2030) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 31 (2031) | Population | 584845 | 584181 | -664 | -0.113534 | [578264, 586165] | [580894.5, 586165] | 1984 | pass |
| 31 (2031) | Approval points | 81.189545 | 80.547634 | -0.641911 | -0.790633 | [77.22447, 81.342604] | [79.130478, 81.342604] | 0.79497 | pass |
| 31 (2031) | Air at homes | 0.074498 | 0.075751 | 0.001254 | 1.682973 | [0.071388, 0.086414] | [0.071388, 0.082011] | 0.004363 | pass |
| 31 (2031) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 32 (2032) | Population | 616271 | 616709 | 438 | 0.071073 | [609732, 617587] | [612343.5, 617587] | 878 | pass |
| 32 (2032) | Approval points | 81.870756 | 81.492145 | -0.378611 | -0.46245 | [78.113537, 82.205682] | [79.824683, 82.205682] | 0.713537 | pass |
| 32 (2032) | Air at homes | 0.080718 | 0.080733 | 0.000015 | 0.018456 | [0.076235, 0.092153] | [0.076235, 0.088678] | 0.004498 | pass |
| 32 (2032) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 33 (2033) | Population | 649366 | 649003 | -363 | -0.055901 | [642446, 650402] | [645388, 650402] | 1399 | pass |
| 33 (2033) | Approval points | 82.021286 | 81.793223 | -0.228063 | -0.278053 | [79.810819, 82.775621] | [80.538885, 82.775621] | 0.982398 | pass |
| 33 (2033) | Air at homes | 0.082977 | 0.083485 | 0.000508 | 0.611862 | [0.080073, 0.09682] | [0.080073, 0.091351] | 0.003412 | pass |
| 33 (2033) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 34 (2034) | Population | 681383 | 681630 | 247 | 0.03625 | [674866, 682905] | [677363.5, 682905] | 1275 | pass |
| 34 (2034) | Approval points | 81.876241 | 81.300185 | -0.576056 | -0.70357 | [79.969538, 82.721619] | [80.5002, 82.721619] | 0.799984 | pass |
| 34 (2034) | Air at homes | 0.088946 | 0.088671 | -0.000275 | -0.309692 | [0.085412, 0.101078] | [0.085412, 0.096779] | 0.003259 | pass |
| 34 (2034) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 35 (2035) | Population | 715266 | 714097 | -1169 | -0.163436 | [707692, 716674] | [710775, 716674] | 2577 | pass |
| 35 (2035) | Approval points | 82.321277 | 81.678426 | -0.642851 | -0.780905 | [79.824437, 82.746021] | [80.860485, 82.746021] | 0.817941 | pass |
| 35 (2035) | Air at homes | 0.094088 | 0.094067 | -0.000022 | -0.023006 | [0.088873, 0.107079] | [0.088873, 0.103192] | 0.005194 | pass |
| 35 (2035) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 36 (2036) | Population | 747267 | 747726 | 459 | 0.061424 | [740445, 749944] | [742517.5, 749944] | 2218 | pass |
| 36 (2036) | Approval points | 81.682529 | 80.796887 | -0.885642 | -1.084249 | [80.058075, 82.240793] | [80.59117, 82.240793] | 0.205717 | pass |
| 36 (2036) | Air at homes | 0.098577 | 0.101557 | 0.002981 | 3.023663 | [0.09656, 0.112797] | [0.09656, 0.106695] | 0.004998 | pass |
| 36 (2036) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 37 (2037) | Population | 781483 | 781782 | 299 | 0.038261 | [773598, 784083] | [776240.5, 784083] | 2301 | pass |
| 37 (2037) | Approval points | 81.705085 | 80.891989 | -0.813095 | -0.995159 | [79.349048, 82.108048] | [80.325585, 82.108048] | 0.566404 | pass |
| 37 (2037) | Air at homes | 0.111185 | 0.104384 | -0.0068 | -6.116366 | [0.100352, 0.122397] | [0.100352, 0.122207] | 0.004032 | pass |
| 37 (2037) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 38 (2038) | Population | 816400 | 816683 | 283 | 0.034664 | [808253, 819015] | [811019, 819015] | 2332 | pass |
| 38 (2038) | Approval points | 81.336567 | 80.841399 | -0.495168 | -0.608789 | [79.565357, 82.107769] | [80.065361, 82.107769] | 0.776038 | pass |
| 38 (2038) | Air at homes | 0.113757 | 0.109974 | -0.003783 | -3.325679 | [0.104651, 0.132841] | [0.104651, 0.127852] | 0.005323 | pass |
| 38 (2038) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 39 (2039) | Population | 849116 | 852575 | 3459 | 0.407365 | [844325, 853580] | [844488.5, 853580] | 1005 | pass |
| 39 (2039) | Approval points | 81.141469 | 80.960475 | -0.180995 | -0.223061 | [80.614922, 82.10792] | [80.614922, 81.887968] | 0.345552 | pass |
| 39 (2039) | Air at homes | 0.117955 | 0.114525 | -0.003431 | -2.908359 | [0.110534, 0.13891] | [0.110534, 0.132143] | 0.003991 | pass |
| 39 (2039) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 40 (2040) | Population | 885781 | 886962 | 1181 | 0.133329 | [878794, 890501] | [879927.5, 890501] | 3539 | pass |
| 40 (2040) | Approval points | 81.936279 | 81.343604 | -0.592674 | -0.723336 | [80.308075, 82.773166] | [80.703734, 82.773166] | 0.639871 | pass |
| 40 (2040) | Air at homes | 0.123398 | 0.123709 | 0.000312 | 0.252462 | [0.116073, 0.139514] | [0.116073, 0.135118] | 0.007637 | pass |
| 40 (2040) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 41 (2041) | Population | 922651 | 922717 | 66 | 0.007153 | [913777, 928329] | [915375, 928329] | 5612 | pass |
| 41 (2041) | Approval points | 81.517374 | 81.08065 | -0.436724 | -0.535744 | [80.768678, 82.685078] | [80.768678, 82.475574] | 0.311972 | pass |
| 41 (2041) | Air at homes | 0.125318 | 0.128823 | 0.003504 | 2.796311 | [0.119679, 0.14338] | [0.119679, 0.137169] | 0.008346 | pass |
| 41 (2041) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 42 (2042) | Population | 954296 | 959300 | 5004 | 0.524366 | [948309, 964043] | [948309, 962163] | 2863 | pass |
| 42 (2042) | Approval points | 81.318185 | 81.136591 | -0.181594 | -0.223313 | [80.254576, 82.517725] | [80.254576, 82.44976] | 0.882015 | pass |
| 42 (2042) | Air at homes | 0.131582 | 0.130584 | -0.000998 | -0.758263 | [0.126007, 0.147672] | [0.126007, 0.142415] | 0.004578 | pass |
| 42 (2042) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 43 (2043) | Population | 990452 | 996811 | 6359 | 0.64203 | [986884, 1001176] | [986884, 997598] | 787 | pass |
| 43 (2043) | Approval points | 81.418462 | 81.165148 | -0.253314 | -0.311126 | [79.844569, 82.582742] | [80.049376, 82.582742] | 1.115772 | pass |
| 43 (2043) | Air at homes | 0.136369 | 0.13672 | 0.000351 | 0.257375 | [0.130339, 0.155298] | [0.130339, 0.148849] | 0.006381 | pass |
| 43 (2043) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 44 (2044) | Population | 1029252 | 1031347 | 2095 | 0.203546 | [1021771, 1041125] | [1021771, 1038929] | 7582 | pass |
| 44 (2044) | Approval points | 81.07317 | 80.29362 | -0.77955 | -0.961538 | [79.716275, 81.605984] | [80.128315, 81.605984] | 0.165305 | pass |
| 44 (2044) | Air at homes | 0.140589 | 0.140445 | -0.000143 | -0.101981 | [0.138719, 0.158979] | [0.138719, 0.150719] | 0.001726 | pass |
| 44 (2044) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.002702] | [0, 0.001351] | 0 | pass |
| 45 (2045) | Population | 1066213 | 1069207 | 2994 | 0.280807 | [1055686, 1079331] | [1055686, 1078035.5] | 8828.5 | pass |
| 45 (2045) | Approval points | 80.763918 | 79.966431 | -0.797487 | -0.98743 | [79.310177, 81.188186] | [79.824914, 81.188186] | 0.141518 | pass |
| 45 (2045) | Air at homes | 0.1457 | 0.148581 | 0.002881 | 1.977316 | [0.14248, 0.160587] | [0.14248, 0.154753] | 0.0061 | pass |
| 45 (2045) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.010754] | [0, 0.005377] | 0 | pass |
| 46 (2046) | Population | 1106293 | 1107271 | 978 | 0.088403 | [1092663, 1118481] | [1093384, 1118481] | 11210 | pass |
| 46 (2046) | Approval points | 80.540855 | 79.63525 | -0.905605 | -1.124405 | [79.007583, 81.000507] | [79.544393, 81.000507] | 0.090857 | pass |
| 46 (2046) | Air at homes | 0.150068 | 0.146531 | -0.003536 | -2.356478 | [0.144261, 0.166444] | [0.144261, 0.161159] | 0.00227 | pass |
| 46 (2046) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.02938] | [0, 0.01469] | 0 | pass |
| 47 (2047) | Population | 1144132 | 1145756 | 1624 | 0.141942 | [1127604, 1152537] | [1131665.5, 1152537] | 6781 | pass |
| 47 (2047) | Approval points | 79.998508 | 79.465842 | -0.532667 | -0.665846 | [78.95312, 81.058885] | [78.95312, 81.051391] | 0.512722 | pass |
| 47 (2047) | Air at homes | 0.149999 | 0.151186 | 0.001187 | 0.791617 | [0.143483, 0.167729] | [0.143483, 0.162122] | 0.007703 | pass |
| 47 (2047) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.035157] | [0, 0.017579] | 0 | pass |
| 48 (2048) | Population | 1186078 | 1187007 | 929 | 0.078325 | [1167763, 1189173] | [1175373, 1189173] | 2166 | pass |
| 48 (2048) | Approval points | 80.458667 | 79.820106 | -0.63856 | -0.79365 | [77.94694, 80.868642] | [78.997816, 80.868642] | 0.822291 | pass |
| 48 (2048) | Air at homes | 0.155346 | 0.152234 | -0.003112 | -2.002967 | [0.147753, 0.172724] | [0.147753, 0.167831] | 0.004481 | pass |
| 48 (2048) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.050934] | [0, 0.025467] | 0 | pass |
| 49 (2049) | Population | 1225463 | 1225266 | -197 | -0.016076 | [1185004, 1235776] | [1200077, 1235776] | 10510 | pass |
| 49 (2049) | Approval points | 80.561099 | 79.570806 | -0.990293 | -1.229244 | [78.807668, 80.951111] | [79.489377, 80.951111] | 0.081429 | pass |
| 49 (2049) | Air at homes | 0.156569 | 0.159876 | 0.003308 | 2.11263 | [0.14735, 0.16969] | [0.14735, 0.167738] | 0.007862 | pass |
| 49 (2049) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.062206] | [0, 0.031103] | 0 | pass |
| 50 (2050) | Population | 1265741 | 1268184 | 2443 | 0.193009 | [1202458, 1272989] | [1230475.5, 1272989] | 4805 | pass |
| 50 (2050) | Approval points | 80.318955 | 79.449944 | -0.869012 | -1.081951 | [78.991205, 80.844737] | [79.392189, 80.844737] | 0.057754 | pass |
| 50 (2050) | Air at homes | 0.159403 | 0.161183 | 0.00178 | 1.116635 | [0.154533, 0.177092] | [0.154533, 0.170683] | 0.00665 | pass |
| 50 (2050) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.073241] | [0, 0.036621] | 0 | pass |
| 51 (2051) | Population | 1310245 | 1312584 | 2339 | 0.178516 | [1243720, 1315846] | [1274182, 1315846] | 3262 | pass |
| 51 (2051) | Approval points | 79.678009 | 79.01355 | -0.664459 | -0.83393 | [78.273839, 80.753433] | [78.438212, 80.753433] | 0.575338 | pass |
| 51 (2051) | Air at homes | 0.16415 | 0.163105 | -0.001045 | -0.636444 | [0.152604, 0.178799] | [0.152604, 0.177247] | 0.010501 | pass |
| 51 (2051) | I-HT share | 0.010851 | 0 | -0.010851 | -100 | [0, 0.078228] | [0, 0.049965] | 0 | pass |
| 52 (2052) | Population | 1342501 | 1350533 | 8032 | 0.598286 | [1259287, 1355405] | [1294442, 1355405] | 4872 | pass |
| 52 (2052) | Approval points | 79.773212 | 79.084369 | -0.688843 | -0.863502 | [78.304435, 80.636975] | [78.606942, 80.636975] | 0.477427 | pass |
| 52 (2052) | Air at homes | 0.160637 | 0.164705 | 0.004068 | 2.532529 | [0.153368, 0.177894] | [0.153368, 0.1729] | 0.008195 | pass |
| 52 (2052) | I-HT share | 0.025653 | 0.0064 | -0.019253 | -75.050743 | [0, 0.091159] | [0, 0.071232] | 0.0064 | pass |
| 53 (2053) | Population | 1361273 | 1394939 | 33666 | 2.473126 | [1266114, 1397353] | [1295653.5, 1397353] | 2414 | pass |
| 53 (2053) | Approval points | 79.536204 | 79.049333 | -0.486871 | -0.612137 | [77.678528, 80.754847] | [77.998044, 80.754847] | 1.051289 | pass |
| 53 (2053) | Air at homes | 0.164037 | 0.162212 | -0.001825 | -1.112545 | [0.155334, 0.174626] | [0.155334, 0.173684] | 0.006879 | pass |
| 53 (2053) | I-HT share | 0.035398 | 0.0143 | -0.021098 | -59.602528 | [0, 0.101934] | [0, 0.086365] | 0.0143 | pass |
| 54 (2054) | Population | 1389189 | 1413586 | 24397 | 1.756205 | [1282793, 1434433] | [1313369, 1434433] | 20847 | pass |
| 54 (2054) | Approval points | 79.908776 | 79.589127 | -0.319648 | -0.400017 | [78.675529, 81.011342] | [78.740869, 81.011342] | 0.848258 | pass |
| 54 (2054) | Air at homes | 0.16413 | 0.162055 | -0.002074 | -1.263898 | [0.152679, 0.182994] | [0.152679, 0.179288] | 0.009377 | pass |
| 54 (2054) | I-HT share | 0.046938 | 0.022374 | -0.024565 | -52.334192 | [0.001336, 0.10184] | [0.001336, 0.09719] | 0.021037 | pass |
| 55 (2055) | Population | 1401036 | 1433609 | 32573 | 2.324922 | [1291560, 1463953] | [1314839.5, 1463953] | 30344 | pass |
| 55 (2055) | Approval points | 79.811388 | 79.292209 | -0.519178 | -0.650506 | [77.450356, 81.1146] | [77.979265, 81.1146] | 1.312944 | pass |
| 55 (2055) | Air at homes | 0.16822 | 0.164717 | -0.003503 | -2.082129 | [0.156632, 0.175749] | [0.158661, 0.175749] | 0.006056 | pass |
| 55 (2055) | I-HT share | 0.050612 | 0.032746 | -0.017865 | -35.298692 | [0.018379, 0.116942] | [0.018379, 0.099893] | 0.014367 | pass |
| 56 (2056) | Population | 1419186 | 1454275 | 35089 | 2.472474 | [1304234, 1479068] | [1331769, 1479068] | 24793 | pass |
| 56 (2056) | Approval points | 80.066278 | 78.925527 | -1.140751 | -1.424758 | [77.580319, 81.022311] | [78.345281, 81.022311] | 0.580246 | pass |
| 56 (2056) | Air at homes | 0.168069 | 0.170223 | 0.002154 | 1.28164 | [0.154205, 0.186111] | [0.154205, 0.184022] | 0.013799 | pass |
| 56 (2056) | I-HT share | 0.065149 | 0.036327 | -0.028822 | -44.240671 | [0.030167, 0.124758] | [0.030167, 0.112445] | 0.00616 | pass |
| 57 (2057) | Population | 1418230 | 1471662 | 53432 | 3.767513 | [1322291, 1487910] | [1335420.5, 1487910] | 16248 | pass |
| 57 (2057) | Approval points | 80.258158 | 79.066686 | -1.191472 | -1.484549 | [77.712266, 80.946544] | [78.641018, 80.946544] | 0.425667 | pass |
| 57 (2057) | Air at homes | 0.170842 | 0.166209 | -0.004633 | -2.712027 | [0.153725, 0.181636] | [0.156887, 0.181636] | 0.009322 | pass |
| 57 (2057) | I-HT share | 0.074023 | 0.048173 | -0.02585 | -34.922114 | [0.038866, 0.130134] | [0.038866, 0.119657] | 0.009307 | pass |
| 58 (2058) | Population | 1442416 | 1482212 | 39796 | 2.758982 | [1335743, 1521883] | [1349346, 1521883] | 39671 | pass |
| 58 (2058) | Approval points | 80.014802 | 79.021368 | -0.993435 | -1.241564 | [78.340443, 80.926879] | [78.721584, 80.926879] | 0.299783 | pass |
| 58 (2058) | Air at homes | 0.168051 | 0.172405 | 0.004353 | 2.590504 | [0.153829, 0.187011] | [0.153829, 0.184642] | 0.012238 | pass |
| 58 (2058) | I-HT share | 0.089536 | 0.057354 | -0.032182 | -35.943472 | [0.040372, 0.135843] | [0.0418, 0.135843] | 0.015553 | pass |
| 59 (2059) | Population | 1447648 | 1485043 | 37395 | 2.583156 | [1344677, 1537176] | [1351398.5, 1537176] | 52133 | pass |
| 59 (2059) | Approval points | 79.883671 | 78.919735 | -0.963936 | -1.206675 | [77.412821, 80.662289] | [78.258937, 80.662289] | 0.660798 | pass |
| 59 (2059) | Air at homes | 0.169666 | 0.172519 | 0.002853 | 1.681518 | [0.15611, 0.185163] | [0.15611, 0.184193] | 0.011674 | pass |
| 59 (2059) | I-HT share | 0.097398 | 0.063074 | -0.034323 | -35.240583 | [0.044402, 0.136353] | [0.051422, 0.136353] | 0.011652 | pass |
| 60 (2060) | Population | 1461087 | 1496254 | 35167 | 2.406907 | [1341715, 1542590] | [1360649.5, 1542590] | 46336 | pass |
| 60 (2060) | Approval points | 80.164557 | 78.536264 | -1.628293 | -2.031188 | [78.183649, 80.54141] | [78.985677, 80.54141] | -0.449413 | fail |
| 60 (2060) | Air at homes | 0.168895 | 0.171832 | 0.002937 | 1.738793 | [0.155473, 0.183209] | [0.155473, 0.182763] | 0.010931 | pass |
| 60 (2060) | I-HT share | 0.114822 | 0.071239 | -0.043583 | -37.956745 | [0.047377, 0.137624] | [0.069698, 0.137624] | 0.001541 | pass |

### 256x60_s11: base comparisons (9 members)

| Year | Metric | Dev median | Lane median | Δ median | Δ % | Dev band | Active pass interval | Signed margin | Verdict |
|---|---|---:|---:|---:|---:|---|---|---:|---|
| 10 (2010) | Population | 96965 | 98588 | 1623 | 1.6738 | [95898, 97480] | [96174, 97480] | -1108 | fail |
| 10 (2010) | Approval points | 64.513165 | 62.34115 | -2.172015 | -3.366778 | [61.866754, 65.072707] | [62.910189, 65.072707] | -0.569039 | fail |
| 10 (2010) | Air at homes | 0.0654 | 0.068042 | 0.002641 | 4.03865 | [0.05669, 0.07417] | [0.05669, 0.074141] | 0.006099 | pass |
| 10 (2010) | I-HT share | 0 | 0.011507 | 0.011507 | n/a | [0, 0.025153] | [0, 0.012576] | 0.00107 | pass |
| 11 (2011) | Population | 111116 | 112761 | 1645 | 1.480435 | [110004, 111424] | [110406, 111424] | -1337 | fail |
| 11 (2011) | Approval points | 62.939346 | 62.520596 | -0.41875 | -0.665323 | [61.809728, 64.042029] | [61.823195, 64.042029] | 0.697401 | pass |
| 11 (2011) | Air at homes | 0.059306 | 0.059732 | 0.000426 | 0.718147 | [0.051073, 0.06456] | [0.052563, 0.06456] | 0.004827 | pass |
| 11 (2011) | I-HT share | 0 | 0.010419 | 0.010419 | n/a | [0, 0.022382] | [0, 0.011191] | 0.000772 | pass |
| 12 (2012) | Population | 126617 | 128821 | 2204 | 1.740683 | [125426, 127871] | [125426, 127839.5] | -981.5 | fail |
| 12 (2012) | Approval points | 63.031628 | 62.976866 | -0.054762 | -0.086881 | [61.631207, 65.24692] | [61.631207, 64.839485] | 1.345659 | pass |
| 12 (2012) | Air at homes | 0.052271 | 0.058289 | 0.006019 | 11.514221 | [0.048214, 0.056295] | [0.04823, 0.056295] | -0.001994 | fail |
| 12 (2012) | I-HT share | 0 | 0.009602 | 0.009602 | n/a | [0, 0.020624] | [0, 0.010312] | 0.00071 | pass |
| 13 (2013) | Population | 143996 | 145063 | 1067 | 0.740993 | [141572, 145099] | [142232.5, 145099] | 36 | pass |
| 13 (2013) | Approval points | 63.77372 | 63.9106 | 0.136879 | 0.214633 | [62.408336, 65.627238] | [62.408336, 65.383171] | 1.472572 | pass |
| 13 (2013) | Air at homes | 0.050503 | 0.055725 | 0.005222 | 10.340297 | [0.047794, 0.055597] | [0.047794, 0.054404] | -0.00132 | fail |
| 13 (2013) | I-HT share | 0 | 0.009408 | 0.009408 | n/a | [0, 0.019488] | [0, 0.009744] | 0.000336 | pass |
| 14 (2014) | Population | 162461 | 163449 | 988 | 0.608146 | [158959, 163214] | [160333.5, 163214] | -235 | fail |
| 14 (2014) | Approval points | 68.721816 | 65.309423 | -3.412393 | -4.965516 | [64.001443, 70.23553] | [65.604772, 70.23553] | -0.295349 | fail |
| 14 (2014) | Air at homes | 0.053548 | 0.055164 | 0.001617 | 3.018855 | [0.046244, 0.057348] | [0.047996, 0.057348] | 0.002184 | pass |
| 14 (2014) | I-HT share | 0 | 0.009044 | 0.009044 | n/a | [0, 0.019166] | [0, 0.009583] | 0.000539 | pass |
| 15 (2015) | Population | 181549 | 182422 | 873 | 0.480862 | [178036, 182428] | [179353, 182428] | 6 | pass |
| 15 (2015) | Approval points | 69.9904 | 69.412091 | -0.578309 | -0.82627 | [66.291755, 71.14672] | [67.562917, 71.14672] | 1.73463 | pass |
| 15 (2015) | Air at homes | 0.051467 | 0.054755 | 0.003288 | 6.38832 | [0.045746, 0.056549] | [0.046066, 0.056549] | 0.001794 | pass |
| 15 (2015) | I-HT share | 0 | 0.007649 | 0.007649 | n/a | [0, 0.018812] | [0, 0.009406] | 0.001757 | pass |
| 16 (2016) | Population | 201032 | 201972 | 940 | 0.467587 | [198458, 202147] | [199187.5, 202147] | 175 | pass |
| 16 (2016) | Approval points | 70.958706 | 69.994162 | -0.964544 | -1.359304 | [70.40255, 72.311562] | [70.40255, 71.913212] | -0.408388 | fail |
| 16 (2016) | Air at homes | 0.052439 | 0.060211 | 0.007772 | 14.821845 | [0.044153, 0.056537] | [0.046247, 0.056537] | -0.003675 | fail |
| 16 (2016) | I-HT share | 0 | 0.006903 | 0.006903 | n/a | [0, 0.018644] | [0, 0.009322] | 0.002419 | pass |
| 17 (2017) | Population | 220235 | 221834 | 1599 | 0.726043 | [217287, 221560] | [218098.5, 221560] | -274 | fail |
| 17 (2017) | Approval points | 71.213611 | 70.179885 | -1.033726 | -1.451585 | [70.174724, 72.37161] | [70.174724, 72.312055] | 0.005162 | pass |
| 17 (2017) | Air at homes | 0.057306 | 0.062745 | 0.005439 | 9.490743 | [0.050383, 0.062885] | [0.051055, 0.062885] | 0.00014 | pass |
| 17 (2017) | I-HT share | 0 | 0.006504 | 0.006504 | n/a | [0, 0.018692] | [0, 0.009346] | 0.002843 | pass |
| 18 (2018) | Population | 240111 | 242497 | 2386 | 0.993707 | [237922, 242097] | [238023.5, 242097] | -400 | fail |
| 18 (2018) | Approval points | 71.758047 | 71.110678 | -0.647368 | -0.902154 | [70.817567, 73.153183] | [70.817567, 72.925855] | 0.293112 | pass |
| 18 (2018) | Air at homes | 0.054557 | 0.064043 | 0.009486 | 17.387612 | [0.050128, 0.060823] | [0.050128, 0.059904] | -0.004139 | fail |
| 18 (2018) | I-HT share | 0 | 0.006252 | 0.006252 | n/a | [0, 0.018765] | [0, 0.009382] | 0.00313 | pass |
| 19 (2019) | Population | 261751 | 264414 | 2663 | 1.017379 | [258901, 264481] | [258961, 264481] | 67 | pass |
| 19 (2019) | Approval points | 72.793509 | 71.463439 | -1.330071 | -1.827183 | [72.031699, 74.568255] | [72.031699, 74.061787] | -0.56826 | fail |
| 19 (2019) | Air at homes | 0.052887 | 0.058022 | 0.005135 | 9.709641 | [0.050402, 0.056052] | [0.050402, 0.055712] | -0.00231 | fail |
| 19 (2019) | I-HT share | 0 | 0.001577 | 0.001577 | n/a | [0, 0.018578] | [0, 0.009289] | 0.001577 | pass |
| 20 (2020) | Population | 284274 | 286680 | 2406 | 0.846367 | [280865, 287234] | [281089.5, 287234] | 554 | pass |
| 20 (2020) | Approval points | 73.809515 | 72.888913 | -0.920602 | -1.247268 | [72.9964, 76.716866] | [72.9964, 75.669748] | -0.107487 | fail |
| 20 (2020) | Air at homes | 0.052379 | 0.058243 | 0.005864 | 11.195165 | [0.04963, 0.055717] | [0.04963, 0.055423] | -0.00282 | fail |
| 20 (2020) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.018524] | [0, 0.009262] | 0 | pass |
| 21 (2021) | Population | 307076 | 310034 | 2958 | 0.963279 | [303929, 310168] | [303956.5, 310168] | 134 | pass |
| 21 (2021) | Approval points | 76.552718 | 72.899423 | -3.653295 | -4.77226 | [75.184065, 77.754084] | [75.267708, 77.754084] | -2.368286 | fail |
| 21 (2021) | Air at homes | 0.052287 | 0.059 | 0.006713 | 12.839099 | [0.049701, 0.057203] | [0.049701, 0.056038] | -0.002962 | fail |
| 21 (2021) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.018588] | [0, 0.009294] | 0 | pass |
| 22 (2022) | Population | 331227 | 333269 | 2042 | 0.616496 | [327213, 333566] | [328050.5, 333566] | 297 | pass |
| 22 (2022) | Approval points | 77.209454 | 74.491468 | -2.717986 | -3.520276 | [76.047912, 77.489004] | [76.488909, 77.489004] | -1.99744 | fail |
| 22 (2022) | Air at homes | 0.054574 | 0.061384 | 0.00681 | 12.478638 | [0.050176, 0.058413] | [0.050455, 0.058413] | -0.00297 | fail |
| 22 (2022) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.018576] | [0, 0.009288] | 0 | pass |
| 23 (2023) | Population | 354705 | 357015 | 2310 | 0.651245 | [350807, 357155] | [351531, 357155] | 140 | pass |
| 23 (2023) | Approval points | 77.293919 | 76.228676 | -1.065242 | -1.378171 | [76.288757, 77.933607] | [76.471493, 77.933607] | -0.242817 | fail |
| 23 (2023) | Air at homes | 0.057738 | 0.062296 | 0.004558 | 7.893582 | [0.054987, 0.062385] | [0.054987, 0.061438] | -0.000858 | fail |
| 23 (2023) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.018594] | [0, 0.009297] | 0 | pass |
| 24 (2024) | Population | 379628 | 381553 | 1925 | 0.507075 | [375350, 381880] | [376363, 381880] | 327 | pass |
| 24 (2024) | Approval points | 76.818427 | 75.993698 | -0.824728 | -1.073607 | [76.460377, 78.169196] | [76.460377, 77.672836] | -0.466679 | fail |
| 24 (2024) | Air at homes | 0.059957 | 0.066151 | 0.006194 | 10.330379 | [0.057229, 0.065666] | [0.057229, 0.064176] | -0.001976 | fail |
| 24 (2024) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.018571] | [0, 0.009286] | 0 | pass |
| 25 (2025) | Population | 405373 | 407190 | 1817 | 0.448229 | [400281, 406789] | [402119, 406789] | -401 | fail |
| 25 (2025) | Approval points | 76.912012 | 76.03409 | -0.877922 | -1.141463 | [76.264005, 78.004875] | [76.264005, 77.782447] | -0.229915 | fail |
| 25 (2025) | Air at homes | 0.062913 | 0.068466 | 0.005553 | 8.8271 | [0.05815, 0.06689] | [0.058543, 0.06689] | -0.001577 | fail |
| 25 (2025) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.018577] | [0, 0.009288] | 0 | pass |
| 26 (2026) | Population | 431452 | 433234 | 1782 | 0.413024 | [426244, 432624] | [428262, 432624] | -610 | fail |
| 26 (2026) | Approval points | 77.534774 | 76.371722 | -1.163051 | -1.500038 | [76.564683, 78.244625] | [76.694802, 78.244625] | -0.32308 | fail |
| 26 (2026) | Air at homes | 0.061408 | 0.06914 | 0.007732 | 12.591371 | [0.056411, 0.067051] | [0.056411, 0.066728] | -0.002412 | fail |
| 26 (2026) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.018445] | [0, 0.009223] | 0 | pass |
| 27 (2027) | Population | 459324 | 461453 | 2129 | 0.463507 | [454626, 460015] | [456629.5, 460015] | -1438 | fail |
| 27 (2027) | Approval points | 77.591061 | 76.932484 | -0.658577 | -0.84878 | [76.516536, 78.806732] | [76.516536, 78.736159] | 0.415948 | pass |
| 27 (2027) | Air at homes | 0.063114 | 0.066989 | 0.003875 | 6.139499 | [0.057175, 0.069608] | [0.057175, 0.06933] | 0.002342 | pass |
| 27 (2027) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.018408] | [0, 0.009204] | 0 | pass |
| 28 (2028) | Population | 488133 | 490335 | 2202 | 0.451107 | [484568, 489945] | [485444.5, 489945] | -390 | fail |
| 28 (2028) | Approval points | 78.003959 | 77.017163 | -0.986796 | -1.265059 | [77.091076, 80.15943] | [77.091076, 79.538136] | -0.073913 | fail |
| 28 (2028) | Air at homes | 0.06298 | 0.070046 | 0.007066 | 11.220001 | [0.058385, 0.071639] | [0.058385, 0.069607] | -0.000439 | fail |
| 28 (2028) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.018405] | [0, 0.009202] | 0 | pass |
| 29 (2029) | Population | 518809 | 520729 | 1920 | 0.370078 | [515169, 520829] | [515979, 520829] | 100 | pass |
| 29 (2029) | Approval points | 80.266762 | 77.509737 | -2.757025 | -3.434828 | [78.817776, 81.600923] | [78.875189, 81.600923] | -1.365451 | fail |
| 29 (2029) | Air at homes | 0.065344 | 0.072961 | 0.007617 | 11.657101 | [0.061447, 0.075015] | [0.061447, 0.072128] | -0.000834 | fail |
| 29 (2029) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.018529] | [0, 0.009265] | 0 | pass |
| 30 (2030) | Population | 549130 | 551648 | 2518 | 0.458544 | [545987, 551504] | [546371.5, 551504] | -144 | fail |
| 30 (2030) | Approval points | 81.440401 | 78.438929 | -3.001472 | -3.685483 | [79.232013, 81.86017] | [80.126323, 81.86017] | -1.687394 | fail |
| 30 (2030) | Air at homes | 0.069741 | 0.076201 | 0.00646 | 9.262386 | [0.062872, 0.076904] | [0.062872, 0.076757] | 0.000556 | pass |
| 30 (2030) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.018519] | [0, 0.009259] | 0 | pass |
| 31 (2031) | Population | 580247 | 582621 | 2374 | 0.409136 | [577395, 583309] | [577395, 583204] | 583 | pass |
| 31 (2031) | Approval points | 81.860673 | 78.76092 | -3.099752 | -3.786619 | [80.92348, 82.372373] | [81.136226, 82.372373] | -2.375306 | fail |
| 31 (2031) | Air at homes | 0.074493 | 0.080226 | 0.005733 | 7.69672 | [0.067505, 0.083421] | [0.067505, 0.082451] | 0.002225 | pass |
| 31 (2031) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.017914] | [0, 0.008957] | 0 | pass |
| 32 (2032) | Population | 613277 | 614477 | 1200 | 0.19567 | [608730, 615409] | [609937.5, 615409] | 932 | pass |
| 32 (2032) | Approval points | 82.080383 | 80.040413 | -2.03997 | -2.485332 | [81.539946, 82.817546] | [81.539946, 82.719183] | -1.499533 | fail |
| 32 (2032) | Air at homes | 0.077513 | 0.085091 | 0.007578 | 9.776695 | [0.071208, 0.085898] | [0.071208, 0.084858] | -0.000233 | fail |
| 32 (2032) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.017426] | [0, 0.008713] | 0 | pass |
| 33 (2033) | Population | 645069 | 647124 | 2055 | 0.318571 | [641046, 648681] | [641251.5, 648681] | 1557 | pass |
| 33 (2033) | Approval points | 82.361918 | 80.301667 | -2.060251 | -2.501461 | [81.444775, 83.294922] | [81.444775, 83.286991] | -1.143108 | fail |
| 33 (2033) | Air at homes | 0.083733 | 0.089552 | 0.00582 | 6.95023 | [0.074329, 0.090831] | [0.075481, 0.090831] | 0.001279 | pass |
| 33 (2033) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.013508] | [0, 0.006754] | 0 | pass |
| 34 (2034) | Population | 678240 | 679325 | 1085 | 0.159973 | [671270, 681039] | [673355.5, 681039] | 1714 | pass |
| 34 (2034) | Approval points | 82.482752 | 80.596939 | -1.885813 | -2.286312 | [81.614885, 82.96945] | [81.805469, 82.96945] | -1.20853 | fail |
| 34 (2034) | Air at homes | 0.086747 | 0.094699 | 0.007952 | 9.167392 | [0.076779, 0.101734] | [0.076779, 0.099224] | 0.004525 | pass |
| 34 (2034) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.009776] | [0, 0.004888] | 0 | pass |
| 35 (2035) | Population | 711356 | 712455 | 1099 | 0.154494 | [705812, 714537] | [706993.5, 714537] | 2082 | pass |
| 35 (2035) | Approval points | 82.529374 | 80.420354 | -2.10902 | -2.555478 | [81.232581, 82.892147] | [81.699591, 82.892147] | -1.279237 | fail |
| 35 (2035) | Air at homes | 0.093835 | 0.099574 | 0.005739 | 6.116074 | [0.083873, 0.100117] | [0.085713, 0.100117] | 0.000543 | pass |
| 35 (2035) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.009151] | [0, 0.004575] | 0 | pass |
| 36 (2036) | Population | 744626 | 745401 | 775 | 0.104079 | [738362, 749055] | [739279.5, 749055] | 3654 | pass |
| 36 (2036) | Approval points | 82.583011 | 80.75302 | -1.829992 | -2.215942 | [81.851181, 83.806878] | [81.851181, 83.56086] | -1.098161 | fail |
| 36 (2036) | Air at homes | 0.10081 | 0.10438 | 0.003569 | 3.540605 | [0.090213, 0.107488] | [0.092173, 0.107488] | 0.003109 | pass |
| 36 (2036) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.004347] | [0, 0.002173] | 0 | pass |
| 37 (2037) | Population | 778119 | 779800 | 1681 | 0.216034 | [773730, 782802] | [773730, 782655] | 2855 | pass |
| 37 (2037) | Approval points | 82.648757 | 80.546078 | -2.102679 | -2.544115 | [82.041069, 83.143764] | [82.09741, 83.143764] | -1.551332 | fail |
| 37 (2037) | Air at homes | 0.103446 | 0.111016 | 0.00757 | 7.317781 | [0.093099, 0.113785] | [0.093102, 0.113785] | 0.00277 | pass |
| 37 (2037) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.004136] | [0, 0.002068] | 0 | pass |
| 38 (2038) | Population | 813825 | 813642 | -183 | -0.022486 | [807517, 817770] | [808698.5, 817770] | 4128 | pass |
| 38 (2038) | Approval points | 82.24961 | 80.131396 | -2.118214 | -2.575349 | [81.422337, 82.954038] | [81.483759, 82.954038] | -1.352364 | fail |
| 38 (2038) | Air at homes | 0.108827 | 0.115916 | 0.007089 | 6.514417 | [0.097531, 0.11928] | [0.097953, 0.11928] | 0.003363 | pass |
| 38 (2038) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.004098] | [0, 0.002049] | 0 | pass |
| 39 (2039) | Population | 845902 | 850633 | 4731 | 0.559285 | [841049, 853196] | [841049, 851975.5] | 1342.5 | pass |
| 39 (2039) | Approval points | 82.56106 | 79.849776 | -2.711284 | -3.283974 | [81.556214, 83.179825] | [81.749255, 83.179825] | -1.899479 | fail |
| 39 (2039) | Air at homes | 0.117282 | 0.120515 | 0.003233 | 2.756887 | [0.103999, 0.126057] | [0.106253, 0.126057] | 0.005542 | pass |
| 39 (2039) | I-HT share | 0 | 0 | 0 | 0 | [0, 0.004111] | [0, 0.002056] | 0 | pass |
| 40 (2040) | Population | 883512 | 884767 | 1255 | 0.142047 | [878323, 889836] | [878323, 889268.5] | 4501.5 | pass |
| 40 (2040) | Approval points | 82.922116 | 80.259669 | -2.662447 | -3.21078 | [81.945484, 83.257913] | [82.265901, 83.257913] | -2.006232 | fail |
| 40 (2040) | Air at homes | 0.119225 | 0.124523 | 0.005298 | 4.443502 | [0.106316, 0.129887] | [0.107439, 0.129887] | 0.005364 | pass |
| 40 (2040) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 41 (2041) | Population | 914777 | 919393 | 4616 | 0.504604 | [913253, 927072] | [913253, 921686.5] | 2293.5 | pass |
| 41 (2041) | Approval points | 82.302044 | 79.84247 | -2.459574 | -2.988473 | [81.131021, 82.881996] | [81.426557, 82.881996] | -1.584087 | fail |
| 41 (2041) | Air at homes | 0.124134 | 0.12733 | 0.003197 | 2.575108 | [0.111427, 0.142697] | [0.111427, 0.139769] | 0.012438 | pass |
| 41 (2041) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 42 (2042) | Population | 955849 | 955674 | -175 | -0.018308 | [947049, 962805] | [947971, 962805] | 7131 | pass |
| 42 (2042) | Approval points | 82.168555 | 79.888446 | -2.28011 | -2.774917 | [81.583607, 82.855949] | [81.583607, 82.804726] | -1.695161 | fail |
| 42 (2042) | Air at homes | 0.128761 | 0.133745 | 0.004984 | 3.870913 | [0.115737, 0.144575] | [0.115737, 0.14318] | 0.009435 | pass |
| 42 (2042) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 43 (2043) | Population | 993905 | 989973 | -3932 | -0.395611 | [981631, 999561] | [984940, 999561] | 5033 | pass |
| 43 (2043) | Approval points | 82.004656 | 79.481837 | -2.52282 | -3.076435 | [81.005473, 82.462452] | [81.276167, 82.462452] | -1.79433 | fail |
| 43 (2043) | Air at homes | 0.132343 | 0.131742 | -0.000601 | -0.454286 | [0.116848, 0.146611] | [0.117461, 0.146611] | 0.014281 | pass |
| 43 (2043) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 44 (2044) | Population | 1031139 | 1029229 | -1910 | -0.185232 | [1017766, 1038005] | [1021019.5, 1038005] | 8209.5 | pass |
| 44 (2044) | Approval points | 81.673885 | 79.479338 | -2.194547 | -2.686963 | [80.856138, 82.351654] | [80.926128, 82.351654] | -1.446789 | fail |
| 44 (2044) | Air at homes | 0.139037 | 0.13938 | 0.000343 | 0.246487 | [0.127841, 0.153304] | [0.127841, 0.151768] | 0.011538 | pass |
| 44 (2044) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 45 (2045) | Population | 1069790 | 1065576 | -4214 | -0.393909 | [1055287, 1076009] | [1059429, 1076009] | 6147 | pass |
| 45 (2045) | Approval points | 81.362027 | 79.291934 | -2.070093 | -2.544299 | [80.198059, 82.471228] | [80.225443, 82.471228] | -0.933509 | fail |
| 45 (2045) | Air at homes | 0.143253 | 0.141357 | -0.001896 | -1.323507 | [0.133344, 0.158265] | [0.133344, 0.155714] | 0.008014 | pass |
| 45 (2045) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 46 (2046) | Population | 1109236 | 1106206 | -3030 | -0.273161 | [1094324, 1115154] | [1098821, 1115154] | 7385 | pass |
| 46 (2046) | Approval points | 81.156899 | 78.879259 | -2.27764 | -2.806465 | [80.386412, 81.554803] | [80.572703, 81.554803] | -1.693445 | fail |
| 46 (2046) | Air at homes | 0.151972 | 0.143724 | -0.008248 | -5.427286 | [0.13572, 0.159906] | [0.139878, 0.159906] | 0.003845 | pass |
| 46 (2046) | I-HT share | 0 | 0 | 0 | 0 | [0, 0] | [0, 0] | 0 | pass |
| 47 (2047) | Population | 1147038 | 1144354 | -2684 | -0.233994 | [1132339, 1152325] | [1137045, 1152325] | 7309 | pass |
| 47 (2047) | Approval points | 80.616788 | 78.832784 | -1.784003 | -2.212943 | [79.541246, 81.87627] | [79.541246, 81.7843] | -0.708462 | fail |
| 47 (2047) | Air at homes | 0.157108 | 0.150713 | -0.006395 | -4.070714 | [0.13841, 0.169139] | [0.141744, 0.169139] | 0.008969 | pass |
| 47 (2047) | I-HT share | 0 | 0.005939 | 0.005939 | n/a | [0, 0] | [0, 0] | -0.005939 | fail |
| 48 (2048) | Population | 1186645 | 1186766 | 121 | 0.010197 | [1169316, 1190815] | [1175895.5, 1190815] | 4049 | pass |
| 48 (2048) | Approval points | 81.300278 | 78.815334 | -2.484945 | -3.056502 | [79.779126, 81.823414] | [80.278134, 81.823414] | -1.462801 | fail |
| 48 (2048) | Air at homes | 0.153944 | 0.151245 | -0.002698 | -1.752723 | [0.140154, 0.171809] | [0.140154, 0.169771] | 0.011092 | pass |
| 48 (2048) | I-HT share | 0 | 0.015826 | 0.015826 | n/a | [0, 0] | [0, 0] | -0.015826 | fail |
| 49 (2049) | Population | 1230333 | 1223139 | -7194 | -0.58472 | [1209924, 1233587] | [1218501.5, 1233587] | 4637.5 | pass |
| 49 (2049) | Approval points | 80.534175 | 78.352092 | -2.182083 | -2.709512 | [79.830502, 81.423558] | [79.830502, 81.330703] | -1.478409 | fail |
| 49 (2049) | Air at homes | 0.155267 | 0.154156 | -0.001111 | -0.715521 | [0.144445, 0.173847] | [0.144445, 0.169968] | 0.009711 | pass |
| 49 (2049) | I-HT share | 0 | 0.018322 | 0.018322 | n/a | [0, 0] | [0, 0] | -0.018322 | fail |
| 50 (2050) | Population | 1266953 | 1243264 | -23689 | -1.869762 | [1254073, 1276465] | [1255757, 1276465] | -12493 | fail |
| 50 (2050) | Approval points | 80.822172 | 78.402297 | -2.419875 | -2.994073 | [79.830743, 81.321436] | [80.076825, 81.321436] | -1.674528 | fail |
| 50 (2050) | Air at homes | 0.163261 | 0.152849 | -0.010412 | -6.377773 | [0.140626, 0.174208] | [0.14647, 0.174208] | 0.006379 | pass |
| 50 (2050) | I-HT share | 0 | 0.027627 | 0.027627 | n/a | [0, 0] | [0, 0] | -0.027627 | fail |
| 51 (2051) | Population | 1310276 | 1280572 | -29704 | -2.267003 | [1295571, 1317330] | [1299396.5, 1317330] | -18824.5 | fail |
| 51 (2051) | Approval points | 80.421799 | 78.296965 | -2.124834 | -2.642112 | [79.663376, 80.892828] | [79.807073, 80.892828] | -1.510108 | fail |
| 51 (2051) | Air at homes | 0.16144 | 0.161419 | -0.000021 | -0.013068 | [0.146473, 0.175127] | [0.147113, 0.175127] | 0.013708 | pass |
| 51 (2051) | I-HT share | 0 | 0.031509 | 0.031509 | n/a | [0, 0.010019] | [0, 0.00501] | -0.026499 | fail |
| 52 (2052) | Population | 1353432 | 1301309 | -52123 | -3.851172 | [1335822, 1358146] | [1342270, 1358146] | -40961 | fail |
| 52 (2052) | Approval points | 80.532339 | 78.186875 | -2.345464 | -2.91245 | [79.593908, 80.725192] | [79.966697, 80.725192] | -1.779822 | fail |
| 52 (2052) | Air at homes | 0.163856 | 0.156905 | -0.006951 | -4.242147 | [0.143862, 0.180875] | [0.145349, 0.180875] | 0.011555 | pass |
| 52 (2052) | I-HT share | 0.005203 | 0.052457 | 0.047254 | 908.234778 | [0, 0.012521] | [0, 0.011463] | -0.040993 | fail |
| 53 (2053) | Population | 1391300 | 1319909 | -71391 | -5.131244 | [1372356, 1404494] | [1375231, 1404494] | -55322 | fail |
| 53 (2053) | Approval points | 80.814111 | 78.726026 | -2.088085 | -2.583813 | [79.313848, 81.187269] | [79.8774, 81.187269] | -1.151374 | fail |
| 53 (2053) | Air at homes | 0.161633 | 0.159397 | -0.002236 | -1.383117 | [0.142825, 0.182658] | [0.142825, 0.181549] | 0.016572 | pass |
| 53 (2053) | I-HT share | 0.016105 | 0.065576 | 0.04947 | 307.167565 | [0, 0.025] | [0.003605, 0.025] | -0.040576 | fail |
| 54 (2054) | Population | 1410655 | 1324744 | -85911 | -6.09015 | [1388950, 1450423] | [1388950, 1441391.5] | -64206 | fail |
| 54 (2054) | Approval points | 80.42361 | 78.564753 | -1.858858 | -2.311333 | [79.70135, 81.510728] | [79.70135, 81.3283] | -1.136597 | fail |
| 54 (2054) | Air at homes | 0.164057 | 0.155754 | -0.008303 | -5.060783 | [0.14336, 0.180829] | [0.145323, 0.180829] | 0.010432 | pass |
| 54 (2054) | I-HT share | 0.025673 | 0.07174 | 0.046067 | 179.434049 | [0, 0.031626] | [0.00986, 0.031626] | -0.040114 | fail |
| 55 (2055) | Population | 1428499 | 1340518 | -87981 | -6.158982 | [1386414, 1468215] | [1387598.5, 1468215] | -47080.5 | fail |
| 55 (2055) | Approval points | 80.740354 | 78.648991 | -2.091363 | -2.590233 | [79.93082, 81.717258] | [79.93082, 81.633573] | -1.281829 | fail |
| 55 (2055) | Air at homes | 0.165501 | 0.164192 | -0.001309 | -0.790946 | [0.144886, 0.184044] | [0.145922, 0.184044] | 0.01827 | pass |
| 55 (2055) | I-HT share | 0.028589 | 0.081442 | 0.052852 | 184.86722 | [0, 0.04063] | [0.008274, 0.04063] | -0.040812 | fail |
| 56 (2056) | Population | 1444001 | 1351653 | -92348 | -6.395286 | [1400344, 1478360] | [1404993, 1478360] | -53340 | fail |
| 56 (2056) | Approval points | 80.375631 | 78.491431 | -1.8842 | -2.344243 | [80.110601, 80.922619] | [80.110601, 80.78164] | -1.61917 | fail |
| 56 (2056) | Air at homes | 0.163848 | 0.160506 | -0.003342 | -2.039551 | [0.144752, 0.179428] | [0.14651, 0.179428] | 0.013997 | pass |
| 56 (2056) | I-HT share | 0.041271 | 0.092602 | 0.051332 | 124.377818 | [0, 0.056866] | [0.012838, 0.056866] | -0.035736 | fail |
| 57 (2057) | Population | 1456317 | 1371210 | -85107 | -5.843989 | [1403945, 1487877] | [1414351, 1487877] | -43141 | fail |
| 57 (2057) | Approval points | 80.329177 | 78.595444 | -1.733732 | -2.158285 | [79.076655, 81.11718] | [79.308914, 81.11718] | -0.71347 | fail |
| 57 (2057) | Air at homes | 0.168617 | 0.161708 | -0.00691 | -4.097845 | [0.14591, 0.186551] | [0.148297, 0.186551] | 0.013411 | pass |
| 57 (2057) | I-HT share | 0.048963 | 0.105868 | 0.056904 | 116.217598 | [0, 0.086366] | [0.005781, 0.086366] | -0.019502 | fail |
| 58 (2058) | Population | 1462768 | 1385711 | -77057 | -5.267889 | [1414561, 1491615] | [1424241, 1491615] | -38530 | fail |
| 58 (2058) | Approval points | 80.212966 | 79.092677 | -1.120289 | -1.396643 | [79.518843, 80.863566] | [79.540605, 80.863566] | -0.447928 | fail |
| 58 (2058) | Air at homes | 0.168696 | 0.159664 | -0.009032 | -5.353747 | [0.142471, 0.182266] | [0.148799, 0.182266] | 0.010866 | pass |
| 58 (2058) | I-HT share | 0.050926 | 0.111186 | 0.06026 | 118.327433 | [0, 0.098987] | [0.001433, 0.098987] | -0.012199 | fail |
| 59 (2059) | Population | 1482680 | 1396156 | -86524 | -5.835649 | [1416617, 1504263] | [1438857, 1504263] | -42701 | fail |
| 59 (2059) | Approval points | 80.102785 | 78.801706 | -1.301079 | -1.624262 | [79.690658, 80.827008] | [79.690658, 80.670961] | -0.888951 | fail |
| 59 (2059) | Air at homes | 0.16267 | 0.15642 | -0.00625 | -3.841951 | [0.147304, 0.182974] | [0.147304, 0.180504] | 0.009115 | pass |
| 59 (2059) | I-HT share | 0.070867 | 0.123244 | 0.052377 | 73.907863 | [0, 0.100958] | [0.020388, 0.100958] | -0.022286 | fail |
| 60 (2060) | Population | 1483518 | 1394211 | -89307 | -6.019947 | [1427340, 1511108] | [1441634, 1511108] | -47423 | fail |
| 60 (2060) | Approval points | 80.441199 | 79.188666 | -1.252533 | -1.557079 | [79.137167, 81.356695] | [79.331435, 81.356695] | -0.142769 | fail |
| 60 (2060) | Air at homes | 0.17075 | 0.161386 | -0.009363 | -5.483726 | [0.147485, 0.190513] | [0.149236, 0.190513] | 0.01215 | pass |
| 60 (2060) | I-HT share | 0.08191 | 0.13585 | 0.05394 | 65.853081 | [0, 0.10579] | [0.029015, 0.10579] | -0.03006 | fail |

## Reproduction and evidence

Input manifest: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/T045.manifest.json`. All summary paths and member raw paths, commands, cache keys, source hashes and reused-member provenance are retained in the manifest/summaries.

Generate this report without starting bots: `node --experimental-strip-types "C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-lanes\judge-T045.mts" "C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/T045.manifest.json"`.

No measurement-tree files, lane reports, reference fixtures, sim constants, production code or RNG behavior were changed. Final acceptance after T041 lands remains a separate gate.

### Exact campaign collection commands

The command ledger is `C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-lanes\commands.json`. Commands below are the actual outer runner invocations; each member launches through the quiet gate. Existing completed members are reused, including the original five flags-off dev members. Commands are sequential across the whole campaign, with at most four bots per command.

- T045/base, 128x15_s7, 5 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/T045-base-128x15_s7-5.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T045m --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T045/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5
```

- T045/base, 256x60_s7, 5 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/T045-base-256x60_s7-5.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T045m --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T045/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5
```

- T045/base, 256x60_s11, 5 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/T045-base-256x60_s11-5.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T045m --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T045/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5
```

- T045/subway, 256x60_s7, 5 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/T045-subway-256x60_s7-5.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T045m --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T045/subway --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 -- --subway
```

- T045/subway-no-transit, 256x60_s7, 5 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/T045-subway-no-transit-256x60_s7-5.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T045m --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T045/subway-no-transit --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 -- --subway --skip transit
```

- dev/base, 128x15_s7, 5 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/dev-base-128x15_s7-5.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/import-dev
```

- dev/base, 256x60_s7, 5 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/dev-base-256x60_s7-5.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/import-dev
```

- dev/base, 256x60_s11, 5 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/dev-base-256x60_s11-5.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/import-dev
```

- dev/subway, 256x60_s7, 5 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/dev-subway-256x60_s7-5.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/subway --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 -- --subway
```

- dev/base, 128x15_s7, 9 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/dev-base-128x15_s7-9.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
```

- dev/base, 256x60_s7, 9 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/dev-base-256x60_s7-9.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
```

- dev/base, 256x60_s11, 9 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/dev-base-256x60_s11-9.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
```

- T045/base, 128x15_s7, 9 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/T045-base-128x15_s7-9.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T045m --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T045/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
```

- T045/base, 256x60_s7, 9 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/T045-base-256x60_s7-9.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T045m --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T045/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
```

- T045/base, 256x60_s11, 9 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/T045-base-256x60_s11-9.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T045m --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T045/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
```

- T045/subway, 256x60_s7, 9 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/T045-subway-256x60_s7-9.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T045m --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T045/subway --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9 -- --subway
```

- T045/subway-no-transit, 256x60_s7, 9 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/T045-subway-no-transit-256x60_s7-9.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T045m --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T045/subway-no-transit --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9 -- --subway --skip transit
```

- dev/subway, 256x60_s7, 9 members; exit 0; log `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/logs/dev-subway-256x60_s7-9.log`.

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/subway --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9 -- --subway
```
