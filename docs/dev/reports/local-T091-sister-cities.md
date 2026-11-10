# local-T091-sister-cities: LG-12, found or fund a neighbour when the map is full

Branch `local/T091-sister-cities`, base `825ee224` (+ the task commit `56c1e6e3`). **Uncommitted**, nothing pushed, no
`.done` file. 13 source files changed (+634 / −24), 5 new test files (51 tests).

**State.** Every Change line of LG-12 is implemented except one button, which needs two cloud-held files: "Found a
sister city" on the built-out advice card (the exact hunks are under *Requests for cloud-held files*; the pause-menu
entry and the hook the card's action calls are in). tsc is clean, my tests and the existing region, dialog, budget,
approval, save and worker-host tests pass, and the 128×15 s7 bot is identical. Nothing was run in a browser.

## How it works

1. **In the city.** The pause menu shows "Found a sister city" while a free tile borders the city. It leaves the city
   exactly as "Save & exit to region" does (pause, `host.save('exit')`, thumbnail, dispose: WORKER_DESIGN §4.4), and the
   App reads what the founding needs from the host's state first: name, mayor, funds, game day, and the roads on the
   four map edges (`sisterParent`, only mirrored fields, so it reads a replica too).
2. **On the region screen.** `planSisterCity` picks the free neighbour whose shared edge holds the most of the parent's
   edge roads (then the longest shared edge, then the least water), selects it, and opens the New City dialog titled
   "Found a Sister City", with the parent's mayor filled in and an endowment slider under the difficulty cards.
