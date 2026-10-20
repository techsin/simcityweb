/**
 * Render handoff r3, item 1 (simB render-handoff-r3): the Traffic view paints each road's value on the land beside it
 * (src/render/world/overlays.ts curbCells: the road meshes cover their whole cell, so the road texel is never seen),
 * but hovering that red curb read the land's own 0 — '0% · 0 trips/day · Tile 174, 136' right beside a 164% road on the
 * 312k save, '0% · Freight Rail Station' in green beside a 204% road on the 175k one. A land cell now reads the road the
 * view paints on it (curbRoadOf, the same rule as curbCells: its busiest neighbouring road, not rail), and says so:
 * '200%' · 'road beside it · 2,446 trips/day' (QueryTool appends the lot's name). Land beside no road keeps its 0.
 *
 * The last block checks hover against paint at every cell of a busy town, for both variants: a curb's painted byte is
 * the byte of the road its hover reads, and its hover is that road's own. They stay together if the rule changes.
 */
import { describe, expect, it } from 'vitest';
import { Network, Overlay } from '../../src/core/types';
import type { CityState } from '../../src/sim/CityState';
import { curbRoadOf, markOverlaysDirty, overlayLayer, overlayReadout } from '../../src/sim/infra/overlays';
import { TRAFFIC_OF_STATE } from '../../src/sim/infra/transit';
import { computeOverlayValues } from '../../src/render/world/overlays';
import { newState, place, roadLine, stressCity } from './cityGen';

const CARS = 0, TRUCKS = 1;
const N = 32;
const set = (st: CityState, x: number, z: number, cong: number, trips: number) => {
  const i = z * st.size + x;
  st.congestion[i] = cong;
  st.traffic[i] = trips;
};

/**
 * a 200% road along z = 8 (x 4..27, 2,446 trips/day), an 80% street joining it from the south (x = 12, z 9..14), a free
 * road along z = 20, a rail cell and a pond cell beside the jam, a home on the jam's curb, and roads on the east and the
 * west edge (wrap-around checks)
 */
function town() {
  const st = newState(N);
  roadLine(st, 4, 8, 27, 8, Network.Road);
  roadLine(st, 12, 9, 12, 14, Network.Street);
  roadLine(st, 4, 20, 27, 20, Network.Road);
  roadLine(st, N - 1, 2, N - 1, 5, Network.Road);
  roadLine(st, 0, 24, 0, 27, Network.Road);
  for (let x = 4; x <= 27; x++) { set(st, x, 8, 2, 2446); set(st, x, 20, 0.1, 120); }
  for (let z = 9; z <= 14; z++) set(st, 12, z, 0.8, 300);
  for (let z = 2; z <= 5; z++) set(st, N - 1, z, 1.5, 900);
  for (let z = 24; z <= 27; z++) set(st, 0, z, 1.5, 900);
  st.network[9 * N + 20] = Network.Rail;
  st.water[9 * N + 22] = 1;
  const home = place(st, 't_r1', 16, 9, { pop: 10 });
  return { st, home };
}
const read = (st: CityState, x: number, z: number, v = CARS) => overlayReadout(st, Overlay.Traffic, x, z, v)!;

