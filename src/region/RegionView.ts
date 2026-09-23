/**
 * RegionView — three.js view of a region: diorama terrain + water, tile borders, hover / selection highlight,
 * founded cities as draped top-down thumbnails + extruded skyline hints; orbit / pan / zoom camera.
 *   const view = new RegionView(container, model); view.start();
 *   view.onHover = (tile, x, y) => ...; view.onClick = (tile) => ...; view.onDoubleClick = (tile) => ...
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RNG } from '../core/rng';
import type { QualityLevel } from '../render/contracts';
import { UNIT_M, type RegionModel } from './RegionModel';
import type { RegionTile } from './types';
import { RegionTerrain, makeLighting, type Lighting } from './render/RegionTerrain';
import { isSoftwareGL } from './render/MenuBackground';
import { BUILDING_FRAG, BUILDING_VERT } from './render/shaders';
import { decodeBytes } from './citySummary';

export interface RegionViewOptions {
  quality?: QualityLevel;
  exaggeration?: number;
}

const MAX_SKYLINE = 24000;

export class RegionView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 50, 200000);
  readonly controls: OrbitControls;
  readonly terrain: RegionTerrain;
  readonly model: RegionModel;
  private lighting: Lighting;
  private skyline: THREE.InstancedMesh;
  private shadowPlane: THREE.Mesh;
  private raf = 0;
  private t0 = performance.now();
  private disposed = false;
  private hovered: RegionTile | null = null;
  private selected: RegionTile | null = null;
  private down: { x: number; y: number; t: number; button: number } | null = null;
  private pointer: { x: number; y: number } | null = null;
  private pickDirty = false;
  private fly: { from: THREE.Vector3; to: THREE.Vector3; fromD: number; toD: number; t: number; dur: number } | null = null;
  private minFrameMs = 0;
  private lastFrame = 0;
  private onResize = () => this.resize();
  private listeners: [EventTarget, string, EventListener][] = [];

  onHover?: (tile: RegionTile | null, clientX: number, clientY: number) => void;
  onClick?: (tile: RegionTile | null) => void;
  onDoubleClick?: (tile: RegionTile) => void;
  /** called every frame after rendering (for DOM labels) */
  onFrame?: () => void;
  onFirstFrame?: () => void;
  private framed = false;

  constructor(private container: HTMLElement, model: RegionModel, opts: RegionViewOptions = {}) {
    this.model = model;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    const software = isSoftwareGL(this.renderer);
    this.minFrameMs = software ? 400 : 0;
    this.renderer.setPixelRatio(software ? 0.85 : Math.min(window.devicePixelRatio || 1, opts.quality === 'low' ? 1 : 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.lighting = makeLighting('day');
    this.renderer.toneMappingExposure = this.lighting.exposure;
    this.renderer.domElement.className = 'region-canvas';
    container.appendChild(this.renderer.domElement);

    this.terrain = new RegionTerrain(model, {
      exaggeration: opts.exaggeration ?? 2.2,
      lighting: this.lighting,
      sides: true,
      tiles: true,
      trees: software ? 22000 : opts.quality === 'low' ? 20000 : opts.quality === 'ultra' ? 90000 : 55000,
    });
    this.scene.add(this.terrain.group);

    // soft contact shadow under the diorama
    const sc = document.createElement('canvas');
    sc.width = sc.height = 256;
    const g = sc.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 40, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const stex = new THREE.CanvasTexture(sc);
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(model.sizeX * 1.7, model.sizeZ * 1.7), new THREE.MeshBasicMaterial({ map: stex, transparent: true, depthWrite: false, toneMapped: false }));
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.set(model.sizeX / 2 + 400, -140 * this.terrain.exag - 60, model.sizeZ / 2 + 600);
    this.shadowPlane.renderOrder = -2;
    this.scene.add(this.shadowPlane);

    // skyline hints
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const L = this.lighting;
    const bmat = new THREE.ShaderMaterial({
      vertexShader: BUILDING_VERT,
      fragmentShader: BUILDING_FRAG,
      uniforms: {
        uSunDir: { value: L.sunDir },
        uSunColor: { value: L.sunColor },
        uSkyAmb: { value: L.skyAmb },
        uGroundAmb: { value: L.groundAmb },
        uWindow: { value: L.windows },
        uNight: { value: 0 },
        uExag: { value: this.terrain.exag },
        uFogColor: { value: L.fogColor },
        uFogSunColor: { value: L.fogSunColor },
        uFogDensity: { value: L.fogDensity },
        uFogHeight: { value: L.fogHeight },
      },
    });
    this.skyline = new THREE.InstancedMesh(box, bmat, MAX_SKYLINE);
    this.skyline.count = 0;
    this.skyline.frustumCulled = false;
    this.skyline.setColorAt(0, new THREE.Color(1, 1, 1));
    this.scene.add(this.skyline);

    // camera + controls (SC4-like: left drag pans, right drag rotates, wheel zooms towards the cursor)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 900;
    this.controls.maxDistance = 34000;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 1.22;
    this.controls.rotateSpeed = 0.6;
    this.controls.panSpeed = 1.1;
    this.controls.zoomSpeed = 1.15;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.keyPanSpeed = 40;
    this.controls.listenToKeyEvents(window);
    this.resetCamera();

    const el = this.renderer.domElement;
    this.listen(el, 'pointerdown', (e) => {
      const pe = e as PointerEvent;
      this.down = { x: pe.clientX, y: pe.clientY, t: performance.now(), button: pe.button };
    });
    this.listen(el, 'pointerup', (e) => {
      const pe = e as PointerEvent;
      const d = this.down;
      this.down = null;
      if (!d || pe.button !== 0) return;
      if (Math.hypot(pe.clientX - d.x, pe.clientY - d.y) > 5 || performance.now() - d.t > 500) return;
      const tile = this.pickTile(pe.clientX, pe.clientY);
      this.onClick?.(tile);
    });
    this.listen(el, 'dblclick', (e) => {
      const me = e as MouseEvent;
      const tile = this.pickTile(me.clientX, me.clientY);
      if (tile) this.onDoubleClick?.(tile);
    });
    this.listen(el, 'pointermove', (e) => {
      const pe = e as PointerEvent;
      this.pointer = { x: pe.clientX, y: pe.clientY };
      this.pickDirty = true;
    });
    this.listen(el, 'pointerleave', () => {
      this.pointer = null;
      this.setHover(null, 0, 0);
    });
    this.listen(el, 'contextmenu', (e) => e.preventDefault());
    this.listen(window, 'keydown', (e) => {
      const k = (e as KeyboardEvent).key.toLowerCase();
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (k === 'q' || k === 'e') this.rotateBy(k === 'q' ? -Math.PI / 4 : Math.PI / 4);
      if (k === 'home') this.resetCamera(true);
    });
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  private listen(t: EventTarget, type: string, fn: EventListener): void {
    t.addEventListener(type, fn);
    this.listeners.push([t, type, fn]);
  }

  resetCamera(animate = false): void {
    const c = new THREE.Vector3(this.model.sizeX / 2, 0, this.model.sizeZ / 2 + 600);
    const dist = Math.max(this.model.sizeX, this.model.sizeZ) * 1.25;
    if (animate) return this.flyTo(c, dist);
    this.controls.target.copy(c);
    const dir = new THREE.Vector3(-0.55, 0.78, 0.9).normalize();
    this.camera.position.copy(c).addScaledVector(dir, dist);
    this.controls.update();
  }

  private rotateBy(angle: number): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.camera.position.copy(this.controls.target).add(off);
    this.controls.update();
  }

  /** smooth camera flight to a point (distance = camera distance) */
  flyTo(target: THREE.Vector3, distance?: number, dur = 0.9): void {
    const fromD = this.camera.position.distanceTo(this.controls.target);
    this.fly = { from: this.controls.target.clone(), to: target.clone(), fromD, toD: distance ?? fromD, t: 0, dur };
  }

  focusTile(tile: RegionTile): void {
    const c = this.tileCenter(tile);
    this.flyTo(c, Math.max(4200, tile.size * UNIT_M * 2.3));
  }

  tileCenter(tile: RegionTile, lift = 0): THREE.Vector3 {
    const x = (tile.x + tile.size / 2) * UNIT_M, z = (tile.z + tile.size / 2) * UNIT_M;
    return new THREE.Vector3(x, this.terrain.surfaceY(x, z) + lift, z);
  }

  /** world -> css pixel position relative to the container (null if behind the camera) */
  project(p: THREE.Vector3): { x: number; y: number } | null {
    const v = p.clone().project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height };
  }

  pickTile(clientX: number, clientY: number): RegionTile | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    const hit = this.terrain.raycast(rc.ray);
    if (!hit) return null;
    return this.model.tileAtUnit(hit.x / UNIT_M, hit.z / UNIT_M) ?? null;
  }

  private setHover(tile: RegionTile | null, x: number, y: number): void {
    if (tile !== this.hovered) {
      this.hovered = tile;
      this.terrain.setHover(tile);
    }
    this.onHover?.(tile, x, y);
  }

  select(tile: RegionTile | null): void {
    this.selected = tile;
    this.terrain.setSelected(tile);
  }

  get selectedTile(): RegionTile | null {
    return this.selected;
  }

  /** (re)load founded-city thumbnails into the draped atlas and rebuild skyline hints */
  async refreshCities(): Promise<void> {
    this.terrain.updateTiles();
    const jobs: Promise<void>[] = [];
    for (const t of this.model.data.tiles) {
      if (!t.city?.thumbnail) {
        this.terrain.setCityImage(t, null);
        continue;
      }
      const img = new Image();
      jobs.push(
        new Promise<void>((res) => {
          img.onload = () => {
            this.terrain.setCityImage(t, img);
            res();
          };
          img.onerror = () => res();
          img.src = t.city!.thumbnail!;
        }),
      );
    }
    this.rebuildSkyline();
    await Promise.all(jobs);
  }

  private rebuildSkyline(): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const colr = new THREE.Color();
    const palette = ['#e8e4dc', '#d6d9de', '#c9d2dc', '#efe6d6', '#bcc7d3', '#dcd2c2'].map((c) => new THREE.Color(c));
    const exag = this.terrain.exag;
    let n = 0;
    for (const t of this.model.data.tiles) {
      const sk = t.city?.skyline;
      if (!sk) continue;
      let grid: Uint8Array;
      try {
        grid = decodeBytes(sk);
      } catch {
        continue;
      }
      const g = Math.round(Math.sqrt(grid.length));
      if (!g) continue;
      const block = (t.size * UNIT_M) / g;
      const rng = new RNG(t.x * 977 + t.z * 131 + 7);
      for (let bz = 0; bz < g; bz++)
        for (let bx = 0; bx < g; bx++) {
          const v = grid[bz * g + bx];
          if (!v) continue;
          const hMax = v * 2;
          const count = hMax > 40 ? 3 : hMax > 14 ? 2 : 1;
          for (let k = 0; k < count && n < MAX_SKYLINE; k++) {
            const hh = k === 0 ? hMax : hMax * rng.range(0.35, 0.8);
            if (hh < 9) continue; // small houses read better as the draped thumbnail
            const w = rng.range(0.22, 0.42) * block, d = rng.range(0.22, 0.42) * block;
            const x = t.x * UNIT_M + (bx + rng.range(0.2, 0.8)) * block, z = t.z * UNIT_M + (bz + rng.range(0.2, 0.8)) * block;
            pos.set(x, this.terrain.surfaceY(x, z) - 1, z);
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.chance(0.5) ? 0 : Math.PI / 2);
            scl.set(w, hh * exag, d);
            m.compose(pos, q, scl);
            this.skyline.setMatrixAt(n, m);
            colr.copy(palette[Math.floor(rng.next() * palette.length)]).multiplyScalar(0.75 + rng.next() * 0.25);
            this.skyline.setColorAt(n, colr);
            n++;
          }
        }
    }
    this.skyline.count = n;
    this.skyline.instanceMatrix.needsUpdate = true;
    if (this.skyline.instanceColor) this.skyline.instanceColor.needsUpdate = true;
  }

  start(): void {
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      if (this.framed && now - this.lastFrame < this.minFrameMs) return;
      this.lastFrame = now;
      this.frame();
    };
    loop(performance.now());
  }

  private frame(): void {
    const t = (performance.now() - this.t0) / 1000;
    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + 1 / 60 / f.dur);
      const e = f.t < 0.5 ? 4 * f.t * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 3) / 2;
      const off = this.camera.position.clone().sub(this.controls.target).normalize();
      this.controls.target.lerpVectors(f.from, f.to, e);
      const d = THREE.MathUtils.lerp(f.fromD, f.toD, e);
      this.camera.position.copy(this.controls.target).addScaledVector(off, d);
      if (f.t >= 1) this.fly = null;
    }
    // keep the focus inside the region
    const tg = this.controls.target;
    const cx = THREE.MathUtils.clamp(tg.x, -1000, this.model.sizeX + 1000), cz = THREE.MathUtils.clamp(tg.z, -1000, this.model.sizeZ + 1000);
    if (cx !== tg.x || cz !== tg.z) {
      const dx = cx - tg.x, dz = cz - tg.z;
      tg.x = cx;
      tg.z = cz;
      this.camera.position.x += dx;
      this.camera.position.z += dz;
    }
    this.controls.update();
    const dist = this.camera.position.distanceTo(tg);
    this.camera.near = Math.max(10, dist * 0.02);
    this.camera.far = dist * 6 + 30000;
    this.camera.updateProjectionMatrix();
    if (this.pickDirty && this.pointer && !this.down) {
      this.pickDirty = false;
      this.setHover(this.pickTile(this.pointer.x, this.pointer.y), this.pointer.x, this.pointer.y);
    }
    this.terrain.update(t, Math.sin(t * 3) * 0.5 + 0.5);
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
    if (!this.framed) {
      this.framed = true;
      this.onFirstFrame?.();
    }
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    this.controls.stopListenToKeyEvents();
    this.controls.dispose();
    this.terrain.dispose();
    this.skyline.geometry.dispose();
    (this.skyline.material as THREE.Material).dispose();
    this.skyline.dispose();
    (this.shadowPlane.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.shadowPlane.material as THREE.Material).dispose();
    this.shadowPlane.geometry.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
