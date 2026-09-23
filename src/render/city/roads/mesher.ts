/**
 * RoadMesher — builds merged network geometry (roads, sidewalks, medians, highways, rails, level crossings, bridges)
 * for a rect of cells, plus the list of props (streetlights, traffic lights, crossing gates, median trees) and
 * night light pools it implies.
 *
 * Pieces per cell (by 4-neighbour road mask): straight, arc corner, general junction (box + tapered arms + filleted
 * sidewalk corners), dead end with cul-de-sac bulb, isolated plaza, level crossing. Everything follows RoadSurface.y
 * (terrain or bridge deck). Markings are drawn procedurally in the road shader from the `rd` attribute.
 */
import { Network } from '../../../core/types';
import { CELL_SIZE } from '../../../core/constants';
import {
  NetInfo, DX, DZ, OPP, RX, RZ, HALF_W, HALF, LIFT, CURB_H, NF_TUNNEL, isRoadT, hasSidewalk, popcount4, oneWayDir,
} from '../common/netinfo';
import type { RoadSurface } from '../common/surface';
import { GeoBuf } from './geobuf';

export const M = {
  ASPHALT: 0, SIDEWALK: 1, CURB: 2, GRASS: 3, BALLAST: 4, SLEEPER: 5, RAIL: 6, CONCRETE: 7, DIRT: 8, METAL: 9,
  PANEL: 10, VERGE: 11, BARRIER: 12, TUNNEL: 13,
} as const;
export const F = { PLAIN: 0, LANES: 1, RAMP: 2, CROSSING: 3 } as const;
const C = (mat: number, kind: number, feat: number) => mat * 64 + kind * 8 + feat;

export interface PropItem {
  model: string;
  variant: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}
export interface PoolItem {
  x: number;
  y: number;
  z: number;
  r: number;
  /** 0 = warm street light, 1 = cool highway light */
  tint: number;
  /** lamp head position (for the night glow sprite) */
  hx: number;
  hy: number;
  hz: number;
}

export interface ChunkOutput {
  main: GeoBuf;
  struct: GeoBuf;
  props: PropItem[];
  pools: PoolItem[];
}

/** Model-space info about the streetlight model (arm reach toward -X, lamp height). */
export interface StreetlightInfo {
  reach: number;
  height: number;
}

const MAXE2 = 12 * 12;
const TWO_PI = Math.PI * 2;

function wrapPi(a: number): number {
  while (a > Math.PI) a -= TWO_PI;
  while (a < -Math.PI) a += TWO_PI;
  return a;
}

export class RoadMesher {
  net: NetInfo;
  surf: RoadSurface;
  light: StreetlightInfo = { reach: 2.6, height: 8.5 };
  /** vehicles etc. may query: signalized intersections (filled during meshing) */
  signalized?: Uint8Array;

  private out!: ChunkOutput;
  private g!: GeoBuf; // current target buffer
  // current cell
  private ox = 0;
  private oz = 0;
  private ci = 0;
  private cx = 0;
  private cz = 0;
  // uv mapping
  private mT = 0;
  private mH = 0;
  private mPx = 0;
  private mPz = 0;
  private mSgn = 1;
  private mA0 = 0;
  private mADir = 1;
  private _u = 0;
  private _v = 0;
  private trackIdx = 0;

  constructor(net: NetInfo, surf: RoadSurface) {
    this.net = net;
    this.surf = surf;
  }

  // ------------------------------------------------------------------ primitives
  private mapUV(lx: number, lz: number): void {
    if (this.mT === 1) {
      const h = this.mH;
      this._u = lx * RX[h] + lz * RZ[h];
      this._v = (this.ox + lx) * DX[h] + (this.oz + lz) * DZ[h];
    } else if (this.mT === 2) {
      const dx = lx - this.mPx, dz = lz - this.mPz;
      const r = Math.sqrt(dx * dx + dz * dz);
      const a = wrapPi(Math.atan2(dz, dx) - this.mA0);
      this._u = this.mSgn * (r - HALF);
      this._v = a * this.mADir * HALF;
    } else {
      this._u = 0;
      this._v = 0;
    }
  }
  private mapStraight(h: number) { this.mT = 1; this.mH = h; }
  private mapNone() { this.mT = 0; }

  private Y(lx: number, lz: number): number {
    return this.surf.base(this.ox + lx, this.oz + lz) + LIFT;
  }

  /** emit one surface vertex (terrain-following normal) */
  private sv(lx: number, lz: number, lift: number, code: number, w: number): void {
    const wx = this.ox + lx, wz = this.oz + lz;
    const s = this.surf;
    const y = s.base(wx, wz) + LIFT + lift;
    const e = 0.7;
    const gx = (s.base(wx + e, wz) - s.base(wx - e, wz)) / (2 * e);
    const gz = (s.base(wx, wz + e) - s.base(wx, wz - e)) / (2 * e);
    const il = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
    this.mapUV(lx, lz);
    this.g.push(wx, y, wz, -gx * il, il, -gz * il, this._u, this._v, code, w);
  }

