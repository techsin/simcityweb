# T036 step 2 — NOTE-042's hidden controls, FH-11, FEEL-05 and FH-21

Branch `cloud/t036s2`, from dev `923428d` (`origin/claude/beautiful-johnson-u2jqoz`).

## Cloud carry-over (Nov 3)

### Gap list (written first, before any code)

What the desktop left: STATUS (Oct 28, 07:25) lists "T036 step 2 (started)", but nothing of it was pushed. The lane's
branch `local/R1-meta-start` (4a81e7e) is an ancestor of dev with no commits of its own, and `docs/dev/wip/` holds no T036
patch or journal. So every item below starts from dev.

| Item | Required (task file, NOTE-042, POLISH_PLAN) | Done in dev before this lane |
|---|---|---|
| NOTE-042 #2 | Hide Text size, Motion and Colour vision until each is wired (FH-23, FEEL-21, FH-20) | All three are shown on the title screen (step 1) and change nothing |
| NOTE-042 #3 | Motion keeps storing `'system'`; FEEL-21 owns its label | Stores `'system'` (nothing to change; the label goes with the hidden control) |
| FH-20 setting | Wire and show it only if the plan item covers it and T038's palette constant is in dev | The plan covers it, but the constant is only on `local/T038-r2-fh20` (f581523), not in dev: stays hidden |
| NOTE-042 #1 | Not this lane: T037a owns the `tips` change | — |
| FH-11 | Difficulty cards with the four `difficultyRules` blurbs; a profile's first city preselects Easy and Guided start, later dialogs remember the last choice; Easy unticks Disasters, plus the 2,000-residents note; the Guided start and "I've played city builders before" toggles; one recommended medium tile "A good first city" in a region with no cities, scored by `pickNiceTile` (moved to RegionModel) plus the flat buildable share. Acceptance: one highlighted tile on a fresh profile; the dialog opens on Easy + Guided start with the four descriptions and Disasters off; nothing clipped at 1280x720 after returning from a city (screenshot) | Nothing: the cards show money only, Medium is the default, Disasters is on, no toggles, no recommended tile, `pickNiceTile` lives in main.ts |
| FEEL-05 | A new city opens on day 90 (1 April) with `foundedDay` 90; an old save as before; the bot keeps day 0 (128x15 table unchanged); the advisors' first headline 45 days after founding and the two day gates from `foundedDay`; `tests/sim/foundingDay.test.ts`; a seasonal minimap tint composited over the cached base (no `paintBase` on a month tick, counted in a test); January and July visibly differ | Nothing (only the FH-10 newcomer bot founds on day 90) |
| FH-21 | First run's quality from `detectQuality()` (4 cores Medium, 8 High), an existing profile keeps its setting; one slow-frame prompt per profile (20 s at a median under 25 fps on High/Ultra; Switch / Keep, remembered); context loss pauses, saves and shows "Graphics reset — Restore", Restore rebuilds the views at the same camera with the state hash unchanged; the time from Found City to the first interactive frame in the fps log | Nothing: `detectQuality()` is never called, no context-loss listener, no load-time record |
| Gates | tsc; the full vitest; the bot identical to dev (196,101); each item's browser checks; one `.done` line per item | — |

### What this lane did

**NOTE-042 items 2 and 3 (hide what is not wired).**
- `A11Y_WIRED` in src/region/settings.ts holds one flag each for text size, motion and colour vision, all off. The
  title screen's "Accessibility & interface" builds only the wired controls, so today it shows UI scale and "Reset to
  defaults" (which resets the controls shown; a hidden key keeps its stored value). The lane that wires a feature flips
  its flag in the same change (FH-23, FEEL-21, FH-20). The in-city panel never had rows for the three.
- Motion still stores `'system'` (the default; nothing changed). FEEL-21 owns its label.
- Colour vision stays hidden: T038's palette constant is on `local/T038-r2-fh20` (f581523) only, not in dev.
- tests/game/titleSettings.test.ts: a new block for the hidden state (only UI scale and Reset; a change keeps the hidden
  keys; Reset resets UI scale only; motion stays `'system'`; each flag shows its own control only). The step-1 checks run
  on with every flag on, as each control will look once wired.

**FH-11 (a good start for a newcomer).**
- Difficulty cards (2 x 2) carry FH-04's `difficultyRules(d).blurb`, first letter capitalised: "§250k, +20% taxes,
  forgiving first years · Recommended for your first city", "§100k, the intended balance", "§40k, −15% taxes, tight
  from day one", "Unlimited money, everything unlocked".
