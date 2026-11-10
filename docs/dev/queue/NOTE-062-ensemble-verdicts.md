# NOTE-062 (lead → desktop worker), 10 Nov: the T043/T044/T045 ensemble verdicts

Thanks for the campaign: 170 new members plus the 9-member stages, none unfinished. The verdicts below are on the dev
each lane is built on (805d7d4), before B2 and T041. They tell each lane what to do next. **Nothing here gates a
merge:** the final gates run on the dev that includes B2 and T041.

**The short version:**
- **T043 (LG-06): fix round.** A real regression on 256×60 s11, a real small shift on 128×15, and LG-06 barely makes the
  neglectful city pay.
- **T044 (LG-07): mechanics accepted for now, no fix round.** Narrow gate amendments, for T044 only. The year-60
  approval gain stays a gate and waits for dev's own clean ensemble.
- **T045 (LG-08): hold.** The s11 car city ends 6 % smaller. That blocks the merge if it survives on the final dev.
  Approval is judged net of LG-08's own commute term.

## 1. Rules for every SIM lane's final gate

Set now, before any final run, so that no rule follows a result:
- **9 members, directly.** Every base row and every 256×60 variant row runs 9 members (control, ±§100 and ±§200 on day 1
  and day 1441), for the lane and for dev at the same dev commit. 128×15 variant rows run 5, with NOTE-053's second
  stage. Cached members are reused, so this saves a scheduling round, not bot time.
- **No third stage.** The 9-member median verdict is final. No lane gets extra members.
- **Fewer failures at 9 members than at 5 is not evidence of noise.** Dev's min-max band widens as members are added:
  s7's year-60 band grew from 133,913 to 200,875 wide. At the final gate a failure stands unless a rule in this NOTE
  exempts it.
- **Disjoint bands are a real shift.** If a row's lane min-max band lies wholly outside dev's for 3 or more consecutive
  years, report it as a real shift, whatever the other rows show, and explain its mechanism. This adds to NOTE-053's
  three-row check, which missed T043's s11 row (44 years disjoint) because the rows moved in opposite directions.
- **Zero-width dev band.** A year in which all 9 dev members sit at exactly 0 on the I-HT share does not gate that
  metric. Report the first year the lane's median leaves 0.
- **Per-member columns.** Every 256×60 table adds each member's year-60 value, a stalled flag (growth under 100,000 from
  2050 to 2060), and the stalled count for lane and dev. They are reported, not gated: they show when a median sits
  between two groups.
- **Trace every table to origin.** The measured trees are not on origin: T043 at 414e491, T044 at a1a4e79, and T045's
  measured tree. Push each as `local/<lane>-measured`, or name its parent commit in the report. On T043's pushed head,
  the commits after e01526a touch only src/worker, tests and docs (4a6aaff, cd4d0d0), so its src/sim should match the
  measured tree; confirm it.

## 2. T043 (LG-06): fix round

**What failed and why.** Three different things, and one problem under all of them:
- **256×60 s11 base: a real regression.** The attentive city is −17.6 % at year 10 (79,929 against 96,965) and −3.4 % at
  year 60 (1,433,346 against 1,483,518). Every lane member is below every dev member from 2010 to 2053. Approval and air
  at homes fail in the same window as knock-ons. The `--neglect` city is not hurt (year 10: 95,872 against dev's
  94,684).
- **128×15 s7 base: a real, small upward shift,** +1.3 % to +2.3 % in all 6 years (year 15: 195,129 against 191,588). A
  cost mechanic that adds growth is not the lane doing its job. The lane's scars-only ablation alone gives +1.92 %.
- **256×60 s7 base: unresolved, not noise.** In 2053-2058 the lane's population median is above every dev member (+2.8 %
  to +6.9 %). In 2054-2060 its I-HT median is below every dev member. Same window, so probably one late shift.
- **Under all three: LG-06 barely makes neglect cost anything by itself.** Against LG-06 off, the neglectful city moves
  −0.8 % on s7 and +2.3 % on s11, and its s11 funds rise 6.3 %. Put the attentive base back at dev's median and the −2 %
  target still misses on both seeds: s11 by 35,501 people (funds by §398,289), s7 by 18,985. Today's s7 variant passes
  come from the attentive base rising late. The approval-cost target passes on both seeds: +1.83 points of extra cost on
  s7, +0.25 on s11.

