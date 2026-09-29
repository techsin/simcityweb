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
 * Outer ring: beyond the map edge (the terrain's landscape skirt) impostor-only trees stand on the terrain shader's
 * outside forests, out to ringWidth, in 8 sectors (2 meshes each, no shadows); candidates are generated once per map
 * over several frames after the map's chunks, kinds / colours are refilled cheaply on season changes.
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
import { shadowCasters, receiverSweepBox, type ShadowReceiver } from './Shadows';
import { SEASONAL_TREES, seasonMix, seasonalVariant, type SeasonMix } from '../../assets/builders/nat_season';

const CHUNK = 32;
/** instances per cell for density 0..4 */
const DENSITY_COUNT = [0, 1.1, 2.3, 3.8, 5.6];
/**
 * Outer landscape ring (beyond the map edge, where the terrain continues to the horizon): tree impostors on the terrain
 * shader's outside "noise forests", in the 8 cells of a 3 x 3 grid around the map square (sector -> [column, row]).
 */
const RING_SECTORS: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
/** outer ring placement grid (m): at most one tree per cell, fewer further out */
const RING_GRID = 10;
/** instance cap per ring sector */
const RING_CAP = 7000;
/** the map's edge chunks continue their forests as full trees this many cells beyond the edge; the ring starts there */
const RING_EDGE_CELLS = 10;

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
  near: (THREE.InstancedMesh | null)[];
  far: (THREE.InstancedMesh | null)[];
  farTotal: [number, number];
  box: THREE.Box3;
  sphere: THREE.Sphere;
  isNear: boolean;
  total: number;
  /** last applied LOD state key (skip work when unchanged) + its arguments (re-applied after a rebuild) */
  stateKey: number;
  state: LodState | null;
  micro: boolean;
}

/**
 * Per-chunk LOD state. near / far: near models / impostors drawn in the view; nearFade / farFade: they straddle the
 * fade band (dithered material); nearCast / farCast: they cast shadows (impostors can be shadow-only: drawn in the
 * shadow passes but skipped in the view); nearCut / farCut: they straddle the shadow switch distance (per-instance
 * depth cut); keep: impostor density; micro: micro impostor geometry.
 */
interface LodState {
  near: boolean; far: boolean; nearFade: boolean; farFade: boolean;
  nearCast: boolean; farCast: boolean; nearCut: boolean; farCut: boolean;
  keep: number; micro: boolean;
}
const FRESH_STATE: LodState = { near: false, far: true, nearFade: false, farFade: false, nearCast: false, farCast: true, nearCut: false, farCut: false, keep: 1, micro: false };