describe('the Traffic hover on a curb reads the road the view paints there', () => {
  it('a lot beside a 200% road reads 200%, bad, "road beside it" with that road\'s trips; the road reads itself', () => {
    const { st, home } = town();
    for (const [x, z] of [[10, 9], [10, 7], [home.x, home.z], [4, 7], [27, 9]]) {
      expect(read(st, x, z), `${x},${z}`).toEqual({ text: '200%', tone: 'bad', sub: 'road beside it · 2,446 trips/day' });
    }
    // (the home on the curb: painted red under it, and its hover reads the jam too)
    expect(st.building[home.z * N + home.x]).toBe(home.id);
    // the road cell itself: unchanged
    expect(read(st, 10, 8)).toEqual({ text: '200%', tone: 'bad', sub: '2,446 trips/day' });
    // beside the free road: its value (green), and beside the 80% street: Busy
    expect(read(st, 10, 21)).toEqual({ text: '10%', tone: 'good', sub: 'road beside it · 120 trips/day' });
    expect(read(st, 11, 12)).toEqual({ text: '80%', tone: 'warn', sub: 'road beside it · 300 trips/day' });
  });

  it('a lot beside two roads reads the busier one, whichever side it is on', () => {
    const { st } = town();
    // (13, 9): the street to its left (80%), the jam above (200%); (11, 9): the jam above, the street to its right
    expect(read(st, 13, 9).text).toBe('200%');
    expect(read(st, 11, 9).text).toBe('200%');
    expect(curbRoadOf(st, st.congestion, 9 * N + 13)).toBe(8 * N + 13);
    expect(curbRoadOf(st, st.congestion, 9 * N + 11)).toBe(8 * N + 11);
    // the street gets busier than the jam: the corner lots follow it
    set(st, 12, 9, 2.5, 3100);
    expect(read(st, 13, 9)).toEqual({ text: '250%', tone: 'bad', sub: 'road beside it · 3,100 trips/day' });
    expect(read(st, 11, 9).text).toBe('250%');
    // a tie in the layer value goes to the road with more traffic (both 200%: the street's 3,000 trips)
    set(st, 12, 9, 2, 3000);
    expect(read(st, 13, 9)).toEqual({ text: '200%', tone: 'bad', sub: 'road beside it · 3,000 trips/day' });
    // (the same for any layer: equal values, the larger volume; no volume given, the first road found)
    const data = new Float32Array(st.cells), vol = new Float32Array(st.cells);
    data[9 * N + 12] = data[8 * N + 13] = 1;
    vol[9 * N + 12] = 5000;
    vol[8 * N + 13] = 774;
    expect(curbRoadOf(st, data, 9 * N + 13, vol)).toBe(9 * N + 12);
    vol[8 * N + 13] = 6000;
    expect(curbRoadOf(st, data, 9 * N + 13, vol)).toBe(8 * N + 13);
    expect(curbRoadOf(st, data, 9 * N + 13)).toBe(9 * N + 12);
  });

  it('rail, water and land two cells away read 0; land beside rail only is not a curb; map edges do not wrap', () => {
    const { st } = town();
    const zero = { text: '0%', tone: 'good', sub: '0 trips/day' };
    // the rail cell and the pond beside the jam: their own value (no "road beside it")
    expect(read(st, 20, 9)).toEqual(zero);
    expect(read(st, 22, 9)).toEqual(zero);
    // land below the rail cell (rail is no road) and two cells from any road
    for (const [x, z] of [[20, 10], [10, 10], [10, 6], [16, 11], [10, 18], [10, 22]]) expect(read(st, x, z), `${x},${z}`).toEqual(zero);
    // (not land: the cell itself; land beside no road: none)
    expect(curbRoadOf(st, st.congestion, 9 * N + 20)).toBe(9 * N + 20);
    expect(curbRoadOf(st, st.congestion, 9 * N + 22)).toBe(9 * N + 22);
    expect(curbRoadOf(st, st.congestion, 8 * N + 10)).toBe(8 * N + 10);
    expect(curbRoadOf(st, st.congestion, 10 * N + 20)).toBe(-1);
    expect(curbRoadOf(st, st.congestion, 10 * N + 10)).toBe(-1);
    // east edge road (x = N - 1, z 2..5): its curb reads it; the west edge cells of those rows (and around) read 0
    expect(read(st, N - 2, 3).text).toBe('150%');
    for (let z = 0; z <= 7; z++) expect(read(st, 0, z), `0,${z}`).toEqual(zero);
    // west edge road (x = 0, z 24..27): its curb reads it; the east edge cells of those rows (and around) read 0
    expect(read(st, 1, 25).text).toBe('150%');
    for (let z = 22; z <= 29; z++) expect(read(st, N - 1, z), `${N - 1},${z}`).toEqual(zero);
  });

  it('Trucks: a lot reads its busiest road\'s trucks/day; a road without trucks reads "No trucks" with the same note', () => {
    const { st } = town();
    const T = new Float32Array(st.cells);
    for (let x = 4; x <= 27; x++) T[8 * N + x] = 774;
    for (let z = 9; z <= 14; z++) T[z * N + 12] = 120;
    // (the traffic system's truck volumes, as truckVolumeOf reads them)
    TRAFFIC_OF_STATE.set(st, { truckVolume: () => T });
    markOverlaysDirty(st, 'traffic');
    const R = overlayLayer(st, Overlay.Traffic, TRUCKS)!.data;
    const road = read(st, 10, 8, TRUCKS);
    expect(road.text).toBe('774 trucks/day');
    expect(road.sub).not.toMatch(/road beside it/);
    for (const [x, z] of [[10, 9], [10, 7], [13, 9], [11, 9]]) {
      const r = read(st, x, z, TRUCKS);
      expect(r.text, `${x},${z}`).toBe('774 trucks/day');
      expect(r.tone).toBe(road.tone);
      expect(r.sub).toBe(`road beside it · ${road.sub}`);
    }
    // the street's curb (120 trucks/day, below the jam's): its own trucks; the raster picks it, the volume says it
    expect(R[12 * N + 12]).toBeLessThan(R[8 * N + 12]);
    expect(read(st, 11, 12, TRUCKS).text).toBe('120 trucks/day');
    // beside the free road: no trucks on it, said for that road
    expect(read(st, 10, 21, TRUCKS)).toEqual({ text: 'No trucks', tone: '', sub: 'road beside it' });
    // two cells away, rail, water: nothing
    for (const [x, z] of [[10, 10], [20, 9], [22, 9], [20, 10]]) expect(read(st, x, z, TRUCKS), `${x},${z}`).toEqual({ text: 'No trucks', tone: '' });
    // the street becomes the freight route: its corner lots follow it (the busiest by the raster)
    T[9 * N + 12] = 5000;
    markOverlaysDirty(st, 'traffic');
    expect(overlayLayer(st, Overlay.Traffic, TRUCKS)!.data[9 * N + 12]).toBe(1);
    expect(read(st, 13, 9, TRUCKS).text).toBe('5,000 trucks/day');
    expect(read(st, 13, 9, TRUCKS).tone).toBe('bad');
    expect(read(st, 14, 9, TRUCKS).text).toBe('774 trucks/day');
  });
});

