# T064: round 2 GUIDE items, FH-23 and the TopBar LIVE-title hunk (cloud lanes)

Cloud lanes: 12 lanes in three chains that run in parallel (guide2a, guide2b, guide2c). Base: dev
(`claude/beautiful-johnson-u2jqoz`) at or after 43679b3, which holds the TopBar split (0cfb10d). NOTE-088 moved these
items from the desktop to the cloud: the cloud implements and merges them, and the desktop runs each lane's Desktop QA
on dev after it merges.

## Context

- **Spec.** Each lane implements its docs/POLISH_PLAN.md section in full (the heading is named in the lane), with §4
  (onboarding copy, Phase D explainers, Phase E briefing), §7.2-§7.4 (files and cross-lane rules) and §8.2 (round 2's
  verifier list). The plan's file:line references are against e116226, so find each hunk by the identifier it names.
  The references in this file are against 43679b3.
- **Bot reference.** Residents [ 61828, 95515, 40772 ] = 198,115 (128x15 seed 7). They stay unchanged unless the lane
  changes the sim by design and says so. Only NEW-06 may do that (the shore rule and the Seaport unlock). Lanes that
  change posted advice text or advice rules (FH-18, FH-13) move the `news` and `systemData.advisors` hashes by design.
  They compare hashes by FH-03's rule (without `news` and `systemData.advisors`), and the residents stay at 198,115.
