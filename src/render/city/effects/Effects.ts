/**
 * Effects — cheap GPU-animated particles (no per-frame CPU work): industrial / power plant smoke & steam plumes,
 * fire (additive flames + dark smoke) for burning buildings, construction dust. Emitters come from building
 * visuals; particle buffers are rebuilt only when emitters change. 2 draw calls.
 */
import * as THREE from 'three';
import { sharedUniforms } from '../../../assets/materials';
import * as industrialModule from '../../../assets/builders/industrial';
import * as utilityModule from '../../../assets/builders/utility';
import type { BuildingVisual } from '../buildings/BuildingRenderer';

type V3 = [number, number, number];

const SMOKY: Record<string, number> = {
  ind_smokestack_factory: 0, ind_refinery: 0, util_coal_plant: 0, util_oil_plant: 0, util_gas_plant: 5,
  util_incinerator: 0, util_nuclear_plant: 1, ind_assembly_plant: 5,
};
// kinds: 0 smoke, 1 steam, 2 flame, 3 fire smoke, 4 dust, 5 light exhaust

const VERT = /* glsl */ `
attribute vec4 aEmit;
attribute vec4 aP;
uniform float uTime;
uniform vec3 uWind;
varying vec2 vUv;
varying float vAlpha;
varying float vKind;
varying float vAge;
varying float vSeed;
void main() {
  float kind = aP.x; float life = aP.y; float size = aP.z; float phase = aP.w;
  float seed = aEmit.w;
  float age = fract(uTime / life + phase);
  float T = age * life;
  vec3 p = aEmit.xyz;
  float sz;
  float alpha;
  if (kind > 1.5 && kind < 2.5) {
    // flame: fast rise, shrink
    p.y += 5.0 * T;
    p.x += sin(seed * 31.0 + T * 7.0) * 0.6 * age;
    p.z += cos(seed * 17.0 + T * 6.0) * 0.6 * age;
    sz = size * (1.0 - 0.65 * age) * (0.8 + 0.4 * fract(seed * 7.3));
    alpha = smoothstep(0.0, 0.15, age) * (1.0 - age);
  } else if (kind > 3.5 && kind < 4.5) {
    // dust: low, slow spread
    p.y += 1.2 * T;
    p.xz += vec2(sin(seed * 12.0), cos(seed * 9.0)) * T * 1.2 + uWind.xz * T * 0.4;
    sz = size * (0.5 + 1.2 * age);
    alpha = smoothstep(0.0, 0.2, age) * (1.0 - age) * 0.35;
  } else {
    float riseV = kind > 0.5 && kind < 1.5 ? 3.2 : (kind > 2.5 && kind < 3.5 ? 4.5 : 2.6);
    p.y += riseV * T - 0.05 * T * T;
    vec2 turb = vec2(sin(seed * 23.0 + T * 0.9), cos(seed * 19.0 + T * 0.7)) * (0.6 + T * 0.35);
    p.xz += uWind.xz * T * (0.25 + age * 0.9) + turb;
    sz = size * (0.35 + 1.9 * age);
    float a0 = kind > 4.5 ? 0.25 : (kind > 2.5 && kind < 3.5 ? 0.75 : 0.55);
    alpha = smoothstep(0.0, 0.07, age) * pow(1.0 - age, 1.4) * a0;
  }
  vUv = uv;
  vAlpha = alpha;
  vKind = kind;
  vAge = age;
  vSeed = seed;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float ang = seed * 6.2831 + T * 0.15 * (fract(seed * 3.1) - 0.5);
  vec2 c = position.xy;
  if (kind > 1.5 && kind < 2.5) {
    // flames: upright, narrower tongues (a random spin made them read as round orbs)
    ang = (fract(seed * 3.1) - 0.5) * 0.5;
    c.x *= 0.62;
  }
  vec2 r = vec2(c.x * cos(ang) - c.y * sin(ang), c.x * sin(ang) + c.y * cos(ang));
  mv.xy += r * sz;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uNight;
uniform float uAdditive;
varying vec2 vUv;
varying float vAlpha;
varying float vKind;
varying float vAge;
varying float vSeed;
float ph(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float pn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ph(i), ph(i + vec2(1, 0)), f.x), mix(ph(i + vec2(0, 1)), ph(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float d = length(q);
  if (d > 1.0) discard;
  float n = pn(q * 2.2 + vSeed * 17.0) * 0.6 + pn(q * 4.7 - vSeed * 9.0) * 0.4;
  float m = smoothstep(1.0, 0.15, d + (n - 0.5) * 0.55);
  float a = m * vAlpha;
  vec3 col;
  float lit = mix(1.0, 0.12, uNight);
  if (vKind > 1.5 && vKind < 2.5) {
    // flame tongue: wide at the base, pointed at the top, flicker noise scrolling upward; yellow core -> deep orange
    // with age. Dimmer at night (exposure is higher and additive quads stacked past the bloom threshold into white orbs)
    float wy = mix(1.0, 0.3, clamp(q.y * 0.5 + 0.5, 0.0, 1.0));
    float fd = length(vec2(q.x / wy, q.y));
    float fn = pn(vec2(q.x * 2.4, q.y * 1.6 - vAge * 5.0) + vSeed * 13.0);
    float fm = smoothstep(1.0, 0.2, fd + (fn - 0.5) * 0.7) * vAlpha;
    col = mix(vec3(1.0, 0.72, 0.25), vec3(0.95, 0.22, 0.03), smoothstep(0.05, 0.7, vAge)) * mix(2.2, 0.9, uNight);
    gl_FragColor = vec4(col * fm * mix(1.0, 0.8, uNight), 1.0);
    return;
  } else if (vKind > 0.5 && vKind < 1.5) {
    col = vec3(0.92, 0.93, 0.95) * lit;
  } else if (vKind > 2.5 && vKind < 3.5) {
    col = mix(vec3(0.08, 0.07, 0.065), vec3(0.2, 0.19, 0.18), vAge) * mix(1.0, 0.6, uNight);
    col += vec3(0.45, 0.14, 0.02) * (1.0 - smoothstep(0.0, 0.35, vAge)) * mix(0.3, 1.0, uNight);
  } else if (vKind > 3.5 && vKind < 4.5) {
    col = vec3(0.6, 0.52, 0.4) * lit;
  } else if (vKind > 4.5) {
    col = vec3(0.78, 0.78, 0.8) * lit;
  } else {
    col = mix(vec3(0.42, 0.41, 0.4), vec3(0.7, 0.7, 0.71), vAge) * lit;
  }
  col *= 0.85 + 0.3 * n;
  gl_FragColor = vec4(col, a);
}`;

