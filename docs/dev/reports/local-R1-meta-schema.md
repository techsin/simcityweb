# T036 step 1 — the settings schema (POLISH_PLAN §7.5) and the title screen's "Accessibility & interface"

Branch `local/R1-meta-schema` on dev `93b84a7`, with dev merged in before the push. The code was written by an agent lane
(Codex was out of credits) and reviewed, gated and browser-checked by the local worker.

## What it does

Every §7.5 key now has a home, with its default and its loader check. No consumer reads the new keys yet: each comes with
its item. The one behaviour change is UI scale: set on the title screen it now reaches the city, and a change made in the
city now persists to the app settings.

| Store | Keys |
|---|---|
| App, `metropolis.settings` (v2 -> v3; src/region/settings.ts) | `uiScale` (moved here; 0.7-1.5, default 1; read from the in-game store when the app store has none), `textSize` (0, 10, 20 or 30 percent points), `motion` (`system` / `full` / `reduced`; `resolveMotion` reads prefers-reduced-motion on each call), `colourVision` (`standard` / `red-green` / `blue-yellow`, the names of T038's palette) |
| In-game, `metropolis.settings.v1` (src/game/settings.ts) | `tips`, `cameraMoments`, `newYearPacing` (`milestones` / `everyYear`), `problemIcons` (`off` / `query` / `always`), `yearReview`, `panSpeed` (0.5-2), `invertOrbit`, `keyBindings` (action id -> KeyboardEvent.code), and the city's copies of `motion`, `textSize` and `colourVision`; T008's `musicPauses` and `muteInBackground` as they were |

- **Loading.** Only known keys are read. An older key must have its default's type, so today's stored settings load
  unchanged; a new key must pass its check, and the ranges are clamped. Unknown keys are dropped on the next save (before,
  the app store kept them).
- **Hand-off.** `cityOverrides()` gives CityScene the shared keys, and `takeCityChanges()` takes them back after an in-city
  change. That needed a small hunk in src/main.ts (`enterCity`); without it, main.ts re-saved its stale copy on every
  in-city change and overwrote the city's UI scale.
- **Title screen.** A new section between Graphics and Gameplay: the UI scale slider, Text size, Motion (with "Your device:
  full / reduced" under System), Colour vision, and "Reset to defaults" for those four. Each control saves at once.
- **SettingsPanel.** The in-city UI scale row uses the shared range.
- **Tests.** tests/game/settingsSchema.test.ts (19: defaults, round trips, today's stores, migrations, invalid values,
  clamping, the hand-off, a main.ts source check) and tests/game/titleSettings.test.ts (6: the section, a fresh profile
  writes nothing until used, immediate saves, the next city opens with them, reset, the System label).

## Review and gates (the local worker)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| Full vitest (with the fixtures) | **188 files passed, 1 skipped; 1,913 tests passed, 7 skipped** |
| The bot (128x15, seed 7) | identical to `93069fa`, action log included (196,101) |
| Browser check (below) | **8 of 8 pass** |

The review found nothing to change. The browser check ran in Playwright's Chromium 141 on the RTX 5070 Ti (ANGLE, D3D11),
with small_s7_y10 imported:
1. Fresh profile at 1280x720 and 1366x768: the four sections in order, the defaults, nothing clipped, the body scrolls.
2. Reduced motion (emulated): System reads "Your device: reduced", and "full" without it.
3. 17 control uses: each wrote `metropolis.settings` at once with v: 3, and the values survived reopening and a reload.
4. Reset to defaults reset the four keys and left quality, New Year, edge scrolling and FPS alone.
5. The region screen's Settings shows the same section and values; a change there shows on the title screen.
6. 130% on the title screen reaches the city (HUD button 48.3 px against 37.0 px at 100%, x1.305), and in-city Settings
   read 130%; 90% set in the city reads 90% on the region and title screens, with 0.9 stored.
7. An old v2 profile with in-city UI scale 1.2: the title shows 120%, the city opens at 120%, and quality Low and the
   1-year autosave are unchanged.
8. Text size, motion and colour vision change nothing yet (title pairs differ by 0 pixels; the city HUD pairs differ only
   in the scrolling ticker, as in a two-defaults control). No console or page errors. Tab reaches the slider, every option
   and Reset; Enter and Space select.

**Two older keyboard gaps the check found** (not this lane's code; minor, for the backlog):
- Opening Settings leaves focus behind the backdrop: Tab walks 7 background controls before it reaches the dialog. Fix:
  focus the dialog on open, keep Tab inside, restore focus on close (src/region/ui/modal.ts).
- The switches (Play music, Mute all, Interface sounds, Hover sounds, Edge scrolling, Show FPS) are out of the Tab order:
  `.toggle input { display: none; }`. Fix: hide the checkbox visually instead, with a focus ring on the switch
  (src/region/ui/meta.css, modal.ts's `toggle`).

## For the lead

- **`tips` has two homes.** §7.5 and §4.1 make it a setting (added here as `GameSettings.tips`), while FH-22 / §4.8 keep
  tips in `loadPref`, and R1-guide-a stores `GuideProfile.tips` in `metropolis.ui.onboarding` (its "don't show again, all
  cities" sets it false). Pick the source of truth before a Settings row is wired.
- **Three title-screen controls do nothing visible yet:** text size, motion and colour vision wait for FH-23, FEEL-21 and
  FH-20. Hide them until their consumers land, or ship them as they are.
- **Wording:** `motion` stores `system`, not a value computed at load (a computed one would freeze the first time anything
  is saved). With the OS at reduced motion the option reads "System" with "Your device: reduced"; FEEL-21's acceptance says
  it "reads Reduced".
- **Units and homes the plan leaves open:** `textSize` is in percent points (the factor is 1 + textSize / 100).
  `disasterRate` and `crises` are per-city config (src/sim/config.ts; LG-15, LG-25), and §7.6 also lists `disasterRate`
  under SimSettings. First-run quality is FH-21's, and its remembered answer needs a key §7.5 does not list.
- **No dead rows:** FH-19's pan speed and invert orbit have no consumer yet (T027 added none), so the panel has no rows for
  them.
