/**
 * The weather calendar: what the weather is on a game day. A pure function of the day, the city's seed and its
 * climate, so the headlines (advisors.ts) and the weather on screen (src/render/world/Weather.ts) name the same day.
 * Sim code (NOTE-081): nothing here imports src/render, three or the DOM, and nothing draws from sim.rng.
 */
import type { Climate } from '../../core/types';
import { headlineHash } from './eventHeadlines';

export interface WeatherState { kind: 'clear' | 'rain' | 'snow' | 'haze'; intensity: number }

/** Three-day spells, using the city's 360-day year and a hash separate from the simulation RNG. */
export function weather(day: number, seed: number, climate: Climate = 'temperate'): WeatherState {
  const d = Math.max(0, Math.floor(day));
  const month = Math.floor(d / 30) % 12;
  const h = headlineHash(Math.floor(d / 3), 'weather', seed);
  const intensity = 0.55 + ((h >>> 8) % 46) / 100;
  if (climate === 'desert') return { kind: h % 100 < 40 ? 'haze' : 'clear', intensity: h % 100 < 40 ? intensity : 0 };
  const winter = month === 11 || month <= 1;
  const wetSeason = month >= 2 && month <= 4 || month >= 8 && month <= 10;
  const chance = wetSeason ? 60 : winter ? 35 : climate === 'tropical' ? 40 : 15;
  if (h % 100 >= chance) return { kind: 'clear', intensity: 0 };
  return { kind: winter && climate !== 'tropical' ? 'snow' : 'rain', intensity };
}
