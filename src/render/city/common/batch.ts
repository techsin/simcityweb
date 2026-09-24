/**
 * DynamicBatch — THREE.BatchedMesh wrapper: lazily registers model geometries by key, grows vertex / instance
 * capacity on demand, and supports cheap tile-based visibility (see TileCuller) instead of three's per-instance
 * frustum culling (which costs O(instances) per render pass).
 *
 * Per-pass culling (enablePassCulling): three's BatchedMesh builds ONE multi-draw list and reuses it for the main
 * pass and every shadow cascade. Here each camera (main view, shadow cascade 0, cascade 1, captures) gets its own
 * cached draw list (starts / counts / indirect texture), built from per-tile instance lists tested against THAT
 * camera's frustum (tile AABB first, per-instance bounding spheres only in partially visible tiles). A list is
 * rebuilt only when the camera matrices or the batch content changed, so a still camera costs nothing.
 * Shadow passes can additionally be restricted to some cascades (shadowMask) and skip casters smaller than a few
 * shadow texels (minShadowTexels) — shadow cameras carry `userData.cascade` / `userData.texel` (see Shadows.ts).
 *
 * Partial uploads: setMatrix / setColor record per-instance texture update ranges (three r186 honours
 * Texture.updateRanges for RGBA data textures), so animating a few buildings uploads a few rows instead of the whole
 * matrix + colour textures. Many changes in one frame fall back to one full upload.
 */
import * as THREE from 'three';
import { shadowCasters, receiverSweepBox, receiverSweepSphere, type ShadowReceiver } from '../../world/Shadows';

export interface PassCullOptions {
  /** tile geometry (tile size, per-tile height range); instances are assigned to tiles with setTile() */
  culler: TileCuller;
  /** bit i set = draw into shadow cascade i (default: all). The single low-quality map counts as cascade 0. */
  shadowMask?: number;
  /** shadow passes skip instances whose bounding diameter is below this many shadow texels (default 0) */
  minShadowTexels?: number;
  /** instance positions change every frame (vehicles): bounds come from the live matrix, no tile lists */
  dynamic?: boolean;
}

interface PassSlot {
  camera: THREE.Camera;
  starts: Int32Array;
  counts: Int32Array;
  tex: THREE.DataTexture;
  cap: number;
  count: number;
  version: number;
  key: Float64Array;
  used: number;
}

const _frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _m4 = new THREE.Matrix4();
/** max recorded texture update ranges per frame before falling back to one full upload */
const MAX_RANGES = 96;
let _frame = 0;

export class DynamicBatch {
  mesh: THREE.BatchedMesh;
  private geo = new Map<string, number>();
  private geoBounds: THREE.Box3[] = [];
  private geoSphere: THREE.Sphere[] = [];
  private tmpColor = new THREE.Vector4();
  private live = 0;
  // ---- per-pass culling state
  private pc: PassCullOptions | null = null;
  private slots: PassSlot[] = [];
  /** bumped whenever the draw lists could change (instances, visibility, geometry, tiles, bounds) */
  private version = 1;
  private instTile = new Int32Array(0);
  private instSlot = new Int32Array(0);
  private sph = new Float32Array(0);
  /** per-instance shadow cascade mask (bit i = casts into cascade i), ANDed with the batch-wide shadowMask */
  private instMask = new Uint8Array(0);
  private tileLists: number[][] = [];
  /** per-tile bounds of the instance spheres [x0, y0, z0, x1, y1, z1] (grow only) */
  private tileBox = new Float32Array(0);
  private untiled: number[] = [];
  // ---- partial texture uploads
  private matFull = true;
  private colFull = true;
  private lastFrame = -1;

  constructor(material: THREE.Material, instances = 1024, vertices = 65536, name = 'batch') {
    this.mesh = new THREE.BatchedMesh(instances, vertices, vertices * 2, material);
    this.mesh.name = name;
    this.mesh.perObjectFrustumCulled = false;
    this.mesh.sortObjects = false;
    this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = (renderer, _scene, camera, geometry, material) => this.beforePass(renderer, camera, geometry, material, false);
    this.mesh.onBeforeShadow = (renderer, _object, _camera, shadowCamera, geometry, depthMaterial) =>
      this.beforePass(renderer, shadowCamera, geometry, depthMaterial, true);
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
    this.geoSphere[id] = g.boundingBox!.getBoundingSphere(new THREE.Sphere());
    return id;
  }

