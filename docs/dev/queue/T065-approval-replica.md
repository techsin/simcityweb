# T065: the approval card rebuilds after a month tick on the replica hosts (desktop finding B1, T071 QA)

Cloud lane (chain fix1). Base: dev at or after 080676d. The bot reference is residents [ 61828, 95515, 40772 ] =
198,115 (128x15 seed 7). This lane changes no simulation: the bot must stay identical.

## Why

The desktop's T071 QA (Nov 10, on dev's base) found that the TopBar's approval hover card never rebuilds after a month
tick on the replica hosts (`?simworker=1` and the loopback host). It keeps showing the terms of the month it was first
built in.

Cause, confirmed by reading dev:

- src/ui/topbar/approvalSegment.ts `update()` rebuilds the card only when
  `eco?.approvalTerms !== this.apprTerms || hud.band !== this.apprBand` (an identity test). Its comment says the terms
  object is "a new object each month". That holds on the main-thread host, where src/sim/economy/approval.ts assigns
  `data.approvalTerms = T` each monthly update.
- On a replica, src/worker/replica.ts applies each patch's `sys` with
  `st.systemData[key] = mergePlain(st.systemData[key], p.sys[key])`. `mergePlain` (src/worker/protocol.ts) is
  documented to keep "all surviving object / array identities, including nested ones". So `economy.approvalTerms` keeps
  its identity from month to month, and the identity test never fires again.

## Do

1. Write the failing test first: a replica (or loopback) host, a city run across at least two month ticks whose
   approval terms change; the approval card's rows must match `approvalBreakdown(st)` after each tick. Show it fails on
   dev, as the desktop saw.
2. Fix it in src/ui/topbar/approvalSegment.ts with a change key that works on every host, without per-frame cost.
   Examples: a monthly stamp the economy already publishes, or a cheap content key built only when a stamp changes.
   Do not change `mergePlain` or src/worker/** (chain guide2c owns src/worker/** now, and other code relies on the
   kept identities).
   Keep the card's content and layout as they are, and keep the band rule (`hud.band !== this.apprBand`).
3. Audit src/ui/** and src/game/** for the same pattern: an identity cache on a value that lives under `systemData`,
   or another section a replica fills with `mergePlain`, that expects a new object per update. For each hit, give the
   file and line, whether it is wrong on the replica hosts, and its owner by the T064 chain split
   (docs/dev/queue/T064-guide-r2-cloud.md). Fix only the hits inside src/ui/topbar/**. List the others in the report
   as requests to their owners, with a proposed patch each.

## Coordination

- src/ui/topbar/** belongs to chain guide2b (T064), whose lanes are in flight: FH-08-LIVE was merging at 06:15 UTC,
  then FEEL-03, FH-23, FH-17. Keep the hunk small and inside `update()`'s terms block. Whichever lane merges second
  resolves any conflict (T064's rule). Add a new test file instead of editing tests/game/topBar*.test.ts.

## Gates

- tsc clean; the full vitest under the timing lock; the bot identical at 198,115.
- The new test fails on dev and passes on the lane; reverting the fix makes it fail again.
- The TopBar trace fixture tests (tests/game/topBar*.test.ts) pass unchanged.
- No browser checks here (NOTE-061). End the report with a short Desktop QA list: on `?simworker=1` and on the default
  host, open the approval card, let two months pass, and check that its rows change with the month (with a picture of
  each).

## Report

docs/dev/reports/cloud-T065-approval-replica.md: the cause, the failing test before and after, the fix, the audit
table (file:line, wrong on replica?, owner, proposed patch), the gates with numbers, and the Desktop QA list last.
