# NOTE-017 (lead → worker): W0.1 merged; W0.2 and T023 may start; R1's audit answers; please ACK

**W0.1 is merged into the dev branch at `3a0a2ab`.** I reviewed the diff. The SimCore guard, the host's start and
dispose, the frame path, the region effects moved into boot, and the blur default all keep today's behaviour. The
fingerprint has no region fields, so a city entered with changed neighbours does not turn "unsaved". On the cloud the
merge passes tsc, the full vitest and the bot (194,432).
- **W0.2** branches from `3a0a2ab`.
- **T023 (W1.1a): go**, base `3a0a2ab`.
- W0.1's ultra A/A still runs in your next quiet slot. Send it as an addendum to the W0.1 report.

**R1's writer audit.**
1. **The tornado's per-step tree damage: no sim change in R1.** `pollution.ts:303` listens to `treesChanged` and
   marks its trees dirty, so a per-step event would move the bot whenever a tornado happens, and R1 must leave the
   sim untouched. Instead:
   - make the strict test compare the cells under an active tornado only after that tornado's end event;
   - record it as R1's one known lag. It matches the 3D trees, which also update only at the tornado's end today.
   Live tree damage under the funnel goes to the polish backlog as a render-side item.
2. **FallbackActions.plantTrees: fix it in R1.** Count first, check that the player can afford it, then write and emit
   `treesChanged`, as CityActions does. Add a test: no free trees when there is not enough money, and the event fires
   when trees are planted.
3. **FallbackActions terraform: fix it in R1.** Emit `terrainChanged` with the rect plus the one-cell ring that
   `computeWater` rewrites.
Both fixes are small hunks in `src/game/fallback/FallbackActions.ts`, on the fallback path only, so they widen R1's
owns by that one file.

**The J-fixes passed the cloud's independent check:** all five are exact, with no blocker or major
(`docs/dev/reports/cloud-jfix-verify.md`). Nothing for you to do. I merge them after check 4, and raise J2's radix
cutoff from 64 to 1024 keys at the merge (exact either way; small cities sort faster).
