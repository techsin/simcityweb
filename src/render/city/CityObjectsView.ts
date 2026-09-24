/**
 * CityObjectsView — everything the city puts on the terrain: roads / rails / bridges / power lines (chunked merged
 * meshes + props), buildings (one BatchedMesh), vehicles & trains, smoke / fire effects, previews, picking and the
 * underground view. Implements CityObjectsViewApi (src/render/contracts.ts).
 *
 * Usage:
 *   const view = new CityObjectsView(sim.state, sim.events, { scene, camera, renderer, canvas, getTrafficRoutes });
 *   every frame: view.update(dt) (before rendering).
 * On Simulation 'reset' the view rebuilds; pass ctx.getState (or call setState) so it picks up a replaced CityState.
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../core/constants';
import { Overlay, type Network } from '../../core/types';
import type { CellRect, Emitter } from '../../core/events';
import type { CityState } from '../../sim/CityState';
import type { CityEvents } from '../../sim/Simulation';
import type { CityObjectsViewApi, QualityLevel } from '../contracts';
import { registerAllModels } from '../../assets/builders';
import { getModelGeometry } from '../../assets/registry';
import { sharedUniforms } from '../../assets/materials';
import { NetInfo } from './common/netinfo';
import { RoadSurface } from './common/surface';
import { TileCuller } from './common/batch';
import { cityUniforms, syncCityMaterials } from './common/cityMaterial';
import { RoadRenderer } from './roads/RoadRenderer';
import { roadUniforms } from './roads/roadMaterial';
import { PropRenderer, propGeometry } from './props/PropRenderer';
import { PowerLines } from './props/PowerLines';
import { BuildingRenderer } from './buildings/BuildingRenderer';
import { Effects } from './effects/Effects';
import { Disasters } from './effects/Disasters';
import { Fireworks, collectLaunchSites, type LaunchSite } from './effects/Fireworks';
import { getDef } from '../../sim/catalog';
import { VehicleRenderer, type TrafficRoute } from './vehicles/VehicleRenderer';
import { Previews } from './previews/Previews';
import { EmergencyVehicles, type EmergencyFeed } from './vehicles/EmergencyVehicles';
import { Underground } from './underground/Underground';

export interface CityObjectsViewContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  getTrafficRoutes?: (max: number) => TrafficRoute[];
  /** WP8 emergency dispatch: vehicles, incidents and the continuous sim time (EmergencyVehicles) */
  getEmergency?: EmergencyFeed | null;
  /** returns the current CityState (used on 'reset' when the Simulation replaced its state) */
  getState?: () => CityState;
  quality?: QualityLevel;
}

export interface CityViewStats {
  roadChunks: number;
  roadDrawCalls: number;
  roadTriangles: number;
  buildings: number;
  props: number;
  lightPools: number;
  vehicles: number;
  trains: number;
  particles: number;
  pylons: number;
  /** approximate draw calls issued by this view per main pass */
  drawCalls: number;
  /** CPU ms of the last update() */
  updateMs: number;
}

function findHemisphereLight(scene: THREE.Object3D): THREE.HemisphereLight | null {
  let found: THREE.HemisphereLight | null = null;
  scene.traverse((o) => {
    if (!found && (o as THREE.HemisphereLight).isHemisphereLight) found = o as THREE.HemisphereLight;
  });
  return found;
}

function expand(r: CellRect, m: number, N: number): CellRect {
  return { x0: Math.max(0, r.x0 - m), z0: Math.max(0, r.z0 - m), x1: Math.min(N, r.x1 + m), z1: Math.min(N, r.z1 + m) };
}

export class CityObjectsView implements CityObjectsViewApi {
  readonly root = new THREE.Group();
  state: CityState;
  net: NetInfo;
  surf: RoadSurface;
  readonly culler: TileCuller;
  readonly roads: RoadRenderer;
  readonly props: PropRenderer;
  readonly power: PowerLines;
  readonly buildings: BuildingRenderer;
  readonly effects: Effects;
  readonly disasters: Disasters;
  /** New Year fireworks show (start / stop / active); driven by src/game/NewYear.ts */
  readonly fireworks: Fireworks;
  readonly vehicles: VehicleRenderer;
  readonly previews: Previews;
  readonly underground: Underground;
  /** WP8: fire trucks / police cars / ambulances on their dispatch routes + incident beacons */
  readonly emergency: EmergencyVehicles;
  private ctx: CityObjectsViewContext;
  private unsub: (() => void)[] = [];
  private powerDirty = true;
  private subwayDirty = true;
  private overlayTarget = 0;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private syncTimer = 0;
  private quality: QualityLevel;

