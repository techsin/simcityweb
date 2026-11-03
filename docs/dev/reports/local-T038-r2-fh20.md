# T038: R2's incremental Fireworks.collectLaunchSites, and FH-20's Emergency palette

Task: `docs/dev/queue/T038-r2-fireworks-fh20.md`. Plan items: `docs/WORKER_DESIGN.md` §6 row R2 (and §3.4's "the
remaining spike is render-side: `collectLaunchSites` walking every building"); `docs/POLISH_PLAN.md` FH-20 (round 1
takes only the Emergency view's palette). NOTEs naming T038: 033, 035, 037, 038, 042, 044.

The desktop wrote the code as a Codex lane on `local/T038-r2-fh20` (base `93069fa`, 2 commits) and stopped at the
Oct 28 usage limit with no report and no `.done`. The cloud carries it over on `cloud/t038`.

## Cloud carry-over (Nov 3)

### Gap list (required against done, at the start)

| # | required (task file, plan, NOTEs) | state on `local/T038-r2-fh20` |
|---|---|---|
| 1 | R2: `Fireworks.collectLaunchSites` incremental, kept up to date from building events, instead of a full scan at New Year | code done (`LaunchSiteIndex`, wired in `CityObjectsView`); WIP commit, to verify line by line |
| 2 | R2: measure the scan's cost at 1M before and after, in the quiet slot ("sized on R1") | **not done** (the harness had a `timeLaunchSites` helper and no runner, no numbers) |
| 3 | gate: New Year launch sites identical to the full scan on bot256_y60 and dense1m | tests written (random building events on both fixtures); to re-run here. No run through a real New Year |
| 4 | FH-20: the colour-blind-safe Emergency palette, keyed on `colourVision`; until the key lands, standard behind a constant | done behind `EMERGENCY_COLOUR_VISION = 'standard'`. The key has since landed in dev (T036 step 1), hidden by NOTE-042 (`A11Y_WIRED.colourVision = false`); the constant's comment still said "has not landed" |
| 5 | FH-20: distances with the plan's method (Machado 2009, linear RGB), above the floor (120) for deuteranopia and protanopia | test written (reproduces the plan's 66 / 56 / 79 / 124 reference values first) |
| 6 | FH-08 / FH-20: the texts name legend labels, never colours | safe-mode notes done; one note named "Out of reach" for the third band, which is the second band's label |
| 7 | gate: screenshots of the Emergency view in each mode | **not done** |
| 8 | gates: tsc, the full vitest | not run on the merged tree |
| 9 | report, `.done` | **not done** |
| 10 | base: 197 commits behind dev | merge needed |
