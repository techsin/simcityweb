# W0.3 queries and watches — browser QA

Branch: `local/W0.3-queries`, base `2ba03fa`. Run against LocalSimHost. These checks are for the lead;
they have not been executed in this worktree. See [the implementation report](reports/local-W0.3-queries.md)
for the outstanding hygiene scope conflict.

Use the same fixed-seed saves, paused day, camera, viewport, inspector position and section preferences for
the base and changed builds. Record the seed, save, day and building/cell coordinates with each screenshot.
Wait for a report to arrive before taking the comparison image; do not compare a loading frame with a
completed base report. Keep the console open and check for query errors and `DataCloneError` throughout.

## Inspector (building and cell watches)

- [ ] Inspect an occupied R$, R$$ and R$$$ home; a shop; an office; and a factory. Compare the hero, status chips,
  occupancy, main problem, key rows and commute/access/customer/freight readouts with the base.
- [ ] Open **Why?** on a growable. Compare desirability factors and notes, condition and abandonment prediction,
  growth limits (including downtown and wealth-switch notes), land-value factors and crime causes.
- [ ] Open **Residents**. Compare needs, facility names and utilization, and all five age groups.
- [ ] Inspect a school, clinic, park, power plant, pump, garbage facility and transport facility. Open **Facility**;
  compare warnings, role, rows, utilization, upkeep and income. Close and reopen that section once.
- [ ] Open **Environment** on a home, commercial and industrial building. Compare noise, pollution, garbage,
  tap water, all three emergency responses and their hints, coverage rows, parking, and utility network totals.
- [ ] Inspect an abandoned growable, a ruin and an active emergency building. Check the cause-neutral ruin
  wording, rubble crews, warning deduplication and absence of live income/occupancy on ruins.
- [ ] Inspect a road, one-way road, rail, bridge/tunnel and an interchange or busy transit road. Compare direction,
  congestion, traffic/trucks/bus riders/interchange rows, noise and air pollution.
- [ ] Inspect empty R, C and I lots, including a back lot without road or utility access. Open **Why?** and
  **Environment**; compare growth blockers, best-fit development, factors and road-front coverage.
- [ ] Inspect a landfill, ordinary open land and water. Compare fill/capacity/road warnings and available rows.
- [ ] Switch quickly A → B → A, then building → cell → another cell, with several sections open. The new header
  appears immediately; a pending report may say “Loading…”, but must never contain the previous target's data.
- [ ] Change sections rapidly on one target. A cached result must belong to that exact target/section selection.
- [ ] At ultra, observe an occupied building for several seconds. Reports refresh at most once per second for
  unchanged arguments; the header tracks current state. Scroll position stays put when its report refreshes.
- [ ] Toggle **Make historic** while paused. Its chip/button update immediately and do not revert while waiting
  for the report. Demolish a harmless building; the inspector closes only after the command acknowledgement.
- [ ] Start a demolition with consequences, cancel its dialog, then accept on another attempt. Verify the same
  warning items and actual outcome as the base. Switch target/close the panel while a read is pending: no old edit.
- [ ] Capture/diff the inspector screenshots above on the fixed seeds. Record any text, value, color or layout diff.

## Converted panels and popover

- [ ] **Statistics:** read every card once, including Park & ride. Exercise garages with usable spaces, all spaces
  kept locally, no nearby stop, no transit jobs, downtown stops and a newly placed garage awaiting assignment.
  The explanatory lines match the base after the next daily report.
- [ ] **Advisors & news → Advisors:** open during play, cross a month boundary, and use a “Show me” action.
  Pause, edit the map and leave it open for more than three seconds; check fresh advice and resolved issues.
  Switch to **News feed**, then back; close/reopen the panel. The news counter is W0.5's separate change.
- [ ] **Demographics → People:** read the population/cohort readouts once.
- [ ] **Demographics → Schools & services:** read all tiers; click “Show me” for an unreached tier. Confirm the camera target.
  Switch tab or exit the city before a pending reply; no late camera jump or toast.
- [ ] **Demographics → Tourism:** read gross visitors, room shortage, attraction factors and top venues. Run at
  ultra, then close/reopen and switch tabs; reports refresh and no old city's rows appear.
- [ ] **RCI popover:** inspect each available cap hint, follow a suggested build-menu action, close and reopen.
  Trigger/observe a newly capped family's toast with the popover closed; it retains the explanatory hint.
- [ ] **Budget → Taxes:** move a rate while paused. The control updates immediately; the forecast follows on the
  next allowed watch update. Check income, expense and net totals.
- [ ] **Budget → Services:** change a service allocation while paused; compare forecast, service cost and badges.
- [ ] **Budget → Loans:** take and repay a loan; forecast reflects the changed debt after the acknowledgement.
- [ ] **Budget → Income & expenses:** read recurring/one-off totals once. Close/reopen Budget and verify its forecast resumes.

## Tool readouts and mouse-up queries

- [ ] **Parking garage:** hover near a stop and away from stops. Check stop names/distances and highlights.
  Move quickly between locations and rotate; no stale location's lines or highlighted stops may appear.
- [ ] **Ferry terminal:** hover beside connected water with a partner, then water without a partner. Check names,
  travel times, highlights and the no-partner line. Rotate, move away, return, and leave the tool during a query.
- [ ] **Dispatch:** select a waiting incident. Check free/busy/wrong-type stations, ETAs, camera fit and highlights.
  Hover two stations and return to the first; routes match the hovered station. Click another incident to switch.
- [ ] **Dispatch:** send one unit, then Shift-click/send remaining units, including a mixed-responder incident.
  Own versus banner dispatch still behaves correctly; completed incidents advance or exit the tool once.
- [ ] **Dispatch:** switch incident/tool or exit the city while a route/report is pending. No stale route, camera
  move, selection or toast. Check new daily options at ultra.
- [ ] **Bulldozer:** click/drag harmless land, a last utility, a landmark/reward, a costly area and a utility bridge.
  The existing settled-hover cut preview still works; the full release-time query precedes confirmation.
- [ ] **Zoning:** rezone occupied lots across families. Verify demolition/displacement/cut items; test cancel and
  accept, plus Esc or tool switching while the query is pending.
- [ ] **Road/rail:** drag through buildings, including a utility bridge. Confirm side-demolition fees and cut items;
  test cancel/accept. The released gesture stays pending through the query/dialog and command acknowledgement.

## Cadence and lifecycle

- [ ] With converted readouts open at ultra, use debugger counters on handler evaluation/watch notifications:
  each handle publishes at most five times per real second; same-key inspector reports at most once per second.
  Argument changes must obey the 5 Hz cap too. Monthly advice waits for a month; budget edits refresh while paused.
- [ ] Close each panel/popover or leave each tool; its watches stop. Reopen them and get current data.
- [ ] Exit to region with inspector, advisors, tourism, budget or dispatch reads active; re-enter a different city.
  Check the console, callbacks and retained listeners for the old city. Preserve T016's abort/dispose behavior.
- [ ] Load an old save and continue across a month; repeat one inspector and one forecast read.

Lead gates in addition to this checklist: the full suite, query side-effect hashes, clone safety and the
128×15 seed-7 bot at **196,101** population in 2015 (residents **59,288 / 95,301 / 41,512**).
