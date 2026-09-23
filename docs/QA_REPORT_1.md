# QA playtest report #1 (real-input playtest, 1280x720, SwiftShader)

Blockers fixed immediately by the lead (src/ui/hud.css):
1. Closed tool flyout (.flyout, opacity 0) still intercepted pointer events over the lower-middle map -> placements/drags silently failed.
2. Closed RCI popover (.rci-pop carries .i => pointer-events:auto) intercepted clicks at top-centre (incl. Settings > Quality buttons).

Routed to qa-fix-round-1 workflow: save-on-reload/close (major), "why nothing grows" advisors/onboarding (major UX),
HUD net incl. loans, FPS clamp, flyout rAF race, disaster tool feedback, destructive-action confirmation, 720p layouts,
flyout name truncation, stale tooltip, help copy, start paused + camera on land + restore camera, double save on exit,
region currency, region dialog 720p, flavour news repeats, rail bridge slope rule, camera max zoom vs map size.

Routed to sim-depth part B: plopped buildings never age (population.ts); growth ~42% below HEAD in the mid-edit tree (verify vs baseline).
