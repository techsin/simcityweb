# W0.3b browser checklist — remaining display reads

Status: **not run in the sandbox**. Compare with `93069fa` on the same fixed seed/save, camera, funding,
ordinances, simulation day and selected lot. Keep screenshots of each compared banner/panel/card/tip; record
the exact displayed numbers, not just whether the page renders. Use LocalSimHost (`?simworker=0`).

## Emergency banner and pill

- [ ] Load a city with no emergency system/data yet: no exception, phantom alert or enabled Send button.
- [ ] Create an uncovered major fire at ultra. Compare the banner's place, state, deadline, urgency, nearest
  station, ETA and button title with the base. LIVE, pause/resume, settings and speed restoration behave as before.
- [ ] Send nearest; choose a station through DispatchTool; jump to the site; dismiss. Feedback occurs once and
  the commands retain their existing behavior. No extra warning sound on an option-watch delivery.
- [ ] With two waiting calls sharing one free unit, dispatch it while paused. The other call's button and
  Send feedback and the next panel/pill update use fresh options immediately after the command, even within
  200 ms of the previous read. Repeat with station demolition and funding commands while paused. Resume to let
  a unit return; its availability, Send label, ordering and pill update within the normal watch cap. Units do
  not return while paused.
- [ ] Compare industrial/collapse incidents with a supporting ambulance already out: responder names, missing
  primary unit, send window and late-arrival wording match the base.
- [ ] Resolve/fail incidents, including a lost building/deaths. Final outcome text uses the final incident;
  the countdown and dispatch buttons disappear, and the existing linger/removal animation remains.
- [ ] Trigger several incidents, including dismissed and folded banners. Compare ordering, the count pill and
  its "needs you" text. At 1024×600 and 1280×720, open Demographics/Help and a tall toolbar flyout; repeat the
  existing pointer-hold, docking and settle-guard checks.
- [ ] Exit to region and load another city while banners exist. No old-city callback, retained watch or alert
  reappears. Reload a save with uncovered emergencies and verify banners/pill return.
- [ ] Pending dispatch data uses “Loading…” / “Loading dispatch options…” without enabling Send or borrowing
  another incident's options. With LocalSimHost, an initial result normally arrives synchronously. If an existing
  banner loses its emergency system before Send nearest completes, feedback is “Emergency services unavailable”.

## Emergencies panel

- [ ] **Active:** compare every summary number, row order, incident text, units, time left, Jump and Dispatch.
  A waiting incident with no free reachable unit has the same disabled-button reason; it enables on return.
- [ ] Switch Active → Fleet → Statistics → Active, close/reopen, and repeat while paused. Watches exist only
  for waiting incidents on Active; delayed data never fills a different incident's row.
- [ ] **Fleet:** compare fire/police/medical free and total units, funded/off pips, range, station names, power
  warnings and jump targets, including zero stations and a partly funded station.
- [ ] **Statistics:** compare all monthly/yearly counts, response times, casualties, losses, damage, arrests,
  riot days and medical response score.
- [ ] Close the panel, exit the city, and load a different save while it is open. No exception or old-city data.

## DispatchTool

- [ ] Select an incident, hover free/busy/unreachable stations, inspect the route, send one and Shift-send all.
  Compare ETA, labels, missing responder names, highlighting and next-incident selection against the base.
- [ ] With the tool active, dispatch from the banner to a different incident sharing its station. On the next UI
  tick the station highlight reflects the command immediately. Resume until a unit returns, then check its green
  highlight updates without reselecting the tool. Same-day fleet deliveries must repaint; pause alone cannot
  cause a vehicle to return.
- [ ] Switch target, deselect, and exit the city with routes/options pending. No stale highlight or tooltip lands.

## Every list and tool showing upkeep

Use a small city with little unserved need, a large city with unmet need, and the same city with reduced funding
and an education/health/police ordinance. Pause before each comparison.

- [ ] For **every visible build card and its hover details** in Transport, Utilities (Power, Water, Garbage),
  Civic (Police, Fire, Health, Education, Civic), Parks, and Rewards (Landmarks, Rewards/business deals), compare
  cost, monthly upkeep, typical/full-use numbers and their wording. Flat-upkeep and income-producing buildings
  retain their catalog amounts. Check both locked and unlocked cards.
