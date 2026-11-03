import { describe, expect, it, vi } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { getDef } from '../../src/sim/catalog';
import { PendingEdits, commandPreview } from '../../src/worker/PendingEdits';
import type { Command } from '../../src/worker/SimHost';
import { newState, place } from '../infra/cityGen';
import { actionReplica } from './actionReplica';

const rect = { x0: 3, z0: 3, x1: 5, z1: 5 };

describe('PendingEdits overlay', () => {
  it('reserves predicted spending and loan credits once, and restores funds even when a nested preview throws', () => {
    const st = newState(32), pending = new PendingEdits(() => st);
    st.funds = 100;
    pending.add(1, { op: 'zone', args: [rect, Zone.ResLow] }, { ok: true, cost: 30 });
    pending.add(2, { op: 'takeLoan', args: [10000] }, { ok: true, cost: -10000 });
    expect(pending.count).toBe(2);
    expect(() => pending.overlay(() => {
      expect(st.funds).toBe(10070);
      pending.overlay(() => { expect(st.funds).toBe(10070); throw new Error('preview'); });
    })).toThrow('preview');
    expect(st.funds).toBe(100);
    pending.ack(1);
    expect(pending.overlay(() => st.funds)).toBe(10100);
    pending.ack(2);
    expect(pending.overlay(() => st.funds)).toBe(100);
  });

  it('reserves unique definitions without replacing or leaking milestones, including after an exception', () => {
    const st = newState(32), pending = new PendingEdits(() => st), milestones = st.milestones;
    const id = 'lm_clock_tower';
    expect(getDef(id)?.unique).toBe(true);
    pending.add(1, { op: 'plop', args: [id, 3, 3, 0] }, { ok: true, cost: 100 });
    expect(() => pending.overlay(() => {
      expect(st.milestones).toBe(milestones);
      expect(st.milestones[id]).toBe(1);
      throw new Error('preview');
    })).toThrow('preview');
    expect(Object.hasOwn(milestones, id)).toBe(false);
    milestones[id] = 2;
    pending.overlay(() => expect(milestones[id]).toBe(3));
    expect(milestones[id]).toBe(2);
  });

  it('does not double-reserve commands already reflected by a packet before their Ack entries', () => {
    const st = newState(32), pending = new PendingEdits(() => st);
    st.funds = 100;
    pending.add(1, { op: 'zone', args: [rect, Zone.ResLow] }, { ok: true, cost: 20 });
    pending.add(2, { op: 'plantTrees', args: [rect] }, { ok: true, cost: 10 });
    st.funds = 80;
    pending.rebase(1);
    expect(pending.count).toBe(2);
    expect(pending.overlay(() => st.funds)).toBe(70);
    expect(st.funds).toBe(80);
    pending.ack(1);
    expect(pending.overlay(() => st.funds)).toBe(70);
  });

  it('keeps monthly ordinance costs out of funds, and follows sandbox spending semantics', () => {
    const st = newState(32), pending = new PendingEdits(() => st);
    st.funds = 100;
    pending.add(1, { op: 'setOrdinance', args: ['smoke_detectors', true] }, { ok: true, cost: 200 });
    expect(pending.count).toBe(1);
    expect(pending.overlay(() => st.funds)).toBe(100);
    st.config.sandbox = true;
    pending.add(2, { op: 'zone', args: [rect, Zone.ResLow] }, { ok: true, cost: 30 });
    pending.add(3, { op: 'takeLoan', args: [10000] }, { ok: true, cost: -10000 });
    expect(pending.overlay(() => st.funds)).toBe(10100);
  });

  it('uses reserved money for hover previews but always posts a subsequent provisional failure', async () => {
    const st = newState(32);
    st.funds = 20;
    const f = await actionReplica(st);
    const first = f.transport.act('buildNetwork', [[{ x: 3, z: 3 }], Network.Road]);
    expect(first.predicted).toMatchObject({ ok: true, cost: 20 });
    const r = f.actions.buildNetwork([{ x: 7, z: 7 }], Network.Road, true);
    expect(r).toMatchObject({ ok: false, provisional: true });
    expect(f.state.funds).toBe(20);
    const second = f.transport.act('buildNetwork', [[{ x: 7, z: 7 }], Network.Road]);
    expect(second.exact).toBe(false);
    expect(f.posted).toBe(2);
    f.replay(); f.replay();
    await expect(second.done).resolves.toMatchObject({ ok: false });
    await f.dispose();
  });
});

