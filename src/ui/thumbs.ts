/**
 * Renders small transparent-background thumbnails of building models (for toolbar flyouts / info cards) using the
 * procedural asset registry. Lazy: one private WebGL renderer, one thumbnail per animation frame, cached as data URLs.
 * Falls back silently (returns null) when the asset modules are missing or WebGL is unavailable.
 */
import * as THREE from 'three';

type Assets = {
  getModelGeometry: (id: string, variant?: number) => THREE.BufferGeometry;
  hasModel: (id: string) => boolean;
  getBuildingMaterial: () => THREE.Material;
  sharedUniforms?: { uNight: { value: number } };
};

const LAZY = import.meta.glob(['../assets/builders/index.ts', '../assets/registry.ts', '../assets/materials.ts']);

let assetsP: Promise<Assets | null> | null = null;
function assets(): Promise<Assets | null> {
  if (!assetsP)
    assetsP = (async () => {
      try {
        const [b, r, m] = (await Promise.all([LAZY['../assets/builders/index.ts']?.(), LAZY['../assets/registry.ts']?.(), LAZY['../assets/materials.ts']?.()])) as any[];
        if (!b || !r || !m) return null;
        b.registerAllModels?.();
        return { getModelGeometry: r.getModelGeometry, hasModel: r.hasModel, getBuildingMaterial: m.getBuildingMaterial, sharedUniforms: m.sharedUniforms };
      } catch (e) {
        console.warn('[thumbs] assets unavailable', e);
        return null;
      }
    })();
  return assetsP;
}

interface Job {
  key: string;
  model: string;
  footprint: [number, number];
  w: number;
  h: number;
  resolve: (url: string | null) => void;
}

class ThumbRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.5, 8000);
  private cache = new Map<string, string | null>();
  private pending = new Map<string, Promise<string | null>>();
  private queue: Job[] = [];
  private running = false;
  private failed = false;
  private idleTimer = 0;

  private init(): boolean {
    if (this.renderer) return true;
    if (this.failed) return false;
    try {
      const canvas = document.createElement('canvas');
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      // gradient sky environment (like the asset gallery)
      const env = new THREE.Scene();
      env.add(new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
        fragmentShader: 'varying vec3 vP; void main(){ float h=vP.y; vec3 top=vec3(0.32,0.52,0.85), hor=vec3(0.78,0.85,0.92), gr=vec3(0.32,0.30,0.27); vec3 c = h>0.0? mix(hor, top, pow(h,0.6)) : mix(hor, gr, pow(-h,0.4)); gl_FragColor=vec4(c*1.4,1.0);} ',
      })));
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pm.fromScene(env, 0.02).texture;
      this.scene.environmentIntensity = 0.9;
      const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
      sun.position.set(0.55, 0.9, 0.35);
      this.scene.add(sun, new THREE.HemisphereLight(0xbcd6ff, 0x5a5040, 0.55));
      return true;
    } catch (e) {
      console.warn('[thumbs] WebGL unavailable', e);
      this.failed = true;
      this.renderer = null;
      return false;
    }
  }

  get(model: string, footprint: [number, number], w = 188, h = 116): Promise<string | null> {
    const key = `${model}@${w}x${h}`;
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key)!);
    const p = this.pending.get(key);
    if (p) return p;
    const np = new Promise<string | null>((resolve) => {
      this.queue.push({ key, model, footprint, w, h, resolve });
      this.pump();
    });
    this.pending.set(key, np);
    return np;
  }

  cached(model: string, w = 188, h = 116): string | null | undefined {
    return this.cache.get(`${model}@${w}x${h}`);
  }

  private pump(): void {
    if (this.running) return;
    this.running = true;
    const step = async () => {
      const job = this.queue.shift();
      if (!job) {
        this.running = false;
        this.scheduleDispose();
        return;
      }
      let url: string | null = null;
      try {
        url = await this.render(job);
      } catch (e) {
        console.warn('[thumbs] render failed', job.model, e);
      }
      this.cache.set(job.key, url);
      this.pending.delete(job.key);
      job.resolve(url);
      requestAnimationFrame(() => void step());
    };
    requestAnimationFrame(() => void step());
  }

  private scheduleDispose(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      if (this.queue.length || !this.renderer) return;
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
      this.scene = new THREE.Scene();
    }, 15000);
  }

  private async render(job: Job): Promise<string | null> {
    const a = await assets();
    if (!a || !a.hasModel(job.model)) return null;
    if (!this.init()) return null;
    const r = this.renderer!;
    const geo = a.getModelGeometry(job.model, 0);
    const mesh = new THREE.Mesh(geo, a.getBuildingMaterial());
    this.scene.add(mesh);
    const night = a.sharedUniforms?.uNight;
    const prevNight = night?.value ?? 0;
    if (night) night.value = 0;
    geo.computeBoundingBox();
    const bb = geo.boundingBox!.clone();
    const fw = job.footprint[0] * 16, fd = job.footprint[1] * 16;
    bb.union(new THREE.Box3(new THREE.Vector3(-fw / 2, 0, -fd / 2), new THREE.Vector3(fw / 2, 0, fd / 2)));
    const sphere = bb.getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(0.85, 0.8, 1.25).normalize();
    const aspect = job.w / job.h;
    this.camera.aspect = aspect;
    const fov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const dist = (sphere.radius / Math.sin(Math.min(fov, Math.atan(Math.tan(fov) * aspect)))) * 0.92;
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.camera.lookAt(sphere.center);
    this.camera.near = Math.max(0.1, dist - sphere.radius * 3);
    this.camera.far = dist + sphere.radius * 4;
    this.camera.updateProjectionMatrix();
    r.setSize(job.w, job.h, false);
    r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL('image/png');
    this.scene.remove(mesh);
    if (night) night.value = prevNight;
    return url;
  }
}

export const thumbs = new ThumbRenderer();
