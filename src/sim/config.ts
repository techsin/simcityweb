import type { Climate, Difficulty, TerrainPreset } from '../core/types';
import { START_YEAR } from '../core/constants';
import { difficultyRules } from './economy/tuning';
import type { MayorChallenge } from './economy/challenges';

/**
 * LG-14: what the save of a scenario city carries. The scenarios, and what each makes of these figures, live in
 * src/game/scenarios.ts (ScenarioStart: this record with an id that build knows); the simulation never reads it.
 */
export interface ScenarioRecord {
  /** the scenario's id (a save from another build may name one this build does not know: free play) */
  id: string;
  /** the day the scenario started on (CityState.day; a month's first day) */
  startDay: number;
  /** Smog City: the air pollution at homes (history.air) averaged over the 12 months before the start */
  air?: number;
  /** Lights Out: the loans outstanding at the start as [principal, annual rate]; any other loan is a new one */
  loans?: [number, number][];
}

/** Everything chosen in the "new city" dialog. Serializable. */
export interface CityConfigData {
  name: string;
  mayor: string;
  /** cells per side: 64 | 128 | 256 */
  size: number;
  seed: number;
  difficulty: Difficulty;
  climate: Climate;
  terrain: TerrainPreset;
  /** 0..1 amount of water (sea level offset for presets) */
  waterAmount: number;
  /** 0..1 terrain roughness / hilliness */
  hilliness: number;
  /** 0..1 forest coverage */
  treeDensity: number;
  disasters: boolean;
  startFunds: number;
  startYear: number;
  /** region linkage (optional) */
  regionId?: string;
  /** region tile position (region units) */
  tileX?: number;
  tileZ?: number;
  /** sandbox: unlimited money + everything unlocked */
  sandbox?: boolean;
  /** LG-14: the Mayor's challenges the city was founded with (their rules: economy/challenges.ts). Absent: none */
  challenges?: MayorChallenge[];
  /** LG-14: the scenario this city is and what its goals are measured from. Written once, when the city is founded or
   *  bundled. Absent: free play */
  scenario?: ScenarioRecord;
}

export const DIFFICULTY_FUNDS: Record<Difficulty, number> = {
  easy: 250_000,
  medium: 100_000,
  hard: 40_000,
  sandbox: 10_000_000,
};

export function defaultCityConfig(partial: Partial<CityConfigData> = {}): CityConfigData {
  const difficulty = partial.difficulty ?? 'medium';
  return {
    name: 'New City',
    mayor: 'Mayor',
    size: 128,
    seed: Math.floor(Math.random() * 1e9),
    difficulty,
    climate: 'temperate',
    terrain: 'hills',
    waterAmount: 0.3,
    hilliness: 0.4,
    treeDensity: 0.45,
    disasters: difficultyRules(difficulty).defaultDisasters,
    startFunds: DIFFICULTY_FUNDS[difficulty],
    startYear: START_YEAR,
    sandbox: difficulty === 'sandbox',
    ...partial,
  };
}
