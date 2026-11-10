# T060: polish round 2, META lane (FEEL-01, then FH-12)

Task: docs/dev/queue/T060-polish-r2-meta.md. Two sub-lanes, one after the other: FEEL-01 (the news ticker) on
`cloud/t060feel01`, then FH-12 ("Start your first city") in its own sub-lane.

## Cloud carry-over (Nov 3): FEEL-01

Branch `cloud/t060feel01`, a new lane from dev `c364906` (no desktop branch exists for T060).

### Gap list (what was required, against what was done when this step started)

Sources: the task file; POLISH_PLAN FEEL-01 (Problem, Change, Files, Acceptance, Depends on), FH-18 (it owns the text
test the acceptance names), FEEL-22 (the user of `ticker.push`), FEEL-02a (its toast budget shares the file), PB-PANELS
(the ticker caches its width); NOTE-044. No NOTE names T060. No report, branch or WIP existed for it.

| # | required (POLISH_PLAN FEEL-01) | state on dev `c364906` | left for this step |
|---|---|---|---|
| 1 | The newest item enters from the right; it holds 5 s if it fits, otherwise it scrolls through once at 60 px/s | an 8-item marquee at 38 px/s whose offset never resets: a new item shows after the loop wraps (`Notifications.ts:112-123`) | **all of it** |
| 2 | Bursts queue: 5 s for the first, then 3 s each | none | **all of it** |
| 3 | One clause: the first clause only, at most 90 characters, split at " — " or ". "; the full text in the tooltip and the news feed | the full text, no per-item tooltip (the news feed already has the full text) | **the clause and the tooltip** |
| 4 | Flavour headlines get a "Gazette" label | none | **all of it** |
| 5 | Hover pauses the ticker | hover pauses the scroll | **pause the whole timeline (holds, scroll, queue)** |
| 6 | The welcome tip: "Tip: roads and power lines carry electricity from your plant to your zones." | "…connect it with power lines." (`Notifications.ts:89`) | **fix it** |
| 7 | A new `ticker.push(item)` API (FEEL-22) | none | **add it** |
| 8 | The ticker caches its width (PB-PANELS); no layout thrash while it scrolls | A1: widths come from a ResizeObserver, no read per frame (`panelsNews.test.ts`) | **keep it in the new design, test it, check it in the browser** |
| 9 | Acceptance: within 1 s of a `notify`, the first 20 characters are inside `.tk-view` | — | **test + browser** |
| 10 | Acceptance: a 200-character item shows at most 91 characters, plus a tooltip with the full text | — | **test + browser** |
| 11 | Acceptance: each of 10 consecutive headlines is fully visible within 15 s of arriving | — | **test + browser** |
| 12 | Acceptance: FH-18's text test covers the welcome tip | FH-18 (GUIDE, round 2) is not in dev; its `src/ui`-wide test does not exist | **a ticker-level test for the tip; the `src/ui`-wide scan stays FH-18's (decision)** |
| 13 | FEEL-02a's toast budget tests pass unchanged | they pass on dev | **touch only `NewsTicker`; keep `toastBudget.test.ts` byte-identical** |
| 14 | Tests that encode the old marquee: `panelsNews.test.ts` (N2, A1), `views.test.ts` (W0.5) | assert the 8-item track | **re-express each one's intent (no freeze past 200, a load rebuilds, no layout read per frame, the sequence invalidates) for the one-item ticker** |
| 15 | Gates: tsc, the full vitest, the bot identical to dev (192,899), browser checks at 1280×720 | — | **run them** |
| 16 | The report section and a `.done` line | — | **write them** |

### Resumed (the step was interrupted at 22:15 and continued at 22:21)

