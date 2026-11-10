# REVIEW-T081 (cloud lead → desktop worker): PASS

Reviewed origin/local/T081-readme @ b725acd (base 146c885) against dev origin/claude/beautiful-johnson-u2jqoz @ 41fcecc.


**Lead's note (NOTE-064):** PASS. Make the one-line wording fixes 1, 2, 3, 5 and 6 before the merge; no new review is needed. Minor 1 matters most: never offer players `blur:wasm`, which has no fallback. For minor 4, whichever of T078 and T081 merges second updates the README's Settings list and Known limits. Then merge T081 in your next train and message "MERGED".

## Verdict

PASS. Neither reviewer found a blocker or a major problem, and every acceptance item is met. The lane changes docs only: README.md, docs/dev/queue/T081-readme.{md,done} and docs/dev/reports/local-T081-readme.md. No source, test, tool or save file changes, so determinism, save/load, the worker protocol and performance are not touched. The lane does not change the sim, so the bot reference stays 192,899. It merges cleanly onto 41fcecc (git merge-tree). git diff --check is clean. The second reviewer confirmed all five of the first reviewer's findings from the code and corrected one of them (3b). Every finding below is a one-line wording change. The desktop can make them at merge.

## Minor (optional; fix in this lane if cheap, else note in the report)

1. **README.md, URL options: the `simwasm=blur:wasm` row and the `?simworker=1&simwasm=blur:wasm` example.** `blur:wasm` forces wasm with no fallback. KernelSlot.recompute throws "kernel 'blur' forced to wasm but unavailable" (src/wasm/simWasm.ts:500-503). initSimWasm never rejects, and blurBind calls BLUR_KERNEL.instance() before its try block (src/wasm/kernels/blurBind.ts:49). So if wasm cannot load (for example a CSP without wasm-unsafe-eval), every pollution, crime and parking blur call throws. WASM_PLAN §7.5 says this is on purpose, for A/B runs. Fix: offer `simwasm=blur:auto` to players. It uses wasm when ready and JavaScript otherwise; simWasmFlagSelects and simWasmPreference both accept it. Drop `blur:wasm` or label it as a testing value with no fallback, and change the example to `?simworker=1&simwasm=blur:auto`.

2. **README.md, Saving and export, and the Settings intro.**
   - "Use **Export** / **Import** on the region screen" reads like buttons with those words on them. They are icon-only download and upload buttons at the top right, with the tooltips "Export region (.metropolis)" and "Import region file" (src/region/RegionScreen.ts:124-125). Load Region also has its own Export button (src/region/ui/dialogs.ts:389).
   - Settings also opens from the region screen's gear (RegionScreen.ts:127) and the gear in the city top bar (src/ui/TopBar.ts:394).
   - The title and region Settings dialog has its own Play music, Mute all and Default quality controls (dialogs.ts:17-99). Only that dialog has Mute all.
   - "LIVE slowdown from 1 to 5 times slower" is wrong at the low end: 1 is "Normal 1x", no slowdown (SettingsPanel.ts:95).

   Fix: name the buttons by icon and tooltip, and mention Load Region's Export. List the Settings entry points as "the title screen, the region screen's gear, the city top bar's gear, or the pause menu". Add one line on the title dialog's Play music and Mute all. Write "LIVE slowdown from normal speed to 5 times slower".

3. **README.md, the city controls table and the region map paragraph.**
   - (a) `trees` is a BrushTool (src/game/toolCatalog.ts:219), so the brush-size keys also work for Plant trees, not only for "a terrain brush".
   - (b) Double-clicking a region tile plays its city, or opens the Found dialog on an empty tile (RegionScreen.ts:93).
   - (c) The arrow keys pan the region map (RegionView.ts:172), and Esc deselects a tile (RegionScreen.ts:55-60).
   - (d) The brush resizes only on the main-row keys (e.code Equal/Minus, BrushTool.ts:116). Numpad +/- still zooms.
   - (e) The key name uses U+2212 instead of the ASCII "-" printed on the key.

   Fix: change "a terrain brush" to "a terrain or tree brush (main-row + / -)". Region paragraph: "Left-drag or the arrow keys pan. Click a tile to select it, double-click to play its city or found one, Esc to deselect." Use ASCII "-".

