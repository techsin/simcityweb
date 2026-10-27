# local-FH-10-newcomer: the newcomer bot profile (POLISH_PLAN FH-10; T009)

Branch `local/FH-10-newcomer`, base `b57c816`. File: `tools/simbot.ts` only (code, `--help` and the file header).

## What it does
`npx tsx tools/simbot.ts --profile newcomer` (defaults `--size 128 --years 10`) plays like the human players, as FH-10
lists it:
- **Founding.** Founds on day 90 (FEEL-05) and counts years from founding. The default bot keeps day 0.
- **Day 0.** Two small home blocks, shops and industry (4×4 patches); a coal plant beside the first zones; a pump
  beside industry.
- **Expansion.** Only on posted zone-more warnings: FH-03's `ref.advice` when it lands, until then the advisor's rule
  ids (`adviceIdOf`), never the warning text.
- **Police.** Only after a crime warning.
- **Money.** No loans. Taxes at 9 % until the first monthly deficit, then 11 %.
- **Emergencies.** No manual dispatch for the first incident.
- **Nothing else.** It has no other proactive rules. It rejects `--tax`, `--spendy` and `--skip`.
- **Output.** Per year from founding: population, approval with its three largest non-baseline terms, funds, and
  incidents failed that year.

All default-bot paths are guarded by `profile === 'newcomer'`, so the default bot does not change.

## Gates

| Gate | Result |
|---|---|
| Medium 128×10 s7 newcomer: under 5,000 residents and approval under 48 in year 4 | **met: 100 residents, 25.4 %** |
| Runs headless in under 2 minutes | **3.2 s** |
| Default bot unchanged | 128×15 s7 table **and the full action log** (`SIMBOT_LOG=1`) identical to base; 194,432 in 2015 |
| `tsc` / full vitest | clean / 1,091 passed, 6 skipped; only the Windows-CRLF `binary.test` fails |

```
year      pop  approval      funds failed top three approval terms (points; baseline excluded)
1          97     26.6%     $69791      1 Crime -13.1; Air pollution -7.3; Residential taxes -7.0
2         100     25.5%     $68216      0 Crime -13.8; Residential taxes -7.0; Air pollution -6.6
3         100     24.5%     $66642      1 Crime -13.8; Residential taxes -7.0; Air pollution -6.6
4         100     25.4%     $65067      0 Crime -13.8; Residential taxes -7.0; Air pollution -6.6
5         100     25.4%     $63494      0 Crime -13.8; Residential taxes -7.0; Air pollution -6.6
6         100     25.4%     $61915      0 Crime -13.8; Residential taxes -7.0; Air pollution -6.7
7           0     43.8%     $60111      1 Crime -16.2; City services at homes +2.7; Parks near homes +0.8
8           0     47.5%     $58179      0 Crime -16.2; City services at homes +2.7; Parks near homes +0.8
9           0     47.6%     $56247      0 Crime -16.2; City services at homes +2.7; Parks near homes +0.8
10          0     47.4%     $54315      1 Crime -16.2; City services at homes +2.7; Parks near homes +0.8
```

## For the lead: the shape is below the humans'
The acceptance is met, but this city is much worse off than the human newcomer FH-10 cites (863 residents and 43 %
approval in Feb 2006).
- **What happens.** The coal plant burns down early (the first, undispatched incident; no fire station). The profile
  never rebuilds power, so the town stalls at about 100 residents and empties in year 7.
- **What a real newcomer does.** Rebuilds the plant after the "no power" news.
- **Suggested addition.** One rule: rebuild a plant after a `noPower`-type warning. It would make the bot a better
  stand-in for FH-03 / FH-04 measurements. It is not in the plan's list, so I did not add it.

**Who wrote what.**
- **Codex** (max effort): the profile.
- **Me (Claude):** the brief, the review against the plan's list (each rule checked, default paths guarded) and the
  gates.

## Round 2 (NOTE-009): the rebuild-power rule

**The rule.** After a no-power warning (the advisor's rule ids `plantBurnt` / `noPower`, read like the zone-more ids,
never the text), the profile waits 30 days, then rebuilds a coal plant at the first site next to the zones, with the
same placement as day 0. At most one rebuild per lost plant id. A failed placement is logged with `say()` and retried
monthly while the warning lasts. No fire station, no other new rules. The header and `--help` are updated.

**What happened in the 128×10 s7 run** (`SIMBOT_LOG=1`):

| When | Event |
|---|---|
| Apr 2000 | coal plant built |
| May 2000 | first deficit: taxes 9 % → 11 % |
| Mar 2001 | first incident: no dispatch |
| mid-2006 | the plant burns down |
| Jul 2006 | rebuilt ("rebuilt coal for lost plant #1") |
| 2009 | the second plant burns |
| Aug 2009 | rebuilt again |

| Year | Round 1 pop / approval | **Round 2 pop / approval** | Human newcomer (FH-10) |
|---:|---|---|---|
| 1 | 97 / 26.6 % | 97 / 26.6 % | |
| 2 | 100 / 25.5 % | 100 / 25.5 % | |
| 3 | 100 / 24.5 % | 100 / 24.5 % | |
| 4 | 100 / 25.4 % | **100 / 25.4 %** | |
| 5 | 100 / 25.4 % | 100 / 25.4 % | |
| 6 | 100 / 25.4 % | 100 / 25.4 % | 863 / 43 % (Feb 2006) |
| 7 | **0** / 43.8 % | **111** / 23.7 % | |
| 8 | 0 / 47.5 % | 111 / 23.7 % | |
| 9 | 0 / 47.6 % | 111 / 23.6 % | |
| 10 | 0 / 47.4 % | **112** / 26.1 % (funds §50, 2 failed incidents) | |

**Acceptance still holds:** in year 4, 100 residents (< 5,000) and 25.4 % approval (< 48), headless in seconds. Nothing
was tuned toward it. The default bot is unchanged: the 128×15 s7 table and its full action log are identical (1,203
lines); `tsc` is clean.

**Correction to my round-1 note.** The rule does what it should: the town survives, at 112 instead of 0. But the stall
at about 100 residents is not caused by the power loss; it starts in year 1.
- The profile expands only on zone-more *warnings* (FH-03's cue). Today the advisor posts "Residential demand is strong
  but there is no room" as an info message, which the profile ignores as the plan says.
- So the town never grows past its four starting 4×4 blocks.
- The human shape (863 / 43 %) needs FH-03's warning, or an interim rule that also reads that info message. That is the
  lead's call; the plan says "without FH-03", so I added neither.