- [ ] In the **Rewards panel**, compare every upkeep chip and tooltip, including locked, unlocked, built and
  ruined rewards. Place/Show ruins controls and neutral income-on-ruins wording remain correct. Clear a ruin
  while paused, then rebuild; the unique building's catalog card and reward status update as before.
- [ ] For **every ploppable definition that shows upkeep**, compare its placement cursor tip against the base
  at the same footprint/rotation. Cover elementary/high schools, colleges/libraries/museums/university,
  clinics/hospitals, police/fire facilities, play/green parks, and every flat-upkeep category above.
- [ ] For each running-cost family, compare a road-connected unserved neighborhood, an already served one,
  empty land and a roadless lot. The spot estimate, full-use ceiling and no-road warning match. Include deep
  multi-cell homes and a dense fire district where "here" exceeds the typical full-use figure.
- [ ] Move rapidly between two lots, rotate, return to the first lot, place twice, switch tools, leave the map
  and exit to region while a read is pending. Compare each tip with `93069fa` on the identical lot, including
  several moves inside 200 ms: every valid services raster produces “Upkeep here ≈§X/mo now” before paint.
  No 5 Hz fallback or another lot's price may appear; only the current placement is memoized.
- [ ] Change funding/ordinances while paused, then move within the same footprint; repeat after advancing a day.
  Compare the new spot price with the base. After a services pass between days, move away and back: it must read
  the latest raster. Leaving/re-entering and deactivating/reactivating also give fresh prices.
- [ ] Rest the cursor and leave the camera still for at least 6 seconds. CameraMemory's 2-second `setCamera`
  commands cause no extra upkeep query or tooltip repaint. Move again and check the current price.
- [ ] Before services data is ready, and with running costs disabled, verify the same city-wide/catalog fallback.
- [ ] Open each placed facility's inspector with QueryTool. The existing actual upkeep and breakdown still match
  the base; the build card's typical figure and the cursor's marginal figure retain their distinct wording.

## Performance and shared lifetimes

- [ ] On the same large save/camera, profile a disaster with about 100 stations and 10 waiting incidents, with
  the banner and Active tab visible. Compare frame time with `93069fa` and `7969951`. Watch signatures must not
  call `stationList()` or serialize station arrays per frame. Banner and panel share one underlying watch per
  incident (about 10, rather than 20); close/change tabs and verify the banner's leases remain usable. After both
  release an incident, its watch is disposed. Fleet tab's own station read remains legitimate.
- [ ] On a city with about 200k buildings and all available one-per-city definitions built, record repeated
  keyboard tool selections, flyout opens and 6 Hz Rewards updates. Compare input latency and profiles against
  the same base save. Catalog definitions and Rewards must share one building scan per size/next-id/day/command
  epoch, not one per definition or panel update. A changed ruin flag invalidates once; ordinary power-only and
  growable updates do not. Include burnt/restored/cleared rewards while paused and repeated open/close cycles.
- [ ] If the save has multiple ruins of one definition, “Show ruins” chooses the first in mirrored map order.
  The old economy list swap-removes entries, so the chosen ruin can differ after unrelated removals; confirm
  it is still a ruin of the correct definition and its price/status match.

## Lead gates

- [ ] `npx tsc --noEmit` and the full Vitest suite pass; the W0.3b hygiene rule is active and passes.
- [ ] `querySideEffects.test.ts`: 120 days with all query/watch handlers match the no-read city and RNG.
- [ ] Run the focused regression files listed in `reports/local-W0.3b-reads.md`, including the real-host rapid
  placement, immediate dispatch, monthly policy, shared ruin cache and hygiene self-tests.
- [ ] The 128×15 seed-7 bot remains **196,101 in 2015** (59,288 / 95,301 / 41,512 residents by wealth).
- [ ] Old saves load, continue, save/reload and continue identically to the base.
- [ ] Record browser/version, saves/seeds, screenshots, failures and leak/teardown observations in the report.
