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
 * removals). The build loop reads typed per-instance mirrors (visibility, geometry) instead of three's objects, and the
 * per-instance tests read packed per-tile copies of the instances' spheres / masks (InstPack) in list order.
 * Optionally (sortFront) main-pass lists are sorted nearest first so the depth test rejects occluded fragments
 * before shading. Dynamic batches (vehicles) group their visible instances by culler tile once per content version
 * (packDyn) and cull those groups like tiles: groups outside a pass are skipped whole, groups inside copied whole.
 * Pass skipping: the mesh answers three.js's per-pass frustum test (intersectsFrustum) with "does this pass draw
 * anything" (nothing live, or a shadow cascade outside the batch's shadowMask), so three.js does not even set up an
 * empty draw for it.
 *
 * Uploads: setMatrix / setColor record per-instance texture update ranges (three r186 honours
 * Texture.updateRanges for RGBA data textures), so animating a few buildings uploads a few rows instead of the whole
 * matrix + colour textures. Many changes in one frame fall back to one full upload. A dynamic batch's whole-matrix
 * update (markMatricesDirty) and the per-pass instance id lists go straight to GL as one texSubImage2D of the rows that
 * changed (ids: from the first id that differs; matrices: the rows of the ids in use) into textures kept at their
 * high-water size, instead of three.js re-uploading (and, for lists that change length, re-allocating) whole textures.
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
  /** instance ids of the list (copied into the indirect texture, which is sized to the lists, not the capacity; its data
   *  mirrors the GPU copy, see syncIds) */
  ids: Uint32Array;
  tex: THREE.DataTexture;
  texCap: number;
  /** builds in a row whose list used under a quarter of the texture (it shrinks after SHRINK_AFTER) */
  small: number;
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

/**
 * Instances packed for the list builds, in groups: a static tile's visible instances grouped by sub-cell (SUB x SUB per
 * tile, refreshed when the tile's content changes), or a dynamic batch's visible instances grouped by culler tile (once
 * per content version, i.e. per frame while they move, shared by all passes). Per entry: id, culling sphere, cascade
 * mask and draw range; per group: its entries' range, sphere bounds, smallest radius and AND / OR of the masks. A list
 * build skips groups outside a pass, copies groups inside it and tests only the entries of groups that straddle one of
 * its planes (against just those planes), reading memory sequentially.
 */
interface InstPack {
  /** content version the pack was built for (static: tileVer; dynamic: the batch version) */
  ver: number;
  n: number;
  ids: Uint32Array;
  /** x, y, z, radius per entry */
  sph: Float32Array;
  mk: Uint8Array;
  /** draw range per entry (index start in bytes, count), computed for tileSwap / rangesGen (rs / rg) */
  st: Int32Array;
  ct: Int32Array;
  rs: number;
  rg: number;
  /** AND of all entries' masks */
  and: number;
  /** groups: count, first entry / entry count, bounds [x0 y0 z0 x1 y1 z1] (x0 NaN: an entry without a sphere, always
   *  tested), smallest radius, AND / OR of the masks */
  ng: number;
  gf: Int32Array;
  gc: Int32Array;
  gb: Float32Array;
  gr: Float32Array;
  ga: Uint8Array;
  go: Uint8Array;
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
/** the planes a tile's groups are tested against, compacted: a partly visible tile only needs the planes its box
 *  straddles (the others hold for every instance in it), typically 1-2 of the 6; and per group (pushGroups) the planes
 *  the group's box straddles, which its entries are tested against */
const _fq = new Float64Array(24);
const _rq = new Float64Array(24);
const _rnq = new Float64Array(6);
const _fg = new Float64Array(24);
const _rg = new Float64Array(24);
const _rng = new Float64Array(6);
/** list-build doubles handed to the emitters (guard band, min caster radius, receiver ground, 1 / light dir y, and for
 *  sorted lists the camera position) */
const _plf = new Float64Array(7);
/** sub-cells per tile side (pack groups of static tiles) */
const SUB = 4;
/** sorted lists: distance key per entry (sqrt-spaced buckets: fine up close) and the histogram of the counting sort;
 *  KEYQ[i] = key of a distance of i / 4 m (quarter-metre steps up to KEYQ_M m: no square root for those) */
const _hist = new Int32Array(257);
const KEYQ_M = 1024;
const KEYQ = (() => {
  const t = new Uint8Array(KEYQ_M * 4);
  for (let i = 0; i < t.length; i++) t[i] = Math.min(255, Math.floor(Math.sqrt(i / 4) * 4));
  return t;
})();
/** current camera orientation */
const _rot = new Float64Array(9);
/** TileCuller.update's frustum planes (nx, ny, nz, constant) x 6 */
const _tcp = new Float64Array(24);
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
/** width (ids per row) of the per-pass indirect textures: uploads are whole rows (see syncIds), 2 KB each */
const ID_W = 512;
/** a pass list's indirect texture shrinks only after this many builds in a row that used under a quarter of it */
const SHRINK_AFTER = 180;
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
/**
 * One texSubImage2D of rows [y0, y0 + h) (full width w) straight into a texture three.js has already created (no
 * re-specification, no sampler parameters). It runs inside a pass (onBeforeRender / onBeforeShadow), so the texture is
 * bound on the active unit only for the upload and that unit's previous texture is bound back: three.js does not
 * re-bind a material's textures for a draw that reuses the previous draw's program and material (two batches sharing
 * the city material), which would otherwise sample this texture in place of one of them.
 */
function uploadRows(renderer: THREE.WebGLRenderer, tex: WebGLTexture, y0: number, w: number, h: number, format: number, type: number, data: ArrayBufferView, offset: number): void {
  const gl = renderer.getContext() as WebGL2RenderingContext, st = renderer.state;
  const prev = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  st.bindTexture(gl.TEXTURE_2D, tex);
  st.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  st.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  st.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  st.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  st.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  st.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, w, h, format, type, data, offset);
  // (null: three.js binds its empty texture)
  st.bindTexture(gl.TEXTURE_2D, prev as WebGLTexture);
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
}

