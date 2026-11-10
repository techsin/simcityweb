# NOTE-112 (lead → desktop worker), 10 Nov: T071's SIM gate row PASSES; T093's follow-ups are in dev; T091's three choices

## T071: verdict PASS. Merge after your real-GPU recheck

- **The rows:** 256x60 s7 base, 9 members, on local/T071-lg02 @ 27f9394, against dev's s7 base row (05cbf59). The docs
  are in docs/dev/ensembles/t071-27f9394/ (58df398).
- **The reference is exact:** a Medium control member on d2ab0c1, your dev base, is bit-identical to 05cbf59's over
  all 60 years (same state hash every year). T042's sim changes apply only on Hard and Expert.

| NOTE-103 item | dev | T071 |
|---|---|---|
| 2060 population, median [min, max] | 1,408,250 [1,389,466, 1,524,813] | 1,568,374 [1,445,902, 1,613,226] (+11.4%) |
| 2060 approval, median | 80.2 | 82.4 |
| 2060 year-end funds, median | 15.3M | 15.6M |
| Crown unlocked and bought | (not in dev) | 6/9, in 2056-2057 |
| stalled | 0/9 | 0/9 |

1. **Population:** identical to dev through 2023, before the first late landmark, and within ±0.2% through 2050.
   Then +3.1% in 2055 and +11.4% in 2060.
2. **Approval:** at or above dev from 2040, and +2.3 points in 2060.
   - The 2030-31 dip (median −1.3 and −1.9 points) is the bot's tax timing, not a rule.
   - Dev's control cut every tax to 8.5% in October 2029. Yours made the same cut in December 2030, after spending
     §700,000 on the Library, Grand Central and the Stock Exchange.
3. **Funds:** 10-18% lower from 2030 to 2055, because of the purchases and upkeep, and level by 2060. No year ends
   negative.
4. **The Crown:** 6 of 9 members reach 1.5M and buy it. The control ends at 1,494,146, your measurement exactly. It
   stays the stretch goal, and its threshold stays.

**The other six late landmarks:** all 9 members buy all six, at the first monthly check after the threshold, when they
can afford them. The median purchase years:

| Landmark | Median purchase year |
|---|---|
| Central Library | 2023 |
| Grand Central | 2025 |
| Stock Exchange | 2026 |
| Botanical Dome | 2033 |
| World Trade Center | 2038 |
| Millennium Tower | 2043 |

**The runner's generic base check fails,** as it does for any lane that changes the sim on purpose. No band is
disjoint from dev's for 3 or more years, so there is no real shift by NOTE-062's rule.

**Observed, not one of T071's gate metrics:** the I-HT share median is 0 in 2056-57, against dev's 0.02-0.04.

**T044 and T045 (one line):** their rows compare against dev 05cbf59. If T071 lands in dev before their final gates,
say so, and the cloud re-runs the dev rows they need on the new dev. That needs no agents.

## T093's follow-ups are in dev (285d0f6, 9c073cd), on top of your merge 94b1c7b3

- **The Seaport's coastline is counted when asked**, stopping at the 41st water cell. A coast dug by terraforming
  now counts in the running game and in the Rewards panel. I chose this over dropping the cache on `terrainChanged`,
  because the page's replica kept a cache of its own.
- **P1:** the silent check emits no `unlocked` event.
- **P2:** a reward toast keeps the title "Reward unlocked".
- **Tests:** two new test files; 6 of their 7 cases fail on the old code. On dev + T077, 15 files and 167 tests pass.
  The bot is untouched: no terraforming in its run, and `init` runs once.

**Desktop QA:**

1. A new sandbox city shows no Rewards badge and plays no reward sound at its start.
2. A reward toast reads "Reward unlocked", and "Place it" opens the reward.
3. On a dry map with 6,000 industrial jobs, dig a lake of more than 40 water cells: the Seaport unlocks at the next
   month tick with its news, and the Rewards panel says "Coastline: yes" without a reload.

Reply "QA t093-followups: PASS" or "FAIL".

## T091 round 2: all three choices accepted

1. **The 1st of the parent's current month.** It matches FEEL-05, which opens every city on the 1st.
2. **No spring opening for a sister city.** It shares its parent's calendar, so a January-March parent gives an
   opening before April, and a December parent gives a first New Year a month later. That is fine.
3. **The year is fixed and dimmed in the New City dialog,** with the note. Any other year would break the endowment
   line and the 10-year dates.

Send DONE after your real-GPU QA, and I review round 2 on its diff. The cloud's T091 hunks follow T091's merge into
dev: `builtOutAdvice` with its test sentence, and `ACTIONS.sister`.

## T077

Noted. The Save & exit countdown camera fix from REVIEW-T077 lands once T075 is also in dev.
