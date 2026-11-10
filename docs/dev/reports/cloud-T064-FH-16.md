# cloud-T064-FH-16: plain names next to R$, CS$$$, CO$$, I-D, EQ and HQ (lane t064-fh16, chain guide2a, lane 1)

Task: docs/dev/queue/T064-guide-r2-cloud.md, section "## t064-fh16". Plan: docs/POLISH_PLAN.md "#### FH-16", with §4.1
(tone), §7.2-§7.4 and §8.2. Branch `cloud/t064-fh16`, from dev 95f6e15 (the TopBar split 0cfb10d, T047 and the T064
task file are in it).

## Cloud carry-over (Nov 3)

(A new cloud lane, started Nov 10; the section name follows the carry-over template.)

### Gap list (written before the work)

What was in dev at the start (95f6e15): nothing of FH-16. No NOTE names T064 or FH-16 (dev's NOTE files and
cloud/lead-notes checked; NOTE-088 hands the item to the cloud; NOTE-044 read). No `local/*` branch carries FH-16, so
there is no desktop WIP to verify.

| # | required (task file / plan) | state at start |
|---|---|---|
| G1 | src/ui/glossary.ts: one entry per development type with its code (`DEV_TYPE_LABELS`), its plain name (`DEV_NAMES` by import) and what it wants | missing |
| G2 | EQ entry ("Education quotient — how educated your workers are (0–150); offices and high-tech want 80+") and the HQ equivalent; every number read from tuning or the demand code | missing |
| G3 | BudgetPanel: every tax row shows the plain name on a second, dim line | missing (row shows the bare code) |
| G4 | BudgetPanel: every ledger tax line shows the plain name on a second, dim line | missing |
| G5 | BudgetPanel: the tax row tooltip says what the type wants and keeps last month's amount | missing ("Last month: §X" only) |
| G6 | Hover: StatsPanel EQ / HQ meters show the glossary entry | missing |
| G7 | Hover: AdvisorsPanel EQ / HQ lines show the glossary entry | missing |
| G8 | Hover: DemographicsPanel EQ / HQ cards show the glossary entry | missing |
| G9 | Hover: GraphsPanel EQ / HQ series labels show the glossary entry | missing |
| G10 | tests/game/glossary.test.ts: DOM test over every development type (second line its own element, slider width kept); Stats EQ / HQ hover; names equal `DEV_NAMES`; numbers equal tuning; fails with the change reverted | missing |
| G11 | Do not edit rciSegment.ts, TopBar.ts or InfoPanel.ts; styles only in the new src/ui/guide/advice.css | to keep |
| G12 | Gates: tsc, revert check, full vitest; no bot (src/ui only) | to run |
| G13 | Report with what changed (each hunk's §7.3 owner), decisions, gates, requests, Desktop QA last | this file |

At the end: G1-G13 all done (G1-G9 in "What changed", G10 and G12 in "Gates", G11 kept: `git diff` touches only the
files listed below). Nothing is left for this lane except the Desktop QA run after the merge.

### What changed

All hunks are GUIDE's (POLISH_PLAN §7.2: `src/ui/glossary.ts`, `AdvisorsPanel.ts`, `BudgetPanel.ts`, `StatsPanel.ts` by
name; `DemographicsPanel.ts`, `GraphsPanel.ts` and `src/ui/guide/advice.css` by the `src/ui/** → GUIDE` rule; the test
follows its source). No SIM, CONTENT or META hunk. rciSegment.ts, TopBar.ts and InfoPanel.ts are untouched (G11).