describe('hover = paint at every cell (both variants)', () => {
  /** a 96² stress city with random road congestion (ties, saturated jams, free roads) and random truck volumes */
  function busy() {
    const { st } = stressCity(96, 5);
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const T = new Float32Array(st.cells);
    for (let i = 0; i < st.cells; i++) {
      if (!st.network[i]) continue;
      const k = rnd();
      // a quarter saturated (> 120%: equal red bytes), some exactly equal, the rest spread
      st.congestion[i] = k < 0.25 ? 1.2 + rnd() : k < 0.35 ? 0.5 : rnd() * 1.2;
      st.traffic[i] = Math.round(rnd() * 3000);
      T[i] = k < 0.5 ? 0 : Math.round(rnd() * 1500);
    }
    // ponds beside some roads
    for (let i = 0; i < st.cells; i += 37) if (!st.network[i] && st.building[i] < 0) st.water[i] = 1;
    TRAFFIC_OF_STATE.set(st, { truckVolume: () => T });
    markOverlaysDirty(st, 'traffic');
    return { st, T };
  }

  it('a curb\'s painted byte is the byte of the road its hover reads, and its hover is that road\'s own', () => {
    const { st, T } = busy();
    const out = new Uint8Array(st.cells);
    for (const v of [CARS, TRUCKS]) {
      computeOverlayValues(st, Overlay.Traffic, out, v);
      const L = overlayLayer(st, Overlay.Traffic, v)!;
      let curbs = 0, bare = 0;
      for (let i = 0; i < st.cells; i++) {
        if (st.network[i] !== Network.None || st.water[i]) continue;
        const c = curbRoadOf(st, L.data, i, v === TRUCKS ? T : st.traffic);
        const x = i % st.size, z = (i / st.size) | 0;
        const r = read(st, x, z, v);
        if (c < 0) {
          bare++;
          expect(out[i], `${v}: bare land ${x},${z}`).toBe(0);
          expect(r.sub ?? '').not.toMatch(/road beside it/);
          continue;
        }
        curbs++;
        expect(out[i], `${v}: curb ${x},${z}`).toBe(out[c]);
        const own = read(st, c % st.size, (c / st.size) | 0, v);
        expect(r.text).toBe(own.text);
        expect(r.tone).toBe(own.tone);
        expect(r.sub).toBe(own.sub ? `road beside it · ${own.sub}` : 'road beside it');
      }
      expect(curbs).toBeGreaterThan(1000);
      expect(bare).toBeGreaterThan(0);
    }
  });
});
