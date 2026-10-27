/** W0.3b: placement reads retain their prices without writes, aliases or cross-footprint cache hits. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Network } from '../../src/core/types';
import { fundingFactor } from '../../src/sim/infra/common';
import type { SimSystem } from '../../src/sim/Simulation';
import { LocalSimHost, watchFor } from '../../src/worker/SimHost';
import { QUERY_HANDLERS } from '../../src/worker/queries';
import { newState, roadLine } from '../infra/cityGen';

afterEach(() => vi.restoreAllMocks());

const args = { defId: 'civ_elementary_school', x: 10, z: 11, w: 1, d: 1 };
function fixture() {
  let now = 0;
  const st = newState(32);
  st.systemData.infraVersion = 1;
  roadLine(st, 2, 10, 29, 10, Network.Road);
  const need = new Float32Array(st.cells);
  need[st.idx(10, 11)] = 100;
  const host = new LocalSimHost(st, { initialSpeed: 0, now: () => now });
  host.sim.systems.push({ name: 'services', needRaster: () => need } as unknown as SimSystem);
  return { host, st, need, time: (v: number) => { now = v; } };
}

describe('upkeepContext', () => {
  it('keys pending queries by every argument and clones query and watch results in tests', async () => {
    const f = fixture(), read = vi.spyOn(QUERY_HANDLERS, 'upkeepContext');
    try {
      const first = f.host.query('upkeepContext', args);
      expect(f.host.query('upkeepContext', { d: 1, w: 1, z: 11, x: 10, defId: args.defId })).toBe(first);
      expect(read).toHaveBeenCalledTimes(1);
      const others = Object.entries({ defId: 'civ_clinic', x: 25, z: 25, w: 2, d: 2 }).map(([key, value]) =>
        f.host.query('upkeepContext', { ...args, [key]: value }));
      expect(read).toHaveBeenCalledTimes(6);
      const result = await first;
      expect(result).toEqual({ here: 132 });
      expect(result).not.toBe(read.mock.results[0].value);
      await Promise.all(others);
      const w = f.host.watch('upkeepContext', args, 'change');
      expect(w.value).toEqual({ here: 132 });
      expect(w.value).not.toBe(read.mock.results.at(-1)!.value);
      result.here = 999;
      expect(w.value?.here).toBe(132);
      w.value!.here = 888;
      expect((await f.host.query('upkeepContext', args)).here).toBe(132);
      expect(f.need[f.st.idx(10, 11)]).toBe(100);
    } finally { await f.host.dispose(); }
  });

  it('caches each footprint, refreshes after paused commands and days, and disposes with the city', async () => {
    const f = fixture(), abort = new AbortController(), read = vi.spyOn(QUERY_HANDLERS, 'upkeepContext');
    try {
      const w = watchFor(f.host, 'upkeepContext', args, 'change', abort.signal);
      expect(w.value?.here).toBe(132);
      w.setArgs({ ...args, x: 25, z: 25 });
      expect(w.value).toBeUndefined();
      f.time(200);
      expect(w.value?.here).toBe(72);
      w.setArgs(args);
      expect(w.value?.here).toBe(132);
      expect(read).toHaveBeenCalledTimes(2);
      f.host.act('setFunding', ['education', 50]);
      f.time(399); f.host.frame(0);
      expect(w.value?.here).toBe(132);
      f.time(400); f.host.frame(0);
      expect(w.value?.here).toBeCloseTo(108.93433240034749, 8);
      expect(f.st.day).toBe(0);
      f.need[f.st.idx(10, 11)] = 200;
      f.st.day++;
      f.time(600); f.host.frame(0);
      expect(w.value?.here).toBeCloseTo(145.86866480069498, 8);
      abort.abort('dispose');
      f.time(800); f.st.day++; f.host.frame(0);
      expect(w.value).toBeUndefined();
      expect(read).toHaveBeenCalledTimes(4);
    } finally { abort.abort('dispose'); await f.host.dispose(); }
  });

  it.each([
    ['missing', undefined], ['old version', { v: 0, strikes: { education: 2 } }],
    ['partial v1', { v: 1 }], ['v1', { v: 1, strikes: {} }], ['strike', { v: 1, strikes: { education: 2 } }],
  ])('matches the former funding curve with %s economy data without initializing or normalizing it', async (_name, economy) => {
    for (const funding of [0, 50, 100, 150, NaN]) {
      const f = fixture();
      try {
        f.st.systemData.economy = structuredClone(economy);
        f.st.budget.funding.education = funding;
        f.need[f.st.idx(10, 11)] = 10000; // full 1,500 seats; quality stays below the cell's remaining need
        const legacy = newState(32);
        legacy.systemData.economy = structuredClone(economy);
        legacy.budget.funding.education = funding;
        const expected = 72 + 1500 * fundingFactor(legacy, 'education') * 0.6;
        if (f.st.systemData.economy) Object.freeze(f.st.systemData.economy);
        Object.freeze(f.st.systemData);
        const before = structuredClone(f.st), rng = f.host.sim.rng.state, raster = f.need.slice();
        const result = await f.host.query('upkeepContext', args);
        expect(result.here, `${_name}, funding ${funding}`).toBeCloseTo(expected, 8);
        expect(structuredClone(f.st)).toEqual(before);
        expect(f.host.sim.rng.state).toBe(rng);
        expect(f.need).toEqual(raster);
      } finally { await f.host.dispose(); }
    }
  });

  it('keeps null fallbacks for missing definitions, tiers, rasters and infrastructure', async () => {
    const f = fixture();
    try {
      for (const defId of ['missing-def', 'tr_parking_garage']) {
        expect(await f.host.query('upkeepContext', { ...args, defId })).toEqual({ here: null });
      }
      f.host.sim.systems.length = 0;
      expect(await f.host.query('upkeepContext', args)).toEqual({ here: null });
      f.host.sim.systems.push({ name: 'services', needRaster: () => new Float32Array(1) } as unknown as SimSystem);
      expect(await f.host.query('upkeepContext', args)).toEqual({ here: null });
      f.host.sim.systems.length = 0;
      f.host.sim.systems.push({ name: 'services', needRaster: () => f.need } as unknown as SimSystem);
      f.st.systemData.infraVersion = undefined;
      expect(await f.host.query('upkeepContext', args)).toEqual({ here: null });
    } finally { await f.host.dispose(); }
  });
});
