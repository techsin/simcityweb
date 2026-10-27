import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevType, Network, Zone } from '../../src/core/types';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { PreviewActions } from '../../src/worker/PreviewActions';
import { LocalSimHost, type Command } from '../../src/worker/SimHost';
import { newState, place } from '../infra/cityGen';
import { actionReplica } from './actionReplica';

const rect = { x0: 4, z0: 4, x1: 6, z1: 6 };
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(0); });
afterEach(() => { vi.restoreAllMocks(); });

describe('HostActions predictions', () => {
  it('keeps LocalSimHost synchronous and exact with no pending reservation', async () => {
    const host = new LocalSimHost(newState(32));
    await host.start();
    const ticket = host.act('zone', [rect, Zone.ResLow]);
    expect(ticket.exact).toBe(true);
    expect(ticket.predicted?.ok).toBe(true);
    expect(host.state.zone[host.state.idx(4, 4)]).toBe(Zone.ResLow);
    expect(host.pending.count).toBe(0);
    expect(host.pending.claims(rect)).toBeNull();
    expect(host.pending.overlay(() => host.state.funds)).toBe(host.state.funds);
    await expect(ticket.done).resolves.toEqual(ticket.predicted);
    await host.dispose();
  });

  it('refuses an exact failed preview without allocating or posting a command', async () => {
    const f = await actionReplica(newState(32));
    const ticket = f.transport.act('dezone', [rect]);
    expect(ticket).toMatchObject({ seq: 0, exact: true, predicted: { ok: false } });
    await expect(ticket.done).resolves.toEqual(ticket.predicted);
    expect(f.posted).toBe(0);
    expect(f.actions.pending.count).toBe(0);
    await f.dispose();
  });

  it('posts zone then dezone in order even though the second prediction fails on the replica', async () => {
    const f = await actionReplica(newState(32));
    const first = f.transport.act('zone', [rect, Zone.ResLow]);
    const second = f.transport.act('dezone', [rect]);
    expect(first).toMatchObject({ exact: true, predicted: { ok: true } });
    expect(second).toMatchObject({ exact: false, predicted: { ok: false, provisional: true } });
    expect(f.queued.map((c) => c.cmd.op)).toEqual(['zone', 'dezone']);
    expect(f.actions.pending.count).toBe(2);
    f.replay();
    expect(f.actions.pending.count).toBe(1);
    expect(f.state.zone[f.state.idx(4, 4)]).toBe(Zone.ResLow);
    f.replay();
    await expect(second.done).resolves.toMatchObject({ ok: true });
    expect(f.actions.pending.count).toBe(0);
    expect(f.state.zone[f.state.idx(4, 4)]).toBe(Zone.None);
    expect(serializeCity(f.state, { copy: true })).toEqual(serializeCity(f.local.state, { copy: true }));
    await f.dispose();
  });

  it('posts bulldoze then plop on the same lot, and reports waiting while the hover stays available', async () => {
    const state = newState(32);
    place(state, 't_r1', 4, 4);
    const f = await actionReplica(state);
    f.transport.act('bulldoze', [rect]);
    expect(f.actions.plop('t_park', 4, 4, 0, true)).toMatchObject({ reason: 'Waiting for the last edit…', provisional: true });
    const plop = f.transport.act('plop', ['t_park', 4, 4, 0]);
    expect(plop).toMatchObject({ exact: false, predicted: { ok: false } });
    f.replay(); f.replay();
    await expect(plop.done).resolves.toMatchObject({ ok: true });
    expect(f.state.buildingAt(4, 4)?.def).toBe('t_park');
    await f.dispose();
  });

  it('shows a pending footprint instead of stale hover reasons without refusing the subsequent commit', async () => {
    const f = await actionReplica(newState(32));
    f.transport.act('plop', ['t_park', 4, 4, 0]);
    expect(f.actions.plop('t_park', 4, 4, 0, true)).toMatchObject({ ok: false, reason: 'Blocked by a pending edit', provisional: true });
    const ticket = f.transport.act('plop', ['t_park', 4, 4, 0]);
    expect(ticket.exact).toBe(false);
    expect(f.posted).toBe(2);
    f.replay(); f.replay();
    await expect(ticket.done).resolves.toMatchObject({ ok: false, reason: 'Blocked by a building' });
    await f.dispose();
  });

  it('camera, tax, funding, speed and historic commands never make a prediction provisional', async () => {
    const f = await actionReplica(newState(32));
    const commands: Command[] = [
      { op: 'setCamera', args: [{ x: 0, z: 0, distance: 400, yaw: 0, tilt: 50 }] },
      { op: 'setTax', args: [DevType.R1, 12] }, { op: 'setFunding', args: ['fire', 120] },
      { op: 'setSpeed', args: [0, 'pause'] }, { op: 'resume', args: ['pause'] },
      { op: 'setHistoric', args: [1, true] }, { op: 'dismissAlert', args: [1] },
      { op: 'setSettings', args: [{ emergencyUncovered: 'live', emergencyLiveSlowmo: 3, emergencyAlerts: 'major' }] },
      { op: 'dispatch', args: [1, 1, 1] }, { op: 'dispatchBest', args: [1] },
      { op: 'triggerDisaster', args: ['fire', 4, 4] },
    ];
    for (const cmd of commands) f.transport.act(cmd.op, cmd.args);
    expect(f.actions.pending.count).toBe(0);
    const preview = f.actions.zone(rect, Zone.ResLow, true);
    expect(preview.ok).toBe(true);
    expect(preview.provisional).toBeUndefined();
    expect(f.transport.act('zone', [rect, Zone.ResLow]).exact).toBe(true);
    await f.dispose();
  });

  it('compatibility commits pass through host.act, retain options and group acknowledgements', async () => {
    const f = await actionReplica(newState(32)), owner = {};
    const gesture = f.actions.beginGesture(owner);
    const first = f.transport.act('zone', [rect, Zone.ResLow], { tag: owner, gesture });
    const second = f.actions.dezone(rect);
    expect(second.provisional).toBe(true);
    expect(f.queued[0].opts).toMatchObject({ tag: owner, gesture });
    expect(f.queued[1].opts.gesture).toBe(gesture);
    let settled = false;
    void gesture.settled.then(() => { settled = true; });
    gesture.end();
    f.replay();
    await first.done;
    expect(settled).toBe(false);
    f.replay();
    await gesture.settled;
    expect(settled).toBe(true);
    await f.dispose();
  });

  it('releases reservations on rejection and follows an adopted state for previews', async () => {
    const f = await actionReplica(newState(32));
    const ticket = f.transport.act('zone', [rect, Zone.ResLow]);
    const rejected = expect(ticket.done).rejects.toThrow('Host crashed');
    f.reject();
    await rejected;
    expect(f.actions.pending.count).toBe(0);
    const fresh = newState(32);
    fresh.water[fresh.idx(4, 4)] = 1;
    f.replace(fresh);
    expect(f.actions.plop('t_park', 4, 4, 0, true).ok).toBe(false);
    await f.dispose();
    expect(() => f.actions.zone(rect, Zone.ResLow, true)).toThrow('disposed');
  });
});

