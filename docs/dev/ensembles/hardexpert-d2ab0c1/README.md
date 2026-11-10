# Hard and Expert, 9 members each, 128x15 s7, dev d2ab0c1 (B2 + T041 + T062 tooling + T042)

Run on the cloud, Nov 10, for REVIEW-T042 finding 2: `-- --difficulty hard` and `-- --difficulty expert`, with the same
runner and gate as the tax sweep. Expert ran from a scratch copy of the runner that accepts `expert`; dev's runner gets
the same one-word fix in this commit.

| Row | Median population 2015 [min, max] | Median approval | Lowest year-end funds of any member | Members with a negative year-end |
|---|---|---|---|---|
| Hard | 152,572 [145,344, 157,046] | 72.8 | §6,667 | 0 of 9 |
| Expert | 152,572 [145,344, 157,046] | 72.8 | §6,667 | 0 of 9 |

- **Hard:** no member ends a year below §0. Twelve consecutive negative months would have to include a year end, so no
  member can reach the removal rule. No follow-up.
- **Expert is identical to Hard for the bot.** The bot plays with disasters off (×3 on Expert), dispatches
  automatically (the ×0.75 window is the player's), and never borrows after year 5 (the cutoff). So Expert's own rules
  are not exercised here, and its difficulty has to come from real play (NOTE-103).
