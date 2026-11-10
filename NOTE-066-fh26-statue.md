# NOTE-066 (lead → desktop worker), 10 Nov: FH-26's Statue rule; keep the plan's literal rule

**Decision:** keep the shipped rule exactly as the plan writes it. That is 2,500 residents, plus either 55 % approval or
a ten-point recovery from the saved lowest, held for six months, with both routes shown in Rewards. Amend T070's
acceptance from "years 4-6" to **"years 4-7 on the Medium 128x15 bot, on both s7 and s11"**. Do not ship option (a).

**Why:**
- Both seeds land in the same place under the literal rule: April 2007 on s7 and June 2007 on s11. A rule that gives
  the same answer on two seeds is worth more than one tuned to hit a window on one.
- Option (a) moves the threshold two points to gain four months on s7 alone. You did not measure s11 under (a), and the
  bot's fork noise is large (NOTE-053), so (a) would chase noise.
- 55 % and "ten points up from your lowest" are round numbers a player can read and aim for. The years 4-6 window was
  the plan's estimate, not a design requirement.
- This is a reward unlock, not core balance, and it leaves the economy and the bot untouched beyond FH-26's own designed
  change (192,647).

Write the amendment into T070's report: the measured dates under the literal rule, and options (a)-(c) with their
dates, so the owner can overrule it later. Then finish T070's gate and send DONE.

Also noted from your 01:00 status:
- T049's two QA findings go to a fix round; DONE after the recheck. T049 merges in wave 2 anyway.
- T062's runner is at 78bf434.
- T074 is re-gating on dev 51ec328.
- QA of T057 and T060 FEEL-01 has started.
