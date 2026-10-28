# T036-polish-r1-meta: polish round 1's META lane (Codex lanes, split by file)
base: local/W0-complete when it exists; until then local/W0.3-5-integration for the parts whose files W0.6 and W0.3b
  do not touch; branch local/R1-meta (or one branch per sub-lane: local/R1-meta-<item>)
owns: the META files in docs/POLISH_PLAN.md §7.2 (src/main.ts, src/region/**, src/game/settings.ts,
  src/ui/panels/SettingsPanel.ts, src/ui/zoom.ts, src/ui/Notifications.ts, src/ui/MiniMap.ts,
  src/ui/panels/EmergenciesPanel.ts, and the new files listed there), plus META's hunks in §7.3.
do:
  Read docs/POLISH_PLAN.md §7.2-§7.5 and §8.1, and each item in full. The order and the conditions:
  1. **The settings schema first (§7.5):** every new key, with its default, in src/game/settings.ts and
     src/region/settings.ts, and the title screen's "Accessibility & interface" section. **After T008 merges:** T008
     already added `musicPauses` and `muteInBackground`, and its cloud gates run now.
  2. **FH-11** (the New City dialog and region screen that point a newcomer at a good start; the Easy blurbs come
     from FH-04's `difficultyRules`), **FEEL-05** (the spring start: a new city opens on 1 April, an old save as
     before, and the bot still founds on day 0, so its 128x15 table stays unchanged) and **FH-21** (first-run quality
     from `detectQuality()`, and the context-loss test). These can start once the schema is in.
  3. **FEEL-02a** (New Year pacing, D17), after T027 merges: T027 also edits NewYear.ts.
  4. **NEW-04** (a second tab on the same region: a Web Lock per region, D16) and **FEEL-02b's autosave floor**
     (D6; its recovery check waits for W1.3), after W0-complete: W0.6 owns the save paths.
  5. **FH-08** (the first emergency teaches dispatch), after T029 and W0.3b merge: both edit EmergencyBanner and
     EmergenciesPanel.
gates: each item's own Acceptance list in the plan; tsc; the full vitest; the bot at 196,101 (FEEL-05 must keep it);
  the item's browser checks in your slots.
report: one report per item or sub-lane, docs/dev/reports/local-R1-meta-<item>.md; push each branch with its .done
  line in docs/dev/queue/T036-polish-r1-meta.done (one line per item); DONE per item.
