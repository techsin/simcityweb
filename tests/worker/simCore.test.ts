/** W0.1: boot order, system isolation and the c4 reporting holder belong to the headless core. */
import { describe, expect, it, vi } from 'vitest';
import { DAYS_PER_MONTH, MONTHS_PER_YEAR } from '../../src/core/constants';
import { Network } from '../../src/core/types';
import type { RegionContext } from '../../src/region/regionEffects';
import { CityActions } from '../../src/sim/actions';
import type { Simulation, SimSystem } from '../../src/sim/Simulation';
import { SimCore } from '../../src/worker/SimCore';
import { newState } from '../infra/cityGen';

function region(): RegionContext {
  return {
    regionId: 'test', tileKey: 'home', population: 1000, jobs: 5000, workers: 500,
    adjacentPopulation: 1000, adjacentJobs: 5000, adjacentWorkers: 500, jobBonus: 0, workerBonus: 0,
    neighbors: [{ edge: 'n', tileKey: 'north', name: 'North', founded: true, population: 1000,
      jobs: 5000, workers: 500, r: 1000, c: 5000, i: 0, from: 0, to: 32 }],
  };
}

describe('SimCore boot', () => {
  it('applies regional effects before creating systems, pushes every system before init, then constructs actions', () => {
    const st = newState(32);
    const core = new SimCore(st);
    const calls: string[] = [];
    let monthlyJobs: unknown;
    let off: (() => void) | undefined;
    const systems: SimSystem[] = [
      { name: 'first', init(sim) {
        calls.push('first');
        expect(sim.getSystem('second')).toBe(systems[1]);
        off = sim.events.on('month', () => { monthlyJobs = st.systemData.regionJobs; });
      } },
      { name: 'second', init() { calls.push('second'); } },
    ];
    const mods = {
      createSystems: () => {
        calls.push('create');
        expect(st.systemData.region).toMatchObject({ regionId: 'test', tileKey: 'home' });
        return systems;
      },
      CityActions: class extends CityActions {
        constructor(sim: Simulation) { super(sim); calls.push('actions'); }
      },
    };
    core.frame(0.1); // no time passes before boot
    expect(st.day).toBe(0);
    core.boot(region(), mods);
    expect(calls).toEqual(['create', 'first', 'second', 'actions']);
    expect(core.actions).toBeInstanceOf(CityActions);
    const entryJobs = st.systemData.regionJobs as number;
    st.neighborConnections = [{ edge: 'n', x: 4, z: 0, type: Network.Highway }];
    core.sim.runDays(DAYS_PER_MONTH);
    expect(monthlyJobs).toBeGreaterThan(entryJobs);
    expect(monthlyJobs).toBe(st.systemData.regionJobs); // region listener precedes the one installed by init
    core.boot(region(), mods);
    expect(calls).toHaveLength(4);
    core.dispose();
    off?.();
    st.neighborConnections = [];
    core.sim.events.emit('month', 2);
    expect(st.systemData.regionJobs).toBe(monthlyJobs);
    const day = st.day;
    core.frame(0.1);
    expect(st.day).toBe(day);
  });

  it('reports construction failures separately and still starts whichever part loaded', () => {
    const report = vi.fn();
    const core = new SimCore(newState(32), { report });
    const systemsError = new Error('systems');
    core.boot(null, { createSystems: () => { throw systemsError; }, CityActions });
    expect(report).toHaveBeenCalledWith('Simulation systems failed to start', systemsError, { sim: true });
    expect(core.actions).toBeInstanceOf(CityActions);
    core.dispose();

    const actionsError = new Error('actions');
    const other = new SimCore(newState(32), { report });
    const init = vi.fn();
    other.boot(null, {
      createSystems: () => [{ name: 'good', init }],
      CityActions: class extends CityActions { constructor(sim: Simulation) { super(sim); throw actionsError; } },
    });
    expect(init).toHaveBeenCalledTimes(1);
    expect(other.actions).toBeNull();
    expect(report).toHaveBeenCalledWith('CityActions failed to construct — using stand-in actions', actionsError, undefined);
    other.dispose();
  });
});

describe('SimCore system guards', () => {
  it.each(['init', 'daily', 'monthly', 'yearly', 'frame'] as const)('preserves the existing >20 cutoff for %s and keeps other hooks running', (method) => {
    const error = new Error(method);
    const report = vi.fn();
    const core = new SimCore(newState(32), { report });
    const fail = vi.fn(function (this: SimSystem, sim: Simulation) {
      expect(this.name).toBe('broken');
      expect(sim).toBe(core.sim);
      throw error;
    });
    const good = vi.fn();
    core.boot(null, { createSystems: () => [{ name: 'broken', [method]: fail }, { name: 'good', [method]: good }] });
    for (let n = 0; n < 25; n++) {
      if (method === 'init') core.sim.replaceState(newState(32));
      else if (method === 'frame') core.frame(0);
      else {
        core.sim.state.day = method === 'yearly' ? DAYS_PER_MONTH * MONTHS_PER_YEAR - 1 : DAYS_PER_MONTH - 1;
        core.sim.runDays(1);
      }
    }
    expect(fail).toHaveBeenCalledTimes(21);
    expect(good.mock.calls.length).toBeGreaterThan(21);
    expect(report).toHaveBeenCalledTimes(21);
    expect(report.mock.calls[19][0]).not.toContain('disabled');
    expect(report).toHaveBeenLastCalledWith(`Simulation system “broken” failed (${method}) — disabled`, error, { key: `sys:broken:${method}`, sim: true });
    core.dispose();
  });

  it('clears the reporting holder at dispose, even when a system wrapper outlives it (c4)', () => {
    const report = vi.fn();
    const core = new SimCore(newState(32), { report });
    const daily = vi.fn(() => { throw new Error('retained system'); });
    const system: SimSystem = { name: 'retained', daily };
    core.boot(null, { createSystems: () => [system] });
    system.daily!(core.sim);
    expect(report).toHaveBeenCalledTimes(1);
    core.dispose();
    core.dispose();
    expect((core as unknown as { guard: { errors: unknown } }).guard.errors).toBeNull();
    system.daily!(core.sim);
    expect(daily).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledTimes(1);
    const createSystems = vi.fn();
    core.boot(null, { createSystems });
    expect(createSystems).not.toHaveBeenCalled();
  });
});
