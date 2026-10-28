/** T032: the game-facing packet boundary, without depending on T031's prediction implementation. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevType, Overlay, Zone } from '../../src/core/types';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { QUERY_HANDLERS, exactDigest } from '../../src/worker/queries';
import { CommandOutcomeLost, EntryType, assertOwnedBuffers, type Packet } from '../../src/worker/protocol';
import { overlayLayer, overlayReady } from '../../src/sim/infra/overlays';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { createSystems } from '../../src/sim/systems';
import { getCityRecord, clearRecoveryBase } from '../../src/save/cities';
import { openKV, MemoryKV, setKV, type StoreName } from '../../src/save/db';
import { newState, place, roadLine } from '../infra/cityGen';

/** the promise, or a rejection after a second: an outcome that never comes fails fast instead of timing out */
const within = <T>(p: Promise<T>, ms = 1000) => Promise.race([p,
  new Promise<never>((_, no) => setTimeout(() => no(new Error(`still pending after ${ms} ms`)), ms))]);
/** holds the city saves' IndexedDB writes until released */
class GatedKV extends MemoryKV {
  private open!: () => void;
  private gate = new Promise<void>((resolve) => { this.open = resolve; });
  release(): void { this.open(); }
  override async put(store: StoreName, value: unknown, key?: string): Promise<void> {
    if (store === 'cities') await this.gate;
    return super.put(store, value, key);
  }
}

afterEach(() => { vi.restoreAllMocks(); clearRecoveryBase(); setKV(new MemoryKV()); });

