/**
 * T021 (R1) on the replica's event bus. Under the loopback host (and W1.2's worker host, which shares PacketSimHost and
 * the Replica), WorldView listens to the replica: it applies the recorded layer patches, then re-fires each event with
 * the rect the ChangeRecorder logged. R1 refills only those rects, so they must cover every patched cell.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { RNG } from '../../src/core/rng';
import { Network, Zone } from '../../src/core/types';
import type { CellRect } from '../../src/core/events';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { lPath } from '../../src/sim/actions';
import type { Simulation } from '../../src/sim/Simulation';
import { triggerDisaster } from '../../src/sim/infra/disasters';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { terrainPair } from './terrainRectsHarness';

const cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); });

function city(size: number) {
  const st = new CityState(defaultCityConfig({ size, seed: 21, terrain: 'flat', difficulty: 'sandbox', disasters: false }));
  st.heights.fill(5);
  st.trees.fill(2);
  return st;
}

describe('TerrainRenderer on the replica event bus (loopback host)', () => {
  it('matches a full recompute after every replicated tool action, randomized batches and a meteor', { timeout: 120000 }, async () => {
    const host = new LoopbackSimHost(city(96), { initialSpeed: 0, loopback: { cadence: 'design' } });
    await host.start();
    cleanup.push(() => host.dispose());
    // the replica is what WorldView reads: host.state and host.events
    const pair = terrainPair(host as unknown as Simulation);
    cleanup.push(() => pair.dispose());
    const primary = host.harness.primary;
    let frames = 0;
    const step = async (name: string, post: () => void) => {
      post();
      await host.drain();
      pair.check(name);
      frames++;
    };
    for (let zone = Zone.ResLow; zone <= Zone.Landfill; zone++) {
      const x = zone * 5;
      await step(`zone ${zone}`, () => host.post('zone', [{ x0: x, z0: 5, x1: x + 3, z1: 8 }, zone]));
    }
    for (let net = Network.Street; net <= Network.Rail; net++) {
      const z = 15 + net * 4;
      await step(`network ${net}`, () => host.post('buildNetwork', [lPath({ x: 0, z }, { x: 12, z }), net]));
    }
    const trees: CellRect = { x0: 60, z0: 60, x1: 65, z1: 65 };
    await step('trees', () => host.post('plantTrees', [trees]));
    await step('power lines', () => host.post('buildPowerLine', [lPath({ x: 0, z: 50 }, { x: 12, z: 50 })]));
    await step('subway', () => host.post('buildSubway', [lPath({ x: 0, z: 54 }, { x: 12, z: 54 })]));
    await step('plop', () => host.post('plop', ['civ_fire_station', 70, 70, 0]));
    expect(host.state.buildings.size, 'the plop reached the replica').toBe(1);
    await step('bulldoze part of a building', () => host.post('bulldoze', [{ x0: 70, z0: 70, x1: 71, z1: 71 }]));
    await step('bulldoze trees', () => host.post('bulldoze', [trees]));
    await step('dezone', () => host.post('dezone', [{ x0: 5, z0: 5, x1: 8, z1: 8 }]));
    await step('water', () => host.post('terraform', ['lower', 80, 10, 5, 40]));
    expect(host.state.water.some((v) => v === 1), 'the lowered basin filled on the replica').toBe(true);
    await step('raise', () => host.post('terraform', ['raise', 80, 10, 5, 45]));
    await step('level', () => host.post('terraform', ['level', 80, 10, 5, 1]));
    await step('smooth', () => host.post('terraform', ['smooth', 80, 10, 5, 1]));
    await step('edge terrain', () => host.post('terraform', ['lower', 95, 95, 3, 20]));
    await step('edge road', () => host.post('buildNetwork', [lPath({ x: 0, z: 40 }, { x: 10, z: 40 }), Network.Road]));

    const built = host.state.network.filter((v) => v !== 0).length;
    expect(built, 'every network kind reached the replica').toBeGreaterThan(6 * 12);
    const rng = new RNG(0x7021);
    const roads = [Network.Street, Network.Road, Network.Avenue, Network.OneWay, Network.Highway, Network.Rail];
    for (let frame = 0; frame < 80; frame++) {
      await step(`random frame ${frame}`, () => {
        for (let k = 0, n = rng.int(1, 4); k < n; k++) {
          const x = rng.int(0, 88), z = rng.int(0, 88);
          const r = { x0: x, z0: z, x1: x + rng.int(1, 7), z1: z + rng.int(1, 7) };
          const path = lPath({ x, z }, { x: r.x1 - 1, z: r.z1 - 1 }, rng.chance(0.5));
          const ops = [
            () => host.post('zone', [r, rng.int(Zone.ResLow, Zone.Landfill)]), () => host.post('dezone', [r]),
            ...roads.map((net) => () => host.post('buildNetwork', [path, net])),
            () => host.post('buildPowerLine', [path]), () => host.post('buildSubway', [path]),
            () => host.post('plantTrees', [r]), () => host.post('bulldoze', [r]),
            () => host.post('plop', ['civ_fire_station', x, z, rng.int(0, 3) as 0 | 1 | 2 | 3]),
            ...(['raise', 'lower', 'level', 'smooth'] as const).map((kind) => () => host.post('terraform', [kind, x, z, rng.int(2, 5), 12])),
          ];
          ops[rng.int(0, ops.length - 1)]();
        }
      });
    }

    // a meteor in the primary sim: its crater edits terrain, water, network, lines and trees, and removes buildings
    const sim = host.harness.core.sim;
    let craters = 0;
    const off = host.events.on('terrainChanged', () => craters++);
    cleanup.push(off);
    expect(triggerDisaster(sim, 'meteor', 40, 40)).toBe(true);
    for (let d = 0; d < 6; d++) {
      host.harness.runDays(1);
      await host.drain();
      pair.check(`meteor day ${d}`);
      frames++;
    }
    expect(craters, 'the crater reached the replica').toBeGreaterThan(0);
    expect(frames).toBe(Zone.Landfill - Zone.ResLow + 1 + Network.Rail - Network.Street + 1 + 13 + 80 + 6);
    // the replica holds what the primary holds, so the checks above compared the city the player sees
    for (const layer of ['zone', 'building', 'network', 'netFlags', 'trees', 'water', 'powerLines'] as const)
      expect(Array.from(host.state[layer]), layer).toEqual(Array.from(primary[layer]));
  });
});
