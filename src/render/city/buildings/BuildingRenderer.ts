/**
 * BuildingRenderer — every building in ONE BatchedMesh (plus foundation skirts / construction sites / rubble in the
 * same batch). Incremental add/remove/change via Simulation events, pop-in animation, construction rising,
 * abandoned / burning / burnt looks, selection flag.
 *
 * Culling: per render pass (main view and each shadow cascade get their own draw list, see DynamicBatch
 * enablePassCulling); instances are registered in map tiles.
 * LOD: buildings whose projected radius drops below `lodPixels` swap to an auto-generated massing proxy
 * (lodProxy.ts, 12-40 triangles, same material / windows / night lights) with hysteresis; see updateLod(). Proxies
 * are built off the main thread (lodBuilder.ts worker): every model is queued for its proxy when it first appears
 * (background prefetch), a building that needs a proxy not built yet stays on its full model and swaps when it
 * arrives, so proxy generation never costs frame time (flushLod() builds everything synchronously for captures).
 * Without worker support (Node tests) proxies are built on demand within `lodBudgetMs` per frame.
 * Each building is re-evaluated only when the camera has travelled far enough to possibly carry it across its swap
 * distance, so a panning camera costs a few evaluations per frame and a still one none.
 * Camera cuts (jumps): the cut frame only upgrades what is in view — a scan of flat per-building arrays finds the
 * proxies that are now close enough to need their full model; those in the view frustum swap at once, the others are
 * queued first — and the rest of the re-evaluation (mostly downgrades to proxies, which only cost GPU while they wait)
 * is spread over the next frames at `lodCatch` evaluations per frame, so a cut costs about what a normal frame does
 * instead of thousands of evaluations + swaps at once.
 * LOD cross-fade: a building that changes level while it is in view and not tiny on screen dissolves from one level
 * into the other over `fadeTime` s (screen-door dither with complementary pixel sets anchored to the building's
 * screen position, the tree LOD fade's dither): both levels are drawn by a small side batch (LodFadeLayer: same
 * vertex buffer, a discard variant of the city material, so the main building program stays discard-free for
 * early-z) while the building's own instance draws a 3-vertex empty stand-in with the same culling sphere (no
 * draw-list rebuild). A level change back mid-fade runs the fade backwards. New / rebuilt buildings, camera cuts and
 * captures (flushLod) swap at once; beyond `fadeMax` concurrent fades swaps are instant too. The shadow switches at
 * the start of a fade (only the level fading in casts).
 * Burnt lots: one rubble tile (16 m, designed to tile) per footprint cell, variant + quarter turn from a per-cell
 * hash, instead of one model stretched over the lot. Hill lots: real-size stone retaining-wall skirts under lots that
 * sit above the terrain (see foundation()).
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../../core/constants';
import { BF, type Building, type CityState } from '../../../sim/CityState';
import { getDef } from '../../../sim/catalog';
import { getModelGeometry } from '../../../assets/registry';
import { MANIFEST_BY_ID } from '../../../assets/manifest';
import { ModelBuilder } from '../../../assets/ModelBuilder';
import { Surf } from '../../../core/types';
import { DynamicBatch, type TileCuller } from '../common/batch';
import { getCityMaterial, flagsToAlpha, IF_FIRE, IF_SELECTED, IF_WINDOWS_OFF } from '../common/cityMaterial';
import { shadowCasters } from '../../world/Shadows';
import { lodProxyFor } from './lodProxy';
import { lodProxyBuilder, type LodProxyBuilder } from './lodBuilder';

/** LOD proxies stay within their model's bounds + this (m; see tests/render/lod.test.ts) */
const PROXY_PAD = 0.6;

export interface BuildingVisual {
  id: number;
  model: string;
  variant: number;
  /** world center of the lot */
  cx: number;
  cz: number;
  baseY: number;
  yaw: number;
  /** lot size in meters (after rotation) */
  sw: number;
  sd: number;
  /** building top (world y) */
  top: number;
  /** model-space bounds */
  bounds: THREE.Box3;
  burning: boolean;
  burnt: boolean;
  constructing: boolean;
  abandoned: boolean;
  /** Y scale (construction progress / pop-in) */
  sy: number;
}

interface BInst {
  b: Building;
  main: number;
  site: number;
  found: number;
  /** burnt multi-cell lots: rubble tiles of the cells after the first (`main` = cell 0) and their quarter turns */
  cells: number[];
  cellYaw: number[];
  tile: number;
  key: string;
  flags: number;
  /** instance tint (abandoned / burning / constructing) */
  cr: number;
  cg: number;
  cb: number;
  anim: number;
  vis: BuildingVisual;
  geom: number;
  /** proxy geometry ids (= full id when the model has no proxy) */
  lodGeom: number;
  siteGeom: number;
  siteLod: number;
  /** 1 = drawn with the proxy (the target level while a cross-fade runs) */
  lod: number;
  /** bounding radius (m) + center height for the LOD metric */
  radius: number;
  cy: number;
  /** lowest terrain height under the lot (foundation skirt) */
  minH: number;
  /** index in BuildingRenderer.list (and the flat lx / ly / lz / lr / ls arrays) */
  li: number;
  /** LOD schedule: absolute travel bucket of its live queue entry (-1 = none, -2 = removed); queued in lodNow */
  due: number;
  now: boolean;
  /** full geometry id whose proxy (being built) this building waits for, -1 none */
  waiting: number;
  /** built / rebuilt since its last LOD evaluation: the first level is applied without a cross-fade */
  fresh: boolean;
  /** running LOD cross-fade */
  fade: Fade | null;
}

/** a running LOD cross-fade: the building's old and new level in the fade layer (slots), progress 0..1 */
interface Fade {
  bi: BInst;
  p: number;
  sOld: number;
  sNew: number;
  /** index in BuildingRenderer.fades */
  i: number;
}

/** LOD schedule: camera travel (m) per bucket, and ring size (travel horizon; longer slack is re-checked then) */
const LOD_BUCKET = 1;
const LOD_BUCKETS = 4096;
/** camera travel in one frame that counts as a jump (view change / cut): the cut frame only upgrades (flat scan), the
 *  rest is caught up over the next frames. At least LOD_JUMP m and half the camera height (a fast zoom at a far view
 *  moves the camera 100-300 m per frame: smooth motion, sliced) */
const LOD_JUMP = 150;

const POP_TIME = 0.55;
const _sphere = new THREE.Sphere();
const _q = new THREE.Quaternion();
const _pm = new THREE.Matrix4();

