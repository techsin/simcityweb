/**
 * WP7b round 4 (review r3 MF1 + should-fixes): park & ride has no option cap. Riders turned away by every one of their
 * PR_OPTIONS options overflow, at the end of their matching round, to the garage groups that still have room within
 * PR_OPTION_MARGIN of their fastest option (an overflow search seeded only at those groups, pass by pass while a pass
 * fills a group); the mode choice sees the minutes of a commuter's best option, not its rationing price (a price set by
 * commuters elsewhere priced the commuters near a garage with room out of park & ride). The reports name where a full
 * garage's riders park, why a little-used garage is little used, and keep an idle garage's reason through the next
 * update's rebuild. Scripted towns: tests/infra/prTowns.ts.
 */
import { describe, expect, it } from 'vitest';
import { getTraffic, type TrafficSystem } from '../../src/sim/systems/infra';
import type { Simulation } from '../../src/sim/Simulation';
import type { CityState } from '../../src/sim/CityState';
import { CAR_OCCUPANCY, GARAGE_SPACES } from '../../src/sim/infra/params';
import { transportFacilityReport } from '../../src/sim/infra/transportFacilities';
import { serializeCity, deserializeCity, type SerializedCity } from '../../src/save/serialize';
import { Network } from '../../src/core/types';
import { newSim, newState, place, roadLine } from './cityGen';
import { lineTown, prTown } from './prTowns';

const LINE5 = [48, 60, 72, 84, 96];

function cycle(sim: Simulation): TrafficSystem {
  const tr = getTraffic(sim)!;
  tr.invalidate();
  tr.runCycleSync(sim);
  return tr;
}
function line(sim: Simulation, id: number, key: string): { value: string; hint: string } {
  const l = transportFacilityReport(sim, sim.state.buildings.get(id)!)!.lines.find((x) => x.key === key);
  return { value: l?.value ?? '', hint: l?.hint ?? '' };
}
/** cars per garage and city park & ride riders over cycles 10..n (`each`: a check after each of those cycles) */
function run(st: CityState, ids: number[], n = 30, each?: (sim: Simulation, k: number) => void): { sim: Simulation; tr: TrafficSystem; cars: number[][]; city: number[] } {
  const sim = newSim(st);
  const cars: number[][] = ids.map(() => []), city: number[] = [];
  let tr = getTraffic(sim)!;
  for (let k = 0; k < n; k++) {
    tr = cycle(sim);
    if (k < 9) continue;
    ids.forEach((id, q) => cars[q].push(tr.garageInfo(id)!.parkRide));
    city.push(st.stats.transitFleet.parkRide);
    each?.(sim, k + 1);
  }
  return { sim, tr, cars, city };
}
const range = (a: number[]) => `${Math.min(...a).toFixed(0)}-${Math.max(...a).toFixed(0)}`;
/** consecutive cycles whose load moved by more than half the spaces (a garage taking turns with another) */
const swings = (a: number[]) => a.slice(1).filter((v, k) => Math.abs(v - a[k]) > 0.5 * GARAGE_SPACES).length;

