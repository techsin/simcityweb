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

### What the cloud did

**FH-06's top-bar half** (the TopBar split has not run yet; T030 is merged, and the guide chain is serial, so the hunks
are small and the logic lives in a new GUIDE file the split keeps):
- `src/ui/topbar/approvalGuide.ts` (new, headless): `approvalHud` ("—" below 50 residents; `band` 0 / 1 / 2),
  `approvalFace` (under 10,000: smile ≥ 50, meh ≥ 35, frown below; from 10,000: 60 / 40), `newTownFooter` (the usual
  range per difficulty, from the bot tables below), `approvalFix` / `approvalFixHint` (each row's fix).
- `src/ui/TopBar.ts`, the approval block only: the value, face and colour come from `approvalHud`; the card is rebuilt
  when the monthly terms change or the population band does; below 50 residents it shows "Approval —" and "Approval
  starts with your first residents." instead of rows; each row shows its detail as a visible second line (before, the
  details sat in `title` attributes on a card with `pointer-events: none`, so no player ever saw them); rows with a fix
  carry `data-fix` and one delegated click listener on the segment opens it (no listener per monthly row). A fix that
  opens a panel or a toolbar tab hides the card until the pointer leaves (the browser check found it covering what it
  opened).
- Fixes: crime → Police view; tax → Budget · Taxes (`BudgetPanel.showTab`, new); air pollution → Air pollution view;
  city services → Police view, then Fire, then Health on the next clicks (the replica has no per-service coverage at
  homes, and a sim query would be a SIM row, so the row steps through the three); parks → the toolbar's Parks tab.
  Also noise, garbage, commute, tap water and HQ open the data view the Advisors panel already uses for them
  (`advisorModel.adviceView`).
- `src/ui/insight.css` (the approval card's own rules): the card takes the pointer, an invisible 9 px strip bridges the
  gap under the segment, row hover, the detail line, the footer note, the "—" face colour.

**FH-09's `taxHigh`** (`src/sim/economy/advisors.ts`, GUIDE's finance-threshold hunk): it fires from 11% of the
resident-weighted residential rate, the rate approval.ts charges (it used a plain mean of the three sliders, from
12%), and its text is now "Residential taxes average 11.0%. Each point above 9% costs 3.5 approval, so approval heads 7
points lower; above 13% demand collapses." It no longer says people leave (veteran #1: growth barely moves below 13%).
Sub-lane (b)'s branch does not touch this rule, so (b)'s merge after this one meets no overlap.

**Tests** (each fails with its fix reverted; checked by restoring the dev-side file and re-running):
- `tests/game/approvalHud.test.ts` (new, 9 tests): the model ("—", the 52 / 38 / 30 faces at 3,000, 60 / 40 from
  10,000, the per-difficulty footer, the fix map) and the TopBar (the "—" card and its rebuild at the first residents,
  the footer under 10k and not from 10k, the visible details, crime → `ctx.overlay = Overlay.Police` without opening the
  advisors, tax / air / parks / services, the dismissed card, one listener however often the rows are rebuilt).
  With TopBar.ts reverted 5 of 9 fail; with the module removed all 9 fail.
- `tests/sim/taxHighAdvice.test.ts` (new, 2 tests; beside `advisors.test.ts`, which (b) is editing): 2 of 2 fail with
  advisors.ts reverted.
- `tests/game/budgetTaxes.test.ts`: `showTab` opens Taxes from another tab; fails with BudgetPanel.ts reverted.

### The usual range (FH-06's risk: derive the sentence from the bot tables)

The bot's monthly approval while the town has 50 to 10,000 residents (128 cells, 3 years, the default "attentive mayor"
profile; `tools/simbot.ts` driven from a scratch script, one run per row):

| difficulty | seed 7 | seed 11 | seed 3 | 10th-90th percentile, all seeds | footer |
|---|---|---|---|---|---|
| Easy | med 60.3 (55.9-62.1) | 59.2 (56.0-61.1) | 59.6 (55.9-61.6) | 56.4-61.5 | 55–60% |
| Medium | 53.4 (50.0-61.0) | 52.3 (50.0-61.1) | 53.1 (50.0-61.0) | 50.4-55.6 | 50–55% |
| Hard | 47.7 (46.4-61.0) | 48.2 (45.7-61.1) | 48.1 (46.1-61.0) | 46.5-53.1 | 45–55% |

