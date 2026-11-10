# T052 report: FEEL-17, uncollected garbage shows on the street (desktop, real GPU)

**Verdict: done.** Every Acceptance line passes on the real GPU after one review round.
- Bags and bins appear at every NoGarbage lot at 300 m.
- They are all gone by +60 days of connecting a landfill, in a short and in a saturated outage.
- Nothing draws beyond 900 m.
- Real saves get +1 draw call and +0.02 to +1.53 % triangles.
- The bot is identical, and no sim file is touched.

Branch `local/T052-feel17-garbage`, base dev `fb1531f`:
- `7bfa72b`: the lane;
- `d213b45`: review round 1;
- `02d339b`: a front-edge fix from the QA's round-2 note.

## What changed

- **src/render/city/props/PropRenderer.ts:**
  - **Props:** 1-4 instanced bags or bins at the road front of each lot whose building carries `BF.NoGarbage`.
    - They are deterministic from the building id and the day: no RNG draws, no sim writes.
    - They are read from the mirrored building state.
  - **Build-up and clearing:** build-up takes 30-60 days, clearing 8-20 days.
  - **Shape:** both variants share one instanced mesh, so +1 draw call, at 28 triangles per instance.
  - **Poses:** each lot's poses are cached. Terrain is sampled once per lot state, never on a camera move.
  - **Culling:** lots are bucketed by the culler's tiles; whole tiles are rejected by the 900 m distance and the camera
    frustum before any per-lot work.
  - **Uploads:** only visible instances are written, with used-range uploads.
  - **Road side:** the bags go on the building's own front when a road runs along it, otherwise on the first edge with
    a road in the mirrored network. Rail does not count as a road.
- **src/render/city/CityObjectsView.ts:** small integration hunks.
  - The real camera and the state identity are passed in.
  - Lots are invalidated only near terrain and network event rects.
  - No new listeners.
- **src/assets/builders/prop.ts** (CONTENT's part): the bag and bin models (`garbage_pile` variants 0 and 1), promoted
  from the polish stubs in `manifest.ts`; the manifest test is updated.
- **Tests:** `tests/render/garbage.test.ts` (18), new `garbageCulling.test.ts` (16) and new `garbageCollection.test.ts`
  (1, through the real Simulation and PollutionSystem path).

**Plan difference, an acceptance-driven change.** The plan says the props "build up over 1-2 months and clear the same
way". But the sim clears its NoGarbage flag up to about 36 days after service returns (pollution.ts:747-752: ×0.65 per
12-day pass, cleared below 0.35). With a 30-60 day clear on top, the acceptance (≥ 90 % gone within 2 months of
connecting a landfill) failed on the real GPU: 45.7 % gone at +60 days after a long outage. Clearing therefore takes
its own 8-20 days. Build-up keeps 30-60.

## Gates

| Gate | Result |
|---|---|
| tsc | clean |
| Full vitest, with the fixtures (`d213b45`) | **219 files passed, 1 skipped; 2,179 tests passed, 7 skipped; 0 failing** |
| The bot, 128x15 seed 7, with the action log | **identical to dev: residents [ 61124, 93804, 37971 ] = 192,899** |
| `02d339b`'s targeted tests (garbage, garbageCulling, garbageCollection) | 35 passed |

## Real-GPU QA

- Environment: RTX 5070 Ti (driver 610.47), ANGLE D3D11, headless Chromium 141.0.7390.37, Windows 10 19045.
- Comparison base: a clean `fb1531f` export, the lane's base.
- Done by an independent QA agent, with real input and the renderer's own instance data.

