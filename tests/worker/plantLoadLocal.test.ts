/** FEEL-15: the local utilities reader follows lazy system attachment and exposes unavailable loads as null. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { UtilitiesSystem } from '../../src/sim/infra/utilities';
import { LocalSimHost } from '../../src/worker/SimHost';

const hosts: LocalSimHost[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) await host.dispose();
});

function host(): LocalSimHost {
  const state = new CityState(defaultCityConfig({ size: 32, seed: 7, terrain: 'flat', disasters: false, treeDensity: 0, waterAmount: 0 }));
  const current = new LocalSimHost(state);
  hosts.push(current);
  return current;
}

describe('LocalSimHost plant loads', () => {
  it('keeps its view stable across unavailable, attached and removed utilities systems', () => {
    const current = host(), view = current.utilities;
    expect(view.plantLoad?.(7)).toBeNull();
    const utilities = new UtilitiesSystem();
    const read = vi.spyOn(utilities, 'plantLoad').mockReturnValue(0.15);
    current.sim.systems.push(utilities);
    expect(current.utilities).toBe(view);
    expect(view.plantLoad?.(7)).toBe(0.15);
    expect(read).toHaveBeenCalledWith(7);
    for (const load of [0, 1]) {
      read.mockReturnValue(load);
      expect(view.plantLoad?.(7)).toBe(load);
    }
    current.sim.systems.pop();
    expect(view.plantLoad?.(7)).toBeNull();
  });

  it.each([-1, NaN, Infinity, -Infinity])('normalizes an unavailable or invalid system load (%s)', (load) => {
    const current = host(), utilities = new UtilitiesSystem();
    vi.spyOn(utilities, 'plantLoad').mockReturnValue(load);
    current.sim.systems.push(utilities);
    expect(current.utilities.plantLoad?.(11)).toBeNull();
  });
});