function easeOutBack(t: number): number {
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** stable per-cell hash for rubble tiles (variant + quarter turn) */
function cellHash(x: number, z: number, id: number): number {
  let h = Math.imul((x * 73856093) ^ (z * 19349663) ^ (id * 83492791), 0x5bd1e995);
  h ^= h >>> 15;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 13;
  return h >>> 0;
}

export function modelIdOf(b: Building): string {
  return getDef(b.def)?.model ?? b.def;
}

// ------------------------------------------------------------------------------------------------ LOD cross-fade

/** per-instance fade code in the colour alpha, next to the city material's flags (a = 1 - flags / 16, read back by
 *  rounding): a = 1 - (flags + o) / 16 with o = 0.02 + 0.2 t for the level fading IN (drawn where the dither noise
 *  < t) and 0.24 + 0.2 t for the level fading OUT (drawn where the noise >= t); o stays below 0.45 */
function fadeAlpha(flags: number, fadingIn: boolean, t: number): number {
  return 1 - ((flags & 15) + (fadingIn ? 0.02 : 0.24) + 0.2 * t) / 16;
}

/** dither resolution (px of the render target being drawn), written right before the fade layer draws */
const fadeUniforms = { uLodRes: { value: new THREE.Vector2(1, 1) } };

const FADE_VERT_PARS = /* glsl */ `
flat varying vec3 vLodFade;
`;
// after project_vertex: the instance's screen position (anchors the dither to the building) + its decoded code
const FADE_VERT = /* glsl */ `
#if defined( USE_BATCHING ) && defined( USE_BATCHING_COLOR )
{
  float _lx = (1.0 - getBatchingColor(getIndirectIndex(gl_DrawID)).a) * 16.0;
  float _lo = _lx - floor(_lx + 0.5);
  float _lt = clamp((_lo - (_lo > 0.23 ? 0.24 : 0.02)) / 0.2, 0.0, 1.0);
  vec4 _lc = projectionMatrix * viewMatrix * modelMatrix * vec4(batchingMatrix[3].xyz, 1.0);
  vLodFade = vec3(_lc.xy / max(abs(_lc.w), 1e-4), _lo > 0.23 ? -1.0 - _lt : _lt);
}
#else
  vLodFade = vec3(0.0, 0.0, 1.0);
#endif
`;
const FADE_FRAG_PARS = /* glsl */ `
flat varying vec3 vLodFade;
uniform vec2 uLodRes;
`;
// first thing in main(): interleaved gradient noise in pixels relative to the building's (pixel-snapped) screen
// position — stable per building while the camera moves; the two levels keep complementary pixel sets
const FADE_FRAG = /* glsl */ `
{
  vec2 _lpx = gl_FragCoord.xy - floor((vLodFade.xy * 0.5 + 0.5) * uLodRes);
  float _ln = fract(52.9829189 * fract(dot(_lpx, vec2(0.06711056, 0.00583715))));
  if (vLodFade.z >= 0.0 ? _ln >= vLodFade.z : _ln < -1.0 - vLodFade.z) discard;
}
`;

let _fadeMat: THREE.MeshStandardMaterial | null = null;
/** the city building material + the dithered LOD fade (only the fade layer uses it) */
function getFadeMaterial(): THREE.MeshStandardMaterial {
  if (_fadeMat) return _fadeMat;
  const city = getCityMaterial();
  const m = city.clone();
  const cityCompile = city.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    cityCompile.call(city, shader, renderer);
    shader.uniforms.uLodRes = fadeUniforms.uLodRes;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + FADE_VERT_PARS)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + FADE_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FADE_FRAG_PARS)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FADE_FRAG);
  };
  const cityKey = city.customProgramCacheKey();
  m.customProgramCacheKey = () => cityKey + '|lodfade-v1';
  m.name = 'building-lodfade';
  _fadeMat = m;
  return m;
}

/**
 * LodFadeLayer — a small BatchedMesh (child of the building batch) that draws the two levels of every building in a
 * LOD cross-fade. It shares the building batch's vertex buffer and geometry table (no model is uploaded twice) and
 * keeps its own compact instance slots [0, n) (matrix + colour texture rows = slot index). Draw lists are written
 * directly (no three.js per-instance culling: the few fading buildings are in view): the main pass draws every slot,
 * shadow passes only the levels fading in (own indirect texture). With no slot it is frustum-culled away (it stays
 * `visible`, so the precompile still builds its program).
 */
class LodFadeLayer {
  readonly mesh: THREE.BatchedMesh;
  n = 0;
  private cap = 0;
  private geo = new Int32Array(0);
  private fadingIn = new Uint8Array(0);
  private owner: (Fade | null)[] = [];
  private starts = new Int32Array(0);
  private counts = new Int32Array(0);
  private shStarts = new Int32Array(0);
  private shCounts = new Int32Array(0);
  private nMain = 0;
  private nShadow = 0;
  private mainInd!: THREE.DataTexture;
  private shInd!: THREE.DataTexture;
  private listDirty = true;
  private matDirty = false;
  private colDirty = false;