3. **The slider** runs from 0 to 25% of the parent's funds, at most §5M, in whole steps. A parent that endowed within
   the last 10 game years gets the reason instead of the slider, with both dates ("Queensbury endowed a sister city in
   Apr 2043. It can endow another from Apr 2053 (once every 10 years)."); it can still found the city. A sandbox parent
   cannot endow, and a sandbox new city takes none.
4. **"Found City" with an endowment asks first**: "Queensbury pays §2,000,000 from its treasury when the city is
   founded. This transfer can't be undone, and Queensbury can't endow another sister city for 10 years." Declining
   returns to the form. Cancelling the New City dialog changes nothing anywhere.
5. **The new city** is generated with a road stub: every road of the parent that reaches the shared edge is continued
   3 cells into the new tile, at the same place on the edge, with its road type (and a one-way's direction).
6. **Recognition.** The parent gets +1 approval, "Founded a sister city", in its next 12 monthly updates. The region card
   lists the links ("Queensbury → Fairland, Eastport"), and a city's tile card names its own.

## How the money is safe (the task's "say how")

**The transfer is one ledger entry in the region record, and each city books its side from it.**

- `RegionData.endowments` holds one entry per founding: `{ id, from, to, amount, day, fromFounded, toFounded }`.
- **The save chain at "Found"** (main.ts `startNewCity`) is: store the new city's record, then store the region with the
  new tile's summary **and** the ledger entry in the same `saveRegion` put (`commitSisterCity`). That put is one
  IndexedDB write, so the new city (as the region knows it) and the transfer exist together or not at all.
- **Nothing is paid at that moment.** The new city's first save holds its start funds only, and the parent's stored
  record is not touched.
- **Each city books its side when it is next opened.** `regionContext` puts the city's entries into the region context
  (`RegionContext.endowments`), which every host already hands to the simulation at boot (`init.rctx` for the worker).
  `budget.ts` `bookEndowments` then moves the money once: the parent −amount on `'oneoff:endowment'`
  ("Sister city endowment"), the new city +amount. The entry's id is kept in the city's save
  (`systemData.sisterBooks.booked`), next to the money it moved.
- **Killed tab, every case:**
  - before the new city's record is stored, before the region write, or during a region write that does not land: the
    region has no new tile and no entry, so there is **no transfer**. A record left behind is on no tile and holds its
    start funds only; a later founding on that tile overwrites it.
  - after the region write: **exactly one transfer**. Either city, opened from a save older than its booking, books the
    entry again from the ledger; opened from a later save, it does not. So the money moves once through each city
    however often the tab dies. Tests run this through `LocalSimHost` and a `MemoryKV` store.
  - never two: a second booking needs a save that lacks the id but holds the money, and both are written by the same
    serialization of one state.
- **Who may book.** The parent's side is offered only to the city that founded it (the tile summary's `founded` stamp):
  a city founded later on the parent's tile owes nothing. The new city's side is booked only by a save that names the
  entry (`systemData.sisterOf.id`): a plain city founded later on that tile gets nothing.
- **A failed region write** (quota) takes the entry out of the in-memory region again, so a later founding on that tile
  cannot inherit it. The storage dialog's Retry repeats the founding with the same plan and id.
- **The region lock** (NEW-04) is unchanged: the only writes are the existing `saveCity` and `persistRegion`, under the
  same access checks. `src/save/**` and `src/worker/**` are not touched.

**What the player sees.**
- The parent's tile card shows its funds lower at once (the summary is adjusted in the same region write). The parent's
  own treasury and its Budget line change the next time it is opened: it is the same game day, since a closed city does
  not advance.
- **The save chip.** On the local host the chip reads "Unsaved changes" right after either city opens with a booking.
  That is true: the booking is in memory until the next save (autosave, Ctrl+S, tab hide or exit). On a packet host the
  clean mark is taken after the boot, so the chip reads "Saved"; a tab killed before the next save books again from the
  ledger.

## Changes per file

Files the task names:

- **`src/region/types.ts`**: `RegionCitySummary.sisterOf?` (tile key of the parent), `RegionData.endowments?` and the
  `SisterEndowment` entry. Both optional: an old region loads unchanged.
- **`src/region/regionEffects.ts`** (+355 / −4):
  - `RegionContext.endowments?` (`EndowmentDue`: id, `out` or `in`, amount, day, the other city's name). `regionContext`
    adds the key only when the city has an entry, so every other city keeps its context and its save as they were.
  - A new last section, "LG-12: sister cities": the constants (`ENDOWMENT_SHARE` 0.25, `ENDOWMENT_MAX` 5M,
    `ENDOWMENT_YEARS` 10, `ENDOWMENT_MIN` 1,000, `SISTER_STUB_CELLS` = `CONN_MIN_DEPTH`), `sisterParent`,
    `endowmentLimit`, `lastEndowmentDay`, `endowmentBlock`, `sisterTile`, `sisterStub`, `planSisterCity`,
    `prepareSisterCity` (the stub and `systemData.sisterOf`), `commitSisterCity` (the ledger entry around the region
    write, with its undo), and the display helpers `sisterLinks`, `sisterLines`, `sisterNote`.
  - It imports nothing from `src/save`, so the worker's import-graph gates hold (hygiene test).
- **`src/region/NewCityDialog.ts`**: the option `sister?: SisterPlan`; its own section `endowmentField` (slider, note,
  the blocked reason, the confirmation). In `openNewCityDialog` it is four small hooks: the mayor default, the field
  under the difficulty cards, a refresh when the difficulty changes, and **one guard line** in the Found handler. The
  handler's other lines are unchanged, to keep T092's (LG-14) merge small.
- **`src/region/RegionScreen.ts`**: the sister rows on the region card (`sisterRows`), and the links in a city's tile card.
- **`src/sim/economy/budget.ts`**: `ENDOWMENT_KEY`, `SisterBooks`, `sisterBooks`, `bookEndowments`, one call in the
  system's `init`, and the key in the header's list. A city with no entry returns at the first check and writes nothing.
- **`src/main.ts`** (+31 / −7 in 6 places, the App):
  1. the import line of `regionEffects`;
  2. `onFoundSister?` in the local `CitySceneOptions`, and its line in the scene's options;
  3. `exitCity(thumb, sister = false)`: reads `sisterParent` at the start, passes `sister` to its Retry, calls
     `foundSister` after `showRegion`;
  4. the new method `foundSister` (plan, select the tile, dialog, `startNewCity`);
  5. `startNewCity(…, sister?)`: `prepareSisterCity` after the trees, `commitSisterCity` around `persistRegion`, and
     `sister` in its Retry.

**Hunks outside the named files** (each minimal and self-contained):

| file | hunk | why |
|---|---|---|
| `src/sim/economy/approval.ts` | `SISTER_APPROVAL`, `SISTER_APPROVAL_DAYS`, `BONUS_LABELS`; 2 lines in `update()`; the label lookup in `approvalBreakdown` | the Recognition line. The plan's Files list names this file; the task's `owns` does not |
| `src/region/citySummary.ts` | `sisterOf` from `systemData.sisterOf` (3 lines) | every save replaces the tile summary, so the link must come from the city's own save |
| `src/region/regionLock.ts` | `foundDialog(model, tile, sister?)` | passes the plan to the dialog under the existing write checks |
| `src/game/CityScene.ts` | `onFoundSister?` option; `sisterOffered()`; the `foundSister` hook in the context; and **one edited method**: `exitToRegion(leave = onExitToRegion)`, 2 lines (its signature and its last call) | the same exit, another destination. Called with no argument it behaves as before (`citySaves.test.ts` passes unchanged). A second method would have copied the exit's ten lines |
| `src/game/context.ts` | `GameContext.foundSister?()` | what the pause menu, and later the advice action, call |
| `src/ui/Modals.ts` | the pause menu's item (`PauseMenu` is META's, §7.3) | the Change line |
| `src/ui/panels/BudgetPanel.ts` | one entry in `ONEOFF_LABELS` | the line's name; without it the ledger reads "Endowment" |

**`src/sim/infra/*`: no hunk. `src/save/**`, `src/worker/**`, `advisors.ts`, `adviceActions.ts`, `AdvisorsPanel.ts`,
`TopBar.ts`: not touched.**

**New optional save keys:** `systemData.sisterOf` (a sister city: id, parent tile, parent name, where the stub starts),
`systemData.sisterBooks` (a city that has booked an entry), and `endowments` inside the existing `systemData.region`.
None is mirrored to a replica and nothing on the page reads them: the page sees the booked funds and the budget line,
which are mirrored, and the tile summary, which comes with the save's reply.

## Tests

5 new files, **51 tests, all pass** (`npx vitest run <file> --maxWorkers=1` through quietrun).

**`tests/save/sisterCities.test.ts` (32)**

- *the endowment rules*
  - a city may give a quarter of its funds, at most §5M
  - the plan offers the limit in whole slider steps, and nothing when the treasury is too small
  - a sandbox city cannot endow
  - a second endowment within 10 game years is refused with the date it becomes possible
  - founding without an endowment does not start the 10 years, and another city on the tile starts fresh
- *the best free tile and the road stub*
  - reads the parent's edge roads from its state without touching it
  - picks the free tile whose shared edge holds the most of the parent's edge roads
  - without edge roads the longest shared edge wins, then the least water; no free tile, no sister city
  - continues each road that reaches the shared edge into the new tile, at the same place on the edge
  - a wide road keeps its width, a road along the border is continued once, at a junction where it has one
  - lays the stub in the new city: its road type and direction, no trees; water or a steep cell ends it
  - veteran finding 6: the stub alone is no neighbour connection and relieves no demand cap, until the city's roads join it
- *the region's ledger*
  - a region without sister cities gives every city the context it always had
  - the region write stores the entry with the new tile, and shows both treasuries as they will stand
  - never more than the plan allows, whatever amount reaches it
  - a region write that fails takes the entry and the shown money back; the retry stores it once
  - the sister links: on the region card, on both tile cards, and gone with either city
- *each city books its side of the entry exactly once*
  - the parent pays once, on the endowment line; the new city opens with its start funds plus the endowment
  - the report of the month it was booked in lists it once, as a one-off outside the monthly net
  - a save round trip, a second boot and the monthly refresh never book it again
  - only the city the founding made takes the money: not a later city on its tile, nor one founded on the parent's
  - founding without an endowment moves no money, and still counts as a founding
  - a sandbox city's money is not counted: the line is booked, the funds stay
- *a tab killed during the founding leaves one whole transfer or none* (real `LocalSimHost`, `saveCity`, `saveRegion`)
  - killed before the new city is stored: no city, no transfer
  - killed before the region is written: no city, no transfer
  - killed before the region write lands: no city, no transfer
  - killed right after the region write: both cities book it, once, however often they are opened
  - a packet host books before its Ready: the replica opens with the money moved, and its save holds the booking
    (`LoopbackSimHost`: the worker's protocol on the page)
  - killed again and again before either city is saved: every reopening books it afresh from the old save, never twice
- *"Founded a sister city" approval*
  - adds one point in each of the 12 monthly updates after the founding, and nothing before or after
  - a founding booked on a month tick still counts 12 updates; the breakdown names it
- *the sister city's jobs reach the parent as any neighbour's do (PB-REGION)*
  - through the parent's connection on the shared edge; an unconnected edge gives a tenth

**`tests/game/sisterDialog.test.ts` (7)**: is titled for it, with the parent's mayor filled in and the endowment under
the starting funds · the note follows the slider and the difficulty · Found City asks first, saying the transfer can't
be undone; declining returns to the form, agreeing founds · without an endowment it founds at once; cancelling founds
nothing and gives nothing · a parent inside its 10 years gets the reason and the date instead of the slider · a sandbox
city takes no endowment · an ordinary founding has no endowment field and keeps its title.

**`tests/game/sisterMenu.test.ts` (7)**: the pause menu offers it under the exit while the scene has the hook · closes
without resuming and starts the founding · is disabled while the region is open in another tab · the scene offers it
only with the App's handler and an unfounded neighbour · the exit pauses, waits for the exit save, takes the thumbnail,
then hands the city to `onFoundSister` · the ordinary exit still goes to `onExitToRegion` alone · a scene disposed
during its exit save founds nothing.

**`tests/game/sisterBudgetLine.test.ts` (2)**: the ledger lists what the parent gave as "Sister city endowment", apart
from the monthly net · and what the new city received under the same name.

**`tests/regionSisterDialog.test.ts` (3)**: the storage session passes the plan to the dialog and asks for persistent
storage inside its Found click · an ordinary founding carries no plan · it refuses in a read-only region.

**Revert checks** (each mutation made the named tests fail, then was restored byte for byte):

| mutation | caught by |
|---|---|
| no "already booked" check in `bookEndowments` | save round trip; killed right after the region write; killed again and again (§4,000,000 instead of §6,000,000) |
| the new city's side booked without the id check | only the city the founding made takes the money |
| no `fromFounded` check for the parent's side | the same test, its last part |
| stub one cell deeper (4) | veteran finding 6 (the stub becomes a connection) and the three stub tests |
| no undo after a failed region write | a region write that fails takes the entry back |
| approval window `<` instead of `<=` | a founding booked on a month tick (11 updates instead of 12) |
| no 10-year check | the two rule tests |
| no confirmation in the dialog | Found City asks first |

## Gates

| gate | result |
|---|---|
| `npx tsc --noEmit` | clean |
| my 5 test files | 51 passed |
| `tests/save/**` (24 existing files + mine), `tests/storageDb.test.ts`, `tests/regionStorage.test.ts` | 27 files, 174 tests passed |
| region, economy, approval, history: `tests/sim/{region,regionJobs,economy,approval,approvalGuide,difficultyRules,history,finalFixesEcon,foundingDay,phase0Contract,employment}.test.ts`, `tests/infra/trafficRegion.test.ts` | 12 files, 104 passed |
| dialog, scene, budget, HUD: `tests/game/{newCityStart,firstCity,citySaves,autosaveFloor,budgetPreview,budgetTaxes,approvalHud,yearReviewHistory,yearReview,topBarFrame,adviceActions,rciGuide,labelFrame,storageDialog,titleSettings}.test.ts` + my two | 17 files, 223 passed |
| `tests/game/{panelsLayout,panelsMisc,panelsUpkeep,panelCommands,panelsAdvisors,cityTeardown,cityDisposeCanvas,crashDialogStacking,uiStacking,graphicsRestore,playLoadTime}.test.ts`, `tests/sim/advisors.test.ts` | 12 files, 102 passed |
| worker: `tests/worker/{hygiene,simCore,localSimHost,hosts,loopbackHost,replica,replicaSafe,queries,commands,recovery,protocol,exactDigest}.test.ts` | 12 files, 137 passed, 3 skipped (existing skips) |
| **bot 128×15 s7** | **`residents [ 61124, 93804, 37971 ]` = 192,899 in 2015: identical** (done in 29.4 s) |
| bot A/B inside the branch | the whole log (15 yearly rows, the bot's actions, the news, the final jobs, caps and budget tables) is identical with the two sim hunks disabled; only the timing columns differ |

- **Two timeouts under load, both gone:**
  - `tests/worker/hygiene.test.ts` "W0.2: speed writers live only in src/worker or src/sim" (not mine) timed out once at
    its 5 s limit (11.7 s) when it ran first in a 10-file group on a busy machine. Alone it takes 2.5 s and all 18
    pass; it passed in the later group run too. It parses every source file outside `src/sim` and `src/worker`.
  - My own "reads the parent's edge roads…" test timed out once at 5 s: it compared two full serializations of a 128
    city. It now hands `sisterParent` a frozen view of the six fields it reads and compares the two layers by their
    bytes. The region fixture uses a preview-resolution terrain. The file's slowest test now takes under 0.5 s.
- **Bot command:**
  `node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7`
  Its log is `scratch/bot128x15_s7.log` in the lane's scratch folder; the A/B run is `bot128x15_s7_nohunks.log`.
- **Left for the lead:** the full vitest, the bot on the merge commit, the two-process hashes if wanted, and every
  browser check below. LG-12 has no bot target (§5.4: the bot plays one city).
- **Why Medium and Hard are bit-identical.** The only sim code a city without a sister reaches is the first check of
  `bookEndowments` (no `endowments` in its region context: return) and one `undefined` read in approval's `update()`.
  No new RNG draw, no new key in any save.

## Requests for cloud-held files

**1. The built-out card's button** (LG-12's first Change line; LG-05 says the option joins "as those items land").

- `src/sim/economy/advisors.ts`, `builtOutAdvice`, after the `if (nb) { … }` block:

  ```ts
  // LG-12: a free tile next door (the region context of the entry names the neighbours; CityScene's sisterOffered
  // reads the same context, so the button exists whenever the card names it)
  if ((st.systemData.region as RegionContext | undefined)?.neighbors?.some((n) => !n.founded)) {
    said.push('found a sister city on the free land next to us');
    options.push({ id: 'sister' });
  }
  ```

  Its header comment then drops "and a sister city (LG-12)" from the list of options still to come.
  `tests/sim/advisors.test.ts` needs the new sentence where a fixture's region context has an unfounded neighbour.
- `src/ui/adviceActions.ts`, `ACTIONS`:

  ```ts
  // LG-12: the pause menu's "Found a sister city" (GameContext.foundSister: set while a free tile borders the city)
  sister: { label: 'Found a sister city', icon: 'map', tip: 'Saves the city and opens the New City dialog on the free land next to it', run: (ctx) => void ctx.foundSister?.() },
  ```

  `issueButtons` and the TopBar's `builtOutHint` then show it without further change.

**2. None for `src/worker/**` or `src/save/**`.** §7.6 lists "the region operations (endowment, deals)" as Worker
commands and journal entries. The endowment needs neither: it reaches the simulation through `init.rctx`, and the
ledger is its recovery.

## Plan against code

1. **"Charged only when the player presses Found."** It is recorded then (the ledger entry, in the founding's save
   chain) and booked by each city when it is next opened. Writing into the parent's stored record at Found would need a
   second city write that IndexedDB cannot join to the first through `KV` (one store, one put), so the ledger would be
   needed for recovery anyway; and it would pass a city record through `src/save` outside its host. **Choice for the
   lead:** if the parent's record must change at Found, the booking can also run then, on the same idempotent path.
2. **"Sister jobs count for the parent only once the edge is connected (PB-REGION)."** PB-REGION as merged gives an
   unconnected edge a tenth, not nothing (`EDGE_NONE = 0.1`, `tuning.ts` §REGION; final fixes F1). A sister city is a
   neighbour like any other, and I did not change that balance. The test states both numbers (0.1 unconnected, 0.5 over
   a road). A strict zero for sisters would need a mark on `RegionNeighbor` and a line in `connectedNeighbours`
   (`regionLink.ts`, SIM): it changes regional demand for every city with a sister.
3. **Veteran finding 6 is already fixed** by final fixes V6 (`connections.ts`: a run must reach 3 cells in, hold 6 cells
   and belong to the city's main network; `CONN_EDGE_DECAY`). The stub is `CONN_MIN_DEPTH` cells deep, the deepest that
   is not a connection, and the constant is tied to it. A stub 4 deep and 2 wide would be a connection in an empty city
   (the revert check shows it).
4. **The approval term is not in the Year in review.** `tests/game/yearReviewHistory.test.ts` requires
   `APPROVAL_LABELS` to list exactly `YEAR_REVIEW_TERMS`, and every such term is a history series in every save. Adding
   `sisterCity` there would change every city's save. The term's label therefore lives in `BONUS_LABELS`, and the review
   does not list it.
5. **The dialog opens on the region screen**, after the city is left, not over the city. Cancelling leaves the player on
   the region screen with the free tile selected.
6. **The guide's first step ticks at once in a sister city.** `Onboarding.ts` `edgeRoad` counts any road on a map edge,
   and the stub is one.
7. **File references.** The plan's `main.ts:430-560` is now `startNewCity` (`:548`), `exitCity` (`:874`) and the new
   `foundSister` (`:908`).
8. **PB-DIALOG is in**, and this flow relies on it: its dialog always opens after a city was open, and `hud.css` now
   scopes its `.modal` rules to `.mp-ui` (`hud.css:725-733`).
9. **PB-REGION, LG-05 and W1.3 are in.** The built-out card exists (`advisors.ts` `builtOutAdvice`), with its options
   as buttons through `issueButtons`; the sister option is the request above.

## Choices that need the lead

1. **The deferred booking** (point 1 above).
2. **`EDGE_NONE` for sisters** (point 2 above).
3. **Founding without an endowment** is always allowed and also earns the +1. The bonus does not stack: each founding
   restarts the 12 months. A city can hold +1 for as many years as it has free neighbouring tiles.
4. **A sandbox parent cannot endow** (its money is unlimited); a sandbox new city takes none. Not in the plan.
5. **Deleting the new city refunds nothing**, and a parent that has not been opened since still pays: the transfer can't
   be undone. Ledger entries of deleted cities stay in the region record (a few bytes each).
6. **`ENDOWMENT_MIN` = §1,000**: below it the dialog says the treasury is too small.
7. **The new city's start year** stays the dialog's default (2000), not the parent's current year. One line if wanted.
8. **Only from inside the city.** The region screen's own "Found New City" offers no endowment, because the parent's
   funds, day and edge roads are read from its open host.
9. **Which roads are continued.** Every road cell on the shared edge that is reached from inside the parent; a road
   running along the border is continued once, at its middle, unless a road joins it there. Rail is not continued.

## Not verified

- **Anything in a browser**: the dialog's layout with the field at 1280×720, the confirmation over it, the region card's
  rows, the toast at city load, the pause-menu item, focus and Enter / Esc across the two dialogs.
- **`src/main.ts`'s flow end to end.** It cannot be imported in node. Its three helpers are tested, and the test's
  `found()` repeats `startNewCity`'s steps in the same order.
- **A real worker** (`?simworker=1`). A `LoopbackSimHost` test runs the worker's protocol on the page: the replica opens
  with the booking, `sisterParent` reads it, and the save's reply carries `sisterOf`. No run in a dedicated worker, and
  no `?simworker=loopback` run in a browser, was made.
- **The y43 checkpoint acceptance** and a real killed tab.
- **The toast at city load.** The booking's news item is posted during the systems' init. On the local host the toasts
  are already listening then (`Notifications.ts:503` subscribes in the scene's constructor, and `initViews` boots the
  host afterwards), so a toast is raised while the city loads; whether it is still up when the loading screen clears
  is a browser check. On a packet host the item is in the Ready snapshot: in the news list and the ticker, no toast.
- **The full vitest suite** (82 files of it ran, listed above).

## Browser checklist (LG-12 Acceptance)

Local host first, then once with `?simworker=1`.

1. **Entry.** In the y43 checkpoint city with a free tile next door: Esc → "Found a sister city" is under "Save & exit to
   region". In a city whose neighbours are all founded it is absent. In a second tab of the same region it is disabled.
2. **Leaving.** Click it: "Saving city…", the region screen, the free tile with the most of the city's edge roads is
   selected, and the dialog "Found a Sister City" is open with the parent's mayor and "· sister city of <parent>".
3. **Slider.** Maximum = 25% of the parent's funds, at most §5M. The note reads "The new city starts with §2,100,000
   (§100,000 + §2,000,000)…" at §2M on Medium, and follows the difficulty. At 1280×720 the dialog still fits or scrolls.
4. **Cancel.** Cancel the dialog: open the parent again, its funds are unchanged and its Budget has no endowment line.
5. **Confirm.** Found City at §2M: the question says the transfer can't be undone. Cancel returns to the form with the
   amount kept; "Found and give" founds.
6. **The new city** opens paused with §2,100,000, the news line "… gave it §2,000,000 to start with. Its road reaches
   our border here…" (clicking it in the ticker or the news list flies to the stub), and a 3-cell road at the edge where
   the parent's road ends. There is no "New neighbor connection!" notice and no connection cap relief until a road is
   built on from the stub (a few cells into the city); then the notice appears.
7. **The parent.** Region screen: its tile card shows §2M less at once, and the region card lists "<parent> → <new
   city>". Open it: treasury −§2,000,000; Budget → Income & expenses shows "one-off −§2,000,000" for the month, and
   after the month ends "Sister city endowment −§2,000,000" under One-off, once. Approval lists "Founded a sister city
   +1.0" for 12 months.
8. **Ten years.** Found a second sister city from the parent: the field shows "<parent> endowed a sister city in <month
   year>. It can endow another from <month year + 10> (once every 10 years)." and no slider; the founding still works.
9. **Killed tab.** (a) Close the tab right after "Found and give" while "Founding the city…" shows; (b) close it once
   the new city has opened; (c) open the parent, do not save, close the tab, open it again. In every case the new tile
   is either unfounded with the parent's money untouched, or founded with §2.1M and the parent §2M lower, once.
10. **Sister jobs.** With the two cities joined by road and the sister city grown, the parent's RCI popover shows the
    regional jobs term; with the parent's edge road bulldozed it drops to a tenth (point 2 above).
11. **After the cloud's hunks land:** the built-out card and the RCI popover's built-out hint show "Found a sister city"
    when a free tile borders the city, and the button does what the pause-menu item does.
