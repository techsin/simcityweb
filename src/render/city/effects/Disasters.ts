/**
 * Disasters — visuals for Simulation 'disaster' events { kind, x, z, active } (x/z in cells, may be fractional):
 *  - tornado: swirling translucent funnel + orbiting debris, smoothly following the reported position; fades out
 *    when active=false
 *  - earthquake: dust clouds rising from many lots while active
 *  - meteor: falling fireball streak, impact flash + expanding shock ring, then fire / smoke / dust at the crater
 *  - fire / other: smoke at the reported cell
 * Particles for dust / smoke use the shared Effects system (transient emitter groups).
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../../core/constants';
import type { CityState } from '../../../sim/CityState';
import { sharedUniforms } from '../../../assets/materials';
import type { RoadSurface } from '../common/surface';
import type { Effects, Emit } from './Effects';

const FUNNEL_VERT = /* glsl */ `
varying vec2 vUv;
varying float vY;
void main() {
  vUv = uv;
  vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FUNNEL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFade;
uniform float uNight;
uniform float uH;
varying vec2 vUv;
varying float vY;
float fh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float fn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fh(i), fh(i + vec2(1, 0)), f.x), mix(fh(i + vec2(0, 1)), fh(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float h = vY / uH;
  // swirl: the pattern slides around the funnel faster near the ground
  float sw = vUv.x * 7.0 + uTime * (1.6 - h * 0.9) + h * 5.0;
  float n = fn(vec2(sw, h * 9.0 - uTime * 1.3)) * 0.6 + fn(vec2(sw * 2.3, h * 21.0 - uTime * 2.1)) * 0.4;
  float a = smoothstep(0.25, 0.8, n) * 0.55 + 0.18;
  a *= smoothstep(0.0, 0.06, h) * (1.0 - smoothstep(0.75, 1.0, h));
  vec3 col = mix(vec3(0.32, 0.29, 0.25), vec3(0.55, 0.55, 0.57), h) * (0.75 + 0.35 * n) * mix(1.0, 0.18, uNight);
  gl_FragColor = vec4(col, a * uFade);
}`;

const DEBRIS_VERT = /* glsl */ `
attribute vec4 aD;
uniform float uTime;
varying vec2 vUv;
varying float vA;
void main() {
  float seed = aD.x, r = aD.y, hgt = aD.z, spd = aD.w;
  float ang = seed * 6.2831 + uTime * spd;
  float y = hgt * (0.5 + 0.5 * sin(uTime * 0.7 + seed * 11.0));
  vec3 p = vec3(cos(ang) * r, y, sin(ang) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float sz = 0.6 + fract(seed * 7.7) * 1.8;
  mv.xy += position.xy * sz;
  vUv = uv;
  vA = 1.0 - y / (hgt + 1.0) * 0.5;
  gl_Position = projectionMatrix * mv;
}`;
const DEBRIS_FRAG = /* glsl */ `
uniform float uFade;
uniform float uNight;
varying vec2 vUv;
varying float vA;
void main() {
  vec2 q = abs(vUv * 2.0 - 1.0);
  if (max(q.x, q.y) > 0.9) discard;
  gl_FragColor = vec4(vec3(0.2, 0.17, 0.13) * mix(1.0, 0.25, uNight), vA * uFade);
}`;

const FLASH_FRAG = /* glsl */ `
uniform float uA;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float d = length(vUv * 2.0 - 1.0);
  if (d > 1.0) discard;
  float a = pow(1.0 - d, 2.0) * uA;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;
const SPRITE_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}`;

interface Meteor {
  x: number;
  z: number;
  y0: number;
  t: number;
  group: THREE.Group;
  ball: THREE.Mesh;
  trail: THREE.Mesh;
  flash: THREE.Mesh;
  ring: THREE.Mesh;
  impacted: boolean;
}

export class Disasters {
  readonly group = new THREE.Group();
  private tornado: THREE.Group | null = null;
  private tornadoTarget = new THREE.Vector3();
  private tornadoFade = 0;
  private tornadoActive = false;
  private funnelMat: THREE.ShaderMaterial;
  private debrisMat: THREE.ShaderMaterial;
  private quakeT = 0;
  private dustTimer = 0;
  private quakeTimer = 0;
  private meteors: Meteor[] = [];
  private seq = 0;
  private time = 0;
  /** 0..1 current earthquake intensity (the camera owner may use it for shake) */
  shake = 0;