  bounds(geomId: number): THREE.Box3 {
    return this.geoBounds[geomId];
  }

  /** triangle count of a registered geometry */
  triangles(geomId: number): number {
    const gi = (this.mesh as any)._geometryInfo[geomId];
    return gi ? gi.count / 3 : 0;
  }

  add(geomId: number): number {
    const m = this.mesh;
    const info = (m as any)._instanceInfo as unknown[];
    const avail = (m as any)._availableInstanceIds as number[];
    if (info.length >= m.maxInstanceCount && avail.length === 0) {
      m.setInstanceCount(Math.max(64, m.maxInstanceCount * 2));
      // the textures were re-created (full upload pending): drop recorded ranges
      this.matFull = this.colFull = true;
      (m as any)._matricesTexture.clearUpdateRanges();
      (m as any)._colorsTexture?.clearUpdateRanges();
    }
    this.live++;
    const id = m.addInstance(geomId);
    if (this.pc) {
      this.ensureCap(id + 1);
      this.instTile[id] = -1;
      this.instSlot[id] = -1;
      this.sph[id * 4 + 3] = -1;
      this.instMask[id] = 0xff;
      if (this.pc.dynamic) { this.instSlot[id] = this.untiled.length; this.untiled.push(id); }
    }
    this.touch();
    return id;
  }

  remove(id: number): void {
    this.live--;
    if (this.pc) this.unlink(id);
    this.mesh.deleteInstance(id);
    this.touch();
  }

  setGeometry(id: number, geomId: number): void {
    const m = this.mesh as any;
    if (m._instanceInfo[id].geometryIndex === geomId) return;
    this.mesh.setGeometryIdAt(id, geomId);
    if (this.pc && !this.pc.dynamic) {
      this.mesh.getMatrixAt(id, _m4);
      this.writeSphere(id, _m4, true);
    }
    this.touch();
  }

  setMatrix(id: number, m: THREE.Matrix4): void {
    this.mesh.setMatrixAt(id, m);
    const tex = (this.mesh as any)._matricesTexture as THREE.DataTexture;
    this.noteRange(tex, id * 16, 16, true);
    if (this.pc && !this.pc.dynamic) this.writeSphere(id, m, false);
    if (this.mesh.castShadow) shadowCasters.version++;
  }

  setColor(id: number, r: number, g: number, b: number, a = 1): void {
    const fresh = (this.mesh as any)._colorsTexture === null;
    this.mesh.setColorAt(id, this.tmpColor.set(r, g, b, a));
    const tex = (this.mesh as any)._colorsTexture as THREE.DataTexture;
    if (fresh) this.colFull = true;
    this.noteRange(tex, id * 4, 4, false);
  }

  setVisible(id: number, v: boolean): void {
    const info = (this.mesh as any)._instanceInfo[id];
    if (info && info.visible === v) return;
    this.mesh.setVisibleAt(id, v);
    this.touch();
  }

  /** direct access to the matrix texture data (16 floats per instance) for hot per-frame writes */
  matrixData(): Float32Array {
    return (this.mesh as any)._matricesTexture.image.data as Float32Array;
  }
  /** whole matrix texture changed (full upload) */
  markMatricesDirty(): void {
    const tex = (this.mesh as any)._matricesTexture as THREE.DataTexture;
    tex.clearUpdateRanges();
    this.matFull = true;
    tex.needsUpdate = true;
    if (this.pc?.dynamic) this.version++;
    if (this.mesh.castShadow) shadowCasters.version++;
  }

  private noteRange(tex: THREE.DataTexture, start: number, count: number, mat: boolean): void {
    if (mat ? this.matFull : this.colFull) return;
    if (tex.updateRanges.length >= MAX_RANGES) {
      tex.clearUpdateRanges();
      if (mat) this.matFull = true;
      else this.colFull = true;
      return;
    }
    tex.addUpdateRange(start, count);
  }

  private touch(): void {
    this.version++;
    if (this.mesh.castShadow) shadowCasters.version++;
  }

