/** GUIDE coverage is an authoritative aggregate, independent of the subscribed overlay. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Network, Overlay } from '../../src/core/types';
import { CityActions } from '../../src/sim/actions';
import { BF } from '../../src/sim/CityState';
import { lotCell } from '../../src/sim/economy/factors';
import { schedulerOf } from '../../src/sim/infra/scheduler';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { infraSystems } from '../../src/sim/systems/infra';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { QUERY_HANDLERS, runQuery, watchSignature } from '../../src/worker/queries';
import { LocalSimHost, watchFor } from '../../src/worker/SimHost';
import { newState, place, roadLine } from '../infra/cityGen';

afterEach(() => vi.restoreAllMocks());

describe('guideFacts', () => {
  it('weights police by residents and samples canonical fronts for automatic fire and every fuel plant', () => {
    const st = newState(64), a = place(st, 't_r3', 5, 5, { pop: 10 }), b = place(st, 't_r3', 10, 5, { pop: 30, rot: 2 });
    const coal = place(st, 't_coal', 20, 20), gas = place(st, 'util_gas_plant', 30, 20, { rot: 1 });
    place(st, 't_r3', 40, 20, { pop: 1000, flags: BF.Burnt });
    st.policeCov[lotCell(a, st.size)] = 1;
    st.policeCov[st.idx(b.x + (b.w >> 1), b.z + (b.d >> 1))] = 1; // a yard is not the lot cell
    st.respFire.fill(-99);
    for (const lot of [a, b, coal]) st.respFire[lotCell(lot, st.size)] = 0;
    const em = { name: 'emergency', active: true, layersReady: false }, sim = new Simulation(st, [em as SimSystem]);
    const before = structuredClone(st), rng = sim.rng.state;
    expect(runQuery(sim, 'guideFacts', {})).toEqual({ policeAtHomes: 0.25, fireCovered: 0, fuelCovered: false });
    em.layersReady = true;
    expect(runQuery(sim, 'guideFacts', {})).toEqual({ policeAtHomes: 0.25, fireCovered: 0.75, fuelCovered: false });
    st.respFire[lotCell(gas, st.size)] = 2;
    sim.events.emit('layerUpdated', 'emergency');
    const facts = runQuery(sim, 'guideFacts', {});
    expect(facts).toEqual({ policeAtHomes: 0.25, fireCovered: 1, fuelCovered: true });
    facts.fuelCovered = false;
    expect(runQuery(sim, 'guideFacts', {}).fuelCovered).toBe(true);
    st.respFire[lotCell(gas, st.size)] = -99;
    sim.events.emit('layerUpdated', 'emergency');
    expect(runQuery(sim, 'guideFacts', {}).fuelCovered).toBe(false);
    expect(sim.rng.state).toBe(rng);
    // The test's explicit layer writes are the only state changes made while querying.
    before.respFire.set(st.respFire);
    expect(structuredClone(st)).toEqual(before);
  });

  it('invalidates on edits, completed layers and resident-weight days, without re-evaluating unchanged frames', async () => {
    let now = 0;
    const st = newState(32), a = place(st, 't_r1', 5, 5, { pop: 10 }), b = place(st, 't_r1', 10, 5, { pop: 30 });
    st.policeCov[lotCell(a, st.size)] = 1;
    const host = new LocalSimHost(st, { initialSpeed: 0, now: () => now }), abort = new AbortController();
    const read = vi.spyOn(QUERY_HANDLERS, 'guideFacts'), w = watchFor(host, 'guideFacts', {}, 'change', abort.signal);
    try {
      expect(w.value?.policeAtHomes).toBe(0.25);
      for (now = 200; now <= 2000; now += 200) { host.frame(0); void w.value; }
      expect(read).toHaveBeenCalledTimes(1);
      const initial = watchSignature(host.sim, 'guideFacts', {}, 'change', 0);
      host.sim.events.emit('layerUpdated', 'traffic');
      expect(watchSignature(host.sim, 'guideFacts', {}, 'change', 0)).toBe(initial);
      a.pop = 30; st.day++; host.sim.events.emit('day', st.day);
      now += 200; host.frame(0);
      expect(w.value?.policeAtHomes).toBe(0.5);
      expect(read).toHaveBeenCalledTimes(2);
      st.policeCov[lotCell(b, st.size)] = 1;
      host.sim.events.emit('layerUpdated', 'services');
      now += 200; host.frame(0);
      expect(w.value?.policeAtHomes).toBe(1);
      b.flags |= BF.Burnt; host.sim.events.emit('buildingChanged', b);
      now += 200; host.frame(0);
      expect(w.value?.policeAtHomes).toBe(1);
      expect(read).toHaveBeenCalledTimes(4);
      host.sim.replaceState(newState(32));
      now += 200; host.frame(0);
      expect(w.value).toEqual({ policeAtHomes: 0, fireCovered: 0, fuelCovered: true });
      abort.abort('dispose');
      expect(w.value).toBeUndefined();
    } finally { abort.abort('dispose'); await host.dispose(); }
  });

  it('delivers normal-view packet updates after real police/fire station placement and removal', async () => {
    let now = 0;
    const st = newState(64); st.funds = 1e7;
    roadLine(st, 0, 20, 63, 20, Network.Road);
    place(st, 't_r2', 10, 21, { pop: 60, rot: 2 });
    place(st, 't_coal', 20, 18, { flags: BF.Plopped });
    const host = new LoopbackSimHost(st, { initialSpeed: 0, now: () => now,
      loopback: { cadence: 'design', modules: { CityActions, createSystems: infraSystems } } });
    const abort = new AbortController();
    await host.start();
    host.setView({ overlay: Overlay.None, variant: 0, panels: [], focus: [] });
    const w = watchFor(host, 'guideFacts', {}, 'change', abort.signal);
    const settle = async () => {
      host.harness.runDays(1);
      schedulerOf(host.harness.core.sim).flush(host.harness.core.sim);
      now += 250; host.harness.inbox.refresh(); await host.drain();
    };
    const query = async () => { const result = host.query('guideFacts', {}); await host.drain(); return result; };
    try {
      await host.drain();
      expect(w.value).toEqual({ policeAtHomes: 0, fireCovered: 0, fuelCovered: false });
      const police = host.act('plop', ['t_police', 8, 19, 0]); await host.drain();
      expect((await police.done).ok).toBe(true);
      const fire = host.act('plop', ['t_fire', 14, 19, 0]); await host.drain();
      expect((await fire.done).ok).toBe(true);
      await settle();
      expect(w.value).toEqual(await query());
      expect(w.value!.policeAtHomes).toBeGreaterThan(0.5);
      expect(w.value!.fireCovered).toBe(1);
      expect(w.value!.fuelCovered).toBe(true);
      // These rasters are intentionally still the initial normal-view copies, not the source of the totals.
      expect(host.state.policeCov[host.state.idx(10, 21)]).toBe(0);
      expect(host.state.respFire[host.state.idx(10, 21)]).toBeLessThan(0);
      const remove = host.act('bulldoze', [{ x0: 8, z0: 19, x1: 15, z1: 20 }]); await host.drain();
      expect((await remove.done).ok).toBe(true);
      await settle();
      expect(w.value).toEqual({ policeAtHomes: 0, fireCovered: 0, fuelCovered: false });
      expect(w.value).toEqual(await query());
    } finally { abort.abort('dispose'); await host.dispose(); }
  });
});
