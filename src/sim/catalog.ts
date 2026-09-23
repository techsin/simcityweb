/**
 * Building catalog: every growable + ploppable BuildingDef with balanced stats.
 * OWNED BY the sim-core agent. Headless (no DOM / three.js). Stable exports: CATALOG, getDef, rebuildCatalogIndex.
 *
 * =====================================================================================================
 * UNIT SYSTEM (keep coherent — sim-infra, UI and the economy all rely on these):
 *   money        § (simoleons). cost = one-time build cost; upkeep = §/month at 100% funding; income = §/month.
 *   power        MW. powerOut = plant capacity at 100% funding. powerUse = average draw.
 *                resident ≈ 0.001 MW (1 kW) × wealth factor (R$ 0.8, R$$ 1.0, R$$$ 1.4);
 *                commercial job ≈ 0.0015 (CS) / 0.002 (CO) MW; industrial job 0.001 (Ag) .. 0.004 (dirty) MW;
 *                data centers are power hogs. A 1M city (incl. its ~550k jobs) needs ≈ 2–2.5 GW
 *                → 5–6 coal plants (400 MW) or 2 nuclear plants (1600 MW) — "several big plants".
 *   water        kL/day. resident ≈ 0.25 kL/day × wealth factor; C job 0.05; I job 0.15 (HT) .. 0.4 (dirty);
 *                farms irrigate (≈ 30 kL/day per field). 1M city ≈ 400k kL/day → ~8 treatment plants (50k).
 *                Growables: low density & stage < 3 don't REQUIRE water (but consume it when available).
 *   garbage      t/month. Producers: `pollution.garbage` = tons/month generated (resident ≈ 0.04, job 0.03..0.12).
 *                Processors: `garbageCapacity` = tons/month processed. 1M city ≈ 60k t/month.
 *   pollution    `pollution.air | water | noise` = intensity at the source cell on the 0..1 overlay scale,
 *                falling off (linearly) to 0 at `pollution.radius` cells. Negative = cleans (water treatment).
 *   coverage     radius in cells (16 m), strength 0..1 at the source, capacity = residents served at 100% funding.
 *   landValue    `amount` (−1..1) added to land value at the center, linear falloff to `radius` cells.
 *   jobs         jobs of a civic building (filled from the workforce like C/I jobs).
 *   capacity     growables: max residents (R) or max jobs (C / I).
 *
 * GROWABLES: ids are `<model>.<dev>.<stage>` e.g. 'res_tower.r2.7'. A model may back several defs
 * (e.g. office towers as CO$$ and CO$$$). All growables are `hidden: true`, category 'growable'.
 * Zones: low zones grow stages 1–3, medium up to 5, high up to 8 (see economy/tuning.ts ZONE_MAX_STAGE).
 *
 * LANDFILL: 'util_landfill_tile' is NOT ploppable — landfill is a Zone (Zone.Landfill). Its hidden def carries
 * per-cell stats: garbageCapacity (t/month per landfill cell), pollution, landValue and `cost` = zoning cost/cell.
 * The renderer draws the util_landfill_tile model on every landfill-zoned cell.
 * POWER PYLON: 'util_power_pylon' is NOT ploppable — placed by CityActions.buildPowerLine (§ per cell = cost).
 * =====================================================================================================
 */
import { DevType, Zone } from '../core/types';
import type { BuildingCategory, BuildingDef, ServiceKind } from './catalogTypes';
import { MANIFEST_BY_ID } from '../assets/manifest';

// ----------------------------------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------------------------------
function fp(model: string): [number, number] {
  const m = MANIFEST_BY_ID[model];
  if (!m) throw new Error(`[catalog] model "${model}" missing from manifest`);
  return [m.footprint[0], m.footprint[1]];
}

const DEV_KEY = ['r1', 'r2', 'r3', 'cs1', 'cs2', 'cs3', 'co2', 'co3', 'ia', 'id', 'im', 'iht'];
const L = 'L', M = 'M', H = 'H';
type Dens = typeof L | typeof M | typeof H;

/** wealth tier per DevType (1..3) */
export const DEV_WEALTH: readonly number[] = [1, 2, 3, 1, 2, 3, 2, 3, 1, 1, 2, 3];
export type DevFamily = 'R' | 'C' | 'I';
export function devFamily(dev: DevType): DevFamily {
  return dev <= DevType.R3 ? 'R' : dev <= DevType.CO3 ? 'C' : 'I';
}

function zonesFor(dev: DevType, dens: Dens[]): Zone[] {
  const fam = devFamily(dev);
  const out: Zone[] = [];
  for (const d of dens) {
    if (fam === 'R') out.push(d === L ? Zone.ResLow : d === M ? Zone.ResMed : Zone.ResHigh);
    else if (fam === 'C') out.push(d === L ? Zone.ComLow : d === M ? Zone.ComMed : Zone.ComHigh);
    else if (dev === DevType.IA) out.push(Zone.IndAg);
    else out.push(d === H ? Zone.IndHigh : Zone.IndMed);
  }
  return [...new Set(out)];
}

/** per-unit utility use by DevType: [MW per capacity unit, kL/day per unit, garbage t/month per unit] */
const UNIT_USE: Record<number, [number, number, number]> = {
  [DevType.R1]: [0.0008, 0.2, 0.035],
  [DevType.R2]: [0.001, 0.25, 0.04],
  [DevType.R3]: [0.0014, 0.4, 0.05],
  [DevType.CS1]: [0.0015, 0.05, 0.04],
  [DevType.CS2]: [0.0015, 0.05, 0.035],
  [DevType.CS3]: [0.0016, 0.06, 0.03],
  [DevType.CO2]: [0.002, 0.04, 0.02],
  [DevType.CO3]: [0.002, 0.04, 0.02],
  [DevType.IA]: [0.001, 3.0, 0.03],
  [DevType.ID]: [0.004, 0.4, 0.12],
  [DevType.IM]: [0.003, 0.25, 0.08],
  [DevType.IHT]: [0.0025, 0.15, 0.03],
};

