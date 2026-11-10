/**
 * T071 (LG-02) on B2's traffic pieces: Grand Central's hub code runs inside prepTransit's pieces (its attach nodes in
 * the per-stop attach pieces, with ten scratch entries while a hub exists; its wait in the waits pieces, from the pass's
 * stopsB / stRhoB; its transfers between modes in the first transfers piece, over the hub stops the attach pieces kept),
 * and a traffic cycle gives the same city and traffic fields in one go, at the production piece size and in tiny or
 * random pieces, across edits that switch the hub's power, its partner stations and its road.
 */
import { describe, expect, it } from 'vitest';
import { RNG } from '../../src/core/rng';
import { Network } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { DEPOT_BUSES } from '../../src/sim/infra/params';
import type { TransitNet } from '../../src/sim/infra/search';
import { TrafficSystem } from '../../src/sim/infra/traffic';
import { diffDigests, fieldsDigest, stateDigest, trafficCycle, withPieceScale } from './b2Harness';
import { newState, place, roadLine } from './cityGen';

/** module / city references and the scratch whose content depends on where the pieces fall (as b2Pieces.test.ts) */
const SCRATCH = ['snap', 'gb', 'task', 'unsub', 'lastState', 'transportFor', 'attachFor', 'phaseMs', 'lastCycleMs', 'lastCycleMs0', 'heap'];

/** the hub on a road (bus), a rail line from the west edge with a partner station (train), a tunnel with a partner
 *  station (subway); a garage and a depot; homes west of it, offices east beyond walking distance; bus stops */
function hubCity(): { st: CityState; hub: Building } {
  const st = newState(64);
  roadLine(st, 0, 23, 62, 23);
  for (let x = 4; x <= 60; x += 8) roadLine(st, x, 24, x, 41);
  roadLine(st, 0, 41, 62, 41);
  roadLine(st, 0, 19, 50, 19, Network.Rail);
  for (let x = 18; x <= 50; x++) st.subway[st.idx(x, 21)] = 1;
  const hub = place(st, 'lm_grand_central', 20, 20, { flags: BF.Powered | BF.Watered });
  place(st, 't_train', 44, 18);
  place(st, 't_subway', 46, 20);
  place(st, 't_bus', 9, 22);
  place(st, 't_bus', 33, 22);
  place(st, 'tr_parking_garage', 6, 21);
  place(st, 'civ_bus_depot', 25, 25);
  for (let z = 25; z < 40; z += 3) for (let x = 5; x < 28; x += 2) {
    if (st.building[st.idx(x, z)] < 0) place(st, 't_r2', x, z, { pop: 55, capacity: 60, flags: BF.Powered | BF.Watered });
  }
  for (let z = 25; z < 40; z += 4) for (let x = 37; x < 60; x += 4) {
    if (st.building[st.idx(x, z)] < 0) place(st, 't_co', x, z, { jobs: 150, capacity: 220, flags: BF.Powered | BF.Watered });
  }
  return { st, hub };
}

/** the edit before cycle c: a new bus stop, the hub's power off and on, its subway partner gone and back, a road cut */
function edit(sim: Simulation, c: number, hub: Building): void {
  const st = sim.state;
  const remove = (def: string) => {
    for (const b of [...st.buildings.values()]) {
      if (b.def !== def) continue;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) st.building[st.idx(x, z)] = -1;
      st.buildings.delete(b.id);
      sim.events.emit('buildingRemoved', b);
    }
  };
  const road = (type: Network) => {
    roadLine(st, 30, 23, 30, 23, type);
    sim.events.emit('networkChanged', { x0: 30, z0: 23, x1: 31, z1: 24 });
  };
  switch (c) {
    case 1: sim.events.emit('buildingAdded', place(st, 't_bus', 52, 22)); break;
    case 2: hub.flags &= ~BF.Powered; sim.events.emit('buildingChanged', hub); break;
    case 3: hub.flags |= BF.Powered; sim.events.emit('buildingChanged', hub); break;
    case 4: remove('t_subway'); break;
    case 5: road(Network.None); break;
    case 6: sim.events.emit('buildingAdded', place(st, 't_subway', 46, 20)); break;
    case 7: road(Network.Road); break;
    case 8: remove('t_train'); break;
    default: break;
  }
}

function runCycles(scale: number | 'random', cycles: number) {
  const { st, hub } = hubCity();
  const tr = new TrafficSystem();
  const sim = new Simulation(st, [tr]);
  const rng = new RNG(0x6c02);
  const out: Record<string, string>[] = [];
  for (let c = 0; c < cycles; c++) {
    if (c > 0) edit(sim, c, hub);
    st.day += 2;
    const s = scale === 'random' ? rng.pick([1e9, 1, 0.3, 0.05, 0.004]) : scale;
    withPieceScale(s, () => trafficCycle(sim));
    out.push({ ...stateDigest(st), ...fieldsDigest(tr, SCRATCH) });
  }
  return { out, tr, hub };
}

interface HubFields {
  stIdxById: Map<number, number>;
  stAtt: Int32Array;
  stAttS: Int32Array;
  stAttC: Uint8Array;
  stWait: Float32Array;
  tHubS: number[];
  tnet: TransitNet;
}

describe('LG-02 Grand Central in B2\'s traffic pieces', () => {
  it('one go = production pieces = tiny / random pieces at every cycle end, across power, partner and road edits', () => {
    const one = runCycles(1e9, 10).out;
    for (const scale of [1, 1e-9, 'random'] as const) {
      const run = runCycles(scale, 10).out;
      for (let c = 0; c < one.length; c++) expect(diffDigests(one[c], run[c]), `scale ${scale}, cycle ${c}`).toEqual([]);
    }
  }, 300_000);

  it('the pieces run the hub: ten attach nodes, transfers between its modes at its wait (once per pass), its fleet and garage', () => {
    const { tr, hub } = runCycles(1, 2);
    const t = tr as unknown as HubFields;
    const s = t.stIdxById.get(hub.id)!;
    expect(t.stAttC[s]).toBe(10);
    expect(t.tHubS).toEqual([s]);
    expect(Number.isFinite(t.stWait[s])).toBe(true);
    const net = t.tnet, nodes = Array.from(t.stAtt.subarray(t.stAttS[s], t.stAttS[s] + t.stAttC[s]));
    const mode = (v: number) => v < net.nR ? 0 : v < net.nR + net.nRail ? 1 : 2;
    let internal = 0;
    for (const u of nodes) for (let e = net.trStart[u]; e < net.trStart[u + 1]; e++) {
      if (!nodes.includes(net.trTo[e]) || mode(net.trTo[e]) === mode(u)) continue;
      internal++;
      expect(net.trCost[e]).toBe(t.stWait[s]);
    }
    // 2 bus x 4 rail + 2 bus x 4 subway + 4 rail x 4 subway pairs, both ways
    expect(internal).toBe(64);
    expect(tr.depotInfo(hub.id)?.fleet).toBe(DEPOT_BUSES);
    expect(tr.depotInfo(hub.id)?.stops).toBeGreaterThan(0);
    expect(tr.garageInfo(hub.id)?.spaces).toBe(2000);
  });
});
