# local-T081-readme

Docs-only work on `local/T081-readme`, based on `146c885` plus the committed task file. Committed in b725acd.

## Files

- `README.md`: new playable-build README. Covers setup/build, tested requirements, play, controls, settings, URL options, save/export and known limits. Four release values remain placeholders.
- `docs/dev/reports/local-T081-readme.md`: this required report and source map.
- No separate `docs/BUILD.md` was needed: the short build instructions fit in the README.
- No source, test, tool or infra files changed. No hunks outside the task's named README/report paths. No cloud-held file requests.

## References read

Read the committed `docs/dev/queue/T081-readme.md`, `docs/POLISH_PLAN.md` §7.2–§7.4 in full, and `docs/WORKER_DESIGN.md`, including host selection and the W1.2–W1.4 migration rows. No `AGENTS.md` or `CLAUDE.md` was found in the repository or its applicable ancestor directories.

The README follows the code rather than future controls listed in the plan. Source references below are paths and line locations in this worktree unless marked as origin; functions are included where useful. The review fix round below records additions checked against origin without merging.

## Sources by README section

| Section | Sources and supported facts |
| --- | --- |
| Metropolis | `package.json:2,6–29`: project name, TypeScript/Vite/three.js; `src/ui/Modals.ts:233–237`: zoning, demand, utilities, services and budget. No release version copied from the development package version. |
| Run locally | `package.json:6–12`: exact npm scripts; `package-lock.json`, `packages["node_modules/vite"].engines` and `packages["node_modules/vitest"].engines`: Node range intersection; committed lockfile supports `npm ci`; `vite.config.ts:7–8`: relative base and development port 5173. |
| Build | `package.json:8–10`: build is `tsc --noEmit && vite build`, preview is `vite preview`, typecheck is `tsc --noEmit`; `vite.config.ts:7,11–20`: relative paths, ES2022 target and main/gallery inputs, no custom output directory. Installed Vite's `node_modules/vite/dist/node/chunks/node.js` build defaults and CLI confirm `dist`; `docs/WORKER_DESIGN.md` §1.4 describes the static build. `wasm/README.md` Layout/Build: committed binary, Rust only needed to rebuild it. |
| Requirements and tested systems | `src/region/RegionView.ts:90`, `src/render/world/WorldView.ts:255`: WebGL renderers; `docs/dev/POLISH_BACKLOG.md:70` and `docs/dev/reports/local-T017-playtest-c4.md:209,265`: WebGL2 required, missing-WebGL2 loader problem. `docs/dev/reports/local-T003-gpu-smoke.md:10–16`: Chromium 141, Windows 10, RTX 5070 Ti, ANGLE/D3D11 and accelerated GPU checks. `docs/dev/reports/local-W1.2-worker.md:229`: Chromium 153 with SwiftShader for functional QA. `src/render/world/quality.ts:2–5`: Low targets integrated GPUs; `docs/WASM_PLAN.md:581–584,652`: laptop reference target is not tested minimum hardware, Firefox/WebKit untested. No new hardware minimum or cross-browser certification claimed. |
| Playing: region and start | `src/region/types.ts:10–11,78–79`: tile sizes; `src/region/RegionScreen.ts` tile selection/found/play UI; `src/region/regionEffects.ts:2–16,177–200`: neighbor jobs/workers; `src/game/CityScene.ts:197–202`: empty/new city starts paused; `src/ui/Modals.ts:148–244`: Help and guide button. |
| Playing: systems and emergencies | `src/ui/Modals.ts:233–237`: growable zones, demand, utilities and services; `src/ui/panels/EmergenciesPanel.ts:145,156–157,248`: automatic driving-reach response and manual dispatch; `src/ui/EmergencyBanner.ts:718–730,753`: Send nearest, Choose station and `dispatchBest`. |
| Playing: soundtrack | `src/audio/AudioEngine.ts:2,18–25`: procedural Web Audio, playback/track controls; `src/audio/music/director.ts:2–8`: context-aware music; `src/ui/MusicPlayer.ts`: player; `src/ui/panels/SettingsPanel.ts:149–154`: track list and pop-ups. No track-count or duration claim. |
| Playing: fireworks and large cities | `src/game/NewYear.ts:2–27,291–324`: January 1 celebration and show pacing; `src/sim/economy/rewards.ts:31–32`: Megacity at 1M and Megalopolis at 1.5M; `docs/dev/reports/local-T005-pi1-baseline.md:35–39`: prior million-plus city fixtures. These populations describe features, not release performance results. |
| Playing: difficulty | `src/core/types.ts:85`, `src/region/NewCityDialog.ts:116–125`: Easy/Medium/Hard/Sandbox; `src/sim/config.ts:33–38`: starting funds; `src/sim/economy/tuning.ts:583–590`, `difficultyRules`: Easy's more forgiving first years and income, Medium balance, Hard's lower income, Sandbox; `src/region/NewCityDialog.ts` disasters toggle. No Expert claim. |
| City controls | Complete key/input map below. `src/ui/Modals.ts:148–208` is the in-game help; actual handlers add details and take precedence where the help is shorter. |
| Settings | Complete exposed-setting map below. `src/game/settings.ts:121,137–160` and `src/region/settings.ts:58,100–117,139–144` persist browser-local settings. Title-screen Settings: `src/region/ui/dialogs.ts:17–99`. |
| URL options | Complete URL map below. Only actual game-entry switches are listed; demo-page `quality`, `fps`, `fallback` switches are not presented as game options. |
| Saving and export | `src/game/CityScene.ts:959–963,1031–1034`: save key and monthly autosave; `src/ui/Modals.ts:32–37`: Save city / Save & exit; `src/region/ui/SaveStatus.ts:22–24`: clickable indicator; `src/main.ts:245–250,273–277` and recovery methods: hidden saves and recovery offers. `src/save/index.ts:2–9,82–122`: local IndexedDB region/city saves, whole-region export, default new ID on import collision; `src/region/RegionScreen.ts:125–126,389–405` and `src/region/ui/dialogs.ts` Load Region: Export/Import/Import file UI. |
| Known limits | WebGL2 issue: backlog/playtest above. `src/save/db.ts:2–5,77–79,127–143`, `src/main.ts:273–274`: memory fallback lost on reload. IndexedDB is local browser storage; export copies the saved records (`src/save/index.ts:82–98`). `src/save/bundle.ts:14–23`: optional gzip export and DecompressionStream requirement for compressed import. `docs/WORKER_DESIGN.md` W1.2 row and `src/main.ts` worker snapshot paths: current opt-in recovery does not promise W1.3's edit journal. `docs/dev/STATUS.md:14`, `src/game/emergencyPolicy.ts` speed policy: large cities can repeatedly enter LIVE; SettingsPanel offers Keep going. Graphics resource tradeoffs: `src/render/world/quality.ts`. Pending controls: `src/region/settings.ts:25–31` and absent rows in SettingsPanel; see differences below. |
| Release measurements | Placeholders only. Historical performance, soak and size measurements are deliberately not promoted to final release numbers. |

