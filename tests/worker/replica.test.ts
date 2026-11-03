/** W1.1a design cadence and focused fidelity regressions; commands belong to W1.1b. */
import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Network, Overlay } from '../../src/core/types';
import { BF, HISTORY_KEYS } from '../../src/sim/CityState';
import { buildingList } from '../../src/sim/infra/common';
import type { EmergencySystem } from '../../src/sim/infra/emergency';
import { triggerDisaster } from '../../src/sim/infra/disasters';
import { HISTORY_CAP } from '../../src/sim/economy/history';
import { LoopbackCore } from '../../src/worker/loopbackCore';
import { REPLICA } from '../../src/worker/replica';
import { EntryType, REC, assertOwnedBuffers, type Packet } from '../../src/worker/protocol';
import { FirstFailure, ReplicaCheck, checkReplica, checkValue } from '../../tools/bench/worker/checkReplica';
import { grownFixture, loadFixture } from '../../tools/bench/worker/fixtures';
import { newState, place, stressCity } from '../infra/cityGen';

const empty = () => new LoopbackCore(newState(16), { modules: {}, recorder: { dev: true } });

describe('replica design cadence', () => {
  for (const [label, create, present] of [
    ['generated 128²', () => stressCity(128).st, true],
    ['grown fixture (SIM_GROWN_FIXTURE / SIM_FIXTURES)', () => loadFixture(grownFixture()), existsSync(grownFixture())],
  ] as const) {
    it.skipIf(!present)(`${label}: 120 days, every packet exact and full rolling rounds converge`, { timeout: 300000 }, () => {
      const failure = new FirstFailure();
      let packets = 0;
      const loop = new LoopbackCore(create(), {
        recorder: { dev: true, onAuditError: (id, field) => failure.record(`audit ${id}.${field}`, 'silent exact-field write') },
        errors: { report: (title, error) => failure.record(title, error) },
        replica: { report: (key, error) => failure.record(key, error) },
        // Outside the guarded sim/view callbacks: the first failure throws out of runDays immediately.
        onPacket: (p, host) => { failure.check(p); assertOwnedBuffers(p); check.packet(p, host.elapsedTimeMs); packets++; },
      });
      const check = new ReplicaCheck(loop.core.sim, loop.replica);
      try {
        for (let day = 1; day <= 120; day++) {
          loop.runDays(1);
          if (day % 30 === 0) { loop.forceRollingRound(); check.rolling(); }
        }
        expect(packets).toBeGreaterThanOrEqual(120);
        check.finish();
      } finally { check.dispose(); loop.dispose(); }
    });
  }

  it('NOTE-020: flush-time bytes, per-group retention and only deferred LayerUpdated moves (including duplicate emits)', () => {
    const st = newState(16); st.network[1] = Network.Road;
    const packets: Packet[] = [];
    const loop = new LoopbackCore(st, {
      cadence: 'live', initialSpeed: 0, modules: {},
      onPacket: (p, host) => { check.packet(p, host.elapsedTimeMs); packets.push(p); },
    });
    const check = new ReplicaCheck(loop.core.sim, loop.replica, () => loop.recorder.cause);
    const emit = (group: 'traffic' | 'utilities', cause: number) => {
      loop.recorder.cause = cause; loop.core.sim.events.emit('layerUpdated', group); loop.recorder.cause = undefined;
    };
    try {
      st.traffic[1] = 10; st.congestion[1] = 0.1; emit('traffic', 7);
      // A new pass writes after the event but before the flush: F4 includes these values.
      st.traffic[1] = 11; st.congestion[1] = 0.125; st.traffic[3] = 5;
      loop.core.sim.events.emit('speedChanged', 0); loop.flush(true);
      expect(loop.state.traffic[1]).toBe(11); expect(loop.state.congestion[1]).toBe(0.125);

      st.day = 1; st.traffic[1] = 20; emit('traffic', 8);
      st.trees[2] = 3; loop.core.sim.events.emit('treesChanged', { x0: 2, z0: 0, x1: 3, z1: 1 });
      st.powered[1] = 1; st.watered[1] = 1; emit('utilities', 9);
      st.powered[2] = 1; st.watered.fill(1); st.traffic[1] = 21;
      loop.frame(0.1); // t=100: utilities' first delivery; traffic is deferred.
      expect(loop.state.traffic[1]).toBe(11); expect(loop.state.powered[2]).toBe(1); expect(loop.state.watered[3]).toBe(1);
      expect(packets[1].log.map((e) => e[0])).toEqual([EntryType.TreesChanged, EntryType.LayerUpdated]);
      expect(packets[1].layers?.some((p) => p.name === 'powered' && 'idx' in p)).toBe(true);
      expect(packets[1].layers?.some((p) => p.name === 'watered' && 'whole' in p)).toBe(true);

      st.day = 2; loop.core.sim.events.emit('speedChanged', 0);
      st.traffic[1] = 30; emit('traffic', 10);
      st.powered[1] = 0; st.watered[1] = 0; emit('utilities', 11);
      st.traffic[1] = 31; st.congestion[1] = 0.5; st.powered[3] = 1; st.watered[2] = 0;
      loop.frame(0.149); // t=249: both groups retain the last bytes sent, even though both primaries differ.
      expect(loop.state.traffic[1]).toBe(11); expect(loop.state.powered[1]).toBe(1); expect(loop.state.watered[2]).toBe(1);
      loop.frame(0.001); // t=250: both retained traffic entries arrive before the still-deferred utilities entry.
      expect(packets.at(-1)!.log).toEqual([[EntryType.LayerUpdated, 1, 'traffic', 8], [EntryType.LayerUpdated, 2, 'traffic', 10]]);
      expect(loop.state.traffic[1]).toBe(31); expect(loop.state.congestion[1]).toBe(0.5);
      expect(loop.state.powered[1]).toBe(1);
      loop.frame(0.099); loop.flush(true); // A forced packet must not bypass the 250 ms throttle.
      expect(packets.at(-1)!.log).toEqual([]); expect(loop.state.powered[3]).toBe(0);
      loop.frame(0.001); // t=350: utilities now deliver end-of-packet values.
      expect(packets.at(-1)!.log).toEqual([[EntryType.LayerUpdated, 2, 'utilities', 11]]);
      expect(loop.state.powered[1]).toBe(0); expect(loop.state.powered[3]).toBe(1); expect(loop.state.watered[2]).toBe(0);
      const firstTraffic = packets[0].layers!.find((p) => p.name === 'traffic')!;
      expect('road' in firstTraffic && firstTraffic.road[0]).toBe(11);
      check.finish();
    } finally { check.dispose(); loop.dispose(); }
  });

  it.each(['powered', 'watered', 'traffic', 'congestion'] as const)('NOTE-020: detects a silent replica write to %s between deliveries', (name) => {
    const loop = empty(), check = new ReplicaCheck(loop.core.sim, loop.replica);
    try {
      loop.primary[name][4] = 1; // Silent primary progress is allowed.
      const p = loop.flush(true)!; check.packet(p, loop.elapsedTimeMs);
      loop.state[name][4] = 1; // Matching that unsent primary value on the replica is still a failure.
      const next = loop.flush(true)!;
      expect(() => check.packet(next, loop.elapsedTimeMs)).toThrow(new RegExp(`packet 2: ${name}; first differing index=4; primary\\(last sent\\)=0; replica=1; differing cells=1`));
    } finally { check.dispose(); loop.dispose(); }
  });

  it.each(['reorder', 'drop', 'duplicate', 'day', 'cause'] as const)('NOTE-020/F6: rejects %s corruption instead of ignoring layer events', (corruption) => {
    const loop = empty(), check = new ReplicaCheck(loop.core.sim, loop.replica);
    try {
      loop.core.sim.events.emit('speedChanged', 0);
      loop.core.sim.events.emit('layerUpdated', 'services');
      loop.core.sim.events.emit('layerUpdated', 'traffic');
      const p = loop.recorder.flush({ force: true })!;
      if (corruption === 'reorder') [p.log[0], p.log[1]] = [p.log[1], p.log[0]];
      if (corruption === 'drop') p.log.pop(); // The first traffic event has no throttle excuse.
      if (corruption === 'duplicate') p.log.push([...p.log[2]]);
      if (corruption === 'day') p.log[2][1]++;
      if (corruption === 'cause') p.log[2][3] = 7;
      expect(loop.replica.apply(structuredClone(p))).toBe(true);
      expect(() => check.packet(p, loop.elapsedTimeMs)).toThrow(/packet 1: event log order\/day\/cause/);
    } finally { check.dispose(); loop.dispose(); }
  });

  it('NOTE-020: a mismatch escapes the frame loop once, with scalar diagnostics for a 16384-cell difference', () => {
    let frames = 0, packets = 0;
    const loop = new LoopbackCore(newState(128), {
      cadence: 'live', initialSpeed: 0, modules: {},
      onPacket: (p, host) => {
        packets++; host.replica.state.traffic.fill(99);
        check.packet(p, host.elapsedTimeMs);
      },
    });
    const check = new ReplicaCheck(loop.core.sim, loop.replica);
    let error: unknown;
    try {
      try { for (; frames < 100; ) { frames++; loop.frame(0.25); } } catch (e) { error = e; }
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('packet 1: traffic; first differing index=0; primary(last sent)=0; replica=99; differing cells=16384; log=[]');
      expect(message.length).toBeLessThan(500);
      expect(error).not.toHaveProperty('actual'); expect(error).not.toHaveProperty('expected');
      expect(frames).toBe(1); expect(packets).toBe(1);
    } finally { check.dispose(); loop.dispose(); }
  });

  it('F1–F3/F6: added, changed and removed in one packet retain event-time values, identity, day and cause', () => {
    const viewErrors: unknown[] = [];
    const loop = new LoopbackCore(newState(16), { modules: {}, replica: { report: (_key, e) => viewErrors.push(e) } });
    const st = loop.primary, sim = loop.core.sim, seen: unknown[] = [];
    let held: unknown;
    loop.replica.events.on('buildingAdded', (b) => {
      held = b;
      seen.push(['add', b.pop, b.built, loop.state.day, loop.replica.cause?.seq]);
      expect(loop.state.trees[st.idx(2, 3)]).toBe(0);
      expect(loop.state.building[st.idx(2, 3)]).toBe(b.id);
    });
    loop.replica.events.on('buildingChanged', (b) => { expect(b).toBe(held); seen.push(['change', b.pop, b.built, loop.state.day]); });
    loop.replica.events.on('buildingRemoved', (b) => {
      expect(b).toBe(held); expect(loop.state.buildings.has(b.id)).toBe(false);
      expect(loop.state.building[st.idx(2, 3)]).toBe(-1);
      seen.push(['remove', b.pop, b.built, loop.state.day]);
    });
    try {
      st.day = 359; st.trees[st.idx(2, 3)] = 4;
      const b = place(st, 't_r1', 2, 3, { pop: 1, built: 0.1, flags: BF.Constructing });
      loop.recorder.cause = 7;
      sim.events.emit('buildingAdded', b);
      loop.recorder.cause = undefined;
      st.trees[st.idx(2, 3)] = 0;
      sim.events.emit('treesChanged', { x0: 2, z0: 3, x1: 3, z1: 4 });
      b.pop = 2; b.built = 0.5; sim.events.emit('buildingChanged', b);
      st.day = 360; b.pop = 3; b.built = 1; st.buildings.delete(b.id); st.building[st.idx(2, 3)] = -1;
      sim.events.emit('buildingRemoved', b);
      loop.flush(true);
      expect(seen).toEqual([['add', 1, 0.1, 359, 7], ['change', 2, 0.5, 359], ['remove', 3, 1, 360]]);
      expect(loop.replica.cause).toBeNull();
      expect(viewErrors).toEqual([]);
      checkReplica(st, loop.replica);
    } finally { loop.dispose(); }
  });

  it('R2: rolling repairs a value restored after an event-time record, with focus and construction records too', () => {
    const st = newState(16), b = place(st, 't_r1', 2, 2, { pop: 10, jobs: 15, built: 0.25, flags: BF.Constructing });
    const loop = new LoopbackCore(st, { modules: {}, recorder: { dev: true, rollingCount: 0 } });
    try {
      b.jobs = 30; loop.core.sim.events.emit('buildingChanged', b); b.jobs = 15;
      loop.flush(true);
      expect(loop.state.buildings.get(b.id)?.jobs).toBe(30);
      loop.flush(true, st.buildings.size);
      expect(loop.state.buildings.get(b.id)?.jobs).toBe(15);
      loop.setView({ overlay: Overlay.None, variant: 0, panels: [], focus: [b.id] });
      b.pop = 12; b.jobs = 20; loop.flush(true);
      expect(loop.state.buildings.get(b.id)?.pop).toBe(12);
      loop.setView({ overlay: Overlay.None, variant: 0, panels: [], focus: [] });
      b.pop = 10; b.jobs = 15; loop.flush(true, 1);
      checkReplica(st, loop.replica, true);
      b.built = 0.75; b.jobs = 18; loop.runDays(1);
      expect(loop.state.buildings.get(b.id)?.built).toBe(0.75);
      b.jobs = 15; loop.flush(true, 1);
      checkReplica(st, loop.replica, true);
    } finally { loop.dispose(); }
  });

  it('R8: an actual unserved fire replays its final lost count before the ended incident is forgotten', () => {
    const st = newState(32), b = place(st, 't_r2', 12, 12, { pop: 40 });
    const viewErrors: unknown[] = [];
    const loop = new LoopbackCore(st, { replica: { report: (_key, e) => viewErrors.push(e) } });
    const em = loop.core.sim.getSystem<EmergencySystem>('emergency')!;
    let losses = 0, id = 0, held: unknown;
    loop.replica.events.on('emergency', (e) => {
      const inc = loop.replica.emergency.incident(e.id)!;
      if (e.type === 'new' && e.kind === 'fire') { id = e.id; held = inc; }
      if (e.type === 'failed' && e.id === id) {
        expect(inc).toBe(held); expect(em.incident(e.id)).toBeUndefined();
        expect(inc.state).toBe('failed'); losses = inc.lost;
      }
    });
    try {
      expect(triggerDisaster(loop.core.sim, 'fire', b.x, b.z)).toBe(true);
      loop.flush(true);
      loop.runDays(40);
      expect(losses).toBeGreaterThan(0);
      expect(viewErrors).toEqual([]);
      expect(loop.replica.emergency.incident(id)).toBeUndefined();
    } finally { loop.dispose(); }
  });

  it('F4/R8: live incidents return to their end-of-packet values after each event-time replay', () => {
    const st = newState(32), b = place(st, 't_r1', 12, 12);
    const loop = new LoopbackCore(st);
    try {
      triggerDisaster(loop.core.sim, 'fire', b.x, b.z);
      const em = loop.core.sim.getSystem<EmergencySystem>('emergency')!, inc = em.incidents()[0];
      expect(inc).toBeDefined();
      const before = inc.lost;
      const seen: number[] = [];
      loop.replica.events.on('emergency', (e) => { if (e.id === inc.id) seen.push(loop.replica.emergency.incident(e.id)!.lost); });
      inc.lost = before + 3;
      loop.flush(true);
      expect(seen.length).toBeGreaterThan(0); expect(seen.every((n) => n === before)).toBe(true);
      expect(loop.replica.emergency.incident(inc.id)?.lost).toBe(before + 3);
    } finally { loop.dispose(); }
  });

  it('O8: plain sections update in place, delete stale keys, preserve camera, and cap history/news', () => {
    const loop = empty(), st = loop.primary;
    const budget = loop.state.budget, taxes = budget.taxRates, funding = budget.funding, stats = loop.state.stats;
    const loans = budget.loans, history = loop.state.history, news = loop.state.news;
    const camera = { x: 4 }; loop.state.systemData.camera = camera;
    try {
      for (const k of HISTORY_KEYS) { st.history[k] = new Array(HISTORY_CAP).fill(1); loop.state.history[k] = new Array(HISTORY_CAP).fill(1); }
      budget.lastIncome.removed = 1;
      st.budget.taxRates[0] = 7; st.budget.funding.fire = 80; st.stats.population = 42;
      st.budget.loans.push({ principal: 100, remaining: 100, rate: 0.1, monthlyPayment: 2, monthsLeft: 50 });
      st.systemData.regionJobs = 10;
      for (let month = 1; month <= 2; month++) {
        st.day = month * 30;
        for (const key of HISTORY_KEYS) { st.history[key].push(month); st.history[key].shift(); }
        loop.core.sim.events.emit('month', month);
      }
      for (let i = 0; i < 205; i++) loop.core.sim.notify(`News ${i}`);
      loop.flush(true);
      expect(loop.state.budget).toBe(budget); expect(budget.taxRates).toBe(taxes); expect(budget.funding).toBe(funding);
      expect(budget.loans).toBe(loans); expect(loop.state.stats).toBe(stats); expect(loop.state.history).toBe(history); expect(loop.state.news).toBe(news);
      expect(budget.lastIncome).not.toHaveProperty('removed'); expect(loop.state.systemData.camera).toBe(camera);
      expect(loop.state.news).toHaveLength(200); expect(loop.replica.newsSeq).toBe(205);
      checkReplica(st, loop.replica);
      st.systemData.regionJobs = undefined; loop.flush(true); expect(loop.state.systemData).not.toHaveProperty('regionJobs');
    } finally { loop.dispose(); }
  });

  it('R1/F7 hooks reapply after every write and deliver watch/replies after end records', () => {
    const st = newState(16), b = place(st, 't_r1', 2, 2), calls: unknown[] = [], tag = {}, viewErrors: unknown[] = [];
    const loop = new LoopbackCore(st, { modules: {}, replica: {
      report: (_key, e) => viewErrors.push(e),
      plain: (state, cmd) => { state.budget.taxRates[0] = 4; calls.push(['plain', cmd]); },
      policy: (policy, cmd) => { policy.alerts.length = 0; calls.push(['policy', cmd]); },
      building: (b, cmd) => { b.flags |= BF.Historic; calls.push(['building', cmd]); },
      ack: (seq) => calls.push(['ack', seq]), tag: () => tag,
      watch: () => calls.push(['watch', loop.state.buildings.get(b.id)?.jobs]),
      reply: () => calls.push(['reply', loop.state.buildings.get(b.id)?.jobs]),
      assertPending: () => calls.push(['assert']),
    } });
    try {
      loop.setView({ overlay: Overlay.None, variant: 0, panels: [], focus: [b.id] });
      st.budget.taxRates[0] = 8;
      loop.recorder.cause = 1; b.jobs = 2; loop.core.sim.events.emit('buildingChanged', b); loop.recorder.cause = undefined;
      b.jobs = 3;
      const p = loop.recorder.flush({ force: true, cmd: 1 })!;
      p.policy = { alerts: [{ id: 1, wasPossible: true }], live: false };
      p.log.push([EntryType.Ack, st.day, 0, 1]); p.acks = [{ ok: true }];
      p.watch = [{ id: 1, cmd: 0, key: 'b:1', value: 3 }]; p.replies = [{ t: 'qres', cmd: 0, id: 1, ok: true, value: 3 }];
      loop.replica.events.on('buildingChanged', (rb) => {
        expect(rb.flags & BF.Historic).toBeTruthy(); expect(rb.jobs).toBe(2);
        expect(loop.state.budget.taxRates[0]).toBe(4); expect(loop.replica.policy.alerts).toEqual([]);
        expect(loop.replica.cause).toEqual({ seq: 1, tag });
      });
      expect(loop.replica.apply(structuredClone(p))).toBe(true);
      expect(calls).toEqual([['plain', 1], ['policy', 1], ['building', 0], ['ack', 1], ['building', 1], ['watch', 3], ['reply', 3], ['assert']]);
      expect(loop.replica.applied).toBe(1);
      expect(viewErrors).toEqual([]);
    } finally { loop.dispose(); }
  });

  it('R12: throwing listeners report once and do not interrupt listeners, later entries or the clock', () => {
    const report = vi.fn(), second = vi.fn(), st = newState(16);
    const loop = new LoopbackCore(st, { modules: {}, replica: { report } });
    const fail = () => { throw new Error('view'); };
    loop.replica.events.on('news', fail); loop.replica.events.on('news', second);
    try {
      loop.core.sim.notify('first'); loop.core.sim.notify('second'); loop.runDays(1);
      expect(second).toHaveBeenCalledTimes(2); expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0][0]).toBe('view:news'); expect(loop.replica.diverged).toBe(false); expect(loop.state.day).toBe(1);
      loop.replica.events.off('news', fail); loop.core.sim.notify('third'); loop.flush(true); expect(second).toHaveBeenCalledTimes(3);
    } finally { loop.dispose(); }
  });

  it('R12: gaps, malformed records and digest mismatches fail closed; adopt swaps state and empties per-state caches', () => {
    const st = newState(16), b = place(st, 't_r1', 2, 2), resync = vi.fn();
    const loop = new LoopbackCore(st, { modules: {}, replica: { requestResync: resync } });
    try {
      const old = loop.state, removed = old.buildings.get(b.id)!; buildingList(old);
      old.buildings.delete(b.id); old.buildings.set(999, { ...removed, id: 999 });
      const p = loop.recorder.flush({ force: true })!; p.seq++;
      expect(loop.replica.apply(p)).toBe(false); expect(resync).toHaveBeenCalledTimes(1);
      expect(loop.replica.apply(p)).toBe(false); expect(resync).toHaveBeenCalledTimes(1);
      loop.resync();
      expect(loop.state).not.toBe(old); expect(loop.replica.state[REPLICA]).toBe(true);
      expect(Object.getOwnPropertyDescriptor(loop.state, REPLICA)?.enumerable).toBe(false);
      expect(buildingList(loop.state).map((b) => b.id)).toEqual([b.id]); expect(buildingList(loop.state)).not.toContain(removed);
      expect(loop.replica.layerReady('respFire')).toBe(false);
      const bad = loop.recorder.flush({ force: true })!; bad.recs = new Float64Array(REC - 1);
      expect(loop.replica.apply(bad)).toBe(false);
      loop.resync(); const digest = loop.recorder.flush({ force: true })!; digest.digest = 1;
      expect(loop.replica.apply(digest)).toBe(false);
      loop.resync(); loop.runDays(1); checkReplica(st, loop.replica);
    } finally { loop.dispose(); }
  });

  it('R9/R15/O9: cell unions precede road decode, subscriptions refresh, and throttled layer events travel with data', () => {
    const loop = empty(), st = loop.primary, sim = loop.core.sim;
    try {
      st.network[1] = Network.Road; st.traffic[1] = 10; st.traffic[3] = 5;
      sim.events.emit('networkChanged', { x0: 1, z0: 0, x1: 2, z1: 1 });
      sim.events.emit('layerUpdated', 'traffic');
      const p = loop.flush(true)!;
      expect(p.layers?.some((p) => 'road' in p && p.off?.idx[0] === 3)).toBe(true);
      checkReplica(st, loop.replica);
      st.traffic[1] = 20; sim.events.emit('layerUpdated', 'traffic');
      expect(loop.flush()).toBeNull(); expect(loop.state.traffic[1]).toBe(10);
      loop.runDays(1); expect(loop.state.traffic[1]).toBe(20);
      st.prestige.fill(0.5); st.stigma.fill(0.25);
      expect(loop.replica.layerReady('prestige')).toBe(false);
      loop.setView({ overlay: Overlay.Nimby, variant: 0, panels: [], focus: [] }); const subscribed = loop.flush(true)!;
      checkValue(subscribed, 'prestige', st.prestige, loop.state.prestige); checkValue(subscribed, 'stigma', st.stigma, loop.state.stigma);
      expect(loop.replica.layerReady('prestige')).toBe(true);
      loop.setView({ overlay: Overlay.None, variant: 0, panels: [], focus: [] }); loop.flush(true);
      st.prestige.fill(1); sim.events.emit('layerUpdated', 'catchments');
      expect(loop.flush(true)?.layers?.some((p) => p.name === 'prestige') ?? false).toBe(false);
      loop.setView({ overlay: Overlay.Demographics, variant: 0, panels: [], focus: [] }); loop.flush(true);
      expect(loop.replica.raster(Overlay.Demographics, 0)?.data.length).toBe(st.cells);
      loop.resync(); expect(loop.replica.raster(Overlay.Demographics, 0)).toBeNull();
    } finally { loop.dispose(); }
  });

  it('NOTE-022: treesDamaged carries the lowered trees in its packet; a silent tree write still fails the gate', () => {
    const st = newState(16); st.trees.fill(4);
    const loop = new LoopbackCore(st, { modules: {}, recorder: { dev: true } }), check = new ReplicaCheck(loop.core.sim, loop.replica);
    try {
      st.trees[st.idx(3, 4)] = 2; st.trees[st.idx(5, 6)] = 0;
      loop.core.sim.events.emit('treesDamaged', { x0: 3, z0: 4, x1: 6, z1: 7 });
      const p = loop.flush(true)!; check.packet(p, loop.elapsedTimeMs);
      expect(p.log.map((e) => e[0])).toEqual([EntryType.TreesDamaged]);
      expect(loop.state.trees[st.idx(3, 4)]).toBe(2); expect(loop.state.trees[st.idx(5, 6)]).toBe(0);
      st.trees[st.idx(8, 8)] = 2; // no event: the replica cannot see it, and trees have no lag exception
      const next = loop.flush(true)!;
      expect(() => check.packet(next, loop.elapsedTimeMs)).toThrow(/packet 2: trees; first differing index=136; primary=2; replica=4; differing cells=1/);
    } finally { check.dispose(); loop.dispose(); }
  });

  it('auditExact detects silent exact-field changes without a daily full building diff', () => {
    const st = newState(16), b = place(st, 't_r1', 2, 2), audit = vi.fn();
    const loop = new LoopbackCore(st, { modules: {}, recorder: { dev: true, onAuditError: audit } });
    try {
      b.capacity++;
      loop.runDays(1);
      expect(audit).toHaveBeenCalledWith(b.id, 'capacity');
    } finally { loop.dispose(); }
  });

  it('focus and stream subscriptions arrive on the next tick while paused; routes own their buffers', () => {
    const st = newState(16), b = place(st, 't_r1', 2, 2, { pop: 10 });
    const storage = new ArrayBuffer(64), cells = new Uint32Array(storage, 4, 3);
    cells.set([1, 2, 3]);
    let trucks: Float32Array | null = new Float32Array(st.cells); trucks[1] = 7;
    const route = { cells, kind: 'service' as const, weight: 2 };
    const traffic = { name: 'traffic', getSampleRoutes: () => [route], truckVolume: () => trucks };
    const loop = new LoopbackCore(st, { cadence: 'live', initialSpeed: 0, modules: { createSystems: () => [traffic] }, recorder: { rollingCount: 0 } });
    try {
      checkValue({ seq: 0, log: [] }, 'route cells', cells, loop.replica.traffic.sampleRoutes(1)[0].cells);
      assertOwnedBuffers(loop.replica.traffic.sampleRoutes(1));
      expect(loop.replica.traffic.sampleRoutes(1)[0].cells.buffer).not.toBe(storage);
      b.pop = 20; b.health = 0.25;
      loop.setView({ overlay: Overlay.None, variant: 0, panels: [], focus: [b.id] });
      loop.frame(0.016);
      expect(loop.state.day).toBe(0); expect(loop.state.buildings.get(b.id)?.pop).toBe(20);
      expect(loop.state.buildings.get(b.id)?.health).toBe(0.25);
      loop.setView({ overlay: Overlay.None, variant: 0, panels: ['roadInspector'], focus: [b.id] });
      loop.frame(0.016); expect(loop.replica.traffic.truckVolume()?.[1]).toBe(7);
      trucks = null;
      loop.core.sim.events.emit('layerUpdated', 'traffic'); loop.frame(0.016);
      expect(loop.replica.traffic.truckVolume()?.[1]).toBe(0);
    } finally { loop.dispose(); }
  });
});