function parseEmitters(v: unknown, variant: number): V3[] | null {
  if (!v) return null;
  let x: unknown = v;
  if (typeof x === 'function') {
    try { x = (x as (n: number) => unknown)(variant); } catch { return null; }
  }
  if (!Array.isArray(x)) return null;
  if (x.length && Array.isArray(x[0]) && Array.isArray((x[0] as unknown[])[0])) {
    // per-variant list
    x = (x as unknown[][])[variant % x.length];
  } else if (x.length && Array.isArray(x[0]) && (x[0] as unknown[]).length && typeof (x[0] as unknown[])[0] === 'object' && !Array.isArray((x[0] as unknown[])[0])) {
    x = (x as unknown[][])[variant % x.length];
  }
  const out: V3[] = [];
  for (const p of x as unknown[]) {
    if (Array.isArray(p) && p.length >= 3 && typeof p[0] === 'number') out.push([p[0], p[1], p[2]]);
    else if (p && typeof p === 'object' && 'x' in (p as object)) {
      const q = p as { x: number; y: number; z: number };
      out.push([q.x, q.y, q.z]);
    }
  }
  return out.length ? out : null;
}

function exportedEmitters(model: string, variant: number, which: 'smokeEmitters' | 'steamEmitters'): V3[] | null {
  for (const mod of [industrialModule, utilityModule]) {
    const map = (mod as unknown as Record<string, unknown>)[which] as Record<string, unknown> | undefined;
    if (map && typeof map === 'object' && model in map) {
      const r = parseEmitters(map[model], variant);
      if (r) return r;
    }
  }
  return null;
}

function hasExported(model: string): boolean {
  for (const mod of [industrialModule, utilityModule]) {
    for (const k of ['smokeEmitters', 'steamEmitters']) {
      const map = (mod as unknown as Record<string, unknown>)[k] as Record<string, unknown> | undefined;
      if (map && typeof map === 'object' && model in map) return true;
    }
  }
  return false;
}

