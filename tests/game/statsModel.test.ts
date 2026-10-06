/**
 * Routed UI item 31 (simB ROUTED_ITEMS): the City statistics Park & ride card. stats.transitFleet.parkRideSpaces sums,
 * over the garages in park & ride service, spaces minus the spaces each keeps for its parking-short block (traffic.ts),
 * so it is 0 when every park & ride garage keeps all its spaces — the card read "no garages by a stop" then.
 */
import { describe, expect, it } from 'vitest';
import { GARAGE_DEF, countGarages, parkRideLine } from '../../src/ui/statsModel';

const garage = (id: number) => ({ id, def: GARAGE_DEF });
/** a stub of TrafficSystem.garageInfo: the state of each garage in the last assignment (null: not seen yet) */
const traffic = (states: Record<number, string>) => ({ garageInfo: (id: number) => (states[id] ? { state: states[id] } : null) });

describe('Park & ride card line', () => {
  it('every park & ride garage keeps all its spaces for its block: "all spaces kept for local parking"', () => {
    const g = countGarages([garage(1), garage(2), { id: 3, def: 'res_cottage' }], traffic({ 1: 'parkRide', 2: 'parkRide' }));
    expect(g).toEqual({ total: 2, parkRide: 2, downtown: 0, noTransit: 0 });
    expect(parkRideLine({ parkRideSpaces: 0 }, g)).toBe('all spaces kept for local parking');
  });

  it('park & ride room: riders a day and the free spaces (unchanged)', () => {
    const g = countGarages([garage(1)], traffic({ 1: 'parkRide' }));
    expect(parkRideLine({ parkRideSpaces: 640 }, g)).toBe('a day · 640 spaces');
    expect(parkRideLine({ parkRideSpaces: 12_400 }, g)).toBe('a day · 12.4k spaces');
  });

  it('no garage in park & ride service: why (no stop, no garage, downtown stops, stops reaching no jobs)', () => {
    expect(parkRideLine({ parkRideSpaces: 0 }, countGarages([], null))).toBe('no garages by a stop');
    expect(parkRideLine(undefined, countGarages([garage(1)], undefined))).toBe('no garages by a stop');
    expect(parkRideLine({ parkRideSpaces: 0 }, countGarages([garage(1), garage(2)], traffic({ 1: 'noStop', 2: 'noRoad' })))).toBe('no garages by a stop');
    expect(parkRideLine({ parkRideSpaces: 0 }, countGarages([garage(1)], traffic({ 1: 'downtown' })))).toBe('garages by downtown stops: parking only');
    expect(parkRideLine({ parkRideSpaces: 0 }, countGarages([garage(1), garage(2)], traffic({ 1: 'downtown', 2: 'noTransit' })))).toBe('transit from their stops reaches no jobs yet');
    // one park & ride garage among them decides it
    expect(parkRideLine({ parkRideSpaces: 0 }, countGarages([garage(1), garage(2), garage(3)], traffic({ 1: 'downtown', 2: 'noStop', 3: 'parkRide' })))).toBe('all spaces kept for local parking');
  });
});
