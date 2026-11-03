/**
 * EmergencyVehicles (WP8) — the fire trucks, police cars and ambulances of the emergency dispatch system, driving
 * their real road routes (src/sim/infra/emergency.ts: path corner cells + cumulative minutes, positions from
 * vehiclePosition(v, simTime)), plus incident beacons.
 *
 *   vehicles   one DynamicBatch (city material) with the fire_truck / car_police / ambulance models (<= MAX_VEHICLES)
 *   lights     alternating red / blue light-bar quads at 3 Hz on every vehicle with sirens on (outbound, on scene,
 *              taking a patient to hospital) + an additive ground glow that reads at night
 *   beacons    a pulsing ring (incident colour) at every active incident; incidents waiting for the player (nobody
 *              is coming) also get a tall light beam so they can be found from far away
 *
 * Driven by a feed (CityObjectsViewContext.getEmergency): vehicles(), incidents(), time() = Simulation.simTime().
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../../core/constants';
import type { CityState } from '../../../sim/CityState';
import { INCIDENT_COLOR, vehiclePosition, type EmergencyVehicle, type Incident, type VehiclePos } from '../../../sim/infra/emergency';
import { EMERG_DAYS_PER_MIN } from '../../../sim/infra/params';
import { sharedUniforms } from '../../../assets/materials';
import { DynamicBatch } from '../common/batch';
import { getCityMaterial } from '../common/cityMaterial';
import { HALF_W, DX, DZ, junctionFillet, roadsConnect } from '../common/netinfo';
import type { RoadSurface } from '../common/surface';
import { vehicleGeometry } from './VehicleRenderer';

export interface EmergencyFeed {
  vehicles(): readonly EmergencyVehicle[];
  incidents(): readonly Incident[];
  /** continuous sim time in days (Simulation.simTime()) */
  time(): number;
}

const MAX_VEHICLES = 48;
const MAX_BEACONS = 64;
/** right-hand lane offset (m) while driving; parked on scene a little further out */
const LANE = 1.9;
const PARK = 3.2;
const RED = new THREE.Color(1, 0.12, 0.08);
const BLUE = new THREE.Color(0.15, 0.35, 1);
const AMBER = new THREE.Color(1, 0.62, 0.1);

interface DrawnRoute {
  path: number[]; times: number[]; size: number;
  x: number[]; z: number[]; length: number[]; distance: number[];
  hx: number[]; hz: number[]; speed: number[]; radius: number[];
}
const drawnRoutes = new WeakMap<number[], DrawnRoute>();
const rightWidths = new Map<string, number>();

function drawnRoute(v: EmergencyVehicle, N: number): DrawnRoute {
  const old = drawnRoutes.get(v.path);
  if (old && old.size === N && old.path.length === v.path.length && old.times.length === v.times.length) {
    let same = true;
    for (let j = 0; j < v.path.length; j++) if (old.path[j] !== v.path[j] || old.times[j] !== v.times[j]) { same = false; break; }
    if (same) return old;
  }
  const g: DrawnRoute = { path: v.path.slice(), times: v.times.slice(), size: N, x: [], z: [], length: [], distance: [0], hx: [], hz: [], speed: [], radius: [0] };
  for (const c of v.path) { g.x.push(c % N + 0.5); g.z.push(Math.floor(c / N) + 0.5); }
  for (let j = 0; j < v.path.length - 1; j++) {
    const dx = g.x[j + 1] - g.x[j], dz = g.z[j + 1] - g.z[j], len = Math.hypot(dx, dz);
    g.length.push(len);
    g.distance.push(g.distance[j] + len);
    g.hx.push(len ? dx / len : 1); g.hz.push(len ? dz / len : 0);
    g.speed.push(len / Math.max(1e-9, v.times[j + 1] - v.times[j]));
  }
  for (let j = 1; j < v.path.length - 1; j++) g.radius.push(Math.min(1, g.length[j - 1] / 2, g.length[j] / 2));
  g.radius.push(0);
  drawnRoutes.set(v.path, g);
  return g;
}

