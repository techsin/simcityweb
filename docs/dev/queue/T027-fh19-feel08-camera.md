# T027-fh19-feel08-camera: polish FH-19 (keys by code, drag-to-pan with Query) and FEEL-08 (camera flights); a Codex lane
base: a2578da (dev; record it); branch local/FH-19-camera
after: none. FEEL-08's minimap hunk waits for W0.5, which rewrites MiniMap.ts. Do everything else now, and add that
  one hunk after I say W0.5 is merged.
owns: src/render/world/CameraController.ts, src/render/contracts.ts (FEEL-08's option), and three small WORLD hunks:
  src/game/CityScene.ts (onKey speed keys, Backspace and the hotkey skip, consume's camera-key check, focusCell) and
  src/game/tools/QueryTool.ts (down/up for the drag). The W0.3-W0.5 lanes also edit CityScene.ts and possibly
  QueryTool.ts, so keep these hunks minimal and say exactly which lines you touched. I merge them in order.
do:
  Read docs/POLISH_PLAN.md FH-19 (around line 2370) and FEEL-08 (around line 2412) in full.
  - FH-19: keys by `code` (layout-independent pans and rotations), speed keys by code, Backspace and the hotkey skip
    as the plan says, and a left drag with Query pans the camera instead of doing nothing (a click still inspects).
  - FEEL-08: long jumps (minimap, Go to) fly. They rise and travel, and a drag stops them.
gates: FH-19's acceptance list verbatim (the 40 px Query drag, KeyA with key q pans and does not rotate, KeyQ with key a
  rotates, Digit2 with key é sets speed 2, and the rest of the plan's list); FEEL-08's list (a 4 km jump takes
  1.2-1.6 s, its peak distance is at least 1.5x the end distance, and it ends within 1 % of the target; a 300 m jump
  behaves as today; a drag during a flight stops it within one frame). Check them in the browser on the real GPU
  with real input, and add unit tests where the controller allows. npx tsc --noEmit clean; npx vitest run passes;
  render is unchanged otherwise (screenshots of fixed cameras identical).
report: docs/dev/reports/local-FH-19-camera.md; push local/FH-19-camera with docs/dev/queue/T027-fh19-feel08-camera.done
  (after the minimap hunk); DONE.
