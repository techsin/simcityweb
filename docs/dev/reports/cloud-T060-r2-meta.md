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
| date | "Mar 4" (the full date is the date's own tooltip): the year took ~34 px of a 389 px view | — |
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
  for the 1280×720 HUD (a 389 px view, 6.4 px per 12 px character; the browser measured the real ones, below):
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
- **Each new test fails with its fix reverted:** 22 single-fix reverts of the final `Notifications.ts`, each run against
  `newsTicker.test.ts` in a private copy of the tree (`mutate.py` in the scratchpad): all 22 fail. The short date and
  the halved burst rests are margin, so they are reverted together (the busy 2× case goes 11.8 s → 17.8 s; each alone
  14.2 s / 14.9 s).

| fix reverted | result |
|---|---|
| a new item preempts the rotation | 2 failed |
| a 0.5 s entry (6 s instead) | 2 failed |
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

**The 15 s acceptance on real cities** (`tickerProbe.test.ts`, the final code; "gave way" = never shown as a new item;
it came back in the rotation):

| save (scratchpad fixtures) | speed | sim time | news items | 10 consecutive flavour headlines: seconds to fully visible | all items: median / p90 / max | gave way |
|---|---|---|---|---|---|---|
| `id128_y10` (45k) | 1× | 363 s | 26 | 9.7 3.0 5.3 7.7 5.6 6.2 3.3 5.4 5.2 5.7 (**10 of 10 ≤ 15 s**) | 5.2 / 7.8 / 9.7 s | 1 |
| `id128_y10` | 2× | 160 s | 27 | 10.6 3.3 5.3 6.4 8.0 8.4 12.2 7.8 7.9 7.6 (**10 of 10**) | 5.8 / 8.4 / 12.2 s | 1 |
| `id128_y10` | ultra | 54 s | 38 | 11.0 9.8 10.3 11.0 18.4 22.0 23.1 26.4 ∞ ∞ (4 in a row; reported) | 11.0 / 26.4 / 26.4 s | 8 |
| `bot256_s7_y60` (250k, fires) | 1× | 328 s | 63 | 7.8 0.3 3.1 8.7 7.7 13.2 12.2 10.8 4.8 9.2 (**10 of 10**) | 5.3 / 9.2 / 13.2 s | 3 |
| `bot256_s7_y60` | 2× | 139 s | 65 | 9.9 5.9 3.4 12.8 6.7 7.3 11.9 7.1 11.5 7.0 (**10 of 10**) | 6.0 / 10.0 / 12.8 s | 22 |
| `bot256_s7_y60` | ultra | 51 s | 95 | 7.9 5.0 6.3 9.3 10.9 10.7 13.5 13.1 15.6 17.1 (8 in a row; reported) | 10.7 / 15.6 / 17.1 s | 39 |

How the design got there (the same probes on earlier builds of this lane): the plan's numbers alone (the full date,
1 s rests, a plain FIFO queue) gave `id128_y10` 2× headlines of 12.2 4.2 5.9 6.9 14.2 **16.2 18.0 15.2** 9.6 8.7 s;
the short date and halved burst rests fixed that one (max 12.2 s) but `bot256_s7_y60` still failed (1×: max 16.8 s;
2×: 1 in a row, 4 never shown), which the stale rule and the routine-first cap fixed. Ultra posts more than one line
can show (38-95 items in under a minute); it is reported, not gated (decision D3).

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
  ~34 px of a 389 px view at 1280×720. With D2's halved rests it is margin for the 15 s acceptance (the busy 2× case:
  17.8 s with neither, 14.2 / 14.9 s with one, 11.8 s with both).
- **D6 · Idle, the ticker rotates the newest 8 items** (the old marquee's 8), newest first, each held 5 s (or scrolled
  once); the plan does not say what an idle ticker shows. A new item interrupts the rotation at once.
- **D7 · FH-18's `src/ui`-wide text test stays FH-18's (GUIDE lane).** `AdvisorsPanel.ts:66` still says "connect it
  with power lines", which FH-18 fixes; a `src/ui`-wide scan would fail on it today. This lane tests the ticker's tip
  (the welcome items, and a scan of `Notifications.ts`) with FH-18's regular expression.
- **D9 · The bot was not run.** Its import closure (tools/simbot.ts, 89 files, walked from the imports) holds no
  `src/ui` file, and nothing under `src/sim`, `src/worker`, `src/game` or `src/save` changed: it is dev's by
  construction (dev's reference: residents [ 61124, 93804, 37971 ] = 192,899).
- **D10 · Two files outside the owns list, both new:** `tools/qa-ticker.mjs` (the browser checks, so a reviewer can
  rerun them) and `tests/game/tickerProbe.test.ts` + `tests/game/tickerLayout.ts` (test helpers). No other lane's
  file is touched; `Notifications.ts`'s hunks stay inside the ticker's old lines 26-124 (T058's question container in
  `Toasts` merges around them).