function turnRadius(g: DrawnRoute, k: number, model: string, network?: ArrayLike<number>): number {
  const r = g.radius[k];
  if (!network || !(r > 0) || g.hx[k - 1] * g.hz[k] - g.hz[k - 1] * g.hx[k] <= 0) return r;
  const c = g.path[k], own = network[c], x = c % g.size, z = Math.floor(c / g.size);
  let b = HALF_W[own] || 0, arms = 0;
  for (let d = 0; d < 4; d++) {
    const nx = x + DX[d], nz = z + DZ[d];
    if (nx < 0 || nz < 0 || nx >= g.size || nz >= g.size) continue;
    const t = network[nz * g.size + nx];
    if (roadsConnect(own, t)) { b = Math.max(b, HALF_W[t]); arms++; }
  }
  // Uniform two-arm bends use the road mesher's arc; mixed-width bends use its filleted junction instead.
  if (arms < 2 || (arms === 2 && b === HALF_W[own])) return r;
  let width = rightWidths.get(model);
  if (width === undefined) {
    const geom = vehicleGeometry(model, 0);
    if (!geom.boundingBox) geom.computeBoundingBox();
    width = Math.max(0, -(geom.boundingBox?.min.x ?? 0));
    rightWidths.set(model, width);
  }
  // Keep the whole inside side edge outside the curb's fillet, including its closest point between the axles.
  const cap = 4 * (b + junctionFillet(b) * (1 - Math.SQRT1_2) - (LANE + width) * Math.SQRT1_2) / CELL_SIZE;
  return Math.min(r, Math.max(0, cap));
}

/** Render-only world position: round one cell around turns and ease the final stop. The sim route is unchanged. */
export function drawnVehiclePosition(v: EmergencyVehicle, t: number, N: number, out: VehiclePos = { x: 0, z: 0, hx: 1, hz: 0, moving: false }, network?: ArrayLike<number>): VehiclePos {
  if (v.path.length < 2 || (v.state !== 'outbound' && v.state !== 'onScene')) {
    vehiclePosition(v, t, N, out);
    const off = v.state === 'onScene' ? PARK : LANE;
    out.x = out.x * CELL_SIZE - out.hz * off;
    out.z = out.z * CELL_SIZE + out.hx * off;
    return out;
  }
  const g = drawnRoute(v, N), n = g.x.length, tm = g.times;
  const m = v.m0 + Math.max(0, (t - v.legStart) / EMERG_DAYS_PER_MIN);
  const end = tm[n - 1], total = g.distance[n - 1];
  const endW = Math.min(0.12, (tm[n - 1] - tm[n - 2]) / 2);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tm[mid] <= m) lo = mid; else hi = mid; }
  let d = g.distance[lo] + Math.max(0, Math.min(1, (m - tm[lo]) / Math.max(1e-9, tm[lo + 1] - tm[lo]))) * g.length[lo];
  // Integrating a linear speed blend preserves position and velocity at both edges of each turn window.
  for (let j = lo; j <= lo + 1; j++) {
    if (j <= 0 || j >= n - 1) continue;
    const vin = g.speed[j - 1], vout = g.speed[j], w = turnRadius(g, j, v.model, network) / Math.max(vin, vout);
    if (w > 0 && Math.abs(m - tm[j]) < w) {
      const u = m - (tm[j] - w);
      d = g.distance[j] - vin * w + vin * u + (vout - vin) * u * u / (4 * w);
      break;
    }
  }
  if (endW > 0 && m >= end - endW) {
    const speed = g.speed[n - 2], u = Math.min(m - (end - endW), 2 * endW);
    d = total - speed * endW + speed * u - speed * u * u / (4 * endW);
  }
  d = Math.max(0, Math.min(total, d));
  let j = 0;
  while (j < n - 2 && g.distance[j + 1] <= d) j++;
  const f = Math.max(0, Math.min(1, (d - g.distance[j]) / Math.max(1e-9, g.length[j])));
  out.x = g.x[j] + (g.x[j + 1] - g.x[j]) * f;
  out.z = g.z[j] + (g.z[j + 1] - g.z[j]) * f;
  out.hx = g.hx[j]; out.hz = g.hz[j];
  for (let k = j; k <= j + 1; k++) {
    if (k <= 0 || k >= n - 1) continue;
    const r = turnRadius(g, k, v.model, network);
    if (!(r > 0) || Math.abs(d - g.distance[k]) >= r) continue;
    const u = (d - (g.distance[k] - r)) / (2 * r), a = 1 - u;
    out.x = g.x[k] - a * a * r * g.hx[k - 1] + u * u * r * g.hx[k];
    out.z = g.z[k] - a * a * r * g.hz[k - 1] + u * u * r * g.hz[k];
    const hx = a * g.hx[k - 1] + u * g.hx[k], hz = a * g.hz[k - 1] + u * g.hz[k], len = Math.hypot(hx, hz) || 1;
    out.hx = hx / len; out.hz = hz / len;
    break;
  }
  const park = endW > 0 ? Math.max(0, Math.min(1, (m - (end - endW)) / (2 * endW))) : Number(m >= end);
  const off = LANE + (PARK - LANE) * park * park * (3 - 2 * park);
  out.x = out.x * CELL_SIZE - out.hz * off;
  out.z = out.z * CELL_SIZE + out.hx * off;
  out.moving = m > v.m0 && m < end + endW;
  return out;
}

