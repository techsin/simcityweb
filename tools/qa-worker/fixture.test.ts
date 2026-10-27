/** Check the browser fixture's growth and manual-dispatch assumptions with the real LocalSimHost. */
import { expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF, CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import type { EmergencySystem } from '../../src/sim/infra/emergency';
import { LocalSimHost } from '../../src/worker/SimHost';

it('QA fixture grows an inspectable building and supports both manual dispatch commands', async () => {
  const state = new CityState(defaultCityConfig({ size: 256, seed: 7, terrain: 'flat', difficulty: 'sandbox', disasters: false }));
  state.heights.fill(5);
  const host = new LocalSimHost(state, { initialSpeed: 0 });
  try {
    await host.start();
    expect((await host.act('buildNetwork', [Array.from({ length: 139 }, (_, x) => ({ x, z: 128 })), Network.Road]).done).ok).toBe(true);
    for (const [def, x, z] of [
      ['util_wind_turbine', 50, 127], ['util_wind_turbine', 55, 127], ['util_water_tower', 60, 127],
      ['civ_fire_station', 70, 126], ['civ_fire_station', 76, 126], ['park_small', 122, 127], ['park_small', 130, 127],
    ] as const) expect((await host.act('plop', [def, x, z, 0]).done).ok, def).toBe(true);
    for (const [rect, zone] of [
      [{ x0: 84, z0: 123, x1: 104, z1: 128 }, Zone.ResLow],
      [{ x0: 84, z0: 129, x1: 94, z1: 133 }, Zone.ComLow],
      [{ x0: 106, z0: 129, x1: 116, z1: 133 }, Zone.IndMed],
    ] as const) expect((await host.act('zone', [rect, zone]).done).ok).toBe(true);
    let grown = false;
    for (let day = 0; day < 120 && !grown; day++) {
      host.sim.runDays(1);
      grown = [...state.buildings.values()].some((b) => !(b.flags & (BF.Plopped | BF.Burnt)) && b.built >= 1);
    }
    expect(grown, 'the UI-built neighbourhood must produce a completed growable').toBe(true);
    const emergency = host.sim.getSystem<EmergencySystem>('emergency')!;
    expect(await host.act('triggerDisaster', ['fire', 122, 127]).done).toBe(true);
    const first = emergency.incidents().find((i) => i.buildingId === state.buildingAt(122, 127)!.id)!;
    expect(first.state).toBe('uncovered');
    expect(first.manualPossible).toBe(true);
    const sent = await host.act('dispatch', [first.id, state.buildingAt(70, 126)!.id, 1]).done;
    expect(sent.ok).toBe(true); expect(sent.sent).toBe(1);
    expect(await host.act('triggerDisaster', ['fire', 130, 127]).done).toBe(true);
    const second = emergency.incidents().find((i) => i.buildingId === state.buildingAt(130, 127)!.id)!;
    expect(second.id).not.toBe(first.id);
    expect(second.manualPossible).toBe(true);
    expect((await host.act('dispatchBest', [second.id]).done).ok).toBe(true);
  } finally { await host.dispose(); }
}, 30000);
