# T010 fix round: LG-02's seven late-game landmarks (cloud, Oct 28)

Branch `t010-finish` (local only) on the dev head `f69166d`, code head **`326fdd0`**. It adds the `pendingCatalog`
mechanism (NOTE-034, NOTE-040), brings in the desktop's T010 commits with their seven manifest entries marked
`pendingCatalog: 'LG-02'`, and fixes the independent art review: its major, every geometric minor, every cheap visual
minor and the contained part of the rest.

**All gates pass at `326fdd0`:**
- tsc is clean.
- The full vitest is green, catalog.test included.
- All 14 variants stay inside the budgets: LOD 0 at most 5,588 of 8,000 triangles; LOD 1 at most 102 of 200 and at
  most 3.1 % of LOD 0. Heights stay inside the manifest ranges and every model stays inside its lot.
- The coplanar scan finds 0 overlaps between different paints (38 before).
- Every model renders by day, at night and in winter at both zooms. I looked at every sheet.
- Existing art is unchanged: all 667 existing model variants are byte-identical to the base at both LOD levels, and 0
  pixels changed on the old landmarks' gallery pages and the demo-city shots.

## Commits

| commit | what |
|---|---|
| `4336bcf` | `ManifestEntry.pendingCatalog?: string` with a doc comment. catalog.test's def check skips flagged entries; a guard test fails if a flagged entry already has a catalog def, or if it is outside the building groups that check covers. Nothing else. |
| `04e40f4` | Cherry-pick of `564c851` (the seven builders and their three tests), patch-identical (`git patch-id` matches). |
| `bfb69d7` | Cherry-pick of `a1cef4c` (the registration), with the seven entries wrapped in `pending('LG-02', E(...))`. The dev head now also registers T035's `polish_stubs`, so `builders/index.ts` keeps both registrations (the one conflict). No commit carries an unflagged entry without a def: catalog.test passes at `4336bcf` and `bfb69d7`, and `04e40f4` only adds new files. |
| `e429fab` | Geometry: the major, the geometric minors and every other overlap the coplanar scan found. |
| `84c92a0` | Cheap visual minors: the bronze bull, the eagle's feathers, the tower tops at night, the dome glazing. |
| `326fdd0` | Contained part of the rest: the Millennium v1 and Crown v1 palettes, and the library's relief as a book. |
| (this report) | `docs/dev/reports/cloud-T010-art.md` |

The guard test was checked both ways with throwaway copies of catalog.test, which are deleted. Flagging `lm_castle`
and `res_shack`, which have defs, fails it with `res_shack (LG-97)` and `lm_castle (LG-99)`. Flagging `tree_oak` and
`for_lease_sign`, which are outside the building groups, fails it with `tree_oak (nature)` and
`for_lease_sign (placeholder)`.

## The art review's findings

Each finding below gives what changed, or why it was left as is. "Before" images are the art review's own renders; the
"after" images use the same gallery URLs (cameras) at `326fdd0`. The before/after pairs are on the sheets
`fixed_spots_1.jpg`, `fixed_spots_2.jpg` and `fixed_spots_3.jpg` (paths under "Sheets").

### 1. MAJOR: Stock Exchange setback roofs z-fight (v0 and v1). Fixed

**Cause.** Each tier box's RoofFlat cap and the cornice box's cap shared y1.

**Change.** The cornice box's cap is now the setback roof, painted the designer's RoofFlat `0x69736b`. The tier box
and its piers end inside the cornice with no caps of their own, so each tier has exactly one cap at y1. That is a
lighter construction than the review's suggestion (end the cornice at y1 + 0.1, with an optional inset dark slab): it
keeps the dark roof and uses fewer triangles (2,557 down to 2,499 for the roofs; 2,525 with the new bull of
finding 9).

**Overlaps the scan also found on this model, both fixed:**
- the trading hall's RoofFlat cap, hidden under its cornice box, shared y = 16 with the pilaster tops (1.2 m2). The
  hidden cap is dropped.
