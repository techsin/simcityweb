/**
 * FEEL-23's weather calendar, src/sim/economy/weatherCalendar.ts. NOTE-081 moved it there from the renderer's module,
 * src/render/world/Weather.ts, with no change: the digest below was taken from that module before the move.
 * tests/render/weather.test.ts has the calendar's rules (spells, seasons, climates) and what the renderer shows.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Climate } from '../../src/core/types';
import { weather } from '../../src/sim/economy/weatherCalendar';
import { weather as rendererWeather } from '../../src/render/world/Weather';

const CLIMATES: Climate[] = ['temperate', 'desert', 'tropical', 'alpine'];
const SEEDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12345, 987654321, 2147483647, 4294967295, -3];

describe('FEEL-23 weather calendar under src/sim (NOTE-081)', () => {
  it('names the same weather on the same day as before the move: 4 climates, 16 seeds, 10 game years each', () => {
    const rows: string[] = [];
    const days: Record<string, Record<string, number>> = {};
    for (const climate of CLIMATES) for (const seed of SEEDS) for (let day = 0; day < 3600; day++) {
      const w = weather(day, seed, climate);
      rows.push(`${climate}|${seed}|${day}|${w.kind}|${w.intensity}`);
      const of = days[climate] ??= {};
      of[w.kind] = (of[w.kind] ?? 0) + 1;
    }
    // the two-argument form is temperate; a day that is not whole or not positive
    for (const day of [-5, -0.5, 0, 0.5, 2.999, 3, 4.9, 359.99, 360, 1e6 + 0.25]) {
      const w = weather(day, 7);
      rows.push(`default|7|${day}|${w.kind}|${w.intensity}`);
    }
    expect(rows).toHaveLength(230410);
    expect(days).toEqual({
      temperate: { clear: 33342, snow: 4719, rain: 19539 },
      desert: { clear: 35721, haze: 21879 },
      tropical: { clear: 29832, rain: 27768 },
      alpine: { clear: 33342, snow: 4719, rain: 19539 },
    });
    expect(createHash('sha256').update(rows.join('\n') + '\n').digest('hex'))
      .toBe('d4ad29498b9649977221a0fb94982c67e23a7470fa4a75729a38bc0f9843a70e');
  });

  it('gives a seed one weather for three whole game days, and each climate its own reading of that spell', () => {
    expect(weather(5, 7)).toEqual({ kind: 'clear', intensity: 0 });
    for (const day of [6, 7, 8, 8.9]) expect(weather(day, 7)).toEqual({ kind: 'snow', intensity: 0.5700000000000001 });
    expect(weather(9, 7)).toEqual({ kind: 'snow', intensity: 0.8200000000000001 });
    expect(weather(6, 7, 'alpine')).toEqual(weather(6, 7));
    expect(weather(6, 7, 'tropical')).toEqual({ kind: 'rain', intensity: 0.5700000000000001 });
    expect(weather(6, 7, 'desert')).toEqual({ kind: 'haze', intensity: 0.5700000000000001 });
    expect(weather(6, 8)).toEqual({ kind: 'clear', intensity: 0 });
    expect(weather(60, 7)).toEqual({ kind: 'rain', intensity: 0.74 });
    expect(weather(63, 7)).toEqual({ kind: 'clear', intensity: 0 });
    expect(weather(-4, 7)).toEqual(weather(0, 7));
  });

  it('is the one calendar: the renderer module hands out this function under its old name', () => {
    // drop this test with the re-export in src/render/world/Weather.ts
    expect(rendererWeather).toBe(weather);
  });
});
