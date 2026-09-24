/**
 * PropRenderer — static network props in one BatchedMesh (streetlights, traffic lights, crossing gates, median trees,
 * power pylons), additive night light pools under streetlights (one InstancedMesh), grouped by key so road chunks /
 * power lines can be replaced independently.
 *
 * Culling / LOD: per-pass draw lists (main view + shadow cascade 0; street / median trees also cascade 1, everything
 * else is thinner than a far-cascade texel),
 * and a per-tile distance LOD for small props: full model within `lodFull`, a ~16-triangle proxy (propLod.ts) up to
 * `lodDistance`, hidden beyond. Pylons always draw the full model.
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

const POOL_VERT = /* glsl */ `
attribute vec3 poolColor;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vUv = uv * 2.0 - 1.0;
  vCol = poolColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const POOL_FRAG = /* glsl */ `
uniform float uNight;
uniform float uStrength;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  float d2 = dot(vUv, vUv);
  if (d2 > 1.0) discard;
  // soft gaussian pool with a faint brighter core, fading to exactly 0 at the rim
  float a = (exp(-d2 * 3.2) * 0.8 + exp(-d2 * 12.0) * 0.35) * (1.0 - d2);
  gl_FragColor = vec4(vCol * a * uNight * uStrength, 1.0);
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
  float far = mix(1.0, 0.4, smoothstep(1500.0, 4500.0, vDist));
  gl_FragColor = vec4(c * (core * 1.4 + halo) * uNight * far, 1.0);
}`;

export class PropRenderer {
  readonly batch: DynamicBatch;
  readonly pools: THREE.InstancedMesh;
  readonly glows: THREE.Mesh;
  private glowGeo: THREE.InstancedBufferGeometry;
  private glowCap = 4096;
  private groups = new Map<string, Group>();
  private tileIds: Set<number>[];
  /** big props (pylons) ignore the distance LOD */
  private tileBig: Set<number>[];
  /** per tile LOD state of small props: 0 hidden, 1 proxy, 2 full */
  private near: Uint8Array;
  /** small props (street trees, lights, signals) are hidden beyond this camera distance (m) */
  lodDistance = 1400;
  /** ... and drawn with their full model within this distance (proxy in between) */
  lodFull = 560;
  /** full geometry id -> proxy geometry id (same id when the model has no proxy) */
  private lodMap = new Map<number, number>();
  /** instance id -> [full geometry id, proxy geometry id] */
  private idGeo = new Map<number, [number, number]>();
  private idTile = new Map<number, number>();
  private poolsDirty = true;
  private poolCap = 4096;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private poolMat: THREE.ShaderMaterial;
  poolCount = 0;
  /** seasonal street / median trees: instance id -> model, base variant, per-tree random (see nat_season.ts) */
  private seasonal = new Map<number, { model: string; variant: number; r: number }>();
  private seasonVer = -1;

  constructor(private culler: TileCuller) {
    this.batch = new DynamicBatch(getCityMaterial(), 4096, 1 << 17, 'props');
    this.batch.mesh.castShadow = true;
    this.batch.mesh.receiveShadow = true;
    // cascades per instance (setShadowCascades): trees into both, thin hardware into cascade 0 only
    this.batch.enablePassCulling({ culler, shadowMask: 0b11 });
    const T = culler.tiles * culler.tiles;
    this.tileIds = Array.from({ length: T }, () => new Set<number>());
    this.tileBig = Array.from({ length: T }, () => new Set<number>());
    this.near = new Uint8Array(T).fill(2);
    const pg = new THREE.PlaneGeometry(2, 2);
    pg.rotateX(-Math.PI / 2);
    this.poolMat = new THREE.ShaderMaterial({
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      uniforms: { uNight: sharedUniforms.uNight, uStrength: { value: 0.16 } },
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
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { uNight: sharedUniforms.uNight },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.glows = new THREE.Mesh(this.glowGeo, gm);
    this.glows.frustumCulled = false;
    this.glows.renderOrder = 4;
    this.glows.name = 'lampGlows';
  }

  /** distance LOD for small props (per tile, with 6% hysteresis); call once per frame with the camera position */
  updateLod(cam: THREE.Vector3): void {
    const c = this.culler;
    const T = c.tiles;
    const size = c.tileCells * c.cellSize;
    const hide = this.lodDistance, full = Math.min(this.lodFull, hide);
    for (let tz = 0; tz < T; tz++) {
      for (let tx = 0; tx < T; tx++) {
        const i = tz * T + tx;
        const dx = Math.max(0, Math.abs(cam.x - (tx + 0.5) * size) - size / 2);
        const dz = Math.max(0, Math.abs(cam.z - (tz + 0.5) * size) - size / 2);
        const d = Math.sqrt(dx * dx + dz * dz + cam.y * cam.y * 0.8);
        const cur = this.near[i];
        const h = hide * (cur >= 1 ? 1.03 : 0.97), f = full * (cur === 2 ? 1.06 : 0.94);
        const n = d < f ? 2 : d < h ? 1 : 0;
        if (n !== cur) {
          this.near[i] = n;
          for (const id of this.tileIds[i]) this.applyLod(id, n);
        }
      }
    }
  }

  private applyLod(id: number, state: number): void {
    this.batch.setVisible(id, state > 0);
    const g = this.idGeo.get(id);
    if (g && state > 0) this.batch.setGeometry(id, state === 2 ? g[0] : g[1]);
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
    const id = this.batch.geometryId(key, () => propGeometry(model, v));
    if (!this.lodMap.has(id)) {
      const lod = propLodGeometry(key, model, propGeometry(model, v));
      this.lodMap.set(id, lod ? this.batch.geometryId(key + '#lod', () => lod) : id);
    }
    return id;
  }

  setGroup(key: string, props: PropItem[], pools: PoolItem[] = []): void {
    const old = this.groups.get(key);
    if (old) {
      for (const id of old.ids) {
        this.batch.remove(id);
        const t = this.idTile.get(id);
        if (t !== undefined) { this.tileIds[t].delete(id); this.tileBig[t].delete(id); }
        this.idTile.delete(id);
        this.idGeo.delete(id);
        this.seasonal.delete(id);
      }
      if (old.pools.length) this.poolsDirty = true;
    }
    if (!props.length && !pools.length) {
      this.groups.delete(key);
      return;
    }
    const g: Group = { ids: [], tiles: [], pools };
    for (const p of props) {
      const seasonal = SEASONAL_TREES[p.model] !== undefined;
      const r = seasonal ? hash01(p.x, p.z) : 0;
      const gid = this.geom(p.model, seasonal ? seasonalVariant(p.model, p.variant, r, treeSeason.mix) : p.variant);
      const id = this.batch.add(gid);
      if (seasonal) this.seasonal.set(id, { model: p.model, variant: p.variant, r });
      this.q.setFromAxisAngle(this.up, p.yaw);
      this.m4.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(p.scale, p.scale, p.scale));
      this.batch.setMatrix(id, this.m4);
      const tile = this.culler.tileOfWorld(p.x, p.z);
      const big = p.model === 'util_power_pylon';
      (big ? this.tileBig : this.tileIds)[tile].add(id);
      this.idTile.set(id, tile);
      this.batch.setTile(id, tile);
      // street / median trees are big enough to shadow the far cascade too; poles, lamps, signals, gates and the
      // pylon lattice are thinner than a far-cascade texel and cast into cascade 0 (or the single map) only
      this.batch.setShadowCascades(id, p.model.startsWith('tree_') || p.model === 'bush' ? 0b11 : 0b01);
      if (!big) {
        const lod = this.lodMap.get(gid) ?? gid;
        if (lod !== gid) this.idGeo.set(id, [gid, lod]);
        this.applyLod(id, this.near[tile]);
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
      if (lod !== gid) this.idGeo.set(id, [gid, lod]);
      else this.idGeo.delete(id);
      const tile = this.idTile.get(id);
      const st = tile === undefined ? 2 : this.near[tile];
      this.batch.setGeometry(id, st === 1 ? lod : gid);
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
    return this.batch.instanceCount;
  }

  clear(): void {
    for (const k of [...this.groups.keys()]) this.setGroup(k, [], []);
  }

  dispose(): void {
    this.batch.dispose();
    this.pools.dispose();
    this.poolMat.dispose();
    this.glowGeo.dispose();
    (this.glows.material as THREE.Material).dispose();
  }
}
