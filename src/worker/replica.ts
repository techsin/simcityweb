/** Ordered replica replay. View failures are isolated; replay failures require a fresh ready snapshot (R12). */
import { Emitter, type Listener } from '../core/events';
import { HISTORY_KEYS, type Building, type CityState } from '../sim/CityState';
import type { CityEvents } from '../sim/Simulation';
import { HISTORY_CAP } from '../sim/economy/history';
import type { Incident, StationFleet } from '../sim/infra/emergency';
import type { SampleRoute } from '../sim/infra/traffic';
import { TRAFFIC_OF_STATE } from '../sim/infra/transit';
import { deserializeCity } from '../save/serialize';
import {
  EntryType, EVENT_NAMES, EVENT_TYPES, PLAIN_KEYS, REC, SYSTEM_KEYS, applyCell, applyLayer, applySparse, argRect,
  copyOwned, decodeIncident, mergePlain, readBuilding,
  type Clock, type EmergencyEntry, type EmergencyStream, type Entry, type LayerName, type Packet, type PlainPatch,
  type PolicyState, type RasterPatch, type Ready, type Reply, type StationRow, type Streams,
} from './protocol';

/** W0.6 must share this brand with its save guards before a replica can be exposed through SimHost. */
export const REPLICA = Symbol('Metropolis replica');
export type ReplicaState = CityState & { readonly [REPLICA]: true };
export interface ReplicaCause { seq: number; tag: object | null }
export interface EmergencyReplicaView {
  readonly active: boolean;
  readonly layersReady: boolean;
  incidents(): readonly Incident[];
  incident(id: number): Incident | undefined;
  vehicles(): EmergencyStream['vehicles'];
  stationList(): readonly StationRow[];
  stationName(id: number): string;
  stationFleet(id: number): StationFleet | null;
}
export interface ReplicaHooks {
  /** Re-apply only idempotent optimistic writes whose seq exceeds the supplied watermark (R1). */
  plain?(state: ReplicaState, cmd: number): void;
  policy?(policy: PolicyState, cmd: number): void;
  building?(building: Building, cmd: number): void;
  clock?(clock: Clock, cmd: number): void;
  ack?(seq: number, result: unknown): void;
  tag?(seq: number): object | null;
  watch?(value: NonNullable<Packet['watch']>[number]): void;
  reply?(reply: Reply): void;
  /** Re-register overlays, derived sources and preview state, then re-apply all optimistic writes. */
  adopt?(replica: Replica, cmd: number): void;
  digest?(state: ReplicaState): number;
  assertPending?(replica: Replica): void;
  requestResync?(error: unknown): void;
  report?(key: string, error: unknown): void;
}

export class IsolatingEmitter extends Emitter<CityEvents> {
  private listeners = new Map<keyof CityEvents, Set<Listener<any>>>();
  private reported = new WeakMap<Listener<any>, Set<keyof CityEvents>>();
  constructor(private report: (key: string, error: unknown) => void) { super(); }
  override on<K extends keyof CityEvents>(type: K, fn: Listener<CityEvents[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
    return () => this.off(type, fn);
  }
  override off<K extends keyof CityEvents>(type: K, fn: Listener<CityEvents[K]>): void { this.listeners.get(type)?.delete(fn); }
  override emit<K extends keyof CityEvents>(type: K, payload: CityEvents[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); }
      catch (error) {
        let types = this.reported.get(fn);
        if (!types) this.reported.set(fn, (types = new Set()));
        if (types.has(type)) continue;
        types.add(type);
        try { this.report(`view:${String(type)}`, error); } catch { /* a broken reporter is a view failure too */ }
      }
    }
  }
  override clear(): void { this.listeners.clear(); this.reported = new WeakMap(); }
}

