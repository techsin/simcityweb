/**
 * WorldView — renderer, scene, camera controller, sky & day/night, post FX, terrain, water and trees.
 * Implements WorldViewApi (src/render/contracts.ts). render-city adds its objects into `scene` and shares
 * `camera` / `renderer`; they are lit by `sun` (a THREE.DirectionalLight) and the PMREM sky environment.
 *
 *   const world = new WorldView(canvas, sim.state, sim.events, { quality: 'high' });
 *   loop: world.update(dt); cityObjects.update(dt); world.render();
 */
import * as THREE from 'three';
import type { CellRect, Emitter } from '../../core/events';
import { CELL_SIZE } from '../../core/constants';
import { Overlay } from '../../core/types';
import { setFoliageSeason, sharedUniforms } from '../../assets/materials';
import { registerAllModels } from '../../assets/builders';
import { setTreeSeason } from '../../assets/builders/nat_season';
import type { CityState, Building } from '../../sim/CityState';
import type { CityEvents } from '../../sim/Simulation';
import type { CameraControllerApi, CellHit, QualityLevel, WorldViewApi } from '../contracts';
import { CameraController } from './CameraController';
import { PostFX } from './PostFX';
import { QUALITY_PRESETS, type QualitySettings } from './quality';
import { CitySun, copyReceiver, DIR_RADIUS_STEPS, dirShadowLogRadius, fitSunShadow, loadWarm, makeReceiver, receiverHolds, shadowCasters, WIDEN_MAX_FRAMES, widenReceiver, type ShadowFit, type ShadowReceiver } from './Shadows';
import { SkySystem } from './Sky';
import { TerrainRenderer } from './TerrainRenderer';
import { TreeRenderer } from './TreeRenderer';
import { WaterRenderer } from './WaterRenderer';
import { releaseSharedTextures } from './textures';
import { releaseTreeGeometries } from './fallbackTrees';

export { overlayLegend } from './overlays';
export { QUALITY_PRESETS, detectQuality, type QualitySettings } from './quality';

export interface WorldViewOptions {
  quality?: QualityLevel;
  /** initial hour (default 10.5) */
  timeOfDay?: number;
  autoTime?: boolean;
  /** the city's current state (ctx.state): a replica host swaps in a fresh one on a resync, then emits 'reset' (§2.10) */
  getState?: () => CityState;
}

export interface WorldStats {
  calls: number;
  triangles: number;
  trees: number;
  frameMs: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _ray = new THREE.Ray();
const _col = new THREE.Color();

/**
 * fraction of windows lit by hour (evening peak, late night dip). The evening peak stays below ~0.6 so skylines
 * read as dark towers with lights (sparkle), not as glowing cream pillars; 02:00 (0.28) is the sparse reference.
 */
function litFractionAt(h: number): number {
  const k = [0.4, 0.34, 0.28, 0.24, 0.24, 0.3, 0.45, 0.5, 0.45, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.45, 0.5, 0.55, 0.58, 0.58, 0.56, 0.52, 0.46];
  const i = Math.floor(h) % 24, f = h - Math.floor(h);
  return k[i] + (k[(i + 1) % 24] - k[i]) * f;
}

/** dusk / dawn grading (WorldView.updateAtmosphere, weighted by Sky.lightRig `dusk`; the dusk exposure is part of the
 *  light rig: Sky.LIGHT_RIG.duskExposure); exported for tuning tools */
export const DUSK_GRADE = {
  /** saturation / contrast added at full dusk */
  saturation: 0.12,
  contrast: 0.03,
  /** cool shadow lift (linear rgb, post tonemap) at full dusk: a hint only (cool shadows come from the sky fill; a
   *  strong lift read as a blue haze over the dusk scene) */
  lift: [0.0003, 0.001, 0.003] as [number, number, number],
};

export class WorldView implements WorldViewApi {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: CameraControllerApi;
  /** the concrete controller (extra API: setView, zoomBy, edgeScroll...) */
  readonly cameraController: CameraController;
  /** active shadow casting light: the sun by day, the moon at night */
  readonly sun: CitySun;
  readonly sky: SkySystem;
  readonly terrain: TerrainRenderer;
  readonly water: WaterRenderer;
  readonly trees: TreeRenderer;
  readonly post: PostFX;

  autoTime: boolean;
  /** game minutes per real second when autoTime is on (default 2 -> a day lasts 12 real minutes) */
  timeScale = 2;
  /**
   * Shadow-map caching: the shadow map is re-rendered only when the shadow cameras moved (camera / sun changes that
   * survive the texel snapping), when casters changed (throttled to every `shadowInterval` frames: vehicles,
   * pop-in animations) or after invalidateShadows(). false = render shadows every frame (three's default).
   * Code that moves its own shadow-casting meshes (outside DynamicBatch / TreeRenderer, which report changes
   * themselves) should bump `shadowCasters.version` (Shadows.ts) or call invalidateShadows(); as a safety net the
   * map is refreshed at least every `shadowMaxAge` frames.
   */
  shadowCache = true;
  shadowInterval = 2;
  shadowMaxAge = 20;
  /**
   * Single shadow map (low quality): while the view moves, a re-render asked for only by that motion (or by throttled
   * caster changes) waits until this many frames passed since the last one. The map keeps the light matrix it was
   * rendered with, so its shadows stay put in the world; only casters entering the view's edge, and animated ones,
   * show up a frame late. 1 = every frame. Set from the quality preset (2 for the single map).
   */
  shadowMoveInterval = 1;
  /**
   * Single map: while the view moves, caster changes (mostly the LOD swaps of buildings, props and tree chunks that
   * the motion itself causes, far from the camera) re-render the map at most every this many frames instead of every
   * shadowInterval frames: an old silhouette's shadow showing a few frames longer is invisible at those distances, and
   * the frames after the view comes to rest re-render it for the final content.
   */
  shadowMoveCasterInterval = 8;
  /** while the view moves, the shadow light direction follows the sun in this many times coarser steps (see update) */
  shadowMoveSunStep = 3;
  /**
   * Single map: its casters are culled against the view's receiver volume (the part of the view it shades), so a view
   * that turns or zooms needs the map re-rendered. While the view turns or zooms in place (its target still: orbits,
   * tilts, wheel zooms), a re-render culls against the receiver widened for the view's motion predicted over the next
   * frames instead (CitySun.dirCull, widenReceiver: steady motion extrapolated), and the map serves every frame whose
   * receiver it holds: re-rendered once the view leaves it (or the map moves: a zoom stepping its radius). The
   * prediction covers at most shadowWidenFrames frames, at most as many as widen the receiver's cross-section by
   * shadowWidenBudget (relative; the re-render draws about 0.9 x that more casters: an orbit at 90 deg/s widens it by
   * ~7.5 % per frame, so it is predicted one frame ahead (the next frame, which may not re-render, see
   * shadowMoveInterval) and re-rendered every other frame; slower turns are predicted further ahead, a zoom-in widens
   * nothing) and none past the zoom's next radius step; one frame at most for a view mostly travelling (a zoom out
   * widens every side of the receiver from near the camera on: dearer per frame than a turn) or moving unsteadily.
   * None while the map follows the view anyway (pans: it moves with the target), for moving vehicles near the camera
   * (re-rendered every frame) or at rest. 0 frames = cull against each frame's receiver.
   */
  shadowWidenFrames = 7;
  shadowWidenBudget = 0.1;
  /**
   * Cascades: while the view moves, the far cascade is redrawn at most every this many frames (1 = with every shadow
   * render). In between, shadow renders redraw the near cascade only; the far one keeps its map tile and lookup matrix
   * (CityCascadeShadow.holdFar), so its static shadows stay put and only its coverage edge, distant vehicles and
   * distant LOD swaps trail by up to interval - 1 frames. The far cascade is redrawn sooner once it no longer fits the
   * view (CityCascadeShadow.farHoldable: moved by a tenth of its size, its depth range changed by more than a split
   * step, the light turned: a fast pan or zoom redraws it sooner), when forced, and at rest (the first frame at rest
   * redraws both).
   */
  shadowFarInterval = 4;
  /** moving vehicles re-render the map every frame (no throttle) while the camera is closer than this (m): beyond it
   *  a one-frame shadow lag is under a pixel */
  dynamicShadowDistance = 600;
  /**
   * Dynamic resolution: scales the internal render resolution (not the canvas) between the preset's
   * minRenderScale and 1 to hold the preset's targetFps. Only frames bound by the GPU count against the budget: when
   * the main thread was busy for most of the frame interval (sim ticks, city edits, a slow CPU) the resolution is not
   * the bottleneck and the frame counts as on budget. Frame intervals > 250 ms (stalls, background tabs, software GL)
   * are ignored. Defaults to the quality preset; can be toggled at runtime.
   */
  dynamicResolution = false;
  /** current internal render scale (1 = full resolution) */
  renderScale = 1;

