//#region src/core/types.ts
function zoneFamily(z) {
	if (z >= 1 && z <= 3) return "R";
	if (z >= 4 && z <= 6) return "C";
	if (z >= 7 && z <= 9) return "I";
	if (z === 10) return "X";
	return null;
}
function isRoad(n) {
	return n >= 1 && n <= 5;
}
//#endregion
//#region src/core/constants.ts
const START_YEAR = 2e3;
/** Real seconds per simulated day at each speed setting (index = speed). 0 = paused. */
const SECONDS_PER_DAY = [
	Infinity,
	.5,
	.2,
	.05
];
//#endregion
//#region src/sim/CityState.ts
const BF = {
	Powered: 1,
	Watered: 2,
	Abandoned: 4,
	OnFire: 8,
	Burnt: 16,
	NoRoad: 32,
	Historic: 64,
	Constructing: 128,
	Plopped: 256,
	NoJobs: 512,
	Congested: 1024,
	Polluted: 2048,
	Crime: 4096,
	NoGarbage: 8192
};
var CityState = class {
	size;
	cells;
	config;
	/** absolute days since city founded */
	day = 0;
	get dayOfMonth() {
		return this.day % 30;
	}
	get month() {
		return Math.floor(this.day / 30) % 12;
	}
	get year() {
		return this.config.startYear + Math.floor(this.day / 360);
	}
	get monthIndex() {
		return Math.floor(this.day / 30);
	}
	funds = 0;
	/** corner heights (N+1)^2, meters */
	heights;
	/** 1 = water cell */
	water;
	/** tree density per cell 0..4 (0 = none); renderer scatters instances */
	trees;
	zone;
	network;
	/** network flags: bit0 bridge, bit1 tunnel, bits2-3 one-way direction (0:+x 1:+z 2:-x 3:-z), bit4 has bus stop */
	netFlags;
	/** 1 = power line on cell */
	powerLines;
	/** 1 = subway tunnel on cell */
	subway;
	/** building id covering this cell, -1 if none */
	building;
	powered;
	watered;
	/** trips/day through road cell */
	traffic;
	/** volume / capacity (0 .. >1) */
	congestion;
	/** commute minutes for residents at this cell */
	commute;
	airPollution;
	waterPollution;
	garbage;
	noise;
	crime;
	policeCov;
	fireCov;
	healthCov;
	eduCov;
	parkCov;
	transitCov;
	landValue;
	/** desirability per DevType: desirability[dev][i], -1..1 */
	desirability;
	buildings = /* @__PURE__ */ new Map();
	nextBuildingId = 1;
	budget;
	stats;
	history;
	news = [];
	/** unlocked reward/requirement ids */
	unlocked = /* @__PURE__ */ new Set();
	/** ids of rewards already announced (so each unlock is announced once) */
	announced = /* @__PURE__ */ new Set();
	/** plopped unique building defs present */
	milestones = {};
	/** per-edge neighbor connections: which map edges have road/rail/highway leaving the map */
	neighborConnections = [];
	/** arbitrary per-system persistent data (must be structured-clone friendly) */
	systemData = {};
	constructor(config) {
		this.config = config;
		const N = this.size = config.size;
		const C = this.cells = N * N;
		this.heights = new Float32Array((N + 1) * (N + 1));
		this.water = new Uint8Array(C);
		this.trees = new Uint8Array(C);
		this.zone = new Uint8Array(C);
		this.network = new Uint8Array(C);
		this.netFlags = new Uint8Array(C);
		this.powerLines = new Uint8Array(C);
		this.subway = new Uint8Array(C);
		this.building = new Int32Array(C).fill(-1);
		this.powered = new Uint8Array(C);
		this.watered = new Uint8Array(C);
		this.traffic = new Float32Array(C);
		this.congestion = new Float32Array(C);
		this.commute = new Float32Array(C);
		this.airPollution = new Float32Array(C);
		this.waterPollution = new Float32Array(C);
		this.garbage = new Float32Array(C);
		this.noise = new Float32Array(C);
		this.crime = new Float32Array(C);
		this.policeCov = new Float32Array(C);
		this.fireCov = new Float32Array(C);
		this.healthCov = new Float32Array(C);
		this.eduCov = new Float32Array(C);
		this.parkCov = new Float32Array(C);
		this.transitCov = new Float32Array(C);
		this.landValue = new Float32Array(C);
		this.desirability = Array.from({ length: 12 }, () => new Float32Array(C));
		this.funds = config.startFunds;
		this.budget = {
			taxRates: new Array(12).fill(9),
			funding: {
				police: 100,
				fire: 100,
				health: 100,
				education: 100,
				transit: 100,
				parks: 100,
				utilities: 100,
				roads: 100
			},
			ordinances: [],
			loans: [],
			lastIncome: {},
			lastExpense: {},
			curIncome: {},
			curExpense: {}
		};
		this.stats = {
			population: 0,
			residents: [
				0,
				0,
				0
			],
			jobsByDev: new Array(12).fill(0),
			jobCapByDev: new Array(12).fill(0),
			workforce: 0,
			employed: 0,
			unemployment: 0,
			demand: new Array(12).fill(0),
			demandCap: new Array(12).fill(0),
			powerSupply: 0,
			powerDemand: 0,
			waterSupply: 0,
			waterDemand: 0,
			garbageProduced: 0,
			garbageCapacity: 0,
			eq: 50,
			hq: 50,
			avgLandValue: 0,
			avgCrime: 0,
			avgPollution: 0,
			avgTraffic: 0,
			avgCommute: 0,
			approval: 50,
			tripsCar: 0,
			tripsTransit: 0,
			tripsWalk: 0,
			buildingCount: 0
		};
		this.history = {
			t: [],
			pop: [],
			funds: [],
			income: [],
			expense: [],
			r: [],
			c: [],
			i: [],
			landValue: [],
			crime: [],
			pollution: [],
			traffic: [],
			eq: [],
			hq: [],
			approval: []
		};
	}
	idx(x, z) {
		return z * this.size + x;
	}
	inBounds(x, z) {
		return x >= 0 && z >= 0 && x < this.size && z < this.size;
	}
	hIdx(x, z) {
		return z * (this.size + 1) + x;
	}
	/** corner height */
	cornerHeight(x, z) {
		return this.heights[this.hIdx(x, z)];
	}
	/** average height of a cell (4 corners) */
	cellHeight(x, z) {
		const N1 = this.size + 1;
		const h = this.heights;
		const i = z * N1 + x;
		return (h[i] + h[i + 1] + h[i + N1] + h[i + N1 + 1]) * .25;
	}
	/** bilinear height at world position (meters). */
	heightAt(wx, wz, cellSize = 16) {
		const N = this.size;
		const fx = Math.min(Math.max(wx / cellSize, 0), N - 1e-4);
		const fz = Math.min(Math.max(wz / cellSize, 0), N - 1e-4);
		const x = Math.floor(fx), z = Math.floor(fz);
		const tx = fx - x, tz = fz - z;
		const N1 = N + 1;
		const h = this.heights;
		const i = z * N1 + x;
		const a = h[i], b = h[i + 1], c = h[i + N1], d = h[i + N1 + 1];
		return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
	}
	/** max slope (m) between corners of the cell */
	cellSlope(x, z) {
		const N1 = this.size + 1;
		const h = this.heights;
		const i = z * N1 + x;
		const a = h[i], b = h[i + 1], c = h[i + N1], d = h[i + N1 + 1];
		return Math.max(a, b, c, d) - Math.min(a, b, c, d);
	}
	isWater(x, z) {
		return this.water[this.idx(x, z)] === 1;
	}
	isRoadAt(x, z) {
		return this.inBounds(x, z) && isRoad(this.network[this.idx(x, z)]);
	}
	zoneAt(x, z) {
		return this.zone[this.idx(x, z)];
	}
	buildingAt(x, z) {
		if (!this.inBounds(x, z)) return void 0;
		const id = this.building[this.idx(x, z)];
		return id >= 0 ? this.buildings.get(id) : void 0;
	}
	/** add a news / notification item */
	notify(text, kind = "info", x, z, advisor) {
		const n = {
			day: this.day,
			text,
			kind,
			x,
			z,
			advisor
		};
		this.news.push(n);
		if (this.news.length > 200) this.news.splice(0, this.news.length - 200);
		return n;
	}
	/** date label like "Mar 2003" */
	dateLabel() {
		return `${MONTH_NAMES[this.month]} ${this.year}`;
	}
};
const MONTH_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec"
];
//#endregion
//#region src/sim/config.ts
const DIFFICULTY_FUNDS = {
	easy: 25e4,
	medium: 1e5,
	hard: 4e4,
	sandbox: 1e7
};
function defaultCityConfig(partial = {}) {
	const difficulty = partial.difficulty ?? "medium";
	return {
		name: "New City",
		mayor: "Mayor",
		size: 128,
		seed: Math.floor(Math.random() * 1e9),
		difficulty,
		climate: "temperate",
		terrain: "hills",
		waterAmount: .3,
		hilliness: .4,
		treeDensity: .45,
		disasters: true,
		startFunds: DIFFICULTY_FUNDS[difficulty],
		startYear: START_YEAR,
		sandbox: difficulty === "sandbox",
		...partial
	};
}
//#endregion
//#region src/assets/manifest.ts
const E = (id, group, footprint, variants, height, desc) => ({
	id,
	group,
	footprint,
	variants,
	height,
	desc
});
const MANIFEST = [
	E("res_shack", "residential", [1, 1], 4, [3, 5], "R$ stage 1: tiny run-down wooden shack or trailer home, patchy yard, simple fence, old car or junk."),
	E("res_cottage", "residential", [1, 1], 6, [5, 8], "R$ low density: small modest cottage, gable roof, small porch, tiny yard, picket fence."),
	E("res_townhouse_row", "residential", [2, 1], 4, [8, 11], "R$ low: row of 3-4 narrow attached 2-storey townhouses with individual doors and small front steps."),
	E("res_suburban", "residential", [1, 2], 8, [6, 9], "R$$ low: suburban family home, 1-2 storeys, attached garage, driveway to the street, lawn, backyard w/ fence, maybe trampoline/shed."),
	E("res_ranch", "residential", [2, 2], 6, [5, 7], "R$$ low: wide single-storey ranch house, hip roof, big lawn, backyard patio, some with a small pool."),
	E("res_villa", "residential", [2, 2], 6, [8, 12], "R$$$ low: upscale modern or mediterranean villa, pool with deck, manicured hedges, large windows, gated drive."),
	E("res_mansion", "residential", [3, 3], 4, [10, 15], "R$$$ low: grand mansion estate, symmetric facade, columns, fountain in circular drive, gardens, tennis court or pool."),
	E("res_walkup", "residential", [1, 1], 6, [10, 14], "R$ medium: 3-4 storey brick walk-up apartment, flat roof w/ water tank or AC units, fire escape, stoop."),
	E("res_tenement", "residential", [2, 2], 4, [14, 20], "R$ medium: older 5-storey apartment block, repetitive windows, small courtyard, laundry lines, rooftop clutter."),
	E("res_rowhouses", "residential", [2, 1], 6, [9, 12], "R$$ medium: elegant brownstone / terrace row (3-4 units), bay windows, cornices, front steps."),
	E("res_apartment", "residential", [2, 2], 6, [15, 22], "R$$ medium: modern 5-7 storey apartment building with balconies, entrance canopy, landscaped strip."),
	E("res_condo", "residential", [2, 2], 6, [18, 30], "R$$$ medium: luxury 6-9 storey condo, glass balconies, rooftop terrace with plants, stepped massing."),
	E("res_courtyard", "residential", [3, 3], 3, [18, 25], "R$$ medium: U or O shaped courtyard apartment block with green inner courtyard."),
	E("res_projects", "residential", [2, 2], 4, [35, 60], "R$ high: plain concrete residential slab tower 12-18 floors, repetitive windows, small balconies, parking lot."),
	E("res_highrise_slab", "residential", [3, 2], 3, [40, 70], "R$ high: long wide residential slab block 14-22 floors (brutalist/soviet style)."),
	E("res_tower", "residential", [2, 2], 6, [60, 110], "R$$ high: residential tower 20-35 floors, balconies, podium with lobby, rooftop mechanical."),
	E("res_twin_towers", "residential", [3, 3], 3, [70, 120], "R$$ high: two residential towers of different heights on a shared podium with garden deck."),
	E("res_luxury_tower", "residential", [3, 3], 5, [100, 200], "R$$$ high: luxury glass residential tower, slender, sculpted crown, sky gardens, podium with pool."),
	E("res_supertall", "residential", [4, 4], 3, [180, 300], "R$$$ high: supertall luxury residential skyscraper with setbacks, spire or crown lights, plaza base."),
	E("com_corner_store", "commercial", [1, 1], 6, [4, 7], "CS$ low: small corner shop / convenience store, awning, sign board, storefront glass."),
	E("com_gas_station", "commercial", [2, 2], 3, [5, 8], "CS$ low: gas station with canopy over pumps, small store, price sign pole."),
	E("com_diner", "commercial", [1, 1], 3, [4, 6], "CS$ low: retro chrome diner or fast-food restaurant with parking, glowing sign."),
	E("com_strip_mall", "commercial", [3, 2], 4, [5, 8], "CS$$ low: strip mall row of 4-6 shops with colored signs, parking lot in front with striped spaces."),
	E("com_restaurant", "commercial", [2, 1], 4, [5, 9], "CS$$ low: restaurant / cafe with outdoor seating umbrellas, signage."),
	E("com_boutique", "commercial", [1, 1], 5, [6, 10], "CS$$$ low: upscale boutique, large glass storefront, stone facade, elegant awning."),
	E("com_shops_apartments", "commercial", [1, 1], 6, [10, 14], "CS$ medium: 3-4 storey mixed-use building, shops at street level with awnings, apartments above."),
	E("com_motel", "commercial", [3, 2], 3, [6, 8], "CS$ medium: 2-storey motel, L-shape, exterior walkways, parking, tall neon sign."),
	E("com_supermarket", "commercial", [3, 3], 3, [8, 11], "CS$$ medium: big-box supermarket with big sign, cart corrals, large parking lot."),
	E("com_hotel", "commercial", [2, 2], 4, [20, 40], "CS$$ medium: mid-rise hotel 6-12 floors, entrance canopy, rooftop sign."),
	E("com_department_store", "commercial", [2, 2], 4, [15, 25], "CS$$$ medium: classy department store, stone facade, display windows, flags."),
	E("com_office_small", "commercial", [2, 2], 6, [15, 30], "CO$$ medium: 4-8 floor office building, ribbon windows or glass, lobby, small plaza."),
	E("com_office_block", "commercial", [2, 2], 4, [25, 45], "CO$$ medium: 8-12 floor office block, modernist grid facade."),
	E("com_mall", "commercial", [4, 4], 2, [15, 25], "CS$$ high: large enclosed shopping mall with anchor stores, skylights, big parking."),
	E("com_hotel_tower", "commercial", [3, 3], 3, [80, 150], "CS$$$ high: luxury hotel tower with podium, lit crown, porte-cochere."),
	E("com_office_tower", "commercial", [2, 2], 8, [60, 140], "CO$$ high: office tower 18-40 floors, various styles (glass box, stone grid, setback art-deco, twisted)."),
	E("com_skyscraper", "commercial", [3, 3], 6, [120, 260], "CO$$$ high: iconic glass skyscraper, setbacks, crown, spire, plaza."),
	E("com_megatower", "commercial", [4, 4], 3, [250, 420], "CO$$$ high: supertall megatower, tapered, dramatic top, beacon lights, landscaped plaza base."),
	E("ind_farm_field", "industrial", [4, 4], 6, [.3, 3], "I-Ag: crop field lot (wheat, corn, vegetables, orchard rows, vineyard, sunflower) with hedgerow edges and a dirt track."),
	E("ind_farm_barn", "industrial", [2, 2], 4, [6, 14], "I-Ag: farmstead with red barn, grain silos, tractor, small farmhouse, fences."),
	E("ind_greenhouse", "industrial", [3, 2], 3, [4, 6], "I-Ag: rows of glass greenhouses with a packing shed."),
	E("ind_workshop", "industrial", [2, 2], 4, [6, 10], "I-D: small grimy workshop / auto repair / metal shop, yard with barrels and pallets."),
	E("ind_scrapyard", "industrial", [2, 2], 3, [4, 10], "I-D: scrap / salvage yard, piles of junk, crane, fence."),
	E("ind_smokestack_factory", "industrial", [3, 3], 4, [15, 40], "I-D: dirty heavy factory, saw-tooth roofs, tall smokestacks, pipes, storage tanks, brick."),
	E("ind_refinery", "industrial", [4, 4], 3, [20, 45], "I-D: chemical/oil refinery with cylindrical tanks, distillation columns, pipe racks, flare stack."),
	E("ind_warehouse", "industrial", [3, 2], 6, [10, 14], "I-M: large warehouse, corrugated walls, loading docks with trucks, logo stripe."),
	E("ind_assembly_plant", "industrial", [4, 3], 4, [12, 20], "I-M: manufacturing / assembly plant, big sheds, office front, rooftop units, parking."),
	E("ind_depot", "industrial", [2, 2], 3, [6, 14], "I-M: logistics depot with shipping container stacks, gantry, trucks."),
	E("ind_tech_campus", "industrial", [3, 3], 5, [10, 25], "I-HT: clean high-tech campus: glass buildings, green roofs, lawns, solar panels."),
	E("ind_lab", "industrial", [2, 2], 5, [10, 20], "I-HT: research lab / biotech building, white panels & glass, rooftop equipment."),
	E("ind_datacenter", "industrial", [3, 2], 3, [10, 14], "I-HT: data center, windowless modules, rows of cooling units, secure fence."),
	E("util_coal_plant", "utility", [4, 4], 1, [40, 80], "Coal power plant: boiler house, 2 tall stacks, conveyor, coal piles, transformer yard."),
	E("util_gas_plant", "utility", [3, 3], 1, [25, 45], "Natural gas power plant: turbine halls, stacks, spherical gas tanks."),
	E("util_oil_plant", "utility", [3, 4], 1, [30, 50], "Oil power plant: cylindrical oil tanks, boiler building, stacks."),
	E("util_nuclear_plant", "utility", [6, 6], 1, [60, 100], "Nuclear power plant: 2 hyperboloid cooling towers, containment domes, turbine hall, fences."),
	E("util_wind_turbine", "utility", [1, 1], 1, [60, 85], "Wind turbine: slender white tower, nacelle, 3 blades (static)."),
	E("util_solar_farm", "utility", [4, 4], 1, [2, 4], "Solar farm: rows of tilted dark-blue solar panels, inverter sheds, gravel."),
	E("util_hydro_dam", "utility", [3, 2], 1, [15, 30], "Small hydro-electric station building with penstocks (placed at water edges)."),
	E("util_water_pump", "utility", [1, 1], 1, [4, 8], "Water pump station: small building with pipes and a pump housing."),
	E("util_water_tower", "utility", [1, 1], 1, [25, 35], "Water tower: elevated tank on legs or pillar, painted, ladder."),
	E("util_water_treatment", "utility", [3, 3], 1, [6, 12], "Water treatment plant: round clarifier tanks with water, control building, pipes."),
	E("util_desalination", "utility", [3, 3], 1, [10, 18], "Desalination plant: long membrane halls, intake pipes, tanks (coastal)."),
	E("util_incinerator", "utility", [3, 3], 1, [30, 45], "Waste-to-energy incinerator: industrial hall, one tall stack, truck bays."),
	E("util_recycling_center", "utility", [3, 3], 1, [8, 14], "Recycling center: sorting hall, colored bins, bale piles, trucks."),
	E("util_landfill_tile", "utility", [1, 1], 4, [1, 5], "Landfill cell: dirt mound with garbage heaps (varied piles, some bulldozer). Tiles seamlessly with neighbours."),
	E("util_power_pylon", "utility", [1, 1], 1, [18, 26], "Power line lattice pylon (placed along power lines). Arms along the X axis carry wires; renderer draws the wires."),
	E("civ_police_kiosk", "civic", [1, 1], 1, [4, 6], "Small police kiosk / substation with a parked cruiser."),
	E("civ_police_station", "civic", [2, 2], 1, [8, 14], "Police station: 2-3 storey building, blue accents, flag, lot with cruisers."),
	E("civ_police_hq", "civic", [3, 3], 1, [20, 35], "Police headquarters: large modern building, helipad on roof, secure parking."),
	E("civ_jail", "civic", [4, 4], 1, [10, 18], "Prison: cell blocks, high walls, guard towers, yard."),
	E("civ_fire_station", "civic", [2, 2], 1, [8, 12], "Fire station: brick building with 2-3 red garage doors, hose tower, fire truck."),
	E("civ_fire_hq", "civic", [3, 3], 1, [12, 22], "Fire headquarters: bigger station with 4-5 bays, training tower, trucks."),
	E("civ_clinic", "civic", [2, 2], 1, [6, 10], "Medical clinic: clean low building, red cross sign, ambulance bay."),
	E("civ_hospital", "civic", [3, 3], 1, [25, 40], "Hospital: multi-wing building 6-10 floors, helipad, emergency entrance, parking."),
	E("civ_medical_center", "civic", [4, 4], 1, [40, 60], "Large medical center campus with towers, garden, helipad."),
	E("civ_elementary_school", "civic", [3, 3], 1, [6, 10], "Elementary school: 1-2 storey, playground, flag, small sports court, bus loop."),
	E("civ_high_school", "civic", [4, 4], 1, [8, 14], "High school: larger building, gym, running track w/ football field, parking."),
	E("civ_college", "civic", [5, 5], 1, [15, 35], "University campus: quad lawn, clock/bell tower, several academic halls, library dome."),
	E("civ_library", "civic", [2, 2], 1, [8, 14], "Public library: classical facade with columns and steps, or modern glass."),
	E("civ_museum", "civic", [3, 3], 1, [12, 20], "Museum: grand building with portico, dome or modern wing, sculpture plaza."),
	E("civ_city_hall", "civic", [4, 4], 1, [25, 45], "City hall: monumental civic building, central dome/clock tower, plaza with flags."),
	E("civ_mayor_house", "civic", [2, 2], 1, [8, 12], "Mayor's house: stately residence with garden, gate, flag."),
	E("civ_courthouse", "civic", [3, 3], 1, [15, 25], "Courthouse: neoclassical building, columns, wide steps, pediment."),
	E("civ_cemetery", "civic", [3, 3], 1, [2, 8], "Cemetery: rows of gravestones, paths, trees, small chapel, fence."),
	E("civ_convention_center", "civic", [4, 4], 1, [20, 30], "Convention center: huge hall with curved roof, glass lobby."),
	E("civ_bus_depot", "civic", [3, 3], 1, [8, 12], "Bus depot: garage hall with parked buses."),
	E("civ_statue", "civic", [1, 1], 1, [6, 10], "Mayor statue on a pedestal in a tiny plaza."),
	E("park_small", "park", [1, 1], 4, [2, 10], "Small park: lawn, a few trees, paths, benches, maybe small fountain or flowerbed."),
	E("park_plaza", "park", [2, 2], 3, [2, 8], "Paved plaza with fountain or sculpture, planters, benches, lamp posts."),
	E("park_playground", "park", [1, 1], 2, [2, 5], "Playground: colorful play structure, swings, slide, sandbox, rubber surface."),
	E("park_basketball", "park", [1, 1], 1, [1, 4], "Basketball court with hoops and fence."),
	E("park_tennis", "park", [2, 1], 1, [1, 4], "Two tennis courts with nets and fences."),
	E("park_soccer", "park", [3, 2], 1, [1, 6], "Soccer field with goals, small stands, lights."),
	E("park_baseball", "park", [3, 3], 1, [1, 12], "Baseball diamond with dugouts, bleachers, lights."),
	E("park_large", "park", [4, 4], 2, [2, 14], "Large park: pond, winding paths, many trees, gazebo, meadow."),
	E("park_garden", "park", [2, 2], 2, [1, 6], "Formal garden: hedge maze / parterre, flower beds, pergola."),
	E("park_marina", "park", [2, 2], 1, [1, 6], "Marina with docks and small boats (placed at shore; +Z side touches water)."),
	E("park_zoo", "park", [6, 6], 1, [2, 15], "Zoo: animal enclosures with ponds/rocks, paths, aviary dome."),
	E("park_golf", "park", [6, 6], 1, [1, 10], "Country club golf course: fairways, greens with flags, bunkers, pond, clubhouse."),
	E("park_stadium", "park", [6, 6], 1, [30, 50], "Sports stadium: oval bowl with tiered seating, pitch, roof canopy, floodlights."),
	E("park_amusement", "park", [6, 6], 1, [10, 60], "Amusement park: ferris wheel, roller coaster track, carousel, colorful tents."),
	E("lm_spire_tower", "landmark", [2, 2], 1, [400, 550], "Observation / TV tower: tapered concrete shaft, observation pod, antenna spire."),
	E("lm_cathedral", "landmark", [3, 4], 1, [50, 90], "Gothic cathedral: nave, twin front spires, rose window, flying buttresses."),
	E("lm_clock_tower", "landmark", [1, 1], 1, [60, 90], "Tall stone clock tower with 4 clock faces and pointed roof."),
	E("lm_observatory", "landmark", [2, 2], 1, [15, 25], "Observatory with white dome and telescope slit on a stone base."),
	E("lm_arch", "landmark", [2, 1], 1, [30, 50], "Triumphal arch monument."),
	E("lm_obelisk", "landmark", [1, 1], 1, [60, 170], "Tall obelisk monument with reflecting pool."),
	E("lm_ferris_wheel", "landmark", [3, 2], 1, [60, 120], "Giant observation wheel with capsules."),
	E("lm_twin_spires", "landmark", [3, 3], 1, [350, 450], "Twin skyscraper landmark joined by a skybridge."),
	E("lm_opera_house", "landmark", [4, 4], 1, [30, 60], "Opera house with stacked white shell roofs on a podium (at waterfront works great)."),
	E("lm_pyramid", "landmark", [3, 3], 1, [30, 50], "Glass pyramid pavilion with plaza and fountains."),
	E("lm_castle", "landmark", [4, 4], 1, [25, 50], "Medieval castle with keep, towers, crenellated walls."),
	E("lm_lighthouse", "landmark", [1, 1], 1, [25, 40], "Lighthouse with red/white stripes and lantern room (emissive light)."),
	E("rw_military_base", "reward", [8, 8], 1, [5, 25], "Military base: runway strip, hangars, barracks, radar dish, fences."),
	E("rw_casino", "reward", [3, 3], 1, [30, 60], "Glitzy casino resort, lots of emissive neon signage, fountain."),
	E("rw_toxic_dump", "reward", [4, 4], 1, [3, 10], "Toxic waste dump: rows of barrels, green ooze pools (emissive-ish), hazard fences."),
	E("rw_missile_range", "reward", [6, 6], 1, [5, 30], "Missile test range: launch pads, bunkers, gantry tower, scorched ground."),
	E("rw_research_center", "reward", [4, 4], 1, [20, 40], "Advanced research center: futuristic curved glass building, radio dishes."),
	E("tr_bus_stop", "transport", [1, 1], 1, [2, 4], "Bus stop: small shelter with bench and sign near the +Z edge (sidewalk), rest of lot is plaza/grass."),
	E("tr_subway_station", "transport", [1, 1], 1, [3, 6], "Subway entrance: stair canopy with sign (emissive M-like logo), small plaza."),
	E("tr_train_station", "transport", [4, 2], 1, [10, 20], "Passenger train station: station hall with clock, platforms with canopies along the back (-Z) side."),
	E("tr_freight_station", "transport", [4, 2], 1, [8, 14], "Freight rail yard: loading sheds, container stacks, gantry crane."),
	E("tr_parking_garage", "transport", [2, 2], 1, [10, 18], "Multi-storey parking garage, open floors with cars, ramp."),
	E("tr_airport_small", "transport", [8, 6], 1, [8, 25], "Small airport: runway along X, terminal, control tower, hangar, apron with planes."),
	E("tr_airport_large", "transport", [12, 8], 1, [10, 35], "International airport: long runway, big terminal with jet bridges, tower, taxiways, parked jets."),
	E("tr_seaport", "transport", [6, 6], 1, [10, 50], "Container seaport: quay on +Z side (water), gantry cranes, container stacks, warehouses."),
	E("tr_ferry_terminal", "transport", [2, 2], 1, [6, 10], "Ferry terminal with pier (water on +Z side)."),
	E("tree_oak", "nature", [1, 1], 4, [8, 14], "Broadleaf oak-like tree: trunk + 2-3 lumpy low-poly foliage blobs."),
	E("tree_maple", "nature", [1, 1], 3, [7, 12], "Rounded maple tree, some variants autumn orange/red."),
	E("tree_birch", "nature", [1, 1], 3, [8, 13], "Slender birch, white trunk, light green narrow crown."),
	E("tree_pine", "nature", [1, 1], 4, [10, 20], "Pine tree: tall trunk, stacked cone foliage tiers."),
	E("tree_spruce", "nature", [1, 1], 3, [8, 16], "Dense conical spruce, dark green."),
	E("tree_palm", "nature", [1, 1], 3, [8, 14], "Palm tree: curved segmented trunk, drooping fronds."),
	E("tree_cypress", "nature", [1, 1], 2, [8, 14], "Tall narrow columnar cypress."),
	E("tree_cactus", "nature", [1, 1], 3, [2, 6], "Desert saguaro cactus / agave."),
	E("bush", "nature", [1, 1], 4, [.8, 2.5], "Bush / shrub clump, some flowering."),
	E("rock", "nature", [1, 1], 4, [.5, 4], "Boulder / rock cluster."),
	E("car_sedan", "vehicle", [1, 1], 6, [1.4, 1.5], "Sedan ~4.6m long along Z; variants = body colors/trim."),
	E("car_hatch", "vehicle", [1, 1], 6, [1.4, 1.6], "Compact hatchback ~4m."),
	E("car_suv", "vehicle", [1, 1], 5, [1.7, 1.9], "SUV ~4.8m."),
	E("car_pickup", "vehicle", [1, 1], 4, [1.8, 1.9], "Pickup truck ~5.3m."),
	E("car_taxi", "vehicle", [1, 1], 1, [1.5, 1.7], "Yellow taxi with roof sign."),
	E("car_police", "vehicle", [1, 1], 1, [1.5, 1.7], "Police cruiser with light bar (emissive)."),
	E("car_van", "vehicle", [1, 1], 4, [2, 2.5], "Delivery van ~5.5m."),
	E("bus", "vehicle", [1, 1], 2, [3, 3.3], "City bus ~12m, windows, route sign."),
	E("truck_box", "vehicle", [1, 1], 4, [3, 3.6], "Box truck ~8m, variants with colored cargo box."),
	E("truck_semi", "vehicle", [1, 1], 3, [3.8, 4.1], "Semi truck with trailer ~16m."),
	E("fire_truck", "vehicle", [1, 1], 1, [3, 3.5], "Red fire engine with ladder."),
	E("ambulance", "vehicle", [1, 1], 1, [2.6, 3], "Ambulance, white with red stripes."),
	E("garbage_truck", "vehicle", [1, 1], 1, [3.2, 3.6], "Garbage truck."),
	E("train_loco", "vehicle", [1, 1], 2, [4, 4.5], "Train locomotive ~20m long along Z."),
	E("train_car", "vehicle", [1, 1], 3, [4, 4.3], "Train car ~20m: passenger / freight boxcar / tanker."),
	E("airplane", "vehicle", [1, 1], 2, [8, 12], "Passenger jet ~40m long (for airports)."),
	E("ship_container", "vehicle", [1, 1], 1, [15, 30], "Container ship ~150m along Z (for seaport ambience)."),
	E("boat_small", "vehicle", [1, 1], 3, [2, 5], "Small boat / sailboat / yacht ~10m."),
	E("streetlight", "prop", [1, 1], 2, [8, 10], "Street light pole with arm and emissive lamp head (arm points toward -X)."),
	E("traffic_light", "prop", [1, 1], 1, [5, 6], "Traffic light pole with signal heads."),
	E("bench", "prop", [1, 1], 1, [.8, 1], "Park bench."),
	E("fountain", "prop", [1, 1], 2, [2, 4], "Small fountain with water surface."),
	E("billboard", "prop", [1, 1], 2, [8, 12], "Roadside billboard on pole, emissive panel."),
	E("container_stack", "prop", [1, 1], 3, [2.6, 8], "Stack of shipping containers, varied colors."),
	E("construction_site", "prop", [1, 1], 3, [2, 25], "Construction site dressing: dirt, fence, crane or scaffolding (overlay for buildings under construction; scaled to lot by renderer)."),
	E("rubble", "prop", [1, 1], 2, [.5, 2], "Rubble / burnt debris pile for destroyed buildings.")
];
const MANIFEST_BY_ID = Object.fromEntries(MANIFEST.map((e) => [e.id, e]));
//#endregion
//#region src/sim/catalog.ts
function fp(model) {
	const m = MANIFEST_BY_ID[model];
	if (!m) throw new Error(`[catalog] model "${model}" missing from manifest`);
	return [m.footprint[0], m.footprint[1]];
}
const DEV_KEY = [
	"r1",
	"r2",
	"r3",
	"cs1",
	"cs2",
	"cs3",
	"co2",
	"co3",
	"ia",
	"id",
	"im",
	"iht"
];
const L = "L";
const M = "M";
const H = "H";
function devFamily(dev) {
	return dev <= 2 ? "R" : dev <= 7 ? "C" : "I";
}
function zonesFor(dev, dens) {
	const fam = devFamily(dev);
	const out = [];
	for (const d of dens) if (fam === "R") out.push(d === L ? 1 : d === M ? 2 : 3);
	else if (fam === "C") out.push(d === L ? 4 : d === M ? 5 : 6);
	else if (dev === 8) out.push(7);
	else out.push(d === H ? 9 : 8);
	return [...new Set(out)];
}
/** per-unit utility use by DevType: [MW per capacity unit, kL/day per unit, garbage t/month per unit] */
const UNIT_USE = {
	[0]: [
		8e-4,
		.2,
		.035
	],
	[1]: [
		.001,
		.25,
		.04
	],
	[2]: [
		.0014,
		.4,
		.05
	],
	[3]: [
		.0015,
		.05,
		.04
	],
	[4]: [
		.0015,
		.05,
		.035
	],
	[5]: [
		.0016,
		.06,
		.03
	],
	[6]: [
		.002,
		.04,
		.02
	],
	[7]: [
		.002,
		.04,
		.02
	],
	[8]: [
		.001,
		3,
		.03
	],
	[9]: [
		.004,
		.4,
		.12
	],
	[10]: [
		.003,
		.25,
		.08
	],
	[11]: [
		.0025,
		.15,
		.03
	]
};
/** display names for growable models (query tool) */
const GROW_NAMES = {
	res_shack: "Shack",
	res_cottage: "Cottage",
	res_townhouse_row: "Townhouses",
	res_suburban: "Suburban Home",
	res_ranch: "Ranch House",
	res_villa: "Villa",
	res_mansion: "Mansion",
	res_walkup: "Walk-up Apartments",
	res_tenement: "Tenement Block",
	res_rowhouses: "Brownstones",
	res_apartment: "Apartment Building",
	res_condo: "Luxury Condos",
	res_courtyard: "Courtyard Apartments",
	res_projects: "Housing Projects",
	res_highrise_slab: "High-rise Slab",
	res_tower: "Residential Tower",
	res_twin_towers: "Twin Residential Towers",
	res_luxury_tower: "Luxury Tower",
	res_supertall: "Supertall Residences",
	com_corner_store: "Corner Store",
	com_gas_station: "Gas Station",
	com_diner: "Diner",
	com_strip_mall: "Strip Mall",
	com_restaurant: "Restaurant",
	com_boutique: "Boutique",
	com_shops_apartments: "Shops & Apartments",
	com_motel: "Motel",
	com_supermarket: "Supermarket",
	com_hotel: "Hotel",
	com_department_store: "Department Store",
	com_office_small: "Office Building",
	com_office_block: "Office Block",
	com_mall: "Shopping Mall",
	com_hotel_tower: "Hotel Tower",
	com_office_tower: "Office Tower",
	com_skyscraper: "Skyscraper",
	com_megatower: "Megatower",
	ind_farm_field: "Farm Field",
	ind_farm_barn: "Farmstead",
	ind_greenhouse: "Greenhouses",
	ind_workshop: "Workshop",
	ind_scrapyard: "Scrapyard",
	ind_smokestack_factory: "Factory",
	ind_refinery: "Refinery",
	ind_warehouse: "Warehouse",
	ind_assembly_plant: "Assembly Plant",
	ind_depot: "Logistics Depot",
	ind_tech_campus: "Tech Campus",
	ind_lab: "Research Lab",
	ind_datacenter: "Data Center"
};
function g(model, dev, stage, capacity, dens, o = {}) {
	const [pu, wu, gu] = UNIT_USE[dev];
	const def = {
		id: `${model}.${DEV_KEY[dev]}.${stage}`,
		name: GROW_NAMES[model] ?? model,
		model,
		category: "growable",
		footprint: fp(model),
		description: o.description ?? MANIFEST_BY_ID[model]?.desc,
		devType: dev,
		zones: zonesFor(dev, dens),
		stage,
		capacity,
		powerUse: round3(capacity * pu * (o.powerMul ?? 1)),
		waterUse: round3(capacity * wu * (o.waterMul ?? 1)),
		hidden: true
	};
	const garbage = round3(capacity * gu);
	if (o.air || o.water || o.noise || garbage) {
		def.pollution = { garbage };
		if (o.air) def.pollution.air = o.air;
		if (o.water) def.pollution.water = o.water;
		if (o.noise) def.pollution.noise = o.noise;
		if (o.air || o.water || o.noise) def.pollution.radius = o.radius ?? 3;
	}
	return def;
}
function round3(v) {
	return Math.round(v * 1e3) / 1e3;
}
const R1 = 0;
const R2 = 1;
const R3 = 2;
const CS1 = 3;
const CS2 = 4;
const CS3 = 5;
const CO2 = 6;
const CO3 = 7;
const IA = 8;
const ID = 9;
const IM = 10;
const IHT = 11;
const GROWABLES = [
	g("res_shack", R1, 1, 6, [L, M]),
	g("res_cottage", R1, 2, 10, [L, M]),
	g("res_townhouse_row", R1, 3, 30, [L, M]),
	g("res_walkup", R1, 3, 60, [M, H]),
	g("res_walkup", R1, 4, 90, [M, H]),
	g("res_tenement", R1, 5, 320, [M, H]),
	g("res_projects", R1, 6, 1100, [H]),
	g("res_highrise_slab", R1, 7, 2400, [H]),
	g("res_cottage", R2, 1, 8, [L]),
	g("res_suburban", R2, 2, 14, [L, M]),
	g("res_ranch", R2, 3, 20, [L]),
	g("res_rowhouses", R2, 3, 50, [M, H]),
	g("res_apartment", R2, 4, 280, [M, H]),
	g("res_courtyard", R2, 5, 750, [M, H]),
	g("res_tower", R2, 6, 1500, [H]),
	g("res_tower", R2, 7, 2100, [H]),
	g("res_twin_towers", R2, 8, 4200, [H]),
	g("res_villa", R3, 1, 6, [L, M]),
	g("res_villa", R3, 2, 8, [L]),
	g("res_mansion", R3, 3, 12, [L]),
	g("res_condo", R3, 4, 220, [M, H]),
	g("res_condo", R3, 5, 320, [M, H]),
	g("res_luxury_tower", R3, 6, 1800, [H]),
	g("res_luxury_tower", R3, 7, 2600, [H]),
	g("res_supertall", R3, 8, 7500, [H]),
	g("com_corner_store", CS1, 1, 8, [
		L,
		M,
		H
	], {
		noise: .05,
		radius: 1
	}),
	g("com_diner", CS1, 1, 10, [L, M], {
		noise: .05,
		radius: 1
	}),
	g("com_gas_station", CS1, 2, 15, [L, M], {
		air: .05,
		noise: .1,
		radius: 2
	}),
	g("com_shops_apartments", CS1, 3, 40, [M, H], {
		noise: .05,
		radius: 1
	}),
	g("com_motel", CS1, 3, 45, [M, H], {
		noise: .1,
		radius: 2
	}),
	g("com_supermarket", CS1, 4, 140, [M, H], {
		noise: .15,
		radius: 3
	}),
	g("com_hotel", CS1, 5, 250, [M, H], {
		noise: .1,
		radius: 2
	}),
	g("com_restaurant", CS2, 1, 15, [L, M], {
		noise: .05,
		radius: 1
	}),
	g("com_strip_mall", CS2, 2, 60, [L, M], {
		noise: .15,
		radius: 2
	}),
	g("com_supermarket", CS2, 3, 150, [M, H], {
		noise: .15,
		radius: 3
	}),
	g("com_hotel", CS2, 4, 280, [M, H], {
		noise: .1,
		radius: 2
	}),
	g("com_mall", CS2, 6, 1100, [H], {
		noise: .25,
		radius: 4
	}),
	g("com_hotel_tower", CS2, 7, 1600, [H], {
		noise: .15,
		radius: 3
	}),
	g("com_boutique", CS3, 1, 12, [
		L,
		M,
		H
	], {
		noise: .03,
		radius: 1
	}),
	g("com_restaurant", CS3, 2, 20, [L, M], {
		noise: .05,
		radius: 1
	}),
	g("com_department_store", CS3, 4, 350, [M, H], {
		noise: .1,
		radius: 2
	}),
	g("com_hotel_tower", CS3, 7, 2e3, [H], {
		noise: .15,
		radius: 3
	}),
	g("com_office_small", CO2, 3, 240, [M, H]),
	g("com_office_block", CO2, 4, 520, [M, H]),
	g("com_office_tower", CO2, 6, 2400, [H], {
		noise: .1,
		radius: 2
	}),
	g("com_office_tower", CO2, 7, 3200, [H], {
		noise: .1,
		radius: 2
	}),
	g("com_office_small", CO3, 3, 220, [M, H]),
	g("com_office_block", CO3, 5, 600, [M, H]),
	g("com_office_tower", CO3, 6, 2800, [H], {
		noise: .1,
		radius: 2
	}),
	g("com_skyscraper", CO3, 7, 6500, [H], {
		noise: .15,
		radius: 3
	}),
	g("com_megatower", CO3, 8, 12e3, [H], {
		noise: .2,
		radius: 4
	}),
	g("ind_farm_field", IA, 1, 8, [L], {
		water: .15,
		radius: 3,
		waterMul: 1.25
	}),
	g("ind_farm_barn", IA, 1, 6, [L], {
		water: .1,
		radius: 2
	}),
	g("ind_greenhouse", IA, 2, 30, [L], {
		water: .05,
		radius: 2,
		waterMul: .25
	}),
	g("ind_workshop", ID, 1, 25, [M], {
		air: .2,
		water: .1,
		noise: .3,
		radius: 4
	}),
	g("ind_scrapyard", ID, 1, 18, [M], {
		air: .15,
		water: .2,
		noise: .35,
		radius: 4
	}),
	g("ind_smokestack_factory", ID, 3, 220, [M], {
		air: .6,
		water: .35,
		noise: .45,
		radius: 8
	}),
	g("ind_refinery", ID, 4, 450, [M], {
		air: .8,
		water: .5,
		noise: .5,
		radius: 11
	}),
	g("ind_workshop", IM, 1, 25, [M], {
		air: .1,
		water: .05,
		noise: .25,
		radius: 3
	}),
	g("ind_depot", IM, 2, 70, [M, H], {
		air: .08,
		noise: .35,
		radius: 4
	}),
	g("ind_warehouse", IM, 2, 100, [M, H], {
		air: .06,
		noise: .3,
		radius: 4
	}),
	g("ind_warehouse", IM, 3, 140, [M, H], {
		air: .08,
		noise: .3,
		radius: 4
	}),
	g("ind_assembly_plant", IM, 4, 520, [M, H], {
		air: .2,
		water: .1,
		noise: .35,
		radius: 6
	}),
	g("ind_lab", IHT, 2, 160, [H], {
		noise: .05,
		radius: 2
	}),
	g("ind_datacenter", IHT, 3, 120, [H], {
		noise: .15,
		radius: 2,
		powerMul: 12
	}),
	g("ind_tech_campus", IHT, 4, 700, [H], {
		noise: .05,
		radius: 2
	}),
	g("ind_tech_campus", IHT, 5, 950, [H], {
		noise: .05,
		radius: 2
	})
];
function p$1(d) {
	const model = d.model ?? d.id;
	return {
		...d,
		model,
		footprint: fp(model)
	};
}
const PLOPPABLES = [
	p$1({
		id: "util_wind_turbine",
		name: "Wind Turbine",
		category: "power",
		service: "utilities",
		cost: 800,
		upkeep: 16,
		jobs: 1,
		powerOut: 5,
		pollution: {
			noise: .25,
			radius: 3
		},
		description: "Clean but small: 5 MW. Build rows of them on windy hills. Slightly noisy."
	}),
	p$1({
		id: "util_gas_plant",
		name: "Natural Gas Power Plant",
		category: "power",
		service: "utilities",
		cost: 22e3,
		upkeep: 650,
		jobs: 90,
		powerOut: 250,
		waterUse: 400,
		pollution: {
			air: .45,
			noise: .3,
			radius: 9,
			garbage: 10
		},
		landValue: {
			amount: -.12,
			radius: 7
		},
		description: "250 MW. Cleaner than coal, moderate cost. Fuel costs scale with output."
	}),
	p$1({
		id: "util_coal_plant",
		name: "Coal Power Plant",
		category: "power",
		service: "utilities",
		cost: 25e3,
		upkeep: 700,
		jobs: 180,
		powerOut: 400,
		waterUse: 800,
		pollution: {
			air: 1,
			water: .2,
			noise: .4,
			radius: 14,
			garbage: 40
		},
		landValue: {
			amount: -.25,
			radius: 10
		},
		description: "400 MW of cheap, dirty power. Heavy air pollution — keep it downwind of homes."
	}),
	p$1({
		id: "util_oil_plant",
		name: "Oil Power Plant",
		category: "power",
		service: "utilities",
		cost: 3e4,
		upkeep: 800,
		jobs: 150,
		powerOut: 350,
		waterUse: 600,
		pollution: {
			air: .8,
			water: .25,
			noise: .35,
			radius: 12,
			garbage: 25
		},
		landValue: {
			amount: -.2,
			radius: 9
		},
		description: "350 MW. Pollutes less than coal but costs more to run."
	}),
	p$1({
		id: "util_hydro_dam",
		name: "Hydroelectric Station",
		category: "power",
		service: "utilities",
		cost: 12e3,
		upkeep: 220,
		jobs: 25,
		powerOut: 80,
		placement: "shore",
		pollution: {
			water: .05,
			noise: .1,
			radius: 3
		},
		description: "80 MW of clean power. Must be built on a shoreline (front side facing water)."
	}),
	p$1({
		id: "util_solar_farm",
		name: "Solar Farm",
		category: "power",
		service: "utilities",
		cost: 2e4,
		upkeep: 200,
		jobs: 12,
		powerOut: 60,
		requires: "solar_power",
		description: "60 MW of silent, clean power. Expensive per MW."
	}),
	p$1({
		id: "util_nuclear_plant",
		name: "Nuclear Power Plant",
		category: "power",
		service: "utilities",
		cost: 12e4,
		upkeep: 2800,
		jobs: 400,
		powerOut: 1600,
		waterUse: 3e3,
		pollution: {
			air: .05,
			water: .1,
			noise: .3,
			radius: 8,
			garbage: 200
		},
		landValue: {
			amount: -.2,
			radius: 12
		},
		requires: "nuclear_power",
		description: "1600 MW of clean power for a metropolis. Very expensive; residents dislike living next to it."
	}),
	p$1({
		id: "util_power_pylon",
		name: "Power Line",
		category: "power",
		service: "utilities",
		cost: 5,
		upkeep: .1,
		hidden: true,
		description: "Not ploppable: placed by the power line tool (cost/upkeep are per cell)."
	}),
	p$1({
		id: "util_water_tower",
		name: "Water Tower",
		category: "water",
		service: "utilities",
		cost: 300,
		upkeep: 12,
		jobs: 1,
		waterOut: 1200,
		powerUse: .1,
		description: "1,200 kL/day. Cheap, small, works anywhere."
	}),
	p$1({
		id: "util_water_pump",
		name: "Water Pump",
		category: "water",
		service: "utilities",
		cost: 500,
		upkeep: 25,
		jobs: 3,
		waterOut: 3e3,
		powerUse: .5,
		description: "3,000 kL/day. Pumps less if the ground water is polluted; best near fresh water."
	}),
	p$1({
		id: "util_water_treatment",
		name: "Water Treatment Plant",
		category: "water",
		service: "utilities",
		cost: 15e3,
		upkeep: 450,
		jobs: 60,
		waterOut: 5e4,
		powerUse: 8,
		pollution: {
			water: -.5,
			radius: 16
		},
		requires: "water_treatment",
		description: "50,000 kL/day of clean water and it cleans nearby water pollution."
	}),
	p$1({
		id: "util_desalination",
		name: "Desalination Plant",
		category: "water",
		service: "utilities",
		cost: 32e3,
		upkeep: 900,
		jobs: 80,
		waterOut: 8e4,
		powerUse: 25,
		placement: "shore",
		requires: "desalination",
		pollution: {
			noise: .15,
			radius: 3
		},
		description: "80,000 kL/day from sea water. Coastal only; power hungry."
	}),
	p$1({
		id: "util_landfill_tile",
		name: "Landfill",
		category: "garbage",
		service: "utilities",
		cost: 15,
		upkeep: 1,
		garbageCapacity: 300,
		hidden: true,
		pollution: {
			air: .15,
			water: .2,
			noise: .1,
			radius: 5
		},
		landValue: {
			amount: -.3,
			radius: 6
		},
		description: "Not ploppable: landfill is a zone. Per landfill cell: 300 t/month capacity, $15 zoning, $1/month upkeep."
	}),
	p$1({
		id: "util_recycling_center",
		name: "Recycling Center",
		category: "garbage",
		service: "utilities",
		cost: 9e3,
		upkeep: 260,
		jobs: 60,
		garbageCapacity: 4e3,
		powerUse: 2,
		pollution: {
			noise: .2,
			radius: 4
		},
		requires: "recycling_center",
		description: "Processes 4,000 t/month of garbage cleanly."
	}),
	p$1({
		id: "util_incinerator",
		name: "Waste-to-Energy Incinerator",
		category: "garbage",
		service: "utilities",
		cost: 26e3,
		upkeep: 700,
		jobs: 70,
		garbageCapacity: 12e3,
		powerOut: 60,
		pollution: {
			air: .6,
			noise: .25,
			radius: 10
		},
		landValue: {
			amount: -.15,
			radius: 8
		},
		requires: "incinerator",
		description: "Burns 12,000 t/month of garbage and generates 60 MW. Pollutes the air."
	}),
	p$1({
		id: "civ_police_kiosk",
		name: "Police Kiosk",
		category: "police",
		service: "police",
		cost: 400,
		upkeep: 80,
		jobs: 6,
		powerUse: .05,
		waterUse: 2,
		coverage: {
			kind: "police",
			radius: 10,
			strength: .6
		},
		description: "Small neighborhood police post."
	}),
	p$1({
		id: "civ_police_station",
		name: "Police Station",
		category: "police",
		service: "police",
		cost: 1500,
		upkeep: 300,
		jobs: 30,
		powerUse: .2,
		waterUse: 8,
		coverage: {
			kind: "police",
			radius: 22,
			strength: .85
		},
		description: "Standard police station."
	}),
	p$1({
		id: "civ_police_hq",
		name: "Police Headquarters",
		category: "police",
		service: "police",
		cost: 8e3,
		upkeep: 1100,
		jobs: 120,
		powerUse: .8,
		waterUse: 30,
		coverage: {
			kind: "police",
			radius: 38,
			strength: 1
		},
		requires: "police_hq",
		description: "Large, well equipped police HQ."
	}),
	p$1({
		id: "civ_jail",
		name: "Prison",
		category: "police",
		service: "police",
		cost: 12e3,
		upkeep: 900,
		jobs: 150,
		powerUse: 1,
		waterUse: 120,
		coverage: {
			kind: "police",
			radius: 64,
			strength: .15,
			capacity: 8e4
		},
		landValue: {
			amount: -.3,
			radius: 8
		},
		requires: "jail",
		description: "Keeps criminals off the streets city-wide. Nobody wants to live next to it."
	}),
	p$1({
		id: "civ_fire_station",
		name: "Fire Station",
		category: "fire",
		service: "fire",
		cost: 1400,
		upkeep: 280,
		jobs: 25,
		powerUse: .15,
		waterUse: 20,
		coverage: {
			kind: "fire",
			radius: 20,
			strength: .85
		},
		description: "Standard fire station."
	}),
	p$1({
		id: "civ_fire_hq",
		name: "Fire Headquarters",
		category: "fire",
		service: "fire",
		cost: 7e3,
		upkeep: 950,
		jobs: 90,
		powerUse: .5,
		waterUse: 60,
		coverage: {
			kind: "fire",
			radius: 34,
			strength: 1
		},
		requires: "fire_hq",
		description: "Large fire HQ with training tower."
	}),
	p$1({
		id: "civ_clinic",
		name: "Medical Clinic",
		category: "health",
		service: "health",
		cost: 1800,
		upkeep: 320,
		jobs: 30,
		powerUse: .2,
		waterUse: 15,
		coverage: {
			kind: "health",
			radius: 14,
			strength: .7,
			capacity: 6e3
		},
		description: "Neighborhood clinic (6,000 residents)."
	}),
	p$1({
		id: "civ_hospital",
		name: "Hospital",
		category: "health",
		service: "health",
		cost: 9e3,
		upkeep: 1400,
		jobs: 250,
		powerUse: 1.5,
		waterUse: 120,
		coverage: {
			kind: "health",
			radius: 32,
			strength: 1,
			capacity: 35e3
		},
		description: "Full hospital (35,000 residents)."
	}),
	p$1({
		id: "civ_medical_center",
		name: "Medical Research Center",
		category: "health",
		service: "health",
		cost: 3e4,
		upkeep: 3500,
		jobs: 800,
		powerUse: 4,
		waterUse: 300,
		coverage: {
			kind: "health",
			radius: 56,
			strength: 1,
			capacity: 12e4
		},
		landValue: {
			amount: .1,
			radius: 10
		},
		requires: "medical_center",
		unique: true,
		description: "Reward: world-class medical campus (120,000 residents). Boosts health city-wide."
	}),
	p$1({
		id: "civ_elementary_school",
		name: "Elementary School",
		category: "education",
		service: "education",
		cost: 2e3,
		upkeep: 380,
		jobs: 40,
		powerUse: .2,
		waterUse: 20,
		coverage: {
			kind: "education",
			radius: 18,
			strength: .7,
			capacity: 1e4
		},
		description: "Schools the kids of 10,000 residents."
	}),
	p$1({
		id: "civ_high_school",
		name: "High School",
		category: "education",
		service: "education",
		cost: 6e3,
		upkeep: 850,
		jobs: 90,
		powerUse: .5,
		waterUse: 50,
		coverage: {
			kind: "education",
			radius: 28,
			strength: .9,
			capacity: 25e3
		},
		description: "Serves 25,000 residents. Raises EQ."
	}),
	p$1({
		id: "civ_college",
		name: "University",
		category: "education",
		service: "education",
		cost: 25e3,
		upkeep: 2600,
		jobs: 400,
		powerUse: 2,
		waterUse: 200,
		coverage: {
			kind: "education",
			radius: 60,
			strength: 1,
			capacity: 8e4
		},
		landValue: {
			amount: .15,
			radius: 12
		},
		requires: "college",
		description: "Big EQ boost (80,000 residents). High-tech industry and offices love it."
	}),
	p$1({
		id: "civ_library",
		name: "Public Library",
		category: "education",
		service: "education",
		cost: 2500,
		upkeep: 300,
		jobs: 20,
		powerUse: .2,
		waterUse: 5,
		coverage: {
			kind: "education",
			radius: 24,
			strength: .4,
			capacity: 3e4
		},
		landValue: {
			amount: .05,
			radius: 6
		},
		description: "Lifelong learning; mild EQ boost."
	}),
	p$1({
		id: "civ_museum",
		name: "Museum",
		category: "education",
		service: "education",
		cost: 8e3,
		upkeep: 650,
		jobs: 30,
		powerUse: .4,
		waterUse: 10,
		coverage: {
			kind: "education",
			radius: 40,
			strength: .35,
			capacity: 6e4
		},
		landValue: {
			amount: .15,
			radius: 10
		},
		requires: "museum",
		description: "Culture! Raises EQ and land value."
	}),
	p$1({
		id: "civ_mayor_house",
		name: "Mayor's House",
		category: "civic",
		cost: 2e3,
		upkeep: 50,
		jobs: 4,
		landValue: {
			amount: .2,
			radius: 8
		},
		requires: "mayor_house",
		unique: true,
		description: "Reward: a stately home for the mayor. Raises land value around it."
	}),
	p$1({
		id: "civ_statue",
		name: "Statue of the Mayor",
		category: "civic",
		cost: 500,
		upkeep: 5,
		landValue: {
			amount: .1,
			radius: 5
		},
		requires: "statue",
		unique: true,
		description: "Reward for high approval. The citizens adore you."
	}),
	p$1({
		id: "civ_cemetery",
		name: "Cemetery",
		category: "civic",
		cost: 1200,
		upkeep: 60,
		jobs: 4,
		landValue: {
			amount: .03,
			radius: 4
		},
		requires: "cemetery",
		description: "Quiet green space; residents like having one nearby."
	}),
	p$1({
		id: "civ_courthouse",
		name: "Courthouse",
		category: "civic",
		service: "police",
		cost: 6e3,
		upkeep: 400,
		jobs: 60,
		powerUse: .3,
		waterUse: 10,
		coverage: {
			kind: "police",
			radius: 64,
			strength: .1
		},
		landValue: {
			amount: .1,
			radius: 8
		},
		requires: "courthouse",
		unique: true,
		description: "Reward: justice! Makes the whole police force more effective."
	}),
	p$1({
		id: "civ_city_hall",
		name: "City Hall",
		category: "civic",
		cost: 2e4,
		upkeep: 900,
		jobs: 200,
		powerUse: 1,
		waterUse: 40,
		landValue: {
			amount: .2,
			radius: 14
		},
		requires: "city_hall",
		unique: true,
		description: "Reward: the seat of government. Attracts offices and residents."
	}),
	p$1({
		id: "civ_convention_center",
		name: "Convention Center",
		category: "civic",
		cost: 3e4,
		upkeep: 1200,
		income: 500,
		jobs: 250,
		powerUse: 2,
		waterUse: 60,
		landValue: {
			amount: .1,
			radius: 10
		},
		pollution: {
			noise: .2,
			radius: 4
		},
		requires: "convention_center",
		unique: true,
		description: "Reward: brings business visitors. Big boost to commercial demand cap."
	}),
	p$1({
		id: "park_small",
		name: "Small Park",
		category: "park",
		service: "parks",
		cost: 150,
		upkeep: 12,
		coverage: {
			kind: "park",
			radius: 6,
			strength: .6
		},
		landValue: {
			amount: .12,
			radius: 5
		},
		description: "Lawn, trees and benches. Raises the residential demand cap."
	}),
	p$1({
		id: "park_playground",
		name: "Playground",
		category: "park",
		service: "parks",
		cost: 250,
		upkeep: 10,
		coverage: {
			kind: "park",
			radius: 5,
			strength: .5
		},
		landValue: {
			amount: .08,
			radius: 4
		},
		description: "Families love it."
	}),
	p$1({
		id: "park_basketball",
		name: "Basketball Court",
		category: "park",
		service: "parks",
		cost: 300,
		upkeep: 12,
		coverage: {
			kind: "park",
			radius: 5,
			strength: .45
		},
		landValue: {
			amount: .06,
			radius: 4
		},
		description: "Neighborhood court."
	}),
	p$1({
		id: "park_tennis",
		name: "Tennis Courts",
		category: "park",
		service: "parks",
		cost: 450,
		upkeep: 15,
		coverage: {
			kind: "park",
			radius: 6,
			strength: .5
		},
		landValue: {
			amount: .1,
			radius: 5
		},
		description: "Popular with the well-off."
	}),
	p$1({
		id: "park_plaza",
		name: "Plaza",
		category: "park",
		service: "parks",
		cost: 500,
		upkeep: 25,
		coverage: {
			kind: "park",
			radius: 7,
			strength: .5
		},
		landValue: {
			amount: .15,
			radius: 6
		},
		description: "Paved plaza with fountain. Great downtown."
	}),
	p$1({
		id: "park_garden",
		name: "Formal Garden",
		category: "park",
		service: "parks",
		cost: 1200,
		upkeep: 45,
		coverage: {
			kind: "park",
			radius: 8,
			strength: .6
		},
		landValue: {
			amount: .2,
			radius: 8
		},
		description: "Hedges and flower beds. Wealthy residents love it."
	}),
	p$1({
		id: "park_soccer",
		name: "Soccer Field",
		category: "park",
		service: "parks",
		cost: 1200,
		upkeep: 40,
		coverage: {
			kind: "park",
			radius: 10,
			strength: .6
		},
		landValue: {
			amount: .08,
			radius: 7
		},
		pollution: {
			noise: .1,
			radius: 3
		},
		description: "Field with stands and lights."
	}),
	p$1({
		id: "park_baseball",
		name: "Baseball Diamond",
		category: "park",
		service: "parks",
		cost: 1800,
		upkeep: 55,
		coverage: {
			kind: "park",
			radius: 12,
			strength: .65
		},
		landValue: {
			amount: .08,
			radius: 8
		},
		pollution: {
			noise: .1,
			radius: 3
		},
		description: "Diamond with bleachers and lights."
	}),
	p$1({
		id: "park_marina",
		name: "Marina",
		category: "park",
		service: "parks",
		cost: 2500,
		upkeep: 60,
		placement: "shore",
		coverage: {
			kind: "park",
			radius: 10,
			strength: .6
		},
		landValue: {
			amount: .25,
			radius: 10
		},
		description: "Docks and boats. Waterfront luxury (front faces water)."
	}),
	p$1({
		id: "park_large",
		name: "Large Park",
		category: "park",
		service: "parks",
		cost: 3e3,
		upkeep: 90,
		coverage: {
			kind: "park",
			radius: 14,
			strength: .9
		},
		landValue: {
			amount: .25,
			radius: 12
		},
		description: "Pond, paths and meadows. A big boost to residential demand cap."
	}),
	p$1({
		id: "park_zoo",
		name: "Zoo",
		category: "park",
		service: "parks",
		cost: 2e4,
		upkeep: 900,
		income: 300,
		jobs: 80,
		powerUse: .5,
		waterUse: 100,
		coverage: {
			kind: "park",
			radius: 30,
			strength: .9
		},
		landValue: {
			amount: .15,
			radius: 16
		},
		requires: "zoo",
		description: "Lions and tigers and bears. Huge residential cap boost, attracts visitors."
	}),
	p$1({
		id: "park_golf",
		name: "Country Club",
		category: "park",
		service: "parks",
		cost: 15e3,
		upkeep: 400,
		jobs: 40,
		waterUse: 400,
		coverage: {
			kind: "park",
			radius: 16,
			strength: .8
		},
		landValue: {
			amount: .35,
			radius: 16
		},
		requires: "country_club",
		unique: true,
		description: "Reward: golf for the elite. Magnet for R$$$ residents."
	}),
	p$1({
		id: "park_stadium",
		name: "Major League Stadium",
		category: "park",
		service: "parks",
		cost: 6e4,
		upkeep: 1800,
		income: 1500,
		jobs: 300,
		powerUse: 3,
		waterUse: 150,
		coverage: {
			kind: "park",
			radius: 24,
			strength: .6
		},
		landValue: {
			amount: .1,
			radius: 12
		},
		pollution: {
			noise: .5,
			radius: 10
		},
		requires: "stadium",
		unique: true,
		description: "Reward: big-league sports. Raises residential and commercial caps."
	}),
	p$1({
		id: "park_amusement",
		name: "Amusement Park",
		category: "park",
		service: "parks",
		cost: 45e3,
		upkeep: 1500,
		income: 1200,
		jobs: 250,
		powerUse: 3,
		waterUse: 150,
		coverage: {
			kind: "park",
			radius: 24,
			strength: .7
		},
		landValue: {
			amount: .1,
			radius: 12
		},
		pollution: {
			noise: .3,
			radius: 8
		},
		requires: "amusement_park",
		unique: true,
		description: "Roller coasters and a ferris wheel. Tourists flock to it."
	}),
	p$1({
		id: "lm_lighthouse",
		name: "Lighthouse",
		category: "landmark",
		cost: 3e3,
		upkeep: 20,
		placement: "shore",
		landValue: {
			amount: .15,
			radius: 8
		},
		requires: "lm_lighthouse",
		unique: true,
		description: "Landmark (3,000 pop). Must stand on the shore."
	}),
	p$1({
		id: "lm_clock_tower",
		name: "Clock Tower",
		category: "landmark",
		cost: 6e3,
		upkeep: 40,
		landValue: {
			amount: .2,
			radius: 10
		},
		requires: "lm_clock_tower",
		unique: true,
		description: "Landmark (5,000 pop)."
	}),
	p$1({
		id: "lm_obelisk",
		name: "Obelisk",
		category: "landmark",
		cost: 1e4,
		upkeep: 50,
		landValue: {
			amount: .2,
			radius: 12
		},
		requires: "lm_obelisk",
		unique: true,
		description: "Landmark (10,000 pop)."
	}),
	p$1({
		id: "lm_arch",
		name: "Triumphal Arch",
		category: "landmark",
		cost: 15e3,
		upkeep: 60,
		landValue: {
			amount: .25,
			radius: 12
		},
		requires: "lm_arch",
		unique: true,
		description: "Landmark (15,000 pop)."
	}),
	p$1({
		id: "lm_observatory",
		name: "Observatory",
		category: "landmark",
		cost: 2e4,
		upkeep: 150,
		jobs: 20,
		powerUse: .3,
		coverage: {
			kind: "education",
			radius: 30,
			strength: .2,
			capacity: 4e4
		},
		landValue: {
			amount: .2,
			radius: 12
		},
		requires: "lm_observatory",
		unique: true,
		description: "Landmark (25,000 pop). Mild education boost."
	}),
	p$1({
		id: "lm_cathedral",
		name: "Cathedral",
		category: "landmark",
		cost: 3e4,
		upkeep: 200,
		jobs: 10,
		landValue: {
			amount: .3,
			radius: 14
		},
		requires: "lm_cathedral",
		unique: true,
		description: "Landmark (35,000 pop)."
	}),
	p$1({
		id: "lm_castle",
		name: "Castle",
		category: "landmark",
		cost: 4e4,
		upkeep: 250,
		jobs: 20,
		landValue: {
			amount: .3,
			radius: 16
		},
		requires: "lm_castle",
		unique: true,
		description: "Landmark (50,000 pop). Tourists love it."
	}),
	p$1({
		id: "lm_pyramid",
		name: "Glass Pyramid",
		category: "landmark",
		cost: 5e4,
		upkeep: 300,
		jobs: 20,
		landValue: {
			amount: .3,
			radius: 14
		},
		requires: "lm_pyramid",
		unique: true,
		description: "Landmark (70,000 pop)."
	}),
	p$1({
		id: "lm_ferris_wheel",
		name: "Giant Observation Wheel",
		category: "landmark",
		cost: 45e3,
		upkeep: 350,
		income: 400,
		jobs: 40,
		powerUse: 1,
		landValue: {
			amount: .25,
			radius: 14
		},
		requires: "lm_ferris_wheel",
		unique: true,
		description: "Landmark (90,000 pop). Earns ticket income."
	}),
	p$1({
		id: "lm_opera_house",
		name: "Opera House",
		category: "landmark",
		cost: 8e4,
		upkeep: 600,
		jobs: 80,
		powerUse: 1,
		landValue: {
			amount: .4,
			radius: 18
		},
		requires: "lm_opera_house",
		unique: true,
		description: "Landmark (150,000 pop). Spectacular at the waterfront."
	}),
	p$1({
		id: "lm_spire_tower",
		name: "Observation Spire",
		category: "landmark",
		cost: 12e4,
		upkeep: 800,
		income: 800,
		jobs: 60,
		powerUse: 2,
		landValue: {
			amount: .35,
			radius: 20
		},
		requires: "lm_spire_tower",
		unique: true,
		description: "Landmark (250,000 pop). Dominates the skyline."
	}),
	p$1({
		id: "lm_twin_spires",
		name: "Twin Spires",
		category: "landmark",
		cost: 2e5,
		upkeep: 1200,
		jobs: 2e3,
		powerUse: 6,
		waterUse: 100,
		landValue: {
			amount: .45,
			radius: 22
		},
		requires: "lm_twin_spires",
		unique: true,
		description: "Landmark (500,000 pop). The ultimate skyline statement."
	}),
	p$1({
		id: "rw_military_base",
		name: "Military Base",
		category: "reward",
		cost: 0,
		upkeep: 0,
		income: 2500,
		jobs: 400,
		powerUse: 3,
		waterUse: 150,
		landValue: {
			amount: -.2,
			radius: 14
		},
		pollution: {
			noise: .5,
			air: .1,
			radius: 12
		},
		requires: "military_base",
		unique: true,
		description: "Business deal: the army pays $2,500/month. Noisy, lowers land value, residents nearby hate it."
	}),
	p$1({
		id: "rw_missile_range",
		name: "Missile Test Range",
		category: "reward",
		cost: 0,
		upkeep: 0,
		income: 4e3,
		jobs: 150,
		powerUse: 2,
		waterUse: 40,
		landValue: {
			amount: -.35,
			radius: 18
		},
		pollution: {
			noise: .7,
			air: .15,
			radius: 16
		},
		requires: "missile_range",
		unique: true,
		description: "Business deal: $4,000/month. Very noisy and bad for land value."
	}),
	p$1({
		id: "rw_toxic_dump",
		name: "Toxic Waste Dump",
		category: "reward",
		cost: 0,
		upkeep: 0,
		income: 6e3,
		jobs: 60,
		powerUse: .5,
		landValue: {
			amount: -.5,
			radius: 20
		},
		pollution: {
			air: .5,
			water: .8,
			radius: 14
		},
		requires: "toxic_dump",
		unique: true,
		description: "Business deal: $6,000/month to store other cities' toxic waste. Terrible pollution."
	}),
	p$1({
		id: "rw_casino",
		name: "Casino Resort",
		category: "reward",
		cost: 25e3,
		upkeep: 400,
		income: 3e3,
		jobs: 500,
		powerUse: 3,
		waterUse: 100,
		landValue: {
			amount: -.05,
			radius: 8
		},
		pollution: {
			noise: .3,
			radius: 6
		},
		requires: "casino",
		unique: true,
		description: "Reward (needs Legalized Gambling): $3,000/month but attracts crime."
	}),
	p$1({
		id: "rw_research_center",
		name: "Advanced Research Center",
		category: "reward",
		service: "education",
		cost: 4e4,
		upkeep: 1500,
		jobs: 600,
		powerUse: 5,
		waterUse: 60,
		coverage: {
			kind: "education",
			radius: 50,
			strength: .35,
			capacity: 1e5
		},
		landValue: {
			amount: .2,
			radius: 14
		},
		requires: "research_center",
		unique: true,
		description: "Reward (EQ milestone): boosts EQ and attracts high-tech industry."
	}),
	p$1({
		id: "tr_bus_stop",
		name: "Bus Stop",
		category: "transport",
		service: "transit",
		cost: 150,
		upkeep: 8,
		coverage: {
			kind: "transit",
			radius: 6,
			strength: .5
		},
		description: "Place next to a road. Gets residents out of their cars."
	}),
	p$1({
		id: "civ_bus_depot",
		name: "Bus Depot",
		category: "transport",
		service: "transit",
		cost: 4e3,
		upkeep: 350,
		jobs: 50,
		powerUse: .3,
		waterUse: 10,
		coverage: {
			kind: "transit",
			radius: 30,
			strength: .25
		},
		pollution: {
			noise: .2,
			air: .05,
			radius: 4
		},
		description: "Runs more buses: boosts bus stop service in a wide area."
	}),
	p$1({
		id: "tr_subway_station",
		name: "Subway Station",
		category: "transport",
		service: "transit",
		cost: 1500,
		upkeep: 60,
		powerUse: .1,
		coverage: {
			kind: "transit",
			radius: 9,
			strength: .8
		},
		description: "Connect to subway tunnels. Fast, congestion-free commuting."
	}),
	p$1({
		id: "tr_train_station",
		name: "Passenger Train Station",
		category: "transport",
		service: "transit",
		cost: 3e3,
		upkeep: 150,
		jobs: 20,
		powerUse: .2,
		coverage: {
			kind: "transit",
			radius: 14,
			strength: .7
		},
		pollution: {
			noise: .2,
			radius: 4
		},
		description: "Place next to rail tracks (platforms at the back)."
	}),
	p$1({
		id: "tr_freight_station",
		name: "Freight Rail Station",
		category: "transport",
		service: "transit",
		cost: 5e3,
		upkeep: 200,
		jobs: 60,
		powerUse: .3,
		pollution: {
			noise: .3,
			air: .05,
			radius: 6
		},
		landValue: {
			amount: -.05,
			radius: 5
		},
		description: "Ships goods by rail: raises the industrial demand cap and freight access."
	}),
	p$1({
		id: "tr_parking_garage",
		name: "Parking Garage",
		category: "transport",
		service: "roads",
		cost: 2500,
		upkeep: 60,
		jobs: 4,
		powerUse: .1,
		coverage: {
			kind: "transit",
			radius: 4,
			strength: .2
		},
		requires: "parking_garage",
		description: "Park-and-ride: helps commuters switch to transit."
	}),
	p$1({
		id: "tr_ferry_terminal",
		name: "Ferry Terminal",
		category: "transport",
		service: "transit",
		cost: 5e3,
		upkeep: 150,
		jobs: 15,
		placement: "shore",
		powerUse: .2,
		coverage: {
			kind: "transit",
			radius: 12,
			strength: .5
		},
		description: "Waterfront transit (front faces water)."
	}),
	p$1({
		id: "tr_airport_small",
		name: "Municipal Airport",
		category: "transport",
		service: "transit",
		cost: 3e4,
		upkeep: 800,
		income: 600,
		jobs: 250,
		powerUse: 2,
		waterUse: 50,
		pollution: {
			noise: .8,
			air: .1,
			radius: 16
		},
		landValue: {
			amount: -.1,
			radius: 12
		},
		requires: "airport_small",
		description: "Business travel: big boost to the commercial demand cap. Very noisy."
	}),
	p$1({
		id: "tr_airport_large",
		name: "International Airport",
		category: "transport",
		service: "transit",
		cost: 15e4,
		upkeep: 3500,
		income: 3e3,
		jobs: 1500,
		powerUse: 8,
		waterUse: 300,
		pollution: {
			noise: 1,
			air: .2,
			radius: 24
		},
		landValue: {
			amount: -.15,
			radius: 16
		},
		requires: "airport_large",
		description: "Reward: a global hub. Huge commercial and industrial demand cap boost."
	}),
	p$1({
		id: "tr_seaport",
		name: "Container Seaport",
		category: "transport",
		service: "transit",
		cost: 6e4,
		upkeep: 1800,
		income: 1500,
		jobs: 600,
		placement: "shore",
		powerUse: 4,
		waterUse: 60,
		pollution: {
			noise: .5,
			air: .2,
			water: .3,
			radius: 12
		},
		landValue: {
			amount: -.1,
			radius: 10
		},
		requires: "seaport",
		description: "Reward: ships goods worldwide. Massive industrial demand cap boost (front faces water)."
	})
];
const CATALOG = [...GROWABLES, ...PLOPPABLES];
const CATEGORY_INFO = {
	growable: {
		id: "growable",
		name: "Growables",
		icon: "building",
		description: "Buildings that grow on zones (not ploppable).",
		order: 99
	},
	power: {
		id: "power",
		name: "Power",
		icon: "bolt",
		description: "Power plants. Connect to zones with power lines.",
		order: 1
	},
	water: {
		id: "water",
		name: "Water",
		icon: "droplet",
		description: "Water pumps, towers and treatment.",
		order: 2
	},
	garbage: {
		id: "garbage",
		name: "Garbage",
		icon: "trash",
		description: "Recycling and incineration (landfill is a zone).",
		order: 3
	},
	police: {
		id: "police",
		name: "Police",
		icon: "shield",
		description: "Fight crime.",
		order: 4
	},
	fire: {
		id: "fire",
		name: "Fire",
		icon: "flame",
		description: "Fight and prevent fires.",
		order: 5
	},
	health: {
		id: "health",
		name: "Health",
		icon: "cross",
		description: "Clinics and hospitals raise health (HQ).",
		order: 6
	},
	education: {
		id: "education",
		name: "Education",
		icon: "book",
		description: "Schools raise the education quotient (EQ).",
		order: 7
	},
	park: {
		id: "park",
		name: "Parks & Recreation",
		icon: "tree",
		description: "Raise land value and the residential demand cap.",
		order: 8
	},
	civic: {
		id: "civic",
		name: "Civic",
		icon: "landmark",
		description: "Government buildings and civic rewards.",
		order: 9
	},
	transport: {
		id: "transport",
		name: "Transport",
		icon: "bus",
		description: "Transit stations, airports and seaports.",
		order: 10
	},
	landmark: {
		id: "landmark",
		name: "Landmarks",
		icon: "star",
		description: "Unlocked by population. Boost land value and tourism.",
		order: 11
	},
	reward: {
		id: "reward",
		name: "Rewards & Deals",
		icon: "gift",
		description: "Special rewards and business deals.",
		order: 12
	}
};
Object.keys(CATEGORY_INFO).filter((c) => c !== "growable").sort((a, b) => CATEGORY_INFO[a].order - CATEGORY_INFO[b].order);
const byId = /* @__PURE__ */ new Map();
let growByDev = [];
let growByZone = [];
function rebuildCatalogIndex() {
	byId.clear();
	for (const d of CATALOG) byId.set(d.id, d);
	growByDev = Array.from({ length: 12 }, () => []);
	growByZone = Array.from({ length: 11 }, () => []);
	for (const d of CATALOG) {
		if (d.category !== "growable" || d.devType === void 0) continue;
		growByDev[d.devType].push(d);
		for (const z of d.zones ?? []) growByZone[z].push(d);
	}
	for (const list of growByDev) list.sort((a, b) => (a.stage ?? 0) - (b.stage ?? 0) || (a.capacity ?? 0) - (b.capacity ?? 0));
	for (const list of growByZone) list.sort((a, b) => (a.stage ?? 0) - (b.stage ?? 0) || (a.capacity ?? 0) - (b.capacity ?? 0));
}
rebuildCatalogIndex();
function getDef(id) {
	return byId.get(id);
}
//#endregion
//#region src/core/events.ts
var Emitter = class {
	map = /* @__PURE__ */ new Map();
	on(type, fn) {
		let set = this.map.get(type);
		if (!set) this.map.set(type, set = /* @__PURE__ */ new Set());
		set.add(fn);
		return () => set.delete(fn);
	}
	off(type, fn) {
		this.map.get(type)?.delete(fn);
	}
	emit(type, payload) {
		const set = this.map.get(type);
		if (!set) return;
		for (const fn of set) fn(payload);
	}
	clear() {
		this.map.clear();
	}
};
//#endregion
//#region src/core/rng.ts
/** Deterministic seeded RNG (mulberry32) + helpers, and 2D simplex / fbm noise. No DOM deps. */
var RNG = class RNG {
	s;
	constructor(seed = 1) {
		this.s = typeof seed === "string" ? hashString(seed) : seed >>> 0 || 1;
	}
	/** float in [0,1) */
	next() {
		let t = this.s = this.s + 1831565813 >>> 0;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	}
	/** float in [a,b) */
	range(a, b) {
		return a + (b - a) * this.next();
	}
	/** integer in [a,b] inclusive */
	int(a, b) {
		return a + Math.floor(this.next() * (b - a + 1));
	}
	chance(p) {
		return this.next() < p;
	}
	pick(arr) {
		return arr[Math.floor(this.next() * arr.length)];
	}
	/** weighted pick; weights must be >= 0 */
	weighted(items, weights) {
		let total = 0;
		for (const w of weights) total += w;
		let r = this.next() * total;
		for (let i = 0; i < items.length; i++) {
			r -= weights[i];
			if (r <= 0) return items[i];
		}
		return items[items.length - 1];
	}
	shuffle(arr) {
		for (let i = arr.length - 1; i > 0; i--) {
			const j = Math.floor(this.next() * (i + 1));
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr;
	}
	fork(salt) {
		const s = typeof salt === "string" ? hashString(salt) : salt;
		return new RNG(Math.imul(this.s ^ s, 2654435761) >>> 0 || 7);
	}
	get state() {
		return this.s;
	}
	set state(v) {
		this.s = v >>> 0;
	}
};
function hashString(str) {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0 || 1;
}
.5 * (Math.sqrt(3) - 1);
(3 - Math.sqrt(3)) / 6;
//#endregion
//#region src/sim/Simulation.ts
/**
* Simulation — owns CityState, runs systems on a calendar, emits events for renderers/UI.
* Headless-safe (no DOM / three.js).
*/
var Simulation = class {
	state;
	events = new Emitter();
	systems = [];
	rng;
	/** 0 paused, 1 normal, 2 fast, 3 ultra */
	_speed = 1;
	acc = 0;
	/** safety cap to avoid spiral of death */
	maxDaysPerFrame = 4;
	constructor(state, systems = []) {
		this.state = state;
		this.rng = new RNG((state.config.seed ^ 2654435769) >>> 0);
		for (const s of systems) this.systems.push(s);
		for (const s of this.systems) s.init?.(this);
	}
	get speed() {
		return this._speed;
	}
	set speed(v) {
		this._speed = Math.max(0, Math.min(3, v | 0));
		this.events.emit("speedChanged", this._speed);
	}
	/** call every frame with real elapsed seconds */
	update(dt) {
		for (const s of this.systems) s.frame?.(this, dt);
		if (this._speed === 0) return;
		const spd = SECONDS_PER_DAY[this._speed];
		this.acc += Math.min(dt, .25);
		let n = 0;
		while (this.acc >= spd && n < this.maxDaysPerFrame) {
			this.acc -= spd;
			this.advanceDay();
			n++;
		}
		if (n >= this.maxDaysPerFrame) this.acc = Math.min(this.acc, spd);
	}
	/** advance exactly one day (also used by headless tests) */
	advanceDay() {
		const st = this.state;
		st.day++;
		for (const s of this.systems) s.daily?.(this);
		if (st.day % 30 === 0) {
			for (const s of this.systems) s.monthly?.(this);
			this.events.emit("month", st.monthIndex);
			if (st.day % 360 === 0) {
				for (const s of this.systems) s.yearly?.(this);
				this.events.emit("year", st.year);
			}
		}
		this.events.emit("day", st.day);
	}
	/** run N days synchronously (headless) */
	runDays(n) {
		for (let i = 0; i < n; i++) this.advanceDay();
	}
	notify(text, kind = "info", x, z, advisor) {
		const item = this.state.notify(text, kind, x, z, advisor);
		this.events.emit("news", item);
	}
	getSystem(name) {
		return this.systems.find((s) => s.name === name);
	}
	/** replace state (after load) and re-init systems */
	replaceState(state) {
		this.state = state;
		this.acc = 0;
		for (const s of this.systems) s.init?.(this);
		this.events.emit("reset", void 0);
	}
};
//#endregion
//#region src/sim/infra/common.ts
/**
* Shared helpers for the infrastructure systems: building-def classification (cached), ordinance lookup,
* service funding factor, building occupancy helpers and a safe building-removal helper.
* Headless: no DOM / three.js.
*/
const DX = [
	1,
	0,
	-1,
	0
];
const DZ = [
	0,
	1,
	0,
	-1
];
const COV_KINDS = [
	"police",
	"fire",
	"health",
	"education",
	"park",
	"transit",
	"garbage"
];
const infoCache = /* @__PURE__ */ new Map();
const TRANSIT_BY_MODEL = {
	tr_bus_stop: 1,
	tr_subway_station: 2,
	tr_train_station: 3,
	tr_freight_station: 4,
	tr_seaport: 5,
	tr_airport_small: 6,
	tr_airport_large: 6,
	tr_ferry_terminal: 7
};
function transitRole(def) {
	const byModel = TRANSIT_BY_MODEL[def.model] ?? TRANSIT_BY_MODEL[def.id];
	if (byModel !== void 0) return byModel;
	const s = (def.id + " " + def.model).toLowerCase();
	if (def.category !== "transport") return 0;
	if (s.includes("bus_stop") || s.includes("busstop")) return 1;
	if (s.includes("subway") || s.includes("metro")) return 2;
	if (s.includes("freight")) return 4;
	if (s.includes("train") || s.includes("rail")) return 3;
	if (s.includes("seaport") || s.includes("harbor") || s.includes("port")) return 5;
	if (s.includes("airport") || s.includes("airfield")) return 6;
	if (s.includes("ferry")) return 7;
	return 0;
}
function famOfDev(dev) {
	if (dev < 0) return 0;
	if (dev <= 2) return 1;
	if (dev <= 7) return 2;
	return 3;
}
function buildInfo(def) {
	const dev = def.devType ?? -1;
	let fam = famOfDev(dev);
	if (fam === 0) fam = def.category === "growable" ? 0 : 4;
	const s = (def.id + " " + def.model).toLowerCase();
	const covIdx = def.coverage ? COV_KINDS.indexOf(def.coverage.kind) : -1;
	return {
		id: def.id,
		model: def.model,
		known: true,
		fam,
		dev,
		category: def.category,
		service: def.service,
		civicJobs: def.jobs ?? 0,
		powerOut: def.powerOut ?? 0,
		powerUse: def.powerUse ?? -1,
		waterOut: def.waterOut ?? 0,
		waterUse: def.waterUse ?? -1,
		garbageCap: def.garbageCapacity ?? 0,
		air: def.pollution?.air ?? 0,
		waterPoll: def.pollution?.water ?? 0,
		noise: def.pollution?.noise ?? 0,
		garbage: def.pollution?.garbage ?? 0,
		pollRadius: def.pollution?.radius ?? 0,
		cov: covIdx,
		covRadius: def.coverage?.radius ?? 0,
		covStrength: def.coverage?.strength ?? 0,
		covCapacity: def.coverage?.capacity ?? 0,
		transit: transitRole(def),
		isPump: (def.waterOut ?? 0) > 0 && (s.includes("pump") || s.includes("well")),
		isTreatment: s.includes("treatment") || s.includes("sewage"),
		isIncinerator: s.includes("incinerator") || s.includes("waste_to_energy"),
		isRecycling: s.includes("recycl"),
		isJail: s.includes("jail") || s.includes("prison"),
		isPark: def.category === "park",
		capacity: def.capacity ?? 0
	};
}
const ZONE_DEV_GUESS = {
	[1]: [
		0,
		1,
		2
	],
	[2]: [
		0,
		1,
		2
	],
	[3]: [
		0,
		1,
		2
	],
	[4]: [
		3,
		4,
		5
	],
	[5]: [
		3,
		6,
		5
	],
	[6]: [
		4,
		6,
		7
	],
	[7]: [
		8,
		8,
		8
	],
	[8]: [
		9,
		10,
		10
	],
	[9]: [
		10,
		11,
		11
	]
};
const unknownInfo = {
	id: "",
	model: "",
	known: false,
	fam: 4,
	dev: -1,
	category: "civic",
	civicJobs: 0,
	powerOut: 0,
	powerUse: -1,
	waterOut: 0,
	waterUse: -1,
	garbageCap: 0,
	air: 0,
	waterPoll: 0,
	noise: 0,
	garbage: 0,
	pollRadius: 0,
	cov: -1,
	covRadius: 0,
	covStrength: 0,
	covCapacity: 0,
	transit: 0,
	isPump: false,
	isTreatment: false,
	isIncinerator: false,
	isRecycling: false,
	isJail: false,
	isPark: false,
	capacity: 0
};
const guessCache = /* @__PURE__ */ new Map();
/** classification of a building (cached per def id). Falls back to the zone under the building for unknown defs. */
function infoOf(state, b) {
	const cached = infoCache.get(b.def);
	if (cached) return cached;
	const def = getDef(b.def);
	if (def) {
		const inf = buildInfo(def);
		infoCache.set(b.def, inf);
		return inf;
	}
	const z = state.zone[b.z * state.size + b.x];
	const fam = zoneFamily(z);
	if (fam === "R" || fam === "C" || fam === "I") {
		const w = Math.max(1, Math.min(3, b.wealth || 1));
		const dev = ZONE_DEV_GUESS[z][w - 1];
		const key = dev;
		let g = guessCache.get(key);
		if (!g) {
			g = {
				...unknownInfo,
				fam: famOfDev(dev),
				dev,
				category: "growable"
			};
			guessCache.set(key, g);
		}
		return g;
	}
	return unknownInfo;
}
/** clear classification cache (call after the catalog changes) */
function clearInfoCache() {
	infoCache.clear();
	guessCache.clear();
}
function wealthOf(inf, b) {
	if (inf.dev >= 0) switch (inf.dev) {
		case 0:
		case 3: return 1;
		case 1:
		case 4:
		case 6: return 2;
		case 2:
		case 5:
		case 7: return 3;
	}
	return Math.max(1, Math.min(3, b.wealth || 2));
}
/** building exists as a functioning structure (complete, not rubble). Abandoned buildings are inactive. */
function isFunctional(b) {
	return b.built >= 1 && (b.flags & (BF.Burnt | BF.Abandoned)) === 0;
}
/**
* Job slots of a job site used for commuting: growable C/I -> capacity, plopped -> def.jobs (or capacity).
* Sim-core owns b.jobs; traffic reports reachability via TrafficSystem.jobFill().
*/
function jobSlots(inf, b) {
	if (!isFunctional(b)) return 0;
	if (inf.fam === 2 || inf.fam === 3) return b.capacity > 0 ? b.capacity : b.jobs;
	if (inf.fam === 4) return inf.civicJobs > 0 ? inf.civicJobs : 0;
	return 0;
}
/** currently active jobs (for pollution / garbage / utilities): b.jobs, or a fallback when sim-core doesn't fill jobs */
function activeJobs(inf, b, jobsUnknown) {
	if (inf.fam === 1) return 0;
	if (!isFunctional(b)) return 0;
	if (b.jobs > 0) return b.jobs;
	if (jobsUnknown) {
		if (inf.fam === 2 || inf.fam === 3) return b.capacity * .6;
		return inf.civicJobs;
	}
	return inf.fam === 4 ? inf.civicJobs * .5 : 0;
}
/** true when no job site has b.jobs > 0 although job capacity exists (sim-core not filling jobs yet) */
function detectJobsUnknown(state) {
	let cap = 0;
	for (const b of state.buildings.values()) {
		if (b.jobs > 0) return false;
		if (b.capacity > 0 && b.pop === 0) cap += b.capacity;
	}
	return cap > 0;
}
/** normalized aliases (lowercase alphanumerics) recognised in state.budget.ordinances */
const ORDINANCE_ALIASES = {
	powerConservation: [
		"powerconservation",
		"powersaving",
		"energyconservation",
		"conservepower"
	],
	waterConservation: [
		"waterconservation",
		"watersaving",
		"conservewater"
	],
	cleanAir: [
		"cleanairact",
		"cleanair",
		"pollutioncontrol",
		"airpollutioncontrol",
		"emissionscontrol"
	],
	carpool: [
		"carpool",
		"carpoolincentive",
		"carpooling",
		"carpoolincentives"
	],
	commuterShuttle: [
		"commutershuttle",
		"commutershuttleservice",
		"shuttleservice"
	],
	recycling: [
		"recycling",
		"recyclingprogram",
		"paperreduction",
		"paperreductionprogram",
		"trashpresort",
		"wastereduction"
	],
	smokeDetector: [
		"smokedetector",
		"smokedetectors",
		"smokedetectorprogram"
	],
	neighborhoodWatch: [
		"neighborhoodwatch",
		"neighbourhoodwatch",
		"neighborhoodwatchprogram"
	],
	youthCurfew: ["youthcurfew", "curfew"],
	legalizedGambling: [
		"legalizegambling",
		"legalizedgambling",
		"gambling",
		"legalgambling"
	],
	freeClinics: [
		"freeclinics",
		"freeclinic",
		"publichealth"
	],
	proReading: [
		"proreading",
		"proreadingcampaign",
		"readingcampaign",
		"literacy"
	],
	smokingBan: [
		"smokingban",
		"nosmoking",
		"nosmokingban"
	],
	tireRecycling: ["tirerecycling"]
};
const aliasToKey = /* @__PURE__ */ new Map();
for (const k of Object.keys(ORDINANCE_ALIASES)) for (const a of ORDINANCE_ALIASES[k]) aliasToKey.set(a, k);
/** read enabled ordinances (by normalized id) once per update */
function readOrdinances(state) {
	const out = /* @__PURE__ */ new Set();
	const list = state.budget?.ordinances;
	if (!list) return out;
	for (const id of list) {
		const n = String(id).toLowerCase().replace(/[^a-z0-9]/g, "");
		const k = aliasToKey.get(n) ?? aliasToKey.get(n.replace(/ordinance$/, "")) ?? aliasToKey.get(n.replace(/^ord/, ""));
		if (k) out.add(k);
	}
	return out;
}
/** funding percent -> effectiveness: linear below 100 %, diminishing returns above (150 % -> ~1.25) */
function fundingFactor(state, service) {
	if (!service) return 1;
	const pct = state.budget?.funding?.[service];
	if (pct === void 0 || pct === null || !isFinite(pct)) return 1;
	const f = Math.max(0, pct) / 100;
	if (f <= 1) return f;
	return 1 + (1 - Math.exp(-(f - 1) * 2.5)) * .35;
}
/** building ids can be large; returns an Int32Array big enough to index by id */
function ensureIdArray(arr, state) {
	if (arr.length >= state.nextBuildingId + 1) return arr;
	const n = new Int32Array(Math.max(state.nextBuildingId + 1, arr.length * 2, 1024));
	n.set(arr);
	return n;
}
function ensureIdFloat(arr, state, fill = 0) {
	if (arr.length >= state.nextBuildingId + 1) return arr;
	const n = new Float32Array(Math.max(state.nextBuildingId + 1, arr.length * 2, 1024));
	if (fill !== 0) n.fill(fill);
	n.set(arr);
	return n;
}
/** set/clear a flag without emitting (caller batches emission) */
function setFlagQuiet(b, flag, on) {
	if ((b.flags & flag) !== 0 === on) return false;
	b.flags = on ? b.flags | flag : b.flags & ~flag;
	return true;
}
/**
* Remove a building completely: clears its cells in state.building, deletes it from state.buildings and emits
* buildingRemoved. Used by disasters (meteor crater). Zones stay.
*/
function removeBuilding(sim, b) {
	const st = sim.state;
	const N = st.size;
	for (let z = b.z; z < b.z + b.d; z++) {
		if (z < 0 || z >= N) continue;
		for (let x = b.x; x < b.x + b.w; x++) {
			if (x < 0 || x >= N) continue;
			const i = z * N + x;
			if (st.building[i] === b.id) st.building[i] = -1;
		}
	}
	st.buildings.delete(b.id);
	sim.events.emit("buildingRemoved", b);
}
/** centre cell index of a building */
function centerCell(state, b) {
	const cx = Math.min(state.size - 1, b.x + (b.w >> 1));
	return Math.min(state.size - 1, b.z + (b.d >> 1)) * state.size + cx;
}
function nowMs() {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}
//#endregion
//#region src/sim/infra/params.ts
/** Capacity per cell (trips/day) indexed by Network. Rail capacity is for trains (passengers/day). */
const NET_CAPACITY = [
	0,
	350,
	1200,
	1600,
	2600,
	7e3,
	12e3
];
/** Free-flow time to traverse one cell (minutes) indexed by Network. */
const NET_TIME = [
	0,
	.16,
	.1,
	.085,
	.075,
	.04,
	.035
];
/** subway in-vehicle minutes per cell */
const SUBWAY_TIME = .03;
/** bus in-vehicle time multiplier on (congested) road time; buses stop and share roads */
const BUS_TIME_FACTOR = 1.25;
/** extra minutes when moving between highway and a non-highway road (automatic ramp) */
const RAMP_PENALTY = .35;
/** BPR congestion function t = t0 * (1 + BPR_ALPHA * (v/c)^BPR_BETA), factor capped at BPR_MAX_FACTOR */
const BPR_ALPHA = .15;
/** minimum MSA blending factor between successive assignments (1 = no smoothing) */
const MSA_MIN_ALPHA = .3;
const WALK_TIME_PER_CELL = .8;
const STOP_WALK_TIME_PER_CELL = .5;
const WAIT_SUBWAY = 3.5;
/** stop capacity (riders/day) before crowding adds waiting time */
const STOP_CAP_BUS = 2500;
const STOP_CAP_SUBWAY = 9e3;
const STOP_CAP_TRAIN = 14e3;
/** buses are vehicles on the road: PCU added to the road per rider */
const BUS_PCU_PER_RIDER = 1 / 12;
/** bias per wealth level (index wealth-1 : R$, R$$, R$$$) */
const CAR_BIAS = [
	-1.2,
	0,
	.9
];
const TRANSIT_BIAS = [
	.7,
	0,
	-.7
];
const WALK_BIAS = -.5;
/** smoothing of per-building outputs across assignments (weight of the new value) */
const RESULT_SMOOTH = .5;
/** share of residents that are commuting workers */
const WORKER_SHARE = .55;
/** shopping trips per resident per day (off-peak -> weighted) */
const SHOP_TRIPS_PER_RES = .25;
const SHOP_PCU_WEIGHT = .4;
/** freight trucks per industrial job per day, and truck PCU */
const FREIGHT_PER_JOB = {
	IA: .05,
	ID: .12,
	IM: .1,
	IHT: .03
};
const TRUCK_PCU = 2.5;
/** car occupancy (people per car) -> car PCU per commuter = 1 / occupancy */
const CAR_OCCUPANCY = 1.15;
const PRICE_DOWN = 2.5;
/** neighbor connection regional job / worker capacities (per connection cell), indexed by Network */
const CONNECTION_JOBS = [
	0,
	400,
	2e3,
	2e3,
	5e3,
	16e3,
	6e3
];
const CONNECTION_WORKERS = [
	0,
	300,
	1500,
	1500,
	4e3,
	12e3,
	5e3
];
/** fraction of vacant jobs the region is willing to fill */
const REGIONAL_FILL = .55;
/**
* Global caps on regional exchange (no region data yet): total regional job slots <= REGION_JOB_SHARE x city workers
* + REGION_JOB_MIN; inbound regional workers <= REGION_WORKER_SHARE x city job slots + REGION_WORKER_MIN.
* The region layer can override the totals via state.systemData.regionJobs / state.systemData.regionWorkers (numbers).
*/
const REGION_JOB_SHARE = .3;
const REGION_JOB_MIN = 1500;
const REGION_WORKER_SHARE = .3;
const REGION_WORKER_MIN = 1e3;
/** derived power use (MW) per unit of capacity at full occupancy (when def.powerUse is missing) */
const POWER_PER_RES = .05;
const POWER_PER_JOB_C = .08;
const POWER_PER_JOB_I = {
	IA: .04,
	ID: .22,
	IM: .16,
	IHT: .2
};
const POWER_PER_CIVIC_JOB = .1;
/** derived water use (kL/day) per unit of capacity at full occupancy */
const WATER_PER_RES = .2;
const WATER_PER_JOB_C = .12;
const WATER_PER_JOB_I = {
	IA: .5,
	ID: .35,
	IM: .25,
	IHT: .18
};
const WATER_PER_CIVIC_JOB = .1;
/** consumption at zero occupancy as share of full-occupancy use */
const UTIL_BASE_SHARE = .25;
/** air emission per active job by industry type */
const AIR_PER_JOB = {
	IA: .004,
	ID: .035,
	IM: .009,
	IHT: 8e-4
};
const WATER_POLL_PER_JOB = {
	IA: .006,
	ID: .02,
	IM: .008,
	IHT: 5e-4
};
const NOISE_PER_JOB = {
	IA: .002,
	ID: .012,
	IM: .008,
	IHT: .001
};
/** traffic: emission per trip/day through a cell (scaled by congestion) */
const AIR_PER_TRIP = 4e-5;
const NOISE_PER_TRIP = 3e-4;
/** sewage per resident (water pollution) */
const SEWAGE_PER_RES = .0012;
/** residents served by a treatment plant when def.capacity is missing */
const TREATMENT_DEFAULT_CAP = 8e4;
/** isolated point source of strength S yields a peak field of POLL_PEAK_GAIN * S (blur gain = gain * 2*pi*sigma^2) */
const POLL_PEAK_GAIN = .35;
/** blur radii (box radius, 3 passes) for small / medium / large emitters */
const POLL_RADII = [
	2,
	4,
	7
];
/** air pollution drifts with the wind by up to this many cells per update */
const WIND_DRIFT = 1.2;
/** landfill smell (air source per landfill cell) */
const LANDFILL_AIR = .25;
const POLL_SMOOTH = .35;
/** garbage (tons / month) */
const GARBAGE_PER_RES = .04;
const GARBAGE_PER_JOB_C = .03;
const GARBAGE_PER_JOB_I = {
	IA: .02,
	ID: .06,
	IM: .045,
	IHT: .02
};
const GARBAGE_PER_CIVIC_JOB = .02;
/** uncollected garbage level added per ton per cell per update and decay when collected */
const GARBAGE_BUILDUP = .02;
/** road distance is ~Manhattan: coverage radius along roads = def.radius * ROAD_RADIUS_FACTOR */
const ROAD_RADIUS_FACTOR = 1.3;
/** coverage demand ratio (people per resident needing the service) used against def.coverage.capacity */
const COVERAGE_DEMAND = {
	education: .22,
	health: .12,
	police: 1,
	fire: 1,
	park: 1,
	transit: 1,
	garbage: 1
};
/** EQ / HQ convergence per services update (fraction of gap) */
const EQ_RATE = .012;
const HQ_RATE = .02;
/** transit stop walking coverage radius (cells) */
const TRANSIT_COV_RADIUS = {
	bus: 5,
	subway: 7,
	train: 8
};
/** base daily ignition probability per building (scaled by risk) */
const FIRE_BASE_P = 1 / 25e4;
//#endregion
//#region src/sim/infra/utilities.ts
const IND_KEYS$2 = [
	"IA",
	"ID",
	"IM",
	"IHT"
];
function occupancy(inf, b, jobsUnknown) {
	if (b.capacity <= 0) return 1;
	if (inf.fam === 1) return Math.min(1, b.pop / b.capacity);
	if (inf.fam === 2 || inf.fam === 3) return Math.min(1, activeJobs(inf, b, jobsUnknown) / b.capacity);
	return 1;
}
/** full-occupancy utility use of a building (power MW or water kL/day) */
function fullUse(inf, b, power) {
	const explicit = power ? inf.powerUse : inf.waterUse;
	if (explicit >= 0) return explicit;
	const cap = b.capacity;
	switch (inf.fam) {
		case 1: return cap * (power ? POWER_PER_RES : WATER_PER_RES);
		case 2: return cap * (power ? POWER_PER_JOB_C : WATER_PER_JOB_C);
		case 3: {
			const k = IND_KEYS$2[Math.max(0, Math.min(3, inf.dev - 8))];
			return cap * (power ? POWER_PER_JOB_I[k] : WATER_PER_JOB_I[k]);
		}
		default: {
			const jobs = inf.civicJobs;
			const perJob = power ? POWER_PER_CIVIC_JOB : WATER_PER_CIVIC_JOB;
			const minUse = inf.isPark ? .2 : 1;
			return Math.max(minUse, jobs * perJob);
		}
	}
}
function buildingPowerUse(inf, b, jobsUnknown) {
	if (inf.powerOut > 0) return 0;
	if (b.built < 1 || (b.flags & (BF.Burnt | BF.Abandoned)) !== 0) return 0;
	const occ = occupancy(inf, b, jobsUnknown);
	return fullUse(inf, b, true) * (UTIL_BASE_SHARE + .75 * occ);
}
function buildingWaterUse(inf, b, jobsUnknown) {
	if (inf.waterOut > 0) return 0;
	if (b.built < 1 || (b.flags & (BF.Burnt | BF.Abandoned)) !== 0) return 0;
	const occ = occupancy(inf, b, jobsUnknown);
	return fullUse(inf, b, false) * (UTIL_BASE_SHARE + .75 * occ);
}
function plantEfficiency(state) {
	const f = fundingFactor(state, "utilities");
	return f >= 1 ? 1 : .4 + .6 * f;
}
var UtilitiesSystem = class {
	name = "utilities";
	dirty = true;
	lastRun = -1e9;
	unsub = [];
	stamp = 0;
	pComp = /* @__PURE__ */ new Int32Array(0);
	wComp = /* @__PURE__ */ new Int32Array(0);
	queue = /* @__PURE__ */ new Int32Array(0);
	visit = /* @__PURE__ */ new Int32Array(0);
	bStamp = /* @__PURE__ */ new Int32Array(1024);
	bUse = /* @__PURE__ */ new Float32Array(1024);
	bOk = /* @__PURE__ */ new Int32Array(1024);
	bWComp = /* @__PURE__ */ new Int32Array(1024);
	/** per building id: water use (>= 0) or -(output) - tiny for producers */
	bWUse = /* @__PURE__ */ new Float32Array(1024);
	bPow = /* @__PURE__ */ new Uint8Array(1024);
	bWat = /* @__PURE__ */ new Uint8Array(1024);
	cSupply = /* @__PURE__ */ new Float64Array(256);
	cDemand = /* @__PURE__ */ new Float64Array(256);
	cLeft = /* @__PURE__ */ new Float64Array(256);
	wSupply = /* @__PURE__ */ new Float64Array(256);
	wDemand = /* @__PURE__ */ new Float64Array(256);
	wLeft = /* @__PURE__ */ new Float64Array(256);
	nPComp = 0;
	okComp = /* @__PURE__ */ new Uint8Array(256);
	nWComp = 0;
	wasShort = false;
	lastShortNotify = -1e9;
	/** last compute duration (ms) */
	lastMs = 0;
	init(sim) {
		for (const u of this.unsub) u();
		this.unsub = [];
		const ev = sim.events;
		const mark = () => {
			this.dirty = true;
		};
		this.unsub.push(ev.on("networkChanged", mark), ev.on("buildingAdded", mark), ev.on("buildingRemoved", mark), ev.on("powerLinesChanged", mark), ev.on("zoneChanged", mark), ev.on("reset", mark));
		sim.state.systemData.infraVersion = 1;
		this.dirty = true;
		this.compute(sim);
	}
	daily(sim) {
		if (this.dirty || sim.state.day - this.lastRun >= 3) this.compute(sim);
	}
	/** mark for recompute on the next day */
	invalidate() {
		this.dirty = true;
	}
	/** power grid info at a cell (conductor or building) or null if not on a grid */
	gridInfo(sim, x, z) {
		const st = sim.state;
		if (!st.inBounds(x, z) || this.pComp.length !== st.cells) return null;
		const c = this.pComp[z * st.size + x];
		if (c < 0 || c >= this.nPComp) return null;
		return {
			supply: this.cSupply[c],
			demand: this.cDemand[c],
			shortage: this.cDemand[c] > this.cSupply[c]
		};
	}
	/** water network info at a road cell / building */
	waterInfo(sim, x, z) {
		const st = sim.state;
		if (!st.inBounds(x, z) || this.wComp.length !== st.cells) return null;
		let c = this.wComp[z * st.size + x];
		if (c < 0) {
			const b = st.buildingAt(x, z);
			if (b && b.id < this.bWComp.length) c = this.bWComp[b.id] - 1;
		}
		if (c < 0 || c >= this.nWComp) return null;
		return {
			supply: this.wSupply[c],
			demand: this.wDemand[c],
			shortage: this.wDemand[c] > this.wSupply[c]
		};
	}
	compute(sim) {
		const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
		const st = sim.state;
		const C = st.cells;
		if (this.pComp.length !== C) {
			this.pComp = new Int32Array(C);
			this.wComp = new Int32Array(C);
			this.queue = new Int32Array(C);
			this.visit = new Int32Array(C);
		}
		this.bStamp = ensureIdArray(this.bStamp, st);
		this.bOk = ensureIdArray(this.bOk, st);
		this.bUse = ensureIdFloat(this.bUse, st);
		this.bWComp = ensureIdArray(this.bWComp, st);
		this.bWUse = ensureIdFloat(this.bWUse, st);
		if (this.bPow.length < this.bOk.length) {
			this.bPow = new Uint8Array(this.bOk.length);
			this.bWat = new Uint8Array(this.bOk.length);
		}
		const ords = readOrdinances(st);
		const jobsUnknown = detectJobsUnknown(st);
		const changed = [];
		this.prepareUses(st, ords.has("powerConservation"), ords.has("waterConservation"), jobsUnknown);
		this.computePower(st);
		this.computeWater(st);
		const bPow = this.bPow, bWat = this.bWat;
		for (const b of st.buildings.values()) {
			const pw = bPow[b.id] === 1;
			const wt = bWat[b.id] === 1;
			const f1 = setFlagQuiet(b, BF.Powered, pw);
			const f2 = setFlagQuiet(b, BF.Watered, wt);
			if (f1 || f2) changed.push(b);
		}
		for (const b of changed) sim.events.emit("buildingChanged", b);
		const short = st.stats.powerDemand > st.stats.powerSupply * 1.0001 && st.stats.powerSupply > 0;
		if (short && !this.wasShort && st.day - this.lastShortNotify > 30) {
			this.lastShortNotify = st.day;
			sim.notify(`Power shortage: demand ${Math.round(st.stats.powerDemand)} MW exceeds supply ${Math.round(st.stats.powerSupply)} MW. Brownouts in outlying areas.`, "warning", void 0, void 0, "utilities");
		}
		this.wasShort = short;
		this.dirty = false;
		this.lastRun = st.day;
		sim.events.emit("layerUpdated", "utilities");
		this.lastMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
	}
	/** one pass over buildings: power use / plant output (bUse) and water use / producer output (bWUse) */
	prepareUses(st, powerCons, waterCons, jobsUnknown) {
		const N = st.size, C = st.cells;
		const eff = plantEfficiency(st);
		const pMul = powerCons ? .85 : 1;
		const wMul = waterCons ? .85 : 1;
		const bUse = this.bUse, bWUse = this.bWUse;
		let hasTreatment = false;
		for (const b of st.buildings.values()) if (infoOf(st, b).isTreatment && b.built >= 1 && (b.flags & BF.Burnt) === 0) {
			hasTreatment = true;
			break;
		}
		for (const b of st.buildings.values()) {
			const inf = infoOf(st, b);
			const ok = b.built >= 1 && (b.flags & (BF.Burnt | BF.Abandoned)) === 0;
			if (inf.powerOut > 0) bUse[b.id] = -(ok ? inf.powerOut * eff : 0);
			else bUse[b.id] = buildingPowerUse(inf, b, jobsUnknown) * pMul;
			if (inf.waterOut > 0) {
				let out = 0;
				if (ok) {
					out = inf.waterOut * eff;
					if (inf.isPump && nearWater(st, b, 2)) out *= 1.5;
					const wp = st.waterPollution[Math.min(C - 1, (b.z + (b.d >> 1)) * N + b.x + (b.w >> 1))] || 0;
					out *= 1 - .5 * Math.min(1, wp) * (hasTreatment ? .35 : 1);
				}
				bWUse[b.id] = -out - 1e-9;
			} else bWUse[b.id] = buildingWaterUse(inf, b, jobsUnknown) * wMul;
		}
	}
	computePower(st) {
		const N = st.size, C = st.cells;
		const net = st.network, lines = st.powerLines, bld = st.building, zone = st.zone;
		const comp = this.pComp, queue = this.queue;
		const powered = st.powered;
		const stampNo = ++this.stamp;
		const bStamp = this.bStamp, bUse = this.bUse;
		comp.fill(-1);
		let nc = 0;
		let supplyTot = 0, demandTot = 0;
		const result = this.bPow;
		for (let s = 0; s < C; s++) {
			if (comp[s] >= 0) continue;
			if (net[s] === 0 && lines[s] === 0 && bld[s] < 0) continue;
			if (nc >= this.cSupply.length) this.growPower();
			let supply = 0, demand = 0;
			let qh = 0, qt = 0;
			queue[qt++] = s;
			comp[s] = nc;
			while (qh < qt) {
				const i = queue[qh++];
				const bid = bld[i];
				if (bid >= 0 && bStamp[bid] !== stampNo) {
					bStamp[bid] = stampNo;
					const u = bUse[bid];
					if (u < 0) supply -= u;
					else demand += u;
				}
				const x = i % N;
				let j = i - 1;
				if (x > 0 && comp[j] < 0 && (net[j] !== 0 || lines[j] !== 0 || bld[j] >= 0)) {
					comp[j] = nc;
					queue[qt++] = j;
				}
				j = i + 1;
				if (x < N - 1 && comp[j] < 0 && (net[j] !== 0 || lines[j] !== 0 || bld[j] >= 0)) {
					comp[j] = nc;
					queue[qt++] = j;
				}
				j = i - N;
				if (j >= 0 && comp[j] < 0 && (net[j] !== 0 || lines[j] !== 0 || bld[j] >= 0)) {
					comp[j] = nc;
					queue[qt++] = j;
				}
				j = i + N;
				if (j < C && comp[j] < 0 && (net[j] !== 0 || lines[j] !== 0 || bld[j] >= 0)) {
					comp[j] = nc;
					queue[qt++] = j;
				}
			}
			this.cSupply[nc] = supply;
			this.cDemand[nc] = demand;
			this.cLeft[nc] = supply;
			supplyTot += supply;
			demandTot += demand;
			nc++;
		}
		this.nPComp = nc;
		const okComp = this.okComp.length >= nc ? this.okComp : this.okComp = new Uint8Array(nc * 2 + 16);
		for (let c = 0; c < nc; c++) okComp[c] = this.cSupply[c] > 0 && this.cDemand[c] <= this.cSupply[c] ? 1 : 0;
		for (let i = 0; i < C; i++) {
			const c = comp[i];
			powered[i] = c >= 0 ? okComp[c] : 0;
		}
		let anyShort = false;
		for (let c = 0; c < nc; c++) if (this.cSupply[c] > 0 && this.cDemand[c] > this.cSupply[c]) {
			anyShort = true;
			break;
		}
		const served = this.bOk;
		const stamp2 = stampNo;
		if (anyShort) {
			const visit = this.visit;
			const vstamp = stampNo;
			let qh = 0, qt = 0;
			for (const b of st.buildings.values()) {
				if (bStamp[b.id] !== stampNo || bUse[b.id] >= 0) continue;
				const c = comp[b.z * N + b.x];
				if (c < 0 || !(this.cDemand[c] > this.cSupply[c])) continue;
				for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
					const i = z * N + x;
					if (visit[i] === vstamp) continue;
					visit[i] = vstamp;
					queue[qt++] = i;
				}
			}
			const exhausted = new Uint8Array(nc);
			while (qh < qt) {
				const i = queue[qh++];
				const c = comp[i];
				const bid = bld[i];
				if (bid >= 0 && served[bid] !== stamp2 && served[bid] !== -stamp2) {
					const u = bUse[bid];
					if (u < 0) served[bid] = stamp2;
					else if (!exhausted[c] && this.cLeft[c] >= u) {
						this.cLeft[c] -= u;
						served[bid] = stamp2;
					} else {
						exhausted[c] = 1;
						served[bid] = -stamp2;
					}
				}
				powered[i] = exhausted[c] ? 0 : 1;
				const x = i % N, z = (i - x) / N;
				for (let k = 0; k < 4; k++) {
					const nx = x + DX[k], nz = z + DZ[k];
					if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
					const j = nz * N + nx;
					if (visit[j] === vstamp || comp[j] !== c) continue;
					visit[j] = vstamp;
					queue[qt++] = j;
				}
			}
		}
		for (const b of st.buildings.values()) {
			const c = comp[b.z * N + b.x];
			let on = false;
			if (c >= 0 && this.cSupply[c] > 0) {
				if (this.cDemand[c] <= this.cSupply[c]) on = true;
				else on = served[b.id] === stamp2;
			}
			const v = on ? 1 : 0;
			result[b.id] = v;
			for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
				const i = z * N + x;
				if (bld[i] === b.id) powered[i] = v;
			}
		}
		for (let i = 0; i < C; i++) {
			if (zone[i] === 0 || comp[i] >= 0) continue;
			const x = i % N;
			powered[i] = x > 0 && powered[i - 1] === 1 && comp[i - 1] >= 0 || x < N - 1 && powered[i + 1] === 1 && comp[i + 1] >= 0 || i >= N && powered[i - N] === 1 && comp[i - N] >= 0 || i + N < C && powered[i + N] === 1 && comp[i + N] >= 0 ? 1 : 0;
		}
		st.stats.powerSupply = supplyTot;
		st.stats.powerDemand = demandTot;
	}
	growPower() {
		const n = this.cSupply.length * 2;
		const g = (a) => {
			const b = new Float64Array(n);
			b.set(a);
			return b;
		};
		this.cSupply = g(this.cSupply);
		this.cDemand = g(this.cDemand);
		this.cLeft = g(this.cLeft);
	}
	growWater() {
		const n = this.wSupply.length * 2;
		const g = (a) => {
			const b = new Float64Array(n);
			b.set(a);
			return b;
		};
		this.wSupply = g(this.wSupply);
		this.wDemand = g(this.wDemand);
		this.wLeft = g(this.wLeft);
	}
	computeWater(st) {
		const N = st.size, C = st.cells;
		const net = st.network, zone = st.zone, bld = st.building;
		const comp = this.wComp, queue = this.queue;
		const watered = st.watered;
		comp.fill(-1);
		let nc = 0;
		for (let s = 0; s < C; s++) {
			if (comp[s] >= 0 || net[s] < 1 || net[s] > 5) continue;
			if (nc >= this.wSupply.length) this.growWater();
			let qh = 0, qt = 0;
			queue[qt++] = s;
			comp[s] = nc;
			while (qh < qt) {
				const i = queue[qh++];
				const x = i % N;
				let j = i - 1;
				if (x > 0 && comp[j] < 0 && net[j] >= 1 && net[j] <= 5) {
					comp[j] = nc;
					queue[qt++] = j;
				}
				j = i + 1;
				if (x < N - 1 && comp[j] < 0 && net[j] >= 1 && net[j] <= 5) {
					comp[j] = nc;
					queue[qt++] = j;
				}
				j = i - N;
				if (j >= 0 && comp[j] < 0 && net[j] >= 1 && net[j] <= 5) {
					comp[j] = nc;
					queue[qt++] = j;
				}
				j = i + N;
				if (j < C && comp[j] < 0 && net[j] >= 1 && net[j] <= 5) {
					comp[j] = nc;
					queue[qt++] = j;
				}
			}
			this.wSupply[nc] = 0;
			this.wDemand[nc] = 0;
			nc++;
		}
		this.nWComp = nc;
		const bComp = this.bWComp;
		const bUse = this.bWUse;
		let supplyTot = 0, demandTot = 0;
		const seeds = [];
		for (const b of st.buildings.values()) {
			const c = adjacentComp(comp, N, b);
			bComp[b.id] = c + 1;
			if (c < 0) continue;
			const u = bUse[b.id];
			if (u < 0) {
				const out = -u - 1e-9;
				this.wSupply[c] += out;
				supplyTot += out;
				if (out > 0) seeds.push(b.id);
			} else {
				this.wDemand[c] += u;
				demandTot += u;
			}
		}
		for (let c = 0; c < nc; c++) this.wLeft[c] = this.wSupply[c];
		const okW = this.okComp.length >= nc ? this.okComp : this.okComp = new Uint8Array(nc * 2 + 16);
		for (let c = 0; c < nc; c++) okW[c] = this.wSupply[c] > 0 && this.wDemand[c] <= this.wSupply[c] ? 1 : 0;
		for (let i = 0; i < C; i++) {
			const c = comp[i];
			watered[i] = c >= 0 ? okW[c] : 0;
		}
		const result = this.bWat;
		let anyShort = false;
		for (let c = 0; c < nc; c++) if (this.wSupply[c] > 0 && this.wDemand[c] > this.wSupply[c]) {
			anyShort = true;
			break;
		}
		const servedStamp = ++this.stamp;
		const served = this.bOk;
		if (anyShort) {
			const visit = this.visit;
			const exhausted = new Uint8Array(nc);
			let qh = 0, qt = 0;
			for (const id of seeds) {
				const b = st.buildings.get(id);
				const c = bComp[id] - 1;
				if (!(this.wDemand[c] > this.wSupply[c])) continue;
				const tmp = perimeterRoadCells(st, comp, b);
				for (const i of tmp) if (visit[i] !== servedStamp) {
					visit[i] = servedStamp;
					queue[qt++] = i;
				}
			}
			while (qh < qt) {
				const i = queue[qh++];
				const c = comp[i];
				const x = i % N, z = (i - x) / N;
				watered[i] = exhausted[c] ? 0 : 1;
				for (let k = 0; k < 4; k++) {
					const nx = x + DX[k], nz = z + DZ[k];
					if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
					const j = nz * N + nx;
					const bid = bld[j];
					if (bid >= 0 && served[bid] !== servedStamp && served[bid] !== -servedStamp && bComp[bid] - 1 === c) {
						const u = bUse[bid];
						if (u < 0) served[bid] = servedStamp;
						else if (!exhausted[c] && this.wLeft[c] >= u) {
							this.wLeft[c] -= u;
							served[bid] = servedStamp;
						} else {
							exhausted[c] = 1;
							served[bid] = -servedStamp;
						}
					}
					if (visit[j] === servedStamp || comp[j] !== c) continue;
					visit[j] = servedStamp;
					queue[qt++] = j;
				}
			}
		}
		for (const b of st.buildings.values()) {
			const c = bComp[b.id] - 1;
			let on = false;
			if (c >= 0 && this.wSupply[c] > 0) on = this.wDemand[c] <= this.wSupply[c] ? true : served[b.id] === servedStamp;
			const v = on ? 1 : 0;
			result[b.id] = v;
			for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
				const i = z * N + x;
				if (bld[i] === b.id) watered[i] = v;
			}
		}
		for (let i = 0; i < C; i++) {
			if (zone[i] === 0 || bld[i] >= 0 || comp[i] >= 0) continue;
			const x = i % N;
			watered[i] = x > 0 && comp[i - 1] >= 0 && watered[i - 1] === 1 || x < N - 1 && comp[i + 1] >= 0 && watered[i + 1] === 1 || i >= N && comp[i - N] >= 0 && watered[i - N] === 1 || i + N < C && comp[i + N] >= 0 && watered[i + N] === 1 ? 1 : 0;
		}
		st.stats.waterSupply = supplyTot;
		st.stats.waterDemand = demandTot;
	}
};
function adjacentComp(comp, N, b) {
	const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.d;
	for (let x = x0; x < x1; x++) {
		if (x < 0 || x >= N) continue;
		if (z0 > 0) {
			const c = comp[(z0 - 1) * N + x];
			if (c >= 0) return c;
		}
		if (z1 < N) {
			const c = comp[z1 * N + x];
			if (c >= 0) return c;
		}
	}
	for (let z = z0; z < z1; z++) {
		if (z < 0 || z >= N) continue;
		if (x0 > 0) {
			const c = comp[z * N + x0 - 1];
			if (c >= 0) return c;
		}
		if (x1 < N) {
			const c = comp[z * N + x1];
			if (c >= 0) return c;
		}
	}
	return -1;
}
function perimeterRoadCells(st, comp, b) {
	const N = st.size;
	const out = [];
	for (let z = b.z - 1; z <= b.z + b.d; z++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
		if (x < 0 || z < 0 || x >= N || z >= N) continue;
		const inside = x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d;
		const corner = (x < b.x || x >= b.x + b.w) && (z < b.z || z >= b.z + b.d);
		if (inside || corner) continue;
		const i = z * N + x;
		if (comp[i] >= 0) out.push(i);
	}
	return out;
}
function nearWater(st, b, d) {
	const N = st.size;
	for (let z = b.z - d; z < b.z + b.d + d; z++) for (let x = b.x - d; x < b.x + b.w + d; x++) {
		if (x < 0 || z < 0 || x >= N || z >= N) continue;
		if (st.water[z * N + x]) return true;
	}
	return false;
}
//#endregion
//#region src/sim/infra/graph.ts
/**
* Compact graphs built from CityState grids (flat typed arrays, 4 fixed neighbour slots per node).
*
*  RoadGraph: nodes = road cells (Street/Road/Avenue/OneWay/Highway, bridges & tunnels included).
*    Directed edges a -> b between 4-adjacent road cells when allowed:
*      - OneWay direction = netFlags bits 2-3 (0:+x 1:+z 2:-x 3:-z): no move against the flow out of / into a one-way
*        cell; entering/leaving sideways (turning) is allowed.
*      - Highway connects to Highway / Avenue / Road / OneWay (adjacency = automatic ramp, small time penalty);
*        Highway <-> Street is NOT connected.
*  GridGraph: undirected 4-neighbour graph for rail cells (Network.Rail) or subway cells (state.subway).
*
* Neighbour connections: road / rail cells on the map border (+ state.neighborConnections entries).
*/
var RoadGraph = class {
	N = 0;
	C = 0;
	n = 0;
	nodeOfCell = /* @__PURE__ */ new Int32Array(0);
	cellOf = /* @__PURE__ */ new Int32Array(0);
	type = /* @__PURE__ */ new Uint8Array(0);
	/** fwd[n*4+k]: node reached by moving from n in direction k (or -1) */
	fwd = /* @__PURE__ */ new Int32Array(0);
	/** rev[n*4+k]: neighbour node m in direction k from n such that m -> n is allowed (or -1) */
	rev = /* @__PURE__ */ new Int32Array(0);
	t0 = /* @__PURE__ */ new Float32Array(0);
	cap = /* @__PURE__ */ new Float32Array(0);
	/** weakly-connected component id per node */
	comp = /* @__PURE__ */ new Int32Array(0);
	nComp = 0;
	/** incremented on every rebuild */
	version = 0;
	build(state) {
		const N = state.size;
		const C = N * N;
		if (this.nodeOfCell.length !== C) this.nodeOfCell = new Int32Array(C);
		this.N = N;
		this.C = C;
		const net = state.network;
		const nodeOfCell = this.nodeOfCell;
		let n = 0;
		for (let i = 0; i < C; i++) if (isRoad(net[i])) nodeOfCell[i] = n++;
		else nodeOfCell[i] = -1;
		this.n = n;
		if (this.cellOf.length < n) {
			const cap = Math.max(n, 16) + (n >> 3);
			this.cellOf = new Int32Array(cap);
			this.type = new Uint8Array(cap);
			this.fwd = new Int32Array(cap * 4);
			this.rev = new Int32Array(cap * 4);
			this.t0 = new Float32Array(cap);
			this.cap = new Float32Array(cap);
			this.comp = new Int32Array(cap);
		}
		const cellOf = this.cellOf, type = this.type, fwd = this.fwd, rev = this.rev, t0 = this.t0, capA = this.cap;
		const flags = state.netFlags;
		for (let i = 0, k = 0; i < C; i++) {
			if (nodeOfCell[i] < 0) continue;
			cellOf[k] = i;
			const t = net[i];
			type[k] = t;
			t0[k] = NET_TIME[t];
			capA[k] = NET_CAPACITY[t];
			k++;
		}
		fwd.fill(-1, 0, n * 4);
		rev.fill(-1, 0, n * 4);
		for (let a = 0; a < n; a++) {
			const ci = cellOf[a];
			const x = ci % N;
			const z = (ci - x) / N;
			const ta = type[a];
			const dirA = flags[ci] >> 2 & 3;
			for (let k = 0; k < 4; k++) {
				const nx = x + DX[k], nz = z + DZ[k];
				if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
				const cj = nz * N + nx;
				const b = nodeOfCell[cj];
				if (b < 0) continue;
				const tb = type[b];
				if (!roadsConnect(ta, tb)) continue;
				const opp = k + 2 & 3;
				if (ta === 4 && k === (dirA + 2 & 3)) continue;
				if (tb === 4 && k === ((flags[cj] >> 2 & 3) + 2 & 3)) continue;
				fwd[a * 4 + k] = b;
				rev[b * 4 + opp] = a;
			}
		}
		const comp = this.comp;
		comp.fill(-1, 0, n);
		let nc = 0;
		const stack = scratchInt(n);
		for (let s = 0; s < n; s++) {
			if (comp[s] >= 0) continue;
			let sp = 0;
			stack[sp++] = s;
			comp[s] = nc;
			while (sp > 0) {
				const a = stack[--sp];
				for (let k = 0; k < 4; k++) {
					let b = fwd[a * 4 + k];
					if (b >= 0 && comp[b] < 0) {
						comp[b] = nc;
						stack[sp++] = b;
					}
					b = rev[a * 4 + k];
					if (b >= 0 && comp[b] < 0) {
						comp[b] = nc;
						stack[sp++] = b;
					}
				}
			}
			nc++;
		}
		this.nComp = nc;
		this.version++;
	}
	/** collect road nodes 4-adjacent to the building footprint into out (returns count, max out.length) */
	entryNodes(b, out, offset = 0, max = out.length - offset) {
		return perimeterNodes(this.nodeOfCell, this.N, b, out, offset, max);
	}
};
/** Highway <-> Street not connected; everything else between road types is. */
function roadsConnect(ta, tb) {
	if (ta === 5) return tb !== 1;
	if (tb === 5) return ta !== 1;
	return true;
}
/** undirected 4-neighbour graph of a cell mask (rail or subway) */
var GridGraph = class {
	N = 0;
	n = 0;
	nodeOfCell = /* @__PURE__ */ new Int32Array(0);
	cellOf = /* @__PURE__ */ new Int32Array(0);
	adj = /* @__PURE__ */ new Int32Array(0);
	comp = /* @__PURE__ */ new Int32Array(0);
	nComp = 0;
	version = 0;
	build(N, isNode) {
		const C = N * N;
		if (this.nodeOfCell.length !== C) this.nodeOfCell = new Int32Array(C);
		this.N = N;
		const nodeOfCell = this.nodeOfCell;
		let n = 0;
		for (let i = 0; i < C; i++) nodeOfCell[i] = isNode(i) ? n++ : -1;
		this.n = n;
		if (this.cellOf.length < n) {
			const cap = Math.max(n, 16) + (n >> 3);
			this.cellOf = new Int32Array(cap);
			this.adj = new Int32Array(cap * 4);
			this.comp = new Int32Array(cap);
		}
		const cellOf = this.cellOf, adj = this.adj;
		for (let i = 0, k = 0; i < C; i++) if (nodeOfCell[i] >= 0) cellOf[k++] = i;
		adj.fill(-1, 0, n * 4);
		for (let a = 0; a < n; a++) {
			const ci = cellOf[a];
			const x = ci % N, z = (ci - x) / N;
			for (let k = 0; k < 4; k++) {
				const nx = x + DX[k], nz = z + DZ[k];
				if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
				const b = nodeOfCell[nz * N + nx];
				if (b >= 0) adj[a * 4 + k] = b;
			}
		}
		const comp = this.comp;
		comp.fill(-1, 0, n);
		let nc = 0;
		const stack = scratchInt(n);
		for (let s = 0; s < n; s++) {
			if (comp[s] >= 0) continue;
			let sp = 0;
			stack[sp++] = s;
			comp[s] = nc;
			while (sp > 0) {
				const a = stack[--sp];
				for (let k = 0; k < 4; k++) {
					const b = adj[a * 4 + k];
					if (b >= 0 && comp[b] < 0) {
						comp[b] = nc;
						stack[sp++] = b;
					}
				}
			}
			nc++;
		}
		this.nComp = nc;
		this.version++;
	}
	perimeterNodes(b, out, offset = 0, max = out.length - offset, includeInside = false) {
		let c = perimeterNodes(this.nodeOfCell, this.N, b, out, offset, max);
		if (includeInside) {
			const N = this.N;
			for (let z = b.z; z < b.z + b.d && c < max; z++) for (let x = b.x; x < b.x + b.w && c < max; x++) {
				if (x < 0 || z < 0 || x >= N || z >= N) continue;
				const nd = this.nodeOfCell[z * N + x];
				if (nd >= 0) out[offset + c++] = nd;
			}
		}
		return c;
	}
};
/** nodes (from a nodeOfCell map) 4-adjacent to a building footprint; de-duplicated, returns count */
function perimeterNodes(nodeOfCell, N, b, out, offset, max) {
	let c = 0;
	const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.d;
	for (let x = x0; x < x1 && c < max; x++) {
		if (x < 0 || x >= N) continue;
		if (z0 - 1 >= 0) {
			const nd = nodeOfCell[(z0 - 1) * N + x];
			if (nd >= 0) out[offset + c++] = nd;
		}
		if (z1 < N && c < max) {
			const nd = nodeOfCell[z1 * N + x];
			if (nd >= 0) out[offset + c++] = nd;
		}
	}
	for (let z = z0; z < z1 && c < max; z++) {
		if (z < 0 || z >= N) continue;
		if (x0 - 1 >= 0) {
			const nd = nodeOfCell[z * N + x0 - 1];
			if (nd >= 0) out[offset + c++] = nd;
		}
		if (x1 < N && c < max) {
			const nd = nodeOfCell[z * N + x1];
			if (nd >= 0) out[offset + c++] = nd;
		}
	}
	return c;
}
let scratch = /* @__PURE__ */ new Int32Array(1024);
/** shared scratch Int32Array of at least n entries (single-threaded use only) */
function scratchInt(n) {
	if (scratch.length < n) scratch = new Int32Array(Math.max(n, scratch.length * 2));
	return scratch;
}
/**
* Neighbour connections: road / rail runs on the map border lead off-map. Consecutive border cells of the same
* network type form one run = one connection (placed at the run's middle cell), so a road running ALONG the edge
* counts once. Explicit state.neighborConnections entries on matching network cells are added too (deduplicated).
*/
function findNeighborConnections(state) {
	const N = state.size;
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	const net = state.network;
	const edges = [
		{
			edge: "n",
			cell: (t) => t
		},
		{
			edge: "s",
			cell: (t) => (N - 1) * N + t
		},
		{
			edge: "w",
			cell: (t) => t * N
		},
		{
			edge: "e",
			cell: (t) => t * N + N - 1
		}
	];
	for (const e of edges) {
		let t = 0;
		while (t < N) {
			const type = net[e.cell(t)];
			if (type === 0) {
				t++;
				continue;
			}
			let t1 = t;
			while (t1 + 1 < N && net[e.cell(t1 + 1)] === type) t1++;
			const mid = e.cell(t + t1 >> 1);
			let dup = false;
			for (let q = t; q <= t1; q++) if (seen.has(e.cell(q))) dup = true;
			for (let q = t; q <= t1; q++) seen.add(e.cell(q));
			if (!dup) out.push({
				cell: mid,
				x: mid % N,
				z: Math.floor(mid / N),
				type,
				edge: e.edge
			});
			t = t1 + 1;
		}
	}
	for (const c of state.neighborConnections ?? []) {
		if (c.x < 0 || c.z < 0 || c.x >= N || c.z >= N) continue;
		const i = c.z * N + c.x;
		if (seen.has(i) || net[i] === 0) continue;
		seen.add(i);
		out.push({
			cell: i,
			x: c.x,
			z: c.z,
			type: net[i],
			edge: c.edge
		});
	}
	return out;
}
//#endregion
//#region src/sim/infra/heap.ts
/**
* Binary min-heap over typed arrays (node id + float key) with lazy deletion (duplicates allowed; callers skip
* stale entries by comparing the popped key with their dist array). No per-operation allocation.
*/
var MinHeap = class {
	ids;
	keys;
	size = 0;
	constructor(capacity = 1024) {
		this.ids = new Int32Array(capacity);
		this.keys = new Float64Array(capacity);
	}
	clear() {
		this.size = 0;
	}
	reserve(capacity) {
		if (capacity <= this.ids.length) return;
		const ids = new Int32Array(capacity);
		const keys = new Float64Array(capacity);
		ids.set(this.ids.subarray(0, this.size));
		keys.set(this.keys.subarray(0, this.size));
		this.ids = ids;
		this.keys = keys;
	}
	push(id, key) {
		if (this.size >= this.ids.length) this.reserve(this.ids.length * 2);
		const ids = this.ids;
		const keys = this.keys;
		let i = this.size++;
		while (i > 0) {
			const p = i - 1 >> 1;
			const pk = keys[p];
			if (pk <= key) break;
			keys[i] = pk;
			ids[i] = ids[p];
			i = p;
		}
		keys[i] = key;
		ids[i] = id;
	}
	/** key of the top element (heap must be non-empty) */
	topKey() {
		return this.keys[0];
	}
	/** remove the min element and return its id (heap must be non-empty); its key was topKey() */
	pop() {
		const ids = this.ids;
		const keys = this.keys;
		const top = ids[0];
		const n = --this.size;
		if (n > 0) {
			const lastKey = keys[n];
			const lastId = ids[n];
			let i = 0;
			for (;;) {
				let c = 2 * i + 1;
				if (c >= n) break;
				const c2 = c + 1;
				if (c2 < n && keys[c2] < keys[c]) c = c2;
				if (keys[c] >= lastKey) break;
				keys[i] = keys[c];
				ids[i] = ids[c];
				i = c;
			}
			keys[i] = lastKey;
			ids[i] = lastId;
		}
		return top;
	}
};
//#endregion
//#region src/sim/infra/search.ts
var Search = class {
	n = 0;
	dist = /* @__PURE__ */ new Float64Array(0);
	src = /* @__PURE__ */ new Int32Array(0);
	next = /* @__PURE__ */ new Int32Array(0);
	hops = /* @__PURE__ */ new Uint16Array(0);
	order = /* @__PURE__ */ new Int32Array(0);
	done = /* @__PURE__ */ new Uint8Array(0);
	settled = 0;
	/** version of the graph this search ran on */
	graphVersion = -1;
	ensure(n) {
		if (this.dist.length < n) {
			const c = n + (n >> 2) + 16;
			this.dist = new Float64Array(c);
			this.src = new Int32Array(c);
			this.next = new Int32Array(c);
			this.hops = new Uint16Array(c);
			this.order = new Int32Array(c);
			this.done = new Uint8Array(c);
		}
		this.n = n;
	}
	reset(n) {
		this.ensure(n);
		this.dist.fill(Infinity, 0, n);
		this.src.fill(-1, 0, n);
		this.next.fill(-1, 0, n);
		this.done.fill(0, 0, n);
		this.settled = 0;
	}
};
var Seeds = class {
	n = 0;
	node = /* @__PURE__ */ new Int32Array(256);
	label = /* @__PURE__ */ new Float64Array(256);
	id = /* @__PURE__ */ new Int32Array(256);
	clear() {
		this.n = 0;
	}
	push(node, label, id) {
		if (this.n >= this.node.length) {
			const c = this.node.length * 2;
			const a = new Int32Array(c);
			a.set(this.node);
			this.node = a;
			const b = new Float64Array(c);
			b.set(this.label);
			this.label = b;
			const d = new Int32Array(c);
			d.set(this.id);
			this.id = d;
		}
		this.node[this.n] = node;
		this.label[this.n] = label;
		this.id[this.n] = id;
		this.n++;
	}
};
/**
* Dial bucket queue for road searches. Bucket width Q <= the minimum edge cost, so every node popped from the
* current bucket already has its final label (relaxations always land in later buckets) -> exact Dijkstra with O(1)
* push / pop. Entries are linked lists in typed arrays; stale entries are skipped via the done[] flags.
*/
var BucketQueue = class {
	head = /* @__PURE__ */ new Int32Array(0);
	enext = /* @__PURE__ */ new Int32Array(0);
	enode = /* @__PURE__ */ new Int32Array(0);
	en = 0;
	reset(buckets, entries) {
		if (this.head.length < buckets) this.head = new Int32Array(buckets + 64);
		this.head.fill(-1, 0, buckets);
		if (this.enext.length < entries) {
			this.enext = new Int32Array(entries);
			this.enode = new Int32Array(entries);
		}
		this.en = 0;
	}
	push(b, v) {
		let e = this.en++;
		if (e >= this.enext.length) {
			const c = this.enext.length * 2 + 16;
			const a = new Int32Array(c);
			a.set(this.enext);
			this.enext = a;
			const n = new Int32Array(c);
			n.set(this.enode);
			this.enode = n;
		}
		this.enode[e] = v;
		this.enext[e] = this.head[b];
		this.head[b] = e;
	}
};
const bq = new BucketQueue();
/** bucket width: min free-flow edge cost on roads (highway 0.04 min) */
let Q = .03996;
/**
* Road graph search. adj = g.fwd (forward search from seeds = origins) or g.rev (reverse search: distances TO the
* seeds = destinations). Edge a->b cost = (time[a] + time[b]) / 2 (+ ramp penalty on highway <-> road).
* `limit` stops the search once labels exceed it (unsettled nodes are unreachable).
*/
function roadSearch(g, adj, time, S, _heap, seeds, limit = 400) {
	const n = g.n;
	S.reset(n);
	S.graphVersion = g.version;
	const dist = S.dist, src = S.src, next = S.next, hops = S.hops, order = S.order, done = S.done;
	if (!(limit < 2e3)) limit = 2e3;
	const invQ = 1 / Q;
	const nb = Math.ceil(limit * invQ) + 2;
	bq.reset(nb, n * 2 + seeds.n + 16);
	for (let s = 0; s < seeds.n; s++) {
		const v = seeds.node[s];
		const l = seeds.label[s];
		if (v < 0 || v >= n || !(l <= limit)) continue;
		if (l < dist[v]) {
			dist[v] = l;
			src[v] = seeds.id[s];
			next[v] = -1;
			hops[v] = 0;
			bq.push(l * invQ | 0, v);
		}
	}
	const type = g.type;
	const HW = 5;
	const head = bq.head;
	let cnt = 0;
	for (let b = 0; b < nb; b++) {
		let e = head[b];
		while (e >= 0) {
			const u = bq.enode[e];
			e = bq.enext[e];
			if (done[u] === 1) continue;
			done[u] = 1;
			order[cnt++] = u;
			const key = dist[u];
			const tu = time[u];
			const hu = type[u] === HW;
			const su = src[u];
			const hp = hops[u] + 1;
			const base = u * 4;
			for (let k = 0; k < 4; k++) {
				const v = adj[base + k];
				if (v < 0 || done[v] === 1) continue;
				let c = .5 * (tu + time[v]);
				if (hu !== (type[v] === HW)) c += RAMP_PENALTY;
				const nd = key + c;
				if (nd < dist[v] && nd <= limit) {
					dist[v] = nd;
					src[v] = su;
					next[v] = u;
					hops[v] = hp > 65535 ? 65535 : hp;
					const bi = nd * invQ | 0;
					bq.push(bi > b ? bi : b + 1, v);
				}
			}
		}
		head[b] = -1;
	}
	S.settled = cnt;
}
/** bucket width for the transit net: min in-vehicle edge cost (subway 0.03 min/cell) */
let QT = .02997;
function transitSearch(T, S, _heap, seeds, limit = 400) {
	const n = T.total;
	S.reset(n);
	const dist = S.dist, src = S.src, next = S.next, hops = S.hops, order = S.order, done = S.done;
	if (!(limit < 2e3)) limit = 2e3;
	const invQ = 1 / QT;
	const nb = Math.ceil(limit * invQ) + 2;
	bq.reset(nb, n * 2 + seeds.n + 16);
	for (let s = 0; s < seeds.n; s++) {
		const v = seeds.node[s];
		const l = seeds.label[s];
		if (v < 0 || v >= n || !(l <= limit)) continue;
		if (l < dist[v]) {
			dist[v] = l;
			src[v] = seeds.id[s];
			next[v] = -1;
			hops[v] = 0;
			bq.push(l * invQ | 0, v);
		}
	}
	const nR = T.nR, nRR = T.nR + T.nRail;
	const roadAdj = T.roadAdj, busTime = T.busTime, railAdj = T.railAdj, subAdj = T.subAdj;
	const trStart = T.trStart, trTo = T.trTo, trCost = T.trCost;
	const railTime = T.railTime, subTime = T.subTime;
	const head = bq.head;
	let cnt = 0;
	for (let b = 0; b < nb; b++) {
		let e = head[b];
		while (e >= 0) {
			const u = bq.enode[e];
			e = bq.enext[e];
			if (done[u] === 1) continue;
			done[u] = 1;
			order[cnt++] = u;
			const key = dist[u];
			const su = src[u];
			const hp = Math.min(65535, hops[u] + 1);
			for (let k = 0; k < 4; k++) {
				let v, c;
				if (u < nR) {
					v = roadAdj[u * 4 + k];
					if (v < 0) continue;
					c = .5 * (busTime[u] + busTime[v]);
				} else if (u < nRR) {
					const a = railAdj[(u - nR) * 4 + k];
					if (a < 0) continue;
					v = a + nR;
					c = railTime;
				} else {
					const a = subAdj[(u - nRR) * 4 + k];
					if (a < 0) continue;
					v = a + nRR;
					c = subTime;
				}
				if (done[v] === 1) continue;
				const nd = key + c;
				if (nd < dist[v] && nd <= limit) {
					dist[v] = nd;
					src[v] = su;
					next[v] = u;
					hops[v] = hp;
					const bi = nd * invQ | 0;
					bq.push(bi > b ? bi : b + 1, v);
				}
			}
			for (let t = trStart[u], t1 = trStart[u + 1]; t < t1; t++) {
				const v = trTo[t];
				if (done[v] === 1) continue;
				const nd = key + trCost[t];
				if (nd < dist[v] && nd <= limit) {
					dist[v] = nd;
					src[v] = su;
					next[v] = u;
					hops[v] = hp;
					const bi = nd * invQ | 0;
					bq.push(bi > b ? bi : b + 1, v);
				}
			}
		}
		head[b] = -1;
	}
	S.settled = cnt;
}
/**
* Accumulate flows injected in `acc` (per node) along the search forest toward the seeds.
* After the call acc[v] = total flow through v. `onSink(seedId, flow)` receives flow reaching a seed.
*/
function accumulate(S, acc, onSink) {
	const order = S.order, next = S.next, src = S.src;
	for (let k = S.settled - 1; k >= 0; k--) {
		const v = order[k];
		const f = acc[v];
		if (f === 0) continue;
		const nx = next[v];
		if (nx >= 0) acc[nx] += f;
		else if (onSink) onSink(src[v], f, v);
	}
}
function collectStops(state, out) {
	let n = 0;
	const res = out ?? {
		n: 0,
		bid: /* @__PURE__ */ new Int32Array(64),
		mode: /* @__PURE__ */ new Uint8Array(64),
		cell: /* @__PURE__ */ new Int32Array(64)
	};
	const push = (bid, mode, cell) => {
		if (n >= res.bid.length) {
			const cap = res.bid.length * 2;
			const b = new Int32Array(cap);
			b.set(res.bid);
			res.bid = b;
			const m = new Uint8Array(cap);
			m.set(res.mode);
			res.mode = m;
			const c = new Int32Array(cap);
			c.set(res.cell);
			res.cell = c;
		}
		res.bid[n] = bid;
		res.mode[n] = mode;
		res.cell[n] = cell;
		n++;
	};
	for (const b of state.buildings.values()) {
		const inf = infoOf(state, b);
		if (inf.transit !== 1 && inf.transit !== 2 && inf.transit !== 3) continue;
		if (!isFunctional(b)) continue;
		push(b.id, inf.transit, centerCell(state, b));
	}
	const flags = state.netFlags;
	const net = state.network;
	for (let i = 0; i < state.cells; i++) if ((flags[i] & 16) !== 0 && net[i] >= 1 && net[i] <= 5) push(-1, 1, i);
	res.n = n;
	return res;
}
/** transit walking coverage (0..1) from stops; adds into `out` (which is cleared first) */
function computeTransitCoverage(state, stops, out, funding) {
	out.fill(0);
	const N = state.size;
	for (let s = 0; s < stops.n; s++) {
		const mode = stops.mode[s];
		const R = mode === 1 ? TRANSIT_COV_RADIUS.bus : mode === 2 ? TRANSIT_COV_RADIUS.subway : TRANSIT_COV_RADIUS.train;
		const c = stops.cell[s];
		const cx = c % N, cz = (c - cx) / N;
		const R2 = (R + .5) * (R + .5);
		const strength = (mode === 1 ? .75 : 1) * funding;
		for (let z = Math.max(0, cz - R); z <= Math.min(N - 1, cz + R); z++) {
			const dz = z - cz;
			for (let x = Math.max(0, cx - R); x <= Math.min(N - 1, cx + R); x++) {
				const dx = x - cx;
				const d2 = dx * dx + dz * dz;
				if (d2 > R2) continue;
				const d = Math.sqrt(d2) / (R + .5);
				const v = strength * (1 - d * d * .7);
				const i = z * N + x;
				const cur = out[i];
				out[i] = cur + v * (1 - cur);
			}
		}
	}
}
//#endregion
//#region src/sim/infra/traffic.ts
const PH_PREP = 0;
const PH_COMMUTE = 1;
const PH_TRANSIT = 2;
const PH_MODE = 3;
const PH_INBOUND = 4;
const PH_SHOP = 5;
const PH_FREIGHT = 6;
const PH_FINAL = 7;
const PHASES = 8;
const MAX_ENTRIES = 12;
const MODE_NAMES = [
	"none",
	"car",
	"transit",
	"walk"
];
const IND_KEYS$1 = [
	"IA",
	"ID",
	"IM",
	"IHT"
];
/** growable typed arrays helper */
function growI32(a, n) {
	if (a.length >= n) return a;
	const b = new Int32Array(Math.max(n, a.length * 2, 64));
	b.set(a);
	return b;
}
function growF32(a, n) {
	if (a.length >= n) return a;
	const b = new Float32Array(Math.max(n, a.length * 2, 64));
	b.set(a);
	return b;
}
function growU8(a, n) {
	if (a.length >= n) return a;
	const b = new Uint8Array(Math.max(n, a.length * 2, 64));
	b.set(a);
	return b;
}
var TrafficSystem = class {
	name = "traffic";
	road = new RoadGraph();
	rail = new GridGraph();
	subway = new GridGraph();
	graphDirty = true;
	unsub = [];
	phase = -1;
	lastCycleStart = -1e9;
	lastFrameMs = -1e9;
	/** cycles since graph rebuild (MSA) */
	iter = 0;
	/** total completed assignments */
	cycles = 0;
	/** timings (ms) of the last completed cycle per phase */
	phaseMs = new Float64Array(PHASES);
	lastCycleMs = 0;
	heap = new MinHeap(4096);
	SA = new Search();
	ST = new Search();
	SB = new Search();
	seeds = new Seeds();
	tnet = null;
	nodeTime = /* @__PURE__ */ new Float32Array(0);
	volNew = /* @__PURE__ */ new Float32Array(0);
	acc = /* @__PURE__ */ new Float32Array(0);
	tAcc = /* @__PURE__ */ new Float32Array(0);
	railNew = /* @__PURE__ */ new Float32Array(0);
	subNew = /* @__PURE__ */ new Float32Array(0);
	/** subway riders per cell (not in state.traffic because subway can run under roads) */
	subwayRiders = /* @__PURE__ */ new Float32Array(0);
	ent = /* @__PURE__ */ new Int32Array(4096);
	entN = 0;
	oN = 0;
	oBid = /* @__PURE__ */ new Int32Array(0);
	oW = /* @__PURE__ */ new Float32Array(0);
	oPop = /* @__PURE__ */ new Float32Array(0);
	oWealth = /* @__PURE__ */ new Uint8Array(0);
	oEntS = /* @__PURE__ */ new Int32Array(0);
	oEntC = /* @__PURE__ */ new Uint8Array(0);
	oCell = /* @__PURE__ */ new Int32Array(0);
	oHalf = /* @__PURE__ */ new Uint8Array(0);
	oCarNode = /* @__PURE__ */ new Int32Array(0);
	oBoard = /* @__PURE__ */ new Int32Array(0);
	oShC = /* @__PURE__ */ new Float32Array(0);
	oShT = /* @__PURE__ */ new Float32Array(0);
	oShW = /* @__PURE__ */ new Float32Array(0);
	oTime = /* @__PURE__ */ new Float32Array(0);
	oEmp = /* @__PURE__ */ new Float32Array(0);
	oJobA = /* @__PURE__ */ new Int32Array(0);
	oJobT = /* @__PURE__ */ new Int32Array(0);
	jN = 0;
	jB = 0;
	jBid = /* @__PURE__ */ new Int32Array(0);
	jSlots = /* @__PURE__ */ new Float32Array(0);
	jPrice = /* @__PURE__ */ new Float32Array(0);
	/** price + destination preference noise used for this cycle's seeds */
	jPen = /* @__PURE__ */ new Float32Array(0);
	jBase = /* @__PURE__ */ new Float32Array(0);
	jEntS = /* @__PURE__ */ new Int32Array(0);
	jEntC = /* @__PURE__ */ new Uint8Array(0);
	jCell = /* @__PURE__ */ new Int32Array(0);
	jHalf = /* @__PURE__ */ new Uint8Array(0);
	jLoad = /* @__PURE__ */ new Float32Array(0);
	jTimeSum = /* @__PURE__ */ new Float32Array(0);
	jInbound = /* @__PURE__ */ new Float32Array(0);
	jRailNode = /* @__PURE__ */ new Int32Array(0);
	sN = 0;
	sBid = /* @__PURE__ */ new Int32Array(0);
	sEntS = /* @__PURE__ */ new Int32Array(0);
	sEntC = /* @__PURE__ */ new Uint8Array(0);
	sLoad = /* @__PURE__ */ new Float32Array(0);
	fN = 0;
	fBid = /* @__PURE__ */ new Int32Array(0);
	fTrucks = /* @__PURE__ */ new Float32Array(0);
	fEntS = /* @__PURE__ */ new Int32Array(0);
	fEntC = /* @__PURE__ */ new Uint8Array(0);
	kN = 0;
	kEntS = /* @__PURE__ */ new Int32Array(0);
	kEntC = /* @__PURE__ */ new Uint8Array(0);
	kLabel = /* @__PURE__ */ new Float32Array(0);
	conns = [];
	connPrice = /* @__PURE__ */ new Float32Array(0);
	stops = {
		n: 0,
		bid: /* @__PURE__ */ new Int32Array(64),
		mode: /* @__PURE__ */ new Uint8Array(64),
		cell: /* @__PURE__ */ new Int32Array(64)
	};
	stAttS = /* @__PURE__ */ new Int32Array(0);
	stAttC = /* @__PURE__ */ new Uint8Array(0);
	stAtt = /* @__PURE__ */ new Int32Array(0);
	stWait = /* @__PURE__ */ new Float32Array(0);
	stLoad = /* @__PURE__ */ new Float32Array(0);
	stLoadPrev = /* @__PURE__ */ new Map();
	stopBins = /* @__PURE__ */ new Int32Array(0);
	stopBinStart = /* @__PURE__ */ new Int32Array(0);
	binN = 0;
	nodeStop = /* @__PURE__ */ new Int32Array(0);
	nsIdx = /* @__PURE__ */ new Int32Array(64);
	nsDist = /* @__PURE__ */ new Float32Array(64);
	jConnType = /* @__PURE__ */ new Uint8Array(0);
	growth = 1;
	regionWorkerCap = 0;
	priceById = /* @__PURE__ */ new Float32Array(1024);
	/** residential: share of workers reaching a job (0..1); -1 = unknown. Index = building id. */
	accessById = (/* @__PURE__ */ new Float32Array(1024)).fill(-1);
	/** job sites: filled share of job slots by reachable workers (local + regional), 0..1; -1 unknown */
	jobFillById = (/* @__PURE__ */ new Float32Array(1024)).fill(-1);
	/** industry: freight access 0..1; -1 unknown */
	freightById = (/* @__PURE__ */ new Float32Array(1024)).fill(-1);
	/** commercial: customers/day */
	customersById = /* @__PURE__ */ new Float32Array(1024);
	/** residential: commute minutes; job sites: average arriving commute */
	commuteById = /* @__PURE__ */ new Float32Array(1024);
	/** workers reached (R) / workers arriving (jobs) */
	reachedById = /* @__PURE__ */ new Float32Array(1024);
	modeById = /* @__PURE__ */ new Uint8Array(1024);
	tripsCar = 0;
	tripsTransit = 0;
	tripsWalk = 0;
	tripsInbound = 0;
	tripsShop = 0;
	tripsFreight = 0;
	commuteSum = 0;
	commuteW = 0;
	routes = [];
	pendingRoutes = [];
	serviceRoutes = [];
	rngState = 12345;
	ords = /* @__PURE__ */ new Set();
	jobsUnknown = false;
	init(sim) {
		for (const u of this.unsub) u();
		this.unsub = [];
		const ev = sim.events;
		this.unsub.push(ev.on("networkChanged", () => {
			this.graphDirty = true;
		}), ev.on("subwayChanged", () => {
			this.graphDirty = true;
		}), ev.on("terrainChanged", () => {
			this.graphDirty = true;
		}), ev.on("reset", () => {
			this.graphDirty = true;
		}));
		sim.state.systemData.infraVersion = 1;
		this.graphDirty = true;
		this.phase = -1;
		this.iter = 0;
		this.cycles = 0;
		this.priceById.fill(0);
		this.accessById.fill(-1);
		this.jobFillById.fill(-1);
		this.freightById.fill(-1);
		this.stLoadPrev.clear();
		this.serviceRoutes = [];
		this.routes = [];
		this.connPrice = new Float32Array(sim.state.cells);
		this.rngState = (sim.state.config.seed ^ 5369127) >>> 0 || 1;
		if (sim.state.buildings.size > 0 || sim.state.network.some((v) => v !== 0)) this.runCycleSync(sim);
	}
	daily(sim) {
		const st = sim.state;
		const framesActive = nowMs() - this.lastFrameMs < 750;
		if (this.phase < 0 && st.day - this.lastCycleStart >= 2) {
			this.phase = PH_PREP;
			this.lastCycleStart = st.day;
		}
		if (this.phase < 0) return;
		if (!framesActive) this.step(sim);
		else if (st.day - this.lastCycleStart > 8) while (this.phase >= 0) this.step(sim);
	}
	frame(sim, _dt) {
		this.lastFrameMs = nowMs();
		if (this.phase < 0) return;
		const t0 = this.lastFrameMs;
		do
			this.step(sim);
		while (this.phase >= 0 && nowMs() - t0 < 2.5);
	}
	/** run one full assignment synchronously (tests / load) */
	runCycleSync(sim) {
		if (this.phase < 0) {
			this.phase = PH_PREP;
			this.lastCycleStart = sim.state.day;
		}
		while (this.phase >= 0) this.step(sim);
	}
	/** request a new assignment as soon as possible */
	invalidate() {
		this.lastCycleStart = -1e9;
	}
	getSampleRoutes(max) {
		const out = this.routes.length <= max ? this.routes.slice() : this.routes.slice(0, max);
		for (const s of this.serviceRoutes) {
			if (out.length >= max + 8) break;
			out.push(s.r);
		}
		return out;
	}
	routeInfo(buildingId) {
		if (buildingId < 0 || buildingId >= this.modeById.length) return null;
		const m = this.modeById[buildingId];
		if (m === 0 && this.reachedById[buildingId] === 0 && this.commuteById[buildingId] === 0) return null;
		return {
			commuteMin: this.commuteById[buildingId],
			mode: MODE_NAMES[m] ?? "none",
			jobsReached: Math.round(this.reachedById[buildingId])
		};
	}
	/** residential: 0..1 share of workers that can reach a job (-1 = not assessed yet) */
	workerAccess(id) {
		return id >= 0 && id < this.accessById.length ? this.accessById[id] : -1;
	}
	/** job site: 0..1 share of job slots reachable workers fill (-1 = not assessed yet) */
	jobFill(id) {
		return id >= 0 && id < this.jobFillById.length ? this.jobFillById[id] : -1;
	}
	/** industry: 0..1 freight access (-1 = not assessed) */
	freightAccess(id) {
		return id >= 0 && id < this.freightById.length ? this.freightById[id] : -1;
	}
	/** commercial: shopping trips/day arriving */
	customers(id) {
		return id >= 0 && id < this.customersById.length ? this.customersById[id] : 0;
	}
	commuteOf(id) {
		return id >= 0 && id < this.commuteById.length ? this.commuteById[id] : 0;
	}
	/** a transient service-vehicle route (fire trucks etc.) shown for `days` sim days */
	pushServiceRoute(sim, cells, weight = 1, days = 2) {
		this.serviceRoutes.push({
			r: {
				cells,
				kind: "service",
				weight
			},
			until: sim.state.day + days
		});
		if (this.serviceRoutes.length > 32) this.serviceRoutes.shift();
	}
	/** shortest road path (BFS over allowed moves) between two cells next to / on roads; null if none */
	findPath(sim, fromCell, toCell, maxNodes = 2e4) {
		const st = sim.state;
		if (this.graphDirty && this.phase < 0 || this.road.N !== st.size) this.rebuildGraphs(st);
		const g = this.road;
		const a = this.nearestRoadNode(st, fromCell), b = this.nearestRoadNode(st, toCell);
		if (a < 0 || b < 0) return null;
		if (g.comp[a] !== g.comp[b]) return null;
		const n = g.n;
		const S = this.SB;
		S.ensure(n);
		const parent = S.next, done = S.done, q = S.order;
		done.fill(0, 0, n);
		let qh = 0, qt = 0;
		q[qt++] = a;
		done[a] = 1;
		parent[a] = -1;
		let found = a === b;
		while (qh < qt && !found && qt < maxNodes) {
			const u = q[qh++];
			for (let k = 0; k < 4; k++) {
				const v = g.fwd[u * 4 + k];
				if (v < 0 || done[v]) continue;
				done[v] = 1;
				parent[v] = u;
				if (v === b) {
					found = true;
					break;
				}
				q[qt++] = v;
			}
		}
		S.settled = 0;
		if (!found) return null;
		const path = [];
		for (let v = b; v >= 0; v = parent[v]) path.push(g.cellOf[v]);
		path.reverse();
		return Uint32Array.from(path);
	}
	nearestRoadNode(st, cell) {
		const g = this.road;
		if (cell < 0 || cell >= st.cells) return -1;
		const nd = g.nodeOfCell[cell];
		if (nd >= 0) return nd;
		const b = st.building[cell] >= 0 ? st.buildings.get(st.building[cell]) : void 0;
		if (b) {
			const tmp = /* @__PURE__ */ new Int32Array(4);
			if (perimeterNodes(g.nodeOfCell, st.size, b, tmp, 0, 4) > 0) return tmp[0];
		}
		const N = st.size, x = cell % N, z = (cell - x) / N;
		for (let r = 1; r <= 3; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
			const nx = x + dx, nz = z + dz;
			if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
			const m = g.nodeOfCell[nz * N + nx];
			if (m >= 0) return m;
		}
		return -1;
	}
	step(sim) {
		const t0 = nowMs();
		const ph = this.phase;
		switch (ph) {
			case PH_PREP:
				this.prep(sim);
				break;
			case PH_COMMUTE:
				this.commute();
				break;
			case PH_TRANSIT:
				this.transit();
				break;
			case PH_MODE:
				this.modeChoice();
				break;
			case PH_INBOUND:
				this.inbound();
				break;
			case PH_SHOP:
				this.shopping();
				break;
			case PH_FREIGHT:
				this.freight();
				break;
			case PH_FINAL: this.finalize(sim);
		}
		this.phaseMs[ph] = nowMs() - t0;
		this.phase = ph + 1 >= PHASES ? -1 : ph + 1;
		if (this.phase < 0) {
			let s = 0;
			for (let i = 0; i < PHASES; i++) s += this.phaseMs[i];
			this.lastCycleMs = s;
		}
	}
	rand() {
		let t = this.rngState = this.rngState + 1831565813 >>> 0;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	}
	rebuildGraphs(st) {
		this.road.build(st);
		const net = st.network;
		this.rail.build(st.size, (i) => net[i] === 6);
		const sub = st.subway;
		this.subway.build(st.size, (i) => sub[i] !== 0);
		this.graphDirty = false;
		this.iter = 0;
		if (this.connPrice.length !== st.cells) this.connPrice = new Float32Array(st.cells);
	}
	addEntries(nodeOfCell, N, b) {
		if (this.entN + MAX_ENTRIES > this.ent.length) this.ent = growI32(this.ent, (this.entN + MAX_ENTRIES) * 2);
		const c = perimeterNodes(nodeOfCell, N, b, this.ent, this.entN, MAX_ENTRIES);
		this.entN += c;
		return c;
	}
	prep(sim) {
		const st = sim.state;
		if (this.graphDirty || this.road.N !== st.size) this.rebuildGraphs(st);
		const g = this.road;
		const N = st.size;
		this.ords = readOrdinances(st);
		this.jobsUnknown = detectJobsUnknown(st);
		this.priceById = ensureIdFloat(this.priceById, st);
		this.accessById = ensureIdFloat(this.accessById, st, -1);
		this.jobFillById = ensureIdFloat(this.jobFillById, st, -1);
		this.freightById = ensureIdFloat(this.freightById, st, -1);
		this.customersById = ensureIdFloat(this.customersById, st);
		this.commuteById = ensureIdFloat(this.commuteById, st);
		this.reachedById = ensureIdFloat(this.reachedById, st);
		this.modeById = growU8(this.modeById, st.nextBuildingId + 1);
		const n = g.n;
		this.nodeTime = growF32(this.nodeTime, n);
		this.volNew = growF32(this.volNew, n);
		this.acc = growF32(this.acc, n);
		const traffic = st.traffic;
		for (let v = 0; v < n; v++) {
			const r = traffic[g.cellOf[v]] / g.cap[v];
			let f = 1 + BPR_ALPHA * r * r * r * r;
			if (f > 12) f = 12;
			this.nodeTime[v] = g.t0[v] * f;
		}
		this.volNew.fill(0, 0, n);
		this.railNew = growF32(this.railNew, this.rail.n);
		this.railNew.fill(0, 0, this.rail.n);
		this.subNew = growF32(this.subNew, this.subway.n);
		this.subNew.fill(0, 0, this.subway.n);
		this.entN = 0;
		let oN = 0, jN = 0, sN = 0, fN = 0, kN = 0;
		const cap = st.buildings.size + 16;
		this.oBid = growI32(this.oBid, cap);
		this.oW = growF32(this.oW, cap);
		this.oPop = growF32(this.oPop, cap);
		this.oWealth = growU8(this.oWealth, cap);
		this.oEntS = growI32(this.oEntS, cap);
		this.oEntC = growU8(this.oEntC, cap);
		this.oCell = growI32(this.oCell, cap);
		this.oHalf = growU8(this.oHalf, cap);
		const conns = this.conns = findNeighborConnections(st);
		const jcap = cap + conns.length;
		this.jBid = growI32(this.jBid, jcap);
		this.jSlots = growF32(this.jSlots, jcap);
		this.jPrice = growF32(this.jPrice, jcap);
		this.jPen = growF32(this.jPen, jcap);
		this.jBase = growF32(this.jBase, jcap);
		this.jEntS = growI32(this.jEntS, jcap);
		this.jEntC = growU8(this.jEntC, jcap);
		this.jCell = growI32(this.jCell, jcap);
		this.jHalf = growU8(this.jHalf, jcap);
		this.jRailNode = growI32(this.jRailNode, jcap);
		this.jConnType = growU8(this.jConnType, jcap);
		this.sBid = growI32(this.sBid, cap);
		this.sEntS = growI32(this.sEntS, cap);
		this.sEntC = growU8(this.sEntC, cap);
		this.fBid = growI32(this.fBid, cap);
		this.fTrucks = growF32(this.fTrucks, cap);
		this.fEntS = growI32(this.fEntS, cap);
		this.fEntC = growU8(this.fEntC, cap);
		this.kEntS = growI32(this.kEntS, cap + conns.length);
		this.kEntC = growU8(this.kEntC, cap + conns.length);
		this.kLabel = growF32(this.kLabel, cap + conns.length);
		const nodeOfCell = g.nodeOfCell;
		const jobsUnknown = this.jobsUnknown;
		for (const b of st.buildings.values()) {
			const inf = infoOf(st, b);
			if (inf.fam === 1) {
				if (b.pop <= 0 || (b.flags & BF.Burnt) !== 0) continue;
				this.oBid[oN] = b.id;
				this.oPop[oN] = b.pop;
				this.oW[oN] = b.pop * WORKER_SHARE;
				this.oWealth[oN] = wealthOf(inf, b);
				this.oCell[oN] = centerCell(st, b);
				this.oHalf[oN] = Math.max(b.w, b.d) >> 1;
				this.oEntS[oN] = this.entN;
				this.oEntC[oN] = this.addEntries(nodeOfCell, N, b);
				oN++;
				continue;
			}
			const slots = jobSlots(inf, b);
			if (slots > 0) {
				this.jBid[jN] = b.id;
				this.jSlots[jN] = slots;
				this.jPrice[jN] = this.priceById[b.id];
				this.jBase[jN] = 0;
				this.jCell[jN] = centerCell(st, b);
				this.jHalf[jN] = Math.max(b.w, b.d) >> 1;
				this.jRailNode[jN] = -1;
				this.jEntS[jN] = this.entN;
				this.jEntC[jN] = this.addEntries(nodeOfCell, N, b);
				jN++;
			}
			if (inf.fam === 2 && inf.dev >= 3 && inf.dev <= 5 && isFunctional(b)) {
				this.sBid[sN] = b.id;
				this.sEntS[sN] = this.entN;
				this.sEntC[sN] = this.addEntries(nodeOfCell, N, b);
				sN++;
			}
			if (inf.fam === 3 && isFunctional(b)) {
				const k = IND_KEYS$1[Math.max(0, Math.min(3, inf.dev - 8))];
				const trucks = activeJobs(inf, b, jobsUnknown) * FREIGHT_PER_JOB[k];
				if (trucks > 0) {
					this.fBid[fN] = b.id;
					this.fTrucks[fN] = trucks;
					this.fEntS[fN] = this.entN;
					this.fEntC[fN] = this.addEntries(nodeOfCell, N, b);
					fN++;
				}
			}
			if ((inf.transit === 4 || inf.transit === 5 || inf.transit === 6) && isFunctional(b)) {
				this.kEntS[kN] = this.entN;
				this.kEntC[kN] = this.addEntries(nodeOfCell, N, b);
				this.kLabel[kN] = 1;
				kN++;
			}
		}
		this.jB = jN;
		const growth = this.growth = 1 + Math.min(3, st.stats.population / 25e4);
		for (const c of conns) {
			if (this.entN + 1 > this.ent.length) this.ent = growI32(this.ent, this.entN * 2 + 16);
			if (c.type === 6) {
				const rn = this.rail.nodeOfCell[c.cell];
				if (rn < 0) continue;
				this.jBid[jN] = -1;
				this.jSlots[jN] = CONNECTION_JOBS[c.type] * growth;
				this.jPrice[jN] = this.connPrice[c.cell];
				this.jBase[jN] = 16;
				this.jCell[jN] = c.cell;
				this.jHalf[jN] = 0;
				this.jRailNode[jN] = rn;
				this.jConnType[jN] = c.type;
				this.jEntS[jN] = this.entN;
				this.jEntC[jN] = 0;
				jN++;
				continue;
			}
			const nd = nodeOfCell[c.cell];
			if (nd < 0) continue;
			this.ent[this.entN] = nd;
			this.jBid[jN] = -1;
			this.jSlots[jN] = CONNECTION_JOBS[c.type] * growth;
			this.jPrice[jN] = this.connPrice[c.cell];
			this.jBase[jN] = 16;
			this.jCell[jN] = c.cell;
			this.jHalf[jN] = 0;
			this.jRailNode[jN] = -1;
			this.jConnType[jN] = c.type;
			this.jEntS[jN] = this.entN;
			this.jEntC[jN] = 1;
			jN++;
			this.kEntS[kN] = this.entN;
			this.kEntC[kN] = 1;
			this.kLabel[kN] = 3;
			kN++;
			this.entN++;
		}
		this.oN = oN;
		this.jN = jN;
		this.sN = sN;
		this.fN = fN;
		this.kN = kN;
		let workers = 0, citySlots = 0, connSlots = 0;
		for (let o = 0; o < oN; o++) workers += this.oW[o];
		for (let j = 0; j < this.jB; j++) citySlots += this.jSlots[j];
		for (let j = this.jB; j < jN; j++) connSlots += this.jSlots[j];
		const sd = st.systemData;
		const regionJobs = typeof sd.regionJobs === "number" ? sd.regionJobs : REGION_JOB_SHARE * workers + REGION_JOB_MIN;
		if (connSlots > regionJobs && connSlots > 0) {
			const f = regionJobs / connSlots;
			for (let j = this.jB; j < jN; j++) this.jSlots[j] *= f;
		}
		this.regionWorkerCap = typeof sd.regionWorkers === "number" ? sd.regionWorkers : REGION_WORKER_SHARE * citySlots + REGION_WORKER_MIN;
		this.oCarNode = growI32(this.oCarNode, oN);
		this.oBoard = growI32(this.oBoard, oN);
		this.oShC = growF32(this.oShC, oN);
		this.oShT = growF32(this.oShT, oN);
		this.oShW = growF32(this.oShW, oN);
		this.oTime = growF32(this.oTime, oN);
		this.oEmp = growF32(this.oEmp, oN);
		this.oJobA = growI32(this.oJobA, oN);
		this.oJobT = growI32(this.oJobT, oN);
		this.jLoad = growF32(this.jLoad, jN);
		this.jLoad.fill(0, 0, jN);
		this.jTimeSum = growF32(this.jTimeSum, jN);
		this.jTimeSum.fill(0, 0, jN);
		this.jInbound = growF32(this.jInbound, jN);
		this.jInbound.fill(0, 0, jN);
		this.sLoad = growF32(this.sLoad, sN);
		this.sLoad.fill(0, 0, sN);
		this.pendingRoutes = [];
		this.prepTransit(st);
	}
	prepTransit(st) {
		const g = this.road, rail = this.rail, sub = this.subway;
		const N = st.size;
		const stops = collectStops(st, this.stops);
		this.stops = stops;
		const nR = g.n, nRail = rail.n, nSub = sub.n, total = nR + nRail + nSub;
		this.stAttS = growI32(this.stAttS, stops.n + 1);
		this.stAttC = growU8(this.stAttC, stops.n + 1);
		this.stAtt = growI32(this.stAtt, stops.n * 6 + 8);
		this.stWait = growF32(this.stWait, stops.n + 1);
		this.stLoad = growF32(this.stLoad, stops.n + 1);
		this.stLoad.fill(0, 0, stops.n);
		this.nodeStop = growI32(this.nodeStop, total + 1);
		this.nodeStop.fill(-1, 0, total);
		let an = 0;
		const tmp = /* @__PURE__ */ new Int32Array(6);
		for (let s = 0; s < stops.n; s++) {
			this.stAttS[s] = an;
			const mode = stops.mode[s];
			const bid = stops.bid[s];
			const b = bid >= 0 ? st.buildings.get(bid) : void 0;
			let c = 0;
			if (mode === 1) {
				if (!b) {
					const nd = g.nodeOfCell[stops.cell[s]];
					if (nd >= 0) tmp[c++] = nd;
				} else c = perimeterNodes(g.nodeOfCell, N, b, tmp, 0, 2);
			} else if (mode === 3 && b) {
				c = perimeterNodes(rail.nodeOfCell, N, b, tmp, 0, 4);
				for (let q = 0; q < c; q++) tmp[q] += nR;
			} else if (mode === 2 && b) {
				c = sub.perimeterNodes(b, tmp, 0, 4, true);
				for (let q = 0; q < c; q++) tmp[q] += nR + nRail;
			}
			for (let q = 0; q < c; q++) {
				this.stAtt[an++] = tmp[q];
				this.nodeStop[tmp[q]] = s;
			}
			this.stAttC[s] = c;
			const key = bid >= 0 ? bid : -1 - stops.cell[s];
			const prev = this.stLoadPrev.get(key) ?? 0;
			const capS = mode === 1 ? STOP_CAP_BUS : mode === 2 ? STOP_CAP_SUBWAY : STOP_CAP_TRAIN;
			const base = mode === 1 ? 5 : mode === 2 ? WAIT_SUBWAY : 6;
			const r = prev / capS;
			this.stWait[s] = base * Math.min(4, 1 + r * r);
		}
		this.stAttS[stops.n] = an;
		const BS = 8;
		const nb = Math.ceil(N / BS);
		this.binN = nb;
		this.stopBinStart = growI32(this.stopBinStart, nb * nb + 1);
		this.stopBinStart.fill(0, 0, nb * nb + 1);
		this.stopBins = growI32(this.stopBins, stops.n + 1);
		for (let s = 0; s < stops.n; s++) {
			const c = stops.cell[s], x = c % N, z = (c - x) / N;
			this.stopBinStart[(z / BS | 0) * nb + (x / BS | 0) + 1]++;
		}
		for (let i = 0; i < nb * nb; i++) this.stopBinStart[i + 1] += this.stopBinStart[i];
		const fillp = new Int32Array(nb * nb);
		for (let s = 0; s < stops.n; s++) {
			const c = stops.cell[s], x = c % N;
			const bi = ((c - x) / N / BS | 0) * nb + (x / BS | 0);
			this.stopBins[this.stopBinStart[bi] + fillp[bi]++] = s;
		}
		const trFrom = [], trTo = [], trCost = [];
		for (let s = 0; s < stops.n; s++) {
			if (this.stAttC[s] === 0) continue;
			const c = stops.cell[s], x = c % N, z = (c - x) / N;
			const cnt = this.nearStops(N, x, z, 5);
			for (let q = 0; q < cnt; q++) {
				const s2 = this.nsIdx[q], d = this.nsDist[q];
				if (s2 <= s || stops.mode[s2] === stops.mode[s] || this.stAttC[s2] === 0) continue;
				const a = this.stAtt[this.stAttS[s]], b = this.stAtt[this.stAttS[s2]];
				const cost = d * STOP_WALK_TIME_PER_CELL + .5 * (this.stWait[s] + this.stWait[s2]);
				trFrom.push(a, b);
				trTo.push(b, a);
				trCost.push(cost, cost);
			}
		}
		const trStart = new Int32Array(total + 1);
		for (const f of trFrom) trStart[f + 1]++;
		for (let i = 0; i < total; i++) trStart[i + 1] += trStart[i];
		const to = new Int32Array(trFrom.length), cost = new Float32Array(trFrom.length);
		const fp = new Int32Array(total);
		for (let e = 0; e < trFrom.length; e++) {
			const f = trFrom[e];
			const p = trStart[f] + fp[f]++;
			to[p] = trTo[e];
			cost[p] = trCost[e];
		}
		const busTime = new Float32Array(nR);
		for (let v = 0; v < nR; v++) busTime[v] = this.nodeTime[v] * BUS_TIME_FACTOR;
		this.tnet = {
			nR,
			nRail,
			nSub,
			total,
			roadAdj: g.rev,
			busTime,
			railAdj: rail.adj,
			subAdj: sub.adj,
			railTime: NET_TIME[6],
			subTime: SUBWAY_TIME,
			trStart,
			trTo: to,
			trCost: cost
		};
		this.tAcc = growF32(this.tAcc, total);
	}
	/** stops within radius R of (x,z) -> this.nsIdx / this.nsDist (returns count; no allocation) */
	nearStops(N, x, z, R) {
		const BS = 8, nb = this.binN;
		const bx0 = Math.max(0, (x - R) / BS | 0), bx1 = Math.min(nb - 1, (x + R) / BS | 0);
		const bz0 = Math.max(0, (z - R) / BS | 0), bz1 = Math.min(nb - 1, (z + R) / BS | 0);
		const stops = this.stops;
		const R2 = R * R;
		let c = 0;
		for (let bz = bz0; bz <= bz1; bz++) for (let bx = bx0; bx <= bx1; bx++) {
			const bi = bz * nb + bx;
			for (let p = this.stopBinStart[bi], p1 = this.stopBinStart[bi + 1]; p < p1; p++) {
				const s = this.stopBins[p];
				const cell = stops.cell[s], sx = cell % N, sz = (cell - sx) / N;
				const dx = sx - x, dz = sz - z;
				const d2 = dx * dx + dz * dz;
				if (d2 > R2) continue;
				if (c >= this.nsIdx.length) {
					const a = new Int32Array(this.nsIdx.length * 2);
					a.set(this.nsIdx);
					this.nsIdx = a;
					const b = new Float32Array(this.nsDist.length * 2);
					b.set(this.nsDist);
					this.nsDist = b;
				}
				this.nsIdx[c] = s;
				this.nsDist[c] = Math.sqrt(d2);
				c++;
			}
		}
		return c;
	}
	commute() {
		const seeds = this.seeds;
		seeds.clear();
		for (let j = 0; j < this.jN; j++) {
			this.jPen[j] = this.jPrice[j] + (this.jBid[j] >= 0 ? this.rand() * 12 : this.rand() * 12 * .5);
			const label = this.jBase[j] + this.jPen[j];
			for (let e = this.jEntS[j], e1 = e + this.jEntC[j]; e < e1; e++) seeds.push(this.ent[e], label, j);
		}
		roadSearch(this.road, this.road.rev, this.nodeTime, this.SA, this.heap, seeds, 196);
	}
	transit() {
		const T = this.tnet;
		const S = this.ST;
		if (this.stops.n === 0) {
			S.reset(T.total);
			return;
		}
		const seeds = this.seeds;
		seeds.clear();
		const N = this.road.N;
		for (let j = 0; j < this.jN; j++) {
			const label0 = this.jBase[j] + this.jPen[j];
			if (this.jRailNode[j] >= 0) {
				seeds.push(T.nR + this.jRailNode[j], label0, j);
				continue;
			}
			if (this.jBid[j] < 0) continue;
			const c = this.jCell[j], x = c % N, z = (c - x) / N;
			const half = this.jHalf[j];
			const cnt = this.nearStops(N, x, z, 5 + half);
			for (let q = 0; q < cnt; q++) {
				const s = this.nsIdx[q];
				const walk = Math.max(0, this.nsDist[q] - half) * STOP_WALK_TIME_PER_CELL;
				for (let a = this.stAttS[s], a1 = a + this.stAttC[s]; a < a1; a++) seeds.push(this.stAtt[a], label0 + walk, j);
			}
		}
		transitSearch(T, S, this.heap, seeds, 196);
	}
	modeChoice() {
		const SA = this.SA, ST = this.ST, T = this.tnet;
		const distA = SA.dist, srcA = SA.src, hopsA = SA.hops, doneA = SA.done;
		const distT = ST.dist, srcT = ST.src, doneT = ST.done;
		const N = this.road.N;
		const ords = this.ords;
		const carpool = ords.has("carpool"), shuttle = ords.has("commuterShuttle");
		const carPcu = 1 / CAR_OCCUPANCY * (carpool ? .88 : 1) * (shuttle ? .94 : 1);
		const trBonus = shuttle ? .4 : 0;
		const acc = this.acc, tAcc = this.tAcc;
		const nR = this.road.n;
		acc.fill(0, 0, nR);
		tAcc.fill(0, 0, T.total);
		const jLoad = this.jLoad, jPrice = this.jPrice, jPen = this.jPen, jBase = this.jBase, jTimeSum = this.jTimeSum;
		let tripsC = 0, tripsT = 0, tripsW = 0, cSum = 0, cW = 0;
		const hasStops = this.stops.n > 0;
		for (let o = 0; o < this.oN; o++) {
			const W = this.oW[o];
			let best = -1, bd = Infinity;
			for (let e = this.oEntS[o], e1 = e + this.oEntC[o]; e < e1; e++) {
				const v = this.ent[e];
				if (doneA[v] === 1 && distA[v] < bd) {
					bd = distA[v];
					best = v;
				}
			}
			let carG = Infinity, carT = Infinity, walkT = Infinity, jA = -1;
			if (best >= 0) {
				jA = srcA[best];
				carT = 4 + bd - jPen[jA];
				carG = 4 + bd;
				if (carT > 110) {
					carT = Infinity;
					carG = Infinity;
				} else if (jBase[jA] === 0 && hopsA[best] <= 15) walkT = (hopsA[best] + 1) * WALK_TIME_PER_CELL;
			}
			let trG = Infinity, trT = Infinity, board = -1, boardStop = -1, jT = -1;
			if (hasStops) {
				const c = this.oCell[o], x = c % N, z = (c - x) / N;
				const half = this.oHalf[o];
				const cnt = this.nearStops(N, x, z, 5 + half);
				for (let q = 0; q < cnt; q++) {
					const s = this.nsIdx[q];
					const walk = Math.max(0, this.nsDist[q] - half) * STOP_WALK_TIME_PER_CELL + this.stWait[s];
					for (let a = this.stAttS[s], a1 = a + this.stAttC[s]; a < a1; a++) {
						const v = this.stAtt[a];
						if (doneT[v] !== 1) continue;
						const gcost = walk + distT[v];
						if (gcost < trG) {
							trG = gcost;
							board = v;
							boardStop = s;
						}
					}
				}
				if (board >= 0) {
					jT = srcT[board];
					trT = trG - jPen[jT];
					if (trT > 110) {
						trT = Infinity;
						trG = Infinity;
						board = -1;
						jT = -1;
					}
				}
			}
			const wl = this.oWealth[o] - 1;
			const uc = carG < Infinity ? -.13 * carG + CAR_BIAS[wl] : -Infinity;
			const ut = trG < Infinity ? -.13 * trG + TRANSIT_BIAS[wl] + trBonus : -Infinity;
			const uw = walkT < Infinity ? -.13 * (walkT + (jA >= 0 ? jPen[jA] : 0)) + WALK_BIAS : -Infinity;
			const um = Math.max(uc, ut, uw);
			let sc = 0, st = 0, sw = 0;
			if (um > -Infinity) {
				const ec = uc > -Infinity ? Math.exp(uc - um) : 0;
				const et = ut > -Infinity ? Math.exp(ut - um) : 0;
				const ew = uw > -Infinity ? Math.exp(uw - um) : 0;
				const tot = ec + et + ew;
				sc = ec / tot;
				st = et / tot;
				sw = ew / tot;
			}
			this.oShC[o] = sc;
			this.oShT[o] = st;
			this.oShW[o] = sw;
			this.oCarNode[o] = best;
			this.oBoard[o] = board;
			this.oJobA[o] = jA;
			this.oJobT[o] = jT;
			const time = sc * (sc > 0 ? carT : 0) + st * (st > 0 ? trT : 0) + sw * (sw > 0 ? walkT : 0);
			this.oTime[o] = sc + st + sw > 0 ? time : 0;
			if (W <= 0) continue;
			if (sc > 0) {
				acc[best] += W * sc * carPcu;
				tripsC += W * sc;
			}
			if (sw > 0) tripsW += W * sw;
			if (jA >= 0) {
				jLoad[jA] += W * (sc + sw);
				jTimeSum[jA] += W * (sc * (sc > 0 ? carT : 0) + sw * (sw > 0 ? walkT : 0));
			}
			if (st > 0 && board >= 0) {
				tAcc[board] += W * st;
				tripsT += W * st;
				this.stLoad[boardStop] += W * st;
				jLoad[jT] += W * st;
				jTimeSum[jT] += W * st * trT;
			}
			if (sc + st + sw > 0) {
				cSum += W * this.oTime[o];
				cW += W;
			}
		}
		const volNew = this.volNew;
		accumulate(SA, acc);
		for (let k = 0; k < SA.settled; k++) {
			const v = SA.order[k];
			volNew[v] += acc[v];
		}
		const nodeStop = this.nodeStop, stLoad = this.stLoad;
		accumulate(ST, tAcc, (_j, f, node) => {
			const s = nodeStop[node];
			if (s >= 0) stLoad[s] += f;
		});
		const nRail = T.nRail;
		for (let k = 0; k < ST.settled; k++) {
			const v = ST.order[k];
			const f = tAcc[v];
			if (f === 0) continue;
			if (v < nR) volNew[v] += f * BUS_PCU_PER_RIDER;
			else if (v < nR + nRail) this.railNew[v - nR] += f;
			else this.subNew[v - nR - nRail] += f;
		}
		for (let o = 0; o < this.oN; o++) {
			let e = 0;
			const jA = this.oJobA[o], jT = this.oJobT[o];
			if (jA >= 0) e += (this.oShC[o] + this.oShW[o]) * Math.min(1, this.jSlots[jA] / Math.max(1e-6, jLoad[jA]));
			if (jT >= 0) e += this.oShT[o] * Math.min(1, this.jSlots[jT] / Math.max(1e-6, jLoad[jT]));
			this.oEmp[o] = e;
		}
		for (let j = 0; j < this.jN; j++) {
			const slots = this.jSlots[j];
			const ratio = jLoad[j] / Math.max(1, slots);
			let p = jPrice[j];
			if (ratio > 1) p += 5 * Math.min(2, ratio - 1);
			else p -= PRICE_DOWN * (1 - ratio);
			p = p < 0 ? 0 : p > 70 ? 70 : p;
			const bid = this.jBid[j];
			if (bid >= 0) this.priceById[bid] = p;
			else this.connPrice[this.jCell[j]] = p;
		}
		this.tripsCar = tripsC;
		this.tripsTransit = tripsT;
		this.tripsWalk = tripsW;
		this.commuteSum = cSum;
		this.commuteW = cW;
	}
	inbound() {
		const S = this.SB;
		const seeds = this.seeds;
		seeds.clear();
		const g = this.road;
		const conns = [];
		for (let j = this.jB; j < this.jN; j++) {
			if (this.jEntC[j] === 0) continue;
			const node = this.ent[this.jEntS[j]];
			seeds.push(node, 16, conns.length);
			conns.push(j);
		}
		this.tripsInbound = 0;
		if (seeds.n === 0) return;
		roadSearch(g, g.fwd, this.nodeTime, S, this.heap, seeds, 106);
		const dist = S.dist, src = S.src, done = S.done;
		const desire = new Float32Array(this.jB);
		const bestNode = new Int32Array(this.jB).fill(-1);
		const connSum = new Float64Array(conns.length);
		for (let j = 0; j < this.jB; j++) {
			const spare = this.jSlots[j] - Math.min(this.jSlots[j], this.jLoad[j]);
			if (spare <= 0) continue;
			let bd = Infinity, bn = -1;
			for (let e = this.jEntS[j], e1 = e + this.jEntC[j]; e < e1; e++) {
				const v = this.ent[e];
				if (done[v] === 1 && dist[v] < bd) {
					bd = dist[v];
					bn = v;
				}
			}
			if (bn < 0) continue;
			const f = Math.max(.2, Math.min(1, 1.3 - bd / 60));
			desire[j] = spare * REGIONAL_FILL * f;
			bestNode[j] = bn;
			connSum[src[bn]] += desire[j];
		}
		const scale = new Float32Array(conns.length);
		let capSum = 0;
		for (let k = 0; k < conns.length; k++) capSum += CONNECTION_WORKERS[this.jConnType[conns[k]]] * this.growth;
		const capMul = capSum > this.regionWorkerCap ? this.regionWorkerCap / capSum : 1;
		for (let k = 0; k < conns.length; k++) {
			const j = conns[k];
			const capW = CONNECTION_WORKERS[this.jConnType[j]] * this.growth * capMul;
			scale[k] = connSum[k] > capW ? capW / connSum[k] : 1;
		}
		const acc = this.acc;
		acc.fill(0, 0, g.n);
		const carPcu = 1 / CAR_OCCUPANCY;
		let tot = 0;
		const cand = [];
		for (let j = 0; j < this.jB; j++) {
			const bn = bestNode[j];
			if (bn < 0) continue;
			const inflow = desire[j] * scale[src[bn]];
			this.jInbound[j] = inflow;
			acc[bn] += inflow * carPcu;
			tot += inflow;
			if (inflow > 0) cand.push(j);
		}
		accumulate(S, acc);
		for (let k = 0; k < S.settled; k++) {
			const v = S.order[k];
			this.volNew[v] += acc[v];
		}
		this.tripsInbound = tot;
		const K = Math.min(12, cand.length);
		for (let q = 0; q < K; q++) {
			const j = cand[Math.floor(this.rand() * cand.length)];
			const path = this.tracePath(S, bestNode[j], (v) => g.cellOf[v], true);
			if (path.length >= 2) this.pendingRoutes.push({
				cells: path,
				kind: "car",
				weight: tot / Math.max(1, K)
			});
		}
	}
	shopping() {
		const S = this.SB;
		const seeds = this.seeds;
		seeds.clear();
		const g = this.road;
		for (let s = 0; s < this.sN; s++) for (let e = this.sEntS[s], e1 = e + this.sEntC[s]; e < e1; e++) seeds.push(this.ent[e], 0, s);
		this.tripsShop = 0;
		if (seeds.n === 0) return;
		roadSearch(g, g.rev, this.nodeTime, S, this.heap, seeds, 45);
		const dist = S.dist, src = S.src, done = S.done;
		const acc = this.acc;
		acc.fill(0, 0, g.n);
		const pcu = SHOP_PCU_WEIGHT / CAR_OCCUPANCY;
		let tot = 0;
		for (let o = 0; o < this.oN; o++) {
			let bd = Infinity, bn = -1;
			for (let e = this.oEntS[o], e1 = e + this.oEntC[o]; e < e1; e++) {
				const v = this.ent[e];
				if (done[v] === 1 && dist[v] < bd) {
					bd = dist[v];
					bn = v;
				}
			}
			if (bn < 0) continue;
			const trips = this.oPop[o] * SHOP_TRIPS_PER_RES * Math.exp(-Math.max(0, bd - 8) / 20);
			const carShare = this.oShC[o] + this.oShW[o] + this.oShT[o] > 0 ? this.oShC[o] : .7;
			const walkish = bd < 3 ? .6 : 0;
			acc[bn] += trips * carShare * (1 - walkish) * pcu;
			this.sLoad[src[bn]] += trips;
			tot += trips;
		}
		accumulate(S, acc);
		for (let k = 0; k < S.settled; k++) {
			const v = S.order[k];
			this.volNew[v] += acc[v];
		}
		this.tripsShop = tot;
	}
	freight() {
		const S = this.SB;
		const seeds = this.seeds;
		seeds.clear();
		const g = this.road;
		for (let k = 0; k < this.kN; k++) for (let e = this.kEntS[k], e1 = e + this.kEntC[k]; e < e1; e++) seeds.push(this.ent[e], this.kLabel[k], k);
		this.tripsFreight = 0;
		if (seeds.n === 0) {
			for (let f = 0; f < this.fN; f++) this.freightById[this.fBid[f]] = .15;
			return;
		}
		roadSearch(g, g.rev, this.nodeTime, S, this.heap, seeds, 150);
		const dist = S.dist, done = S.done;
		const acc = this.acc;
		acc.fill(0, 0, g.n);
		let tot = 0;
		const cand = [];
		const candNode = [];
		for (let f = 0; f < this.fN; f++) {
			let bd = Infinity, bn = -1;
			for (let e = this.fEntS[f], e1 = e + this.fEntC[f]; e < e1; e++) {
				const v = this.ent[e];
				if (done[v] === 1 && dist[v] < bd) {
					bd = dist[v];
					bn = v;
				}
			}
			const bid = this.fBid[f];
			if (bn < 0) {
				this.freightById[bid] = .15;
				continue;
			}
			this.freightById[bid] = Math.max(.3, Math.min(1, 1.25 - bd / 60));
			const trucks = this.fTrucks[f];
			acc[bn] += trucks * TRUCK_PCU;
			tot += trucks;
			cand.push(f);
			candNode.push(bn);
		}
		accumulate(S, acc);
		for (let k = 0; k < S.settled; k++) {
			const v = S.order[k];
			this.volNew[v] += acc[v];
		}
		this.tripsFreight = tot;
		const K = Math.min(20, cand.length);
		if (K > 0) {
			const cum = new Float64Array(cand.length);
			let s = 0;
			for (let q = 0; q < cand.length; q++) {
				s += this.fTrucks[cand[q]];
				cum[q] = s;
			}
			for (let q = 0; q < K; q++) {
				const idx = lowerBound(cum, this.rand() * s);
				const path = this.tracePath(S, candNode[idx], (v) => g.cellOf[v], false);
				if (path.length >= 2) this.pendingRoutes.push({
					cells: path,
					kind: "truck",
					weight: tot / K
				});
			}
		}
	}
	finalize(sim) {
		const st = sim.state;
		const g = this.road;
		const n = g.n;
		const C = st.cells;
		const net = st.network;
		const traffic = st.traffic, congestion = st.congestion;
		const alpha = Math.max(MSA_MIN_ALPHA, 1 / (this.iter + 1));
		this.iter++;
		const blended = this.acc;
		for (let v = 0; v < n; v++) {
			const c = g.cellOf[v];
			blended[v] = traffic[c] * (1 - alpha) + this.volNew[v] * alpha;
		}
		const railN = this.rail.n;
		for (let v = 0; v < railN; v++) this.railNew[v] = traffic[this.rail.cellOf[v]] * (1 - alpha) + this.railNew[v] * alpha;
		traffic.fill(0);
		congestion.fill(0);
		let congSum = 0, congN = 0;
		for (let v = 0; v < n; v++) {
			const c = g.cellOf[v];
			if (!(net[c] >= 1 && net[c] <= 5)) continue;
			const vol = blended[v];
			traffic[c] = vol;
			const r = vol / g.cap[v];
			congestion[c] = r;
			if (vol > 1) {
				congSum += r > 1 ? 1 : r;
				congN++;
			}
		}
		for (let v = 0; v < this.rail.n; v++) {
			const c = this.rail.cellOf[v];
			if (net[c] !== 6) continue;
			traffic[c] = this.railNew[v];
			congestion[c] = traffic[c] / NET_CAPACITY[6];
		}
		if (this.subwayRiders.length !== C) this.subwayRiders = new Float32Array(C);
		this.subwayRiders.fill(0);
		for (let v = 0; v < this.subway.n; v++) this.subwayRiders[this.subway.cellOf[v]] = this.subNew[v];
		const commute = st.commute;
		commute.fill(0);
		const changed = [];
		for (let o = 0; o < this.oN; o++) {
			const bid = this.oBid[o];
			const b = st.buildings.get(bid);
			if (!b) continue;
			const prevA = this.accessById[bid];
			const emp = prevA >= 0 && this.cycles > 0 ? prevA + (this.oEmp[o] - prevA) * RESULT_SMOOTH : this.oEmp[o];
			const prevT = this.commuteById[bid];
			const t = prevT > 0 && this.oTime[o] > 0 ? prevT + (this.oTime[o] - prevT) * RESULT_SMOOTH : this.oTime[o];
			this.accessById[bid] = emp;
			this.commuteById[bid] = t;
			this.reachedById[bid] = this.oW[o] * emp;
			const sc = this.oShC[o], stt = this.oShT[o], sw = this.oShW[o];
			this.modeById[bid] = sc + stt + sw <= 0 ? 0 : sc >= stt && sc >= sw ? 1 : stt >= sw ? 2 : 3;
			for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
				const i = z * st.size + x;
				if (st.building[i] === bid) commute[i] = t;
			}
			const noJobs = b.pop > 0 && emp < .35;
			let f = setFlagQuiet(b, BF.NoJobs, noJobs);
			const cn = this.oCarNode[o];
			const cong = cn >= 0 && cn < n ? congestion[g.cellOf[cn]] : 0;
			f = setFlagQuiet(b, BF.Congested, cong > 1) || f;
			if (f) changed.push(b);
		}
		for (let j = 0; j < this.jB; j++) {
			const bid = this.jBid[j];
			const b = st.buildings.get(bid);
			if (!b) continue;
			const slots = this.jSlots[j];
			const arriving = Math.min(this.jLoad[j], slots) + this.jInbound[j];
			const fill = Math.min(1, arriving / Math.max(1, slots));
			const prevF = this.jobFillById[bid];
			this.jobFillById[bid] = prevF >= 0 && this.cycles > 0 ? prevF + (fill - prevF) * RESULT_SMOOTH : fill;
			this.reachedById[bid] = arriving;
			this.commuteById[bid] = this.jLoad[j] > 0 ? this.jTimeSum[j] / this.jLoad[j] : this.jInbound[j] > 0 ? 26 : 0;
			this.modeById[bid] = arriving > 0 ? 1 : 0;
			let cong = 0;
			for (let e = this.jEntS[j], e1 = e + this.jEntC[j]; e < e1; e++) {
				const c = congestion[g.cellOf[this.ent[e]]];
				if (c > cong) cong = c;
			}
			if (setFlagQuiet(b, BF.Congested, cong > 1.1)) changed.push(b);
		}
		for (let s = 0; s < this.sN; s++) this.customersById[this.sBid[s]] = this.sLoad[s];
		for (const b of changed) sim.events.emit("buildingChanged", b);
		this.stLoadPrev.clear();
		for (let s = 0; s < this.stops.n; s++) {
			const bid = this.stops.bid[s];
			this.stLoadPrev.set(bid >= 0 ? bid : -1 - this.stops.cell[s], this.stLoad[s]);
		}
		const stats = st.stats;
		stats.tripsCar = Math.round(this.tripsCar);
		stats.tripsTransit = Math.round(this.tripsTransit);
		stats.tripsWalk = Math.round(this.tripsWalk);
		stats.avgCommute = this.commuteW > 0 ? this.commuteSum / this.commuteW : 0;
		stats.avgTraffic = congN > 0 ? congSum / congN : 0;
		this.buildSampleRoutes(st);
		this.serviceRoutes = this.serviceRoutes.filter((s) => s.until >= st.day);
		this.cycles++;
		sim.events.emit("layerUpdated", "traffic");
	}
	tracePath(S, start, cellOf, reverse, stopAt) {
		const out = [];
		let v = start;
		let guard = 0;
		while (v >= 0 && guard++ < 4096) {
			if (stopAt && out.length > 0 && stopAt(v)) break;
			out.push(cellOf(v));
			v = S.next[v];
		}
		if (reverse) out.reverse();
		return Uint32Array.from(out);
	}
	buildSampleRoutes(st) {
		const g = this.road;
		const routes = [];
		const K = 60;
		if (this.oN > 0 && this.tripsCar > 0) {
			const cum = new Float64Array(this.oN);
			let s = 0;
			for (let o = 0; o < this.oN; o++) {
				s += this.oW[o] * this.oShC[o];
				cum[o] = s;
			}
			const k = Math.min(K, this.oN);
			for (let q = 0; q < k && s > 0; q++) {
				const o = lowerBound(cum, this.rand() * s);
				const start = this.oCarNode[o];
				if (start < 0 || this.SA.done[start] !== 1) continue;
				const path = this.tracePath(this.SA, start, (v) => g.cellOf[v], false);
				if (path.length >= 2) routes.push({
					cells: path,
					kind: "car",
					weight: this.tripsCar / k
				});
			}
		}
		for (const r of this.pendingRoutes) routes.push(r);
		const T = this.tnet;
		if (T && this.tripsTransit > 0) {
			const cum = new Float64Array(this.oN);
			let s = 0;
			for (let o = 0; o < this.oN; o++) {
				s += this.oBoard[o] >= 0 ? this.oW[o] * this.oShT[o] : 0;
				cum[o] = s;
			}
			const k = Math.min(24, this.oN);
			const railCell = (v) => this.rail.cellOf[v - T.nR];
			for (let q = 0; q < k && s > 0; q++) {
				const o = lowerBound(cum, this.rand() * s);
				let v = this.oBoard[o];
				let guard = 0;
				let seg = [];
				let segKind = -1;
				const flush = () => {
					if (seg.length >= 3 && (segKind === 0 || segKind === 1)) routes.push({
						cells: Uint32Array.from(seg),
						kind: segKind === 0 ? "bus" : "train",
						weight: this.tripsTransit / k
					});
					seg = [];
				};
				while (v >= 0 && guard++ < 4096) {
					const kind = v < T.nR ? 0 : v < T.nR + T.nRail ? 1 : 2;
					if (kind !== segKind) {
						flush();
						segKind = kind;
					}
					if (kind === 0) seg.push(g.cellOf[v]);
					else if (kind === 1) seg.push(railCell(v));
					else seg.push(this.subway.cellOf[v - T.nR - T.nRail]);
					v = this.ST.next[v];
				}
				flush();
			}
		}
		this.freightTrainRoutes(st, routes);
		this.patrolRoutes(st, routes);
		this.routes = routes;
		this.pendingRoutes = [];
	}
	freightTrainRoutes(st, routes) {
		const rail = this.rail;
		if (rail.n === 0) return;
		const targets = /* @__PURE__ */ new Set();
		for (const c of this.conns) if (c.type === 6) {
			const rn = rail.nodeOfCell[c.cell];
			if (rn >= 0) targets.add(rn);
		}
		const tmp = /* @__PURE__ */ new Int32Array(4);
		let count = 0;
		for (const b of st.buildings.values()) {
			if (count >= 4) break;
			const inf = infoOf(st, b);
			if (inf.transit !== 4 && inf.transit !== 3) continue;
			if (!isFunctional(b)) continue;
			if (perimeterNodes(rail.nodeOfCell, st.size, b, tmp, 0, 4) === 0) continue;
			const path = this.railBfs(tmp[0], targets, inf.transit === 3);
			if (path && path.length >= 3) {
				routes.push({
					cells: path,
					kind: "train",
					weight: inf.transit === 4 ? 20 : 40
				});
				count++;
			}
		}
	}
	/** BFS on rail from node a to any node in targets (or, if toStations, to another station's rail node / longest reach) */
	railBfs(a, targets, _passenger) {
		const rail = this.rail;
		const n = rail.n;
		const par = new Int32Array(n).fill(-2);
		const q = new Int32Array(n);
		let qh = 0, qt = 0;
		q[qt++] = a;
		par[a] = -1;
		let hit = -1;
		let last = a;
		while (qh < qt) {
			const u = q[qh++];
			last = u;
			if (u !== a && targets.has(u)) {
				hit = u;
				break;
			}
			for (let k = 0; k < 4; k++) {
				const v = rail.adj[u * 4 + k];
				if (v < 0 || par[v] !== -2) continue;
				par[v] = u;
				q[qt++] = v;
			}
		}
		const end = hit >= 0 ? hit : last;
		if (end === a) return null;
		const out = [];
		for (let v = end; v >= 0; v = par[v]) out.push(rail.cellOf[v]);
		out.reverse();
		return Uint32Array.from(out);
	}
	patrolRoutes(st, routes) {
		const g = this.road;
		if (g.n === 0) return;
		const tmp = /* @__PURE__ */ new Int32Array(4);
		let count = 0;
		for (const b of st.buildings.values()) {
			if (count >= 10) break;
			const inf = infoOf(st, b);
			if (!(inf.cov === 0 || inf.garbageCap > 0 || inf.cov === 2) || !isFunctional(b)) continue;
			if (perimeterNodes(g.nodeOfCell, st.size, b, tmp, 0, 1) === 0) continue;
			let v = tmp[0];
			let prev = -1;
			const cells = [g.cellOf[v]];
			for (let s = 0; s < 48; s++) {
				let choices = 0;
				let pick = -1;
				for (let k = 0; k < 4; k++) {
					const w = g.fwd[v * 4 + k];
					if (w < 0 || w === prev) continue;
					choices++;
					if (this.rand() * choices < 1) pick = w;
				}
				if (pick < 0) pick = prev;
				if (pick < 0) break;
				prev = v;
				v = pick;
				cells.push(g.cellOf[v]);
			}
			if (cells.length >= 4) {
				routes.push({
					cells: Uint32Array.from(cells),
					kind: "service",
					weight: 2
				});
				count++;
			}
		}
	}
};
function lowerBound(cum, x) {
	let lo = 0, hi = cum.length - 1;
	while (lo < hi) {
		const mid = lo + hi >> 1;
		if (cum[mid] < x) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}
//#endregion
//#region src/sim/infra/blur.ts
/**
* Separable box blurs on N x N float grids (running sums, zero outside the map, no allocation).
* Three box passes of radius r approximate a Gaussian with sigma^2 = r * (r + 1).
*/
/** horizontal box blur src -> dst (mass preserving, zero boundary) */
function boxH(src, dst, N, r) {
	const inv = 1 / (2 * r + 1);
	for (let z = 0; z < N; z++) {
		const row = z * N;
		let s = 0;
		for (let x = 0; x < r && x < N; x++) s += src[row + x];
		for (let x = 0; x < N; x++) {
			if (x + r < N) s += src[row + x + r];
			dst[row + x] = s * inv;
			if (x - r >= 0) s -= src[row + x - r];
		}
	}
}
/** vertical box blur src -> dst (row-wise running column sums: cache friendly) */
let colSum = /* @__PURE__ */ new Float64Array(0);
function boxV(src, dst, N, r) {
	const inv = 1 / (2 * r + 1);
	if (colSum.length < N) colSum = new Float64Array(N);
	const cs = colSum;
	cs.fill(0, 0, N);
	for (let z = 0; z < r && z < N; z++) {
		const row = z * N;
		for (let x = 0; x < N; x++) cs[x] += src[row + x];
	}
	for (let z = 0; z < N; z++) {
		const row = z * N;
		if (z + r < N) {
			const add = (z + r) * N;
			for (let x = 0; x < N; x++) cs[x] += src[add + x];
		}
		for (let x = 0; x < N; x++) dst[row + x] = cs[x] * inv;
		if (z - r >= 0) {
			const sub = (z - r) * N;
			for (let x = 0; x < N; x++) cs[x] -= src[sub + x];
		}
	}
}
/** in-place ~Gaussian blur of `a` (3 box passes of radius r), tmp = scratch of same size */
function blur3(a, tmp, N, r) {
	if (r <= 0) return;
	for (let p = 0; p < 3; p++) {
		boxH(a, tmp, N, r);
		boxV(tmp, a, N, r);
	}
}
/** sigma^2 of blur3 with radius r */
function blurSigma2(r) {
	return r * (r + 1);
}
/** shift a field by a fractional offset (dx, dz) cells with bilinear sampling: dst(x,z) = src(x - dx, z - dz) */
function shiftField(src, dst, N, dx, dz) {
	const fx = Math.floor(dx), fz = Math.floor(dz);
	const tx = dx - fx, tz = dz - fz;
	const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz;
	for (let z = 0; z < N; z++) {
		const sz0 = z - fz, sz1 = z - fz - 1;
		for (let x = 0; x < N; x++) {
			const sx0 = x - fx, sx1 = x - fx - 1;
			let v = 0;
			if (sz0 >= 0 && sz0 < N) {
				if (sx0 >= 0 && sx0 < N) v += w00 * src[sz0 * N + sx0];
				if (sx1 >= 0 && sx1 < N) v += w10 * src[sz0 * N + sx1];
			}
			if (sz1 >= 0 && sz1 < N) {
				if (sx0 >= 0 && sx0 < N) v += w01 * src[sz1 * N + sx0];
				if (sx1 >= 0 && sx1 < N) v += w11 * src[sz1 * N + sx1];
			}
			dst[z * N + x] = v;
		}
	}
}
/**
* Blur at reduced resolution: downsample `src` (N x N) by `f` (block sums), blur3 with radius r at coarse
* resolution, upsample bilinearly and ADD gain * density into `acc`. Effective fine sigma^2 = f^2 * r(r+1).
* `coarse` / `coarseTmp` must hold (ceil(N/f))^2 floats.
*/
let upKey = "";
let upI0 = /* @__PURE__ */ new Int32Array(0);
let upI1 = /* @__PURE__ */ new Int32Array(0);
let upT = /* @__PURE__ */ new Float32Array(0);
let upRow = /* @__PURE__ */ new Float32Array(0);
function upTables(N, f, M) {
	const key = N + ":" + f;
	if (key === upKey) return;
	upKey = key;
	upI0 = new Int32Array(N);
	upI1 = new Int32Array(N);
	upT = new Float32Array(N);
	for (let x = 0; x < N; x++) {
		const fx = (x + .5) / f - .5;
		let x0 = Math.floor(fx);
		const t = fx - x0;
		let x1 = x0 + 1;
		if (x0 < 0) x0 = 0;
		if (x1 >= M) x1 = M - 1;
		upI0[x] = x0;
		upI1[x] = x1;
		upT[x] = t;
	}
	if (upRow.length < M) upRow = new Float32Array(M);
}
function blurDownAdd(src, acc, N, f, r, gain, coarse, coarseTmp) {
	const M = Math.ceil(N / f);
	coarse.fill(0, 0, M * M);
	const sh = f === 2 ? 1 : f === 4 ? 2 : f === 8 ? 3 : -1;
	for (let z = 0; z < N; z++) {
		const cz = sh >= 0 ? z >> sh : z / f | 0;
		const row = z * N, crow = cz * M;
		if (sh >= 0) for (let x = 0; x < N; x++) {
			const v = src[row + x];
			if (v !== 0) coarse[crow + (x >> sh)] += v;
		}
		else for (let x = 0; x < N; x++) {
			const v = src[row + x];
			if (v !== 0) coarse[crow + (x / f | 0)] += v;
		}
	}
	blur3(coarse, coarseTmp, M, r);
	const g = gain / (f * f);
	upTables(N, f, M);
	const I0 = upI0, I1 = upI1, T = upT;
	const R = upRow;
	for (let z = 0; z < N; z++) {
		const tz = T[z];
		const r0 = I0[z] * M, r1 = I1[z] * M;
		const a = (1 - tz) * g, b = tz * g;
		for (let m = 0; m < M; m++) R[m] = coarse[r0 + m] * a + coarse[r1 + m] * b;
		const row = z * N;
		for (let x = 0; x < N; x++) {
			const t = T[x];
			const v0 = R[I0[x]];
			acc[row + x] += v0 + (R[I1[x]] - v0) * t;
		}
	}
}
//#endregion
//#region src/sim/infra/pollution.ts
/**
* Pollution system: air, water, noise and garbage (every POLL_PERIOD days, cheap separable blurs).
*
*  AIR    sources: industry by DevType (I-D heavy, I-M medium, I-A small, I-HT ~0; x0.75 with Clean Air ordinance),
*         def.pollution.air (power plants, incinerators ...), traffic volume (x congestion), landfill smell.
*         Emitters are bucketed into small / medium / large radius classes and blurred (3 box passes); the field
*         drifts slightly with a slowly rotating wind; layer = 1 - exp(-field / AIR_K), smoothed over time.
*  WATER  industry + def.pollution.water + sewage (pop, reduced by treatment plant capacity), blurred into ground
*         water; spreads along water bodies by iterative diffusion over water cells (persistent).
*  NOISE  traffic volume, industry, def.pollution.noise (airports, stadiums ...).
*  GARBAGE production per resident / job (recycling ordinance -20 %); collection capacity = landfill zone cells with
*         road access (LANDFILL_CELL_CAP t/month each) + def.garbageCapacity (incinerators, recycling) x funding.
*         When short, buildings farthest (road BFS) from facilities are not collected: state.garbage builds up on
*         their cells -> BF.NoGarbage. stats.garbageProduced / garbageCapacity (tons / month).
*  Flags BF.Polluted (air or water above threshold). stats.avgPollution. Emits layerUpdated('pollution').
*/
const IND_KEYS = [
	"IA",
	"ID",
	"IM",
	"IHT"
];
function radiusClass(r) {
	if (r <= 0) return 1;
	if (r <= 4) return 0;
	if (r <= 9) return 1;
	return 2;
}
var PollutionSystem = class {
	name = "pollution";
	air = [];
	water = /* @__PURE__ */ new Float32Array(0);
	noise = /* @__PURE__ */ new Float32Array(0);
	tmp = /* @__PURE__ */ new Float32Array(0);
	tmp2 = /* @__PURE__ */ new Float32Array(0);
	coarse = /* @__PURE__ */ new Float32Array(0);
	coarseTmp = /* @__PURE__ */ new Float32Array(0);
	waterCells = /* @__PURE__ */ new Int32Array(0);
	waterNb = /* @__PURE__ */ new Int32Array(0);
	nWater = -1;
	waterVersion = -1;
	queue = /* @__PURE__ */ new Int32Array(0);
	visit = /* @__PURE__ */ new Int32Array(0);
	served = /* @__PURE__ */ new Int32Array(1024);
	prodById = /* @__PURE__ */ new Float32Array(1024);
	stamp = 0;
	lastRun = -1e9;
	lastMs = 0;
	unsub = [];
	init(sim) {
		for (const u of this.unsub) u();
		this.unsub = [sim.events.on("terrainChanged", () => this.invalidateWater()), sim.events.on("reset", () => this.invalidateWater())];
		sim.state.systemData.infraVersion = 1;
		this.lastRun = -1e9;
		this.nWater = -1;
		this.compute(sim, true);
	}
	/** stage B pending (noise / water / garbage / flags run the day after the air stage) */
	pendingB = false;
	ordsB = /* @__PURE__ */ new Set();
	jobsUnknownB = false;
	dtMonthsB = 0;
	daily(sim) {
		if (this.pendingB) {
			const t0 = nowMs();
			this.stageB(sim, false);
			this.lastMs = Math.max(this.lastMs, nowMs() - t0);
		} else if (sim.state.day - this.lastRun >= 4) this.stageA(sim, false);
	}
	/** full synchronous update (init / tests) */
	compute(sim, first) {
		const t0 = nowMs();
		this.stageA(sim, first);
		this.stageB(sim, first);
		this.lastMs = nowMs() - t0;
	}
	/** stage A: sources for all layers + air pollution field */
	stageA(sim, first) {
		const t0 = nowMs();
		const st = sim.state;
		const N = st.size, C = st.cells;
		if (this.tmp.length !== C) {
			this.air = [
				new Float32Array(C),
				new Float32Array(C),
				new Float32Array(C)
			];
			this.water = new Float32Array(C);
			this.noise = new Float32Array(C);
			this.tmp = new Float32Array(C);
			this.tmp2 = new Float32Array(C);
			this.queue = new Int32Array(C);
			this.visit = new Int32Array(C);
		}
		const dtMonths = first ? 0 : Math.min(2, (st.day - this.lastRun) / 30);
		this.lastRun = st.day;
		const ords = readOrdinances(st);
		const cleanAir = ords.has("cleanAir") ? .75 : 1;
		const jobsUnknown = detectJobsUnknown(st);
		const air = this.air, water = this.water, noise = this.noise;
		for (const a of air) a.fill(0);
		water.fill(0);
		noise.fill(0);
		let treatCap = 0;
		const util = fundingFactor(st, "utilities");
		for (const b of st.buildings.values()) {
			const inf = infoOf(st, b);
			if (inf.isTreatment && isFunctional(b)) treatCap += (inf.capacity > 0 ? inf.capacity : TREATMENT_DEFAULT_CAP) * Math.min(1, util);
		}
		const pop = Math.max(1, st.stats.population || 0);
		const sewageMul = 1 - .9 * Math.min(1, treatCap / pop);
		for (const b of st.buildings.values()) {
			const inf = infoOf(st, b);
			if (!isFunctional(b) && (b.flags & BF.OnFire) === 0) continue;
			const area = b.w * b.d;
			let a = 0, w = 0, nz = 0;
			let cls = 1;
			if (inf.fam === 3) {
				const k = IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))];
				const j = activeJobs(inf, b, jobsUnknown);
				a = j * AIR_PER_JOB[k] * cleanAir;
				w = j * WATER_POLL_PER_JOB[k];
				nz = j * NOISE_PER_JOB[k];
			} else if (inf.fam === 1) w = b.pop * SEWAGE_PER_RES * sewageMul;
			if (inf.air > 0 || inf.waterPoll > 0 || inf.noise > 0) {
				a += inf.air * (inf.fam === 4 ? 1 : cleanAir) * (inf.powerOut > 0 ? cleanAir : 1);
				w += inf.waterPoll;
				nz += inf.noise;
				cls = radiusClass(inf.pollRadius);
			}
			if (b.flags & BF.OnFire) a += 2 * area;
			if (a === 0 && w === 0 && nz === 0) continue;
			const ia = a / area, iw = w / area, inz = nz / area;
			const A = air[cls];
			for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
				if (x < 0 || z < 0 || x >= N || z >= N) continue;
				const i = z * N + x;
				A[i] += ia;
				water[i] += iw;
				noise[i] += inz;
			}
		}
		const traffic = st.traffic, cong = st.congestion, net = st.network, zone = st.zone;
		const A0 = air[0];
		for (let i = 0; i < C; i++) {
			const t = traffic[i];
			if (t > 0 && net[i] !== 6 && net[i] !== 0) {
				const c = cong[i];
				A0[i] += t * AIR_PER_TRIP * (1 + Math.min(2, c)) * cleanAir;
				noise[i] += t * NOISE_PER_TRIP;
			} else if (t > 0 && net[i] === 6) noise[i] += t * NOISE_PER_TRIP * .2;
			if (zone[i] === 10 && st.building[i] < 0) A0[i] += LANDFILL_AIR;
		}
		const tmp = this.tmp;
		const field = this.tmp2;
		{
			const r = POLL_RADII[0];
			blur3(air[0], tmp, N, r);
			const gain = POLL_PEAK_GAIN * 2 * Math.PI * blurSigma2(r);
			const A = air[0];
			for (let i = 0; i < C; i++) field[i] = A[i] * gain;
			const M2 = Math.ceil(N / 2);
			if (this.coarse.length < M2 * M2) {
				this.coarse = new Float32Array(M2 * M2);
				this.coarseTmp = new Float32Array(M2 * M2);
			}
			for (let c = 1; c < 3; c++) {
				const f = c === 1 ? 2 : 4;
				const rr = Math.max(1, Math.round(POLL_RADII[c] / f));
				const sig2 = f * f * blurSigma2(rr);
				blurDownAdd(air[c], field, N, f, rr, POLL_PEAK_GAIN * 2 * Math.PI * sig2, this.coarse, this.coarseTmp);
			}
		}
		const ang = st.day / 360 * Math.PI * 2 * .7 + Math.sin(st.day * .05) * 1.3;
		shiftField(field, tmp, N, Math.cos(ang) * WIND_DRIFT, Math.sin(ang) * WIND_DRIFT);
		const alpha = first ? 1 : POLL_SMOOTH;
		const airL = st.airPollution;
		const invAK = 1 / 3;
		for (let i = 0; i < C; i++) {
			const target = 1 - Math.exp(-tmp[i] * invAK);
			airL[i] += (target - airL[i]) * alpha;
		}
		this.pendingB = true;
		this.ordsB = ords;
		this.jobsUnknownB = jobsUnknown;
		this.dtMonthsB = dtMonths;
		this.lastMs = nowMs() - t0;
	}
	/** stage B: noise, water, garbage, flags & stats (uses the sources collected by stage A) */
	stageB(sim, first) {
		this.pendingB = false;
		const st = sim.state;
		const N = st.size, C = st.cells;
		const noise = this.noise, water = this.water, tmp = this.tmp, tmp2 = this.tmp2;
		const alpha = first ? 1 : POLL_SMOOTH;
		const airL = st.airPollution;
		const ords = this.ordsB, jobsUnknown = this.jobsUnknownB, dtMonths = this.dtMonthsB;
		{
			tmp.fill(0);
			blurDownAdd(noise, tmp, N, 2, 1, POLL_PEAK_GAIN * 2 * Math.PI * 8, this.coarse, this.coarseTmp);
			const L = st.noise;
			const invK = 1 / 3;
			for (let i = 0; i < C; i++) {
				const target = 1 - Math.exp(-tmp[i] * invK);
				L[i] += (target - L[i]) * alpha;
			}
		}
		{
			tmp.fill(0);
			blurDownAdd(water, tmp, N, 2, 1, POLL_PEAK_GAIN * 2 * Math.PI * 8, this.coarse, this.coarseTmp);
			const L = st.waterPollution;
			const wm = st.water;
			const invK = 1 / 2;
			for (let i = 0; i < C; i++) {
				if (wm[i]) continue;
				const target = 1 - Math.exp(-tmp[i] * invK);
				L[i] += (target - L[i]) * alpha;
			}
			this.ensureWaterList(st);
			const nW = this.nWater, wc = this.waterCells, wnb = this.waterNb;
			const cur = tmp2, nxt = tmp;
			for (let q = 0; q < nW; q++) cur[q] = L[wc[q]];
			const iters = 6;
			for (let it = 0; it < iters; it++) {
				for (let q = 0; q < nW; q++) {
					let s = cur[q], n = 1, inflow = 0;
					const b = q * 4;
					for (let k = 0; k < 4; k++) {
						const t = wnb[b + k];
						if (t === 2147483647) continue;
						if (t >= 0) {
							s += cur[t];
							n++;
						} else {
							const lv = L[-t - 1];
							if (lv > inflow) inflow = lv;
						}
					}
					const v = s / n * .93 + inflow * .12;
					nxt[q] = v > 1 ? 1 : v;
				}
				for (let q = 0; q < nW; q++) cur[q] = nxt[q];
			}
			for (let q = 0; q < nW; q++) L[wc[q]] = cur[q];
		}
		this.garbage(sim, dtMonths, ords.has("recycling"), jobsUnknown);
		const changed = [];
		let polSum = 0, polN = 0;
		for (const b of st.buildings.values()) {
			const cx = Math.min(N - 1, b.x + (b.w >> 1));
			const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + cx;
			const a = airL[i], w = st.waterPollution[i];
			const weight = b.pop > 0 ? b.pop : Math.max(1, b.jobs * .5);
			polSum += (.75 * a + .25 * w) * weight;
			polN += weight;
			if (setFlagQuiet(b, BF.Polluted, a > .45 || w > .6)) changed.push(b);
		}
		st.stats.avgPollution = polN > 0 ? polSum / polN : 0;
		for (const b of changed) sim.events.emit("buildingChanged", b);
		sim.events.emit("layerUpdated", "pollution");
	}
	/** mark water topology dirty (terrain changed) */
	invalidateWater() {
		this.nWater = -1;
	}
	ensureWaterList(st) {
		if (this.nWater >= 0 && this.waterVersion === st.cells) return;
		const N = st.size, C = st.cells, wm = st.water;
		let n = 0;
		const idx = new Int32Array(C).fill(-1);
		for (let i = 0; i < C; i++) if (wm[i]) idx[i] = n++;
		this.waterCells = new Int32Array(n);
		this.waterNb = new Int32Array(n * 4);
		for (let i = 0, q = 0; i < C; i++) {
			if (!wm[i]) continue;
			this.waterCells[q] = i;
			const x = i % N, z = (i - x) / N;
			for (let k = 0; k < 4; k++) {
				const nx = x + DX[k], nz = z + DZ[k];
				let t = 2147483647;
				if (nx >= 0 && nz >= 0 && nx < N && nz < N) {
					const j = nz * N + nx;
					t = wm[j] ? idx[j] : -j - 1;
				}
				this.waterNb[q * 4 + k] = t;
			}
			q++;
		}
		this.nWater = n;
		this.waterVersion = C;
	}
	garbage(sim, dtMonths, recycling, jobsUnknown) {
		const st = sim.state;
		const N = st.size, C = st.cells;
		const net = st.network, zone = st.zone, bld = st.building;
		const G = st.garbage;
		const prodMul = recycling ? .8 : 1;
		const funding = Math.min(1.2, fundingFactor(st, "utilities"));
		let produced = 0;
		this.served = ensureIdArray(this.served, st);
		this.prodById = ensureIdFloat(this.prodById, st);
		const prod = this.prodById;
		const seeds = [];
		let capacity = 0;
		for (const b of st.buildings.values()) {
			const inf = infoOf(st, b);
			prod[b.id] = 0;
			if (inf.garbageCap > 0 && isFunctional(b)) {
				capacity += inf.garbageCap * funding;
				seedPerimeter(st, b, seeds);
				continue;
			}
			if (!isFunctional(b)) continue;
			let p = 0;
			if (inf.fam === 1) p = b.pop * GARBAGE_PER_RES;
			else if (inf.fam === 2) p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_JOB_C;
			else if (inf.fam === 3) p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_JOB_I[IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))]];
			else p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_CIVIC_JOB + inf.garbage;
			p *= prodMul;
			if (p > 0) {
				prod[b.id] = p;
				produced += p;
			}
		}
		const visit = this.visit, queue = this.queue;
		const stampL = ++this.stamp;
		let landfillCells = 0;
		for (let s = 0; s < C; s++) {
			if (zone[s] !== 10 || bld[s] >= 0 || visit[s] === stampL) continue;
			let qh = 0, qt = 0;
			queue[qt++] = s;
			visit[s] = stampL;
			let road = false;
			while (qh < qt) {
				const i = queue[qh++];
				const x = i % N, z = (i - x) / N;
				for (let k = 0; k < 4; k++) {
					const nx = x + DX[k], nz = z + DZ[k];
					if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
					const j = nz * N + nx;
					if (isRoad(net[j])) road = true;
					if (zone[j] === 10 && bld[j] < 0 && visit[j] !== stampL) {
						visit[j] = stampL;
						queue[qt++] = j;
					}
				}
			}
			if (!road) {
				for (let q = 0; q < qt; q++) G[queue[q]] = .35;
				continue;
			}
			landfillCells += qt;
			for (let q = 0; q < qt; q++) {
				const i = queue[q];
				const x = i % N, z = (i - x) / N;
				for (let k = 0; k < 4; k++) {
					const nx = x + DX[k], nz = z + DZ[k];
					if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
					const j = nz * N + nx;
					if (isRoad(net[j])) seeds.push(j);
				}
			}
		}
		capacity += landfillCells * 160 * Math.max(.5, Math.min(1, funding));
		const util = produced > 0 ? Math.min(1, produced / Math.max(1, capacity)) : 0;
		for (let i = 0; i < C; i++) if (zone[i] === 10 && bld[i] < 0 && visit[i] === stampL) G[i] = Math.max(G[i] * .9, .45 + .5 * util);
		st.stats.garbageProduced = produced;
		st.stats.garbageCapacity = capacity;
		const served = this.served;
		const sStamp = ++this.stamp;
		if (capacity >= produced) for (const b of st.buildings.values()) served[b.id] = sStamp;
		else if (capacity > 0 && seeds.length > 0) {
			let left = capacity;
			let qh = 0, qt = 0;
			for (const s of seeds) if (visit[s] !== sStamp) {
				visit[s] = sStamp;
				queue[qt++] = s;
			}
			while (qh < qt && left > 0) {
				const i = queue[qh++];
				const x = i % N, z = (i - x) / N;
				for (let k = 0; k < 4; k++) {
					const nx = x + DX[k], nz = z + DZ[k];
					if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
					const j = nz * N + nx;
					const bid = bld[j];
					if (bid >= 0 && served[bid] !== sStamp && left > 0) {
						left -= prod[bid];
						served[bid] = sStamp;
					}
					if (visit[j] === sStamp || !isRoad(net[j])) continue;
					visit[j] = sStamp;
					queue[qt++] = j;
				}
			}
		}
		const changed = [];
		for (const b of st.buildings.values()) {
			const p = prod[b.id];
			const ok = p === 0 || served[b.id] === sStamp;
			const area = b.w * b.d;
			let level = 0;
			for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
				const i = z * N + x;
				if (bld[i] !== b.id) continue;
				let g = G[i];
				if (ok) g *= .65;
				else g = Math.min(1, g + p / area * GARBAGE_BUILDUP * dtMonths * 4);
				G[i] = g;
				if (g > level) level = g;
			}
			if (setFlagQuiet(b, BF.NoGarbage, level > .35)) changed.push(b);
		}
		for (let i = 0; i < C; i++) if (bld[i] < 0 && zone[i] !== 10) G[i] *= .5;
		for (const b of changed) sim.events.emit("buildingChanged", b);
	}
};
function seedPerimeter(st, b, out) {
	const N = st.size;
	for (let z = b.z - 1; z <= b.z + b.d; z++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
		if (x < 0 || z < 0 || x >= N || z >= N) continue;
		const i = z * N + x;
		if (isRoad(st.network[i])) out.push(i);
	}
}
const KIND_SERVICE = {
	police: "police",
	fire: "fire",
	health: "health",
	education: "education",
	park: "parks",
	transit: "transit",
	garbage: "utilities"
};
var ServicesSystem = class {
	name = "services";
	stamp = 0;
	visit = /* @__PURE__ */ new Int32Array(0);
	best = /* @__PURE__ */ new Float32Array(0);
	dist = /* @__PURE__ */ new Int32Array(0);
	queue = /* @__PURE__ */ new Int32Array(0);
	touched = /* @__PURE__ */ new Int32Array(0);
	resCell = /* @__PURE__ */ new Float32Array(0);
	tmpLayer = /* @__PURE__ */ new Float32Array(0);
	stops;
	lastRun = -1e9;
	lastMs = 0;
	init(sim) {
		sim.state.systemData.infraVersion = 1;
		this.lastRun = -1e9;
		this.compute(sim, true);
	}
	daily(sim) {
		const d = sim.state.day;
		if (d % 4 === 2 || d - this.lastRun > 8) this.compute(sim, false);
	}
	/** coverage layer for a CoverageKind name */
	layerOf(st, kind) {
		switch (kind) {
			case "police": return st.policeCov;
			case "fire": return st.fireCov;
			case "health": return st.healthCov;
			case "education": return st.eduCov;
			case "park": return st.parkCov;
			case "transit": return st.transitCov;
			default: return null;
		}
	}
	compute(sim, first) {
		const t0 = nowMs();
		const st = sim.state;
		const N = st.size, C = st.cells;
		this.lastRun = st.day;
		if (this.visit.length !== C) {
			this.visit = new Int32Array(C);
			this.best = new Float32Array(C);
			this.dist = new Int32Array(C);
			this.queue = new Int32Array(C);
			this.touched = new Int32Array(C);
			this.resCell = new Float32Array(C);
			this.tmpLayer = new Float32Array(C);
		}
		const res = this.resCell;
		res.fill(0);
		let hasJail = false;
		for (const b of st.buildings.values()) {
			const inf = infoOf(st, b);
			if (inf.isJail && isFunctional(b)) hasJail = true;
			if (inf.fam !== 1 || b.pop <= 0) continue;
			const per = b.pop / (b.w * b.d);
			for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) if (x >= 0 && z >= 0 && x < N && z < N) res[z * N + x] += per;
		}
		const layers = [
			st.policeCov,
			st.fireCov,
			st.healthCov,
			st.eduCov,
			st.parkCov,
			st.transitCov
		];
		for (const L of layers) L.fill(0);
		const policeMul = st.stats.population > 25e3 && !hasJail ? .75 : 1;
		const ords = readOrdinances(st);
		for (const b of st.buildings.values()) {
			const inf = infoOf(st, b);
			let kind = inf.cov;
			let R = inf.covRadius, strength = inf.covStrength;
			if (kind < 0 && inf.isPark) {
				kind = 4;
				R = 3 + Math.max(b.w, b.d);
				strength = .7;
			}
			if (kind < 0 || kind > 5 || R <= 0 || strength <= 0) continue;
			if (!isFunctional(b)) continue;
			const kindName = COV_KINDS[kind];
			let eff = strength * fundingFactor(st, inf.service ?? KIND_SERVICE[kindName]);
			if (kind === 0) eff *= policeMul;
			if (kind === 2 && ords.has("freeClinics")) eff *= 1.1;
			if (eff <= 0) continue;
			const L = layers[kind];
			const nT = kind === 4 || kind === 5 ? this.reachEuclid(st, b.x, b.z, b.w, b.d, R) : this.reachRoad(st, b.x, b.z, b.w, b.d, R);
			if (inf.covCapacity > 0) {
				let demand = 0;
				const ratio = COVERAGE_DEMAND[kindName] ?? 1;
				for (let t = 0; t < nT; t++) {
					const i = this.touched[t];
					demand += res[i] * this.best[i] * ratio;
				}
				if (demand > inf.covCapacity) eff *= inf.covCapacity / demand;
			}
			const touched = this.touched, best = this.best;
			for (let t = 0; t < nT; t++) {
				const i = touched[t];
				let v = best[i] * eff;
				if (v > 1) v = 1;
				L[i] = 1 - (1 - L[i]) * (1 - v);
			}
		}
		this.stops = collectStops(st, this.stops);
		const tmp = this.tmpLayer;
		computeTransitCoverage(st, this.stops, tmp, Math.min(1.25, fundingFactor(st, "transit")));
		const T = st.transitCov;
		for (let i = 0; i < C; i++) T[i] = 1 - (1 - T[i]) * (1 - Math.min(1, tmp[i]));
		for (const b of st.buildings.values()) {
			if (b.w * b.d <= 1) continue;
			for (const L of layers) {
				let m = 0;
				for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
					const v = L[z * N + x];
					if (v > m) m = v;
				}
				for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) L[z * N + x] = m;
			}
		}
		let popSum = 0, edu = 0, health = 0, air = 0;
		for (const b of st.buildings.values()) {
			if (b.pop <= 0) continue;
			if (infoOf(st, b).fam !== 1) continue;
			const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
			popSum += b.pop;
			edu += b.pop * st.eduCov[i];
			health += b.pop * st.healthCov[i];
			air += b.pop * st.airPollution[i];
		}
		const stats = st.stats;
		if (popSum > 0) {
			edu /= popSum;
			health /= popSum;
			air /= popSum;
			let eqT = 25 + 125 * edu;
			if (ords.has("proReading")) eqT += 6;
			let hqT = (30 + 120 * health) * (1 - .35 * air);
			if (ords.has("freeClinics")) hqT += 5;
			if (ords.has("smokingBan")) hqT += 4;
			eqT = Math.min(150, eqT);
			hqT = Math.min(150, Math.max(0, hqT));
			const re = first ? EQ_RATE : EQ_RATE, rh = first ? HQ_RATE : HQ_RATE;
			stats.eq += (eqT - stats.eq) * re;
			stats.hq += (hqT - stats.hq) * rh;
		}
		sim.events.emit("layerUpdated", "services");
		this.lastMs = nowMs() - t0;
	}
	/** Euclidean disk reach -> this.touched / this.best; returns count */
	reachEuclid(st, bx, bz, bw, bd, R) {
		const N = st.size;
		const stamp = ++this.stamp;
		const cx = bx + bw / 2 - .5, cz = bz + bd / 2 - .5;
		const half = Math.max(bw, bd) / 2;
		const Rt = R + half;
		const x0 = Math.max(0, Math.floor(cx - Rt)), x1 = Math.min(N - 1, Math.ceil(cx + Rt));
		const z0 = Math.max(0, Math.floor(cz - Rt)), z1 = Math.min(N - 1, Math.ceil(cz + Rt));
		let n = 0;
		const visit = this.visit, best = this.best, touched = this.touched;
		for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
			const d = Math.max(0, Math.hypot(x - cx, z - cz) - half);
			if (d > R) continue;
			const v = falloff(d, R);
			if (v <= 0) continue;
			const i = z * N + x;
			visit[i] = stamp;
			best[i] = v;
			touched[n++] = i;
		}
		return n;
	}
	/** road-network reach (BFS over road cells) -> this.touched / this.best; returns count */
	reachRoad(st, bx, bz, bw, bd, R) {
		const N = st.size;
		const net = st.network;
		const stamp = ++this.stamp;
		const visit = this.visit, best = this.best, touched = this.touched, dist = this.dist, queue = this.queue;
		const roadR = R * ROAD_RADIUS_FACTOR;
		let n = 0;
		const touch = (i, v) => {
			if (visit[i] !== stamp) {
				visit[i] = stamp;
				best[i] = v;
				touched[n++] = i;
			} else if (v > best[i]) best[i] = v;
		};
		const near = Math.min(3, R);
		for (let z = Math.max(0, bz - near); z <= Math.min(N - 1, bz + bd - 1 + near); z++) for (let x = Math.max(0, bx - near); x <= Math.min(N - 1, bx + bw - 1 + near); x++) touch(z * N + x, 1);
		let qh = 0, qt = 0;
		-stamp;
		for (let z = bz - 1; z <= bz + bd; z++) for (let x = bx - 1; x <= bx + bw; x++) {
			if (x < 0 || z < 0 || x >= N || z >= N) continue;
			if (x >= bx && x < bx + bw && z >= bz && z < bz + bd) continue;
			const i = z * N + x;
			if (!isRoad(net[i])) continue;
			if (dist[i] === stamp * 4096) continue;
			dist[i] = stamp * 4096;
			queue[qt++] = i;
		}
		const base = stamp * 4096;
		while (qh < qt) {
			const i = queue[qh++];
			const d = dist[i] - base;
			const x = i % N, z = (i - x) / N;
			const v = falloff(d, roadR);
			if (v > 0) for (let dz = -1; dz <= 1; dz++) {
				const zz = z + dz;
				if (zz < 0 || zz >= N) continue;
				for (let dx = -1; dx <= 1; dx++) {
					const xx = x + dx;
					if (xx < 0 || xx >= N) continue;
					touch(zz * N + xx, dx === 0 && dz === 0 ? v : falloff(d + 1, roadR));
				}
			}
			if (d + 1 > roadR) continue;
			for (let k = 0; k < 4; k++) {
				const nx = x + DX[k], nz = z + DZ[k];
				if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
				const j = nz * N + nx;
				const dj = dist[j] - base;
				if (dj >= 0 && dj < 4096) continue;
				if (!isRoad(net[j])) continue;
				dist[j] = base + d + 1;
				queue[qt++] = j;
			}
		}
		return n;
	}
};
function falloff(d, R) {
	const a = .35 * R;
	if (d <= a) return 1;
	if (d >= R) return 0;
	const t = (d - a) / (R - a);
	return 1 - t * t * (3 - 2 * t);
}
const POVERTY_BY_DEV = [];
POVERTY_BY_DEV[0] = .28;
POVERTY_BY_DEV[1] = .12;
POVERTY_BY_DEV[2] = .04;
POVERTY_BY_DEV[3] = .14;
POVERTY_BY_DEV[4] = .08;
POVERTY_BY_DEV[5] = .05;
POVERTY_BY_DEV[6] = .05;
POVERTY_BY_DEV[7] = .03;
POVERTY_BY_DEV[8] = .04;
POVERTY_BY_DEV[9] = .16;
POVERTY_BY_DEV[10] = .1;
POVERTY_BY_DEV[11] = .03;
var CrimeSystem = class {
	name = "crime";
	raw = /* @__PURE__ */ new Float32Array(0);
	tmp = /* @__PURE__ */ new Float32Array(0);
	lastRun = -1e9;
	lastMs = 0;
	init(sim) {
		sim.state.systemData.infraVersion = 1;
		this.lastRun = -1e9;
		this.compute(sim, true);
	}
	daily(sim) {
		const d = sim.state.day;
		if (d % 4 === 3 || d - this.lastRun > 8) this.compute(sim, false);
	}
	compute(sim, first) {
		const t0 = nowMs();
		const st = sim.state;
		const N = st.size, C = st.cells;
		this.lastRun = st.day;
		if (this.raw.length !== C) {
			this.raw = new Float32Array(C);
			this.tmp = new Float32Array(C);
		}
		const raw = this.raw;
		raw.fill(0);
		const ords = readOrdinances(st);
		let mul = 1;
		if (ords.has("neighborhoodWatch")) mul *= .9;
		if (ords.has("youthCurfew")) mul *= .92;
		if (ords.has("legalizedGambling")) mul *= 1.12;
		const unemp = Math.max(0, Math.min(1, st.stats.unemployment || 0));
		let lvKnown = false;
		for (let i = 0; i < C; i += 97) if (st.landValue[i] > 0) {
			lvKnown = true;
			break;
		}
		const police = st.policeCov, lv = st.landValue;
		for (const b of st.buildings.values()) {
			if (b.built < 1 && (b.flags & BF.Abandoned) === 0) continue;
			const inf = infoOf(st, b);
			const area = b.w * b.d;
			const occ = inf.fam === 1 ? b.pop : b.jobs;
			const ci = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
			let c = Math.min(1, occ / (area * 90)) * .3;
			if (inf.dev >= 0) c += POVERTY_BY_DEV[inf.dev] ?? .08;
			else if (inf.fam === 1) c += wealthOf(inf, b) === 1 ? .28 : .1;
			else c += inf.isPark ? .06 : .03;
			c += unemp * (inf.fam === 1 ? .5 : .2);
			c += (1 - (lvKnown ? lv[ci] : .5)) * .2;
			if (b.flags & BF.Abandoned) c += .35;
			if (b.flags & BF.Burnt) c += .1;
			c *= mul * (1 - .85 * Math.min(1, police[ci]));
			for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
				if (x < 0 || z < 0 || x >= N || z >= N) continue;
				raw[z * N + x] = c;
			}
		}
		const tmp = this.tmp;
		tmp.set(raw);
		blur3(tmp, this.tmpB(), N, 1);
		const L = st.crime;
		const alpha = first ? 1 : .4;
		for (let i = 0; i < C; i++) {
			let t = Math.max(raw[i] * .85, tmp[i]);
			if (t > 1) t = 1;
			L[i] += (t - L[i]) * alpha;
		}
		const changed = [];
		let sum = 0, w = 0;
		for (const b of st.buildings.values()) {
			const c = L[Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1))];
			const occ = infoOf(st, b).fam === 1 ? b.pop : b.jobs;
			if (occ > 0) {
				sum += c * occ;
				w += occ;
			}
			if (setFlagQuiet(b, BF.Crime, c > .55)) changed.push(b);
		}
		st.stats.avgCrime = w > 0 ? sum / w : 0;
		for (const b of changed) sim.events.emit("buildingChanged", b);
		sim.events.emit("layerUpdated", "crime");
		this.lastMs = nowMs() - t0;
	}
	scratch = /* @__PURE__ */ new Float32Array(0);
	tmpB() {
		if (this.scratch.length !== this.raw.length) this.scratch = new Float32Array(this.raw.length);
		return this.scratch;
	}
};
//#endregion
//#region src/sim/infra/fire.ts
/**
* Fire system (daily).
*  - Random ignition per building: FIRE_BASE_P x risk; risk up with industry (I-D x4, I-M x2.5), density,
*    abandonment; down with fire coverage ((1 - 0.85 cov)^2) and the smoke detector ordinance (x0.7).
*  - Burning buildings (BF.OnFire) spread to adjacent buildings (FIRE_SPREAD_P, less where covered).
*  - Dispatch: if the building has fire coverage, the nearest fire station sends a truck (service route for the
*    vehicle renderer) and puts the fire out after 1-3 days (coverage >= 0.6 / >= 0.35 / otherwise).
*    Uncovered fires burn FIRE_BURN_DAYS then the building becomes rubble (BF.Burnt).
*  - Emits buildingChanged on flag flips, 'disaster' {kind:'fire', x, z, active} when a fire starts / ends,
*    news via sim.notify(..., 'disaster').
*  Burning state persists in state.systemData.infraFires = [buildingId, daysBurning, putOutDay][].
*/
var FireSystem = class {
	name = "fire";
	fires = /* @__PURE__ */ new Map();
	rng = new RNG(1);
	lastNews = -1e9;
	/** fires started this month (for advisors) */
	firesThisMonth = 0;
	/** multiplier for random ignitions (disasters temporarily raise it) */
	riskBoost = 1;
	init(sim) {
		const st = sim.state;
		st.systemData.infraVersion = 1;
		this.rng = new RNG((st.config.seed ^ 61742) + st.day);
		this.fires.clear();
		const saved = st.systemData.infraFires;
		if (Array.isArray(saved)) for (const e of saved) {
			const b = st.buildings.get(e[0]);
			if (b && b.flags & BF.OnFire) this.fires.set(e[0], {
				days: e[1] ?? 0,
				putOut: e[2] ?? -1
			});
		}
		for (const b of st.buildings.values()) if (b.flags & BF.OnFire && !this.fires.has(b.id)) this.fires.set(b.id, {
			days: 0,
			putOut: -1
		});
	}
	monthly() {
		this.firesThisMonth = 0;
	}
	daily(sim) {
		const st = sim.state;
		const N = st.size;
		const rng = this.rng;
		const detector = readOrdinances(st).has("smokeDetector") ? .7 : 1;
		const base = FIRE_BASE_P * detector * this.riskBoost;
		const fc = st.fireCov;
		for (const b of st.buildings.values()) {
			if (b.flags & (BF.OnFire | BF.Burnt)) continue;
			if (b.built < .3) continue;
			const inf = infoOf(st, b);
			if (inf.isPark) continue;
			let risk = 1;
			if (inf.fam === 3) risk = inf.dev === 9 ? 4 : inf.dev === 10 ? 2.5 : 1.3;
			else if (inf.fam === 1 || inf.fam === 2) risk = 1 + Math.min(1.5, (b.pop + b.jobs) / (b.w * b.d * 120));
			if (b.flags & BF.Abandoned) risk *= 3;
			const cov = fc[centerCell(st, b)];
			const k = 1 - .85 * Math.min(1, cov);
			const p = base * risk * k * k * Math.sqrt(b.w * b.d);
			if (rng.next() < p) this.ignite(sim, b);
		}
		if (this.fires.size === 0) {
			if (this.riskBoost > 1) this.riskBoost = Math.max(1, this.riskBoost * .8);
			return;
		}
		const toSpread = [];
		for (const [id, f] of this.fires) {
			const b = st.buildings.get(id);
			if (!b) {
				this.fires.delete(id);
				continue;
			}
			f.days++;
			if (f.putOut >= 0 && st.day >= f.putOut) {
				this.fires.delete(id);
				b.flags &= ~BF.OnFire;
				sim.events.emit("buildingChanged", b);
				sim.events.emit("disaster", {
					kind: "fire",
					x: b.x,
					z: b.z,
					active: false
				});
				continue;
			}
			if (f.days >= 6) {
				this.fires.delete(id);
				b.flags = b.flags & ~BF.OnFire | BF.Burnt;
				sim.events.emit("buildingChanged", b);
				sim.events.emit("disaster", {
					kind: "fire",
					x: b.x,
					z: b.z,
					active: false
				});
				continue;
			}
			toSpread.push(b);
		}
		for (const b of toSpread) for (let z = b.z - 1; z <= b.z + b.d; z++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
			if (x < 0 || z < 0 || x >= N || z >= N) continue;
			const id = st.building[z * N + x];
			if (id < 0 || id === b.id) continue;
			const nb = st.buildings.get(id);
			if (!nb || nb.flags & (BF.OnFire | BF.Burnt)) continue;
			const cov = fc[centerCell(st, nb)];
			if (rng.next() < .02 * (1 - .8 * Math.min(1, cov)) / Math.max(1, (b.w + b.d) / 2)) this.ignite(sim, nb, true);
		}
		this.save(sim);
	}
	/** set a building on fire (no-op if already burning / rubble). Returns true if it ignited. */
	ignite(sim, b, spread = false) {
		if (b.flags & (BF.OnFire | BF.Burnt)) return false;
		const st = sim.state;
		b.flags |= BF.OnFire;
		const cov = st.fireCov[centerCell(st, b)];
		let putOut = -1;
		if (cov >= .15) {
			const days = cov >= .6 ? 1 : cov >= .35 ? 2 : 3;
			putOut = st.day + days + (this.rng.next() < .3 ? 1 : 0);
			this.dispatch(sim, b);
		}
		this.fires.set(b.id, {
			days: 0,
			putOut
		});
		this.firesThisMonth++;
		sim.events.emit("buildingChanged", b);
		sim.events.emit("disaster", {
			kind: "fire",
			x: b.x,
			z: b.z,
			active: true
		});
		if (!spread && st.day - this.lastNews > 5) {
			this.lastNews = st.day;
			sim.notify(putOut >= 0 ? "Fire reported! Firefighters are on their way." : "Fire reported in an area without fire coverage!", "disaster", b.x, b.z, "fire");
		}
		this.save(sim);
		return true;
	}
	/** extinguish immediately (e.g. UI / cheats) */
	extinguish(sim, b) {
		if (!(b.flags & BF.OnFire)) return;
		b.flags &= ~BF.OnFire;
		this.fires.delete(b.id);
		sim.events.emit("buildingChanged", b);
		sim.events.emit("disaster", {
			kind: "fire",
			x: b.x,
			z: b.z,
			active: false
		});
		this.save(sim);
	}
	dispatch(sim, b) {
		const st = sim.state;
		let best;
		let bd = Infinity;
		for (const s of st.buildings.values()) {
			const inf = infoOf(st, s);
			if (inf.cov !== 1 || s.built < 1 || s.flags & BF.Burnt) continue;
			const d = Math.abs(s.x - b.x) + Math.abs(s.z - b.z);
			if (d < bd && d <= inf.covRadius * 2.2) {
				bd = d;
				best = s;
			}
		}
		if (!best) return;
		const tr = sim.getSystem("traffic");
		if (!tr) return;
		const path = tr.findPath(sim, centerCell(st, best), centerCell(st, b));
		if (path && path.length >= 2) tr.pushServiceRoute(sim, path, 1, 2);
	}
	save(sim) {
		const arr = [];
		for (const [id, f] of this.fires) arr.push([
			id,
			f.days,
			f.putOut
		]);
		sim.state.systemData.infraFires = arr;
	}
};
//#endregion
//#region src/sim/terrainGen.ts
/** a cell is water if its average corner height is below sea level */
function computeWater(state, x0 = 0, z0 = 0, x1 = state.size, z1 = state.size) {
	for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) state.water[z * state.size + x] = state.cellHeight(x, z) < 0 ? 1 : 0;
}
//#endregion
//#region src/sim/infra/disasters.ts
/**
* Disasters: tornado (moving funnel destroying buildings along its path), earthquake (random damage + fires around
* the epicentre), meteor strike (crater: lowers terrain, removes buildings / roads in the core, fires around),
* and plain fires. Random disasters happen only when state.config.disasters is true (monthly chance, city > 2k pop);
* triggerDisaster() always works (UI disaster menu / sandbox).
*
* Events: 'disaster' {kind, x, z, active} — tornado re-emits while moving (x,z = current funnel cell, fractional
* position via DisastersSystem.active[]), earthquake / meteor emit active:true then active:false after a few days.
* News via sim.notify(..., 'disaster', x, z). Destroyed buildings get BF.Burnt (rubble; sim-core decides regrowth)
* + buildingChanged; buildings inside a meteor crater are removed (buildingRemoved).
*/
const TORNADO_CELLS_PER_DAY = 10;
const TORNADO_DAYS = 4;
const TORNADO_RADIUS = 1.2;
var DisastersSystem = class {
	name = "disasters";
	active = [];
	rng = new RNG(1);
	lastFrameMs = -1e9;
	lastEmitCell = /* @__PURE__ */ new Map();
	init(sim) {
		sim.state.systemData.infraVersion = 1;
		this.rng = new RNG((sim.state.config.seed ^ 53594) + sim.state.day);
		this.active.length = 0;
	}
	monthly(sim) {
		const st = sim.state;
		if (!st.config.disasters || st.stats.population < 2e3) return;
		const r = this.rng.next();
		const N = st.size;
		const x = this.rng.int(8, N - 9), z = this.rng.int(8, N - 9);
		if (r < .008) this.trigger(sim, "tornado", x, z);
		else if (r < .012) this.trigger(sim, "earthquake", x, z);
		else if (r < .0145) this.trigger(sim, "meteor", x, z);
	}
	daily(sim) {
		const framesActive = nowMs() - this.lastFrameMs < 750;
		for (let k = this.active.length - 1; k >= 0; k--) {
			const d = this.active[k];
			if (d.kind === "tornado") {
				if (!framesActive) this.advanceTornado(sim, d, 1);
			} else {
				d.daysLeft -= 1;
				if (d.daysLeft <= 0) this.end(sim, k);
			}
		}
	}
	frame(sim, dt) {
		this.lastFrameMs = nowMs();
		if (this.active.length === 0 || sim.speed === 0) return;
		const days = Math.min(.25, dt) / SECONDS_PER_DAY[sim.speed];
		for (let k = this.active.length - 1; k >= 0; k--) {
			const d = this.active[k];
			if (d.kind === "tornado") this.advanceTornado(sim, d, days);
		}
	}
	trigger(sim, kind, x, z) {
		if (!sim.state.inBounds(Math.floor(x), Math.floor(z))) return false;
		x = Math.floor(x);
		z = Math.floor(z);
		switch (kind) {
			case "fire": return this.startFire(sim, x, z);
			case "tornado": {
				const d = {
					kind,
					x: x + .5,
					z: z + .5,
					daysLeft: TORNADO_DAYS,
					heading: this.rng.range(0, Math.PI * 2),
					magnitude: 1
				};
				this.active.push(d);
				sim.notify("Tornado sighted! Take cover!", "disaster", x, z, "disaster");
				sim.events.emit("disaster", {
					kind,
					x,
					z,
					active: true
				});
				return true;
			}
			case "earthquake": {
				const mag = this.rng.range(5.8, 7.8);
				this.earthquake(sim, x, z, mag);
				const d = {
					kind,
					x,
					z,
					daysLeft: 2,
					heading: 0,
					magnitude: mag
				};
				this.active.push(d);
				return true;
			}
			case "meteor":
				this.meteor(sim, x, z);
				this.active.push({
					kind,
					x,
					z,
					daysLeft: 2,
					heading: 0,
					magnitude: 3
				});
				return true;
		}
		return false;
	}
	fireSys(sim) {
		return sim.getSystem("fire");
	}
	startFire(sim, x, z) {
		const st = sim.state;
		const fire = this.fireSys(sim);
		if (!fire) return false;
		for (let r = 0; r <= 3; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
			const b = st.buildingAt(x + dx, z + dz);
			if (b && fire.ignite(sim, b)) return true;
		}
		return false;
	}
	destroy(sim, b) {
		if (b.flags & BF.Burnt) return;
		b.flags = b.flags & ~BF.OnFire | BF.Burnt;
		this.fireSys(sim)?.fires.delete(b.id);
		sim.events.emit("buildingChanged", b);
	}
	advanceTornado(sim, d, days) {
		const st = sim.state;
		const N = st.size;
		let dist = days * TORNADO_CELLS_PER_DAY;
		d.daysLeft -= days;
		while (dist > 0) {
			const step = Math.min(.5, dist);
			dist -= step;
			d.heading += this.rng.range(-.25, .25);
			d.x += Math.cos(d.heading) * step;
			d.z += Math.sin(d.heading) * step;
			if (d.x < 1 || d.z < 1 || d.x > N - 1 || d.z > N - 1) {
				d.daysLeft = 0;
				break;
			}
			const r = TORNADO_RADIUS;
			for (let z = Math.floor(d.z - r); z <= Math.floor(d.z + r); z++) for (let x = Math.floor(d.x - r); x <= Math.floor(d.x + r); x++) {
				if (!st.inBounds(x, z)) continue;
				if (Math.hypot(x + .5 - d.x, z + .5 - d.z) > r) continue;
				const b = st.buildingAt(x, z);
				if (b && !(b.flags & BF.Burnt) && this.rng.next() < .6) this.destroy(sim, b);
				if (st.trees[z * N + x] > 0) st.trees[z * N + x] = Math.max(0, st.trees[z * N + x] - 2);
			}
			const cell = Math.floor(d.z) * N + Math.floor(d.x);
			if (this.lastEmitCell.get(d) !== cell) {
				this.lastEmitCell.set(d, cell);
				sim.events.emit("disaster", {
					kind: "tornado",
					x: d.x,
					z: d.z,
					active: true
				});
			}
		}
		if (d.daysLeft <= 0) {
			const k = this.active.indexOf(d);
			if (k >= 0) this.end(sim, k);
			const r = Math.ceil(40) + 2;
			sim.events.emit("treesChanged", {
				x0: Math.max(0, Math.floor(d.x) - r),
				z0: Math.max(0, Math.floor(d.z) - r),
				x1: Math.min(N, Math.floor(d.x) + r),
				z1: Math.min(N, Math.floor(d.z) + r)
			});
		}
	}
	end(sim, k) {
		const d = this.active[k];
		this.active.splice(k, 1);
		this.lastEmitCell.delete(d);
		sim.events.emit("disaster", {
			kind: d.kind,
			x: d.x,
			z: d.z,
			active: false
		});
	}
	earthquake(sim, x, z, mag) {
		const st = sim.state;
		const R = 10 + (mag - 5) * 16;
		const fire = this.fireSys(sim);
		let destroyed = 0, fires = 0;
		sim.events.emit("disaster", {
			kind: "earthquake",
			x,
			z,
			active: true
		});
		for (const b of Array.from(st.buildings.values())) {
			const d = Math.hypot(b.x + b.w / 2 - x, b.z + b.d / 2 - z);
			if (d > R) continue;
			const p = .55 * (1 - d / R) * ((mag - 4.5) / 3.5);
			if (this.rng.next() >= p) continue;
			const r = this.rng.next();
			if (r < .4) {
				this.destroy(sim, b);
				destroyed++;
			} else if (r < .65 && fire) {
				if (fire.ignite(sim, b, true)) fires++;
			}
		}
		if (fire) fire.riskBoost = Math.max(fire.riskBoost, 3);
		sim.notify(`Earthquake! Magnitude ${mag.toFixed(1)}: ${destroyed} buildings destroyed, ${fires} fires.`, "disaster", x, z, "disaster");
	}
	meteor(sim, x, z) {
		const st = sim.state;
		const N = st.size;
		const craterR = 3, destroyR = 5, fireR = 8, depth = 9;
		sim.events.emit("disaster", {
			kind: "meteor",
			x,
			z,
			active: true
		});
		const N1 = N + 1;
		for (let cz = z - craterR - 1; cz <= z + craterR + 2; cz++) for (let cx = x - craterR - 1; cx <= x + craterR + 2; cx++) {
			if (cx < 0 || cz < 0 || cx > N || cz > N) continue;
			const d = Math.hypot(cx - (x + .5), cz - (z + .5)) / 3.5;
			if (d >= 1.3) continue;
			const h = d < 1 ? -9 * (1 - d * d) : depth * .25 * (1 - (d - 1) / .3);
			st.heights[cz * N1 + cx] += h;
		}
		const rect = {
			x0: Math.max(0, x - craterR - 2),
			z0: Math.max(0, z - craterR - 2),
			x1: Math.min(N, x + craterR + 3),
			z1: Math.min(N, z + craterR + 3)
		};
		computeWater(st, rect.x0, rect.z0, rect.x1, rect.z1);
		let netHit = false, lineHit = false;
		for (let zz = rect.z0; zz < rect.z1; zz++) for (let xx = rect.x0; xx < rect.x1; xx++) {
			if (Math.hypot(xx + .5 - (x + .5), zz + .5 - (z + .5)) > 2.5) continue;
			const i = zz * N + xx;
			if (st.network[i]) {
				st.network[i] = 0;
				st.netFlags[i] = 0;
				netHit = true;
			}
			if (st.powerLines[i]) {
				st.powerLines[i] = 0;
				lineHit = true;
			}
			st.trees[i] = 0;
		}
		const fire = this.fireSys(sim);
		let destroyed = 0;
		for (const b of Array.from(st.buildings.values())) {
			const d = Math.hypot(b.x + b.w / 2 - (x + .5), b.z + b.d / 2 - (z + .5)) - Math.max(b.w, b.d) / 2;
			if (d <= craterR) {
				removeBuilding(sim, b);
				destroyed++;
			} else if (d <= destroyR) {
				this.destroy(sim, b);
				destroyed++;
			} else if (d <= fireR && fire && this.rng.next() < .35) fire.ignite(sim, b, true);
		}
		sim.events.emit("terrainChanged", rect);
		sim.events.emit("treesChanged", rect);
		if (netHit) sim.events.emit("networkChanged", rect);
		if (lineHit) sim.events.emit("powerLinesChanged", rect);
		sim.notify(`Meteor strike! ${destroyed} buildings destroyed.`, "disaster", x, z, "disaster");
	}
};
//#endregion
//#region src/sim/systems/infra.ts
function infraSystems() {
	return [
		new UtilitiesSystem(),
		new TrafficSystem(),
		new PollutionSystem(),
		new ServicesSystem(),
		new CrimeSystem(),
		new FireSystem(),
		new DisastersSystem()
	];
}
//#endregion
//#region tests/infra/cityGen.ts
const TEST_DEFS = [
	{
		id: "t_r1",
		name: "R$ house",
		model: "res_cottage",
		category: "growable",
		footprint: [1, 1],
		devType: 0,
		zones: [1],
		capacity: 12
	},
	{
		id: "t_r2",
		name: "R$$ apt",
		model: "res_apartment",
		category: "growable",
		footprint: [1, 1],
		devType: 1,
		zones: [2],
		capacity: 60
	},
	{
		id: "t_r3",
		name: "R$$$ tower",
		model: "res_tower",
		category: "growable",
		footprint: [2, 2],
		devType: 2,
		zones: [3],
		capacity: 400
	},
	{
		id: "t_cs",
		name: "shop",
		model: "com_corner_store",
		category: "growable",
		footprint: [1, 1],
		devType: 4,
		zones: [4],
		capacity: 20
	},
	{
		id: "t_co",
		name: "office",
		model: "com_office_tower",
		category: "growable",
		footprint: [2, 2],
		devType: 7,
		zones: [6],
		capacity: 400
	},
	{
		id: "t_id",
		name: "factory",
		model: "ind_smokestack_factory",
		category: "growable",
		footprint: [1, 1],
		devType: 9,
		zones: [8],
		capacity: 40
	},
	{
		id: "t_im",
		name: "plant",
		model: "ind_warehouse",
		category: "growable",
		footprint: [2, 2],
		devType: 10,
		zones: [8],
		capacity: 150
	},
	{
		id: "t_iht",
		name: "lab",
		model: "ind_lab",
		category: "growable",
		footprint: [1, 1],
		devType: 11,
		zones: [9],
		capacity: 40
	},
	{
		id: "t_coal",
		name: "Coal plant",
		model: "util_coal_plant",
		category: "power",
		footprint: [2, 2],
		powerOut: 1e3,
		jobs: 50,
		service: "utilities",
		pollution: {
			air: 8,
			radius: 10
		}
	},
	{
		id: "t_small_plant",
		name: "Small plant",
		model: "util_gas_plant",
		category: "power",
		footprint: [1, 1],
		powerOut: 10,
		service: "utilities"
	},
	{
		id: "t_pump",
		name: "Water pump",
		model: "util_water_pump",
		category: "water",
		footprint: [1, 1],
		waterOut: 100,
		service: "utilities"
	},
	{
		id: "t_tower",
		name: "Water tower",
		model: "util_water_tower",
		category: "water",
		footprint: [1, 1],
		waterOut: 100,
		service: "utilities"
	},
	{
		id: "t_treat",
		name: "Treatment",
		model: "util_water_treatment",
		category: "water",
		footprint: [2, 2],
		service: "utilities",
		capacity: 1e5
	},
	{
		id: "t_police",
		name: "Police",
		model: "civ_police_station",
		category: "police",
		footprint: [1, 1],
		jobs: 20,
		service: "police",
		coverage: {
			kind: "police",
			radius: 16,
			strength: 1
		}
	},
	{
		id: "t_fire",
		name: "Fire",
		model: "civ_fire_station",
		category: "fire",
		footprint: [1, 1],
		jobs: 15,
		service: "fire",
		coverage: {
			kind: "fire",
			radius: 16,
			strength: 1
		}
	},
	{
		id: "t_school",
		name: "School",
		model: "civ_elementary_school",
		category: "education",
		footprint: [1, 1],
		jobs: 20,
		service: "education",
		coverage: {
			kind: "education",
			radius: 14,
			strength: 1,
			capacity: 1e3
		}
	},
	{
		id: "t_clinic",
		name: "Clinic",
		model: "civ_clinic",
		category: "health",
		footprint: [1, 1],
		jobs: 20,
		service: "health",
		coverage: {
			kind: "health",
			radius: 14,
			strength: 1,
			capacity: 3e3
		}
	},
	{
		id: "t_park",
		name: "Park",
		model: "park_small",
		category: "park",
		footprint: [1, 1],
		coverage: {
			kind: "park",
			radius: 4,
			strength: .8
		}
	},
	{
		id: "t_incin",
		name: "Incinerator",
		model: "util_incinerator",
		category: "garbage",
		footprint: [1, 1],
		garbageCapacity: 5e3,
		service: "utilities",
		pollution: {
			air: 3,
			radius: 6
		}
	},
	{
		id: "t_bus",
		name: "Bus stop",
		model: "tr_bus_stop",
		category: "transport",
		footprint: [1, 1],
		service: "transit"
	},
	{
		id: "t_subway",
		name: "Subway",
		model: "tr_subway_station",
		category: "transport",
		footprint: [1, 1],
		service: "transit"
	},
	{
		id: "t_train",
		name: "Train station",
		model: "tr_train_station",
		category: "transport",
		footprint: [2, 1],
		service: "transit"
	},
	{
		id: "t_freight",
		name: "Freight",
		model: "tr_freight_station",
		category: "transport",
		footprint: [2, 1],
		service: "transit"
	}
];
function registerTestDefs() {
	let added = false;
	for (const d of TEST_DEFS) if (!getDef(d.id)) {
		CATALOG.push(d);
		added = true;
	}
	if (added) rebuildCatalogIndex();
	clearInfoCache();
}
function newState(size = 64, disasters = false) {
	registerTestDefs();
	const st = new CityState(defaultCityConfig({
		size,
		seed: 1234,
		terrain: "flat",
		disasters,
		treeDensity: 0,
		waterAmount: 0
	}));
	for (let i = 0; i < st.heights.length; i++) st.heights[i] = 5;
	return st;
}
function newSim(st) {
	registerTestDefs();
	return new Simulation(st, infraSystems());
}
function place(st, defId, x, z, opts = {}) {
	const def = getDef(defId) ?? TEST_DEFS.find((d) => d.id === defId);
	const [w, d] = def.footprint;
	const id = st.nextBuildingId++;
	const b = {
		id,
		def: defId,
		x,
		z,
		w,
		d,
		rot: 0,
		variant: 0,
		pop: 0,
		jobs: 0,
		capacity: def.capacity ?? def.jobs ?? 0,
		wealth: 1,
		built: 1,
		age: 100,
		flags: 0,
		baseY: 5,
		health: 1,
		unhappy: 0,
		...opts
	};
	st.buildings.set(id, b);
	for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) st.building[st.idx(xx, zz)] = id;
	return b;
}
/**
* Synthetic stress city on a size^2 map: road lines every 3 cells (2x2 blocks), avenues every 24 cells, two highways
* crossing the map; avenues and highways reach the map edges (neighbour connections). Blocks are filled with
* 1x1 / 2x2 residential, commercial (CBD in the centre) and industrial (east side) buildings.
*/
function stressCity(size = 256, seed = 7, withTransit = true) {
	registerTestDefs();
	const st = newState(size);
	let rs = seed >>> 0 || 1;
	const rnd = () => {
		rs = rs + 1831565813 >>> 0;
		let t = rs;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
	const N = size;
	let roadCells = 0;
	const isLine = (v) => v % 3 === 1;
	const hw = Math.floor(N / 2 / 3) * 3 + 1;
	for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
		const lx = isLine(x), lz = isLine(z);
		if (!lx && !lz) continue;
		const edge = x === 0 || z === 0 || x === N - 1 || z === N - 1;
		const aveX = lx && (x - 1) % 24 === 0, aveZ = lz && (z - 1) % 24 === 0;
		const hwy = lx && x === hw || lz && z === hw;
		if (edge && !aveX && !aveZ && !hwy) continue;
		let t = 1;
		if (lx && (x - 1) % 6 === 0 || lz && (z - 1) % 6 === 0) t = 2;
		if (aveX || aveZ) t = 3;
		if (hwy) t = 5;
		st.network[z * N + x] = t;
		roadCells++;
	}
	let pop = 0, jobs = 0, count = 0;
	const cx = N / 2, cz = N / 2;
	for (let bz = 0; bz < N; bz += 3) for (let bx = 0; bx < N; bx += 3) {
		const x0 = bx + 2, z0 = bz + 2;
		if (x0 + 1 >= N || z0 + 1 >= N) continue;
		const dist = Math.hypot(x0 - cx, z0 - cz) / (N / 2);
		const east = x0 > N * .78;
		if (rnd() < .12) continue;
		let kind;
		if (east) kind = rnd() < .8 ? "I" : "R";
		else if (dist < .22) kind = rnd() < .7 ? "C" : "R";
		else kind = rnd() < .12 ? "C" : "R";
		if (rnd() < (kind === "C" && dist < .22 ? .5 : .18)) {
			const id = kind === "R" ? "t_r3" : kind === "C" ? "t_co" : "t_im";
			const cap = getDef(id).capacity;
			const b = place(st, id, x0, z0, kind === "R" ? {
				pop: Math.round(cap * (.6 + rnd() * .4)),
				wealth: 3
			} : {
				jobs: Math.round(cap * .8),
				wealth: 2
			});
			zoneFor(st, b, kind);
			pop += b.pop;
			jobs += b.capacity * (kind === "R" ? 0 : 1);
			count++;
		} else for (let q = 0; q < 4; q++) {
			if (rnd() < .1) continue;
			const x = x0 + (q & 1), z = z0 + (q >> 1);
			let id;
			if (kind === "R") id = rnd() < .6 ? "t_r2" : "t_r1";
			else if (kind === "C") id = "t_cs";
			else id = rnd() < .7 ? "t_id" : "t_iht";
			const cap = getDef(id).capacity;
			const b = place(st, id, x, z, kind === "R" ? {
				pop: Math.round(cap * (.5 + rnd() * .5)),
				wealth: id === "t_r1" ? 1 : 2
			} : { jobs: Math.round(cap * .8) });
			zoneFor(st, b, kind);
			pop += b.pop;
			jobs += kind === "R" ? 0 : b.capacity;
			count++;
		}
	}
	if (withTransit) {
		for (let z = 1; z < N; z += 12) for (let x = 1; x < N; x += 12) {
			const i = z * N + x + 1;
			if (st.network[i] >= 1 && st.network[i] <= 3) st.netFlags[i] |= 16;
		}
		const sz = 97;
		for (let x = 10; x < N - 10; x++) st.subway[sz * N + x] = 1;
		for (let x = 12; x < N - 12; x += 16) {
			const bz = 98, bx = x - x % 3 + 2;
			const old = st.building[bz * N + bx];
			if (old >= 0) {
				const ob = st.buildings.get(old);
				for (let zz = ob.z; zz < ob.z + ob.d; zz++) for (let xx = ob.x; xx < ob.x + ob.w; xx++) st.building[zz * N + xx] = -1;
				st.buildings.delete(old);
				pop -= ob.pop;
				count--;
			}
			st.subway[bz * N + bx] = 1;
			place(st, "t_subway", bx, bz);
			count++;
		}
	}
	st.stats.population = pop;
	return {
		st,
		roadCells,
		buildings: count,
		pop,
		jobs
	};
}
function zoneFor(st, b, kind) {
	const z = kind === "R" ? 2 : kind === "C" ? 6 : 8;
	for (let zz = b.z; zz < b.z + b.d; zz++) for (let xx = b.x; xx < b.x + b.w; xx++) st.zone[st.idx(xx, zz)] = z;
}
const sim = newSim(stressCity(256).st);
const p = sim.getSystem("pollution");
for (let k = 0; k < 20; k++) p.compute(sim, false);
let a = 1e9;
let b = 1e9;
for (let k = 0; k < 20; k++) {
	let t0 = performance.now();
	p.stageA(sim, false);
	a = Math.min(a, performance.now() - t0);
	t0 = performance.now();
	p.stageB(sim, false);
	b = Math.min(b, performance.now() - t0);
}
console.log("pollution stageA", a.toFixed(2), "stageB", b.toFixed(2));
//#endregion
export {};
