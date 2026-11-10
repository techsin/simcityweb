# T084: the 4 s stall at the first dusk: the sun light is never hidden (NOTE-073 item 2)

Branch `local/T084-nightfall-stall` on `24c38d66` (dev `825ee224` plus the task file). The changes are uncommitted, as
the lane rules ask. No browser was run: `tools/qa-nightfall.mjs` has not met a real browser (its page-side probe and
its verdicts are unit-tested, and its runner ran against stand-ins of playwright and vite, see below).

## The change

`src/render/world/WorldView.ts` (+21 −8), the sun light's visibility and the shadow policy only:

- **`update()`**: `this.sun.visible` is no longer written, so the light stays visible. With
  `const lit = L.lightIntensity > 0.002`, `this.sun.intensity = lit ? L.lightIntensity : 0`, and `lit` is kept in the
  new private field `sunLit` (documented at the field: why the light must stay in three's light state).
- **The shadow invalidation** on a change of that state reads `lit` (the tracker `shSunVisible` is now `shSunLit`).
- **`updateShadowPolicy()`**: `if (!this.sunLit || !sun.castShadow || !sm.enabled)`: no shadow map render while the
  light is off, as before.
- Two more places relied on three skipping a hidden light, so they now ask the field:
  - the `shadowCache = false` branch set `sm.autoUpdate = true` and left the rest to three. It now sets
    `sm.autoUpdate = this.sunLit` (and clears `needsUpdate` while off);
  - `capture()` set `shadowMap.needsUpdate = true`. It now sets it to `this.sunLit`, so a thumbnail taken in those
    minutes renders no shadow map (it would shade nothing).
- `castShadow` and `renderer.shadowMap.enabled` were already set once (constructor); nothing writes them by time of day.

Readers of `sun.visible` in `src/`: the three in WorldView.ts, all changed; none elsewhere (`world.sun` has no reader
outside WorldView either). Other lights shown or hidden by time of day: none. `nightFill` (the hemisphere fill) only
changes intensity and colour; the moon is the same `CitySun`; the city renderers add no three.js lights
(FallbackWorldView, demoWorld, the gallery and the thumbnail renderer have their own, never hidden).

Why the picture is the same: with intensity 0 three uploads the light's colour as (0, 0, 0), so `RE_Direct` adds exactly
0 to every lit material, shadowed or not. The custom shaders do not read three's light arrays or its shadow map
(`uSunColor` / `uSunDir` are our own uniforms and are set as before, from the rig's intensity). While the light is on,
nothing changed.

## The test: `tests/render/nightfall.test.ts` (new, 11 cases)

A real `WorldView` (its constructor, sky, light rig, `update()` and `render()`) on a stand-in `WebGLRenderer` with no GL
context (`vi.mock('three')` replaces `WebGLRenderer` and `PMREMGenerator` only). Each scene render is taken the way
three r186 takes it: the lights of visible objects on the camera's layers (`projectObject`), three's own `WebGLLights`
state and three's own `WebGLPrograms.getParameters` / `getProgramCacheKey` (imported from `three/src`, as
`terrainRectsHarness.ts` does with other internals), and `WebGLShadowMap.render`'s early-outs for the shadow pass.

| Case | What it holds |
|---|---|
| `low` / `medium` / `high` / `ultra`: two days of the view's clock never change three's light state or a program cache key (4 cases) | 5,760 frames each at the game's pace (half a game minute a frame), through dusk and dawn twice (light off 19:12-19:13 and 06:05-06:17 on day 0). At every frame: `sun.visible`, `castShadow`, `shadowMap.enabled` true; one directional light in the state; the same `WebGLLights` version and counts; the same cache keys for a lit and an unlit probe material; in the frames with the light off, the first after, and every 480th, the same key for every material in the scene (11 on low and on high). While off: `sun.intensity` is exactly 0 and no shadow pass runs; the first frame it is on again re-renders the map |
| a view that starts in the handover has the same light state from its first frame | `timeOfDay: 19.21` (a city entered, or a context restored, in those minutes): the first frame already has the sun in the light state |
| without the shadow cache three renders the map itself, but not while the light is off | `shadowCache = false` through dusk: a shadow pass in exactly the lit frames |
| a capture while the light is off renders no shadow map; one while it is on does | `capture()` top-down and in view, on low and high |
| tools/qa-nightfall.mjs: reads its windows and hours | `parseWindows`, `hhmm` |
| …: passes the view as it is | the tool's page-side probe and verdicts on the same view, 60 fps frames driven by hand through 18:50-20:10 and 05:00-06:30: 11 checks, all pass |
| …: fails the view as it was | the sun light hidden again from outside while the light is off, and a frame held 400 ms for every program three then links: the probe reports `2 -> 4` programs at 19:12 in an 817 ms frame, and the frame, program-count and light-state checks fail |
| …: a window may cross midnight; a clock that does not run times it out | 23:50-00:10; a held clock (`timeScale` 0) |

**Negative control** (HEAD's `WorldView.ts` put back, then the fix restored, checked by hash): 8 of the 11 fail. The
four two-day cases fail on `sun.visible` being `[true, false]`. An earlier form of the test, which compared the scene's
keys first, listed on the old code the materials whose key changes at 19:12: terrain, terrain-outer, water, the tree
materials and a ShaderMaterial, 7 on low and 10 on high, with `shadowMapEnabled true` becoming `false` and the
directional light count (the sun light count on the cascaded qualities) going from 1 to 0: the picture the
investigation's GL log gives. The three that pass on the old code are "reads its windows and hours", "fails the view as
it was" and the midnight case. Logs: scratch `nightfall-negative-control-final.log`, `nightfall-old-1.log`.

## The QA tool (unrun): `tools/qa-nightfall.mjs`

`node tools/qa-nightfall.mjs [--gpu] [--host default|worker|loopback] [--prod] ...` (the file's head lists every
option). Its own Vite dev server on a free port (or `--prod`: vite build and preview; or `--url`), Chromium on a
**fresh profile in the temp folder for every run** (`launchPersistentContext`, removed afterwards; `--profile` keeps
one), SwiftShader flags by default and the machine's GPU with `--gpu` (the investigation's flags). It loads a
quickstart city (`--region <file>` enters a region file's city instead), pauses the simulation, sets
`scene.world.timeOfDay` to the start of each window and lets the view's own clock run (2 game minutes a second, the
game's) through 18:50-20:10 and 05:00-06:30, one sample per animation frame. Checks:

- no frame over 250 ms (`--max-frame`). Judged when WebGL is not software; with SwiftShader every frame is slow, so the
  lengths are printed and the line reads INFO;
- `renderer.info.programs.length` does not change: inside each window, and from before the first to after the last;
- the sun light stays in three's light state (visible, `castShadow`, `shadowMap.enabled`; intensity 0 while off);
- the handover is inside each window (the direct light goes off and comes back on), else the window proves nothing;
- the real world view (no stand-in), the host kind asked for, with `--gpu` a GPU renderer string, no page errors.

It prints, per window, the frame count, median, p99 and largest frame with its hour, the program counts and the minutes
the light was off; `--out` writes every frame's length and hour as JSON.

It is three files: the runner, `tools/qa-nightfall-probe.mjs` (the page-side probe and the verdicts) and its
`.d.mts`, the way `tools/qa-worker.mjs` has `qa-worker-control.mjs`: I cannot run a browser, so the part that can run
without one is tested on a real WorldView. What ran here:

- `node --check`, `--help` and the option errors (the imports of vite, playwright and the probe resolve);
- the runner itself, end to end, against stand-ins of `playwright` and `vite` (scratch `fake/`, loaded with
  `node --import .../fake/hooks.mjs tools/qa-nightfall.mjs ...`). The stand-in page is the node process: it rebuilds
  every page function from its source, as Playwright does (so each one is self-contained), and runs a small model of
  the view's clock and light. Seven scenarios: the fixed game passes with exit 0 (dev server, `--gpu`, `--shots`,
  `--out`); the old game (sun hidden, 11 new programs and a 4 s frame at the first hidden frame) fails with exit 1
  on the frame (`4016.7 ms at 19:42`, programs `[60, 71]`), on the program count, on the light state in both windows
  and on the count before and after, with `--prod --host worker`; a SwiftShader string prints the frame line as INFO;
  `--gpu` on a SwiftShader string and a wrong host kind fail; a stand-in world view fails and stops; `--region` on a
  dev server whose page reloads once after the import imports again and passes; `--url --profile --max-frame 10`
  judges the frames with software GL and keeps the profile.

**What did not run: a real server, a real browser, a real page.** Those calls follow `qa-ticker.mjs`,
`qa-journal.mjs` (build and preview) and the investigation's `lib84.mjs` (the GPU flags, the region import by module
and, for a production build, through the title screen: that last path has not run in any form here).

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `tests/render/nightfall.test.ts` (new) | 11 passed; 8 of them fail on HEAD's WorldView.ts |
| Every test file under `tests/render` (34 existing), `tests/worker/worldResync`, `hygiene`, `qaWorkerControl`, `tests/game/graphicsFirstRun`: 38 files in 6 groups, through quietrun, `--maxWorkers=1` | 352 passed, 2 skipped, 0 failed. Among them the ones the task names: `shadows`, `cutShadows`, `lighting` (Sky's light rig), `exitRetention`, `pendingPreviews`, `freshLoad`, `seasons`, `lod` |
| The bot, 128x15 seed 7 (`npx tsx tools/simbot.ts --size 128 --years 15 --seed 7`, through quietrun) | **identical: residents [ 61124, 93804, 37971 ] = 192,899**, 2015 pop 193k (the change is render only) |

Left for the lead: the full vitest; the real-GPU checks below.

## Plan against the code

- The task's three sites were as described (`:501`, `:521-522`, `:794`). The two extra hunks above (the
  `shadowCache = false` branch and `capture()`) are in the same file and the same policy: both would otherwise have
  started rendering a shadow map for a light that is off.
