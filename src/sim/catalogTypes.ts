/**
 * Building definition contract (stats) — the concrete catalog lives in src/sim/catalog.ts.
 * No three.js / DOM imports allowed in src/sim/**.
 */
import type { DevType, Zone } from '../core/types';

export type BuildingCategory =
  | 'growable'
  | 'power'
  | 'water'
  | 'garbage'
  | 'police'
  | 'fire'
  | 'health'
  | 'education'
  | 'park'
  | 'civic'
  | 'landmark'
  | 'reward'
  | 'transport';

export type CoverageKind = 'police' | 'fire' | 'health' | 'education' | 'park' | 'transit' | 'garbage';

export type ServiceKind = 'police' | 'fire' | 'health' | 'education' | 'transit' | 'parks' | 'utilities' | 'roads';

export interface BuildingDef {
  id: string;
  name: string;
  /** manifest model id (src/assets/manifest.ts) */
  model: string;
  category: BuildingCategory;
  /** [w, d] in cells, same as the model manifest (unrotated) */
  footprint: [number, number];
  description?: string;

  // ---- growables
  devType?: DevType;
  /** zones this growable can appear in */
  zones?: Zone[];
  /** development stage 1..8 (SC4 style); higher stages need more desirability/demand */
  stage?: number;
  /** max residents (R) or jobs (C/I) */
  capacity?: number;

  // ---- ploppables
  cost?: number;
  /** monthly maintenance */
  upkeep?: number;
  /** monthly income (casinos, business deals, etc.) */
  income?: number;
  /** jobs provided by a civic building (counts toward workforce use) */
  jobs?: number;
  /** service funding bucket this building's upkeep belongs to */
  service?: ServiceKind;

  // ---- utilities
  /** MW produced */
  powerOut?: number;
  /** MW consumed (growables: derived from capacity if omitted) */
  powerUse?: number;
  /** water produced (kL / day) */
  waterOut?: number;
  waterUse?: number;
  /** garbage processing capacity (tons / month) for garbage facilities */
  garbageCapacity?: number;

  // ---- local effects
  pollution?: { air?: number; water?: number; garbage?: number; noise?: number; radius?: number };
  coverage?: { kind: CoverageKind; radius: number; strength: number; capacity?: number };
  /** land value / desirability effect (+ parks & landmarks, - dumps) */
  landValue?: { amount: number; radius: number };

  // ---- placement / unlocks
  placement?: 'land' | 'shore' | 'water';
  /** unlock condition id (see rewards.ts); undefined = available from start */
  requires?: string;
  /** only one allowed per city */
  unique?: boolean;
  /** hidden from toolbar (e.g. growables) */
  hidden?: boolean;
}
