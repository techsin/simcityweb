# T006-early-soak: early multi-hour soak on the real GPU (leaks, crashes, slowdowns)
base: claude/beautiful-johnson-u2jqoz HEAD at the time you start (record the sha)
after: T005 (overnight is fine; it is mostly waiting)
owns: docs/dev/reports/local-T006-early-soak.md and docs/dev/reports/local-T006-early-soak/ (small evidence); no src edits
do:
  Why: an 8.5 h SwiftShader run once hit a renderer crash; final verification needs a multi-hour session without memory
  growth. Find problems now, while there is time to fix them.
  1. Headless Chromium on the RTX 5070 Ti, HIGH quality, 1920x1080, the 300k city (vet_s7_y21 from the bot, as in T003),
     ultra speed, for 6 hours. Every 10 min drive a short scripted camera tour (pan, zoom-out, zoom-in, orbit) and open/close
     a few panels; every 60 min do one Save & exit to region and re-enter.
  2. Sample every minute: JS heap (performance.memory or CDP Runtime.getHeapUsage), DOM node and listener counts
     (CDP Memory.getDOMCounters), renderer.info memory (geometries/textures/programs) if exposed, GPU-process and renderer
     process RSS (from the OS), frame-time p50/p99 over the last minute, sim day reached, population, and console errors.
     After each exit/re-enter: CDP HeapProfiler.collectGarbage + Runtime.queryObjects for the CityScene / WebGLRenderer /
     HTMLCanvasElement prototypes (must return to the same counts).
  3. Plot or tabulate the trends; flag any steady growth (rate per hour), crashes or context losses, frame-time drift.
gates: no source edits; if the page crashes, record the time, the last samples and the console, restart, and continue
report: docs/dev/reports/local-T006-early-soak.md (trend table per hour, findings with severity, suggested fixes); push
  local/T006-early-soak with the .done file; DONE. PROGRESS at most every 2 hours.