| file | hunk | §7.3 owner |
|---|---|---|
| src/ui/glossary.ts (new) | `DEV_GLOSSARY` (one entry per development type: `code` from `DEV_TYPE_LABELS`, `name` from `DEV_NAMES` by import, `about` = what it wants, `tip` = the hover text), `EQ_GLOSSARY`, `HQ_GLOSSARY`, `glossaryOf(code)`, `wantTerms(d)`, `WANT_WORDS`, `EQ_SCALE_MAX`, `HQ_SCALE_MAX` | GUIDE |
| src/ui/panels/BudgetPanel.ts | imports; the tax row gets a `div.dim.tr-name` with the plain name as its own grid item after the money cell, and the tooltip `<entry>\nLast month: §X`; the ledger's tax lines get a `div.dim.lg-name` under the code and the entry as the row's tooltip | GUIDE |
| src/ui/guide/advice.css (new) | `.tax-row .tr-name` (spans `grid-column: 1 / -1`, 11 px, pulled up 5 px); `.ledger tr.item .lg-name` (11 px) and its row's cells on the baseline, so the amount stays on the code's line; imported by BudgetPanel.ts | GUIDE (chain guide2a's style file) |
| src/ui/panels/StatsPanel.ts | `meter()` takes an optional `tip`; the Education (EQ) and Health (HQ) meter rows carry the entries | GUIDE |
| src/ui/panels/AdvisorsPanel.ts | `Assessment.tip?`; the health advisor's three assessments carry the entry of the code they show (both on the "EQ 45 · HQ 54" line); `Card.tip`; the card message (`.am`) shows it on hover; an open issue's line takes it by advice id (`ISSUE_TIPS`: eqLow and noCollege → EQ, hqLow → HQ), on the card line and in the "more" list (text, blank line, entry) | GUIDE |
| src/ui/panels/DemographicsPanel.ts | `card()` and the trend row helper take an optional `tip`; the Education / Health KPI cards and the EQ / HQ trend rows carry the entries | GUIDE |
| src/ui/panels/GraphsPanel.ts | `GraphDef.series[].tip?`; the eqhq graph's EQ / HQ series carry the entries; the legend label shows it on hover | GUIDE |
| tests/game/glossary.test.ts (new) | 12 tests (below) | GUIDE |

The entries, as the game shows them (dev 95f6e15 tuning):

| code | hover text |
|---|---|
| R$ | R$ · Low-wealth residents — wants low rent, short commutes, transit and shops nearby. |
| R$$ | R$$ · Medium-wealth residents — wants clean air, low crime, parks and schools. |
| R$$$ | R$$$ · High-wealth residents — wants high land value, clean air, low crime and parks. |
| CS$ | CS$ · Low-wealth services — wants customers nearby and passing traffic. |
| CS$$ | CS$$ · Medium-wealth services — wants low crime, customers nearby, passing traffic and tourists. |
| CS$$$ | CS$$$ · High-wealth services — wants high land value, low crime, customers nearby and tourists. |
| CO$$ | CO$$ · Medium-wealth offices — wants short commutes, low crime and skilled workers. Office demand grows with EQ. |
| CO$$$ | CO$$$ · High-wealth offices — wants high land value, short commutes, low crime and skilled workers. Its share of office demand grows with EQ. |
| I-Ag | I-Ag · Agriculture — wants flat land, clean air, clean water and clean soil. |
| I-D | I-D · Dirty industry — wants freight access and low rent, and pollution does not bother it. Its share of industry shrinks once EQ passes 50. |
| I-M | I-M · Manufacturing — wants freight access and short commutes. |
| I-HT | I-HT · High-tech industry — wants clean air, high land value, skilled workers and a college nearby. Demand starts once EQ passes 70. |
| EQ | EQ · Education quotient — how educated your workers are (0–150); high-tech industry wants 70+ and offices grow with it. Schools raise it. |
| HQ | HQ · Health quotient — how healthy your residents are (0–150); above 80 it wins you approval, below it costs some. Clinics, hospitals, clean air and safe tap water raise it. |

Where the numbers come from: 150 = `EQ_FLOOR + EQ_SPAN_STOCK` and `HQ_FLOOR + HQ_SPAN_ACCESS` (demographics.ts clamps
both quotients to exactly that top: education and health access are 0..1, the HQ environment and medicine factors at
most 1); 70 = `IHT_EQ_START`; 50 = `ID_EQ_START`; 80 = `APPROVAL_TERMS.hqRef`. The wants come from `DESIR_WEIGHTS`:
each type names 2-4 of its strongest terms, ordered by weight at run time; "does not bother it" is printed only for a
type whose `air` weight is 0 (I-D). The EQ notes follow demand.ts (office demand × `0.6 + 0.8·smoothstep(0, 100, EQ)`,
the CO$$$ share `smoothstep(60, 130, EQ)`, high-tech from `IHT_EQ_START`, the dirty share falling from `ID_EQ_START`).

### Decisions

1. **"80+" became `IHT_EQ_START` (70).** The plan's example "offices and high-tech want 80+" has no source: no tuning
   constant or demand-code value is 80, and the task says never to type a number. High-tech demand starts at
   `IHT_EQ_START` = 70; offices have no single threshold (their demand factor and the CO$$$ share are smooth ramps whose
   edges are literals inside demand.ts, a SIM file no guide chain owns). So the entry reads "high-tech industry wants
   70+ and offices grow with it". If the lead wants an office number, SIM can export the ramp's edges as tuning
   constants and the glossary can name them (request R4).
2. **The 0–150 scale** is read as the quotients' floor plus span (see above); the 0 is the scale's bottom, not a tuning
   value. glossary.test.ts allows only {0, 150, 70, 50, 80} as numbers in any entry, and a mocked tuning moves every one.
3. **HQ's "health equivalent"** is what HQ does that the player feels: the approval term around `APPROVAL_TERMS.hqRef`,
   plus what raises it (HQ's target reads health access, air, noise and tap water). HQ's labour-participation and
   migration effects use literals in demographics.ts, so they are not named (no typed numbers).
4. **"What it wants" is a curated term list per type, checked against tuning**, not generated: an automatic top-3 reads
   wrongly (R$ would "want high land value", but its rent term prices it out of premium land; "flat land" would lead
   half the list). glossary.test.ts checks every named term's sign against `DESIR_WEIGHTS`, that the words follow the
   weights' order, and that each type's first want is among its three strongest terms, so a retune that breaks a
   claim fails the test.
5. **Names are `DEV_NAMES`' wording** ("Low-wealth residents", "Medium-wealth offices"), not the plan's examples
   ("low-wealth homes", "offices"): the task makes `DEV_NAMES` the single source. The hover keeps FH-16's
   "R$ · name" form, since the code is what the row shows (§4.1's "plain word (code)" rule is for onboarding copy).
6. **The tax row's second line is its own grid item spanning the row** (`grid-column: 1 / -1`), placed between the
   controls and the existing effect line, not inside the 44 px code cell: the row keeps its columns
   (`44px 1fr 84px 52px`, hud.css unchanged), so the slider keeps its width. Cost: about 15 px per row, so the tallest
   tax column (Commercial, 5 rows) grows by about 75 px; at 1280x720 (UI zoom 0.8, 900 css px tall) the Taxes tab
   stays well inside `.panel.center`'s `max-height: calc(100% - 170px)`. The Desktop QA measures it.
7. **Beyond the listed minimum, in the same files:** the ledger tax lines also show the entry on hover; the Advisors
   "more" list and the `noCollege` rule (its text names EQ) get the entries too, keyed by advice id, never by text.
8. **No bot:** the diff is src/ui and tests only, and tools/simbot.ts imports no src/ui file (0 matches).

### Requests to other chains and the lead

- **R1 (t064-fh23, guide2b): the RCI popover hookup**, the optional step. glossary.ts imports `DEV_NAMES` from
  rciSegment.ts, so "make `DEV_NAMES` come from glossary.ts" means moving the array into glossary.ts and having
  rciSegment.ts import it and keep its export (`export { DEV_NAMES }`) for InfoPanel and TopBar; glossary.ts then drops
  its rciSegment import (no cycle). The popover's "what it wants" line is `DEV_GLOSSARY[d].about`.
- **R2 (t064-fh23): the text floor.** advice.css has two 11 px sizes (`.tr-name`, `.lg-name`); route them through
  FH-23's floor variable with hud.css's.
- **R3 (t064-fh17):** the Help Money topic can reuse `DEV_GLOSSARY`, `EQ_GLOSSARY` and `HQ_GLOSSARY` (this lane's
  glossary is in dev once it merges).
- **R4 (lead / SIM):** demand.ts's EQ ramps (`0.6 + 0.8·smoothstep(0, 100, EQ)` for office demand,
  `smoothstep(60, 130, EQ)` for the CO$$$ share) and demographics.ts's quotient clamp (150) are literals; exporting
  them as tuning constants would let the glossary name an office threshold.
- **R5 (follow-ups, not required by FH-16):** Stats' "Residents by wealth" legend and Demographics' pyramid bars still
  show bare R$ / R$$ / R$$$ (titles "R$: n"); YearReview's EQ / HQ (CONTENT) has no entry; StatsPanel's `s.eq / 150`
  and GraphsPanel's `range: [0, 150]` could read `EQ_SCALE_MAX`.

### Gates (on the tree committed as cloud/t064-fh16, dev 95f6e15 as base)

| gate | result |
|---|---|
| 1. tsc (`npx tsc --noEmit`, under sem) | clean, exit 0 (run after the last edit) |
| 2. revert check, tests/game/glossary.test.ts (12 tests) | whole src change reverted (glossary.ts and advice.css removed, panels restored): the file fails to load ("Cannot find module '/src/ui/glossary'"), 0 of 12 run. Panels reverted with glossary.ts kept: 8 of 12 fail (all 3 Budget tests, all 5 hover tests); the 4 glossary-text tests pass, as they test glossary.ts alone |
| 3. full vitest (`npx vitest run --configLoader runner`, under the lock) | 309 files passed, 4 skipped (313); 3,123 tests passed, 32 skipped, 0 failed; 394 s. glossary.test.ts and budgetTaxes.test.ts re-run after the last CSS-only edit: 24 of 24 |
| 4. bot | skipped by the task's rule: the diff is src/ui and tests only, and tools/simbot.ts imports no src/ui file; residents stay dev's [ 61828, 95515, 40772 ] = 198,115 by construction |
| 5. acceptance | see below |
| 6. HUD trace | not applicable: the top bar is untouched (no src/ui/topbar or TopBar.ts change) |
| hygiene | tests/worker/hygiene.test.ts passes (in the full run and the targeted run): no `.speed =`, `emergencyOf(` or `getSystem(` added; the panels write nothing into the replica |
| `git diff --check` | clean |

One unrelated flake seen once in a targeted 15-file batch before the full run: tests/game/views.test.ts "layerUpdated(utilities) marks the map dirty …" (the MiniMap, untouched here) failed once, then passed alone, in the next batch and in the full run.

**Acceptance (task file t064-fh16 and plan FH-16):**

| # | item | evidence |
|---|---|---|
| A1 | Every tax row and ledger tax line shows a plain name on a second dim line (a DOM test over every development type) | glossary.test.ts "every tax row …" (12 rows: code alone in `.tr-l`, `.tr-name.dim` a direct child of the row with `DEV_NAMES[d]`) and "every ledger tax line …" (12 lines: `.lg-name.dim` under the code); master rows and non-tax lines have none |
| A2 | The row tooltip says what the type wants and keeps last month's amount | "every tax row …": title = entry + "\nLast month: " + `money(lastIncome['tax:<code>'])` for all 12 |
| A3 | Hovering EQ in Stats shows the glossary entry; HQ likewise (test) | "Stats: hovering the Education (EQ) meter …" (EQ and HQ rows carry the entries; Land value none) |
| A4 | Advisors, Demographics and Graphs EQ / HQ entries on hover | "Advisors: the health advisor's EQ / HQ assessment …", "Advisors panel: the card line …" (assessment line, eqLow card line, hqLow "more" line), "Demographics: the EQ / HQ cards and … trend rows …", "Graphs: the EQ / HQ series labels …" |
| A5 | The glossary's names equal `DEV_NAMES`, and its numbers equal tuning (text test) | "has one entry per development type …" (`toEqual(DEV_NAMES)`), "every number in the glossary is a tuning value …" (only {0, 150, 70, 50, 80}, each from its constant), "the numbers move with tuning …" (a mocked tuning moves all five) |
| A6 | 1280x720 shows no truncation; the second line is its own element and the row keeps its slider width | the test: the row's cells stay `tr-l, ui-range, tr-step, tr-m` then `tr-name, tax-effect`; advice.css spans the name over the row (`grid-column: 1 / -1`); hud.css's `.tax-row` columns are unchanged (`44px 1fr 84px 52px`). The screenshot check is Desktop QA items 1 and 3 |
| A7 | What a type wants is read from tuning, no typed number | "what a type wants follows its desirability weights …" (sign, order, lead want among the three strongest; the I-D clause only where `air` is 0) |

Browser evidence: none taken on the cloud (NOTE-061: lock.sh refuses browser checks; no merge-blocking question needed one). The browser checks are the Desktop QA list below.

### Done marker

docs/dev/queue/T064-guide-r2-cloud.done: one line for t064-fh16 appended (the file is shared by the 12 T064 lanes).

## Desktop QA (run on dev after the merge; NOTE-059 / NOTE-061)

Setup for every item: `npm run dev`, then open the page at 1280x720 (and at 1920x1080 where named), default host
(`/`) unless `?simworker=1` is named. Use a city that has had at least one monthly report, for example a demo city from
`/?region=1&preset=greenvale&seed=7&demo=1` (open a populated city from the region map), or `/?quickstart=1&size=medium`
with a few zones and a road played at top speed past its first month end. Hotkeys: M Budget, J City statistics,
N Advisors, P Demographics, G Graphs.

1. **Budget · Taxes, 1280x720 and 1920x1080, default host and `?simworker=1`.** Press M (Taxes tab). Expected: each of
   the 12 rows (R$ … I-HT) shows its code on the first line and its plain name ("Low-wealth residents" … "High-tech
   industry") on a second, dim line under it, above the existing grey effect line; no text is cut off or ellipsized;
   the sliders are as wide as on the "All" rows and as before FH-16 (the code column is unchanged); the panel shows the
   whole Taxes tab without a scroll bar at 1280x720 (if it scrolls, note the overflow in px).
2. **Budget · Taxes hover.** Hover R$$$ and I-D rows. Expected tooltips: "R$$$ · High-wealth residents — wants high
   land value, clean air, low crime and parks." / "I-D · Dirty industry — wants freight access and low rent, and
   pollution does not bother it. Its share of industry shrinks once EQ passes 50.", each followed on a new line by
   "Last month: §…" equal to that type's line in Income & expenses.
3. **Budget · Income & expenses, 1280x720 and 1920x1080, default host and `?simworker=1`.** Expected: under Taxes, every
   tax line shows its code and, on a second dim line, its plain name; amounts stay right-aligned on the code's line;
   nothing is truncated; hovering a tax line shows its glossary entry; other lines (Police, Roads …) are one line as
   before.
4. **City statistics (J) · Quality of life.** Hover the Education row. Expected: "EQ · Education quotient — how educated
   your workers are (0–150); high-tech industry wants 70+ and offices grow with it. Schools raise it." Hover the
   Health row: "HQ · Health quotient — how healthy your residents are (0–150); above 80 it wins you approval, below it
   costs some. Clinics, hospitals, clean air and safe tap water raise it." Land value and the other rows have no
   tooltip.
5. **Advisors (N) · Dr. Okafor.** Hover the card's message. Expected: when it reads "EQ n · HQ n. Our citizens are
   healthy and learning." the tooltip holds both entries (EQ, then HQ); when it reads "Education quotient is low …" or
   "Our education quotient is only …" the EQ entry; "Health is poor (HQ …)" the HQ entry. If an EQ / HQ issue is in the
   card's list of further issues, its tooltip is the issue text, a blank line, then the entry. Other advisors' messages
   have no tooltip. Check once with `?simworker=1`.
6. **Demographics (P) · People.** Hover the Education and Health cards, and the EQ and HQ rows under "Last 5 years".
   Expected: the EQ / HQ entries as in item 4; Population, Workforce and Attraction have none.
7. **Graphs (G) · Education & health.** Hover the "EQ" and "HQ" legend labels above the chart. Expected: the EQ / HQ
   entries; other graphs' legends have no tooltip.
