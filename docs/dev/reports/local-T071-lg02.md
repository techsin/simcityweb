# T071 LG-02: late-game landmarks

Worktree branch `local/T071-lg02`, starting HEAD `c868c13d21ff246b96296ee42be86c64dc675629` (task commit over `ed31192`). Round 1 was committed by the lead as `b663747` and round 2 as `efd4242`; the QA round 2 changes (next section) are uncommitted. Rounds 1 and 2 changed no worker, save, UI, renderer, other worktree or branch; QA round 2's UI hunks are listed in its table.

## QA round 2: the real-GPU findings

The real-GPU QA of `efd4242` passed every browser checklist item on the local, loopback and Worker hosts and reported B1-B13. This round fixes the lane's own findings (B2, B3, B4, B5, B13) with tests and records the rest (B1, B6-B12, with a proposed fix for B7). What the city pays does not change: no charge, balance, tuning, RNG draw, save key, worker command or cloud-held file is touched, and the 128×15 seed-7 bot is identical (gates below).

| Changed file | Change |
|---|---|
| **Outside named files:** `src/sim/economy/opex.ts` | B2, text only, in its own block at the end: `landmarkOpexRateOf`, `tierCharged`, `landmarkUpkeep` (the estimate) and `landmarkOpex` (the inspector's split). `facilityOpex`'s share loop moved into `servedShare`, which also counts the tier landmarks, so a tier's inspector lines add up to its budget line. `computeMonthlyBudget`, `tierOperatingCosts`, `expectedUpkeep` (the bot's budget checks) and `opexTierOf` are untouched; nothing in the sim calls the new helpers. |
| **Outside named files:** `src/ui/upkeepModel.ts` | B2: `upkeepEstimate` gives a landmark with a service tier the running-cost facilities' estimate and words, plus its formula; null (the flat upkeep) where the tier is not charged. It feeds the flyout card, the rich tip, the Rewards panel and the plop tip. |
| **Outside named files:** `src/ui/Toolbar.ts` | B2: the rich tip notes the landmark's formula under its Upkeep row. B13: the income note reads "about §X / month at typical use — more when it is busy, less while it is quiet". |
| **INFRA, outside named files:** `src/sim/infra/facilities.ts` | Display builders only. B2: `upkeepLine` takes `facilityOpex(...) ?? landmarkOpex(...)`. B5: `reliefIncomeLines` and `facilityDefFacts` name the Stock Exchange's CO$$$ relief apart (`CO3_RELIEF_APART`); `facilityReport` and `facilityDefFacts` add its office-tax row (`OFFICE_TAX_FACT`), and `facilityDefFacts` adds the Crown's approval fact. The two constants sit next to `APPROVAL_CIVIC`. |
| **Outside named files:** `src/game/tools/PlopTool.ts` | B4, in that one model's branch: `autoOverlayOf` returns the Transit view for `lm_grand_central`; the constructor puts its coverage and connections facts first. |
| **Outside named files:** `src/ui/hud.css` | B3: `.fly-groups` `max-height: min(max(56vh, calc(56vh / var(--ui-zoom))), 520px)`, with a comment. |
| **Outside named files:** `src/game/tools/Tool.ts` | B13: `budgetEffect`'s venue note reads "(about §X at typical use)" (was "(up to §X when busy)"). |
| **Outside named files:** `src/ui/panels/ListPanels.ts` | B13: the Rewards income chip's title reads "Income at typical use — more when it is busy, less while it is quiet (…)" (was "Income when busy — …"). |
| **Outside named files, existing test:** `tests/game/budgetPreview.test.ts` | B13: the stadium's and the small airport's venue-note expectations follow the new words. |
| `docs/POLISH_PLAN.md` | A1, per NOTE-092: LG-02's first acceptance line states the rule and the lane's measured years. |
| New tests | `tests/sim/lg02StatedCost.test.ts`, `tests/infra/lg02Inspector.test.ts`, `tests/game/lg02QaRound2.test.ts`, `tests/game/uiFlyoutHeight.test.ts`. |

### B2: what a landmark with a service tier costs, as the budget books it

The Central Library (library tier), the Botanical Dome (green tier) and, on the same code path, the base's Observatory (library tier) keep their flat catalog upkeep in the budget. The people they serve also count in `stats.needs[tier].served`, and `tierOperatingCosts` charges every served person of a tier whenever the city runs a non-ruined operating-cost facility of that tier. So a "§1,600" Library cost §6,197 in QA's 1.1M city. The charge stays as it is; the texts now state it from the budget's own figures (`OPEX_PER_SERVED`, the same charge rule, the same served counts):

