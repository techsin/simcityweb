/**
 * Minimal WorldView used when the real one (src/render/world/WorldView.ts) is missing or fails to construct.
 * Terrain mesh with height tint, water plane, instanced trees, draped data-texture layers (overlay / highlights),
 * a simple SC4-like camera (right-drag rotate, middle-drag pan, wheel zoom, WASD/arrows pan, Q/E rotate 90°).
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../core/constants';
import { Overlay } from '../../core/types';
import type { CellRect, Emitter } from '../../core/events';
import type { CityState } from '../../sim/CityState';
import type { CityEvents } from '../../sim/Simulation';
import type { CameraControllerApi, CellHit, QualityLevel, WorldViewApi } from '../../render/contracts';

class SimpleCamera implements CameraControllerApi {
  enabled = true;
  readonly target = new THREE.Vector3();
  private goal = new THREE.Vector3();
  private dist = 900;
  private goalDist = 900;
  yaw = Math.PI * 0.25;
  private goalYaw = Math.PI * 0.25;
  pitch = 0.95;
  private keys = new Set<string>();
  private drag: { btn: number; x: number; y: number } | null = null;
  private cleanup: (() => void)[] = [];

  constructor(private cam: THREE.PerspectiveCamera, private el: HTMLElement, private mapSize: number) {
    const c = (mapSize * CELL_SIZE) / 2;
    this.target.set(c, 0, c);
    this.goal.copy(this.target);
    const on = <K extends keyof WindowEventMap>(t: EventTarget, k: K, f: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions) => {
      t.addEventListener(k, f as EventListener, o);
      this.cleanup.push(() => t.removeEventListener(k, f as EventListener));
    };
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(el, 'pointerdown', (e) => {
      if (!this.enabled || e.button === 0) return;
      this.drag = { btn: e.button, x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    });
    on(el, 'pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (this.drag.btn === 2) {
        this.goalYaw -= dx * 0.006;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, 0.35, 1.45);
      } else this.pan(-dx * this.dist * 0.0016, -dy * this.dist * 0.0022);
    });
    on(el, 'pointerup', () => (this.drag = null));
    on(el, 'wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.goalDist = THREE.MathUtils.clamp(this.goalDist * Math.pow(1.0015, e.deltaY), 60, mapSize * CELL_SIZE * 1.6);
    }, { passive: false });
    on(window, 'keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'q') this.rotateStep(-1);
      if (k === 'e') this.rotateStep(1);
    });
    on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    on(window, 'blur', () => this.keys.clear());
  }

  get distance(): number {
    return this.dist;
  }

  pan(right: number, fwd: number): void {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    // camera looks from (sin(yaw), cos(yaw)) direction toward target
    this.goal.x += right * c - fwd * s;
    this.goal.z += -right * s - fwd * c;
    const m = this.mapSize * CELL_SIZE;
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, 0, m);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, 0, m);
  }

  focusOn(x: number, z: number, distance?: number): void {
    this.goal.set(x, this.goal.y, z);
    if (distance) this.goalDist = distance;
  }

  rotateStep(dir: 1 | -1): void {
    const step = Math.PI / 2;
    this.goalYaw = Math.round((this.goalYaw + dir * step) / step) * step + (Math.PI * 0.25) * 0;
  }

  update(dt: number, heightAt: (x: number, z: number) => number): void {
    if (this.enabled && this.keys.size) {
      const sp = this.dist * 1.1 * dt;
      if (this.keys.has('w') || this.keys.has('arrowup')) this.pan(0, sp);
      if (this.keys.has('s') || this.keys.has('arrowdown')) this.pan(0, -sp);
      if (this.keys.has('a') || this.keys.has('arrowleft')) this.pan(-sp, 0);
      if (this.keys.has('d') || this.keys.has('arrowright')) this.pan(sp, 0);
      if (this.keys.has('=') || this.keys.has('+') || this.keys.has('pageup')) this.goalDist = Math.max(60, this.goalDist * (1 - dt * 1.5));
      if (this.keys.has('-') || this.keys.has('pagedown')) this.goalDist = Math.min(this.mapSize * CELL_SIZE * 1.6, this.goalDist * (1 + dt * 1.5));
    }
    const k = 1 - Math.exp(-dt * 8);
    this.goal.y = Math.max(0, heightAt(this.goal.x, this.goal.z));
    this.target.lerp(this.goal, k);
    this.dist += (this.goalDist - this.dist) * k;
    this.yaw += (this.goalYaw - this.yaw) * k;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.cam.position.set(this.target.x + Math.sin(this.yaw) * cp * this.dist, this.target.y + sp * this.dist, this.target.z + Math.cos(this.yaw) * cp * this.dist);
    this.cam.lookAt(this.target);
  }

  dispose(): void {
    for (const f of this.cleanup) f();
  }
}

/** a DataTexture draped over the terrain (one texel per cell) */
export class DrapedLayer {
  readonly tex: THREE.DataTexture;
  readonly data: Uint8Array;
  readonly mesh: THREE.Mesh;
  constructor(geo: THREE.BufferGeometry, readonly N: number, order: number, opacity = 1) {
    this.data = new Uint8Array(N * N * 4);
    this.tex = new THREE.DataTexture(this.data, N, N, THREE.RGBAFormat);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity, polygonOffset: true, polygonOffsetFactor: -1 - order, polygonOffsetUnits: -4 - order * 2 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 10 + order;
    this.mesh.raycast = () => {};
  }
  set(i: number, r: number, g: number, b: number, a: number): void {
    const o = i * 4;
    this.data[o] = r;
    this.data[o + 1] = g;
    this.data[o + 2] = b;
    this.data[o + 3] = a;
  }
  clear(): void {
    this.data.fill(0);
  }
  commit(): void {
    this.tex.needsUpdate = true;
  }
}

