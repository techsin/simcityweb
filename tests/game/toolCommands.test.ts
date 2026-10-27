/** W0.2 feedback: exact local commands, delayed acknowledgements and a held brush's release. */
import { describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { BrushTool } from '../../src/game/tools/BrushTool';
import { Tool, type ToolPointer } from '../../src/game/tools/Tool';
import type { ActionResult } from '../../src/sim/actions';
import { Gesture, type ActOptions } from '../../src/worker/SimHost';

const OK: ActionResult = { ok: true, cost: 10 };
const NO: ActionResult = { ok: false, cost: 0, reason: 'Not enough money' };
const rect = { x0: 1, z0: 1, x1: 2, z1: 2 };

function fixture(exact: boolean, predicted = OK) {
  const abort = new AbortController();
  const pending: { resolve(r: ActionResult): void; reject(e: Error): void }[] = [];
  const sound = vi.fn(), toast = vi.fn();
  const ctx = {
    signal: abort.signal, sound, toast,
    world: { setBrush: vi.fn() },
    host: {
      beginGesture: (owner: object) => new Gesture(owner),
      act: (_op: string, _args: unknown[], opts: ActOptions) => {
        const done = new Promise<ActionResult>((resolve, reject) => { pending.push({ resolve, reject }); });
        opts.gesture?.track(done);
        return { seq: pending.length, exact, predicted, done };
      },
    },
  } as unknown as GameContext;
  return { ctx, abort, pending, sound, toast };
}

class Paint extends Tool {
  readonly id = 'paint';
  readonly label = 'Paint';
  apply() { return this.commit('plantTrees', [rect], { ok: () => this.ctx.sound('trees') }); }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('Tool.commit and gestures', () => {
  it('reports an exact result immediately and does not repeat it on acknowledgement', async () => {
    for (const predicted of [OK, NO]) {
      const f = fixture(true, predicted), tool = new Paint(f.ctx);
      const ticket = tool.apply();
      expect(f.sound).toHaveBeenCalledExactlyOnceWith(predicted.ok ? 'trees' : 'error');
      f.pending[0].resolve(predicted);
      await ticket.done;
      expect(f.sound).toHaveBeenCalledTimes(1);
      expect(f.toast).toHaveBeenCalledTimes(predicted.ok ? 0 : 1);
    }
  });

  it('a provisional failed prediction can succeed on its acknowledgement', async () => {
    const f = fixture(false, NO), tool = new Paint(f.ctx);
    const ticket = tool.apply();
    expect(f.sound).not.toHaveBeenCalled();
    f.pending[0].resolve(OK);
    await ticket.done;
    expect(f.sound).toHaveBeenCalledExactlyOnceWith('trees');
    expect(f.toast).not.toHaveBeenCalled();
  });

  it.each([true, false])('reports failures once per gesture (exact = %s), then permits a new gesture to report', async (exact) => {
    const f = fixture(exact), tool = new Paint(f.ctx);
    tool.beginGesture();
    tool.apply(); tool.apply();
    tool.endGesture();
    f.pending[0].resolve(NO);
    f.pending[1].resolve(NO);
    await flush();
    expect(f.sound.mock.calls.filter(([s]) => s === 'error')).toHaveLength(1);
    expect(f.toast).toHaveBeenCalledExactlyOnceWith(NO.reason, 'error');
    tool.apply();
    f.pending[2].resolve(NO);
    await flush();
    expect(f.sound.mock.calls.filter(([s]) => s === 'error')).toHaveLength(2);
  });

  it('a released brush waits for all acknowledgements, counts their results and never toasts', async () => {
    const f = fixture(false), tool = new BrushTool(f.ctx, 'raise', 'raise');
    const p = { hit: { x: 8, z: 8 }, down: true } as ToolPointer;
    tool.beginGesture();
    tool.down(p);
    tool.frame(0.31, p);
    expect(f.sound).toHaveBeenCalledExactlyOnceWith('terraform', { volume: 0.5, intensity: 0.2 });
    tool.up();
    tool.endGesture();
    f.pending[0].resolve(NO);
    await flush();
    expect(f.sound).toHaveBeenCalledTimes(1);
    f.pending[1].resolve(OK);
    await flush();
    expect(f.sound).toHaveBeenCalledTimes(2);
    expect(f.sound).toHaveBeenLastCalledWith('terraform');
    expect(f.toast).not.toHaveBeenCalled();
  });

  it('a wholly failed brush stroke plays one release error without per-application errors or toasts', async () => {
    const f = fixture(false, NO), tool = new BrushTool(f.ctx, 'trees', 'trees');
    const p = { hit: { x: 8, z: 8 }, down: true } as ToolPointer;
    tool.beginGesture(); tool.down(p); tool.frame(0.2, p); tool.up(); tool.endGesture();
    f.pending[0].resolve(NO); f.pending[1].resolve(NO);
    await flush();
    expect(f.sound).toHaveBeenCalledExactlyOnceWith('error');
    expect(f.toast).not.toHaveBeenCalled();
  });

  it('dispose silences delayed success, rejection and brush release feedback', async () => {
    const f = fixture(false), tool = new Paint(f.ctx);
    tool.apply(); tool.apply();
    const brush = new BrushTool(f.ctx, 'trees', 'trees');
    brush.beginGesture();
    brush.down({ hit: { x: 8, z: 8 }, down: true } as ToolPointer);
    brush.up(); brush.endGesture();
    f.abort.abort('dispose');
    f.pending[0].resolve(OK);
    f.pending[1].reject(new Error('disposed'));
    f.pending[2].resolve(OK);
    await flush();
    expect(f.sound).not.toHaveBeenCalled();
    expect(f.toast).not.toHaveBeenCalled();
  });
});
