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
 * Guard bands: while the camera moves, a list is culled with its planes widened (translation band ~4 frames of the
 * camera speed; perspective views also turned outward by an angular band, receivers likewise) and reused until the
 * camera leaves the band; once the view rests it is culled exactly again.
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
  /** cull per tile only, in every pass (no per-instance frustum / receiver tests in partly visible tiles; for many
   *  small instances such as props the per-instance tests cost more CPU than the few extra clipped vertices) */
  coarse?: boolean;
}

interface PassSlot {
  camera: THREE.Camera;
  /** draw list (grown on demand: sized to the lists, not the batch capacity) */
  starts: Int32Array;
  counts: Int32Array;
  /** instance ids of the list (copied into the indirect texture, which is sized to the list, not the capacity) */
  ids: Uint32Array;
  tex: THREE.DataTexture;
  texCap: number;
  count: number;
  version: number;
  /** swap-log position (DynamicBatch.swapSeq) the list's draw ranges are current for (see setGeometry) */
  swapAt: number;
  /** list generation (bumped per build) and the generation `pos` was built for (-1 none) */
  gen: number;
  posGen: number;
  /** instance id -> list index, valid where ids[pos[id]] === id (built on the first patch of a list) */
  pos: Int32Array;
  /** tile-level (coarse) lists: the selected tiles of the last build in list order (tile * 4 + kind, kind 1 = caster
   *  size test), their content versions and block offsets, the list length after them and the size cutoff they were
   *  filtered with; a rebuild keeps the longest unchanged prefix of blocks in place (selValid) */
  selT: Int32Array;
  selV: Uint32Array;
  selO: Int32Array;
  selN: number;
  selEnd: number;
  selMinR: number;
  selValid: boolean;
  used: number;
  // ---- what the list was culled for (see beforePass)
  /** projection shape (elements 0, 5, 8, 9, 12, 13: fov / aspect / ortho extent; near / far are checked separately) */
  shape: Float64Array;
  /** camera orientation (unit axes) and the rotation (rad) the list tolerates (its angular band) */
  rot: Float64Array;
  tiltOk: number;
  /** depth range [nearB, farB] the list covers (near / far may move inside it) */
  nearB: number;
  farB: number;
  texel: number;
  /** camera position the list was culled at and the translation band (world units) its planes were widened by */
  px: number;
  py: number;
  pz: number;
  margin: number;
  /** list was culled with any band (re-culled exactly once the view rests) */
  banded: boolean;
  /** receiver (shadow passes): form counter, view orientation + tolerated rotation, origin, covered slice [rdn, rdf] */
  rform: number;
  rrot: Float64Array;
  rtiltOk: number;
  rx: number;
  ry: number;
  rz: number;
  rdn: number;
  rdf: number;
  // ---- motion tracking
  /** consecutive frames the camera (and the receiver) stood still */
  still: number;
  /** frames the current list has served; rebuilds left without a band (a band that was outrun or whose list was
   *  invalidated by content changes right away only costs triangles) */
  uses: number;
  noBand: number;
  lx: number;
  ly: number;
  lz: number;
  lrot: Float64Array;
  lrrot: Float64Array;
  lrx: number;
  lry: number;
  lrz: number;
}

const _frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _m4 = new THREE.Matrix4();
/** scratch world sphere (x, y, z, r) of sphereOf() */
const _sp = new Float64Array(4);
/** frustum planes (nx, ny, nz, constant) x 6 and receiver planes x 6 + their normal . light terms, flattened for the
 *  list build's hot loops (the tests are inlined there: calls with many double arguments box numbers whenever V8
 *  does not inline them) */
const _fp = new Float64Array(24);
const _rp = new Float64Array(24);
const _rnl = new Float64Array(6);
/** list-build doubles handed to pushList (guard band, min caster radius, receiver ground, 1 / light dir y) */
const _plf = new Float64Array(4);
/** current camera orientation */
const _rot = new Float64Array(9);
/** frames a camera must rest before a guard-banded list is re-culled exactly */
const SETTLE_FRAMES = 8;
/** angular band cap (rad): wider bands keep lists through faster turns but draw more of the periphery */
const TILT_CAP = (3 * Math.PI) / 180;
/** rotation below this counts as none (a still, damped camera jitters by float ulps) */
const TURN_EPS = 2e-6;
/** max recorded texture update ranges per frame before falling back to one full upload */
const MAX_RANGES = 96;
/** geometry swap log (ring of instance ids, see setGeometry): a cached list more swaps behind than this, or behind by
 *  more than 1 / SWAP_FULL of its length, rewrites all its draw ranges instead of patching the swapped entries */
const SWAP_RING = 4096;
const SWAP_FULL = 4;
let _frame = 0;

/** unit axes (columns 0-2) of a world matrix -> out[9] */
function orient(w: ArrayLike<number>, out: Float64Array): void {
  for (let c = 0; c < 3; c++) {
    const o = c * 4;
    const x = w[o], y = w[o + 1], z = w[o + 2];
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    out[c * 3] = x / l; out[c * 3 + 1] = y / l; out[c * 3 + 2] = z / l;
  }
}

