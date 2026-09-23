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
import { BUILDING_FRAG, BUILDING_VERT, SKY_FRAG, SKY_VERT } from './shaders';

export interface MenuBackgroundOptions {
  seed?: number;
  preset?: RegionPresetId;
  quality?: 'low' | 'medium' | 'high' | 'ultra';
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
  private raf = 0;
  private t0 = performance.now();
  private angle = 0;
  private center = new THREE.Vector3();
  private radius = 6500;
  private disposed = false;
  private onResize = () => this.resize();
  /** called once after the first frame has been rendered */
  onFirstFrame?: () => void;
  private framed = false;

  constructor(private container: HTMLElement, opts: MenuBackgroundOptions = {}) {
    const seed = opts.seed ?? 20240;
    const preset = opts.preset ?? 'azure-coast';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.quality === 'low' ? 1 : 1.5));
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
        uTime: { value: 0 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    this.buildTowns(seed);

    this.center.set(this.model.sizeX / 2, 0, this.model.sizeZ / 2);
    this.angle = 2.4;
    if (opts.quality !== 'low') {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.65, 0.82));
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
        cols.push(palette[Math.floor(rng.next() * palette.length)].clone().multiplyScalar(0.8 + rng.next() * 0.3));
      }
    }
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

  start(): void {
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  private frame(): void {
    const t = (performance.now() - this.t0) / 1000;
    this.angle += 0.0009;
    const m = this.model;
    const cx = THREE.MathUtils.lerp(m.sizeX / 2, this.center.x, 0.55);
    const cz = THREE.MathUtils.lerp(m.sizeZ / 2, this.center.z, 0.55);
    const r = this.radius + Math.sin(t * 0.05) * 600;
    const camX = cx + Math.cos(this.angle) * r, camZ = cz + Math.sin(this.angle) * r;
    const ground = this.terrain.surfaceY(camX, camZ);
    this.camera.position.set(camX, Math.max(ground + 500, 1250 + Math.sin(t * 0.07) * 120), camZ);
    this.camera.lookAt(cx + Math.cos(this.angle + 0.5) * 300, 60, cz + Math.sin(this.angle + 0.5) * 300);
    this.skyMat.uniforms.uTime.value = t;
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
