/** Event-time records, end-of-packet layers and rolling building refresh (WORKER_DESIGN F1–F7). */
import type { CellRect } from '../core/events';
import { DEV_TYPE_COUNT, Overlay } from '../core/types';
import { serializeCity } from '../save/serialize';
import { BF, HISTORY_KEYS, type Building, type CityState, type HistorySeries } from '../sim/CityState';
import type { CityEvents, EmergencyEvent, Simulation } from '../sim/Simulation';
import { buildingList } from '../sim/infra/common';
import type { DisastersSystem } from '../sim/infra/disasters';
import type { EmergencySystem, Incident } from '../sim/infra/emergency';
import { attachOverlays, overlayDeps, overlayLayer, resolveVariant } from '../sim/infra/overlays';
import type { SampleRoute, TrafficSystem } from '../sim/infra/traffic';
import {
  DefTable, EntryType, EVENT_NAMES, EVENT_TYPES, EXACT_FIELDS, PLAIN_KEYS, REC, REC_FIELDS, RecordBuffer, SYSTEM_KEYS,
  copyOwned, encodeCell, encodeIncident, encodeLayer, encodeRoad, layerOf, plainEqual, rectArg, writeBuilding,
  type CellLayer, type Clock, type EmergencyStream, type Entry, type EventName, type LayerName, type LayerPatch,
  type Packet, type PlainPatch, type PolicyState, type RasterPatch, type Ready, type Streams, type ViewState,
} from './protocol';

export interface RecorderOptions {
  dev?: boolean;
  now?: () => number;
  rollingCount?: number;
  measure?: boolean;
  policy?: () => PolicyState;
  onAuditError?: (id: number, field: string) => void;
}
export interface FlushOptions { cmd?: number; live?: boolean; force?: boolean; rollingCount?: number }
const MAP_LAYERS: Partial<Record<EventName, readonly CellLayer[]>> = {
  networkChanged: ['network', 'netFlags'], zoneChanged: ['zone'], terrainChanged: ['heights', 'water'],
  powerLinesChanged: ['powerLines'], subwayChanged: ['subway'], treesChanged: ['trees'], treesDamaged: ['trees'],
};
const EMPTY_POLICY: PolicyState = { alerts: [], live: false };

/** Only the shown inputs are subscribed. Utilities / traffic are added separately and always mirrored. */
export function viewLayers(view: ViewState): LayerName[] {
  const v = resolveVariant(view.overlay, view.variant);
  switch (view.overlay) {
    case Overlay.AirPollution: return ['airPollution'];
    case Overlay.WaterPollution: return ['waterPollution'];
    case Overlay.Garbage: return [v === 1 ? 'landfillFill' : 'garbage'];
    case Overlay.Soil: return ['soil'];
    case Overlay.Noise: return ['noise'];
    case Overlay.Police: return ['policeCov'];
    case Overlay.Fire: return ['fireCov'];
    case Overlay.Health: return ['healthCov'];
    case Overlay.Transit: return ['transitCov'];
    case Overlay.Education: return [(['eduCov', 'eduElemCov', 'eduHighCov', 'eduCollegeCov'] as const)[v]];
    case Overlay.Parks: return [(['parkCov', 'playCov', 'greenCov'] as const)[v]];
    case Overlay.Shops: return ['shopAccess'];
    case Overlay.Nimby: return ['prestige', 'stigma'];
    case Overlay.Commute: return ['accessCommute'];
    case Overlay.Crime: return ['crime'];
    case Overlay.LandValue: return ['landValue'];
    case Overlay.Tourism: return ['visitors'];
    case Overlay.Parking: return ['parking'];
    case Overlay.Desirability: return v < DEV_TYPE_COUNT ? [`desirability:${v}`] : [];
    case Overlay.Emergency: return ['respFire', 'respPolice', 'respMedical'];
    default: return [];
  }
}
export function workerRaster(view: ViewState): boolean {
  const v = resolveVariant(view.overlay, view.variant);
  return view.overlay === Overlay.Demographics || (view.overlay === Overlay.Water && v === 1)
    || (view.overlay === Overlay.Desirability && v >= DEV_TYPE_COUNT);
}

