/**
 * NetInfo — render-side analysis of the transport network layer (connectivity masks, level crossings, bridge spans).
 * Shared by the road mesher, props, vehicles and previews so everybody agrees on the same topology.
 *
 * Direction index d: 0 = +x (east), 1 = +z (south), 2 = -x (west), 3 = -z (north)  (same as one-way bits in netFlags).
 * Masks: bit d set = connected toward direction d.
 */
import { Network } from '../../../core/types';
import { CELL_SIZE, SEA_LEVEL } from '../../../core/constants';
import type { CityState } from '../../../sim/CityState';
import type { CellRect } from '../../../core/events';

export const DX = [1, 0, -1, 0] as const;
export const DZ = [0, 1, 0, -1] as const;
export const OPP = [2, 3, 0, 1] as const;
/** right-hand vector of heading d (x,z): r = (-dz, dx) */
export const RX = [0, -1, 0, 1] as const;
export const RZ = [1, 0, -1, 0] as const;

export const NF_BRIDGE = 1;
export const NF_TUNNEL = 2;
export const NF_BUS = 16;
export const oneWayDir = (flags: number) => (flags >> 2) & 3;

/** asphalt half width (m) per Network type (rail: ballast half width) */
export const HALF_W = [0, 3.6, 5.0, 6.8, 5.0, 8.0, 2.4];
export const HALF = CELL_SIZE / 2;
/** road asphalt surface lift above the terrain / deck function */
export const LIFT = 0.1;
/** sidewalk top above asphalt */
export const CURB_H = 0.16;

export const isRoadT = (t: number) => t >= Network.Street && t <= Network.Highway;
export const hasSidewalk = (t: number) => t >= Network.Street && t <= Network.OneWay;

export function roadsConnect(a: number, b: number): boolean {
  if (!isRoadT(a) || !isRoadT(b)) return false;
  if (a === Network.Highway || b === Network.Highway) {
    const o = a === Network.Highway ? b : a;
    return o !== Network.Street;
  }
  return true;
}

const axisBit = (d: number) => (d & 1 ? 2 : 1);

export function popcount4(m: number): number {
  return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
}

export class NetInfo {
  N: number;
  state: CityState;
  /** effective road type used for road purposes (own type; for rail level-crossing cells: the crossing road's type) */
  roadType: Uint8Array;
  roadAxis: Uint8Array;
  railAxis: Uint8Array;
  roadMask: Uint8Array;
  railMask: Uint8Array;
  /** 0 none, 1 = rail runs along x (road along z), 2 = rail runs along z (road along x) */
  crossing: Uint8Array;
  /** bridge spans: axis (-1 none, 0 x, 1 z), span start (world coord along axis), span length (m), rise (m) */
  bAxis: Int8Array;
  bStart: Float32Array;
  bLen: Float32Array;
  bRise: Float32Array;
  /** number of road cells (for density heuristics) */
  roadCells = 0;
  railCells = 0;

  constructor(state: CityState) {
    this.state = state;
    const N = (this.N = state.size);
    const C = N * N;
    this.roadType = new Uint8Array(C);
    this.roadAxis = new Uint8Array(C);
    this.railAxis = new Uint8Array(C);
    this.roadMask = new Uint8Array(C);
    this.railMask = new Uint8Array(C);
    this.crossing = new Uint8Array(C);
    this.bAxis = new Int8Array(C).fill(-1);
    this.bStart = new Float32Array(C);
    this.bLen = new Float32Array(C);
    this.bRise = new Float32Array(C);
    this.update();
  }

