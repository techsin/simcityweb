import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { Transit, centerCell, infoOf } from '../../src/sim/infra/common';
import { facilityUseFactor, updateUseFactors } from '../../src/sim/infra/facilities';
import { DEPOT_BUSES } from '../../src/sim/infra/params';
import type { TransitNet } from '../../src/sim/infra/search';
import { TrafficSystem } from '../../src/sim/infra/traffic';
import { collectStops, computeTransitCoverage, transitCoverageActive } from '../../src/sim/infra/transit';
import { transportDefFacts, transportFacilityReport, transportUseFactor } from '../../src/sim/infra/transportFacilities';
import { newState, place, roadLine } from './cityGen';

function hubTown(partners = true, road = true) {
  const st = newState();
  const hub = place(st, 'lm_grand_central', 20, 20, { flags: BF.Powered | BF.Watered });
  if (road) roadLine(st, 20, 23, 45, 23);
  roadLine(st, 20, 19, 40, 19, Network.Rail);
  for (let x = 20; x <= 40; x++) st.subway[st.idx(x, 21)] = 1;
  const train = partners ? place(st, 't_train', 30, 18) : null;
  const subway = partners ? place(st, 't_subway', 30, 20) : null;
  const traffic = new TrafficSystem();
  const sim = new Simulation(st, [traffic]);
  return { st, hub, train, subway, traffic, sim };
}

function attachmentTown(hubCount: number, busCount = 0) {
  const st = newState();
  roadLine(st, 0, 19, st.size - 1, 19, Network.Rail);
  roadLine(st, 0, 23, st.size - 1, 23);
  for (let x = 0; x < st.size; x++) st.subway[st.idx(x, 21)] = 1;
  const hubs = Array.from({ length: hubCount }, (_, k) => {
    const x = 5 + k * 7;
    roadLine(st, x - 1, 19, x - 1, 20, Network.Rail);
    return place(st, 'lm_grand_central', x, 20, { flags: BF.Powered | BF.Watered });
  });
  place(st, 't_subway', 2, 21);
  if (busCount > 0) roadLine(st, 0, 40, st.size - 1, 40);
  for (let k = 0; k < busCount; k++) place(st, 't_bus', 2 + k * 3, 39);
  const traffic = new TrafficSystem();
  new Simulation(st, [traffic]);
  return { hubs, traffic };
}

interface Attachments {
  stops: { n: number };
  stAtt: Int32Array;
  stAttS: Int32Array;
  stAttC: Uint8Array;
  stIdxById: Map<number, number>;
  nodeStop: Int32Array;
  tnet: TransitNet;
}