  /** upward facing surface triangle (local coords), auto-winding + recursive subdivision for terrain following */
  private stri(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, lift: number, code: number, w: number, depth = 0): void {
    const ab = (bx - ax) ** 2 + (bz - az) ** 2, bc = (cx - bx) ** 2 + (cz - bz) ** 2, ca = (ax - cx) ** 2 + (az - cz) ** 2;
    if (depth < 3 && (ab > MAXE2 || bc > MAXE2 || ca > MAXE2)) {
      const mx0 = (ax + bx) / 2, mz0 = (az + bz) / 2, mx1 = (bx + cx) / 2, mz1 = (bz + cz) / 2, mx2 = (cx + ax) / 2, mz2 = (cz + az) / 2;
      this.stri(ax, az, mx0, mz0, mx2, mz2, lift, code, w, depth + 1);
      this.stri(mx0, mz0, bx, bz, mx1, mz1, lift, code, w, depth + 1);
      this.stri(mx2, mz2, mx1, mz1, cx, cz, lift, code, w, depth + 1);
      this.stri(mx0, mz0, mx1, mz1, mx2, mz2, lift, code, w, depth + 1);
      return;
    }
    const cr = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (cr >= 0) {
      this.sv(ax, az, lift, code, w); this.sv(bx, bz, lift, code, w); this.sv(cx, cz, lift, code, w);
    } else {
      this.sv(ax, az, lift, code, w); this.sv(cx, cz, lift, code, w); this.sv(bx, bz, lift, code, w);
    }
  }
  private squad(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number, lift: number, code: number, w: number): void {
    this.stri(ax, az, bx, bz, cx, cz, lift, code, w);
    this.stri(ax, az, cx, cz, dx, dz, lift, code, w);
  }
  /** fan (center + open polyline) */
  private sfan(cx: number, cz: number, pts: number[], lift: number, code: number, w: number): void {
    for (let i = 0; i + 3 < pts.length; i += 2) this.stri(cx, cz, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], lift, code, w);
  }

  /** generic 3D triangle in local xz / absolute y with flat normal; `hint` orients the winding */
  private tri3(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number, code: number, w: number,
  ): void {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    const g = this.g;
    const ox = this.ox, oz = this.oz;
    if (nx * hx + ny * hy + nz * hz < 0) {
      nx = -nx; ny = -ny; nz = -nz;
      this.mapUV(ax, az); g.push(ox + ax, ay, oz + az, nx, ny, nz, this._u, this._v, code, w);
      this.mapUV(cx, cz); g.push(ox + cx, cy, oz + cz, nx, ny, nz, this._u, this._v, code, w);
      this.mapUV(bx, bz); g.push(ox + bx, by, oz + bz, nx, ny, nz, this._u, this._v, code, w);
    } else {
      this.mapUV(ax, az); g.push(ox + ax, ay, oz + az, nx, ny, nz, this._u, this._v, code, w);
      this.mapUV(bx, bz); g.push(ox + bx, by, oz + bz, nx, ny, nz, this._u, this._v, code, w);
      this.mapUV(cx, cz); g.push(ox + cx, cy, oz + cz, nx, ny, nz, this._u, this._v, code, w);
    }
  }
  private quad3(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    hx: number, hy: number, hz: number, code: number, w: number,
  ): void {
    this.tri3(ax, ay, az, bx, by, bz, cx, cy, cz, hx, hy, hz, code, w);
    this.tri3(ax, ay, az, cx, cy, cz, dx, dy, dz, hx, hy, hz, code, w);
  }

  /**
   * vertical wall along a->b (local), from surface+lift0 to surface+lift1; faces the right side of a->b when side=+1.
   * Follows the surface along its length.
   */
  private wall(ax: number, az: number, bx: number, bz: number, lift0: number, lift1: number, side: number, code: number, w: number, step = 8.2): void {
    const dx = bx - ax, dz = bz - az;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-4) return;
    const n = Math.max(1, Math.ceil(len / step));
    const hx = (-dz / len) * side, hz = (dx / len) * side;
    let px = ax, pz = az, py = this.Y(ax, az);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const qx = ax + dx * t, qz = az + dz * t, qy = this.Y(qx, qz);
      this.quad3(px, py + lift0, pz, qx, qy + lift0, qz, qx, qy + lift1, qz, px, py + lift1, pz, hx, 0, hz, code, w);
      px = qx; pz = qz; py = qy;
    }
  }

  /** polyline wall (curb along arcs etc.). pts = [x0,z0,x1,z1,...] */
  private wallPath(pts: number[], lift0: number, lift1: number, side: number, code: number, w: number): void {
    for (let i = 0; i + 3 < pts.length; i += 2) this.wall(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], lift0, lift1, side, code, w);
  }

  private neighborIsRoad(d: number): boolean {
    const N = this.net.N;
    const nx = this.cx + DX[d], nz = this.cz + DZ[d];
    if (nx < 0 || nz < 0 || nx >= N || nz >= N) return true;
    const j = nz * N + nx;
    return this.net.roadAxis[j] !== 0 || this.net.state.network[j] !== 0;
  }

  // ------------------------------------------------------------------ chunk
  buildChunk(x0: number, z0: number, x1: number, z1: number, out: ChunkOutput): void {
    this.out = out;
    out.main.reset();
    out.struct.reset();
    out.props.length = 0;
    out.pools.length = 0;
    const net = this.net;
    const N = net.N;
    const st = net.state;
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        const i = z * N + x;
        const t = st.network[i];
        if (!t) continue;
        this.ci = i;
        this.cx = x;
        this.cz = z;
        this.ox = x * CELL_SIZE + HALF;
        this.oz = z * CELL_SIZE + HALF;
        this.g = out.main;
        this.trackIdx = 0;
        if (st.netFlags[i] & NF_TUNNEL) {
          this.tunnelCell(t);
          continue;
        }
        const cr = net.crossing[i];
        if (cr) {
          this.levelCrossing(cr);
        } else if (t === Network.Rail) {
          this.railCell(net.railMask[i]);
        } else {
          this.roadCell(t, net.roadMask[i]);
        }
        if (net.bAxis[i] >= 0) {
          this.g = out.struct;
          this.bridgeStructure(t);
          this.g = out.main;
        }
      }
    }
  }

  // ------------------------------------------------------------------ roads
  private roadCell(t: number, m: number): void {
    const net = this.net;
    const i = this.ci;
    const a = HALF_W[t];
    const cnt = popcount4(m);
    const eh = [0, 0, 0, 0];
    let uniform = true;
    for (let d = 0; d < 4; d++) {
      if (m & (1 << d)) {
        eh[d] = net.edgeHalf(i, d);
        if (Math.abs(eh[d] - a) > 1e-3) uniform = false;
      }
    }
    if (cnt === 2 && (m === 5 || m === 10) && uniform) {
      let h = m === 5 ? 0 : 1;
      if (t === Network.OneWay) {
        const od = oneWayDir(net.state.netFlags[i]);
        if ((od & 1) === (h & 1)) h = od;
      }
      this.straight(t, h);
    } else if (cnt === 2 && m !== 5 && m !== 10 && uniform) {
      // corner: find d1,d2
      let d1 = -1, d2 = -1;
      for (let d = 0; d < 4; d++) if (m & (1 << d)) { if (d1 < 0) d1 = d; else d2 = d; }
      // make d2 = d1 + 1 (mod 4) ordering (so d1 -> d2 is a consistent orientation)
      if ((d1 + 1) % 4 !== d2) { const tmp = d1; d1 = d2; d2 = tmp; }
      if (t === Network.OneWay) {
        const od = oneWayDir(net.state.netFlags[i]);
        // travel from d1 edge to d2 edge means heading OPP[d1] then d2
        if (!(od === d2 || od === OPP[d1])) { const tmp = d1; d1 = d2; d2 = tmp; }
      }
      this.arc(t, d1, d2);
    } else if (cnt === 1 && t !== Network.Highway) {
      let d = 0;
      while (!(m & (1 << d))) d++;
      this.deadEnd(t, d, eh[d]);
    } else if (cnt === 0 && t !== Network.Highway) {
      this.deadEnd(t, -1, 0);
    } else {
      this.junction(t, m, eh);
    }
  }

  /** crosswalk flags for a straight of heading h: bit0 = intersection at v-min end, bit1 = at v-max end */
  private crossFlags(t: number, h: number): number {
    if (t === Network.Highway) return 0;
    const N = this.net.N;
    let f = 0;
    const test = (d: number) => {
      const nx = this.cx + DX[d], nz = this.cz + DZ[d];
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) return false;
      const j = nz * N + nx;
      return popcount4(this.net.roadMask[j]) >= 3 && this.net.roadType[j] !== Network.Highway;
    };
    if (test(OPP[h])) f |= 1;
    if (test(h)) f |= 2;
    return f;
  }

  /** local point from (u lateral, s along) for heading h */
  private lp(h: number, u: number, s: number): [number, number] {
    return [s * DX[h] + u * RX[h], s * DZ[h] + u * RZ[h]];
  }

  private straight(t: number, h: number): void {
    const a = HALF_W[t];
    const w = this.crossFlags(t, h);
    this.mapStraight(h);
    const kind = t;
    const bridge = this.net.bAxis[this.ci] >= 0;
    // asphalt
    const q = (u0: number, u1: number, s0: number, s1: number, lift: number, code: number, ww: number) => {
      const [ax, az] = this.lp(h, u0, s0), [bx, bz] = this.lp(h, u1, s0), [cx, cz] = this.lp(h, u1, s1), [dx, dz] = this.lp(h, u0, s1);
      this.squad(ax, az, bx, bz, cx, cz, dx, dz, lift, code, ww);
    };
    const wl = (u0: number, s0: number, u1: number, s1: number, l0: number, l1: number, side: number, code: number) => {
      const [ax, az] = this.lp(h, u0, s0), [bx, bz] = this.lp(h, u1, s1);
      this.wall(ax, az, bx, bz, l0, l1, side, code, 0);
    };
    const asphaltHalf = t === Network.Highway ? HALF : a + 0.02;
    q(-asphaltHalf, asphaltHalf, -HALF, HALF, 0, C(M.ASPHALT, kind, F.LANES), w);
    if (hasSidewalk(t)) {
      for (const sg of [1, -1]) {
        q(sg * a, sg * HALF, -HALF, HALF, CURB_H, C(M.SIDEWALK, kind, 1), w);
        // curb face (toward the asphalt): wall from s=-8..8 at u = sg*a, facing -sg side
        wl(sg * a, -HALF, sg * a, HALF, -0.02, CURB_H, -sg, C(M.CURB, kind, 0));
        const sideDir = sg > 0 ? this.dirOfRight(h) : OPP[this.dirOfRight(h)];
        if (!bridge && !this.neighborIsRoad(sideDir)) wl(sg * HALF, -HALF, sg * HALF, HALF, -1.0, CURB_H, sg, C(M.CURB, kind, 0));
      }
      // streetlight: one per cell alternating sides
      const side = (this.cx + this.cz) & 1 ? 1 : -1;
      const off = t === Network.Street ? a + 1.0 : a + 0.55;
      this.addStreetlight(h, side * off, 0, -side, CURB_H, 0);
    } else if (t === Network.Highway) {
      // jersey barriers: median + outer edges
      const N = this.net.N;
      const fwdHw = (d: number) => {
        const nx = this.cx + DX[d], nz = this.cz + DZ[d];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) return true;
        return this.net.roadType[nz * N + nx] === Network.Highway;
      };
      const s0 = fwdHw(OPP[h]) ? -HALF : -HALF + 2;
      const s1 = fwdHw(h) ? HALF : HALF - 2;
      this.jersey(h, 0, s0, s1, 0.32);
      this.jersey(h, HALF - 0.28, -HALF, HALF, 0.28);
      this.jersey(h, -HALF + 0.28, -HALF, HALF, 0.28);
      if (!bridge) {
        for (const sg of [1, -1]) {
          const sideDir = sg > 0 ? this.dirOfRight(h) : OPP[this.dirOfRight(h)];
          if (!this.neighborIsRoad(sideDir)) wl(sg * HALF, -HALF, sg * HALF, HALF, -1.0, 0.0, sg, C(M.CONCRETE, kind, 0));
        }
      }
      if (((this.cx + this.cz) & 1) === 0) {
        this.addStreetlight(h, 0.0, 0, 1, 0.9, 1);
        this.addStreetlight(h, 0.0, 0, -1, 0.9, 1);
      }
    }
    if (t === Network.Avenue) {
      // planted median, cut back before intersections
      const s0 = w & 1 ? -HALF + 4.2 : -HALF;
      const s1 = w & 2 ? HALF - 4.2 : HALF;
      const mh = 1.0;
      q(-mh, mh, s0, s1, CURB_H, C(M.GRASS, kind, 1), 0);
      wl(mh, s0, mh, s1, -0.02, CURB_H, 1, C(M.CURB, kind, 0));
      wl(-mh, s0, -mh, s1, -0.02, CURB_H, -1, C(M.CURB, kind, 0));
      if (s0 > -HALF) wl(-mh, s0, mh, s0, -0.02, CURB_H, 1, C(M.CURB, kind, 0));
      if (s1 < HALF) wl(-mh, s1, mh, s1, -0.02, CURB_H, -1, C(M.CURB, kind, 0));
      // median trees
      for (const s of [-4, 4]) {
        if (s < s0 + 1.5 || s > s1 - 1.5) continue;
        const [lx, lz] = this.lp(h, 0, s);
        const hsh = ((this.cx * 73856093) ^ (this.cz * 19349663) ^ (s > 0 ? 7 : 3)) >>> 0;
        this.out.props.push({
          model: 'tree_maple', variant: hsh % 3, x: this.ox + lx, y: this.Y(lx, lz) + CURB_H, z: this.oz + lz,
          yaw: (hsh % 628) / 100, scale: 0.55 + ((hsh >> 8) % 20) / 100,
        });
      }
    }
    if (t === Network.OneWay || t === Network.Road || t === Network.Street || t === Network.Avenue || t === Network.Highway) {
      // nothing else
    }
  }

  /** direction index of the right-hand vector of heading h */
  private dirOfRight(h: number): number {
    return (h + 1) & 3;
  }

  /** jersey barrier along heading h at lateral u, from s0 to s1, half base width hw */
  private jersey(h: number, u: number, s0: number, s1: number, hw: number): void {
    const code = C(M.BARRIER, Network.Highway, 0);
    const top = 0.85, tw = hw * 0.4;
    // profile: (u-hw,0) (u-tw,top) (u+tw,top) (u+hw,0)
    const prof = [-hw, 0, -tw * 1.6, top * 0.35, -tw, top, tw, top, tw * 1.6, top * 0.35, hw, 0];
    this.extrudeStraight(h, u, s0, s1, prof, code);
  }

  /** extrude a lateral profile (pairs du, lift) along heading h (straight), following the surface */
  private extrudeStraight(h: number, u: number, s0: number, s1: number, prof: number[], code: number, steps = 2): void {
    const n = Math.max(1, steps);
    for (let k = 0; k < n; k++) {
      const sa = s0 + ((s1 - s0) * k) / n, sb = s0 + ((s1 - s0) * (k + 1)) / n;
      for (let p = 0; p + 3 < prof.length; p += 2) {
        const [ax, az] = this.lp(h, u + prof[p], sa), [bx, bz] = this.lp(h, u + prof[p + 2], sa);
        const [cx, cz] = this.lp(h, u + prof[p + 2], sb), [dx, dz] = this.lp(h, u + prof[p], sb);
        const ya = this.Y(ax, az) + prof[p + 1], yb = this.Y(bx, bz) + prof[p + 3], yc = this.Y(cx, cz) + prof[p + 3], yd = this.Y(dx, dz) + prof[p + 1];
        // hint: outward from the profile center + up
        const du = (prof[p] + prof[p + 2]) / 2;
        const hu = du >= 0 ? 1 : -1;
        const hx = RX[h] * hu * 0.5, hz = RZ[h] * hu * 0.5;
        this.quad3(ax, ya, az, bx, yb, bz, cx, yc, cz, dx, yd, dz, hx, 1, hz, code, 0);
      }
    }
  }

  private arc(t: number, d1: number, d2: number): void {
    const a = HALF_W[t];
    const Px = (DX[d1] + DX[d2]) * HALF, Pz = (DZ[d1] + DZ[d2]) * HALF;
    const th1 = Math.atan2(DZ[d1] * HALF - Pz, DX[d1] * HALF - Px);
    const th2 = Math.atan2(DZ[d2] * HALF - Pz, DX[d2] * HALF - Px);
    const dth = wrapPi(th2 - th1);
    const hin = OPP[d1];
    // right vector of entry heading vs direction away from P at the entry point (= -dir(d2))
    const dot = RX[hin] * -DX[d2] + RZ[hin] * -DZ[d2];
    this.mT = 2;
    this.mPx = Px; this.mPz = Pz; this.mA0 = th1; this.mADir = dth > 0 ? 1 : -1; this.mSgn = dot > 0 ? 1 : -1;
    const kind = t;
    const n = 8;
    const P = (r: number, th: number): [number, number] => [Px + r * Math.cos(th), Pz + r * Math.sin(th)];
    const ring = (r0: number, r1: number, lift: number, code: number, w: number) => {
      for (let k = 0; k < n; k++) {
        const ta = th1 + (dth * k) / n, tb = th1 + (dth * (k + 1)) / n;
        const [ax, az] = P(r0, ta), [bx, bz] = P(r1, ta), [cx, cz] = P(r1, tb), [dx, dz] = P(r0, tb);
        this.squad(ax, az, bx, bz, cx, cz, dx, dz, lift, code, w);
      }
    };
    const arcPts = (r: number): number[] => {
      const pts: number[] = [];
      for (let k = 0; k <= n; k++) { const [x, z] = P(r, th1 + (dth * k) / n); pts.push(x, z); }
      return pts;
    };
    const r1 = HALF - a, r2 = HALF + a;
    // asphalt (radial splits)
    const rs: number[] = [Math.max(0, r1 - 0.02)];
    const steps = Math.max(2, Math.ceil((r2 - r1) / 4));
    for (let k = 1; k <= steps; k++) rs.push(r1 + ((r2 - r1) * k) / steps + (k === steps ? 0.02 : 0));
    for (let k = 0; k + 1 < rs.length; k++) ring(rs[k], rs[k + 1], 0, C(M.ASPHALT, kind, F.LANES), 0);
    // boundary distance from P to the far sides of the cell square along angle th
    const bound = (th: number) => {
      const c = Math.cos(th), s = Math.sin(th);
      let tb = 1e9;
      if (Math.abs(c) > 1e-6) { const tx = ((c > 0 ? HALF : -HALF) - Px) / c; if (tx > 0) tb = Math.min(tb, tx); }
      if (Math.abs(s) > 1e-6) { const tz = ((s > 0 ? HALF : -HALF) - Pz) / s; if (tz > 0) tb = Math.min(tb, tz); }
      return tb;
    };
    const outerRing = (r0: number, lift: number, code: number) => {
      for (let k = 0; k < n; k++) {
        const ta = th1 + (dth * k) / n, tb = th1 + (dth * (k + 1)) / n;
        const ba = bound(ta), bb = bound(tb);
        if (ba <= r0 + 0.01 && bb <= r0 + 0.01) continue;
        const [ax, az] = P(r0, ta), [bx, bz] = P(Math.max(ba, r0), ta), [cx, cz] = P(Math.max(bb, r0), tb), [dx, dz] = P(r0, tb);
        this.squad(ax, az, bx, bz, cx, cz, dx, dz, lift, code, 0);
      }
    };
    if (hasSidewalk(t)) {
      // inner sidewalk (quarter disk around P)
      if (r1 > 0.2) {
        const pts = arcPts(r1);
        this.sfan(Px, Pz, pts, CURB_H, C(M.SIDEWALK, kind, 0), 0);
        this.wallPath(pts, -0.02, CURB_H, this.mADir > 0 ? -1 : 1, C(M.CURB, kind, 0), 0);
      }
      outerRing(r2, CURB_H, C(M.SIDEWALK, kind, 0));
      this.wallPath(arcPts(r2), -0.02, CURB_H, this.mADir > 0 ? 1 : -1, C(M.CURB, kind, 0), 0);
      // skirts on the two far sides
      if (this.net.bAxis[this.ci] < 0) {
        for (const d of [OPP[d1], OPP[d2]]) {
          if (this.neighborIsRoad(d)) continue;
          this.edgeSkirt(d, CURB_H, C(M.CURB, kind, 0));
        }
      }
      // streetlight on the outer sidewalk at mid angle, arm toward P
      const thm = th1 + dth / 2;
      const [lx, lz] = P(r2 + (t === Network.Street ? 1.0 : 0.55), thm);
      const dl = Math.hypot(Px - lx, Pz - lz);
      this.addStreetlightAt(lx, lz, (Px - lx) / dl, (Pz - lz) / dl, CURB_H, 0);
    } else if (t === Network.Highway) {
      outerRing(r2, 0, C(M.VERGE, kind, 0));
      this.arcJersey(Px, Pz, HALF, th1, dth, 0.32);
      this.arcJersey(Px, Pz, 2 * HALF - 0.28, th1, dth, 0.28);
      if (this.net.bAxis[this.ci] < 0) {
        for (const d of [OPP[d1], OPP[d2]]) if (!this.neighborIsRoad(d)) this.edgeSkirt(d, 0, C(M.CONCRETE, kind, 0));
      }
    }
    if (t === Network.Avenue) {
      ring(HALF - 1, HALF + 1, CURB_H, C(M.GRASS, kind, 1), 0);
      this.wallPath(arcPts(HALF - 1), -0.02, CURB_H, this.mADir > 0 ? 1 : -1, C(M.CURB, kind, 0), 0);
      this.wallPath(arcPts(HALF + 1), -0.02, CURB_H, this.mADir > 0 ? -1 : 1, C(M.CURB, kind, 0), 0);
    }
  }

  private arcJersey(Px: number, Pz: number, r: number, th1: number, dth: number, hw: number): void {
    const code = C(M.BARRIER, Network.Highway, 0);
    const top = 0.85, tw = hw * 0.4;
    const prof = [-hw, 0, -tw * 1.6, top * 0.35, -tw, top, tw, top, tw * 1.6, top * 0.35, hw, 0];
    const n = 8;
    for (let k = 0; k < n; k++) {
      const ta = th1 + (dth * k) / n, tb = th1 + (dth * (k + 1)) / n;
      const ca = Math.cos(ta), sa = Math.sin(ta), cb = Math.cos(tb), sb = Math.sin(tb);
      for (let p = 0; p + 3 < prof.length; p += 2) {
        const ra0 = r + prof[p], ra1 = r + prof[p + 2];
        const ax = Px + ra0 * ca, az = Pz + ra0 * sa, bx = Px + ra1 * ca, bz = Pz + ra1 * sa;
        const cx = Px + ra1 * cb, cz = Pz + ra1 * sb, dx = Px + ra0 * cb, dz = Pz + ra0 * sb;
        const hu = (prof[p] + prof[p + 2]) >= 0 ? 1 : -1;
        const mx = (ca + cb) * 0.5 * hu, mz = (sa + sb) * 0.5 * hu;
        this.quad3(ax, this.Y(ax, az) + prof[p + 1], az, bx, this.Y(bx, bz) + prof[p + 3], bz, cx, this.Y(cx, cz) + prof[p + 3], cz, dx, this.Y(dx, dz) + prof[p + 1], dz, mx * 0.5, 1, mz * 0.5, code, 0);
      }
    }
  }

  /** skirt along the full cell edge toward d (outward facing) from top lift down into the ground */
  private edgeSkirt(d: number, top: number, code: number): void {
    const r = (d + 1) & 3; // right of heading d
    const ax = DX[d] * HALF - DX[r] * HALF, az = DZ[d] * HALF - DZ[r] * HALF;
    const bx = DX[d] * HALF + DX[r] * HALF, bz = DZ[d] * HALF + DZ[r] * HALF;
    // walking a->b along +r; outward = d = left of +r  => side -1
    this.wall(ax, az, bx, bz, -1.0, top, -1, code, 0);
  }

  /** partial skirt along edge d between lateral offsets l0..l1 (along +right(d)) */
  private edgeSkirtPart(d: number, l0: number, l1: number, top: number, code: number): void {
    const r = (d + 1) & 3;
    const ax = DX[d] * HALF + DX[r] * l0, az = DZ[d] * HALF + DZ[r] * l0;
    const bx = DX[d] * HALF + DX[r] * l1, bz = DZ[d] * HALF + DZ[r] * l1;
    this.wall(ax, az, bx, bz, -1.0, top, -1, code, 0);
  }

  private junction(t: number, m: number, eh: number[]): void {
    const kind = t;
    let b = HALF_W[t];
    for (let d = 0; d < 4; d++) if (m & (1 << d)) b = Math.max(b, eh[d]);
    const full = t === Network.Highway || b >= HALF - 0.01;
    if (full) b = HALF;
    const signal = t !== Network.Street && t !== Network.Highway && popcount4(m) >= 3;
    if (this.signalized) this.signalized[this.ci] = signal ? 1 : 0;
    // asphalt: box
    this.mapNone();
    this.squad(-b, -b, b, -b, b, b, -b, b, 0, C(M.ASPHALT, kind, F.PLAIN), 0);
    if (!full) {
      // arms + corner squares
      for (let d = 0; d < 4; d++) {
        const r = (d + 1) & 3;
        if (m & (1 << d)) {
          this.mapStraight(d);
          const [ax, az] = this.lp(d, -b, b), [bx, bz] = this.lp(d, b, b), [cx, cz] = this.lp(d, b, HALF), [dx, dz] = this.lp(d, -b, HALF);
          this.squad(ax, az, bx, bz, cx, cz, dx, dz, 0, C(M.ASPHALT, kind, F.LANES), 0);
        }
        if (m & (1 << d) && m & (1 << r)) {
          this.mapNone();
          const ex = DX[d], ez = DZ[d], fx = DX[r], fz = DZ[r];
          const p = (al: number, be: number): [number, number] => [al * ex + be * fx, al * ez + be * fz];
          const [ax, az] = p(b, b), [bx, bz] = p(HALF, b), [cx, cz] = p(HALF, HALF), [dx, dz] = p(b, HALF);
          this.squad(ax, az, bx, bz, cx, cz, dx, dz, 0, C(M.ASPHALT, kind, F.PLAIN), 0);
        }
      }
      if (hasSidewalk(t)) {
        this.mapNone();
        for (let q = 0; q < 4; q++) this.junctionQuadrant(t, m, eh, b, q, signal);
      }
    } else {
      // highway / full junction: skirts where nothing continues
      if (this.net.bAxis[this.ci] < 0) {
        for (let d = 0; d < 4; d++) if (!(m & (1 << d)) && !this.neighborIsRoad(d)) this.edgeSkirt(d, 0, C(M.CONCRETE, kind, 0));
      }
      // barriers along closed sides of highway cells
      if (t === Network.Highway) {
        for (let d = 0; d < 4; d++) {
          if (m & (1 << d)) continue;
          const h = (d + 1) & 3; // heading along the edge
          this.jersey(h, -(HALF - 0.28), -HALF, HALF, 0.28);
        }
      }
    }
  }

  /** sidewalk polygon for quadrant between dA=q and dB=q+1 (star-shaped from the outer corner) */
  private junctionQuadrant(t: number, m: number, eh: number[], b: number, q: number, signal: boolean): void {
    const dA = q, dB = (q + 1) & 3;
    const ex = DX[dA], ez = DZ[dA], fx = DX[dB], fz = DZ[dB];
    const L = (al: number, be: number): [number, number] => [al * ex + be * fx, al * ez + be * fz];
    const hasA = !!(m & (1 << dA)), hasB = !!(m & (1 << dB));
    const kind = t;
    // boundary polyline (alpha,beta) + curb flags per edge
    const pts: number[] = [];
    const curb: boolean[] = [];
    const add = (al: number, be: number, curbToNext: boolean) => { pts.push(al, be); curb.push(curbToNext); };
    if (hasA) add(HALF, eh[dA], true);
    else { add(HALF, 0, false); add(b, 0, true); }
    const rf = Math.min(2.5, HALF - b - 0.05);
    if (hasA && hasB && rf > 0.3) {
      const cxA = b + rf, cxB = b + rf;
      const segs = 5;
      for (let k = 0; k <= segs; k++) {
        const ang = -Math.PI / 2 - (Math.PI / 2) * (k / segs); // from 270deg to 180deg
        add(cxA + rf * Math.cos(ang), cxB + rf * Math.sin(ang), true);
      }
    } else add(b, b, true);
    if (hasB) add(eh[dB], HALF, false);
    else { add(0, b, false); add(0, HALF, false); }
    // fan from outer corner
    const [ox, oz] = L(HALF, HALF);
    const loc: number[] = [];
    for (let k = 0; k < pts.length; k += 2) { const [x, z] = L(pts[k], pts[k + 1]); loc.push(x, z); }
    this.sfan(ox, oz, loc, CURB_H, C(M.SIDEWALK, kind, 0), 0);
    // curbs: walls face away from the outer corner (toward asphalt)
    for (let k = 0; k + 3 < loc.length; k += 2) {
      if (!curb[k / 2]) continue;
      const ax = loc[k], az = loc[k + 1], bx = loc[k + 2], bz = loc[k + 3];
      // choose side: the outer corner must be on the back side
      const dx = bx - ax, dz = bz - az;
      const rx = -dz, rz = dx; // right of a->b
      const side = (ox - ax) * rx + (oz - az) * rz > 0 ? -1 : 1;
      this.wall(ax, az, bx, bz, -0.02, CURB_H, side, C(M.CURB, kind, 0), 0);
    }
    // skirts on cell edges where no arm continues
    if (this.net.bAxis[this.ci] < 0) {
      if (!hasA && !this.neighborIsRoad(dA)) {
        // edge dA spans beta in [0, 8] on this quadrant; along +right(dA) = dB direction
        this.edgeSkirtPart(dA, 0, HALF, CURB_H, C(M.CURB, kind, 0));
      }
      if (!hasB && !this.neighborIsRoad(dB)) {
        // edge dB: along +right(dB) = -dA direction  -> lateral from -8..0 covers alpha 8..0
        this.edgeSkirtPart(dB, -HALF, 0, CURB_H, C(M.CURB, kind, 0));
      }
    }
    // traffic light for drivers coming from arm B (their near-right corner is this quadrant)
    if (signal && hasB) {
      const rfx = hasA ? Math.max(0.5, rf) : 0.6;
      const al = Math.min(b + 0.55, HALF - 0.35), be = Math.min(b + rfx + 0.25, HALF - 0.35);
      const [lx, lz] = L(al, be);
      const y = this.Y(lx, lz) + CURB_H;
      this.out.props.push({ model: 'traffic_light', variant: 0, x: this.ox + lx, y, z: this.oz + lz, yaw: Math.atan2(DX[dB], DZ[dB]), scale: 1 });
    }
  }

  private deadEnd(t: number, d: number, aE: number): void {
    const kind = t;
    const Rb = t === Network.Street ? 6.0 : 7.2;
    // asphalt disk
    this.mapNone();
    const segs = 20;
    const disk: number[] = [];
    for (let k = 0; k <= segs; k++) { const an = (TWO_PI * k) / segs; disk.push(Rb * Math.cos(an), Rb * Math.sin(an)); }
    this.sfan(0, 0, disk, 0, C(M.ASPHALT, kind, F.PLAIN), 0);
    let phi0 = 0;
    const baseAng = d >= 0 ? Math.atan2(DZ[d], DX[d]) : 0;
    if (d >= 0) {
      this.mapStraight(d);
      const [ax, az] = this.lp(d, -aE - 0.02, 0), [bx, bz] = this.lp(d, aE + 0.02, 0), [cx, cz] = this.lp(d, aE + 0.02, HALF), [dx, dz] = this.lp(d, -aE - 0.02, HALF);
      this.squad(ax, az, bx, bz, cx, cz, dx, dz, 0, C(M.ASPHALT, kind, F.LANES), 0);
      phi0 = Math.asin(Math.min(0.999, aE / Rb));
    }
    if (!hasSidewalk(t)) return;
    this.mapNone();
    // polar ring from Rb to the square boundary over [phi0, 2pi - phi0] relative to baseAng
    const angs: number[] = [];
    const a0 = phi0, a1 = TWO_PI - phi0;
    const nSeg = 24;
    for (let k = 0; k <= nSeg; k++) angs.push(a0 + ((a1 - a0) * k) / nSeg);
    // insert square corners
    for (const c of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      const ca = wrapPi(c - baseAng);
      const cc = ca < 0 ? ca + TWO_PI : ca;
      if (cc > a0 && cc < a1) angs.push(cc);
    }
    angs.sort((p, q) => p - q);
    const bnd = (an: number) => HALF / Math.max(Math.abs(Math.cos(an)), Math.abs(Math.sin(an)));
    const curbPts: number[] = [];
    for (let k = 0; k + 1 < angs.length; k++) {
      const ta = angs[k] + baseAng, tb = angs[k + 1] + baseAng;
      const ca = Math.cos(ta), sa = Math.sin(ta), cb = Math.cos(tb), sb = Math.sin(tb);
      const ba = bnd(ta), bb = bnd(tb);
      this.squad(Rb * ca, Rb * sa, ba * ca, ba * sa, bb * cb, bb * sb, Rb * cb, Rb * sb, CURB_H, C(M.SIDEWALK, kind, 0), 0);
      if (k === 0) curbPts.push(Rb * ca, Rb * sa);
      curbPts.push(Rb * cb, Rb * sb);
    }
    // curb along the bulb, facing the center
    for (let k = 0; k + 3 < curbPts.length; k += 2) {
      const ax = curbPts[k], az = curbPts[k + 1], bx = curbPts[k + 2], bz = curbPts[k + 3];
      const rx = -(bz - az), rz = bx - ax;
      const side = -ax * rx - az * rz > 0 ? 1 : -1;
      this.wall(ax, az, bx, bz, -0.02, CURB_H, side, C(M.CURB, kind, 0), 0);
    }
    if (d >= 0) {
      // gap polygons on both sides of the arm (arm frame: alpha along d, beta lateral)
      const ex = DX[d], ez = DZ[d], fx = RX[d], fz = RZ[d];
      for (const sg of [1, -1]) {
        const L = (al: number, be: number): [number, number] => [al * ex + sg * be * fx, al * ez + sg * be * fz];
        const xc = Math.sqrt(Math.max(0, Rb * Rb - aE * aE));
        const tn = Math.tan(phi0);
        const poly: [number, number][] = [[xc, aE], [HALF, aE]];
        if (tn * HALF <= HALF) poly.push([HALF, tn * HALF]);
        else { poly.push([HALF, HALF]); poly.push([HALF / tn, HALF]); }
        const loc = poly.map(([al, be]) => L(al, be));
        const pts: number[] = [];
        for (let k = 1; k < loc.length; k++) pts.push(loc[k][0], loc[k][1]);
        this.sfan(loc[0][0], loc[0][1], pts, CURB_H, C(M.SIDEWALK, kind, 0), 0);
        // curb along the arm edge
        const [p0x, p0z] = L(xc, aE), [p1x, p1z] = L(HALF, aE);
        const rx = -(p1z - p0z), rz = p1x - p0x;
        const [axx, axz] = L(xc, 0);
        const side = (axx - p0x) * rx + (axz - p0z) * rz > 0 ? 1 : -1;
        this.wall(p0x, p0z, p1x, p1z, -0.02, CURB_H, side, C(M.CURB, kind, 0), 0);
      }
    }
    if (this.net.bAxis[this.ci] < 0) {
      for (let e = 0; e < 4; e++) {
        if (e === d) continue;
        if (!this.neighborIsRoad(e)) this.edgeSkirt(e, CURB_H, C(M.CURB, kind, 0));
      }
    }
  }

  // ------------------------------------------------------------------ streetlights
  /** streetlight at (u,s) of heading h; arm points toward lateral direction armSide (+1 = +u) */
  private addStreetlight(h: number, u: number, s: number, armSide: number, lift: number, tint: number): void {
    const [lx, lz] = this.lp(h, u, s);
    const Dx = RX[h] * armSide, Dz = RZ[h] * armSide;
    this.addStreetlightAt(lx, lz, Dx, Dz, lift, tint);
  }
  private addStreetlightAt(lx: number, lz: number, Dx: number, Dz: number, lift: number, tint: number): void {
    const y = this.Y(lx, lz) + lift;
    const hsh = ((this.cx * 928371) ^ (this.cz * 364479)) >>> 0;
    // model arm points toward -X: yaw so that local -X maps to D
    const yaw = Math.atan2(Dz, -Dx);
    const variant = tint === 1 ? 1 : hsh & 1 ? 0 : 0;
    this.out.props.push({ model: 'streetlight', variant, x: this.ox + lx, y, z: this.oz + lz, yaw, scale: 1 });
    const reach = this.light.reach;
    const px = lx + Dx * reach, pz = lz + Dz * reach;
    this.out.pools.push({
      x: this.ox + px, y: this.Y(px, pz) + 0.04, z: this.oz + pz, r: tint === 1 ? 9 : 7.5, tint,
      hx: this.ox + px, hy: y + this.light.height - 0.35, hz: this.oz + pz,
    });
  }

  // ------------------------------------------------------------------ rail
  private railCell(m: number): void {
    const cnt = popcount4(m);
    if (cnt === 2 && (m === 5 || m === 10)) {
      this.trackStraight(m === 5 ? 0 : 1, -HALF, HALF);
    } else if (cnt === 2) {
      let d1 = -1, d2 = -1;
      for (let d = 0; d < 4; d++) if (m & (1 << d)) { if (d1 < 0) d1 = d; else d2 = d; }
      this.trackArc(d1, d2);
    } else if (cnt === 1) {
      let d = 0;
      while (!(m & (1 << d))) d++;
      this.trackStraight(d, -3, HALF);
      // buffer stop
      const [lx, lz] = this.lp(d, 0, -3.2);
      this.bufferStop(lx, lz, d);
    } else if (cnt === 0) {
      this.trackStraight(0, -6, 6);
    } else {
      if ((m & 5) === 5) this.trackStraight(0, -HALF, HALF);
      if ((m & 10) === 10) this.trackStraight(1, -HALF, HALF);
      for (let d = 0; d < 4; d++) {
        if (!(m & (1 << d)) || m & (1 << OPP[d])) continue;
        for (const e of [(d + 1) & 3, (d + 3) & 3]) if (m & (1 << e)) this.trackArc(d, e);
      }
    }
    // skirt-less; ballast sits on terrain
  }

  private bufferStop(lx: number, lz: number, d: number): void {
    const y = this.Y(lx, lz) + 0.35;
    const code = C(M.METAL, Network.Rail, 1);
    const r = (d + 1) & 3;
    const w = 1.3, dep = 0.5, hgt = 1.2;
    const p = (a: number, b: number): [number, number] => [lx + DX[r] * a + DX[d] * b, lz + DZ[r] * a + DZ[d] * b];
    const [ax, az] = p(-w, -dep), [bx, bz] = p(w, -dep), [cx, cz] = p(w, dep), [dx, dz] = p(-w, dep);
    // top
    this.quad3(ax, y + hgt, az, bx, y + hgt, bz, cx, y + hgt, cz, dx, y + hgt, dz, 0, 1, 0, code, 0);
    // sides
    const sides: [number, number, number, number][] = [[ax, az, bx, bz], [bx, bz, cx, cz], [cx, cz, dx, dz], [dx, dz, ax, az]];
    for (const [x0, z0, x1, z1] of sides) {
      const mx = (x0 + x1) / 2 - lx, mz = (z0 + z1) / 2 - lz;
      this.quad3(x0, y, z0, x1, y, z1, x1, y + hgt, z1, x0, y + hgt, z0, mx, 0, mz, code, 0);
    }
  }

  /** emit ballast + sleepers + rails along a path given by sample points & tangents (local coords) */
  private trackPath(px: number[], pz: number[], tx: number[], tz: number[]): void {
    const k0 = this.trackIdx++;
    const dl = k0 * 0.012;
    const n = px.length;
    const kind = Network.Rail;
    const ballast = [-2.9, -0.06, -1.9, 0.32 + dl, 1.9, 0.32 + dl, 2.9, -0.06];
    const bmat = [C(M.BALLAST, kind, 1), C(M.BALLAST, kind, 0), C(M.BALLAST, kind, 1)];
    const Yb = (x: number, z: number) => this.Y(x, z);
    // ballast
    for (let k = 0; k + 1 < n; k++) {
      const rax = -tz[k], raz = tx[k], rbx = -tz[k + 1], rbz = tx[k + 1];
      for (let p = 0; p + 3 < ballast.length; p += 2) {
        const ua = ballast[p], la = ballast[p + 1], ub = ballast[p + 2], lb = ballast[p + 3];
        const ax = px[k] + rax * ua, az = pz[k] + raz * ua, bx = px[k] + rax * ub, bz = pz[k] + raz * ub;
        const cx = px[k + 1] + rbx * ub, cz = pz[k + 1] + rbz * ub, dx = px[k + 1] + rbx * ua, dz = pz[k + 1] + rbz * ua;
        const hu = (ua + ub) / 2;
        this.quad3(ax, Yb(ax, az) + la, az, bx, Yb(bx, bz) + lb, bz, cx, Yb(cx, cz) + lb, cz, dx, Yb(dx, dz) + la, dz, rax * hu * 0.3, 1, raz * hu * 0.3, bmat[p / 2], 0);
      }
    }
    // cumulative length
    const cum: number[] = [0];
    for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(px[k] - px[k - 1], pz[k] - pz[k - 1]));
    const total = cum[n - 1];
    const sample = (s: number): [number, number, number, number] => {
      let k = 0;
      while (k < n - 2 && cum[k + 1] < s) k++;
      const f = Math.min(1, Math.max(0, (s - cum[k]) / Math.max(1e-6, cum[k + 1] - cum[k])));
      let ttx = tx[k] + (tx[k + 1] - tx[k]) * f, ttz = tz[k] + (tz[k + 1] - tz[k]) * f;
      const l = Math.hypot(ttx, ttz) || 1;
      ttx /= l; ttz /= l;
      return [px[k] + (px[k + 1] - px[k]) * f, pz[k] + (pz[k + 1] - pz[k]) * f, ttx, ttz];
    };
    // sleepers (world-phase aligned so neighbouring cells line up)
    const sp = 0.8;
    const scode = C(M.SLEEPER, kind, 0);
    const top0 = 0.32 + dl, top1 = 0.47 + dl;
    for (let s = sp / 2; s < total; s += sp) {
      const [cx, cz, ttx, ttz] = sample(s);
      const rx = -ttz, rz = ttx;
      const hw = 1.3, hd = 0.13;
      const P = (a: number, b: number): [number, number] => [cx + rx * a + ttx * b, cz + rz * a + ttz * b];
      const [ax, az] = P(-hw, -hd), [bx, bz] = P(hw, -hd), [ccx, ccz] = P(hw, hd), [dx, dz] = P(-hw, hd);
      const y0 = this.Y(cx, cz);
      const ya = y0 + top1, yb = y0 + top0;
      this.quad3(ax, ya, az, bx, ya, bz, ccx, ya, ccz, dx, ya, dz, 0, 1, 0, scode, 0);
      this.quad3(ax, yb, az, bx, yb, bz, bx, ya, bz, ax, ya, az, -ttx, 0, -ttz, scode, 0);
      this.quad3(dx, yb, dz, ccx, yb, ccz, ccx, ya, ccz, dx, ya, dz, ttx, 0, ttz, scode, 0);
    }
    // rails
    const rcode = C(M.RAIL, kind, 0);
    const g = 0.7175, rw = 0.04, rTop = 0.63 + dl;
    for (const side of [-1, 1]) {
      for (let k = 0; k + 1 < n; k++) {
        const rax = -tz[k], raz = tx[k], rbx = -tz[k + 1], rbz = tx[k + 1];
        const P = (kk: number, rx: number, rz: number, off: number): [number, number] => [px[kk] + rx * off, pz[kk] + rz * off];
        const u0 = side * g - rw, u1 = side * g + rw;
        const [a0x, a0z] = P(k, rax, raz, u0), [a1x, a1z] = P(k, rax, raz, u1), [b1x, b1z] = P(k + 1, rbx, rbz, u1), [b0x, b0z] = P(k + 1, rbx, rbz, u0);
        const ya0 = this.Y(a0x, a0z), ya1 = this.Y(a1x, a1z), yb1 = this.Y(b1x, b1z), yb0 = this.Y(b0x, b0z);
        // top
        this.quad3(a0x, ya0 + rTop, a0z, a1x, ya1 + rTop, a1z, b1x, yb1 + rTop, b1z, b0x, yb0 + rTop, b0z, 0, 1, 0, rcode, 1);
        // sides
        this.quad3(a0x, ya0 + top1, a0z, b0x, yb0 + top1, b0z, b0x, yb0 + rTop, b0z, a0x, ya0 + rTop, a0z, -rax, 0, -raz, rcode, 0);
        this.quad3(a1x, ya1 + top1, a1z, b1x, yb1 + top1, b1z, b1x, yb1 + rTop, b1z, a1x, ya1 + rTop, a1z, rax, 0, raz, rcode, 0);
      }
    }
  }

  private trackStraight(h: number, s0: number, s1: number): void {
    this.mapStraight(h);
    const n = Math.max(1, Math.ceil((s1 - s0) / 8.1));
    const px: number[] = [], pz: number[] = [], tx: number[] = [], tz: number[] = [];
    for (let k = 0; k <= n; k++) {
      const s = s0 + ((s1 - s0) * k) / n;
      px.push(DX[h] * s); pz.push(DZ[h] * s); tx.push(DX[h]); tz.push(DZ[h]);
    }
    this.trackPath(px, pz, tx, tz);
  }

  private trackArc(d1: number, d2: number): void {
    this.mapNone();
    const Px = (DX[d1] + DX[d2]) * HALF, Pz = (DZ[d1] + DZ[d2]) * HALF;
    const th1 = Math.atan2(DZ[d1] * HALF - Pz, DX[d1] * HALF - Px);
    const th2 = Math.atan2(DZ[d2] * HALF - Pz, DX[d2] * HALF - Px);
    const dth = wrapPi(th2 - th1);
    const n = 10;
    const px: number[] = [], pz: number[] = [], tx: number[] = [], tz: number[] = [];
    const sg = dth > 0 ? 1 : -1;
    for (let k = 0; k <= n; k++) {
      const th = th1 + (dth * k) / n;
      px.push(Px + HALF * Math.cos(th)); pz.push(Pz + HALF * Math.sin(th));
      tx.push(-Math.sin(th) * sg); tz.push(Math.cos(th) * sg);
    }
    this.trackPath(px, pz, tx, tz);
  }

  // ------------------------------------------------------------------ level crossing
  private levelCrossing(cr: number): void {
    const net = this.net;
    const t = net.roadType[this.ci] || Network.Road;
    const kind = t;
    const h = cr === 1 ? 1 : 0; // road heading axis
    const railH = cr === 1 ? 0 : 1;
    const a = HALF_W[t];
    const band = 2.2;
    this.mapStraight(h);
    const q = (u0: number, u1: number, s0: number, s1: number, lift: number, code: number, ww: number) => {
      const [ax, az] = this.lp(h, u0, s0), [bx, bz] = this.lp(h, u1, s0), [cx, cz] = this.lp(h, u1, s1), [dx, dz] = this.lp(h, u0, s1);
      this.squad(ax, az, bx, bz, cx, cz, dx, dz, lift, code, ww);
    };
    const wl = (u0: number, s0: number, u1: number, s1: number, l0: number, l1: number, side: number, code: number) => {
      const [ax, az] = this.lp(h, u0, s0), [bx, bz] = this.lp(h, u1, s1);
      this.wall(ax, az, bx, bz, l0, l1, side, code, 0);
    };
    q(-a - 0.02, a + 0.02, -HALF, HALF, 0, C(M.ASPHALT, kind, F.CROSSING), 0);
    // concrete panel band across the whole cell (rail axis = s ~ 0 band)
    q(-HALF, HALF, -band, band, 0.05, C(M.PANEL, kind, 0), 0);
    if (hasSidewalk(t)) {
      for (const sg of [1, -1]) {
        for (const [s0, s1] of [[-HALF, -band], [band, HALF]]) {
          q(sg * a, sg * HALF, s0, s1, CURB_H, C(M.SIDEWALK, kind, 1), 0);
          wl(sg * a, s0, sg * a, s1, -0.02, CURB_H, -sg, C(M.CURB, kind, 0));
        }
        // sidewalk ends at the band
        wl(sg * a, -band, sg * HALF, -band, 0.0, CURB_H, -sg, C(M.CURB, kind, 0));
        wl(sg * a, band, sg * HALF, band, 0.0, CURB_H, sg, C(M.CURB, kind, 0));
      }
    }
    // embedded rails across (along the rail heading) on the panel
    this.mapStraight(railH);
    const rcode = C(M.RAIL, Network.Rail, 0);
    const g = 0.7175;
    for (const side of [-1, 1]) {
      const u0 = side * g - 0.045, u1 = side * g + 0.045;
      const P = (u: number, s: number): [number, number] => [s * DX[railH] + u * RX[railH], s * DZ[railH] + u * RZ[railH]];
      const [ax, az] = P(u0, -HALF), [bx, bz] = P(u1, -HALF), [cx, cz] = P(u1, HALF), [dx, dz] = P(u0, HALF);
      this.squad(ax, az, bx, bz, cx, cz, dx, dz, 0.075, rcode, 1);
    }
    // crossing gates on the right side of each approach
    this.mapStraight(h);
    for (const dir of [1, -1]) {
      // traffic heading dir*h: approaches from s = -dir*band side; right side is u = dir * (...)
      const u = dir * (a + 0.7), s = -dir * (band + 0.9);
      const [lx, lz] = this.lp(h, u, s);
      // arm extends across the road toward -u*dir: model arm along -X
      const Dx = -RX[h] * dir, Dz = -RZ[h] * dir;
      this.out.props.push({ model: '__xing_gate', variant: 0, x: this.ox + lx, y: this.Y(lx, lz) + (hasSidewalk(t) ? CURB_H : 0), z: this.oz + lz, yaw: Math.atan2(Dz, -Dx), scale: 1 });
    }
  }

  // ------------------------------------------------------------------ tunnels
  private tunnelCell(t: number): void {
    // Portal where a tunnel meets a non-tunnel neighbour along its axis.
    const net = this.net;
    const N = net.N;
    const m = t === Network.Rail ? net.railMask[this.ci] : net.roadMask[this.ci];
    const code = C(M.CONCRETE, t, 1);
    for (let d = 0; d < 4; d++) {
      if (!(m & (1 << d))) continue;
      const nx = this.cx + DX[d], nz = this.cz + DZ[d];
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      if (net.state.netFlags[nz * N + nx] & NF_TUNNEL) continue;
      const w = t === Network.Rail ? 3.4 : Math.min(HALF - 0.5, HALF_W[t] + 1.2);
      const hgt = t === Network.Rail ? 7 : 6.5;
      this.mapStraight(d);
      const s = HALF - 0.4;
      const y0 = this.Y(DX[d] * s, DZ[d] * s);
      const P = (u: number, ss: number): [number, number] => this.lp(d, u, ss);
      // portal facade (facing outward along d) : frame around the opening
      const th = 1.2;
      const box = (u0: number, u1: number, yb: number, yt: number) => {
        const [ax, az] = P(u0, s), [bx, bz] = P(u1, s), [cx, cz] = P(u1, s - th), [dx, dz] = P(u0, s - th);
        this.quad3(ax, y0 + yb, az, bx, y0 + yb, bz, bx, y0 + yt, bz, ax, y0 + yt, az, DX[d], 0, DZ[d], code, 0);
        this.quad3(ax, y0 + yt, az, bx, y0 + yt, bz, cx, y0 + yt, cz, dx, y0 + yt, dz, 0, 1, 0, code, 0);
      };
      box(-w - 1.5, -w, -1, hgt + 1.5);
      box(w, w + 1.5, -1, hgt + 1.5);
      box(-w, w, hgt, hgt + 1.5);
      // dark opening
      const [ax, az] = P(-w, s - 0.3), [bx, bz] = P(w, s - 0.3);
      this.quad3(ax, y0 - 0.5, az, bx, y0 - 0.5, bz, bx, y0 + hgt, bz, ax, y0 + hgt, az, DX[d], 0, DZ[d], C(M.TUNNEL, t, 0), 0);
      // road surface up to the portal
      if (t !== Network.Rail) {
        const [p0x, p0z] = P(-w, HALF), [p1x, p1z] = P(w, HALF), [p2x, p2z] = P(w, s - 0.3), [p3x, p3z] = P(-w, s - 0.3);
        this.squad(p0x, p0z, p1x, p1z, p2x, p2z, p3x, p3z, 0, C(M.ASPHALT, t, F.LANES), 0);
      }
    }
  }

  // ------------------------------------------------------------------ bridges
  private bridgeStructure(t: number): void {
    const net = this.net;
    const ax = net.bAxis[this.ci];
    const h = ax; // heading 0 (x) or 1 (z)
    this.mapStraight(h);
    const rail = t === Network.Rail;
    const W = rail ? 3.6 : HALF;
    const topLift = rail ? 0 : hasSidewalk(t) ? CURB_H : 0;
    const deckTh = 1.4;
    const code = C(M.CONCRETE, t, 0);
    const steps = 4;
    const L = (u: number, s: number): [number, number] => this.lp(h, u, s);
    // side walls + parapets + bottom
    for (let k = 0; k < steps; k++) {
      const s0 = -HALF + (2 * HALF * k) / steps, s1 = -HALF + (2 * HALF * (k + 1)) / steps;
      for (const sg of [1, -1]) {
        const [ax0, az0] = L(sg * W, s0), [ax1, az1] = L(sg * W, s1);
        const ya = this.Y(ax0, az0), yb = this.Y(ax1, az1);
        const hx = RX[h] * sg, hz = RZ[h] * sg;
        // outer face from bottom to parapet top
        this.quad3(ax0, ya - deckTh, az0, ax1, yb - deckTh, az1, ax1, yb + topLift + 1.0, az1, ax0, ya + topLift + 1.0, az0, hx, 0, hz, code, 0);
        // parapet inner face + top
        const [bx0, bz0] = L(sg * (W - 0.32), s0), [bx1, bz1] = L(sg * (W - 0.32), s1);
        const yc = this.Y(bx0, bz0), yd = this.Y(bx1, bz1);
        this.quad3(bx0, yc + topLift - 0.02, bz0, bx1, yd + topLift - 0.02, bz1, bx1, yd + topLift + 1.0, bz1, bx0, yc + topLift + 1.0, bz0, -hx, 0, -hz, code, 1);
        this.quad3(bx0, yc + topLift + 1.0, bz0, bx1, yd + topLift + 1.0, bz1, ax1, yb + topLift + 1.0, az1, ax0, ya + topLift + 1.0, az0, 0, 1, 0, code, 1);
        if (rail) {
          // deck top beside the ballast
          const [cx0, cz0] = L(sg * 2.8, s0), [cx1, cz1] = L(sg * 2.8, s1);
          this.quad3(cx0, this.Y(cx0, cz0) - 0.02, cz0, cx1, this.Y(cx1, cz1) - 0.02, cz1, bx1, yd - 0.02, bz1, bx0, yc - 0.02, bz0, 0, 1, 0, code, 0);
        }
      }
      // bottom
      const [p0x, p0z] = L(-W, s0), [p1x, p1z] = L(W, s0), [p2x, p2z] = L(W, s1), [p3x, p3z] = L(-W, s1);
      this.quad3(p0x, this.Y(p0x, p0z) - deckTh, p0z, p1x, this.Y(p1x, p1z) - deckTh, p1z, p2x, this.Y(p2x, p2z) - deckTh, p2z, p3x, this.Y(p3x, p3z) - deckTh, p3z, 0, -1, 0, code, 0);
    }
    // pier at cell center
    const terr = this.surf.terrain(this.ox, this.oz);
    const deckBottom = this.Y(0, 0) - deckTh;
    if (deckBottom - terr > 1.2) {
      const pw = rail ? 2.4 : 5.2, pt = 0.9;
      const yb = terr - 1.5, yt = deckBottom - 0.8;
      this.pierBox(h, 0, pw, pt, yb, yt, code);
      this.pierBox(h, 0, W - 0.2, pt + 0.25, yt, deckBottom + 0.05, code);
    }
  }

  private pierBox(h: number, sC: number, hu: number, hs: number, y0: number, y1: number, code: number): void {
    const L = (u: number, s: number): [number, number] => this.lp(h, u, s);
    const c = [L(-hu, sC - hs), L(hu, sC - hs), L(hu, sC + hs), L(-hu, sC + hs)];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = c[k], [bx, bz] = c[(k + 1) & 3];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      this.quad3(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az, mx, 0, mz, code, 0);
    }
  }
}