| # | Acceptance | Round 1 (`7bfa72b`) | Round 2 (`d213b45`) |
|---|---|---|---|
| 1 | Bags at ≥ 90 % of NoGarbage lots at 300 m | pass: 717/717 | **pass:** 695/695, 700/700, 726/726, 719/720 (the one miss sits just past the screen edge, culled correctly). Submitted instances ≈ on-screen (104-221 vs 102-220); round 1 submitted 1,859-4,053 |
| 2 | ≥ 90 % gone within 2 months of connecting a landfill | **fail:** 86.7 % (short outage), 45.7 % (long) at +60 d | **pass:** short outage 90 % at +31 d, 100 % at +35 d; long outage 90 % at +51 d, 100 % at +54 d. The sim's flag lag was 3-34 d |
| 3 | Nothing beyond 900 m | pass | **pass:** 10 poses × low/high/ultra: 0 instances at ≥ 900 m (max 899.89 m); the submitted set equals the distance-plus-frustum set at every pose |
| 4 | +1 draw call and ≤ 5 % more triangles on a big save | pass on the real saves; **over under stress** (+27-31 % of the main pass) | **pass:** bot256_s7_y60 +0.02 to +0.79 %, vet_s7_y21 +0.19 to +0.41 %, vet_s7_y43 +0.45 to +1.53 %; +1 call each |
| 4s | Stress: vet_s7_y21 with all garbage service cut (8,611 lots, 20,964 props) | 0.8-1.0 ms main thread per moving frame; ~4,000 instances submitted | **+1.24 to +1.58 %** of the main pass at 300 m (worst pose +2.86 %); 0.08-0.15 ms per moving frame (max 0.91); 0 terrain calls; 12-21 KB uploaded per moving frame (max 57 KB) |
| – | Road side | 11 of 115 plopped civic lots had bags on a side with no road | 115/115 on a road edge; removing that road moves the bags next frame. `02d339b` puts them at the entrance when the front has a road (the QA found 7 of 104 on a side street) |
| – | Pans across tile boundaries | – | 3,466 frames of pans, an orbit, a 150-1,300 m zoom, a pan along the 900 m cut: 0 missing props, 0 culling errors; 0 shape or position mismatches in 91,446 checks |
| – | Re-flag while clearing, exit/re-enter, demolition, loopback | – | 349 re-flag cases with no jumps or stale props; 8,691 lots mature after re-entry, 0 stale; the sim, the replica and the renderer agree (2,560 active lots on `?simworker=loopback`) |
| – | Errors | none | none; console output matches `fb1531f` |

Notes, not blocking:
- When the visible set changes, the whole visible list is re-uploaded, at ≤ 57 KB per frame in a dense 300 m view.
- Lots still flagged during the sim's lag keep growing for a few days after a connection: +4.5 % instances over the
  first 15 days of the short case. The deadline is still met.

Node CPU probe: a repack costs 0.034 ms median at 8,600 lots and 0.034 ms at 20,000 lots (Node 22.12, synthetic grid).

## Evidence (`docs/dev/reports/local-T052/`)

- `clear-short-curve.csv`, `clear-long-curve.csv`: props vs days after the landfill connects (round 2);
- `r2-s1-stress-300m-vet21.jpg`: the stress city at 300 m;
- `s7-crop-110m-bags-bins-on-off.jpg`: bags and bins at the kerb, with the mesh on and off in the same frame;
- `r2-s3-roadside-civic-clinic-on-off.jpg`: a plopped clinic with its bin on the road edge.

The full QA reports, with every run's data, are in the worker's scratch (`qa/T052/qa.md`, rounds 1 and 2).

## What came from Codex

- The Codex lane wrote the implementation, the review-round fixes and the tests.
- An independent Codex review found the clearing deadline, the culling and upload cost, and the reload continuity.
- The worker wrote the front-edge fix (`02d339b`), ran the gates and wrote this report. A Claude QA agent did both
  real-GPU rounds.

## Cloud carry-over (Nov 3)

The desktop is unavailable (NOTE-044), so the cloud re-checked this lane on `cloud/t052`. The branch starts from
`local/T052-feel17-garbage` (`25efa67`) and merges dev `9fcc2ec`. This is a verification step, not new feature work.
WebGL here runs on SwiftShader, so the browser checks below cover function and visuals only. Every GPU timing figure
above is the desktop's.

### Gap list (written before the work)

Sources: the task file, NOTE-048 and NOTE-049 (the NOTEs that name T052), NOTE-044, POLISH_PLAN FEEL-17 in full with
its Acceptance, the report above, and the diff against dev.

