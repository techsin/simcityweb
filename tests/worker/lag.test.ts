/** R1/R3/R16: delayed packets, held acknowledgements and virtual 50–150 ms units. */
import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DevType, Network, Overlay, Zone } from '../../src/core/types';
import { CityState, BF } from '../../src/sim/CityState';
import { CityActions, type ActionResult } from '../../src/sim/actions';
import { serializeCity } from '../../src/save/serialize';
import { commitAction } from '../../src/game/tools/Tool';
import type { GameContext } from '../../src/game/context';
import { LocalSimHost, type Command } from '../../src/worker/SimHost';
import { LoopbackSimHost, PacketSimHost } from '../../src/worker/LoopbackSimHost';
import { SeededLag } from '../../src/worker/loopbackCore';
import { DefTable, EntryType, EVENT_NAMES, RecordBuffer, type Packet } from '../../src/worker/protocol';
import { exactDigest } from '../../src/worker/queries';
import { checkReplica } from '../../tools/bench/worker/checkReplica';
import { grownFixture, loadFixture } from '../../tools/bench/worker/fixtures';
import { newState, place, roadLine, stressCity } from '../infra/cityGen';

const actionsPresent = Object.keys(import.meta.glob('../../src/worker/HostActions.ts')).length > 0;
const profile = { seed: 32, packetTicks: 6, ackTicks: 6, longUnitChance: 0.25, unitMs: [50, 150] as const };

/** A reproducible full command round, with dependent edits kept adjacent in posting order. */
function commands(st: CityState, random: SeededLag): Command[] {
  const x = 3 + Math.floor(random.random() * (st.size - 12)), z = 3 + Math.floor(random.random() * (st.size - 12));
  const rect = { x0: x, z0: z, x1: x + 2, z1: z + 2 }, path = [{ x, z }, { x: x + 1, z }];
  const b = st.buildings.values().next().value, loan = st.budget.loans[0];
  return [
    { op: 'bulldoze', args: [rect] }, { op: 'plop', args: ['park_small', x, z, 0] },
    { op: 'terraform', args: ['raise', x, z, 2, 0.5] }, { op: 'plop', args: ['park_small', x, z, 0] },
    { op: 'zone', args: [rect, Zone.ResLow] }, { op: 'dezone', args: [rect] },
    { op: 'buildNetwork', args: [path, Network.Road] }, { op: 'buildPowerLine', args: [path] }, { op: 'buildSubway', args: [path] },
    ...Array.from({ length: 3 }, (): Command => ({ op: 'plantTrees', args: [rect] })),
    ...Array.from({ length: 3 }, (): Command => ({ op: 'terraform', args: ['smooth', x, z, 2, 0.5] })),
    { op: 'setTax', args: [DevType.R1, 4] }, { op: 'setTax', args: [DevType.R1, 7] },
    { op: 'setFunding', args: ['fire', 80] }, { op: 'setFunding', args: ['fire', 120] },
    { op: 'setHistoric', args: [b?.id ?? -1, true] }, { op: 'setHistoric', args: [b?.id ?? -1, false] },
    { op: 'setOrdinance', args: ['nuclear_free_zone', true, { confirm: true }] },
    { op: 'takeLoan', args: [10000] }, { op: 'repayLoan', args: [0, { principal: loan?.principal ?? 10000, monthsLeft: loan?.monthsLeft ?? 120 }] },
    { op: 'setSpeed', args: [3, 'keyboard'] }, { op: 'setSpeed', args: [0, 'pause'] }, { op: 'resume', args: ['pause'] },
    { op: 'triggerDisaster', args: ['fire', b?.x ?? x, b?.z ?? z] },
    { op: 'dispatch', args: [-1, -1, 1] }, { op: 'dispatchBest', args: [-1] }, { op: 'dismissAlert', args: [-1] },
    { op: 'setCamera', args: [{ x: 80, z: 90, distance: 450, yaw: 20, tilt: 40 }] },
    { op: 'setSettings', args: [{ emergencyUncovered: 'ignore', emergencyLiveSlowmo: 3, emergencyAlerts: 'major' }] },
  ];
}

function seenCity(st: CityState): CityState {
  // Oracle only: clone the visible state, not a save or a path around the replica save guards.
  return Object.setPrototypeOf(structuredClone(st), CityState.prototype) as CityState;
}

