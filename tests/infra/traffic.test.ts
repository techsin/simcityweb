import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { BF, type CityState } from '../../src/sim/CityState';
import { RoadGraph } from '../../src/sim/infra/graph';
import { getTraffic } from '../../src/sim/systems/infra';
import { MAX_COMMUTE } from '../../src/sim/infra/params';
import { commuteMinutes, commuteRamp } from '../../src/sim/economy/factors';
import { newSim, newState, place, roadLine } from './cityGen';

describe('road graph connectivity', () => {
  it('one-way roads only allow travel along their direction', () => {
    const st = newState(32);
    roadLine(st, 5, 5, 15, 5, Network.OneWay, 0); // +x
    const g = new RoadGraph();
    g.build(st);
    const a = g.nodeOfCell[st.idx(8, 5)], b = g.nodeOfCell[st.idx(9, 5)];
    expect(g.fwd[a * 4 + 0]).toBe(b); // +x allowed
    expect(g.fwd[b * 4 + 2]).toBe(-1); // -x forbidden
    // crossing street: turning onto / off the one-way sideways is allowed
    roadLine(st, 10, 2, 10, 8, Network.Street);
    g.build(st);
    const c = g.nodeOfCell[st.idx(10, 5)];
    const up = g.nodeOfCell[st.idx(10, 4)];
    expect(g.fwd[c * 4 + 3]).toBe(up);
    expect(g.fwd[up * 4 + 1]).toBe(c);
  });

  it('highways connect to roads / avenues via ramps but not to streets', () => {
    const st = newState(32);
    roadLine(st, 2, 10, 28, 10, Network.Highway);
    roadLine(st, 5, 11, 5, 20, Network.Street);
    roadLine(st, 15, 11, 15, 20, Network.Road);
    roadLine(st, 20, 11, 20, 20, Network.Avenue);
    const g = new RoadGraph();
    g.build(st);
    const hwAtStreet = g.nodeOfCell[st.idx(5, 10)], street = g.nodeOfCell[st.idx(5, 11)];
    const hwAtRoad = g.nodeOfCell[st.idx(15, 10)], road = g.nodeOfCell[st.idx(15, 11)];
    const hwAtAve = g.nodeOfCell[st.idx(20, 10)], ave = g.nodeOfCell[st.idx(20, 11)];
    expect(g.fwd[street * 4 + 3]).toBe(-1);
    expect(g.fwd[hwAtStreet * 4 + 1]).toBe(-1);
    expect(g.fwd[road * 4 + 3]).toBe(hwAtRoad);
    expect(g.fwd[hwAtAve * 4 + 1]).toBe(ave);
    expect(g.comp[street]).not.toBe(g.comp[hwAtStreet]);
    expect(g.comp[road]).toBe(g.comp[hwAtAve]);
  });

  it('bridges are normal roads', () => {
    const st = newState(32);
    roadLine(st, 2, 5, 20, 5, Network.Road);
    for (let x = 8; x <= 12; x++) { st.water[st.idx(x, 5)] = 1; st.netFlags[st.idx(x, 5)] |= 1; }
    const g = new RoadGraph();
    g.build(st);
    expect(g.comp[g.nodeOfCell[st.idx(2, 5)]]).toBe(g.comp[g.nodeOfCell[st.idx(20, 5)]]);
  });
});

/**
 * West: residential strip along x=14. East: offices along x=41. The two sides are linked by a single street at
 * z=25 (bottleneck). No map-edge connections.
 */
function bottleneckCity(): { st: CityState; homes: number[]; streetCells: number[] } {
  const st = newState(64);
  roadLine(st, 14, 4, 14, 46, Network.Road);
  roadLine(st, 40, 4, 40, 46, Network.Road);
  roadLine(st, 15, 25, 39, 25, Network.Street);
  const homes: number[] = [];
  for (let z = 4; z <= 46; z++) homes.push(place(st, 't_r2', 13, z, { pop: 60, wealth: 2 }).id);
  for (let z = 4; z <= 44; z += 4) place(st, 't_co', 41, z, { jobs: 300 });
  const streetCells: number[] = [];
  for (let x = 16; x <= 38; x++) streetCells.push(st.idx(x, 25));
  st.stats.population = homes.length * 60;
  return { st, homes, streetCells };
}

function meanCong(st: CityState, cells: number[]): number {
  let s = 0;
  for (const c of cells) s += st.congestion[c];
  return s / cells.length;
}

