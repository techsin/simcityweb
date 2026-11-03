/** LG-09: difficulty changes disaster thresholds and player windows without changing draw order or automatic response. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RNG } from '../../src/core/rng';
import type { Difficulty } from '../../src/core/types';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { BF } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { DisastersSystem } from '../../src/sim/infra/disasters';
import { dispatchWindowEnd, EmergencySystem } from '../../src/sim/infra/emergency';
import { FireSystem } from '../../src/sim/infra/fire';
import { newState, place, roadLine } from '../infra/cityGen';

afterEach(() => vi.restoreAllMocks());

describe('LG-09 monthly disaster thresholds', () => {
  it.each([
    ['easy', 1], ['medium', 1], ['hard', 1.5], ['expert', 3], ['sandbox', 1],
  ] as const)('%s scales one monthly decision and keeps both location draws', (difficulty, multiplier) => {
    const st = newState(64, true);
    st.config.difficulty = difficulty;
    st.stats.population = 2000;
    const sys = new DisastersSystem();
    const sim = new Simulation(st, [sys]);
    const trigger = vi.spyOn(sys, 'trigger').mockReturnValue(true);
    const next = vi.spyOn(RNG.prototype, 'next');
    for (const [roll, kind] of [
      [0, 'tornado'], [0.0079, 'tornado'], [0.008, 'earthquake'], [0.0119, 'earthquake'],
      [0.012, 'meteor'], [0.0144, 'meteor'], [0.0145, undefined], [0.2, undefined],
    ] as const) {
      next.mockReset().mockReturnValueOnce(roll * multiplier).mockReturnValueOnce(0.25).mockReturnValueOnce(0.75);
      trigger.mockClear();
      sys.monthly(sim);
      expect(next).toHaveBeenCalledTimes(3);
      if (kind) expect(trigger).toHaveBeenCalledExactlyOnceWith(sim, kind, 20, 44);
      else expect(trigger).not.toHaveBeenCalled();
    }
  });

  it('Medium retains the legacy monthly random stream and exact decisions', () => {
    const st = newState(64, true);
    st.stats.population = 2000;
    const sys = new DisastersSystem();
    const sim = new Simulation(st, [sys]);
    const trigger = vi.spyOn(sys, 'trigger').mockReturnValue(true);
    const rng = new RNG((st.config.seed ^ 0xd15a) + st.day);
    for (let month = 0; month < 240; month++) {
      const r = rng.next();
      const x = rng.int(8, st.size - 9), z = rng.int(8, st.size - 9);
      const kind = r < 0.008 ? 'tornado' : r < 0.012 ? 'earthquake' : r < 0.0145 ? 'meteor' : undefined;
      trigger.mockClear();
      sys.monthly(sim);
      expect((st.systemData.infraDisasters as { rng: number }).rng).toBe(rng.state);
      if (kind) expect(trigger).toHaveBeenCalledExactlyOnceWith(sim, kind, x, z);
      else expect(trigger).not.toHaveBeenCalled();
    }
  });

  it('the disaster setting and minimum population still suppress all draws', () => {
    const st = newState(64, false);
    st.config.difficulty = 'expert';
    st.stats.population = 2000;
    const sys = new DisastersSystem();
    const sim = new Simulation(st, [sys]);
    const next = vi.spyOn(RNG.prototype, 'next');
    sys.monthly(sim);
    st.config.disasters = true;
    st.stats.population = 1999;
    sys.monthly(sim);
    expect(next).not.toHaveBeenCalled();
  });
});

function emergencyTown(difficulty: Difficulty, stationX = 4) {
  const st = newState(64);
  st.config.difficulty = difficulty;
  roadLine(st, 2, 20, 62, 20);
  const station = place(st, 't_fire', stationX, 19, { flags: BF.Powered });
  const site = place(st, 't_id', 50, 21);
  const fire = new FireSystem();
  const em = new EmergencySystem();
  const sim = new Simulation(st, [fire, em]);
  fire.riskBoost = 0;
  return { st, station, site, fire, em, sim };
}

describe('LG-09 manual dispatch windows', () => {
  it.each(['easy', 'medium', 'hard', 'sandbox'] as const)('%s keeps the saved incident shape and original window', (difficulty) => {
    const { sim, em, site } = emergencyTown(difficulty);
    const inc = em.incident(em.spawn(sim, 'spill', site.x, site.z))!;
    expect(inc).not.toHaveProperty('manualDispatchWindowMultiplier');
    expect(dispatchWindowEnd(inc)).toBe(inc.deadline);
  });

  it('Expert closes the player window at 75% while leaving the deadline, grace and late dispatch available', () => {
    const expert = emergencyTown('expert');
    const medium = emergencyTown('medium');
    const ei = expert.em.incident(expert.em.spawn(expert.sim, 'spill', expert.site.x, expert.site.z))!;
    const mi = medium.em.incident(medium.em.spawn(medium.sim, 'spill', medium.site.x, medium.site.z))!;
    expect(ei.deadline).toBe(mi.deadline);
    expect(ei.grace).toBe(mi.grace);
    expect(ei.manualDispatchWindowMultiplier).toBe(0.75);
    expect(dispatchWindowEnd(ei)).toBe(ei.start + (mi.deadline - mi.start) * 0.75);
    expert.sim.runDays(23);
    medium.sim.runDays(23);
    expect(mi.manualPossible).toBe(true);
    expect(ei.manualPossible).toBe(false);
    expect(ei.canSend).toBe(true);
    expect(expert.em.incident(ei.id)).toBe(ei);
    expect(expert.em.dispatchBest(expert.sim, ei.id).ok).toBe(true);
  });

  it('Expert industrial prompts shorten from the original ignition tick without moving the automatic retry or ignition', () => {
    const { sim, em, site } = emergencyTown('expert');
    const inc = em.incident(em.spawn(sim, 'industrial', site.x, site.z, { severity: 1 }))!;
    expect(dispatchWindowEnd(inc)).toBe(2.25);
    expect(dispatchWindowEnd(inc, false)).toBe(3);
    expect(inc.retry).toBe(2);
    sim.runDays(2);
    expect(site.flags & BF.OnFire).toBe(0);
    expect(em.incident(inc.id)).toBe(inc);
    sim.runDays(1);
    expect(site.flags & BF.OnFire).toBeTruthy();
    expect(em.incident(inc.id)).toBeUndefined();
  });

  it('Expert keeps an industrial accident queued for an automatic truck returning before ignition', () => {
    const { sim, em, site, station } = emergencyTown('expert', 44);
    const holding = em.spawn(sim, 'spill', site.x, site.z);
    expect(em.dispatch(sim, holding, station.id).ok).toBe(true);
    expect(em.stationFleet(station.id)!.free).toBe(0);
    for (const v of em.vehicles()) {
      v.state = 'returning';
      v.arrive = 2;
    }
    const inc = em.incident(em.spawn(sim, 'industrial', site.x, site.z, { severity: 1 }))!;
    expect(dispatchWindowEnd(inc)).toBe(2.25);
    expect(inc.state).toBe('queued');
    expect(inc.reason).toBe('busy');
    expect(inc.retry).toBe(1);
  });

  it('Expert covered incidents use the same automatic dispatch and response timing as Medium', () => {
    const expert = emergencyTown('expert', 44);
    const medium = emergencyTown('medium', 44);
    const ei = expert.em.incident(expert.em.spawn(expert.sim, 'spill', expert.site.x, expert.site.z))!;
    const mi = medium.em.incident(medium.em.spawn(medium.sim, 'spill', medium.site.x, medium.site.z))!;
    expect(ei.state).toBe('dispatched');
    expect(ei.answered).toBe(1);
    expect(ei.deadline).toBe(mi.deadline);
    expect(expert.em.vehicles()).toEqual(medium.em.vehicles());
    expert.sim.runDays(15);
    medium.sim.runDays(15);
    expect(expert.st.stats.emergency).toEqual(medium.st.stats.emergency);
    expect(expert.em.vehicles()).toEqual(medium.em.vehicles());
  });

  it('the optional Expert window survives saving and old incidents retain their original window', () => {
    const { st, em, sim, site } = emergencyTown('expert');
    const inc = em.incident(em.spawn(sim, 'spill', site.x, site.z))!;
    const restored = deserializeCity(serializeCity(st, { copy: true }));
    const loaded = new EmergencySystem();
    new Simulation(restored, [new FireSystem(), loaded]);
    const saved = loaded.incident(inc.id)!;
    expect(dispatchWindowEnd(saved)).toBe(dispatchWindowEnd(inc));
    expect(saved.manualDispatchWindowMultiplier).toBe(0.75);
    const oldIncident = { kind: 'industrial', start: 0.25, deadline: 12.25 } as const;
    expect(dispatchWindowEnd(oldIncident)).toBe(4);
    expect(dispatchWindowEnd({ kind: 'spill', start: 0.25, deadline: 30.25 })).toBe(30.25);
  });
});
