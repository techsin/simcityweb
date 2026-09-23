import { describe, expect, it } from 'vitest';
import { Network, Overlay, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import {
  activeDisasters, getFire, overlayLayer, overlayValue, triggerDisaster, type ServicesSystem, type PollutionSystem,
  type CrimeSystem,
} from '../../src/sim/systems/infra';
import { newSim, newState, place, roadLine } from './cityGen';

describe('pollution', () => {
  it('dirty industry pollutes nearby air much more than far away; clean air act reduces it', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    for (let x = 10; x <= 16; x++) for (let z = 26; z <= 29; z++) place(st, 't_id', x, z, { jobs: 40 });
    const sim = newSim(st);
    const p = sim.getSystem<PollutionSystem>('pollution')!;
    p.compute(sim, true);
    const near = st.airPollution[st.idx(13, 28)];
    const far = st.airPollution[st.idx(55, 10)];
    console.log(`air near=${near.toFixed(3)} far=${far.toFixed(4)} noise=${st.noise[st.idx(13, 28)].toFixed(3)} water=${st.waterPollution[st.idx(13, 28)].toFixed(3)}`);
    expect(near).toBeGreaterThan(0.4);
    expect(far).toBeLessThan(0.02);
    expect(st.noise[st.idx(13, 28)]).toBeGreaterThan(0.05);
    const b = st.buildings.get(st.building[st.idx(13, 28)])!;
    expect(b.flags & BF.Polluted).toBeTruthy();
    st.budget.ordinances.push('clean_air_act');
    p.compute(sim, true);
    expect(st.airPollution[st.idx(13, 28)]).toBeLessThan(near);
  });

  it('garbage piles up without collection and is collected by landfill zones / incinerators', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    const homes = [];
    for (let x = 5; x <= 50; x++) homes.push(place(st, 't_r2', x, 31, { pop: 60 }));
    const sim = newSim(st);
    sim.runDays(90);
    expect(st.stats.garbageProduced).toBeGreaterThan(0);
    expect(st.stats.garbageCapacity).toBe(0);
    expect(homes.filter((h) => h.flags & BF.NoGarbage).length).toBeGreaterThan(homes.length / 2);
    // landfill zone with road access
    for (let x = 5; x <= 10; x++) for (let z = 27; z <= 29; z++) st.zone[st.idx(x, z)] = Zone.Landfill;
    sim.runDays(60);
    expect(st.stats.garbageCapacity).toBeGreaterThan(st.stats.garbageProduced);
    expect(homes.filter((h) => h.flags & BF.NoGarbage).length).toBe(0);
    expect(st.garbage[st.idx(7, 28)]).toBeGreaterThan(0.3); // landfill shows on the garbage map
  });

  it('water pollution spreads along water bodies', () => {
    const st = newState(64);
    for (let z = 0; z < 64; z++) for (let x = 30; x < 34; x++) st.water[st.idx(x, z)] = 1;
    roadLine(st, 20, 5, 29, 5, Network.Road);
    for (let x = 26; x <= 29; x++) for (let z = 6; z <= 8; z++) place(st, 't_id', x, z, { jobs: 40 });
    const sim = newSim(st);
    const p = sim.getSystem<PollutionSystem>('pollution')!;
    for (let k = 0; k < 6; k++) p.compute(sim, false);
    const nearWater = st.waterPollution[st.idx(31, 7)];
    const downstream = st.waterPollution[st.idx(31, 20)];
    console.log(`water near=${nearWater.toFixed(3)} 13 cells along=${downstream.toFixed(4)}`);
    expect(nearWater).toBeGreaterThan(0.05);
    expect(downstream).toBeGreaterThan(0.01);
    expect(downstream).toBeLessThan(nearWater);
  });
});

