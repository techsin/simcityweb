/**
 * Routed UI item 31 (simB ROUTED_ITEMS): the City statistics Park & ride card. stats.transitFleet.parkRideSpaces sums,
 * over the garages in park & ride service, spaces minus the spaces each keeps for its parking-short block (traffic.ts),
 * so it is 0 when every park & ride garage keeps all its spaces — the card read "no garages by a stop" then.
 */
import { describe, expect, it } from 'vitest';
import { GARAGE_DEF, countGarages, parkRideLine } from '../../src/ui/statsModel';
import { BF } from '../../src/sim/CityState';

const garage = (id: number) => ({ id, def: GARAGE_DEF });
type Info = { state: string; spaces?: number; reserve?: number };
/** a stub of TrafficSystem.garageInfo: each garage's state / spaces / reserve in the last assignment (null: not seen) */
const traffic = (info: Record<number, Info | string>) => ({
  garageInfo: (id: number) => {
    const g = info[id];
    return g === undefined ? null : typeof g === 'string' ? { state: g, spaces: 900, reserve: 0 } : { spaces: 900, reserve: 0, ...g };
  },
});

describe('Park & ride card line', () => {
  it('every park & ride garage keeps all its spaces for its block: "all spaces kept for local parking"', () => {
    // (a 215k city: a garage beside the busiest downtown stop kept 900 of 900 spaces for 35 days — the card said
    // "no garages by a stop")
    const g = countGarages([garage(1), garage(2), { id: 3, def: 'res_cottage' }], traffic({ 1: { state: 'parkRide', reserve: 900 }, 2: { state: 'parkRide', reserve: 899.6 } }));
    expect(g).toEqual({ total: 2, parkRide: 2, kept: 2, downtown: 0, noTransit: 0, pending: 0 });
    expect(parkRideLine({ parkRideSpaces: 0 }, g)).toBe('all spaces kept for local parking');
  });

  it('park & ride room: riders a day and the free spaces (unchanged)', () => {
    const g = countGarages([garage(1)], traffic({ 1: { state: 'parkRide', reserve: 873 } }));
    expect(parkRideLine({ parkRideSpaces: 27 }, g)).toBe('a day · 27 spaces');
    expect(parkRideLine({ parkRideSpaces: 12_400 }, g)).toBe('a day · 12.4k spaces');
  });

  it('a garage the stats do not count yet: park & ride starts / it is counted with the next traffic update', () => {
    // in park & ride state with room, placed since the last assignment (its prep saw it, the stats predate it)
    const g = countGarages([garage(1), garage(2)], traffic({ 1: { state: 'parkRide', reserve: 900 }, 2: { state: 'parkRide', reserve: 0 } }));
    expect(g.kept).toBe(1);
    expect(parkRideLine({ parkRideSpaces: 0 }, g)).toBe('starts with the next traffic update');
    // not seen by an assignment at all yet (null info) — but a burnt one is no new garage
    const fresh = countGarages([garage(1), { ...garage(2), flags: BF.Burnt }], traffic({}));
    expect(fresh).toMatchObject({ total: 2, pending: 1 });
    expect(parkRideLine({ parkRideSpaces: 0 }, fresh)).toBe('new garage: counted at the next traffic update');
    expect(parkRideLine({ parkRideSpaces: 0 }, countGarages([{ ...garage(2), flags: BF.Burnt }], traffic({})))).toBe('no garages by a stop');
  });

  it('no garage in park & ride service: why (no stop, no garage, downtown stops, stops reaching no jobs)', () => {
    expect(parkRideLine({ parkRideSpaces: 0 }, countGarages([], null))).toBe('no garages by a stop');
    expect(parkRideLine(undefined, countGarages([garage(1)], undefined))).toBe('no garages by a stop');
    expect(parkRideLine({ parkRideSpaces: 0 }, countGarages([garage(1), garage(2)], traffic({ 1: 'noStop', 2: 'noRoad' })))).toBe('no garages by a stop');
    expect(parkRideLine({ parkRideSpaces: 0 }, countGarages([garage(1)], traffic({ 1: 'downtown' })))).toBe('garages by downtown stops: parking only');
    expect(parkRideLine({ parkRideSpaces: 0 }, countGarages([garage(1), garage(2)], traffic({ 1: 'downtown', 2: 'noTransit' })))).toBe('transit from their stops reaches no jobs yet');
    // a park & ride garage among them decides it
    expect(parkRideLine({ parkRideSpaces: 0 }, countGarages([garage(1), garage(2), garage(3)], traffic({ 1: 'downtown', 2: 'noStop', 3: { state: 'parkRide', reserve: 900 } })))).toBe('all spaces kept for local parking');
  });
});