function hexRGB(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** simple 3-stop color ramp for overlays */
function ramp(t: number, good = false): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const a = good ? [220, 60, 60] : [60, 190, 90];
  const m = [240, 200, 60];
  const b = good ? [60, 190, 90] : [220, 60, 60];
  const [p, q, u] = t < 0.5 ? [a, m, t * 2] : [m, b, (t - 0.5) * 2];
  return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u];
}

export class FallbackWorldView implements WorldViewApi {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: SimpleCamera;
  timeOfDay = 14;
  autoTime = true;
  readonly isFallback = true;
  private terrain: THREE.Mesh;
  readonly terrainGeo: THREE.BufferGeometry;
  private water: THREE.Mesh;
  private trees: THREE.InstancedMesh | null = null;
  private sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  private hemi = new THREE.HemisphereLight(0xbcd6ff, 0x5a5040, 0.9);
  private overlayLayer: DrapedLayer;
  private hiLayer: DrapedLayer;
  private brush: THREE.Mesh;
  private overlay = Overlay.None;
  private hiTouched: number[] = [];
  private offs: (() => void)[] = [];
  private raycaster = new THREE.Raycaster();
  private overlayDirty = false;
  private overlayTimer = 0;

  constructor(private canvas: HTMLCanvasElement, private state: CityState, events: Emitter<CityEvents>, opts: { quality: QualityLevel }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x9fb7cc);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera = new THREE.PerspectiveCamera(38, 1, 2, 20000);
    this.controls = new SimpleCamera(this.camera, canvas, state.size);
    this.setQuality(opts.quality);
    const N = state.size;
    const sizeM = N * CELL_SIZE;
    this.scene.background = new THREE.Color(0xa9c3d9);
    this.scene.fog = new THREE.Fog(0xa9c3d9, sizeM * 1.2, sizeM * 3.2);
    this.sun.position.set(sizeM * 0.2, sizeM * 0.9, sizeM * 0.6);
    this.sun.target.position.set(sizeM / 2, 0, sizeM / 2);
    this.scene.add(this.sun, this.sun.target, this.hemi);