describe('pollution with real catalog defs', () => {
  it('coal plant (air 1.0, radius 14) pollutes heavily nearby, little 30 cells away', () => {
    const st = newState(64);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    place(st, 'util_coal_plant', 10, 26); // 4x4
    const sim = newSim(st);
    sim.getSystem<PollutionSystem>('pollution')!.compute(sim, true);
    const near = st.airPollution[st.idx(12, 28)];
    const far = st.airPollution[st.idx(45, 28)];
    console.log(`coal plant air near=${near.toFixed(2)} far(33 cells)=${far.toFixed(3)} noise=${st.noise[st.idx(12, 28)].toFixed(2)}`);
    expect(near).toBeGreaterThan(0.75);
    expect(far).toBeLessThan(0.15);
    expect(st.stats.powerSupply).toBeCloseTo(400, 0);
  });
});

describe('services', () => {
  it('coverage follows roads, attenuates with distance, is blocked by water without bridges, scales with funding', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 28, 20, Network.Road);
    roadLine(st, 34, 20, 60, 20, Network.Road); // across a river, no bridge
    for (let z = 0; z < 64; z++) for (let x = 29; x < 34; x++) st.water[st.idx(x, z)] = 1;
    place(st, 't_police', 20, 21);
    const sim = newSim(st);
    const s = sim.getSystem<ServicesSystem>('services')!;
    const near = st.policeCov[st.idx(21, 21)];
    const mid = st.policeCov[st.idx(5, 21)];
    const across = st.policeCov[st.idx(36, 21)];
    console.log(`police near=${near.toFixed(2)} mid=${mid.toFixed(2)} across river=${across.toFixed(2)}`);
    expect(near).toBeGreaterThan(0.9);
    expect(mid).toBeLessThan(near);
    expect(mid).toBeGreaterThan(0.1);
    expect(across).toBe(0);
    st.budget.funding.police = 50;
    s.compute(sim, false);
    expect(st.policeCov[st.idx(21, 21)]).toBeCloseTo(near * Math.pow(0.5, 0.7), 1); // sim-core curve: funding^0.7
    // bridge the river -> coverage crosses
    roadLine(st, 29, 20, 33, 20, Network.Road);
    st.budget.funding.police = 100;
    s.compute(sim, false);
    expect(st.policeCov[st.idx(36, 21)]).toBeGreaterThan(0);
  });

  it('capacity factor: an overcrowded school is less effective; EQ drifts toward coverage', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    place(st, 't_school', 20, 21); // capacity 1000 pupils
    const homes = [];
    for (let x = 10; x <= 30; x++) homes.push(place(st, 't_r2', x, 19, { pop: 60 })); // 1260 res -> 277 pupils
    const sim = newSim(st);
    const s = sim.getSystem<ServicesSystem>('services')!;
    const small = st.eduCov[st.idx(22, 19)];
    for (const h of homes) h.pop = 600; // 12600 residents -> 2772 pupils > 1000
    s.compute(sim, false);
    const crowded = st.eduCov[st.idx(22, 19)];
    console.log(`school coverage: normal=${small.toFixed(2)} crowded=${crowded.toFixed(2)}`);
    expect(crowded).toBeLessThan(small * 0.6);
    const eq0 = st.stats.eq;
    for (const h of homes) h.pop = 60;
    for (let k = 0; k < 50; k++) s.compute(sim, false);
    expect(st.stats.eq).toBeGreaterThan(eq0);
  });

  it('transit coverage around bus stops and overlay helper', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    place(st, 't_bus', 20, 21);
    st.netFlags[st.idx(40, 20)] |= 1 << 4; // road-cell bus stop
    newSim(st);
    expect(st.transitCov[st.idx(20, 22)]).toBeGreaterThan(0.4);
    expect(st.transitCov[st.idx(40, 21)]).toBeGreaterThan(0.4);
    expect(st.transitCov[st.idx(30, 40)]).toBe(0);
    expect(overlayLayer(st, Overlay.Transit)!.data).toBe(st.transitCov);
    expect(overlayValue(st, Overlay.Transit, 20, 22)).toBeGreaterThan(0.4);
    expect(overlayLayer(st, Overlay.Traffic)!.roadsOnly).toBe(true);
  });
});

