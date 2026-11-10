/** FEEL-25 QA regressions: avenue lamp clearance, and the walker search through a fast pan, a camera jump and a full cap. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CELL_SIZE } from '../../src/core/constants';
import { Network } from '../../src/core/types';
import { Pedestrians } from '../../src/render/city/Pedestrians';
import { HALF_W, NetInfo } from '../../src/render/city/common/netinfo';
import { RoadSurface } from '../../src/render/city/common/surface';
import type { QualityLevel } from '../../src/render/contracts';
import { newState, roadLine } from '../infra/cityGen';

function camera(x: number, z: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(70, 1.5, 0.5, 4000);
  cam.position.set(x, 125, z);
  cam.up.set(0, 0, -1);
  cam.lookAt(x, 5, z);
  cam.updateMatrixWorld();
  return cam;
}

/** The game's camera as CameraController.apply() places it: 38 degrees, its target on the ground at tilt / yaw. */
function view(cam: THREE.PerspectiveCamera, x: number, z: number, distance = 120, tilt = 52, yaw = 45): void {
  const rad = Math.PI / 180, flat = Math.cos(tilt * rad) * distance;
  cam.position.set(x - Math.sin(yaw * rad) * flat, 5 + Math.sin(tilt * rad) * distance, z + Math.cos(yaw * rad) * flat);
  cam.lookAt(x, 5, z);
  cam.updateMatrixWorld();
}

const SIZE = 160, CENTRE = SIZE / 2 * CELL_SIZE, CAP = { low: 120, medium: 300, high: 600, ultra: 600 };

/** A street grid with a junction every four cells (the straight cells between are walkable), `perCell` walkers each. */
function grid(perCell: number, quality: QualityLevel) {
  const st = newState(SIZE);
  for (let k = 4; k < SIZE - 3; k += 4) {
    roadLine(st, 1, k, SIZE - 2, k, Network.Road);
    roadLine(st, k, 1, k, SIZE - 2, Network.Road);
  }
  const net = new NetInfo(st), surf = new RoadSurface(st, net);
  return () => {
    const people = new Pedestrians(st, net, surf, quality);
    people.getActivity = () => ({ customers: 40 * perCell, visitors: 0, riders: 0 });
    return people;
  };
}

/** The search's own progress: the mesh's count cannot tell a finished empty search from an unfinished one. */
const search = (people: Pedestrians) => people as unknown as { scanning: boolean; cursor: number; cx: number; cz: number };
const cellOf = (cam: THREE.PerspectiveCamera) => [Math.floor(cam.position.x / CELL_SIZE), Math.floor(cam.position.z / CELL_SIZE)];

/** With the walkers frozen (dt 0) a drawn position is a walker. */
function walkers(people: Pedestrians): Set<string> {
  const a = people.mesh.instanceMatrix.array, out = new Set<string>();
  for (let j = 0; j < people.mesh.count; j++) out.add(`${a[j * 16 + 12]},${a[j * 16 + 14]}`);
  expect(out.size, 'no walker drawn twice').toBe(people.mesh.count);
  return out;
}

/**
 * The first QA's pan (pan2.mjs): four seconds at rest, then the camera's target moves along +x for four seconds, the
 * default oblique view. Returns the walkers drawn in every moving frame and what the search did meanwhile.
 */
function pan(fps: number, speed: number, quality: QualityLevel = 'low', distance = 120) {
  const people = grid(3, quality)(), cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 50000), s = search(people);
  const start = CENTRE - speed * 2, drawn: number[] = [];
  let slice = 0, abandoned = 0, finished = 0;
  try {
    view(cam, start, CENTRE, distance);
    for (let f = 0; f < 4 * fps; f++) people.update(1 / fps, cam, 13);
    const rest = people.mesh.count;
    for (let f = 0; f < 4 * fps; f++) {
      view(cam, start + speed * (f + 1) / fps, CENTRE, distance);
      const was = s.scanning, before = s.cursor, from = `${s.cx},${s.cz}`;
      people.update(1 / fps, cam, 13);
      if (was && `${s.cx},${s.cz}` !== from) abandoned++;
      else if (was) slice = Math.max(slice, s.cursor - before);
      if (was && !s.scanning) { finished++; expect(s.cursor).toBe(2025); }
      expect(people.mesh.count).toBeLessThanOrEqual(CAP[quality]);
      drawn.push(people.mesh.count);
    }
    const moving = drawn.slice(fps); // as the QA: the pan's last three seconds
    return { rest, drawn, slice, abandoned, finished, mean: moving.reduce((a, b) => a + b, 0) / moving.length, least: Math.min(...moving) };
  } finally {
    people.dispose();
  }
}