  private net(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= this.N || z >= this.N) return 0;
    return this.state.network[z * this.N + x];
  }

  /**
   * Recompute a rect (default: everything). Returns the rect of cells whose render data may have changed
   * (input rect grown by the dependency margin and by any bridge spans touched).
   */
  update(rect?: CellRect): CellRect {
    const N = this.N;
    const r0 = rect ?? { x0: 0, z0: 0, x1: N, z1: N };
    const clampR = (r: CellRect, m: number): CellRect => ({
      x0: Math.max(0, r.x0 - m), z0: Math.max(0, r.z0 - m), x1: Math.min(N, r.x1 + m), z1: Math.min(N, r.z1 + m),
    });
    const ra = clampR(r0, 2);
    const st = this.state;
    const net = st.network;
    // pass 1: types / axes / crossings
    for (let z = ra.z0; z < ra.z1; z++) {
      for (let x = ra.x0; x < ra.x1; x++) {
        const i = z * N + x;
        const t = net[i];
        let rt = 0, rdA = 0, rlA = 0, cr = 0;
        if (isRoadT(t)) {
          rt = t;
          rdA = 3;
          if (t !== Network.Highway) {
            const railX = this.net(x - 1, z) === Network.Rail && this.net(x + 1, z) === Network.Rail;
            const railZ = this.net(x, z - 1) === Network.Rail && this.net(x, z + 1) === Network.Rail;
            if (railX !== railZ) {
              cr = railX ? 1 : 2;
              rdA = railX ? 2 : 1;
              rlA = railX ? 1 : 2;
            }
          }
        } else if (t === Network.Rail) {
          rlA = 3;
          const w = this.net(x - 1, z), e = this.net(x + 1, z), n = this.net(x, z - 1), s = this.net(x, z + 1);
          const okRoad = (q: number) => isRoadT(q) && q !== Network.Highway;
          const roadX = okRoad(w) && okRoad(e);
          const roadZ = okRoad(n) && okRoad(s);
          const railXn = w === Network.Rail || e === Network.Rail;
          const railZn = n === Network.Rail || s === Network.Rail;
          if (roadX && !roadZ && !railXn) {
            cr = 2; rdA = 1; rlA = 2; rt = Math.max(w, e) === Network.Avenue ? Network.Avenue : (w === Network.Street && e === Network.Street ? Network.Street : Network.Road);
          } else if (roadZ && !roadX && !railZn) {
            cr = 1; rdA = 2; rlA = 1; rt = Math.max(n, s) === Network.Avenue ? Network.Avenue : (n === Network.Street && s === Network.Street ? Network.Street : Network.Road);
          }
        }
        this.roadType[i] = rt;
        this.roadAxis[i] = rdA;
        this.railAxis[i] = rlA;
        this.crossing[i] = cr;
      }
    }
    // pass 2: masks
    const rb = clampR(r0, 1);
    for (let z = rb.z0; z < rb.z1; z++) {
      for (let x = rb.x0; x < rb.x1; x++) {
        const i = z * N + x;
        let rm = 0, lm = 0;
        const ra_ = this.roadAxis[i], la = this.railAxis[i];
        if (ra_ | la) {
          for (let d = 0; d < 4; d++) {
            const nx = x + DX[d], nz = z + DZ[d];
            const ab = axisBit(d);
            if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
            const j = nz * N + nx;
            if (ra_ & ab && this.roadAxis[j] & ab && roadsConnect(this.roadType[i], this.roadType[j])) rm |= 1 << d;
            if (la & ab && this.railAxis[j] & ab) lm |= 1 << d;
          }
          // lines that run into the map edge continue off-map
          for (let d = 0; d < 4; d++) {
            const nx = x + DX[d], nz = z + DZ[d];
            if (nx >= 0 && nz >= 0 && nx < N && nz < N) continue;
            if (rm & (1 << OPP[d])) rm |= 1 << d;
            if (lm & (1 << OPP[d])) lm |= 1 << d;
          }
        }
        this.roadMask[i] = rm;
        this.railMask[i] = lm;
      }
    }
    // pass 3: bridges (walk spans through the rect; spans may extend beyond it)
    const out: CellRect = { ...rb };
    const flags = st.netFlags;
    const water = st.water;
    const isBridgeCell = (i: number, axis: number): boolean => {
      if (!net[i]) return false;
      if (!(water[i] || flags[i] & NF_BRIDGE)) return false;
      if (flags[i] & NF_TUNNEL) return false;
      const m = net[i] === Network.Rail ? this.railMask[i] : this.roadMask[i];
      return axis === 0 ? m === 5 : m === 10;
    };
    // reset old spans touching the rect (whole old spans, which may extend outside the rect)
    const todo: number[] = [];
    for (let z = rb.z0; z < rb.z1; z++) {
      for (let x = rb.x0; x < rb.x1; x++) {
        const i = z * N + x;
        const ax = this.bAxis[i];
        if (ax >= 0) {
          const c0 = Math.round(this.bStart[i] / CELL_SIZE), c1 = c0 + Math.round(this.bLen[i] / CELL_SIZE);
          for (let c = c0; c < c1; c++) {
            const j = ax === 0 ? z * N + c : c * N + x;
            if (this.bAxis[j] >= 0) { this.bAxis[j] = -1; todo.push(j); }
          }
          if (ax === 0) { out.x0 = Math.min(out.x0, c0); out.x1 = Math.max(out.x1, c1); }
          else { out.z0 = Math.min(out.z0, c0); out.z1 = Math.max(out.z1, c1); }
        }
      }
    }
    for (let z = rb.z0; z < rb.z1; z++) for (let x = rb.x0; x < rb.x1; x++) todo.push(z * N + x);
    for (const i of todo) {
      {
        const x = i % N, z = (i / N) | 0;
        if (this.bAxis[i] >= 0) continue;
        let axis = -1;
        if (isBridgeCell(i, 0)) axis = 0;
        else if (isBridgeCell(i, 1)) axis = 1;
        if (axis < 0) continue;
        // walk the span
        let a0 = axis === 0 ? x : z, a1 = a0;
        const at = (a: number) => (axis === 0 ? z * N + a : a * N + x);
        while (a0 > 0 && isBridgeCell(at(a0 - 1), axis)) a0--;
        while (a1 < N - 1 && isBridgeCell(at(a1 + 1), axis)) a1++;
        const start = a0 * CELL_SIZE;
        const len = (a1 - a0 + 1) * CELL_SIZE;
        // heights of the abutments at the span centerline
        const lat = (axis === 0 ? z : x) * CELL_SIZE + HALF;
        const h0 = axis === 0 ? st.heightAt(start, lat) : st.heightAt(lat, start);
        const h1 = axis === 0 ? st.heightAt(start + len, lat) : st.heightAt(lat, start + len);
        const isRail = net[i] === Network.Rail;
        const clear = SEA_LEVEL + (isRail ? 4.5 : 4.0) + Math.min(6, len * 0.03);
        const mid = (h0 + h1) / 2;
        let rise = Math.max(0, clear - mid);
        rise = Math.min(rise, len * 0.075);
        if (len >= 6 * CELL_SIZE) rise = Math.max(rise, Math.min(len * 0.035, 9));
        for (let a = a0; a <= a1; a++) {
          const j = at(a);
          this.bAxis[j] = axis;
          this.bStart[j] = start;
          this.bLen[j] = len;
          this.bRise[j] = rise;
        }
        if (axis === 0) { out.x0 = Math.min(out.x0, a0); out.x1 = Math.max(out.x1, a1 + 1); }
        else { out.z0 = Math.min(out.z0, a0); out.z1 = Math.max(out.z1, a1 + 1); }
      }
    }
    if (!rect) {
      let rc = 0, lc = 0;
      for (let i = 0; i < N * N; i++) {
        if (this.roadMask[i] || isRoadT(net[i])) rc++;
        if (net[i] === Network.Rail) lc++;
      }
      this.roadCells = rc;
      this.railCells = lc;
    } else {
      this.recount();
    }
    return out;
  }

  private recount() {
    const net = this.state.network;
    let rc = 0, lc = 0;
    for (let i = 0; i < net.length; i++) {
      const t = net[i];
      if (t >= 1 && t <= 5) rc++;
      else if (t === 6) lc++;
    }
    this.roadCells = rc;
    this.railCells = lc;
  }

  /** half width at the shared edge between cell i and its neighbor toward d (road) */
  edgeHalf(i: number, d: number): number {
    const N = this.N;
    const x = i % N, z = (i / N) | 0;
    const nx = x + DX[d], nz = z + DZ[d];
    const own = HALF_W[this.roadType[i]];
    if (nx < 0 || nz < 0 || nx >= N || nz >= N) return own;
    const j = nz * N + nx;
    return Math.max(own, HALF_W[this.roadType[j]] || own);
  }

  /** true if cell (index) is a road intersection (>= 3 road arms) */
  isIntersection(i: number): boolean {
    return popcount4(this.roadMask[i]) >= 3;
  }
}
