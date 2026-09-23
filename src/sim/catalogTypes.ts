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

/** catchment tier of a service building (WP2 tier engine; police / fire are capacity-free tiers, WP2-1) */
export type ServiceTier = 'elementary' | 'high' | 'college' | 'library' | 'clinic' | 'hospital' | 'play' | 'green' | 'police' | 'fire';
/** how a catchment reaches cells: walking over streets (highways block), driving over roads, or a Euclidean disk */
export type ReachMetric = 'walk' | 'drive' | 'euclid';
/** NIMBY / YIMBY splat (0..1 at the source, smooth falloff to 0 at radius cells) */
export interface AreaEffect {
  amount: number;
  radius: number;
}

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
  /** capacity: legacy "residents served", or tier units (pupils / patient-equivalents / visitors) when `tier` is set */
  coverage?: { kind: CoverageKind; radius: number; strength: number; capacity?: number; tier?: ServiceTier; metric?: ReachMetric };
  /** land value / desirability effect (+ parks & landmarks, - dumps) */
  landValue?: { amount: number; radius: number };
  /** NIMBY: unwanted neighbour (plants, dumps, jails, airports ...) -> st.stigma (WP2) */
  stigma?: AreaEffect;
  /** YIMBY for the wealthy / high-end C (landmarks, city hall, golf ...) -> st.prestige (WP2) */
  prestige?: AreaEffect;
  /** offices / high-tech like to be near universities and research -> st.campus (WP2) */
  campus?: AreaEffect;
  /** residential household form override (default derived from model / stage; WP1 householdForm) */
  household?: 'house' | 'apartment' | 'tower';

  // ---- placement / unlocks
  placement?: 'land' | 'shore' | 'water';
  /** unlock condition id (see rewards.ts); undefined = available from start */
  requires?: string;
  /** only one allowed per city */
  unique?: boolean;
  /** hidden from toolbar (e.g. growables) */
  hidden?: boolean;
}