/** every frustum / receiver plane into the compacted test planes (instances without tile bounds, dynamic batches) */
function allPlanes(): void {
  _fq.set(_fp);
  _rq.set(_rp);
  _rnq.set(_rnl);
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
  /** per-tile content version (visibility / masks / membership / spheres; not geometry swaps) and per tile its instance
   *  pack (see InstPack): its entries are re-packed when the tile's content changed (tileVer), their draw ranges
   *  refreshed when an instance of the tile swapped geometry (tileSwap, LOD) or the draw ranges moved (rangesGen) */
  private tileVer = new Uint32Array(0);
  private tileSwap = new Uint32Array(0);
  private tilePack: (InstPack | null)[] = [];
  /** dynamic batches: the visible instances' pack, the swapSeq it was built at, and its scratch (tile of each visible
   *  instance in untiled order; per culler tile its count / fill cursor, zero between builds) */
  private dynPack: InstPack | null = null;
  private dynSwap = -1;
  private dynEt = new Int32Array(0);
  private dynCnt = new Int32Array(0);
  /** packOf scratch: sub-cell of each instance of the tile list being packed, and per sub-cell its count / cursor */
  private subOf = new Int32Array(0);
  private subCnt = new Int32Array(SUB * SUB + 1);
  /** where the emitters write the list being built: the slot's own arrays, or (sorted lists) these scratch arrays with a
   *  distance key per entry, scattered into the slot's arrays by key once the list is complete (counting sort) */
  private oS = new Int32Array(0);
  private oC = new Int32Array(0);
  private oI = new Uint32Array(0);
  private oK: Uint8Array | null = null;
  private eS = new Int32Array(64);
  private eC = new Int32Array(64);
  private eI = new Uint32Array(64);
  private eK = new Uint8Array(64);
  /** bumped whenever drawRanges() recomputed the per-geometry ranges */
  private rangesGen = 0;
  private untiled: number[] = [];
  /** dynamic batches keep their visible instances at the front of `untiled` ([0, untiledVis), see partSet): list
   *  builds walk only those (a zoomed-out view hides most vehicles) */
  private untiledVis = 0;
  /** main-pass draw lists are sorted front to back (nearest first): opaque overdraw is rejected by the depth test
   *  before shading (big occluders such as buildings; cheap counting sort on a key computed as the entries are
   *  emitted, only when a list is rebuilt) */
  sortFront = false;
  private gStart = new Int32Array(0);
  private gCount = new Int32Array(0);
  // ---- partial texture uploads
  private matFull = true;
  private colFull = true;
  private lastFrame = -1;
  /** dynamic batches: a whole-matrix upload is pending (markMatricesDirty), done by the frame's first pass for the rows
   *  in use only; instance ids in use lie below `top` (recomputed after a removal at the top) */
  private matDirect = false;
  private top = 0;
  private topDirty = false;

  constructor(material: THREE.Material, instances = 1024, vertices = 65536, name = 'batch') {
    this.mesh = new THREE.BatchedMesh(instances, vertices, vertices * 2, material);
    this.mesh.name = name;
    this.mesh.perObjectFrustumCulled = false;
    this.mesh.sortObjects = false;
    // passes the batch cannot draw anything in are skipped before three.js does any per-object work for them (it tests
    // intersectsFrustum first): see passable
    this.mesh.frustumCulled = true;
    this.mesh.intersectsFrustum = (f: THREE.Frustum) => this.passable(f);
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

  /** can this pass draw anything? Not without instances (a dynamic batch: without a visible one), nor in a shadow
   *  cascade outside the shadowMask (shadow frustums carry their cascade, see Shadows.ts). The view frustum is not
   *  tested here: the pass list culls per tile / instance. */
  private passable(f: THREE.Frustum): boolean {
    const pc = this.pc;
    if (pc === null) return this.live > 0;
    if (pc.dynamic ? this.untiledVis === 0 : this.live === 0) return false;
    const c = (f as { cascade?: number }).cascade;
    return c === undefined || ((pc.shadowMask! >> c) & 1) === 1;
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
    if (id >= this.top) this.top = id + 1;
    if (this.pc) {
      this.ensureCap(id + 1);
      this.instTile[id] = -1;
      this.instSlot[id] = -1;
      this.sph[id * 4 + 3] = -1;
      this.instMask[id] = 0xff;
      this.instVis[id] = 1;
      this.instGeo[id] = geomId;
      if (this.pc.dynamic) { this.instSlot[id] = this.untiled.length; this.untiled.push(id); this.partSet(id, true); }
    }
    this.touch();
    return id;
  }

  remove(id: number): void {
    this.live--;
    if (id + 1 >= this.top) this.topDirty = true;
    if (this.pc) {
      if (this.pc.dynamic) this.partSet(id, false);
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
    const tile = this.instTile[id];
    if (tile >= 0) this.tileSwap[tile]++;
    // cached draw lists stay valid while the instance's culling sphere still bounds the new geometry (LOD swaps, see
    // shareSphere): they only patch this instance's draw range (swap log; no re-cull, no indirect texture upload; the
    // tile's cached blocks keep their ids and only refresh their ranges, see tileSwap). Otherwise the sphere is
    // rewritten exactly and the lists are rebuilt. Geometries sharing one culling sphere (model + proxy) skip the check.
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

  /**
   * Create the per-instance colour texture now, all white (the material's default look; for the city material alpha 1 =
   * no flags). A batch that never sets colours but shares its material with batches that do (vehicles and buildings:
   * the city material) then draws with the same shader program as they do: otherwise three.js re-resolves the
   * material's program (parameters, cache key, uniform refresh) every time consecutive draws of it switch between
   * having instance colours and not, twice a frame.
   */
  ensureColors(): void {
    const m = this.mesh as any;
    if (m._colorsTexture !== null) return;
    m._initColorsTexture();
    (m._colorsTexture as THREE.DataTexture).needsUpdate = true;
    this.colFull = true;
  }

  setVisible(id: number, v: boolean): void {
    const info = (this.mesh as any)._instanceInfo[id];
    if (info && info.visible === v) return;
    this.mesh.setVisibleAt(id, v);
    if (this.pc && info) {
      this.instVis[id] = v && info.active ? 1 : 0;
      this.bumpTile(id);
      if (this.pc.dynamic) this.partSet(id, this.instVis[id] === 1);
    }
    this.touch();
  }

  /** move a dynamic batch's instance into / out of the visible front part of `untiled` */
  private partSet(id: number, visible: boolean): void {
    const u = this.untiled, slot = this.instSlot;
    const at = slot[id];
    if (at < 0 || u[at] !== id) return;
    let b: number;
    if (visible) {
      if (at < this.untiledVis) return;
      b = this.untiledVis++;
    } else {
      if (at >= this.untiledVis) return;
      b = --this.untiledVis;
    }
    const o = u[b];
    u[b] = id; u[at] = o;
    slot[id] = b; slot[o] = at;
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
    // dynamic batches: uploaded by the frame's first pass, only the rows of the instance ids in use (uploadMatrices)
    if (this.pc?.dynamic) { this.version++; this.matDirect = true; }
    else tex.needsUpdate = true;
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
    this.tileSwap = new Uint32Array(T);
    this.tilePack = new Array(T).fill(null);
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
    // (the tile's content version too: kept list blocks filtered by caster size depend on the radius)
    if (t >= 0) { this.growTile(t, id); this.tileVer[t]++; }
    this.version++;
  }

  /** world bounding sphere of geometry gid under matrix m -> _sp; false if the geometry is unknown */
  private sphereOf(gid: number, m: THREE.Matrix4): boolean {
    const gs = this.geoSphere[gid];
    if (!gs) return false;
    const e = m.elements;
    const syr = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]);
    const sx = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]), sy = Math.max(1, syr), sz = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]);
    const c = gs.center;
    // center = T + R * (S' * c) with S' = diag(sx, sy, sz) (use the unit axes of the matrix)
    const ix = sx > 0 ? 1 / sx : 0, iz = sz > 0 ? 1 / sz : 0;
    const iy = 1 / Math.max(1e-6, syr);
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
        camera, starts: new Int32Array(64), counts: new Int32Array(64), ids: new Uint32Array(64), tex: null as unknown as THREE.DataTexture, texCap: 0, small: 0, count: 0,
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
      if (this.matDirect) { this.matDirect = false; this.uploadMatrices(renderer); }
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
    // (the shadow texel only matters to batches with a caster size cutoff: a cascade re-fit while zooming must not
    // rebuild the lists of the others)
    const texel = shadow && this.pc.minShadowTexels! > 0 ? ((camera.userData.texel as number | undefined) ?? 0) : 0;
    const recv = shadow ? ((camera.userData.recv as ShadowReceiver | undefined) ?? null) : null;
    const cam = camera as THREE.PerspectiveCamera;
    const persp = cam.isPerspectiveCamera === true;
    const near = typeof cam.near === 'number' ? cam.near : 0, far = typeof cam.far === 'number' ? cam.far : Infinity;
    orient(w, _rot);
    // motion since this slot's previous pass (~per frame): camera translation / rotation, receiver (view) likewise;
    // a damped camera settling by less than a millimetre counts as still
    const sdx = w[12] - s.lx, sdy = w[13] - s.ly, sdz = w[14] - s.lz;
    const step = s.lx === s.lx ? Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz) : Infinity;
    const turn = s.lx === s.lx ? turnAngle(_rot, s.lrot) : Infinity;
    s.lx = w[12]; s.ly = w[13]; s.lz = w[14];
    s.lrot.set(_rot);
    let rstep = 0, rturn = 0;
    if (recv) {
      const o = recv.origin;
      const rdx = o.x - s.lrx, rdy = o.y - s.lry, rdz = o.z - s.lrz;
      rstep = s.lrx === s.lrx ? Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz) : Infinity;
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
      this.build(renderer, s, shadow ? ((camera.userData.cascade as number | undefined) ?? 0) : -1, texel, geometry, recv, tilt, phi, rtilt, reach > this.farReach);
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

  /**
   * A dynamic batch's whole-matrix update (markMatricesDirty): one texSubImage2D of the texture rows that hold instance
   * ids in use (vehicles: a city with fewer vehicles than the batch was sized for uploads only that part; three.js would
   * upload the whole texture and re-set its sampler parameters). A texture three.js has not uploaded yet goes through
   * three.js.
   */
  private uploadMatrices(renderer: THREE.WebGLRenderer): void {
    const tex = (this.mesh as any)._matricesTexture as THREE.DataTexture;
    const props = renderer.properties ? (renderer.properties.get(tex) as { __webglTexture?: WebGLTexture; __version?: number }) : undefined;
    if (props === undefined || props.__webglTexture === undefined || props.__version !== tex.version) { tex.needsUpdate = true; return; }
    if (this.topDirty) {
      const info = (this.mesh as any)._instanceInfo as { active: boolean }[];
      let t = Math.min(this.top, info.length);
      while (t > 0 && !(info[t - 1] && info[t - 1].active)) t--;
      this.top = t;
      this.topDirty = false;
    }
    const W = tex.image.width, rows = Math.min(tex.image.height, Math.ceil((this.top * 4) / W));
    if (rows <= 0) return;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    uploadRows(renderer, props.__webglTexture, 0, W, rows, gl.RGBA, gl.FLOAT, tex.image.data as unknown as Float32Array, 0);
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
    rp.set(recv.pl);
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
  private build(renderer: THREE.WebGLRenderer, s: PassSlot, cascade: number, texel: number, geometry: THREE.BufferGeometry, recv: ShadowReceiver | null, tilt: number, phi: number, rtilt: number, far = false): void {
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
    /** leading entries known to be unchanged since the last build (a kept prefix of tile blocks) */
    let pre = 0;
    const dyn = pc.dynamic;
    const sorted = cascade < 0 && this.sortFront && !dyn && !far;
    const coarse = pc.coarse === true || far;
    if (cascade < 0 || (pc.shadowMask! >> cascade) & 1) {
      this.cullPlanes(s, recv, tilt, phi, rtilt);
      const fp = _fp, rp = _rp, rnl = _rnl, fq = _fq, rq = _rq, rnq = _rnq;
      this.drawRanges(geometry);
      const minR = cascade >= 0 ? pc.minShadowTexels! * texel * 0.5 : 0;
      const mat = dyn ? (m._matricesTexture.image.data as Float32Array) : null;
      const cbit = cascade >= 0 ? 1 << cascade : 0;
      let rGround = 0, rInv = 0;
      if (recv) {
        rGround = recv.ground;
        rInv = 1 / Math.max(recv.dir.y, 0.05);
      }
      _plf[0] = s.margin; _plf[1] = minR; _plf[2] = rGround; _plf[3] = rInv;
      // where the entries go: straight into the slot's arrays, or (sorted) into the scratch arrays with a distance key
      // each, scattered by key once the list is complete
      if (sorted) {
        const e = s.camera.matrixWorld.elements;
        _plf[4] = e[12]; _plf[5] = e[13]; _plf[6] = e[14];
        _hist.fill(0);
        this.oS = this.eS; this.oC = this.eC; this.oI = this.eI; this.oK = this.eK;
      } else {
        this.oS = s.starts; this.oC = s.counts; this.oI = s.ids; this.oK = null;
      }
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
          // kind: 0 whole tile, 1 per-instance caster size test, 2 per-group / per-instance tests (fine list / tile
          // without bounds) against the np frustum / nr receiver planes the tile straddles (compacted into _fq / _rq)
          let kind = 0, np = 0, nr = 0;
          let size = false;
          if (!(x1 >= x0) || !Number.isFinite(x0 + x1)) { kind = 2; np = 6; nr = recv ? 6 : 0; size = minR > 0; allPlanes(); }
          else {
            let outside = false;
            for (let p = 0; p < 6; p++) {
              const o = p * 4, nx = fp[o], ny = fp[o + 1], nz = fp[o + 2], c = fp[o + 3];
              // p-vertex (farthest along the normal) outside: the tile is out; n-vertex outside: the plane cuts it
              if (nx * (nx > 0 ? x1 : x0) + ny * (ny > 0 ? y1 : y0) + nz * (nz > 0 ? z1 : z0) + c < 0) { outside = true; break; }
              if (!coarse && nx * (nx > 0 ? x0 : x1) + ny * (ny > 0 ? y0 : y1) + nz * (nz > 0 ? z0 : z1) + c < 0) {
                const q = np * 4;
                fq[q] = nx; fq[q + 1] = ny; fq[q + 2] = nz; fq[q + 3] = c;
                np++;
              }
            }
            if (outside) continue;
            // receiver: skip the tile if no caster in it can shadow the visible slice (receiverSweepBox; the band is in
            // the planes); per-instance tests only against the receiver planes the tile is not entirely inside of
            // (receiverContainsBox per plane)
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
                  if (nx * (nx > 0 ? x0 : x1) + ny * (ny > 0 ? y0 : y1) + nz * (nz > 0 ? z0 : z1) + rp[o + 3] < 0) {
                    const q = nr * 4;
                    rq[q] = nx; rq[q + 1] = ny; rq[q + 2] = nz; rq[q + 3] = rp[o + 3]; rnq[nr] = rnl[i];
                    nr++;
                  }
                }
              }
            }
            size = minR > 0 && tminR[ti] < minR;
            kind = np > 0 || nr > 0 ? 2 : size ? 1 : 0;
          }
          const tag = ti * 4 + kind, ver = tver[ti];
          if (match) {
            // unchanged block of the previous selection, still in place
            if (kind !== 2 && k < s.selN && s.selT[k] === tag && s.selV[k] === ver) { k++; continue; }
            match = false;
            n = pre = k < s.selN ? s.selO[k] : s.selEnd;
          }
          if (reuse) {
            if (k >= s.selT.length) this.growSel(s, k + 1);
            s.selT[k] = tag; s.selV[k] = ver; s.selO[k] = n;
            k++;
          }
          const pk = this.packOf(ti);
          if (this.oS.length < n + pk.n) this.growOut(s, n + pk.n, n);
          // kind 0: every visible instance of the tile (with the cascade bit) is drawn
          if (kind === 0) n = this.emitRange(pk, 0, pk.n, n, cbit !== 0 && (pk.and & cbit) === 0 ? cbit : 0);
          else n = this.pushGroups(pk, np, size, nr, n, cbit);
        }
      }
      if (match) {
        // every selected tile matched the previous selection: the same blocks (all of them: nothing to upload, or a
        // shorter prefix: the list is cut)
        keep = k === s.selN && this.untiled.length === 0;
        n = pre = k < s.selN ? s.selO[k] : s.selEnd;
      }
      if (reuse) { s.selN = k; s.selEnd = n; s.selMinR = minR; s.selValid = true; } else s.selValid = false;
      const un = dyn ? this.untiledVis : this.untiled.length;
      if (un) {
        if (this.oS.length < n + un) this.growOut(s, n + un, n);
        allPlanes();
        if (mat) n = this.pushGroups(this.packDyn(mat), 6, minR > 0, recv ? 6 : 0, n, cbit);
        else n = this.pushList(this.untiled, un, minR > 0, recv ? 6 : 0, n, cbit);
      }
      if (sorted) this.scatterSorted(s, n);
    } else s.selValid = false;
    if (keep && s.tex && n === s.count) return;
    s.count = n;
    this.syncIds(renderer, s, n, Math.min(pre, n));
  }

  /** room for `need` entries in the current emission target (keeps the first n) */
  private growOut(s: PassSlot, need: number, n: number): void {
    if (this.oK === null) {
      this.ensureList(s, need, n);
      this.oS = s.starts; this.oC = s.counts; this.oI = s.ids;
      return;
    }
    if (this.eS.length >= need) return;
    const cap = Math.max(need, Math.ceil(this.eS.length * 1.5), 64);
    const a = new Int32Array(cap), b = new Int32Array(cap), c = new Uint32Array(cap), d = new Uint8Array(cap);
    a.set(this.eS.subarray(0, n)); b.set(this.eC.subarray(0, n)); c.set(this.eI.subarray(0, n)); d.set(this.eK.subarray(0, n));
    this.eS = this.oS = a; this.eC = this.oC = b; this.eI = this.oI = c; this.eK = this.oK = d;
  }

  /** sorted list: the n emitted entries (scratch arrays, key each, histogram in _hist) into the slot's arrays, nearest
   *  key first (stable counting sort) */
  private scatterSorted(s: PassSlot, n: number): void {
    if (s.starts.length < n) this.ensureList(s, n, 0);
    const h = _hist;
    for (let b = 1; b < 257; b++) h[b] += h[b - 1];
    const key = this.eK, eS = this.eS, eC = this.eC, eI = this.eI, S = s.starts, C = s.counts, I = s.ids;
    for (let i = 0; i < n; i++) {
      const j = h[key[i]]++;
      S[j] = eS[i]; C[j] = eC[i]; I[j] = eI[i];
    }
  }

  /**
   * The list's indirect (instance id) texture: rows of ID_W ids, kept at its high-water size (grown with 50% slack;
   * shrunk only once the lists stayed under a quarter of it for SHRINK_AFTER builds, so zooming does not re-create it).
   * Its data mirrors the GPU copy: only the rows from the first id that differs (at or after `from`, a prefix the build
   * kept) to the end of the list are uploaded, with one texSubImage2D straight into the existing texture (three.js
   * would re-upload the whole texture and re-set its sampler parameters); an unchanged list uploads nothing. A texture
   * three.js has not uploaded yet (new, or an upload pending) goes through three.js.
   */
  private syncIds(renderer: THREE.WebGLRenderer, s: PassSlot, n: number, from: number): void {
    const cap = s.texCap;
    let fresh = s.tex === null || cap < n;
    if (!fresh) {
      if (n * 4 < cap && cap > ID_W) fresh = ++s.small > SHRINK_AFTER;
      else s.small = 0;
    }
    if (fresh) {
      s.small = 0;
      s.tex?.dispose();
      const rows = Math.max(1, Math.ceil((n * 1.5) / ID_W));
      s.tex = new THREE.DataTexture(new Uint32Array(ID_W * rows), ID_W, rows, THREE.RedIntegerFormat, THREE.UnsignedIntType);
      s.texCap = ID_W * rows;
      from = 0;
    }
    const tex = s.tex;
    const data = tex.image.data as unknown as Uint32Array, ids = s.ids;
    let j = from;
    if (!fresh) while (j < n && data[j] === ids[j]) j++;
    if (j >= n) { if (fresh) tex.needsUpdate = true; return; }
    for (let i = j; i < n; i++) data[i] = ids[i];
    if (fresh) { tex.needsUpdate = true; return; }
    // (stub renderers in tests have no GL state: whole upload)
    const props = renderer.properties ? (renderer.properties.get(tex) as { __webglTexture?: WebGLTexture; __version?: number }) : undefined;
    if (props === undefined || props.__webglTexture === undefined || props.__version !== tex.version) { tex.needsUpdate = true; return; }
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const r0 = (j / ID_W) | 0, r1 = ((n - 1) / ID_W) | 0;
    uploadRows(renderer, props.__webglTexture, r0, ID_W, r1 - r0 + 1, gl.RED_INTEGER, gl.UNSIGNED_INT, data, r0 * ID_W);
  }

  /** grow a slot's stored tile selection to hold `need` entries */
  private growSel(s: PassSlot, need: number): void {
    const cap = Math.max(need, s.selT.length * 2);
    const t = new Int32Array(cap), v = new Uint32Array(cap), o = new Int32Array(cap);
    t.set(s.selT); v.set(s.selV); o.set(s.selO);
    s.selT = t; s.selV = v; s.selO = o;
  }

  /**
   * Tile ti's instance pack (see InstPack), re-packed when the tile's content changed (tileVer: visibility, masks,
   * membership and culling spheres all bump it): its visible instances grouped by the sub-cell (SUB x SUB per tile) of
   * their sphere centre (stable: list order within a sub-cell), with each group's bounds. Its draw ranges are refreshed
   * when an instance of the tile swapped geometry (tileSwap) or the ranges moved (rangesGen; drawRanges() ran for this
   * build).
   */
  private packOf(ti: number): InstPack {
    const ver = this.tileVer[ti];
    let pk = this.tilePack[ti];
    if (pk !== null && pk.ver === ver) {
      if (pk.rs !== this.tileSwap[ti] || pk.rg !== this.rangesGen) this.packRanges(pk, ti);
      return pk;
    }
    const list = this.tileLists[ti], len = list.length, G = SUB * SUB;
    if (pk === null || pk.ids.length < len) pk = this.tilePack[ti] = this.newPack(len + 16, G);
    if (this.subOf.length < len) this.subOf = new Int32Array(Math.max(len, this.subOf.length * 2));
    const cul = this.pc!.culler, TT = cul.tiles, size = cul.tileCells * cul.cellSize;
    const mt = ti % (TT * TT), ox = (mt % TT) * size, oz = ((mt / TT) | 0) * size, inv = SUB / size, smax = SUB - 1;
    const vis = this.instVis, imask = this.instMask, sph = this.sph, sub = this.subOf, cnt = this.subCnt;
    cnt.fill(0);
    // sub-cell of every visible instance (an instance without a sphere yet: group 0, which then always tests per entry)
    for (let j = 0; j < len; j++) {
      const id = list[j];
      if (!vis[id]) { sub[j] = -1; continue; }
      const o = id * 4;
      let g = 0;
      if (sph[o + 3] >= 0) {
        let gx = Math.floor((sph[o] - ox) * inv), gz = Math.floor((sph[o + 2] - oz) * inv);
        gx = gx > 0 ? (gx < smax ? gx : smax) : 0;
        gz = gz > 0 ? (gz < smax ? gz : smax) : 0;
        g = gz * SUB + gx;
      }
      sub[j] = g;
      cnt[g + 1]++;
    }
    // groups in sub-cell order; cnt[g] becomes the fill cursor of sub-cell g
    const gf = pk.gf, gc = pk.gc;
    let ng = 0, off = 0;
    for (let g = 0; g < G; g++) {
      const c = cnt[g + 1];
      cnt[g] = off;
      if (c === 0) continue;
      gf[ng] = off; gc[ng] = c; ng++;
      off += c;
    }
    const ids = pk.ids, ps = pk.sph, mk = pk.mk;
    for (let j = 0; j < len; j++) {
      const g = sub[j];
      if (g < 0) continue;
      const id = list[j], o = id * 4, k = cnt[g]++, q = k * 4;
      ids[k] = id;
      mk[k] = imask[id];
      ps[q] = sph[o]; ps[q + 1] = sph[o + 1]; ps[q + 2] = sph[o + 2]; ps[q + 3] = sph[o + 3];
    }
    pk.n = off;
    pk.ng = ng;
    pk.ver = ver;
    this.groupStats(pk);
    this.packRanges(pk, ti);
    return pk;
  }

  /** per group of a pack: sphere bounds (x0 NaN if an entry has no sphere), smallest radius, AND / OR of the masks;
   *  and the pack's AND of all masks */
  private groupStats(pk: InstPack): void {
    const ps = pk.sph, mk = pk.mk, gf = pk.gf, gc = pk.gc, gb = pk.gb, gr = pk.gr, ga = pk.ga, go = pk.go;
    let all = 0xff;
    for (let i = 0, ng = pk.ng; i < ng; i++) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, rmin = Infinity, a = 0xff, b = 0;
      let unb = false;
      for (let k = gf[i], e = k + gc[i]; k < e; k++) {
        const q = k * 4, cx = ps[q], cy = ps[q + 1], cz = ps[q + 2], r = ps[q + 3];
        a &= mk[k];
        b |= mk[k];
        if (r < 0) { unb = true; rmin = 0; continue; }
        if (cx - r < x0) x0 = cx - r;
        if (cy - r < y0) y0 = cy - r;
        if (cz - r < z0) z0 = cz - r;
        if (cx + r > x1) x1 = cx + r;
        if (cy + r > y1) y1 = cy + r;
        if (cz + r > z1) z1 = cz + r;
        if (r < rmin) rmin = r;
      }
      const kb = i * 6;
      gb[kb] = unb ? NaN : x0; gb[kb + 1] = y0; gb[kb + 2] = z0; gb[kb + 3] = x1; gb[kb + 4] = y1; gb[kb + 5] = z1;
      gr[i] = rmin; ga[i] = a; go[i] = b;
      all &= a;
    }
    pk.and = all;
  }

  /** a static pack's draw ranges from its instances' current geometries (after a re-pack, a geometry swap in its tile
   *  or a draw-range change; drawRanges() ran for this build) */
  private packRanges(pk: InstPack, ti: number): void {
    const geo = this.instGeo, gS = this.gStart, gC = this.gCount, ids = pk.ids, st = pk.st, ct = pk.ct;
    for (let j = 0, n = pk.n; j < n; j++) { const g = geo[ids[j]]; st[j] = gS[g]; ct[j] = gC[g]; }
    pk.rs = this.tileSwap[ti];
    pk.rg = this.rangesGen;
  }

  /** a dynamic batch's pack of its visible instances (the front of `untiled`) grouped by culler tile, positions from the
   *  live matrices: built by the first pass after a content change (vehicles: once per frame; owners writing
   *  matrixData() call markMatricesDirty(), which bumps the version), a geometry swap (radius) or a draw-range change,
   *  and shared by the others. A counting sort by tile (stable: untiled order within a tile), then each tile's bounds. */
  private packDyn(mat: Float32Array): InstPack {
    const un = this.untiledVis;
    let pk = this.dynPack;
    if (pk !== null && pk.ver === this.version && pk.n === un && this.dynSwap === this.swapSeq && pk.rg === this.rangesGen) return pk;
    this.dynSwap = this.swapSeq;
    const cul = this.pc!.culler, TT = cul.tiles, T = TT * TT, inv = 1 / (cul.tileCells * cul.cellSize), tmax = TT - 1;
    if (pk === null || pk.ids.length < un) {
      const cap = Math.max(Math.ceil(un * 1.25) + 16, pk === null ? 0 : pk.ids.length);
      pk = this.dynPack = this.newPack(cap, Math.min(T, cap));
    }
    if (this.dynEt.length < pk.ids.length) this.dynEt = new Int32Array(pk.ids.length);
    if (this.dynCnt.length !== T) this.dynCnt = new Int32Array(T);
    const u = this.untiled, imask = this.instMask, geo = this.instGeo, grad = this.geoRad, gS = this.gStart, gC = this.gCount;
    const ids = pk.ids, ps = pk.sph, mk = pk.mk, st = pk.st, ct = pk.ct, et = this.dynEt, cnt = this.dynCnt;
    // tile of each instance + counts per tile
    for (let j = 0; j < un; j++) {
      const o = u[j] * 16;
      // (clamped onto the map; also NaN -> 0: every visible instance lands in some tile)
      let tx = Math.floor(mat[o + 12] * inv), tz = Math.floor(mat[o + 14] * inv);
      tx = tx > 0 ? (tx < tmax ? tx : tmax) : 0;
      tz = tz > 0 ? (tz < tmax ? tz : tmax) : 0;
      const t = tz * TT + tx;
      et[j] = t;
      cnt[t]++;
    }
    // non-empty tiles in tile order: first entry / count; cnt becomes the fill cursor
    const gf = pk.gf, gc = pk.gc;
    let ng = 0, off = 0;
    for (let t = 0; t < T; t++) {
      const c = cnt[t];
      if (c === 0) continue;
      gf[ng] = off; gc[ng] = c; ng++;
      cnt[t] = off;
      off += c;
    }
    for (let j = 0; j < un; j++) {
      const id = u[j], o = id * 16, k = cnt[et[j]]++, q = k * 4, g = geo[id];
      ids[k] = id;
      mk[k] = imask[id];
      ps[q] = mat[o + 12]; ps[q + 1] = mat[o + 13]; ps[q + 2] = mat[o + 14]; ps[q + 3] = grad[g];
      st[k] = gS[g]; ct[k] = gC[g];
    }
    for (let j = 0; j < un; j++) cnt[et[j]] = 0;
    pk.n = un;
    pk.ng = ng;
    pk.ver = this.version;
    pk.rg = this.rangesGen;
    this.groupStats(pk);
    return pk;
  }

  private newPack(cap: number, gcap: number): InstPack {
    return {
      ver: -1, n: 0, ids: new Uint32Array(cap), sph: new Float32Array(cap * 4), mk: new Uint8Array(cap), st: new Int32Array(cap), ct: new Int32Array(cap), rs: -1, rg: -1, and: 0,
      ng: 0, gf: new Int32Array(gcap), gc: new Int32Array(gcap), gb: new Float32Array(gcap * 6), gr: new Float32Array(gcap), ga: new Uint8Array(gcap), go: new Uint8Array(gcap),
    };
  }

  /**
   * The groups of a pack into the list: each group's box against the np frustum / nr receiver planes in _fq / _rq (a
   * tile's straddled planes, or all of them) — groups outside are skipped, groups inside every plane (whose entries all
   * pass the size cutoff and carry the cascade) copied whole, the rest tested per entry against only the planes their
   * box straddles (compacted into _fg / _rg). The receiver sweep of a group uses its tallest sphere plus the band, as the
   * per-entry sweep. Draws exactly the entries the per-entry tests would (a box bounds every sphere of its group).
   */
  private pushGroups(pk: InstPack, np: number, size: boolean, nr: number, n: number, cbit: number): number {
    const mr = _plf[0], minR = _plf[1], rGround = _plf[2], rInv = _plf[3];
    const fq = _fq, rq = _rq, rnq = _rnq, fg = _fg, rg = _rg, rng = _rng;
    const gf = pk.gf, gc = pk.gc, gb = pk.gb, gr = pk.gr, ga = pk.ga, go = pk.go;
    for (let i = 0, ng = pk.ng; i < ng; i++) {
      if (cbit !== 0 && (go[i] & cbit) === 0) continue;
      const kb = i * 6;
      const x0 = gb[kb], y0 = gb[kb + 1], z0 = gb[kb + 2], x1 = gb[kb + 3], y1 = gb[kb + 4], z1 = gb[kb + 5];
      let gp = 0, gq = 0;
      if (x0 === x0) {
        let out = false;
        for (let p = 0; p < np; p++) {
          const o = p * 4, nx = fq[o], ny = fq[o + 1], nz = fq[o + 2], c = fq[o + 3];
          if (nx * (nx > 0 ? x1 : x0) + ny * (ny > 0 ? y1 : y0) + nz * (nz > 0 ? z1 : z0) + c < 0) { out = true; break; }
          if (nx * (nx > 0 ? x0 : x1) + ny * (ny > 0 ? y0 : y1) + nz * (nz > 0 ? z0 : z1) + c < 0) {
            const q = gp * 4;
            fg[q] = nx; fg[q + 1] = ny; fg[q + 2] = nz; fg[q + 3] = c;
            gp++;
          }
        }
        if (out) continue;
        if (nr > 0) {
          const T = Math.min(6000, Math.max(0, (y1 + mr - rGround) * rInv));
          let hit = true;
          for (let r = 0; r < nr; r++) {
            const o = r * 4, nx = rq[o], ny = rq[o + 1], nz = rq[o + 2];
            const d = nx * (nx > 0 ? x1 : x0) + ny * (ny > 0 ? y1 : y0) + nz * (nz > 0 ? z1 : z0) + rq[o + 3];
            if (d < 0 && d - T * rnq[r] < 0) { hit = false; break; }
          }
          if (!hit) continue;
          for (let r = 0; r < nr; r++) {
            const o = r * 4, nx = rq[o], ny = rq[o + 1], nz = rq[o + 2];
            if (nx * (nx > 0 ? x0 : x1) + ny * (ny > 0 ? y0 : y1) + nz * (nz > 0 ? z0 : z1) + rq[o + 3] < 0) {
              const q = gq * 4;
              rg[q] = nx; rg[q + 1] = ny; rg[q + 2] = nz; rg[q + 3] = rq[o + 3]; rng[gq] = rnq[r];
              gq++;
            }
          }
        }
      } else {
        // an entry without a sphere: test every entry against all the planes
        for (let q = 0; q < np * 4; q++) fg[q] = fq[q];
        for (let q = 0; q < nr * 4; q++) rg[q] = rq[q];
        for (let r = 0; r < nr; r++) rng[r] = rnq[r];
        gp = np; gq = nr;
      }
      const gsize = size && gr[i] < minR;
      const gbit = cbit !== 0 && (ga[i] & cbit) === 0 ? cbit : 0;
      const j0 = gf[i], j1 = j0 + gc[i];
      n = gp === 0 && gq === 0 && !gsize ? this.emitRange(pk, j0, j1, n, gbit) : this.testRange(pk, j0, j1, gp, gsize, gq, n, gbit);
    }
    return n;
  }

  /** the entries [j0, j1) of a pack into the list (with the cascade bit cbit, unless 0); sorted lists: with their
   *  distance keys (main passes: no cascade bit) */
  private emitRange(pk: InstPack, j0: number, j1: number, n: number, cbit: number): number {
    const starts = this.oS, counts = this.oC, ind = this.oI, key = this.oK;
    const ids = pk.ids, st = pk.st, ct = pk.ct;
    if (key === null) {
      if (cbit === 0) {
        for (let j = j0; j < j1; j++) { starts[n] = st[j]; counts[n] = ct[j]; ind[n] = ids[j]; n++; }
      } else {
        const mk = pk.mk;
        for (let j = j0; j < j1; j++) { if ((mk[j] & cbit) === 0) continue; starts[n] = st[j]; counts[n] = ct[j]; ind[n] = ids[j]; n++; }
      }
      return n;
    }
    const ps = pk.sph, hist = _hist, kx = _plf[4], ky = _plf[5], kz = _plf[6];
    for (let j = j0; j < j1; j++) {
      const o = j * 4, dx = ps[o] - kx, dy = ps[o + 1] - ky, dz = ps[o + 2] - kz;
      // (distance key: sqrt-spaced buckets of the distance to the sphere, quarter metres up close)
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - ps[o + 3];
      const kk = d <= 0 ? 0 : d < KEYQ_M ? KEYQ[(d * 4) | 0] : d >= 4096 ? 255 : (Math.sqrt(d) * 4) | 0;
      key[n] = kk;
      hist[kk + 1]++;
      starts[n] = st[j]; counts[n] = ct[j]; ind[n] = ids[j]; n++;
    }
    return n;
  }

  /**
   * The entries [j0, j1) of a pack that pass the per-entry tests into the list: the cascade bit (cbit, unless 0), the
   * caster size (size), the first nr receiver planes of _rg / _rng (shadow passes: only casters whose shadow can reach the
   * visible slice, the sphere swept away from the light down to the ground) and the first np frustum planes of _fg.
   * Doubles in _plf. Sorted lists: with their distance keys.
   */
  private testRange(pk: InstPack, j0: number, j1: number, np: number, size: boolean, nr: number, n: number, cbit: number): number {
    const mr = _plf[0], minR = _plf[1], rGround = _plf[2], rInv = _plf[3], kx = _plf[4], ky = _plf[5], kz = _plf[6];
    const fq = _fg, rq = _rg, rnq = _rng, hist = _hist;
    const starts = this.oS, counts = this.oC, ind = this.oI, key = this.oK;
    const ids = pk.ids, ps = pk.sph, mk = pk.mk, st = pk.st, ct = pk.ct;
    for (let j = j0; j < j1; j++) {
      if (cbit !== 0 && (mk[j] & cbit) === 0) continue;
      const o = j * 4;
      const cx = ps[o], cy = ps[o + 1], cz = ps[o + 2], r = ps[o + 3];
      if (size && r < minR) continue;
      if (nr > 0) {
        const T = Math.min(6000, Math.max(0, (cy + r + mr - rGround) * rInv));
        let hit = true;
        for (let i = 0; i < nr; i++) {
          const k = i * 4;
          const d0 = rq[k] * cx + rq[k + 1] * cy + rq[k + 2] * cz + rq[k + 3];
          if (d0 < -r && d0 - T * rnq[i] < -r) { hit = false; break; }
        }
        if (!hit) continue;
      }
      if (np > 0) {
        let out = false;
        for (let p = 0; p < np; p++) {
          const k = p * 4;
          if (fq[k] * cx + fq[k + 1] * cy + fq[k + 2] * cz + fq[k + 3] < -r) { out = true; break; }
        }
        if (out) continue;
      }
      if (key !== null) {
        const dx = cx - kx, dy = cy - ky, dz = cz - kz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
        const kk = d <= 0 ? 0 : d < KEYQ_M ? KEYQ[(d * 4) | 0] : d >= 4096 ? 255 : (Math.sqrt(d) * 4) | 0;
        key[n] = kk;
        hist[kk + 1]++;
      }
      starts[n] = st[j]; counts[n] = ct[j]; ind[n] = ids[j]; n++;
    }
    return n;
  }

  /**
   * List-build loop over the first len entries of a static batch's untiled instances (a method, not a per-build
   * closure: no allocation, stable JIT feedback): the 6 frustum planes of _fq, the first nr receiver planes of _rq /
   * _rnq (shadow passes: only casters whose shadow can reach the visible slice), and the caster size (size). Doubles in
   * _plf. The caller made room for len more entries. Returns n.
   */
  private pushList(list: number[], len: number, size: boolean, nr: number, n: number, cbit: number): number {
    const mr = _plf[0], minR = _plf[1], rGround = _plf[2], rInv = _plf[3], kx = _plf[4], ky = _plf[5], kz = _plf[6];
    const vis = this.instVis, imask = this.instMask, geo = this.instGeo, sph = this.sph, gS = this.gStart, gC = this.gCount;
    const fq = _fq, rq = _rq, rnq = _rnq, hist = _hist;
    const starts = this.oS, counts = this.oC, ind = this.oI, key = this.oK;
    for (let j = 0; j < len; j++) {
      const id = list[j];
      if (!vis[id]) continue;
      if (cbit && !(imask[id] & cbit)) continue;
      const o = id * 4;
      const cx = sph[o], cy = sph[o + 1], cz = sph[o + 2], r = sph[o + 3];
      if (size && r < minR) continue;
      if (nr > 0) {
        const T = Math.min(6000, Math.max(0, (cy + r + mr - rGround) * rInv));
        let hit = true;
        for (let i = 0; i < nr; i++) {
          const k = i * 4;
          const d0 = rq[k] * cx + rq[k + 1] * cy + rq[k + 2] * cz + rq[k + 3];
          if (d0 < -r && d0 - T * rnq[i] < -r) { hit = false; break; }
        }
        if (!hit) continue;
      }
      let out = false;
      for (let p = 0; p < 6; p++) {
        const k = p * 4;
        if (fq[k] * cx + fq[k + 1] * cy + fq[k + 2] * cz + fq[k + 3] < -r) { out = true; break; }
      }
      if (out) continue;
      if (key !== null) {
        const dx = cx - kx, dy = cy - ky, dz = cz - kz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
        const kk = d <= 0 ? 0 : d < KEYQ_M ? KEYQ[(d * 4) | 0] : d >= 4096 ? 255 : (Math.sqrt(d) * 4) | 0;
        key[n] = kk;
        hist[kk + 1]++;
      }
      const gid = geo[id];
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
    this.rangesGen++;
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
  private listeners: ((tile: number, visible: boolean) => void)[] = [];
  private first = true;
  /** camera (projection + view matrix) of the last update and whether a tile height grew since: an unchanged camera
   *  keeps every tile's visibility */
  private camKey = new Float64Array(32);
  private stale = true;

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
    if (y > this.maxY[tile]) { this.maxY[tile] = y; this.stale = true; }
  }

  update(camera: THREE.Camera): void {
    const a = camera.projectionMatrix.elements, b = camera.matrixWorldInverse.elements, k = this.camKey;
    let same = !this.stale && !this.first;
    for (let i = 0; i < 16; i++) {
      if (k[i] !== a[i]) { k[i] = a[i]; same = false; }
      if (k[16 + i] !== b[i]) { k[16 + i] = b[i]; same = false; }
    }
    if (same) return;
    this.stale = false;
    this.mat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.mat);
    // flat planes; the tile boxes are tested inline (Frustum.intersectsBox's farthest-corner test, same arithmetic)
    const pl = this.frustum.planes, fp = _tcp;
    for (let k = 0; k < 6; k++) { const n = pl[k].normal, o = k * 4; fp[o] = n.x; fp[o + 1] = n.y; fp[o + 2] = n.z; fp[o + 3] = pl[k].constant; }
    const T = this.tiles;
    const size = this.tileCells * this.cell;
    const maxY = this.maxY, minY = this.minY, vis = this.vis, first = this.first, ls = this.listeners, nl = ls.length;
    for (let tz = 0; tz < T; tz++) {
      for (let tx = 0; tx < T; tx++) {
        const i = tz * T + tx;
        const top = maxY[i];
        const infl = Math.min(400, Math.max(0, top) * 0.9) + 8;
        const x0 = tx * size - infl, y0 = minY[i], z0 = tz * size - infl, x1 = (tx + 1) * size + infl, y1 = top + 5, z1 = (tz + 1) * size + infl;
        let v = 1;
        for (let k = 0; k < 6; k++) {
          const o = k * 4, nx = fp[o], ny = fp[o + 1], nz = fp[o + 2];
          if (nx * (nx > 0 ? x1 : x0) + ny * (ny > 0 ? y1 : y0) + nz * (nz > 0 ? z1 : z0) + fp[o + 3] < 0) { v = 0; break; }
        }
        if (v !== vis[i] || first) {
          vis[i] = v;
          for (let l = 0; l < nl; l++) ls[l](i, v === 1);
        }
      }
    }
    this.first = false;
  }

  /** force every tile visible (e.g. for captures; the next update re-tests every tile) */
  showAll(): void {
    this.stale = true;
    for (let i = 0; i < this.vis.length; i++) {
      if (!this.vis[i]) {
        this.vis[i] = 1;
        for (const fn of this.listeners) fn(i, true);
      }
    }
  }
}
