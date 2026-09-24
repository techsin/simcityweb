/**
 * RoadSurface — the single height function every network-bound thing uses (road meshes, vehicles, props):
 * terrain (bilinear over corner heights) or, on bridge spans, the deck profile. Continuous across cells.
 */
import { CELL_SIZE } from '../../../core/constants';
import type { CityState } from '../../../sim/CityState';
import { LIFT, type NetInfo } from './netinfo';

export class RoadSurface {
  state: CityState;
  net: NetInfo;
  constructor(state: CityState, net: NetInfo) {
    this.state = state;
    this.net = net;
  }

  /**
   * terrain height at world (x,z), matching the rendered terrain triangulation exactly
   * (render-world TerrainRenderer.meshHeightAt: 2 triangles per cell, diagonal from (x+1,z) to (x,z+1)).
   */
  terrain(wx: number, wz: number): number {
    const st = this.state;
    const N = st.size;
    let fx = wx / CELL_SIZE, fz = wz / CELL_SIZE;
    if (fx < 0) fx = 0; else if (fx > N - 1e-6) fx = N - 1e-6;
    if (fz < 0) fz = 0; else if (fz > N - 1e-6) fz = N - 1e-6;
    const x = fx | 0, z = fz | 0;
    const tx = fx - x, tz = fz - z;
    const N1 = N + 1;
    const h = st.heights;
    const i = z * N1 + x;
    const a = h[i], b = h[i + 1], c = h[i + N1], d = h[i + N1 + 1];
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  /** deck / ground height (without LIFT) at world pos, honoring bridges */
  base(wx: number, wz: number): number {
    const N = this.state.size;
    let cx = Math.floor(wx / CELL_SIZE), cz = Math.floor(wz / CELL_SIZE);
    if (cx < 0) cx = 0; else if (cx >= N) cx = N - 1;
    if (cz < 0) cz = 0; else if (cz >= N) cz = N - 1;
    return this.baseIn(cz * N + cx, wx, wz);
  }

  /**
   * base() evaluated with cell i's span (bridge / overpass deck profile, or the terrain when i has none). The road
   * mesher evaluates each cell's own vertices with it: a vertex on the edge between a deck cell and a neighbour off the
   * deck belongs to the cell being meshed (floor() alone hands the deck's far lateral edge to the neighbour's ground,
   * dropping that edge to the terrain, and lifts the edge of a road beside the deck up onto it).
   */
  baseIn(i: number, wx: number, wz: number): number {
    const net = this.net;
    const ax = net.bAxis[i];
    if (ax < 0) return this.terrain(wx, wz);
    const start = net.bStart[i], len = net.bLen[i];
    const along = ax === 0 ? wx : wz;
    let s = (along - start) / len;
    if (s < 0) s = 0; else if (s > 1) s = 1;
    const h0 = ax === 0 ? this.terrain(start, wz) : this.terrain(wx, start);
    const h1 = ax === 0 ? this.terrain(start + len, wz) : this.terrain(wx, start + len);
    const ramp = net.bRamp[i];
    if (ramp > 0) {
      // highway overpass: straight grade between the span ends + a plateau rise reached over the ramp length
      let t = Math.min(along - start, start + len - along) / ramp;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const deck = h0 + (h1 - h0) * s + net.bRise[i] * t * t * (3 - 2 * t);
      const g = this.terrain(wx, wz);
      return deck > g ? deck : g;
    }
    return h0 + (h1 - h0) * s + net.bRise[i] * Math.sin(Math.PI * s);
  }

  /**
   * road surface (asphalt) height. With a heading (fx, fz): traffic crossing UNDER a highway overpass (heading across
   * the deck axis) stays on the ground; traffic along the deck (and callers without a heading) gets the deck.
   */
  y(wx: number, wz: number, fx = 0, fz = 0): number {
    if (fx !== 0 || fz !== 0) {
      const N = this.state.size;
      const cx = Math.floor(wx / CELL_SIZE), cz = Math.floor(wz / CELL_SIZE);
      if (cx >= 0 && cz >= 0 && cx < N && cz < N) {
        const i = cz * N + cx;
        if (this.net.bCross[i]) {
          const along = Math.abs(this.net.bAxis[i] === 0 ? fx : fz) / (Math.hypot(fx, fz) || 1);
          const deck = this.base(wx, wz), ground = this.terrain(wx, wz);
          // blend over the diagonal headings so a car turning at the crossing doesn't jump
          const k = along <= 0.35 ? 0 : along >= 0.85 ? 1 : (along - 0.35) / 0.5;
          return ground + (deck - ground) * k * k * (3 - 2 * k) + LIFT;
        }
      }
    }
    return this.base(wx, wz) + LIFT;
  }

  /** ground (terrain) height under an overpass / bridge, plus the asphalt lift */
  groundY(wx: number, wz: number): number {
    return this.terrain(wx, wz) + LIFT;
  }

  /** is the cell containing (wx,wz) a bridge deck */
  isBridgeAt(wx: number, wz: number): boolean {
    const N = this.state.size;
    const cx = Math.floor(wx / CELL_SIZE), cz = Math.floor(wz / CELL_SIZE);
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) return false;
    return this.net.bAxis[cz * N + cx] >= 0;
  }
}