describe('loopback lag properties', () => {
  it('uses a reproducible profile with 0–6 tick packets, held acks and 50–150 ms units', () => {
    const a = new SeededLag(profile), b = new SeededLag(profile);
    const samples = Array.from({ length: 1000 }, () => [a.packet(false), a.packet(true), a.unit()]);
    expect(samples).toEqual(Array.from({ length: 1000 }, () => [b.packet(false), b.packet(true), b.unit()]));
    expect(samples.some((s) => s[0] === 0)).toBe(true); expect(samples.some((s) => s[0] === 6)).toBe(true);
    expect(samples.every(([p, ack, unit]) => p <= 6 && ack >= 6 && (unit === 0 || unit >= 50 && unit <= 150))).toBe(true);
    expect(samples.some((s) => s[2] >= 50)).toBe(true);
  });

  for (const [name, create, present] of [
    ['generated 128²', () => stressCity(128).st, true],
    ['grown fixture', () => loadFixture(grownFixture()), existsSync(grownFixture())],
  ] as const) it.skipIf(!present)(`${name}: every op under lag, 120 days, replies follow Acks and final drain equals authority`, { timeout: 300000 }, async () => {
    const errors: unknown[] = [], ops = new Set<string>(), tickets: Promise<unknown>[] = [], random = new SeededLag({ seed: 319 });
    let replies = 0, packets = 0, posted = 0;
    let issuing = false, listenerChecks = 0;
    const optimistic = new Map<string, { seq: number; read(): unknown; value: unknown }>();
    const checkOptimism = () => {
      if (issuing) return; // a player's new optimistic write intentionally supersedes the previous value
      for (const [key, e] of optimistic) if (e.seq > host.replica.applied) expect(e.read(), key).toEqual(e.value);
    };
    const st = create(); st.funds = 1e7;
    const host = new LoopbackSimHost(st, {
      errors: { report: (...e) => errors.push(e) }, loopback: { cadence: 'design', lag: profile, recorder: { dev: true } },
      onReply: (reply) => { replies++; expect(reply.cmd).toBeLessThanOrEqual(host.replica.applied); },
      onPacket: (p) => { packets++; expect(p.cmd).toBe(host.replica.applied); checkOptimism(); },
    });
    await host.start();
    const offs = EVENT_NAMES.map((name) => host.events.on(name, () => { checkOptimism(); listenerChecks++; }));
    const w = host.watch('computeMonthlyBudget', {}, 'change');
    const abort = new AbortController();
    w.subscribe(() => { expect(host.replica.applied).toBeLessThanOrEqual(posted); }, abort.signal);
    try {
      for (let day = 0; day < 120; day++) {
        if (day % 12 === 0) for (const c of commands(host.state, random)) {
          ops.add(c.op);
          issuing = true;
          const ticket = host.post(c.op, c.args); posted = ticket.seq; tickets.push(ticket.done);
          issuing = false;
          let key = '', read: (() => unknown) | undefined;
          if (c.op === 'setTax') { const d = c.args[0]; key = `tax:${d}`; read = () => host.state.budget.taxRates[d]; }
          if (c.op === 'setFunding') { const s = c.args[0]; key = `funding:${s}`; read = () => host.state.budget.funding[s]; }
          if (c.op === 'setSpeed' || c.op === 'resume') { key = 'speed'; read = () => host.speed; }
          if (read) optimistic.set(key, { seq: ticket.seq, read, value: read() });
        }
        tickets.push(host.query('inspectCell', { x: day % st.size, z: 3, sections: [] }));
        host.harness.runDays(1);
        for (let tick = 0; tick < 4; tick++) { host.frame(0.008 + random.random() * 0.025); await Promise.resolve(); }
        if (day % 12 === 11) await host.drain();
      }
      await host.drain();
      host.harness.advanceTransport(1000); await host.drain();
      host.harness.flush(true, st.buildings.size); await host.drain();
      await Promise.all(tickets);
      // mirrored layers against what was last sent: a utilities pass may still be in flight (F6)
      checkReplica(host.harness.primary, host.replica, true, undefined, host.harness.delivered);
      expect(exactDigest(host.state)).toBe(exactDigest(host.harness.primary));
      expect(ops.size).toBe(23); expect(replies).toBe(120); expect(packets).toBeGreaterThan(120);
      expect(listenerChecks).toBeGreaterThan(120);
      expect(errors).toEqual([]);
    } finally { for (const off of offs) off(); abort.abort('dispose'); await host.dispose(); }
  });

  it('R1: no optimistic field reverts inside any listener, after event records, focus records, plain, policy or clock writes', async () => {
    const st = newState(16), b = place(st, 't_r1', 3, 3);
    const snapshot = serializeCity(st, { copy: true }), clock = { day: 0, frac: 0, speed: 1, slow: 1, spd: 0.5, live: false };
    const errors: unknown[] = [];
    const host = new PacketSimHost('loopback', { t: 'ready', snapshot, streams: {}, policy: { alerts: [{ id: 7, wasPossible: true }], live: false }, clock, savedAt: 0, cmd: 0 }, { errors: { report: (...e) => errors.push(e) }, optimistic: CityActions });
    host.connect(() => {});
    const historic = host.post('setHistoric', [b.id, true]);
    host.post('setTax', [DevType.R1, 12]); host.post('setFunding', ['fire', 120]);
    host.post('dismissAlert', [7]); host.post('setSpeed', [3, 'keyboard']);
    let listeners = 0;
    const check = () => {
      expect(host.state.buildings.get(b.id)!.flags & BF.Historic).toBeTruthy();
      expect(host.state.budget.taxRates[DevType.R1]).toBe(12); expect(host.state.budget.funding.fire).toBe(120);
      expect(host.policy.alerts).toEqual([]); expect(host.speed).toBe(3);
    };
    const offs = EVENT_NAMES.map((name) => host.events.on(name, () => { check(); listeners++; }));
    try {
      const defs = new DefTable(snapshot.buildings.defs), recs = new RecordBuffer(); recs.add(b, defs);
      const data = recs.take();
      const p: Packet = { seq: 1, cmd: 0, clock, plain: { budget: structuredClone(st.budget) },
        recs: data, blds: data.slice(), policy: { alerts: [{ id: 7, wasPossible: true }], live: false },
        log: [[EntryType.BuildingChanged, 0, 0], [EntryType.Day, 0, 0], [EntryType.SpeedChanged, 0, 1]] };
      host.receive(structuredClone({ t: 'pkt', p }));
      check(); expect(listeners).toBe(3); expect(errors).toEqual([]); expect(host.replica.diverged).toBe(false);
      let settled = false; void historic.done.catch(() => {}).then(() => { settled = true; });
      await Promise.resolve(); expect(settled).toBe(false);
    } finally { for (const off of offs) off(); await host.dispose(); }
  });

  it.skipIf(!actionsPresent)('HostActions never refuses an edit accepted on the visible replica plus pending FIFO commands', { timeout: 120000 }, async () => {
    const st = newState(32); st.funds = 1e6; roadLine(st, 2, 10, 30, 10); place(st, 't_r1', 6, 11);
    const host = new LoopbackSimHost(st, { initialSpeed: 0, loopback: { lag: profile } });
    await host.start();
    const pending = new Map<number, Command>(), rng = new SeededLag({ seed: 873 });
    let accepted = 0;
    try {
      for (let round = 0; round < 4; round++) for (const c of commands(host.state, rng)) {
        const oracle = new LocalSimHost(seenCity(host.state));
        void oracle.start({ CityActions }); // explicit modules boot synchronously, before this commit
        for (const [seq, prior] of pending) if (seq > host.replica.applied) oracle.act(prior.op, prior.args);
        const expected = oracle.act(c.op, c.args).predicted as ActionResult | undefined;
        const ticket = host.act(c.op, c.args);
        if (expected && typeof expected === 'object' && expected.ok) {
          accepted++;
          expect(ticket.seq > 0 || (ticket.predicted as ActionResult)?.ok, c.op).toBe(true);
        }
        if (ticket.seq) {
          pending.set(ticket.seq, c);
          void ticket.done.then(() => pending.delete(ticket.seq), () => pending.delete(ticket.seq));
        }
        void oracle.dispose();
        host.frame(0.008 + rng.random() * 0.025); await Promise.resolve();
      }
      await host.drain(); expect(accepted).toBeGreaterThan(0); expect(host.pending.count).toBe(0);
    } finally { await host.dispose(); }
  });

  it('the issuing tool corrects at most once per gesture while several held commands fail', async () => {
    const st = newState(32); st.funds = 1e6; roadLine(st, 2, 10, 30, 10);
    const host = new LoopbackSimHost(st, { initialSpeed: 0, loopback: { lag: profile } });
    await host.start();
    const abort = new AbortController(), failure = vi.fn(), ok = vi.fn(), owner = {}, gesture = host.beginGesture(owner);
    const ctx = { host, signal: abort.signal, world: { setPendingPreview: vi.fn() } } as unknown as GameContext;
    try {
      // A sim-side expense the player has not received contradicts the first exact ok prediction after T031 merges.
      host.harness.primary.funds = 0;
      const tickets = Array.from({ length: 6 }, () => commitAction(ctx, owner, 'plop', ['park_small', 12, 11, 0], { ok, fail: failure }, gesture));
      gesture.end(); await host.drain(); await gesture.settled;
      expect((await Promise.all(tickets.map((t) => t.done))).every((r) => !r.ok)).toBe(true);
      expect(failure).toHaveBeenCalledTimes(1);
    } finally { abort.abort('dispose'); await host.dispose(); }
  });
});
