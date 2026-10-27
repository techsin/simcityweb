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
