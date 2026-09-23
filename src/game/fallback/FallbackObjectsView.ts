/**
 * Minimal CityObjectsView used when src/render/city/CityObjectsView.ts is missing or throws.
 * Zones / networks / power lines are drawn as a draped cell texture; buildings use the procedural asset models when
 * the asset registry is available (else simple boxes). Supports ghosts, network previews, selection and picking.
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../core/constants';
import { Network, Overlay, Zone, zoneFamily } from '../../core/types';
import type { Emitter } from '../../core/events';
import type { Building, CityState } from '../../sim/CityState';
import { BF } from '../../sim/CityState';
import type { CityEvents } from '../../sim/Simulation';
import type { CityObjectsViewApi } from '../../render/contracts';
import { getDef } from '../../sim/catalog';
import { MANIFEST_BY_ID } from '../../assets/manifest';

type AssetApi = {
  getModelGeometry: (id: string, variant?: number) => THREE.BufferGeometry;
  hasModel: (id: string) => boolean;
  getBuildingMaterial: () => THREE.Material;
};

const ASSETS = import.meta.glob(['../../assets/builders/index.ts', '../../assets/registry.ts', '../../assets/materials.ts']);

async function loadAssets(): Promise<AssetApi | null> {
  try {
    const [b, r, m] = await Promise.all([ASSETS['../../assets/builders/index.ts']?.(), ASSETS['../../assets/registry.ts']?.(), ASSETS['../../assets/materials.ts']?.()]) as any[];
    if (!b || !r || !m) return null;
    b.registerAllModels?.();
    return { getModelGeometry: r.getModelGeometry, hasModel: r.hasModel, getBuildingMaterial: m.getBuildingMaterial };
  } catch (e) {
    console.warn('[fallback-objects] asset registry unavailable', e);
    return null;
  }
}

const NET_COLORS: Record<number, number> = {
  [Network.Street]: 0x70747a,
  [Network.Road]: 0x575b61,
  [Network.Avenue]: 0x46494f,
  [Network.OneWay]: 0x5d6168,
  [Network.Highway]: 0x393c41,
  [Network.Rail]: 0x7d6049,
};
const ZONE_COLORS: Record<number, number> = {
  [Zone.ResLow]: 0x57d17f, [Zone.ResMed]: 0x35b865, [Zone.ResHigh]: 0x1f9a4d,
  [Zone.ComLow]: 0x6aa6ff, [Zone.ComMed]: 0x3d8bff, [Zone.ComHigh]: 0x2667d6,
  [Zone.IndAg]: 0xc3cf62, [Zone.IndMed]: 0xf0b429, [Zone.IndHigh]: 0xd88d17, [Zone.Landfill]: 0x8d6a4b,
};
const CAT_COLORS: Record<string, number> = {
  power: 0xd9c46a, water: 0x6fb2d9, garbage: 0x8f7a5c, police: 0x4a6fd1, fire: 0xd8544a, health: 0xf0f0f0, education: 0xd7a35a,
  park: 0x5fb35a, civic: 0xd9d2c3, landmark: 0xc9b8e8, reward: 0xb38fe0, transport: 0x9aa3ad,
};

function rgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

class CellLayer {
  readonly data: Uint8Array;
  readonly tex: THREE.DataTexture;
  readonly mesh: THREE.Mesh;
  constructor(geo: THREE.BufferGeometry, N: number, order: number, opacity = 1) {
    this.data = new Uint8Array(N * N * 4);
    this.tex = new THREE.DataTexture(this.data, N, N, THREE.RGBAFormat);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 - order, polygonOffsetUnits: -6 - order * 2 }));
    this.mesh.renderOrder = 5 + order;
    this.mesh.raycast = () => {};
  }
}

export class FallbackObjectsView implements CityObjectsViewApi {
  readonly isFallback = true;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private geo: THREE.BufferGeometry;
  private ground: CellLayer;
  private preview: CellLayer;
  private group = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();
  private boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  private boxMat = new THREE.MeshLambertMaterial({ vertexColors: false });
  private assets: AssetApi | null = null;
  private ghost: THREE.Mesh | null = null;
  private ghostKey = '';
  private ghostMat = new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.45, depthWrite: false });
  private selBox: THREE.LineSegments;
  private selected: number | null = null;
  private groundDirty = true;
  private buildDirty = new Set<number>();
  private offs: (() => void)[] = [];
  private underground = false;
  private raycaster = new THREE.Raycaster();

  constructor(private state: CityState, events: Emitter<CityEvents>, opts: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; canvas: HTMLCanvasElement }) {
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.canvas = opts.canvas;
    const N = state.size;
    this.geo = this.makeGeo();
    this.ground = new CellLayer(this.geo, N, 0, 1);
    this.preview = new CellLayer(this.geo, N, 3, 0.9);
    this.scene.add(this.ground.mesh, this.preview.mesh, this.group);
    const eg = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
    this.selBox = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x7cd4ff, depthTest: false, transparent: true }));
    this.selBox.renderOrder = 60;
    this.selBox.visible = false;
    this.scene.add(this.selBox);
    const markGround = () => (this.groundDirty = true);
    this.offs.push(
      events.on('zoneChanged', markGround),
      events.on('networkChanged', markGround),
      events.on('powerLinesChanged', markGround),
      events.on('subwayChanged', markGround),
      events.on('terrainChanged', () => {
        this.updateGeo();
        markGround();
      }),
      events.on('buildingAdded', (b) => this.buildDirty.add(b.id)),
      events.on('buildingRemoved', (b) => this.buildDirty.add(b.id)),
      events.on('buildingChanged', (b) => this.buildDirty.add(b.id)),
      events.on('reset', () => this.rebuildAll()),
    );
    for (const id of state.buildings.keys()) this.buildDirty.add(id);
    loadAssets().then((a) => {
      this.assets = a;
      if (a) this.rebuildAll();
    });
  }

  private makeGeo(): THREE.BufferGeometry {
    const N = this.state.size, N1 = N + 1;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N1 * N1 * 3), uv = new Float32Array(N1 * N1 * 2);
    for (let z = 0; z <= N; z++)
      for (let x = 0; x <= N; x++) {
        const i = z * N1 + x;
        pos[i * 3] = x * CELL_SIZE;
        pos[i * 3 + 1] = this.state.heights[i] + 0.15;
        pos[i * 3 + 2] = z * CELL_SIZE;
        uv[i * 2] = x / N;
        uv[i * 2 + 1] = z / N;
      }
    const idx = new Uint32Array(N * N * 6);
    let k = 0;
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const a = z * N1 + x, b = a + 1, c = a + N1, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  }

  private updateGeo(): void {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, Math.max(this.state.heights[i], -0.3) + 0.15);
    pos.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }

  private paintGround(): void {
    const st = this.state;
    const d = this.ground.data;
    for (let i = 0; i < st.cells; i++) {
      const o = i * 4;
      const n = st.network[i];
      let c = 0, a = 0;
      if (n) {
        c = NET_COLORS[n] ?? 0x555555;
        a = 255;
      } else if (this.underground && st.subway[i]) {
        c = 0xb06cff;
        a = 220;
      } else if (st.powerLines[i]) {
        c = 0xe8c64a;
        a = 150;
      } else if (st.zone[i]) {
        c = ZONE_COLORS[st.zone[i]] ?? 0x888888;
        a = st.building[i] >= 0 ? 60 : 110;
      }
      const [r, g, b] = rgb(c);
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a;
    }
    this.ground.tex.needsUpdate = true;
  }

  private rebuildAll(): void {
    for (const m of this.meshes.values()) this.group.remove(m);
    this.meshes.clear();
    for (const id of this.state.buildings.keys()) this.buildDirty.add(id);
    this.groundDirty = true;
  }

  private buildingHeight(b: Building): number {
    const def = getDef(b.def);
    const me = def ? MANIFEST_BY_ID[def.model] : undefined;
    if (me) return (me.height[0] + me.height[1]) / 2;
    if (def?.category === 'growable') return 6 + (def.stage ?? 1) * 7;
    return 10;
  }

  private buildingColor(b: Building): number {
    const def = getDef(b.def);
    if (b.flags & BF.Burnt) return 0x333333;
    if (b.flags & BF.Abandoned) return 0x8a8580;
    if (def && def.category !== 'growable') return CAT_COLORS[def.category] ?? 0xcccccc;
    const fam = zoneFamily(this.state.zone[this.state.idx(b.x, b.z)] as Zone);
    const base = fam === 'R' ? 0xe9e2d0 : fam === 'C' ? 0xa9c4e6 : fam === 'I' ? 0xd9c9a0 : 0xcfcfcf;
    return base;
  }

  private syncBuilding(id: number): void {
    const old = this.meshes.get(id);
    if (old) {
      this.group.remove(old);
      if ((old.material as THREE.Material) !== this.boxMat && !(old.userData.sharedMat)) (old.material as THREE.Material).dispose();
      this.meshes.delete(id);
    }
    const b = this.state.buildings.get(id);
    if (!b) return;
    const def = getDef(b.def);
    let mesh: THREE.Mesh;
    const a = this.assets;
    const built = b.built ?? 1;
    if (a && def && a.hasModel(def.model) && !(b.flags & BF.Burnt)) {
      mesh = new THREE.Mesh(a.getModelGeometry(def.model, b.variant), a.getBuildingMaterial());
      mesh.userData.sharedMat = true;
      mesh.scale.y = Math.max(0.08, built);
    } else {
      const h = this.buildingHeight(b) * Math.max(0.1, built);
      mesh = new THREE.Mesh(this.boxGeo, new THREE.MeshLambertMaterial({ color: this.buildingColor(b) }));
      const w = def ? def.footprint[0] : b.w, dd = def ? def.footprint[1] : b.d;
      mesh.scale.set(w * CELL_SIZE - 3, h, dd * CELL_SIZE - 3);
    }
    mesh.position.set((b.x + b.w / 2) * CELL_SIZE, b.baseY ?? this.state.cellHeight(b.x, b.z), (b.z + b.d / 2) * CELL_SIZE);
    mesh.rotation.y = (b.rot ?? 0) * (Math.PI / 2);
    mesh.userData.bid = id;
    if (this.underground) this.applyUnderground(mesh);
    this.group.add(mesh);
    this.meshes.set(id, mesh);
  }

  private applyUnderground(m: THREE.Mesh): void {
    m.visible = !this.underground;
  }

  update(_dt: number): void {
    if (this.groundDirty) {
      this.groundDirty = false;
      this.paintGround();
    }
    if (this.buildDirty.size) {
      let n = 0;
      for (const id of this.buildDirty) {
        this.syncBuilding(id);
        this.buildDirty.delete(id);
        if (++n > 400) break;
      }
      if (this.selected !== null) this.setSelected(this.selected);
    }
  }

  setGhost(defId: string | null, x = 0, z = 0, rot: 0 | 1 | 2 | 3 = 0, ok = true): void {
    if (!defId) {
      if (this.ghost) this.ghost.visible = false;
      return;
    }
    const def = getDef(defId);
    const fw = def?.footprint[0] ?? 1, fd = def?.footprint[1] ?? 1;
    const w = rot % 2 ? fd : fw, d = rot % 2 ? fw : fd;
    const key = defId;
    if (!this.ghost || this.ghostKey !== key) {
      if (this.ghost) this.scene.remove(this.ghost);
      const a = this.assets;
      if (a && def && a.hasModel(def.model)) this.ghost = new THREE.Mesh(a.getModelGeometry(def.model, 0), this.ghostMat);
      else {
        this.ghost = new THREE.Mesh(this.boxGeo, this.ghostMat);
        const me = def ? MANIFEST_BY_ID[def.model] : undefined;
        this.ghost.scale.set(fw * CELL_SIZE - 3, me ? (me.height[0] + me.height[1]) / 2 : 10, fd * CELL_SIZE - 3);
      }
      this.ghost.renderOrder = 40;
      this.ghost.raycast = () => {};
      this.ghostKey = key;
      this.scene.add(this.ghost);
    }
    this.ghost.visible = true;
    this.ghostMat.color.setHex(ok ? 0x66ff99 : 0xff5d5d);
    let maxH = -Infinity;
    for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) if (this.state.inBounds(xx, zz)) maxH = Math.max(maxH, this.state.cellHeight(xx, zz));
    this.ghost.position.set((x + w / 2) * CELL_SIZE, isFinite(maxH) ? Math.max(0, maxH) : 0, (z + d / 2) * CELL_SIZE);
    this.ghost.rotation.y = rot * (Math.PI / 2);
  }

  setNetworkPreview(path: { x: number; z: number }[] | null, type?: Network | 'power' | 'subway', ok = true): void {
    const d = this.preview.data;
    d.fill(0);
    if (path) {
      const c = !ok ? 0xff5d5d : type === 'power' ? 0xffd84a : type === 'subway' ? 0xb06cff : typeof type === 'number' ? (NET_COLORS[type] ?? 0x666666) : 0x666666;
      const [r, g, b] = rgb(c);
      const N = this.state.size;
      for (const p of path) {
        if (p.x < 0 || p.z < 0 || p.x >= N || p.z >= N) continue;
        const o = (p.z * N + p.x) * 4;
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 235;
      }
    }
    this.preview.tex.needsUpdate = true;
  }

  setUnderground(on: boolean): void {
    if (this.underground === on) return;
    this.underground = on;
    for (const m of this.meshes.values()) this.applyUnderground(m);
    this.groundDirty = true;
  }

  setOverlayMode(o: Overlay): void {
    this.ground.mesh.visible = o === Overlay.None || o === Overlay.Traffic || o === Overlay.Transit;
  }

  pickBuilding(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.group.children, false)[0];
    return hit ? ((hit.object.userData.bid as number) ?? null) : null;
  }

  setSelected(buildingId: number | null): void {
    this.selected = buildingId;
    const m = buildingId !== null ? this.meshes.get(buildingId) : undefined;
    if (!m) {
      this.selBox.visible = false;
      return;
    }
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    this.selBox.visible = true;
    this.selBox.position.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    this.selBox.scale.set(size.x + 1, size.y + 1, size.z + 1);
  }

  dispose(): void {
    for (const f of this.offs) f();
    this.scene.remove(this.ground.mesh, this.preview.mesh, this.group, this.selBox);
    if (this.ghost) this.scene.remove(this.ghost);
    this.geo.dispose();
    this.ground.tex.dispose();
    this.preview.tex.dispose();
  }
}
