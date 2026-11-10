# T072-new01: visual variety

Branch `local/T072-new01`, original base `1c2019c`. Rounds 1 and 2 are committed (`df0e61c`, `b0781cd`); QA round 3
(the section below) is uncommitted.

The approved round-2 extension adds rowhouses and boutiques to the same facade mechanism. **The 2020 all-growables
twin gates now pass: 93/8,023 = 1.1592% for both same-model and same-def twins**, below 5% and 2% respectively.
Cottages were not needed and remain untouched. The 2040 checkpoint passed in round 1; its round-2 replay and browser
art acceptance remain for the lead. Economic building choices, capacities and the simulation RNG stay unchanged.

## QA round 3 (after the real-GPU QA of b0781cd; uncommitted)

The QA passed every acceptance line and left three findings. This round fixes F1 (look-alikes) and F3 (names) and
records F2 (the batch buffer). Measured on the 256 s7 bot city of 1 Jul 2020 with the QA's own look-alike rule (dE 15):

- **rowhouse lots with a look-alike on a touching lot: 15.5 % -> 0.0 %** (base 9.1 %); within 6 cells 70.7 % -> 3.7 %;
- **walk-up lots with a look-alike within 6 cells: 38.2 % -> 7.2 %** (base 39.6 %); touching 5.5 % -> 0.0 %;
- **street rows with three same-model facades of the six families: 16 -> 0** (base 190); the longest run is 2;
- the plan's twin shares still pass: 2020, **91 / 8,023 = 1.13 %** same-model and same-def (limits 5 % and 2 %).

The sim is untouched: the 128x15 s7 bot is identical (192,899, every annual row), and the 256 s7 run equals the base
at each checkpoint once facade ids are projected back (every building field, funds, the random stream, the grids).
Not verified by me: the look in the real renderer (no browser here); see "Not verified" and the recheck list.

### Changes by file

- `src/sim/economy/growth.ts`, `spreadFacade` only (**shared file**; the round-1 hunk, now 15 lines longer, nothing
  moved). The choice keeps the twin test first and then looks at the model on the next lots in any variant (below).
- `src/assets/builders/res_rowhouse_variety.ts`: twelve looks per model (hip, gables, mansard) instead of one rotated
  set of six colours. Shapes, triangle counts (752 / 934 / 902) and surfaces of roofs and windows are unchanged.
- `src/assets/builders/res_walkup_variety.ts`: twelve looks each for the monitor and gables walk-ups. Colours only:
  positions, normals and surfaces are byte-identical to b0781cd. The hip walk-up is untouched.
- `src/assets/builders/com_boutique_variety.ts`: ten looks for the terrace boutique (walls, trim, piers, roof deck).
  Its cap slab now carries the deck (the hidden roof face and the separate deck quad are gone: 4 triangles fewer,
  362-372). The decks use surfaces the LOD proxy counts as massing (boards, stone, flat roof). The hip and gable
  boutiques are untouched.
- `src/sim/catalog.ts`: three display names (F3) and one expression in the facade loop. No stat field changes.
- `tests/sim/visualVarietyRound3.test.ts` (new, 14 tests), `tests/assets/visualVarietyRound3.test.ts` (new, 20 tests).
- `tests/assets/visualVarietyLegacy.test.ts`: two of its eighteen hashes updated, two shape hashes added (see "For the
  lead", point 2). `tests/sim/visualVariety.test.ts`, `tests/sim/visualVarietyRound2.test.ts`: one line each, the
  stat-equality check now sets the name aside.

No infra hunk, no cloud-held file, no renderer file, no manifest change, no new RNG draw, no save or systemData key.

### F1, cause 2: the choice

`spreadFacade` picks among the family's four facades, from the lot's hashed start in stepping order, by these keys
(larger is better, the next key breaks a tie):

1. the nearest building of the very def with this variant (the twin test, as before; none within 6 cells is best);
2. the nearest building showing the model with this variant (as before);
3. **new:** the nearest building showing the model in any variant;
4. **new:** the nearest building showing the model in the same-looking variant (this variant or its mirrored twin).

At b0781cd keys 1 and 2 alone decided, and where no twin stood near, the hashed start was kept: for 201 of 207 lots
in the QA's host test. Now keys 3 and 4 decide those lots. Still no RNG draw: the same scan, the same hash.

The task's wording puts key 3 first. I kept the twin test in front of it, because the plan's gate needs it: replayed
without keys 1 and 2, the 256x20 s7 city has **179 same-model and 175 same-def twins = 2.23 % and 2.18 %**, over the
2 % same-def limit (90 of them in the six families). With the twin test first it has 91 = 1.13 %.

How I compared rules without a bot run each: the facade does not feed back into the sim, so one recorded run (every
building added and removed, in order) can be replayed with any rule. The replay is exact: it gives back all 12,030
facade choices of the round-2 run, and it predicted all 12,030 of the round-3 run before that run was made.

### F1, cause 1: the palettes

Each re-paletted model has six wall families (two pale, two mid-tone, two dark: a hue and a material each) and four
roof families. Variants 0-5 take one roof each, and their mirrored twins 6-11 take the same walls under another roof
(`isMirrorTwin`, the mechanism the original walk-up, apartments and office blocks use). The two wall families of one
tone never share a roof. Colours come from the neighbours' palettes (`SIDING_PAL`, `BRICK_PAL`, `ROOF_PAL`, the
original rowhouses and boutiques): brick reds and buffs, stucco whites, stone, painted boards, slate, clay, lead.

