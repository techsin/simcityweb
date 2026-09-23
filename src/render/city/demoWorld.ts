/**
 * Minimal stand-in world for the render-city demo page (used when src/render/world/WorldView is not available):
 * renderer, gradient sky + PMREM environment, sun/moon with fitted shadows, hemisphere light, a simple terrain mesh
 * and a water plane. Not used by the game.
 */
import * as THREE from 'three';
import { CELL_SIZE, SEA_LEVEL } from '../../core/constants';
import type { CityState } from '../../sim/CityState';
import { sharedUniforms } from '../../assets/materials';

export class DemoWorld {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  terrain: THREE.Mesh;
  water: THREE.Mesh;
  target = new THREE.Vector3();
  distance = 300;
  yaw = 45;
  pitch = 45;
  hour = 14;

  constructor(canvas: HTMLCanvasElement, private state: CityState) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(1);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(35, 1, 2, 20000);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd6ff, 0x5a5040, 0.55);
    this.scene.add(this.hemi);
    this.terrain = this.buildTerrain();
    this.scene.add(this.terrain);
    const N = state.size;
    const wg = new THREE.PlaneGeometry(N * CELL_SIZE * 3, N * CELL_SIZE * 3);
    wg.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(
      wg,
      new THREE.MeshStandardMaterial({ color: 0x1d4a5e, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 }),
    );
    this.water.position.set((N * CELL_SIZE) / 2, SEA_LEVEL - 0.35, (N * CELL_SIZE) / 2);
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }

  private buildTerrain(): THREE.Mesh {
    const st = this.state;
    const N = st.size;
    const N1 = N + 1;
    const pos = new Float32Array(N1 * N1 * 3);
    const col = new Float32Array(N1 * N1 * 3);
    const c = new THREE.Color();
    for (let z = 0; z <= N; z++) {
      for (let x = 0; x <= N; x++) {
        const i = z * N1 + x;
        const h = st.heights[i];
        pos[i * 3] = x * CELL_SIZE; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z * CELL_SIZE;
        if (h < 0.4) c.setRGB(0.55, 0.5, 0.38, THREE.SRGBColorSpace);
        else if (h < 1.4) c.setRGB(0.7, 0.64, 0.48, THREE.SRGBColorSpace);
        else {
          const n = Math.sin(x * 0.37) * Math.cos(z * 0.29) * 0.5 + 0.5;
          c.setRGB(0.36 + 0.06 * n, 0.47 + 0.05 * n, 0.24, THREE.SRGBColorSpace);
        }
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
    }
    const idx: number[] = [];
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const a = z * N1 + x, b = a + 1, d = a + N1, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    m.receiveShadow = true;
    m.name = 'demoTerrain';
    return m;
  }

  refreshTerrain(): void {
    const g = this.terrain.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const N1 = this.state.size + 1;
    for (let i = 0; i < N1 * N1; i++) pos.setY(i, this.state.heights[i]);
    pos.needsUpdate = true;
    g.computeVertexNormals();
  }

  setEnvironment(): void {
    const night = sharedUniforms.uNight.value;
    const envScene = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { night: { value: night } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: `varying vec3 vP; uniform float night;
        void main(){ float h = vP.y;
          vec3 dayTop = vec3(0.32,0.52,0.85), dayHor = vec3(0.78,0.85,0.92), ground = vec3(0.32,0.30,0.27);
          vec3 nTop = vec3(0.01,0.015,0.04), nHor = vec3(0.05,0.06,0.1), nGround = vec3(0.01,0.01,0.012);
          vec3 top = mix(dayTop, nTop, night), hor = mix(dayHor, nHor, night), gr = mix(ground, nGround, night);
          vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.6)) : mix(hor, gr, pow(-h, 0.4));
          gl_FragColor = vec4(c * mix(1.4, 1.0, night), 1.0); }`,
    });
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat));
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.9, 0.18, night);
    const sky = new THREE.Color().lerpColors(new THREE.Color(0x9fb7cc), new THREE.Color(0x070b16), night);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 2500, 9000);
  }

  /** hour 0..24 -> sun position, light colors, uNight */
  setTime(hour: number): void {
    this.hour = hour;
    const ang = ((hour - 6) / 12) * Math.PI; // 6h sunrise, 18h sunset
    const elev = Math.sin(ang);
    const night = 1 - THREE.MathUtils.smoothstep(elev, -0.12, 0.18);
    sharedUniforms.uNight.value = night;
    const day = 1 - night;
    this.sun.color.setHSL(0.1, 0.5 * day + 0.2, 0.5 + 0.35 * day);
    if (night > 0.5) this.sun.color.set(0x9fb2ff);
    this.sun.intensity = night > 0.5 ? 0.35 : 2.8 * Math.max(0.25, elev) + 0.4;
    this.hemi.intensity = THREE.MathUtils.lerp(0.55, 0.12, night);
    this.hemi.color.set(night > 0.5 ? 0x334466 : 0xbcd6ff);
    this.hemi.groundColor.set(night > 0.5 ? 0x08080a : 0x5a5040);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(1.0, 1.25, night);
    this.setEnvironment();
  }

  updateCamera(): void {
    const yaw = THREE.MathUtils.degToRad(this.yaw), pitch = THREE.MathUtils.degToRad(this.pitch);
    const d = this.distance;
    const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(d);
    this.camera.position.copy(this.target).add(off);
    this.camera.near = Math.max(1, d * 0.01);
    this.camera.far = d * 30 + 5000;
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // sun direction (fixed azimuth from south-west), shadow box fitted around the target
    const ang = ((this.hour - 6) / 12) * Math.PI;
    let elev = Math.max(0.25, Math.sin(ang));
    if (sharedUniforms.uNight.value > 0.5) elev = 0.7;
    const az = Math.PI * 0.8 + ((this.hour - 12) / 12) * 1.2;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(Math.asin(elev)), elev, Math.sin(az) * Math.cos(Math.asin(elev))).normalize();
    const ext = Math.min(2200, d * 1.1 + 120);
    this.sun.position.copy(this.target).addScaledVector(dir, 3000);
    this.sun.target.position.copy(this.target);
    const cam = this.sun.shadow.camera;
    cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
    cam.near = 100; cam.far = 6000;
    cam.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