/** find stack tops: tallest narrow vertex clusters of the model */
const stackCache = new Map<string, V3[]>();
function findStacks(geo: THREE.BufferGeometry, key: string): V3[] {
  const c = stackCache.get(key);
  if (c) return c;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  let maxY = 0;
  for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
  const thr = maxY * 0.72;
  const cl = new Map<string, { x: number; z: number; y: number; n: number }>();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < thr) continue;
    const x = pos.getX(i), z = pos.getZ(i);
    const k = `${Math.round(x / 5)},${Math.round(z / 5)}`;
    const e = cl.get(k);
    if (e) { e.x += x; e.z += z; e.n++; e.y = Math.max(e.y, y); }
    else cl.set(k, { x, z, y, n: 1 });
  }
  let arr = [...cl.values()].map((e) => [e.x / e.n, e.y, e.z / e.n] as V3);
  arr.sort((a, b) => b[1] - a[1]);
  arr = arr.slice(0, 4);
  stackCache.set(key, arr);
  return arr;
}

export interface Emit { x: number; y: number; z: number; kind: number; size: number; count: number; life: number; }

export class Effects {
  readonly smoke: THREE.Mesh;
  readonly flames: THREE.Mesh;
  private emitters = new Map<number, Emit[]>();
  /** keyed transient emitter groups (disasters), with expiry time (s, effect clock) */
  private extras = new Map<string, { list: Emit[]; until: number }>();
  private clock = 0;
  private dirty = true;
  private smokeGeo: THREE.InstancedBufferGeometry;
  private flameGeo: THREE.InstancedBufferGeometry;
  private uniforms = { uTime: sharedUniforms.uTime, uNight: sharedUniforms.uNight, uWind: { value: new THREE.Vector3(1.6, 0, 0.7) }, uAdditive: { value: 0 } };
  maxSmoke = 7000;
  maxFlame = 3000;
  particleCount = 0;
  geometryOf: ((model: string, variant: number) => THREE.BufferGeometry) | null = null;

  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1);
    const mk = (additive: boolean) => {
      const g = new THREE.InstancedBufferGeometry();
      g.index = quad.index;
      g.setAttribute('position', quad.attributes.position);
      g.setAttribute('uv', quad.attributes.uv);
      const cap = additive ? this.maxFlame : this.maxSmoke;
      g.setAttribute('aEmit', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
      g.setAttribute('aP', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
      g.instanceCount = 0;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...this.uniforms, uAdditive: { value: additive ? 1 : 0 } },
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false;
      m.renderOrder = additive ? 6 : 5;
      return { g, m };
    };
    const s = mk(false), f = mk(true);
    this.smokeGeo = s.g; this.smoke = s.m; this.smoke.name = 'smoke';
    this.flameGeo = f.g; this.flames = f.m; this.flames.name = 'flames';
  }

  /** building visual changed (null = removed) */
  onBuilding(v: BuildingVisual | null, id: number): void {
    if (!v) {
      if (this.emitters.delete(id)) this.dirty = true;
      return;
    }
    const list: Emit[] = [];
    const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
    const toWorld = (lx: number, ly: number, lz: number): [number, number, number] => [v.cx + lx * c + lz * s, v.baseY + ly * v.sy, v.cz - lx * s + lz * c];
    const operating = !v.constructing && !v.abandoned && !v.burnt;
    if (operating && hasExported(v.model)) {
      const smoke = exportedEmitters(v.model, v.variant, 'smokeEmitters') ?? [];
      const steam = exportedEmitters(v.model, v.variant, 'steamEmitters') ?? [];
      const big = v.model === 'util_nuclear_plant';
      for (const p of steam) {
        const [x, y, z] = toWorld(p[0], p[1], p[2]);
        list.push({ x, y, z, kind: 1, size: big ? 24 : 9, count: big ? 26 : 14, life: big ? 16 : 9 });
      }
      for (const p of smoke) {
        if (steam.some((q) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) + Math.abs(q[2] - p[2]) < 0.6)) continue;
        const [x, y, z] = toWorld(p[0], p[1], p[2]);
        const tall = p[1] > 25;
        list.push({ x, y, z, kind: v.model === 'util_gas_plant' ? 5 : 0, size: tall ? 8 : 4.5, count: tall ? 18 : 10, life: tall ? 13 : 8 });
      }
    } else if (operating && v.model in SMOKY) {
      let pts: V3[] | null = null;
      if (this.geometryOf) pts = findStacks(this.geometryOf(v.model, v.variant), `${v.model}#${v.variant}`);
      const kind = SMOKY[v.model];
      for (const p of pts ?? []) {
        const [x, y, z] = toWorld(p[0], p[1], p[2]);
        if (kind === 1) list.push({ x, y: y - 2, z, kind: 1, size: 26, count: 26, life: 16 });
        else list.push({ x, y, z, kind, size: kind === 5 ? 5 : 8, count: 18, life: 13 });
      }
    }
    if (v.burning) {
      const bb = v.bounds;
      const top = Math.max(2, bb.max.y);
      const sx = (bb.max.x - bb.min.x) * 0.3, sz = (bb.max.z - bb.min.z) * 0.3;
      const cx = (bb.max.x + bb.min.x) / 2, cz = (bb.max.z + bb.min.z) / 2;
      const size = Math.min(10, 2 + Math.sqrt((bb.max.x - bb.min.x) * (bb.max.z - bb.min.z)) * 0.25);
      let h = (id * 2654435761) >>> 0;
      const rnd = () => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let k = 0; k < 5; k++) {
        const [x, y, z] = toWorld(cx + (rnd() * 2 - 1) * sx, top * (0.6 + 0.35 * rnd()), cz + (rnd() * 2 - 1) * sz);
        list.push({ x, y, z, kind: 2, size, count: 14, life: 1.1 + rnd() * 0.5 });
      }
      for (let k = 0; k < 3; k++) {
        const [x, y, z] = toWorld(cx + (rnd() * 2 - 1) * sx, top * 0.95, cz + (rnd() * 2 - 1) * sz);
        list.push({ x, y, z, kind: 3, size: size * 1.8, count: 16, life: 9 });
      }
    }
    if (v.constructing) {
      list.push({ x: v.cx, y: v.baseY + 0.5, z: v.cz, kind: 4, size: Math.min(14, 4 + v.sw * 0.25), count: 6, life: 7 });
    }
    const had = this.emitters.has(id);
    if (list.length) { this.emitters.set(id, list); this.dirty = true; }
    else if (had) { this.emitters.delete(id); this.dirty = true; }
  }

  clear(): void {
    this.emitters.clear();
    this.extras.clear();
    this.dirty = true;
  }

  /** add / replace a transient emitter group (null / empty list removes). ttl in seconds (Infinity = until removed) */
  setExtra(key: string, list: Emit[] | null, ttl = Infinity): void {
    if (!list || !list.length) {
      if (this.extras.delete(key)) this.dirty = true;
      return;
    }
    this.extras.set(key, { list, until: this.clock + ttl });
    this.dirty = true;
  }

  update(dt = 0): void {
    this.clock += dt;
    for (const [k, e] of this.extras) if (e.until < this.clock) { this.extras.delete(k); this.dirty = true; }
    if (!this.dirty) return;
    this.dirty = false;
    let ns = 0, nf = 0;
    const groups: Emit[][] = [...this.emitters.values()];
    for (const e of this.extras.values()) groups.push(e.list);
    for (const l of groups) for (const e of l) { if (e.kind === 2) nf += e.count; else ns += e.count; }
    ns = Math.min(ns, this.maxSmoke);
    nf = Math.min(nf, this.maxFlame);
    const aSE = this.smokeGeo.getAttribute('aEmit') as THREE.InstancedBufferAttribute;
    const aSP = this.smokeGeo.getAttribute('aP') as THREE.InstancedBufferAttribute;
    const aFE = this.flameGeo.getAttribute('aEmit') as THREE.InstancedBufferAttribute;
    const aFP = this.flameGeo.getAttribute('aP') as THREE.InstancedBufferAttribute;
    const sE = aSE.array as Float32Array, sP = aSP.array as Float32Array;
    const fE = aFE.array as Float32Array, fP = aFP.array as Float32Array;
    let is = 0, iF = 0;
    let h = 12345;
    const rnd = () => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const l of groups) {
      for (const e of l) {
        const flame = e.kind === 2;
        for (let k = 0; k < e.count; k++) {
          if (flame ? iF >= nf : is >= ns) break;
          const E = flame ? fE : sE, P = flame ? fP : sP;
          const o = (flame ? iF++ : is++) * 4;
          E[o] = e.x + (rnd() - 0.5) * 0.6; E[o + 1] = e.y; E[o + 2] = e.z + (rnd() - 0.5) * 0.6; E[o + 3] = rnd();
          P[o] = e.kind; P[o + 1] = e.life * (0.85 + 0.3 * rnd()); P[o + 2] = e.size; P[o + 3] = k / e.count + rnd() * 0.04;
        }
      }
    }
    aSE.needsUpdate = aSP.needsUpdate = aFE.needsUpdate = aFP.needsUpdate = true;
    this.smokeGeo.instanceCount = is;
    this.flameGeo.instanceCount = iF;
    this.smoke.visible = is > 0;
    this.flames.visible = iF > 0;
    this.particleCount = is + iF;
  }

  dispose(): void {
    this.smokeGeo.dispose();
    this.flameGeo.dispose();
    (this.smoke.material as THREE.Material).dispose();
    (this.flames.material as THREE.Material).dispose();
  }
}