const _v = new THREE.Vector3();
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
  private chunks: TreeChunk[] = [];
  private perSide: number;
  private dirty = new Set<number>();
  private noise: Noise2D;
  private seed: number;
  private material: THREE.MeshStandardMaterial;
  /** impostors (per-instance colour) get their own material and depth materials: sharing one material object between
   *  meshes with and without instanceColor makes three re-derive the program on every switch between them */
  private materialFar: THREE.MeshStandardMaterial;
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
  /** total instances currently placed (stats) */
  totalInstances = 0;
  /** outer ring impostors: sector * 2 + (0 broadleaf, 1 conifer) */
  private ring: (THREE.InstancedMesh | null)[] = new Array(RING_SECTORS.length * 2).fill(null);
  /** outer ring sectors still to (re)fill (one per frame, after the map chunks) */
  private ringQueue: number[] = RING_SECTORS.map((_, i) => i);
  /** outer ring tree candidates per sector (7 floats each, see ringCandidates) and their counts */
  private ringCand: (Float32Array | null)[] = RING_SECTORS.map(() => null);
  private ringCandN: number[] = RING_SECTORS.map(() => 0);
  /** sectors whose candidates must be regenerated first (new map / density, edge trees changed) */
  private ringStale = new Set<number>(RING_SECTORS.map((_, i) => i));
  /** candidate generation in progress (resumable over frames): sector, next grid row, candidates so far */
  private ringGen: { k: number; gz: number; n: number } | null = null;
  /** width (m) of the landscape ring beyond the map edge that gets tree impostors (0 = none) */
  ringWidth = 2600;
  /** outer ring instances currently placed (stats) */
  ringInstances = 0;
  private lodScratch: LodState = { ...FRESH_STATE };

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
    for (let cz = 0; cz < this.perSide; cz++)
      for (let cx = 0; cx < this.perSide; cx++) {
        const x0 = cx * CHUNK * CELL_SIZE, z0 = cz * CHUNK * CELL_SIZE;
        // edge chunks reach RING_EDGE_CELLS beyond the map (their forests continue past the edge)
        const e = RING_EDGE_CELLS * CELL_SIZE, last = this.perSide - 1;
        const box = new THREE.Box3(new THREE.Vector3(x0 - (cx === 0 ? e : 0), -10, z0 - (cz === 0 ? e : 0)), new THREE.Vector3(x0 + CHUNK * CELL_SIZE + (cx === last ? e : 0), 60, z0 + CHUNK * CELL_SIZE + (cz === last ? e : 0)));
        this.chunks.push({ cx, cz, near: this.kinds.map(() => null), far: [null, null], farTotal: [0, 0], box, sphere: new THREE.Sphere(), isNear: false, total: 0, stateKey: -1, state: null, micro: false });
      }
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
    this.setMonth(state.month);
    this.makeWarmup();
  }

  /** one hidden, degenerate instance per material pairing (near / far x plain / fade, each with its depth variant):
   *  drawn by the first frames so no program compiles when a chunk first enters the fade band or shadow cut */
  private makeWarmup(): void {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const imp = getImpostorGeometries();
    const near = this.kinds[0]?.geo;
    const pairs: [THREE.BufferGeometry | undefined, THREE.Material, THREE.Material, boolean][] = [];
    for (const isNear of [true, false]) for (const fade of [false, true]) for (const cut of [false, true]) {
      pairs.push([isNear ? near : imp.broad, isNear ? (fade ? this.matNearFade : this.material) : (fade ? this.matFarFade : this.materialFar), this.depthFor(isNear, fade, cut), !isNear]);
    }
    for (const [geo, mat, depth, color] of pairs) {
      if (!geo) continue;
      const m = new THREE.InstancedMesh(geo, mat, 1);
      m.setMatrixAt(0, zero);
      if (color) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
      m.frustumCulled = false;
      m.castShadow = this.castShadows;
      m.receiveShadow = true;
      m.customDepthMaterial = depth;
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

  /** plain (no fade) tree material: near models or impostors */
  private makeTreeMaterial(far: boolean): THREE.MeshStandardMaterial {
    const m = patchSurfaceMaterial(getBuildingMaterial().clone(), 'building-uber-v1');
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      base.call(m, shader, renderer);
      this.injectSeason(shader, far);
    };
    m.customProgramCacheKey = () => 'building-uber-v1|tree-' + (far ? 'far' : 'near') + '-v1';
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
        c.far = [null, null];
        c.total = 0;
      }
      this.totalInstances = 0;
      this.markAll();
    }
    const densityChanged = opts.density !== this.density;
    if (densityChanged) for (let k = 0; k < RING_SECTORS.length; k++) this.ringRestale(k);
    this.lodDistance = opts.lodDistance;
    this.density = opts.density;
    this.castShadows = opts.castShadows;
    // per-chunk castShadow / shadow-only flags are re-derived by the next update()
    for (const c of this.chunks) {
      c.stateKey = -1;
      for (const m of [...c.near, ...c.far]) if (m) m.castShadow = opts.castShadows;
    }
    if (densityChanged) this.markAll();
  }

  markAll() {
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
    this.ringQueue = RING_SECTORS.map((_, i) => i);
  }

  /** cells changed (trees / network / zones / buildings) */
  onCellsChanged(r: CellRect) {
    const x0 = Math.max(0, r.x0), z0 = Math.max(0, r.z0);
    const x1 = Math.min(this.state.size - 1, r.x1), z1 = Math.min(this.state.size - 1, r.z1);
    // edge cells continue into the outer ring (its first ~3% of the map size)
    const N = this.state.size;
    RING_SECTORS.forEach(([ix, iz], k) => {
      const hit = (ix === 0 && x0 <= 1) || (ix === 2 && x1 >= N - 2) || (iz === 0 && z0 <= 1) || (iz === 2 && z1 >= N - 2);
      if (hit) this.ringRestale(k);
    });
    for (let cz = Math.floor(z0 / CHUNK); cz <= Math.floor(z1 / CHUNK); cz++)
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++)
        if (cx >= 0 && cz >= 0 && cx < this.perSide && cz < this.perSide) this.dirty.add(cz * this.perSide + cx);
  }

  reset(state: CityState) {
    this.state = state;
    for (let k = 0; k < RING_SECTORS.length; k++) this.ringRestale(k);
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
        c.far = [null, null];
      }
    }
    this.markAll();
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
   * branches (Dec-Feb 0.85) and blossom (Apr 0.15); temperate / alpine only (nat_season.seasonMix)
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
    const weights = new Array(this.species.length).fill(0);
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
    let total = 0;
    for (let k = 0; k < nk; k++) {
      const n = this.scratchCount[k];
      total += n;
      ch.near[k] = this.fill(ch.near[k], this.kinds[k].geo, this.scratch[k], null, n, ch, true);
    }
    const imp = getImpostorGeometries();
    ch.far[0] = this.fill(ch.far[0], imp.broad, this.farScratch[0], this.farColor[0], this.farCount[0], ch, false);
    ch.far[1] = this.fill(ch.far[1], imp.conifer, this.farScratch[1], this.farColor[1], this.farCount[1], ch, false);
    ch.farTotal[0] = this.farCount[0];
    ch.farTotal[1] = this.farCount[1];
    this.totalInstances += total - ch.total;
    ch.total = total;
    ch.stateKey = -1;
    // keep the chunk's current LOD state (new meshes default to visible + plain material)
    this.applyLod(ch, ch.state ?? FRESH_STATE);
    shadowCasters.version++;
  }

  private fill(mesh: THREE.InstancedMesh | null, geo: THREE.BufferGeometry, data: Float32Array, color: Float32Array | null, n: number, _ch: TreeChunk | null, near: boolean): THREE.InstancedMesh | null {
    if (n === 0) {
      if (mesh) mesh.count = 0;
      if (mesh) mesh.visible = false;
      return mesh;
    }
    if (!mesh || mesh.instanceMatrix.count < n) {
      if (mesh) {
        this.group.remove(mesh);
        mesh.dispose();
      }
      const cap = Math.ceil(n * 1.25) + 8;
      const m: THREE.InstancedMesh = new THREE.InstancedMesh(geo, near ? this.material : this.materialFar, cap);
      mesh = m;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (color) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.castShadow = this.castShadows;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.name = near ? `trees-${geo.name}` : 'trees-far';
      m.userData.regularGeo = geo;
      // cull by the tight instance bounds (box), not the chunk sphere
      m.intersectsFrustum = (f: THREE.Frustum) => {
        const b = m.boundingBox!;
        if (!f.intersectsBox(b)) return false;
        // shadow cascades: only if the trees' shadows can reach the visible part of the cascade
        const recv = (f as unknown as { recv?: ShadowReceiver }).recv;
        return !recv || receiverSweepBox(recv, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
      };
      if (!near) {
        // impostors: skip shadow cascades with coarse texels (count 0 for that pass only)
        m.onBeforeShadow = (_r, _o, _c, shadowCamera) => {
          const t = (shadowCamera.userData.texel as number | undefined) ?? 0;
          if (t > this.impostorShadowTexel) { m.userData.savedCount = m.count; m.count = 0; }
        };
        m.onAfterShadow = () => {
          if (m.userData.savedCount !== undefined) { m.count = m.userData.savedCount; m.userData.savedCount = undefined; }
        };
        // shadow-only impostors (chunk still drawn with near models, but past the shadow switch distance): skip every
        // view pass (count 0 for that draw only)
        m.onBeforeRender = () => {
          if (m.userData.shadowOnly) { m.userData.savedView = m.count; m.count = 0; }
        };
        m.onAfterRender = () => {
          if (m.userData.savedView !== undefined) { m.count = m.userData.savedView; m.userData.savedView = undefined; }
        };
      }
      this.group.add(m);
    }
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
    mesh.boundingBox = (mesh.boundingBox ?? new THREE.Box3()).copy(_box);
    mesh.boundingSphere = _box.getBoundingSphere(mesh.boundingSphere ?? new THREE.Sphere());
    mesh.userData.total = n;
    return mesh;
  }

  /** Apply a chunk's LOD state (see LodState). */
  private applyLod(ch: TreeChunk, s: LodState) {
    const key = (s.near ? 1 : 0) | (s.far ? 2 : 0) | (s.nearFade ? 4 : 0) | (s.farFade ? 8 : 0) | (s.nearCut ? 16 : 0) | (s.farCut ? 32 : 0) |
      (s.micro ? 64 : 0) | (s.nearCast ? 128 : 0) | (s.farCast ? 256 : 0) | (Math.round(s.keep * 20) << 10);
    if (key === ch.stateKey) return;
    ch.stateKey = key;
    ch.state = s === FRESH_STATE ? FRESH_STATE : { ...s };
    ch.isNear = s.near;
    ch.micro = s.micro;
    const cast = this.castShadows;
    for (const m of ch.near) {
      if (!m) continue;
      m.visible = s.near && m.count > 0;
      m.castShadow = cast && s.nearCast;
      m.material = s.nearFade ? this.matNearFade : this.material;
      m.customDepthMaterial = this.depthFor(true, s.nearFade, s.nearCut);
    }
    const mg = s.micro ? getMicroImpostorGeometries() : null;
    // impostors past the shadow switch distance cast shadows even where the view still shows near models
    const shadowOnly = !s.far && cast && s.farCast;
    for (let i = 0; i < 2; i++) {
      const m = ch.far[i];
      if (!m) continue;
      const tot = ch.farTotal[i];
      m.count = Math.max(0, Math.min(tot, Math.ceil(tot * s.keep)));
      m.userData.keep = s.keep;
      m.userData.shadowOnly = shadowOnly;
      m.visible = (s.far || shadowOnly) && m.count > 0;
      m.castShadow = cast && s.farCast;
      m.material = s.farFade ? this.matFarFade : this.materialFar;
      m.customDepthMaterial = this.depthFor(false, s.farFade, s.farCut);
      m.geometry = mg ? (i === 0 ? mg.broad : mg.conifer) : (m.userData.regularGeo as THREE.BufferGeometry);
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
    const lod = this.lodDistance;
    const w = lod * (this.a2c ? this.fadeBand : this.fadeBandDither), jit = w * 0.8;
    const fs = lod - w, fe = lod + w;
    // shadow switch distance: near models cast up to sc, impostors from sc on (per instance, same jitter as the fade)
    const sc = lod * THREE.MathUtils.clamp(this.shadowLodFrac, 0.2, 1);
    this.fadeU.uTreeCam.value.copy(cp);
    this.fadeU.uTreeFade.value.set(fs, fe, jit, sc);
    const lo = fs - jit * 0.5, hi = fe + jit * 0.5;
    const cutLo = sc - jit * 0.5, cutHi = sc + jit * 0.5;
    const st = this.lodScratch;
    // projected radius of a typical (3.5 m) tree: px = r / d * H / (2 tan(fov / 2))
    const K = (3.5 * this.viewHeight) / (2 * Math.tan((this.viewFov * Math.PI) / 360));
    for (const ch of this.chunks) {
      ch.box.clampPoint(cp, _v);
      const dN = _v.distanceTo(cp);
      const b = ch.box;
      const fx = Math.max(Math.abs(cp.x - b.min.x), Math.abs(cp.x - b.max.x));
      const fy = Math.max(Math.abs(cp.y - b.min.y), Math.abs(cp.y - b.max.y));
      const fz = Math.max(Math.abs(cp.z - b.min.z), Math.abs(cp.z - b.max.z));
      const dF = Math.sqrt(fx * fx + fy * fy + fz * fz);
      const near = dN < hi, far = dF > lo;
      // density fade for far chunks (keep a random subset)
      const keep = dN < lod ? 1 : Math.max(0.3, Math.min(1, 1.25 - (dN - lod) / 7000));
      const q = Math.round(keep * 20) / 20;
      const px = K / Math.max(dN, 1);
      const micro = ch.micro ? px < this.microPixels * 1.15 : px < this.microPixels * 0.87;
      st.near = near;
      st.far = far;
      st.nearFade = near && dF > lo;
      st.farFade = far && dN < hi;
      // shadows: a near model casts while its (jittered) distance < sc, an impostor from sc on
      st.nearCast = near && dN < cutHi;
      st.farCast = dF > cutLo;
      st.nearCut = st.nearCast && dF > cutLo;
      st.farCut = st.farCast && dN < cutHi;
      st.keep = q;
      st.micro = micro && !near;
      this.applyLod(ch, st);
    }
    // outer ring: built after the map's chunks, one sector per frame; density fade + micro impostors by distance
    if ((this.ringGen || this.ringQueue.length) && !this.dirty.size) this.ringStep(48);
    const mg = getMicroImpostorGeometries();
    for (let i = 0; i < this.ring.length; i++) {
      const m = this.ring[i];
      if (!m) continue;
      const tot = (m.userData.ringCount as number | undefined) ?? 0;
      m.visible = tot > 0;
      if (!tot) continue;
      m.boundingBox!.clampPoint(cp, _v);
      const dN = _v.distanceTo(cp);
      const keep = dN < lod ? 1 : Math.max(0.3, Math.min(1, 1.25 - (dN - lod) / 7000));
      m.count = Math.max(1, Math.ceil(tot * Math.round(keep * 20) / 20));
      const geo = K / Math.max(dN, 1) < this.microPixels * 0.87 ? (i & 1 ? mg.conifer : mg.broad) : (m.userData.regularGeo as THREE.BufferGeometry);
      if (m.geometry !== geo) m.geometry = geo;
    }
  }

  /** synchronous full rebuild (e.g. before a capture) */
  flush() {
    for (const id of this.dirty) this.buildChunk(id);
    this.dirty.clear();
    while (this.ringGen || this.ringQueue.length) this.ringStep(Infinity);
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

  /**
   * Outer ring candidates of one sector (once per map, density or edge-tree change): trees wherever the terrain shader
   * paints its outside forests (the map's edge forests fading into noise forests over the first 3% of the map size),
   * thinning out toward the horizon; no water / beaches. Per tree: x, ground height, z, kind random, scale random,
   * yaw, colour jitter. Resumable: generates at most `rows` grid rows per call (spread over frames) and returns true
   * once the sector is complete; forest-free 4 x 4-cell blocks are skipped with one mask test.
   */
  private ringCandidates(k: number, rows = Infinity): boolean {
    const st = this.state, N = st.size, W = N * CELL_SIZE, R = this.ringWidth;
    const [ix, iz] = RING_SECTORS[k];
    const span = (i: number): [number, number] => (i === 0 ? [-R, 0] : i === 1 ? [0, W] : [W, W + R]);
    const [x0, x1] = span(ix), [z0, z1] = span(iz);
    const seed = this.seed;
    const noise = getNoiseTexture().image.data as Uint8Array;
    const g = RING_GRID;
    const gx0 = Math.floor(x0 / g), gx1 = Math.ceil(x1 / g), gz1 = Math.ceil(z1 / g);
    let gen = this.ringGen;
    if (!gen || gen.k !== k) gen = this.ringGen = { k, gz: Math.floor(z0 / g), n: 0 };
    if (R <= 0 || this.density <= 0) gen.gz = gz1;
    let buf = this.ringCand[k] ?? new Float32Array(7 * 1024);
    let n = gen.n;
    const mask = (px: number, pz: number) => _sstep(0.6, 0.74, sampleNoise(noise, px / 3100, pz / 3100, 1) * 0.6 + sampleNoise(noise, px / 520, pz / 520, 0) * 0.5);
    const weights = new Array(this.species.length).fill(0);
    for (let done = 0; gen.gz < gz1 && done < rows && n < RING_CAP; gen.gz += 4, done += 4) {
      const bz = gen.gz;
      for (let bx = gx0; bx < gx1; bx += 4) {
        // block test at its centre: well outside the map and the noise far below the forest threshold (the mask varies
        // over >= ~100 m, a block is 40 m) -> no tree in it
        const cx = (bx + 2) * g, cz = (bz + 2) * g;
        const cdx = cx < 0 ? -cx : cx > W ? cx - W : 0, cdz = cz < 0 ? -cz : cz > W ? cz - W : 0;
        if (Math.max(cdx, cdz) > 0.03 * W + 40 && sampleNoise(noise, cx / 3100, cz / 3100, 1) * 0.6 + sampleNoise(noise, cx / 520, cz / 520, 0) * 0.5 < 0.47) continue;
        for (let gz = bz; gz < Math.min(gz1, bz + 4); gz++) {
          for (let gx = bx; gx < Math.min(gx1, bx + 4); gx++) {
            const px = (gx + 0.1 + 0.8 * hash2(gx, gz, seed + 301)) * g, pz = (gz + 0.1 + 0.8 * hash2(gz, gx, seed + 307)) * g;
            if (px < x0 || px >= x1 || pz < z0 || pz >= z1) continue;
            const dx = px < 0 ? -px : px > W ? px - W : 0, dz = pz < 0 ? -pz : pz > W ? pz - W : 0;
            const dist = Math.sqrt(dx * dx + dz * dz);
            // (the band next to the map belongs to the edge chunks' full trees)
            if (Math.max(dx, dz) < RING_EDGE_CELLS * CELL_SIZE || dist > R) continue;
            // forest mask of terrainShader beyond the map: the clamped tree texture fades into the noise forests
            const outside = _sstep(0, 0.03, Math.max(dx, dz) / W);
            let trees = outside < 1 ? this.edgeTrees(px, pz) * (1 - outside) : 0;
            if (outside > 0) trees += outside * 0.65 * mask(px, pz);
            const forest = _sstep(0.03, 0.55, trees);
            // thinner toward the horizon (hazy 1-2 px trees there) and fading out before ringWidth (no hard line where the
            // impostors stop), scaled by the quality density
            const p = forest * this.density * (1 - 0.7 * _sstep(300, 0.8 * R, dist)) * (1 - _sstep(0.8 * R, R, dist));
            if (p <= 0.01 || hash2(gx * 3 + 1, gz * 5 - 2, seed + 311) >= p) continue;
            const h = this.terrain.worldHeight(px, pz);
            if (h < 1.6) continue;
            // species (season independent; shrubs and rocks are too small out there)
            const sp = this.pickSpecies(Math.floor(px / CELL_SIZE), Math.floor(pz / CELL_SIZE), h, 0, hash2(gx * 5 + 3, gz * 3 - 1, seed + 313), weights);
            const sid = this.species[sp].id;
            if (sid === 'bush' || sid === 'rock') continue;
            if ((n + 1) * 7 > buf.length) {
              const nb = new Float32Array(buf.length * 2);
              nb.set(buf);
              buf = nb;
            }
            const o = n * 7;
            buf[o] = px; buf[o + 1] = h; buf[o + 2] = pz;
            buf[o + 3] = sp;
            buf[o + 4] = hash2(gx + 11, gz - 13, seed + 317);
            buf[o + 5] = hash2(gx - 17, gz + 19, seed + 331) * Math.PI * 2;
            buf[o + 6] = 0.9 + 0.2 * hash2(gx + 23, gz * 2 + 1, seed + 337);
            n++;
          }
        }
      }
    }
    gen.n = n;
    this.ringCand[k] = buf;
    this.ringCandN[k] = n;
    if (gen.gz < gz1 && n < RING_CAP) return false;
    this.ringGen = null;
    return true;
  }

  /** mark ring sector k for new candidates (restarts a generation in progress) and a refill */
  private ringRestale(k: number): void {
    this.ringStale.add(k);
    if (this.ringGen?.k === k) this.ringGen = null;
    if (!this.ringQueue.includes(k)) this.ringQueue.push(k);
  }

  /** one step of the outer ring (re)build: a slice of candidate rows, or a refill of a sector's meshes */
  private ringStep(rows: number): void {
    if (this.ringGen) {
      const k = this.ringGen.k;
      if (this.ringCandidates(k, rows)) this.fillRing(k);
      return;
    }
    const k = this.ringQueue.shift();
    if (k === undefined) return;
    if (this.ringStale.has(k)) {
      this.ringStale.delete(k);
      if (this.ringCandidates(k, rows)) this.fillRing(k);
    } else this.fillRing(k);
  }

  /**
   * (Re)fill one outer ring sector from its candidates: same species mix, seasons (kind per candidate) and colours as
   * the map's own far LOD, no shrubs or rocks; impostors only (the camera never gets close), no shadows.
   */
  private fillRing(k: number) {
    const buf = this.ringCand[k] ?? new Float32Array(0), n = this.ringCand[k] ? this.ringCandN[k] : 0;
    this.farCount[0] = this.farCount[1] = 0;
    const seed = this.seed;
    for (let i = 0; i < n; i++) {
      const o = i * 7;
      const px = buf[o], h = buf[o + 1], pz = buf[o + 2];
      const kind = this.kinds[this.kindOf(buf[o + 3], Math.floor(px / CELL_SIZE), Math.floor(pz / CELL_SIZE))];
      const sp = this.species[kind.species];
      const [s0, s1] = sp.scale ?? [0.72, 1.18];
      const s = (s0 + (s1 - s0) * buf[o + 4]) * 1.1;
      const c = Math.cos(buf[o + 5]), sn = Math.sin(buf[o + 5]);
      const fc = kind.conifer ? 1 : 0;
      const fn = this.farCount[fc];
      this.ensureFar(fc, fn + 1);
      const f = this.farScratch[fc];
      const fo = fn * 16;
      const sxz = (kind.radius / 0.42) * s * 0.92 * kind.impR, sy = kind.height * s;
      f[fo] = c * sxz; f[fo + 1] = 0; f[fo + 2] = -sn * sxz; f[fo + 3] = 0;
      f[fo + 4] = 0; f[fo + 5] = sy; f[fo + 6] = 0; f[fo + 7] = 0;
      f[fo + 8] = sn * sxz; f[fo + 9] = 0; f[fo + 10] = c * sxz; f[fo + 11] = 0;
      f[fo + 12] = px; f[fo + 13] = h - 0.15; f[fo + 14] = pz; f[fo + 15] = 1;
      const cv = buf[o + 6];
      const col = this.farColor[fc];
      col[fn * 3] = kind.color.r * cv;
      col[fn * 3 + 1] = kind.color.g * cv;
      col[fn * 3 + 2] = kind.color.b * cv;
      this.farCount[fc] = fn + 1;
    }
    const imp = getImpostorGeometries();
    for (let fc = 0; fc < 2; fc++) {
      const cnt = this.farCount[fc], f = this.farScratch[fc], col = this.farColor[fc];
      // shuffle: a prefix is a uniform random subset (density fade with distance)
      for (let i = cnt - 1; i > 0; i--) {
        const j = Math.floor(hash2(i, k, seed + 353 + fc) * (i + 1));
        if (j === i) continue;
        for (let q = 0; q < 16; q++) { const t = f[i * 16 + q]; f[i * 16 + q] = f[j * 16 + q]; f[j * 16 + q] = t; }
        for (let q = 0; q < 3; q++) { const t = col[i * 3 + q]; col[i * 3 + q] = col[j * 3 + q]; col[j * 3 + q] = t; }
      }
      const idx = k * 2 + fc;
      const old = this.ring[idx];
      const prev = (old?.userData.ringCount as number | undefined) ?? 0;
      const m = this.fill(old, fc ? imp.conifer : imp.broad, f, col, cnt, null, false);
      if (m) {
        m.name = 'trees-ring';
        m.castShadow = false;
        m.userData.ringCount = cnt;
      }
      this.ring[idx] = m;
      this.ringInstances += cnt - prev;
    }
  }

  private disposeChunk(c: TreeChunk) {
    for (const m of [...c.near, ...c.far]) {
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