  constructor(state: CityState, events: Emitter<CityEvents>, ctx: CityObjectsViewContext) {
    registerAllModels();
    this.ctx = ctx;
    this.state = state;
    this.quality = ctx.quality ?? 'high';
    this.root.name = 'cityObjects';
    this.net = new NetInfo(state);
    this.surf = new RoadSurface(state, this.net);
    this.culler = new TileCuller(state.size, CELL_SIZE, 16);
    this.props = new PropRenderer(this.culler);
    this.roads = new RoadRenderer(this.net, this.surf);
    this.applyStreetlightInfo();
    this.roads.onChunkProps = (i, props, pools) => this.props.setGroup('road:' + i, props, pools);
    this.power = new PowerLines(state, this.surf);
    this.effects = new Effects();
    this.effects.geometryOf = (m, v) => getModelGeometry(m, v);
    this.disasters = new Disasters(state, this.surf, this.effects);
    // the world's fill light (WorldView's night fill), found once while the scene is still small
    const fill = findHemisphereLight(ctx.scene);
    this.fireworks = new Fireworks({
      camera: ctx.camera,
      scene: ctx.scene,
      mapSize: state.size * CELL_SIZE,
      quality: this.quality,
      groundAt: (x, z) => this.surf.terrain(x, z),
      getSites: () => this.launchSites(),
      water: () => ({ data: this.state.water, size: this.state.size, cellSize: CELL_SIZE }),
      fill: () => fill,
    });
    this.buildings = new BuildingRenderer(state, this.culler);
    this.buildings.onVisual = (v, id) => {
      this.effects.onBuilding(v, id);
      if (id === this.buildings.selected) this.previews.setSelection(v);
    };
    this.vehicles = new VehicleRenderer(state, this.net, this.surf, this.culler, this.quality);
    this.vehicles.signalized = this.roads.signalized;
    this.vehicles.getRoutes = ctx.getTrafficRoutes ?? null;
    this.previews = new Previews(state, this.surf);
    this.underground = new Underground(state, this.surf);
    this.emergency = new EmergencyVehicles(state, this.surf, ctx.getEmergency ?? null);
    this.root.add(this.emergency.group);
    this.root.add(
      this.roads.group, this.props.batch.mesh, this.props.pools, this.props.glows, this.power.wires, this.buildings.batch.mesh,
      this.vehicles.batch.mesh, this.vehicles.headlights, this.effects.smoke, this.effects.flames, this.disasters.group, this.previews.group, this.underground.group,
      this.fireworks.group,
    );
    ctx.scene.add(this.root);
    this.subscribe(events);
    this.setQuality(this.quality);
    this.rebuildAll();
  }

  private applyStreetlightInfo(): void {
    const g = propGeometry('streetlight', 0);
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox!;
    const reach = Math.max(1.2, Math.min(5, -bb.min.x - 0.35));
    this.roads.setStreetlightInfo({ reach, height: bb.max.y });
  }

  private subscribe(ev: Emitter<CityEvents>): void {
    const N = () => this.state.size;
    this.unsub.push(
      ev.on('networkChanged', (r) => {
        const d = this.net.update(r);
        this.roads.markDirty(expand(d, 1, N()));
        this.vehicles.invalidate();
      }),
      ev.on('terrainChanged', (r) => {
        const d = this.net.update(expand(r, 1, N()));
        this.roads.markDirty(expand(d, 1, N()));
        this.buildings.terrainChanged(r.x0 - 1, r.z0 - 1, r.x1 + 1, r.z1 + 1);
        this.powerDirty = true;
        this.subwayDirty = true;
      }),
      ev.on('powerLinesChanged', () => { this.powerDirty = true; }),
      ev.on('subwayChanged', () => { this.subwayDirty = true; }),
      ev.on('buildingAdded', (b) => this.buildings.add(b, true)),
      ev.on('buildingRemoved', (b) => {
        this.buildings.remove(b.id);
        if (this.buildings.selected === b.id) this.setSelected(null);
      }),
      ev.on('buildingChanged', (b) => this.buildings.changed(b)),
      ev.on('disaster', (e) => this.disasters.onEvent(e)),
      ev.on('layerUpdated', (l) => { if (l === 'traffic') this.vehicles.invalidate(); }),
      ev.on('reset', () => {
        const s = this.ctx.getState?.();
        if (s && s !== this.state) this.setState(s);
        else this.rebuildAll();
      }),
    );
  }