- Defaults (src/region/newCityPrefs.ts): a profile's first city preselects Easy; later dialogs the last difficulty founded
  with (`metropolis.ui.newCity`). A profile with no record whose region already has a city keeps Medium (it founded cities
  before FH-11).
- Guided start and "I’ve played city builders before" are two switches that exclude each other. They write the guide's
  profile pref (`metropolis.ui.onboarding`): off or veteran records the guide as dismissed (`dismissed`, today's key,
  and `dismissedAll`, the FH-22 framework's key, which reads an old record's `dismissed` the same way), on clears it;
  `veteran` is FH-18's key. So the in-city guide follows the dialog today, and T037a's framework keeps reading it.
- Disasters follows the difficulty's default (Easy off, the others on) until the player sets it, with the guide copy's
  note `A3Disasters(DISASTER_MIN_POP)`: "Tornadoes, quakes and meteors can hit your town from 2,000 residents. Off is fine
  for your first city." `DISASTER_MIN_POP` moved into tuning.ts (disasters.ts reads it; same value, no behaviour change).
- The recommended tile: `RegionModel.pickNiceTile` (moved from main.ts; quickstart and `?newcity=1` call it unchanged)
  takes `{ flat: true }` to add `tileFlatFraction` (dry land within 2.5 m per 16 m cell, terrainStats' "buildable"), and
  `recommendedTile()` returns the best medium tile while the region has no city. RegionScreen outlines it in a warm colour
  (a third rect in the terrain shader, `uRecommend`), labels it with the guide copy's `A3Tile` ("A good first city for
  you"), names it in the hover tip, the tile card and the empty city list, and drops all of it once a city exists.
- The dialog's form column used `1fr`, whose min-content (the hidden custom-terrain chips) pushed it past the dialog's
  right edge at every size (dev, 1280x720: the Mayor dice, the Sandbox card and the trees slider were cut;
  `shots-before/before-newcity-1280.png`). It is `minmax(0, 1fr)` now, with a compact layout below 820 px of height.
- tests/game/newCityStart.test.ts (7): the dialog on a fresh profile, Disasters following the difficulty, the two switches
  and the guide pref, the remembered choice, the pre-FH-11 profile, the recommended tile's score and its removal.

**FEEL-05 (the spring start).**
- `startNewCity` sets `st.day = 90` and `systemData.foundedDay = 90` before the first save; the CityState constructor,
  the bot, the tests and old saves keep day 0.
- advisors.ts (GUIDE's three lines, done here as the plan's FEEL-05 lists them): the first headline is scheduled 45 days
  after `foundedDay` (an older save without the record: 30 days on, as before), and "Nothing is growing" (60) and the stall
  advice (150) count from `foundedDay`. With no `foundedDay` (the bot, old saves) every value is as before.
- The seasonal minimap: paintBase also fills a land mask (natural ground only), uploaded once when first needed; draw()
  composites it over the cached base with `'color'` at alpha `uFoliageDry` (the renderer's value, set from the month), the
  hue of `lum x (1.18, 1.02, 0.68)` at the land's own luminance. A month changes one draw, never paintBase.
  `uFoliageTint` is not applied: it differs from white only in the tropics, where `uFoliageDry` is always 0.
- tests/sim/foundingDay.test.ts (5): Apr 1 and the first New Year on 1 January of the next year; a day-90 founding takes
  the same first-day path as a day-0 one in approval, demand, desirability, land value, tourism, population and growth's
  core; the headline 45 days after founding; "Nothing is growing" and the stall advice as late after founding as in a day-0
  city. tests/game/miniMapSeason.test.ts (3): January vs July, the mask's cells and hue, twelve months with no paintBase.

**FH-21 (first-run quality, a slow machine, a lost context).**
- `applyFirstRunQuality()` (src/region/settings.ts): with no profile in the browser yet (none of `metropolis.settings`,
  `metropolis.settings.v1`, `metropolis.lastRegion`, `metropolis.lastSession`), the quality comes from `detectQuality()`;
  the App applies it first thing and saves it, so it holds like a chosen setting. An existing profile keeps its own.
- The slow-frame prompt (CityScene's fps tick): on High or Ultra, on the real views, in a visible tab, once 20 s of fps
  samples have a median under 25, one toast "The city is running slowly — switch graphics to Medium?" with Switch and Keep.
  Shown is remembered at once (`metropolis.ui.slowPrompt`), then the answer; Switch applies Medium (and so the app
  setting). Toasts got answer buttons for it (`opts.buttons`); such a question stays until answered or closed, and
  news toasts never push it out.
- Context loss: `webglcontextlost` (default prevented) pauses the game, stores the camera, saves, and shows "Graphics
  reset" with Restore. Restore, or the browser's `webglcontextrestored`, disposes both views, swaps in a fresh canvas,
  rebuilds them through the same `createViews()` the start uses (moved out of `initViews`, unchanged), and puts the lost
  view's camera back. The game stays paused: the player resumes it (this keeps the state hash comparable).
- The load time: main.ts measures from the Found City (or Play) click to the first frame after the loading screen is
  gone, keeps it as `App.lastLoadMs`, logs `[metropolis] first interactive frame N ms after the click`, and the fps
  readout shows "load N s to the first interactive frame" (for P-5).
- tests/game/graphicsFirstRun.test.ts (21): 4 / 8 / 16 / 2 cores and a phone, the four profile keys, main.ts's order;
  the prompt's 20 s window from the first frame, median, qualities, once per profile, Switch and Keep, the question toast
  (answers, no timer, never evicted); the loss card (clickable), the rebuild order and camera, the state untouched,
  `webglcontextrestored` restoring once and the old canvas's forced loss ignored.
- tools/qa-context-loss.mjs: the browser context-loss test for §8.1's verifiers (WEBGL_lose_context, Restore and
  restoreContext rounds; exit 1 on a failed check).

**What the browser checks found and fixed (each with a test that fails without its fix).**
- The New City dialog scrolled 59 px at 1280x720 once the blurbs and switches were in (body 585 / 526 px): the starting
  year moved under the switches and short screens get tighter spacing; it now fits exactly (510 / 510).
- The "Graphics reset" card could not be clicked: the HUD root passes pointer events to the canvas. `pointer-events:auto`.
- In the 101k imported city the toast stack (three on a short screen) filled within a second and pushed the once-per-profile
  slow-frame question out before it could be read. A question toast is never evicted now; it waits for its answer or
  its own 30 s expiry.
- After the browser handed a context back (`restoreContext()`), disposing the old views (WorldView.dispose forces a
  context loss on its canvas) read as a new loss: the card came back and the game saved again. One canvas is watched at a
  time, and a rebuild stops watching the old one first.
- In the same city the first render took long enough behind the loading screen to fill the 20 s window: the question
  showed under the loading screen and expired unseen. The window starts with the views' first rendered frame now.
- At 0.04 fps (that city on High under SwiftShader) a 30 s question lived about one frame. A question toast without its
  own ttl now stays until it is answered or closed (no timer, no countdown bar).
- tests/game/labelFrame.test.ts's stand-in region (T030's label test, which follows RegionScreen) got the two
  recommendation members `refresh()` now reads.

### Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (sem) | clean on the final commit |
| Full vitest, with the fixtures (`SIM_FIXTURES` = the main checkout's tools/bench/.fixtures/fixtures; lock) | **206 files passed, 1 skipped; 2,045 tests passed, 14 skipped** (479 s, on e486692, the final code; the earlier run on f065312: 2,043 passed, 14 skipped) |
| The bot, 128x15 s7 (lock) | identical to dev's (`t036s2-devbase`, 923428d), action table included: `residents [ 59288, 95301, 41512 ]` = **196,101**; only the two ms columns and the ms/day line differ (run on 2542aa6 and again on e486692) |
| New tests fail with their fix reverted | yes: advisors.ts reverted fails 3 of 5 foundingDay cases (and dropping approval's stored-data check fails the sixth-system case); MiniMap.ts reverted fails 3 of 3; dialogs.ts reverted fails 5 of the hidden-state cases; CityScene.ts + Notifications.ts reverted fail all of FH-21's scene and toast cases; NewCityDialog.ts + RegionModel.ts reverted fail 6 of 7; each browser-found fix has its own assertion (pointer-events, question eviction, question timer, the old canvas's forced loss, the first-frame window) |
| Browser, part 1 (`harness/main.mjs`, fresh 4-core profile, 1280x720) | **21 of 21** |
| Browser, part 2 (`harness/second.mjs`, 8-core first run; an existing profile with the old save small_s7_y10; the slow prompt) | **8 of 8** (after four fixes it found; see above) |
| tools/qa-context-loss.mjs (the context-loss test) | **13 of 13** (Restore button and restoreContext() rounds) |

The browser runs used Playwright's Chromium on SwiftShader (no GPU timings), each with its own Vite server and cache in
the scratch directory. Part 1 ran on 2542aa6; the later fixes (the question toast, the first-frame window, the old
canvas) are covered by part 2 and the context-loss tool, both run on the final code. The harness and both scenarios are
in `harness/` (run.mjs, main.mjs, second.mjs). Evidence, all under
`/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t036s2/` (each looked at):
- `shots-before/before-newcity-1280.png`: dev's dialog at 1280x720, cut on the right.
- `shots-main/01-title-settings-a11y.png`: Accessibility & interface with UI scale and Reset only; Default quality Medium.
- `shots-main/02-region-recommended.png`, `03-region-tilecard.png`: the outlined, labelled tile; its tip and card.
- `shots-main/04-newcity-dialog-fresh.png`: Easy and Guided start, the four descriptions, Disasters off with its note;
  body 510 / 510 px, nothing outside the dialog.
- `shots-main/05-city-apr1.png`: "Apr 1, 2000", paused, spring foliage, the fps readout's load line (41.0 s, SwiftShader).
- `shots-main/06-minimap-january.png`, `07-minimap-july.png`: straw in January (uFoliageDry 0.7), green in July (0);
  mean colour 38 apart; 0 paintBase calls over three month changes (after the map was idle for 3 s).
- `shots-main/08-context-lost-card.png`, `09-context-restored.png`: the card; the rebuilt view at the same camera
  (x 1096, z 968, 1126 m, yaw 45, tilt 50), a fresh canvas, exactDigest unchanged (3815976345), still paused.
- `shots-main/10-region-after-city.png`, `11-newcity-dialog-after-city.png`: no recommendation once a city exists; the
  dialog after a city at 1280x720, nothing clipped, Easy and Guided start remembered.
- `shots-qa/lost-*.png`, `restored-*.png`: both context-loss rounds; after restoreContext() the card stays gone.
- `shots-second/21-region-imported.png`, `22-slow-prompt.png`, `23-after-switch.png`, `24-reload-no-prompt.png`: the old save on Jan 3, 2010 (day 3602, no foundedDay); the question with Switch and Keep 32 s after the load; Medium after Switch, in the city and the app settings; 30 s more on High and a reload on High, no second question.

### Decisions (conservative readings, for the lead)

- **Colour vision stays hidden.** FH-20's plan item covers the setting, but T038's palette constant is not in dev
  (only on `local/T038-r2-fh20`), so nothing could read it. The lane that wires it flips `A11Y_WIRED.colourVision`.
- **Reset to defaults resets only the controls shown.** A hidden key keeps what the player stored while it was visible in
  step 1, so the choice takes effect when its feature lands.
- **FEEL-05's three advisor lines (GUIDE's hunk in §7.3) are done here**, as the plan's FEEL-05 lists them and its
  acceptance needs them; they are inert without `foundedDay`. The FH-10 newcomer bot founds on day 90 already, so its
  headline now comes on day 135 instead of 120 (and its random stream shifts from there); the default bot is identical.
- **`DISASTER_MIN_POP` moved into tuning.ts** (SIM's file, same value) so the dialog's note reads the number the
  simulation uses instead of typing 2,000.
- **Guided start and the veteran box live in the guide's profile pref** (`metropolis.ui.onboarding`), the only place the
  in-city guide reads today; they are written in both today's and the FH-22 framework's key names, so T037a needs no
  migration. With FH-18 not in yet, the veteran box skips the founding steps (it records `veteran` for the briefing).
- **The first difficulty for a profile that founded cities before FH-11** (no record, but a region with a city) stays
  Medium; a fresh profile gets Easy. `pickNiceTile` for quickstart and `?newcity=1` is unchanged (no flat term), so those
  test entry points open the same tiles as before.
- **First run** means none of `metropolis.settings`, `metropolis.settings.v1`, `metropolis.lastRegion`,
  `metropolis.lastSession` exist. The detected quality is saved at boot, so a later read agrees with it (this writes
  `metropolis.settings` on a fresh profile's first start, which step 1's check saw as "writes nothing until used").
- **After a context loss the game stays paused after Restore**: the acceptance compares the state hash after Restore,
  and the player resumes. The slow-frame prompt starts with the first rendered frame and is not retuned (W1.4 will move
  the sim off the main thread; FH-21 says to retune then).
- **Headless runs on High or Ultra will now see the slow-frame question once per profile** (SwiftShader is far under 25
  fps). Tools that seed settings can seed `metropolis.ui.slowPrompt` too; tools/qa-context-loss.mjs does.
- **Not measured here:** P-5's load time on its 4-core profile is a persona run (the readout and `App.lastLoadMs` are
  in place); SwiftShader's 41-52 s are not a real-GPU number.