- the portico floor overlapped the plinth's top at y = 2 (28.2 m2). It now starts where the plinth ends (z = 10.4).

**Evidence.**
- Coplanar overlap went from 1,004.3 m2 (v0) and 882.8 m2 (v1) at offset 0 to 0.
- Close-up before `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/artreviewwork/shots/close/se_setbacks.png`,
  after `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t010finish/shots/gate/close/se_setbacks.png`;
  night `.../se_setbacks_night.png`.
- In the demo city at 520 m the roofs were split white/teal and are now uniform:
  `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t010finish/crops/city520_se_compare.png`.

### 2. WTC tower roofs and setbacks, the same construction (v0 and v1). Fixed

**Change.** The steel coping's cap is now each section's flat roof (RoofFlat `0x858d8d`, the designer's roof colour),
and the glass prism has no cap of its own. This is the review's construction, except that the coping stays at y1: with
the second cap gone nothing else shares that height. It keeps a matte roof instead of a large glossy steel one (Metal 0
is rough 0.32 / metal 0.75, which would glint), and it saves triangles.

**Also fixed:** the entrance canopy's hidden back face, which lay flush on the podium (0.5 m2).

**Evidence.**
- Coplanar overlap went from 882 m2 (v0) and 1,953 m2 (v1) to 0.
- `.../shots/gate/close/wtc0_roof.png` and `.../wtc1_setback.png`, against the review's
  `.../artreviewwork/shots/close/wtc0_roof.png`.

### 3. Grand Central vault-foot strips (v1, and v0). Fixed

**Change.** The dark-metal strips at each vault foot are now offset 5 cm along the arc's outward normal (a new `off()`
in `trainShed`), instead of being lifted 4 cm in y. The ribs and purlins keep their positions.

**Overlaps the scan also found on this model, all fixed:**
- The track bed now sits on the lot slab (y 0.1-0.16). Its back face had been coplanar with the slab's (4.9 m2).
- The platform edge lines are 2 cm above the platform top (was 1 cm; 20-30 m2).
- The waiting train's stripe stands 4 cm proud of the car ends, like its glass, and its mullions stop 5 cm under its
  roof (5.4 m2).

**Evidence.**
- v1 had 174.9 m2 at 3.8 mm plus 168.0 m2 at 11.4 mm, and v0 had 65.2 m2 at 10 mm. Both are now 0.
- `.../shots/gate/close/gc1_shed_flank.png`, `gc_back_close.png` and `gc_back_close_night.png`. SwiftShader never showed
  this fight, so the evidence is the scan.

### 4. Night silhouettes of the tower tops (WTC, Millennium, Crown). Fixed

All the new accents are night-only, in the house style: Emissive 11 (x2) unless noted, with bands of at least 1 m.

- **WTC:** each tower has a 1.6 m crown light ring (`0xa8c4d8`) under its coping. It sits outside the facade ribs, so
  they do not slice it, and it replaces the 0.35 m Emissive 10 ring. The dark louvre band now runs up to the coping,
  closing a 10 cm gap the old ring used to hide. The mast's white bands glow at night (Emissive 10), so the mast reads
  as a lit dashed line.
- **Millennium:** the needle has three 1.5 m light rings on its own lathe profile, so its silhouette is unchanged by
  day. The sky-deck rims are 1.2 m and x2 (they were 0.6 m and x1).
- **Crown:** the blade lights are 1 m wide on the outer face of every blade, gold `0xc9a05a` x2. They were 0.3 m strips
  of `0xad8b50` x1.

The Millennium's entrance strip and the Crown's sky-hall band stay Emissive 10, which millennium_crown.test requires.

**Evidence.**
- Night skyline at 1,600 m, before, after v0 and after v1, 3x:
  `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t010finish/crops/skyline_tops_night_compare.png`.
  The WTC tops and the Millennium needle were dark before.
- Tower-top close-ups by night: the bottom rows of the WTC, Millennium and Crown sheets.
- Distance views `.../shots/gate/close/crown_coronet_night_dist.png` and `.../mill_top_dist_night.png` (before/after on
  `fixed_spots_3.jpg`).

