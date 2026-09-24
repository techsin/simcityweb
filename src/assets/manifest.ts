/**
 * MODEL MANIFEST — the contract between asset builders (src/assets/builders/*) and the game catalog (src/sim/catalog.ts).
 *
 * Model local-space conventions (IMPORTANT for every builder):
 *  - Units are meters. One cell = 16 m (CELL_SIZE).
 *  - Origin is the CENTER of the lot at ground level (y = 0). The lot spans
 *      x in [-w*8, +w*8], z in [-d*8, +d*8]  where footprint = [w, d] in cells.
 *  - The FRONT of the building (the side that faces the street, main entrance, driveway) faces +Z.
 *    The street is just outside the lot at z = +d*8. Keep ~1-2 m sidewalk margin inside the lot edge.
 *  - Geometry must stay inside the footprint horizontally (small overhangs up to 0.5 m are fine).
 *  - Include ground dressing inside the lot where it makes sense (lawn, parking, pavement, fences) as thin slabs
 *    at y in [0, 0.15]. Lawns use Surf.Foliage with a grass green; pavement uses Surf.Pavement.
 *  - `variants`: the builder receives variant index 0..variants-1 plus a seeded RNG; each variant must look clearly
 *    different (shape, color, roof, height, details) while staying in the described style.
 *  - Procedural window grids (Surf.WallWindows / GlassCurtain) are anchored to the MODEL ORIGIN: columns repeat every
 *    pattern column width along each wall and floors every floorHeight from y = 0. Put wall edges on multiples of the
 *    column width and floor bases on multiples of floorHeight so windows never get cut at corners.
 *  - Triangle budgets: growables <= 1500 (typical 200-900), civic/utility <= 3000, landmarks <= 8000,
 *    nature <= 120 (they are instanced by the tens of thousands!), vehicles <= 250, props <= 200.
 */
export type AssetGroup =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'utility'
  | 'civic'
  | 'park'
  | 'landmark'
  | 'reward'
  | 'transport'
  | 'nature'
  | 'vehicle'
  | 'prop';

export interface ManifestEntry {
  id: string;
  group: AssetGroup;
  /** [w, d] in cells; w = frontage along the street (x), d = depth (z) */
  footprint: [number, number];
  variants: number;
  /** guidance: approximate [min, max] height in meters */
  height: [number, number];
  desc: string;
  /** +Z side of the lot faces water (seaport, ferry, marina) */
  waterfront?: boolean;
  /** triangle budget override for showpieces */
  budget?: number;
  /** allowed horizontal overhang beyond the lot (m), e.g. wind turbine rotors */
  overhang?: number;
  /**
   * Mirrored variants: when true, `variants` counts BOTH the builder's variants and their X-mirrored twins.
   * The builder itself is only asked for variants 0..buildVariants-1 (see registry.getModelGeometry).
   */
  mirror?: boolean;
  /** number of distinct variants the builder implements (defaults to `variants`) */
  buildVariants?: number;
}

const E = (
  id: string,
  group: AssetGroup,
  footprint: [number, number],
  variants: number,
  height: [number, number],
  desc: string,
): ManifestEntry => ({ id, group, footprint, variants, height, desc });

