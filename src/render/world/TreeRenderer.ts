/**
 * TreeRenderer — instanced trees scattered from state.trees (density 0..4 per cell).
 *
 * Layout: the map is split into 32 x 32-cell chunks. Each chunk owns
 *   - near LOD: one InstancedMesh per (species, variant) actually used in the chunk (full models, cast shadows)
 *   - far LOD:  two InstancedMeshes (broadleaf blob / conifer cone impostors, ~20 tris) tinted per instance with
 *               the species' average foliage color; instance order is shuffled so lowering `count` thins the
 *               forest uniformly with distance (density fade).
 * LOD cross-fade: near models and impostors overlap in a distance band around `lodDistance`; inside it each tree
 * fades per instance (distance + per-tree jitter), so there is no chunk-sized pop. With MSAA (high / ultra) the fade
 * is alpha-to-coverage (sub-pixel coverage, smooth after the resolve; the impostor fades in while the model is still
 * opaque, then the model fades out, so no tree is ever see-through); without MSAA it is a complementary screen-door
 * dither (near keeps the pixels the impostor drops) over a narrower band, with the pattern anchored to each tree's
 * screen position so it moves with the tree instead of crawling over it while the camera pans. Chunks fully inside /
 * outside the band use the plain material (no discard). In shadow passes the switch is a hard per-instance cut
 * (custom depth materials) at shadowLodFrac x lodDistance: beyond it trees cast impostor shadows, also where the view
 * still shows near models (shadow-only impostor meshes). Every fade / cut program variant is compiled with the first
 * frames (hidden warm-up meshes), not when the first chunk enters a band.
 * Far chunks whose trees project to ~1-2 px swap to micro impostors (4-8 tris); impostors only cast shadows into
 * cascades with texels <= impostorShadowTexel (they are sub-texel specks in the far cascade). Every mesh gets tight
 * bounds from its instances (shadow cascades cull by the real extent, not the 512 m chunk).
 * Placement is deterministic per cell (hash of cell + seed), so rebuilding a chunk after an edit never moves
 * unaffected trees. Cells with network / buildings / zones / power lines / water get no trees.
 * Seasons: deciduous species (nat_season.ts) show autumn / bare / blossom model variants for the month's fraction of
 * trees (per cell); conifers stay green, darker in winter (shared foliage shader), and every tree above the terrain's
 * seasonal snow line is snow-dusted (same line + noise as the terrain). Impostors get metric object coordinates in the
 * shader, so the shared foliage shading treats them like the model they stand for.
 * Outer ring (far view): beyond the map edge (the terrain's landscape skirt) impostor-only trees stand on the terrain
 * shader's outside forests, out to ringWidth, in 8 sectors (see the RING_* constants and ringStep):
 *   - candidates are a pure function of the noise texture, the outer terrain and the seed (the map's own cells only
 *     reach the edge band), generated (and filled) once per map with the load, at full density (a per-tree threshold
 *     picks the quality's subset): a quality / density, season or map-cell change only refills, in a ~1 ms-per-frame
 *     budget; only a terrain edit on the map border regenerates the sectors on that side (same budget);
 *   - drawn as one mesh per sector (micro impostors, conifers carry an evergreen flag) beyond lodDistance, as the
 *     broadleaf / conifer impostor pair closer in; hidden from low (street-level) cameras, where the city and the edge
 *     band hide it anyway; thinned at low quality; no shadows.
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../core/constants';
import { Noise2D, hash2 } from '../../core/rng';
import type { CellRect } from '../../core/events';
import type { Climate } from '../../core/types';
import { MANIFEST_BY_ID } from '../../assets/manifest';
import { getBuildingMaterial, patchSurfaceMaterial } from '../../assets/materials';
import { getNoiseTexture } from './textures';
import type { CityState } from '../../sim/CityState';
import { getImpostorGeometries, getMicroImpostorGeometries, getNatureGeometry, natureStats } from './fallbackTrees';
import { TerrainRenderer } from './TerrainRenderer';
import { shadowCasters, type ShadowReceiver } from './Shadows';
import { SEASONAL_TREES, seasonMix, seasonalVariant, type SeasonMix } from '../../assets/builders/nat_season';

const CHUNK = 32;
/** instances per cell for density 0..4 */
const DENSITY_COUNT = [0, 1.1, 2.3, 3.8, 5.6];
/**
 * Outer landscape ring (beyond the map edge, where the terrain continues to the horizon): tree impostors on the terrain
 * shader's outside "noise forests", in the 8 cells of a 3 x 3 grid around the map square (sector -> [column, row]).
 */
const RING_SECTORS: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
const RING_N = RING_SECTORS.length;
/** outer ring placement grid (m): at most one tree per cell, fewer further out */
const RING_GRID = 10;
/** candidate generation works in blocks of RING_BLOCK x RING_BLOCK grid cells: the forest probability is evaluated at
 *  the block corners (it varies over >= ~100 m) and interpolated inside, forest-free blocks are skipped */
const RING_BLOCK = 4;
/** candidate cap per ring sector (at full density) */
const RING_CAP = 7000;
/** floats per ring candidate: x, ground height, z, species, kind random, yaw, colour jitter, density threshold */
const RING_STRIDE = 8;
/** the map's edge chunks continue their forests as full trees this many cells beyond the edge; the ring starts there */
const RING_EDGE_CELLS = 10;
/** merged-mesh conifers: the micro broadleaf double pyramid's upper half (waist r 0.46 at y 0.63, apex 1) stretched
 *  onto the micro conifer pyramid (base r 0.4 at y 0.1, apex 1); its lower half ends up below the ground */
const RING_CON_A = 0.9 / 0.37;
const RING_CON_B = 1 - RING_CON_A;
const RING_CON_R = 0.4 / 0.46;

