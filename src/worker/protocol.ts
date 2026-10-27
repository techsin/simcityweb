/** Clone-only worker messages and lossless replica codecs (WORKER_DESIGN §2). */
import type { CellRect } from '../core/events';
import type { Overlay } from '../core/types';
import type { RegionContext } from '../region/regionEffects';
import type { RegionCitySummary } from '../region/types';
import type { CityRecord } from '../save/index';
import type { RecoveryMarker } from '../save/recovery';
import type { AnyTypedArray, SerializedCity } from '../save/serialize';
import type { Building, CityState, HistorySeries } from '../sim/CityState';
import type { EmergencyEvent } from '../sim/Simulation';
import type { ActiveDisaster } from '../sim/infra/disasters';
import type { EmergencySystem, Incident, EmergencyVehicle } from '../sim/infra/emergency';
import type { SampleRoute } from '../sim/infra/traffic';

export const PROTOCOL_VERSION = 1;
export type CommandOp = 'zone' | 'dezone' | 'bulldoze' | 'buildNetwork' | 'buildPowerLine' | 'buildSubway' | 'plop'
  | 'terraform' | 'plantTrees' | 'setTax' | 'setFunding' | 'setHistoric' | 'setOrdinance' | 'takeLoan' | 'repayLoan'
  | 'setSpeed' | 'resume' | 'dispatch' | 'dispatchBest' | 'dismissAlert' | 'triggerDisaster' | 'setCamera' | 'setSettings'
  | 'debug.runDays' | 'debug.verify' | 'debug.setStepBudget' | 'debug.setTrafficMinCycle';
export type QueryName = 'inspectBuilding' | 'inspectCell' | 'dispatchOptions' | 'routePreview' | 'emergencyReport'
  | 'demolishRisks' | 'sideDemolishRisks' | 'stopsNear' | 'ferryPartnersFor' | 'openAdvice' | 'advisorIssues'
  | 'capHints' | 'tourismSummary' | 'attractivenessBreakdown' | 'unservedClusters' | 'computeMonthlyBudget' | 'garageStates' | 'verify';
// These wire policies are completed by the W0 query / persistence lanes; no handlers live here.
export type WatchPolicy = 'daily' | 'monthly' | 'change';
export type SaveReason = 'manual' | 'autosave' | 'hidden' | 'exit';
export type SnapshotWhy = 'periodic' | 'hidden' | 'journal';
export interface SimSettings {
  emergencyUncovered: 'live' | 'pause' | 'ignore';
  emergencyLiveSlowmo: number;
  emergencyAlerts: 'major' | 'all';
}
export interface ViewState { overlay: Overlay; variant: number; panels: string[]; focus: number[] }
export type CitySource = { kind: 'idb'; regionId: string; tileKey: string }
  | { kind: 'serialized'; regionId: string; tileKey: string; savedAt: number; city: SerializedCity };
export type JournalOp = Extract<CommandOp, 'zone' | 'dezone' | 'bulldoze' | 'buildNetwork' | 'buildPowerLine' | 'buildSubway'
  | 'plop' | 'terraform' | 'plantTrees' | 'setTax' | 'setFunding' | 'setHistoric' | 'setOrdinance' | 'takeLoan' | 'repayLoan'>;
export interface Journal {
  v: 1; regionId: string; tileKey: string; at: number;
  base: { kind: 'save'; savedAt: number } | { kind: 'snapshot'; at: number; baseSavedAt: number };
  fromCmd: number;
  ops: { seq: number; op: JournalOp; args: unknown[] }[];
}
export type M2W =
  | { t: 'init'; v: number; city: CitySource; rctx: RegionContext | null; initialSpeed: number; settings: SimSettings;
      flags: { simwasm: string | null; dev: boolean }; persistence: 'worker-idb' | 'main'; journal?: Journal }
  | { t: 'tick'; seq: number; dt: number; ack: number }
  | { t: 'cmd'; seq: number; op: CommandOp; args: unknown[]; atDay?: number }
  | { t: 'query'; id: number; name: QueryName; args: unknown }
  | { t: 'watch'; id: number; name: QueryName; args: unknown; when: WatchPolicy } | { t: 'unwatch'; id: number }
  | { t: 'view'; v: ViewState }
  | { t: 'save'; id: number; reason: SaveReason } | { t: 'snapshot'; id: number; why: SnapshotWhy }
  | { t: 'ping'; n: number } | { t: 'resync' } | { t: 'dispose' };
