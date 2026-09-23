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
import { sharedUniforms } from '../../assets/materials';
import { registerAllModels } from '../../assets/builders';
import type { CityState, Building } from '../../sim/CityState';
import type { CityEvents } from '../../sim/Simulation';
import type { CameraControllerApi, CellHit, QualityLevel, WorldViewApi } from '../contracts';
import { CameraController } from './CameraController';
import { PostFX } from './PostFX';
import { QUALITY_PRESETS, type QualitySettings } from './quality';
import { CitySun, fitSunShadow, shadowCasters } from './Shadows';
import { SkySystem } from './Sky';
import { TerrainRenderer } from './TerrainRenderer';
import { TreeRenderer } from './TreeRenderer';
import { WaterRenderer } from './WaterRenderer';

export { overlayLegend } from './overlays';
export { QUALITY_PRESETS, detectQuality, type QualitySettings } from './quality';

export interface WorldViewOptions {
  quality?: QualityLevel;
  /** initial hour (default 10.5) */
  timeOfDay?: number;
  autoTime?: boolean;
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

/** fraction of windows lit by hour (evening peak, late night dip) */
function litFractionAt(h: number): number {
  const k = [0.5, 0.36, 0.28, 0.24, 0.24, 0.3, 0.45, 0.5, 0.45, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.45, 0.55, 0.66, 0.72, 0.72, 0.7, 0.64, 0.57];
  const i = Math.floor(h) % 24, f = h - Math.floor(h);
  return k[i] + (k[(i + 1) % 24] - k[i]) * f;
}

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
   * Dynamic resolution: scales the internal render resolution (not the canvas) between the preset's
   * minRenderScale and 1 to hold the preset's targetFps. Frame intervals > 250 ms (stalls, background tabs,
   * software GL) are ignored. Defaults to the quality preset; can be toggled at runtime.
   */
  dynamicResolution = false;
  /** current internal render scale (1 = full resolution) */
  renderScale = 1;

  private canvas: HTMLCanvasElement;
  private state: CityState;
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
  private shVersion = -1;
  private shFrame = 0;
  private frameNo = 0;
  private shForce = 2;
  private shSunVisible = false;
  private shadowDir = new THREE.Vector3(0, 1, 0);
  /** frames the shadow map was actually re-rendered / skipped (stats) */
  readonly shadowStats = { rendered: 0, skipped: 0, reason: '' };
  // dynamic resolution state
  private drsLast = 0;
  private drsEma = 0;
  private drsChange = 0;
  private drsWait = 3000;
  private drsUpAt = -1e9;
  /** construction timings (ms, cumulative) for diagnostics */
  readonly initTimings: Record<string, number> = {};

  constructor(canvas: HTMLCanvasElement, state: CityState, events: Emitter<CityEvents>, opts: WorldViewOptions = {}) {
    registerAllModels();
    this.canvas = canvas;
    this.state = state;
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
    this.trees = new TreeRenderer(state, this.terrain, { lodDistance: this.q.treeLodDistance, density: this.q.treeDensity, castShadows: this.q.treeShadows, maxVariants: this.q.treeVariants });
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
      ev.on('month', () => this.trees.setMonth(this.state.month)),
      ev.on('disaster', (d) => {
        if (d.active && d.kind === 'earthquake') this.cameraController.shake(1, 3);
      }),
      ev.on('reset', () => this.setState(this.state)),
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
    this.trees.setQuality({ lodDistance: q.treeLodDistance, density: q.treeDensity, castShadows: q.treeShadows, maxVariants: q.treeVariants });
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
    this.nightFill.intensity = 0.55 * L.night;
    sharedUniforms.uNight.value = L.night;
    sharedUniforms.uTime.value = this.clock;
    sharedUniforms.uLitFraction.value = litFractionAt(this._time);
    sharedUniforms.uSunDir.value.copy(L.lightDir);
    sharedUniforms.uSunColor.value.copy(L.lightColor).multiplyScalar(L.lightIntensity);
    this.terrain.setNight(L.night);
    this.water.update(this.clock, L.night);

    // shadows: the light direction used for shadows (and sun shading) only follows the sky in ~0.08 deg steps so a
    // slowly moving sun does not force a shadow-map re-render every frame
    const vis = this.sun.visible;
    if (vis !== this.shSunVisible) { this.shSunVisible = vis; this.invalidateShadows(1); }
    if (this.shadowDir.angleTo(L.lightDir) > 0.0014 || !this.shadowCache) this.shadowDir.copy(L.lightDir);
    fitSunShadow(this.sun, this.camera, {
      target: this.cameraController.target,
      distance: this.cameraController.distance,
      rangeMul: this.q.shadowRangeMul,
      lightDir: this.shadowDir,
      maxHeight: this.maxHeight,
      minHeight: this.terrainMin,
      mapSize: this.state.size * CELL_SIZE,
    });

    this.updateAtmosphere();
    this.terrain.update();
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
    f.uFogDensity.value = (0.00008 + 0.0008 * mist * mist + 0.0001 * n) * (climate === 'desert' ? 0.6 : 1);
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
    // grading
    g.exposure = L.exposure;
    this.renderer.toneMappingExposure = L.exposure;
    const golden = L.golden;
    g.tint.setRGB(1 + 0.05 * golden - 0.07 * n, 1 - 0.01 * golden - 0.03 * n, 1 - 0.06 * golden + 0.08 * n);
    g.saturation = 1.08 + 0.06 * golden - 0.32 * n;
    g.contrast = 1.04 + 0.04 * n;
    g.lift.setRGB(0.002 * n, 0.006 * n, 0.016 * n);
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
    this.updateDynamicResolution();
    this.updateShadowPolicy();
    this.post.render(this.scene, this.camera, null);
  }

  /** decide whether this frame re-renders the shadow map (see shadowCache) */
  private updateShadowPolicy(): void {
    const sm = this.renderer.shadowMap;
    if (!this.shadowCache) {
      sm.autoUpdate = true;
      return;
    }
    sm.autoUpdate = false;
    this.frameNo++;
    const sun = this.sun;
    if (!sun.visible || !sun.castShadow || !sm.enabled) {
      sm.needsUpdate = false;
      return;
    }
    // fit the shadow cameras now (three repeats this identically when it renders the map) and compare
    this.camera.updateMatrixWorld();
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    const sh = sun.shadow;
    (sh as unknown as { updateMatrices(l: THREE.Light, c: THREE.Camera): void }).updateMatrices(sun, this.camera);
    const cams: THREE.Camera[] = sun.cascaded ? ((sun.cascadeShadow as any)._cameras as THREE.Camera[]) : [sh.camera];
    const key = this.shKey;
    let o = 0, moved = false;
    for (const c of cams) {
      for (const m of [c.matrixWorld.elements, c.projectionMatrix.elements]) {
        for (let i = 0; i < 16; i++, o++) {
          // tolerance: the damped camera jitters by float ulps even when still
          if (Math.abs(key[o] - m[i]) > 1e-6 * Math.max(1, Math.abs(m[i]))) { key[o] = m[i]; moved = true; }
        }
      }
    }
    let need = moved || this.shForce > 0 || !sh.map || this.frameNo - this.shFrame >= this.shadowMaxAge;
    if (!need && shadowCasters.version !== this.shVersion && this.frameNo - this.shFrame >= this.shadowInterval) need = true;
    if (need) {
      this.shadowStats.reason = moved ? 'moved' : this.shForce > 0 ? 'forced' : !sh.map ? 'nomap' : shadowCasters.version !== this.shVersion ? 'casters' : 'age';
      this.shVersion = shadowCasters.version;
      this.shFrame = this.frameNo;
      if (this.shForce > 0) this.shForce--;
      this.shadowStats.rendered++;
    } else this.shadowStats.skipped++;
    sm.needsUpdate = need;
  }

  /** adapt renderScale to the frame interval (see dynamicResolution) */
  private updateDynamicResolution(): void {
    const now = performance.now();
    const dt = now - this.drsLast;
    this.drsLast = now;
    if (!this.dynamicResolution) {
      if (this.renderScale !== 1) { this.renderScale = 1; this.applyRenderSize(); }
      return;
    }
    if (dt <= 0 || dt > 250) return;
    const budget = 1000 / this.q.targetFps;
    // one-off CPU spikes (sim day ticks, GC, chunk rebuilds) are not a fill-rate problem: clamp each sample so only
    // sustained slow frames lower the resolution
    const sample = Math.min(dt, budget * 2);
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
    this.post.setSize(Math.max(1, Math.round(this.width * this.pixelRatio * s)), Math.max(1, Math.round(this.height * this.pixelRatio * s)));
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
      if (!this.sun.cascaded) {
        fitSunShadow(this.sun, this.camera, { target: _v.set(W / 2, 0, W / 2), distance: W, rangeMul: 1.2, lightDir: this.sky.lighting.lightDir, maxHeight: this.maxHeight });
      }
    } else {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this.post.setSize(width, height);
    this.renderer.info.reset();
    this.renderer.shadowMap.needsUpdate = true;
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
    this.renderer.dispose();
  }
}

const _bbox = new THREE.Box3();
const _bboxMax = new THREE.Vector3();
const _rayInv = new THREE.Ray();