### 5. Variant distinctness (Crown, Millennium, Stock Exchange). Fixed for the Crown and the Millennium; accepted for the Stock Exchange

The palette changes are colour only: no triangle, height or footprint change.

- **Millennium v1:** bronze-gold curtain glass (tint 2) with dark corner glazing (tint 3). It had silver glass (tint 4)
  and the same blue corners as v0. v0 stays sky-blue, and both keep the silver fins, decks and needle.
- **Crown v1:** a dark glass shaft (tint 3; it was teal tint 1, like v0) with gold piers and coronet (`0xcfa959`). v0
  stays stone and teal with a bronze coronet.
- **Why these tints:** the review suggested bronze for both supertalls' v1. Giving the Millennium bronze-gold and the
  Crown dark glass with gold keeps the two v1s apart from each other too.
- **Stock Exchange: accepted.**
  - Its variants already read apart by colour at the game camera: v0 is white limestone, v1 granite with bronze curtain
    glass. See `.../shots/gate/city/v0_day_d900.png` against `.../v1_day_d900.png`, and the sheet's default-zoom row.
  - What they share is the topology. A new crown for v1 (a drum or spire instead of the hip roof) is new geometry for a
    7 m x 13 m roof that covers about 7 px at the game camera, not a contained fix.

**Evidence.** The Millennium and Crown sheets (day, default zoom), `.../shots/gate/city/v1_day_d900.png`, and
`fixed_spots_2.jpg` (crown1_toptier).

### 6. Central Library v0 reads as a second city hall. Partly fixed (the relief); the rest accepted

**Fixed.** The tympanum relief is now an open book: pale floodlit pages with three text lines each, on a dark cover and
spine. It was a khaki plaque that read as a blank rectangle. It now reads as a book even at default zoom (the library
sheet's top-left tile), and at night (`.../shots/gate/close/lib_front_low_night.png`).

**Accepted: the overall read.**
- A dome on a drum, a portico and two wings is the classical central-library type, so the composition is right for the
  model.
- The review's other cues would each be 1-2 px at the game camera, so none clearly changes the read: lion plinths, a
  lettered frieze, and WallWindows 8 (a night-only change).
- The scale already separates it from civ_city_hall (3x3 and 35.5-37.5 m, against 4x4 and 41 m), and v1 (brick with an
  octagonal lantern) is distinct.

### 7. WTC scale against com_megatower, and v1's identity. Accepted, for the lead

**Height.** The LG-02 spec in docs/POLISH_PLAN.md sets no heights or footprints apart from Grand Central's 4x3, so a
raise is allowed. It is not a contained fix, though:
- Roofs at the review's 420-440 m need the manifest range `[390, 415]` moved to about `[475, 500]` (mast top about
  486 m), and the T010 test's local copy of it changed too.
- The 21 m wide twins go from about 1:16 to about 1:21.
- At the game camera the twins' roofs and mast sit just inside the frame today: in `.../shots/gate/city/v0_day_d900.png`
  the mast tip is about 24 px from the top edge
  (`/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t010finish/crops/city900_wtc_mast_top_4x.png`).
  A 96 m raise is about 125 px there, which would push both the roofs and the mast out of the frame, as already happens
  for the Millennium and the Crown.

It is a reward-ladder decision (800k against the stage-8 growables), so it is left to the lead with these numbers.

**v1's identity.** A skybridge is lm_twin_spires' defining feature ("Twin skyscraper landmark joined by a skybridge"),
so adding one would blur the two landmarks. At night v1's two towers now carry matching lit crown rings and a lit mast
(finding 4). v0's twin silhouette stays the strong one.

### 8. Botanical Dome glazing flashes one pane white. Fixed

**Change.** The glass takes the shell's smooth normal: per-vertex normals of the ellipsoid (rx, h, rz), passed to
`b.triN`. The sun's highlight is now a spot that moves across the dome instead of one flat pane flashing white.

