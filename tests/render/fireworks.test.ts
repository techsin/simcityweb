/** R2: event-maintained launch sites must match the full scan exactly, including Map-order ties. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CELL_SIZE } from '../../src/core/constants';
import { RNG } from '../../src/core/rng';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { placeBuilding, removeBuilding } from '../../src/sim/economy/buildings';
import { CityObjectsView } from '../../src/render/city/CityObjectsView';
import { collectLaunchSites, LaunchSiteIndex, type LaunchSite, type SiteSource } from '../../src/render/city/effects/Fireworks';
import { DEFAULT_FIXTURES } from '../../tools/bench/fixturePaths';
import { loadCity } from '../../tools/bench/roadTransitSearch/fixtures';
import { newState } from '../infra/cityGen';
import { fireworksSiteSource } from './fireworksHarness';

type Lot = Pick<Building, 'x' | 'z' | 'w' | 'd'>;
const DEFS = ['park_small', 'park_plaza', 'park_stadium', 'lm_clock_tower', 'lm_obelisk', 'res_tower.r2.7', 'missing_def'];

function building(st: CityState, lot: Lot, def = 'res_tower.r2.7'): Building {
  return { id: st.nextBuildingId++, def, ...lot, rot: 0, variant: 0, pop: 20, jobs: 10, capacity: 100,
    wealth: 1, built: 1, age: 100, flags: 0, baseY: 5, health: 1, unhappy: 0 };
}

function grid(st: CityState, b: Building, add: boolean): void {
  for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = z * st.size + x;
    if (add) st.building[i] = b.id;
    else if (st.building[i] === b.id) st.building[i] = -1;
  }
}

function rig(st: CityState) {
  const sim = new Simulation(st), src = fireworksSiteSource(st), index = new LaunchSiteIndex(src);
  const abort = new AbortController();
  const offs = [
    sim.events.on('buildingAdded', (b) => index.update(b, src)),
    sim.events.on('buildingRemoved', (b) => index.remove(b.id)),
    sim.events.on('buildingChanged', (b) => index.update(b, src)),
  ];
  abort.signal.addEventListener('abort', () => { for (const off of offs) off(); index.clear(); }, { once: true });
  return { sim, src, index, dispose: () => abort.abort('dispose') };
}

function generatedCity(seed: number): CityState {
  const st = newState(64), rng = new RNG(seed);
  for (let z = 0; z < st.size; z++) for (let x = 0; x < st.size; x++) {
    st.water[z * st.size + x] = x < 7 || z < 7 ? 1 : 0;
    if (x >= 7 && z >= 7 && (x % 6 === 1 || z % 6 === 1)) st.network[z * st.size + x] = 2;
  }
  for (let z = 8; z < 58; z += 6) for (let x = 8; x < 58; x += 6) {
    const b = building(st, { x, z, w: 4, d: 4 }, rng.pick(DEFS));
    b.pop = rng.int(0, 500); b.jobs = rng.int(0, 200); b.capacity = rng.int(0, 400); b.variant = rng.int(0, 3);
    st.buildings.set(b.id, b); grid(st, b, true);
  }
  return st;
}

function randomEdits(st: CityState, seed: number, steps: number): void {
  const r = rig(st), rng = new RNG(seed), free: Lot[] = [];
  const ids = [...st.buildings.keys()];
  const lots = new Map(ids.map((id) => { const b = st.buildings.get(id)!; return [id, { x: b.x, z: b.z, w: b.w, d: b.d }] as const; }));
  const same = (step: number) => expect(r.index.collect(r.src), `seed ${seed}, edit ${step}`).toStrictEqual(collectLaunchSites(r.src));
  try {
    same(-1);
    for (let step = 0; step < steps; step++) {
      const op = rng.int(0, 3);
      if ((op === 0 || !ids.length) && free.length) {
        const lot = free.pop()!, b = building(st, lot, rng.pick(DEFS));
        b.variant = rng.int(0, 4); b.capacity = rng.int(0, 500);
        lots.set(b.id, lot); ids.push(b.id); placeBuilding(r.sim, b);
      } else if (op === 1 || !free.length && op === 0) {
        const at = rng.int(0, ids.length - 1), id = ids[at], b = st.buildings.get(id)!;
        free.push(lots.get(id)!); lots.delete(id); ids.splice(at, 1); removeBuilding(r.sim, b);
      } else {
        const id = rng.pick(ids), old = st.buildings.get(id)!;
        grid(st, old, false);
        // Both in-place writes and replacement records preserve the Map slot; a move exchanges two reserved lots.
        const b = rng.chance(0.5) ? old : { ...old };
        let lot = lots.get(id)!;
        if (free.length && rng.chance(0.3)) { const next = free.pop()!; free.push(lot); lot = next; lots.set(id, lot); }
        Object.assign(b, lot, { w: rng.int(1, lot.w), d: rng.int(1, lot.d), def: rng.pick(DEFS),
          pop: rng.int(0, 1000), jobs: rng.int(0, 500), capacity: rng.int(0, 400), variant: rng.int(0, 4),
          flags: rng.pick([0, BF.Burnt, BF.Constructing, BF.Abandoned]), baseY: rng.int(0, 80) });
        st.buildings.set(id, b); grid(st, b, true); r.sim.events.emit('buildingChanged', b);
      }
      // Several edits can land between shows; collection must not be needed to keep the index current.
      if (step % 7 === 0 || step === steps - 1) same(step);
    }
  } finally { r.dispose(); }
}

describe('incremental fireworks launch sites', () => {
  for (const seed of [7, 23, 913]) {
    it(`matches the full scan after random add/remove/change bursts (seed ${seed})`, () => {
      randomEdits(generatedCity(seed), seed, 420);
    });
  }

  it.each([
    ['park_small', 'park', 24], ['lm_clock_tower', 'landmark', 8], ['res_tower.r2.7', 'roof', 5],
  ] as const)('keeps Map-order ties and refills removed/changed %s winners', (def, kind, limit) => {
    const st = newState(64), sim = new Simulation(st), buildings: Building[] = [];
    for (let i = 0; i < limit + 4; i++) {
      const b = building(st, { x: i + 2, z: 12, w: 1, d: 1 }, def);
      b.id = 1000 - i * 3; buildings.push(b); placeBuilding(sim, b);
    }
    const src = fireworksSiteSource(st), index = new LaunchSiteIndex(src);
    const selected = () => index.collect(src).filter((s) => s.kind === kind);
    const initial = selected();
    expect(initial).toHaveLength(limit);
    expect(index.collect(src)).toStrictEqual(collectLaunchSites(src));
    const first = buildings[0];
    removeBuilding(sim, first); index.remove(first.id);
    expect(selected().slice(0, limit - 1)).toStrictEqual(initial.slice(1));
    placeBuilding(sim, first); index.update(first, src);
    expect(selected()).not.toContainEqual(initial[0]);
    // Move a kept entry to another group and back before collecting, without changing its insertion rank.
    const changed = buildings[1];
    changed.def = def === 'park_small' ? 'lm_clock_tower' : 'park_stadium'; index.update(changed, src);
    changed.def = def; index.update(changed, src);
    expect(index.collect(src)).toStrictEqual(collectLaunchSites(src));
    // Repair from cached candidates: collecting must not re-query any definitions or building visuals.
    removeBuilding(sim, changed);
    const expected = collectLaunchSites(src);
    const defs = vi.spyOn(src, 'defOf').mockImplementation(() => { throw new Error('definition rescan'); });
    const visuals = vi.spyOn(src, 'visualOf').mockImplementation(() => { throw new Error('visual rescan'); });
    try { index.remove(changed.id); expect(index.collect(src)).toStrictEqual(expected); expect(index.collect(src)).toStrictEqual(expected); }
    finally { defs.mockRestore(); visuals.mockRestore(); index.clear(); }
  });

  it('keeps the centre bit-identical after silent fractional pop/jobs writes and replacement records', () => {
    const st = generatedCity(7), r = rig(st);
    r.src.network = undefined;
    r.src.defOf = (id) => ({ id, category: 'growable' });
    r.index.rebuild(r.src); // no road/park snapping can hide a difference in the weighted centre
    try {
      let i = 0;
      for (const b of st.buildings.values()) {
        b.pop = 0.1 + i / 7; b.jobs = (i++ % 3) / 10;
      }
      const first = st.buildings.values().next().value!;
      const replacement = { ...first, pop: 0.3, jobs: 1 / 3 };
      st.buildings.set(first.id, replacement); r.sim.events.emit('buildingChanged', replacement);
      for (let k = 0; k < 20; k++) {
        replacement.pop += 0.1; replacement.jobs *= 1.01;
        expect(r.index.collect(r.src)).toStrictEqual(collectLaunchSites(r.src));
      }
    } finally { r.dispose(); }
  });

  it('updates roof ranking on visual-only height changes, disappearance and return', () => {
    const st = generatedCity(23), src = fireworksSiteSource(st);
    const b = building(st, { x: 61, z: 61, w: 1, d: 1 }, 'missing_def');
    st.buildings.set(b.id, b); grid(st, b, true);
    const visualOf = src.visualOf, overrides = new Map<number, ReturnType<SiteSource['visualOf']>>();
    src.visualOf = (id) => overrides.has(id) ? overrides.get(id)! : visualOf(id);
    const index = new LaunchSiteIndex(src);
    for (const v of [{ ...visualOf(b.id)!, top: 1000 }, null, { ...visualOf(b.id)!, top: b.baseY + 45 }, visualOf(b.id)]) {
      overrides.set(b.id, v); index.visualChanged(b.id, v, CELL_SIZE);
      expect(index.collect(src)).toStrictEqual(collectLaunchSites(src));
    }
  });

  it('shrinks cached bounds on moves/removals, preserving the waterfront sampling parity', () => {
    const st = newState(64), r = rig(st);
    r.src.building = undefined;
    for (let z = 0; z < 64; z++) for (let x = 32; x < 64; x++) st.water[z * 64 + x] = 1;
    const a = building(st, { x: 29, z: 10, w: 1, d: 1 }), b = building(st, { x: 29, z: 50, w: 1, d: 1 });
    try {
      placeBuilding(r.sim, a); placeBuilding(r.sim, b);
      expect(r.index.collect(r.src).some((s) => s.kind === 'water')).toBe(true);
      for (const z of [11, 22, 8, 49]) {
        grid(st, a, false); a.z = z; grid(st, a, true); r.sim.events.emit('buildingChanged', a);
        expect(r.index.collect(r.src)).toStrictEqual(collectLaunchSites(r.src));
      }
      removeBuilding(r.sim, b);
      expect(r.index.collect(r.src)).toStrictEqual(collectLaunchSites(r.src));
      removeBuilding(r.sim, a);
      expect(r.index.collect(r.src)).toStrictEqual(collectLaunchSites(r.src));
    } finally { r.dispose(); }
  });

  it('reads current terrain/roads/water and rebuilds for a fresh state with reused ids', () => {
    const st = newState(64), sim = new Simulation(st);
    placeBuilding(sim, building(st, { x: 20, z: 20, w: 2, d: 2 }, 'park_small'));
    placeBuilding(sim, building(st, { x: 42, z: 20, w: 2, d: 2 }, 'lm_clock_tower'));
    const src = fireworksSiteSource(st); src.visualOf = () => null;
    const index = new LaunchSiteIndex(src), before = index.collect(src);
    st.heights.fill(18); st.network[21 * 64 + 31] = 2;
    for (let z = 0; z < 64; z++) for (let x = 44; x < 64; x++) st.water[z * 64 + x] = 1;
    expect(index.collect(src)).not.toStrictEqual(before);
    expect(index.collect(src)).toStrictEqual(collectLaunchSites(src));
    const fresh = fireworksSiteSource(generatedCity(913));
    index.rebuild(fresh);
    expect(index.collect(fresh)).toStrictEqual(collectLaunchSites(fresh));
    const empty = fireworksSiteSource(newState(16));
    index.rebuild(empty);
    expect(index.collect(empty)).toStrictEqual(collectLaunchSites(empty));
  });

  it('returns detached site records so callers cannot change later shows', () => {
    const src = fireworksSiteSource(generatedCity(7)), index = new LaunchSiteIndex(src);
    const result = index.collect(src);
    for (const site of result) { site.x = -100; site.weight = 999; }
    result.length = 0;
    expect(index.collect(src)).toStrictEqual(collectLaunchSites(src));
  });
});

describe('CityObjectsView fireworks wiring', () => {
  it('feeds existing building/visual callbacks, rebuilds on reset and releases the index on dispose', () => {
    const st = newState(32), sim = new Simulation(st);
    const view = new CityObjectsView(st, sim.events, {
      scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), renderer: {} as THREE.WebGLRenderer,
      canvas: {} as HTMLCanvasElement, getState: () => sim.state,
    });
    const fw = view as unknown as { launchSites(): LaunchSite[]; launchSiteSource(): SiteSource; launchSiteIndex: LaunchSiteIndex | null };
    const same = () => expect(fw.launchSites()).toStrictEqual(collectLaunchSites(fw.launchSiteSource()));
    let disposed = false;
    try {
      same();
      const a = building(st, { x: 8, z: 8, w: 2, d: 2 }, 'park_plaza'); placeBuilding(sim, a); same();
      a.def = 'res_tower.r2.7'; sim.events.emit('buildingChanged', a); same();
      const visual = view.buildings.getVisual(a.id)!;
      visual.top += 200; view.buildings.onVisual?.(visual, a.id); same();
      removeBuilding(sim, a); same();
      const fresh = newState(32), next = building(fresh, { x: 16, z: 16, w: 2, d: 2 }, 'park_small');
      fresh.buildings.set(next.id, next); grid(fresh, next, true);
      sim.replaceState(fresh); same();
      sim.events.emit('reset', undefined); same();
      view.dispose(); disposed = true;
      expect(fw.launchSiteIndex).toBeNull();
      const update = vi.spyOn(LaunchSiteIndex.prototype, 'update');
      try { sim.events.emit('buildingChanged', next); expect(update).not.toHaveBeenCalled(); }
      finally { update.mockRestore(); }
    } finally { if (!disposed) view.dispose(); }
  });
});

const FIXTURES = process.env.SIM_FIXTURES ?? DEFAULT_FIXTURES;
describe('fireworks fixture identity (SIM_FIXTURES)', () => {
  for (const name of ['bot256_s7_y60.metropolis', 'dense1m_s7.metropolis']) {
    const file = join(FIXTURES, name);
    it.skipIf(!existsSync(file))(`${name}: exact sites before and after random building events`, { timeout: 60000 }, async () => {
      const { st } = await loadCity(file, FIXTURES);
      randomEdits(st, 7, 140);
    });
  }
});