/** display names for growable models (query tool) */
const GROW_NAMES: Record<string, string> = {
  res_shack: 'Shack', res_cottage: 'Cottage', res_townhouse_row: 'Townhouses', res_suburban: 'Suburban Home', res_ranch: 'Ranch House',
  res_villa: 'Villa', res_mansion: 'Mansion', res_walkup: 'Walk-up Apartments', res_tenement: 'Tenement Block', res_rowhouses: 'Brownstones',
  res_apartment: 'Apartment Building', res_condo: 'Luxury Condos', res_courtyard: 'Courtyard Apartments', res_projects: 'Housing Projects',
  res_highrise_slab: 'High-rise Slab', res_tower: 'Residential Tower', res_twin_towers: 'Twin Residential Towers', res_luxury_tower: 'Luxury Tower',
  res_supertall: 'Supertall Residences',
  com_corner_store: 'Corner Store', com_gas_station: 'Gas Station', com_diner: 'Diner', com_strip_mall: 'Strip Mall', com_restaurant: 'Restaurant',
  com_boutique: 'Boutique', com_shops_apartments: 'Shops & Apartments', com_motel: 'Motel', com_supermarket: 'Supermarket', com_hotel: 'Hotel',
  com_department_store: 'Department Store', com_office_small: 'Office Building', com_office_block: 'Office Block', com_mall: 'Shopping Mall',
  com_hotel_tower: 'Hotel Tower', com_office_tower: 'Office Tower', com_skyscraper: 'Skyscraper', com_megatower: 'Megatower',
  ind_farm_field: 'Farm Field', ind_farm_barn: 'Farmstead', ind_greenhouse: 'Greenhouses', ind_workshop: 'Workshop', ind_scrapyard: 'Scrapyard',
  ind_smokestack_factory: 'Factory', ind_refinery: 'Refinery', ind_warehouse: 'Warehouse', ind_assembly_plant: 'Assembly Plant',
  ind_depot: 'Logistics Depot', ind_tech_campus: 'Tech Campus', ind_lab: 'Research Lab', ind_datacenter: 'Data Center',
};

interface GrowOpts {
  air?: number;
  water?: number;
  noise?: number;
  radius?: number;
  powerMul?: number;
  waterMul?: number;
  description?: string;
}

