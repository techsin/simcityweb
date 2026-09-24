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
 * Shadow passes can additionally be restricted to some cascades (shadowMask, per instance setShadowCascades) and skip
 * casters smaller than a few shadow texels (minShadowTexels) — shadow cameras carry `userData.cascade` /
 * `userData.texel` (see Shadows.ts) — and casters whose shadow cannot reach the visible slice (receiver volume).
 * Whole tiles are skipped when disabled by the owner (setTileEnabled: e.g. props beyond their LOD distance), when
 * none of their instances casts into the cascade, or when their swept box misses the receiver; tiles fully inside the
 * frustum / receiver skip the per-instance tests. Per-tile bounds / masks are recomputed lazily (exact, also after
 * removals). The build loop reads typed per-instance mirrors (visibility, geometry) instead of three's objects.
 * Optionally (sortFront) main-pass lists are sorted nearest first so the depth test rejects occluded fragments
 * before shading.
 *
 * Partial uploads: setMatrix / setColor record per-instance texture update ranges (three r186 honours
 * Texture.updateRanges for RGBA data textures), so animating a few buildings uploads a few rows instead of the whole
 * matrix + colour textures. Many changes in one frame fall back to one full upload.
 */
import * as THREE from 'three';
import { shadowCasters, viewReach, type ShadowReceiver } from '../../world/Shadows';

export interface PassCullOptions {
  /** tile geometry (tile size, per-tile height range); instances are assigned to tiles with setTile() */
  culler: TileCuller;
  /** bit i set = draw into shadow cascade i (default: all). The single low-quality map counts as cascade 0. */
  shadowMask?: number;
  /** shadow passes skip instances whose bounding diameter is below this many shadow texels (default 0) */
  minShadowTexels?: number;
  /** instance positions change every frame (vehicles): bounds come from the live matrix, no tile lists */
  dynamic?: boolean;
  /** number of tile index sets (default 1): tile ids run over [0, culler tiles^2 * tileSets), e.g. one set per
   *  instance class so whole classes can be skipped per tile (tile bounds come from the instances, not the culler) */
  tileSets?: number;
  /** main pass: cull per tile only (no per-instance frustum tests in partly visible tiles; for many small
   *  instances such as props the per-instance tests cost more CPU than the few extra clipped vertices) */
  coarse?: boolean;
}

interface PassSlot {
  camera: THREE.Camera;
  starts: Int32Array;
  counts: Int32Array;
  /** instance ids of the list (copied into the indirect texture, which is sized to the list, not the capacity) */
  ids: Uint32Array;
  tex: THREE.DataTexture;
  texCap: number;
  cap: number;
  count: number;
  version: number;
  /** geometry-swap counter the list's draw ranges were written for (see setGeometry) */
  geoVersion: number;
  key: Float64Array;
  used: number;
  /** camera position the list was culled at and the guard band (world units) its planes were widened by: the list
   *  stays valid while the camera only translates, by less than the band */
  px: number;
  py: number;
  pz: number;
  margin: number;
  /** receiver shape / origin the list was culled for (shadow passes; shape -1 = none) */
  rshape: number;
  rx: number;
  ry: number;
  rz: number;
  /** consecutive frames the camera stood still (a guard-banded list is re-culled exactly once the view rests) */
  still: number;
  /** frames the current list has served; rebuilds left without a guard band (a band that was outrun or whose list
   *  was invalidated by content changes right away only cost triangles) */
  uses: number;
  noBand: number;
  lx: number;
  ly: number;
  lz: number;
}

const _frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _m4 = new THREE.Matrix4();
/** scratch world sphere (x, y, z, r) of sphereOf() */
const _sp = new Float64Array(4);
/** receiver planes (nx, ny, nz, constant) x 6 and their normal . light terms, flattened for the list build's hot loops
 *  (the tests are inlined there: calls with many double arguments box numbers whenever V8 does not inline them) */
