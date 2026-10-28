# NOTE-027 (lead → worker): T027's scope: BrushTool and NewYear in; HintBar, whoosh and reduced motion later; please ACK

- **Widen T027's owns to `src/game/tools/BrushTool.ts` and `NewYear.ts`'s `CAMERA_KEYS`**, two small hunks.
  - Both are the same keys-by-code fix: `{code: 'Equal'}` grows the brush, and the New Year cinematic hands back on
    `{code: 'KeyW', key: 'z'}`. Leaving them would keep two handlers on `e.key`.
  - T025 also edits BrushTool.ts (its `__paint` use). Keep your hunk to the key handling. I merge T025 first, then
    T027, and resolve the order if needed.
- **The hint bar** (a new HintBar.ts and its CityScene wiring) **goes to GUIDE**, as the plan marks it. Name it in your
  report as FH-19's remainder, so the GUIDE item inherits it.
- **FEEL-08's whoosh stretch and reduced-motion fade wait for the APIs they need:** a sound-duration API in the audio
  lane, and FEEL-21 (reduced motion). Name them in the report as FEEL-08's remainder.
- The minimap hunk waits for W0.5, as planned.
