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
