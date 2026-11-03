# T037 (d) — FH-06 approval a newcomer can read; FH-09 a tax panel that tells the truth

## Review and gates (the local worker)

Branch `local/R1-guide-d` on `local/W0.3-5-integration` (`93069fa`), with dev `4a81e7e` merged in (`d4f7203`). The Codex lane's work is one commit. I
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
| `npx tsc --noEmit` (with dev `4a81e7e` merged in) | clean |
| `npx vitest run` (full, with the fixtures; dev merged) | **197 files passed, 1 skipped; 1,976 tests passed, 8 skipped** |
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

## Cloud carry-over (Nov 3)

The desktop is unavailable (NOTE-044), so the cloud finishes this lane on `cloud/t037d`: `local/R1-guide-d` (`460d801`)
with dev `923428d` merged in (clean, no conflicts; tsc clean after the merge).

### Gap list (required against done, written before any new work)

Read: the task file, NOTE-035/037/038/040/042/043/044 (every NOTE naming T037), POLISH_PLAN FH-06 and FH-09 in full
with their Acceptance lists, §4.6 (E8), §6.2 rows 25-26, §7.2-§7.4 and §8.1, this report, and the lane's diff against
dev (approval.ts, BudgetPanel.ts, three test files).

| Plan item | Required | State at the desktop's stop |
|---|---|---|
| FH-06 change 1 | below 50 residents the HUD shows "—", with "Approval starts with your first residents" | **not done** (TopBar, deferred by the desktop) |
| FH-06 change 2 | crime, tax and baseline row details | done (`approvalDetail` base / crime / tax; labels) |
| FH-06 change 3 | clicking a row opens its fix: crime → Police view, tax → Budget · Taxes, air → Air view, services → Police, Fire or Health view, parks → Parks tab | **not done** (TopBar) |
| FH-06 change 4 | under 10,000 residents the "New towns usually sit at 45–55%" footer, and faces smile ≥ 50 / meh ≥ 35 / frown < 35; today's thresholds from 10,000 | **not done** (TopBar) |
| FH-06 risk | the usual-range sentence must stay true: derive it from the bot tables | **not done** |
| FH-06 acceptance | "—" at 0 residents; unit tests for crime / tax / base; crime row click sets `ctx.overlay = Overlay.Police`; footer under 10k; 52 / 38 / 30 at 3,000 residents → smile / meh / frown | 1 of 5 (the unit tests) |
| FH-09 hint | "9% is neutral … above 13% demand collapses … (+1.5) but less income" | done |
| FH-09 rows | residential "approval heads 7 lower (reached over ~6 months)"; C and I "demand ×0.9" | done |
| FH-09 sliders | amber above 9.5%, red from 13.5% | done |
| FH-09 `taxHigh` | fires from 11%, with the approval cost in its text | **not done** (advisors.ts; the desktop left it to sub-lane (b), whose branch does not touch it) |
| FH-09 acceptance | rows + hint at 11%; raw −7 ±15% after a month, shown 88% after 6; `warn` at 10, `bad` at 14 not 13; `taxHigh` at 11% mentions approval | 3 of 4 in unit tests; the `taxHigh` test missing |
| Browser checklist | the six items in "Browser checklist (mine)" above | **none run** (the desktop's slot never came) |
| Gates | tsc, full vitest, bot at 196,101 | green at the desktop's stop, before dev `923428d`; re-run here |
| §8.1 verifier list | "at the end" of round 1, with META's items | not this sub-lane's: it runs once every GUIDE and META round-1 item is in |

The desktop's saved work (one Codex commit, the review and the gate table) was verified line by line against the sim:
the tax inversion in `approvalDetail` matches `update()`'s term (−3.5 a point above 9, +1.5 below, resident-weighted),
"police remove up to 85%" matches `crime.ts` (`t.police = 0.85 × coverage`), the crime detail reads the mirrored
`systemData.economy.resCrime` (replica-safe), and the panel's residential effect is approval.ts's formula.