What the interrupted run left on `cloud/t060feel01`: four commits (`78faa8f` the ticker, `d405962` a 1 s step cap and
`qa-ticker`'s 3D-view switch, `22b4f88` the 120 px entry, `ce74794` a test literal), a clean tree, and this report
without its gates. Against the gap list above, what was still open:

| left | why | done in the resumed run |
|---|---|---|
| the revert check on the final code | the last run stopped at revert 14 of 23 (its tree was still mutated) | rerun on `ce74794`: 23 of 23 fail (below) |
| the real-save probes on the final code | they ran at 21:39, before `d405962` and `22b4f88` | `bot256_s7_y60` rerun on `ce74794`; `id128_y10`'s save had been deleted from the scratchpad (below) |
| the browser checks | run 1 (22:10) predates the last two fixes and failed on SwiftShader's frame a second; run 2 never started | runs 2-4 on the `ce74794` ticker; three script fixes (`7e6ef7b`); run 4 passes all 10 (below) |
| tsc, the full vitest, the bot | never run on the final code | run (below) |
| decision D8 | named in the CSS paragraph, never written | written |
| the `.done` line | — | written |

The code itself was re-read line by line against FEEL-01's Change and Acceptance (`NewsTicker`, its helpers and the
two CSS rules); nothing in it was saved mid-edit, and the ticker needed no change. `tools/qa-ticker.mjs` needed three
fixes (below), and `tests/game/tickerLayout.ts` a truer comment.

### What this step did

**The ticker (`src/ui/Notifications.ts`, `NewsTicker` and its helpers only; `Toasts` is untouched).** One item at a
time, the newest first:

| | behaviour | constant |
|---|---|---|
| entry | a new item enters from the right at once (a 0.5 s ease-out slide from 120 px right of its place); an idle rotation item gives way to it | `ENTER_S` 0.5, `ENTER_PX` 120 |
| fits | it holds 5 s | `HOLD_S` 5 |
| too long | it rests 1 s, scrolls through once at 60 px/s until its end is in view, rests 1 s (at least the 5 s slot) | `LEAD_S`, `TAIL_S` 1, `SCROLL_PX_S` 60 |
| bursts | they queue in arrival order: 5 s for the first, then 3 s each (a long item's rests halve) | `BURST_S` 3 |
| behind | at most 8 wait (a full queue lets the oldest routine item go first); routine news that waited 6 s gives way to the items behind it. Routine = the kinds that also show elsewhere (`tickerRoutine`: advisor tips and warnings in the Advisors panel, bad news and disasters as toasts that always show and in the emergency banner); flavour headlines, good news and rewards never give way. Everything stays in the news feed and comes back in the rotation | `QUEUE_MAX` 8, `STALE_S` 6 |
| idle | it rotates through the newest 8 items (`tickerItems`), newest first, skipping once each item it just showed as new, never the same item twice in a row | — |
| one clause | `tickerClause`: up to the first " — " or sentence end (". ", not after "St." / "Dr." / "e.g." …), at most 90 characters cut at a word, then "…" (so at most 91); the item's tooltip (`title`) has the full text, and the news feed is unchanged | `TICKER_CLAUSE_MAX` 90 |
| label | flavour headlines (`'info'` news from the `'news'` desk, `isGazette`) carry a "Gazette" tag | — |
| date | "Mar 4" (the full date is the date's own tooltip): the year took ~34 px of a ~381 px view | — |
| hover | pauses everything: the hold, the scroll, the queue's clock; new items wait | — |
| clock | real time (`performance.now()`, at most 1 s a frame): CityScene clamps the frame dt at 0.1 s, so on a slow machine the holds would have stretched | `MAX_STEP_S` 1 |
| widths | the ResizeObserver (A1) reports the track's and the view's widths after layout; a frame reads no layout and writes `transform` only when it changes (nothing while an item rests) | — |
| sync | new items are the ones after the last one seen (W0.5's `newsSeq` and `newsMark` still trigger it); a replaced log (a load, another city) or a revision with no new item starts over at the newest item, without queueing the old log (pushed items stay) | — |
| `push(item)` | FEEL-22's API: a UI-made `TickerItem` (text, kind, optional day, x/z for a click that focuses the cell) shows next, after the news that came before it, once (it is not in the log) | — |
| welcome | "Tip: roads and power lines carry electricity from your plant to your zones." | — |

**CSS (`src/ui/hud.css`, the ticker rules only):** the track holds one item (the 28 px gap is gone) and a `.tk-tag` rule
for the Gazette label. `.hud-bl`'s width is unchanged (decision D8).

**Tests.**
- New `tests/game/newsTicker.test.ts` (20 tests) on the fake DOM with `tests/game/tickerLayout.ts`, a layout stand-in
  for the 1280×720 HUD (a 389 px view, 6.4 px per 12 px character: on the slow side of the browser's 381 px and
  5.84 px, so every item of 19 characters or more runs at least as far past the view as in the browser):
  - the four acceptance items: within 1 s from the idle rotation, from a long rotation item mid-scroll and right after
    a new item's hold, and on a 4 fps machine (with a 5 s hold that lasts 5 real seconds, not 12.5); a 200-character
    item shows ≤ 91 characters with the full text as its tooltip, plus `tickerClause`'s cases (every flavour headline
    fits in 91); 10 consecutive headlines fully visible within 15 s: the 10 longest every 8 s (2×'s shortest headline
    gap: 40 days × 0.2 s), 10 among a 2× game's other news (one item every 9 s, the rate a real 45k city posts at 2×),
    and 10 in a busy 2× city (2 tips or warnings a month, a fire and its outcome every 15 s: more than one line can
    show); the welcome tip (FH-18's rule, below);
  - the timeline: bursts (5 s, then 3 s each, in arrival order, then the rotation past them), no item twice in a row,
    entry from the right / rest / 60 px/s scroll once / rest, no transform write at rest, hover, the queue cap and its
    routine-first choice, stale routine news giving way (and a headline never), a replaced log, Gazette, `push`.
- New `tests/game/tickerProbe.test.ts`, skipped unless `TICKER_SAVE` names a save (like FEEL-02a's pacing probe): the
  real Simulation on a real save at 1×, 2× and ultra on a simulated real-time clock, the real `NewsTicker` on the
  city's own news; it asserts the 15 s acceptance for 10 consecutive flavour headlines at 1× and 2×, and reports ultra.
- `tests/game/panelsNews.test.ts` (N2, A1) and `tests/game/views.test.ts` (W0.5) re-expressed for one item at a time,
  each keeping its intent: past the 200-item cap the new items still show (all five before any old one; then the
  rotation is the newest 8, never the items of when the log filled up); a replaced log rebuilds; no layout read per
  frame or per swap with a ResizeObserver, one per swap without; the scroll uses the reported widths; the sequence
  alone invalidates. W0.5's loop now steps 6 s per headline (`ticker.frame(6)`), so each one ends the previous hold.
- `tests/game/toastBudget.test.ts` is byte-identical to dev's.
- **Each new test fails with its fix reverted:** 23 reverts of the final `Notifications.ts` (`ce74794`), each run
  against `newsTicker.test.ts` in a private copy of the tree (`t060feel01-mut/mutate.py` in the scratchpad; log
  `t060feel01-mut/mutate-final2.log`): all 23 fail, and the unreverted copy passes (38 passed, the probe skipped). The
  short date and the halved burst rests are margin, so they are reverted together (`t060feel01-mut/margin.log`, the
  final code: the busy 2× case's slowest headline goes 11.8 s → 17.8 s; each alone 14.2 s / 14.9 s).

| fix reverted | result |
|---|---|
| a new item preempts the rotation | 2 failed |
| a 0.5 s entry (6 s instead) | 1 failed |
| the entry starts 120 px right of its place (from the view's right edge instead) | 1 failed |
| real-time clock (the clamped dt instead) | 1 failed |
| one clause (the full text) / the tooltip | 1 failed / 1 failed |
| the " — " split / the ". " split past abbreviations | 1 failed / 1 failed |
| bursts 3 s after the first | 1 failed |
| 60 px/s (38) | 1 failed |
| no transform write at rest | 1 failed |
| hover pauses | 1 failed |
| the queue cap / routine first when full | 1 failed / 1 failed |
| stale routine news gives way (timeline test / busy-city acceptance) | 1 failed / 1 failed |
| a replaced log starts over | 1 failed |
| no item twice in a row / the rotation skips the just-new items | 1 failed / 1 failed |
| Gazette label | 1 failed |
| the welcome tip | 1 failed |
| `push` after the news that came before | 1 failed |
| the short date and the halved burst rests | 1 failed |

**The 15 s acceptance on real cities** (`tickerProbe.test.ts`; "gave way" = never shown as a new item; it came back in
the rotation). `bot256_s7_y60` reran on the final code `ce74794` (log `t060feel01-probe-r2-bot256_s7_y60.log`, 3 of 3
passed). The `id128_y10` rows are from 21:39, before `d405962` and `22b4f88`: that save (`simB/tooling/out`) was gone
from the scratchpad when the rerun got the lock. Those two commits do not move the timeline (an item's turn does not
depend on where its entry starts, and the probe's 30 fps frames are far under the step cap); they only bring an item's
head into view sooner. The `bot256_s7_y60` rerun shows exactly that: every number equal or up to 0.2 s earlier.

| save (scratchpad fixtures) | speed | sim time | news items | 10 consecutive flavour headlines: seconds to fully visible | all items: median / p90 / max | gave way |
|---|---|---|---|---|---|---|
| `id128_y10` (45k; 21:39 build) | 1× | 363 s | 26 | 9.7 3.0 5.3 7.7 5.6 6.2 3.3 5.4 5.2 5.7 (**10 of 10 ≤ 15 s**) | 5.2 / 7.8 / 9.7 s | 1 |
| `id128_y10` | 2× | 160 s | 27 | 10.6 3.3 5.3 6.4 8.0 8.4 12.2 7.8 7.9 7.6 (**10 of 10**) | 5.8 / 8.4 / 12.2 s | 1 |
| `id128_y10` | ultra | 54 s | 38 | 11.0 9.8 10.3 11.0 18.4 22.0 23.1 26.4 ∞ ∞ (4 in a row; reported) | 11.0 / 26.4 / 26.4 s | 8 |
| `bot256_s7_y60` (250k, fires) | 1× | 328 s | 63 | 7.8 0.2 3.1 8.7 7.7 13.2 12.2 10.8 4.8 9.2 (**10 of 10**) | 5.1 / 9.2 / 13.2 s | 3 |
| `bot256_s7_y60` | 2× | 139 s | 65 | 9.9 5.8 3.4 12.8 6.7 7.3 11.9 7.1 11.5 7.0 (**10 of 10**) | 5.9 / 10.0 / 12.8 s | 22 |
| `bot256_s7_y60` | ultra | 51 s | 95 | 7.9 4.9 6.3 9.3 10.9 10.7 13.5 13.1 15.6 17.1 (8 in a row; reported) | 10.7 / 15.6 / 17.1 s | 39 |

How the design got there (the same probes on earlier builds of this lane): the plan's numbers alone (the full date,
1 s rests, a plain FIFO queue) gave `id128_y10` 2× headlines of 12.2 4.2 5.9 6.9 14.2 **16.2 18.0 15.2** 9.6 8.7 s;
the short date and halved burst rests fixed that one (max 12.2 s) but `bot256_s7_y60` still failed (1×: max 16.8 s;
2×: 1 in a row, 4 never shown), which the stale rule and the routine-first cap fixed. Ultra posts more than one line
can show (38-95 items in under a minute); it is reported, not gated (decision D3).

### Browser checks at 1280×720 (`tools/qa-ticker.mjs`, run 4: all 10 pass)

SwiftShader draws the UI dev page (`demo-ui.html`, a 64-tile town, the sim paused so only the injected news arrives) at
0.8 frames a second, which says nothing about a DOM ticker: the checks switch the 3D view's update and draw off, and
then the page runs at 60.3 frames a second. Log: `t060feel01-qa-run4.log` in the scratchpad.

| check | result |
|---|---|
| layout | HUD zoom 0.8; the ticker's box 10-378 screen px, its view 72-377 (305 screen px, 381 css px); the toolbar's box 375-905 (3 px of overlap, dev's layout: D8) |
| F1 the welcome tip | "Tip: roads and power lines carry electricity from your plant to your zones."; no "connect it with power lines" |
| A the first 20 characters inside `.tk-view` within 1 s of a notify | from the idle rotation 0.007 s; a new long item 0.004 s; while a rotation item scrolls (`translateX(-0.8px)`, not a new item) 0.009 s; right after a new item's hold 0.013 s |
| A2 a notify during another new item's turn | waits for it: 4.96 s (its 5 s slot) |
| B a 200-character item | 85 characters shown ("The regional transit authority has approved a sweeping plan that would connect every…"); the tooltip is the full 200; its first 20 characters in 0.013 s |
| B2 a long item | scrolls through once: its end comes into view |
| D widths cached, no layout thrash | 2 s at rest: 121 frames, 121 layouts, 0 layout reads from `Notifications.ts`; 2 s while one item scrolls (`-14.4px` → `-140.5px`): 121 frames, 121 layouts, 0 reads. One layout a frame both ways is the page's own; the scroll adds none |
| E hover | the transform holds (`-23.3px`), the new item waits (1 waiting); it shows 3.45 s after the pointer leaves (the rest of the item's turn) |
| F2 Gazette | the flavour headline carries the "Gazette" tag; the next item (good news) has none |
| C 10 consecutive headlines (the 10 longest, every 8 s) | fully visible after 2.87 6.48 5.25 5.77 5.29 2.10 2.68 5.35 4.81 4.61 s (max 6.48 s ≤ 15 s) |
| C2 (reported) the same every 2 s, ultra's pace | 2.84 8.65 11.87 15.60 18.93 19.05 20.57 23.98 26.77 29.38 s (D3: 10 at once cannot fit 15 s by the plan's own 5 + 9 × 3 s) |
| page errors | none |

Screenshots (scratchpad `t060feel01-shots/run4/`, each one looked at): `f01-00-welcome.png` (the welcome item mid-entry,
"Jan 1"), `f01-01-new-item.png` (the new item first, its toast beside it), `f01-02-200-chars.png` (the 200-character
item's clause at rest), `f01-03-200-scrolling.png` (mid-scroll), `f01-04-200-end.png` (the next item after the
scroll), `f01-05-hover.png` (held under the pointer), `f01-06-gazette.png` and `f01-06-gazette-zoom.png` (the tag),
`f01-07-after-headlines.png` (a long headline scrolled to its end). The ticker never covers the toolbar.

Runs 2 and 3 (same ticker code) failed on the script, not the ticker, and `7e6ef7b` fixed the script: its
"200-character" item had 193 characters; its mid-scroll case caught the long item during its own turn as a new item
(a notify then waits for that turn, the plan's "bursts queue": now checked as A2); its 3 s scroll window could run into
the next item, whose ResizeObserver report read the new widths (2 reads, after layout). Run 1 (22:10) predates the
3D-view switch: at a frame a second it timed nothing.

### Gates

| gate | result |
|---|---|
| tsc (sem) | clean on `ce74794` (9.5 s) and on `7e6ef7b` (6.6 s) |
| full vitest (lock), run 1 on `ce74794` | 2195 passed, 31 skipped, 1 failed: `tests/worker/hygiene.test.ts` "NOTE-041: maxDaysPerFrame writers…" timed out at its 5 s while this lane's 23 revert runs used 2 cores beside it (a `src`-wide text scan; this lane changes no file it reads but `src/ui/Notifications.ts`). That file alone: 17 passed, 1 skipped |
| full vitest (lock), run 2 on `7e6ef7b` | **221 files passed, 3 skipped; 2196 tests passed, 31 skipped, 0 failed** (252 s; log `t060feel01-vitest-full3.log`) |
| the bot (lock) | lane `7e6ef7b` and a clean export of dev `50a6b29` (`t060feel01-devbase`): residents [ 61124, 93804, 37971 ] = 192,899 both, every line the same apart from the timing columns |
| FEEL-02a's toast budget | `tests/game/toastBudget.test.ts` byte-identical to dev's, passing |
| each new test fails with its fix reverted | 23 of 23 (above) |
| FEEL-01's acceptance | the four items, in the unit tests (20 in `newsTicker.test.ts`), on two real saves (above) and in the browser (above) |
| merge with dev | dev (`origin/claude/beautiful-johnson-u2jqoz`, 64 commits past this lane's base at 04:00) touches none of this lane's files, and `git merge-tree` merges the two cleanly |

### Decisions (the conservative reading, with the evidence; the lead's to confirm)

- **D1 · "Enters from the right" is a 0.5 s slide, not a 60 px/s crawl.** The first acceptance item (the first 20
  characters inside `.tk-view` within 1 s) rules out an entry at the scroll speed: the text starts ~62 px in, so 20
  characters (~128 px) at 60 px/s take ~3 s. The item slides in (ease-out, 0.5 s) from 120 px right of its place and
  rests; only a long one scrolls, at 60 px/s. Not from beyond the view's right edge: that first frame shows an empty
  ticker, which on SwiftShader's frame a second lasted a second (run 1's `f01-06-gazette.png`).
- **D2 · Rests for a long item** (the plan names none): 1 s before it scrolls and 1 s at its end, so its start and
  its end can each be read; halved for a queued item of a burst. A long item takes at least the 5 s slot.
- **D3 · "10 consecutive headlines" is read at the game's own pace at 1× and 2×** (flavour headlines come 40-100 days
  apart: 20-50 s at 1×, 8-20 s at 2×), with the city's other news between them, and gated there (unit tests and the
  real-save probe, 10 of 10 on both saves). At ultra (2-5 s apart, among 0.7-1.9 news items a second) no one-line
  ticker with the plan's 3 s / 60 px/s can show every item: it is reported (4 and 8 in a row), not gated. A burst of
  10 at once cannot meet it either by the plan's own numbers (5 + 9 × 3 = 32 s).
- **D4 · The ticker lets routine news go when it falls behind** (`STALE_S` 6 s, a routine-first queue cap of 8). The
  plan says only "bursts queue"; without this a busy 250k city at 2× failed the acceptance (1 headline in a row, 4
  never shown). Routine = the kinds that also show elsewhere: advisor tips and warnings (the Advisors panel), bad news
  and disasters (FEEL-02a always shows them as toasts, and the emergency banner). Flavour headlines (the ticker is
  their only place), good news and rewards never give way. Nothing leaves the news feed, and the rotation brings the
  items back. A trade-off for the lead: the alternative is a ticker that runs minutes behind in a busy city.
- **D5 · The date label is "Mar 4"** (the full date is its tooltip). The plan does not mention the date; the year took
  ~34 px of a ~381 px view at 1280×720. With D2's halved rests it is margin for the 15 s acceptance (the busy 2× case:
  17.8 s with neither, 14.2 / 14.9 s with one, 11.8 s with both).
- **D6 · Idle, the ticker rotates the newest 8 items** (the old marquee's 8), newest first, each held 5 s (or scrolled
  once); the plan does not say what an idle ticker shows. A new item interrupts the rotation at once.
- **D7 · FH-18's `src/ui`-wide text test stays FH-18's (GUIDE lane).** `AdvisorsPanel.ts:66` still says "connect it
  with power lines", which FH-18 fixes; a `src/ui`-wide scan would fail on it today. This lane tests the ticker's tip
  (the welcome items, and a scan of `Notifications.ts`) with FH-18's regular expression.
- **D8 · `.hud-bl`'s width is unchanged.** The plan's Problem names the small window (`clamp(240px, 50% − 340px,
  460px)`: 460 css px, 368 screen px at 1280×720) and its Files line cites `hud.css:345-359`, but its Change does not
  ask for a wider block. At 1280×720 there is no room: the browser measured the ticker's box at 10-378 screen px and
  the centred toolbar's at 375-905 (3 px of overlap already, dev's layout, the glass edges meet; the screenshots show
  no clash). The one-clause, one-item ticker fits its 381 css px view (305 screen px): every flavour headline's clause
  shows whole or scrolls once. Widening it waits for a layout change of the bottom bar (the lead's call).
- **D9 · The bot ran anyway** (nothing under `src/sim`, `src/worker`, `src/game` or `src/save` changed, and its import
  closure holds no `src/ui` file): the lane and a clean export of dev `50a6b29` print the same output apart from the
  timing columns, residents [ 61124, 93804, 37971 ] = 192,899 (Gates, above).
- **D10 · Two files outside the owns list, both new:** `tools/qa-ticker.mjs` (the browser checks, so a reviewer can
  rerun them) and `tests/game/tickerProbe.test.ts` + `tests/game/tickerLayout.ts` (test helpers). No other lane's
  file is touched; `Notifications.ts`'s hunks stay inside the ticker's old lines 26-124 (T058's question container in
  `Toasts` merges around them).

## Cloud carry-over (Nov 3): FH-12

Branch `cloud/t060fh12`, a new lane from dev `51ec328` (FEEL-01 merged as `156e0bc`). No desktop branch, WIP or report
existed for FH-12: this sub-lane starts from dev itself.

### Gap list (what was required, against what was done when this step started)

Sources: the task file (owns, do, gates); POLISH_PLAN FH-12 in full (Problem, Change, Files, Acceptance, Depends on,
Risk) and §4.3 Phase A (A1, A2, A3); the items it builds on, FH-11 (the dialog, `recommendedTile`), FH-04
(`difficultyRules`, Easy's `defaultDisasters: false`) and FEEL-05 (the day-90 founding in `startNewCity`); the guide's
copy (`src/ui/guide/copy.ts` `phaseA`, T037d); NOTE-044, and the NOTEs naming T060 (NOTE-057, -059, -060, -061, -064);
the handoff README (docs/dev/handoff/2026-11-04); the in-flight branches that edit the same files (T036s4 and W1.3 in
`src/main.ts`, T042's one funds line, T037a's `WIND_START`).

| # | required (POLISH_PLAN FH-12, §4.3) | state on dev `51ec328` | left for this step |
|---|---|---|---|
| 1 | With no region saved, the primary button is "Start your first city", sub-line "Guided · your first road in about 2 minutes" | the menu leads with a disabled "Continue — No saved region yet" and "New Region" is primary (`TitleScreen.ts:61-62`); the strings exist as `guideCopy.phaseA.A1`, `A1Subtitle`, `A1Region`, used nowhere | **all of it** |
| 2 | "New Region" moves to second place | — | **all of it** |
| 3 | One click creates a Greenvale Valley region with a unique id | only `?quickstart=1`, which deletes and recreates the fixed id `quickstart` (`main.ts:1013-1014`) | **all of it** (a persistent region, never the fixed id) |
| 4 | …founds FH-11's recommended tile on Easy, with Guided start and Disasters off, on day 90 (FEEL-05) | the parts exist: `RegionModel.recommendedTile()` (FH-11), `defaultCityConfig({ difficulty: 'easy' })` gives §250k and Disasters off (FH-04), `rememberNewCity` records Guided start (FH-11), `startNewCity` founds on day 90 (FEEL-05) | **wire them into one path** |
| 5 | …and opens the paused city | `CityScene` starts a city with no camera and no building paused (`CityScene.ts:200-202`); the guide card opens while its pref is not dismissed and the town is young (`Onboarding.ts:161-164`) | **verify on the new path** |
| 6 | The first-city loading screen rotates the three tips of §4.3 A2 | one tip list of 8 general tips from a random start (`LoadingScreen.ts:5-14`), among them the region tip the plan quotes; the three tips exist as `guideCopy.phaseA.A2Wind/A2Zones/A2Play`, used nowhere | **all of it** |
| 7 | Acceptance: on a fresh profile, one click reaches a founded, paused city with the guide card, after one loading screen | `quickstart` shows two (its own, removed, then `startNewCity`'s) | **one loading screen handed to `startNewCity`; unit tests; the browser check** |
| 8 | Acceptance: exiting shows the city on its tile, and Continue returns to it | `exitCity` shows the region with the city's tile selected; it stores the session without the tile, so the title's Continue then opens the region with nothing selected | **Continue selects the last-played city on its region; browser check** |
| 9 | Acceptance: an existing region is never overwritten (a unit test on region ids) | — | **a unique-id rule and its test** |
| 10 | Task gates: tsc, the full vitest, the bot identical to dev (192,899), browser checks at 1280×720 (the one click to a playable first city on a persistent region; a second start offers to continue it; the loading screen) | — | **run them; the browser checks go to the Desktop QA list (NOTE-061, below)** |
| 11 | Keep `main.ts` hunks small (T036s4, W1.3 and T042 edit it too) | — | **the logic in a new module, `main.ts` only wires it** |
| 12 | The report section and a `.done` line | — | **write them** |