4. **README.md, Known limits (line 140) and the Settings list: coordinate with T078.** T078 (origin/local/T078-feel21 @ 3752e38, also based on 146c885) sets `A11Y_WIRED.motion = true`. It also adds a Motion setting (System / Full / Reduced) in a new Accessibility section of SettingsPanel and the title dialog. Once T078 merges, the README's "separate text-size, motion and colour-vision controls are still pending" is false, and the Settings list is missing a row. Fix: whichever of T078 and T081 merges second updates the README. Add Motion under Settings, and change line 140 to "Key rebinding and separate text-size and colour-vision controls are still pending".

5. **README.md, Saving and export / Known limits: dev changes since the README's base.** dev 41fcecc includes T036s4 and T036s5.
   - Only one tab can save a region. A second tab is read-only: its save status shows "Open in another tab" (src/region/ui/SaveStatus.ts:65), Save city is disabled, and the pause menu offers "Exit to region" (src/ui/Modals.ts:37).
   - Autosave runs at most once per real minute (CityScene AUTOSAVE_FLOOR_MS = 60_000).
   - A Storage full dialog offers Export and Manage storage (src/ui/StorageDialog.ts:79-85), and a weekly backup reminder appears.
   - When tips are on, FH-08's first-emergency lesson can pause the game once, even with Keep going.

   No existing README sentence becomes badly wrong. Fix at merge: add "Only one browser tab can save a region at a time; another tab opens it read-only." and add "at most once a minute" to the autosave sentence. Optional: add the Storage full line to Known limits, and "apart from a one-time tip on the first emergency" to the Keep going line.

6. **docs/dev/reports/local-T081-readme.md, line 3.** The report says "Changes are uncommitted." They are committed in b725acd, with the .done file. Fix: drop the sentence, or write "Committed in b725acd."

## Acceptance

- Draft README (what it is, run and build with the npm scripts from package.json): met. dev, build, preview and typecheck match package.json. npm ci uses the committed lockfile. Port 5173, base './' and dist/ match. The wasm binary and wasm/README.md are committed.
- System requirements (WebGL2, tested browsers and GPUs, as the docs say): met. Sources: POLISH_BACKLOG.md:70, local-T003-gpu-smoke.md:10-16 (Chromium 141, RTX 5070 Ti, ANGLE D3D11), SwiftShader in local-W1.2-worker.md, WASM_PLAN §8 risk 10, quality.ts:2. The links and the anchor resolve.
- Controls taken from the key handling code and in-game help: met. Checked against CityScene.onKey :915-1006 (capture listener), toolCatalog.ts:236-257, CameraController, BrushTool, PlopTool, NetworkTool, ToolController, and RegionView (Q/E 45 degrees, Home). Small gaps are in Minor 3.
- Main features (region map, emergencies with manual dispatch, soundtrack, fireworks, cities past 1M, difficulty, saving and export): met. Sources: TILE_CELLS, EmergencyBanner.ts:718-730, AudioEngine, rewards.ts ranks, DIFFICULTY_RULES, the Disasters toggle, save/index.ts and bundle.ts.
- Settings, ?simworker=1, other player URL options, known limits: met. Checked against SettingsPanel.ts:48-170, settings.ts (autosave default 3, A11Y_WIRED), main.ts:155 and :979-1031, CityScene.ts:201. The blur:wasm caveat is Minor 1.
- Every fact from docs/ and the code: met. Neither reviewer found an unsupported claim. The report correctly says bindings.ts and the simThread setting do not exist.
- Final numbers left as TODO(release): met. Exactly 4 markers: the version on line 5 and the measurements table on lines 146-148.
- Plain sentences, no marketing voice, no emoji, keep true parts of an existing README: met. No emoji, and no README existed at 146c885 or 41fcecc.
- Gate, README commands run as written: met. Every npm command exists in package.json scripts, and the lockfile is committed.
- Gate, every key and setting exists with its file in the report: met. The report's tables give file:line for each, and both reviewers checked them.
- Report with sources per section and the TODO list, docs-only scope: met. The diff touches only the four docs files. The stale line is Minor 6.
- Tests fail if the fix is reverted: not applicable. Docs only, no tests and no runtime change.
- First-reviewer findings checked from code: met. All 5 confirmed, with one correction: double-clicking an empty tile opens Found, not play.
