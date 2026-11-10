# T047-feel09-follow: polish round 2, WORLD, FEEL-09 follow the truck you sent
base: fb1531f (dev); branch local/T047-feel09-follow
after: none. FEEL-08, W0.5's EmergencyView and PB-ACCIDENT are merged. The cloud's FH-08 (T036 step 5) also edits
  EmergencyBanner.ts, so keep the banner hunk small and in its own commit. Whichever merges second resolves the
  conflict (NOTE-046 Q3).
owns: src/render/world/CameraController.ts (the follow API); src/render/city/vehicles/EmergencyVehicles.ts (the lead
  vehicle's position for a dispatch); src/ui/EmergencyBanner.ts (WORLD's round-2 hunk: the Follow button and the
  chip); src/game/CityScene.ts (WORLD hunk); new tests.
do:
  docs/POLISH_PLAN.md FEEL-09 (line 1098) in full, and FEEL-08 (line 2412) as merged.
  - After a player dispatch, the banner shows "Follow" with a camera icon. A player dispatch is DispatchTool or the
    banner's Send nearest, recognised by host.cause, never by text.
  - Following keeps the camera target on the lead vehicle, smoothed with λ = 6. The position comes from the
    EmergencyView feed or the vehicle renderer's own state, never from a sim read. The player's yaw and tilt are kept,
    and the distance eases to 260 m.
  - Following ends 2 s after the unit is on scene, or on any pan, zoom or orbit input.
  - A chip reads "Following Fire truck from Fire Station #1 · 1.1 min".
  - It covers player-dispatched units only; auto-dispatched units never show Follow. It moves the camera only.
  - Reduced motion (settings.motion through resolveMotion): no smoothing overshoot. Say what changes.
gates:
  - tsc; the full vitest; the hygiene test; the bot identical (192,899).
  - Unit tests: the follow smoothing (no step over 3 px at 60 fps at the scenario's speed); the end conditions;
    auto-dispatch shows no Follow.
  - Browser, real GPU (the worker), in the Refinery scenario (an industrial fire, then Send nearest):
    - the truck stays in the central 30 % of the screen for the whole drive at LIVE;
    - no frame-to-frame jump over 3 px at 60 fps;
    - control returns 2 s after the unit is on scene;
    - any drag ends Follow.
report: docs/dev/reports/local-T047-feel09-follow.md. Push local/T047-feel09-follow with
  docs/dev/queue/T047-feel09-follow.done.