- **No browser checks on the cloud** (NOTE-061; lock.sh refuses them). Each lane's report ends with a **Desktop QA**
  list for the real GPU: 1280x720 always, 1920x1080 where layout matters, and the default host plus `?simworker=1` where
  the lane reads sim data. The desktop runs the list on dev after the merge (NOTE-067's correction) and replies
  "QA <lane>: PASS" or "QA <lane>: FAIL".
- **Merges (NOTE-064).** The cloud merges its own lanes. Each lane works on `cloud/t064-<item>` (for example
  `cloud/t064-fh16`). When its gates pass, it merges into dev in chain order, appends a carry-over log line, and adds a
  line to docs/dev/queue/T064-guide-r2-cloud.done. Desktop lanes merge themselves: never merge, cherry-pick or copy code
  from a `local/*` branch. Reading them is fine.
- **At the start of every lane:**
  - `git fetch`, then branch from the previous lane's head in the chain (the first lane branches from dev);
  - merge the current dev in (no rebase, no force-push) and run tsc;
  - check which in-flight desktop lanes have landed, and follow the lane's "if in dev / if not" rule. Each is in dev
    when the named path exists on dev:

    | desktop lane | what it brings | in dev when |
    |---|---|---|
    | T037a (local/R1-guide-a) | the onboarding framework: GuideProfile, ExplainerQueue, `Onboarding.offerExplainer`, goals.ts, coach.ts | `src/ui/guide/explainers.ts` |
    | T037e (local/T037e-fh05-advisor) | budgetDelta.ts with `budgetEffect`, `askedServices`, `quotedUpkeep`; the AdvisorsPanel finance card; removes `budgetEffect` from Tool.ts | `src/ui/guide/budgetDelta.ts` |
    | T075 (local/T075-camera) | live key bindings in HelpPanel | `src/game/bindings.ts` |
    | T078 (local/T078-feel21) | motion settings; edits hud.css, CityScene, SettingsPanel, Toolbar and A11Y_WIRED | `A11Y_WIRED.motion` is `true` |
- **Other lanes in flight on the same files.** Keep hunks small and local; whichever lane merges second resolves the
  conflict.
  - Desktop:
    - T041: BudgetPanel.ts, growth.ts;
    - T054b and T074: advisors.ts (T074 also Notifications.ts);
    - T070 and T071: rewards.ts, ListPanels.ts, population.ts, facilities.ts;
    - T042, T046 and T055: actions.ts, facilities.ts, growth.ts;
    - T045 and T072: growth.ts (T045 also inspectorModel.ts `:356`).
  - Cloud:
    - T047 (chain w2c1): CityScene.ts and EmergencyBanner.ts;
    - T063 (chain infra1): the src/sim/infra save hooks.
- **Ownership.**
  - NOTE-088 gives these items to the cloud whole. So a lane also writes the SIM, CONTENT and META hunks its item needs
    (NEW-06, NEW-07, FH-23, and FH-18's one-liners), and its report names each hunk's §7.3 owner.
  - A chain edits only the files in its own column of the split below. A lane that needs a change in another chain's
    file writes the request in its report. That chain makes the change, or the lead does once both chains have merged.
- **Hygiene.**
  - Keep the Worker hygiene test green: no `.speed =`, `emergencyOf(` or `getSystem(` in src/ui or src/game, and no
    writes into the replica.
  - UI reads go through host queries, watches and replica-safe reads.
  - Add new test files rather than edit another lane's tests (§7.4).
- **Copy.**
  - Strings that §4 already has come from `guideCopy` (src/ui/guide/copy.ts). Every lane treats copy.ts as read only.
  - Where copy.ts's wording differs from the plan's examples, copy.ts wins, and the report notes it. For example,
    `actions.GotIt()` is "Continue" and `actions.GuidedStart()` is "Show your guided start anyway".
- **Styles.**
  - src/ui/hud.css belongs to chain guide2b (FH-23's global rules).
  - Chain guide2a puts new styles in src/ui/guide/advice.css; chain guide2c in src/ui/guide/inspect.css.
  - Both files are new. The module that uses one imports it, as MilestoneCard.ts imports milestone.css.

## Gates (every lane)

1. `npm run typecheck` (tsc) is clean.
2. **Revert check:** the lane's new tests fail with its src change reverted. The report gives the result per test file.
3. The full vitest passes under the lock.
4. **The bot** (128x15 seed 7) runs under the lock when the diff touches src/sim, src/worker, src/game or src/save.
   Expect residents 198,115 unless the lane says why not. A lane whose diff is only src/ui and tests skips the bot and
   says so (tools/simbot.ts imports no src/ui file).
5. The lane's acceptance list, each item with its number or the test that checks it.
6. **HUD trace:** a lane that changes the top bar re-records tests/game/fixtures/topBarTrace.json with
   `TOPBAR_TRACE=write`, and its report shows that the diff holds only the intended change.

**Report:** docs/dev/reports/cloud-T064-<item>.md, with the item id as written (for example cloud-T064-FH-16.md). It
covers what was already in dev; what changed (files, and each hunk with its §7.3 owner); decisions; the gates with
numbers; requests to other chains or the lead; and the Desktop QA list, last.

## The chain split

| chain | lanes, in order | files it owns (edits) |
|---|---|---|
| **guide2a**: advice and money panels | t064-fh16 → t064-fh14 → t064-fh18 → t064-fh13 | src/ui/glossary.ts (new); src/ui/panels/AdvisorsPanel.ts, BudgetPanel.ts, StatsPanel.ts, DemographicsPanel.ts, GraphsPanel.ts; src/ui/adviceActions.ts; src/ui/guide/nextStep.ts, briefing.ts, moneyCoach.ts, advice.css (new); src/ui/Onboarding.ts; src/ui/Notifications.ts (the welcome tip line only); src/sim/economy/advisors.ts (GUIDE hunks); src/sim/catalog.ts (one string, only if players see it); tests/sim/advisors.test.ts, tests/game/panelsAdvisors.test.ts, tests/game/budgetTaxes.test.ts, and new tests |
| **guide2b**: top bar, text size and Help | t064-fh08live → t064-feel03 → t064-fh23 → t064-fh17 | src/ui/topbar/**; tests/game/fixtures/topBarTrace.json, tests/game/topBar*.test.ts; src/ui/FloatText.ts, src/ui/floatText.css (new); src/game/tools/Tool.ts (the commit feedback hunk); src/ui/zoom.ts; src/game/CityScene.ts; src/ui/hud.css; src/region/** (settings.ts, ui/dialogs.ts, ui/meta.css, ui/TitleScreen.ts, RegionScreen.ts, NewCityDialog.ts); src/main.ts (only if FH-23 needs it); src/ui/panels/SettingsPanel.ts; src/ui/Toolbar.ts; src/ui/Modals.ts (`HelpPanel`, `SHORTCUTS`); src/ui/Panel.ts; src/ui/guide/helpTopics.ts, help.css (new); tests/game/titleSettings.test.ts, and new tests |
| **guide2c**: inspector, placement, shore and sim strings | t064-feel19 → t064-new07 → t064-fh15 → t064-new06 | src/game/tools/QueryTool.ts (`move()`), PlopTool.ts, placement.ts, NetworkTool.ts (only for routed 15's text, if it is there); src/ui/inspectorModel.ts, src/ui/zoneStatus.ts, src/ui/panels/InfoPanel.ts, src/ui/panels/ListPanels.ts; src/ui/guide/previews.ts, shoreSites.ts, inspect.css (new); src/ui/guide/goals.ts (T037a's file, only once it is in dev, for G9); src/sim/actions.ts, src/sim/economy/buildings.ts, rewards.ts, growth.ts, population.ts, src/sim/infra/facilities.ts; src/worker/**; tests/game/toolsPlacement.test.ts, toolsPreview.test.ts, inspectorModel.test.ts, tests/infra/feedbackFacilities.test.ts, tests/worker/replicaSafe.test.ts, and new tests |

Read only in every chain: src/ui/guide/copy.ts, src/region/newCityPrefs.ts and tools/simbot.ts. T037a's guide modules
(explainers.ts, progress.ts, coach.ts, founding.ts, tips.ts, edgeHint.ts) are read only too; goals.ts goes to
guide2c as listed above.

**Why this split**
- **guide2a.**
  - AdvisorsPanel.ts is shared by FH-16, FH-14, FH-18 and FH-13; advisors.ts by FH-18 and FH-13; BudgetPanel.ts by
    FH-16 and FH-13. So these four items form one chain.
  - FH-18 and FH-13 go last because they build on T037a (FH-13 also on T037e), the desktop lanes closest to landing.
- **guide2b.**
  - src/ui/topbar/** and the HUD trace are shared by the LIVE title, FEEL-03 and FH-23, so they form one chain. The
    smallest goes first, so each trace re-record has one cause.
  - FH-17 joins this chain: no other item edits Modals.ts or Panel.ts. It goes last, which gives T037a and T075 time to
    land.
- **guide2c.**
  - These files are shared, so the four items form one chain:
    - PlopTool.ts and placement.ts by FH-15 and NEW-06;
    - InfoPanel.ts and inspectorModel.ts by FEEL-19 (and NEW-07, if a facility row needs it);
    - actions.ts by NEW-07 (if routed 15's highway text is there) and NEW-06;
    - src/worker/** by FH-15 (if it needs a query) and NEW-06.
  - NEW-06 goes last: it is the only lane that may move the bot.
- **Three cuts keep the chains disjoint:**
  - FH-14 derives `tool` and `cost` in the UI from the advice id, the option the plan's risk line allows. So guide2a
    never edits src/worker/** or the `Advice` interface.
  - FH-16 builds its plain names from rciSegment.ts's `DEV_NAMES` by import, and does not edit the RCI popover. The
    popover's glossary hookup becomes an optional step of t064-fh23 (if glossary.ts is in dev by then), or a
    follow-up.
  - Routed 15's advisor strings (jail, riot) move to t064-fh18, in the chain that owns advisors.ts. t064-new07 does not
    edit advisors.ts.
- **No hard dependency crosses chains.** Two soft ones remain:
  - FH-17's Money topic and FH-13: FH-17 writes it from tuning and copy.ts. If t064-fh13 is in dev, it links to
    Budget's Loans tab.
  - FH-17 and FH-16's glossary: FH-17 reuses it if it is in dev.

---

## t064-fh16 · FH-16: plain names next to R$, CS$$$, CO$$, I-D, EQ and HQ (guide2a, lane 1)

**Implement** "#### FH-16 · Plain names next to R$, CS$$$, CO$$, I-D, EQ and HQ" in full.

**In dev already.** Nothing of FH-16, and there is no src/ui/glossary.ts.
- The codes are `DEV_TYPE_LABELS` (src/core/types.ts:61).
- Plain names exist only as `DEV_NAMES` (src/ui/topbar/rciSegment.ts:34-39). TopBar.ts:23 re-exports it and InfoPanel
  imports it.
- The tax row tooltip is still "Last month: §X" (BudgetPanel.ts:221).
- EQ and HQ show with no explanation in StatsPanel.ts:133-134, AdvisorsPanel.ts:94-96, DemographicsPanel.ts:152-153 and
  :187-188, and GraphsPanel.ts:63.

**Do**
- **glossary.ts (new).** One entry per development type: its code (from `DEV_TYPE_LABELS`), its plain name (from
  `DEV_NAMES` by import, so the names keep one source), and what it wants.
  - Add entries for EQ ("Education quotient — how educated your workers are (0–150); offices and high-tech want 80+")
    and HQ (the health equivalent).
  - Read every number from tuning or the demand code; never type one.
- **BudgetPanel.**
  - Every tax row and every ledger tax line shows the plain name on a second, dim line.
  - The row tooltip says what the type wants and keeps last month's amount.
- **Hover entries.** The StatsPanel EQ/HQ meters, the AdvisorsPanel EQ/HQ lines, the DemographicsPanel EQ/HQ cards (not
  in the plan's list; same lane) and GraphsPanel's EQ/HQ series labels show the glossary entry on hover.
- **Do not edit** rciSegment.ts, TopBar.ts or InfoPanel.ts (other chains' files).

**Files**
- src/ui/glossary.ts (new);
- src/ui/panels/BudgetPanel.ts, StatsPanel.ts, AdvisorsPanel.ts, DemographicsPanel.ts, GraphsPanel.ts;
- src/ui/guide/advice.css (new, if the lane needs styles);
- tests/game/glossary.test.ts (new).

**Depends on.** PB-LEDGER, PB-SLIDER and the TopBar split, all in dev. Desktop lanes T041 (BudgetPanel) and T037e
(AdvisorsPanel) are in flight, so keep the hunks local.

**Acceptance**
- Every tax row and ledger tax line shows a plain name on a second dim line (a DOM test over every development type).
- Hovering EQ in Stats shows the glossary entry; HQ likewise (test).
- The glossary's names equal `DEV_NAMES`, and its numbers equal tuning (text test).
- 1280x720 shows no truncation. The Desktop QA checks this; the test checks that the second line is its own element and
  that the row keeps its slider width.

**Gates.** tsc; glossary.test.ts fails when the change is reverted; the full vitest. No bot (src/ui only).

**Report.** docs/dev/reports/cloud-T064-FH-16.md. Desktop QA:
- Budget's Taxes and "Income & expenses" tabs at 1280x720 and 1920x1080: no truncation, second lines dim;
- Stats EQ/HQ hover;
- the Advisors and Demographics EQ/HQ entries.

## t064-fh14 · FH-14: one recommended next step above the advisor cards (guide2a, lane 2)

**Implement** "#### FH-14 · One recommended next step above the advisor cards" in full.

**In dev already.** Nothing of FH-14.
- `Advice` (src/sim/economy/advisors.ts:100-126) has `ref` and `options`, but no tool or cost field; neither does
  `OpenAdvice` (:1713-1723).
- src/worker/queries.ts:27-30 `advice()` copies a fixed field list, so new fields would be dropped on the worker host.
- `AdvisorsPanel.alertCount` (:385-395) counts only advisors whose assessment is 'bad'. CityScene.ts:769 feeds the badge
  from it.
- adviceActions.ts `ACTIONS` (:101-110) has only zoneR/C/I, noRoadAccess, rezone and connect.
- FH-05's `budgetEffect` is in Tool.ts:182 (T037e moves it to src/ui/guide/budgetDelta.ts).
- W0.3's `openAdvice` query and `advisorIssues` watch are in dev.

**Decision, fixed for this lane.** Derive the step's `tool` and `cost` in the UI, keyed by the advice id and `ref`
(adviceActions.ts already maps actions by id, never by text), from `getDef()` and tuning.
- Do not edit advisors.ts or src/worker/** (src/worker is chain guide2c's).
- The plan's "`Advice` gains optional `tool` and `cost` fields" is met by the UI-side step record. Name this decision in
  the report.
- If some advice cannot be mapped this way, write the request in the report instead of editing the sim.

**Do**
- **guide/nextStep.ts (new).** A pure ranking:
  - it takes the open issues (`OpenAdvice[]`) plus the population, funds and recurring monthly net;
  - it returns the highest-priority issue the player can act on now (a tool or a place, and a cost that fits the funds
    and monthly budget), or null;
  - under 10,000 residents, cheap high-impact fixes rank first: zone more, landfill, police kiosk, fire station.
- **The "Next step" card** at the top of AdvisorsPanel:
  - its text, such as "Zone a landfill — 3×3 ≈ §135, upkeep about §9 a month", with every number from `getDef()` or
    tuning;
  - its budget effect (FH-05's helper);
  - a Show me button and the tool button.
- **New adviceActions entries**, for example a landfill zone, a police kiosk or the Police tab, a fire station or the
  Fire tab, and a school or the Education tab.
- **The budget helpers.** If T037e is in dev, use budgetDelta.ts (`budgetEffect`, `askedServices`, `quotedUpkeep`).
  If not, import `budgetEffect` from Tool.ts (read only) and keep any extra helper in nextStep.ts.
- **The badge.**
  - `alertCount` returns the number of open issues of kind bad or warning.
  - Keep it cheap while the panel is shut: use the monthly `advisorIssues` watch, never an `openAdvice` scan.
  - Do not edit CityScene.ts (chain guide2b's).

**Files**
- src/ui/panels/AdvisorsPanel.ts, src/ui/adviceActions.ts;
- src/ui/guide/nextStep.ts (new), src/ui/guide/advice.css;
- tests/game/nextStep.test.ts (new), tests/game/panelsAdvisors.test.ts (the badge).

**Depends on.**
- In dev: FH-05, W0.3, PB-PANELS, PB-BROWNOUT, PB-PARKS and PB-DEPOT.
- T037e (desktop): build on it if it is in dev; otherwise keep the AdvisorsPanel hunk local.

**Acceptance**
- Three fixtures, each with its expected Next step:
  1. like Queensbury in Nov 2000 (2,430 residents; no landfill, no school, plant out of fire reach): the landfill, with
     a Landfill button;
  2. like Sunside in Mar 2002 (233 residents; R demand above 0.5, fewer than 12 empty R front lots, a landfill in
     place): "Zone homes", with the Zones button;
  3. a 6,000-resident town with a landfill and spare lots, a crime term of −4 or worse and no police: a Police Kiosk
     (its cost from `getDef()`, §400 today), with the Police tab.
- The card shows the cost and the budget effect, with the Show me and tool buttons.
- After the step is done, the next month's Next step changes (fixture test: apply the fix, run a month, compare).
- A unit test covers the ranking, including the under-10,000 order and the affordability rule.
- The badge counts open bad and warning issues.

**Gates.** tsc; nextStep.test.ts fails when the change is reverted; the full vitest. No bot (src/ui only). If the lane
touches src/sim after all, run the bot and use FH-03's rule.

**Report.** docs/dev/reports/cloud-T064-FH-14.md. Desktop QA, in a young city on both hosts:
- the card shows;
- each button opens its tool or tab, and Show me flies to the place;
- the badge count matches the open bad and warning issues;
- the layout at 1280x720.

## t064-fh18 · FH-18: one-card briefing for SimCity 4 veterans, and the power-lines wording (guide2a, lane 3)

**Implement** "#### FH-18 · A one-card briefing for SimCity 4 veterans" and §4.7 Phase E in full.

**In dev already.** Groundwork only.
- The briefing strings `guideCopy.phaseE` (Roads, Pipes, Region, Emergencies, Inspector, Taxes) and
  `actions.GuidedStart` / `actions.GotIt` are in src/ui/guide/copy.ts (:264-276, :313, :332).
  tests/game/guideCopy.test.ts:166-168 caps the briefing at 90 words.
- The New City dialog's veteran toggle and the `veteran` key in the 'onboarding' pref (FH-11, src/region/newCityPrefs.ts:24-43)
  skip the founding steps.
- FEEL-01 bans "connect…with power lines" in Notifications.ts (tests/game/newsTicker.test.ts:486). But the ticker's
  welcome tip (Notifications.ts:257: "Tip: roads and power lines carry electricity from your plant to your zones.") does
  not equal step 3's `B3Roads`.
- Still wrong:
  - AdvisorsPanel.ts:70: "Place a power plant and connect it with power lines.";
  - src/sim/economy/advisors.ts:1922: "run power lines to your zones";
  - src/sim/catalog.ts:574: the Power category description.
- Dev's Onboarding.ts (307 lines) has no briefing card, no veteran branch and no 30 s rule. T037a rewrites Onboarding.ts
  and adds `GuideProfile.veteran`; today it only suppresses the guide for veterans.

**Do**
- **The card.** src/ui/guide/briefing.ts (new) builds the card from `guideCopy.phaseE`:
  - at most 90 words;
  - two buttons, labelled from `guideCopy.actions.GotIt` and `.GuidedStart`;
  - a pure `shouldBrief({ veteran, shownAt, dismissedAt })` holds the rules: veteran, or the guide dismissed within
    30 s of first showing.
- **Show it instead of the founding steps:**
  - when the veteran box was ticked (`GuideProfile.veteran` / the pref);
  - when the guide is dismissed within 30 s.
- **The guided-start button** shows the founding steps for this city.
- **T037a in dev:** wire the card into T037a's Onboarding (profile, dismissal, `show()`).
- **T037a not in dev:**
  - wire it into dev's Onboarding.ts with the smallest hunk (the constructor's show branch and `hide()`);
  - keep everything else in briefing.ts;
  - name the hunk in the report, so T037a's merge keeps it.
- **Wording sweep, one rule: roads carry power.**
  - AdvisorsPanel.ts:70 → "Place a power plant beside a road — roads carry power to your zones".
  - The ticker welcome tip (Notifications.ts:257, one META line) → exactly `guideCopy` `B3Roads()`, by import.
  - advisors.ts:1922 → the same rule. Check that :1968 and :1974 ("roads or power lines") still match the rules.
  - catalog.ts:574 → fix it only if the description reaches a player-visible surface. Check toolCatalog.ts's category
    entries (one CONTENT line).
- **Routed 15's advisor strings** (from NEW-07, because advisors.ts is this chain's file): the riot advisor
  (`riotRisk`, advisors.ts:1544-1547) and the jail advisor (`jailOvercrowded` and the no-prison text, :1551-1560).
  - Check each against the rules: riots use `RIOT_APPROVAL` and `RIOT_CRIME` (src/sim/infra/params.ts:596); the jail
    text follows the overcrowding thresholds.
  - Fix the wrong ones, with a text test per string.

**Files**
- src/ui/Onboarding.ts; src/ui/guide/briefing.ts (new), src/ui/guide/advice.css;
- src/ui/panels/AdvisorsPanel.ts (:70);
- src/ui/Notifications.ts (:257 only);
- src/sim/economy/advisors.ts (the power, riot and jail strings);
- src/sim/catalog.ts (optional, one string);
- tests/game/veteranBriefing.test.ts (new), tests/sim/advisors.test.ts.

**Depends on.** FH-11 and FEEL-01 (in dev). T037a (desktop): build on it if it is in dev.

**Acceptance**
- Ticking the veteran box shows the briefing, not the steps.
- Dismissing the guide within 30 s shows the briefing.
- The briefing is at most 90 words, and its two buttons work.
- The ticker tip equals step 3's `B3Roads`.
- A text test scans every .ts file under src/ui. It fails if any string tells the player to connect a plant "with power
  lines". It must catch AdvisorsPanel.ts:70 when that line is reverted.
- Each routed 15 advisor string has a text test.

**Gates**
- tsc; veteranBriefing.test.ts fails when the change is reverted; the full vitest.
- The bot (advisors.ts and catalog.ts are src/sim): residents 198,115, with hashes compared by FH-03's rule (posted
  advice text changes).

**Report.** docs/dev/reports/cloud-T064-FH-18.md. Desktop QA:
- a New City with the veteran box ticked shows the briefing;
- a fresh guided city, with the guide dismissed within 30 s, shows the briefing;
- the guided-start button brings back the steps;
- the ticker's welcome tip;
- the Utilities advisor card in a city with no power.

## t064-fh13 · FH-13: money coach, first-deficit explainer E4 and recovery plan E5 (guide2a, lane 4)

**Implement** "#### FH-13 · Money coach: the first deficit explained, a recovery plan when broke" and §4.6 E4/E5 in
full.

**In dev already.** Copy only.
- `guideCopy` has E4, E4Loan, E5, E5Taxes, E5Service, E5Loan and `actions.Taxes` / `Loans` / `GotIt` (copy.ts:220-230,
  :297-313).
- FH-05's `budgetEffect` is in Tool.ts (T037e moves it to budgetDelta.ts).
- `loanOffer` is replica-safe through `ctx.mods` (src/game/modules.ts:125).
- The finance rules are unchanged (src/sim/economy/advisors.ts):
  - `deficit` fires only when funds < 8 × the deficit (:1872);
  - `lowFunds` fires only below §5,000 (:1876).
- The once-per-profile queue (`ExplainerQueue`, `offerExplainer`, `GuideProfile.seenExplainers`) is in T037a, not in
  dev.
- BudgetPanel has a private `tab` (:101) and no public opener. T037a's coach.ts `openTaxes` already calls
  `panel.showTab?.('taxes')`.

**Do**
- **E4, the first deficit.**
  - Once per profile, on the first month with net below 0 and more than 200 residents, offer explainer E4 with the
    Taxes, Loans and Got it buttons.
  - Its numbers come from FH-05's helper, the +1 point tax income, and `ctx.mods.loanOffer`.
  - Build it as a pure function in src/ui/guide/moneyCoach.ts (new).
  - **T037a in dev:** offer it through T037a's ExplainerQueue from Onboarding's month handler, beside its BSpend, E12,
    E7 and E8 offers.
  - **T037a not in dev:** ship the rest of the lane, keep the E4 builder and its tests, and list the few-line
    `offerExplainer` wiring as a follow-up in the report and the .done line (the item is then partial).
- **E5, broke.** With funds below zero, the finance card becomes a three-step recovery plan with one-click actions.
  Each step shows its monthly effect:
  1. +1 point on every tax;
  2. the most over-funded service down to 90%;
  3. the largest loan the budget can carry.

  **T037e in dev:** build on T037e's finance card. **Not in dev:** build on dev's card and keep the hunk local.
- **BudgetPanel.** Add a public `showTab(tab: 'taxes' | 'services' | 'ledger' | 'loans')`, the seam T037a's
  `openTaxes` expects. The Taxes and Loans buttons use it.
- **advisors.ts, the GUIDE finance hunk.**
  - Bring the deficit advice forward so a sustained deficit gets advice within 3 months (§4.8: no deficit longer than
    3 months without E4).
  - Rescale `lowFunds` to match.
  - Choose the thresholds, and state them and the reason in the report.

**Files**
- src/ui/panels/AdvisorsPanel.ts, src/ui/panels/BudgetPanel.ts;
- src/ui/guide/moneyCoach.ts (new), src/ui/guide/advice.css;
- src/ui/Onboarding.ts (the E4 offer, only with T037a in dev);
- src/sim/economy/advisors.ts (the finance thresholds);
- tests/sim/advisors.test.ts, tests/game/moneyCoach.test.ts (new).

**Depends on.**
- In dev: FH-05, PB-UPKEEP, t064-fh14 and t064-fh16 (same panels, earlier in the chain).
- Desktop: T037a (for E4 once per profile) and T037e (the finance card and helpers).

**Acceptance**
- In a fixture with net −§183 and §59k, E4 appears once per profile, with numbers within ±10% of the
  `computeMonthlyBudget` deltas.
- With funds below 0, the finance card is the three-step plan, and each button moves the projected net in the stated
  direction (a test per button).
- Budget opens on the Taxes or the Loans tab from the buttons.
- A sustained deficit gets advice within 3 months (advisors test).

**Gates**
- tsc; moneyCoach.test.ts and the advisors tests fail when the change is reverted; the full vitest.
- The bot (advisors.ts): residents 198,115, with hashes compared by FH-03's rule (which advice is posted changes by
  design).

**Report.** docs/dev/reports/cloud-T064-FH-13.md. Desktop QA:
- a city that starts a small deficit shows E4 once, and not again after a reload;
- a broke city shows the plan, and each button acts;
- Budget opens on the right tab.

## t064-fh08live · FH-08-LIVE: the TopBar LIVE-pill title that T036s5 deferred (guide2b, lane 1)

**Implement** the TopBar hunk of "#### FH-08 · The first emergency teaches dispatch instead of just failing" (its Files
line: "src/ui/TopBar.ts (META hunk: LIVE pill title)"). Write it against the split component.
docs/dev/reports/local-R1-meta-FH-08.md gives the text (:303-304, :406-408, request 5 at :554-557), and
docs/dev/queue/T036s5-fh08.md deferred it to the TopBar split.

**In dev already.** FH-08 (T036s5) is merged.
- The pill is built in src/ui/topbar/cityDate.ts:25 (META's segment). Its title still reads "An emergency needs you: the
  game runs at live speed until the help you send arrives (Settings → Gameplay)".
- The title is pinned in tests/game/fixtures/topBarTrace.json (:161, :3068).
- The pill's visibility CSS (emergency.css:93-99) and tests/game/emergencyLive.test.ts:277-278 do not depend on the
  text.

**Do**
- Set the title to "Within station range never slows. Outside it, LIVE slows your dispatch; your speed returns when help
  arrives. Settings → Gameplay."
- Check it against T029's rules in dev (in range never slows; the 30 s cooldown) and against `guideCopy.phaseE.Emergencies`.
- If the text must change to stay true, keep the meaning and note the change.
- Badge visibility and the speed controls stay unchanged.

**Files**
- src/ui/topbar/cityDate.ts;
- tests/game/fixtures/topBarTrace.json (re-record);
- tests/game/topBarSegments.test.ts (pin the title).

**Depends on.** The TopBar split and FH-08, both in dev.

**Acceptance**
- The title explains the rule and the restore.
- The `.emg-live` visibility and the speed controls are unchanged.
- The re-recorded trace differs from dev only in that title attribute, at both places.

**Gates.** tsc; the title test fails when the change is reverted; the full vitest; trace diff = the title only. No bot
(src/ui only).

**Report.** docs/dev/reports/cloud-T064-FH-08-LIVE.md. Desktop QA:
- the LIVE pill's hover title during an uncovered emergency;
- the pill shows and hides exactly as before.

## t064-feel03 · FEEL-03: money you can feel (guide2b, lane 2)

**Implement** "#### FEEL-03 · Money you can feel: cost floats, animated funds, monthly and approval deltas" in full.

**In dev already.** Nothing of FEEL-03.
- There is no src/ui/FloatText.ts.
- Tool.ts `commitAction` (:83-140) calls `feedback.ok` (predicted or acknowledged) with no shared cost float.
- fundsSegment.ts swaps the text on each HUD tick. In sandbox it shows "∞" but still prints the red "−§X/mo" net.
- approvalSegment.ts has no change chip.
- `resolveMotion` exists in src/region/settings.ts and src/game/settings.ts. T078 (FEEL-21, desktop) adds more motion
  settings.
- `approvalBreakdown` is not in REPLICA_SAFE: its terms and values match on the replica, its detail lines do not.
- T037e removes another region of Tool.ts (`budgetEffect`, :145-215).

**Do**
- **(a) Cost floats.** A float at the cursor on every successful commit with a non-zero cost: "−§25,018" in red, or
  "+§1,200 refund" in green.
  - It rises 28 px and fades over 900 ms, at most 6 pooled, animating transform and opacity only.
  - A plop with upkeep adds "+§N/mo".
  - Hook it into `commitAction`'s ok path, exactly once per commit (the exact prediction or the acknowledgement, never
    on failure).
  - Derive the plop's upkeep inside Tool.ts from the command (`op` 'plop', its def id) with `getDef()` and the same
    upkeep helper PlopTool uses (read only). PlopTool.ts is chain guide2c's: do not edit it.
- **(b) Funds count-up.** The funds figure counts to its new value over 350 ms, with a 400 ms red or green flash.
- **(c) Monthly chip.** At the month tick, a chip under funds shows the change for 2.5 s.
  - Its value equals Budget's "Monthly net (recurring)". Compute it with the same sim function BudgetPanel uses, and
    test the equality. BudgetPanel.ts is chain guide2a's: do not edit it.
  - At ultra it shows only when the sign flips or the change is 20% or more.
- **(d) Approval chip.** When monthly approval moves by a point or more, a chip under Approval shows for 3 s, for
  example "−2 · Taxes": the term that changed most, using terms and values only.
- **Sandbox:** no floats or chips; the funds segment shows "∞" and no net.
- **Reduced motion (`resolveMotion`):** no animation; values update at once.
- **Performance:** no forced layout per frame.

**Files**
- src/ui/FloatText.ts, src/ui/floatText.css (new);
- src/game/tools/Tool.ts (the commit feedback hunk only);
- src/ui/topbar/fundsSegment.ts, src/ui/topbar/approvalSegment.ts (their selector families in hud.css if needed);
- tests/game/fixtures/topBarTrace.json (re-record);
- tests/game/floatText.test.ts (new).

**Depends on.**
- In dev: W0.2 (`Tool.commit`), PB-UPKEEP and the TopBar split.
- t064-fh08live (the trace re-record before this one).
- T037e and T078 (desktop): merge dev in if they have landed.

**Acceptance**
- Placing a coal plant shows exactly `ActionResult.cost` within 100 ms, plus "+§N/mo" equal to its upkeep.
- A failed placement shows no float.
- The funds label passes through at least 3 intermediate values.
- The month chip equals Budget's "Monthly net (recurring)".
- The approval chip names the term that changed most.
- No forced layout is added per frame.
- Reduced motion is honoured.
- In sandbox the funds segment shows "∞" and no red net.

**Gates**
- tsc; floatText.test.ts fails when the change is reverted; the full vitest, including hygiene.
- The bot (Tool.ts is src/game): identical, 198,115.
- The trace diff holds only the chip nodes and the count-up writes, explained in the report.

**Report.** docs/dev/reports/cloud-T064-FEEL-03.md. Desktop QA:
- place a coal plant, bulldoze it within the day (the refund float), and a failed placement;
- funds count-up and flash;
- the month chip at 1×, 2× and ultra;
- the approval chip after a tax change;
- with OS reduced motion on;
- sandbox;
- a Performance trace while floats run (no layout per frame).

## t064-fh23 · FH-23: text that can get bigger, and tips keyboard focus can open (guide2b, lane 3)

**Implement** "#### FH-23 · Text that can actually get bigger, and tips keyboard focus can open" in full, with §7.5's
schema. This lane writes both META's part and GUIDE's focus handlers.

**In dev already.** The schema and the title-screen shell are done (T036, §7.5):
- `textSize` and `uiScale` are in AppSettings (src/region/settings.ts:42-74) and GameSettings
  (src/game/settings.ts:49-50);
- the title's "Accessibility & interface" section is in src/region/ui/dialogs.ts:105-140, with UI scale and Reset
  (tests/game/titleSettings.test.ts);
- the text-size control is already written but hidden behind `A11Y_WIRED.textSize = false` (region/settings.ts:31;
  dialogs.ts:128).

Missing:
- `computeUiZoom` (src/ui/zoom.ts:13-19) still caps at w/1280, with no text-size multiplier and no rendered-px floor.
- The scale applies only in `CityScene.resize` (:920), not on the title, region or New City screens.
- hud.css has 66 font sizes from 9 to 11.9 px and no floor.
- The in-city SettingsPanel has no text-size row.
- The top-bar segments are click-only divs. Toolbar tips open only on `pointerenter` (Toolbar.ts:74-75, :301-302). The
  approval card opens on hover only.

**Do**
- **META.**
  - Text size +10%, +20% or +30% is a font-size multiplier on top of the zoom cap. Use one root variable read by
    hud.css and meta.css.
  - Its floor is in rendered pixels: at +30% no text renders under 12 px, so the css floor is 12 px ÷ zoom.
  - Apply the scale and text size on the HUD and on the title, region and New City screens, before any city (one helper
    in zoom.ts, called from TitleScreen.ts, RegionScreen.ts, NewCityDialog.ts and, if needed, main.ts).
  - Set `A11Y_WIRED.textSize = true`.
  - Add a text-size row to the in-city SettingsPanel.
  - CityScene.ts: only the `resize` and `applySettings` hunks.
- **GUIDE.**
  - The top-bar segments (funds, RCI, approval, and META's city date and panel buttons) become focusable buttons:
    focus opens what hover or click opens, blur closes it, and Enter or Space works like a click.
  - Toolbar: focus and blur call `showCatTip` / `showSpecTip` / `hideTip`.
  - The approval card's row details open on focus.
  - Add `:focus-visible` styles in hud.css's selector families for these components.
- **Optional (FH-16's popover part).** If src/ui/glossary.ts is in dev at this lane's start:
  - make rciSegment.ts's `DEV_NAMES` come from glossary.ts (keep the export for InfoPanel and TopBar);
  - add the glossary's "what it wants" line to the RCI popover rows.

  If glossary.ts is not in dev, list this as a follow-up.
- **T078 in dev:** build on its hud.css, SettingsPanel and A11Y_WIRED changes. **Not in dev:** keep the hunks small;
  T078's merge resolves them.

**Files**
- src/ui/zoom.ts; src/game/CityScene.ts; src/ui/hud.css;
- src/region/ui/meta.css, src/region/ui/TitleScreen.ts, src/region/RegionScreen.ts, src/region/NewCityDialog.ts,
  src/region/settings.ts, src/region/ui/dialogs.ts, src/main.ts (only if needed);
- src/ui/panels/SettingsPanel.ts;
- src/ui/topbar/* (the segments, approvalGuide.ts, rciGuide.ts as needed);
- src/ui/Toolbar.ts;
- tests/game/fixtures/topBarTrace.json (re-record);
- tests/game/titleSettings.test.ts; new tests/game/focusTips.test.ts and tests/game/textSize.test.ts.

**Depends on.**
- In dev: PB-DIALOG, PB-DATAVIEWS and the TopBar split.
- t064-feel03 (the segments, earlier in the chain).
- T078 / FEEL-21 (desktop), on the same lines.

**Acceptance**
- At 1280x720 with +30%, no text renders under 12 px. A test checks the floor arithmetic, and that every hud.css and
  meta.css font size goes through the floor; the Desktop QA measures it.
- The top bar still fits on one line (Desktop QA).
- The New City dialog grows with the setting (test).
- On a fresh profile, text size and UI scale can be set from the title screen, and the first city opens with them
  (test).
  - Motion and colour vision show there once T078 and FH-20 wire them (`A11Y_WIRED.motion` / `colourVision`); state
    which ones are live.
- Tabbing through the top bar and the toolbar shows every tip that hover shows (focusTips test: for each segment and
  toolbar button, focus gives the same tip or popover as `pointerenter`, and blur hides it).

**Gates**
- tsc; focusTips and textSize tests fail when the change is reverted; the full vitest.
- The bot (CityScene is src/game): identical, 198,115.
- The trace diff holds the button, tabindex and role attributes only (plus the glossary lines if the optional step
  ran).

**Report.** docs/dev/reports/cloud-T064-FH-23.md. Desktop QA at 1280x720 with +30%:
- the title, region, New City, HUD, Budget, Advisors and Help screens, with the smallest rendered font size per screen
  (DevTools computed);
- the top bar on one line;
- Tab order through the top bar and the toolbar, with every tip opening;
- a fresh profile set from the title screen opens its first city with the settings;
- repeat at 1920x1080 with +0%: unchanged from before.

## t064-fh17 · FH-17: a Mayor's handbook behind F1, and a "?" on every panel (guide2b, lane 4)

**Implement** "#### FH-17 · A Mayor's handbook behind F1, and a "?" on every panel" in full.

**In dev already.** Nothing of FH-17.
- `HelpPanel` (src/ui/Modals.ts:225-262) is still the `SHORTCUTS` columns, three tips and a "Show getting-started
  guide" button (`ctx.showOnboarding`).
- `SHORTCUTS` (:163-223) lacks Shift+Right-drag, the arrow keys, Home and + / −, although CameraController.ts:4-7
  implements all of them (FH-19 is in dev).
- Panel.ts builds the header (:66-73) with no help button.
- There is no topic registry and no "Tips you've seen" list.
- In flight on the desktop:
  - T075 rewrites HelpPanel's rows to live key bindings (`shortcutKeys` from src/game/bindings.ts, an `update()`
    override) and adds Recenter Home and Photo mode H rows: a direct Modals.ts conflict;
  - T037a adds `seenExplainers` and the guide phase.

**Do**
- **Topic tabs**, each with 5–8 short lines:
  - Getting started, Zoning & demand, Power, water & garbage, Services & coverage, Money (taxes, funding, loans),
    Approval, Emergencies & dispatch, Data views & Why?, Region & neighbours, and Shortcuts.
  - Every cost or number in them is read from `getDef()` and tuning.
  - Each has a "Show me" button. For example, Emergencies opens the Emergency data view through `ctx.setOverlay`.
- **Getting started** reopens the guide at its phase through `ctx.showOnboarding`. Do not edit Onboarding.ts (chain
  guide2a's).
- **Shortcuts.**
  - **T075 in dev:** use its live bindings.
  - **Not in dev:** today's `SHORTCUTS` rows plus Shift+Right-drag, the arrow keys, Home and + / −, structured so T075's
    `update()` can take the rows over.
- **"Tips you've seen"** lists the E1–E12 explainers the profile has seen, with their text from `guideCopy.phaseD`.
  - **T037a in dev:** read them through `loadGuideProfile()`.
  - **Not in dev:** a tolerant read of the same pref record (`loadPref('onboarding').seenExplainers`).
- **A "?" on every panel header** (Panel.ts, beside the close button). It opens Help at the panel's topic, from a
  registry keyed by panel id in Modals.ts. No other panel file changes.
- **The Money topic** links Budget's Loans tab if t064-fh13's `showTab` is in dev. It may reuse glossary.ts's names if
  t064-fh16 is in dev.

**Files**
- src/ui/Modals.ts (`HelpPanel`, `SHORTCUTS` and the registry; not `SavePill` or `PauseMenu`);
- src/ui/Panel.ts (the header button);
- src/ui/guide/helpTopics.ts, src/ui/guide/help.css (new);
- tests/game/helpTopics.test.ts (new).

**Depends on.**
- In dev: FH-02 (copy), FH-08 and FH-19.
- Soft: t064-fh13 and t064-fh16 (other chain).
- Desktop: T037a and T075 (merge dev in if they have landed; otherwise T075's merge resolves Modals.ts).

**Acceptance**
- F1 → Emergencies → Show me opens the Emergency data view (test).
- Every registered panel has a working "?" (test: each registry id is a real panel id; its button opens Help at that
  topic).
- A text test keeps each topic at most 120 words, and checks that every § amount and number in the topics equals a value
  from `getDef()` or tuning.
- The Shortcuts topic lists Shift+Right-drag, the arrow keys, Home and + / −, besides today's rows.

**Gates.** tsc; helpTopics.test.ts fails when the change is reverted; the full vitest. No bot (src/ui only).

**Report.** docs/dev/reports/cloud-T064-FH-17.md. Desktop QA:
- F1 at 1280x720: every tab and every Show me;
- the "?" on every panel that has one;
- Tips you've seen after an explainer has shown;
- with FH-23's +30%, nothing overflows.

## t064-feel19 · FEEL-19: hover says what is wrong with a building (guide2c, lane 1)

**Implement** "#### FEEL-19 · Hover says what is wrong with a building" in full.

**In dev already.** Nothing of FEEL-19.
- `QueryTool.move` (src/game/tools/QueryTool.ts:37-105) shows only the name plus residents or jobs, and "In ruins" for
  a burnt building.
- Empty zoned lots already get a zoneStatus line (:93-101).
- The chip wording is in InfoPanel.ts, not in inspectorModel.ts:
  - `FLAG_CHIPS` (:45-59): Abandoned, On fire!, No road access, Understaffed, Polluted, Noisy, High crime, Garbage piling
    up…;
  - Powered / No power, No water and "Under construction N%" (:340-350).
- The plan's sample words ("No garbage pickup", "Too noisy") differ from today's chips. The acceptance requires equality
  with the chip, so use the chip words and note it.
- T037a's InfoPanel hunks (:106-150, :452) and T045's inspectorModel hunk (:356) do not overlap.

**Do**
- Move `FLAG_CHIPS` and the power, water and construction chips into inspectorModel.ts as one shared table. Add
  `hoverStatus(flags, built, condition)`, which returns the text and tone.
- InfoPanel reads the shared table. The inspector looks exactly as before; a test compares the chips before and after.
- `QueryTool.move()` (GUIDE's hunk; `down` and `up` are WORLD's) adds one status line in priority order: On fire,
  Abandoned, No road, No power, No water, Understaffed, garbage, noise, polluted, needs, crime.
  - "Thriving" when there is no problem and condition is at least 90%.
  - "Under construction · N%" while building.
  - The tone comes from the chip classes.
- Cache the line per building per sim day.
- Any new style goes in src/ui/guide/inspect.css.

**Files**
- src/game/tools/QueryTool.ts (`move()` only);
- src/ui/inspectorModel.ts, src/ui/panels/InfoPanel.ts, src/ui/zoneStatus.ts (only if the tone helper moves);
- tests/game/hoverStatus.test.ts (new), tests/game/inspectorModel.test.ts.

**Depends on.** W0.3 (in dev): `flags` are exact replica fields.

**Acceptance**
- An unpowered shack shows "No power" in the warn tone; an abandoned building shows "Abandoned".
- The priority order, "Thriving" and "Under construction · N%" hold (tests).
- The hover text equals the inspector chip (both come from the table; a test asserts it).
- The line is cached per building per sim day (test).
- The tip costs at most 0.2 ms (vitest micro-benchmark, median of 1,000 hovers; the Desktop QA confirms it).

**Gates.** tsc; hoverStatus.test.ts fails when the change is reverted; the full vitest, including hygiene and the
replica tests; the bot (QueryTool is src/game): identical, 198,115.

**Report.** docs/dev/reports/cloud-T064-FEEL-19.md. Desktop QA, on the default host and `?simworker=1`:
- hover an unpowered shack, an abandoned building, a building under construction and a thriving tower;
- the inspector chips are unchanged;
- the tip cost in a Performance trace.

## t064-new07 · NEW-07: wording sweep for routed facility and graph texts (guide2c, lane 2)

**Implement** "#### NEW-07 · Wording sweep for routed facility and graph texts" in full, except routed 15's advisor
strings, which t064-fh18 owns (advisors.ts is chain guide2a's file).

**In dev already.** Mostly done.
- **Done:**
  - routed 52 (`graphAxis.pctAxisLabels`, GraphsPanel.ts:47, tests/game/panelsMisc.test.ts:97);
  - routed 10 and 11 (facilities.ts:447-471 and :1003, tests/infra/feedbackFacilities.test.ts);
  - routed 55 and 57 (transportFacilities.ts:271-288, tests/infra/transitFacilities.test.ts:1285);
  - routed 15's Wind Turbine Water chip (InfoPanel.ts:346).
- **Partly done:**
  - Stats' "JAIL" now reads "Prison & cells" (StatsPanel.ts:76).
  - Routed 49 is handled in the UI (inspectorModel's `signedPts` / `shownPts` drop 0-point bars). The sim detail
    strings in growth.ts and population.ts `conditionBreakdown` (:849) still need a check.
  - Routed 6: `justiceCityLines` (facilities.ts:1212-1231) already names "raise the police budget" at 0% funding, but
    not the unpowered-prison case.
- **Open:**
  - routed 7: `jailLines` (:1414-1432) shows "N / 0 (0% full)" with status ok when unfunded;
  - routed 8: the yearly projection is 12 × last month's sentenced (:1221);
  - routed 15's highway warning. Locate it: the plan says PlopTool, but the only highway rule texts in dev are
    src/sim/actions.ts:358 and :372.

**Do.** One fix per routed line, each with a text or unit test. Numbers use the UI's `signedPts()` convention ("0" under
half a point, U+2212 minus).
- **6:** the justice line names the cause first: unfunded police → raise the budget; an unpowered prison → restore its
  power; then building more prisons.
- **7:** an unfunded or striking prison reads "closed — no police budget", with status bad, the same day.
- **8:** the projection is a 3-month average from existing history or stats. Add no saved field: a new `systemData` key
  would change hashes and the save shape. If no such source exists, write the options in the report and leave 8 for the
  lead.
- **15:** check the highway warning text against the rules and fix it if wrong. actions.ts and NetworkTool.ts are this
  chain's files.
- **49:** no "+0" or "−0" in growth.ts or population.ts detail lines.
- **52:** no change; the existing test must stay green.
- **10, 11, 55, 57:** re-verify only.
- InfoPanel.ts is this chain's file, but facility facts carry their own status, so no InfoPanel edit is expected.
- Do not edit advisors.ts or GraphsPanel.ts (chain guide2a).

**Files**
- src/sim/infra/facilities.ts, src/sim/economy/population.ts, src/sim/economy/growth.ts;
- src/sim/actions.ts or src/game/tools/NetworkTool.ts (routed 15's text only, wherever it is);
- tests/infra/feedbackFacilities.test.ts;
- new tests/infra/routedTexts.test.ts.

**Depends on.** PB-STAFF and PB-NOROAD (in dev). Desktop T042, T055 and T071 (facilities.ts) and T041, T045, T046 and
T072 (growth.ts) are in flight: keep the hunks to the strings.

**Acceptance.** One line per routed item:
- 6: with police funding at 0%, the justice line names the funding first. With an unpowered prison, it names the power.
- 7: an unfunded prison reads "closed — no police budget" with status bad, refreshed the same day.
- 8: the projection is a 3-month average and moves less than 25% month to month on a steady city (or the lead's
  options).
- 15: each listed text matches the current rules, with a text test per string (the advisor strings are in t064-fh18).
- 49: no Why? row prints "+0" or "−0".
- 52: no graph axis repeats a label (already passing).

**Gates**
- tsc; routedTexts.test.ts fails when the change is reverted; the full vitest.
- The bot (src/sim): residents 198,115 and hashes identical. Facility facts and Why? details are not hashed state; if a
  changed text turns out to be posted as news, use FH-03's rule and say so.

**Report.** docs/dev/reports/cloud-T064-NEW-07.md. Desktop QA, in the inspector:
- a prison at 0% police funding, an unpowered prison, and a police station with overflow;
- Why? rows on growables;
- a Graphs percentage axis.

## t064-fh15 · FH-15: placement previews that show consequences before the click (guide2c, lane 3)

**Implement** "#### FH-15 · Placement previews that show consequences before the click" in full.

**In dev already.** Only the existing previews.
- `PlopTool.placementPreview` (src/game/tools/PlopTool.ts:109-145) covers garage stops (the `stopsNear` query) and ferry
  partners.
- Also in dev: the upkeep-here line, FH-05's monthly budget line (:250) and the no-road staffed warning.
- PlopTool already switches the fitting data view (`autoOverlayOf`, :37-60).
- The replica-safe reads FH-15 can use are in src/worker/replicaSafe.ts: `windVector`, `overlayLayer`,
  `overlayReadout`, `utilityReaches`.
- Missing: src/ui/guide/previews.ts and every category preview.
- T037a (the wind-turbine spacing ring) and T075 (key labels) edit PlopTool.ts on the desktop.

**Do.** Category previews in the ghost's tip:
- power plants: "Supplies 400 MW — your town uses 9 MW";
- smoke and noise emitters:
  - "Smoke drifts SW onto about 24 zoned homes", with the wind as the Air legend gives it;
  - "about 31 homes within 12 tiles become less desirable", with the stigma radius from the def;
- pumps: "Ground water here: about 62% clean — industry 6 tiles away";
- fire, police, clinic and school:
  - "Would answer about 312 buildings automatically, incl. your Coal Power Plant";
  - "about 248 children in walking reach".

Rules:
- Pure helpers in src/ui/guide/previews.ts over mirrored layers and replica-safe reads.
- Recompute only when the ghost changes cell, on coarse rasters, reading only layers the placement already subscribes
  to.
- Counts are labelled "about".
- A count that truly needs the sim gets a read-only query (src/worker/queries.ts, protocol.ts, replicaSafe.ts, a SIM
  row this lane writes), never a sim edit.

**Files**
- src/game/tools/PlopTool.ts, src/game/tools/placement.ts;
- src/ui/guide/previews.ts (new), src/ui/guide/inspect.css (if styles are needed);
- src/worker/** (only for a read-only query);
- tests/game/toolsPreview.test.ts, new tests/game/placementPreviews.test.ts.

**Depends on.** PB-UPKEEP, PB-OVERLAY and W0.5's derived-layer subscriptions (in dev). T037a and T075 (desktop
PlopTool hunks): merge dev in if they have landed.

**Acceptance**
- A coal ghost beside an R zone reports at least one home under smoke.
- A pump ghost next to dirty industry reports under 80% clean.
- A fire-station ghost's count is within ±10% of the green cells after placing. The fixture test places the station,
  runs the coverage tick and compares.
- Counts are labelled "about".
- Ghost refresh is at most 1 ms p95 on a 256 map (a vitest benchmark over 200 cell changes; the Desktop QA confirms
  it).

**Gates**
- tsc; placementPreviews.test.ts fails when the change is reverted; the full vitest, including hygiene and replicaSafe.
- The bot (src/game, and src/worker if touched): identical, 198,115.

**Report.** docs/dev/reports/cloud-T064-FH-15.md. Desktop QA, on the default host and `?simworker=1`:
- a coal ghost near homes;
- a pump ghost near industry;
- a fire-station ghost, then place it and compare with the Fire view;
- ghost refresh timing on a 256 map at Ultra.

## t064-new06 · NEW-06: shore placement that finds a spot (guide2c, lane 4)

**Implement** "#### NEW-06 · Shore placement that finds a spot" in full: GUIDE's tint, SIM's diagonal-coast rule and
`hasShoreSite` row, and CONTENT's unlock and row note. The report names each hunk's owner.

**In dev already.** PB-SHORE / P14 auto-facing.
- `shoreFacesWater` and `shoreRotation` are in src/game/tools/placement.ts:23-50, used by PlopTool.ts (:178, :290) and
  tested in tests/game/toolsPlacement.test.ts.
- `guideCopy.G9Next(hasValidShoreSite)` is ready (copy.ts:191-195).

Missing:
- The shore rule is still first-row only (actions.ts:657 `countFront`; buildings.ts:127). There is no band variant, no
  shoreSites.ts scan and no tint.
- The Seaport still unlocks on any water ("Coastline" via `hasWater`, src/sim/economy/rewards.ts:117 and :134-141).
- There is no `hasShoreSite` in src/worker/replicaSafe.ts.
- ListPanels has no "No shore site on this map" note.
- LG-01's HUD next-goal line is not in dev.
- G9's goal logic is in T037a's goals.ts.

**Do**
- **SIM (actions.ts :657, buildings.ts `countFront` :127).**
  - A rotation also passes when the band in front of the lot, as deep as the lot is wide, is at least half water.
  - Today's first-row rule stays as an alternative, so every spot valid today stays valid.
  - placement.ts's `shoreFacesWater` uses the same rule, from one shared function.
  - The replica predicts `plop` (REPLICA_SAFE), so it must run this exact rule.
- **GUIDE.**
  - src/ui/guide/shoreSites.ts (new) scans only cells within a footprint's width of water, once per tool selection.
  - Tint every cell where some rotation passes, with `ctx.world.setHighlight` while a shore building is selected.
  - Hovering a tinted cell picks that rotation.
  - No src/render edit.
- **CONTENT (rewards.ts, ListPanels.ts).**
  - The Seaport's "Coastline" condition becomes `hasShoreSite`, with the reason "needs a shore site". It uses the same
    scan, cached until terrain, water or buildings change.
  - A population landmark that needs the shore keeps its unlock, but its Rewards row says "No shore site on this map".
  - `listMilestones` skips it as the next goal.
  - Do not edit src/ui/topbar/** (chain guide2b's). The skip in `listMilestones` covers LG-01's future HUD line.
- **SIM (src/worker/replicaSafe.ts).** Add the `hasShoreSite` row (§7.6).
- **G9.**
  - **T037a in dev:** G9 uses `copy.G9Next(hasShoreSite)` in goals.ts.
  - **Not in dev:** write the one-line request for T037a's owner in the report.
- **Fairland.** The playtest's sandbox tile (Fairland) is not reproducible from the repo; its shots are lost scratch.
  Use a 45° coast fixture of the same shape as the scripted stand-in, and put Fairland itself in the Desktop QA list.

**Files**
- src/game/tools/PlopTool.ts, src/game/tools/placement.ts;
- src/ui/guide/shoreSites.ts (new);
- src/sim/actions.ts, src/sim/economy/buildings.ts, src/sim/economy/rewards.ts;
- src/ui/panels/ListPanels.ts;
- src/worker/replicaSafe.ts;
- src/ui/guide/goals.ts (only with T037a in dev);
- tests/game/toolsPlacement.test.ts, tests/worker/replicaSafe.test.ts;
- new tests/sim/shoreRule.test.ts and tests/game/shoreSites.test.ts;
- the rewards tests.

**Depends on.**
- PB-SHORE (in dev); t064-fh15 (same PlopTool.ts and placement.ts, earlier in the chain).
- T037a for G9.
- Desktop T070 and T071 (rewards.ts, ListPanels.ts) and T046 and T055 (actions.ts): keep the hunks local.

**Risk: HIGH.**
- The plop rule and `countFront` change for every difficulty.
- The Seaport condition changes `st.unlocked`, which is hashed.
- The bot places desalination plants and seaports through `placeShore` (tools/simbot.ts:2261; desalination :1127,
  seaport :2192, read only). It picks the valid site nearest the centre, so its rows can move.

**Acceptance**
- On the 45° coast fixture (Fairland's stand-in), a scripted run places a Container Seaport and a Desalination plant.
- On a fixture map, every tinted cell accepts a click with its suggested rotation, and no untinted cell does
  (exhaustive test).
- Every spot valid under today's rule stays valid (test over the fixtures).
- The replica's prediction equals the sim's result for shore plops (test).
- On a map with no valid site:
  - the Seaport stays locked with "needs a shore site";
  - Rewards shows "No shore site on this map" on the Lighthouse;
  - `listMilestones` never names it as the next goal.
- The scan costs at most 5 ms per selection on a 256 map (benchmark).

**Gates**
- tsc; shoreRule and shoreSites tests fail when the change is reverted; the full vitest, including replicaSafe.
- The bot (128x15 s7): report the residents.
- G-DET under the lock, one run at a time: two-process hashes on 256x60 s7 and s11, and 128x15 s7.
- If rows or residents move:
  - record them under the `polish` fixture key, marked as waiting for the lead's sign-off (D2);
  - name the new bot reference and the reason in the report and in the merge commit;
  - never retune to get the old numbers back.

**Report.** docs/dev/reports/cloud-T064-NEW-06.md. Desktop QA:
- on Fairland (sandbox) and on a diagonal-coast tile: select the Seaport and the Desalination plant, see the tint, and
  place both;
- on a map with no shore site: the Rewards row note, the Seaport's lock reason, and G9's text;
- the scan time on a 256 map.
