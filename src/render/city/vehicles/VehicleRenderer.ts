/**
 * VehicleRenderer — road vehicles + trains in one BatchedMesh.
 *
 * Road vehicles drive right-hand lanes on a per-cell path (straight / quarter arc turn / cul-de-sac U-turn), follow
 * ctx.getTrafficRoutes() routes when available (respawn at route end), otherwise traffic-weighted random walks.
 * Density ~ traffic volume, speed reduced by congestion, simple car-following (queues) and 2-phase signals at
 * signalized intersections. Trains (loco + cars) follow rail cells using a path history.
 * All state lives in typed arrays; the per-frame loop allocates nothing.
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../../core/constants';
import { Network } from '../../../core/types';
import type { CityState } from '../../../sim/CityState';
import { getModelGeometry, hasModel } from '../../../assets/registry';
import { MANIFEST_BY_ID } from '../../../assets/manifest';
import { ModelBuilder } from '../../../assets/ModelBuilder';
import { Surf } from '../../../core/types';
import { car as kitCar, CAR_COLORS } from '../../../assets/kit';
import { sharedUniforms } from '../../../assets/materials';
import { DynamicBatch, type TileCuller } from '../common/batch';
import { getCityMaterial } from '../common/cityMaterial';
import { DX, DZ, OPP, RX, RZ, NF_TUNNEL, oneWayDir, type NetInfo } from '../common/netinfo';
import type { RoadSurface } from '../common/surface';

export interface TrafficRoute {
  cells: Uint32Array;
  kind: string;
  weight: number;
}
export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

const K_CAR = 0, K_BUS = 1, K_TRUCK = 2, K_SERVICE = 3;
const CAR_MODELS: [string, number][] = [['car_sedan', 30], ['car_hatch', 22], ['car_suv', 18], ['car_pickup', 8], ['car_taxi', 5], ['car_van', 7]];
const TRUCK_MODELS: [string, number][] = [['truck_box', 50], ['truck_semi', 30], ['car_van', 20]];
const SERVICE_MODELS: [string, number][] = [['car_police', 35], ['ambulance', 20], ['fire_truck', 10], ['garbage_truck', 35]];
const CAPS: Record<QualityLevel, number> = { low: 600, medium: 1500, high: 2500, ultra: 4000 };
const TRAIN_CAPS: Record<QualityLevel, number> = { low: 3, medium: 6, high: 10, ultra: 16 };
const SPEED = [0, 7, 9.5, 12, 10, 21, 17];
const TWO_PI = Math.PI * 2;

function laneCount(t: number): number {
  return t === Network.OneWay || t === Network.Avenue || t === Network.Highway ? 2 : 1;
}
function laneOff(t: number, lane: number): number {
  switch (t) {
    case Network.Street: return 1.8;
    case Network.Road: return 1.9;
    case Network.OneWay: return lane ? 2.4 : -2.4;
    case Network.Avenue: return lane ? 5.35 : 2.45;
    case Network.Highway: return lane ? 5.75 : 2.5;
    default: return 1.9;
  }
}
function edgeOff(ta: number, tb: number, lane: number): number {
  if (!tb) return laneOff(ta, Math.min(lane, laneCount(ta) - 1));
  const oa = ta === Network.OneWay, ob = tb === Network.OneWay;
  if (oa !== ob) {
    const t2 = oa ? tb : ta;
    return laneOff(t2, 0);
  }
  const t = laneCount(tb) < laneCount(ta) ? tb : ta;
  return laneOff(t, Math.min(lane, laneCount(t) - 1));
}
function wrapPi(a: number): number {
  while (a > Math.PI) a -= TWO_PI;
  while (a < -Math.PI) a += TWO_PI;
  return a;
}
function pickWeighted(list: [string, number][], r: number): string {
  let tot = 0;
  for (const [, w] of list) tot += w;
  let x = r * tot;
  for (const [id, w] of list) { x -= w; if (x <= 0) return id; }
  return list[list.length - 1][0];
}

/** simple stand-in vehicle meshes for models that are not registered yet */
function fallbackVehicle(id: string, variant: number): THREE.BufferGeometry {
  const b = new ModelBuilder();
  const col = CAR_COLORS[variant % CAR_COLORS.length];
  if (id === 'bus') {
    b.paint(0xe0b020, Surf.Metal).box(-1.25, 0.35, -6, 1.25, 3.1, 6, { bottom: null });
    b.paint(0x1a2028, Surf.GlassPlain).box(-1.27, 1.4, -5.6, 1.27, 2.5, 5.9, { top: null, bottom: null });
  } else if (id.startsWith('truck') || id === 'garbage_truck' || id === 'fire_truck') {
    const c = id === 'fire_truck' ? 0xc01818 : id === 'garbage_truck' ? 0x2f7a3a : col;
    const L = id === 'truck_semi' ? 8 : 4;
    b.paint(c, Surf.Metal).box(-1.2, 0.4, L - 2.2, 1.2, 2.9, L, { bottom: null });
    b.paint(0x1a2028, Surf.GlassPlain).box(-1.1, 1.9, L - 0.2, 1.1, 2.6, L + 0.02, { bottom: null, top: null });
    b.paint(id === 'truck_semi' ? 0xd8d8d8 : 0xe8e4dc, Surf.Plain).box(-1.25, 0.5, -L, 1.25, 3.6, L - 2.4, { bottom: null });
  } else if (id === 'train_loco' || id === 'train_car') {
    b.paint(id === 'train_loco' ? 0xb02020 : 0x5a6a7a, Surf.Metal).box(-1.5, 0.9, -9.8, 1.5, 4.1, 9.8, { bottom: null });
    b.paint(0x1a2028, Surf.GlassPlain).box(-1.52, 2.4, -9, 1.52, 3.3, 9, { top: null, bottom: null });
    b.paint(0x202020, Surf.Metal).box(-1.3, 0.2, -8, 1.3, 0.9, 8, { top: null });
  } else {
    kitCar(b, 0, 0, 0, id === 'car_taxi' ? 0xf2c21b : id === 'car_police' ? 0x1b2a4a : id === 'ambulance' ? 0xf0f0f0 : col, 0);
    b.paint(0xfff1c8, Surf.Emissive).box(-0.75, 0.6, 2.2, -0.45, 0.8, 2.25).box(0.45, 0.6, 2.2, 0.75, 0.8, 2.25);
    b.paint(0xff2010, Surf.Emissive).box(-0.8, 0.65, -2.25, -0.5, 0.8, -2.2).box(0.5, 0.65, -2.25, 0.8, 0.8, -2.2);
  }
  const g = b.build();
  g.name = 'fallback:' + id;
  return g;
}