  private canvas: HTMLCanvasElement;
  private state: CityState;
  private getState: (() => CityState) | undefined;
  private events: Emitter<CityEvents>;
  private unsub: (() => void)[] = [];
  private q: QualitySettings;
  private _time = 10.5;
  private timeForce = true;
  private clock = 0;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private nightFill: THREE.HemisphereLight;
  private overlay: Overlay = Overlay.None;
  private maxHeight = 100;
  private terrainMin = 0;
  private lastFrameMs = 0;
  private _disposed = false;
  // shadow cache state
  private shKey = new Float64Array(64);
  private shRecv = -1;
  private shVersion = -1;
  private shFrame = 0;
  private frameNo = 0;
  private shForce = 2;
  private shDynamic = -1;
  private shSunVisible = false;
  /** the view camera's pose / projection and target at the previous render, and how many renders it has been unchanged */
  private shView = new Float64Array(20);
  private shTarget = new Float64Array(3);
  private viewStill = 0;
  /** the view's motion since the previous render as a rigid motion (rotation shMq, row-major, about its position, then
   *  its travel shMv), the render before's (shPmv / shPmq), and how many renders in a row measured one (2: both) */
  private shMv = new Float64Array(3);
  private shMq = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  private shPmv = new Float64Array(3);
  private shPmq = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  private shMoves = 0;
  /** shView holds the previous render's view (renders without a shadow policy pass break the chain) */
  private shViewOk = false;
  /** single map: its unrounded log2 radius (dirShadowLogRadius) this render and its change since the previous one (NaN,
   *  read as 0, until measured: a field first holding the small integer 0 changed representation at the first zoom, which
   *  discarded the optimized code of this object's methods mid-zoom) */
  private shLr = NaN;
  private shDlr = NaN;
  /** frame number of the last shadow render that redrew the far cascade */
  private shFarFrame = 0;
  private shadowDir = new THREE.Vector3(0, 1, 0);
  /** this frame's shadow fit parameters (one object reused every frame) */
  private shadowFit: ShadowFit = { target: new THREE.Vector3(), distance: 1, rangeMul: 1, lightDir: this.shadowDir, maxHeight: 0, minHeight: 0, mapSize: 0 };
  /** frames the shadow map was actually re-rendered / skipped, why the last one was, and how many frames ahead the single
   *  map's last render predicted (stats) */
  readonly shadowStats = { rendered: 0, skipped: 0, farHeld: 0, reason: '', widen: 0 };
  // dynamic resolution state
  private drsLast = 0;
  /** start (rAF time) of the frame being rendered and main-thread busy time of the previous frame (ms) */
  private drsStart = NaN;
  private drsBusy = NaN;
  private drsEma = 0;
  private drsChange = 0;
  private drsWait = 3000;
  private drsUpAt = -1e9;
  /** construction timings (ms, cumulative) for diagnostics */
  readonly initTimings: Record<string, number> = {};
  private precompiled = false;
  /** the scene's instanced leaf meshes (re-collected every EMPTY_SCAN renders) and those hidden for this render because
   *  they hold no instance (see hideEmpty) */
  private instanced: THREE.Mesh[] = [];
  private instancedAt = -1;
  private renders = 0;
  private hiddenEmpty: THREE.Mesh[] = [];
  private nHidden = 0;
  /** the load's warm-up after this view's first frame (see loadWarmUp): main-thread ms of the queued city work and of
   *  the hidden renders, and how many queued entries ran (stats) */
  readonly warmStats = { queueMs: 0, viewMs: 0, queued: 0, views: 0 };

  constructor(canvas: HTMLCanvasElement, state: CityState, events: Emitter<CityEvents>, opts: WorldViewOptions = {}) {
    registerAllModels();
    // a new load: the city's renderers queue their warm-ups in this view's first frame (Shadows.ts loadWarm)
    loadWarm.queue.length = 0;
    loadWarm.open = typeof window !== 'undefined';
    this.canvas = canvas;
    this.state = state;
    this.getState = opts.getState;
    this.events = events;
    this.q = QUALITY_PRESETS[opts.quality ?? 'high'];
    this.dynamicResolution = this.q.dynamicResolution;
    this._time = opts.timeOfDay ?? 10.5;
    this.autoTime = opts.autoTime ?? true;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0x000000, 1);

    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 50000);
    this.scene.name = 'world';
    // the scene's own transform is the identity and never changes. With matrixAutoUpdate on, its per-frame
    // updateMatrix() marks it dirty and three then recomputes the world matrix of every object below it on each render
    // (~1400, nearly all static tree / terrain / road chunks with matrixAutoUpdate off: ~0.2 ms of main-thread CPU per
    // frame); off, only objects that update their own matrix (and their subtrees) are recomputed
    this.scene.matrixAutoUpdate = false;
    this.scene.matrixWorldAutoUpdate = true;

    const W = state.size * CELL_SIZE;
    const tt = performance.now();
    const mark = (k: string) => (this.initTimings[k] = Math.round(performance.now() - tt));
    // terrain
    this.terrain = new TerrainRenderer(state, this.q.terrainDetail, this.q.terrainShadows);
    this.scene.add(this.terrain.group);
    [this.terrainMin, this.maxHeight] = this.terrain.heightRange();
    mark('terrain');
    // water
    this.water = new WaterRenderer(this.terrain.heightTexture, state.size, state.config.climate, (x, z) => this.terrain.worldHeight(x, z), this.q.waterDetail, this.terrain.lightTexture);
    this.scene.add(this.water.mesh);
    mark('water');
    // trees
    this.trees = new TreeRenderer(state, this.terrain, { lodDistance: this.q.treeLodDistance, density: this.q.treeDensity, castShadows: this.q.treeShadows, maxVariants: this.q.treeVariants, msaa: this.q.msaa > 0 });
    this.scene.add(this.trees.group);
    mark('trees');
    // sky
    this.sky = new SkySystem(this.renderer, state.config.climate, this.q.skyLut, this.q.envSize);
    this.sky.setQuality(this.q.skyLut, this.q.envSize, this.q.envRefreshMinutes);
    this.scene.add(this.sky.dome);
    // lights
    this.sun = new CitySun(0xffffff, 3);
    this.sun.castShadow = true;
    this.scene.add(this.sun, this.sun.target);
    this.nightFill = new THREE.HemisphereLight(0x4a64a8, 0x16181f, 0);
    this.scene.add(this.nightFill);
    this.applyShadowQuality();
    mark('sky+lights');
    // post
    this.post = new PostFX(this.renderer, this.q);
    this.post.fog.uSkyLut.value = this.sky.lutTexture;
    // camera
    this.cameraController = new CameraController(this.camera, canvas, {
      mapSize: W,
      heightAt: (x, z) => this.terrain.worldHeight(x, z),
    });
    this.controls = this.cameraController;
    this.cameraController.setView(W / 2, W / 2, Math.min(1400, W * 0.55), 50, 45);

