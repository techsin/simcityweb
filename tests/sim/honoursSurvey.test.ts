/**
 * QA round 2 of T070. B8: the monthly honours survey walks the buildings once and keeps the Large Parks' walking reach
 * between surveys, searching again only the parks whose surroundings changed; it must give the first survey's answers,
 * bit for bit, whatever changed in between (the layers are written here without an event: the survey compares them
 * itself). B5: a setback in an old save's first partial month must not cost the next full month.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevType, Network } from '../../src/core/types';
import { BF, CityState, type Building } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation } from '../../src/sim/Simulation';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { rewardsSystem, type HonoursData } from '../../src/sim/economy/rewards';
import * as catchments from '../../src/sim/infra/catchments';
import { newState, place, roadLine, setRoad } from '../infra/cityGen';

afterEach(() => vi.restoreAllMocks());

function data(st: CityState): HonoursData {
  return (st.systemData.economy as { honours: HonoursData }).honours;
}

/** The first survey (93f635c), kept as the oracle: every Large Park searched afresh, every building looked up by its def. */
function reference(st: CityState): { homes: number; noisyShare: number; parkShare: number } {
  const parks = new Uint8Array(st.cells);
  for (const b of st.buildings.values()) {
    if (b.def !== 'park_large' || b.built < 1 || (b.flags & (BF.Burnt | BF.Abandoned))) continue;
    const n = catchments.reachRaw(st, b.x, b.z, b.w, b.d, getDef('park_large')!.coverage!.radius, 0);
    const { touched, best } = catchments.reachResult();
    for (let i = 0; i < n; i++) if (best[touched[i]] > 0) parks[touched[i]] = 1;
  }
  let homes = 0, noisy = 0, green = 0;
  for (const b of st.buildings.values()) {
    const dev = getDef(b.def)?.devType;
    if (dev === undefined || dev > DevType.R3 || b.pop <= 0 || b.built < 1 || (b.flags & (BF.Burnt | BF.Abandoned))) continue;
    homes++;
    if (b.flags & BF.Noisy) noisy++;
    let reached = false;
    for (let z = b.z; z < b.z + b.d && !reached; z++) for (let x = b.x; x < b.x + b.w; x++) {
      if (parks[z * st.size + x]) { reached = true; break; }
    }
    if (reached) green++;
  }
  return { homes, noisyShare: homes ? noisy / homes : 1, parkShare: homes ? green / homes : 0 };
}

const survey = (st: CityState) => ({ homes: data(st).homes, noisyShare: data(st).noisyShare, parkShare: data(st).parkShare });
/** the four neighbours of (50, 9) */
const MOAT = [[49, 9], [51, 9], [50, 8], [50, 10]] as const;

/**
 * A 64-cell town: roads every 8 cells (streets one way, roads the other), an avenue, and a rail line and a highway that
 * walking cannot cross; homes of one and four cells all over it (some empty, unfinished, noisy, abandoned or burnt),
 * shops with residents on paper, and four Large Parks, one unfinished and one burnt.
 */
function town(): { st: CityState; parks: Building[]; homes: Building[] } {
  const st = newState(64);
  for (let k = 4; k < 64; k += 8) {
    roadLine(st, 0, k, 63, k, Network.Road);
    roadLine(st, k, 0, k, 63, Network.Street);
  }
  roadLine(st, 0, 28, 63, 28, Network.Avenue);
  roadLine(st, 36, 0, 36, 63, Network.Rail);
  roadLine(st, 0, 44, 63, 44, Network.Highway);
  const free = (x: number, z: number, w: number, d: number) => {
    for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) {
      if (xx >= 64 || zz >= 64 || st.network[st.idx(xx, zz)] || st.building[st.idx(xx, zz)] >= 0) return false;
    }
    return true;
  };
  const parks = [
    place(st, 'park_large', 13, 13, { flags: BF.Plopped }),
    place(st, 'park_large', 45, 5, { flags: BF.Plopped }),
    place(st, 'park_large', 21, 53, { flags: BF.Plopped, built: 0.5 }),
    place(st, 'park_large', 53, 37, { flags: BF.Plopped | BF.Burnt }),
  ];
  const homes: Building[] = [];
  let n = 0;
  for (let z = 0; z < 63; z += 2) for (let x = 0; x < 63; x += 3, n++) {
    const big = n % 7 === 0;
    if (!free(x, z, big ? 2 : 1, big ? 2 : 1)) continue;
    if (n % 11 === 0) { place(st, 't_cs', x, z, { pop: 9 }); continue; } // residents on paper: never a home
    homes.push(place(st, big ? 't_r3' : n % 2 ? 't_r1' : 't_r2', x, z, {
      pop: n % 13 === 0 ? 0 : 5 + (n % 9), built: n % 17 === 0 ? 0.6 : 1,
      flags: (n % 5 === 0 ? BF.Noisy : 0) | (n % 19 === 0 ? BF.Abandoned : 0) | (n % 23 === 0 ? BF.Burnt : 0),
    }));
  }
  return { st, parks, homes };
}

