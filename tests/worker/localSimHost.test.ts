/** W0.1: the local host keeps the lazy boot, live clock and deterministic save state of the old scene. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { applyRegionEffects, trackRegionEffects, type RegionContext } from '../../src/region/regionEffects';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { CityActions } from '../../src/sim/actions';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState, place } from '../infra/cityGen';

afterEach(() => vi.restoreAllMocks());

describe('LocalSimHost', () => {
  it('keeps the action proxy stable, boots only once, and delegates the live clock and state', async () => {
    const host = new LocalSimHost(newState(32), { initialSpeed: 3 });
    const actions = host.actions;
    expect(host.kind).toBe('local');
    expect(host.degradedActions).toBe(true);
    expect(host.sim.systems).toHaveLength(0);
    host.frame(0.1);
    expect(host.state.day).toBe(0);
    await Promise.all([host.start(), host.start(), host.ready]);
    const systems = host.sim.systems.slice();
    expect(systems.length).toBeGreaterThan(0);
    expect(host.degradedActions).toBe(false);
    expect(host.actions).toBe(actions);
    expect(actions.target).toBeInstanceOf(CityActions);
    await host.start();
    expect(host.sim.systems).toEqual(systems);
    expect(host.events).toBe(host.sim.events);
    expect(host.speed).toBe(3);
    host.sim.speed = 0;
    const update = vi.spyOn(host.sim, 'update');
    host.frame(1 / 60);
    expect(update).toHaveBeenCalledExactlyOnceWith(1 / 60); // frame hooks still run while paused
    expect(host.state.day).toBe(0);
    host.sim.speed = 1;
    host.sim.liveSlowdown = 4;
    expect(host.liveSlowdown).toBe(4);
    expect(host.secondsPerDay()).toBe(host.sim.secondsPerDay());
    expect(host.simTime()).toBe(host.sim.simTime());
    const next = newState(32);
    host.sim.replaceState(next);
    expect(host.state).toBe(next);
    await host.dispose();
    host.frame(0.1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('an exit while imports are pending settles ready without attaching systems or real actions', async () => {
    const report = vi.fn();
    const host = new LocalSimHost(newState(32), { errors: { report } });
    const starting = host.start();
    await host.dispose();
    await starting;
    await host.ready;
    await host.start();
    expect(host.sim.systems).toHaveLength(0);
    expect(host.degradedActions).toBe(true);
    expect(report).not.toHaveBeenCalled();
    host.frame(0.1);
    expect(host.state.day).toBe(0);
    const unstarted = new LocalSimHost(newState(32));
    await unstarted.dispose();
    await unstarted.ready;
    await unstarted.start();
    expect(unstarted.sim.systems).toHaveLength(0);
  });

  it('rejects ready and start on a boot failure outside the recoverable module guards', async () => {
    const rctx: RegionContext = { regionId: 'test', tileKey: 'home', neighbors: [], population: 0, jobs: 0, workers: 0,
      adjacentPopulation: 0, adjacentJobs: 0, adjacentWorkers: 0, jobBonus: 0, workerBonus: 0 };
    const error = new Error('region boot failed');
    vi.spyOn(rctx.neighbors, 'map').mockImplementation(() => { throw error; });
    const host = new LocalSimHost(newState(32), { rctx });
    const ready = expect(host.ready).rejects.toBe(error);
    await expect(host.start()).rejects.toBe(error);
    await ready;
    expect(host.sim.systems).toHaveLength(0);
    host.frame(0.1);
    expect(host.state.day).toBe(0);
    await host.dispose();
  });

  it('matches the pre-host boot through actions, month/year boundaries and a save/load continuation', { timeout: 120000 }, async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0); // serialized save timestamps are not simulation state
    const initial = newState(32);
    initial.config.seed = 7;
    initial.day = 358;
    initial.funds = 1e6;
    place(initial, 't_coal', 2, 13);
    place(initial, 't_pump', 6, 14);
    for (let x = 4; x < 20; x += 2) place(initial, 't_r1', x, 17, { pop: 10, capacity: 12 });
    place(initial, 't_cs', 22, 17, { jobs: 20 });
    const saved = serializeCity(initial, { copy: true });
    const rctx: RegionContext = { regionId: 'test', tileKey: 'home', neighbors: [], population: 0, jobs: 0, workers: 0,
      adjacentPopulation: 0, adjacentJobs: 0, adjacentWorkers: 0, jobBonus: 0, workerBonus: 0 };
    // The old App + CityScene order: entry effects, empty sim, region tracking, all systems pushed, then init/actions.
    const st = deserializeCity(saved);
    applyRegionEffects(st, rctx);
    const sim = new Simulation(st, []);
    const off = trackRegionEffects(sim, rctx);
    const systems = createSystems();
    sim.systems.push(...systems);
    for (const s of systems) s.init?.(sim);
    const actions = new CityActions(sim);
    const report = vi.fn();
    const host = new LocalSimHost(deserializeCity(saved), { rctx, errors: { report } });
    await host.start();
    const road = Array.from({ length: 28 }, (_, x) => ({ x: x + 2, z: 16 }));
    expect(host.actions.buildNetwork(road, Network.Road)).toEqual(actions.buildNetwork(road, Network.Road));
    const lot = { x0: 3, z0: 17, x1: 20, z1: 20 };
    expect(host.actions.zone(lot, Zone.ResLow)).toEqual(actions.zone(lot, Zone.ResLow));
    const trees = { x0: 3, z0: 3, x1: 8, z1: 8 };
    expect(host.actions.plantTrees(trees)).toEqual(actions.plantTrees(trees));
    sim.runDays(45);
    host.sim.runDays(45);
    expect(serializeCity(host.sim.state, { copy: true })).toEqual(serializeCity(sim.state, { copy: true }));
    expect(host.sim.rng.state).toBe(sim.rng.state);
    expect(report).not.toHaveBeenCalled();

    const loaded = new LocalSimHost(deserializeCity(serializeCity(host.sim.state, { copy: true })), { rctx, errors: { report } });
    const baseline = new Simulation(deserializeCity(serializeCity(sim.state, { copy: true })), []);
    const offLoaded = trackRegionEffects(baseline, rctx);
    const loadedSystems = createSystems();
    baseline.systems.push(...loadedSystems);
    for (const s of loadedSystems) s.init?.(baseline);
    await loaded.start();
    baseline.runDays(30);
    loaded.sim.runDays(30);
    expect(serializeCity(loaded.sim.state, { copy: true })).toEqual(serializeCity(baseline.state, { copy: true }));
    expect(loaded.sim.rng.state).toBe(baseline.rng.state);
    expect(report).not.toHaveBeenCalled();
    off();
    offLoaded();
    await host.dispose();
    await loaded.dispose();
  });
});