## Every documented key and input

| README input | Actual source |
| --- | --- |
| W/A/S/D, arrows | `src/render/world/CameraController.ts:371–385,465–477`; physical `KeyboardEvent.code` positions. |
| Middle-drag, Shift+right-drag, right-drag | `src/render/world/CameraController.ts:263–277`. |
| Q/E, Page Up/Down, Home | `src/render/world/CameraController.ts:382–392,479–481`; city rotate step is 90 degrees. |
| Wheel, + / - including keypad zoom | `src/render/world/CameraController.ts:349–356,382,482–483`; terrain/tree brush override `src/game/tools/BrushTool.ts:114–127` handles main-row `Equal`/`Minus` only; `src/game/toolCatalog.ts:219` makes Plant trees a BrushTool. Numeric keypad + / - still zooms. |
| Query click / left-drag | `src/game/tools/QueryTool.ts:111–138`: inspect or pan. |
| Build click / drag | `src/game/tools/ToolController.ts:45–62,95–98`, `src/game/tools/PlopTool.ts`, `ZoneTool.ts`, `NetworkTool.ts`: pointer forwarding to placement/area/path tools. |
| Space; 1/2/3 and numeric keypad | `src/game/CityScene.ts:967–981`; normal/fast/ultra also listed in `src/ui/Modals.ts:152–153`. |
| Ctrl+S / Cmd+S | `src/game/CityScene.ts:959–963`. |
| F1 / ?; guide button | `src/game/CityScene.ts:953–956`; `src/ui/Modals.ts:240–244`. F1 opens Help; the button opens the guide. |
| Esc | `src/game/CityScene.ts:919–950`: cancel drag, flyout, popover, top panel, tool, then pause menu; one fresh press per step. |
| R/C/I/T/L/U/X/B/V/K | `src/game/toolCatalog.ts:236–247` `HOTKEY_CYCLES`; dispatch in `src/game/CityScene.ts:988–1000`. |
| Delete / Backspace | `src/game/CityScene.ts:983–986`. |
| R / Shift+R while placing | `src/game/tools/PlopTool.ts:360–367`; tool handler runs before the global hotkey (`CityScene.ts:926`). |
| Shift road corner | `src/game/tools/NetworkTool.ts:227–231`. |
| [ / ] brush size | `src/game/tools/BrushTool.ts:114–127`. |
| Right-click cancel drag | `src/game/tools/ToolController.ts:48–50,68–80`. Does not claim a universal right-click deselect. |
| M/G/J/N/O/Y/P panels | `src/game/toolCatalog.ts:250–257` `PANEL_HOTKEYS`; `src/game/CityScene.ts:1001–1004`. |
| Text-field behavior and letter-key distinction | `src/game/CityScene.ts:915–916,988–990`; `src/render/world/CameraController.ts:371–380`; `src/ui/Modals.ts:245`. |
| Region left/right drag, arrows, wheel, Q/E 45 degrees, Home, tile click/double-click, Esc | `src/region/RegionView.ts:154–190,202–206`; origin `src/region/RegionScreen.ts:59–63,101`: Esc deselects, double-click plays a city or opens founding on an empty writable tile. These differ from city camera controls. |