function start(st: CityState) {
  const rewards = rewardsSystem(new EconRuntime());
  const sim = new Simulation(st, [rewards]);
  return { sim, rewards };
}

describe('QA round 2, B8: the survey keeps the first survey\'s answers', () => {
  it('surveys the town at load as the first survey did', () => {
    const { st } = town();
    start(st);
    const ref = reference(st);
    expect(ref.homes).toBeGreaterThan(250);
    expect(ref.noisyShare).toBeGreaterThan(0.1);
    expect(ref.parkShare).toBeGreaterThan(0.05);
    expect(ref.parkShare).toBeLessThan(0.3);
    expect(survey(st)).toEqual(ref);
  });

  it('follows every kind of change between two monthly checks, with no event to announce it', () => {
    const { st, parks, homes } = town();
    const { sim } = start(st);
    const steps: [string, () => void][] = [
      ['nothing', () => undefined],
      ['residents move, noise comes and goes', () => {
        for (let k = 0; k < homes.length; k += 3) { homes[k].pop = k % 2 ? 0 : 7; homes[k].flags ^= BF.Noisy; }
      }],
      ['a home built without an event', () => { place(st, 't_r1', 18, 13, { pop: 4 }); }],
      ['a home finished, one abandoned, one burnt down', () => {
        homes.find((b) => b.built < 1)!.built = 1;
        homes[10].flags |= BF.Abandoned;
        homes[20].flags |= BF.Burnt;
      }],
      ['a home demolished', () => { st.buildings.delete(homes[30].id); }],
      ['a road removed beside a park', () => { st.network[st.idx(12, 14)] = Network.None; }],
      ['that road rebuilt as an avenue', () => { setRoad(st, 12, 14, Network.Avenue); }],
      ['a street into a block', () => { roadLine(st, 17, 17, 17, 19, Network.Street); }],
      ['a highway across the reach', () => { roadLine(st, 8, 12, 11, 12, Network.Highway); }],
      ['a crossing through the rail line', () => { setRoad(st, 36, 4, Network.Road); }],
      ['water inside a park\'s near field', () => { st.water[st.idx(13, 18)] = 1; st.water[st.idx(14, 18)] = 1; }],
      ['that water filled in', () => { st.water[st.idx(13, 18)] = 0; st.water[st.idx(14, 18)] = 0; }],
      // (50, 9) is two cells from the second park and beside no road: only the park's near field reaches it
      ['a home beside a park, away from the roads', () => { place(st, 't_r1', 50, 9, { pop: 5 }); }],
      ['a moat around that home', () => { for (const [x, z] of MOAT) st.water[st.idx(x, z)] = 1; }],
      ['the moat filled in', () => { for (const [x, z] of MOAT) st.water[st.idx(x, z)] = 0; }],
      ['the unfinished park opens', () => { parks[2].built = 1; }],
      ['a park burns down', () => { parks[0].flags |= BF.Burnt; }],
      ['its ruin is rebuilt', () => { parks[0].flags &= ~BF.Burnt; }],
      ['a park is abandoned', () => { parks[1].flags |= BF.Abandoned; }],
      ['a park is bulldozed', () => { st.buildings.delete(parks[1].id); }],
      ['a new park without an event', () => { place(st, 'park_large', 5, 37, { flags: BF.Plopped }); }],
      ['every park gone', () => { for (const b of [...st.buildings.values()]) if (b.def === 'park_large') st.buildings.delete(b.id); }],
      ['a park again', () => { place(st, 'park_large', 45, 13, { flags: BF.Plopped }); }],
      ['that park bulldozed and another built across the rail line in the same month', () => {
        for (const b of [...st.buildings.values()]) if (b.def === 'park_large') st.buildings.delete(b.id);
        place(st, 'park_large', 5, 13, { flags: BF.Plopped });
      }],
    ];
    const seen = new Set<string>(), at: Record<string, ReturnType<typeof reference>> = {};
    for (const [name, change] of steps) {
      change();
      sim.runDays(30);
      const ref = at[name] = reference(st);
      expect(survey(st), name).toEqual(ref);
      expect(ref.parkShare, name).toBeLessThan(0.3);
      seen.add(JSON.stringify(ref));
    }
    expect(st.unlocked.has('honour_green_belt')).toBe(false);
    // (the steps are not all no-ops for the survey: most of them move one of its three numbers)
    expect(seen.size).toBeGreaterThanOrEqual(10);
    // the network and the water are part of the answer, not only of the bookkeeping: the highway cut homes off ...
    expect(at['a highway across the reach'].parkShare).toBeLessThan(at['a street into a block'].parkShare);
    expect(at['a crossing through the rail line'].parkShare).toBeGreaterThan(at['a highway across the reach'].parkShare);
    // ... and the moat cut off the one home inside it
    const inReach = (name: string) => Math.round(at[name].parkShare * at[name].homes);
    expect(at['a moat around that home'].homes).toBe(at['a home beside a park, away from the roads'].homes);
    expect(inReach('a moat around that home')).toBe(inReach('a home beside a park, away from the roads') - 1);
    expect(inReach('the moat filled in')).toBe(inReach('a home beside a park, away from the roads'));
  });

  it('searches the parks again only when a park, the network or the water changed', () => {
    const { st, parks, homes } = town();
    const reach = vi.spyOn(catchments, 'reachRaw');
    const { sim } = start(st);
    expect(reach).toHaveBeenCalledTimes(2); // the two standing parks, at load
    const searches = (change: () => void): number => {
      const before = reach.mock.calls.length;
      change();
      sim.runDays(30);
      const n = reach.mock.calls.length - before;
      expect(survey(st)).toEqual(reference(st));
      return n;
    };
    expect(searches(() => undefined)).toBe(0);
    expect(searches(() => { homes[0].pop = 0; homes[1].flags ^= BF.Noisy; place(st, 't_r2', 18, 13, { pop: 4 }); })).toBe(0);
    expect(searches(() => { st.zone[st.idx(19, 13)] = 1; st.trees[st.idx(19, 15)] = 3; st.heights[5] = 9; })).toBe(0);
    // (a street, then water, beside the first park: it alone is searched again; the rail line keeps the two reaches apart)
    expect(searches(() => { roadLine(st, 17, 17, 17, 19, Network.Street); })).toBe(1);
    expect(searches(() => undefined)).toBe(0);
    expect(searches(() => { st.water[st.idx(14, 18)] = 1; })).toBe(1);
    // (a cell changed beside each of them)
    expect(searches(() => { setRoad(st, 12, 14, Network.Avenue); setRoad(st, 44, 6, Network.Avenue); })).toBe(2);
    // (the far corner of the map: no standing park reads a cell there)
    expect(searches(() => { st.water[st.idx(60, 60)] = 1; setRoad(st, 61, 58, Network.Road); })).toBe(0);
    expect(searches(() => { parks[2].built = 1; })).toBe(3);
    expect(searches(() => { parks[0].flags |= BF.Burnt; })).toBe(2);
    expect(searches(() => undefined)).toBe(0);
    expect(searches(() => { for (const b of parks) st.buildings.delete(b.id); })).toBe(0);
    // (no park: nothing to search, whatever the roads do)
    expect(searches(() => { setRoad(st, 17, 16, Network.Street); })).toBe(0);
    const park = place(st, 'park_large', 45, 13, { flags: BF.Plopped });
    expect(searches(() => undefined)).toBe(1);
    // (as many parks as before, but not the same ones)
    expect(searches(() => { st.buildings.delete(park.id); place(st, 'park_large', 5, 13, { flags: BF.Plopped }); })).toBe(1);
    expect(searches(() => undefined)).toBe(0);
  });

  it('searches only the parks whose surroundings changed', () => {
    const st = newState(128);
    for (let k = 4; k < 128; k += 8) {
      roadLine(st, 0, k, 127, k, Network.Road);
      roadLine(st, k, 0, k, 127, Network.Street);
    }
    // one park alone in a corner; two more in the opposite one, close enough for their reaches to cross
    for (const [x, z] of [[13, 13], [101, 101], [109, 85]]) place(st, 'park_large', x, z, { flags: BF.Plopped });
    for (let z = 1; z < 127; z += 2) for (let x = 1; x < 127; x += 2) {
      if (!st.network[st.idx(x, z)] && st.building[st.idx(x, z)] < 0) place(st, 't_r1', x, z, { pop: 3 });
    }
    const reach = vi.spyOn(catchments, 'reachRaw');
    const { sim } = start(st);
    expect(reach).toHaveBeenCalledTimes(3);
    /** the lots (their x) the survey searched after `change`, in order */
    const lots = (change: () => void): number[] => {
      const before = reach.mock.calls.length;
      change();
      sim.runDays(30);
      const xs = reach.mock.calls.slice(before).map((c) => c[1] as number);
      expect(survey(st)).toEqual(reference(st));
      return xs;
    };
    expect(reference(st).parkShare).toBeGreaterThan(0.02);
    expect(lots(() => undefined)).toEqual([]);
    // a street cell beside the lone park: that park alone
    expect(lots(() => { st.network[st.idx(12, 14)] = Network.None; })).toEqual([13]);
    // a road between the two neighbours: both
    expect(lots(() => { setRoad(st, 100, 95, Network.Avenue); })).toEqual([101, 109]);
    // a street north of the third park, out of the second's surroundings: the third is searched, and the second marks
    // again the cells of its own reach that the third's cleared surroundings took with them
    expect(lots(() => { setRoad(st, 110, 70, Network.Street); })).toEqual([101, 109]);
    // the middle of the map, and water in the empty corner: nobody's surroundings
    expect(lots(() => { setRoad(st, 62, 62, Network.Road); st.water[st.idx(120, 10)] = 1; })).toEqual([]);
    expect(lots(() => undefined)).toEqual([]);
  });

  it.each(['x', 'z'] as const)('follows the far ends of a reach when its one street (along %s) is cut, shortened and rebuilt', (axis) => {
    // a Large Park at (30..33, 30..33) and one street past it, 56 cells long: walking reaches 18 cells of it each way
    const st = newState(64);
    const cell = (along: number, across: number): [number, number] => (axis === 'x' ? [along, across] : [across, along]);
    const road = (along: number, type: Network) => { const [x, z] = cell(along, 29); st.network[st.idx(x, z)] = type; };
    for (let t = 4; t <= 60; t++) road(t, Network.Street);
    place(st, 'park_large', 30, 30, { flags: BF.Plopped });
    // homes on both sides of the street at its last reached cells (11 and 52), one cell nearer and one cell too far
    const ends = [10, 11, 12, 51, 52, 53];
    for (const t of ends) for (const side of [28, 30]) { const [x, z] = cell(t, side); place(st, 't_r1', x, z, { pop: 2 }); }
    // (and twenty homes far from both: eight in reach of thirty-two leaves Green Belt unearned, its share surveyed)
    for (let k = 0; k < 20; k++) { const [x, z] = cell(2 + 2 * k, 60); place(st, 't_r2', x, z, { pop: 2 }); }
    const reach = vi.spyOn(catchments, 'reachRaw');
    const { sim } = start(st);
    /** the homes in reach, by the survey, after `change` and a month (checked against the first survey's) */
    const reached = (change: () => void): number => {
      change();
      sim.runDays(30);
      const ref = reference(st);
      expect(survey(st)).toEqual(ref);
      expect(ref.homes).toBe(32);
      return Math.round(data(st).parkShare * 32);
    };
    expect(reached(() => undefined)).toBe(8); // the homes at 11, 12, 51 and 52
    const before = reach.mock.calls.length;
    // the street cut on both sides of the park: nothing of the far ends is left
    expect(reached(() => { road(27, Network.None); road(36, Network.None); })).toBe(0);
    expect(reached(() => { road(27, Network.Street); road(36, Network.Street); })).toBe(8);
    // the cell whose mark covers the last homes, removed and put back as an avenue (a slower walk: one cell less)
    expect(reached(() => { road(12, Network.None); })).toBe(6);
    expect(reached(() => { road(12, Network.Avenue); })).toBe(6);
    expect(reached(() => { road(12, Network.Street); road(51, Network.None); })).toBe(6);
    expect(reached(() => { road(51, Network.Street); })).toBe(8);
    // (six months with a change beside the reach, six searches of the one park; the oracle's own are not counted)
    expect(reach.mock.calls.length - before - 6 * 1).toBe(6);
    // past the ends, the street can do what it likes
    const quiet = reach.mock.calls.length;
    expect(reached(() => { road(57, Network.None); road(6, Network.Highway); })).toBe(8);
    expect(reach.mock.calls.length - quiet).toBe(1);
  });

  it.each([5, 17, 41])('keeps a fresh search\'s cells when single cells change at any distance from a park (every free cell a home, seed %i)', (seed) => {
    const st = newState(64);
    let s = seed >>> 0;
    const rnd = (n: number) => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
    };
    // broken road lines every six cells, a Large Park in the middle, and a home on every other cell: a cell that
    // enters or leaves the park's reach is a home counted or not
    for (let k = 3; k < 64; k += 6) for (let t = 0; t < 64; t++) {
      if (rnd(6)) setRoad(st, t, k, rnd(8) ? Network.Road : Network.Avenue);
      if (rnd(6)) setRoad(st, k, t, Network.Street);
    }
    for (let z = 30; z < 34; z++) for (let x = 30; x < 34; x++) st.network[st.idx(x, z)] = Network.None;
    place(st, 'park_large', 30, 30, { flags: BF.Plopped });
    const homeAt = new Map<number, Building>();
    for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) {
      const i = st.idx(x, z);
      if (!st.network[i] && st.building[i] < 0) homeAt.set(i, place(st, 't_r1', x, z, { pop: 1 }));
    }
    const reach = vi.spyOn(catchments, 'reachRaw');
    const { sim } = start(st);
    let near = 0, far = 0, moved = 0, last = JSON.stringify(reference(st));
    for (let month = 0; month < 90; month++) {
      // (two edits in three within a dozen cells of the lot, the others anywhere)
      const close = rnd(3) > 0;
      const x = close ? 18 + rnd(28) : rnd(64), z = close ? 18 + rnd(28) : rnd(64), i = st.idx(x, z);
      const dist = Math.max(30 - x, x - 33, 30 - z, z - 33, 0);
      if (!dist) continue; // (the park's own lot)
      if (rnd(4) === 0) st.water[i] ^= 1;
      else if (st.network[i]) {
        st.network[i] = Network.None;
        homeAt.set(i, place(st, 't_r1', x, z, { pop: 1 }));
      } else {
        const home = homeAt.get(i);
        if (home) st.buildings.delete(home.id);
        homeAt.delete(i);
        st.network[i] = 1 + rnd(6);
      }
      st.unlocked.delete('honour_green_belt');
      const calls = reach.mock.calls.length;
      sim.runDays(30);
      const searches = reach.mock.calls.length - calls;
      const ref = reference(st);
      expect(survey(st), `month ${month}: (${x}, ${z}), ${dist} cells from the park`).toEqual(ref);
      if (JSON.stringify(ref) !== last) moved++;
      last = JSON.stringify(ref);
      // a 14-cell walking radius marks no cell further than 20 from the lot: beyond that (and two cells) nothing is
      // searched; nearer, the park is searched again whenever the change is in or beside the cells it reaches
      expect(searches).toBeLessThanOrEqual(1);
      if (dist <= 3) expect(searches, `beside the lot, month ${month}`).toBe(1);
      if (dist >= 25) { expect(searches, `far, month ${month}`).toBe(0); far++; }
      near += searches;
    }
    expect(near).toBeGreaterThan(25);
    expect(far).toBeGreaterThan(3);
    expect(moved).toBeGreaterThan(45);
  });

  it.each([3, 11, 29])('agrees with the first survey through sixty months of random edits (seed %i)', (seed) => {
    const { st } = town();
    const reach = vi.spyOn(catchments, 'reachRaw');
    const { sim } = start(st);
    let s = seed >>> 0;
    const rnd = (n: number) => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
    };
    const pick = () => { const all = [...st.buildings.values()]; return all[rnd(all.length)]; };
    let moved = 0, searched = 0, last = '';
    for (let month = 0; month < 60; month++) {
      for (let k = rnd(7); k > 0; k--) {
        const x = rnd(64), z = rnd(64), i = st.idx(x, z), b = pick();
        switch (rnd(9)) {
          case 0: if (st.building[i] < 0) st.network[i] = rnd(7); break;
          case 1: st.network[i] = Network.None; break;
          case 2: if (st.building[i] < 0 && !st.network[i]) st.water[i] ^= 1; break;
          case 3: if (b) b.pop = rnd(3) ? 6 : 0; break;
          case 4: if (b) b.flags ^= [BF.Noisy, BF.Abandoned, BF.Burnt][rnd(3)]; break;
          case 5: if (b) b.built = rnd(4) ? 1 : 0.5; break;
          case 6: if (b && rnd(3) === 0) st.buildings.delete(b.id); break;
          case 7: if (x < 60 && z < 60 && rnd(3) === 0) place(st, 'park_large', x, z, { flags: BF.Plopped }); break;
          default: if (st.building[i] < 0 && !st.network[i]) place(st, rnd(2) ? 't_r1' : 't_cs', x, z, { pop: 3 });
        }
      }
      // (Green Belt stays out of reach: its share is surveyed in every one of the sixty months)
      st.unlocked.delete('honour_green_belt');
      const calls = reach.mock.calls.length;
      sim.runDays(30);
      if (reach.mock.calls.length > calls) searched++;
      const ref = reference(st);
      expect(survey(st), `month ${month}`).toEqual(ref);
      if (JSON.stringify(ref) !== last) moved++;
      last = JSON.stringify(ref);
    }
    expect(moved).toBeGreaterThan(15);
    // (months of both kinds: the reach searched again, and the kept one used)
    expect(searched).toBeGreaterThan(10);
    expect(60 - searched).toBeGreaterThan(10);
  });

  it('stops surveying the park share, and lets the reach go, once Green Belt is earned', () => {
    const { st, parks, homes } = town();
    const reach = vi.spyOn(catchments, 'reachRaw');
    const { sim } = start(st);
    // most homes away from the two standing parks are demolished: the parks' neighbours become a third of the rest or more
    const beside = (b: Building) => parks.slice(0, 2).some((p) => b.x >= p.x - 3 && b.x <= p.x + 6 && b.z >= p.z - 3 && b.z <= p.z + 6);
    for (const b of homes) if (!beside(b) && b.id % 20) st.buildings.delete(b.id);
    sim.runDays(30);
    const earned = reference(st);
    expect(earned.homes).toBeGreaterThan(20);
    expect(earned.parkShare).toBeGreaterThanOrEqual(0.3);
    expect(earned.parkShare).toBeLessThan(1);
    expect(survey(st)).toEqual(earned);
    expect(st.unlocked.has('honour_green_belt')).toBe(true);
    const calls = reach.mock.calls.length;
    roadLine(st, 17, 17, 17, 19, Network.Street);
    place(st, 'park_large', 5, 37, { flags: BF.Plopped });
    homes.find((b) => st.buildings.has(b.id) && b.pop > 0 && b.built >= 1 && !(b.flags & (BF.Abandoned | BF.Burnt)))!.pop = 0;
    sim.runDays(30);
    expect(reach.mock.calls.length).toBe(calls);
    const later = reference(st);
    expect(later.homes).toBe(earned.homes - 1);
    expect({ homes: data(st).homes, noisyShare: data(st).noisyShare }).toEqual({ homes: later.homes, noisyShare: later.noisyShare });
    expect(data(st).parkShare).toBe(earned.parkShare);
  });

  it('searches a city loaded into the same simulation afresh', () => {
    const a = town(), b = town();
    for (const p of b.parks) b.st.buildings.delete(p.id);
    place(b.st, 'park_large', 5, 53, { flags: BF.Plopped });
    const { sim } = start(a.st);
    sim.runDays(30);
    sim.replaceState(b.st);
    expect(survey(b.st)).toEqual(reference(b.st));
    expect(survey(b.st)).not.toEqual(survey(a.st));
    sim.runDays(30);
    expect(survey(b.st)).toEqual(reference(b.st));
  });

  it('draws no random number and leaves the layers it compares alone', () => {
    const { st } = town();
    const { sim } = start(st);
    const network = st.network.slice(), water = st.water.slice(), rng = sim.rng.state;
    const draw = vi.spyOn(sim.rng, 'next');
    setRoad(st, 17, 13, Network.Street);
    network[st.idx(17, 13)] = Network.Street;
    sim.runDays(90);
    expect(draw).not.toHaveBeenCalled();
    expect(sim.rng.state).toBe(rng);
    expect(st.network).toEqual(network);
    expect(st.water).toEqual(water);
  });
});