| # | Required | State found | Cloud action |
|---|---|---|---|
| 1 | 1-4 instanced bags or bins at the road front of each NoGarbage lot | done (`PropRenderer.ts`) | re-test; mutation-check the tests |
| 2 | Drawn below 900 m only | done (per-prop 3D distance < 900 m; tiles are rejected first) | re-test; browser check |
| 3 | Build up over 1-2 months and clear the same way, deterministic from id and day, no RNG, no sim writes | build-up 30-60 d. **Clearing 8-20 d**, a plan difference (see the decisions) | judge the difference against FEEL-17's intent |
| 4 | Flag from the mirrored building state (events, ctx.state), never a sim read | done (CityObjectsView hooks; `resetGarbage` reads the view's own state) | **gap: no test covered the CityObjectsView hunk.** Add one |
| 5 | Two variants in one instanced mesh, +1 draw call | done (`prop.ts` `garbage_pile` v0/v1; one InstancedMesh with a variant attribute) | re-test; browser draw count |
| 6 | Unit tests: road-front placement, build-up and clearing timings, the 900 m cut | done: 35 tests in 3 files | run them; each must fail with its fix reverted |
| 7 | tsc, the full vitest, the bot identical | green on the desktop at `d213b45`/`b45aaf0` | tsc and the lane's tests here; the merge step runs the full vitest and the bot on the merged tree |
| 8 | Real GPU: ≥ 90 % at 300 m; ≥ 90 % gone within 2 months; +1 call and ≤ 5 % triangles on a big save; screenshots | passed on the desktop (RTX 5070 Ti, round 2) | cannot be re-measured here: a remaining item only if it needs re-running. Repeat the function side on SwiftShader |
| 9 | No src/sim, src/worker or save change | to confirm from the diff | confirm |
| 10 | Merge dev | not done; dev is 24 commits ahead | merge; resolve conflicts keeping both sides |
| 11 | WIP saved mid-edit (`local/T052-feel17-garbage-snap`, `da9d8b2`) | to verify | compare it line by line with the final head |
| 12 | Report, done marker | present | add this section and a done-marker line |

### What the cloud did

- **Merged dev `9fcc2ec`** (24 commits) in `db87229`. There was one conflict, in `src/render/city/CityObjectsView.ts`.
  Dev's fireworks `LaunchSiteIndex` hooks (T038) and this lane's garbage hooks sit in the same `buildingAdded` /
  `buildingChanged` handlers and in `rebuildAll`. Both sides are kept:
  - in the handlers, the index update runs first, then `garbageBuildingChanged`;
  - in `rebuildAll`, the index is rebuilt right after `buildings.rebuildAll()`, then garbage is reset and uploaded.
  Nothing of dev's was dropped. `fireworks.test.ts`'s CityObjectsView wiring case passes on the merged tree.
- **Diff against dev:** only `src/render/city/props/PropRenderer.ts`, `src/render/city/CityObjectsView.ts`, `src/assets/builders/prop.ts`, `polish_stubs.ts`, `manifest.ts`, tests and docs change. No file under src/sim, src/worker, src/save or src/game is touched, so the bot cannot change.
- **The WIP snapshot** (`local/T052-feel17-garbage-snap`, `da9d8b2`, saved mid-edit at 19:56 UTC): its src and tests
  equal `d213b45` (review round 1) exactly. The final head differs from it only by `02d339b`, the front-edge
  preference (2 lines) and its test. Nothing in the snapshot was lost or left half-done. I read the final
  `PropRenderer.ts` hunk line by line:
  - the episode state machine;
  - the ramps;
  - the road-edge choice (rail excluded);
  - the cached poses;
  - the tile and per-prop 900 m and frustum tests;
  - the used-range uploads;
  - capacity growth;
  - the session map, which is keyed on the CityState object. A load makes a new state on both hosts
    (`Simulation.replaceState`, `replica.adopt`), so a loaded city never inherits another city's episodes.
- **Gap closed: the CityObjectsView hunk had no test.** The new `tests/render/garbageView.test.ts` (1 test) drives a
  real CityObjectsView through:
  - `buildingAdded` (flagged and unflagged), `networkChanged` (the bags move from the -Z road edge to the
    building's own front), `buildingChanged` (cleared within 21 days) and `buildingRemoved`;
  - the per-frame update;
  - a same-state `reset`, and a state swap (`replaceState`, a load);
  - the stats' draw count: +1 while the mesh is shown, 0 after.
- **Mutation checks (each test must fail with its fix reverted).** Every mutation below was applied alone, the
  named files were run, and the source was restored. Each one fails at least one test:

| Mutation | Fails |
|---|---|
| clearing ramp back to 30-60 d (the review-round change) | 2: the 8-20 d clearing test; garbageCollection (the real PollutionSystem path) |
| front-edge preference removed (`02d339b` reverted) | 1: "prefers the building front" |
| per-prop cut at 901 m instead of 900 m | 3: the exact 900 m cut, the off-centre boundary, the same-tile distance refresh |
| road side ignored (model front only) | 5: the four adjacent-road-edge cases and the front-preference case |
| frustum culling off | 3: the three view-culling cases |
| rail counted as a road | 1: the rail fallback |
| build-up made instant | 3: the 1-2 month build-up, flag reversals, the 900 m cut's single-item setup |
| bags at the lot centre, not the front | 4: the four rotations of the road-front placement |
| any one of the 7 CityObjectsView hooks removed (networkChanged invalidate, buildingAdded, buildingRemoved, buildingChanged, rebuildAll reset, per-frame update, stats +1) | 7 of 7: the new wiring test fails each time |

- **The evidence images.** I looked at all three:
  - `s7-crop-110m-bags-bins-on-off.jpg`: dark bags and green lidded bins on the kerb at 110 m, gone in the
    mesh-off half of the same frame.
  - `r2-s3-roadside-civic-clinic-on-off.jpg`: one bin on the clinic's road edge, absent with the mesh off.
  - `r2-s1-stress-300m-vet21.jpg`: the 300 m stress frame. It has no on/off pair, and at this scale the props are
    a few pixels each (a 0.85 m bag is about 3 px tall at 300 m on 720p), so this image alone does not show them.
    The 300 m acceptance line was measured on the renderer's own instance data (695/695 to 719/720 lots drawn), which
    is what "bags show" asks for.
  - The CSV curves agree with the report:
    - short outage: 517 of 4,718 instances left at +30 d and 0 at +40 d (90 % gone by +31 d);
    - long outage: 738 of 6,472 left at +50 d and 0 at +60 d (90 % gone by about +51 d).

### Gates (cloud, merged tree)

| Gate | Result |
|---|---|
| tsc (sem), after the merge and again with the new test | exit 0, no output, both times |
| The lane's tests + the merge-adjacent tests (sem, `--maxWorkers=2`): garbage, garbageCulling, garbageCollection, garbageView, assets/manifest, exitRetention, fireworks | **7 files passed; 73 tests passed, 2 skipped.** The 2 skips are fireworks' fixture-identity cases, which need SIM_FIXTURES files that are not in this checkout. The garbage files alone: 4 files, 36 tests |
| Full vitest (lock) | **not run here.** Per this step's lock budget, the merge step runs it on the merged tree. The desktop's run: 219 files passed, 1 skipped; 2,179 tests passed, 7 skipped |
| The bot (lock) | **not run here.** Nothing under src/sim, src/worker, src/game or src/save changed, so it is identical by construction. The desktop's run: `[ 61124, 93804, 37971 ]` = 192,899, equal to dev's reference. The merge step re-runs it |
| Real-GPU acceptance (≥ 90 % at 300 m; ≥ 90 % gone within 2 months; +1 draw call and ≤ 5 % triangles on a big save; screenshots) | passed on the desktop (round 2, RTX 5070 Ti). See the table above. Not re-measurable here |

### Browser evidence

None from the cloud. I wrote a SwiftShader check: outage, then 300/600/1,200 m poses, on/off shots, then 60 days of
clearing. It was queued behind about 25 lock waiters. I withdrew it before it took the lock, to keep within this
step's lock budget (tsc and the lane's tests only). No browser, vite server or cache was started. Every browser
acceptance line was already met on the real GPU. On the merged tree, the only new interaction is the shared event
handlers, and the new wiring test covers them.

### Decisions

- **Clearing in 8-20 days, not "the same way" as the 30-60 day build-up: accepted as meeting FEEL-17's intent.**
  - What the player sees runs from connecting the landfill to an empty kerb. That span is the sim's own lag plus the
    ramp. The lag is up to 36 days: the pile level decays ×0.65 per 12-day pass and the flag clears below 0.35.
    The ramp adds 8-20 days.
  - That is 35-54 days measured, inside the plan's "1-2 months".
  - The Acceptance line (≥ 90 % gone within 2 months) is the binding one. A 30-60 day ramp on top of the lag fails it:
    45.7 % gone at +60 days on the desktop.
  - The garbageCollection test reproduces this through the real PollutionSystem: every flag clears at exactly
    3 × POLL_PERIOD = 36 days, and every prop is gone by +56 days.
  - The build-up keeps 30-60 days.
  - If the lead wants the ramps symmetric, the alternative is a sim change (a faster flag clear). It is out of scope
    for a render-only lane.
- **The merge order in the shared handlers** (index first, then garbage): the two are independent, and both see the
  same building record.
- **No cloud browser run** (see above). This follows the step's explicit lock budget. Real-GPU re-measurement on the
  merged tree is impossible while the desktop is away, and the plan treats it as a remaining item, not a blocker.
- **The desktop's report text above is kept as written.** This section adds to it and changes nothing above.

### Remaining

- The merge step: the full vitest and the bot on the merged tree. The bot is expected identical to dev; no sim,
  worker, game or save file changes.
- Optional, once a real GPU is available again: a visual re-check of the merged tree. No acceptance line depends on it.