    mark('post+camera');
    this.bindEvents();
    const r = canvas.getBoundingClientRect();
    this.resize(Math.max(1, r.width || canvas.clientWidth || canvas.width), Math.max(1, r.height || canvas.clientHeight || canvas.height));
  }

  // ------------------------------------------------------------------ properties
  get timeOfDay(): number {
    return this._time;
  }
  set timeOfDay(h: number) {
    this._time = ((h % 24) + 24) % 24;
    this.timeForce = true;
  }
  /** terrain heights as a half-float (N+1)^2 texture (R = meters). uv = ((wx/16 + 0.5)/(N+1), (wz/16 + 0.5)/(N+1)) */
  get heightTexture(): THREE.DataTexture {
    return this.terrain.heightTexture;
  }
  /** unit vector pointing TO the active light (sun or moon) */
  get sunDirection(): THREE.Vector3 {
    return this.sky.lighting.lightDir;
  }
  /** 0 = day .. 1 = night (same value as sharedUniforms.uNight) */
  get night(): number {
    return this.sky.lighting.night;
  }
  get quality(): QualityLevel {
    return this.q.level;
  }
  get qualitySettings(): QualitySettings {
    return this.q;
  }
  get stats(): WorldStats {
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, trees: this.trees.totalInstances, frameMs: this.lastFrameMs };
  }
  /** terrain height at a world position, exactly matching the rendered terrain triangles */
  terrainHeightAt(wx: number, wz: number): number {
    return this.terrain.worldHeight(wx, wz);
  }

  // ------------------------------------------------------------------ events
  private bindEvents() {
    const ev = this.events;
    const cells = (r: CellRect) => {
      this.terrain.markCells(r);
      this.trees.onCellsChanged(r);
      // no forced shadow refresh: the casters that change here (buildings / props batches, tree chunks, road
      // structure chunks) bump shadowCasters.version when they are actually rebuilt, which re-renders the shadow
      // map at most every shadowInterval frames (a growing city emits these events many times a second)
    };
    const bRect = (b: Building): CellRect => ({ x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d });
    this.unsub.push(
      ev.on('terrainChanged', (r) => {
        this.invalidateShadows(30);
        this.terrain.onTerrainChanged(r);
        this.trees.onCellsChanged({ x0: r.x0 - 1, z0: r.z0 - 1, x1: r.x1 + 1, z1: r.z1 + 1 });
        [this.terrainMin, this.maxHeight] = this.terrain.heightRange();
        if (r.x0 <= 1 || r.z0 <= 1 || r.x1 >= this.state.size - 1 || r.z1 >= this.state.size - 1) this.water.updateOuter((x, z) => this.terrain.worldHeight(x, z));
      }),
      ev.on('zoneChanged', cells),
      ev.on('networkChanged', cells),
      ev.on('treesChanged', cells),
      ev.on('powerLinesChanged', cells),
      ev.on('buildingAdded', (b) => cells(bRect(b))),
      ev.on('buildingRemoved', (b) => cells(bRect(b))),
      ev.on('layerUpdated', (name) => this.terrain.onLayerUpdated(name)),
      ev.on('month', () => {
        this.trees.setMonth(this.state.month);
        this.terrain.setMonth(this.state.month);
      }),
      ev.on('disaster', (d) => {
        if (d.active && d.kind === 'earthquake') this.cameraController.shake(1, 3);
      }),
      // rebuilt as a load does, from the state the host holds now; the camera stays where it is
      ev.on('reset', () => this.setState(this.getState?.() ?? this.state)),
    );
  }

  /** replace / reload the city state (after load). Same map size required; otherwise create a new WorldView. */
  setState(state: CityState) {
    this.state = state;
    this.terrain.reset(state);
    this.trees.reset(state);
    this.sky.setClimate(state.config.climate);
    this.water.updateOuter((x, z) => this.terrain.worldHeight(x, z));
    [this.terrainMin, this.maxHeight] = this.terrain.heightRange();
    this.timeForce = true;
    this.invalidateShadows(30);
  }

  /** force the shadow map to re-render for the next `frames` frames (e.g. after external scene edits) */
  invalidateShadows(frames = 1): void {
    this.shForce = Math.max(this.shForce, frames);
  }

  // ------------------------------------------------------------------ quality
  setQuality(level: QualityLevel): void {
    const q = QUALITY_PRESETS[level];
    if (!q) return;
    this.q = q;
    this.dynamicResolution = q.dynamicResolution;
    this.renderScale = 1;
    this.terrain.setQuality(q.terrainDetail, q.terrainShadows);
    this.water.setQuality(q.waterDetail);
    this.trees.setQuality({ lodDistance: q.treeLodDistance, density: q.treeDensity, castShadows: q.treeShadows, maxVariants: q.treeVariants, msaa: q.msaa > 0 });
    this.precompiled = false;
    this.sky.setQuality(q.skyLut, q.envSize, q.envRefreshMinutes);
    this.post.fog.uSkyLut.value = this.sky.lutTexture;
    this.applyShadowQuality();
    this.post.setQuality(q);
    this.resize(this.width, this.height);
    this.timeForce = true;
  }

  private applyShadowQuality() {
    const q = this.q;
    const cascaded = q.shadowCascades === 2;
    this.shadowMoveInterval = cascaded ? 1 : 2;
    const modeChanged = this.sun.cascaded !== cascaded;
    this.sun.setCascaded(cascaded);
    const sh = this.sun.shadow;
    const size = q.shadowMapSize;
    // free the map of the inactive mode (switching low <-> cascaded used to leak it) and re-create the active one
    const other = cascaded ? this.sun.dirShadow : this.sun.cascadeShadow;
    if (other.map) {
      other.map.depthTexture?.dispose();
      other.map.dispose();
      other.map = null;
    }
    const ext = sh.getFrameExtents();
    const w = size * ext.x, h = size * ext.y;
    if (sh.mapSize.x !== size || !sh.map || sh.map.width !== w || sh.map.height !== h) {
      sh.mapSize.set(size, size);
      if (sh.map) {
        sh.map.depthTexture?.dispose();
        sh.map.dispose();
      }
      // pre-created so the (unused) colour attachment is R8 instead of three's RGBA8: PCF only samples the depth
      // texture. Same depth texture setup as WebGLShadowMap.
      const rt = new THREE.WebGLRenderTarget(w, h, { format: THREE.RedFormat, type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      const dt = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
      dt.format = THREE.DepthFormat;
      dt.name = 'sun.shadowMap';
      dt.compareFunction = THREE.LessEqualCompare;
      dt.minFilter = dt.magFilter = THREE.LinearFilter;
      rt.depthTexture = dt;
      rt.texture.name = 'sun.shadowMap.color';
      sh.map = rt;
    }
    sh.radius = q.shadowRadius;
    sh.autoUpdate = true;
    this.invalidateShadows(2);
    // lit materials must recompile when the light type changes (three also detects this via the lights state hash)
    if (modeChanged) this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else m.needsUpdate = true;
    });
  }

  // ------------------------------------------------------------------ frame
  update(dt: number): void {
    if (this._disposed) return;
    const t0 = performance.now();
    dt = Math.min(Math.max(dt, 0), 0.25);
    this.clock += dt;
    if (this.autoTime) {
      this._time = (this._time + (dt * this.timeScale) / 60) % 24;
    }
    this.cameraController.update(dt);
    this.updateCameraPlanes();

    // sky & lighting
    const pop = this.state.stats.population;
    this.sky.cityLights = Math.min(1, Math.log10(pop + 10) / 6) * 0.8 + 0.2;
    const dayOfYear = this.state.day % 360;
    this.sky.update(this._time, dayOfYear, this.clock, this.camera.position, this.scene, this.timeForce);
    this.timeForce = false;
    const L = this.sky.lighting;
    this.sun.color.copy(L.lightColor);
    this.sun.intensity = L.lightIntensity;
    this.sun.visible = L.lightIntensity > 0.002;
    // hemisphere sky fill (Sky.lightRig): kept low at night so night reads as night, not a blue-tinted day, topped up
    // while the direct light is weak (sun-twilight -> moon handover ~19:10-19:35 / moonless pre-dawn) and through the
    // blue hour, so twilight is never darker than the night that follows
    this.nightFill.intensity = L.fill;
    this.nightFill.color.copy(L.fillColor);
    sharedUniforms.uNight.value = L.night;
    sharedUniforms.uLamps.value = L.lamps;
    sharedUniforms.uTime.value = this.clock;
    sharedUniforms.uLitFraction.value = litFractionAt(this._time);
    sharedUniforms.uSunDir.value.copy(L.lightDir);
    sharedUniforms.uSunColor.value.copy(L.lightColor).multiplyScalar(L.lightIntensity);
    this.terrain.setNight(L.night);
    this.water.update(this.clock, L.night);

    // shadows: the light direction used for shadows (and sun shading) only follows the sky in steps so a slowly
    // moving sun does not force a shadow-map re-render every frame: ~0.08 deg while the light is high, finer toward
    // the horizon (a shadow's length goes with 1 / tan(elevation): at dusk the same step would make long shadows jump).
    // While the view moves the steps are shadowMoveSunStep times coarser: every step re-renders the whole shadow map
    // (a far cascade cannot be held across one), and a moving view hides a shadow direction a fraction of a degree late
    const vis = this.sun.visible;
    if (vis !== this.shSunVisible) { this.shSunVisible = vis; this.invalidateShadows(1); }
    const lowSun = THREE.MathUtils.clamp(L.lightDir.y / 0.5, 0.05, 1);
    const sunStep = 0.0014 * lowSun * lowSun * (this.viewStill === 0 ? this.shadowMoveSunStep : 1);
    if (this.shadowDir.angleTo(L.lightDir) > sunStep || !this.shadowCache) this.shadowDir.copy(L.lightDir);
    const fit = this.shadowFit;
    fit.target = this.cameraController.target;
    fit.distance = this.cameraController.distance;
    fit.rangeMul = this.q.shadowRangeMul;
    fit.maxHeight = this.maxHeight;
    fit.minHeight = this.terrainMin;
    fit.mapSize = this.state.size * CELL_SIZE;
    fitSunShadow(this.sun, this.camera, fit);

    this.updateAtmosphere();
    this.terrain.update();
    // publish the season for renderers without a CityState (street / median trees in PropRenderer)
    setTreeSeason(this.state.month, this.state.config.climate);
    // lot lawns / hedges follow the climate & season (materials.ts uFoliageDry / uFoliageTint)
    setFoliageSeason(this.state.month, this.state.config.climate);
    this.trees.update(this.camera);
    this.lastFrameMs = performance.now() - t0;
  }

  private updateCameraPlanes() {
    const d = this.cameraController.distance;
    const cam = this.camera;
    const camH = Math.max(1, cam.position.y - Math.max(0, this.terrain.worldHeight(cam.position.x, cam.position.z)));
    cam.near = THREE.MathUtils.clamp(Math.min(d * 0.01, camH * 0.5), 0.5, 60);
    cam.far = d * 6 + 42000;
    cam.updateProjectionMatrix();
  }

  /** fog, haze, grading and bloom per time of day & climate */
  private updateAtmosphere() {
    const L = this.sky.lighting;
    const f = this.post.fog;
    const g = this.post.grade;
    const n = L.night;
    const h = this._time;
    const d = this.cameraController.distance;
    const climate = this.state.config.climate;
    const hazeBase = climate === 'desert' ? 1.6e-4 : climate === 'tropical' ? 1.35e-4 : climate === 'alpine' ? 0.6e-4 : 1.05e-4;
    // morning mist (5..9h), thin at noon, a bit of evening haze
    const mist = Math.max(0, 1 - Math.abs(h - 6.8) / 2.6);
    f.uFogOn.value = 1;
    f.uFogStart.value = d * THREE.MathUtils.lerp(0.65, 0.85, THREE.MathUtils.smoothstep(d, 1500, 6000));
    // (+ night haze: the flat landscape skirt fades into the sky-LUT horizon instead of a hard black band)
    f.uFogDensity.value = (0.00008 + 0.0008 * mist * mist + 0.00022 * n) * (climate === 'desert' ? 0.6 : 1);
    f.uFogFalloff.value = 1 / (60 + 90 * (1 - mist));
    f.uHaze.value = hazeBase * (1 + 0.6 * L.golden) * (1 / (1 + d / 3500));
    f.uFogMax.value = 0.96;
    f.uSunDir.value.copy(L.sunDir);
    _col.copy(L.lightColor).multiplyScalar(L.lightIntensity * 0.12 * (1 - n));
    f.uSunGlow.value.set(_col.r, _col.g, _col.b);
    f.uSkyExposure.value = this.sky.uniforms.uSkyExposure.value;
    f.uSkyFloor.value.copy(this.sky.uniforms.uSkyFloor.value);
    // cloud shadows only while the sun is the light (not the moon / twilight), fading in with sun elevation
    const su = this.sky.uniforms;
    f.uNoise.value = su.uNoise.value;
    f.uCloudCover.value = su.uCloudCover.value;
    f.uCloudTime.value = su.uCloudTime.value;
    f.uCloudShadow.value = 0.32 * (1 - n) * THREE.MathUtils.smoothstep(L.sunDir.y, 0.05, 0.3) * Math.min(1, su.uCloudCover.value * 2.2);
    // grading. Dusk / dawn (Sky.lightRig `dusk`): the eye adapts sooner than the night factor rises (exposure), the
    // colour stays alive instead of desaturating into a murky brown (a winter town of dormant grass under a low red sun
    // read as one uniform brown), and shadows get a cool blue lift against the warm low sun, lamps and windows
    const D = DUSK_GRADE;
    const dusk = L.dusk;
    // (exposure: Sky.lightRig, night + dusk adaptation)
    g.exposure = L.exposure;
    this.renderer.toneMappingExposure = L.exposure;
    const golden = L.golden;
    g.tint.setRGB(1 + 0.05 * golden - 0.07 * n, 1 - 0.01 * golden - 0.03 * n, 1 - 0.06 * golden + 0.08 * n);
    g.saturation = 1.08 + 0.06 * golden - 0.32 * n + D.saturation * dusk;
    g.contrast = 1.04 + 0.04 * n + D.contrast * dusk;
    g.lift.setRGB(0.002 * n + D.lift[0] * dusk, 0.006 * n + D.lift[1] * dusk, 0.016 * n + D.lift[2] * dusk);
    g.vignette = 0.2 + 0.1 * n;
    // bloom mainly catches signs, crowns, street lights and sun glints — lit windows should sparkle, not smear
    g.bloomStrength = THREE.MathUtils.lerp(0.035, 0.36, n);
    g.bloomThreshold = THREE.MathUtils.lerp(2.2, 1.7, n);
    const aoR = THREE.MathUtils.clamp(d * 0.022, 1.5, 22);
    this.post.setAOParams(aoR, 0.9, Math.max(1500, d * 3));
  }

  render(): void {
    if (this._disposed) return;
    this.renderer.info.reset();
    // first frame (and after a quality change): compile every object's program now, including objects that draw
    // nothing yet (batches whose lists are still empty), so they do not compile when they first appear
    if (!this.precompiled) {
      this.precompiled = true;
      this.post.compileScene(this.scene, this.camera);
    }
    this.updateDynamicResolution();
    this.updateShadowPolicy();
    this.hideEmpty();
    try {
      this.post.render(this.scene, this.camera, null);
    } finally {
      this.showEmpty();
    }
    // the load's first frame: the warm-up right after its render, still behind the loading veil (see loadWarmUp)
    if (loadWarm.open) this.loadWarmUp();
    // main-thread busy time of this frame: from the frame's start (rAF time) to the end of the render submission
    if (this.drsStart === this.drsStart) this.drsBusy = performance.now() - this.drsStart;
  }

  /**
   * Fresh-page warm-up, once, right after this view's first frame — the load's own frame: it compiles every program and
   * uploads the city, and the loading veil only starts to fade once it is done (CityScene drops the veil's class with
   * 'viewsReady', the fade begins at the next style update), so this adds no frame of its own to the frames the player
   * sees, only makes that one longer. First the work the city's renderers queued during the frame (Shadows.ts
   * loadWarm: their own per-frame code for a sweep of camera poses, each putting back what it changed), then hidden
   * renders of the view zoomed out and turned (warmView). On a fresh page the first zoom-out after a load otherwise ran
   * the per-frame code unoptimized and met objects three.js had never drawn — their buffers, vertex array setups,
   * program switches and uniform uploads — which a later, identical zoom-out does not pay.
   */
  private loadWarmUp(): void {
    loadWarm.open = false;
    const q = loadWarm.queue.splice(0, loadWarm.queue.length);
    const t0 = performance.now();
    for (const f of q) {
      try {
        f();
      } catch (e) {
        console.warn('[world] load warm-up', e);
      }
    }
    const t1 = performance.now();
    this.warmStats.queued = q.length;
    this.warmStats.queueMs = t1 - t0;
    try {
      this.warmView();
    } catch (e) {
      console.warn('[world] load warm-up render', e);
    }
    this.warmStats.viewMs = performance.now() - t1;
  }

  /**
   * The hidden part of the load's warm-up (see loadWarmUp): the scene rendered from WARM_VIEWS — poses around the view's
   * ground target from the default distance out to the far view and back in at a quarter turn, then the view itself —
   * into a 4 x 4 target of the scene pass's format (same program variants, almost no fragment work), without a shadow
   * map render (the map from the frame stays). The view camera itself is posed (its passes' cached lists in the city
   * batches end on the last pose, the view's own: the next frame keeps them) and put back exactly; renderer stats are
   * restored. Every object the zoomed-out view shows is drawn once here: three.js uploads its buffers, sets up its
   * vertex arrays and runs its program / uniform code for it, and the per-object render code runs for the far view.
   */
  private warmView(): void {
    const r = this.renderer, cam = this.camera, sm = r.shadowMap;
    if (!r.getContext || typeof r.getContext !== 'function') return;
    cam.updateMatrixWorld();
    const P0 = _wvP.copy(cam.position), Q0 = _wvQ.copy(cam.quaternion), n0 = cam.near, f0 = cam.far;
    // the view's ground target and yaw (CameraController: the camera sits at target + (-sin yaw, ., cos yaw) x distance)
    const tg = this.cameraController.target, e = cam.matrixWorld.elements;
    const fx = -e[8], fz = -e[10], yaw0 = Math.hypot(fx, fz) > 1e-6 ? Math.atan2(fx, -fz) : 0;
    const info = r.info.render, calls = info.calls, tris = info.triangles, pts = info.points, lines = info.lines;
    const au = sm.autoUpdate, nu = sm.needsUpdate;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, generateMipmaps: false });
    const prev = r.getRenderTarget();
    sm.autoUpdate = false;
    sm.needsUpdate = false;
    let n = 0;
    this.hideEmpty();
    try {
      r.setRenderTarget(rt);
      for (let k = 0; k <= WARM_VIEWS.length; k += 3) {
        if (k < WARM_VIEWS.length) {
          const d = WARM_VIEWS[k], tilt = (WARM_VIEWS[k + 1] * Math.PI) / 180, yaw = yaw0 + (WARM_VIEWS[k + 2] * Math.PI) / 180;
          const ch = Math.cos(tilt), y = tg.y + Math.sin(tilt) * d;
          cam.position.set(tg.x - Math.sin(yaw) * ch * d, y, tg.z + Math.cos(yaw) * ch * d);
          cam.lookAt(tg.x, tg.y, tg.z);
          // (near / far as updateCameraPlanes sets them for that distance)
          cam.near = THREE.MathUtils.clamp(Math.min(d * 0.01, Math.max(1, y - Math.max(0, this.terrain.worldHeight(cam.position.x, cam.position.z))) * 0.5), 0.5, 60);
          cam.far = d * 6 + 42000;
        } else {
          // the view itself last: the batches' cached view lists end on it (the next frame reuses them)
          cam.position.copy(P0);
          cam.quaternion.copy(Q0);
          cam.near = n0;
          cam.far = f0;
        }
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        r.render(this.scene, cam);
        n++;
      }
    } finally {
      this.showEmpty();
      r.setRenderTarget(prev);
      rt.dispose();
      cam.position.copy(P0);
      cam.quaternion.copy(Q0);
      cam.near = n0;
      cam.far = f0;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      sm.autoUpdate = au;
      sm.needsUpdate = nu;
      info.calls = calls;
      info.triangles = tris;
      info.points = pts;
      info.lines = lines;
    }
    this.warmStats.views = n;
  }

  /**
   * Instanced meshes that hold no instance this frame (count / instanceCount 0: idle effect layers such as the emergency
   * beacons, empty LOD or decal layers) are hidden for the frame's render passes and shown again right after it: three.js
   * otherwise projects, sets up and issues an empty draw for each of them in every pass (a transparent DoubleSide one
   * twice, switching its side and re-resolving its program each time). Their owners' `visible` is only touched inside
   * render(). The candidates (leaf meshes) are re-collected every EMPTY_SCAN renders: one added in between is drawn as
   * before until then.
   */
  private hideEmpty(): void {
    // (index-filled arrays, never truncated below their high-water size: no per-frame allocation)
    if (this.renders++ - this.instancedAt >= EMPTY_SCAN || this.instancedAt < 0) {
      this.instancedAt = this.renders;
      const out = this.instanced, stack = _scan;
      let k = 0, sp = 0;
      stack[sp++] = this.scene;
      while (sp > 0) {
        const o = stack[--sp];
        const ch = o.children;
        for (let i = 0; i < ch.length; i++) stack[sp++] = ch[i];
        if (ch.length > 0) continue;
        const m = o as THREE.Mesh;
        if ((m as THREE.InstancedMesh).isInstancedMesh === true || (m.isMesh === true && (m.geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry === true)) out[k++] = m;
      }
      if (out.length !== k) out.length = k;
    }
    const list = this.instanced, hidden = this.hiddenEmpty;
    let h = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m.visible) continue;
      const n = (m as THREE.InstancedMesh).isInstancedMesh === true ? (m as THREE.InstancedMesh).count : (m.geometry as THREE.InstancedBufferGeometry).instanceCount;
      if (n === 0) {
        m.visible = false;
        hidden[h++] = m;
      }
    }
    this.nHidden = h;
  }

  /** undo hideEmpty after the frame's render */
  private showEmpty(): void {
    const hidden = this.hiddenEmpty;
    for (let i = 0, n = this.nHidden; i < n; i++) hidden[i].visible = true;
    this.nHidden = 0;
  }

  /** start time of the current animation frame (document timeline = the rAF timestamp), else NaN */
  private frameStart(): number {
    const tl = typeof document !== 'undefined' ? (document as Document & { timeline?: { currentTime: unknown } }).timeline : undefined;
    const t = tl ? Number(tl.currentTime) : NaN;
    return Number.isFinite(t) ? t : NaN;
  }

  /** decide whether this frame re-renders the shadow map (see shadowCache) */
  private updateShadowPolicy(): void {
    const sm = this.renderer.shadowMap;
    const sun = this.sun;
    if (!this.shadowCache) {
      sm.autoUpdate = true;
      // (every render culls the single map's casters against that frame's receiver)
      if (!sun.cascaded) copyReceiver(sun.dirCull, sun.dirReceiver);
      this.shViewOk = false;
      return;
    }
    sm.autoUpdate = false;
    this.frameNo++;
    if (!sun.visible || !sun.castShadow || !sm.enabled) {
      sm.needsUpdate = false;
      this.shViewOk = false;
      return;
    }
    // fit the shadow cameras now (three repeats this identically when it renders the map) and compare
    this.camera.updateMatrixWorld();
    {
      // view motion since the previous render (a damped camera settling by float ulps counts as still), also as a rigid
      // motion for the single map's prediction (see shadowWidenFrames)
      const e = this.camera.matrixWorld.elements, pe = this.camera.projectionMatrix.elements, v = this.shView;
      if (this.shViewOk) {
        this.shPmv.set(this.shMv);
        this.shPmq.set(this.shMq);
        viewMotion(v, e, this.shMv, this.shMq);
        this.shMoves++;
      } else this.shMoves = 0;
      let still = true;
      for (let i = 0; i < 20; i++) {
        const x = i < 16 ? e[i] : pe[i === 16 ? 0 : i === 17 ? 5 : i === 18 ? 8 : 9];
        if (Math.abs(v[i] - x) > 1e-6 * Math.max(1, Math.abs(x))) still = false;
        v[i] = x;
      }
      this.viewStill = still ? this.viewStill + 1 : 0;
      this.shViewOk = true;
    }
    // (the view target: a pan moves it, a turn / zoom in place does not)
    const tg = this.shadowFit.target, tv = this.shTarget;
    const tMoved = Math.abs(tg.x - tv[0]) > 1e-6 * Math.max(1, Math.abs(tg.x)) || Math.abs(tg.y - tv[1]) > 1e-6 * Math.max(1, Math.abs(tg.y)) || Math.abs(tg.z - tv[2]) > 1e-6 * Math.max(1, Math.abs(tg.z));
    tv[0] = tg.x; tv[1] = tg.y; tv[2] = tg.z;
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    const sh = sun.shadow;
    // (the single map's lookup matrix as rendered: restored when its re-render waits a frame)
    if (!sun.cascaded) _shM.copy(sh.matrix);
    // cascades: hold the far one this frame? (see shadowFarInterval; set before the fit, which applies it)
    const cs = sun.cascaded ? sun.cascadeShadow : null;
    if (cs) cs.holdFar = this.shadowFarInterval > 1 && this.shForce === 0 && this.viewStill === 0 && !!sh.map && this.frameNo - this.shFarFrame < this.shadowFarInterval;
    (sh as unknown as { updateMatrices(l: THREE.Light, c: THREE.Camera): void }).updateMatrices(sun, this.camera);
    if (cs && cs.holdFar && !cs.farHoldable) {
      // (the far cascade's depth range stepped further, the light turned or the view jumped: redraw it now)
      cs.holdFar = false;
      (sh as unknown as { updateMatrices(l: THREE.Light, c: THREE.Camera): void }).updateMatrices(sun, this.camera);
    }
    const cams: THREE.Camera[] | null = sun.cascaded ? ((sun.cascadeShadow as any)._cameras as THREE.Camera[]) : null;
    const nc = cams ? cams.length : 1;
    if (!cams) {
      // (single map: how fast a zoom moves its radius toward the next step, which moves the map)
      const lr = dirShadowLogRadius(this.shadowFit), d = lr - this.shLr;
      this.shDlr = d === d ? d : 0;
      this.shLr = lr;
    }
    const key = this.shKey;
    let o = 0, moved = false;
    for (let c = 0; c < nc && !moved; c++) {
      const cam = cams ? cams[c] : sh.camera;
      for (let k = 0; k < 2 && !moved; k++) {
        const m = k === 0 ? cam.matrixWorld.elements : cam.projectionMatrix.elements;
        for (let i = 0; i < 16; i++, o++) {
          // tolerance: the damped camera jitters by float ulps even when still
          if (Math.abs(key[o] - m[i]) > 1e-6 * Math.max(1, Math.abs(m[i]))) { moved = true; break; }
        }
      }
    }
    // casters are culled against the visible slice (receiver), which also changes when the view only rotates / zooms
    // while the shadow cameras stay put: cascades re-render when their receivers change, the single map once this
    // frame's receiver left the volume its last render was culled against (widened for the motion predicted then)
    const recvs: ShadowReceiver[] | null = sun.cascaded ? sun.cascadeShadow.receivers : null;
    let rv = 0, left = false;
    if (recvs) {
      for (let i = 0; i < recvs.length; i++) rv += recvs[i].version;
      if (rv !== this.shRecv) moved = true;
    } else if (!moved && !receiverHolds(sun.dirCull, sun.dirReceiver)) moved = left = true;
    let need = moved || this.shForce > 0 || !sh.map || this.frameNo - this.shFrame >= this.shadowMaxAge;
    // single map: a cut — since its last render the map moved by more than half its radius or its radius changed by more
    // than 1.5x (a camera cut: minimap / "show me" jumps, far <-> street) — is re-rendered at once: the old map no longer
    // covers the view (a far -> street cut right after a render showed the far map's coarse, partly missing shadows for a
    // frame). Smooth motion moves it by a small fraction of its radius per frame and its radius one step (2^1/6) at a time.
    let cut = false;
    if (!cams && moved) {
      const m = sh.camera.matrixWorld.elements, P = sh.camera.projectionMatrix.elements;
      const dx = m[12] - key[12], dy = m[13] - key[13], dz = m[14] - key[14];
      const r0 = 1 / Math.abs(key[16]), r1 = 1 / Math.abs(P[0]);
      cut = !(Math.sqrt(dx * dx + dy * dy + dz * dz) <= 0.5 * Math.min(r0, r1) && r1 <= 1.5 * r0 && r0 <= 1.5 * r1);
    }
    // moving vehicles near the camera: every frame (their shadows would trail them by a frame)
    const dyn = shadowCasters.dynamic !== this.shDynamic && this.cameraController.distance < this.dynamicShadowDistance;
    const ci = !sun.cascaded && this.viewStill === 0 ? Math.max(this.shadowInterval, this.shadowMoveCasterInterval) : this.shadowInterval;
    if (!need && (dyn || (shadowCasters.version !== this.shVersion && this.frameNo - this.shFrame >= ci))) need = true;
    // single map: a re-render asked for by the view's motion / throttled caster changes may wait (shadowMoveInterval);
    // the map keeps its own lookup matrix meanwhile. The comparison state above stays at the rendered map, so the frame
    // after the view comes to rest renders it for the final view. (Never a cut, see above.)
    if (need && !cut && !sun.cascaded && this.shForce === 0 && sh.map && !dyn && this.frameNo - this.shFrame < this.shadowMoveInterval) {
      sh.matrix.copy(_shM);
      need = false;
    }
    const hold = cs !== null && need && cs.farHeld;
    if (cs && sh.map) {
      // a render holding the far cascade is scissored to the near cascade's atlas tile: its clear keeps the far tile
      if (hold) sh.map.scissor.set(0, 0, sh.mapSize.x, sh.mapSize.y);
      sh.map.scissorTest = hold;
    }
    if (need) {
      // the state the map is rendered for (a held far cascade keeps its old state: the view at rest redraws it)
      o = 0;
      for (let c = 0; c < nc; c++) {
        const cam = cams ? cams[c] : sh.camera;
        if (hold && c === nc - 1) { o += 32; continue; }
        for (let k = 0; k < 2; k++) {
          const m = k === 0 ? cam.matrixWorld.elements : cam.projectionMatrix.elements;
          for (let i = 0; i < 16; i++, o++) key[o] = m[i];
        }
      }
      if (cs && !hold) this.shFarFrame = this.frameNo;
      if (hold) this.shadowStats.farHeld++;
      this.shRecv = rv;
      if (!sun.cascaded) {
        this.fitDirCull(dyn || tMoved);
        if (!sun.dirReceiverCull) sun.dirReceiverCull = true;
      }
      this.shadowStats.reason = cut ? 'cut' : left ? 'view' : moved ? 'moved' : this.shForce > 0 ? 'forced' : !sh.map ? 'nomap' : dyn ? 'vehicles' : shadowCasters.version !== this.shVersion ? 'casters' : 'age';
      this.shVersion = shadowCasters.version;
      this.shDynamic = shadowCasters.dynamic;
      this.shFrame = this.frameNo;
      if (this.shForce > 0) this.shForce--;
      this.shadowStats.rendered++;
    } else this.shadowStats.skipped++;
    sm.needsUpdate = need;
  }

  /**
   * Single map, at a re-render: the volume its casters are culled against (CitySun.dirCull) — this frame's receiver,
   * widened for the view's steady motion over the next frames (see shadowWidenFrames); `follow`: the map follows the
   * view anyway (target moved, vehicles near the camera re-render it every frame) -> no prediction.
   */
  private fitDirCull(follow: boolean): void {
    const sun = this.sun, rec = sun.dirReceiver, out = sun.dirCull, v = this.shMv, q = this.shMq;
    let k = 0;
    if (!follow && this.shMoves >= 2 && this.viewStill === 0 && this.shadowWidenFrames > 0 && this.shadowWidenBudget > 0) {
      const step = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]), turn = rotAngle(q);
      if (step > 1e-3 || turn > 2e-6) {
        // (the prediction's error: a quarter more where the motion widens it, and a millimetre per metre of view range)
        const pad = 1e-3 * rec.reach, depth = this.cameraController.distance;
        const g1 = widenReceiver(out, rec, v, q, 1, WIDEN_ERR, pad, depth, WIDEN_TURN);
        if (g1 >= 0) {
          k = Math.min(this.shadowWidenFrames, g1 > 1e-9 ? Math.floor(this.shadowWidenBudget / g1) : WIDEN_MAX_FRAMES);
          // (a zoom moves the map when its radius steps: no prediction past that frame, it re-renders the map anyway)
          const dl = this.shDlr;
          if (k > 1 && Math.abs(dl) > 1e-9) {
            const st = Math.ceil(this.shLr * DIR_RADIUS_STEPS - 1e-9) / DIR_RADIUS_STEPS;
            const f = dl > 0 ? (st - this.shLr) / dl : (this.shLr - st + 1 / DIR_RADIUS_STEPS) / -dl;
            k = Math.max(1, Math.min(k, Math.ceil(f) - 1));
          }
          // (a start, a stop or an erratic camera: only the next frame; nor more for a view mostly travelling, such as a
          // zoom out: its receiver grows on every side, from near the camera on, where a turn's grows mostly far out)
          if (k > 1 && !steadyMotion(v, q, this.shPmv, this.shPmq, 1e-3 * rec.reach)) k = 1;
          if (k > 1 && widenReceiver(_wTurn, rec, _v0, q, 1, WIDEN_ERR, pad, depth, WIDEN_TURN) < 0.5 * g1) k = 1;
          if (k > 1 && widenReceiver(out, rec, v, q, k, WIDEN_ERR, pad, depth, WIDEN_TURN) < 0) k = 1;
        }
      }
    }
    // (k 1: out holds the one-frame prediction)
    if (k === 0) copyReceiver(out, rec);
    this.shadowStats.widen = k;
  }

  /** adapt renderScale to the frame interval (see dynamicResolution) */
  private updateDynamicResolution(): void {
    // frame interval between animation-frame starts (falls back to render-to-render); the previous frame's busy time
    const start = this.frameStart();
    const now = start === start ? start : performance.now();
    const dt = now - this.drsLast;
    this.drsLast = now;
    const busy = this.drsBusy;
    this.drsStart = start;
    this.drsBusy = NaN;
    if (!this.dynamicResolution) {
      if (this.renderScale !== 1) { this.renderScale = 1; this.applyRenderSize(); }
      return;
    }
    if (dt <= 0 || dt > 250) return;
    const budget = 1000 / this.q.targetFps;
    // a frame whose main thread was busy for most of the interval is CPU bound (sim ticks, GC, city edits): a lower
    // resolution would not make it faster, so it counts as on budget; one-off GPU spikes are clamped so only
    // sustained slow frames lower the resolution
    const cpuBound = busy === busy && busy > dt * 0.75;
    const sample = cpuBound ? Math.min(dt, budget) : Math.min(dt, budget * 2);
    this.drsEma = this.drsEma > 0 ? this.drsEma * 0.92 + sample * 0.08 : sample;
    const min = this.q.minRenderScale;
    if (this.drsEma > budget * 1.2 && now - this.drsChange > 600 && this.renderScale > min + 1e-3) {
      // too slow: step down; a step down right after a probe up doubles the wait before the next probe
      if (now - this.drsUpAt < 2500) this.drsWait = Math.min(30000, this.drsWait * 2);
      this.renderScale = Math.max(min, Math.round((this.renderScale - 0.1) * 20) / 20);
      this.drsChange = now;
      this.drsEma = budget;
      this.applyRenderSize();
    } else if (this.drsEma < budget * 1.05 && this.renderScale < 1 && now - this.drsChange > this.drsWait) {
      this.renderScale = Math.min(1, Math.round((this.renderScale + 0.1) * 20) / 20);
      this.drsChange = this.drsUpAt = now;
      this.applyRenderSize();
    } else if (now - this.drsChange > 20000) this.drsWait = 3000;
  }

  private applyRenderSize(): void {
    const s = this.renderScale;
    const w = Math.max(1, Math.round(this.width * this.pixelRatio * s)), h = Math.max(1, Math.round(this.height * this.pixelRatio * s));
    this.post.setSize(w, h);
    this.trees.setRenderSize(w, h);
  }

  resize(width: number, height: number): void {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    this.width = width;
    this.height = height;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.pixelRatio = Math.min(dpr, this.q.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, true);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.trees.viewHeight = height * this.pixelRatio;
    this.trees.viewFov = this.camera.fov;
    this.applyRenderSize();
  }

  // ------------------------------------------------------------------ overlays & tools
  setOverlay(o: Overlay): void {
    this.overlay = o;
    this.terrain.setOverlay(o);
  }
  get currentOverlay(): Overlay {
    return this.overlay;
  }
  setGridVisible(v: boolean): void {
    this.terrain.setGrid(v);
  }
  setHighlight(cells: { x: number; z: number; ok: boolean }[] | null): void {
    this.terrain.setHighlight(cells);
  }
  setHighlightRect(rect: CellRect | null, color: number): void {
    this.terrain.setHighlightRect(rect, color);
  }
  setBrush(center: { x: number; z: number } | null, radiusCells: number): void {
    this.terrain.setBrush(center, radiusCells);
  }
  /** camera shake (earthquakes are handled automatically from the 'disaster' event) */
  shake(intensity = 1, seconds = 2.5): void {
    this.cameraController.shake(intensity, seconds);
  }

  // ------------------------------------------------------------------ picking
  /** screen (client) position -> terrain cell. Heightfield ray march + bisection against the rendered surface. */
  pickCell(clientX: number, clientY: number): CellHit | null {
    const r = this.canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    _ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    _ray.origin.setFromMatrixPosition(this.camera.matrixWorld);
    _ray.direction.set(_ndc.x, _ndc.y, 0.5).unproject(this.camera).sub(_ray.origin).normalize();
    const hit = this.raycastTerrain(_ray, _v);
    if (!hit) return null;
    const N = this.state.size;
    const x = Math.floor(_v.x / CELL_SIZE), z = Math.floor(_v.z / CELL_SIZE);
    if (x < 0 || z < 0 || x >= N || z >= N) return null;
    return { x, z, point: _v.clone() };
  }

  /** ray vs. terrain (inside the map). Writes the hit into out. */
  raycastTerrain(ray: THREE.Ray, out: THREE.Vector3): boolean {
    const W = this.state.size * CELL_SIZE;
    const [minH, maxH] = this.terrain.heightRange();
    // clip the ray to the map's bounding box
    const box = _bbox.set(_v2.set(0, minH - 1, 0), _bboxMax.set(W, maxH + 1, W));
    let t0 = 0, t1 = 0;
    if (box.containsPoint(ray.origin)) t0 = 0;
    else {
      if (!ray.intersectBox(box, out)) return false;
      t0 = out.distanceTo(ray.origin);
    }
    // exit distance
    _rayInv.origin.copy(ray.at(t0 + 1e5, _v2));
    _rayInv.direction.copy(ray.direction).negate();
    if (!_rayInv.intersectBox(box, out)) return false;
    t1 = t0 + 1e5 - out.distanceTo(_rayInv.origin);
    const step = CELL_SIZE * 0.35;
    let prev = t0;
    for (let t = t0; t <= t1 + step; t += step) {
      const tt = Math.min(t, t1);
      ray.at(tt, out);
      if (out.y <= this.terrain.meshHeightAt(out.x, out.z)) {
        let a = prev, b = tt;
        for (let i = 0; i < 20; i++) {
          const m = (a + b) * 0.5;
          ray.at(m, out);
          if (out.y <= this.terrain.meshHeightAt(out.x, out.z)) b = m;
          else a = m;
        }
        ray.at(b, out);
        out.y = this.terrain.meshHeightAt(out.x, out.z);
        return true;
      }
      prev = tt;
      if (tt >= t1) break;
    }
    return false;
  }

  // ------------------------------------------------------------------ capture
  /**
   * Render a frame into a data URL. topDown: orthographic view of the whole city (north up) as a JPEG, for region
   * thumbnails; otherwise the current view as PNG.
   */
  capture(width = 512, height = 512, topDown = false): string {
    width = Math.max(16, Math.floor(width));
    height = Math.max(16, Math.floor(height));
    this.trees.flush();
    this.terrain.update();
    const [pw, ph] = this.post.size;
    const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, depthBuffer: false });
    let cam: THREE.Camera = this.camera;
    const W = this.state.size * CELL_SIZE;
    let ortho: THREE.OrthographicCamera | null = null;
    const saveSplits = this.sun.cascadeShadow.splits.slice();
    if (topDown) {
      const aspect = width / height;
      const half = W / 2;
      const hx = aspect >= 1 ? half * aspect : half, hz = aspect >= 1 ? half : half / aspect;
      ortho = new THREE.OrthographicCamera(-hx, hx, hz, -hz, 1, this.maxHeight + 4000);
      ortho.position.set(W / 2, this.maxHeight + 2000, W / 2);
      ortho.up.set(0, 0, -1);
      ortho.lookAt(W / 2, 0, W / 2);
      ortho.updateMatrixWorld();
      ortho.updateProjectionMatrix();
      cam = ortho;
      this.sun.cascadeShadow.splits[0] = 1;
      this.sun.cascadeShadow.splits[1] = this.maxHeight + 2000;
      this.sun.cascadeShadow.splits[2] = this.maxHeight + 3000;
      if (!this.sun.cascaded) fitSunShadow(this.sun, this.camera, { target: _v.set(W / 2, 0, W / 2), distance: W, rangeMul: 1.2, lightDir: this.sky.lighting.lightDir, maxHeight: this.maxHeight });
    } else {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    // (single map: no caster culling against the game view's receiver volume, which need not hold this view: the whole
    // map from above, or another aspect)
    const recvCull = this.sun.dirReceiverCull;
    this.sun.dirReceiverCull = false;
    this.post.setSize(width, height);
    this.renderer.info.reset();
    this.renderer.shadowMap.needsUpdate = true;
    // (a full shadow render for this view: no held far cascade, no scissor left from the last frame's render)
    this.sun.cascadeShadow.holdFar = false;
    if (this.sun.shadow.map) this.sun.shadow.map.scissorTest = false;
    this.post.render(this.scene, cam, rt);
    this.invalidateShadows(1);
    const px = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, width, height, px);
    rt.dispose();
    // restore
    this.post.setSize(pw, ph);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    for (let i = 0; i < 3; i++) this.sun.cascadeShadow.splits[i] = saveSplits[i];
    this.sun.dirReceiverCull = recvCull;
    // to canvas (flip Y)
    const c2 = document.createElement('canvas');
    c2.width = width;
    c2.height = height;
    const ctx = c2.getContext('2d')!;
    const img = ctx.createImageData(width, height);
    const row = width * 4;
    for (let y = 0; y < height; y++) img.data.set(px.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    return topDown ? c2.toDataURL('image/jpeg', 0.9) : c2.toDataURL('image/png');
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    // (a load left before its first frame: its queued warm-ups go with it)
    if (loadWarm.open) {
      loadWarm.open = false;
      loadWarm.queue.length = 0;
    }
    // three's DFG LUT (r186: one module-level texture for every renderer, bound to the physical materials' programs):
    // read from a material's program uniforms before the disposes below release them, disposed at the end
    const lut = (this.renderer.properties.get(this.terrain.material) as { uniforms?: { dfgLUT?: { value?: THREE.Texture | null } } } | undefined)?.uniforms?.dfgLUT?.value;
    for (const u of this.unsub) u();
    this.unsub = [];
    this.cameraController.dispose();
    this.terrain.dispose();
    this.water.dispose();
    this.trees.dispose();
    this.sky.dispose();
    this.post.dispose();
    for (const sh of [this.sun.dirShadow, this.sun.cascadeShadow]) {
      sh.map?.depthTexture?.dispose();
      sh.map?.dispose();
    }
    // module-level objects outlive this view and kept it — with its renderer, canvas and city — reachable after an
    // exit to the region: hideEmpty's scan stack still held this scene's meshes (a TreeMesh -> the CityState), and every
    // shared texture / tree geometry / the DFG LUT this renderer used holds its dispose listener. Clear the stack and
    // dispose those (each renderer drops its GPU copy and its listener; they stay cached and upload again on next use)
    _scan.length = 0;
    releaseSharedTextures();
    releaseTreeGeometries();
    lut?.dispose();
    this.renderer.dispose();
    // (close-out c1) and its GL context goes at once, as RegionView / MenuBackground do: whatever might still reach the
    // disposed renderer holds no drawing buffer or GPU memory until it is collected
    this.renderer.forceContextLoss();
  }
}

