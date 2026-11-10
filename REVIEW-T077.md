# REVIEW-T077 (cloud lead → desktop worker): PASS

Reviewed origin/local/T077-newyear-liveyear @ 8aee2dc8 (base dev e58f8ac) against dev db519df. This is a single-pass
lead review (wind-down): I read the src diff in full and the report, and took the gates and the real-GPU QA from the
DONE.

**Lead's note:** PASS. Merge on a full gate, not the fast path: since the dev you merged (e58f8ac), dev has changed
two of your files.

- **src/game/CityScene.ts:** FEEL-03 afa1d24, T096 8a50d04 and T089 5641cbe.
- **src/worker/protocol.ts:** T096's `firsts` system key and T089.

Merge current dev into the lane. The bot must read 192,236. If T075 lands first, its NewYear.ts and CityScene.ts hunks
meet yours: keep both, meaning T075's show hooks, and your `onYear` batch line with its `liveYear` dependency. Then
message "MERGED".

## What was checked

- **The local host:** `liveYear` is true only inside its own `frame()`, and re-entrant safe (`nested`). A `runDays`
  batch outside a frame reads false.
- **The documented change is accepted:** a local runDays of 8 days or less over a year end is now a batch, with no
  show. A debug run is not a player's year end.
- **The worker path:**
  - The recorder marks a packet not live if any day it carries ran with the scheduler's live flag off (`batchDays`).
    The flag is captured at the day itself and cleared per packet and on reset, so a packet flushed after a runDays
    has ended still reads as a batch.
  - `schedulerOf()` creates an empty scheduler on first use, which the infra systems would create anyway. That is
    harmless and deterministic.
- **The replica:** it exposes the packet's flag only while that packet's log replays (`finally` clears it), so
  New Year's `year` listener reads the flag of its own day's packet.
- **Old packets:** `Clock.live` is optional, so an old packet, such as a recorded stream, reads as unknown, and
  New Year keeps its frame-gap rule there. No other page code reads `clock.live`: GameSounds and LIVE read
  `policy.live`, a different field.
- **NewYear.ts:** the only hunk is in `onYear`, `batch = live === undefined ? <frame-gap rule> : !live`, as the task
  asked.
- **QA:**
  - The bug, a backlog over 1 January, is fixed.
  - The base's full show on a paused game after a batch that ends on 1 January is gone.
  - Loading and raising the speed behave as before.
- **Nit (no action now):** `SimHost` gains `liveYear` through a second `interface SimHost` declaration, which keeps
  the hunk apart from other lanes. Fold it into the main interface in a later cleanup.

## Not tested: "an emergency's LIVE slowdown during a show"

This is not blocking, because the lane changes only the batch decision and not the LIVE rules. **Post-merge QA
item:**

- With manual dispatch, so that a fire waits for the player, start a fire outside every station's range shortly
  before 1 January at 1x, so that the LIVE episode overlaps the show.
- LIVE should behave as its title says: "Outside it, LIVE slows your dispatch; your speed returns when help arrives."
- No slowdown should stay stuck after the show ends.

## Pre-existing finding: the cloud's, after T075 and T077 are in dev

**Save & exit during a countdown stores the show camera as the city's camera** (CityScene.ts `storeCamera`), so
re-entry opens on the skyline.

- **Fix (yours, as suggested):** while New Year's camera is active, store its saved player view.
- It lands after T075, which also edits CityScene.ts and NewYear.ts, and after T077.
- **Desktop QA when it lands:** Save & exit mid-countdown, then re-enter. The city opens on the player's view, not
  the skyline.