export function vehicleGeometry(id: string, variant: number): THREE.BufferGeometry {
  if (!hasModel(id)) return fallbackVehicle(id, variant);
  return getModelGeometry(id, variant);
}

const HEAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const HEAD_FRAG = /* glsl */ `
uniform float uNight;
varying vec2 vUv;
void main() {
  float along = vUv.y;
  float across = abs(vUv.x - 0.5) * 2.0;
  float a = (1.0 - along) * smoothstep(0.0, 0.12, along) * (1.0 - smoothstep(0.35, 1.0, across));
  a *= a;
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.62) * a * uNight * 0.55, 1.0);
}`;

interface Train {
  inst: number[];
  lens: number[];
  // history ring of segments
  hc: Int32Array;
  hi: Uint8Array;
  ho: Uint8Array;
  hl: Float32Array;
  hn: number;
  cell: number;
  hin: number;
  hout: number;
  t: number;
  len: number;
  speed: number;
  vmax: number;
  alive: boolean;
  wait: number;
}

export class VehicleRenderer {
  readonly batch: DynamicBatch;
  readonly headlights: THREE.InstancedMesh;
  private cap: number;
  private trainCap: number;
  n = 0;
  // SoA state
  private cell!: Int32Array;
  private hin!: Uint8Array;
  private hout!: Uint8Array;
  private lane!: Uint8Array;
  private t!: Float32Array;
  private len!: Float32Array;
  private oin!: Float32Array;
  private oout!: Float32Array;
  private spd!: Float32Array;
  private vfac!: Float32Array;
  private vlen!: Float32Array;
  private kind!: Uint8Array;
  private inst!: Int32Array;
  private route!: Int32Array;
  private ridx!: Int32Array;
  private life!: Float32Array;
  private next!: Int32Array;
  private vis!: Uint8Array;
  private nextB!: Int32Array;
  private usedK!: Int32Array;
  private posX!: Float32Array;
  private posZ!: Float32Array;
  private head: Int32Array;
  // spawn distribution
  private spawnCells = new Int32Array(0);
  private spawnCdf = new Float32Array(0);
  private target = 0;
  private routes: TrafficRoute[] = [];
  private routeCdf = new Float32Array(0);
  private routeTimer = 0;
  private popTimer = 0;
  private time = 0;
  private rngS = 1234567;
  private px = 0;
  private pz = 0;
  private dx = 1;
  private dz = 0;
  private trains: Train[] = [];
  private hidden = false;
  private thin = 1;
  enabled = true;
  /** optional signal state: 1 = signalized intersection */
  signalized: Uint8Array | null = null;
  getRoutes: ((max: number) => TrafficRoute[]) | null = null;
  quality: QualityLevel = 'high';
  private headCount = 0;