describe('WP7b r4 park & ride overflow (no option cap)', () => {
  it('five garages at five stations of one line, 2x and 3x: every one fills, steadily — the fifth takes the overflow (cycles 10-30)', { timeout: 600000 }, () => {
    // (review r3: g0-g3 read "Full — 1,224 cars wanted" while g4, 2.2 min slower, stood empty: the homes weighed their
    // four fastest garages only)
    for (const mul of [2, 3]) {
      const { st, ids } = lineTown(LINE5, mul);
      const { sim, tr, cars, city } = run(st, ids);
      console.log(`five stations ${mul}x (cycles 10-30): cars ${cars.map(range).join(' / ')}, city P&R ${range(city)}`);
      cars.forEach((c, q) => {
        expect(Math.min(...c), `garage ${q} ${mul}x`).toBeGreaterThanOrEqual(0.8 * GARAGE_SPACES);
        expect(swings(c), `garage ${q} ${mul}x swings`).toBe(0);
      });
      expect(Math.min(...city)).toBeGreaterThanOrEqual(0.95 * 5 * GARAGE_SPACES * CAR_OCCUPANCY);
      // the fifth is nobody's option: its riders are the overflow of the four; it says so, never "too far out of their way"
      const g4 = tr.garageInfo(ids[4])!;
      expect(g4.overflowIn!).toBeGreaterThan(0.8 * GARAGE_SPACES * CAR_OCCUPANCY);
      const h4 = line(sim, ids[4], 'parkRide').hint + line(sim, ids[4], 'switched').hint;
      expect(h4).not.toMatch(/too far out of their way/);
      expect(line(sim, ids[4], 'parkRide').hint).toMatch(/^Full — it takes the overflow of the full garages nearby$/);
      // the four are full and commuters are still turned away: another garage helps by a stop near their homes (the
      // suburb north-west of the line)
      for (const id of ids.slice(0, 4)) expect(line(sim, id, 'parkRide').hint).toMatch(/^Full — [\d,]+ cars wanted: build another garage by a stop near their homes \(about \d+ tiles NW\)$/);
    }
  });

  it('six garages at 3x: the overflow passes go on to the next garage with room', { timeout: 600000 }, () => {
    const { st, ids } = lineTown([...LINE5, 108], 3);
    const { cars, city } = run(st, ids, 20);
    console.log(`six stations 3x (cycles 10-20): cars ${cars.map(range).join(' / ')}, city P&R ${range(city)}`);
    for (const c of cars) expect(Math.min(...c)).toBeGreaterThanOrEqual(0.8 * GARAGE_SPACES);
    expect(Math.min(...city)).toBeGreaterThanOrEqual(0.95 * 6 * GARAGE_SPACES * CAR_OCCUPANCY);
  });

  it('1.5x: a full garage whose turned-away riders park at a garage up the line names that garage, every cycle', { timeout: 600000 }, () => {
    // (review r3: the first read "Full — build another garage by a stop" while the next ones up the line had room)
    const { st, ids } = lineTown(LINE5, 1.5);
    const hints: string[] = [];
    const { cars } = run(st, ids, 20, (sim) => hints.push(line(sim, ids[0], 'parkRide').hint));
    console.log(`five stations 1.5x (cycles 10-20): cars ${cars.map(range).join(' / ')}; g0: ${[...new Set(hints)].join(' | ')}`);
    for (const h of hints) expect(h).toMatch(/^Full — .*; the overflow parks at the Parking Garage \d+ tiles E$/);
  });

  it('1x: a little-used garage says why; the unneeded fifth keeps its reason through the next update', { timeout: 600000 }, () => {
    const { st, ids } = lineTown(LINE5, 1);
    const g0: string[] = [];
    const { sim, tr, cars } = run(st, ids, 14, (s) => g0.push(line(s, ids[0], 'parkRide').hint));
    console.log(`five stations 1x (cycles 10-14): cars ${cars.map(range).join(' / ')}; g0: ${[...new Set(g0)].join(' | ')}`);
    // (the fastest hovers at its room: when it reads full, its spill parks up the line — never "build another garage")
    for (const h of g0) if (h) expect(h).toMatch(/^Full — .*; the overflow parks at the Parking Garage \d+ tiles E$/);
    // the fourth carries under a fifth of its room: why (review r3: 17-160 of 900 read "ok" with no reason)
    expect(Math.max(...cars[3])).toBeLessThan(0.2 * GARAGE_SPACES);
    expect(Math.min(...cars[3])).toBeGreaterThan(10);
    expect(line(sim, ids[3], 'switched').hint).toBe('Commuters near here have 3 faster park & ride garages with room, e.g. the Parking Garage 12 tiles W — few come this far');
    // the fifth is not needed (premise of transitFacilities' five-station case)
    const idle = 'Commuters near here have 4 faster park & ride garages with room, e.g. the Parking Garage 12 tiles W — this one is not needed here';
    expect(line(sim, ids[4], 'switched').hint).toBe(idle);
    // ... and says so at every step of the next traffic update — while it rebuilds the origins' options too (review r3:
    // "Not picked yet" for 15 of 150 days), also opened for the first time then (no cached reason)
    const t = tr as unknown as { phase: number; lastCycleStart: number; reachCache: Map<number, unknown>; step(s: Simulation): void };
    tr.invalidate();
    t.phase = 0;
    t.lastCycleStart = st.day;
    let steps = 0;
    while (t.phase >= 0) {
      t.step(sim);
      t.reachCache.delete(ids[4]);
      expect(line(sim, ids[4], 'switched').hint, `step ${steps}`).toBe(idle);
      steps++;
    }
    expect(steps).toBeGreaterThan(10);
  });

  it('homes without residents: "no commuters", not "no homes"', { timeout: 300000 }, () => {
    const { st, ids } = prTown([[48, 68]], 1);
    for (const b of st.buildings.values()) if (b.def === 't_r2') b.pop = 0;
    st.stats.population = 0;
    const sim = newSim(st);
    cycle(sim); cycle(sim);
    expect(getTraffic(sim)!.garageReach(ids[0])!.homes).toBeGreaterThan(50);
    expect(line(sim, ids[0], 'switched').hint).toBe('No commuters within a 12-minute drive — the homes there are empty');
    // (a garage with no homes at all in reach still says "no homes")
    const far = place(st, 'tr_parking_garage', 179, 68);
    for (const b of [far, place(st, 'tr_bus_stop', 178, 69), place(st, 'tr_bus_stop', 164, 69)]) sim.events.emit('buildingAdded', b);
    cycle(sim); cycle(sim);
    expect(line(sim, far.id, 'switched').hint).toMatch(/^No homes within a 12-minute drive/);
  });

  it('same city, same seed: the overflow is deterministic; a saved 2x town continues the original', { timeout: 600000 }, () => {
    const rows = (s: Simulation, ids: number[]) => {
      const tr = getTraffic(s)!;
      return [s.state.stats.avgCommute, s.state.stats.transitFleet.parkRide, ...ids.flatMap((id) => [tr.garageInfo(id)!.parkRide, tr.garageInfo(id)!.price ?? 0])];
    };
    const a = lineTown(LINE5, 2), b = lineTown(LINE5, 2);
    const sa = newSim(a.st), sb = newSim(b.st);
    for (let k = 0; k < 8; k++) { cycle(sa); cycle(sb); expect(rows(sb, b.ids)).toEqual(rows(sa, a.ids)); }
    // save after 8 cycles: the restored town's assignments follow the original's (its overflow forests are rebuilt)
    const restored = deserializeCity(structuredClone(serializeCity(a.st, { copy: true })) as SerializedCity);
    const sr = newSim(restored);
    for (let k = 0; k < 6; k++) {
      cycle(sa);
      const x = rows(sa, a.ids), y = rows(sr, a.ids);
      for (let i = 0; i < x.length; i++) expect(Math.abs(y[i] - x[i]), `cycle ${k} value ${i}`).toBeLessThanOrEqual(0.01 * Math.max(1, Math.abs(x[i])));
      cycle(sr);
    }
  });
});

