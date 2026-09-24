/**
 * BuildingRenderer — every building in ONE BatchedMesh (plus foundation skirts / construction sites / rubble in the
 * same batch). Incremental add/remove/change via Simulation events, pop-in animation, construction rising,
 * abandoned / burning / burnt looks, selection flag.
 *
 * Culling: per render pass (main view and each shadow cascade get their own draw list, see DynamicBatch
 * enablePassCulling); instances are registered in map tiles.
 * LOD: buildings whose projected radius drops below `lodPixels` swap to an auto-generated massing proxy
 * (lodProxy.ts, 12-40 triangles, same material / windows / night lights) with hysteresis; see updateLod(). A model's
 * proxy is generated the first time a building needs it, within `lodBudgetMs` per frame (flushLod() for captures).
 * Each building is re-evaluated only when the camera has travelled far enough to possibly carry it across its swap
 * distance, so a panning camera costs a few evaluations per frame and a still one none.
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
import { lodProxyFor } from './lodProxy';

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
  tile: number;
  key: string;
  flags: number;
  anim: number;
  vis: BuildingVisual;
  geom: number;
  /** proxy geometry ids (= full id when the model has no proxy) */
  lodGeom: number;
  siteGeom: number;
  siteLod: number;
  /** 1 = drawn with the proxy */
  lod: number;
  /** bounding radius (m) + center height for the LOD metric */
  radius: number;
  cy: number;
  /** index in BuildingRenderer.list */
  li: number;
  /** LOD schedule: absolute travel bucket of its live queue entry (-1 = none, -2 = removed); queued in lodNow */
  due: number;
  now: boolean;
}

/** LOD schedule: camera travel (m) per bucket, and ring size (travel horizon; longer slack is re-checked then) */
const LOD_BUCKET = 1;
const LOD_BUCKETS = 4096;

const POP_TIME = 0.55;
const _sphere = new THREE.Sphere();

