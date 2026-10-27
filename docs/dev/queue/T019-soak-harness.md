# T019-soak-harness: the multi-hour soak harness for the final verification (#28)
base: claude/beautiful-johnson-u2jqoz HEAD when you start (record the sha); branch local/T019-soak
after: none (new files only); a Codex lane at below-normal priority. Its smoke run is a browser run, so schedule it
  between timing runs
owns: new files only, under tools/soak/** (with a README)
do:
  Why: the final verification includes a multi-hour soak on this machine. Building the harness now takes it off the
  end of the critical path.
  The harness:
  - builds the production bundle (npm run build), serves it with vite preview, and drives the game in headless
    Chromium on the real GPU through Playwright + CDP, with coordinate input only (the T013 probe pitfall);
  - plays a chosen city for N hours: a big test city (tools/bench/.fixtures dense1m, or the shared vet_s7_y43 991k) at
    ultra, plus a newly founded small city;
  - every K minutes runs a fixed action cycle:
    - inspect a growable and a service building, open every panel and a few data views;
    - zone, build a road, bulldoze;
    - save, exit to region and re-enter;
    - switch quality LOW / HIGH;
  - records over time:
    - JS heap and DOM node counts (CDP, with an objectGroup on every call);
    - CityScene / CityState / WebGLRenderer counts after each exit (queryObjects);
    - long tasks (>= 50 ms), frame-time p50 / p99 / max, sim days per second;
    - console errors, page crashes and WebGL context losses;
  - writes a JSON log and a short Markdown summary with pass / fail lines:
    - heap growth per hour below a threshold;
    - 0 cities left after an exit;
    - no errors and no crashes.
gates: a 20-minute smoke run on this machine produces the JSON and the summary; one run per city type; nothing under
  src/** changes; npx tsc --noEmit clean if any of it is TypeScript.
report: docs/dev/reports/local-T019-soak.md (how to run it, the smoke run's summary, what is left for #28); push
  local/T019-soak with docs/dev/queue/T019-soak-harness.done; DONE.
