# T010-landmark-art: the seven late-game landmark models (polish LG-02, its new-file art)
base: claude/beautiful-johnson-u2jqoz HEAD when you start (record the sha); branch local/LG-02-art
after: none (runs alongside T007-T009 under NOTE-002 / NOTE-005)
owns: new builders src/assets/builders/lm_*.ts (new files only), their manifest entries in src/assets/manifest.ts (one
  hunk, kept as its own commit: the lead merges it after render round 2 closes), gallery.html only if a new entry needs it,
  new tests under tests/render/** for the new models. No other render file: render round 2 is still editing src/render/**.
do:
  Why: docs/POLISH_PLAN.md D1 lists "new-file art (src/assets/builders/lm_*.ts)" as startable now, written against
  render round 2's materials.ts and registered in manifest.ts after it merges. LG-02 is round 3, one of the longest
  items, and its art is most of its size. Read LG-02 in docs/POLISH_PLAN.md (the table of seven rewards), the manifest
  header (triangle budgets: landmarks <= 8000), and the existing landmark builders (landmark.ts, lm_halls.ts, lm_lib.ts,
  lm_towers.ts) for the style, materials, LOD and night-window conventions.
  The seven models: Central Library, Grand Central Station (4x3), Stock Exchange, Botanical Dome, World Trade Center,
  Millennium Tower, Metropolis Crown. Each within 8,000 triangles, at least 2 variants unless unique, with LOD levels and
  night windows like the existing towers. Only the art and the manifest entries: the rewards, catalog, tourism and
  approval parts of LG-02 stay for round 3 (they depend on LG-10, PB-ZOO and R2-NIGHT).
  Codex writes the builders (one lane per two or three models); you review every diff and judge every model from
  real-GPU screenshots.
gates:
  - triangle counts per model and per LOD level, against the budget;
  - gallery.html renders every model and variant: day, night, winter, at street and default zoom, on the real GPU;
    look at every shot, and keep a small contact sheet per model under docs/dev/reports/local-T010-art/;
  - existing models and the town / dense-city renders are unchanged (screenshot diff of a few existing landmarks);
  - npx tsc --noEmit clean; npx vitest run passes (CRLF binary.test excepted).
report: docs/dev/reports/local-T010-landmark-art.md (each model: size, triangles per LOD, variants, contact sheet,
  what Codex vs you did); push local/LG-02-art with docs/dev/queue/T010-landmark-art.done; DONE.