describe('crime', () => {
  it('poor dense areas have more crime; police coverage and ordinances reduce it', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    for (let x = 5; x <= 25; x++) place(st, 't_r1', x, 21, { pop: 12, wealth: 1 });
    for (let x = 35; x <= 55; x++) place(st, 't_r3', x, 21 + ((x - 35) % 2) * 0, { pop: 50, wealth: 3 });
    st.stats.unemployment = 0.15;
    const sim = newSim(st);
    const c = sim.getSystem<CrimeSystem>('crime')!;
    c.compute(sim, true);
    const poor = st.crime[st.idx(15, 21)], rich = st.crime[st.idx(45, 21)];
    expect(poor).toBeGreaterThan(rich);
    place(st, 't_police', 15, 19);
    sim.getSystem<ServicesSystem>('services')!.compute(sim, false);
    c.compute(sim, true);
    const policed = st.crime[st.idx(15, 21)];
    expect(policed).toBeLessThan(poor * 0.5);
    st.budget.ordinances.push('neighborhood_watch');
    c.compute(sim, true);
    expect(st.crime[st.idx(15, 21)]).toBeLessThan(policed);
    expect(st.stats.avgCrime).toBeGreaterThan(0);
  });
});

describe('fire & disasters', () => {
  it('fires burn out to rubble without coverage and are extinguished with coverage', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    const a = place(st, 't_r2', 10, 21, { pop: 60 });
    const b = place(st, 't_r2', 50, 21, { pop: 60 });
    place(st, 't_fire', 52, 19);
    const sim = newSim(st);
    expect(st.fireCov[st.idx(50, 21)]).toBeGreaterThan(0.6);
    const fire = getFire(sim)!;
    fire.riskBoost = 0; // no random ignitions
    const events: string[] = [];
    sim.events.on('disaster', (d) => events.push(`${d.kind}:${d.active}`));
    expect(triggerDisaster(sim, 'fire', 10, 21)).toBe(true);
    expect(triggerDisaster(sim, 'fire', 50, 21)).toBe(true);
    expect(a.flags & BF.OnFire).toBeTruthy();
    expect(events).toContain('fire:true');
    sim.runDays(10);
    expect(b.flags & (BF.OnFire | BF.Burnt)).toBe(0); // put out by the fire station
    expect(a.flags & BF.Burnt).toBeTruthy(); // burnt down
    expect(events).toContain('fire:false');
    expect(st.news.some((n) => n.kind === 'disaster')).toBe(true);
  });

  it('tornado destroys buildings along its path; meteor leaves a crater; earthquake damages', () => {
    const st = newState(64);
    for (let z = 5; z < 60; z += 3) roadLine(st, 2, z, 60, z, Network.Street);
    let n = 0;
    for (let z = 6; z < 60; z += 3) for (let x = 3; x < 60; x++) { place(st, 't_r1', x, z, { pop: 10 }); n++; }
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    const h0 = st.heights[32 * 65 + 32];
    expect(triggerDisaster(sim, 'meteor', 32, 32)).toBe(true);
    expect(st.heights[32 * 65 + 32]).toBeLessThan(h0 - 3);
    expect(st.building[st.idx(32, 33)]).toBe(-1); // removed in the crater
    expect(st.buildings.size).toBeLessThan(n);
    expect(triggerDisaster(sim, 'tornado', 15, 15)).toBe(true);
    expect(activeDisasters(sim).some((d) => d.kind === 'tornado')).toBe(true);
    sim.runDays(6);
    expect(activeDisasters(sim).some((d) => d.kind === 'tornado')).toBe(false);
    const burnt = [...st.buildings.values()].filter((b) => b.flags & BF.Burnt).length;
    expect(burnt).toBeGreaterThan(5);
    expect(triggerDisaster(sim, 'earthquake', 45, 45)).toBe(true);
    const burnt2 = [...st.buildings.values()].filter((b) => b.flags & BF.Burnt).length;
    expect(burnt2).toBeGreaterThan(burnt);
  });
});
