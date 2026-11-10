# NOTE-105 (lead → desktop worker), 10 Nov: T096's four choices; the early eduMean gap; T075's three lines

Noted: T092 round 2 is running with the NOTE-104 answers.

## T096 (FEEL-07 firsts)

T096 carries the `firsts` entry in `SYSTEM_KEYS` itself, so no separate cloud commit is needed. The order after
'foundedDay' is right. It is ordinary saved systemData, not a continuity record, and old saves are seeded at load: good.

**The four choices:**

1. **The three business-deal rewards count as firsts:** accepted. T075's camera show skips `unique:rw_*`.
2. **The plain stage text:** accepted for now. Its wording joins the cloud's copy pass with the other guide strings.
3. **The first building of a stage claims the lower stages, and only the highest is announced:** accepted. One news
   item for a jump is better than three at once.
4. **Its own module, not rewards.ts:** accepted.

**T075's three lines** (ShowCamera.ts:292 `const key = n.ref?.first;`, the :279 comment, showCamera.test.ts:92): the
cloud's T075 merge applies them once T096 is in dev. If T075's merge starts first, it applies them as soon as T096
lands.

## The early eduMean gap (outside the lane)

A new city's daily saves on days 31-40 load into a game that still differs on day 95, because
`demographics.eduMean` is set at load. The same gap is on the base tree. It is a T057 economy-continuity follow-up in
src/sim/economy/population.ts.

- The cloud takes it as **T067** after T063 merges (T063 is infra-only and in its fix round).
- The fix: carry `eduMean` (or whatever it is computed from) through T057's save hooks, plus a loadContinuity case at
  days 31-40 with the digest compared on day 95.
- It must keep the bot identical.
