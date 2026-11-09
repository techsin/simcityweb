# T052-feel17-garbage: polish round 2, WORLD (+ CONTENT's props), FEEL-17 uncollected garbage shows on the street
base: fb1531f (dev); branch local/T052-feel17-garbage
after: none (PB-GARBAGE is merged).
owns: src/render/city/props/PropRenderer.ts; src/render/city/CityObjectsView.ts (a small hunk);
  src/assets/builders/prop.ts (CONTENT's part: two bag and bin prop variants); new tests.
do:
  docs/POLISH_PLAN.md FEEL-17 (line 2512) in full.
  - 1-4 instanced bags or bins sit at the road front of each lot whose building has BF.NoGarbage. They are drawn below
    900 m only. They build up over 1-2 months and clear the same way, deterministically from the building id and the
    day: no RNG draws, no sim writes.
  - The flag comes from the mirrored building state the renderer already receives (building events, ctx.state), never
    from a sim read.
  - Two prop variants (bag, bin) in one instanced mesh: +1 draw call in total.
gates:
  - tsc; the full vitest; the bot identical.
  - Unit tests: placement at the road front; the build-up and clearing timings; the 900 m cut.
  - Real GPU (the worker):
    - at 300 m, bags show at ≥ 90 % of NoGarbage lots;
    - ≥ 90 % are gone within 2 months of connecting a landfill;
    - on the 287k save, or bot256_s7_y20/y60: +1 draw call and at most 5 % more triangles;
    - screenshots.
report: docs/dev/reports/local-T052-feel17-garbage.md. Push local/T052-feel17-garbage with
  docs/dev/queue/T052-feel17-garbage.done.