  constructor(private src: THREE.BatchedMesh, depth: THREE.Material | undefined) {
    const mesh = new THREE.BatchedMesh(64, 3, 6, getFadeMaterial());
    mesh.name = 'buildings-lodfade';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.perObjectFrustumCulled = false;
    mesh.sortObjects = false;
    if (depth) mesh.customDepthMaterial = depth;
    // culled while empty: a sphere far below the map never meets a frustum (no per-frame cost for an idle layer)
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -1e9, 0), 1);
    mesh.frustumCulled = true;
    (mesh as any)._initColorsTexture();
    this.mesh = mesh;
    this.fit(64);
    mesh.onBeforeRender = (renderer) => {
      const m = mesh as any;
      m._multiDrawStarts = this.starts;
      m._multiDrawCounts = this.counts;
      m._multiDrawCount = this.nMain;
      m._indirectTexture = this.mainInd;
      m._visibilityChanged = false;
      const rt = renderer.getRenderTarget();
      if (rt) fadeUniforms.uLodRes.value.set(rt.width, rt.height);
      else renderer.getDrawingBufferSize(fadeUniforms.uLodRes.value);
    };
    mesh.onBeforeShadow = () => {
      const m = mesh as any;
      m._multiDrawStarts = this.shStarts;
      m._multiDrawCounts = this.shCounts;
      m._multiDrawCount = this.nShadow;
      m._indirectTexture = this.shInd;
      m._visibilityChanged = false;
    };
    this.syncGeometry();
  }

  /** capacity for `cap` slots (textures grown with their content) */
  private fit(cap: number): void {
    const m = this.mesh as any;
    if (cap > this.cap) {
      if (this.cap > 0) {
        // (the mesh may hold the shadow list's indirect texture from the last pass)
        m._indirectTexture = this.mainInd;
        m.setInstanceCount(cap);
      }
      const g = new Int32Array(cap); g.set(this.geo); this.geo = g;
      const f = new Uint8Array(cap); f.set(this.fadingIn); this.fadingIn = f;
      this.starts = new Int32Array(cap); this.counts = new Int32Array(cap);
      this.shStarts = new Int32Array(cap); this.shCounts = new Int32Array(cap);
      this.cap = cap;
      // main list: draw k = slot k (identity); shadow list: its own indirect texture of the same size
      this.mainInd = m._indirectTexture as THREE.DataTexture;
      const ids = this.mainInd.image.data as unknown as Uint32Array;
      for (let i = 0; i < ids.length; i++) ids[i] = i;
      this.mainInd.needsUpdate = true;
      this.shInd?.dispose();
      const side = this.mainInd.image.width;
      this.shInd = new THREE.DataTexture(new Uint32Array(side * side), side, side, THREE.RedIntegerFormat, THREE.UnsignedIntType);
      this.shInd.needsUpdate = true;
      this.listDirty = this.matDirty = this.colDirty = true;
    }
  }

  /** follow the building batch's vertex buffer (DynamicBatch re-allocates it when it grows) */
  syncGeometry(): void {
    if (this.mesh.geometry !== this.src.geometry) this.mesh.geometry = this.src.geometry;
  }

  alloc(owner: Fade, geom: number, fadingIn: boolean): number {
    if (this.n >= this.cap) this.fit(this.cap * 2);
    const s = this.n++;
    this.geo[s] = geom;
    this.fadingIn[s] = fadingIn ? 1 : 0;
    this.owner[s] = owner;
    this.listDirty = true;
    return s;
  }

  /** remove slot s (the last slot moves into it; its owner is told) */
  free(s: number): void {
    const last = --this.n;
    if (s !== last) {
      const m = this.mesh as any;
      const mat = m._matricesTexture.image.data as Float32Array, col = m._colorsTexture.image.data as Float32Array;
      mat.copyWithin(s * 16, last * 16, last * 16 + 16);
      col.copyWithin(s * 4, last * 4, last * 4 + 4);
      this.geo[s] = this.geo[last];
      this.fadingIn[s] = this.fadingIn[last];
      const o = this.owner[last]!;
      this.owner[s] = o;
      if (o.sOld === last) o.sOld = s;
      else if (o.sNew === last) o.sNew = s;
      this.matDirty = this.colDirty = true;
    }
    this.owner[last] = null;
    this.listDirty = true;
  }

  setFadingIn(s: number, on: boolean): void {
    const v = on ? 1 : 0;
    if (this.fadingIn[s] !== v) { this.fadingIn[s] = v; this.listDirty = true; }
  }

  setMatrix(s: number, m: THREE.Matrix4): void {
    m.toArray((this.mesh as any)._matricesTexture.image.data as Float32Array, s * 16);
    this.matDirty = true;
  }

  setColor(s: number, r: number, g: number, b: number, a: number): void {
    const col = (this.mesh as any)._colorsTexture.image.data as Float32Array, o = s * 4;
    col[o] = r; col[o + 1] = g; col[o + 2] = b; col[o + 3] = a;
    this.colDirty = true;
  }

  /** once per frame before rendering: draw lists + texture uploads for what changed */
  sync(): void {
    this.syncGeometry();
    const mesh = this.mesh;
    if (this.n === 0) { mesh.frustumCulled = true; return; }
    mesh.frustumCulled = false;
    const m = mesh as any;
    if (this.listDirty) {
      this.listDirty = false;
      const info = (this.src as any)._geometryInfo as { start: number; count: number }[];
      const index = this.src.geometry.getIndex();
      const bpe = index === null ? 1 : index.array.BYTES_PER_ELEMENT;
      const sh = this.shInd.image.data as unknown as Uint32Array;
      let k = 0;
      for (let s = 0; s < this.n; s++) {
        const gi = info[this.geo[s]];
        const st = gi.start * bpe, ct = gi.count;
        this.starts[s] = st; this.counts[s] = ct;
        if (this.fadingIn[s]) { this.shStarts[k] = st; this.shCounts[k] = ct; sh[k] = s; k++; }
      }
      this.nMain = this.n;
      this.nShadow = k;
      this.shInd.needsUpdate = true;
      // the layer's shadow casters changed: cached shadow maps re-render
      shadowCasters.version++;
    }
    if (this.matDirty) { this.matDirty = false; m._matricesTexture.needsUpdate = true; }
    if (this.colDirty) { this.colDirty = false; m._colorsTexture.needsUpdate = true; }
  }

  dispose(): void {
    const m = this.mesh as any;
    this.mesh.removeFromParent();
    // (the vertex buffer belongs to the building batch)
    this.mesh.geometry = new THREE.BufferGeometry();
    m._indirectTexture = this.mainInd;
    this.shInd.dispose();
    this.mesh.dispose();
  }
}

export class BuildingRenderer {
  readonly batch: DynamicBatch;
  private inst = new Map<number, BInst>();
  private lastLodPixels = -1;
  /** LOD schedule by camera travel: after an evaluation a building's slack (distance to its swap distance) says how
   *  far the camera can travel before the building could need the other level (|distance change| <= path length);
   *  it is queued in the ring bucket of travel (lodTravel + slack) and re-evaluated when the travel gets there.
   *  New / rebuilt / (de)selected buildings and a new metric (quality, FOV, resize) are evaluated at once (lodNow). */
  private lodTravel = 0;
  private lodPos = new THREE.Vector3(NaN, NaN, NaN);
  private lodK = NaN;
  private lodBuckets: BInst[][] = Array.from({ length: LOD_BUCKETS }, () => []);
  private lodSpare: BInst[] = [];
  /** next bucket (absolute index) to evaluate */
  private lodAt = 0;
  private lodNow: BInst[] = [];
  private lodNowSpare: BInst[] = [];
  /** at most this many building evaluations per frame while the camera moves smoothly (a new metric spreads over a
   *  few frames) */
  lodSlice = 3000;
  /** evaluations per frame while catching up after a camera jump (upgrades are done by the cut frame's scan; what is
   *  left are mostly downgrades) */
  lodCatch = 1000;
  /** due evaluations were left over (after a jump or a heavy frame): upgrades come from the flat scan meanwhile */
  lodBehind = false;
  /** next update ignores lodSlice (flushLod: captures / benchmarks want the settled state now) */
  private lodFull = false;
  private animating = new Set<number>();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  /** full geometry id -> proxy geometry id (itself when the model has no useful proxy) */
  private lodMap = new Map<number, number>();
  /** full geometry ids whose proxy is not built yet -> [model, variant]: built on demand, when a building first
   *  needs it, within lodBudgetMs per frame (a proxy costs ~1-30 ms; building them all up front would add ~2 s to a
   *  city load and a hitch whenever a new variant appears) */
  private lodPending = new Map<number, [string, number]>();
  private lodDeadline = 0;
  /** CPU budget (ms per frame) for building LOD proxies on demand without a worker; flushLod() builds all pending
   *  ones at once */
  lodBudgetMs = 3;
  /** off-main-thread proxy builder (null: build synchronously) */
  private proxies: LodProxyBuilder | null;
  /** full geometry ids requested from the worker, and buildings waiting for their proxy */
  private lodAsked = new Set<number>();
  private lodUrgent = new Set<number>();
  private lodWaiting = new Map<number, BInst[]>();
  private disposed = false;
  /** dense list of instances for the per-frame LOD sweep */
  private list: BInst[] = [];
  /** flat copies per list index for the jump scan: LOD centre, radius, level (1 = proxy) */
  private lx = new Float32Array(1024);
  private ly = new Float32Array(1024);
  private lz = new Float32Array(1024);
  private lr = new Float32Array(1024);
  private ls = new Uint8Array(1024);
  /** every building is due (flushLod) */
  private lodDirty = true;
  /** projected radius (px) below which a building is drawn with its proxy (0 = LOD off); hysteresis +-12% */
  lodPixels = 9;
  /** buildings currently drawn with a proxy (stats; the target level while fading) */
  lodCount = 0;
  // ---- LOD cross-fade
  /** cross-fade duration (s); 0 = instant swaps */
  fadeTime = 0.35;
  /** at most this many buildings fade at once (more swaps in a frame are instant) */
  fadeMax = 1024;
  /** buildings fading in / out now smaller than lodPixels x this swap instantly (sub-threshold specks) */
  fadeMinFrac = 0.4;
  private fades: Fade[] = [];
  private fadeLayer: LodFadeLayer;
  /** full geometry id -> its 3-vertex empty stand-in (drawn by the building's instance while it fades) */
  private emptyMap = new Map<number, number>();
  /** this updateLod may start cross-fades (not a jump / flush); the building being evaluated is fresh */
  private fadeNow = false;
  private evalFresh = false;
  private lodCamera: THREE.PerspectiveCamera | null = null;
  private lodKNow = 1;
  private fr = new THREE.Frustum();
  private frOk = false;
  selected: number | null = null;
  onVisual: ((v: BuildingVisual | null, id: number) => void) | null = null;