const _sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** bilinear, repeat-wrapped sample (0..1) of one channel of the 256^2 RGBA world noise texture (textures.ts) */
function sampleNoise(d: Uint8Array, u: number, v: number, ch: number): number {
  const S = 256;
  const x = u * S - 0.5, y = v * S - 0.5;
  const xf = Math.floor(x), yf = Math.floor(y);
  const fx = x - xf, fy = y - yf;
  const i0 = ((xf % S) + S) % S, j0 = ((yf % S) + S) % S;
  const i1 = (i0 + 1) % S, j1 = (j0 + 1) % S;
  const a = d[(j0 * S + i0) * 4 + ch], b = d[(j0 * S + i1) * 4 + ch];
  const c = d[(j1 * S + i0) * 4 + ch], e = d[(j1 * S + i1) * 4 + ch];
  return ((a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy) / 255;
}

/**
 * Can a caster box shadow a shadow pass's receiver volume? The same test as Shadows.receiverSweepBox, reading the
 * box directly: called for every visible tree mesh in every shadow pass, and six float arguments would be boxed on
 * each call in unoptimised code.
 */
function sweepBox(rec: ShadowReceiver, b: THREE.Box3): boolean {
  const x0 = b.min.x, y0 = b.min.y, z0 = b.min.z, x1 = b.max.x, y1 = b.max.y, z1 = b.max.z;
  const dy = rec.dir.y > 0.05 ? rec.dir.y : 0.05;
  let T = (y1 - rec.ground) / dy;
  T = T < 0 ? 0 : T > 6000 ? 6000 : T;
  const pl = rec.pl, nl = rec.nl;
  for (let i = 0; i < 6; i++) {
    const o = i * 4, nx = pl[o], ny = pl[o + 1], nz = pl[o + 2];
    const d = nx * (nx > 0 ? x1 : x0) + ny * (ny > 0 ? y1 : y0) + nz * (nz > 0 ? z1 : z0) + pl[o + 3];
    if (d < 0 && d - T * nl[i] < 0) return false;
  }
  return true;
}

/**
 * Micro impostor merge (far chunks, outer ring sectors): broadleaf and conifer impostors in ONE instanced mesh, drawn
 * with the micro broadleaf double pyramid. A conifer's instance matrix stretches the pyramid's upper half onto the micro
 * conifer pyramid (RING_CON_*: the lower half ends up in the ground) and its instance blue is negative (TREE_MERGED
 * shader: evergreen foliage). Copies instance `i` of src / scol (an impostor matrix + tint) to slot `slot` of dst / dcol.
 */
function mergeImpostor(src: Float32Array, scol: Float32Array, i: number, dst: Float32Array, dcol: Float32Array, slot: number, conifer: boolean): void {
  const o = i * 16, d = slot * 16;
  for (let q = 0; q < 16; q++) dst[d + q] = src[o + q];
  const c = i * 3, e = slot * 3;
  dcol[e] = scol[c];
  dcol[e + 1] = scol[c + 1];
  dcol[e + 2] = scol[c + 2];
  if (!conifer) return;
  const sy = src[o + 5];
  dst[d] *= RING_CON_R; dst[d + 2] *= RING_CON_R; dst[d + 8] *= RING_CON_R; dst[d + 10] *= RING_CON_R;
  dst[d + 5] = sy * RING_CON_A;
  dst[d + 13] += sy * RING_CON_B;
  dcol[e + 2] = -Math.max(scol[c + 2], 1e-4);
}

/**
 * Every tree / impostor / ring mesh. Prototype methods (one function for all meshes, no per-mesh closures):
 *  - frustum test by the tight instance bounds; in shadow passes only if the trees' shadows can reach the part of the
 *    view the cascade shades;
 *  - impostors (imp): skipped in shadow cascades whose texels exceed owner.impostorShadowTexel (count 0 for that pass
 *    only), and shadow-only impostors (chunk still drawn with near models, but past the shadow switch distance) skip
 *    every view pass.
 */
class TreeMesh extends THREE.InstancedMesh {
  owner: TreeRenderer | null = null;
  imp = false;
  shadowOnly = false;
  private savedShadow = -1;
  private savedView = -1;

  override intersectsFrustum(f: THREE.Frustum): boolean {
    const b = this.boundingBox!;
    if (!f.intersectsBox(b)) return false;
    const recv = (f as unknown as { recv?: ShadowReceiver }).recv;
    return !recv || sweepBox(recv, b);
  }

  override onBeforeShadow(_r: THREE.WebGLRenderer, _s: THREE.Object3D, _c: THREE.Camera, shadowCamera: THREE.Camera): void {
    if (!this.imp || !this.owner) return;
    const t = (shadowCamera.userData.texel as number | undefined) ?? 0;
    if (t > this.owner.impostorShadowTexel) {
      this.savedShadow = this.count;
      this.count = 0;
    }
  }

  override onAfterShadow(): void {
    if (this.savedShadow >= 0) {
      this.count = this.savedShadow;
      this.savedShadow = -1;
    }
  }

  override onBeforeRender(): void {
    if (this.shadowOnly) {
      this.savedView = this.count;
      this.count = 0;
    }
  }

  override onAfterRender(): void {
    if (this.savedView >= 0) {
      this.count = this.savedView;
      this.savedView = -1;
    }
  }
}

interface SpeciesDef {
  id: string;
  w: number;
  conifer?: boolean;
  /** preferred elevation band (m): weight fades outside */
  minH?: number;
  maxH?: number;
  /** bonus close to sea level (palms) */
  coastal?: boolean;
  /** bonus on steep slopes (rocks) */
  slope?: boolean;
  scale?: [number, number];
}

const CLIMATE_SPECIES: Record<Climate, SpeciesDef[]> = {
  temperate: [
    { id: 'tree_oak', w: 0.3, maxH: 120 },
    { id: 'tree_maple', w: 0.22, maxH: 110 },
    { id: 'tree_birch', w: 0.14 },
    { id: 'tree_pine', w: 0.14, conifer: true, minH: 25 },
    { id: 'tree_spruce', w: 0.1, conifer: true, minH: 60 },
    { id: 'bush', w: 0.08, scale: [0.8, 1.4] },
    { id: 'rock', w: 0.02, slope: true, scale: [0.7, 1.6] },
  ],
  desert: [
    { id: 'tree_cactus', w: 0.45, scale: [0.8, 1.3] },
    { id: 'bush', w: 0.35, scale: [0.6, 1.1] },
    { id: 'rock', w: 0.15, slope: true, scale: [0.8, 2.0] },
    { id: 'tree_palm', w: 0.05, coastal: true },
  ],
  tropical: [
    { id: 'tree_palm', w: 0.42, coastal: true, maxH: 40 },
    { id: 'tree_oak', w: 0.26 },
    { id: 'bush', w: 0.18, scale: [0.9, 1.6] },
    { id: 'tree_cypress', w: 0.06, conifer: true },
    { id: 'tree_maple', w: 0.08 },
  ],
  alpine: [
    { id: 'tree_spruce', w: 0.45, conifer: true },
    { id: 'tree_pine', w: 0.3, conifer: true },
    { id: 'tree_birch', w: 0.12, maxH: 90 },
    { id: 'rock', w: 0.08, slope: true, scale: [0.8, 1.8] },
    { id: 'bush', w: 0.05 },
  ],
};

interface Kind {
  species: number;
  id: string;
  variant: number;
  geo: THREE.BufferGeometry;
  conifer: boolean;
  color: THREE.Color;
  height: number;
  radius: number;
  /** impostor radius factor: see-through bare crowns get thinner impostors (the dark floor shows between them) */
  impR: number;
}

interface TreeChunk {
  cx: number;
  cz: number;
  near: (TreeMesh | null)[];
  /** impostors: 0 broadleaf, 1 conifer, 2 both as micro impostors (one draw for far chunks; see microMerge) */
  far: (TreeMesh | null)[];
  farTotal: [number, number, number];
  box: THREE.Box3;
  sphere: THREE.Sphere;
  isNear: boolean;
  total: number;
  /** LOD state key last applied (skip work when unchanged; -1 = re-derive) and the one to re-apply after a rebuild */
  stateKey: number;
  lastKey: number;
  micro: boolean;
}

/**
 * Per-chunk LOD state, packed into an integer key (bits): near models / impostors drawn in the view (L_NEAR / L_FAR);
 * they straddle the fade band (dithered material: L_NEAR_FADE / L_FAR_FADE); they cast shadows (L_NEAR_CAST /
 * L_FAR_CAST: impostors can be shadow-only, drawn in the shadow passes but skipped in the view); they straddle the
 * shadow switch distance (per-instance depth cut: L_NEAR_CUT / L_FAR_CUT); micro impostor geometry (L_MICRO); the
 * impostor density (keep, in 1/20 steps) from bit L_KEEP_SHIFT on.
 */
const L_NEAR = 1, L_FAR = 2, L_NEAR_FADE = 4, L_FAR_FADE = 8, L_NEAR_CUT = 16, L_FAR_CUT = 32, L_MICRO = 64;
const L_NEAR_CAST = 128, L_FAR_CAST = 256, L_KEEP_SHIFT = 10;
/** state of a chunk before its first LOD selection: impostors, full density, casting */
const FRESH_KEY = L_FAR | L_FAR_CAST | (20 << L_KEEP_SHIFT);

/** outer ring candidate generation of one sector, in progress (resumable over frames) */
interface RingGen {
  k: number;
  /** next block row (grid z of its first row) and next block in it (-1: its bottom corner row is not computed yet) */
  bz: number;
  bi: number;
  n: number;
  buf: Float32Array;
  /** forest probability at the block corners of the current block row: top (z = bz) / bottom (z = bz + BLOCK) */
  top: Float32Array;
  bot: Float32Array;
}

/** outer ring (re)fill of one sector, in progress: candidates are written straight into the meshes' instance arrays
 *  (uploaded once the sector is complete, so no half-refilled frame is ever drawn) */
interface RingFill {
  k: number;
  /** next candidate */
  i: number;
  /** instances written so far per mesh (0 broadleaf, 1 conifer, 2 merged micro) */
  w: Int32Array;
  /** shuffled slot of each instance per mesh (a prefix of the slots is a uniform random subset: density fade) */
  perm: Int32Array[];
  /** instance bounds per mesh: min x y z, max x y z */
  bounds: Float64Array;
  dens: number;
}

const _box = new THREE.Box3();

// ---- LOD cross-fade shader snippets (near models fade out / impostors fade in over the band)
const FADE_VERT_PARS = /* glsl */ `
uniform vec3 uTreeCam;
uniform vec4 uTreeFade;
varying float vTreeFade;
varying vec2 vTreeNdc;
`;
function fadeVertMain(near: boolean, depth: boolean): string {
  return /* glsl */ `
#ifdef USE_INSTANCING
{
  vec3 _ip = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  float _h = fract(sin(dot(_ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
  float _d = distance(_ip, uTreeCam) + (_h - 0.5) * uTreeFade.z;
  vTreeFade = clamp((_d - uTreeFade.x) / max(uTreeFade.y - uTreeFade.x, 1.0), 0.0, 1.0);
  // the tree's screen position (anchors the dither pattern to the tree)
  vec4 _ic = projectionMatrix * viewMatrix * vec4(_ip, 1.0);
  vTreeNdc = _ic.xy / max(abs(_ic.w), 1e-4);
  ${depth
    ? (near ? 'if (_d >= uTreeFade.w) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);' : 'if (_d < uTreeFade.w) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);')
    : (near ? 'if (vTreeFade >= 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);' : 'if (vTreeFade <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);')}
}
#endif
`;
}
const FADE_FRAG_PARS = /* glsl */ `
varying float vTreeFade;
varying vec2 vTreeNdc;
uniform vec2 uTreeRes;
`;
function fadeFrag(near: boolean): string {
  return /* glsl */ `
#ifndef TREE_A2C
  {
    // interleaved gradient noise in pixels relative to the tree's (pixel-snapped) screen position: stable per tree,
    // moves with it; near and far keep complementary pixel sets
    vec2 _px = gl_FragCoord.xy - floor((vTreeNdc * 0.5 + 0.5) * uTreeRes);
    float _n = fract(52.9829189 * fract(dot(_px, vec2(0.06711056, 0.00583715))));
    ${near ? 'if (_n < vTreeFade) discard;' : 'if (_n >= vTreeFade) discard;'}
  }
#endif
`;
}
/** alpha-to-coverage fade (MSAA): the impostor fades in over the first half of the band, the model out over the second */
function fadeAlpha(near: boolean): string {
  return /* glsl */ `
#ifdef TREE_A2C
  diffuseColor.a = ${near ? 'clamp(2.0 - 2.0 * vTreeFade, 0.0, 1.0)' : 'clamp(2.0 * vTreeFade, 0.0, 1.0)'};
#endif
`;
}

// ---- seasons: snow on the forest above the terrain's snow line (same line + noise as terrainShader), and metric object
// coordinates for the unit-size impostors (so the shared foliage shading - low-foliage dormancy below ~2.5 m, leaf
// noise - treats an impostor like the model it stands for)
const SEASON_VERT_PARS = /* glsl */ `
uniform vec4 uTreeSnow;
uniform sampler2D uTreeNoise;
varying float vTreeSnow;
`;
function seasonVertMain(far: boolean): string {
  return /* glsl */ `
vTreeSnow = 0.0;
#ifdef USE_INSTANCING
{
  vec3 _sp = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  // (the noise moves the line by at most +-0.66 x its amplitude: trees clearly below / above it skip the lookups)
  float _dy = _sp.y + 1.0 - uTreeSnow.x, _band = uTreeSnow.y * 0.66 + 5.0;
  if (uTreeSnow.z > 0.0 && _dy > -_band) {
    if (_dy > _band) vTreeSnow = uTreeSnow.z;
    else {
      float _m2 = textureLod(uTreeNoise, _sp.xz / 520.0, 0.0).g;
      float _m3 = textureLod(uTreeNoise, _sp.xz / 57.0, 3.0).b;
      float _sl = uTreeSnow.x + (_m2 - 0.5) * uTreeSnow.y + (_m3 - 0.5) * uTreeSnow.y * 0.31;
      vTreeSnow = uTreeSnow.z * smoothstep(_sl - 5.0, _sl + 5.0, _sp.y + 1.0);
    }
  }
  ${far ? 'vObjPos *= vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));' : ''}
}
#endif
#if defined(TREE_MERGED) && defined(USE_INSTANCING_COLOR)
  // merged micro impostor mesh (broadleaves and conifers share one draw): conifers carry a negative instance blue ->
  // evergreen foliage pattern (4) instead of the impostor's variant-seasonal deciduous one
  if (instanceColor.b < 0.0) {
    vSurf.y = 4.0;
    vColor.b = -vColor.b;
    // object normals of the stretched shape (RING_CON_*), so snow / leaf shading see the conifer's steep flanks
    vObjNormal = normalize(vObjNormal / vec3(${RING_CON_R.toFixed(4)}, ${RING_CON_A.toFixed(4)}, ${RING_CON_R.toFixed(4)}));
  }
#endif
`;
}
const SEASON_FRAG_PARS = /* glsl */ `
varying float vTreeSnow;
`;
/** snow dusting on the up-facing tops of needle tiers / twigs / rocks (not on bark), in clumps, after the surface
 *  shading: the dark green stays visible between and under the snow */
const SEASON_FRAG = /* glsl */ `
if (vTreeSnow > 0.001) {
  float _up = smoothstep(0.3, 0.85, normalize(vObjNormal).y);
  float _k = abs(vSurf.x - 8.0) < 0.5 ? (vSurf.y > 3.5 ? 0.62 : 0.3) : (vSurf.x < 0.5 ? 0.85 : 0.0);
  float _n = smoothstep(0.3, 0.7, bnoise(vObjPos.xz * 1.1 + vObjPos.y * 0.9));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.64, 0.68, 0.74), vTreeSnow * _up * _k * (0.4 + 0.6 * _n));
}
`;

export class TreeRenderer {
  readonly group = new THREE.Group();
  private state: CityState;
  private terrain: TerrainRenderer;
  private kinds: Kind[] = [];
  private kindsBySpecies: number[][] = [];
  private autumnKinds: number[][] = [];
  private autumn = 0;
  /** seasonal species (nat_season.ts: oak / maple / birch): model variant -> kind index, else null */
  private seasonKinds: (Map<number, number> | null)[] = [];
  /** current autumn / bare / blossom fractions (seasonMix of month + climate) */
  private season: SeasonMix = { autumn: 0, bare: 0, blossom: 0 };
  private maxVariants = 3;
  private species: SpeciesDef[];
  /** species weights scratch (pickSpecies) */
  private weights: number[] = [];
  private chunks: TreeChunk[] = [];
  /** chunk boxes (min x y z, max x y z per chunk) for the per-frame LOD selection */
  private chunkBox = new Float64Array(0);
  private perSide: number;
  private dirty = new Set<number>();
  private noise: Noise2D;
  private seed: number;
  private material: THREE.MeshStandardMaterial;
  /** impostors (per-instance colour) get their own material and depth materials: sharing one material object between
   *  meshes with and without instanceColor makes three re-derive the program on every switch between them */
  private materialFar: THREE.MeshStandardMaterial;
  /** broadleaves + conifers in one micro impostor mesh (TREE_MERGED: conifers flagged evergreen; see microMerge):
   *  far chunks and the outer ring's sectors */
  private materialMerged: THREE.MeshStandardMaterial;
  private depthNearPlain = new THREE.MeshDepthMaterial();
  private depthFarPlain = new THREE.MeshDepthMaterial();
  /** depth materials of chunks drawn with an alpha-to-coverage fade material: three forces alphaTest 0.5 on the depth
   *  material of such objects, so they get their own instances (a shared one would flip alphaTest -> program per
   *  object) */
  private depthNearPlainA = new THREE.MeshDepthMaterial();
  private depthFarPlainA = new THREE.MeshDepthMaterial();
  private depthNearA: THREE.MeshDepthMaterial;
  private depthFarA: THREE.MeshDepthMaterial;
  private lodDistance = 1300;
  private density = 1;
  private castShadows = true;
  private matNearFade: THREE.MeshStandardMaterial;
  private matFarFade: THREE.MeshStandardMaterial;
  private depthNear: THREE.MeshDepthMaterial;
  private depthFar: THREE.MeshDepthMaterial;
  private fadeU = { uTreeCam: { value: new THREE.Vector3() }, uTreeFade: { value: new THREE.Vector4(600, 800, 60, 700) }, uTreeRes: { value: new THREE.Vector2(1920, 1080) } };
  /** snow on the forest: x terrain snow line (m), y its noise amplitude, z amount (0 = off) */
  private snowU = { uTreeSnow: { value: new THREE.Vector4(9999, 8, 0, 0) }, uTreeNoise: { value: getNoiseTexture() as THREE.Texture } };
  /** width of the near/impostor cross-fade band as a fraction of lodDistance (each side): alpha-to-coverage (MSAA)
   *  blends smoothly, the screen-door dither (no MSAA) is kept narrow */
  fadeBand = 0.1;
  fadeBandDither = 0.05;
  /** the view renders with MSAA: fade by alpha-to-coverage */
  private a2c = false;
  /** hidden meshes that compile every fade / cut / plain program (main + shadow) with the first frames */
  private warm: THREE.InstancedMesh[] = [];
  private warmMain = false;
  private warmShadow = false;
  private warmFrames = 0;
  /** near models cast shadows only up to this fraction of lodDistance, impostor shadows beyond (a tree there is
   *  ~10 px tall at 1080p and its shadow a soft blob either way); 1 = switch shadows together with the models */
  shadowLodFrac = 0.6;
  /** impostors cast shadows only into cascades whose texel is at most this size (m); the map-clamped cascades stay
   *  under ~3 m texels even at full zoom-out, where impostor shadows still give forests their texture */
  impostorShadowTexel = 6;
  /** far chunks switch to micro impostors when a typical tree projects below this radius (px; ~1 px keeps the
   *  forest texture of the full impostors at 1080p) */
  microPixels = 1.1;
  /** drawing-buffer height (px) and vertical fov (deg) of the view, for the projected-size LOD (set by WorldView) */
  viewHeight = 1080;
  viewFov = 38;
  // scratch buffers
  private scratch: Float32Array[] = [];
  private scratchCount: number[] = [];
  private farScratch: Float32Array[] = [new Float32Array(16 * 4096), new Float32Array(16 * 4096)];
  private farColor: Float32Array[] = [new Float32Array(3 * 4096), new Float32Array(3 * 4096)];
  private farCount = [0, 0];
  /** merged micro impostors of the chunk being built (mergeImpostor) and their shuffled slots */
  private mergedScratch = new Float32Array(16 * 4096);
  private mergedColor = new Float32Array(3 * 4096);
  private mergedPerm = new Int32Array(4096);
  /** the chunk LOD pass is skipped while the camera / LOD inputs stay put (see update) */
  private lodInputs = new Float64Array(9).fill(NaN);
  private lodForce = true;
  /** total instances currently placed (stats) */
  totalInstances = 0;

  // ---- outer ring (see the header and ringStep)
  /** meshes per sector: 3k broadleaf impostors, 3k + 1 conifer impostors (both near: within lodDistance), 3k + 2 all
   *  of the sector's trees as micro impostors (beyond lodDistance) */
  private ring: (TreeMesh | null)[] = new Array(RING_N * 3).fill(null);
  /** candidates per sector (RING_STRIDE floats each) and their counts */
  private ringCand: (Float32Array | null)[] = new Array(RING_N).fill(null);
  private ringCandN = new Int32Array(RING_N);
  /** sectors whose candidates must be (re)generated / whose meshes must be (re)filled (bit k = sector k) */
  private ringStale = (1 << RING_N) - 1;
  private ringRefill = 0;
  private ringGen: RingGen | null = null;
  private ringFillState: RingFill | null = null;
  /** sector filled at least once since the last reset (its meshes may be drawn) */
  private ringReady = new Uint8Array(RING_N);
  /** sector currently drawn with the near (regular impostor) pair */
  private ringNearSel = new Uint8Array(RING_N);
  /** instance bounds of each sector (min x y z, max x y z) */
  private ringBox = new Float64Array(RING_N * 6);
  /** map-border corner heights the ring heights were generated with (west, east, north, south edges; N + 1 each):
   *  only a terrain edit on the border moves the outer landscape the ring stands on */
  private ringEdgeH = new Float32Array(0);
  /** frames the ring waited for chunk rebuilds (it then gets a step anyway) */
  private ringWait = 0;
  /** width (m) of the landscape ring beyond the map edge that gets tree impostors (0 = none, also no edge band) */
  ringWidth = 2600;
  /** main-thread time (ms) per frame the outer ring's generation / refill may take */
  ringBudgetMs = 1;
  /** camera heights above the ground (m) between which the ring's far sectors fade in: low cameras look through the
   *  city / edge band at the horizon, where they are hidden or a few specks in the haze (sectors within lodDistance,
   *  i.e. a camera near the map edge, stay at any height) */
  ringFadeHeight: [number, number] = [110, 240];
  /** outer ring instances currently placed (stats) */
  ringInstances = 0;
  /** completed candidate generations of ring sectors (stats / tests) */
  ringGenerations = 0;

  constructor(state: CityState, terrain: TerrainRenderer, opts: { lodDistance: number; density: number; castShadows: boolean; maxVariants?: number; msaa?: boolean }) {
    this.state = state;
    this.terrain = terrain;
    this.lodDistance = opts.lodDistance;
    this.density = opts.density;
    this.castShadows = opts.castShadows;
    this.seed = state.config.seed | 0;
    this.noise = new Noise2D(state.config.seed + 4242);
    this.maxVariants = opts.maxVariants ?? 3;
    this.a2c = opts.msaa ?? false;
    // clones of the shared uber material that cast shadows from both faces (thin palm fronds / leaf quads), plus the
    // season snippets (snow, metric impostor coordinates)
    this.material = this.makeTreeMaterial(false);
    this.materialFar = this.makeTreeMaterial(true);
    this.materialMerged = this.makeTreeMaterial(true, true);
    this.matNearFade = this.makeFadeMaterial(true);
    this.matFarFade = this.makeFadeMaterial(false);
    this.depthNear = this.makeDepthMaterial(true);
    this.depthFar = this.makeDepthMaterial(false);
    this.depthNearA = this.makeDepthMaterial(true);
    this.depthFarA = this.makeDepthMaterial(false);
    this.group.name = 'trees';
    // the group never moves: without this, its per-frame updateMatrix() forces a world-matrix recompute of every
    // chunk mesh (~1300 objects) on each render
    this.group.matrixAutoUpdate = false;
    this.species = CLIMATE_SPECIES[state.config.climate] ?? CLIMATE_SPECIES.temperate;
    this.buildKinds();
    this.perSide = Math.ceil(state.size / CHUNK);
    this.chunkBox = new Float64Array(this.perSide * this.perSide * 6);
    for (let cz = 0; cz < this.perSide; cz++)
      for (let cx = 0; cx < this.perSide; cx++) {
        const x0 = cx * CHUNK * CELL_SIZE, z0 = cz * CHUNK * CELL_SIZE;
        // edge chunks reach RING_EDGE_CELLS beyond the map (their forests continue past the edge)
        const e = RING_EDGE_CELLS * CELL_SIZE, last = this.perSide - 1;
        const box = new THREE.Box3(new THREE.Vector3(x0 - (cx === 0 ? e : 0), -10, z0 - (cz === 0 ? e : 0)), new THREE.Vector3(x0 + CHUNK * CELL_SIZE + (cx === last ? e : 0), 60, z0 + CHUNK * CELL_SIZE + (cz === last ? e : 0)));
        this.chunks.push({ cx, cz, near: this.kinds.map(() => null), far: [null, null, null], farTotal: [0, 0, 0], box, sphere: new THREE.Sphere(), isNear: false, total: 0, stateKey: -1, lastKey: FRESH_KEY, micro: false });
        this.storeChunkBox(this.chunks.length - 1);
      }
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
    this.snapshotRingEdge();
    this.setMonth(state.month);
    // the outer ring is generated and filled with the load (~10-80 ms, behind the loading screen), so no interactive
    // frame pays for it; later refills (season, density) and border regenerations are time-sliced (ringStep)
    this.flushRing();
    this.makeWarmup();
  }

  /** one hidden, degenerate instance per material pairing (near / far x plain / fade, each with its depth variant,
   *  plus the outer ring's): drawn by the first frames so no program compiles when a chunk first enters the fade
   *  band or shadow cut */
  private makeWarmup(): void {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const imp = getImpostorGeometries();
    const near = this.kinds[0]?.geo;
    const pairs: [THREE.BufferGeometry | undefined, THREE.Material, THREE.Material | null, boolean][] = [];
    for (const isNear of [true, false]) for (const fade of [false, true]) for (const cut of [false, true]) {
      pairs.push([isNear ? near : imp.broad, isNear ? (fade ? this.matNearFade : this.material) : (fade ? this.matFarFade : this.materialFar), this.depthFor(isNear, fade, cut), !isNear]);
    }
    pairs.push([getMicroImpostorGeometries().broad, this.materialMerged, this.depthFor(false, false, false), true]);
    for (const [geo, mat, depth, color] of pairs) {
      if (!geo) continue;
      const m = new THREE.InstancedMesh(geo, mat, 1);
      m.setMatrixAt(0, zero);
      if (color) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
      m.frustumCulled = false;
      m.castShadow = this.castShadows && depth !== null;
      m.receiveShadow = true;
      if (depth) m.customDepthMaterial = depth;
      m.name = 'trees-warmup';
      m.onAfterRender = () => { this.warmMain = true; };
      m.onAfterShadow = () => { this.warmShadow = true; };
      this.warm.push(m);
      this.group.add(m);
    }
  }

  /** depth material of a chunk mesh: near / far, drawn with the fade material, straddling the shadow cut */
  private depthFor(near: boolean, fade: boolean, cut: boolean): THREE.MeshDepthMaterial {
    const a = fade && this.a2c;
    if (near) return cut ? (a ? this.depthNearA : this.depthNear) : (a ? this.depthNearPlainA : this.depthNearPlain);
    return cut ? (a ? this.depthFarA : this.depthFar) : (a ? this.depthFarPlainA : this.depthFarPlain);
  }

  private dropWarmup(): void {
    for (const m of this.warm) { this.group.remove(m); m.dispose(); }
    this.warm.length = 0;
  }

  /** size (px) of the target the view renders into (anchors the dither pattern) */
  setRenderSize(w: number, h: number): void {
    this.fadeU.uTreeRes.value.set(w, h);
  }

  private injectFade(shader: THREE.WebGLProgramParametersWithUniforms, near: boolean, depth: boolean) {
    shader.uniforms.uTreeCam = this.fadeU.uTreeCam;
    shader.uniforms.uTreeFade = this.fadeU.uTreeFade;
    shader.uniforms.uTreeRes = this.fadeU.uTreeRes;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + FADE_VERT_PARS).replace(/}\s*$/, fadeVertMain(near, depth) + '\n}');
    if (!depth) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FADE_FRAG_PARS)
        .replace('void main() {', 'void main() {\n' + fadeFrag(near))
        .replace('#include <alphatest_fragment>', fadeAlpha(near) + '\n#include <alphatest_fragment>');
    }
  }

  /** snow + (impostors) metric object coordinates; see SEASON_* */
  private injectSeason(shader: THREE.WebGLProgramParametersWithUniforms, far: boolean) {
    shader.uniforms.uTreeSnow = this.snowU.uTreeSnow;
    shader.uniforms.uTreeNoise = this.snowU.uTreeNoise;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + SEASON_VERT_PARS).replace(/}\s*$/, seasonVertMain(far) + '\n}');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SEASON_FRAG_PARS)
      .replace('#include <normal_fragment_begin>', SEASON_FRAG + '\n#include <normal_fragment_begin>');
  }

  /** plain (no fade) tree material: near models or impostors (merged: broadleaf + conifer micro impostor meshes) */
  private makeTreeMaterial(far: boolean, merged = false): THREE.MeshStandardMaterial {
    const m = patchSurfaceMaterial(getBuildingMaterial().clone(), 'building-uber-v1');
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      base.call(m, shader, renderer);
      this.injectSeason(shader, far);
    };
    m.customProgramCacheKey = () => 'building-uber-v1|tree-' + (far ? 'far' : 'near') + (merged ? '-merged' : '') + '-v1';
    if (merged) m.defines = { ...(m.defines ?? {}), TREE_MERGED: '' };
    m.shadowSide = THREE.DoubleSide;
    return m;
  }

  private makeFadeMaterial(near: boolean): THREE.MeshStandardMaterial {
    const m = patchSurfaceMaterial(getBuildingMaterial().clone(), 'building-uber-v1');
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      base.call(m, shader, renderer);
      this.injectFade(shader, near, false);
      this.injectSeason(shader, !near);
    };
    m.customProgramCacheKey = () => 'building-uber-v1|tree-fade-' + (near ? 'near' : 'far') + '-v3';
    m.shadowSide = THREE.DoubleSide;
    this.applyFadeMode(m);
    return m;
  }

  /** alpha-to-coverage (MSAA) or screen-door dither variant of a fade material */
  private applyFadeMode(m: THREE.MeshStandardMaterial): void {
    m.defines = { ...(m.defines ?? {}) };
    if (this.a2c) m.defines.TREE_A2C = '';
    else delete m.defines.TREE_A2C;
    m.alphaToCoverage = this.a2c;
    m.needsUpdate = true;
  }

  private makeDepthMaterial(near: boolean): THREE.MeshDepthMaterial {
    const m = new THREE.MeshDepthMaterial();
    m.onBeforeCompile = (shader) => this.injectFade(shader, near, true);
    m.customProgramCacheKey = () => 'tree-depth-' + (near ? 'near' : 'far') + '-v2';
    return m;
  }

  private buildKinds() {
    this.kinds = [];
    this.kindsBySpecies = [];
    this.autumnKinds = [];
    this.seasonKinds = [];
    this.weights = new Array(this.species.length).fill(0);
    this.species.forEach((sp, si) => {
      const ss = SEASONAL_TREES[sp.id];
      if (ss) {
        // deciduous species: quality-limited green variants + every autumn / bare / blossom variant (nat_season.ts)
        const map = new Map<number, number>();
        const add = (v: number) => {
          if (map.has(v)) return;
          const geo = getNatureGeometry(sp.id, v);
          const st = natureStats(geo);
          map.set(v, this.kinds.length);
          this.kinds.push({ species: si, id: sp.id, variant: v, geo, conifer: !!sp.conifer, color: st.color, height: st.height, radius: st.radius, impR: 1 - 0.3 * st.open });
        };
        const green = ss.green.slice(0, Math.max(1, this.maxVariants));
        for (const v of green) add(v);
        for (const v of [...ss.autumn, ...ss.bare, ...ss.blossom]) add(v);
        this.kindsBySpecies.push(green.map((v) => map.get(v)!));
        this.autumnKinds.push([]);
        this.seasonKinds.push(map);
        return;
      }
      this.seasonKinds.push(null);
      const nv = Math.min(4, MANIFEST_BY_ID[sp.id]?.variants ?? 1);
      const list: number[] = [];
      const autumn: number[] = [];
      for (let v = 0; v < nv; v++) {
        const geo = getNatureGeometry(sp.id, v);
        const st = natureStats(geo);
        // autumn-colored variants (foliage more red than green) are only used in autumn
        const isAutumn = st.color.r > st.color.g * 0.95 && sp.id !== 'rock' && sp.id !== 'tree_cactus';
        if (isAutumn ? autumn.length >= 1 : list.length >= this.maxVariants) continue;
        (isAutumn ? autumn : list).push(this.kinds.length);
        this.kinds.push({ species: si, id: sp.id, variant: v, geo, conifer: !!sp.conifer, color: st.color, height: st.height, radius: st.radius, impR: 1 - 0.3 * st.open });
      }
      if (!list.length && autumn.length) list.push(autumn[0]);
      this.kindsBySpecies.push(list);
      this.autumnKinds.push(autumn);
    });
    this.scratch = this.kinds.map(() => new Float32Array(16 * 1024));
    this.scratchCount = this.kinds.map(() => 0);
  }

  setQuality(opts: { lodDistance: number; density: number; castShadows: boolean; maxVariants?: number; msaa?: boolean }) {
    if (opts.msaa !== undefined && opts.msaa !== this.a2c) {
      this.a2c = opts.msaa;
      this.applyFadeMode(this.matNearFade);
      this.applyFadeMode(this.matFarFade);
      for (const c of this.chunks) c.stateKey = -1;
      // the new variants compile with the next frames, not when a chunk next enters the band
      this.dropWarmup();
      this.makeWarmup();
      this.warmMain = this.warmShadow = false;
      this.warmFrames = 0;
    }
    if (opts.maxVariants !== undefined && opts.maxVariants !== this.maxVariants) {
      this.maxVariants = opts.maxVariants;
      for (const c of this.chunks) this.disposeChunk(c);
      this.buildKinds();
      for (const c of this.chunks) {
        c.near = this.kinds.map(() => null);
        c.far = [null, null, null];
        c.total = 0;
      }
      this.totalInstances = 0;
      this.markAll();
    }
    const densityChanged = opts.density !== this.density;
    this.lodForce = true;
    this.lodDistance = opts.lodDistance;
    this.density = opts.density;
    this.castShadows = opts.castShadows;
    // per-chunk castShadow / shadow-only flags are re-derived by the next update()
    for (const c of this.chunks) {
      c.stateKey = -1;
      for (const m of c.near) if (m) m.castShadow = opts.castShadows;
      for (const m of c.far) if (m) m.castShadow = opts.castShadows;
    }
    // (the ring's candidates are density independent: a new density only refills it)
    if (densityChanged) this.markAll();
  }

  /** rebuild every chunk and refill the outer ring (season, density, tree kinds) */
  markAll() {
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
    this.ringRefill = (1 << RING_N) - 1;
    // a refill in progress used the old kinds / density: start it over
    this.ringFillState = null;
  }

  /** cells changed (trees / network / zones / buildings) */
  onCellsChanged(r: CellRect) {
    const x0 = Math.max(0, r.x0), z0 = Math.max(0, r.z0);
    const x1 = Math.min(this.state.size - 1, r.x1), z1 = Math.min(this.state.size - 1, r.z1);
    const N = this.state.size;
    if (x0 <= 1 || z0 <= 1 || x1 >= N - 2 || z1 >= N - 2) this.ringEdgeChanged(x0, z0, x1, z1);
    for (let cz = Math.floor(z0 / CHUNK); cz <= Math.floor(z1 / CHUNK); cz++)
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++)
        if (cx >= 0 && cz >= 0 && cx < this.perSide && cz < this.perSide) this.dirty.add(cz * this.perSide + cx);
  }

  reset(state: CityState) {
    this.state = state;
    this.seed = state.config.seed | 0;
    this.noise = new Noise2D(state.config.seed + 4242);
    this.season = seasonMix(state.month, state.config.climate);
    this.autumn = this.season.autumn;
    const sp = CLIMATE_SPECIES[state.config.climate] ?? CLIMATE_SPECIES.temperate;
    if (sp !== this.species) {
      this.species = sp;
      for (const c of this.chunks) this.disposeChunk(c);
      this.buildKinds();
      for (const c of this.chunks) {
        c.near = this.kinds.map(() => null);
        c.far = [null, null, null];
      }
    }
    // a new map: new ring candidates, generated right away (a reset is a load)
    this.ringStale = (1 << RING_N) - 1;
    this.ringGen = null;
    this.ringReady.fill(0);
    this.snapshotRingEdge();
    this.markAll();
    this.flushRing();
  }

  private pickKind(x: number, z: number, h: number, slope: number, r: number, weights: number[]): number {
    return this.kindOf(this.pickSpecies(x, z, h, slope, r, weights), x, z);
  }

  /** species index for a tree in cell (x, z) at height h (clustered patches, elevation / coast / slope preferences) */
  private pickSpecies(x: number, z: number, h: number, slope: number, r: number, weights: number[]): number {
    let total = 0;
    const sp = this.species;
    for (let s = 0; s < sp.length; s++) {
      const d = sp[s];
      // species patches (clustering)
      const n = this.noise.noise(x / 22 + s * 31.7, z / 22 - s * 17.3) * 0.5 + 0.5;
      let w = d.w * (0.25 + 1.6 * n * n);
      if (d.minH !== undefined) w *= h < d.minH ? Math.max(0.08, h / d.minH) : 1 + Math.min(1.5, (h - d.minH) / 60);
      if (d.maxH !== undefined && h > d.maxH) w *= Math.max(0.05, 1 - (h - d.maxH) / 50);
      if (d.coastal) w *= h < 8 ? 2.5 : h < 20 ? 1 : 0.3;
      if (d.slope) w *= slope > 4 ? 3 : 0.4;
      weights[s] = w;
      total += w;
    }
    let t = r * total;
    let s = 0;
    for (; s < sp.length - 1; s++) {
      t -= weights[s];
      if (t <= 0) break;
    }
    return s;
  }

  /** kind (model variant) of species s in cell (x, z) for the current season */
  private kindOf(s: number, x: number, z: number): number {
    const list = this.kindsBySpecies[s];
    const gi = Math.floor(hash2(x * 7 + 3, z * 13 + 1, this.seed + 91) * list.length) % list.length;
    const sk = this.seasonKinds[s];
    if (sk) {
      // deciduous: autumn colours / bare branches / blossom for the month's fraction of trees (stable per cell)
      const id = this.species[s].id;
      const v = seasonalVariant(id, SEASONAL_TREES[id].green[gi], hash2(x * 3 - 7, z * 5 + 2, this.seed + 97), this.season);
      return sk.get(v) ?? list[gi];
    }
    const au = this.autumnKinds[s];
    if (au.length && this.autumn > 0 && hash2(x * 3 - 7, z * 5 + 2, this.seed + 97) < this.autumn) return au[0];
    return list[gi];
  }


  /**
   * season: month 0..11 -> fractions of deciduous trees showing autumn colours (Sep 0.3 / Oct 0.8 / Nov 0.55), bare
   * branches (Dec-Feb 0.93) and blossom (Apr 0.15); temperate / alpine only (nat_season.seasonMix)
   */
  setMonth(month: number) {
    const m = seasonMix(month, this.state.config.climate);
    const o = this.season;
    if (m.autumn !== o.autumn || m.bare !== o.bare || m.blossom !== o.blossom) {
      this.season = m;
      this.autumn = m.autumn;
      this.markAll();
    }
  }

  private ensureScratch(k: number, n: number) {
    if (this.scratch[k].length < n * 16) {
      const a = new Float32Array(Math.ceil(n * 1.5) * 16);
      a.set(this.scratch[k]);
      this.scratch[k] = a;
    }
  }
  private ensureFar(c: number, n: number) {
    if (this.farScratch[c].length < n * 16) {
      const a = new Float32Array(Math.ceil(n * 1.5) * 16);
      a.set(this.farScratch[c]);
      this.farScratch[c] = a;
      const b = new Float32Array(Math.ceil(n * 1.5) * 3);
      b.set(this.farColor[c]);
      this.farColor[c] = b;
    }
  }

  /** placed-tree height range of the chunk being built */
  private bMinY = Infinity;
  private bMaxY = -Infinity;

  /** place `count` trees of cell (x, z) (map or virtual edge cell) into the chunk being built */
  private placeCell(x: number, z: number, count: number, dens: number, h: number, slope: number, weights: number[]) {
    const seed = this.seed;
    // stratified jitter on a 3x3 grid, slot order permuted per cell
    const rot = Math.floor(hash2(x, z, seed + 17) * 9);
    for (let t = 0; t < count; t++) {
      const slot = (t * 4 + rot) % 9;
      const sx = slot % 3, sz = Math.floor(slot / 3);
      const jx = hash2(x * 9 + t, z, seed + 23), jz = hash2(x, z * 9 + t, seed + 29);
      const px = (x + (sx + 0.15 + 0.7 * jx) / 3) * CELL_SIZE;
      const pz = (z + (sz + 0.15 + 0.7 * jz) / 3) * CELL_SIZE;
      const k = this.pickKind(x, z, h, slope, hash2(x * 5 + t, z * 3 - t, seed + 31), weights);
      const kind = this.kinds[k];
      const sp = this.species[kind.species];
      const [s0, s1] = sp.scale ?? [0.72, 1.18];
      const s = (s0 + (s1 - s0) * hash2(x + t * 3, z - t, seed + 37)) * (dens >= 4 ? 1.05 : 1);
      const a = hash2(x - t, z + t * 5, seed + 41) * Math.PI * 2;
      // sink into slopes so rocks / bushes / trunks never float on the downhill side
      const footR = sp.id === 'rock' || sp.id === 'bush' ? kind.radius * s * 0.8 : 0.5;
      const y = this.terrain.worldHeight(px, pz) - 0.12 - Math.min(1.2, (footR * slope) / CELL_SIZE);
      const c = Math.cos(a), sn = Math.sin(a);
      // near
      const cnt = this.scratchCount[k];
      this.ensureScratch(k, cnt + 1);
      const e = this.scratch[k];
      const o = cnt * 16;
      e[o] = c * s; e[o + 1] = 0; e[o + 2] = -sn * s; e[o + 3] = 0;
      e[o + 4] = 0; e[o + 5] = s; e[o + 6] = 0; e[o + 7] = 0;
      e[o + 8] = sn * s; e[o + 9] = 0; e[o + 10] = c * s; e[o + 11] = 0;
      e[o + 12] = px; e[o + 13] = y; e[o + 14] = pz; e[o + 15] = 1;
      this.scratchCount[k] = cnt + 1;
      // far impostor
      const fc = kind.conifer ? 1 : 0;
      const fn = this.farCount[fc];
      this.ensureFar(fc, fn + 1);
      const f = this.farScratch[fc];
      const fo = fn * 16;
      const sxz = (kind.radius / 0.42) * s * 0.92 * kind.impR, sy = kind.height * s;
      f[fo] = c * sxz; f[fo + 1] = 0; f[fo + 2] = -sn * sxz; f[fo + 3] = 0;
      f[fo + 4] = 0; f[fo + 5] = sy; f[fo + 6] = 0; f[fo + 7] = 0;
      f[fo + 8] = sn * sxz; f[fo + 9] = 0; f[fo + 10] = c * sxz; f[fo + 11] = 0;
      f[fo + 12] = px; f[fo + 13] = y; f[fo + 14] = pz; f[fo + 15] = 1;
      const cv = 0.9 + 0.2 * hash2(x + t, z * 2 + t, seed + 43);
      const col = this.farColor[fc];
      col[fn * 3] = kind.color.r * cv;
      col[fn * 3 + 1] = kind.color.g * cv;
      col[fn * 3 + 2] = kind.color.b * cv;
      this.farCount[fc] = fn + 1;
      if (y < this.bMinY) this.bMinY = y;
      if (y + kind.height * s > this.bMaxY) this.bMaxY = y + kind.height * s;
    }
  }

  private buildChunk(ci: number) {
    const ch = this.chunks[ci];
    const st = this.state, N = st.size;
    const nk = this.kinds.length;
    for (let k = 0; k < nk; k++) this.scratchCount[k] = 0;
    this.farCount[0] = this.farCount[1] = 0;
    const weights = this.weights;
    this.bMinY = Infinity;
    this.bMaxY = -Infinity;
    const x0 = ch.cx * CHUNK, z0 = ch.cz * CHUNK;
    const seed = this.seed;
    for (let z = z0; z < Math.min(N, z0 + CHUNK); z++) {
      for (let x = x0; x < Math.min(N, x0 + CHUNK); x++) {
        const i = z * N + x;
        const dens = st.trees[i];
        if (!dens || TerrainRenderer.cellBlocked(st, i)) continue;
        const count = Math.min(9, Math.floor(DENSITY_COUNT[dens] * this.density + hash2(x, z, seed + 5)));
        if (count > 0) this.placeCell(x, z, count, dens, st.cellHeight(x, z), st.cellSlope(x, z), weights);
      }
    }
    // edge chunks: the map's edge forests continue as full trees over a band of virtual cells beyond the edge (the same
    // forest mask the terrain shader paints there), where the outer ring's impostors take over
    const B = RING_EDGE_CELLS;
    if (this.ringWidth > 0 && (ch.cx === 0 || ch.cz === 0 || ch.cx === this.perSide - 1 || ch.cz === this.perSide - 1)) {
      const noise = getNoiseTexture().image.data as Uint8Array;
      const W = N * CELL_SIZE;
      const xs = ch.cx === 0 ? -B : x0, xe = ch.cx === this.perSide - 1 ? N + B : Math.min(N, x0 + CHUNK);
      const zs = ch.cz === 0 ? -B : z0, ze = ch.cz === this.perSide - 1 ? N + B : Math.min(N, z0 + CHUNK);
      for (let z = zs; z < ze; z++) {
        for (let x = xs; x < xe; x++) {
          if (x >= 0 && z >= 0 && x < N && z < N) continue;
          const px = (x + 0.5) * CELL_SIZE, pz = (z + 0.5) * CELL_SIZE;
          const dx = px < 0 ? -px : px > W ? px - W : 0, dz = pz < 0 ? -pz : pz > W ? pz - W : 0;
          const outside = _sstep(0, 0.03, Math.max(dx, dz) / W);
          let trees = outside < 1 ? this.edgeTrees(px, pz) * (1 - outside) : 0;
          if (outside > 0) trees += outside * 0.65 * _sstep(0.6, 0.74, sampleNoise(noise, px / 3100, pz / 3100, 1) * 0.6 + sampleNoise(noise, px / 520, pz / 520, 0) * 0.5);
          const dens = Math.round(Math.min(1, trees) * 4);
          if (!dens) continue;
          const count = Math.min(9, Math.floor(DENSITY_COUNT[dens] * this.density + hash2(x, z, seed + 5)));
          if (count <= 0) continue;
          const h = this.terrain.worldHeight(px, pz);
          if (h < 1.6) continue;
          const hx = this.terrain.worldHeight(px + CELL_SIZE, pz), hz = this.terrain.worldHeight(px, pz + CELL_SIZE);
          this.placeCell(x, z, count, dens, h, Math.max(Math.abs(hx - h), Math.abs(hz - h)), weights);
        }
      }
    }
    let minY = this.bMinY, maxY = this.bMaxY;
    // shuffle far instances so a prefix is a uniform random subset (density fade)
    for (let fc = 0; fc < 2; fc++) {
      const n = this.farCount[fc], f = this.farScratch[fc], col = this.farColor[fc];
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(hash2(i, ci, seed + 53 + fc) * (i + 1));
        if (j === i) continue;
        for (let q = 0; q < 16; q++) {
          const tmp = f[i * 16 + q];
          f[i * 16 + q] = f[j * 16 + q];
          f[j * 16 + q] = tmp;
        }
        for (let q = 0; q < 3; q++) {
          const tmp = col[i * 3 + q];
          col[i * 3 + q] = col[j * 3 + q];
          col[j * 3 + q] = tmp;
        }
      }
    }
    // bounds
    if (minY === Infinity) {
      minY = 0;
      maxY = 1;
    }
    ch.box.min.y = minY - 1;
    ch.box.max.y = maxY + 1;
    ch.box.getBoundingSphere(ch.sphere);
    this.storeChunkBox(ci);
    let total = 0;
    for (let k = 0; k < nk; k++) {
      const n = this.scratchCount[k];
      total += n;
      ch.near[k] = this.fill(ch.near[k], this.kinds[k].geo, this.scratch[k], null, n, true);
    }
    const imp = getImpostorGeometries();
    ch.far[0] = this.fill(ch.far[0], imp.broad, this.farScratch[0], this.farColor[0], this.farCount[0], false);
    ch.far[1] = this.fill(ch.far[1], imp.conifer, this.farScratch[1], this.farColor[1], this.farCount[1], false);
    ch.farTotal[0] = this.farCount[0];
    ch.farTotal[1] = this.farCount[1];
    // far (micro) state: both classes in one mesh (one draw per far chunk instead of two), its own shuffle
    const nb = this.farCount[0], nm = nb + this.farCount[1];
    if (this.mergedPerm.length < nm) {
      const cap = Math.ceil(nm * 1.5);
      this.mergedScratch = new Float32Array(cap * 16);
      this.mergedColor = new Float32Array(cap * 3);
      this.mergedPerm = new Int32Array(cap);
    }
    const perm = this.mergedPerm;
    for (let i = 0; i < nm; i++) perm[i] = i;
    for (let i = nm - 1; i > 0; i--) {
      const j = Math.floor(hash2(i, ci, seed + 59) * (i + 1));
      const t = perm[i];
      perm[i] = perm[j];
      perm[j] = t;
    }
    for (let i = 0; i < nm; i++) {
      const conifer = i >= nb;
      const fc = conifer ? 1 : 0;
      mergeImpostor(this.farScratch[fc], this.farColor[fc], conifer ? i - nb : i, this.mergedScratch, this.mergedColor, perm[i], conifer);
    }
    ch.far[2] = this.fill(ch.far[2], getMicroImpostorGeometries().broad, this.mergedScratch, this.mergedColor, nm, false, this.materialMerged);
    ch.farTotal[2] = nm;
    this.totalInstances += total - ch.total;
    ch.total = total;
    // keep the chunk's current LOD state (new meshes default to visible + plain material); the next update re-derives it
    this.applyLod(ch, ch.lastKey, true);
    this.lodForce = true;
    shadowCasters.version++;
  }

  private storeChunkBox(ci: number): void {
    const b = this.chunks[ci].box, o = ci * 6, a = this.chunkBox;
    a[o] = b.min.x; a[o + 1] = b.min.y; a[o + 2] = b.min.z;
    a[o + 3] = b.max.x; a[o + 4] = b.max.y; a[o + 5] = b.max.z;
  }

  /** a tree / impostor mesh with room for at least n instances (new one when too small) */
  private meshFor(mesh: TreeMesh | null, geo: THREE.BufferGeometry, material: THREE.Material, n: number, color: boolean, imp: boolean): TreeMesh {
    if (mesh && mesh.instanceMatrix.count >= n) return mesh;
    if (mesh) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    const cap = Math.ceil(n * 1.25) + 8;
    const m = new TreeMesh(geo, material, cap);
    m.owner = this;
    m.imp = imp;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (color) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.castShadow = this.castShadows;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.userData.regularGeo = geo;
    m.boundingBox = new THREE.Box3();
    m.boundingSphere = new THREE.Sphere();
    this.group.add(m);
    return m;
  }

  private fill(mesh: TreeMesh | null, geo: THREE.BufferGeometry, data: Float32Array, color: Float32Array | null, n: number, near: boolean, material?: THREE.Material): TreeMesh | null {
    if (n === 0) {
      if (mesh) mesh.count = 0;
      if (mesh) mesh.visible = false;
      return mesh;
    }
    mesh = this.meshFor(mesh, geo, material ?? (near ? this.material : this.materialFar), n, !!color, !near);
    mesh.name = near ? `trees-${geo.name}` : 'trees-far';
    (mesh.instanceMatrix.array as Float32Array).set(data.subarray(0, n * 16));
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceMatrix.needsUpdate = true;
    if (color && mesh.instanceColor) {
      (mesh.instanceColor.array as Float32Array).set(color.subarray(0, n * 3));
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, n * 3);
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.count = n;
    // tight bounds of the instances (+ geometry extent)
    if (!geo.boundingBox) geo.computeBoundingBox();
    const gb = geo.boundingBox!;
    const gr = Math.max(Math.abs(gb.min.x), Math.abs(gb.max.x), Math.abs(gb.min.z), Math.abs(gb.max.z));
    _box.makeEmpty();
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      const sxz = Math.hypot(data[o], data[o + 2]), sy = data[o + 5];
      const x = data[o + 12], y = data[o + 13], z = data[o + 14], r = gr * sxz;
      if (x - r < _box.min.x) _box.min.x = x - r;
      if (x + r > _box.max.x) _box.max.x = x + r;
      if (z - r < _box.min.z) _box.min.z = z - r;
      if (z + r > _box.max.z) _box.max.z = z + r;
      if (y + gb.min.y * sy < _box.min.y) _box.min.y = y + gb.min.y * sy;
      if (y + gb.max.y * sy > _box.max.y) _box.max.y = y + gb.max.y * sy;
    }
    mesh.boundingBox!.copy(_box);
    _box.getBoundingSphere(mesh.boundingSphere!);
    mesh.userData.total = n;
    return mesh;
  }

  /** Apply a chunk's LOD state key (see L_*); force: re-apply an unchanged key (after a rebuild) */
  private applyLod(ch: TreeChunk, key: number, force = false) {
    if (key === ch.stateKey && !force) return;
    ch.stateKey = key;
    ch.lastKey = key;
    const near = (key & L_NEAR) !== 0, nearFade = (key & L_NEAR_FADE) !== 0, nearCut = (key & L_NEAR_CUT) !== 0;
    const nearCast = (key & L_NEAR_CAST) !== 0, far = (key & L_FAR) !== 0, farFade = (key & L_FAR_FADE) !== 0;
    const farCut = (key & L_FAR_CUT) !== 0, farCast = (key & L_FAR_CAST) !== 0, micro = (key & L_MICRO) !== 0;
    const keep = (key >> L_KEEP_SHIFT) / 20;
    ch.isNear = near;
    ch.micro = micro;
    const cast = this.castShadows;
    const nm = ch.near;
    const nearMat = nearFade ? this.matNearFade : this.material, nearDepth = this.depthFor(true, nearFade, nearCut);
    for (let i = 0; i < nm.length; i++) {
      const m = nm[i];
      if (!m) continue;
      m.visible = near && m.count > 0;
      m.castShadow = cast && nearCast;
      m.material = nearMat;
      m.customDepthMaterial = nearDepth;
    }
    // impostors past the shadow switch distance cast shadows even where the view still shows near models
    const shadowOnly = !far && cast && farCast;
    const farMat = farFade ? this.matFarFade : this.materialFar, farDepth = this.depthFor(false, farFade, farCut);
    // micro chunks (no fade / cut there) draw both classes as one merged mesh
    const merged = micro && !farFade && !farCut && ch.far[2] !== null && ch.farTotal[2] > 0;
    const mg = micro && !merged ? getMicroImpostorGeometries() : null;
    for (let i = 0; i < 3; i++) {
      const m = ch.far[i];
      if (!m) continue;
      if ((i === 2) !== merged) {
        m.visible = false;
        continue;
      }
      const tot = ch.farTotal[i];
      const c = Math.ceil(tot * keep);
      m.count = c < 0 ? 0 : c > tot ? tot : c;
      m.shadowOnly = shadowOnly;
      m.visible = (far || shadowOnly) && m.count > 0;
      m.castShadow = cast && farCast;
      m.customDepthMaterial = farDepth;
      if (i < 2) {
        m.material = farMat;
        m.geometry = mg ? (i === 0 ? mg.broad : mg.conifer) : (m.userData.regularGeo as THREE.BufferGeometry);
      }
    }
    shadowCasters.version++;
  }

  /** per frame: incremental rebuilds + LOD selection */
  update(camera: THREE.Camera, budget = 3) {
    if (this.dirty.size) {
      let n = budget;
      for (const id of this.dirty) {
        this.dirty.delete(id);
        this.buildChunk(id);
        if (--n <= 0) break;
      }
    }
    if (this.warm.length && ((this.warmMain && (this.warmShadow || !this.castShadows)) || ++this.warmFrames > 600)) this.dropWarmup();
    // snow on the trees follows the terrain's (seasonal) snow line
    const tu = this.terrain.uniforms;
    this.snowU.uTreeSnow.value.set(tu.uSnowLine.value, tu.uSnowNoise.value, tu.uSnowLine.value < 9000 ? 1 : 0, 0);
    const cp = camera.position;
    const px = cp.x, py = cp.y, pz = cp.z;
    const lod = this.lodDistance;
    const w = lod * (this.a2c ? this.fadeBand : this.fadeBandDither), jit = w * 0.8;
    const fs = lod - w, fe = lod + w;
    // shadow switch distance: near models cast up to sc, impostors from sc on (per instance, same jitter as the fade)
    const sc = lod * THREE.MathUtils.clamp(this.shadowLodFrac, 0.2, 1);
    this.fadeU.uTreeCam.value.copy(cp);
    this.fadeU.uTreeFade.value.set(fs, fe, jit, sc);
    const lo = fs - jit * 0.5, hi = fe + jit * 0.5;
    const cutLo = sc - jit * 0.5, cutHi = sc + jit * 0.5;
    // projected radius of a typical (3.5 m) tree: px = r / d * H / (2 tan(fov / 2))
    const K = (3.5 * this.viewHeight) / (2 * Math.tan((this.viewFov * Math.PI) / 360));
    const microIn = this.microPixels * 0.87, microOut = this.microPixels * 1.15;
    const chunks = this.chunks, B = this.chunkBox;
    // the chunk LOD pass only runs when its inputs changed (camera, distances, view size) or a chunk was rebuilt: a still
    // camera re-derives nothing
    const LI = this.lodInputs;
    const lodChanged = this.lodForce || px !== LI[0] || py !== LI[1] || pz !== LI[2] || K !== LI[3] || lo !== LI[4] || hi !== LI[5] ||
      cutLo !== LI[6] || cutHi !== LI[7] || microIn !== LI[8];
    if (lodChanged) {
      LI[0] = px; LI[1] = py; LI[2] = pz; LI[3] = K; LI[4] = lo; LI[5] = hi; LI[6] = cutLo; LI[7] = cutHi; LI[8] = microIn;
      this.lodForce = false;
    }
    for (let ci = 0; lodChanged && ci < chunks.length; ci++) {
      const ch = chunks[ci], o = ci * 6;
      const x0 = B[o], y0 = B[o + 1], z0 = B[o + 2], x1 = B[o + 3], y1 = B[o + 4], z1 = B[o + 5];
      // nearest / farthest distance from the camera to the chunk box
      const nx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
      const ny = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
      const nz = pz < z0 ? z0 - pz : pz > z1 ? pz - z1 : 0;
      const dN = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const ax = px - x0, bx = x1 - px, ay = py - y0, by = y1 - py, az = pz - z0, bz = z1 - pz;
      const fx = (ax < 0 ? -ax : ax) > (bx < 0 ? -bx : bx) ? ax : bx;
      const fy = (ay < 0 ? -ay : ay) > (by < 0 ? -by : by) ? ay : by;
      const fz = (az < 0 ? -az : az) > (bz < 0 ? -bz : bz) ? az : bz;
      const dF = Math.sqrt(fx * fx + fy * fy + fz * fz);
      const near = dN < hi, far = dF > lo;
      // density fade for far chunks (keep a random subset), in 1/20 steps
      let keep = dN < lod ? 1 : 1.25 - (dN - lod) / 7000;
      keep = keep < 0.3 ? 0.3 : keep > 1 ? 1 : keep;
      const tpx = K / (dN > 1 ? dN : 1);
      const micro = !near && (ch.micro ? tpx < microOut : tpx < microIn);
      // shadows: a near model casts while its (jittered) distance < sc, an impostor from sc on
      const nearCast = near && dN < cutHi, farCast = dF > cutLo;
      const key = (near ? L_NEAR : 0) | (far ? L_FAR : 0) | (near && dF > lo ? L_NEAR_FADE : 0) | (far && dN < hi ? L_FAR_FADE : 0) |
        (nearCast && dF > cutLo ? L_NEAR_CUT : 0) | (farCast && dN < cutHi ? L_FAR_CUT : 0) | (micro ? L_MICRO : 0) |
        (nearCast ? L_NEAR_CAST : 0) | (farCast ? L_FAR_CAST : 0) | (Math.round(keep * 20) << L_KEEP_SHIFT);
      if (key !== ch.stateKey) this.applyLod(ch, key);
    }
    // outer ring: candidates / refills in a small time budget once the map's chunks are built (or after waiting long)
    if (this.ringStale || this.ringRefill || this.ringGen || this.ringFillState) {
      if (!this.dirty.size || ++this.ringWait > 90) {
        this.ringWait = 0;
        this.ringStep(this.ringBudgetMs);
      }
    }
    this.updateRingView(px, py, pz, lod);
  }

  /** per frame: which outer ring meshes are drawn (sector distance, camera height) and how dense */
  private updateRingView(px: number, py: number, pz: number, lod: number): void {
    const camH = py - this.terrain.meshHeightAt(px, pz);
    const vis = _sstep(this.ringFadeHeight[0], this.ringFadeHeight[1], camH);
    const ring = this.ring, RB = this.ringBox;
    for (let k = 0; k < RING_N; k++) {
      const mb = ring[k * 3], mc = ring[k * 3 + 1], mm = ring[k * 3 + 2];
      if (!this.ringReady[k]) {
        if (mb) mb.visible = false;
        if (mc) mc.visible = false;
        if (mm) mm.visible = false;
        continue;
      }
      const o = k * 6;
      const nx = px < RB[o] ? RB[o] - px : px > RB[o + 3] ? px - RB[o + 3] : 0;
      const ny = py < RB[o + 1] ? RB[o + 1] - py : py > RB[o + 4] ? py - RB[o + 4] : 0;
      const nz = pz < RB[o + 2] ? RB[o + 2] - pz : pz > RB[o + 5] ? pz - RB[o + 5] : 0;
      const dN = Math.sqrt(nx * nx + ny * ny + nz * nz);
      // the regular impostor pair within lodDistance (hysteresis), one micro impostor mesh beyond
      const near = this.ringNearSel[k] ? dN < lod * 1.06 : dN < lod * 0.94;
      this.ringNearSel[k] = near ? 1 : 0;
      // low cameras: the far sectors fade out with the camera height (seen from inside the city they are hidden or a
      // few specks in the haze); a sector within lodDistance stays (the camera is near the map edge, where the ring is
      // the horizon), its density fading in over the outer third of lodDistance
      const v = near ? Math.max(vis, _sstep(lod * 0.94, lod * 0.6, dN)) : vis;
      let keep = dN < lod ? 1 : 1.25 - (dN - lod) / 7000;
      keep = (keep < 0.3 ? 0.3 : keep > 1 ? 1 : keep) * v;
      const q = Math.round(keep * 20) / 20;
      if (near) {
        this.ringCount(mb, q);
        this.ringCount(mc, q);
        if (mm) mm.visible = false;
      } else {
        this.ringCount(mm, q);
        if (mb) mb.visible = false;
        if (mc) mc.visible = false;
      }
    }
  }

  /** draw the first q of a ring mesh's (shuffled) instances (userData.ringCount = its total) */
  private ringCount(m: TreeMesh | null, q: number): void {
    if (!m) return;
    const tot = (m.userData.ringCount as number | undefined) ?? 0;
    const c = Math.ceil(tot * q);
    m.count = c > tot ? tot : c;
    m.visible = m.count > 0;
  }

  /** synchronous full rebuild (e.g. before a capture); ring: also finish the outer ring's generation / refills */
  flush(ring = true) {
    for (const id of this.dirty) this.buildChunk(id);
    this.dirty.clear();
    if (ring) this.flushRing();
  }

  /** finish the outer ring's pending generation / refills now */
  private flushRing(): void {
    while (this.ringStale || this.ringRefill || this.ringGen || this.ringFillState) this.ringStep(Infinity);
  }

  /** tree density (0..1) of the map's tree texture, clamped to the map like the terrain shader samples it */
  private edgeTrees(px: number, pz: number): number {
    const st = this.state, N = st.size;
    const fx = Math.min(N - 1, Math.max(0, px / CELL_SIZE - 0.5)), fz = Math.min(N - 1, Math.max(0, pz / CELL_SIZE - 0.5));
    const x0 = Math.floor(fx), z0 = Math.floor(fz), x1 = Math.min(N - 1, x0 + 1), z1 = Math.min(N - 1, z0 + 1);
    const t = (x: number, z: number) => {
      const i = z * N + x;
      return TerrainRenderer.cellBlocked(st, i) ? 0 : st.trees[i] / 4;
    };
    const ax = fx - x0, az = fz - z0;
    return (t(x0, z0) * (1 - ax) + t(x1, z0) * ax) * (1 - az) + (t(x0, z1) * (1 - ax) + t(x1, z1) * ax) * az;
  }

  // ------------------------------------------------------------------ outer ring

  /** the ring's density at the current quality: the quality's tree density, thinned further at low quality */
  private ringDensity(): number {
    const d = (this.density - 0.5) * 2;
    return d < 0.25 ? 0.25 : d > 1 ? 1 : d;
  }

  /** do the map's own cells (edge trees) reach the ring? (only maps over ~330 cells: the edge forests fade into the
   *  noise forests over 3% of the map size, the ring starts after the edge band) */
  private ringEdgeDep(): boolean {
    return 0.03 * this.state.size * CELL_SIZE > RING_EDGE_CELLS * CELL_SIZE;
  }

  /** border corner heights (west, east, north, south) the ring is generated with */
  private snapshotRingEdge(): void {
    const st = this.state, N = st.size, N1 = N + 1, H = st.heights;
    if (this.ringEdgeH.length !== 4 * N1) this.ringEdgeH = new Float32Array(4 * N1);
    const E = this.ringEdgeH;
    for (let i = 0; i <= N; i++) {
      E[i] = H[i * N1];
      E[N1 + i] = H[i * N1 + N];
      E[2 * N1 + i] = H[i];
      E[3 * N1 + i] = H[N * N1 + i];
    }
  }

  /**
   * cells changed on / next to the map border: the ring depends on the map only through the border heights (the outer
   * landscape continues them), so only a terrain edit there regenerates the sectors on that side (and on huge maps,
   * whose edge forests reach past the edge band, any tree change at the border)
   */
  private ringEdgeChanged(x0: number, z0: number, x1: number, z1: number): void {
    const st = this.state, N = st.size, N1 = N + 1, H = st.heights, E = this.ringEdgeH;
    const dep = this.ringEdgeDep();
    // side 0 west (x = 0), 1 east (x = N), 2 north (z = 0), 3 south (z = N)
    for (let side = 0; side < 4; side++) {
      const touches = side === 0 ? x0 <= 1 : side === 1 ? x1 >= N - 2 : side === 2 ? z0 <= 1 : z1 >= N - 2;
      if (!touches) continue;
      let changed = dep;
      const a = Math.max(0, (side < 2 ? z0 : x0) - 1), b = Math.min(N, (side < 2 ? z1 : x1) + 2);
      for (let i = a; i <= b; i++) {
        const h = side === 0 ? H[i * N1] : side === 1 ? H[i * N1 + N] : side === 2 ? H[i] : H[N * N1 + i];
        if (h !== E[side * N1 + i]) {
          E[side * N1 + i] = h;
          changed = true;
        }
      }
      if (!changed) continue;
      for (let k = 0; k < RING_N; k++) {
        const [ix, iz] = RING_SECTORS[k];
        if ((side === 0 && ix === 0) || (side === 1 && ix === 2) || (side === 2 && iz === 0) || (side === 3 && iz === 2)) this.ringRestale(k);
      }
    }
  }

  /** sector k needs new candidates (restarts a generation of it in progress) */
  private ringRestale(k: number): void {
    this.ringStale |= 1 << k;
    if (this.ringGen?.k === k) this.ringGen = null;
  }

  /**
   * One frame's share of the outer ring work, at most ~budgetMs of main-thread time (always at least one block row /
   * candidate batch, so it progresses): finish the fill / generation in progress, then refill sectors whose candidates
   * are current, then generate stale sectors (each is filled right after its generation, so sectors appear one by
   * one; a stale sector is never refilled from its old candidates).
   */
  ringStep(budgetMs: number): void {
    const end = performance.now() + budgetMs;
    for (;;) {
      if (this.ringFillState) {
        if (!this.ringFillRows(end)) return;
      } else if (this.ringGen) {
        if (!this.ringGenRows(end)) return;
      } else {
        const fillable = this.ringRefill & ~this.ringStale;
        if (fillable) {
          const k = 31 - Math.clz32(fillable & -fillable);
          this.ringRefill &= ~(1 << k);
          this.ringFillStart(k);
        } else if (this.ringStale) {
          const k = 31 - Math.clz32(this.ringStale & -this.ringStale);
          this.ringStale &= ~(1 << k);
          this.ringGenStart(k);
        } else return;
      }
      if (performance.now() >= end) return;
    }
  }

  private ringSpan(k: number): [number, number, number, number] {
    const W = this.state.size * CELL_SIZE, R = this.ringWidth;
    const [ix, iz] = RING_SECTORS[k];
    const x0 = ix === 0 ? -R : ix === 1 ? 0 : W, x1 = ix === 0 ? 0 : ix === 1 ? W : W + R;
    const z0 = iz === 0 ? -R : iz === 1 ? 0 : W, z1 = iz === 0 ? 0 : iz === 1 ? W : W + R;
    return [x0, x1, z0, z1];
  }

  /** forest probability (at full density) of the outer landscape at (px, pz): the terrain shader's outside forest mask
   *  (the map's edge forests fading into the noise forests), thinning toward the horizon and fading out before
   *  ringWidth; 0 in the edge band and beyond ringWidth */
  private ringForest(noise: Uint8Array, px: number, pz: number): number {
    const W = this.state.size * CELL_SIZE, R = this.ringWidth;
    const dx = px < 0 ? -px : px > W ? px - W : 0, dz = pz < 0 ? -pz : pz > W ? pz - W : 0;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > R + 60) return 0;
    const outside = _sstep(0, 0.03, Math.max(dx, dz) / W);
    let trees = outside < 1 ? this.edgeTrees(px, pz) * (1 - outside) : 0;
    if (outside > 0) trees += outside * 0.65 * _sstep(0.6, 0.74, sampleNoise(noise, px / 3100, pz / 3100, 1) * 0.6 + sampleNoise(noise, px / 520, pz / 520, 0) * 0.5);
    return _sstep(0.03, 0.55, trees) * (1 - 0.7 * _sstep(300, 0.8 * R, dist)) * (1 - _sstep(0.8 * R, R, dist));
  }

  /** forest probability at the block corners of grid row gz (every RING_BLOCK cells from gx0) */
  private ringCornerRow(noise: Uint8Array, out: Float32Array, gx0: number, gz: number): void {
    const g = RING_GRID;
    for (let j = 0; j < out.length; j++) out[j] = this.ringForest(noise, (gx0 + j * RING_BLOCK) * g, gz * g);
  }

  private ringGenStart(k: number): void {
    const [x0, x1, z0] = this.ringSpan(k);
    const g = RING_GRID;
    const gx0 = Math.floor(x0 / g), gx1 = Math.ceil(x1 / g);
    const nc = Math.ceil((gx1 - gx0) / RING_BLOCK) + 1;
    const gz0 = Math.floor(z0 / g);
    const gen: RingGen = { k, bz: gz0, bi: -1, n: 0, buf: this.ringCand[k] ?? new Float32Array(RING_STRIDE * 1024), top: new Float32Array(nc), bot: new Float32Array(nc) };
    if (this.ringWidth > 0) this.ringCornerRow(getNoiseTexture().image.data as Uint8Array, gen.top, gx0, gz0);
    this.ringGen = gen;
  }

  /**
   * Candidate generation of the current sector, block by block (resumable inside a block row) until `end` (ms,
   * performance.now): per 10 m grid cell at most one tree at a jittered spot, kept with the forest probability
   * (interpolated from the block corners; forest-free blocks skipped), no water / beaches, no shrubs / rocks (too small
   * out there). Each candidate stores its density threshold (the uniform random over the probability), so any lower
   * density is a subset. Returns true once the sector is complete (its meshes are then refilled).
   */
  private ringGenRows(end: number): boolean {
    const gen = this.ringGen!;
    const k = gen.k;
    const [x0, x1, z0, z1] = this.ringSpan(k);
    const W = this.state.size * CELL_SIZE, R = this.ringWidth, g = RING_GRID, BK = RING_BLOCK;
    const gx0 = Math.floor(x0 / g), gx1 = Math.ceil(x1 / g), gz1 = Math.ceil(z1 / g);
    const noise = getNoiseTexture().image.data as Uint8Array;
    const seed = this.seed, band = RING_EDGE_CELLS * CELL_SIZE;
    const weights = this.weights;
    let buf = gen.buf, n = gen.n;
    if (R <= 0) gen.bz = gz1;
    let out = false;
    while (gen.bz < gz1 && n < RING_CAP) {
      const bz = gen.bz;
      if (gen.bi < 0) {
        this.ringCornerRow(noise, gen.bot, gx0, bz + BK);
        gen.bi = 0;
      }
      const top = gen.top, bot = gen.bot;
      for (let bi = gen.bi; bi < top.length - 1; bi++) {
        // (time check after every 8th block, so each call progresses: a block is at most 16 candidates)
        if ((bi & 7) === 7 && bi > gen.bi && performance.now() >= end) {
          gen.bi = bi;
          out = true;
          break;
        }
        const p00 = top[bi], p10 = top[bi + 1], p01 = bot[bi], p11 = bot[bi + 1];
        // (bilinear: never above the largest corner)
        if (p00 <= 0.01 && p10 <= 0.01 && p01 <= 0.01 && p11 <= 0.01) continue;
        const bx = gx0 + bi * BK;
        for (let gz = bz; gz < bz + BK && gz < gz1; gz++) {
          for (let gx = bx; gx < bx + BK && gx < gx1; gx++) {
            const px = (gx + 0.1 + 0.8 * hash2(gx, gz, seed + 301)) * g, pz = (gz + 0.1 + 0.8 * hash2(gz, gx, seed + 307)) * g;
            if (px < x0 || px >= x1 || pz < z0 || pz >= z1) continue;
            const dx = px < 0 ? -px : px > W ? px - W : 0, dz = pz < 0 ? -pz : pz > W ? pz - W : 0;
            // (the band next to the map belongs to the edge chunks' full trees)
            if ((dx > dz ? dx : dz) < band || dx * dx + dz * dz > R * R) continue;
            const u = (px - bx * g) / (BK * g), v = (pz - bz * g) / (BK * g);
            const p = (p00 * (1 - u) + p10 * u) * (1 - v) + (p01 * (1 - u) + p11 * u) * v;
            const r = hash2(gx * 3 + 1, gz * 5 - 2, seed + 311);
            if (p <= 0.01 || r >= p) continue;
            const h = this.terrain.worldHeight(px, pz);
            if (h < 1.6) continue;
            // species (season independent)
            const sp = this.pickSpecies(Math.floor(px / CELL_SIZE), Math.floor(pz / CELL_SIZE), h, 0, hash2(gx * 5 + 3, gz * 3 - 1, seed + 313), weights);
            const sid = this.species[sp].id;
            if (sid === 'bush' || sid === 'rock') continue;
            if ((n + 1) * RING_STRIDE > buf.length) {
              const nb = new Float32Array(buf.length * 2);
              nb.set(buf);
              buf = gen.buf = nb;
            }
            const o = n * RING_STRIDE;
            buf[o] = px; buf[o + 1] = h; buf[o + 2] = pz;
            buf[o + 3] = sp;
            buf[o + 4] = hash2(gx + 11, gz - 13, seed + 317);
            buf[o + 5] = hash2(gx - 17, gz + 19, seed + 331) * Math.PI * 2;
            buf[o + 6] = 0.9 + 0.2 * hash2(gx + 23, gz * 2 + 1, seed + 337);
            // density threshold: drawn while t < the ring density
            buf[o + 7] = r / p;
            n++;
          }
        }
      }
      gen.n = n;
      if (out) break;
      gen.top = bot;
      gen.bot = top;
      gen.bz = bz + BK;
      gen.bi = -1;
      if (performance.now() >= end) break;
    }
    if (gen.bz < gz1 && n < RING_CAP) return false;
    this.ringCand[k] = buf;
    this.ringCandN[k] = n;
    this.ringGen = null;
    this.ringGenerations++;
    this.ringRefill |= 1 << k;
    return true;
  }

  /** start (re)filling sector k's meshes from its candidates at the current density / season */
  private ringFillStart(k: number): void {
    const buf = this.ringCand[k], n = buf ? this.ringCandN[k] : 0;
    const dens = this.ringDensity();
    // instances per mesh: broadleaf / conifer (near pair) and all (micro)
    let nb = 0, nc = 0;
    for (let i = 0; i < n; i++) {
      const o = i * RING_STRIDE;
      if (buf![o + 7] >= dens) continue;
      if (this.species[buf![o + 3]].conifer) nc++;
      else nb++;
    }
    const counts = [nb, nc, nb + nc];
    const perm: Int32Array[] = [];
    for (let m = 0; m < 3; m++) {
      // shuffled slots: a prefix of the drawn instances is a uniform random subset (density fade with distance)
      const c = counts[m], p = new Int32Array(c);
      for (let i = 0; i < c; i++) p[i] = i;
      for (let i = c - 1; i > 0; i--) {
        const j = Math.floor(hash2(i, k * 3 + m, this.seed + 353) * (i + 1));
        const t = p[i];
        p[i] = p[j];
        p[j] = t;
      }
      perm.push(p);
    }
    const imp = getImpostorGeometries(), mg = getMicroImpostorGeometries();
    const geos = [imp.broad, imp.conifer, mg.broad];
    for (let m = 0; m < 3; m++) {
      const idx = k * 3 + m;
      const mesh = this.meshFor(this.ring[idx], geos[m], m === 2 ? this.materialMerged : this.materialFar, Math.max(1, counts[m]), true, false);
      mesh.name = 'trees-ring';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.ring[idx] = mesh;
    }
    const bounds = new Float64Array(18);
    for (let m = 0; m < 3; m++) {
      bounds[m * 6] = bounds[m * 6 + 1] = bounds[m * 6 + 2] = Infinity;
      bounds[m * 6 + 3] = bounds[m * 6 + 4] = bounds[m * 6 + 5] = -Infinity;
    }
    this.ringFillState = { k, i: 0, w: new Int32Array(3), perm, bounds, dens };
  }

  /**
   * Write the current sector's instances (kind for the season, matrices, colours) straight into its meshes' instance
   * arrays until `end`; once complete: upload ranges, counts, bounds, and the sector may be drawn. Returns true when
   * complete.
   */
  private ringFillRows(end: number): boolean {
    const f = this.ringFillState!;
    const k = f.k;
    const buf = this.ringCand[k], n = buf ? this.ringCandN[k] : 0;
    const meshes = [this.ring[k * 3]!, this.ring[k * 3 + 1]!, this.ring[k * 3 + 2]!];
    const arr = meshes.map((m) => m.instanceMatrix.array as Float32Array);
    const col = meshes.map((m) => m.instanceColor!.array as Float32Array);
    const imp = getImpostorGeometries(), mg = getMicroImpostorGeometries();
    const geos = [imp.broad, imp.conifer, mg.broad];
    const gb: THREE.Box3[] = [];
    const gr: number[] = [];
    for (const g of geos) {
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox!;
      gb.push(b);
      gr.push(Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z)));
    }
    const bd = f.bounds, w = f.w, perm = f.perm;
    // writes one instance into mesh m: horizontal scale hs (+ yaw c / sn), vertical scale vs, base height y
    const put = (m: number, c: number, sn: number, hs: number, vs: number, x: number, y: number, z: number, r: number, gc: number, b: number) => {
      const slot = perm[m][w[m]++];
      const a = arr[m], o = slot * 16;
      a[o] = c * hs; a[o + 1] = 0; a[o + 2] = -sn * hs; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = vs; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = sn * hs; a[o + 9] = 0; a[o + 10] = c * hs; a[o + 11] = 0;
      a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
      const cc = col[m], co = slot * 3;
      cc[co] = r; cc[co + 1] = gc; cc[co + 2] = b;
      const rr = gr[m] * hs, q = m * 6, ylo = y + gb[m].min.y * vs, yhi = y + gb[m].max.y * vs;
      if (x - rr < bd[q]) bd[q] = x - rr;
      if (ylo < bd[q + 1]) bd[q + 1] = ylo;
      if (z - rr < bd[q + 2]) bd[q + 2] = z - rr;
      if (x + rr > bd[q + 3]) bd[q + 3] = x + rr;
      if (yhi > bd[q + 4]) bd[q + 4] = yhi;
      if (z + rr > bd[q + 5]) bd[q + 5] = z + rr;
    };
    let i = f.i;
    while (i < n) {
      const stop = i + 256 < n ? i + 256 : n;
      for (; i < stop; i++) {
        const o = i * RING_STRIDE;
        if (buf![o + 7] >= f.dens) continue;
        const px = buf![o], h = buf![o + 1], pz = buf![o + 2];
        const kind = this.kinds[this.kindOf(buf![o + 3], Math.floor(px / CELL_SIZE), Math.floor(pz / CELL_SIZE))];
        const sp = this.species[kind.species];
        const s0 = sp.scale ? sp.scale[0] : 0.72, s1 = sp.scale ? sp.scale[1] : 1.18;
        const s = (s0 + (s1 - s0) * buf![o + 4]) * 1.1;
        const c = Math.cos(buf![o + 5]), sn = Math.sin(buf![o + 5]);
        const sxz = (kind.radius / 0.42) * s * 0.92 * kind.impR, sy = kind.height * s;
        const cv = buf![o + 6];
        const r = kind.color.r * cv, gc = kind.color.g * cv, b = kind.color.b * cv;
        const y = h - 0.15;
        if (kind.conifer) {
          put(1, c, sn, sxz, sy, px, y, pz, r, gc, b);
          // micro mesh: the double pyramid's top half shaped as the conifer pyramid; negative blue = evergreen
          put(2, c, sn, sxz * RING_CON_R, sy * RING_CON_A, px, y + sy * RING_CON_B, pz, r, gc, -Math.max(b, 1e-4));
        } else {
          put(0, c, sn, sxz, sy, px, y, pz, r, gc, b);
          put(2, c, sn, sxz, sy, px, y, pz, r, gc, b);
        }
      }
      if (performance.now() >= end) break;
    }
    f.i = i;
    if (i < n) return false;
    // complete: upload, counts, bounds
    let prev = 0;
    for (let m = 0; m < 3; m++) {
      const mesh = meshes[m], cnt = w[m];
      prev += m === 2 ? ((mesh.userData.ringCount as number | undefined) ?? 0) : 0;
      mesh.userData.ringCount = cnt;
      mesh.count = cnt;
      mesh.visible = false;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, Math.max(1, cnt) * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, Math.max(1, cnt) * 3);
      mesh.instanceColor!.needsUpdate = true;
      const q = m * 6, bb = mesh.boundingBox!;
      if (cnt > 0) {
        bb.min.set(bd[q], bd[q + 1], bd[q + 2]);
        bb.max.set(bd[q + 3], bd[q + 4], bd[q + 5]);
        bb.getBoundingSphere(mesh.boundingSphere!);
      } else bb.makeEmpty();
    }
    // sector bounds (for its per-frame distance): the near pair's union (the micro mesh's conifers reach underground)
    const RB = this.ringBox, ro = k * 6;
    for (let a = 0; a < 3; a++) {
      RB[ro + a] = Math.min(bd[a], bd[6 + a]);
      RB[ro + 3 + a] = Math.max(bd[3 + a], bd[9 + a]);
    }
    this.ringInstances += w[2] - prev;
    this.ringReady[k] = w[2] > 0 ? 1 : 0;
    this.ringFillState = null;
    return true;
  }

  private disposeChunk(c: TreeChunk) {
    for (const m of c.near) {
      if (!m) continue;
      this.group.remove(m);
      m.dispose();
    }
    for (const m of c.far) {
      if (!m) continue;
      this.group.remove(m);
      m.dispose();
    }
  }

  dispose() {
    this.dropWarmup();
    for (const c of this.chunks) this.disposeChunk(c);
    this.chunks = [];
    for (const m of this.ring) if (m) { this.group.remove(m); m.dispose(); }
    this.ring.fill(null);
    this.material.dispose();
    this.materialFar.dispose();
    this.materialMerged.dispose();
    this.depthNearPlain.dispose();
    this.depthFarPlain.dispose();
    this.matNearFade.dispose();
    this.matFarFade.dispose();
    this.depthNear.dispose();
    this.depthFar.dispose();
    this.depthNearPlainA.dispose();
    this.depthFarPlainA.dispose();
    this.depthNearA.dispose();
    this.depthFarA.dispose();
  }
}
