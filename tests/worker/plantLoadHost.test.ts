/**
 * T087 item 1 (T061 item 5, NOTE-054): the packet hosts forward `utilities.plantLoad(id)` to the replica's id→load map,
 * so T051's plant plumes (FEEL-15) read a load on `?simworker=loopback` and `?simworker=1` as on the local host. The
 * reader keeps nothing of its own: it shows what the last adopted Ready or published stream holds.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { clearRecoveryBase } from '../../src/save/cities';
import { MemoryKV, setKV } from '../../src/save/db';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { CityActions } from '../../src/sim/actions';
import { BF, CityState, type Building } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { defaultCityConfig } from '../../src/sim/config';
import { removeBuilding } from '../../src/sim/economy/buildings';
import { createSystems } from '../../src/sim/systems';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { LocalSimHost, type SimHost } from '../../src/worker/SimHost';
import type { W2M } from '../../src/worker/protocol';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { newState, place } from '../infra/cityGen';
import { bootNode } from './workerHarness';

const hosts: SimHost[] = [];

beforeAll(async () => { await buildWorkerTest(); }, 60000);
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.dispose();
  vi.restoreAllMocks(); clearRecoveryBase(); setKV(new MemoryKV());
});

function building(state: CityState, defId: string, x: number): Building {
  const def = getDef(defId)!, [w, d] = def.footprint, capacity = def.capacity ?? def.jobs ?? 0;
  const b: Building = {
    id: state.nextBuildingId++, def: defId, x, z: 1, w, d, rot: 0, variant: 0, pop: 0, jobs: capacity, capacity,
    wealth: 1, built: 1, age: 100, flags: BF.Powered | BF.Watered, baseY: 5, health: 1, unhappy: 0,
  };
  state.buildings.set(b.id, b);
  for (let z = b.z; z < b.z + b.d; z++) for (let xx = b.x; xx < b.x + b.w; xx++) state.building[state.idx(xx, z)] = b.id;
  return b;
}

/** A loopback host over a coal plant and an incinerator whose loads the test sets, as plantLoadStream.test.ts does for
 *  the recorder: the page side here is the real PacketSimHost, the transport the clone-only packet path. */
function loopback() {
  const state = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', disasters: false, treeDensity: 0, waterAmount: 0 }));
  state.heights.fill(5);
  const coal = building(state, 'util_coal_plant', 1), incinerator = building(state, 'util_incinerator', 8);
  const loads = new Map<number, number>([[coal.id, 0.2], [incinerator.id, 1]]);
  const utilities = { name: 'utilities', plantLoad: (id: number) => loads.get(id) ?? -1 };
  const host = new LoopbackSimHost(state, { initialSpeed: 0, loopback: { cadence: 'design', modules: { createSystems: () => [utilities] }, recorder: { rollingCount: 0 } } });
  hosts.push(host);
  /** a completed utilities pass, then the day's packet */
  const pass = () => { host.harness.core.sim.events.emit('layerUpdated', 'utilities'); host.harness.runDays(1); };
  return { host, coal, incinerator, loads, pass };
}

