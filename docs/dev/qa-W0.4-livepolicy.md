# W0.4 LivePolicy browser QA

Run on `local/W0.4-livepolicy`, based on `2ba03fa`, with the normal LocalSimHost. Use a disposable copy of a
developed city with emergency services and a city where the disaster tool is available. Keep sound enabled and the
console open. Record browser/version, city/seed, viewport, UI scale and any console errors. These are manual steps,
not results from this lane.

## Uncovered fire at ultra

1. In Settings, choose LIVE for uncovered emergencies, slowdown 3, and major alerts. Find a developed lot outside
   automatic fire coverage but connected by road to a station with a free truck that can arrive before it burns.
   Keep the Emergencies panel available to check the station and ETA. A site with no possible timely dispatch is a
   different case and must not hold LIVE.
2. Select ultra (3), then start a fire at that lot with the disaster tool. Check the banner's place, deadline and Send
   nearest ETA. The warning should sound once for the burst, without repeating on UI ticks.
3. With less than eight real seconds left at LIVE speed to send a timely truck, expect the urgent pause. The speed
   control shows paused; the policy's LIVE episode is active, but the visible LIVE badge is hidden while paused.
   No subsequent frame should keep running at ultra. A longer-window emergency first drops to 1 with slowdown 3.
4. Click Send nearest. Check one confirmation sound and the correct fire-truck ETA toast. The truck leaves, the
   urgent pause releases to 1, the LIVE badge appears, and one game day takes about 1.5 real seconds. The label and
   ETA spans must still accept a press/release across an update.
5. While the truck is driving, open Pause, then Resume. Repeat with Escape/backdrop. Resume must restore LIVE's 1,
   not the ultra speed from before the episode; the slowdown remains 3.
6. Let the truck arrive. LIVE follows the primary responder until it has been on scene for 0.75 game days (unless
   its drive exceeded 15 emergency minutes). When no other alerted prompt/follow remains, ultra returns with one
   “Emergencies handled — back to ultra speed” toast. The fire can finish its on-scene work after the follow ends.
   Check its eventual resolution and the outcome banner's short linger.
7. Repeat, but manually select another speed during LIVE. When the episode finishes, that choice must be respected.
   On an unsuccessful/dismissed episode, the restore toast must say “Emergency over”, not “Emergencies handled”.
8. Repeat with Choose station. Send one unit yourself and then dispatch from another issuer (the banner or
   Emergencies panel). DispatchTool's own command still waits for its feedback; another issuer's dispatch still
   advances it. Check that station names, primary/supporting units and ETAs remain correct.

The same-day unit test separates a long-window fire fixture from urgency. Real uncovered fires commonly go directly
to the urgent pause, so that is an expected result here, not a failure to enter LIVE.

## Burst, dismissals, settings and load

- [ ] Trigger a quake/meteor burst. A later incident can take the only free unit an earlier prompt counted on.
      Those stale prompts must not leave LIVE or an urgent pause stuck on. The decision occurs after the whole
      synchronous burst, through the EM-1 microtask; do not expect it halfway through individual `uncovered` events.
- [ ] During an urgent pause, use the remaining trucks elsewhere. With no timely primary unit left, the pause must
      release; if another alerted player dispatch is still being followed, it continues at LIVE speed.
- [ ] Dismiss one waiting banner. It disappears, stays dismissed on later ticks/events, and the episode restores
      neutrally if it was the last pending alert. A still-answerable dismissed major prompt remains in the count pill.
      Dismiss all banners: the pill remains and opens Emergencies. While that panel is open, the wording is
      “see the Emergencies panel”.
- [ ] During LIVE, change slowdown 3 to another offered value and back. Check the actual clock rate. Switch LIVE to
      Pause, then back to LIVE, then Ignore: the new policy applies and the original pre-episode speed is retained
      where the player has not overridden it. Trigger a new incident while Ignore is selected: banners can appear,
      but speed must not change.
- [ ] Switch major alerts to all. A subsequent minor incident eligible under the existing population/cooldown rules
      can show a banner. Restore major-only. Unrelated settings, such as audio volume, must not restart the episode,
      repeat a warning/toast or revive a dismissed banner.
- [ ] Save with a waiting uncovered fire, exit and load it again. Its banner and applicable LIVE/urgent policy return
      after systems boot. Dismissals and the old episode are not saved. A saved city normally reopens at speed 1.
- [ ] Exit immediately after a disaster/dispatch, then enter another city. No late warning, toast, banner or speed
      change from the old city; no console error. Repeat with a panel open. T016's teardown and retained-control checks
      should still pass.

## Count pill and panel content

Use a burst with several answerable major incidents. Pause while inspecting geometry; allow at least 350 ms after
layout movement before clicking (the existing settle guard). Use default UI scale and record the computed zoom.
Reset saved panel positions so these are centred panels, then repeat after dragging a panel.

| Viewport | Panel | Run with |
|---|---|---|
| 1024 × 600 | Demographics | All banners dismissed; then live banners from a fresh burst |
| 1024 × 600 | Help | All banners dismissed; then live banners from a fresh burst |
| 1280 × 720 | Help | All banners dismissed; then live banners from a fresh burst |

For each of the six runs:

- [ ] The count pill is visible and accurate. It fits below the panel above the toolbar, or in a free strip beside it.
      A narrow strip may wrap the pill text. It must cover no part of the panel body, title or tabs, including
      Demographics' headline cards and Help's section headings. Check its first appearance as well as settled layout.
- [ ] With live banners, the rows that cannot fit fold into the counted pill without dismissing their incidents.
      Neither the pill nor a shown row covers the centred panel's content. Titles/tabs, cards and headings remain
      hit-testable; the toolbar and any open flyout remain usable.
- [ ] Open/close the Civic flyout, switch its tabs, resize the viewport, and close/reopen the centred panel. The stack
      returns to its ordinary layout after the panel closes. Hold Jump for over 1.5 seconds while a flyout closes:
      the press must still land. A control that just moved retains its settle guard and feedback.
- [ ] Dismiss the last banner with the panel already open. The new pill must not flash over the panel for one UI tick.
      Click the settled pill and confirm Emergencies opens.

Also spot-check Budget at 1024 × 600, 1280 × 720, 1366 × 650 and 1920 × 1080, and the empty/no-emergency screen.
If user-dragged panels occupy every possible free strip, the pill is temporarily hidden rather than covering their
content; moving/closing a panel must bring it back, and Emergencies remains accessible from the top bar.

## Timing boundary and remaining gates

W0.4 keeps the settled-burst microtask and moves the old next-UI-tick fallback to the next host tick. The policy runs
before each local `Simulation.update`; a new event during that update flushes after its synchronous burst. The
existing update still caches seconds-per-day and can finish up to four days in that same call. Dropping the remaining
days *inside* a tick requires W1.2's per-day units and simulation API split. O7's scheduler/disaster live flag is also
W1.2 work; neither is claimed by this QA.

The lead also runs the full suite, old-save continuation and the 128 × 15 seed-7 bot. The required B1 reference is
**196,101 residents in 2015**, split **59,288 / 95,301 / 41,512**; it has not been verified by this lane.
