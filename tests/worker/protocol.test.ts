/** W1.1a / R9: every wire variant clones; codecs preserve values and never send scratch-buffer views. */
import { describe, expect, it } from 'vitest';
import { Network, Overlay } from '../../src/core/types';
import { serializeCity } from '../../src/save/serialize';
import type { Incident } from '../../src/sim/infra/emergency';
import {
  CELL_LAYERS, DefTable, EntryType, PROTOCOL_VERSION, REC, REC_FIELDS, RecordBuffer, applyCell, applyLayer,
  assertOwnedBuffers, cloneBytes, cloneMessage, copyOwned, decodeIncident, decodeLog, encodeAck, encodeCell,
  encodeIncident, encodeLayer, encodeLog, encodeRoad, readBuilding,
  type Entry, type M2W, type Packet, type Reply, type W2M,
} from '../../src/worker/protocol';
import { newState, place } from '../infra/cityGen';
import { importGraph, scanFiles, sourceFiles } from './hygieneScan';

function incident(): Incident {
  return { id: 1, kind: 'fire', x: 2, z: 3, buildingId: 1, major: true, state: 'failed', start: 2, deadline: 4,
    severity: 3, need: { fire: 1 }, units: [7], reason: 'noStation', manualPossible: false, canSend: false,
    prompted: true, bestEta: Infinity, bestFrom: 9, etaMin: 4, place: 'House', note: 'No station', grace: 1,
    arrived: -1, firstAt: {}, answered: 0, work: 1, injured: 2, deaths: 1, radius: 0, fires: [1], lost: 1,
    saved: 0, retry: 2, stVer: 3 };
}

