/**
 * Title-screen background: a generated island region at sunset — sky dome with sun glow + clouds, endless ocean,
 * terrain with baked long shadows, glowing towns, soft bloom, slow cinematic orbit.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RNG } from '../../core/rng';
import { RegionModel, createRegionData, generateRegionTerrain } from '../RegionModel';
import type { RegionPresetId } from '../types';
import { RegionTerrain, makeLighting, type Lighting } from './RegionTerrain';
import { BUILDING_FRAG, BUILDING_VERT, LIGHTS_FRAG, LIGHTS_VERT, SKY_FRAG, SKY_VERT } from './shaders';

export interface MenuBackgroundOptions {
  seed?: number;
  preset?: RegionPresetId;
  quality?: 'low' | 'medium' | 'high' | 'ultra';
  /** initial orbit angle (radians) */
  angle?: number;
}

export class MenuBackground {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 30, 120000);
  private composer: EffectComposer | null = null;
  private terrain: RegionTerrain;
  private lighting: Lighting;
  private model: RegionModel;
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private towns: THREE.InstancedMesh | null = null;
  private lights: THREE.Points | null = null;
  private lightsMat: THREE.ShaderMaterial | null = null;
  private raf = 0;
  private t0 = performance.now();
  private angle = 0;
  private center = new THREE.Vector3();
  private radius = 5200;
  private lastT = 0;
  private minFrameMs = 0;
  private lastFrame = 0;
  private camY = -1;
  private disposed = false;
  private onResize = () => this.resize();
  /** called once after the first frame has been rendered */
  onFirstFrame?: () => void;
  private framed = false;

  constructor(private container: HTMLElement, opts: MenuBackgroundOptions = {}) {
    const seed = opts.seed ?? 20240;
    const preset = opts.preset ?? 'azure-coast';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    const software = isSoftwareGL(this.renderer);
    const quality = opts.quality ?? (software ? 'medium' : 'high');
    this.renderer.setPixelRatio(software ? 0.8 : Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.5));
    // software rasterizers (headless screenshots): leave the compositor room to breathe
    this.minFrameMs = software ? 600 : 0;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.lighting = makeLighting('sunset');
    this.renderer.toneMappingExposure = this.lighting.exposure;
    this.renderer.domElement.className = 'menu-bg-canvas';
    container.appendChild(this.renderer.domElement);

    // region terrain with the borders sunk into the sea: an island in an endless ocean
    const terrain = generateRegionTerrain(seed, preset, { samplesPerUnit: 16, islandFalloff: true });
    const { data } = createRegionData({ seed, preset, terrain });
    this.model = new RegionModel(data, terrain);
    this.terrain = new RegionTerrain(this.model, { exaggeration: 2.6, lighting: this.lighting, oceanMargin: 60000, tiles: false });
    this.scene.add(this.terrain.group);

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        uSunDir: { value: this.lighting.sunDir },
        uHorizon: { value: this.lighting.skyHorizon },
        uZenith: { value: this.lighting.skyZenith },
        uGlow: { value: this.lighting.glow },
        uSunColor: { value: this.lighting.sunColor },
        uCloudLit: { value: this.lighting.cloudLit },
        uCloudShade: { value: this.lighting.cloudShade },
        uHorizonAway: { value: new THREE.Color('#8a6f9e').multiplyScalar(0.95) },
        uTime: { value: 0 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    this.buildTowns(seed);

    // start with the camera opposite the sun (looking into the sunset), orbiting slowly
    const sd = this.lighting.sunDir;
    this.angle = opts.angle ?? Math.atan2(-sd.z, -sd.x) - 0.35;
    if (quality !== 'low') {
      const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: quality === 'medium' ? 0 : 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.45, 1.5));
      this.composer.addPass(new OutputPass());
    }
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  /** little towns on flat coastal land: instanced boxes with lit windows */
  private buildTowns(seed: number): void {
    const rng = new RNG(seed + 900);
    const m = this.model;
    const cands: { x: number; z: number; score: number }[] = [];
    for (let k = 0; k < 500; k++) {
      const x = rng.range(0.18, 0.82) * m.sizeX, z = rng.range(0.18, 0.82) * m.sizeZ;
      const h = m.heightAt(x, z);
      if (h < 2 || h > 45) continue;
      const slope = Math.abs(m.heightAt(x + 120, z) - m.heightAt(x - 120, z)) + Math.abs(m.heightAt(x, z + 120) - m.heightAt(x, z - 120));
      if (slope > 14) continue;
      let water = 0;
      for (let a = 0; a < 8; a++) if (m.heightAt(x + Math.cos(a) * 1200, z + Math.sin(a) * 1200) < 0) water++;
      cands.push({ x, z, score: water * 2 - slope * 0.2 + rng.next() * 3 });
    }
    cands.sort((a, b) => b.score - a.score);
    const towns: { x: number; z: number; r: number; tall: number }[] = [];
    for (const c of cands) {
      if (towns.length >= 5) break;
      if (towns.some((t) => Math.hypot(t.x - c.x, t.z - c.z) < 2600)) continue;
      towns.push({ x: c.x, z: c.z, r: towns.length === 0 ? 1100 : rng.range(450, 800), tall: towns.length === 0 ? 1 : rng.range(0.25, 0.6) });
    }
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    const exag = this.terrain.exag;
    const palette = ['#d9d2c5', '#c8bca8', '#b9c4cf', '#e2d8c6', '#a7b3bd', '#cdb49b', '#9fb0c0'].map((c) => new THREE.Color(c));
    const q = new THREE.Quaternion();
    for (const t of towns) {
      const n = Math.round(t.r * t.r * 0.00045);
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2);
        const rr = Math.pow(rng.next(), 0.8) * t.r;
        const x = t.x + Math.cos(a) * rr, z = t.z + Math.sin(a) * rr;
        const h = m.heightAt(x, z);
        if (h < 1.2) continue;
        const slope = Math.abs(m.heightAt(x + 30, z) - m.heightAt(x - 30, z)) + Math.abs(m.heightAt(x, z + 30) - m.heightAt(x, z - 30));
        if (slope > 10) continue;
        const core = 1 - rr / t.r;
        const tall = t.tall * Math.pow(core, 2.2);
        const height = 6 + rng.next() * 8 + (rng.chance(tall) ? rng.range(20, 150) * tall : 0);
        const w = rng.range(12, 22) + height * 0.12, d = rng.range(12, 22) + height * 0.1;
        const y = this.terrain.surfaceY(x, z, false);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(rng.range(0, 3)) * (Math.PI / 2) + rng.range(-0.08, 0.08));
        mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 2, z), q, new THREE.Vector3(w, height * exag * 0.8 + 2, d)));
        cols.push(palette[Math.floor(rng.next() * palette.length)].clone().multiplyScalar(0.45 + rng.next() * 0.2));
      }
    }
    this.buildStreetLights(rng, towns);
    if (!mats.length) return;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const L = this.lighting;
    const mat = new THREE.ShaderMaterial({
      vertexShader: BUILDING_VERT,
      fragmentShader: BUILDING_FRAG,
      uniforms: {
        uSunDir: { value: L.sunDir },
        uSunColor: { value: L.sunColor },
        uSkyAmb: { value: L.skyAmb },
        uGroundAmb: { value: L.groundAmb },
        uWindow: { value: L.windows },
        uNight: { value: L.night },
        uExag: { value: exag * 0.8 },
        uFogColor: { value: L.fogColor },
        uFogSunColor: { value: L.fogSunColor },
        uFogDensity: { value: L.fogDensity },
        uFogHeight: { value: L.fogHeight },
      },
    });
    const inst = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((mm, k) => {
      inst.setMatrixAt(k, mm);
      inst.setColorAt(k, cols[k]);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.frustumCulled = false;
    this.towns = inst;
    this.scene.add(inst);
    // orbit around the main town
    if (towns[0]) this.center.set(towns[0].x, 0, towns[0].z);
    void this.center;
  }

  /** warm street-light sparkle along grid streets around each town */
  private buildStreetLights(rng: RNG, towns: { x: number; z: number; r: number; tall: number }[]): void {
    const m = this.model;
    const pos: number[] = [], size: number[] = [], color: number[] = [];
    const warm = new THREE.Color('#ffb05a'), white = new THREE.Color('#fff1d6'), blue = new THREE.Color('#bfe0ff');
    for (const t of towns) {
      const ang = rng.range(0, Math.PI);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const R = t.r * 1.35;
      const spacing = 70;
      for (let a = -R; a <= R; a += spacing * rng.range(1, 2.2)) {
        for (let b = -R; b <= R; b += 22) {
          for (const [u, v] of [[a, b], [b, a]]) {
            if (rng.next() < 0.35) continue;
            const x = t.x + u * ca - v * sa, z = t.z + u * sa + v * ca;
            const rr = Math.hypot(x - t.x, z - t.z);
            if (rr > R * (0.75 + 0.25 * rng.next())) continue;
            const h = m.heightAt(x, z);
            if (h < 1) continue;
            pos.push(x, this.terrain.surfaceY(x, z, false) + 6, z);
            size.push(rng.range(900, 1700) * (1.2 - (rr / R) * 0.5));
            const c = rng.next() < 0.7 ? warm : rng.next() < 0.7 ? white : blue;
            const k = rng.range(1.6, 3.2);
            color.push(c.r * k, c.g * k, c.b * k);
          }
        }
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(color, 3));
    this.lightsMat = new THREE.ShaderMaterial({
      vertexShader: LIGHTS_VERT,
      fragmentShader: LIGHTS_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 1 }, uTime: { value: 0 } },
    });
    this.lights = new THREE.Points(g, this.lightsMat);
    this.lights.frustumCulled = false;
    this.lights.renderOrder = 5;
    this.scene.add(this.lights);
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
    const dt = Math.min(0.1, t - this.lastT);
    this.lastT = t;
    this.angle += dt * 0.022;
    const m = this.model;
    const cx = THREE.MathUtils.lerp(m.sizeX / 2, this.center.x, 0.6);
    const cz = THREE.MathUtils.lerp(m.sizeZ / 2, this.center.z, 0.6);
    const r = this.radius + Math.sin(t * 0.045) * 500;
    const camX = cx + Math.cos(this.angle) * r, camZ = cz + Math.sin(this.angle) * r;
    const ground = this.terrain.surfaceY(camX, camZ);
    const alt = 880 + Math.sin(t * 0.06) * 90;
    this.camY = this.camY < 0 ? Math.max(ground + 420, alt) : THREE.MathUtils.lerp(this.camY, Math.max(ground + 420, alt), 0.02);
    this.camera.position.set(camX, this.camY, camZ);
    // look past the town centre, slightly ahead along the orbit
    const la = this.angle + Math.PI + 0.28;
    this.camera.lookAt(cx + Math.cos(la) * 2200, 40, cz + Math.sin(la) * 2200);
    this.skyMat.uniforms.uTime.value = t;
    if (this.lightsMat) {
      this.lightsMat.uniforms.uTime.value = t;
      this.lightsMat.uniforms.uScale.value = this.renderer.domElement.height / 900;
    }
    this.terrain.update(t);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    if (!this.framed) {
      this.framed = true;
      this.onFirstFrame?.();
    }
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.terrain.dispose();
    this.skyMat.dispose();
    this.sky.geometry.dispose();
    if (this.lights) {
      this.lights.geometry.dispose();
      this.lightsMat?.dispose();
    }
    if (this.towns) {
      this.towns.geometry.dispose();
      (this.towns.material as THREE.Material).dispose();
    }
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

/** true for software rasterizers (SwiftShader / llvmpipe): use cheaper settings */
export function isSoftwareGL(r: THREE.WebGLRenderer): boolean {
  try {
    const gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software|softpipe/i.test(name);
  } catch {
    return false;
  }
}