## Every documented setting

| README control or default | Actual source |
| --- | --- |
| Settings entry points; title/region Play music, Mute all and Default quality | Origin `src/region/RegionScreen.ts:136`, `src/ui/TopBar.ts:394–395`, `src/ui/Modals.ts` pause-menu Settings, `src/region/ui/dialogs.ts:17–99`: gear buttons, pause menu and title/region settings dialog. `dialogs.ts:35,49` names Play music, Mute all and Default quality. |
| Low/Medium/High/Ultra, day/night, fixed hour | `src/ui/panels/SettingsPanel.ts:49–61,81–85`; defaults `src/game/settings.ts:85–88`. |
| First-run quality choice | `src/region/settings.ts:124–136` `applyFirstRunQuality`; `src/render/world/quality.ts:167–173` `detectQuality`. No GPU benchmark or guaranteed FPS claimed. |
| Autosave Off / 3 mo / 6 mo / yearly | `src/ui/panels/SettingsPanel.ts:64,87`; app default 3 in `src/region/settings.ts:62–64`, passed through `cityOverrides` and CityScene settings. |
| Pause when hidden | `src/ui/panels/SettingsPanel.ts:91`; `src/game/CityScene.ts:1016–1027`. |
| New Year Cinematic / Fireworks / Off; Milestones / Every year; show camera | `src/ui/panels/SettingsPanel.ts:61–63,88–90`; `src/game/NewYear.ts:291–324`. |
| Emergency Live speed / Pause / Keep going; Major / All; slowdown from normal speed to 5 times slower | `src/ui/panels/SettingsPanel.ts:93–95` labels the low end `Normal 1x`; types/defaults in `src/game/settings.ts:74,105–107`; policy in `src/game/emergencyPolicy.ts`. |
| Edge scrolling; building grid | `src/ui/panels/SettingsPanel.ts:97–98`; `src/game/CityScene.ts:1301–1302`. |
| UI scale 70–150%; notifications; FPS | `src/ui/panels/SettingsPanel.ts:100–102`; `src/region/settings.ts:23` `UI_SCALE`; `src/game/CityScene.ts:1304–1306`; notifications setting read in `src/ui/Notifications.ts`. |
| Master/music/effects/ambience volumes | `src/ui/panels/SettingsPanel.ts:104–107`; `src/game/CityScene.ts:1288–1307` `applySettings`. |
| Music pauses; background mute | `src/ui/panels/SettingsPanel.ts:108–115`. |
| Interface/hover sounds; now-playing pop-ups; player and track list | `src/ui/panels/SettingsPanel.ts:149–154`, `buildAudioExtras`; `src/ui/MusicPlayer.ts`; `src/audio/AudioEngine.ts`. |
| Pending key rebinding, text size, motion, colour vision | Schema in `src/game/settings.ts:45–70`; `src/region/settings.ts:25–31` `A11Y_WIRED` flags are all false; gated UI `src/region/ui/dialogs.ts:127,141,159`; no rebinding control in SettingsPanel. These are expressly described as pending. |

## Every documented URL option

