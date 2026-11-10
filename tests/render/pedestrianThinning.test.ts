/** QA B1: a walker's visibility belongs to its seed, not its index in the current visible list. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CELL_SIZE } from '../../src/core/constants';
import { Network } from '../../src/core/types';
import { Pedestrians, pedestrianActivityAt } from '../../src/render/city/Pedestrians';
import { NetInfo } from '../../src/render/city/common/netinfo';
import { RoadSurface } from '../../src/render/city/common/surface';
import { newState, roadLine } from '../infra/cityGen';

function fixture() {
  const st = newState(64);
  for (let z = 4; z < 61; z += 3) roadLine(st, 1, z, 62, z, Network.Road);
  const net = new NetInfo(st), surf = new RoadSurface(st, net);
  const day = new Pedestrians(st, net, surf), thinned = new Pedestrians(st, net, surf);
  // One walker per cell makes the cell an observable identity throughout its pacing cycle.
  day.getActivity = thinned.getActivity = () => ({ customers: 40, visitors: 0, riders: 0 });
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.5, 4000);
  camera.up.set(0, 0, -1);
  camera.position.set(32 * CELL_SIZE + 7, 125, 32 * CELL_SIZE);
  camera.lookAt(camera.position.x, 5, camera.position.z); camera.updateMatrixWorld();
  return { day, thinned, camera, dispose: () => { day.dispose(); thinned.dispose(); } };
}

function cells(people: Pedestrians): Set<number> {
  const matrix = new THREE.Matrix4(), out = new Set<number>();
  for (let i = 0; i < people.mesh.count; i++) {
    people.mesh.getMatrixAt(i, matrix);
    out.add(Math.floor(matrix.elements[14] / CELL_SIZE) * 64 + Math.floor(matrix.elements[12] / CELL_SIZE));
  }
  return out;
}

describe('pedestrian identity thinning (QA B1)', () => {
  it.each([7, 21])('keeps the same walkers at %i:00 through rebuilds and unrelated screen-edge crossings', (hour) => {
    const f = fixture();
    try {
      for (let k = 0; k < 30; k++) { f.day.update(0, f.camera, 12); f.thinned.update(0, f.camera, hour); }
      const initialDay = cells(f.day), presence = new Map<number, boolean>();
      for (const id of initialDay) presence.set(id, cells(f.thinned).has(id));
      expect(f.thinned.mesh.count).toBeGreaterThan(20);
      expect(f.thinned.mesh.count).toBeLessThan(initialDay.size);
      let crossings = 0, comparisons = 0, previous = initialDay;
      for (let frame = 0; frame < 480; frame++) {
        if (frame % 60 === 0) { f.day.invalidate(); f.thinned.invalidate(); }
        f.day.update(1 / 30, f.camera, 12); f.thinned.update(1 / 30, f.camera, hour);
        const eligible = cells(f.day), shown = cells(f.thinned);
        crossings += [...eligible].filter((id) => !previous.has(id)).length + [...previous].filter((id) => !eligible.has(id)).length;
        for (const id of eligible) {
          if (presence.has(id)) { expect(shown.has(id), `cell ${id}, frame ${frame}`).toBe(presence.get(id)); comparisons++; }
          else presence.set(id, shown.has(id));
        }
        previous = eligible;
      }
      expect(crossings).toBeGreaterThan(5);
      expect(comparisons).toBeGreaterThan(1000);
    } finally { f.dispose(); }
  });

  it('rebuilds the same night set and keeps the strict <=20% cap as screen eligibility changes', () => {
    const f = fixture();
    try {
      for (let k = 0; k < 30; k++) { f.day.update(0, f.camera, 12); f.thinned.update(0, f.camera, 3); }
      const before = cells(f.thinned);
      expect(before.size).toBeGreaterThan(0);
      f.thinned.invalidate();
      for (let k = 0; k < 30; k++) f.thinned.update(0, f.camera, 3);
      expect(cells(f.thinned)).toEqual(before);
      for (let frame = 0; frame < 300; frame++) {
        f.day.update(1 / 30, f.camera, 12); f.thinned.update(1 / 30, f.camera, 3);
        expect(f.thinned.mesh.count).toBeLessThanOrEqual(Math.floor(f.day.mesh.count * 0.15 * 1.33));
      }
    } finally { f.dispose(); }
  });

  it('preserves shared identities when a new camera origin changes discovery order', () => {
    const f = fixture();
    try {
      for (let k = 0; k < 30; k++) { f.day.update(0, f.camera, 12); f.thinned.update(0, f.camera, 21); }
      const before = cells(f.day), shownBefore = cells(f.thinned);
      f.camera.position.x += CELL_SIZE;
      f.camera.lookAt(f.camera.position.x, 5, f.camera.position.z); f.camera.updateMatrixWorld();
      f.day.invalidate(); f.thinned.invalidate();
      for (let k = 0; k < 30; k++) { f.day.update(0, f.camera, 12); f.thinned.update(0, f.camera, 21); }
      const after = cells(f.day), shownAfter = cells(f.thinned);
      const shared = [...before].filter((id) => after.has(id));
      expect(shared.length).toBeGreaterThan(20);
      for (const id of shared) expect(shownAfter.has(id), `shared cell ${id}`).toBe(shownBefore.has(id));
    } finally { f.dispose(); }
  });

  it('enforces the binding 3 am quota at one through six eligible walkers', () => {
    const f = fixture();
    let count = 1;
    // This cell's first seed passes the 3 am threshold: a raw hash filter alone would keep it even at count=1.
    f.day.getActivity = f.thinned.getActivity = (cell) => ({ customers: cell === 2017 ? count * 40 : 0, visitors: 0, riders: 0 });
    try {
      for (count = 1; count <= 6; count++) {
        f.day.invalidate(); f.thinned.invalidate();
        for (let k = 0; k < 30; k++) { f.day.update(0, f.camera, 12); f.thinned.update(0, f.camera, 3); }
        expect(f.day.mesh.count).toBe(count);
        expect(f.thinned.mesh.count).toBe(count < 6 ? 0 : 1);
      }
    } finally { f.dispose(); }
  });

  // QA round 3: a search's finds are drawn while it runs, so a frame can hold two rosters, in no rank order.
  it.each([7, 21, 3])('keeps each walker\'s own decision and the night cap through a fast pan, a search always running (%i:00)', (hour) => {
    const f = fixture(), share = Math.min(1, pedestrianActivityAt(hour) * 1.33);
    const at = (x: number) => { f.camera.position.x = x; f.camera.lookAt(x, 5, f.camera.position.z); f.camera.updateMatrixWorld(); };
    try {
      at(14 * CELL_SIZE);
      for (let k = 0; k < 30; k++) { f.day.update(0, f.camera, 12); f.thinned.update(0, f.camera, hour); }
      const presence = new Map<number, boolean>();
      let searching = 0, comparisons = 0, slack = 0;
      for (let frame = 1; frame <= 120; frame++) { // the keyboard pan at 120 m, 132 m/s, at 30 fps: 33 cells in 4 s
        at(14 * CELL_SIZE + frame * 132 / 30);
        f.day.update(1 / 30, f.camera, 12); f.thinned.update(1 / 30, f.camera, hour);
        if ((f.thinned as unknown as { scanning: boolean }).scanning) searching++;
        const eligible = cells(f.day), shown = cells(f.thinned), quota = Math.floor(f.day.mesh.count * share);
        expect(f.thinned.mesh.count).toBeLessThanOrEqual(quota);
        for (const id of shown) expect(eligible.has(id), `cell ${id}, frame ${frame}`).toBe(true);
        if (f.thinned.mesh.count === quota) continue; // the quota cut somebody here: the lowest ranks stay instead
        slack++;
        for (const id of eligible) {
          if (presence.has(id)) { expect(shown.has(id), `cell ${id}, frame ${frame}`).toBe(presence.get(id)); comparisons++; }
          else presence.set(id, shown.has(id));
        }
      }
      expect(searching).toBeGreaterThan(80);
      if (hour !== 3) { expect(slack).toBeGreaterThan(100); expect(comparisons).toBeGreaterThan(1000); }
    } finally { f.dispose(); }
  });

  // The rule itself, from the walkers' own hashes (the fixture has one walker a cell, so a cell is a seed): shown are
  // the walkers ranked under the hour's activity, and only the lowest-ranked when they pass the quota (20% at 3 am).
  it.each([3, 5.5, 7, 21, 23])('shows exactly the walkers ranked under the activity of %f h, the lowest ranks when the quota cuts, in any roster order', (hour) => {
    const f = fixture(), activity = pedestrianActivityAt(hour);
    const hash = (n: number) => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };
    const rank = (cell: number) => hash(hash(cell * 16) ^ 0x5bd1e995);
    let cut = 0, shared = 0;
    const check = (what: string) => {
      const eligible = [...cells(f.day)], quota = Math.floor(eligible.length * Math.min(1, activity * 1.33));
      const under = eligible.filter((id) => rank(id) / 4294967296 < activity).sort((p, q) => rank(p) - rank(q));
      if (under.length > quota) cut++;
      expect([...cells(f.thinned)].sort((p, q) => p - q), what).toEqual(under.slice(0, quota).sort((p, q) => p - q));
    };
    try {
      for (let step = 0; step < 24; step++) {
        // narrow and wide views, a cell and a half on each time: few or many eligible walkers, another search order
        f.camera.fov = 30 + (step % 4) * 16; f.camera.updateProjectionMatrix();
        f.camera.position.x = (14 + step * 1.5) * CELL_SIZE;
        f.camera.lookAt(f.camera.position.x, 5, f.camera.position.z); f.camera.updateMatrixWorld();
        f.day.invalidate(); f.thinned.invalidate();
        for (let k = 0; k < 30; k++) { f.day.update(0, f.camera, 12); f.thinned.update(0, f.camera, hour); }
        check(`step ${step}`);
        // and while the next search hands the street over: two rosters in a frame, in the search's order
        f.day.invalidate(); f.thinned.invalidate();
        for (let k = 0; k < 26; k++) {
          f.day.update(0, f.camera, 12); f.thinned.update(0, f.camera, hour);
          if ((f.thinned as unknown as { scanning: boolean }).scanning) shared++;
          check(`step ${step}, frame ${k} of the next search`);
        }
      }
      expect(shared).toBeGreaterThan(500);
      if (hour < 5) expect(cut).toBeGreaterThan(26); // the quota did cut, at more than one of the views
    } finally { f.dispose(); }
  });

  it('adds and removes only nested seed thresholds when the hour changes at a fixed pose', () => {
    const f = fixture();
    try {
      for (let k = 0; k < 30; k++) f.thinned.update(0, f.camera, 5);
      let earlier = cells(f.thinned);
      for (const hour of [6, 7, 8, 9]) {
        f.thinned.update(0, f.camera, hour);
        const later = cells(f.thinned);
        for (const id of earlier) expect(later.has(id)).toBe(true);
        earlier = later;
      }
      for (const hour of [20, 21, 22, 23, 3]) {
        f.thinned.update(0, f.camera, hour);
        const later = cells(f.thinned);
        for (const id of later) expect(earlier.has(id)).toBe(true);
        earlier = later;
      }
    } finally { f.dispose(); }
  });
});
