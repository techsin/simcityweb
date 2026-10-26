Close-out c1: all seven items are fixed and checked with real mouse and keyboard input in the game. The main one, the exit-to-region leak, now leaves nothing behind: after each exit the old city scene, its renderer, canvas and WebGL context are all gone. That holds for both the small town and the 304k year-21 city. tsc is clean and the bot is unchanged at 194,432. Each new test fails on the old code. The full vitest run passes except 10 tests in 8 files that hit the 5 s timeout at load 21–27. Those 8 files pass when run alone.

**1. [MAJOR render] Exit to region kept the whole previous city alive** — fixed.
- **What held it:**
  - Module-level shared objects kept each old renderer reachable through three.js dispose listeners: the city, ghost, road and fade materials, the noise and wave textures, the tree impostor geometries, three's DFG lookup texture, and `hideEmpty`'s `_scan` stack.
  - The renderer's canvas was still attached to the removed scene DOM, which in turn held the CityScene.
  - With only those fixed, one renderer, canvas and context still leaked per visit. A heap snapshot showed the holders were the asset registry's tree, bush and rock geometries (`tree_oak#0`, `bush#0`, `rock#0`, …), which TreeRenderer draws directly. Plop ghosts and the power-line pylon preview use the same pattern.
- **Fix:**
  - The teardown paths now dispose those shared objects. They stay cached and upload again for the next city.
  - `WorldView.dispose` clears `_scan` and calls `forceContextLoss()`, as RegionView and MenuBackground already do.
  - `CityScene.dispose` removes the canvas before the scene root (`src/game/CityScene.ts` l.394-397).
- **src/render lines changed** (current line numbers, teardown only, nothing drawn or per-frame touched):
  - `city/CityObjectsView.ts`: l.24 and l.26 (imports), l.442-445
  - `city/buildings/BuildingRenderer.ts`: l.2469-2471
  - `city/common/cityMaterial.ts`: l.126-135 (new `releaseCityMaterials`)
  - `city/roads/roadMaterial.ts`: l.463-468 (new `releaseRoadMaterial`)
  - `city/previews/Previews.ts`: l.205-210
  - `world/TreeRenderer.ts`: l.3057-3061
  - `world/WorldView.ts`: l.27-28, l.1170-1172, l.1185-1192, l.1194-1196
  - `world/fallbackTrees.ts`: l.255-266 (new `releaseTreeGeometries`)
  - `world/textures.ts`: l.141-149 (new `releaseSharedTextures`)