**Deviation from the review:** the frames take the shell normal too. The review suggested keeping them flat, but with
glass-only smooth normals the facing pane's flat frame still flashed as a bright white triangle outline on v1's green
frames (`/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t010finish/shots/v2/dome_glint_close.png`).
Frames stay coplanar with their pane and do not overlap it.

**Also fixed:** the lawn stopped short of the lot edge faces it shared with the forecourt paving (7.3 m2).

**Evidence.** `.../shots/gate/close/dome_glint_close.png` and `dome_glint_dir2.png` against the review's, plus the
street row of the dome sheet. At night the main hall still glows cream and the grow-light domes amber, per the
convention.

### 9. Sculptures: the Stock Exchange bull and the Grand Central v0 eagle. Fixed

- **Bull:** bronze `0x7a5a32` (Metal 3) instead of verdigris, in a charging pose: lowered head with a muzzle, horns out
  from the poll and then forward, a deeper chest, a shoulder hump and the tail raised.
- **Eagle:** a body, head and beak instead of one box. Its raised wings have three stepped feather groups, two-sided,
  instead of two flat planks. It now sits into the ridge, so the scan's floating parts on Grand Central v0 dropped from
  3 to 1.

**Evidence.** `.../shots/gate/close/se_bull.png` and `gc0_pediment.png` (`fixed_spots_1.jpg`, `fixed_spots_2.jpg`). The
bull reads bronze even in the 520 m city crop.

### 10. LOD transitions (the generic massing proxy). Accepted

This is renderer code (src/render/city/buildings/lodProxy.ts), outside T010's files. It behaves exactly as it does for
the existing landmarks, and every proxy is within budget (46-102 triangles, at most 3.1 % of LOD 0). The review itself
says no builder change is needed, so I left it with the render work. The proxies follow the new palettes
(`lod_levels.jpg`).

### 11. Crown v1 top tier: ribs on the chamfer vertices. Fixed

**Change.** The stone ribs stay 1.5 m clear of each face's chamfer corners, at ±min(4.5, half face − 1.5). Only v1's
top tier moves: its x-face ribs go from ±4.5 to ±3, off the bronze piers.

**Also fixed:** the ribs now stop under the bronze band (y1 − 2) instead of capping in the band's roof plane. That was
the Crown's other overlap, about 33 m2 per variant.

**Evidence.** 171.4 m2 at 4 mm went to 0; see `.../shots/gate/close/crown1_toptier.png`.

**Other overlaps the scan found on Millennium and Library, all fixed:**
- **Millennium:** the facade fins capped in the coping cap's plane (9 m2), and the door glass had a hidden back face 1 cm
  from the pilasters.
- **Library:** the stair landing overlapped the plinth top (13 m2), and the skylight glass and mullions capped under
  their cap box (2.3 m2).

## Gates

### Gate 1: tsc

| check | result |
|---|---|
| `npx tsc --noEmit` (TS 7) at `326fdd0` | exit 0, no output (also after every commit) |

### Gate 2: the full vitest

| check | result |
|---|---|
| `npx vitest run --configLoader runner` at `326fdd0`, under the lock 03:59:59-04:02:33 | **PASS**: 186 test files passed, 1 skipped (187); 1,865 tests passed, 19 skipped (1,884); 152.6 s; no unhandled errors; exit 0 |
| catalog.test | passes, with the seven entries flagged `pendingCatalog: 'LG-02'`. Last time this was the one failure at the T010 head. |
| T010's three tests, lod.test and manifest.test | pass; also run after each commit from `bfb69d7` to `326fdd0` |

### Gate 3: triangles per model, variant and LOD level

The models are built in node exactly as the game builds them (`registry.getModelGeometry`, seeded with `hashString(id#v)`).
LOD 1 is `makeLodProxy`, the BuildingRenderer's distant level. The limits are LOD 0 ≤ 8,000, LOD 1 ≤ 200, and LOD 1 ≤ 50 %
of LOD 0. The "before" figures are the gates run on the unfixed T010.