    // terrain
    const g = new THREE.BufferGeometry();
    const N1 = N + 1;
    const pos = new Float32Array(N1 * N1 * 3);
    const uv = new Float32Array(N1 * N1 * 2);
    const col = new Float32Array(N1 * N1 * 3);
    for (let z = 0; z <= N; z++)
      for (let x = 0; x <= N; x++) {
        const i = z * N1 + x;
        pos[i * 3] = x * CELL_SIZE;
        pos[i * 3 + 2] = z * CELL_SIZE;
        uv[i * 2] = x / N;
        uv[i * 2 + 1] = z / N;
      }
    const idx = new Uint32Array(N * N * 6);
    let k = 0;
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const a = z * N1 + x, b = a + 1, c = a + N1, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.terrainGeo = g;
    this.terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.scene.add(this.terrain);
    this.updateTerrain();

    const wg = new THREE.PlaneGeometry(sizeM * 3, sizeM * 3);
    wg.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(wg, new THREE.MeshPhongMaterial({ color: 0x2f6f9a, transparent: true, opacity: 0.82, shininess: 80, specular: 0x88aacc }));
    this.water.position.set(sizeM / 2, -0.4, sizeM / 2);
    this.water.raycast = () => {};
    this.scene.add(this.water);

    this.overlayLayer = new DrapedLayer(g, N, 4, 0.78);
    this.overlayLayer.mesh.visible = false;
    this.hiLayer = new DrapedLayer(g, N, 6, 0.85);
    this.scene.add(this.overlayLayer.mesh, this.hiLayer.mesh);

    const rg = new THREE.RingGeometry(0.92, 1, 64);
    rg.rotateX(-Math.PI / 2);
    this.brush = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    this.brush.renderOrder = 50;
    this.brush.visible = false;
    this.scene.add(this.brush);

