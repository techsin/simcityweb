/** Untimed checks shared by the replica gates and the bench preflight. */
import { isDeepStrictEqual } from 'node:util';
import type { CityState } from '../../../src/sim/CityState';
import type { CityEvents, Simulation } from '../../../src/sim/Simulation';
import type { EmergencySystem, Incident } from '../../../src/sim/infra/emergency';
import type { Replica } from '../../../src/worker/replica';
import { EntryType, EVENT_NAMES, EVENT_TYPES, EXACT_FIELDS, MIRRORED_LAYERS, PLAIN_KEYS, PRIMARY_LAYERS, REC_FIELDS, SYSTEM_KEYS, type Packet } from '../../../src/worker/protocol';

type PacketContext = Pick<Packet, 'seq' | 'log'>;
type MirroredState = Pick<CityState, typeof MIRRORED_LAYERS[number]>;
const GROUPS = { utilities: ['powered', 'watered'], traffic: ['traffic', 'congestion'] } as const;
type MirroredGroup = keyof typeof GROUPS;

function compact(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`.slice(0, 180);
  if (typeof value === 'number' && Object.is(value, -0)) return '-0';
  if (value === null || typeof value !== 'object') return String(value).slice(0, 180);
  if (ArrayBuffer.isView(value)) return `${value.constructor.name}(${value.byteLength} bytes)`;
  if (Array.isArray(value)) return `Array(${value.length})`;
  return value.constructor?.name ?? 'object';
}

function mismatch(p: PacketContext, field: string, index: number | string, primary: unknown, replica: unknown, count = 1, reference = 'primary'): never {
  // A plain Error carries scalars only: neither node:assert nor Vitest can attach a full-array diff.
  const types = new Map<string, number>();
  for (const [type, , arg] of p.log) {
    const name = `${EntryType[type]}${type === EntryType.LayerUpdated ? `(${arg})` : ''}`;
    types.set(name, (types.get(name) ?? 0) + 1);
  }
  const log = [...types].map(([type, count]) => count === 1 ? type : `${type}×${count}`).join(', ');
  throw new Error(`packet ${p.seq}: ${field}; first differing index=${index}; ${reference}=${compact(primary)}; replica=${compact(replica)}; differing cells=${count}; log=[${log}]`);
}

/** Compare without ever handing an array or object to an assertion's diff formatter. */
export function checkValue(p: PacketContext, field: string, primary: unknown, replica: unknown, reference = 'primary'): void {
  if (Object.is(primary, replica)) return;
  if (ArrayBuffer.isView(primary) && !(primary instanceof DataView) && ArrayBuffer.isView(replica) && !(replica instanceof DataView)) {
    const a = primary as unknown as ArrayLike<number>, b = replica as unknown as ArrayLike<number>;
    if (primary.constructor !== replica.constructor) mismatch(p, `${field}.type`, '-', primary.constructor.name, replica.constructor.name);
    let first = -1, count = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (!Object.is(a[i], b[i])) { if (first < 0) first = i; count++; }
    if (count) mismatch(p, field, first, a[first], b[first], count, reference);
    return;
  }
  if (isDeepStrictEqual(primary, replica)) return;
  if (Array.isArray(primary) && Array.isArray(replica)) {
    let first = -1, count = 0;
    for (let i = 0; i < Math.max(primary.length, replica.length); i++) {
      if (i >= primary.length || i >= replica.length || !isDeepStrictEqual(primary[i], replica[i])) { if (first < 0) first = i; count++; }
    }
    if (first >= 0) {
      const a = primary[first], b = replica[first];
      if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') checkValue(p, `${field}[${first}]`, a, b, reference);
      mismatch(p, field, first, a, b, count, reference);
    }
  }
  if (primary instanceof Set && replica instanceof Set) checkValue(p, field, [...primary], [...replica], reference);
  if (primary instanceof Map && replica instanceof Map) checkValue(p, field, [...primary], [...replica], reference);
  if (primary !== null && replica !== null && typeof primary === 'object' && typeof replica === 'object') {
    for (const key of new Set([...Object.keys(primary), ...Object.keys(replica)])) {
      const a = (primary as Record<string, unknown>)[key], b = (replica as Record<string, unknown>)[key];
      if (!Object.hasOwn(primary, key) || !Object.hasOwn(replica, key)) mismatch(p, `${field}.${key}`, key, Object.hasOwn(primary, key) ? a : '<missing>', Object.hasOwn(replica, key) ? b : '<missing>');
      checkValue(p, `${field}.${key}`, a, b, reference);
    }
  }
  mismatch(p, field, '-', primary, replica, 1, reference);
}

/** Guarded sim/view callbacks may swallow throws. Retain only the first error and throw outside them. */
export class FirstFailure {
  private first?: { field: string; message: string };
  record(field: string, value: unknown): void { this.first ??= { field, message: compact(value) }; }
  check(p: PacketContext): void {
    if (this.first) mismatch(p, this.first.field, '-', 'no error', this.first.message);
  }
}

export function checkReplica(primary: CityState, replica: Replica, rolling = false,
  p: PacketContext = { seq: replica.seq, log: [] }, mirrored: MirroredState = primary): void {
  const st = replica.state;
  const equal = (field: string, a: unknown, b: unknown) => checkValue(p, field, a, b);
  equal('diverged', false, replica.diverged);
  equal('day', primary.day, st.day);
  for (const name of PRIMARY_LAYERS) equal(name, primary[name], st[name]);
  for (const name of MIRRORED_LAYERS) checkValue(p, name, mirrored[name], st[name], mirrored === primary ? 'primary' : 'primary(last sent)');
  equal('building count', primary.buildings.size, st.buildings.size);
  for (const b of primary.buildings.values()) {
    const rb = st.buildings.get(b.id);
    if (!rb) mismatch(p, `building ${b.id}`, b.id, 'present', 'missing');
    for (const key of EXACT_FIELDS) equal(`${b.id}.${key}`, b[key], rb[key]);
    if (rolling) { equal(`${b.id}.pop`, b.pop, rb.pop); equal(`${b.id}.jobs`, b.jobs, rb.jobs); }
    if (b.built < 1) equal(`${b.id}.built`, b.built, rb.built);
  }
  for (const key of PLAIN_KEYS) equal(key, primary[key], st[key]);
  for (const key of ['unlocked', 'announced', 'history', 'news'] as const) equal(key, primary[key], st[key]);
  for (const key of SYSTEM_KEYS) equal(`systemData.${key}`, primary.systemData[key], st.systemData[key]);
}

/** NOTE-020 gate for the unsubscribed strict suites. Only utilities/traffic may be deferred. */
export class ReplicaCheck {
  private readonly source: ReturnType<typeof tracePrimary>;
  private readonly replay: ReturnType<typeof traceReplica>;
  private readonly lastSent: MirroredState;
  private readonly sentAt = new Map<MirroredGroup, number>();
  private lastPacket: PacketContext = { seq: 0, log: [] };

  constructor(private sim: Simulation, private replica: Replica, cause?: () => number | undefined) {
    this.source = tracePrimary(sim, cause); this.replay = traceReplica(replica);
    // Seed from the authoritative ready state, never from possibly incorrect replica bytes.
    const st = sim.state;
    this.lastSent = { powered: st.powered.slice(), watered: st.watered.slice(), traffic: st.traffic.slice(), congestion: st.congestion.slice() };
    checkReplica(st, replica);
  }

  packet(p: Packet, nowMs: number): void {
    const expected: EventTrace[] = [], deferred: EventTrace[] = [];
    for (const event of this.source.events) {
      const group = event[0] === 'layerUpdated' && (event[2] === 'utilities' || event[2] === 'traffic') ? event[2] : undefined;
      // The sole F6 exception: retain just the throttled LayerUpdated entries, in original order.
      // All other events must arrive now. At the first packet >=250 ms, retained entries must arrive too.
      if (group && nowMs - (this.sentAt.get(group) ?? -Infinity) < 250) deferred.push(event);
      else expected.push(event);
    }
    checkValue(p, 'event log order/day/cause', expected.map(([name, day, , , cause]) => [EVENT_TYPES[name], day, cause]), p.log.map(([type, day, , cause]) => [type, day, cause]));
    checkValue(p, 'event replay', expected, this.replay.events);
    for (const group of Object.keys(GROUPS) as MirroredGroup[]) {
      const delivered = p.log.some(([type, , arg]) => type === EntryType.LayerUpdated && arg === group);
      for (const name of GROUPS[group]) {
        checkValue(p, `${name} patches with LayerUpdated(${group})`, delivered ? 1 : 0, p.layers?.filter((layer) => layer.name === name).length ?? 0);
        const reference = delivered ? this.sim.state[name] : this.lastSent[name];
        checkValue(p, name, reference, this.replica.state[name], delivered ? 'primary(end of packet)' : 'primary(last sent)');
        if (delivered) this.lastSent[name].set(reference);
      }
      if (delivered) this.sentAt.set(group, nowMs);
    }
    checkReplica(this.sim.state, this.replica, false, p, this.lastSent);
    this.source.events.length = 0; this.source.events.push(...deferred);
    this.replay.events.length = 0;
    this.lastPacket = { seq: p.seq, log: p.log };
  }

  rolling(): void { checkReplica(this.sim.state, this.replica, true, this.lastPacket, this.lastSent); }
  finish(): void {
    checkValue(this.lastPacket, 'undelivered events after drain', [], this.source.events);
    checkValue(this.lastPacket, 'unchecked replay events', [], this.replay.events);
  }
  dispose(): void { this.source.dispose(); this.replay.dispose(); }
}

export type EventTrace = [name: keyof typeof EVENT_TYPES, day: number, value: unknown, incident?: Incident, cause?: number];
export function tracePrimary(sim: Simulation, cause: () => number | undefined = () => undefined): { events: EventTrace[]; dispose(): void } {
  const events: EventTrace[] = [], refs = new Map<number, Incident>();
  const em = sim.getSystem<EmergencySystem>('emergency');
  for (const inc of em?.incidents() ?? []) refs.set(inc.id, inc);
  const off = EVENT_NAMES.map((name) => sim.events.on(name, (value) => {
    let inc: Incident | undefined;
    if (name === 'emergency') {
      const e = value as CityEvents['emergency'];
      inc = em?.incident(e.id) ?? refs.get(e.id);
      if (!inc) throw new Error(`Missing source incident ${e.id}`);
      refs.set(e.id, inc);
      if (e.type === 'failed' || e.type === 'resolved') refs.delete(e.id);
    }
    events.push([name, sim.state.day, traceValue(name, value), inc ? structuredClone(inc) : undefined, cause()]);
  }));
  return { events, dispose: () => off.forEach((f) => f()) };
}
export function traceReplica(replica: Replica): { events: EventTrace[]; dispose(): void } {
  const events: EventTrace[] = [];
  const off = EVENT_NAMES.map((name) => replica.events.on(name, (value) => {
    const inc = name === 'emergency' ? replica.emergency.incident((value as CityEvents['emergency']).id) : undefined;
    events.push([name, replica.state.day, traceValue(name, value), inc ? structuredClone(inc) : undefined, replica.cause?.seq]);
  }));
  return { events, dispose: () => off.forEach((f) => f()) };
}
function traceValue(name: string, value: unknown): unknown {
  if (name.startsWith('building')) {
    const b = value as CityEvents['buildingAdded'];
    return [b.def, ...REC_FIELDS.map((k) => b[k])];
  }
  return structuredClone(value);
}