describe('worker protocol messages', () => {
  it('structuredClone preserves every M2W, W2M and Reply variant, with owned buffers throughout', () => {
    const st = newState(8), b = place(st, 't_r1', 2, 3, { pop: 12, kids: Math.fround(0.2) });
    const snapshot = serializeCity(st, { copy: true }), defs = new DefTable();
    const recs = new RecordBuffer(); recs.add(b, defs);
    const clock = { day: 4, frac: 0.5, speed: 3, slow: 1, spd: 0.05, live: true };
    const policy = { alerts: [{ id: 1, wasPossible: true }], live: true, warn: true as const, toast: { text: 'Fire', kind: 'warning' as const } };
    const journal = { v: 1 as const, regionId: 'r', tileKey: 't', at: 10, base: { kind: 'save' as const, savedAt: 9 }, fromCmd: 0,
      ops: [{ seq: 1, op: 'setHistoric' as const, args: [1, true] }] };
    const replies: Reply[] = [
      { t: 'qres', cmd: 0, id: 1, ok: true, value: { route: new Uint32Array([1, 2]), eta: Infinity, missing: undefined } },
      { t: 'qres', cmd: 0, id: 2, ok: false, error: 'unknown building' },
      { t: 'saved', id: 3, ok: true, savedAt: 10, cmd: 2, fp: 'abc', pktSeq: 1,
        record: { key: 'r:t', regionId: 'r', tileKey: 't', savedAt: 10, city: snapshot } },
      { t: 'saved', cmd: 0, id: 4, ok: false, error: 'storage unavailable' },
      { t: 'snapped', id: 5, marker: { v: 1, regionId: 'r', tileKey: 't', at: 11, baseSavedAt: 10, bytes: 3,
        ls: true, dropped: [], cityName: 'City', day: 4, population: 12, funds: 10 }, payload: new Uint8Array([1, 2, 3]), cmd: 2 },
      { t: 'snapped', id: 6, cmd: 2, ok: false, error: 'storage unavailable' },
      { t: 'snapped', id: 7, cmd: 2, ok: false },
      { t: 'error', cmd: 0, key: 'system:fire', title: 'Fire failed', message: 'error', stack: 'stack', sim: true, disabled: true },
    ];
    const packet: Packet = {
      seq: 1, cmd: 2, clock, log: [[EntryType.BuildingAdded, 4, 0, 2], [EntryType.Emergency, 4, [{ type: 'failed', id: 1, kind: 'fire', x: 2, z: 3, major: true, manualPossible: false }, 0]], [EntryType.Ack, 4, 0, 2]],
      defs: defs.takeAppends(), recs: recs.take(), incs: [incident()], cells: [encodeCell(st, 'trees', { x0: 0, z0: 0, x1: 2, z1: 2 })],
      layers: [encodeLayer('powered', st.powered, st.powered), encodeRoad('traffic', st.traffic, st.network), encodeLayer('crime', st.crime)],
      rasters: [{ overlay: Overlay.Demographics, variant: 0, data: new Float32Array(st.cells), scale: 1, day: 4 }],
      blds: new Float64Array(0), plain: { funds: 10, unlocked: ['school'], historyTail: { t: [1], pop: [12] }, sys: { regionJobs: 1 } },
      emergency: { incidents: [incident()], vehicles: [], active: true, layersReady: true, stVer: 3, stations: [] },
      traffic: { routes: [{ cells: new Uint32Array([1, 2]), weight: 10, kind: 'car' }], trucks: { idx: new Uint32Array([1]), val: new Float32Array([2]) } },
      disasters: [{ kind: 'tornado', x: 1, z: 2, heading: 0, daysLeft: 4, magnitude: 1 }], policy,
      watch: [{ id: 1, cmd: 0, key: 'building:1', value: { pop: 12 } }, { id: 2, cmd: 2, key: '{}', error: 'query failed' }], replies, acks: [encodeAck({ ok: true, cells: [{ x: 1, z: 1, ok: true }] })],
      pong: 4, stats: { busy: 0.5, msPerDay: 3, units: { day: 1 }, queue: 0 }, digest: 123,
    };
    const init = { t: 'init' as const, v: PROTOCOL_VERSION, rctx: null, initialSpeed: 3,
      settings: { emergencyUncovered: 'live' as const, emergencyLiveSlowmo: 3, emergencyAlerts: 'major' as const },
      flags: { simwasm: null, dev: true }, persistence: 'main' as const };
    const messages: (M2W | W2M | Reply)[] = [
      { ...init, city: { kind: 'idb', regionId: 'r', tileKey: 't' }, persistence: 'worker-idb', journal },
      { ...init, city: { kind: 'serialized', regionId: 'r', tileKey: 't', savedAt: 9, city: snapshot } },
      { t: 'tick', seq: 1, dt: 0.016, ack: 0 }, { t: 'cmd', seq: 1, op: 'zone', args: [{ x0: 0, z0: 0, x1: 2, z1: 2 }, 1], atDay: 4 },
      { t: 'query', id: 1, name: 'inspectBuilding', args: { id: 1 } },
      { t: 'watch', id: 1, name: 'capHints', args: {}, when: 'daily' }, { t: 'unwatch', id: 1 },
      { t: 'view', v: { overlay: Overlay.Traffic, variant: 1, panels: ['roadInspector'], focus: [1] } },
      { t: 'save', id: 1, reason: 'manual' }, { t: 'snapshot', id: 1, why: 'journal' }, { t: 'ping', n: 1 }, { t: 'resync' }, { t: 'dispose' },
      { t: 'hello', v: PROTOCOL_VERSION },
      ...(['idb', 'deserialize', 'wasm', 'systems', 'journal', 'snapshot'] as const).map((phase): W2M => ({ t: 'boot', phase, pct: 0.5 })),
      { t: 'ready', snapshot, streams: { emergency: packet.emergency, traffic: packet.traffic, disasters: packet.disasters }, policy, clock, savedAt: 9, cmd: 0, journal },
      { t: 'ready', snapshot, streams: {}, policy, clock, savedAt: 9, cmd: 1,
        journal: { ...journal, base: { kind: 'snapshot', at: 10, baseSavedAt: 9 } } },
      { t: 'pkt', p: packet }, { t: 'fatal', message: 'boot failed', stack: 'stack' }, ...replies,
    ];
    for (const message of messages) {
      assertOwnedBuffers(message);
      const cloned = cloneMessage(message);
      expect(cloned, message.t).toEqual(message);
      assertOwnedBuffers(cloned);
      expect(cloneBytes(cloned)).toBe(cloneBytes(message));
    }
    expect(packet.acks).toEqual([{ ok: true }]);
  });

  it('rejects borrowed buffers recursively and counts a clone of the whole backing allocation', () => {
    const buffer = new ArrayBuffer(4096), view = new Uint8Array(buffer, 64, 16);
    const message = { t: 'qres' as const, cmd: 0, id: 1, ok: true, value: new Map([['nested', new Set([view])]]) };
    expect(() => cloneMessage(message)).toThrow(/own/);
    const clone = structuredClone(view);
    expect(clone.buffer.byteLength).toBe(4096);
    expect(cloneBytes(view)).toBe(4096);
    expect(cloneBytes([view, new Uint8Array(buffer)])).toBe(4096);
    expect(cloneBytes(view.slice())).toBe(16);
    const owned = copyOwned(message);
    expect(() => assertOwnedBuffers(owned)).not.toThrow();
    expect(cloneMessage(owned)).toEqual(owned);
    expect(() => cloneMessage({ t: 'qres', cmd: 0, id: 1, ok: true, value: () => 1 })).toThrow();
  });
});