- No test under `tests/render` covers PostFX on its own; the new test runs `PostFX.render` on the stand-in renderer
  as part of `WorldView.render()`.
- For the merge with T074 (overcast dims the sun and softens shadows): an overcast factor belongs on the lit branch
  (`lit ? L.lightIntensity * k : 0`; 0 times anything stays 0). Softening must stay a uniform: `shadow.radius`, or
  `shadow.intensity` (three r186 uploads it as `shadowIntensity`). Toggling `sun.castShadow`, `sun.visible` or
  `shadowMap.enabled` for weather would bring this stall back at every weather change; the new test only sees it if
  the weather acts in a default city.
- One observation outside the task, from the investigation's `f1-pinsun` run (the fix emulated, paused, 40 s): it still
  had two frames of 342 and 453 ms, 35 s in. I ran the investigation's `prof.mjs` on them: the profile has 5 and 24
  samples in those windows against a 2 ms interval, with idle and (program) time on top, so the process was mostly not
  running; it does not look like game code. If qa-nightfall reports a long frame away from the handover with the
  program count unchanged, it is probably this kind: the check's detail lists, for each long frame, its hour, whether
  the light was off and the program count before and after. (The tool also answers FH-21's slow-frame prompt in
  advance, as qa-context-loss does: the prompt offers another quality, which would change the programs.)

