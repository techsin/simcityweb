# T036s4-new04-feel02b: T036 step 4 on the desktop (NOTE-047 item 4): NEW-04 storage you can trust, FEEL-02b's autosave floor
base: 821a8d6 (dev); branch local/T036s4-storage
after: none. FEEL-02b's recovery check waits for W1.3 (the cloud's T039).
owns:
  - src/save/db.ts (the persist and estimate helpers);
  - src/region/RegionScreen.ts (the backup reminder, Manage storage);
  - new src/ui/StorageDialog.ts and its CSS;
  - src/game/CityScene.ts (META hunks: save routes storage errors to the dialog; onMonth's autosave floor);
  - src/ui/Modals.ts (SavePill: autosave is silent; Ctrl+S keeps its pill and chime) and src/ui/hud.css;
  - the two labels: src/ui/panels/SettingsPanel.ts and src/region/ui/dialogs.ts;
  - new tests.
  **src/main.ts is the cloud's App wiring (T034/T039).** NEW-04 needs it for three things: the persist() call inside
  the "Found" click, the Web Lock while a region or one of its cities is open, and the save errors on exit. Keep each
  of those a minimal hunk in its own place, list them, and put anything larger behind a function in a file you own.
do:
  docs/POLISH_PLAN.md NEW-04 (line 2339) and FEEL-02b (line 2216) in full; D16 (a lock per region) and D6 in §11.
  - Saves go through host.save and host.snapshot (W0.6).
  - The Web Lock: navigator.locks, one per region.
    - A second tab on the same region cannot save: its save buttons are disabled and autosave is off.
    - "Use it here instead" moves saving to the second tab, and the first tab shows "This region is now open in
      another tab".
    - Use the lock API's own steal or request flow; say how the first tab learns it lost the lock.
  - The autosave floor: never sooner than 60 s of real time after the last save. When the Worker's own 30 s floor
    lands, the larger of the two applies.
  - Autosave is silent: no chime and no pill, only the minimap chip.
  - Both labels read "Every N game months, at most once a minute".
gates:
  - tsc; the full vitest; the bot identical (192,899).
  - Unit tests: the floor (at 1×, an autosave at the first month end at least 60 s after the last save); the silent
    autosave; QuotaExceededError → the guided dialog (Export, Manage storage, Retry), never the raw exception;
    persist() called once inside the founding click; the lock handover with a fake navigator.locks.
  - Real-GPU browser checks (the worker):
    - two real tabs on one region: the second cannot save, then the handover works both ways;
    - 5 minutes at ultra on a 100k+ save: at most 5 autosaves, 0 chimes, 0 pills;
    - the quota path, by stubbing the store in the page;
    - persist() resolving false shows the backup reminder until an export.
report: docs/dev/reports/local-R1-meta-NEW-04.md and local-R1-meta-FEEL-02b.md; lines in
  docs/dev/queue/T036-polish-r1-meta.done.
