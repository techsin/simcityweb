/**
 * DynamicBatch — THREE.BatchedMesh wrapper: lazily registers model geometries by key, grows vertex / instance
 * capacity on demand, and supports cheap tile-based visibility (see TileCuller) instead of three's per-instance
 * frustum culling (which costs O(instances) per render pass).
 */
import * as THREE from 'three';

export class DynamicBatch {
  mesh: THREE.BatchedMesh;
  private geo = new Map<string, number>();
  private geoBounds: THREE.Box3[] = [];
  private tmpColor = new THREE.Vector4();
  private live = 0;

  constructor(material: THREE.Material, instances = 1024, vertices = 65536, name = 'batch') {
    this.mesh = new THREE.BatchedMesh(instances, vertices, vertices * 2, material);
    this.mesh.name = name;
    this.mesh.perObjectFrustumCulled = false;
    this.mesh.sortObjects = false;
    this.mesh.frustumCulled = false;
  }

  get instanceCount(): number {
    return this.live;
  }

  hasGeometry(key: string): boolean {
    return this.geo.has(key);
  }

  /** geometry id for key (adds it via make() on first use) */
  geometryId(key: string, make: () => THREE.BufferGeometry): number {
    let id = this.geo.get(key);
    if (id !== undefined) return id;
    const g = make();
    const need = g.attributes.position.count;
    const m = this.mesh;
    if (m.unusedVertexCount < need) {
      const cur = (m as any)._maxVertexCount as number;
      const next = Math.max(cur * 2, cur + need * 2);
      m.setGeometrySize(next, next * 2);
    }
    id = m.addGeometry(g);
    this.geo.set(key, id);
    if (!g.boundingBox) g.computeBoundingBox();
    this.geoBounds[id] = g.boundingBox!.clone();
    return id;
  }

  bounds(geomId: number): THREE.Box3 {
    return this.geoBounds[geomId];
  }

  add(geomId: number): number {
    const m = this.mesh;
    const info = (m as any)._instanceInfo as unknown[];
    const avail = (m as any)._availableInstanceIds as number[];
    if (info.length >= m.maxInstanceCount && avail.length === 0) {
      m.setInstanceCount(Math.max(64, m.maxInstanceCount * 2));
    }
    this.live++;
    return m.addInstance(geomId);
  }

  remove(id: number): void {
    this.live--;
    this.mesh.deleteInstance(id);
  }

  setGeometry(id: number, geomId: number): void {
    this.mesh.setGeometryIdAt(id, geomId);
  }

  setMatrix(id: number, m: THREE.Matrix4): void {
    this.mesh.setMatrixAt(id, m);
  }

  setColor(id: number, r: number, g: number, b: number, a = 1): void {
    this.mesh.setColorAt(id, this.tmpColor.set(r, g, b, a));
  }

  setVisible(id: number, v: boolean): void {
    this.mesh.setVisibleAt(id, v);
  }

  /** direct access to the matrix texture data (16 floats per instance) for hot per-frame writes */
  matrixData(): Float32Array {
    return (this.mesh as any)._matricesTexture.image.data as Float32Array;
  }
  markMatricesDirty(): void {
    (this.mesh as any)._matricesTexture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.dispose();
  }
}

/**
 * TileCuller — splits the map into TILE x TILE cell tiles and tests their AABBs against the camera frustum
 * (inflated for shadow casters). Consumers keep per-tile instance lists and toggle visibility on changes.
 */
export class TileCuller {
  readonly tiles: number;
  readonly tileCells: number;
  /** per-tile visibility */
  vis: Uint8Array;
  /** per-tile max height (world y) of content, for AABB tests */
  maxY: Float32Array;
  minY: Float32Array;
  private frustum = new THREE.Frustum();
  private mat = new THREE.Matrix4();
  private box = new THREE.Box3();
  private listeners: ((tile: number, visible: boolean) => void)[] = [];
  private first = true;

  constructor(private N: number, private cell: number, tileCells = 16) {
    this.tileCells = tileCells;
    this.tiles = Math.ceil(N / tileCells);
    const T = this.tiles * this.tiles;
    this.vis = new Uint8Array(T);
    this.maxY = new Float32Array(T).fill(60);
    this.minY = new Float32Array(T).fill(-20);
  }

  onChange(fn: (tile: number, visible: boolean) => void): void {
    this.listeners.push(fn);
  }

  tileOf(cx: number, cz: number): number {
    const t = this.tileCells;
    const tx = Math.min(this.tiles - 1, Math.max(0, Math.floor(cx / t)));
    const tz = Math.min(this.tiles - 1, Math.max(0, Math.floor(cz / t)));
    return tz * this.tiles + tx;
  }

  tileOfWorld(wx: number, wz: number): number {
    return this.tileOf(Math.floor(wx / this.cell), Math.floor(wz / this.cell));
  }

  noteHeight(tile: number, y: number): void {
    if (y > this.maxY[tile]) this.maxY[tile] = y;
  }

  update(camera: THREE.Camera): void {
    this.mat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.mat);
    const T = this.tiles;
    const size = this.tileCells * this.cell;
    for (let tz = 0; tz < T; tz++) {
      for (let tx = 0; tx < T; tx++) {
        const i = tz * T + tx;
        const top = this.maxY[i];
        const infl = Math.min(400, Math.max(0, top) * 0.9) + 8;
        this.box.min.set(tx * size - infl, this.minY[i], tz * size - infl);
        this.box.max.set((tx + 1) * size + infl, top + 5, (tz + 1) * size + infl);
        const v = this.frustum.intersectsBox(this.box) ? 1 : 0;
        if (v !== this.vis[i] || this.first) {
          this.vis[i] = v;
          for (const fn of this.listeners) fn(i, v === 1);
        }
      }
    }
    this.first = false;
  }

  /** force every tile visible (e.g. for captures) */
  showAll(): void {
    for (let i = 0; i < this.vis.length; i++) {
      if (!this.vis[i]) {
        this.vis[i] = 1;
        for (const fn of this.listeners) fn(i, true);
      }
    }
  }
}
