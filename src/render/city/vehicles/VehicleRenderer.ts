/**
 * VehicleRenderer — road vehicles + trains in one BatchedMesh.
 *
 * Road vehicles drive right-hand lanes on a per-cell path (straight / quarter arc turn / cul-de-sac U-turn), follow
 * ctx.getTrafficRoutes() routes when available (respawn at route end), otherwise traffic-weighted random walks.
 * Density ~ traffic volume, speed reduced by congestion, simple car-following (queues) and 2-phase signals at
 * signalized intersections. Trains (loco + cars) follow rail cells using a path history.
 * All state lives in typed arrays; the per-frame loop allocates nothing.
 * Culling: tile visibility + zoom thinning, never stricter than the classic rule (by camera height: 1/2 of the vehicles
 * above 1000 m, 1/3 above 1500 m, none above 2600 m). The kept fraction eases between those levels over 200-300 m of
 * camera height and each vehicle slot has a fixed rank, so vehicles drop out one by one while zooming (no burst at the
 * thresholds); a vehicle the thinning drops is still drawn while its length projects to at least `thinPx` pixels
 * (every 2nd one down to `hidePx`), so high oblique views keep their near traffic;
 * per-pass draw lists (main view + both shadow cascades; casters under ~1 far-cascade texel are skipped).
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
import { DX, DZ, OPP, RX, RZ, LIFT, NF_TUNNEL, oneWayDir, type NetInfo } from '../common/netinfo';
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
/**
 * Doubles handed between the per-vehicle frame helpers go through these typed slots instead of arguments, return values
 * or object fields: a call V8 does not inline boxes every double it passes or returns (a heap number each), and the frame
 * loops used to allocate 200-450 KB per frame that way.
 *   _p: 0-3 path pose out (x, z, heading x, z), 4 arc length in, 5 path length in (evalPath), 6-7 heights out (surfPair)
 *   _m: pose written by writeMatrix (x, y, z, forward x, y, z)
 */
const _p = new Float64Array(8);
const _m = new Float64Array(6);
/** chooseExit's per-direction weights */
const _w4 = new Float64Array(4);

