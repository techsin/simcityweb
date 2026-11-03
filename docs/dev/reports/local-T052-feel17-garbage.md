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