- **Build card** (rich tip): the Upkeep row reads "≈§A/mo typical in this city · up to §B at full use", with the note "Upkeep: §1,600 / month + §0.60 per learner served" under the rows. The Dome's note is "§1,800 / month + §0.015 per visitor served" and the Observatory's "§150 / month + §0.60 per learner served". The card's "Monthly budget" row counts §A. The flyout card shows "≈§A/mo", and the **Rewards panel** chip shows "≈§A/mo typical", with the full sentence on hover.
- **Plop tip:** "Upkeep ≈§A/mo now · up to §B at full use", and the "Monthly budget: … after this" line counts §A.
- **Inspector:** "Upkeep §X / month". X is the whole catalog upkeep (× funding where its service has a budget line, as the budget books it) plus the landmark's share of the tier's running costs, by the coverage it delivers. The hint reads "Its share of the city's running costs: the building §1,600 + §N for the people it serves (§0.60 a month for each of the city's M students); bulldozing it saves less when nearby facilities take over its users", which is a school's wording. A landmark in ruins shows "§1,600 / month", "Still charged until you bulldoze it".
- **§A and §B.** §A is the catalog upkeep plus the rate for the people it would serve: the tier's unserved need city-wide, at least a quarter of a typical load (70 % of capacity) and at most a typical load (`expectedUpkeep`'s rule). §B is the catalog upkeep plus the rate for every seat. That gives the Library ≈§3,700 to §10,000 typical and up to §13,600; the Dome ≈§2,010 to §2,640 typical and up to §3,000; the Observatory ≈§675 to §2,250 typical and up to §3,150.
- **Flat upkeep where it is the truth.** The texts keep the flat upkeep in a city that runs no operating-cost facility of the tier (or only ruined ones) and in an economy-only simulation. Every other landmark, venue and reward keeps its texts. The base's zoo, stadium, amusement park, research center and cemetery fall under the same charge; they are base content and are left as they were.
- **Words.** A library-tier landmark's formula counts "learners", its seat unit and the lead's own word ("per 1,000 learners"). The inspector's hint counts the city's college-tier "students" (the budget's count, which includes university students), and the base's Public Library card keeps "per student served".

Measured headless (read-only, on QA's 1.52M bot city with all seven landmarks, day 20523):

| Landmark | Card | Inspector |
|---|---|---|
| Central Library | ≈§10,000 typical · up to §13,600 | §6,325 (3,399 / 20,000 learners seated) |
| Botanical Dome | ≈§2,640 typical · up to §3,000 | §2,488 |
| Observatory | ≈§2,250 typical · up to §3,150 | §752 |

In that city the tiers' inspector shares add up to the budget charge exactly: 25 college-tier carriers make §54,620.40 = 91,034 × §0.60, and 340 green-tier carriers likewise. QA's measured §6,197 (6,157 learners) lies inside the Library's stated range.

**Limit (a base convention, unchanged).** The budget charges the city-wide served count, which is counted per cell. In that city it runs 1.2 to 2.3 times the sum of the facilities' own served counts, by tier (`facilityLoad`; college tier: 91,034 against 43,217). So an inspector share, which splits the real charge, can exceed "up to §B at full use", as it already does for the base's schools (a full University there: §9,001 against its "up to §4,260"). The card figures follow lead decision 20b's seat-based convention; changing that convention is outside this lane.

### B3: the Landmarks flyout at 1280×720

At 1280×720 the HUD root is zoomed 0.8 (`computeUiZoom`), so its layout is 1,600 × 900 px. The zoom also scales a bare `vh`, so `56vh` was 403 of those 900 px. The 19 cards need three rows: 424 px measured by QA, 423 px computed from the CSS. They overflowed by 21 px, and the Crown's card was cut by 17 px. The cap is now `56vh / zoom` = 504 px. That fits QA's rows and the worst case, three rows of three-line names (448 px). It is never less than the old cap (a zoom above 1 keeps the bare `56vh`), and 520 px still rules where it did. The flyout stays below the top bar. `--ui-zoom` is declared on `.mp-ui` (and set by `CityScene`), and the toolbar is mounted inside it. One case is left: with a UI scale above 100 % on a 720-px screen the zoom is held at 1.0, so the layout is 720 px tall and the third row scrolls again (QA's headless Chromium showed no scrollbar; a headed browser should show the native one).

### B4: placing Grand Central

Placing Grand Central now turns on the Transit view, not Prestige. Its cursor tip's two facts are "Transit coverage 18 tiles · Connections train, subway and bus hub". The Library still gets Education · University, the Dome Parks · Gardens & parks, and the other landmarks Prestige. Both hunks are confined to `lm_grand_central`.

### B5: the Stock Exchange and the Crown say what they do

- The Stock Exchange's inspector reads "Demand cap +15,000 commercial jobs, +40,000 CO$$$ office jobs" (was "+55,000 commercial jobs"), and its card reads "C +15,000 · CO$$$ +40,000".
- A new row, "Office tax +5% (CO$$ and CO$$$ receipts)", appears in the inspector while the exchange operates (budget.ts' own condition, `venueOp > 0`); otherwise it reads "none while it has no power" and the like. The card has the same row.
- The Crown's card gains "Approval +3 (civic pride)", the words of its inspector.
- Confirmed text-only: facilities.ts:1155 (`reliefIncomeLines`), :1554 (`facilityDefFacts`) and :1365 (`APPROVAL_CIVIC`) only build report and tooltip text. `APPROVAL_CIVIC`, `CO3_RELIEF_APART` and `OFFICE_TAX_FACT` are read only by `facilityReport` and `facilityDefFacts`. The effects stay in the catalog's `CAP_RELIEF` (demand.ts), budget.ts' office-tax hook and approval.ts' Crown term, none of them touched. The text therefore stays with the display builders.
- Every other def keeps one commercial figure and gains no row; the Twin Spires' C +80,000 and CO$$$ +20,000 still read "C +100,000".

### B13: venue income, worded as the code computes it

budget.ts pays a venue `income × (0.35 + 0.65 × min(1.25, visits / draw)) × clamp(attractiveness / 60, 0.5, 1.5)^0.3`, times the use factor for an airport or a seaport. That is the catalog income at its reference visits and attractiveness, 1.31 times it at most (QA saw §2,788 booked for the Millennium's §2,500), and about 0.28 times it in an empty, unattractive month. The same claim stood in three places, which now read:

- Build card note: "Income: about §2,500 / month at typical use — more when it is busy, less while it is quiet (its inspector shows what it earns now)".
- Plop tip budget line: "… after this, before its income (about §2,500 at typical use)" (was "(up to §2,500 when busy)").
- Rewards income chip title: "Income at typical use — more when it is busy, less while it is quiet (its inspector shows what it earns now)".

Every non-reward def with an income has an `ATTRACTIONS` row (the venues, both airports and the seaport), so the sentence holds for all of them. Business deals keep "Deal income", which pays as it is.

### A1: the unlock years (ruled in NOTE-092)

The mechanism passes: each landmark unlocks at the first monthly check after its population threshold. The plan's years (2016, 2021, 2025, 2033, 2038, 2043, 2056) were stale against the base; today's base 1c2019c with the same bot gives 2016, 2021, 2025, 2034, 2038, 2044, 2059. The lead ruled on the wording in NOTE-092. docs/POLISH_PLAN.md's LG-02 line now states the rule and the lane's measured 256×60 s7 years, as the first year-end row at or above each threshold: 2016, 2021, 2025, 2034, 2038, 2044, 2057.

### Recorded, not fixed

| # | Where | Record |
|---|---|---|
| B1 | src/ui/TopBar.ts:525 (now `src/ui/topbar/approvalSegment.ts`) | Already in the base. On the replica hosts the approval popover is not rebuilt after a month tick, so the Crown's +3 shows only after a reload. NOTE-092: the cloud takes it as T065 (cause confirmed on dev: `replica.ts`' `mergePlain` keeps nested object identities, and `approvalSegment.ts` rebuilds only when the terms object's identity changes). No lane change. |
| B6 | src/game/demolishRisk.ts:479 | Already in the base. The demolition dialog's landmark line names only tourism and land value. Suggested: one line per effect the building has (cap relief, jobs, service tier, transit hub, office tax, approval). |
| B7 | src/sim/infra (use factors) | A base mechanism that the hub exposes. Proposed fix below; not applied (no src/sim/infra edit this round). |
| B8 | src/render/city/buildings/lodProxy.ts | Art. The Dome's and Grand Central's LOD proxies are plain boxes, fully emissive at night, beyond about 4.8 to 6.4 km. The building renderer is held by other lanes. |
| B9 | — | Info. Park-and-ride drivers board at a nearby subway station, and the hub's own bus riders are not in its "Riders" row. The sim is right; a later UI pass could count the hub's bus riders. |
| B10 | src/ui/panels/ListPanels.ts:272 | Already in the base. The lock bar reads "100%" at 99.85 %. |
| B11 | — | The unlock toast waited 3.6 s behind the toast budget; the news line and the Rewards row were immediate. No fix needed. |
| B12 | — | Already in the base. The browser sim is not bit-reproducible between runs, and residents can differ by a few dozen after a reload. |

### B7: the proposed fix (on post-B2 dev `1f4b99b` merged with this lane; not applied)

Cause, on post-B2 dev: `updateUseFactors` stores each transit building's use factor in `systemData.justice.use` only on `FACILITY_SCAN_DAY` (the 15th). `useChanged` re-shares airports alone, and drops an entry only when its building goes. A hub, station, depot or freight station that does not serve on the 15th keeps the stored 0 until the next 15th. That covers a road, rail or tunnel cut that spans the 15th, and equally a station whose partner is built after it. `demand.ts` multiplies the cap relief by that 0, and `budget.ts` the income. Cuts within a month need no fix: `venueOp`, which is live, already switches the relief off and on.

The minimal fix revives the stored zeros daily:

```ts
// src/sim/infra/facilities.ts, after useChanged() (the use-factor section)
/**
 * a transit building the month's scan stored as unconnected (use 0) — cut off on FACILITY_SCAN_DAY, or waiting for its
 * partner station — gets its use factor back on the first day it serves again, not on the next scan (LG-02 QA B7:
 * Grand Central's +30,000 / +30,000 relief stayed off for up to a month). Only the entries stored as 0 are read again,
 * through updateUseFactors' hook and rounding; nothing new is stored.
 */
export function reviveTransitUse(sim: Simulation): void {
  const st = sim.state;
  const use = (st.systemData.justice as { use?: Record<string, number> } | undefined)?.use;
  const hook = use ? transportUseHook() : null;
  if (!use || !hook) return;
  for (const id in use) {
    if (use[id] !== 0) continue;
    const b = st.buildings.get(Number(id));
    if (!b || useKind(b.def) !== 'transit') continue;
    const v = hook(st, b);
    if (typeof v === 'number' && v > 0 && Number.isFinite(v)) use[id] = Math.round(Math.min(1, v) * 1e4) / 1e4;
  }
}

// src/sim/infra/justice.ts, JusticeSystem.daily (+ reviveTransitUse in the facilities import)
    if (sim.state.day % DAYS_PER_MONTH === FACILITY_SCAN_DAY) facilityScan(sim);
    else reviveTransitUse(sim);

// src/sim/infra/facilities.ts, benefitOf: the real reason in the inspector, not "it is closed"
  if (op < 0.999) why = ISSUE_TEXT[(b.flags & BF.Burnt ? 'closed' : venueIssue(st, b, def)) ?? 'closed'];
  else if (use <= 0) why = 'it is not connected'; // (demand.ts' cap hint says "not connected" too)
```

- **Stored data.** No new field and nothing in the save hooks (T063). It writes the existing, persisted `systemData.justice.use[id]`, which can then change on any day, not only on the 15th; T063's continuity records should know that.
- **It changes simulation output** (NOTE-062's SIM rules apply). Relief and income come back the day a transit building serves again, instead of the next 15th. That includes the bot's own stations whose partner it builds after a 15th, so the 128×15 bot can move. New bot numbers with their cause, and the ensemble rows, come with the implementation; none were run here.
- **Determinism, save/load and cost.** It runs at a fixed point of the day. Its verdict is a pure function of the state (traffic's attachment refresh is lazy, but its verdicts do not depend on when it runs), and the ids are walked in ascending order. A loaded game re-reads the same zeros the next day and gets the same verdicts. Only the zeros are read. When the attachment cache is stale, the first read runs traffic's lazy refresh inside `JusticeSystem.daily`, as the 15th's scan already does. If B2's budget wants that refresh in a piece of its own, call it the way `services.ts` `prepAttach` does (`attachRefreshMs > 0` → `stopAttached(-1)`) before reading. It must never be skipped while the cache is stale, or the result would depend on whether a UI query refreshed the cache first.
- **The opposite gap stays.** A station cut after the 15th, with its road intact (a rail line cut, say), keeps its relief until the next 15th. Re-reading the 1s too would close that, but it changes more output, so it is not proposed.

### QA round 2 gates

All on this worktree, one process at a time, every vitest file and the bot through the lanes' quietrun (`node $quietrun npx vitest run <file> --maxWorkers=1`). The quiet gate waited out a real-GPU timing run. Vitest started normally (no native-loader workaround needed this round).

- `npx tsc --noEmit`: passed.
- The new tests, **22 passed**: `tests/game/uiFlyoutHeight.test.ts` 4, `tests/sim/lg02StatedCost.test.ts` 5, `tests/infra/lg02Inspector.test.ts` 3, `tests/game/lg02QaRound2.test.ts` 10.
- The lane's tests, **98 passed**: `lg02Landmarks` 17, `lateLandmarkEconomy` 10, `lateLandmarkCache` 1, `grandCentralBot` 3, `tests/infra/grandCentral` 9, `lateGameLandmarkIntegration` 8, `lateGameLandmarks` 2, `ranks` 48.
- `tests/sim/exact/*`, **36 passed**: `advisorsScan` 3, `blur` 10, `fireList` 7, `j10` 4, `nimby` 5, `traffic` 7.
- The existing tests of the files the last hunks touch (Tool.ts, ListPanels.ts, hud.css), **224 passed, 1 skipped**: `budgetPreview` 10, `panelCommands` 5, `rewardToast` 7, `ruinState` 2, `uiRuins` 11, `upkeepReads` 21, `cameraControls` 65, `dispatchBusy` 3, `dispatchCommands` 2, `pendingHover` 4, `pendingTools` 6, `quakeShakePlop` 3, `queryReads` 18, `toolCommands` 12, `toolsPreview` 10, `uiCutSettle` 4, `uiNetworkCutSettle` 4, `worker/lag` 5 (+1 skipped), `uiPanelReserve` 1, `uiStacking` 13, `worker/hygiene` 18.
- Earlier in this round, on the same opex.ts, facilities.ts, Toolbar.ts, PlopTool.ts and upkeepModel.ts (byte-identical since), the existing tests of those files, **36 files / 367 passed, 1 skipped**: `budgetPreview`, `panelsUpkeep`, `pendingHover`, `quakeShakePlop`, `queryReads`, `thumbsPendingRetention`, `toolsPlacement`, `toolsPreview`, `uiCardTip`, `uiPanelReserve`, `uiRuins`, `uiStacking`, `upkeepReads`, `inspectorModel`, `inspectorNotes`, `panelsMisc`, `panelsLayout`, `rewardToast`, `ruinState`, `toolCommands`, `pendingTools`, `infra/feedbackFacilities`, `feedbackGarbage`, `feedbackMemo`, `feedbackRuins`, `justice`, `transitFacilities`, `sim/advisorsRuins`, `balanceEconomy`, `phase0Contract`, `catalog`, `worker/hygiene`, `queries`, `upkeepContext`, `querySideEffects`, `infra/facilities`. Since that run, hud.css changed only in its comment.
- **Mutation checks.** Each run failed the cases written for it:
  - every call site of the round reverted (the helpers kept so the tests load): all 4 new files fail;
  - the office-tax row, Grand Central's fact order and the landmarks in `servedShare` reverted;
  - the Crown's fact and `tierCharged` mutated;
  - the B13 words in Tool.ts and ListPanels.ts reverted: exactly the plop-tip, Rewards-chip and `budgetPreview` cases fail;
  - the landmark estimate in `upkeepEstimate` disabled: the five card, plop-tip and Rewards B2 cases fail.

  Each file was restored afterwards; the sources were compared byte for byte against the gated copies.
- **The bot:** `node $quietrun npx --no-install tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet` → residents **[ 61124, 93804, 37971 ] = 192,899**, exit 0, and all 15 annual rows equal round 2's (the timing columns aside). Logs (in the scratchpad's `lanes/T071/`): `r3b/bot-128x15-s7.log`, and `r3b/rows.final` against `r3/rows.round2`. No 256-tile run was repeated (no sim change). The full suite, the real-GPU checks and the timing A/B remain for the lead.

### Browser recheck (QA round 2)

- [ ] 1280×720, Landmarks flyout: all three rows whole, the Metropolis Crown with its upkeep line, the flyout below the top bar. 1920×1080: unchanged. 1280×720 at UI scale 125 %: the third row scrolls behind a visible scrollbar (headed browser).
- [ ] In a city with a University or Public Library, the Central Library's card shows Upkeep "≈§A/mo typical in this city · up to §13,600 at full use", the note "§1,600 / month + §0.60 per learner served" and a Monthly budget row at §A. The flyout chip shows "≈§A/mo" and the Rewards chip "≈§A/mo typical". In a city with no college-level facility: "§1,600 / month". Likewise the Dome (up to §3,000) and the Observatory (up to §3,150).
- [ ] Placing the Library: "Upkeep ≈§A/mo now · up to §13,600 at full use", with the budget line at §A.
- [ ] Library inspector in QA's 1.1M save: Upkeep "§X / month" (not "§1,600") with the share hint "the building §1,600 + §N for the people it serves …". For scale: QA measured −§6,197 on the education line at its demolition, and the hint says bulldozing saves less than the share when nearby facilities take over.
- [ ] Placing Grand Central: the Transit view comes on, and the tip reads "Transit coverage 18 tiles · Connections train, subway and bus hub".
- [ ] Stock Exchange inspector: "+15,000 commercial jobs, +40,000 CO$$$ office jobs" and "Office tax +5% (CO$$ and CO$$$ receipts)"; without power, both read "none while it has no power". Its card reads "C +15,000 · CO$$$ +40,000" and "Office tax". The Crown's card reads "Approval +3 (civic pride)".
- [ ] Millennium Tower: the card note "about §2,500 / month at typical use — more when it is busy…", the plop tip "before its income (about §2,500 at typical use)" and the Rewards income chip title "Income at typical use — …".

## Round 2: restore exact cache and attachment layouts

Both reported causes are fixed without changing either exact test or its reference implementation. The round-1 sections below retain their original measurements; this section records the new verification against `b663747`.

| Changed file | Round-2 change |
|---|---|
| **Outside named files:** `src/sim/economy/population.ts` | One-line cause fix in `aggregate()`: inspect plopped commercial type with `getDef(b.def)`, which does not fill `EconRuntime.defCache`. The new aggregate lookup had cached civic definitions before the original occupancy path, changing sparse keys, holes and length. WTC commercial totals stay unchanged. No runtime cache code or layout changes. |
| **INFRA, outside named files:** `src/sim/infra/traffic.ts` | Restore the original `stAtt` reserve, `stops.n * 6 + 8`. Use the original six-entry temporary scratch without a hub, ten entries with a hub, and grow the persistent pool only if actual attachments exceed its capacity. Per-mode hub verdicts remain in the separate `hubModes` map. |
| **INFRA, outside named files:** `src/sim/infra/transportFacilities.ts` | Remove the redundant four-line Grand Central utility check from `transportUseFactor()`. Its existing `stopAttached()` call refreshes attachments and already enforces hub utilities. |
| `tests/sim/lateLandmarkCache.test.ts` (new) | Sparse definition-cache lifecycle regression: initialization, staffed occupancy and state replacement, including zero-capacity, abandoned and burnt civic plops. |
| `tests/infra/grandCentral.test.ts` | Two new regressions: all ten hub attachments fit the original reserve in a twelve-stop city (80 entries); eight duplicated hubs grow safely without truncating attachments or losing ownership. |
| `docs/dev/reports/local-T071-lg02.md` | Round-2 causes, gates and complete remaining infra hunk inventory. |

`stAtt` already uses packed attachments with `stAttS` offsets and `stAttC` counts; no stride change is needed. Ordinary stops use at most four nodes. One unique Grand Central needs at most ten, so a legal city with `n >= 1` stops uses at most `4(n - 1) + 10 = 4n + 6 <= 6n + 8` entries. Thus even the hub fits the old reserve. The overflow guard protects duplicated hubs in modded/debug cities; it cannot run in an ordinary city. The new regression exercises that guard. As with the existing grow-only pools, a modded city that once needed more capacity retains it after removals.

Cities without an LG-02 landmark keep the original persistent infra array layouts, capacities and unused bytes, and the original definition-cache fill timing and sparse shape. The separate empty `hubModes` map adds an object property, rather than changing any legacy array or cache. No exact comparison was loosened and no helper under `tests/sim/exact` was edited.

### Round-2 gates

- `tests/sim/exact/traffic.test.ts`: **7 passed**, including all three formerly failing full-array byte comparisons and growth, shrink, reload and reset coverage.
- `tests/sim/exact/j10.test.ts`: **4 passed**, including the formerly failing day-251 cache comparison.
- `tests/sim/lateLandmarkCache.test.ts`: **1 passed**.
- Every round-1 test file listed in the Tests and gates section below was rerun: **27 files / 375 tests passed** (Grand Central now has 9 cases).
- Total: **30 files / 387 tests passed**, each file run sequentially through quietrun. One `economy.test.ts` attempt hit the existing 5-second timeout in its dynamic-import test; an unchanged rerun passed all 12 cases in 2.40 seconds. Both attempts are retained in scratch logs. No timeout or test configuration was changed to obtain the pass.
- `npx tsc --noEmit`: **passed**. Final whitespace and UTF-8/BOM checks are clean.

Exact commands for the two repaired gates (same quiet gate, native loader and thread pool used for all other files):

```powershell
$env:NODE_OPTIONS = '--experimental-transform-types --no-warnings'
$quietrun = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
node $quietrun npx vitest run tests/sim/exact/traffic.test.ts --maxWorkers=1 --pool=threads --configLoader=native
node $quietrun npx vitest run tests/sim/exact/j10.test.ts --maxWorkers=1 --pool=threads --configLoader=native
```

The **128×15 seed-7 bot passes unchanged**, with residents `[61124, 93804, 37971]` = **192,899** in 2015. Exit status 0; no extra strategy flags. Actual round-2 command, using the previously documented scratch-only native TypeScript resolver because `tsx` is unavailable:

```powershell
$loader = 'file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T071/scratch/native-loader.mjs'
node $quietrun node --no-warnings --experimental-transform-types --loader $loader tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

Output: `scratch/round2-bot-128x15-s7.log`. The canonical command remains `node $quietrun npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet`. Round-2 test logs are `scratch/round2-*.log`. The 256×60 s7/s11 gates were not rerun for these bookkeeping fixes; their round-1 commands and acceptance numbers remain recorded below. The full suite, real-GPU checks, independent two-process hashes, aggregate GATE SUMMARY and the previously outstanding 128×15 tourism/population-history observer remain for the lead. No process from this lane remains running.

### Every remaining infra hunk for the B2 rebase

This inventory covers **round 1 plus round 2**, against `b663747^`. All are outside the original named task files. Nothing was moved or refactored.

| File | Remaining hunks, identified by symbol |
|---|---|
| `src/sim/infra/common.ts` | `Transit`: append `Hub = 8`; `TRANSIT_BY_MODEL`: Grand Central mapping. |
| `src/sim/infra/facilities.ts` | `TRANSIT_USE_DEFS`: Grand Central; `APPROVAL_CIVIC`: Crown +3 inspector fact. |
| `src/sim/infra/transit.ts` | `isStopMode()`: Hub; `computeTransitCoverage()`: hub catalog radius, preserving other mode radii. |
| `src/sim/infra/transportFacilities.ts` | `TRANSPORT_DEFS`: Grand Central; `transportFacilityReport()`: hub case; `ROLE`: hub description; `transportDefFacts()`: hub facts; `transportUseFactor()`: hub in the existing attached-stop case; `TRANSPORT_EFFECT_METRICS`: hub coverage metric. The separate utility-check hunk is gone. |

`src/sim/infra/traffic.ts` remaining hunks:

1. `DEPOT_DEFS` / `GARAGE_DEFS`: hub fleet and parking entries.
2. Class fields: separate `hubModes` map.
3. `init()` / `markT`: hub building-change invalidation despite its landmark category.
4. `hubModeAttached()`: separate connected-mode query.
5. `prep()` / `stationIds`: include hub for train samples.
6. `prep()` / `depotB`, `garageB`: gate hub fleet on bus attachment and parking on attachment.
7. `prepTransit()` / `tmp`: ten scratch entries only with hubs, otherwise legacy six. The persistent `stAtt` reserve line is now identical to dev and is no longer a diff hunk.
8. `prepTransit()` / node collection and depot assignment: hub's 2 bus + 4 rail + 4 subway nodes; actual-capacity overflow guard for duplicated hubs; bus ownership for road-connected hubs.
9. `prepTransit()` / wait assignment: hub-only wait choice.
10. `prepTransit()` / transfer edges: internal links between the hub's connected modes.
11. `baseWait()` / `hubWait()`: hub wait helper; existing mode formulas unchanged.
12. `refreshAttach()` / map clearing: reset side data with existing attachment verdicts.
13. `refreshAttach()` / classification, `attachMode`, bus verdict: hub utility gate and three-mode membership; ordinary attachment writes retain their prior order and values.
14. `refreshAttach()` / subway verdict: call `attachMode`.
15. `refreshAttach()` / train verdict: call `attachMode`.
16. `freightTrainRoutes()` / role filter: include hub in passenger samples.
17. `freightTrainRoutes()` / rail verdict: sample a hub train only while its train mode is attached.

Round 2 introduces no new plan/code mismatch, balance change, RNG draw, save key or cloud-held-file request. It fixes the layout violations rather than carrying them into B2. **Cloud requests: none.** The complete browser acceptance checklist remains in Art pipeline and browser handoff below; those checks were not run here.

## Behavior and files

| File | Change |
|---|---|
| `src/sim/economy/rewards.ts` | Separate LG-02 helper and table block: seven permanent population unlocks at 200k, 300k, 400k, 650k, 800k, 1M and 1.5M, with descriptions of their actual effects. Existing monthly announcements, reward refs and silent old-save initialization are reused. |
| `src/sim/catalog.ts` | Seven unique, paid landmarks, library/green service tiers, transit coverage, jobs, prestige, visit income and a separate CAP_RELIEF block. |
| `src/sim/economy/approval.ts` | Separate Crown helper adds exactly 3 to the existing civic term while complete and intact; removal, construction, abandonment and ruins remove the bonus. |
| `src/sim/economy/tourism.ts` | Separate attraction rows; Grand Central's connected train mode contributes a rail connection. Removing a bus-only hub preserves other train stations' saved connection contributions. No pass format change. |
| `src/assets/manifest.ts` | Removes only the seven LG-02 pending-catalog wrappers and their now-unused helper. All existing builders and geometry are unchanged. |
| **Outside named files:** `src/sim/economy/budget.ts` | Small, separate Stock Exchange hook: operating exchange multiplies only CO$$/CO$$$ tax receipts by 1.05 before ledger rounding. Tax rates and other tax rows are unchanged. |
| **Outside named files:** `src/sim/economy/population.ts` | Small plopped-job aggregation branch: the World Trade Center's 8,000 CO$$$ jobs enter commercial capacity, employment and tax totals once, rather than civic totals. |
| **Outside named files:** `tools/simbot.ts` | Two-line Grand Central-only branch reuses `placeVenue()` after the existing affordability check. The first gate run exposed that the civic path's sparse lot search never bought Grand Central in 60 years; the full landmark search buys it without changing any earlier reward path. |
| **INFRA, outside named files:** `src/sim/infra/common.ts` | Appends the Hub enum value and classifies Grand Central by model/id. Existing values are unchanged. |
| **INFRA, outside named files:** `src/sim/infra/transit.ts` | Recognizes Hub as a stop and uses its 18-tile radius in fallback transit coverage. |
| **INFRA, outside named files:** `src/sim/infra/traffic.ts` | Hub-only attachment map and graph transfers for bus/train/subway; one building/stop/load key; counts toward each linked line, supplies a 40-bus depot and 2,000 parking spaces; closes when incomplete, ruined, abandoned or lacking utilities. Bus fleet requires a road. Ordinary stops keep their prior paths. |
| **INFRA, outside named files:** `src/sim/infra/transportFacilities.ts` | Hub report/facts, connected use factor and effect metric; preserves the no-traffic fallback. |
| **INFRA, outside named files:** `src/sim/infra/facilities.ts` | Two table entries only: Grand Central transit-use hook and Crown +3 civic fact. |
| **Outside named files, existing test:** `tests/sim/ranks.test.ts` | Two-line setup hunk pre-unlocks rewards in the rank-persistence case. Its 750k-to-1M jump now legitimately unlocks two landmarks, so a rank-only no-news assertion needs independent reward state. |

Five new test files are listed below. No other source files were edited. All infra changes are confined to the above hooks, with no moved code or refactor; keep these hunks separate when rebasing on B2.

## Content choices

The plan fixes two visitor draws and three cap amounts. Unspecified commercial relief and draws are paired against the existing comparison formula, `legacy tourism jobs = C relief × 0.05`; visitors produce `0.5` shop jobs each. No existing draw, cap, tuning constant or RNG stream changes.

| Landmark | Cost / monthly upkeep | Reference draw | CAP_RELIEF |
|---|---|---:|---|
| Central Library | 150,000 / 1,600 | 1,000 | R 12k, C 12k |
| Grand Central | 250,000 / 2,000 | 2,400 | R 30k, C 30k |
| Stock Exchange | 300,000 / 1,400 | 1,200 | C 15k, CO$$$ 40k |
| Botanical Dome | 400,000 / 1,800 | 3,500 | R 50k, C 35k |
| World Trade Center | 650,000 / 3,500 | 5,000 | C 60k |
| Millennium Tower | 1,000,000 / 4,000 | 7,000 | R 50k, C 70k |
| Metropolis Crown | 1,500,000 / 4,500 | 6,500 | R 60k, C 80k |

Library: library tier, 20,000 students. Dome: green tier, 80,000 capacity. Stock prestige is 0.5 / 18 tiles; Millennium prestige is 0.7 / 26 tiles. Millennium's reference monthly ticket income is 2,500 and scales through the existing visit-income formula. Crown civic pride does not depend on utility supply; its tourist operation does. The existing `CITY_RANKS` already awards the Megalopolis title at 1.5M, so no duplicate title state was added.

Grand Central enables each mode according to that mode's existing connection rules. A road-connected bus hub can operate without a train or subway partner; a lone rail/tunnel line does not become connected merely because buses run. The existing shared stop-load/crowding model also applies to the hub; a busy multimodal hub shares that load across its facility model. Detailed routed-commuter calibration remains a lead integration check.

## Tests and gates

The normal Vite config loader initially failed before tests with sandbox `spawn EPERM`. The supported native config loader and thread pool worked. Every Vitest invocation was a **single file**, sequentially, through the required quiet gate:

```powershell
$env:NODE_OPTIONS = '--experimental-transform-types'
node $quietrun npx vitest run <file> --maxWorkers=1 --pool=threads --configLoader=native
```

`$quietrun` is the shared `scratchpad/lanes/quietrun.mjs` from the task. No full suite, browser or benchmark was run.

New files:

- `tests/sim/lg02Landmarks.test.ts`: exact unlock thresholds, one announcement, population-drop permanence, old saves without new keys, existing title, catalog effects, actual service-tier pass, economy-only cap fallback, Crown lifecycle, paid visits, bus-only-hub removal, and the extended synthetic tourism case through all seven purchases with and without hotel shortages.
- `tests/sim/lateLandmarkEconomy.test.ts`: 10 cases for Medium/Hard tax parity without an exchange, office-only 5%, operational gating, demolition and typed WTC employment without civic double counting.
- `tests/infra/grandCentral.test.ts`: 7 cases for one stop key, connected station counts, fleet/parking, cross-mode transfers, lone-line gating, 18-tile coverage and closure.
- `tests/render/lateGameLandmarkIntegration.test.ts`: 8 cases for all finished manifest entries and all 14 registered variants, gallery group membership, night surfaces and complete seasonal crown/twig pairing.
- `tests/sim/grandCentralBot.test.ts`: 3 cases for buying Grand Central from a fragmented park block, building missing access roads first, and no changes before its unlock.

Existing affected files checked: `catalog`, `ranks`, `milestoneNews`, `approval`, `approvalGuide`, `tourism`, `employment`, `transitFacilities`, `facilities`, `traffic`, `trafficRegion`, `manifest`, `lateGameLandmarks`, `botanicalDomeWorldTradeCenter`, `millennium_crown`, `economy`, `demographics`, `difficultyRules`, `monthSpread`, `worker/hygiene`, `botVenues`, `botLongGame` (all `.test.ts` in their existing directories).

These **27 files / 373 tests pass**, including **45 new tests**. Final `npx tsc --noEmit` and `git diff --check` are clean; all 20 changed/new files validate as UTF-8 without a BOM. The full suite and real-GPU timing/render checks remain for the lead.

## Bot measurements

The requested `npx tsx` command could not start because `tsx` is not installed/cached and network access is unavailable (`ENOTCACHED`). Native Node 22 TypeScript transformation plus a scratch-only extension resolver runs the same exported `SimBot`, `parseArgs` and `botSystems(false)`, without source/build changes. Every bot invocation uses the quiet gate, one process at a time. The probe observes monthly tourism jobs / `demandContext().tourism`, first population crossings, unlock events and purchases, and writes yearly/raw monthly data under the task's scratch folder.

Requested simbot commands, with the shared quiet-gate path represented by `$quietrun`:

```powershell
node $quietrun npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
node $quietrun npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet
node $quietrun npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet
```

Actual measurement command form (`$loader` is the file URL of `scratch/native-loader.mjs`, `$probe` is the absolute `scratch/lg02-gate-probe.mjs` path):

```powershell
node $quietrun node --no-warnings --experimental-transform-types --loader $loader $probe --size 128 --years 15 --seed 7 --quiet
node $quietrun node --no-warnings --experimental-transform-types --loader $loader $probe --size 256 --years 60 --seed 7 --quiet
node $quietrun node --no-warnings --experimental-transform-types --loader $loader $probe --size 256 --years 60 --seed 11 --quiet
```

The native direct CLI run finished with residents `[61124, 93804, 37971]` = **192,899**, exactly as required. Final observed-gate results follow below.

The extended synthetic case stays within **1.164957–1.218595** with enough hotel rooms and **0.934061–1.061229** with a shortage, through all seven purchases. Diagnostics: `scratch/synthetic-final.jsonl`.

The corrected 256×60 seed-7 run buys **all seven**. In 2060 it has **1,584,602** residents `[411993, 782605, 390004]`. Annual 12-month mean tourism ratios from year 15 are **0.840242–1.137762**; checking **every rolling 12-month window** from year 15 gives **0.834626–1.139379**, within 0.7–1.3. Diagnostics: `scratch/gate-256x60-s7.{json,jsonl,log}`.

| s7 landmark | First population crossing (day) | Unlock (day) | Delay to monthly check | Purchase (day) | First year-end population row |
|---|---:|---:|---:|---:|---:|
| Central Library | 5747 | 5760 | 13 | 8340 | 2016 |
| Grand Central | 7451 | 7470 | 19 | 9240 | 2021 |
| Stock Exchange | 8931 | 8940 | 9 | 8940 | 2025 |
| Botanical Dome | 11889 | 11910 | 21 | 11910 | 2034 |
| World Trade Center | 13473 | 13500 | 27 | 13500 | 2038 |
| Millennium Tower | 15538 | 15540 | 2 | 15540 | 2044 |
| Metropolis Crown | 20381 | 20400 | 19 | 20400 | 2057 |

Every unlock occurs at the first monthly check after its threshold crossing. The bot waits to afford the Library and Grand Central, as its existing reserve rules require. **The plan's historical annual population rows are not reproduced exactly:** Dome, Millennium and Crown first appear above threshold in 2034/2044/2057 here, versus the quoted 2033/2043/2056. Unlock calendar dates are a different convention from year-end bot rows (for example, day 11910 is in calendar 2033, before row 2034). No date gate was added to force the old labels. The new landmarks intentionally change high-population cities through their requested cap, service, transit, job, tax and approval effects; the 128×15 baseline remains unchanged.

The 256×60 seed-11 run ends at **1,477,199** residents `[386947, 723124, 367128]`. Annual tourism ratios are **0.932676–1.272763**; every rolling 12-month window from year 15 stays within **0.910579–1.272763**. It buys the six landmarks it reaches; it never reaches 1.5M, so the Crown correctly stays locked. Its first year-end threshold rows are 2016, 2021, 2025, 2034, 2038 and 2043. Diagnostics: `scratch/gate-256x60-s11.{json,jsonl,log}`.

Both long runs use the default LG-10-capable bot strategy. The existing venue fund buys landmarks without an extra flag; `--venues` adds a zoo and ordinary passenger station, rather than enabling landmark buying. No optional strategy flags were enabled in these three base gates.

G-POP against every phase-0 year in the existing fixture also passes on the long runs: s7's minimum ratio is **1.069747**, y15 **181,278**, y60 **1,584,602**; s11's minimum ratio is **0.952760**, y15 **182,428**, y60 **1,477,199**. These satisfy the 0.9× yearly, 150k y15 and 950k y60 bounds.

Not checked here: the full Vitest suite, real-GPU rendering/timing, the complete aggregate GATE SUMMARY (funds/emergencies/etc.), optional strategy variants, and the independent two-process yearly hash audit. Targeted save-continuation tests and Worker hygiene pass; the lead retains the integration checks. The final 128×15 monthly tourism observer could not start while the timing run held `QUIET`; only this lane's queued command was cancelled. **The 128×15 rolling tourism ratio and yearly phase-0 population comparison remain for the lead.** Its required population parity was already confirmed by the direct CLI run above. No measurement remains running from this lane.

## Art pipeline and browser handoff

All seven models have two variants. Existing art tests check both variants, full geometry ≤8,000 triangles, proxy LOD ≤200, bounds, heights, deterministic geometry and night metadata; the new integration test builds through the actual model registry. No builder failed these headless checks. `gallery.html` already loads `src/gallery/main.ts`, which enumerates the manifest and all variants, so no HTML edit is needed. The gallery has no month/climate URL option: use the existing seasonal-uniform inspection workflow for January checks.

Real-GPU checks remain for the lead:

- [ ] All seven models, both variants, in the landmark gallery at default and street/close zoom: day, night and temperate January. Check every shot and gallery flags/console.
- [ ] Night windows and signature clock, crown, sky-deck and mast lighting; close-up tower tops; winter bare deciduous trees and retained evergreens.
- [ ] Place all seven from Rewards; verify footprint/rotation, thumbnails, unique-placement lock, lock progress and unlock toast/ref.
- [ ] Library and Dome inspector show their service tier, capacity, coverage, funding and strike response.
- [ ] Grand Central connects independently to bus, a working rail line and a paired subway line; inspect 18-tile coverage, buses, 2,000 spaces, park-and-ride commuting and +30k R/C relief. Remove/reconnect utilities and lines; check live and loopback hosts.
- [ ] Stock Exchange raises office receipts only; WTC has 8,000 CO$$$ slots without civic double count; Millennium earns visit-scaled income.
- [ ] Crown contributes +3 civic approval; demolition/ruins remove it; Megalopolis title appears at 1.5M; save/load continues with all seven.
- [ ] Existing landmarks and ordinary town/dense-city renders remain visually unchanged.

## Plan/code differences and cloud requests

- The task note says a 128×15 city never reaches 150k; this base reaches 192,899. The first new unlock is 200k, so the promised unchanged run still applies.
- The named files cannot express a multi-mode transit hub, office-only tax revenue or commercial plopped employment by catalog data alone. The minimal source exceptions are itemized above.
- The synthetic extension lives in a new test file, as §7.4 asks, rather than editing the existing tourism test.
- The existing title and automatic gallery enumeration are reused. There are no new systemData keys, save formats, worker commands, UI reads/mutations or RNG draws.
- **Cloud-held file requests: none.** No worker/save/App/TopBar/advisor or building/effects-renderer edits are required.