  /** swap to another CityState (e.g. after load) and rebuild everything */
  setState(state: CityState): void {
    const sizeChanged = state.size !== this.state.size;
    this.state = state;
    if (sizeChanged) {
      console.warn('[city] city size changed; recreate CityObjectsView for best results');
    }
    this.net = new NetInfo(state);
    this.surf = new RoadSurface(state, this.net);
    // components holding references
    (this.roads as unknown as { net: NetInfo }).net = this.net;
    (this.roads as unknown as { mesher: { net: NetInfo; surf: RoadSurface } }).mesher.net = this.net;
    (this.roads as unknown as { mesher: { net: NetInfo; surf: RoadSurface } }).mesher.surf = this.surf;
    this.power.setState(state, this.surf);
    this.buildings.setState(state);
    this.vehicles.setState(state, this.net, this.surf);
    this.previews.setState(state, this.surf);
    this.underground.setState(state, this.surf);
    this.disasters.setState(state, this.surf);
    this.emergency.setState(state, this.surf);
    this.rebuildAll();
  }

  /** full synchronous rebuild of every layer */
  rebuildAll(): void {
    this.net.update();
    this.roads.markAllDirty();
    this.roads.rebuildAll();
    this.props.update();
    this.powerDirty = true;
    this.subwayDirty = true;
    this.flushPower();
    this.buildings.rebuildAll();
    this.effects.update();
    this.vehicles.clear();
    this.vehicles.refreshSpawn();
  }

  private flushPower(): void {
    if (this.powerDirty) {
      this.powerDirty = false;
      this.props.setGroup('power', this.power.rebuild());
    }
    if (this.subwayDirty) {
      this.subwayDirty = false;
      this.underground.rebuild();
    }
  }

  setQuality(q: QualityLevel): void {
    this.quality = q;
    // small props: full model within lodFull, ~16-tri proxy up to lodDistance, hidden beyond; buildings switch to their
    // massing proxy below lodPixels projected radius
    this.props.lodDistance = q === 'low' ? 700 : q === 'medium' ? 1000 : q === 'high' ? 1400 : 2000;
    this.props.lodFull = this.props.lodDistance * 0.4;
    this.buildings.lodPixels = q === 'low' ? 11 : q === 'medium' ? 10 : q === 'high' ? 9 : 7;
    this.vehicles.setQuality(q);
    this.effects.maxSmoke = q === 'low' ? 2500 : 7000;
    this.fireworks.setQuality(q);
  }

  /** fireworks launch sites: parks / plazas, landmarks, stadium, waterfront, tallest roofs, city centre */
  private launchSites(): LaunchSite[] {
    const st = this.state;
    return collectLaunchSites({
      buildings: st.buildings.values(),
      defOf: (id) => getDef(id),
      visualOf: (id) => this.buildings.getVisual(id),
      size: st.size,
      water: st.water,
      cellSize: CELL_SIZE,
      groundAt: (x, z) => this.surf.terrain(x, z),
      network: st.network,
      building: st.building,
    });
  }

  // ------------------------------------------------------------------ frame
  /** ms spent in the last update() (CPU) */
  lastUpdateMs = 0;

  update(dt: number): void {
    const now = () => performance.now();
    const tU = now();
    const P = this.prof;
    let t = tU;
    const lap = (k: keyof typeof P) => { const n = now(); P[k] += n - t; t = n; };
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    this.culler.update(cam);
    lap('cull');
    if (this.roads.hasDirty) this.roads.update(6);
    this.flushPower();
    lap('roads');
    this.props.update();
    this.props.updateLod(cam.position);
    this.props.updateNight(sharedUniforms.uNight.value);
    lap('props');
    this.buildings.update(dt);
    this.buildings.updateLod(cam, this.ctx.renderer.domElement.height);
    lap('buildings');
    this.disasters.update(dt);
    this.effects.update(dt);
    this.fireworks.update(dt);
    lap('effects');
    this.vehicles.update(dt, cam);
    this.emergency.update(dt);
    lap('vehicles');
    this.previews.update(dt);
    // overlay fade
    const o = cityUniforms.uCityOverlay;
    o.value += (this.overlayTarget - o.value) * Math.min(1, dt * 8);
    if (Math.abs(o.value - this.overlayTarget) < 0.002) o.value = this.overlayTarget;
    roadUniforms.uRoadOverlay.value = o.value * 0.6;
    this.syncTimer -= dt;
    if (this.syncTimer <= 0) { this.syncTimer = 2; syncCityMaterials(); }
    lap('misc');
    P.frames++;
    this.lastUpdateMs = now() - tU;
  }

