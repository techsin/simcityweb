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
 * Far chunks whose trees project to ~1-2 px swap to micro impostors (3-6 tris); impostors only cast shadows into
 * cascades with texels <= impostorShadowTexel (they are sub-texel specks in the far cascade). Every mesh gets tight
 * bounds from its instances (shadow cascades cull by the real extent, not the 512 m chunk).
 * Placement is deterministic per cell (hash of cell + seed), so rebuilding a chunk after an edit never moves
 * unaffected trees. Cells with network / buildings / zones / power lines / water get no trees.
 * Seasons: deciduous species (nat_season.ts) show autumn / bare / blossom model variants for the month's fraction of
 * trees (per cell); conifers stay green, darker in winter (shared foliage shader), and every tree above the terrain's
 * seasonal snow line is snow-dusted (same line + noise as the terrain). Impostors get metric object coordinates in the
 * shader, so the shared foliage shading treats them like the model they stand for. Impostors of bare (see-through
 * twig) models are drawn see-through too: their crowns cover ~30-60% of their pixels (alpha-to-coverage with MSAA, a
 * dither anchored to the tree without), evenly lit, so the forest floor shows between bare trees as it does between
 * the twigs of the near models; in winter conifer impostors are a little taller and darker (BARE_* / SEASON_*).
 * Runtime chunk rebuilds (a season, edits) run nearest-first within buildBudgetMs per frame (at least one), so the view
 * fills in first. A load (constructor, reset, quality change) builds every chunk at once, as part of the load (tens of
 * ms cold on a dense 256 map), and the load's first LOAD_FRAMES frames still build every chunk dirtied after it (the
 * load's own later work: a pre-run of the sim, a demo's edits) at once: nothing trickles into the first frames the
 * player moves the camera in.
 * Edge band: the map's edge chunks continue their forests as full trees over RING_EDGE_CELLS virtual cells past the
 * edge, thinning toward the outer ring's density over its outer cells. Band trees are a cheaper LOD class than the
 * map's own (they stand outside the playable area): a band tree is a full model only up to shadowLodFrac x the LOD
 * distances (the fade programs scale a band tree's distance by 1 / shadowLodFrac, uTreeBand; it casts its model's
 * shadow while drawn as one, the shadow switch being at that same distance), beyond that an impostor that casts no
 * shadow, drawn by the edge chunk's own band impostor meshes (bfar: their own bounds, LOD state and density, see
 * bandBox / applyLod), so the map trees' LOD and shadows stay exactly those of a map without a band. In the near
 * meshes a kind's band trees follow its map trees, ordered by the distance to the map centre, so a near edge chunk only
 * submits the band trees within the view's reach (trimBand).
 * Outer ring (far view): beyond the map edge (the terrain's landscape skirt) impostor-only trees stand on the terrain
 * shader's outside forests, out to ringWidth, in 8 sectors (see the RING_* constants and ringStep). Medium quality and
 * up (lodDistance >= RING_MIN_LOD); low quality has neither the ring nor the edge band:
 *   - candidates are a pure function of the noise texture, the outer terrain and the seed (the map's own cells only
 *     reach the edge band), generated and filled during the load (constructor / reset / a quality that turns the ring
 *     on: flushRing, tens of ms; work queued between the load and its first frame, as by a month change of a sim
 *     pre-run, is finished by that first frame), never on the frames a player moves the camera in; a season / density /
 *     map-cell change only refills, and only a terrain edit on the map border regenerates the sectors on that side - that
 *     runtime work runs in ~1 ms slices on calm frames (still or slowly drifting camera, see RING_CALM_*), or one slice
 *     every RING_SLICE_EVERY frames once a moving camera has waited RING_MAX_WAIT frames;
 *   - each tree is a regular impostor within ~lodDistance of the camera (its own switch distance, see RING_SWITCH_*)
 *     and a micro impostor beyond, the two complementary per tree in the vertex shaders: the near pair (broadleaf /
 *     conifer impostors, TREE_RING_NEAR) holds a sector's trees ordered by their depth beyond the map edge, and a
 *     camera inside the map at e metres from the sector's edge(s) can only reach the trees up to depth (switch - e)
 *     (a corner sector: the nearer of its two arms), and the view's ground footprint bounds that depth too: it submits
 *     that prefix (none from the middle of a large map), culled by the prefix's own bounds (ringNearBox), so a corner
 *     sector beside a camera that looks along one of its edges draws nothing; the far blocks (TREE_RING: the micro
 *     broadleaf's upper half, 3 tris, as high cameras see it; conifers stretch it onto their pyramid and carry an
 *     evergreen flag) are RING_SUB block meshes per sector (its quarters), each frustum-culled by its own box (for a low
 *     camera near the edge also by its trees' boxes per cell of a grid over it, ringCellBox) and ordered
 *     by the per-tree thinning random (ringRand): their vertex shader thins the trees with their distance and fades them
 *     with the camera height (hidden from low cameras inside the city, where the city and the edge band hide them
 *     anyway), and each block only submits the prefix of its trees that its nearest point's distance can keep; no
 *     shadows. A high camera that draws many far blocks (the far views) draws them as one mesh instead (ringAll: every
 *     block's trees in one order by that random, the prefix of the largest keep, RING_ALL_K). The per-frame pass
 *     (updateRingView) re-derives all of it only when the view or the ring's data changed, its prefix searches starting
 *     from the last frame's; the load's warm-up draws every ring and edge band mesh the load frame leaves hidden once,
 *     with one instance (warmMeshes), so none uploads its instance data on its first sight;
 *   - next to a sector's map edge(s) (within RING_EDGE_NEAR x lodDistance) the ring is the horizon at any height: the
 *     sector's far blocks skip the camera height fade, and a low camera (below ringFadeHeight) sees the sector at a
 *     grazing angle, where the micro upper half reads as a small pale cone floating at 63% of the tree's height: its
 *     trees stay regular impostors out to ringLowSwitch x lodDistance and the far blocks beyond show mini round crowns
 *     on trunks, as dark as the impostors in front of them (ringLow, unfolding from the upper half with the low-camera
 *     weight; the crown over its own, higher camera height band, ringShapeHeight: cameras up to ~350 m still see those
 *     far trees at a grazing angle) - per sector on the CPU, per tree in the shaders, eased in with the camera height and
 *     the distance to the edge, so nothing pops.
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../core/constants';
import { Noise2D, hash2 } from '../../core/rng';
import type { CellRect } from '../../core/events';
import { Surf, type Climate } from '../../core/types';
import { MANIFEST_BY_ID } from '../../assets/manifest';
import { getBuildingMaterial, patchSurfaceMaterial } from '../../assets/materials';
import { getNoiseTexture } from './textures';
import type { CityState } from '../../sim/CityState';
import { MICRO_WAIST_R, MICRO_WAIST_Y, RING_LOW_APEX, RING_LOW_R, getImpostorGeometries, getMicroImpostorGeometries, getNatureGeometry, natureStats } from './fallbackTrees';
import { TerrainRenderer } from './TerrainRenderer';
import { loadWarm, shadowCasters, type ShadowReceiver } from './Shadows';
import { SEASONAL_TREES, drawnTreeMix, seasonalVariant, type SeasonMix } from '../../assets/builders/nat_season';
import { setLotTwigStrip } from '../../assets/builders/winterTwigs';

const CHUNK = 32;
/** instances per cell for density 0..4 */
const DENSITY_COUNT = [0, 1.1, 2.3, 3.8, 5.6];
/** update() calls after a load (constructor / reset) that still build every dirty chunk at once: the frames a page
 *  renders while it comes up (the game's while its loading veil fades, a demo's before it is ready). The load builds
 *  every chunk itself; these frames take what the load's own later work dirtied (a pre-run of the sim, a demo's
 *  edits), so none of it is left to the first frames the player moves the camera in */
const LOAD_FRAMES = 3;
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
/** far ring blocks per sector (its 2 x 2 quarters): one mesh each, culled by its own bounds (the sectors span ~2.6 km;
 *  a high camera looking down sees a few of their quarters) */
const RING_SUB = 4;
/** floats per ring candidate: x, ground height, z, species, kind random, yaw, colour jitter, density threshold */
const RING_STRIDE = 8;
/** the map's edge chunks continue their forests as full trees this many cells beyond the edge; the ring starts there */
const RING_EDGE_CELLS = 10;
/** far-ring conifers: the micro broadleaf double pyramid's upper half (waist r 0.46 at y 0.63, apex 1) stretched
 *  onto the micro conifer pyramid (base r 0.4 at y 0.1, apex 1); its lower half ends up below the ground */
const RING_CON_A = 0.9 / 0.37;
const RING_CON_B = 1 - RING_CON_A;
const RING_CON_R = 0.4 / 0.46;
/** the outer ring and the edge band need a far tree LOD distance to pay off: lower qualities (low: 460 m) skip both */
const RING_MIN_LOD = 560;
/** runtime ring work (season / density refills, border-edit regenerations: the load generates the ring at once) runs
 *  in slices on calm frames: the camera moved at most RING_CALM_MOVE x its height above the ground (summed axis deltas)
 *  in each of the last RING_CALM_FRAMES frames (still or slowly drifting: not zooming, cutting, panning or orbiting
 *  fast; the frames right after a cut, when the city's LODs catch up, are skipped too); a camera that keeps moving gets
 *  one slice every RING_SLICE_EVERY frames once the work has waited RING_MAX_WAIT frames */
const RING_CALM_MOVE = 0.001;
const RING_CALM_FRAMES = 8;
const RING_MAX_WAIT = 240;
const RING_SLICE_EVERY = 8;
/** the edge band's impostors thin out by this extra share from 1 to 2.5 x lodDistance (they ease into the outer ring,
 *  about half the map forests' density) */
const BAND_THIN = 0.4;
/** a ring tree's switch from its regular impostor (near pair) to its micro impostor (far blocks): at lodDistance x
 *  (RING_SWITCH_LO + RING_SWITCH_SPAN x a per-tree random), the same in both programs (complementary per tree) */
const RING_SWITCH_LO = 0.94;
const RING_SWITCH_SPAN = 0.12;
/** a camera within RING_EDGE_NEAR x lodDistance of a sector's map edge(s) (easing out by RING_SWITCH_LO x) sees that
 *  sector as the horizon at any height: its far blocks skip the camera height fade, and a low camera (below
 *  ringFadeHeight) gets the low-camera look there (ringLowSwitch, ringLowShape; see updateRingView) */
const RING_EDGE_NEAR = 0.6;
/** ... and the far blocks' mini crown (ringLow; see ringShapeHeight) reaches farther from the edge: whole while the
 *  camera is within RING_SWITCH_LO x lodDistance of the sector's edge(s), easing out by this x (a camera ~700 m inside a
 *  corner at HIGH still sees that ring's nearest copses at a grazing angle, ~1 km away) */
const RING_CROWN_FAR = 1.2;
/** the low cameras' mini crown of a broadleaf (ringLow, RING_LOW_VERT; past the low-camera switch distance): its leafy
 *  colour this much darker than the high cameras' upper half, so the ring past the switch reads as the same forest as
 *  the regular impostors in front of it (its sun-facing upper faces catch the full sun and sky; in the low edge views
 *  0.72 read darker than those impostors, 0.8 matches them) */
const RING_LOW_TINT = 0.8;
/** the low-camera weight at which the far blocks' mini crown is whole (RING_LOW_VERT eases its unfolding in over [0, this]) */
const RING_LOW_FULL = 0.4;
/** horizontal half-extent of a far block tree's shape (`top`, ringLow) in units of its instance's xz scale */
const RING_BOX_R = Math.max(0.5, RING_LOW_R);
/** the far blocks' density with the distance d from the camera (the vertex shader per tree, the CPU per block at its
 *  nearest point): clamp(RING_KEEP_A - (d - lodDistance) / RING_KEEP_D, RING_KEEP_MIN, 1) of the trees, x the camera
 *  height fade */
const RING_KEEP_A = 1.2;
const RING_KEEP_D = 5500;
const RING_KEEP_MIN = 0.3;
/** the near pairs' view bound (updateRingView): a ring tree farther past its sector's edge than the deepest point of the
 *  view's ground footprint by more than this (m: crowns, and trees standing above the footprint's plane) is out of view */
const RING_VIS_PAD = 40;
/** ringViewDirs scratch: the view's 4 corner ray directions, the gap in their horizontal directions, their angles; the
 *  view's frustum (updateRingView) */
const _rvd = new Float64Array(12), _rvr = new Float64Array(3), _rva = new Float64Array(4);
const _rv3 = new THREE.Vector3();
const _rvF = new THREE.Frustum(), _rvM = new THREE.Matrix4(), _rvB = new THREE.Box3(), _rvP = new THREE.Vector3(), _rvQ = new THREE.Vector3();
/** a near pair keeps the bounds of its depth-ordered prefixes every this many slots (ringNearBox: the bounds of what it
 *  draws, see updateRingView) */
const RING_BOX_STEP = 32;
/** a far block (a sector quarter, ~1.3 km square, its copses scattered over it) also keeps the bounds of its trees in
 *  each cell of a RING_CELLS x RING_CELLS grid over its box (ringCellBox): a low camera near the sector's edge(s) (the
 *  low-camera weight on) draws it only if one of them is in the frustum (its view along the edge meets the corners of
 *  the quarters beside it, where no tree stands: HIGH edge_t25 drew ~2.9k of its 3.7k far block trees with none of them
 *  in view); higher cameras, which see the blocks from above, and cameras away from the edges skip the test */
const RING_CELLS = 4;
/** the far ring's all-in-one mesh (ringAll, see updateRingView): a high camera draws it instead of its visible far blocks
 *  when that costs at most this many more submitted trees per draw call saved (trees past their own keep that its looser
 *  prefix submits, which the vertex shader drops: ~4 vertices each, against a draw call's main-thread setup). The far
 *  views (the bench's far orbit: ~18 blocks, 5.6k trees -> 1 draw, 8.4k trees) take it; default, zoom and edge views,
 *  which see a few blocks, keep the blocks */
const RING_ALL_K = 200;
/** a nature model whose crown is at least this see-through (natureStats.open) has a see-through impostor */
const BARE_OPEN = 0.3;
/** winter conifer impostors: taller (the needle tiers' tips) and darker than the summer tint (they are what reads of
 *  an evergreen among the see-through bare crowns from afar) */
const WINTER_CONIFER_H = 1.1;
const WINTER_CONIFER_R = 1.04;
const WINTER_CONIFER_TINT = 0.84;

/** month mix of the forest trees: the drawn trees' mix (nat_season.drawnTreeMix: bare share x BARE_ALL, so mid-winter
 *  leaves every deciduous tree bare, as the street trees and the Foliage shader's lot crowns) */
function forestMix(month: number, climate: string): SeasonMix {
  return drawnTreeMix(month, climate);
}

const _sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The number of entries of the ascending a[0, n) below v (atMost: at most v), searched from `hint` (the last frame's
 * answer): a moving camera's prefixes move by a few entries per frame, so the search reads the cache line or two around
 * the hint (galloping out from it) instead of a binary search's log2(n) scattered ones. The same answer as a binary search.
 */
export function prefixFrom(a: Float32Array, n: number, v: number, atMost: boolean, hint: number): number {
  let h = hint < 0 ? 0 : hint > n ? n : hint;
  let lo: number, hi: number;
  if (h < n && (atMost ? a[h] <= v : a[h] < v)) {
    // the answer is past h: double the step until an entry fails
    lo = h + 1;
    let s = 1;
    hi = lo;
    while (hi < n && (atMost ? a[hi] <= v : a[hi] < v)) { lo = hi + 1; hi = lo + s; s *= 2; }
    if (hi > n) hi = n;
  } else if (h > 0 && !(atMost ? a[h - 1] <= v : a[h - 1] < v)) {
    // the answer is before h: double the step back until an entry passes
    hi = h - 1;
    let s = 1;
    lo = hi - 1;
    while (lo >= 0 && !(atMost ? a[lo] <= v : a[lo] < v)) { hi = lo; lo = hi - s; s *= 2; }
    lo = lo < 0 ? 0 : lo + 1;
  } else return h;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (atMost ? a[mid] <= v : a[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** distance from (px, py, pz) to the box at offset o of b (min x y z, max x y z) */
function boxDist(b: Float64Array, o: number, px: number, py: number, pz: number): number {
  const dx = px < b[o] ? b[o] - px : px > b[o + 3] ? px - b[o + 3] : 0;
  const dy = py < b[o + 1] ? b[o + 1] - py : py > b[o + 4] ? py - b[o + 4] : 0;
  const dz = pz < b[o + 2] ? b[o + 2] - pz : pz > b[o + 5] ? pz - b[o + 5] : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const _rf = new Float32Array(1), _ru = new Uint32Array(_rf.buffer);
/**
 * The far outer ring's per-tree thinning random in [0, 1) from the tree's (float32) instance position: an integer hash
 * of the position's bits, bit-exact with the vertex shader's (RING_RAND), so the CPU can order a block's trees by it and
 * submit only the prefix the shader can keep.
 */
export function ringRand(x: number, z: number): number {
  _rf[0] = x;
  const ux = _ru[0];
  _rf[0] = z;
  const uz = _ru[0];
  let h = Math.imul(ux, 0x9e3779b1) ^ Math.imul(uz, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 8) / 16777216;
}
const RING_RAND = /* glsl */ `
  uint _h = floatBitsToUint(instanceMatrix[3].x) * 0x9E3779B1u ^ floatBitsToUint(instanceMatrix[3].z) * 0x85EBCA77u;
  _h ^= _h >> 15u;
  _h *= 0x2C1B3C6Du;
  _h ^= _h >> 12u;
  _h *= 0x297A2D39u;
  _h ^= _h >> 15u;
  float _r = float(_h >> 8u) * (1.0 / 16777216.0);
`;
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

/** LOD inputs of the frame for lodKey: lo, hi (near / far fade band with jitter), lodDistance, cutLo, cutHi (shadow
 *  switch band), K (projected-size factor of a typical tree), microIn, microOut */
const _lodP = new Float64Array(8);
/**
 * LOD state key (L_*) of the trees in box b (offset o: min x y z, max x y z) seen from (px, py, pz). `s` scales the
 * distances of the view's near / impostor choice (1 for the map's trees, 1 / shadowLodFrac for the edge band's, which
 * switch to impostors earlier); shadows, density and the micro switch use the real distances. `wasMicro`: the
 * current micro state (hysteresis); `impCast`: impostors may cast (not the band's); `thin`: the extra share of
 * impostors dropped from 1 to 2.5 x lodDistance (the band's: it eases into the sparser outer ring).
 */
function lodKey(b: Float64Array, o: number, px: number, py: number, pz: number, s: number, wasMicro: boolean, impCast: boolean, thin = 0): number {
  const P = _lodP, lo = P[0], hi = P[1], lod = P[2], cutLo = P[3], cutHi = P[4];
  const x0 = b[o], y0 = b[o + 1], z0 = b[o + 2], x1 = b[o + 3], y1 = b[o + 4], z1 = b[o + 5];
  // nearest / farthest distance from the camera to the box
  const nx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
  const ny = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
  const nz = pz < z0 ? z0 - pz : pz > z1 ? pz - z1 : 0;
  const dN = Math.sqrt(nx * nx + ny * ny + nz * nz);
  const ax = px - x0, bx = x1 - px, ay = py - y0, by = y1 - py, az = pz - z0, bz = z1 - pz;
  const fx = (ax < 0 ? -ax : ax) > (bx < 0 ? -bx : bx) ? ax : bx;
  const fy = (ay < 0 ? -ay : ay) > (by < 0 ? -by : by) ? ay : by;
  const fz = (az < 0 ? -az : az) > (bz < 0 ? -bz : bz) ? az : bz;
  const dF = Math.sqrt(fx * fx + fy * fy + fz * fz);
  const sN = dN * s, sF = dF * s;
  const near = sN < hi, far = sF > lo;
  // density fade for far trees (keep a random subset), in 1/20 steps
  let keep = dN < lod ? 1 : 1.25 - (dN - lod) / 7000;
  keep = keep < 0.3 ? 0.3 : keep > 1 ? 1 : keep;
  if (thin > 0) keep *= 1 - thin * _sstep(lod, lod * 2.5, dN);
  const tpx = P[5] / (dN > 1 ? dN : 1);
  const micro = !near && (wasMicro ? tpx < P[7] : tpx < P[6]);
  // shadows: a near model casts while its (jittered) distance < the shadow switch, an impostor from there on
  const nearCast = near && dN < cutHi, farCast = impCast && dF > cutLo;
  return (near ? L_NEAR : 0) | (far ? L_FAR : 0) | (near && sF > lo ? L_NEAR_FADE : 0) | (far && sN < hi ? L_FAR_FADE : 0) |
    (nearCast && dF > cutLo ? L_NEAR_CUT : 0) | (farCast && dN < cutHi ? L_FAR_CUT : 0) | (micro ? L_MICRO : 0) |
    (nearCast ? L_NEAR_CAST : 0) | (farCast ? L_FAR_CAST : 0) | (Math.round(keep * 20) << L_KEEP_SHIFT);
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
  /** drawn once (one instance, so its instance data uploads now: see TreeRenderer.warmDraw), then back to its own state
   *  (visible / count / frustum test: warmVis / warmCount / warmCull) after that draw */
  warmOnce = false;
  warmVis = false;
  warmCount = 0;
  warmCull = true;
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
    if (this.warmOnce) this.warmDone();
  }

  /** a pending warm draw (warmOnce) is over: the mesh's own state back */
  warmDone(): void {
    this.warmOnce = false;
    this.visible = this.warmVis;
    this.count = this.warmCount;
    this.frustumCulled = this.warmCull;
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
  /** impostor radius factor (see-through bare crowns: a little inside the twig tips) */
  impR: number;
  /** see-through (bare twig) crown: drawn as a see-through impostor (BARE_*; negative instance red) */
  bare: boolean;
}

interface TreeChunk {
  cx: number;
  cz: number;
  near: (TreeMesh | null)[];
  /** impostors: 0 broadleaf, 1 conifer, 2 both as micro impostors (one draw for far chunks; see microMerge) */
  far: (TreeMesh | null)[];
  farTotal: [number, number, number];
  /** the map's own cells of the chunk (x / z: its 32 x 32 cells; y: the placed map trees) */
  box: THREE.Box3;
  sphere: THREE.Sphere;
  /** near meshes drawn (map trees and / or band trees) */
  isNear: boolean;
  total: number;
  /** LOD state keys last applied (map trees: stateKey, band trees: bandKey; skip work when unchanged; -1 = re-derive)
   *  and the ones to re-apply after a rebuild */
  stateKey: number;
  lastKey: number;
  bandKey: number;
  lastBandKey: number;
  micro: boolean;
  /** edge chunks with an edge band: per kind, the near instances of the map's own cells (the band's follow, ordered by
   *  their distance to the map centre: bandD) and the total; a near mesh draws only the band trees the view can reach
   *  (see trimBand) */
  mapN: Int32Array | null;
  nearN: Int32Array | null;
  bandD: (Float32Array | null)[] | null;
  /** the band trees' impostors (like `far`: 0 broadleaf, 1 conifer, 2 merged micro; never cast shadows) and totals */
  bfar: (TreeMesh | null)[];
  bfarTotal: [number, number, number];
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
/** band trees before their first LOD selection: impostors (which never cast), full density */
const FRESH_BAND_KEY = L_FAR | (20 << L_KEEP_SHIFT);

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

/** outer ring (re)fill of one sector, in progress: candidates are written straight into its near pair's instance
 *  arrays and its micro data (uploaded / split into its far blocks once the sector is complete, so no half-refilled
 *  frame is ever drawn) */
interface RingFill {
  k: number;
  /** next candidate */
  i: number;
  /** instances written so far: 0 broadleaf, 1 conifer (near pair), 2 micro (all) */
  w: Int32Array;
  /** slot of each near pair instance (its rank by depth beyond the map edge: a camera reaches a prefix, see ringNearT)
   *  and the depths in slot order (ringNearT once the sector is complete) */
  perm: Int32Array[];
  tNear: Float32Array[];
  /** all instances written: the next steps finish the sector (near pair upload + far block order, then its far blocks'
   *  data one quarter per unit: q = the next quarter, -1 before the near pair's finish) */
  done: boolean;
  q: number;
  /** instance bounds per near mesh: min x y z, max x y z */
  bounds: Float64Array;
  dens: number;
  /** the sector's micro impostors (matrices / colours) for its far blocks */
  micro: Float32Array;
  microCol: Float32Array;
}

/** a sector's season-independent tree order (its current candidates at one density): the near pair's slot of each
 *  instance (its rank by depth beyond the map edge) with the depths in slot order, and each far block's trees (indices
 *  into the sector's micro data) ordered by their thinning random, with the sorted randoms. A season refill reuses it
 *  and only rewrites matrices / colours (no sort, no allocation); new candidates or a new density rebuild it */
interface RingOrder {
  dens: number;
  perm: Int32Array[];
  tNear: Float32Array[];
  /** per far block (RING_SUB): null until the sector's first finish at this order */
  blk: Int32Array[] | null;
  rnd: Float32Array[] | null;
}

const _box = new THREE.Box3();

// ---- LOD cross-fade shader snippets (near models fade out / impostors fade in over the band)
const FADE_VERT_PARS = /* glsl */ `
uniform vec3 uTreeCam;
uniform vec4 uTreeFade;
uniform vec2 uTreeBand;
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
  ${depth ? '' : `// edge band trees (outside the map square, uTreeBand.x = its size) switch to their impostors at 1 / uTreeBand.y of
  // the distances (= the shadow switch: the depth programs' cut below needs no scaling)
  if (uTreeBand.x > 0.0 && (min(_ip.x, _ip.z) < 0.0 || max(_ip.x, _ip.z) > uTreeBand.x)) _d *= uTreeBand.y;`}
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
/** far (impostor) programs: see-through bare crowns (BARE_*) and the far outer ring's per-tree thinning (RING_*) */
const FAR_VERT_PARS = /* glsl */ `
varying float vTreeBare;
varying vec2 vBareNdc;
#if defined(TREE_RING) || defined(TREE_RING_NEAR)
uniform vec3 uRingP;
uniform vec2 uRingQ;
// the camera's distance inside the map edge(s) a ring tree at p lies beyond (its sector's edges: the nearer of them)
float ringEdgeDist(vec3 p) {
  float ex = p.x < 0.0 ? cameraPosition.x : (p.x > uRingP.z ? uRingP.z - cameraPosition.x : 1e9);
  float ez = p.z < 0.0 ? cameraPosition.z : (p.z > uRingP.z ? uRingP.z - cameraPosition.z : 1e9);
  return min(ex, ez);
}
// a ring tree at p: 1 while the camera is within ${RING_EDGE_NEAR} x lodDistance of the map edge(s) the tree lies beyond (its
// sector's edges), easing to 0 at ${RING_SWITCH_LO} x (as the CPU's per-sector ringEdgeNear)
float ringEdgeNear(vec3 p) {
  return 1.0 - smoothstep(uRingP.x * ${RING_EDGE_NEAR.toFixed(3)}, uRingP.x * ${RING_SWITCH_LO.toFixed(3)}, ringEdgeDist(p));
}
#endif
`;
/**
 * Far ring blocks of low cameras (after begin_vertex and normal_vertex; color_vertex ran before it): with the low-camera
 * weight lw (see FAR_VERT_MAIN) the ringLow mini crown unfolds from `top` (lw = 0: its rings at the micro waist, its
 * lower apex and its trunk folded into the waist's centre, zero area) to the round crown on its trunk (RING_LOW_*), its
 * crown's normals blend from the geometry's (`top`'s on the upper fan) into the round crown's (ringLowNormal; also the
 * object normal of the foliage shading, _rlN: see FAR_VERT_MAIN) and its leafy colour darkens to RING_LOW_TINT, so a
 * broadleaf seen at a grazing angle reads as the regular impostors in front of it - a round crown on a trunk, as dark -
 * not as a lit cone floating at 63% of its height. A conifer (its stretched upper fan already is its whole pyramid)
 * keeps lw = 0. The crown's weight has its own camera height band (uRingQ.y = 1 - its fade, ringShapeHeight: a camera up
 * to ~350 m next to the edge still sees the far trees at a grazing angle); cameras above it (uRingQ.y = 0) skip it all.
 */
const RING_LOW_VERT = /* glsl */ `
#if defined(TREE_RING) && defined(USE_INSTANCING) && defined(USE_INSTANCING_COLOR)
vec3 _rlN = objectNormal;
if (uRingQ.y > 0.0) {
  float _lw = 0.0;
  // (the crown's own reach from the edge: whole within ${RING_SWITCH_LO} x lodDistance, easing out by ${RING_CROWN_FAR} x)
  if (instanceColor.b >= 0.0) _lw = uRingQ.y * (1.0 - smoothstep(uRingP.x * ${RING_SWITCH_LO.toFixed(3)}, uRingP.x * ${RING_CROWN_FAR.toFixed(3)}, ringEdgeDist((modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz)));
  // (whole by lw = ${RING_LOW_FULL}: next to the edge it unfolds while a camera descends from ~400 m to ~300 m above the
  // ground, see ringShapeHeight)
  _lw = smoothstep(0.0, ${RING_LOW_FULL.toFixed(3)}, _lw);
  bool _tk = abs(surf.x - ${Surf.Wood.toFixed(1)}) < 0.5;
  // (folded: the apex stays, every other crown vertex goes to the micro waist circle in its own direction - so the
  // upper half itself (top), which the far blocks of the sectors away from the edge draw, is left as it is)
  vec3 _f = _tk ? vec3(0.0, ${MICRO_WAIST_Y.toFixed(4)}, 0.0) : position.y > 0.999 ? position
    : vec3(position.x, 0.0, position.z) * (${MICRO_WAIST_R.toFixed(4)} / max(length(position.xz), 1e-4)) + vec3(0.0, ${MICRO_WAIST_Y.toFixed(4)}, 0.0);
  transformed = mix(_f, position, _lw);
  if (!_tk) {
    vec3 _rn = vec3(position.x * ${(1 / (RING_LOW_R * RING_LOW_R)).toFixed(6)}, (position.y - ${((1 + RING_LOW_APEX) / 2).toFixed(6)}) * ${(4 / ((1 - RING_LOW_APEX) * (1 - RING_LOW_APEX))).toFixed(6)}, position.z * ${(1 / (RING_LOW_R * RING_LOW_R)).toFixed(6)});
    _rlN = normalize(mix(objectNormal, normalize(_rn), _lw));
    // (the lighting normal as defaultnormal_vertex / normal_vertex derive it)
    vec3 _tn = _rlN / vec3(dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz), dot(instanceMatrix[1].xyz, instanceMatrix[1].xyz), dot(instanceMatrix[2].xyz, instanceMatrix[2].xyz));
    transformedNormal = normalMatrix * (mat3(instanceMatrix) * _tn);
    vNormal = normalize(transformedNormal);
    // (leafy crowns only: a bare crown's see-through twig haze keeps its own brightness)
    if (instanceColor.r >= 0.0) vColor.rgb *= 1.0 - ${(1 - RING_LOW_TINT).toFixed(3)} * _lw;
  }
}
#endif
`;
function seasonVertMain(far: boolean): string {
  return /* glsl */ `
vTreeSnow = 0.0;
${far ? 'vTreeBare = 0.0;\nvBareNdc = vec2(0.0);' : ''}
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
  ${far ? FAR_VERT_MAIN : ''}
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
/** impostor part of seasonVertMain (inside its instancing block: _sp = the tree's world position) */
const FAR_VERT_MAIN = /* glsl */ `
#ifdef TREE_RING
vObjPos = transformed;
#ifdef USE_INSTANCING_COLOR
vObjNormal = _rlN;
#endif
#endif
vObjPos *= vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
#ifdef USE_INSTANCING_COLOR
  if (instanceColor.r < 0.0) {
    // see-through bare crown (a twig model's impostor: negative instance red). Evenly lit like a twig haze: softly
    // up-facing object normals (no dark underside, no flat / box classes in the foliage shading)
    vTreeBare = 1.0;
    vColor.r = -vColor.r;
    vec2 _h = vObjNormal.xz;
    float _hl = length(_h);
    _h = _hl > 1e-3 ? _h / _hl : vec2(0.7071);
    vObjNormal = vec3(_h.x * 0.4, 0.9165, _h.y * 0.4);
    // the tree's screen position anchors its see-through dither (no crawl over the tree while the camera moves)
    vec4 _bc = projectionMatrix * viewMatrix * vec4(_sp, 1.0);
    vBareNdc = _bc.xy / max(abs(_bc.w), 1e-4);
  }
#endif
#if defined(TREE_RING) || defined(TREE_RING_NEAR)
{
${RING_RAND}
  // the tree's switch between its regular impostor (near pair) and its micro impostor (far blocks): the distance from
  // the camera to the tree's foot (a far block conifer's instance is shifted by its stretch, RING_CON_*) against a
  // per-tree switch distance - the same in both programs, so each tree is drawn by exactly one of them. A low camera
  // next to the tree's map edge (weight _lw: the camera height fade uRingP.y off, ringEdgeNear on) sees the ring at a
  // grazing angle: its switch distance moves out to uRingQ.x (regular impostors deeper into the ring)
  vec3 _ft = _sp;
#if defined(TREE_RING) && defined(USE_INSTANCING_COLOR)
  if (instanceColor.b < 0.0) _ft.y -= ${(RING_CON_B / RING_CON_A).toFixed(6)} * instanceMatrix[1][1];
#endif
  float _rd = distance(_ft, cameraPosition);
  float _ne = ringEdgeNear(_sp), _lw = (1.0 - uRingP.y) * _ne;
  float _sw = mix(uRingP.x, uRingQ.x, _lw) * (${RING_SWITCH_LO.toFixed(3)} + ${RING_SWITCH_SPAN.toFixed(3)} * fract(_r * 31.7));
#ifdef TREE_RING
  // far outer ring block: thinned with the distance per tree (its stable random, ringRand, against the keep
  // fraction, RING_KEEP_*), faded with the camera height (uRingP.y) except next to the tree's map edge, where the ring
  // is the horizon at any height; the CPU draws the prefix of the block's trees (ordered by that random) its nearest
  // point keeps
  float _keep = clamp(${RING_KEEP_A.toFixed(3)} - (_rd - uRingP.x) / ${RING_KEEP_D.toFixed(1)}, ${RING_KEEP_MIN.toFixed(3)}, 1.0) * max(uRingP.y, _ne);
  if (_r >= _keep || _rd < _sw) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#else
  if (_rd >= _sw) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#endif
}
#endif
`;
const SEASON_FRAG_PARS = /* glsl */ `
varying float vTreeSnow;
`;
const FAR_FRAG_PARS = /* glsl */ `
varying float vTreeBare;
varying vec2 vBareNdc;
uniform vec2 uBareRes;
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
/**
 * See-through bare crown (impostors of twig models): its crown covers ~40% of the pixels where the view crosses the
 * crown's middle (more twigs along a long sight line), fading to ~10% at its rim (no hard ball outline), in ~2-3 m
 * twig clumps where they resolve; the trunk stays solid. Alpha-to-coverage with MSAA (the coverage blends after the
 * resolve), else a dither anchored to the tree's screen position (denser and darker: low contrast), decorrelated from
 * the LOD fade's (complementary near / far) dither. Before alphatest_fragment (after the LOD fade's alpha).
 */
const BARE_FRAG = /* glsl */ `
if (vTreeBare > 0.5 && abs(vSurf.x - 8.0) < 0.5) {
  float _fz = abs(normalize(vNormal).z);
  vec2 _cq = vObjPos.xz * 0.35 + vObjPos.y * 0.3;
  float _cn = mix(0.5, bnoise(_cq), clamp(1.0 - length(fwidth(_cq)) * 1.6, 0.0, 1.0));
  float _cov = (0.1 + 0.3 * _fz * _fz) * (0.55 + 0.9 * _cn);
#ifdef TREE_A2C
  diffuseColor.a *= _cov;
#else
  // (a pixel dither is not averaged: twice the coverage at ~half the brightness - the same mean over the dark floor,
  // half the speckle contrast)
  _cov = min(1.0, _cov * 1.9);
  diffuseColor.rgb *= 0.55;
  vec2 _bp = gl_FragCoord.xy - floor((vBareNdc * 0.5 + 0.5) * uBareRes);
  float _bn = fract(52.9829189 * fract(dot(_bp, vec2(0.06711056, 0.00583715)) + 0.5));
  if (_bn >= _cov) discard;
#endif
}
`;
/** bare crowns: lit evenly (a twig haze, not a lit ball with a dark side): the lighting normal leans to the world up */
const BARE_NORMAL = /* glsl */ `
if (vTreeBare > 0.5) normal = normalize(mix(normal, normalize(viewMatrix[1].xyz), 0.65));
`;
/** far depth (shadow) programs: bare crowns cast a stippled shadow (~40% of their texels) */
const BARE_DEPTH_VERT_PARS = /* glsl */ `
attribute vec3 surf;
varying float vTreeBare;
`;
const BARE_DEPTH_VERT = /* glsl */ `
vTreeBare = 0.0;
#ifdef USE_INSTANCING_COLOR
  if (instanceColor.r < 0.0 && abs(surf.x - 8.0) < 0.5) vTreeBare = 1.0;
#endif
`;
const BARE_DEPTH_FRAG_PARS = /* glsl */ `
varying float vTreeBare;
`;
const BARE_DEPTH_FRAG = /* glsl */ `
if (vTreeBare > 0.5 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= 0.4) discard;
`;

/** value of a GLSL condition over `type` only (comparisons with literals, !, &&, ||, parentheses) at type = t; null
 *  if it is anything else */
function typeCond(cond: string, t: number): boolean | null {
  const tok = cond.match(/\|\||&&|<=|>=|==|!=|[<>!()]|type|\d+\.?\d*|\.\d+|\S/g) ?? [];
  let p = 0;
  const num = (s: string | undefined) => (s !== undefined && /^(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null);
  const cmp = (a: number, op: string, b: number): boolean | null =>
    op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : op === '>=' ? a >= b : op === '==' ? a === b : op === '!=' ? a !== b : null;
  const or = (): boolean | null => {
    let v = and();
    while (v !== null && tok[p] === '||') { p++; const w = and(); v = w === null ? null : v || w; }
    return v;
  };
  const and = (): boolean | null => {
    let v = unary();
    while (v !== null && tok[p] === '&&') { p++; const w = unary(); v = w === null ? null : v && w; }
    return v;
  };
  const unary = (): boolean | null => {
    if (tok[p] === '!') { p++; const v = unary(); return v === null ? null : !v; }
    if (tok[p] === '(') { p++; const v = or(); if (tok[p++] !== ')') return null; return v; }
    const a = tok[p] === 'type' ? t : num(tok[p]), op = tok[p + 1], b = tok[p + 2] === 'type' ? t : num(tok[p + 2]);
    if (a === null || b === null || (tok[p] !== 'type' && tok[p + 2] !== 'type')) return null;
    p += 3;
    return cmp(a, op, b);
  };
  const v = or();
  return p === tok.length ? v : null;
}

/** surface types of the tree models and impostors (nature models: leaves, bark, rocks, plain paint) */
const TREE_SURFS: readonly number[] = [Surf.Plain, Surf.Foliage, Surf.Wood, Surf.Stone];

/**
 * Tree programs shade only the surfaces trees have: the uber shader's surface chain (applySurface: `if (type ...) {}
 * else if (type ...) {} ... else {}`) keeps the bodies of the blocks the kept surface types enter (each condition
 * evaluated in chain order) and drops the others (windows and their night lights, glass, roofs, water, ...). Software
 * GL runs every branch of a shader for every fragment, so each tree fragment otherwise paid for all of them. Exact for
 * the kept types; a chain of any other shape (a condition on more than `type`, unexpected top-level lines) is left as
 * it is.
 */
export function treeSurfaceChain(fs: string, keep: readonly number[] = TREE_SURFS): string {
  const L = fs.split('\n');
  const f = L.findIndex((l) => l.startsWith('void applySurface('));
  if (f < 0) return fs;
  for (let s = f + 1; s < L.length && L[s] !== '}'; s++) {
    const m0 = /^ {2}if \((.*)\) \{$/.exec(L[s]);
    if (!m0) continue;
    // this top-level if and its `} else if (...) {` / `} else {` blocks, up to the closing `  }`
    const segs: { cond: string | null; at: number }[] = [{ cond: m0[1], at: s }];
    let end = -1;
    for (let i = s + 1; i < L.length; i++) {
      const l = L[i];
      if (!/^ {2}\S/.test(l)) {
        if (/^\S/.test(l)) return fs;
        continue;
      }
      const m = /^ {2}\} else if \((.*)\) \{$/.exec(l);
      if (m) segs.push({ cond: m[1], at: i });
      else if (l === '  } else {') segs.push({ cond: null, at: i });
      else if (l === '  }') { end = i; break; }
      else return fs;
    }
    if (end < 0) return fs;
    if (segs.length < 3) { s = end; continue; }
    // the surface chain: pure `type` conditions only; the block each kept type enters
    const used = new Set<number>();
    for (const t of keep) {
      let k = 0;
      for (; k < segs.length; k++) {
        const c = segs[k].cond;
        const r = c === null ? true : typeCond(c, t);
        if (r === null) return fs;
        if (r) break;
      }
      if (k < segs.length) used.add(k);
    }
    const out = L.slice(0, s);
    for (let k = 0; k < segs.length; k++) {
      out.push(L[segs[k].at]);
      if (used.has(k)) for (let i = segs[k].at + 1; i < (k + 1 < segs.length ? segs[k + 1].at : end); i++) out.push(L[i]);
    }
    return out.concat(L.slice(end)).join('\n');
  }
  return fs;
}

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
  /** seasonal species: their bare variant's kinds, one per green slot (kindsBySpecies order), else null. A chunk then
   *  holds its bare trees in the meshes its green trees use the rest of the year (one per green variant, the same
   *  instances): no fewer, wider meshes in winter, whose bounds would let more trees pass the view / shadow culling */
  private bareKinds: (number[] | null)[] = [];
  /** current autumn / bare / blossom fractions (seasonMix of month + climate) */
  private season: SeasonMix = { autumn: 0, bare: 0, blossom: 0 };
  private maxVariants = 3;
  private species: SpeciesDef[];
  /** species weights scratch (speciesWeights / pickFrom) */
  private weights: number[] = [];
  private chunks: TreeChunk[] = [];
  /** chunk boxes (min x y z, max x y z per chunk: the map's own cells) for the per-frame LOD selection */
  private chunkBox = new Float64Array(0);
  /** the edge band trees' extent per edge chunk (min x y z, max x y z; NaN: no band trees) */
  private bandBox = new Float64Array(0);
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
  /** the far outer ring's blocks (micro impostors, culled per block, thinned per tree in the vertex shader) */
  private materialRing: THREE.MeshStandardMaterial;
  /** the outer ring's near pairs (regular impostors of the trees within their switch distance, TREE_RING_NEAR) */
  private materialRingNear: THREE.MeshStandardMaterial;
  private depthNearPlain = new THREE.MeshDepthMaterial();
  private depthFarPlain: THREE.MeshDepthMaterial;
  /** depth materials of chunks drawn with an alpha-to-coverage fade material: three forces alphaTest 0.5 on the depth
   *  material of such objects, so they get their own instances (a shared one would flip alphaTest -> program per
   *  object) */
  private depthNearPlainA = new THREE.MeshDepthMaterial();
  private depthFarPlainA: THREE.MeshDepthMaterial;
  private depthNearA: THREE.MeshDepthMaterial;
  private depthFarA: THREE.MeshDepthMaterial;
  private lodDistance = 1300;
  private density = 1;
  private castShadows = true;
  private matNearFade: THREE.MeshStandardMaterial;
  private matFarFade: THREE.MeshStandardMaterial;
  private depthNear: THREE.MeshDepthMaterial;
  private depthFar: THREE.MeshDepthMaterial;
  /** LOD fade: camera, fade band (start, end, jitter, shadow switch), render size, edge band (x map size, 0 = no band;
   *  y the band trees' distance scale, 1 / shadowLodFrac) */
  private fadeU = { uTreeCam: { value: new THREE.Vector3() }, uTreeFade: { value: new THREE.Vector4(600, 800, 60, 700) }, uTreeRes: { value: new THREE.Vector2(1920, 1080) }, uTreeBand: { value: new THREE.Vector2(0, 1) } };
  /** snow on the forest: x terrain snow line (m), y its noise amplitude, z amount (0 = off) */
  private snowU = { uTreeSnow: { value: new THREE.Vector4(9999, 8, 0, 0) }, uTreeNoise: { value: getNoiseTexture() as THREE.Texture } };
  /** outer ring: uRingP x lodDistance (the near pair / far block switch), y the far blocks' visibility (camera height
   *  fade), z map size (m); uRingQ x a low camera's switch distance next to the edge (ringLowSwitch x lodDistance), y the
   *  camera part of the far blocks' mini crown weight (1 - its own height fade, ringShapeHeight; 0 without ringLowShape) */
  private ringU = { uRingP: { value: new THREE.Vector3(850, 0, 2048) }, uRingQ: { value: new THREE.Vector2(850, 1) } };
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
  /** impostors of the chunk being built: 0 / 1 map broadleaves / conifers, 2 / 3 edge band broadleaves / conifers */
  private farScratch: Float32Array[] = [0, 1, 2, 3].map(() => new Float32Array(16 * 4096));
  private farColor: Float32Array[] = [0, 1, 2, 3].map(() => new Float32Array(3 * 4096));
  private farCount = [0, 0, 0, 0];
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
  /** near impostor pair per sector (its trees within their switch distance of the camera): 2k broadleaf, 2k + 1
   *  conifer; instances ordered by their depth beyond the map edge (ringNearT, ascending: a camera reaches a prefix) */
  private ring: (TreeMesh | null)[] = new Array(RING_N * 2).fill(null);
  private ringNearT: (Float32Array | null)[] = new Array(RING_N * 2).fill(null);
  /** per near mesh: the bounds (min x y z, max x y z) of its first (c + 1) x RING_BOX_STEP slots, c = 0, 1, ... (the
   *  last entry: all of them) */
  private ringNearBox: (Float64Array | null)[] = new Array(RING_N * 2).fill(null);
  /** every sector's trees as micro impostors, per block (sector k's RING_SUB quarters: ids k * RING_SUB + q), ordered by
   *  their thinning random: CPU copies (16 matrix + 3 colour floats each; see rebuildRingFar), the sorted randoms
   *  (ringRand) and the block bounds (min x y z, max x y z) */
  private ringMicro: (Float32Array | null)[] = new Array(RING_N * RING_SUB).fill(null);
  private ringMicroCol: (Float32Array | null)[] = new Array(RING_N * RING_SUB).fill(null);
  private ringMicroR: (Float32Array | null)[] = new Array(RING_N * RING_SUB).fill(null);
  private ringMicroN = new Int32Array(RING_N * RING_SUB);
  private ringMicroBox = new Float64Array(RING_N * RING_SUB * 6);
  /** ... and the lowest point of their high-camera shape (`top`: from the micro waist up), per block */
  private ringMicroTopY = new Float64Array(RING_N * RING_SUB);
  /** ... and the same per cell of the block's RING_CELLS x RING_CELLS grid (block id x RING_CELLS^2 + cell; an empty
   *  cell: min x > max x) */
  private ringCellBox = new Float64Array(RING_N * RING_SUB * RING_CELLS * RING_CELLS * 6);
  private ringCellTopY = new Float64Array(RING_N * RING_SUB * RING_CELLS * RING_CELLS);
  /** the far ring in one mesh (TREE_RING, the high cameras' shape): every block's trees in one order by their thinning
   *  random (ringAllR: the sorted randoms; the merge of the blocks' own orders), for high cameras that see much of the
   *  ring (RING_ALL_K, updateRingView); ringAllN its trees once built, ringAllAt the next tree a rebuild merges (-1:
   *  none in progress - the mesh is current and may be drawn) */
  private ringAll: TreeMesh | null = null;
  private ringAllR: Float32Array | null = null;
  private ringAllN = 0;
  private ringAllAt = -1;
  /** the last prefix of each far block / near mesh / the all-in-one mesh (prefixFrom hints) */
  private ringFarHint = new Int32Array(RING_N * RING_SUB);
  private ringNearHint = new Int32Array(RING_N * 2);
  private ringAllHint = 0;
  /** the far ring's block meshes (TREE_RING), one per block */
  private ringFar: (TreeMesh | null)[] = new Array(RING_N * RING_SUB).fill(null);
  /** sectors (bits) whose micro impostors changed: their block meshes are uploaded by the next ring steps */
  private ringFarDirty = 0;
  /** candidates per sector (RING_STRIDE floats each) and their counts */
  private ringCand: (Float32Array | null)[] = new Array(RING_N).fill(null);
  private ringCandN = new Int32Array(RING_N);
  /** sectors whose candidates must be (re)generated / whose meshes must be (re)filled (bit k = sector k) */
  private ringStale = (1 << RING_N) - 1;
  private ringRefill = 0;
  private ringGen: RingGen | null = null;
  private ringFillState: RingFill | null = null;
  /** per sector: its tree order (RingOrder, for its current candidates) and its reusable micro data buffers */
  private ringOrder: (RingOrder | null)[] = new Array(RING_N).fill(null);
  private ringMicroAll: (Float32Array | null)[] = new Array(RING_N).fill(null);
  private ringMicroAllCol: (Float32Array | null)[] = new Array(RING_N).fill(null);
  /** sector filled at least once since the last reset (its meshes may be drawn) */
  private ringReady = new Uint8Array(RING_N);
  /** instance bounds of each sector (min x y z, max x y z) */
  private ringBox = new Float64Array(RING_N * 6);
  /** map-border corner heights the ring heights were generated with (west, east, north, south edges; N + 1 each):
   *  only a terrain edit on the border moves the outer landscape the ring stands on */
  private ringEdgeH = new Float32Array(0);
  /** frames the ring's pending runtime work waited for a calm frame (RING_MAX_WAIT) */
  private ringWait = 0;
  /** camera position of the previous frame and the number of calm frames in a row (RING_CALM_*) */
  private ringCam = new Float64Array(3).fill(NaN);
  private ringCalm = 0;
  /** the ring (and the edge band) at the current quality: ringWidth > 0 and lodDistance >= RING_MIN_LOD */
  private ringOn = true;
  /** 1: the next view update draws every ring mesh with trees once (the hidden ones with one instance, warmDraw: their
   *  instance data uploads then, not on their first sight) */
  private ringPreload = 0;
  /** meshes drawn once by warmDraw that are not back to their own state yet (warmFlush) */
  private warmPending: TreeMesh[] = [];
  /** disposed (a queued load warm-up then does nothing) */
  private disposed = false;
  /** a runtime rebuild unit of the all-in-one mesh left an instance range to upload (updateRingView draws it once) */
  private ringAllUp = false;
  /** the all-in-one mesh's rebuild in progress: its total, the merge's cursor per block and its heap of block ids (the
   *  blocks' next trees by their random, smallest first) */
  private ringAllTotal = 0;
  private ringAllCur = new Int32Array(RING_N * RING_SUB);
  private ringAllHeap = new Int32Array(RING_N * RING_SUB);
  private ringAllHeapN = 0;
  /** version of the ring's mesh data (bumped by every ring step and teardown) and updateRingView's inputs at its last
   *  pass (camera position, matrices, lod, camera height, low-camera settings, that version): an unchanged view with
   *  unchanged ring data (a still camera) keeps the last pass's counts instead of re-deriving them */
  private ringVer = 0;
  private ringViewKey = new Float64Array(43).fill(NaN);
  /** width (m) of the landscape ring beyond the map edge that gets tree impostors (0 = none, also no edge band) */
  ringWidth = 2600;
  /** main-thread time (ms) of one slice of the outer ring's runtime work (refills / border regenerations) */
  ringBudgetMs = 1;
  /** the far ring's all-in-one mesh's runtime rebuild (after a refill; a load builds it at once, see ringAllStep): this
   *  many trees per ring step unit (~0.6 MB of instance data, each unit's range drawn - uploaded - once right after it) */
  ringAllUnit = 8192;
  /** main-thread time (ms) per frame for runtime (re)builds of tree chunks (a season, edits), nearest first (always at
   *  least one chunk); a load builds all of its chunks at once (buildAll, loadFrames) */
  buildBudgetMs = 3;
  /** update() calls left that still build every dirty chunk at once (LOAD_FRAMES after a load) */
  private loadFrames = LOAD_FRAMES;
  /** update() calls since the load (constructor / reset): the first one finishes ring work queued before it */
  private updates = 0;
  /** camera heights above the ground (m) between which the ring's far blocks fade in: low cameras look through the
   *  city / edge band at the horizon, where they are hidden or a few specks in the haze (the near pairs, a camera near
   *  the map edge, show at any height) */
  ringFadeHeight: [number, number] = [110, 240];
  /** a low camera (below ringFadeHeight) next to a sector's map edge sees that sector's ring at a grazing angle, where
   *  the far blocks' micro impostors read as small pale cones: its trees stay regular impostors (the near pair) out to
   *  this multiple of lodDistance (their switch distance, eased in with the low-camera weight: see updateRingView).
   *  1.3: the copses a low camera sees largest (to ~1.1 km at HIGH, ~1.5 km at ULTRA) are the regular impostors; past
   *  it the far blocks' mini crowns on trunks (ringLow) read as the same round crowns (1.6 submitted 1.2-2.5x the near
   *  pairs' trees on the low edge views, for copses that look the same from 1.1 km on). Each step further costs vertex
   *  work (84 per regular impostor, 12 per mini crown) on low edge views for trees that small */
  ringLowSwitch = 1.3;
  /** ... and the far blocks beyond show the low cameras' mini crown (ringLow: a round crown on a trunk, unfolding from
   *  the upper half with that weight) instead of the upper half that high cameras see */
  ringLowShape = true;
  /** the mini crown's own camera height band next to the edge: from ringFadeHeight[0] (whole) to this (m above the
   *  ground; the upper half again). A camera up to ~350 m next to the edge still sees the far blocks' trees at a grazing
   *  angle, where the upper half reads as small pale cones floating over the forest's dark stains (round crowns on
   *  trunks in the r3 reference up to ~340 m, cones from ~380 m): with 440 m the crown is whole up to ~300 m, half at
   *  ~345 m and nearly the upper half by ~380 m, eased with the height (the switch distance keeps ringFadeHeight's band),
   *  and it reaches farther from the edge (RING_CROWN_FAR). Each far tree of such a sector costs 12 vertices instead of
   *  4 while the crown shows */
  ringShapeHeight = 440;
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
    this.materialRing = this.makeTreeMaterial(true, true, true);
    this.materialRingNear = this.makeTreeMaterial(true, false, false, true);
    this.depthFarPlain = this.makeDepthMaterial(false, false);
    this.depthFarPlainA = this.makeDepthMaterial(false, false);
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
    this.ringOn = this.ringWanted();
    // the low quality foliage path (weak machines): no outer ring / edge band, and lot trees without winter twigs
    setLotTwigStrip(this.lodDistance < RING_MIN_LOD);
    this.perSide = Math.ceil(state.size / CHUNK);
    this.chunkBox = new Float64Array(this.perSide * this.perSide * 6);
    this.bandBox = new Float64Array(this.perSide * this.perSide * 6).fill(NaN);
    for (let cz = 0; cz < this.perSide; cz++)
      for (let cx = 0; cx < this.perSide; cx++) {
        this.chunks.push({ cx, cz, near: this.kinds.map(() => null), far: [null, null, null], farTotal: [0, 0, 0], box: new THREE.Box3(), sphere: new THREE.Sphere(), isNear: false, total: 0, stateKey: -1, lastKey: FRESH_KEY, bandKey: -1, lastBandKey: FRESH_BAND_KEY, micro: false, mapN: null, nearN: null, bandD: null, bfar: [null, null, null], bfarTotal: [0, 0, 0] });
        this.chunkExtent(this.chunks.length - 1);
      }
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
    this.snapshotRingEdge();
    this.setMonth(state.month);
    this.syncBandUniform();
    // the outer ring is generated and filled right away, and so are the map's chunks (part of the load: tens of ms each,
    // never on the frames the player moves the camera in)
    this.flushRing();
    this.buildAll();
    this.makeWarmup();
  }

  /** build every dirty chunk now (a load's own build, the load's frames: see LOAD_FRAMES) */
  private buildAll(): void {
    for (const id of this.dirty) this.buildChunk(id);
    this.dirty.clear();
  }

  /** the edge band's switch distance as a fraction of the map trees' (= the shadow switch, see the header) */
  private bandFrac(): number {
    return THREE.MathUtils.clamp(this.shadowLodFrac, 0.2, 1);
  }

  /** the fade programs' edge band uniform: map size + band distance scale while the band is on */
  private syncBandUniform(): void {
    this.fadeU.uTreeBand.value.set(this.ringOn ? this.state.size * CELL_SIZE : 0, 1 / this.bandFrac());
  }

  /** the ring and the edge band at the current settings */
  private ringWanted(): boolean {
    return this.ringWidth > 0 && this.lodDistance >= RING_MIN_LOD;
  }

  /** horizontal extent of chunk ci: its own cells (the edge band's trees have their own box, bandBox: their LOD is
   *  separate); the height range comes from the trees placed (buildChunk) */
  private chunkExtent(ci: number): void {
    const ch = this.chunks[ci], cx = ch.cx, cz = ch.cz;
    const x0 = cx * CHUNK * CELL_SIZE, z0 = cz * CHUNK * CELL_SIZE;
    const y0 = ch.total > 0 || ch.box.max.y > ch.box.min.y ? ch.box.min.y : -10, y1 = ch.total > 0 || ch.box.max.y > ch.box.min.y ? ch.box.max.y : 60;
    ch.box.min.set(x0, y0, z0);
    ch.box.max.set(x0 + CHUNK * CELL_SIZE, y1, z0 + CHUNK * CELL_SIZE);
    ch.box.getBoundingSphere(ch.sphere);
    this.storeChunkBox(ci);
  }

  /**
   * Turn the outer ring + edge band on / off for the current settings (quality: lodDistance; ringWidth): off drops the
   * ring's meshes and data; on generates it at once (a quality change: its frame recompiles every program anyway); the
   * edge chunks rebuild with / without their band.
   */
  private applyRingOn(): void {
    const on = this.ringWanted();
    if (on === this.ringOn) return;
    this.ringOn = on;
    this.disposeRing();
    this.ringStale = on ? (1 << RING_N) - 1 : 0;
    this.ringRefill = 0;
    this.ringGen = null;
    this.ringFillState = null;
    this.syncBandUniform();
    const last = this.perSide - 1;
    for (let i = 0; i < this.chunks.length; i++) {
      const ch = this.chunks[i];
      if (ch.cx !== 0 && ch.cz !== 0 && ch.cx !== last && ch.cz !== last) continue;
      this.dirty.add(i);
    }
    this.lodForce = true;
    this.flushRing();
  }

  /** drop every outer ring mesh / sector (not the candidates' buffers) */
  private disposeRing(): void {
    this.ringVer++;
    for (const m of this.ring) if (m) { this.group.remove(m); m.dispose(); }
    this.ring.fill(null);
    for (const m of this.ringFar) if (m) { this.group.remove(m); m.dispose(); }
    this.ringFar.fill(null);
    this.ringMicro.fill(null);
    this.ringMicroCol.fill(null);
    this.ringMicroR.fill(null);
    this.ringMicroN.fill(0);
    this.ringNearT.fill(null);
    this.ringNearBox.fill(null);
    this.ringReady.fill(0);
    this.ringOrder.fill(null);
    this.ringFarDirty = 0;
    this.ringInstances = 0;
    if (this.ringAll) { this.group.remove(this.ringAll); this.ringAll.dispose(); }
    this.ringAll = null;
    this.ringAllN = 0;
    this.ringAllAt = -1;
    this.ringAllUp = false;
    this.ringFarHint.fill(0);
    this.ringNearHint.fill(0);
    this.ringAllHint = 0;
    this.warmFlush();
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
    // (the outer ring casts no shadow)
    pairs.push([getMicroImpostorGeometries().top, this.materialRing, null, true]);
    pairs.push([imp.broad, this.materialRingNear, null, true]);
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

  /** depth material of a chunk mesh: near / far, drawn with the fade material, straddling the shadow cut (meshes drawn
   *  with an alpha-to-coverage material - near models while fading, every impostor with MSAA - get the "A" instances) */
  private depthFor(near: boolean, fade: boolean, cut: boolean): THREE.MeshDepthMaterial {
    const a = this.a2c && (fade || !near);
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
    shader.uniforms.uTreeBand = this.fadeU.uTreeBand;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + FADE_VERT_PARS).replace(/}\s*$/, fadeVertMain(near, depth) + '\n}');
    if (!depth) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FADE_FRAG_PARS)
        .replace('void main() {', 'void main() {\n' + fadeFrag(near))
        .replace('#include <alphatest_fragment>', fadeAlpha(near) + '\n#include <alphatest_fragment>');
    }
  }

  /** snow + (impostors) metric object coordinates, see-through bare crowns and the far ring's per-tree thinning; see
   *  SEASON_* / FAR_* / BARE_* */
  private injectSeason(shader: THREE.WebGLProgramParametersWithUniforms, far: boolean) {
    shader.uniforms.uTreeSnow = this.snowU.uTreeSnow;
    shader.uniforms.uTreeNoise = this.snowU.uTreeNoise;
    let vp = SEASON_VERT_PARS, fp = SEASON_FRAG_PARS;
    if (far) {
      shader.uniforms.uBareRes = this.fadeU.uTreeRes;
      shader.uniforms.uRingP = this.ringU.uRingP;
      shader.uniforms.uRingQ = this.ringU.uRingQ;
      vp += FAR_VERT_PARS;
      fp += FAR_FRAG_PARS;
    }
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + vp).replace(/}\s*$/, seasonVertMain(far) + '\n}');
    // (the far ring blocks' low-camera shape: before the uber shader's own begin_vertex part, see RING_LOW_VERT)
    if (far) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + RING_LOW_VERT);
    let fs = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + fp)
      .replace('#include <normal_fragment_begin>', SEASON_FRAG + '\n#include <normal_fragment_begin>');
    if (far) fs = fs.replace('#include <alphatest_fragment>', BARE_FRAG + '\n#include <alphatest_fragment>').replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + BARE_NORMAL);
    // (only the tree surfaces' shading: see treeSurfaceChain)
    shader.fragmentShader = treeSurfaceChain(fs);
  }

  /** plain (no fade) tree material: near models or impostors (merged: broadleaf + conifer micro impostor meshes; ring:
   *  the far outer ring's blocks; ringNear: the outer ring's near pairs). Impostor materials blend see-through bare
   *  crowns by alpha-to-coverage with MSAA. */
  private makeTreeMaterial(far: boolean, merged = false, ring = false, ringNear = false): THREE.MeshStandardMaterial {
    const m = patchSurfaceMaterial(getBuildingMaterial().clone(), 'building-uber-v1');
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      base.call(m, shader, renderer);
      this.injectSeason(shader, far);
    };
    m.customProgramCacheKey = () => 'building-uber-v1|tree-' + (far ? 'far' : 'near') + (merged ? '-merged' : '') + (ring ? '-ring' : '') + (ringNear ? '-ringnear' : '') + '-v3';
    m.defines = { ...(m.defines ?? {}) };
    if (merged) m.defines.TREE_MERGED = '';
    if (ring) m.defines.TREE_RING = '';
    if (ringNear) m.defines.TREE_RING_NEAR = '';
    m.shadowSide = THREE.DoubleSide;
    if (far) this.applyFadeMode(m);
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
    m.customProgramCacheKey = () => 'building-uber-v1|tree-fade-' + (near ? 'near' : 'far') + '-v5';
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

  /** depth material of tree meshes: cut = straddling the shadow switch distance (per-instance cut); impostors cast
   *  stippled shadows from see-through bare crowns (BARE_DEPTH_*) */
  private makeDepthMaterial(near: boolean, cut = true): THREE.MeshDepthMaterial {
    const m = new THREE.MeshDepthMaterial();
    m.onBeforeCompile = (shader) => {
      if (cut) this.injectFade(shader, near, true);
      if (near) return;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + BARE_DEPTH_VERT_PARS).replace(/}\s*$/, BARE_DEPTH_VERT + '\n}');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + BARE_DEPTH_FRAG_PARS).replace('void main() {', 'void main() {\n' + BARE_DEPTH_FRAG);
    };
    m.customProgramCacheKey = () => 'tree-depth-' + (near ? 'near' : 'far') + (cut ? '' : '-plain') + '-v3';
    return m;
  }

  private buildKinds() {
    this.kinds = [];
    this.kindsBySpecies = [];
    this.autumnKinds = [];
    this.seasonKinds = [];
    this.bareKinds = [];
    this.weights = new Array(this.species.length).fill(0);
    this.species.forEach((sp, si) => {
      const ss = SEASONAL_TREES[sp.id];
      if (ss) {
        // deciduous species: quality-limited green variants + every autumn / bare / blossom variant (nat_season.ts)
        const map = new Map<number, number>();
        const add = (v: number) => {
          if (map.has(v)) return;
          map.set(v, this.kinds.length);
          this.kinds.push(this.makeKind(si, sp, v));
        };
        const green = ss.green.slice(0, Math.max(1, this.maxVariants));
        for (const v of green) add(v);
        for (const v of [...ss.autumn, ...ss.blossom]) add(v);
        // (one bare variant per species: a kind per green slot, see bareKinds)
        const bare = ss.bare.length === 1 ? green.map(() => (this.kinds.push(this.makeKind(si, sp, ss.bare[0])), this.kinds.length - 1)) : null;
        if (!bare) for (const v of ss.bare) add(v);
        this.kindsBySpecies.push(green.map((v) => map.get(v)!));
        this.autumnKinds.push([]);
        this.seasonKinds.push(map);
        this.bareKinds.push(bare);
        return;
      }
      this.seasonKinds.push(null);
      this.bareKinds.push(null);
      const nv = Math.min(4, MANIFEST_BY_ID[sp.id]?.variants ?? 1);
      const list: number[] = [];
      const autumn: number[] = [];
      for (let v = 0; v < nv; v++) {
        const kind = this.makeKind(si, sp, v);
        // autumn-colored variants (foliage more red than green) are only used in autumn
        const isAutumn = kind.color.r > kind.color.g * 0.95 && sp.id !== 'rock' && sp.id !== 'tree_cactus';
        if (isAutumn ? autumn.length >= 1 : list.length >= this.maxVariants) continue;
        (isAutumn ? autumn : list).push(this.kinds.length);
        this.kinds.push(kind);
      }
      if (!list.length && autumn.length) list.push(autumn[0]);
      this.kindsBySpecies.push(list);
      this.autumnKinds.push(autumn);
    });
    this.scratch = this.kinds.map(() => new Float32Array(16 * 1024));
    this.scratchCount = this.kinds.map(() => 0);
  }

  /** tree kind of model variant v of species si: impostor tint / bounds from the model (see-through bare crowns keep
   *  their twig colour, the floor shows through their impostors instead of a darker tint) */
  private makeKind(si: number, sp: SpeciesDef, v: number): Kind {
    const geo = getNatureGeometry(sp.id, v);
    const st = natureStats(geo);
    const bare = st.open > BARE_OPEN;
    // (bare: the twigs' own colour, a little darker - their shaded inner tangle; the floor shows between them)
    return { species: si, id: sp.id, variant: v, geo, conifer: !!sp.conifer, color: bare ? st.raw.clone().multiplyScalar(0.75) : st.color, height: st.height, radius: st.radius, impR: bare ? 0.92 : 1, bare };
  }

  setQuality(opts: { lodDistance: number; density: number; castShadows: boolean; maxVariants?: number; msaa?: boolean }) {
    if (opts.msaa !== undefined && opts.msaa !== this.a2c) {
      this.a2c = opts.msaa;
      for (const m of [this.matNearFade, this.matFarFade, this.materialFar, this.materialMerged, this.materialRing, this.materialRingNear]) this.applyFadeMode(m);
      for (const c of this.chunks) c.stateKey = -1;
      // (ring meshes: their depth materials do not matter, they cast no shadow)
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
        c.bfar = [null, null, null];
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
      c.stateKey = c.bandKey = -1;
      for (const m of c.near) if (m) m.castShadow = opts.castShadows;
      for (const m of c.far) if (m) m.castShadow = opts.castShadows;
    }
    // (the ring's candidates are density independent: a new density only refills it)
    if (densityChanged) this.markAll();
    // low quality: no outer ring / edge band, lot trees without winter twigs (winterTwigs.ts)
    this.applyRingOn();
    this.syncBandUniform();
    setLotTwigStrip(this.lodDistance < RING_MIN_LOD);
    // (a quality change: its frame recompiles every program anyway; the ring's refill / generation and the chunks it
    // marked are done at once, as a load's)
    this.flushRing();
    this.buildAll();
  }

  /** rebuild every chunk and refill the outer ring (season, density, tree kinds) */
  markAll() {
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
    this.ringRefill = this.ringOn ? (1 << RING_N) - 1 : 0;
    // a refill in progress used the old kinds / density: start it over
    this.ringFillState = null;
  }

  /** cells changed (trees / network / zones / buildings) */
  onCellsChanged(r: CellRect) {
    const x0 = Math.max(0, r.x0), z0 = Math.max(0, r.z0);
    const x1 = Math.min(this.state.size - 1, r.x1), z1 = Math.min(this.state.size - 1, r.z1);
    const N = this.state.size;
    if (this.ringOn && (x0 <= 1 || z0 <= 1 || x1 >= N - 2 || z1 >= N - 2)) this.ringEdgeChanged(x0, z0, x1, z1);
    for (let cz = Math.floor(z0 / CHUNK); cz <= Math.floor(z1 / CHUNK); cz++)
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++)
        if (cx >= 0 && cz >= 0 && cx < this.perSide && cz < this.perSide) this.dirty.add(cz * this.perSide + cx);
  }

  reset(state: CityState) {
    this.state = state;
    if (this.ringWanted() !== this.ringOn) this.applyRingOn();
    this.seed = state.config.seed | 0;
    this.noise = new Noise2D(state.config.seed + 4242);
    this.season = forestMix(state.month, state.config.climate);
    this.autumn = this.season.autumn;
    const sp = CLIMATE_SPECIES[state.config.climate] ?? CLIMATE_SPECIES.temperate;
    if (sp !== this.species) {
      this.species = sp;
      for (const c of this.chunks) this.disposeChunk(c);
      this.buildKinds();
      for (const c of this.chunks) {
        c.near = this.kinds.map(() => null);
        c.far = [null, null, null];
        c.bfar = [null, null, null];
      }
    }
    // a new map (a reset is a load): new ring candidates, generated right away
    this.disposeRing();
    this.ringStale = this.ringOn ? (1 << RING_N) - 1 : 0;
    this.ringGen = null;
    this.ringFillState = null;
    this.ringWait = this.ringCalm = 0;
    this.snapshotRingEdge();
    this.syncBandUniform();
    this.markAll();
    this.ringRefill = 0;
    this.flushRing();
    // (and its chunks, at once; the load's frames take what is dirtied after it)
    this.buildAll();
    this.loadFrames = LOAD_FRAMES;
    this.updates = 0;
  }

  /** species weights of cell (x, z) at height h into `weights`; returns their total (the same for every tree of a
   *  cell: placeCell computes them once per cell) */
  private speciesWeights(x: number, z: number, h: number, slope: number, weights: number[]): number {
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
    return total;
  }

  /** species drawn by the uniform random r from the weights (speciesWeights) */
  private pickFrom(weights: number[], total: number, r: number): number {
    let t = r * total;
    const n = this.species.length - 1;
    let s = 0;
    for (; s < n; s++) {
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
      const id = this.species[s].id, ss = SEASONAL_TREES[id];
      const v = seasonalVariant(id, ss.green[gi], hash2(x * 3 - 7, z * 5 + 2, this.seed + 97), this.season);
      const bk = this.bareKinds[s];
      if (bk && v === ss.bare[0]) return bk[gi];
      return sk.get(v) ?? list[gi];
    }
    const au = this.autumnKinds[s];
    if (au.length && this.autumn > 0 && hash2(x * 3 - 7, z * 5 + 2, this.seed + 97) < this.autumn) return au[0];
    return list[gi];
  }


  /**
   * season: month 0..11 -> fractions of deciduous trees showing autumn colours (Sep 0.3 / Oct 0.8 / Nov 0.55), bare
   * branches (Dec-Feb all: forestMix) and blossom (Apr 0.15); temperate / alpine only (nat_season.seasonMix)
   */
  setMonth(month: number) {
    const m = forestMix(month, this.state.config.climate);
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

  /** placed-tree height range of the chunk being built: map trees (bMinY / bMaxY) and band trees (bb: min x y z,
   *  max x y z of their extent) */
  private bMinY = Infinity;
  private bMaxY = -Infinity;
  private bb = new Float64Array(6);

  /** place `count` trees of cell (x, z) (map or virtual edge cell: `band`) into the chunk being built */
  private placeCell(x: number, z: number, count: number, dens: number, h: number, slope: number, weights: number[], band = false) {
    const seed = this.seed;
    // stratified jitter on a 3x3 grid, slot order permuted per cell
    const rot = Math.floor(hash2(x, z, seed + 17) * 9);
    const total = this.speciesWeights(x, z, h, slope, weights);
    // winter: conifer impostors a little taller / darker (see WINTER_CONIFER_*)
    const winter = this.season.bare > 0.5;
    const bb = this.bb;
    for (let t = 0; t < count; t++) {
      const slot = (t * 4 + rot) % 9;
      const sx = slot % 3, sz = Math.floor(slot / 3);
      const jx = hash2(x * 9 + t, z, seed + 23), jz = hash2(x, z * 9 + t, seed + 29);
      const px = (x + (sx + 0.15 + 0.7 * jx) / 3) * CELL_SIZE;
      const pz = (z + (sz + 0.15 + 0.7 * jz) / 3) * CELL_SIZE;
      const k = this.kindOf(this.pickFrom(weights, total, hash2(x * 5 + t, z * 3 - t, seed + 31)), x, z);
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
      // far impostor (band trees: the band's own impostor meshes)
      const fc = (kind.conifer ? 1 : 0) + (band ? 2 : 0);
      const fn = this.farCount[fc];
      this.ensureFar(fc, fn + 1);
      const f = this.farScratch[fc];
      const fo = fn * 16;
      const wc = winter && kind.conifer;
      const sxz = (kind.radius / 0.42) * s * 0.92 * kind.impR * (wc ? WINTER_CONIFER_R : 1), sy = kind.height * s * (wc ? WINTER_CONIFER_H : 1);
      f[fo] = c * sxz; f[fo + 1] = 0; f[fo + 2] = -sn * sxz; f[fo + 3] = 0;
      f[fo + 4] = 0; f[fo + 5] = sy; f[fo + 6] = 0; f[fo + 7] = 0;
      f[fo + 8] = sn * sxz; f[fo + 9] = 0; f[fo + 10] = c * sxz; f[fo + 11] = 0;
      f[fo + 12] = px; f[fo + 13] = y; f[fo + 14] = pz; f[fo + 15] = 1;
      const cv = (0.9 + 0.2 * hash2(x + t, z * 2 + t, seed + 43)) * (wc ? WINTER_CONIFER_TINT : 1);
      const col = this.farColor[fc];
      // (see-through bare crowns: negative red, see FAR_VERT_MAIN)
      col[fn * 3] = kind.bare ? -Math.max(kind.color.r * cv, 1e-4) : kind.color.r * cv;
      col[fn * 3 + 1] = kind.color.g * cv;
      col[fn * 3 + 2] = kind.color.b * cv;
      this.farCount[fc] = fn + 1;
      const top = y + kind.height * s;
      if (band) {
        const r = kind.radius * s;
        if (px - r < bb[0]) bb[0] = px - r;
        if (y < bb[1]) bb[1] = y;
        if (pz - r < bb[2]) bb[2] = pz - r;
        if (px + r > bb[3]) bb[3] = px + r;
        if (top > bb[4]) bb[4] = top;
        if (pz + r > bb[5]) bb[5] = pz + r;
      } else {
        if (y < this.bMinY) this.bMinY = y;
        if (top > this.bMaxY) this.bMaxY = top;
      }
    }
  }

  /** shuffle impostor list fc (farScratch / farColor) so a prefix is a uniform random subset (density fade) */
  private shuffleFar(fc: number, ci: number): void {
    const n = this.farCount[fc], f = this.farScratch[fc], col = this.farColor[fc], seed = this.seed;
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

  /** a chunk's impostor meshes from impostor lists fb (broadleaf) / fb + 1 (conifer): the regular pair and both as one
   *  merged micro mesh (its own shuffle); band: the edge band's meshes (bfar) */
  private fillFar(ch: TreeChunk, ci: number, fb: number, band: boolean): void {
    const out = band ? ch.bfar : ch.far, tot = band ? ch.bfarTotal : ch.farTotal;
    const imp = getImpostorGeometries();
    out[0] = this.fill(out[0], imp.broad, this.farScratch[fb], this.farColor[fb], this.farCount[fb], false);
    out[1] = this.fill(out[1], imp.conifer, this.farScratch[fb + 1], this.farColor[fb + 1], this.farCount[fb + 1], false);
    tot[0] = this.farCount[fb];
    tot[1] = this.farCount[fb + 1];
    // far (micro) state: both classes in one mesh (one draw per far chunk instead of two), its own shuffle
    const nb = this.farCount[fb], nm = nb + this.farCount[fb + 1];
    if (this.mergedPerm.length < nm) {
      const cap = Math.ceil(nm * 1.5);
      this.mergedScratch = new Float32Array(cap * 16);
      this.mergedColor = new Float32Array(cap * 3);
      this.mergedPerm = new Int32Array(cap);
    }
    const perm = this.mergedPerm;
    for (let i = 0; i < nm; i++) perm[i] = i;
    for (let i = nm - 1; i > 0; i--) {
      const j = Math.floor(hash2(i, ci, this.seed + 59 + fb) * (i + 1));
      const t = perm[i];
      perm[i] = perm[j];
      perm[j] = t;
    }
    for (let i = 0; i < nm; i++) {
      const conifer = i >= nb;
      const fc = fb + (conifer ? 1 : 0);
      mergeImpostor(this.farScratch[fc], this.farColor[fc], conifer ? i - nb : i, this.mergedScratch, this.mergedColor, perm[i], conifer);
    }
    out[2] = this.fill(out[2], getMicroImpostorGeometries().broad, this.mergedScratch, this.mergedColor, nm, false, this.materialMerged);
    tot[2] = nm;
    if (band) for (const m of out) if (m) { m.name = 'trees-far-band'; m.castShadow = false; }
  }

  private buildChunk(ci: number) {
    const ch = this.chunks[ci];
    const st = this.state, N = st.size;
    const nk = this.kinds.length;
    for (let k = 0; k < nk; k++) this.scratchCount[k] = 0;
    this.farCount.fill(0);
    const weights = this.weights;
    this.bMinY = Infinity;
    this.bMaxY = -Infinity;
    const bb = this.bb;
    bb[0] = bb[1] = bb[2] = Infinity;
    bb[3] = bb[4] = bb[5] = -Infinity;
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
    ch.mapN = ch.nearN = ch.bandD = null;
    if (this.ringOn && (ch.cx === 0 || ch.cz === 0 || ch.cx === this.perSide - 1 || ch.cz === this.perSide - 1)) {
      const noise = getNoiseTexture().image.data as Uint8Array;
      const W = N * CELL_SIZE;
      const mapN = Int32Array.from(this.scratchCount.slice(0, nk));
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
          // the band's outer cells thin toward the outer ring's density (its impostors take over at the band's edge)
          const thin = 1 - 0.5 * _sstep(3, B, Math.max(dx, dz) / CELL_SIZE);
          const count = Math.min(9, Math.floor(DENSITY_COUNT[dens] * this.density * thin + hash2(x, z, seed + 5)));
          if (count <= 0) continue;
          const h = this.terrain.worldHeight(px, pz);
          if (h < 1.6) continue;
          const hx = this.terrain.worldHeight(px + CELL_SIZE, pz), hz = this.terrain.worldHeight(px, pz + CELL_SIZE);
          this.placeCell(x, z, count, dens, h, Math.max(Math.abs(hx - h), Math.abs(hz - h)), weights, true);
        }
      }
      this.sortBand(ch, mapN, W / 2);
    }
    let minY = this.bMinY, maxY = this.bMaxY;
    // shuffle impostors so a prefix is a uniform random subset (density fade): map trees, band trees
    for (let fc = 0; fc < 4; fc++) this.shuffleFar(fc, ci);
    // bounds (the map's own cells; the band trees' extent separately)
    if (minY === Infinity) {
      minY = 0;
      maxY = 1;
    }
    ch.box.min.y = minY - 1;
    ch.box.max.y = maxY + 1;
    ch.box.getBoundingSphere(ch.sphere);
    this.storeChunkBox(ci);
    const BB = this.bandBox, bo = ci * 6;
    const hasBand = this.farCount[2] + this.farCount[3] > 0;
    for (let q = 0; q < 6; q++) BB[bo + q] = hasBand ? bb[q] + (q === 1 ? -1 : q === 4 ? 1 : 0) : NaN;
    let total = 0;
    if (ch.mapN) ch.nearN = Int32Array.from(this.scratchCount.slice(0, nk));
    for (let k = 0; k < nk; k++) {
      const n = this.scratchCount[k];
      total += n;
      ch.near[k] = this.fill(ch.near[k], this.kinds[k].geo, this.scratch[k], null, n, true, undefined, ch.mapN ? ch.mapN[k] : -1);
    }
    this.fillFar(ch, ci, 0, false);
    if (hasBand || ch.bfar.some((m) => m)) this.fillFar(ch, ci, 2, true);
    this.totalInstances += total - ch.total;
    ch.total = total;
    // keep the chunk's current LOD state (new meshes default to visible + plain material); the next update re-derives it
    this.applyLod(ch, ch.lastKey, ch.lastBandKey, true);
    this.lodForce = true;
    shadowCasters.version++;
  }

  /**
   * An edge chunk's band trees (each kind's near instances past mapN[k]) ordered by their distance to the map centre
   * (c, c), so a near mesh can draw its map trees plus only the band trees within reach of the view (trimBand)
   */
  private sortBand(ch: TreeChunk, mapN: Int32Array, c: number): void {
    const nk = this.kinds.length;
    const bandD: (Float32Array | null)[] = new Array(nk).fill(null);
    for (let k = 0; k < nk; k++) {
      const m0 = mapN[k], n = this.scratchCount[k] - m0;
      if (n <= 0) continue;
      const e = this.scratch[k];
      const d = new Float32Array(n), idx = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const o = (m0 + i) * 16;
        d[i] = Math.hypot(e[o + 12] - c, e[o + 14] - c);
        idx[i] = i;
      }
      idx.sort((a, b) => d[a] - d[b]);
      const tmp = e.slice(m0 * 16, (m0 + n) * 16), ds = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        e.set(tmp.subarray(idx[j] * 16, idx[j] * 16 + 16), (m0 + j) * 16);
        ds[j] = d[idx[j]];
      }
      bandD[k] = ds;
    }
    ch.mapN = mapN;
    ch.bandD = bandD;
  }

  /**
   * A near edge chunk's band trees beyond the view's reach are not submitted: a tree farther than `reach` (the band's LOD
   * fade end + jitter, shadowLodFrac x the map trees', where its near model is fully faded out and casts no shadow) from
   * the camera is farther than reach + the camera's distance to the map centre from that centre, so each near mesh
   * draws its map trees plus the prefix of its (sorted) band trees within that radius (radius < 0: none, the band is not
   * near). Returns whether a count changed.
   */
  private trimBand(ch: TreeChunk, radius: number): boolean {
    const mapN = ch.mapN, nearN = ch.nearN, bandD = ch.bandD;
    if (!mapN || !nearN || !bandD) return false;
    let changed = false;
    for (let k = 0; k < ch.near.length; k++) {
      const m = ch.near[k], d = bandD[k];
      if (!m || !d) continue;
      let lo = 0, hi = d.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (d[mid] <= radius) lo = mid + 1;
        else hi = mid;
      }
      const c = Math.min(nearN[k], mapN[k] + lo);
      if (m.count !== c) {
        // culled by the bounds of what it submits: the map trees' alone without band trees (the band's would widen
        // the box: more frustum / shadow hits for the map trees)
        const box = (c > mapN[k] ? m.userData.allBox : m.userData.mapBox) as THREE.Box3 | undefined;
        if (box && (m.count > mapN[k]) !== (c > mapN[k])) {
          m.boundingBox!.copy(box);
          box.getBoundingSphere(m.boundingSphere!);
        }
        m.count = c;
        changed = true;
      }
      m.visible = ch.isNear && c > 0;
    }
    return changed;
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

  /** (re)fill a tree mesh with n instances; `split` (edge chunks' near meshes: the map trees, the band trees follow):
   *  also keep the bounds of the first `split` instances (userData.mapBox / allBox, see trimBand) */
  private fill(mesh: TreeMesh | null, geo: THREE.BufferGeometry, data: Float32Array, color: Float32Array | null, n: number, near: boolean, material?: THREE.Material, split = -1): TreeMesh | null {
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
    const ud = mesh.userData;
    if (split >= 0 && split < n) {
      ud.mapBox ??= new THREE.Box3();
      ud.allBox ??= new THREE.Box3();
    } else ud.mapBox = ud.allBox = undefined;
    for (let i = 0; i < n; i++) {
      if (i === split) (ud.mapBox as THREE.Box3).copy(_box);
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
    if (ud.allBox) (ud.allBox as THREE.Box3).copy(_box);
    mesh.boundingBox!.copy(_box);
    _box.getBoundingSphere(mesh.boundingSphere!);
    ud.total = n;
    return mesh;
  }

  /**
   * Apply a chunk's LOD state keys (see L_*): `key` for its map trees (the near meshes' map instances, `far`), `bkey` for
   * its edge band trees (the near meshes' band instances within reach, see trimBand, and `bfar`; 0 without a band);
   * force: re-apply unchanged keys (after a rebuild)
   */
  private applyLod(ch: TreeChunk, key: number, bkey: number, force = false) {
    if (key === ch.stateKey && bkey === ch.bandKey && !force) return;
    ch.stateKey = ch.lastKey = key;
    ch.bandKey = ch.lastBandKey = bkey;
    const near = (key & L_NEAR) !== 0, nearFade = (key & L_NEAR_FADE) !== 0, nearCut = (key & L_NEAR_CUT) !== 0;
    const nearCast = (key & L_NEAR_CAST) !== 0, far = (key & L_FAR) !== 0, farFade = (key & L_FAR_FADE) !== 0;
    const farCut = (key & L_FAR_CUT) !== 0, farCast = (key & L_FAR_CAST) !== 0, micro = (key & L_MICRO) !== 0;
    const keep = (key >> L_KEEP_SHIFT) / 20;
    const bNear = (bkey & L_NEAR) !== 0, bNearFade = (bkey & L_NEAR_FADE) !== 0, bNearCut = (bkey & L_NEAR_CUT) !== 0;
    const bNearCast = (bkey & L_NEAR_CAST) !== 0, bFar = (bkey & L_FAR) !== 0, bFarFade = (bkey & L_FAR_FADE) !== 0;
    const bMicro = (bkey & L_MICRO) !== 0, bKeep = (bkey >> L_KEEP_SHIFT) / 20;
    ch.isNear = near || bNear;
    ch.micro = micro;
    const cast = this.castShadows;
    // near meshes: the map trees, then the band trees in reach. Band trees in reach while the map trees are not (the
    // band's box is conservative at corners) draw the map instances through the fade / cut programs, which drop them
    // per instance; the depth pass needs the per-instance cut whenever some submitted instance must not cast
    const nFade = nearFade || bNearFade || (bNear && !near);
    const nCast = cast && (nearCast || bNearCast);
    const nCut = nearCut || bNearCut || (nCast && (!nearCast || (bNear && !bNearCast)));
    const nm = ch.near;
    const nearMat = nFade ? this.matNearFade : this.material, nearDepth = this.depthFor(true, nFade, nCut);
    for (let i = 0; i < nm.length; i++) {
      const m = nm[i];
      if (!m) continue;
      m.visible = ch.isNear && m.count > 0;
      m.castShadow = nCast;
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
    // the band's impostors: never cast (a band tree's shadow is its near model's, within the shadow switch)
    const bMerged = bMicro && !bFarFade && ch.bfar[2] !== null && ch.bfarTotal[2] > 0;
    const bmg = bMicro && !bMerged ? getMicroImpostorGeometries() : null;
    const bFarMat = bFarFade ? this.matFarFade : this.materialFar;
    for (let i = 0; i < 3; i++) {
      const m = ch.bfar[i];
      if (!m) continue;
      if ((i === 2) !== bMerged) {
        m.visible = false;
        continue;
      }
      const tot = ch.bfarTotal[i];
      const c = Math.ceil(tot * bKeep);
      m.count = c < 0 ? 0 : c > tot ? tot : c;
      m.shadowOnly = false;
      m.visible = bFar && m.count > 0;
      m.castShadow = false;
      if (i < 2) {
        m.material = bFarMat;
        m.geometry = bmg ? (i === 0 ? bmg.broad : bmg.conifer) : (m.userData.regularGeo as THREE.BufferGeometry);
      }
    }
    shadowCasters.version++;
  }

  /** per frame: incremental rebuilds + LOD selection. Chunk rebuilds: nearest to the camera first, within buildBudgetMs
   *  (at least one, at most 4 x budget chunks per frame) */
  update(camera: THREE.Camera, budget = 3) {
    // (warm draws of the previous frame that no render drew: back to their own state)
    this.warmFlush();
    // ring work queued between the load and its first frame (a month change by a pre-run of the sim, settings applied
    // before the first frame) is part of the load: done now, like the load's own (flushRing), not in slices later
    const first = this.updates++ === 0;
    if (first && this.ringOn && this.ringPending()) this.flushRing();
    // the load's first frame in a view with a load warm-up (WorldView: its hidden renders right after this frame's,
    // behind the loading veil): those renders draw every ring and edge band mesh this view leaves hidden once (warmMeshes,
    // queued: Shadows.ts loadWarm), so their instance data uploads with the load, not on their first sight in the first
    // zoom-out / zoom-in; the ring's own preload (ringPreload: in this frame) is then not needed
    if (first && loadWarm.open) {
      this.ringPreload = 0;
      loadWarm.queue.push(() => { if (!this.disposed) this.warmMeshes(); });
    }
    // the load's frames build what its later work dirtied at once (LOAD_FRAMES); runtime rebuilds keep to buildBudgetMs
    if (this.dirty.size) {
      if (this.loadFrames > 0) this.buildAll();
      else this.buildDirty(camera.position, budget * 4);
    }
    if (this.loadFrames > 0) this.loadFrames--;
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
    const P = _lodP;
    P[0] = lo; P[1] = hi; P[2] = lod; P[3] = cutLo; P[4] = cutHi; P[5] = K; P[6] = microIn; P[7] = microOut;
    // edge band trees: their own box and LOD (impostors from shadowLodFrac x the distances, see the header); a near
    // edge chunk submits only the band trees within the view's reach (trimBand)
    const bf = this.bandFrac(), BB = this.bandBox;
    const half = (this.state.size * CELL_SIZE) / 2, bandR = hi * bf + Math.hypot(px - half, pz - half);
    let trimmed = false;
    for (let ci = 0; lodChanged && ci < chunks.length; ci++) {
      const ch = chunks[ci], o = ci * 6;
      const key = lodKey(B, o, px, py, pz, 1, ch.micro, true);
      const bkey = BB[o] === BB[o] ? lodKey(BB, o, px, py, pz, 1 / bf, (ch.bandKey & L_MICRO) !== 0, false, BAND_THIN) : 0;
      if (key !== ch.stateKey || bkey !== ch.bandKey) this.applyLod(ch, key, bkey);
      if (ch.bandD && ch.isNear && this.trimBand(ch, (bkey & L_NEAR) !== 0 ? bandR : -1)) trimmed = true;
    }
    if (trimmed) shadowCasters.version++;
    // outer ring: the load generated it at once (constructor / reset / flushRing); runtime work (season / density
    // refills, border-edit regenerations) runs in slices: one per calm frame (camera still or drifting for
    // RING_CALM_FRAMES: zooms, cuts and fast pans / orbits keep their frame time, and so do the catch-up frames after a
    // cut), and while the camera keeps moving one every RING_SLICE_EVERY frames once the work waited RING_MAX_WAIT frames
    const camH = this.ringOn ? py - this.terrain.meshHeightAt(px, pz) : 0;
    const rc = this.ringCam;
    const mv = Math.abs(px - rc[0]) + Math.abs(py - rc[1]) + Math.abs(pz - rc[2]);
    rc[0] = px; rc[1] = py; rc[2] = pz;
    this.ringCalm = mv <= RING_CALM_MOVE * (camH > 25 ? camH : 25) ? this.ringCalm + 1 : 0;
    if (this.ringOn && this.ringPending()) {
      if (this.ringCalm >= RING_CALM_FRAMES && !this.dirty.size) {
        this.ringWait = 0;
        this.ringStep(this.ringBudgetMs);
      } else if (++this.ringWait > RING_MAX_WAIT && this.ringWait % RING_SLICE_EVERY === 0) this.ringStep(this.ringBudgetMs);
    } else this.ringWait = 0;
    this.updateRingView(px, py, pz, lod, camH, camera);
  }

  /**
   * The view's corner rays for the near pairs' view bound (updateRingView): their directions into _rvd, and the gap in
   * their horizontal directions into _rvr ([1] = every direction is within the view's horizontal span: the corner rays
   * surround the camera's own point, as for a camera looking down; else [0], with the widest gap between two corner
   * directions from angle [1] counter-clockwise to [2]). Returns 0 (no bound: not a perspective camera), 1 (every corner
   * ray descends) or 2 (some do not: a view up to the horizon).
   */
  private ringViewDirs(camera: THREE.Camera, px: number, py: number, pz: number): number {
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return 0;
    camera.updateMatrixWorld();
    const D = _rvd, A = _rva;
    let up = false, na = 0;
    for (let i = 0; i < 4; i++) {
      _rv3.set(i & 1 ? 1 : -1, i & 2 ? 1 : -1, 0.5).unproject(camera);
      const dx = _rv3.x - px, dy = _rv3.y - py, dz = _rv3.z - pz, l = Math.hypot(dx, dy, dz) || 1;
      D[i * 3] = dx / l;
      D[i * 3 + 1] = dy / l;
      D[i * 3 + 2] = dz / l;
      if (D[i * 3 + 1] > -1e-4) up = true;
      if (Math.hypot(dx, dz) > 1e-6 * l) A[na++] = (Math.atan2(dz, dx) + Math.PI * 2) % (Math.PI * 2);
    }
    const R = _rvr;
    R[0] = 1;
    if (na >= 2) {
      // (insertion sort of the <= 4 angles in place: no per-frame view allocation)
      for (let i = 1; i < na; i++) {
        const v = A[i];
        let j = i - 1;
        for (; j >= 0 && A[j] > v; j--) A[j + 1] = A[j];
        A[j + 1] = v;
      }
      const s = A;
      let g = s[0] + Math.PI * 2 - s[na - 1], g0 = s[na - 1], g1 = s[0];
      for (let i = 1; i < na; i++) if (s[i] - s[i - 1] > g) { g = s[i] - s[i - 1]; g0 = s[i - 1]; g1 = s[i]; }
      // (a gap of half a turn or more: the view spans the rest; less: the corner rays surround the camera's point)
      if (g >= Math.PI) { R[0] = 0; R[1] = g0; R[2] = g1; }
    }
    return up ? 2 : 1;
  }

  /**
   * The deepest point past sector k's edge(s) (ringDepth, convex) of the view's ground footprint within the horizontal
   * reach hr. A visible point at or above the plane of the sector's lowest tree foot (y0), below the camera, lies on the
   * way from the camera's own point to where its view ray meets that plane, inside the quad of the corner rays: the
   * candidates are the camera's point and the corner rays' ends on that plane and, once the footprint reaches beyond hr
   * (a corner ray meets the plane farther, or not at all), the reach circle within the view's horizontal span
   * (ringViewDirs): its two ends and its point toward the sector's outward normal(s) if that direction lies within the
   * span. The depth is linear along a side sector's normal (convex for a corner sector), so no visible tree foot is
   * deeper than the deepest candidate (RING_VIS_PAD covers the crowns).
   */
  private ringViewDepth(k: number, view: number, px: number, py: number, pz: number, hr: number): number {
    const D = _rvd, R = _rvr, y0 = this.ringBox[k * 6 + 1];
    let t = this.ringDepth(k, px, pz), clipped = view === 2;
    for (let i = 0; i < 4; i++) {
      const dx = D[i * 3], dy = D[i * 3 + 1], dz = D[i * 3 + 2], hl = Math.hypot(dx, dz);
      if (hl < 1e-6) continue;
      let s = hr;
      if (dy < -1e-4 && py > y0) {
        const g = ((y0 - py) / dy) * hl;
        if (g < hr) s = g;
        else clipped = true;
      } else clipped = true;
      const d = this.ringDepth(k, px + (dx / hl) * s, pz + (dz / hl) * s);
      if (d > t) t = d;
    }
    if (clipped) {
      if (R[0] === 0) {
        for (const th of [R[1], R[2]]) {
          const d = this.ringDepth(k, px + Math.cos(th) * hr, pz + Math.sin(th) * hr);
          if (d > t) t = d;
        }
      }
      const ix = RING_SECTORS[k][0], iz = RING_SECTORS[k][1];
      for (let a = 0; a < 2; a++) {
        const side = a === 0 ? ix : iz;
        if (side === 1) continue;
        const nx = a === 0 ? (side === 0 ? -1 : 1) : 0, nz = a === 1 ? (side === 0 ? -1 : 1) : 0;
        if (R[0] === 0) {
          const th = (Math.atan2(nz, nx) + Math.PI * 2) % (Math.PI * 2), g0 = R[1], g1 = R[2];
          if (g0 < g1 ? th > g0 && th < g1 : th > g0 || th < g1) continue;
        }
        const d = this.ringDepth(k, px + nx * hr, pz + nz * hr);
        if (d > t) t = d;
      }
    }
    return t;
  }

  /** outer ring work left (generation, refill, a sector's finish or far block upload) */
  private ringPending(): boolean {
    return !!(this.ringStale || this.ringRefill || this.ringGen || this.ringFillState || this.ringFarDirty) || this.ringAllAt >= 0;
  }

  /** build dirty chunks, nearest to the camera first, until buildBudgetMs is used up (at least `min`, at most `max`) */
  private buildDirty(cp: THREE.Vector3, max: number, min = 1): void {
    const end = performance.now() + this.buildBudgetMs;
    const B = this.chunkBox, px = cp.x, pz = cp.z;
    for (let n = 1; n <= max && this.dirty.size; n++) {
      let best = -1, bd = Infinity;
      for (const id of this.dirty) {
        const o = id * 6;
        const dx = px < B[o] ? B[o] - px : px > B[o + 3] ? px - B[o + 3] : 0;
        const dz = pz < B[o + 2] ? B[o + 2] - pz : pz > B[o + 5] ? pz - B[o + 5] : 0;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = id; }
      }
      this.dirty.delete(best);
      this.buildChunk(best);
      if (n >= min && performance.now() >= end) break;
    }
  }

  /** updateRingView's inputs equal to its last pass's (and stored for the next frame's test) */
  private ringViewSame(px: number, py: number, pz: number, lod: number, camH: number, camera?: THREE.Camera): boolean {
    const K = this.ringViewKey, F = this.ringFadeHeight;
    let same = K[0] === px && K[1] === py && K[2] === pz && K[3] === lod && K[4] === camH && K[5] === F[0] && K[6] === F[1] &&
      K[7] === this.ringLowSwitch && K[8] === (this.ringLowShape ? 1 : 0) && K[9] === this.ringVer && K[42] === this.ringShapeHeight;
    K[0] = px; K[1] = py; K[2] = pz; K[3] = lod; K[4] = camH; K[5] = F[0]; K[6] = F[1];
    K[7] = this.ringLowSwitch; K[8] = this.ringLowShape ? 1 : 0; K[9] = this.ringVer; K[42] = this.ringShapeHeight;
    if (camera) {
      camera.updateMatrixWorld();
      const a = camera.matrixWorld.elements, b = camera.projectionMatrix.elements;
      for (let i = 0; i < 16; i++) {
        if (K[10 + i] !== a[i]) { K[10 + i] = a[i]; same = false; }
        if (K[26 + i] !== b[i]) { K[26 + i] = b[i]; same = false; }
      }
    } else if (K[10] === K[10]) {
      K.fill(NaN, 10);
      same = false;
    }
    return same;
  }

  /**
   * per frame: which outer ring meshes are drawn and how many of their trees. A sector's near pair submits the prefix of
   * its trees (ordered by their depth t beyond the sector's map edge or edges) that can be within the switch distance: a
   * camera e metres inside those edges is at least t + e from a tree at depth t (horizontally; a corner sector's tree
   * at depth t is t past one of its two edges, so the camera's distance inside the other one counts too). Its far blocks show
   * while the camera is high enough (camera height fade) or near the sector's edge(s) (within RING_EDGE_NEAR x
   * lodDistance, where the ring is the horizon at any height), each submitting the prefix of its trees (ordered by their
   * thinning random) that its nearest point keeps; a block entirely within the switch distance draws nothing (its trees
   * are the near pair's). A low camera near the sector's edge(s) (weight lw: below the height fade, near the edge) sees
   * the sector at a grazing angle: its switch distance moves out to ringLowSwitch x lodDistance and its far blocks show
   * mini crowns on trunks (ringLowShape; the crown over its own, higher height band and reach from the edge,
   * ringShapeHeight) - all per sector, exactly as the vertex shaders do it per tree (FAR_VERT_MAIN, RING_LOW_VERT). With
   * the view's camera, a near pair's prefix also ends at the deepest point past the sector's edge(s) of the view's ground
   * footprint (ringViewDirs; + RING_VIS_PAD): a camera beyond the edge looking back at the map does not submit the trees
   * behind it; and every mesh is culled by the box of what it submits against the view's frustum (a near pair: its
   * prefix's, ringNearBox; a far block seen at a grazing angle by a camera near its sector's edge(s): also its cells',
   * ringCellBox), tighter than three's bounding sphere test.
   */
  private updateRingView(px: number, py: number, pz: number, lod: number, camH: number, camera?: THREE.Camera): void {
    if (!this.ringOn) return;
    // (the meshes keep the last pass's counts while nothing it depends on changed; a pending preload always runs)
    if (this.ringViewSame(px, py, pz, lod, camH, camera) && !this.ringPreload) return;
    const ring = this.ring, rf = this.ringFar, W = this.state.size * CELL_SIZE;
    // low cameras: the far blocks fade out with the camera height (seen from inside the city they are hidden or a few
    // specks in the haze); the near pairs show at any height (a camera near the map edge, where the ring is the horizon)
    const fv = _sstep(this.ringFadeHeight[0], this.ringFadeHeight[1], camH);
    const lowSw = lod * Math.max(1, this.ringLowSwitch), shape = this.ringLowShape;
    // (the far blocks' mini crown next to the edge: its own, higher camera height band - ringShapeHeight)
    const fvS = shape ? _sstep(this.ringFadeHeight[0], Math.max(this.ringFadeHeight[1], this.ringShapeHeight), camH) : 1;
    this.ringU.uRingP.value.set(lod, fv, W);
    this.ringU.uRingQ.value.set(lowSw, 1 - fvS);
    const mg = getMicroImpostorGeometries();
    const RB = this.ringBox;
    const view = camera ? this.ringViewDirs(camera, px, py, pz) : 0;
    if (view) _rvF.setFromProjectionMatrix(_rvM.multiplyMatrices(camera!.projectionMatrix, camera!.matrixWorldInverse));
    // (the far blocks drawn: their number, trees and largest keep, and those drawn with the mini crown, for the
    // all-in-one mesh's choice below)
    let nVis = 0, sumVis = 0, keepMax = 0, nLow = 0;
    for (let k = 0; k < RING_N; k++) {
      const ready = this.ringReady[k] !== 0;
      const ix = RING_SECTORS[k][0], iz = RING_SECTORS[k][1];
      // (the camera's distance inside the sector's edge(s): x, z, the nearer)
      const ex = ix === 1 ? Infinity : ix === 0 ? px : W - px, ez = iz === 1 ? Infinity : iz === 0 ? pz : W - pz;
      const e = ex < ez ? ex : ez;
      // near the sector's edge(s): no camera height fade; a low camera there: the low-camera look (weight lw)
      const ne = 1 - _sstep(lod * RING_EDGE_NEAR, lod * RING_SWITCH_LO, e), lw = (1 - fv) * ne;
      const sw = lod + (lowSw - lod) * lw;
      const reach = sw * (RING_SWITCH_LO + RING_SWITCH_SPAN), inner = sw * RING_SWITCH_LO, fvK = fv > ne ? fv : ne;
      // (a camera H above the sector's highest tree reaches horizontally only sqrt(reach^2 - H^2))
      const H = py - RB[k * 6 + 4], hr2 = reach * reach - (H > 0 ? H * H : 0);
      // (a corner sector's tree at depth t is t past one of its edges and 0..t past the other: at least
      // sqrt((ex + t)^2 + max(0, ez)^2) away, or the same with x and z swapped)
      let tMax = -1;
      if (hr2 > 0) {
        if (ix === 1 || iz === 1) tMax = Math.sqrt(hr2) - e;
        else {
          const ax = hr2 - (ez > 0 ? ez * ez : 0), az = hr2 - (ex > 0 ? ex * ex : 0);
          tMax = Math.max(ax > 0 ? Math.sqrt(ax) - ex : -1, az > 0 ? Math.sqrt(az) - ez : -1);
        }
      }
      if (view && ready && tMax >= 0) tMax = Math.min(tMax, this.ringViewDepth(k, view, px, py, pz, Math.sqrt(hr2)) + RING_VIS_PAD);
      for (let m = 0; m < 2; m++) {
        const mesh = ring[k * 2 + m], T = this.ringNearT[k * 2 + m];
        if (!mesh) continue;
        let lo = 0;
        if (ready && T && tMax >= 0) lo = this.ringNearHint[k * 2 + m] = prefixFrom(T, T.length, tMax, true, this.ringNearHint[k * 2 + m]);
        mesh.count = lo;
        // culled by the bounds of the prefix it draws (ringNearBox), with the view's camera also by the box itself here:
        // a corner sector's prefix is a square at its corner, whose bounding sphere (three's test) reaches far into a
        // view along either of its edges
        let vis = lo > 0;
        const P = this.ringNearBox[k * 2 + m];
        if (vis && P) {
          const c = Math.min(P.length / 6, Math.ceil(lo / RING_BOX_STEP)) - 1, o = c * 6, bb = mesh.boundingBox!;
          if (mesh.userData.ringBoxC !== c) {
            mesh.userData.ringBoxC = c;
            bb.min.set(P[o], P[o + 1], P[o + 2]);
            bb.max.set(P[o + 3], P[o + 4], P[o + 5]);
            bb.getBoundingSphere(mesh.boundingSphere!);
          }
          if (view && !_rvF.intersectsBox(bb)) vis = false;
        }
        mesh.visible = vis;
      }
      const far = ready && fvK > 0.001;
      // (the mini crown while its weight is on - over the crown's own height band and reach from the edge, lws: folded
      // at weight 0 it is exactly `top`, see ringLow)
      const lws = (1 - fvS) * (1 - _sstep(lod * RING_SWITCH_LO, lod * RING_CROWN_FAR, e));
      const geo = lws > 0 ? mg.ringLow : mg.top;
      for (let q = 0; q < RING_SUB; q++) {
        const id = k * RING_SUB + q, m = rf[id];
        if (!m) continue;
        if (m.geometry !== geo) m.geometry = geo;
        const n = (m.userData.ringCount as number | undefined) ?? 0, r = this.ringMicroR[id];
        const B = this.ringMicroBox, o = id * 6;
        if (!far || !n || !r) {
          m.visible = false;
          continue;
        }
        // (the farthest a tree's foot can be: the block box's farthest corner, the box holding every tree from its foot)
        const fx = Math.max(Math.abs(px - B[o]), Math.abs(px - B[o + 3])), fz = Math.max(Math.abs(pz - B[o + 2]), Math.abs(pz - B[o + 5]));
        const fy = Math.max(Math.abs(py - B[o + 1]), Math.abs(py - B[o + 4]));
        if (fx * fx + fy * fy + fz * fz < inner * inner) {
          m.visible = false;
          continue;
        }
        // the block's trees the shader can keep (its own keep at the block's nearest point bounds every tree's, the
        // trees are ordered by their random): a prefix
        const d = boxDist(B, o, px, py, pz);
        let keep = RING_KEEP_A - (d - lod) / RING_KEEP_D;
        keep = (keep < RING_KEEP_MIN ? RING_KEEP_MIN : keep > 1 ? 1 : keep) * fvK + 1e-3;
        const lo = this.ringFarHint[id] = prefixFrom(r, n, keep, false, this.ringFarHint[id]);
        m.count = lo;
        // (with the view's camera: culled by the block's box, tighter than three's bounding sphere, and for a camera
        // near the sector's edge(s) that sees it at a grazing angle - the low-camera or the mini crown's weight on - by
        // its cells' boxes (ringCellBox); the high cameras' shape starts at the micro waist, the mini crown at the foot)
        const top = geo === mg.top, y0 = top ? this.ringMicroTopY[id] : B[o + 1];
        m.visible = lo > 0 && (!view || (_rvF.intersectsBox(_rvB.set(_rvP.set(B[o], y0, B[o + 2]), _rvQ.set(B[o + 3], B[o + 4], B[o + 5]))) && ((lw <= 0 && lws <= 0) || this.ringCellsInView(id, top))));
        if (m.visible) {
          nVis++;
          sumVis += lo;
          if (keep > keepMax) keepMax = keep;
          if (!top) nLow++;
        }
      }
    }
    // the far ring in one mesh (ringAll): a high camera (above the camera height fade: no far block faded) that draws
    // several far blocks, all in the high cameras' shape (none with the mini crown), draws it instead, when its looser
    // prefix - the trees below the largest keep of those blocks, all over the ring (the vertex shader drops each tree
    // past its own keep, and the clipper the trees out of view) - costs at most RING_ALL_K more trees per draw call
    // saved: the far views. It draws every tree those blocks would (their prefixes are within its own), with the same
    // program; it waits while a runtime rebuild of it runs (ringAllStep)
    const A = this.ringAll;
    if (A) {
      let all = false;
      if (fv >= 1 && nLow === 0 && nVis >= 2 && this.ringAllAt < 0 && this.ringAllN > 0) {
        const c = prefixFrom(this.ringAllR!, this.ringAllN, keepMax, false, this.ringAllHint);
        if (c - sumVis <= RING_ALL_K * (nVis - 1)) {
          all = true;
          this.ringAllHint = c;
          A.count = c;
          for (let id = 0; id < RING_N * RING_SUB; id++) if (rf[id]) rf[id]!.visible = false;
        }
      }
      A.visible = all;
      if (!all) A.count = 0;
      // (a rebuild unit's instance range: drawn once now, one instance, so it uploads with this frame)
      if (this.ringAllUp) {
        this.ringAllUp = false;
        this.warmDraw(A);
      }
    }
    // the frame after a flushRing (load, quality change, reset): every ring mesh with trees that this frame leaves hidden
    // is drawn once with one instance (warmDraw), so its instance data uploads now instead of on its first sight (the first
    // far zoom-out: ~4 ms over its first frames, measured)
    if (this.ringPreload) {
      this.ringPreload = 0;
      for (const list of [ring, rf]) for (const m of list) if (m && m.userData.ringCount) this.warmDraw(m);
      if (A && this.ringAllN) this.warmDraw(A);
    }
  }

  /** draw tree mesh m (hidden this frame, with instances) once with one instance, not culled: its instance data uploads with
   *  that draw (an upload on its first sight would land on a frame the camera moves in); right after that draw, or at the
   *  next update if no render drew it, it is back to its own state (TreeMesh.warmDone) */
  private warmDraw(m: TreeMesh): void {
    if (m.warmOnce || (m.visible && m.count > 0)) return;
    m.warmVis = m.visible;
    m.warmCount = m.count;
    m.warmCull = m.frustumCulled;
    m.visible = true;
    m.count = 1;
    m.frustumCulled = false;
    m.warmOnce = true;
    this.warmPending.push(m);
  }

  /** the load's warm-up (queued by the first update, run by WorldView right after the load frame's render, before its
   *  hidden warm-up renders): every ring mesh with trees and every edge band impostor mesh with instances that the view
   *  leaves hidden is drawn once, with one instance, by the next render (warmDraw) */
  private warmMeshes(): void {
    for (const list of [this.ring, this.ringFar]) for (const m of list) if (m && m.userData.ringCount) this.warmDraw(m);
    if (this.ringAll && this.ringAllN) this.warmDraw(this.ringAll);
    for (const ch of this.chunks) for (const m of ch.bfar) if (m && ((m.userData.total as number | undefined) ?? 0) > 0) this.warmDraw(m);
  }

  /** warm draws (warmDraw) no render drew: back to their own state */
  private warmFlush(): void {
    const w = this.warmPending;
    if (!w.length) return;
    for (const m of w) if (m.warmOnce) m.warmDone();
    w.length = 0;
  }

  /** far block id: one of its cells' trees (ringCellBox; top: the high cameras' shape, from the micro waist up) is in the
   *  view's frustum (_rvF) */
  private ringCellsInView(id: number, top: boolean): boolean {
    const NC = RING_CELLS * RING_CELLS, CB = this.ringCellBox, CT = this.ringCellTopY;
    for (let i = id * NC; i < (id + 1) * NC; i++) {
      const co = i * 6;
      if (!(CB[co] <= CB[co + 3])) continue;
      if (_rvF.intersectsBox(_rvB.set(_rvP.set(CB[co], top ? CT[i] : CB[co + 1], CB[co + 2]), _rvQ.set(CB[co + 3], CB[co + 4], CB[co + 5])))) return true;
    }
    return false;
  }

  /** synchronous full rebuild (e.g. before a capture); ring: also finish the outer ring's pending work */
  flush(ring = true) {
    this.buildAll();
    if (ring) this.flushRing();
  }

  /** finish the outer ring's pending generation / refills / far block uploads now (and upload its instance data on the
   *  next frame, see updateRingView) */
  private flushRing(): void {
    if (!this.ringOn) return;
    while (this.ringPending()) this.ringStep(Infinity);
    this.ringPreload = 1;
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
   * One slice of the outer ring work, at most ~budgetMs of main-thread time (always at least one unit, so it
   * progresses; every unit is bounded: a block row / candidate batch, a sector's finish, one sector's far block upload):
   * finish the fill / generation in progress, then refill sectors whose candidates are current, then generate stale
   * sectors (each is filled right after its generation; a stale sector is never refilled from its old candidates),
   * then upload the far blocks of the sectors whose trees changed (after the fills: a season reaches every sector's
   * far blocks together).
   */
  ringStep(budgetMs: number): void {
    this.ringVer++;
    if (!this.ringOn) {
      this.ringStale = this.ringRefill = this.ringFarDirty = 0;
      this.ringGen = null;
      this.ringFillState = null;
      this.ringAllAt = -1;
      return;
    }
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
        } else if (this.ringFarDirty) {
          this.rebuildRingFar(31 - Math.clz32(this.ringFarDirty & -this.ringFarDirty));
        } else if (this.ringAllAt >= 0) {
          this.ringAllStep(budgetMs === Infinity);
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
   * (interpolated from the block corners; forest-free blocks skipped, cells whose random exceeds the block's largest
   * corner skipped before their spot is computed; species weights once per block), no water / beaches, no shrubs /
   * rocks (too small out there). Each candidate stores its density threshold (the uniform random over the probability), so any lower
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
        // (time check after every 2nd block, so each call progresses: a block is at most 16 candidates)
        if ((bi & 1) === 1 && bi > gen.bi && performance.now() >= end) {
          gen.bi = bi;
          out = true;
          break;
        }
        const p00 = top[bi], p10 = top[bi + 1], p01 = bot[bi], p11 = bot[bi + 1];
        // (bilinear: never above the largest corner)
        const pmax = Math.max(p00, p10, p01, p11);
        if (pmax <= 0.01) continue;
        const bx = gx0 + bi * BK;
        // species weights once per block (its first tree's spot: the species patches span ~350 m, a block 40 m)
        let wTotal = -1;
        for (let gz = bz; gz < bz + BK && gz < gz1; gz++) {
          for (let gx = bx; gx < bx + BK && gx < gx1; gx++) {
            // (the tree's random first: most cells fail it before their spot is computed)
            const r = hash2(gx * 3 + 1, gz * 5 - 2, seed + 311);
            if (r >= pmax) continue;
            const px = (gx + 0.1 + 0.8 * hash2(gx, gz, seed + 301)) * g, pz = (gz + 0.1 + 0.8 * hash2(gz, gx, seed + 307)) * g;
            if (px < x0 || px >= x1 || pz < z0 || pz >= z1) continue;
            const dx = px < 0 ? -px : px > W ? px - W : 0, dz = pz < 0 ? -pz : pz > W ? pz - W : 0;
            // (the band next to the map belongs to the edge chunks' full trees)
            if ((dx > dz ? dx : dz) < band || dx * dx + dz * dz > R * R) continue;
            const u = (px - bx * g) / (BK * g), v = (pz - bz * g) / (BK * g);
            const p = (p00 * (1 - u) + p10 * u) * (1 - v) + (p01 * (1 - u) + p11 * u) * v;
            if (p <= 0.01 || r >= p) continue;
            const h = this.terrain.worldHeight(px, pz);
            if (h < 1.6) continue;
            // species (season independent)
            if (wTotal < 0) wTotal = this.speciesWeights(Math.floor(px / CELL_SIZE), Math.floor(pz / CELL_SIZE), h, 0, weights);
            const sp = this.pickFrom(weights, wTotal, hash2(gx * 5 + 3, gz * 3 - 1, seed + 313));
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
    // (new candidates: a new tree order)
    this.ringOrder[k] = null;
    this.ringRefill |= 1 << k;
    return true;
  }

  /** start (re)filling sector k's meshes from its candidates at the current density / season (a season refill reuses
   *  the sector's tree order and micro buffers: no sort, no allocation) */
  private ringFillStart(k: number): void {
    const dens = this.ringDensity();
    let ord = this.ringOrder[k];
    if (!ord || ord.dens !== dens) ord = this.ringOrder[k] = this.ringOrderOf(k, dens);
    const counts = [ord.perm[0].length, ord.perm[1].length];
    const imp = getImpostorGeometries();
    const geos = [imp.broad, imp.conifer];
    for (let m = 0; m < 2; m++) {
      const idx = k * 2 + m;
      const mesh = this.meshFor(this.ring[idx], geos[m], this.materialRingNear, Math.max(1, counts[m]), true, false);
      mesh.name = 'trees-ring';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.ring[idx] = mesh;
    }
    const nm = Math.max(1, counts[0] + counts[1]);
    let micro = this.ringMicroAll[k], microCol = this.ringMicroAllCol[k];
    if (!micro || micro.length < nm * 16) micro = this.ringMicroAll[k] = new Float32Array(nm * 16);
    if (!microCol || microCol.length < nm * 3) microCol = this.ringMicroAllCol[k] = new Float32Array(nm * 3);
    const bounds = new Float64Array(12);
    for (let m = 0; m < 2; m++) {
      bounds[m * 6] = bounds[m * 6 + 1] = bounds[m * 6 + 2] = Infinity;
      bounds[m * 6 + 3] = bounds[m * 6 + 4] = bounds[m * 6 + 5] = -Infinity;
    }
    this.ringFillState = { k, i: 0, w: new Int32Array(3), perm: ord.perm, tNear: ord.tNear, bounds, dens, micro, microCol, done: false, q: -1 };
  }

  /**
   * Sector k's near pair order at density dens (see RingOrder; its far block order follows at the sector's first finish):
   * the instances of each class (broadleaf / conifer, all of them also in the micro data) ordered by their depth beyond
   * the sector's map edge(s), so a camera reaches a prefix (updateRingView): keys = depth (0.1 m steps) x 2^14 + the
   * instance's index in its class (< RING_CAP), one numeric sort per class
   */
  private ringOrderOf(k: number, dens: number): RingOrder {
    const buf = this.ringCand[k], n = buf ? this.ringCandN[k] : 0;
    let nb = 0, nc = 0;
    for (let i = 0; i < n; i++) {
      const o = i * RING_STRIDE;
      if (buf![o + 7] >= dens) continue;
      if (this.species[buf![o + 3]].conifer) nc++;
      else nb++;
    }
    const keys = [new Float64Array(nb), new Float64Array(nc)], seen = [0, 0];
    for (let i = 0; i < n; i++) {
      const o = i * RING_STRIDE;
      if (buf![o + 7] >= dens) continue;
      const m = this.species[buf![o + 3]].conifer ? 1 : 0, j = seen[m]++;
      keys[m][j] = Math.round(Math.max(0, this.ringDepth(k, buf![o], buf![o + 2])) * 10) * 16384 + j;
    }
    const perm: Int32Array[] = [], tNear: Float32Array[] = [];
    for (let m = 0; m < 2; m++) {
      const kk = keys[m].sort(), c = kk.length, p = new Int32Array(c), t = new Float32Array(c);
      for (let r = 0; r < c; r++) {
        const key = kk[r], j = key % 16384;
        p[j] = r;
        t[r] = (key - j) / 163840;
      }
      perm.push(p);
      tNear.push(t);
    }
    return { dens, perm, tNear, blk: null, rnd: null };
  }

  /** depth of a ring tree at (x, z) beyond sector k's map edge(s) (corner sectors: the larger of the two) */
  private ringDepth(k: number, x: number, z: number): number {
    const W = this.state.size * CELL_SIZE, ix = RING_SECTORS[k][0], iz = RING_SECTORS[k][1];
    let t = -Infinity;
    if (ix !== 1) t = ix === 0 ? -x : x - W;
    if (iz !== 1) {
      const tz = iz === 0 ? -z : z - W;
      if (tz > t) t = tz;
    }
    return t;
  }

  /**
   * Write the current sector's instances (kind for the season, matrices, colours) straight into its near pair's
   * instance arrays and its micro data until `end`; once complete: upload ranges, counts, bounds, the sector may be drawn
   * and its far blocks are due for an upload. Returns true when complete.
   */
  private ringFillRows(end: number): boolean {
    const f = this.ringFillState!;
    const k = f.k;
    const buf = this.ringCand[k], n = buf ? this.ringCandN[k] : 0;
    const meshes = [this.ring[k * 2]!, this.ring[k * 2 + 1]!];
    const arr = meshes.map((m) => m.instanceMatrix.array as Float32Array);
    const col = meshes.map((m) => m.instanceColor!.array as Float32Array);
    const imp = getImpostorGeometries();
    const geos = [imp.broad, imp.conifer];
    const gb: THREE.Box3[] = [];
    const gr: number[] = [];
    for (const g of geos) {
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox!;
      gb.push(b);
      gr.push(Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z)));
    }
    const bd = f.bounds, w = f.w, perm = f.perm, micro = f.micro, microCol = f.microCol;
    // one instance matrix: horizontal scale hs (+ yaw c / sn), vertical scale vs, base height y
    const mat = (a: Float32Array, o: number, c: number, sn: number, hs: number, vs: number, x: number, y: number, z: number) => {
      a[o] = c * hs; a[o + 1] = 0; a[o + 2] = -sn * hs; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = vs; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = sn * hs; a[o + 9] = 0; a[o + 10] = c * hs; a[o + 11] = 0;
      a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
    };
    // writes one instance into near mesh m (its slot: its rank by depth)
    const put = (m: number, c: number, sn: number, hs: number, vs: number, x: number, y: number, z: number, r: number, gc: number, b: number) => {
      const slot = perm[m][w[m]++];
      mat(arr[m], slot * 16, c, sn, hs, vs, x, y, z);
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
    // the micro copy (far blocks): the double pyramid's top half shaped as the conifer pyramid for conifers
    // (negative blue = evergreen), see-through bare crowns keep their negative red
    const putMicro = (c: number, sn: number, hs: number, vs: number, x: number, y: number, z: number, r: number, gc: number, b: number) => {
      const s = w[2]++;
      mat(micro, s * 16, c, sn, hs, vs, x, y, z);
      microCol[s * 3] = r; microCol[s * 3 + 1] = gc; microCol[s * 3 + 2] = b;
    };
    const winter = this.season.bare > 0.5;
    let i = f.i;
    while (i < n) {
      // (time check every 64 candidates: a batch stays well under the slice budget)
      const stop = i + 64 < n ? i + 64 : n;
      for (; i < stop; i++) {
        const o = i * RING_STRIDE;
        if (buf![o + 7] >= f.dens) continue;
        const px = buf![o], h = buf![o + 1], pz = buf![o + 2];
        const kind = this.kinds[this.kindOf(buf![o + 3], Math.floor(px / CELL_SIZE), Math.floor(pz / CELL_SIZE))];
        const sp = this.species[kind.species];
        const s0 = sp.scale ? sp.scale[0] : 0.72, s1 = sp.scale ? sp.scale[1] : 1.18;
        const wc = winter && kind.conifer;
        const s = (s0 + (s1 - s0) * buf![o + 4]) * 1.1;
        const c = Math.cos(buf![o + 5]), sn = Math.sin(buf![o + 5]);
        const sxz = (kind.radius / 0.42) * s * 0.92 * kind.impR * (wc ? WINTER_CONIFER_R : 1), sy = kind.height * s * (wc ? WINTER_CONIFER_H : 1);
        const cv = buf![o + 6] * (wc ? WINTER_CONIFER_TINT : 1);
        const r0 = kind.color.r * cv, gc = kind.color.g * cv, b = kind.color.b * cv;
        const r = kind.bare ? -Math.max(r0, 1e-4) : r0;
        const y = h - 0.15;
        if (kind.conifer) {
          put(1, c, sn, sxz, sy, px, y, pz, r, gc, b);
          putMicro(c, sn, sxz * RING_CON_R, sy * RING_CON_A, px, y + sy * RING_CON_B, pz, r, gc, -Math.max(b, 1e-4));
        } else {
          put(0, c, sn, sxz, sy, px, y, pz, r, gc, b);
          putMicro(c, sn, sxz, sy, px, y, pz, r, gc, b);
        }
      }
      if (performance.now() >= end) break;
    }
    f.i = i;
    if (i < n) return false;
    if (!f.done) {
      // every instance written: the sector's finish (uploads, far blocks) is the next unit
      f.done = true;
      if (performance.now() >= end) return false;
    }
    if (f.q < 0) {
      this.ringFinishNear(f, meshes);
      f.q = 0;
      if (performance.now() >= end) return false;
    }
    // its far blocks' data, one quarter per unit (copies into reused buffers, in the order of RingOrder)
    while (f.q < RING_SUB) {
      this.ringBlockCopy(k, f.q++, micro, microCol);
      if (f.q < RING_SUB && performance.now() >= end) return false;
    }
    this.ringReady[k] = w[2] > 0 ? 1 : 0;
    this.ringFarDirty |= 1 << k;
    this.ringFillState = null;
    return true;
  }

  /** a filled sector's near pair upload (counts: updateRingView draws the prefix the camera reaches), bounds, and its far
   *  blocks' tree order (RingOrder: computed once per order) */
  private ringFinishNear(f: RingFill, meshes: TreeMesh[]): void {
    const k = f.k, w = f.w, bd = f.bounds;
    for (let m = 0; m < 2; m++) {
      const mesh = meshes[m], cnt = w[m];
      mesh.userData.ringCount = cnt;
      mesh.count = 0;
      mesh.visible = false;
      this.ringNearT[k * 2 + m] = f.tNear[m];
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
      this.ringPrefixBounds(k * 2 + m, mesh, cnt);
    }
    // sector bounds (its per-frame distance): the near pair's union
    const RB = this.ringBox, ro = k * 6;
    for (let a = 0; a < 3; a++) {
      RB[ro + a] = Math.min(bd[a], bd[6 + a]);
      RB[ro + 3 + a] = Math.max(bd[3 + a], bd[9 + a]);
    }
    this.ringBlockOrder(k, f.micro, w[2]);
  }

  /** near mesh i's prefix bounds (ringNearBox) from its cnt instances in slot (depth) order */
  private ringPrefixBounds(i: number, mesh: TreeMesh, cnt: number): void {
    mesh.userData.ringBoxC = -1;
    const nb = Math.ceil(cnt / RING_BOX_STEP);
    if (!nb) {
      this.ringNearBox[i] = null;
      return;
    }
    let P = this.ringNearBox[i];
    if (!P || P.length !== nb * 6) P = this.ringNearBox[i] = new Float64Array(nb * 6);
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    // (the shape's horizontal radius: any yaw)
    let gr = g.userData.ringR as number | undefined;
    if (gr === undefined) {
      const pa = g.getAttribute('position');
      gr = 0;
      for (let j = 0; j < pa.count; j++) gr = Math.max(gr, Math.hypot(pa.getX(j), pa.getZ(j)));
      g.userData.ringR = gr;
    }
    const gb = g.boundingBox!, a = mesh.instanceMatrix.array as Float32Array;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let r = 0; r < cnt; r++) {
      const o = r * 16, rr = gr * Math.hypot(a[o], a[o + 2]), vs = a[o + 5], x = a[o + 12], y = a[o + 13], z = a[o + 14];
      if (x - rr < x0) x0 = x - rr;
      if (x + rr > x1) x1 = x + rr;
      if (z - rr < z0) z0 = z - rr;
      if (z + rr > z1) z1 = z + rr;
      if (y + gb.min.y * vs < y0) y0 = y + gb.min.y * vs;
      if (y + gb.max.y * vs > y1) y1 = y + gb.max.y * vs;
      if ((r + 1) % RING_BOX_STEP === 0 || r === cnt - 1) {
        const q = ((r / RING_BOX_STEP) | 0) * 6;
        P[q] = x0; P[q + 1] = y0; P[q + 2] = z0;
        P[q + 3] = x1; P[q + 4] = y1; P[q + 5] = z1;
      }
    }
  }

  /**
   * The far blocks' tree order of sector k (its n micro impostors, 16 matrix + 3 colour floats each, into its RING_SUB
   * blocks, the quarters of its span), each block ordered by the trees' thinning random (ringRand: a prefix is what a
   * distance keeps). It depends on the trees' positions only: computed at the sector's first finish for its current
   * order (RingOrder) and reused by every season refill, which only copies matrices / colours (ringBlockCopy).
   */
  private ringBlockOrder(k: number, micro: Float32Array, n: number): void {
    let ord = this.ringOrder[k];
    // (a fill always starts from its sector's order; a stand-in keeps a dropped one from breaking the finish)
    if (!ord) ord = this.ringOrder[k] = { dens: -1, perm: [], tNear: [], blk: null, rnd: null };
    if (ord.blk && ord.rnd) return;
    const [x0, x1, z0, z1] = this.ringSpan(k), xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
    const r24 = new Float64Array(n), q8 = new Uint8Array(n), cnt = new Int32Array(RING_SUB);
    for (let i = 0; i < n; i++) {
      const x = micro[i * 16 + 12], z = micro[i * 16 + 14];
      // (ringRand is a 24-bit integer / 2^24: exact as an integer here)
      r24[i] = ringRand(x, z) * 16777216;
      const q = (x >= xm ? 1 : 0) + (z >= zm ? 2 : 0);
      q8[i] = q;
      cnt[q]++;
    }
    const blk: Int32Array[] = [], rnd: Float32Array[] = [];
    for (let q = 0; q < RING_SUB; q++) {
      // keys = the random's integer x 2^14 + the tree's index (< RING_CAP): one numeric sort, no comparator
      const keys = new Float64Array(cnt[q]);
      for (let i = 0, j = 0; i < n; i++) if (q8[i] === q) keys[j++] = r24[i] * 16384 + i;
      keys.sort();
      const idx = new Int32Array(keys.length), rr = new Float32Array(Math.max(1, keys.length));
      for (let j = 0; j < keys.length; j++) {
        const key = keys[j], i = key % 16384;
        idx[j] = i;
        rr[j] = (key - i) / 16384 / 16777216;
      }
      blk.push(idx);
      rnd.push(rr);
    }
    ord.blk = blk;
    ord.rnd = rnd;
  }

  /** far block q of sector k: its trees' micro matrices / colours (micro / col: the sector's data) in the block's order
   *  (ringBlockOrder), into the block's reused buffers, with its bounds */
  private ringBlockCopy(k: number, q: number, micro: Float32Array, col: Float32Array): void {
    const ord = this.ringOrder[k]!, idx = ord.blk![q], rr = ord.rnd![q];
    const id = k * RING_SUB + q, c = idx.length, o = id * 6, B = this.ringMicroBox;
    let m = this.ringMicro[id], cc = this.ringMicroCol[id];
    if (!m || m.length < Math.max(1, c) * 16) m = new Float32Array(Math.max(1, c) * 16);
    if (!cc || cc.length < Math.max(1, c) * 3) cc = new Float32Array(Math.max(1, c) * 3);
    B[o] = B[o + 1] = B[o + 2] = Infinity;
    B[o + 3] = B[o + 4] = B[o + 5] = -Infinity;
    let ty = Infinity;
    for (let j = 0; j < c; j++) {
      const i = idx[j], s = i * 16, d = j * 16;
      for (let e = 0; e < 16; e++) m[d + e] = micro[s + e];
      cc[j * 3] = col[i * 3];
      cc[j * 3 + 1] = col[i * 3 + 1];
      cc[j * 3 + 2] = col[i * 3 + 2];
      // the micro top (the double pyramid's upper half: waist r 0.46 at y 0.63, apex 1) and the low cameras' mini crown
      // (ringLow: rings of r RING_LOW_R, its trunk from the instance's foot) in the instance's frame
      const hs = Math.hypot(micro[s], micro[s + 2]) * RING_BOX_R, vs = micro[s + 5];
      const x = micro[s + 12], y = micro[s + 13], z = micro[s + 14];
      if (x - hs < B[o]) B[o] = x - hs;
      if (y < B[o + 1]) B[o + 1] = y;
      if (z - hs < B[o + 2]) B[o + 2] = z - hs;
      if (x + hs > B[o + 3]) B[o + 3] = x + hs;
      if (y + vs > B[o + 4]) B[o + 4] = y + vs;
      if (z + hs > B[o + 5]) B[o + 5] = z + hs;
      if (y + vs * MICRO_WAIST_Y < ty) ty = y + vs * MICRO_WAIST_Y;
    }
    this.ringMicroTopY[id] = ty;
    // the cells' bounds (by each tree's foot)
    const NC = RING_CELLS * RING_CELLS, CB = this.ringCellBox, CT = this.ringCellTopY, c0 = id * NC;
    for (let i = c0; i < c0 + NC; i++) {
      const co = i * 6;
      CB[co] = CB[co + 1] = CB[co + 2] = Infinity;
      CB[co + 3] = CB[co + 4] = CB[co + 5] = -Infinity;
      CT[i] = Infinity;
    }
    const sx = RING_CELLS / Math.max(1e-6, B[o + 3] - B[o]), sz = RING_CELLS / Math.max(1e-6, B[o + 5] - B[o + 2]);
    for (let j = 0; j < c; j++) {
      const s = idx[j] * 16;
      const hs = Math.hypot(micro[s], micro[s + 2]) * RING_BOX_R, vs = micro[s + 5];
      const x = micro[s + 12], y = micro[s + 13], z = micro[s + 14];
      const gx = Math.min(RING_CELLS - 1, Math.max(0, ((x - B[o]) * sx) | 0)), gz = Math.min(RING_CELLS - 1, Math.max(0, ((z - B[o + 2]) * sz) | 0));
      const ci = c0 + gz * RING_CELLS + gx, co = ci * 6;
      if (x - hs < CB[co]) CB[co] = x - hs;
      if (y < CB[co + 1]) CB[co + 1] = y;
      if (z - hs < CB[co + 2]) CB[co + 2] = z - hs;
      if (x + hs > CB[co + 3]) CB[co + 3] = x + hs;
      if (y + vs > CB[co + 4]) CB[co + 4] = y + vs;
      if (z + hs > CB[co + 5]) CB[co + 5] = z + hs;
      if (y + vs * MICRO_WAIST_Y < CT[ci]) CT[ci] = y + vs * MICRO_WAIST_Y;
    }
    if (!c) {
      B.fill(0, o, o + 6);
      this.ringMicroTopY[id] = 0;
    }
    this.ringMicro[id] = m;
    this.ringMicroCol[id] = cc;
    this.ringMicroR[id] = rr;
    this.ringMicroN[id] = c;
  }

  /** upload sector k's far blocks (its trees changed: drawn as a prefix from the next view update on) */
  private rebuildRingFar(k: number): void {
    this.ringFarDirty &= ~(1 << k);
    // (the all-in-one mesh holds these blocks' trees too: rebuilt once every block upload is done)
    this.ringAllAt = 0;
    for (let q = 0; q < RING_SUB; q++) {
      const id = k * RING_SUB + q, n = this.ringReady[k] && this.ringMicro[id] ? this.ringMicroN[id] : 0;
      let mesh = this.ringFar[id];
      if (!n) {
        if (mesh) { mesh.count = 0; mesh.visible = false; mesh.userData.ringCount = 0; }
        continue;
      }
      mesh = this.ringFar[id] = this.meshFor(mesh, getMicroImpostorGeometries().top, this.materialRing, n, true, false);
      mesh.name = 'trees-ring';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      (mesh.instanceMatrix.array as Float32Array).set(this.ringMicro[id]!.subarray(0, n * 16));
      (mesh.instanceColor!.array as Float32Array).set(this.ringMicroCol[id]!.subarray(0, n * 3));
      const B = this.ringMicroBox, o = id * 6;
      mesh.boundingBox!.min.set(B[o], B[o + 1], B[o + 2]);
      mesh.boundingBox!.max.set(B[o + 3], B[o + 4], B[o + 5]);
      mesh.boundingBox!.getBoundingSphere(mesh.boundingSphere!);
      mesh.count = 0;
      mesh.visible = false;
      mesh.userData.ringCount = n;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, n * 3);
      mesh.instanceColor!.needsUpdate = true;
    }
    let total = 0;
    for (let id = 0; id < RING_N * RING_SUB; id++) if (this.ringReady[(id / RING_SUB) | 0] && this.ringMicro[id]) total += this.ringMicroN[id];
    this.ringInstances = total;
  }

  /**
   * One unit of the all-in-one mesh's (re)build (ringAll, see updateRingView), once every far block upload is done: the
   * next ringAllUnit trees (a flush - load, quality change: all of them) of the merge of the blocks' own orders (each
   * block's trees are sorted by their random: a heap of the blocks by their next tree's random, ties by block id) copied
   * into place in its instance data. The first unit sizes the mesh and starts the merge; a runtime unit's instance range
   * is drawn once right after it (ringAllUp: it uploads on that frame, not all at once on the first far view); the mesh
   * is drawn again only once complete.
   */
  private ringAllStep(flush: boolean): void {
    const NB = RING_N * RING_SUB, cur = this.ringAllCur, heap = this.ringAllHeap, MR = this.ringMicroR;
    if (this.ringAllAt === 0) {
      let n = 0;
      this.ringAllHeapN = 0;
      const B = this.ringMicroBox;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let id = 0; id < NB; id++) {
        cur[id] = 0;
        const c = this.ringReady[(id / RING_SUB) | 0] && this.ringMicro[id] && MR[id] ? this.ringMicroN[id] : 0;
        if (c <= 0) continue;
        n += c;
        heap[this.ringAllHeapN++] = id;
        const o = id * 6;
        if (B[o] < x0) x0 = B[o];
        if (this.ringMicroTopY[id] < y0) y0 = this.ringMicroTopY[id];
        if (B[o + 2] < z0) z0 = B[o + 2];
        if (B[o + 3] > x1) x1 = B[o + 3];
        if (B[o + 4] > y1) y1 = B[o + 4];
        if (B[o + 5] > z1) z1 = B[o + 5];
      }
      this.ringAllTotal = n;
      this.ringAllN = 0;
      if (!n) {
        if (this.ringAll) { this.ringAll.count = 0; this.ringAll.visible = false; this.ringAll.userData.ringCount = 0; }
        this.ringAllAt = -1;
        return;
      }
      for (let i = (this.ringAllHeapN >> 1) - 1; i >= 0; i--) this.ringAllSift(i);
      const mesh = this.ringAll = this.meshFor(this.ringAll, getMicroImpostorGeometries().top, this.materialRing, n, true, false);
      mesh.name = 'trees-ring-all';
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.visible = false;
      mesh.userData.ringCount = 0;
      mesh.boundingBox!.min.set(x0, y0, z0);
      mesh.boundingBox!.max.set(x1, y1, z1);
      mesh.boundingBox!.getBoundingSphere(mesh.boundingSphere!);
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceColor!.clearUpdateRanges();
      if (!this.ringAllR || this.ringAllR.length < n) this.ringAllR = new Float32Array(n);
    }
    const mesh = this.ringAll!, arr = mesh.instanceMatrix.array as Float32Array, col = mesh.instanceColor!.array as Float32Array, R = this.ringAllR!;
    const s0 = this.ringAllAt, s1 = flush ? this.ringAllTotal : Math.min(this.ringAllTotal, s0 + Math.max(1, this.ringAllUnit));
    for (let s = s0; s < s1; s++) {
      const id = heap[0], j = cur[id]++;
      const src = this.ringMicro[id]!, sc = this.ringMicroCol[id]!, o = j * 16, d = s * 16;
      for (let e = 0; e < 16; e++) arr[d + e] = src[o + e];
      col[s * 3] = sc[j * 3];
      col[s * 3 + 1] = sc[j * 3 + 1];
      col[s * 3 + 2] = sc[j * 3 + 2];
      R[s] = MR[id]![j];
      if (cur[id] >= this.ringMicroN[id]) heap[0] = heap[--this.ringAllHeapN];
      if (this.ringAllHeapN > 1) this.ringAllSift(0);
    }
    mesh.instanceMatrix.addUpdateRange(s0 * 16, (s1 - s0) * 16);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.addUpdateRange(s0 * 3, (s1 - s0) * 3);
    mesh.instanceColor!.needsUpdate = true;
    if (s1 >= this.ringAllTotal) {
      this.ringAllAt = -1;
      this.ringAllN = this.ringAllTotal;
      mesh.userData.ringCount = this.ringAllN;
    } else this.ringAllAt = s1;
    if (!flush) this.ringAllUp = true;
  }

  /** the all-in-one merge's heap (ringAllStep): sift the block at position i down (its next tree's random, then its id) */
  private ringAllSift(i: number): void {
    const heap = this.ringAllHeap, cur = this.ringAllCur, MR = this.ringMicroR, n = this.ringAllHeapN;
    const id = heap[i], r = MR[id]![cur[id]];
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      let cid = heap[c], cr = MR[cid]![cur[cid]];
      if (c + 1 < n) {
        const did = heap[c + 1], dr = MR[did]![cur[did]];
        if (dr < cr || (dr === cr && did < cid)) { c++; cid = did; cr = dr; }
      }
      if (cr < r || (cr === r && cid < id)) {
        heap[i] = cid;
        i = c;
      } else break;
    }
    heap[i] = id;
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
    for (const m of c.bfar) {
      if (!m) continue;
      this.group.remove(m);
      m.dispose();
    }
  }

  dispose() {
    this.disposed = true;
    this.dropWarmup();
    for (const c of this.chunks) this.disposeChunk(c);
    this.chunks = [];
    this.disposeRing();
    this.material.dispose();
    this.materialFar.dispose();
    this.materialMerged.dispose();
    this.materialRing.dispose();
    this.materialRingNear.dispose();
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
    // (close-out c1) the kinds' model geometries are the asset registry's shared, cached ones (getNatureGeometry), drawn
    // here directly: each renderer that drew one keeps a dispose listener on it, which kept that renderer — its canvas
    // and GL context — reachable after an exit to the region, one more per visit. dispose() makes each renderer drop its
    // GPU copy and the listener; the geometries stay cached and upload again for the next city
    for (const k of this.kinds) k.geo.dispose();
  }
}