function oldSave(day: number) {
  const st = new CityState(defaultCityConfig({ size: 32, seed: 7, terrain: 'flat', disasters: false }));
  Object.assign(st.stats, { population: 500000, avgAir: 0.10, unemployment: 0.03 });
  st.day = day;
  const b: Building = {
    id: st.nextBuildingId++, def: 'res_cottage.r1.2', pop: 1, built: 1, flags: 0, x: 8, z: 8, w: 1, d: 1, rot: 0, variant: 0,
    jobs: 0, capacity: 10, wealth: 1, age: 1, baseY: 0, health: 1, unhappy: 0,
  };
  st.buildings.set(b.id, b);
  return { st, ...start(st) };
}

const SETBACKS = [
  ['cleanAir', (st: CityState) => { st.stats.avgAir = 0.100001; }, (st: CityState) => { st.stats.avgAir = 0.10; }],
  ['safeCity', (st: CityState) => { st.stats.emergency.month.failed = 1; }, (st: CityState) => { st.stats.emergency.month.failed = 0; }],
  ['employment', (st: CityState) => { st.stats.unemployment = 0.030001; }, (st: CityState) => { st.stats.unemployment = 0.03; }],
  ['books', (st: CityState) => { st.budget.taxRates[0] = 9.5; }, (st: CityState) => { st.budget.taxRates[0] = 9; }],
] as const;

