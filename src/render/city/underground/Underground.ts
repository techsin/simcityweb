/**
 * Underground view: a full-screen dim overlay (drawn after the scene) plus subway tunnels drawn on top without
 * depth testing (glowing tubes with station-like junction nodes). Rebuilt on subwayChanged.
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../../core/constants';
import type { CityState } from '../../../sim/CityState';
import { DX, DZ, HALF } from '../common/netinfo';
import type { RoadSurface } from '../common/surface';

const DIM_VERT = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const DIM_FRAG = /* glsl */ `uniform float uAlpha; void main() { gl_FragColor = vec4(0.015, 0.03, 0.06, uAlpha); }`;

const TUN_VERT = /* glsl */ `
attribute float edge;
varying float vEdge;
void main() { vEdge = edge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TUN_FRAG = /* glsl */ `
uniform float uTime;
varying float vEdge;
void main() {
  float e = abs(vEdge);
  float core = 1.0 - smoothstep(0.0, 1.0, e);
  float rim = smoothstep(0.6, 0.95, e) * (1.0 - smoothstep(0.95, 1.0, e));
  vec3 c = mix(vec3(0.08, 0.35, 0.7), vec3(0.45, 0.85, 1.0), rim) + vec3(0.05, 0.12, 0.2) * core;
  gl_FragColor = vec4(c, 0.85);
}`;

export class Underground {
  readonly group = new THREE.Group();
  private dim: THREE.Mesh;
  private tunnels: THREE.Mesh;
  private dimMat: THREE.ShaderMaterial;
  active = false;

  constructor(private state: CityState, private surf: RoadSurface) {
    this.group.name = 'underground';
    const q = new THREE.PlaneGeometry(2, 2);
    this.dimMat = new THREE.ShaderMaterial({ vertexShader: DIM_VERT, fragmentShader: DIM_FRAG, uniforms: { uAlpha: { value: 0.8 } }, transparent: true, depthTest: false, depthWrite: false });
    this.dim = new THREE.Mesh(q, this.dimMat);
    this.dim.frustumCulled = false;
    this.dim.renderOrder = 1000;
    const tm = new THREE.ShaderMaterial({ vertexShader: TUN_VERT, fragmentShader: TUN_FRAG, uniforms: { uTime: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.tunnels = new THREE.Mesh(new THREE.BufferGeometry(), tm);
    this.tunnels.frustumCulled = false;
    this.tunnels.renderOrder = 1001;
    this.group.add(this.dim, this.tunnels);
    this.group.visible = false;
  }

  setState(state: CityState, surf: RoadSurface): void {
    this.state = state;
    this.surf = surf;
  }

  setActive(on: boolean): void {
    this.active = on;
    this.group.visible = on;
  }

  rebuild(): void {
    const st = this.state;
    const N = st.size;
    const sw = st.subway;
    const pos: number[] = [];
    const edge: number[] = [];
    const hw = 5.0;
    const has = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N && sw[z * N + x] === 1;
    const push = (x: number, z: number, e: number) => { pos.push(x, this.surf.terrain(x, z) + 0.8, z); edge.push(e); };
    const strip = (ax: number, az: number, bx: number, bz: number) => {
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
      const rx = (-dz / l) * hw, rz = (dx / l) * hw;
      push(ax - rx, az - rz, -1); push(bx - rx, bz - rz, -1); push(bx + rx, bz + rz, 1);
      push(ax - rx, az - rz, -1); push(bx + rx, bz + rz, 1); push(ax + rx, az + rz, 1);
    };
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        if (!sw[z * N + x]) continue;
        const ox = (x + 0.5) * CELL_SIZE, oz = (z + 0.5) * CELL_SIZE;
        let m = 0;
        for (let d = 0; d < 4; d++) if (has(x + DX[d], z + DZ[d])) m |= 1 << d;
        for (let d = 0; d < 4; d++) {
          if (!(m & (1 << d))) continue;
          strip(ox - DX[d] * hw * 0.0, oz - DZ[d] * hw * 0.0, ox + DX[d] * HALF, oz + DZ[d] * HALF);
        }
        const cnt = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
        if (cnt !== 2 || (m !== 5 && m !== 10)) {
          // junction / end node disk
          const seg = 12, r = cnt >= 3 || cnt <= 1 ? hw * 1.5 : hw;
          for (let k = 0; k < seg; k++) {
            const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
            push(ox, oz, 0); push(ox + Math.cos(a0) * r, oz + Math.sin(a0) * r, 1); push(ox + Math.cos(a1) * r, oz + Math.sin(a1) * r, 1);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
    this.tunnels.geometry.dispose();
    this.tunnels.geometry = g;
  }

  dispose(): void {
    this.tunnels.geometry.dispose();
    (this.tunnels.material as THREE.Material).dispose();
    this.dimMat.dispose();
  }
}
