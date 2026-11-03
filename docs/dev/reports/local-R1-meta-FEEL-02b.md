# T036s4 · FEEL-02b quiet autosave

Branch: `local/T036s4-storage`; base: `821a8d6`. Changes are uncommitted; no `.done` file was changed.

## Changes by file

- `src/game/CityScene.ts`: a monotonic `performance.now()` floor of 60,000 ms, initialized on scene entry and reset after every successful save. Month eligibility stays pending until the first month end meeting both the game-month setting and real-time floor. App/hidden saves call `recordSaved()` too. Read-only regions cannot autosave or manually save. An explicit guided Retry bypasses the automatic floor while retaining silent autosave feedback, including when the city write succeeded but its subsequent region write failed.
- `src/ui/Modals.ts`: `SavePill.saving(true)` and its completion never show the pill; successful autosaves play no sound in CityScene. Manual saves retain their pill/chime. Pause-menu Save follows region write permission; exit remains usable in a read-only tab.
- `src/ui/panels/SettingsPanel.ts` and `src/region/ui/dialogs.ts`: both enabled labels now read “Every N game months, at most once a minute”.
- `src/main.ts`: tiny optional `recordSaved()` scene contract and notification following a successful `host.save`, including saves made outside CityScene. The surrounding storage/error/lock hunks are listed in the NEW-04 report.
- New `tests/game/autosaveFloor.test.ts`: first eligible 1× month, five silent ultra autosaves in five simulated minutes, manual/hidden resets, slow-write completion, read-only/off settings, quota Retry, partial-save Retry despite the floor, silent SavePill and pause-menu permission.
- **Outside-named existing test:** `tests/game/citySaves.test.ts` fixture/expectation adjustments for the real floor and guided-error routing.
- `src/ui/hud.css` needed no change: autosave is silenced in SavePill without changing the manual pill's CSS.
- **Infra hunks:** none. No simulation, balance, save schema or RNG change.

## Validation and gates left

- **PASS:** `npx tsc --noEmit`; `git diff --check`.
- **PASS:** native Node storage-helper probe, described in the NEW-04 report. This does not claim to execute the autosave UI tests.
- **Unit tests pending:** Vitest startup failed with Vite `spawn EPERM` on the quiet-gated `tests/storageDb.test.ts` command. No Vitest test ran, including the new floor tests or existing `citySaves.test.ts`. Run those single files through the quiet gate with `--maxWorkers=1`; the full suite remains for the lead.
- **Bot pending:** the command below failed before simulation with npm `ENOTCACHED` for `tsx`. Its output is in the task scratch folder as `bot128x15_s7.log`. No observed bot numbers; expected unchanged 2015 residents are `[61124, 93804, 37971]` = **192,899**.

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

No browser, full suite, benchmarks or 256-tile bot was run.

## Plan versus code / cloud handoff

- W0.6's existing `opts.onSave` → App → `host.save` route is preserved; recovery remains through the host. No state is serialized by the UI.
- Host acknowledgements are the available save signal; there is no saved-time watch. `recordSaved()` supplies the tiny App integration for hidden saves.
- The Worker's future 30-second floor is not in this base. The UI's 60-second floor will remain the larger limit.
- The post-W1.3 crash/journal acceptance is deferred as the task requires. Worker quota-name and ownership-fence requests are specified by file/function in `local-R1-meta-NEW-04.md`; no worker file was edited.

## Browser acceptance checklist for the lead

- [ ] With the real Worker and a 100k+ city, run five minutes at ultra: **at most five autosaves, zero autosave chimes, zero autosave pills**; only the minimap save chip updates.
- [ ] At 1× with the default three-month setting, manually save, then observe no autosave at 45 seconds and an autosave at the first month end at least 60 seconds later (normally the fourth game month).
- [ ] Confirm Ctrl+S still shows its pill/chime, and hidden/App saves restart the one-minute floor.
- [ ] Force a partial city-save/region-save failure, then click Retry inside the minute. Confirm a real retry with silent autosave feedback.
- [ ] Confirm autosaves remain off after another tab takes the region lock and resume only after takeover reloads current data.
- [ ] **After W1.3:** kill the tab 50 seconds after an autosave. Restore must offer a snapshot at most **30 real seconds / 90 game days** old, plus every journaled edit.
