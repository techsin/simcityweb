/**
 * WP6a balance-bot rules (tools/simbot.ts; SIM_DEPTH_SPEC WP6 Bot, SIM_DEPTH_AMENDMENTS WP6-3, docs/SIM_DEPTH_PART_B.md
 * §5 WP6a + item 38): an attentive mayor dispatches to uncovered major emergencies (--neglect never does), a prison
 * goes into an industrial / utility block away from wealthy homes when the jail overflows, pumps are upgraded to a
 * treatment plant in place when no land is left, and a short run serves the catchment needs with every service and
 * utility on a lot that touches a road.
 */
import { describe, expect, it } from 'vitest';
import { JAIL_GAP, SimBot, botSystems } from '../../tools/simbot';
import { DevType, Network } from '../../src/core/types';
import { BF, type Building } from '../../src/sim/CityState';
import { lPath } from '../../src/sim/actions';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { CATALOG, getDef } from '../../src/sim/catalog';
import { lotTouchesRoad, placeBuilding } from '../../src/sim/economy/buildings';

async function bot(size: number, neglect = false) {
  return new SimBot({ size, years: 1, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0, quiet: true, noInfra: false, neglect }, await botSystems(false));
}

function plopAny(b: SimBot, def: string, x: number, z: number): Building {
  for (const rot of [0, 1, 2, 3] as const) if (b.A.plop(def, x, z, rot).ok) return b.st.buildingAt(x, z)!;
  throw new Error(`cannot plop ${def} at ${x},${z}`);
}

describe('bot: emergencies (WP6-3)', () => {
  it('dispatches the best unit to an uncovered major incident; --neglect leaves it uncovered', { timeout: 600000 }, async () => {
    for (const neglect of [false, true]) {
      const b = await bot(64, neglect);
      b.st.funds = 1e6;
      expect(b.A.buildNetwork(lPath({ x: 2, z: 20 }, { x: 62, z: 20 }), Network.Road).ok).toBe(true);
      plopAny(b, 'civ_clinic', 4, 18);
      const home = plopAny(b, 'civ_library', 52, 21);
      const em = emergencyOf(b.sim)!;
      b.sim.runDays(2);
      const id = em.spawn(b.sim, 'medical', home.x, home.z, { buildingId: home.id, major: true, severity: 10 });
      expect(id).toBeGreaterThanOrEqual(0);
      const inc = em.incident(id)!;
      expect(inc.state).toBe('uncovered');
      b.daily();
      expect(em.incident(id)?.state ?? 'resolved').toBe(neglect ? 'uncovered' : 'dispatched');
      expect(b.dispatches).toBe(neglect ? 0 : 1);
    }
  });
});

describe('bot: facilities', () => {
  it('builds a prison in an industrial / utility block, never within 12 cells of R$$$ homes, when the jail overflows', { timeout: 600000 }, async () => {
    const b = await bot(96);
    b.setup();
    b.st.funds = 5e6;
    b.st.unlocked.add('jail');
    b.st.stats.justice.overflow = 0.5;
    // an R$$$ home in the middle of the industrial / utility block nearest the prison's target: that block is out
    const st = b.st, N = st.size;
    const cx = b.line(b.cbx) + 5 * 9, cz = b.trunkZ;
    const near = b.blocks.filter((o) => o.use === 'I' || o.use === 'U')
      .sort((p, q) => Math.hypot((p.x0 + p.x1) / 2 - cx, (p.z0 + p.z1) / 2 - cz) - Math.hypot((q.x0 + q.x1) / 2 - cx, (q.z0 + q.z1) / 2 - cz))[0];
    const r3 = CATALOG.find((d) => d.devType === DevType.R3 && d.footprint[0] === 1 && d.footprint[1] === 1)
      ?? CATALOG.find((d) => d.devType === DevType.R3)!;
    const [hw, hd] = r3.footprint;
    // the free lot nearest the block's centre
    let hx = -1, hz = -1, hb = Infinity;
    const mx = (near.x0 + near.x1) / 2, mz = (near.z0 + near.z1) / 2;
    for (let z = near.z0; z + hd <= near.z1; z++) for (let x = near.x0; x + hw <= near.x1; x++) {
      let free = true;
      for (let zz = z; zz < z + hd && free; zz++) for (let xx = x; xx < x + hw; xx++) if (st.building[zz * N + xx] >= 0 || st.network[zz * N + xx]) { free = false; break; }
      const dd = Math.hypot(x - mx, z - mz);
      if (free && dd < hb) { hb = dd; hx = x; hz = z; }
    }
    expect(hx).toBeGreaterThanOrEqual(0);
    placeBuilding(b.sim, {
      id: st.nextBuildingId++, def: r3.id, x: hx, z: hz, w: hw, d: hd, rot: 0, variant: 0, pop: 8, jobs: 0,
      capacity: r3.capacity ?? 8, wealth: 3, built: 1, age: 0, flags: BF.Powered | BF.Watered, baseY: 1, health: 1, unhappy: 0,
    });
    b.ensureJustice();
    const jails = [...st.buildings.values()].filter((o) => o.def === 'civ_jail');
    expect(jails.length).toBe(1);
    const j = jails[0];
    expect(lotTouchesRoad(st, j.x, j.z, j.w, j.d)).toBe(true);
    const blk = b.blocks.find((o) => j.x >= o.x0 && j.x < o.x1 && j.z >= o.z0 && j.z < o.z1);
    expect(['I', 'U']).toContain(blk?.use);
    const G = JAIL_GAP;
    expect(G).toBe(12);
    const within = hx >= j.x - G && hx < j.x + j.w + G && hz >= j.z - G && hz < j.z + j.d + G;
    expect(within).toBe(false);
  });

  it('replaces pumps by a treatment plant in place when no land is left', { timeout: 600000 }, async () => {
    const b = await bot(96);
    b.setup();
    b.st.funds = 5e6;
    b.st.unlocked.add('water_treatment');
    const u = b.blocks.find((o) => o.use === 'U')!;
    b.buildBlockRoads(u);
    u.developed = true;
    let pumps = 0;
    for (let z = u.z0; z < u.z0 + 3; z++) for (let x = u.x0; x < u.x0 + 3; x += 2) if (b.A.plop('util_water_pump', x, z, 0).ok) pumps++;
    expect(pumps).toBeGreaterThan(0);
    expect(b.upgradePumps()).toBe(true);
    const plants = [...b.st.buildings.values()].filter((o) => o.def === 'util_water_treatment');
    expect(plants.length).toBe(1);
  });

  it('a short run serves catchment needs and puts every service and utility on a lot that touches a road', { timeout: 1200000 }, async () => {
    const b = await bot(96);
    b.run(4);
    const st = b.st;
    const s = st.stats;
    expect(s.population).toBeGreaterThan(3000);
    expect((st.milestones['civ_elementary_school'] ?? 0)).toBeGreaterThanOrEqual(1);
    let services = 0, noRoad = 0;
    for (const o of st.buildings.values()) {
      if (!(o.flags & BF.Plopped)) continue;
      const def = getDef(o.def);
      if (!def || def.category === 'transport' || def.category === 'park' || def.category === 'reward' || def.category === 'landmark') continue;
      services++;
      if (!lotTouchesRoad(st, o.x, o.z, o.w, o.d)) noRoad++;
    }
    expect(services).toBeGreaterThan(3);
    expect(noRoad).toBe(0);
    // the yearly report carries the new columns
    const row = b.rows[b.rows.length - 1];
    expect(row.kidsPct).toBeGreaterThan(0);
    expect(row.enrolE).toBeGreaterThan(0);
  });
});
