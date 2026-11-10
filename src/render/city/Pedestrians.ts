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
const CELLS_PER_FRAME = 80;
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
  return { cells: new Int32Array(CAP), seeds: new Uint32Array(CAP), ranks: new Uint32Array(CAP), order: new Uint16Array(CAP), n: 0 };
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
  private frustum = new THREE.Frustum();
  private projection = new THREE.Matrix4();
  private point = new THREE.Vector3();

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

  /** Scan outwards from the camera, at most 80 cells a frame, retaining the previous roster until ready. */
  private discover(camera: THREE.PerspectiveCamera): void {
    const st = this.state, N = st.size, cp = camera.position;
    const limit = (2 * Math.ceil(SPAWN_DISTANCE / CELL_SIZE) + 1) ** 2;
    for (let k = 0; k < CELLS_PER_FRAME && this.cursor < limit && this.pending.n < this.cap; k++) {
      const x = this.cx + this.sx, z = this.cz + this.sz;
      this.cursor++;
      if (this.direction === 0) this.sx++;
      else if (this.direction === 1) this.sz++;
      else if (this.direction === 2) this.sx--;
      else this.sz--;
      if (++this.step === this.leg) {
        this.step = 0; this.direction = (this.direction + 1) & 3;
        if (!(this.direction & 1)) this.leg++;
      }
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const i = z * N + x;
      if (!this.walkable(i)) continue;
      const wx = (x + 0.5) * CELL_SIZE, wz = (z + 0.5) * CELL_SIZE;
      const y = this.surf.baseIn(i, wx, wz) + LIFT + CURB_H;
      if ((wx - cp.x) ** 2 + (y - cp.y) ** 2 + (wz - cp.z) ** 2 > (SPAWN_DISTANCE - 12) ** 2) continue;
      this.point.set(wx, y + 1, wz);
      if (!this.frustum.containsPoint(this.point)) continue;
      const amount = this.density(i, x, z), seed = hash(i);
      const n = Math.floor(amount) + ((seed & 65535) / 65536 < amount % 1 ? 1 : 0);
      for (let j = 0; j < n && this.pending.n < this.cap; j++) {
        const slot = this.pending.n++;
        this.pending.cells[slot] = i;
        this.pending.seeds[slot] = hash(i * 16 + j);
        this.pending.ranks[slot] = hash(this.pending.seeds[slot] ^ ACTIVITY_SALT);
        this.pending.order[slot] = slot;
      }
    }
    if (this.cursor >= limit || this.pending.n === this.cap) {
      // Sort once per roster, not per frame: the rare night quota keeps the same lowest-ranked seeds even when
      // discovery visits their cells in a different order. Edge crossings never shift every later walker's rank.
      const r = this.pending;
      r.order.subarray(0, r.n).sort((a, b) => r.ranks[a] - r.ranks[b] || r.seeds[a] - r.seeds[b]);
      const old = this.active; this.active = this.pending; this.pending = old;
      this.scanning = false;
      this.timer = 1;
    }
  }

  update(dt: number, camera: THREE.PerspectiveCamera, hour: number, rain = false): void {
    this.time += Math.max(0, dt);
    this.timer -= dt;
    const cp = camera.position;
    if (cp.y - this.surf.terrain(cp.x, cp.z) > HIDE_DISTANCE) { this.clear(); return; }
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const cx = Math.floor(cp.x / CELL_SIZE), cz = Math.floor(cp.z / CELL_SIZE);
    const moved = Math.abs(cx - this.cx) > 3 || Math.abs(cz - this.cz) > 3;
    if (!this.scanning && (this.dirty || moved || this.timer <= 0)) {
      this.cx = cx; this.cz = cz;
      this.sx = this.sz = this.direction = this.step = this.cursor = this.pending.n = 0;
      this.leg = 1; this.scanning = true; this.dirty = false;
    }
    if (this.scanning) this.discover(camera);
    this.mesh.geometry = rain ? this.wet : this.dry;
    const data = this.mesh.instanceMatrix.array, colors = this.mesh.instanceColor!.array;
    const active = this.active, N = this.state.size, activity = pedestrianActivityAt(hour);
    let n = 0, eligible = 0;
    for (let j = 0; j < active.n; j++) {
      const slot = active.order[j], i = active.cells[slot], seed = active.seeds[slot];
      if (!this.walkable(i)) continue;
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
      if (active.ranks[slot] / 4294967296 >= activity) continue;
      const o = n * 16, c = n * 3, coat = COATS[seed & 3];
      const fx = horizontal ? forward : 0, fz = horizontal ? 0 : forward;
      data[o] = fz; data[o + 1] = 0; data[o + 2] = -fx; data[o + 3] = 0;
      data[o + 4] = 0; data[o + 5] = 1; data[o + 6] = 0; data[o + 7] = 0;
      data[o + 8] = fx; data[o + 9] = 0; data[o + 10] = fz; data[o + 11] = 0;
      data[o + 12] = x; data[o + 13] = y; data[o + 14] = z; data[o + 15] = 1;
      colors[c] = coat.r; colors[c + 1] = coat.g; colors[c + 2] = coat.b;
      n++;
    }
    // Keep the 03:00 share below 20%, even for small / unusually night-heavy views. Roster rank order makes the
    // quota deterministic; normally it is slack, so each walker's own seed alone decides its presence.
    n = Math.min(n, Math.floor(eligible * Math.min(1, activity * 1.33)));
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
