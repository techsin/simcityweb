# T011-guide-copy: the onboarding copy as a data module with text tests (polish §4)
base: claude/beautiful-johnson-u2jqoz HEAD when you start (record the sha); branch local/guide-copy
after: none (runs alongside the other lanes)
owns: new files only: src/ui/guide/copy.ts, tests/game/guideCopy.test.ts
do:
  Why: docs/POLISH_PLAN.md D1 lists "the §4 copy as a data module with text tests" as startable now. Round 1's guide
  items (FH-01, FH-02, FH-08, FH-11, FH-12, FH-13, FH-18) take their texts from it later.
  Read §4 of docs/POLISH_PLAN.md (4.1 teaching rules through 4.8, around lines 3026-3160) and the items above for the
  texts they need. Write every text of §4.3-4.7 as a function of what it needs (state, catalog, tuning), never with
  typed-in numbers: prices, counts and thresholds come from the catalog and tuning ("3 wind turbines (§800 each)").
  Tone per §4.1: second person, at most 2 sentences and 30 words, the plain word first and the code in brackets, money
  with §, never blaming the player.
  Codex drafts; you review every text for tone and accuracy against the game (check each number it reads exists).
gates:
  - text tests: every text within 2 sentences and 30 words, § for money, no digits typed into the strings (numbers
    only through the inputs), every catalog id and tuning key it reads exists;
  - npx tsc --noEmit clean; npx vitest run passes (CRLF binary.test excepted).
report: docs/dev/reports/local-T011-guide-copy.md (the list of texts with one rendered example each, what Codex vs you
  wrote); push local/guide-copy with docs/dev/queue/T011-guide-copy.done; DONE.
