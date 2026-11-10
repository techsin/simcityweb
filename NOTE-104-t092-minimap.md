# NOTE-104 (lead → desktop worker), 10 Nov: T092's two asks and its seven choices; the MiniMap test under load

## T092 (LG-14 scenarios and challenges)

**Ask 1, the main.ts hunk (`onChallenges` in App.showTitle):** yes. The cloud lands
docs/dev/reports/local-T092-main-wiring.patch right after T092 merges, with tsc and the title tests. Put "QA of the
Challenges title entry waits on the cloud's hunk" in the DONE.

**Ask 2, does "Hard money" mean all of Hard's money rules?** Yes. Hard money = Hard's start funds, income ×0.85,
running costs ×1.15, and the 12-month bankruptcy removal. It does not include the tax-approval cost, disasters or
dispatch, which are not money rules.

- Fold the switch to `moneyDifficulty(config)` into T092's next round: opex.ts at its four reads (75, 101, 110, 142)
  and budget.ts:281.
- Add a test: a Medium city with Hard money pays ×1.15 running costs and is removed after 12 negative months.
- A plain Medium city must stay identical (the bot is 192,236).

**The seven choices:**

1. **Smog City's tiers: tighten gold.** The clean-up strategy reaches gold in 10 months, so gold at 3 years is a gift.
   Use **10 / 5 / 2 years** (bronze / silver / gold).
2. **Lights Out burns the gas plant:** accepted. It matches the seed-7 city's real plant. Keep the briefing and news
   saying gas.
3. **Reading of the Lights Out line** (one plant bought from the bank is gold; a loan-funded plant is at most silver):
   accepted.
4. **"Keeping 180k people" means 180,000 residents in the month the air goal is met:** accepted. Make the briefing say
   exactly that.
5. **"No new loan" means none beyond the two the city starts with, at any time before the outcome; a loan taken and
   repaid still counts:** accepted.
6. **A challenge badge is earned at the City rank (25,000 residents):** accepted.
7. **Medals per profile, judged from the city's history:** accepted. The re-judge on another profile is a fair cost
   for writing nothing into the sim.

## The MiniMap test under load (views.test.ts "W0.5 MiniMap utilities invalidation")

It failed under load in both T070's and T071's gates and passes alone, so it is a dev test that depends on timing, not
those lanes. NOTE-091 said do not edit it, and that still holds for you. **The cloud takes it** and makes it
deterministic, never by skipping it or widening a timeout alone. If you have the failing counts from either gate, send
them.

## T071

bf34c35a (docs only, the LG-02 acceptance) is noted. The 9-member row runs on 27f9394, whose sim is identical, after
the dev long members finish, around noon.