/** 64x64 radial falloff (additive glows) — no DOM needed */
function radialTexture(): THREE.DataTexture {
  const S = 64;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5) / S - 0.5, dy = (y + 0.5) / S - 0.5;
    const r = Math.min(1, Math.hypot(dx, dy) * 2);
    const a = Math.pow(1 - r, 2.2);
    const o = (y * S + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = 255;
    data[o + 3] = Math.round(a * 255);
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  return t;
}

export class EmergencyVehicles {
  readonly group = new THREE.Group();
  private batch: DynamicBatch;
  private lights: THREE.InstancedMesh;
  private glows: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private beams: THREE.InstancedMesh;
  /** sim vehicle id -> batch instance */
  private inst = new Map<number, { id: number; model: string; top: number }>();
  private seen = new Set<number>();
  private pos: VehiclePos = { x: 0, z: 0, hx: 1, hz: 0, moving: false };
  private beforePos: VehiclePos = { x: 0, z: 0, hx: 1, hz: 0, moving: false };
  private afterPos: VehiclePos = { x: 0, z: 0, hx: 1, hz: 0, moving: false };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private col = new THREE.Color();
  private clock = 0;
  private tex: THREE.DataTexture;
  /** geometry top (m) per model, for the light bar height */
  private tops = new Map<string, number>();
  enabled = true;
  /** vehicles drawn last frame (stats) */
  count = 0;

