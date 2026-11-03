# T027 — FH-19 camera and keys a laptop player can use; FEEL-08 camera flights for long jumps

Branch `local/FH-19-camera`.
- **Base:** `a2578da`. Dev (`a3abb4f`, with W0-complete) is merged in, for FEEL-08's minimap hunk.
- **The lane:** `68a8c16`, a Codex lane reviewed by the local worker.
- **The minimap hunk:** written by the local worker after W0.5 landed.

## What changed

- **Keys by position (FH-19):**
  - CameraController reads keys by `e.code`, so WASD and Q/E work by position on any layout (AZERTY, Dvorak, Mac).
  - Digit and Numpad 1-3 set the speed by position, and Backspace is a bulldoze alias.
  - The character hotkeys skip the camera keys.
  - The brush resizes on Equal/Minus by position (NOTE-027).
  - The New Year cinematic hands the camera back on the camera codes.
- **Query drag:** a left drag with Query pans, and a click still inspects.
- **Camera flights (FEEL-08):**
  - `focusOn(x, z, distance, { fly: true })` flies trips over 500 m in 0.6 s + 0.25 s per km, at most 1.6 s, rising to
    max(start, end, half the trip).
  - The flight lands exactly on the target, and any input stops it.
  - The callers that fly: "Show me", news rows, toasts, emergency Jump (through `focusCell`) and now the minimap.
- **The minimap hunk:** a minimap click flies a long jump. A drag scrubs as before, so it stops any flight. A click's
  few pixels of wobble (under 4 px) do not count as a drag (`tests/game/miniMapFly.test.ts`).
- **Not in this item:**
  - the hint bar (GUIDE);
  - FEEL-08's whoosh stretch and reduced-motion fade, which wait for later APIs.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (with dev merged) | clean |
| `npx vitest run` (full, with dev merged) | **180 files passed, 1 skipped; 1,833 tests passed, 7 skipped** |
| The 128 × 15 seed-7 bot, with the action log | identical to `93069fa`, line for line (**196,101** in 2015) |
| Browser QA, FH-19 and FEEL-08's acceptance lists (headless Chromium 141, RTX 5070 Ti, 1280 × 720, against the base `4c90468`, which has the same src as `a2578da`) | **all in-scope items PASS**; the detail is below |
| Leak gate (`leakprobe --mode fresh`) | **PASS** `[[0,0],[0,0],[0,0]]` |

### Browser QA

The test cities were small_s7_y10 (128 map) and vet_s7_y21 (256 map), because a 4 km jump needs room. Keys whose code
and key disagree were sent with CDP `Input.dispatchKeyEvent`, setting code, key, windowsVirtualKeyCode and text.

| Check | Result |
|---|---|
| A 40 px left drag with Query | The camera moved 99.6 m, and no inspector opened. A click (also one with 4 px of wobble) inspects. |
| `{code:'KeyA', key:'q'}` | Pans left 495 m, with no yaw change. |
| `{code:'KeyQ', key:'a'}` | Rotates −90°; the target moves 0.1 m. |
| `{code:'Digit2', key:'é'}` | Speed 0 → 2. |
| `{code:'KeyS', key:'o'}` | Pans; Data views stay closed. |
| `{code:'Equal', key:'='}` | The terrain brush grows 3 → 4 with no zoom. Minus shrinks it, 4 → 3. |
| `{key:'Backspace'}` | Selects bulldoze. |
| New Year, `{code:'KeyW', key:'z'}` | The show camera hands back at once and never moves the camera again. |
| P-5, trackpad only | A Query drag pans, a right drag rotates, Shift+right drag pans, and the wheel and pinch zoom (the page zoom stays 1). AZERTY speeds `&` `"` `é` give 1, 3, 2. |
| A 4 km jump (a real click on an Advisors news row) | 1.596 s. The peak is 2000 m against 420 m at the end (4.76×). It lands within 0.000 m. |
| A 300 m jump | 120 frames identical to the base. |
| A drag during a flight | It stops the flight before the next frame. |
| Render otherwise unchanged | 4 fixed cameras: 0 px differ with vehicles masked. Unmasked, cars differ only by their per-load placement, which also differs between two base loads. |
| The US keys | WASD and arrows, Q/E, PageUp/PageDown, the zoom keys and Home on the camera. Space and 1-3 on speed. The tool hotkeys R C I X T L U B V K, the panel hotkeys M G J N O Y P, Delete and Escape. All as before. |

Notes:
- **The minimap hunk** came after the browser session, so it is covered by its node test, not the browser run.
- **A minor from reading the code (not run):** a ticker item calls `focusCell(x, z)` without a distance, so a 4 km
  ticker jump that starts at 1,334 m or higher peaks below 1.5× its end distance. The callers that pass a distance
  (420 m) meet the rule. Options: give the ticker's focus a distance, or raise the peak floor to 1.5× the end
  distance.
- **An interrupted flight stays at its mid-flight distance** ("any input cancels"), which is as designed.
