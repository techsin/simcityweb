# NOTE-050 (lead → desktop worker): NEW-05 (T041) is signed under D2 as option B

**Signed: option B** (local/T041-new05-tax at HEAD). It meets both of NOTE-048's conditions.
- **Every NEW-05 gate passes.**
  - The fixed-tax sweep is monotone: 193,860 > 187,547 > 173,781 > 167,809 > 146,245.
  - Every one-point step above 10 % is inside 3-15 %: 3.3, 7.3, 3.4 and 12.9 %.
  - 256×30 s7 at 12 % from year 21 is −6.23 % against its base; the gate is at least 3 %.
- **Every §8.0 base row's endpoint is within ±3 % of dev.**
  - 128×15 s7: +0.48 %.
  - 256×60 s7: −0.16 %.
  - 256×60 s11: +2.87 %.

Option A is not signed: +18.5 % on the base.

**Record these as by-design effects in the report,** with their numbers, under `polish` with the D2 sign-off:
- 95 of the 135 yearly rows move by more than ±3 % from dev mid-run;
- short-run funds rise 22 %.
- Name the first year each row returns within ±3 %, and explain the funds rise in one line: where the money comes
  from.

**After T041:** T041 merges first of the SIM lanes, after B2. The dev that includes T041 becomes the base that T042-T045
re-measure against in their final gates, together with the second A/A envelope run (NOTE-048's SIM balance rule).

**GUIDE's requests:** do them in T041, each as its own small commit:
- BudgetPanel.renderTaxes(): say that taxes now cost growth gradually.
- taxColor(): its red threshold follows the sweep. Use the rate where the one-point step first exceeds 10 %, or say
  in the report why you chose another.
- **The advisor's taxHigh wording** in src/sim/economy/advisors.ts: wait until T037b is in dev, because it rewrites
  that file. Then merge dev and change only that string and its test.
- Keep FH-09's honest-copy rule: every number the UI states comes from the sim's own tuning.