export class ChangeRecorder {
  captureMs = 0;
  private off: (() => void)[] = [];
  private defs = new DefTable();
  private records = new RecordBuffer();
  private endRecords = new RecordBuffer();
  private log: Entry[] = [];
  private incidents: Incident[] = [];
  private incidentRefs = new Map<number, Incident>();
  private rects = new Map<CellLayer, CellRect>();
  private dirty = new Set<string>();
  private sentAt = new Map<string, number>();
  private sparse = new Map<LayerName, Uint8Array>();
  private shadow = new Float64Array(0);
  private exact = new Float64Array(0);
  private constructing = new Set<number>();
  private cursor = 0;
  private auditCursor = 0;
  private constructionDay = -1;
  private seq = 0;
  private lastDay = -1;
  private lastFlush = -Infinity;
  private plain: PlainPatch = {};
  private historyTail: Partial<HistorySeries> = {};
  private policy: PolicyState = copyOwned(EMPTY_POLICY);
  private stationVersion = -1;
  private routeRefs: SampleRoute[] = [];
  private hadDisasters = false;
  private view: ViewState = { overlay: Overlay.None, variant: 0, panels: [], focus: [] };
  private viewDirty = false;
  private focusDirty = false;
  private streamsDirty = false;
  private rasterDirty = false;
  private rasterAt = -Infinity;
  private disposed = false;
  /** Set by the command lane around a command; never contains a main-side tag object. */
  cause: number | undefined;
  private readonly now: () => number;

  constructor(readonly sim: Simulation, private opts: RecorderOptions = {}) {
    this.now = opts.now ?? (() => performance.now());
    this.off.push(attachOverlays(sim));
    for (const name of EVENT_NAMES) this.off.push(sim.events.on(name, (value) => {
      if (!this.opts.measure) { this.capture(name, value); return; }
      const start = performance.now();
      this.capture(name, value);
      this.captureMs += performance.now() - start;
    }));
    this.seed();
  }
  private get state(): CityState { return this.sim.state; }
  private emergency(): EmergencySystem | undefined { return this.sim.getSystem<EmergencySystem>('emergency'); }
  private traffic(): TrafficSystem | undefined { return this.sim.getSystem<TrafficSystem>('traffic'); }
  private disasters(): DisastersSystem | undefined { return this.sim.getSystem<DisastersSystem>('disasters'); }

