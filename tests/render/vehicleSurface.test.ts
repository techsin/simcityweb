/**
 * Vehicle heights on bridge / overpass span cells (VehicleRenderer.spanY, which evaluates them without calling
 * RoadSurface) equal RoadSurface.y, the height function the road meshes are built with: water bridges (sine deck),
 * highway overpasses (straight grade + plateau rise over the ramps, never below the ground), cells where traffic crosses
 * under a deck (blended by heading) and plain cells, for road vehicles (with a heading) and trains (without).
 */
import { describe, expect, it } from 'vitest';
import { CELL_SIZE } from '../../src/core/constants';
import { RNG } from '../../src/core/rng';
import { RoadSurface } from '../../src/render/city/common/surface';
import { LIFT, type NetInfo } from '../../src/render/city/common/netinfo';
import { spanY } from '../../src/render/city/vehicles/VehicleRenderer';
import type { CityState } from '../../src/sim/CityState';

const N = 32;

function world(seed: number): { surf: RoadSurface; spans: number[]; plain: number[] } {
  const rng = new RNG(seed);
  const heights = new Float32Array((N + 1) * (N + 1));
  // rolling ground with a slope and noise (bridges span dips, overpasses climb)
  for (let z = 0; z <= N; z++) for (let x = 0; x <= N; x++) heights[z * (N + 1) + x] = 12 + x * 0.35 - z * 0.2 + 3 * Math.sin(x * 0.7) * Math.cos(z * 0.45) + rng.range(-0.6, 0.6);
  const C = N * N;
  const net = { bAxis: new Int8Array(C).fill(-1), bStart: new Float32Array(C), bLen: new Float32Array(C), bRise: new Float32Array(C), bRamp: new Float32Array(C), bCross: new Uint8Array(C) };
  const spans: number[] = [];
  const span = (axis: number, lat: number, a0: number, a1: number, rise: number, ramp: number) => {
    for (let a = a0; a <= a1; a++) {
      const i = axis === 0 ? lat * N + a : a * N + lat;
      net.bAxis[i] = axis; net.bStart[i] = a0 * CELL_SIZE; net.bLen[i] = (a1 - a0 + 1) * CELL_SIZE; net.bRise[i] = rise; net.bRamp[i] = ramp;
      spans.push(i);
    }
  };
  // a water bridge along x, a highway overpass along z (its ramps 3 cells), a short steep bridge along z
  span(0, 5, 3, 10, 3.5, 0);
  span(1, 20, 4, 15, 6.2, 3 * CELL_SIZE);
  span(1, 27, 22, 24, 1.8, 0);
  // the minor road crossing under the overpass, and a crossing flag on a cell without a span
  net.bCross[9 * N + 20] = 1; net.bCross[10 * N + 20] = 1;
  net.bCross[2 * N + 2] = 1; spans.push(2 * N + 2);
  const plain: number[] = [];
  for (let k = 0; k < 24; k++) { const i = rng.int(0, C - 1); if (net.bAxis[i] < 0 && !net.bCross[i]) plain.push(i); }
  const state = { size: N, heights } as unknown as CityState;
  return { surf: new RoadSurface(state, net as unknown as NetInfo), spans, plain };
}

describe('vehicle heights on span cells (VehicleRenderer.spanY) match RoadSurface.y', () => {
  it('road vehicles (any heading) and trains, on bridges, overpasses, under-crossings and plain cells', () => {
    const io = new Float64Array(8);
    let n = 0;
    for (const seed of [1, 2, 3]) {
      const { surf, spans, plain } = world(seed);
      const rng = new RNG(seed * 7919);
      for (const i of [...spans, ...plain]) {
        const cx = i % N, cz = (i / N) | 0;
        for (let s = 0; s < 40; s++) {
          // points inside the cell (its edges included), headings: along / across the axes, diagonal, random
          const wx = (cx + (s === 0 ? 0 : s === 1 ? 0.999999 : rng.next())) * CELL_SIZE, wz = (cz + (s === 2 ? 0 : s === 3 ? 0.999999 : rng.next())) * CELL_SIZE;
          const a = s < 8 ? (s * Math.PI) / 4 : rng.range(-Math.PI, Math.PI);
          const fx = Math.cos(a), fz = Math.sin(a);
          io[0] = wx; io[1] = wz; io[2] = fx; io[3] = fz;
          spanY(surf, i, true, io);
          expect(io[4]).toBe(surf.y(wx, wz, fx, fz));
          io[0] = wx; io[1] = wz; io[2] = fx; io[3] = fz;
          spanY(surf, i, false, io);
          expect(io[4]).toBe(surf.y(wx, wz));
          n += 2;
        }
      }
    }
    expect(n).toBeGreaterThan(5000);
  });

  it('a bridge deck is the grade between its ends plus its rise, traffic across an overpass stays at grade', () => {
    const { surf } = world(4);
    const io = new Float64Array(8);
    // mid-span of the water bridge (x 3..10 on row 5, rise 3.5): the straight grade between the span ends + the rise
    const wz = 5.5 * CELL_SIZE, h0 = surf.terrain(3 * CELL_SIZE, wz), h1 = surf.terrain(11 * CELL_SIZE, wz);
    io[0] = 7 * CELL_SIZE; io[1] = wz; io[2] = 1; io[3] = 0;
    spanY(surf, 5 * N + 7, true, io);
    expect(io[4]).toBeCloseTo((h0 + h1) / 2 + 3.5 + LIFT, 3);
    // the overpass's under-crossing (column 20, rows 9-10): along the deck -> deck, across it -> ground
    io[0] = 20.5 * CELL_SIZE; io[1] = 9.5 * CELL_SIZE; io[2] = 0; io[3] = 1;
    spanY(surf, 9 * N + 20, true, io);
    const deck = io[4];
    io[0] = 20.5 * CELL_SIZE; io[1] = 9.5 * CELL_SIZE; io[2] = 1; io[3] = 0;
    spanY(surf, 9 * N + 20, true, io);
    expect(io[4]).toBe(surf.groundY(io[0], io[1]));
    expect(deck).toBeGreaterThan(io[4] + 3);
  });
});