  constructor(private state: CityState, private culler: TileCuller) {
    const pb = lodProxyBuilder();
    this.proxies = pb.available ? pb : null;
    this.batch = new DynamicBatch(getCityMaterial(), 4096, 1 << 18, 'buildings');
    this.batch.mesh.castShadow = true;
    this.batch.mesh.receiveShadow = true;
    // per-pass lists: the main view and each shadow cascade only draw the buildings inside their own frustum;
    // casters under ~1 shadow texel are skipped (far cascade at far zoom)
    this.batch.enablePassCulling({ culler, minShadowTexels: 1.2 });
    // nearest buildings first: occluded facades / lots behind them fail the depth test before the (heavy) uber shader
    this.batch.sortFront = true;
    this.fadeLayer = new LodFadeLayer(this.batch.mesh, this.batch.mesh.customDepthMaterial);
    this.batch.mesh.add(this.fadeLayer.mesh);
  }

  setState(state: CityState): void {
    this.state = state;
  }

  get count(): number {
    return this.inst.size;
  }

  /** buildings in a LOD cross-fade now (stats) */
  get fading(): number {
    return this.fades.length;
  }

  getVisual(id: number): BuildingVisual | null {
    return this.inst.get(id)?.vis ?? null;
  }

  *visuals(): IterableIterator<BuildingVisual> {
    for (const bi of this.inst.values()) yield bi.vis;
  }

  private geomFor(model: string, variant: number): number {
    const e = MANIFEST_BY_ID[model];
    const nv = e?.variants ?? 1;
    const v = ((variant % nv) + nv) % nv;
    const key = `${model}#${v}`;
    const fresh = !this.batch.hasGeometry(key);
    const id = this.batch.geometryId(key, () => getModelGeometry(model, v));
    // culling sphere with room for the LOD proxy (built later, within the model bounds + 0.6 m): model and proxy then
    // share one sphere and LOD swaps never force a draw-list rebuild
    if (fresh) this.batch.padSphere(id, PROXY_PAD);
    if (!this.lodMap.has(id) && !this.lodPending.has(id)) {
      this.lodPending.set(id, [model, v]);
      // background prefetch: most proxies exist before any building needs them
      this.askProxy(id, false);
    }
    return id;
  }

  /** queue a geometry's proxy on the worker (urgent: a building wants it now) */
  private askProxy(geom: number, urgent: boolean): void {
    const pb = this.proxies;
    const pend = this.lodPending.get(geom);
    if (!pb || !pend) return;
    if (this.lodAsked.has(geom) && (!urgent || this.lodUrgent.has(geom))) return;
    this.lodAsked.add(geom);
    if (urgent) this.lodUrgent.add(geom);
    const key = `${pend[0]}#${pend[1]}`;
    pb.request(key, getModelGeometry(pend[0], pend[1]), (g) => { if (!this.disposed) this.installProxy(geom, g); }, urgent);
  }

  /** register a built proxy (null = none) for a full geometry; wakes the buildings waiting for it */
  private installProxy(geom: number, proxy: THREE.BufferGeometry | null): number {
    const done = this.lodMap.get(geom);
    if (done !== undefined) return done;
    const pend = this.lodPending.get(geom);
    if (!pend) return geom;
    this.lodPending.delete(geom);
    this.lodAsked.delete(geom);
    this.lodUrgent.delete(geom);
    const key = `${pend[0]}#${pend[1]}`;
    const id = proxy ? this.batch.geometryId(key + '#lod', () => proxy) : geom;
    this.batch.shareSphere(geom, id, PROXY_PAD);
    this.lodMap.set(geom, id);
    // the model's empty cross-fade stand-in comes with its proxy (3 vertices in the space reserved at load: creating it
    // at the first fade could grow the batch's whole vertex buffer in the middle of a zoom)
    if (id !== geom) this.emptyOf(geom);
    const w = this.lodWaiting.get(geom);
    if (w) {
      this.lodWaiting.delete(geom);
      for (const bi of w) {
        if (bi.waiting !== geom) continue;
        bi.waiting = -1;
        if (bi.due !== -2 && bi.geom === geom) this.lodQueue(bi);
      }
    }
    return id;
  }

  /** a building needs geom's proxy, which the worker is still building: evaluate it again once it arrives */
  private waitFor(bi: BInst, geom: number): void {
    if (bi.waiting === geom) return;
    bi.waiting = geom;
    let w = this.lodWaiting.get(geom);
    if (!w) this.lodWaiting.set(geom, (w = []));
    w.push(bi);
    this.askProxy(geom, true);
  }

  /** proxy geometry id of a full geometry (itself when the model has none); -1 = not built yet (worker: requested;
   *  synchronous mode: no budget left this frame). force: build it synchronously now. */
  private proxyOf(geom: number, force = false): number {
    const p = this.lodMap.get(geom);
    if (p !== undefined) return p;
    const pend = this.lodPending.get(geom);
    if (!pend) return geom;
    if (!force) {
      if (this.proxies) { this.askProxy(geom, true); return -1; }
      if (performance.now() > this.lodDeadline) return -1;
    }
    return this.installProxy(geom, lodProxyFor(`${pend[0]}#${pend[1]}`, getModelGeometry(pend[0], pend[1])));
  }

  /** build every pending LOD proxy now and settle every level (captures, benchmarks): no cut catch-up, no fades */
  flushLod(): void {
    for (const g of [...this.lodPending.keys()]) this.proxyOf(g, true);
    for (const bi of this.list) if (bi.lodGeom < 0) bi.lodGeom = this.proxyOf(bi.geom, true);
    while (this.fades.length) this.finishFade(this.fades[this.fades.length - 1]);
    this.fadeLayer.sync();
    this.lodDirty = true;
    this.lodFull = true;
  }

  /**
   * Foundation skirt at its REAL size (the uber shader's stone courses live in model space, so the skirt must not be
   * scaled): coursed retaining-wall stone 0x8a8274 with a darker 0.3 m cap band; skirts deeper than 3 m step out in two
   * tiers so tall ones read as graded retaining walls instead of a hard grey cake plate. Depth is quantized
   * (1.2 / 2.2 / 3.4 / 4.8 / 6.8 m, the skirt reaches 0.8 m into the ground like before) to bound the geometry count.
   */
  private foundation(sw: number, sd: number, depth: number): number {
    const q = depth <= 1.2 ? 1.2 : depth <= 2.2 ? 2.2 : depth <= 3.4 ? 3.4 : depth <= 4.8 ? 4.8 : 6.8;
    const w = Math.round(sw * 10) / 10, d = Math.round(sd * 10) / 10;
    return this.batch.geometryId(`__foundation:${w}x${d}:${q}`, () => {
      const mb = new ModelBuilder();
      const hx = w / 2 - 0.1, hz = d / 2 - 0.1;
      mb.paint(0x6e675b, Surf.Stone).box(-hx - 0.04, -0.3, -hz - 0.04, hx + 0.04, 0, hz + 0.04, { top: null, bottom: null });
      if (q > 3) {
        const mid = -0.3 - (q - 0.3) * 0.5;
        mb.paint(0x8a8274, Surf.Stone).box(-hx, mid, -hz, hx, -0.3, hz, { top: null, bottom: null });
        // lower tier: 0.45 m wider, its own darker cap as a step
        mb.paint(0x6e675b, Surf.Stone).box(-hx - 0.45, mid - 0.25, -hz - 0.45, hx + 0.45, mid, hz + 0.45, { bottom: null });
        mb.paint(0x857d6f, Surf.Stone).box(-hx - 0.45, -q, -hz - 0.45, hx + 0.45, mid - 0.25, hz + 0.45, { top: null, bottom: null });
      } else {
        mb.paint(0x8a8274, Surf.Stone).box(-hx, -q, -hz, hx, -0.3, hz, { top: null, bottom: null });
      }
      return mb.build();
    });
  }