export type W2M =
  | { t: 'hello'; v: number }
  | { t: 'boot'; phase: 'idb' | 'deserialize' | 'wasm' | 'systems' | 'journal' | 'snapshot'; pct: number }
  | { t: 'ready'; snapshot: SerializedCity; streams: Streams; policy: PolicyState; clock: Clock; savedAt: number; cmd: number; journal?: Journal }
  | { t: 'pkt'; p: Packet }
  | { t: 'fatal'; message: string; stack?: string };
export type Ready = Extract<W2M, { t: 'ready' }>;
export type Reply =
  | { t: 'qres'; id: number; ok: boolean; value?: unknown; error?: string }
  | { t: 'saved'; id: number; ok: boolean; savedAt?: number; cmd?: number; summary?: RegionCitySummary; fp?: string; pktSeq?: number; record?: CityRecord; error?: string }
  | { t: 'snapped'; id: number; marker: RecoveryMarker; payload: Uint8Array; cmd: number }
  | { t: 'error'; key: string; title: string; message: string; stack?: string; sim: boolean; disabled?: boolean };

export interface Clock { day: number; frac: number; speed: number; slow: number; spd: number; live: boolean }
export interface PolicyState {
  alerts: { id: number; wasPossible: boolean }[];
  live: boolean;
  toast?: { text: string; kind: 'info' | 'good' | 'bad' | 'warning' };
  warn?: true;
}
export type StationRow = ReturnType<EmergencySystem['stationList']>[number];
export type IncidentRecord = Incident;
export interface EmergencyStream {
  incidents: Incident[]; vehicles: EmergencyVehicle[]; active: boolean; layersReady: boolean;
  stVer: number; stations?: StationRow[];
}
export interface TrafficStream { routes?: SampleRoute[]; trucks?: { idx: Uint32Array; val: Float32Array } }
export interface Streams { emergency?: EmergencyStream; traffic?: TrafficStream; disasters?: ActiveDisaster[] }
export interface WorkerStats { busy: number; msPerDay: number; units: Record<string, number>; queue: number }
export const PLAIN_KEYS = ['funds', 'nextBuildingId', 'stats', 'budget', 'milestones', 'neighborConnections'] as const;
export const SYSTEM_KEYS = ['economy', 'infraVersion', 'infraLayers', 'advisors', 'regionJobs', 'regionWorkers'] as const;
export type PlainPatch = Partial<Pick<CityState, typeof PLAIN_KEYS[number]>> & {
  unlocked?: string[]; announced?: string[];
  historyTail?: Partial<HistorySeries>;
  sys?: Partial<Record<typeof SYSTEM_KEYS[number], unknown>>;
};
export const CELL_LAYERS = ['heights', 'water', 'trees', 'zone', 'network', 'netFlags', 'powerLines', 'subway'] as const;
export const PRIMARY_LAYERS = [...CELL_LAYERS, 'building'] as const;
export const MIRRORED_LAYERS = ['powered', 'watered', 'traffic', 'congestion'] as const;
export type CellLayer = typeof CELL_LAYERS[number];
export type LayerName = { [K in keyof CityState]: CityState[K] extends AnyTypedArray ? K : never }[keyof CityState] | `desirability:${number}`;
export interface CellPatch extends CellRect { layer: CellLayer; data: AnyTypedArray }
export type LayerPatch = { name: LayerName; whole: AnyTypedArray }
  | { name: LayerName; idx: Uint32Array; val: AnyTypedArray }
  | { name: 'traffic' | 'congestion'; road: Float32Array; off?: { idx: Uint32Array; val: Float32Array } };
