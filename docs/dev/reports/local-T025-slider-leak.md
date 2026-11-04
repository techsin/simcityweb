# T025 — check 4's two audit minors: the slider retention and the leakprobe positive control

Branch `local/T025-slider-leak` on `2ba03fa`, commit `2f187f0` (a Codex lane, reviewed and fixed by the local worker).

## What changed

1. **The slider retention (finding 1 of local-T017-audit-c4.md).**
   - `slider()` no longer puts a `__paint` expando on the element or hooks the city signal's abort to delete it. That
     closure kept every slider and its detached panel subtree alive until the city exited.
   - A module-level `paintFill(el)` reads `min`, `max` (default 100) and `value`. `setSlider` and BrushTool use it.
   - The element listeners keep their `{ signal }` options. Chromium does not keep elements alive through them.
2. **fakeDom fidelity.** In tests/game/fakeDom.ts, `{ signal }` options no longer keep the listener's target alive,
   as in Chromium. tests/game/sliderRetention.test.ts would have caught finding 1.
3. **The leakprobe positive control (finding 2).** Before each exit, tools/leakprobe counts CityScene and CityState
   in the city, and fails when either count is below 1. A prototype from the wrong module instance can no longer
   pass with zeroes.
4. **`--mode budget`:**
   - Budget stays open for 40+ game months per tab at speed 3, first Taxes, then Services.
   - The HTMLInputElement and DOM node counts must stay flat within ±5 %. Attached nodes and banner counts are
     recorded with them.
5. **Review fixes:**
   - a dropped CDP connection no longer masks the error;
   - `paintFill` defaults `max` to 100;
   - the header and `--help` are updated.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 151 files, 1,534 tests passed |
| The 128 × 15 seed-7 bot | unchanged, **196,101** in 2015 (UI only) |
| leakprobe `--mode fresh` (3 cycles) | **PASS**: 0 CityScene / 0 CityState after every exit |
| leakprobe `--mode persistent` | **PASS**, 0 / 0 |
| leakprobe `--mode fresh --hostile` | **PASS**, 0 / 0 |
| leakprobe `--mode persistent --hostile` | **PASS**, 0 / 0 |
| leakprobe `--mode budget` (the new browser check) | **PASS**. Taxes: inputs 23 at 20 and 40 months, nodes 1,563 → 1,571. Services: inputs 16 throughout, nodes 1,474 → 1,473. |
| The same Budget check on the base (`2ba03fa`, with this branch's leakprobe copied in) | **FAILS as it must**: HTMLInputElement 53 → 353 (+566 %) after 20.2 months on Taxes (nodes 2,103 → 7,525). That is finding 1. |
| The positive control pointed at a wrong module (`--scene-module /src/game/CityScene.ts?wrong=1`) | **trips as it must**: "in-city positive control failed: CityScene = 0 (wrong module instance?)" |

The leakprobe runs used the 101k-resident test city (small_s7_y10.region.metropolis), headless Chromium on the RTX
5070 Ti desktop, 1280 × 720, on Oct 27. The machine had no timing runs at the time.
