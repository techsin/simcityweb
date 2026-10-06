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
 * The buildings waiting for an arriving proxy (often hundreds sharing one model) are woken a few per frame
 * (`lodWakeSlice`, and in smooth motion only while fewer than half the fade cap run), so each arrival dissolves them
 * over a few frames instead of swapping them all in one frame (a 1000-3000-swap spike).
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
 * draw-list rebuild). A level change back mid-fade runs the fade backwards. A fade completes after fadeTime or, when
 * the camera moves fast, once its distance to the building changed by `fadeTravel` (a fast zoom dissolves each swap
 * over a few frames instead of drawing both levels of ~1000 buildings for fadeTime); a swap the motion would dissolve
 * within a frame or two anyway (`fadeFast`: fast fly-bys) is instant. Downgrades start dissolving at `fadeOn` x
 * lodPixels (1.0 instead of the instant swap's 0.88), so a zoom-out's dissolve is over about where an instant swap
 * happens: fading never draws a full model farther out than not fading would. Fast pans / orbits (the view shifting
 * or turning by more than `fadeMotion` per frame) cap the concurrent fades down to none: the view changes wholesale
 * there. New / rebuilt buildings, camera cuts, the catch-up frames after a cut (running fades are settled at the cut)
 * and captures (flushLod) swap at once; beyond the cap (`fadeMax`) swaps are instant too. The shadow switches half way
 * through a fade (the level covering most pixels casts: the other level's shadow would streak the visible one, e.g. a
 * proxy's coarser roof shadowing the full model's roof in the first frames). The fade layer's program is not part of
 * the load-time precompile: it is compiled asynchronously a few frames after the first (compileFade), swaps are
 * instant until it is ready.
 * Burnt multi-cell lots are composed from a rubble kit (rubbleKit): one debris bed over the whole lot (exactly over
 * rising ground), heap clusters / big collapsed heaps / outer-wall stubs / a burnt car scattered at hashed offsets,
 * yaws and scales, each with a low-poly proxy it swaps to with the lot at LOD distance; one-cell lots keep prop.ts's
 * rubble tile. Hill lots: real-size stone retaining-wall skirts under lots that sit above the terrain (foundation()),
 * drawn as a plain 8-tri box (foundationLod()) once the building is on its proxy or the skirt is under FOUND_PX tall
 * on screen; shallow skirts / rubble cast no shadow or only into the near cascade.
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../../../core/constants';
import { BF, type Building, type CityState } from '../../../sim/CityState';
import { getDef } from '../../../sim/catalog';
import { getModelGeometry } from '../../../assets/registry';
import { MANIFEST_BY_ID } from '../../../assets/manifest';
import { ModelBuilder } from '../../../assets/ModelBuilder';
import { jitterHex, leafBlob, mark, mixHex, quadOut, shadeHex, tintSince, triOut, type V3 } from '../../../assets/builders/nat_geom';
import { P, profileSolid, type PP } from '../../../assets/builders/veh_parts';
import { RNG } from '../../../core/rng';
import { Surf } from '../../../core/types';
import { DynamicBatch, type TileCuller } from '../common/batch';
import { getCityMaterial, flagsToAlpha, IF_FIRE, IF_SELECTED, IF_WINDOWS_OFF } from '../common/cityMaterial';
import { shadowCasters } from '../../world/Shadows';
import { lodProxyFor } from './lodProxy';
import { lodProxyBuilder, type LodProxyBuilder } from './lodBuilder';

/** LOD proxies stay within their model's bounds + this (m; see tests/render/lod.test.ts) */
const PROXY_PAD = 0.6;
/** vertices reserved per model for its LOD proxy (non-indexed; over all 535 building variants: mean 237, median 222,
 *  p90 372, max 570, <= 200 triangles by tests/render/lod.test.ts) */
const PROXY_VERTS = 256;

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
  /** burnt multi-cell lots (rubble kit, `main` = the debris bed): the debris pieces' instances, their full / proxy
   *  geometries and world matrices (16 floats each), see rubbleKit() */
  cells: number[];
  kitGeo: number[];
  kitLod: number[];
  kitM: Float32Array | null;
  /** burnt one-cell lots: [rise per m along world x, along world z, lift m] of the rubble tile (rubbleSlopes) */
  shear: number[];
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
  /** foundation skirt: full (cap band, stepped tiers) and plain-box geometries, exposed height (m) and level (1 = the
   *  plain box: the building is on its proxy or the skirt is under FOUND_PX tall on screen) */
  foundGeom: number;
  foundLod: number;
  fh: number;
  flod: number;
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
  /** camera distance to the building at the last progress step (travel-driven progress, see fadeTravel) */
  d: number;
}

/** LOD schedule: camera travel (m) per bucket, and ring size (travel horizon; longer slack is re-checked then) */
const LOD_BUCKET = 1;
const LOD_BUCKETS = 4096;
/** camera travel in one frame that counts as a jump (view change / cut): the cut frame only upgrades (flat scan), the
 *  rest is caught up over the next frames. At least LOD_JUMP m and half the camera height (a fast zoom at a far view
 *  moves the camera 100-300 m per frame: smooth motion, sliced) */
const LOD_JUMP = 150;
/** a foundation skirt is drawn as its plain box (no cap band / step tier) while its exposed height projects under this
 *  many pixels (or the building is on its proxy) */
const FOUND_PX = 2;
/** the fade program is compiled after this many frames have drawn the buildings (see compileFade): the first frames
 *  after a load (or a city switch) carry none of its cost */
const FADE_COMPILE_FRAMES = 12;

/** foundation skirt depth (m) for an exposed depth: + 0.8 m into the ground, quantized to 1.2 / 2.2 / 3.4 / 4.8 / 6.8
 *  (bounded geometry count) */
function foundQ(depth: number): number {
  const q = depth + 0.8;
  return q <= 1.2 ? 1.2 : q <= 2.2 ? 2.2 : q <= 3.4 ? 3.4 : q <= 4.8 ? 4.8 : 6.8;
}

const POP_TIME = 0.55;
const _sphere = new THREE.Sphere();
const _pm = new THREE.Matrix4();
const _km = new THREE.Matrix4();
const _dir = new THREE.Vector3();

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

/** rubble bed top above the tile origin is 0.4 m (prop.ts): ground up to this much above the bed plane stays hidden */
const RUBBLE_BED = 0.35;
/** steepest vertical shear (rise per m) a rubble tile follows the ground with */
const RUBBLE_SLOPE = 0.5;
/** a rubble tile's origin plane sinks at most this far (m) below the lot base (no tile tilting into level ground) */
const RUBBLE_SINK = 0.2;
/** ... and floats at most this far (m) over the ground under its cell: the bed's closed sides reach 0.5 m below the
 *  origin (prop.ts), so nothing shows under the bed, only a low charred plinth edge (no slab hanging over a lawn) */
const RUBBLE_HANG = 0.45;
/** cost weight of the bed floating over the ground (taller plinth edges / steps between cells) against ground poking
 *  through the debris floor (both squared m, see rubbleSlopes) */
const RUBBLE_FLOAT_W = 0.3;
/** tilts tried per cell, as fractions of the corner plane's slope (see rubbleSlopes) */
const RUBBLE_TILTS = [1, 0.75, 0.5, 0.25, 0];
/** rubble culling spheres are padded by this (m, instead of PROXY_PAD): DynamicBatch scales a sphere by the matrix's
 *  longest column, which under-reads a shear's stretch (up to x1.27 at RUBBLE_SLOPE on both axes) */
const RUBBLE_PAD = 1.8;
const _sh = new THREE.Matrix4();

/** m = T(x, y + lift, z) · vertical shear (y += ax·dx + az·dz along the WORLD axes: walls stay upright) · m, with
 *  cell k's [ax, az, lift] from rubbleSlopes (none: plain translation) */
function shearOnto(m: THREE.Matrix4, x: number, y: number, z: number, sh: number[], k: number): THREE.Matrix4 {
  const o = k * 3;
  const ax = sh[o] ?? 0, az = sh[o + 1] ?? 0, lift = sh[o + 2] ?? 0;
  _sh.set(1, 0, 0, x, ax, 1, az, y + lift, 0, 0, 1, z, 0, 0, 0, 1);
  return m.premultiply(_sh);
}

// ------------------------------------------------------------------------------------- burnt lots: the rubble kit

/** debris bed top over the lot base (m) where the ground is not higher (prop.ts's one-cell rubble: 0.4 m as well) */
const RUB_TOP = 0.4;
/** the bed's closed sides reach this far under its top edge (0.5 m under the base on level ground) */
const RUB_SIDE = 0.9;
/** LOD metric radius of a rubble lot (m): its pieces are cell-sized, so it swaps detail like a one-cell building */
const RUB_LOD_R = 11.3;
/** footprint radius (m, at scale 1) of a heap cluster / a big heap */
const RUB_CLUSTER_R = 4.7;
const RUB_BIG_R = 10.6;
/** outer-wall stub heights (m) by the burnt building's height class */
const RUB_WALL_H = [1.9, 2.9, 4.2];
/** debris palettes per family (0 charred brick, 1 grey concrete; prop.ts's rubble colours) */
const RUB_HEAP_COLS: readonly (readonly number[])[] = [
  [0x2c2724, 0x3b322d, 0x4a3a30, 0x563428, 0x7a5a48, 0x8c7a66],
  [0x625e58, 0x53504b, 0x6f6a64, 0x3a3734, 0x8c7a66, 0x7a5a48],
];
const RUB_BLOCK_COLS: readonly (readonly number[])[] = [[0x6b3a2c, 0x3a3430, 0x7a4432, 0x7a5a48], [0x8e8a82, 0x6e6a64, 0x8c7a66]];
/** heap layouts of the cluster pieces, [x, z, rx, ry, rz] (m, piece centre at 0): a big heap + a small one, a long
 *  collapsed mass, three medium heaps, a low debris field (with a standing wall stub) */
