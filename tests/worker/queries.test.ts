/** W0.3: synchronous local reads, clone boundaries, argument keys and real-time watch limits. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevType, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { LocalSimHost, watchFor } from '../../src/worker/SimHost';
import { exactDigest, QUERY_HANDLERS, type WatchPolicy } from '../../src/worker/queries';
import { newState, place } from '../infra/cityGen';

afterEach(() => vi.restoreAllMocks());

describe('LocalSimHost queries and watches', () => {
  it.each([
    [0, 'Refund §25,000 (built today)'],
    [20, 'Refund §12,500 (under 30 days old)'],
    [31, null],
  ] as const)('carries the preview refund through demolishRisks at age %i without recomputing it', async (age, line) => {
    const host = new LocalSimHost(newState(32));
    await host.start();
    try {
      expect(host.act('plop', ['util_coal_plant', 10, 10, 0]).predicted?.ok).toBe(true);
      const b = host.state.buildingAt(10, 10)!;
      b.age = age;
      const rect = { x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d };
      const pre = host.preview.bulldoze(rect);
      b.age = 31; // the query must use the caller's preview, not re-run the refund rule
      const risk = await host.query('demolishRisks', { rect, cost: pre.cost, refund: pre.refund, refundNote: pre.refundNote });
      expect(risk?.items[0]).toMatch(/^Your only power plant/);
      expect(risk?.items.filter((item) => item.startsWith('Refund'))).toEqual(line ? [line] : []);
      expect(host.state.buildings.has(b.id)).toBe(true);
    } finally { await host.dispose(); }
  });

  it('carries plain refund data through sideDemolishRisks without changing its displacement risk', async () => {
    const st = newState(32), b = place(st, 't_r1', 4, 4, { pop: 1500 });
    const host = new LocalSimHost(st);
    try {
      const risk = await host.query('sideDemolishRisks', { ids: [b.id], fee: 300, refund: 100, refundNote: 'built today' });
      expect(risk?.items).toEqual(['1 building will be demolished — 1,500 residents will be lost', 'Refund §100 (built today)']);
    } finally { await host.dispose(); }
  });

  it('evaluates immediately, deduplicates pending reads, and reads after a command or tick in a new epoch', async () => {
    const host = new LocalSimHost(newState(32));
    const read = vi.spyOn(QUERY_HANDLERS, 'verify');
    const before = host.query('verify', {});
    expect(read).toHaveBeenCalledTimes(1);
    expect(host.query('verify', {})).toBe(before);
    host.act('zone', [{ x0: 5, z0: 5, x1: 7, z1: 7 }, Zone.ResLow]);
    const after = host.query('verify', {});
    expect(read).toHaveBeenCalledTimes(2);
    expect(await after).not.toBe(await before);
    const today = host.query('verify', {});
    host.state.day++;
    const tomorrow = host.query('verify', {});
    expect(await tomorrow).not.toBe(await today);
    await host.dispose();
  });

  it.each<WatchPolicy>(['daily', 'monthly', 'change'])('caps %s pushes at 5 Hz even with reads every frame', async (policy) => {
    let now = 0;
    const host = new LocalSimHost(newState(32), { now: () => now });
    const read = vi.spyOn(QUERY_HANDLERS, 'verify');
    const w = host.watch('verify', {}, policy), abort = new AbortController(), pushed = vi.fn();
    w.subscribe(pushed, abort.signal);
    for (now = 10; now < 1000; now += 10) {
      host.state.day += policy === 'monthly' ? 31 : 1;
      host.frame(0);
      void w.value;
    }
    expect(read).toHaveBeenCalledTimes(5); // initial, 200, 400, 600, 800 ms
    expect(pushed).toHaveBeenCalledTimes(4);
    abort.abort('dispose');
    now = 1000; host.frame(0);
    expect(read).toHaveBeenCalledTimes(6);
    expect(pushed).toHaveBeenCalledTimes(4);
    w.dispose();
    now = 2000; host.state.day += 31; host.frame(0);
    expect(read).toHaveBeenCalledTimes(6);
    expect(w.value).toBeUndefined();
    await host.dispose();
  });

  it('keeps inspector results per argument key, at 1 Hz per key and 5 Hz across target/section changes', async () => {
    let now = 0;
    const st = newState(32), a = place(st, 't_r1', 4, 4, { pop: 4 }), b = place(st, 't_r2', 9, 9, { pop: 30 });
    const host = new LocalSimHost(st, { now: () => now });
    const read = vi.spyOn(QUERY_HANDLERS, 'inspectBuilding');
    const w = host.watch('inspectBuilding', { id: a.id, sections: [] }, 'change');
    expect(w.value?.building.id).toBe(a.id);
    w.setArgs({ id: b.id, sections: [] });
    expect(w.value).toBeUndefined(); // never a's report under b's header
    now = 200;
    expect(w.value?.building.id).toBe(b.id);
    b.pop++;
    now = 400;
    expect(w.value?.building.pop).toBe(30);
    w.setArgs({ id: a.id, sections: [] });
    expect(w.value?.building.id).toBe(a.id);
    expect(read).toHaveBeenCalledTimes(2);
    w.setArgs({ sections: ['environment'], id: b.id });
    expect(w.value?.environment).not.toBeNull();
    expect(read).toHaveBeenCalledTimes(3);
    w.setArgs({ id: a.id, sections: ['why'] });
    expect(w.value).toBeUndefined();
    now = 600;
    expect(w.value?.building.id).toBe(a.id);
    w.setArgs({ id: b.id, sections: [] });
    now = 1199;
    expect(w.value?.building.pop).toBe(30);
    now = 1200;
    expect(w.value?.building.pop).toBe(31);
    const count = read.mock.calls.length;
    now = 3000; host.frame(0);
    expect(read).toHaveBeenCalledTimes(count); // an unchanged signature is not recomputed
    await host.dispose();
  });

  it('refreshes a paused budget after a budget command, still respecting the cap', async () => {
    let now = 0;
    const host = new LocalSimHost(newState(32), { initialSpeed: 0, now: () => now });
    const read = vi.spyOn(QUERY_HANDLERS, 'computeMonthlyBudget');
    const w = host.watch('computeMonthlyBudget', {}, 'daily');
    host.act('setTax', [DevType.R1, 14]);
    now = 199; host.frame(0);
    expect(read).toHaveBeenCalledTimes(1);
    now = 200; host.frame(0);
    expect(read).toHaveBeenCalledTimes(2);
    expect(w.error).toBeUndefined();
    expect(host.state.day).toBe(0);
    await host.dispose();
  });

  it('clones action acknowledgements, query results and watch results without aliases into live state', async () => {
    const st = newState(32), b = place(st, 't_r1', 4, 4, { pop: 8 });
    const host = new LocalSimHost(st);
    const result = { ok: true, cost: 0, cells: [{ x: 4, z: 4, ok: true }] };
    vi.spyOn(host.actions.target, 'zone').mockReturnValue(result);
    const ack = await host.act('zone', [{ x0: 4, z0: 4, x1: 5, z1: 5 }, Zone.ResLow]).done;
    ack.cells![0].x = 99;
    expect(result.cells[0].x).toBe(4);
    const q = await host.query('inspectBuilding', { id: b.id, sections: ['residents', 'environment', 'why'] });
    const w = host.watch('inspectBuilding', { id: b.id, sections: ['residents', 'environment', 'why'] }, 'change');
    q!.building.pop = 999;
    w.value!.building.pop = 888;
    expect(b.pop).toBe(8);
    expect(q!.building).not.toBe(w.value!.building);
    await host.dispose();
  });

  it('rejects and reports non-cloneable results, including watch errors, without publishing them', async () => {
    const report = vi.fn(), host = new LocalSimHost(newState(32), { errors: { report } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(QUERY_HANDLERS, 'openAdvice').mockReturnValue([{ where: () => ({ x: 1, z: 2 }) }] as never);
    await expect(host.query('openAdvice', {})).rejects.toMatchObject({ name: 'DataCloneError' });
    const w = host.watch('openAdvice', {}, 'daily');
    expect(w.value).toBeUndefined();
    expect(w.error).toMatchObject({ name: 'DataCloneError' });
    expect(report).toHaveBeenCalledTimes(2);
    await host.dispose();
  });

  it('closes city-bound watches on abort and every remaining watch on host disposal', async () => {
    let now = 0;
    const host = new LocalSimHost(newState(32), { now: () => now }), abort = new AbortController();
    const read = vi.spyOn(QUERY_HANDLERS, 'verify');
    const bound = watchFor(host, 'verify', {}, 'daily', abort.signal);
    const other = host.watch('verify', {}, 'daily');
    abort.abort('dispose');
    now = 200; host.state.day++; host.frame(0);
    expect(bound.value).toBeUndefined();
    expect(other.value).toBeDefined();
    expect(read).toHaveBeenCalledTimes(3);
    await host.dispose();
    now = 400; host.frame(0);
    expect(other.value).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(3);
    await expect(host.query('verify', {})).rejects.toThrow('disposed');
  });
});

describe('verify exact state', () => {
  it('excludes lagged building fields and derived rasters, but includes primary cells, exact fields and plain data', () => {
    const st = newState(32), b = place(st, 't_r1', 4, 4);
    const before = exactDigest(st);
    b.pop++; b.health = 0.3; st.landValue[0] = 0.9;
    expect(exactDigest(st)).toBe(before);
    b.flags |= BF.Historic;
    expect(exactDigest(st)).not.toBe(before);
    const flags = exactDigest(st);
    st.zone[0] = Zone.ResLow;
    expect(exactDigest(st)).not.toBe(flags);
    const cell = exactDigest(st);
    st.funds--;
    expect(exactDigest(st)).not.toBe(cell);
  });
});
