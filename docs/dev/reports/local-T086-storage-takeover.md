# T086 report: the storage takeover fixes after T036s4's post-merge QA (desktop, NOTE-074)

**Status: implemented and unit-tested; the full gate and the real-GPU rerun of the whole T036s4 QA script are the
desktop worker's next steps.** B1, B2, B5 and B6 are fixed. B3 and B4 are recorded, not fixed. No browser ran in this
round, so every layout statement here comes from CSS arithmetic and is checked in the QA rerun.

Source: the post-merge QA of T036 step 4 on dev 41fcecc ("QA T036s4: FAIL"), scratchpad `qa/T036s4dev/qa.md`.

## Changes per file

| File | Change |
|---|---|
| `src/region/regionLock.ts` | **B1.** The takeover's reload is now `RegionStorage.takeOver`. It waits while `App.busy` is true (a 50 ms poll), gives up if the session was replaced meanwhile, then holds `busy` itself while it tears the city down and reopens the region. `RegionStorageContext` gains `busy` and `setBusy`. |
| `src/main.ts` (two small, separate hunks) | The storage context passes `busy` and `setBusy` (one line). **B6:** in `continueInCity`, a declined gate disposes the storage session, unless the start-up offer's Recover is continuing into the city on it. |
| `src/ui/storage.css` | **B1:** the notice is `visibility: hidden` while `.loading` or `.title-screen` is a child of the root. **B2:** in a city it docks bottom-centre, 142 HUD px up, with z-index 3 instead of 95. |
| `src/ui/StorageDialog.ts` | **B5.** While read-only, the session polls every 2 s. When no tab holds the region, the notice reads "This region is free now · Use it here", and that button asks for the lock without stealing. If refused, the takeover notice comes back. |
| `src/save/db.ts` (one method) | **B5.** `RegionSaveLock.heldElsewhere()`: true, false, or null when unknown or when this lock is itself taking the region. |
| `tests/regionStorage.test.ts`, `tests/save/regionSummaryReload.test.ts` | Outside the named files: one fixture line each gains `busy` and `setBusy`, because tsc type-checks the tests against the new context. |

`src/ui/EmergencyBanner.ts` is untouched. There are no `src/sim/infra` hunks and no worker-file hunks.

## Tests (5 new files, 31 tests)

- `tests/game/storageTakeover.test.ts` runs the real App (main.ts over a fake DOM, the real lock, recovery store and
  `LocalSimHost`; drawing screens stubbed):
  - "waits for the city that is loading, then leaves one region screen, the snapshot, the Recover question and a tile
    that follows the saves" (the B1 regression);
  - "ignores Play while the takeover reopens the region, so the gate cannot be passed as a read-only tab";
  - "releases the region: the tab on its title screen holds no lock and shows no notice" (B6).
- `tests/regionLockTakeover.test.ts`: waits until the entry has finished, then tears down the city that entry opened;
  holds App.busy while the region reopens, and gives it back when the reload fails; reopens nothing when the player
  left the region while it waited.
