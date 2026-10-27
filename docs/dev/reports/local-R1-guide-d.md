# T037 (d) — FH-06 approval a newcomer can read; FH-09 a tax panel that tells the truth

## Review and gates (the local worker)

Branch `local/R1-guide-d` on `local/W0.3-5-integration` (`93069fa`). The Codex lane's work is one commit. I
reviewed it against docs/POLISH_PLAN.md FH-06, FH-09 and §7.2-§7.4, and against the sim's code:

- **The panel's arithmetic is the sim's own.** The residential effect averages the three rates weighted by
  residents and divides by the population, then applies `taxPerPoint` above `TAX_NEUTRAL` and `taxLowPerPoint`
  below. That is approval.ts's monthly term, line for line. The commercial and industrial rows call the sim's own
  pure `taxFactor`. The panel imports only pure tuning constants and that function from src/sim; it reads the
  replica's `stats`, and every write still goes through host commands.
- **approval.ts changes text only:** `APPROVAL_LABELS` (base, crime) and three new `approvalDetail` cases (base,
  crime, tax). The tax detail inverts the stored monthly term back to the rate that produced it. No number the sim
  computes changes, and the bot is identical (below).
- **BudgetPanel's catch fallbacks** (the taxRates and funding catches that W0.6 deletes) are untouched, as the brief
  asked, so the rebase onto `local/W0-complete` stays clean.
- The slider colours move to amber above 9.5% and red at 13.5% (amber at 10%, red at 14%, not red at 13%), the
  levels FH-09's acceptance names.

| Gate | Result |
|---|---|
| Targeted tests (approvalGuide, budgetTaxes, approval, panelCommands, panelsMisc, guideCopy) | 6 files, 177 tests passed |
| `npx tsc --noEmit` | FULLSUITE_TSC |
| `npx vitest run` (full, with the fixtures) | FULLSUITE_VITEST |
| The 128 × 15 seed-7 bot, with the action log | identical to `93069fa`, line for line (**196,101** in 2015) |
| Browser checks (the checklist below) | pending: my browser slot, after the T014 timing runs |

## The lane's summary (Codex)

- `src/sim/economy/approval.ts`: clearer labels, and baseline, crime and tax details. All code outside the owned
  copy hunks is unchanged.
- `src/ui/panels/BudgetPanel.ts`: the corrected hint, live approval and demand effects per row, the warning colours,
  and accurate All-slider values (the exact average, or "Mixed"). The forecast and the tax and funding command
  blocks are unchanged.
- Tests:
  - `tests/sim/approvalGuide.test.ts`: explains the starting score even before the first residents; explains
    resident-weighted crime and its fix without changing simulation state; describes the weighted tax rate that
    produced the monthly term, even after another slider edit; explains a below-neutral tax bonus using the same
    monthly rate; preserves the Easy new-town grace row; reads saved home crime when the monthly penalty still
    reflects an earlier grace period; 11% lowers the raw target by 7 after one month and moves shown approval 88%
    of the way after six.
  - `tests/game/budgetTaxes.test.ts`: All residential at 11% sends host commands and shows the 7-point target cost
    before the forecast refreshes; mixed rates use residents, ignore empty tiers, and apply the slope after
    averaging; shows neutral approval and waits for residents in an empty city; shows commercial and industrial
    tax demand factors, including both clamped extremes; keeps half-point values and updates existing rows without
    rebuilding the controls; releases the forecast on close and keeps retained tax controls silent after city
    disposal.

Plan-vs-code differences:
- Residential approval uses the resident-weighted average, so the three residential rows share one citywide effect
  against 9%. The panel says so under the residential group.
- The six-month copy says 88% reached: that is the approval EMA after six months.
- No merged tax-sweep result was found, so the plan's current thresholds stay.
- The TopBar work and the `taxHigh` advisor change stay with their owners: the TopBar split after T030, and (b)
  for advisors.ts.

## Browser checklist (mine)

- [ ] FH-06: the approval tooltip shows the new details, and Easy keeps its "new-town grace" row.
- [ ] After the TopBar work: zero residents shows "—"; crime opens Police; the under-10k footer appears; at 3,000
  residents, 52 / 38 / 30 show smile / meh / frown.
- [ ] FH-09: All residential at 11% shows "approval heads 7 lower", and the corrected hint.
- [ ] A stable city: raw approval drops 7 (±15%) after one month; displayed approval is about 88% of the way after six.
- [ ] Sliders: amber at 10%, red at 14%, not red at 13%. Check the demand factors, the keyboard steps and the
  1280 × 720 layout.
- [ ] For the advisor owner: `taxHigh` fires at 11% and mentions approval.