| model | lot | v | LOD 0 tris (before) | % of 8,000 | LOD 1 tris (before) | LOD 1 / LOD 0 | proxy used | window tris LOD 0 / LOD 1 | height m (manifest range) |
|---|---|---|---|---|---|---|---|---|---|
| lm_central_library | 3x3 | 0 | 3,097 (3,099) | 38.7% | 52 (52) | 1.7% | yes | 121 / 8 | 35.5 (35-38) |
| lm_central_library | 3x3 | 1 | 2,553 (2,555) | 31.9% | 52 (52) | 2.0% | yes | 89 / 8 | 37.5 (35-38) |
| lm_grand_central | 4x3 | 0 | 3,100 (3,052) | 38.8% | 74 (74) | 2.4% | yes | 139 / 14 | 31.5 (31-42) |
| lm_grand_central | 4x3 | 1 | 4,670 (4,670) | 58.4% | 76 (76) | 1.6% | yes | 201 / 14 | 42 (31-42) |
| lm_stock_exchange | 3x3 | 0 | 2,525 (2,557) | 31.6% | 78 (78) | 3.1% | yes | 87 / 24 | 74.6 (74-87) |
| lm_stock_exchange | 3x3 | 1 | 2,525 (2,557) | 31.6% | 78 (78) | 3.1% | yes | 87 / 24 | 86.6 (74-87) |
| lm_botanical_dome | 4x4 | 0 | 5,588 (5,588) | 69.8% | 102 (102) | 1.8% | yes | 696 / 56 | 26.8 (26-32) |
| lm_botanical_dome | 4x4 | 1 | 5,348 (5,348) | 66.8% | 102 (102) | 1.9% | yes | 652 / 56 | 30.8 (26-32) |
| lm_world_trade_center | 4x4 | 0 | 3,677 (3,683) | 46.0% | 66 (66) | 1.8% | yes | 82 / 8 | 390.5 (390-415) |
| lm_world_trade_center | 4x4 | 1 | 5,133 (5,171) | 64.2% | 76 (76) | 1.5% | yes | 162 / 16 | 414.5 (390-415) |
| lm_millennium_tower | 4x4 | 0 | 2,724 (2,694) | 34.0% | 76 (76) | 2.8% | yes | 128 / 16 | 536 (530-590) |
| lm_millennium_tower | 4x4 | 1 | 3,378 (3,348) | 42.2% | 70 (60) | 2.1% | yes | 192 / 16 | 588 (530-590) |
| lm_metropolis_crown | 4x4 | 0 | 3,070 (3,070) | 38.4% | 56 (56) | 1.8% | yes | 146 / 16 | 608.4 (600-650) |
| lm_metropolis_crown | 4x4 | 1 | 3,326 (3,326) | 41.6% | 46 (46) | 1.4% | yes | 146 / 8 | 648.4 (600-650) |

The maximum at LOD 0 is 5,588 and at LOD 1 it is 102. Every bounding box stays inside its lot (±footprint × 8 m) with
min y = 0, and both levels keep night windows. Gallery stats flag no tile (no OUT-OF-LOT, OVER-BUDGET or HEIGHT).

### Gate 4: coplanar scan, geom.mjs on all 14 variants

The art review's scan finds same-facing triangles of different paint (colour or surf) whose planes are less than 12 mm
apart and overlap by more than 0.02 m2. "Before" is the cherry-picked T010 at `bfb69d7`, which reproduces the review's
numbers exactly. "After" is `326fdd0`.