  constructor(private state: CityState, private surf: RoadSurface, public feed: EmergencyFeed | null = null) {
    this.group.name = 'emergency';
    this.batch = new DynamicBatch(getCityMaterial(), MAX_VEHICLES + 8, 1 << 15, 'emergencyVehicles');
    this.batch.mesh.castShadow = true;
    this.batch.mesh.receiveShadow = true;
    this.tex = radialTexture();
    // light bars: small emissive boxes (2 per vehicle)
    const lg = new THREE.BoxGeometry(0.55, 0.22, 0.4);
    const lm = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.lights = new THREE.InstancedMesh(lg, lm, MAX_VEHICLES * 2);
    this.lights.count = 0;
    this.lights.frustumCulled = false;
    this.lights.name = 'emergencyLights';
    // ground glow (1 per vehicle)
    const gg = new THREE.PlaneGeometry(1, 1);
    gg.rotateX(-Math.PI / 2);
    const gm = new THREE.MeshBasicMaterial({ map: this.tex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    this.glows = new THREE.InstancedMesh(gg, gm, MAX_VEHICLES);
    this.glows.count = 0;
    this.glows.frustumCulled = false;
    this.glows.renderOrder = 4;
    // incident rings
    const rg = new THREE.RingGeometry(0.82, 1, 48, 1);
    rg.rotateX(-Math.PI / 2);
    const rm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    this.rings = new THREE.InstancedMesh(rg, rm, MAX_BEACONS);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 4;
    // beams: open cylinder fading upwards (vertex alpha via a gradient in the colour attribute)
    const bg = new THREE.CylinderGeometry(1, 1.4, 1, 16, 6, true);
    bg.translate(0, 0.5, 0);
    const bp = bg.attributes.position as THREE.BufferAttribute;
    const bc = new Float32Array(bp.count * 3);
    for (let i = 0; i < bp.count; i++) {
      const f = Math.pow(1 - bp.getY(i), 1.6);
      bc[i * 3] = bc[i * 3 + 1] = bc[i * 3 + 2] = f;
    }
    bg.setAttribute('color', new THREE.BufferAttribute(bc, 3));
    const bm = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    this.beams = new THREE.InstancedMesh(bg, bm, MAX_BEACONS);
    this.beams.count = 0;
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 5;
    for (const im of [this.lights, this.glows, this.rings, this.beams]) {
      im.setColorAt(0, this.col.set(1, 1, 1));
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.group.add(this.batch.mesh, this.lights, this.glows, this.rings, this.beams);
  }

  setState(state: CityState, surf: RoadSurface): void {
    this.clear();
    this.state = state;
    this.surf = surf;
  }

  clear(): void {
    for (const v of this.inst.values()) this.batch.remove(v.id);
    this.inst.clear();
    this.lights.count = this.glows.count = this.rings.count = this.beams.count = 0;
  }

  private geomOf(model: string): number {
    return this.batch.geometryId(`${model}#0`, () => {
      const g = vehicleGeometry(model, 0);
      if (!g.boundingBox) g.computeBoundingBox();
      this.tops.set(model, g.boundingBox ? g.boundingBox.max.y : 2);
      return g;
    });
  }

  update(dt: number): void {
    this.clock += dt;
    const feed = this.feed;
    if (!feed || !this.enabled) {
      if (this.inst.size) this.clear();
      this.count = 0;
      return;
    }
    let list: readonly EmergencyVehicle[] = [];
    let incs: readonly Incident[] = [];
    let t = 0;
    try {
      list = feed.vehicles();
      incs = feed.incidents();
      t = feed.time();
    } catch {
      return;
    }
    const N = this.state.size;
    const night = sharedUniforms.uNight.value;
    const flash = Math.floor(this.clock * 6); // 3 Hz alternation
    const seen = this.seen;
    seen.clear();
    let nl = 0, ng = 0, shown = 0;
    for (let k = 0; k < list.length && shown < MAX_VEHICLES; k++) {
      const v = list[k];
      if (!v.path || v.path.length === 0) continue;
      seen.add(v.id);
      let e = this.inst.get(v.id);
      if (!e || e.model !== v.model) {
        if (e) this.batch.remove(e.id);
        const g = this.geomOf(v.model);
        e = { id: this.batch.add(g), model: v.model, top: this.tops.get(v.model) ?? 2 };
        this.inst.set(v.id, e);
      }
      shown++;
      const ps = drawnVehiclePosition(v, t, N, this.pos, this.surf.net?.roadType ?? this.state.network);
      const wx = ps.x, wz = ps.z;
      const y = this.surf.y(wx, wz);
      const ang = Math.atan2(ps.hx, ps.hz);
      this.q.setFromAxisAngle(this.up, ang);
      this.p.set(wx, y, wz);
      this.m.compose(this.p, this.q, this.s);
      this.batch.setMatrix(e.id, this.m);
      // sirens / lights: on the way, on scene, taking a patient to hospital (not when driving home)
      const lit = v.state !== 'returning';
      if (!lit) continue;
      const top = e.top + 0.12;
      const ph = (flash + v.id) & 1;
      const cA = v.responder === 'fire' ? RED : ph ? RED : BLUE;
      const cB = v.responder === 'fire' ? (ph ? AMBER : RED) : ph ? BLUE : RED;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      const lz = v.model === 'fire_truck' ? 1.6 : 0; // fire truck: light bar over the cab
      for (let side = -1; side <= 1; side += 2) {
        const lx = side * 0.42;
        // local (lx, top, lz) rotated by ang around y
        this.p.set(wx + lx * cos + lz * sin, y + top, wz - lx * sin + lz * cos);
        this.m.compose(this.p, this.q, this.s);
        this.lights.setMatrixAt(nl, this.m);
        const on = side < 0 ? ph === 0 : ph === 1;
        this.col.copy(side < 0 ? cA : cB).multiplyScalar(on ? 1.6 : 0.25);
        this.lights.setColorAt(nl, this.col);
        nl++;
      }
      // ground glow: stronger at night
      const gs = 9 + 3 * night;
      this.p.set(wx, y + 0.15, wz);
      this.m.compose(this.p, this.q, this.s.set(gs, 1, gs));
      this.s.set(1, 1, 1);
      this.glows.setMatrixAt(ng, this.m);
      this.col.copy(ph ? cA : cB).multiplyScalar(0.18 + 0.55 * night);
      this.glows.setColorAt(ng, this.col);
      ng++;
    }
    // drop vehicles that are home
    if (this.inst.size > seen.size) {
      for (const [id, e] of this.inst) if (!seen.has(id)) { this.batch.remove(e.id); this.inst.delete(id); }
    }
    this.count = shown;
    this.lights.count = nl;
    this.glows.count = ng;
    if (nl) { this.lights.instanceMatrix.needsUpdate = true; if (this.lights.instanceColor) this.lights.instanceColor.needsUpdate = true; }
    if (ng) { this.glows.instanceMatrix.needsUpdate = true; if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true; }
    this.updateBeacons(incs);
  }

  private updateBeacons(incs: readonly Incident[]): void {
    const st = this.state;
    let nr = 0, nb = 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 4);
    for (let k = 0; k < incs.length && nr < MAX_BEACONS; k++) {
      const inc = incs[k];
      if (inc.state === 'resolved' || inc.state === 'failed') continue;
      const b = inc.buildingId >= 0 ? st.buildings.get(inc.buildingId) : undefined;
      const cx = b ? (b.x + b.w / 2) * CELL_SIZE : (inc.x + 0.5) * CELL_SIZE;
      const cz = b ? (b.z + b.d / 2) * CELL_SIZE : (inc.z + 0.5) * CELL_SIZE;
      const y = this.surf.terrain(cx, cz);
      const base = inc.kind === 'riot' ? Math.max(1.5, inc.radius) * CELL_SIZE : (b ? Math.max(b.w, b.d) : 1) * CELL_SIZE * 0.85 + 4;
      const waiting = inc.state === 'uncovered' || inc.state === 'queued';
      const r = base * (1 + (waiting ? 0.18 : 0.08) * pulse);
      this.p.set(cx, y + 0.35, cz);
      this.q.identity();
      this.m.compose(this.p, this.q, this.s.set(r, 1, r));
      this.rings.setMatrixAt(nr, this.m);
      this.col.set(INCIDENT_COLOR[inc.kind]).multiplyScalar(waiting ? 0.6 + 0.5 * pulse : 0.45);
      this.rings.setColorAt(nr, this.col);
      nr++;
      if (waiting && (inc.manualPossible || inc.canSend) && nb < MAX_BEACONS) {
        this.m.compose(this.p, this.q, this.s.set(3, 90, 3));
        this.beams.setMatrixAt(nb, this.m);
        this.col.set(INCIDENT_COLOR[inc.kind]).multiplyScalar(0.35 + 0.25 * pulse);
        this.beams.setColorAt(nb, this.col);
        nb++;
      }
      this.s.set(1, 1, 1);
    }
    this.rings.count = nr;
    this.beams.count = nb;
    if (nr) { this.rings.instanceMatrix.needsUpdate = true; if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true; }
    if (nb) { this.beams.instanceMatrix.needsUpdate = true; if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true; }
  }

  /** Rendered world position with a tangent-velocity camera lead; arrival always uses the current feed time. */
  followPosition(vehicleId: number, aheadDays = 0): { x: number; y: number; z: number; onScene: boolean } | null {
    const feed = this.feed;
    if (!feed) return null;
    let list: readonly EmergencyVehicle[] = [];
    let t = 0;
    try {
      list = feed.vehicles();
      t = feed.time();
    } catch {
      return null;
    }
    const v = list.find(v => v.id === vehicleId);
    if (!v || !v.path?.length || (v.state !== 'outbound' && v.state !== 'onScene')) return null;
    const network = this.surf.net?.roadType ?? this.state.network;
    const ps = drawnVehiclePosition(v, t, this.state.size, this.pos, network);
    const onScene = v.state === 'onScene' || t >= v.arrive;
    let x = ps.x, z = ps.z;
    if (Number.isFinite(aheadDays) && aheadDays > 0) {
      const h = Math.min(1e-4, aheadDays / 100);
      const before = drawnVehiclePosition(v, t - h, this.state.size, this.beforePos, network);
      const after = drawnVehiclePosition(v, t + h, this.state.size, this.afterPos, network);
      x += (after.x - before.x) * aheadDays / (2 * h);
      z += (after.z - before.z) * aheadDays / (2 * h);
      if (v.path.length >= 2) {
        const last = v.times.length - 1, endW = Math.min(0.12, (v.times[last] - v.times[last - 1]) / 2);
        const stopAt = v.legStart + (v.times[last] - v.m0 + endW) * EMERG_DAYS_PER_MIN;
        if (t >= stopAt - 2 * endW * EMERG_DAYS_PER_MIN) {
          const parked = drawnVehiclePosition(v, stopAt, this.state.size, this.afterPos, network);
          x = THREE.MathUtils.clamp(x, Math.min(ps.x, parked.x), Math.max(ps.x, parked.x));
          z = THREE.MathUtils.clamp(z, Math.min(ps.z, parked.z), Math.max(ps.z, parked.z));
        }
      }
    }
    return { x, y: this.surf.y(x, z), z, onScene };
  }

  /** world positions of vehicles with sirens on (for src/audio/sirens.ts) */
  sirenSources(out: { x: number; y: number; z: number; responder: string }[] = []): { x: number; y: number; z: number; responder: string }[] {
    out.length = 0;
    const feed = this.feed;
    if (!feed) return out;
    let t = 0;
    let list: readonly EmergencyVehicle[] = [];
    try {
      list = feed.vehicles();
      t = feed.time();
    } catch {
      return out;
    }
    const N = this.state.size;
    for (const v of list) {
      if (v.state !== 'outbound' && v.state !== 'transport') continue;
      const ps = vehiclePosition(v, t, N, this.pos);
      if (!ps.moving) continue;
      const wx = ps.x * CELL_SIZE, wz = ps.z * CELL_SIZE;
      out.push({ x: wx, y: this.surf.y(wx, wz), z: wz, responder: v.responder });
    }
    return out;
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
    this.batch.mesh.dispose?.();
    for (const im of [this.lights, this.glows, this.rings, this.beams]) {
      im.geometry.dispose();
      (im.material as THREE.Material).dispose();
      im.dispose();
    }
    this.tex.dispose();
  }
}