  constructor(private state: CityState, private surf: RoadSurface, private effects: Effects) {
    this.group.name = 'disasters';
    this.funnelMat = new THREE.ShaderMaterial({
      vertexShader: FUNNEL_VERT, fragmentShader: FUNNEL_FRAG,
      uniforms: { uTime: sharedUniforms.uTime, uFade: { value: 0 }, uNight: sharedUniforms.uNight, uH: { value: 220 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.debrisMat = new THREE.ShaderMaterial({
      vertexShader: DEBRIS_VERT, fragmentShader: DEBRIS_FRAG,
      uniforms: { uTime: sharedUniforms.uTime, uFade: { value: 0 }, uNight: sharedUniforms.uNight },
      transparent: true, depthWrite: false,
    });
  }

  setState(state: CityState, surf: RoadSurface): void {
    this.state = state;
    this.surf = surf;
  }

  onEvent(e: { kind: string; x: number; z: number; active: boolean }): void {
    // integer x/z = a cell (use its center); fractional = continuous position in cell units
    const wx = (Number.isInteger(e.x) ? e.x + 0.5 : e.x) * CELL_SIZE, wz = (Number.isInteger(e.z) ? e.z + 0.5 : e.z) * CELL_SIZE;
    const kind = e.kind.toLowerCase();
    if (kind.includes('tornado')) {
      if (e.active) {
        if (!this.tornado) this.tornado = this.makeTornado(wx, wz);
        this.tornadoTarget.set(wx, 0, wz);
        this.tornadoActive = true;
      } else this.tornadoActive = false;
    } else if (kind.includes('quake')) {
      this.quakeT = e.active ? 1 : 0;
      if (!e.active) this.effects.setExtra('quake', null);
    } else if (kind.includes('meteor')) {
      if (e.active) this.spawnMeteor(wx, wz);
    } else if (e.active) {
      // generic (fire, riot, ...): smoke column at the location
      const y = this.surf.terrain(wx, wz);
      this.effects.setExtra(`dis${this.seq++}`, [{ x: wx, y: y + 2, z: wz, kind: 3, size: 10, count: 18, life: 9 }], 25);
    }
  }

  private makeTornado(x: number, z: number): THREE.Group {
    const g = new THREE.Group();
    const H = 220;
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k <= 24; k++) {
      const h = k / 24;
      pts.push(new THREE.Vector2(3.5 + Math.pow(h, 1.8) * 46 + Math.sin(h * 9) * 1.5, h * H));
    }
    const funnel = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), this.funnelMat);
    funnel.renderOrder = 7;
    g.add(funnel);
    const inner = new THREE.Mesh(new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p.x * 0.7, p.y * 0.97)), 20), this.funnelMat);
    inner.renderOrder = 7;
    g.add(inner);
    // debris particles
    const q = new THREE.PlaneGeometry(1, 1);
    const dg = new THREE.InstancedBufferGeometry();
    dg.index = q.index;
    dg.setAttribute('position', q.attributes.position);
    dg.setAttribute('uv', q.attributes.uv);
    const n = 260;
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const r = 5 + Math.pow(Math.random(), 1.5) * 34;
      a[i * 4] = Math.random(); a[i * 4 + 1] = r; a[i * 4 + 2] = 4 + Math.random() * 45 * (r / 40); a[i * 4 + 3] = 3.2 - r * 0.05;
    }
    dg.setAttribute('aD', new THREE.InstancedBufferAttribute(a, 4));
    dg.instanceCount = n;
    const debris = new THREE.Mesh(dg, this.debrisMat);
    debris.frustumCulled = false;
    debris.renderOrder = 8;
    g.add(debris);
    g.position.set(x, this.surf.terrain(x, z), z);
    this.group.add(g);
    return g;
  }

  private spawnMeteor(x: number, z: number): void {
    const g = new THREE.Group();
    const y0 = 900;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.8) }));
    const trailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.0, 0.3), transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
    const trail = new THREE.Mesh(new THREE.ConeGeometry(6, 140, 10, 1, true), trailMat);
    trail.position.y = 70;
    const q = new THREE.PlaneGeometry(1, 1);
    const flash = new THREE.Mesh(q, new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT, fragmentShader: FLASH_FRAG, uniforms: { uA: { value: 0 }, uColor: { value: new THREE.Color(1.6, 1.0, 0.55) }, uSize: { value: 160 } },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    flash.frustumCulled = false;
    flash.visible = false;
    const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd8a0, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    ring.visible = false;
    g.add(ball, trail, flash, ring);
    this.group.add(g);
    const m: Meteor = { x, z, y0, t: 0, group: g, ball, trail, flash, ring, impacted: false };
    this.meteors.push(m);
    this.place(m);
  }

  private place(m: Meteor): void {
    const fall = 2.2;
    const f = Math.min(1, m.t / fall);
    const ground = this.surf.terrain(m.x, m.z);
    // slanted entry from the north-west
    const k = 1 - f;
    m.group.position.set(m.x - 500 * k, ground + (m.y0 - ground) * k, m.z - 300 * k);
    const dir = new THREE.Vector3(500, m.y0 - ground, 300).normalize();
    m.trail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    m.trail.position.copy(dir).multiplyScalar(70);
  }

  update(dt: number): void {
    this.time += dt;
    // tornado
    if (this.tornado) {
      const tg = this.tornado;
      this.tornadoFade += ((this.tornadoActive ? 1 : 0) - this.tornadoFade) * Math.min(1, dt * 1.5);
      const p = tg.position;
      const k = Math.min(1, dt * 0.8);
      p.x += (this.tornadoTarget.x - p.x) * k;
      p.z += (this.tornadoTarget.z - p.z) * k;
      p.y = this.surf.terrain(p.x, p.z);
      this.funnelMat.uniforms.uFade.value = this.tornadoFade;
      this.debrisMat.uniforms.uFade.value = this.tornadoFade;
      tg.rotation.z = Math.sin(this.time * 0.6) * 0.05;
      tg.rotation.x = Math.cos(this.time * 0.5) * 0.04;
      // dust at the base (re-emitted every 0.5 s as the funnel moves)
      this.dustTimer -= dt;
      if (this.dustTimer <= 0 && this.tornadoActive) {
        this.dustTimer = 0.5;
        this.effects.setExtra('tornado', [{ x: p.x, y: p.y + 1, z: p.z, kind: 4, size: 22, count: 16, life: 5 }], 3);
      }
      if (!this.tornadoActive && this.tornadoFade < 0.02) {
        this.group.remove(tg);
        tg.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
        this.tornado = null;
        this.effects.setExtra('tornado', null);
      }
    }
    // earthquake: rolling dust from random lots
    this.shake = this.quakeT;
    if (this.quakeT > 0) {
      this.quakeTimer -= dt;
      if (this.quakeTimer <= 0) {
        this.quakeTimer = 1.5;
        const st = this.state;
        const ids = [...st.buildings.keys()];
        const list: Emit[] = [];
        for (let i = 0; i < Math.min(40, ids.length); i++) {
          const b = st.buildings.get(ids[(Math.random() * ids.length) | 0])!;
          const x = (b.x + b.w / 2) * CELL_SIZE, z = (b.z + b.d / 2) * CELL_SIZE;
          list.push({ x, y: b.baseY + 1, z, kind: 4, size: 10 + b.w * 4, count: 5, life: 6 });
        }
        this.effects.setExtra('quake', list, 4);
      }
    }
    // meteors
    for (let i = 0; i < this.meteors.length; i++) {
      const m = this.meteors[i];
      m.t += dt;
      if (!m.impacted) {
        this.place(m);
        if (m.t >= 2.2) {
          m.impacted = true;
          m.ball.visible = false;
          m.trail.visible = false;
          m.flash.visible = true;
          m.ring.visible = true;
          const y = this.surf.terrain(m.x, m.z);
          m.group.position.set(m.x, y + 2, m.z);
          const key = `meteor${this.seq++}`;
          this.effects.setExtra(key, [
            { x: m.x, y: y + 1, z: m.z, kind: 3, size: 24, count: 30, life: 10 },
            { x: m.x, y: y + 1, z: m.z, kind: 2, size: 9, count: 24, life: 1.4 },
            { x: m.x, y: y + 0.5, z: m.z, kind: 4, size: 40, count: 20, life: 7 },
          ], 40);
        }
      } else {
        const ti = m.t - 2.2;
        (m.flash.material as THREE.ShaderMaterial).uniforms.uA.value = Math.max(0, 1 - ti / 1.2) * 2.5;
        const rr = 10 + ti * 140;
        m.ring.scale.set(rr, 1, rr);
        (m.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 - ti * 0.5);
        if (ti > 2) {
          this.group.remove(m.group);
          m.group.traverse((o) => {
            const mm = o as THREE.Mesh;
            if (mm.geometry) mm.geometry.dispose();
            if (mm.material) (mm.material as THREE.Material).dispose();
          });
          this.meteors.splice(i, 1);
          i--;
        }
      }
    }
  }

  dispose(): void {
    this.funnelMat.dispose();
    this.debrisMat.dispose();
    for (const m of this.meteors) this.group.remove(m.group);
  }
}