  constructor(private state: CityState, private net: NetInfo, private surf: RoadSurface, private culler: TileCuller, quality: QualityLevel = 'high') {
    this.quality = quality;
    this.cap = CAPS[quality];
    this.trainCap = TRAIN_CAPS[quality];
    this.batch = new DynamicBatch(getCityMaterial(), this.cap + 128, 1 << 16, 'vehicles');
    this.batch.mesh.castShadow = quality === 'high' || quality === 'ultra';
    this.batch.mesh.receiveShadow = true;
    this.alloc(this.cap);
    this.head = new Int32Array(net.N * net.N * 8).fill(-1);
    // headlight decals
    const hg = new THREE.PlaneGeometry(1, 1, 1, 1);
    hg.rotateX(-Math.PI / 2);
    // map plane (x in [-.5,.5], z in [-.5,.5]) -> cone from z=2 to z=15 in front of the car
    const pos = hg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i); // -0.5 (far, uv.y=1?) .. 0.5
      const along = 0.5 - z; // 0 near .. 1 far
      const x = pos.getX(i) * (1.6 + along * 5.5);
      pos.setXYZ(i, x, 0.12, 2.0 + along * 13);
    }
    const uv = hg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, (pos.getZ(i) - 2.0) / 13);
    const hm = new THREE.ShaderMaterial({
      vertexShader: HEAD_VERT, fragmentShader: HEAD_FRAG, uniforms: { uNight: sharedUniforms.uNight },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
    });
    this.headlights = new THREE.InstancedMesh(hg, hm, this.cap);
    this.headlights.count = 0;
    this.headlights.frustumCulled = false;
    this.headlights.name = 'headlights';
    this.headlights.renderOrder = 3;
  }

  private alloc(cap: number): void {
    this.cell = new Int32Array(cap);
    this.hin = new Uint8Array(cap);
    this.hout = new Uint8Array(cap);
    this.lane = new Uint8Array(cap);
    this.t = new Float32Array(cap);
    this.len = new Float32Array(cap);
    this.oin = new Float32Array(cap);
    this.oout = new Float32Array(cap);
    this.spd = new Float32Array(cap);
    this.vfac = new Float32Array(cap);
    this.vlen = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.inst = new Int32Array(cap);
    this.route = new Int32Array(cap);
    this.ridx = new Int32Array(cap);
    this.life = new Float32Array(cap);
    this.next = new Int32Array(cap);
    this.vis = new Uint8Array(cap);
    this.nextB = new Int32Array(cap);
    this.usedK = new Int32Array(cap);
    this.posX = new Float32Array(cap);
    this.posZ = new Float32Array(cap);
  }

  setState(state: CityState, net: NetInfo, surf: RoadSurface): void {
    this.clear();
    this.state = state;
    this.net = net;
    this.surf = surf;
    if (this.head.length !== net.N * net.N * 8) this.head = new Int32Array(net.N * net.N * 8).fill(-1);
    this.refreshSpawn();
  }

  setQuality(q: QualityLevel): void {
    if (q === this.quality) return;
    this.quality = q;
    const cap = CAPS[q];
    this.clear();
    this.cap = cap;
    this.trainCap = TRAIN_CAPS[q];
    this.alloc(cap);
    this.batch.mesh.castShadow = q === 'high' || q === 'ultra';
    this.refreshSpawn();
  }

  clear(): void {
    for (let v = 0; v < this.n; v++) this.batch.remove(this.inst[v]);
    this.n = 0;
    for (const tr of this.trains) for (const id of tr.inst) this.batch.remove(id);
    this.trains.length = 0;
  }

  private rand(): number {
    // xorshift32
    let x = this.rngS;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rngS = x >>> 0;
    return this.rngS / 4294967296;
  }

  /** recompute spawn distribution from traffic volumes (call on network / traffic changes) */
  refreshSpawn(): void {
    const st = this.state;
    const N = this.net.N;
    const cells: number[] = [];
    const w: number[] = [];
    let sumT = 0;
    for (let i = 0; i < N * N; i++) {
      const rt = this.net.roadType[i];
      if (!rt || !this.net.roadMask[i]) continue;
      if (st.netFlags[i] & NF_TUNNEL) continue;
      sumT += st.traffic[i];
    }
    const haveTraffic = sumT > 0;
    let total = 0;
    for (let i = 0; i < N * N; i++) {
      const rt = this.net.roadType[i];
      if (!rt || !this.net.roadMask[i]) continue;
      if (st.netFlags[i] & NF_TUNNEL) continue;
      let d: number;
      if (haveTraffic) d = Math.min(2.2, st.traffic[i] / 1400);
      else d = rt === Network.Highway ? 0.7 : rt === Network.Avenue ? 0.55 : rt === Network.Street ? 0.12 : 0.3;
      if (d <= 0.01) continue;
      cells.push(i);
      total += d;
      w.push(total);
    }
    this.spawnCells = Int32Array.from(cells);
    this.spawnCdf = Float32Array.from(w);
    this.target = Math.min(this.cap, Math.round(total));
  }

  private refreshRoutes(): void {
    if (!this.getRoutes) { this.routes = []; return; }
    try {
      const r = this.getRoutes(Math.min(1024, this.cap));
      this.routes = (r || []).filter((q) => q && q.cells && q.cells.length >= 2 && q.kind !== 'train');
    } catch {
      this.routes = [];
    }
    let tot = 0;
    this.routeCdf = new Float32Array(this.routes.length);
    for (let i = 0; i < this.routes.length; i++) { tot += Math.max(0.001, this.routes[i].weight || 1); this.routeCdf[i] = tot; }
  }

  private sampleCdf(cdf: Float32Array): number {
    if (!cdf.length) return -1;
    const x = this.rand() * cdf[cdf.length - 1];
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
  }

  // ------------------------------------------------------------------ paths
  private typeAt(i: number): number {
    return i >= 0 ? this.net.roadType[i] : 0;
  }

  private neighbor(i: number, d: number): number {
    const N = this.net.N;
    const x = (i % N) + DX[d], z = ((i / N) | 0) + DZ[d];
    if (x < 0 || z < 0 || x >= N || z >= N) return -1;
    return z * N + x;
  }

  /** path length inside cell for entry heading hi, exit heading ho, lane offsets */
  private pathLen(hi: number, ho: number, oi: number, oo: number): number {
    const H = CELL_SIZE / 2;
    if (ho === hi) {
      const ex = -DX[hi] * H + RX[hi] * oi, ez = -DZ[hi] * H + RZ[hi] * oi;
      const xx = DX[hi] * H + RX[hi] * oo, xz = DZ[hi] * H + RZ[hi] * oo;
      return Math.hypot(xx - ex, xz - ez);
    }
    if (ho === OPP[hi]) return 2 * H + Math.PI * Math.max(0.5, Math.abs(oi));
    const cx = -DX[hi] * H + DX[ho] * H, cz = -DZ[hi] * H + DZ[ho] * H;
    const ex = -DX[hi] * H + RX[hi] * oi, ez = -DZ[hi] * H + RZ[hi] * oi;
    const xx = DX[ho] * H + RX[ho] * oo, xz = DZ[ho] * H + RZ[ho] * oo;
    const rE = Math.hypot(ex - cx, ez - cz), rX = Math.hypot(xx - cx, xz - cz);
    return (Math.PI / 2) * (rE + rX) * 0.5;
  }

  /** evaluate position (this.px/pz) and heading (this.dx/dz) at distance s along the cell path */
  private evalPath(ci: number, hi: number, ho: number, oi: number, oo: number, s: number, L: number): void {
    const N = this.net.N;
    const H = CELL_SIZE / 2;
    const ox = ((ci % N) + 0.5) * CELL_SIZE, oz = (((ci / N) | 0) + 0.5) * CELL_SIZE;
    if (ho === hi) {
      const ex = ox - DX[hi] * H + RX[hi] * oi, ez = oz - DZ[hi] * H + RZ[hi] * oi;
      const xx = ox + DX[hi] * H + RX[hi] * oo, xz = oz + DZ[hi] * H + RZ[hi] * oo;
      const f = s / L;
      this.px = ex + (xx - ex) * f; this.pz = ez + (xz - ez) * f;
      this.dx = (xx - ex) / L; this.dz = (xz - ez) / L;
      return;
    }
    if (ho === OPP[hi]) {
      const o = Math.max(0.5, Math.abs(oi));
      if (s < H) {
        this.px = ox - DX[hi] * H + RX[hi] * o + DX[hi] * s; this.pz = oz - DZ[hi] * H + RZ[hi] * o + DZ[hi] * s;
        this.dx = DX[hi]; this.dz = DZ[hi];
      } else if (s < H + Math.PI * o) {
        const a = Math.atan2(RZ[hi], RX[hi]) - (s - H) / o;
        const c = Math.cos(a), sn = Math.sin(a);
        this.px = ox + o * c; this.pz = oz + o * sn;
        this.dx = sn; this.dz = -c;
      } else {
        const s3 = s - H - Math.PI * o;
        this.px = ox - RX[hi] * o - DX[hi] * s3; this.pz = oz - RZ[hi] * o - DZ[hi] * s3;
        this.dx = -DX[hi]; this.dz = -DZ[hi];
      }
      return;
    }
    const cx = ox - DX[hi] * H + DX[ho] * H, cz = oz - DZ[hi] * H + DZ[ho] * H;
    const ex = ox - DX[hi] * H + RX[hi] * oi, ez = oz - DZ[hi] * H + RZ[hi] * oi;
    const xx = ox + DX[ho] * H + RX[ho] * oo, xz = oz + DZ[ho] * H + RZ[ho] * oo;
    const aE = Math.atan2(ez - cz, ex - cx), aX = Math.atan2(xz - cz, xx - cx);
    const da = wrapPi(aX - aE);
    const rE = Math.hypot(ex - cx, ez - cz), rX = Math.hypot(xx - cx, xz - cz);
    const f = Math.min(1, s / L);
    const a = aE + da * f, r = rE + (rX - rE) * f;
    const c = Math.cos(a), sn = Math.sin(a);
    this.px = cx + r * c; this.pz = cz + r * sn;
    const sg = da > 0 ? 1 : -1;
    this.dx = -sn * sg; this.dz = c * sg;
  }

  /** choose exit heading for road cell ci entered with heading hi (random walk); -1 if impossible */
  private chooseExit(ci: number, hi: number): number {
    const net = this.net;
    const st = this.state;
    const m = net.roadMask[ci];
    const t = net.roadType[ci];
    const ow = t === Network.OneWay ? oneWayDir(st.netFlags[ci]) : -1;
    let tot = 0;
    const w0 = [0, 0, 0, 0];
    for (let d = 0; d < 4; d++) {
      if (!(m & (1 << d)) || d === OPP[hi]) continue;
      if (ow >= 0 && d === OPP[ow]) continue;
      const nb = this.neighbor(ci, d);
      let w = 1;
      if (nb >= 0) {
        if (net.roadType[nb] === Network.OneWay && d === OPP[oneWayDir(st.netFlags[nb])]) continue;
        w = 1 + st.traffic[nb] / 900;
      } else w = 0.4;
      if (d === hi) w *= 2.4;
      w0[d] = w;
      tot += w;
    }
    if (tot <= 0) {
      if (m & (1 << OPP[hi]) && ow < 0) return OPP[hi];
      if (!m && ow < 0) return OPP[hi];
      return -1;
    }
    let x = this.rand() * tot;
    for (let d = 0; d < 4; d++) { x -= w0[d]; if (w0[d] > 0 && x <= 0) return d; }
    return hi;
  }

  /** set up the path through cell ci (already stored in cell[v]) given entry heading & offset */
  private planCell(v: number): boolean {
    const ci = this.cell[v];
    const hi = this.hin[v];
    let ho = -1;
    const r = this.route[v];
    if (r >= 0) {
      const R = this.routes[r];
      const k = this.ridx[v];
      if (R && k + 1 < R.cells.length) {
        const nc = R.cells[k + 1];
        const N = this.net.N;
        const dxc = (nc % N) - (ci % N), dzc = ((nc / N) | 0) - ((ci / N) | 0);
        for (let d = 0; d < 4; d++) if (DX[d] === dxc && DZ[d] === dzc) ho = d;
        if (ho >= 0 && !(this.net.roadMask[ci] & (1 << ho))) ho = -1;
      }
      if (ho < 0) {
        // route ends here: finish by random walk for this cell, then respawn
        this.route[v] = -1;
        this.life[v] = 0;
        ho = this.chooseExit(ci, hi);
      }
    } else ho = this.chooseExit(ci, hi);
    if (ho < 0) return false;
    this.hout[v] = ho;
    const nb = this.neighbor(ci, ho);
    this.next[v] = nb;
    const t0 = this.net.roadType[ci];
    const t1 = nb >= 0 ? this.net.roadType[nb] : 0;
    let ln = this.lane[v];
    if (ln >= laneCount(t0)) ln = laneCount(t0) - 1;
    this.lane[v] = ln;
    // U-turns and turns use the outer (right) lane
    if (ho !== hi && laneCount(t0) > 1 && t0 !== Network.OneWay) this.lane[v] = ((ho - hi) & 3) === 1 ? 0 : 1;
    this.oout[v] = ho === OPP[hi] ? this.oin[v] : edgeOff(t0, t1, this.lane[v]);
    this.len[v] = this.pathLen(hi, ho, this.oin[v], this.oout[v]);
    return true;
  }

  private chooseModel(kind: number): string {
    const r = this.rand();
    if (kind === K_BUS) return 'bus';
    if (kind === K_TRUCK) return pickWeighted(TRUCK_MODELS, r);
    if (kind === K_SERVICE) return pickWeighted(SERVICE_MODELS, r);
    return pickWeighted(CAR_MODELS, r);
  }

  private geomFor(model: string, variant: number): number {
    const e = MANIFEST_BY_ID[model];
    const nv = e?.variants ?? 1;
    const vv = ((variant % nv) + nv) % nv;
    return this.batch.geometryId(`${model}#${vv}`, () => vehicleGeometry(model, vv));
  }

  /** (re)initialize slot v as a fresh vehicle. Returns false when nothing can spawn. */
  private spawn(v: number, isNew: boolean, randomT: boolean): boolean {
    const net = this.net;
    let ci = -1, route = -1, ridx = 0, hi = 0;
    let kind = K_CAR;
    if (this.routes.length) {
      route = this.sampleCdf(this.routeCdf);
      const R = this.routes[route];
      const k = randomT ? Math.floor(this.rand() * (R.cells.length - 1)) : 0;
      ci = R.cells[k];
      ridx = k;
      const nc = R.cells[k + 1];
      const N = net.N;
      const dxc = (nc % N) - (ci % N), dzc = ((nc / N) | 0) - ((ci / N) | 0);
      hi = -1;
      for (let d = 0; d < 4; d++) if (DX[d] === dxc && DZ[d] === dzc) hi = d;
      if (hi < 0 || !net.roadType[ci]) { route = -1; ci = -1; }
      else {
        // enter the first cell as if coming from behind, heading toward the next cell
        kind = R.kind === 'bus' ? K_BUS : R.kind === 'truck' ? K_TRUCK : R.kind === 'service' ? K_SERVICE : K_CAR;
      }
    }
    if (ci < 0) {
      const k = this.sampleCdf(this.spawnCdf);
      if (k < 0) return false;
      ci = this.spawnCells[k];
      const m = net.roadMask[ci];
      if (!m) return false;
      let tries = 0;
      do { hi = (this.rand() * 4) | 0; tries++; } while (!(m & (1 << hi)) && tries < 12);
      if (!(m & (1 << hi))) return false;
      const t = net.roadType[ci];
      if (t === Network.OneWay) hi = oneWayDir(this.state.netFlags[ci]);
      const r = this.rand();
      kind = r < 0.84 ? K_CAR : r < 0.87 ? K_BUS : r < 0.96 ? K_TRUCK : K_SERVICE;
      if (t === Network.Street && kind === K_BUS) kind = K_CAR;
    }
    const t0 = net.roadType[ci];
    this.cell[v] = ci;
    this.hin[v] = hi;
    this.route[v] = route;
    this.ridx[v] = ridx;
    this.kind[v] = kind;
    this.lane[v] = (this.rand() * laneCount(t0)) | 0;
    const prev = this.neighbor(ci, OPP[hi]);
    this.oin[v] = edgeOff(prev >= 0 ? this.typeAt(prev) || t0 : t0, t0, this.lane[v]);
    this.spd[v] = SPEED[t0] * 0.6;
    this.vfac[v] = 0.82 + this.rand() * 0.3;
    this.life[v] = route >= 0 ? 1e9 : 35 + this.rand() * 90;
    if (!this.planCell(v)) return false;
    this.t[v] = randomT ? this.rand() * this.len[v] : 0;
    const model = this.chooseModel(kind);
    const geom = this.geomFor(model, (this.rand() * 8) | 0);
    if (isNew) {
      this.inst[v] = this.batch.add(geom);
      this.vis[v] = 1;
    } else this.batch.setGeometry(this.inst[v], geom);
    const bb = this.batch.bounds(geom);
    this.vlen[v] = Math.max(3.5, bb.max.z - bb.min.z);
    if (kind === K_BUS || model.startsWith('truck')) this.vfac[v] *= 0.85;
    return true;
  }

  private removeSlot(v: number): void {
    this.batch.remove(this.inst[v]);
    const last = --this.n;
    if (v !== last) {
      this.cell[v] = this.cell[last]; this.hin[v] = this.hin[last]; this.hout[v] = this.hout[last]; this.lane[v] = this.lane[last];
      this.t[v] = this.t[last]; this.len[v] = this.len[last]; this.oin[v] = this.oin[last]; this.oout[v] = this.oout[last];
      this.spd[v] = this.spd[last]; this.vfac[v] = this.vfac[last]; this.vlen[v] = this.vlen[last]; this.kind[v] = this.kind[last];
      this.inst[v] = this.inst[last]; this.route[v] = this.route[last]; this.ridx[v] = this.ridx[last]; this.life[v] = this.life[last];
      this.next[v] = this.next[last]; this.vis[v] = this.vis[last];
    }
  }

  /** advance vehicle v into its next cell; false = must respawn */
  private enterNext(v: number): boolean {
    const nb = this.next[v];
    if (nb < 0) return false;
    const net = this.net;
    if (!net.roadType[nb]) return false;
    if (!(net.roadMask[nb] & (1 << OPP[this.hout[v]]))) return false; // network changed under us
    this.oin[v] = this.oout[v];
    this.cell[v] = nb;
    this.hin[v] = this.hout[v];
    if (this.route[v] >= 0) this.ridx[v]++;
    return this.planCell(v);
  }

  // ------------------------------------------------------------------ trains
  private spawnTrain(): Train | null {
    const net = this.net;
    const N = net.N;
    const rails: number[] = [];
    for (let i = 0; i < N * N; i++) if (net.railMask[i]) rails.push(i);
    if (rails.length < 6) return null;
    const ci = rails[(this.rand() * rails.length) | 0];
    const m = net.railMask[ci];
    let hi = 0, tries = 0;
    do { hi = (this.rand() * 4) | 0; tries++; } while (!(m & (1 << hi)) && tries < 12);
    if (!(m & (1 << hi))) return null;
    const cars = 3 + ((this.rand() * 4) | 0);
    const tr: Train = {
      inst: [], lens: [], hc: new Int32Array(24), hi: new Uint8Array(24), ho: new Uint8Array(24), hl: new Float32Array(24), hn: 0,
      cell: ci, hin: hi, hout: hi, t: 0, len: CELL_SIZE, speed: 0, vmax: 14 + this.rand() * 6, alive: true, wait: 0,
    };
    const freight = this.rand() < 0.5;
    for (let k = 0; k < cars; k++) {
      const model = k === 0 ? 'train_loco' : 'train_car';
      const variant = k === 0 ? (this.rand() * 2) | 0 : freight ? 1 + ((this.rand() * 2) | 0) : 0;
      const g = this.geomFor(model, variant);
      tr.inst.push(this.batch.add(g));
      const bb = this.batch.bounds(g);
      tr.lens.push(Math.max(8, bb.max.z - bb.min.z));
    }
    const ho = this.trainExit(ci, hi);
    if (ho < 0) { for (const id of tr.inst) this.batch.remove(id); return null; }
    tr.hout = ho;
    tr.len = this.pathLen(hi, ho, 0, 0);
    this.pushHist(tr);
    // pre-roll so all cars are on the track
    let need = 0;
    for (const l of tr.lens) need += l + 1;
    if (!this.advanceTrain(tr, need)) { for (const id of tr.inst) this.batch.remove(id); return null; }
    return tr;
  }

  private trainExit(ci: number, hi: number): number {
    const m = this.net.railMask[ci];
    if (m & (1 << hi) && this.rand() < 0.85) return hi;
    const opts: number[] = [];
    for (let d = 0; d < 4; d++) if (m & (1 << d) && d !== OPP[hi]) opts.push(d);
    if (!opts.length) return -1;
    return opts[(this.rand() * opts.length) | 0];
  }

  private pushHist(tr: Train): void {
    const K = tr.hc.length;
    if (tr.hn === K) {
      tr.hc.copyWithin(0, 1); tr.hi.copyWithin(0, 1); tr.ho.copyWithin(0, 1); tr.hl.copyWithin(0, 1);
      tr.hn--;
    }
    tr.hc[tr.hn] = tr.cell; tr.hi[tr.hn] = tr.hin; tr.ho[tr.hn] = tr.hout; tr.hl[tr.hn] = tr.len;
    tr.hn++;
  }

  private advanceTrain(tr: Train, ds: number): boolean {
    tr.t += ds;
    while (tr.t >= tr.len) {
      tr.t -= tr.len;
      const nb = this.neighbor(tr.cell, tr.hout);
      if (nb < 0 || !(this.net.railMask[nb] & (1 << OPP[tr.hout]))) return false;
      tr.hin = tr.hout;
      tr.cell = nb;
      const ho = this.trainExit(nb, tr.hin);
      if (ho < 0) return false;
      tr.hout = ho;
      tr.len = this.pathLen(tr.hin, ho, 0, 0);
      this.pushHist(tr);
    }
    return true;
  }

  // ------------------------------------------------------------------ frame
  update(dt: number, camera: THREE.Camera): void {
    if (!this.enabled) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const net = this.net;
    const st = this.state;
    // zoom-based thinning
    const camH = camera.position.y;
    this.hidden = camH > 2600;
    this.thin = camH > 1500 ? 3 : camH > 1000 ? 2 : 1;
    // routes
    this.routeTimer -= dt;
    if (this.routeTimer <= 0) {
      this.routeTimer = 15;
      this.refreshRoutes();
    }
    // population control
    this.popTimer -= dt;
    if (this.popTimer <= 0) {
      this.popTimer = 0.4;
      let budget = this.n === 0 ? this.target : 40;
      let fails = 0;
      while (this.n < this.target && budget-- > 0 && fails < 60) {
        const v = this.n;
        if (this.spawn(v, true, true)) this.n++;
        else fails++;
      }
      budget = 40;
      while (this.n > this.target && budget-- > 0) this.removeSlot(this.n - 1);
      // trains
      const wantTrains = net.railCells >= 8 ? Math.min(this.trainCap, Math.max(1, Math.round(net.railCells / 45))) : 0;
      if (this.trains.length < wantTrains) {
        const tr = this.spawnTrain();
        if (tr) this.trains.push(tr);
      } else if (this.trains.length > wantTrains) {
        const tr = this.trains.pop()!;
        for (const id of tr.inst) this.batch.remove(id);
      }
    }
    const n = this.n;
    const head = this.head;
    const nextB = this.nextB;
    const used = this.usedK;
    // buckets
    for (let v = 0; v < n; v++) {
      const key = this.cell[v] * 8 + this.hin[v] * 2 + (this.lane[v] & 1);
      nextB[v] = head[key];
      head[key] = v;
      used[v] = key;
    }
    const traffic = st.traffic, cong = st.congestion;
    const sig = this.signalized;
    const time = this.time;
    for (let v = 0; v < n; v++) {
      const c = this.cell[v];
      const tv = this.t[v];
      const lv = this.vlen[v] * 0.5;
      let gap = 1e9;
      for (let j = head[used[v]]; j >= 0; j = nextB[j]) {
        if (j === v) continue;
        const tj = this.t[j];
        if (tj > tv || (tj === tv && j > v)) {
          const g = tj - tv - lv - this.vlen[j] * 0.5;
          if (g < gap) gap = g;
        }
      }
      const nc = this.next[v];
      if (gap > 30 && nc >= 0) {
        const key2 = nc * 8 + this.hout[v] * 2 + (this.lane[v] & 1);
        const rem = this.len[v] - tv;
        for (let j = head[key2]; j >= 0; j = nextB[j]) {
          const g = rem + this.t[j] - lv - this.vlen[j] * 0.5;
          if (g < gap) gap = g;
        }
      }
      // signals: stop at the end of this cell if the next cell is a red intersection
      if (sig && nc >= 0 && sig[nc]) {
        const ph = (time + ((nc * 2654435761) >>> 0) % 997 * 0.03) % 30;
        const axis = this.hout[v] & 1; // 0: x axis, 1: z axis
        const green = axis === 0 ? ph < 13 : ph >= 15 && ph < 28;
        if (!green) {
          const g = this.len[v] - tv - lv - 0.8;
          if (g > -1.0 && g < gap) gap = Math.max(0, g);
        }
      }
      const rt = net.roadType[c];
      const cg = cong[c];
      const cf = 1 / (1 + 1.6 * Math.max(0, cg - 0.35));
      const desired = SPEED[rt] * this.vfac[v] * cf;
      const tgt = gap < 60 ? Math.min(desired, Math.max(0, gap - 1.2) * 1.15) : desired;
      let sp = this.spd[v];
      if (tgt > sp) sp = Math.min(tgt, sp + 2.8 * dt);
      else sp = Math.max(tgt, sp - 9 * dt);
      this.spd[v] = sp;
      void traffic;
    }
    for (let v = 0; v < n; v++) head[used[v]] = -1;
    // move + pose
    const data = this.batch.matrixData();
    const vis = this.culler.vis;
    const surf = this.surf;
    const night = sharedUniforms.uNight.value > 0.2;
    const hl = this.headlights;
    const hm = hl.instanceMatrix.array as Float32Array;
    const headCap = hl.instanceMatrix.count;
    let hc = 0;
    for (let v = 0; v < this.n; v++) {
      this.life[v] -= dt;
      let t = this.t[v] + this.spd[v] * dt;
      let ok = true;
      let guard = 0;
      while (t >= this.len[v] && guard++ < 4) {
        t -= this.len[v];
        if (this.life[v] <= 0 || !this.enterNext(v)) { ok = false; break; }
      }
      if (ok && !net.roadType[this.cell[v]]) ok = false;
      if (!ok) {
        if (!this.spawn(v, false, false)) { this.removeSlot(v); v--; continue; }
        t = this.t[v];
      }
      this.t[v] = t;
      const ci = this.cell[v];
      this.evalPath(ci, this.hin[v], this.hout[v], this.oin[v], this.oout[v], t, this.len[v]);
      const x = this.px, z = this.pz;
      this.posX[v] = x; this.posZ[v] = z;
      const tile = this.culler.tileOfWorld(x, z);
      const tunnel = st.netFlags[ci] & NF_TUNNEL;
      const show = !this.hidden && vis[tile] === 1 && !tunnel && (this.thin === 1 || v % this.thin === 0) ? 1 : 0;
      if (show !== this.vis[v]) { this.vis[v] = show; this.batch.setVisible(this.inst[v], show === 1); }
      if (!show) continue;
      const fx = this.dx, fz = this.dz;
      const half = this.vlen[v] * 0.4;
      const yF = surf.y(x + fx * half, z + fz * half), yB = surf.y(x - fx * half, z - fz * half);
      const y = (yF + yB) * 0.5;
      this.writeMatrix(data, this.inst[v] * 16, x, y, z, fx, (yF - yB) / (2 * half), fz);
      if (night && hc < headCap) {
        const o = hc * 16, s = this.inst[v] * 16;
        for (let k = 0; k < 16; k++) hm[o + k] = data[s + k];
        hc++;
      }
    }
    // trains
    for (let k = 0; k < this.trains.length; k++) {
      const tr = this.trains[k];
      tr.speed += Math.max(-4 * dt, Math.min(1.2 * dt, tr.vmax - tr.speed));
      if (!this.advanceTrain(tr, tr.speed * dt)) {
        for (const id of tr.inst) this.batch.remove(id);
        this.trains.splice(k, 1);
        k--;
        continue;
      }
      let back = 0;
      for (let c = 0; c < tr.inst.length; c++) {
        const half = tr.lens[c] * 0.5;
        const dist = back + half;
        back += tr.lens[c] + 0.8;
        // locate along history
        let rem = dist;
        let hIdx = tr.hn - 1;
        let s = tr.t;
        while (rem > s && hIdx > 0) { rem -= s; hIdx--; s = tr.hl[hIdx]; }
        const pos = Math.max(0, s - rem);
        const ci = tr.hc[hIdx];
        this.evalPath(ci, tr.hi[hIdx], tr.ho[hIdx], 0, 0, pos, tr.hl[hIdx]);
        const x = this.px, z = this.pz;
        const id = tr.inst[c];
        const tile = this.culler.tileOfWorld(x, z);
        const show = !this.hidden && vis[tile] === 1 && !(st.netFlags[ci] & NF_TUNNEL);
        this.batch.setVisible(id, show);
        if (!show) continue;
        const fx = this.dx, fz = this.dz;
        const hh = half * 0.8;
        const yF = surf.y(x + fx * hh, z + fz * hh), yB = surf.y(x - fx * hh, z - fz * hh);
        this.writeMatrix(data, id * 16, x, (yF + yB) * 0.5 + 0.62, z, fx, (yF - yB) / (2 * hh), fz);
      }
    }
    this.batch.markMatricesDirty();
    hl.count = night ? hc : 0;
    if (night && hc) hl.instanceMatrix.needsUpdate = true;
    this.headCount = hc;
  }

  private writeMatrix(d: Float32Array, o: number, x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    // forward f normalized (with pitch), X = normalize(cross(up, f)), Y = cross(f, X)
    let l = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
    fx /= l; fy /= l; fz /= l;
    let xx = fz, xz = -fx;
    l = Math.sqrt(xx * xx + xz * xz) || 1;
    xx /= l; xz /= l;
    const yx = fy * xz, yy = fz * xx - fx * xz, yz = -fy * xx;
    d[o] = xx; d[o + 1] = 0; d[o + 2] = xz; d[o + 3] = 0;
    d[o + 4] = yx; d[o + 5] = yy; d[o + 6] = yz; d[o + 7] = 0;
    d[o + 8] = fx; d[o + 9] = fy; d[o + 10] = fz; d[o + 11] = 0;
    d[o + 12] = x; d[o + 13] = y; d[o + 14] = z; d[o + 15] = 1;
  }

  get trainCount(): number {
    return this.trains.length;
  }
  get headlightCount(): number {
    return this.headCount;
  }

  dispose(): void {
    this.batch.dispose();
    this.headlights.dispose();
  }
}