describe('PendingEdits claims and lifetime', () => {
  it('marks exact path cells as blocked, changing edits as waiting, and preserves geometry after callers reuse it', () => {
    const st = newState(32), pending = new PendingEdits(() => st);
    const path = [{ x: 3, z: 3 }, { x: 4, z: 3 }, { x: 4, z: 4 }];
    pending.add(1, { op: 'buildNetwork', args: [path, Network.Road] }, { ok: true, cost: 60 });
    path[0].x = 20;
    expect(pending.claims({ x0: 3, z0: 3, x1: 4, z1: 4 })).toBe('blocked');
    expect(pending.claims({ x0: 3, z0: 4, x1: 4, z1: 5 })).toBeNull();
    pending.add(2, { op: 'bulldoze', args: [rect] });
    expect(pending.claims({ x0: 3, z0: 4, x1: 4, z1: 5 })).toBe('waiting');
    expect(pending.claims(rect)).toBe('blocked');
    pending.ack(1);
    expect(pending.claims(rect)).toBe('waiting');
    pending.ack(2);
    expect(pending.claims(rect)).toBeNull();
  });

  it('covers plop rotations and terrain corners touching adjacent cells', () => {
    const st = newState(32), pending = new PendingEdits(() => st);
    const cmd: Command = { op: 'plop', args: ['t_train', 3, 3, 1] };
    expect(commandPreview(cmd)).toEqual({ kind: 'rect', rect: { x0: 3, z0: 3, x1: 4, z1: 5 } });
    pending.add(1, cmd);
    expect(pending.claims({ x0: 3, z0: 4, x1: 4, z1: 5 })).toBe('blocked');
    expect(pending.claims({ x0: 4, z0: 3, x1: 5, z1: 4 })).toBeNull();
    pending.add(2, { op: 'terraform', args: ['raise', 10, 10, 1, 0.5] });
    expect(pending.claims({ x0: 9, z0: 10, x1: 10, z1: 11 })).toBe('waiting');
    expect(pending.claims({ x0: 8, z0: 8, x1: 9, z1: 9 })).toBeNull();
  });

  it('includes the rest of a building removed by a bulldoze that only touches one of its cells', () => {
    const st = newState(32), pending = new PendingEdits(() => st);
    place(st, 't_r3', 4, 4);
    pending.add(1, { op: 'bulldoze', args: [{ x0: 4, z0: 4, x1: 5, z1: 5 }] });
    expect(pending.claims({ x0: 5, z0: 5, x1: 6, z1: 6 })).toBe('waiting');
  });

  it('a throwing hover subscriber cannot interrupt posting or Ack replay', () => {
    const st = newState(32), pending = new PendingEdits(() => st), abort = new AbortController();
    const report = vi.spyOn(console, 'error').mockImplementation(() => {}), next = vi.fn();
    pending.subscribe(() => { throw new Error('view'); }, abort.signal);
    pending.subscribe(next, abort.signal);
    try {
      pending.add(1, { op: 'plantTrees', args: [rect] });
      pending.ack(1);
      expect(pending.count).toBe(0);
      expect(next).toHaveBeenCalledTimes(2);
      expect(report).toHaveBeenCalledOnce();
    } finally { abort.abort('dispose'); report.mockRestore(); }
  });

  it('notifies for pending revisions and releases listeners on the city signal and dispose', () => {
    const st = newState(32), pending = new PendingEdits(() => st), abort = new AbortController();
    const refresh = vi.fn();
    pending.subscribe(refresh, abort.signal);
    pending.add(1, { op: 'plantTrees', args: [rect] });
    pending.ack(1);
    expect(pending.revision).toBe(2);
    expect(refresh).toHaveBeenCalledTimes(2);
    abort.abort('dispose');
    pending.add(2, { op: 'plantTrees', args: [rect] });
    pending.dispose();
    expect(pending.count).toBe(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    pending.subscribe(refresh, abort.signal);
    pending.ack(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
