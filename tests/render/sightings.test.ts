import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CELL_SIZE, SEA_LEVEL } from '../../src/core/constants';
import { Network } from '../../src/core/types';
import { BF, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { advisorsSystem, advisorData } from '../../src/sim/economy/advisors';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { SIGHTING_HEADLINES, SIGHTING_INTERVAL, postSightingHeadlines, sightingDay, sightingsOnDay,
  type SightingKind } from '../../src/sim/economy/eventHeadlines';
import { Sightings } from '../../src/render/city/Sightings';
import { newState, place } from '../infra/cityGen';

const kinds = Object.keys(SIGHTING_HEADLINES) as SightingKind[];
function habitat(): CityState {
  const st = newState(64);
  st.config.seed = 7;
  for (let z = 0; z < st.size; z++) for (let x = 0; x < 20; x++) st.water[z * st.size + x] = 1;
  st.network[40 * st.size + 40] = Network.Road;
  place(st, 'lm_observatory', 30, 30, { flags: BF.Plopped });
  return st;
}

describe('FEEL-29 rare sightings', () => {
  it('builds all five visitors only after their headline, at the headline’s exact map anchor', () => {
    const counts = { balloons: 12, whale: 4, blimp: 4, observatory: 2, gerald: 9 };
    for (const kind of kinds) {
      const st = habitat();
      st.day = sightingDay(7, kind, 0);
      const sighting = sightingsOnDay(st).find((s) => s.kind === kind)!;
      expect(sighting, kind).toBeDefined();
      const sim = new Simulation(st), scene = new THREE.Scene(), view = new Sightings(scene, st);
      view.update(st, 0);
      expect(view.group.children).toHaveLength(0);
      sim.notify(sighting.text, 'info', sighting.x, sighting.z, 'news');
      view.update(st, 0);
      expect(view.group.children, kind).toHaveLength(counts[kind]);
      expect(view.group.position.x).toBe((sighting.x + 0.5) * CELL_SIZE);
      expect(view.group.position.z).toBe((sighting.z + 0.5) * CELL_SIZE);
      expect(view.group.position.y).toBe(kind === 'whale' ? SEA_LEVEL + 0.6 : 5 + ({ balloons: 140, blimp: 180, observatory: 24, gerald: 1 } as const)[kind]);
      expect(view.group.parent).toBe(scene);
      view.dispose();
    }
  });

  it('expires after 30 real seconds and a repeated expired headline does not restart it', () => {
    const st = habitat(), view = new Sightings(new THREE.Scene(), st);
    st.news.push({ day: 0, text: SIGHTING_HEADLINES.balloons, kind: 'info', x: 10, z: 11, advisor: 'news' });
    view.update(st, 15);
    expect(view.group.children.length).toBeGreaterThan(0);
    view.update(st, 16);
    expect(view.group.children).toHaveLength(0);
    st.news.push({ ...st.news[0] });
    view.update(st, 0);
    expect(view.group.children).toHaveLength(0);
    view.dispose();
  });

  it('disposes every geometry/material on reset and disposal, and ignores updates after disposal', () => {
    const st = habitat(), scene = new THREE.Scene(), view = new Sightings(scene, st);
    st.news.push({ day: 0, text: SIGHTING_HEADLINES.blimp, kind: 'info', x: 10, z: 11 });
    view.update(st, 0);
    const disposed = vi.fn();
    for (const child of view.group.children) {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      mesh.geometry.addEventListener('dispose', disposed); mesh.material.addEventListener('dispose', disposed);
    }
    view.reset();
    expect(disposed).toHaveBeenCalledTimes(8);
    expect(view.group.children).toHaveLength(0);
    expect(view.group.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(view.group.parent).toBe(scene);
    view.update(st, 0);
    expect(view.group.children).toHaveLength(0);
    st.day++;
    st.news.push({ day: st.day, text: SIGHTING_HEADLINES.blimp, kind: 'info', x: 10, z: 11 });
    view.update(st, 0);
    expect(view.group.children).toHaveLength(4);
    view.dispose(); view.dispose(); view.update(st, 0);
    expect(view.group.children).toHaveLength(0);
    expect(view.group.parent).toBeNull();
  });

  it('only inspects the tail between news/day changes, rather than rescanning old news each frame', () => {
    const st = habitat(), view = new Sightings(new THREE.Scene(), st);
    for (let i = 0; i < 20; i++) st.news.push({ day: 0, text: `Ordinary news ${i}`, kind: 'info' });
    let reads = 0;
    st.news = new Proxy(st.news, { get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    } });
    view.update(st, 0);
    expect(reads).toBeGreaterThan(20);
    const initial = reads;
    for (let i = 0; i < 10; i++) view.update(st, 0.1);
    expect(reads - initial).toBe(10);
    st.day++;
    view.update(st, 0);
    expect(reads - initial).toBeGreaterThan(30);
    view.dispose();
  });

  it('spaces every kind at least 6000 days apart and never exceeds two in any rolling 30 game years', () => {
    for (let seed = 1; seed <= 10; seed++) expect(new Set(kinds.map((kind) => sightingDay(seed, kind, 0))).size).toBe(5);
    for (let seed = 1; seed <= 10; seed++) for (const kind of kinds) {
      const days = Array.from({ length: 7 }, (_, cycle) => sightingDay(seed, kind, cycle));
      for (let i = 1; i < days.length; i++) expect(days[i] - days[i - 1]).toBe(SIGHTING_INTERVAL);
      for (const day of days) for (const start of [day - 10800, day - 10800 + 1, day - 1, day, day + 1]) {
        expect(days.filter((d) => d >= start && d < start + 10800).length, `${seed} ${kind} start ${start}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('does not replay old sightings on creation, same-day reload, reset or re-entry', () => {
    const st = habitat();
    st.day = 100;
    st.news.push({ day: st.day, text: SIGHTING_HEADLINES.balloons, kind: 'info', x: 10, z: 11 });
    const view = new Sightings(new THREE.Scene(), st);
    view.update(st, 0);
    expect(view.group.children).toHaveLength(0);
    st.news.push({ day: st.day, text: SIGHTING_HEADLINES.gerald, kind: 'info', x: 40, z: 40 });
    view.update(st, 0);
    expect(view.group.children).toHaveLength(9);
    const loaded = Object.assign(habitat(), { day: st.day, news: structuredClone(st.news) });
    view.reset(loaded);
    view.update(loaded, 0);
    expect(view.group.children).toHaveLength(0);
    view.dispose();
    const reentered = new Sightings(new THREE.Scene(), loaded);
    reentered.update(loaded, 0);
    expect(reentered.group.children).toHaveLength(0);
    reentered.dispose();
  });

  it('anchors balloons and the blimp on completed built-up land away from the map centre', () => {
    const st = habitat();
    st.buildings.clear(); st.building.fill(-1);
    st.water[32 * st.size + 32] = 1;
    const a = place(st, 't_co', 48, 46), b = place(st, 't_r3', 52, 48);
    place(st, 't_co', 4, 4, { built: 0.5 });
    place(st, 't_co', 6, 6, { flags: BF.Burnt });
    for (const kind of ['balloons', 'blimp'] as const) {
      st.day = sightingDay(7, kind, 0);
      const s = sightingsOnDay(st).find((s) => s.kind === kind)!;
      expect([a, b, ...st.buildings.values()].some((lot) => lot.built >= 1 && !(lot.flags & BF.Burnt)
        && s.x >= lot.x && s.x < lot.x + lot.w && s.z >= lot.z && s.z < lot.z + lot.d)).toBe(true);
      expect(s.x).toBeGreaterThanOrEqual(48);
      expect(st.water[s.z * st.size + s.x]).toBe(0);
      expect([s.x, s.z]).not.toEqual([32, 32]);
    }
  });

  it('posts matching same-day located news once, including through the advisors daily integration, with no RNG draw', () => {
    for (const kind of kinds) {
      const st = habitat(), adv = advisorsSystem(new EconRuntime()), sim = new Simulation(st, [adv]);
      st.day = sightingDay(7, kind, 0);
      const before = sim.rng.state, expected = sightingsOnDay(st).find((s) => s.kind === kind)!;
      adv.daily!(sim); adv.daily!(sim);
      const posted = st.news.filter((n) => n.text === SIGHTING_HEADLINES[kind]);
      expect(posted, kind).toHaveLength(1);
      expect(posted[0]).toMatchObject({ day: st.day, text: expected.text, x: expected.x, z: expected.z, advisor: 'news', kind: 'info' });
      expect(advisorData(st).shown[`sighting:${kind}`]).toBe(st.day);
      expect(sim.rng.state).toBe(before);
    }
  });

  it('skips missing habitats, burnt/incomplete observatories, inland ponds and narrow edge channels', () => {
    const st = newState(64);
    st.config.seed = 7;
    for (const kind of ['whale', 'observatory', 'gerald'] as const) {
      st.day = sightingDay(7, kind, 0);
      expect(sightingsOnDay(st).some((s) => s.kind === kind)).toBe(false);
    }
    const b = place(st, 'lm_observatory', 30, 30, { built: 0.5 });
    st.day = sightingDay(7, 'observatory', 0);
    expect(sightingsOnDay(st).some((s) => s.kind === 'observatory')).toBe(false);
    b.built = 1; b.flags |= BF.Burnt;
    expect(sightingsOnDay(st).some((s) => s.kind === 'observatory')).toBe(false);
    st.day = sightingDay(7, 'whale', 0);
    for (let z = 20; z < 40; z++) for (let x = 20; x < 40; x++) st.water[z * st.size + x] = 1;
    expect(sightingsOnDay(st).some((s) => s.kind === 'whale')).toBe(false);
    st.water.fill(0);
    for (let z = 0; z < st.size; z++) for (let x = 0; x < 3; x++) st.water[z * st.size + x] = 1;
    expect(sightingsOnDay(st).some((s) => s.kind === 'whale')).toBe(false);
    st.water.fill(1);
    expect(sightingsOnDay(st).some((s) => s.kind === 'whale')).toBe(false); // no visible shore
  });

  it('keeps whale anchors in open coastal water near actual land, with no state mutation', () => {
    const st = habitat();
    st.day = sightingDay(7, 'whale', 0);
    const water = st.water.slice(), news = st.news.slice(), data = structuredClone(st.systemData);
    const whale = sightingsOnDay(st).find((s) => s.kind === 'whale')!;
    expect(whale.x).toBeGreaterThanOrEqual(12);
    expect(whale.x).toBeLessThanOrEqual(17);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) expect(st.water[(whale.z + dz) * st.size + whale.x + dx]).toBe(1);
    expect(st.systemData).toEqual(data);
    const sim = new Simulation(st), store = { shown: {} };
    postSightingHeadlines(sim, store);
    postSightingHeadlines(sim, store);
    expect(st.news.filter((n) => n.text === whale.text)).toHaveLength(1);
    expect(st.water).toEqual(water);
    st.news = news;
  });
});
