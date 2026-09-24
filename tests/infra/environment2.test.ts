/**
 * SIM_DEPTH_SPEC WP3 — environment & utilities completeness: smoke per source and load, wind, trees, noise per network,
 * garbage trucks / landfill fill / recycling / incineration, water bank coupling / sea / tap water, soil, utilities gaps
 * (thermal water, nuclear-free zone, brownout priority, wind turbines), crime additions.
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { getUtilities, type CrimeSystem, type PollutionSystem, type ServicesSystem } from '../../src/sim/systems/infra';
import { waterQualityAt } from '../../src/sim/infra/utilities';
import { windVector } from '../../src/sim/infra/wind';
import { seaCellCount, seaMask, shoreCells } from '../../src/sim/infra/terrainMasks';
import { setOrdinanceEnabled } from '../../src/sim/economy/ordinances';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { upsampleAdd } from '../../src/sim/infra/blur';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { newSim, newState, place, roadLine } from './cityGen';

const pol = (sim: ReturnType<typeof newSim>) => sim.getSystem<PollutionSystem>('pollution')!;

describe('WP3 smoke per source', () => {
  it('a coal plant at 0 load emits <= 35 % of its full-load air', () => {
    const run = (load: boolean) => {
      const st = newState(64);
      roadLine(st, 2, 30, 60, 30, Network.Road);
      const plant = place(st, 'util_coal_plant', 10, 26);
      if (load) for (let x = 2; x <= 60; x++) for (const z of [31, 32, 33]) place(st, 't_r2', x, z, { pop: 60 });
      const sim = newSim(st);
      return { e: pol(sim).emissionOf(plant.id), load: getUtilities(sim)!.plantLoad(plant.id), air: st.airPollution[st.idx(12, 28)] };
    };
    const idle = run(false), busy = run(true);
    console.log(`coal plant: idle load ${idle.load.toFixed(2)} emission ${idle.e.toFixed(2)} air ${idle.air.toFixed(2)} | busy load ${busy.load.toFixed(2)} emission ${busy.e.toFixed(2)} air ${busy.air.toFixed(2)}`);
    expect(idle.load).toBe(0);
    expect(busy.load).toBeGreaterThan(0.99);
    expect(idle.e).toBeLessThanOrEqual(0.35 * busy.e);
    expect(idle.air).toBeLessThan(busy.air);
  });

  it('incinerator MW is proportional to the tons it burns; its smoke follows the burn share', () => {
    const run = (towers: number) => {
      const st = newState(64);
      roadLine(st, 2, 30, 60, 30, Network.Road);
      const inc = place(st, 'util_incinerator', 4, 27); // 3x3, touches the road
      for (let k = 0; k < towers; k++) place(st, 't_r3', 10 + (k % 25) * 2, k < 25 ? 31 : 28, { pop: 400, wealth: 3 }); // both sides of the road
      const sim = newSim(st);
      const u = getUtilities(sim)!;
      u.compute(sim); // utilities reads the burn share of the pollution pass
      const g = pol(sim).garbageSummary();
      return { mw: st.stats.powerSupply, burned: g.burnedT, share: pol(sim).incineratorShare(inc.id), smoke: pol(sim).emissionOf(inc.id) };
    };
    const a = run(25), b = run(50);
    console.log(`incinerator: ${a.burned.toFixed(0)} t -> ${a.mw.toFixed(2)} MW, ${b.burned.toFixed(0)} t -> ${b.mw.toFixed(2)} MW`);
    expect(a.burned).toBeGreaterThan(0);
    expect(a.mw).toBeCloseTo((60 * a.burned) / 12000, 3);
    expect(b.mw).toBeCloseTo((60 * b.burned) / 12000, 3);
    expect(b.mw / a.mw).toBeCloseTo(b.burned / a.burned, 3);
    expect(b.smoke).toBeGreaterThan(a.smoke);
    expect(a.share).toBeGreaterThan(0);
  });

  it('averaged over a year, the cell 12 cells downwind gets >= 1.5x the upwind value', () => {
    for (const def of ['util_coal_plant', 'util_incinerator']) {
      const st = newState(96);
      const e = place(st, def, 47, 47);
      const cx = 47 + e.w / 2, cz = 47 + e.d / 2;
      const sim = newSim(st);
      const p = pol(sim);
      const w = windVector(st, 0);
      const th = Math.atan2(w.z, w.x);
      let dn = 0, up = 0;
      for (let d = 0; d < 360; d += 12) {
        st.day = d;
        p.compute(sim, false);
        dn += st.airPollution[st.idx(Math.floor(cx + Math.cos(th) * 12), Math.floor(cz + Math.sin(th) * 12))];
        up += st.airPollution[st.idx(Math.floor(cx - Math.cos(th) * 12), Math.floor(cz - Math.sin(th) * 12))];
      }
      console.log(`${def}: wind to ${w.deg.toFixed(0)} deg, downwind ${dn.toFixed(3)} upwind ${up.toFixed(3)} ratio ${(dn / up).toFixed(2)}`);
      expect(dn).toBeGreaterThan(1.5 * up);
    }
  });

  it('wind is deterministic per seed, varies within about +-40 deg around the prevailing heading', () => {
    const st = newState(32);
    const w0 = windVector(st, 0);
    expect(windVector(st, 0)).toEqual(w0);
    const base = Math.atan2(windVector(st, 0).z, windVector(st, 0).x) - 0.0;
    for (let d = 0; d < 720; d += 5) {
      const w = windVector(st, d);
      expect(w.strength).toBeGreaterThanOrEqual(0.7 - 1e-9);
      expect(w.strength).toBeLessThanOrEqual(1 + 1e-9);
      let diff = Math.atan2(w.z, w.x) - base;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      expect(Math.abs(diff)).toBeLessThan((80 * Math.PI) / 180);
    }
  });

  it('a district under construction makes dust and noise; burning buildings smoke', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Street);
    let site = null as unknown as ReturnType<typeof place>;
    for (let x = 16; x < 24; x++) for (let z = 31; z < 39; z++) site = place(st, 't_r2', x, z, { built: 0.3, flags: BF.Constructing });
    const sim = newSim(st);
    console.log(`construction block: noise ${st.noise[st.idx(20, 35)].toFixed(3)} air ${st.airPollution[st.idx(20, 35)].toFixed(3)}`);
    expect(st.noise[st.idx(20, 35)]).toBeGreaterThan(0.1);
    expect(st.airPollution[st.idx(20, 35)]).toBeGreaterThan(0.04);
    expect(pol(sim).emissionOf(site.id)).toBeGreaterThan(0);
    const house = place(st, 't_r2', 40, 31, { pop: 60 });
    house.flags |= BF.OnFire;
    pol(sim).compute(sim, true);
    expect(st.airPollution[st.idx(40, 31)]).toBeGreaterThan(0.15);
  });
});

describe('WP3 trees and noise', () => {
  it('tree density 4 reduces noise and air by >= 10 %', () => {
    const run = (trees: number) => {
      const st = newState(64);
      roadLine(st, 0, 32, 63, 32, Network.Highway);
      for (let i = 0; i < st.cells; i++) if (st.network[i] === 0) st.trees[i] = trees;
      const sim = newSim(st);
      for (let x = 0; x < 64; x++) st.traffic[st.idx(x, 32)] = 3000;
      pol(sim).compute(sim, true);
      const i = st.idx(32, 36);
      return { noise: st.noise[i], air: st.airPollution[i], cover: st.treeCover[i] };
    };
    const bare = run(0), forest = run(4);
    console.log(`trees: cover ${forest.cover.toFixed(2)} noise ${bare.noise.toFixed(3)} -> ${forest.noise.toFixed(3)}, air ${bare.air.toFixed(4)} -> ${forest.air.toFixed(4)}`);
    expect(forest.cover).toBeGreaterThan(0.9);
    expect(forest.noise).toBeLessThanOrEqual(0.9 * bare.noise);
    expect(forest.air).toBeLessThanOrEqual(0.9 * bare.air);
  });

  it('an empty highway hums (>= 0.15 next to it); a highway trip is louder than a street trip; tunnels are quiet', () => {
    const noiseAt = (net: Network, trips: number, tunnel = false) => {
      const st = newState(64);
      roadLine(st, 0, 32, 63, 32, net);
      if (tunnel) for (let x = 0; x < 64; x++) st.netFlags[st.idx(x, 32)] |= 2;
      const sim = newSim(st);
      for (let x = 0; x < 64; x++) st.traffic[st.idx(x, 32)] = trips;
      pol(sim).compute(sim, true);
      return st.noise[st.idx(32, 33)];
    };
    const emptyHwy = noiseAt(Network.Highway, 0);
    const hwy = noiseAt(Network.Highway, 1000) - emptyHwy;
    const street = noiseAt(Network.Street, 1000) - noiseAt(Network.Street, 0);
    const tunnel = noiseAt(Network.Highway, 1000, true);
    console.log(`noise: empty highway ${emptyHwy.toFixed(3)}, +1000 trips highway ${hwy.toFixed(3)} street ${street.toFixed(3)}, tunnel ${tunnel.toFixed(3)}`);
    expect(emptyHwy).toBeGreaterThanOrEqual(0.15);
    expect(emptyHwy).toBeLessThan(0.45); // an empty highway alone does not flag homes Noisy
    expect(hwy).toBeGreaterThan(street);
    expect(tunnel).toBeLessThan(0.05);
  });

  it('homes next to a busy highway are flagged Noisy; stats.avgNoise / avgAir are resident-weighted', () => {
    const st = newState(64);
    roadLine(st, 0, 32, 63, 32, Network.Highway);
    roadLine(st, 0, 20, 63, 20, Network.Street);
    const near = place(st, 't_r2', 30, 33, { pop: 60 });
    const far = place(st, 't_r2', 30, 21, { pop: 60 });
    const sim = newSim(st);
    for (let x = 0; x < 64; x++) st.traffic[st.idx(x, 32)] = 6000;
    pol(sim).compute(sim, true);
    expect(near.flags & BF.Noisy).toBeTruthy();
    expect(far.flags & BF.Noisy).toBeFalsy();
    expect(st.stats.avgNoise).toBeGreaterThan(0.2);
    expect(st.stats.avgAir).toBeGreaterThan(0);
  });

  it('the quiet-zones ordinance reduces noise', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Avenue);
    for (let x = 10; x <= 16; x++) for (let z = 26; z <= 29; z++) place(st, 't_id', x, z, { jobs: 40 });
    const sim = newSim(st);
    for (let x = 2; x <= 60; x++) st.traffic[st.idx(x, 30)] = 2000;
    pol(sim).compute(sim, true);
    const before = st.noise[st.idx(13, 31)];
    st.stats.population = 5000; // unlock
    expect(setOrdinanceEnabled(st, 'quiet_zones', true).ok).toBe(true);
    pol(sim).compute(sim, true);
    const after = st.noise[st.idx(13, 31)];
    console.log(`quiet zones: noise ${before.toFixed(3)} -> ${after.toFixed(3)}`);
    expect(after).toBeLessThan(before * 0.97);
  });
});

describe('WP3 garbage', () => {
  it('a road-isolated district and one beyond truck range flag NoGarbage within 90 days despite surplus capacity', () => {
    const st = newState(128);
    roadLine(st, 2, 30, 125, 30, Network.Road);
    for (let x = 2; x <= 7; x++) for (let z = 26; z <= 29; z++) st.zone[st.idx(x, z)] = Zone.Landfill;
    const near: ReturnType<typeof place>[] = [], beyond: ReturnType<typeof place>[] = [], isolated: ReturnType<typeof place>[] = [];
    for (let x = 10; x <= 30; x++) near.push(place(st, 't_r2', x, 31, { pop: 60 }));
    for (let x = 105; x <= 124; x++) beyond.push(place(st, 't_r2', x, 31, { pop: 60 })); // > 90 road cells from the landfill
    roadLine(st, 20, 80, 60, 80, Network.Road); // separate road network, no facility
    for (let x = 22; x <= 40; x++) isolated.push(place(st, 't_r2', x, 81, { pop: 60 }));
    const sim = newSim(st);
    st.stats.population = 5000; // (no economy in this test) news needs a town
    sim.runDays(90);
    const flagged = (a: typeof near) => a.filter((b) => b.flags & BF.NoGarbage).length;
    console.log(`garbage: capacity ${st.stats.garbageCapacity.toFixed(0)} t vs produced ${st.stats.garbageProduced.toFixed(0)} t; flagged near ${flagged(near)}/${near.length} beyond ${flagged(beyond)}/${beyond.length} isolated ${flagged(isolated)}/${isolated.length}`);
    expect(st.stats.garbageCapacity).toBeGreaterThan(st.stats.garbageProduced);
    expect(flagged(near)).toBe(0);
    expect(flagged(isolated)).toBe(isolated.length);
    expect(flagged(beyond)).toBe(beyond.length);
    const p = pol(sim);
    expect(p.garbageInfo(isolated[0].id)).toMatchObject({ collected: false, reason: 'range' });
    expect(p.garbageInfo(near[0].id)).toMatchObject({ collected: true });
    expect(p.garbageSummary().outOfRangeBuildings).toBe(beyond.length + isolated.length);
    expect(st.news.filter((n) => n.text.startsWith('Garbage is piling up')).length).toBe(1); // legible, with a cooldown
    // uncollected piles smell and attract crime
    expect(st.airPollution[st.idx(30, 81)]).toBeGreaterThan(st.airPollution[st.idx(30, 60)]);
  });

  it('a landfill fills up cell by cell; full cells give no capacity', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    const cells: number[] = [];
    for (let x = 5; x <= 8; x++) { st.zone[st.idx(x, 29)] = Zone.Landfill; cells.push(st.idx(x, 29)); }
    for (let x = 10; x <= 40; x++) place(st, 't_r3', x, 31 + ((x & 1) * 2), { pop: 400, wealth: 3 });
    const sim = newSim(st);
    const p = pol(sim);
    const cap0 = st.stats.garbageCapacity;
    sim.runDays(120);
    const f = cells.map((i) => st.landfillFill[i]);
    console.log(`landfill fill after 120 days: ${f.map((v) => v.toFixed(3)).join(' ')} mean ${st.stats.landfillFill.toFixed(3)}`);
    expect(st.stats.landfillFill).toBeGreaterThan(0);
    expect(f[0]).toBeGreaterThan(f[3]); // fills in order
    const info = p.landfillInfo(5, 29)!;
    expect(info.cells).toBe(4);
    expect(info.usedT).toBeGreaterThan(0);
    // nearly full -> full: no capacity left, homes stop being collected
    for (const i of cells) st.landfillFill[i] = 0.999;
    sim.runDays(60);
    expect(cells.every((i) => st.landfillFill[i] >= 1)).toBe(true);
    expect(st.stats.garbageCapacity).toBe(0);
    expect(cap0).toBeGreaterThan(0);
    expect(st.garbage[cells[0]]).toBeGreaterThan(0.65); // the garbage map shows a full landfill
  });

  it('a big idle landfill smells less than a small busy one; a 10x10 landfill at ~1 % use stays <= 0.5 next door', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    for (let x = 10; x < 20; x++) for (let z = 20; z < 30; z++) st.zone[st.idx(x, z)] = Zone.Landfill;
    for (let x = 30; x <= 34; x++) place(st, 't_r2', x, 31, { pop: 60 });
    const sim = newSim(st);
    const info = pol(sim).landfillInfo(12, 25)!;
    const use = info.usedT / info.capacityT;
    const nextDoor = st.airPollution[st.idx(21, 25)];
    console.log(`10x10 landfill: use ${(use * 100).toFixed(1)} %, next-door air ${nextDoor.toFixed(3)}, centre ${st.airPollution[st.idx(15, 25)].toFixed(3)}`);
    expect(use).toBeLessThan(0.02);
    expect(nextDoor).toBeLessThanOrEqual(0.5);
  });

  it('recycling diverts up to 35 % of collected garbage; facilities need power and a road', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    place(st, 'util_coal_plant', 50, 26);
    const rec = place(st, 'util_recycling_center', 4, 27);
    for (let x = 10; x <= 40; x++) place(st, 't_r3', x, 31 + ((x & 1) * 2), { pop: 400, wealth: 3 });
    for (let x = 5; x <= 9; x++) for (let z = 20; z <= 22; z++) st.zone[st.idx(x, z)] = Zone.Landfill; // no road -> unusable
    const sim = newSim(st);
    const g = pol(sim).garbageSummary();
    console.log(`recycling: produced ${g.producedT.toFixed(0)} collected ${g.collectedT.toFixed(0)} recycled ${g.recycledT.toFixed(0)}`);
    expect(rec.flags & BF.Powered).toBeTruthy();
    expect(st.stats.garbageRecycled).toBeGreaterThan(0);
    expect(st.stats.garbageRecycled).toBeLessThanOrEqual(0.35 * g.collectedT + 1e-6);
    expect(pol(sim).landfillInfo(6, 21)!.road).toBe(false);
  });

  it('a building with no road on its edge reads "noRoad" (trucks cannot stop there), not "out of range"', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    for (let x = 2; x <= 7; x++) for (let z = 26; z <= 29; z++) st.zone[st.idx(x, z)] = Zone.Landfill;
    const served = place(st, 't_r2', 20, 31, { pop: 60 });
    const lonely = place(st, 't_r2', 20, 45, { pop: 60 }); // no road anywhere near
    const sim = newSim(st);
    sim.runDays(60);
    const p = pol(sim);
    expect(p.garbageInfo(served.id)).toMatchObject({ collected: true });
    expect(p.garbageInfo(lonely.id)).toMatchObject({ collected: false, reason: 'noRoad' });
    expect(p.garbageSummary().noRoadBuildings).toBe(1);
    expect(p.garbageSummary().outOfRangeBuildings).toBe(0);
  });
});

describe('WP3 water', () => {
  it('a polluted river contaminates its banks and cuts the output of a pump drawing from it', () => {
    const run = (dump: boolean) => {
      const st = newState(64);
      for (let z = 0; z < 64; z++) for (let x = 30; x < 34; x++) st.water[st.idx(x, z)] = 1;
      if (dump) place(st, 'rw_toxic_dump', 24, 4);
      roadLine(st, 35, 21, 60, 21, Network.Road);
      const pump = place(st, 't_pump', 35, 20);
      for (let x = 36; x <= 40; x++) place(st, 't_r2', x, 22, { pop: 60 });
      const sim = newSim(st);
      const p = pol(sim);
      for (let k = 0; k < 8; k++) p.compute(sim, false);
      getUtilities(sim)!.compute(sim);
      const info = getUtilities(sim)!.producerInfo(pump.id)!;
      return { bank: st.waterPollution[st.idx(35, 14)], river: st.waterPollution[st.idx(33, 14)], out: info.output, intake: info.load, tap: st.stats.tapWater };
    };
    const clean = run(false), dirty = run(true);
    console.log(`river: clean bank ${clean.bank.toFixed(3)} out ${clean.out.toFixed(0)} tap ${clean.tap.toFixed(2)} | dirty river ${dirty.river.toFixed(3)} bank ${dirty.bank.toFixed(3)} intake ${dirty.intake.toFixed(3)} out ${dirty.out.toFixed(0)} tap ${dirty.tap.toFixed(2)}`);
    expect(dirty.river).toBeGreaterThan(0.1);
    expect(dirty.bank).toBeGreaterThanOrEqual(0.6 * dirty.river - 1e-6);
    expect(dirty.bank).toBeGreaterThan(clean.bank + 0.05);
    expect(clean.out).toBeGreaterThan(145); // fresh water +50 % (minus a little sewage in the ground water)
    expect(dirty.out).toBeLessThan(clean.out * 0.97);
    expect(dirty.tap).toBeLessThan(clean.tap);
  });

  it('sea: edge-touching wide water is sea (rivers and lakes are fresh); sea pumps are brackish; desalination needs the sea', () => {
    const st = newState(64);
    for (let z = 0; z < 64; z++) for (let x = 0; x < 12; x++) st.water[st.idx(x, z)] = 1; // sea on the west edge
    for (let z = 40; z < 46; z++) for (let x = 40; x < 46; x++) st.water[st.idx(x, z)] = 1; // inland lake
    const sea = seaMask(st);
    expect(sea[st.idx(3, 30)]).toBe(1);
    expect(sea[st.idx(42, 42)]).toBe(0);
    expect(shoreCells(st).length).toBeGreaterThan(64);
    roadLine(st, 12, 10, 60, 10, Network.Road);
    roadLine(st, 30, 38, 60, 38, Network.Road);
    const seaPump = place(st, 't_pump', 12, 11);
    const lakePump = place(st, 't_pump', 44, 39);
    const desalSea = place(st, 'util_desalination', 12, 12);
    roadLine(st, 30, 55, 60, 55, Network.Road);
    const desalInland = place(st, 'util_desalination', 30, 50);
    place(st, 'util_coal_plant', 55, 11);
    const sim = newSim(st);
    const u = getUtilities(sim)!;
    const out = (id: number) => u.producerInfo(id)!.output;
    console.log(`sea pump ${out(seaPump.id).toFixed(0)} lake pump ${out(lakePump.id).toFixed(0)} desal sea ${out(desalSea.id).toFixed(0)} inland ${out(desalInland.id).toFixed(0)}`);
    expect(out(seaPump.id)).toBeCloseTo(100 * 0.6, 3);
    expect(out(lakePump.id)).toBeCloseTo(150, 3);
    expect(out(desalSea.id)).toBeCloseTo(80000, 0);
    expect(out(desalInland.id)).toBeLessThanOrEqual(0.2 * 80000 + 1e-6);
  });

  it('generated maps: rivers are fresh water however wide, coasts are sea (edge-share rule)', () => {
    const water = (st: ReturnType<typeof createCityState>) => { let n = 0; for (let i = 0; i < st.cells; i++) if (st.water[i]) n++; return n; };
    for (const seed of [7, 11]) {
      const river = createCityState(defaultCityConfig({ size: 128, seed, terrain: 'river', waterAmount: 0.3 }));
      const coast = createCityState(defaultCityConfig({ size: 128, seed, terrain: 'coast', waterAmount: 0.3 }));
      console.log(`seed ${seed}: river water ${water(river)} sea ${seaCellCount(river)} | coast water ${water(coast)} sea ${seaCellCount(coast)}`);
      expect(water(river)).toBeGreaterThan(500);
      expect(seaCellCount(river)).toBe(0);
      expect(seaCellCount(coast)).toBeGreaterThan(0.9 * water(coast));
    }
  });

  it('tap water quality per network: a polluted intake network is worse than a clean one; treatment cleans it', () => {
    const st = newState(64);
    for (let z = 0; z < 64; z++) for (let x = 30; x < 34; x++) st.water[st.idx(x, z)] = 1;
    place(st, 'rw_toxic_dump', 24, 4);
    roadLine(st, 35, 21, 60, 21, Network.Road); // network A: pump on the polluted river
    place(st, 't_pump', 35, 20);
    const a = place(st, 't_r2', 40, 22, { pop: 60 });
    roadLine(st, 2, 50, 25, 50, Network.Road); // network B: a tower on clean ground
    place(st, 't_tower', 2, 51);
    const b = place(st, 't_r2', 10, 51, { pop: 60 });
    const sim = newSim(st);
    for (let k = 0; k < 8; k++) pol(sim).compute(sim, false);
    getUtilities(sim)!.compute(sim);
    const qa = waterQualityAt(sim, st.idx(a.x, a.z)), qb = waterQualityAt(sim, st.idx(b.x, b.z));
    console.log(`tap water: polluted network ${qa.toFixed(3)} clean network ${qb.toFixed(3)} city ${st.stats.tapWater.toFixed(3)}`);
    expect(qa).toBeLessThan(qb);
    expect(qb).toBeGreaterThan(0.95);
    expect(st.stats.tapWater).toBeGreaterThan(qa - 1e-6);
    expect(st.stats.tapWater).toBeLessThan(qb + 1e-6);
    // treatment (sewage treated share) cleans 70 % of the intake pollution
    place(st, 't_treat', 50, 22);
    pol(sim).compute(sim, false);
    getUtilities(sim)!.compute(sim);
    expect(st.stats.sewageTreated).toBeGreaterThan(0.99);
    expect(waterQualityAt(sim, st.idx(a.x, a.z))).toBeGreaterThan(qa);
  });
});

describe('WP3 soil', () => {
  it('dirty industry contaminates the soil over years; it lingers after demolition; closed landfills leave brownfields', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    const f = place(st, 't_id', 20, 29, { jobs: 40 });
    for (let x = 40; x <= 43; x++) st.zone[st.idx(x, 29)] = Zone.Landfill;
    for (let x = 44; x <= 55; x++) place(st, 't_r2', x, 31, { pop: 60 });
    const sim = newSim(st);
    sim.runDays(360 * 3);
    const s3 = st.soil[st.idx(20, 29)];
    const lf = st.soil[st.idx(41, 29)];
    console.log(`soil after 3 years: factory ${s3.toFixed(3)} landfill ${lf.toFixed(3)}`);
    expect(s3).toBeGreaterThan(0.03);
    // demolish the factory: the soil stays (brownfield), then decays slowly
    st.building[st.idx(20, 29)] = -1;
    st.buildings.delete(f.id);
    sim.runDays(120);
    expect(st.soil[st.idx(20, 29)]).toBeGreaterThan(0.9 * s3);
    // close the landfill: brownfield soil (once); the fill stays with the land
    expect(st.landfillFill[st.idx(40, 29)]).toBeGreaterThan(0);
    const fill = 0.6;
    st.landfillFill[st.idx(40, 29)] = fill; // an old, well-used landfill cell
    for (let x = 40; x <= 43; x++) st.zone[st.idx(x, 29)] = Zone.None;
    sim.runDays(30);
    expect(st.landfillFill[st.idx(40, 29)]).toBeCloseTo(fill, 5);
    expect(st.soil[st.idx(40, 29)]).toBeGreaterThan(0.3 + 0.5 * fill - 0.01);
    const soilClosed = st.soil[st.idx(40, 29)];
    sim.runDays(60);
    expect(st.soil[st.idx(40, 29)]).toBeLessThanOrEqual(soilClosed + 1e-6); // written once, then it decays
    // zoning it as landfill again carries on from the old fill (no free capacity from dezoning)
    for (let x = 40; x <= 43; x++) st.zone[st.idx(x, 29)] = Zone.Landfill;
    sim.runDays(30);
    expect(st.landfillFill[st.idx(40, 29)]).toBeGreaterThanOrEqual(fill - 1e-6);
    // building over the old landfill clears the fill (the soil stays contaminated)
    for (let x = 40; x <= 43; x++) st.zone[st.idx(x, 29)] = Zone.None;
    sim.runDays(30);
    place(st, 't_r2', 40, 29, { pop: 60 });
    sim.runDays(30);
    expect(st.landfillFill[st.idx(40, 29)]).toBe(0);
    expect(st.soil[st.idx(40, 29)]).toBeGreaterThan(0.5);
    // contaminated soil leaches into ground water
    expect(st.waterPollution[st.idx(20, 29)]).toBeGreaterThan(0);
  });
});

describe('WP3 utilities', () => {
  it('thermal plants without cooling water run at half output; nuclear-free zone shuts nuclear plants down (news once)', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    const coal = place(st, 'util_coal_plant', 10, 26);
    const nuke = place(st, 'util_nuclear_plant', 30, 24);
    const sim = newSim(st);
    const u = getUtilities(sim)!;
    expect(u.producerInfo(coal.id)!.output).toBeCloseTo(400, 3); // first pass: unknown -> assumed watered
    u.compute(sim); // second pass: the plants know they have no water
    expect(u.producerInfo(coal.id)!.output).toBeCloseTo(400 * 0.5, 3);
    expect(u.producerInfo(nuke.id)!.output).toBeCloseTo(1600 * 0.5, 3);
    expect(u.producerInfo(coal.id)!.factors.some((f) => f.label === 'No cooling water')).toBe(true);
    // water for both (5,000 kL/day pump; the plants need 3,800)
    place(st, 'util_water_pump', 2, 29);
    for (let k = 0; k < 3; k++) u.compute(sim);
    expect(coal.flags & BF.Watered).toBeTruthy();
    expect(u.producerInfo(coal.id)!.output).toBeCloseTo(400, 3);
    expect(u.producerInfo(nuke.id)!.output).toBeCloseTo(1600, 3);
    st.stats.population = 20000;
    // refused while the plant runs, unless the player confirms (WP5-6 dialog); the reason says what would happen
    const refused = setOrdinanceEnabled(st, 'nuclear_free_zone', true);
    expect(refused.ok).toBe(false);
    expect(refused.needsConfirm).toBe(true);
    expect(refused.reason).toMatch(/shut it down \(−1,600 MW\)/);
    expect(st.budget.ordinances).not.toContain('nuclear_free_zone');
    expect(setOrdinanceEnabled(st, 'nuclear_free_zone', true, { confirm: true }).ok).toBe(true);
    u.compute(sim);
    expect(u.producerInfo(nuke.id)!.output).toBe(0);
    expect(st.news.filter((n) => n.text.startsWith('Nuclear plant shut down by ordinance')).length).toBe(1);
    u.compute(sim);
    expect(st.news.filter((n) => n.text.startsWith('Nuclear plant shut down by ordinance')).length).toBe(1);
    // a plant that delivers nothing has load 0: no smoke, no hum
    expect(u.plantLoad(nuke.id)).toBe(0);
    pol(sim).compute(sim, false);
    expect(pol(sim).emissionOf(nuke.id)).toBe(0);
  });

  it('after a load, an unwatered thermal plant keeps its reduced output (no full-output blip, no repeated news)', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    const coal = place(st, 'util_coal_plant', 10, 26);
    for (let x = 20; x <= 30; x++) place(st, 't_r2', x, 31, { pop: 60 });
    const sim = newSim(st);
    getUtilities(sim)!.compute(sim);
    expect(getUtilities(sim)!.producerInfo(coal.id)!.output).toBeCloseTo(200, 3);
    const loaded = deserializeCity(structuredClone(serializeCity(st)));
    sim.replaceState(loaded);
    expect(getUtilities(sim)!.producerInfo(coal.id)!.output).toBeCloseTo(200, 3);
    expect(loaded.stats.powerSupply).toBeCloseTo(200, 3);
  });

  it('a grid that loses its last plant gets a blackout warning (once per cooldown)', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    const plant = place(st, 't_small_plant', 1, 30);
    place(st, 't_r2', 10, 31, { pop: 60 });
    place(st, 't_r2', 11, 31, { pop: 60 });
    const sim = newSim(st);
    const u = getUtilities(sim)!;
    expect(st.stats.powerSupply).toBeGreaterThan(0);
    expect(st.stats.powerDemand).toBeLessThan(st.stats.powerSupply);
    plant.flags |= BF.Burnt;
    u.compute(sim);
    u.compute(sim);
    expect(st.stats.powerSupply).toBe(0);
    expect(st.news.filter((n) => n.text.startsWith('Blackout')).length).toBe(1);
  });

  it('brownout priority: critical services keep power while nearer homes go dark', () => {
    const st = newState(64);
    roadLine(st, 2, 5, 60, 5, Network.Road);
    place(st, 't_small_plant', 1, 5); // 10 MW at the west end
    const houses = [];
    for (let x = 3; x <= 55; x++) houses.push(place(st, 't_r2', x, 6, { pop: 60 }));
    const clinic = place(st, 'civ_clinic', 58, 6); // 0.2 MW, at the far end
    newSim(st);
    expect(st.stats.powerDemand).toBeGreaterThan(st.stats.powerSupply);
    expect(clinic.flags & BF.Powered).toBeTruthy();
    expect(houses[houses.length - 1].flags & BF.Powered).toBeFalsy();
  });

  it('a short grid runs the brownout search in its own scheduler step (<= 3 ms); a supplied grid skips it', () => {
    const steps = (houses: number) => {
      const st = newState(64);
      roadLine(st, 2, 5, 60, 5, Network.Road);
      place(st, 't_small_plant', 1, 5); // 10 MW
      for (let x = 3; x < 3 + houses; x++) place(st, 't_r2', x, 6, { pop: 60 }); // 3 MW each
      const sim = newSim(st);
      const u = getUtilities(sim)! as unknown as { stepIdx: number; dirtyFull: boolean; step(s: unknown): void };
      u.stepIdx = -1;
      u.dirtyFull = false;
      const seen: number[] = [];
      do { seen.push(u.stepIdx < 0 ? 0 : u.stepIdx); u.step(sim); } while (u.stepIdx >= 0);
      return { seen, powered: [...st.buildings.values()].filter((b) => b.flags & BF.Powered).length };
    };
    const ok = steps(2), short = steps(30);
    expect(ok.seen).not.toContain(3); // uses, power (+ results), water
    expect(short.seen).toContain(3); // ... power sums, brownout BFS, water
    expect(short.powered).toBeGreaterThan(1);
    expect(short.powered).toBeLessThan(31);
  });

  it('wind turbines on a hilltop beat turbines on flat land; parks draw no power', () => {
    const st = newState(64);
    const W = st.size + 1;
    for (let z = 0; z <= st.size; z++) for (let x = 0; x <= st.size; x++) {
      const d = Math.hypot(x - 48, z - 48);
      st.heights[z * W + x] = 5 + Math.max(0, 70 - d * 6);
    }
    roadLine(st, 2, 40, 60, 40, Network.Road);
    const flat = place(st, 'util_wind_turbine', 10, 41);
    const hill = place(st, 'util_wind_turbine', 48, 47);
    roadLine(st, 49, 41, 49, 47, Network.Street);
    const park = place(st, 'park_small', 20, 41);
    const sim = newSim(st);
    const u = getUtilities(sim)!;
    console.log(`wind turbines: flat ${u.producerInfo(flat.id)!.output.toFixed(2)} MW hill ${u.producerInfo(hill.id)!.output.toFixed(2)} MW`);
    expect(u.producerInfo(flat.id)!.output).toBeCloseTo(5 * 0.6, 3);
    expect(u.producerInfo(hill.id)!.output).toBeGreaterThan(5 * 1.2);
    void park;
    expect(st.stats.powerDemand).toBe(0);
  });
});

describe('WP3 crime', () => {
  it('the youth component falls when a high school opens; the curfew halves it', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    const home = place(st, 't_r2', 30, 21, { pop: 60 });
    place(st, 't_coal', 2, 18); // schools need power
    const sim = newSim(st);
    const c = sim.getSystem<CrimeSystem>('crime')!;
    st.stats.population = 20000; // (no economy in this test) youth crime is a town-sized problem
    const y0 = c.termsOf(home.id)!.youth;
    st.budget.ordinances.push('youth_curfew');
    const yCurfew = c.termsOf(home.id)!.youth;
    st.budget.ordinances.length = 0;
    place(st, 'civ_high_school', 32, 21);
    getUtilities(sim)!.compute(sim); // powered school
    sim.getSystem<ServicesSystem>('services')!.compute(sim, false);
    const y1 = c.termsOf(home.id)!.youth;
    console.log(`youth crime: no school ${y0.toFixed(3)} curfew ${yCurfew.toFixed(3)} high school ${y1.toFixed(3)}`);
    expect(y0).toBeGreaterThan(0.05);
    expect(yCurfew).toBeCloseTo(y0 * 0.5, 5);
    expect(y1).toBeLessThan(y0 * 0.5);
  });

  it('youth crime phases in with town size, and does not jump when a far-away first high school opens', () => {
    const st = newState(128);
    roadLine(st, 2, 20, 125, 20, Network.Road);
    const home = place(st, 't_r2', 10, 21, { pop: 60 });
    place(st, 't_coal', 2, 18);
    place(st, 'civ_elementary_school', 12, 21); // next door: elementary coverage, but no high school
    const sim = newSim(st);
    const c = sim.getSystem<CrimeSystem>('crime')!;
    st.stats.population = 1500;
    expect(c.termsOf(home.id)!.youth).toBe(0); // a village
    st.stats.population = 6000;
    const yMid = c.termsOf(home.id)!.youth;
    st.stats.population = 20000;
    const y0 = c.termsOf(home.id)!.youth;
    expect(yMid).toBeCloseTo(y0 * 0.5, 5);
    place(st, 'civ_high_school', 115, 21); // ~100 road tiles away: beyond its catchment
    getUtilities(sim)!.compute(sim);
    sim.getSystem<ServicesSystem>('services')!.compute(sim, false);
    const y1 = c.termsOf(home.id)!.youth;
    console.log(`youth crime at 6k ${yMid.toFixed(3)} 20k ${y0.toFixed(3)}; after a far high school opens ${y1.toFixed(3)}`);
    expect(y0).toBeGreaterThan(0.05);
    expect(y1).toBeLessThanOrEqual(y0 + 1e-6);
  });

  it('a casino spills crime around it; uncollected garbage raises crime', () => {
    const run = (casino: boolean) => {
      const st = newState(64);
      roadLine(st, 2, 20, 60, 20, Network.Road);
      const home = place(st, 't_r2', 30, 21, { pop: 60 });
      if (casino) place(st, 'rw_casino', 30, 15);
      const sim = newSim(st);
      return { st, sim, home, crime: st.crime[st.idx(30, 21)] };
    };
    const a = run(false), b = run(true);
    expect(b.crime).toBeGreaterThan(a.crime + 0.03);
    const c = a.sim.getSystem<CrimeSystem>('crime')!;
    const g0 = c.termsOf(a.home.id)!;
    a.st.garbage[a.st.idx(30, 21)] = 1;
    expect(c.termsOf(a.home.id)!.total).toBeGreaterThan(g0.total + 0.05);
  });
});

describe('WP3 plumes and caches', () => {
  it('a plume shifted over the upwind map edge brings no pollution in from outside the map', () => {
    const N = 16, f = 2, M = N / f;
    const coarse = new Float32Array(M * M).fill(1);
    const acc = new Float32Array(N * N);
    upsampleAdd(coarse, acc, N, f, f * f, 4, 0); // wind blowing towards +x: 4 cells of drift
    expect(acc[3 * N + 2]).toBe(0); // samples beyond the west edge: clean air
    expect(acc[3 * N + 4]).toBeCloseTo(1, 5); // first sample inside the map
    expect(acc[3 * N + 15]).toBeCloseTo(1, 5);
    const acc0 = new Float32Array(N * N);
    upsampleAdd(coarse, acc0, N, f, f * f); // unshifted: unchanged everywhere
    expect(Math.min(...acc0)).toBeCloseTo(1, 5);
  });

  it('a new city (replaceState, building ids restart) does not reuse the old city\'s per-id caches', () => {
    const a = newState(64);
    roadLine(a, 2, 30, 60, 30, Network.Road);
    const coal = place(a, 't_coal', 10, 27);
    const sim = newSim(a);
    const eCoal = pol(sim).emissionOf(coal.id);
    expect(eCoal).toBeGreaterThan(0);
    const b = newState(64);
    roadLine(b, 2, 30, 60, 30, Network.Road);
    const home = place(b, 't_r2', 10, 31, { pop: 60 });
    expect(home.id).toBe(coal.id);
    sim.replaceState(b);
    expect(pol(sim).emissionOf(home.id)).toBeLessThan(0.1 * eCoal); // a home (heating), not the old coal plant
    expect(sim.getSystem<CrimeSystem>('crime')!.termsOf(home.id)!.poverty).toBeCloseTo(0.12, 5); // R$$ home
  });

  it('buildings that appear between the steps of a pass (ids beyond the per-building arrays) never produce NaN', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    for (let x = 2; x <= 7; x++) for (let z = 26; z <= 29; z++) st.zone[st.idx(x, z)] = Zone.Landfill;
    place(st, 't_small_plant', 1, 30);
    place(st, 'util_recycling_center', 50, 27);
    for (let x = 10; x <= 20; x++) place(st, 't_r2', x, 31, { pop: 60 });
    const sim = newSim(st);
    const p = pol(sim) as unknown as { stepIdx: number; step(s: unknown): void; prodById: Float32Array };
    const u = getUtilities(sim)! as unknown as { stepIdx: number; step(s: unknown): void; compute(s: unknown): void };
    for (const sys of [p, u]) {
      sys.stepIdx = -1;
      sys.step(sim); // first step sizes the per-id arrays
      st.nextBuildingId = Math.max(st.nextBuildingId, p.prodById.length + 64);
      place(st, 't_r2', 30 + (sys === p ? 0 : 2), 31, { pop: 60 }); // an id past every array
      let guard = 0;
      while (sys.stepIdx >= 0 && guard++ < 20) sys.step(sim);
    }
    for (const k of ['garbageProduced', 'garbageCapacity', 'garbageRecycled', 'powerSupply', 'powerDemand', 'waterSupply', 'waterDemand', 'avgNoise', 'avgAir'] as const) {
      expect(Number.isFinite(st.stats[k] as number), k).toBe(true);
    }
    for (let i = 0; i < st.cells; i++) if (!Number.isFinite(st.garbage[i]) || !Number.isFinite(st.airPollution[i])) throw new Error(`NaN layer at ${i}`);
  });
});
