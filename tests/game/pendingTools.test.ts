import { describe, expect, it, vi } from 'vitest';
import { Zone } from '../../src/core/types';
import type { GameContext } from '../../src/game/context';
import { BrushTool } from '../../src/game/tools/BrushTool';
import { commitAction, type ToolPointer } from '../../src/game/tools/Tool';
import { ToolController } from '../../src/game/tools/ToolController';
import { PendingEdits } from '../../src/worker/PendingEdits';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState } from '../infra/cityGen';
import { actionReplica } from '../worker/actionReplica';

const rect = { x0: 3, z0: 3, x1: 5, z1: 5 };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

async function fixture() {
  const replica = await actionReplica(newState(32)), abort = new AbortController();
  const ghost = vi.fn(), sound = vi.fn(), toast = vi.fn();
  const ctx = {
    signal: abort.signal, sound, toast,
    world: { setPendingPreview: ghost, setBrush: vi.fn() },
    get state() { return replica.state; }, actions: replica.actions,
    host: {
      ...replica.transport, kind: 'loopback', pending: replica.actions.pending,
      beginGesture: replica.actions.beginGesture.bind(replica.actions),
    },
  } as unknown as GameContext;
  return { ...replica, ctx, abort, ghost, sound, toast };
}

describe('Tool.commit with pending replica edits', () => {
  it('retains each committed ghost until its edit is visible and its ack has replayed', async () => {
    const f = await fixture(), owner = {};
    const gesture = f.ctx.host.beginGesture(owner);
    const zoned = vi.fn(() => expect(f.ctx.state.zone[f.ctx.state.idx(3, 3)]).toBe(Zone.ResLow));
    const dezoned = vi.fn(() => expect(f.ctx.state.zone[f.ctx.state.idx(3, 3)]).toBe(Zone.None));
    const first = commitAction(f.ctx, owner, 'zone', [rect, Zone.ResLow], { ok: () => f.sound('zone'), ack: zoned }, gesture);
    const second = commitAction(f.ctx, owner, 'dezone', [rect], { ok: () => f.sound('dezone'), ack: dezoned }, gesture);
    gesture.end();
    expect(f.ghost.mock.calls).toEqual([[first.seq, { kind: 'rect', rect }], [second.seq, { kind: 'rect', rect }]]);
    expect(f.sound).toHaveBeenCalledExactlyOnceWith('zone');
    expect(second.predicted?.ok).toBe(false);
    f.replay();
    await first.done;
    expect(zoned).toHaveBeenCalledOnce();
    expect(f.ghost).toHaveBeenLastCalledWith(first.seq, null);
    f.replay();
    await gesture.settled;
    expect(dezoned).toHaveBeenCalledOnce();
    expect(f.ghost).toHaveBeenLastCalledWith(second.seq, null);
    expect(f.sound.mock.calls).toEqual([['zone'], ['dezone']]);
    expect(f.toast).not.toHaveBeenCalled();
    expect(gesture.mismatch).toBe(false);
    await f.dispose();
  });

  it('keeps a held tree brush quiet on repeated refusals and releases from the authoritative total', async () => {
    const f = await fixture(), brush = new BrushTool(f.ctx, 'trees', 'trees');
    const p = { hit: { x: 8, z: 8 }, down: true } as ToolPointer;
    brush.beginGesture(); brush.down(p); brush.frame(0.13, p); brush.up(); brush.endGesture();
    expect(f.sound).not.toHaveBeenCalled();
    f.replay();
    await flush();
    expect(f.sound).not.toHaveBeenCalled();
    expect(f.replay()).toMatchObject({ ok: false, reason: 'No room for trees here' });
    await flush();
    expect(f.sound).toHaveBeenCalledExactlyOnceWith('trees');
    expect(f.toast).not.toHaveBeenCalled();
    expect(f.ghost.mock.calls.filter(([, geometry]) => geometry === null)).toHaveLength(2);
    await f.dispose();
  });

  it('a wholly rejected brush stroke plays one release error and removes its ghost', async () => {
    const f = await fixture(), brush = new BrushTool(f.ctx, 'trees', 'trees');
    brush.beginGesture(); brush.down({ hit: { x: 8, z: 8 }, down: true } as ToolPointer); brush.up(); brush.endGesture();
    f.local.state.trees.fill(4);
    f.replay();
    await flush();
    expect(f.sound).toHaveBeenCalledExactlyOnceWith('error');
    expect(f.toast).not.toHaveBeenCalled();
    expect(f.ghost).toHaveBeenLastCalledWith(1, null);
    await f.dispose();
  });

  it('clears on abort, never clears a replacement view, and ignores later feedback and commits', async () => {
    const f = await fixture(), owner = {};
    const ticket = commitAction(f.ctx, owner, 'zone', [rect, Zone.ResLow], { ok: () => f.sound('zone') });
    const replacement = vi.fn();
    f.ctx.world = { setPendingPreview: replacement } as unknown as GameContext['world'];
    f.abort.abort('dispose');
    expect(f.ghost).toHaveBeenLastCalledWith(ticket.seq, null);
    f.reject();
    await expect(ticket.done).rejects.toThrow('Host crashed');
    commitAction(f.ctx, owner, 'zone', [rect, Zone.ResLow], { ok: () => f.sound('zone') });
    expect(f.queued).toHaveLength(0);
    expect(f.ghost).toHaveBeenCalledTimes(2);
    expect(replacement).not.toHaveBeenCalled();
    expect(f.sound).toHaveBeenCalledExactlyOnceWith('zone');
    expect(f.toast).not.toHaveBeenCalled();
    await f.dispose();
  });

  it('does not create a ghost for an exact refusal or a synchronous LocalSimHost edit', async () => {
    const f = await fixture(), owner = {};
    const no = commitAction(f.ctx, owner, 'dezone', [rect], { ok: () => {} });
    await no.done;
    expect(f.ghost).not.toHaveBeenCalled();
    const local = new LocalSimHost(newState(32));
    await local.start();
    const ctx = { ...f.ctx, host: local } as GameContext;
    const yes = commitAction(ctx, owner, 'zone', [rect, Zone.ResLow], { ok: () => f.sound('zone') });
    await yes.done;
    expect(yes.predicted?.ok).toBe(true);
    expect(f.ghost).not.toHaveBeenCalled();
    await local.dispose(); await f.dispose();
  });

  it('ToolController refreshes on the last ack and drops its subscription on reattach, abort and dispose', () => {
    const st = newState(32), pending = new PendingEdits(() => st), abort = new AbortController();
    const canvas = () => ({ style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as HTMLCanvasElement;
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const ctx = { host: { pending }, signal: abort.signal, objects: { setSelected: vi.fn() }, tip: { hide: vi.fn() } } as unknown as GameContext;
    try {
      const controller = new ToolController(ctx, canvas()), refresh = vi.spyOn(controller, 'refresh');
      pending.add(1, { op: 'plantTrees', args: [rect] });
      controller.attach(canvas());
      pending.ack(1);
      expect(pending.count).toBe(0);
      expect(refresh).toHaveBeenCalledTimes(2);
      abort.abort('dispose');
      pending.add(2, { op: 'plantTrees', args: [rect] });
      expect(refresh).toHaveBeenCalledTimes(2);
      controller.dispose();
      pending.ack(2);
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally { abort.abort('dispose'); vi.unstubAllGlobals(); }
  });
});