| variant | pairs before | overlap before | smallest offset before | pairs after | inverted before / after | floating before / after |
|---|---|---|---|---|---|---|
| lm_central_library#0 | 2 | 15.2 m2 | 0.0 mm | **0** | 6 / 6 | 0 / 0 |
| lm_central_library#1 | 2 | 15.2 m2 | 0.0 mm | **0** | 6 / 6 | 0 / 0 |
| lm_grand_central#0 | 5 | 95.6 m2 | 0.0 mm | **0** | 0 / 0 | 3 / 1 |
| lm_grand_central#1 | 6 | 383.4 m2 | 0.0 mm | **0** | 0 / 0 | 1 / 1 |
| lm_stock_exchange#0 | 3 | 1,033.7 m2 | 0.0 mm | **0** | 6 / 6 | 0 / 0 |
| lm_stock_exchange#1 | 3 | 912.1 m2 | 0.0 mm | **0** | 6 / 6 | 0 / 0 |
| lm_botanical_dome#0 | 1 | 7.3 m2 | 0.0 mm | **0** | 0 / 0 | 8 / 8 |
| lm_botanical_dome#1 | 1 | 7.3 m2 | 0.0 mm | **0** | 0 / 0 | 8 / 8 |
| lm_world_trade_center#0 | 2 | 882.5 m2 | 0.0 mm | **0** | 6 / 6 | 4 / 4 |
| lm_world_trade_center#1 | 2 | 1,953.5 m2 | 0.0 mm | **0** | 6 / 6 | 4 / 4 |
| lm_millennium_tower#0 | 3 | 9.7 m2 | 0.0 mm | **0** | 12 / 12 | 4 / 4 |
| lm_millennium_tower#1 | 3 | 9.7 m2 | 0.0 mm | **0** | 0 / 0 | 0 / 0 |
| lm_metropolis_crown#0 | 2 | 33.2 m2 | 0.0 mm | **0** | 0 / 0 | 13 / 13 |
| lm_metropolis_crown#1 | 3 | 204.2 m2 | 0.0 mm | **0** | 0 / 0 | 13 / 13 |

There were 38 pairs before and there are 0 after.
- **Inverted faces:** unchanged. They are the shared `tree()` trunks, which the review found on every existing landmark
  too.
- **Floating:** the counts are unchanged apart from the eagle. These are the scan's raw counts of pieces more than
  0.25 m from any other (for example small beacons and lamp heads); the review found no floating parts at any zoom.

**Wider scan, informational, not a gate.** With the window widened to 3 cm, the only pairs are the house's deliberate
layers, 1.5-3 cm apart: lamp light pools at +3 cm, paving bands at +1.5 cm, openings and decals at +3 cm, and the new
platform lines at +2 cm. That spacing follows park_lib's `YL` convention ("coplanar layers are kept >= 12-15 mm apart").

### Gate 5: gallery renders and contact sheets

**Renders at `326fdd0` with last time's jobs:**
- 42 gallery pages: 7 models × {day, night, winter (January, temperate)} × {default, street}, two variants per page.
- 6 tower-top close-ups (WTC, Millennium and Crown, day and night).
- The landmark group page (26 tiles: 12 existing and 14 new).
- LOD 0 and LOD 1 pages, day and night.
- 19 close-ups of the fixed spots, using the art review's cameras, so its renders are the "before".
- 9 demo-city shots with all seven models plopped: 900 m at 52° by day (v0 and v1) and at night (v0 and v1), 520 m by
  day, and the 1,600 m skyline by day, dusk and night (v0 and v1). Every plop placed.

There were 0 console errors or warnings and 0 page errors, every page reported ready, every plop placed, and no gallery
tile was flagged. I looked at every sheet and every close-up.
- Every model renders correctly by day, at night and in winter at both zooms, with no holes, fighting faces or
  floating parts.
- Winter leaves the lot trees bare and the lawns dormant; the buildings get no seasonal change, as before.

### Gate 6: existing art unchanged (base `f69166d` against head `326fdd0`)

| check | result |
|---|---|
| geometry: sha256 of every attribute of every manifest model variant, at LOD 0 and LOD 1 (hashes.mjs) | **667 / 667 identical at both levels**. Head adds exactly the 14 new variants, and both trees build with 0 warnings and 0 errors. |
| old landmarks, gallery pages: day, night and winter × default and close (6 pages, 1440×1083) | **0 changed pixels each** (`compare -metric AE -fuzz 0`); PNG sha256 identical |
| demo-city town: static default camera, night, street (3 shots, 1280×720) | **0 / 0 / 0**; PNG sha256 identical |
| demo-city dense=1: the same three cameras (3 shots, 1280×720) | **0 / 0 / 0**; PNG sha256 identical |