export class Replica {
  private current!: ReplicaState;
  readonly events: IsolatingEmitter;
  private defs: string[] = [];
  private incidentById = new Map<number, Incident>();
  private liveIncidents: Incident[] = [];
  private emergencyData: EmergencyStream = { incidents: [], vehicles: [], active: false, layersReady: false, stVer: 0 };
  private stations: StationRow[] = [];
  private routes: SampleRoute[] = [];
  private trucks: Float32Array | null = null;
  private rasters = new Map<string, RasterPatch>();
  private loaded = new Set<string>();
  private lastSeq = 0;
  cmd = 0;
  applied = 0;
  diverged = false;
  newsSeq = 0;
  cause: ReplicaCause | null = null;
  clock!: Clock;
  policy: PolicyState = { alerts: [], live: false };
  disasters: NonNullable<Streams['disasters']> = [];
  readonly emergency: EmergencyReplicaView = {
    active: false, layersReady: false,
    incidents: (): readonly Incident[] => this.liveIncidents,
    incident: (id: number): Incident | undefined => this.incidentById.get(id),
    vehicles: (): EmergencyStream['vehicles'] => this.emergencyData.vehicles,
    stationList: (): readonly StationRow[] => this.stations,
    stationName: (id: number): string => this.stations.find((s) => s.id === id)?.name ?? 'Station',
    stationFleet: (id: number): StationFleet | null => {
      const s = this.stations.find((s) => s.id === id);
      return s ? { type: s.responder, total: s.units, free: s.free, out: this.emergencyData.vehicles.filter((v) => v.stationId === id).length } : null;
    },
  };
  readonly traffic = {
    getSampleRoutes: (max: number): SampleRoute[] => this.routes.slice(0, max),
    sampleRoutes: (max: number): SampleRoute[] => this.routes.slice(0, max),
    truckVolume: (): Float32Array | null => this.trucks,
  };

  constructor(private hooks: ReplicaHooks = {}) {
    this.events = new IsolatingEmitter((key, error) => this.report(key, error));
    // Accessors retain the stream object's identity while following adoption.
    Object.defineProperties(this.emergency, {
      active: { get: () => this.emergencyData.active }, layersReady: { get: () => this.emergencyData.layersReady },
    });
  }
  get state(): ReplicaState { return this.current; }
  get seq(): number { return this.lastSeq; }
  get emergencyActive(): boolean { return this.emergencyData.active; }
  get emergencyLayersReady(): boolean { return this.emergencyData.layersReady; }
  layerReady(name: LayerName): boolean { return this.loaded.has(name); }
  raster(overlay: number, variant: number): RasterPatch | null { return this.rasters.get(`${overlay}:${variant}`) ?? null; }

  adopt(ready: Ready): void {
    const fresh = deserializeCity(ready.snapshot) as ReplicaState;
    Object.defineProperty(fresh, REPLICA, { value: true, enumerable: false });
    if (this.current?.systemData.camera !== undefined) fresh.systemData.camera = this.current.systemData.camera;
    this.current = fresh;
    this.defs = [...ready.snapshot.buildings.defs];
    this.lastSeq = 0; this.cmd = ready.cmd; this.applied = ready.cmd; this.diverged = false; this.cause = null;
    this.clock = copyOwned(ready.clock); fresh.day = this.clock.day; this.newsSeq = fresh.news.length;
    this.incidentById.clear(); this.liveIncidents = []; this.stations = []; this.routes = []; this.trucks = null;
    this.emergencyData = { incidents: [], vehicles: [], active: false, layersReady: false, stVer: 0 };
    this.rasters.clear(); this.loaded.clear(); this.disasters = [];
    for (const [name, value] of Object.entries(ready.snapshot.layers)) {
      if (Array.isArray(value)) value.forEach((_, i) => this.loaded.add(`${name}:${i}`));
      else this.loaded.add(name);
    }
    this.applyStreams(ready.streams);
    this.policy = mergePlain(this.policy, ready.policy);
    TRAFFIC_OF_STATE.set(fresh, this.traffic);
    this.hooks.adopt?.(this, ready.cmd);
    this.events.emit('reset', undefined);
  }