const _bbox = new THREE.Box3();
const _bboxMax = new THREE.Vector3();
const _rayInv = new THREE.Ray();
/** the single shadow map's lookup matrix before this frame's fit (updateShadowPolicy) */
const _shM = new THREE.Matrix4();
/** single map: the most a predicted motion may turn a side of the receiver, and the prediction's relative error
 *  (widenReceiver) */
const WIDEN_TURN = (10 * Math.PI) / 180;
const WIDEN_ERR = 0.25;
/** no travel, and the receiver the turn alone would widen to (fitDirCull) */
const _v0 = new Float64Array(3);
const _wTurn = makeReceiver();

/**
 * Rigid motion of a camera from its previous world matrix `p` (elements 0-15) to `e`: rotation q (row-major 3x3, world
 * axes: the previous orientation onto the current) about the previous position, then the travel v of the position.
 */
function viewMotion(p: ArrayLike<number>, e: ArrayLike<number>, v: Float64Array, q: Float64Array): void {
  v[0] = e[12] - p[12]; v[1] = e[13] - p[13]; v[2] = e[14] - p[14];
  // q = B A^T over the unit axes (columns of the matrices)
  for (let i = 0; i < 9; i++) q[i] = 0;
  for (let c = 0; c < 3; c++) {
    const o = c * 4;
    const la = Math.sqrt(p[o] * p[o] + p[o + 1] * p[o + 1] + p[o + 2] * p[o + 2]) || 1, lb = Math.sqrt(e[o] * e[o] + e[o + 1] * e[o + 1] + e[o + 2] * e[o + 2]) || 1;
    for (let i = 0; i < 3; i++) {
      const b = e[o + i] / lb;
      for (let j = 0; j < 3; j++) q[i * 3 + j] += b * (p[o + j] / la);
    }
  }
}

