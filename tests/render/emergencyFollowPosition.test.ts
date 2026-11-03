import { describe, expect, it, vi } from 'vitest';
import { CELL_SIZE } from '../../src/core/constants';
import { EmergencyVehicles, type EmergencyFeed } from '../../src/render/city/vehicles/EmergencyVehicles';
import type { EmergencyVehicle } from '../../src/sim/infra/emergency';
import { EMERG_DAYS_PER_MIN } from '../../src/sim/infra/params';

const N = 32;

function vehicle(overrides: Partial<EmergencyVehicle> = {}): EmergencyVehicle {
  return {
    id: 7, responder: 'fire', model: 'fire_truck', stationId: 1, incidentId: 2, state: 'outbound',
    path: [4 * N + 2, 4 * N + 12, 14 * N + 12], times: [0, 1, 2],
    legStart: 10, m0: 0, m1: 2, arrive: 10 + 2 * EMERG_DAYS_PER_MIN, workFrom: 0, hospital: -1,
    ...overrides,
  };
}

function renderer(list: EmergencyVehicle[], time: number) {
  const feed: EmergencyFeed = { vehicles: () => list, incidents: () => [], time: () => time };
  const y = vi.fn((x: number, z: number) => 7 + x * 0.01 + z * 0.02);
  // The position API needs no geometry, material or WebGL renderer.
  const view = Object.assign(Object.create(EmergencyVehicles.prototype), {
    state: { size: N }, surf: { y }, feed,
    pos: { x: 0, z: 0, hx: 1, hz: 0, moving: false },
  }) as EmergencyVehicles;
  return { view, feed, y };
}

describe('emergency follow position', () => {
  it('uses the driving lane and samples the rendered road surface at that world position', () => {
    const v = vehicle();
    const { view, y } = renderer([v], v.legStart + 0.5 * EMERG_DAYS_PER_MIN);
    const p = view.followPosition(v.id)!;
    expect(p.x).toBeCloseTo(7.5 * CELL_SIZE, 9);
    expect(p.z).toBeCloseTo(4.5 * CELL_SIZE + 1.9, 9);
    expect(p.y).toBe(7 + p.x * 0.01 + p.z * 0.02);
    expect(p.onScene).toBe(false);
    expect(y).toHaveBeenCalledTimes(1);
    expect(y).toHaveBeenCalledWith(p.x, p.z);
  });

  it('keeps the right-hand lane after a route corner', () => {
    const v = vehicle();
    const { view } = renderer([v], v.legStart + 1.5 * EMERG_DAYS_PER_MIN);
    const p = view.followPosition(v.id)!;
    expect(p.x).toBeCloseTo(12.5 * CELL_SIZE - 1.9, 9);
    expect(p.z).toBeCloseTo(9.5 * CELL_SIZE, 9);
    expect(p.onScene).toBe(false);
  });

  it('parks and reports arrival on the extrapolated clock before the next feed update', () => {
    const v = vehicle();
    const { view, feed } = renderer([v], v.arrive);
    const arrived = view.followPosition(v.id)!;
    expect(arrived.x).toBeCloseTo(12.5 * CELL_SIZE - 3.2, 9);
    expect(arrived.z).toBeCloseTo(14.5 * CELL_SIZE, 9);
    expect(arrived.onScene).toBe(true);
    v.state = 'onScene';
    feed.time = () => v.arrive + 1;
    expect(view.followPosition(v.id)).toEqual(arrived);
  });

  it('follows the same id when feed ordering changes and stops when it leaves the incident', () => {
    const lead = vehicle();
    const other = vehicle({ id: 8, path: [2 * N + 2, 2 * N + 12], times: [0, 2] });
    const list = [lead, other];
    const { view } = renderer(list, lead.legStart + 0.5 * EMERG_DAYS_PER_MIN);
    const p = view.followPosition(lead.id);
    list.reverse();
    expect(view.followPosition(lead.id)).toEqual(p);
    lead.state = 'returning';
    expect(view.followPosition(lead.id)).toBeNull();
    lead.state = 'transport';
    expect(view.followPosition(lead.id)).toBeNull();
    list.splice(list.indexOf(lead), 1);
    expect(view.followPosition(lead.id)).toBeNull();
  });

  it('returns no position until the feed and a nonempty route are available', () => {
    const v = vehicle({ path: [] });
    const { view, feed } = renderer([v], v.legStart);
    expect(view.followPosition(v.id)).toBeNull();
    expect(view.followPosition(999)).toBeNull();
    view.feed = null;
    expect(view.followPosition(v.id)).toBeNull();
    view.feed = feed;
    feed.vehicles = () => { throw new Error('not ready'); };
    expect(view.followPosition(v.id)).toBeNull();
  });
});