- **Probe evidence** (auditor's method: forced GC, then counting live objects by type; 3 exit/re-enter cycles each):

| Run | Live CityScene (region / city) | Renderer, canvas, context in region | Region heap |
|---|---|---|---|
| Small town, before fix | 1, then 2 | 2/6/2, then 3/9/3 | 38.7 → 41.5 MB |
| Small town, after fix | 0 / 1 every cycle | 1/3/1 every cycle (same as before the first visit) | 35.0 / 35.3 / 35.2 MB |
| Big city, before fix (auditor) | grows by 1 per visit | not counted | 37.0 → 72.4 → 108.5 MB (~35 MB per visit) |
| Big city, after fix | 0 / 1 every cycle | 1/3/1 every cycle | 39.7 / 39.9 / 40.0 MB; 4th cycle 40.0 |

- **Heap snapshots:**
  - After 3 exits, nothing is reachable only through dispose listeners (0.00 MB; 0.23 MB before the last fix), and only one renderer exists (the region view's).
  - Big-city total, including external buffer data, is 167.1 MB after both cycle 3 and cycle 4.
  - The gap to the cold region screen (13 MB) is loaded code plus the model caches kept for the next visit; it stays flat across cycles.
- **Screenshots:** I looked at all of them. Before vs after fix in the small town, and first vs second visit at far and street zoom in both cities: nothing visual changed (trees, terrain texture, ponds, roads, buildings, shadows).
- **Tests:** `tests/render/exitRetention.test.ts` (5 tests) and `tests/game/cityDisposeCanvas.test.ts` (1 test). All fail on the old code.

**2. [minor sim] S4: paused roadless clinic said "works at 30%" and "Service quality 21%"** — fixed in `src/sim/infra/facilities.ts` (`roadlessBeforeStaffing`, text only).
- In game, a clinic placed while paused with no road, power or water now leads with "No road access — build a road beside it", then "No power either" and "No water either".
- It shows "Staff 0 / 30 — staffing effect −100%" with the road hint, "Serves nobody", and "Service quality 0% … no road access". "Works at 30%" is gone.
- Tests added in `tests/infra/feedbackFacilities.test.ts`.

**3. [minor sim] S4 incomplete: recycling center and parking garage** — fixed in `facilities.ts` and `src/sim/infra/transportFacilities.ts` (`transportNoRoadLead`).
- In game, a roadless unpowered Recycling Center leads with "No road access — garbage trucks cannot reach it", then "No power either". "Handles only 30%" is gone.
- A roadless unpowered Parking Garage leads with "No road access — drivers can't reach it; build a road beside it" (shown once), then "No power either".
- Tests added in the same file.

**4. [minor ui] U1: a press landed on the banner that moved under the pointer when a flyout opened** — fixed in `src/ui/EmergencyBanner.ts`.
- Presses on banner buttons are ignored for 350 ms after the stack moves, counted from when the move is first on screen.
- At 1366x650 with real clicks: opening Civic re-docked 4 full banners into 5 compact rows. The press aimed at banner 0 landed on banner 1's Jump and was ignored; the camera did not move and nothing was dispatched.
- After settling, a press on banner 0's Jump worked.
- Tests added in `tests/game/emergencyBanner.test.ts`.

**5. [optional] Stack reflowing when switching flyout tabs** — fixed in the same file: the stack keeps the bound of the tallest tab seen since the flyout opened.
- Switching Police, Fire, Health, Education, Civic, Police: the flyout top moved between 415 and 405, but the stack bottom stayed at 362 with 5 rows and no overlap.

**6. [minor ui] Disabled reward card still said "Click to select · R rotates while placing"** — fixed in `src/ui/Toolbar.ts` (`specTipFooter`).
- In game, the Military Base ("Already built") and the ruined Missile Test Range ("In ruins") tooltips have no footer. The placeable Toxic Waste Dump keeps its footer.
- Tests in `tests/game/uiCardTip.test.ts`.

**7. [minor ui/game] Dispatch hover said "1 of 1 ambulances free"** — fixed in `src/game/tools/DispatchTool.ts` (`freeUnitsText`).
- In game, a real hover now reads "Its only ambulance is free · ETA 1.9 min / Click: send it". A one-truck fire station reads "Its only fire truck is free … Click: send it".
- The year-21 city has no two-truck stations, so the "N of M / Shift-click" wording is covered only by `tests/game/dispatchBusy.test.ts`.

**Test status**
- **tsc:** clean on the current live tree.
- **Full vitest:** 106 files passed and 1 skipped. Ten tests in 8 files timed out at 5 s under heavy load; those 8 files then passed alone, 109 of 109 tests.
- **Re-run after the last render edits:** tests/render and tests/game pass (40 files, 331 tests). My 6 regression files (54 tests) also pass on the current live tree, which includes the render team's later edits; I checked that those edits add no new shared GPU objects.
- **Bot (128x15, seed 7):** 194,432, all 240 values identical. No sim code has changed since that run.

**Left open**
- **Toolbar thumbnail renderer** (`src/ui/thumbs.ts`, not changed because it is outside these items): each 15 s idle cleanup leaves its renderer and canvas reachable. The holders are the same kind of listeners, on the shared building material and the registry geometries it drew. After the UI session the city counted 8 renderers (the city's plus 7 thumbnail ones). Its GPU memory is already freed and it holds no city, so the cost is small JS per instance. Fix: dispose the geometries it drew and the shared building material before `renderer.dispose()`; only thumbnails draw that material directly.
- **Quality change mid-session:** if tree variants drop, those variants' registry geometries keep that renderer's listener until a later city disposes them. This is bounded, and the context is already freed.
- **Future shared GPU objects** must be added to the release functions or the leak comes back. `exitRetention.test.ts` only guards the current set.
- **Minor exit cost:** `Previews.dispose` builds the pylon model once at exit if the city never built one.
- **The finding said 304k residents; the HUD shows 272k.** Same "Vet y21" save the auditor used.

Everything is in `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/simB/close-fix-c1/`:
- `shots/` holds the screenshots: `vis_*` (city before/after) and `c1_*` (UI checks).
- `logs/` holds the run logs: `leak_*_small.log`, `leak_after3_big.log`, `c1_ui.log`, `dispatch2.log`, `roadless2.log`.
- `out/` holds the leak counts (`leak_*.json`) and heap snapshots (`*.heapsnapshot`).

Everything I started is closed, and I made no git changes.
