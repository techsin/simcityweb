# T050-feel14-weight: polish round 2, WORLD, FEEL-14 bulldozing and placement with weight
base: dev after T040 (R2) merges; branch local/T050-feel14-weight
after: T040 (BuildingRenderer.ts).
owns: src/render/city/buildings/BuildingRenderer.ts; src/render/city/effects/Effects.ts;
  src/render/city/CityObjectsView.ts; new tests.
do:
  docs/POLISH_PLAN.md FEEL-14 (line 2462):
  - the collapse: a detached copy of the removed instance (not keyed by id) sinks to 15 % of its height with a slight
    tilt over 0.35 s;
  - a dust cloud of 16-40 particles that lives 2.5 s;
  - more than 30 buildings at once share one merged cloud;
  - nothing plays beyond 2,200 m;
  - redevelopment plays at most 4 per second;
  - a landing ring for plopped buildings (lives 1.2 s), and an ash puff when rubble is cleared.
gates:
  - A 2x2 house bulldozed at 300 m shows 1.5-2.5 s of dust.
  - A 200-building drag adds under 4 ms and at most 600 particles, on the real GPU.
  - tsc; the full vitest; the bot identical.
report: docs/dev/reports/local-T050-feel14-weight.md. Push local/T050-feel14-weight with
  docs/dev/queue/T050-feel14-weight.done.
