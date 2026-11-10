/**
 * T096: the city's firsts on the packet hosts (src/sim/economy/firsts.ts). The record reaches the page as one of the
 * replica's system keys (SYSTEM_KEYS), the announcement as the news entry of the recorder's log, whose ref travels with
 * the item:
 *   - the loopback host gives the page what the local host gives it: the same news with ref.first, once each, and the
 *     same record, already there when the news arrives; nothing is on the wire for a city that keeps no record;
 *   - a resync adopts the record and replays no news; what the city had is not announced again;
 *   - a recovery journal's replay fills the record before the Ready: the page gets the items in the news log, no event;
 *   - the real Worker (node worker_threads, the production loop, every system) against the local host, and its save
 *     loaded by another worker.
 * The simulation side (the kinds, saves, old saves) is tests/sim/firsts.test.ts.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { clearRecoveryBase, getCityRecord } from '../../src/save/cities';
import { MemoryKV, setKV } from '../../src/save/db';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { CityActions, lPath } from '../../src/sim/actions';
import { BF, type Building, type CityState, type NewsItem } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { firstsOf, firstsSystem, type FirstsData } from '../../src/sim/economy/firsts';
import type { SimSystem, Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems';
import { LoopbackCore } from '../../src/worker/loopbackCore';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { EntryType, SYSTEM_KEYS, type Journal, type Packet } from '../../src/worker/protocol';
import { exactDigest } from '../../src/worker/queries';
import { Replica } from '../../src/worker/replica';
import { LocalSimHost, type Command, type SimHost } from '../../src/worker/SimHost';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { newState, place } from '../infra/cityGen';
import { bootNode, send } from './workerHarness';

afterEach(() => { clearRecoveryBase(); setKV(new MemoryKV()); });

const OPENS = "Mayor's House opens in Queensbury!";
const CONNECTED = 'New neighbor connection! Trade with the region boosts demand.';
const TOWER = "Queensbury's first stage 6 building is complete: Residential Tower.";

const firsts = (st: CityState) => st.systemData.firsts as FirstsData | undefined;
/** a flat 32 x 32 sandbox city (every building may be placed) */
function city(): CityState {
  const st = newState(32);
  st.config.name = 'Queensbury';
  st.config.sandbox = true;
  return st;
}
/** the growth's part, by day: a stage 6 tower starts on day 1 and is complete on day 3, a second one on days 5 and 6 */
function towers(): SimSystem {
  const start = (sim: Simulation, x: number, z: number): void => {
    const st = sim.state, def = getDef('res_tower.r2.6')!;
    const b: Building = {
      id: st.nextBuildingId++, def: def.id, x, z, w: 2, d: 2, rot: 0, variant: 0, pop: 0, jobs: 0, capacity: def.capacity ?? 0, wealth: 2,
      built: 0, age: 0, flags: BF.Constructing, baseY: 5, health: 0.6, unhappy: 0,
    };
    placeBuilding(sim, b);
  };
  const finish = (sim: Simulation, x: number, z: number): void => {
    const b = sim.state.buildingAt(x, z)!;
    b.built = 1;
    b.flags &= ~BF.Constructing;
    sim.events.emit('buildingChanged', b);
  };
  return { name: 'test.towers', daily(sim) {
    const day = sim.state.day;
    if (day === 1) start(sim, 4, 4);
    else if (day === 3) finish(sim, 4, 4);
    else if (day === 5) start(sim, 8, 4);
    else if (day === 6) finish(sim, 8, 4);
  } };
}
const modules = () => ({ createSystems: () => [firstsSystem(), towers()], CityActions });
const WEST = lPath({ x: 0, z: 12 }, { x: 10, z: 12 }), NORTH = lPath({ x: 20, z: 0 }, { x: 20, z: 10 });

/** what the page sees of a news item that announces a first, and the record it finds at that moment */
interface Seen { first: string; day: number; x?: number; z?: number; text: string; record: unknown }
function watch(host: Pick<SimHost, 'events' | 'state'>): { all: NewsItem[]; seen: Seen[] } {
  const all: NewsItem[] = [], seen: Seen[] = [];
  host.events.on('news', (n) => {
    all.push(n);
    const first = n.ref?.first;
    if (first !== undefined) seen.push({ first, day: n.day, x: n.x, z: n.z, text: n.text, record: structuredClone(firsts(host.state)?.[first]) });
  });
  return { all, seen };
}
/** the firsts of one small game, on any host: day 0 the player's (a landmark, a road to the map edge), days 1-3 a tower */
const EXPECTED: Seen[] = [
  { first: 'unique:civ_mayor_house', day: 0, x: 21, z: 21, text: OPENS, record: { day: 0, x: 21, z: 21, id: 1 } },
  { first: 'neighbor', day: 0, x: 0, z: 12, text: CONNECTED, record: { day: 0, x: 0, z: 12 } },
  { first: 'stage:6', day: 3, x: 5, z: 5, text: TOWER, record: { day: 3, x: 5, z: 5, id: 2 } },
];
const RECORD = Object.fromEntries(EXPECTED.map((s) => [s.first, s.record]));