| Model | b0781cd: looks, two lots alike | Round 3: looks, two lots alike | Least / median dE between variants |
|---|---|---|---|
| `res_rowhouses_hip` | 2, 56 % | 12, 8.3 % | 20.9 / 44.0 |
| `res_rowhouses_gables` | 1, 100 % | 12, 8.3 % | 21.3 / 39.8 |
| `res_rowhouses_mansard` | 1, 100 % | 12, 8.3 % | 21.5 / 37.0 |
| `res_walkup_monitor` | 2, 50 % | 12, 8.3 % | 22.8 / 31.1 |
| `res_walkup_gables` | 1, 72 % | 12, 8.3 % | 21.1 / 44.3 |
| `com_boutique_terrace` | 1, 92 % | 10, 10 % | 22.7 / 35.0 |

"Looks" are the QA's look classes at dE 15 (they are the same at dE 20). 8.3 % is the floor for twelve variants: a
lot then looks only like its own variant. The dE is the larger of the wall and roof distances of a pair.

### Numbers, before and after (256 s7, the bot's default strategy)

The plan's twins (same model or def and the same variant within 6 cells), same-model / same-def:

| Checkpoint | Growables | Base 1c2019c | Round 2, b0781cd | Round 3 |
|---|---:|---|---|---|
| 1 Jan 2020 (the end of the 256x20 run) | 8,023 | 489 = 6.10 % / 467 = 5.82 % | 93 = 1.16 % / 93 = 1.16 % | **91 = 1.13 % / 91 = 1.13 %** |
| 1 Jul 2020 | 8,180 | 457 = 5.59 % / 429 = 5.24 % | 86 = 1.05 % / 86 = 1.05 % | 82 = 1.00 % / 82 = 1.00 % |
| 1 Jan 2040 | 9,624 | 511 = 5.31 % / 162 = 1.68 % | 62 = 0.64 % / 56 = 0.58 % | 62 = 0.64 % / 56 = 0.58 % |

The six families hold 2 twins in Jan 2020 (two original boutiques) and none in Jul 2020 and 2040.

The QA's look-alike measure, reproduced headless from its scripts (`qa-eye.js`): share of lots with a look-alike
within 6 cells / on a touching lot, dE 15. My port gives the QA's browser numbers for b0781cd and the base exactly
(204 of 204 comparisons with its `eye.json`: totals, per family, per model and the row counts, at dE 10, 15 and 20).

| | Lots | Base | Round 2 | Round 3 |
|---|---:|---|---|---|
| Rowhouses, Jul 2020 | 2,002 | 76.4 % / 9.1 % | 70.7 % / 15.5 % | **3.7 % / 0.0 %** |
| Walk-ups, Jul 2020 | 1,130 | 39.6 % / 5.8 % | 38.2 % / 5.5 % | **7.2 % / 0.0 %** |
| Shops & apartments, Jul 2020 | 391 | 74.2 % / 17.9 % | 42.2 % / 4.3 % | 29.2 % / 0.0 % |
| Boutiques, Jul 2020 | 270 | 74.4 % / 16.3 % | 48.5 % / 8.9 % | 17.4 % / 0.7 % |
| Six families, Jul 2020 | 3,918 | 63.3 % / 9.2 % | 55.0 % / 10.5 % | 8.2 % / 0.1 % |
| the same at dE 10 | | 58.2 % / 7.8 % | 44.4 % / 8.3 % | 5.6 % / 0.1 % |
| the same at dE 20 | | 65.2 % / 11.0 % | 59.5 % / 11.6 % | 12.5 % / 0.2 % |
| All growables, Jul 2020 | 8,180 | 56.3 % / 10.1 % | 52.3 % / 10.7 % | 30.0 % / 5.7 % |
| Walk-ups, 2040 | 2,998 | 59.1 % / 11.1 % | 57.3 % / 10.5 % | 14.9 % / 0.1 % |
| Rowhouses, 2040 | 543 | 19.2 % / 0.7 % | 26.9 % / 1.1 % | 0.7 % / 0.0 % |
| Office blocks, 2040 | 507 | 42.0 % / 2.4 % | 36.1 % / 7.1 % | 29.2 % / 0.8 % |
| Six families, 2040 | 4,558 | 53.8 % / 9.2 % | 49.0 % / 8.5 % | 15.7 % / 0.1 % |

The same model in any variant (the silhouette, whatever the colours), within 6 cells / on a touching lot:

| | Base | Round 2 | Round 3 |
|---|---|---|---|
| Rowhouses, Jul 2020 | 99.2 % / 70.7 % | 91.7 % / 23.2 % | 88.8 % / **0.4 %** |
| Walk-ups, Jul 2020 | 98.7 % / 43.1 % | 73.6 % / 13.4 % | 52.6 % / **0.2 %** |
| Six families, Jul 2020 | 98.1 % / 60.9 % | 82.9 % / 19.3 % | 72.9 % / 0.9 % |
| Walk-ups, 2040 | 100.0 % / 72.7 % | 92.5 % / 25.1 % | 90.2 % / 0.5 % |
| Six families, 2040 | 98.0 % / 67.1 % | 84.3 % / 23.1 % | 79.9 % / 1.0 % |

Within 6 cells a dense district holds twenty or more lots of a family and only four models, so that share cannot fall
far; the touching share is what the rule controls.

Street rows (whole city), base / round 2 / round 3:

| | Jan 2020 | Jul 2020 | 2040 |
|---|---|---|---|
| Rows with 3+ same-model facades of the six families (longest run) | 189 (7) / 19 (4) / **0 (2)** | 190 (6) / 16 (3) / **0 (2)** | 247 (7) / 15 (3) / **0 (2)** |
| Rows with 3+ look-alikes of the six families, dE 15 | 1 / 4 / **0** | 1 / 4 / **0** | 0 / 0 / 0 |

The two causes apart (replays, six families, Jul 2020, within 6 cells / touching): the new palettes with the round-2
choice give 13.1 % / 1.5 %; the new choice with the round-2 palettes gives 46.3 % / 0.4 %; both give 8.2 % / 0.1 %.

The QA's view 7 (the three mansard terraces, lots 9184, 8234 and 8216 at x 162-163, z 201-206): the round-3 run
builds gabled rowhouses #10 (pale blue boards, pale lead roof), mansard rowhouses #0 (limestone, red-brown tiles) and
the original brownstones #8 (red brick bow fronts) there. This is from the headless run, not from a screenshot.

What is left: walk-ups, shops and office blocks keep 7 to 29 % look-alikes within 6 cells. They come from models this
round does not touch: the original walk-up (six of its twelve variants are one look class at dE 15), the round-1 hip
walk-up, shops and offices (their mirrored twins repeat a palette). Few of them are on a touching lot: 0.0 to 0.1 %,
office blocks in 2040 0.8 %.

### The sim is unchanged: proof

- **128x15 s7**, the standard command, through the gate, on the final tree (after the last edits of this round):
  `node <quietrun> npx tsx tools/simbot.ts --size 128 --years 15 --seed 7`
  gives `residents [ 61124, 93804, 37971 ]` = **192,899** in 2015. All 15 annual rows equal the round-2 log (every
  column but the two ms timings). A diff of the whole output against that log leaves only the timing figures and
  the gate's two wait lines: jobs, caps, the action log and the news are equal. Output:
  `scratch/bot128x15_s7-round3-final.log` (an earlier run, `bot128x15_s7-round3.log`, gives the same).
- **256 s7, 40 years**, one run through the gate, with checkpoints at day 7200 (the end of a 256x20 run: the bot's
  moves do not depend on `--years`, and the first 20 rows equal the lane's 256x20 probe), 7380 and 14400:
  `node <quietrun> node --no-warnings --experimental-transform-types --loader file:///<scratch>/ts-loader.mjs <scratch>/r3-probe.mjs --tag after --days 7200,7380,14400 -- --size 256 --years 40 --seed 7 --quiet`
  At all three checkpoints the digest with facade ids projected back equals the QA's base run (`base256s7_summary.json`,
  made on 1c2019c with the same digest code): every field of every building, population, residents, jobs, caps,
  demand, approval, funds (235,178 / 253,749 / 7,041,576), the random stream (1852637608 / 4055025871 / 2742481696),
  the next building id, taxes and the last budget; and the digest of 11 grids. All 40 yearly rows are equal,
  the random stream included. Final residents `[223030, 427084, 235122]` = 885,236.
- The two lane runs event by event: 55,573 events; all 33,392 building additions have the same day, id, lot,
  rotation, variant and original def in the round-2 and round-3 runs. Only the facade differs, on 7,062 of the
  12,030 family lots.
- **Old save** `vet_s7_y21`, continued 720 days headless with the QA's `headless_old.mjs`: 25 of 25 monthly snapshots
  equal the QA's base run; 7,887 of 7,887 surviving old buildings keep def and variant. The new growth holds 599
  facade buildings (round 2: 472): next to old buildings, which all show an original model, the rule now picks a new
  one more often.
- Medium and Hard: the lane's test (a 32-cell town, 450 days, facade choice on against off, the whole serialized city
  compared) passes with the new rule and the new names.

Before this round's code I made the same 256x40 run on b0781cd (`--tag before`), for the "round 2" columns and the
recording the replays use. It gives the QA's lane digests and twin counts exactly.