  clear(): void {
    for (const bi of this.inst.values()) { this.freeInstances(bi); bi.due = -2; }
    this.inst.clear();
    this.list.length = 0;
    for (const q of this.lodBuckets) q.length = 0;
    this.lodNow.length = 0;
    this.lodCount = 0;
    this.lodBehind = false;
    this.animating.clear();
    this.fadeLayer.sync();
  }

  rebuildAll(): void {
    this.clear();
    for (const b of this.state.buildings.values()) this.add(b, false);
    // room for the proxies the worker is about to deliver (<= ~180 triangles each) and their 3-vertex cross-fade
    // stand-ins: growing the batch's vertex buffer later would re-upload all of it in some frame
    this.batch.reserveVertices(this.lodPending.size * 203);
  }

  private freeInstances(bi: BInst): void {
    if (bi.fade) this.dropFade(bi.fade);
    if (bi.main >= 0) this.batch.remove(bi.main);
    if (bi.site >= 0) this.batch.remove(bi.site);
    if (bi.found >= 0) this.batch.remove(bi.found);
    for (const id of bi.cells) this.batch.remove(id);
    bi.cells.length = 0;
    bi.cellYaw.length = 0;
    bi.main = bi.site = bi.found = -1;
  }

  private stateKey(b: Building): string {
    const f = b.flags;
    const burnt = f & BF.Burnt ? 1 : 0;
    const cons = !burnt && (f & BF.Constructing || b.built < 1) ? 1 : 0;
    return `${modelIdOf(b)}|${b.variant}|${burnt}|${cons}|${f & BF.Abandoned ? 1 : 0}|${f & BF.OnFire ? 1 : 0}|${b.x},${b.z},${b.w},${b.d},${b.rot},${b.baseY.toFixed(2)}`;
  }

  /** room in the flat per-building arrays for index i */
  private ensureFlat(i: number): void {
    if (i < this.ls.length) return;
    const n = Math.max(i + 1, this.ls.length * 2);
    const grow = (a: Float32Array) => { const b = new Float32Array(n); b.set(a); return b; };
    this.lx = grow(this.lx); this.ly = grow(this.ly); this.lz = grow(this.lz); this.lr = grow(this.lr);
    const s = new Uint8Array(n); s.set(this.ls); this.ls = s;
  }

  add(b: Building, animate = true): void {
    if (this.inst.has(b.id)) this.remove(b.id);
    const bi: BInst = {
      b, main: -1, site: -1, found: -1, cells: [], cellYaw: [], tile: 0, key: '', flags: 0, cr: 1, cg: 1, cb: 1, anim: animate ? POP_TIME : 0, geom: -1,
      vis: null as unknown as BuildingVisual, lodGeom: -1, siteGeom: -1, siteLod: -1, lod: 0, radius: 1, cy: 0, minH: 0, li: this.list.length,
      due: -1, now: false, waiting: -1, fresh: true, fade: null,
    };
    this.inst.set(b.id, bi);
    this.ensureFlat(bi.li);
    this.list.push(bi);
    this.ls[bi.li] = 0;
    this.build(bi);
    if (animate) this.animating.add(b.id);
  }

  remove(id: number): void {
    const bi = this.inst.get(id);
    if (!bi) return;
    this.freeInstances(bi);
    this.inst.delete(id);
    if (bi.lod) this.lodCount--;
    bi.due = -2;
    const last = this.list.pop()!;
    if (last !== bi) {
      const i = bi.li, j = last.li;
      this.list[i] = last;
      last.li = i;
      this.lx[i] = this.lx[j]; this.ly[i] = this.ly[j]; this.lz[i] = this.lz[j]; this.lr[i] = this.lr[j]; this.ls[i] = this.ls[j];
    }
    this.animating.delete(id);
    this.onVisual?.(null, id);
  }

  changed(b: Building): void {
    const bi = this.inst.get(b.id);
    if (!bi) { this.add(b, true); return; }
    bi.b = b;
    const key = this.stateKey(b);
    if (key !== bi.key) {
      const wasCons = bi.key.split('|')[3] === '1';
      this.freeInstances(bi);
      this.build(bi);
      if (wasCons && !bi.vis.constructing && !bi.vis.burnt) {
        bi.anim = POP_TIME * 0.7;
        this.animating.add(b.id);
      }
    } else if (bi.vis.constructing) {
      // construction progress only
      this.place(bi);
    }
  }