const RUB_HEAPS: readonly (readonly (readonly [number, number, number, number, number])[])[] = [
  [[-0.6, 0.3, 3.4, 1.35, 2.7], [2.7, -1.9, 1.9, 0.7, 1.6]],
  [[0, 0, 4.0, 1.0, 2.0], [-2.5, 2.2, 1.7, 0.6, 1.5], [2.8, 1.8, 1.4, 0.5, 1.2]],
  [[-2.0, -1.3, 2.4, 1.05, 2.1], [1.9, -0.8, 2.2, 0.9, 1.9], [0.1, 2.1, 2.0, 0.8, 1.8]],
  [[1.6, -1.9, 2.8, 0.6, 2.2], [-1.8, 2.2, 2.0, 0.45, 1.8]],
];

/** height (m over the lot base) of a w x d burnt lot's debris bed at lot-local (x, z): RUB_TOP, or through the corner
 *  heights `tops` ((w + 1) x (d + 1), row-major) on the terrain's own triangle split (diagonal (x + 1, z)-(x, z + 1),
 *  TerrainRenderer.meshHeightAt) */
function bedHeight(w: number, d: number, tops: Float32Array | null, x: number, z: number): number {
  if (!tops) return RUB_TOP;
  const fx = Math.min(w - 1e-6, Math.max(0, x / CELL_SIZE + w / 2)), fz = Math.min(d - 1e-6, Math.max(0, z / CELL_SIZE + d / 2));
  const gx = Math.floor(fx), gz = Math.floor(fz), tx = fx - gx, tz = fz - gz, w1 = w + 1, i = gz * w1 + gx;
  const a = tops[i], b = tops[i + 1], c = tops[i + w1], e = tops[i + w1 + 1];
  return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : e + (c - e) * (1 - tx) + (b - e) * (1 - tz);
}

const _cc = new THREE.Color();
/** an up-facing flat triangle with its own colour (sRGB hex) per corner */
function upTri(mb: ModelBuilder, a: V3, ca: number, b: V3, cb: number, c: V3, cc: number): void {
  // counter-clockwise seen from above (+y normal)
  if ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) < 0) { const t = b; b = c; c = t; const u = cb; cb = cc; cc = u; }
  mb.tri(a, b, c);
  const col = mb.raw().col, o = col.length - 9;
  const put = (k: number, h: number) => { _cc.set(h); col[o + k * 3] = _cc.r; col[o + k * 3 + 1] = _cc.g; col[o + k * 3 + 2] = _cc.b; };
  put(0, ca); put(1, cb); put(2, cc);
}

/** the debris bed's plain tone (prop.ts's rubble bed) */
const RUB_BED_COL = 0x55493f;

/**
 * Ash spill under a debris pile: dark ash at the core, a warmer half tone, then the bed's own tone at an irregular,
 * slightly oval rim of n points around radius r, so the spill has no edge on the bed (the one-cell tile's crisp scorch
 * polygon reads as a sticker once piles are scattered). A very flat cone (7.5 cm at the core, 1.2 cm at the rim over
 * the piece's base): where the spills of neighbouring piles overlap, each point shows the spill it lies deeper inside
 * of, so their tones meet without an edge (and never z-fight). 5 n triangles.
 */
function rubSpill(mb: ModelBuilder, rng: RNG, r: number, n: number, ash: number, tint: number): void {
  // core: ash a third of the way to the bed (a black disc under every pile reads as a hole); mid ring between core and
  // bed warmed by the dust tint (a lighter ring would ring every pile like a target)
  const core = mixHex(ash, RUB_BED_COL, 0.3), dust = mixHex(mixHex(ash, RUB_BED_COL, 0.62), tint, 0.35);
  const a0 = rng.range(0, Math.PI * 2), asp = rng.range(0.72, 1), rot = rng.range(0, Math.PI), cr = Math.cos(rot), sr = Math.sin(rot);
  const ring = (f: number, jit: number, y: number): V3[] => {
    const out: V3[] = [];
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2, rr = r * f * rng.range(1 - jit, 1 + jit);
      const x = Math.cos(a) * rr, z = -Math.sin(a) * rr * asp;
      out.push([x * cr - z * sr, y, x * sr + z * cr]);
    }
    return out;
  };
  const r0 = ring(0.38, 0.25, 0.065), r1 = ring(0.7, 0.2, 0.04), r2 = ring(1, 0.22, 0.012);
  const c: V3 = [0, 0.075, 0];
  mb.paint(core, Surf.Plain);
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    upTri(mb, c, core, r0[k], core, r0[k1], core);
    upTri(mb, r0[k], core, r1[k], dust, r1[k1], dust);
    upTri(mb, r0[k], core, r1[k1], dust, r0[k1], core);
    upTri(mb, r1[k], dust, r2[k], RUB_BED_COL, r2[k1], RUB_BED_COL);
    upTri(mb, r1[k], dust, r2[k1], RUB_BED_COL, r1[k1], dust);
  }
}

/** smooth 2D value noise in [0, 1] (lattice spacing 1, hashed corners from seed) */
function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const h = (i: number, j: number) => (cellHash(i, j, seed) & 0xffff) / 65535;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return (h(ix, iz) * (1 - u) + h(ix + 1, iz) * u) * (1 - v) + (h(ix, iz + 1) * (1 - u) + h(ix + 1, iz + 1) * u) * v;
}

/**
 * Debris bed of a w x d cell burnt lot (lot-local m, origin at the lot centre on its base): ONE surface over the whole
 * lot (no seams between cells), level at RUB_TOP or through every cell corner at `tops` (bedHeight: wherever the ground
 * rises above the base the bed stays RUB_TOP over it, so no hill pokes through and no step shows between cells), a
 * 5.3 m grid (3 x 3 per cell, split like the terrain, so it lies exactly on the creased surface) whose vertex tones
 * drift softly between ash and brick dust at lot scale (no crisp blots), and closed sides RUB_SIDE deep.
 */
function rubbleBed(w: number, d: number, tops: Float32Array | null, seed: number): THREE.BufferGeometry {
  const C = CELL_SIZE, S = 3, hx = (w * C) / 2 - 0.02, hz = (d * C) / 2 - 0.02, w1 = w + 1;
  const mb = new ModelBuilder();
  const top = (i: number, j: number) => (tops ? tops[j * w1 + i] : RUB_TOP);
  const X = (i: number) => Math.max(-hx, Math.min(hx, (i * C) / S - (w * C) / 2));
  const Z = (j: number) => Math.max(-hz, Math.min(hz, (j * C) / S - (d * C) / 2));
  const at = (x: number, z: number): V3 => [x, bedHeight(w, d, tops, x, z), z];
  mb.paint(RUB_BED_COL, Surf.Plain);
  const m0 = mark(mb);
  for (let j = 0; j < d * S; j++) for (let i = 0; i < w * S; i++) {
    const a = at(X(i), Z(j)), b = at(X(i + 1), Z(j)), c = at(X(i), Z(j + 1)), e = at(X(i + 1), Z(j + 1));
    // (split along (i + 1, j)-(i, j + 1) like the terrain cell's own diagonal: every piece lies in one terrain triangle)
    triOut(mb, a, b, c, [0, 1, 0]);
    triOut(mb, b, e, c, [0, 1, 0]);
  }
  // soft lot-scale tone drift: ash-darkened patches and warm brick-dust drifts (~11 m / ~6 m features)
  const s1 = seed * 7 + 11, s2 = seed * 13 + 5;
  tintSince(mb, m0, (p) => {
    const ash = Math.min(1, Math.max(0, (vnoise(p[0] / 11, p[2] / 11, s1) - 0.5) / 0.35)) * 0.22;
    const du = Math.min(1, Math.max(0, (vnoise(p[0] / 6 + 40, p[2] / 6, s2) - 0.5) / 0.35)) * 0.36;
    const k = 1 - ash;
    return [k * (1 + du), k * (1 + du * 0.82), k * (1 + du * 0.6)];
  });
  mb.paint(0x3f3630, Surf.Plain);
  const side = (x0: number, z0: number, t0: number, x1: number, z1: number, t1: number, out: V3) =>
    quadOut(mb, [x0, t0 - RUB_SIDE, z0], [x1, t1 - RUB_SIDE, z1], [x1, t1, z1], [x0, t0, z0], out);
  const ex = (i: number) => Math.max(-hx, Math.min(hx, i * C - (w * C) / 2)), ez = (j: number) => Math.max(-hz, Math.min(hz, j * C - (d * C) / 2));
  for (let i = 0; i < w; i++) {
    side(ex(i), -hz, top(i, 0), ex(i + 1), -hz, top(i + 1, 0), [0, 0, -1]);
    side(ex(i), hz, top(i, d), ex(i + 1), hz, top(i + 1, d), [0, 0, 1]);
  }
  for (let j = 0; j < d; j++) {
    side(-hx, ez(j), top(0, j), -hx, ez(j + 1), top(0, j + 1), [-1, 0, 0]);
    side(hx, ez(j), top(w, j), hx, ez(j + 1), top(w, j + 1), [1, 0, 0]);
  }
  return mb.build();
}

/** a proxy pyramid's tone: the heap's paint mixed with its palette's mean (its faces' mix), darkened like the heap's
 *  shaded lower half */
function heapTone(c: number, cols: readonly number[]): number {
  let m = cols[0];
  for (let i = 1; i < cols.length; i++) m = mixHex(m, cols[i], 1 / (i + 1));
  return shadeHex(mixHex(c, m, 0.55), 0.84);
}

/** jagged broken wall stub along local z (length len, up to hMax tall, 2 hw thick, feet 0.15 m into the bed), sooty
 *  toward its broken top (prop.ts's brokenWall) */
function rubWall(mb: ModelBuilder, rng: RNG, fam: number, len: number, hMax: number, hw: number): void {
  const m = mark(mb);
  const n = Math.max(3, Math.round(len / 2.1));
  const pts: PP[] = [{ z: -len / 2, y: -0.15 }, { z: len / 2, y: -0.15 }];
  for (let i = n; i >= 0; i--) {
    const z = -len / 2 + (len * i) / n + (i > 0 && i < n ? rng.range(-0.3, 0.3) : 0);
    pts.push({ z, y: hMax * (i % 2 === 0 ? rng.range(0.55, 1.0) : rng.range(0.15, 0.5)) });
  }
  profileSolid(mb, pts, hw, fam ? P(0x7e7a72, Surf.Plain) : P(0x7a4432, Surf.Brick));
  tintSince(mb, m, (p) => { const k = 1 - 0.55 * Math.min(1, Math.max(0, p[1]) / hMax); return [k, k * 0.96, k * 0.93]; });
}