The round-3 run predates the last edits of this round (the comment of `spreadFacade`, the display names, the terrace
boutique's deck surfaces), so its numbers were checked against the final tree without another bot run: the
worktree's own `spreadFacade`, fed that run's record of every building added and removed, gives back all 12,030
family facades the run built (`scratch/r3-realreplay.mjs`; fed the round-2 record it differs on 6,879 lots, so the
check can fail), and the look descriptors of the final tree are byte-identical to the ones the look-alike tables use.

### F3: names

The inspector title comes from the def's `name`, which the facade defs copied. Three models get their own:
`res_rowhouses_hip` "Terraced Houses", `res_rowhouses_gables` "Gabled Rowhouses", `res_rowhouses_mansard` "Mansard
Rowhouses". The original stays "Brownstones". The other fifteen facade models keep their original's name, which fits
them (Walk-up Apartments, Corner Store, Shops & Apartments, Office Block, Boutique). The names are also what an
incident reads ("Fire at Terraced Houses"): `emergency.ts` takes the place from the def's name.

### F2: the building batch's vertex buffers (recorded, no change)

Not changed, as asked. The QA's numbers: `geometryId` in `src/render/city/common/batch.ts:737-741` doubles the batch
when a new geometry does not fit. The bot's facade cities cross the 1,048,576-vertex step, so the four vertex arrays
(position, normal, colour, surface, 12 bytes a vertex each) go from 48.0 MiB to 96.0 MiB, and the same again on the
GPU:

| City (256 s7) | Batch geometries, base -> lane | Vertices used, base -> lane | Vertex buffers |
|---|---|---|---|
| 1 Jul 2020 (2,920 facade buildings) | 991 -> 1,546 | 943,947 -> 1,226,337 | 48.0 -> 96.0 MiB |
| 2040 (3,401 facade buildings) | 1,021 -> 1,429 | 1,023,237 -> 1,252,455 | 48.0 -> 96.0 MiB |

The base's 2040 city sits at 97.6 % of the step, so it would cross soon as well. Draw calls are equal and triangles
fall 2 to 7 %. Round 3 leaves this where it was: the growables' distinct model + variant pairs in use are 434 -> 433
(Jul 2020) and 376 -> 376 (2040), their vertices 827,487 -> 824,634 and 776,022 -> 776,178 (headless count, growables
only, without LOD proxies). Whether the larger batch costs frame time is the QA's pending timing script.

### Checks

All on the final tree. `npx tsc --noEmit` (TypeScript 7.0.2, 1,458 files) passed. `git diff --check` passed; the new
files are LF without a BOM. Through the quiet gate, one process at a time (`npx vitest run <files> --maxWorkers=1`;
outputs in `scratch/final/`):

| Test files | Result |
|---|---:|
| `tests/assets/visualVariety.test.ts` | 26 passed |
| `tests/assets/visualVarietyLegacy.test.ts` | 20 passed |
| `tests/assets/visualVarietyRound3.test.ts` (new) | 20 passed |
| `tests/sim/visualVariety.test.ts` | 26 passed |
| `tests/sim/visualVarietyRound2.test.ts` | 7 passed |
| `tests/sim/visualVarietyRound3.test.ts` (new) | 14 passed |
| `growth` 12, `catalog` 9, `manifest` 20, `botFallback` 5, `worker/hygiene` 18 | 64 passed |
| `render/lod` 35, `seasons` 33, `buildingBudget` 22, `buildingWork` 12, `lighting` 11, `rubbleKitLow` 2 | 115 passed |

The last two rows ran as three groups (growth, catalog, manifest and botFallback; hygiene alone; the six render files).
In an earlier run of those eleven files together, before the final edits, `tests/worker/hygiene.test.ts` showed 1
failure (17 of 18; which test was not captured); it passed alone and in two repeats of that group (99 of 99, 179 of
179), and alone on the final tree. Probably a timeout under load (its import-graph tests take 14 s alone); a guess, not
a finding.

New tests, by name. Sim: "prefers the facade whose nearest building in any variant is farthest, whatever the building
id"; "breaks a tie on that distance by the same-looking variant: the variant itself or its mirrored twin"; "keeps the
twin test first: a facade standing within reach with the same variant loses to nearer facades"; "a street grown lot
by lot never repeats a model within four lots, whatever the variants" (the eight family defs); "two rows back to back
and a row across the street seldom share a model on touching lots, never three in a row" (1 of its 115 touching pairs
does: four facades tie at one cell); "names the rowhouse facades after their own look and keeps every other facade
under its original name"; "changes the name only: every other field of a facade def is the original def's". Assets: "no two variants look alike, mirrored twins included (dE 20, the loosest threshold of the
QA)", "a mirrored twin keeps the walls of its variant and takes another roof" and "its wall families span pale,
mid-tone and dark, and its roofs at least three colour families" (the six models each); "the measure can fail: the
hip walk-up and the two boutiques left as they were still repeat a look in their mirrored twins"; "keeps the triangle
counts of the round-2 shapes". Legacy: "keeps its round-2 shape under the round-3 palette (only vertex colours
changed)" (monitor, gables).

Mutation checks, each restored afterwards (file hashes compared):

- the round-2 rule put back: 12 of the 12 new choice tests fail, the 33 older sim tests pass;
- the twin test removed (keys 3 and 4 only): "keeps the twin test first" and the older "when every facade is
  occupied, avoids a same-def twin" fail;
- one mirrored twin given its variant's roof: both palette tests of that model fail;
- the name expression removed: the names test fails.

Repeated on the final tree (the same way, hashes compared after each restore):

- the round-2 loop of `spreadFacade` and the copied name together: 13 fail (the 12 choice tests and the names test),
  the 34 others of the three sim files pass;