/** equal within a relative 1e-9 (projection shapes: a still, damped camera jitters by float ulps) */
function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
}

/** rotation angle (rad) between two orientations (unit axes) */
function turnAngle(a: Float64Array, b: Float64Array): number {
  let t = 0;
  for (let i = 0; i < 9; i++) t += a[i] * b[i];
  const c = (t - 1) / 2;
  return c >= 1 ? 0 : c <= -1 ? Math.PI : Math.acos(c);
}

/** rotation (rad) a view cone of half-diagonal phi stays inside once its side planes are turned outward by A (the
 *  outward turn about a plane's hinge shrinks toward the cone's corners; 10% safety) */
function tiltHold(A: number, phi: number): number {
  return A > 0 ? 0.9 * Math.atan(Math.cos(Math.min(1.5, phi + 2 * A)) * Math.tan(A)) : 0;
}

/** angular band for a camera turning by `turn` rad per frame: ~4 frames of the turn, capped; 0 = not worth one */
function tiltFor(turn: number, phi: number): number {
  if (!(turn > TURN_EPS)) return 0;
  const hold = tiltHold(TILT_CAP, phi);
  if (turn * 1.3 > hold) return 0;
  const want = Math.min(hold, 4 * turn);
  // tiltHold is ~linear in A: scale the cap down to the wanted hold (then re-check)
  let A = TILT_CAP * (want / hold);
  if (tiltHold(A, phi) < want) A = Math.min(TILT_CAP, A * 1.1);
  return A;
}