| README option | Actual source |
| --- | --- |
| `simworker=1`; boot fallback | `src/main.ts:154–157` and worker boot/fallback path; W1.2/W1.4 in `docs/WORKER_DESIGN.md` §6. |
| `simworker=0`; default main | `src/main.ts:155` exact equality to `1`; `src/game/CityScene.ts:201` otherwise selects local unless loopback. |
| `simworker=loopback` | `src/game/CityScene.ts:201`. |
| `simwasm=blur:auto`, `simwasm=js` | `src/wasm/simWasm.ts:120–144,166–170,173–208,235–242` parser/page flag and per-kernel auto preference; `src/wasm/simWasm.ts:106,239` blur JS default; `src/wasm/simWasm.ts:484–508` `KernelSlot.recompute`: auto returns the available WASM instance or null for the JS fallback; forced WASM throws when unavailable. `src/worker/SimCore.ts:35,79` page flag initialization; `src/wasm/kernels/blur.ts` binding. |
| `quickstart=1`; `size`, `seed`, `difficulty`, `terrain`, `climate` | `src/main.ts:265,1006–1031`. Size aliases are in its mapping. `terrain=region` leaves the tile-derived terrain. `deleteRegion('quickstart')` at line 1013 supports the adjacent reload warning. |
| `region=1`, `newcity=1`; `preset`, `seed`, `demo=1`, `cities` | `src/main.ts:266,979–1003`. `deleteRegion(id)` at line 985 supports the adjacent reload warning. |
| Difficulty/terrain/climate values, preset IDs | `src/core/types.ts:83–85`; `src/region/types.ts:7`; `src/region/RegionModel.ts:37–45`. |

The parser also accepts broader WASM preference forms. The README gives only the JS selection and the blur auto opt-in with fallback. Forced `blur:wasm` has no fallback and is not offered to players. `simdev=1` is a worker audit/protector switch for QA (`src/main.ts:156–157`), so it is not offered as a player setting.

## Review fix round

Read `REVIEW-T081.md` in the supplied scratch folder in full. Applied requested minors 1, 2, 3, 5 and 6 to README/report only. These fix-round edits are uncommitted.

- Minor 1: changed the URL example and player option to `simwasm=blur:auto`, with WASM-when-ready/JS-otherwise wording; removed the forced value from the README.
- Minor 2: named the region download/upload buttons by tooltip, added Load Region's export download tooltip, all four Settings entry points, the title/region dialog's Play music / Mute all / Default quality controls, and the corrected normal-speed low end of LIVE slowdown.
- Minor 3(a–e): documented terrain and tree brush size, main-row versus numeric keypad + / -, region arrows/double-click/Esc, and used ASCII "-" for the key.
- Minor 4: Motion remains with whichever of T078 and T081 merges second; that lane updates the README Settings list and Known limits. No Motion setting or pending-limit change was made in this fix round.
- Minor 6: corrected line 3 to record the round-1 commit, `b725acd`.

For minor 5, read the following directly with `git show origin/claude/beautiful-johnson-u2jqoz:<file>`. The remote-tracking ref was `41fcecc`. No fetch, merge or source changes were made.

| Added wording | Origin evidence |
| --- | --- |
| Only one browser tab can save a region; another opens read-only | `src/region/ui/SaveStatus.ts:63–66`: "Open in another tab" and cannot-save tooltip; `src/ui/Modals.ts:34–37`: `regionSaveAccess()` disables Save city and changes the exit label to Exit to region; `src/ui/StorageDialog.ts:317–354`, `RegionStorageSession`, and `src/save/db.ts:277–292`, `regionSaveAccess` / `requireRegionSaveAccess`, enforce region ownership. |
| Autosave runs at most once a minute | `src/game/CityScene.ts:110,1041–1044,1064`: `AUTOSAVE_FLOOR_MS = 60_000`, `onMonth` checks elapsed time since the last save, and automatic save checks the same floor. |
| Storage full offers Export and Manage storage | `src/ui/StorageDialog.ts:79–85`, `showStorageError`: quota errors show those actions and the Storage full heading. |
| Keep going has a one-time first-emergency tip exception | `src/ui/EmergencyBanner.ts:746–759`, `sendSettings`: teaching enabled only while tips are on and E1a is unseen; `src/game/emergencyPolicy.ts:30–43,89–95,114,159–163`: the first lesson is latched once and holds speed at zero even when the regular policy is `ignore`. |

