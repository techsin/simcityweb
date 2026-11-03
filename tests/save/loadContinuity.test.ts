/**
 * T057: a saved and reloaded city continues bit for bit like the uninterrupted game (the economy systems).
 *
 * A small SimBot city (64², two years) is the uninterrupted game. It is saved as a file (serializeCity + encodeBundle)
 * on several days of a month — before and after the month tick, on the population sample days, on tourism's venue
 * day (26), on the advisors' scan days (28, 29) — and once right after a player edit between two days (a park
 * bulldozed, a road and a park built: the land value queue, the swap-removed building lists). Each save is loaded into a
 * new Simulation and both run 30 more days: the whole serialized city must be equal on every one of those days, and
 * right after the load. The infrastructure systems are not in this test: their continuity holds for B2's rewrite of
 * src/sim/infra (docs/dev/reports/cloud-T057-save-load.md).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SimBot } from '../../tools/simbot';
import { economySystems } from '../../src/sim/systems/economy';
import { Simulation } from '../../src/sim/Simulation';
import { CityActions } from '../../src/sim/actions';
import { BF, type CityState } from '../../src/sim/CityState';
import { Network, Zone } from '../../src/core/types';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { decodeBundle, encodeBundle } from '../../src/save/bundle';
import { getDef } from '../../src/sim/catalog';

function canonical(v: unknown): unknown {
  if (ArrayBuffer.isView(v)) {
    const b = new Uint8Array((v as ArrayBufferView).buffer, (v as ArrayBufferView).byteOffset, (v as ArrayBufferView).byteLength);
    return `${v.constructor.name}:${createHash('sha256').update(b).digest('hex')}`;
  }
  if (v instanceof Map) return ['$map', ...[...v.entries()].map(([k, x]) => [canonical(k), canonical(x)])];
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : Number.isNaN(v) ? 'NaN' : v;
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}
/** the whole city as saved, key by key (savedAt aside) */
function digest(st: CityState): Record<string, string> {
  const s = serializeCity(st, { copy: true }) as unknown as Record<string, unknown>;
  const out: Record<string, string> = {};
  const add = (k: string, v: unknown) => { out[k] = createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex').slice(0, 16); };
  for (const k of Object.keys(s)) if (k !== 'savedAt' && k !== 'data') add(k, s[k]);
  const data = s.data as Record<string, unknown>;
  for (const k of Object.keys(data)) if (k !== 'systemData' && k !== 'stats') add(`data.${k}`, data[k]);
  const stats = data.stats as Record<string, unknown>;
  for (const k of Object.keys(stats)) add(`stats.${k}`, stats[k]);
  const sd = data.systemData as Record<string, unknown>;
  for (const k of Object.keys(sd)) add(`sd.${k}`, sd[k]);
  return out;
}
const differing = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
const viaClone = (st: CityState) => deserializeCity(structuredClone(serializeCity(st, { copy: true })) as SerializedCity);

describe('T057: save / load continuity', () => {
  it('a small city saved on several days of the month continues bit-exact for 30 days (economy systems)', { timeout: 300_000 }, () => {
    const bot = new SimBot({ size: 64, years: 2, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0.15, quiet: true, noInfra: true }, economySystems());
    bot.run(2);
    const sim = bot.sim, st = bot.st;
    expect(st.stats.population).toBeGreaterThan(1000);
    const t0 = st.day; // a month tick
    // days of the month: 3, 11 (a sample day), 17 (the demographics sample), 26 (tourism's pass), 28, 29 (the advisors'
    // scans), 30 (the tick); the edit save on day 13
    const saveAt = [3, 11, 13, 17, 26, 28, 29, 30].map((d) => t0 + d);
    const editDay = t0 + 13;
    const end = Math.max(...saveAt) + 30;
    const saves = new Map<number, Uint8Array>();
    const want = new Map<number, Record<string, string>>();
    // the player between two days (in the uninterrupted game and in every loaded game that reaches that day): a park
    // bulldozed (a plopped building with a land value splat: the queue, the swap-remove), a new street with homes zoned
    // on both sides (growth's candidate cells)
    const L = 8;
    const edit = (s: Simulation) => {
      const c = s.state, A = new CityActions(s);
      const park = [...c.buildings.values()].find((b) => b.flags & BF.Plopped && getDef(b.def)?.landValue && getDef(b.def)?.service === 'parks');
      expect(park).toBeTruthy();
      expect(A.bulldoze({ x0: park!.x, z0: park!.z, x1: park!.x + 1, z1: park!.z + 1 }).ok).toBe(true);
      const free = (x: number, z: number) => { const i = c.idx(x, z); return c.network[i] === Network.None && c.building[i] < 0 && !c.water[i] && c.zone[i] === Zone.None; };
      for (let z = 3; z < c.size - 3; z++) {
        for (let x = 1; x + L < c.size - 1; x++) {
          let ok = true;
          for (let dz = -2; dz <= 2 && ok; dz++) for (let k = 0; k < L; k++) if (!free(x + k, z + dz)) { ok = false; break; }
          if (!ok) continue;
          expect(A.buildNetwork(Array.from({ length: L }, (_, k) => ({ x: x + k, z })), Network.Road).ok).toBe(true);
          expect(A.zone({ x0: x, z0: z - 2, x1: x + L, z1: z }, Zone.ResLow).ok).toBe(true);
          expect(A.zone({ x0: x, z0: z + 1, x1: x + L, z1: z + 3 }, Zone.ResLow).ok).toBe(true);
          street = { x, z };
          return;
        }
      }
      throw new Error('no room for the street');
    };
    let street = { x: -1, z: -1 };
    while (st.day < end) {
      sim.advanceDay();
      if (st.day === editDay) edit(sim);
      if (saveAt.includes(st.day)) saves.set(st.day, encodeBundle(serializeCity(st)));
      if (st.day >= Math.min(...saveAt)) want.set(st.day, digest(st));
    }
    expect(saves.size).toBe(saveAt.length);
    // (homes grew on the new street within the 30 days: the loaded games draw their lots from growth's candidates)
    let grown = 0;
    for (let dz = -2; dz <= 2; dz++) for (let k = 0; k < L; k++) if (st.building[st.idx(street.x + k, street.z + dz)] >= 0) grown++;
    expect(grown).toBeGreaterThan(0);
    for (const [day, bytes] of saves) {
      const copy = deserializeCity(decodeBundle(bytes) as SerializedCity);
      const sim2 = new Simulation(copy, economySystems());
      expect(differing(want.get(day)!, digest(copy)), `save on day ${day} (dom ${day % 30}): right after the load`).toEqual([]);
      for (let k = 0; k < 30; k++) {
        sim2.advanceDay();
        if (copy.day === editDay) edit(sim2);
        expect(differing(want.get(copy.day)!, digest(copy)), `save on day ${day} (dom ${day % 30}): day ${copy.day}`).toEqual([]);
      }
    }
    // (the IndexedDB path, a structured clone, holds the same city as the file)
    const st2 = deserializeCity(decodeBundle(saves.get(saveAt[0])!) as SerializedCity);
    expect(differing(digest(viaClone(st2)), digest(st2))).toEqual([]);
  });
});