## Requests for cloud-held files

None.

## Not verified

- Anything in a browser: the real-GPU frame times, the A/B pictures, `?simworker=1`, the production build, and the QA
  tool against a real server, browser and page.
- The full vitest suite (I ran 39 files, listed above).
- That no frame of an unrelated cause passes 250 ms in the tool's two windows on the real GPU.

## Browser checklist (real GPU, machine quiet)

1. **qa-nightfall, default host**: `node tools/qa-nightfall.mjs --gpu --out <dir>`. Expect all checks PASS; for the
   quickstart city (founded on day 90) the light is off about 19:42-19:44 and 05:35-05:47; the program count is the
   same before, in and after both windows; the largest frame is far under 250 ms. If the bundled headless Chromium
   does not reach the GPU (the `--gpu: WebGL runs on the GPU` line fails), add `--exe <chrome.exe>` (the
   investigation's: `EXE` in lib84.mjs) or `--headed`.
2. **The simulation in the worker**: the same with `--host worker`.
3. **The production build**: `--gpu --prod`, and `--gpu --prod --host worker`.
4. **A built city**: add `--region <file>` with the investigation's city (`REGIONS.vet21` in lib84.mjs: light off
   19:12-19:13 and 06:05-06:17, about 60 programs on High, the same throughout), and `--quality ultra`, `medium`, `low`.
   With `--prod` the region goes in through the title screen's dialogs: the one path of the tool that has not run in
   any form.
5. **The tool sees the old code**: point it at a server of dev without this branch
   (`node tools/qa-nightfall.mjs --gpu --url http://127.0.0.1:<port>`). Expect FAIL on the frame (seconds, at the
   minute the light goes off), on the program count and on the light state (`SUN LIGHT HIDDEN`).
6. **The 5-minute Ultra protocol** (run84.mjs r1, default host and `--host worker`, and the production build): no gap
   of a second or more at the first dusk (255-290 s into play); `--gl 1` logs no "sun hidden" line and the program count
   stays at its start value.
7. **A/B pictures** at noon, dusk, the handover minute, night and dawn against dev: the same within the re-render
   noise (ab84.mjs measured that noise at the handover; its B0 case is this fix).
8. **A returning profile** (optional): `--profile <dir>` twice. Both runs pass; before the fix the second run hid the
   stall behind the GPU shader cache (w2 / w3 in the investigation).