  /** The snapshot and all following diffs start from the same state; call only at a unit boundary. */
  ready(cmd = 0, live = false): Ready {
    const snapshot = serializeCity(this.state);
    snapshot.data.systemData = this.systemData();
    if (this.state.systemData.camera !== undefined) (snapshot.data.systemData as Record<string, unknown>).camera = copyOwned(this.state.systemData.camera);
    this.seed(snapshot.buildings.defs);
    const streams = this.streams(true, true);
    this.policy = copyOwned(this.opts.policy?.() ?? EMPTY_POLICY);
    return { t: 'ready', snapshot: copyOwned(snapshot), streams, policy: copyOwned(this.policy), clock: this.clock(live), savedAt: snapshot.savedAt, cmd };
  }
  private seed(defs: string[] = []): void {
    this.defs = new DefTable(defs);
    this.records.clear(); this.endRecords.clear(); this.log = []; this.incidents = []; this.rects.clear(); this.dirty.clear();
    this.sentAt.clear(); this.sparse.clear(); this.constructing.clear(); this.incidentRefs.clear();
    this.seq = 0; this.cursor = 0; this.auditCursor = 0; this.stationVersion = -1; this.routeRefs = [];
    this.shadow = new Float64Array(0); this.exact = new Float64Array(0);
    this.ensureShadow(this.state.nextBuildingId);
    for (const b of this.state.buildings.values()) {
      this.noteRecord(b);
      this.noteExact(b);
      if (b.built < 1) this.constructing.add(b.id);
    }
    this.defs.takeAppends();
    for (const inc of this.emergency()?.incidents() ?? []) this.incidentRefs.set(inc.id, inc);
    this.sparse.set('powered', this.state.powered.slice()); this.sparse.set('watered', this.state.watered.slice());
    this.plain = this.plainSections(); this.historyTail = {};
    this.lastDay = this.state.day; this.constructionDay = this.state.day; this.lastFlush = this.now();
    this.viewDirty = this.view.overlay !== Overlay.None; this.rasterDirty = workerRaster(this.view); this.rasterAt = -Infinity;
    this.focusDirty = false; this.streamsDirty = false;
    this.hadDisasters = false;
  }
  setView(view: ViewState): void {
    if (view.focus.length > 8) throw new Error('At most eight focus buildings');
    const changed = view.overlay !== this.view.overlay || resolveVariant(view.overlay, view.variant) !== resolveVariant(this.view.overlay, this.view.variant);
    this.focusDirty = this.focusDirty || !plainEqual(view.focus, this.view.focus);
    this.streamsDirty = this.streamsDirty || !plainEqual(view.panels, this.view.panels);
    this.view = copyOwned(view);
    this.viewDirty = this.viewDirty || changed;
    this.rasterDirty = this.rasterDirty || changed;
  }
  private capture<K extends EventName>(name: K, value: CityEvents[K]): void {
    const st = this.state;
    let arg: Entry[2] = value as Entry[2];
    if (name === 'buildingAdded' || name === 'buildingChanged' || name === 'buildingRemoved') {
      const b = value as Building;
      arg = this.records.add(b, this.defs, this.opts.dev);
      this.noteRecord(b); this.noteExact(b);
      if (name === 'buildingRemoved' || b.built >= 1 || (name === 'buildingChanged' && !(b.flags & BF.Constructing))) this.constructing.delete(b.id);
      else if (b.built < 1) this.constructing.add(b.id);
      if (this.view.overlay === Overlay.Demographics) this.rasterDirty = true;
    } else if (name === 'emergency') {
      const e = value as EmergencyEvent;
      // finalize() removes byId before emitting. Retain the public object from ready / 'new' through that event.
      const inc = this.emergency()?.incident(e.id) ?? this.incidentRefs.get(e.id);
      if (!inc) throw new Error(`Missing event-time incident ${e.id}`);
      this.incidentRefs.set(e.id, inc);
      arg = [copyOwned(e), this.incidents.length];
      this.incidents.push(encodeIncident(inc));
      if (e.type === 'resolved' || e.type === 'failed') this.incidentRefs.delete(e.id);
    } else if (MAP_LAYERS[name]) {
      const rect = value as CellRect;
      arg = rectArg(rect);
      for (const layer of MAP_LAYERS[name]!) this.union(layer, layer === 'heights' ? { ...rect, x1: rect.x1 + 1, z1: rect.z1 + 1 } : rect);
    } else if (name === 'layerUpdated') {
      this.dirty.add(value as string);
      if (overlayDeps(this.view.overlay, this.view.variant).includes(value as string)) this.rasterDirty = true;
    } else if (name === 'month') {
      for (const k of HISTORY_KEYS) {
        const a = st.history[k];
        if (a.length) (this.historyTail[k] ??= []).push(a[a.length - 1]);
      }
    } else if (name === 'day' && this.opts.dev) this.auditExact();
    if (arg !== undefined && name !== 'buildingAdded' && name !== 'buildingRemoved' && name !== 'buildingChanged') arg = copyOwned(arg);
    this.log.push([EVENT_TYPES[name], st.day, arg, this.cause]);
  }
  private union(layer: CellLayer, rect: CellRect): void {
    const r = this.rects.get(layer);
    if (!r) { this.rects.set(layer, { ...rect }); return; }
    r.x0 = Math.min(r.x0, rect.x0); r.z0 = Math.min(r.z0, rect.z0);
    r.x1 = Math.max(r.x1, rect.x1); r.z1 = Math.max(r.z1, rect.z1);
  }
  private ensureShadow(id: number): void {
    if ((id + 1) * 2 <= this.shadow.length) return;
    const n = Math.max(id + 1, 1024, this.shadow.length);
    const shadow = new Float64Array(n * 2).fill(NaN);
    shadow.set(this.shadow); this.shadow = shadow;
    if (this.opts.dev) { const exact = new Float64Array(n * REC).fill(NaN); exact.set(this.exact); this.exact = exact; }
  }
  private noteRecord(b: Building): void {
    this.ensureShadow(b.id);
    this.shadow[b.id * 2] = b.pop; this.shadow[b.id * 2 + 1] = b.jobs;
  }
  private noteExact(b: Building): void {
    if (this.opts.dev) writeBuilding(this.exact, b.id * REC, b, this.defs, true);
  }
  auditExact(): void {
    if (!this.opts.dev) return;
    const list = buildingList(this.state), n = Math.ceil(list.length / 32);
    for (let k = 0; k < n && list.length; k++) {
      const b = list[this.auditCursor++ % list.length];
      for (const field of EXACT_FIELDS) {
        const offset = field === 'def' ? 24 : REC_FIELDS.indexOf(field);
        const actual = field === 'def' ? this.defs.index(b.def) : b[field];
        if (!Object.is(this.exact[b.id * REC + offset], actual)) {
          if (this.opts.onAuditError) this.opts.onAuditError(b.id, field);
          else throw new Error(`silent exact-field write: ${b.id}.${field}`);
        }
      }
    }
  }
  private rolling(count: number): Float64Array {
    const st = this.state, sent = new Set<number>();
    const add = (b: Building) => {
      if (sent.has(b.id)) return;
      sent.add(b.id); this.endRecords.add(b, this.defs, this.opts.dev); this.noteRecord(b);
    };
    for (const id of this.view.focus) { const b = st.buildings.get(id); if (b) add(b); }
    if (this.constructionDay !== st.day) {
      for (const id of this.constructing) {
        const b = st.buildings.get(id);
        if (b) add(b);
        if (!b || b.built >= 1) this.constructing.delete(id);
      }
      this.constructionDay = st.day;
    }
    const list = buildingList(st);
    for (let k = 0; k < Math.min(count, list.length); k++) {
      const b = list[this.cursor++ % list.length];
      if (!Object.is(this.shadow[b.id * 2], b.pop) || !Object.is(this.shadow[b.id * 2 + 1], b.jobs)) add(b);
    }
    return this.endRecords.take();
  }
  private systemData(): Record<string, unknown> {
    const sys: Record<string, unknown> = {};
    for (const key of SYSTEM_KEYS) if (Object.hasOwn(this.state.systemData, key)) sys[key] = copyOwned(this.state.systemData[key]);
    return sys;
  }
  private plainSections(): PlainPatch {
    const st = this.state, p: PlainPatch = {};
    for (const key of PLAIN_KEYS) (p as Record<string, unknown>)[key] = copyOwned(st[key]);
    p.unlocked = [...st.unlocked]; p.announced = [...st.announced]; p.sys = this.systemData();
    return p;
  }
  private plainPatch(): PlainPatch | undefined {
    const st = this.state, patch: PlainPatch = {};
    for (const key of PLAIN_KEYS) {
      if (plainEqual(this.plain[key], st[key])) continue;
      (patch as Record<string, unknown>)[key] = copyOwned(st[key]);
      (this.plain as Record<string, unknown>)[key] = copyOwned(st[key]);
    }
    for (const key of ['unlocked', 'announced'] as const) {
      const value = [...st[key]];
      if (!plainEqual(this.plain[key], value)) { patch[key] = value; this.plain[key] = [...value]; }
    }
    for (const key of SYSTEM_KEYS) {
      const value = st.systemData[key];
      if (!plainEqual(this.plain.sys?.[key], value)) {
        (patch.sys ??= {})[key] = copyOwned(value);
        (this.plain.sys ??= {})[key] = copyOwned(value);
      }
    }
    if (Object.keys(this.historyTail).length) { patch.historyTail = this.historyTail; this.historyTail = {}; }
    return Object.keys(patch).length ? patch : undefined;
  }
  private clock(live: boolean): Clock {
    return { day: this.state.day, frac: this.sim.dayFraction, speed: this.sim.speed, slow: this.sim.liveSlowdown, spd: this.sim.secondsPerDay(), live };
  }
  private emergencyStream(full: boolean): EmergencyStream | undefined {
    const em = this.emergency();
    if (!em) return;
    // persist() publishes stVer at the unit boundary. No access to the system's private station cache.
    const stVer = (this.state.systemData.emergency as { stVer?: number } | undefined)?.stVer ?? 0;
    const out: EmergencyStream = { incidents: em.incidents().map(encodeIncident), vehicles: copyOwned([...em.vehicles()]), active: em.active, layersReady: em.layersReady, stVer };
    if (full || stVer !== this.stationVersion) { out.stations = copyOwned([...em.stationList()]); this.stationVersion = stVer; }
    return out;
  }
  private streams(full: boolean, dayOrEmergency: boolean): Streams {
    const streams: Streams = {};
    if (full || dayOrEmergency) streams.emergency = this.emergencyStream(full);
    const traffic = this.traffic();
    if (traffic) {
      const routes = traffic.getSampleRoutes(1024);
      if (full || this.dirty.has('traffic') || routes.length !== this.routeRefs.length || routes.some((r, i) => r !== this.routeRefs[i])) {
        streams.traffic = { routes: routes.map((r) => ({ ...r, cells: r.cells.slice() })) };
        this.routeRefs = routes;
      }
      if ((this.view.overlay === Overlay.Traffic && this.view.variant === 1) || this.view.panels.includes('roadInspector')) {
        if (full || this.viewDirty || this.streamsDirty || this.dirty.has('traffic')) {
          const data = traffic.truckVolume();
          const idx: number[] = [], val: number[] = [];
          if (data) for (let i = 0; i < data.length; i++) if (!Object.is(data[i], 0)) { idx.push(i); val.push(data[i]); }
          (streams.traffic ??= {}).trucks = { idx: new Uint32Array(idx), val: new Float32Array(val) };
        }
      }
    }
    const disasters = this.disasters()?.active ?? [];
    if (full || disasters.length || this.hadDisasters) streams.disasters = copyOwned([...disasters]);
    this.hadDisasters = disasters.length > 0;
    return streams;
  }
  flush(opts: FlushOptions = {}): Packet | null {
    if (this.disposed) throw new Error('Recorder disposed');
    const now = this.now(), dayPassed = this.state.day !== this.lastDay;
    const policy = this.opts.policy?.() ?? EMPTY_POLICY;
    const subscribed = viewLayers(this.view), deps = overlayDeps(this.view.overlay, this.view.variant);
    const due = (group: string) => !(group === 'utilities' || group === 'traffic' || deps.includes(group)) || now - (this.sentAt.get(group) ?? -Infinity) >= 250;
    const logReady = this.log.some((e) => e[0] !== EntryType.LayerUpdated || due(e[2] as string));
    const rasterReady = this.rasterDirty && workerRaster(this.view) && now - this.rasterAt >= 500;
    if (!opts.force && !logReady && ![...this.dirty].some(due) && !this.viewDirty && !this.focusDirty && !this.streamsDirty && !rasterReady && !dayPassed
      && plainEqual(this.policy, policy) && now - this.lastFlush < 250) return null;
    const p: Packet = { seq: ++this.seq, cmd: opts.cmd ?? 0, clock: this.clock(opts.live ?? false), log: [] };
    if (this.rects.size) p.cells = [...this.rects].map(([layer, rect]) => encodeCell(this.state, layer, rect));
    this.rects.clear();
    const delivered = new Set<string>(), layers = new Map<LayerName, LayerPatch>();
    for (const group of this.dirty) {
      const relevant = group === 'utilities' || group === 'traffic' || deps.includes(group);
      if (relevant && now - (this.sentAt.get(group) ?? -Infinity) < 250) continue;
      delivered.add(group);
      if (relevant) {
        this.sentAt.set(group, now);
        if (group === 'utilities') for (const name of ['powered', 'watered'] as const) {
          layers.set(name, encodeLayer(name, this.state[name], this.sparse.get(name)));
          this.sparse.set(name, this.state[name].slice());
        }
        if (group === 'traffic') for (const name of ['traffic', 'congestion'] as const) layers.set(name, encodeRoad(name, this.state[name], this.state.network));
        if (deps.includes(group)) for (const name of subscribed) layers.set(name, encodeLayer(name, layerOf(this.state, name)));
      }
    }
    if (this.viewDirty) for (const name of subscribed) layers.set(name, encodeLayer(name, layerOf(this.state, name)));
    if (layers.size) p.layers = [...layers.values()];
    if (workerRaster(this.view) && this.rasterDirty && (this.viewDirty || now - this.rasterAt >= 500)) {
      const layer = overlayLayer(this.state, this.view.overlay, this.view.variant);
      if (layer) {
        const raster: RasterPatch = { overlay: this.view.overlay, variant: layer.variant, data: Float32Array.from(layer.data), scale: layer.scale, day: this.state.day };
        p.rasters = [raster]; this.rasterAt = now; this.rasterDirty = false;
      }
    } else if (!workerRaster(this.view)) this.rasterDirty = false;
    const deferred: Entry[] = [];
    for (const entry of this.log) {
      if (entry[0] === EntryType.LayerUpdated && !delivered.has(entry[2] as string)) deferred.push(entry);
      else p.log.push(entry);
    }
    const emEvent = p.log.some((e) => e[0] === EntryType.Emergency);
    Object.assign(p, this.streams(false, dayPassed || emEvent));
    this.log = deferred;
    for (const group of delivered) this.dirty.delete(group);
    const recs = this.records.take(); if (recs.length) p.recs = recs;
    if (this.incidents.length) { p.incs = this.incidents; this.incidents = []; }
    const blds = this.rolling(opts.rollingCount ?? this.opts.rollingCount ?? 512); if (blds.length) p.blds = blds;
    const defs = this.defs.takeAppends(); if (defs.length) p.defs = defs;
    p.plain = this.plainPatch();
    if (!plainEqual(this.policy, policy)) { p.policy = copyOwned(policy); this.policy = copyOwned(policy); }
    this.viewDirty = false; this.focusDirty = false; this.streamsDirty = false; this.lastDay = this.state.day; this.lastFlush = now;
    return p;
  }
  dispose(): void { for (const off of this.off) off(); this.off = []; this.incidentRefs.clear(); this.disposed = true; }
}
