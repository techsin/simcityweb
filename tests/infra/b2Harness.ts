/**
 * B2 exactness harness (docs/dev/B2_DESIGN.md §11), shared by the groups' tests: digests of a city and of a system's
 * fields, a pass / cycle driver that runs one task's steps with nothing in between ("atomic"), and the piece-scale helper.
 *  - digest(v): sha256 of any value — typed arrays (bytes; a NaN matches any NaN: NaN bits are no JS semantics), JS
 *    arrays, plain objects (keys sorted), Maps and Sets (insertion order: it is part of the result), Buildings by id.
 *  - stateDigest(st): every CityState typed array, the stats, every building (all fields), systemData.
 *  - fieldsDigest(sys, exclude): every own field of a system (reflection), minus the excluded names.
 */
import { createHash, type Hash } from 'node:crypto';
import type { CityState } from '../../src/sim/CityState';
import type { Simulation } from '../../src/sim/Simulation';
import { schedulerOf, withPieceScale, type InfraTask } from '../../src/sim/infra/scheduler';

export { withPieceScale };

const NAN64 = new Uint8Array(new Float64Array([NaN]).buffer);
const NAN32 = new Uint8Array(new Float32Array([NaN]).buffer);

function feedView(h: Hash, v: ArrayBufferView): void {
  if (v instanceof Float32Array || v instanceof Float64Array) {
    // (canonical NaN: the bits of a NaN depend on the V8 tier that made it)
    const nan = v instanceof Float32Array ? NAN32 : NAN64, bytes = v.BYTES_PER_ELEMENT;
    let start = 0;
    const raw = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    for (let i = 0; i < v.length; i++) {
      if (v[i] === v[i]) continue;
      if (i > start) h.update(raw.subarray(start * bytes, i * bytes));
      h.update(nan);
      start = i + 1;
    }
    if (start < v.length) h.update(raw.subarray(start * bytes));
    return;
  }
  h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
}

/** feed v into the hash (cycles: an object seen before feeds its first-seen index) */
export function feed(h: Hash, v: unknown, seen = new Map<object, number>(), skip: ReadonlySet<string> = new Set()): void {
  if (v === null || v === undefined) { h.update(String(v)); return; }
  const t = typeof v;
  if (t === 'function') return;
  if (t !== 'object') { h.update(t[0] + (Object.is(v, -0) ? '-0' : Number.isNaN(v) ? 'NaN' : String(v))); return; }
  const o = v as object;
  const at = seen.get(o);
  if (at !== undefined) { h.update(`@${at}`); return; }
  seen.set(o, seen.size);
  if (ArrayBuffer.isView(o)) { h.update(`V${o.constructor.name}:${o.byteLength}`); feedView(h, o); return; }
  if (o instanceof Map) { h.update(`M${o.size}`); for (const [k, x] of o) { feed(h, k, seen); feed(h, x, seen); } return; }
  if (o instanceof Set) { h.update(`S${o.size}`); for (const x of o) feed(h, x, seen); return; }
  if (Array.isArray(o)) { h.update(`A${o.length}`); for (const x of o) feed(h, x, seen); return; }
  // (a Building: its id — the city digest covers its fields)
  const rec = o as Record<string, unknown>;
  if (typeof rec.id === 'number' && typeof rec.def === 'string' && typeof rec.x === 'number' && typeof rec.flags === 'number') { h.update(`B${rec.id}`); return; }
  const keys = Object.keys(rec).sort();
  h.update(`O${keys.length}`);
  for (const k of keys) { if (skip.has(k)) continue; h.update(k); feed(h, rec[k], seen); }
}

export function digest(v: unknown): string {
  const h = createHash('sha256');
  feed(h, v);
  return h.digest('hex').slice(0, 20);
}

/** per part: every typed-array field of the state, stats, buildings (every field), systemData, the scalars */
export function stateDigest(st: CityState): Record<string, string> {
  const out: Record<string, string> = {};
  const rec = st as unknown as Record<string, unknown>;
  for (const k of Object.keys(rec).sort()) {
    const v = rec[k];
    if (ArrayBuffer.isView(v)) out[k] = digest(v);
  }
  out.stats = digest(st.stats);
  const bs: unknown[] = [];
  for (const b of st.buildings.values()) bs.push({ ...b });
  out.buildings = digest(bs);
  out.systemData = digest(st.systemData);
  out.scalars = digest({ day: st.day, funds: st.funds, nextBuildingId: st.nextBuildingId });
  return out;
}

/** every own field of a system (reflection; typed arrays, Maps, Sets, arrays, objects), minus `exclude` */
export function fieldsDigest(sys: object, exclude: readonly string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const skip = new Set(exclude);
  const rec = sys as Record<string, unknown>;
  for (const k of Object.keys(rec)) {
    if (skip.has(k) || typeof rec[k] === 'function') continue;
    out[k] = digest(rec[k]);
  }
  return out;
}

/** the names of the parts two digests disagree on */
export function diffDigests(a: Record<string, string>, b: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}

/** a task of the shared scheduler by name */
export function taskOf(sim: Simulation, name: string): InfraTask {
  const t = schedulerOf(sim).tasks.find((x) => x.name === name);
  if (!t) throw new Error(`no task ${name}`);
  return t;
}

/** one traffic cycle driven piece by piece with nothing in between (atomic); onPiece after every piece */
export function trafficCycle(sim: Simulation, onPiece?: (k: number) => void, maxPieces = 5_000_000): number {
  const tr = sim.getSystem('traffic') as unknown as { phase: number; lastCycleStart: number; step(s: Simulation): void };
  tr.phase = 0;
  tr.lastCycleStart = sim.state.day;
  let k = 0;
  while (tr.phase >= 0) {
    tr.step(sim);
    k++;
    onPiece?.(k);
    if (k > maxPieces) throw new Error('traffic cycle did not finish');
  }
  return k;
}