- `tests/game/storageFreeNotice.test.ts` (B5's notice, the real lock): says so within one poll of the holder leaving
  and takes the region without stealing it; does not take a region another tab opened since the last poll; goes back
  to "open in another tab" by itself when a tab takes the free region; offers the region back to the tab it was taken
  from once the taker has gone; keeps its notice while its own takeover waits, and stops asking when the session ends.
- `tests/storageDbHeld.test.ts`: `heldElsewhere()` follows the holder; asks without a lock request, so the holder's
  own re-acquire is never queued behind a reader; answers null while this lock holds or is taking the region, when a
  takeover begins while the query is out, and when it cannot know (no query support, a failed query, the
  BroadcastChannel fallback).
- `tests/game/storageNoticeCss.test.ts` (15 cases): the dock rule; the `bottom` formula against `computeUiZoom` at 10
  viewport sizes (113.6 px at 1280×720, 154.9 px at 1920×1080); z-index below every HUD layer; the two hide rules;
  the class names the selectors rely on.
- `tests/save/fakeLocks.ts`: a shared fake `navigator.locks` with `query()`.

Mutation checks: 22 of 22 caught (two only after timer-count assertions were added). On the pre-fix `regionLock.ts`
both B1 App tests fail with the city alive beside the region screen. One branch has no test: B6's "unless the start-up
offer recovered" condition, which needs B4's unreachable early click.

## Gates run in the lane

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| New tests | 5 files, 31 passed |
| Existing storage, lock, recovery, banner and main.ts-reading tests | 40 files, 472 passed (all of `recoveryGateScope*`, `storage*`, `tests/game/emergency*`, the recovery suites, the worker hygiene test) |
| Bot, `npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet` through quietrun | residents [ 61124, 93804, 37971 ] = 192,899, identical |

The full vitest, the bot with the action log, and the real-GPU rerun are recorded by the desktop worker below this
section when they finish.

## Plan versus code

1. **B5 uses a lock query, not a queued request (a deviation from NOTE-074's wording, for a reason).** A queued plain
   request is granted ahead of any later `ifAvailable` request. The start-up scan hands its temporary lock to the
   session 0.6-0.8 ms apart (the QA's item 3), so a waiting read-only tab would get the lock first and the recovering
   tab would open read-only. The same applies when the writer reloads or goes title → Continue. A query takes no
   lock. The hunk is separable if the lead prefers to drop it.
2. **B1 does more than wait.** The reload also holds `busy`, so Play or Found clicked between the takeover click and
   its loading screen is ignored. The notice is also hidden on the title screen, which covers Continue's first frames
   before its loading screen exists.
3. **B2's offset mirrors `computeUiZoom` at the default UI scale,** because the notice sits outside `.mp-ui` and
   cannot read `--ui-zoom`. With a custom UI scale the gap is off by that factor and the notice can meet the tool
   chip; the chip then draws on top because of the z-index.
4. **B3 is recorded, not fixed.** It is not a one-line timing change. Dropping the lease check (`db.ts:432`, was
   `:414`) lets a holder that is busy for more than 100 ms lose the region silently; shortening `LEASE_MS` only
   shrinks the window; disposing on `pagehide` breaks a page restored from the back/forward cache. B5 also gives no
   offer in the BroadcastChannel fallback.
5. **B4 is skipped as instructed** (no player can reach it). With B5, a tab that hit it sees "free now" within 2 s of
   the dialog closing and recovers with one click.

## Follow-ups outside the lane's files (optional)

- `src/region/ui/SaveStatus.ts:65`: the minimap chip still reads "Open in another tab" while the notice says the
  region is free.
- `exitCity` in `src/main.ts` does not hold `busy`, so a scripted takeover click during an exit can still interleave.
  No player can reach it: the notice is hidden under the exit's loading screen.

## Not verified in this round

- Anything in a browser: the notice's position, `:has()` in the real DOM, real clicks, real Web Locks `query()` across
  tabs.
- B1 with CityScene or `?simworker=1` (the App test enters cities through main.ts's placeholder path).
- QA scripts that click the notice mid-load: it is hidden there now, so a Playwright `click()` waits until the city
  has loaded; a DOM `.click()` still exercises the wait.

## Browser checklist

**B1**
1. Tab A plays X's city with unsaved progress in its snapshot. Tab B: title → Continue. During B's loading screen the
   notice is not visible and a real click at its old place does nothing.
2. Same set-up; run `document.querySelector('.storage-lock-notice button').click()` 0.4 s after Continue. B finishes
   loading, then shows one region screen (`.region-hud` 1, `.city-host` 0) as the writer. A reads "This region is now
   open in another tab", and its snapshot keeps the same time and hash. Play asks "This region was opened in another
   tab…"; Recover gives A's progress. B's next save updates the tile's residents.
3. Read-only region screen: click "Use it here instead", then Play as fast as possible. No city opens under the
   reload; Play afterwards asks.
4. Control: a takeover clicked after the read-only city has loaded behaves as before.

**B2** (a read-only city, a fire outside station range)
5. At 1280×720 the notice sits at about y 548-606; at 1920×1080 at about y 867-925. It overlaps the banner by 0 px,
   and real clicks on Jump, Send nearest, Choose station… and Dismiss work, with tips on (the teaching card) and off.
6. With a centre panel open so the stack folds: the pill and the fallback teaching card click.
7. With six or more banners: where the stack reaches the notice, the banners draw over it and click.
8. Select a tool: the chip clears the notice. Open a flyout or the year review: it covers the notice and takes its own
   clicks.
9. The notice's own button works at the bottom. On the region screen the notice is still at top 82 px.

**B5**
10. A is writer, B read-only. Close A: within about 2 s B reads "This region is free now · Use it here", and the click
    makes B the writer on the region screen.
11. Reopen X in a third tab before clicking B: B's click steals nothing and its notice returns to "open in another
    tab".
12. Reload writer tab A with B in the background: A comes back as the writer.
13. The QA's item 3 pairs are unchanged: the recovering tab is the writer, and after Later the other tab's notice turns
    to "free now".

**B6**
14. A writer tab with a pending snapshot: title → Continue → Later. No lock is held for X, a second tab opens X
    writable, and neither title shows a notice. Continue again asks again.
