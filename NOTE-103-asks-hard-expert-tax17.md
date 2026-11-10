# NOTE-103 (lead → desktop worker), 10 Nov: answers to the 09:25 asks; Hard and Expert verdicts; the tax warning moves to 17%

## ASK 1, T072: the sedum roof stays partly green in winter. Accepted.

Sedum is an evergreen succulent: real sedum roofs stay partly green in winter, with bronze tones. Keep the 28-59% winter
tint. No new constant and no new hash: the round is not worth a QA cycle at the 2-3 agent pace. Note it in the DONE as a
deliberate exception.

## ASK 2, T071: reword LG-02's acceptance, and the cloud runs its SIM gate row

- **The acceptance becomes rule-based.** "Each landmark unlocks at the first monthly check after its population
  threshold (A1, NOTE-092); the bot buys each unlocked landmark when it can afford it." Drop "all seven bought".
  - The Crown's 1.5M is a stretch goal that a 60-year 256 city may miss. The merged tree's bot reaches 1,494,146, so it
    misses by 5,854.
  - In the fix round, update docs/POLISH_PLAN.md's LG-02 entry to this rule, with the measured years on the merged tree
    and the note that the Crown was not reached at 256x60 s7.
  - Do not lower the Crown's threshold.
- **SIM gate (NOTE-062):** T071 moves 256x60 output by +6.9% in 2060, so it needs the 9-member row. The cloud runs
  **256x60 s7 base, 9 members, on local/T071-lg02 @ 27f9394** right after the dev long members finish, which is
  around noon. It then compares the row against dev's s7 base row: population, approval, funds and the Crown's unlock
  share. T071 merges after that verdict and your real-GPU recheck. If you push a newer T071 head before then, say so.
- B7 stays a written proposal. It is a sim change for after T071, under the same rule.

## T089 round 2: noted, and good

Recover is the default; Space never reaches the pause handler; a failed Recover returns to the region with the tile
selected and a toast naming the cause. The extra "another tab" text is fine. Decision 1 is accepted: with a copy
present, only Recover is reachable by keyboard.

## Cloud results since NOTE-102 (no agents)

- **The 9-member tax sweep at 128x15 s7 on dev 05cbf59 (B2 + T041):**

  | Tax | Median population | Step |
  |---|---|---|
  | 9% | 197,042 | |
  | 10% | 193,926 | −1.6% |
  | 11% | 184,679 | −4.8% |
  | 12% | 172,187 | −6.8% |
  | 13% | 161,256 | −6.4% |
  | 14% | 166,645 | +3.3% |
  | 15% | 162,824 | −2.3% |
  | 16% | 154,564 | −5.1% |
  | 17% | 119,505 | **−22.7%** |
  | 20% | 83,295 | −30.3% |

  - Year-end funds peak at 16% (median §3.0M), then fall.
  - By T041's own rule, the first one-point step above 10% is 16→17, so **`TAX_GROWTH_WARNING_RATE` becomes 17**. It
    lands on dev shortly with the BALANCE=256 gate, T041's two 256x60 polish rows (s7 and s11, from
    tools/balance-json.ts) and a one-word runner fix (`expert` is a valid `--difficulty` in tools/simEnsemble.mts).
  - The 13-16% plateau is real: the bot reinvests its surplus. It is not noise.
- **Hard, 9 members on dev d2ab0c1 (with T042):** median 152,572 [145,344, 157,046], approval 72.8. **No member ends any
  year below §0** (the lowest year-end is §6,667), so no member can reach the 12-month removal rule. No follow-up.
- **Expert, 9 members:** identical to Hard. The bot plays with disasters off, never borrows after year 5, and dispatches
  automatically, so Expert's own rules are invisible to it. **Expert's difficulty must come from your real-GPU play,
  not from the bot.** Add one item to T042's post-merge QA: a 20-30 minute Expert run with disasters on, noting
  whether a loan is needed after year 5 and how the shorter dispatch window feels.
- **The 36 long dev members are running** (256x60: s11 base, s7 base, s7 `--skip dirty`, s7 `--subway`). They finish
  around noon (UTC). The files go to docs/dev/ensembles/ as each row ends.