  apply(p: Packet): boolean {
    if (this.diverged) return false;
    try {
      if (!this.current || p.seq !== this.lastSeq + 1) throw new Error(`Packet gap: expected ${this.lastSeq + 1}, got ${p.seq}`);
      if (p.cmd < this.cmd) throw new Error('Command watermark went backwards');
      if ((p.recs && p.recs.length % REC) || (p.blds && p.blds.length % REC)) throw new Error('Truncated building records');
      this.applied = this.cmd;
      if (p.defs) this.defs.push(...p.defs);
      for (const patch of p.cells ?? []) applyCell(this.state, patch);
      for (const patch of p.layers ?? []) { applyLayer(this.state, patch); this.loaded.add(patch.name); }
      for (const patch of p.rasters ?? []) {
        if (patch.data.length !== this.state.cells) throw new Error('Invalid raster size');
        this.rasters.set(`${patch.overlay}:${patch.variant}`, patch);
      }
      if (p.plain) { this.applyPlain(p.plain); this.hooks.plain?.(this.state, p.cmd); }
      this.applyStreams(p);
      if (p.policy) { mergePlain(this.policy, p.policy); this.hooks.policy?.(this.policy, p.cmd); }
      for (const entry of p.log) this.replay(entry, p);
      if (p.blds) for (let k = 0; k < p.blds.length / REC; k++) {
        const id = p.blds[k * REC], b = this.state.buildings.get(id);
        if (!b) throw new Error(`End record for absent building ${id}`);
        readBuilding(p.blds, k, this.defs, b);
        this.hooks.building?.(b, p.cmd);
      }
      if (p.emergency) {
        for (const inc of p.emergency.incidents) decodeIncident(inc, this.incidentById.get(inc.id));
        const live = new Set(p.emergency.incidents.map((i) => i.id));
        for (const id of this.incidentById.keys()) if (!live.has(id)) this.incidentById.delete(id);
      }
      if (this.applied !== p.cmd) throw new Error(`Missing Ack: replayed ${this.applied}, packet contains ${p.cmd}`);
      this.state.day = p.clock.day;
      for (const value of p.watch ?? []) this.hooks.watch?.(value);
      for (const reply of p.replies ?? []) this.hooks.reply?.(reply);
      this.clock = copyOwned(p.clock); this.hooks.clock?.(this.clock, p.cmd); this.cause = null;
      if (p.digest !== undefined && this.hooks.digest?.(this.state) !== p.digest) throw new Error('Replica digest mismatch');
      this.hooks.assertPending?.(this);
      this.lastSeq = p.seq; this.cmd = p.cmd;
      return true;
    } catch (error) {
      this.diverged = true;
      this.report('replica', error);
      try { this.hooks.requestResync?.(error); } catch (e) { this.report('replica:resync', e); }
      return false;
    } finally { this.cause = null; }
  }
  private applyPlain(p: PlainPatch): void {
    const st = this.state;
    for (const key of PLAIN_KEYS) if (Object.hasOwn(p, key)) {
      (st as unknown as Record<string, unknown>)[key] = mergePlain(st[key], p[key]);
    }
    for (const key of ['unlocked', 'announced'] as const) if (p[key]) {
      st[key].clear(); for (const value of p[key]) st[key].add(value);
    }
    if (p.sys) for (const key of SYSTEM_KEYS) if (Object.hasOwn(p.sys, key)) {
      if (p.sys[key] === undefined) delete st.systemData[key];
      else st.systemData[key] = mergePlain(st.systemData[key], p.sys[key]);
    }
    if (p.historyTail) for (const key of HISTORY_KEYS) {
      const tail = p.historyTail[key];
      if (!tail) continue;
      st.history[key].push(...tail);
      if (st.history[key].length > HISTORY_CAP) st.history[key].splice(0, st.history[key].length - HISTORY_CAP);
    }
  }
  private applyStreams(p: Streams): void {
    if (p.emergency) {
      const e = p.emergency;
      this.emergencyData.active = e.active; this.emergencyData.layersReady = e.layersReady; this.emergencyData.stVer = e.stVer;
      this.liveIncidents.length = 0;
      for (const inc of e.incidents) {
        const obj = decodeIncident(inc, this.incidentById.get(inc.id));
        this.incidentById.set(inc.id, obj); this.liveIncidents.push(obj);
      }
      mergePlain(this.emergencyData.vehicles, e.vehicles);
      if (e.stations) mergePlain(this.stations, e.stations);
      const out = new Map<number, number>();
      for (const v of e.vehicles) out.set(v.stationId, (out.get(v.stationId) ?? 0) + 1);
      for (const s of this.stations) s.free = Math.max(0, s.units - (out.get(s.id) ?? 0));
    }
    if (p.traffic?.routes) this.routes = p.traffic.routes;
    if (p.traffic?.trucks) {
      this.trucks ??= new Float32Array(this.state.cells);
      this.trucks.fill(0); applySparse(this.trucks, p.traffic.trucks.idx, p.traffic.trucks.val);
    }
    if (p.disasters) mergePlain(this.disasters, p.disasters);
  }
  private replay(entry: Entry, p: Packet): void {
    const [type, day, arg, cause] = entry;
    this.state.day = day;
    this.cause = cause === undefined ? null : { seq: cause, tag: this.hooks.tag?.(cause) ?? null };
    if (type === EntryType.Ack) {
      if (cause === undefined || cause <= this.applied || !p.acks || typeof arg !== 'number' || arg < 0 || arg >= p.acks.length) throw new Error('Invalid Ack entry');
      this.applied = cause;
      this.hooks.ack?.(cause, p.acks[arg]); this.cause = null; return;
    }
    const name = EVENT_NAMES.find((name) => EVENT_TYPES[name] === type);
    if (!name) throw new Error(`Unknown log entry ${type}`);
    let value: CityEvents[typeof name] = arg as CityEvents[typeof name];
    if (type === EntryType.BuildingAdded || type === EntryType.BuildingChanged || type === EntryType.BuildingRemoved) {
      if (!p.recs || typeof arg !== 'number') throw new Error('Missing building record');
      const id = p.recs[arg * REC];
      const current = this.state.buildings.get(id);
      if (!current && type !== EntryType.BuildingAdded) throw new Error(`Event for absent building ${id}`);
      const b = readBuilding(p.recs, arg, this.defs, current);
      this.hooks.building?.(b, this.applied);
      if (type === EntryType.BuildingAdded) { this.state.buildings.set(b.id, b); this.footprint(b, false); }
      else if (type === EntryType.BuildingRemoved) { this.state.buildings.delete(b.id); this.footprint(b, true); }
      value = b;
    } else if (type === EntryType.Emergency) {
      const [event, index] = arg as EmergencyEntry;
      const record = p.incs?.[index];
      if (!record || record.id !== event.id) throw new Error('Missing incident record');
      const inc = decodeIncident(record, this.incidentById.get(record.id));
      this.incidentById.set(inc.id, inc); value = event;
    } else if (type >= EntryType.NetworkChanged && type <= EntryType.TreesDamaged) value = argRect(arg as number[]);
    else if (type === EntryType.News) {
      const item = copyOwned(arg as CityEvents['news']);
      this.state.news.push(item);
      if (this.state.news.length > 200) this.state.news.splice(0, this.state.news.length - 200);
      this.newsSeq++; value = item;
    }
    this.events.emit(name, value);
    this.cause = null;
  }
  private footprint(b: Building, remove: boolean): void {
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
      if (!this.state.inBounds(x, z)) continue;
      const i = this.state.idx(x, z);
      if (!remove || this.state.building[i] === b.id) this.state.building[i] = remove ? -1 : b.id;
    }
  }
  private report(key: string, error: unknown): void {
    try {
      if (this.hooks.report) this.hooks.report(key, error);
      else console.error(`[${key}]`, error);
    } catch { /* reporting cannot interrupt a packet */ }
  }
}
