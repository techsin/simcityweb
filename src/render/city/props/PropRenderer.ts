/**
 * PropRenderer — static network props in one BatchedMesh (streetlights, traffic lights, crossing gates, median trees,
 * power pylons), additive night light pools under streetlights (one InstancedMesh), grouped by key so road chunks /
 * power lines can be replaced independently.
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
  float a = pow(1.0 - d2, 2.2);
  gl_FragColor = vec4(vCol * a * uNight * uStrength, 1.0);
}`;

const GLOW_VERT = /* glsl */ `
attribute vec4 aGlow;
varying vec2 vUv;
varying float vTint;
void main() {
  vUv = uv * 2.0 - 1.0;
  vTint = aGlow.w;
  vec4 mv = modelViewMatrix * vec4(aGlow.xyz, 1.0);
  float dist = -mv.z;
  // grow slightly with distance so distant lamps still read as points of light
  float sz = 1.3 + dist * 0.0025;
  mv.xy += position.xy * sz;
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAG = /* glsl */ `
uniform float uNight;
varying vec2 vUv;
varying float vTint;
void main() {
  float d2 = dot(vUv, vUv);
  if (d2 > 1.0) discard;
  float core = exp(-d2 * 9.0);
  float halo = pow(1.0 - d2, 3.0) * 0.35;
  vec3 c = vTint > 0.5 ? vec3(0.85, 0.85, 0.75) : vec3(1.0, 0.72, 0.42);
  gl_FragColor = vec4(c * (core * 2.2 + halo) * uNight, 1.0);
}`;

export class PropRenderer {
  readonly batch: DynamicBatch;
  readonly pools: THREE.InstancedMesh;
  readonly glows: THREE.Mesh;
  private glowGeo: THREE.InstancedBufferGeometry;
  private glowCap = 4096;
  private groups = new Map<string, Group>();
  private tileIds: Set<number>[];
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

  constructor(private culler: TileCuller) {
    this.batch = new DynamicBatch(getCityMaterial(), 4096, 1 << 17, 'props');
    this.batch.mesh.castShadow = true;
    this.batch.mesh.receiveShadow = true;
    const T = culler.tiles * culler.tiles;
    this.tileIds = Array.from({ length: T }, () => new Set<number>());
    culler.onChange((tile, vis) => {
      for (const id of this.tileIds[tile]) this.batch.setVisible(id, vis);
    });
    const pg = new THREE.PlaneGeometry(2, 2);
    pg.rotateX(-Math.PI / 2);
    this.poolMat = new THREE.ShaderMaterial({
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      uniforms: { uNight: sharedUniforms.uNight, uStrength: { value: 0.55 } },
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
    return this.batch.geometryId(`${model}#${v}`, () => propGeometry(model, v));
  }

  setGroup(key: string, props: PropItem[], pools: PoolItem[] = []): void {
    const old = this.groups.get(key);
    if (old) {
      for (const id of old.ids) {
        this.batch.remove(id);
        const t = this.idTile.get(id);
        if (t !== undefined) this.tileIds[t].delete(id);
        this.idTile.delete(id);
      }
      if (old.pools.length) this.poolsDirty = true;
    }
    if (!props.length && !pools.length) {
      this.groups.delete(key);
      return;
    }
    const g: Group = { ids: [], tiles: [], pools };
    for (const p of props) {
      const gid = this.geom(p.model, p.variant);
      const id = this.batch.add(gid);
      this.q.setFromAxisAngle(this.up, p.yaw);
      this.m4.compose(this.v.set(p.x, p.y, p.z), this.q, this.s.set(p.scale, p.scale, p.scale));
      this.batch.setMatrix(id, this.m4);
      const tile = this.culler.tileOfWorld(p.x, p.z);
      this.tileIds[tile].add(id);
      this.idTile.set(id, tile);
      this.batch.setVisible(id, this.culler.vis[tile] === 1);
      g.ids.push(id);
    }
    if (pools.length) this.poolsDirty = true;
    this.groups.set(key, g);
  }

  update(): void {
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
        this.m4.makeScale(p.r, 1, p.r).setPosition(p.x, p.y, p.z);
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
