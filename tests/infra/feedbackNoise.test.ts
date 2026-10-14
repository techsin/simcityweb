/**
 * Final fixes F4: trees are a real noise buffer. A belt of trees between a busy road and the homes shields the homes
 * behind it (a 2-cell belt clears a typical Noisy home); trees on the far side of the road do nothing for them.
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import type { PollutionSystem } from '../../src/sim/systems/infra';
import { NOISY_THRESHOLD } from '../../src/sim/infra/params';
import { newSim, newState, place, roadLine } from './cityGen';

/** a busy highway at z = 32, a row of homes `dist` cells south of it, trees on the given rows */
function highwayRow(trips: number, dist: number, treeRows: number[]) {
  const st = newState(64);
  roadLine(st, 0, 32, 63, 32, Network.Highway);
  const homes = [];
  for (let x = 10; x < 54; x++) homes.push(place(st, 't_r2', x, 32 + dist, { pop: 60 }));
  for (const z of treeRows) for (let x = 0; x < 64; x++) st.trees[st.idx(x, z)] = 4;
  const sim = newSim(st);
  for (let x = 0; x < 64; x++) st.traffic[st.idx(x, 32)] = trips;
  sim.getSystem<PollutionSystem>('pollution')!.compute(sim, true);
  const i = st.idx(32, 32 + dist);
  return { noise: st.noise[i], noisy: homes.filter((h) => h.flags & BF.Noisy).length, homes: homes.length };
}

describe('tree belts shield the homes behind them (final fixes F4)', () => {
  it('a 2-cell belt between a busy highway and the homes clears them; a 1-cell belt helps less', () => {
    const bare = highwayRow(4000, 3, []);
    const belt = highwayRow(4000, 3, [33, 34]);
    const thin = highwayRow(4000, 3, [34]);
    console.log(`noise behind a highway: bare ${bare.noise.toFixed(3)}, 1-cell belt ${thin.noise.toFixed(3)}, 2-cell belt ${belt.noise.toFixed(3)}`);
    expect(bare.noise).toBeGreaterThan(0.6);
    expect(bare.noisy).toBe(bare.homes);
    expect(belt.noise).toBeLessThan(NOISY_THRESHOLD);
    expect(belt.noise).toBeLessThanOrEqual(0.7 * bare.noise);
    expect(belt.noisy).toBe(0);
    expect(thin.noise).toBeLessThan(bare.noise);
    expect(thin.noise).toBeGreaterThan(belt.noise);
  });

  it('trees on the far side of the road do nothing for the homes on this side', () => {
    const bare = highwayRow(4000, 3, []);
    const far = highwayRow(4000, 3, [30, 31]);
    expect(Math.abs(far.noise - bare.noise)).toBeLessThan(0.005);
    expect(far.noisy).toBe(bare.noisy);
  });
});
