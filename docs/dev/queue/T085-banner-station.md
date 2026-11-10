# T085-banner-station: the emergency banner names the station Send nearest would send; E1a is seen only once it has shown its options
base: dev d83f0d0; branch local/T085-banner-station
owns: src/ui/EmergencyBanner.ts (the note's station and E1a's seen timing); the read it needs through the host
  (an existing query, watch or EmergencyView field if one already carries dispatchBest's choice; otherwise the
  smallest new field on the view, listed as a worker-protocol hunk in the report); new tests.
do (the lead's NOTE-073 items 3 and 4):
  1. The banner note can name a different station than Send nearest sends (#24 against #21 for a too-far fire in
     vet_s7_y21): src/sim/infra/emergency.ts:1897 falls back to straight-line nearest for the note, while Send nearest
     uses `dispatchBest`'s road-distance choice. The note must name the station `dispatchBest` would send, from the
     same road-distance choice. Do not change what the sim does: emergency.ts's straight-line fallback stays for the
     sim's own use, no new RNG, no change to dispatch itself. Add a test where the two used to differ.
  2. E1a (FH-08's first lesson) is marked seen when the card is built (EmergencyBanner.ts:887), before its dispatch
     options arrive. Mark it seen only once the card has shown its options, or when the player acts (Send, Got it,
     the Fire tab, closing it). A card whose options never arrive must not use the lesson up. Add tests.
notes:
  - T037a (onboarding, not in dev yet) also edits EmergencyBanner.ts: it moves FH-08's seen flags into GuideProfile and
    points the `ctx.settings.tips` reads at the profile. Keep your hunks small and local, and keep the seen-flag write
    in ONE place (a single function), so whichever lane merges second resolves one hunk.
  - src/worker/** is being changed by the cloud (W1.3, T061). If the note's station needs a new field through the
    worker protocol, keep the hunk minimal and apart, list it in the report, and make the field optional so old
    packets and old saves load.
  - The file:line references are against dev cb6ca4c; find each hunk by its identifier.
gates:
  - tsc; your new tests and the existing emergency tests (tests/game/emergency*.test.ts, tests/worker/*teaching*,
    tests/worker/hygiene.test.ts) through quietrun; the 128x15 s7 bot identical (192,899).
  - I run the full vitest, the bot and the real-GPU checks (default host, loopback, ?simworker=1); end with the
    browser checklist.
report: docs/dev/reports/local-T085-banner-station.md.