export interface RasterPatch { overlay: Overlay; variant: number; data: Float32Array; scale: number; day: number }

export enum EntryType {
  BuildingAdded, BuildingRemoved, BuildingChanged, NetworkChanged, ZoneChanged, TerrainChanged, PowerLinesChanged,
  SubwayChanged, TreesChanged, TreesDamaged, Emergency, Day, Month, Year, News, LayerUpdated, Disaster, Unlocked, SpeedChanged,
  Reset, Ack,
}
export const EVENT_TYPES = {
  buildingAdded: EntryType.BuildingAdded, buildingRemoved: EntryType.BuildingRemoved, buildingChanged: EntryType.BuildingChanged,
  networkChanged: EntryType.NetworkChanged, zoneChanged: EntryType.ZoneChanged, terrainChanged: EntryType.TerrainChanged,
  powerLinesChanged: EntryType.PowerLinesChanged, subwayChanged: EntryType.SubwayChanged, treesChanged: EntryType.TreesChanged,
  treesDamaged: EntryType.TreesDamaged, emergency: EntryType.Emergency, day: EntryType.Day, month: EntryType.Month, year: EntryType.Year, news: EntryType.News,
  layerUpdated: EntryType.LayerUpdated, disaster: EntryType.Disaster, unlocked: EntryType.Unlocked,
  speedChanged: EntryType.SpeedChanged, reset: EntryType.Reset,
} as const;
export type EventName = keyof typeof EVENT_TYPES;
export const EVENT_NAMES = Object.keys(EVENT_TYPES) as EventName[];
export type Entry = [type: EntryType, day: number, arg?: number | string | object, cause?: number];
export type EmergencyEntry = [event: EmergencyEvent, incidentRecordIndex: number];
export interface Packet extends Streams {
  seq: number; cmd: number; clock: Clock; log: Entry[];
  recs?: Float64Array; incs?: IncidentRecord[]; defs?: string[]; cells?: CellPatch[]; layers?: LayerPatch[];
  rasters?: RasterPatch[]; blds?: Float64Array; plain?: PlainPatch; policy?: PolicyState;
  watch?: { id: number; key: string; value: unknown }[]; replies?: Reply[]; acks?: unknown[];
  pong?: number; stats?: WorkerStats; digest?: number;
}

export const REC_FIELDS = ['id', 'x', 'z', 'w', 'd', 'rot', 'variant', 'pop', 'jobs', 'capacity', 'wealth', 'built', 'age',
  'flags', 'baseY', 'health', 'unhappy', 'kids', 'teens', 'yad', 'srs', 'wf', 'edu', 'hire'] as const;
export const REC = 25;
export const EXACT_FIELDS = ['def', 'x', 'z', 'w', 'd', 'rot', 'variant', 'capacity', 'wealth', 'flags', 'baseY'] as const;
const BUILDING_KEYS = new Set<string>(['def', ...REC_FIELDS]);

/** The definition table lives for one ready → resync session, not for one packet. */
export class DefTable {
  readonly values: string[];
  private indices = new Map<string, number>();
  private sent: number;
  constructor(defs: readonly string[] = []) {
    this.values = [...defs];
    defs.forEach((d, i) => this.indices.set(d, i));
    this.sent = defs.length;
  }
  index(def: string): number {
    let i = this.indices.get(def);
    if (i === undefined) { i = this.values.length; this.values.push(def); this.indices.set(def, i); }
    return i;
  }
  takeAppends(): string[] { const a = this.values.slice(this.sent); this.sent = this.values.length; return a; }
}

export function writeBuilding(out: Float64Array, offset: number, b: Building, defs: DefTable, audit = false): void {
  if (audit) for (const key of Object.keys(b)) if (!BUILDING_KEYS.has(key)) throw new Error(`Unknown building field: ${key}`);
  for (let k = 0; k < REC_FIELDS.length; k++) out[offset + k] = b[REC_FIELDS[k]] ?? NaN;
  out[offset + REC - 1] = defs.index(b.def);
}

