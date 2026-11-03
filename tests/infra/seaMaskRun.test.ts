/**
 * B2 G4: terrainMasks.SeaMaskRun (the sea mask in pieces for the utilities pass) = terrainMasks.seaMask (build() in one
 * call): the sea mask, the shore cells, the depth, the sea cell count and the cache it leaves, at every piece size, on
 * generated terrains (coast, islands, river, lakes) and synthetic water layers (none, all water, noise, a sea + a lake);
 * the cache hit; a water edit between two pieces; another caller's rebuild between two pieces.
 */
import { describe, expect, it } from 'vitest';
import { RNG } from '../../src/core/rng';
import type { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { createCityState } from '../../src/sim/terrainGen';
import { SeaMaskRun, cachedMasksForTest, seaCellCount, seaMask, shoreCells, waterDepth } from '../../src/sim/infra/terrainMasks';
import { newState } from './cityGen';

type Kind = 'coast' | 'islands' | 'river' | 'lakes' | 'none' | 'all' | 'noise' | 'seaLake';
function mkState(kind: Kind, size: number, seed: number): CityState {
  if (kind === 'coast' || kind === 'islands' || kind === 'river' || kind === 'lakes') {
    return createCityState(defaultCityConfig({ size, seed, terrain: kind, waterAmount: 0.35 }));
  }
  const st = newState(size), N = st.size, rng = new RNG(seed);
  if (kind === 'all') st.water.fill(1);
  if (kind === 'noise') for (let i = 0; i < st.cells; i++) st.water[i] = rng.next() < 0.45 ? 1 : 0;
  if (kind === 'seaLake') {
    for (let z = 0; z < N; z++) for (let x = 0; x < (N >> 2); x++) st.water[z * N + x] = 1;
    for (let z = N >> 1; z < (N >> 1) + 6; z++) for (let x = N - 12; x < N - 6; x++) st.water[z * N + x] = 1;
  }
  return st;
}

/** a copy of the city's water layer in a new state (its own cache entry) */
function twin(st: CityState): CityState {
  const t = newState(st.size);
  t.water.set(st.water);
  return t;
}

/** everything the masks hold, as plain arrays */
function masksOf(st: CityState): unknown {
  const c = cachedMasksForTest(st);
  expect(c, 'a cache entry').toBeDefined();
  return { sea: Array.from(c!.sea), shore: Array.from(c!.shore), depth: Array.from(c!.depth), seaCells: c!.seaCells, sum: c!.sum, count: c!.count };
}

/** the run to its end at `units` per piece; the pieces taken */
function runAll(r: SeaMaskRun, st: CityState, units: number | (() => number), between?: (k: number) => void): { sea: Uint8Array; pieces: number } {
  for (let k = 1; k < 1e7; k++) {
    const m = r.run(st, typeof units === 'number' ? units : units());
    if (m) return { sea: m, pieces: k };
    between?.(k);
  }
  throw new Error('the run did not end');
}

describe('B2 G4 SeaMaskRun = seaMask (build() in one call)', () => {
  const cases: [Kind, number, number][] = [
    ['coast', 96, 3], ['islands', 96, 5], ['river', 80, 7], ['lakes', 64, 11], ['none', 40, 1], ['all', 48, 2], ['noise', 56, 13], ['seaLake', 72, 17],
  ];
  for (const [kind, size, seed] of cases) {
    it(`${kind} ${size}: the same masks and cache at every piece size (a miss, then a hit)`, () => {
      const ref = mkState(kind, size, seed);
      const refSea = seaMask(ref);
      const want = masksOf(ref);
      // (the sea marking runs on these; rivers and lakes stay fresh)
      if (kind === 'coast' || kind === 'islands' || kind === 'all' || kind === 'seaLake') expect(seaCellCount(ref), 'sea cells').toBeGreaterThan(0);
      if (kind === 'river' || kind === 'lakes' || kind === 'seaLake') expect(ref.water.some((w, i) => w && !refSea[i]), 'fresh water').toBe(true);
      expect(shoreCells(ref)).toBe(cachedMasksForTest(ref)!.shore);
      for (const units of [1, 3, 17, 256, 5000, 1e9]) {
        const st = twin(ref), r = new SeaMaskRun();
        const { sea, pieces } = runAll(r, st, units);
        expect(Array.from(sea), `${kind} units ${units}`).toEqual(Array.from(refSea));
        expect(masksOf(st), `${kind} units ${units}: the cache`).toEqual(want);
        expect(seaMask(st), 'seaMask then hits the installed entry').toBe(sea);
        expect(seaCellCount(st)).toBe(seaCellCount(ref));
        expect(Array.from(waterDepth(st))).toEqual(Array.from(waterDepth(ref)));
        if (units === 1) expect(pieces).toBeGreaterThan(st.cells);
        // (the run is idle again: a second run is a checksum, then the cached mask itself)
        const again = runAll(r, st, units);
        expect(again.sea).toBe(sea);
        expect(r.phaseName).toBe('sum');
      }
      // (random piece sizes)
      const rng = new RNG(seed * 31 + 1), st = twin(ref);
      expect(Array.from(runAll(new SeaMaskRun(), st, () => rng.int(1, 400)).sea)).toEqual(Array.from(refSea));
      expect(masksOf(st)).toEqual(want);
    });
  }

  it('a water edit after the masks were built: the checksum misses and the run rebuilds them, as seaMask does', () => {
    const st = mkState('coast', 96, 23), N = st.size;
    const r = new SeaMaskRun();
    runAll(r, st, 200);
    for (let z = 40; z < 52; z++) for (let x = 30; x < 70; x++) st.water[z * N + x] ^= 1;
    const names: string[] = [];
    const { sea } = runAll(r, st, 200, () => names.push(r.phaseName));
    expect(new Set(names)).toEqual(new Set(['sum', 'copy', 'scan', 'depth', 'fix', 'comp']));
    const ref = twin(st);
    expect(Array.from(sea)).toEqual(Array.from(seaMask(ref)));
    expect(masksOf(st)).toEqual(masksOf(ref));
  });

  it('a water edit between two pieces of a rebuild: the masks are those of the water at the copy; the next run rebuilds', () => {
    const st = mkState('islands', 80, 29), N = st.size;
    const atCopy = twin(st);
    let edited = false;
    const r = new SeaMaskRun();
    const { sea } = runAll(r, st, 300, () => {
      if (!edited && r.phaseName === 'depth') {
        edited = true;
        for (let z = 10; z < 20; z++) for (let x = 10; x < 60; x++) st.water[z * N + x] ^= 1;
      }
    });
    expect(edited).toBe(true);
    expect(Array.from(sea)).toEqual(Array.from(seaMask(atCopy)));
    // (the entry holds the copy's checksum: the next run misses and rebuilds for the edited water)
    const now = twin(st);
    const again = runAll(r, st, 300);
    expect(Array.from(again.sea)).toEqual(Array.from(seaMask(now)));
    expect(masksOf(st)).toEqual(masksOf(now));
  });

  it('another caller rebuilds the cache between two pieces: the run keeps that entry and still returns its own mask', () => {
    const st = mkState('lakes', 64, 31);
    const r = new SeaMaskRun();
    let other: Uint8Array | null = null;
    const { sea } = runAll(r, st, 100, () => { if (!other && r.phaseName === 'comp') other = seaMask(st); });
    expect(other).not.toBeNull();
    expect(cachedMasksForTest(st)!.sea).toBe(other);
    expect(Array.from(sea)).toEqual(Array.from(other!));
  });
});
