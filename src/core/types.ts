/**
 * Shared enums and types. This file is the CONTRACT between sim, render and UI.
 * Keep it free of DOM / three.js imports so the simulation can run headless (node/vitest).
 */

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------
export enum Zone {
  None = 0,
  ResLow = 1,
  ResMed = 2,
  ResHigh = 3,
  ComLow = 4,
  ComMed = 5,
  ComHigh = 6,
  IndAg = 7, // agriculture (farms)
  IndMed = 8, // dirty + manufacturing
  IndHigh = 9, // manufacturing + high-tech
  Landfill = 10, // garbage dump zone
}
export const ZONE_COUNT = 11;

export type ZoneFamily = 'R' | 'C' | 'I' | 'X';
export function zoneFamily(z: Zone): ZoneFamily | null {
  if (z >= Zone.ResLow && z <= Zone.ResHigh) return 'R';
  if (z >= Zone.ComLow && z <= Zone.ComHigh) return 'C';
  if (z >= Zone.IndAg && z <= Zone.IndHigh) return 'I';
  if (z === Zone.Landfill) return 'X';
  return null;
}
/** 1 = low, 2 = medium, 3 = high (agriculture counts as 1) */
export function zoneDensity(z: Zone): 0 | 1 | 2 | 3 {
  switch (z) {
    case Zone.ResLow: case Zone.ComLow: case Zone.IndAg: return 1;
    case Zone.ResMed: case Zone.ComMed: case Zone.IndMed: return 2;
    case Zone.ResHigh: case Zone.ComHigh: case Zone.IndHigh: return 3;
    default: return 0;
  }
}

/**
 * Demand / development sub-types (SC4 style). Growables belong to exactly one DevType.
 * R$ R$$ R$$$  | CS$ CS$$ CS$$$ (services) CO$$ CO$$$ (offices) | IA (agri) ID (dirty) IM (manufacturing) IHT (high tech)
 */
export enum DevType {
  R1 = 0,
  R2 = 1,
  R3 = 2,
  CS1 = 3,
  CS2 = 4,
  CS3 = 5,
  CO2 = 6,
  CO3 = 7,
  IA = 8,
  ID = 9,
  IM = 10,
  IHT = 11,
}
export const DEV_TYPE_COUNT = 12;
export const DEV_TYPE_LABELS = ['R$', 'R$$', 'R$$$', 'CS$', 'CS$$', 'CS$$$', 'CO$$', 'CO$$$', 'I-Ag', 'I-D', 'I-M', 'I-HT'];

// ---------------------------------------------------------------------------
// Transport / utility networks (one per cell in `network` layer; power lines & pipes live in own layers)
// ---------------------------------------------------------------------------
export enum Network {
  None = 0,
  Street = 1, // cheap, low capacity, slow
  Road = 2, // standard 2-lane
  Avenue = 3, // 4-lane divided, high capacity
  OneWay = 4, // one-way road (direction stored in networkDir)
  Highway = 5, // limited access, very high capacity; connects to avenues/roads through automatic ramps
  Rail = 6, // train tracks
}
export const NETWORK_COUNT = 7;
export function isRoad(n: Network): boolean {
  return n >= Network.Street && n <= Network.Highway;
}

// ---------------------------------------------------------------------------
// Terrain / theme
// ---------------------------------------------------------------------------
export type Climate = 'temperate' | 'desert' | 'tropical' | 'alpine';
export type TerrainPreset = 'region' | 'flat' | 'plains' | 'hills' | 'mountains' | 'river' | 'coast' | 'islands' | 'lakes';
export type Difficulty = 'easy' | 'medium' | 'hard' | 'sandbox';

// ---------------------------------------------------------------------------
// Data-view overlays (UI selects, renderer draws)
// ---------------------------------------------------------------------------
export enum Overlay {
  None = 0,
  Zones = 1,
  Traffic = 2,
  AirPollution = 3,
  WaterPollution = 4,
  Garbage = 5,
  LandValue = 6,
  Crime = 7,
  Police = 8,
  Fire = 9,
  Health = 10,
  Education = 11,
  Power = 12,
  Water = 13,
  Desirability = 14,
  Noise = 15,
  Transit = 16,
}

// ---------------------------------------------------------------------------
// Model surface types for the procedural building shader. Stored in the `surf` vertex attribute (x component).
// ---------------------------------------------------------------------------
export enum Surf {
  Plain = 0, // matte painted/plastered surface, uses vertex color
  WallWindows = 1, // facade with punched windows (procedural), lit at night
  GlassCurtain = 2, // glass curtain wall w/ mullions, reflective, lit floors at night
  RoofFlat = 3, // flat gravel/tar roof
  RoofTiles = 4, // pitched roof tiles / shingles
  Metal = 5, // smooth metal (tanks, pipes, rails, cars)
  Emissive = 6, // light source / neon sign; glows at night, mild by day
  GlassPlain = 7, // storefront / plain window glass, lit warm at night
  Foliage = 8, // leaves / grass / hedges (wind sway + noise)
  Water = 9, // pools, fountains
  Pavement = 10, // concrete, asphalt lots, plazas
  Corrugated = 11, // corrugated metal siding (vertical ribs)
  Brick = 12, // brick pattern, no windows
  Wood = 13, // wood planks / bark
  Stone = 14, // stone blocks / masonry
  Field = 15, // crop fields (row pattern), uses vertex color
}
