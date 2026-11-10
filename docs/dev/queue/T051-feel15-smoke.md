# T051-feel15-smoke: polish round 2, WORLD, FEEL-15 smoke that reads output
base: dev after T040 (R2) merges; branch local/T051-feel15-smoke
after: T040 (BuildingVisual lives in BuildingRenderer.ts).
owns: src/render/city/effects/Effects.ts (onBuilding); src/render/city/buildings/BuildingRenderer.ts
  (BuildingVisual.activity); new tests.
do:
  docs/POLISH_PLAN.md FEEL-15 (line 2486):
  - activity is jobs filled / capacity, times powered, for industry;
  - for plants it is max(0.25, the plant's share of its grid's load);
  - it is 0 when unpowered or under 10 % staffed;
  - the plume has four strength steps, and emitters rebuild only when the step changes;
  - the inputs come from the mirrored building state or UtilitiesView, never from sim reads.
gates:
  - The 0/340 refinery shows no smoke.
  - The 15 % coal plant shows at most 40 % of its full-load particles.
  - Emitters rebuild at most once per building per month.
  - tsc; the full vitest; the bot identical.
report: docs/dev/reports/local-T051-feel15-smoke.md. Push local/T051-feel15-smoke with
  docs/dev/queue/T051-feel15-smoke.done.