describe('traffic assignment', () => {
  it('congestion rises on a bottleneck; a parallel road relieves it', () => {
    const { st, homes, streetCells } = bottleneckCity();
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    for (let k = 0; k < 12; k++) { tr.invalidate(); tr.runCycleSync(sim); }
    const before = meanCong(st, streetCells);
    const volBefore = st.traffic[streetCells[5]];
    console.log(`bottleneck: v/c=${before.toFixed(2)} vol=${volBefore.toFixed(0)} commute=${st.stats.avgCommute.toFixed(1)} car=${st.stats.tripsCar}`);
    expect(before).toBeGreaterThan(1);
    expect(st.stats.tripsCar).toBeGreaterThan(500);
    // commute layer on residential cells + route info
    const h = st.buildings.get(homes[20])!;
    expect(st.commute[st.idx(h.x, h.z)]).toBeGreaterThan(0);
    const info = tr.routeInfo(h.id)!;
    expect(info.mode).toBe('car');
    expect(info.commuteMin).toBeGreaterThan(4);
    expect(info.jobsReached).toBeGreaterThan(0);
    // add a parallel road at z=15
    roadLine(st, 15, 15, 39, 15, Network.Road);
    sim.events.emit('networkChanged', { x0: 15, z0: 15, x1: 40, z1: 16 });
    for (let k = 0; k < 12; k++) { tr.invalidate(); tr.runCycleSync(sim); }
    const after = meanCong(st, streetCells);
    console.log(`after parallel road: street v/c=${after.toFixed(2)} new road v/c=${st.congestion[st.idx(27, 15)].toFixed(2)} commute=${st.stats.avgCommute.toFixed(1)}`);
    expect(after).toBeLessThan(before * 0.8);
    expect(st.traffic[st.idx(27, 15)]).toBeGreaterThan(100);
  });

  it('residents without any reachable job get BF.NoJobs; job sites report fill', () => {
    const { st, homes } = bottleneckCity();
    // cut the only link
    for (let x = 15; x <= 39; x++) st.network[st.idx(x, 25)] = Network.None;
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    for (let k = 0; k < 3; k++) { tr.invalidate(); tr.runCycleSync(sim); }
    const h = st.buildings.get(homes[10])!;
    expect(h.flags & BF.NoJobs).toBeTruthy();
    expect(tr.workerAccess(h.id)).toBeLessThan(0.1);
    const office = [...st.buildings.values()].find((b) => b.def === 't_co')!;
    expect(tr.jobFill(office.id)).toBeLessThan(0.05);
  });

  it('job capacity limits workers per site (shadow prices spread commuters)', () => {
    const { st } = bottleneckCity();
    roadLine(st, 15, 15, 39, 15, Network.Avenue);
    roadLine(st, 15, 35, 39, 35, Network.Avenue);
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    for (let k = 0; k < 15; k++) { tr.invalidate(); tr.runCycleSync(sim); }
    // workers = 43 * 60 * 0.55 = 1419; jobs = 11 * 400 = 4400 -> no site should be absurdly overfilled
    for (const b of st.buildings.values()) if (b.def === 't_co') expect(tr.jobFill(b.id)).toBeLessThanOrEqual(1);
    const homes = [...st.buildings.values()].filter((b) => b.def === 't_r2');
    const acc = homes.reduce((s, b) => s + tr.workerAccess(b.id), 0) / homes.length;
    expect(acc).toBeGreaterThan(0.9);
  });

  it('sample routes follow real road cells', () => {
    const { st } = bottleneckCity();
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    for (let k = 0; k < 3; k++) { tr.invalidate(); tr.runCycleSync(sim); }
    const routes = tr.getSampleRoutes(40);
    expect(routes.length).toBeGreaterThan(5);
    const N = st.size;
    for (const r of routes) {
      expect(r.weight).toBeGreaterThan(0);
      for (let k = 0; k < r.cells.length; k++) {
        const c = r.cells[k];
        expect(st.network[c]).toBeGreaterThan(0);
        if (k > 0) {
          const p = r.cells[k - 1];
          expect(Math.abs((c % N) - (p % N)) + Math.abs(Math.floor(c / N) - Math.floor(p / N))).toBe(1);
        }
      }
    }
    expect(routes.some((r) => r.kind === 'car')).toBe(true);
  });

  it('transit: bus stops near homes and jobs attract riders, more when roads are congested', () => {
    const { st } = bottleneckCity();
    for (let z = 6; z <= 44; z += 6) { place(st, 't_bus', 15, z); place(st, 't_bus', 39, z); }
    // cars: bottleneck only; transit shares the same street (buses) -> add a subway line east-west
    for (let x = 15; x <= 39; x++) st.subway[st.idx(x, 30)] = 1;
    place(st, 't_subway', 15, 30);
    place(st, 't_subway', 39, 30);
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    for (let k = 0; k < 10; k++) { tr.invalidate(); tr.runCycleSync(sim); }
    console.log(`transit: car=${st.stats.tripsCar} transit=${st.stats.tripsTransit} walk=${st.stats.tripsWalk} commute=${st.stats.avgCommute.toFixed(1)}`);
    expect(st.stats.tripsTransit).toBeGreaterThan(100);
    expect(tr.subwayRiders[st.idx(27, 30)]).toBeGreaterThan(50);
  });

  it('passenger rail: riders between train stations, train sample routes on rail cells', () => {
    const { st } = bottleneckCity();
    for (let x = 17; x <= 37; x++) st.network[st.idx(x, 40)] = Network.Rail;
    // level crossing with the east road (x=40 is road; rail continues through a crossing at x=27 on a new street)
    roadLine(st, 27, 36, 27, 44, Network.Street);
    st.netFlags[st.idx(27, 40)] |= 1 << 5;
    place(st, 't_train', 15, 40); // 2x1, touches rail at x=17
    place(st, 't_train', 38, 40);
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    for (let k = 0; k < 8; k++) { tr.invalidate(); tr.runCycleSync(sim); }
    const riders = st.traffic[st.idx(30, 40)];
    console.log(`rail: riders=${riders.toFixed(0)} transit=${st.stats.tripsTransit}`);
    expect(riders).toBeGreaterThan(50);
    const trains = tr.getSampleRoutes(200).filter((r) => r.kind === 'train');
    expect(trains.length).toBeGreaterThan(0);
    for (const r of trains) for (const c of r.cells) expect(st.network[c] === Network.Rail || (st.netFlags[c] & (1 << 5)) !== 0).toBe(true);
  });

  it('findPath returns a connected road path', () => {
    const { st } = bottleneckCity();
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    const p = tr.findPath(sim, st.idx(14, 5), st.idx(40, 40))!;
    expect(p).not.toBeNull();
    expect(p[0]).toBe(st.idx(14, 5));
    expect(p[p.length - 1]).toBe(st.idx(40, 40));
  });

  it('neighbour connections act as regional job sources and freight sinks', () => {
    const st = newState(64);
    roadLine(st, 0, 30, 40, 30, Network.Avenue); // reaches west edge
    for (let x = 5; x <= 35; x++) place(st, 't_r2', x, 31, { pop: 60 });
    const f = place(st, 't_id', 20, 29, { jobs: 40 });
    st.stats.population = 31 * 60;
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    for (let k = 0; k < 4; k++) { tr.invalidate(); tr.runCycleSync(sim); }
    // regional jobs (sim-core model: 0.05 x workers + 300 ~ 350 slots) + 40 local jobs for ~1,020 workers
    const homes = [...st.buildings.values()].filter((b) => b.def === 't_r2');
    const avg = homes.reduce((a, b) => a + tr.workerAccess(b.id), 0) / homes.length;
    expect(avg).toBeGreaterThan(0.3);
    expect(avg).toBeLessThan(0.5);
    const nearEdge = st.buildings.get(st.building[st.idx(5, 31)])!;
    expect(tr.workerAccess(nearEdge.id)).toBeGreaterThan(0.9); // closest to the connection -> regional jobs
    expect(tr.freightAccess(f.id)).toBeGreaterThan(0.3);
    expect(tr.getSampleRoutes(100).some((r) => r.kind === 'truck')).toBe(true);
  });
});

