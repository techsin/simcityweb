/**
 * FEEL-25: street life, not simulated trips. Only nearby straight sidewalks are sampled, in small frame slices;
 * at most 600 walkers share one instanced draw. All choices are hashes of cells / slots, never simulation RNG.
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../core/constants';
import { DevType, Network, Surf } from '../../core/types';
import { BF, type CityState } from '../../sim/CityState';
import { getDef } from '../../sim/catalog';
import { ModelBuilder } from '../../assets/ModelBuilder';
import type { QualityLevel } from '../contracts';
import { getCityMaterial } from './common/cityMaterial';
import { CURB_H, HALF, HALF_W, LIFT, NF_TUNNEL, hasSidewalk, type NetInfo } from './common/netinfo';
import type { RoadSurface } from './common/surface';

/** Optional road-cell counts from a host view. Null uses only always-mirrored activity proxies. */
export interface PedestrianActivity { customers: number; visitors: number; riders: number }
export type PedestrianFeed = (cell: number) => PedestrianActivity | null;

const CAP = 600;
const CAPS: Record<QualityLevel, number> = { low: 120, medium: 300, high: CAP, ultra: CAP };
const SPAWN_DISTANCE = 350;
const HIDE_DISTANCE = 600;
/** The search's cell budget is per second, not per frame: 80 cells a frame at 60 fps and faster, 160 at 30, 320 at most. */
const CELLS_PER_FRAME = 80;
const MAX_CELLS_PER_FRAME = 320;
/** Half the side, in cells, of the square a search covers around the camera cell it started from. */
const REACH = Math.ceil(SPAWN_DISTANCE / CELL_SIZE);
const SEARCH_CELLS = (2 * REACH + 1) ** 2;
const PATH = 12;
const ACTIVITY_SALT = 0x5bd1e995;
const COATS = [0x5a6470, 0x7a5b4a, 0x4f6152, 0xb16b42].map((c) => new THREE.Color(c));

function hash(n: number): number {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}

/** Daytime peak, a small late-night tail, and gradual opening / closing shoulders. */
export function pedestrianActivityAt(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5) return 0.15;
  if (h < 9) return 0.15 + (h - 5) * 0.85 / 4;
  if (h < 19) return 1;
  return 1 - (h - 19) * 0.85 / 5;
}

function geometry(rain: boolean): THREE.BufferGeometry {
  const b = new ModelBuilder();
  // transport.ts's private person(): the same two bottomless boxes, 20 triangles, feet at zero here.
  b.paint(0xffffff, Surf.Plain).box(-0.225, 0, -0.15, 0.225, 1.44, 0.15, { bottom: null });
  b.paint(0xc9a58a, Surf.Plain).box(-0.11, 1.46, -0.11, 0.11, 1.7, 0.11, { bottom: null });
  if (rain) {
    b.paint(0xffffff, Surf.Plain);
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, c = (k + 1) * Math.PI / 4;
      b.tri([0, 2.12, 0], [Math.cos(c) * 0.7, 1.88, Math.sin(c) * 0.7], [Math.cos(a) * 0.7, 1.88, Math.sin(a) * 0.7]);
    }
    b.paint(0x555a60, Surf.Plain).box(0.13, 1.05, -0.02, 0.17, 2.04, 0.02, { bottom: null, top: null });
  }
  const g = b.build();
  const mask = new Float32Array(g.getAttribute('position').count);
  mask.fill(1, 0, 30); // coat; preserve the head and umbrella handle's own colours
  if (rain) mask.fill(1, 60, 84);
  g.setAttribute('coatMask', new THREE.BufferAttribute(mask, 1));
  return g;
}

function roster() {
  return { cells: new Int32Array(CAP), seeds: new Uint32Array(CAP), ranks: new Uint32Array(CAP), n: 0 };
}

/** When discover()'s square spiral reaches the cell (dx, dz) from its centre; SEARCH_CELLS for a cell it never does. */
function spiralIndex(dx: number, dz: number): number {
  const r = Math.max(Math.abs(dx), Math.abs(dz));
  if (r > REACH) return SEARCH_CELLS;
  if (!r) return 0;
  const first = (2 * r - 1) ** 2; // the ring starts at (r, 1 - r) and runs +z, -x, -z, +x, 2r cells a side
  if (dx === r && dz > -r) return first + r - 1 + dz;
  if (dz === r) return first + 3 * r - 1 - dx;
  if (dx === -r) return first + 5 * r - 1 - dz;
  return first + 7 * r - 1 + dx;
}