  private build(bi: BInst): void {
    const b = bi.b;
    const st = this.state;
    const f = b.flags;
    const model = modelIdOf(b);
    const burnt = !!(f & BF.Burnt);
    const constructing = !burnt && (!!(f & BF.Constructing) || b.built < 1);
    const abandoned = !!(f & BF.Abandoned);
    const burning = !!(f & BF.OnFire) && !burnt;
    bi.key = this.stateKey(b);
    bi.fresh = true;
    const cx = (b.x + b.w / 2) * CELL_SIZE, cz = (b.z + b.d / 2) * CELL_SIZE;
    const yaw = b.rot * (Math.PI / 2);
    // burnt: the rubble model covers ONE 16 m cell (designed to tile) -> one tile per footprint cell, variant + quarter
    // turn from a per-cell hash, at scale 1, instead of one heap stretched over the lot. Tiled rubble has no LOD
    // (<= 200 triangles a cell, and the cells must not switch one by one)
    const tiled = burnt && b.w * b.d > 1;
    const geom = burnt ? this.geomFor('rubble', tiled ? cellHash(b.x, b.z, b.id) : b.id) : this.geomFor(model, b.variant);
    bi.geom = geom;
    // a building currently drawn as a proxy gets its new model's proxy right away if it exists (no detail pop; without
    // a worker it is built now), else it shows the full model until the worker delivers; for the others the proxy is
    // looked up by updateLod (-1 until then)
    bi.lodGeom = tiled ? geom : this.proxyOf(geom, bi.lod === 1 && !this.proxies);
    if (bi.lod === 1 && (bi.lodGeom < 0 || bi.lodGeom === geom)) {
      bi.lod = 0;
      this.lodCount--;
      if (bi.lodGeom < 0) this.waitFor(bi, geom);
    }
    bi.siteGeom = bi.siteLod = -1;
    const bounds = this.batch.bounds(geom);
    // keep the current LOD state across rebuilds (state changes must not pop the detail level)
    bi.main = this.batch.add(bi.lod ? bi.lodGeom : geom);
    if (tiled) {
      for (let k = 1; k < b.w * b.d; k++) {
        const h = cellHash(b.x + (k % b.w), b.z + Math.floor(k / b.w), b.id);
        bi.cells.push(this.batch.add(this.geomFor('rubble', h)));
        bi.cellYaw.push(((h >>> 7) & 3) * (Math.PI / 2));
      }
    }
    if (constructing) {
      bi.siteGeom = this.geomFor('construction_site', b.id);
      bi.siteLod = this.proxyOf(bi.siteGeom, true);
      bi.site = this.batch.add(bi.lod ? bi.siteLod : bi.siteGeom);
    }
    // foundation skirt down to the lowest lot corner
    const N1 = st.size + 1;
    let minH = Infinity;
    for (let z = b.z; z <= b.z + b.d; z++) for (let x = b.x; x <= b.x + b.w; x++) {
      const h = st.heights[Math.min(st.size, z) * N1 + Math.min(st.size, x)];
      if (h < minH) minH = h;
    }
    bi.minH = minH;
    const depth = b.baseY - minH;
    if (depth > 0.08) bi.found = this.batch.add(this.foundation(b.w * CELL_SIZE, b.d * CELL_SIZE, depth + 0.8));
    bi.tile = this.culler.tileOf(b.x + (b.w >> 1), b.z + (b.d >> 1));
    // flags / tint
    let flags = 0;
    if (abandoned) flags |= IF_WINDOWS_OFF;
    if (burning) flags |= IF_FIRE;
    if (this.selected === b.id) flags |= IF_SELECTED;
    bi.flags = flags;
    bi.vis = {
      id: b.id, model: burnt ? 'rubble' : model, variant: b.variant, cx, cz, baseY: b.baseY, yaw, sw: b.w * CELL_SIZE, sd: b.d * CELL_SIZE,
      top: b.baseY + bounds.max.y, bounds, burning, burnt, constructing, abandoned, sy: 1,
    };
    this.culler.noteHeight(bi.tile, b.baseY + bounds.max.y);
    const sp = bounds.getBoundingSphere(_sphere);
    bi.radius = Math.max(2, sp.radius);
    bi.cy = b.baseY + sp.center.y;
    const li = bi.li;
    this.lx[li] = cx; this.ly[li] = bi.cy; this.lz[li] = cz; this.lr[li] = bi.radius; this.ls[li] = bi.lod;
    this.applyColor(bi);
    this.place(bi);
    for (const id of [bi.main, bi.site, bi.found]) if (id >= 0) this.batch.setTile(id, bi.tile);
    for (const id of bi.cells) this.batch.setTile(id, bi.tile);
    this.applyVisibility(bi, true);
    this.lodQueue(bi);
    this.onVisual?.(bi.vis, b.id);
  }

  private applyColor(bi: BInst): void {
    const v = bi.vis;
    let r = 1, g = 1, bb = 1;
    if (v.abandoned) { r = 0.46; g = 0.44; bb = 0.42; }
    else if (v.burning) { r = 0.62; g = 0.56; bb = 0.5; }
    else if (v.constructing) { r = 0.92; g = 0.9; bb = 0.86; }
    bi.cr = r; bi.cg = g; bi.cb = bb;
    const a = flagsToAlpha(bi.flags);
    if (bi.main >= 0) this.batch.setColor(bi.main, r, g, bb, a);
    if (bi.site >= 0) this.batch.setColor(bi.site, 1, 1, 1, flagsToAlpha(bi.flags & IF_SELECTED));
    if (bi.found >= 0) this.batch.setColor(bi.found, 1, 1, 1, 1);
    for (const id of bi.cells) this.batch.setColor(id, r, g, bb, a);
    if (bi.fade) this.fadeColors(bi.fade);
  }

  private applyVisibility(bi: BInst, visible: boolean): void {
    if (bi.main >= 0) this.batch.setVisible(bi.main, visible);
    if (bi.site >= 0) this.batch.setVisible(bi.site, visible);
    if (bi.found >= 0) this.batch.setVisible(bi.found, visible);
    for (const id of bi.cells) this.batch.setVisible(id, visible);
  }

  private place(bi: BInst): void {
    const b = bi.b;
    const v = bi.vis;
    let pop = 1;
    if (bi.anim > 0) pop = Math.max(0.02, easeOutBack(1 - bi.anim / POP_TIME));
    const yawQ = this.q.setFromAxisAngle(this.up, v.yaw);
    // main
    let sy = 1;
    if (v.constructing) sy = Math.max(0.03, Math.min(1, b.built));
    sy *= pop;
    v.sy = sy;
    const sxz = bi.anim > 0 ? 0.85 + 0.15 * Math.min(1, pop) : 1;
    if (bi.main >= 0) {
      if (v.burnt && b.w * b.d > 1) {
        // one rubble tile per cell (cell 0 = main, the rest in bi.cells), each at its own quarter turn, scale 1
        for (let k = 1; k <= bi.cells.length; k++) {
          const x = b.x + (k % b.w), z = b.z + Math.floor(k / b.w);
          _q.setFromAxisAngle(this.up, bi.cellYaw[k - 1]);
          this.m4.compose(this.v.set((x + 0.5) * CELL_SIZE, v.baseY, (z + 0.5) * CELL_SIZE), _q, this.s.set(1, 1, 1));
          this.batch.setMatrix(bi.cells[k - 1], this.m4);
        }
        _q.setFromAxisAngle(this.up, ((cellHash(b.x, b.z, b.id) >>> 7) & 3) * (Math.PI / 2));
        this.m4.compose(this.v.set((b.x + 0.5) * CELL_SIZE, v.baseY, (b.z + 0.5) * CELL_SIZE), _q, this.s.set(1, 1, 1));
      } else if (v.burnt) {
        const fw = b.rot & 1 ? b.d : b.w, fd = b.rot & 1 ? b.w : b.d;
        this.m4.compose(this.v.set(v.cx, v.baseY, v.cz), yawQ, this.s.set(fw * 0.9, 1, fd * 0.9));
      } else {
        this.m4.compose(this.v.set(v.cx, v.baseY, v.cz), yawQ, this.s.set(sxz, sy, sxz));
      }
      this.batch.setMatrix(bi.main, this.m4);
      const f = bi.fade;
      if (f) { this.fadeLayer.setMatrix(f.sOld, this.m4); this.fadeLayer.setMatrix(f.sNew, this.m4); }
    }
    if (bi.site >= 0) {
      const fw = b.rot & 1 ? b.d : b.w, fd = b.rot & 1 ? b.w : b.d;
      // X/Z stretch to the lot; Y by sqrt(lot cells) so the crane keeps plausible proportions
      const ys = Math.sqrt(b.w * b.d);
      this.m4.compose(this.v.set(v.cx, v.baseY + 0.01, v.cz), yawQ, this.s.set(fw, ys * Math.min(1, pop), fd));
      this.batch.setMatrix(bi.site, this.m4);
    }
    if (bi.found >= 0) {
      // real-size geometry (see foundation()): no scaling, so the stone courses keep their size
      this.m4.compose(this.v.set(v.cx, v.baseY + 0.02, v.cz), this.q.identity(), this.s.set(1, 1, 1));
      this.batch.setMatrix(bi.found, this.m4);
    }
  }

  setSelected(id: number | null): void {
    const prev = this.selected;
    this.selected = id;
    for (const k of [prev, id]) {
      if (k == null) continue;
      const bi = this.inst.get(k);
      if (!bi) continue;
      this.lodQueue(bi);
      bi.flags = (bi.flags & ~IF_SELECTED) | (k === id ? IF_SELECTED : 0);
      this.applyColor(bi);
    }
  }

