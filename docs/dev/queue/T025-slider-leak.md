# T025-slider-leak: check 4's two audit minors (the slider retention and the leakprobe positive control); a Codex lane
base: 2ba03fa (the dev branch with W0.2 merged); branch local/T025-slider-leak
after: none (W0.2, which also changes BrushTool and the Budget panel's callbacks, is merged). Priority: below the W0 lanes.
owns: src/ui/dom.ts (slider, setSlider), src/game/tools/BrushTool.ts (its `__paint` use), src/ui/panels/SettingsPanel.ts
  and src/ui/panels/BudgetPanel.ts only where they use `__paint`, tests/game/fakeDom.ts, tools/leakprobe/**, and tests.
do:
  Read finding 1 and finding 2 of docs/dev/reports/local-T017-audit-c4.md in full.
  1. **The slider retention (finding 1).** `slider()` puts a `__paint` expando on each element and hooks
     `signal.addEventListener('abort', () => delete el.__paint)`. That closure keeps every slider, and its detached
     panel subtree, alive until the city exits: about 48 KB per game month with Budget open, about 2 MB a minute at
     ultra. Drop the per-element abort hook. Paint goes through a module-level `paintFill(el)` that reads el.min,
     el.max and el.value, used by setSlider and BrushTool instead of the expando, so nothing on the element reaches the
     city. Keep the `{ signal }` options on the element listeners. The auditor showed that Chromium does not keep
     elements alive through them.
  2. **fakeDom fidelity.** tests/game/fakeDom.ts implements `signal` with abort listeners that hold every element,
     unlike Chromium, so the node tests cannot see this class of leak. Make it match Chromium: `{ signal }` options
     must not keep the target alive. Add a node test that would have caught finding 1.
  3. **The leakprobe positive control (finding 2).** Count CityScene and CityState in the city too, before the exit,
     and fail when the in-city count is not ≥ 1. Then a prototype that resolves to another module instance can no
     longer pass vacuously.
  4. **A browser check:** keep Budget open for 40+ game months at speed 3 (taxes tab, then services tab) and assert
     the HTMLInputElement and DOM node counts stay flat (± 5 %). Add it to tools/leakprobe as a mode.
gates: the new browser check passes, and it fails on the base; leakprobe passes in all 4 modes plus the new one, and
  its positive control trips if pointed at a wrong module; npx tsc --noEmit clean; npx vitest run passes; the bot is
  unchanged (UI only).
report: docs/dev/reports/local-T025-slider-leak.md; push local/T025-slider-leak with docs/dev/queue/T025-slider-leak.done;
  DONE.