/** Literal shape / named optional stores match serialize.ts's restoredBuilding. */
export function readBuilding(data: Float64Array, index: number, defs: readonly string[], target?: Building): Building {
  const o = index * REC;
  if (!Number.isInteger(index) || index < 0 || o + REC > data.length) throw new Error('Invalid building record index');
  const def = defs[data[o + 24]];
  if (def === undefined) throw new Error('Unknown building definition index');
  const b = target ?? {
    id: data[o], def, x: data[o + 1], z: data[o + 2], w: data[o + 3], d: data[o + 4], rot: data[o + 5] as Building['rot'],
    variant: data[o + 6], pop: data[o + 7], jobs: data[o + 8], capacity: data[o + 9], wealth: data[o + 10],
    built: data[o + 11], age: data[o + 12], flags: data[o + 13], baseY: data[o + 14], health: data[o + 15], unhappy: data[o + 16],
  };
  if (target) {
    const r = b as unknown as Record<string, number | string | undefined>;
    for (let k = 0; k < 17; k++) r[REC_FIELDS[k]] = data[o + k];
    b.def = def;
  }
  const opt = (k: number) => Number.isNaN(data[o + k]) ? undefined : data[o + k];
  let optional = false;
  for (let k = 17; k < 24; k++) if (!Number.isNaN(data[o + k]) || Object.hasOwn(b, REC_FIELDS[k])) { optional = true; break; }
  if (optional) {
    b.kids = opt(17); b.teens = opt(18); b.yad = opt(19); b.srs = opt(20); b.wf = opt(21); b.edu = opt(22); b.hire = opt(23);
  }
  return b;
}

export class RecordBuffer {
  private data = new Float64Array(REC * 64);
  count = 0;
  add(b: Building, defs: DefTable, audit = false): number {
    if ((this.count + 1) * REC > this.data.length) {
      const next = new Float64Array(this.data.length * 2);
      next.set(this.data); this.data = next;
    }
    writeBuilding(this.data, this.count * REC, b, defs, audit);
    return this.count++;
  }
  take(): Float64Array { const a = this.data.slice(0, this.count * REC); this.count = 0; return a; }
  clear(): void { this.count = 0; }
}