**Analyst against review:** I went with the review on each point where they differed. The s11 variant misses are not
only the base regression (above). The s7 late rows are unresolved, not noise. The diagnosis comes before any change to
how the rebuild charge is booked. The EM_REP 8/12/24 single runs are not evidence (NOTE-053 item 1).

**Gates.** No threshold changes: −2 % neglect population, neglect funds ≤ base, approval gap_on ≤ gap_off + 0.5, base
population within max(1 %, half of dev's band). None of these amendments loosens anything:
- **Tolerances, as T062 applied them:** 1 % for population (NOTE-048's amendment of the plan's ±0.5 %); 0 for approval,
  air at homes and the I-HT share, where NOTE-053's half of dev's band replaces NOTE-048's ±1 % floor.
- **UNCONFIRMED:** a `--neglect` target met while that seed's base row fails is reported as UNCONFIRMED, not PASS.
- **Neglect must cost by itself (new, a tightening):** on each seed, the year-60 median of `--neglect` with LG-06 on
  must be below `--neglect` with LG-06 off (dev's `--neglect` ensemble at the same dev commit). Without it, base drift
  inside the s7 tolerance (±100,437, 6.9 % at year 60) can meet the −2 % target with no change to the neglectful city.
  LG-06's Problem is that neglect "costs approval and nothing else".
- **The on-against-off table, in every report:** per seed, at years 10 and 60: median(neglect, on) − median(neglect,
  off), and median(attentive, on) − median(attentive, off).
- **Tourism 0.7-1.3 from year 15 and failed ≤ 5 % from year 10 stay OPEN** until measured. Run the lane's monthly probe
  on every base member and judge the per-month median of the trailing-12-month value. The single run put s11 tourism at
  1.372.

**Fix items, in this order:**
1. **Diagnose before changing anything.** The default bot stays unchanged.
   - Run 256×15 attentive and `--neglect` as 5-member ensembles on the lane and on dev, for s11 and two other seeds you
     pick before the runs.
   - Repeat on a throwaway worktree of T043 merged with T041 (ea0856d): T041's +22 % short-run funds change the early
     cash path.
   - Add attentive single-mechanic ablations: rebuild only; the safety record only (migration and tourism); scars only.
   - Log monthly through year 10: funds, the bot's reserve and canInvest margins, monthly net, the rebuild charge,
     failed12/incidents12, full against crime-only safety, the migration multiplier, live scars, and the purchases that
     canSpend, canAfford and canInvest blocked.
   - Answer two questions: which mechanic opens the year-10 gap, and why the neglectful city escapes it, although it
     pays at least as many rebuild charges.
2. **The rebuild booking.** Only if step 1 shows that the recurring 'emergency:rebuild' line drives the stall through
   the bot's reserve and net checks (tools/simbot.ts:357-405), send me the option of charging each loss once, under
   'oneoff:rebuild'. It is a spec amendment, not a clarification: it changes what the default bot sees and removes the
   charge from the forecast players see. Do not change the booking before I answer.
3. **Scars.** Find out why a stigma raises growth: +1.92 % in the 128 scars-only run, and the 2,000-resident police
   threshold crossed a month early. Trace it through land value, desirability, the wealth mix and the NIMBY pass. Fix a
   side channel if there is one. If it is the land-value model working as built, send me the trade-off. No compensating
   term (NOTE-048 item 4).
4. **Make neglect pay.** After 1-3, screen the levers NOTE-048 item 2 allows, as 5-member ensembles: EM_REP up, the
   ±12 % migration span, the tourism weight of safety, and the scar's stigma, radius and duration. Do not lower
   REBUILD_SHARE or any other specified cost. If no allowed setting makes the neglectful city pay at least 2 % on both
   seeds while the base rows pass, send me the ensemble trade-off table.
5. **Losses the player could not prevent.** If step 1 shows the stall comes from charges on fires before any station
   reaches the town, or on incidents never prompted, send me option (a) with a 5-member screen that includes its effect
   on the neglect targets: rebuild charges, scars and safety-record failures count only prompted or reachable incidents.
   That one goes to the user (section 5).
6. **The report:** add the on-against-off table. Mark the s7 variant passes UNCONFIRMED and the s7 late base rows
   UNRESOLVED. Record that the ensemble reversed the single-run s11 base shift (+4.7 % in the single run, −3.4 % on the
   median).

After the fix, screen with 5-member 128×15 s7 and 256×15 (s11 and the two extra seeds), on the current dev and on the
T043+T041 worktree. The 60-year rows run only on the final dev.

**Runs to repeat on the final dev:**
- first, a 5-member 256×15 early-window check, attentive and `--neglect`, on the same three seeds;
- then 9-member base ensembles on all three rows, and 9-member `--neglect` on 256×60 s7 and s11;
- the monthly tourism and failed-share probe on every base member.

T062 supplies dev's 9-member `--neglect` (LG-06 off) on s7 and s11.

## 3. T044 (LG-07): mechanics accepted for now; no fix round

**What failed and why.** Every row about the item's purpose passes: 128×15 clean population at 0.872× (167,218 against
191,771), run-mean air 21.1 % cleaner, 256×60 s7 clean at least 0.97× (margin +103,160), base population on all three
rows, the EQ gate, and the systematic-shift check. Three checks fail. The first two are not lane regressions; the third
is open:
- **s11 base approval, 4 years** (2035, 2056, 2058, 2059): all upward, at most 0.145 points outside dev's band. Approval
  is higher in 24 and air cleaner in 21 of the 31 years from 2030. That is LG-07's intended direction.
- **256×60 s7 clean population above 1.03×:** +3.99 % (1,534,036 against 1,475,130), the upper side of "within 3 %". The
  base's 2054-2057 plateau is shared with dev, so it is not a lane fork. The clean city may escape it through the
  skips('dirty') bot's own planning.
- **The year-60 approval gain:** +0.03 against +1. This is a real late loss, not a noisy endpoint: the gain is at most
  +0.54 in every year from 2054 to 2060 at 9 members (mean +0.15). Base air stays within ±3.4 % of dev from 2050 to
  2060, so the clean city's air rose to the base's level, plausibly through retooled I-M and its larger size. Whether
  this is a T044 regression or a flaw in the "+1.2" premise (one balance-r3 run) is unknown until dev's own clean
  ensemble exists.

**Analyst against review:** I went with the review. The run-mean approval gate from year 10 is rejected: it is the one
window that passes (from year 30 the mean gain is +0.995 at 9 members and +0.58 at 5). The base-row change stays
T044-only and one-sided. The s11 approval misses are an intended effect, not a misspecified gate.

**Gate amendments (T044 only; not extended to T043 or T045):**
- **Base rows:** NOTE-053's rule on population (1 %), approval and air at homes. A year that leaves dev's band only in
  LG-07's intended direction (approval up, air cleaner), by less than half of dev's band, is reported as an intended
  effect and does not fail. The other direction fails as usual. The realised I-HT share in base rows is reported, not
  gated (NOTE-048 T044 item 3). Add G-AB (abandoned ≤ 3 %) on all three rows; the plan lists it for LG-07. Under this
  rule, today's s11 approval misses are intended effects.
- **256×60 s7 `--skip dirty` population:** the year-60 median is at least 0.97× the same-commit base median, one-sided.
  Report the upper side. If the clean median exceeds base by more than half of dev's year-60 band, it goes to the user
  as "clean industry dominates". Why: LG-07's Problem is the cost of going clean, and half of dev's year-60 band is
  100,437 people (6.8 %), so a 3 % upper side reads noise. A 9-member 256×60 s11 `--skip dirty` row is required as a
  second-seed check, under the same flag rule.
- **"Keeping the +1 approval"** stays the year-60 gain on strict 9-member medians: at least +1. NOTE-048 T044 item 4's
  A/A-envelope slack is dropped, because NOTE-052's 5.5-point envelope would pass anything. Then:
  - if dev's own clean ensemble gains at least +1 at year 60 and T044 does not, it is a real regression: open a T044 fix
    round on the late clean-city air and approval, within NOTE-048 item 4;
  - if dev's gain is also below +1, the +1.2 premise was one run, and the question goes to the user (section 5). Any new
    target is written before T044's final run, and its window excludes years 10-14, when the clean city is 17-25 %
    smaller.
- **High-tech gate (a), defined now:** the I-HT share of positive incremental demand (econData.demandAbs, with
  I-D + I-M + I-HT as the denominator), as the per-year median of the 256×60 s7 base ensemble. It must be at least 25 %
  from the first year the EQ median reaches 110 through 2040. That is NOTE-048's "what a player who zones IndHigh can
  get". Report the raw and capped readings beside it. Round 3's 28.29 % predates round 4 and is not a result.

**Fix items:**
1. **The collector (T062, read-only):** per-year ihtDemandShare (raw, capped and positive demandAbs), dirtyJobShare,
   retooledIM and retooledIHT, from econData(st).demandAbs and industrialStrategy(st). Test that the default bot's rows
   and state hashes stay identical.
2. **tools/industryProbe.ts:** no code change. Rerun gate (b) on the final tree, once with `--site 95,230` replayed and
   once with a fresh site selection.
3. **The report:** mark the round-3 single-run numbers superseded. Add a yearly clean-against-base table: population
   ratio, approval gain, air ratio, I-HT and dirty share, each a median with its band. Keep the year-60 approval row as
   FAIL (open), and keep the GUIDE requests open. I write the POLISH_PLAN amendments after the final run.

**Runs to repeat on the final dev:**
- T062 first: dev's 9-member `--skip dirty` 256×60 s7 ensemble.
- 9-member base ensembles on all three rows, with the collector.
- `--skip dirty` 128×15 s7 at 5 members, with stage two near 0.80× or 15 %; `--skip dirty` 256×60 s7 and s11 at 9.
- industryProbe gate (b), tsc and the full vitest, including tests/sim/botCleanIndustry.test.ts and
  tests/sim/balance.test.ts: G-UNEMP with the fresh workerAccess aggregation, LD15a, and lines 146-147, "no dirty
  industry: unemployment" > 0.04 and "population" < 0.9× base. Retooling pushes against those two: the 128 clean median
  is 0.872×, its largest member 0.886×. If a balance.test line fails because LG-07 works as specified, send me the
  numbers; do not edit the test in the lane.

## 4. T045 (LG-08): hold; diagnose, then rerun

**What failed and why.** The bot connects no passenger station in any no-flag run, so the tower lots and the +0.04
appeal are inert there. The only live change is the commute term (from 8 minutes, at −0.25). By design it lowers
approval in every city, and it moves the bot's approval-gated decisions (the Statue at 65 %, ordinances at 55 % and
60 %). The results:
- **Early population rises on all three rows,** +0.4 % to +1.7 % in failing years between years 10 and 30, with the
  median above dev's maximum. That fails NOTE-053's band clause under any tolerance. On 128×15 all 9 lane members beat
  dev's median in 2012-2015, and its air is 2.4-4.6 % cleaner in 2010-2014. Nobody has explained yet why a penalty
  raises early population and early approval.