/** turn the 4 side planes (through apex a) outward by A: each normal rotates toward the view direction f */
function tiltPlanes(pl: Float64Array, fx: number, fy: number, fz: number, ax: number, ay: number, az: number, A: number): void {
  const cA = Math.cos(A), sA = Math.sin(A);
  for (let i = 0; i < 4; i++) {
    const o = i * 4;
    const nx = pl[o], ny = pl[o + 1], nz = pl[o + 2];
    const fn = fx * nx + fy * ny + fz * nz;
    let ux = fx - fn * nx, uy = fy - fn * ny, uz = fz - fn * nz;
    const ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-9) continue;
    ux /= ul; uy /= ul; uz /= ul;
    const mx = nx * cA + ux * sA, my = ny * cA + uy * sA, mz = nz * cA + uz * sA;
    pl[o] = mx; pl[o + 1] = my; pl[o + 2] = mz; pl[o + 3] = -(mx * ax + my * ay + mz * az);
  }
}

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
  /** geometry swaps that keep the culling bounds (LOD): ring of swapped instance ids and the running swap count;
   *  cached lists patch just those entries' draw ranges (patchRanges) */
  private swapLog = new Int32Array(SWAP_RING);
  private swapSeq = 0;
  /** registered geometries changed (drawRanges' cache key, with the geometry count and index width) */
  private geoEpoch = 0;
  private rangesAt = -1;
  private rangesLen = -1;
  private rangesBpe = -1;
  /** per geometry: culling radius about the instance origin (sphere radius + |sphere centre|; dynamic batches) */
  private geoRad = new Float32Array(64);
  /** guard band of the per-pass lists, as a fraction of the view distance: a list culled with planes widened by it
   *  is reused while the camera only pans / slides by less (0 = exact lists, rebuilt on any camera move). Main
   *  passes use the view camera's distance to the ground, shadow passes the receiver's. */
  guard = 0.06;
  /** views farther out than this (m to the ground along the view axis; shadow passes: their slice) cull per tile only
   *  and skip the front-to-back sort: at that range instances are small (LOD proxies), overdraw is low and the lists
   *  change every frame while zooming, so per-instance work costs more CPU than it saves GPU */
  farReach = 2000;
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
  /** per-tile content version (visibility / masks / membership; not geometry swaps) and cached instance ids per pass
   *  class (0 main, 1 cascade 0, 2 cascade 1): tiles that need no per-instance test are copied in one block (draw ranges
   *  looked up from the current geometry, so LOD swaps never invalidate a block) */
  private tileVer = new Uint32Array(0);
  private tileCache: ({ ver: number; n: number; i: Uint32Array } | null)[] = [];
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
      this.geoEpoch++;
    }
    id = m.addGeometry(g);
    this.geo.set(key, id);
    this.geoEpoch++;
    if (!g.boundingBox) g.computeBoundingBox();
    this.geoBounds[id] = g.boundingBox!.clone();
    this.geoSphere[id] = g.boundingBox!.getBoundingSphere(new THREE.Sphere());
    this.noteRad(id);
    return id;
  }

  /** refresh geoRad[id] from the geometry's culling sphere */
  private noteRad(id: number): void {
    if (this.geoRad.length <= id) { const r = new Float32Array(Math.max(id + 1, this.geoRad.length * 2)); r.set(this.geoRad); this.geoRad = r; }
    const S = this.geoSphere[id];
    if (S) this.geoRad[id] = S.radius + S.center.length();
  }

  /** make room for `vertices` more vertices now (one reallocation, e.g. at load, instead of one while playing) */
  reserveVertices(vertices: number): void {
    const m = this.mesh;
    if (m.unusedVertexCount >= vertices) return;
    const cur = (m as any)._maxVertexCount as number;
    const next = cur - m.unusedVertexCount + Math.ceil(vertices * 1.25);
    m.setGeometrySize(next, next * 2);
    this.geoEpoch++;
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
    const prevGeom = m._instanceInfo[id].geometryIndex as number;
    if (prevGeom === geomId) return;
    this.mesh.setGeometryIdAt(id, geomId);
    if (!this.pc) { this.touch(); return; }
    this.instGeo[id] = geomId;
    // cached draw lists stay valid while the instance's culling sphere still bounds the new geometry (LOD swaps, see
    // shareSphere): they only patch this instance's draw range (swap log; no re-cull, no indirect texture upload; the
    // per-tile blocks hold instance ids, so they stay valid too). Otherwise the sphere is rewritten exactly and the
    // lists are rebuilt. Geometries sharing one culling sphere (model + proxy) skip the check.
    const ga = this.geoSphere[prevGeom], gb = this.geoSphere[geomId];
    const shared = ga && gb && ga.radius === gb.radius && ga.center.equals(gb.center) && this.sph[id * 4 + 3] >= 0;
    if (!this.pc.dynamic && !shared) {
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
    this.swapLog[this.swapSeq % SWAP_RING] = id;
    this.swapSeq++;
    if (this.mesh.castShadow) shadowCasters.version++;
  }

  /** grow a geometry's culling sphere so it also bounds anything within `pad` of its bounding box (call before
   *  instances use it) */
  padSphere(id: number, pad: number): void {
    const S = this.geoSphere[id];
    if (S) S.radius += pad * Math.sqrt(3); // the padded box's corners
    this.noteRad(id);
  }

  /** give two geometries (e.g. a model and its LOD proxy) the same culling sphere, so swapping an instance between
   *  them never changes its bounds (no draw-list rebuild): a's (padded) sphere when b's bounds lie within a's bounds
   *  + pad, else the union of both spheres */
  shareSphere(a: number, b: number, pad = 0): void {
    const A = this.geoSphere[a], B = this.geoSphere[b];
    if (!A || !B || a === b) return;
    if (pad > 0 && this.geoBounds[a].clone().expandByScalar(pad).containsBox(this.geoBounds[b])) { this.geoSphere[b] = A.clone(); this.noteRad(b); return; }
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
    this.noteRad(a);
    this.noteRad(b);
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
    if (this.mesh.castShadow) {
      shadowCasters.version++;
      if (this.pc?.dynamic) shadowCasters.dynamic++;
    }
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
    const slots = this.slots;
    let s: PassSlot | null = null;
    for (let i = 0; i < slots.length; i++) if (slots[i].camera === camera) { s = slots[i]; break; }
    if (!s) {
      if (slots.length >= 6) {
        // evict the least recently used slot (e.g. one-off capture cameras)
        let lru = 0;
        for (let i = 1; i < slots.length; i++) if (slots[i].used < slots[lru].used) lru = i;
        const old = slots.splice(lru, 1)[0];
        old.tex?.dispose();
      }
      s = {
        camera, starts: new Int32Array(64), counts: new Int32Array(64), ids: new Uint32Array(64), tex: null as unknown as THREE.DataTexture, texCap: 0, count: 0,
        version: -1, swapAt: 0, gen: 0, posGen: -1, pos: new Int32Array(0),
        selT: new Int32Array(64), selV: new Uint32Array(64), selO: new Int32Array(64), selN: 0, selEnd: 0, selMinR: 0, selValid: false, used: 0,
        shape: new Float64Array(6), rot: new Float64Array(9), tiltOk: 0, nearB: 0, farB: 0, texel: -1, px: 0, py: 0, pz: 0, margin: 0, banded: false,
        rform: -1, rrot: new Float64Array(9), rtiltOk: 0, rx: 0, ry: 0, rz: 0, rdn: 0, rdf: 0,
        still: 0, uses: 0, noBand: 0, lx: NaN, ly: NaN, lz: NaN, lrot: new Float64Array(9), lrrot: new Float64Array(9), lrx: NaN, lry: NaN, lrz: NaN,
      };
      this.slots.push(s);
    }
    s.used = _frame;
    return s;
  }

  /** grow a slot's list arrays to hold `need` entries (keeps the first n) */
  private ensureList(s: PassSlot, need: number, n: number): void {
    if (s.starts.length >= need) return;
    const cap = Math.max(need, Math.ceil(s.starts.length * 1.5), 64);
    const st = new Int32Array(cap), ct = new Int32Array(cap), id = new Uint32Array(cap);
    st.set(s.starts.subarray(0, n)); ct.set(s.counts.subarray(0, n)); id.set(s.ids.subarray(0, n));
    s.starts = st; s.counts = ct; s.ids = id;
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
    const w = camera.matrixWorld.elements, P = camera.projectionMatrix.elements;
    const texel = shadow ? ((camera.userData.texel as number | undefined) ?? 0) : 0;
    const recv = shadow ? ((camera.userData.recv as ShadowReceiver | undefined) ?? null) : null;
    const cam = camera as THREE.PerspectiveCamera;
    const persp = cam.isPerspectiveCamera === true;
    const near = typeof cam.near === 'number' ? cam.near : 0, far = typeof cam.far === 'number' ? cam.far : Infinity;
    orient(w, _rot);
    // motion since this slot's previous pass (~per frame): camera translation / rotation, receiver (view) likewise;
    // a damped camera settling by less than a millimetre counts as still
    const step = s.lx === s.lx ? Math.hypot(w[12] - s.lx, w[13] - s.ly, w[14] - s.lz) : Infinity;
    const turn = s.lx === s.lx ? turnAngle(_rot, s.lrot) : Infinity;
    s.lx = w[12]; s.ly = w[13]; s.lz = w[14];
    s.lrot.set(_rot);
    let rstep = 0, rturn = 0;
    if (recv) {
      const o = recv.origin;
      rstep = s.lrx === s.lrx ? Math.hypot(o.x - s.lrx, o.y - s.lry, o.z - s.lrz) : Infinity;
      rturn = s.lrx === s.lrx ? turnAngle(recv.rot, s.lrrot) : Infinity;
      s.lrx = o.x; s.lry = o.y; s.lrz = o.z;
      s.lrrot.set(recv.rot);
    }
    s.still = step > 1e-3 || turn > TURN_EPS || rstep > 1e-3 || rturn > TURN_EPS ? 0 : s.still + 1;
    // a list stays valid while the content, the projection shape and the texel are unchanged, near / far stay within
    // the depth range it was culled for, and the camera turned / moved by less than its bands (receiver likewise)
    let same = s.version === this.version && s.texel === texel && near >= s.nearB && far <= s.farB;
    if (same) {
      const sh = s.shape;
      if (!close(P[0], sh[0]) || !close(P[5], sh[1]) || !close(P[8], sh[2]) || !close(P[9], sh[3]) || !close(P[12], sh[4]) || !close(P[13], sh[5])) same = false;
    }
    if (same && turnAngle(_rot, s.rot) > Math.max(TURN_EPS, s.tiltOk)) same = false;
    if (same) {
      const tol = s.margin + 1e-6 * (1 + Math.abs(w[12]) + Math.abs(w[13]) + Math.abs(w[14]));
      const dx = w[12] - s.px, dy = w[13] - s.py, dz = w[14] - s.pz;
      if (dx * dx + dy * dy + dz * dz > tol * tol) same = false;
      else if (recv) {
        const o = recv.origin, ex = o.x - s.rx, ey = o.y - s.ry, ez = o.z - s.rz;
        if (ex * ex + ey * ey + ez * ez > tol * tol) same = false;
        else if (recv.form !== s.rform || recv.dn < s.rdn * (1 - 1e-9) - 1e-6 || recv.df > s.rdf * (1 + 1e-9) + 1e-6) same = false;
        else if (turnAngle(recv.rot, s.rrot) > Math.max(TURN_EPS, s.rtiltOk)) same = false;
      }
      // the view came to rest: cull exactly once (no band drawn while nothing moves)
      if (same && s.banded && s.still === SETTLE_FRAMES) same = false;
    }
    if (!same) {
      // a banded list that served a single frame bought nothing: build the next few lists exactly
      if (s.banded && s.uses < 2) s.noBand = 8;
      else if (s.noBand > 0) s.noBand--;
      s.uses = 1;
      s.version = this.version;
      s.texel = texel;
      s.shape[0] = P[0]; s.shape[1] = P[5]; s.shape[2] = P[8]; s.shape[3] = P[9]; s.shape[4] = P[12]; s.shape[5] = P[13];
      s.rot.set(_rot);
      s.px = w[12]; s.py = w[13]; s.pz = w[14];
      // bands: translation ~4 frames of the camera speed, at most `guard` x the view distance (capped: far views are
      // GPU-bound and their pans fast, a wide band would mostly add triangles); perspective views turning add an
      // angular band (~4 frames of the turn, <= TILT_CAP), receivers one for the view's turn. None for a resting
      // view, for dynamic batches, or when the camera moves too fast for a band to outlast a frame or so.
      const reach = recv ? recv.reach : shadow ? 0 : viewReach(camera);
      const cap = this.guard * Math.min(reach, 3000);
      const bandOk = cap > 0 && s.still < SETTLE_FRAMES && !this.pc.dynamic && s.noBand === 0;
      // (shadow passes: the band must also cover the receiver, which moves with the view, not the shadow camera)
      const move = Math.max(step, rstep);
      s.margin = bandOk && move < cap * 0.75 ? Math.min(cap, 4 * move) : 0;
      const phi = persp ? Math.atan(Math.hypot(1 / P[0], 1 / P[5]) + Math.hypot(P[8] / P[0], P[9] / P[5])) : 0;
      const tilt = bandOk && persp ? tiltFor(turn, phi) : 0;
      s.tiltOk = tiltHold(tilt, phi);
      const rtilt = bandOk && recv && recv.phi > 0 ? tiltFor(rturn, recv.phi) : 0;
      s.rtiltOk = tiltHold(rtilt, recv ? recv.phi : 0);
      s.banded = s.margin > 0 || tilt > 0 || rtilt > 0;
      // depth range: exact, or with slack while banded (near / far follow the zoom every frame)
      s.nearB = s.banded ? near * 0.5 : near;
      s.farB = s.banded ? far * 1.25 : far;
      if (recv) {
        s.rform = recv.form;
        s.rrot.set(recv.rot);
        s.rx = recv.origin.x; s.ry = recv.origin.y; s.rz = recv.origin.z;
        s.rdn = s.banded ? recv.dn * 0.5 : recv.dn;
        s.rdf = s.banded ? recv.df * 1.1 : recv.df;
      }
      this.build(s, shadow ? ((camera.userData.cascade as number | undefined) ?? 0) : -1, texel, geometry, recv, tilt, phi, rtilt, reach > this.farReach);
    } else {
      s.uses++;
      if (s.swapAt !== this.swapSeq) this.patchRanges(s, geometry);
    }
    m._multiDrawStarts = s.starts;
    m._multiDrawCounts = s.counts;
    m._multiDrawCount = s.count;
    m._indirectTexture = s.tex;
    m._visibilityChanged = false;
  }

  /** planes of the list build -> _fp (view / shadow camera) and _rp / _rnl (receiver), widened by the slot's bands */
  private cullPlanes(s: PassSlot, recv: ShadowReceiver | null, tilt: number, phi: number, rtilt: number): void {
    const cam = s.camera;
    _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), cam.coordinateSystem, (cam as any).reversedDepth);
    const fp = _fp, mr = s.margin;
    for (let i = 0; i < 6; i++) {
      const pl = _frustum.planes[i], n = pl.normal, o = i * 4;
      fp[o] = n.x; fp[o + 1] = n.y; fp[o + 2] = n.z; fp[o + 3] = pl.constant;
    }
    if (s.banded) {
      const w = cam.matrixWorld.elements;
      const ax = w[12], ay = w[13], az = w[14];
      // view direction (-Z axis)
      const fx = -s.rot[6], fy = -s.rot[7], fz = -s.rot[8];
      if (tilt > 0) tiltPlanes(fp, fx, fy, fz, ax, ay, az, tilt);
      for (let i = 0; i < 4; i++) fp[i * 4 + 3] += mr;
      // depth planes rebuilt for the covered range [nearB, farB] (turning moves a cone's depth by up to cos(phi -+ t))
      const t = s.tiltOk, kn = tilt > 0 ? Math.cos(Math.min(1.5, phi + t)) / Math.cos(phi) : 1, kf = tilt > 0 ? Math.cos(Math.max(0, phi - t)) / Math.cos(phi) : 1;
      const fa = fx * ax + fy * ay + fz * az;
      const nd = s.nearB * kn - mr, fd = s.farB * kf + mr;
      fp[16] = -fx; fp[17] = -fy; fp[18] = -fz; fp[19] = fa + fd; // far
      fp[20] = fx; fp[21] = fy; fp[22] = fz; fp[23] = -fa - nd; // near
    }
    if (!recv) return;
    const rp = _rp, rnl = _rnl, d = recv.dir;
    for (let i = 0; i < 6; i++) {
      const pl = recv.planes[i], n = pl.normal, o = i * 4;
      rp[o] = n.x; rp[o + 1] = n.y; rp[o + 2] = n.z; rp[o + 3] = pl.constant;
    }
    if (s.banded) {
      const o = recv.origin, f = recv.fwd, rph = recv.phi;
      if (rtilt > 0) tiltPlanes(rp, f.x, f.y, f.z, o.x, o.y, o.z, rtilt);
      for (let i = 0; i < 4; i++) rp[i * 4 + 3] += mr;
      const t = s.rtiltOk, kn = rtilt > 0 ? Math.cos(Math.min(1.5, rph + t)) / Math.cos(rph) : 1, kf = rtilt > 0 ? Math.cos(Math.max(0, rph - t)) / Math.cos(rph) : 1;
      const fo = f.x * o.x + f.y * o.y + f.z * o.z;
      const nd = s.rdn * kn - mr, fd = s.rdf * kf + mr;
      rp[16] = -f.x; rp[17] = -f.y; rp[18] = -f.z; rp[19] = fo + fd; // far
      rp[20] = f.x; rp[21] = f.y; rp[22] = f.z; rp[23] = -fo - nd; // near
    }
    for (let i = 0; i < 6; i++) rnl[i] = rp[i * 4] * d.x + rp[i * 4 + 1] * d.y + rp[i * 4 + 2] * d.z;
  }

  /**
   * Build a pass list; far: the view is far out (tile-level culling only, no front-to-back sort).
   * Tile-level (coarse, unsorted) lists are the selected tiles' blocks in tile order: a rebuild keeps the blocks of the
   * longest unchanged prefix of the previous selection in place and only rewrites the rest; an unchanged selection
   * keeps the whole list and skips the upload (a view that pans / turns / zooms without moving a tile boundary across
   * the frustum rebuilds nothing).
   */
  private build(s: PassSlot, cascade: number, texel: number, geometry: THREE.BufferGeometry, recv: ShadowReceiver | null, tilt: number, phi: number, rtilt: number, far = false): void {
    const pc = this.pc!;
    const m = this.mesh as any;
    // the list about to be rebuilt may keep a prefix: bring its draw ranges up to date first
    if (s.swapAt !== this.swapSeq) {
      if (s.selValid) this.patchRanges(s, geometry);
      else s.swapAt = this.swapSeq;
    }
    s.gen++;
    let n = 0;
    let keep = false;
    const dyn = pc.dynamic;
    const sorted = cascade < 0 && this.sortFront && !dyn && !far;
    const coarse = pc.coarse === true || far;
    if (cascade < 0 || (pc.shadowMask! >> cascade) & 1) {
      this.cullPlanes(s, recv, tilt, phi, rtilt);
      const fp = _fp, rp = _rp, rnl = _rnl;
      this.drawRanges(geometry);
      const gS = this.gStart, gC = this.gCount;
      const minR = cascade >= 0 ? pc.minShadowTexels! * texel * 0.5 : 0;
      const mat = dyn ? (m._matricesTexture.image.data as Float32Array) : null;
      const cbit = cascade >= 0 ? 1 << cascade : 0;
      const imask = this.instMask, vis = this.instVis, geo = this.instGeo;
      const cls = cascade < 0 ? 0 : Math.min(2, cascade + 1);
      let rGround = 0, rInv = 0;
      if (recv) {
        rGround = recv.ground;
        rInv = 1 / Math.max(recv.dir.y, 0.05);
      }
      _plf[0] = s.margin; _plf[1] = minR; _plf[2] = rGround; _plf[3] = rInv;
      // prefix reuse: tile-level lists only (fine lists hold per-instance results, sorted lists a camera order)
      const reuse = coarse && !sorted && !dyn;
      let match = reuse && s.selValid && s.selMinR === minR;
      let k = 0;
      if (!dyn) {
        const tb = this.tileBox, off = this.tileOff, dirty = this.tileDirty, tmask = this.tileMask, tminR = this.tileMinR, tver = this.tileVer;
        for (let ti = 0; ti < this.tileLists.length; ti++) {
          const list = this.tileLists[ti];
          if (!list.length || off[ti]) continue;
          if (dirty[ti]) this.tileStats(ti);
          if (cbit && !(tmask[ti] & cbit)) continue;
          const kb = ti * 6;
          const x0 = tb[kb], y0 = tb[kb + 1], z0 = tb[kb + 2], x1 = tb[kb + 3], y1 = tb[kb + 4], z1 = tb[kb + 5];
          // kind: 0 block copy, 1 per-instance caster size test, 2 per-instance tests (fine list / tile without bounds)
          let kind = 0;
          let test = false, size = false, rcv = false;
          if (!(x1 >= x0) || !Number.isFinite(x0 + x1)) { kind = 2; test = true; size = minR > 0; rcv = recv !== null; }
          else {
            let inside = true, outside = false;
            for (let p = 0; p < 6; p++) {
              const o = p * 4, nx = fp[o], ny = fp[o + 1], nz = fp[o + 2], c = fp[o + 3];
              // p-vertex (farthest along the normal) and n-vertex
              if (nx * (nx > 0 ? x1 : x0) + ny * (ny > 0 ? y1 : y0) + nz * (nz > 0 ? z1 : z0) + c < 0) { outside = true; break; }
              if (nx * (nx > 0 ? x0 : x1) + ny * (ny > 0 ? y0 : y1) + nz * (nz > 0 ? z0 : z1) + c < 0) inside = false;
            }
            if (outside) continue;
            // receiver: skip the tile if no caster in it can shadow the visible slice (receiverSweepBox; the band is in
            // the planes); no per-instance test if the whole tile lies inside the slice (receiverContainsBox)
            if (recv) {
              const T = Math.min(6000, Math.max(0, (y1 - rGround) * rInv));
              let hit = true;
              for (let i = 0; i < 6; i++) {
                const o = i * 4, nx = rp[o], ny = rp[o + 1], nz = rp[o + 2];
                const d = nx * (nx > 0 ? x1 : x0) + ny * (ny > 0 ? y1 : y0) + nz * (nz > 0 ? z1 : z0) + rp[o + 3];
                if (d < 0 && d - T * rnl[i] < 0) { hit = false; break; }
              }
              if (!hit) continue;
              if (!coarse) {
                for (let i = 0; i < 6; i++) {
                  const o = i * 4, nx = rp[o], ny = rp[o + 1], nz = rp[o + 2];
                  if (nx * (nx > 0 ? x0 : x1) + ny * (ny > 0 ? y0 : y1) + nz * (nz > 0 ? z0 : z1) + rp[o + 3] < 0) { rcv = true; break; }
                }
              }
            }
            test = !inside && !coarse;
            size = minR > 0 && tminR[ti] < minR;
            kind = test || rcv ? 2 : size ? 1 : 0;
          }
          const tag = ti * 4 + kind, ver = tver[ti];
          if (match) {
            // unchanged block of the previous selection, still in place
            if (kind !== 2 && k < s.selN && s.selT[k] === tag && s.selV[k] === ver) { k++; continue; }
            match = false;
            n = k < s.selN ? s.selO[k] : s.selEnd;
          }
          if (reuse) {
            if (k >= s.selT.length) this.growSel(s, k + 1);
            s.selT[k] = tag; s.selV[k] = ver; s.selO[k] = n;
            k++;
          }
          if (s.starts.length < n + list.length) this.ensureList(s, n + list.length, n);
          if (kind !== 0) { n = this.pushList(s, list, test, size, rcv, n, cbit, mat); continue; }
          // every visible instance of the tile (with the cascade bit) is drawn: copy its cached block
          const ck = ti * 3 + cls;
          let cc = this.tileCache[ck];
          if (!cc || cc.ver !== ver) {
            if (!cc || cc.i.length < list.length) cc = this.tileCache[ck] = { ver: 0, n: 0, i: new Uint32Array(list.length + 16) };
            let m2 = 0;
            const ci = cc.i;
            for (let j = 0; j < list.length; j++) {
              const id = list[j];
              if (!vis[id] || (cbit && !(imask[id] & cbit))) continue;
              ci[m2++] = id;
            }
            cc.n = m2;
            cc.ver = ver;
          }
          // (element loop: subarray() views would allocate three objects per tile)
          const starts = s.starts, counts = s.counts, ind = s.ids;
          const ci = cc.i, cn = cc.n;
          for (let j = 0; j < cn; j++) { const id = ci[j], gid = geo[id]; starts[n + j] = gS[gid]; counts[n + j] = gC[gid]; ind[n + j] = id; }
          n += cn;
        }
      }
      if (match) {
        // every selected tile matched the previous selection: the same blocks (all of them: nothing to upload, or a
        // shorter prefix: the list is cut)
        keep = k === s.selN && this.untiled.length === 0;
        n = k < s.selN ? s.selO[k] : s.selEnd;
      }
      if (reuse) { s.selN = k; s.selEnd = n; s.selMinR = minR; s.selValid = true; } else s.selValid = false;
      if (this.untiled.length) {
        if (s.starts.length < n + this.untiled.length) this.ensureList(s, n + this.untiled.length, n);
        n = this.pushList(s, this.untiled, true, minR > 0, recv !== null, n, cbit, mat);
      }
      if (sorted && n > 1) this.sortList(s, n);
    } else s.selValid = false;
    if (keep && s.tex && n === s.count) return;
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

  /** grow a slot's stored tile selection to hold `need` entries */
  private growSel(s: PassSlot, need: number): void {
    const cap = Math.max(need, s.selT.length * 2);
    const t = new Int32Array(cap), v = new Uint32Array(cap), o = new Int32Array(cap);
    t.set(s.selT); v.set(s.selV); o.set(s.selO);
    s.selT = t; s.selV = v; s.selO = o;
  }

  /**
   * List-build inner loop over one instance list (a method, not a per-build closure: no allocation, stable JIT
   * feedback). test: per-instance frustum test; size / rcv: per-instance caster size / receiver tests (shadow
   * passes). Planes in _fp / _rp, doubles in _plf. The caller made room for list.length more entries. Returns n.
   */
  private pushList(s: PassSlot, list: number[], test: boolean, size: boolean, rcv: boolean, n: number, cbit: number, mat: Float32Array | null): number {
    const mr = _plf[0], minR = _plf[1], rGround = _plf[2], rInv = _plf[3];
    const vis = this.instVis, imask = this.instMask, geo = this.instGeo, grad = this.geoRad, sph = this.sph, gS = this.gStart, gC = this.gCount;
    const fp = _fp, rp = _rp, rnl = _rnl;
    const starts = s.starts, counts = s.counts, ind = s.ids;
    for (let j = 0; j < list.length; j++) {
      const id = list[j];
      if (!vis[id]) continue;
      if (cbit && !(imask[id] & cbit)) continue;
      const gid = geo[id];
      if (test || size || rcv) {
        let cx: number, cy: number, cz: number, r: number;
        if (mat) {
          const o = id * 16;
          cx = mat[o + 12]; cy = mat[o + 13]; cz = mat[o + 14];
          r = grad[gid];
        } else {
          const o = id * 4;
          cx = sph[o]; cy = sph[o + 1]; cz = sph[o + 2]; r = sph[o + 3];
        }
        if (size && r < minR) continue;
        // shadow passes: only casters whose shadow (the sphere swept away from the light down to the ground) can reach
        // the visible part of this cascade (receiverSweepSphere; the band is in the planes)
        if (rcv) {
          const T = Math.min(6000, Math.max(0, (cy + r + mr - rGround) * rInv));
          let hit = true;
          for (let i = 0; i < 6; i++) {
            const o = i * 4;
            const d0 = rp[o] * cx + rp[o + 1] * cy + rp[o + 2] * cz + rp[o + 3];
            if (d0 < -r && d0 - T * rnl[i] < -r) { hit = false; break; }
          }
          if (!hit) continue;
        }
        if (test) {
          let out = false;
          for (let p = 0; p < 6; p++) {
            const o = p * 4;
            if (fp[o] * cx + fp[o + 1] * cy + fp[o + 2] * cz + fp[o + 3] < -r) { out = true; break; }
          }
          if (out) continue;
        }
      }
      starts[n] = gS[gid];
      counts[n] = gC[gid];
      ind[n] = id;
      n++;
    }
    return n;
  }

  /** draw range (index start in bytes, count) per geometry id -> gStart / gCount (recomputed only when geometries were
   *  added or the index buffer changed) */
  private drawRanges(geometry: THREE.BufferGeometry): void {
    const gInfo = (this.mesh as any)._geometryInfo as { start: number; count: number }[];
    const index = geometry.getIndex();
    const bpe = index === null ? 1 : index.array.BYTES_PER_ELEMENT;
    if (this.rangesAt === this.geoEpoch && this.rangesLen === gInfo.length && this.rangesBpe === bpe) return;
    this.rangesAt = this.geoEpoch; this.rangesLen = gInfo.length; this.rangesBpe = bpe;
    if (this.gStart.length < gInfo.length) { this.gStart = new Int32Array(gInfo.length * 2); this.gCount = new Int32Array(gInfo.length * 2); }
    const gS = this.gStart, gC = this.gCount;
    for (let g = 0; g < gInfo.length; g++) { const gi = gInfo[g]; gS[g] = gi ? gi.start * bpe : 0; gC[g] = gi ? gi.count : 0; }
  }

  /**
   * Geometry swaps only (same instances, same order): bring a cached list's draw ranges up to date. The instances
   * swapped since the list was last current (swap log) are patched in place through an instance -> list index map
   * built on the list's first patch; a list too far behind rewrites all its ranges.
   */
  private patchRanges(s: PassSlot, geometry: THREE.BufferGeometry): void {
    this.drawRanges(geometry);
    const gS = this.gStart, gC = this.gCount, geo = this.instGeo, ids = s.ids, starts = s.starts, counts = s.counts, n = s.count;
    const behind = this.swapSeq - s.swapAt;
    s.swapAt = this.swapSeq;
    if (behind > SWAP_RING || behind * SWAP_FULL > n) {
      for (let j = 0; j < n; j++) { const g = geo[ids[j]]; starts[j] = gS[g]; counts[j] = gC[g]; }
      return;
    }
    if (s.posGen !== s.gen) {
      if (s.pos.length < geo.length) s.pos = new Int32Array(geo.length);
      const pos = s.pos;
      for (let j = 0; j < n; j++) pos[ids[j]] = j;
      s.posGen = s.gen;
    }
    const pos = s.pos, log = this.swapLog;
    for (let q = this.swapSeq - behind; q < this.swapSeq; q++) {
      const id = log[q % SWAP_RING];
      if (id >= pos.length) continue;
      const j = pos[id];
      if (j < n && ids[j] === id) { const g = geo[id]; starts[j] = gS[g]; counts[j] = gC[g]; }
    }
  }

  /** counting sort of the first n list entries by distance from the camera (sqrt-spaced buckets: fine up close) */
  private sortList(s: PassSlot, n: number): void {
    const e = s.camera.matrixWorld.elements;
    const px = e[12], py = e[13], pz = e[14];
    if (this.sortKey.length < n) { const c = Math.ceil(n * 1.25); this.sortKey = new Uint8Array(c); this.sortTmp = new Int32Array(c * 3); }
    const key = this.sortKey, tmp = this.sortTmp, cnt = this.sortCnt, sph = this.sph;
    const starts = s.starts, counts = s.counts, ind = s.ids;
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
    for (let i = 0; i < n; i++) { starts[i] = tmp[i]; counts[i] = tmp[T1 + i]; ind[i] = tmp[T2 + i]; }
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
