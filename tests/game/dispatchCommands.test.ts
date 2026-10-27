/** R13: DispatchTool recognises its own synchronous dispatch through host.cause, before its ack arrives. */
import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { Network } from '../../src/core/types';
import type { GameContext } from '../../src/game/context';
import { DispatchTool } from '../../src/game/tools/DispatchTool';
import type { ToolPointer } from '../../src/game/tools/Tool';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState, place, roadLine } from '../infra/cityGen';

async function town() {
  const st = newState(64);
  roadLine(st, 2, 20, 62, 20, Network.Road);
  // two one-ambulance test clinics: test defs have no automatic fleet, so the call waits for the player
  const clinics = [place(st, 't_clinic', 8, 19), place(st, 't_clinic', 12, 19)];
  const home = place(st, 't_r2', 50, 21, { pop: 60 });
  const host = new LocalSimHost(st);
  await host.start();
  st.stats.population = 5000;
  const em = emergencyOf(host.sim)!;
  const id = em.spawn(host.sim, 'medical', home.x, home.z, { buildingId: home.id, major: true }); // needs 2 ambulances
  expect(em.incident(id)?.state).toBe('uncovered');
  expect(em.incident(id)?.need).toEqual({ medical: 2 });
  const abort = new AbortController();
  const sound = vi.fn(), toast = vi.fn(), select = vi.fn(() => true);
  const ctx = {
    state: st, sim: host.sim, host, signal: abort.signal,
    world: { setHighlight: vi.fn() },
    tip: { show: vi.fn(), hide: vi.fn() },
    ui: new Emitter(), sound, toast, focusCell: vi.fn(),
    tools: { active: null, select },
  } as unknown as GameContext;
  const tool = new DispatchTool(ctx);
  (ctx.tools as unknown as { active: DispatchTool }).active = tool;
  tool.activate();
  const at = (k: number) => ({ hit: { x: clinics[k].x, z: clinics[k].z }, shift: false } as ToolPointer);
  return { host, em, id, tool, at, select, sound, toast, abort };
}

describe('DispatchTool command causes', () => {
  it('keeps its own dispatch selected until feedback, stays while units are missing, then finishes exactly once', async () => {
    const f = await town();
    const causes: unknown[] = [];
    const off = f.host.events.on('emergency', (e) => { if (e.type === 'dispatched') causes.push(f.host.cause?.tag); });
    const first = f.tool.down(f.at(0));
    expect(f.em.incident(f.id)?.state).toBe('dispatched');
    expect(causes).toEqual([f.tool]);
    expect(f.host.cause).toBeNull();
    expect(f.select).not.toHaveBeenCalled();
    expect(f.sound).not.toHaveBeenCalled();
    await first;
    expect(f.sound).toHaveBeenCalledExactlyOnceWith('confirm');
    expect(f.toast).toHaveBeenCalledTimes(1);
    expect(f.select).not.toHaveBeenCalled(); // one ambulance of two: the tool stays on the call
    await f.tool.down(f.at(1));
    expect(causes).toEqual([f.tool, f.tool]);
    expect(f.sound).toHaveBeenCalledTimes(2);
    expect(f.select).toHaveBeenCalledExactlyOnceWith(null, { silent: true });
    off(); f.tool.deactivate(); f.abort.abort('dispose');
    await f.host.dispose();
  });

  it('still reacts immediately when another issuer dispatches the needed units', async () => {
    const f = await town();
    const ticket = f.host.act('dispatchBest', [f.id]);
    expect(ticket.exact).toBe(true);
    expect(ticket.predicted?.ok).toBe(true);
    expect(f.select).toHaveBeenCalledExactlyOnceWith(null, { silent: true });
    await expect(ticket.done).resolves.toEqual(ticket.predicted);
    f.tool.deactivate(); f.abort.abort('dispose');
    await f.host.dispose();
  });
});