describe('LG-02 Grand Central transport', () => {
  it('keeps one stop and load key while counting as a train and subway station', () => {
    const { st, hub, train, subway, traffic, sim } = hubTown();
    expect(infoOf(st, hub).transit).toBe(Transit.Hub);
    const stops = collectStops(st);
    expect(Array.from(stops.bid.slice(0, stops.n)).filter((id) => id === hub.id)).toHaveLength(1);
    for (const mode of [Transit.Bus, Transit.Train, Transit.Subway]) expect(traffic.hubModeAttached(hub.id, mode)).toBe(true);
    expect(traffic.stationLine(train!.id)?.stations).toBe(2);
    expect(traffic.stationLine(subway!.id)?.stations).toBe(2);
    expect(traffic.stopLoad(hub.id)).not.toBeNull();
    expect(traffic.depotInfo(hub.id)?.fleet).toBe(DEPOT_BUSES);
    expect(traffic.garageInfo(hub.id)?.spaces).toBe(2000);
    expect(transportFacilityReport(sim, hub)?.lines.find((line) => line.key === 'connections')?.value).toBe('Train · Subway · Bus');
    expect(transportDefFacts(hub.def).find((line) => line.key === 'spaces')?.value).toBe('2,000');
  });

  it('adds transfers between all three connected networks', () => {
    const { traffic } = hubTown();
    const net = (traffic as unknown as { tnet: TransitNet }).tnet;
    const mode = (node: number) => node < net.nR ? 'bus' : node < net.nR + net.nRail ? 'train' : 'subway';
    const links = new Set<string>();
    for (let node = 0; node < net.total; node++) for (let e = net.trStart[node]; e < net.trStart[node + 1]; e++) {
      expect(Number.isFinite(net.trCost[e])).toBe(true);
      links.add(`${mode(node)}:${mode(net.trTo[e])}`);
    }
    for (const link of ['bus:train', 'train:bus', 'bus:subway', 'subway:bus', 'train:subway', 'subway:train']) expect(links.has(link)).toBe(true);
  });

  it('fits all ten hub attachments in the original stop pool allocation', () => {
    const { hubs, traffic } = attachmentTown(1, 10);
    const t = traffic as unknown as Attachments;
    expect(t.stops.n).toBe(12);
    expect(t.stAtt.length).toBe(80);
    const s = t.stIdxById.get(hubs[0].id)!;
    expect(t.stAttC[s]).toBe(10);
    const nodes = Array.from(t.stAtt.slice(t.stAttS[s], t.stAttS[s] + t.stAttC[s]));
    expect(new Set(nodes).size).toBe(10);
    expect(nodes.filter((v) => v < t.tnet.nR)).toHaveLength(2);
    expect(nodes.filter((v) => v >= t.tnet.nR && v < t.tnet.nR + t.tnet.nRail)).toHaveLength(4);
    expect(nodes.filter((v) => v >= t.tnet.nR + t.tnet.nRail)).toHaveLength(4);
  });

  it('grows the attachment pool safely for duplicated hubs in modded cities', () => {
    const { hubs, traffic } = attachmentTown(8);
    const t = traffic as unknown as Attachments;
    expect(t.stAttS[t.stops.n]).toBeGreaterThan(64);
    expect(t.stAtt.length).toBeGreaterThanOrEqual(t.stAttS[t.stops.n]);
    for (const hub of hubs) {
      const s = t.stIdxById.get(hub.id)!;
      expect(t.stAttC[s]).toBe(10);
      const nodes = Array.from(t.stAtt.slice(t.stAttS[s], t.stAttS[s] + t.stAttC[s]));
      expect(new Set(nodes).size).toBe(10);
      for (const v of nodes) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(t.tnet.total);
        expect(t.nodeStop[v]).toBe(s);
      }
    }
  });

  it('a road does not activate lone rail and subway lines', () => {
    const { hub, traffic } = hubTown(false);
    expect(traffic.stopAttached(hub.id)).toBe(true);
    expect(traffic.hubModeAttached(hub.id, Transit.Bus)).toBe(true);
    expect(traffic.hubModeAttached(hub.id, Transit.Train)).toBe(false);
    expect(traffic.hubModeAttached(hub.id, Transit.Subway)).toBe(false);
    const isolated = hubTown(false, false);
    expect(isolated.traffic.stopAttached(isolated.hub.id)).toBe(false);
    expect(transportUseFactor(isolated.st, isolated.hub)).toBe(0);
    updateUseFactors(isolated.sim);
    expect(facilityUseFactor(isolated.st, isolated.hub)).toBe(0);
    const noRoad = hubTown(true, false);
    expect(noRoad.traffic.hubModeAttached(noRoad.hub.id, Transit.Train)).toBe(true);
    expect(noRoad.traffic.hubModeAttached(noRoad.hub.id, Transit.Subway)).toBe(true);
    expect(noRoad.traffic.hubModeAttached(noRoad.hub.id, Transit.Bus)).toBe(false);
    expect(noRoad.traffic.depotInfo(noRoad.hub.id)).toBeNull();
  });

  it('supplies 18-tile coverage only while connected', () => {
    const { st, hub, traffic, sim } = hubTown();
    const stops = collectStops(st);
    const onlyHub = { n: 1, bid: Int32Array.of(hub.id), mode: Uint8Array.of(Transit.Hub), cell: Int32Array.of(centerCell(st, hub)) };
    const coverage = new Float32Array(st.cells);
    computeTransitCoverage(st, onlyHub, coverage, 1, false, (s) => traffic.stopAttached(onlyHub.bid[s]));
    const c = centerCell(st, hub), x = c % st.size, z = Math.floor(c / st.size);
    expect(coverage[st.idx(x + 18, z)]).toBeGreaterThan(0);
    expect(coverage[st.idx(x + 19, z)]).toBe(0);
    expect(transitCoverageActive(sim, hub)).toBe(true);
    expect(stops.n).toBe(3);
    hub.flags &= ~BF.Powered;
    sim.events.emit('buildingChanged', hub);
    expect(transitCoverageActive(sim, hub)).toBe(false);
    expect(transportUseFactor(st, hub)).toBe(0);
    updateUseFactors(sim);
    expect(facilityUseFactor(st, hub)).toBe(0);
  });

  it.each([BF.Burnt, BF.Abandoned, 0])('closed and unfinished hubs run no service (%s)', (flag) => {
    const { st, hub, traffic, sim } = hubTown();
    if (flag) hub.flags |= flag;
    else hub.built = 0.5;
    sim.events.emit('buildingChanged', hub);
    expect(traffic.stopAttached(hub.id)).toBe(false);
    expect(transportUseFactor(st, hub)).toBe(0);
    traffic.runCycleSync(sim);
    expect(traffic.depotInfo(hub.id)).toBeNull();
    expect(traffic.garageInfo(hub.id)).toBeNull();
    expect(transportFacilityReport(sim, hub)?.warnings).toContain('Closed (not running)');
  });
});