/** rotation angle (rad) of a row-major rotation matrix */
function rotAngle(q: Float64Array): number {
  const c = (q[0] + q[4] + q[8] - 1) / 2;
  return c >= 1 ? 0 : c <= -1 ? Math.PI : Math.acos(c);
}

/** did the per-frame motion (v, q) keep its pace since the previous frame's (pv, pq)? (as DynamicBatch's bands) */
function steadyMotion(v: Float64Array, q: Float64Array, pv: Float64Array, pq: Float64Array, eps: number): boolean {
  const dx = v[0] - pv[0], dy = v[1] - pv[1], dz = v[2] - pv[2];
  const l2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  if (dx * dx + dy * dy + dz * dz > 0.09 * l2 + eps * eps) return false;
  // rotation between the two per-frame rotations (q pq^T) against the rotation itself
  let t = 0;
  for (let i = 0; i < 9; i++) t += q[i] * pq[i];
  const a = Math.acos(Math.max(-1, Math.min(1, (t - 1) / 2)));
  return a <= 0.3 * rotAngle(q) + 1e-5;
}
/** the load's hidden warm-up renders (WorldView.warmView): [distance m, tilt deg, yaw deg from the view's] per pose —
 *  out to the far view, a quarter turn there, back in to the default distance (then the view itself) */
const WARM_VIEWS = [1500, 60, 0, 4000, 85, 0, 4000, 85, 90, 800, 50, 90];
const _wvP = new THREE.Vector3();
const _wvQ = new THREE.Quaternion();
/** renders between re-collections of the scene's instanced meshes (WorldView.hideEmpty), and the walk's stack */
const EMPTY_SCAN = 30;
const _scan: THREE.Object3D[] = [];
