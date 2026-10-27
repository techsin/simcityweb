# local-T011-guide-copy: the onboarding copy as a data module with text tests (POLISH_PLAN §4)

Branch `local/guide-copy`, base `fe584f2`. New files only: `src/ui/guide/copy.ts` and
`tests/game/guideCopy.test.ts`. Round 1's guide items (FH-01, FH-02, FH-08, FH-11, FH-12, FH-13, FH-18) take their texts
from here later.

## What it is
- **`guideCopy`.** 126 texts grouped by §4 phase (A–E) and button labels (`actions`). Each text is a function of what
  it needs: city state, catalog defs, tuning or params values, and event values its caller supplies. Each carries a
  comment with its plan section and the item that will use it.
- **No typed-in numbers.** Prices, outputs, radii, thresholds and names are read at render time (e.g. B3's "3 wind
  turbines (§800 each)" reads the turbine's name and cost from its def, and the spacing from `WIND_SPACING`).
- **Tone (§4.1).** Second person, at most 2 sentences and 30 words, the plain word first and the code in brackets
  ("homes (R)", "(LIVE)"), money with §, never blaming the player.

## Gates

| Gate | Result |
|---|---|
| `tests/game/guideCopy.test.ts` | 137/137 |
| Per-text rules (every text rendered with realistic inputs from a fresh city and the real catalog) | ≤ 2 sentences, ≤ 30 words, money only with §, second person |
| Sources | no digits typed into string literals or template substitutions (TypeScript scanner); every catalog id and def field read resolves (dynamic ids too); every tuning / params key resolves; names, prices and capacities recomputed at render time |
| `tsc` / full vitest | clean / 1,228 passed, 6 skipped; only the Windows-CRLF `binary.test` fails (T012 fixes it) |

## My review
- Fixed three texts:
  - E4 said "by 2 point" for any count other than one; it now uses a `points()` helper outside the template, so the
    digit rule still holds.
  - E3 was missing "min" after the burn-out time.
  - E1aLegend did not mark the label: it now says covered areas as "Auto-dispatch".
- **For the lead:** E2 and phase E "Emergencies" describe today's LIVE slow-down on every uncovered emergency. The
  approved big-city emergency design (in range: no slow-down; out of range: slow-down with a cooldown) will need both
  texts reworded when it lands.
- Kept: B4Pipes and phase E "Pipes" are near-duplicates on purpose (the phase B step and the veteran briefing).

## Every text, rendered with the test's example inputs

| id | example |
|---|---|
| `phaseA.A1` | Start your first city |
| `phaseA.A1Subtitle` | Guided · your first road in about 2 minutes |
| `phaseA.A1Region` | Create a new region |
| `phaseA.A2Wind` | Start small: 3 wind turbines power about 2,500 of your first residents. |
| `phaseA.A2Zones` | Your zones only grow next to roads. |
| `phaseA.A2Play` | The game waits for you until you press Play. |
| `phaseA.A3Tile` | A good first city for you |
| `phaseA.A3Guided` | Guide your first steps |
| `phaseA.A3Veteran` | Skip to your veteran briefing |
| `phaseA.A3Easy` | Easy — you start with §250,000 and earn 20% extra taxes. Recommended for your first city. |
| `phaseA.A3Medium` | Medium — you start with §100,000 at the intended balance. |
| `phaseA.A3Hard` | Hard — you start with §40,000 and earn 15% less tax. Keep your budget tight from the start. |
| `phaseA.A3Sandbox` | Sandbox — you have unlimited money and everything unlocked. |
| `phaseA.A3Disasters` | Tornadoes, quakes and meteors can hit your town from 2,000 residents. Off is fine for your first city. |
| `phaseB.BTitle` | Found your town |
| `phaseB.BPaused` | The game is paused while you build. |
| `phaseB.B1Title` | Connect to the region |
| `phaseB.B1` | Build a road from the map edge into your town. New residents and trade arrive along it. |
| `phaseB.B1Hint` | Run your road at least 3 tiles in from the edge, with at least 6 connected road tiles. |
| `phaseB.B2Title` | Zone homes, shops and jobs |
| `phaseB.B2` | Along your roads, zone about 20 tiles of homes (R), 4 of shops (C) and 6 of industry (I). |
| `phaseB.B2Cost` | Your zoning costs §5–§10 a tile. |
| `phaseB.B2RoadHint` | Some of your zones don't touch a road — nothing grows there yet. |
| `phaseB.B2CountHint` | Zone more homes (R): aim for 20 road-accessible tiles; you have 18. |
| `phaseB.B3Title` | Start your power supply with wind |
| `phaseB.B3` | Place 3 wind turbines (§800 each) beside your road, with 2 empty tiles between them. |
| `phaseB.B3Output` | Each makes 3 MW on flat land, up to 7 on hills; together, they power about 2,500 of your residents. |
| `phaseB.B3Roads` | Place your power plant beside a road — roads carry power to your zones. |
| `phaseB.B3Hint` | Your plant isn't reaching any zone yet — connect it to your zones with roads. |
| `phaseB.B3FuelHint` | Your Coal Power Plant costs §25,000 for 400 MW, about 120,000 residents. Wind is plenty for now. |
| `phaseB.B4Title` | Add water to your town |
| `phaseB.B4` | Place a Water Tower (§300, 2,500 kL/day) touching a road past your zones. |
| `phaseB.B4Pipes` | Your roads include pipes; medium and high density, including the default industry zone, need water. |
| `phaseB.B4Hint` | Your zones have no water yet — connect the tower to a road that runs past them. |
| `phaseB.B5Title` | Press play |
| `phaseB.B5` | Unpause and watch your town grow. Space pauses at any time. |
| `phaseB.B5Locked` | Finish your steps above first — or press Space to play anyway. |
| `phaseB.BSpend` | You've spent §48,000 of §100,000 before anyone moved in. Running costs come next — keep a reserve. |
| `phaseB.BComplete` | Your town is on the map, Mayor! A few goals will guide your first year. |
| `phaseB.BCompleteFire` | Protect your fuel plant with a Fire Station (§1,400) beside its road. |
| `phaseC.CTitle` | Your first year |
| `phaseC.CProgress` | Your progress: 3/10 · Take out the trash |
| `phaseC.G1Title` | Grow to 500 residents |
| `phaseC.G1` | The coloured demand bars (RCI) show what your town wants. Zone more of the tallest bar. |
| `phaseC.G1Query` | Click one of your lots with Query to see why it isn't growing. |
| `phaseC.G2Title` | Take out the trash |
| `phaseC.G2` | Garbage is piling up at your homes. Zone a 3×3 landfill (§15 a tile) beside a road, away from homes. |
| `phaseC.G3Title` | Keep your streets safe |
| `phaseC.G3` | Crime costs you approval. A Police Kiosk (§400) covers blocks; a Police Station (§1,500) covers a district. |
| `phaseC.G4Title` | Cover your town against fire |
| `phaseC.G4` | Uncovered fires need you to send help. A Fire Station (§1,400) answers automatically within about 24 road tiles. |
| `phaseC.G5Title` | Balance your books |
| `phaseC.G5` | Each tax point earns you about §13 monthly; above 9%, each costs 3.5 approval. Check your budget before building more. |
| `phaseC.G6Title` | Give your children a school |
| `phaseC.G6` | 128 of your children have no school. An Elementary School (§2,000) seats 1,500 within walking distance. |
| `phaseC.G7Title` | See your city |
| `phaseC.G7` | Data views colour your map by power, water, crime, pollution and more. |
| `phaseC.G8Title` | Ask why |
| `phaseC.G8` | Click any of your buildings with Query. The Why? section lists what helps it and what holds it back. |
| `phaseC.G9Title` | Claim your first reward |
| `phaseC.G9` | At 1,200 residents, you unlock the Mayor's House (§2,000); it raises nearby land value. |
| `phaseC.G9Next` | Your next landmark, the Clock Tower, unlocks at 5,000 residents. |
| `phaseC.G10Title` | Add more power |
| `phaseC.G10` | Your town needs 10 MW and makes 9 MW. |
| `phaseC.G10Wind` | Add a Wind Turbine (§800, about 3 MW on flat land), leaving 2 empty tiles between your turbines. |
| `phaseC.G10Gas` | Build your Natural Gas Power Plant for §22,000: 250 MW with 400 kL/day of cooling water. |
| `phaseC.G10Siting` | Keep your Natural Gas Power Plant away from homes: smoke reaches 9 tiles; neighbour dislike (stigma) reaches 8. |
| `phaseC.CComplete` | Your first year is done, Mayor. The advisors take it from here — your next goal is on the top bar. |
| `phaseD.E1a` | No station covers this spot automatically. Send nearest dispatches your Fire Station #1 (3.9 min). |
| `phaseD.E1aLegend` | Your Emergency view marks covered areas as "Auto-dispatch"; help goes there automatically. |
| `phaseD.E1b` | No station can reach this in time. Build your Fire Station within about 24 road tiles; the Emergency view shows automatic coverage. |
| `phaseD.E2` | Your game slowed to follow the truck (LIVE). Your speed returns when help arrives; change this in Settings. |
| `phaseD.E3` | Your nearest truck needed 5.6 min; this fire burned out in 5 min. A station within about 24 road tiles answers automatically. |
| `phaseD.E4` | Your town spends §107 more than it earns monthly. Raising taxes by 1 point brings about §13 a month. |
| `phaseD.E4Loan` | Your §10,000 loan costs §106 a month for 10 years. |
| `phaseD.E5` | Bring your budget back into balance |
| `phaseD.E5Taxes` | Raise each of your taxes by 1 point: about +§13 a month. |
| `phaseD.E5Service` | Set your fire funding to 90%: save about §32 a month. |
| `phaseD.E5Loan` | Borrow §52,000, your largest affordable loan: receive §52,000 now and pay §590 monthly for 10 years. |
| `phaseD.E6Homes` | Your town has no room to grow — zone more homes (R) next to roads. |
| `phaseD.E6Shops` | Your town has no room to grow — zone more shops (C) next to roads. |
| `phaseD.E6Industry` | Your town has no room to grow — zone more industry (I) next to roads. |
| `phaseD.E7Homes` | Raise your homes' demand cap (R) with parks, plazas, a Zoo or landmarks. |
| `phaseD.E7Shops` | Raise your shops' demand cap (C) with a Municipal Airport, Convention Center or landmarks. |
| `phaseD.E7Industry` | Raise your industry's demand cap (I) with regional highway or rail connections, a Freight Rail Station or Container Seaport. |
| `phaseD.E8` | Your approval is 42%; the biggest drag is Crime (-8). |
| `phaseD.E8Risk` | With at least 20,000 residents, your town risks riots below 35% approval and above 45% crime. |
| `phaseD.E9` | Your citizens have unlocked the Mayor's House! Place it from Rewards. |
| `phaseD.E10` | A tornado hit your district, Riverside: 7 buildings are rubble. |
| `phaseD.E10Clear` | Clear your lots with Bulldoze (§5 a tile) or adopt Municipal Demolition Crews for automatic clearing, so they can rebuild. |
| `phaseD.E11` | Each year-end shows how your city did. |
| `phaseD.E12` | Some of your homes have no power: your town needs 10 MW and your plants make 9 MW. |
| `phaseD.E12Fix` | Your homes without power empty fast — add wind turbines or a Natural Gas Power Plant. |
| `phaseE.Roads` | Your roads carry power; power lines only bridge gaps. |
| `phaseE.Pipes` | Your roads include pipes; medium and high density, including default industry, need water. |
| `phaseE.Region` | Connect your town to the region with 6 road tiles reaching 3 tiles in from the map edge. |
| `phaseE.Emergencies` | Uncovered emergencies slow your game to follow dispatch (LIVE); send help. |
| `phaseE.Inspector` | Inspect your buildings with Why? to understand them. |
| `phaseE.Taxes` | Your neutral tax rate is 9%; each point above costs 3.5 approval. |
| `actions.Road` | Build a road |
| `actions.Zones` | Open zones |
| `actions.Wind` | Place a Wind Turbine |
| `actions.Water` | Place a Water Tower |
| `actions.Play` | Play |
| `actions.Query` | Inspect a building |
| `actions.Landfill` | Zone a Landfill |
| `actions.Police` | Open police cover |
| `actions.Fire` | Open fire cover |
| `actions.Taxes` | Check your taxes |
| `actions.Loans` | Check your loans |
| `actions.Education` | Open schools |
| `actions.Views` | Explore data views |
| `actions.Rewards` | See your rewards |
| `actions.Power` | Open power supplies |
| `actions.SendNearest` | Send nearest |
| `actions.EmergencyView` | Open Emergency view |
| `actions.GotIt` | Continue |
| `actions.Settings` | Open Settings |
| `actions.Parks` | Open parks |
| `actions.FixApproval` | Open police cover |
| `actions.PlaceReward` | Place your Mayor's House |
| `actions.Jump` | Go to the damage |
| `actions.Bulldoze` | Clear rubble |
| `actions.Ordinances` | Open ordinances |
| `actions.PowerView` | Open Power view |
| `actions.GuidedStart` | Show your guided start anyway |

**Who wrote what.**
- **Codex** (max effort, about 12 minutes): the module and the tests.
- **Me (Claude):** the brief, the review of all 126 texts (tone, numbers, units), the three fixes and the gates.