  /** accumulated CPU ms per subsystem (reset with resetProfile) */
  readonly prof = { cull: 0, roads: 0, props: 0, buildings: 0, effects: 0, vehicles: 0, misc: 0, frames: 0 };
  resetProfile(): void {
    for (const k of Object.keys(this.prof) as (keyof typeof this.prof)[]) this.prof[k] = 0;
  }

  // ------------------------------------------------------------------ previews / tools
  setGhost(defId: string | null, x?: number, z?: number, rot?: 0 | 1 | 2 | 3, ok?: boolean): void {
    this.previews.setGhost(defId, x ?? 0, z ?? 0, rot ?? 0, ok ?? true);
  }

  setNetworkPreview(path: { x: number; z: number }[] | null, type?: Network | 'power' | 'subway', ok?: boolean): void {
    this.previews.setNetworkPreview(path, type, ok ?? true);
  }

  setUnderground(on: boolean): void {
    this.underground.setActive(on);
    if (on && this.subwayDirty) this.flushPower();
  }

  setOverlayMode(o: Overlay): void {
    this.overlayTarget = o !== Overlay.None ? 1 : 0;
  }

  setSelected(buildingId: number | null): void {
    this.buildings.setSelected(buildingId);
    this.previews.setSelection(buildingId != null ? this.buildings.getVisual(buildingId) : null);
  }

  pickBuilding(clientX: number, clientY: number): number | null {
    const rect = this.ctx.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ctx.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.ctx.camera);
    return this.pickRay(this.raycaster.ray);
  }

  /** ray -> first building whose lot box it hits before the terrain */
  pickRay(ray: THREE.Ray): number | null {
    const st = this.state;
    const N = st.size;
    const W = N * CELL_SIZE;
    const o = ray.origin, d = ray.direction;
    // clip to map box in xz
    let t0 = 0, t1 = 1e6;
    for (const [oo, dd] of [[o.x, d.x], [o.z, d.z]] as [number, number][]) {
      if (Math.abs(dd) < 1e-9) { if (oo < 0 || oo > W) return null; continue; }
      let a = (0 - oo) / dd, b = (W - oo) / dd;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    if (t0 > t1) return null;
    const hxz = Math.hypot(d.x, d.z);
    const step = hxz > 1e-4 ? (CELL_SIZE * 0.25) / hxz : 2;
    let lastCell = -1;
    const tested = new Set<number>();
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    for (let t = t0; t <= t1; t += step) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const cx = Math.floor(x / CELL_SIZE), cz = Math.floor(z / CELL_SIZE);
      if (cx < 0 || cz < 0 || cx >= N || cz >= N) continue;
      const ci = cz * N + cx;
      if (ci !== lastCell) {
        lastCell = ci;
        const bid = st.building[ci];
        if (bid >= 0 && !tested.has(bid)) {
          tested.add(bid);
          const v = this.buildings.getVisual(bid);
          const b = st.buildings.get(bid);
          if (v && b) {
            const top = Math.max(v.baseY + 3, v.baseY + (v.top - v.baseY) * Math.min(1, v.sy));
            box.min.set(b.x * CELL_SIZE, v.baseY - 1, b.z * CELL_SIZE);
            box.max.set((b.x + b.w) * CELL_SIZE, top, (b.z + b.d) * CELL_SIZE);
            if (ray.intersectBox(box, hit)) return bid;
          }
        }
      }
      if (y < this.surf.terrain(x, z) - 0.5) return null;
    }
    return null;
  }

  // ------------------------------------------------------------------ misc
  stats(): CityViewStats {
    const rd = this.roads.drawCalls;
    return {
      roadChunks: this.roads.chunkCount,
      roadDrawCalls: rd,
      roadTriangles: this.roads.triangles,
      buildings: this.buildings.count,
      props: this.props.propCount,
      lightPools: this.props.poolCount,
      vehicles: this.vehicles.n,
      trains: this.vehicles.trainCount,
      particles: this.effects.particleCount + this.fireworks.liveCount,
      pylons: this.power.pylonCount,
      drawCalls: rd + 1 + 1 + 1 + 1 + 1 + 1 + 2 + this.fireworks.drawCalls,
      updateMs: Math.round(this.lastUpdateMs * 100) / 100,
    };
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.unsub.length = 0;
    this.ctx.scene.remove(this.root);
    this.roads.dispose();
    this.props.dispose();
    this.power.dispose();
    this.buildings.dispose();
    this.effects.dispose();
    this.disasters.dispose();
    this.fireworks.dispose();
    this.vehicles.dispose();
    this.previews.dispose();
    this.underground.dispose();
    this.emergency.dispose();
  }
}
