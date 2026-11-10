# T071 (LG-02, the late-game landmarks): SIM gate row, verdict PASS (NOTE-103, NOTE-112)

**Rows compared** (256x60 s7 base, 9 members each, NOTE-062):

- the lane: local/T071-lg02 @ 27f9394, which is dev d2ab0c1 plus T071;
- dev's s7 base row: dev 05cbf59, docs/dev/ensembles/long-05cbf59/s7_base.*.

Between 05cbf59 and d2ab0c1, dev took T042, whose sim changes are gated on Hard and Expert. One Medium control member
on d2ab0c1 checks it: its state hash, population, funds and approval equal 05cbf59's control member in all 60 years (the whole run is bit-identical), so 05cbf59's row is the exact reference. The two rows are also identical in every member through 2023, before T071's
first purchase.

**Files:**

- s7_base.md / s7_base.summary.json: the lane row;
- base.compare.md: the runner's base check against dev's row;
- side.md: year medians with funds, the members at 2060, and each landmark's unlock and purchase.

## NOTE-103's four items

| | dev 05cbf59 | T071 27f9394 |
|---|---|---|
| 2060 population, median [min, max] | 1,408,250 [1,389,466, 1,524,813] | 1,568,374 [1,445,902, 1,613,226] (+11.4%) |
| 2060 approval, median | 80.2 | 82.4 |
| 2060 year-end funds, median | 15.3M | 15.6M |
| stalled (growth under 100,000 from 2050 to 2060) | 0/9 | 0/9 |
| Metropolis Crown (1.5M) unlocked and bought | (not in dev) | 6/9, in 2056-2057 |

1. **Population:** identical to dev through 2023. It stays within ±0.2% through 2050, then rises: +3.1% in 2055 and
   +11.4% in 2060, as the late landmarks' caps and the Crown take effect.
2. **Approval:** +2.3 points in 2060, and at or above dev from 2040.
   - The 2030-31 dip (median −1.3 and −1.9 points) comes from the bot's tax timing.
   - Dev's control cut every tax to 8.5% in October 2029. The lane's control made the same cut in December 2030,
     14 months later, because it had spent §700,000 on its first three landmarks: the Library (September 2023), Grand
     Central (January 2025) and the Stock Exchange (April 2026).
3. **Funds:** 10-18% lower from 2030 to 2055, because of the purchases and their upkeep, and level by 2060.
   - No year ends negative.
   - The lowest year-end funds from 2010 are identical to dev's, because they come before the first purchase.
4. **The Crown:** 6 of 9 members reach 1.5M and buy it, in 2056-2057.
   - The three that miss end at 1,494,146 (the control, as the desktop measured) and 1,445,902 (m100 at both
     timings).
   - It stays a stretch goal, and its threshold stays (NOTE-103).

**The other six late landmarks:** all 9 members buy all six. Each unlocks at the first monthly check after its
threshold and is bought when the city can afford it. The median purchase years:

| Landmark | Median purchase year |
|---|---|
| Central Library | 2023 |
| Grand Central | 2025 |
| Stock Exchange | 2026 |
| Botanical Dome | 2033 |
| World Trade Center | 2038 |
| Millennium Tower | 2043 |

**The runner's base check fails,** as it must for a lane that changes the sim on purpose. The medians leave dev's
band, but no band is disjoint from dev's for 3 or more consecutive years, so NOTE-062 finds no real shift.

**Observed, not one of T071's gate metrics:** the high-tech industry share (I-HT) median is 0 in 2056-57, against dev's
0.02-0.04. Both rows have members near 0 at 2060.