describe('PreviewActions', () => {
  it('matches the LocalSimHost map previews without writes, events, systems or RNG', async () => {
    const host = new LocalSimHost(newState(32));
    await host.start();
    const state = deserializeCity(serializeCity(host.state, { copy: true }));
    const preview = new PreviewActions(() => state);
    const commands: Command[] = [
      { op: 'zone', args: [rect, Zone.ResLow] }, { op: 'dezone', args: [rect] }, { op: 'bulldoze', args: [rect] },
      { op: 'buildNetwork', args: [[{ x: 7, z: 7 }, { x: 8, z: 7 }], Network.Road] },
      { op: 'buildPowerLine', args: [[{ x: 7, z: 7 }]] }, { op: 'buildSubway', args: [[{ x: 7, z: 7 }]] },
      { op: 'plop', args: ['t_park', 8, 8, 0] }, { op: 'terraform', args: ['raise', 8, 8, 2, 0.5] },
      { op: 'plantTrees', args: [rect] },
    ];
    const before = serializeCity(state, { copy: true }), rng = host.sim.rng.state;
    for (const cmd of commands) {
      const method = host.preview[cmd.op as keyof typeof host.preview] as (...args: unknown[]) => unknown;
      expect(preview.predict(cmd), cmd.op).toEqual(method.apply(host.preview, cmd.args));
    }
    expect(serializeCity(state, { copy: true })).toEqual(before);
    expect(host.sim.rng.state).toBe(rng);
    expect(() => preview.setTax(DevType.R1, 20)).toThrow('read-only');
    expect(() => preview.setFunding('fire', 150)).toThrow('read-only');
    expect(() => preview.toggleHistoric(1)).toThrow('read-only');
    await host.dispose();
  });

  it('matches ordinance confirmation, loan rounding and guarded repayments without mutating the replica', async () => {
    const state = newState(32);
    state.funds = 1e6;
    place(state, 'util_nuclear_plant', 8, 8);
    const f = await actionReplica(state);
    f.local.state.stats.population = f.state.stats.population = 10000;
    const commands: Command[] = [
      { op: 'setOrdinance', args: ['missing', true] },
      { op: 'setOrdinance', args: ['nuclear_free_zone', true] },
      { op: 'setOrdinance', args: ['nuclear_free_zone', true, { confirm: true }] },
      { op: 'takeLoan', args: [10000.4] },
      { op: 'takeLoan', args: [1] },
    ];
    for (const cmd of commands) {
      const before = serializeCity(f.state, { copy: true });
      const r = f.actions.preview.predict(cmd);
      expect(serializeCity(f.state, { copy: true })).toEqual(before);
      expect(r, cmd.op).toEqual(f.local.act(cmd.op, cmd.args).predicted);
      f.replace(deserializeCity(serializeCity(f.local.state, { copy: true })));
    }
    const loan = f.state.budget.loans[0];
    for (const guard of [{ principal: loan.principal, monthsLeft: loan.monthsLeft - 1 }, { principal: loan.principal, monthsLeft: loan.monthsLeft }]) {
      const before = serializeCity(f.state, { copy: true });
      const r = f.actions.preview.repayLoan(0, guard);
      expect(serializeCity(f.state, { copy: true })).toEqual(before);
      expect(r).toEqual(f.local.act('repayLoan', [0, guard]).predicted);
    }
    await f.dispose();
  });
});
