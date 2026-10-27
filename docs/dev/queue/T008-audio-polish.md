# T008-audio-polish: audio mix, ambience and audio frame cost (polish round 1 FEEL-11 + FEEL-12, and the audio half of the UI frame-cost task)
base: claude/beautiful-johnson-u2jqoz HEAD when you start (record the sha); branch local/T008-audio
after: none. Runs alongside T007 (rules below); T007's gates keep priority.
owns: src/audio/** (including src/audio/music/**), src/game/GameSounds.ts, the small updateAmbience hunk in
  src/game/CityScene.ts and the ambience call in src/main.ts, the new setting keys in src/game/settings.ts and their rows in src/ui/panels/SettingsPanel.ts (plan §7.5), tests under tests/audio/**
  (new or existing). Nothing else: the sim close-out is still editing src/ui/** and other parts of src/game/**.
do:
  Why: docs/POLISH_PLAN.md decision D1 lists FEEL-11's audio parts and FEEL-12 as items that can start now (src/audio/**
  only). The render speed review found the audio half of a new required task: thousands of WebAudio node-finish tasks
  per minute on the main thread, and the music director's timers (docs/dev/reports/render2-final_verify-perf-v2.md,
  the "real path" findings). Read docs/POLISH_PLAN.md FEEL-11 and FEEL-12 (around lines 2747-2810), §7.5 (settings) and
  the perf report first.
  1. FEEL-11 without the siren sub-part (sirens wait for W0.2 and W0.5): duck(db, hold, release) with the plan's numbers,
     rests of 15-40 s between songs in the city (none in menus) with a setting, "Mute when in background" (default on:
     master gain to 0 within 1 s of the tab being hidden, engine suspended, resumed on return). The New Year duck call
     is META's (round 2): only expose the API.
  2. FEEL-12: feed the surf (9x9 water sample around the camera target every 0.5 s), month and climate into the
     ambience; the season and climate rules as written in the plan.
  3. Audio frame cost: reuse or pool the one-shot nodes so the per-sound node-finish / handler-deletion tasks drop by at
     least 90 %; cut the director's timer work while nothing new is scheduled; start the music director only after
     the loading veil has faded.
  Codex implements each part in its own worktree from your base (codex exec, sandbox limited to that worktree), from the
  plan text and the files it names; you review every diff (scope, no sim effect, readable, matches the surrounding
  style) and run the gates.
gates:
  - the plan's acceptance for FEEL-11 (except sirens) and FEEL-12, measured with tools/render-audio.mjs and the audio lab;
  - a headless real-GPU trace of the real load path (menu -> Continue, LOW): node-finish + handler-deletion tasks per
    minute and director timer ms, before vs after (same machine, interleaved, >= 5 loads each);
  - the 128x15 seed-7 bot table unchanged (194,432 in 2015): audio must not touch the sim;
  - npx tsc --noEmit clean; npx vitest run passes (the Windows-only CRLF binary.test failure excepted, as in T007).
rules: Codex lanes at below-normal priority; while a T007 timing run is going, only write code and run single test
  files (NOTE-002). Browser and audio-lab runs go between T007's timing runs.
report: docs/dev/reports/local-T008-audio.md (what changed, the acceptance numbers, the before/after trace table, what
  Codex vs you wrote); push local/T008-audio with docs/dev/queue/T008-audio-polish.done; DONE.
