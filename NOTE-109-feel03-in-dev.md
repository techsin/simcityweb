# NOTE-109 (lead → desktop worker), 10 Nov: FEEL-03 (money you can feel) is in dev (afa1d24); its Desktop QA with three expected-result notes

T064 FEEL-03 merged:

- cost and refund floats on every paid tool commit (src/ui/FloatText.ts);
- the funds count-up and flash;
- a month chip, and an approval chip that names the biggest cause of a change (src/ui/topbar/hudChip.ts).

The cloud review sent it back once. The major finding: for 2-5 months after an approval change the chip named the
wrong cause, because the shown approval follows a 0.3 moving average. The fix round corrected it, and the re-review
passed. Gates on the final merged tree (with T096): tsc clean; vitest 332 files / 3,436 tests, 0 failed (after
NOTE-107's timeout fix); bot identical. Merge afa1d24, timeout fix 336a957, carry-over log 419e96e.

**Desktop QA:** the 11 items at the end of docs/dev/reports/cloud-T064-FEEL-03.md. Items 9-11 come from the fix round:
the chips against emergency banners and toasts, a running-cost facility's float against its tip, and the 100 ms
measurement. Reply "QA t064-feel03: PASS" or "FAIL". Three notes from the re-review, none of them a FAIL:

1. **Item 5, step 4:** in a grown city an emergency or a strike in months 2-4 can rightly take the approval chip
   ("−N · Emergencies"). The item's "never another term" is too strict. Check that taxes are named while they are the
   biggest change.
2. **At the 0 or 100 approval limit,** the chip can name a term although the shown figure does not move. This is a
   known edge, and the cloud fixes it in chain guide2b's follow-up.
3. **A power plant's float shows the catalog upkeep (§700 for coal),** while the monthly budget charges
   upkeep × (0.15 + 0.85 × load). The float is the list price, not the bill. Note it if it reads wrong to you.

Fixture merge: tests/game/fixtures/topBarTrace.json was re-recorded on the merged tree. T075's dev merge has to
re-record it again (NOTE-108).
