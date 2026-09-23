/**
 * PowerLines — pylons ('util_power_pylon', arms along model X) along power line cells (every other cell on straights,
 * always at corners / junctions / ends; skipped on straight road/rail cells so the span passes over) plus sagging
 * catenary wires between matching attach points (one LineSegments draw).
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../../core/constants';
import type { CityState } from '../../../sim/CityState';
import * as utilityModule from '../../../assets/builders/utility';
import { DX, DZ } from '../common/netinfo';
import type { RoadSurface } from '../common/surface';
import type { PropItem } from '../roads/mesher';
import { propGeometry } from './PropRenderer';

type V3 = [number, number, number];

function parseAttach(v: unknown): V3[] | null {
  if (!v) return null;
  let arr: unknown = v;
  if (typeof v === 'function') {
    try { arr = (v as (n: number) => unknown)(0); } catch { return null; }
  }
  if (!Array.isArray(arr)) {
    if (typeof arr === 'object' && arr) {
      const o = arr as Record<string, unknown>;
      arr = o['util_power_pylon'] ?? o['0'] ?? Object.values(o)[0];
      if (!Array.isArray(arr)) return null;
    } else return null;
  }
  const out: V3[] = [];
  for (const p of arr as unknown[]) {
    if (Array.isArray(p) && p.length >= 3 && p.every((n) => typeof n === 'number')) out.push([p[0], p[1], p[2]]);
    else if (p && typeof p === 'object' && 'x' in (p as object)) {
      const q = p as { x: number; y: number; z: number };
      out.push([q.x, q.y, q.z]);
    } else if (Array.isArray(p)) {
      // nested per-variant list
      const inner = parseAttach(p);
      if (inner) return inner;
    }
  }
  return out.length ? out : null;
}

export class PowerLines {
  readonly wires: THREE.LineSegments;
  private attach: V3[];
  pylonCount = 0;

  constructor(private state: CityState, private surf: RoadSurface) {
    const exported = parseAttach((utilityModule as unknown as Record<string, unknown>)['pylonWireAttach']);
    if (exported) this.attach = exported;
    else {
      const g = propGeometry('util_power_pylon', 0);
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox!;
      const H = bb.max.y, X = Math.max(-bb.min.x, bb.max.x);
      this.attach = [
        [-X * 0.93, H * 0.72, 0], [X * 0.93, H * 0.72, 0],
        [-X * 0.72, H * 0.56, 0], [X * 0.72, H * 0.56, 0],
        [0, H * 0.99, 0],
      ];
    }
    const mat = new THREE.LineBasicMaterial({ color: 0x1c1d20, transparent: true, opacity: 0.85 });
    this.wires = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
    this.wires.name = 'powerWires';
    this.wires.frustumCulled = false;
  }

  setState(state: CityState, surf: RoadSurface): void {
    this.state = state;
    this.surf = surf;
  }

  /** recompute everything; returns pylon props */
  rebuild(): PropItem[] {
    const st = this.state;
    const N = st.size;
    const pl = st.powerLines;
    const net = st.network;
    const has = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N && pl[z * N + x] === 1;
    const maskAt = (x: number, z: number) => {
      let m = 0;
      for (let d = 0; d < 4; d++) if (has(x + DX[d], z + DZ[d])) m |= 1 << d;
      return m;
    };
    const isPylon = new Uint8Array(N * N);
    const yawOf = new Float32Array(N * N);
    const props: PropItem[] = [];
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        if (!pl[i]) continue;
        const m = maskAt(x, z);
        let pylon = false, yaw = 0;
        if (m === 5 || m === 1 || m === 4) {
          pylon = x % 2 === 0 && !net[i];
          yaw = Math.PI / 2;
          if (m !== 5) pylon = true;
        } else if (m === 10 || m === 2 || m === 8) {
          pylon = z % 2 === 0 && !net[i];
          yaw = 0;
          if (m !== 10) pylon = true;
        } else {
          pylon = true;
          if (m === 3 || m === 12) yaw = Math.PI / 4;
          else if (m === 6 || m === 9) yaw = -Math.PI / 4;
          else yaw = 0;
        }
        if (!pylon) continue;
        isPylon[i] = 1;
        yawOf[i] = yaw;
        const wx = (x + 0.5) * CELL_SIZE, wz = (z + 0.5) * CELL_SIZE;
        props.push({ model: 'util_power_pylon', variant: 0, x: wx, y: this.surf.terrain(wx, wz), z: wz, yaw, scale: 1 });
      }
    }
    this.pylonCount = props.length;
    // wires
    const pts: number[] = [];
    const tmpA: V3[] = [], tmpB: V3[] = [];
    const world = (x: number, z: number, yaw: number, out: V3[]) => {
      out.length = 0;
      const wx = (x + 0.5) * CELL_SIZE, wz = (z + 0.5) * CELL_SIZE, wy = this.surf.terrain(wx, wz);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (const [ax, ay, az] of this.attach) out.push([wx + ax * c + az * s, wy + ay, wz - ax * s + az * c]);
    };
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        if (!isPylon[i]) continue;
        for (const d of [0, 1]) {
          let k = 1;
          let found = -1;
          while (k < 16) {
            const nx = x + DX[d] * k, nz = z + DZ[d] * k;
            if (!has(nx, nz)) break;
            if (isPylon[nz * N + nx]) { found = nz * N + nx; break; }
            k++;
          }
          if (found < 0) continue;
          const bx = found % N, bz = (found / N) | 0;
          world(x, z, yawOf[i], tmpA);
          world(bx, bz, yawOf[found], tmpB);
          // pair attach points by lateral order relative to the span
          const lx = -DZ[d], lz = DX[d];
          const ca = (x + 0.5) * CELL_SIZE, cza = (z + 0.5) * CELL_SIZE, cb = (bx + 0.5) * CELL_SIZE, czb = (bz + 0.5) * CELL_SIZE;
          const sortA = tmpA.map((p, j) => ({ j, lat: (p[0] - ca) * lx + (p[2] - cza) * lz, y: p[1] })).sort((a, b) => a.lat - b.lat || a.y - b.y);
          const sortB = tmpB.map((p, j) => ({ j, lat: (p[0] - cb) * lx + (p[2] - czb) * lz, y: p[1] })).sort((a, b) => a.lat - b.lat || a.y - b.y);
          for (let w = 0; w < Math.min(sortA.length, sortB.length); w++) {
            const A = tmpA[sortA[w].j], B = tmpB[sortB[w].j];
            const L = Math.hypot(B[0] - A[0], B[2] - A[2]);
            const sag = 0.025 * L + 0.35;
            const segs = 10;
            let px = A[0], py = A[1], pz = A[2];
            for (let sgm = 1; sgm <= segs; sgm++) {
              const t = sgm / segs;
              const qx = A[0] + (B[0] - A[0]) * t, qz = A[2] + (B[2] - A[2]) * t;
              const qy = A[1] + (B[1] - A[1]) * t - sag * 4 * t * (1 - t);
              pts.push(px, py, pz, qx, qy, qz);
              px = qx; py = qy; pz = qz;
            }
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.wires.geometry.dispose();
    this.wires.geometry = g;
    return props;
  }

  dispose(): void {
    this.wires.geometry.dispose();
    (this.wires.material as THREE.Material).dispose();
  }
}
