# Ready patches from render round 2 (seasons lane, revision 2, Oct 14)

These patches touch files outside the seasons lane, so the lane delivered them instead of editing those files. Each applied cleanly with `git apply --check` on Oct 14. Delete each one once it is applied.

| Patch | Files | Owner / when | Lead decision |
|---|---|---|---|
| `CityState_startApril.patch` | `src/sim/CityState.ts` | Polish pass FEEL-05, after part B's final fixes (lane sim-traffic-save owns CityState.ts until then) | Apply (D11: new cities start on 1 April) |
| `MiniMap_season.patch` | `src/ui/MiniMap.ts` | Polish pass FEEL-05 | Apply with the start-month patch |
| `BuildingRenderer_foliageDepth.patch` | `src/render/city/buildings/BuildingRenderer.ts` | Render, after round 2 closes | Apply: twig shadows in winter, measured free |
| `propLod_bareProxy.patch` | prop LOD (street trees) | Render, after round 2 closes | Apply: slim winter street-tree proxies |
| `kit_bareCrown.patch` | civ/com/ind/res_util/tr lot-tree helpers | Polish WORLD lane | HOLD: it adds +6.0% city building triangles. Apply only together with a LOW-quality strip of twig faces |

Lead decision on the open gate. The seasons lane's twig crowns add about +1.5% triangles at LOW quality, while LOW GPU time is at parity with 02464a3 (0.994). This is **accepted**: GPU time is the measure that matters, and triangles are only a proxy for it. A later LOW-quality strip of twig faces (BuildingRenderer) is welcome but not required.


## Lead decision, Oct 14 21:22 UTC (seasons revise r3)

kit_bareCrown.patch may be landed by the seasons r3 lane together with a LOW twig strip (minimal hook in BuildingRenderer.ts, marked "// seasons r3: LOW twig strip"). Gate: no LOW still-view triangle regression vs 02464a3. Otherwise keep holding it. Full text: scratchpad render2/seasons/r3/COORD.md.

## Seasons r3 status (Oct 14, revise r3)

| Patch | Status |
|---|---|
| `kit_bareCrown.patch` | **Applied** by seasons r3 together with the LOW twig strip (`src/assets/builders/winterTwigs.ts`; four small hooks in `src/render/city/buildings/BuildingRenderer.ts`, each marked `// seasons r3: LOW twig strip`: the import, the `twigVer` field, the registration in `geomFor`, the rebuild in `update`). With the strip on, every kit / park model has its 02464a3 triangle count; at low quality a bare kit crown collapses to its trunk (limbs would cost ~1% of the low preset's triangles). The patch file was removed; git history keeps it. |
| `lodProxy_bareDiamonds.patch` | **New**, for the buildings lane after its r3 closes (`src/render/city/buildings/lodProxy.ts`). The foliage diamonds of LOD proxies keep a bare crown's look at LOD range: the swap marker is cleared, so they do not vanish in winter, and the winter-only twig sprays (Foliage pattern 5) are no longer counted as part of a crown. |
| `BuildingRenderer_foliageDepth.patch` | **Applied** by the buildings lane (BLD r3): it reverse-applies cleanly to the working tree; the file can go. |
| others | Unchanged (owners and decisions as above); `CityState_startApril.patch`, `MiniMap_season.patch` and `propLod_bareProxy.patch` still apply cleanly (Oct 14, 23:30). |

## Seasons r3 resume status (Oct 19, revise r3 resumed after the weekly-limit stop)

| Patch | Status |
|---|---|
| `res_high_podiumTrees.patch` | **New**, for the residential assets owner (`src/assets/builders/res_high.ts`, no round-3 lane owns it). The podium-garden trees of `res_twin_towers` and `res_luxury_tower` are the last lot trees whose light-green crowns carry no bare winter crown (a census over every lot model, variant 0): in winter they keep the full crown in the shader's winter fallback look, a grey camo lump on a stick (reviewer view `tp/jan12_horizon_w`). The patch gives them `park_lib.bareCrown` like the kit trees (no rng draws, layouts unchanged): +15 triangles per tree at high quality, 2 fewer than the plain model at low quality (the low strip draws them as a Y, see below). `git apply --check` passes on the working tree (Oct 19, 23:05). |
| `lodProxy_bareDiamonds.patch` | **Applied** by the buildings lane (BLD r3, with a threshold change of its own, so the file no longer reverse-applies). Removed. |
| `BuildingRenderer_foliageDepth.patch` | **Applied** by the buildings lane (it reverse-applies cleanly). Removed. |
| `CityState_startApril.patch`, `MiniMap_season.patch`, `propLod_bareProxy.patch` | Unchanged: owners and decisions as above; all three still apply cleanly (Oct 19, 23:05). |

Low-quality twig strip, r3 resume: a bare crown on a plain trunk is no longer a bare pole at low quality. `stripWinterTwigs` (`src/assets/builders/winterTwigs.ts`) draws the trunk as a 4-sided (3-sided) spire up to the tip of the crown's leader and keeps the crown's limbs, as many as fit in the trunk's own triangles, so every lot model has at most the triangles of its plain (twig-free) model: kit trees 8 for the trunk's 10, park trees 10 for 10, com_kit box trunks 8 for 8, the ind_kit strut 6 for 6 (one limb). The hooks in `BuildingRenderer.ts` are unchanged.