describe('T096: the firsts on the packet hosts', () => {
  it('SYSTEM_KEYS mirrors the record', () => {
    expect(SYSTEM_KEYS).toContain('firsts');
  });

  it('the local host: each first once, with its record', async () => {
    const host = new LocalSimHost(city(), { initialSpeed: 0 });
    await host.start(modules());
    try {
      const page = watch(host);
      expect(host.actions.plop('civ_mayor_house', 20, 20, 0).ok).toBe(true);
      expect(host.actions.buildNetwork(WEST, Network.Road).ok).toBe(true);
      host.sim.runDays(4);
      expect(page.seen).toStrictEqual(EXPECTED);
      // the same things again: no first
      expect(host.actions.bulldoze({ x0: 20, z0: 20, x1: 22, z1: 22 }).ok).toBe(true);
      expect(host.actions.plop('civ_mayor_house', 24, 20, 0).ok).toBe(true);
      expect(host.actions.buildNetwork(NORTH, Network.Road).ok).toBe(true);
      host.sim.runDays(3);
      expect(page.seen).toHaveLength(3);
      expect(page.all.map((n) => n.text)).toEqual([OPENS, CONNECTED, TOWER, OPENS, CONNECTED]);
      expect(firsts(host.state)).toStrictEqual(RECORD);
    } finally { await host.dispose(); }
  });

  it('the loopback host gives the page the same news and the same record as the local host, and a resync replays none', async () => {
    const packets: Packet[] = [];
    const host = new LoopbackSimHost(city(), { initialSpeed: 0, loopback: { cadence: 'design', modules: modules() }, onPacket: (p) => packets.push(p) });
    await host.start();
    try {
      await host.drain();
      // the record a new city starts is in the Ready's snapshot
      expect(firsts(host.state)).toStrictEqual({});
      const page = watch(host), primary = host.harness.primary;
      expect(host.state).not.toBe(primary);
      expect(host.actions.plop('civ_mayor_house', 20, 20, 0).ok).toBe(true);
      await host.drain();
      expect(host.actions.buildNetwork(WEST, Network.Road).ok).toBe(true);
      await host.drain();
      host.harness.runDays(4);
      await host.drain();
      // as the local host: each first once, at its place, and the record was on the replica when its news arrived
      expect(page.seen).toStrictEqual(EXPECTED);
      expect(firsts(primary)).toStrictEqual(RECORD);
      expect(firsts(host.state)).toStrictEqual(RECORD);
      expect(firsts(host.state)).not.toBe(firsts(primary));
      expect(firstsOf(host.state)).toBe(host.state.systemData.firsts); // (the reader works on the replica's state)
      expect(host.state.news).toStrictEqual(primary.news);
      expect(exactDigest(host.state)).toBe(exactDigest(host.harness.delivered));
      // on the wire: a packet whose log announces a first carries the record's patch too, and no other packet does
      const announcing = packets.filter((p) => p.log.some((e) => e[0] === EntryType.News && (e[2] as NewsItem).ref?.first !== undefined));
      const patching = packets.filter((p) => p.plain?.sys && Object.hasOwn(p.plain.sys, 'firsts'));
      expect(announcing).toHaveLength(3);
      expect(patching).toEqual(announcing);

      // a resync: the fresh replica has the record, and no news is replayed to the page
      const before = host.state;
      host.harness.resync();
      await host.drain();
      expect(host.state).not.toBe(before);
      expect(page.all).toHaveLength(3);
      expect(firsts(host.state)).toStrictEqual(RECORD);
      expect(host.state.news).toStrictEqual(primary.news);

      // the same things again, after the resync: the plain news, no first, the record as it was
      expect(host.actions.bulldoze({ x0: 20, z0: 20, x1: 22, z1: 22 }).ok).toBe(true);
      await host.drain();
      expect(host.actions.plop('civ_mayor_house', 24, 20, 0).ok).toBe(true);
      await host.drain();
      expect(host.actions.buildNetwork(NORTH, Network.Road).ok).toBe(true);
      await host.drain();
      host.harness.runDays(3);
      await host.drain();
      expect(primary.day).toBe(7);
      expect(page.seen).toHaveLength(3);
      expect(page.all.map((n) => n.text)).toEqual([OPENS, CONNECTED, TOWER, OPENS, CONNECTED]);
      for (const n of page.all.slice(3)) expect(Object.hasOwn(n, 'ref')).toBe(false);
      expect(firsts(primary)).toStrictEqual(RECORD);
      expect(firsts(host.state)).toStrictEqual(RECORD);
      expect(exactDigest(host.state)).toBe(exactDigest(host.harness.delivered));
    } finally { await host.dispose(); }
  });

  it('nothing is on the wire for a city that keeps no record', async () => {
    const packets: Packet[] = [];
    const host = new LoopbackSimHost(city(), { initialSpeed: 0, loopback: { cadence: 'design', modules: { createSystems: () => [towers()], CityActions } }, onPacket: (p) => packets.push(p) });
    await host.start();
    try {
      const page = watch(host);
      expect(host.actions.plop('civ_mayor_house', 20, 20, 0).ok).toBe(true);
      await host.drain();
      expect(host.actions.buildNetwork(WEST, Network.Road).ok).toBe(true);
      await host.drain();
      host.harness.runDays(4);
      await host.drain();
      expect(page.all.map((n) => n.text)).toEqual([OPENS, CONNECTED]);
      for (const n of page.all) expect(Object.hasOwn(n, 'ref')).toBe(false);
      expect(Object.hasOwn(host.harness.primary.systemData, 'firsts')).toBe(false);
      expect(Object.hasOwn(host.state.systemData, 'firsts')).toBe(false);
      expect(packets.length).toBeGreaterThan(0);
      expect(packets.filter((p) => p.plain?.sys && Object.hasOwn(p.plain.sys, 'firsts'))).toEqual([]);
      expect(exactDigest(host.state)).toBe(exactDigest(host.harness.delivered));
    } finally { await host.dispose(); }
  });

  it('a recovery journal replayed at boot fills the record before the Ready: the items are in the news log, and the page gets no event', () => {
    // the session that was saved: its first connection
    const earlier = new LoopbackCore(city(), { modules: modules() });
    let saved;
    try {
      expect(earlier.core.applyCommand({ op: 'buildNetwork', args: [WEST, Network.Road] } as Command, earlier.core.actions!)).toMatchObject({ ok: true });
      saved = serializeCity(earlier.primary, { copy: true });
    } finally { earlier.dispose(); }
    expect((saved.data.systemData as Record<string, unknown>).firsts).toStrictEqual({ neighbor: { day: 0, x: 0, z: 12 } });
    // after that save the player opened the Mayor's House (a first) and built a second connection (none): the journal
    const base = { regionId: 'r', tileKey: '0_0', savedAt: 10 };
    const journal: Journal = { v: 1, ...base, at: 20, base: { kind: 'save', savedAt: 10 }, fromCmd: 0, ops: [
      { seq: 1, op: 'plop', args: ['civ_mayor_house', 20, 20, 0] },
      { seq: 2, op: 'buildNetwork', args: [NORTH, Network.Road] },
    ] };
    const replica = new Replica(), events: NewsItem[] = [];
    replica.events.on('news', (n) => events.push(n));
    const core = new LoopbackCore(deserializeCity(saved), { modules: modules(), replicaInstance: replica, journal: { journal, base: { ...base } } });
    try {
      const record = { neighbor: { day: 0, x: 0, z: 12 }, 'unique:civ_mayor_house': { day: 0, x: 21, z: 21, id: 1 } };
      expect(firsts(core.primary)).toStrictEqual(record);
      expect(firsts(core.state)).toStrictEqual(record);
      expect(core.state.news.map((n) => [n.text, n.ref])).toEqual([
        [CONNECTED, { first: 'neighbor' }], [OPENS, { first: 'unique:civ_mayor_house' }], [CONNECTED, undefined],
      ]);
      expect(events).toEqual([]);
      // the recovered session: the house rebuilt and a third connection are no firsts
      const act = (c: Command) => core.core.applyCommand(c, core.core.actions!);
      expect(act({ op: 'bulldoze', args: [{ x0: 20, z0: 20, x1: 22, z1: 22 }] })).toMatchObject({ ok: true });
      expect(act({ op: 'plop', args: ['civ_mayor_house', 24, 20, 0] })).toMatchObject({ ok: true });
      expect(act({ op: 'buildNetwork', args: [lPath({ x: 31, z: 24 }, { x: 22, z: 24 }), Network.Road] })).toMatchObject({ ok: true });
      core.flush(true);
      expect(events.map((n) => n.text)).toEqual([OPENS, CONNECTED]);
      for (const n of events) expect(Object.hasOwn(n, 'ref')).toBe(false);
      expect(firsts(core.state)).toStrictEqual(record);
    } finally { core.dispose(); }
  });
});