  // ------------------------------------------------------------------ per-pass culling
  /** switch to per-pass draw lists (instances must then be assigned to tiles with setTile, unless dynamic) */
  enablePassCulling(opts: PassCullOptions): void {
    this.pc = { shadowMask: 0xff, minShadowTexels: 0, dynamic: false, ...opts };
    const T = opts.culler.tiles * opts.culler.tiles;
    this.tileLists = Array.from({ length: T }, () => []);
    this.tileBox = new Float32Array(T * 6);
    for (let t = 0; t < T; t++) this.tileBox.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], t * 6);
    this.ensureCap(this.mesh.maxInstanceCount);
    this.instTile.fill(-1);
    this.instSlot.fill(-1);
    this.touch();
  }

  get passCulling(): boolean {
    return this.pc !== null;
  }

  setShadowMask(mask: number): void {
    if (this.pc && this.pc.shadowMask !== mask) { this.pc.shadowMask = mask; this.touch(); }
  }

  /** restrict one instance to some shadow cascades (bit i = cascade i; default all); per-pass culling only */
  setShadowCascades(id: number, mask: number): void {
    if (!this.pc || id >= this.instMask.length || this.instMask[id] === mask) return;
    this.instMask[id] = mask;
    this.touch();
  }

  /** assign an instance to a culling tile (-1 = untiled: always tested per instance) */
  setTile(id: number, tile: number): void {
    if (!this.pc || this.pc.dynamic) return;
    if (this.instTile[id] === tile && this.instSlot[id] >= 0) return;
    this.unlink(id);
    this.instTile[id] = tile;
    const list = tile >= 0 ? this.tileLists[tile] : this.untiled;
    this.instSlot[id] = list.length;
    list.push(id);
    if (tile >= 0) this.growTile(tile, id);
    this.touch();
  }

  private growTile(tile: number, id: number): void {
    const p = this.sph, o = id * 4, r = p[o + 3];
    if (r < 0) return;
    const b = this.tileBox, k = tile * 6;
    if (p[o] - r < b[k]) b[k] = p[o] - r;
    if (p[o + 1] - r < b[k + 1]) b[k + 1] = p[o + 1] - r;
    if (p[o + 2] - r < b[k + 2]) b[k + 2] = p[o + 2] - r;
    if (p[o] + r > b[k + 3]) b[k + 3] = p[o] + r;
    if (p[o + 1] + r > b[k + 4]) b[k + 4] = p[o + 1] + r;
    if (p[o + 2] + r > b[k + 5]) b[k + 5] = p[o + 2] + r;
  }

  private unlink(id: number): void {
    if (id >= this.instSlot.length) return;
    const s = this.instSlot[id];
    if (s < 0) return;
    const t = this.instTile[id];
    const list = t >= 0 ? this.tileLists[t] : this.untiled;
    const last = list.pop()!;
    if (last !== id) { list[s] = last; this.instSlot[last] = s; }
    this.instSlot[id] = -1;
    this.instTile[id] = -1;
  }

  private ensureCap(n: number): void {
    if (this.instTile.length >= n) return;
    const cap = Math.max(n, this.instTile.length * 2, 64);
    const t = new Int32Array(cap).fill(-1); t.set(this.instTile); this.instTile = t;
    const s = new Int32Array(cap).fill(-1); s.set(this.instSlot); this.instSlot = s;
    const p = new Float32Array(cap * 4); p.set(this.sph); this.sph = p;
    const mk = new Uint8Array(cap).fill(0xff); mk.set(this.instMask); this.instMask = mk;
  }

  /** world bounding sphere for culling. Y scale is clamped to >= 1 so pop-in / construction growth (sy < 1) never
   *  changes the bounds (no list rebuilds while buildings animate). */
  private writeSphere(id: number, m: THREE.Matrix4, force: boolean): void {
    const gid = (this.mesh as any)._instanceInfo[id].geometryIndex as number;
    const gs = this.geoSphere[gid];
    if (!gs) return;
    const e = m.elements;
    const sx = Math.hypot(e[0], e[1], e[2]), sy = Math.max(1, Math.hypot(e[4], e[5], e[6])), sz = Math.hypot(e[8], e[9], e[10]);
    const c = gs.center;
    // center = T + R * (S' * c) with S' = diag(sx, sy, sz) (use the unit axes of the matrix)
    const ix = sx > 0 ? 1 / sx : 0, iz = sz > 0 ? 1 / sz : 0;
    const iy = 1 / Math.max(1e-6, Math.hypot(e[4], e[5], e[6]));
    const lx = c.x * sx, ly = c.y * sy, lz = c.z * sz;
    const cx = e[12] + e[0] * ix * lx + e[4] * iy * ly + e[8] * iz * lz;
    const cy = e[13] + e[1] * ix * lx + e[5] * iy * ly + e[9] * iz * lz;
    const cz = e[14] + e[2] * ix * lx + e[6] * iy * ly + e[10] * iz * lz;
    const r = gs.radius * Math.max(sx, sy, sz);
    const o = id * 4;
    const p = this.sph;
    if (!force && p[o + 3] >= 0) {
      const dx = cx - p[o], dy = cy - p[o + 1], dz = cz - p[o + 2];
      if (dx * dx + dy * dy + dz * dz < 0.25 && r <= p[o + 3] * 1.02) return;
    }
    p[o] = cx; p[o + 1] = cy; p[o + 2] = cz; p[o + 3] = r;
    const t = this.instTile[id];
    if (t >= 0) this.growTile(t, id);
    this.version++;
  }

  private slotFor(camera: THREE.Camera): PassSlot {
    const m = this.mesh as any;
    let s = this.slots.find((x) => x.camera === camera);
    if (!s) {
      if (this.slots.length >= 6) {
        // evict the least recently used slot (e.g. one-off capture cameras)
        this.slots.sort((a, b) => a.used - b.used);
        const old = this.slots.shift()!;
        old.tex.dispose();
      }
      s = { camera, starts: new Int32Array(0), counts: new Int32Array(0), tex: null as unknown as THREE.DataTexture, cap: -1, count: 0, version: -1, key: new Float64Array(18), used: 0 };
      this.slots.push(s);
    }
    const cap = m._maxInstanceCount as number;
    if (s.cap !== cap) {
      s.tex?.dispose();
      const size = Math.ceil(Math.sqrt(cap));
      s.tex = new THREE.DataTexture(new Uint32Array(size * size), size, size, THREE.RedIntegerFormat, THREE.UnsignedIntType);
      s.starts = new Int32Array(cap);
      s.counts = new Int32Array(cap);
      s.cap = cap;
      s.version = -1;
    }
    s.used = _frame;
    return s;
  }

  private beforePass(renderer: THREE.WebGLRenderer, camera: THREE.Camera, geometry: THREE.BufferGeometry, material: THREE.Material, shadow: boolean): void {
    const m = this.mesh as any;
    // once per frame (the first pass that draws this batch): finalize partial / full texture uploads
    const fr = renderer.info.render.frame;
    if (fr !== this.lastFrame) {
      this.lastFrame = fr;
      _frame++;
      if (this.matFull) { m._matricesTexture.clearUpdateRanges(); this.matFull = false; }
      if (this.colFull && m._colorsTexture) { m._colorsTexture.clearUpdateRanges(); this.colFull = false; }
    }
    if (!this.pc) {
      // three's default: one list for all passes
      THREE.BatchedMesh.prototype.onBeforeRender.call(m, renderer, null as any, camera, geometry, material, null as any);
      return;
    }
    const s = this.slotFor(camera);
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = _pm.elements;
    const k = s.key;
    let same = s.version === this.version;
    // small tolerance: a still (damped) camera jitters by float ulps; that never changes the culling result
    for (let i = 0; i < 16 && same; i++) if (Math.abs(k[i] - e[i]) > 1e-7 * Math.max(1, Math.abs(e[i]))) same = false;
    const texel = shadow ? ((camera.userData.texel as number | undefined) ?? 0) : 0;
    const recv = shadow ? ((camera.userData.recv as ShadowReceiver | undefined) ?? null) : null;
    // the receiver (visible slice) can change while the shadow camera stays put (single map, rotating view)
    const rv = recv ? recv.version : -1;
    if (same && (k[16] !== texel || k[17] !== rv)) same = false;
    if (!same) {
      for (let i = 0; i < 16; i++) k[i] = e[i];
      k[16] = texel;
      k[17] = rv;
      s.version = this.version;
      this.build(s, shadow ? ((camera.userData.cascade as number | undefined) ?? 0) : -1, texel, geometry, recv);
    }
    m._multiDrawStarts = s.starts;
    m._multiDrawCounts = s.counts;
    m._multiDrawCount = s.count;
    m._indirectTexture = s.tex;
    m._visibilityChanged = false;
  }

  private build(s: PassSlot, cascade: number, texel: number, geometry: THREE.BufferGeometry, recv: ShadowReceiver | null): void {
    const pc = this.pc!;
    const m = this.mesh as any;
    let n = 0;
    if (cascade < 0 || (pc.shadowMask! >> cascade) & 1) {
      _frustum.setFromProjectionMatrix(_pm, s.camera.coordinateSystem, (s.camera as any).reversedDepth);
      const planes = _frustum.planes;
      const info = m._instanceInfo as { active: boolean; visible: boolean; geometryIndex: number }[];
      const gInfo = m._geometryInfo as { start: number; count: number }[];
      const index = geometry.getIndex();
      const bpe = index === null ? 1 : index.array.BYTES_PER_ELEMENT;
      const starts = s.starts, counts = s.counts, ind = s.tex.image.data as unknown as Uint32Array;
      const minR = cascade >= 0 ? pc.minShadowTexels! * texel * 0.5 : 0;
      const sph = this.sph;
      const dyn = pc.dynamic;
      const mat = dyn ? (m._matricesTexture.image.data as Float32Array) : null;
      const cbit = cascade >= 0 ? 1 << cascade : 0;
      const imask = this.instMask;
      const pushList = (list: number[], test: boolean) => {
        for (let j = 0; j < list.length; j++) {
          const id = list[j];
          const it = info[id];
          if (!it.visible || !it.active) continue;
          if (cbit && !(imask[id] & cbit)) continue;
          if (test || minR > 0 || recv) {
            let cx: number, cy: number, cz: number, r: number;
            if (mat) {
              const gs = this.geoSphere[it.geometryIndex];
              const o = id * 16;
              cx = mat[o + 12]; cy = mat[o + 13]; cz = mat[o + 14];
              r = gs.radius + gs.center.length();
            } else {
              const o = id * 4;
              cx = sph[o]; cy = sph[o + 1]; cz = sph[o + 2]; r = sph[o + 3];
            }
            if (r < minR) continue;
            // shadow passes: only casters whose shadow can reach the visible part of this cascade
            if (recv && !receiverSweepSphere(recv, cx, cy, cz, r)) continue;
            if (test) {
              let out = false;
              for (let p = 0; p < 6; p++) {
                const pl = planes[p], nn = pl.normal;
                if (nn.x * cx + nn.y * cy + nn.z * cz + pl.constant < -r) { out = true; break; }
              }
              if (out) continue;
            }
          }
          const g = gInfo[it.geometryIndex];
          starts[n] = g.start * bpe;
          counts[n] = g.count;
          ind[n] = id;
          n++;
        }
      };
      if (!dyn) {
        const tb = this.tileBox;
        for (let ti = 0; ti < this.tileLists.length; ti++) {
          const list = this.tileLists[ti];
          if (!list.length) continue;
          const k = ti * 6;
          const x0 = tb[k], y0 = tb[k + 1], z0 = tb[k + 2], x1 = tb[k + 3], y1 = tb[k + 4], z1 = tb[k + 5];
          if (!(x1 >= x0)) { pushList(list, true); continue; }
          let inside = true, outside = false;
          for (let p = 0; p < 6; p++) {
            const pl = planes[p], nn = pl.normal;
            // p-vertex (farthest along the normal) and n-vertex
            const px = nn.x > 0 ? x1 : x0, py = nn.y > 0 ? y1 : y0, pz = nn.z > 0 ? z1 : z0;
            if (nn.x * px + nn.y * py + nn.z * pz + pl.constant < 0) { outside = true; break; }
            const qx = nn.x > 0 ? x0 : x1, qy = nn.y > 0 ? y0 : y1, qz = nn.z > 0 ? z0 : z1;
            if (nn.x * qx + nn.y * qy + nn.z * qz + pl.constant < 0) inside = false;
          }
          if (outside) continue;
          if (recv && !receiverSweepBox(recv, x0, y0, z0, x1, y1, z1)) continue;
          pushList(list, !inside);
        }
      }
      pushList(this.untiled, true);
    }
    s.count = n;
    s.tex.needsUpdate = true;
  }

  dispose(): void {
    // the mesh disposes whichever indirect texture it currently holds; dispose the others
    const cur = (this.mesh as any)._indirectTexture;
    for (const s of this.slots) if (s.tex !== cur) s.tex.dispose();
    this.slots.length = 0;
    this.mesh.dispose();
  }
}

/**
 * TileCuller — splits the map into TILE x TILE cell tiles and tests their AABBs against the camera frustum
 * (inflated for shadow casters). Consumers keep per-tile instance lists and toggle visibility on changes.
 * Batches with per-pass culling only use its tile geometry (tileOf, maxY / minY).
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

  /** world size of one cell */
  get cellSize(): number {
    return this.cell;
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