describe('WP7b r4 garage hint: "N min longer" names the nearest of their options', () => {
  it('the example is the option nearest to the garage, not their fastest pick far away (review r3: "79 tiles SE")', () => {
    // a report-only check (the hint reads TrafficSystem.garageReach): a stub traffic system whose homes near garage T
    // use F, 100 tiles east, as their fastest option and N, 20 tiles east, too; T is 11 minutes slower for them
    const st = newState(160);
    roadLine(st, 5, 50, 150, 50, Network.Road);
    const T = place(st, 'tr_parking_garage', 10, 48), N = place(st, 'tr_parking_garage', 30, 48), F = place(st, 'tr_parking_garage', 110, 48);
    const stop = place(st, 'tr_bus_stop', 12, 49);
    const full = { stopId: stop.id, parkRide: 900, spaces: 900, walkMin: 1, ride: true, riders: 1035, wanted: 1500, catchment: 5000, price: 2, state: 'parkRide', pooled: 0, reserve: 0 };
    const tr = {
      stopLoad: () => null,
      garageInfo: (id: number) => id === T.id
        ? { stopId: stop.id, parkRide: 0, spaces: 900, walkMin: 1, ride: true, riders: 0, wanted: 0, catchment: 0, price: 0, state: 'parkRide', pooled: 0, reserve: 0, transitMin: 25 }
        : id === N.id || id === F.id ? full : null,
      garageReach: (id: number) => id !== T.id ? null : {
        workers: 3000, homes: 40, ovTo: -1, ovShare: 0, via: F.id, viaRoom: -1, slower: 11.2, options: 2, others: 2, own: 0, full: 1,
        opts: [F.id, N.id], optsRoom: [],
      },
    };
    const sim = { state: st, getSystem: (n: string) => (n === 'traffic' ? tr : undefined) } as unknown as Simulation;
    const hint = transportFacilityReport(sim, T)!.lines.find((l) => l.key === 'switched')!.hint!;
    expect(hint).toBe('Commuters near here use the Parking Garage 20 tiles E (full): park & ride from here would take them 11 min longer, so when it is full they drive or ride from home instead — link it to a subway / train line or a better-served stop');
  });
});