export const MANIFEST: ManifestEntry[] = [
  // ------------------------------------------------------------------ RESIDENTIAL
  E('res_shack', 'residential', [1, 1], 4, [3, 5], 'R$ stage 1: tiny run-down wooden shack or trailer home, patchy yard, simple fence, old car or junk.'),
  E('res_cottage', 'residential', [1, 1], 6, [5, 8], 'R$ low density: small modest cottage, gable roof, small porch, tiny yard, picket fence.'),
  E('res_townhouse_row', 'residential', [2, 1], 4, [8, 11], 'R$ low: row of 3-4 narrow attached 2-storey townhouses with individual doors and small front steps.'),
  E('res_suburban', 'residential', [1, 2], 8, [6, 9], 'R$$ low: suburban family home, 1-2 storeys, attached garage, driveway to the street, lawn, backyard w/ fence, maybe trampoline/shed.'),
  E('res_ranch', 'residential', [2, 2], 6, [5, 7], 'R$$ low: wide single-storey ranch house, hip roof, big lawn, backyard patio, some with a small pool.'),
  E('res_villa', 'residential', [2, 2], 6, [8, 12], 'R$$$ low: upscale modern or mediterranean villa, pool with deck, manicured hedges, large windows, gated drive.'),
  E('res_mansion', 'residential', [3, 3], 4, [10, 15], 'R$$$ low: grand mansion estate, symmetric facade, columns, fountain in circular drive, gardens, tennis court or pool.'),
  E('res_walkup', 'residential', [1, 1], 6, [10, 14], 'R$ medium: 3-4 storey brick walk-up apartment, flat roof w/ water tank or AC units, fire escape, stoop.'),
  E('res_tenement', 'residential', [2, 2], 4, [14, 20], 'R$ medium: older 5-storey apartment block, repetitive windows, small courtyard, laundry lines, rooftop clutter.'),
  E('res_rowhouses', 'residential', [2, 1], 6, [9, 12], 'R$$ medium: elegant brownstone / terrace row (3-4 units), bay windows, cornices, front steps.'),
  E('res_apartment', 'residential', [2, 2], 6, [15, 22], 'R$$ medium: modern 5-7 storey apartment building with balconies, entrance canopy, landscaped strip.'),
  E('res_condo', 'residential', [2, 2], 6, [18, 30], 'R$$$ medium: luxury 6-9 storey condo, glass balconies, rooftop terrace with plants, stepped massing.'),
  E('res_courtyard', 'residential', [3, 3], 3, [18, 25], 'R$$ medium: U or O shaped courtyard apartment block with green inner courtyard.'),
  E('res_projects', 'residential', [2, 2], 4, [35, 60], 'R$ high: plain concrete residential slab tower 12-18 floors, repetitive windows, small balconies, parking lot.'),
  E('res_highrise_slab', 'residential', [3, 2], 3, [40, 70], 'R$ high: long wide residential slab block 14-22 floors (brutalist/soviet style).'),
  E('res_tower', 'residential', [2, 2], 6, [60, 110], 'R$$ high: residential tower 20-35 floors, balconies, podium with lobby, rooftop mechanical.'),
  E('res_twin_towers', 'residential', [3, 3], 3, [70, 120], 'R$$ high: two residential towers of different heights on a shared podium with garden deck.'),
  E('res_luxury_tower', 'residential', [3, 3], 5, [100, 200], 'R$$$ high: luxury glass residential tower, slender, sculpted crown, sky gardens, podium with pool.'),
  E('res_supertall', 'residential', [4, 4], 3, [180, 300], 'R$$$ high: supertall luxury residential skyscraper with setbacks, spire or crown lights, plaza base.'),

  // ------------------------------------------------------------------ COMMERCIAL
  E('com_corner_store', 'commercial', [1, 1], 6, [4, 9], 'CS$ low: small corner shop / convenience store, awning, sign board, storefront glass.'),
  E('com_gas_station', 'commercial', [2, 2], 3, [5, 8], 'CS$ low: gas station with canopy over pumps, small store, price sign pole.'),
  E('com_diner', 'commercial', [1, 1], 3, [4, 8], 'CS$ low: retro chrome diner or fast-food restaurant with parking, glowing sign.'),
  E('com_strip_mall', 'commercial', [3, 2], 4, [5, 8], 'CS$$ low: strip mall row of 4-6 shops with colored signs, parking lot in front with striped spaces.'),
  E('com_restaurant', 'commercial', [2, 1], 4, [5, 9], 'CS$$ low: restaurant / cafe with outdoor seating umbrellas, signage.'),
  E('com_boutique', 'commercial', [1, 1], 5, [6, 12], 'CS$$$ low: upscale boutique, large glass storefront, stone facade, elegant awning.'),
  E('com_shops_apartments', 'commercial', [1, 1], 6, [10, 18], 'CS$ medium: 3-4 storey mixed-use building, shops at street level with awnings, apartments above.'),
  E('com_motel', 'commercial', [3, 2], 3, [6, 8], 'CS$ medium: 2-storey motel, L-shape, exterior walkways, parking, tall neon sign.'),
  E('com_supermarket', 'commercial', [3, 3], 3, [8, 11], 'CS$$ medium: big-box supermarket with big sign, cart corrals, large parking lot.'),
  E('com_hotel', 'commercial', [2, 2], 4, [20, 40], 'CS$$ medium: mid-rise hotel 6-12 floors, entrance canopy, rooftop sign.'),
  E('com_department_store', 'commercial', [2, 2], 4, [15, 25], 'CS$$$ medium: classy department store, stone facade, display windows, flags.'),
  E('com_office_small', 'commercial', [2, 2], 6, [15, 30], 'CO$$ medium: 4-8 floor office building, ribbon windows or glass, lobby, small plaza.'),
  E('com_office_block', 'commercial', [2, 2], 4, [25, 50], 'CO$$ medium: 8-12 floor office block, modernist grid facade.'),
  E('com_mall', 'commercial', [4, 4], 3, [15, 25], 'CS$$ high: large enclosed shopping mall with anchor stores, skylights, big parking (v2: open-air lifestyle centre).'),
  E('com_hotel_tower', 'commercial', [3, 3], 3, [80, 165], 'CS$$$ high: luxury hotel tower with podium, lit crown, porte-cochere.'),
  E('com_office_tower', 'commercial', [2, 2], 8, [60, 150], 'CO$$ high: office tower 18-40 floors, various styles (glass box, stone grid, setback art-deco, twisted).'),
  E('com_skyscraper', 'commercial', [3, 3], 6, [120, 295], 'CO$$$ high: iconic glass skyscraper, setbacks, crown, spire, plaza.'),
  E('com_megatower', 'commercial', [4, 4], 3, [250, 420], 'CO$$$ high: supertall megatower, tapered, dramatic top, beacon lights, landscaped plaza base.'),

  // ------------------------------------------------------------------ INDUSTRIAL
  E('ind_farm_field', 'industrial', [4, 4], 6, [0.3, 3], 'I-Ag: crop field lot (wheat, corn, vegetables, orchard rows, vineyard, sunflower) with hedgerow edges and a dirt track.'),
  E('ind_farm_barn', 'industrial', [2, 2], 4, [6, 16], 'I-Ag: farmstead with red barn, grain silos, tractor, small farmhouse, fences.'),
  E('ind_greenhouse', 'industrial', [3, 2], 3, [4, 8], 'I-Ag: rows of glass greenhouses with a packing shed.'),
  E('ind_workshop', 'industrial', [2, 2], 4, [6, 10], 'I-D: small grimy workshop / auto repair / metal shop, yard with barrels and pallets.'),
  E('ind_scrapyard', 'industrial', [2, 2], 3, [4, 10], 'I-D: scrap / salvage yard, piles of junk, crane, fence.'),
  E('ind_smokestack_factory', 'industrial', [3, 3], 4, [15, 40], 'I-D: dirty heavy factory, saw-tooth roofs, tall smokestacks, pipes, storage tanks, brick.'),
  E('ind_refinery', 'industrial', [4, 4], 3, [20, 55], 'I-D: chemical/oil refinery with cylindrical tanks, distillation columns, pipe racks, flare stack.'),
  E('ind_warehouse', 'industrial', [3, 2], 6, [10, 14], 'I-M: large warehouse, corrugated walls, loading docks with trucks, logo stripe.'),
  E('ind_assembly_plant', 'industrial', [4, 3], 4, [12, 24], 'I-M: manufacturing / assembly plant, big sheds, office front, rooftop units, parking.'),
  E('ind_depot', 'industrial', [2, 2], 3, [6, 16], 'I-M: logistics depot with shipping container stacks, gantry, trucks.'),
  E('ind_tech_campus', 'industrial', [3, 3], 5, [10, 28], 'I-HT: clean high-tech campus: glass buildings, green roofs, lawns, solar panels.'),
  E('ind_lab', 'industrial', [2, 2], 5, [10, 20], 'I-HT: research lab / biotech building, white panels & glass, rooftop equipment.'),
  E('ind_datacenter', 'industrial', [3, 2], 3, [10, 14], 'I-HT: data center, windowless modules, rows of cooling units, secure fence.'),

  // ------------------------------------------------------------------ UTILITIES
  E('util_coal_plant', 'utility', [4, 4], 1, [40, 95], 'Coal power plant: boiler house, 2 tall stacks, conveyor, coal piles, transformer yard.'),
  E('util_gas_plant', 'utility', [3, 3], 1, [25, 45], 'Natural gas power plant: turbine halls, stacks, spherical gas tanks.'),
  E('util_oil_plant', 'utility', [3, 4], 1, [30, 60], 'Oil power plant: cylindrical oil tanks, boiler building, stacks.'),
  E('util_nuclear_plant', 'utility', [6, 6], 1, [60, 100], 'Nuclear power plant: 2 hyperboloid cooling towers, containment domes, turbine hall, fences.'),
  E('util_wind_turbine', 'utility', [1, 1], 1, [60, 85], 'Wind turbine: slender white tower, nacelle, 3 blades (static).'),
  E('util_solar_farm', 'utility', [4, 4], 1, [2, 4], 'Solar farm: rows of tilted dark-blue solar panels, inverter sheds, gravel.'),
  E('util_hydro_dam', 'utility', [3, 2], 1, [15, 33], 'Small hydro-electric station building with penstocks (placed at water edges).'),
  E('util_water_pump', 'utility', [1, 1], 1, [4, 8], 'Water pump station: small building with pipes and a pump housing.'),
  E('util_water_tower', 'utility', [1, 1], 1, [25, 35], 'Water tower: elevated tank on legs or pillar, painted, ladder.'),
  E('util_water_treatment', 'utility', [3, 3], 1, [6, 12], 'Water treatment plant: round clarifier tanks with water, control building, pipes.'),
  E('util_desalination', 'utility', [3, 3], 1, [10, 18], 'Desalination plant: long membrane halls, intake pipes, tanks (coastal).'),
  E('util_incinerator', 'utility', [3, 3], 1, [30, 55], 'Waste-to-energy incinerator: industrial hall, one tall stack, truck bays.'),
  E('util_recycling_center', 'utility', [3, 3], 1, [8, 14], 'Recycling center: sorting hall, colored bins, bale piles, trucks.'),
  E('util_landfill_tile', 'utility', [1, 1], 4, [1, 6], 'Landfill cell: dirt mound with garbage heaps (varied piles, some bulldozer). Tiles seamlessly with neighbours.'),
  E('util_power_pylon', 'utility', [1, 1], 1, [18, 26], 'Power line lattice pylon (placed along power lines). Arms along the X axis carry wires; renderer draws the wires.'),

  // ------------------------------------------------------------------ CIVIC / SERVICES
  E('civ_police_kiosk', 'civic', [1, 1], 1, [4, 6], 'Small police kiosk / substation with a parked cruiser.'),
  E('civ_police_station', 'civic', [2, 2], 1, [8, 14], 'Police station: 2-3 storey building, blue accents, flag, lot with cruisers.'),
  E('civ_police_hq', 'civic', [3, 3], 1, [20, 35], 'Police headquarters: large modern building, helipad on roof, secure parking.'),
  E('civ_jail', 'civic', [4, 4], 1, [10, 18], 'Prison: cell blocks, high walls, guard towers, yard.'),
  E('civ_fire_station', 'civic', [2, 2], 1, [8, 12], 'Fire station: brick building with 2-3 red garage doors, hose tower, fire truck.'),
  E('civ_fire_hq', 'civic', [3, 3], 1, [12, 22], 'Fire headquarters: bigger station with 4-5 bays, training tower, trucks.'),
  E('civ_clinic', 'civic', [2, 2], 1, [6, 10], 'Medical clinic: clean low building, red cross sign, ambulance bay.'),
  E('civ_hospital', 'civic', [3, 3], 1, [25, 40], 'Hospital: multi-wing building 6-10 floors, helipad, emergency entrance, parking.'),
  E('civ_medical_center', 'civic', [4, 4], 1, [40, 60], 'Large medical center campus with towers, garden, helipad.'),
  E('civ_elementary_school', 'civic', [3, 3], 1, [6, 10], 'Elementary school: 1-2 storey, playground, flag, small sports court, bus loop.'),
  E('civ_high_school', 'civic', [4, 4], 1, [8, 14], 'High school: larger building, gym, running track w/ football field, parking.'),
  E('civ_college', 'civic', [5, 5], 1, [15, 35], 'University campus: quad lawn, clock/bell tower, several academic halls, library dome.'),
  E('civ_library', 'civic', [2, 2], 1, [8, 14], 'Public library: classical facade with columns and steps, or modern glass.'),
  E('civ_museum', 'civic', [3, 3], 1, [12, 20], 'Museum: grand building with portico, dome or modern wing, sculpture plaza.'),
  E('civ_city_hall', 'civic', [4, 4], 1, [25, 45], 'City hall: monumental civic building, central dome/clock tower, plaza with flags.'),
  E('civ_mayor_house', 'civic', [2, 2], 1, [8, 12], "Mayor's house: stately residence with garden, gate, flag."),
  E('civ_courthouse', 'civic', [3, 3], 1, [15, 25], 'Courthouse: neoclassical building, columns, wide steps, pediment.'),
  E('civ_cemetery', 'civic', [3, 3], 1, [2, 8], 'Cemetery: rows of gravestones, paths, trees, small chapel, fence.'),
  E('civ_convention_center', 'civic', [4, 4], 1, [20, 30], 'Convention center: huge hall with curved roof, glass lobby.'),
  E('civ_bus_depot', 'civic', [3, 3], 1, [8, 12], 'Bus depot: garage hall with parked buses.'),
  E('civ_statue', 'civic', [1, 1], 1, [6, 10], 'Mayor statue on a pedestal in a tiny plaza.'),

  // ------------------------------------------------------------------ PARKS / RECREATION
  E('park_small', 'park', [1, 1], 4, [2, 10], 'Small park: lawn, a few trees, paths, benches, maybe small fountain or flowerbed.'),
  E('park_plaza', 'park', [2, 2], 3, [2, 8], 'Paved plaza with fountain or sculpture, planters, benches, lamp posts.'),
  E('park_playground', 'park', [1, 1], 2, [2, 5], 'Playground: colorful play structure, swings, slide, sandbox, rubber surface.'),
  E('park_basketball', 'park', [1, 1], 1, [1, 9], 'Basketball court with hoops and fence.'),
  E('park_tennis', 'park', [2, 1], 1, [1, 9], 'Two tennis courts with nets and fences.'),
  E('park_soccer', 'park', [3, 2], 1, [1, 18], 'Soccer field with goals, small stands, lights.'),
  E('park_baseball', 'park', [3, 3], 1, [1, 12], 'Baseball diamond with dugouts, bleachers, lights.'),
  E('park_large', 'park', [4, 4], 2, [2, 14], 'Large park: pond, winding paths, many trees, gazebo, meadow.'),
  E('park_garden', 'park', [2, 2], 2, [1, 6], 'Formal garden: hedge maze / parterre, flower beds, pergola.'),
  E('park_marina', 'park', [2, 2], 1, [1, 6], 'Marina with docks and small boats (placed at shore; +Z side touches water).'),
  E('park_zoo', 'park', [6, 6], 1, [2, 15], 'Zoo: animal enclosures with ponds/rocks, paths, aviary dome.'),
  E('park_golf', 'park', [6, 6], 1, [1, 10], 'Country club golf course: fairways, greens with flags, bunkers, pond, clubhouse.'),
  E('park_stadium', 'park', [6, 6], 1, [30, 50], 'Sports stadium: oval bowl with tiered seating, pitch, roof canopy, floodlights.'),
  E('park_amusement', 'park', [6, 6], 1, [10, 60], 'Amusement park: ferris wheel, roller coaster track, carousel, colorful tents.'),

  // ------------------------------------------------------------------ LANDMARKS
  E('lm_spire_tower', 'landmark', [2, 2], 1, [400, 550], 'Observation / TV tower: tapered concrete shaft, observation pod, antenna spire.'),
  E('lm_cathedral', 'landmark', [3, 4], 1, [50, 90], 'Gothic cathedral: nave, twin front spires, rose window, flying buttresses.'),
  E('lm_clock_tower', 'landmark', [1, 1], 1, [60, 90], 'Tall stone clock tower with 4 clock faces and pointed roof.'),
  E('lm_observatory', 'landmark', [2, 2], 1, [15, 25], 'Observatory with white dome and telescope slit on a stone base.'),
  E('lm_arch', 'landmark', [2, 1], 1, [30, 50], 'Triumphal arch monument.'),
  E('lm_obelisk', 'landmark', [1, 1], 1, [60, 170], 'Tall obelisk monument with reflecting pool.'),
  E('lm_ferris_wheel', 'landmark', [3, 2], 1, [60, 120], 'Giant observation wheel with capsules.'),
  E('lm_twin_spires', 'landmark', [3, 3], 1, [350, 450], 'Twin skyscraper landmark joined by a skybridge.'),
  E('lm_opera_house', 'landmark', [4, 4], 1, [30, 60], 'Opera house with stacked white shell roofs on a podium (at waterfront works great).'),
  E('lm_pyramid', 'landmark', [3, 3], 1, [30, 50], 'Glass pyramid pavilion with plaza and fountains.'),
  E('lm_castle', 'landmark', [4, 4], 1, [25, 50], 'Medieval castle with keep, towers, crenellated walls.'),
  E('lm_lighthouse', 'landmark', [1, 1], 1, [25, 40], 'Lighthouse with red/white stripes and lantern room (emissive light).'),

  // ------------------------------------------------------------------ REWARDS / BUSINESS DEALS
  E('rw_military_base', 'reward', [8, 8], 1, [5, 25], 'Military base: runway strip, hangars, barracks, radar dish, fences.'),
  E('rw_casino', 'reward', [3, 3], 1, [30, 60], 'Glitzy casino resort, lots of emissive neon signage, fountain.'),
  E('rw_toxic_dump', 'reward', [4, 4], 1, [3, 10], 'Toxic waste dump: rows of barrels, green ooze pools (emissive-ish), hazard fences.'),
  E('rw_missile_range', 'reward', [6, 6], 1, [5, 30], 'Missile test range: launch pads, bunkers, gantry tower, scorched ground.'),
  E('rw_research_center', 'reward', [4, 4], 1, [20, 40], 'Advanced research center: futuristic curved glass building, radio dishes.'),

  // ------------------------------------------------------------------ TRANSPORT BUILDINGS
  E('tr_bus_stop', 'transport', [1, 1], 1, [2, 4], 'Bus stop: small shelter with bench and sign near the +Z edge (sidewalk), rest of lot is plaza/grass.'),
  E('tr_subway_station', 'transport', [1, 1], 1, [3, 6], 'Subway entrance: stair canopy with sign (emissive M-like logo), small plaza.'),
  E('tr_train_station', 'transport', [4, 2], 1, [10, 25], 'Passenger train station: station hall with clock, platforms with canopies along the back (-Z) side.'),
  E('tr_freight_station', 'transport', [4, 2], 1, [8, 14], 'Freight rail yard: loading sheds, container stacks, gantry crane.'),
  E('tr_parking_garage', 'transport', [2, 2], 1, [10, 18], 'Multi-storey parking garage, open floors with cars, ramp.'),
  E('tr_airport_small', 'transport', [8, 6], 1, [8, 25], 'Small airport: runway along X, terminal, control tower, hangar, apron with planes.'),
  E('tr_airport_large', 'transport', [12, 8], 1, [10, 35], 'International airport: long runway, big terminal with jet bridges, tower, taxiways, parked jets.'),
  E('tr_seaport', 'transport', [6, 6], 1, [10, 50], 'Container seaport: quay on +Z side (water), gantry cranes, container stacks, warehouses.'),
  E('tr_ferry_terminal', 'transport', [2, 2], 1, [6, 10], 'Ferry terminal with pier (water on +Z side).'),

  // ------------------------------------------------------------------ NATURE (instanced heavily: keep <= 120 tris)
  E('tree_oak', 'nature', [1, 1], 8, [8, 14], 'Broadleaf oak-like tree: trunk + 2-3 lumpy low-poly foliage blobs. Seasonal variants (autumn / bare / blossom): see builders/nat_season.ts.'),
  E('tree_maple', 'nature', [1, 1], 6, [7, 12], 'Rounded maple tree, some variants autumn orange/red, bare winter, spring blossom (builders/nat_season.ts).'),
  E('tree_birch', 'nature', [1, 1], 5, [8, 13], 'Slender birch, white trunk, light green narrow crown; autumn yellow + bare winter variants (builders/nat_season.ts).'),
  E('tree_pine', 'nature', [1, 1], 4, [10, 20], 'Pine tree: tall trunk, stacked cone foliage tiers.'),
  E('tree_spruce', 'nature', [1, 1], 3, [8, 16], 'Dense conical spruce, dark green.'),
  E('tree_palm', 'nature', [1, 1], 3, [8, 14], 'Palm tree: curved segmented trunk, drooping fronds.'),
  E('tree_cypress', 'nature', [1, 1], 2, [8, 14], 'Tall narrow columnar cypress.'),
  E('tree_cactus', 'nature', [1, 1], 3, [2, 6], 'Desert saguaro cactus / agave.'),
  E('bush', 'nature', [1, 1], 4, [0.8, 2.5], 'Bush / shrub clump, some flowering.'),
  E('rock', 'nature', [1, 1], 4, [0.5, 4], 'Boulder / rock cluster.'),

  // ------------------------------------------------------------------ VEHICLES (front faces +Z, centered at origin, wheels on y=0)
  E('car_sedan', 'vehicle', [1, 1], 6, [1.4, 1.5], 'Sedan ~4.6m long along Z; variants = body colors/trim.'),
  E('car_hatch', 'vehicle', [1, 1], 6, [1.4, 1.6], 'Compact hatchback ~4m.'),
  E('car_suv', 'vehicle', [1, 1], 5, [1.7, 1.9], 'SUV ~4.8m.'),
  E('car_pickup', 'vehicle', [1, 1], 4, [1.8, 1.9], 'Pickup truck ~5.3m.'),
  E('car_taxi', 'vehicle', [1, 1], 1, [1.5, 1.7], 'Yellow taxi with roof sign.'),
  E('car_police', 'vehicle', [1, 1], 1, [1.5, 1.7], 'Police cruiser with light bar (emissive).'),
  E('car_van', 'vehicle', [1, 1], 4, [2.0, 2.5], 'Delivery van ~5.5m.'),
  E('bus', 'vehicle', [1, 1], 2, [3, 3.3], 'City bus ~12m, windows, route sign.'),
  E('truck_box', 'vehicle', [1, 1], 4, [3, 3.6], 'Box truck ~8m, variants with colored cargo box.'),
  E('truck_semi', 'vehicle', [1, 1], 3, [3.8, 4.1], 'Semi truck with trailer ~16m.'),
  E('fire_truck', 'vehicle', [1, 1], 1, [3, 3.5], 'Red fire engine with ladder.'),
  E('ambulance', 'vehicle', [1, 1], 1, [2.6, 3], 'Ambulance, white with red stripes.'),
  E('garbage_truck', 'vehicle', [1, 1], 1, [3.2, 3.6], 'Garbage truck.'),
  E('train_loco', 'vehicle', [1, 1], 2, [4, 4.5], 'Train locomotive ~20m long along Z.'),
  E('train_car', 'vehicle', [1, 1], 3, [4, 4.3], 'Train car ~20m: passenger / freight boxcar / tanker.'),
  E('airplane', 'vehicle', [1, 1], 2, [8, 12], 'Passenger jet ~40m long (for airports).'),
  E('ship_container', 'vehicle', [1, 1], 1, [15, 30], 'Container ship ~150m along Z (for seaport ambience).'),
  E('boat_small', 'vehicle', [1, 1], 3, [2, 10], 'Small boat / sailboat / yacht ~10m.'),

  // ------------------------------------------------------------------ PROPS
  E('streetlight', 'prop', [1, 1], 2, [8, 10], 'Street light pole with arm and emissive lamp head (arm points toward -X).'),
  E('traffic_light', 'prop', [1, 1], 1, [5, 6], 'Traffic light pole with signal heads.'),
  E('bench', 'prop', [1, 1], 1, [0.8, 1], 'Park bench.'),
  E('fountain', 'prop', [1, 1], 2, [2, 4], 'Small fountain with water surface.'),
  E('billboard', 'prop', [1, 1], 2, [8, 12], 'Roadside billboard on pole, emissive panel.'),
  E('container_stack', 'prop', [1, 1], 3, [2.6, 8], 'Stack of shipping containers, varied colors.'),
  E('construction_site', 'prop', [1, 1], 3, [2, 25], 'Construction site dressing: dirt, fence, crane or scaffolding (overlay for buildings under construction; scaled to lot by renderer).'),
  E('rubble', 'prop', [1, 1], 4, [0.5, 3.5], 'Rubble / burnt debris of destroyed buildings, one 16 m cell (tile it over bigger lots): v0 charred brick, v1 concrete, v2 concrete + burnt car, v3 low debris field with a standing wall corner.'),
];

// showpiece / waterfront metadata
for (const e of MANIFEST) {
  if (e.id === 'tr_seaport' || e.id === 'tr_ferry_terminal' || e.id === 'park_marina' || e.id === 'lm_lighthouse') e.waterfront = true;
  if (e.id === 'park_zoo' || e.id === 'park_golf' || e.id === 'park_amusement') e.budget = 6000;
  if (e.id === 'park_stadium' || e.id === 'park_large') e.budget = 4500;
  if (e.id === 'tr_airport_large' || e.id === 'tr_airport_small' || e.id === 'tr_seaport') e.budget = 6000;
  if (e.id === 'util_wind_turbine') e.overhang = 18;
  // growables get X-mirrored twins so streets don't look stamped (garage sides alternate, etc.)
  if (e.group === 'residential' || e.group === 'commercial' || e.group === 'industrial') {
    e.mirror = true;
    e.buildVariants = e.variants;
    e.variants = e.variants * 2;
  }
}

export const MANIFEST_BY_ID: Record<string, ManifestEntry> = Object.fromEntries(MANIFEST.map((e) => [e.id, e]));

export function manifestByGroup(group: AssetGroup): ManifestEntry[] {
  return MANIFEST.filter((e) => e.group === group);
}
