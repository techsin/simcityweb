# W0.5 views QA

Status: **not run**. The lead runs this checklist on `local/W0.5-views` with LocalSimHost, against base `2ba03fa`.
The overlay hook and O9 readiness handling are implemented. The lead authorized `src/sim/infra/overlays.ts` as the
sole simulation-directory exception. This checklist records pending manual checks, not results.

Use disposable copies of the same fixed-seed saves in both builds, including `small_s7_y10` and `bot256_y60`.
Record the fixture checksum, seed, simulation day, browser/version, viewport, device scale, graphics quality,
camera position/zoom/rotation and time of day. Keep the console open. Pause at the same simulation checkpoint,
let pending infrastructure work settle, disable automatic time of day, and keep moving vehicles/particles out of
the comparison region or capture at the same animation time. Compare images and hover readouts at fixed cells.

## Every data view and variant

For every row, open the data view, select each listed variant, hover representative cells, switch away and back,
and capture the terrain plus the legend. Check both the Data views panel legend and the bottom-left legend chip.
Include the default variant (`-1`); Desirability defaults to R$$. The fixed-seed screenshot diff is the gate.

| View | Variants/checks |
|---|---|
| None / Zones | Normal terrain; every zoning colour/density; returning from a data view clears its tint |
| Land value | Low, medium and high values |
| Desirability | All 12 development types, then Families, Seniors, Students; roads/water remain neutral where applicable |
| People (Demographics) | Children, Teens, Young adults, Seniors, Workforce, Wealth; whole home footprints |
| Shops / Tourism / Prestige (NIMBY) | Shops reach, visitor intensity, prestige and stigma |
| Crime / Police / Fire / Health | Crime and the three coverage views |
| Education | All, Elementary, High school, University |
| Parks | All, Play & sports, Gardens & parks |
| Emergency | Fire, Police, Medical; auto, near, far, no station and no road |
| Air pollution / Water pollution | The same field values; Air's wind arrow agrees with the smoke |
| Garbage | Uncollected piles, Landfill fill |
| Noise / Soil | Quiet/noisy and clean/contaminated locations |
| Traffic | Cars and Trucks; road, intersection and curb cells, including a freight-heavy route |
| Transit / Commute / Parking | Transit reach, commute scale/readout and parking pressure |
| Power | Served/unserved buildings, roads and zoned lots |
| Water | Service and Tap water quality; served/unserved cells, clean and polluted networks |

- [ ] Every listed view/variant renders identically to the baseline after its data is available.
- [ ] Switching variants retains the selected variant when returning to the view.
- [ ] Hover readouts agree with the rendered cell, including the Traffic curb cells and Emergency footprint fill.
- [ ] Colour ramps, nearest/linear filtering, labels, notes and scale are unchanged.

## O9 readiness

LocalSimHost has live arrays; ordinary local switching cannot reproduce delayed worker delivery. Use the supplied
`tests/infra/overlaySources.test.ts`, `tests/render/overlayReadiness.test.ts` and `tests/worker/viewSources.test.ts`,
or the later loopback host with delayed first subscriptions, for the missing-data cases. The later host must bind
loaded-layer/stream readiness and delivered raster versions, and re-register on fresh state adoption.
Do not count an ordinary local screenshot as proof of delayed-subscription behavior.

- [ ] A never-shown subscribed view has no terrain overlay and says **Loading…** until its first data arrives.
- [ ] The first data enables the correct overlay without another click, including a first raster arriving while paused.
- [ ] Returning to a previously shown view uses its cached data until the update arrives.
- [ ] A resync discards the old data: a missing layer/raster returns to the same loading state.
- [ ] Receiving another view's data does not enable the current variant.
- [ ] Hover before the next frame: a same-day supplied raster version still refreshes the terrain exactly once.
- [ ] Check both the Data views panel and legend chip: unavailable views say **Loading…**, and ready views return
      to the existing legend on their normal refresh cadence.
- [ ] None and Zones remain available while subscribed data is missing; direct Education/Parks tiers and
      main-built NIMBY/Emergency/Trucks wait for their own inputs.

## News beyond the 200-item cap on bot256_y60

- [ ] Import and enter `bot256_y60`. Record `scene.host.newsSeq` and `scene.host.state.news.length` via the existing
      `window.__metropolis.city.scene` harness hook. A loaded 200-item log starts the host sequence at 200.
- [ ] Run the city at ultra until multiple new items arrive while the retained log remains at 200. For every new
      `news` event, the host sequence advances; the ticker's newest item matches the newest retained item.
- [ ] Keep Advisors & news on News feed. It refreshes after its existing one-second gate and shows the same latest
      headline. Close/reopen it and confirm the feed remains current.
- [ ] Hover pauses ticker scrolling; news clicks still focus their location or open the news panel. Ticker layout
      measurement remains tied to ResizeObserver/rebuilds, with no new per-frame layout reads.
- [ ] Exit/re-enter. News from the previous host no longer advances its sequence after city abort/disposal.

If natural news is too sparse, document a separate synthetic check using `scene.host.sim.notify(...)` on a
disposable fixture; label it synthetic and retain the natural `bot256_y60` run as the acceptance check.

## Emergency, Traffic and Utilities views

- [ ] Emergency: start an uncovered medical incident/fire using the existing QA fixture or disaster tool. The
      incident, station list/name/fleet, vehicles, positions and arrival timing match the baseline. Pause/resume and
      speed changes keep the renderer's emergency time in step with `host.simTime()`.
- [ ] Dispatch uses the existing tagged `host.act` path, with unchanged feedback, sirens and LIVE behavior. Check
      all three Emergency overlay variants against their hover readouts.
- [ ] Traffic: car/service routes and raw freight volumes agree with the baseline. Switch Cars/Trucks repeatedly;
      parked/returning service vehicles, road highlights and truck hover volumes remain correct.
- [ ] Utilities: check Power, Water service and Tap water quality. Compare clean and polluted pump networks,
      treatment, a served building and a dry lot. The quality view uses the same supplied raster as its readout.
- [ ] MiniMap: in Power view, disconnect/reconnect a district and wait for `layerUpdated('utilities')`. With no
      subsequent map/building event, the map repaints at its existing cadence (up to 0.8 s). Toggle Power off/on.
- [ ] Exit with a data view, Advisors and an incident visible; re-enter another city. Retained old controls remain
      silent, abort reason is `dispose`, and the null views/guard-holder teardown remains intact.

## Lead gates

- [ ] Run the suites named in `reports/local-W0.5-views.md`, then the full suite.
- [ ] Run the 128 × 15 seed-7 bot: **196,101 residents in 2015**, split **[59,288, 95,301, 41,512]**, and every
      non-timing field identical to B1/`2ba03fa`. The old 194,432 figure in T020 is superseded by NOTE-023.
- [ ] Load old saves and compare their continuation against the baseline.
- [ ] Record screenshot diffs, browser checks and console errors; resolve all pending items before marking DONE.