describe('LoopbackSimHost plant loads', () => {
  it('reads null until the core\'s Ready, then the loads of each completed utilities pass', async () => {
    const { host, coal, incinerator, loads, pass } = loopback();
    // the constructor adopted a Ready without streams: nothing is known yet
    expect(host.utilities.plantLoad(coal.id)).toBeNull();
    await host.start();
    expect(host.utilities.plantLoad(coal.id)).toBeCloseTo(0.2, 6);
    expect(host.utilities.plantLoad(incinerator.id)).toBe(1);
    expect(host.utilities.plantLoad(999)).toBeNull();
    // the facade's system lookup (overlays.ts reads it) is the same view
    expect(host.sim.getSystem('utilities')).toBe(host.utilities);

    loads.set(coal.id, 0.6);
    // no pass has completed: an ordinary day's packet carries no loads, and the page still shows the last ones
    host.harness.runDays(1);
    expect(host.utilities.plantLoad(coal.id)).toBeCloseTo(0.2, 6);
    pass();
    expect(host.utilities.plantLoad(coal.id)).toBeCloseTo(0.6, 6);
    expect(host.utilities.plantLoad(coal.id)).toBe(host.replica.plantLoad(coal.id));
    // an unknown load (-1 on the wire) reads null again
    loads.delete(incinerator.id);
    pass();
    expect(host.utilities.plantLoad(incinerator.id)).toBeNull();
    expect(host.utilities.plantLoad(coal.id)).toBeCloseTo(0.6, 6);
  });

  it('reads null after an adopt, until the Ready\'s own snapshot or the next stream names the plant', async () => {
    const { host, coal, incinerator, loads, pass } = loopback();
    await host.start();
    // a load that drifted under the stream's threshold, and a plant bulldozed with no pass since: both still as sent
    loads.set(coal.id, 0.203);
    pass();
    removeBuilding(host.harness.core.sim, incinerator);
    host.harness.runDays(1);
    expect(host.state.buildings.has(incinerator.id)).toBe(false);
    expect(host.utilities.plantLoad(coal.id)).toBeCloseTo(0.2, 6);
    expect(host.utilities.plantLoad(incinerator.id)).toBe(1);
    // a resync's adopt drops the map; its Ready carries the full snapshot, which names only the plants that stand
    let resets = 0;
    const off = host.events.on('reset', () => { resets++; });
    host.harness.resync();
    off();
    expect(resets).toBe(1);
    expect(host.utilities.plantLoad(incinerator.id)).toBeNull();
    expect(host.utilities.plantLoad(coal.id)).toBeCloseTo(0.203, 6);

    // a Ready without the stream (a core from before NOTE-054): every load reads null after the adopt ...
    const receive = host.receive.bind(host);
    vi.spyOn(host, 'receive').mockImplementationOnce((message: W2M) => {
      if (message.t === 'ready') delete message.streams.utilities;
      receive(message);
    });
    host.harness.resync();
    expect(host.utilities.plantLoad(coal.id)).toBeNull();
    // ... until the next stream: a pass that changes nothing sends none, a changed load does
    pass();
    expect(host.utilities.plantLoad(coal.id)).toBeNull();
    loads.set(coal.id, 0.4);
    pass();
    expect(host.utilities.plantLoad(coal.id)).toBeCloseTo(0.4, 6);
  });
});

describe('plant loads of the real utilities system on the three hosts', () => {
  /** a coal plant that powers a row of homes, and a second plant that burnt down: on the grid, delivering nothing */
  function city() {
    const st = newState(32); st.config.seed = 7; st.funds = 1e6;
    const coal = place(st, 't_coal', 2, 13, { jobs: 50 });
    for (let x = 4; x < 14; x++) place(st, 't_r2', x, 13, { pop: 60 });
    const burnt = place(st, 't_small_plant', 14, 13, { flags: BF.Burnt });
    const saved = serializeCity(st, { copy: true }); saved.savedAt = 1;
    return { saved, coal: coal.id, burnt: burnt.id };
  }

  it('the loopback and the worker host read the local host\'s loads from their first Ready', { timeout: 30000 }, async () => {
    const { saved, coal, burnt } = city();
    const local = new LocalSimHost(deserializeCity(saved));
    hosts.push(local);
    await local.start({ createSystems, CityActions });
    const expected = local.utilities.plantLoad!(coal);
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(1);
    // T087 item 2: the burnt plant delivers 0 MW, so its load (0 in the sim) is unavailable on every host
    expect(local.utilities.plantLoad!(burnt)).toBeNull();

    const loop = new LoopbackSimHost(deserializeCity(saved), { initialSpeed: 0 });
    hosts.push(loop);
    await loop.start();
    expect(loop.utilities.plantLoad(coal)).toBe(expected);
    expect(loop.utilities.plantLoad(burnt)).toBeNull();

    const worker = await bootNode(saved, { kv: new MemoryKV(), initialSpeed: 0 });
    hosts.push(worker);
    expect(worker.kind).toBe('worker');
    expect(worker.utilities.plantLoad(coal)).toBe(expected);
    expect(worker.utilities.plantLoad(burnt)).toBeNull();
  });
});
