# T049-new02-noroad-model: polish round 2, WORLD, NEW-02 unreachable buildings show it on the model in the Emergency view
base: dev after T038 (the Emergency palette in overlays.ts) and T040 (R2) merge; branch local/T049-new02-noroad
after: T038 and T040.
owns: src/render/city/buildings/BuildingRenderer.ts or src/render/world/overlays.ts, through the overlay uniform path:
  a per-building lookup texture the overlay shader samples, or a per-instance attribute. Never an instance flag bit.
  Plus new tests.
do: docs/POLISH_PLAN.md NEW-02 (line 1156) in full. It reads overlayReadout (replica-safe).
gates:
  - A roadless Obelisk shows red on its model in Emergency · Fire at 300 m and 700 m.
  - Buildings with road access are unchanged (A/B screenshots).
  - No amber ring anywhere.
  - tsc; the full vitest; the bot identical.
report: docs/dev/reports/local-T049-new02-noroad.md. Push local/T049-new02-noroad with
  docs/dev/queue/T049-new02-noroad-model.done.