## Sheets (I looked at every one)

All paths are under `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/t010finish/`:

**Per model (day, night and winter at default and street zoom; tower tops for the three supertalls):**
- `sheets/lm_central_library.jpg`
- `sheets/lm_grand_central.jpg`
- `sheets/lm_stock_exchange.jpg`
- `sheets/lm_botanical_dome.jpg`
- `sheets/lm_world_trade_center.jpg`
- `sheets/lm_millennium_tower.jpg`
- `sheets/lm_metropolis_crown.jpg`

**Fixed spots, before and after:**
- `sheets/fixed_spots_1.jpg`: Stock Exchange setbacks by day and night, bull, WTC v0 roof, WTC v1 setback.
- `sheets/fixed_spots_2.jpg`: Grand Central back by day and night, v1 shed flank, v0 pediment and eagle, Crown v1 top
  tier.
- `sheets/fixed_spots_3.jpg`: Crown coronet and Millennium top at night, dome glint from two directions, library relief.

**Other sheets and crops:**
- `sheets/city_plops.jpg`: the nine demo-city shots.
- `sheets/lod_levels.jpg`: LOD 0 and LOD 1, day and night.
- `sheets/group_landmark.jpg`: the landmark group, day and night.
- `sheets/existing_landmarks_head.jpg` and `sheets/existing_city_head.jpg`: the existing-art shots at head; they are
  pixel-identical to the base.
- `crops/skyline_tops_night_compare.png`, `crops/city520_se_compare.png` and `crops/city900_wtc_mast_top_4x.png`.

## Data, renders and tools

All under the same `t010finish/` folder:

**Logs:**
- `logs/vitest_full.log`
- `logs/tris_head.json`
- `logs/geom_before.json` and `logs/geom_commit3c.json` (the final scan), and `logs/geom3cm_geomfix.json` (the 3 cm
  scan)
- `logs/hashes_base.json` and `logs/hashes_head.json`
- `logs/diffs_old.txt`
- `logs/shoot_gate_*.log`, with GALLERY_STATS and ART_PLOPS

**Renders:**
- At head: `shots/gate/new/`, `shots/gate/close/`, `shots/gate/city/` and `shots/gate/head/`.
- At the base: `shots/gate/base/`.
- Iteration renders: `shots/v1/`, `shots/v2/` and `shots/v3/`.

**Tools:**
- `bin/`: copies of last time's shoot.mjs, tris.mjs, hashes.mjs, geom.mjs, withlock.sh, sheets.sh and diffs.sh, with
  cache dirs moved to this folder.
- `jobs/`: last time's jobs, re-pointed to this folder.
- The base tree is `base/`, a `git archive` of `f69166d` with a node_modules symlink; no git worktree was added.

## How it ran

**Lock holds.** Every browser run and the full vitest ran under the timing lock, and each hold was released when its
run ended:

| run | lock held |
|---|---|
| verification renders 1, 2 and 3 | 03:39:25-03:40:01, 03:50:05-03:54:13, 03:56:39-03:57:01 |
| geometry hashes | 03:59:16-03:59:27 |
| full vitest | 03:59:59-04:02:33 |
| new-model gate pages, close-ups, city shots | 04:03:01-04:06:27, 04:06:27-04:07:41, 04:07:41-04:12:13 |
| existing art, base then head | 04:12:13-04:15:13, 04:15:13-04:18:09 |

**Cleanup.**
- Each run used its own Vite server on a free port and its own browser, and closed both on exit. None is left running.
- Nothing was pushed, and no file of the main checkout or of another worktree was edited, apart from the shared
  vitest cache below.
- I deleted only files I had created: the throwaway guard-check test copies and two superseded crops/sheets of mine.
- Side effect: the full vitest run rewrote vitest's shared results cache, which every worktree reaches through the
  node_modules symlink (`node_modules/.vite/vitest/da39a3ee…/results.json`: test durations by relative path, 201
  entries). Any vitest run without `--no-cache` does this. The file existed before and is left in place.
