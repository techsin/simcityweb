# NOTE-053 (lead → desktop worker): SIM balance gates move to ensembles; T043 and T044 hold for the envelope

T062's finding changes how every SIM balance row is judged. A +§10 nudge on day 1 moves 256×60 s7's year-60
population by −15 %, so a single 256×60 run cannot see anything under about 10 %. Dev's own s7 endpoint looks like a
lucky path.

**1. Yes: T043 and T044 hold** until NOTE-052's envelope exists. Then judge them on the dev that includes T041, under the
rule below. Do no more tuning on single runs.

**2. Yes: ensembles.** From now on, every SIM balance row (base and variant) is judged on an ensemble, and the plan's
single-run targets read as ensemble medians. This replaces NOTE-048's SIM rule items 1-3 where they differ. Item 4 (no
compensation, no change to the default bot's strategy) stands.
- **The ensemble:** the control run plus NOTE-052's four nudges (±X on day 1 and ±X at the start of year 5), with T062's
  chosen X. That is 5 runs per row.
- **Statistic:** the median per year, for population, approval, air at homes and the I-HT share. Also report each
  row's min-max band.
- **Base rows:** a lane's base row passes in a year when its ensemble median is inside dev's ensemble min-max band, and
  |Δmedian| ≤ max(the item's tolerance, half of dev's band). Judge every year from year 10.
  - **Systematic-shift check:** if the lane's median is above (or below) dev's in all three rows at year 60 by more
    than a quarter of dev's band, report it. That is a real shift.
- **Variant targets** (for example `--neglect` at least 2 % below base): use median(variant) against median(base),
  both ensembles at the same lane commit.
  - **Second stage:** when a target or a base check lands within half of dev's band of its threshold, rerun that row
    with 9 runs (add ±2X on day 1 and at year 5) and judge on the 9-run median. That spends bot time only where it
    decides something.
- **What stays as it is:**
  - exact checks: Medium bit-identical, two-process hashes, and "bot identical" for non-SIM lanes;
  - checks with large effects (T042's Hard at 0.71-0.79× Medium, NEW-05's sweep steps);
  - 128×15 single runs as a quick screen, but its gate also uses the 5-run ensemble.
- **What T062 reports:** dev's ensembles and the envelope now; the same on the dev that includes T041, which is the
  base for T042-T045's final gates. Include T041's own base rows as an ensemble: NOTE-050's ±3 % sign-off is
  re-checked on medians, not reopened unless a median leaves ±3 %.
- **Merging:** each SIM lane's report gets a table of ensemble medians and bands per gated row. The cloud's merge
  checks the table and does not rerun the ensembles.

**Done lanes:** T042 (a8257e9) and T047 (7111b02) are received and hold for B2. T053 and T054's shared listMilestones
line is noted. T041 round 4, T037a round 4 and T062's queue are fine as you set them out.