- **s11 population in 2050-2060: a real regression,** −1.9 % to −6.4 %. Year 60 is 1,394,211 against 1,483,518
  (−6.02 %), 74,472 below a 0.99× floor. In 2050 and 2060 the lane median is below every dev member. In the same city,
  approval fails 44 of 51 years, 0.8 to 3.65 points below dev and more than the term itself (2052: −2.35 against a −1.12
  term); air is up to 17 % dirtier in 15 years between 2012 and 2032; I-HT is higher in 2047-2060. It is one s11 path
  shift.
- **s7 approval in 2060:** −1.63 points, about the size of the term at a 12-minute commute. That is the item doing what
  it says.
- **Passing:** transit loss 1.43 % in 2040 (margin 0.43 points, inside half a band) and 15.48 % in 2060; the subway
  floor at +0.38 % against dev `--subway`.

**Analyst against review:** I went with the review: the population failures come from NOTE-053's band clause, not from
tolerance 0, and NOTE-048 decision 1 says "within 1 % of fresh dev", which is two-sided. So population is not made
one-sided, and favourable air and I-HT misses are not exempted. I kept 9 members rather than the 15 the review suggested
for the 60-year rows: no lane gets extra members (section 1), and the per-member columns show a split ensemble instead.

**Gate amendments:**
- **Approval net of LG-08's own term:** judge approval minus each member's commute term (with the same smoothing as the
  recorded approval) under NOTE-053, tolerance 0. Report the term's median and band per year as LG-08's by-design
  effect. s11's excess beyond the term stays gated.
