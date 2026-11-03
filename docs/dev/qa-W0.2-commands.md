# W0.2 command QA

Run on `local/W0.2-commands`, with the normal LocalSimHost. Use a disposable copy of a developed city and a fresh
city for onboarding. Keep sound enabled and the browser console open. Record browser/version, city/seed and any
console errors. The full Appendix A query/view/save migration checks belong to the later W0 steps.

**Known gate blocker:** W0.2 requires the `liveSlowdown` writer rule, but the design assigns LIVE policy ownership
to W0.4 and supplies no interim command. The two existing EmergencyBanner writes remain pending lead direction.
The commands below are ready for review; this checklist is not a claim that W0.2 has passed.

## Every W0.2 operation

- [ ] `zone`: drag residential zoning next to a road. Preview, charged cost and painted rectangle agree; one zone sound.
- [ ] `dezone`: clear part of that rectangle. Check the preview, final cells and funds.
- [ ] `bulldoze`: remove a road tile with the tool. Then demolish a building from its inspector; the panel closes
      after the demolition, with one demolition sound. Cancel a consequential demolition once before confirming it.
- [ ] `buildNetwork`: draw a road, then a rail or avenue. Flip a corner with Shift. Cancel a drag with Esc/right click;
      the cancelled route must not build. Confirm a route through developed lots once.
- [ ] `buildPowerLine`: draw power lines; check preview, final route and cost.
- [ ] `buildSubway`: draw an underground tunnel; check preview, final route and cost.
- [ ] `plop`: place a small park twice. Place an available unique reward once; its tool deselects on success.
      Try a blocked location and confirm one refusal sound/toast. A stationary preview still places the shown cell.
- [ ] `terraform`: hold Raise, then Lower, Level and Smooth. Soft sounds continue during a hold; release plays one
      completion sound. On a wholly ineffective stroke, release plays one error; no per-application error toasts.
- [ ] `plantTrees`: hold over clear land, then over a full/blocked patch. Confirm the same stroke feedback and cost rules.
- [ ] `setTax`: change an individual tax slider and a family/master slider. Check values and projected budget immediately.
- [ ] `setFunding`: change Fire funding, then restore it. Check the slider, forecast and service availability.
- [ ] `setHistoric`: mark a growable historic, close/reopen its inspector, then unset it. The bit and button agree;
      a plopped building/rubble does not gain the historic action.
- [ ] `setOrdinance`: enable and disable an available ordinance. With a nuclear plant present, enact Nuclear Free Zone:
      cancel its warning once, then confirm. The pending switch does not flicker back during updates; refusal restores it.
- [ ] `takeLoan`: take a loan in a non-sandbox city. Funds/list update and the cash-register sound follow success.
      Try a bank refusal; it must not play the success sound.
- [ ] `repayLoan`: repay one of two differently sized loans; the correct balance disappears. Keep the panel open across
      a month boundary and repay again. A stale guard must refuse safely rather than repay a different loan (unit test
      `LocalSimHost commands > refuses a stale repayment…` exercises the exact stale-row race).
- [ ] `setSpeed`: exercise every UI writer below. Check the active speed indicator and the advancing/stopped clock.
- [ ] `resume`: from speed 3, open Pause and Resume; speed returns to 3. Repeat while already paused; it stays paused.
      Repeat during LIVE mode; Resume restores the speed at which the core was paused.
- [ ] `dispatch`: create an uncovered incident with a reachable free unit outside automatic coverage. Choose station,
      hover its route, click to send one, and Shift-click to send all where more are needed. One success toast/sound;
      the tool advances/closes only after its own feedback. Try a busy/unreachable station and check its refusal.
- [ ] `dispatchBest`: on another uncovered incident, use Send nearest. Check the named responder, ETA and departing unit.
      With DispatchTool open for that incident, dispatch from the banner; the tool still reacts to this other issuer.
- [ ] `triggerDisaster`: on the disposable city, start a fire beside a building and one non-fire disaster. A successful
      click deselects the tool. A fire click on empty land refuses immediately and keeps the tool selected with a reason.
- [ ] `setCamera`: pan, zoom and rotate, wait over two seconds, save, leave and reload. The camera returns to that view.
      With renderer loading delayed, a saved camera must not be overwritten by the null view at the map corner.

## Speed writers and lifecycle

- [ ] Fresh city starts paused; saved city starts at its existing default. Onboarding's Play starts speed 1.
- [ ] Space pauses/resumes, and keys 1/2/3 select the matching speed and sound.
- [ ] Each TopBar speed button selects the matching speed; clicking the selected one retains the existing tap sound.
- [ ] Pause menu Resume, Escape and its navigation paths preserve their previous pause/resume behavior.
- [ ] Hide a running tab, return and check restoration. Hide an already paused tab; it stays paused.
- [ ] Exercise an existing development error-overlay fixture and press Pause simulation. The simulation stops.
- [ ] Exit to region while running; the city stops before its save/exit completes. Re-enter and verify normal play.
- [ ] Trigger an uncovered emergency at ultra. Check LIVE/urgent pause, dispatch, completion and speed restoration,
      including an industrial incident with an automatic ambulance but no fire truck. A disaster burst must not flash
      a prompt for a unit claimed by another incident later in the same burst (existing EM-1 behavior).
- [ ] Release a brush while another mouse button is held; it stops applying. Test pointer cancellation/window blur,
      tool switching and switching cities while a confirmation or command reply is pending.
- [ ] After exit, retained old controls produce no actions, sounds or toasts. T016's null views and `abort('dispose')`
      behavior remain intact; run the existing teardown tests/leak probe as well.

## Handoff gates

- [ ] Run the individual suites named in `reports/local-W0.2-commands.md`, then the full suite in the lead environment.
- [ ] Run the 128 × 15 seed-7 bot against `3a0a2ab`: every non-timing result is identical, including **194,432 in 2015**.
- [ ] Load old saves, advance, save and reload; compare continuation with the baseline.
- [ ] Resolve the documented LIVE slowdown ownership conflict and pass both W0.2 hygiene rules before marking DONE.

`dismissAlert`, `setSettings` and the debug operations from the eventual command table are not W0.2 implementations:
policy moves in W0.4 and the restricted harness facade lands later. Do not count those future operations as covered here.
