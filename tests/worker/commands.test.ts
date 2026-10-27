/** W0.2: commands retain the old actions' results/state and expose their cause only during their effects. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevType, Network, Zone } from '../../src/core/types';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { BF } from '../../src/sim/CityState';
import { CityActions } from '../../src/sim/actions';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import { LocalSimHost, type Cause, type Command } from '../../src/worker/SimHost';
import { newState, place } from '../infra/cityGen';

afterEach(() => vi.restoreAllMocks());

describe('LocalSimHost commands', () => {
  it('matches direct map actions, including RNG, with exact synchronous predictions and matching acknowledgements', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const st = newState(32);
    st.funds = 1e6;
    const sim = new Simulation(deserializeCity(serializeCity(st, { copy: true })), createSystems());
    const actions = new CityActions(sim);
    const host = new LocalSimHost(st);
    await host.start();
    const road = Array.from({ length: 28 }, (_, x) => ({ x: x + 2, z: 16 }));
    const rect = { x0: 3, z0: 17, x1: 10, z1: 20 };
    const path = [{ x: 20, z: 4 }, { x: 21, z: 4 }];
    const commands: Command[] = [
      { op: 'buildNetwork', args: [road, Network.Road] },
      { op: 'zone', args: [rect, Zone.ResLow] },
      { op: 'dezone', args: [rect] },
      { op: 'buildPowerLine', args: [path] },
      { op: 'buildSubway', args: [path] },
      { op: 'plop', args: ['park_small', 14, 17, 0] },
      { op: 'terraform', args: ['raise', 25, 25, 2, 0.5] },
      { op: 'plantTrees', args: [{ x0: 3, z0: 3, x1: 8, z1: 8 }] },
      { op: 'bulldoze', args: [{ x0: 14, z0: 17, x1: 15, z1: 18 }] },
    ];
    for (const cmd of commands) {
      const direct = (actions[cmd.op as keyof CityActions] as (...args: unknown[]) => unknown).apply(actions, cmd.args);
      const ticket = host.act(cmd.op, cmd.args);
      expect(ticket.exact, cmd.op).toBe(true);
      expect(ticket.predicted, cmd.op).toEqual(direct);
      expect(serializeCity(host.state, { copy: true }), cmd.op).toEqual(serializeCity(sim.state, { copy: true }));
      expect(host.sim.rng.state, cmd.op).toBe(sim.rng.state);
      await expect(ticket.done).resolves.toEqual(direct);
    }
    await host.dispose();
  });

  it('hover previews and compatibility preview calls leave state and RNG untouched', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const host = new LocalSimHost(newState(32));
    await host.start();
    const before = serializeCity(host.state, { copy: true }), rng = host.sim.rng.state;
    const rect = { x0: 2, z0: 2, x1: 5, z1: 5 };
    const act = vi.spyOn(host, 'act');
    host.preview.zone(rect, Zone.ResLow);
    host.preview.plantTrees(rect);
    host.actions.terraform('raise', 8, 8, 2, 0.5, true);
    expect(act).not.toHaveBeenCalled();
    expect(serializeCity(host.state, { copy: true })).toEqual(before);
    expect(host.sim.rng.state).toBe(rng);
    host.actions.zone(rect, Zone.ResLow);
    expect(act).toHaveBeenCalledWith('zone', [rect, Zone.ResLow]);
    await host.dispose();
  });

  it('sets historic idempotently, preserves action validation and handles money and camera commands', async () => {
    const st = newState(32);
    st.funds = 1e6;
    const home = place(st, 't_r1', 3, 3);
    const plant = place(st, 'util_nuclear_plant', 10, 10, { flags: BF.Plopped });
    const host = new LocalSimHost(st);
    await host.start();
    st.stats.population = 10000;
    const changed = vi.fn();
    const off = host.events.on('buildingChanged', changed);
    host.act('setHistoric', [home.id, true]);
    host.act('setHistoric', [home.id, true]);
    expect(home.flags & BF.Historic).toBeTruthy();
    expect(changed).toHaveBeenCalledTimes(1);
    host.act('setHistoric', [home.id, false]);
    host.act('setHistoric', [plant.id, true]);
    expect(home.flags & BF.Historic).toBe(0);
    expect(plant.flags & BF.Historic).toBe(0);
    expect(changed).toHaveBeenCalledTimes(2);
    host.act('setTax', [DevType.R1, 12]);
    host.act('setFunding', ['fire', 125]);
    expect(st.budget.taxRates[DevType.R1]).toBe(12);
    expect(st.budget.funding.fire).toBe(125);
    await expect(host.act('setOrdinance', ['nuclear_free_zone', true]).done).resolves.toMatchObject({ ok: false, needsConfirm: true });
    expect(st.budget.ordinances).not.toContain('nuclear_free_zone');
    await expect(host.act('setOrdinance', ['nuclear_free_zone', true, { confirm: true }]).done).resolves.toMatchObject({ ok: true });
    expect(st.budget.ordinances).toContain('nuclear_free_zone');
    const camera = { x: 80, z: 90, distance: 450, yaw: 20, tilt: 40 };
    host.act('setCamera', [camera]);
    expect(st.systemData.camera).toEqual(camera);
    off();
    await host.dispose();
  });

  it('refuses a stale repayment after a month or an index shift, and accepts a fresh guard', async () => {
    const host = new LocalSimHost(newState(32));
    await host.start();
    const st = host.state;
    st.stats.population = 10000;
    st.funds = 1e6;
    expect(host.act('takeLoan', [10000]).predicted?.ok).toBe(true);
    expect(host.act('takeLoan', [20000]).predicted?.ok).toBe(true);
    const first = { principal: st.budget.loans[0].principal, monthsLeft: st.budget.loans[0].monthsLeft };
    st.budget.loans[0].monthsLeft--;
    const funds = st.funds;
    await expect(host.act('repayLoan', [0, first]).done).resolves.toMatchObject({ ok: false });
    expect(st.funds).toBe(funds);
    expect(st.budget.loans).toHaveLength(2);
    await expect(host.act('repayLoan', [0, { ...first, monthsLeft: first.monthsLeft - 1 }]).done).resolves.toMatchObject({ ok: true });
    const after = st.funds;
    await expect(host.act('repayLoan', [0, first]).done).resolves.toMatchObject({ ok: false });
    expect(st.funds).toBe(after);
    const last = st.budget.loans[0];
    await expect(host.act('repayLoan', [0, { principal: last.principal, monthsLeft: last.monthsLeft }]).done).resolves.toMatchObject({ ok: true });
    expect(st.budget.loans).toHaveLength(0);
    await expect(host.act('repayLoan', [0, first]).done).resolves.toMatchObject({ ok: false });
    await host.dispose();
  });

  it('restores the core pause speed, including an already paused city', async () => {
    const host = new LocalSimHost(newState(32), { initialSpeed: 3 });
    host.setSpeed(1, 'emergency');
    host.setSpeed(0, 'pause');
    expect(host.speed).toBe(0);
    host.resume('pause');
    expect(host.speed).toBe(1);
    host.setSpeed(0, 'keyboard');
    host.setSpeed(0, 'pause');
    host.resume('pause');
    expect(host.speed).toBe(0);
    await host.dispose();
    expect(() => host.setSpeed(3, 'topbar')).toThrow(/disposed/);
  });

  it('returns the real disaster outcome with its effects visible before the acknowledgement', async () => {
    const st = newState(32);
    const home = place(st, 't_r1', 8, 8);
    const host = new LocalSimHost(st);
    await host.start();
    const ticket = host.act('triggerDisaster', ['fire', home.x, home.z]);
    expect(ticket.exact).toBe(true);
    expect(ticket.predicted).toBe(true);
    expect(home.flags & BF.OnFire).toBeTruthy();
    await expect(ticket.done).resolves.toBe(true);
    await expect(host.act('triggerDisaster', ['fire', 25, 25]).done).resolves.toBe(false);
    await host.dispose();
  });

  it('scopes cause tags through nested synchronous effects and clears them on a thrown command', async () => {
    const host = new LocalSimHost(newState(32));
    const outer = {}, inner = {};
    const seen: (Cause | null)[] = [];
    const off = host.events.on('speedChanged', (speed) => {
      seen.push(host.cause);
      if (speed === 2) {
        host.act('setSpeed', [1, 'keyboard'], { tag: inner });
        seen.push(host.cause);
      }
    });
    const ticket = host.act('setSpeed', [2, 'keyboard'], { tag: outer });
    expect(seen).toEqual([{ seq: ticket.seq, tag: outer }, { seq: ticket.seq + 1, tag: inner }, { seq: ticket.seq, tag: outer }]);
    expect(host.cause).toBeNull();
    off();
    const throwing = host.events.on('speedChanged', () => { throw new Error('listener'); });
    expect(() => host.act('setSpeed', [3, 'keyboard'], { tag: outer })).toThrow('listener');
    expect(host.cause).toBeNull();
    throwing();
    await host.dispose();
  });
});
