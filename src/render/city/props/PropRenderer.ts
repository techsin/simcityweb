/**
 * PropRenderer — static network props in one BatchedMesh (streetlights, traffic lights, crossing gates, median trees,
 * power pylons), additive night light pools under streetlights (one InstancedMesh), grouped by key so road chunks /
 * power lines can be replaced independently.
 *
 * Culling / LOD: per-pass draw lists (main view + shadow cascade 0; street / median trees also cascade 1, everything
 * else is thinner than a far-cascade texel). Instances sit in one of three tile sets per map tile (small hardware /
 * trees / pylons) so the batch skips whole classes per tile: hardware in the far cascade, small props of tiles beyond
 * `lodDistance` (disabled tiles, no per-instance work). Small props switch per instance: full model within `lodFull`,
 * a ~16-triangle proxy (propLod.ts) beyond (6% hysteresis; each prop is re-evaluated only when the camera travelled
 * far enough to carry it across the switch distance), and around `lodDistance` they thin out one by one (each prop
 * vanishes at its own hashed distance in 100-135% of lodDistance (whole tiles used to switch at
 * lodDistance from their nearest point: props up to a tile beyond it stayed), in the vertex shader, shadows alike), so a tile is
 * only disabled once all of its props are gone: no tile-sized bursts. Distances use the classic prop metric
 * sqrt(dx^2 + dz^2 + 0.8 camY^2) (camera height weighted down), per prop instead of per tile. Pylons (own batch, a child of the props batch mesh)
 * always draw the full model.
 */
import * as THREE from 'three';
import { getModelGeometry, hasModel } from '../../../assets/registry';
import { MANIFEST_BY_ID } from '../../../assets/manifest';
import { ModelBuilder } from '../../../assets/ModelBuilder';
import { Surf } from '../../../core/types';
import { sharedUniforms } from '../../../assets/materials';
import { DynamicBatch, type TileCuller } from '../common/batch';
import { getCityMaterial } from '../common/cityMaterial';
import type { PoolItem, PropItem } from '../roads/mesher';
import { lampUniforms } from '../roads/roadMaterial';
import { propLodGeometry } from './propLod';
import { SEASONAL_TREES, seasonalVariant, treeSeason } from '../../../assets/builders/nat_season';