export function layerOf(st: CityState, name: LayerName): AnyTypedArray {
  const a = name.startsWith('desirability:') ? st.desirability[Number(name.slice(13))] : st[name as keyof CityState];
  if (!ArrayBuffer.isView(a) || a instanceof DataView) throw new Error(`Unknown layer: ${name}`);
  return a as AnyTypedArray;
}
export function encodeCell(st: CityState, layer: CellLayer, rect: CellRect): CellPatch {
  const stride = st.size + (layer === 'heights' ? 1 : 0);
  const { x0, z0, x1, z1 } = rect;
  checkRect(rect, stride);
  const src = st[layer];
  const data = new (src.constructor as { new (n: number): AnyTypedArray })((x1 - x0) * (z1 - z0));
  let k = 0;
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) data[k++] = src[z * stride + x];
  return { layer, x0, z0, x1, z1, data };
}
function checkRect(r: CellRect, stride: number): void {
  if (![r.x0, r.z0, r.x1, r.z1].every(Number.isInteger) || r.x0 < 0 || r.z0 < 0 || r.x1 > stride || r.z1 > stride || r.x0 > r.x1 || r.z0 > r.z1) throw new Error('Invalid cell rectangle');
}
export function applyCell(st: CityState, p: CellPatch): void {
  const stride = st.size + (p.layer === 'heights' ? 1 : 0);
  checkRect(p, stride);
  const dst = st[p.layer];
  if (!dst || dst.constructor !== p.data.constructor || p.data.length !== (p.x1 - p.x0) * (p.z1 - p.z0)) throw new Error('Invalid cell patch');
  let k = 0;
  for (let z = p.z0; z < p.z1; z++) for (let x = p.x0; x < p.x1; x++) dst[z * stride + x] = p.data[k++];
}
export function encodeLayer(name: LayerName, data: AnyTypedArray, previous?: AnyTypedArray): LayerPatch {
  if (!previous || previous.length !== data.length || previous.constructor !== data.constructor) return { name, whole: data.slice() };
  let n = 0;
  for (let i = 0; i < data.length; i++) if (!Object.is(data[i], previous[i])) n++;
  if (n > data.length / 4) return { name, whole: data.slice() };
  const idx = new Uint32Array(n), val = new (data.constructor as { new (n: number): AnyTypedArray })(n);
  let k = 0;
  for (let i = 0; i < data.length; i++) if (!Object.is(data[i], previous[i])) { idx[k] = i; val[k++] = data[i]; }
  return { name, idx, val };
}
export function encodeRoad(name: 'traffic' | 'congestion', data: Float32Array, network: Uint8Array): LayerPatch {
  if (data.length !== network.length) throw new Error('Traffic/network length mismatch');
  let n = 0, exceptions = 0;
  for (let i = 0; i < data.length; i++) { if (network[i]) n++; else if (!Object.is(data[i], 0)) exceptions++; }
  const road = new Float32Array(n), idx = new Uint32Array(exceptions), val = new Float32Array(exceptions);
  let r = 0, e = 0;
  for (let i = 0; i < data.length; i++) {
    if (network[i]) road[r++] = data[i];
    else if (!Object.is(data[i], 0)) { idx[e] = i; val[e++] = data[i]; }
  }
  return exceptions ? { name, road, off: { idx, val } } : { name, road };
}
export function applySparse(dst: AnyTypedArray, idx: Uint32Array, val: AnyTypedArray): void {
  if (idx.length !== val.length || dst.constructor !== val.constructor) throw new Error('Invalid sparse layer');
  for (let k = 0; k < idx.length; k++) {
    if (idx[k] >= dst.length || (k > 0 && idx[k] <= idx[k - 1])) throw new Error('Invalid sparse index');
    dst[idx[k]] = val[k];
  }
}
export function applyLayer(st: CityState, p: LayerPatch): void {
  const dst = layerOf(st, p.name);
  if ('whole' in p) {
    if (dst.length !== p.whole.length || dst.constructor !== p.whole.constructor) throw new Error('Invalid whole layer');
    dst.set(p.whole); return;
  }
  if ('road' in p) {
    let n = 0;
    for (let i = 0; i < st.cells; i++) if (st.network[i]) n++;
    if (n !== p.road.length) throw new Error('Traffic/network count mismatch');
    let r = 0;
    for (let i = 0; i < st.cells; i++) dst[i] = st.network[i] ? p.road[r++] : 0;
    if (p.off) applySparse(dst, p.off.idx, p.off.val);
  } else applySparse(dst, p.idx, p.val);
}

export function encodeIncident(inc: Incident): IncidentRecord { return structuredClone(inc); }
export function decodeIncident(inc: IncidentRecord, target?: Incident): Incident {
  return mergePlain(target ?? {} as Incident, inc);
}
export function encodeLog(log: readonly Entry[]): Entry[] { return copyOwned([...log]); }
export function decodeLog(log: readonly Entry[]): Entry[] { return copyOwned([...log]); }
export function encodeAck(result: unknown): unknown {
  if (plainObject(result)) {
    const { cells: _cells, ...rest } = result;
    return copyOwned(rest);
  }
  return copyOwned(result);
}
export function rectArg(r: CellRect): number[] { return [r.x0, r.z0, r.x1, r.z1]; }
export function argRect(a: number[]): CellRect { return { x0: a[0], z0: a[1], x1: a[2], z1: a[3] }; }