/** classic zoom thinning step: a above h0, easing to b over w metres of camera height */
function ease(h: number, h0: number, w: number, a: number, b: number): number {
  return h <= h0 ? a : h >= h0 + w ? b : a + (b - a) * ((h - h0) / w);
}

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
  for (let i = 0; i < list.length; i++) tot += list[i][1];
  let x = r * tot;
  for (let i = 0; i < list.length; i++) { x -= list[i][1]; if (x <= 0) return list[i][0]; }
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
  /** optional sim route (kind 'train') being followed */
  route: TrafficRoute | null;
  ridx: number;
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
  private vroute: (TrafficRoute | null)[] = [];
  private ridx!: Int32Array;
  private life!: Float32Array;
  private next!: Int32Array;
  private vis!: Uint8Array;
  private nextB!: Int32Array;
  private usedK!: Int32Array;
  /** cached per-cell path parameters (8 floats / vehicle) + path type (0 straight, 1 U-turn, 2 arc) */
  private pp!: Float32Array;
  private rank!: Float64Array;
  private ptype!: Uint8Array;
  /** car-following buckets: hash table (power of two, ~3x the vehicle cap: stays in cache) of chains through nextB,
   *  keyed by cell * 8 + heading * 2 + lane (entries of other keys sharing a slot are skipped by their usedK key) */
  private head = new Int32Array(0);
  private headShift = 32;
  // spawn distribution
  private spawnCells = new Int32Array(0);
  private spawnCdf = new Float32Array(0);
  private target = 0;
  private routes: TrafficRoute[] = [];
  private routeCdf = new Float32Array(0);
  private serviceRoutes: TrafficRoute[] = [];
  private trainRoutes: TrafficRoute[] = [];
  private trainCdf = new Float32Array(0);
  private routeTimer = 0;
  private popTimer = 0;
  private time = 0;
  private rngS = 1234567;
  private trains: Train[] = [];
  /** fraction of vehicle slots the zoom thinning keeps (by camera height, see the file comment) */
  private keep = 1;
  enabled = true;
  /** optional signal state: 1 = signalized intersection */
  signalized: Uint8Array | null = null;
  getRoutes: ((max: number) => TrafficRoute[]) | null = null;
  quality: QualityLevel = 'high';
  /** projected length (px of the drawing buffer) below which a vehicle is hidden / only every 2nd one is drawn */
  hidePx = 2;
  thinPx = 3;
  /** optional hard distance cap (m; trains 2x) */
  maxDistance = Infinity;
  private headCount = 0;
  /** culler tile of every map cell (a road vehicle's pose stays inside its cell: its tile is its cell's tile) */
  private cellTile = new Int32Array(0);

  constructor(private state: CityState, private net: NetInfo, private surf: RoadSurface, private culler: TileCuller, quality: QualityLevel = 'high') {
    this.quality = quality;
    this.cap = CAPS[quality];
    this.trainCap = TRAIN_CAPS[quality];
    this.batch = new DynamicBatch(getCityMaterial(), this.cap + 128, 1 << 16, 'vehicles');
    this.batch.mesh.castShadow = quality === 'high' || quality === 'ultra';
    this.batch.mesh.receiveShadow = true;
    // both cascades (the far one only where a vehicle spans > ~1 shadow texel)
    this.batch.enablePassCulling({ culler, dynamic: true, minShadowTexels: 1.2 });
    // register the most common model now: the batch geometry gets its attribute layout before the first frame, so its
    // program compiles with the others instead of when the first car appears
    this.geomFor(CAR_MODELS[0][0], 0);
    this.alloc(this.cap);
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
    this.vroute = new Array(cap).fill(null);
    this.ridx = new Int32Array(cap);
    this.life = new Float32Array(cap);
    this.next = new Int32Array(cap);
    this.vis = new Uint8Array(cap);
    this.nextB = new Int32Array(cap);
    this.usedK = new Int32Array(cap);
    this.pp = new Float32Array(cap * 8);
    this.ptype = new Uint8Array(cap);
    // zoom-thinning rank per slot: golden-ratio sequence, evenly spread for any prefix of slots (v * phi mod 1)
    this.rank = new Float64Array(cap);
    for (let v = 0; v < cap; v++) { const a = v * 0.6180339887; this.rank[v] = a - Math.floor(a); }
    const bits = Math.max(8, Math.ceil(Math.log2(cap * 3)));
    this.head = new Int32Array(1 << bits).fill(-1);
    this.headShift = 32 - bits;
  }

  setState(state: CityState, net: NetInfo, surf: RoadSurface): void {
    this.clear();
    this.state = state;
    this.net = net;
    this.surf = surf;
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

  /** mark spawn distribution + routes stale (network / traffic changed); refreshed on the next update (debounced) */
  invalidate(): void {
    this.spawnDirty = true;
  }
  private spawnDirty = false;
  private lastRefresh = -1e9;

  /** recompute spawn distribution from traffic volumes (call on network / traffic changes) */
  refreshSpawn(): void {
    this.spawnDirty = false;
    this.lastRefresh = performance.now();
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
      // vehicles per cell (16 m of road, all lanes). Game time is compressed, so visible density is exaggerated vs.
      // real flow: any used road shows some cars; ~1 car / 13 m of road at ~800 PCU/day; congested roads queue up.
      if (haveTraffic) {
        const tv = st.traffic[i];
        d = tv > 0 ? Math.min(1.3, 0.16 + tv / 550) * (0.8 + 0.4 * Math.min(1.5, st.congestion[i])) : 0;
      }
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
    const road: TrafficRoute[] = [], train: TrafficRoute[] = [], service: TrafficRoute[] = [];
    try {
      const r = this.getRoutes(Math.min(1024, this.cap));
      for (const q of r || []) {
        if (!q || !q.cells || q.cells.length < 2) continue;
        if (q.kind === 'train') train.push(q);
        else if (q.kind === 'service') service.push(q);
        else if (q.kind === 'car' || q.kind === 'bus' || q.kind === 'truck') road.push(q);
        // unknown kinds are ignored
      }
    } catch {
      /* keep empty */
    }
    this.routes = road;
    this.serviceRoutes = service;
    this.trainRoutes = train;
    const cdf = (list: TrafficRoute[]) => {
      let tot = 0;
      const c = new Float32Array(list.length);
      for (let i = 0; i < list.length; i++) { tot += Math.max(0.001, list[i].weight || 1); c[i] = tot; }
      return c;
    };
    this.routeCdf = cdf(road);
    this.trainCdf = cdf(train);
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

  /** pose (-> _p[0..3]: position x, z, heading x, z) at arc length _p[4] along the path through cell ci of length _p[5]
   *  (entry heading hi, exit ho, lane offsets oi / oo) */
  private evalPath(ci: number, hi: number, ho: number, oi: number, oo: number): void {
    const N = this.net.N;
    const H = CELL_SIZE / 2;
    const s = _p[4], L = _p[5];
    const ox = ((ci % N) + 0.5) * CELL_SIZE, oz = (((ci / N) | 0) + 0.5) * CELL_SIZE;
    if (ho === hi) {
      const ex = ox - DX[hi] * H + RX[hi] * oi, ez = oz - DZ[hi] * H + RZ[hi] * oi;
      const xx = ox + DX[hi] * H + RX[hi] * oo, xz = oz + DZ[hi] * H + RZ[hi] * oo;
      const f = s / L;
      _p[0] = ex + (xx - ex) * f; _p[1] = ez + (xz - ez) * f;
      _p[2] = (xx - ex) / L; _p[3] = (xz - ez) / L;
      return;
    }
    if (ho === OPP[hi]) {
      const o = Math.max(0.5, Math.abs(oi));
      if (s < H) {
        _p[0] = ox - DX[hi] * H + RX[hi] * o + DX[hi] * s; _p[1] = oz - DZ[hi] * H + RZ[hi] * o + DZ[hi] * s;
        _p[2] = DX[hi]; _p[3] = DZ[hi];
      } else if (s < H + Math.PI * o) {
        const a = Math.atan2(RZ[hi], RX[hi]) - (s - H) / o;
        const c = Math.cos(a), sn = Math.sin(a);
        _p[0] = ox + o * c; _p[1] = oz + o * sn;
        _p[2] = sn; _p[3] = -c;
      } else {
        const s3 = s - H - Math.PI * o;
        _p[0] = ox - RX[hi] * o - DX[hi] * s3; _p[1] = oz - RZ[hi] * o - DZ[hi] * s3;
        _p[2] = -DX[hi]; _p[3] = -DZ[hi];
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
    _p[0] = cx + r * c; _p[1] = cz + r * sn;
    const sg = da > 0 ? 1 : -1;
    _p[2] = -sn * sg; _p[3] = c * sg;
  }

  /** choose exit heading for road cell ci entered with heading hi (random walk); -1 if impossible */
  private chooseExit(ci: number, hi: number): number {
    const net = this.net;
    const st = this.state;
    const m = net.roadMask[ci];
    const t = net.roadType[ci];
    const ow = t === Network.OneWay ? oneWayDir(st.netFlags[ci]) : -1;
    let tot = 0;
    const w0 = _w4;
    w0.fill(0);
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
    const R = this.vroute[v];
    if (R) {
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
        this.vroute[v] = null;
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
    this.cachePath(v);
    return true;
  }

  /** precompute the analytic path of vehicle v through its current cell (called once per cell) */
  private cachePath(v: number): void {
    const N = this.net.N;
    const H = CELL_SIZE / 2;
    const ci = this.cell[v], hi = this.hin[v], ho = this.hout[v], oi = this.oin[v], oo = this.oout[v];
    const ox = ((ci % N) + 0.5) * CELL_SIZE, oz = (((ci / N) | 0) + 0.5) * CELL_SIZE;
    const p = this.pp, o = v * 8;
    if (ho === hi) {
      const ex = ox - DX[hi] * H + RX[hi] * oi, ez = oz - DZ[hi] * H + RZ[hi] * oi;
      const xx = ox + DX[hi] * H + RX[hi] * oo, xz = oz + DZ[hi] * H + RZ[hi] * oo;
      const L = this.len[v] || 1;
      this.ptype[v] = 0;
      p[o] = ex; p[o + 1] = ez; p[o + 2] = (xx - ex) / L; p[o + 3] = (xz - ez) / L;
    } else if (ho === OPP[hi]) {
      this.ptype[v] = 1;
    } else {
      const cx = ox - DX[hi] * H + DX[ho] * H, cz = oz - DZ[hi] * H + DZ[ho] * H;
      const ex = ox - DX[hi] * H + RX[hi] * oi, ez = oz - DZ[hi] * H + RZ[hi] * oi;
      const xx = ox + DX[ho] * H + RX[ho] * oo, xz = oz + DZ[ho] * H + RZ[ho] * oo;
      const aE = Math.atan2(ez - cz, ex - cx), aX = Math.atan2(xz - cz, xx - cx);
      this.ptype[v] = 2;
      p[o] = cx; p[o + 1] = cz; p[o + 2] = aE; p[o + 3] = wrapPi(aX - aE);
      p[o + 4] = Math.hypot(ex - cx, ez - cz); p[o + 5] = Math.hypot(xx - cx, xz - cz);
    }
  }

  /** pose of vehicle v at arc length _p[4] along its cached cell path -> _p[0..3] (x, z, heading x, z) */
  private evalCached(v: number): void {
    const p = this.pp, o = v * 8, s = _p[4];
    const ty = this.ptype[v];
    if (ty === 0) {
      _p[0] = p[o] + p[o + 2] * s; _p[1] = p[o + 1] + p[o + 3] * s;
      _p[2] = p[o + 2]; _p[3] = p[o + 3];
    } else if (ty === 2) {
      const f = Math.min(1, s / this.len[v]);
      const da = p[o + 3];
      const a = p[o + 2] + da * f, r = p[o + 4] + (p[o + 5] - p[o + 4]) * f;
      const c = Math.cos(a), sn = Math.sin(a);
      _p[0] = p[o] + r * c; _p[1] = p[o + 1] + r * sn;
      if (da > 0) { _p[2] = -sn; _p[3] = c; } else { _p[2] = sn; _p[3] = -c; }
    } else {
      // U-turn (cul-de-sac): analytic
      _p[5] = this.len[v];
      this.evalPath(this.cell[v], this.hin[v], this.hout[v], this.oin[v], this.oout[v]);
    }
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
  private spawn(v: number, isNew: boolean, randomT: boolean, forced: TrafficRoute | null = null): boolean {
    const net = this.net;
    let ci = -1, ridx = 0, hi = 0;
    let R: TrafficRoute | null = null;
    let kind = K_CAR;
    if (forced || this.routes.length) {
      R = forced ?? this.routes[this.sampleCdf(this.routeCdf)];
      const k = randomT && !forced ? Math.floor(this.rand() * (R.cells.length - 1)) : 0;
      ci = R.cells[k];
      ridx = k;
      const nc = R.cells[k + 1];
      const N = net.N;
      const dxc = (nc % N) - (ci % N), dzc = ((nc / N) | 0) - ((ci / N) | 0);
      hi = -1;
      for (let d = 0; d < 4; d++) if (DX[d] === dxc && DZ[d] === dzc) hi = d;
      if (hi < 0 || !net.roadType[ci]) { R = null; ci = -1; }
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
    this.vroute[v] = R;
    this.ridx[v] = ridx;
    this.kind[v] = kind;
    this.lane[v] = (this.rand() * laneCount(t0)) | 0;
    const prev = this.neighbor(ci, OPP[hi]);
    this.oin[v] = edgeOff(prev >= 0 ? this.typeAt(prev) || t0 : t0, t0, this.lane[v]);
    this.spd[v] = SPEED[t0] * 0.6;
    this.vfac[v] = 0.82 + this.rand() * 0.3;
    this.life[v] = R ? 1e9 : 35 + this.rand() * 90;
    if (!this.planCell(v)) return false;
    this.t[v] = randomT ? this.rand() * this.len[v] : 0;
    const model = (R as { model?: string } | null)?.model || this.chooseModel(kind); // WP7-12 patrol model hint
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
      this.inst[v] = this.inst[last]; this.vroute[v] = this.vroute[last]; this.ridx[v] = this.ridx[last]; this.life[v] = this.life[last];
      this.next[v] = this.next[last]; this.vis[v] = this.vis[last];
      this.ptype[v] = this.ptype[last];
      this.pp.copyWithin(v * 8, last * 8, last * 8 + 8);
    }
    this.vroute[last] = null;
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
    if (this.vroute[v]) this.ridx[v]++;
    return this.planCell(v);
  }

  // ------------------------------------------------------------------ trains
  private dirTo(a: number, b: number): number {
    const N = this.net.N;
    const dx = (b % N) - (a % N), dz = ((b / N) | 0) - ((a / N) | 0);
    for (let d = 0; d < 4; d++) if (DX[d] === dx && DZ[d] === dz) return d;
    return -1;
  }

  private spawnTrain(): Train | null {
    const net = this.net;
    const N = net.N;
    let ci = -1, hi = 0;
    let route: TrafficRoute | null = null;
    if (this.trainRoutes.length) {
      route = this.trainRoutes[this.sampleCdf(this.trainCdf)];
      ci = route.cells[0];
      hi = this.dirTo(ci, route.cells[1]);
      if (hi < 0 || !net.railMask[ci]) { route = null; ci = -1; }
    }
    if (ci < 0) {
      const rails: number[] = [];
      for (let i = 0; i < N * N; i++) if (net.railMask[i]) rails.push(i);
      if (rails.length < 6) return null;
      ci = rails[(this.rand() * rails.length) | 0];
      const m = net.railMask[ci];
      let tries = 0;
      do { hi = (this.rand() * 4) | 0; tries++; } while (!(m & (1 << hi)) && tries < 12);
      if (!(m & (1 << hi))) return null;
    }
    const cars = 3 + ((this.rand() * 4) | 0);
    const tr: Train = {
      inst: [], lens: [], hc: new Int32Array(24), hi: new Uint8Array(24), ho: new Uint8Array(24), hl: new Float32Array(24), hn: 0,
      cell: ci, hin: hi, hout: hi, t: 0, len: CELL_SIZE, speed: 0, vmax: 14 + this.rand() * 6, alive: true, wait: 0, route, ridx: 0,
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
    const ho = this.trainExit(tr, ci, hi);
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

  private trainExit(tr: Train, ci: number, hi: number): number {
    const m = this.net.railMask[ci];
    if (tr.route) {
      const R = tr.route;
      if (tr.ridx + 1 >= R.cells.length) return -1; // route finished
      const d = this.dirTo(ci, R.cells[tr.ridx + 1]);
      if (d >= 0 && m & (1 << d)) return d;
      tr.route = null; // route no longer matches the network: continue freely
    }
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
      if (tr.route) tr.ridx++;
      const ho = this.trainExit(tr, nb, tr.hin);
      if (ho < 0) return false;
      tr.hout = ho;
      tr.len = this.pathLen(tr.hin, ho, 0, 0);
      this.pushHist(tr);
    }
    return true;
  }

  // ------------------------------------------------------------------ frame
  /**
   * Advance and pose every vehicle and train. heightPx: drawing-buffer height (projected-size culling; default 1080).
   * The frame runs as a few small methods (upkeep, car following, car poses, trains) so V8 optimises each hot loop on
   * its own with everything it calls inlined; inside the loops helpers take only integers and exchange doubles through
   * the typed slots _p / _m, so no double is ever boxed (see _p) and the frame allocates nothing.
   */
  update(dt: number, camera: THREE.Camera, heightPx = 1080): void {
    if (!this.enabled) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    // the signal-lamp shader (materials.ts Emissive pattern 13) runs the same per-intersection cycle as the cars below
    sharedUniforms.uSignalTime.value = this.time % 30;
    sharedUniforms.uMapN.value = this.net.N;
    // zoom-based thinning: kept fraction by camera height, eased after each classic threshold (never below it)
    const camH = camera.position.y;
    this.keep = camH <= 1500 ? ease(camH, 1000, 200, 1, 0.5) : camH <= 2600 ? ease(camH, 1500, 200, 0.5, 1 / 3) : ease(camH, 2600, 300, 1 / 3, 0);
    this.upkeep(dt);
    this.follow(dt);
    const night = sharedUniforms.uNight.value > 0.2;
    const shown = this.poseCars(dt, camera, heightPx, night) + this.poseTrains(dt, camera, heightPx);
    // nothing visible moved -> no upload, no shadow-map invalidation
    if (shown > 0) this.batch.markMatricesDirty();
    // (poseCars copies headlights at night only: headCount is 0 by day)
    const hl = this.headlights, hc = this.headCount;
    hl.count = hc;
    if (hc) {
      // upload only the headlights in use (the buffer holds one per vehicle slot)
      const im = hl.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(0, hc * 16);
      im.needsUpdate = true;
    }
  }

  /** spawn distribution / routes (event driven, debounced by real time so slow frames don't stall it), population
   *  control (fill up immediately when far below target), service vehicles and trains */
  private upkeep(dt: number): void {
    const net = this.net;
    if (this.spawnDirty && performance.now() - this.lastRefresh > 250) {
      this.refreshSpawn();
      this.refreshRoutes();
      this.routeTimer = 15;
    }
    this.routeTimer -= dt;
    if (this.routeTimer <= 0) {
      this.routeTimer = 15;
      this.refreshRoutes();
    }
    this.popTimer -= dt;
    const starving = this.n < this.target * 0.6;
    if (!(this.popTimer <= 0 || starving)) return;
    this.popTimer = 0.4;
    let budget = starving ? this.target - this.n : 40;
    let fails = 0;
    while (this.n < this.target && budget-- > 0 && fails < 60) {
      const v = this.n;
      if (this.spawn(v, true, true)) this.n++;
      else fails++;
    }
    budget = 40;
    while (this.n > this.target + this.serviceRoutes.length && budget-- > 0) this.removeSlot(this.n - 1);
    // every active service route (fire trucks, police patrols, garbage...) gets its vehicle
    if (this.serviceRoutes.length) {
      const active = this.activeRoutes;
      active.clear();
      for (let v = 0; v < this.n; v++) { const R = this.vroute[v]; if (R) active.add(R); }
      for (const R of this.serviceRoutes) {
        if (active.has(R)) continue;
        const v = this.n;
        if (v >= this.cap) break;
        if (this.spawn(v, true, false, R)) this.n++;
      }
      active.clear();
    }
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
  private activeRoutes = new Set<TrafficRoute>();

  /** car following (queues per cell / heading / lane bucket), 2-phase signals, congestion: target speeds -> spd */
  private follow(dt: number): void {
    const n = this.n;
    const head = this.head, nextB = this.nextB, used = this.usedK, sh = this.headShift;
    const cell = this.cell, hin = this.hin, hout = this.hout, lane = this.lane, tt = this.t, vlen = this.vlen, next = this.next, len = this.len;
    // buckets (multiplicative hash of the key)
    for (let v = 0; v < n; v++) {
      const key = cell[v] * 8 + hin[v] * 2 + (lane[v] & 1);
      const hk = Math.imul(key, 0x9e3779b1) >>> sh;
      nextB[v] = head[hk];
      head[hk] = v;
      used[v] = key;
    }
    const roadType = this.net.roadType, cong = this.state.congestion;
    const sig = this.signalized;
    // signal clock: the lamp shader's uSignalTime (materials.ts Emissive pattern 13)
    const tmod = this.time % 30;
    const vfac = this.vfac, spd = this.spd;
    for (let v = 0; v < n; v++) {
      const c = cell[v];
      const tv = tt[v];
      const lv = vlen[v] * 0.5;
      let gap = 1e9;
      const key = used[v];
      for (let j = head[Math.imul(key, 0x9e3779b1) >>> sh]; j >= 0; j = nextB[j]) {
        if (j === v || used[j] !== key) continue;
        const tj = tt[j];
        if (tj > tv || (tj === tv && j > v)) {
          const g = tj - tv - lv - vlen[j] * 0.5;
          if (g < gap) gap = g;
        }
      }
      const nc = next[v];
      if (gap > 30 && nc >= 0) {
        const key2 = nc * 8 + hout[v] * 2 + (lane[v] & 1);
        const rem = len[v] - tv;
        for (let j = head[Math.imul(key2, 0x9e3779b1) >>> sh]; j >= 0; j = nextB[j]) {
          if (used[j] !== key2) continue;
          const g = rem + tt[j] - lv - vlen[j] * 0.5;
          if (g < gap) gap = g;
        }
      }
      // signals: stop at the end of this cell if the next cell is a red intersection
      if (sig && nc >= 0 && sig[nc]) {
        // the intersection's phase offset: uint32 hash of its cell, like the shader ((ci * 2654435761u) % 997u) * 0.03
        // (integer ops: the double product, its ToUint32 and a float modulo cost a library call per vehicle)
        let ph = tmod + ((Math.imul(nc, -1640531535) >>> 0) % 997) * 0.03;
        if (ph >= 30) ph -= 30;
        const axis = hout[v] & 1; // 0: x axis, 1: z axis
        const green = axis === 0 ? ph < 13 : ph >= 15 && ph < 28;
        if (!green) {
          const g = len[v] - tv - lv - 0.8;
          if (g > -1.0 && g < gap) gap = Math.max(0, g);
        }
      }
      const rt = roadType[c];
      const cg = cong[c];
      const cf = 1 / (1 + 1.6 * Math.max(0, cg - 0.35));
      const desired = SPEED[rt] * vfac[v] * cf;
      const tgt = gap < 60 ? Math.min(desired, Math.max(0, gap - 1.2) * 1.15) : desired;
      let sp = spd[v];
      if (tgt > sp) sp = Math.min(tgt, sp + 2.8 * dt);
      else sp = Math.max(tgt, sp - 9 * dt);
      spd[v] = sp;
    }
    for (let v = 0; v < n; v++) head[Math.imul(used[v], 0x9e3779b1) >>> sh] = -1;
  }

  /** culler tile per map cell (rebuilt when the map size changes) */
  private tilesOfCells(): Int32Array {
    const N = this.net.N;
    if (this.cellTile.length !== N * N) {
      const c = this.culler, tc = c.tileCells, tmax = c.tiles - 1, ct = new Int32Array(N * N);
      for (let z = 0; z < N; z++) {
        const tz = Math.min(tmax, (z / tc) | 0);
        for (let x = 0; x < N; x++) ct[z * N + x] = tz * c.tiles + Math.min(tmax, (x / tc) | 0);
      }
      this.cellTile = ct;
    }
    return this.cellTile;
  }

  /**
   * Move every road vehicle along its path (cell transitions, respawns), cull (tile visibility, tunnels, zoom thinning
   * relaxed by projected size) and write the visible ones' matrices / headlights. Returns the number drawn. A vehicle
   * in a hidden tile (or a tunnel) only advances: its pose is evaluated only where it can be drawn.
   * Zoom thinning by camera height (classic rule), relaxed by projected size: a vehicle of length L at distance d spans
   * L * K / d px (K = H / (2 tan(fov / 2))); one the classic rule drops is still drawn while it spans >= thinPx (every
   * 2nd one >= hidePx).
   */
  private poseCars(dt: number, camera: THREE.Camera, heightPx: number, night: boolean): number {
    const net = this.net;
    const st = this.state;
    const data = this.batch.matrixData();
    const tileVis = this.culler.vis;
    const hm = this.headlights.instanceMatrix.array as Float32Array;
    const headCap = this.headlights.instanceMatrix.count;
    let hc = 0;
    const cp = camera.position;
    const cpx = cp.x, cpz = cp.z, cpy2 = cp.y * cp.y;
    const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : 38;
    const K = heightPx / (2 * Math.tan((fov * Math.PI) / 360));
    const kh = K / Math.max(0.5, this.hidePx), kt = K / Math.max(0.5, this.thinPx);
    const D2 = this.maxDistance * this.maxDistance;
    const keep = this.keep;
    // (classic rule keeps every vehicle and no distance cap: no distance needed)
    const all = keep >= 1 && D2 === Infinity;
    const flags = st.netFlags, roadType = net.roadType, cellTile = this.tilesOfCells();
    const life = this.life, tt = this.t, spd = this.spd, len = this.len, vlen = this.vlen, inst = this.inst, vis = this.vis, rank = this.rank;
    let shown = 0;
    for (let v = 0; v < this.n; v++) {
      life[v] -= dt;
      let t = tt[v] + spd[v] * dt;
      let ok = true;
      let guard = 0;
      while (t >= len[v] && guard++ < 4) {
        t -= len[v];
        if (life[v] <= 0 || !this.enterNext(v)) { ok = false; break; }
      }
      if (ok && !roadType[this.cell[v]]) ok = false;
      if (!ok) {
        if (!this.spawn(v, false, false)) { this.removeSlot(v); v--; continue; }
        t = tt[v];
      }
      tt[v] = t;
      const ci = this.cell[v];
      let show = 0;
      if (tileVis[cellTile[ci]] === 1 && !(flags[ci] & NF_TUNNEL)) {
        _p[4] = t;
        this.evalCached(v);
        if (all) show = 1;
        else {
          const ddx = _p[0] - cpx, ddz = _p[1] - cpz, d2 = ddx * ddx + ddz * ddz + cpy2;
          const L = vlen[v], lh = L * kh, lt = L * kt;
          show = d2 < D2 && (rank[v] < keep || (d2 < lh * lh && (d2 < lt * lt || (v & 1) === 0))) ? 1 : 0;
        }
      }
      if (show !== vis[v]) { vis[v] = show; this.batch.setVisible(inst[v], show === 1); }
      if (!show) continue;
      shown++;
      const x = _p[0], z = _p[1], fx = _p[2], fz = _p[3];
      const half = vlen[v] * 0.4;
      // (heading-aware: cars crossing under a highway overpass stay on the ground, highway traffic rides the deck)
      _p[4] = half;
      this.surfPair(true);
      const yF = _p[6], yB = _p[7];
      _m[0] = x; _m[1] = (yF + yB) * 0.5; _m[2] = z; _m[3] = fx; _m[4] = (yF - yB) / (2 * half); _m[5] = fz;
      const s = inst[v] * 16;
      this.writeMatrix(data, s);
      if (night && hc < headCap) {
        const o = hc * 16;
        for (let k = 0; k < 16; k++) hm[o + k] = data[s + k];
        hc++;
      }
    }
    this.headCount = hc;
    return shown;
  }

  /** advance, cull and pose the trains (loco + cars along the path history); returns the number of cars drawn */
  private poseTrains(dt: number, camera: THREE.Camera, heightPx: number): number {
    if (!this.trains.length) return 0;
    const st = this.state;
    const data = this.batch.matrixData();
    const cul = this.culler, tileVis = cul.vis;
    const cellSize = cul.cellSize, tileCells = cul.tileCells, tiles = cul.tiles, tmax = tiles - 1;
    const cp = camera.position;
    const cpx = cp.x, cpz = cp.z, cpy2 = cp.y * cp.y;
    const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : 38;
    const kh = heightPx / (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(0.5, this.hidePx);
    const D2 = this.maxDistance * this.maxDistance;
    let shown = 0;
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
        const ci = tr.hc[hIdx];
        _p[4] = Math.max(0, s - rem);
        _p[5] = tr.hl[hIdx];
        this.evalPath(ci, tr.hi[hIdx], tr.ho[hIdx], 0, 0);
        const x = _p[0], z = _p[1];
        const id = tr.inst[c];
        const gx = Math.floor(Math.floor(x / cellSize) / tileCells), gz = Math.floor(Math.floor(z / cellSize) / tileCells);
        const tile = (gz < 0 ? 0 : gz > tmax ? tmax : gz) * tiles + (gx < 0 ? 0 : gx > tmax ? tmax : gx);
        const tdx = x - cpx, tdz = z - cpz, td2 = tdx * tdx + tdz * tdz + cpy2, tl = tr.lens[c] * kh;
        const show = tileVis[tile] === 1 && !(st.netFlags[ci] & NF_TUNNEL) && td2 < D2 * 4 && (this.keep > 0 || td2 < tl * tl);
        this.batch.setVisible(id, show);
        if (!show) continue;
        shown++;
        const fx = _p[2], fz = _p[3];
        const hh = half * 0.8;
        _p[4] = hh;
        this.surfPair(false);
        const yF = _p[6], yB = _p[7];
        _m[0] = x; _m[1] = (yF + yB) * 0.5 + 0.62; _m[2] = z; _m[3] = fx; _m[4] = (yF - yB) / (2 * hh); _m[5] = fz;
        this.writeMatrix(data, id * 16);
      }
    }
    return shown;
  }

  /**
   * Road-surface heights at the two points _p[0..1] +- _p[2..3] * _p[4] (front -> _p[6], back -> _p[7]). heading: as
   * RoadSurface.y(x, z, fx, fz) (road vehicles: traffic crossing under an overpass stays on the ground), else as
   * RoadSurface.y(x, z) (trains). Cells without a bridge / overpass span (nearly all) are evaluated here with
   * RoadSurface.terrain's formula (the rendered triangulation) + LIFT; spans fall back to RoadSurface.
   */
  private surfPair(heading: boolean): void {
    const net = this.net, surf = this.surf, st = surf.state;
    const N = st.size, N1 = N + 1, hts = st.heights;
    const bAxis = net.bAxis, bCross = net.bCross;
    const fx = _p[2], fz = _p[3], h = _p[4];
    for (let k = 0; k < 2; k++) {
      const off = k === 0 ? h : -h;
      const wx = _p[0] + fx * off, wz = _p[1] + fz * off;
      const cx = Math.floor(wx / CELL_SIZE), cz = Math.floor(wz / CELL_SIZE);
      const i = cz * N + cx;
      let y: number;
      if (cx >= 0 && cz >= 0 && cx < N && cz < N && bAxis[i] < 0 && !(heading && bCross[i])) {
        let gx = wx / CELL_SIZE, gz = wz / CELL_SIZE;
        if (gx < 0) gx = 0; else if (gx > N - 1e-6) gx = N - 1e-6;
        if (gz < 0) gz = 0; else if (gz > N - 1e-6) gz = N - 1e-6;
        const ix = gx | 0, iz = gz | 0;
        const tx = gx - ix, tz = gz - iz;
        const j = iz * N1 + ix;
        const a = hts[j], b = hts[j + 1], c = hts[j + N1], d = hts[j + N1 + 1];
        y = (tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz)) + LIFT;
      } else y = heading ? surf.y(wx, wz, fx, fz) : surf.y(wx, wz);
      _p[6 + k] = y;
    }
  }

  /** instance matrix at d[o..o+15] for the pose in _m (position, forward with pitch): forward f normalized,
   *  X = normalize(cross(up, f)), Y = cross(f, X) */
  private writeMatrix(d: Float32Array, o: number): void {
    const x = _m[0], y = _m[1], z = _m[2];
    let fx = _m[3], fy = _m[4], fz = _m[5];
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