describe('worker protocol codecs', () => {
  it('round-trips 25-number records, NaN optionals, growing buffers and session definition appends', () => {
    const st = newState(8), b = place(st, 't_r1', 1, 2, { pop: 123.125, jobs: 0.75, kids: Math.fround(0.2), hire: undefined });
    const defs = new DefTable(['initial']), buffer = new RecordBuffer();
    for (let i = 0; i < 70; i++) { b.pop = i + 0.125; buffer.add(b, defs, true); }
    const data = buffer.take();
    assertOwnedBuffers(data);
    expect(data.length).toBe(70 * REC);
    expect(Number.isNaN(data[REC_FIELDS.indexOf('hire')])).toBe(true);
    expect(defs.takeAppends()).toEqual(['t_r1']);
    const target = readBuilding(data, 0, defs.values);
    expect(target.pop).toBe(0.125);
    expect(readBuilding(data, 69, defs.values, target)).toBe(target);
    for (const key of REC_FIELDS) expect(target[key], key).toBe(b[key]);
    b.def = 'another'; buffer.add(b, defs);
    expect(defs.takeAppends()).toEqual(['another']);
    expect(readBuilding(buffer.take(), 0, defs.values)).toEqual(b);
    expect(defs.takeAppends()).toEqual([]);
    expect(() => buffer.add({ ...b, modField: 1 } as typeof b, defs, true)).toThrow(/Unknown building field/);
    expect(() => readBuilding(data, 70, defs.values)).toThrow();
    expect(() => readBuilding(data, 0, [])).toThrow();
  });

  it('round-trips incidents and logs without aliasing the event-time record', () => {
    const inc = incident(), encoded = encodeIncident(inc);
    inc.lost = 5; inc.units.push(8);
    const target = decodeIncident(encoded), units = target.units;
    expect(target).toEqual(encoded);
    expect(target.lost).toBe(1);
    expect(decodeIncident({ ...encoded, lost: 2 }, target)).toBe(target);
    expect(target.units).toBe(units);
    const log: Entry[] = [[EntryType.Emergency, 4, [{ type: 'failed', id: 1 }, 0]], [EntryType.News, 4, { day: 4, text: 'Lost', kind: 'bad' }, 2], [EntryType.Reset, 4, undefined]];
    expect(decodeLog(encodeLog(log))).toEqual(log);
    expect(encodeLog(log)[0][2]).not.toBe(log[0][2]);
  });

  it('round-trips every primary cell patch, including terrain corner rectangles', () => {
    const src = newState(8), dst = newState(8);
    for (const name of CELL_LAYERS) {
      const a = src[name]; for (let i = 0; i < a.length; i++) a[i] = (i % 200) + (name === 'heights' ? 0.5 : 0);
      const n = src.size + (name === 'heights' ? 1 : 0);
      const patch = encodeCell(src, name, { x0: 0, z0: 0, x1: n, z1: n });
      assertOwnedBuffers(patch);
      const identity = dst[name]; applyCell(dst, structuredClone(patch));
      expect(dst[name]).toBe(identity); expect(dst[name]).toEqual(a);
    }
    expect(() => encodeCell(src, 'water', { x0: -1, z0: 0, x1: 1, z1: 1 })).toThrow();
  });

  it('round-trips sparse and whole layers at the 25% boundary', () => {
    const st = newState(8), src = st.powered.slice(), baseline = src.slice();
    src.fill(1, 0, 16);
    const sparse = encodeLayer('powered', src, baseline);
    expect('idx' in sparse).toBe(true); assertOwnedBuffers(sparse);
    applyLayer(st, structuredClone(sparse)); expect(st.powered).toEqual(src);
    src[16] = 1;
    const whole = encodeLayer('powered', src, baseline);
    expect('whole' in whole).toBe(true);
    applyLayer(st, structuredClone(whole)); expect(st.powered).toEqual(src);
    const floats = st.crime.slice(); floats[0] = NaN; floats[1] = -0;
    applyLayer(st, structuredClone(encodeLayer('crime', floats, st.crime)));
    expect(st.crime).toEqual(floats); expect(Object.is(st.crime[1], -0)).toBe(true);
    applyLayer(st, encodeLayer('desirability:3', new Float32Array(st.cells).fill(0.25)));
    expect(st.desirability[3][1]).toBe(0.25);
  });

  it('round-trips road-only traffic with stale off-road exceptions and a changed network', () => {
    const st = newState(8);
    st.network[2] = Network.Road; st.network[8] = Network.Rail; st.network[12] = Network.Avenue;
    const values = new Float32Array(st.cells);
    values[2] = 100; values[8] = 200; values[12] = 300; values[1] = 9; values[3] = NaN; values[4] = -0;
    for (const name of ['traffic', 'congestion'] as const) {
      const patch = encodeRoad(name, values, st.network);
      expect('road' in patch && patch.road.length).toBe(3);
      assertOwnedBuffers(patch); applyLayer(st, structuredClone(patch));
      for (let i = 0; i < values.length; i++) expect(Object.is(st[name][i], values[i]), String(i)).toBe(true);
    }
    st.network[2] = Network.None;
    const removed = encodeRoad('traffic', values, st.network);
    expect('road' in removed && removed.off?.idx).toContain(2);
    st.traffic.fill(999); applyLayer(st, removed); expect(st.traffic).toEqual(values);
    const empty = encodeRoad('traffic', new Float32Array(st.cells), new Uint8Array(st.cells));
    expect('road' in empty && empty.off).toBeUndefined();
    expect(() => applyLayer(st, { name: 'traffic', road: new Float32Array(10) })).toThrow(/count mismatch/);
  });

  it('extends S1 hygiene to the new worker and bench files, with a clean production import graph', async () => {
    expect(scanFiles([...sourceFiles('src/worker'), ...sourceFiles('tools/bench/worker')])).toEqual([]);
    const graph = await importGraph('src/worker/loopbackCore.ts');
    expect(graph).toContain('src/worker/recorder.ts');
    expect(graph.filter((p) => ['src/save/bundle.ts', 'src/save/index.ts', 'src/save/recoveryLs.ts'].includes(p))).toEqual([]);
  });
});