Other reviewed tooltip sources on the same origin ref: `src/region/RegionScreen.ts:133–136` (Export region (.metropolis), Import region file, Settings) and `src/region/ui/dialogs.ts:388–393` (Load Region's Export .metropolis file). The README now describes the release branch behavior added by T036s4/T036s5 even though this worktree's source base predates them.

Fix-round validation passed: requested-wording/source audit, independent diff review, unchanged npm commands, four release markers, local links, UTF-8 without BOM, fences, whitespace and two-file docs-only scope. `git diff --check` passed. No runtime tests, build, browser or bot were rerun; the verification below records round 1.

## TODO(release) markers

Exactly four markers in `README.md`:

1. Release version, below the introduction.
2. Frame rates with hardware/city/resolution/quality, Release measurements table.
3. Soak duration and result, same table.
4. Save and exported-region sizes, same table.

## Verification and remaining gates

- PASS: `npx tsc --noEmit` (exit 0).
- PASS: README npm command audit: `npm ci` has a committed lockfile; `dev`, `build`, `preview`, `typecheck` exist with the exact expansions above.
- PASS: static source audit for every named key, setting and URL option, including independent read-only controls and feature reviews.
- PASS: README relative links, Markdown fences, four release markers, UTF-8 without BOM and docs-only file scope checked with a short Node probe; `git diff --check` checked.
- No Vitest tests added or run. No source behavior changed; a new runtime test would not validate the documentation.
- `npm ci`, dev/preview servers and the production build were not executed. T081 explicitly permits checking scripts without running long commands; no browser, benchmark, full suite or bot was started.
- Browser rendering, audio, live dispatch, import/export and worker fallback remain for the lead. Final release frame rates, soak duration, sizes and version are unverified and remain placeholders.
- No balance acceptance run is required by this docs-only item. The user-provided seed-7 reference remains expected: residents `[61124, 93804, 37971]`, total `192899` in 2015. Medium/Hard, RNG and save formats were not changed. This is an unchanged expectation, not a new measurement.

If the lead wants the optional baseline recheck, run this from the worktree, by itself (not run here):

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 > C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T081/scratch/simbot-128x15-s7.txt
```

Expected acceptance numbers are the resident vector and total above. No 256-tile/60-year, balance-variant or two-process hash run is needed for this item.

## Plan versus current code

- T081's `#29` maps to `docs/dev/STATUS.md:16` (README + build). There is no README/build-notes item in `docs/POLISH_PLAN.md`; its Appendix item 29 concerns FEEL-18/NEW-02. The committed T081 task supplies the scope.
- `src/game/bindings.ts` does not exist. Actual handlers and the in-game `SHORTCUTS` table supply the controls. Rebinding is pending.
- POLISH_PLAN §7.5 has future settings. Current `A11Y_WIRED` flags hide text size, motion and colour vision; SettingsPanel also lacks controls for tips, camera moments, problem icons, year review, pan speed, invert orbit and key bindings. The README lists exposed controls only and calls out the pending controls above.
- WORKER_DESIGN §1.2 proposes `metropolis.simworker`/`AppSettings.simThread` precedence and a thread settings row. Those do not exist in this tree. The README describes the actual URL opt-in and default local host. It does not promise W1.3 journal recovery or W1.4 default-on behavior.
- WORKER_DESIGN §3.6 proposes the `host.liveYear` fireworks gate. `src/game/NewYear.ts:295` still uses the day-distance batch heuristic. No internal worker/fireworks guarantee is added to the README.
- `GameSettings` alone defaults autosave to 6 months, but the app's shared settings override it with 3 months. README states the normal app default.
- Expert, several long-game polish features and broad browser/GPU minimums are plans, not established current features. No release claims were made for them.

## Cloud requests and infra hunks

None. No source edits are needed for T081. The known WebGL2 loader issue and future settings/worker work stay with their existing owners.

## Browser checklist for the lead

T081 has command/key source gates, not a separate browser Acceptance list. These spot checks cover the player instructions; none was run here.

- [ ] Start dev and production preview with the README commands; inspect README links and tables in the repository viewer.
- [ ] Create a normal region/city, confirm it starts paused, open F1 Help and its guide button, exercise camera/tool/panel keys and Esc steps; check Ctrl+S/Cmd+S where applicable.
- [ ] Check region pan/rotate/zoom, tile selection, founding and returning to another saved city.
- [ ] Confirm each listed Settings row is exposed, persists after reload and matches the README; check the app's 3-month autosave default on a fresh profile.
- [ ] Handle an uncovered emergency through Send nearest and Choose station; check LIVE/Pause/Keep going behavior.
- [ ] Hear the soundtrack, use player/track/audio controls and observe New Year modes/pacing/camera.
- [ ] Open a million-plus fixture and confirm the population/rank description; record final release performance separately.
- [ ] Save/reload, export a region, import it (including an ID collision) and confirm saved cities are present; exercise the unavailable-storage warning and recovery offer.
- [ ] Opt in with `?simworker=1`, confirm worker boot/fallback; check `simworker=0`, loopback, JS and blur-WASM options separately.
- [ ] Exercise quickstart/region/newcity URLs only with disposable test data; confirm their parameters and documented recreation on reload.
- [ ] Fill the four `TODO(release)` values after final verification on the release tree.