/** stable per-tree random in [0, 1) from its world position (season swaps) */
function hash01(x: number, z: number): number {
  let h = (Math.floor(x * 4) * 73856093) ^ (Math.floor(z * 4) * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

interface Group {
  ids: number[];
  /** pylon instances (in PropRenderer.pylons) */
  big: number[];
  tiles: number[];
  pools: PoolItem[];
}

/** procedural stand-ins used when an asset builder has not registered the model (avoids magenta boxes) */
export function fallbackPropGeometry(id: string): THREE.BufferGeometry | null {
  const b = new ModelBuilder();
  if (id === 'streetlight') {
    b.paint(0x55595e, Surf.Metal).cylinder(0, 0, 0, 8.6, 0.12, 0.08, 6);
    b.beam([0, 8.4, 0], [-2.7, 8.6, 0], 0.1);
    b.paint(0x44484c, Surf.Metal).box(-3.1, 8.35, -0.22, -2.3, 8.6, 0.22);
    b.paint(0xfff0cc, Surf.Emissive).box(-3.0, 8.3, -0.16, -2.4, 8.36, 0.16, { top: null, bottom: {color: 0xfff0cc, surf: Surf.Emissive} });
  } else if (id === 'traffic_light') {
    b.paint(0x3c4044, Surf.Metal).cylinder(0, 0, 0, 5.2, 0.1, 0.09, 6);
    b.paint(0x2a2d30, Surf.Metal).box(-0.22, 3.2, -0.18, 0.22, 4.4, 0.12);
    b.paint(0xff3322, Surf.Emissive).box(-0.1, 4.05, 0.12, 0.1, 4.25, 0.16);
    b.paint(0xffaa22, Surf.Emissive).box(-0.1, 3.75, 0.12, 0.1, 3.95, 0.16);
    b.paint(0x33ff66, Surf.Emissive).box(-0.1, 3.45, 0.12, 0.1, 3.65, 0.16);
  } else if (id === 'util_power_pylon') {
    const H = 22;
    b.paint(0x8a8f94, Surf.Metal);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.beam([sx * 2.4, 0, sz * 2.4], [sx * 0.5, H, sz * 0.5], 0.18);
    for (let y = 3; y < H; y += 4) {
      const w = 2.4 - (1.9 * y) / H;
      b.beam([-w, y, -w], [w, y + 2, -w], 0.08).beam([w, y, w], [-w, y + 2, w], 0.08);
      b.beam([-w, y, w], [-w, y + 2, -w], 0.08).beam([w, y, -w], [w, y + 2, w], 0.08);
    }
    b.box(-6, 16.5, -0.25, 6, 17.0, 0.25).box(-4.5, 13.0, -0.25, 4.5, 13.5, 0.25).box(-0.3, H - 0.4, -0.3, 0.3, H + 0.6, 0.3);
    b.paint(0xb0a890, Surf.Plain);
    for (const x of [-5.6, 5.6]) b.box(x - 0.1, 15.6, -0.1, x + 0.1, 16.5, 0.1);
    for (const x of [-4.1, 4.1]) b.box(x - 0.1, 12.1, -0.1, x + 0.1, 13.0, 0.1);
  } else if (id === '__xing_gate') {
    b.paint(0x3a3d40, Surf.Metal).box(-0.12, 0, -0.12, 0.12, 1.3, 0.12);
    b.paint(0xd9d9d9, Surf.Metal).box(-0.2, 1.3, -0.25, 0.2, 1.55, 0.25);
    for (let k = 0; k < 6; k++) b.paint(k & 1 ? 0xeeeeee : 0xcc1111, Surf.Plain).box(-0.25 - k * 0.8, 1.08, -0.05, -0.25 - (k + 1) * 0.8, 1.2, 0.05);
    b.paint(0xff2211, Surf.Emissive).box(-0.08, 1.55, -0.08, 0.08, 1.7, 0.08);
    // crossbuck sign
    b.paint(0xf0f0f0, Surf.Plain).push().translate(0, 2.3, 0.14).rotateZ(Math.PI / 4).box(-0.7, -0.08, 0, 0.7, 0.08, 0.03).pop();
    b.push().translate(0, 2.3, 0.14).rotateZ(-Math.PI / 4).box(-0.7, -0.08, 0, 0.7, 0.08, 0.03).pop();
    b.paint(0x3a3d40, Surf.Metal).box(-0.05, 1.3, 0.1, 0.05, 2.6, 0.14);
  } else {
    return null;
  }
  const g = b.build();
  g.name = 'fallback:' + id;
  return g;
}

export function propGeometry(id: string, variant: number): THREE.BufferGeometry {
  if (!hasModel(id)) {
    const f = fallbackPropGeometry(id);
    if (f) return f;
  }
  return getModelGeometry(id, variant);
}

/** per-instance distance thinning of small props (vertex shader, main + depth): each prop vanishes at its own hashed
 *  distance in [uPropFade.x, uPropFade.y] (prop metric, see the file comment; pylons live in their own batch and never
 *  thin) */
const propFadeU = { uPropCam: { value: new THREE.Vector3() }, uPropFade: { value: new THREE.Vector2(1e9, 1e9) } };
function injectPropFade(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uPropCam = propFadeU.uPropCam;
  shader.uniforms.uPropFade = propFadeU.uPropFade;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uPropCam;\nuniform vec2 uPropFade;')
    .replace('#include <project_vertex>', `#include <project_vertex>
#ifdef USE_BATCHING
  {
    vec3 _pp = (modelMatrix * vec4(batchingMatrix[3].xyz, 1.0)).xyz;
    // stable per-prop random from its (cell-scale) position
    vec2 _pc = floor(_pp.xz * 4.0);
    float _ph = fract(sin(dot(mod(_pc, 4099.0), vec2(12.9898, 78.233))) * 43758.5453);
    vec3 _pd = vec3(_pp.x - uPropCam.x, uPropCam.y * 0.894427, _pp.z - uPropCam.z);
    if (length(_pd) > mix(uPropFade.x, uPropFade.y, _ph)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
#endif`);
}

/** LOD schedule of the per-instance proxy switch: camera travel (m) per bucket and ring size (see BuildingRenderer) */
const PLOD_BUCKETS = 4096;
/** camera travel in one frame that counts as a jump (every due prop is evaluated at once then) */
const PLOD_SLICE = 6000;

const POOL_VERT = /* glsl */ `
attribute vec3 poolColor;
varying vec2 vUv;
varying vec3 vCol;
varying float vDist;
void main() {
  vUv = uv * 2.0 - 1.0;
  vCol = poolColor;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
// (strength / distance fade: lampUniforms in roads/roadMaterial.ts, where the road shader's lit ribbon takes over)
const POOL_FRAG = /* glsl */ `
uniform float uNight;
uniform float uStrength;
uniform vec2 uPoolFade;
varying vec2 vUv;
varying vec3 vCol;
varying float vDist;
void main() {
  float d2 = dot(vUv, vUv);
  if (d2 > 1.0) discard;
  // soft gaussian pool with a faint brighter core, fading to exactly 0 at the rim
  float a = (exp(-d2 * 3.2) * 0.8 + exp(-d2 * 12.0) * 0.35) * (1.0 - d2);
  gl_FragColor = vec4(vCol * a * uNight * uStrength * (1.0 - smoothstep(uPoolFade.x, uPoolFade.y, vDist)), 1.0);
}`;

const GLOW_VERT = /* glsl */ `
attribute vec4 aGlow;
varying vec2 vUv;
varying float vTint;
varying float vDist;
void main() {
  vUv = uv * 2.0 - 1.0;
  vTint = aGlow.w;
  vec4 mv = modelViewMatrix * vec4(aGlow.xyz, 1.0);
  float dist = -mv.z;
  vDist = dist;
  // grow slightly with distance so distant lamps still read as points of light, but cap it (~6.3 m at most):
  // unclamped, far zoom turned every block outline into a lattice of 8-9 m white beads
  float sz = 1.3 + min(dist * 0.0025, 2.5);
  mv.xy += position.xy * sz;
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAG = /* glsl */ `
uniform float uNight;
uniform vec3 uGlowFade;
varying vec2 vUv;
varying float vTint;
varying float vDist;
void main() {
  float d2 = dot(vUv, vUv);
  if (d2 > 1.0) discard;
  float core = exp(-d2 * 9.0);
  float halo = pow(1.0 - d2, 3.0) * 0.35;
  // sodium amber heads (matching the amber pools; a x2.2 core clipped to white); cool white for highway lights
  vec3 c = vTint > 0.5 ? vec3(0.85, 0.85, 0.75) : vec3(1.0, 0.64, 0.32);
  // fade toward far zoom so the lamps become a warm glow instead of a bead lattice
  float far = mix(1.0, uGlowFade.z, smoothstep(uGlowFade.x, uGlowFade.y, vDist));
  gl_FragColor = vec4(c * (core * 1.4 + halo) * uNight * far, 1.0);
}`;

export class PropRenderer {
  readonly batch: DynamicBatch;
  /** power pylons: plain city material, no distance LOD / thinning (child of batch.mesh) */
  readonly pylons: DynamicBatch;
  readonly pools: THREE.InstancedMesh;
  readonly glows: THREE.Mesh;
  private glowGeo: THREE.InstancedBufferGeometry;
  private glowCap = 4096;
  private groups = new Map<string, Group>();

  /** per tile state of small props: 1 drawn (per-instance LOD / thinning), 0 disabled (all beyond lodDistance) */
  private near: Uint8Array;
  /** per instance (batch id): proxy-switch state (2 full, 1 proxy, 0 none: no proxy / pylon / removed), position,
   *  full / proxy geometry ids and LOD schedule bucket (>= 0 linked in that bucket, -1 queued now, -2 removed,
   *  -3 new, -4 unscheduled) */
  private ist = new Uint8Array(0);
  private ipos = new Float32Array(0);
  private igeo = new Int32Array(0);
  private idue = new Int32Array(0);
  private lodTravel = 0;
  private lodPos = new THREE.Vector3(NaN, NaN, NaN);
  private lodAt = 0;
  /** the schedule's ring of travel buckets as intrusive doubly linked lists (head id per ring slot, next / prev per
   *  instance): scheduling an evaluated prop costs a few typed-array writes (a fast pan evaluates thousands per frame;
   *  pushing into per-bucket JS arrays grew and copied their stores) */
  private lodHead = new Int32Array(PLOD_BUCKETS).fill(-1);
  private lnext = new Int32Array(0);
  private lprev = new Int32Array(0);
  private lodNow: number[] = [];
  private lodNowSpare: number[] = [];
  private lodFullAt = -1;
  /** props evaluated by the proxy schedule (stats) */
  lodEvals = 0;
  /** map tiles (culler.tiles^2); batch tile id = tile + T * class (0 hardware, 1 trees, 2 pylons) */
  private T: number;
  /** small props (street trees, lights, signals) are hidden beyond this camera distance (m) */
  lodDistance = 1400;
  /** ... and drawn with their full model within this distance (proxy in between) */
  lodFull = 560;
  /** full geometry id -> proxy geometry id (same id when the model has no proxy) */
  private lodMap = new Map<number, number>();
  /** instance id -> [full geometry id, proxy geometry id] */
  private poolsDirty = true;
  private poolCap = 4096;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private poolMat: THREE.ShaderMaterial;
  private propMat: THREE.MeshStandardMaterial;
  poolCount = 0;
  /** seasonal street / median trees: instance id -> model, base variant, per-tree random (see nat_season.ts) */
  private seasonal = new Map<number, { model: string; variant: number; r: number }>();
  private seasonVer = -1;

  constructor(private culler: TileCuller) {
    // the city material + per-instance distance thinning (own program; main and shadow depth)
    const city = getCityMaterial();
    const mat = city.clone();
    const cityCompile = city.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => { cityCompile.call(city, shader, renderer); injectPropFade(shader); };
    mat.customProgramCacheKey = () => city.customProgramCacheKey() + '|prop-fade-v1';
    this.propMat = mat;
    this.batch = new DynamicBatch(mat, 4096, 1 << 17, 'props');
    const depth = this.batch.mesh.customDepthMaterial!;
    depth.onBeforeCompile = (shader) => injectPropFade(shader);
    depth.customProgramCacheKey = () => 'prop-depth-fade-v1';
    this.batch.mesh.castShadow = true;
    this.batch.mesh.receiveShadow = true;
    // cascades per instance (setShadowCascades): trees into both, thin hardware into cascade 0 only; 3 tile sets
    const T = culler.tiles * culler.tiles;
    this.T = T;
    this.batch.enablePassCulling({ culler, shadowMask: 0b11, tileSets: 2, coarse: true });
    // pylons: the lattice is thinner than a far-cascade texel (cascade 0 / the single map only)
    this.pylons = new DynamicBatch(city, 256, 1 << 14, 'pylons');
    this.pylons.mesh.castShadow = true;
    this.pylons.mesh.receiveShadow = true;
    this.pylons.enablePassCulling({ culler, shadowMask: 0b01, coarse: true });
    this.batch.mesh.add(this.pylons.mesh);
    this.near = new Uint8Array(T).fill(1);
    const pg = new THREE.PlaneGeometry(2, 2);
    pg.rotateX(-Math.PI / 2);
    this.poolMat = new THREE.ShaderMaterial({
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      uniforms: { uNight: sharedUniforms.uLamps, uStrength: lampUniforms.uPoolStrength, uPoolFade: lampUniforms.uPoolFade },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
    });
    this.pools = this.makePools(pg, this.poolCap);
    // lamp head glow sprites (camera-facing quads)
    const q = new THREE.PlaneGeometry(1, 1);
    this.glowGeo = new THREE.InstancedBufferGeometry();
    this.glowGeo.index = q.index;
    this.glowGeo.setAttribute('position', q.attributes.position);
    this.glowGeo.setAttribute('uv', q.attributes.uv);
    this.glowGeo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(this.glowCap * 4), 4));
    this.glowGeo.instanceCount = 0;
    const gm = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { uNight: sharedUniforms.uLamps, uGlowFade: lampUniforms.uGlowFade },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.glows = new THREE.Mesh(this.glowGeo, gm);
    this.glows.frustumCulled = false;
    this.glows.renderOrder = 4;
    this.glows.name = 'lampGlows';
  }

  /** distance LOD for small props; call once per frame with the camera position (see the file comment) */
  updateLod(cam: THREE.Vector3): void {
    const c = this.culler;
    const T = c.tiles;
    const size = c.tileCells * c.cellSize;
    const hide = this.lodDistance, full = Math.min(this.lodFull, hide);
    // per-instance thinning band (shader); a tile is disabled only beyond it (its nearest point past the band's end),
    // i.e. once none of its props is left
    propFadeU.uPropCam.value.copy(cam);
    propFadeU.uPropFade.value.set(hide, hide * 1.35);
    for (let tz = 0; tz < T; tz++) {
      for (let tx = 0; tx < T; tx++) {
        const i = tz * T + tx;
        const dx = Math.max(0, Math.abs(cam.x - (tx + 0.5) * size) - size / 2);
        const dz = Math.max(0, Math.abs(cam.z - (tz + 0.5) * size) - size / 2);
        const d = Math.sqrt(dx * dx + dz * dz + cam.y * cam.y * 0.8);
        const cur = this.near[i];
        const n = d < hide * (cur ? 1.4 : 1.37) ? 1 : 0;
        if (n !== cur) {
          this.near[i] = n;
          this.batch.setTileEnabled(i, n > 0);
          this.batch.setTileEnabled(i + this.T, n > 0);
        }
      }
    }
    this.updateProxyLod(cam, full);
    const m = this.propMat, city = getCityMaterial();
    m.envMapIntensity = city.envMapIntensity; m.roughness = city.roughness; m.metalness = city.metalness;
  }

  /** per-instance proxy <-> full switch at `full` m (+-6%), scheduled by camera travel like the building LOD */
  private updateProxyLod(cam: THREE.Vector3, full: number): void {
    if (full !== this.lodFullAt) {
      // new switch distance: every prop with a proxy is due now
      this.lodFullAt = full;
      this.queueAllProxies();
    }
    const p = this.lodPos;
    const hop = p.x === p.x ? Math.hypot(cam.x - p.x, cam.y - p.y, cam.z - p.z) : 0;
    this.lodTravel += hop;
    p.copy(cam);
    const cur = Math.floor(this.lodTravel);
    if (cur - this.lodAt >= PLOD_BUCKETS - 2) {
      // a jump beyond the schedule horizon: everything is due (queueAllProxies unlinks every scheduled prop)
      this.queueAllProxies();
      this.lodHead.fill(-1);
      this.lodAt = cur + 1;
    }
    if (!this.lodNow.length && this.lodAt > cur) return;
    // smooth motion: bounded work per frame; a jump evaluates everything due at once
    let budget = hop > Math.max(150, cam.y * 0.5) ? Infinity : PLOD_SLICE;
    if (this.lodNow.length) {
      const q = this.lodNow;
      this.lodNow = this.lodNowSpare;
      this.lodNowSpare = q;
      let i = 0;
      for (; i < q.length && budget > 0; i++) {
        const id = q[i];
        if (this.idue[id] !== -1) continue;
        this.evalProxy(id, cam, cur);
        budget--;
      }
      for (; i < q.length; i++) this.lodNow.push(q[i]);
      q.length = 0;
    }
    const head = this.lodHead, next = this.lnext, due = this.idue;
    while (this.lodAt <= cur && budget > 0) {
      // detach the bucket's list, then evaluate it (evaluated props are linked into later buckets: never this slot
      // again, the schedule is capped one ring lap ahead)
      const slot = this.lodAt % PLOD_BUCKETS;
      let id = head[slot];
      head[slot] = -1;
      while (id >= 0) {
        const nx = next[id];
        if (due[id] === this.lodAt) {
          due[id] = -4;
          this.evalProxy(id, cam, cur);
          budget--;
        } else if (due[id] >= 0) this.linkProxy(id, due[id]); // (not expected: every entry of a ring slot is due)
        id = nx;
      }
      this.lodAt++;
    }
  }

  /** link a prop into the list of travel bucket b */
  private linkProxy(id: number, b: number): void {
    const head = this.lodHead, slot = b % PLOD_BUCKETS, h = head[slot];
    this.lprev[id] = -1;
    this.lnext[id] = h;
    if (h >= 0) this.lprev[h] = id;
    head[slot] = id;
    this.idue[id] = b;
  }

  /** take a scheduled prop out of its bucket list (-> -4 unscheduled) */
  private unlinkProxy(id: number): void {
    const b = this.idue[id];
    if (b < 0) return;
    const p = this.lprev[id], nx = this.lnext[id];
    if (p >= 0) this.lnext[p] = nx;
    else if (this.lodHead[b % PLOD_BUCKETS] === id) this.lodHead[b % PLOD_BUCKETS] = nx;
    if (nx >= 0) this.lprev[nx] = p;
    this.idue[id] = -4;
  }

  /** every prop with a proxy is due now */
  private queueAllProxies(): void {
    const st = this.ist;
    for (let id = 0; id < st.length; id++) if (st[id]) this.queueProxy(id);
  }

  private queueProxy(id: number): void {
    if (id >= this.idue.length || this.idue[id] === -2 || !this.ist[id]) return;
    if (this.idue[id] !== -1) { this.unlinkProxy(id); this.idue[id] = -1; this.lodNow.push(id); }
  }

  /** (the switch distance comes from lodFullAt, not an argument: a double argument is boxed when V8 does not inline
   *  the call, once per evaluated prop) */
  private evalProxy(id: number, cam: THREE.Vector3, cur: number): void {
    this.lodEvals++;
    const full = this.lodFullAt;
    // prop metric (changes by at most the camera travel: the schedule's slack stays valid)
    const o = id * 3, dx = this.ipos[o] - cam.x, dz = this.ipos[o + 2] - cam.z;
    const d = Math.sqrt(dx * dx + dz * dz + cam.y * cam.y * 0.8);
    const st = this.ist[id];
    const want = d < full * (st === 2 ? 1.06 : 0.94) ? 2 : 1;
    if (want !== st) {
      this.ist[id] = want;
      this.batch.setGeometry(id, this.igeo[id * 2 + (want === 2 ? 0 : 1)]);
    }
    const slack = want === 2 ? full * 1.06 - d : d - full * 0.94;
    const b = Math.min(this.lodAt + PLOD_BUCKETS - 1, Math.max(cur + 1, Math.floor(this.lodTravel + Math.max(0, slack))));
    this.linkProxy(id, b);
  }

  /** grow the per-instance LOD arrays to hold batch id `id` */
  private ensureInst(id: number): void {
    if (id < this.ist.length) return;
    const cap = Math.max(id + 1, this.ist.length * 2, 1024);
    const st = new Uint8Array(cap); st.set(this.ist); this.ist = st;
    const ps = new Float32Array(cap * 3); ps.set(this.ipos); this.ipos = ps;
    const gg = new Int32Array(cap * 2).fill(-1); gg.set(this.igeo); this.igeo = gg;
    const du = new Int32Array(cap).fill(-2); du.set(this.idue); this.idue = du;
    const ln = new Int32Array(cap).fill(-1); ln.set(this.lnext); this.lnext = ln;
    const lp = new Int32Array(cap).fill(-1); lp.set(this.lprev); this.lprev = lp;
  }

  /** glows are only worth drawing at night */
  updateNight(night: number): void {
    this.glows.visible = night > 0.05 && this.glowGeo.instanceCount > 0;
    this.pools.visible = night > 0.05 && this.pools.count > 0;
  }

  private makePools(geo: THREE.BufferGeometry, cap: number): THREE.InstancedMesh {
    const g = geo.clone();
    g.setAttribute('poolColor', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    const m = new THREE.InstancedMesh(g, this.poolMat, cap);
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.name = 'lightPools';
    return m;
  }

  private geom(model: string, variant: number): number {
    const e = MANIFEST_BY_ID[model];
    const nv = e?.variants ?? 1;
    const v = ((variant % nv) + nv) % nv;
    const key = `${model}#${v}`;
    if (model === 'util_power_pylon') return this.pylons.geometryId(key, () => propGeometry(model, v));
    const id = this.batch.geometryId(key, () => propGeometry(model, v));
    if (!this.lodMap.has(id)) {
      const lod = propLodGeometry(key, model, propGeometry(model, v));
      const lid = lod ? this.batch.geometryId(key + '#lod', () => lod) : id;
      // one culling sphere for model and proxy: LOD swaps only refresh the cached draw lists' ranges
      this.batch.shareSphere(id, lid);
      this.lodMap.set(id, lid);
    }
    return id;
  }

  setGroup(key: string, props: PropItem[], pools: PoolItem[] = []): void {
    const old = this.groups.get(key);
    if (old) {
      for (const id of old.big) this.pylons.remove(id);
      for (const id of old.ids) {
        this.batch.remove(id);
        this.seasonal.delete(id);
        if (id < this.ist.length) { this.unlinkProxy(id); this.ist[id] = 0; this.idue[id] = -2; }
      }
      if (old.pools.length) this.poolsDirty = true;
    }
    if (!props.length && !pools.length) {
      this.groups.delete(key);
      return;
    }
    const g: Group = { ids: [], big: [], tiles: [], pools };
    for (const p of props) {
      const seasonal = SEASONAL_TREES[p.model] !== undefined;
      const r = seasonal ? hash01(p.x, p.z) : 0;
      const gid = this.geom(p.model, seasonal ? seasonalVariant(p.model, p.variant, r, treeSeason.mix) : p.variant);
      this.q.setFromAxisAngle(this.up, p.yaw);
      this.m4.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(p.scale, p.scale, p.scale));
      const tile = this.culler.tileOfWorld(p.x, p.z);
      if (p.model === 'util_power_pylon') {
        const pid = this.pylons.add(gid);
        this.pylons.setMatrix(pid, this.m4);
        this.pylons.setTile(pid, tile);
        g.big.push(pid);
        continue;
      }
      const id = this.batch.add(gid);
      if (seasonal) this.seasonal.set(id, { model: p.model, variant: p.variant, r });
      this.batch.setMatrix(id, this.m4);
      const tree = p.model.startsWith('tree_') || p.model === 'bush';
      // street / median trees are big enough to shadow the far cascade too; poles, lamps, signals and gates are
      // thinner than a far-cascade texel and cast into cascade 0 (or the single map) only
      this.batch.setShadowCascades(id, tree ? 0b11 : 0b01);
      this.batch.setTile(id, tile + this.T * (tree ? 1 : 0));
      {
        const lod = this.lodMap.get(gid) ?? gid;
        if (lod !== gid) {
          // full model until the next updateLod evaluates it
          this.ensureInst(id);
          this.ist[id] = 2;
          this.ipos[id * 3] = p.x; this.ipos[id * 3 + 1] = p.y; this.ipos[id * 3 + 2] = p.z;
          this.igeo[id * 2] = gid; this.igeo[id * 2 + 1] = lod;
          this.idue[id] = -3;
          this.queueProxy(id);
        }
      }
      g.ids.push(id);
    }
    if (pools.length) this.poolsDirty = true;
    this.groups.set(key, g);
  }

  /** swap the seasonal tree instances to the current season's variants (autumn / bare / blossom / green) */
  private applySeason(): void {
    const mix = treeSeason.mix;
    for (const [id, t] of this.seasonal) {
      const gid = this.geom(t.model, seasonalVariant(t.model, t.variant, t.r, mix));
      const lod = this.lodMap.get(gid) ?? gid;
      this.ensureInst(id);
      const st = this.ist[id];
      if (lod !== gid) {
        this.igeo[id * 2] = gid; this.igeo[id * 2 + 1] = lod;
        if (!st) { this.ist[id] = 2; this.idue[id] = -3; this.queueProxy(id); }
      } else {
        // variant without a proxy: out of the schedule (a stale evaluation would swap in the old variant's geometry)
        this.unlinkProxy(id);
        this.ist[id] = 0;
        if (this.idue[id] === -1) this.idue[id] = -4;
      }
      this.batch.setGeometry(id, st === 1 && lod !== gid ? lod : gid);
    }
  }

  update(): void {
    if (this.seasonVer !== treeSeason.version) {
      this.seasonVer = treeSeason.version;
      this.applySeason();
    }
    if (!this.poolsDirty) return;
    this.poolsDirty = false;
    let total = 0;
    for (const g of this.groups.values()) total += g.pools.length;
    if (total > this.poolCap) {
      while (this.poolCap < total) this.poolCap *= 2;
      const old = this.pools;
      const parent = old.parent;
      const fresh = this.makePools(old.geometry, this.poolCap);
      if (parent) { parent.remove(old); parent.add(fresh); }
      old.dispose();
      (this as { pools: THREE.InstancedMesh }).pools = fresh;
    }
    const col = this.pools.geometry.getAttribute('poolColor') as THREE.InstancedBufferAttribute;
    const arr = col.array as Float32Array;
    let i = 0;
    for (const g of this.groups.values()) {
      for (const p of g.pools) {
        if (p.yaw !== undefined) {
          // stretched along the road (local x) so consecutive pools merge into a continuous warm ribbon
          this.q.setFromAxisAngle(this.up, p.yaw);
          this.m4.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(p.r * 1.35, 1, p.r * 0.8));
        } else this.m4.makeScale(p.r, 1, p.r).setPosition(p.x, p.y, p.z);
        this.pools.setMatrixAt(i, this.m4);
        if (p.tint === 1) { arr[i * 3] = 0.75; arr[i * 3 + 1] = 0.7; arr[i * 3 + 2] = 0.55; }
        else { arr[i * 3] = 1.0; arr[i * 3 + 1] = 0.62; arr[i * 3 + 2] = 0.3; }
        i++;
      }
    }
    this.pools.count = i;
    this.poolCount = i;
    this.pools.instanceMatrix.needsUpdate = true;
    col.needsUpdate = true;
    // glows
    if (total > this.glowCap) {
      while (this.glowCap < total) this.glowCap *= 2;
      this.glowGeo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(this.glowCap * 4), 4));
    }
    const ga = this.glowGeo.getAttribute('aGlow') as THREE.InstancedBufferAttribute;
    const garr = ga.array as Float32Array;
    let k = 0;
    for (const g of this.groups.values()) {
      for (const p of g.pools) {
        garr[k * 4] = p.hx; garr[k * 4 + 1] = p.hy; garr[k * 4 + 2] = p.hz; garr[k * 4 + 3] = p.tint;
        k++;
      }
    }
    ga.needsUpdate = true;
    this.glowGeo.instanceCount = k;
  }

  get propCount(): number {
    return this.batch.instanceCount + this.pylons.instanceCount;
  }

  clear(): void {
    for (const k of [...this.groups.keys()]) this.setGroup(k, [], []);
  }

  dispose(): void {
    this.batch.dispose();
    this.pylons.dispose();
    this.propMat.dispose();
    this.pools.dispose();
    this.poolMat.dispose();
    this.glowGeo.dispose();
    (this.glows.material as THREE.Material).dispose();
  }
}
