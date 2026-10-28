# local/W0-complete: browser QA (W0.6 saves and W0.3b reads)

A focused session on Oct 27, by a QA sub-agent on the desktop.
- **Trees:** NEW = `local/W0-complete` @ `019fcf4`. BASE = `93069fa` (the W0.3-W0.5 integration), for item 9.
- **Browser:** Playwright Chromium 141.0.7390.37, headless, `--enable-gpu --ignore-gpu-blocklist --use-angle=default`,
  1280 × 720. WebGL: ANGLE (NVIDIA GeForce RTX 5070 Ti, Direct3D11).
- **Cities:**
  - small_s7_y10.region.metropolis (Botville, 101,602 people), imported through the UI;
  - a new city, founded through the New City flow.
- **Items:** picked from docs/dev/qa-W0.6-saves.md and docs/dev/qa-W0.3b-reads.md: the checks that tests cannot
  cover.

**All 11 items and the teardown check pass, with no console errors on NEW or BASE.**

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | New city, initial save, reload | PASS | **Found:** day 0, §100,000; the IDB city record was written.<br>**Reload:** no recovery offer; Continue shows the same name, day and funds, and the sim advances. |
| 2 | Paused edit, Ctrl+S, reload | PASS | **Edit while paused:** a 10-cell road and an 8-cell zone, by drag.<br>**Indicator:** "Unsaved changes", then "Saving…" and "Saved"; one save sound; "City saved".<br>**Reload:** no recovery offer; the road (10/10), the zone (8/8) and the funds are there. |
| 3 | Camera through save, exit, re-enter | PASS | **Move:** rotate, pan and zoom to (26.42, 98.55), 690 m, yaw 135, tilt 50.<br>**Save, exit, Play:** the same view comes back. |
| 4 | Region tile matches the city | PASS | **City:** 105,824 people, §87,784, 2010.<br>**Tile:** "106k residents", "§87.8k", "Year 2010".<br>**Region summary:** exactly 105,824 / 87,784 / 2010. |
| 5 | Recovery after a renderer crash | PASS | **Setup:** autosave off; a baseline save at day 3604; edits; the city runs to day 3614.<br>**Snapshot:** written to localStorage and IDB (405,214 bytes, base day 3604).<br>**Crash:** CDP `Page.crash`.<br>**New page:** offers "Recover unsaved progress?"; Recover restores road 10/10, zone 8/8 and §73,882. |
| 6 | Save the recovered city, reload | PASS | **Save:** Ctrl+S clears the recovery marker.<br>**Reload:** no offer; the edits are there and the sim continues. |
| 7 | Paused edits, normal reload | PASS | **Reload:** recovery is offered (the unload snapshot); Recover restores the edits. |
| 8 | Region export, import | PASS | **Export:** 1,204,139 bytes.<br>**Import into a fresh profile:** Botville, 105,804 people, §87,784, 2,767 buildings, day 3684, as exported. |
| 9 | Plop upkeep tip across 10 lots, against BASE | PASS | **Speed:** 10 lots in 1.35 s, 64 painted frames.<br>**Every frame:** "Upkeep here ≈§X/mo now" with that lot's own value, never the city-wide line.<br>**Against BASE:** all 10 equal: §86 §60 §124 §118 §60 §80 §78 §69 §66 §61. |
| 10 | Uncovered major fire: banner, Send nearest, panel | PASS (host path to start the fire) | **Start:** `host.act('triggerDisaster', ['fire', 2, 76])`, because disasters are off in this city.<br>**Banner:** "Outside fire coverage — nearest free fire truck: Fire Station #6", "Send nearest 3.9 min".<br>**Send nearest (a real click):** one `dispatchBest`, and the banner shows the truck on its way on the next frame.<br>**The Emergencies panel's Active tab:** agrees. |
| 11 | Ruins of a one-per-city building | PASS (host path to burn it) | **Catalog card:** "Already built (one per city)" becomes "In ruins — bulldoze its ruins first".<br>**Rewards panel:** lists the ruin with "Show ruins". |
| T | Teardown: `leakprobe --mode fresh` | PASS | `PASS [[0,0],[0,0],[0,0]]`: no CityScene or CityState 3 s after exit, in 3 cycles. |

Notes, not failures:
- **Item 10:** a click within 350 ms of the banner appearing is ignored on purpose. That is the banner's settle guard
  against presses on a banner that just moved under the pointer.
- **A loaded city resumes at normal speed,** so the first reads were about two days after the saved day. The funds
  and edits matched.

The scripts, the raw results and the screenshots are in the worker's scratchpad (w0c/qa/).