const _rp = new Float64Array(24);
const _rnl = new Float64Array(6);
/** frames a camera must rest before a guard-banded list is re-culled exactly */
const SETTLE_FRAMES = 8;
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
  /** bumped whenever the draw lists could change (instances, visibility, tiles, bounds) */
  private version = 1;
  /** bumped by geometry swaps that keep the culling bounds (LOD): cached lists only refresh their draw ranges */
  private geoVersion = 0;
  /** guard band of the per-pass lists, as a fraction of the view distance: a list culled with planes widened by it
   *  is reused while the camera only pans / slides by less (0 = exact lists, rebuilt on any camera move). Main
   *  passes use the view camera's distance to the ground, shadow passes the receiver's. */
  guard = 0.06;
  private instTile = new Int32Array(0);
  private instSlot = new Int32Array(0);
  private sph = new Float32Array(0);
  /** per-instance shadow cascade mask (bit i = casts into cascade i), ANDed with the batch-wide shadowMask */
  private instMask = new Uint8Array(0);
  /** typed mirrors of three's per-instance state for the list build: 1 = active and visible; geometry id */
  private instVis = new Uint8Array(0);
  private instGeo = new Int32Array(0);
  private tileLists: number[][] = [];
  /** per-tile bounds of the instance spheres [x0, y0, z0, x1, y1, z1] */
  private tileBox = new Float32Array(0);
  /** per-tile smallest instance radius (tiles whose casters are all above the shadow size cutoff skip the
   *  per-instance size test) and OR of the instance cascade masks */
  private tileMinR = new Float32Array(0);
  private tileMask = new Uint8Array(0);
  /** tile stats (box / min radius / mask) need a recompute from the tile's list (lazy, at the next list build) */
  private tileDirty = new Uint8Array(0);
  /** tiles disabled by the owner (skipped in every pass) */
  private tileOff = new Uint8Array(0);
  /** per-tile content version (visibility / geometry / masks / membership) and cached packed draw ranges per pass
   *  class (0 main, 1 cascade 0, 2 cascade 1): tiles that need no per-instance test are copied in one block */
  private tileVer = new Uint32Array(0);
  private tileCache: ({ ver: number; n: number; s: Int32Array; c: Int32Array; i: Uint32Array } | null)[] = [];
  private untiled: number[] = [];
  /** main-pass draw lists are sorted front to back (nearest first): opaque overdraw is rejected by the depth test
   *  before shading (big occluders such as buildings; cheap counting sort, only when a list is rebuilt) */
  sortFront = false;
  private sortKey = new Uint8Array(0);
  private sortTmp = new Int32Array(0);
  private sortCnt = new Int32Array(257);
  private gStart = new Int32Array(0);
  private gCount = new Int32Array(0);
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
    // own depth material: three's shared shadow depth material would switch programs (batched / instanced / plain,
    // with / without colour texture) between consecutive casters, re-deriving program parameters every time
    this.mesh.customDepthMaterial = new THREE.MeshDepthMaterial();
    this.mesh.customDepthMaterial.name = name + '-depth';
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
      this.instVis[id] = 1;
      this.instGeo[id] = geomId;
      if (this.pc.dynamic) { this.instSlot[id] = this.untiled.length; this.untiled.push(id); }
    }
    this.touch();
    return id;
  }

  remove(id: number): void {
    this.live--;
    if (this.pc) {
      this.unlink(id);
      this.instVis[id] = 0;
      this.instGeo[id] = -1;
    }
    this.mesh.deleteInstance(id);
    this.touch();
  }

  setGeometry(id: number, geomId: number): void {
    const m = this.mesh as any;
    if (m._instanceInfo[id].geometryIndex === geomId) return;
    this.mesh.setGeometryIdAt(id, geomId);
    if (!this.pc) { this.touch(); return; }
    this.instGeo[id] = geomId;
    this.bumpTile(id);
    // cached draw lists stay valid while the instance's culling sphere still bounds the new geometry (LOD swaps, see
    // shareSphere): they only refresh their draw ranges (no re-cull, no indirect texture upload). Otherwise the
    // sphere is rewritten exactly and the lists are rebuilt.
    if (!this.pc.dynamic) {
      this.mesh.getMatrixAt(id, _m4);
      const p = this.sph, o = id * 4;
      if (!this.sphereOf(geomId, _m4) || p[o + 3] < 0) this.writeSphere(id, _m4, true);
      else {
        const dx = _sp[0] - p[o], dy = _sp[1] - p[o + 1], dz = _sp[2] - p[o + 2];
        const contained = Math.sqrt(dx * dx + dy * dy + dz * dz) + _sp[3] <= p[o + 3] * 1.001 + 0.01;
        // much smaller new geometry (model replaced): tighten the bounds
        if (!contained || _sp[3] < p[o + 3] * 0.6) this.writeSphere(id, _m4, true);
      }
    }
    this.geoVersion++;
    if (this.mesh.castShadow) shadowCasters.version++;
  }

  /** grow a geometry's culling sphere so it also bounds anything within `pad` of its bounding box (call before
   *  instances use it) */
  padSphere(id: number, pad: number): void {
    const S = this.geoSphere[id];
    if (S) S.radius += pad * Math.sqrt(3); // the padded box's corners
  }

  /** give two geometries (e.g. a model and its LOD proxy) the same culling sphere, so swapping an instance between
   *  them never changes its bounds (no draw-list rebuild): a's (padded) sphere when b's bounds lie within a's bounds
   *  + pad, else the union of both spheres */
  shareSphere(a: number, b: number, pad = 0): void {
    const A = this.geoSphere[a], B = this.geoSphere[b];
    if (!A || !B || a === b) return;
    if (pad > 0 && this.geoBounds[a].clone().expandByScalar(pad).containsBox(this.geoBounds[b])) { this.geoSphere[b] = A.clone(); return; }
    const d = A.center.distanceTo(B.center);
    let u: THREE.Sphere;
    if (d + B.radius <= A.radius) u = A.clone();
    else if (d + A.radius <= B.radius) u = B.clone();
    else {
      const r = (d + A.radius + B.radius) / 2;
      u = new THREE.Sphere(A.center.clone().lerp(B.center, (r - A.radius) / d), r);
    }
    this.geoSphere[a] = u;
    this.geoSphere[b] = u.clone();
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
    if (this.pc && info) { this.instVis[id] = v && info.active ? 1 : 0; this.bumpTile(id); }
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
    this.pc = { shadowMask: 0xff, minShadowTexels: 0, dynamic: false, tileSets: 1, ...opts };
    const T = opts.culler.tiles * opts.culler.tiles * (this.pc.tileSets ?? 1);
    this.tileLists = Array.from({ length: T }, () => []);
    this.tileBox = new Float32Array(T * 6);
    this.tileMinR = new Float32Array(T);
    this.tileMask = new Uint8Array(T);
    this.tileDirty = new Uint8Array(T).fill(1);
    this.tileOff = new Uint8Array(T);
    this.tileVer = new Uint32Array(T);
    this.tileCache = new Array(T * 3).fill(null);
    this.ensureCap(this.mesh.maxInstanceCount);
    this.instTile.fill(-1);
    this.instSlot.fill(-1);
    // mirror instances that already exist
    const info = (this.mesh as any)._instanceInfo as { active: boolean; visible: boolean; geometryIndex: number }[];
    for (let i = 0; i < info.length; i++) {
      this.instVis[i] = info[i].active && info[i].visible ? 1 : 0;
      this.instGeo[i] = info[i].active ? info[i].geometryIndex : -1;
    }
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
    const t = this.instTile[id];
    if (t >= 0) { this.tileDirty[t] = 1; this.tileVer[t]++; }
    this.touch();
  }

  private bumpTile(id: number): void {
    const t = id < this.instTile.length ? this.instTile[id] : -1;
    if (t >= 0) this.tileVer[t]++;
  }

  /** enable / disable a whole tile (all its instances, every pass) without touching the instances */
  setTileEnabled(tile: number, on: boolean): void {
    if (!this.pc || tile < 0 || tile >= this.tileOff.length) return;
    const off = on ? 0 : 1;
    if (this.tileOff[tile] === off) return;
    this.tileOff[tile] = off;
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
    if (tile >= 0) { this.growTile(tile, id); this.tileVer[tile]++; }
    this.touch();
  }

  /** grow a tile's stats by one instance (bounds / min radius / mask only widen: conservative until the next exact
   *  recompute, which happens after removals) */
  private growTile(t: number, id: number): void {
    this.tileMask[t] |= this.instMask[id];
    if (this.tileDirty[t]) return;
    const p = this.sph, o = id * 4, r = p[o + 3];
    const b = this.tileBox, k = t * 6;
    if (r < 0) { this.tileMinR[t] = 0; b[k] = b[k + 1] = b[k + 2] = -Infinity; b[k + 3] = b[k + 4] = b[k + 5] = Infinity; return; }
    if (r < this.tileMinR[t]) this.tileMinR[t] = r;
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
    if (t >= 0) { this.tileDirty[t] = 1; this.tileVer[t]++; }
  }

  /** recompute a tile's bounds / smallest radius / cascade mask from its instances */
  private tileStats(t: number): void {
    this.tileDirty[t] = 0;
    const list = this.tileLists[t], p = this.sph, mk = this.instMask;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, minR = Infinity, mask = 0;
    for (let j = 0; j < list.length; j++) {
      const id = list[j], o = id * 4, r = p[o + 3];
      mask |= mk[id];
      if (r < 0) { minR = 0; x0 = y0 = z0 = -Infinity; x1 = y1 = z1 = Infinity; continue; } // no bounds yet: always test
      if (r < minR) minR = r;
      if (p[o] - r < x0) x0 = p[o] - r;
      if (p[o + 1] - r < y0) y0 = p[o + 1] - r;
      if (p[o + 2] - r < z0) z0 = p[o + 2] - r;
      if (p[o] + r > x1) x1 = p[o] + r;
      if (p[o + 1] + r > y1) y1 = p[o + 1] + r;
      if (p[o + 2] + r > z1) z1 = p[o + 2] + r;
    }
    const b = this.tileBox, k = t * 6;
    b[k] = x0; b[k + 1] = y0; b[k + 2] = z0; b[k + 3] = x1; b[k + 4] = y1; b[k + 5] = z1;
    this.tileMinR[t] = minR;
    this.tileMask[t] = mask;
  }

  private ensureCap(n: number): void {
    if (this.instTile.length >= n) return;
    const cap = Math.max(n, this.instTile.length * 2, 64);
    const t = new Int32Array(cap).fill(-1); t.set(this.instTile); this.instTile = t;
    const s = new Int32Array(cap).fill(-1); s.set(this.instSlot); this.instSlot = s;
    const p = new Float32Array(cap * 4); p.set(this.sph); this.sph = p;
    const mk = new Uint8Array(cap).fill(0xff); mk.set(this.instMask); this.instMask = mk;
    const v = new Uint8Array(cap); v.set(this.instVis); this.instVis = v;
    const g = new Int32Array(cap).fill(-1); g.set(this.instGeo); this.instGeo = g;
  }

  /** world bounding sphere for culling. Y scale is clamped to >= 1 so pop-in / construction growth (sy < 1) never
   *  changes the bounds (no list rebuilds while buildings animate). */
  private writeSphere(id: number, m: THREE.Matrix4, force: boolean): void {
    const gid = (this.mesh as any)._instanceInfo[id].geometryIndex as number;
    if (!this.sphereOf(gid, m)) return;
    const cx = _sp[0], cy = _sp[1], cz = _sp[2], r = _sp[3];
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

  /** world bounding sphere of geometry gid under matrix m -> _sp; false if the geometry is unknown */
  private sphereOf(gid: number, m: THREE.Matrix4): boolean {
    const gs = this.geoSphere[gid];
    if (!gs) return false;
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
    _sp[0] = cx; _sp[1] = cy; _sp[2] = cz; _sp[3] = gs.radius * Math.max(sx, sy, sz);
    return true;
  }

  private slotFor(camera: THREE.Camera): PassSlot {
    const m = this.mesh as any;
    let s = this.slots.find((x) => x.camera === camera);
    if (!s) {
      if (this.slots.length >= 6) {
        // evict the least recently used slot (e.g. one-off capture cameras)
        this.slots.sort((a, b) => a.used - b.used);
        const old = this.slots.shift()!;
        old.tex?.dispose();
      }
      s = {
        camera, starts: new Int32Array(0), counts: new Int32Array(0), ids: new Uint32Array(0), tex: null as unknown as THREE.DataTexture, texCap: 0, cap: -1, count: 0,
        version: -1, geoVersion: -1, key: new Float64Array(17), used: 0, px: 0, py: 0, pz: 0, margin: 0, rshape: -1, rx: 0, ry: 0, rz: 0, still: 0, lx: NaN, ly: NaN, lz: NaN, uses: 0, noBand: 0,
      };
      this.slots.push(s);
    }
    const cap = m._maxInstanceCount as number;
    if (s.cap !== cap) {
      s.starts = new Int32Array(cap);
      s.counts = new Int32Array(cap);
      s.ids = new Uint32Array(cap);
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
    const e = _pm.elements, w = camera.matrixWorld.elements;
    const k = s.key;
    const texel = shadow ? ((camera.userData.texel as number | undefined) ?? 0) : 0;
    const recv = shadow ? ((camera.userData.recv as ShadowReceiver | undefined) ?? null) : null;
    // a list stays valid while the content, the camera's rotation / projection (columns 0-2 of proj * view; a
    // translation only changes column 3) and the receiver's shape are unchanged and the camera (and the receiver)
    // moved by less than the guard band the list was culled with. Small tolerance: a still, damped camera jitters by
    // float ulps.
    let turned = k[16] !== texel || (recv ? recv.shape : -1) !== s.rshape;
    for (let i = 0; i < 12 && !turned; i++) if (Math.abs(k[i] - e[i]) > 1e-7 * Math.max(1, Math.abs(e[i]))) turned = true;
    let same = s.version === this.version && !turned;
    // camera speed (world units per pass of this slot, ~per frame); a damped camera settling by less than a
    // millimetre counts as still
    const step = s.lx === s.lx ? Math.hypot(w[12] - s.lx, w[13] - s.ly, w[14] - s.lz) : Infinity;
    s.lx = w[12]; s.ly = w[13]; s.lz = w[14];
    s.still = step > 1e-3 ? 0 : s.still + 1;
    if (same) {
      const tol = s.margin + 1e-6 * (1 + Math.abs(w[12]) + Math.abs(w[13]) + Math.abs(w[14]));
      const dx = w[12] - s.px, dy = w[13] - s.py, dz = w[14] - s.pz;
      if (dx * dx + dy * dy + dz * dz > tol * tol) same = false;
      else if (recv) {
        const o = recv.origin, ex = o.x - s.rx, ey = o.y - s.ry, ez = o.z - s.rz;
        if (ex * ex + ey * ey + ez * ez > tol * tol) same = false;
      }
      // the view came to rest: cull exactly once (no guard band drawn while nothing moves)
      if (same && s.margin > 0 && s.still === SETTLE_FRAMES) same = false;
    }
    if (!same) {
      // a banded list that served a single frame bought nothing: build the next few lists exactly
      if (s.margin > 0 && s.uses < 2) s.noBand = 8;
      else if (s.noBand > 0) s.noBand--;
      s.uses = 1;
      for (let i = 0; i < 16; i++) k[i] = e[i];
      k[16] = texel;
      s.version = this.version;
      s.geoVersion = this.geoVersion;
      s.px = w[12]; s.py = w[13]; s.pz = w[14];
      s.rshape = recv ? recv.shape : -1;
      if (recv) { s.rx = recv.origin.x; s.ry = recv.origin.y; s.rz = recv.origin.z; }
      // guard band: ~4 frames of the current camera speed, at most `guard` x the view distance (capped: far views
      // are GPU-bound and their pans fast, a wide band would mostly add triangles); none for a resting view, while
      // the view turns / zooms (a rotated frustum invalidates the list anyway) or when the camera moves too fast for
      // the band to outlast a frame or so (it would only enlarge every list)
      const reach = recv ? recv.reach : shadow ? 0 : viewReach(camera);
      const cap = this.guard * Math.min(reach, 1500);
      s.margin = cap > 0 && !turned && s.still < SETTLE_FRAMES && !this.pc.dynamic && s.noBand === 0 && step < cap * 0.75 ? Math.min(cap, 4 * step) : 0;
      this.build(s, shadow ? ((camera.userData.cascade as number | undefined) ?? 0) : -1, texel, geometry, recv);
    } else {
      s.uses++;
      if (s.geoVersion !== this.geoVersion) {
        s.geoVersion = this.geoVersion;
        this.refreshRanges(s, geometry);
      }
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
      // guard band: widen every plane (and the receiver tests) so the list also covers the camera translated by it
      const mr = s.margin;
      if (mr > 0) for (let p = 0; p < 6; p++) planes[p].constant += mr;
      this.drawRanges(geometry);
      const gS = this.gStart, gC = this.gCount;
      const starts = s.starts, counts = s.counts, ind = s.ids;
      const minR = cascade >= 0 ? pc.minShadowTexels! * texel * 0.5 : 0;
      const sph = this.sph;
      const dyn = pc.dynamic;
      const mat = dyn ? (m._matricesTexture.image.data as Float32Array) : null;
      const cbit = cascade >= 0 ? 1 << cascade : 0;
      const imask = this.instMask, vis = this.instVis, geo = this.instGeo, gsph = this.geoSphere;
      const coarse = pc.coarse === true, cls = cascade < 0 ? 0 : Math.min(2, cascade + 1);
      const rp = _rp, rnl = _rnl;
      let rGround = 0, rInv = 0;
      if (recv) {
        for (let i = 0; i < 6; i++) {
          const pl = recv.planes[i], nn = pl.normal;
          rp[i * 4] = nn.x; rp[i * 4 + 1] = nn.y; rp[i * 4 + 2] = nn.z; rp[i * 4 + 3] = pl.constant;
          rnl[i] = recv.nl[i];
        }
        rGround = recv.ground;
        rInv = 1 / Math.max(recv.dir.y, 0.05);
      }
      // test: per-instance frustum test; size / rcv: per-instance caster size / receiver tests (shadow passes)
      const pushList = (list: number[], test: boolean, size: boolean, rcv: boolean) => {
        for (let j = 0; j < list.length; j++) {
          const id = list[j];
          if (!vis[id]) continue;
          if (cbit && !(imask[id] & cbit)) continue;
          const gid = geo[id];
          if (test || size || rcv) {
            let cx: number, cy: number, cz: number, r: number;
            if (mat) {
              const gs = gsph[gid];
              const o = id * 16;
              cx = mat[o + 12]; cy = mat[o + 13]; cz = mat[o + 14];
              r = gs.radius + gs.center.length();
            } else {
              const o = id * 4;
              cx = sph[o]; cy = sph[o + 1]; cz = sph[o + 2]; r = sph[o + 3];
            }
            if (size && r < minR) continue;
            // shadow passes: only casters whose shadow (the sphere swept away from the light down to the ground) can
            // reach the visible part of this cascade (receiverSweepSphere, band-widened)
            if (rcv) {
              const rr = r + mr;
              const T = Math.min(6000, Math.max(0, (cy + rr - rGround) * rInv));
              let hit = true;
              for (let i = 0; i < 6; i++) {
                const o = i * 4;
                const d0 = rp[o] * cx + rp[o + 1] * cy + rp[o + 2] * cz + rp[o + 3];
                if (d0 < -rr && d0 - T * rnl[i] < -rr) { hit = false; break; }
              }
              if (!hit) continue;
            }
            if (test) {
              let out = false;
              for (let p = 0; p < 6; p++) {
                const pl = planes[p], nn = pl.normal;
                if (nn.x * cx + nn.y * cy + nn.z * cz + pl.constant < -r) { out = true; break; }
              }
              if (out) continue;
            }
          }
          starts[n] = gS[gid];
          counts[n] = gC[gid];
          ind[n] = id;
          n++;
        }
      };
      if (!dyn) {
        const tb = this.tileBox, off = this.tileOff, dirty = this.tileDirty, tmask = this.tileMask, tminR = this.tileMinR;
        for (let ti = 0; ti < this.tileLists.length; ti++) {
          const list = this.tileLists[ti];
          if (!list.length || off[ti]) continue;
          if (dirty[ti]) this.tileStats(ti);
          if (cbit && !(tmask[ti] & cbit)) continue;
          const k = ti * 6;
          const x0 = tb[k], y0 = tb[k + 1], z0 = tb[k + 2], x1 = tb[k + 3], y1 = tb[k + 4], z1 = tb[k + 5];
          if (!(x1 >= x0) || !Number.isFinite(x0 + x1)) { pushList(list, true, minR > 0, recv !== null); continue; }
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
          // receiver: skip the tile if no caster in it can shadow the visible slice (receiverSweepBox of the band-widened
          // box); no per-instance test if the whole tile lies inside the slice (receiverContainsBox)
          let rcv = false;
          if (recv) {
            const bx0 = x0 - mr, by0 = y0 - mr, bz0 = z0 - mr, bx1 = x1 + mr, by1 = y1 + mr, bz1 = z1 + mr;
            const T = Math.min(6000, Math.max(0, (by1 - rGround) * rInv));
            let hit = true;
            for (let i = 0; i < 6; i++) {
              const o = i * 4, nx = rp[o], ny = rp[o + 1], nz = rp[o + 2];
              const d = nx * (nx > 0 ? bx1 : bx0) + ny * (ny > 0 ? by1 : by0) + nz * (nz > 0 ? bz1 : bz0) + rp[o + 3];
              if (d < 0 && d - T * rnl[i] < 0) { hit = false; break; }
            }
            if (!hit) continue;
            for (let i = 0; i < 6; i++) {
              const o = i * 4, nx = rp[o], ny = rp[o + 1], nz = rp[o + 2];
              if (nx * (nx > 0 ? x0 : x1) + ny * (ny > 0 ? y0 : y1) + nz * (nz > 0 ? z0 : z1) + rp[o + 3] < 0) { rcv = true; break; }
            }
          }
          const test = !inside && !(coarse && cascade < 0), size = minR > 0 && tminR[ti] < minR;
          if (test || size || rcv) { pushList(list, test, size, rcv); continue; }
          // every visible instance of the tile (with the cascade bit) is drawn: copy its cached block
          const ck = ti * 3 + cls;
          let cc = this.tileCache[ck];
          if (!cc || cc.ver !== this.tileVer[ti]) {
            if (!cc || cc.s.length < list.length) cc = this.tileCache[ck] = { ver: 0, n: 0, s: new Int32Array(list.length + 16), c: new Int32Array(list.length + 16), i: new Uint32Array(list.length + 16) };
            let m2 = 0;
            for (let j = 0; j < list.length; j++) {
              const id = list[j];
              if (!vis[id] || (cbit && !(imask[id] & cbit))) continue;
              const gid = geo[id];
              cc.s[m2] = gS[gid]; cc.c[m2] = gC[gid]; cc.i[m2] = id; m2++;
            }
            cc.n = m2;
            cc.ver = this.tileVer[ti];
          }
          // (element loop: subarray() views would allocate three objects per tile)
          const cs = cc.s, ccn = cc.c, ci = cc.i, cn = cc.n;
          for (let j = 0; j < cn; j++) { starts[n + j] = cs[j]; counts[n + j] = ccn[j]; ind[n + j] = ci[j]; }
          n += cn;
        }
      }
      pushList(this.untiled, true, minR > 0, recv !== null);
      if (cascade < 0 && this.sortFront && !dyn && n > 1) this.sortList(s, n, ind);
    }
    s.count = n;
    // indirect (instance id) texture sized to the list (power-of-two side, grown / shrunk with slack): a rebuild uploads
    // the list, not the batch's whole instance capacity
    if (!s.tex || s.texCap < n || (s.texCap > 4096 && n * 8 < s.texCap)) {
      s.tex?.dispose();
      const side = Math.max(16, 1 << Math.ceil(Math.log2(Math.ceil(Math.sqrt(Math.max(1, n) * 1.25)))));
      s.tex = new THREE.DataTexture(new Uint32Array(side * side), side, side, THREE.RedIntegerFormat, THREE.UnsignedIntType);
      s.texCap = side * side;
    }
    (s.tex.image.data as unknown as Uint32Array).set(s.ids.subarray(0, n));
    s.tex.needsUpdate = true;
  }

  /** draw range (index start in bytes, count) per geometry id -> gStart / gCount */
  private drawRanges(geometry: THREE.BufferGeometry): void {
    const gInfo = (this.mesh as any)._geometryInfo as { start: number; count: number }[];
    const index = geometry.getIndex();
    const bpe = index === null ? 1 : index.array.BYTES_PER_ELEMENT;
    if (this.gStart.length < gInfo.length) { this.gStart = new Int32Array(gInfo.length * 2); this.gCount = new Int32Array(gInfo.length * 2); }
    const gS = this.gStart, gC = this.gCount;
    for (let g = 0; g < gInfo.length; g++) { const gi = gInfo[g]; gS[g] = gi ? gi.start * bpe : 0; gC[g] = gi ? gi.count : 0; }
  }

  /** geometry swaps only: rewrite the draw ranges of a cached list in place (same instances, same order) */
  private refreshRanges(s: PassSlot, geometry: THREE.BufferGeometry): void {
    this.drawRanges(geometry);
    const gS = this.gStart, gC = this.gCount, geo = this.instGeo, ids = s.ids, starts = s.starts, counts = s.counts;
    for (let j = 0; j < s.count; j++) { const g = geo[ids[j]]; starts[j] = gS[g]; counts[j] = gC[g]; }
  }

  /** counting sort of the first n list entries by distance from the camera (sqrt-spaced buckets: fine up close) */
  private sortList(s: PassSlot, n: number, ind: Uint32Array): void {
    const e = s.camera.matrixWorld.elements;
    const px = e[12], py = e[13], pz = e[14];
    if (this.sortKey.length < n) { this.sortKey = new Uint8Array(s.cap); this.sortTmp = new Int32Array(s.cap * 3); }
    const key = this.sortKey, tmp = this.sortTmp, cnt = this.sortCnt, sph = this.sph;
    const starts = s.starts, counts = s.counts;
    cnt.fill(0);
    for (let i = 0; i < n; i++) {
      const o = ind[i] * 4;
      const dx = sph[o] - px, dy = sph[o + 1] - py, dz = sph[o + 2] - pz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - sph[o + 3];
      const k = d <= 0 ? 0 : Math.min(255, (Math.sqrt(d) * 4) | 0);
      key[i] = k;
      cnt[k + 1]++;
    }
    for (let b = 1; b < 257; b++) cnt[b] += cnt[b - 1];
    const T1 = n, T2 = n * 2;
    for (let i = 0; i < n; i++) {
      const j = cnt[key[i]]++;
      tmp[j] = starts[i]; tmp[T1 + j] = counts[i]; tmp[T2 + j] = ind[i];
    }
    starts.set(tmp.subarray(0, n));
    counts.set(tmp.subarray(T1, T2));
    for (let i = 0; i < n; i++) ind[i] = tmp[T2 + i];
  }

  dispose(): void {
    // the mesh disposes whichever indirect texture it currently holds; dispose the others
    const cur = (this.mesh as any)._indirectTexture;
    for (const s of this.slots) if (s.tex && s.tex !== cur) s.tex.dispose();
    this.slots.length = 0;
    this.mesh.customDepthMaterial?.dispose();
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