/** n tumbled blocks / brick chunks within radius R of (cx, cz) */
function rubBlocks(mb: ModelBuilder, rng: RNG, fam: number, n: number, R: number, small: boolean, cx = 0, cz = 0, rz = R): void {
  const cols = RUB_BLOCK_COLS[fam];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.range(0.05, 1));
    mb.push().translate(cx + Math.cos(a) * r * R, 0.04, cz + Math.sin(a) * r * rz).rotateY(rng.range(0, Math.PI)).rotateX(rng.range(-0.4, 0.4));
    mb.paint(rng.pick(cols), fam ? Surf.Plain : Surf.Brick);
    const s = small ? rng.range(0.3, 0.6) : rng.range(0.45, 0.9);
    mb.box(-s, -0.12, -s * 0.6, s, s * 0.7, s * 0.6, { bottom: null });
    mb.pop();
  }
}

/** n fallen charred beams (brick) / twisted rebar (concrete) lying across the heaps at `at` ([x, z, ...]) */
function rubBeams(mb: ModelBuilder, rng: RNG, fam: number, at: readonly (readonly number[])[], n: number, spread: number): void {
  mb.paint(fam ? 0x5a3a2a : 0x1f1b19, fam ? Surf.Metal : Surf.Wood);
  for (let i = 0; i < n; i++) {
    const h = rng.pick(at);
    const x = h[0] + rng.range(-spread, spread), z = h[1] + rng.range(-spread, spread), a = rng.range(0, Math.PI), L = rng.range(3, 5);
    const dx = (Math.cos(a) * L) / 2, dz = (Math.sin(a) * L) / 2;
    mb.beam([x - dx, rng.range(0.05, 0.35), z - dz], [x + dx, rng.range(0.6, 1.4), z + dz], fam ? 0.07 : 0.24);
  }
}

/** heap-cluster piece k (RUB_HEAPS) of debris family fam, and its proxy (one pyramid per heap) */
function rubbleCluster(fam: number, k: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const rng = new RNG(0x3c11 + fam * 1013 + k * 97);
  const mb = new ModelBuilder(), px = new ModelBuilder();
  const cols = RUB_HEAP_COLS[fam], heaps = RUB_HEAPS[k];
  // ash / dust spill under the pile, fading into the bed
  rubSpill(mb, rng, k === 3 ? 5.2 : 5.8, 9, fam ? 0x35312e : 0x2c2826, jitterHex(rng, fam ? 0x6e675f : 0x7a5a48, 0.05));
  if (k === 3) {
    // the low debris field keeps a standing sooty wall stub
    mb.push().translate(-2.6, 0, 0.8).rotateY(rng.range(-0.5, 0.5));
    rubWall(mb, rng, fam, 5.2, 2.6, fam ? 0.2 : 0.18);
    mb.pop();
  }
  const m2 = mark(mb);
  for (const [x, z, rx, ry, rz] of heaps) {
    const c = rng.pick(cols);
    mb.paint(c, Surf.Plain);
    leafBlob(mb, rng, [x, ry * 0.2 - 0.12, z], [rx, ry, rz], { jitter: 0.16, soft: 0.45, floorY: -0.1, faceColor: () => (rng.chance(0.55) ? jitterHex(rng, rng.pick(cols), 0.08) : null) });
    px.paint(heapTone(c, cols), Surf.Plain).push().translate(x, 0, z).rotateY(rng.range(0, Math.PI));
    px.pyramid(0, 0, rx * 1.45, rz * 1.45, -0.1, ry * 1.05).pop();
  }
  // heaps darken toward the ground
  tintSince(mb, m2, (p) => { const t = 0.72 + 0.28 * Math.min(1, Math.max(0, p[1]) / 1.4); return [t, t, t]; });
  rubBlocks(mb, rng, fam, k === 3 ? 7 : 4, 4.2, k === 3);
  rubBeams(mb, rng, fam, heaps, k === 0 ? 2 : 1, 1.5);
  return [mb.build(), px.build()];
}

/** scattered debris between the piles (layout k): chunks, a couple of beams / rebar and one or two low drifts; its
 *  proxy keeps the drifts */
function rubbleScatter(fam: number, k: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const rng = new RNG(0x6a07 + fam * 211 + k * 41);
  const mb = new ModelBuilder(), px = new ModelBuilder();
  const cols = RUB_HEAP_COLS[fam], at: number[][] = [];
  for (let i = 0; i < 1 + k; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(1, 3.5), x = Math.cos(a) * r, z = Math.sin(a) * r;
    const rx = rng.range(0.9, 1.5), ry = rng.range(0.3, 0.5), rz = rng.range(0.8, 1.3), c = rng.pick(cols);
    mb.paint(c, Surf.Plain);
    leafBlob(mb, rng, [x, ry * 0.2 - 0.1, z], [rx, ry, rz], { jitter: 0.18, soft: 0.45, floorY: -0.08, faceColor: () => (rng.chance(0.5) ? jitterHex(rng, rng.pick(cols), 0.08) : null) });
    px.paint(heapTone(c, cols), Surf.Plain).push().translate(x, 0, z).rotateY(rng.range(0, Math.PI));
    px.pyramid(0, 0, rx * 1.45, rz * 1.45, -0.08, ry * 1.05).pop();
    at.push([x, z]);
  }
  rubBlocks(mb, rng, fam, 6 + k * 2, 5.2, false);
  rubBeams(mb, rng, fam, at, k, 2.2);
  return [mb.build(), px.build()];
}

/** big collapsed heap over a 2 x 2 block of cells (layout k of family fam: a detail-1 core ringed by four smaller heaps,
 *  pancaked floor slabs on the concrete core, a burnt-out car at the edge of layout 1), and its proxy */
function rubbleBigHeap(fam: number, k: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const rng = new RNG(0x8b21 + fam * 733 + k * 59);
  const mb = new ModelBuilder(), px = new ModelBuilder();
  const cols = RUB_HEAP_COLS[fam];
  rubSpill(mb, rng, 11.5, 12, fam ? 0x35312e : 0x2c2826, jitterHex(rng, fam ? 0x6e675f : 0x7a5a48, 0.05));
  const m2 = mark(mb);
  const heap = (x: number, z: number, r: V3, detail: number) => {
    const c = rng.pick(cols);
    mb.paint(c, Surf.Plain);
    leafBlob(mb, rng, [x, r[1] * 0.18 - 0.14, z], r, { detail, jitter: 0.15, soft: 0.42, floorY: -0.1, faceColor: () => (rng.chance(0.55) ? jitterHex(rng, rng.pick(cols), 0.08) : null) });
    px.paint(heapTone(c, cols), Surf.Plain).push().translate(x, 0, z).rotateY(rng.range(0, Math.PI));
    px.pyramid(0, 0, r[0] * 1.45, r[2] * 1.45, -0.1, r[1] * 1.05).pop();
  };
  heap(0, 0, k ? [6.4, 2.9, 6.6] : [7.6, 2.5, 5.6], 1);
  const at: number[][] = [[0, 0]];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng.range(-0.45, 0.45), r = rng.range(6.2, 8.2);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    heap(x, z, [rng.range(1.8, 2.8), rng.range(0.6, 1.15), rng.range(1.6, 2.5)], 0);
    at.push([x, z]);
  }
  tintSince(mb, m2, (p) => { const t = 0.7 + 0.3 * Math.min(1, Math.max(0, p[1]) / 2.4); return [t, t, t]; });
  if (fam) {
    // pancaked floor slabs leaning on the core
    for (let i = 0; i < 3; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(3.2, 5.0);
      mb.push().translate(Math.cos(a) * r, 0.6, Math.sin(a) * r).rotateY(-a + rng.range(-0.4, 0.4)).rotateZ(rng.range(0.2, 0.45));
      mb.paint(jitterHex(rng, 0x8a857c, 0.05), Surf.Plain).box(-2.4, -0.15, -1.7, 2.4, 0.15, 1.7, { bottom: null });
      mb.pop();
    }
  }
  rubBlocks(mb, rng, fam, 8, 9.2, false);
  rubBeams(mb, rng, fam, at, 3, 2.0);
  if (k === 1) {
    mb.push().translate(7.4, 0, -5.2).rotateY(rng.range(0, Math.PI));
    mb.paint(0x4d3a2e, Surf.Metal).box(-0.9, 0.1, -2.2, 0.9, 0.85, 2.2, { bottom: null });
    mb.paint(0x2b2320, Surf.Metal).box(-0.8, 0.85, -1.0, 0.8, 1.25, 0.9, { bottom: null });
    mb.pop();
  }
  return [mb.build(), px.build()];
}

/** outer-wall stub of the burnt building's shell (height class hc, layout k): straight (12 m along local z) or a corner
 *  (7.5 m arms along +x and +z from the origin) with a few chunks at its foot; its proxy is a plain slab per arm */
function rubbleWallPiece(fam: number, corner: boolean, hc: number, k: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const rng = new RNG(0x5e77 + fam * 389 + (corner ? 7919 : 0) + hc * 31 + k * 13);
  const mb = new ModelBuilder(), px = new ModelBuilder();
  const h = RUB_WALL_H[hc] * (k ? 0.85 : 1), hw = fam ? 0.2 : 0.18;
  const tone = shadeHex(fam ? 0x7e7a72 : 0x7a4432, 0.68);
  const arm = (x: number, z: number, yaw: number, len: number, hh: number) => {
    mb.push().translate(x, 0, z).rotateY(yaw);
    rubWall(mb, rng, fam, len, hh, hw);
    rubBlocks(mb, rng, fam, 2, 1.3, true, rng.chance(0.5) ? 0.9 : -0.9, 0, len * 0.4);
    mb.pop();
    px.paint(tone, fam ? Surf.Plain : Surf.Brick).push().translate(x, 0, z).rotateY(yaw);
    px.box(-hw, -0.15, -len / 2, hw, hh * 0.62, len / 2, { pz: null, nz: null, bottom: null }).pop();
  };
  if (!corner) arm(0, 0, 0, 12, h);
  else {
    arm(0, 3.75 - hw, 0, 7.5, h);
    arm(3.75 - hw, 0, Math.PI / 2, 7.5, h * rng.range(0.65, 1));
  }
  return [mb.build(), px.build()];
}

