/**
 * P0b-1 / F1 (WP7b): the per-network traffic tables follow the core/types.ts Network enum (Avenue = 3, OneWay = 4).
 * Before the fix, NET_CAPACITY / NET_TIME / CONNECTION_JOBS / CONNECTION_WORKERS were written in the order
 * [None, Street, Road, OneWay, Avenue, ...], so avenues got one-way capacity and speed and vice versa.
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { RoadGraph } from '../../src/sim/infra/graph';
import { CONNECTION_JOBS, CONNECTION_WORKERS, NET_CAPACITY, NET_TIME } from '../../src/sim/infra/params';
import { newState, roadLine } from './cityGen';

describe('network tables (F1)', () => {
  it('are indexed by the Network enum', () => {
    expect(Network.Avenue).toBe(3);
    expect(Network.OneWay).toBe(4);
    for (const t of [NET_CAPACITY, NET_TIME, CONNECTION_JOBS, CONNECTION_WORKERS]) expect(t.length).toBe(7);
    expect(NET_CAPACITY[Network.Avenue]).toBe(2600);
    expect(NET_CAPACITY[Network.OneWay]).toBe(1600);
    expect(NET_TIME[Network.Avenue]).toBe(0.075);
    expect(NET_TIME[Network.OneWay]).toBe(0.085);
    expect(CONNECTION_JOBS[Network.Avenue]).toBe(5000);
    expect(CONNECTION_WORKERS[Network.Avenue]).toBe(4000);
    expect(CONNECTION_JOBS[Network.OneWay]).toBe(2000);
    expect(CONNECTION_WORKERS[Network.OneWay]).toBe(1500);
  });

  it('rank capacity and speed by road class', () => {
    const cap = NET_CAPACITY, time = NET_TIME;
    expect(cap[Network.Highway]).toBeGreaterThan(cap[Network.Avenue]);
    expect(cap[Network.Avenue]).toBeGreaterThan(cap[Network.OneWay]);
    expect(cap[Network.OneWay]).toBeGreaterThan(cap[Network.Road]);
    expect(cap[Network.Road]).toBeGreaterThan(cap[Network.Street]);
    expect(time[Network.Highway]).toBeLessThan(time[Network.Avenue]);
    expect(time[Network.Avenue]).toBeLessThan(time[Network.OneWay]);
    expect(time[Network.OneWay]).toBeLessThan(time[Network.Road]);
    expect(time[Network.Road]).toBeLessThan(time[Network.Street]);
    // regional connections: bigger roads carry more commuters
    for (const t of [CONNECTION_JOBS, CONNECTION_WORKERS]) {
      expect(t[Network.Highway]).toBeGreaterThan(t[Network.Avenue]);
      expect(t[Network.Avenue]).toBeGreaterThan(t[Network.OneWay]);
      expect(t[Network.OneWay]).toBeGreaterThanOrEqual(t[Network.Road]);
      expect(t[Network.Road]).toBeGreaterThan(t[Network.Street]);
    }
  });

  it('the road graph gives avenue cells avenue capacity and speed', () => {
    const st = newState(16);
    roadLine(st, 1, 3, 12, 3, Network.Avenue);
    roadLine(st, 1, 6, 12, 6, Network.OneWay, 0);
    const g = new RoadGraph();
    g.build(st);
    const a = g.nodeOfCell[st.idx(5, 3)], o = g.nodeOfCell[st.idx(5, 6)];
    expect(g.cap[a]).toBe(2600);
    expect(g.t0[a]).toBeCloseTo(0.075, 6);
    expect(g.cap[o]).toBe(1600);
    expect(g.t0[o]).toBeCloseTo(0.085, 6);
  });
});