function g(model: string, dev: DevType, stage: number, capacity: number, dens: Dens[], o: GrowOpts = {}): BuildingDef {
  const [pu, wu, gu] = UNIT_USE[dev];
  const def: BuildingDef = {
    id: `${model}.${DEV_KEY[dev]}.${stage}`,
    name: GROW_NAMES[model] ?? model,
    model,
    category: 'growable',
    footprint: fp(model),
    description: o.description ?? MANIFEST_BY_ID[model]?.desc,
    devType: dev,
    zones: zonesFor(dev, dens),
    stage,
    capacity,
    powerUse: round3(capacity * pu * (o.powerMul ?? 1)),
    waterUse: round3(capacity * wu * (o.waterMul ?? 1)),
    hidden: true,
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
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// ----------------------------------------------------------------------------------------------------
// GROWABLES
// ----------------------------------------------------------------------------------------------------
const R1 = DevType.R1, R2 = DevType.R2, R3 = DevType.R3;
const CS1 = DevType.CS1, CS2 = DevType.CS2, CS3 = DevType.CS3, CO2 = DevType.CO2, CO3 = DevType.CO3;
const IA = DevType.IA, ID = DevType.ID, IM = DevType.IM, IHT = DevType.IHT;

const GROWABLES: BuildingDef[] = [
  // ---------------- R$  (working class)
  g('res_shack', R1, 1, 6, [L, M]),
  g('res_cottage', R1, 2, 10, [L, M]),
  g('res_townhouse_row', R1, 3, 30, [L, M]),
  g('res_walkup', R1, 3, 60, [M, H]),
  g('res_walkup', R1, 4, 90, [M, H]),
  g('res_tenement', R1, 5, 260, [M, H]),
  g('res_projects', R1, 6, 800, [H]),
  g('res_highrise_slab', R1, 7, 1700, [H]),
  // ---------------- R$$ (middle class)
  g('res_cottage', R2, 1, 8, [L]),
  g('res_suburban', R2, 2, 14, [L, M]),
  g('res_ranch', R2, 3, 20, [L]),
  g('res_rowhouses', R2, 3, 50, [M, H]),
  g('res_apartment', R2, 4, 230, [M, H]),
  g('res_courtyard', R2, 5, 600, [M, H]),
  g('res_tower', R2, 6, 1100, [H]),
  g('res_tower', R2, 7, 1500, [H]),
  g('res_twin_towers', R2, 8, 3000, [H]),
  // ---------------- R$$$ (wealthy)
  g('res_villa', R3, 1, 6, [L, M]),
  g('res_villa', R3, 2, 8, [L]),
  g('res_mansion', R3, 3, 12, [L]),
  g('res_condo', R3, 4, 180, [M, H]),
  g('res_condo', R3, 5, 260, [M, H]),
  g('res_luxury_tower', R3, 6, 1300, [H]),
  g('res_luxury_tower', R3, 7, 1900, [H]),
  g('res_supertall', R3, 8, 6000, [H]),

  // ---------------- CS$ (cheap services)
  g('com_corner_store', CS1, 1, 8, [L, M, H], { noise: 0.05, radius: 1 }),
  g('com_diner', CS1, 1, 10, [L, M], { noise: 0.05, radius: 1 }),
  g('com_gas_station', CS1, 2, 15, [L, M], { air: 0.05, noise: 0.1, radius: 2 }),
  g('com_shops_apartments', CS1, 3, 40, [M, H], { noise: 0.05, radius: 1 }),
  g('com_motel', CS1, 3, 45, [M, H], { noise: 0.1, radius: 2 }),
  g('com_supermarket', CS1, 4, 110, [M, H], { noise: 0.15, radius: 3 }),
  g('com_hotel', CS1, 5, 200, [M, H], { noise: 0.1, radius: 2 }),
  // ---------------- CS$$
  g('com_restaurant', CS2, 1, 15, [L, M], { noise: 0.05, radius: 1 }),
  g('com_strip_mall', CS2, 2, 60, [L, M], { noise: 0.15, radius: 2 }),
  g('com_supermarket', CS2, 3, 120, [M, H], { noise: 0.15, radius: 3 }),
  g('com_hotel', CS2, 4, 220, [M, H], { noise: 0.1, radius: 2 }),
  g('com_mall', CS2, 6, 700, [H], { noise: 0.25, radius: 4 }),
  g('com_hotel_tower', CS2, 7, 1000, [H], { noise: 0.15, radius: 3 }),
  // ---------------- CS$$$
  g('com_boutique', CS3, 1, 12, [L, M, H], { noise: 0.03, radius: 1 }),
  g('com_restaurant', CS3, 2, 20, [L, M], { noise: 0.05, radius: 1 }),
  g('com_department_store', CS3, 4, 280, [M, H], { noise: 0.1, radius: 2 }),
  g('com_hotel_tower', CS3, 7, 1200, [H], { noise: 0.15, radius: 3 }),
  // ---------------- CO$$ (offices)
  g('com_office_small', CO2, 3, 200, [M, H]),
  g('com_office_block', CO2, 4, 400, [M, H]),
  g('com_office_tower', CO2, 6, 1400, [H], { noise: 0.1, radius: 2 }),
  g('com_office_tower', CO2, 7, 1800, [H], { noise: 0.1, radius: 2 }),
  // ---------------- CO$$$
  g('com_office_small', CO3, 3, 180, [M, H]),
  g('com_office_block', CO3, 5, 450, [M, H]),
  g('com_office_tower', CO3, 6, 1600, [H], { noise: 0.1, radius: 2 }),
  g('com_skyscraper', CO3, 7, 4000, [H], { noise: 0.15, radius: 3 }),
  g('com_megatower', CO3, 8, 12000, [H], { noise: 0.2, radius: 4 }),

  // ---------------- I-Ag (farms: very few jobs, lots of land, hurt by pollution)
  g('ind_farm_field', IA, 1, 8, [L], { water: 0.15, radius: 3, waterMul: 1.25 }),
  g('ind_farm_barn', IA, 1, 6, [L], { water: 0.1, radius: 2 }),
  g('ind_greenhouse', IA, 2, 30, [L], { water: 0.05, radius: 2, waterMul: 0.25 }),
  // ---------------- I-D (dirty)
  g('ind_workshop', ID, 1, 25, [M], { air: 0.2, water: 0.1, noise: 0.3, radius: 4 }),
  g('ind_scrapyard', ID, 1, 18, [M], { air: 0.15, water: 0.2, noise: 0.35, radius: 4 }),
  g('ind_smokestack_factory', ID, 3, 170, [M], { air: 0.6, water: 0.35, noise: 0.45, radius: 8 }),
  g('ind_refinery', ID, 4, 340, [M], { air: 0.8, water: 0.5, noise: 0.5, radius: 11 }),
  // ---------------- I-M (manufacturing)
  g('ind_workshop', IM, 1, 25, [M], { air: 0.1, water: 0.05, noise: 0.25, radius: 3 }),
  g('ind_depot', IM, 2, 55, [M, H], { air: 0.08, noise: 0.35, radius: 4 }),
  g('ind_warehouse', IM, 2, 80, [M, H], { air: 0.06, noise: 0.3, radius: 4 }),
  g('ind_warehouse', IM, 3, 110, [M, H], { air: 0.08, noise: 0.3, radius: 4 }),
  g('ind_assembly_plant', IM, 4, 400, [M, H], { air: 0.2, water: 0.1, noise: 0.35, radius: 6 }),
  // ---------------- I-HT (clean high tech, needs EQ)
  g('ind_lab', IHT, 2, 90, [H], { noise: 0.05, radius: 2 }),
  g('ind_datacenter', IHT, 3, 110, [H], { noise: 0.15, radius: 2, powerMul: 10 }),
  g('ind_tech_campus', IHT, 4, 520, [H], { noise: 0.05, radius: 2 }),
  g('ind_tech_campus', IHT, 5, 720, [H], { noise: 0.05, radius: 2 }),
];

// ----------------------------------------------------------------------------------------------------
// PLOPPABLES
// ----------------------------------------------------------------------------------------------------
type P = Omit<BuildingDef, 'footprint' | 'model'> & { model?: string };
function p(d: P): BuildingDef {
  const model = d.model ?? d.id;
  return { ...d, model, footprint: fp(model) };
}

const PLOPPABLES: BuildingDef[] = [
  // ================================================================ POWER
  p({ id: 'util_wind_turbine', name: 'Wind Turbine', category: 'power', service: 'utilities', cost: 800, upkeep: 16, jobs: 1, powerOut: 5,
    pollution: { noise: 0.25, radius: 3 }, description: 'Clean but small: 5 MW. Build rows of them on windy hills. Slightly noisy.' }),
  p({ id: 'util_gas_plant', name: 'Natural Gas Power Plant', category: 'power', service: 'utilities', cost: 22000, upkeep: 650, jobs: 90, powerOut: 250, waterUse: 400,
    pollution: { air: 0.45, noise: 0.3, radius: 9, garbage: 10 }, landValue: { amount: -0.12, radius: 7 },
    description: '250 MW. Cleaner than coal, moderate cost. Fuel costs scale with output.' }),
  p({ id: 'util_coal_plant', name: 'Coal Power Plant', category: 'power', service: 'utilities', cost: 25000, upkeep: 700, jobs: 180, powerOut: 400, waterUse: 800,
    pollution: { air: 1.0, water: 0.2, noise: 0.4, radius: 14, garbage: 40 }, landValue: { amount: -0.25, radius: 10 },
    description: '400 MW of cheap, dirty power. Heavy air pollution — keep it downwind of homes.' }),
  p({ id: 'util_oil_plant', name: 'Oil Power Plant', category: 'power', service: 'utilities', cost: 30000, upkeep: 800, jobs: 150, powerOut: 350, waterUse: 600,
    pollution: { air: 0.8, water: 0.25, noise: 0.35, radius: 12, garbage: 25 }, landValue: { amount: -0.2, radius: 9 },
    description: '350 MW. Pollutes less than coal but costs more to run.' }),
  p({ id: 'util_hydro_dam', name: 'Hydroelectric Station', category: 'power', service: 'utilities', cost: 12000, upkeep: 220, jobs: 25, powerOut: 80, placement: 'shore',
    pollution: { water: 0.05, noise: 0.1, radius: 3 }, description: '80 MW of clean power. Must be built on a shoreline (front side facing water).' }),
  p({ id: 'util_solar_farm', name: 'Solar Farm', category: 'power', service: 'utilities', cost: 20000, upkeep: 200, jobs: 12, powerOut: 60, requires: 'solar_power',
    description: '60 MW of silent, clean power. Expensive per MW.' }),
  p({ id: 'util_nuclear_plant', name: 'Nuclear Power Plant', category: 'power', service: 'utilities', cost: 120000, upkeep: 2800, jobs: 400, powerOut: 1600, waterUse: 3000,
    pollution: { air: 0.05, water: 0.1, noise: 0.3, radius: 8, garbage: 200 }, landValue: { amount: -0.2, radius: 12 }, requires: 'nuclear_power',
    description: '1600 MW of clean power for a metropolis. Very expensive; residents dislike living next to it.' }),
  p({ id: 'util_power_pylon', name: 'Power Line', category: 'power', service: 'utilities', cost: 5, upkeep: 0.1, hidden: true,
    description: 'Not ploppable: placed by the power line tool (cost/upkeep are per cell).' }),

  // ================================================================ WATER
  p({ id: 'util_water_tower', name: 'Water Tower', category: 'water', service: 'utilities', cost: 300, upkeep: 12, jobs: 1, waterOut: 2500, powerUse: 0.1,
    description: '2,500 kL/day. Cheap, small, works anywhere.' }),
  p({ id: 'util_water_pump', name: 'Water Pump', category: 'water', service: 'utilities', cost: 500, upkeep: 25, jobs: 3, waterOut: 5000, powerUse: 0.5,
    description: '5,000 kL/day. Pumps less if the ground water is polluted; best near fresh water.' }),
  p({ id: 'util_water_treatment', name: 'Water Treatment Plant', category: 'water', service: 'utilities', cost: 15000, upkeep: 450, jobs: 60, waterOut: 50000, powerUse: 8,
    pollution: { water: -0.5, radius: 16 }, requires: 'water_treatment',
    description: '50,000 kL/day of clean water and it cleans nearby water pollution.' }),
  p({ id: 'util_desalination', name: 'Desalination Plant', category: 'water', service: 'utilities', cost: 32000, upkeep: 900, jobs: 80, waterOut: 80000, powerUse: 25,
    placement: 'shore', requires: 'desalination', pollution: { noise: 0.15, radius: 3 },
    description: '80,000 kL/day from sea water. Coastal only; power hungry.' }),

  // ================================================================ GARBAGE
  p({ id: 'util_landfill_tile', name: 'Landfill', category: 'garbage', service: 'utilities', cost: 15, upkeep: 1, garbageCapacity: 300, hidden: true,
    pollution: { air: 0.15, water: 0.2, noise: 0.1, radius: 5 }, landValue: { amount: -0.3, radius: 6 },
    description: 'Not ploppable: landfill is a zone. Per landfill cell: 300 t/month capacity, §15 zoning, §1/month upkeep.' }),
  p({ id: 'util_recycling_center', name: 'Recycling Center', category: 'garbage', service: 'utilities', cost: 9000, upkeep: 260, jobs: 60, garbageCapacity: 4000, powerUse: 2,
    pollution: { noise: 0.2, radius: 4 }, requires: 'recycling_center', description: 'Processes 4,000 t/month of garbage cleanly.' }),
  p({ id: 'util_incinerator', name: 'Waste-to-Energy Incinerator', category: 'garbage', service: 'utilities', cost: 26000, upkeep: 700, jobs: 70, garbageCapacity: 12000, powerOut: 60,
    pollution: { air: 0.6, noise: 0.25, radius: 10 }, landValue: { amount: -0.15, radius: 8 }, requires: 'incinerator',
    description: 'Burns 12,000 t/month of garbage and generates 60 MW. Pollutes the air.' }),

  // ================================================================ POLICE
  p({ id: 'civ_police_kiosk', name: 'Police Kiosk', category: 'police', service: 'police', cost: 400, upkeep: 50, jobs: 6, powerUse: 0.05, waterUse: 2,
    coverage: { kind: 'police', radius: 12, strength: 0.6 }, description: 'Small neighborhood police post.' }),
  p({ id: 'civ_police_station', name: 'Police Station', category: 'police', service: 'police', cost: 1500, upkeep: 170, jobs: 30, powerUse: 0.2, waterUse: 8,
    coverage: { kind: 'police', radius: 26, strength: 0.85 }, description: 'Standard police station.' }),
  p({ id: 'civ_police_hq', name: 'Police Headquarters', category: 'police', service: 'police', cost: 8000, upkeep: 900, jobs: 120, powerUse: 0.8, waterUse: 30,
    coverage: { kind: 'police', radius: 42, strength: 1.0 }, requires: 'police_hq', description: 'Large, well equipped police HQ.' }),
  p({ id: 'civ_jail', name: 'Prison', category: 'police', service: 'police', cost: 12000, upkeep: 900, jobs: 150, powerUse: 1, waterUse: 120,
    coverage: { kind: 'police', radius: 64, strength: 0.15, capacity: 80000 }, landValue: { amount: -0.3, radius: 8 }, requires: 'jail',
    description: 'Keeps criminals off the streets city-wide. Nobody wants to live next to it.' }),

  // ================================================================ FIRE
  p({ id: 'civ_fire_station', name: 'Fire Station', category: 'fire', service: 'fire', cost: 1400, upkeep: 160, jobs: 25, powerUse: 0.15, waterUse: 20,
    coverage: { kind: 'fire', radius: 24, strength: 0.85 }, description: 'Standard fire station.' }),
  p({ id: 'civ_fire_hq', name: 'Fire Headquarters', category: 'fire', service: 'fire', cost: 7000, upkeep: 800, jobs: 90, powerUse: 0.5, waterUse: 60,
    coverage: { kind: 'fire', radius: 38, strength: 1.0 }, requires: 'fire_hq', description: 'Large fire HQ with training tower.' }),

  // ================================================================ HEALTH
  p({ id: 'civ_clinic', name: 'Medical Clinic', category: 'health', service: 'health', cost: 1800, upkeep: 200, jobs: 30, powerUse: 0.2, waterUse: 15,
    coverage: { kind: 'health', radius: 16, strength: 0.7, capacity: 8000 }, description: 'Neighborhood clinic (8,000 residents).' }),
  p({ id: 'civ_hospital', name: 'Hospital', category: 'health', service: 'health', cost: 9000, upkeep: 1100, jobs: 250, powerUse: 1.5, waterUse: 120,
    coverage: { kind: 'health', radius: 36, strength: 1.0, capacity: 40000 }, description: 'Full hospital (40,000 residents).' }),
  p({ id: 'civ_medical_center', name: 'Medical Research Center', category: 'health', service: 'health', cost: 30000, upkeep: 3500, jobs: 800, powerUse: 4, waterUse: 300,
    coverage: { kind: 'health', radius: 56, strength: 1.0, capacity: 120000 }, landValue: { amount: 0.1, radius: 10 }, requires: 'medical_center', unique: true,
    description: 'Reward: world-class medical campus (120,000 residents). Boosts health city-wide.' }),

  // ================================================================ EDUCATION
  p({ id: 'civ_elementary_school', name: 'Elementary School', category: 'education', service: 'education', cost: 2000, upkeep: 240, jobs: 40, powerUse: 0.2, waterUse: 20,
    coverage: { kind: 'education', radius: 20, strength: 0.7, capacity: 12000 }, description: 'Schools the kids of 12,000 residents.' }),
  p({ id: 'civ_high_school', name: 'High School', category: 'education', service: 'education', cost: 6000, upkeep: 600, jobs: 90, powerUse: 0.5, waterUse: 50,
    coverage: { kind: 'education', radius: 32, strength: 0.9, capacity: 30000 }, description: 'Serves 30,000 residents. Raises EQ.' }),
  p({ id: 'civ_college', name: 'University', category: 'education', service: 'education', cost: 25000, upkeep: 2200, jobs: 400, powerUse: 2, waterUse: 200,
    coverage: { kind: 'education', radius: 60, strength: 1.0, capacity: 80000 }, landValue: { amount: 0.15, radius: 12 }, requires: 'college',
    description: 'Big EQ boost (80,000 residents). High-tech industry and offices love it.' }),
  p({ id: 'civ_library', name: 'Public Library', category: 'education', service: 'education', cost: 2500, upkeep: 180, jobs: 20, powerUse: 0.2, waterUse: 5,
    coverage: { kind: 'education', radius: 24, strength: 0.4, capacity: 30000 }, landValue: { amount: 0.05, radius: 6 }, description: 'Lifelong learning; mild EQ boost.' }),
  p({ id: 'civ_museum', name: 'Museum', category: 'education', service: 'education', cost: 8000, upkeep: 650, jobs: 30, powerUse: 0.4, waterUse: 10,
    coverage: { kind: 'education', radius: 40, strength: 0.35, capacity: 60000 }, landValue: { amount: 0.15, radius: 10 }, requires: 'museum',
    description: 'Culture! Raises EQ and land value.' }),

  // ================================================================ CIVIC
  p({ id: 'civ_mayor_house', name: "Mayor's House", category: 'civic', cost: 2000, upkeep: 50, jobs: 4, landValue: { amount: 0.2, radius: 8 }, requires: 'mayor_house', unique: true,
    description: 'Reward: a stately home for the mayor. Raises land value around it.' }),
  p({ id: 'civ_statue', name: 'Statue of the Mayor', category: 'civic', cost: 500, upkeep: 5, landValue: { amount: 0.1, radius: 5 }, requires: 'statue', unique: true,
    description: 'Reward for high approval. The citizens adore you.' }),
  p({ id: 'civ_cemetery', name: 'Cemetery', category: 'civic', cost: 1200, upkeep: 60, jobs: 4, landValue: { amount: 0.03, radius: 4 }, requires: 'cemetery',
    description: 'Quiet green space; residents like having one nearby.' }),
  p({ id: 'civ_courthouse', name: 'Courthouse', category: 'civic', service: 'police', cost: 6000, upkeep: 400, jobs: 60, powerUse: 0.3, waterUse: 10,
    coverage: { kind: 'police', radius: 64, strength: 0.1 }, landValue: { amount: 0.1, radius: 8 }, requires: 'courthouse', unique: true,
    description: 'Reward: justice! Makes the whole police force more effective.' }),
  p({ id: 'civ_city_hall', name: 'City Hall', category: 'civic', cost: 20000, upkeep: 900, jobs: 200, powerUse: 1, waterUse: 40,
    landValue: { amount: 0.2, radius: 14 }, requires: 'city_hall', unique: true, description: 'Reward: the seat of government. Attracts offices and residents.' }),
  p({ id: 'civ_convention_center', name: 'Convention Center', category: 'civic', cost: 30000, upkeep: 1200, income: 500, jobs: 250, powerUse: 2, waterUse: 60,
    landValue: { amount: 0.1, radius: 10 }, pollution: { noise: 0.2, radius: 4 }, requires: 'convention_center', unique: true,
    description: 'Reward: brings business visitors. Big boost to commercial demand cap.' }),

  // ================================================================ PARKS & RECREATION
  p({ id: 'park_small', name: 'Small Park', category: 'park', service: 'parks', cost: 150, upkeep: 12, coverage: { kind: 'park', radius: 6, strength: 0.6 },
    landValue: { amount: 0.12, radius: 5 }, description: 'Lawn, trees and benches. Raises the residential demand cap.' }),
  p({ id: 'park_playground', name: 'Playground', category: 'park', service: 'parks', cost: 250, upkeep: 10, coverage: { kind: 'park', radius: 5, strength: 0.5 },
    landValue: { amount: 0.08, radius: 4 }, description: 'Families love it.' }),
  p({ id: 'park_basketball', name: 'Basketball Court', category: 'park', service: 'parks', cost: 300, upkeep: 12, coverage: { kind: 'park', radius: 5, strength: 0.45 },
    landValue: { amount: 0.06, radius: 4 }, description: 'Neighborhood court.' }),
  p({ id: 'park_tennis', name: 'Tennis Courts', category: 'park', service: 'parks', cost: 450, upkeep: 15, coverage: { kind: 'park', radius: 6, strength: 0.5 },
    landValue: { amount: 0.1, radius: 5 }, description: 'Popular with the well-off.' }),
  p({ id: 'park_plaza', name: 'Plaza', category: 'park', service: 'parks', cost: 500, upkeep: 25, coverage: { kind: 'park', radius: 7, strength: 0.5 },
    landValue: { amount: 0.15, radius: 6 }, description: 'Paved plaza with fountain. Great downtown.' }),
  p({ id: 'park_garden', name: 'Formal Garden', category: 'park', service: 'parks', cost: 1200, upkeep: 45, coverage: { kind: 'park', radius: 8, strength: 0.6 },
    landValue: { amount: 0.2, radius: 8 }, description: 'Hedges and flower beds. Wealthy residents love it.' }),
  p({ id: 'park_soccer', name: 'Soccer Field', category: 'park', service: 'parks', cost: 1200, upkeep: 40, coverage: { kind: 'park', radius: 10, strength: 0.6 },
    landValue: { amount: 0.08, radius: 7 }, pollution: { noise: 0.1, radius: 3 }, description: 'Field with stands and lights.' }),
  p({ id: 'park_baseball', name: 'Baseball Diamond', category: 'park', service: 'parks', cost: 1800, upkeep: 55, coverage: { kind: 'park', radius: 12, strength: 0.65 },
    landValue: { amount: 0.08, radius: 8 }, pollution: { noise: 0.1, radius: 3 }, description: 'Diamond with bleachers and lights.' }),
  p({ id: 'park_marina', name: 'Marina', category: 'park', service: 'parks', cost: 2500, upkeep: 60, placement: 'shore', coverage: { kind: 'park', radius: 10, strength: 0.6 },
    landValue: { amount: 0.25, radius: 10 }, description: 'Docks and boats. Waterfront luxury (front faces water).' }),
  p({ id: 'park_large', name: 'Large Park', category: 'park', service: 'parks', cost: 3000, upkeep: 90, coverage: { kind: 'park', radius: 14, strength: 0.9 },
    landValue: { amount: 0.25, radius: 12 }, description: 'Pond, paths and meadows. A big boost to residential demand cap.' }),
  p({ id: 'park_zoo', name: 'Zoo', category: 'park', service: 'parks', cost: 20000, upkeep: 900, income: 300, jobs: 80, powerUse: 0.5, waterUse: 100,
    coverage: { kind: 'park', radius: 30, strength: 0.9 }, landValue: { amount: 0.15, radius: 16 }, requires: 'zoo',
    description: 'Lions and tigers and bears. Huge residential cap boost, attracts visitors.' }),
  p({ id: 'park_golf', name: 'Country Club', category: 'park', service: 'parks', cost: 15000, upkeep: 400, jobs: 40, waterUse: 400,
    coverage: { kind: 'park', radius: 16, strength: 0.8 }, landValue: { amount: 0.35, radius: 16 }, requires: 'country_club', unique: true,
    description: 'Reward: golf for the elite. Magnet for R$$$ residents.' }),
  p({ id: 'park_stadium', name: 'Major League Stadium', category: 'park', service: 'parks', cost: 60000, upkeep: 1800, income: 1500, jobs: 300, powerUse: 3, waterUse: 150,
    coverage: { kind: 'park', radius: 24, strength: 0.6 }, landValue: { amount: 0.1, radius: 12 }, pollution: { noise: 0.5, radius: 10 }, requires: 'stadium', unique: true,
    description: 'Reward: big-league sports. Raises residential and commercial caps.' }),
  p({ id: 'park_amusement', name: 'Amusement Park', category: 'park', service: 'parks', cost: 45000, upkeep: 1500, income: 1200, jobs: 250, powerUse: 3, waterUse: 150,
    coverage: { kind: 'park', radius: 24, strength: 0.7 }, landValue: { amount: 0.1, radius: 12 }, pollution: { noise: 0.3, radius: 8 }, requires: 'amusement_park', unique: true,
    description: 'Roller coasters and a ferris wheel. Tourists flock to it.' }),

  // ================================================================ LANDMARKS (unlocked by population)
  p({ id: 'lm_lighthouse', name: 'Lighthouse', category: 'landmark', cost: 3000, upkeep: 20, placement: 'shore', landValue: { amount: 0.15, radius: 8 }, requires: 'lm_lighthouse', unique: true,
    description: 'Landmark (3,000 pop). Must stand on the shore.' }),
  p({ id: 'lm_clock_tower', name: 'Clock Tower', category: 'landmark', cost: 6000, upkeep: 40, landValue: { amount: 0.2, radius: 10 }, requires: 'lm_clock_tower', unique: true,
    description: 'Landmark (5,000 pop).' }),
  p({ id: 'lm_obelisk', name: 'Obelisk', category: 'landmark', cost: 10000, upkeep: 50, landValue: { amount: 0.2, radius: 12 }, requires: 'lm_obelisk', unique: true,
    description: 'Landmark (10,000 pop).' }),
  p({ id: 'lm_arch', name: 'Triumphal Arch', category: 'landmark', cost: 15000, upkeep: 60, landValue: { amount: 0.25, radius: 12 }, requires: 'lm_arch', unique: true,
    description: 'Landmark (15,000 pop).' }),
  p({ id: 'lm_observatory', name: 'Observatory', category: 'landmark', cost: 20000, upkeep: 150, jobs: 20, powerUse: 0.3,
    coverage: { kind: 'education', radius: 30, strength: 0.2, capacity: 40000 }, landValue: { amount: 0.2, radius: 12 }, requires: 'lm_observatory', unique: true,
    description: 'Landmark (25,000 pop). Mild education boost.' }),
  p({ id: 'lm_cathedral', name: 'Cathedral', category: 'landmark', cost: 30000, upkeep: 200, jobs: 10, landValue: { amount: 0.3, radius: 14 }, requires: 'lm_cathedral', unique: true,
    description: 'Landmark (35,000 pop).' }),
  p({ id: 'lm_castle', name: 'Castle', category: 'landmark', cost: 40000, upkeep: 250, jobs: 20, landValue: { amount: 0.3, radius: 16 }, requires: 'lm_castle', unique: true,
    description: 'Landmark (50,000 pop). Tourists love it.' }),
  p({ id: 'lm_pyramid', name: 'Glass Pyramid', category: 'landmark', cost: 50000, upkeep: 300, jobs: 20, landValue: { amount: 0.3, radius: 14 }, requires: 'lm_pyramid', unique: true,
    description: 'Landmark (70,000 pop).' }),
  p({ id: 'lm_ferris_wheel', name: 'Giant Observation Wheel', category: 'landmark', cost: 45000, upkeep: 350, income: 400, jobs: 40, powerUse: 1,
    landValue: { amount: 0.25, radius: 14 }, requires: 'lm_ferris_wheel', unique: true, description: 'Landmark (90,000 pop). Earns ticket income.' }),
  p({ id: 'lm_opera_house', name: 'Opera House', category: 'landmark', cost: 80000, upkeep: 600, jobs: 80, powerUse: 1,
    landValue: { amount: 0.4, radius: 18 }, requires: 'lm_opera_house', unique: true, description: 'Landmark (150,000 pop). Spectacular at the waterfront.' }),
  p({ id: 'lm_spire_tower', name: 'Observation Spire', category: 'landmark', cost: 120000, upkeep: 800, income: 800, jobs: 60, powerUse: 2,
    landValue: { amount: 0.35, radius: 20 }, requires: 'lm_spire_tower', unique: true, description: 'Landmark (250,000 pop). Dominates the skyline.' }),
  p({ id: 'lm_twin_spires', name: 'Twin Spires', category: 'landmark', cost: 200000, upkeep: 1200, jobs: 2000, powerUse: 6, waterUse: 100,
    landValue: { amount: 0.45, radius: 22 }, requires: 'lm_twin_spires', unique: true, description: 'Landmark (500,000 pop). The ultimate skyline statement.' }),

  // ================================================================ REWARDS / BUSINESS DEALS
  p({ id: 'rw_military_base', name: 'Military Base', category: 'reward', cost: 0, upkeep: 0, income: 1500, jobs: 400, powerUse: 3, waterUse: 150,
    landValue: { amount: -0.2, radius: 14 }, pollution: { noise: 0.5, air: 0.1, radius: 12 }, requires: 'military_base', unique: true,
    description: 'Business deal: the army pays §1,500/month. Noisy, lowers land value, residents nearby hate it.' }),
  p({ id: 'rw_missile_range', name: 'Missile Test Range', category: 'reward', cost: 0, upkeep: 0, income: 2500, jobs: 150, powerUse: 2, waterUse: 40,
    landValue: { amount: -0.35, radius: 18 }, pollution: { noise: 0.7, air: 0.15, radius: 16 }, requires: 'missile_range', unique: true,
    description: 'Business deal: §2,500/month. Very noisy and bad for land value.' }),
  p({ id: 'rw_toxic_dump', name: 'Toxic Waste Dump', category: 'reward', cost: 0, upkeep: 0, income: 4000, jobs: 60, powerUse: 0.5,
    landValue: { amount: -0.5, radius: 20 }, pollution: { air: 0.5, water: 0.8, radius: 14 }, requires: 'toxic_dump', unique: true,
    description: 'Business deal: §4,000/month to store other cities\' toxic waste. Terrible pollution.' }),
  p({ id: 'rw_casino', name: 'Casino Resort', category: 'reward', cost: 25000, upkeep: 400, income: 3000, jobs: 500, powerUse: 3, waterUse: 100,
    landValue: { amount: -0.05, radius: 8 }, pollution: { noise: 0.3, radius: 6 }, requires: 'casino', unique: true,
    description: 'Reward (needs Legalized Gambling): §3,000/month but attracts crime.' }),
  p({ id: 'rw_research_center', name: 'Advanced Research Center', category: 'reward', service: 'education', cost: 40000, upkeep: 1500, jobs: 600, powerUse: 5, waterUse: 60,
    coverage: { kind: 'education', radius: 50, strength: 0.35, capacity: 100000 }, landValue: { amount: 0.2, radius: 14 }, requires: 'research_center', unique: true,
    description: 'Reward (EQ milestone): boosts EQ and attracts high-tech industry.' }),

  // ================================================================ TRANSPORT
  p({ id: 'tr_bus_stop', name: 'Bus Stop', category: 'transport', service: 'transit', cost: 150, upkeep: 8, coverage: { kind: 'transit', radius: 6, strength: 0.5 },
    description: 'Place next to a road. Gets residents out of their cars.' }),
  p({ id: 'civ_bus_depot', name: 'Bus Depot', category: 'transport', service: 'transit', cost: 4000, upkeep: 350, jobs: 50, powerUse: 0.3, waterUse: 10,
    coverage: { kind: 'transit', radius: 30, strength: 0.25 }, pollution: { noise: 0.2, air: 0.05, radius: 4 },
    description: 'Runs more buses: boosts bus stop service in a wide area.' }),
  p({ id: 'tr_subway_station', name: 'Subway Station', category: 'transport', service: 'transit', cost: 1500, upkeep: 60, powerUse: 0.1,
    coverage: { kind: 'transit', radius: 9, strength: 0.8 }, description: 'Connect to subway tunnels. Fast, congestion-free commuting.' }),
  p({ id: 'tr_train_station', name: 'Passenger Train Station', category: 'transport', service: 'transit', cost: 3000, upkeep: 150, jobs: 20, powerUse: 0.2,
    coverage: { kind: 'transit', radius: 14, strength: 0.7 }, pollution: { noise: 0.2, radius: 4 }, description: 'Place next to rail tracks (platforms at the back).' }),
  p({ id: 'tr_freight_station', name: 'Freight Rail Station', category: 'transport', service: 'transit', cost: 5000, upkeep: 200, jobs: 60, powerUse: 0.3,
    pollution: { noise: 0.3, air: 0.05, radius: 6 }, landValue: { amount: -0.05, radius: 5 },
    description: 'Ships goods by rail: raises the industrial demand cap and freight access.' }),
  p({ id: 'tr_parking_garage', name: 'Parking Garage', category: 'transport', service: 'roads', cost: 2500, upkeep: 60, jobs: 4, powerUse: 0.1,
    coverage: { kind: 'transit', radius: 4, strength: 0.2 }, requires: 'parking_garage', description: 'Park-and-ride: helps commuters switch to transit.' }),
  p({ id: 'tr_ferry_terminal', name: 'Ferry Terminal', category: 'transport', service: 'transit', cost: 5000, upkeep: 150, jobs: 15, placement: 'shore', powerUse: 0.2,
    coverage: { kind: 'transit', radius: 12, strength: 0.5 }, description: 'Waterfront transit (front faces water).' }),
  p({ id: 'tr_airport_small', name: 'Municipal Airport', category: 'transport', service: 'transit', cost: 30000, upkeep: 800, income: 600, jobs: 250, powerUse: 2, waterUse: 50,
    pollution: { noise: 0.8, air: 0.1, radius: 16 }, landValue: { amount: -0.1, radius: 12 }, requires: 'airport_small',
    description: 'Business travel: big boost to the commercial demand cap. Very noisy.' }),
  p({ id: 'tr_airport_large', name: 'International Airport', category: 'transport', service: 'transit', cost: 150000, upkeep: 3500, income: 3000, jobs: 1500, powerUse: 8, waterUse: 300,
    pollution: { noise: 1.0, air: 0.2, radius: 24 }, landValue: { amount: -0.15, radius: 16 }, requires: 'airport_large',
    description: 'Reward: a global hub. Huge commercial and industrial demand cap boost.' }),
  p({ id: 'tr_seaport', name: 'Container Seaport', category: 'transport', service: 'transit', cost: 60000, upkeep: 1800, income: 1500, jobs: 600, placement: 'shore', powerUse: 4, waterUse: 60,
    pollution: { noise: 0.5, air: 0.2, water: 0.3, radius: 12 }, landValue: { amount: -0.1, radius: 10 }, requires: 'seaport',
    description: 'Reward: ships goods worldwide. Massive industrial demand cap boost (front faces water).' }),
];

export const CATALOG: BuildingDef[] = [...GROWABLES, ...PLOPPABLES];

// ----------------------------------------------------------------------------------------------------
// DEMAND CAP RELIEF (SC4 style): amount of residents (R) / jobs (C, I) of demand cap each building adds.
// Distributed over sub-types by economy/tuning.ts CAP_WEIGHT. R3/IHT entries target that sub-type only.
// ----------------------------------------------------------------------------------------------------
export interface CapRelief {
  R?: number;
  C?: number;
  I?: number;
  /** relief only for R$$$ */
  R3?: number;
  /** relief only for I-HT */
  IHT?: number;
  /** relief only for CO$$$ */
  CO3?: number;
}
export const CAP_RELIEF: Record<string, CapRelief> = {
  park_small: { R: 1500 },
  park_playground: { R: 1200 },
  park_basketball: { R: 1000 },
  park_tennis: { R: 1500, R3: 500 },
  park_plaza: { R: 2500, C: 1000 },
  park_garden: { R: 3500, R3: 1500 },
  park_soccer: { R: 4500 },
  park_baseball: { R: 6000 },
  park_marina: { R: 5000, C: 2000, R3: 2000 },
  park_large: { R: 14000 },
  park_zoo: { R: 40000, C: 8000 },
  park_golf: { R: 12000, R3: 20000 },
  park_stadium: { R: 40000, C: 25000 },
  park_amusement: { R: 50000, C: 20000 },
  civ_cemetery: { R: 2000 },
  civ_mayor_house: { R: 3000, R3: 1000 },
  civ_statue: { R: 1000 },
  civ_city_hall: { R: 10000, C: 10000, CO3: 3000 },
  civ_courthouse: { R: 5000, C: 3000 },
  civ_convention_center: { C: 30000 },
  civ_museum: { R: 3000, C: 3000 },
  civ_library: { R: 1500 },
  civ_college: { R: 6000, CO3: 5000, IHT: 5000 },
  lm_lighthouse: { R: 3000, C: 2000 },
  lm_clock_tower: { R: 5000, C: 5000 },
  lm_obelisk: { R: 6000, C: 8000 },
  lm_arch: { R: 8000, C: 10000 },
  lm_observatory: { R: 8000, C: 8000 },
  lm_cathedral: { R: 12000, C: 15000 },
  lm_castle: { R: 15000, C: 20000 },
  lm_pyramid: { R: 15000, C: 25000 },
  lm_ferris_wheel: { R: 20000, C: 25000 },
  lm_opera_house: { R: 25000, C: 40000, R3: 5000 },
  lm_spire_tower: { R: 30000, C: 50000 },
  lm_twin_spires: { R: 40000, C: 80000, CO3: 20000 },
  rw_casino: { C: 10000 },
  rw_military_base: { I: 5000 },
  rw_research_center: { IHT: 30000, CO3: 5000 },
  tr_ferry_terminal: { R: 2000, C: 1000 },
  tr_train_station: { R: 2000, C: 2000 },
  tr_freight_station: { I: 15000 },
  tr_airport_small: { C: 40000, I: 8000 },
  tr_airport_large: { C: 150000, I: 40000 },
  tr_seaport: { I: 80000 },
};
export function capReliefOf(defId: string): CapRelief | undefined {
  return CAP_RELIEF[defId];
}

// ----------------------------------------------------------------------------------------------------
// UI metadata
// ----------------------------------------------------------------------------------------------------
export interface CategoryInfo {
  id: BuildingCategory;
  name: string;
  /** suggested icon id (UI owns the actual icon set) */
  icon: string;
  description: string;
  /** toolbar order */
  order: number;
}
export const CATEGORY_INFO: Record<BuildingCategory, CategoryInfo> = {
  growable: { id: 'growable', name: 'Growables', icon: 'building', description: 'Buildings that grow on zones (not ploppable).', order: 99 },
  power: { id: 'power', name: 'Power', icon: 'bolt', description: 'Power plants. Connect to zones with power lines.', order: 1 },
  water: { id: 'water', name: 'Water', icon: 'droplet', description: 'Water pumps, towers and treatment.', order: 2 },
  garbage: { id: 'garbage', name: 'Garbage', icon: 'trash', description: 'Recycling and incineration (landfill is a zone).', order: 3 },
  police: { id: 'police', name: 'Police', icon: 'shield', description: 'Fight crime.', order: 4 },
  fire: { id: 'fire', name: 'Fire', icon: 'flame', description: 'Fight and prevent fires.', order: 5 },
  health: { id: 'health', name: 'Health', icon: 'cross', description: 'Clinics and hospitals raise health (HQ).', order: 6 },
  education: { id: 'education', name: 'Education', icon: 'book', description: 'Schools raise the education quotient (EQ).', order: 7 },
  park: { id: 'park', name: 'Parks & Recreation', icon: 'tree', description: 'Raise land value and the residential demand cap.', order: 8 },
  civic: { id: 'civic', name: 'Civic', icon: 'landmark', description: 'Government buildings and civic rewards.', order: 9 },
  transport: { id: 'transport', name: 'Transport', icon: 'bus', description: 'Transit stations, airports and seaports.', order: 10 },
  landmark: { id: 'landmark', name: 'Landmarks', icon: 'star', description: 'Unlocked by population. Boost land value and tourism.', order: 11 },
  reward: { id: 'reward', name: 'Rewards & Deals', icon: 'gift', description: 'Special rewards and business deals.', order: 12 },
};
/** ploppable categories in toolbar order */
export const PLOP_CATEGORIES: BuildingCategory[] = (Object.keys(CATEGORY_INFO) as BuildingCategory[])
  .filter((c) => c !== 'growable')
  .sort((a, b) => CATEGORY_INFO[a].order - CATEGORY_INFO[b].order);

/** Human-readable service bucket names (budget panel). */
export const SERVICE_NAMES: Record<ServiceKind, string> = {
  police: 'Police',
  fire: 'Fire',
  health: 'Health',
  education: 'Education',
  transit: 'Transit',
  parks: 'Parks & Recreation',
  utilities: 'Utilities',
  roads: 'Roads',
};

/** Which DevTypes can grow in which zone (index = Zone). */
export const ZONE_DEVTYPES: readonly (readonly DevType[])[] = [
  [], // None
  [R1, R2, R3], // ResLow
  [R1, R2, R3],
  [R1, R2, R3],
  [CS1, CS2, CS3], // ComLow
  [CS1, CS2, CS3, CO2, CO3],
  [CS1, CS2, CS3, CO2, CO3],
  [IA], // IndAg
  [ID, IM], // IndMed: dirty + manufacturing
  [IM, IHT], // IndHigh: manufacturing + high-tech
  [], // Landfill
];

// ----------------------------------------------------------------------------------------------------
// index + queries
// ----------------------------------------------------------------------------------------------------
const byId = new Map<string, BuildingDef>();
let growByDev: BuildingDef[][] = [];
let growByZone: BuildingDef[][] = [];
export function rebuildCatalogIndex(): void {
  byId.clear();
  for (const d of CATALOG) byId.set(d.id, d);
  growByDev = Array.from({ length: 12 }, () => [] as BuildingDef[]);
  growByZone = Array.from({ length: 11 }, () => [] as BuildingDef[]);
  for (const d of CATALOG) {
    if (d.category !== 'growable' || d.devType === undefined) continue;
    growByDev[d.devType].push(d);
    for (const z of d.zones ?? []) growByZone[z].push(d);
  }
  for (const list of growByDev) list.sort((a, b) => (a.stage ?? 0) - (b.stage ?? 0) || (a.capacity ?? 0) - (b.capacity ?? 0));
  for (const list of growByZone) list.sort((a, b) => (a.stage ?? 0) - (b.stage ?? 0) || (a.capacity ?? 0) - (b.capacity ?? 0));
}
rebuildCatalogIndex();

export function getDef(id: string): BuildingDef | undefined {
  return byId.get(id);
}

/** All growable defs of a DevType, sorted by stage then capacity. (Returned array is shared — don't mutate.) */
export function growablesFor(dev: DevType): readonly BuildingDef[] {
  return growByDev[dev] ?? [];
}

/** Growables that can appear in a zone, sorted by stage. (Shared array — don't mutate.) */
export function growablesForZone(zone: Zone): readonly BuildingDef[] {
  return growByZone[zone] ?? [];
}

/** Non-hidden ploppable defs, optionally filtered by category, sorted by cost. */
export function ploppables(category?: BuildingCategory): BuildingDef[] {
  return CATALOG.filter((d) => d.category !== 'growable' && !d.hidden && (!category || d.category === category)).sort(
    (a, b) => (a.cost ?? 0) - (b.cost ?? 0),
  );
}

/** Footprint in cells after rotation: [cells along x, cells along z]. rot 1/3 swap w and d. */
export function rotatedFootprint(def: Pick<BuildingDef, 'footprint'>, rot: number): [number, number] {
  const [w, d] = def.footprint;
  return rot & 1 ? [d, w] : [w, d];
}

/** true when the def is a growable (zone-grown) building */
export function isGrowable(def: BuildingDef | undefined): boolean {
  return !!def && def.category === 'growable';
}
