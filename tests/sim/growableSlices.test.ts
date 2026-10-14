/**
 * Final fixes SE-3 (lane sim-econ): the daily slices of the monthly growable passes (approval's resident survey,
 * tourism's hotel rooms / historic sites, EQ / HQ) read EconRuntime.growablesOfSlice(k) — the growables with
 * id % 30 === k — instead of scanning every growable three times a day. The buckets must hold exactly the buildings of
 * the filtered list in the list's order (the sliced float sums stay bit-identical), through adds, swap-removes,
 * plopped buildings sharing the position index, and list rebuilds.
 */
import { describe, expect, it } from 'vitest';
import { makeCity } from './helpers';
import { BF, type Building } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { getDef } from '../../src/sim/catalog';
import { EconRuntime, GROWABLE_SLICES } from '../../src/sim/economy/runtime';
import { placeBuilding, removeBuilding } from '../../src/sim/economy/buildings';
import { approvalSystem } from '../../src/sim/economy/approval';

function mirrorsList(rt: EconRuntime): string | null {
  for (let k = 0; k < GROWABLE_SLICES; k++) {
    const want = rt.growables.filter((b) => b.id % GROWABLE_SLICES === k);
    const got = rt.growablesOfSlice(k);
    if (got.length !== want.length) return `slice ${k}: ${got.length} buildings, list has ${want.length}`;
    for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) return `slice ${k}: #${i} is ${got[i].id}, list order says ${want[i].id}`;
  }
  return null;
}

describe('final fixes SE-3: the growables of a daily slice come from id % 30 buckets in list order', () => {
  it('the buckets mirror the filtered growables list through adds, swap-removes, plopped buildings and rebuilds', () => {
    const { st } = makeCity({ size: 64 }, []);
    const rt = new EconRuntime();
    const sim = new Simulation(st, [approvalSystem(rt)]);
    const home = getDef('res_apartment.r2.4')!, park = getDef('park_small')!;
    let seed = 12345;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    let nextId = 1;
    const add = (plopped: boolean) => {
      const def = plopped ? park : home;
      const b: Building = {
        id: nextId++, def: def.id, x: Math.floor(rnd() * 60), z: Math.floor(rnd() * 60), w: 1, d: 1, rot: 0, variant: 0, pop: plopped ? 0 : 40,
        jobs: 0, capacity: 40, wealth: 1, built: 1, age: 10, flags: plopped ? BF.Plopped : 0, baseY: 5, health: 1, unhappy: 0,
      };
      st.nextBuildingId = Math.max(st.nextBuildingId, nextId);
      placeBuilding(sim, b);
    };
    for (let k = 0; k < 120; k++) add(rnd() < 0.1);
    expect(mirrorsList(rt)).toBeNull();
    let removed = 0, rebuilt = 0;
    for (let op = 0; op < 900; op++) {
      const r = rnd();
      if (r < 0.5) add(rnd() < 0.1);
      else if (r < 0.97) {
        // a random building: a growable anywhere in the list (the swap-remove moves the list's last one) or a plopped one
        const all = [...st.buildings.values()];
        if (all.length) { removeBuilding(sim, all[Math.floor(rnd() * all.length)]); removed++; }
      } else {
        // a removal the runtime cannot place (never added): the list goes dirty and the next ensureLists rebuilds it
        sim.events.emit('buildingRemoved', { ...st.buildings.values().next().value!, id: 1_000_000 + op });
        rt.ensureLists();
        rebuilt++;
      }
      // (reading a bucket between edits, as the daily slices do, and not reading it for a while: both stay in step)
      if (op % 7 === 0 || op > 880) { const e = mirrorsList(rt); if (e) throw new Error(`after op ${op}: ${e}`); }
    }
    expect(removed).toBeGreaterThan(300);
    expect(rebuilt).toBeGreaterThan(5);
    expect(rt.growables.length).toBeGreaterThan(50);
    expect(mirrorsList(rt)).toBeNull();
    // the last list position: removing the list's last growable, then the first
    removeBuilding(sim, rt.growables[rt.growables.length - 1]);
    removeBuilding(sim, rt.growables[0]);
    expect(mirrorsList(rt)).toBeNull();
  });
});
