/** Browser-free checks of the browser fixture and the real loopback tool boundary. */
import { describe, expect, it, vi } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import type { GameContext } from '../../src/game/context';
import { commitAction } from '../../src/game/tools/Tool';
import { BF, CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import type { PendingPreview } from '../../src/worker/PendingEdits';
import { exactDigest } from '../../src/worker/queries';
import { LocalSimHost } from '../../src/worker/SimHost';

function flatState(size: number): CityState {
  const state = new CityState(defaultCityConfig({ size, seed: 7, terrain: 'flat', difficulty: 'sandbox', disasters: false }));
  state.heights.fill(5);
  return state;
}

async function runDays(host: LocalSimHost | LoopbackSimHost, days: number): Promise<void> {
  if (host instanceof LoopbackSimHost) {
    host.harness.runDays(days);
    await host.drain();
  } else host.sim.runDays(days);
}

it.each(['local', 'loopback'] as const)('QA %s fixture grows an inspectable building and supports both manual dispatch commands', async (kind) => {
  const state = flatState(256);
  const host = kind === 'local' ? new LocalSimHost(state, { initialSpeed: 0 })
    : new LoopbackSimHost(state, { initialSpeed: 0, loopback: { cadence: 'design' } });
  try {
    await host.start();
    await host.ready;
    expect((await host.act('buildNetwork', [Array.from({ length: 139 }, (_, x) => ({ x, z: 128 })), Network.Road]).done).ok).toBe(true);
    for (const [def, x, z] of [
      ['util_wind_turbine', 50, 127], ['util_wind_turbine', 55, 127], ['util_water_tower', 60, 127],
      ['civ_fire_station', 70, 126], ['civ_fire_station', 76, 126], ['park_small', 122, 127], ['park_small', 130, 127],
    ] as const) expect((await host.act('plop', [def, x, z, 0]).done).ok, def).toBe(true);
    for (const [rect, zone] of [
      [{ x0: 84, z0: 123, x1: 104, z1: 128 }, Zone.ResLow],
      [{ x0: 84, z0: 129, x1: 94, z1: 133 }, Zone.ComLow],
      [{ x0: 106, z0: 129, x1: 116, z1: 133 }, Zone.IndMed],
    ] as const) expect((await host.act('zone', [rect, zone]).done).ok).toBe(true);
    let grown = false;
    for (let day = 0; day < 120 && !grown; day++) {
      await runDays(host, 1);
      grown = [...host.state.buildings.values()].some((b) => !(b.flags & (BF.Plopped | BF.Burnt)) && b.built >= 1);
    }
    expect(grown, 'the UI-built neighbourhood must produce a completed growable').toBe(true);
    const emergency = host.emergency;
    expect(await host.act('triggerDisaster', ['fire', 122, 127]).done).toBe(true);
    const first = emergency.incidents().find((i) => i.buildingId === host.state.buildingAt(122, 127)!.id)!;
    expect(first.state).toBe('uncovered');
    expect(first.manualPossible).toBe(true);
    const sent = await host.act('dispatch', [first.id, host.state.buildingAt(70, 126)!.id, 1]).done;
    expect(sent.ok).toBe(true); expect(sent.sent).toBe(1);
    expect(await host.act('triggerDisaster', ['fire', 130, 127]).done).toBe(true);
    const second = emergency.incidents().find((i) => i.buildingId === host.state.buildingAt(130, 127)!.id)!;
    expect(second.id).not.toBe(first.id);
    expect(second.manualPossible).toBe(true);
    expect((await host.act('dispatchBest', [second.id]).done).ok).toBe(true);
  } finally { await host.dispose(); }
}, 30000);

describe('QA loopback tool lifecycle', () => {
  it('settles provisional edits after tagged replay, retaining ghosts through each Ack', async () => {
    const abort = new AbortController(), host = new LoopbackSimHost(flatState(32), {
      initialSpeed: 0, signal: abort.signal, loopback: { lag: { seed: 7, packetTicks: 1000 } },
    });
    const ghosts = new Map<number, PendingPreview>(), ghost = vi.fn((seq: number, preview: PendingPreview | null) => {
      if (preview) ghosts.set(seq, preview);
      else ghosts.delete(seq);
    });
    const sound = vi.fn(), toast = vi.fn(), ack = vi.fn();
    const ctx = { host, signal: abort.signal, world: { setPendingPreview: ghost }, sound, toast } as unknown as GameContext;
    const rect = { x0: 4, z0: 4, x1: 7, z1: 7 }, owner = {};
    const replay: { seq: number; tag: object | null; zone: Zone; ghost: boolean }[] = [];
    const off = host.events.on('zoneChanged', () => {
      const cause = host.cause!;
      replay.push({ ...cause, zone: host.state.zone[host.state.idx(4, 4)], ghost: ghosts.has(cause.seq) });
    });
    abort.signal.addEventListener('abort', off, { once: true });
    try {
      await host.start(); await host.ready; await host.drain();
      const gesture = host.beginGesture(owner);
      const first = commitAction(ctx, owner, 'zone', [rect, Zone.ResLow], { ok: () => sound('zone'), ack }, gesture);
      const second = commitAction(ctx, owner, 'dezone', [rect], { ok: () => sound('dezone'), ack }, gesture);
      let settled = false;
      void gesture.settled.then(() => { settled = true; });
      gesture.end();
      expect(first).toMatchObject({ exact: true, predicted: { ok: true } });
      expect(second).toMatchObject({ exact: false, predicted: { ok: false, provisional: true } });
      expect(host.pending.count).toBe(2);
      expect(host.pending.claims(rect)).toBe('waiting');
      expect(ghosts.size).toBe(2);
      expect(host.state.zone[host.state.idx(4, 4)]).toBe(Zone.None);
      expect(sound.mock.calls).toEqual([['zone']]);
      expect(settled).toBe(false);
      const read = host.query('verify', {}).then((digest) => {
        expect(host.pending.count).toBe(0);
        expect(digest).toBe(exactDigest(host.state));
      });
      await host.drain(); await gesture.settled; await read;
      expect(await first.done).toMatchObject({ ok: true });
      expect(await second.done).toMatchObject({ ok: true });
      expect(replay).toEqual([
        { seq: first.seq, tag: owner, zone: Zone.ResLow, ghost: true },
        { seq: second.seq, tag: owner, zone: Zone.None, ghost: true },
      ]);
      expect(host.cause).toBeNull();
      expect(host.pending.count).toBe(0); expect(host.pending.claims(rect)).toBeNull();
      expect(ghosts.size).toBe(0);
      expect(ghost.mock.calls.filter(([, preview]) => preview === null).map(([seq]) => seq)).toEqual([first.seq, second.seq]);
      expect(ack).toHaveBeenCalledTimes(2);
      expect(sound.mock.calls).toEqual([['zone'], ['dezone']]);
      expect(toast).not.toHaveBeenCalled();
      expect(gesture.mismatch).toBe(false);
    } finally { abort.abort('dispose'); await host.dispose(); }
  });

  it('clears pending ghosts and watches on city abort without late feedback', async () => {
    const abort = new AbortController(), host = new LoopbackSimHost(flatState(32), { initialSpeed: 0, signal: abort.signal });
    const ghost = vi.fn(), ok = vi.fn(), ack = vi.fn(), sound = vi.fn(), toast = vi.fn();
    const ctx = { host, signal: abort.signal, world: { setPendingPreview: ghost }, sound, toast } as unknown as GameContext;
    try {
      await host.start(); await host.ready;
      const core = host.harness, watch = host.watch('verify', {}, 'daily');
      await host.drain(); expect(watch.value).toBeDefined();
      const gesture = host.beginGesture({});
      const ticket = commitAction(ctx, gesture.owner, 'zone', [{ x0: 4, z0: 4, x1: 7, z1: 7 }, Zone.ResLow], { ok, ack }, gesture);
      const rejected = expect(ticket.done).rejects.toThrow(/disposed/);
      expect(host.pending.count).toBe(1);
      expect(ghost).toHaveBeenCalledTimes(1);
      abort.abort('dispose');
      await rejected; await gesture.settled;
      expect(core.core.isDisposed).toBe(true);
      expect(host.pending.count).toBe(0); expect(watch.value).toBeUndefined();
      expect(ghost).toHaveBeenCalledTimes(2);
      expect(ghost).toHaveBeenLastCalledWith(ticket.seq, null);
      expect(ok).toHaveBeenCalledTimes(1); expect(ack).not.toHaveBeenCalled();
      expect(sound).not.toHaveBeenCalled(); expect(toast).not.toHaveBeenCalled();
      expect(() => host.act('setSpeed', [1, 'keyboard'])).toThrow(/disposed/);
    } finally { abort.abort('dispose'); await host.dispose(); }
  });

  it('routes several authoritative refusals to the issuing tool once per gesture', async () => {
    const state = flatState(32);
    state.config.difficulty = 'medium'; state.config.sandbox = false; state.funds = 1e6;
    const abort = new AbortController(), host = new LoopbackSimHost(state, { initialSpeed: 0, signal: abort.signal });
    const ghost = vi.fn(), ok = vi.fn(), fail = vi.fn(), ack = vi.fn();
    const ctx = { host, signal: abort.signal, world: { setPendingPreview: ghost } } as unknown as GameContext;
    try {
      await host.start(); await host.ready; await host.drain();
      // A sim-side expense has not reached the replica: the first exact prediction will be corrected.
      host.harness.primary.funds = 0;
      const owner = {}, gesture = host.beginGesture(owner);
      const tickets = Array.from({ length: 3 }, () => commitAction(ctx, owner, 'plantTrees',
        [{ x0: 4, z0: 4, x1: 7, z1: 7 }], { ok, fail, ack }, gesture));
      gesture.end();
      expect(tickets[0]).toMatchObject({ exact: true, predicted: { ok: true } });
      expect(tickets.slice(1).every((ticket) => !ticket.exact)).toBe(true);
      expect(ok).toHaveBeenCalledTimes(1); expect(fail).not.toHaveBeenCalled();
      await host.drain(); await gesture.settled;
      expect((await Promise.all(tickets.map((ticket) => ticket.done))).every((result) => !result.ok)).toBe(true);
      expect(fail).toHaveBeenCalledTimes(1); expect(ack).toHaveBeenCalledTimes(3);
      expect(gesture.mismatch).toBe(true);
      expect(host.pending.count).toBe(0);
      expect(ghost.mock.calls.filter(([, preview]) => preview === null)).toHaveLength(3);
    } finally { abort.abort('dispose'); await host.dispose(); }
  });
});