describe('LoopbackSimHost packets', () => {
  it('coalesces sliders and focus per frame, flushing inputs before a read boundary', async () => {
    const sent: { seq: number; op: string; args: unknown[] }[] = [];
    const host = new LoopbackSimHost(newState(16), { initialSpeed: 0, onPost: (m) => sent.push(m) });
    await host.start();
    try {
      const a = host.post('setTax', [DevType.R1, 4]);
      const b = host.post('setTax', [DevType.R1, 12]);
      host.post('setFunding', ['fire', 80]); host.post('setFunding', ['fire', 120]);
      expect(a.seq).toBe(b.seq); expect(a.done).toBe(b.done); expect(sent).toEqual([]);
      expect(host.state.budget.taxRates[DevType.R1]).toBe(12);
      const read = host.query('verify', {});
      expect(sent.map((m) => m.args)).toEqual([[DevType.R1, 12], ['fire', 120]]);
      const c = host.post('setTax', [DevType.R1, 6]);
      expect(c.seq).toBeGreaterThan(b.seq);
      await host.drain(); await read;
      expect(host.harness.primary.budget.taxRates[DevType.R1]).toBe(6);
      await expect(a.done).resolves.toBeUndefined(); await expect(c.done).resolves.toBeUndefined();
      const post = vi.spyOn(host.harness, 'post');
      host.setView({ overlay: Overlay.None, variant: 0, panels: [], focus: [1] });
      const view = { overlay: Overlay.None, variant: 0, panels: [], focus: [2] };
      host.setView(view); view.focus[0] = 3;
      expect(post).not.toHaveBeenCalled();
      host.frame(0); await host.drain();
      expect(post.mock.calls.map(([m]) => m).filter((m) => m.t === 'view')).toEqual([
        { t: 'view', v: { overlay: Overlay.None, variant: 0, panels: [], focus: [2] } },
      ]);
    } finally { await host.dispose(); }
  });
  it('posts asynchronously, strips preview cells, preserves tags, and delivers reads only after their command Ack', async () => {
    const packets: Packet[] = [], host = new LoopbackSimHost(newState(32), { loopback: { modules: undefined }, onPacket: (p) => packets.push(p) });
    await host.start();
    const tag = { callback: () => {} }, causes: unknown[] = [];
    const off = host.events.on('zoneChanged', () => causes.push(host.cause?.tag));
    try {
      const before = exactDigest(host.state), rect = { x0: 4, z0: 5, x1: 7, z1: 7 };
      const ticket = host.post('zone', [rect, Zone.ResLow], { tag });
      expect(exactDigest(host.state)).toBe(before);
      const read = host.query('verify', {});
      expect(host.query('verify', {})).toBe(read);
      await host.drain();
      expect(await ticket.done).toMatchObject({ ok: true });
      expect(await ticket.done).not.toHaveProperty('cells');
      expect(await read).toBe(exactDigest(host.state));
      expect(causes).toEqual([tag]); expect(host.cause).toBeNull();
      const ack = packets.findIndex((p) => p.log.some((e) => e[0] === EntryType.Ack));
      const reply = packets.findIndex((p) => p.replies?.some((r) => r.t === 'qres'));
      expect(reply).toBeGreaterThanOrEqual(ack);
      for (const p of packets) assertOwnedBuffers(p);
    } finally { off(); await host.dispose(); }
  });

  it('keeps argument caches separate, caps watches at 5 Hz, and isolates throwing subscribers', async () => {
    let now = 0;
    const st = newState(32), a = place(st, 't_r1', 4, 4), b = place(st, 't_r2', 9, 9);
    const report = vi.fn(), host = new LoopbackSimHost(st, { now: () => now, initialSpeed: 0, errors: { report } });
    await host.start();
    const read = vi.spyOn(QUERY_HANDLERS, 'inspectBuilding'), abort = new AbortController();
    try {
      const w = host.watch('inspectBuilding', { id: a.id, sections: [] }, 'change');
      const second = vi.fn();
      w.subscribe(() => { throw new Error('view'); }, abort.signal); w.subscribe(second, abort.signal);
      await host.drain();
      expect(w.value?.building.id).toBe(a.id);
      w.setArgs({ id: b.id, sections: [] });
      expect(w.value).toBeUndefined();
      await host.drain(); expect(read).toHaveBeenCalledTimes(1);
      now = 200; host.frame(0); await host.drain();
      expect(w.value?.building.id).toBe(b.id);
      expect(read).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledTimes(2);
      w.setArgs({ id: a.id, sections: [] }); expect(w.value?.building.id).toBe(a.id);
      await host.drain(); expect(read).toHaveBeenCalledTimes(2);
      expect(report).toHaveBeenCalled();
      abort.abort('dispose'); w.dispose(); await host.drain();
      expect(w.value).toBeUndefined();
    } finally { abort.abort('dispose'); await host.dispose(); }
  });

  it('puts clone failures and command errors in packets without breaking later reads', async () => {
    const report = vi.fn(), packets: Packet[] = [];
    const host = new LoopbackSimHost(newState(32), { initialSpeed: 0, errors: { report }, onPacket: (p) => packets.push(p) });
    await host.start();
    try {
      const spy = vi.spyOn(QUERY_HANDLERS, 'openAdvice').mockReturnValue([{ where: () => ({ x: 1, z: 2 }) }] as never);
      const failed = host.query('openAdvice', {}), w = host.watch('openAdvice', {}, 'daily');
      const rejected = expect(failed).rejects.toThrow(/cloneable/);
      await host.drain(); await rejected;
      // the worker's message and frames, not "Error: Error: …" with this replay's stack
      const [, reported] = report.mock.calls.find(([title]) => title === 'Query “openAdvice” failed')!;
      expect((reported as Error).message).toBe('Non-cloneable protocol value');
      expect((reported as Error).stack).toMatch(/copyOwned/);
      expect(w.error).toBeInstanceOf(Error); expect(w.value).toBeUndefined();
      expect(packets.some((p) => p.replies?.some((r) => r.t === 'error'))).toBe(true);
      expect(report).toHaveBeenCalled(); spy.mockRestore();
      const apply = vi.spyOn(host.harness.core, 'applyCommand').mockImplementationOnce(() => { throw new Error('command failed'); });
      const ticket = host.post('setHistoric', [-1, true]);
      const failedCommand = expect(ticket.done).rejects.toThrow('command failed');
      await host.drain(); await failedCommand; apply.mockRestore();
      expect(host.replica.applied).toBe(ticket.seq); expect(host.replica.diverged).toBe(false);
      expect(packets.some((p) => p.acks?.some((a) => (a as { commandError?: string })?.commandError))).toBe(true);
      const read = host.query('verify', {}); await host.drain(); expect(await read).toBe(exactDigest(host.state));
    } finally { await host.dispose(); }
  });

  it('dispatches a real incident through the command lane and refreshes its stream before the tagged ticket resolves', async () => {
    const st = newState(64); roadLine(st, 2, 20, 62, 20);
    const clinic = place(st, 't_clinic', 8, 19), home = place(st, 't_r2', 50, 21, { pop: 60 });
    const host = new LoopbackSimHost(st, { initialSpeed: 0, loopback: { lag: { seed: 5 } } });
    await host.start();
    const tag = {}, causes: unknown[] = [];
    const off = host.events.on('emergency', (e) => { if (e.type === 'dispatched') causes.push(host.cause?.tag); });
    try {
      const sim = host.harness.core.sim, em = emergencyOf(sim)!;
      const id = em.spawn(sim, 'medical', home.x, home.z, { buildingId: home.id, major: true });
      const options = host.query('dispatchOptions', { incidentId: id });
      await host.drain(); expect(await options).toEqual(em.dispatchOptions(sim, id));
      const ticket = host.post('dispatch', [id, clinic.id, 1], { tag });
      await host.drain(); expect((await ticket.done).ok).toBe(true);
      expect(causes).toEqual([tag]); expect(host.emergency.vehicles()).toEqual(em.vehicles());
      expect(host.emergency.stationFleet(clinic.id)).toEqual(em.stationFleet(clinic.id));
    } finally { off(); await host.dispose(); }
  });

  it('re-runs a dispatchOptions watch on a command inside the 200 ms cap, as LocalWatch (EM-1)', async () => {
    const st = newState(64); roadLine(st, 2, 20, 62, 20);
    const clinic = place(st, 't_clinic', 8, 19), home = place(st, 't_r2', 50, 21, { pop: 60 });
    // A frozen clock: every refresh below falls inside the cap, so only the command epoch can re-run the watch.
    const host = new LoopbackSimHost(st, { initialSpeed: 0, now: () => 0 });
    await host.start();
    try {
      const sim = host.harness.core.sim, em = emergencyOf(sim)!;
      const id = em.spawn(sim, 'medical', home.x, home.z, { buildingId: home.id, major: true });
      const w = host.watch('dispatchOptions', { incidentId: id }, 'change');
      await host.drain();
      const before = em.dispatchOptions(sim, id);
      expect(w.value).toEqual(before);
      const ticket = host.post('dispatch', [id, clinic.id, 1]);
      await host.drain(); expect((await ticket.done).ok).toBe(true);
      expect(em.dispatchOptions(sim, id)).not.toEqual(before);
      expect(w.value).toEqual(em.dispatchOptions(sim, id));
    } finally { await host.dispose(); }
  });

  it('captures save and snapshot watermarks before later FIFO commands, and never serializes the replica', async () => {
    setKV(new MemoryKV());
    const host = new LoopbackSimHost(newState(32), { persistence: { regionId: 'r', tileKey: 't' } });
    await host.start();
    try {
      const first = host.post('setTax', [DevType.R1, 6]);
      const saved = host.save('manual');
      const second = host.post('setTax', [DevType.R1, 12]);
      const snapshot = host.snapshot('hidden');
      await host.drain();
      const ack = await saved, snap = await snapshot;
      expect(ack.cmd).toBe(first.seq); expect(snap?.cmd).toBe(second.seq);
      expect(ack.pktSeq).toBeGreaterThan(0); expect(snap?.payload.length).toBeGreaterThan(0);
      const record = await getCityRecord(await openKV(), 'r', 't');
      expect((record?.city.data.budget as { taxRates: number[] }).taxRates[DevType.R1]).toBe(6);
      expect(host.state.budget.taxRates[DevType.R1]).toBe(12);
      expect(host.harness.primary.budget.taxRates[DevType.R1]).toBe(12);
    } finally { await host.dispose(); }
  });

  it('flushes the latest slider into the journal hook before synchronous recovery writes', async () => {
    const journal: unknown[] = [], writes: unknown[][] = [];
    const host = new LoopbackSimHost(newState(16), {
      onPost: (m) => journal.push(m), recovery: { writeNow: () => writes.push(structuredClone(journal)) },
    });
    await host.start();
    try {
      host.post('setTax', [DevType.R1, 4]); host.post('setTax', [DevType.R1, 12]);
      expect(journal).toEqual([]);
      host.recovery!.writeNow('beforeunload');
      expect(writes).toEqual([[{ t: 'cmd', seq: 1, op: 'setTax', args: [DevType.R1, 12] }]]);
      await host.drain();
    } finally { await host.dispose(); }
  });

  it('rebinds views on resync, retains whole news items, and aborts outstanding work with the city', async () => {
    const abort = new AbortController(), host = new LoopbackSimHost(newState(32), { signal: abort.signal, initialSpeed: 0 });
    await host.start();
    const core = host.harness;
    const read = host.watch('verify', {}, 'daily');
    try {
      const news = { day: 0, text: 'Advice', kind: 'info' as const, ref: { advice: 'a', reward: 'r' } };
      core.primary.news.push(news); core.core.sim.events.emit('news', news); core.flush(true);
      expect(host.state.news.at(-1)).toEqual(news);
      expect(host.state.news.at(-1)).not.toBe(news);
      host.setView({ overlay: Overlay.Demographics, variant: 0, panels: [], focus: [] });
      await host.drain(); expect(overlayLayer(host.state, Overlay.Demographics, 0)).not.toBeNull();
      const old = host.state;
      core.resync();
      expect(host.state).not.toBe(old); expect(overlayReady(host.state, Overlay.Demographics, 0)).toBe(false);
      await host.drain(); expect(read.value).toBeDefined();
      const ticket = host.post('setHistoric', [-1, true]);
      abort.abort('dispose');
      await expect(ticket.done).rejects.toThrow(/disposed/);
      expect(read.value).toBeUndefined(); expect(core.core.isDisposed).toBe(true);
      expect(() => host.post('setSpeed', [1, 'keyboard'])).toThrow(/disposed/);
      expect(host.state.buildings.size).toBe(0);
    } finally { await host.dispose(); }
  });

  it('mirrors the worker change count, so a resync that drops a packet in flight leaves no phantom dirty state', async () => {
    setKV(new MemoryKV());
    // A packet waits up to 1000 transport ticks and none pass below: the flushed change is in flight at the resync.
    const host = new LoopbackSimHost(newState(32), {
      initialSpeed: 0, persistence: { regionId: 'r', tileKey: 't' }, loopback: { lag: { seed: 3, packetTicks: 1000 } },
    });
    await host.start();
    const core = host.harness;
    try {
      await host.drain();
      const before = host.changes;
      expect(before).toBe(core.inbox.changes);
      core.primary.trees[2] = 3; core.core.sim.events.emit('treesChanged', { x0: 2, z0: 0, x1: 3, z1: 1 });
      expect(core.flush(true)?.changes).toBe(before + 1);
      expect(host.changes).toBe(before);
      core.resync();
      expect(host.changes).toBe(before + 1);
      // later packets carry the absolute count, so nothing is counted twice
      core.primary.trees[3] = 3; core.core.sim.events.emit('treesChanged', { x0: 3, z0: 0, x1: 4, z1: 1 });
      core.flush(true); await host.drain();
      expect(host.changes).toBe(before + 2);
      // main.ts marks the city clean when the save ack's count equals the host's
      const saved = host.save('manual');
      await host.drain();
      expect((await saved).changes).toBe(host.changes);
    } finally { await host.dispose(); }
  });

  it('keeps the inbox running while a save is written, and deltas a snapshot taken meanwhile against that save', async () => {
    const kv = new GatedKV(); setKV(kv);
    const host = new LoopbackSimHost(newState(32), { initialSpeed: 0, persistence: { regionId: 'r', tileKey: 't' } });
    await host.start();
    try {
      await host.drain();
      const saved = host.save('manual'), snapshot = host.snapshot('hidden');
      // the save's write is held: a command behind it in the FIFO still runs and acks
      const ticket = host.post('setHistoric', [-1, true]);
      await expect(within(ticket.done)).resolves.toBeUndefined();
      kv.release();
      await host.drain();
      const ack = await saved, snap = await snapshot;
      expect(ack.cmd).toBe(0); expect(snap?.cmd).toBe(0);
      expect(snap?.marker.baseSavedAt).toBe(ack.savedAt);
      expect((await getCityRecord(await openKV(), 'r', 't'))?.savedAt).toBe(ack.savedAt);
    } finally { kv.release(); await host.dispose(); }
  });

  it('rejects on resync only what it dropped: later reads and saves still reply, applied commands settle as applied', async () => {
    setKV(new MemoryKV());
    const resyncs: number[] = [];
    // packets wait up to 1000 transport ticks, none pass below, and the core never stalls: replies stay in flight
    const host = new LoopbackSimHost(newState(32), { initialSpeed: 0, persistence: { regionId: 'r', tileKey: 't' },
      onResync: (cmd) => resyncs.push(cmd), loopback: { lag: { seed: 3, packetTicks: 1000, longUnitChance: 0 } } });
    await host.start();
    const core = host.harness;
    try {
      await host.drain();
      const early = host.query('verify', {}), ticket = host.post('setHistoric', [-1, true]);
      const settled = [early, ticket.done].map((p) => { let done = false; void p.then(() => { done = true; }, () => { done = true; }); return () => done; });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(core.inbox.cmd).toBe(ticket.seq);
      expect(settled.map((done) => done())).toEqual([false, false]);
      core.post({ t: 'resync' });
      const late = host.query('dispatchOptions', { incidentId: 999 }), saved = host.save('manual');
      await host.drain();
      await expect(early).rejects.toThrow(/interrupted by resync/);
      await expect(ticket.done).rejects.toBeInstanceOf(CommandOutcomeLost);
      await expect(late).resolves.toEqual([]);
      expect((await saved).cmd).toBe(ticket.seq);
      expect(resyncs).toEqual([ticket.seq]);
    } finally { await host.dispose(); }
  });

  it('still replies with the tab hidden: no ticks ack packets, so backpressure counts those in flight', async () => {
    setKV(new MemoryKV());
    const host = new LoopbackSimHost(newState(32), { initialSpeed: 0, persistence: { regionId: 'r', tileKey: 't' } });
    await host.start();
    try {
      // neither frame() nor drain(): nothing acks, as with requestAnimationFrame stopped
      for (let i = 0; i < 6; i++) expect(await within(host.query('verify', {}))).toBe(exactDigest(host.state));
      expect((await within(host.save('hidden'))).cmd).toBe(0);
    } finally { await host.dispose(); }
  });

  it('rejects an atDay mismatch as a command, and runs every op on stand-in actions when CityActions fails', async () => {
    const acks: [number, unknown][] = [];
    const host = new LoopbackSimHost(newState(32), { initialSpeed: 0, onAck: (seq, result) => acks.push([seq, result]) });
    await host.start();
    try {
      host.harness.post({ t: 'cmd', seq: 1, op: 'setSpeed', args: [1, 'keyboard'], atDay: 99 });
      await host.drain();
      expect(acks).toEqual([[1, { ok: false, commandError: 'atDay requires a deterministic day boundary' }]]);
      expect(host.harness.core.isDisposed).toBe(false);
    } finally { await host.dispose(); }
    class Broken { constructor() { throw new Error('no actions'); } }
    const degraded = new LoopbackSimHost(newState(32), { initialSpeed: 1, loopback: { modules: { createSystems, CityActions: Broken as never } } });
    await degraded.start();
    try {
      const pause = degraded.post('setSpeed', [0, 'pause']), tax = degraded.post('setTax', [DevType.R1, 11]);
      await degraded.drain();
      await expect(pause.done).resolves.toBeUndefined(); await expect(tax.done).resolves.toBeUndefined();
      expect(degraded.harness.core.sim.speed).toBe(0);
      expect(degraded.harness.primary.budget.taxRates[DevType.R1]).toBe(11);
    } finally { await degraded.dispose(); }
  });

  it('isolates a throwing packet observer, and drops frames posted before boot', async () => {
    const report = vi.fn();
    const host = new LoopbackSimHost(newState(16), { initialSpeed: 3, errors: { report }, onPacket: () => { throw new Error('observer'); } });
    // before boot: the core starts from its own clock, so these never step it (four would be twenty days at speed 3)
    for (let i = 0; i < 4; i++) host.frame(1);
    await host.start();
    try {
      const day = host.harness.primary.day;
      const read = host.query('verify', {}); await host.drain();
      expect(await read).toBe(exactDigest(host.state));
      expect(report).toHaveBeenCalledWith('packet observer', expect.objectContaining({ message: 'observer' }), expect.anything());
      expect(host.harness.core.isDisposed).toBe(false);
      expect(host.harness.primary.day).toBe(day); expect(day).toBe(0);
    } finally { await host.dispose(); }
  });
});