describe('FEEL-25 QA regressions', () => {
  it.each([false, true])('keeps avenue bodies clear of lamps through a full walking cycle (vertical=%s)', (vertical) => {
    const st = newState(64), centre = 32 * CELL_SIZE;
    roadLine(st, vertical ? 32 : 1, vertical ? 1 : 32, vertical ? 32 : 62, vertical ? 62 : 32, Network.Avenue);
    const net = new NetInfo(st), surf = new RoadSurface(st, net), cam = camera(centre, centre);
    const people = new Pedestrians(st, net, surf, 'low');
    people.getActivity = () => ({ customers: 400, visitors: 0, riders: 0 });
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    let passedLampLine = false, checked = 0, lateralError = 0;
    let innerClearance = Infinity, outerClearance = Infinity, poleClearance = Infinity;
    try {
      for (let frame = 0; frame < 30; frame++) people.update(0, cam, 12);
      expect(people.mesh.count).toBeGreaterThan(0);
      // Even the slowest walker completes its 24 m out-and-back cycle within 30 seconds.
      for (let frame = 0; frame < 900; frame++) {
        people.update(1 / 30, cam, 12);
        for (let slot = 0; slot < people.mesh.count; slot++) {
          people.mesh.getMatrixAt(slot, matrix);
          point.setFromMatrixPosition(matrix);
          const x = Math.floor(point.x / CELL_SIZE), z = Math.floor(point.z / CELL_SIZE);
          const cx = (x + 0.5) * CELL_SIZE, cz = (z + 0.5) * CELL_SIZE;
          const lateral = vertical ? point.x - cx : point.z - cz;
          const along = vertical ? point.z - cz : point.x - cx;
          checked++;
          lateralError = Math.max(lateralError, Math.abs(Math.abs(lateral) - 7.72));
          innerClearance = Math.min(innerClearance, Math.abs(lateral) - 0.225 - HALF_W[Network.Avenue]);
          outerClearance = Math.min(outerClearance, CELL_SIZE / 2 - Math.abs(lateral) - 0.225);

          // RoadMesher.straight: one pole at along=0, alternating sides, halfWidth + 0.55 m out.
          const side = (x + z) & 1 ? 1 : -1, offset = HALF_W[Network.Avenue] + 0.55;
          const poleX = cx + (vertical ? -side * offset : 0);
          const poleZ = cz + (vertical ? 0 : side * offset);
          const dx = Math.max(0, Math.abs(point.x - poleX) - (vertical ? 0.225 : 0.15));
          const dz = Math.max(0, Math.abs(point.z - poleZ) - (vertical ? 0.15 : 0.225));
          poleClearance = Math.min(poleClearance, Math.hypot(dx, dz) - 0.12);
          const lampSide = vertical ? -side : side;
          if (Math.sign(lateral) === lampSide && Math.abs(along) < 0.03) passedLampLine = true;
        }
      }
      expect(checked).toBeGreaterThan(0);
      expect(lateralError).toBeLessThan(0.001);
      expect(innerClearance).toBeGreaterThan(0);
      expect(outerClearance).toBeGreaterThan(0);
      expect(poleClearance).toBeGreaterThan(0);
      expect(passedLampLine).toBe(true);
    } finally {
      people.dispose();
    }
  });

  // QA B3 (recheck): at 30 fps the 132 m/s keyboard pan drew 5 walkers on average against 20 at 60 fps and 82 at rest,
  // none at all in 44 of 119 frames. Here (the same pan over a grid city, 68 at rest): 54.3 a frame at 30 fps, 53.8
  // at 60, 55.6 at 20 and 56.9 at 15, never under 36; round 2 gave 5.4 at 30 fps (40 of 90 frames empty) and 25.9 at 60.
  it('draws as many walkers through a 132 m/s LOW pan at 30 fps as at 60 fps, and no frame of it is empty', () => {
    const slow = pan(30, 132), fast = pan(60, 132);
    expect(fast.rest).toBeGreaterThan(50);
    expect(slow.rest).toBe(fast.rest);
    expect(slow.mean).toBeGreaterThan(fast.mean * 0.9);
    expect(slow.mean).toBeLessThan(fast.mean * 1.1);
    expect(fast.mean).toBeGreaterThan(fast.rest * 0.65);
    expect(slow.mean).toBeGreaterThan(slow.rest * 0.65);
    // every frame of the 30 fps pan against the 60 fps frame of the same moment
    for (let f = 0; f < slow.drawn.length; f++) if (fast.drawn[2 * f + 1] > 0) expect(slow.drawn[f], `frame ${f}`).toBeGreaterThan(0);
    expect(Math.min(...fast.drawn)).toBeGreaterThan(fast.rest * 0.4);
    expect(Math.min(...slow.drawn)).toBeGreaterThan(slow.rest * 0.4);
    // the same search, in half the frames: twice the cells a frame, as many searches finished, none started over
    expect(fast.slice).toBe(80);
    expect(slow.slice).toBe(160);
    expect(slow.finished).toBeGreaterThanOrEqual(7); // one every 0.45 s once the pan is under way (round 2: four in all)
    expect(Math.abs(slow.finished - fast.finished)).toBeLessThanOrEqual(1);
    expect(slow.abandoned + fast.abandoned).toBe(0);
  });

  it.each([[20, 240], [15, 320], [10, 320]])('keeps the pan populated at %i fps, %i cells a frame', (fps, cells) => {
    const slow = pan(fps, 132), fast = pan(60, 132);
    expect(slow.slice).toBe(cells);
    expect(slow.abandoned).toBe(0);
    expect(slow.least).toBeGreaterThan(0);
    // under 15 fps the slice stays at 320 cells, so a search takes longer there (0.7 s at 10 fps)
    expect(slow.mean).toBeGreaterThan(fast.mean * (fps < 15 ? 0.75 : 0.9));
  });

  it('keeps a faster, wider pan populated too: 330 m/s from 300 m on HIGH', () => {
    const slow = pan(30, 330, 'high', 300), fast = pan(60, 330, 'high', 300);
    expect(fast.rest).toBeGreaterThan(150);
    expect(fast.mean).toBeGreaterThan(fast.rest * 0.65);
    expect(slow.mean).toBeGreaterThan(fast.mean * 0.9);
    expect(slow.mean).toBeLessThan(fast.mean * 1.1);
    expect(slow.least).toBeGreaterThan(0);
    expect(slow.abandoned + fast.abandoned).toBe(0);
  });

  // QA N1: after a jump the walkers took up to 45 frames at 60 fps and 49 (1.63 s) at 30 fps to return, because the
  // search running at the time had to finish first. Now: most of them within 3 frames (2 at 30 fps), all in 0.43 s.
  it.each([[60, 30], [30, 30], [60, 23]])('abandons a running search at %i fps when the camera jumps %i cells, and starts again at once', (fps, cells) => {
    const make = grid(3, 'high'), people = make(), fresh = make(), cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 50000), s = search(people);
    const slice = 80 * 60 / fps, from = CENTRE - 15 * CELL_SIZE;
    try {
      view(cam, from, CENTRE);
      for (let f = 0; f < 4 * fps; f++) people.update(1 / fps, cam, 13);
      people.invalidate();
      for (let f = 0; f < 5; f++) people.update(1 / fps, cam, 13);
      expect(s.scanning).toBe(true);
      expect(s.cursor).toBe(5 * slice);
      const old = [s.cx, s.cz];

      view(cam, from + cells * CELL_SIZE, CENTRE); // the search covers 22 cells each way from where it began
      expect(cellOf(cam)[0] - old[0]).toBe(cells);
      for (let f = 0; f < 30; f++) fresh.update(0, cam, 13);
      const there = fresh.mesh.count;
      expect(there).toBeGreaterThan(50);
      people.update(1 / fps, cam, 13);
      expect([s.cx, s.cz]).toEqual(cellOf(cam));
      expect(s.cursor).toBe(slice);
      expect(s.scanning).toBe(true);

      let most = people.mesh.count >= 0.8 * there ? 1 : 0, done = 0;
      for (let f = 2; f <= 60 && !done; f++) {
        people.update(1 / fps, cam, 13);
        if (!most && people.mesh.count >= 0.8 * there) most = f;
        if (!s.scanning) done = f;
      }
      expect(done).toBe(Math.ceil(2025 / slice)); // 26 frames at 60 fps, 13 at 30: the same 0.43 s
      expect(most).toBeGreaterThan(0);
      expect(most).toBeLessThanOrEqual(fps === 60 ? 6 : 3);
      // (the two have walked for different times, so a walker or two differ at the screen's edge)
      expect(Math.abs(people.mesh.count - there)).toBeLessThanOrEqual(there * 0.1);
    } finally {
      people.dispose(); fresh.dispose();
    }
  });

  it.each([4, 10, 22])('lets a running search finish when the camera moves %i cells (QA B3: a pan must not restart it)', (cells) => {
    const people = grid(3, 'high')(), cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 50000), s = search(people);
    try {
      view(cam, CENTRE, CENTRE);
      for (let f = 0; f < 30; f++) people.update(0, cam, 13);
      people.invalidate();
      for (let f = 0; f < 3; f++) people.update(0, cam, 13);
      expect(s.scanning).toBe(true);
      const began = [s.cx, s.cz], cursor = s.cursor;
      expect(cursor).toBe(240);

      view(cam, CENTRE + cells * CELL_SIZE, CENTRE);
      expect(cellOf(cam)[0] - began[0]).toBe(cells);
      people.update(0, cam, 13);
      expect([s.cx, s.cz]).toEqual(began);
      expect(s.cursor).toBe(cursor + 80);
      let frames = 4;
      while (s.scanning && frames < 40) { people.update(0, cam, 13); frames++; }
      expect(frames).toBe(26);
      expect(s.cursor).toBe(2025);
      // the camera is more than three cells from that search's centre, so the next one starts in the next frame
      people.update(0, cam, 13);
      expect([s.cx, s.cz]).toEqual(cellOf(cam));
      expect(s.cursor).toBe(80);
    } finally {
      people.dispose();
    }
  });

  // A search takes a cell while its middle is in view, but a walker paces up to 10 m from there: a cell the roster
  // already holds has to stay until its walkers have left the screen, or they vanish a few metres inside its edge.
  it.each([20, 132])('never drops a walker that is still in view while the camera pans at %i m/s', (speed) => {
    const people = grid(3, 'high')(), cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 50000);
    const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    let before = new Set<string>(), checked = 0, left = 0;
    try {
      view(cam, CENTRE - speed * 3, CENTRE);
      for (let f = 0; f < 30; f++) people.update(0, cam, 13);
      for (let f = 1; f <= 360; f++) { // six seconds of 60 fps frames, the walkers frozen
        view(cam, CENTRE - speed * 3 + speed * f / 60, CENTRE);
        people.update(0, cam, 13);
        const now = walkers(people);
        frustum.setFromProjectionMatrix(matrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
        for (const w of before) {
          const [x, z] = w.split(',').map(Number);
          if (!frustum.containsPoint(point.set(x, 5 + 0.1 + 0.16 + 1, z))) { left++; continue; }
          expect(now.has(w), `walker ${w}, frame ${f}`).toBe(true);
          checked++;
        }
        before = now;
      }
      expect(checked).toBeGreaterThan(10000);
      expect(left).toBeGreaterThan(20); // walkers did leave: over the screen's edge, every one of them
    } finally {
      people.dispose();
    }
  });

  // That grace is for a roster with places to spare. A full one needs them all for cells in view: after a slow pan
  // it must show as many walkers as a search from scratch finds at the same place.
  it('spends a full roster on the view: a slow LOW pan in a busy city stays near the cap', () => {
    const make = grid(8, 'low'), people = make(), fresh = make(), cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 50000);
    let sum = 0;
    try {
      view(cam, CENTRE - 60, CENTRE);
      for (let f = 0; f < 30; f++) people.update(0, cam, 13);
      for (let f = 1; f <= 720; f++) { // 6 m/s for ten seconds, then two seconds at rest
        view(cam, CENTRE - 60 + 6 * Math.min(f, 600) / 60, CENTRE);
        people.update(1 / 60, cam, 13);
        expect(people.mesh.count).toBeLessThanOrEqual(120);
        if (f <= 600) sum += people.mesh.count;
      }
      expect(sum / 600).toBeGreaterThan(108); // 113 of 120 (99 when cells behind the screen's edge kept their places)
      for (let f = 0; f < 30; f++) fresh.update(0, cam, 13);
      expect(fresh.mesh.count).toBeGreaterThan(100);
      // (the two have walked for different times, so a few differ at the screen's edge)
      expect(people.mesh.count).toBeGreaterThanOrEqual(fresh.mesh.count - 6);
    } finally {
      people.dispose(); fresh.dispose();
    }
  });

  // While a search runs, a cell it has not reached keeps the previous roster's walkers only as long as the search
  // would still take it. Otherwise they stand in for walkers the cap then has to cut for a frame or two.
  it('lets go at once of walkers the running search will not take: a zoom-out past the spawn distance', () => {
    const people = grid(3, 'high')(), cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 50000), s = search(people);
    try {
      view(cam, CENTRE, CENTRE);
      for (let f = 0; f < 30; f++) people.update(0, cam, 13);
      expect(people.mesh.count).toBeGreaterThan(50);
      // the same street from 420 m: in view and inside the 600 m cut, but 420 m is past the 338 m a search takes
      view(cam, CENTRE, CENTRE, 420);
      people.update(0, cam, 13);
      expect(s.scanning).toBe(true);
      expect(people.mesh.count).toBe(0);
    } finally {
      people.dispose();
    }
  });

  it('keeps a full HIGH roster steady while the camera orbits and pans: next to no walker missing for a frame', () => {
    const people = grid(10, 'high')(), cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 50000);
    const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    const pose = (t: number) => view(cam, CENTRE + Math.cos(t * 0.375) * 160, CENTRE + Math.sin(t * 0.375) * 160, 300, 52, 45 + t * 20);
    const frozen = people as unknown as { time: number }; // the walkers stand still, so a position is a walker
    const seen = new Map<string, number>(); // walker -> frames it has been missing while in view
    let blinks = 0, most = 0;
    try {
      pose(0);
      for (let f = 0; f < 240; f++) { people.update(1 / 60, cam, 13); frozen.time = 0; }
      for (let f = 1; f <= 360; f++) {
        pose(f / 60);
        people.update(1 / 60, cam, 13); frozen.time = 0;
        expect(people.mesh.count).toBeLessThanOrEqual(600);
        most = Math.max(most, people.mesh.count);
        const now = walkers(people);
        for (const w of now) { if (seen.get(w)) blinks++; seen.set(w, 0); }
        frustum.setFromProjectionMatrix(matrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
        for (const [w, gap] of seen) {
          if (now.has(w)) continue;
          const [x, z] = w.split(',').map(Number);
          point.set(x, 5 + 0.1 + 0.16 + 1, z);
          seen.set(w, frustum.containsPoint(point) && point.distanceTo(cam.position) < 590 ? gap + 1 : 0);
        }
      }
      expect(most).toBeGreaterThan(560);
      expect(blinks).toBeLessThan(40); // 11 here; 114 when the previous roster kept cells the search no longer takes
    } finally {
      people.dispose();
    }
  });

  // While a search runs, what it has found is drawn together with the previous roster's walkers on the cells it has
  // not reached. Whoever is in view before and after must be there in between, and the two must never pass the cap.
  it.each([['low', 8, 120], ['medium', 10, 200], ['high', 10, 300], ['high', 3, 120]] as const)(
    'hands the street over to a new search without a blink or a walker over the cap (%s, %i a cell, %i m)', (quality, perCell, distance) => {
      const people = grid(perCell, quality)(), cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 50000), s = search(people);
      const cap = CAP[quality];
      let shared = 0, most = 0;
      try {
        view(cam, CENTRE, CENTRE, distance);
        for (let f = 0; f < 30; f++) people.update(0, cam, 13);
        for (let step = 1; step <= 16; step++) {
          // a cell on and turned a little: too near to start a search, so the last roster shows the new view first
          view(cam, CENTRE + step * CELL_SIZE, CENTRE + (step & 1) * CELL_SIZE, distance, 52, 45 + step * 3);
          people.update(0, cam, 13);
          expect(s.scanning).toBe(false);
          const frames = [walkers(people)];
          people.invalidate();
          do {
            people.update(0, cam, 13);
            frames.push(walkers(people));
            expect(people.mesh.count).toBeLessThanOrEqual(cap);
            most = Math.max(most, people.mesh.count);
            if (s.scanning) shared++; // a frame drawn from both rosters
          } while (s.scanning && frames.length < 40);
          expect(s.scanning).toBe(false);
          people.update(0, cam, 13);
          frames.push(walkers(people));
          const seen = new Map<string, number[]>();
          frames.forEach((frame, f) => { for (const w of frame) { if (!seen.has(w)) seen.set(w, []); seen.get(w)!.push(f); } });
          for (const [w, at] of seen) expect(at[at.length - 1] - at[0], `walker ${w}, step ${step}, frames ${at}`).toBe(at.length - 1);
        }
        expect(shared).toBeGreaterThan(8);
        expect(most).toBeGreaterThan(perCell > 3 ? cap * 0.9 : 50);
      } finally {
        people.dispose();
      }
    });
});
