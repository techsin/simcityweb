# T009-ranks-newcomer-bot: city ranks core (polish LG-01, the part that can start now) and the newcomer bot (FH-10)
base: claude/beautiful-johnson-u2jqoz HEAD when you start (record the sha); branches local/LG-01-ranks and local/FH-10-newcomer
after: none. Runs alongside T007 and T008 (rules below); T007's gates keep priority.
owns:
  - LG-01: src/sim/economy/rewards.ts (CITY_RANKS, listMilestones, the optional systemData rank key and its load path),
    new tests (tests/sim/ranks.test.ts). Not the HUD line, the Rewards tabs or the region card: they wait for the
    TopBar split and the Worker (plan "Depends on").
  - FH-10: tools/simbot.ts only (plus its --help and file header).
do:
  Why: docs/POLISH_PLAN.md decision D1 lists LG-01's ranks in rewards.ts as startable now, and FH-10 once PB-BOTFALLBACK
  has merged (it has: see the PB-BOTFALLBACK comments in tools/simbot.ts). Polish is the longest chain to the finish, so
  every round-1 item done early moves the finish date. Read docs/POLISH_PLAN.md LG-01 (around line 1519) and FH-10
  (around line 1249), and "How to read this plan" (founding day and years), first.
  1. LG-01 core: the CITY_RANKS table exactly as the plan lists it; listMilestones(st) -> current rank, next rank, next
     three unlocks by progress, reading only stats, unlocked and milestones; old saves record already-passed ranks
     silently on load (like rewardsSystem's check(sim, true)); tests for every rank boundary and for old saves.
  2. FH-10: tools/simbot.ts --profile newcomer, playing like the human players as the plan lists (coal plant and pump on
     day 0, small zone blocks, police only after a crime warning, no loans, taxes 9 % until a deficit then 11 %, no
     dispatch for the first incident, founding on day 90); prints years 1-10 (population, approval with its top three
     terms, funds, failed incidents). The default bot must not change.
  Codex implements each item in its own worktree; you review and run the gates.
gates:
  - LG-01: unit tests pass; an old save (any test city in tools/bench/.fixtures or a TEST_CITIES save) loads and
    continues with the rank key filled; the 128x15 seed-7 bot table unchanged (194,432 in 2015), since ranks change no
    sim formula;
  - FH-10: the plan's acceptance (Medium 128x10 s7 newcomer: under 5,000 residents and approval under 48 in year 4;
    headless in under 2 minutes; the default bot's output hash unchanged);
  - npx tsc --noEmit clean; npx vitest run passes (the CRLF binary.test exception as before).
rules: as T008: Codex at below-normal priority; bot runs between T007's timing runs.
report: docs/dev/reports/local-LG-01-ranks.md and docs/dev/reports/local-FH-10-newcomer.md; push each branch; DONE per
  item (e.g. "DONE T009 LG-01 local/LG-01-ranks@<sha> report: …"); docs/dev/queue/T009-ranks-newcomer-bot.done on the last.
