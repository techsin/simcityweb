# T044 / LG-07 — NOTE-062 report update

**Mechanics accepted for now; no fix round.** This update implements NOTE-062 §3 fix item 3 only: report amendments and reduction of existing campaign records. No source, tool, test, tuning, baseline or POLISH_PLAN change, and no new simulation run. The round-3 single-run numbers are **SUPERSEDED** as acceptance evidence, including the 28.29% demand-share claim and +1.188 year-60 approval gain. Historical sections below retain their original measurements and then-current verdicts for audit only.

**The year-60 approval gate is FAIL (OPEN). The two GUIDE requests are OPEN.** NOTE-062 accepts mechanics provisionally, not a merge: final gates repeat after merging dev with B2, T041 and the SIM lanes ahead of T044 (NOTE-057). These campaign results are against the pre-B2/pre-T041 dev each lane was built on, `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef`.

## Measured tree and evidence

Measured tree: pushed `local/T044-measured` at `a1a4e79e709e12a368af0645c3ac9dd50e9ac7f1` (`a1a4e79`), verified against `refs/remotes/origin/local/T044-measured`. Its parent is `57ed98340cf91aeeb3dcebe13ca46a3708d54c59`, the round-4 labour correction. The measurement commit adds T062’s A/A funds-nudge flag for the ensemble. This report update is on `local/T044-lg07-industry` after `e4d38e3`; it does not claim that this later docs/runner tree was the measured commit.

Campaign root `C` = `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes`. Sources: `C/T044.md`, `C/SUMMARY.md`, `C/T044.manifest.json`, `C/T044.audit.json`, and the complete raw member JSON referenced by each ensemble summary. All new tables below are reductions of those files. No absent collector field is inferred from aggregate demand or treated as zero.

| Table / group | Summary relative to C | Members |
| --- | --- | ---: |
| 128 clean/base yearly comparison | `stages/5/T044/{dirty,base}/128x15_s7_ensemble.summary.json` | 5 clean + 5 base |
| 256 s7 clean/base yearly comparison | `data/T044/{dirty,base}/256x60_s7_ensemble.summary.json` | 9 clean + 9 base |
| Base checks, all three rows | `data/{T044,dev}/base/{128x15_s7,256x60_s7,256x60_s11}_ensemble.summary.json` | 9 per group/row |

The 128 clean target is determined by its five-member stage; its table uses the matching five-member base snapshot, not the later nine-member base. Each summary records member IDs, JSON paths, nudge/day, exact bot commands, commit, source/dependency/observer fingerprints and completion. The measured T044 source fingerprint is `simBlob=4e8cb6cf1ef29e3c695f4c3d659b234358f14dd9`, `srcTree=9072ecc544849893dca0bd08227bc5d534eca71e`. The complete command ledger remains `C/commands.json`.

## Current campaign verdict under NOTE-062

Gate contrasts below are ratios of separately reduced ensemble medians, or the difference of medians for approval. The run-mean air row first averages all 15 annual home-air observations for each member, then reduces the member means; it is not the year-15 endpoint.

| Check | Determining members | Measurement / margin | Current status |
| --- | ---: | --- | --- |
| Base population, approval and air, years 10–end | 9 per lane/dev row | Population and air pass all three rows; four s11 upward approval excursions become intended effects below | PASS under the T044-only amendment; G-AB still OPEN |
| EQ | 9 | 128 s7: 103.582245 in 2015; 256 s7: 121.273510 in 2030; s11: 121.542963 in 2030 | PASS on this measured tree |
| Systematic shift / disjoint bands | 9 | No three-row endpoint systematic flag; no ≥3-year disjoint base-band streak on any row | PASS on available metrics |
| 128 s7 clean population ≥0.80× base | 5 | 167,218 / 191,771 = 0.871967×; margin +13,801.2 people / +0.071967× | PASS |
| 128 s7 clean run-mean home air ≥15% cleaner | 5 | 0.045198588 / 0.057274630 = 0.789155×: 21.084452% cleaner; margin 6.084452 percentage points / 0.003484848 pollution units | PASS |
| 256 s7 clean population ≥0.97× base, one-sided | 9 | 1,534,036 / 1,475,130 = 1.039933×; margin +103,159.9 people / +0.069933× | PASS |
| Upper clean population / “clean industry dominates” | 9 | +58,906 people / +3.993275%; dev year-60 band 1,341,715–1,542,590, half-width 100,437.5; 41,531.5 below flag boundary | REPORT ONLY; flag NOT triggered |
| 256 s7 clean year-60 approval gain ≥+1 | 9 | 80.112583 − 80.084679 = +0.027904; margin −0.972096 points | **FAIL (OPEN)** |
| Required 256 s11 clean row | 9 required | No clean s11 ensemble in this campaign | PENDING |
| High-tech gate (a) | 9 required | EQ median first reaches 110 in 2023; positive/raw/capped I-HT component demand is absent in old member JSON | PENDING T062 collector; no gate result |
| High-tech gate (b) | Final tree, twice | Existing round-3 probe is superseded as final acceptance evidence | PENDING final replay and fresh selection |
| G-AB abandoned ≤3% | 9 per base row required | Abandoned counts absent from these old annual records | OPEN on all three base rows |
| G-UNEMP | Final fresh aggregation | Stored access in this campaign is not balance.test’s fresh workerAccess aggregation | OPEN |

The four s11 approval excursions are 2035, 2056, 2058 and 2059, respectively 0.052496, 0.144833, 0.106856 and 0.082796 points above dev’s maximum. NOTE-062 classifies them as **INTENDED EFFECT**, not failures. This exemption applies only to approval up / air cleaner, with the specified half-dev-band bound; it does not excuse population drift or an adverse move.

Approval is not rescued by a different averaging window or a matched-member median. The strict gain is at most +0.54 in every year 2054–2060, mean about +0.15; the mean gain from 2030 is +0.995 at nine members. Those diagnostics do not meet the strict year-60 +1 gate. Late clean-city air converges toward base as the larger clean city and retooled I-M emit pollution; NOTE-062 calls that explanation plausible, not established attribution. Whether it is a lane regression waits for dev’s own clean ensemble and the two decision branches below.

## Gate amendments — exact NOTE-062 §3 wording

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

NOTE-053’s ordinary base rule checks each year from year 10: the lane median is within dev’s min–max band and its distance from dev’s median is at most max(item tolerance, half dev’s full min–max width). Item tolerance is 1% of dev median for population, zero for approval and air. The quoted T044-only intended-direction exemption is then applied. The three-row systematic-shift check remains, supplemented by NOTE-062’s disjoint-band rule; realised base I-HT is report-only.

## Shared final-run protocol — exact NOTE-062 §1 wording

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

The quoted provenance paragraph records the status when the NOTE was issued. T044’s push requirement is now satisfied by `origin/local/T044-measured` at `a1a4e79`, as verified above. No push was performed in this report-only round.

## Yearly clean-against-base comparisons

For each population, approval and air cell, **G** is the gate contrast (ratio of ensemble medians, or difference of medians); **P** is the median [minimum, maximum] of matched-member contrasts using identical control/nudge/day IDs. P bands are paired diagnostics, not confidence intervals or gate envelopes. In particular, 2060 paired approval is +0.904966 but the gated difference of medians is only +0.027904: the gate remains FAIL (OPEN).

Job-share cells give **clean median [min,max]; base median [min,max]**, in percent of filled jobs. Realised I-HT = I-HT/(I-D+I-M+I-HT), excluding farms; dirty = I-D/(IA+I-D+I-M+I-HT), including farms, reconstructed from annual `jobsByDev[9] / sum(jobsByDev[8..11])` to match the strategy accessor’s denominator. These are annual census observations, not demand or retooled target additions. A zero denominator is represented as zero, matching the existing observation convention.

**Collector gaps:** I-HT demand share (positive demandAbs / raw / capped), direct `dirtyJobShare`, `retooledIM` and `retooledIHT` are **PENDING T062’s new collector** for all old annual rows. The I-HT demand column is therefore explicitly pending. The reconstructed dirty census column is available; its direct collector reading remains pending. The old aggregate `botRow.dI` cannot supply the missing components.

### 128×15 s7 — five clean and five base members

| Year | Population clean/base: G; P [band] | Approval gain: G; P [band], points | Home air clean/base: G; P [band] | Realised I-HT jobs: clean; base (%) | Dirty jobs (reconstructed): clean; base (%) | I-HT demand + / raw / capped |
| --- | --- | --- | --- | --- | --- | --- |
| 2001 | 0.96515; 0.96515 [0.96515, 0.96515] | +1.715; +1.715 [+1.715, +1.715] | 1.22678; 1.22678 [1.22678, 1.22678] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 60.61 [60.61, 60.61] | PENDING / PENDING / PENDING |
| 2002 | 0.99010; 0.99010 [0.99010, 0.99010] | +3.863; +3.863 [+3.863, +3.863] | 0.90808; 0.90808 [0.90808, 0.90808] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 65.64 [65.64, 65.64] | PENDING / PENDING / PENDING |
| 2003 | 0.99289; 0.99289 [0.98760, 0.99289] | +0.910; +0.910 [+0.910, +0.978] | 0.74653; 0.74653 [0.74274, 0.74653] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 62.28 [62.28, 62.28] | PENDING / PENDING / PENDING |
| 2004 | 0.86186; 0.86186 [0.85120, 0.86186] | +3.066; +3.066 [+3.066, +3.165] | 0.62767; 0.62767 [0.62345, 0.62769] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 65.44 [65.44, 68.49] | PENDING / PENDING / PENDING |
| 2005 | 0.74047; 0.73940 [0.73694, 0.75780] | +6.520; +6.517 [+6.183, +7.137] | 0.74706; 0.74818 [0.72967, 0.77903] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 65.08 [65.08, 67.17] | PENDING / PENDING / PENDING |
| 2006 | 0.72732; 0.72346 [0.70433, 0.75035] | +6.351; +6.203 [+4.930, +6.648] | 0.89573; 0.89573 [0.84348, 0.93125] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 63.57 [62.60, 67.45] | PENDING / PENDING / PENDING |
| 2007 | 0.76259; 0.76999 [0.75345, 0.78573] | +5.349; +5.298 [+4.031, +5.455] | 1.06540; 1.05059 [1.01925, 1.09999] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 65.03 [64.13, 65.71] | PENDING / PENDING / PENDING |
| 2008 | 0.78021; 0.78255 [0.77357, 0.79883] | +1.555; +1.760 [+0.528, +2.201] | 1.10369; 1.10438 [1.04546, 1.16943] | 0.36 [0.00, 2.75]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 59.88 [59.72, 63.56] | PENDING / PENDING / PENDING |
| 2009 | 0.79783; 0.80000 [0.78981, 0.81493] | +0.554; +0.205 [−0.305, +3.773] | 0.66843; 0.69675 [0.66028, 0.71729] | 9.90 [8.85, 13.43]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 57.65 [56.31, 57.92] | PENDING / PENDING / PENDING |
| 2010 | 0.81444; 0.81781 [0.80811, 0.82885] | +3.136; +3.243 [+1.169, +3.908] | 0.67223; 0.69969 [0.66196, 0.71622] | 13.30 [12.07, 15.89]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 57.00 [53.22, 60.72] | PENDING / PENDING / PENDING |
| 2011 | 0.83059; 0.83001 [0.82549, 0.84104] | +2.061; +2.047 [+0.262, +2.746] | 0.71006; 0.71966 [0.68672, 0.72674] | 17.27 [15.57, 18.68]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 52.70 [49.43, 60.35] | PENDING / PENDING / PENDING |
| 2012 | 0.84031; 0.84266 [0.83477, 0.85245] | +1.457; +1.411 [+0.145, +1.686] | 0.76534; 0.78557 [0.76411, 0.82891] | 19.75 [17.54, 21.13]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 51.77 [49.74, 55.43] | PENDING / PENDING / PENDING |
| 2013 | 0.85060; 0.85416 [0.84656, 0.86245] | +1.344; +1.194 [+0.334, +1.366] | 0.76551; 0.77004 [0.76131, 0.78033] | 18.09 [17.41, 19.78]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 51.69 [49.62, 55.70] | PENDING / PENDING / PENDING |
| 2014 | 0.86242; 0.86236 [0.85594, 0.87521] | +2.248; +1.385 [−0.848, +4.224] | 0.75753; 0.75941 [0.73414, 0.76241] | 17.29 [16.57, 17.43]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 51.68 [49.62, 55.68] | PENDING / PENDING / PENDING |
| 2015 | 0.87197; 0.87121 [0.86769, 0.88558] | +1.033; +1.033 [−0.560, +2.625] | 0.73823; 0.73754 [0.72728, 0.76144] | 16.23 [15.04, 17.22]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 51.57 [49.62, 55.62] | PENDING / PENDING / PENDING |

### 256×60 s7 — nine clean and nine base members

| Year | Population clean/base: G; P [band] | Approval gain: G; P [band], points | Home air clean/base: G; P [band] | Realised I-HT jobs: clean; base (%) | Dirty jobs (reconstructed): clean; base (%) | I-HT demand + / raw / capped |
| --- | --- | --- | --- | --- | --- | --- |
| 2001 | 0.96461; 0.96461 [0.96461, 0.96461] | −0.108; −0.108 [−0.108, −0.108] | 0.97209; 0.97209 [0.97209, 0.97209] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 56.19 [56.19, 56.19] | PENDING / PENDING / PENDING |
| 2002 | 0.92727; 0.92727 [0.92717, 0.94141] | −3.240; −3.240 [−3.240, −2.644] | 0.88462; 0.88462 [0.87796, 0.88462] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 65.55 [65.55, 66.40] | PENDING / PENDING / PENDING |
| 2003 | 0.93471; 0.93471 [0.87259, 0.94185] | +2.247; +2.247 [+2.206, +2.313] | 0.73890; 0.73890 [0.73890, 0.87507] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 69.29 [66.85, 72.80] | PENDING / PENDING / PENDING |
| 2004 | 0.75633; 0.75633 [0.75633, 0.76483] | +0.121; +0.121 [−0.472, +2.920] | 0.71242; 0.71242 [0.71242, 0.78530] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 63.94 [63.94, 67.52] | PENDING / PENDING / PENDING |
| 2005 | 0.66221; 0.66221 [0.64167, 0.66881] | +4.608; +4.783 [+3.506, +5.405] | 0.72757; 0.72757 [0.67514, 0.78795] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 65.80 [65.36, 68.84] | PENDING / PENDING / PENDING |
| 2006 | 0.63632; 0.63632 [0.61740, 0.67214] | +2.525; +2.656 [+0.119, +3.750] | 0.79789; 0.79789 [0.75266, 0.86288] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 63.31 [62.27, 64.19] | PENDING / PENDING / PENDING |
| 2007 | 0.66133; 0.66467 [0.63835, 0.68803] | +1.168; +1.758 [−1.188, +2.787] | 0.92881; 0.91244 [0.81175, 1.00839] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 61.15 [60.05, 61.95] | PENDING / PENDING / PENDING |
| 2008 | 0.69636; 0.69636 [0.67470, 0.72719] | −1.032; −0.888 [−4.426, +1.295] | 0.87511; 0.87511 [0.73235, 0.98940] | 0.00 [0.00, 0.00]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 56.02 [54.40, 57.50] | PENDING / PENDING / PENDING |
| 2009 | 0.72460; 0.72430 [0.71691, 0.76767] | −1.488; −1.698 [−4.081, +5.145] | 0.61021; 0.61808 [0.58504, 0.66696] | 13.05 [8.80, 17.28]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 52.05 [51.36, 52.96] | PENDING / PENDING / PENDING |
| 2010 | 0.75387; 0.75305 [0.74655, 0.78686] | +3.265; +3.603 [+1.017, +9.658] | 0.71520; 0.70733 [0.60007, 0.74968] | 14.10 [10.05, 21.91]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 50.69 [49.85, 53.15] | PENDING / PENDING / PENDING |
| 2011 | 0.77645; 0.77645 [0.76600, 0.81171] | +4.982; +5.213 [+1.185, +9.206] | 0.71209; 0.70927 [0.61466, 0.85191] | 13.85 [9.76, 26.88]; 0.00 [0.00, 1.77] | 0.00 [0.00, 0.00]; 49.44 [48.77, 51.35] | PENDING / PENDING / PENDING |
| 2012 | 0.79286; 0.79159 [0.77177, 0.81499] | +6.828; +5.786 [+2.341, +8.054] | 0.84823; 0.83591 [0.76834, 0.88641] | 13.68 [8.76, 26.87]; 0.00 [0.00, 1.59] | 0.00 [0.00, 0.00]; 48.65 [48.04, 52.71] | PENDING / PENDING / PENDING |
| 2013 | 0.80828; 0.80737 [0.78938, 0.82803] | +5.890; +4.019 [+0.903, +8.665] | 0.82869; 0.81186 [0.75627, 0.86510] | 13.15 [8.72, 25.33]; 0.00 [0.00, 1.41] | 0.00 [0.00, 0.00]; 49.66 [46.61, 52.60] | PENDING / PENDING / PENDING |
| 2014 | 0.82101; 0.82101 [0.80554, 0.83927] | +4.349; +4.726 [+1.565, +6.852] | 0.75641; 0.75834 [0.70463, 0.82216] | 13.12 [8.67, 24.55]; 0.00 [0.00, 0.79] | 0.00 [0.00, 0.00]; 49.18 [45.35, 52.57] | PENDING / PENDING / PENDING |
| 2015 | 0.83262; 0.83343 [0.81222, 0.84312] | +1.852; +1.487 [+0.685, +5.548] | 0.75928; 0.74628 [0.69669, 0.82149] | 13.02 [8.65, 22.66]; 0.00 [0.00, 0.73] | 0.00 [0.00, 0.00]; 48.34 [45.17, 52.34] | PENDING / PENDING / PENDING |
| 2016 | 0.83937; 0.83862 [0.82091, 0.85029] | +1.168; +1.102 [+0.052, +5.255] | 0.71933; 0.72375 [0.68466, 0.80233] | 13.06 [8.64, 22.52]; 0.00 [0.00, 0.70] | 0.00 [0.00, 0.00]; 48.86 [44.94, 52.31] | PENDING / PENDING / PENDING |
| 2017 | 0.84515; 0.84946 [0.83064, 0.85630] | +1.517; +1.649 [+0.985, +3.785] | 0.68247; 0.67868 [0.60156, 0.78829] | 13.09 [8.63, 22.86]; 0.00 [0.00, 0.45] | 0.00 [0.00, 0.00]; 48.57 [44.89, 52.27] | PENDING / PENDING / PENDING |
| 2018 | 0.85344; 0.85700 [0.83772, 0.86303] | +1.941; +1.595 [+1.217, +3.778] | 0.63776; 0.66619 [0.57123, 0.73416] | 13.06 [8.60, 22.80]; 0.00 [0.00, 0.44] | 0.00 [0.00, 0.00]; 47.45 [44.01, 49.73] | PENDING / PENDING / PENDING |
| 2019 | 0.86027; 0.86297 [0.84700, 0.86949] | +1.044; +1.922 [−0.004, +3.341] | 0.66290; 0.66287 [0.58220, 0.77506] | 13.04 [8.65, 22.76]; 0.00 [0.00, 0.43] | 0.00 [0.00, 0.00]; 47.09 [43.86, 49.39] | PENDING / PENDING / PENDING |
| 2020 | 0.86311; 0.86377 [0.84856, 0.87739] | +0.980; +1.505 [+0.538, +3.137] | 0.69081; 0.68177 [0.54709, 0.77626] | 13.05 [8.64, 22.79]; 0.00 [0.00, 0.41] | 0.00 [0.00, 0.00]; 47.73 [44.15, 49.56] | PENDING / PENDING / PENDING |
| 2021 | 0.86788; 0.87114 [0.86090, 0.87908] | +1.987; +2.554 [−1.467, +3.704] | 0.69612; 0.69742 [0.54695, 0.75068] | 13.05 [8.68, 22.82]; 0.00 [0.00, 0.21] | 0.00 [0.00, 0.00]; 47.64 [43.69, 49.52] | PENDING / PENDING / PENDING |
| 2022 | 0.87394; 0.87578 [0.86817, 0.88377] | +1.514; +1.388 [−1.854, +4.810] | 0.72801; 0.73132 [0.59219, 0.78926] | 13.07 [8.69, 22.85]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 47.63 [44.47, 49.50] | PENDING / PENDING / PENDING |
| 2023 | 0.87611; 0.88062 [0.87069, 0.88629] | +1.797; +1.671 [−1.129, +3.884] | 0.75355; 0.73708 [0.65678, 0.78152] | 13.04 [8.70, 22.85]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 47.63 [44.43, 49.48] | PENDING / PENDING / PENDING |
| 2024 | 0.88209; 0.88568 [0.87729, 0.89195] | +0.811; +0.912 [−1.945, +4.057] | 0.76942; 0.75034 [0.64915, 0.78141] | 13.01 [8.68, 22.81]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 47.61 [44.60, 49.46] | PENDING / PENDING / PENDING |
| 2025 | 0.88725; 0.88998 [0.88159, 0.89698] | +0.810; +0.541 [−1.783, +3.758] | 0.77086; 0.75906 [0.62191, 0.82157] | 13.08 [8.68, 22.81]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 47.63 [44.42, 49.57] | PENDING / PENDING / PENDING |
| 2026 | 0.88905; 0.89290 [0.88392, 0.89711] | +0.669; +0.669 [−0.988, +3.333] | 0.79060; 0.77126 [0.60688, 0.87376] | 13.04 [8.69, 23.05]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 46.60 [41.06, 49.43] | PENDING / PENDING / PENDING |
| 2027 | 0.89291; 0.89474 [0.88628, 0.90238] | +0.528; +0.528 [−2.060, +3.153] | 0.78518; 0.74922 [0.63268, 0.83165] | 13.00 [8.70, 21.04]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 44.61 [36.75, 49.16] | PENDING / PENDING / PENDING |
| 2028 | 0.89678; 0.89844 [0.88721, 0.90535] | +0.309; +0.639 [−0.369, +3.517] | 0.79873; 0.75406 [0.62568, 0.83293] | 12.60 [8.21, 21.04]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 39.82 [35.88, 49.20] | PENDING / PENDING / PENDING |
| 2029 | 0.90144; 0.90285 [0.89045, 0.90953] | +1.120; +1.353 [−0.674, +6.260] | 0.79191; 0.75292 [0.62733, 0.82626] | 12.61 [8.20, 19.80]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 38.41 [34.73, 49.14] | PENDING / PENDING / PENDING |
| 2030 | 0.90467; 0.90622 [0.89594, 0.91385] | +1.661; +1.361 [+0.158, +5.623] | 0.83027; 0.78477 [0.66168, 0.89914] | 11.81 [8.03, 17.75]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 35.85 [31.49, 48.02] | PENDING / PENDING / PENDING |
| 2031 | 0.91068; 0.91202 [0.89792, 0.91811] | +1.372; +1.407 [−0.404, +7.629] | 0.79515; 0.76369 [0.63614, 0.92396] | 11.63 [8.06, 16.68]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 34.98 [31.61, 43.14] | PENDING / PENDING / PENDING |
| 2032 | 0.91343; 0.91470 [0.90369, 0.91987] | +1.009; +1.027 [−0.729, +6.942] | 0.81395; 0.78028 [0.65537, 0.87051] | 11.46 [8.06, 16.62]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 34.24 [30.89, 42.43] | PENDING / PENDING / PENDING |
| 2033 | 0.91627; 0.91909 [0.90611, 0.92163] | +0.601; +0.771 [−1.193, +4.487] | 0.80189; 0.78503 [0.66740, 0.90982] | 11.47 [7.88, 15.62]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 32.25 [29.36, 42.56] | PENDING / PENDING / PENDING |
| 2034 | 0.92177; 0.92185 [0.91069, 0.92607] | +1.609; +1.484 [−0.184, +5.139] | 0.80880; 0.79472 [0.68173, 0.88443] | 11.48 [5.77, 15.17]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 33.80 [29.72, 42.82] | PENDING / PENDING / PENDING |
| 2035 | 0.92383; 0.92259 [0.91127, 0.92937] | +1.042; +1.099 [−0.509, +5.164] | 0.82268; 0.82268 [0.68364, 0.91751] | 10.44 [5.34, 15.56]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 35.95 [31.34, 42.80] | PENDING / PENDING / PENDING |
| 2036 | 0.92705; 0.92644 [0.91385, 0.93290] | +1.205; +1.277 [−0.032, +5.155] | 0.82509; 0.81012 [0.68322, 0.88946] | 11.01 [4.29, 15.62]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 36.04 [29.91, 42.55] | PENDING / PENDING / PENDING |
| 2037 | 0.92787; 0.92787 [0.91585, 0.93673] | +1.062; +0.578 [+0.345, +4.795] | 0.77494; 0.77761 [0.72909, 0.90860] | 16.85 [2.42, 19.03]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 36.64 [33.68, 43.02] | PENDING / PENDING / PENDING |
| 2038 | 0.92965; 0.92965 [0.91843, 0.94093] | +1.737; +1.160 [+0.069, +5.737] | 0.81123; 0.80407 [0.69212, 0.94170] | 15.21 [3.04, 20.62]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 37.24 [33.58, 44.36] | PENDING / PENDING / PENDING |
| 2039 | 0.92984; 0.93066 [0.92069, 0.94233] | +1.356; +1.356 [−0.446, +5.120] | 0.84609; 0.85262 [0.73594, 1.01421] | 14.08 [2.54, 21.16]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 37.67 [33.59, 45.02] | PENDING / PENDING / PENDING |
| 2040 | 0.93289; 0.93289 [0.92390, 0.94588] | +1.451; +1.400 [−0.709, +5.509] | 0.85161; 0.88615 [0.77083, 0.95184] | 15.30 [2.21, 25.21]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 37.97 [33.61, 44.99] | PENDING / PENDING / PENDING |
| 2041 | 0.93510; 0.93622 [0.92268, 0.94861] | +1.498; +0.563 [−0.126, +6.638] | 0.85671; 0.87439 [0.82198, 0.96117] | 19.11 [1.96, 26.23]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 38.14 [34.41, 45.00] | PENDING / PENDING / PENDING |
| 2042 | 0.93995; 0.93890 [0.92317, 0.95097] | +2.018; +2.136 [+0.288, +6.044] | 0.87664; 0.86945 [0.81647, 0.97044] | 23.40 [4.22, 29.59]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 37.95 [34.77, 45.16] | PENDING / PENDING / PENDING |
| 2043 | 0.94060; 0.94087 [0.92250, 0.95352] | +1.499; +1.631 [+0.447, +5.337] | 0.87941; 0.90153 [0.82450, 0.97114] | 26.77 [4.47, 32.19]; 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00]; 37.73 [35.62, 44.97] | PENDING / PENDING / PENDING |
| 2044 | 0.94235; 0.94235 [0.92741, 0.95487] | +0.783; +1.641 [+0.048, +5.526] | 0.90701; 0.91169 [0.84737, 0.97179] | 30.34 [8.02, 34.32]; 0.00 [0.00, 0.06] | 0.00 [0.00, 0.00]; 38.70 [35.77, 44.72] | PENDING / PENDING / PENDING |
| 2045 | 0.94419; 0.94507 [0.93467, 0.95585] | +0.779; +1.475 [−0.182, +5.558] | 0.90517; 0.89163 [0.80614, 1.00030] | 33.09 [14.21, 35.57]; 0.00 [0.00, 0.19] | 0.00 [0.00, 0.00]; 38.03 [35.90, 44.03] | PENDING / PENDING / PENDING |
| 2046 | 0.94794; 0.94514 [0.93523, 0.96103] | +1.283; +1.338 [+0.984, +5.200] | 0.93234; 0.91811 [0.80771, 1.06332] | 33.18 [18.43, 36.99]; 0.00 [0.00, 0.94] | 0.00 [0.00, 0.00]; 37.90 [37.10, 42.89] | PENDING / PENDING / PENDING |
| 2047 | 0.94882; 0.94874 [0.93837, 0.96578] | +1.448; +1.900 [−0.195, +5.287] | 0.92730; 0.92730 [0.82308, 1.03103] | 33.85 [21.92, 36.66]; 0.00 [0.00, 1.81] | 0.00 [0.00, 0.00]; 38.16 [37.05, 41.59] | PENDING / PENDING / PENDING |
| 2048 | 0.94687; 0.94796 [0.94021, 0.96832] | +0.791; +0.786 [−0.197, +4.949] | 0.92239; 0.90476 [0.84614, 1.01439] | 31.27 [24.29, 36.71]; 0.00 [0.00, 3.11] | 0.00 [0.00, 0.00]; 38.16 [36.65, 40.33] | PENDING / PENDING / PENDING |
| 2049 | 0.95060; 0.95060 [0.93823, 0.98251] | +0.352; +1.340 [+0.059, +4.924] | 0.94438; 0.93508 [0.85384, 0.99512] | 29.02 [23.27, 38.53]; 0.00 [0.00, 4.22] | 0.00 [0.00, 0.00]; 38.16 [36.75, 39.54] | PENDING / PENDING / PENDING |
| 2050 | 0.95006; 0.94925 [0.93841, 1.00073] | +1.261; +1.455 [−0.148, +4.650] | 0.95598; 0.96477 [0.84741, 0.99536] | 27.43 [21.37, 38.06]; 0.77 [0.00, 5.48] | 0.00 [0.00, 0.00]; 37.79 [36.09, 39.09] | PENDING / PENDING / PENDING |
| 2051 | 0.95127; 0.95371 [0.93775, 1.02664] | +1.154; +1.268 [−0.939, +4.111] | 0.98199; 0.94718 [0.88977, 1.01846] | 25.54 [18.80, 35.91]; 2.06 [0.00, 6.47] | 0.00 [0.00, 0.00]; 37.06 [35.18, 38.48] | PENDING / PENDING / PENDING |
| 2052 | 0.95849; 0.95849 [0.94467, 1.05440] | +1.700; +1.439 [−0.065, +4.673] | 0.96185; 0.96185 [0.89274, 1.01504] | 24.27 [17.05, 34.59]; 3.12 [0.10, 7.53] | 0.00 [0.00, 0.00]; 36.12 [34.15, 37.49] | PENDING / PENDING / PENDING |
| 2053 | 0.97857; 0.97802 [0.94947, 1.08051] | +1.106; +0.601 [−0.135, +4.291] | 0.97921; 0.94650 [0.91556, 1.04733] | 23.17 [15.37, 33.01]; 3.60 [0.43, 8.33] | 0.00 [0.00, 0.00]; 35.45 [33.01, 36.54] | PENDING / PENDING / PENDING |
| 2054 | 1.00152; 1.00238 [0.95166, 1.10637] | +0.209; +0.403 [−1.680, +4.473] | 0.99875; 0.97888 [0.92347, 1.04038] | 22.52 [13.46, 31.83]; 3.88 [0.88, 8.91] | 0.00 [0.00, 0.00]; 34.71 [32.26, 35.76] | PENDING / PENDING / PENDING |
| 2055 | 1.01609; 1.01817 [0.97106, 1.12133] | +0.022; +0.395 [−1.091, +4.498] | 0.95436; 0.93790 [0.87933, 1.04622] | 22.66 [11.70, 31.10]; 4.67 [1.36, 9.73] | 0.00 [0.00, 0.00]; 34.00 [31.32, 35.07] | PENDING / PENDING / PENDING |
| 2056 | 1.03366; 1.03484 [0.98402, 1.12303] | +0.191; +0.393 [−0.352, +3.807] | 0.99772; 1.00812 [0.92055, 1.07823] | 24.43 [10.89, 31.01]; 5.76 [2.84, 10.42] | 0.00 [0.00, 0.00]; 32.55 [30.30, 34.68] | PENDING / PENDING / PENDING |
| 2057 | 1.04698; 1.03488 [1.00500, 1.12038] | +0.005; +0.672 [−1.565, +4.470] | 0.99113; 0.96320 [0.90609, 1.06773] | 25.52 [10.67, 32.54]; 6.79 [3.22, 10.09] | 0.00 [0.00, 0.00]; 31.72 [29.37, 33.97] | PENDING / PENDING / PENDING |
| 2058 | 1.03745; 1.03925 [1.00988, 1.12185] | +0.065; +0.933 [−1.566, +4.411] | 0.97440; 0.96973 [0.93752, 1.01851] | 26.37 [11.30, 34.02]; 7.58 [4.58, 10.19] | 0.00 [0.00, 0.00]; 31.10 [29.05, 33.44] | PENDING / PENDING / PENDING |
| 2059 | 1.04284; 1.03715 [1.01399, 1.12461] | +0.544; +0.778 [−1.444, +4.059] | 0.96035; 0.95510 [0.90281, 1.04064] | 25.54 [11.73, 34.89]; 7.77 [5.21, 11.14] | 0.00 [0.00, 0.00]; 30.71 [28.33, 32.79] | PENDING / PENDING / PENDING |
| 2060 | 1.03993; 1.03208 [1.00855, 1.11531] | +0.028; +0.905 [−2.428, +4.220] | 1.00578; 0.98410 [0.90059, 1.02878] | 24.88 [12.37, 35.02]; 7.55 [5.91, 12.79] | 0.00 [0.00, 0.00]; 30.11 [27.30, 32.25] | PENDING / PENDING / PENDING |

### 256×60 s11 — required clean row pending

The campaign contains the nine-member base s11 row, but no clean s11 member set. All yearly clean/base ratios, approval gains, air ratios and clean job/demand shares for s11 remain **PENDING**; they are not inferred from s7. The required final nine-member second-seed row uses the same one-sided population and dominance-flag rules.

## Member year-60 values and stalled counts

All values below come from individual raw member annual records, not medians. Growth is population(2060) − population(2050); stalled means growth **<100,000** (strict). These endpoints are reported, not gated. The base s7 group is the same comparator for the clean s7 table; dev-clean endpoints remain pending. I-HT demand fields and direct dirty-share collector values remain pending in all five groups.

### T044 base 256×60 s7

Source: `C/data/T044/base/256x60_s7_ensemble.summary.json`. Stalled: **1/9**.

| Member | Population 2060 | Growth 2050–2060 | Stalled | Approval 2060 | Home air 2060 | I-HT jobs 2060 (%) | Dirty jobs 2060 (%; reconstructed) |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| control | 1,497,089 | 223,757 | no | 80.084679 | 0.17740746 | 6.2666 | 30.6476 |
| p100-d1 | 1,442,195 | 172,682 | no | 77.986572 | 0.16762767 | 5.9142 | 31.3328 |
| m100-d1 | 1,475,130 | 210,338 | no | 80.339595 | 0.16869256 | 12.1072 | 28.7869 |
| p100-d1441 | 1,491,101 | 225,312 | no | 79.607694 | 0.18839481 | 7.4176 | 30.5477 |
| m100-d1441 | 1,475,130 | 210,338 | no | 80.339595 | 0.16869256 | 12.1072 | 28.7869 |
| p200-d1 | 1,541,123 | 264,818 | no | 78.702291 | 0.16851983 | 7.0153 | 30.1107 |
| m200-d1 | 1,423,079 | 158,980 | no | 80.153400 | 0.16267099 | 7.5474 | 29.2772 |
| p200-d1441 | 1,486,347 | 225,047 | no | 80.867961 | 0.17082590 | 12.7882 | 27.3000 |
| m200-d1441 | 1,293,939 | 87,103 | yes | 76.973966 | 0.16245595 | 9.6285 | 32.2490 |

### T044 clean 256×60 s7

Source: `C/data/T044/dirty/256x60_s7_ensemble.summary.json`. Stalled: **0/9**.

| Member | Population 2060 | Growth 2050–2060 | Stalled | Approval 2060 | Home air 2060 | I-HT jobs 2060 (%) | Dirty jobs 2060 (%; reconstructed) |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| control | 1,564,702 | 363,076 | no | 79.970982 | 0.18214593 | 28.4761 | 0.0000 |
| p100-d1 | 1,550,653 | 353,116 | no | 78.891537 | 0.16496210 | 12.3655 | 0.0000 |
| m100-d1 | 1,487,747 | 287,148 | no | 80.112583 | 0.17106456 | 24.8819 | 0.0000 |
| p100-d1441 | 1,581,881 | 371,385 | no | 80.663597 | 0.16966738 | 35.0228 | 0.0000 |
| m100-d1441 | 1,487,747 | 287,148 | no | 80.112583 | 0.17106456 | 24.8819 | 0.0000 |
| p200-d1 | 1,569,874 | 372,177 | no | 80.164943 | 0.17336970 | 12.5265 | 0.0000 |
| m200-d1 | 1,443,140 | 235,418 | no | 81.194389 | 0.15792142 | 29.5665 | 0.0000 |
| p200-d1441 | 1,534,036 | 331,078 | no | 78.439496 | 0.16341111 | 23.1054 | 0.0000 |
| m200-d1441 | 1,443,140 | 235,418 | no | 81.194389 | 0.15792142 | 29.5665 | 0.0000 |

### Dev base 256×60 s7

Source: `C/data/dev/base/256x60_s7_ensemble.summary.json`. Stalled: **0/9**.

| Member | Population 2060 | Growth 2050–2060 | Stalled | Approval 2060 | Home air 2060 | I-HT jobs 2060 (%) | Dirty jobs 2060 (%; reconstructed) |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| control | 1,513,835 | 248,094 | no | 80.357425 | 0.17862633 | 10.2399 | 31.9481 |
| p100-d1 | 1,379,922 | 117,959 | no | 79.939502 | 0.15830317 | 13.7624 | 27.0925 |
| m100-d1 | 1,461,087 | 189,499 | no | 80.541410 | 0.16719038 | 12.6147 | 28.6274 |
| p100-d1441 | 1,504,801 | 243,852 | no | 79.739801 | 0.18320919 | 11.4822 | 31.4343 |
| m100-d1441 | 1,461,087 | 189,499 | no | 80.541410 | 0.16719038 | 12.6147 | 28.6274 |
| p200-d1 | 1,522,489 | 249,500 | no | 78.183649 | 0.16956750 | 4.8647 | 35.0544 |
| m200-d1 | 1,438,474 | 175,613 | no | 80.531927 | 0.15547329 | 7.8350 | 30.3147 |
| p200-d1441 | 1,542,590 | 271,208 | no | 80.164557 | 0.17858071 | 4.7377 | 31.7573 |
| m200-d1441 | 1,341,715 | 139,257 | no | 79.942015 | 0.16889537 | 13.5058 | 32.3443 |

### T044 base 256×60 s11

Source: `C/data/T044/base/256x60_s11_ensemble.summary.json`. Stalled: **0/9**.

| Member | Population 2060 | Growth 2050–2060 | Stalled | Approval 2060 | Home air 2060 | I-HT jobs 2060 (%) | Dirty jobs 2060 (%; reconstructed) |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| control | 1,394,907 | 123,680 | no | 81.301122 | 0.14714698 | 12.2860 | 27.9656 |
| p100-d1 | 1,492,437 | 224,950 | no | 80.279979 | 0.17537274 | 9.1800 | 26.9295 |
| m100-d1 | 1,514,767 | 254,912 | no | 79.952489 | 0.18315024 | 8.4382 | 28.9704 |
| p100-d1441 | 1,533,543 | 255,646 | no | 81.145869 | 0.15584565 | 6.3413 | 28.3007 |
| m100-d1441 | 1,497,506 | 232,052 | no | 80.996946 | 0.16660565 | 0.0000 | 37.6412 |
| p200-d1 | 1,408,811 | 135,890 | no | 80.988454 | 0.15249062 | 9.6622 | 29.6879 |
| m200-d1 | 1,530,201 | 251,725 | no | 80.495800 | 0.15582964 | 0.4653 | 35.3340 |
| p200-d1441 | 1,476,839 | 205,332 | no | 79.322044 | 0.17632138 | 0.0000 | 36.7794 |
| m200-d1441 | 1,460,806 | 197,324 | no | 80.770068 | 0.16466274 | 7.5114 | 31.7226 |

### Dev base 256×60 s11

Source: `C/data/dev/base/256x60_s11_ensemble.summary.json`. Stalled: **0/9**.

| Member | Population 2060 | Growth 2050–2060 | Stalled | Approval 2060 | Home air 2060 | I-HT jobs 2060 (%) | Dirty jobs 2060 (%; reconstructed) |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| control | 1,427,340 | 155,237 | no | 81.356695 | 0.14748506 | 10.3252 | 29.5516 |
| p100-d1 | 1,483,518 | 216,565 | no | 81.271740 | 0.16888214 | 8.8674 | 24.5744 |
| m100-d1 | 1,498,791 | 244,718 | no | 79.137167 | 0.18256159 | 8.1910 | 29.9381 |
| p100-d1441 | 1,503,201 | 240,951 | no | 80.441199 | 0.17151689 | 0.4585 | 38.0380 |
| m100-d1441 | 1,472,527 | 210,888 | no | 79.955820 | 0.17772391 | 0.0000 | 39.8873 |
| p200-d1 | 1,467,836 | 192,149 | no | 79.776494 | 0.15961019 | 8.4702 | 27.9190 |
| m200-d1 | 1,504,163 | 227,698 | no | 81.276958 | 0.15719813 | 0.4671 | 34.8691 |
| p200-d1441 | 1,511,108 | 240,837 | no | 80.231064 | 0.19051273 | 5.9883 | 31.0513 |
| m200-d1441 | 1,465,363 | 201,961 | no | 80.762989 | 0.17074979 | 10.5790 | 29.2437 |

Stalled totals: T044/dev base s7 **1/9 versus 0/9**; T044/dev base s11 **0/9 versus 0/9**; T044 clean/base s7 **0/9 versus 1/9**. The required clean s11 and dev-clean endpoint tables await final ensembles.

No base population, approval, home-air or realised I-HT min–max band is wholly disjoint from dev’s for three consecutive years from year 10 on any of the three rows. The first nonzero realised I-HT median is 2050 for T044 base s7 (dev 2051), 2052 for both T044/dev base s11, and never within 128×15 for either base. Clean s7 first becomes nonzero in 2008 at 128 and 2009 at 256. This zero-width/first-emergence diagnostic does not certify demand gate (a).

## Final-dev repeats — exact NOTE-062 §3 wording

**Runs to repeat on the final dev:**
- T062 first: dev's 9-member `--skip dirty` 256×60 s7 ensemble.
- 9-member base ensembles on all three rows, with the collector.
- `--skip dirty` 128×15 s7 at 5 members, with stage two near 0.80× or 15 %; `--skip dirty` 256×60 s7 and s11 at 9.
- industryProbe gate (b), tsc and the full vitest, including tests/sim/botCleanIndustry.test.ts and
  tests/sim/balance.test.ts: G-UNEMP with the fresh workerAccess aggregation, LD15a, and lines 146-147, "no dirty
  industry: unemployment" > 0.04 and "population" < 0.9× base. Retooling pushes against those two: the 128 clean median
  is 0.872×, its largest member 0.886×. If a balance.test line fails because LG-07 works as specified, send me the
  numbers; do not edit the test in the lane.

Gate (b) repeats `tools/industryProbe.ts` without a code change, first replaying `--site 95,230`, then using a fresh site selection, from the y43 checkpoint and advancing 24 months. Keep its ≥25% I-HT block-job criterion. T062’s new read-only collector must verify unchanged default annual rows and state hashes. No lane balance change or balance.test assertion edit is authorised by this report update.

## Open GUIDE requests, verification and browser checklist

- **OPEN — `src/ui/TopBar.ts`, `buildRciPop()`/`update()` or the split RCI equivalent:** read `industrialStrategy(ctx.state)` through the host-mirrored state and show retooled I-M/I-HT demand-target additions, with missing optional data hidden. Label targets rather than filled jobs.
- **OPEN — `src/ui/panels/StatsPanel.ts`, `build()`/`update()`:** add Industrial strategy with converted target jobs, dirty share with its farm-inclusive denominator clear, and resident-weighted home air. Bind listeners to `ctx.signal`; reads stay through `ctx.host`/`ctx.state`, mutations through `host.act`.

This round changes only `docs/dev/reports/local-T044-lg07-industry.md`. **Infra hunks: none. Production/tool/test hunks: none. Cloud-held edits: none.** No tests, tsc, bot, probe, browser, benchmark or GPU run was started. The JSON reduction checked member completion/counts, every annual population/approval/air/I-HT median/min/max against the source summaries, matched nudge/day IDs and the census I-HT denominator. Local git provenance and diff/UTF-8 checks were read-only. Scratch reduction and full-precision data are `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/note062-report.mjs` and `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch/note062-report-data.json`.

The final-dev gates, new collector readings, G-AB, fresh G-UNEMP, both probe runs, full tests and browser behavior are unverified here. Their required schedule is above. The lead writes POLISH_PLAN amendments after the final run. This report remains uncommitted.

- [ ] Check the no-dirty-room 12-month ramp/unwind; I-HT conversion off at EQ 70 and on above it; mature expansion stays within labour headroom.
- [ ] Check Clean Air Act / Industrial Pollution Controls conversion, costs and ordinance text.
- [ ] Inspect I-D EQ penalties and persistent soil costs on R/CO$$$ after demolition; Brownfield Cleanup accelerates recovery.
- [ ] After GUIDE work, compare RCI/Industrial strategy numbers to host-mirrored targets, job shares and home air; check 720p layout and missing optional data on an old save.
- [ ] Save/load mid-ramp, inspect the y43 replayed and freshly selected 6×6 campuses after 24 months, and distinguish realised jobs from demand.

---

## Historical reports — superseded acceptance numbers

**T044 / LG-07 — round 4: labour conservation bug fixed**

Starting commit `be057d9bb9b2a84e1f57b0b61b8679da90b45b91`. Round-4 changes are **uncommitted**. This is case **(a), a bug**, specifically the blocked I-D output/reservation mismatch. I-M and I-HT receiving demand already passed through the headroom allocation. No test metric or bound was loosened, and `tests/sim/balanceEconomy.test.ts` is unchanged.

**Cause and correction**

The retooling code excluded positive I-D expansion from `exI` when no IndMed frontage or occupied district could accept it. The final loop nevertheless emitted that excluded request multiplied by `lkI`, which was calculated without the request. At full labour fade, the result was the allocated C/I budget **plus unbudgeted positive I-D demand**. Existing dirty jobs and capacity were never removed. Negative commercial demand in these fixtures is unrelated to retooling; subtracting it would hide the leak rather than measure a dirty-to-clean job transfer.

`demand.ts` now uses the same `blockedDirty` condition for reservation and output. A positive excluded I-D request receives only the existing small-town allowance `1 − lf`; at full fade it requests zero new workers. Commerce and eligible industry keep their original `lkC`/`lkI`. Negative demand and occupied IndMed redevelopment are preserved. The diagnostic `labour.scale` now includes excluded positive requests in its denominator, and their actual faded output in its numerator. This also fixes the unchanged first test's `<0.2` scale assertion.

The original fade remains: `lf=0` below 8,000 residents and `lf=1` from 40,000. No small-town/day-zero demand change, RNG draw, retooling-ratio/ramp change, residential compensation, cost weakening or bot strategy change was added.

**Exact failing fixtures, before and after**

These reproduce the unchanged test's synthetic totals and **40 daily updates**, including its empty-city demand EMA history. C/I DevTypes are shown; residential demand has resident units and does not enter this worker budget. `target` is the stored rounded, soft-capped target. Targets, `jobCapAll` and retooling additions are identical before/after. Values below are rounded for display; scratch JSON retains full precision.

Both fixtures have 100,000 residents, EQ 100 and **59,277.777778 staffable jobs**. There is no IndMed or redevelopment opportunity.

| Fixture | Existing C+I capacity | Headroom bound | Positive C+I before | Positive C+I after | Reported scale before → after |
|---|---:|---:|---:|---:|---:|
|More jobs than workforce|65,000|400 minimum|1,164.598714|400.007010|0.345 → 0.120|
|Workers to spare|50,000|9,277.777778|15,722.665271|9,277.698366|0.864 → 0.511|

The unchanged assertions remain **≤401** and **≤9,279.777778**. After 360 days the corrected sums converge to **400** and **9,277.777778**. Day-40 I-D retains **0.007723123** of the empty-city EMA history; its new instantaneous expansion request is zero. The fix keeps the existing EMA rather than resetting saved demand.

Overstaffed fixture, C=40,000 / I=25,000:

|DevType|jobCapAll|target|demandAbs before|demandAbs after|Current retooled addition to raw target|
|---|---:|---:|---:|---:|---:|
|CS1|8,000|5,305|−2,695.463075|−2,695.463075|0|
|CS2|8,000|4,688|−3,311.826365|−3,311.826365|0|
|CS3|4,000|1,699|−2,301.381610|−2,301.381610|0|
|CO2|14,000|8,573|−5,426.569313|−5,426.569313|0|
|CO3|6,000|4,945|−1,055.332982|−1,055.332982|0|
|IA|1,250|738|−511.748387|−511.748387|0|
|I-D|8,750|10,930|764.599427|0.007723|0|
|I-M|11,250|11,782|182.690780|182.690780|193.112161|
|I-HT|3,750|4,377|217.308508|217.308508|96.556081|

Spare-workers fixture, C=40,000 / I=10,000:

|DevType|jobCapAll|target|demandAbs before|demandAbs after|Current retooled addition to raw target|
|---|---:|---:|---:|---:|---:|
|CS1|8,000|5,305|−2,695.463075|−2,695.463075|0|
|CS2|8,000|4,688|−3,311.826365|−3,311.826365|0|
|CS3|4,000|1,699|−2,301.381610|−2,301.381610|0|
|CO2|14,000|8,573|−5,426.569313|−5,426.569313|0|
|CO3|6,000|4,945|−1,055.332982|−1,055.332982|0|
|IA|500|738|206.649481|206.649481|0|
|I-D|3,500|10,930|6,444.974629|0.007723|0|
|I-M|4,500|11,989|6,473.429005|6,473.429005|484.778828|
|I-HT|1,500|4,512|2,597.612157|2,597.612157|242.389414|

What retooling adds, rather than subtracting existing jobs:

- Overstaffed: refused dirty target **3,476.018900**; day-40 converted raw additions **193.112161 I-M / 96.556081 I-HT**. The capped I-M/I-HT targets are **11,782 / 4,377**, versus **11,641 / 4,286** with the ramp disabled in scratch.
- Spare-workers: refused **8,726.018900**; additions **484.778828 / 242.389414**. Capped targets **11,989 / 4,512**, versus **11,641 / 4,286** without conversion.
- In both, I-D's raw target stays **12,226**, capped target **10,930**, and existing capacity stays **8,750 / 3,500** respectively. No donor jobs/capacity are subtracted. Suppressing the blocked *expansion request* is appropriate; crediting an imaginary job removal is not.
- Disabling only conversion in scratch still gives old positive sums **1,340.083621 / 16,058.845625**, above the same headroom. After the fix they are **400.007010 / 9,277.698366**. The reservation/output mismatch exists without the receiving additions.
- At EQ **60**, I-HT conversion is zero, but the old spare-worker positive sum is **16,003.243470**; corrected **6,363.597833 ≤9,277.777778**. A new below-70 case checks the original positive-demand bound.
- Restoring road-adjacent IndMed gives **9,277.698366 before and after**, with positive I-D demand **3,917.686524**. This is selective blocking, not a blanket suppression of dirty industry.

The before/after verifier confirms all nine C/I targets, capacities and conversion additions match exactly, and **every non-I-D demandAbs matches exactly**, for both capacity fixtures at days 40 and 360, their no-conversion controls, the EQ-60 control and the open-land control.

**Round-4 changes per file**

- `src/sim/economy/demand.ts`: shared blocked-dirty predicate, consistent faded output, and aggregate `labour.scale` accounting. Allocation of eligible demand, raw/capped targets, ramp and receiving-sector modifiers are unchanged.
- New `tests/sim/industryLabour.test.ts`: eight cases for aggregate positive and net demand through the 720-day ramp/unwind; zero/partial labour fade; EQ below 70; policy conversion with available dirty land; occupied-lot redevelopment; and preservation of negative demand. Fixed mature totals are initialized before asserting the strict headroom invariant, avoiding inherited empty-city EMA history.
- `docs/dev/reports/local-T044-lg07-industry.md`: round-4 diagnosis and results prepended; round 3 retained explicitly as historical evidence.
- **Infra hunks: none. Hunks outside task-owned production files: none. Cloud-held edits: none.** Existing `balanceEconomy.test.ts` and every other existing test remain unchanged. No tuning constant, save field, Worker code or bot strategy changed.

**Tests and bot**

All tests ran individually through the quiet gate with one worker, native config loading and the same scratch config used in round 3. Total: **106 passed, 1 skipped across nine files**. The known ordinary-loader `spawn EPERM` workaround is still used; no repository configuration was changed.

|File / check|Round-4 result|
|---|---|
|`tests/sim/balanceEconomy.test.ts`|Before: exact two reported failures, 8 pass. After: **10 pass**, unchanged assertions|
|`tests/sim/industryLabour.test.ts`|**8 pass**|
|`tests/sim/industryRetooling.test.ts`|7 pass|
|`tests/sim/industryCosts.test.ts`|4 pass|
|`tests/sim/desirability.test.ts`|20 pass|
|`tests/sim/botCleanIndustry.test.ts`|8 pass|
|`tests/sim/industryProbe.test.ts`|4 pass|
|`tests/sim/botLongGame.test.ts`|28 pass|
|`tests/worker/hygiene.test.ts`|17 pass, 1 skip|
|`npx tsc --noEmit`|Pass|

The requested default **128×15 s7** run remains **[60,544, 94,177, 37,216] = 191,937**, delta **[0,0,0] / 0 residents** from round 3. All **15 annual observation rows**, RNG states and layout digests also match exactly. Annual JSON SHA256 remains `ac65084277e1d0fd6b33c6812ea31da439abd9de5e82cd7e5f9886353096d422`. This has the layout/observation-hash limits described in the historical report; no canonical full-state hash is claimed.

Reproduction from this worktree (same scratch location as earlier rounds):

```powershell
$t044Quiet = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
$t044Scratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch'
node $t044Quiet npx vitest run tests/sim/balanceEconomy.test.ts --config "$t044Scratch/r2-vitest.config.mjs" --configLoader native --pool threads --maxWorkers=1 --testTimeout=30000
node $t044Quiet npx vitest run tests/sim/industryLabour.test.ts --config "$t044Scratch/r2-vitest.config.mjs" --configLoader native --pool threads --maxWorkers=1 --testTimeout=30000
node $t044Quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

The seven other test files used the same per-file command. `tsx` remains absent; the actual equivalent bot invocation was:

```powershell
node "$t044Scratch/r3-build.mjs" r4
node $t044Quiet node "$t044Scratch/r3-r4/gates.mjs" --size 128 --years 15 --seed 7 --quiet "$t044Scratch/r4-base-128-s7.json"
```

Diagnostics: frozen `r4-before/labour.mjs` was bundled before editing production code; `r4-after/labour.mjs` afterward, using `r4-build.mjs` / `r4-labour.ts`. Each ran as `node $t044Quiet node <bundle>/labour.mjs <scratch/output.json>`, producing `r4-labour-before.json` / `r4-labour-after.json`. Scratch-only instrumentation observes the allocation and can disable only ramp additions; it never changes production files. `r4-summary.mjs` checks per-DevType invariants and exact bot-row identity, then writes `r4-summary.json`. Rebuilding a bundle named `before` now would use current source; retain the frozen one or reconstruct the original from `be057d9`.

**Gates left / plan and cloud requests**

NOTE-052 was read from `origin/claude/beautiful-johnson-u2jqoz:docs/dev/queue/NOTE-052-aa-perturbation.md`; it is absent in this worktree. It keeps current base judgment at ±1%, pending the symmetric funds-perturbation protocol, and reserves the chosen envelope for variant margins. I did not tune or reopen the lead's base-row decision.

No 256×60, clean-strategy bot, full balance file, full Vitest suite, GPU timing or browser run was added in this focused round. Their previous measurements are historical below and **not revalidated after this fix**. The conservation bug is resolved; original LG-07 acceptance is not newly signed off. No new cloud request is needed. The existing GUIDE RCI/Stats requests remain unchanged below; no UI code was edited.

Browser checklist, left for the lead:

- [ ] In a mature city with no dirty room, check clean conversion ramp and worker-limited expansion without extra positive I-D expansion; existing dirty jobs stay present.
- [ ] Restore IndMed frontage or inspect an occupied IndMed district: dirty expansion/redevelopment returns under the shared worker budget.
- [ ] Check small-town fade, ordinance conversion, negative demand and mid-ramp save/load; compare displayed labour/demand information with the mirrored state.
- [ ] Complete the original soil, RCI/Stats and y43 campus checks listed in the historical checklist after its GUIDE follow-up.

---

**SUPERSEDED — historical round-3 single-run report.** These numbers predate the round-4 conservation fix and are superseded as acceptance evidence by the T062 ensemble campaign and NOTE-062 above. Only the repeated 128 default result was reconfirmed in round 4; that identity check is historical, not a current ensemble gate. In particular, round 3’s 28.29% demand-share and +1.188 approval figures are not current results. The historical protocol and then-current verdicts below are retained for audit; NOTE-062 controls the final rules.

**T044 / LG-07 — round 3: approved changes measured; base gate still fails**

Worktree `simcityweb-T044`, branch `local/T044-lg07-industry`, supplied HEAD `d0d6b456e05a6f97f775e0c69e4c02e66a8f3fec` (dev `683d02b` merged by the lead). Changes remain **uncommitted**. No commit, push, merge, `.done`, baseline rewrite, browser or GPU run was made.

The high-tech floor is removed. Specified retooling, I-D EQ penalty and soil costs remain. The approved clean-only bot correction passes the 128 population/air targets and the scripted high-tech probe. Year-60 approval is +1.188 against its paired base. **Acceptance remains incomplete:** the shared A/A envelopes are zero, leaving four failed base population years on 256 s7 and nine on s11. Clean 256 s7 is also 3.0762% below fixed dev, just outside 3%. I stopped balance tuning; see **decisions for the lead**.

**Changes per file / ownership**

- `src/sim/economy/demand.ts`: removes the added high-tech floor; restores native `(EQ - 70) / 200`, capped at 0.45. Retains the saved deterministic 12-month ramp, 50% I-M / 25% I-HT strictly above EQ 70, receiving-sector modifiers, labour reservation treatment and read-only strategy accessor.
- `src/sim/economy/tuning.ts`: removes `RETOOL_IHT_SHARE`, `RETOOL_IHT_EQ0` and `RETOOL_IHT_EQ1`; corrects the mix comment. Required retooling constants and CO$$$ soil coefficient remain unchanged.
- `tools/simbot.ts` — **outside original named files, explicitly approved in round 3**: only `skips('dirty')` substitutes gas for coal, counts frontage belonging to complete usable industrial lots, and prefers viable vacant campus sites. Investment gates, demand thresholds, nuclear choice and default strategy remain.
- `tools/industryProbe.ts` — **new tool explicitly requested in round 3**: loads y43, chooses one deterministic vacant 6×6 site near an operating elementary/high school or college, zones through `CityActions`, then runs all systems for 720 days. Reports monthly conditions and contained/intersecting filled jobs. No services, quality, demand, money or jobs are injected.
- `tests/sim/industryRetooling.test.ts`: replaces the floor assertion with the native EQ-110 20% target and zero retooling when dirty room exists.
- New `tests/sim/botCleanIndustry.test.ts`: eight cases for clean-only power/zoning, full footprints, utilities, frontage, slope, site preference, investment failure and RNG isolation.
- New `tests/sim/industryProbe.test.ts`: four cases for deterministic read-only planning, frontage utilities, occupied/unserved/distant rejection and library/museum rejection.
- `docs/dev/reports/local-T044-lg07-industry.md`: this handoff.
- **Infra hunks: none. Cloud-held edits: none.** Committed WIP changes to `desirability.ts` and `ordinances.ts` are retained without new hunks this round.

**1. Base first — shared envelope does not excuse the drift**

Read NOTE-048's LG-07 decisions and SIM rule in full. The requested `git fetch origin local/T062-sim-aa-envelope` failed because the sandbox cannot write the shared worktree `FETCH_HEAD` outside T044. Once the shared local ref advanced, I read the complete report with `git show local/T062-sim-aa-envelope:docs/dev/reports/sim-aa-envelope.md` at **`3833c8d2379d3350663e624fe30be7867c559310`**.

T062 measured six processes on underlying dev `9fcc2ec`, task commit `0df76bc`. All three configurations have **zero** population, home-air, approval and I-HT-share envelopes under the prescribed +§1 day-1 perturbation. Funds remain exactly §1 higher: the perturbation occurred. `git diff 683d02b 9fcc2ec -- src/sim src/core tools/simbot.ts` is empty. T062's base populations match this worktree's b3 fixture. The current population band is therefore **±1%**, with no variant slack. This is the pre-T041 envelope; final merge gates require T041's new base/envelope.

Every annual population row from year 10 was compared:

| Configuration | Fixed-dev final | No-floor final | Endpoint drift | Worst drift, years 10+ | Mean signed drift, years 10+ | Failed years |
|---|---:|---:|---:|---:|---:|---:|
|128×15 s7|192,899|191,937|−0.498707%|−0.498707% (2015)|−0.138928%|0|
|256×60 s7|1,513,835|1,497,089|−1.106197%|−1.290713% (2058)|−0.004828%|4|
|256×60 s11|1,427,340|1,394,907|−2.272269%|−3.898052% (2054)|−0.568515%|9|

128 s7 residents are **[60,544, 94,177, 37,216]**, versus dev **[61,124, 93,804, 37,971]**. These changes follow LG-07's balance mechanics, not a difficulty-mode change.

| Seed | Year | Fixed dev | No floor | Drift |
|---|---:|---:|---:|---:|
|7|2053|1,392,709|1,378,570|−1.015216%|
|7|2058|1,488,790|1,469,574|−1.290713%|
|7|2059|1,504,810|1,486,032|−1.247865%|
|7|2060|1,513,835|1,497,089|−1.106197%|
|11|2052|1,354,608|1,333,883|−1.529963%|
|11|2053|1,372,356|1,331,686|−2.963517%|
|11|2054|1,388,950|1,334,808|−3.898052%|
|11|2055|1,386,414|1,347,246|−2.825130%|
|11|2056|1,400,344|1,357,297|−3.074030%|
|11|2057|1,403,945|1,373,139|−2.194246%|
|11|2058|1,414,561|1,377,115|−2.647182%|
|11|2059|1,416,617|1,396,126|−1.446474%|
|11|2060|1,427,340|1,394,907|−2.272269%|

The systematic-shift screen does **not** trigger under endpoints or mean signed drift: the 128 configuration never exceeds half its 1% tolerance. This does not excuse the failed 256 configurations. I do not call these failures measured A/A noise.

Round-2 scratch switches isolated the s7 interaction before this round. Historical attribution measurements:

|256 s7 switch|Year-60 population|Worst yearly drift|Strict-1% failed years|
|---|---:|---:|---:|
|WIP, all four parts|1,505,488|−1.6477%|4|
|All four off: dev control|1,513,835|0%|0|
|Retooling off, including reservation correction|1,505,488|−1.6477%|4|
|New CO$$$ soil weight off|1,505,488|−1.6477%|4|
|Added floor off, required costs retained|1,497,089|−1.2907%|4|
|Required I-D EQ penalty off, floor retained|1,469,170|−2.9505%|8|

Retooling/floor/EQ/soil switches were scratch-only, separate per part. Floor removal is the only accepted production correction. All three current base runs have zero converted targets throughout every recorded full-year cohort. The s7 ablations do not prove attribution of s11's larger drift; no new s11 component-ablation series was run after the shared gate failed. Removing the required penalty is not a valid fix and previously worsened s7. No residential compensation or weakened cost was added.

**Default-bot identity**

The original HEAD bot was frozen in a scratch control bundle using the same current no-floor simulation. Separate processes with the revised bot reproduce **every recorded annual field**, RNG state and layout digest for all three §8.0 configurations:

|Configuration|Annual rows identical|SHA256 of identical annual JSON series|
|---|---:|---|
|128×15 s7|15/15|`ac65084277e1d0fd6b33c6812ea31da439abd9de5e82cd7e5f9886353096d422`|
|256×60 s7|60/60|`72c736c0630a6c882b17003bd7f278c630b56076c320837a573bf99b254edff8`|
|256×60 s11|60/60|`433c12b18c29ebbb887ce3828d1597629ca5dbf744616e6eafe9e1378fd3c5e6`|

The layout digest hashes zones, networks, building IDs, utilities, powerlines, soil, air/water pollution, land value, all desirability layers and building records. It is **not** a canonical hash of every CityState/systemData field. These controls show that the bot correction stays out of default runs; they do not claim LG-07 itself leaves dev's state identical.

**2. Clean-only population, placement and air**

Gas's nominal catalog economics, before operating/load/funding modifiers:

|Plant|Capital / output|Capital per MW|Monthly upkeep / output|Upkeep per MW-month|
|---|---:|---:|---:|---:|
|Coal|§25,000 / 400 MW|§62.50|§700 / 400 MW|§1.75|
|Gas|§22,000 / 250 MW|§88.00|§650 / 250 MW|§2.60|

Gas costs **40.8% more capital/MW** and **48.57% more nominal upkeep/MW**. The clean bot keeps spending gates and nuclear selection; it receives no subsidy.

|128×15 metric|Seed 7|Seed 11|
|---|---:|---:|
|Paired base population|191,937|194,346|
|Clean population|154,544|158,878|
|Clean / paired base|0.805180867|0.817500746|
|Margin above 0.80× paired base|+994.4 people|+3,401.2 people|
|Clean / fixed-dev s7|**0.801165377**|no fixed 128 s11 fixture|
|Margin above fixed-dev 0.80× s7|**+224.8 people / +0.116538 percentage points**|—|
|Paired base mean home air|0.057498336302|0.050367936556|
|Clean mean home air|0.041032895028|0.041105469076|
|Paired improvement|**28.636379%**|**18.389611%**|
|Margin above 15%|+13.636379 points|+3.389611 points|
|Absolute air margin below 0.85× base|0.007840690829|0.001707276997|

Both population and cleaner-air direction hold on the second seed without envelope slack. Against unchanged-dev s7 mean air **0.057220800467** (round-2 all-off replay, core source unchanged), clean is **28.290246%** cleaner, also a strict pass. This is exactly LD15a's metric: the arithmetic mean of the **15 annual resident-weighted `stats.avgAir` samples at homes**, not endpoint or map/source pollution. The current balance assertion is labelled `no dirty industry: air over the run` inside the large balance test; it is not separately selectable.

Clean s7 residents are **[40,791, 76,869, 36,884]**. An independent repeat reproduces all annual measurements, RNG states and layout digests exactly; its added read-only room observation changes no recorded result.

Retooled demand is still only partly placed. At year 15, refused dirty target is **21,545.826**; converted additions are **10,507.701 I-M** and **5,253.851 I-HT** (target jobs, not tagged employment):

|Sector|Raw target|Soft-capped target|Working capacity|Filled jobs|Growth demandAbs|
|---|---:|---:|---:|---:|---:|
|I-M|35,208|31,270|13,090|12,267|170.144|
|I-HT|16,146|15,713|6,040|5,544|90.358|

There is no IndMed. IndHigh permits I-M and now covers **1,712 cells**, versus the previous WIP clean run's 1,128. However, its **67 serviced vacant frontage cells contain zero complete usable industrial lots** at year 15. The new counter finds positive room in 2001–2013 and zero in 2014–2015; the remaining frontage is fragmented. Labour also limits placement: headroom **1,119**, scale **0.021**; new-lot capacity limits approximately **204.17 I-M / 108.43 I-HT**, below a 400-job factory or 520-job campus. No growth allowance or bank rule changed.

Year-15 clean s7 has **three gas plants and no coal**. I-HT emits zero direct air; I-M still emits **127.229 source units** across 192 lots. Source sums are not home exposure. The old late-coal problem is removed, while traffic, manufacturing and spatial exposure remain. These diagnose the combined correction; no isolated gas-versus-planner causal ablation was run.

**256×60 s7** clean population is **1,467,267**:

- Versus paired no-floor base 1,497,089: **0.980080009×**, a **1.991999% loss**, within 3% by **15,090.67 people / 1.008001 points**.
- Versus fixed §8.0 dev 1,513,835: **0.969238391×**, a **3.076161% loss**, missing 3% by **1,152.95 people / 0.076161 points**. Zero A/A cannot excuse this miss. This stricter fixed-reference result prevents an unconditional pass.

No 256 clean s11 run was added after the base failures were established. The required other-seed direction for the 128 targets was measured above; no A/A-excused pass is claimed.

**3. High-tech mechanism — demand and real placement**

“Demand” here is **positive incremental `demandAbs` capacity demand**, after existing capacity, labour throttling and EMA, which growth consumes. Industrial denominators below are **I-D + I-M + I-HT**, excluding farms, consistent with T062's job-share convention. Raw observation JSON also retains the older ratios including agriculture; those are slightly lower and still exceed 25% on every qualifying s7 row.

Under this definition, gate (a) passes: base first reaches EQ 110 in **2024**, at **28.288494%** positive I-HT demand, the minimum of its qualifying rows through 2040. It reaches **40.743792%** in 2040. Clean first qualifies in **2021** at **25.54%** (rounded); all its qualifying rows through 2040 exceed 25%. No normalized demand bars were summed or divided.

Raw/capped targets answer a different question:

|Base year|EQ|Raw I-HT target share|Capped target share|Positive incremental share|
|---|---:|---:|---:|---:|
|2024|110.6643|20.332210%|21.154435%|28.288494%|
|2030|120.5021|25.250918%|26.579470%|34.243015%|
|2040|129.9499|31.059332%|30.538926%|40.743792%|
|2060|132.0797|32.141170%|31.072324%|42.495037%|

If the lead intends **total raw/capped targets** as gate (a), early qualifying rows fail: native share is only 20% at EQ 110 and reaches 25% at EQ 120 before modifiers. I have not recreated the rejected floor to hide that interpretation difference. The placement probe independently proves the mechanism works.

Every qualifying s7 year follows. Jobs are filled I-HT jobs / share of I-D+I-M+I-HT jobs. Dashes mean EQ is below 110. Realised bot shares are reported, not gated.

|Year|Base EQ|Base positive demand %|Base I-HT jobs / share|Clean EQ|Clean positive demand %|Clean I-HT jobs / share|
|---|---:|---:|---:|---:|---:|---:|
|2021|—|—|—|110.08|25.54|2,456 / 14.86%|
|2022|—|—|—|112.30|26.55|2,459 / 14.88%|
|2023|—|—|—|114.45|26.55|2,457 / 14.85%|
|2024|110.66|28.29|0 / 0.00%|116.20|27.30|2,458 / 14.85%|
|2025|112.74|29.47|0 / 0.00%|117.71|27.94|2,461 / 14.87%|
|2026|114.42|30.88|0 / 0.00%|119.00|28.47|2,465 / 14.89%|
|2027|115.93|32.14|0 / 0.00%|120.06|28.64|2,454 / 14.86%|
|2028|117.28|33.01|0 / 0.00%|120.90|28.77|2,452 / 14.83%|
|2029|118.74|34.20|0 / 0.00%|121.64|29.61|2,453 / 14.83%|
|2030|120.50|34.24|0 / 0.00%|122.41|29.84|2,444 / 14.76%|
|2031|122.24|34.71|0 / 0.00%|123.14|30.53|2,444 / 14.77%|
|2032|123.76|35.24|0 / 0.00%|123.99|30.78|2,367 / 14.39%|
|2033|125.03|35.81|0 / 0.00%|124.81|30.97|2,365 / 14.36%|
|2034|126.12|36.24|0 / 0.00%|125.58|31.11|2,365 / 14.38%|
|2035|127.01|36.59|0 / 0.00%|126.27|31.24|2,284 / 13.98%|
|2036|127.78|36.69|0 / 0.00%|126.86|31.81|1,773 / 10.03%|
|2037|128.46|38.03|0 / 0.00%|127.33|32.10|1,642 / 8.34%|
|2038|129.09|38.96|0 / 0.00%|127.77|31.73|3,122 / 13.83%|
|2039|129.60|39.85|0 / 0.00%|128.19|32.03|5,455 / 20.76%|
|2040|129.95|40.74|0 / 0.00%|128.73|31.64|8,208 / 26.67%|
|2041|130.19|41.19|0 / 0.00%|129.24|31.70|8,964 / 25.77%|
|2042|130.30|41.97|0 / 0.00%|129.64|31.48|11,173 / 27.75%|
|2043|130.34|42.76|0 / 0.00%|129.89|31.09|13,594 / 29.71%|
|2044|130.30|43.59|0 / 0.00%|130.00|30.50|16,443 / 31.94%|
|2045|130.44|43.98|0 / 0.00%|130.06|29.96|19,204 / 33.43%|
|2046|130.66|43.68|0 / 0.00%|130.19|30.41|22,058 / 34.52%|
|2047|130.85|43.33|0 / 0.00%|130.41|29.97|25,024 / 35.51%|
|2048|130.92|42.99|0 / 0.00%|130.61|29.44|27,959 / 36.49%|
|2049|130.92|42.12|0 / 0.00%|130.76|28.89|31,601 / 37.58%|
|2050|130.90|41.67|607 / 0.59%|130.86|29.42|31,669 / 35.65%|
|2051|130.96|42.20|1,156 / 1.10%|130.94|30.07|30,849 / 33.07%|
|2052|131.10|42.40|1,104 / 1.02%|130.97|31.70|29,635 / 30.40%|
|2053|131.27|42.21|2,345 / 2.11%|131.01|32.36|28,490 / 28.12%|
|2054|131.49|42.12|3,035 / 2.68%|131.12|32.77|27,717 / 26.33%|
|2055|131.71|42.08|3,861 / 3.34%|131.29|33.12|28,622 / 25.89%|
|2056|131.90|42.06|4,927 / 4.16%|131.40|33.09|30,016 / 25.91%|
|2057|131.97|42.16|5,943 / 4.86%|131.48|32.76|32,905 / 26.77%|
|2058|132.01|42.20|6,374 / 5.12%|131.53|32.59|35,764 / 27.76%|
|2059|132.05|42.44|7,321 / 5.70%|131.62|32.25|38,785 / 28.67%|
|2060|132.08|42.50|8,251 / 6.27%|131.73|32.17|40,732 / 28.66%|

Default-bot zoning remains the realised-job blocker: its I-HT bar is **0.0251** in 2024 and **0.1462** in 2040, below unchanged **>0.35** IndHigh threshold. The floor is gone; native demand is available. The clean bot first exceeds 25% realised jobs in 2040. Base s11 ends with 12.26% including farms, also diagnostic rather than gated.

**Scripted y43 gate (b): pass**

- Input: supplied veteran `vet_s7_y43.city.metropolis`, SHA256 **`9fb89f999b3a9c327bc2e82d72928542f75e11898d8a6ec1f63c9d41a2ab2cf7`**. Size 256, seed 7, day **15,480**, year 2043, saved population **991,493**, EQ **129.303754**.
- One selection before any simulated outcome: rectangle **[95,101) × [230,236)**, near operating elementary school #24796, centre distance **8.2765 tiles**, 1,500 seats, staffed 40/40. Existing roads provide two complete six-cell fronts. Selected perimeter is isolated from other IndHigh.
- Real zone action: **36 cells**, **§720**, no demolition or zoning RNG draw. No extra road, utility, school, money or demand action. Existing frontage utilities satisfy normal lot rules; each tile need not independently hold coverage.
- Advance **24 months / 720 days**, through day **16,200**, using `createSystems()` without bot automation.
- Final filled jobs: **2,252 / 2,252 I-HT = 100%**, both wholly contained and all-intersecting. **Zero crossing jobs**. Capacity 2,340, none unfinished. Margin above gate **+75 percentage points**.
- Actual campuses: stage 4 **496/520 jobs**, stage 6 **1,066/1,100**, stage 5 **690/720**. No job injection or stage forcing. Tool passed again after its final RNG-check edit.

**4. Approval — endpoint retained; mean benefit changes**

Paired 256 s7 approval is **80.084679 base / 81.272708 clean** in 2060: **+1.188028**, exceeding `1 − 0` by **0.188028 points**. This paired comparison follows the preceding review's supplied +0.49 calculation. Current run-mean gain is **+0.721926**, versus the previous floor/old-bot experiment's +2.106110. These are different combined scenarios, not isolated component effects.

Fixed-dev audit: T062's 2060 approval is **80.357424696**. Clean minus that is **+0.915283128**, short of +1 by **0.084716872** with zero slack. The reference distinction remains explicit below.

The scratch observer captures monthly terms and applies the existing 0.3 EMA separately. Contributions reconstruct both gains within 3×10⁻¹⁴. No formula or approval bonus changed:

|Clean minus paired base term|Run mean|Year-60 smoothed contribution|
|---|---:|---:|
|tax|+0.202566|+0.750000|
|services|−0.856463|−1.555450|
|pollution|+0.646942|+0.851555|
|crime|−0.058106|−0.318252|
|unemployment|+0.015808|+0.023774|
|parks|+0.146859|−0.028640|
|ordinances|−0.035200|0|
|civic|−0.002965|0|
|noise|+0.437333|+0.705480|
|garbage|+0.011307|−0.007824|
|needs|+0.122663|−0.010943|
|tap water|+0.033576|−0.003278|
|tourism|+0.010502|0|
|headquarters|+0.107023|+0.111918|
|emergencies|−0.075921|+0.476512|
|justice|+0.016002|+0.193175|
|**Total**|**+0.721926**|**+1.188028**|

Services absorb much of the environmental gain; crime is also negative. Unemployment helps little because both endpoints are below approval's 8% excess-unemployment threshold: **7.7049% base / 7.3595% clean**. Endpoint home air is now better (**0.143284 clean / 0.177407 base**), unlike the preceding experiment. Pollution, noise, ordinary tax-path and emergency differences outweigh the service loss. These are accounting contributions, not gas/planner causal ablations.

**decisions for the lead**

|Retained choice / reference|Measured result under zero A/A|Decision / remaining issue|
|---|---|---|
|Remove floor; retain specified costs and ratios|128 base passes; 256 s7 worst −1.290713%, s11 worst −3.898052%; 13 failed years|Current ±1% base gate fails. No permitted compensation was inserted. A different approved mechanic change or explicit gate decision is needed; this does not prove every possible implementation fails.|
|Approved clean-only power and full-lot/site planning|128 s7 0.801165× fixed dev; air 28.290246% cleaner fixed / 28.636379% paired; other seed direction holds|128 targets pass strictly; gas has the measured higher cost/MW.|
|256 clean population against fixed §8.0 dev|0.969238×; 3% target short by 1,152.95 people / 0.076161 points|Fixed-reference miss; zero envelope supplies no slack. Paired comparison passes at −1.991999%.|
|I-HT positive incremental demand and real block|Minimum qualifying base demand 28.288494%; probe 100% I-HT|Mechanism passes under demandAbs. Raw/capped interpretation fails early qualifying rows; do not silently reinstate a floor.|
|Approval against paired candidate base, as +0.49 was calculated|+1.188028|Strict paired pass. Fixed-dev +0.915283 misses by 0.084717; keep intended reference explicit.|

I stopped tuning when T062 established zero slack. An all-gates-passing result has **not** been established. Post-T041 remeasurement remains required, not permission to re-record the present baseline.

**Tests and remaining gates**

All Vitest and bot/probe commands used the quiet gate. Simulations ran one at a time.

|Check|Result|
|---|---|
|`npx tsc --noEmit`|Pass after final source edits|
|`tests/sim/industryRetooling.test.ts`|7 passed|
|`tests/sim/industryCosts.test.ts`|4 passed|
|`tests/sim/desirability.test.ts`|20 passed|
|`tests/sim/botCleanIndustry.test.ts`|8 passed|
|`tests/sim/industryProbe.test.ts`|4 passed|
|`tests/sim/botLongGame.test.ts`|28 passed|
|`tests/worker/hygiene.test.ts`|17 passed, 1 skipped with isolated `--testTimeout=30000` rerun; initial run had two 5-second source-scan timeouts, no assertion violation reported|
|Standard-config quiet-gated `industryCosts.test.ts`|Cannot start: Vite externalize-deps `optimizeSafeRealPathSync`, **spawn EPERM**|
|LD15a air assertion inputs|Strict pass: 0.041032895028 < 0.057498336302; complete balance file not run|
|EQ|128 base ≥100 in 2015, clean in 2014 on both seeds. 256 base ≥100 in 2020 s7 / 2018 s11; clean s7 in 2016|
|Employment ledger|Maximum `abs(unemp − (1 − accW))` over seven distinct series: **0.012093190 < 0.02**|
|Default bot excluded from correction|15+60+60 annual fields, RNG and layout digests identical to original-bot/no-floor controls|
|Old-save continuation|Veteran y43 loads and advances 720 days; optional/mid-ramp save cases are in retooling tests|
|Full Vitest / complete balance file|Left for lead, as instructed|
|Canonical full-state two-process hashes / separate Hard runs|Not verified; layout/annual hashes have the limits described above|

Successful test form, run separately for each named file, with no repository config change. Scratch config sets `resolve.preserveSymlinks: true`:

```powershell
$t044Quiet = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
$t044Scratch = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T044/scratch'
node $t044Quiet npx vitest run tests/sim/industryRetooling.test.ts --config "$t044Scratch/r2-vitest.config.mjs" --configLoader native --pool threads --maxWorkers=1
```

**Bot commands / artifacts**

`tsx` is absent. Local Rolldown bundled `r3-gates.ts`, importing `SimBot`, `botSystems` and `parseArgs`. Control transforms replace only the bot with captured HEAD source; both bundles use current no-floor simulation. The passive approval callback adds no simulation writes or RNG draws. Source hashes are in `r3-control-sources.json` / `r3-final-sources.json`.

Exact simbot-equivalent commands from this worktree, using the prefix above:

```powershell
node $t044Quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
node $t044Quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --skip dirty --quiet
node $t044Quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 11 --quiet
node $t044Quiet npx tsx tools/simbot.ts --size 128 --years 15 --seed 11 --skip dirty --quiet
node $t044Quiet npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet
node $t044Quiet npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --skip dirty --quiet
node $t044Quiet npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet
```

Actual commands (output arguments write UTF-8 JSON directly):

```powershell
node "$t044Scratch/r3-build.mjs" control
node "$t044Scratch/r3-build.mjs" final
node $t044Quiet node "$t044Scratch/r3-control/gates.mjs" --size 128 --years 15 --seed 7 --quiet "$t044Scratch/r3-control-128-s7.json"
node $t044Quiet node "$t044Scratch/r3-control/gates.mjs" --size 256 --years 60 --seed 7 --quiet "$t044Scratch/r3-control-256-s7.json"
node $t044Quiet node "$t044Scratch/r3-control/gates.mjs" --size 256 --years 60 --seed 11 --quiet "$t044Scratch/r3-control-256-s11.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 128 --years 15 --seed 7 --quiet "$t044Scratch/r3-final-128-s7.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 128 --years 15 --seed 7 --skip dirty --quiet "$t044Scratch/r3-final-128-s7-clean.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 128 --years 15 --seed 11 --quiet "$t044Scratch/r3-final-128-s11.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 128 --years 15 --seed 11 --skip dirty --quiet "$t044Scratch/r3-final-128-s11-clean.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 256 --years 60 --seed 7 --quiet "$t044Scratch/r3-final-256-s7.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 256 --years 60 --seed 7 --skip dirty --quiet "$t044Scratch/r3-final-256-s7-clean.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 256 --years 60 --seed 11 --quiet "$t044Scratch/r3-final-256-s11.json"
node $t044Quiet node "$t044Scratch/r3-final/gates.mjs" --size 128 --years 15 --seed 7 --skip dirty --quiet "$t044Scratch/r3-final-128-s7-clean-repeat.json"
```

Control build requires captured `r3-control-simbot.ts`; its frozen bundle remains intact. Final bundle was rebuilt once to add only read-only clean-room observations. First clean runs lack that extra field; repeat comparison excludes only that observation.

Probe command, successful twice including after final edits:

```powershell
node node_modules/rolldown/bin/cli.mjs tools/industryProbe.ts --platform node --format esm --dir "$t044Scratch/r3-probe" --entry-file-names industryProbe.mjs
node $t044Quiet node "$t044Scratch/r3-probe/industryProbe.mjs" --city C:/Users/techsin/AppData/Local/Temp/claude/C--Users-techsin-Desktop-projects-simcityweb/aa362639-df94-5668-b880-d90605d049a2/scratchpad/t013/cities/vet_s7_y43.city.metropolis --out "$t044Scratch/r3-probe-result.json"
```

With tsx available: `node $t044Quiet npx tsx tools/industryProbe.ts --city <y43.city.metropolis> --out <scratch/result.json>`. Optional `--site 95,230` replays the measured rectangle. No new 43-year bot save was needed.

All artifacts are in designated T044 scratch. `r3-summary.json` contains full annual dev comparisons, failed years, gate ratios, EMA contributions, demand/job tables and probe summary. `r3-final-*.json` / `r3-control-*.json` retain full precision. `r3-analyze.mjs` regenerates the summary; `r3-details.mjs` emits placement/approval/yearly-share diagnostics. Historical `r2-*.json`, `r2-allcommands.txt`, `r2-build.mjs` and `r2-summary.json` remain unchanged.

**Plan versus code / exact cloud requests**

- NOTE-048 replaces the realised-bot HT gate and amends base/approval rules. T062's zero envelope leaves strict gates; failed LG-07 rows do not establish a larger A/A envelope.
- Current b3 references are 192,899 / 1,513,835 / 1,427,340, not older plan examples. No fixture was re-recorded. Post-T041 remeasurement remains required.
- Existing `st.soil`, I-D accumulation, persistence after demolition, residential costs and Brownfield Cleanup's 5× decay already implement most soil behavior. Retained WIP adds CO$$$'s missing weight; no duplicate map, save schema or infra hunk was needed.
- Production retooling's dirty-room heuristic still reads vacant IndMed frontage/redevelopment opportunity, not exhaustive full-footprint packing. Approved bot correction checks complete prospective clean lots separately. Do not present frontage totals as buildable-factory counts.
- Optional `systemData.economy.industry` remains mirrored through existing economy state. `industrialStrategy(ctx.state)` returns a copy without initializing the replica. Its `dirtyShare` includes farms as documented; this report's HT tables follow T062's three-sector denominator.
- **GUIDE / `src/ui/TopBar.ts`, `buildRciPop()` and `update()` (or split RCI equivalent):** add retooled I-M/I-HT from `industrialStrategy(ctx.state)`. Label current demand-target additions, not filled jobs; hide missing optional data. This explains the strategy without promising employment.
- **GUIDE / `src/ui/panels/StatsPanel.ts`, `build()` and `update()`:** add Industrial strategy with converted target jobs, dirty-job share with denominator clear, and resident-weighted home air from the same accessor. New listeners use `ctx.signal`; reads stay through `ctx.host`/`ctx.state`, mutations through `host.act`.
- No new request for Worker, App wiring, infra, save, region or other cloud-held code. No UI hunk made.

**Not verified / left for the lead**

The all-gates result is **not achieved**. Resolve measured base/fixed-reference failures before sign-off. Full standard-config Vitest, complete balance file, canonical full-state two-process hashes, separate Hard runs, GPU/frame timings, Worker packet/frame costs and browser behavior were not checked. Required post-T041 dev merge and fresh shared envelope remain external follow-up; current zero envelopes must not be reused for that base. No clean 256 s11 result or s11 per-component attribution is claimed.

Browser acceptance checklist (all unchecked; GUIDE rows need its follow-up):

- [ ] With no usable IndMed room, verify 12-month ramp and gradual unwind when room returns; I-HT off at EQ 70 and on above it.
- [ ] Enable Clean Air Act and Industrial Pollution Controls separately/together; check conversion, costs and text without double counting/taxing.
- [ ] Inspect I-D at EQ 90/95/110: penalties 0 / −0.015 / −0.06, matching layer and explanation.
- [ ] Demolish an old dirty lot, rezone R/CO$$$ and observe persistent soil costs; Brownfield Cleanup accelerates gradual recovery.
- [ ] Compare RCI/Stats additions, dirty share and home air to host-mirrored values; open/close overlays and load an old save without the optional key.
- [ ] Save/load mid-ramp without instant reset/conversion; inspect ordinance/RCI text at 720p.
- [ ] On y43, replay the 6×6 site near the elementary school and inspect staffed campuses after 24 months; distinguish demand targets from filled jobs.

## Historical NOTE-053 ensemble verdicts — amended by NOTE-062 above

These are the original campaign tables and then-current verdicts, retained verbatim for audit. Their two-sided 1.03× clean-population failure and four s11 upward approval failures are SUPERSEDED by NOTE-062 above; the strict year-60 approval failure stays OPEN. Realised I-HT is report-only. Measured on pushed local/T044-measured at a1a4e79 (parent 57ed983, plus T062’s measurement flag); final gates repeat on dev including B2 and T041.

# T044 (LG-07): NOTE-053 ensemble judgement

Measurement tree: `C:/Users/techsin/Desktop/projects/simcityweb-T044m` at `a1a4e79` (lane HEAD plus flag commit `3833c8d`). The dev comparison is the original simulation used by this lane, from `scratch/note053-dev`; this is the requested interim judgement before the final gate on dev including T041.

Five members are control and ±§100 on days 1 and 1441. Stage two adds ±§200 at both timings, for nine members. Each collection command uses `--jobs 4`, with every member through the quiet gate; the root campaign serializes ensemble commands. Cached members are reused.

Base population tolerance is 1% (the item); other metric tolerances are zero. Every annual median from year 10 must be inside dev’s min–max band and within max(item tolerance, half dev’s band) of dev’s median. The systematic-shift test uses each required row’s endpoint (year 15 for 128, year 60 for 256).

NOTE-053 replaces the former A/A-envelope target slack: targets below are strict ensemble-median thresholds. A five-member result within half of dev’s corresponding band of a threshold requires stage two. Run-mean air uses the median and band of each member’s arithmetic mean over all 15 annual air observations, matching LD15a; its stage-two reference is the same run-mean statistic on dev.

## Target summary

| Row | Check | Runs | Verdict | Observed | Threshold | Margin (positive passes) |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| 128x15_s7 | Year-15 population at least 0.80 × base | 5 | pass | 167,218.0000 | 153,416.8000 | +13801.2000 |
| 128x15_s7 | Run-mean air at least 15% cleaner | 5 | pass | 0.04519859 | 0.04868344 | +0.00348485 |
| 256x60_s7 | Year-60 population at least 0.97 × base | 9 | pass | 1,534,036.0000 | 1,430,876.1000 | +103159.9000 |
| 256x60_s7 | Year-60 population at most 1.03 × base | 9 | fail | 1,534,036.0000 | 1,519,383.9000 | -14652.1000 |
| 256x60_s7 | Year-60 approval gain at least +1 point | 9 | fail | 80.1126 | 81.0847 | -0.9721 |

| Base row | Runs | Verdict | Failed annual metric checks |
| --- | ---: | --- | ---: |
| 128x15_s7 | 9 | pass | 0 |
| 256x60_s7 | 9 | pass | 0 |
| 256x60_s11 | 9 | fail | 4 |

## Stage-two decisions

Five-member base rows requiring nine: 128x15_s7, 256x60_s7, 256x60_s11. Five-member clean-only rows requiring nine: 256x60_s7.

## 5-member results

### Systematic shift at row endpoints

| Metric | Real shift | Direction | Endpoint deltas (128 s7 / 256 s7 / 256 s11) | Quarter dev-band widths |
| --- | --- | --- | --- | --- |
| population | no | — | +183.000000 / +14043.000000 / +13988.000000 | 744.000000 / 33,478.250000 / 18,965.250000 |
| approval | no | — | -0.404147 / -0.272745 / +0.555748 | 0.162550 / 0.200402 / 0.554882 |
| air | no | — | +0.000672 / +0.001502 / -0.004911 | 0.001402 / 0.006227 / 0.008769 |
| ihtShare | no | — | 0.000000 / -0.051971 / +0.002472 | 0.000000 / 0.008806 / 0.025813 |

### Attentive base: 128x15_s7

Source commit: `a1a4e79e709e12a368af0645c3ac9dd50e9ac7f1`; summary: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/T044/base/128x15_s7_ensemble.summary.json`.

All annual values are median [minimum, maximum]; population is residents, approval is points, air is home air pollution (lower is cleaner), I-HT is percent of industrial jobs, and funds are § (from raw annual rows).

| Year (index) | Population | Approval | Air at homes | I-HT share (%) | Funds (§) |
| --- | --- | --- | --- | --- | --- |
| 2001 (1) | 3,587 [3,587, 3,587] | 51.188 [51.188, 51.188] | 0.014765 [0.014765, 0.014765] | 0.000 [0.000, 0.000] | 39,655 [39,555, 39,755] |
| 2002 (2) | 9,297 [9,297, 9,297] | 50.617 [50.617, 50.617] | 0.026958 [0.026958, 0.026958] | 0.000 [0.000, 0.000] | 55,520 [55,420, 55,620] |
| 2003 (3) | 17,010 [17,010, 17,010] | 51.971 [51.971, 51.971] | 0.037546 [0.037546, 0.037546] | 0.000 [0.000, 0.000] | 15,420 [15,320, 15,520] |
| 2004 (4) | 25,619 [25,491, 25,619] | 49.565 [49.448, 49.565] | 0.048661 [0.046765, 0.048661] | 0.000 [0.000, 0.000] | 7,963 [7,198, 7,963] |
| 2005 (5) | 34,686 [34,443, 34,852] | 47.486 [47.486, 47.690] | 0.046969 [0.045584, 0.046969] | 0.000 [0.000, 0.000] | 22,208 [15,576, 22,308] |
| 2006 (6) | 44,579 [44,172, 45,649] | 51.917 [51.754, 53.082] | 0.045099 [0.044897, 0.046689] | 0.000 [0.000, 0.000] | 35,616 [35,384, 37,277] |
| 2007 (7) | 56,990 [55,962, 57,714] | 56.201 [56.169, 57.708] | 0.045450 [0.044740, 0.046091] | 0.000 [0.000, 0.000] | 36,381 [36,224, 46,381] |
| 2008 (8) | 70,194 [69,406, 70,869] | 61.522 [60.808, 62.269] | 0.044646 [0.044618, 0.045963] | 0.000 [0.000, 0.000] | 57,054 [55,630, 57,490] |
| 2009 (9) | 84,462 [83,282, 84,835] | 66.501 [66.229, 67.360] | 0.072853 [0.067890, 0.073485] | 0.000 [0.000, 0.000] | 51,644 [44,407, 62,912] |
| 2010 (10) | 100,141 [98,826, 101,026] | 70.852 [69.900, 72.420] | 0.073704 [0.069177, 0.074416] | 0.000 [0.000, 0.000] | 74,260 [64,517, 74,337] |
| 2011 (11) | 116,914 [115,670, 118,282] | 73.338 [73.068, 75.225] | 0.074557 [0.073473, 0.076420] | 0.000 [0.000, 0.000] | 87,934 [86,720, 90,394] |
| 2012 (12) | 135,052 [133,816, 136,272] | 75.066 [75.015, 76.995] | 0.072677 [0.070805, 0.073749] | 0.000 [0.000, 0.000] | 103,092 [85,334, 111,885] |
| 2013 (13) | 154,042 [151,888, 154,248] | 76.842 [76.326, 78.137] | 0.078567 [0.077758, 0.078895] | 0.000 [0.000, 0.000] | 118,206 [111,963, 124,788] |
| 2014 (14) | 172,437 [170,229, 173,503] | 78.492 [77.483, 79.997] | 0.084840 [0.084605, 0.085895] | 0.000 [0.000, 0.000] | 117,949 [111,182, 155,336] |
| 2015 (15) | 191,771 [189,912, 193,437] | 80.961 [80.490, 82.008] | 0.093545 [0.091336, 0.093667] | 0.000 [0.000, 0.000] | 172,909 [154,303, 207,383] |

#### Annual comparison with dev

`ihtShare` values and margins in this comparison use fractions (0.01 = one percentage point); the annual table above displays percent.

| Year | Metric | Dev median [min, max] | Lane median | Δmedian | Δ % | Passing interval | Margin to nearest boundary | Verdict |
| --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- |
| 2010 | population | 100,141.000000 [98,826.000000, 101,026.000000] | 100,141.000000 | 0.000000 | 0.0000 | [99,041.000000, 101,026.000000] | +885.000000 | needs stage two |
| 2010 | approval | 70.851885 [69.900056, 72.420202] | 70.851885 | 0.000000 | 0.0000 | [69.900056, 72.111958] | +0.951829 | needs stage two |
| 2010 | air | 0.073704 [0.069177, 0.074416] | 0.073704 | 0.000000 | 0.0000 | [0.071084, 0.074416] | +0.000713 | needs stage two |
| 2010 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2011 | population | 116,914.000000 [115,670.000000, 118,282.000000] | 116,914.000000 | 0.000000 | 0.0000 | [115,670.000000, 118,220.000000] | +1244.000000 | needs stage two |
| 2011 | approval | 73.337719 [73.067949, 75.225277] | 73.337719 | 0.000000 | 0.0000 | [73.067949, 74.416383] | +0.269770 | needs stage two |
| 2011 | air | 0.074557 [0.073473, 0.076420] | 0.074557 | 0.000000 | 0.0000 | [0.073473, 0.076031] | +0.001084 | needs stage two |
| 2011 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2012 | population | 135,052.000000 [133,816.000000, 136,272.000000] | 135,052.000000 | 0.000000 | 0.0000 | [133,816.000000, 136,272.000000] | +1220.000000 | needs stage two |
| 2012 | approval | 75.066278 [75.014760, 76.995475] | 75.066278 | 0.000000 | 0.0000 | [75.014760, 76.056635] | +0.051517 | needs stage two |
| 2012 | air | 0.072677 [0.070805, 0.073749] | 0.072677 | 0.000000 | 0.0000 | [0.071204, 0.073749] | +0.001073 | needs stage two |
| 2012 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2013 | population | 154,050.000000 [151,950.000000, 154,203.000000] | 154,042.000000 | -8.000000 | -0.0052 | [152,509.500000, 154,203.000000] | +161.000000 | needs stage two |
| 2013 | approval | 76.718605 [76.329242, 78.138895] | 76.841502 | +0.122897 | +0.1602 | [76.329242, 77.623432] | +0.512260 | needs stage two |
| 2013 | air | 0.078534 [0.077714, 0.078771] | 0.078567 | +0.000033 | +0.0421 | [0.078005, 0.078771] | +0.000205 | needs stage two |
| 2013 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2014 | population | 172,301.000000 [170,539.000000, 173,724.000000] | 172,437.000000 | +136.000000 | +0.0789 | [170,577.990000, 173,724.000000] | +1287.000000 | needs stage two |
| 2014 | approval | 78.631323 [78.382138, 79.404951] | 78.492004 | -0.139318 | -0.1772 | [78.382138, 79.142729] | +0.109866 | needs stage two |
| 2014 | air | 0.086413 [0.083328, 0.087247] | 0.084840 | -0.001573 | -1.8205 | [0.084454, 0.087247] | +0.000386 | needs stage two |
| 2014 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2015 | population | 191,588.000000 [190,132.000000, 193,108.000000] | 191,771.000000 | +183.000000 | +0.0955 | [190,132.000000, 193,108.000000] | +1337.000000 | needs stage two |
| 2015 | approval | 81.365018 [80.906099, 81.556300] | 80.960871 | -0.404147 | -0.4967 | [81.039917, 81.556300] | -0.079046 | needs stage two |
| 2015 | air | 0.092873 [0.090884, 0.096493] | 0.093545 | +0.000672 | +0.7238 | [0.090884, 0.095678] | +0.002133 | needs stage two |
| 2015 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |

EQ ≥100 by year 15: highest annual ensemble median by that deadline is 103.5822 [100.4162, 104.4508] in 2015, pass.

Sampled-access consistency diagnostic: maximum |unemployment − (1 − stored access)| = 0.00070647 (control, 2015), within 0.02. The stored access is the last occupancy sample, not the fresh annual building-weighted access recomputation used by balance.test.ts; this diagnostic cannot certify G-UNEMP.

| Year | EQ median [min, max] | Realised I-HT share median (%) |
| --- | --- | ---: |
| 2010 | 80.0355 [78.9951, 80.2784] | 0.0000 |
| 2011 | 85.2588 [83.9507, 85.2964] | 0.0000 |
| 2012 | 90.0418 [89.1109, 90.0826] | 0.0000 |
| 2013 | 94.1994 [93.5644, 94.8755] | 0.0000 |
| 2014 | 99.0312 [97.4068, 99.9860] | 0.0000 |
| 2015 | 103.5822 [100.4162, 104.4508] | 0.0000 |

### Attentive base: 256x60_s7

Source commit: `a1a4e79e709e12a368af0645c3ac9dd50e9ac7f1`; summary: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/T044/base/256x60_s7_ensemble.summary.json`.

All annual values are median [minimum, maximum]; population is residents, approval is points, air is home air pollution (lower is cleaner), I-HT is percent of industrial jobs, and funds are § (from raw annual rows).

| Year (index) | Population | Approval | Air at homes | I-HT share (%) | Funds (§) |
| --- | --- | --- | --- | --- | --- |
| 2001 (1) | 3,589 [3,589, 3,589] | 51.902 [51.902, 51.902] | 0.014912 [0.014912, 0.014912] | 0.000 [0.000, 0.000] | 26,117 [26,017, 26,217] |
| 2002 (2) | 9,859 [9,859, 9,859] | 56.087 [56.087, 56.087] | 0.034126 [0.034126, 0.034126] | 0.000 [0.000, 0.000] | 26,710 [26,610, 26,810] |
| 2003 (3) | 17,676 [17,542, 17,676] | 47.322 [47.256, 47.322] | 0.046664 [0.043408, 0.046664] | 0.000 [0.000, 0.000] | 6,792 [6,692, 6,985] |
| 2004 (4) | 26,909 [26,610, 26,909] | 46.683 [46.362, 46.683] | 0.048554 [0.044741, 0.048554] | 0.000 [0.000, 0.000] | 8,651 [7,634, 8,651] |
| 2005 (5) | 36,040 [35,927, 36,243] | 46.238 [46.063, 47.279] | 0.049111 [0.046398, 0.052113] | 0.000 [0.000, 0.000] | 18,795 [16,404, 19,923] |
| 2006 (6) | 46,912 [46,868, 47,461] | 55.324 [52.661, 55.678] | 0.047427 [0.045771, 0.048626] | 0.000 [0.000, 0.000] | 38,124 [35,323, 39,194] |
| 2007 (7) | 59,034 [58,626, 59,679] | 59.298 [57.251, 60.469] | 0.049787 [0.048929, 0.051311] | 0.000 [0.000, 0.000] | 46,908 [38,410, 47,071] |
| 2008 (8) | 72,763 [72,000, 72,766] | 63.054 [61.752, 64.884] | 0.058175 [0.051542, 0.063033] | 0.000 [0.000, 0.000] | 54,915 [51,799, 56,373] |
| 2009 (9) | 85,695 [84,826, 85,796] | 65.530 [64.091, 65.822] | 0.081411 [0.071063, 0.084410] | 0.000 [0.000, 0.000] | 22,653 [21,700, 24,873] |
| 2010 (10) | 99,145 [98,274, 99,253] | 63.821 [62.177, 63.883] | 0.073985 [0.069956, 0.080263] | 0.000 [0.000, 0.000] | 42,371 [37,397, 49,716] |
| 2011 (11) | 112,884 [112,139, 113,394] | 62.116 [61.635, 63.223] | 0.069488 [0.060158, 0.070043] | 0.000 [0.000, 0.000] | 69,040 [60,182, 70,717] |
| 2012 (12) | 129,198 [127,207, 130,031] | 61.647 [61.051, 67.067] | 0.059017 [0.054756, 0.059056] | 0.000 [0.000, 0.000] | 86,509 [81,539, 90,491] |
| 2013 (13) | 145,600 [144,178, 146,526] | 64.357 [62.284, 67.789] | 0.059055 [0.054736, 0.060272] | 0.000 [0.000, 0.000] | 88,729 [87,209, 102,909] |
| 2014 (14) | 162,928 [160,481, 163,036] | 66.186 [64.598, 67.899] | 0.058504 [0.053068, 0.060113] | 0.000 [0.000, 0.000] | 112,450 [110,855, 115,958] |
| 2015 (15) | 181,680 [180,069, 182,416] | 69.001 [68.923, 69.390] | 0.055497 [0.052224, 0.056562] | 0.000 [0.000, 0.000] | 131,842 [130,814, 134,506] |
| 2016 (16) | 201,214 [199,101, 201,277] | 70.158 [69.924, 70.399] | 0.056679 [0.053782, 0.057891] | 0.000 [0.000, 0.000] | 136,129 [125,645, 147,592] |
| 2017 (17) | 220,381 [218,296, 221,442] | 70.052 [69.933, 70.146] | 0.058831 [0.052233, 0.065483] | 0.000 [0.000, 0.000] | 139,821 [139,796, 159,547] |
| 2018 (18) | 240,742 [239,254, 241,687] | 70.233 [69.032, 70.898] | 0.062029 [0.059492, 0.066286] | 0.000 [0.000, 0.000] | 184,558 [151,021, 184,646] |
| 2019 (19) | 262,067 [261,069, 263,768] | 71.338 [70.194, 72.065] | 0.058752 [0.054049, 0.065364] | 0.000 [0.000, 0.000] | 200,426 [182,796, 205,375] |
| 2020 (20) | 285,894 [282,700, 286,347] | 72.666 [71.941, 73.067] | 0.057073 [0.053616, 0.060977] | 0.000 [0.000, 0.000] | 238,509 [210,251, 241,323] |
| 2021 (21) | 308,509 [307,353, 310,009] | 73.683 [72.802, 76.084] | 0.056713 [0.054212, 0.064601] | 0.000 [0.000, 0.000] | 257,536 [253,865, 276,466] |
| 2022 (22) | 332,047 [331,199, 333,392] | 75.212 [74.511, 76.362] | 0.055524 [0.052819, 0.063817] | 0.000 [0.000, 0.000] | 305,898 [297,138, 343,077] |
| 2023 (23) | 356,475 [355,024, 357,690] | 75.111 [74.699, 77.268] | 0.058769 [0.057644, 0.062418] | 0.000 [0.000, 0.000] | 278,433 [273,465, 458,286] |
| 2024 (24) | 381,185 [379,189, 382,496] | 76.645 [74.918, 77.190] | 0.061446 [0.059493, 0.069171] | 0.000 [0.000, 0.000] | 577,279 [379,782, 750,381] |
| 2025 (25) | 406,217 [403,847, 407,670] | 77.061 [75.512, 77.459] | 0.061620 [0.061484, 0.071395] | 0.000 [0.000, 0.000] | 927,074 [675,300, 1,139,412] |
| 2026 (26) | 433,203 [431,870, 433,656] | 76.981 [74.879, 78.042] | 0.060840 [0.059768, 0.066289] | 0.000 [0.000, 0.000] | 1,388,708 [1,058,692, 1,599,296] |
| 2027 (27) | 461,642 [460,486, 462,507] | 77.341 [76.346, 78.388] | 0.063739 [0.061941, 0.070164] | 0.000 [0.000, 0.000] | 1,826,668 [1,425,061, 2,038,196] |
| 2028 (28) | 491,091 [490,397, 491,992] | 77.499 [76.592, 79.034] | 0.065835 [0.063335, 0.070303] | 0.000 [0.000, 0.000] | 2,444,152 [1,962,219, 2,643,793] |
| 2029 (29) | 521,424 [520,957, 522,863] | 78.080 [77.313, 79.495] | 0.067558 [0.066664, 0.075449] | 0.000 [0.000, 0.000] | 2,907,687 [2,328,027, 3,096,057] |
| 2030 (30) | 552,785 [552,018, 553,554] | 80.349 [79.345, 80.472] | 0.071652 [0.070037, 0.077409] | 0.000 [0.000, 0.000] | 3,465,020 [2,981,801, 3,487,712] |
| 2031 (31) | 584,111 [582,004, 586,398] | 81.475 [79.751, 82.136] | 0.076910 [0.076809, 0.083760] | 0.000 [0.000, 0.000] | 3,697,248 [3,647,225, 3,797,894] |
| 2032 (32) | 616,484 [614,727, 618,203] | 81.658 [80.262, 82.761] | 0.078881 [0.078110, 0.085885] | 0.000 [0.000, 0.000] | 3,973,669 [3,954,018, 4,203,239] |
| 2033 (33) | 647,633 [646,840, 650,233] | 82.157 [80.924, 82.809] | 0.086890 [0.084535, 0.095161] | 0.000 [0.000, 0.000] | 4,327,689 [4,263,173, 4,590,656] |
| 2034 (34) | 681,246 [678,637, 682,889] | 81.528 [80.660, 83.187] | 0.090624 [0.090067, 0.098190] | 0.000 [0.000, 0.000] | 4,759,746 [4,614,198, 4,841,157] |
| 2035 (35) | 714,573 [711,232, 715,901] | 81.957 [81.117, 83.040] | 0.096105 [0.093849, 0.101715] | 0.000 [0.000, 0.000] | 5,031,975 [4,995,430, 5,216,736] |
| 2036 (36) | 747,527 [744,257, 749,590] | 82.074 [80.745, 83.035] | 0.101743 [0.101340, 0.107632] | 0.000 [0.000, 0.000] | 5,500,708 [5,308,227, 5,727,998] |
| 2037 (37) | 779,885 [779,768, 785,272] | 82.535 [80.516, 82.904] | 0.112818 [0.107885, 0.119406] | 0.000 [0.000, 0.000] | 5,639,679 [5,603,392, 5,953,747] |
| 2038 (38) | 814,407 [814,066, 819,825] | 82.038 [79.899, 83.111] | 0.117786 [0.111762, 0.119857] | 0.000 [0.000, 0.000] | 5,997,947 [5,835,423, 6,329,011] |
| 2039 (39) | 850,689 [848,511, 853,016] | 81.359 [80.194, 82.742] | 0.123636 [0.122600, 0.128581] | 0.000 [0.000, 0.000] | 6,403,729 [6,063,480, 6,797,008] |
| 2040 (40) | 883,907 [883,598, 888,549] | 80.819 [80.007, 82.555] | 0.127975 [0.120072, 0.134304] | 0.000 [0.000, 0.000] | 6,843,391 [6,341,982, 7,298,707] |
| 2041 (41) | 918,669 [916,707, 924,671] | 81.379 [79.758, 82.919] | 0.134603 [0.129130, 0.138329] | 0.000 [0.000, 0.000] | 7,361,703 [6,668,072, 7,855,409] |
| 2042 (42) | 954,578 [952,372, 960,029] | 79.722 [79.599, 82.251] | 0.137536 [0.134989, 0.142727] | 0.000 [0.000, 0.000] | 7,917,529 [6,996,043, 8,470,281] |
| 2043 (43) | 989,396 [988,482, 994,912] | 80.387 [78.915, 81.735] | 0.142440 [0.141280, 0.149274] | 0.000 [0.000, 0.000] | 8,414,571 [7,242,888, 9,004,024] |
| 2044 (44) | 1,028,818 [1,025,935, 1,032,165] | 81.079 [78.745, 81.364] | 0.147906 [0.139421, 0.149243] | 0.000 [0.000, 0.000] | 8,998,223 [7,618,824, 9,707,065] |
| 2045 (45) | 1,066,933 [1,064,934, 1,070,502] | 81.133 [78.256, 81.327] | 0.151992 [0.146956, 0.157241] | 0.000 [0.000, 0.000] | 9,599,225 [7,981,009, 10,353,538] |
| 2046 (46) | 1,108,544 [1,103,545, 1,113,334] | 80.489 [78.419, 80.681] | 0.147840 [0.144011, 0.160241] | 0.000 [0.000, 0.000] | 10,188,990 [8,375,843, 11,046,005] |
| 2047 (47) | 1,146,762 [1,140,556, 1,149,250] | 80.422 [77.749, 80.620] | 0.155822 [0.151793, 0.166046] | 0.000 [0.000, 0.000] | 10,792,051 [8,776,891, 11,774,127] |
| 2048 (48) | 1,186,203 [1,180,896, 1,190,838] | 80.407 [78.525, 80.642] | 0.157015 [0.151831, 0.170810] | 0.000 [0.000, 0.000] | 11,386,584 [9,153,180, 12,502,159] |
| 2049 (49) | 1,225,053 [1,221,822, 1,229,432] | 80.412 [78.137, 80.429] | 0.160835 [0.154434, 0.170681] | 0.000 [0.000, 0.868] | 12,003,156 [9,555,746, 13,200,751] |
| 2050 (50) | 1,265,789 [1,264,792, 1,273,332] | 80.388 [77.868, 81.222] | 0.162557 [0.156867, 0.171280] | 0.586 [0.000, 1.600] | 12,640,458 [9,956,954, 13,943,378] |
| 2051 (51) | 1,309,512 [1,300,135, 1,314,235] | 79.841 [77.852, 80.662] | 0.166318 [0.158109, 0.170881] | 1.098 [0.614, 2.560] | 13,178,010 [10,363,396, 14,636,827] |
| 2052 (52) | 1,341,200 [1,324,745, 1,352,094] | 79.663 [77.398, 80.295] | 0.168003 [0.158931, 0.170246] | 1.654 [0.928, 3.859] | 13,799,475 [10,803,594, 15,350,463] |
| 2053 (53) | 1,358,324 [1,342,932, 1,393,943] | 79.994 [77.242, 80.669] | 0.170431 [0.161239, 0.174984] | 2.200 [2.036, 4.772] | 14,444,923 [11,253,794, 16,116,507] |
| 2054 (54) | 1,371,980 [1,365,359, 1,408,361] | 80.021 [77.596, 80.129] | 0.168137 [0.163606, 0.176213] | 3.880 [2.337, 7.340] | 15,122,756 [11,747,832, 16,911,151] |
| 2055 (55) | 1,391,948 [1,380,511, 1,427,520] | 80.047 [77.488, 80.624] | 0.168765 [0.163985, 0.177976] | 4.509 [3.181, 7.954] | 15,811,471 [12,266,071, 17,724,934] |
| 2056 (56) | 1,408,065 [1,402,949, 1,448,465] | 80.298 [77.519, 80.938] | 0.172608 [0.164648, 0.176257] | 5.393 [4.156, 8.285] | 16,525,920 [12,831,082, 18,556,478] |
| 2057 (57) | 1,416,826 [1,410,259, 1,463,731] | 80.565 [77.270, 81.064] | 0.176066 [0.162609, 0.179016] | 6.786 [4.857, 9.239] | 17,268,967 [13,385,035, 19,413,901] |
| 2058 (58) | 1,447,384 [1,429,556, 1,470,002] | 80.528 [78.354, 80.813] | 0.171140 [0.170746, 0.177704] | 7.575 [5.115, 10.185] | 18,022,326 [13,894,318, 20,294,249] |
| 2059 (59) | 1,460,488 [1,435,299, 1,487,593] | 80.540 [77.922, 80.753] | 0.176104 [0.173854, 0.182269] | 7.773 [5.696, 11.144] | 18,824,799 [14,431,391, 21,209,679] |
| 2060 (60) | 1,475,130 [1,442,195, 1,497,089] | 80.085 [77.987, 80.340] | 0.168693 [0.167628, 0.188395] | 7.418 [5.914, 12.107] | 19,657,263 [14,991,707, 22,136,332] |

#### Annual comparison with dev

`ihtShare` values and margins in this comparison use fractions (0.01 = one percentage point); the annual table above displays percent.

| Year | Metric | Dev median [min, max] | Lane median | Δmedian | Δ % | Passing interval | Margin to nearest boundary | Verdict |
| --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- |
| 2010 | population | 99,145.000000 [98,274.000000, 99,253.000000] | 99,145.000000 | 0.000000 | 0.0000 | [98,274.000000, 99,253.000000] | +108.000000 | needs stage two |
| 2010 | approval | 63.820762 [62.176938, 63.883086] | 63.820762 | 0.000000 | 0.0000 | [62.967688, 63.883086] | +0.062325 | needs stage two |
| 2010 | air | 0.073985 [0.069956, 0.080263] | 0.073985 | 0.000000 | 0.0000 | [0.069956, 0.079138] | +0.004029 | needs stage two |
| 2010 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2011 | population | 112,884.000000 [112,139.000000, 113,394.000000] | 112,884.000000 | 0.000000 | 0.0000 | [112,139.000000, 113,394.000000] | +510.000000 | needs stage two |
| 2011 | approval | 62.116397 [61.634752, 63.222933] | 62.116397 | 0.000000 | 0.0000 | [61.634752, 62.910488] | +0.481645 | needs stage two |
| 2011 | air | 0.069488 [0.060158, 0.070043] | 0.069488 | 0.000000 | 0.0000 | [0.064546, 0.070043] | +0.000555 | needs stage two |
| 2011 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2012 | population | 129,198.000000 [127,207.000000, 130,031.000000] | 129,198.000000 | 0.000000 | 0.0000 | [127,786.000000, 130,031.000000] | +833.000000 | needs stage two |
| 2012 | approval | 61.647176 [61.051415, 67.067037] | 61.647176 | 0.000000 | 0.0000 | [61.051415, 64.654987] | +0.595761 | needs stage two |
| 2012 | air | 0.059017 [0.054756, 0.059056] | 0.059017 | 0.000000 | 0.0000 | [0.056867, 0.059056] | +0.000039 | needs stage two |
| 2012 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2013 | population | 145,600.000000 [144,178.000000, 146,526.000000] | 145,600.000000 | 0.000000 | 0.0000 | [144,178.000000, 146,526.000000] | +926.000000 | needs stage two |
| 2013 | approval | 64.356822 [62.283970, 67.789260] | 64.356822 | 0.000000 | 0.0000 | [62.283970, 67.109467] | +2.072852 | needs stage two |
| 2013 | air | 0.059055 [0.054736, 0.060272] | 0.059055 | 0.000000 | 0.0000 | [0.056287, 0.060272] | +0.001217 | needs stage two |
| 2013 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2014 | population | 162,928.000000 [160,481.000000, 163,206.000000] | 162,928.000000 | 0.000000 | 0.0000 | [161,298.720000, 163,206.000000] | +278.000000 | needs stage two |
| 2014 | approval | 66.185627 [64.597766, 67.840531] | 66.185627 | 0.000000 | 0.0000 | [64.597766, 67.807010] | +1.587861 | needs stage two |
| 2014 | air | 0.058504 [0.053304, 0.060113] | 0.058504 | 0.000000 | 0.0000 | [0.055100, 0.060113] | +0.001609 | needs stage two |
| 2014 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2015 | population | 181,762.000000 [180,069.000000, 182,155.000000] | 181,680.000000 | -82.000000 | -0.0451 | [180,069.000000, 182,155.000000] | +475.000000 | needs stage two |
| 2015 | approval | 69.005076 [68.773662, 69.390379] | 69.001492 | -0.003585 | -0.0052 | [68.773662, 69.313435] | +0.227830 | needs stage two |
| 2015 | air | 0.056323 [0.052047, 0.056562] | 0.055497 | -0.000826 | -1.4673 | [0.054066, 0.056562] | +0.001065 | needs stage two |
| 2015 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2016 | population | 201,275.000000 [199,101.000000, 201,610.000000] | 201,214.000000 | -61.000000 | -0.0303 | [199,262.250000, 201,610.000000] | +396.000000 | needs stage two |
| 2016 | approval | 69.995104 [69.923649, 70.159887] | 70.157544 | +0.162440 | +0.2321 | [69.923649, 70.113223] | -0.044321 | needs stage two |
| 2016 | air | 0.055139 [0.052689, 0.057891] | 0.056679 | +0.001540 | +2.7930 | [0.052689, 0.057740] | +0.001061 | needs stage two |
| 2016 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2017 | population | 220,777.000000 [218,074.000000, 221,905.000000] | 220,381.000000 | -396.000000 | -0.1794 | [218,569.230000, 221,905.000000] | +1524.000000 | needs stage two |
| 2017 | approval | 69.517887 [69.418827, 70.685579] | 70.052415 | +0.534528 | +0.7689 | [69.418827, 70.151263] | +0.098848 | needs stage two |
| 2017 | air | 0.055313 [0.053499, 0.062004] | 0.058831 | +0.003518 | +6.3597 | [0.053499, 0.059566] | +0.000735 | needs stage two |
| 2017 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2018 | population | 241,134.000000 [239,141.000000, 242,093.000000] | 240,742.000000 | -392.000000 | -0.1626 | [239,141.000000, 242,093.000000] | +1351.000000 | needs stage two |
| 2018 | approval | 69.986378 [69.900462, 70.387907] | 70.233347 | +0.246969 | +0.3529 | [69.900462, 70.230101] | -0.003246 | needs stage two |
| 2018 | air | 0.057746 [0.053430, 0.063274] | 0.062029 | +0.004282 | +7.4158 | [0.053430, 0.062668] | +0.000640 | needs stage two |
| 2018 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2019 | population | 262,375.000000 [260,393.000000, 263,043.000000] | 262,067.000000 | -308.000000 | -0.1174 | [260,393.000000, 263,043.000000] | +976.000000 | needs stage two |
| 2019 | approval | 71.172907 [70.267119, 71.475497] | 71.337671 | +0.164764 | +0.2315 | [70.568718, 71.475497] | +0.137826 | needs stage two |
| 2019 | air | 0.055199 [0.053305, 0.068398] | 0.058752 | +0.003553 | +6.4361 | [0.053305, 0.062746] | +0.003994 | needs stage two |
| 2019 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2020 | population | 284,938.000000 [283,841.000000, 285,431.000000] | 285,894.000000 | +956.000000 | +0.3355 | [283,841.000000, 285,431.000000] | -463.000000 | needs stage two |
| 2020 | approval | 72.137169 [71.253657, 72.560776] | 72.666431 | +0.529262 | +0.7337 | [71.483610, 72.560776] | -0.105655 | needs stage two |
| 2020 | air | 0.054895 [0.052223, 0.059593] | 0.057073 | +0.002178 | +3.9674 | [0.052223, 0.058581] | +0.001507 | needs stage two |
| 2020 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2021 | population | 309,055.000000 [307,460.000000, 309,551.000000] | 308,509.000000 | -546.000000 | -0.1767 | [307,460.000000, 309,551.000000] | +1042.000000 | needs stage two |
| 2021 | approval | 72.755712 [72.411282, 73.958332] | 73.682601 | +0.926890 | +1.2740 | [72.411282, 73.529237] | -0.153365 | needs stage two |
| 2021 | air | 0.053670 [0.051048, 0.061836] | 0.056713 | +0.003043 | +5.6690 | [0.051048, 0.059064] | +0.002352 | needs stage two |
| 2021 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2022 | population | 332,599.000000 [330,779.000000, 332,670.000000] | 332,047.000000 | -552.000000 | -0.1660 | [330,779.000000, 332,670.000000] | +623.000000 | needs stage two |
| 2022 | approval | 75.431064 [75.335811, 76.370010] | 75.212179 | -0.218884 | -0.2902 | [75.335811, 75.948163] | -0.123632 | needs stage two |
| 2022 | air | 0.053252 [0.049979, 0.060831] | 0.055524 | +0.002271 | +4.2650 | [0.049979, 0.058679] | +0.003155 | needs stage two |
| 2022 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2023 | population | 356,659.000000 [354,200.000000, 357,442.000000] | 356,475.000000 | -184.000000 | -0.0516 | [354,200.000000, 357,442.000000] | +967.000000 | needs stage two |
| 2023 | approval | 76.342032 [76.228809, 76.951204] | 75.111187 | -1.230845 | -1.6123 | [76.228809, 76.703230] | -1.117622 | fail |
| 2023 | air | 0.053696 [0.050737, 0.062303] | 0.058769 | +0.005073 | +9.4476 | [0.050737, 0.059479] | +0.000710 | needs stage two |
| 2023 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2024 | population | 380,900.000000 [378,985.000000, 382,163.000000] | 381,185.000000 | +285.000000 | +0.0748 | [378,985.000000, 382,163.000000] | +978.000000 | needs stage two |
| 2024 | approval | 76.613249 [75.461401, 77.066149] | 76.645183 | +0.031935 | +0.0417 | [75.810875, 77.066149] | +0.420966 | needs stage two |
| 2024 | air | 0.057091 [0.052972, 0.069464] | 0.061446 | +0.004355 | +7.6286 | [0.052972, 0.065336] | +0.003891 | needs stage two |
| 2024 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2025 | population | 406,912.000000 [404,262.000000, 407,731.000000] | 406,217.000000 | -695.000000 | -0.1708 | [404,262.000000, 407,731.000000] | +1514.000000 | needs stage two |
| 2025 | approval | 76.847449 [76.499708, 77.127685] | 77.061272 | +0.213823 | +0.2782 | [76.533460, 77.127685] | +0.066413 | needs stage two |
| 2025 | air | 0.057857 [0.057252, 0.068183] | 0.061620 | +0.003763 | +6.5045 | [0.057252, 0.063322] | +0.001702 | needs stage two |
| 2025 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2026 | population | 433,030.000000 [431,806.000000, 433,598.000000] | 433,203.000000 | +173.000000 | +0.0400 | [431,806.000000, 433,598.000000] | +395.000000 | needs stage two |
| 2026 | approval | 76.505994 [76.057816, 77.201768] | 76.981421 | +0.475427 | +0.6214 | [76.057816, 77.077969] | +0.096549 | needs stage two |
| 2026 | air | 0.057841 [0.057654, 0.068149] | 0.060840 | +0.002999 | +5.1845 | [0.057654, 0.063088] | +0.002248 | needs stage two |
| 2026 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2027 | population | 461,632.000000 [460,757.000000, 461,953.000000] | 461,642.000000 | +10.000000 | +0.0022 | [460,757.000000, 461,953.000000] | +311.000000 | needs stage two |
| 2027 | approval | 77.763571 [77.626021, 78.209452] | 77.340594 | -0.422978 | -0.5439 | [77.626021, 78.055287] | -0.285427 | needs stage two |
| 2027 | air | 0.059288 [0.057955, 0.069490] | 0.063739 | +0.004451 | +7.5072 | [0.057955, 0.065056] | +0.001317 | needs stage two |
| 2027 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2028 | population | 491,442.000000 [489,700.000000, 491,659.000000] | 491,091.000000 | -351.000000 | -0.0714 | [489,700.000000, 491,659.000000] | +568.000000 | needs stage two |
| 2028 | approval | 77.587829 [77.382257, 78.730433] | 77.498930 | -0.088899 | -0.1146 | [77.382257, 78.261918] | +0.116674 | needs stage two |
| 2028 | air | 0.059841 [0.058058, 0.071302] | 0.065835 | +0.005994 | +10.0166 | [0.058058, 0.066462] | +0.000628 | needs stage two |
| 2028 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2029 | population | 522,372.000000 [519,724.000000, 522,937.000000] | 521,424.000000 | -948.000000 | -0.1815 | [519,724.000000, 522,937.000000] | +1513.000000 | needs stage two |
| 2029 | approval | 78.665187 [78.535559, 79.383321] | 78.080138 | -0.585050 | -0.7437 | [78.535559, 79.089068] | -0.455421 | fail |
| 2029 | air | 0.064652 [0.062519, 0.076648] | 0.067558 | +0.002907 | +4.4960 | [0.062519, 0.071716] | +0.004158 | needs stage two |
| 2029 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2030 | population | 553,169.000000 [550,399.000000, 553,583.000000] | 552,785.000000 | -384.000000 | -0.0694 | [550,399.000000, 553,583.000000] | +798.000000 | needs stage two |
| 2030 | approval | 79.881255 [79.457631, 80.374991] | 80.348676 | +0.467421 | +0.5851 | [79.457631, 80.339935] | -0.008741 | needs stage two |
| 2030 | air | 0.066296 [0.065754, 0.080134] | 0.071652 | +0.005356 | +8.0783 | [0.065754, 0.073486] | +0.001834 | needs stage two |
| 2030 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2031 | population | 584,845.000000 [580,940.000000, 585,610.000000] | 584,111.000000 | -734.000000 | -0.1255 | [580,940.000000, 585,610.000000] | +1499.000000 | needs stage two |
| 2031 | approval | 81.315454 [81.129592, 81.342604] | 81.474553 | +0.159099 | +0.1957 | [81.208948, 81.342604] | -0.131949 | fail |
| 2031 | air | 0.072051 [0.071388, 0.084402] | 0.076910 | +0.004859 | +6.7437 | [0.071388, 0.078558] | +0.001648 | needs stage two |
| 2031 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2032 | population | 616,271.000000 [613,290.000000, 617,395.000000] | 616,484.000000 | +213.000000 | +0.0346 | [613,290.000000, 617,395.000000] | +911.000000 | needs stage two |
| 2032 | approval | 81.870756 [81.378077, 82.205682] | 81.657508 | -0.213247 | -0.2605 | [81.456953, 82.205682] | +0.200555 | needs stage two |
| 2032 | air | 0.077794 [0.076235, 0.092153] | 0.078881 | +0.001086 | +1.3965 | [0.076235, 0.085753] | +0.002646 | needs stage two |
| 2032 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2033 | population | 649,520.000000 [645,810.000000, 649,727.000000] | 647,633.000000 | -1887.000000 | -0.2905 | [645,810.000000, 649,727.000000] | +1823.000000 | needs stage two |
| 2033 | approval | 82.187182 [81.906876, 82.403537] | 82.157027 | -0.030155 | -0.0367 | [81.938852, 82.403537] | +0.218175 | needs stage two |
| 2033 | air | 0.080268 [0.080073, 0.095025] | 0.086890 | +0.006622 | +8.2498 | [0.080073, 0.087745] | +0.000854 | needs stage two |
| 2033 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2034 | population | 681,383.000000 [678,863.000000, 681,622.000000] | 681,246.000000 | -137.000000 | -0.0201 | [678,863.000000, 681,622.000000] | +376.000000 | needs stage two |
| 2034 | approval | 81.876241 [81.811643, 82.721619] | 81.527590 | -0.348651 | -0.4258 | [81.811643, 82.331229] | -0.284053 | needs stage two |
| 2034 | air | 0.086293 [0.085412, 0.098408] | 0.090624 | +0.004331 | +5.0185 | [0.085412, 0.092791] | +0.002167 | needs stage two |
| 2034 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2035 | population | 715,266.000000 [711,503.000000, 715,283.000000] | 714,573.000000 | -693.000000 | -0.0969 | [711,503.000000, 715,283.000000] | +710.000000 | needs stage two |
| 2035 | approval | 82.538418 [82.118838, 82.611528] | 81.957189 | -0.581229 | -0.7042 | [82.292073, 82.611528] | -0.334884 | fail |
| 2035 | air | 0.090089 [0.088873, 0.106854] | 0.096105 | +0.006016 | +6.6779 | [0.088873, 0.099080] | +0.002975 | needs stage two |
| 2035 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2036 | population | 747,267.000000 [745,163.000000, 747,885.000000] | 747,527.000000 | +260.000000 | +0.0348 | [745,163.000000, 747,885.000000] | +358.000000 | needs stage two |
| 2036 | approval | 81.682529 [80.759698, 82.083129] | 82.073859 | +0.391330 | +0.4791 | [81.020814, 82.083129] | +0.009270 | needs stage two |
| 2036 | air | 0.098577 [0.096560, 0.112797] | 0.101743 | +0.003166 | +3.2120 | [0.096560, 0.106695] | +0.004952 | needs stage two |
| 2036 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2037 | population | 781,483.000000 [778,371.000000, 781,532.000000] | 779,885.000000 | -1598.000000 | -0.2045 | [778,371.000000, 781,532.000000] | +1514.000000 | needs stage two |
| 2037 | approval | 81.970203 [81.354525, 82.108048] | 82.534527 | +0.564324 | +0.6884 | [81.593441, 82.108048] | -0.426479 | fail |
| 2037 | air | 0.111185 [0.102756, 0.122397] | 0.112818 | +0.001633 | +1.4690 | [0.102756, 0.121006] | +0.008187 | needs stage two |
| 2037 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2038 | population | 816,400.000000 [814,131.000000, 818,087.000000] | 814,407.000000 | -1993.000000 | -0.2441 | [814,131.000000, 818,087.000000] | +276.000000 | needs stage two |
| 2038 | approval | 81.826328 [79.778988, 82.107769] | 82.038014 | +0.211686 | +0.2587 | [80.661937, 82.107769] | +0.069755 | needs stage two |
| 2038 | air | 0.113757 [0.111509, 0.132841] | 0.117786 | +0.004029 | +3.5416 | [0.111509, 0.124423] | +0.006277 | needs stage two |
| 2038 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2039 | population | 849,116.000000 [848,274.000000, 853,454.000000] | 850,689.000000 | +1573.000000 | +0.1853 | [848,274.000000, 853,454.000000] | +2415.000000 | needs stage two |
| 2039 | approval | 81.668064 [80.614922, 82.031813] | 81.359446 | -0.308618 | -0.3779 | [80.959619, 82.031813] | +0.399827 | needs stage two |
| 2039 | air | 0.117889 [0.117469, 0.138910] | 0.123636 | +0.005747 | +4.8749 | [0.117469, 0.128609] | +0.004973 | needs stage two |
| 2039 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2040 | population | 885,781.000000 [885,012.000000, 890,501.000000] | 883,907.000000 | -1874.000000 | -0.2116 | [885,012.000000, 890,501.000000] | -1105.000000 | needs stage two |
| 2040 | approval | 82.297853 [81.493797, 82.618616] | 80.819269 | -1.478584 | -1.7966 | [81.735443, 82.618616] | -0.916174 | fail |
| 2040 | air | 0.123398 [0.118367, 0.139514] | 0.127975 | +0.004578 | +3.7096 | [0.118367, 0.133971] | +0.005996 | needs stage two |
| 2040 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2041 | population | 922,651.000000 [917,818.000000, 928,329.000000] | 918,669.000000 | -3982.000000 | -0.4316 | [917,818.000000, 928,329.000000] | +851.000000 | needs stage two |
| 2041 | approval | 82.681145 [81.324393, 82.685078] | 81.378801 | -1.302344 | -1.5751 | [82.000803, 82.685078] | -0.622001 | needs stage two |
| 2041 | air | 0.125318 [0.121413, 0.143380] | 0.134603 | +0.009285 | +7.4089 | [0.121413, 0.136302] | +0.001699 | needs stage two |
| 2041 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2042 | population | 954,296.000000 [951,529.000000, 957,446.000000] | 954,578.000000 | +282.000000 | +0.0296 | [951,529.000000, 957,446.000000] | +2868.000000 | needs stage two |
| 2042 | approval | 81.731893 [80.841592, 82.063966] | 79.722010 | -2.009882 | -2.4591 | [81.120706, 82.063966] | -1.398695 | fail |
| 2042 | air | 0.131582 [0.128251, 0.147672] | 0.137536 | +0.005954 | +4.5253 | [0.128251, 0.141292] | +0.003756 | needs stage two |
| 2042 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2043 | population | 990,452.000000 [988,082.000000, 997,916.000000] | 989,396.000000 | -1056.000000 | -0.1066 | [988,082.000000, 997,916.000000] | +1314.000000 | needs stage two |
| 2043 | approval | 81.418462 [79.844569, 82.582742] | 80.387427 | -1.031035 | -1.2663 | [80.049376, 82.582742] | +0.338052 | needs stage two |
| 2043 | air | 0.132228 [0.130339, 0.155298] | 0.142440 | +0.010213 | +7.7236 | [0.130339, 0.144707] | +0.002267 | needs stage two |
| 2043 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2044 | population | 1,029,252.000000 [1,023,376.000000, 1,034,676.000000] | 1,028,818.000000 | -434.000000 | -0.0422 | [1,023,376.000000, 1,034,676.000000] | +5442.000000 | needs stage two |
| 2044 | approval | 81.409008 [80.009705, 81.507752] | 81.079197 | -0.329811 | -0.4051 | [80.659985, 81.507752] | +0.419213 | needs stage two |
| 2044 | air | 0.140589 [0.138826, 0.158979] | 0.147906 | +0.007317 | +5.2048 | [0.138826, 0.150666] | +0.002760 | needs stage two |
| 2044 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2045 | population | 1,066,213.000000 [1,064,870.000000, 1,072,615.000000] | 1,066,933.000000 | +720.000000 | +0.0675 | [1,064,870.000000, 1,072,615.000000] | +2063.000000 | needs stage two |
| 2045 | approval | 80.960145 [79.752094, 81.188186] | 81.132705 | +0.172559 | +0.2131 | [80.242100, 81.188186] | +0.055481 | needs stage two |
| 2045 | air | 0.145700 [0.143135, 0.160587] | 0.151992 | +0.006293 | +4.3190 | [0.143135, 0.154426] | +0.002433 | needs stage two |
| 2045 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2046 | population | 1,106,293.000000 [1,098,739.000000, 1,110,071.000000] | 1,108,544.000000 | +2251.000000 | +0.2035 | [1,098,739.000000, 1,110,071.000000] | +1527.000000 | needs stage two |
| 2046 | approval | 80.851248 [79.570483, 81.000507] | 80.489003 | -0.362246 | -0.4480 | [80.136236, 81.000507] | +0.352766 | needs stage two |
| 2046 | air | 0.150068 [0.144261, 0.166444] | 0.147840 | -0.002227 | -1.4841 | [0.144261, 0.161159] | +0.003579 | needs stage two |
| 2046 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2047 | population | 1,143,633.000000 [1,138,642.000000, 1,152,095.000000] | 1,146,762.000000 | +3129.000000 | +0.2736 | [1,138,642.000000, 1,152,095.000000] | +5333.000000 | needs stage two |
| 2047 | approval | 80.174809 [79.255457, 81.058885] | 80.422192 | +0.247383 | +0.3086 | [79.273095, 81.058885] | +0.636693 | needs stage two |
| 2047 | air | 0.147692 [0.147659, 0.167729] | 0.155822 | +0.008130 | +5.5048 | [0.147659, 0.157727] | +0.001905 | needs stage two |
| 2047 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2048 | population | 1,186,078.000000 [1,177,033.000000, 1,187,726.000000] | 1,186,203.000000 | +125.000000 | +0.0105 | [1,177,033.000000, 1,187,726.000000] | +1523.000000 | needs stage two |
| 2048 | approval | 80.462482 [79.896490, 80.868642] | 80.407500 | -0.054982 | -0.0683 | [79.976406, 80.868642] | +0.431094 | needs stage two |
| 2048 | air | 0.153370 [0.147753, 0.172724] | 0.157015 | +0.003645 | +2.3768 | [0.147753, 0.165855] | +0.008840 | needs stage two |
| 2048 | ihtShare | 0.000000 [0.000000, 0.001756] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000878] | 0.000000 | needs stage two |
| 2049 | population | 1,225,463.000000 [1,219,475.000000, 1,232,104.000000] | 1,225,053.000000 | -410.000000 | -0.0335 | [1,219,475.000000, 1,232,104.000000] | +5578.000000 | needs stage two |
| 2049 | approval | 80.748854 [78.807668, 80.951111] | 80.412130 | -0.336724 | -0.4170 | [79.677132, 80.951111] | +0.538981 | needs stage two |
| 2049 | air | 0.150475 [0.147350, 0.169690] | 0.160835 | +0.010360 | +6.8850 | [0.147350, 0.161645] | +0.000810 | needs stage two |
| 2049 | ihtShare | 0.000000 [0.000000, 0.013597] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.006799] | 0.000000 | needs stage two |
| 2050 | population | 1,265,741.000000 [1,260,949.000000, 1,271,588.000000] | 1,265,789.000000 | +48.000000 | +0.0038 | [1,260,949.000000, 1,271,588.000000] | +4840.000000 | needs stage two |
| 2050 | approval | 80.828233 [79.000162, 80.844737] | 80.387544 | -0.440689 | -0.5452 | [79.905945, 80.844737] | +0.457193 | needs stage two |
| 2050 | air | 0.155465 [0.154533, 0.177092] | 0.162557 | +0.007092 | +4.5620 | [0.154533, 0.166745] | +0.004187 | needs stage two |
| 2050 | ihtShare | 0.013611 [0.000000, 0.026688] | 0.005860 | -0.007750 | -56.9423 | [0.000267, 0.026688] | +0.005594 | needs stage two |
| 2051 | population | 1,306,287.000000 [1,299,862.000000, 1,310,245.000000] | 1,309,512.000000 | +3225.000000 | +0.2469 | [1,299,862.000000, 1,310,245.000000] | +733.000000 | needs stage two |
| 2051 | approval | 79.678009 [78.982008, 80.753433] | 79.841343 | +0.163334 | +0.2050 | [78.982008, 80.563721] | +0.722378 | needs stage two |
| 2051 | air | 0.164150 [0.152604, 0.178799] | 0.166318 | +0.002168 | +1.3209 | [0.152604, 0.177247] | +0.010929 | needs stage two |
| 2051 | ihtShare | 0.017711 [0.005922, 0.032300] | 0.010983 | -0.006729 | -37.9902 | [0.005922, 0.030900] | +0.005060 | needs stage two |
| 2052 | population | 1,342,501.000000 [1,317,983.000000, 1,347,980.000000] | 1,341,200.000000 | -1301.000000 | -0.0969 | [1,327,502.500000, 1,347,980.000000] | +6780.000000 | needs stage two |
| 2052 | approval | 80.437664 [78.740531, 80.636975] | 79.663212 | -0.774452 | -0.9628 | [79.489442, 80.636975] | +0.173770 | needs stage two |
| 2052 | air | 0.154957 [0.153368, 0.177894] | 0.168003 | +0.013046 | +8.4189 | [0.153368, 0.167220] | -0.000783 | needs stage two |
| 2052 | ihtShare | 0.025653 [0.008140, 0.039480] | 0.016539 | -0.009114 | -35.5266 | [0.009983, 0.039480] | +0.006556 | needs stage two |
| 2053 | population | 1,354,614.000000 [1,331,848.000000, 1,392,709.000000] | 1,358,324.000000 | +3710.000000 | +0.2739 | [1,331,848.000000, 1,385,044.500000] | +26476.000000 | needs stage two |
| 2053 | approval | 80.003464 [78.717138, 80.754847] | 79.993988 | -0.009476 | -0.0118 | [78.984610, 80.754847] | +0.760859 | needs stage two |
| 2053 | air | 0.164037 [0.155334, 0.174626] | 0.170431 | +0.006394 | +3.8977 | [0.155334, 0.173684] | +0.003253 | needs stage two |
| 2053 | ihtShare | 0.038940 [0.009565, 0.058838] | 0.022002 | -0.016937 | -43.4964 | [0.014303, 0.058838] | +0.007699 | needs stage two |
| 2054 | population | 1,374,323.000000 [1,341,305.000000, 1,413,703.000000] | 1,371,980.000000 | -2343.000000 | -0.1705 | [1,341,305.000000, 1,410,522.000000] | +30675.000000 | needs stage two |
| 2054 | approval | 80.593806 [78.744150, 81.011342] | 80.021170 | -0.572636 | -0.7105 | [79.460210, 81.011342] | +0.560960 | needs stage two |
| 2054 | air | 0.164130 [0.152679, 0.182994] | 0.168137 | +0.004007 | +2.4414 | [0.152679, 0.179288] | +0.011151 | needs stage two |
| 2054 | ihtShare | 0.053544 [0.023632, 0.074753] | 0.038805 | -0.014740 | -27.5281 | [0.027984, 0.074753] | +0.010821 | needs stage two |
| 2055 | population | 1,398,399.000000 [1,338,273.000000, 1,433,758.000000] | 1,391,948.000000 | -6451.000000 | -0.4613 | [1,350,656.500000, 1,433,758.000000] | +41291.500000 | needs stage two |
| 2055 | approval | 79.811388 [79.087660, 81.114600] | 80.047185 | +0.235798 | +0.2954 | [79.087660, 80.824858] | +0.777672 | needs stage two |
| 2055 | air | 0.165405 [0.156632, 0.175749] | 0.168765 | +0.003360 | +2.0312 | [0.156632, 0.174964] | +0.006199 | needs stage two |
| 2055 | ihtShare | 0.067656 [0.036659, 0.079996] | 0.045091 | -0.022565 | -33.3524 | [0.045988, 0.079996] | -0.000896 | needs stage two |
| 2056 | population | 1,419,186.000000 [1,351,622.000000, 1,455,861.000000] | 1,408,065.000000 | -11121.000000 | -0.7836 | [1,367,066.500000, 1,455,861.000000] | +40998.500000 | needs stage two |
| 2056 | approval | 80.066278 [79.069487, 81.022311] | 80.298402 | +0.232124 | +0.2899 | [79.089866, 81.022311] | +0.723910 | needs stage two |
| 2056 | air | 0.156350 [0.154205, 0.186111] | 0.172608 | +0.016258 | +10.3986 | [0.154205, 0.172303] | -0.000306 | needs stage two |
| 2056 | ihtShare | 0.083845 [0.055933, 0.096752] | 0.053927 | -0.029918 | -35.6829 | [0.063435, 0.096752] | -0.009509 | needs stage two |
| 2057 | population | 1,418,230.000000 [1,360,384.000000, 1,470,002.000000] | 1,416,826.000000 | -1404.000000 | -0.0990 | [1,363,421.000000, 1,470,002.000000] | +53176.000000 | needs stage two |
| 2057 | approval | 80.482607 [79.256702, 80.507911] | 80.564701 | +0.082094 | +0.1020 | [79.857003, 80.507911] | -0.056790 | needs stage two |
| 2057 | air | 0.170842 [0.153725, 0.181636] | 0.176066 | +0.005224 | +3.0580 | [0.156887, 0.181636] | +0.005569 | needs stage two |
| 2057 | ihtShare | 0.110236 [0.069570, 0.113109] | 0.067864 | -0.042371 | -38.4371 | [0.088466, 0.113109] | -0.020602 | needs stage two |
| 2058 | population | 1,442,416.000000 [1,363,572.000000, 1,488,790.000000] | 1,447,384.000000 | +4968.000000 | +0.3444 | [1,379,807.000000, 1,488,790.000000] | +41406.000000 | needs stage two |
| 2058 | approval | 80.091334 [79.768956, 80.926879] | 80.528386 | +0.437052 | +0.5457 | [79.768956, 80.670296] | +0.141910 | needs stage two |
| 2058 | air | 0.168051 [0.153829, 0.187011] | 0.171140 | +0.003089 | +1.8383 | [0.153829, 0.184642] | +0.013502 | needs stage two |
| 2058 | ihtShare | 0.123119 [0.083840, 0.129008] | 0.075753 | -0.047367 | -38.4722 | [0.100536, 0.129008] | -0.024783 | fail |
| 2059 | population | 1,447,648.000000 [1,372,983.000000, 1,504,810.000000] | 1,460,488.000000 | +12840.000000 | +0.8870 | [1,381,734.500000, 1,504,810.000000] | +44322.000000 | needs stage two |
| 2059 | approval | 79.883671 [79.446663, 80.662289] | 80.540480 | +0.656810 | +0.8222 | [79.446663, 80.491484] | -0.048997 | needs stage two |
| 2059 | air | 0.169666 [0.156110, 0.185163] | 0.176104 | +0.006438 | +3.7947 | [0.156110, 0.184193] | +0.008089 | needs stage two |
| 2059 | ihtShare | 0.122839 [0.093905, 0.128900] | 0.077731 | -0.045109 | -36.7218 | [0.105342, 0.128900] | -0.027611 | fail |
| 2060 | population | 1,461,087.000000 [1,379,922.000000, 1,513,835.000000] | 1,475,130.000000 | +14043.000000 | +0.9611 | [1,394,130.500000, 1,513,835.000000] | +38705.000000 | needs stage two |
| 2060 | approval | 80.357425 [79.739801, 80.541410] | 80.084679 | -0.272745 | -0.3394 | [79.956620, 80.541410] | +0.128059 | needs stage two |
| 2060 | air | 0.167190 [0.158303, 0.183209] | 0.168693 | +0.001502 | +0.8985 | [0.158303, 0.179643] | +0.010389 | needs stage two |
| 2060 | ihtShare | 0.126147 [0.102399, 0.137624] | 0.074176 | -0.051971 | -41.1988 | [0.108534, 0.137624] | -0.034358 | fail |

EQ ≥100 by year 30: highest annual ensemble median by that deadline is 122.3002 [119.9400, 122.5421] in 2030, pass.

Sampled-access consistency diagnostic: maximum |unemployment − (1 − stored access)| = 0.00056949 (p100-d1441, 2049), within 0.02. The stored access is the last occupancy sample, not the fresh annual building-weighted access recomputation used by balance.test.ts; this diagnostic cannot certify G-UNEMP.

| Year | EQ median [min, max] | Realised I-HT share median (%) |
| --- | --- | ---: |
| 2010 | 78.3618 [77.4370, 82.1735] | 0.0000 |
| 2011 | 82.3307 [80.0730, 85.5068] | 0.0000 |
| 2012 | 85.3983 [81.9408, 87.9330] | 0.0000 |
| 2013 | 87.7708 [83.4342, 89.8535] | 0.0000 |
| 2014 | 89.6519 [84.6317, 91.5101] | 0.0000 |
| 2015 | 91.2038 [85.9104, 93.1719] | 0.0000 |
| 2016 | 93.1567 [88.4605, 95.3911] | 0.0000 |
| 2017 | 95.5015 [91.3771, 97.7323] | 0.0000 |
| 2018 | 97.9673 [94.2649, 100.1031] | 0.0000 |
| 2019 | 100.1899 [96.8811, 102.4454] | 0.0000 |
| 2020 | 102.2959 [99.2907, 104.4386] | 0.0000 |
| 2021 | 105.7709 [101.8693, 107.1226] | 0.0000 |
| 2022 | 109.1688 [105.0297, 110.0205] | 0.0000 |
| 2023 | 112.0068 [108.0318, 112.4392] | 0.0000 |
| 2024 | 114.2104 [110.5648, 114.6044] | 0.0000 |
| 2025 | 116.0850 [112.6591, 116.4591] | 0.0000 |
| 2026 | 117.6993 [114.4187, 117.9245] | 0.0000 |
| 2027 | 119.0658 [115.9291, 119.0751] | 0.0000 |
| 2028 | 120.1870 [117.2818, 120.2397] | 0.0000 |
| 2029 | 121.2446 [118.5368, 121.3547] | 0.0000 |
| 2030 | 122.3002 [119.9400, 122.5421] | 0.0000 |
| 2031 | 123.2826 [121.1821, 123.5577] | 0.0000 |
| 2032 | 124.2995 [122.2235, 124.3747] | 0.0000 |
| 2033 | 125.0613 [123.0902, 125.2114] | 0.0000 |
| 2034 | 125.6857 [123.9129, 126.1215] | 0.0000 |
| 2035 | 126.2285 [124.7172, 127.0122] | 0.0000 |
| 2036 | 126.7910 [125.4966, 127.7769] | 0.0000 |
| 2037 | 127.3685 [126.2139, 128.4642] | 0.0000 |
| 2038 | 128.0290 [126.8931, 129.0904] | 0.0000 |
| 2039 | 128.5568 [127.4527, 129.6007] | 0.0000 |
| 2040 | 128.9262 [127.8934, 129.9499] | 0.0000 |
| 2041 | 129.1938 [128.2533, 130.1889] | 0.0000 |
| 2042 | 129.3216 [128.4748, 130.3013] | 0.0000 |
| 2043 | 129.3920 [128.5925, 130.3380] | 0.0000 |
| 2044 | 129.3537 [128.7515, 130.3050] | 0.0000 |
| 2045 | 129.2539 [129.0716, 130.4372] | 0.0000 |
| 2046 | 129.3733 [129.2616, 130.6617] | 0.0000 |
| 2047 | 129.6554 [129.2853, 130.8455] | 0.0000 |
| 2048 | 129.8854 [129.2393, 130.9215] | 0.0000 |
| 2049 | 130.0685 [129.1414, 130.9198] | 0.0000 |
| 2050 | 130.2049 [129.0909, 130.9011] | 0.5860 |
| 2051 | 130.3436 [129.0221, 130.9609] | 1.0983 |
| 2052 | 130.6904 [129.0225, 131.1003] | 1.6539 |
| 2053 | 131.0865 [129.0061, 131.3640] | 2.2002 |
| 2054 | 131.4604 [128.9057, 131.5635] | 3.8805 |
| 2055 | 131.7130 [128.8373, 131.7949] | 4.5091 |
| 2056 | 131.8989 [128.8596, 132.1390] | 5.3927 |
| 2057 | 131.9734 [128.9359, 132.4673] | 6.7864 |
| 2058 | 132.0053 [129.1368, 132.7396] | 7.5753 |
| 2059 | 132.0523 [129.4157, 132.9318] | 7.7731 |
| 2060 | 132.0797 [129.6609, 133.0441] | 7.4176 |

### Attentive base: 256x60_s11

Source commit: `a1a4e79e709e12a368af0645c3ac9dd50e9ac7f1`; summary: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/T044/base/256x60_s11_ensemble.summary.json`.

All annual values are median [minimum, maximum]; population is residents, approval is points, air is home air pollution (lower is cleaner), I-HT is percent of industrial jobs, and funds are § (from raw annual rows).

| Year (index) | Population | Approval | Air at homes | I-HT share (%) | Funds (§) |
| --- | --- | --- | --- | --- | --- |
| 2001 (1) | 3,634 [3,634, 3,634] | 51.167 [51.167, 51.167] | 0.012534 [0.012534, 0.012534] | 0.000 [0.000, 0.000] | 36,186 [36,086, 36,286] |
| 2002 (2) | 9,461 [9,461, 9,461] | 46.662 [46.662, 46.662] | 0.044620 [0.044620, 0.044620] | 0.000 [0.000, 0.000] | 56,953 [56,853, 57,053] |
| 2003 (3) | 17,370 [17,370, 17,370] | 45.493 [45.493, 45.493] | 0.056726 [0.056726, 0.056726] | 0.000 [0.000, 0.000] | 13,152 [13,052, 13,252] |
| 2004 (4) | 26,074 [25,970, 26,074] | 43.699 [42.704, 43.699] | 0.056504 [0.053914, 0.056504] | 0.000 [0.000, 0.000] | 8,899 [6,781, 8,899] |
| 2005 (5) | 34,606 [34,606, 34,718] | 42.833 [41.058, 42.833] | 0.054611 [0.051869, 0.058010] | 0.000 [0.000, 0.000] | 22,127 [14,838, 22,327] |
| 2006 (6) | 44,972 [44,070, 45,728] | 51.220 [49.580, 52.513] | 0.050478 [0.047833, 0.055892] | 0.000 [0.000, 0.000] | 36,646 [36,342, 38,003] |
| 2007 (7) | 57,137 [55,482, 57,352] | 56.700 [55.926, 57.234] | 0.049419 [0.043398, 0.051369] | 0.000 [0.000, 0.000] | 46,694 [42,560, 51,074] |
| 2008 (8) | 70,387 [68,790, 70,734] | 61.612 [58.062, 62.545] | 0.048664 [0.048573, 0.054746] | 0.000 [0.000, 0.000] | 56,148 [54,493, 57,768] |
| 2009 (9) | 83,746 [82,561, 83,910] | 64.986 [63.786, 66.784] | 0.066902 [0.061267, 0.070248] | 0.000 [0.000, 0.000] | 22,452 [21,603, 47,426] |
| 2010 (10) | 97,010 [96,079, 97,480] | 64.513 [63.077, 64.946] | 0.065350 [0.060648, 0.074170] | 0.000 [0.000, 0.000] | 30,222 [27,919, 46,650] |
| 2011 (11) | 111,220 [110,096, 111,424] | 63.400 [61.876, 64.042] | 0.059306 [0.055855, 0.064560] | 0.000 [0.000, 0.000] | 64,147 [54,169, 72,471] |
| 2012 (12) | 126,617 [125,601, 127,871] | 62.749 [61.992, 63.564] | 0.052582 [0.049713, 0.056295] | 0.000 [0.000, 0.000] | 85,764 [83,494, 89,635] |
| 2013 (13) | 143,996 [142,480, 145,099] | 63.484 [62.408, 64.495] | 0.051053 [0.048216, 0.055597] | 0.000 [0.000, 0.000] | 100,422 [88,227, 105,816] |
| 2014 (14) | 161,787 [159,429, 163,315] | 69.187 [64.807, 70.254] | 0.052570 [0.046243, 0.053721] | 0.000 [0.000, 0.000] | 112,959 [109,982, 115,833] |
| 2015 (15) | 181,906 [178,036, 182,069] | 71.110 [67.022, 71.496] | 0.051105 [0.045227, 0.057499] | 0.000 [0.000, 0.000] | 133,209 [132,205, 135,659] |
| 2016 (16) | 200,640 [198,907, 201,668] | 71.364 [70.407, 71.807] | 0.051700 [0.044553, 0.057711] | 0.000 [0.000, 0.000] | 148,250 [142,909, 150,532] |
| 2017 (17) | 219,844 [217,984, 221,094] | 71.400 [70.607, 71.889] | 0.055224 [0.049520, 0.059167] | 0.000 [0.000, 0.000] | 161,682 [139,753, 177,259] |
| 2018 (18) | 239,529 [238,087, 241,778] | 72.105 [70.824, 73.114] | 0.054966 [0.049512, 0.058528] | 0.000 [0.000, 0.000] | 182,768 [150,804, 189,514] |
| 2019 (19) | 261,512 [259,299, 264,440] | 73.071 [72.073, 73.705] | 0.053451 [0.051041, 0.055175] | 0.000 [0.000, 0.000] | 203,329 [170,704, 216,993] |
| 2020 (20) | 283,705 [281,141, 286,871] | 74.132 [72.803, 76.274] | 0.051787 [0.050378, 0.054555] | 0.000 [0.000, 0.000] | 232,130 [225,985, 248,134] |
| 2021 (21) | 308,038 [304,230, 309,703] | 76.295 [75.041, 78.114] | 0.052733 [0.050724, 0.055230] | 0.000 [0.000, 0.000] | 264,557 [251,014, 283,203] |
| 2022 (22) | 331,487 [327,632, 332,280] | 76.734 [76.190, 77.774] | 0.055217 [0.051398, 0.057743] | 0.000 [0.000, 0.000] | 307,875 [287,745, 355,894] |
| 2023 (23) | 354,942 [350,550, 356,216] | 77.056 [76.767, 77.636] | 0.057989 [0.056510, 0.061178] | 0.000 [0.000, 0.000] | 429,712 [345,606, 593,477] |
| 2024 (24) | 379,933 [375,711, 381,127] | 77.252 [76.762, 78.160] | 0.060092 [0.057481, 0.064096] | 0.000 [0.000, 0.000] | 749,337 [633,990, 960,741] |
| 2025 (25) | 404,995 [401,247, 406,468] | 77.935 [76.691, 78.530] | 0.062875 [0.061932, 0.066390] | 0.000 [0.000, 0.000] | 1,115,416 [989,523, 1,374,449] |
| 2026 (26) | 431,369 [427,262, 432,813] | 77.445 [76.507, 78.866] | 0.061600 [0.060757, 0.064673] | 0.000 [0.000, 0.000] | 1,582,708 [1,421,932, 1,867,369] |
| 2027 (27) | 459,638 [455,854, 460,555] | 77.963 [77.226, 78.136] | 0.062939 [0.062137, 0.069361] | 0.000 [0.000, 0.000] | 2,135,183 [1,834,264, 2,451,024] |
| 2028 (28) | 489,431 [484,875, 490,195] | 78.010 [77.048, 78.682] | 0.063094 [0.058873, 0.068527] | 0.000 [0.000, 0.000] | 2,677,567 [2,388,456, 2,978,625] |
| 2029 (29) | 520,007 [516,173, 521,138] | 80.325 [78.898, 82.021] | 0.065879 [0.061330, 0.071735] | 0.000 [0.000, 0.000] | 2,856,311 [2,805,235, 3,009,185] |
| 2030 (30) | 551,384 [546,564, 551,918] | 81.353 [80.440, 82.537] | 0.068498 [0.066466, 0.076871] | 0.000 [0.000, 0.000] | 3,330,767 [2,931,361, 3,423,632] |
| 2031 (31) | 582,815 [577,960, 583,812] | 82.299 [80.890, 83.090] | 0.074935 [0.067425, 0.078949] | 0.000 [0.000, 0.000] | 3,561,265 [3,102,902, 3,763,890] |
| 2032 (32) | 614,593 [609,526, 615,695] | 82.607 [80.770, 83.007] | 0.079168 [0.072637, 0.084975] | 0.000 [0.000, 0.000] | 3,821,977 [3,335,760, 4,162,800] |
| 2033 (33) | 646,482 [642,046, 647,410] | 82.884 [82.322, 83.464] | 0.081715 [0.075945, 0.088092] | 0.000 [0.000, 0.000] | 4,128,939 [3,607,596, 4,386,280] |
| 2034 (34) | 678,996 [672,979, 680,173] | 82.309 [81.645, 82.935] | 0.090979 [0.081582, 0.098088] | 0.000 [0.000, 0.000] | 4,513,080 [3,946,889, 4,674,484] |
| 2035 (35) | 711,347 [705,976, 713,449] | 82.945 [82.232, 83.257] | 0.090575 [0.085862, 0.101850] | 0.000 [0.000, 0.000] | 4,964,154 [4,364,879, 5,015,529] |
| 2036 (36) | 744,675 [739,001, 747,324] | 82.774 [81.917, 83.405] | 0.098473 [0.091646, 0.108895] | 0.000 [0.000, 0.000] | 5,315,221 [4,853,696, 5,422,818] |
| 2037 (37) | 780,002 [772,878, 781,089] | 82.815 [81.995, 83.302] | 0.106322 [0.095809, 0.112255] | 0.000 [0.000, 0.000] | 5,476,920 [5,236,882, 5,802,109] |
| 2038 (38) | 813,917 [808,347, 817,238] | 82.660 [82.199, 83.095] | 0.110256 [0.102789, 0.116908] | 0.000 [0.000, 0.000] | 5,700,329 [5,451,164, 6,275,620] |
| 2039 (39) | 849,059 [842,033, 851,527] | 82.693 [81.655, 83.340] | 0.118736 [0.113568, 0.122615] | 0.000 [0.000, 0.000] | 5,935,455 [5,709,441, 6,778,584] |
| 2040 (40) | 884,950 [877,830, 889,046] | 82.578 [81.844, 83.170] | 0.120422 [0.113293, 0.128265] | 0.000 [0.000, 0.000] | 6,237,580 [6,001,471, 7,338,005] |
| 2041 (41) | 920,072 [910,873, 920,765] | 82.266 [80.756, 83.046] | 0.128841 [0.117775, 0.133657] | 0.000 [0.000, 0.000] | 6,578,582 [6,348,676, 7,945,444] |
| 2042 (42) | 953,793 [949,524, 962,356] | 82.204 [80.924, 83.343] | 0.131975 [0.121401, 0.138668] | 0.000 [0.000, 0.000] | 6,949,845 [6,745,773, 8,460,730] |
| 2043 (43) | 990,733 [986,627, 1,000,305] | 82.162 [81.599, 82.489] | 0.136203 [0.121758, 0.147311] | 0.000 [0.000, 0.000] | 7,253,138 [7,079,319, 8,818,545] |
| 2044 (44) | 1,030,547 [1,024,994, 1,041,420] | 82.106 [81.519, 82.673] | 0.138639 [0.124688, 0.151498] | 0.000 [0.000, 0.000] | 7,613,793 [7,520,704, 9,174,732] |
| 2045 (45) | 1,064,129 [1,060,832, 1,075,783] | 81.380 [81.159, 82.117] | 0.146022 [0.128122, 0.157909] | 0.000 [0.000, 0.000] | 8,027,329 [7,932,891, 9,539,509] |
| 2046 (46) | 1,106,236 [1,095,621, 1,116,464] | 81.412 [80.376, 81.525] | 0.152205 [0.131222, 0.165619] | 0.000 [0.000, 0.000] | 8,542,877 [8,333,999, 9,912,785] |
| 2047 (47) | 1,146,800 [1,135,527, 1,153,972] | 81.462 [80.006, 81.802] | 0.157833 [0.136649, 0.165768] | 0.000 [0.000, 0.000] | 9,066,938 [8,758,325, 10,310,713] |
| 2048 (48) | 1,187,251 [1,175,610, 1,196,899] | 81.393 [80.536, 81.625] | 0.160782 [0.134751, 0.169182] | 0.000 [0.000, 0.000] | 9,611,360 [9,173,062, 10,723,385] |
| 2049 (49) | 1,226,712 [1,213,013, 1,235,638] | 81.153 [79.878, 81.685] | 0.161110 [0.137682, 0.176812] | 0.000 [0.000, 0.000] | 10,156,015 [9,584,154, 11,160,709] |
| 2050 (50) | 1,267,487 [1,259,855, 1,277,897] | 81.110 [80.016, 81.666] | 0.160017 [0.144011, 0.168771] | 0.000 [0.000, 0.428] | 10,708,989 [9,991,564, 11,602,546] |
| 2051 (51) | 1,309,300 [1,298,862, 1,319,741] | 80.491 [79.467, 81.243] | 0.167067 [0.140039, 0.175862] | 0.000 [0.000, 1.729] | 11,248,949 [10,379,136, 12,025,091] |
| 2052 (52) | 1,348,535 [1,333,883, 1,362,832] | 80.310 [80.031, 80.582] | 0.158802 [0.141787, 0.172991] | 0.913 [0.000, 2.235] | 11,779,844 [10,780,644, 12,485,317] |
| 2053 (53) | 1,388,969 [1,331,686, 1,407,324] | 80.871 [79.971, 81.662] | 0.170503 [0.141480, 0.177641] | 1.890 [0.000, 3.049] | 12,237,241 [11,189,055, 12,956,228] |
| 2054 (54) | 1,410,813 [1,334,808, 1,438,079] | 80.194 [79.996, 80.956] | 0.174634 [0.141861, 0.178438] | 2.582 [0.000, 4.328] | 12,590,125 [11,606,817, 13,435,804] |
| 2055 (55) | 1,435,078 [1,347,246, 1,460,217] | 80.114 [79.551, 81.517] | 0.174691 [0.144179, 0.181893] | 3.811 [0.000, 4.953] | 12,956,401 [12,018,715, 13,948,473] |
| 2056 (56) | 1,456,244 [1,357,297, 1,477,783] | 80.926 [79.694, 81.507] | 0.173429 [0.147033, 0.176947] | 4.687 [0.000, 6.991] | 13,315,035 [12,433,932, 14,489,997] |
| 2057 (57) | 1,468,728 [1,373,139, 1,488,945] | 80.632 [80.157, 81.692] | 0.172729 [0.144660, 0.185982] | 4.849 [0.000, 8.043] | 13,717,649 [12,846,090, 15,074,449] |
| 2058 (58) | 1,482,642 [1,377,115, 1,507,310] | 80.681 [80.198, 81.039] | 0.177122 [0.143259, 0.182736] | 5.886 [0.000, 10.131] | 14,146,704 [13,284,237, 15,678,779] |
| 2059 (59) | 1,491,935 [1,396,126, 1,525,060] | 80.975 [79.840, 81.589] | 0.170842 [0.140962, 0.177633] | 6.861 [0.000, 11.451] | 14,597,922 [13,752,069, 16,334,056] |
| 2060 (60) | 1,497,506 [1,394,907, 1,533,543] | 80.997 [79.952, 81.301] | 0.166606 [0.147147, 0.183150] | 8.438 [0.000, 12.286] | 15,038,951 [14,222,018, 17,116,636] |

#### Annual comparison with dev

`ihtShare` values and margins in this comparison use fractions (0.01 = one percentage point); the annual table above displays percent.

| Year | Metric | Dev median [min, max] | Lane median | Δmedian | Δ % | Passing interval | Margin to nearest boundary | Verdict |
| --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- |
| 2010 | population | 97,010.000000 [96,079.000000, 97,480.000000] | 97,010.000000 | 0.000000 | 0.0000 | [96,079.000000, 97,480.000000] | +470.000000 | needs stage two |
| 2010 | approval | 64.513165 [63.076939, 64.945794] | 64.513165 | 0.000000 | 0.0000 | [63.578738, 64.945794] | +0.432629 | needs stage two |
| 2010 | air | 0.065350 [0.060648, 0.074170] | 0.065350 | 0.000000 | 0.0000 | [0.060648, 0.072112] | +0.004703 | needs stage two |
| 2010 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2011 | population | 111,220.000000 [110,096.000000, 111,424.000000] | 111,220.000000 | 0.000000 | 0.0000 | [110,107.800000, 111,424.000000] | +204.000000 | needs stage two |
| 2011 | approval | 63.400353 [61.875781, 64.042029] | 63.400353 | 0.000000 | 0.0000 | [62.317229, 64.042029] | +0.641676 | needs stage two |
| 2011 | air | 0.059306 [0.055855, 0.064560] | 0.059306 | 0.000000 | 0.0000 | [0.055855, 0.063658] | +0.003451 | needs stage two |
| 2011 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2012 | population | 126,617.000000 [125,601.000000, 127,871.000000] | 126,617.000000 | 0.000000 | 0.0000 | [125,601.000000, 127,871.000000] | +1016.000000 | needs stage two |
| 2012 | approval | 62.749478 [61.992419, 63.563727] | 62.749478 | 0.000000 | 0.0000 | [61.992419, 63.535132] | +0.757059 | needs stage two |
| 2012 | air | 0.052582 [0.049713, 0.056295] | 0.052582 | 0.000000 | 0.0000 | [0.049713, 0.055874] | +0.002870 | needs stage two |
| 2012 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2013 | population | 143,996.000000 [142,480.000000, 145,099.000000] | 143,996.000000 | 0.000000 | 0.0000 | [142,556.040000, 145,099.000000] | +1103.000000 | needs stage two |
| 2013 | approval | 63.484358 [62.408336, 64.490766] | 63.484358 | 0.000000 | 0.0000 | [62.443143, 64.490766] | +1.006408 | needs stage two |
| 2013 | air | 0.051018 [0.048216, 0.055597] | 0.051053 | +0.000035 | +0.0681 | [0.048216, 0.054709] | +0.002837 | needs stage two |
| 2013 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2014 | population | 162,893.000000 [159,429.000000, 163,214.000000] | 161,787.000000 | -1106.000000 | -0.6790 | [161,000.500000, 163,214.000000] | +786.500000 | needs stage two |
| 2014 | approval | 69.792205 [64.807044, 70.235530] | 69.187479 | -0.604725 | -0.8665 | [67.077961, 70.235530] | +1.048051 | needs stage two |
| 2014 | air | 0.052255 [0.046244, 0.055484] | 0.052570 | +0.000315 | +0.6031 | [0.047634, 0.055484] | +0.002914 | needs stage two |
| 2014 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2015 | population | 181,910.000000 [178,036.000000, 182,428.000000] | 181,906.000000 | -4.000000 | -0.0022 | [179,714.000000, 182,428.000000] | +522.000000 | needs stage two |
| 2015 | approval | 70.282825 [67.021571, 71.146720] | 71.109612 | +0.826787 | +1.1764 | [68.220251, 71.146720] | +0.037108 | needs stage two |
| 2015 | air | 0.051467 [0.045746, 0.056549] | 0.051105 | -0.000362 | -0.7042 | [0.046066, 0.056549] | +0.005039 | needs stage two |
| 2015 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2016 | population | 201,032.000000 [198,931.000000, 202,147.000000] | 200,640.000000 | -392.000000 | -0.1950 | [199,021.680000, 202,147.000000] | +1507.000000 | needs stage two |
| 2016 | approval | 70.930926 [70.402550, 72.311562] | 71.364419 | +0.433493 | +0.6111 | [70.402550, 71.885432] | +0.521013 | needs stage two |
| 2016 | air | 0.052257 [0.044153, 0.056537] | 0.051700 | -0.000557 | -1.0661 | [0.046065, 0.056537] | +0.004836 | needs stage two |
| 2016 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2017 | population | 220,264.000000 [217,743.000000, 221,560.000000] | 219,844.000000 | -420.000000 | -0.1907 | [218,061.360000, 221,560.000000] | +1716.000000 | needs stage two |
| 2017 | approval | 71.746206 [70.174724, 72.371610] | 71.399595 | -0.346611 | -0.4831 | [70.647763, 72.371610] | +0.751833 | needs stage two |
| 2017 | air | 0.057306 [0.050383, 0.062885] | 0.055224 | -0.002082 | -3.6327 | [0.051055, 0.062885] | +0.004169 | needs stage two |
| 2017 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2018 | population | 240,111.000000 [238,125.000000, 242,039.000000] | 239,529.000000 | -582.000000 | -0.2424 | [238,125.000000, 242,039.000000] | +1404.000000 | needs stage two |
| 2018 | approval | 72.684918 [70.817567, 73.153183] | 72.104752 | -0.580167 | -0.7982 | [71.517110, 73.153183] | +0.587642 | needs stage two |
| 2018 | air | 0.056375 [0.050128, 0.060823] | 0.054966 | -0.001409 | -2.5001 | [0.051028, 0.060823] | +0.003938 | needs stage two |
| 2018 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2019 | population | 261,751.000000 [259,674.000000, 264,481.000000] | 261,512.000000 | -239.000000 | -0.0913 | [259,674.000000, 264,368.510000] | +1838.000000 | needs stage two |
| 2019 | approval | 73.669689 [72.031699, 74.323960] | 73.071277 | -0.598412 | -0.8123 | [72.523559, 74.323960] | +0.547718 | needs stage two |
| 2019 | air | 0.053989 [0.050402, 0.056052] | 0.053451 | -0.000538 | -0.9965 | [0.051164, 0.056052] | +0.002287 | needs stage two |
| 2019 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2020 | population | 284,274.000000 [281,689.000000, 287,234.000000] | 283,705.000000 | -569.000000 | -0.2002 | [281,689.000000, 287,116.740000] | +2016.000000 | needs stage two |
| 2020 | approval | 76.167959 [73.203061, 76.440492] | 74.131853 | -2.036105 | -2.6732 | [74.549243, 76.440492] | -0.417390 | needs stage two |
| 2020 | air | 0.052379 [0.049630, 0.055717] | 0.051787 | -0.000592 | -1.1302 | [0.049630, 0.055423] | +0.002157 | needs stage two |
| 2020 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2021 | population | 307,076.000000 [303,929.000000, 310,168.000000] | 308,038.000000 | +962.000000 | +0.3133 | [303,956.500000, 310,168.000000] | +2130.000000 | needs stage two |
| 2021 | approval | 76.941558 [75.184065, 77.754084] | 76.294586 | -0.646972 | -0.8409 | [75.656549, 77.754084] | +0.638037 | needs stage two |
| 2021 | air | 0.052368 [0.050657, 0.057203] | 0.052733 | +0.000365 | +0.6969 | [0.050657, 0.055641] | +0.002076 | needs stage two |
| 2021 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2022 | population | 331,951.000000 [327,213.000000, 333,566.000000] | 331,487.000000 | -464.000000 | -0.1398 | [328,631.490000, 333,566.000000] | +2079.000000 | needs stage two |
| 2022 | approval | 77.350545 [76.047912, 77.489004] | 76.734234 | -0.616310 | -0.7968 | [76.629999, 77.489004] | +0.104236 | needs stage two |
| 2022 | air | 0.055234 [0.052759, 0.058413] | 0.055217 | -0.000017 | -0.0305 | [0.052759, 0.058061] | +0.002457 | needs stage two |
| 2022 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2023 | population | 355,340.000000 [350,807.000000, 357,155.000000] | 354,942.000000 | -398.000000 | -0.1120 | [351,786.600000, 357,155.000000] | +2213.000000 | needs stage two |
| 2023 | approval | 77.643359 [76.288757, 77.933607] | 77.055966 | -0.587394 | -0.7565 | [76.820934, 77.933607] | +0.235032 | needs stage two |
| 2023 | air | 0.060053 [0.056769, 0.061164] | 0.057989 | -0.002063 | -3.4356 | [0.057855, 0.061164] | +0.000134 | needs stage two |
| 2023 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2024 | population | 380,475.000000 [375,374.000000, 381,880.000000] | 379,933.000000 | -542.000000 | -0.1425 | [376,670.250000, 381,880.000000] | +1947.000000 | needs stage two |
| 2024 | approval | 77.741437 [76.460377, 78.169196] | 77.252235 | -0.489202 | -0.6293 | [76.887027, 78.169196] | +0.365207 | needs stage two |
| 2024 | air | 0.061377 [0.059428, 0.065666] | 0.060092 | -0.001285 | -2.0936 | [0.059428, 0.064496] | +0.000665 | needs stage two |
| 2024 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2025 | population | 405,400.000000 [400,281.000000, 406,789.000000] | 404,995.000000 | -405.000000 | -0.0999 | [401,346.000000, 406,789.000000] | +1794.000000 | needs stage two |
| 2025 | approval | 77.182951 [76.264005, 78.004875] | 77.935232 | +0.752281 | +0.9747 | [76.312516, 78.004875] | +0.069643 | needs stage two |
| 2025 | air | 0.062958 [0.061731, 0.066890] | 0.062875 | -0.000083 | -0.1315 | [0.061731, 0.065537] | +0.001144 | needs stage two |
| 2025 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2026 | population | 431,885.000000 [426,244.000000, 432,624.000000] | 431,369.000000 | -516.000000 | -0.1195 | [427,566.150000, 432,624.000000] | +1255.000000 | needs stage two |
| 2026 | approval | 77.534774 [77.254944, 78.244625] | 77.444885 | -0.089889 | -0.1159 | [77.254944, 78.029615] | +0.189941 | needs stage two |
| 2026 | air | 0.066508 [0.061296, 0.067051] | 0.061600 | -0.004908 | -7.3792 | [0.063630, 0.067051] | -0.002030 | needs stage two |
| 2026 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2027 | population | 459,324.000000 [454,626.000000, 460,015.000000] | 459,638.000000 | +314.000000 | +0.0684 | [454,730.760000, 460,015.000000] | +377.000000 | needs stage two |
| 2027 | approval | 77.591061 [76.516536, 78.206701] | 77.962704 | +0.371643 | +0.4790 | [76.745978, 78.206701] | +0.243997 | needs stage two |
| 2027 | air | 0.065742 [0.061586, 0.069608] | 0.062939 | -0.002803 | -4.2638 | [0.061731, 0.069608] | +0.001208 | needs stage two |
| 2027 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2028 | population | 488,133.000000 [484,568.000000, 489,945.000000] | 489,431.000000 | +1298.000000 | +0.2659 | [484,568.000000, 489,945.000000] | +514.000000 | needs stage two |
| 2028 | approval | 78.133313 [77.765394, 80.159430] | 78.010362 | -0.122951 | -0.1574 | [77.765394, 79.330331] | +0.244967 | needs stage two |
| 2028 | air | 0.063036 [0.061107, 0.071639] | 0.063094 | +0.000058 | +0.0919 | [0.061107, 0.068302] | +0.001987 | needs stage two |
| 2028 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2029 | population | 518,809.000000 [515,169.000000, 520,829.000000] | 520,007.000000 | +1198.000000 | +0.2309 | [515,169.000000, 520,829.000000] | +822.000000 | needs stage two |
| 2029 | approval | 79.591075 [79.103651, 81.600923] | 80.325478 | +0.734402 | +0.9227 | [79.103651, 80.839711] | +0.514233 | needs stage two |
| 2029 | air | 0.067975 [0.063640, 0.075015] | 0.065879 | -0.002096 | -3.0833 | [0.063640, 0.073662] | +0.002239 | needs stage two |
| 2029 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2030 | population | 549,130.000000 [545,987.000000, 551,396.000000] | 551,384.000000 | +2254.000000 | +0.4105 | [545,987.000000, 551,396.000000] | +12.000000 | needs stage two |
| 2030 | approval | 81.440401 [80.101503, 81.633102] | 81.353314 | -0.087087 | -0.1069 | [80.674602, 81.633102] | +0.279788 | needs stage two |
| 2030 | air | 0.069741 [0.067781, 0.076904] | 0.068498 | -0.001244 | -1.7833 | [0.067781, 0.074303] | +0.000716 | needs stage two |
| 2030 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2031 | population | 579,744.000000 [577,395.000000, 582,733.000000] | 582,815.000000 | +3071.000000 | +0.5297 | [577,395.000000, 582,733.000000] | -82.000000 | needs stage two |
| 2031 | approval | 81.891147 [80.923480, 82.223214] | 82.298787 | +0.407641 | +0.4978 | [81.241280, 82.223214] | -0.075573 | needs stage two |
| 2031 | air | 0.074493 [0.070100, 0.083421] | 0.074935 | +0.000442 | +0.5933 | [0.070100, 0.081153] | +0.004835 | needs stage two |
| 2031 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2032 | population | 610,615.000000 [608,730.000000, 614,845.000000] | 614,593.000000 | +3978.000000 | +0.6515 | [608,730.000000, 614,845.000000] | +252.000000 | needs stage two |
| 2032 | approval | 81.981636 [81.539946, 82.386831] | 82.607268 | +0.625631 | +0.7631 | [81.558194, 82.386831] | -0.220437 | needs stage two |
| 2032 | air | 0.080018 [0.072419, 0.085898] | 0.079168 | -0.000850 | -1.0626 | [0.073279, 0.085898] | +0.005889 | needs stage two |
| 2032 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2033 | population | 643,353.000000 [641,046.000000, 647,575.000000] | 646,482.000000 | +3129.000000 | +0.4864 | [641,046.000000, 647,575.000000] | +1093.000000 | needs stage two |
| 2033 | approval | 82.237619 [81.444775, 83.172086] | 82.884272 | +0.646653 | +0.7863 | [81.444775, 83.101275] | +0.217003 | needs stage two |
| 2033 | air | 0.083733 [0.075798, 0.090831] | 0.081715 | -0.002018 | -2.4097 | [0.076216, 0.090831] | +0.005499 | needs stage two |
| 2033 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2034 | population | 675,552.000000 [671,270.000000, 679,334.000000] | 678,996.000000 | +3444.000000 | +0.5098 | [671,270.000000, 679,334.000000] | +338.000000 | needs stage two |
| 2034 | approval | 82.138529 [81.614885, 82.969450] | 82.309249 | +0.170720 | +0.2078 | [81.614885, 82.815812] | +0.506563 | needs stage two |
| 2034 | air | 0.086747 [0.082726, 0.101734] | 0.090979 | +0.004232 | +4.8788 | [0.082726, 0.096251] | +0.005272 | needs stage two |
| 2034 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2035 | population | 708,864.000000 [705,812.000000, 713,490.000000] | 711,347.000000 | +2483.000000 | +0.3503 | [705,812.000000, 713,490.000000] | +2143.000000 | needs stage two |
| 2035 | approval | 82.722366 [81.232581, 82.892147] | 82.944644 | +0.222277 | +0.2687 | [81.892583, 82.892147] | -0.052496 | needs stage two |
| 2035 | air | 0.097476 [0.085405, 0.100117] | 0.090575 | -0.006901 | -7.0800 | [0.090120, 0.100117] | +0.000455 | needs stage two |
| 2035 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2036 | population | 741,622.000000 [738,362.000000, 747,427.000000] | 744,675.000000 | +3053.000000 | +0.4117 | [738,362.000000, 747,427.000000] | +2752.000000 | needs stage two |
| 2036 | approval | 82.467216 [81.851181, 83.806878] | 82.774490 | +0.307274 | +0.3726 | [81.851181, 83.445065] | +0.670575 | needs stage two |
| 2036 | air | 0.100810 [0.091930, 0.107488] | 0.098473 | -0.002337 | -2.3182 | [0.093031, 0.107488] | +0.005442 | needs stage two |
| 2036 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2037 | population | 776,288.000000 [773,730.000000, 781,066.000000] | 780,002.000000 | +3714.000000 | +0.4784 | [773,730.000000, 781,066.000000] | +1064.000000 | needs stage two |
| 2037 | approval | 82.318161 [82.041069, 83.143764] | 82.815020 | +0.496860 | +0.6036 | [82.041069, 82.869508] | +0.054488 | needs stage two |
| 2037 | air | 0.103446 [0.098150, 0.113785] | 0.106322 | +0.002876 | +2.7801 | [0.098150, 0.111263] | +0.004942 | needs stage two |
| 2037 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2038 | population | 811,907.000000 [807,517.000000, 816,651.000000] | 813,917.000000 | +2010.000000 | +0.2476 | [807,517.000000, 816,651.000000] | +2734.000000 | needs stage two |
| 2038 | approval | 82.159211 [81.422337, 82.954038] | 82.659875 | +0.500664 | +0.6094 | [81.422337, 82.925062] | +0.265186 | needs stage two |
| 2038 | air | 0.108876 [0.102178, 0.119280] | 0.110256 | +0.001380 | +1.2671 | [0.102178, 0.117427] | +0.007171 | needs stage two |
| 2038 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2039 | population | 844,940.000000 [841,049.000000, 852,303.000000] | 849,059.000000 | +4119.000000 | +0.4875 | [841,049.000000, 852,303.000000] | +3244.000000 | needs stage two |
| 2039 | approval | 82.809094 [81.731416, 83.110195] | 82.692982 | -0.116112 | -0.1402 | [82.119704, 83.110195] | +0.417213 | needs stage two |
| 2039 | air | 0.117282 [0.107450, 0.126057] | 0.118736 | +0.001454 | +1.2400 | [0.107978, 0.126057] | +0.007321 | needs stage two |
| 2039 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2040 | population | 880,019.000000 [878,323.000000, 889,673.000000] | 884,950.000000 | +4931.000000 | +0.5603 | [878,323.000000, 888,819.190000] | +3869.190000 | needs stage two |
| 2040 | approval | 82.862490 [81.945484, 83.074749] | 82.577560 | -0.284930 | -0.3439 | [82.297858, 83.074749] | +0.279702 | needs stage two |
| 2040 | air | 0.121951 [0.113307, 0.129887] | 0.120422 | -0.001529 | -1.2534 | [0.113661, 0.129887] | +0.006761 | needs stage two |
| 2040 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2041 | population | 914,584.000000 [913,767.000000, 924,866.000000] | 920,072.000000 | +5488.000000 | +0.6001 | [913,767.000000, 923,729.840000] | +3657.840000 | needs stage two |
| 2041 | approval | 82.188403 [81.131021, 82.734103] | 82.266370 | +0.077967 | +0.0949 | [81.386862, 82.734103] | +0.467733 | needs stage two |
| 2041 | air | 0.124134 [0.123810, 0.142697] | 0.128841 | +0.004707 | +3.7916 | [0.123810, 0.133577] | +0.004737 | needs stage two |
| 2041 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2042 | population | 952,007.000000 [947,049.000000, 958,822.000000] | 953,793.000000 | +1786.000000 | +0.1876 | [947,049.000000, 958,822.000000] | +5029.000000 | needs stage two |
| 2042 | approval | 82.054087 [81.583607, 82.343733] | 82.204497 | +0.150410 | +0.1833 | [81.674024, 82.343733] | +0.139236 | needs stage two |
| 2042 | air | 0.130450 [0.126087, 0.144575] | 0.131975 | +0.001524 | +1.1686 | [0.126087, 0.139694] | +0.005888 | needs stage two |
| 2042 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2043 | population | 989,261.000000 [981,631.000000, 994,389.000000] | 990,733.000000 | +1472.000000 | +0.1488 | [981,631.000000, 994,389.000000] | +3656.000000 | needs stage two |
| 2043 | approval | 81.623809 [81.005473, 82.045369] | 82.162157 | +0.538348 | +0.6595 | [81.103861, 82.045369] | -0.116788 | needs stage two |
| 2043 | air | 0.135476 [0.129742, 0.146611] | 0.136203 | +0.000726 | +0.5362 | [0.129742, 0.143911] | +0.006461 | needs stage two |
| 2043 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2044 | population | 1,030,678.000000 [1,017,766.000000, 1,031,463.000000] | 1,030,547.000000 | -131.000000 | -0.0127 | [1,020,371.220000, 1,031,463.000000] | +916.000000 | needs stage two |
| 2044 | approval | 81.388593 [80.856138, 81.673885] | 82.105806 | +0.717213 | +0.8812 | [80.979719, 81.673885] | -0.431920 | fail |
| 2044 | air | 0.142595 [0.127841, 0.153304] | 0.138639 | -0.003956 | -2.7741 | [0.129863, 0.153304] | +0.008776 | needs stage two |
| 2044 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2045 | population | 1,068,216.000000 [1,055,287.000000, 1,072,401.000000] | 1,064,129.000000 | -4087.000000 | -0.3826 | [1,057,533.840000, 1,072,401.000000] | +6595.160000 | needs stage two |
| 2045 | approval | 80.946531 [80.582659, 81.367253] | 81.379903 | +0.433372 | +0.5354 | [80.582659, 81.338828] | -0.041075 | needs stage two |
| 2045 | air | 0.143253 [0.134717, 0.158265] | 0.146022 | +0.002769 | +1.9331 | [0.134717, 0.155027] | +0.009005 | needs stage two |
| 2045 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2046 | population | 1,109,143.000000 [1,094,324.000000, 1,109,943.000000] | 1,106,236.000000 | -2907.000000 | -0.2621 | [1,098,051.570000, 1,109,943.000000] | +3707.000000 | needs stage two |
| 2046 | approval | 81.023909 [80.386412, 81.392214] | 81.412249 | +0.388341 | +0.4793 | [80.521007, 81.392214] | -0.020035 | needs stage two |
| 2046 | air | 0.151972 [0.135720, 0.159906] | 0.152205 | +0.000233 | +0.1531 | [0.139878, 0.159906] | +0.007702 | needs stage two |
| 2046 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2047 | population | 1,144,048.000000 [1,132,339.000000, 1,151,307.000000] | 1,146,800.000000 | +2752.000000 | +0.2405 | [1,132,607.520000, 1,151,307.000000] | +4507.000000 | needs stage two |
| 2047 | approval | 80.577473 [79.541246, 81.876270] | 81.461891 | +0.884418 | +1.0976 | [79.541246, 81.744985] | +0.283094 | needs stage two |
| 2047 | air | 0.157108 [0.138410, 0.169139] | 0.157833 | +0.000724 | +0.4609 | [0.141744, 0.169139] | +0.011306 | needs stage two |
| 2047 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2048 | population | 1,186,527.000000 [1,169,316.000000, 1,187,525.000000] | 1,187,251.000000 | +724.000000 | +0.0610 | [1,174,661.730000, 1,187,525.000000] | +274.000000 | needs stage two |
| 2048 | approval | 80.481729 [79.779126, 81.478254] | 81.392876 | +0.911147 | +1.1321 | [79.779126, 81.331293] | -0.061583 | needs stage two |
| 2048 | air | 0.157149 [0.142597, 0.171809] | 0.160782 | +0.003633 | +2.3117 | [0.142597, 0.171755] | +0.010973 | needs stage two |
| 2048 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2049 | population | 1,225,495.000000 [1,209,924.000000, 1,233,587.000000] | 1,226,712.000000 | +1217.000000 | +0.0993 | [1,213,240.050000, 1,233,587.000000] | +6875.000000 | needs stage two |
| 2049 | approval | 80.271187 [79.830502, 81.248412] | 81.152906 | +0.881719 | +1.0984 | [79.830502, 80.980142] | -0.172764 | needs stage two |
| 2049 | air | 0.154546 [0.145553, 0.173847] | 0.161110 | +0.006564 | +4.2473 | [0.145553, 0.168694] | +0.007583 | needs stage two |
| 2049 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2050 | population | 1,262,250.000000 [1,254,073.000000, 1,272,103.000000] | 1,267,487.000000 | +5237.000000 | +0.4149 | [1,254,073.000000, 1,272,103.000000] | +4616.000000 | needs stage two |
| 2050 | approval | 80.438332 [79.830743, 80.949936] | 81.109687 | +0.671355 | +0.8346 | [79.878736, 80.949936] | -0.159750 | needs stage two |
| 2050 | air | 0.166178 [0.140626, 0.174208] | 0.160017 | -0.006161 | -3.7076 | [0.149387, 0.174208] | +0.010630 | needs stage two |
| 2050 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | needs stage two |
| 2051 | population | 1,307,156.000000 [1,295,571.000000, 1,313,026.000000] | 1,309,300.000000 | +2144.000000 | +0.1640 | [1,295,571.000000, 1,313,026.000000] | +3726.000000 | needs stage two |
| 2051 | approval | 80.367957 [79.663376, 80.641458] | 80.491411 | +0.123453 | +0.1536 | [79.878917, 80.641458] | +0.150047 | needs stage two |
| 2051 | air | 0.165859 [0.146473, 0.175127] | 0.167067 | +0.001208 | +0.7284 | [0.151532, 0.175127] | +0.008060 | needs stage two |
| 2051 | ihtShare | 0.001292 [0.000000, 0.010019] | 0.000000 | -0.001292 | -100.0000 | [0.000000, 0.006302] | 0.000000 | needs stage two |
| 2052 | population | 1,352,531.000000 [1,335,822.000000, 1,354,608.000000] | 1,348,535.000000 | -3996.000000 | -0.2954 | [1,339,005.690000, 1,354,608.000000] | +6073.000000 | needs stage two |
| 2052 | approval | 80.423260 [79.593908, 80.725192] | 80.310247 | -0.113013 | -0.1405 | [79.857617, 80.725192] | +0.414946 | needs stage two |
| 2052 | air | 0.166770 [0.143862, 0.180875] | 0.158802 | -0.007968 | -4.7778 | [0.148264, 0.180875] | +0.010538 | needs stage two |
| 2052 | ihtShare | 0.005203 [0.000000, 0.010891] | 0.009126 | +0.003924 | +75.4143 | [0.000000, 0.010648] | +0.001522 | needs stage two |
| 2053 | population | 1,387,290.000000 [1,372,356.000000, 1,392,815.000000] | 1,388,969.000000 | +1679.000000 | +0.1210 | [1,373,417.100000, 1,392,815.000000] | +3846.000000 | needs stage two |
| 2053 | approval | 80.648039 [79.313848, 81.177155] | 80.870742 | +0.222702 | +0.2761 | [79.716386, 81.177155] | +0.306413 | needs stage two |
| 2053 | air | 0.163511 [0.142825, 0.176662] | 0.170503 | +0.006993 | +4.2767 | [0.146592, 0.176662] | +0.006158 | needs stage two |
| 2053 | ihtShare | 0.016105 [0.000000, 0.024461] | 0.018903 | +0.002798 | +17.3740 | [0.003875, 0.024461] | +0.005558 | needs stage two |
| 2054 | population | 1,401,401.000000 [1,388,950.000000, 1,440,737.000000] | 1,410,813.000000 | +9412.000000 | +0.6716 | [1,388,950.000000, 1,427,294.500000] | +16481.500000 | needs stage two |
| 2054 | approval | 80.233846 [79.701350, 80.423610] | 80.194303 | -0.039544 | -0.0493 | [79.872716, 80.423610] | +0.229308 | needs stage two |
| 2054 | air | 0.164379 [0.143360, 0.175300] | 0.174634 | +0.010255 | +6.2386 | [0.148409, 0.175300] | +0.000666 | needs stage two |
| 2054 | ihtShare | 0.028798 [0.000000, 0.031626] | 0.025823 | -0.002975 | -10.3318 | [0.012985, 0.031626] | +0.005803 | needs stage two |
| 2055 | population | 1,426,671.000000 [1,386,414.000000, 1,464,302.000000] | 1,435,078.000000 | +8407.000000 | +0.5893 | [1,387,727.000000, 1,464,302.000000] | +29224.000000 | needs stage two |
| 2055 | approval | 80.413006 [79.930820, 80.954898] | 80.113884 | -0.299122 | -0.3720 | [79.930820, 80.925045] | +0.183064 | needs stage two |
| 2055 | air | 0.169315 [0.144886, 0.184044] | 0.174691 | +0.005376 | +3.1752 | [0.149736, 0.184044] | +0.009353 | needs stage two |
| 2055 | ihtShare | 0.028589 [0.000000, 0.040630] | 0.038106 | +0.009516 | +33.2860 | [0.008274, 0.040630] | +0.002524 | needs stage two |
| 2056 | population | 1,444,001.000000 [1,400,344.000000, 1,476,049.000000] | 1,456,244.000000 | +12243.000000 | +0.8479 | [1,406,148.500000, 1,476,049.000000] | +19805.000000 | needs stage two |
| 2056 | approval | 80.341350 [80.247446, 80.420853] | 80.926473 | +0.585123 | +0.7283 | [80.254646, 80.420853] | -0.505620 | fail |
| 2056 | air | 0.167834 [0.144752, 0.179428] | 0.173429 | +0.005595 | +3.3337 | [0.150495, 0.179428] | +0.006000 | needs stage two |
| 2056 | ihtShare | 0.043267 [0.000000, 0.049403] | 0.046869 | +0.003602 | +8.3243 | [0.018565, 0.049403] | +0.002535 | needs stage two |
| 2057 | population | 1,456,317.000000 [1,403,945.000000, 1,487,877.000000] | 1,468,728.000000 | +12411.000000 | +0.8522 | [1,414,351.000000, 1,487,877.000000] | +19149.000000 | needs stage two |
| 2057 | approval | 80.125557 [79.076655, 81.117180] | 80.631679 | +0.506123 | +0.6317 | [79.105294, 81.117180] | +0.485501 | needs stage two |
| 2057 | air | 0.173271 [0.145910, 0.186551] | 0.172729 | -0.000542 | -0.3126 | [0.152950, 0.186551] | +0.013822 | needs stage two |
| 2057 | ihtShare | 0.054729 [0.000000, 0.060559] | 0.048493 | -0.006236 | -11.3949 | [0.024449, 0.060559] | +0.012067 | needs stage two |
| 2058 | population | 1,462,768.000000 [1,414,561.000000, 1,491,046.000000] | 1,482,642.000000 | +19874.000000 | +1.3587 | [1,424,525.500000, 1,491,046.000000] | +8404.000000 | needs stage two |
| 2058 | approval | 80.053724 [79.518843, 80.798383] | 80.681317 | +0.627593 | +0.7840 | [79.518843, 80.693494] | +0.012177 | needs stage two |
| 2058 | air | 0.170178 [0.142471, 0.182266] | 0.177122 | +0.006944 | +4.0805 | [0.150281, 0.182266] | +0.005144 | needs stage two |
| 2058 | ihtShare | 0.058745 [0.000000, 0.076245] | 0.058859 | +0.000114 | +0.1945 | [0.020622, 0.076245] | +0.017387 | needs stage two |
| 2059 | population | 1,482,680.000000 [1,416,617.000000, 1,504,106.000000] | 1,491,935.000000 | +9255.000000 | +0.6242 | [1,438,935.500000, 1,504,106.000000] | +12171.000000 | needs stage two |
| 2059 | approval | 80.013219 [79.690658, 80.754018] | 80.975169 | +0.961950 | +1.2022 | [79.690658, 80.544899] | -0.430270 | needs stage two |
| 2059 | air | 0.162670 [0.147304, 0.182974] | 0.170842 | +0.008172 | +5.0239 | [0.147304, 0.180504] | +0.009662 | needs stage two |
| 2059 | ihtShare | 0.072264 [0.000000, 0.091036] | 0.068611 | -0.003653 | -5.0550 | [0.026746, 0.091036] | +0.022426 | needs stage two |
| 2060 | population | 1,483,518.000000 [1,427,340.000000, 1,503,201.000000] | 1,497,506.000000 | +13988.000000 | +0.9429 | [1,445,587.500000, 1,503,201.000000] | +5695.000000 | needs stage two |
| 2060 | approval | 80.441199 [79.137167, 81.356695] | 80.996946 | +0.555748 | +0.6909 | [79.331435, 81.356695] | +0.359748 | needs stage two |
| 2060 | air | 0.171517 [0.147485, 0.182562] | 0.166606 | -0.004911 | -2.8634 | [0.153979, 0.182562] | +0.012627 | needs stage two |
| 2060 | ihtShare | 0.081910 [0.000000, 0.103252] | 0.084382 | +0.002472 | +3.0179 | [0.030284, 0.103252] | +0.018870 | needs stage two |

EQ ≥100 by year 30: highest annual ensemble median by that deadline is 122.1059 [119.9693, 122.2362] in 2030, pass.

Sampled-access consistency diagnostic: maximum |unemployment − (1 − stored access)| = 0.00075424 (m100-d1, 2058), within 0.02. The stored access is the last occupancy sample, not the fresh annual building-weighted access recomputation used by balance.test.ts; this diagnostic cannot certify G-UNEMP.

| Year | EQ median [min, max] | Realised I-HT share median (%) |
| --- | --- | ---: |
| 2010 | 79.4160 [77.7520, 81.7339] | 0.0000 |
| 2011 | 83.2709 [80.8326, 85.5967] | 0.0000 |
| 2012 | 86.1910 [83.3205, 88.5760] | 0.0000 |
| 2013 | 88.6438 [85.3044, 90.9799] | 0.0000 |
| 2014 | 90.6791 [86.8402, 92.9959] | 0.0000 |
| 2015 | 92.8099 [88.3595, 94.7360] | 0.0000 |
| 2016 | 95.4111 [90.9282, 96.9313] | 0.0000 |
| 2017 | 98.1208 [94.1940, 99.2351] | 0.0000 |
| 2018 | 100.5064 [97.1508, 101.1788] | 0.0000 |
| 2019 | 102.6966 [99.6387, 102.9869] | 0.0000 |
| 2020 | 105.1550 [101.8153, 105.8215] | 0.0000 |
| 2021 | 107.8264 [104.0959, 108.7748] | 0.0000 |
| 2022 | 110.6220 [106.8228, 111.1753] | 0.0000 |
| 2023 | 112.7946 [109.4855, 113.3213] | 0.0000 |
| 2024 | 114.6663 [111.7255, 115.1851] | 0.0000 |
| 2025 | 116.3441 [113.5542, 116.7509] | 0.0000 |
| 2026 | 117.7989 [115.1102, 118.0368] | 0.0000 |
| 2027 | 118.9536 [116.4279, 119.1546] | 0.0000 |
| 2028 | 119.9165 [117.5643, 120.2076] | 0.0000 |
| 2029 | 120.9215 [118.5468, 121.2372] | 0.0000 |
| 2030 | 122.1059 [119.9693, 122.2362] | 0.0000 |
| 2031 | 122.9549 [121.4565, 123.4612] | 0.0000 |
| 2032 | 123.8427 [122.7309, 124.4778] | 0.0000 |
| 2033 | 124.6281 [123.7990, 125.3168] | 0.0000 |
| 2034 | 125.2859 [124.7522, 126.0027] | 0.0000 |
| 2035 | 125.9429 [125.5641, 126.5611] | 0.0000 |
| 2036 | 126.4805 [126.0613, 127.0269] | 0.0000 |
| 2037 | 127.1762 [126.6392, 127.5576] | 0.0000 |
| 2038 | 128.0921 [127.3628, 128.1565] | 0.0000 |
| 2039 | 128.5203 [128.0009, 128.9455] | 0.0000 |
| 2040 | 128.8545 [128.4412, 129.5382] | 0.0000 |
| 2041 | 129.1645 [128.7196, 129.9679] | 0.0000 |
| 2042 | 129.3911 [128.9163, 130.2204] | 0.0000 |
| 2043 | 129.4987 [129.0858, 130.3990] | 0.0000 |
| 2044 | 129.5701 [129.1588, 130.5487] | 0.0000 |
| 2045 | 129.6323 [129.2650, 130.8014] | 0.0000 |
| 2046 | 129.8242 [129.3155, 130.9996] | 0.0000 |
| 2047 | 130.0492 [129.3038, 131.1176] | 0.0000 |
| 2048 | 130.2065 [129.2574, 131.2460] | 0.0000 |
| 2049 | 130.3352 [129.2134, 131.2794] | 0.0000 |
| 2050 | 130.4643 [129.1083, 131.3037] | 0.0000 |
| 2051 | 130.5923 [129.0009, 131.4365] | 0.0000 |
| 2052 | 130.8153 [128.8387, 131.6122] | 0.9126 |
| 2053 | 131.0019 [128.7553, 131.8931] | 1.8903 |
| 2054 | 131.1649 [128.7127, 132.1623] | 2.5823 |
| 2055 | 131.2897 [128.6161, 132.4133] | 3.8106 |
| 2056 | 131.4439 [128.5520, 132.6017] | 4.6869 |
| 2057 | 131.5327 [128.4244, 132.7804] | 4.8493 |
| 2058 | 131.6132 [128.2742, 132.8932] | 5.8859 |
| 2059 | 131.7079 [128.1216, 133.0111] | 6.8611 |
| 2060 | 131.8083 [128.0522, 133.1816] | 8.4382 |

### `--skip dirty`: 128x15_s7

Source commit: `a1a4e79e709e12a368af0645c3ac9dd50e9ac7f1`; summary: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/T044/dirty/128x15_s7_ensemble.summary.json`.

All annual values are median [minimum, maximum]; population is residents, approval is points, air is home air pollution (lower is cleaner), I-HT is percent of industrial jobs, and funds are § (from raw annual rows).

| Year (index) | Population | Approval | Air at homes | I-HT share (%) | Funds (§) |
| --- | --- | --- | --- | --- | --- |
| 2001 (1) | 3,462 [3,462, 3,462] | 52.904 [52.904, 52.904] | 0.018114 [0.018114, 0.018114] | 0.000 [0.000, 0.000] | 36,136 [36,036, 36,236] |
| 2002 (2) | 9,205 [9,205, 9,205] | 54.479 [54.479, 54.479] | 0.024480 [0.024480, 0.024480] | 0.000 [0.000, 0.000] | 44,481 [44,381, 44,581] |
| 2003 (3) | 16,889 [16,799, 16,889] | 52.882 [52.882, 52.949] | 0.028029 [0.027887, 0.028029] | 0.000 [0.000, 0.000] | 5,547 [5,533, 7,247] |
| 2004 (4) | 22,080 [21,807, 22,080] | 52.631 [52.613, 52.697] | 0.030543 [0.029155, 0.030545] | 0.000 [0.000, 0.000] | 8,157 [7,576, 8,812] |
| 2005 (5) | 25,684 [25,621, 26,285] | 54.006 [53.669, 54.624] | 0.035089 [0.033262, 0.036590] | 0.000 [0.000, 0.000] | 24,998 [24,330, 25,700] |
| 2006 (6) | 32,423 [32,152, 33,450] | 58.268 [57.808, 58.574] | 0.040396 [0.038312, 0.043020] | 0.000 [0.000, 0.000] | 29,899 [25,204, 31,277] |
| 2007 (7) | 43,460 [42,939, 44,779] | 61.549 [61.101, 61.739] | 0.048423 [0.046110, 0.049421] | 0.000 [0.000, 0.000] | 38,288 [36,667, 40,833] |
| 2008 (8) | 54,766 [54,348, 56,073] | 63.077 [62.797, 63.282] | 0.049275 [0.048053, 0.052210] | 0.365 [0.000, 2.754] | 47,179 [44,413, 48,149] |
| 2009 (9) | 67,386 [66,709, 68,831] | 67.055 [66.706, 70.274] | 0.048697 [0.047609, 0.051201] | 9.896 [8.846, 13.435] | 56,953 [39,968, 58,298] |
| 2010 (10) | 81,559 [80,925, 83,002] | 73.988 [73.590, 74.454] | 0.049546 [0.048994, 0.052069] | 13.302 [12.073, 15.889] | 65,693 [64,961, 66,090] |
| 2011 (11) | 97,108 [96,458, 98,329] | 75.398 [75.299, 75.814] | 0.052940 [0.052395, 0.054997] | 17.272 [15.567, 18.677] | 76,635 [64,923, 82,816] |
| 2012 (12) | 113,486 [112,738, 115,125] | 76.523 [76.426, 77.141] | 0.055622 [0.055435, 0.060242] | 19.748 [17.542, 21.127] | 88,039 [72,955, 100,108] |
| 2013 (13) | 131,028 [130,406, 132,853] | 78.185 [77.520, 78.471] | 0.060143 [0.059436, 0.061345] | 18.095 [17.408, 19.779] | 110,409 [106,276, 123,449] |
| 2014 (14) | 148,713 [147,596, 150,919] | 80.740 [78.869, 81.707] | 0.064269 [0.062549, 0.064504] | 17.292 [16.567, 17.427] | 128,910 [113,839, 148,872] |
| 2015 (15) | 167,218 [167,059, 169,829] | 81.993 [80.611, 83.116] | 0.069058 [0.068034, 0.069547] | 16.225 [15.042, 17.222] | 169,857 [126,013, 228,639] |

### `--skip dirty`: 256x60_s7

Source commit: `a1a4e79e709e12a368af0645c3ac9dd50e9ac7f1`; summary: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/stages/5/T044/dirty/256x60_s7_ensemble.summary.json`.

All annual values are median [minimum, maximum]; population is residents, approval is points, air is home air pollution (lower is cleaner), I-HT is percent of industrial jobs, and funds are § (from raw annual rows).

| Year (index) | Population | Approval | Air at homes | I-HT share (%) | Funds (§) |
| --- | --- | --- | --- | --- | --- |
| 2001 (1) | 3,462 [3,462, 3,462] | 51.794 [51.794, 51.794] | 0.014496 [0.014496, 0.014496] | 0.000 [0.000, 0.000] | 31,458 [31,358, 31,558] |
| 2002 (2) | 9,142 [9,142, 9,142] | 52.847 [52.847, 52.847] | 0.030188 [0.030188, 0.030188] | 0.000 [0.000, 0.000] | 47,495 [47,395, 47,595] |
| 2003 (3) | 16,522 [16,522, 16,522] | 49.569 [49.569, 49.569] | 0.034480 [0.034480, 0.034480] | 0.000 [0.000, 0.000] | 6,034 [5,934, 6,134] |
| 2004 (4) | 20,352 [20,208, 20,352] | 46.804 [46.804, 48.894] | 0.034591 [0.034591, 0.035135] | 0.000 [0.000, 0.000] | 7,554 [7,059, 7,554] |
| 2005 (5) | 23,866 [23,256, 23,886] | 51.113 [50.846, 51.643] | 0.035732 [0.035522, 0.036559] | 0.000 [0.000, 0.000] | 21,249 [20,944, 23,318] |
| 2006 (6) | 29,823 [29,772, 30,094] | 56.382 [56.293, 57.227] | 0.037842 [0.036322, 0.041959] | 0.000 [0.000, 0.000] | 28,406 [27,683, 30,489] |
| 2007 (7) | 39,238 [38,862, 40,002] | 60.038 [59.181, 61.056] | 0.044645 [0.042996, 0.047561] | 0.000 [0.000, 0.000] | 33,780 [31,972, 34,840] |
| 2008 (8) | 50,669 [50,111, 51,334] | 62.023 [60.458, 62.576] | 0.049025 [0.048859, 0.050713] | 0.000 [0.000, 0.000] | 42,675 [34,210, 44,241] |
| 2009 (9) | 62,095 [62,069, 63,392] | 62.086 [60.010, 65.802] | 0.047628 [0.047396, 0.052172] | 11.131 [8.804, 14.765] | 41,802 [33,402, 43,155] |
| 2010 (10) | 74,742 [74,532, 76,054] | 65.780 [64.900, 67.694] | 0.050378 [0.048164, 0.052353] | 14.098 [10.049, 21.914] | 38,360 [36,237, 58,864] |
| 2011 (11) | 87,649 [87,559, 89,201] | 66.616 [64.408, 67.908] | 0.049482 [0.045955, 0.050499] | 13.855 [9.760, 26.882] | 50,027 [44,706, 65,578] |
| 2012 (12) | 102,347 [101,545, 103,195] | 68.221 [67.163, 69.408] | 0.047231 [0.045345, 0.049365] | 13.681 [8.762, 26.870] | 72,230 [66,972, 77,052] |
| 2013 (13) | 117,320 [117,015, 118,592] | 69.744 [68.430, 70.861] | 0.046197 [0.044661, 0.048779] | 13.152 [8.724, 25.328] | 75,880 [75,227, 91,023] |
| 2014 (14) | 133,332 [133,285, 134,687] | 70.911 [70.787, 71.590] | 0.043022 [0.041224, 0.046649] | 13.122 [8.670, 24.553] | 106,524 [93,345, 107,833] |
| 2015 (15) | 150,538 [149,250, 151,442] | 70.853 [70.028, 71.277] | 0.042211 [0.039589, 0.045688] | 13.021 [8.653, 22.661] | 108,851 [107,076, 121,838] |
| 2016 (16) | 168,643 [167,009, 169,355] | 71.254 [70.952, 72.148] | 0.040770 [0.039801, 0.044198] | 13.062 [8.644, 22.522] | 121,449 [119,311, 134,465] |
| 2017 (17) | 187,205 [185,609, 187,875] | 71.614 [71.365, 72.608] | 0.039903 [0.039619, 0.044693] | 13.095 [8.630, 22.861] | 147,931 [125,629, 157,488] |
| 2018 (18) | 206,317 [204,035, 206,642] | 72.175 [71.023, 72.811] | 0.039633 [0.037865, 0.041898] | 13.061 [8.599, 22.804] | 171,618 [140,959, 180,303] |
| 2019 (19) | 226,157 [224,035, 226,997] | 72.115 [72.061, 73.610] | 0.039021 [0.037858, 0.041892] | 13.045 [8.648, 22.759] | 193,800 [158,310, 198,911] |
| 2020 (20) | 246,947 [245,205, 248,039] | 74.244 [73.332, 75.049] | 0.039427 [0.037621, 0.041572] | 13.050 [8.642, 22.786] | 222,797 [180,123, 228,162] |
| 2021 (21) | 268,755 [267,381, 270,188] | 76.463 [76.371, 77.057] | 0.040213 [0.037672, 0.042677] | 13.048 [8.675, 22.816] | 258,329 [247,161, 283,609] |
| 2022 (22) | 291,265 [289,495, 292,680] | 76.600 [75.583, 77.748] | 0.041186 [0.037388, 0.045847] | 13.072 [8.691, 22.847] | 257,220 [230,011, 384,582] |
| 2023 (23) | 314,284 [311,754, 314,312] | 77.574 [76.365, 77.945] | 0.043151 [0.040727, 0.046007] | 13.044 [8.701, 22.854] | 361,525 [303,853, 730,273] |
| 2024 (24) | 337,609 [335,559, 338,216] | 77.557 [77.038, 78.271] | 0.046630 [0.041731, 0.047630] | 13.008 [8.684, 22.812] | 669,611 [597,945, 1,090,210] |
| 2025 (25) | 361,523 [359,396, 362,824] | 77.083 [76.488, 77.962] | 0.047501 [0.043501, 0.049604] | 13.079 [8.678, 22.814] | 1,002,237 [940,912, 1,474,325] |
| 2026 (26) | 386,809 [383,318, 388,182] | 77.651 [75.678, 78.331] | 0.047802 [0.044810, 0.050307] | 13.045 [8.695, 23.046] | 1,341,142 [1,303,159, 1,833,399] |
| 2027 (27) | 412,994 [410,420, 415,258] | 77.869 [76.946, 78.682] | 0.048634 [0.044787, 0.049588] | 13.003 [8.699, 19.419] | 1,805,840 [1,737,250, 2,408,943] |
| 2028 (28) | 441,125 [438,224, 444,560] | 78.299 [77.231, 80.870] | 0.051006 [0.046627, 0.052886] | 12.601 [8.213, 17.959] | 2,386,952 [2,317,293, 2,758,318] |
| 2029 (29) | 470,346 [467,391, 473,220] | 79.498 [79.425, 81.725] | 0.055821 [0.049824, 0.056855] | 12.608 [8.197, 17.964] | 2,938,538 [2,894,651, 2,987,508] |
| 2030 (30) | 500,249 [496,635, 503,176] | 81.636 [80.706, 82.093] | 0.059309 [0.053476, 0.060748] | 11.643 [8.032, 17.224] | 2,901,892 [2,877,637, 3,107,530] |
| 2031 (31) | 530,801 [527,827, 533,834] | 82.171 [81.880, 82.635] | 0.061155 [0.056090, 0.064456] | 11.630 [8.055, 16.370] | 3,084,166 [3,081,405, 3,182,665] |
| 2032 (32) | 562,291 [558,995, 564,815] | 82.685 [82.070, 82.844] | 0.064438 [0.060948, 0.068811] | 10.545 [8.062, 16.276] | 3,326,214 [3,324,841, 3,427,841] |
| 2033 (33) | 594,501 [590,160, 596,171] | 82.928 [81.866, 83.202] | 0.069689 [0.063727, 0.074124] | 7.982 [7.879, 15.069] | 3,627,922 [3,599,790, 3,685,746] |
| 2034 (34) | 626,554 [621,673, 628,010] | 83.011 [82.538, 83.545] | 0.074927 [0.071158, 0.078034] | 6.588 [5.771, 15.174] | 3,995,373 [3,954,411, 4,051,346] |
| 2035 (35) | 658,052 [653,584, 659,255] | 82.826 [82.531, 83.056] | 0.080245 [0.074620, 0.083868] | 8.496 [5.341, 15.563] | 4,388,107 [4,382,352, 4,491,538] |
| 2036 (36) | 690,814 [685,959, 692,542] | 83.351 [82.920, 83.642] | 0.085656 [0.082264, 0.094088] | 15.492 [4.293, 15.624] | 4,629,301 [4,622,048, 4,795,124] |
| 2037 (37) | 723,525 [718,860, 725,666] | 82.880 [82.493, 83.909] | 0.090854 [0.087400, 0.095028] | 16.853 [2.421, 19.031] | 4,911,142 [4,894,876, 5,231,965] |
| 2038 (38) | 756,796 [752,369, 760,498] | 82.992 [82.534, 83.428] | 0.095708 [0.094709, 0.101331] | 15.212 [3.038, 20.617] | 5,213,813 [5,209,836, 5,486,779] |
| 2039 (39) | 789,673 [786,791, 793,329] | 82.715 [81.813, 83.438] | 0.104607 [0.099401, 0.109020] | 14.081 [2.542, 21.162] | 5,562,898 [5,535,506, 5,732,035] |
| 2040 (40) | 824,296 [821,007, 827,544] | 82.220 [81.873, 82.400] | 0.108986 [0.105284, 0.114881] | 15.297 [2.208, 25.205] | 5,971,752 [5,905,274, 6,075,855] |
| 2041 (41) | 858,243 [854,306, 864,113] | 81.949 [81.942, 82.793] | 0.114650 [0.111111, 0.124150] | 19.114 [1.956, 25.466] | 6,417,040 [6,312,456, 6,543,699] |
| 2042 (42) | 894,181 [890,101, 900,961] | 82.101 [81.735, 83.206] | 0.117366 [0.116442, 0.134367] | 23.396 [4.219, 28.331] | 6,904,736 [6,699,146, 6,910,400] |
| 2043 (43) | 930,029 [927,736, 937,088] | 82.019 [81.206, 83.162] | 0.129592 [0.121539, 0.134708] | 26.767 [11.400, 30.706] | 7,293,364 [7,150,322, 7,446,819] |
| 2044 (44) | 969,505 [967,589, 975,088] | 81.712 [81.703, 82.786] | 0.130561 [0.128316, 0.131458] | 30.345 [16.881, 33.073] | 7,858,972 [7,699,441, 8,004,386] |
| 2045 (45) | 1,005,563 [1,004,384, 1,015,020] | 81.483 [81.145, 82.833] | 0.140200 [0.137122, 0.140943] | 33.090 [21.799, 34.887] | 8,423,496 [8,276,046, 8,628,194] |
| 2046 (46) | 1,047,030 [1,043,003, 1,053,032] | 81.666 [80.961, 82.466] | 0.138228 [0.135734, 0.148454] | 34.116 [25.582, 36.990] | 9,032,889 [8,834,111, 9,245,190] |
| 2047 (47) | 1,086,210 [1,081,604, 1,087,865] | 81.400 [81.176, 81.853] | 0.146719 [0.140411, 0.153154] | 36.235 [27.805, 36.661] | 9,635,602 [9,389,825, 9,889,878] |
| 2048 (48) | 1,119,922 [1,119,639, 1,127,894] | 80.454 [78.920, 81.617] | 0.152741 [0.137746, 0.157636] | 36.106 [26.242, 36.710] | 10,304,960 [10,009,888, 10,570,210] |
| 2049 (49) | 1,164,532 [1,154,924, 1,169,724] | 80.487 [79.477, 81.926] | 0.152348 [0.145734, 0.160198] | 37.424 [23.275, 38.534] | 10,996,049 [10,650,420, 11,264,342] |
| 2050 (50) | 1,200,599 [1,197,537, 1,210,496] | 80.240 [79.997, 81.800] | 0.151340 [0.145145, 0.165436] | 35.767 [21.368, 38.056] | 11,717,103 [11,336,684, 12,010,752] |
| 2051 (51) | 1,241,098 [1,239,208, 1,248,892] | 80.326 [80.240, 81.653] | 0.159553 [0.151576, 0.164396] | 34.278 [18.797, 35.907] | 12,484,713 [12,031,751, 12,784,483] |
| 2052 (52) | 1,285,529 [1,283,208, 1,294,049] | 79.648 [79.626, 81.153] | 0.161321 [0.151930, 0.168791] | 32.562 [17.194, 34.593] | 13,242,408 [12,654,634, 13,487,702] |
| 2053 (53) | 1,326,577 [1,324,976, 1,337,130] | 80.077 [79.719, 81.270] | 0.168870 [0.156484, 0.173711] | 31.366 [15.557, 33.013] | 14,001,942 [13,271,001, 14,243,526] |
| 2054 (54) | 1,370,503 [1,369,690, 1,381,573] | 79.794 [79.596, 80.531] | 0.166561 [0.155952, 0.179537] | 30.007 [14.041, 31.827] | 14,775,994 [13,928,770, 14,914,014] |
| 2055 (55) | 1,416,012 [1,413,848, 1,429,477] | 79.630 [78.957, 80.616] | 0.168637 [0.152918, 0.173496] | 29.039 [12.598, 31.097] | 15,565,700 [14,623,015, 15,633,339] |
| 2056 (56) | 1,455,457 [1,454,765, 1,473,913] | 80.005 [79.964, 81.332] | 0.165985 [0.158895, 0.186433] | 28.051 [11.433, 31.014] | 16,244,911 [15,223,431, 16,339,785] |
| 2057 (57) | 1,500,402 [1,466,243, 1,512,569] | 79.789 [79.693, 81.237] | 0.173622 [0.162205, 0.178795] | 27.337 [11.199, 32.536] | 16,990,961 [15,961,901, 17,124,197] |
| 2058 (58) | 1,520,467 [1,477,005, 1,555,351] | 80.256 [79.850, 81.461] | 0.169755 [0.160447, 0.180994] | 26.368 [11.931, 34.018] | 17,714,435 [16,623,003, 17,799,191] |
| 2059 (59) | 1,544,571 [1,480,926, 1,573,049] | 80.613 [79.969, 80.876] | 0.172301 [0.158988, 0.189677] | 25.544 [12.503, 34.888] | 18,434,606 [17,302,716, 18,587,815] |
| 2060 (60) | 1,550,653 [1,487,747, 1,581,881] | 80.113 [78.892, 80.664] | 0.171065 [0.164962, 0.182146] | 24.882 [12.365, 35.023] | 19,185,869 [18,014,230, 19,378,280] |

### Variant threshold details

| Row | Check | Base | Variant | Δ % or approval gain | Threshold | Margin | Half dev band | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 128x15_s7 | Year-15 population at least 0.80 × base | 191,771.00000000 | 167,218.00000000 | -12.803291% | 153,416.80000000 | +13801.20000000 | 1,488.00000000 | pass |
| 128x15_s7 | Run-mean air at least 15% cleaner | 0.05727463 | 0.04519859 | -21.084452% | 0.04868344 | +0.00348485 | 0.00040291 | pass |
| 256x60_s7 | Year-60 population at least 0.97 × base | 1,475,130.00000000 | 1,550,653.00000000 | +5.119752% | 1,430,876.10000000 | +119776.90000000 | 66,956.50000000 | pass |
| 256x60_s7 | Year-60 population at most 1.03 × base | 1,475,130.00000000 | 1,550,653.00000000 | +5.119752% | 1,519,383.90000000 | -31269.10000000 | 66,956.50000000 | needs stage two |
| 256x60_s7 | Year-60 approval gain at least +1 point | 80.08467948 | 80.11258338 | +0.027904 points | 81.08467948 | -0.97209609 | 0.40080420 | fail |

## 9-member results

### Systematic shift at row endpoints

| Metric | Real shift | Direction | Endpoint deltas (128 s7 / 256 s7 / 256 s11) | Quarter dev-band widths |
| --- | --- | --- | --- | --- |
| population | no | — | +183.000000 / +14043.000000 / +8919.000000 | 1,481.500000 / 50,218.750000 / 20,942.000000 |
| approval | no | — | +0.054772 / -0.079877 / +0.328869 | 0.681771 / 0.589440 / 0.554882 |
| air | no | — | +0.000672 / -0.000203 / -0.006087 | 0.001402 / 0.006934 / 0.010757 |
| ihtShare | no | — | 0.000000 / -0.039348 / -0.006796 | 0.000832 / 0.022562 / 0.026448 |

### Attentive base: 128x15_s7

Source commit: `a1a4e79e709e12a368af0645c3ac9dd50e9ac7f1`; summary: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T044/base/128x15_s7_ensemble.summary.json`.

All annual values are median [minimum, maximum]; population is residents, approval is points, air is home air pollution (lower is cleaner), I-HT is percent of industrial jobs, and funds are § (from raw annual rows).

| Year (index) | Population | Approval | Air at homes | I-HT share (%) | Funds (§) |
| --- | --- | --- | --- | --- | --- |
| 2001 (1) | 3,587 [3,587, 3,587] | 51.188 [51.188, 51.188] | 0.014765 [0.014765, 0.014765] | 0.000 [0.000, 0.000] | 39,655 [39,455, 39,855] |
| 2002 (2) | 9,297 [9,192, 9,297] | 50.617 [50.226, 50.617] | 0.026958 [0.026958, 0.028549] | 0.000 [0.000, 0.000] | 55,520 [55,420, 56,276] |
| 2003 (3) | 17,010 [17,010, 17,185] | 51.971 [51.971, 52.107] | 0.037546 [0.037546, 0.041928] | 0.000 [0.000, 0.000] | 15,420 [13,351, 15,620] |
| 2004 (4) | 25,619 [25,423, 25,619] | 49.565 [49.057, 49.565] | 0.048661 [0.042537, 0.048661] | 0.000 [0.000, 0.000] | 7,963 [6,935, 7,963] |
| 2005 (5) | 34,686 [34,443, 34,911] | 47.486 [45.539, 47.690] | 0.046657 [0.043038, 0.046969] | 0.000 [0.000, 0.000] | 21,515 [12,715, 22,308] |
| 2006 (6) | 44,579 [42,375, 45,649] | 51.917 [50.563, 53.082] | 0.045099 [0.044897, 0.046689] | 0.000 [0.000, 0.000] | 35,807 [35,284, 37,377] |
| 2007 (7) | 56,990 [54,282, 57,714] | 56.201 [55.931, 57.708] | 0.045450 [0.044740, 0.046091] | 0.000 [0.000, 0.000] | 36,381 [36,224, 46,381] |
| 2008 (8) | 70,194 [66,910, 70,976] | 61.522 [58.605, 62.269] | 0.044667 [0.043058, 0.049001] | 0.000 [0.000, 0.000] | 56,429 [51,607, 57,490] |
| 2009 (9) | 84,409 [81,421, 85,396] | 66.657 [65.634, 67.680] | 0.072853 [0.067890, 0.075378] | 0.000 [0.000, 0.000] | 51,644 [37,347, 63,990] |
| 2010 (10) | 100,141 [96,401, 101,380] | 70.852 [69.040, 72.443] | 0.072499 [0.069177, 0.074480] | 0.000 [0.000, 0.000] | 74,057 [64,517, 74,678] |
| 2011 (11) | 116,914 [113,300, 118,282] | 73.471 [72.927, 75.225] | 0.074557 [0.073473, 0.076420] | 0.000 [0.000, 0.000] | 87,155 [73,895, 90,394] |
| 2012 (12) | 134,932 [131,160, 136,360] | 75.296 [75.015, 76.995] | 0.072193 [0.070805, 0.073749] | 0.000 [0.000, 0.000] | 103,092 [85,334, 115,060] |
| 2013 (13) | 153,819 [149,266, 155,083] | 76.931 [76.326, 78.137] | 0.078895 [0.076570, 0.079603] | 0.000 [0.000, 0.714] | 120,799 [107,392, 128,382] |
| 2014 (14) | 172,437 [168,175, 173,846] | 78.492 [77.483, 79.997] | 0.084840 [0.083593, 0.085895] | 0.000 [0.000, 0.333] | 117,949 [110,455, 155,336] |
| 2015 (15) | 191,771 [187,325, 193,867] | 80.961 [78.902, 82.008] | 0.093545 [0.089967, 0.095580] | 0.000 [0.000, 0.333] | 168,619 [154,303, 207,383] |

#### Annual comparison with dev

`ihtShare` values and margins in this comparison use fractions (0.01 = one percentage point); the annual table above displays percent.

| Year | Metric | Dev median [min, max] | Lane median | Δmedian | Δ % | Passing interval | Margin to nearest boundary | Verdict |
| --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- |
| 2010 | population | 100,141.000000 [96,401.000000, 101,380.000000] | 100,141.000000 | 0.000000 | 0.0000 | [97,651.500000, 101,380.000000] | +1239.000000 | pass |
| 2010 | approval | 70.851885 [69.040174, 72.442590] | 70.851885 | 0.000000 | 0.0000 | [69.150677, 72.442590] | +1.590705 | pass |
| 2010 | air | 0.072499 [0.069177, 0.074480] | 0.072499 | 0.000000 | 0.0000 | [0.069847, 0.074480] | +0.001982 | pass |
| 2010 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2011 | population | 116,914.000000 [113,300.000000, 118,282.000000] | 116,914.000000 | 0.000000 | 0.0000 | [114,423.000000, 118,282.000000] | +1368.000000 | pass |
| 2011 | approval | 73.470900 [72.926969, 75.225277] | 73.470900 | 0.000000 | 0.0000 | [72.926969, 74.620054] | +0.543931 | pass |
| 2011 | air | 0.074557 [0.073473, 0.076420] | 0.074557 | 0.000000 | 0.0000 | [0.073473, 0.076031] | +0.001084 | pass |
| 2011 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2012 | population | 134,932.000000 [131,160.000000, 136,360.000000] | 134,932.000000 | 0.000000 | 0.0000 | [132,332.000000, 136,360.000000] | +1428.000000 | pass |
| 2012 | approval | 75.295956 [75.014760, 76.995475] | 75.295956 | -0.000000 | -0.0000 | [75.014760, 76.286314] | +0.281196 | pass |
| 2012 | air | 0.072193 [0.070805, 0.073749] | 0.072193 | 0.000000 | 0.0000 | [0.070805, 0.073665] | +0.001388 | pass |
| 2012 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2013 | population | 153,902.000000 [149,266.000000, 154,998.000000] | 153,819.000000 | -83.000000 | -0.0539 | [151,036.000000, 154,998.000000] | +1179.000000 | pass |
| 2013 | approval | 76.930783 [76.329242, 78.138895] | 76.930668 | -0.000115 | -0.0001 | [76.329242, 77.835609] | +0.601426 | pass |
| 2013 | air | 0.078771 [0.076572, 0.080118] | 0.078895 | +0.000124 | +0.1574 | [0.076998, 0.080118] | +0.001222 | pass |
| 2013 | ihtShare | 0.000000 [0.000000, 0.007138] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.003569] | 0.000000 | pass |
| 2014 | population | 172,301.000000 [168,028.000000, 173,724.000000] | 172,437.000000 | +136.000000 | +0.0789 | [169,453.000000, 173,724.000000] | +1287.000000 | pass |
| 2014 | approval | 78.565686 [77.615033, 79.404951] | 78.492004 | -0.073682 | -0.0938 | [77.670727, 79.404951] | +0.821277 | pass |
| 2014 | air | 0.085386 [0.083328, 0.087247] | 0.084840 | -0.000546 | -0.6396 | [0.083427, 0.087247] | +0.001413 | pass |
| 2014 | ihtShare | 0.000000 [0.000000, 0.003329] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.001664] | 0.000000 | pass |
| 2015 | population | 191,588.000000 [187,528.000000, 193,454.000000] | 191,771.000000 | +183.000000 | +0.0955 | [188,625.000000, 193,454.000000] | +1683.000000 | pass |
| 2015 | approval | 80.906099 [78.829218, 81.556300] | 80.960871 | +0.054772 | +0.0677 | [79.542558, 81.556300] | +0.595429 | pass |
| 2015 | air | 0.092873 [0.090884, 0.096493] | 0.093545 | +0.000672 | +0.7238 | [0.090884, 0.095678] | +0.002133 | pass |
| 2015 | ihtShare | 0.000000 [0.000000, 0.003328] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.001664] | 0.000000 | pass |

EQ ≥100 by year 15: highest annual ensemble median by that deadline is 103.5822 [100.4162, 104.4508] in 2015, pass.

Sampled-access consistency diagnostic: maximum |unemployment − (1 − stored access)| = 0.00070647 (control, 2015), within 0.02. The stored access is the last occupancy sample, not the fresh annual building-weighted access recomputation used by balance.test.ts; this diagnostic cannot certify G-UNEMP.

| Year | EQ median [min, max] | Realised I-HT share median (%) |
| --- | --- | ---: |
| 2010 | 80.0090 [77.8024, 80.9103] | 0.0000 |
| 2011 | 84.7020 [82.9408, 85.9230] | 0.0000 |
| 2012 | 89.3975 [87.8166, 90.7218] | 0.0000 |
| 2013 | 93.7311 [92.1387, 94.8755] | 0.0000 |
| 2014 | 99.0312 [95.9950, 99.9860] | 0.0000 |
| 2015 | 103.5822 [100.4162, 104.4508] | 0.0000 |

### Attentive base: 256x60_s7

Source commit: `a1a4e79e709e12a368af0645c3ac9dd50e9ac7f1`; summary: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T044/base/256x60_s7_ensemble.summary.json`.

All annual values are median [minimum, maximum]; population is residents, approval is points, air is home air pollution (lower is cleaner), I-HT is percent of industrial jobs, and funds are § (from raw annual rows).

| Year (index) | Population | Approval | Air at homes | I-HT share (%) | Funds (§) |
| --- | --- | --- | --- | --- | --- |
| 2001 (1) | 3,589 [3,589, 3,589] | 51.902 [51.902, 51.902] | 0.014912 [0.014912, 0.014912] | 0.000 [0.000, 0.000] | 26,117 [26,017, 28,447] |
| 2002 (2) | 9,859 [9,711, 9,859] | 56.087 [55.491, 56.087] | 0.034126 [0.034126, 0.034316] | 0.000 [0.000, 0.000] | 26,710 [26,610, 31,040] |
| 2003 (3) | 17,676 [17,542, 17,676] | 47.322 [47.256, 47.357] | 0.046664 [0.043294, 0.046664] | 0.000 [0.000, 0.000] | 6,792 [6,329, 7,085] |
| 2004 (4) | 26,909 [26,610, 26,909] | 46.683 [46.362, 47.276] | 0.048554 [0.044414, 0.048554] | 0.000 [0.000, 0.000] | 8,651 [7,086, 8,651] |
| 2005 (5) | 36,040 [35,591, 36,243] | 46.238 [45.985, 47.279] | 0.049111 [0.046398, 0.052615] | 0.000 [0.000, 0.000] | 18,795 [11,824, 20,042] |
| 2006 (6) | 46,868 [44,427, 47,634] | 53.857 [52.562, 56.195] | 0.047427 [0.045771, 0.048626] | 0.000 [0.000, 0.000] | 36,923 [35,323, 40,890] |
| 2007 (7) | 58,913 [56,627, 59,679] | 58.870 [57.251, 60.469] | 0.049053 [0.045182, 0.051311] | 0.000 [0.000, 0.000] | 46,424 [38,410, 47,401] |
| 2008 (8) | 72,763 [69,969, 72,772] | 63.054 [61.343, 66.023] | 0.056295 [0.051542, 0.066318] | 0.000 [0.000, 0.000] | 54,915 [48,888, 56,376] |
| 2009 (9) | 85,695 [82,612, 85,850] | 65.530 [62.961, 66.417] | 0.079642 [0.071063, 0.084410] | 0.000 [0.000, 0.000] | 22,653 [21,634, 40,042] |
| 2010 (10) | 99,145 [96,440, 99,363] | 63.852 [62.177, 64.779] | 0.070438 [0.068175, 0.080263] | 0.000 [0.000, 0.000] | 42,371 [26,643, 51,649] |
| 2011 (11) | 112,884 [109,928, 113,636] | 62.116 [61.171, 63.223] | 0.069488 [0.058694, 0.081350] | 0.000 [0.000, 1.768] | 69,040 [60,182, 76,628] |
| 2012 (12) | 129,086 [126,172, 130,667] | 62.580 [61.051, 68.097] | 0.055730 [0.053562, 0.059056] | 0.000 [0.000, 1.585] | 86,781 [81,539, 94,892] |
| 2013 (13) | 145,600 [143,285, 147,798] | 64.756 [62.284, 70.665] | 0.055748 [0.052090, 0.060272] | 0.000 [0.000, 1.412] | 98,690 [87,209, 105,438] |
| 2014 (14) | 162,622 [160,481, 164,908] | 66.438 [63.606, 70.429] | 0.057469 [0.050478, 0.060113] | 0.000 [0.000, 0.791] | 112,450 [102,596, 122,624] |
| 2015 (15) | 181,328 [179,070, 184,075] | 69.001 [64.572, 71.473] | 0.055497 [0.048979, 0.060483] | 0.000 [0.000, 0.729] | 131,842 [127,985, 138,008] |
| 2016 (16) | 200,861 [198,282, 203,270] | 70.160 [66.073, 71.987] | 0.056679 [0.047770, 0.061915] | 0.000 [0.000, 0.700] | 139,547 [125,645, 147,592] |
| 2017 (17) | 220,381 [218,061, 222,493] | 70.097 [67.728, 71.591] | 0.058831 [0.052233, 0.070450] | 0.000 [0.000, 0.455] | 154,585 [139,796, 171,809] |
| 2018 (18) | 240,742 [238,306, 243,092] | 70.233 [68.570, 71.396] | 0.062029 [0.052366, 0.066899] | 0.000 [0.000, 0.435] | 179,066 [151,021, 188,152] |
| 2019 (19) | 262,067 [259,744, 264,170] | 71.338 [69.041, 72.240] | 0.058752 [0.051904, 0.066895] | 0.000 [0.000, 0.427] | 194,084 [170,256, 205,375] |
| 2020 (20) | 284,869 [282,700, 287,308] | 72.566 [70.408, 74.050] | 0.057073 [0.051656, 0.070863] | 0.000 [0.000, 0.411] | 234,207 [176,993, 278,775] |
| 2021 (21) | 308,509 [305,420, 310,009] | 74.476 [71.917, 76.084] | 0.056319 [0.053452, 0.071679] | 0.000 [0.000, 0.207] | 257,536 [230,887, 348,648] |
| 2022 (22) | 332,047 [328,352, 333,392] | 75.212 [72.041, 76.599] | 0.055524 [0.052819, 0.068005] | 0.000 [0.000, 0.000] | 305,898 [212,252, 446,247] |
| 2023 (23) | 356,475 [352,211, 357,690] | 75.111 [73.058, 77.268] | 0.057644 [0.056013, 0.066137] | 0.000 [0.000, 0.000] | 299,487 [262,260, 777,428] |
| 2024 (24) | 381,185 [377,684, 382,496] | 76.645 [73.313, 77.373] | 0.059797 [0.057872, 0.069171] | 0.000 [0.000, 0.000] | 577,279 [295,182, 1,179,755] |
| 2025 (25) | 406,253 [403,042, 407,670] | 76.600 [73.652, 77.459] | 0.061620 [0.058755, 0.075587] | 0.000 [0.000, 0.000] | 927,074 [390,407, 1,614,240] |
| 2026 (26) | 433,199 [428,892, 433,872] | 76.981 [73.632, 78.042] | 0.060464 [0.058544, 0.076841] | 0.000 [0.000, 0.000] | 1,388,708 [540,102, 2,178,599] |
| 2027 (27) | 461,545 [456,699, 462,507] | 77.341 [74.602, 78.388] | 0.061941 [0.060965, 0.073998] | 0.000 [0.000, 0.000] | 1,826,668 [891,310, 2,819,619] |
| 2028 (28) | 491,034 [486,549, 492,566] | 77.990 [74.921, 79.034] | 0.063859 [0.063018, 0.076269] | 0.000 [0.000, 0.000] | 2,444,152 [1,327,435, 2,941,996] |
| 2029 (29) | 520,957 [516,322, 523,300] | 78.760 [74.871, 79.495] | 0.068200 [0.066664, 0.081137] | 0.000 [0.000, 0.000] | 2,895,908 [1,588,041, 3,096,057] |
| 2030 (30) | 552,018 [546,470, 553,819] | 79.705 [74.848, 80.472] | 0.071434 [0.069074, 0.083352] | 0.000 [0.000, 0.000] | 3,352,760 [2,089,365, 3,487,712] |
| 2031 (31) | 582,416 [577,697, 586,398] | 80.903 [74.680, 82.136] | 0.076910 [0.071410, 0.090942] | 0.000 [0.000, 0.000] | 3,692,069 [2,682,533, 3,797,894] |
| 2032 (32) | 614,727 [610,422, 618,203] | 81.658 [75.724, 82.761] | 0.079168 [0.077534, 0.091598] | 0.000 [0.000, 0.000] | 3,958,873 [3,357,074, 4,203,239] |
| 2033 (33) | 646,840 [643,080, 650,233] | 82.157 [78.271, 82.809] | 0.086890 [0.081092, 0.097269] | 0.000 [0.000, 0.000] | 4,263,173 [3,859,115, 4,590,656] |
| 2034 (34) | 678,637 [675,486, 682,889] | 81.528 [78.186, 83.187] | 0.092640 [0.087584, 0.100416] | 0.000 [0.000, 0.000] | 4,614,198 [4,217,789, 4,841,157] |
| 2035 (35) | 712,140 [707,891, 716,069] | 81.957 [77.835, 83.040] | 0.096631 [0.090087, 0.107136] | 0.000 [0.000, 0.000] | 4,995,430 [4,623,679, 5,216,736] |
| 2036 (36) | 744,637 [739,969, 749,686] | 81.910 [77.150, 83.035] | 0.103814 [0.097216, 0.115458] | 0.000 [0.000, 0.000] | 5,353,780 [4,861,004, 5,727,998] |
| 2037 (37) | 779,768 [773,227, 785,272] | 81.818 [77.899, 82.904] | 0.112818 [0.102947, 0.119406] | 0.000 [0.000, 0.000] | 5,639,679 [5,151,492, 5,953,747] |
| 2038 (38) | 814,066 [807,269, 819,825] | 81.443 [78.031, 83.111] | 0.117786 [0.106929, 0.124288] | 0.000 [0.000, 0.000] | 5,835,423 [5,447,395, 6,329,011] |
| 2039 (39) | 849,994 [841,354, 853,016] | 81.359 [77.791, 82.742] | 0.123636 [0.112161, 0.133642] | 0.000 [0.000, 0.000] | 6,290,000 [5,785,626, 6,797,008] |
| 2040 (40) | 883,598 [874,562, 888,549] | 80.819 [77.647, 82.555] | 0.127975 [0.119762, 0.139283] | 0.000 [0.000, 0.000] | 6,807,164 [6,169,083, 7,298,707] |
| 2041 (41) | 918,669 [910,897, 926,071] | 81.043 [77.034, 82.919] | 0.133827 [0.122829, 0.138329] | 0.000 [0.000, 0.000] | 7,361,703 [6,571,142, 7,855,409] |
| 2042 (42) | 952,887 [946,062, 963,617] | 80.604 [77.463, 82.251] | 0.135931 [0.126660, 0.144464] | 0.000 [0.000, 0.000] | 7,917,529 [6,996,043, 8,470,281] |
| 2043 (43) | 989,396 [982,561, 1,003,310] | 80.617 [77.787, 81.735] | 0.142198 [0.128765, 0.150468] | 0.000 [0.000, 0.000] | 8,414,571 [7,242,888, 9,012,346] |
| 2044 (44) | 1,028,818 [1,021,603, 1,042,063] | 81.079 [77.828, 81.579] | 0.143946 [0.134408, 0.149580] | 0.000 [0.000, 0.060] | 8,935,560 [7,618,824, 9,707,065] |
| 2045 (45) | 1,066,933 [1,056,036, 1,074,045] | 80.868 [77.113, 81.327] | 0.151992 [0.138085, 0.157241] | 0.000 [0.000, 0.193] | 9,238,639 [7,981,009, 10,378,735] |
| 2046 (46) | 1,104,531 [1,091,896, 1,114,841] | 80.382 [77.168, 81.094] | 0.147840 [0.138920, 0.160632] | 0.000 [0.000, 0.939] | 9,573,333 [8,375,843, 11,098,132] |
| 2047 (47) | 1,144,806 [1,128,735, 1,153,130] | 79.953 [76.983, 80.620] | 0.155822 [0.141592, 0.166046] | 0.000 [0.000, 1.810] | 9,898,898 [8,776,891, 11,802,100] |
| 2048 (48) | 1,185,335 [1,165,268, 1,192,325] | 80.325 [76.952, 80.642] | 0.156689 [0.151099, 0.170810] | 0.000 [0.000, 3.112] | 10,266,931 [9,153,180, 12,552,047] |
| 2049 (49) | 1,225,053 [1,188,913, 1,233,578] | 80.314 [76.988, 80.475] | 0.158194 [0.150128, 0.170681] | 0.000 [0.000, 4.223] | 10,634,043 [9,555,746, 13,284,736] |
| 2050 (50) | 1,264,792 [1,206,836, 1,276,305] | 79.966 [77.407, 81.222] | 0.156867 [0.152620, 0.171280] | 0.770 [0.000, 5.483] | 11,282,312 [9,956,954, 14,026,490] |
| 2051 (51) | 1,306,360 [1,216,632, 1,319,713] | 79.841 [77.316, 80.662] | 0.159973 [0.154797, 0.170881] | 2.062 [0.000, 6.472] | 11,943,513 [10,363,396, 14,758,406] |
| 2052 (52) | 1,341,200 [1,226,259, 1,357,600] | 79.271 [76.914, 80.295] | 0.163770 [0.158931, 0.170246] | 3.123 [0.095, 7.527] | 12,639,081 [10,803,594, 15,514,484] |
| 2053 (53) | 1,358,324 [1,236,098, 1,397,977] | 79.284 [77.189, 80.669] | 0.161239 [0.157203, 0.174984] | 3.602 [0.434, 8.329] | 13,352,329 [11,253,794, 16,298,062] |
| 2054 (54) | 1,369,639 [1,245,353, 1,438,434] | 79.940 [77.184, 80.129] | 0.163606 [0.154912, 0.176213] | 3.880 [0.883, 8.913] | 14,074,933 [11,747,832, 17,122,833] |
| 2055 (55) | 1,391,948 [1,252,485, 1,456,495] | 79.824 [77.488, 80.624] | 0.163985 [0.157939, 0.177976] | 4.667 [1.359, 9.731] | 14,813,363 [12,266,071, 17,985,481] |
| 2056 (56) | 1,408,065 [1,260,794, 1,480,771] | 80.014 [77.503, 80.938] | 0.164648 [0.158474, 0.176257] | 5.760 [2.845, 10.424] | 15,524,535 [12,831,082, 18,876,620] |
| 2057 (57) | 1,416,826 [1,267,254, 1,491,701] | 80.007 [77.270, 81.064] | 0.165107 [0.159318, 0.179016] | 6.786 [3.223, 10.088] | 16,279,751 [13,385,035, 19,828,905] |
| 2058 (58) | 1,447,384 [1,273,207, 1,509,971] | 80.191 [77.001, 80.813] | 0.170746 [0.162348, 0.177704] | 7.575 [4.583, 10.185] | 17,037,626 [13,894,318, 20,635,845] |
| 2059 (59) | 1,460,488 [1,280,810, 1,527,207] | 80.069 [77.313, 80.753] | 0.173854 [0.160767, 0.182269] | 7.773 [5.214, 11.144] | 17,740,458 [14,386,632, 21,209,679] |
| 2060 (60) | 1,475,130 [1,293,939, 1,541,123] | 80.085 [76.974, 80.868] | 0.168693 [0.162456, 0.188395] | 7.547 [5.914, 12.788] | 18,489,061 [14,808,674, 22,136,332] |

#### Annual comparison with dev

`ihtShare` values and margins in this comparison use fractions (0.01 = one percentage point); the annual table above displays percent.

| Year | Metric | Dev median [min, max] | Lane median | Δmedian | Δ % | Passing interval | Margin to nearest boundary | Verdict |
| --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- |
| 2010 | population | 99,145.000000 [96,440.000000, 99,363.000000] | 99,145.000000 | 0.000000 | 0.0000 | [97,683.500000, 99,363.000000] | +218.000000 | pass |
| 2010 | approval | 63.851905 [62.176938, 64.779444] | 63.851905 | 0.000000 | 0.0000 | [62.550651, 64.779444] | +0.927540 | pass |
| 2010 | air | 0.070438 [0.068175, 0.080263] | 0.070438 | 0.000000 | 0.0000 | [0.068175, 0.076482] | +0.002263 | pass |
| 2010 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2011 | population | 112,884.000000 [109,928.000000, 113,636.000000] | 112,884.000000 | 0.000000 | 0.0000 | [111,030.000000, 113,636.000000] | +752.000000 | pass |
| 2011 | approval | 62.116397 [61.170749, 63.222933] | 62.116397 | 0.000000 | 0.0000 | [61.170749, 63.142489] | +0.945648 | pass |
| 2011 | air | 0.069488 [0.058694, 0.081350] | 0.069488 | 0.000000 | 0.0000 | [0.058694, 0.080816] | +0.010794 | pass |
| 2011 | ihtShare | 0.000000 [0.000000, 0.017684] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.008842] | 0.000000 | pass |
| 2012 | population | 129,086.000000 [126,172.000000, 130,667.000000] | 129,086.000000 | 0.000000 | 0.0000 | [126,838.500000, 130,667.000000] | +1581.000000 | pass |
| 2012 | approval | 62.579908 [61.051415, 68.097209] | 62.579908 | 0.000000 | 0.0000 | [61.051415, 66.102806] | +1.528494 | pass |
| 2012 | air | 0.055730 [0.053562, 0.059056] | 0.055730 | 0.000000 | 0.0000 | [0.053562, 0.058477] | +0.002167 | pass |
| 2012 | ihtShare | 0.000000 [0.000000, 0.015851] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.007926] | 0.000000 | pass |
| 2013 | population | 145,600.000000 [143,285.000000, 147,798.000000] | 145,600.000000 | 0.000000 | 0.0000 | [143,343.500000, 147,798.000000] | +2198.000000 | pass |
| 2013 | approval | 64.755906 [62.283970, 70.665331] | 64.755908 | +0.000002 | +0.0000 | [62.283970, 68.946586] | +2.471938 | pass |
| 2013 | air | 0.055748 [0.052090, 0.060272] | 0.055748 | 0.000000 | 0.0000 | [0.052090, 0.059839] | +0.003658 | pass |
| 2013 | ihtShare | 0.000000 [0.000000, 0.014119] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.007059] | 0.000000 | pass |
| 2014 | population | 162,743.000000 [160,481.000000, 164,908.000000] | 162,622.000000 | -121.000000 | -0.0744 | [160,529.500000, 164,908.000000] | +2092.500000 | pass |
| 2014 | approval | 66.185627 [63.605992, 70.428778] | 66.438107 | +0.252480 | +0.3815 | [63.605992, 69.597020] | +2.832116 | pass |
| 2014 | air | 0.057469 [0.050478, 0.060113] | 0.057469 | 0.000000 | 0.0000 | [0.052652, 0.060113] | +0.002644 | pass |
| 2014 | ihtShare | 0.000000 [0.000000, 0.007913] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.003956] | 0.000000 | pass |
| 2015 | population | 181,682.000000 [179,070.000000, 184,286.000000] | 181,328.000000 | -354.000000 | -0.1948 | [179,074.000000, 184,286.000000] | +2254.000000 | pass |
| 2015 | approval | 69.005076 [64.572029, 71.447718] | 69.001492 | -0.003585 | -0.0052 | [65.567232, 71.447718] | +2.446227 | pass |
| 2015 | air | 0.056323 [0.049402, 0.060483] | 0.055497 | -0.000826 | -1.4673 | [0.050783, 0.060483] | +0.004714 | pass |
| 2015 | ihtShare | 0.000000 [0.000000, 0.007292] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.003646] | 0.000000 | pass |
| 2016 | population | 200,727.000000 [198,438.000000, 203,611.000000] | 200,861.000000 | +134.000000 | +0.0668 | [198,438.000000, 203,313.500000] | +2423.000000 | pass |
| 2016 | approval | 69.995104 [66.073285, 71.473263] | 70.159887 | +0.164784 | +0.2354 | [67.295115, 71.473263] | +1.313375 | pass |
| 2016 | air | 0.055139 [0.049743, 0.061915] | 0.056679 | +0.001540 | +2.7930 | [0.049743, 0.061224] | +0.004546 | pass |
| 2016 | ihtShare | 0.000000 [0.000000, 0.007049] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.003524] | 0.000000 | pass |
| 2017 | population | 220,398.000000 [217,756.000000, 222,690.000000] | 220,381.000000 | -17.000000 | -0.0077 | [217,931.000000, 222,690.000000] | +2309.000000 | pass |
| 2017 | approval | 69.547312 [67.338227, 71.724746] | 70.097282 | +0.549970 | +0.7908 | [67.354053, 71.724746] | +1.627464 | pass |
| 2017 | air | 0.055625 [0.052130, 0.064520] | 0.058831 | +0.003206 | +5.7628 | [0.052130, 0.061821] | +0.002990 | pass |
| 2017 | ihtShare | 0.000000 [0.000000, 0.006990] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.003495] | 0.000000 | pass |
| 2018 | population | 241,134.000000 [238,379.000000, 242,772.000000] | 240,742.000000 | -392.000000 | -0.1626 | [238,722.660000, 242,772.000000] | +2019.340000 | pass |
| 2018 | approval | 69.996074 [67.194316, 71.334130] | 70.233347 | +0.237273 | +0.3390 | [67.926167, 71.334130] | +1.100783 | pass |
| 2018 | air | 0.058331 [0.052673, 0.065623] | 0.062029 | +0.003697 | +6.3386 | [0.052673, 0.064806] | +0.002778 | pass |
| 2018 | ihtShare | 0.000000 [0.000000, 0.006777] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.003389] | 0.000000 | pass |
| 2019 | population | 262,375.000000 [259,752.000000, 264,696.000000] | 262,067.000000 | -308.000000 | -0.1174 | [259,752.000000, 264,696.000000] | +2315.000000 | pass |
| 2019 | approval | 71.172907 [67.225600, 72.503893] | 71.337671 | +0.164764 | +0.2315 | [68.533761, 72.503893] | +1.166221 | pass |
| 2019 | air | 0.056366 [0.052276, 0.068398] | 0.058752 | +0.002386 | +4.2335 | [0.052276, 0.064427] | +0.005675 | pass |
| 2019 | ihtShare | 0.000000 [0.000000, 0.004477] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.002239] | 0.000000 | pass |
| 2020 | population | 284,938.000000 [281,431.000000, 287,103.000000] | 284,869.000000 | -69.000000 | -0.0242 | [282,088.620000, 287,103.000000] | +2234.000000 | pass |
| 2020 | approval | 72.137169 [70.045944, 73.422542] | 72.566192 | +0.429022 | +0.5947 | [70.448870, 73.422542] | +0.856351 | pass |
| 2020 | air | 0.055381 [0.051697, 0.059821] | 0.057073 | +0.001692 | +3.0557 | [0.051697, 0.059443] | +0.002369 | pass |
| 2020 | ihtShare | 0.000000 [0.000000, 0.004442] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.002221] | 0.000000 | pass |
| 2021 | population | 309,055.000000 [305,041.000000, 310,742.000000] | 308,509.000000 | -546.000000 | -0.1767 | [305,964.450000, 310,742.000000] | +2233.000000 | pass |
| 2021 | approval | 73.058709 [72.411282, 76.684650] | 74.476061 | +1.417351 | +1.9400 | [72.411282, 75.195393] | +0.719332 | pass |
| 2021 | air | 0.055526 [0.051048, 0.061836] | 0.056319 | +0.000793 | +1.4287 | [0.051048, 0.060920] | +0.004601 | pass |
| 2021 | ihtShare | 0.000000 [0.000000, 0.004414] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.002207] | 0.000000 | pass |
| 2022 | population | 332,098.000000 [327,623.000000, 333,926.000000] | 332,047.000000 | -51.000000 | -0.0154 | [328,777.020000, 333,926.000000] | +1879.000000 | pass |
| 2022 | approval | 75.431064 [72.317795, 76.886389] | 75.212179 | -0.218884 | -0.2902 | [73.146767, 76.886389] | +1.674210 | pass |
| 2022 | air | 0.055605 [0.049979, 0.064391] | 0.055524 | -0.000081 | -0.1465 | [0.049979, 0.062812] | +0.005545 | pass |
| 2022 | ihtShare | 0.000000 [0.000000, 0.004390] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.002195] | 0.000000 | pass |
| 2023 | population | 356,659.000000 [351,550.000000, 357,912.000000] | 356,475.000000 | -184.000000 | -0.0516 | [353,092.410000, 357,912.000000] | +1437.000000 | pass |
| 2023 | approval | 76.228809 [73.460378, 77.299529] | 75.111187 | -1.117622 | -1.4661 | [74.309234, 77.299529] | +0.801953 | pass |
| 2023 | air | 0.059101 [0.050737, 0.065704] | 0.057644 | -0.001457 | -2.4661 | [0.051618, 0.065704] | +0.006026 | pass |
| 2023 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2024 | population | 380,531.000000 [376,917.000000, 382,300.000000] | 381,185.000000 | +654.000000 | +0.1719 | [376,917.000000, 382,300.000000] | +1115.000000 | pass |
| 2024 | approval | 76.613249 [73.998838, 77.957952] | 76.645183 | +0.031935 | +0.0417 | [74.633692, 77.957952] | +1.312768 | pass |
| 2024 | air | 0.061226 [0.052972, 0.069464] | 0.059797 | -0.001429 | -2.3346 | [0.052981, 0.069464] | +0.006816 | pass |
| 2024 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2025 | population | 406,143.000000 [402,631.000000, 407,893.000000] | 406,253.000000 | +110.000000 | +0.0271 | [402,631.000000, 407,893.000000] | +1640.000000 | pass |
| 2025 | approval | 76.847449 [73.900218, 78.213305] | 76.600234 | -0.247214 | -0.3217 | [74.690905, 78.213305] | +1.613071 | pass |
| 2025 | air | 0.061168 [0.057127, 0.069714] | 0.061620 | +0.000452 | +0.7389 | [0.057127, 0.067462] | +0.004493 | pass |
| 2025 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2026 | population | 433,030.000000 [429,660.000000, 434,886.000000] | 433,199.000000 | +169.000000 | +0.0390 | [429,660.000000, 434,886.000000] | +1687.000000 | pass |
| 2026 | approval | 76.505994 [74.148121, 77.964325] | 76.981421 | +0.475427 | +0.6214 | [74.597892, 77.964325] | +0.982904 | pass |
| 2026 | air | 0.058854 [0.057654, 0.071210] | 0.060464 | +0.001610 | +2.7351 | [0.057654, 0.065632] | +0.002809 | pass |
| 2026 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2027 | population | 461,632.000000 [458,481.000000, 463,349.000000] | 461,545.000000 | -87.000000 | -0.0188 | [458,481.000000, 463,349.000000] | +1804.000000 | pass |
| 2027 | approval | 77.763571 [75.669575, 78.840311] | 77.340594 | -0.422978 | -0.5439 | [76.178203, 78.840311] | +1.162391 | pass |
| 2027 | air | 0.061842 [0.057955, 0.069490] | 0.061941 | +0.000099 | +0.1593 | [0.057955, 0.067610] | +0.003986 | pass |
| 2027 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2028 | population | 491,442.000000 [486,939.000000, 492,668.000000] | 491,034.000000 | -408.000000 | -0.0830 | [486,939.000000, 492,668.000000] | +1634.000000 | pass |
| 2028 | approval | 77.890958 [75.924164, 78.730433] | 77.989888 | +0.098930 | +0.1270 | [76.487824, 78.730433] | +0.740545 | pass |
| 2028 | air | 0.064460 [0.058058, 0.073884] | 0.063859 | -0.000602 | -0.9332 | [0.058058, 0.072373] | +0.005801 | pass |
| 2028 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2029 | population | 522,372.000000 [516,424.000000, 523,222.000000] | 520,957.000000 | -1415.000000 | -0.2709 | [517,148.280000, 523,222.000000] | +2265.000000 | pass |
| 2029 | approval | 78.665187 [75.946768, 80.008889] | 78.760177 | +0.094990 | +0.1208 | [76.634127, 80.008889] | +1.248712 | pass |
| 2029 | air | 0.067122 [0.062519, 0.079002] | 0.068200 | +0.001078 | +1.6065 | [0.062519, 0.075364] | +0.005681 | pass |
| 2029 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2030 | population | 553,169.000000 [547,698.000000, 554,269.000000] | 552,018.000000 | -1151.000000 | -0.2081 | [547,698.000000, 554,269.000000] | +2251.000000 | pass |
| 2030 | approval | 80.046819 [77.065152, 81.049478] | 79.704760 | -0.342059 | -0.4273 | [78.054656, 81.049478] | +1.344718 | pass |
| 2030 | air | 0.070346 [0.065754, 0.080669] | 0.071434 | +0.001088 | +1.5461 | [0.065754, 0.077804] | +0.005680 | pass |
| 2030 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2031 | population | 584,845.000000 [578,264.000000, 586,165.000000] | 582,416.000000 | -2429.000000 | -0.4153 | [578,996.550000, 586,165.000000] | +3419.450000 | pass |
| 2031 | approval | 81.189545 [77.224470, 81.342604] | 80.902603 | -0.286942 | -0.3534 | [79.130478, 81.342604] | +0.440001 | pass |
| 2031 | air | 0.074498 [0.071388, 0.086414] | 0.076910 | +0.002413 | +3.2385 | [0.071388, 0.082011] | +0.005101 | pass |
| 2031 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2032 | population | 616,271.000000 [609,732.000000, 617,587.000000] | 614,727.000000 | -1544.000000 | -0.2505 | [610,108.290000, 617,587.000000] | +2860.000000 | pass |
| 2032 | approval | 81.870756 [78.113537, 82.205682] | 81.657508 | -0.213247 | -0.2605 | [79.824683, 82.205682] | +0.548174 | pass |
| 2032 | air | 0.080718 [0.076235, 0.092153] | 0.079168 | -0.001551 | -1.9209 | [0.076235, 0.088678] | +0.002933 | pass |
| 2032 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2033 | population | 649,366.000000 [642,446.000000, 650,402.000000] | 646,840.000000 | -2526.000000 | -0.3890 | [642,872.340000, 650,402.000000] | +3562.000000 | pass |
| 2033 | approval | 82.021286 [79.810819, 82.775621] | 82.157027 | +0.135741 | +0.1655 | [80.538885, 82.775621] | +0.618594 | pass |
| 2033 | air | 0.082977 [0.080073, 0.096820] | 0.086890 | +0.003913 | +4.7156 | [0.080073, 0.091351] | +0.004461 | pass |
| 2033 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2034 | population | 681,383.000000 [674,866.000000, 682,905.000000] | 678,637.000000 | -2746.000000 | -0.4030 | [674,866.000000, 682,905.000000] | +3771.000000 | pass |
| 2034 | approval | 81.876241 [79.969538, 82.721619] | 81.527590 | -0.348651 | -0.4258 | [80.500200, 82.721619] | +1.027389 | pass |
| 2034 | air | 0.088946 [0.085412, 0.101078] | 0.092640 | +0.003693 | +4.1525 | [0.085412, 0.096779] | +0.004140 | pass |
| 2034 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2035 | population | 715,266.000000 [707,692.000000, 716,674.000000] | 712,140.000000 | -3126.000000 | -0.4370 | [708,113.340000, 716,674.000000] | +4026.660000 | pass |
| 2035 | approval | 82.321277 [79.824437, 82.746021] | 81.957189 | -0.364088 | -0.4423 | [80.860485, 82.746021] | +0.788832 | pass |
| 2035 | air | 0.094088 [0.088873, 0.107079] | 0.096631 | +0.002542 | +2.7022 | [0.088873, 0.103192] | +0.006561 | pass |
| 2035 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2036 | population | 747,267.000000 [740,445.000000, 749,944.000000] | 744,637.000000 | -2630.000000 | -0.3519 | [740,445.000000, 749,944.000000] | +4192.000000 | pass |
| 2036 | approval | 81.682529 [80.058075, 82.240793] | 81.909692 | +0.227163 | +0.2781 | [80.591170, 82.240793] | +0.331102 | pass |
| 2036 | air | 0.098577 [0.096560, 0.112797] | 0.103814 | +0.005237 | +5.3127 | [0.096560, 0.106695] | +0.002882 | pass |
| 2036 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2037 | population | 781,483.000000 [773,598.000000, 784,083.000000] | 779,768.000000 | -1715.000000 | -0.2195 | [773,668.170000, 784,083.000000] | +4315.000000 | pass |
| 2037 | approval | 81.705085 [79.349048, 82.108048] | 81.818128 | +0.113043 | +0.1384 | [80.325585, 82.108048] | +0.289920 | pass |
| 2037 | air | 0.111185 [0.100352, 0.122397] | 0.112818 | +0.001633 | +1.4690 | [0.100352, 0.122207] | +0.009389 | pass |
| 2037 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2038 | population | 816,400.000000 [808,253.000000, 819,015.000000] | 814,066.000000 | -2334.000000 | -0.2859 | [808,253.000000, 819,015.000000] | +4949.000000 | pass |
| 2038 | approval | 81.336567 [79.565357, 82.107769] | 81.442773 | +0.106206 | +0.1306 | [80.065361, 82.107769] | +0.664995 | pass |
| 2038 | air | 0.113757 [0.104651, 0.132841] | 0.117786 | +0.004029 | +3.5416 | [0.104651, 0.127852] | +0.010066 | pass |
| 2038 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2039 | population | 849,116.000000 [844,325.000000, 853,580.000000] | 849,994.000000 | +878.000000 | +0.1034 | [844,325.000000, 853,580.000000] | +3586.000000 | pass |
| 2039 | approval | 81.141469 [80.614922, 82.107920] | 81.359446 | +0.217976 | +0.2686 | [80.614922, 81.887968] | +0.528523 | pass |
| 2039 | air | 0.117955 [0.110534, 0.138910] | 0.123636 | +0.005681 | +4.8161 | [0.110534, 0.132143] | +0.008507 | pass |
| 2039 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2040 | population | 885,781.000000 [878,794.000000, 890,501.000000] | 883,598.000000 | -2183.000000 | -0.2464 | [878,794.000000, 890,501.000000] | +4804.000000 | pass |
| 2040 | approval | 81.936279 [80.308075, 82.773166] | 80.819269 | -1.117010 | -1.3633 | [80.703734, 82.773166] | +0.115535 | pass |
| 2040 | air | 0.123398 [0.116073, 0.139514] | 0.127975 | +0.004578 | +3.7096 | [0.116073, 0.135118] | +0.007143 | pass |
| 2040 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2041 | population | 922,651.000000 [913,777.000000, 928,329.000000] | 918,669.000000 | -3982.000000 | -0.4316 | [913,777.000000, 928,329.000000] | +4892.000000 | pass |
| 2041 | approval | 81.517374 [80.768678, 82.685078] | 81.042899 | -0.474475 | -0.5821 | [80.768678, 82.475574] | +0.274221 | pass |
| 2041 | air | 0.125318 [0.119679, 0.143380] | 0.133827 | +0.008508 | +6.7893 | [0.119679, 0.137169] | +0.003342 | pass |
| 2041 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2042 | population | 954,296.000000 [948,309.000000, 964,043.000000] | 952,887.000000 | -1409.000000 | -0.1476 | [948,309.000000, 963,838.960000] | +4578.000000 | pass |
| 2042 | approval | 81.318185 [80.254576, 82.517725] | 80.603674 | -0.714511 | -0.8787 | [80.254576, 82.449760] | +0.349098 | pass |
| 2042 | air | 0.131582 [0.126007, 0.147672] | 0.135931 | +0.004349 | +3.3054 | [0.126007, 0.142415] | +0.006483 | pass |
| 2042 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2043 | population | 990,452.000000 [986,884.000000, 1,001,176.000000] | 989,396.000000 | -1056.000000 | -0.1066 | [986,884.000000, 1,000,356.520000] | +2512.000000 | pass |
| 2043 | approval | 81.418462 [79.844569, 82.582742] | 80.616568 | -0.801894 | -0.9849 | [80.049376, 82.582742] | +0.567192 | pass |
| 2043 | air | 0.136369 [0.130339, 0.155298] | 0.142198 | +0.005829 | +4.2741 | [0.130339, 0.148849] | +0.006651 | pass |
| 2043 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2044 | population | 1,029,252.000000 [1,021,771.000000, 1,041,125.000000] | 1,028,818.000000 | -434.000000 | -0.0422 | [1,021,771.000000, 1,039,544.520000] | +7047.000000 | pass |
| 2044 | approval | 81.073170 [79.716275, 81.605984] | 81.079197 | +0.006028 | +0.0074 | [80.128315, 81.605984] | +0.526787 | pass |
| 2044 | air | 0.140589 [0.138719, 0.158979] | 0.143946 | +0.003357 | +2.3878 | [0.138719, 0.150719] | +0.005227 | pass |
| 2044 | ihtShare | 0.000000 [0.000000, 0.002702] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.001351] | 0.000000 | pass |
| 2045 | population | 1,066,213.000000 [1,055,686.000000, 1,079,331.000000] | 1,066,933.000000 | +720.000000 | +0.0675 | [1,055,686.000000, 1,078,035.500000] | +11102.500000 | pass |
| 2045 | approval | 80.763918 [79.310177, 81.188186] | 80.867884 | +0.103966 | +0.1287 | [79.824914, 81.188186] | +0.320302 | pass |
| 2045 | air | 0.145700 [0.142480, 0.160587] | 0.151992 | +0.006293 | +4.3190 | [0.142480, 0.154753] | +0.002760 | pass |
| 2045 | ihtShare | 0.000000 [0.000000, 0.010754] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.005377] | 0.000000 | pass |
| 2046 | population | 1,106,293.000000 [1,092,663.000000, 1,118,481.000000] | 1,104,531.000000 | -1762.000000 | -0.1593 | [1,093,384.000000, 1,118,481.000000] | +11147.000000 | pass |
| 2046 | approval | 80.540855 [79.007583, 81.000507] | 80.382269 | -0.158587 | -0.1969 | [79.544393, 81.000507] | +0.618238 | pass |
| 2046 | air | 0.150068 [0.144261, 0.166444] | 0.147840 | -0.002227 | -1.4841 | [0.144261, 0.161159] | +0.003579 | pass |
| 2046 | ihtShare | 0.000000 [0.000000, 0.029380] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.014690] | 0.000000 | pass |
| 2047 | population | 1,144,132.000000 [1,127,604.000000, 1,152,537.000000] | 1,144,806.000000 | +674.000000 | +0.0589 | [1,131,665.500000, 1,152,537.000000] | +7731.000000 | pass |
| 2047 | approval | 79.998508 [78.953120, 81.058885] | 79.952895 | -0.045613 | -0.0570 | [78.953120, 81.051391] | +0.999775 | pass |
| 2047 | air | 0.149999 [0.143483, 0.167729] | 0.155822 | +0.005823 | +3.8821 | [0.143483, 0.162122] | +0.006300 | pass |
| 2047 | ihtShare | 0.000000 [0.000000, 0.035157] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.017579] | 0.000000 | pass |
| 2048 | population | 1,186,078.000000 [1,167,763.000000, 1,189,173.000000] | 1,185,335.000000 | -743.000000 | -0.0626 | [1,174,217.220000, 1,189,173.000000] | +3838.000000 | pass |
| 2048 | approval | 80.458667 [77.946940, 80.868642] | 80.324843 | -0.133824 | -0.1663 | [78.997816, 80.868642] | +0.543799 | pass |
| 2048 | air | 0.155346 [0.147753, 0.172724] | 0.156689 | +0.001343 | +0.8646 | [0.147753, 0.167831] | +0.008936 | pass |
| 2048 | ihtShare | 0.000000 [0.000000, 0.050934] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.025467] | 0.000000 | pass |
| 2049 | population | 1,225,463.000000 [1,185,004.000000, 1,235,776.000000] | 1,225,053.000000 | -410.000000 | -0.0335 | [1,200,077.000000, 1,235,776.000000] | +10723.000000 | pass |
| 2049 | approval | 80.561099 [78.807668, 80.951111] | 80.314400 | -0.246698 | -0.3062 | [79.489377, 80.951111] | +0.636710 | pass |
| 2049 | air | 0.156569 [0.147350, 0.169690] | 0.158194 | +0.001625 | +1.0380 | [0.147350, 0.167738] | +0.009545 | pass |
| 2049 | ihtShare | 0.000000 [0.000000, 0.062206] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.031103] | 0.000000 | pass |
| 2050 | population | 1,265,741.000000 [1,202,458.000000, 1,272,989.000000] | 1,264,792.000000 | -949.000000 | -0.0750 | [1,230,475.500000, 1,272,989.000000] | +8197.000000 | pass |
| 2050 | approval | 80.318955 [78.991205, 80.844737] | 79.966261 | -0.352694 | -0.4391 | [79.392189, 80.844737] | +0.574072 | pass |
| 2050 | air | 0.159403 [0.154533, 0.177092] | 0.156867 | -0.002536 | -1.5910 | [0.154533, 0.170683] | +0.002334 | pass |
| 2050 | ihtShare | 0.000000 [0.000000, 0.073241] | 0.007698 | +0.007698 | n/a | [0.000000, 0.036621] | +0.007698 | pass |
| 2051 | population | 1,310,245.000000 [1,243,720.000000, 1,315,846.000000] | 1,306,360.000000 | -3885.000000 | -0.2965 | [1,274,182.000000, 1,315,846.000000] | +9486.000000 | pass |
| 2051 | approval | 79.678009 [78.273839, 80.753433] | 79.841343 | +0.163334 | +0.2050 | [78.438212, 80.753433] | +0.912090 | pass |
| 2051 | air | 0.164150 [0.152604, 0.178799] | 0.159973 | -0.004177 | -2.5446 | [0.152604, 0.177247] | +0.007369 | pass |
| 2051 | ihtShare | 0.010851 [0.000000, 0.078228] | 0.020620 | +0.009769 | +90.0319 | [0.000000, 0.049965] | +0.020620 | pass |
| 2052 | population | 1,342,501.000000 [1,259,287.000000, 1,355,405.000000] | 1,341,200.000000 | -1301.000000 | -0.0969 | [1,294,442.000000, 1,355,405.000000] | +14205.000000 | pass |
| 2052 | approval | 79.773212 [78.304435, 80.636975] | 79.270960 | -0.502252 | -0.6296 | [78.606942, 80.636975] | +0.664017 | pass |
| 2052 | air | 0.160637 [0.153368, 0.177894] | 0.163770 | +0.003133 | +1.9502 | [0.153368, 0.172900] | +0.009130 | pass |
| 2052 | ihtShare | 0.025653 [0.000000, 0.091159] | 0.031234 | +0.005580 | +21.7536 | [0.000000, 0.071232] | +0.031234 | pass |
| 2053 | population | 1,361,273.000000 [1,266,114.000000, 1,397,353.000000] | 1,358,324.000000 | -2949.000000 | -0.2166 | [1,295,653.500000, 1,397,353.000000] | +39029.000000 | pass |
| 2053 | approval | 79.536204 [77.678528, 80.754847] | 79.284429 | -0.251774 | -0.3166 | [77.998044, 80.754847] | +1.286385 | pass |
| 2053 | air | 0.164037 [0.155334, 0.174626] | 0.161239 | -0.002798 | -1.7058 | [0.155334, 0.173684] | +0.005906 | pass |
| 2053 | ihtShare | 0.035398 [0.000000, 0.101934] | 0.036024 | +0.000626 | +1.7676 | [0.000000, 0.086365] | +0.036024 | pass |
| 2054 | population | 1,389,189.000000 [1,282,793.000000, 1,434,433.000000] | 1,369,639.000000 | -19550.000000 | -1.4073 | [1,313,369.000000, 1,434,433.000000] | +56270.000000 | pass |
| 2054 | approval | 79.908776 [78.675529, 81.011342] | 79.939502 | +0.030726 | +0.0385 | [78.740869, 81.011342] | +1.071840 | pass |
| 2054 | air | 0.164130 [0.152679, 0.182994] | 0.163606 | -0.000524 | -0.3194 | [0.152679, 0.179288] | +0.010927 | pass |
| 2054 | ihtShare | 0.046938 [0.001336, 0.101840] | 0.038805 | -0.008134 | -17.3283 | [0.001336, 0.097190] | +0.037469 | pass |
| 2055 | population | 1,401,036.000000 [1,291,560.000000, 1,463,953.000000] | 1,391,948.000000 | -9088.000000 | -0.6487 | [1,314,839.500000, 1,463,953.000000] | +72005.000000 | pass |
| 2055 | approval | 79.811388 [77.450356, 81.114600] | 79.823648 | +0.012260 | +0.0154 | [77.979265, 81.114600] | +1.290953 | pass |
| 2055 | air | 0.168220 [0.156632, 0.175749] | 0.163985 | -0.004235 | -2.5174 | [0.158661, 0.175749] | +0.005324 | pass |
| 2055 | ihtShare | 0.050612 [0.018379, 0.116942] | 0.046669 | -0.003942 | -7.7892 | [0.018379, 0.099893] | +0.028290 | pass |
| 2056 | population | 1,419,186.000000 [1,304,234.000000, 1,479,068.000000] | 1,408,065.000000 | -11121.000000 | -0.7836 | [1,331,769.000000, 1,479,068.000000] | +71003.000000 | pass |
| 2056 | approval | 80.066278 [77.580319, 81.022311] | 80.013514 | -0.052764 | -0.0659 | [78.345281, 81.022311] | +1.008798 | pass |
| 2056 | air | 0.168069 [0.154205, 0.186111] | 0.164648 | -0.003421 | -2.0356 | [0.154205, 0.184022] | +0.010443 | pass |
| 2056 | ihtShare | 0.065149 [0.030167, 0.124758] | 0.057602 | -0.007547 | -11.5848 | [0.030167, 0.112445] | +0.027435 | pass |
| 2057 | population | 1,418,230.000000 [1,322,291.000000, 1,487,910.000000] | 1,416,826.000000 | -1404.000000 | -0.0990 | [1,335,420.500000, 1,487,910.000000] | +71084.000000 | pass |
| 2057 | approval | 80.258158 [77.712266, 80.946544] | 80.006645 | -0.251512 | -0.3134 | [78.641018, 80.946544] | +0.939899 | pass |
| 2057 | air | 0.170842 [0.153725, 0.181636] | 0.165107 | -0.005736 | -3.3572 | [0.156887, 0.181636] | +0.008220 | pass |
| 2057 | ihtShare | 0.074023 [0.038866, 0.130134] | 0.067864 | -0.006159 | -8.3203 | [0.038866, 0.119657] | +0.028998 | pass |
| 2058 | population | 1,442,416.000000 [1,335,743.000000, 1,521,883.000000] | 1,447,384.000000 | +4968.000000 | +0.3444 | [1,349,346.000000, 1,521,883.000000] | +74499.000000 | pass |
| 2058 | approval | 80.014802 [78.340443, 80.926879] | 80.191134 | +0.176331 | +0.2204 | [78.721584, 80.926879] | +0.735745 | pass |
| 2058 | air | 0.168051 [0.153829, 0.187011] | 0.170746 | +0.002695 | +1.6038 | [0.153829, 0.184642] | +0.013896 | pass |
| 2058 | ihtShare | 0.089536 [0.040372, 0.135843] | 0.075753 | -0.013784 | -15.3945 | [0.041800, 0.135843] | +0.033952 | pass |
| 2059 | population | 1,447,648.000000 [1,344,677.000000, 1,537,176.000000] | 1,460,488.000000 | +12840.000000 | +0.8870 | [1,351,398.500000, 1,537,176.000000] | +76688.000000 | pass |
| 2059 | approval | 79.883671 [77.412821, 80.662289] | 80.068730 | +0.185059 | +0.2317 | [78.258937, 80.662289] | +0.593559 | pass |
| 2059 | air | 0.169666 [0.156110, 0.185163] | 0.173854 | +0.004188 | +2.4685 | [0.156110, 0.184193] | +0.010339 | pass |
| 2059 | ihtShare | 0.097398 [0.044402, 0.136353] | 0.077731 | -0.019667 | -20.1925 | [0.051422, 0.136353] | +0.026308 | pass |
| 2060 | population | 1,461,087.000000 [1,341,715.000000, 1,542,590.000000] | 1,475,130.000000 | +14043.000000 | +0.9611 | [1,360,649.500000, 1,542,590.000000] | +67460.000000 | pass |
| 2060 | approval | 80.164557 [78.183649, 80.541410] | 80.084679 | -0.079877 | -0.0996 | [78.985677, 80.541410] | +0.456730 | pass |
| 2060 | air | 0.168895 [0.155473, 0.183209] | 0.168693 | -0.000203 | -0.1201 | [0.155473, 0.182763] | +0.013219 | pass |
| 2060 | ihtShare | 0.114822 [0.047377, 0.137624] | 0.075474 | -0.039348 | -34.2689 | [0.069698, 0.137624] | +0.005775 | pass |

EQ ≥100 by year 30: highest annual ensemble median by that deadline is 121.2735 [118.1083, 122.5421] in 2030, pass.

Sampled-access consistency diagnostic: maximum |unemployment − (1 − stored access)| = 0.00056949 (p100-d1441, 2049), within 0.02. The stored access is the last occupancy sample, not the fresh annual building-weighted access recomputation used by balance.test.ts; this diagnostic cannot certify G-UNEMP.

| Year | EQ median [min, max] | Realised I-HT share median (%) |
| --- | --- | ---: |
| 2010 | 78.3618 [77.4370, 82.1735] | 0.0000 |
| 2011 | 82.3307 [80.0730, 85.5068] | 0.0000 |
| 2012 | 85.0895 [81.9408, 88.1478] | 0.0000 |
| 2013 | 87.4385 [83.4342, 90.6512] | 0.0000 |
| 2014 | 89.6519 [84.6317, 92.6046] | 0.0000 |
| 2015 | 91.2038 [85.9104, 94.2411] | 0.0000 |
| 2016 | 93.1567 [88.4605, 96.3047] | 0.0000 |
| 2017 | 95.5015 [91.3771, 98.5827] | 0.0000 |
| 2018 | 97.9673 [94.2649, 101.0120] | 0.0000 |
| 2019 | 100.1899 [96.1391, 103.3326] | 0.0000 |
| 2020 | 102.2959 [98.3910, 105.3588] | 0.0000 |
| 2021 | 105.7709 [100.5723, 107.4103] | 0.0000 |
| 2022 | 109.1688 [102.6335, 110.0205] | 0.0000 |
| 2023 | 112.0068 [104.8971, 112.6554] | 0.0000 |
| 2024 | 113.8399 [107.4734, 114.8378] | 0.0000 |
| 2025 | 115.4081 [109.8505, 116.5389] | 0.0000 |
| 2026 | 116.7602 [111.8491, 117.9570] | 0.0000 |
| 2027 | 117.9301 [113.5292, 119.2027] | 0.0000 |
| 2028 | 119.0644 [115.0761, 120.2397] | 0.0000 |
| 2029 | 120.1447 [116.5593, 121.3547] | 0.0000 |
| 2030 | 121.2735 [118.1083, 122.5421] | 0.0000 |
| 2031 | 122.2405 [119.5906, 123.6778] | 0.0000 |
| 2032 | 123.7599 [121.0083, 124.8179] | 0.0000 |
| 2033 | 125.0271 [122.2302, 125.8354] | 0.0000 |
| 2034 | 125.6857 [123.2669, 126.6984] | 0.0000 |
| 2035 | 126.2285 [124.1804, 127.3978] | 0.0000 |
| 2036 | 126.7910 [125.0043, 127.9753] | 0.0000 |
| 2037 | 127.3685 [125.6452, 128.5115] | 0.0000 |
| 2038 | 128.0290 [126.1750, 129.1374] | 0.0000 |
| 2039 | 128.5568 [126.7424, 129.6790] | 0.0000 |
| 2040 | 128.9262 [127.2272, 130.0763] | 0.0000 |
| 2041 | 129.1938 [127.6818, 130.3829] | 0.0000 |
| 2042 | 129.3216 [128.0211, 130.6292] | 0.0000 |
| 2043 | 129.3920 [128.2501, 130.8232] | 0.0000 |
| 2044 | 129.3537 [128.4318, 130.9695] | 0.0000 |
| 2045 | 129.2926 [128.7808, 131.2372] | 0.0000 |
| 2046 | 129.3808 [129.1502, 131.4786] | 0.0000 |
| 2047 | 129.6554 [129.2853, 131.6726] | 0.0000 |
| 2048 | 129.8854 [129.2393, 131.7808] | 0.0000 |
| 2049 | 130.0685 [129.1414, 131.8703] | 0.0000 |
| 2050 | 130.2049 [129.0909, 131.9964] | 0.7698 |
| 2051 | 130.3436 [129.0221, 132.1419] | 2.0620 |
| 2052 | 130.6904 [129.0225, 132.2708] | 3.1234 |
| 2053 | 131.0522 [129.0061, 132.4001] | 3.6024 |
| 2054 | 131.2518 [128.9057, 132.6014] | 3.8805 |
| 2055 | 131.4874 [128.8373, 132.8515] | 4.6669 |
| 2056 | 131.6223 [128.8596, 133.0000] | 5.7602 |
| 2057 | 131.6646 [128.9359, 133.0894] | 6.7864 |
| 2058 | 131.7152 [129.1368, 133.1354] | 7.5753 |
| 2059 | 131.7701 [129.4157, 133.2303] | 7.7731 |
| 2060 | 131.8176 [129.6609, 133.3707] | 7.5474 |

### Attentive base: 256x60_s11

Source commit: `a1a4e79e709e12a368af0645c3ac9dd50e9ac7f1`; summary: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T044/base/256x60_s11_ensemble.summary.json`.

All annual values are median [minimum, maximum]; population is residents, approval is points, air is home air pollution (lower is cleaner), I-HT is percent of industrial jobs, and funds are § (from raw annual rows).

| Year (index) | Population | Approval | Air at homes | I-HT share (%) | Funds (§) |
| --- | --- | --- | --- | --- | --- |
| 2001 (1) | 3,634 [3,634, 3,634] | 51.167 [51.167, 51.167] | 0.012534 [0.012534, 0.012534] | 0.000 [0.000, 0.000] | 36,186 [35,986, 36,386] |
| 2002 (2) | 9,461 [9,461, 9,461] | 46.662 [46.662, 46.662] | 0.044620 [0.044620, 0.044620] | 0.000 [0.000, 0.000] | 56,953 [56,753, 57,153] |
| 2003 (3) | 17,370 [17,370, 17,370] | 45.493 [45.493, 45.493] | 0.056726 [0.056726, 0.056726] | 0.000 [0.000, 0.000] | 13,152 [12,952, 13,352] |
| 2004 (4) | 26,074 [25,970, 26,074] | 43.699 [42.704, 43.699] | 0.056504 [0.053914, 0.056504] | 0.000 [0.000, 0.000] | 8,899 [6,781, 8,899] |
| 2005 (5) | 34,606 [34,606, 34,718] | 42.833 [41.058, 42.833] | 0.054611 [0.051869, 0.058010] | 0.000 [0.000, 0.000] | 22,027 [14,838, 22,427] |
| 2006 (6) | 44,972 [44,070, 45,728] | 51.220 [49.580, 52.513] | 0.050478 [0.047833, 0.055892] | 0.000 [0.000, 0.000] | 36,746 [35,784, 38,003] |
| 2007 (7) | 57,137 [55,482, 57,352] | 56.677 [55.926, 57.234] | 0.049419 [0.043398, 0.051369] | 0.000 [0.000, 0.000] | 46,694 [42,560, 51,174] |
| 2008 (8) | 70,243 [68,790, 70,734] | 60.682 [58.062, 62.650] | 0.048664 [0.048219, 0.054746] | 0.000 [0.000, 0.000] | 55,657 [53,554, 57,768] |
| 2009 (9) | 83,471 [82,341, 84,087] | 64.301 [63.301, 66.784] | 0.066902 [0.061267, 0.073749] | 0.000 [0.000, 0.000] | 23,323 [21,603, 47,426] |
| 2010 (10) | 96,965 [95,898, 97,480] | 64.513 [61.867, 65.073] | 0.065400 [0.056690, 0.074170] | 0.000 [0.000, 2.515] | 38,008 [27,919, 64,833] |
| 2011 (11) | 111,116 [110,004, 111,424] | 62.939 [61.810, 64.042] | 0.059306 [0.051073, 0.064560] | 0.000 [0.000, 2.238] | 67,058 [54,169, 72,471] |
| 2012 (12) | 126,617 [125,426, 127,871] | 63.032 [61.631, 65.247] | 0.052271 [0.048214, 0.056295] | 0.000 [0.000, 2.062] | 85,764 [80,636, 92,088] |
| 2013 (13) | 143,996 [141,572, 145,099] | 63.774 [62.408, 65.621] | 0.050503 [0.047794, 0.055597] | 0.000 [0.000, 1.949] | 102,478 [88,127, 105,816] |
| 2014 (14) | 161,787 [158,959, 163,315] | 68.722 [64.001, 70.254] | 0.052701 [0.046243, 0.057348] | 0.000 [0.000, 1.917] | 109,982 [97,235, 115,833] |
| 2015 (15) | 181,906 [178,036, 182,186] | 70.214 [66.292, 71.496] | 0.054461 [0.045227, 0.057499] | 0.000 [0.000, 1.881] | 133,209 [130,375, 135,659] |
| 2016 (16) | 200,640 [198,240, 202,020] | 71.242 [70.407, 72.099] | 0.051700 [0.044553, 0.057711] | 0.000 [0.000, 1.864] | 142,909 [106,770, 150,532] |
| 2017 (17) | 219,844 [217,286, 221,800] | 71.214 [70.607, 72.648] | 0.055860 [0.049520, 0.059167] | 0.000 [0.000, 1.877] | 161,682 [139,753, 177,259] |
| 2018 (18) | 239,529 [237,692, 242,597] | 71.855 [70.824, 73.114] | 0.053567 [0.049512, 0.058528] | 0.000 [0.000, 1.907] | 182,768 [150,804, 189,514] |
| 2019 (19) | 261,512 [259,275, 264,440] | 73.056 [71.966, 73.705] | 0.053451 [0.051041, 0.055175] | 0.000 [0.000, 1.896] | 207,387 [170,704, 219,543] |
| 2020 (20) | 283,705 [281,141, 286,871] | 74.132 [72.803, 76.274] | 0.053054 [0.050378, 0.054895] | 0.000 [0.000, 1.889] | 232,687 [197,056, 288,675] |
| 2021 (21) | 308,038 [304,230, 309,703] | 76.295 [75.041, 78.114] | 0.052733 [0.050689, 0.055230] | 0.000 [0.000, 1.893] | 264,557 [215,081, 283,203] |
| 2022 (22) | 331,325 [327,632, 332,634] | 76.968 [76.190, 77.853] | 0.054958 [0.051398, 0.057743] | 0.000 [0.000, 1.896] | 307,875 [247,664, 423,056] |
| 2023 (23) | 354,942 [350,550, 356,727] | 77.056 [76.533, 78.342] | 0.058086 [0.056510, 0.061178] | 0.000 [0.000, 1.892] | 545,378 [309,140, 687,439] |
| 2024 (24) | 379,933 [375,711, 381,280] | 77.252 [76.719, 78.216] | 0.060092 [0.057280, 0.064096] | 0.000 [0.000, 1.889] | 900,707 [598,128, 1,045,714] |
| 2025 (25) | 404,995 [401,247, 407,308] | 77.404 [76.691, 78.530] | 0.062153 [0.057801, 0.066390] | 0.000 [0.000, 1.896] | 1,298,094 [966,752, 1,470,337] |
| 2026 (26) | 430,696 [427,262, 433,375] | 77.707 [76.507, 78.866] | 0.061600 [0.056146, 0.065342] | 0.000 [0.000, 1.887] | 1,762,785 [1,421,932, 1,959,355] |
| 2027 (27) | 458,339 [455,854, 460,555] | 77.963 [77.226, 79.196] | 0.062275 [0.058483, 0.069361] | 0.000 [0.000, 1.891] | 2,174,668 [1,834,264, 2,531,930] |
| 2028 (28) | 488,113 [484,875, 490,195] | 78.468 [77.048, 79.647] | 0.062540 [0.058873, 0.068527] | 0.000 [0.000, 1.888] | 2,817,897 [2,388,456, 3,028,373] |
| 2029 (29) | 519,426 [516,173, 521,138] | 80.542 [78.898, 82.021] | 0.066631 [0.061330, 0.071735] | 0.000 [0.000, 1.897] | 2,871,205 [2,805,235, 3,009,185] |
| 2030 (30) | 550,624 [546,564, 551,918] | 81.353 [80.440, 82.579] | 0.068498 [0.065276, 0.076871] | 0.000 [0.000, 1.903] | 3,073,319 [2,931,361, 3,426,608] |
| 2031 (31) | 581,972 [577,960, 583,812] | 82.299 [80.890, 83.090] | 0.072550 [0.067425, 0.078949] | 0.000 [0.000, 1.854] | 3,301,747 [3,102,902, 3,766,350] |
| 2032 (32) | 613,982 [609,526, 615,695] | 82.348 [80.770, 83.007] | 0.077808 [0.070896, 0.084975] | 0.000 [0.000, 1.748] | 3,602,383 [3,335,760, 4,162,800] |
| 2033 (33) | 646,069 [642,046, 647,410] | 82.884 [81.882, 83.464] | 0.082632 [0.074759, 0.089162] | 0.000 [0.000, 1.717] | 3,936,936 [3,607,596, 4,490,262] |
| 2034 (34) | 678,799 [672,979, 680,173] | 82.374 [81.645, 83.448] | 0.085731 [0.078209, 0.098088] | 0.000 [0.000, 1.040] | 4,328,162 [3,946,889, 4,778,637] |
| 2035 (35) | 711,357 [705,976, 713,449] | 82.945 [82.232, 83.271] | 0.090575 [0.085862, 0.101850] | 0.000 [0.000, 1.029] | 4,780,250 [4,364,879, 5,117,374] |
| 2036 (36) | 744,675 [739,001, 747,324] | 82.898 [81.917, 83.794] | 0.098178 [0.087935, 0.108895] | 0.000 [0.000, 0.971] | 5,152,680 [4,853,696, 5,534,705] |
| 2037 (37) | 779,175 [772,878, 781,089] | 82.833 [81.995, 83.379] | 0.102669 [0.091007, 0.112255] | 0.000 [0.000, 0.932] | 5,413,175 [5,236,882, 5,956,536] |
| 2038 (38) | 813,917 [808,347, 817,238] | 82.660 [82.092, 83.095] | 0.110808 [0.096663, 0.116908] | 0.000 [0.000, 0.866] | 5,638,910 [5,451,164, 6,440,399] |
| 2039 (39) | 849,434 [842,033, 851,527] | 82.883 [81.655, 83.340] | 0.117220 [0.098010, 0.122615] | 0.000 [0.000, 0.425] | 5,935,455 [5,709,441, 6,985,023] |
| 2040 (40) | 884,950 [877,830, 889,046] | 82.578 [81.844, 83.288] | 0.121163 [0.106189, 0.128265] | 0.000 [0.000, 0.415] | 6,237,580 [6,001,471, 7,338,005] |
| 2041 (41) | 920,072 [910,873, 921,518] | 82.266 [80.756, 83.345] | 0.121830 [0.108432, 0.133657] | 0.000 [0.000, 0.000] | 6,578,582 [6,348,676, 7,945,444] |
| 2042 (42) | 953,793 [949,524, 962,356] | 82.289 [80.924, 83.343] | 0.128274 [0.114488, 0.138668] | 0.000 [0.000, 0.000] | 6,949,845 [6,745,773, 8,460,730] |
| 2043 (43) | 990,733 [986,627, 1,000,305] | 82.162 [81.460, 82.694] | 0.133606 [0.111967, 0.147311] | 0.000 [0.000, 0.000] | 7,390,958 [7,049,072, 8,818,545] |
| 2044 (44) | 1,030,567 [1,024,994, 1,041,420] | 82.048 [81.519, 82.673] | 0.136166 [0.116997, 0.151498] | 0.000 [0.000, 0.000] | 7,725,781 [7,418,628, 9,174,732] |
| 2045 (45) | 1,067,904 [1,060,832, 1,077,754] | 81.636 [81.159, 82.443] | 0.144520 [0.128122, 0.157909] | 0.000 [0.000, 0.000] | 8,113,040 [7,831,371, 9,539,509] |
| 2046 (46) | 1,106,236 [1,095,621, 1,118,036] | 81.250 [80.376, 82.544] | 0.146174 [0.131222, 0.165619] | 0.000 [0.000, 0.000] | 8,554,587 [8,238,021, 9,912,785] |
| 2047 (47) | 1,146,800 [1,135,527, 1,159,774] | 81.462 [80.006, 82.617] | 0.153072 [0.131962, 0.165768] | 0.000 [0.000, 0.000] | 9,066,938 [8,677,134, 10,310,713] |
| 2048 (48) | 1,187,090 [1,175,610, 1,196,899] | 81.393 [80.002, 82.034] | 0.150267 [0.134751, 0.169182] | 0.000 [0.000, 0.000] | 9,611,360 [9,114,587, 10,723,385] |
| 2049 (49) | 1,227,534 [1,213,013, 1,235,638] | 81.153 [79.878, 81.993] | 0.157848 [0.137682, 0.176812] | 0.000 [0.000, 0.000] | 10,156,015 [9,549,594, 11,160,709] |
| 2050 (50) | 1,271,227 [1,259,855, 1,278,476] | 81.101 [80.016, 81.762] | 0.160017 [0.138547, 0.168771] | 0.000 [0.000, 0.436] | 10,708,989 [9,922,724, 11,602,546] |
| 2051 (51) | 1,309,300 [1,298,862, 1,323,737] | 80.840 [79.467, 81.341] | 0.158936 [0.139041, 0.175862] | 0.000 [0.000, 1.856] | 11,248,949 [10,294,989, 12,139,175] |
| 2052 (52) | 1,349,235 [1,333,883, 1,363,599] | 80.310 [79.884, 81.058] | 0.158138 [0.141787, 0.172991] | 0.913 [0.000, 2.235] | 11,642,202 [10,681,555, 12,691,940] |
| 2053 (53) | 1,388,969 [1,331,686, 1,407,324] | 80.871 [79.971, 81.662] | 0.166088 [0.141480, 0.177641] | 1.035 [0.000, 3.049] | 11,990,349 [11,053,589, 13,263,517] |
| 2054 (54) | 1,412,721 [1,334,808, 1,450,196] | 80.258 [79.996, 81.706] | 0.157747 [0.141861, 0.178438] | 1.633 [0.000, 4.328] | 12,389,480 [11,453,349, 13,862,186] |
| 2055 (55) | 1,435,078 [1,347,246, 1,492,494] | 80.559 [79.551, 81.517] | 0.162547 [0.143918, 0.181893] | 2.607 [0.000, 5.062] | 12,793,480 [11,869,462, 14,436,989] |
| 2056 (56) | 1,447,639 [1,357,297, 1,503,823] | 80.926 [79.558, 81.507] | 0.167896 [0.147033, 0.176947] | 2.971 [0.000, 6.991] | 13,200,709 [12,290,125, 15,054,949] |
| 2057 (57) | 1,457,152 [1,373,139, 1,516,295] | 80.755 [79.470, 81.692] | 0.162468 [0.144660, 0.185982] | 4.126 [0.000, 8.043] | 13,589,863 [12,712,910, 15,703,349] |
| 2058 (58) | 1,473,558 [1,377,115, 1,522,274] | 80.970 [80.069, 81.370] | 0.163300 [0.143259, 0.182736] | 5.430 [0.000, 10.131] | 14,140,451 [13,142,626, 16,375,938] |
| 2059 (59) | 1,486,433 [1,396,126, 1,528,143] | 80.754 [79.431, 81.589] | 0.161205 [0.140962, 0.177966] | 6.847 [0.000, 11.451] | 14,597,922 [13,592,721, 17,073,658] |
| 2060 (60) | 1,492,437 [1,394,907, 1,533,543] | 80.770 [79.322, 81.301] | 0.164663 [0.147147, 0.183150] | 7.511 [0.000, 12.286] | 15,038,951 [14,055,519, 17,796,177] |

#### Annual comparison with dev

`ihtShare` values and margins in this comparison use fractions (0.01 = one percentage point); the annual table above displays percent.

| Year | Metric | Dev median [min, max] | Lane median | Δmedian | Δ % | Passing interval | Margin to nearest boundary | Verdict |
| --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- |
| 2010 | population | 96,965.000000 [95,898.000000, 97,480.000000] | 96,965.000000 | 0.000000 | 0.0000 | [95,995.350000, 97,480.000000] | +515.000000 | pass |
| 2010 | approval | 64.513165 [61.866754, 65.072707] | 64.513165 | 0.000000 | 0.0000 | [62.910189, 65.072707] | +0.559542 | pass |
| 2010 | air | 0.065400 [0.056690, 0.074170] | 0.065400 | 0.000000 | 0.0000 | [0.056690, 0.074141] | +0.008710 | pass |
| 2010 | ihtShare | 0.000000 [0.000000, 0.025153] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.012576] | 0.000000 | pass |
| 2011 | population | 111,116.000000 [110,004.000000, 111,424.000000] | 111,116.000000 | 0.000000 | 0.0000 | [110,004.840000, 111,424.000000] | +308.000000 | pass |
| 2011 | approval | 62.939346 [61.809728, 64.042029] | 62.939346 | 0.000000 | 0.0000 | [61.823195, 64.042029] | +1.102683 | pass |
| 2011 | air | 0.059306 [0.051073, 0.064560] | 0.059306 | 0.000000 | 0.0000 | [0.052563, 0.064560] | +0.005253 | pass |
| 2011 | ihtShare | 0.000000 [0.000000, 0.022382] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.011191] | 0.000000 | pass |
| 2012 | population | 126,617.000000 [125,426.000000, 127,871.000000] | 126,617.000000 | 0.000000 | 0.0000 | [125,426.000000, 127,871.000000] | +1191.000000 | pass |
| 2012 | approval | 63.031628 [61.631207, 65.246920] | 63.031628 | 0.000000 | 0.0000 | [61.631207, 64.839485] | +1.400421 | pass |
| 2012 | air | 0.052271 [0.048214, 0.056295] | 0.052271 | 0.000000 | 0.0000 | [0.048230, 0.056295] | +0.004024 | pass |
| 2012 | ihtShare | 0.000000 [0.000000, 0.020624] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.010312] | 0.000000 | pass |
| 2013 | population | 143,996.000000 [141,572.000000, 145,099.000000] | 143,996.000000 | 0.000000 | 0.0000 | [142,232.500000, 145,099.000000] | +1103.000000 | pass |
| 2013 | approval | 63.773720 [62.408336, 65.627238] | 63.773720 | 0.000000 | 0.0000 | [62.408336, 65.383171] | +1.365384 | pass |
| 2013 | air | 0.050503 [0.047794, 0.055597] | 0.050503 | 0.000000 | 0.0000 | [0.047794, 0.054404] | +0.002709 | pass |
| 2013 | ihtShare | 0.000000 [0.000000, 0.019488] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009744] | 0.000000 | pass |
| 2014 | population | 162,461.000000 [158,959.000000, 163,214.000000] | 161,787.000000 | -674.000000 | -0.4149 | [160,333.500000, 163,214.000000] | +1427.000000 | pass |
| 2014 | approval | 68.721816 [64.001443, 70.235530] | 68.721816 | 0.000000 | 0.0000 | [65.604772, 70.235530] | +1.513715 | pass |
| 2014 | air | 0.053548 [0.046244, 0.057348] | 0.052701 | -0.000847 | -1.5821 | [0.047996, 0.057348] | +0.004647 | pass |
| 2014 | ihtShare | 0.000000 [0.000000, 0.019166] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009583] | 0.000000 | pass |
| 2015 | population | 181,549.000000 [178,036.000000, 182,428.000000] | 181,906.000000 | +357.000000 | +0.1966 | [179,353.000000, 182,428.000000] | +522.000000 | pass |
| 2015 | approval | 69.990400 [66.291755, 71.146720] | 70.214200 | +0.223800 | +0.3198 | [67.562917, 71.146720] | +0.932520 | pass |
| 2015 | air | 0.051467 [0.045746, 0.056549] | 0.054461 | +0.002994 | +5.8174 | [0.046066, 0.056549] | +0.002088 | pass |
| 2015 | ihtShare | 0.000000 [0.000000, 0.018812] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009406] | 0.000000 | pass |
| 2016 | population | 201,032.000000 [198,458.000000, 202,147.000000] | 200,640.000000 | -392.000000 | -0.1950 | [199,021.680000, 202,147.000000] | +1507.000000 | pass |
| 2016 | approval | 70.958706 [70.402550, 72.311562] | 71.242269 | +0.283563 | +0.3996 | [70.402550, 71.913212] | +0.670943 | pass |
| 2016 | air | 0.052439 [0.044153, 0.056537] | 0.051700 | -0.000739 | -1.4087 | [0.046247, 0.056537] | +0.004836 | pass |
| 2016 | ihtShare | 0.000000 [0.000000, 0.018644] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009322] | 0.000000 | pass |
| 2017 | population | 220,235.000000 [217,287.000000, 221,560.000000] | 219,844.000000 | -391.000000 | -0.1775 | [218,032.650000, 221,560.000000] | +1716.000000 | pass |
| 2017 | approval | 71.213611 [70.174724, 72.371610] | 71.214166 | +0.000554 | +0.0008 | [70.174724, 72.312055] | +1.039442 | pass |
| 2017 | air | 0.057306 [0.050383, 0.062885] | 0.055860 | -0.001446 | -2.5228 | [0.051055, 0.062885] | +0.004805 | pass |
| 2017 | ihtShare | 0.000000 [0.000000, 0.018692] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009346] | 0.000000 | pass |
| 2018 | population | 240,111.000000 [237,922.000000, 242,097.000000] | 239,529.000000 | -582.000000 | -0.2424 | [237,922.000000, 242,097.000000] | +1607.000000 | pass |
| 2018 | approval | 71.758047 [70.817567, 73.153183] | 71.854758 | +0.096711 | +0.1348 | [70.817567, 72.925855] | +1.037191 | pass |
| 2018 | air | 0.054557 [0.050128, 0.060823] | 0.053567 | -0.000990 | -1.8145 | [0.050128, 0.059904] | +0.003439 | pass |
| 2018 | ihtShare | 0.000000 [0.000000, 0.018765] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009382] | 0.000000 | pass |
| 2019 | population | 261,751.000000 [258,901.000000, 264,481.000000] | 261,512.000000 | -239.000000 | -0.0913 | [258,961.000000, 264,481.000000] | +2551.000000 | pass |
| 2019 | approval | 72.793509 [72.031699, 74.568255] | 73.055920 | +0.262411 | +0.3605 | [72.031699, 74.061787] | +1.005867 | pass |
| 2019 | air | 0.052887 [0.050402, 0.056052] | 0.053451 | +0.000564 | +1.0670 | [0.050402, 0.055712] | +0.002261 | pass |
| 2019 | ihtShare | 0.000000 [0.000000, 0.018578] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009289] | 0.000000 | pass |
| 2020 | population | 284,274.000000 [280,865.000000, 287,234.000000] | 283,705.000000 | -569.000000 | -0.2002 | [281,089.500000, 287,234.000000] | +2615.500000 | pass |
| 2020 | approval | 73.809515 [72.996400, 76.716866] | 74.131853 | +0.322338 | +0.4367 | [72.996400, 75.669748] | +1.135454 | pass |
| 2020 | air | 0.052379 [0.049630, 0.055717] | 0.053054 | +0.000675 | +1.2887 | [0.049630, 0.055423] | +0.002369 | pass |
| 2020 | ihtShare | 0.000000 [0.000000, 0.018524] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009262] | 0.000000 | pass |
| 2021 | population | 307,076.000000 [303,929.000000, 310,168.000000] | 308,038.000000 | +962.000000 | +0.3133 | [303,956.500000, 310,168.000000] | +2130.000000 | pass |
| 2021 | approval | 76.552718 [75.184065, 77.754084] | 76.294586 | -0.258131 | -0.3372 | [75.267708, 77.754084] | +1.026878 | pass |
| 2021 | air | 0.052287 [0.049701, 0.057203] | 0.052733 | +0.000446 | +0.8525 | [0.049701, 0.056038] | +0.003032 | pass |
| 2021 | ihtShare | 0.000000 [0.000000, 0.018588] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009294] | 0.000000 | pass |
| 2022 | population | 331,227.000000 [327,213.000000, 333,566.000000] | 331,325.000000 | +98.000000 | +0.0296 | [327,914.730000, 333,566.000000] | +2241.000000 | pass |
| 2022 | approval | 77.209454 [76.047912, 77.489004] | 76.968114 | -0.241341 | -0.3126 | [76.488909, 77.489004] | +0.479205 | pass |
| 2022 | air | 0.054574 [0.050176, 0.058413] | 0.054958 | +0.000385 | +0.7046 | [0.050455, 0.058413] | +0.003455 | pass |
| 2022 | ihtShare | 0.000000 [0.000000, 0.018576] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009288] | 0.000000 | pass |
| 2023 | population | 354,705.000000 [350,807.000000, 357,155.000000] | 354,942.000000 | +237.000000 | +0.0668 | [351,157.950000, 357,155.000000] | +2213.000000 | pass |
| 2023 | approval | 77.293919 [76.288757, 77.933607] | 77.055966 | -0.237953 | -0.3079 | [76.471493, 77.933607] | +0.584472 | pass |
| 2023 | air | 0.057738 [0.054987, 0.062385] | 0.058086 | +0.000348 | +0.6020 | [0.054987, 0.061438] | +0.003099 | pass |
| 2023 | ihtShare | 0.000000 [0.000000, 0.018594] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009297] | 0.000000 | pass |
| 2024 | population | 379,628.000000 [375,350.000000, 381,880.000000] | 379,933.000000 | +305.000000 | +0.0803 | [375,831.720000, 381,880.000000] | +1947.000000 | pass |
| 2024 | approval | 76.818427 [76.460377, 78.169196] | 77.252235 | +0.433808 | +0.5647 | [76.460377, 77.672836] | +0.420601 | pass |
| 2024 | air | 0.059957 [0.057229, 0.065666] | 0.060092 | +0.000135 | +0.2253 | [0.057229, 0.064176] | +0.002863 | pass |
| 2024 | ihtShare | 0.000000 [0.000000, 0.018571] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009286] | 0.000000 | pass |
| 2025 | population | 405,373.000000 [400,281.000000, 406,789.000000] | 404,995.000000 | -378.000000 | -0.0932 | [401,319.270000, 406,789.000000] | +1794.000000 | pass |
| 2025 | approval | 76.912012 [76.264005, 78.004875] | 77.403510 | +0.491498 | +0.6390 | [76.264005, 77.782447] | +0.378937 | pass |
| 2025 | air | 0.062913 [0.058150, 0.066890] | 0.062153 | -0.000760 | -1.2080 | [0.058543, 0.066890] | +0.003610 | pass |
| 2025 | ihtShare | 0.000000 [0.000000, 0.018577] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009288] | 0.000000 | pass |
| 2026 | population | 431,452.000000 [426,244.000000, 432,624.000000] | 430,696.000000 | -756.000000 | -0.1752 | [427,137.480000, 432,624.000000] | +1928.000000 | pass |
| 2026 | approval | 77.534774 [76.564683, 78.244625] | 77.707217 | +0.172443 | +0.2224 | [76.694802, 78.244625] | +0.537408 | pass |
| 2026 | air | 0.061408 [0.056411, 0.067051] | 0.061600 | +0.000192 | +0.3122 | [0.056411, 0.066728] | +0.005128 | pass |
| 2026 | ihtShare | 0.000000 [0.000000, 0.018445] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009223] | 0.000000 | pass |
| 2027 | population | 459,324.000000 [454,626.000000, 460,015.000000] | 458,339.000000 | -985.000000 | -0.2144 | [454,730.760000, 460,015.000000] | +1676.000000 | pass |
| 2027 | approval | 77.591061 [76.516536, 78.806732] | 77.962704 | +0.371643 | +0.4790 | [76.516536, 78.736159] | +0.773455 | pass |
| 2027 | air | 0.063114 [0.057175, 0.069608] | 0.062275 | -0.000838 | -1.3284 | [0.057175, 0.069330] | +0.005101 | pass |
| 2027 | ihtShare | 0.000000 [0.000000, 0.018408] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009204] | 0.000000 | pass |
| 2028 | population | 488,133.000000 [484,568.000000, 489,945.000000] | 488,113.000000 | -20.000000 | -0.0041 | [484,568.000000, 489,945.000000] | +1832.000000 | pass |
| 2028 | approval | 78.003959 [77.091076, 80.159430] | 78.467949 | +0.463990 | +0.5948 | [77.091076, 79.538136] | +1.070188 | pass |
| 2028 | air | 0.062980 [0.058385, 0.071639] | 0.062540 | -0.000440 | -0.6985 | [0.058385, 0.069607] | +0.004155 | pass |
| 2028 | ihtShare | 0.000000 [0.000000, 0.018405] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009202] | 0.000000 | pass |
| 2029 | population | 518,809.000000 [515,169.000000, 520,829.000000] | 519,426.000000 | +617.000000 | +0.1189 | [515,169.000000, 520,829.000000] | +1403.000000 | pass |
| 2029 | approval | 80.266762 [78.817776, 81.600923] | 80.541774 | +0.275011 | +0.3426 | [78.875189, 81.600923] | +1.059149 | pass |
| 2029 | air | 0.065344 [0.061447, 0.075015] | 0.066631 | +0.001287 | +1.9692 | [0.061447, 0.072128] | +0.005184 | pass |
| 2029 | ihtShare | 0.000000 [0.000000, 0.018529] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009265] | 0.000000 | pass |
| 2030 | population | 549,130.000000 [545,987.000000, 551,504.000000] | 550,624.000000 | +1494.000000 | +0.2721 | [545,987.000000, 551,504.000000] | +880.000000 | pass |
| 2030 | approval | 81.440401 [79.232013, 81.860170] | 81.353314 | -0.087087 | -0.1069 | [80.126323, 81.860170] | +0.506856 | pass |
| 2030 | air | 0.069741 [0.062872, 0.076904] | 0.068498 | -0.001244 | -1.7833 | [0.062872, 0.076757] | +0.005626 | pass |
| 2030 | ihtShare | 0.000000 [0.000000, 0.018519] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.009259] | 0.000000 | pass |
| 2031 | population | 580,247.000000 [577,395.000000, 583,309.000000] | 581,972.000000 | +1725.000000 | +0.2973 | [577,395.000000, 583,309.000000] | +1337.000000 | pass |
| 2031 | approval | 81.860673 [80.923480, 82.372373] | 82.298787 | +0.438115 | +0.5352 | [81.136226, 82.372373] | +0.073586 | pass |
| 2031 | air | 0.074493 [0.067505, 0.083421] | 0.072550 | -0.001942 | -2.6074 | [0.067505, 0.082451] | +0.005046 | pass |
| 2031 | ihtShare | 0.000000 [0.000000, 0.017914] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.008957] | 0.000000 | pass |
| 2032 | population | 613,277.000000 [608,730.000000, 615,409.000000] | 613,982.000000 | +705.000000 | +0.1150 | [608,730.000000, 615,409.000000] | +1427.000000 | pass |
| 2032 | approval | 82.080383 [81.539946, 82.817546] | 82.348180 | +0.267797 | +0.3263 | [81.539946, 82.719183] | +0.371003 | pass |
| 2032 | air | 0.077513 [0.071208, 0.085898] | 0.077808 | +0.000295 | +0.3806 | [0.071208, 0.084858] | +0.006600 | pass |
| 2032 | ihtShare | 0.000000 [0.000000, 0.017426] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.008713] | 0.000000 | pass |
| 2033 | population | 645,069.000000 [641,046.000000, 648,681.000000] | 646,069.000000 | +1000.000000 | +0.1550 | [641,046.000000, 648,681.000000] | +2612.000000 | pass |
| 2033 | approval | 82.361918 [81.444775, 83.294922] | 82.884272 | +0.522354 | +0.6342 | [81.444775, 83.286991] | +0.402719 | pass |
| 2033 | air | 0.083733 [0.074329, 0.090831] | 0.082632 | -0.001100 | -1.3143 | [0.075481, 0.090831] | +0.007151 | pass |
| 2033 | ihtShare | 0.000000 [0.000000, 0.013508] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.006754] | 0.000000 | pass |
| 2034 | population | 678,240.000000 [671,270.000000, 681,039.000000] | 678,799.000000 | +559.000000 | +0.0824 | [671,457.600000, 681,039.000000] | +2240.000000 | pass |
| 2034 | approval | 82.482752 [81.614885, 82.969450] | 82.374424 | -0.108328 | -0.1313 | [81.805469, 82.969450] | +0.568954 | pass |
| 2034 | air | 0.086747 [0.076779, 0.101734] | 0.085731 | -0.001015 | -1.1706 | [0.076779, 0.099224] | +0.008952 | pass |
| 2034 | ihtShare | 0.000000 [0.000000, 0.009776] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.004888] | 0.000000 | pass |
| 2035 | population | 711,356.000000 [705,812.000000, 714,537.000000] | 711,357.000000 | +1.000000 | +0.0001 | [705,812.000000, 714,537.000000] | +3180.000000 | pass |
| 2035 | approval | 82.529374 [81.232581, 82.892147] | 82.944644 | +0.415269 | +0.5032 | [81.699591, 82.892147] | -0.052496 | fail |
| 2035 | air | 0.093835 [0.083873, 0.100117] | 0.090575 | -0.003260 | -3.4738 | [0.085713, 0.100117] | +0.004862 | pass |
| 2035 | ihtShare | 0.000000 [0.000000, 0.009151] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.004575] | 0.000000 | pass |
| 2036 | population | 744,626.000000 [738,362.000000, 749,055.000000] | 744,675.000000 | +49.000000 | +0.0066 | [738,362.000000, 749,055.000000] | +4380.000000 | pass |
| 2036 | approval | 82.583011 [81.851181, 83.806878] | 82.897745 | +0.314733 | +0.3811 | [81.851181, 83.560860] | +0.663115 | pass |
| 2036 | air | 0.100810 [0.090213, 0.107488] | 0.098178 | -0.002632 | -2.6109 | [0.092173, 0.107488] | +0.006006 | pass |
| 2036 | ihtShare | 0.000000 [0.000000, 0.004347] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.002173] | 0.000000 | pass |
| 2037 | population | 778,119.000000 [773,730.000000, 782,802.000000] | 779,175.000000 | +1056.000000 | +0.1357 | [773,730.000000, 782,802.000000] | +3627.000000 | pass |
| 2037 | approval | 82.648757 [82.041069, 83.143764] | 82.833216 | +0.184459 | +0.2232 | [82.097410, 83.143764] | +0.310548 | pass |
| 2037 | air | 0.103446 [0.093099, 0.113785] | 0.102669 | -0.000776 | -0.7505 | [0.093102, 0.113785] | +0.009567 | pass |
| 2037 | ihtShare | 0.000000 [0.000000, 0.004136] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.002068] | 0.000000 | pass |
| 2038 | population | 813,825.000000 [807,517.000000, 817,770.000000] | 813,917.000000 | +92.000000 | +0.0113 | [807,517.000000, 817,770.000000] | +3853.000000 | pass |
| 2038 | approval | 82.249610 [81.422337, 82.954038] | 82.659875 | +0.410265 | +0.4988 | [81.483759, 82.954038] | +0.294162 | pass |
| 2038 | air | 0.108827 [0.097531, 0.119280] | 0.110808 | +0.001981 | +1.8200 | [0.097953, 0.119280] | +0.008472 | pass |
| 2038 | ihtShare | 0.000000 [0.000000, 0.004098] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.002049] | 0.000000 | pass |
| 2039 | population | 845,902.000000 [841,049.000000, 853,196.000000] | 849,434.000000 | +3532.000000 | +0.4175 | [841,049.000000, 853,196.000000] | +3762.000000 | pass |
| 2039 | approval | 82.561060 [81.556214, 83.179825] | 82.882940 | +0.321880 | +0.3899 | [81.749255, 83.179825] | +0.296885 | pass |
| 2039 | air | 0.117282 [0.103999, 0.126057] | 0.117220 | -0.000062 | -0.0526 | [0.106253, 0.126057] | +0.008837 | pass |
| 2039 | ihtShare | 0.000000 [0.000000, 0.004111] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.002056] | 0.000000 | pass |
| 2040 | population | 883,512.000000 [878,323.000000, 889,836.000000] | 884,950.000000 | +1438.000000 | +0.1628 | [878,323.000000, 889,836.000000] | +4886.000000 | pass |
| 2040 | approval | 82.922116 [81.945484, 83.257913] | 82.577560 | -0.344555 | -0.4155 | [82.265901, 83.257913] | +0.311659 | pass |
| 2040 | air | 0.119225 [0.106316, 0.129887] | 0.121163 | +0.001938 | +1.6256 | [0.107439, 0.129887] | +0.008724 | pass |
| 2040 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2041 | population | 914,777.000000 [913,253.000000, 927,072.000000] | 920,072.000000 | +5295.000000 | +0.5788 | [913,253.000000, 923,924.770000] | +3852.770000 | pass |
| 2041 | approval | 82.302044 [81.131021, 82.881996] | 82.266370 | -0.035674 | -0.0433 | [81.426557, 82.881996] | +0.615626 | pass |
| 2041 | air | 0.124134 [0.111427, 0.142697] | 0.121830 | -0.002304 | -1.8559 | [0.111427, 0.139769] | +0.010403 | pass |
| 2041 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2042 | population | 955,849.000000 [947,049.000000, 962,805.000000] | 953,793.000000 | -2056.000000 | -0.2151 | [947,049.000000, 962,805.000000] | +6744.000000 | pass |
| 2042 | approval | 82.168555 [81.583607, 82.855949] | 82.289043 | +0.120488 | +0.1466 | [81.583607, 82.804726] | +0.515683 | pass |
| 2042 | air | 0.128761 [0.115737, 0.144575] | 0.128274 | -0.000487 | -0.3782 | [0.115737, 0.143180] | +0.012537 | pass |
| 2042 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2043 | population | 993,905.000000 [981,631.000000, 999,561.000000] | 990,733.000000 | -3172.000000 | -0.3191 | [983,965.950000, 999,561.000000] | +6767.050000 | pass |
| 2043 | approval | 82.004656 [81.005473, 82.462452] | 82.162157 | +0.157501 | +0.1921 | [81.276167, 82.462452] | +0.300295 | pass |
| 2043 | air | 0.132343 [0.116848, 0.146611] | 0.133606 | +0.001263 | +0.9544 | [0.117461, 0.146611] | +0.013005 | pass |
| 2043 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2044 | population | 1,031,139.000000 [1,017,766.000000, 1,038,005.000000] | 1,030,567.000000 | -572.000000 | -0.0555 | [1,020,827.610000, 1,038,005.000000] | +7438.000000 | pass |
| 2044 | approval | 81.673885 [80.856138, 82.351654] | 82.047879 | +0.373994 | +0.4579 | [80.926128, 82.351654] | +0.303775 | pass |
| 2044 | air | 0.139037 [0.127841, 0.153304] | 0.136166 | -0.002871 | -2.0647 | [0.127841, 0.151768] | +0.008325 | pass |
| 2044 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2045 | population | 1,069,790.000000 [1,055,287.000000, 1,076,009.000000] | 1,067,904.000000 | -1886.000000 | -0.1763 | [1,059,092.100000, 1,076,009.000000] | +8105.000000 | pass |
| 2045 | approval | 81.362027 [80.198059, 82.471228] | 81.636277 | +0.274250 | +0.3371 | [80.225443, 82.471228] | +0.834951 | pass |
| 2045 | air | 0.143253 [0.133344, 0.158265] | 0.144520 | +0.001267 | +0.8845 | [0.133344, 0.155714] | +0.011177 | pass |
| 2045 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2046 | population | 1,109,236.000000 [1,094,324.000000, 1,115,154.000000] | 1,106,236.000000 | -3000.000000 | -0.2705 | [1,098,143.640000, 1,115,154.000000] | +8092.360000 | pass |
| 2046 | approval | 81.156899 [80.386412, 81.554803] | 81.249742 | +0.092843 | +0.1144 | [80.572703, 81.554803] | +0.305062 | pass |
| 2046 | air | 0.151972 [0.135720, 0.159906] | 0.146174 | -0.005798 | -3.8151 | [0.139878, 0.159906] | +0.006296 | pass |
| 2046 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2047 | population | 1,147,038.000000 [1,132,339.000000, 1,152,325.000000] | 1,146,800.000000 | -238.000000 | -0.0207 | [1,135,567.620000, 1,152,325.000000] | +5525.000000 | pass |
| 2047 | approval | 80.616788 [79.541246, 81.876270] | 81.461891 | +0.845104 | +1.0483 | [79.541246, 81.784300] | +0.322408 | pass |
| 2047 | air | 0.157108 [0.138410, 0.169139] | 0.153072 | -0.004037 | -2.5694 | [0.141744, 0.169139] | +0.011328 | pass |
| 2047 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2048 | population | 1,186,645.000000 [1,169,316.000000, 1,190,815.000000] | 1,187,090.000000 | +445.000000 | +0.0375 | [1,174,778.550000, 1,190,815.000000] | +3725.000000 | pass |
| 2048 | approval | 81.300278 [79.779126, 81.823414] | 81.392876 | +0.092598 | +0.1139 | [80.278134, 81.823414] | +0.430538 | pass |
| 2048 | air | 0.153944 [0.140154, 0.171809] | 0.150267 | -0.003677 | -2.3884 | [0.140154, 0.169771] | +0.010113 | pass |
| 2048 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2049 | population | 1,230,333.000000 [1,209,924.000000, 1,233,587.000000] | 1,227,534.000000 | -2799.000000 | -0.2275 | [1,218,029.670000, 1,233,587.000000] | +6053.000000 | pass |
| 2049 | approval | 80.534175 [79.830502, 81.423558] | 81.152906 | +0.618731 | +0.7683 | [79.830502, 81.330703] | +0.177797 | pass |
| 2049 | air | 0.155267 [0.144445, 0.173847] | 0.157848 | +0.002581 | +1.6626 | [0.144445, 0.169968] | +0.012120 | pass |
| 2049 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2050 | population | 1,266,953.000000 [1,254,073.000000, 1,276,465.000000] | 1,271,227.000000 | +4274.000000 | +0.3373 | [1,254,283.470000, 1,276,465.000000] | +5238.000000 | pass |
| 2050 | approval | 80.822172 [79.830743, 81.321436] | 81.100983 | +0.278811 | +0.3450 | [80.076825, 81.321436] | +0.220453 | pass |
| 2050 | air | 0.163261 [0.140626, 0.174208] | 0.160017 | -0.003244 | -1.9872 | [0.146470, 0.174208] | +0.013547 | pass |
| 2050 | ihtShare | 0.000000 [0.000000, 0.000000] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.000000] | 0.000000 | pass |
| 2051 | population | 1,310,276.000000 [1,295,571.000000, 1,317,330.000000] | 1,309,300.000000 | -976.000000 | -0.0745 | [1,297,173.240000, 1,317,330.000000] | +8030.000000 | pass |
| 2051 | approval | 80.421799 [79.663376, 80.892828] | 80.840306 | +0.418508 | +0.5204 | [79.807073, 80.892828] | +0.052521 | pass |
| 2051 | air | 0.161440 [0.146473, 0.175127] | 0.158936 | -0.002504 | -1.5513 | [0.147113, 0.175127] | +0.011823 | pass |
| 2051 | ihtShare | 0.000000 [0.000000, 0.010019] | 0.000000 | 0.000000 | 0.0000 | [0.000000, 0.005010] | 0.000000 | pass |
| 2052 | population | 1,353,432.000000 [1,335,822.000000, 1,358,146.000000] | 1,349,235.000000 | -4197.000000 | -0.3101 | [1,339,897.680000, 1,358,146.000000] | +8911.000000 | pass |
| 2052 | approval | 80.532339 [79.593908, 80.725192] | 80.310247 | -0.222092 | -0.2758 | [79.966697, 80.725192] | +0.343550 | pass |
| 2052 | air | 0.163856 [0.143862, 0.180875] | 0.158138 | -0.005718 | -3.4898 | [0.145349, 0.180875] | +0.012788 | pass |
| 2052 | ihtShare | 0.005203 [0.000000, 0.012521] | 0.009126 | +0.003924 | +75.4143 | [0.000000, 0.011463] | +0.002337 | pass |
| 2053 | population | 1,391,300.000000 [1,372,356.000000, 1,404,494.000000] | 1,388,969.000000 | -2331.000000 | -0.1675 | [1,375,231.000000, 1,404,494.000000] | +13738.000000 | pass |
| 2053 | approval | 80.814111 [79.313848, 81.187269] | 80.870742 | +0.056631 | +0.0701 | [79.877400, 81.187269] | +0.316528 | pass |
| 2053 | air | 0.161633 [0.142825, 0.182658] | 0.166088 | +0.004455 | +2.7561 | [0.142825, 0.181549] | +0.015462 | pass |
| 2053 | ihtShare | 0.016105 [0.000000, 0.025000] | 0.010348 | -0.005758 | -35.7493 | [0.003605, 0.025000] | +0.006742 | pass |
| 2054 | population | 1,410,655.000000 [1,388,950.000000, 1,450,423.000000] | 1,412,721.000000 | +2066.000000 | +0.1465 | [1,388,950.000000, 1,441,391.500000] | +23771.000000 | pass |
| 2054 | approval | 80.423610 [79.701350, 81.510728] | 80.258312 | -0.165298 | -0.2055 | [79.701350, 81.328300] | +0.556963 | pass |
| 2054 | air | 0.164057 [0.143360, 0.180829] | 0.157747 | -0.006309 | -3.8458 | [0.145323, 0.180829] | +0.012425 | pass |
| 2054 | ihtShare | 0.025673 [0.000000, 0.031626] | 0.016330 | -0.009343 | -36.3933 | [0.009860, 0.031626] | +0.006470 | pass |
| 2055 | population | 1,428,499.000000 [1,386,414.000000, 1,468,215.000000] | 1,435,078.000000 | +6579.000000 | +0.4606 | [1,387,598.500000, 1,468,215.000000] | +33137.000000 | pass |
| 2055 | approval | 80.740354 [79.930820, 81.717258] | 80.558584 | -0.181770 | -0.2251 | [79.930820, 81.633573] | +0.627764 | pass |
| 2055 | air | 0.165501 [0.144886, 0.184044] | 0.162547 | -0.002954 | -1.7848 | [0.145922, 0.184044] | +0.016625 | pass |
| 2055 | ihtShare | 0.028589 [0.000000, 0.040630] | 0.026069 | -0.002520 | -8.8143 | [0.008274, 0.040630] | +0.014560 | pass |
| 2056 | population | 1,444,001.000000 [1,400,344.000000, 1,478,360.000000] | 1,447,639.000000 | +3638.000000 | +0.2519 | [1,404,993.000000, 1,478,360.000000] | +30721.000000 | pass |
| 2056 | approval | 80.375631 [80.110601, 80.922619] | 80.926473 | +0.550842 | +0.6853 | [80.110601, 80.781640] | -0.144833 | fail |
| 2056 | air | 0.163848 [0.144752, 0.179428] | 0.167896 | +0.004048 | +2.4706 | [0.146510, 0.179428] | +0.011532 | pass |
| 2056 | ihtShare | 0.041271 [0.000000, 0.056866] | 0.029707 | -0.011564 | -28.0191 | [0.012838, 0.056866] | +0.016869 | pass |
| 2057 | population | 1,456,317.000000 [1,403,945.000000, 1,487,877.000000] | 1,457,152.000000 | +835.000000 | +0.0573 | [1,414,351.000000, 1,487,877.000000] | +30725.000000 | pass |
| 2057 | approval | 80.329177 [79.076655, 81.117180] | 80.755445 | +0.426269 | +0.5307 | [79.308914, 81.117180] | +0.361735 | pass |
| 2057 | air | 0.168617 [0.145910, 0.186551] | 0.162468 | -0.006149 | -3.6469 | [0.148297, 0.186551] | +0.014171 | pass |
| 2057 | ihtShare | 0.048963 [0.000000, 0.086366] | 0.041263 | -0.007701 | -15.7277 | [0.005781, 0.086366] | +0.035482 | pass |
| 2058 | population | 1,462,768.000000 [1,414,561.000000, 1,491,615.000000] | 1,473,558.000000 | +10790.000000 | +0.7376 | [1,424,241.000000, 1,491,615.000000] | +18057.000000 | pass |
| 2058 | approval | 80.212966 [79.518843, 80.863566] | 80.970422 | +0.757456 | +0.9443 | [79.540605, 80.863566] | -0.106856 | fail |
| 2058 | air | 0.168696 [0.142471, 0.182266] | 0.163300 | -0.005396 | -3.1988 | [0.148799, 0.182266] | +0.014501 | pass |
| 2058 | ihtShare | 0.050926 [0.000000, 0.098987] | 0.054301 | +0.003375 | +6.6269 | [0.001433, 0.098987] | +0.044686 | pass |
| 2059 | population | 1,482,680.000000 [1,416,617.000000, 1,504,263.000000] | 1,486,433.000000 | +3753.000000 | +0.2531 | [1,438,857.000000, 1,504,263.000000] | +17830.000000 | pass |
| 2059 | approval | 80.102785 [79.690658, 80.827008] | 80.753757 | +0.650972 | +0.8127 | [79.690658, 80.670961] | -0.082796 | fail |
| 2059 | air | 0.162670 [0.147304, 0.182974] | 0.161205 | -0.001465 | -0.9006 | [0.147304, 0.180504] | +0.013900 | pass |
| 2059 | ihtShare | 0.070867 [0.000000, 0.100958] | 0.068474 | -0.002394 | -3.3775 | [0.020388, 0.100958] | +0.032484 | pass |
| 2060 | population | 1,483,518.000000 [1,427,340.000000, 1,511,108.000000] | 1,492,437.000000 | +8919.000000 | +0.6012 | [1,441,634.000000, 1,511,108.000000] | +18671.000000 | pass |
| 2060 | approval | 80.441199 [79.137167, 81.356695] | 80.770068 | +0.328869 | +0.4088 | [79.331435, 81.356695] | +0.586627 | pass |
| 2060 | air | 0.170750 [0.147485, 0.190513] | 0.164663 | -0.006087 | -3.5649 | [0.149236, 0.190513] | +0.015427 | pass |
| 2060 | ihtShare | 0.081910 [0.000000, 0.105790] | 0.075114 | -0.006796 | -8.2971 | [0.029015, 0.105790] | +0.030676 | pass |

EQ ≥100 by year 30: highest annual ensemble median by that deadline is 121.5430 [119.7128, 122.2362] in 2030, pass.

Sampled-access consistency diagnostic: maximum |unemployment − (1 − stored access)| = 0.00075424 (m100-d1, 2058), within 0.02. The stored access is the last occupancy sample, not the fresh annual building-weighted access recomputation used by balance.test.ts; this diagnostic cannot certify G-UNEMP.

| Year | EQ median [min, max] | Realised I-HT share median (%) |
| --- | --- | ---: |
| 2010 | 79.4029 [77.2347, 81.7550] | 0.0000 |
| 2011 | 83.2709 [80.3164, 85.7089] | 0.0000 |
| 2012 | 86.1910 [82.8291, 88.9305] | 0.0000 |
| 2013 | 88.6438 [84.8558, 91.4623] | 0.0000 |
| 2014 | 90.6791 [86.4686, 93.4751] | 0.0000 |
| 2015 | 92.8099 [88.2730, 95.4318] | 0.0000 |
| 2016 | 95.4111 [90.9282, 97.6660] | 0.0000 |
| 2017 | 98.0463 [93.9071, 99.8709] | 0.0000 |
| 2018 | 100.4953 [96.7239, 102.2431] | 0.0000 |
| 2019 | 102.6090 [99.0998, 104.3525] | 0.0000 |
| 2020 | 104.6315 [101.2981, 106.0342] | 0.0000 |
| 2021 | 106.6426 [104.0959, 108.7748] | 0.0000 |
| 2022 | 109.6551 [106.8228, 111.1753] | 0.0000 |
| 2023 | 112.3814 [109.4855, 113.3213] | 0.0000 |
| 2024 | 114.2216 [111.7255, 115.1851] | 0.0000 |
| 2025 | 115.7044 [113.5542, 116.7509] | 0.0000 |
| 2026 | 117.0931 [115.1102, 118.0368] | 0.0000 |
| 2027 | 118.3114 [116.2687, 119.1546] | 0.0000 |
| 2028 | 119.3717 [117.2941, 120.2076] | 0.0000 |
| 2029 | 120.3597 [118.3660, 121.2372] | 0.0000 |
| 2030 | 121.5430 [119.7128, 122.2362] | 0.0000 |
| 2031 | 122.7713 [121.0865, 123.4612] | 0.0000 |
| 2032 | 123.7477 [122.0222, 124.4778] | 0.0000 |
| 2033 | 124.4570 [122.9290, 125.3168] | 0.0000 |
| 2034 | 125.1377 [123.7711, 126.0027] | 0.0000 |
| 2035 | 125.8514 [124.5028, 126.5611] | 0.0000 |
| 2036 | 126.4691 [125.1578, 127.0668] | 0.0000 |
| 2037 | 127.0099 [125.7881, 127.6005] | 0.0000 |
| 2038 | 127.5860 [126.5383, 128.1565] | 0.0000 |
| 2039 | 128.1513 [127.2078, 128.9455] | 0.0000 |
| 2040 | 128.6163 [127.7723, 129.5382] | 0.0000 |
| 2041 | 128.9493 [128.2348, 129.9679] | 0.0000 |
| 2042 | 129.1509 [128.5742, 130.2204] | 0.0000 |
| 2043 | 129.2932 [128.8073, 130.3990] | 0.0000 |
| 2044 | 129.4248 [128.9400, 130.5487] | 0.0000 |
| 2045 | 129.5614 [129.1191, 130.8014] | 0.0000 |
| 2046 | 129.8242 [129.2622, 130.9996] | 0.0000 |
| 2047 | 130.0492 [129.3038, 131.1176] | 0.0000 |
| 2048 | 130.2065 [129.2574, 131.2460] | 0.0000 |
| 2049 | 130.3352 [129.2134, 131.2794] | 0.0000 |
| 2050 | 130.4643 [129.1083, 131.3037] | 0.0000 |
| 2051 | 130.5923 [129.0009, 131.4365] | 0.0000 |
| 2052 | 130.8153 [128.8387, 131.6122] | 0.9126 |
| 2053 | 131.0019 [128.7553, 131.8931] | 1.0348 |
| 2054 | 131.1649 [128.7127, 132.1623] | 1.6330 |
| 2055 | 131.2897 [128.6161, 132.4133] | 2.6069 |
| 2056 | 131.4201 [128.5520, 132.6017] | 2.9707 |
| 2057 | 131.3802 [128.4244, 132.7804] | 4.1263 |
| 2058 | 131.3301 [128.2742, 132.8932] | 5.4301 |
| 2059 | 131.2904 [128.1216, 133.0111] | 6.8474 |
| 2060 | 131.2427 [128.0522, 133.1816] | 7.5114 |

### `--skip dirty`: 256x60_s7

Source commit: `a1a4e79e709e12a368af0645c3ac9dd50e9ac7f1`; summary: `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T044/dirty/256x60_s7_ensemble.summary.json`.

All annual values are median [minimum, maximum]; population is residents, approval is points, air is home air pollution (lower is cleaner), I-HT is percent of industrial jobs, and funds are § (from raw annual rows).

| Year (index) | Population | Approval | Air at homes | I-HT share (%) | Funds (§) |
| --- | --- | --- | --- | --- | --- |
| 2001 (1) | 3,462 [3,462, 3,462] | 51.794 [51.794, 51.794] | 0.014496 [0.014496, 0.014496] | 0.000 [0.000, 0.000] | 31,458 [31,258, 31,658] |
| 2002 (2) | 9,142 [9,141, 9,142] | 52.847 [52.847, 53.077] | 0.030188 [0.029961, 0.030188] | 0.000 [0.000, 0.000] | 47,495 [47,295, 49,543] |
| 2003 (3) | 16,522 [15,307, 16,522] | 49.569 [49.462, 49.569] | 0.034480 [0.034480, 0.037985] | 0.000 [0.000, 0.000] | 6,034 [5,834, 10,688] |
| 2004 (4) | 20,352 [20,208, 20,352] | 46.804 [46.804, 49.282] | 0.034591 [0.033782, 0.035135] | 0.000 [0.000, 0.000] | 7,554 [6,263, 7,554] |
| 2005 (5) | 23,866 [23,256, 23,989] | 50.846 [50.785, 51.643] | 0.035732 [0.034091, 0.036559] | 0.000 [0.000, 0.000] | 21,149 [20,944, 23,318] |
| 2006 (6) | 29,823 [29,409, 30,094] | 56.382 [56.293, 57.227] | 0.037842 [0.036322, 0.041959] | 0.000 [0.000, 0.000] | 28,406 [26,602, 30,489] |
| 2007 (7) | 38,961 [38,067, 40,002] | 60.038 [59.181, 61.056] | 0.045561 [0.040906, 0.047561] | 0.000 [0.000, 0.000] | 33,780 [31,972, 37,402] |
| 2008 (8) | 50,669 [49,099, 51,334] | 62.023 [60.458, 62.700] | 0.049265 [0.048568, 0.053001] | 0.000 [0.000, 0.000] | 43,321 [34,210, 49,751] |
| 2009 (9) | 62,095 [61,530, 63,419] | 64.041 [60.010, 68.106] | 0.048598 [0.047396, 0.052172] | 13.054 [8.804, 17.281] | 41,802 [30,165, 51,604] |
| 2010 (10) | 74,742 [74,078, 76,054] | 67.117 [64.900, 72.010] | 0.050378 [0.048164, 0.052353] | 14.098 [10.049, 21.914] | 38,360 [29,660, 58,864] |
| 2011 (11) | 87,649 [86,923, 89,230] | 67.099 [64.408, 71.214] | 0.049482 [0.045808, 0.050499] | 13.855 [9.760, 26.882] | 50,885 [44,706, 67,420] |
| 2012 (12) | 102,347 [100,845, 103,195] | 69.408 [67.163, 71.067] | 0.047272 [0.043332, 0.049365] | 13.681 [8.762, 26.870] | 72,230 [66,972, 77,522] |
| 2013 (13) | 117,686 [116,669, 118,644] | 70.646 [68.430, 72.122] | 0.046197 [0.042289, 0.048779] | 13.152 [8.724, 25.328] | 89,846 [75,227, 91,946] |
| 2014 (14) | 133,514 [132,840, 134,687] | 70.787 [70.458, 72.401] | 0.043470 [0.038280, 0.046649] | 13.122 [8.670, 24.553] | 93,345 [89,211, 107,833] |
| 2015 (15) | 150,977 [149,250, 151,442] | 70.853 [70.028, 72.640] | 0.042138 [0.037217, 0.045688] | 13.021 [8.653, 22.661] | 108,851 [101,821, 121,838] |
| 2016 (16) | 168,597 [166,866, 169,355] | 71.328 [70.952, 72.216] | 0.040770 [0.037335, 0.044198] | 13.062 [8.644, 22.522] | 128,107 [119,311, 134,579] |
| 2017 (17) | 186,256 [184,811, 187,875] | 71.614 [71.365, 72.694] | 0.040151 [0.038267, 0.044693] | 13.095 [8.630, 22.861] | 147,931 [125,629, 157,488] |
| 2018 (18) | 205,460 [203,644, 206,642] | 72.175 [71.023, 72.991] | 0.039559 [0.037865, 0.041898] | 13.061 [8.599, 22.804] | 165,221 [140,959, 180,303] |
| 2019 (19) | 225,449 [223,753, 226,997] | 72.382 [72.061, 74.117] | 0.038947 [0.037858, 0.041892] | 13.045 [8.648, 22.759] | 184,940 [158,310, 198,911] |
| 2020 (20) | 245,874 [243,797, 248,039] | 73.546 [73.332, 75.049] | 0.039427 [0.037621, 0.041572] | 13.050 [8.642, 22.786] | 210,646 [176,971, 228,162] |
| 2021 (21) | 267,748 [266,574, 270,188] | 76.463 [74.131, 77.163] | 0.039205 [0.037672, 0.042677] | 13.048 [8.675, 22.816] | 254,509 [247,161, 302,615] |
| 2022 (22) | 290,188 [288,970, 292,680] | 76.727 [74.745, 78.297] | 0.040422 [0.037388, 0.045847] | 13.072 [8.691, 22.847] | 328,565 [212,606, 384,582] |
| 2023 (23) | 312,311 [311,073, 314,312] | 76.908 [75.272, 78.316] | 0.043438 [0.040727, 0.046007] | 13.044 [8.701, 22.854] | 398,488 [303,853, 730,273] |
| 2024 (24) | 336,240 [335,066, 338,216] | 77.456 [75.428, 78.383] | 0.046009 [0.041731, 0.047630] | 13.008 [8.684, 22.812] | 703,696 [597,945, 1,090,210] |
| 2025 (25) | 360,450 [358,696, 362,824] | 77.410 [74.817, 77.962] | 0.047501 [0.043501, 0.049983] | 13.079 [8.678, 22.814] | 1,042,318 [940,912, 1,474,325] |
| 2026 (26) | 385,137 [383,318, 388,182] | 77.651 [75.678, 78.331] | 0.047802 [0.044810, 0.051154] | 13.045 [8.695, 23.046] | 1,435,698 [1,303,159, 1,833,399] |
| 2027 (27) | 412,118 [409,823, 415,258] | 77.869 [75.754, 78.682] | 0.048634 [0.044787, 0.051450] | 13.003 [8.699, 21.038] | 1,885,204 [1,737,250, 2,408,943] |
| 2028 (28) | 440,349 [437,008, 444,560] | 78.299 [77.231, 80.870] | 0.051006 [0.046627, 0.052886] | 12.601 [8.213, 21.045] | 2,478,956 [2,317,293, 2,758,318] |
| 2029 (29) | 469,609 [465,971, 473,220] | 79.880 [78.131, 81.725] | 0.054008 [0.049824, 0.056855] | 12.608 [8.197, 19.803] | 2,938,538 [2,894,651, 2,987,508] |
| 2030 (30) | 499,394 [496,188, 503,176] | 81.366 [79.840, 82.093] | 0.059309 [0.053476, 0.062108] | 11.813 [8.032, 17.754] | 3,073,298 [2,877,637, 3,176,835] |
| 2031 (31) | 530,392 [525,223, 533,834] | 82.274 [79.768, 82.635] | 0.061155 [0.056090, 0.065980] | 11.630 [8.055, 16.683] | 3,085,893 [3,045,061, 3,232,024] |
| 2032 (32) | 561,510 [556,721, 564,815] | 82.666 [79.917, 82.858] | 0.064438 [0.060030, 0.068811] | 11.456 [8.062, 16.617] | 3,330,292 [3,286,582, 3,535,288] |
| 2033 (33) | 592,680 [587,830, 596,171] | 82.758 [80.595, 83.202] | 0.069677 [0.063727, 0.074124] | 11.467 [7.879, 15.619] | 3,620,308 [3,577,835, 3,900,585] |
| 2034 (34) | 625,548 [620,739, 628,010] | 83.137 [81.405, 83.545] | 0.074927 [0.068457, 0.078034] | 11.479 [5.771, 15.174] | 3,954,411 [3,924,771, 4,224,201] |
| 2035 (35) | 657,895 [652,531, 659,255] | 83.000 [82.345, 83.338] | 0.079496 [0.073243, 0.083868] | 10.436 [5.341, 15.563] | 4,388,107 [4,322,300, 4,491,538] |
| 2036 (36) | 690,316 [685,099, 692,542] | 83.115 [81.988, 83.642] | 0.085656 [0.078884, 0.094088] | 11.007 [4.293, 15.624] | 4,722,640 [4,622,048, 4,795,124] |
| 2037 (37) | 723,525 [717,685, 725,666] | 82.880 [81.735, 83.909] | 0.087428 [0.085542, 0.095028] | 16.853 [2.421, 19.031] | 4,983,418 [4,894,876, 5,231,965] |
| 2038 (38) | 756,796 [751,263, 760,498] | 83.180 [81.686, 83.803] | 0.095552 [0.086022, 0.101331] | 15.212 [3.038, 20.617] | 5,284,736 [5,209,836, 5,486,779] |
| 2039 (39) | 790,358 [784,810, 793,329] | 82.715 [81.595, 83.498] | 0.104607 [0.098352, 0.113754] | 14.081 [2.542, 21.162] | 5,618,314 [5,505,064, 5,732,035] |
| 2040 (40) | 824,296 [819,589, 827,544] | 82.270 [80.983, 83.156] | 0.108986 [0.105284, 0.114881] | 15.297 [2.208, 25.205] | 5,971,752 [5,827,892, 6,091,491] |
| 2041 (41) | 859,050 [854,306, 864,113] | 82.541 [81.262, 83.672] | 0.114650 [0.111111, 0.124150] | 19.114 [1.956, 26.229] | 6,406,963 [6,146,695, 6,581,597] |
| 2042 (42) | 895,669 [889,582, 900,961] | 82.622 [80.892, 83.507] | 0.119163 [0.116442, 0.134367] | 23.396 [4.219, 29.588] | 6,764,760 [6,360,515, 7,108,703] |
| 2043 (43) | 930,625 [925,554, 937,088] | 82.115 [81.064, 83.162] | 0.125050 [0.121539, 0.134708] | 26.767 [4.465, 32.190] | 7,193,246 [6,754,020, 7,571,069] |
| 2044 (44) | 969,505 [966,420, 975,501] | 81.863 [80.483, 83.354] | 0.130561 [0.126749, 0.134934] | 30.345 [8.021, 34.318] | 7,719,117 [7,168,567, 8,192,354] |
| 2045 (45) | 1,007,389 [1,003,875, 1,015,020] | 81.647 [80.684, 82.833] | 0.137579 [0.125323, 0.140943] | 33.090 [14.209, 35.572] | 8,276,177 [7,655,167, 8,831,420] |
| 2046 (46) | 1,047,030 [1,042,637, 1,053,032] | 81.666 [80.041, 82.614] | 0.137837 [0.129743, 0.148454] | 33.181 [18.431, 36.990] | 8,852,602 [8,133,820, 9,500,780] |
| 2047 (47) | 1,086,210 [1,081,604, 1,090,107] | 81.400 [79.388, 82.306] | 0.144493 [0.130761, 0.153154] | 33.851 [21.924, 36.661] | 9,474,583 [8,625,377, 10,168,529] |
| 2048 (48) | 1,122,362 [1,119,639, 1,128,348] | 81.116 [78.920, 81.900] | 0.144529 [0.136806, 0.157636] | 31.266 [24.289, 36.710] | 10,145,948 [9,158,352, 10,854,287] |
| 2049 (49) | 1,164,532 [1,154,924, 1,169,724] | 80.667 [79.371, 81.926] | 0.149395 [0.140667, 0.160198] | 29.016 [23.275, 38.534] | 10,844,853 [9,709,780, 11,573,625] |
| 2050 (50) | 1,201,626 [1,197,537, 1,210,496] | 81.227 [79.224, 82.057] | 0.149962 [0.145145, 0.165436] | 27.428 [21.368, 38.056] | 11,561,812 [10,272,373, 12,307,719] |
| 2051 (51) | 1,242,700 [1,237,561, 1,249,038] | 80.996 [78.886, 81.653] | 0.157092 [0.146301, 0.164396] | 25.536 [18.797, 35.907] | 12,297,296 [10,856,203, 13,081,065] |
| 2052 (52) | 1,285,529 [1,282,486, 1,294,049] | 80.971 [79.205, 81.587] | 0.157522 [0.149261, 0.168791] | 24.267 [17.053, 34.593] | 13,000,675 [11,369,771, 13,824,864] |
| 2053 (53) | 1,329,212 [1,324,976, 1,337,130] | 80.390 [78.783, 81.480] | 0.157887 [0.149759, 0.173711] | 23.170 [15.369, 33.013] | 13,678,152 [11,885,247, 14,558,519] |
| 2054 (54) | 1,371,724 [1,368,906, 1,381,573] | 80.148 [77.944, 81.656] | 0.163401 [0.151641, 0.179537] | 22.516 [13.456, 31.827] | 14,367,415 [12,386,823, 15,298,068] |
| 2055 (55) | 1,414,346 [1,404,447, 1,429,477] | 79.846 [78.733, 81.994] | 0.156500 [0.150452, 0.173496] | 22.658 [11.702, 31.097] | 15,058,596 [12,870,392, 16,038,710] |
| 2056 (56) | 1,455,457 [1,415,905, 1,473,913] | 80.204 [79.015, 81.332] | 0.164273 [0.151644, 0.186433] | 24.429 [10.891, 31.014] | 15,795,662 [13,394,955, 16,815,064] |
| 2057 (57) | 1,483,385 [1,419,808, 1,512,569] | 80.012 [78.441, 81.958] | 0.163642 [0.153455, 0.178795] | 25.516 [10.671, 32.536] | 16,415,278 [13,934,207, 17,595,169] |
| 2058 (58) | 1,501,589 [1,428,351, 1,555,351] | 80.256 [78.314, 81.461] | 0.166376 [0.154317, 0.180994] | 26.368 [11.295, 34.018] | 17,118,625 [14,510,531, 18,279,552] |
| 2059 (59) | 1,523,060 [1,440,417, 1,573,049] | 80.613 [78.616, 81.372] | 0.166960 [0.152551, 0.189677] | 25.544 [11.733, 34.888] | 17,862,357 [15,099,555, 19,000,295] |
| 2060 (60) | 1,534,036 [1,443,140, 1,581,881] | 80.113 [78.439, 81.194] | 0.169667 [0.157921, 0.182146] | 24.882 [12.365, 35.023] | 18,629,008 [15,702,884, 19,763,642] |

### Variant threshold details

| Row | Check | Base | Variant | Δ % or approval gain | Threshold | Margin | Half dev band | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 256x60_s7 | Year-60 population at least 0.97 × base | 1,475,130.00000000 | 1,534,036.00000000 | +3.993275% | 1,430,876.10000000 | +103159.90000000 | 100,437.50000000 | pass |
| 256x60_s7 | Year-60 population at most 1.03 × base | 1,475,130.00000000 | 1,534,036.00000000 | +3.993275% | 1,519,383.90000000 | -14652.10000000 | 100,437.50000000 | fail |
| 256x60_s7 | Year-60 approval gain at least +1 point | 80.08467948 | 80.11258338 | +0.027904 points | 81.08467948 | -0.97209609 | 1.17888014 | fail |

## Targets requiring the lane’s own probes or checks

- NOTE-048 amends the I-HT gate to industrial-demand share ≥25% at EQ ≥110 by 2040, plus ≥25% I-HT jobs in a scripted 6×6 IndHigh block advanced 24 months from the year-43 checkpoint. Annual records contain aggregate industrial demand and realised jobs, without the I-HT demand component or the spatial probe; neither amended gate can be certified here. Realised I-HT job shares are reported above and are explicitly not gated.
- G-UNEMP requires the fresh workerAccess aggregation from balance.test.ts. The sampled-access diagnostic above is available, but does not replace that probe.
- Retooling ramp, contamination cleanup, gas cost/MW, host/UI exposure, save/load, deterministic tests and browser checks remain the lane’s own checks. This measurement campaign does not edit the lane or re-record fixtures.

## Reproduction and raw records

The command manifest and per-member exact quiet-gate commands are retained beside the campaign data. The JSON companion `T044.verdicts.json` retains all comparisons, margins, stage-two requests and source summary paths. Every ensemble summary lists its member paths/cache keys/commands; those raw JSON records supply funds and run-mean air.

Campaign command manifest: `C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-lanes\commands.json`.

`T044/base/128x15_s7`, 5 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T044m --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T044/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5
```

`T044/base/256x60_s7`, 5 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T044m --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T044/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5
```

`T044/base/256x60_s11`, 5 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T044m --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T044/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5
```

`T044/dirty/128x15_s7`, 5 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T044m --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T044/dirty --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 -- --skip dirty
```

`T044/dirty/256x60_s7`, 5 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T044m --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T044/dirty --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 -- --skip dirty
```

`dev/base/128x15_s7`, 5 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/import-dev
```

`dev/base/256x60_s7`, 5 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/import-dev
```

`dev/base/256x60_s11`, 5 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 5 --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/import-dev
```

`dev/base/128x15_s7`, 9 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
```

`dev/base/256x60_s7`, 9 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
```

`dev/base/256x60_s11`, 9 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/dev-805-snapshot --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/dev/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
```

`T044/base/128x15_s7`, 9 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T044m --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T044/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
```

`T044/base/256x60_s7`, 9 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T044m --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T044/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
```

`T044/base/256x60_s11`, 9 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T044m --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T044/base --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9
```

`T044/dirty/256x60_s7`, 9 members, exit 0:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T044m --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/data/T044/dirty --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' --jobs 4 --runs 9 -- --skip dirty
```