- the rowhouse twins given their variant's own look: 6 fail (both palette tests of each rowhouse model);
- the terrace boutique's slate and paver decks back on `Surf.Pavement`: no test fails (none covers it); the proxy's
  worst roof distance from its model goes from dE 6.9 to 11.5 (`scratch/r3-proxy.mjs`).

### For the lead: where I left the task's wording, and open choices

1. **The twin test stays in front of "any variant".** See above: the wording alone fails the 2 % same-def line in
   replay. Say so if you want the other order tried in a real run.
2. **Two of the eighteen legacy hashes changed, by the task's own instruction.** The task asks both for new colours on
   `res_walkup_variety.ts:16, :21` and for the 198 variants of the legacy test to keep their hashes; that test covers
   the round-1 walk-up models. For `res_walkup_monitor` and `res_walkup_gables` (24 variants) only the colour attribute
   changed: positions, normals and surfaces hash to the b0781cd values, which the test now pins too. The other 174
   variants, the six originals among them, are byte-identical. No game save holds these models yet (b0781cd is not in
   dev); the QA's lane cities do, and show the new colours when opened on this tree.
3. **I also re-paletted the gables walk-up.** The task names lines 16 and 21 (the monitor rows). The QA's table puts
   `res_walkup_gables` at 72 % look-alikes, worse than the monitor, and the walk-up share would not have moved without
   it. Reverting it is one table and one hash.
4. **Mirrored twins take another roof** in the six re-paletted models. So key 4 ("this variant or its mirrored twin")
   means "the same walls" for them and "the same palette" for the models whose twins repeat it.
