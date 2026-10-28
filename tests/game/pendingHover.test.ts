import { describe, expect, it, vi } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import type { GameContext } from '../../src/game/context';
import { BrushTool } from '../../src/game/tools/BrushTool';
import { NetworkTool } from '../../src/game/tools/NetworkTool';
import { PlopTool } from '../../src/game/tools/PlopTool';
import { RectTool } from '../../src/game/tools/ZoneTool';
import type { ToolPointer } from '../../src/game/tools/Tool';
import { getDef } from '../../src/sim/catalog';
import { newState } from '../infra/cityGen';
import { actionReplica } from '../worker/actionReplica';

const tools = [
  { name: 'zone', op: 'zone', make: (ctx: GameContext) => new RectTool(ctx, { kind: 'zone', zone: Zone.ResLow }, 'zone', 'Zone', '') },
  { name: 'network', op: 'buildNetwork', make: (ctx: GameContext) => new NetworkTool(ctx, Network.Road, 'road', '') },
  { name: 'plop', op: 'plop', make: (ctx: GameContext) => new PlopTool(ctx, getDef('t_park')!, '') },
  { name: 'brush', op: 'plantTrees', make: (ctx: GameContext) => new BrushTool(ctx, 'trees', '') },
] as const;

describe('stationary pending previews', () => {
  it.each(tools)('$name refreshes its cached preview on posting and on the last ack', async ({ op, make }) => {
    const f = await actionReplica(newState(32)), abort = new AbortController();
    const show = vi.fn();
    const ctx = {
      signal: abort.signal, get state() { return f.state; }, actions: f.actions,
      host: { pending: f.actions.pending, watch: f.local.watch.bind(f.local) },
      world: { setHighlight: vi.fn(), setHighlightRect: vi.fn(), setBrush: vi.fn() },
      objects: { setGhost: vi.fn(), setNetworkPreview: vi.fn() },
      tip: { show, hide: vi.fn() }, tools: { active: null }, sandbox: () => false,
    } as unknown as GameContext;
    const tool = make(ctx), preview = vi.spyOn(f.actions, op);
    const p = {
      clientX: 100, clientY: 100, shift: false, ctrl: false, alt: false, down: false,
      hit: { x: 8, z: 8, point: { x: 8.5 * 16, y: 5, z: 8.5 * 16 } },
    } as ToolPointer;
    try {
      tool.move(p); tool.move(p);
      expect(preview).toHaveBeenCalledOnce();
      expect(preview.mock.results[0].value).toMatchObject({ ok: true });

      const ticket = f.transport.act('plop', ['t_park', 8, 8, 0]);
      expect(ticket.predicted?.ok).toBe(true);
      tool.move(p); tool.move(p);
      expect(preview).toHaveBeenCalledTimes(2);
      expect(preview.mock.results[1].value).toMatchObject({ reason: 'Blocked by a pending edit', provisional: true });
      expect(show.mock.lastCall?.[0]).toContain('Blocked by a pending edit');

      expect(f.replay()).toMatchObject({ ok: true });
      await ticket.done;
      tool.move(p); tool.move(p);
      expect(f.actions.pending.count).toBe(0);
      expect(preview).toHaveBeenCalledTimes(3);
      expect(preview.mock.results[2].value.provisional).toBeUndefined();
      expect(show.mock.lastCall?.[0]).not.toContain('Blocked by a pending edit');

      // A command can settle between frames, leaving the same count but a newer preview generation.
      const quick = f.transport.act('plantTrees', [{ x0: 20, z0: 20, x1: 21, z1: 21 }]);
      expect(f.replay()).toMatchObject({ ok: true });
      await quick.done;
      expect(f.actions.pending.count).toBe(0);
      tool.move(p);
      expect(preview).toHaveBeenCalledTimes(4);
    } finally {
      tool.deactivate(); abort.abort('dispose'); preview.mockRestore(); await f.dispose();
    }
  });
});