function easeOutBack(t: number): number {
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function modelIdOf(b: Building): string {
  return getDef(b.def)?.model ?? b.def;
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
  /** at most this many building evaluations per frame (a big jump / new metric spreads over a few frames) */
  lodSlice = 3000;
  /** next update ignores lodSlice (flushLod: captures / benchmarks want the settled state now) */
  private lodFull = false;
  private animating = new Set<number>();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private foundationGeo: THREE.BufferGeometry | null = null;
  /** full geometry id -> proxy geometry id (itself when the model has no useful proxy) */
  private lodMap = new Map<number, number>();
  /** full geometry ids whose proxy is not built yet -> [model, variant]: built on demand, when a building first
   *  needs it, within lodBudgetMs per frame (a proxy costs ~1-30 ms; building them all up front would add ~2 s to a
   *  city load and a hitch whenever a new variant appears) */
  private lodPending = new Map<number, [string, number]>();
  private lodDeadline = 0;
  /** CPU budget (ms per frame) for building LOD proxies on demand; flushLod() builds all pending ones at once */
  lodBudgetMs = 3;
  /** dense list of instances for the per-frame LOD sweep */
  private list: BInst[] = [];
  /** every building is due (flushLod) */
  private lodDirty = true;
  /** projected radius (px) below which a building is drawn with its proxy (0 = LOD off); hysteresis +-12% */
  lodPixels = 9;
  /** buildings currently drawn with a proxy (stats) */
  lodCount = 0;
  selected: number | null = null;
  onVisual: ((v: BuildingVisual | null, id: number) => void) | null = null;

  constructor(private state: CityState, private culler: TileCuller) {
    this.batch = new DynamicBatch(getCityMaterial(), 4096, 1 << 18, 'buildings');
    this.batch.mesh.castShadow = true;
    this.batch.mesh.receiveShadow = true;
    // per-pass lists: the main view and each shadow cascade only draw the buildings inside their own frustum;
    // casters under ~1 shadow texel are skipped (far cascade at far zoom)
    this.batch.enablePassCulling({ culler, minShadowTexels: 1.2 });
    // nearest buildings first: occluded facades / lots behind them fail the depth test before the (heavy) uber shader
    this.batch.sortFront = true;
  }

  setState(state: CityState): void {
    this.state = state;
  }

  get count(): number {
    return this.inst.size;
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
    if (!this.lodMap.has(id) && !this.lodPending.has(id)) this.lodPending.set(id, [model, v]);
    return id;
  }

  /** proxy geometry id of a full geometry (itself when the model has none); -1 = not built yet and no budget left */
  private proxyOf(geom: number, force = false): number {
    const p = this.lodMap.get(geom);
    if (p !== undefined) return p;
    const pend = this.lodPending.get(geom);
    if (!pend) return geom;
    if (!force && performance.now() > this.lodDeadline) return -1;
    this.lodPending.delete(geom);
    const key = `${pend[0]}#${pend[1]}`;
    const proxy = lodProxyFor(key, getModelGeometry(pend[0], pend[1]));
    const id = proxy ? this.batch.geometryId(key + '#lod', () => proxy) : geom;
    this.batch.shareSphere(geom, id, PROXY_PAD);
    this.lodMap.set(geom, id);
    return id;
  }

  /** build every pending LOD proxy now (captures, benchmarks) */
  flushLod(): void {
    for (const g of [...this.lodPending.keys()]) this.proxyOf(g, true);
    for (const bi of this.list) if (bi.lodGeom < 0) bi.lodGeom = this.proxyOf(bi.geom, true);
    this.lodDirty = true;
    this.lodFull = true;
  }

  private foundation(): number {
    return this.batch.geometryId('__foundation', () => {
      if (!this.foundationGeo) {
        const mb = new ModelBuilder();
        mb.paint(0x8e8b84, Surf.Pavement).box(-0.5, -1, -0.5, 0.5, 0, 0.5, { top: null });
        this.foundationGeo = mb.build();
      }
      return this.foundationGeo;
    });
  }

  clear(): void {
    for (const bi of this.inst.values()) { this.freeInstances(bi); bi.due = -2; }
    this.inst.clear();
    this.list.length = 0;
    for (const q of this.lodBuckets) q.length = 0;
    this.lodNow.length = 0;
    this.lodCount = 0;
    this.animating.clear();
  }

  rebuildAll(): void {
    this.clear();
    for (const b of this.state.buildings.values()) this.add(b, false);
  }

  private freeInstances(bi: BInst): void {
    if (bi.main >= 0) this.batch.remove(bi.main);
    if (bi.site >= 0) this.batch.remove(bi.site);
    if (bi.found >= 0) this.batch.remove(bi.found);
    bi.main = bi.site = bi.found = -1;
  }

  private stateKey(b: Building): string {
    const f = b.flags;
    const burnt = f & BF.Burnt ? 1 : 0;
    const cons = !burnt && (f & BF.Constructing || b.built < 1) ? 1 : 0;
    return `${modelIdOf(b)}|${b.variant}|${burnt}|${cons}|${f & BF.Abandoned ? 1 : 0}|${f & BF.OnFire ? 1 : 0}|${b.x},${b.z},${b.w},${b.d},${b.rot},${b.baseY.toFixed(2)}`;
  }

  add(b: Building, animate = true): void {
    if (this.inst.has(b.id)) this.remove(b.id);
    const bi: BInst = {
      b, main: -1, site: -1, found: -1, tile: 0, key: '', flags: 0, anim: animate ? POP_TIME : 0, geom: -1,
      vis: null as unknown as BuildingVisual, lodGeom: -1, siteGeom: -1, siteLod: -1, lod: 0, radius: 1, cy: 0, li: this.list.length, due: -1, now: false,
    };
    this.inst.set(b.id, bi);
    this.list.push(bi);
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
    if (last !== bi) { this.list[bi.li] = last; last.li = bi.li; }
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
    const cx = (b.x + b.w / 2) * CELL_SIZE, cz = (b.z + b.d / 2) * CELL_SIZE;
    const yaw = b.rot * (Math.PI / 2);
    const geom = burnt ? this.geomFor('rubble', b.id) : this.geomFor(model, b.variant);
    bi.geom = geom;
    // a building currently drawn as a proxy gets its new model's proxy right away (no detail pop); for the others it
    // is built on demand by updateLod (-1 until then)
    bi.lodGeom = this.proxyOf(geom, bi.lod === 1);
    bi.siteGeom = bi.siteLod = -1;
    const bounds = this.batch.bounds(geom);
    // keep the current LOD state across rebuilds (state changes must not pop the detail level)
    bi.main = this.batch.add(bi.lod ? bi.lodGeom : geom);
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
    const depth = b.baseY - minH;
    if (depth > 0.08) bi.found = this.batch.add(this.foundation());
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
    (bi as any)._minH = minH;
    this.applyColor(bi);
    this.place(bi);
    for (const id of [bi.main, bi.site, bi.found]) if (id >= 0) this.batch.setTile(id, bi.tile);
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
    const a = flagsToAlpha(bi.flags);
    if (bi.main >= 0) this.batch.setColor(bi.main, r, g, bb, a);
    if (bi.site >= 0) this.batch.setColor(bi.site, 1, 1, 1, flagsToAlpha(bi.flags & IF_SELECTED));
    if (bi.found >= 0) this.batch.setColor(bi.found, 1, 1, 1, 1);
  }

  private applyVisibility(bi: BInst, visible: boolean): void {
    if (bi.main >= 0) this.batch.setVisible(bi.main, visible);
    if (bi.site >= 0) this.batch.setVisible(bi.site, visible);
    if (bi.found >= 0) this.batch.setVisible(bi.found, visible);
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
      if (v.burnt) {
        const fw = b.rot & 1 ? b.d : b.w, fd = b.rot & 1 ? b.w : b.d;
        this.m4.compose(this.v.set(v.cx, v.baseY, v.cz), yawQ, this.s.set(fw * 0.9, 1, fd * 0.9));
      } else {
        this.m4.compose(this.v.set(v.cx, v.baseY, v.cz), yawQ, this.s.set(sxz, sy, sxz));
      }
      this.batch.setMatrix(bi.main, this.m4);
    }
    if (bi.site >= 0) {
      const fw = b.rot & 1 ? b.d : b.w, fd = b.rot & 1 ? b.w : b.d;
      // X/Z stretch to the lot; Y by sqrt(lot cells) so the crane keeps plausible proportions
      const ys = Math.sqrt(b.w * b.d);
      this.m4.compose(this.v.set(v.cx, v.baseY + 0.01, v.cz), yawQ, this.s.set(fw, ys * Math.min(1, pop), fd));
      this.batch.setMatrix(bi.site, this.m4);
    }
    if (bi.found >= 0) {
      const minH = (bi as any)._minH ?? v.baseY - 1;
      const depth = v.baseY - minH + 0.8;
      this.m4.compose(this.v.set(v.cx, v.baseY + 0.02, v.cz), this.q.identity(), this.s.set(v.sw - 0.2, depth, v.sd - 0.2));
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
   * across their swap distance are evaluated (none while the camera stands still or only turns).
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
    if (p.x === p.x) this.lodTravel += Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
    p.copy(c);
    const cur = Math.floor(this.lodTravel / LOD_BUCKET);
    if (cur - this.lodAt >= LOD_BUCKETS - 2) {
      // a jump beyond the schedule horizon: everything is due
      for (const q of this.lodBuckets) q.length = 0;
      for (const bi of this.list) this.lodQueue(bi);
      this.lodAt = cur + 1;
    }
    if (!this.lodNow.length && this.lodAt > cur) return;
    const on = this.lodPixels * 0.88, off = this.lodPixels * 1.12;
    this.lodDeadline = performance.now() + this.lodBudgetMs;
    let budget = this.lodFull ? Infinity : this.lodSlice;
    this.lodFull = false;
    if (this.lodNow.length) {
      const q = this.lodNow;
      this.lodNow = [];
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
    // no proxy: always full, nothing to schedule (a rebuild re-queues it)
    if (bi.lodGeom === bi.geom && bi.siteLod === bi.siteGeom) { this.lodSet(bi, 0); return; }
    const v = bi.vis;
    const dx = v.cx - c.x, dy = bi.cy - c.y, dz = v.cz - c.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rk = bi.radius * K;
    const lim = this.lodPixels > 0 && bi.b.id !== this.selected;
    const want = lim && d * (bi.lod ? off : on) > rk ? 1 : 0;
    if (want && bi.lodGeom < 0) {
      // first time this model is needed as a proxy: build it within the frame budget, else retry next frame
      const pg = this.proxyOf(bi.geom);
      if (pg < 0) { this.lodQueue(bi); return; }
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
    if (bi.main >= 0) this.batch.setGeometry(bi.main, want ? bi.lodGeom : bi.geom);
    if (bi.site >= 0) this.batch.setGeometry(bi.site, want ? bi.siteLod : bi.siteGeom);
  }

  update(dt: number): void {
    if (!this.animating.size) return;
    for (const id of this.animating) {
      const bi = this.inst.get(id);
      if (!bi) { this.animating.delete(id); continue; }
      bi.anim = Math.max(0, bi.anim - dt);
      this.place(bi);
      if (bi.anim <= 0) this.animating.delete(id);
    }
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
    this.batch.dispose();
  }
}
