# T048-feel10-outcomes: polish round 2, WORLD, FEEL-10 emergency outcomes and LIVE mode that feel urgent
base: fb1531f (dev); branch local/T048-feel10-outcomes
after: none (FEEL-11's duck API is AudioEngine.duck). Keep the EmergencyBanner.ts hunk small and in its own commit
  (NOTE-046 Q3).
owns: src/game/GameSounds.ts (onEmergency: WORLD's part, not the milestone hunk); src/audio/sfx.ts (the two stings);
  new src/ui/fx.css (WORLD's style file); src/ui/EmergencyBanner.ts (WORLD's round-2 hunk: the restore toast's silent
  flag, the flash class); new tests under tests/audio or tests/game.
do:
  docs/POLISH_PLAN.md FEEL-10 (line 1124) in full, and FEEL-11's duck API as merged.
  - Outcome stings:
    - a "saved" sting (0.8 s, bright) when an incident the player dispatched resolves with no losses;
    - a low "lost" sting on a failure or losses;
    - at most 1 sting per 10 s;
    - the banner flashes green or red for 600 ms;
    - the restore toast is silent when a sting just played.
  - LIVE mode:
    - a 3 % red edge vignette (CSS on .mp-ui.emg-live in src/ui/fx.css);
    - the music drops 6 dB through AudioEngine.duck;
    - both release 0.5 s after LIVE ends;
    - with reduced motion, the vignette does not pulse.
  - A debug getter for the music bus gain, for the acceptance.
  - Outcomes come from the host (EmergencyView, host.cause), never from sim reads.
gates:
  - tsc; the full vitest; the hygiene test; the bot identical.
  - Unit tests: one "saved" sting and no second chime on a resolved player dispatch; "lost" on a failed alert; the rate
    limit; the duck depth of 6 ± 1 dB during LIVE (debug getter); the vignette class present exactly while the LIVE
    pill shows.
  - Browser, real GPU (the worker): replay the Refinery dispatch; a failed alert; LIVE on and off, with vignette
    screenshots.
report: docs/dev/reports/local-T048-feel10-outcomes.md. Push local/T048-feel10-outcomes with
  docs/dev/queue/T048-feel10-outcomes.done.
