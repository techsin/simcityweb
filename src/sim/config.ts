import type { Climate, Difficulty, TerrainPreset } from '../core/types';
import { START_YEAR } from '../core/constants';

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
    disasters: true,
    startFunds: DIFFICULTY_FUNDS[difficulty],
    startYear: START_YEAR,
    sandbox: difficulty === 'sandbox',
    ...partial,
  };
}