export class Pedestrians {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  getActivity: PedestrianFeed | null = null;
  private dry = geometry(false);
  private wet = geometry(true);
  private active = roster();
  private pending = roster();
  private cap: number;
  private time = 0;
  private timer = 0;
  private dirty = true;
  private scanning = false;
  private cx = 0;
  private cz = 0;
  private sx = 0;
  private sz = 0;
  private direction = 0;
  private leg = 1;
  private step = 0;
  private cursor = 0;
  /** The previous roster's slots in the order the running search reaches their cells, and how many it has passed. */
  private keys = new Uint32Array(CAP);
  private passed = 0;
  /** The ranks of the walkers written this frame, and room to sort them when the night quota binds. */
  private kept = new Uint32Array(CAP);
  private sorted = new Uint32Array(CAP);
  private frustum = new THREE.Frustum();
  private projection = new THREE.Matrix4();
  private point = new THREE.Vector3();
  private around = new THREE.Sphere();

  constructor(private state: CityState, private net: NetInfo, private surf: RoadSurface, quality: QualityLevel = 'high') {
    this.cap = CAPS[quality];
    const base = getCityMaterial(), material = base.clone(), compile = base.onBeforeCompile;
    material.name = 'pedestrians';
    material.onBeforeCompile = (shader, renderer) => {
      compile.call(base, shader, renderer);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float coatMask;');
      shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor.xyz = color.xyz * mix(vec3(1.0), instanceColor.xyz, coatMask);
        #endif`);
    };
    material.customProgramCacheKey = () => base.customProgramCacheKey() + '|pedestrians-v1';
    this.mesh = new THREE.InstancedMesh(this.dry, material, CAP);
    this.mesh.name = 'pedestrians';
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false; // compacted against the current camera below; no stale instance bounds
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, COATS[0]);
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }

  setState(state: CityState, net: NetInfo, surf: RoadSurface): void {
    this.state = state; this.net = net; this.surf = surf;
    this.clear();
  }

  setQuality(q: QualityLevel): void { this.cap = CAPS[q]; this.clear(); }
  invalidate(): void { this.dirty = true; }

  clear(): void {
    this.active.n = this.pending.n = this.mesh.count = 0;
    this.mesh.visible = this.scanning = false;
    this.dirty = true;
  }

  private walkable(i: number): boolean {
    const net = this.net, t = net.roadType[i], m = net.roadMask[i];
    if (!hasSidewalk(t) || (m !== 5 && m !== 10) || net.crossing[i] || net.bCross[i] || (this.state.netFlags[i] & NF_TUNNEL)) return false;
    const d = m === 5 ? 0 : 1;
    return net.edgeHalf(i, d) === HALF_W[t] && net.edgeHalf(i, d + 2) === HALF_W[t];
  }

  private density(i: number, x: number, z: number): number {
    const st = this.state, stats = st.stats;
    const feed = this.getActivity?.(i);
    if (feed) return Math.min(10, Math.max(0, feed.customers / 40 + feed.visitors / 25 + feed.riders / 30));
    // The host does not yet stream exact local customers / visitors / riders. Do not read subscribed derived
    // layers or traffic system internals: nearby mirrored occupants, jobs, road traffic and city totals suffice.
    let residents = 0, jobs = 0, shops = 0;
    const horizontal = this.net.roadMask[i] === 5;
    for (let k = -2; k <= 2; k++) {
      if (!k) continue;
      const bx = x + (horizontal ? 0 : k), bz = z + (horizontal ? k : 0);
      if (bx < 0 || bz < 0 || bx >= st.size || bz >= st.size) continue;
      const b = st.buildings.get(st.building[bz * st.size + bx]);
      if (!b || b.built < 1 || b.flags & (BF.Abandoned | BF.Burnt | BF.OnFire)) continue;
      const area = b.w * b.d, def = getDef(b.def);
      residents += b.pop / area;
      jobs += b.jobs / area;
      if (def?.devType != null && def.devType >= DevType.CS1 && def.devType <= DevType.CS3) shops += b.jobs / area;
    }
    const occupants = residents + jobs, population = Math.max(1, stats.population);
    const visitors = stats.tourists * occupants / population;
    const riders = (stats.tripsTransit + stats.tripsWalk) * occupants / population;
    return Math.min(10, Math.min(3, population / 15000) * Math.min(1, occupants / 30)
      + residents / 55 + jobs / 70 + shops / 35 + visitors / 25 + riders / 30 + Math.min(1, st.traffic[i] / 100));
  }

  /**
   * Whether a search takes the walkable cell now: its middle inside the spawn distance of the camera and in view. A
   * cell the previous roster holds stays until none of its walkers can be in view (they pace within 10 m of the
   * middle; 12 m allows for a sloping deck), so nobody vanishes inside the screen because the middle of his cell
   * has left it. A full roster has no places to spare for that: there `held` is false.
   */
  private taken(i: number, x: number, z: number, cp: THREE.Vector3, held: boolean): boolean {
    const wx = (x + 0.5) * CELL_SIZE, wz = (z + 0.5) * CELL_SIZE;
    const y = this.surf.baseIn(i, wx, wz) + LIFT + CURB_H;
    if ((wx - cp.x) ** 2 + (y - cp.y) ** 2 + (wz - cp.z) ** 2 > (SPAWN_DISTANCE - 12) ** 2) return false;
    this.around.center.set(wx, y + 1, wz);
    this.around.radius = held ? 12 : 0;
    return this.frustum.intersectsSphere(this.around);
  }

  /**
   * Scan outwards from the camera; update() draws what has been found so far. The slice follows the frame's length,
   * so a search takes the same 0.43 s at 30 fps as at 60 and a fast pan on a slow machine cannot outrun it.
   */
  private discover(camera: THREE.PerspectiveCamera, dt: number): void {
    const st = this.state, N = st.size, cp = camera.position, old = this.active, keys = this.keys, spare = old.n < this.cap;
    const budget = Math.min(MAX_CELLS_PER_FRAME, Math.max(CELLS_PER_FRAME, Math.round(CELLS_PER_FRAME * 60 * dt)));
    for (let k = 0; k < budget && this.cursor < SEARCH_CELLS && this.pending.n < this.cap; k++) {
      const x = this.cx + this.sx, z = this.cz + this.sz, at = this.cursor++;
      if (this.direction === 0) this.sx++;
      else if (this.direction === 1) this.sz++;
      else if (this.direction === 2) this.sx--;
      else this.sz--;
      if (++this.step === this.leg) {
        this.step = 0; this.direction = (this.direction + 1) & 3;
        if (!(this.direction & 1)) this.leg++;
      }
      // The previous roster's walkers on the cells before this one have given way to what the search found there.
      while (this.passed < old.n && keys[this.passed] >>> 10 < at) this.passed++;
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const i = z * N + x;
      if (!this.walkable(i) || !this.taken(i, x, z, cp, spare && this.passed < old.n && keys[this.passed] >>> 10 === at)) continue;
      const amount = this.density(i, x, z), seed = hash(i);
      const n = Math.floor(amount) + ((seed & 65535) / 65536 < amount % 1 ? 1 : 0);
      for (let j = 0; j < n && this.pending.n < this.cap; j++) {
        const slot = this.pending.n++;
        this.pending.cells[slot] = i;
        this.pending.seeds[slot] = hash(i * 16 + j);
        this.pending.ranks[slot] = hash(this.pending.seeds[slot] ^ ACTIVITY_SALT);
      }
    }
    while (this.passed < old.n && keys[this.passed] >>> 10 < this.cursor) this.passed++;
    if (this.cursor >= SEARCH_CELLS || this.pending.n === this.cap) {
      this.active = this.pending; this.pending = old;
      this.scanning = false;
      this.timer = 1;
    }
  }

  /** The night quota, when it binds: keep the lowest-ranked of the n walkers written, whatever order they are in. */
  private thin(n: number, quota: number): number {
    const kept = this.kept, sorted = this.sorted.subarray(0, n);
    sorted.set(kept.subarray(0, n));
    sorted.sort();
    const top = quota ? sorted[quota - 1] : -1; // ranks are distinct: hash() is one-to-one, and so are the seeds
    const data = this.mesh.instanceMatrix.array, colors = this.mesh.instanceColor!.array;
    let m = 0;
    for (let j = 0; j < n; j++) {
      if (kept[j] > top) continue;
      if (m < j) { data.copyWithin(m * 16, j * 16, j * 16 + 16); colors.copyWithin(m * 3, j * 3, j * 3 + 3); }
      m++;
    }
    return m;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, hour: number, rain = false): void {
    this.time += Math.max(0, dt);
    this.timer -= dt;
    const cp = camera.position;
    if (cp.y - this.surf.terrain(cp.x, cp.z) > HIDE_DISTANCE) { this.clear(); return; }
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const N = this.state.size, cx = Math.floor(cp.x / CELL_SIZE), cz = Math.floor(cp.z / CELL_SIZE);
    const away = Math.max(Math.abs(cx - this.cx), Math.abs(cz - this.cz));
    // A running search is left to finish while the camera stays inside the square it covers: restarting it on every
    // small move starved a fast pan (QA B3). Once the camera is outside that square (a jump) the search is centred
    // on the wrong place, so it is abandoned and a new one starts at once (QA N1).
    if (this.scanning ? away > REACH : this.dirty || away > 3 || this.timer <= 0) {
      this.cx = cx; this.cz = cz;
      this.sx = this.sz = this.direction = this.step = this.cursor = this.pending.n = this.passed = 0;
      this.leg = 1; this.scanning = true; this.dirty = false;
      // Order the previous roster as this search will reach its cells: it keeps each cell until the search gets
      // there, and where the cap has to cut the two together it cuts what the finished search would drop.
      const old = this.active, keys = this.keys;
      for (let s = 0; s < old.n; s++) keys[s] = spiralIndex(old.cells[s] % N - cx, Math.floor(old.cells[s] / N) - cz) * 1024 + s;
      keys.subarray(0, old.n).sort();
    }
    if (this.scanning) this.discover(camera, dt);
    this.mesh.geometry = rain ? this.wet : this.dry;
    const data = this.mesh.instanceMatrix.array, colors = this.mesh.instanceColor!.array;
    const searching = this.scanning, cap = this.cap, kept = this.kept, activity = pedestrianActivityAt(hour);
    let n = 0, eligible = 0;
    // While a search runs its finds are drawn at once, so nothing waits for the whole search and pops in together;
    // the previous roster follows, less the cells the search has passed. Otherwise there is only the last roster.
    for (let pass = searching ? 0 : 1; pass < 2; pass++) {
      const r = pass ? this.active : this.pending, ordered = searching && pass === 1;
      let cell = -1, stays = true;
      for (let j = ordered ? this.passed : 0; j < r.n && eligible < cap; j++) {
        const slot = ordered ? this.keys[j] & 1023 : j, i = r.cells[slot], seed = r.seeds[slot];
        if (!this.walkable(i)) continue;
        // A cell the search would not take any more goes now rather than when the search gets to it: what is drawn
        // is then what the finished search will hold, and the cap never cuts a walker that is about to return.
        if (ordered && i !== cell) { cell = i; stays = this.taken(i, i % N, Math.floor(i / N), cp, r.n < cap); }
        if (!stays) continue;
        const horizontal = this.net.roadMask[i] === 5;
        const phase = (this.time * (0.85 + (seed & 255) / 512) + (seed >>> 8) / 0x1000000 * PATH * 2) % (PATH * 2);
        const along = phase < PATH ? phase - PATH / 2 : PATH * 1.5 - phase;
        const forward = phase < PATH ? 1 : -1;
        const t = this.net.roadType[i];
        const side = (t === Network.Avenue ? 7.72 : (HALF_W[t] + HALF) / 2) * (seed & 1 ? 1 : -1);
        const x = (i % N + 0.5) * CELL_SIZE + (horizontal ? along : side);
        const z = (Math.floor(i / N) + 0.5) * CELL_SIZE + (horizontal ? side : along);
        const y = this.surf.baseIn(i, x, z) + LIFT + CURB_H;
        if ((x - cp.x) ** 2 + (y - cp.y) ** 2 + (z - cp.z) ** 2 > (HIDE_DISTANCE - 3) ** 2) continue;
        this.point.set(x, y + 1, z);
        if (!this.frustum.containsPoint(this.point)) continue;
        eligible++;
        if (r.ranks[slot] / 4294967296 >= activity) continue;
        const o = n * 16, c = n * 3, coat = COATS[seed & 3];
        const fx = horizontal ? forward : 0, fz = horizontal ? 0 : forward;
        data[o] = fz; data[o + 1] = 0; data[o + 2] = -fx; data[o + 3] = 0;
        data[o + 4] = 0; data[o + 5] = 1; data[o + 6] = 0; data[o + 7] = 0;
        data[o + 8] = fx; data[o + 9] = 0; data[o + 10] = fz; data[o + 11] = 0;
        data[o + 12] = x; data[o + 13] = y; data[o + 14] = z; data[o + 15] = 1;
        colors[c] = coat.r; colors[c + 1] = coat.g; colors[c + 2] = coat.b;
        kept[n++] = r.ranks[slot];
      }
    }
    // Keep the 03:00 share below 20%, even for small / unusually night-heavy views. Normally the quota is slack, so
    // each walker's own seed alone decides its presence; when it binds, the lowest ranks stay, whatever the order.
    const quota = Math.floor(eligible * Math.min(1, activity * 1.33));
    if (n > quota) n = this.thin(n, quota);
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n) {
      const matrices = this.mesh.instanceMatrix, coats = this.mesh.instanceColor!;
      matrices.clearUpdateRanges(); matrices.addUpdateRange(0, n * 16); matrices.needsUpdate = true;
      coats.clearUpdateRanges(); coats.addUpdateRange(0, n * 3); coats.needsUpdate = true;
    }
  }

  dispose(): void {
    this.clear();
    this.getActivity = null;
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.mesh.material.dispose();
    this.dry.dispose(); this.wet.dispose();
  }
}