/** a burnt-out car shell (prop.ts's rubble v2 car); its own proxy */
function rubbleCar(): THREE.BufferGeometry {
  const mb = new ModelBuilder();
  mb.paint(0x4d3a2e, Surf.Metal).box(-0.9, 0.1, -2.2, 0.9, 0.85, 2.2, { bottom: null });
  mb.paint(0x2b2320, Surf.Metal).box(-0.8, 0.85, -1.0, 0.8, 1.25, 0.9, { bottom: null });
  return mb.build();
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
 * shadow passes only the level of each fade that casts (own indirect texture). With no slot it is frustum-culled away (it stays
 * `visible`, so the precompile still builds its program).
 */
class LodFadeLayer {
  readonly mesh: THREE.BatchedMesh;
  n = 0;
  private cap = 0;
  private geo = new Int32Array(0);
  /** per slot: its level casts the building's shadow now (one level per fade, see BuildingRenderer.fadeColors) */
  private casts = new Uint8Array(0);
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
      // the fade material follows the city material's scalars (syncCityMaterials) right before it draws: a fade that
      // starts after a long idle stretch must not flash with a stale sky / env intensity in its first frame
      const city = getCityMaterial(), fm = mesh.material as THREE.MeshStandardMaterial;
      fm.envMapIntensity = city.envMapIntensity;
      fm.roughness = city.roughness;
      fm.metalness = city.metalness;
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
      const f = new Uint8Array(cap); f.set(this.casts); this.casts = f;
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

  alloc(owner: Fade, geom: number, casts: boolean): number {
    if (this.n >= this.cap) this.fit(this.cap * 2);
    const s = this.n++;
    this.geo[s] = geom;
    this.casts[s] = casts ? 1 : 0;
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
      this.casts[s] = this.casts[last];
      const o = this.owner[last]!;
      this.owner[s] = o;
      if (o.sOld === last) o.sOld = s;
      else if (o.sNew === last) o.sNew = s;
      this.matDirty = this.colDirty = true;
    }
    this.owner[last] = null;
    this.listDirty = true;
  }

  setCasts(s: number, on: boolean): void {
    const v = on ? 1 : 0;
    if (this.casts[s] !== v) { this.casts[s] = v; this.listDirty = true; }
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
        if (this.casts[s]) { this.shStarts[k] = st; this.shCounts[k] = ct; sh[k] = s; k++; }
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
  /** the camera position of the previous updateLod (how fast each building's distance changes, see fadeFast) */
  private lodPrev = new THREE.Vector3(NaN, NaN, NaN);
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
  /** buildings whose proxy arrived while they waited on their full model (late downgrades): evaluated from lodWakeAt
   *  on, at most lodWakeSlice per frame and, while swaps may fade, only while fewer than fadeMax / 2 fades run (see
   *  wakeWaiting); cut frames leave them for the next frames */
  private lodWake: BInst[] = [];
  private lodWakeAt = 0;
  /** woken buildings evaluated per frame (x4 when swaps are instant: no fade to pace) */
  lodWakeSlice = 64;
  private disposed = false;
  /** dense list of instances for the per-frame LOD sweep */
  private list: BInst[] = [];
  /** flat copies per list index for the jump scan: LOD centre, scan radius, level (1 = proxy or plain skirt; see flat) */
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
  /** a fade also completes once the camera's distance to the building changed by this much (log ratio, 0 = off):
   *  during fast zooms / pans the dissolve follows the motion that causes it (a few frames at a fast zoom) instead of
   *  trailing it by fadeTime with both levels of hundreds of buildings drawn; ~half the +-12% hysteresis band */
  fadeTravel = 0.12;
  /** at most this many buildings fade at once (more swaps in a frame are instant) */
  fadeMax = 1024;
  /** buildings fading in / out now smaller than lodPixels x this swap instantly (sub-threshold specks) */
  fadeMinFrac = 0.4;
  /** swaps the camera motion would dissolve within 1 / fadeFast frames (the building's camera distance changed by more
   *  than fadeTravel x fadeFast in log this frame: fast pans / fly-bys) are instant: the view changes wholesale there, a
   *  1-2 frame dissolve is invisible and only churns the fade layer (0 = off) */
  fadeFast = 0.5;
  /** downgrade threshold (x lodPixels) while swaps may fade (fadeTime > 0; instant swaps: 0.88): a downgrade dissolve
   *  starts here and, over its fadeTravel of camera travel, ends about where the instant swap happens, so a fading
   *  zoom-out draws the full model no farther out than an instant one would (the upgrade threshold stays 1.12) */
  fadeOn = 1;
  /** view motion per frame (lateral camera shift / view distance + turn, rad) from which the number of concurrent fades
   *  is cut down (fadeMax up to the first value, none from the second): fast pans and orbits change the view wholesale,
   *  a dissolve there is invisible and only draws both levels */
  fadeMotion: [number, number] = [0.02, 0.06];
  /** fadeMax scaled down by this frame's view motion (see fadeMotion) */
  private fadeCap = 1024;
  /** the fade layer's program is compiled: it is compiled asynchronously a few frames after the first one that drew the
   *  buildings (not in the load-time precompile, see compileFade); until then every swap is instant */
  fadeReady = false;
  /** 0 waiting for FADE_COMPILE_FRAMES drawn frames, 1 compile at the next update, 2 compiling, 3 ready */
  private fadeStage = 0;
  private fadeFrames = 0;
  private fadeFrameNo = -1;
  private fadeRc: { r: THREE.WebGLRenderer; scene: THREE.Object3D; cam: THREE.Camera; rt: THREE.WebGLRenderTarget | null } | null = null;
  /** view direction at the previous updateLod (view turn rate, see fadeMotion) */
  private lodDir = new THREE.Vector3(NaN, NaN, NaN);
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
  /** rubble kit pieces: key -> [full, proxy] geometry ids (see kitPiece) */
  private kitIds = new Map<string, [number, number]>();
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
    // the fade layer joins the scene graph only when its program is compiled (compileFade): the load-time precompile
    // (PostFX.compileScene) must not block the first frame on it
    this.fadeLayer = new LodFadeLayer(this.batch.mesh, this.batch.mesh.customDepthMaterial);
    const mesh = this.batch.mesh, before = mesh.onBeforeRender;
    mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      // frames that drew the buildings: after FADE_COMPILE_FRAMES of them, compile the fade program at the next update
      if (this.fadeStage === 0) {
        const fr = renderer.info.render.frame;
        if (fr !== this.fadeFrameNo) { this.fadeFrameNo = fr; this.fadeFrames++; }
        if (this.fadeFrames >= FADE_COMPILE_FRAMES) {
          this.fadeStage = 1;
          this.fadeRc = { r: renderer, scene, cam: camera, rt: renderer.getRenderTarget() };
        }
      }
      before.call(mesh, renderer, scene, camera, geometry, material, group);
    };
  }

  /**
   * Compile the fade layer's program off the load path: once FADE_COMPILE_FRAMES frames have drawn the buildings (the
   * load-time precompile, PostFX.compileScene, does not see the layer: it joins the scene graph here), with that scene
   * pass's render target bound (the same output variant, as compileScene does) and asynchronously where
   * KHR_parallel_shader_compile exists (three's compileAsync polls the program instead of blocking on it). Fades start
   * once it is ready (fadeReady); a quality change recompiles the scene, the layer included, as before.
   */
  private compileFade(): void {
    const rc = this.fadeRc;
    this.fadeRc = null;
    if (!rc || this.disposed) return;
    this.fadeStage = 2;
    const mesh = this.fadeLayer.mesh;
    this.batch.mesh.add(mesh);
    const r = rc.r, prev = r.getRenderTarget();
    let done: Promise<unknown>;
    try {
      r.setRenderTarget(rc.rt);
      done = r.compileAsync(mesh, rc.cam, rc.scene as THREE.Scene);
    } catch {
      // (compiled lazily by the first fade instead)
      done = Promise.resolve();
    } finally {
      r.setRenderTarget(prev);
    }
    done.then(() => { if (!this.disposed) { this.fadeStage = 3; this.fadeReady = true; } }, () => {});
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
    if (fresh) this.batch.padSphere(id, model === 'rubble' ? RUBBLE_PAD : PROXY_PAD);
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
      // (paced by wakeWaiting: a model shared by hundreds of buildings must not swap them all in one frame)
      for (const bi of w) {
        if (bi.waiting !== geom) continue;
        bi.waiting = -1;
        if (bi.due !== -2 && bi.geom === geom) this.lodWake.push(bi);
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
   * tiers so tall ones read as graded retaining walls instead of a hard grey cake plate. The depth q is quantized
   * (foundQ) to bound the geometry count. 16 triangles (34 stepped); far away it is drawn as foundationLod's plain box.
   */
  private foundation(sw: number, sd: number, q: number): number {
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

  /** the skirt's far level: one plain box at its real size (no cap band, no step tier; 8 triangles like the old scaled
   *  skirt) in the mean tone of the skirt's exposed part (a shallow skirt shows mostly its dark 0.3 m cap band), sharing
   *  the full skirt's culling sphere (a swap never rebuilds a list) */
  private foundationLod(full: number, sw: number, sd: number, q: number): number {
    const w = Math.round(sw * 10) / 10, d = Math.round(sd * 10) / 10;
    const key = `__foundation:${w}x${d}:${q}:lod`;
    const fresh = !this.batch.hasGeometry(key);
    const id = this.batch.geometryId(key, () => {
      const hx = w / 2 - 0.1, hz = d / 2 - 0.1;
      const tone = mixHex(0x8a8274, 0x6e675b, Math.min(1, 0.3 / (q - 0.8)));
      return new ModelBuilder().paint(tone, Surf.Stone).box(-hx, -q, -hz, hx, 0, hz, { top: null, bottom: null }).build();
    });
    if (fresh) this.batch.shareSphere(full, id, 0.05);
    return id;
  }

  /** the far level of a level w x d debris bed: one quad in the bed's mean tone + its sides (10 tris), sharing the full
   *  bed's culling sphere */
  private bedLod(full: number, w: number, d: number): number {
    const key = `__rubble:bedlod:${w}x${d}`;
    const fresh = !this.batch.hasGeometry(key);
    const id = this.batch.geometryId(key, () => {
      const hx = (w * CELL_SIZE) / 2 - 0.02, hz = (d * CELL_SIZE) / 2 - 0.02, mb = new ModelBuilder();
      return mb.paint(0x52463c, Surf.Plain).box(-hx, RUB_TOP - RUB_SIDE, -hz, hx, RUB_TOP, hz, { top: { color: 0x52463c, surf: Surf.Plain }, px: { color: 0x3f3630, surf: Surf.Plain }, nx: { color: 0x3f3630, surf: Surf.Plain }, pz: { color: 0x3f3630, surf: Surf.Plain }, nz: { color: 0x3f3630, surf: Surf.Plain } }).build();
    });
    if (fresh) this.batch.shareSphere(full, id, 0.05);
    return id;
  }

  /** a rubble-kit piece's [full, proxy] geometry ids, built on first use: the proxy shares the full piece's culling
   *  sphere, padded for the vertical shear onto slopes (DynamicBatch scales a sphere by the matrix's longest column,
   *  which under-reads a shear's stretch by up to ~10% at RUBBLE_SLOPE) */
  private kitPiece(key: string, make: () => [THREE.BufferGeometry, THREE.BufferGeometry]): [number, number] {
    const done = this.kitIds.get(key);
    if (done) return done;
    const [g, p] = make();
    const full = this.batch.geometryId(`__rubble:${key}`, () => g);
    const prox = p === g ? full : this.batch.geometryId(`__rubble:${key}#lod`, () => p);
    this.batch.padSphere(full, 0.1 * this.batch.bounds(full).getBoundingSphere(_sphere).radius + 0.3);
    if (prox !== full) this.batch.shareSphere(full, prox, 0.3);
    const ids: [number, number] = [full, prox];
    this.kitIds.set(key, ids);
    return ids;
  }

  /**
   * Burnt multi-cell lot from the rubble kit (see rubbleBed and the piece builders): the debris bed is bi.main (level
   * lots share a bed per lot size and variant; on a slope the lot gets its own bed through max(ground, base) + RUB_TOP
   * at every cell corner), the debris pieces are bi.cells: big collapsed heaps over 2 x 2 blocks of interior cells (or
   * over a whole 2 x 2 lot / around the middle of a 3 x 3 lot, sometimes), a heap cluster on most other cells at a
   * hashed offset (up to 3.5 m, kept inside the lot), any yaw and 0.85-1.15 scale, a bare cell now and then, broken
   * outer-wall stubs (L pieces at the corners) on about half of the lot's edge cells 1.4-2.4 m inside its edge (the
   * burnt building's shell: brick or concrete and their height from the building that burnt), and on some lots a
   * burnt-out car. Every piece rests on the bed: a plane fitted to the bed under its footprint (vertical shear, walls
   * stay upright), lowered where the bed sags so it nowhere floats more than 8 cm (feet reach 10-15 cm into the bed).
   * At LOD distance every piece swaps to its proxy (pyramids / slabs) with the lot. Returns the pieces' top (m over the
   * base).
   */
  private rubbleKit(bi: BInst): number {
    const b = bi.b, st = this.state, N = st.size, N1 = N + 1, H = st.heights, base = b.baseY, C = CELL_SIZE;
    const w = b.w, d = b.d, hx = (w * C) / 2, hz = (d * C) / 2;
    const lotH = cellHash(b.x, b.z, b.id ^ 0x2c1b3c6d);
    const rng = new RNG(lotH || 1);
    // bed corners: max(ground, base) + RUB_TOP; level unless the ground rises (nearly) through the level bed somewhere
    const tops = new Float32Array((w + 1) * (d + 1));
    let sloped = false;
    for (let j = 0; j <= d; j++) for (let i = 0; i <= w; i++) {
      const g = H[Math.min(N, b.z + j) * N1 + Math.min(N, b.x + i)] - base;
      tops[j * (w + 1) + i] = Math.max(0, g) + RUB_TOP;
      if (g > RUB_TOP - 0.05) sloped = true;
    }
    const T = sloped ? tops : null, bv = lotH % 3;
    const bedKey = sloped ? `__rubble:bed:${w}x${d}:${Array.from(tops, (t) => Math.round(t * 100)).join(',')}` : `__rubble:bed:${w}x${d}:${bv}`;
    const bed = this.batch.geometryId(bedKey, () => rubbleBed(w, d, T, sloped ? lotH : 0x1b5 + bv * 7919 + w * 31 + d * 131));
    // far away a level bed is one plain quad + its sides (its tone drift is sub-pixel there); a sloped bed keeps its
    // shape (it must stay over the ground)
    bi.geom = bed;
    bi.lodGeom = sloped ? bed : this.bedLod(bed, w, d);
    bi.main = this.batch.add(bi.lod ? bi.lodGeom : bed);
    // (the bed lies on the ground: it casts no shadow)
    this.batch.setShadowCascades(bi.main, 0);
    // debris family and wall height from the building that burnt: charred brick for low houses / walk-ups / shops,
    // grey concrete for tall blocks and industry (one lot in five the other way)
    const model = modelIdOf(b);
    const hTop = MANIFEST_BY_ID[model]?.height[1] ?? 12;
    const fam = (hTop >= 22 || model.startsWith('ind_') ? 1 : 0) ^ (lotH % 5 === 0 ? 1 : 0);
    const hc = hTop < 10 ? 0 : hTop < 30 ? 1 : 2;
    type Piece = { ids: [number, number]; x: number; z: number; yaw: number; s: number; r: number };
    const pieces: Piece[] = [];
    const clampIn = (v: number, lim: number) => Math.max(-Math.max(0, lim), Math.min(Math.max(0, lim), v));
    const used = new Uint8Array(w * d);
    // big heaps: sw x sd cells from (i0, j0) (and the cells in `also`) take one heap at the block's centre
    const big = (i0: number, j0: number, sw: number, sd: number, also: number[] = []) => {
      for (let j = j0; j < j0 + sd; j++) for (let i = i0; i < i0 + sw; i++) used[j * w + i] = 1;
      for (const c of also) used[c] = 2;
      const k = rng.int(0, 1), s = rng.range(0.88, 1.06), R = RUB_BIG_R * s;
      const x = (i0 + sw / 2) * C - hx + rng.range(-1.5, 1.5), z = (j0 + sd / 2) * C - hz + rng.range(-1.5, 1.5);
      pieces.push({ ids: this.kitPiece(`big${fam}.${k}`, () => rubbleBigHeap(fam, k)), x: clampIn(x, hx - R - 0.5), z: clampIn(z, hz - R - 0.5), yaw: rng.range(0, Math.PI * 2), s, r: R });
    };
    if (w >= 4 && d >= 4) {
      // 2 x 2 blocks of interior cells (either parity where the interior is odd)
      const oi = (w - 2) % 2 && rng.chance(0.5) ? 1 : 0, oj = (d - 2) % 2 && rng.chance(0.5) ? 1 : 0;
      for (let j = 1 + oj; j + 1 <= d - 2; j += 2) for (let i = 1 + oi; i + 1 <= w - 2; i += 2) if (rng.chance(0.85)) big(i, j, 2, 2);
    } else if (w === 3 && d === 3) {
      // the middle collapsed into one heap spilling into the edge-middle cells
      if (rng.chance(0.55)) big(1, 1, 1, 1, [1, 3, 5, 7]);
    } else if (w === 2 && d === 2 && rng.chance(0.5)) big(0, 0, 2, 2);
    // heap clusters on the other cells (a few left bare, some with a second, smaller pile)
    const cluster = (cx: number, cz: number, s: number, jit: number) => {
      const k = rng.int(0, 3), R = RUB_CLUSTER_R * s;
      const x = cx + rng.range(-jit, jit), z = cz + rng.range(-jit, jit);
      pieces.push({ ids: this.kitPiece(`cl${fam}.${k}`, () => rubbleCluster(fam, k)), x: clampIn(x, hx - R - 0.6), z: clampIn(z, hz - R - 0.6), yaw: rng.range(0, Math.PI * 2), s, r: R });
    };
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
      const cx = (i + 0.5) * C - hx, cz = (j + 0.5) * C - hz;
      // scattered chunks / beams between the piles on most cells
      if (rng.chance(0.65)) {
        const k = rng.int(0, 1);
        pieces.push({ ids: this.kitPiece(`sc${fam}.${k}`, () => rubbleScatter(fam, k)), x: clampIn(cx + rng.range(-5, 5), hx - 6), z: clampIn(cz + rng.range(-5, 5), hz - 6), yaw: rng.range(0, Math.PI * 2), s: rng.range(0.9, 1.2), r: 5.5 });
      }
      if (used[j * w + i]) {
        // the cells a big heap spills into: a smaller pile pushed toward the lot edge
        if (used[j * w + i] === 2) cluster(cx + Math.sign(cx) * 3, cz + Math.sign(cz) * 3, rng.range(0.7, 0.9), 1.5);
        continue;
      }
      if (rng.chance(0.04)) continue;
      if (rng.chance(0.35)) {
        // two piles on opposite sides of the cell
        const a = rng.range(0, Math.PI * 2);
        cluster(cx + Math.cos(a) * 4, cz + Math.sin(a) * 4, rng.range(1.0, 1.2), 1.5);
        cluster(cx - Math.cos(a) * 4.5, cz - Math.sin(a) * 4.5, rng.range(0.8, 1.0), 1.5);
      } else cluster(cx, cz, rng.range(1.15, 1.5), 3.5);
    }
    // the burnt shell: outer-wall stubs on about half of the edge cells, 1.4-2.4 m inside the lot's edge
    const inset = rng.range(1.4, 2.4), ex = hx - inset, ez = hz - inset;
    const wall = (corner: boolean) => { const k = rng.int(0, 1); return this.kitPiece(`w${fam}.${corner ? 1 : 0}.${hc}.${k}`, () => rubbleWallPiece(fam, corner, hc, k)); };
    const flip = () => (rng.chance(0.5) ? Math.PI : 0);
    if (w >= 2 && d >= 2) {
      // corners: L pieces (arms along the piece's +x / +z) turned onto the lot's inside
      for (const [x, z, yaw] of [[-ex, -ez, 0], [ex, -ez, -Math.PI / 2], [-ex, ez, Math.PI / 2], [ex, ez, Math.PI]]) {
        if (rng.chance(0.6)) pieces.push({ ids: wall(true), x, z, yaw, s: 1, r: 7.6 });
      }
      for (let i = 1; i < w - 1; i++) for (const sz of [-1, 1]) {
        if (rng.chance(0.55)) pieces.push({ ids: wall(false), x: (i + 0.5) * C - hx + rng.range(-1.5, 1.5), z: sz * ez, yaw: Math.PI / 2 + flip(), s: 1, r: 6.2 });
      }
      for (let j = 1; j < d - 1; j++) for (const sx of [-1, 1]) {
        if (rng.chance(0.55)) pieces.push({ ids: wall(false), x: sx * ex, z: (j + 0.5) * C - hz + rng.range(-1.5, 1.5), yaw: flip(), s: 1, r: 6.2 });
      }
    } else {
      // one cell wide: stubs along the two long sides
      const alongX = w > 1, n = alongX ? w : d;
      for (let i = 0; i < n; i++) for (const sd of [-1, 1]) {
        if (!rng.chance(0.5)) continue;
        const t = (i + 0.5) * C - (alongX ? hx : hz) + rng.range(-1.5, 1.5);
        pieces.push({ ids: wall(false), x: alongX ? t : sd * ex, z: alongX ? sd * ez : t, yaw: (alongX ? Math.PI / 2 : 0) + flip(), s: 1, r: 6.2 });
      }
    }
    // a burnt-out car on some lots (near one edge)
    if (w * d >= 3 && rng.chance(0.4)) {
      const side = rng.int(0, 3), t = rng.range(-0.6, 0.6);
      const x = side < 2 ? (side ? 1 : -1) * (hx - 3.4) : t * Math.max(0, hx - 4), z = side < 2 ? t * Math.max(0, hz - 4) : (side === 3 ? 1 : -1) * (hz - 3.4);
      pieces.push({ ids: this.kitPiece('car', () => { const g = rubbleCar(); return [g, g]; }), x, z, yaw: rng.range(0, Math.PI * 2), s: 1, r: 2.4 });
    }
    // rest every piece on the bed
    const M = new Float32Array(pieces.length * 16);
    const clampS = (s: number) => Math.max(-RUBBLE_SLOPE, Math.min(RUBBLE_SLOPE, s));
    const cx = (b.x + w / 2) * C, cz = (b.z + d / 2) * C;
    let top = RUB_TOP;
    for (let k = 0; k < pieces.length; k++) {
      const pc = pieces[k];
      let y = bedHeight(w, d, T, pc.x, pc.z), ax = 0, az = 0;
      if (T) {
        const h = pc.r * 0.5;
        ax = clampS((bedHeight(w, d, T, pc.x + h, pc.z) - bedHeight(w, d, T, pc.x - h, pc.z)) / (2 * h));
        az = clampS((bedHeight(w, d, T, pc.x, pc.z + h) - bedHeight(w, d, T, pc.x, pc.z - h)) / (2 * h));
        let lift = 0;
        for (let q = 0; q < 8; q++) {
          const a = (q / 8) * Math.PI * 2, ox = Math.cos(a) * pc.r * 0.85, oz = Math.sin(a) * pc.r * 0.85;
          lift = Math.max(lift, y + ax * ox + az * oz - bedHeight(w, d, T, pc.x + ox, pc.z + oz) - 0.08);
        }
        y -= lift;
      }
      const m = this.m4.makeRotationY(pc.yaw).scale(this.s.set(pc.s, pc.s, pc.s));
      _sh.set(1, 0, 0, cx + pc.x, ax, 1, az, base + y, 0, 0, 1, cz + pc.z, 0, 0, 0, 1);
      m.premultiply(_sh).toArray(M, k * 16);
      const id = this.batch.add(bi.lod ? pc.ids[1] : pc.ids[0]);
      bi.cells.push(id);
      bi.kitGeo.push(pc.ids[0]);
      bi.kitLod.push(pc.ids[1]);
      // small casters: the near cascade only
      this.batch.setShadowCascades(id, 1);
      top = Math.max(top, y + this.batch.bounds(pc.ids[0]).max.y * pc.s + (Math.abs(ax) + Math.abs(az)) * pc.r);
    }
    bi.kitM = M;
    return top;
  }

  /**
   * Burnt one-cell lots (prop.ts's rubble tile; bigger lots use the rubble kit): a vertical shear + lift into bi.shear
   * so the tile's bed lies on the ground where the ground rises above the lot base. Lots are levelled to their base only where
   * the sim could (edge corners at roads / neighbours stay put), so on hills the up-slope side of a lot keeps its
   * slope: a flat bed there had grass poking through the debris. A tile is rigid (one matrix, world-vertical shear:
   * walls stay upright) while the ground under a cell is two triangles (TerrainRenderer.meshHeightAt), so the bed
   * rests on the best plane that neither floats more than RUBBLE_HANG over the ground (the bed's skirt still reaches
   * into it) nor tilts into the level base (RUBBLE_SINK): candidates are the corner plane at a few tilts (RUBBLE_TILTS)
   * and the four planes through three corners (one terrain triangle each), each at a few lifts between resting on the
   * ground and RUBBLE_HANG above it; the one with the least ground above the debris floor plus RUBBLE_FLOAT_W x bed
   * above the ground wins (sums of squares over 5 x 5 samples). A uniform slope is followed exactly; a cell with one
   * raised corner (twisted: no plane fits) tilts / lifts part of the way (a low plinth edge on the down-slope side)
   * and the hill rises over the rest of that corner, like any lot cut into a slope (a one-cell tile is rigid; the kit's
   * bed of bigger lots follows the ground exactly). Returns the highest bed rise (m).
   */
  private rubbleSlopes(bi: BInst): number {
    const b = bi.b, st = this.state, N = st.size, N1 = N + 1, H = st.heights, base = b.baseY;
    const sh = bi.shear;
    sh.length = 0;
    const rise = (x: number, z: number) => Math.max(0, H[Math.min(N, z) * N1 + Math.min(N, x)] - base);
    const C = CELL_SIZE, half = C / 2, clampS = (s: number) => Math.max(-RUBBLE_SLOPE, Math.min(RUBBLE_SLOPE, s));
    let top = 0;
    for (let k = 0, n = b.w * b.d; k < n; k++) {
      const x = b.x + (k % b.w), z = b.z + Math.floor(k / b.w);
      const r00 = rise(x, z), r10 = rise(x + 1, z), r01 = rise(x, z + 1), r11 = rise(x + 1, z + 1);
      if (Math.max(r00, r10, r01, r11) <= RUBBLE_BED) { sh.push(0, 0, 0); continue; }
      // ground rise at (tx, tz) in [0, 1]^2 of the cell, on the rendered triangulation (diagonal (x+1, z)-(x, z+1))
      const ground = (tx: number, tz: number) => (tx + tz <= 1 ? r00 + (r10 - r00) * tx + (r01 - r00) * tz : r11 + (r01 - r11) * (1 - tx) + (r10 - r11) * (1 - tz));
      // corner plane (average edge slopes), then the planes through three corners
      const ax0 = (r10 + r11 - r00 - r01) / (2 * C), az0 = (r01 + r11 - r00 - r10) / (2 * C);
      const cand: [number, number][] = RUBBLE_TILTS.map((t) => [ax0 * t, az0 * t]);
      cand.push([(r10 - r00) / C, (r01 - r00) / C], [(r11 - r01) / C, (r11 - r10) / C], [(r10 - r00) / C, (r11 - r10) / C], [(r11 - r01) / C, (r01 - r00) / C]);
      let best = Infinity, bx = 0, bz = 0, bl = 0;
      for (const [cx0, cz0] of cand) {
        const ax = clampS(cx0), az = clampS(cz0);
        // the ground is linear on each triangle and so is the plane: the extremes of ground - plane lie at the corners.
        // rest: the lift where the plane touches the ground (under it everywhere else); lo: the lowest lift keeping the
        // plane within RUBBLE_SINK of the base
        let rest = Infinity, lo = -Infinity;
        for (const [r, sx, sz] of [[r00, -1, -1], [r10, 1, -1], [r01, -1, 1], [r11, 1, 1]]) {
          const s = (ax * sx + az * sz) * half;
          rest = Math.min(rest, r - s);
          lo = Math.max(lo, -RUBBLE_SINK - s);
        }
        const hi = rest + RUBBLE_HANG, l0 = Math.max(lo, rest);
        if (l0 > hi + 1e-9) continue;
        // lifts from resting on the ground up to RUBBLE_HANG over it (the cost is convex in the lift: 5 samples)
        for (let li = 0; li <= 4; li++) {
          const lift = l0 + ((hi - l0) * li) / 4;
          let cost = 0;
          for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
            const tx = i / 4, tz = j / 4, g = ground(tx, tz), o = lift + (ax * (tx - 0.5) + az * (tz - 0.5)) * C;
            const over = g - o - RUBBLE_BED;
            if (over > 0) cost += over * over;
            else if (o > g) cost += RUBBLE_FLOAT_W * (o - g) * (o - g);
          }
          // (ties: the earlier candidate, i.e. the steeper corner plane, and the lower lift)
          if (cost < best - 1e-9) { best = cost; bx = ax; bz = az; bl = lift; }
        }
      }
      sh.push(bx, bz, bl);
      top = Math.max(top, bl + (Math.abs(bx) + Math.abs(bz)) * half);
    }
    return top;
  }

  clear(): void {
    for (const bi of this.inst.values()) { this.freeInstances(bi); bi.due = -2; }
    this.inst.clear();
    this.list.length = 0;
    for (const q of this.lodBuckets) q.length = 0;
    this.lodNow.length = 0;
    this.lodWake.length = 0;
    this.lodWakeAt = 0;
    this.lodCount = 0;
    this.lodBehind = false;
    this.animating.clear();
    this.fadeLayer.sync();
  }

  rebuildAll(): void {
    this.clear();
    for (const b of this.state.buildings.values()) this.add(b, false);
    // room for the proxies the worker is about to deliver and their 3-vertex cross-fade stand-ins, and for the rubble
    // kit's pieces (~12k vertices, built when the first big lot burns): growing the batch's vertex buffer later would
    // re-upload all of it in some frame (reserveVertices adds 25%)
    this.batch.reserveVertices(this.lodPending.size * (PROXY_VERTS + 3) + (this.kitIds.size ? 0 : 12000));
  }

  private freeInstances(bi: BInst): void {
    if (bi.fade) this.dropFade(bi.fade);
    if (bi.main >= 0) this.batch.remove(bi.main);
    if (bi.site >= 0) this.batch.remove(bi.site);
    if (bi.found >= 0) this.batch.remove(bi.found);
    for (const id of bi.cells) this.batch.remove(id);
    bi.cells.length = 0;
    bi.kitGeo.length = 0;
    bi.kitLod.length = 0;
    bi.kitM = null;
    bi.shear.length = 0;
    bi.main = bi.site = bi.found = -1;
    bi.foundGeom = bi.foundLod = -1;
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
    // (rubble does not pop in)
    if (b.flags & BF.Burnt) animate = false;
    const bi: BInst = {
      b, main: -1, site: -1, found: -1, cells: [], kitGeo: [], kitLod: [], kitM: null, shear: [], tile: 0, key: '', flags: 0, cr: 1, cg: 1, cb: 1, anim: animate ? POP_TIME : 0, geom: -1,
      vis: null as unknown as BuildingVisual, lodGeom: -1, siteGeom: -1, siteLod: -1, lod: 0, radius: 1, cy: 0, minH: 0, foundGeom: -1, foundLod: -1, fh: 0, flod: 0,
      li: this.list.length, due: -1, now: false, waiting: -1, fresh: true, fade: null,
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
    // burnt: one-cell lots keep prop.ts's rubble tile (sheared onto the ground, rubbleSlopes); bigger lots are composed
    // from the rubble kit (one debris bed + scattered pieces, rubbleKit) instead of one heap stretched over the lot
    const kit = burnt && b.w * b.d > 1;
    bi.siteGeom = bi.siteLod = -1;
    let geom: number, modelTop: number;
    if (kit) {
      // (bi.geom = bi.lodGeom = the bed: the pieces carry the lot's levels)
      modelTop = this.rubbleKit(bi);
      geom = bi.geom;
    } else {
      geom = burnt ? this.geomFor('rubble', b.id) : this.geomFor(model, b.variant);
      bi.geom = geom;
      // a building currently drawn as a proxy gets its new model's proxy right away if it exists (no detail pop; without
      // a worker it is built now), else it shows the full model until the worker delivers; for the others the proxy is
      // looked up by updateLod (-1 until then)
      bi.lodGeom = this.proxyOf(geom, bi.lod === 1 && !this.proxies);
      if (bi.lod === 1 && (bi.lodGeom < 0 || bi.lodGeom === geom)) {
        bi.lod = 0;
        this.lodCount--;
        if (bi.lodGeom < 0) this.waitFor(bi, geom);
      }
      // keep the current LOD state across rebuilds (state changes must not pop the detail level)
      bi.main = this.batch.add(bi.lod ? bi.lodGeom : geom);
      modelTop = this.batch.bounds(geom).max.y;
    }
    const bounds = this.batch.bounds(geom);
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
    bi.fh = 0;
    if (depth > 0.08) {
      const q = foundQ(depth), sw = b.w * CELL_SIZE, sd = b.d * CELL_SIZE;
      bi.foundGeom = this.foundation(sw, sd, q);
      bi.foundLod = this.foundationLod(bi.foundGeom, sw, sd, q);
      bi.fh = depth;
      // (keeps its level across rebuilds like the building)
      bi.found = this.batch.add(bi.flod ? bi.foundLod : bi.foundGeom);
      // shadows only from skirts that can cast one wider than a shadow texel or so: up to 0.4 m exposed none, up to
      // 1.4 m only into the near cascade
      this.batch.setShadowCascades(bi.found, q <= 1.2 ? 0 : q <= 2.2 ? 1 : 0xff);
    } else bi.flod = 0;
    bi.tile = this.culler.tileOf(b.x + (b.w >> 1), b.z + (b.d >> 1));
    // flags / tint
    let flags = 0;
    if (abandoned) flags |= IF_WINDOWS_OFF;
    if (burning) flags |= IF_FIRE;
    if (this.selected === b.id) flags |= IF_SELECTED;
    bi.flags = flags;
    // one-cell rubble on a slope rises with the ground (rubbleSlopes): its top / LOD centre follow
    const rise = burnt && !kit ? this.rubbleSlopes(bi) : 0;
    bi.vis = {
      id: b.id, model: burnt ? 'rubble' : model, variant: b.variant, cx, cz, baseY: b.baseY, yaw, sw: b.w * CELL_SIZE, sd: b.d * CELL_SIZE,
      top: b.baseY + modelTop + rise, bounds, burning, burnt, constructing, abandoned, sy: 1,
    };
    this.culler.noteHeight(bi.tile, bi.vis.top);
    const sp = bounds.getBoundingSphere(_sphere);
    bi.radius = kit ? RUB_LOD_R : Math.max(2, sp.radius);
    bi.cy = kit ? b.baseY + RUB_TOP + 1 : b.baseY + sp.center.y + (bi.shear.length ? bi.shear[2] : 0);
    const li = bi.li;
    this.lx[li] = cx; this.ly[li] = bi.cy; this.lz[li] = cz;
    this.flat(bi);
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
      const km = bi.kitM;
      if (km) {
        // rubble kit: the bed in lot-local coordinates at the lot origin, the pieces at their matrices (rubbleKit)
        for (let k = 0; k < bi.cells.length; k++) this.batch.setMatrix(bi.cells[k], _km.fromArray(km, k * 16));
        this.m4.makeTranslation(v.cx, v.baseY, v.cz);
      } else if (v.burnt) {
        const fw = b.rot & 1 ? b.d : b.w, fd = b.rot & 1 ? b.w : b.d;
        this.m4.compose(this.v.set(0, 0, 0), yawQ, this.s.set(fw * 0.9, 1, fd * 0.9));
        shearOnto(this.m4, v.cx, v.baseY, v.cz, bi.shear, 0);
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
    // the fade program, once the first frame has drawn the buildings (see compileFade)
    if (this.fadeStage === 1) this.compileFade();
    const c = camera.position;
    // px = radius / dist * H / (2 tan(fov/2)): swap to the proxy beyond dist = radius * K / on, back within radius * K / off
    const K = (heightPx / Math.tan((camera.fov * Math.PI) / 360)) * 0.5;
    if (this.lodDirty || this.lodPixels !== this.lastLodPixels || !(Math.abs(K - this.lodK) < 0.25)) {
      // new metric (quality preset, FOV, resize) or a flush: every building is due now
      this.lodDirty = false;
      this.lastLodPixels = this.lodPixels;
      this.lodK = K;
      // (flat: a plain skirt's scan radius scales with lodPixels)
      for (const bi of this.list) { this.flat(bi); this.lodQueue(bi); }
    }
    const p = this.lodPos;
    const hop = p.x === p.x ? Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z) : 0;
    this.lodTravel += hop;
    this.lodPrev.copy(p);
    p.copy(c);
    // view motion this frame: the camera's shift across its view (relative to the distance it looks at) plus its turn;
    // fast pans / orbits get fewer (no) new fades (fadeMotion)
    const f = camera.getWorldDirection(_dir), q0 = this.lodDir;
    let motion = 0;
    if (q0.x === q0.x && hop > 0) {
      const hx = c.x - this.lodPrev.x, hy = c.y - this.lodPrev.y, hz = c.z - this.lodPrev.z;
      const along = hx * f.x + hy * f.y + hz * f.z;
      const lat = Math.sqrt(Math.max(0, hop * hop - along * along));
      motion = lat / (f.y < -0.05 ? Math.max(30, c.y / -f.y) : 3000);
    }
    if (q0.x === q0.x) motion += Math.acos(Math.min(1, Math.max(-1, f.x * q0.x + f.y * q0.y + f.z * q0.z)));
    q0.copy(f);
    const [m0, m1] = this.fadeMotion;
    this.fadeCap = motion <= m0 ? this.fadeMax : motion >= m1 ? 0 : Math.floor((this.fadeMax * (m1 - motion)) / (m1 - m0));
    const cur = Math.floor(this.lodTravel / LOD_BUCKET);
    if (cur - this.lodAt >= LOD_BUCKETS - 2) {
      // a jump beyond the schedule horizon: everything is due
      for (const q of this.lodBuckets) q.length = 0;
      for (const bi of this.list) this.lodQueue(bi);
      this.lodAt = cur + 1;
    }
    const behind = this.lodBehind;
    if (!this.lodNow.length && this.lodAt > cur && !behind && this.lodWakeAt >= this.lodWake.length) { this.fadeLayer.sync(); return; }
    // downgrades: while swaps may fade, the dissolve starts at fadeOn x lodPixels and its camera travel (fadeTravel)
    // ends it near 0.88 x, where an instant swap happens: a fading zoom-out draws no full model farther out than an
    // instant one; upgrades at 1.12 x (the full model appears where it would without a fade)
    const on = this.lodPixels * (this.fadeTime > 0 ? Math.min(1.08, this.fadeOn) : 0.88), off = this.lodPixels * 1.12;
    this.lodDeadline = performance.now() + this.lodBudgetMs;
    const full = this.lodFull;
    this.lodFull = false;
    // a jump (view change, camera cut): the cut frame upgrades every proxy that is now close (a slice would leave big
    // buildings in view on their proxies for a frame or two); the downgrades wait for the catch-up frames
    const jump = !full && hop > Math.max(LOD_JUMP, c.y * 0.5);
    this.lodCamera = camera;
    this.lodKNow = K;
    this.frOk = false;
    // cross-fades only in smooth motion: not in a flush, a cut frame or the catch-up frames after a cut (behind). The
    // view changed as a whole there, and the late downgrades (buildings already under lodPixels) swap at once instead
    // of drawing both levels of up to fadeMax buildings for fadeTime
    this.fadeNow = !full && !jump && !behind && this.fadeTime > 0;
    // a cut settles the running fades (their buildings mostly left the view, and the fade layer is not culled)
    if (jump) while (this.fades.length) this.finishFade(this.fades[this.fades.length - 1]);
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
    // buildings whose proxy arrived (they waited on their full model): a few per frame, never in a cut frame
    if (this.lodWakeAt < this.lodWake.length && !jump) this.wakeWaiting(c, K, on, off, cur, full);
    this.lodBehind = this.lodNow.length > 0 || this.lodAt <= cur;
    this.fadeLayer.sync();
  }

  /** evaluate buildings woken by an arriving proxy (lodWake): a flush takes all; else lodWakeSlice per frame — while
   *  swaps may fade only as long as fewer than half the fade cap run (each wake dissolves; the rest waits for the
   *  running fades), x4 when swaps are instant anyway. Those buildings are already past their downgrade distance on
   *  their full model, so pacing them only delays a GPU saving, never shows the wrong detail up close */
  private wakeWaiting(c: THREE.Vector3, K: number, on: number, off: number, cur: number, all: boolean): void {
    const q = this.lodWake;
    const fading = this.fadeNow && this.fadeReady && this.fadeCap > 0;
    let n = all ? Infinity : fading ? Math.min(this.lodWakeSlice, (this.fadeCap >> 1) - this.fades.length) : this.lodWakeSlice * 4;
    while (n > 0 && this.lodWakeAt < q.length) {
      const bi = q[this.lodWakeAt++];
      // removed, queued / scheduled by another evaluation meanwhile, or waiting again (rebuilt with a new model)
      if (bi.due !== -1 || bi.now || bi.waiting >= 0) continue;
      this.lodEval(bi, c, K, on, off, cur);
      n--;
    }
    if (this.lodWakeAt >= q.length) { q.length = 0; this.lodWakeAt = 0; }
  }

  /** every building drawn as a proxy (or with a plain foundation box) that is now within its upgrade distance gets its
   *  full model: evaluated now when it is in the view, else queued first for the catch-up frames (out of view it only
   *  draws into shadows). A flat pass over typed arrays: ~10k buildings in well under a millisecond */
  private upgradeScan(c: THREE.Vector3, K: number, on: number, off: number, cur: number): void {
    const lx = this.lx, ly = this.ly, lz = this.lz, lr = this.lr, ls = this.ls, list = this.list;
    const px = c.x, py = c.y, pz = c.z, off2 = off * off, K2 = K * K;
    const fr = this.viewFrustum();
    for (let i = 0, n = list.length; i < n; i++) {
      if (!ls[i]) continue;
      const dx = lx[i] - px, dy = ly[i] - py, dz = lz[i] - pz;
      const r = lr[i];
      if ((dx * dx + dy * dy + dz * dz) * off2 >= r * r * K2) continue;
      _sphere.center.set(lx[i], ly[i], lz[i]);
      _sphere.radius = list[i].radius;
      if (!fr || fr.intersectsSphere(_sphere)) this.lodEval(list[i], c, K, on, off, cur);
      else this.lodQueue(list[i]);
    }
    // the selected building is always drawn full
    if (this.selected != null) {
      const s = this.inst.get(this.selected);
      if (s && (s.lod || s.flod)) this.lodEval(s, c, K, on, off, cur);
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
    // (rubble kit lots: the pieces carry the levels)
    const levels = bi.kitM !== null || bi.lodGeom !== bi.geom || bi.siteLod !== bi.siteGeom;
    // no proxy and no foundation: always full, nothing to schedule (a rebuild re-queues it)
    if (!levels && bi.found < 0) { this.lodSet(bi, 0); return; }
    const v = bi.vis;
    const dx = v.cx - c.x, dy = bi.cy - c.y, dz = v.cz - c.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rk = bi.radius * K;
    const lim = this.lodPixels > 0 && bi.b.id !== this.selected;
    const want = levels && lim && d * (bi.lod ? off : on) > rk ? 1 : 0;
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
      if (pg === bi.geom && bi.siteLod === bi.siteGeom && bi.found < 0) { this.lodSet(bi, 0); return; }
      if (pg === bi.geom && bi.siteLod === bi.siteGeom) return this.lodEval(bi, c, K, on, off, cur);
    }
    this.lodSet(bi, want);
    // foundation skirt: its plain box with the proxy, or while its exposed height projects under FOUND_PX (distance fk;
    // +-12% hysteresis like the buildings)
    const fk = (bi.fh * K) / FOUND_PX;
    const fw = bi.found >= 0 && (want || (lim && d * (bi.flod ? 1.12 : 0.88) > fk)) ? 1 : 0;
    this.setFound(bi, fw);
    // LOD off / selected: stays full until the metric or the selection changes (both re-queue)
    if (!lim) return;
    // camera travel before a swap distance can be reached (the building's; while it is full also its skirt's); the
    // bucket at or before that travel (at least the next)
    let slack = levels ? (want ? d - rk / off : rk / on - d) : Infinity;
    if (bi.found >= 0 && !want) slack = Math.min(slack, fw ? d - fk / 1.12 : fk / 0.88 - d);
    // (capped one ring lap past the oldest unprocessed bucket, so no live entry shares a slot that is still pending)
    const b = Math.min(this.lodAt + LOD_BUCKETS - 1, Math.max(cur + 1, Math.floor((this.lodTravel + Math.max(0, slack)) / LOD_BUCKET)));
    bi.due = b;
    this.lodBuckets[b % LOD_BUCKETS].push(bi);
  }

  /** a building's foundation level (1 = the plain box) */
  private setFound(bi: BInst, f: number): void {
    if (bi.found < 0 || bi.flod === f) return;
    bi.flod = f;
    this.flat(bi);
    this.batch.setGeometry(bi.found, f ? bi.foundLod : bi.foundGeom);
  }

  /** the upgrade scan's view of a building (ls / lr): drawn below full detail (proxy or plain skirt), and the radius
   *  whose upgrade distance (radius x K / off) the scan tests: the building's own on its proxy (its skirt follows it),
   *  else its skirt's (exposed height x lodPixels / FOUND_PX: the skirt turns full within that, only near the camera) */
  private flat(bi: BInst): void {
    const i = bi.li;
    this.ls[i] = bi.lod | bi.flod;
    this.lr[i] = bi.lod ? bi.radius : (bi.fh * this.lodPixels) / FOUND_PX;
  }

  private lodSet(bi: BInst, want: number): void {
    if (want === bi.lod) return;
    bi.lod = want;
    this.lodCount += want ? 1 : -1;
    this.flat(bi);
    const f = bi.fade;
    // a level change back mid-fade: the fade runs backwards from where it is (in smooth motion; else it settles on the
    // new level at once)
    if (f) {
      if (this.fadeNow) this.reverseFade(f);
      else this.finishFade(f);
    } else if (bi.main >= 0) {
      const from = want ? bi.geom : bi.lodGeom, to = want ? bi.lodGeom : bi.geom;
      if (from !== to && this.canFade(bi)) this.startFade(bi, from, to);
      else this.batch.setGeometry(bi.main, to);
    }
    if (bi.site >= 0) this.batch.setGeometry(bi.site, want ? bi.siteLod : bi.siteGeom);
    // rubble kit: every piece swaps with the lot (shared culling spheres: no list rebuild)
    for (let k = 0; k < bi.cells.length; k++) this.batch.setGeometry(bi.cells[k], want ? bi.kitLod[k] : bi.kitGeo[k]);
  }

  // ------------------------------------------------------------------ LOD cross-fade
  /** fade this swap? (smooth camera motion, not the building's first level, in the view, not a sub-threshold speck) */
  private canFade(bi: BInst): boolean {
    if (!this.fadeNow || !this.fadeReady || this.evalFresh || this.fades.length >= this.fadeCap || bi.cells.length || !this.lodCamera) return false;
    const d = this.camDist(bi);
    // projected radius (px) = radius * K / d
    if (bi.radius * this.lodKNow < d * this.lodPixels * this.fadeMinFrac) return false;
    // fast relative motion: the travel-driven dissolve (see update) would be over in a frame or two
    if (this.fadeFast > 0 && this.fadeTravel > 0) {
      const q = this.lodPrev, dx = bi.vis.cx - q.x, dy = bi.cy - q.y, dz = bi.vis.cz - q.z;
      if (Math.abs(Math.log(d / Math.sqrt(dx * dx + dy * dy + dz * dz))) > this.fadeTravel * this.fadeFast) return false;
    }
    _sphere.center.set(bi.vis.cx, bi.cy, bi.vis.cz);
    _sphere.radius = bi.radius;
    return this.viewFrustum()!.intersectsSphere(_sphere);
  }

  /** distance from the LOD camera to a building's LOD centre (0 without a camera) */
  private camDist(bi: BInst): number {
    const cam = this.lodCamera;
    if (!cam) return 0;
    const c = cam.position, dx = bi.vis.cx - c.x, dy = bi.cy - c.y, dz = bi.vis.cz - c.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
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
    const f: Fade = { bi, p: 0, sOld: -1, sNew: -1, i: this.fades.length, d: this.camDist(bi) };
    // (the old level keeps casting the shadow until half way, see fadeColors)
    f.sOld = L.alloc(f, from, true);
    f.sNew = L.alloc(f, to, false);
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
    f.p = 1 - f.p;
    this.fadeColors(f);
  }

  /** write both levels' fade codes (smoothstep of the progress) and which one casts the shadow: the level covering
   *  more pixels (the old one until half way) */
  private fadeColors(f: Fade): void {
    const bi = f.bi, p = f.p, t = p * p * (3 - 2 * p), L = this.fadeLayer;
    L.setColor(f.sNew, bi.cr, bi.cg, bi.cb, fadeAlpha(bi.flags, true, t));
    L.setColor(f.sOld, bi.cr, bi.cg, bi.cb, fadeAlpha(bi.flags, false, t));
    L.setCasts(f.sNew, p >= 0.5);
    L.setCasts(f.sOld, p < 0.5);
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
      const kt = this.fadeTime > 0 ? dt / this.fadeTime : 1;
      // progress by time, or faster by the camera's relative distance change to the building (fadeTravel)
      const kd = this.fadeTravel > 0 && this.lodCamera ? 1 / this.fadeTravel : 0;
      // (backwards: a finished fade is replaced by the last one, which was already advanced)
      for (let i = this.fades.length - 1; i >= 0; i--) {
        const f = this.fades[i];
        let k = kt;
        if (kd > 0) {
          const d = this.camDist(f.bi);
          if (f.d > 0 && d > 0) k = Math.max(k, Math.abs(Math.log(d / f.d)) * kd);
          f.d = d;
        }
        f.p += k;
        if (f.p >= 1) this.finishFade(f);
        else this.fadeColors(f);
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
