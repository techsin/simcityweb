/** LG-08: the inspector explains the host's tower-site cap and stops advising transit once a station allows towers. */
import { describe, expect, it } from 'vitest';
import { DevType, Zone } from '../../src/core/types';
import { CityActions, lPath } from '../../src/sim/actions';
import { growthData, growthSystem, towerLot } from '../../src/sim/economy/growth';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { TrafficSystem } from '../../src/sim/infra/traffic';
import { growthRows } from '../../src/ui/inspectorModel';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { newState, roadLine } from '../infra/cityGen';

const STATION_NOTE = 'Stage 5 max: not a tower site — a subway or train station within 6 tiles allows towers here';

describe('transit development: inspector growth note', () => {
  it('keeps the full station hint while preserving the other growth rows', () => {
    const limits = {
      desStage: 8, popStage: 8, zoneStage: 8, rejected: false, downtownStage: 5, stationTower: false,
      downtown: 'stage 5 max: not a tower site (12% of lots this far are); core 50 tiles SE',
    };
    const rows = growthRows(structuredClone(limits), 5);
    expect(STATION_NOTE.length).toBeGreaterThan(80);
    expect(rows.filter((r) => r.label === 'Downtown')).toEqual([{ label: 'Downtown', value: STATION_NOTE }]);
    expect(rows[0]).toMatchObject({ value: 'stage 5 · limited by distance to downtown', tone: 'warn' });
    expect(rows[1].value).toBe('desirability 8 · population 8 · zone 8');
    const eligible = growthRows({ ...limits, downtownStage: undefined, stationTower: true, downtown: 'a tower site: downtown is 50 tiles SE' });
    expect(eligible.find((r) => r.label === 'Downtown')?.value).toBe('a tower site: downtown is 50 tiles SE');
    const low = growthRows({ ...limits, popStage: 3, downtownStage: undefined, downtown: undefined });
    expect(low[0].value).toBe('stage 3 · limited by city population');
    expect(low.some((r) => r.value === STATION_NOTE)).toBe(false);
  });

  it('uses packet inspector eligibility to remove the hint after connecting subway stations', async () => {
    const st = newState(64);
    st.funds = 1e7;
    st.day = 1;
    st.stats.population = 5e6;
    growthData(st).core = { x: 60.5, z: 60.5, jobs: 50000 };
    roadLine(st, 2, 10, 60, 10);
    roadLine(st, 2, 13, 60, 13);
    for (let x = 2; x <= 60; x++) {
      st.zone[st.idx(x, 11)] = Zone.ResHigh;
      st.desirability[DevType.R2][st.idx(x, 11)] = 1;
    }
    const host = new LoopbackSimHost(st, {
      initialSpeed: 0,
      loopback: { modules: { CityActions, createSystems: () => [new TrafficSystem(), growthSystem(new EconRuntime())] } },
    });
    await host.start();
    try {
      const primary = host.harness.primary;
      const x = [8, 9, 10, 11, 12, 13, 14, 15].find((xx) => !towerLot(primary, xx, 11))!;
      expect(x).toBeDefined();
      const args = { x, z: 11, sections: ['why'] as const };
      const beforeRead = host.query('inspectCell', args);
      await host.drain();
      const before = (await beforeRead)!.growth!;
      expect(before.stationTower).toBe(false);
      expect(before.downtownStage).toBe(5);
      expect(growthRows(before).find((r) => r.label === 'Downtown')?.value).toBe(STATION_NOTE);

      const tag = {}, gesture = host.beginGesture(tag), opts = { tag, gesture };
      const tunnel = host.act('buildSubway', [lPath({ x: 10, z: 14 }, { x: 40, z: 14 })], opts);
      const a = host.act('plop', ['tr_subway_station', 10, 14, 2], opts);
      const b = host.act('plop', ['tr_subway_station', 40, 14, 2], opts);
      gesture.end();
      await host.drain();
      for (const ticket of [tunnel, a, b]) expect((await ticket.done).ok).toBe(true);
      await gesture.settled;
      const afterRead = host.query('inspectCell', args);
      await host.drain();
      const after = (await afterRead)!.growth!;
      expect(after.stationTower).toBe(true);
      expect(after.downtownStage).toBeUndefined();
      expect(growthRows(after).some((r) => r.value === STATION_NOTE)).toBe(false);
      expect(growthRows(after)[0].value).toBe('stage 8 · limited by zone density');
      expect(primary.day).toBe(1);
    } finally { await host.dispose(); }
  });
});
