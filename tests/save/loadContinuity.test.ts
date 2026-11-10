/**
 * T057: a saved and reloaded city continues bit for bit like the uninterrupted game (the economy systems).
 *
 * A small SimBot city (64², two years) is the uninterrupted game. It is saved as a file (serializeCity + encodeBundle)
 * on several days of a month — before and after the month tick, on the population sample days, on tourism's venue
 * day (26), on the advisors' scan days (28, 29) — and once right after a player edit between two days (a park
 * bulldozed, a street built and zoned: the land value queue, the swap-removed building lists, growth's candidates; a tax
 * rate and the parks funding changed the day before a save: desirability's shift, demand's context). Each
 * save is loaded into a new Simulation and both run 30 more days (the loaded games get the same edit on its day): the
 * whole serialized city must be equal right after the load and on every one of those days. The infrastructure systems
 * are not in this test: their continuity waits for B2's rewrite of src/sim/infra (docs/dev/reports/cloud-T057-save-load.md).
 *
 * Also: saving is not a game event (the save hooks' contract, src/sim/persist.ts), and recovery snapshots may leave the
 * continuity records out.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SimBot } from '../../tools/simbot';
import { economySystems } from '../../src/sim/systems/economy';
import { Simulation } from '../../src/sim/Simulation';
import { CityActions } from '../../src/sim/actions';
import { BF, type CityState } from '../../src/sim/CityState';
import { DevType, Network, Zone } from '../../src/core/types';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { decodeBundle, encodeBundle } from '../../src/save/bundle';
import { getDef } from '../../src/sim/catalog';
import { applyCityDelta, encodeCityDelta } from '../../src/save/recoveryCodec';
import { CONTINUITY_RECORDS } from '../../src/sim/persist';

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
    // and a budget change on day 25, the day before a save: a tax rate (desirability's shift, taken at a sweep's start)
    // and the parks funding (the parks' cap relief in demand's context, rebuilt monthly)
    const budgetDay = t0 + 25;
    const edit2 = (s: Simulation) => {
      const A = new CityActions(s);
      A.setTax(DevType.R1, s.state.budget.taxRates[DevType.R1] + 2);
      A.setFunding('parks', 60);
    };
    while (st.day < end) {
      sim.advanceDay();
      if (st.day === editDay) edit(sim);
      if (st.day === budgetDay) edit2(sim);
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
        if (copy.day === budgetDay) edit2(sim2);
        expect(differing(want.get(copy.day)!, digest(copy)), `save on day ${day} (dom ${day % 30}): day ${copy.day}`).toEqual([]);
      }
    }
    // (the IndexedDB path, a structured clone, holds the same city as the file)
    const st2 = deserializeCity(decodeBundle(saves.get(saveAt[0])!) as SerializedCity);
    expect(differing(digest(viaClone(st2)), digest(st2))).toEqual([]);
  });

  it('saving is not a game event: a game that saves every day continues like one that never saves', { timeout: 120_000 }, () => {
    // (the save hooks write their records at every save; nothing the simulation reads may change with them)
    const opts = { size: 48, years: 1, seed: 5, difficulty: 'medium', terrain: 'plains', water: 0.1, quiet: true, noInfra: true } as const;
    const quiet = new SimBot({ ...opts }, economySystems());
    const saving = new SimBot({ ...opts }, economySystems());
    let saves = 0;
    saving.sim.events.on('day', () => { serializeCity(saving.st); saves++; });
    quiet.run(1);
    saving.run(1);
    expect(saves).toBeGreaterThan(300);
    expect(saving.st.stats.population).toBeGreaterThan(500);
    const records = new Set(CONTINUITY_RECORDS.map((k) => `sd.${k}`));
    const game = (st: CityState) => Object.fromEntries(Object.entries(digest(st)).filter(([k]) => !records.has(k)));
    expect(differing(game(quiet.st), game(saving.st))).toEqual([]);
  });

  it('recovery snapshots leave the continuity records out when lean or over their budget, and still load', { timeout: 120_000 }, () => {
    const bot = new SimBot({ size: 32, years: 1, seed: 3, difficulty: 'medium', terrain: 'flat', water: 0, quiet: true, noInfra: true }, economySystems());
    bot.run(1);
    const base = serializeCity(bot.st, { copy: true });
    bot.sim.runDays(5);
    const cur = serializeCity(bot.st, { copy: true });
    const sd = (d: { data: Record<string, unknown> }) => d.data.systemData as Record<string, unknown>;
    for (const k of CONTINUITY_RECORDS) expect(sd(cur)[k], k).toBeDefined();
    const kept = (o: { budget?: number; lean?: boolean }) => {
      const delta = encodeCityDelta(cur, base, 1, o);
      const back = applyCityDelta(structuredClone(delta), base);
      const st = deserializeCity(back);
      new Simulation(st, economySystems()).runDays(2); // (a city restored without them rebuilds that state at load)
      return CONTINUITY_RECORDS.filter((k) => sd(back)[k] !== undefined);
    };
    expect(kept({})).toEqual([...CONTINUITY_RECORDS]);
    expect(kept({ budget: 1 << 30 })).toEqual([...CONTINUITY_RECORDS]);
    expect(kept({ lean: true })).toEqual([]);
    expect(kept({ budget: 1 })).toEqual([]);
    // (the save itself is not changed)
    for (const k of CONTINUITY_RECORDS) expect(sd(cur)[k], k).toBeDefined();
  });

  it('a city saves to the same bytes whenever it was first saved (the records go last in systemData)', { timeout: 120_000 }, () => {
    // The worker host saves at boot and a local game at its first save, so a hook adds its record at different times;
    // a systemData key a system adds after that (here `lateKey`) must not change the save's bytes (tests/worker/hosts).
    const bot = new SimBot({ size: 32, years: 1, seed: 3, difficulty: 'medium', terrain: 'flat', water: 0, quiet: true, noInfra: true }, economySystems());
    bot.run(1);
    const base = serializeCity(bot.st, { copy: true });
    for (const k of CONTINUITY_RECORDS) delete (base.data.systemData as Record<string, unknown>)[k];
    const games = [0, 1].map(() => { const st = deserializeCity(base); return { st, sim: new Simulation(st, economySystems()) }; });
    for (const g of games) g.sim.runDays(1);
    serializeCity(games[0].st, { copy: true }); // (only the first game saves early)
    for (const g of games) { g.st.systemData.lateKey = { v: 1 }; g.sim.runDays(2); }
    const bytes = games.map((g) => createHash('sha256').update(encodeBundle({ ...serializeCity(g.st, { copy: true }), savedAt: 0 })).digest('hex'));
    expect(bytes[0]).toBe(bytes[1]);
    const keys = Object.keys(serializeCity(games[1].st).data.systemData as object);
    expect(keys.slice(-CONTINUITY_RECORDS.length)).toEqual([...CONTINUITY_RECORDS]);
  });
});
