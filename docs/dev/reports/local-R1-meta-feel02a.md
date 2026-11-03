# T036 step 3 — FEEL-02a: real-time budgets at every speed (New Year pacing, D17, and the toast budget)

Branch `cloud/t036s3`, from dev `4432beb` (`origin/claude/beautiful-johnson-u2jqoz`).

## Cloud carry-over (Nov 3)

### Gap list (written first, before any code)

What the desktop left: nothing for step 3. STATUS (Oct 28, 07:25) stops at "T036 step 2 (started)"; no `local/*` branch
holds FEEL-02a work (`local/R1-meta-start` and `local/R1-meta-schema` are ancestors of dev), and `docs/dev/wip/` has
no T036 patch or journal. T027 (the camera keys on `e.code`) and T031 (NOTE-041's `holdCalendar` command, which
NewYear.ts now calls through the host) are in dev, so step 3's dependency is met. Every item below starts from dev.

Sources read: T036's task file (step 3), NOTE-035/037/038/040/042/043 (the ones that name T036), NOTE-044, NOTE-041
(holdCalendar), POLISH_PLAN §7.2-§7.5 and §8.1, FEEL-02a in full with its Acceptance, D17 (§11), critique point 3,
Goal 8, PB-NEWYEAR's row, and FH-03's "FEEL-02a's toast budget queues this toast".

| Required (FEEL-02a, D17, Goal 8) | In dev before this lane |
|---|---|
| A full show on the city's first New Year, on a rank-up New Year (LG-01), otherwise at most once per 10 real minutes; two full shows never under 3 real minutes apart, rank-ups included | Every New Year played in the loop gets the full show (NewYear.ts `onYear` → `celebrate`) |
| A full show is today's cinematic at 1x and the fireworks-mode show at 2x and ultra | Already so (the year-length budget in `celebrate`) |
| Every other New Year at 1x and 2x: a burst of at most 12 s, no countdown, no fanfare (only the fireworks' own sound), no camera or clock takeover | Missing |
| At ultra, every other New Year: no burst, only a silent compact toast "2034 · 812,400 residents, up 6%" | Missing (fanfare, toast and an 8 s show every 18 s) |
| The yearly toast stays; the fanfare plays only with a full show | The fanfare plays with every yearly toast, also the "show still running" one |
| Settings row "New Year show: Milestones / Every year" (`newYearPacing`, default `milestones`); "Every year" keeps today's pacing | The key and its default are in the schema (step 1), unread; no row |
| Toast budget for advisor, warning and good news: at most 1 per 4 s and 8 per minute | Missing (Toasts shows every news toast, de-duplicated only) |
| Bad news, disasters and errors always show | Already so (no budget) |
| A toast with an action is queued and shown when the budget allows, never dropped (FH-03's "Zone homes", FEEL-06's "Place it", by `NewsItem.ref`); other extras go to the ticker and the news feed | Missing; `NewsItem.ref` is in dev (T035), the action map (`adviceActions.ts`, GUIDE) is not |
| The demand-cap toast (TopBar) shares the budget, which Toasts enforces | Missing |
| Acceptance: 5 min at ultra on a 100k+ save: at most 2 fanfares and 2 full shows, at most 8 toasts in any 60 s, every disaster toast shown | Not measured; today about 16 fanfares and 16 shows |
| Acceptance: 10 min at 2x on a 100k save: at most 2 full shows, fireworks on screen at most 25 % of the time | Not measured; today about 60 % |
| Acceptance: 10 min at 1x on a 100k save: at most 2 full shows; every other New Year a burst of at most 12 s | Not measured; today a 73 s cinematic every 180 s |
| Acceptance: the first New Year and a rank-up New Year each get a full show unless one played in the last 3 real minutes | Missing |
| Acceptance: a toast with an action that arrives over budget appears within 60 s | Missing |
| §8.1 verifier 6: the pacing probes (ultra 5 min, 1x and 2x 10 min each) | No probe exists |
| Gates: tsc; the full vitest; the bot identical to dev (196,101); the item's browser checks; the `.done` line | — |