    this.buildTrees();
    this.offs.push(
      events.on('terrainChanged', () => this.updateTerrain()),
      events.on('treesChanged', () => this.buildTrees()),
      events.on('layerUpdated', () => (this.overlayDirty = true)),
      events.on('zoneChanged', () => (this.overlayDirty = true)),
      events.on('reset', () => {
        this.updateTerrain();
        this.buildTrees();
      }),
    );
  }

  private updateTerrain(): void {
    const st = this.state;
    const N = st.size, N1 = N + 1;
    const pos = this.terrainGeo.getAttribute('position') as THREE.BufferAttribute;
    const col = this.terrainGeo.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color();
    const climate = st.config.climate;
    const grass = new THREE.Color(climate === 'desert' ? 0xc9b27a : climate === 'alpine' ? 0x6f8a58 : climate === 'tropical' ? 0x5c9a45 : 0x6f9a4c);
    const grass2 = new THREE.Color(climate === 'desert' ? 0xb99a62 : 0x587d3c);
    const rock = new THREE.Color(0x8a8272), snow = new THREE.Color(0xf2f4f6), sand = new THREE.Color(0xd8c89a), seabed = new THREE.Color(0x5d6e62);
    for (let z = 0; z <= N; z++)
      for (let x = 0; x <= N; x++) {
        const i = z * N1 + x;
        const hgt = st.heights[i];
        pos.setY(i, hgt);
        if (hgt < 0) c.copy(seabed);
        else if (hgt < 1.6) c.copy(sand);
        else {
          const t = Math.min(1, hgt / 120);
          c.copy(grass).lerp(grass2, Math.min(1, hgt / 60));
          if (hgt > 90) c.lerp(rock, Math.min(1, (hgt - 90) / 60));
          if (hgt > 170) c.lerp(snow, Math.min(1, (hgt - 170) / 40));
          c.offsetHSL(0, 0, (t - 0.3) * 0.04);
        }
        col.setXYZ(i, c.r, c.g, c.b);
      }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.terrainGeo.computeVertexNormals();
    this.terrainGeo.computeBoundingSphere();
    this.terrainGeo.computeBoundingBox();
  }

  private buildTrees(): void {
    const st = this.state;
    if (this.trees) {
      this.scene.remove(this.trees);
      this.trees.dispose();
    }
    let count = 0;
    for (let i = 0; i < st.cells; i++) if (st.trees[i] && st.building[i] < 0 && !st.network[i]) count++;
    const geo = new THREE.ConeGeometry(3.6, 11, 6);
    geo.translate(0, 5.5, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x3f6b35 }), Math.max(1, count));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0;
    const N = st.size;
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        const d = st.trees[i];
        if (!d || st.building[i] >= 0 || st.network[i]) continue;
        const hsh = ((x * 73856093) ^ (z * 19349663)) >>> 0;
        const jx = ((hsh & 255) / 255 - 0.5) * 8, jz = (((hsh >> 8) & 255) / 255 - 0.5) * 8;
        const wx = x * CELL_SIZE + 8 + jx, wz = z * CELL_SIZE + 8 + jz;
        const sc = 0.7 + d * 0.22;
        p.set(wx, st.heightAt(wx, wz), wz);
        s.set(sc * 1.6, sc, sc * 1.6);
        m.compose(p, q, s);
        mesh.setMatrixAt(n++, m);
      }
    mesh.count = n;
    mesh.raycast = () => {};
    this.trees = mesh;
    this.scene.add(mesh);
  }

  private refreshOverlay(): void {
    const st = this.state;
    const L = this.overlayLayer;
    const o = this.overlay;
    L.mesh.visible = o !== Overlay.None;
    if (o === Overlay.None) return;
    const arr: Record<number, ArrayLike<number> | undefined> = {
      [Overlay.Traffic]: st.congestion,
      [Overlay.AirPollution]: st.airPollution,
      [Overlay.WaterPollution]: st.waterPollution,
      [Overlay.Garbage]: st.garbage,
      [Overlay.LandValue]: st.landValue,
      [Overlay.Crime]: st.crime,
      [Overlay.Police]: st.policeCov,
      [Overlay.Fire]: st.fireCov,
      [Overlay.Health]: st.healthCov,
      [Overlay.Education]: st.eduCov,
      [Overlay.Power]: st.powered,
      [Overlay.Water]: st.watered,
      [Overlay.Desirability]: st.desirability[0],
      [Overlay.Noise]: st.noise,
      [Overlay.Transit]: st.transitCov,
    };
    const goodHigh = [Overlay.LandValue, Overlay.Police, Overlay.Fire, Overlay.Health, Overlay.Education, Overlay.Power, Overlay.Water, Overlay.Desirability, Overlay.Transit].includes(o);
    const a = arr[o];
    const zc: Record<number, number> = { 1: 0x3cc76a, 2: 0x2aa358, 3: 0x1c7a40, 4: 0x6aa6ff, 5: 0x3d8bff, 6: 0x2360c9, 7: 0xc8d86a, 8: 0xf0b429, 9: 0xd08a12, 10: 0x8a6a4a };
    for (let i = 0; i < st.cells; i++) {
      if (o === Overlay.Zones) {
        const z = st.zone[i];
        if (z) {
          const [r, g, b] = hexRGB(zc[z] ?? 0x888888);
          L.set(i, r, g, b, 200);
        } else L.set(i, 0, 0, 0, 0);
        continue;
      }
      if (!a) {
        L.set(i, 0, 0, 0, 0);
        continue;
      }
      if (st.water[i] && o !== Overlay.WaterPollution) {
        L.set(i, 0, 0, 0, 0);
        continue;
      }
      let v = a[i];
      if (o === Overlay.Desirability) v = (v + 1) / 2;
      if (o === Overlay.Traffic && !st.network[i]) {
        L.set(i, 0, 0, 0, 40);
        continue;
      }
      const [r, g, b] = ramp(v, goodHigh);
      L.set(i, r, g, b, v < 0.02 && !goodHigh ? 30 : 190);
    }
    L.commit();
  }

  update(dt: number): void {
    this.controls.update(dt, (x, z) => this.state.heightAt(x, z));
    if (this.autoTime) this.timeOfDay = (this.timeOfDay + dt * 0.1) % 24;
    const t = this.timeOfDay;
    const day = Math.max(0, Math.sin(((t - 6) / 12) * Math.PI));
    const sizeM = this.state.size * CELL_SIZE;
    const ang = ((t - 6) / 12) * Math.PI;
    this.sun.position.set(sizeM / 2 + Math.cos(ang) * sizeM, Math.max(40, Math.sin(ang) * sizeM), sizeM / 2 + sizeM * 0.4);
    this.sun.intensity = 0.2 + day * 2.2;
    this.hemi.intensity = 0.25 + day * 0.75;
    const sky = new THREE.Color(0x0c1424).lerp(new THREE.Color(0xa9c3d9), Math.min(1, day * 1.6));
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    if (this.overlayDirty && this.overlay !== Overlay.None) {
      this.overlayTimer -= dt;
      if (this.overlayTimer <= 0) {
        this.overlayDirty = false;
        this.overlayTimer = 0.5;
        this.refreshOverlay();
      }
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  setQuality(q: QualityLevel): void {
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    this.renderer.setPixelRatio(q === 'low' ? 0.75 : q === 'medium' ? 1 : Math.min(dpr, q === 'ultra' ? 2 : 1.5));
  }

  setOverlay(o: Overlay): void {
    this.overlay = o;
    this.refreshOverlay();
  }

  setGridVisible(_v: boolean): void {
    /* not supported by the fallback view */
  }

  private clearHi(): void {
    for (const i of this.hiTouched) this.hiLayer.set(i, 0, 0, 0, 0);
    this.hiTouched.length = 0;
  }

  setHighlight(cells: { x: number; z: number; ok: boolean }[] | null): void {
    this.clearHi();
    if (cells) {
      const N = this.state.size;
      for (const c of cells) {
        if (c.x < 0 || c.z < 0 || c.x >= N || c.z >= N) continue;
        const i = c.z * N + c.x;
        if (c.ok) this.hiLayer.set(i, 90, 220, 140, 170);
        else this.hiLayer.set(i, 255, 80, 80, 190);
        this.hiTouched.push(i);
      }
    }
    this.hiLayer.commit();
  }

  setHighlightRect(rect: CellRect | null, color: number): void {
    this.clearHi();
    if (rect) {
      const N = this.state.size;
      const [r, g, b] = hexRGB(color);
      for (let z = Math.max(0, rect.z0); z < Math.min(N, rect.z1); z++)
        for (let x = Math.max(0, rect.x0); x < Math.min(N, rect.x1); x++) {
          const i = z * N + x;
          const edge = x === rect.x0 || z === rect.z0 || x === rect.x1 - 1 || z === rect.z1 - 1;
          this.hiLayer.set(i, r, g, b, edge ? 230 : 140);
          this.hiTouched.push(i);
        }
    }
    this.hiLayer.commit();
  }

  setBrush(center: { x: number; z: number } | null, radiusCells: number): void {
    if (!center) {
      this.brush.visible = false;
      return;
    }
    this.brush.visible = true;
    const r = Math.max(0.5, radiusCells) * CELL_SIZE;
    this.brush.scale.set(r, 1, r);
    this.brush.position.set(center.x, this.state.heightAt(center.x, center.z) + 1.5, center.z);
  }

  pickCell(clientX: number, clientY: number): CellHit | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.terrain, false)[0];
    if (!hit) return null;
    const N = this.state.size;
    const x = Math.floor(hit.point.x / CELL_SIZE), z = Math.floor(hit.point.z / CELL_SIZE);
    if (x < 0 || z < 0 || x >= N || z >= N) return null;
    return { x, z, point: hit.point.clone() };
  }

  capture(width = 512, height = 512, topDown = false): string {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const pr = this.renderer.getPixelRatio();
    const cam = topDown ? new THREE.PerspectiveCamera(30, width / height, 10, 40000) : this.camera;
    if (topDown) {
      const m = this.state.size * CELL_SIZE;
      const d = (m / 2 / Math.tan(THREE.MathUtils.degToRad(15))) * 1.02;
      cam.position.set(m / 2, d, m / 2 + 0.01);
      cam.lookAt(m / 2, 0, m / 2);
    }
    const hiVis = this.hiLayer.mesh.visible, brVis = this.brush.visible;
    this.hiLayer.mesh.visible = false;
    this.brush.visible = false;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    if (!topDown) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, cam);
    const url = this.canvas.toDataURL('image/jpeg', 0.85);
    this.hiLayer.mesh.visible = hiVis;
    this.brush.visible = brVis;
    this.renderer.setPixelRatio(pr);
    this.resize(size.x, size.y);
    return url;
  }

  dispose(): void {
    for (const f of this.offs) f();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.renderer.dispose();
  }
}