(The 61 maxima are each town's first month, before any term but the baseline.) Across all nine runs the 10th-90th
band is 47.4-60.8, so one "45–55%" line would be false on Easy, where an attentive new town sits at 56-62. The footer
therefore names the range of the city's difficulty (sandbox keeps Medium's approval rules, so it reads Medium's). The
FH-10 newcomer profile, which never grows past its four starting blocks (FH-04's report), sits at 39% on Easy and 25%
on Medium: below the usual range, which is what the line is for. The plan says to re-check the range after the final
balance pass; the module comment says so too.

### FH-09's acceptance on a grown city (the "stable city" item)

A frozen town gives the plan's numbers exactly (`tests/sim/approvalGuide.test.ts`: raw −7 after a month, shown 88.2%
after six). On real bot cities the scratch script forked one state into two identical cities (A at 9%, B at 11% on all
three residential rates) and let the sim alone run on, no bot actions:

| city at the fork | raw A − B after 1 month (7 ± 15% = 5.95-8.05) | shown A − B after 1 month | raw gap after 6 | shown A − B after 6 (of the raw gap) | B's taxHigh warning |
|---|---|---|---|---|---|
| seed 7, year 1 (3,736 residents) | **6.97** (tax term 7.000) | 2.09 | 5.62 | 4.94 (**87.8%**) | posted |
| seed 7, year 2 (9,902) | **7.01** | 2.10 | 6.74 | 6.08 (**90.2%**) | posted |
| seed 11, year 2 (9,917) | **7.03** | 2.11 | 7.54 | 6.38 (**84.7%**) | posted |

After six months the two cities have drifted apart (B grows a little slower), so the raw gap itself moves (5.6-7.5);
the shown approval covers 85-90% of it, against the EMA's 88.2%.

### Gates (cloud, Nov 3; branch `cloud/t037d` at `613735e` for the suite and the bot)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (sem) | clean after the dev merge, and clean at `613735e` |
| Targeted tests (approvalHud, taxHighAdvice, budgetTaxes, topBarFrame, uiStacking, panelsAdvisors, advisors, approvalGuide, difficultyRules, panelCommands, panelsMisc) | 11 files, 119 tests passed |
| Each new test with its fix reverted | taxHighAdvice 2 of 2 fail (advisors.ts reverted); approvalHud 5 of 9 fail with TopBar.ts reverted and 9 of 9 with the module removed; the `showTab` case fails with BudgetPanel.ts reverted |
| Full `npx vitest run --configLoader runner` (lock, with the bench fixtures, so the grown-fixture cases run) | **206 files passed, 1 skipped; 2,043 tests passed, 4 skipped**, 450 s |
| The 128 × 15 seed-7 bot (lock), against dev `923428d` run from a clean export in `co/t037d-devbase` | **identical**: `residents [ 59288, 95301, 41512 ]` = **196,101**, the year table, the last 25 log lines and the last 12 news all match; only the two timing columns differ |
| FH-09 on grown cities (A/B above) | raw −6.97 / −7.01 / −7.03 after a month (±15% allows 5.95-8.05); shown 85-90% of the raw gap after six |

GUIDE changes no sim outcome: `taxHigh` writes advisor news only, which the plan's G-DET note already excludes, and on
this bot run even the news tail is unchanged.

### Browser checklist (cloud; one Chromium on SwiftShader, 1280 × 720, `demo-ui.html` on its own vite port)

Harness and scenarios: `scratchpad/t037d/harness/` (`run.mjs`, `check.mjs`, `check2.mjs`). Real mouse moves (stepped,
so the pointer crosses the 8 px gap under the segment), real clicks, and the arrow keys on the focused slider.

| # | Check | Result | Evidence (`scratchpad/t037d/…`) |
|---|---|---|---|
| 1 | FH-06: 0 residents shows "—"; the card says "Approval starts with your first residents." | pass | `shots/01-zero-residents-card.png` |
| 2 | FH-06: a 4,433-resident Medium town: rows with visible details (baseline "every city starts at 61", crime "crime at homes 31% — …"), the 50–55% footer, meh at 47% | pass | `shots/02-town-card.png` |
| 3 | FH-06: the card stays open while the pointer glides onto the crime row; the row highlights | pass | `shots/03-crime-row-hover.png` |
| 4 | FH-06: clicking the crime row sets `ctx.overlay = Overlay.Police` (8); the advisors stay closed | pass | `shots/04-police-view.png` |
| 5 | FH-06: services steps Fire (9), Health (10), Police (8) after Police; air pollution opens the Air view (3); parks opens the Parks tab and the card hides | pass | `shots/05-parks-tab.png` |
| 6 | FH-06: a click on the segment itself still opens the advisors | pass | log |
| 7 | FH-09: the arrow keys set All residential to 11%; every residential row reads "Citywide: approval heads 7 lower (88% reached over 6 months)"; the corrected hint; C and I rows "demand ×1" at 9%; amber sliders | pass | `shots/06-budget-taxes-11.png` |
| 8 | FH-09: `warn` at 10 and 13, `bad` at 14 (rows read "heads 17.5 lower"), neutral and plain at 9 | pass | `shots/07-budget-taxes-14.png` |
| 9 | FH-06/FH-09: one month at 11%: the tax term is −7.0, the card's row reads "homes are taxed 11% on average — …", and the new `taxHigh` toast appears ("Residential taxes average 11.0%. Each point above 9% costs 3.5 approval, …") | pass | `shots/08-card-after-month-at-11.png` |
| 10 | FH-06: the tax row opens Budget · Taxes from the Loans tab, and the card hides | pass | `shots/09-tax-row-opens-budget.png` |
| 11 | FH-06: at 3,000 residents 52% smile, 38% meh, 30% frown; at 12,000 52% meh | pass (data; the first clip missed the segment, re-shot in the follow-up run) | `shots2/10-face-*.png` |
| 12 | FH-06: Easy keeps its "new-town grace" crime row (+0.0, "new-town grace"); its footer reads 55–60% | pass | `shots/11-easy-grace-card.png` |
| 13 | No page errors on the new city, the Medium town or the Easy town | pass | log |
| 14 | The replica (`?simworker=loopback`): the crime detail from the mirrored `resCrime`, and the crime row opens the Police view | queued (the lock) | `shots2/12-loopback-card.png`, `shots2/13-loopback-police-view.png` |

The first run found one problem, fixed in `613735e`: with the card now taking the pointer, it stayed over the Budget
panel and the Parks flyout it had just opened while the pointer rested on it. Fixes that open a panel or a toolbar tab
now hide the card until the pointer leaves the segment; data-view fixes keep it, so the services row can step on.

### Decisions (conservative readings, with the evidence)

1. **FH-06's top-bar half is done here, before the TopBar split.** The task file deferred it only "until" T030 merged
   (it has); the guide chain is serial (NOTE-044: T037d, T037b, then the split), so nothing edits TopBar.ts beside it.
   The TopBar.ts hunks stay inside the approval block, and the logic lives in `src/ui/topbar/approvalGuide.ts`, a
   GUIDE file under the split's own directory (§7.2), for the split to build the approval segment around.
2. **`taxHigh` is done here, although (b) holds advisors.ts's GUIDE hunks.** It is FH-09's item, and (b)'s branch does
   not touch that rule. Its test sits in a new `tests/sim/taxHighAdvice.test.ts`, not in `advisors.test.ts`, which (b)
   is editing (§7.4: add new test files).
3. **`taxHigh` reads the resident-weighted rate** (approval's own), not the plain mean of three sliders, so the warning
   and the cost it names match the tax row. With all three rates equal the two agree, as in the plan's acceptance.
4. **The usual-range footer is per difficulty** (Easy 55–60%, Medium 50–55%, Hard 45–55%), from the bot tables
   above. One "45–55%" line is false on Easy. The FH-06 copy and the plan's Risk line both ask for a true sentence.
5. **The services row steps Police → Fire → Health** on repeated clicks. The replica has no per-service coverage at
   homes (the layers mirror only for the shown view), and a worker query would be a SIM row (§7.6), so the row does not
   guess which one is weakest; its tooltip says so.
6. **Rows beyond the plan's five also open a view:** noise, garbage, commute, tap water and HQ, each to the data view
   the Advisors panel already uses for that problem. Baseline, unemployment, deficit, strikes and the rest have no single
   fix and stay plain rows that open the advisors.
7. **The card takes the pointer and shows each row's detail as text.** Before, `.appr-pop` had `pointer-events: none`,
   so the `title` details could never show and no row could be clicked; FH-06's row details and row clicks both need it.
8. **The desktop's edit of `tests/sim/difficultyRules.test.ts`** (a SIM test) only follows the GUIDE label change
   ("Crime at homes") and the new crime detail; it is kept.
9. **§8.1's verifier list** runs once every GUIDE and META round-1 item is in; it is not this sub-lane's gate.
10. **The browser's timings are SwiftShader's**, so this report claims function and visuals only.

### Remaining

- Nothing required of sub-lane (d). The round-1 verifier list (§8.1) waits for the other sub-lanes and META.
- After the final balance pass, re-run the usual-range numbers (the module comment and this report say how).
