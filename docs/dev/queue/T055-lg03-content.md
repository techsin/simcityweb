# T055-lg03-content: polish round 2, CONTENT, LG-03's defs and models
base: local/T046-lg03-projects, once its def fields are in; branch local/T055-lg03-content
after: T046 (buildMonths and the project def shape).
owns: src/sim/catalog.ts (the project defs); src/assets/** (the fusion, expo and space-center models, registered with
  pendingCatalog where their sim lands in round 3); src/game/toolCatalog.ts (CONTENT's part: the "Mega-projects"
  category in the Rewards flyout); gallery.html; new tests.
do:
  docs/POLISH_PLAN.md LG-03 (line 1631), the CONTENT part:
  - the defs for Express Metro (round 2);
  - the three round-3 projects' models now, with pendingCatalog for those whose sim waits;
  - the toolbar category.
  The models stay within the triangle budget and render by day, at night and in winter (the art pipeline's checks).
gates:
  - The catalog and manifest tests; the art checks (triangles, every variant renders).
  - Screenshots on the real GPU.
  - tsc; the full vitest; the bot identical.
report: docs/dev/reports/local-T055-lg03-content.md. Push local/T055-lg03-content with
  docs/dev/queue/T055-lg03-content.done.
