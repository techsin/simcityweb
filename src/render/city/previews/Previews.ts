/**
 * Previews — plop ghost (translucent tinted model + lot pad), network drag preview ribbon (per type), and the
 * selection outline box.
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../../core/constants';
import { Network } from '../../../core/types';
import type { CityState } from '../../../sim/CityState';
import { getDef } from '../../../sim/catalog';
import { MANIFEST_BY_ID } from '../../../assets/manifest';
import { getModelGeometry } from '../../../assets/registry';
import { cityUniforms, getGhostMaterial } from '../common/cityMaterial';
import { DX, DZ, HALF_W, HALF } from '../common/netinfo';
import type { RoadSurface } from '../common/surface';
import { propGeometry } from '../props/PropRenderer';
import type { BuildingVisual } from '../buildings/BuildingRenderer';

const OK_COL = new THREE.Color(0.25, 1.0, 0.45);
const BAD_COL = new THREE.Color(1.0, 0.25, 0.2);

export class Previews {
  readonly group = new THREE.Group();
  private ghost: THREE.Mesh;
  private pad: THREE.Mesh;
  private padMat: THREE.MeshBasicMaterial;
  private ribbon: THREE.Mesh;
  private ribbonMat: THREE.MeshBasicMaterial;
  private pylons: THREE.InstancedMesh | null = null;
  private selBox: THREE.LineSegments;
  /** ghost outline (feature edges, drawn through occluders) */
  private ghostEdges: THREE.LineSegments;
  private ghostEdgeMat: THREE.LineBasicMaterial;
  private edgeCache = new Map<string, THREE.BufferGeometry>();
  private time = 0;

  constructor(private state: CityState, private surf: RoadSurface) {
    this.group.name = 'previews';
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), getGhostMaterial());
    this.ghost.visible = false;
    this.ghost.renderOrder = 10;
    this.ghostEdgeMat = new THREE.LineBasicMaterial({ color: OK_COL, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    this.ghostEdges = new THREE.LineSegments(new THREE.BufferGeometry(), this.ghostEdgeMat);
    this.ghostEdges.visible = false;
    this.ghostEdges.renderOrder = 11;
    this.ghostEdges.frustumCulled = false;
    this.padMat = new THREE.MeshBasicMaterial({ color: OK_COL, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.pad = new THREE.Mesh(new THREE.BufferGeometry(), this.padMat);
    this.pad.visible = false;
    this.pad.renderOrder = 9;
    this.ribbonMat = new THREE.MeshBasicMaterial({ color: OK_COL, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -10, side: THREE.DoubleSide });
    this.ribbon = new THREE.Mesh(new THREE.BufferGeometry(), this.ribbonMat);
    this.ribbon.visible = false;
    this.ribbon.renderOrder = 9;
    this.ribbon.frustumCulled = false;
    const sg = new THREE.BufferGeometry();
    this.selBox = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.9, depthTest: false }));
    this.selBox.visible = false;
    this.selBox.renderOrder = 20;
    this.selBox.frustumCulled = false;
    this.group.add(this.ghost, this.ghostEdges, this.pad, this.ribbon, this.selBox);
  }

  setState(state: CityState, surf: RoadSurface): void {
    this.state = state;
    this.surf = surf;
  }

  // ------------------------------------------------------------------ ghost
  setGhost(defId: string | null, x = 0, z = 0, rot: 0 | 1 | 2 | 3 = 0, ok = true): void {
    if (!defId) { this.ghost.visible = false; this.ghostEdges.visible = false; this.pad.visible = false; return; }
    const def = getDef(defId);
    const model = def?.model ?? defId;
    const e = MANIFEST_BY_ID[model];
    const fp = def?.footprint ?? e?.footprint ?? [1, 1];
    const w = rot & 1 ? fp[1] : fp[0], d = rot & 1 ? fp[0] : fp[1];
    const geo = getModelGeometry(model, 0);
    this.ghost.geometry = geo;
    const st = this.state;
    const N = st.size, N1 = N + 1;
    let sum = 0, cnt = 0;
    for (let zz = z; zz <= z + d; zz++) for (let xx = x; xx <= x + w; xx++) {
      const cz = Math.min(N, Math.max(0, zz)), cx = Math.min(N, Math.max(0, xx));
      sum += st.heights[cz * N1 + cx]; cnt++;
    }
    const baseY = sum / cnt;
    const cx = (x + w / 2) * CELL_SIZE, cz = (z + d / 2) * CELL_SIZE;
    this.ghost.position.set(cx, baseY + 0.05, cz);
    this.ghost.rotation.set(0, rot * (Math.PI / 2), 0);
    this.ghost.visible = true;
    cityUniforms.uGhostTint.value.copy(ok ? OK_COL : BAD_COL);
    // outline: feature edges of the model (cached per model)
    const ek = model;
    let eg = this.edgeCache.get(ek);
    if (!eg) {
      eg = new THREE.EdgesGeometry(geo, 35);
      this.edgeCache.set(ek, eg);
    }
    this.ghostEdges.geometry = eg;
    this.ghostEdges.position.copy(this.ghost.position);
    this.ghostEdges.rotation.copy(this.ghost.rotation);
    this.ghostEdgeMat.color.copy(ok ? OK_COL : BAD_COL).multiplyScalar(1.6);
    this.ghostEdges.visible = true;
    // lot pad following terrain
    const pad = this.pad.geometry as THREE.BufferGeometry;
    const pts: number[] = [];
    const segX = w * 2, segZ = d * 2;
    const x0 = x * CELL_SIZE, z0 = z * CELL_SIZE, sx = (w * CELL_SIZE) / segX, sz = (d * CELL_SIZE) / segZ;
    for (let j = 0; j < segZ; j++) for (let i = 0; i < segX; i++) {
      const ax = x0 + i * sx, az = z0 + j * sz, bx = ax + sx, bz = az + sz;
      const y = (px: number, pz: number) => Math.max(this.surf.terrain(px, pz), baseY) + 0.25;
      pts.push(ax, y(ax, az), az, ax, y(ax, bz), bz, bx, y(bx, bz), bz, ax, y(ax, az), az, bx, y(bx, bz), bz, bx, y(bx, az), az);
    }
    pad.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    pad.computeBoundingSphere();
    this.padMat.color.copy(ok ? OK_COL : BAD_COL);
    this.pad.visible = true;
  }

  // ------------------------------------------------------------------ network drag preview
  setNetworkPreview(path: { x: number; z: number }[] | null, type: Network | 'power' | 'subway' = Network.Road, ok = true): void {
    if (this.pylons) { this.group.remove(this.pylons); this.pylons.dispose(); this.pylons = null; }
    if (!path || !path.length) { this.ribbon.visible = false; return; }
    const hw = type === 'power' ? 0.9 : type === 'subway' ? 2.6 : HALF_W[type as number] ?? 5;
    const set = new Set(path.map((p) => p.z * 100000 + p.x));
    const has = (x: number, z: number) => set.has(z * 100000 + x);
    const pts: number[] = [];
    const lift = type === 'subway' ? 0.6 : 0.45;
    const Y = (wx: number, wz: number) => this.surf.terrain(wx, wz) + lift;
    const quad = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) => {
      pts.push(ax, Y(ax, az), az, bx, Y(bx, bz), bz, cx, Y(cx, cz), cz, ax, Y(ax, az), az, cx, Y(cx, cz), cz, dx, Y(dx, dz), dz);
    };
    for (const p of path) {
      const ox = (p.x + 0.5) * CELL_SIZE, oz = (p.z + 0.5) * CELL_SIZE;
      quad(ox - hw, oz - hw, ox + hw, oz - hw, ox + hw, oz + hw, ox - hw, oz + hw);
      for (let d = 0; d < 4; d++) {
        if (!has(p.x + DX[d], p.z + DZ[d])) continue;
        // arm to the edge
        const rx = -DZ[d], rz = DX[d];
        const a0x = ox + DX[d] * hw, a0z = oz + DZ[d] * hw, a1x = ox + DX[d] * HALF, a1z = oz + DZ[d] * HALF;
        quad(a0x - rx * hw, a0z - rz * hw, a1x - rx * hw, a1z - rz * hw, a1x + rx * hw, a1z + rz * hw, a0x + rx * hw, a0z + rz * hw);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.ribbon.geometry.dispose();
    this.ribbon.geometry = g;
    const col = ok ? (type === 'subway' ? new THREE.Color(0.3, 0.7, 1.0) : type === 'power' ? new THREE.Color(1.0, 0.85, 0.3) : OK_COL) : BAD_COL;
    this.ribbonMat.color.copy(col);
    this.ribbonMat.depthTest = type !== 'subway';
    this.ribbon.visible = true;
    if (type === 'power') {
      const pg = propGeometry('util_power_pylon', 0);
      const im = new THREE.InstancedMesh(pg, getGhostMaterial(), path.length);
      let n = 0;
      const m = new THREE.Matrix4();
      for (let k = 0; k < path.length; k++) {
        const p = path[k];
        if (k % 2 && k !== path.length - 1) continue;
        const ox = (p.x + 0.5) * CELL_SIZE, oz = (p.z + 0.5) * CELL_SIZE;
        const horiz = has(p.x - 1, p.z) || has(p.x + 1, p.z);
        m.makeRotationY(horiz ? Math.PI / 2 : 0).setPosition(ox, this.surf.terrain(ox, oz), oz);
        im.setMatrixAt(n++, m);
      }
      im.count = n;
      im.renderOrder = 10;
      cityUniforms.uGhostTint.value.copy(ok ? OK_COL : BAD_COL);
      this.pylons = im;
      this.group.add(im);
    }
  }

  // ------------------------------------------------------------------ selection
  setSelection(v: BuildingVisual | null): void {
    if (!v) { this.selBox.visible = false; return; }
    const hw = v.sw / 2 + 0.6, hd = v.sd / 2 + 0.6;
    const y0 = v.baseY - 0.2, y1 = Math.max(v.baseY + 2, v.top + 1);
    const x0 = v.cx - hw, x1 = v.cx + hw, z0 = v.cz - hd, z1 = v.cz + hd;
    const p = [
      x0, y0, z0, x1, y0, z0, x1, y0, z0, x1, y0, z1, x1, y0, z1, x0, y0, z1, x0, y0, z1, x0, y0, z0,
      x0, y1, z0, x1, y1, z0, x1, y1, z0, x1, y1, z1, x1, y1, z1, x0, y1, z1, x0, y1, z1, x0, y1, z0,
      x0, y0, z0, x0, y1, z0, x1, y0, z0, x1, y1, z0, x1, y0, z1, x1, y1, z1, x0, y0, z1, x0, y1, z1,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    this.selBox.geometry.dispose();
    this.selBox.geometry = g;
    this.selBox.visible = true;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.ghostEdges.visible) this.ghostEdgeMat.opacity = 0.7 + 0.25 * Math.sin(this.time * 4);
    if (this.selBox.visible) (this.selBox.material as THREE.LineBasicMaterial).opacity = 0.65 + 0.3 * Math.sin(this.time * 4);
  }

  dispose(): void {
    this.pad.geometry.dispose();
    this.ribbon.geometry.dispose();
    this.selBox.geometry.dispose();
    this.padMat.dispose();
    this.ghostEdgeMat.dispose();
    for (const g of this.edgeCache.values()) g.dispose();
    this.ribbonMat.dispose();
    if (this.pylons) this.pylons.dispose();
  }
}

export { HALF };