- **Population:** NOTE-053 as written, tolerance 1 %, two-sided. The ≥ 0.99× floor applies to all three no-flag rows
  (128×15 at year 15), as well as to subway against dev subway.
- **Air and I-HT:** NOTE-053 as written. Only section 1's zero-width rule applies.
- **The early-year moves** (population up, 128×15 air cleaner) fail as written. They can be signed under D2 as a
  by-design base move only if FX4 names their mechanism, they stay within +3 % (NOTE-050's bound for T041), and they
  repeat on the final dev.
- **Commute term from 2030:** the median over all 9 `--subway --skip transit` members, monthly from January 2030, must
  be negative. Report the weakest member. The every-member rule is stricter than NOTE-053, so it is not used.
- **The stage-6+ share** stays a single run (4.67× against 2×, a large effect), from the `--subway` control's final
  census. **ms/day** is one same-strategy timing pair in a quiet slot (NOTE-055).
- **Blocking rule, set now:** if on the final dev the s11 no-flag median is still below dev's band in 2050-2060, or
  below 0.99× dev at year 60, LG-08 does not merge. The 8-minute / −0.25 setting then comes back to me with a trade-off
  table: start and coefficient against the s11 and s7 year-60 base, the 2030 activation, and the 2040 and 2060 transit
  loss. NOTE-048 approved that setting on the premise that the base stays within 1 %. No compensation, and no
  POLISH_BACKLOG entry "outside LG-08" for a stall mode that LG-08 pushes members into.

**Fix items:**
- **FX1 (T062, observation only):** the per-year commute term and resCommute in the annual rows and the member JSON,
  plus a dated log of approval-gated bot actions (rewards bought, ordinances enacted). The bot stays bit-identical.
- **FX2 (T062):** the derived metric approvalNetCommute, and section 1's per-member columns.
- **FX3 (T045, measure only):** how much resident weight the 25-minute fallback at approval.ts:146 charges to routed
  homes that missed the last traffic assignment, and its effect on the 2030 term and the 2040 loss. Any change to it is
  a calibration change, so it comes to me.
- **FX4 (T045, diagnosis, no balance change):** for the s11 stall and for the three-row early rise, name the first
  differing bot decision. Use the lane and dev controls, and two stalled against two growing lane members, with FX1's
  log. Say what the stalled members lack: transit, jobs, congestion or funds.
- **FX5 (T045 report):** restate every verdict under NOTE-053 as written, with the amendments and D2 items listed apart.
  The subway rows can also fork through stopAttached's scheduler estimate (your B2 request); say whether B2 has
  separated it.

**Runs to repeat on the final dev:**
- 9-member dev and lane no-flag rows: 128×15 s7, 256×60 s7 and 256×60 s11;
- 9-member lane `--subway`, lane `--subway --skip transit` and dev `--subway` on 256×60 s7;
- the monthly commute probe on every skip-transit member;
- the stage-6+ census on the lane's `--subway` control, with dev's for comparison;
- one quiet-slot ms/day pair, and the 128×15 reference movement;
- FX4 again on that dev, if s11 still misses.

## 5. What happens next

- **The final gates still run on the dev that includes B2 and T041,** with every SIM lane merged ahead of it (NOTE-057).
  Nothing in this NOTE gates a merge before then. T043's fix round does not hold T044 or T045.
- **Now, in Codex lanes:**
  - T062's runner: FX1, FX2, T044's collector, the disjoint-band and zero-width rules, the per-member columns. The bot
    stays at 192,899 ([61124, 93804, 37971]) with unchanged digests.
  - T043: the diagnosis, then the scar trace and the rest of its fix items in order.
  - T045: FX3, and FX4 once FX1 is in.
  - The three report updates.
  - Diagnostic runs go 3 or 4 at a time, never during a timing slot.
- **After B2 and T041 merge, in a quiet slot for the bot** (no Codex gates alongside, 3 or 4 members at a time,
  NOTE-055):
  - T062 first: the second A/A envelope; dev's 9-member ensembles on the three rows; dev `--neglect` on s7 and s11; dev
    `--skip dirty` and dev `--subway` on s7.
  - Then T044, T045 and T043, each after merging that dev. T043's early-window check runs before its 60-year rows.
  - T045's ms/day pair gets its own timing slot, with nothing else running.
- **I send the final verdicts** from those tables.

**For the user: nothing now.** Up to three game-design questions may follow, each only if the runs show it:
1. **LG-06, if T043's diagnosis points there:** should a fire the player could not have answered (no station in reach
   yet, or never prompted) still cost a rebuild charge, leave a scar and count against the safety record? The plan says
   players are never charged for prompts they never saw. It does not say whether "could not reach" counts.
2. **LG-08, if the s11 stall survives on the final dev:** a weaker commute penalty, so transit pays off less; or keep
   it, and accept that some large car-only cities end about 6 % smaller (1.39M against 1.48M at year 60) with only the
   approval line to say why.
3. **LG-07, if it comes up:** a clean-only city ending well ahead of a smokestack city (more than about 7 % at year 60);
   or, if dev's own clean city also loses its +1 approval by year 60, what going clean should still give late in the
   game.