5. **Three names only** (F3). Say so if every facade model should have one.
6. **256x40 instead of 256x20, and two runs.** One run on b0781cd to record and to have "before" numbers under the same
   measure, one on the round-3 code (its facades are the final tree's: see the end of "The sim is unchanged"). Each
   took 3.7 to 4 minutes on the loaded machine.
7. **Not touched, and still repeating:** `res_walkup_hip`, the nine round-1 shop and office models, `com_boutique_hip`
   and `com_boutique_gable` repeat a palette in their mirrored twins (the first ten are hash-pinned). Giving them a
   second roof as well would take most of the rest out of the within-6 numbers; it changes ten more legacy hashes.
8. **A rule I did not take.** Putting key 4 before key 3, except on touching lots, replays to 6.5 % instead of 8.2 %
   look-alikes within 6 cells for the six families (rowhouses 1.1 % instead of 3.7 %), with one row of four
   same-model facades in the city instead of none. I kept the order the task gives.
9. **The monitor walk-up's sedum is muted** (`SEDUM = 0x7f8c68`): it reads as a moss-green roof and only partly takes
   the shader's winter and desert tint (see "Not verified"). A greener value such as the boutique's `0x7c9a4e` would
   take it fully; that is one constant, and the monitor's legacy colour hash once more (its shape hash stays).

### Not verified

- **The look in the game.** I did not run a browser or the real renderer. The palettes were judged on a software
  preview I wrote (`scratch/r3-render.mjs`: flat vertex colours, one sun, no textures, shadows, night or winter
  shading; sheets `scratch/r3-sheet-rows.png`, `r3-sheet-walkups.png`, `r3-sheet-terrace.png`) and on the QA's
  colour measure. Day, night and winter in the renderer, the LOD proxies by eye and the art direction are open.
- Night and winter by code only: window surfaces are unchanged (the lane's test finds windows in every variant), the
  season, lighting, budget and LOD test files pass, roofs keep their roof surfaces. Two things are new for a model
  here: painted boards use `Surf.Wood` on walls (as the original painted rowhouses do), and two flat roofs are green.
  The terrace boutique's sedum deck (#3, #5) passes the flat-roof shader's green test fully (`materials.ts`, grK 1.0)
  and follows the lawns' season; the monitor walk-up's muted sedum (#3, #6, #8) passes it only partly (grK 0.28 to
  0.59 with the shader's noise, `scratch/r3-sedum.mjs`), so in winter it stays partly green.
- **The LOD swap by eye.** Headless I compared each variant's proxy (`buildLodProxy`) with its full model by the same
  colour measure (`scratch/r3-proxy.mjs`, rerun on the final tree: `scratch/final/t072r_proxy_final.txt`): every
  variant has a proxy, heights agree within 1.45 m (the hip roof's ridge), roofs within dE 14. Walls differ by up to
  dE 18 to 23 on the dark looks with pale trim (brick and granite mansards, brick hip and gabled rows, the plum gables
  walk-up): the proxy takes the wall paint, the model's mean includes the trim. The originals show the same (the original walk-up dE 20 on walls and 41 on roofs, the original
  rowhouses 17 and 13), so I left it; whether a dark look pops at the swap needs the QA's zoom sweep.
- Frame time, the full vitest suite, G-DET and G-STEP, the three hosts in a browser: not run.
- The comment in `growth.ts` quotes the replay (2.18 % without the twin test). That rule never ran in the real bot.

### Browser recheck (short)

The QA's saved lane cities hold round-2 choices, and a save stores the facade id. Regrow the lane city first
(`qa/T072/bot.sh lane256s7 <this tree> 7200,7380,14400 --size 256 --years 40 --seed 7 --quiet`), or the streets show
the old choice in the new colours.

- [ ] Ten suburb shots by eye (`node suburbs.mjs`): no street with three look-alike facades in a row; expect no row
      with three same-model facades of the six families at all.
- [ ] View 7, the rowhouse row at x 162-163, z 201-206: three different terraces (expected: gabled #10, mansard #0,
      original #8).
- [ ] `node eye.mjs`: rowhouses with a look-alike on a touching lot at or near 0 % (base 9.1 %), walk-ups within 6
      cells near 7 %.
- [ ] Gallery, all variants of the six re-paletted models, day, night and winter: twelve (ten) looks each, no garish
      colour next to the originals; the boarded rowhouses, the two sedum roofs in winter (the boutique's #3 and #5
      should go dormant with the lawns, the monitor walk-up's #3, #6 and #8 stay partly green: acceptable?), the
      terrace boutique's deck to the slab edge.
- [ ] The LOD swap (`node lod.mjs`) over a rowhouse and a walk-up district: no pop on the dark looks with pale trim
      (brick mansard #1 and #7, plum gables walk-up #1 and #7).
- [ ] Inspector on one rowhouse of each roof: "Terraced Houses", "Gabled Rowhouses", "Mansard Rowhouses",
      "Brownstones".
- [ ] An old save still opens with every building's look unchanged (only facade models changed colour).

Scratch, all in `lanes/T072/scratch/`: `r3-probe.mjs` (the twin probe with the QA's digest and an event record),
`r3-replay.mjs` (rules replayed over a record), `r3-eye.mjs` and `r3-lib.mjs` (the QA's measure headless),
`r3-desc.mjs`, `r3-looks.mjs`, `r3-lab.mjs` (descriptors and distances), `r3-shape.mjs`, `r3-hash.mjs` (the hashes),
`r3-proxy.mjs` (proxy against model), `r3-render.mjs` (the preview); results `r3-before-*` and `r3-after-*`
(`summary`, `events`, `snapshots`, `catalog`),
`r3-eye-before.json`, `r3-eye-after.json`, `r3-headless-old-after.json`, `bot128x15_s7-round3.log`. Checks on the
final tree: `r3-realreplay.mjs` (a record through the worktree's `spreadFacade`), `r3-digests.mjs` (checkpoints
against the QA's runs), `r3-rows.mjs` (the back-to-back rows test, measured), `r3-pairs.mjs` (model + variant pairs
and their vertices), `r3-sedum.mjs` (the green-roof test), `bot128x15_s7-round3-final.log`, and the test and probe
outputs in `final/`.

## Round 2 changes by file

- `src/assets/builders/res_rowhouse_variety.ts` (new): hip-roofed terraces, individual brick gables with bays, and
  limestone mansards with dormers. Six palettes per model, twelve effective mirrored variants, four entrances/stoops,
  2×1 lots, 9–12 m height guidance and evergreen planters. No RNG calls in these builders.
- `src/assets/builders/com_boutique_variety.ts` (new): stone/tile hip roof, stucco standing-seam gable, and dark stone
  with a glazed roof pavilion/terrace. Five palettes per model, ten effective mirrored variants, upscale storefronts,
  1×1 lots, 6–12 m height guidance and planters without deciduous trees.
- `src/assets/builders/residential.ts`, `commercial.ts`: import/register the six new model ids. Existing dispatches,
  builders and the commercial roof-tone wrapper are unchanged.
- `src/assets/manifest.ts`: two entries in `FACADE_MODELS`. **Minimal hunk outside the explicit `owns` list, but named
  by NEW-01 and required by the approved extension.** It appends six models using the original mirror/count metadata.
  The existing catalog mechanism automatically adds six stat-identical defs without changing its weighted pools.
- `tests/sim/visualVariety.test.ts`: include both new families in catalog/stat/household/street-spread checks and
  update the expected family count. This small existing-test hunk maintains this lane's round-1 contract.
- `tests/sim/visualVarietyRound2.test.ts` (new): original model/variant save continuity, saturated/free legacy choices
  with alias neighbors, inherited household semantics, pool exclusion and identical rowhouse demographics at
  0/20/60 years of age.
- `tests/assets/visualVarietyLegacy.test.ts` (new): SHA-256 over every vertex attribute of every variant of eighteen
  existing models (198 geometries), including the original rowhouses/boutiques and all round-1 facade models.
  All hashes match the values captured before adding round-2 builders.
- This report: current acceptance tables, exact commands, resolved scope request and expanded browser checklist.

`src/sim/catalog.ts`, `src/sim/economy/growth.ts`, `res_mid.ts` and `com_low.ts` have **no round-2 changes**.
Rowhouse aliases retain `house` through the existing stage-3 fallback; boutiques have no model-specific sim rule.
No new stat, capacity, growth, RNG, save schema or systemData change is needed.

## Round 1 mechanism (committed)

- `src/assets/builders/res_walkup_variety.ts` (new): hip, glazed monitor and paired-gable walk-ups, with six authored
  palettes each and their mirrored variants. Original walk-up geometry and variant indices are untouched.
- `src/assets/builders/residential.ts`: import/register the new walk-up builders.
- `src/assets/builders/com_variety.ts` (new): hip/gable/stepped corner stores; hip/paired-gable/terraced shops and
  apartments; stepped/sawtooth/vaulted office blocks. Six palettes per small model and four per office model,
  plus mirrors. Each family has three different roof silhouettes and colour sets. Four mature forecourt trees keep
  each new office plaza visible in winter LOD proxies; this fixes the existing LOD suite's foliage regression from
  adding numerous office models whose original tiny trees fell below the proxy's foliage-share threshold.
- `src/assets/builders/commercial.ts`: register the new commercial builders through the existing roof-tone wrapper.
- `src/assets/manifest.ts`: **minimal hunk outside the task's explicit `owns` list, but named by NEW-01**. Append
  twelve model entries through `FACADE_MODELS`, retaining each original entry's footprint, effective variant count,
  mirror split and height guidance. Original manifest entries remain unchanged. The existing gallery discovers them
  through the manifest; no `gallery.html` edit is necessary.
- `src/sim/catalog.ts`: append eighteen hidden facade defs for the six existing stage/dev defs. Copy every economic
  stat; explicitly retain the walk-up's apartment household form (the stage-3 generic fallback would be a house).
  Exclude facade defs from the original weighted growth and wealth-swap pools. Add `growthDefId` and `facadeDefs`.
- `src/sim/economy/growth.ts`: isolated facade helper and final call after the original def/raw-variant decision.
  Hash tile coordinates and building id, scan actual facade models once, avoid a same-model/variant neighbor where
  possible, then use the existing same-def/farthest preference. Legacy scans project facade ids to their original
  defs, keeping future alternate-def decisions unchanged. No RNG draws, raw-variant changes or new persisted keys.
- `tests/assets/visualVariety.test.ts` and `tests/sim/visualVariety.test.ts` (new): geometry/roof/colour budgets,
  determinism, catalog/household equivalence, exclusion from weighted pools, neighbor spreading and fallback,
  canonical legacy decisions, street repetition, Medium/Hard economic snapshot equality and save continuity.

**Infrastructure hunks:** none. **Cloud-held files:** none. **Renderer changes/requests:** none.

## Checks

`npx tsc --noEmit` passed. `git diff --check` passed.

Every test file below ran individually through the quiet gate, one process at a time:

| Test file | Result |
|---|---:|
| `tests/assets/visualVariety.test.ts` | 26 passed |
| `tests/assets/visualVarietyLegacy.test.ts` | 18 passed |
| `tests/sim/visualVariety.test.ts` | 26 passed |
| `tests/sim/visualVarietyRound2.test.ts` | 7 passed |
| `tests/assets/manifest.test.ts` | 20 passed |
| `tests/sim/catalog.test.ts` | 9 passed |
| `tests/sim/growth.test.ts` | 12 passed |
| `tests/worker/hygiene.test.ts` | 18 passed |
| `tests/render/lod.test.ts` | 35 passed |

**171 tests passed across nine individually run files.** All new models remain inside their footprint/height
guidance and the 1,500-triangle growable budget; office plaza trees survive their distant winter proxies.

The standard `npx vitest run ... --maxWorkers=1` invocation failed before loading tests with Vite
`externalize-deps: spawn EPERM`. The working equivalent uses native config loading and one thread worker:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-transform-types node_modules/vitest/vitest.mjs run tests/sim/visualVariety.test.ts --maxWorkers=1 --pool=threads --configLoader=native
```

The Medium/Hard continuity tests compare the entire serialized city after canonicalizing only facade def ids,
including numeric building fields, layers, budget, statistics, history, news and systemData/RNG. Raw save hashes
intentionally differ where a new facade def id is stored; existing saved buildings and raw variants are preserved.

## Bot and numerical acceptance

The requested standard command was attempted through the gate:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7
```

It failed because `tsx` is neither installed nor cached (`ENOTCACHED`; network is restricted). Node 22's local
TypeScript transform with a scratch extension-resolution loader successfully ran the same unmodified bot:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/ts-loader.mjs --import file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/capture-bot.mjs tools/simbot.ts --size 128 --years 15 --seed 7
```

**Round 1, 128×15 s7: PASS**, residents `[61124, 93804, 37971]` = **192,899** in 2015, exactly the requested baseline.
Full output is `scratch/bot128x15_s7.log` in the task's supplied scratch directory.

**Round 2, 128×15 s7: PASS**, residents `[61124, 93804, 37971]` = **192,899**, exactly the requested baseline.
The quiet gate held the replay during a timing run, then released it normally. Full output is
`scratch/bot128x15_s7-round2.log`, from this exact command:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/ts-loader.mjs --import file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/capture-bot-round2.mjs tools/simbot.ts --size 128 --years 15 --seed 7
```

The following gated probe imports the same `SimBot`, `parseArgs` and full systems; no strategy flags or sim changes.
It records rows and twins in 2020/2040. A twin means the same model (or def) **and raw variant** within six cells,
using lot-edge Chebyshev distance as `variantScan` does; count each growable with at least one such neighbor once.

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/ts-loader.mjs C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/variety-gates.mjs --size 256 --years 60 --seed 7
```

| Run / checkpoint | Growables | Same-model twins (≤5%) | Same-def twins (≤2%) |
|---|---:|---:|---:|
| Round 1: 2020, population 283,841 | 8,023 | 444 = **5.5341%, FAIL** | 444 = **5.5341%, FAIL** |
| Round 2: 2020, population 283,841 | 8,023 | 93 = **1.1592%, PASS** | 93 = **1.1592%, PASS** |
| Round 1: 2040, population 885,236 | 9,624 | 70 = **0.7273%, PASS** | 64 = **0.6650%, PASS** |
| Round 2: 2040 | not rerun | lead replay remains | lead replay remains |

The **round-1** 60-year run completed at **1,513,835** residents in 2060: `[412608, 738176, 363051]`.
Rows and checkpoint counts are in `scratch/variety-256x60-s7.json`.

Projecting facade ids back to their original models gives 6.0950% / 5.8208% in 2020 and 5.3096% / 1.6833% in 2040
(same-model / same-def). These are same-state diagnostic projections, not a separate baseline run.

A second, justified diagnostic run attributed the unresolved 2020 gate:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/ts-loader.mjs C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/variety-gates.mjs --size 256 --years 20 --seed 7
```

Its round-1 output is `scratch/variety-256x20-s7.json`. The approved round-2 run uses an identical probe with a
separate output filename, preserving both runs' evidence:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --no-warnings --experimental-transform-types --loader file:///C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/ts-loader.mjs C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/variety-round2-gates.mjs --size 256 --years 20 --seed 7
```

The round-2 result is `scratch/variety-round2-256x20-s7.json`. Population and resident mix remain **283,841** and
`[100754, 124171, 58916]`. All twenty yearly rows (year, population, approval and funds) match the round-1 probe
exactly, as does the final resident mix. The original four families still have zero twins across 1,609 buildings; the 1,951 rowhouses
now have zero, and the 314 boutiques have four. The complete remaining same-model/same-def breakdown is:

| Model family | Round 1 twins in 2020 | Round 2 twins in 2020 |
|---|---:|---:|
| `res_rowhouses` | 182 | 0 |
| `com_boutique` | 173 | 4 (two original, two hip) |
| `res_cottage` | 38 | 38 |
| `res_shack` | 16 | 16 |
| `ind_depot` | 14 | 14 |
| `res_townhouse_row` | 13 | 13 |
| `res_suburban` | 8 | 8 |
| Total | **444** | **93** |

**Scope request resolved:** the lead approved rowhouses and boutiques for round 2. Their combined twin count fell
from 355 to four. The conditional cottage extension is unnecessary because the overall same-def rate is below 2%.
No further scope or cloud-held-file request remains.

## Plan versus current code

- `altsFor`/`create` already implement the plan's exhausted-variant alternate-def rule. Re-implementing it or simply
  increasing manifest counts would change capacity substitutions. This lane adds a separate stat-identical visual
  choice after that decision, and canonicalizes subsequent legacy scans.
- Walk-ups already had twelve effective variants, including six authored mirror-twin archetypes; the other targets
  have twelve/eight effective variants. New model ids preserve all existing mirror splits and seeds.
- The plan allows capacity changes and `polish` balance rows. This implementation needs no economic balance changes;
  stored facade identities are the intentional state difference.
- The plan's older 12–14% twin baseline and its four dominant models do not match the present code under the
  explicitly documented lot-edge metric. The approved round-2 scope extension resolves the 2020 miss.

## Remaining lead gates and browser checklist

No browser, full Vitest suite, benchmark, real-GPU run or other worktree was used. The full two-process baseline
year-hash audit and G-STEP/performance timing remain for the lead; canonicalize facade ids for the economic audit.
The 2020 repetition miss is resolved. The round-2 2040 replay remains for the lead. No cloud-held-file change is requested.

Lead's standard bot replay command (when `tsx` is available), if independently repeating the large-city row and
exporting checkpoints for the browser art review:

```text
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --save-years 20,40 --save-prefix C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T072/scratch/variety_
```

- [ ] A/B all six target families at **300 m** and **700 m**, including the distant LOD transition.
- [ ] Review **10 suburb screenshots**: no street has more than **two identical facades in a row**.
- [ ] Check hip/monitor/gable walk-ups, all three shop roofs, all three corner-store roofs and all three office crowns.
- [ ] Check rowhouse hip terraces, individual gables/bays and mansard dormers; check all four street entrances/stoops.
- [ ] Check boutique hip, front gable/oculus and glazed pavilion/terrace roofs, display windows and street entrance.
- [ ] Check roof/facade colours, night windows, shadows, mirrored variants, entrances and lot bounds in the game.
- [ ] Load an old city: existing buildings retain their appearances; new growth adds the facade families.
- [ ] Save/reload a new facade city and check appearance/continuation in the normal and Worker paths.
- [ ] Recheck full tests, G-DET and G-STEP; replay the round-2 2040 checkpoint before final acceptance.