describe('QA round 2, B5: an old save\'s first partial month', () => {
  it.each(SETBACKS)('%s: a setback inside it does not cost the next full month', (key, setback, recover) => {
    const { st, sim } = oldSave(12);
    setback(st);
    sim.runDays(2);
    expect(data(st)[`${key}Interrupted`]).toBe(true);
    recover(st);
    sim.runDays(16);
    expect(st.day).toBe(30);
    expect(data(st)[key]).toBe(0);
    expect(data(st)[`${key}Interrupted`]).toBe(false);
    sim.runDays(30);
    expect(data(st)[key]).toBe(1);
    sim.runDays(30);
    expect(data(st)[key]).toBe(2);
  });

  it.each(SETBACKS)('%s: a setback in the first full month still costs that month', (key, setback, recover) => {
    const { st, sim } = oldSave(12);
    sim.runDays(18);
    setback(st);
    sim.runDays(2);
    recover(st);
    sim.runDays(28);
    expect(st.day).toBe(60);
    expect(data(st)[key]).toBe(0);
    for (const [other] of SETBACKS) if (other !== key) expect(data(st)[other]).toBe(1);
    sim.runDays(30);
    expect(data(st)[key]).toBe(1);
  });

  it('a setback on the day the partial month closes belongs to it', () => {
    const { st, sim } = oldSave(12);
    sim.runDays(17);
    st.budget.taxRates[0] = 9.5;
    sim.runDays(1);
    expect(st.day).toBe(30);
    expect(data(st).booksInterrupted).toBe(false);
    st.budget.taxRates[0] = 9;
    sim.runDays(30);
    expect(data(st).books).toBe(1);
  });

  it('a check repeated inside a month keeps that month\'s setbacks', () => {
    const { st, sim, rewards } = oldSave(0);
    sim.runDays(40);
    st.budget.taxRates[0] = 9.5;
    sim.runDays(1);
    st.budget.taxRates[0] = 9;
    rewards.monthly!(sim);
    expect(data(st).booksInterrupted).toBe(true);
    sim.runDays(19);
    expect(st.day).toBe(60);
    expect(data(st).books).toBe(0);
    expect(data(st).cleanAir).toBe(2);
  });
});