describe('T096: the real Worker', () => {
  beforeAll(async () => { await buildWorkerTest(); }, 60000);

  it('announces and mirrors the firsts like the local host, and a save loaded by another worker repeats none', { timeout: 120000 }, async () => {
    // every system, on a 32 x 32 city with a stage 6 tower the population system completes within days
    const st = newState(32);
    st.config.seed = 7;
    st.config.name = 'Queensbury';
    st.funds = 1e6;
    st.unlocked.add('mayor_house');
    const tower = place(st, 'res_tower.r2.6', 10, 14, { built: 0.9, flags: BF.Constructing, age: 30, wealth: 2, capacity: 1100 });
    const start = serializeCity(st, { copy: true });
    start.savedAt = 1;
    const script: Command[] = [
      { op: 'plop', args: ['civ_mayor_house', 20, 20, 0] },
      { op: 'buildNetwork', args: [Array.from({ length: 29 }, (_, x) => ({ x, z: 16 })), Network.Road] },
    ];
    const again: Command[] = [
      { op: 'bulldoze', args: [{ x0: 20, z0: 20, x1: 22, z1: 22 }] },
      { op: 'plop', args: ['civ_mayor_house', 24, 20, 0] },
      { op: 'buildNetwork', args: [Array.from({ length: 16 }, (_, z) => ({ x: 26, z })), Network.Road] },
    ];
    const kv = new MemoryKV();
    const local = new LocalSimHost(deserializeCity(start));
    await local.start({ createSystems, CityActions });
    const host = await bootNode(start, { kv, deterministic: true });
    let other: Awaited<ReturnType<typeof bootNode>> | undefined;
    try {
      // the record of a city saved before T096 is seeded at boot, in the worker as in the local host: nothing to mark here
      expect(firsts(local.state)).toStrictEqual({});
      expect(firsts(host.state)).toStrictEqual({});
      const onLocal = watch(local), onWorker = watch(host);
      for (const c of script) {
        const expected = await local.act(c.op, c.args).done;
        expect(await send(host, c.op, c.args), c.op).toMatchObject({ ok: (expected as { ok: boolean }).ok });
        expect((expected as { ok: boolean }).ok, c.op).toBe(true);
      }
      for (let day = 1; day <= 8; day++) { local.sim.runDays(1); expect(await host.runDays(1)).toBe(day); }
      // the three firsts, on the same days and places on both hosts, each with its record on the page at that moment
      expect(onLocal.seen.map((s) => s.first)).toEqual(['unique:civ_mayor_house', 'neighbor', 'stage:6']);
      expect(onLocal.seen[2]).toMatchObject({ x: 11, z: 15, text: TOWER, record: { x: 11, z: 15, id: tower.id } });
      expect(onLocal.seen[2].day).toBeGreaterThanOrEqual(1);
      expect(onWorker.seen).toStrictEqual(onLocal.seen);
      for (const s of onWorker.seen) expect(s.record, s.first).toStrictEqual(firsts(local.state)![s.first]);
      expect(firsts(host.state)).toStrictEqual(firsts(local.state));
      expect(host.state.news).toStrictEqual(local.state.news);
      expect(exactDigest(host.state)).toBe(await host.query('verify', {}));

      // the worker's save holds the record; another worker loads it and the same things are no firsts there
      await host.save('manual');
      const record = await getCityRecord(kv, 'hosts', '0');
      if (!record) throw new Error('no stored record');
      expect((record.city.data.systemData as Record<string, unknown>).firsts).toStrictEqual(firsts(local.state));
      other = await bootNode(record.city, { kv: new MemoryKV(), deterministic: true });
      expect(firsts(other.state)).toStrictEqual(firsts(local.state));
      const reloaded = watch(other);
      for (const c of again) expect(await send(other, c.op, c.args), c.op).toMatchObject({ ok: true });
      expect(await other.runDays(3)).toBe(11);
      expect(reloaded.all.map((n) => n.text).filter((t) => t === OPENS || t === CONNECTED)).toEqual([OPENS, CONNECTED]);
      expect(reloaded.seen).toEqual([]);
      expect(firsts(other.state)).toStrictEqual(firsts(local.state));
      expect(exactDigest(other.state)).toBe(await other.query('verify', {}));
    } finally { await host.dispose(); await other?.dispose(); await local.dispose(); }
  });
});
