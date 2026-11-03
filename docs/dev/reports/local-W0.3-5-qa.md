# W0.3-W0.5 browser QA on the desktop (NOTE-037 / NOTE-038)

The cloud's run died at its usage limit with no results. This is the desktop's run: a QA sub-agent, Oct 28.

- **Trees:** NEW = dev `a3abb4f` (W0-complete, T014, T025, T026 and T008 merged). BASE = `4c90468`, the dev head
  before W0.3-W0.5.
- **Browser:** Chromium 141.0.7390.37 (Playwright 1.56.1), headless, `--enable-gpu --ignore-gpu-blocklist
  --use-angle=default`. WebGL: ANGLE (NVIDIA GeForce RTX 5070 Ti, Direct3D11).
- **Cities:**
  - small_s7_y10 (101,602 people): items 1-8, 10 and 13;
  - vet_s7_y21 (256 map, 303,987 people): items 9, 11 and 12.
- **Method:** real mouse and keyboard; reads through page.evaluate. Fires were started with
  `host.act('triggerDisaster')` (host path only), because disasters are off in these cities.
- **Skipped:** what the W0-complete session already covered (local-W0-complete-qa.md): saves and recovery, the plop
  upkeep tip, ruins, and a single fire's banner and Send nearest.

**All 13 items pass. No blocker, major or minor. Check 4's pill-over-panel minor is fixed in NEW.**

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | W0.3: the Appendix A consumers | PASS | The same text on NEW and BASE everywhere:<br>• **Panels:** Statistics (Park & ride), Advisors with its Show me and News, Demographics (People, Schools, Tourism, Show me), the RCI popover, all four Budget tabs and a paused tax change by keyboard.<br>• **Tools:** the Parking Garage tip near and far from a stop; the landmark, road and rezone confirm dialogs (no command before the dialog or after Cancel); DispatchTool's options, ETAs, routes and tips, incident switching, the wrong-station tip and the station click that sends.<br>• **Inspector:** Make historic, demolish (asks on a landmark; closes after the ack on a house), loan take and repay. |
| 2 | W0.3: the inspector diff, and quick switching (O3) | PASS | **Text:** identical on 11 targets: growable R, C and I, a clinic, a gas plant, a large park, a bus stop, a road, an empty zoned cell and a burning townhouse.<br>**Switching:** 9 switches 50-70 ms apart, 208 frames sampled. The new header shows on the first frame, and no frame carries another target's report. |
| 3 | W0.3: the watch cap | PASS | **NEW, ultra (18.6 days/s), 12.3 s:** 12 inspector reads, at least 1,000 ms apart (the inspector's 1 Hz, under the 5 Hz cap), and 9 distinct reports, so it does update.<br>**BASE:** 11 rebuilds. |
| 4 | W0.4: an uncovered major fire at ultra | PASS | **Same day:** the policy acts in the same task and sim day.<br>**Fire:** it goes to the urgent pause, because a fire's window is under 8 s even at 3× slow motion. Send nearest then gives speed 1 with slowdown 3, LIVE, and 1.50 s per sim day.<br>**After:** ultra returns with the toast.<br>**Medical call:** a major medical call out of range (a longer window) drops ultra to speed 1 ×3 within the same day.<br>**Inside a sim tick:** a fire raised there is handled within the same day.<br>**BASE:** matches throughout. |
| 5 | W0.4: the urgent pause and a second episode | PASS | **Both episodes:** each pauses at once with one warning, then goes Send nearest → LIVE → ultra with the toast.<br>**BASE:** identical. |
| 6 | W0.4: a dismissal, and a setting change mid-episode | PASS | **Dismiss:** during the pause, ultra returns with "Emergency over".<br>**Settings:** Pause → 0, Live → 0 (urgent again), Keep going → 3 (the speed before the episode). A new fire under Keep going leaves the speed at 3.<br>**BASE:** the same speeds and toasts. |
| 7 | W0.4: the banner after a save and load during an episode | PASS | **After reload and Continue:** the banner is back on the first read, and the urgent pause and LIVE are re-applied. No recovery offer.<br>**BASE:** the same. |
| 8 | Check 4's minor: the pill over a centred panel | PASS, fixed | **NEW:** 0 px² of pill or banner over Budget, Rewards, Statistics, Demographics or Help, at 1024 × 600 and 1280 × 720 (W0.4's `dockPill`).<br>**BASE:** the pill covers the body of Demographics at 1024 × 600, and Help at both sizes (9,152 px²). |
| 9 | W0.5: every data view, by screenshot diff | PASS | **Views:** None plus all 54 views and variants on vet_s7_y21: 0 differing pixels and identical legend text, with moving cars, smoke, siren lights and tree sway hidden and the world clock pinned.<br>**Unfrozen:** every pair differed by 6,350-8,800 px from those, the None pair included. |
| 10 | W0.5: a view with no data yet (O9) | PASS | **Local path:** the first switch after load draws on frame 1, as on BASE.<br>**Forced not-ready source (host path only):** no tint and no zeros, "Loading…" in the panel and the chip, and no hover value. When data arrives it draws without a click. |
| 11 | W0.5: EmergencyView, TrafficView and UtilitiesView | PASS | **Traffic and utilities:** routes, truck volume and tap water quality hash the same on the BASE system, the NEW system and the NEW host views.<br>**Emergency:** incidents, vehicles and all 218 stations match after a fire, Send nearest and one LIVE day.<br>**Readouts:** 35 of 35 hover readouts identical. |
| 12 | W0.5: the news ticker past 200 items | PASS | **Run:** 150 s at ultra; 149 new items past a full 200-item log.<br>**Counts:** newsSeq 200 → 349, equal to the events counted. news.length stays 200; the ticker holds 8 items and 40 DOM nodes; the newest item is always shown.<br>**Errors:** none. BASE behaves the same. |
| 13 | The leak probe, fresh and hostile | PASS | `[[0,0],[0,0],[0,0]]` in both modes. |

Notes, not failures:
- **Docked panels:** Rewards and Statistics dock at the side in this build. The centred panels are Budget,
  Demographics and Help.
- **Live badge:** when the setting goes Live → Pause mid-episode, BASE keeps the root's `emg-live` class and NEW clears
  it. NEW is the more correct one, and nothing shows while paused.
- **Not checked:**
  - the ferry-terminal readout (no test city has water);
  - TopBar's "newly capped" toast (no cap transition happened);
  - O9 with a real delayed worker delivery (the local host registers no data source, so item 10 forced it);
  - inspector panels by pixels (glass over a live scene, so their text was compared);
  - item 12 on bot256_y60, which is not in the cities folder (vet_s7_y21 was used).
- **Console:** no app console errors or page errors. Only the frame-clock harness's WEBGL_CONTEXT_LOST lines for the
  disposed title and region canvases, on both trees.

The scripts, raw results and screenshots are in the worker's scratchpad (w035qa/).