  /**
   * Distance LOD: swap buildings to / from their proxy by projected radius (px) with hysteresis. Call once per frame
   * with the view camera and the drawing-buffer height in pixels. Only buildings the camera travel could have carried
   * across their swap distance are evaluated (none while the camera stands still or only turns); after a camera jump
   * the cut frame only upgrades (flat scan) and the remaining evaluations are spread over the next frames.
   */
  updateLod(camera: THREE.PerspectiveCamera, heightPx: number): void {
    const c = camera.position;
    // px = radius / dist * H / (2 tan(fov/2)): swap to the proxy beyond dist = radius * K / on, back within radius * K / off
    const K = (heightPx / Math.tan((camera.fov * Math.PI) / 360)) * 0.5;
    if (this.lodDirty || this.lodPixels !== this.lastLodPixels || !(Math.abs(K - this.lodK) < 0.25)) {
      // new metric (quality preset, FOV, resize) or a flush: every building is due now
      this.lodDirty = false;
      this.lastLodPixels = this.lodPixels;
      this.lodK = K;
      for (const bi of this.list) this.lodQueue(bi);
    }
    const p = this.lodPos;
    const hop = p.x === p.x ? Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z) : 0;
    this.lodTravel += hop;
    p.copy(c);
    const cur = Math.floor(this.lodTravel / LOD_BUCKET);
    if (cur - this.lodAt >= LOD_BUCKETS - 2) {
      // a jump beyond the schedule horizon: everything is due
      for (const q of this.lodBuckets) q.length = 0;
      for (const bi of this.list) this.lodQueue(bi);
      this.lodAt = cur + 1;
    }
    const behind = this.lodBehind;
    if (!this.lodNow.length && this.lodAt > cur && !behind) { this.fadeLayer.sync(); return; }
    const on = this.lodPixels * 0.88, off = this.lodPixels * 1.12;
    this.lodDeadline = performance.now() + this.lodBudgetMs;
    const full = this.lodFull;
    this.lodFull = false;
    // a jump (view change, camera cut): the cut frame upgrades every proxy that is now close (a slice would leave big
    // buildings in view on their proxies for a frame or two); the downgrades wait for the catch-up frames
    const jump = !full && hop > Math.max(LOD_JUMP, c.y * 0.5);
    this.lodCamera = camera;
    this.lodKNow = K;
    this.frOk = false;
    this.fadeNow = !full && !jump && this.fadeTime > 0;
    if (!full && this.lodPixels > 0 && (jump || (behind && hop > 0))) this.upgradeScan(c, K, on, off, cur);
    let budget = full ? Infinity : jump ? this.lodCatch >> 2 : behind ? this.lodCatch : this.lodSlice;
    if (this.lodNow.length && budget > 0) {
      // (two alternating arrays: no garbage per frame)
      const q = this.lodNow;
      this.lodNow = this.lodNowSpare;
      this.lodNowSpare = q;
      let i = 0;
      for (; i < q.length && budget > 0; i++) {
        const bi = q[i];
        bi.now = false;
        if (bi.due === -2) continue;
        this.lodEval(bi, c, K, on, off, cur);
        budget--;
      }
      // over the frame budget: the rest stays due
      for (; i < q.length; i++) this.lodNow.push(q[i]);
      q.length = 0;
    }
    while (this.lodAt <= cur && budget > 0) {
      const slot = this.lodAt % LOD_BUCKETS;
      const q = this.lodBuckets[slot];
      // re-scheduled entries may land in this ring slot again (one lap ahead): collect them in a fresh array
      this.lodBuckets[slot] = this.lodSpare;
      for (let i = 0; i < q.length; i++) {
        const bi = q[i];
        // stale entry (re-queued / removed since)
        if (bi.due !== this.lodAt) continue;
        this.lodEval(bi, c, K, on, off, cur);
        budget--;
      }
      q.length = 0;
      this.lodSpare = q;
      this.lodAt++;
    }
    this.lodBehind = this.lodNow.length > 0 || this.lodAt <= cur;
    this.fadeLayer.sync();
  }

  /** every building drawn as a proxy that is now within its upgrade distance gets its full model: evaluated now when it
   *  is in the view, else queued first for the catch-up frames (out of view it only draws into shadows). A flat pass
   *  over typed arrays: ~10k buildings in well under a millisecond */
  private upgradeScan(c: THREE.Vector3, K: number, on: number, off: number, cur: number): void {
    const lx = this.lx, ly = this.ly, lz = this.lz, lr = this.lr, ls = this.ls, list = this.list;
    const px = c.x, py = c.y, pz = c.z, off2 = off * off, K2 = K * K;
    const fr = this.viewFrustum();
    for (let i = 0, n = list.length; i < n; i++) {
      if (ls[i] !== 1) continue;
      const dx = lx[i] - px, dy = ly[i] - py, dz = lz[i] - pz;
      const r = lr[i];
      if ((dx * dx + dy * dy + dz * dz) * off2 >= r * r * K2) continue;
      _sphere.center.set(lx[i], ly[i], lz[i]);
      _sphere.radius = r;
      if (!fr || fr.intersectsSphere(_sphere)) this.lodEval(list[i], c, K, on, off, cur);
      else this.lodQueue(list[i]);
    }
    // the selected building is always drawn full
    if (this.selected != null) {
      const s = this.inst.get(this.selected);
      if (s && s.lod) this.lodEval(s, c, K, on, off, cur);
    }
  }

  /** evaluate a building's LOD at the next update */
  private lodQueue(bi: BInst): void {
    if (bi.due === -2) return;
    bi.due = -1;
    if (!bi.now) { bi.now = true; this.lodNow.push(bi); }
  }

  /** evaluate a building's LOD now (swap if needed) and schedule its next evaluation */
  private lodEval(bi: BInst, c: THREE.Vector3, K: number, on: number, off: number, cur: number): void {
    bi.due = -1;
    // a building's first level after it was built / rebuilt is applied at once (no fade); a later swap (also the one
    // when a proxy it waited for arrives) fades
    this.evalFresh = bi.fresh;
    bi.fresh = false;
    // no proxy: always full, nothing to schedule (a rebuild re-queues it)
    if (bi.lodGeom === bi.geom && bi.siteLod === bi.siteGeom) { this.lodSet(bi, 0); return; }
    const v = bi.vis;
    const dx = v.cx - c.x, dy = bi.cy - c.y, dz = v.cz - c.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rk = bi.radius * K;
    const lim = this.lodPixels > 0 && bi.b.id !== this.selected;
    const want = lim && d * (bi.lod ? off : on) > rk ? 1 : 0;
    if (want && bi.lodGeom < 0) {
      // first time this model is needed as a proxy: the worker builds it (the building stays full and is evaluated again
      // when it arrives); without a worker it is built within the frame budget, else retried next frame
      const pg = this.proxyOf(bi.geom);
      if (pg < 0) {
        if (this.proxies) this.waitFor(bi, bi.geom);
        else this.lodQueue(bi);
        return;
      }
      bi.lodGeom = pg;
      if (pg === bi.geom && bi.siteLod === bi.siteGeom) { this.lodSet(bi, 0); return; }
    }
    this.lodSet(bi, want);
    // LOD off / selected: stays full until the metric or the selection changes (both re-queue)
    if (!lim) return;
    // camera travel before the swap distance can be reached; the bucket at or before that travel (at least the next)
    const slack = want ? d - rk / off : rk / on - d;
    // (capped one ring lap past the oldest unprocessed bucket, so no live entry shares a slot that is still pending)
    const b = Math.min(this.lodAt + LOD_BUCKETS - 1, Math.max(cur + 1, Math.floor((this.lodTravel + Math.max(0, slack)) / LOD_BUCKET)));
    bi.due = b;
    this.lodBuckets[b % LOD_BUCKETS].push(bi);
  }

  private lodSet(bi: BInst, want: number): void {
    if (want === bi.lod) return;
    bi.lod = want;
    this.lodCount += want ? 1 : -1;
    this.ls[bi.li] = want;
    const f = bi.fade;
    // a level change back mid-fade: the fade runs backwards from where it is
    if (f) this.reverseFade(f);
    else if (bi.main >= 0) {
      const from = want ? bi.geom : bi.lodGeom, to = want ? bi.lodGeom : bi.geom;
      if (from !== to && this.canFade(bi)) this.startFade(bi, from, to);
      else this.batch.setGeometry(bi.main, to);
    }
    if (bi.site >= 0) this.batch.setGeometry(bi.site, want ? bi.siteLod : bi.siteGeom);
  }

  // ------------------------------------------------------------------ LOD cross-fade
  /** fade this swap? (smooth camera motion, not the building's first level, in the view, not a sub-threshold speck) */
  private canFade(bi: BInst): boolean {
    if (!this.fadeNow || this.evalFresh || this.fades.length >= this.fadeMax || bi.cells.length) return false;
    const cam = this.lodCamera;
    if (!cam) return false;
    const v = bi.vis, c = cam.position;
    const dx = v.cx - c.x, dy = bi.cy - c.y, dz = v.cz - c.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // projected radius (px) = radius * K / d
    if (bi.radius * this.lodKNow < d * this.lodPixels * this.fadeMinFrac) return false;
    _sphere.center.set(v.cx, bi.cy, v.cz);
    _sphere.radius = bi.radius;
    return this.viewFrustum()!.intersectsSphere(_sphere);
  }

  /** the LOD camera's view frustum (built once per updateLod, when first needed) */
  private viewFrustum(): THREE.Frustum | null {
    const cam = this.lodCamera;
    if (!cam) return null;
    if (!this.frOk) {
      this.fr.setFromProjectionMatrix(_pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      this.frOk = true;
    }
    return this.fr;
  }

  /** the building's 3-vertex empty stand-in for model geometry `geom` (same culling sphere: swapping to it and back
   *  only refreshes draw ranges) */
  private emptyOf(geom: number): number {
    const done = this.emptyMap.get(geom);
    if (done !== undefined) return done;
    const src = this.batch.mesh.geometry;
    const bb = this.batch.bounds(geom);
    const c = bb.getCenter(new THREE.Vector3());
    const g = new THREE.BufferGeometry();
    for (const name in src.attributes) {
      const a = src.getAttribute(name) as THREE.BufferAttribute;
      const arr = new (a.array.constructor as Float32ArrayConstructor)(3 * a.itemSize);
      if (name === 'position') for (let k = 0; k < 3; k++) { arr[k * 3] = c.x; arr[k * 3 + 1] = c.y; arr[k * 3 + 2] = c.z; }
      else if (name === 'normal') for (let k = 0; k < 3; k++) arr[k * 3 + 1] = 1;
      g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
    }
    if (src.getIndex()) g.setIndex([0, 1, 2]);
    g.boundingBox = bb.clone();
    const id = this.batch.geometryId(`__empty:${geom}`, () => g);
    this.batch.shareSphere(geom, id, PROXY_PAD);
    this.emptyMap.set(geom, id);
    return id;
  }

  private startFade(bi: BInst, from: number, to: number): void {
    const L = this.fadeLayer;
    const f: Fade = { bi, p: 0, sOld: -1, sNew: -1, i: this.fades.length };
    f.sOld = L.alloc(f, from, false);
    f.sNew = L.alloc(f, to, true);
    this.fades.push(f);
    bi.fade = f;
    this.batch.mesh.getMatrixAt(bi.main, this.m4);
    L.setMatrix(f.sOld, this.m4);
    L.setMatrix(f.sNew, this.m4);
    this.fadeColors(f);
    this.batch.setGeometry(bi.main, this.emptyOf(bi.geom));
  }

  private reverseFade(f: Fade): void {
    const s = f.sOld;
    f.sOld = f.sNew;
    f.sNew = s;
    this.fadeLayer.setFadingIn(f.sOld, false);
    this.fadeLayer.setFadingIn(f.sNew, true);
    f.p = 1 - f.p;
    this.fadeColors(f);
  }

  /** write both levels' fade codes (smoothstep of the progress) */
  private fadeColors(f: Fade): void {
    const bi = f.bi, p = f.p, t = p * p * (3 - 2 * p);
    this.fadeLayer.setColor(f.sNew, bi.cr, bi.cg, bi.cb, fadeAlpha(bi.flags, true, t));
    this.fadeLayer.setColor(f.sOld, bi.cr, bi.cg, bi.cb, fadeAlpha(bi.flags, false, t));
  }

  /** remove a fade's slots (the building's instance keeps whatever it draws) */
  private dropFade(f: Fade): void {
    this.fadeLayer.free(f.sOld);
    // (freeing sOld may have moved sNew)
    this.fadeLayer.free(f.sNew);
    const last = this.fades.pop()!;
    if (last !== f) { this.fades[f.i] = last; last.i = f.i; }
    f.bi.fade = null;
  }

  /** the fade is done: the building's instance draws its (new) level again */
  private finishFade(f: Fade): void {
    const bi = f.bi;
    this.dropFade(f);
    if (bi.main >= 0) this.batch.setGeometry(bi.main, bi.lod ? bi.lodGeom : bi.geom);
  }

  update(dt: number): void {
    if (this.animating.size) {
      for (const id of this.animating) {
        const bi = this.inst.get(id);
        if (!bi) { this.animating.delete(id); continue; }
        bi.anim = Math.max(0, bi.anim - dt);
        this.place(bi);
        if (bi.anim <= 0) this.animating.delete(id);
      }
    }
    if (this.fades.length) {
      const k = this.fadeTime > 0 ? dt / this.fadeTime : 1;
      // (backwards: a finished fade is replaced by the last one, which was already advanced)
      for (let i = this.fades.length - 1; i >= 0; i--) {
        const f = this.fades[i];
        f.p += k;
        if (f.p >= 1) this.finishFade(f);
        else this.fadeColors(f);
      }
      // the fade material follows the city material's scalars (syncCityMaterials)
      const city = getCityMaterial(), fm = getFadeMaterial();
      if (fm.envMapIntensity !== city.envMapIntensity || fm.roughness !== city.roughness || fm.metalness !== city.metalness) {
        fm.envMapIntensity = city.envMapIntensity; fm.roughness = city.roughness; fm.metalness = city.metalness;
      }
    }
    this.fadeLayer.sync();
  }

  /** terrain changed under rect: re-evaluate foundations */
  terrainChanged(x0: number, z0: number, x1: number, z1: number): void {
    for (const bi of this.inst.values()) {
      const b = bi.b;
      if (b.x + b.w < x0 || b.x > x1 || b.z + b.d < z0 || b.z > z1) continue;
      this.freeInstances(bi);
      this.build(bi);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.fadeLayer.dispose();
    this.batch.dispose();
  }
}