/** Replace a complete plain section, keeping all surviving object / array identities, including nested ones. */
export function mergePlain<T>(target: T, source: T): T {
  if (Array.isArray(target) && Array.isArray(source)) {
    for (let i = 0; i < source.length; i++) target[i] = mergePlain(target[i], source[i]);
    target.length = source.length; return target;
  }
  if (plainObject(target) && plainObject(source)) {
    const dst: Record<string, unknown> = target;
    for (const key of Object.keys(dst)) if (!Object.hasOwn(source, key)) delete dst[key];
    for (const key of Object.keys(source)) dst[key] = mergePlain(dst[key], source[key]);
    return target;
  }
  return copyOwned(source);
}
function plainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
}
export function plainEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a.constructor !== b.constructor) return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Map && b instanceof Map) return plainEqual([...a], [...b]);
  if (a instanceof Set && b instanceof Set) return plainEqual([...a], [...b]);
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    if (a.byteLength !== b.byteLength) return false;
    const aa = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), bb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
    return true;
  }
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => Object.hasOwn(b, k) && plainEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Copy system data / routes without inheriting a scratch array's backing allocation. */
export function copyOwned<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') throw new Error('Non-cloneable protocol value');
    return value;
  }
  const seen = new Map<object, unknown>();
  const copy = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'function' || typeof v === 'symbol') throw new Error('Non-cloneable protocol value');
      return v;
    }
    if (seen.has(v)) return seen.get(v);
    if (ArrayBuffer.isView(v)) {
      const out = v instanceof DataView ? new DataView(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer) : (v as AnyTypedArray).slice();
      seen.set(v, out); return out;
    }
    if (v instanceof ArrayBuffer || v instanceof Date) return structuredClone(v);
    if (v instanceof Map) { const m = new Map(); seen.set(v, m); for (const [k, x] of v) m.set(copy(k), copy(x)); return m; }
    if (v instanceof Set) { const s = new Set(); seen.set(v, s); for (const x of v) s.add(copy(x)); return s; }
    if (!Array.isArray(v) && !plainObject(v)) throw new Error('Non-plain protocol value');
    const out: Record<string, unknown> | unknown[] = Array.isArray(v) ? new Array(v.length) : {};
    seen.set(v, out);
    for (const [k, x] of Object.entries(v)) (out as Record<string, unknown>)[k] = copy(x);
    return out;
  };
  return copy(value) as T;
}

/** R9: a clone copies the backing buffer, not just the view. Also reject shared memory in W1. */
export function assertOwnedBuffers(value: unknown): void {
  const seen = new Set<object>();
  const visit = (v: unknown): void => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      if (!(v.buffer instanceof ArrayBuffer) || v.byteOffset !== 0 || v.byteLength !== v.buffer.byteLength) throw new Error('Message view must own its whole ArrayBuffer');
    } else if (v instanceof ArrayBuffer || v instanceof Date) return;
    else if (v instanceof Map) for (const [k, x] of v) { visit(k); visit(x); }
    else if (v instanceof Set) for (const x of v) visit(x);
    else {
      if (!Array.isArray(v) && !plainObject(v)) throw new Error('Non-plain message object');
      for (const x of Object.values(v)) visit(x);
    }
  };
  visit(value);
}
export function cloneMessage<T extends M2W | W2M | Reply>(message: T): T {
  assertOwnedBuffers(message);
  return structuredClone(message);
}

/** Clone-volume estimate: distinct backing buffers in full, plus scalar / UTF-16 property data, not a wire format. */
export function cloneBytes(value: unknown): number {
  const seen = new Set<object>();
  const count = (v: unknown): number => {
    if (typeof v === 'string') return v.length * 2;
    if (typeof v === 'number' || typeof v === 'bigint') return 8;
    if (v === null || typeof v !== 'object') return 1;
    if (seen.has(v)) return 0;
    seen.add(v);
    if (ArrayBuffer.isView(v)) return count(v.buffer);
    if (v instanceof ArrayBuffer) return v.byteLength;
    if (v instanceof Date) return 8;
    if (v instanceof Map) { let n = 0; for (const [k, x] of v) n += count(k) + count(x); return n; }
    if (v instanceof Set) { let n = 0; for (const x of v) n += count(x); return n; }
    if (Array.isArray(v)) return v.reduce((n, x) => n + count(x), 0);
    let n = 0;
    for (const [k, x] of Object.entries(v)) n += k.length * 2 + count(x);
    return n;
  };
  return count(value);
}