describe('routed 43: a road cut off from the city network is no commute', () => {
  it('homes on a separate road with one job beside them read "no route to work" and a long commute, not 5 minutes', { timeout: 300000 }, () => {
    // (WP6a verify S5b: cut-off homes scored a 5-minute commute from the one wind-turbine job on their road, better than
    // the connected homes' 26 minutes)
    const st = newState(64);
    roadLine(st, 0, 32, 63, 32, Network.Avenue); // main network: avenue to both map edges
    roadLine(st, 20, 12, 20, 31, Network.Road);
    roadLine(st, 10, 12, 30, 12, Network.Road);
    const main: number[] = [];
    for (let x = 10; x <= 19; x++) main.push(place(st, 't_r1', x, 13, { pop: 12, capacity: 12, wealth: 1 }).id);
    for (let x = 22; x <= 30; x += 2) place(st, 't_co', x, 33, { jobs: 40, capacity: 60 });
    // the cut-off road: homes along it and a single job on it
    roadLine(st, 45, 10, 60, 10, Network.Road);
    const cut: number[] = [];
    for (let x = 45; x <= 57; x++) cut.push(place(st, 't_r1', x, 11, { pop: 12, capacity: 12, wealth: 1 }).id);
    place(st, 't_cs', 59, 11, { jobs: 1, capacity: 1, wealth: 1 });
    st.stats.population = (main.length + cut.length) * 12;
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    for (let k = 0; k < 4; k++) { tr.invalidate(); tr.runCycleSync(sim); }
    const svc = sim.getSystem('services') as unknown as { compute(s: unknown, first: boolean): void };
    svc.compute(sim, false);
    const at = (id: number) => { const b = st.buildings.get(id)!; return st.idx(b.x, b.z); };
    const avg = (ids: number[], f: (id: number) => number) => ids.reduce((s, id) => s + f(id), 0) / ids.length;
    const cutAcc = avg(cut, (id) => st.accessCommute[at(id)]), mainAcc = avg(main, (id) => st.accessCommute[at(id)]);
    const r = tr.routeInfo(cut[0])!;
    console.log(`cut-off: route ${JSON.stringify(r)} · commute layer ${avg(cut, (id) => st.commute[at(id)]).toFixed(1)} · access ${cutAcc.toFixed(1)} min`
      + ` | connected: ${avg(main, (id) => tr.commuteOf(id)).toFixed(1)} min · access ${mainAcc.toFixed(1)} · city average ${st.stats.avgCommute.toFixed(1)}`);
    // the cut-off homes: no route to work (the inspector's text), no short commute anywhere (traffic, the layer, the
    // access field), no jobs flag; desirability / land value read the longest commute — at or past the ramp's bad end
    // (the commute term at its worst, not "+11" beside "No route to work")
    const ramp = commuteRamp(st);
    for (const id of cut) {
      const ri = tr.routeInfo(id)!;
      expect(ri.cutOff).toBe(true);
      expect(ri.reachable).toBe(false);
      expect(ri.mode).toBe('none');
      expect(st.buildings.get(id)!.flags & BF.NoJobs).toBeTruthy();
      expect(st.commute[at(id)]).toBeGreaterThan(0.95 * MAX_COMMUTE);
      expect(commuteMinutes(st, true, at(id), ramp.avg, ramp.unreached)).toBeGreaterThanOrEqual(ramp.bad);
    }
    expect(cutAcc).toBeGreaterThan(mainAcc);
    expect(st.stats.avgCommute).toBeLessThan(0.5 * MAX_COMMUTE);
    // the connected homes keep their commute; the one job on the cut-off road still has its worker
    for (const id of main) { expect(tr.routeInfo(id)!.cutOff).toBeUndefined(); expect(tr.commuteOf(id)).toBeGreaterThan(0); }
    const shop = [...st.buildings.values()].find((b) => b.def === 't_cs')!;
    expect(tr.jobFill(shop.id)).toBeGreaterThan(0.5);
    // a road on to the map edge: its homes commute to the region — not cut off, however few jobs the road has
    roadLine(st, 61, 10, 63, 10, Network.Road);
    sim.events.emit('networkChanged', { x0: 60, z0: 9, x1: 63, z1: 11 });
    for (let k = 0; k < 4; k++) { tr.invalidate(); tr.runCycleSync(sim); }
    for (const id of cut) {
      expect(tr.routeInfo(id)?.cutOff).toBeUndefined();
      expect(tr.commuteOf(id)).toBeLessThan(0.9 * MAX_COMMUTE);
    }
    expect(avg(cut, (id) => tr.workerAccess(id))).toBeGreaterThan(0.2);
    // connecting the road to the network makes it a commute again
    roadLine(st, 45, 11, 45, 31, Network.Road);
    sim.events.emit('networkChanged', { x0: 45, z0: 10, x1: 46, z1: 32 });
    for (let k = 0; k < 4; k++) { tr.invalidate(); tr.runCycleSync(sim); }
    for (const id of cut) expect(tr.routeInfo(id)?.cutOff).toBeUndefined();
  });
});
