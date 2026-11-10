# T042-lg09-difficulty-rules: polish round 2, SIM, LG-09 Hard and Expert that change the rules, not just the money
base: fb1531f (dev); branch local/T042-lg09-difficulty
after: none. Its src/sim/infra hunks (disasters.ts, emergency.ts) are separate commits and hold for B2's merge
  (NOTE-046 Q1).
owns: src/core/types.ts (Difficulty gains 'expert'); src/sim/economy/tuning.ts (DIFFICULTY_RULES), budget.ts (the
  bankrupt streak), opex.ts, approval.ts (the tax penalty per point), loans.ts; src/sim/config.ts where the rules are
  read; tools/simbot.ts (--difficulty expert); src/sim/infra/disasters.ts and emergency.ts (the multipliers only,
  minimal hunks); new tests under tests/sim/.
  Not owned: META's parts wait for the cloud's META chain. These are the New City dialog's rule lines
  (src/region/NewCityDialog.ts), the Expert badge (RegionScreen.ts), the TopBar difficulty label and the removal
  screen. Make the sim side complete and give the UI a state or event to read. List every UI label site that must
  learn 'expert' (file:line).
do:
  docs/POLISH_PLAN.md LG-09 (line 1335) in full, and FH-04 (line 1211) with its DIFFICULTY_RULES as merged.
  - Hard:
    - OPEX_PER_SERVED ×1.15;
    - a tax approval penalty of −4.5 per point (Medium −3.5);
    - disasters ×1.5, on the threshold of the same single monthly draw (no new draw);
    - after 12 months bankrupt, the sim marks the mayor removed: a systemData flag plus a news item with a ref, or an
      event the host forwards. Choose what fits the W0 paths, and say why. Restore (NEW-03) is not available yet, so
      the UI request lists it.
  - Expert: Hard, plus no new loans after year 5 (counted from systemData.foundedDay), disasters ×3 and manual-dispatch
    windows ×0.75.
  - Easy keeps FH-04's rules. Medium stays bit-identical.
gates:
  - tsc; the full vitest.
  - The 128x15 s7 Medium bot is identical (192,899). Medium's two-process hashes are bit-identical on 256x60 s7 and s11,
    checked as FH-04 did (docs/dev/reports/local-FH-04-easy.md).
  - Hard 128x15 s7: in every year 2010-15, funds ≤ 0.5× Medium or population ≤ 0.9× Medium. The lowest daily balance
    stays ≥ 0, using loans.
  - Unit tests: a forced 12-month deficit sets the removal flag on Expert and on Hard; Expert takes no loan after year 5.
  - Old saves load and continue: no 'expert', no streak key.
report: docs/dev/reports/local-T042-lg09-difficulty.md: the rule table, the Hard vs Medium yearly table, the UI
  requests. Push local/T042-lg09-difficulty with docs/dev/queue/T042-lg09-difficulty-rules.done, marked "holds for B2".
