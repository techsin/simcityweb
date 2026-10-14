/**
 * WP8 final fixes (emergency lane, item P1): an incident with a supporting responder — an industrial accident or a
 * building collapse needs a fire truck (primary) and an ambulance — keeps waiting for its PRIMARY responder when only
 * the ambulance can be sent automatically. The auto-sent ambulance used to mark it 'dispatched' (banner gone, LIVE mode
 * over, no fire truck ever requested) and the plant burned. The player's window for an industrial accident is its
 * ignition (dispatchWindowEnd): a fire truck dispatched before it saves the plant.
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import type { Simulation } from '../../src/sim/Simulation';
import { dispatchWindowEnd, emergencyOf, stationRange, type EmergencySystem } from '../../src/sim/infra/emergency';
import { getDef } from '../../src/sim/catalog';
import { EMERG_GRACE } from '../../src/sim/infra/params';
import { getFire } from '../../src/sim/systems/infra';
import { newSim, newState, place, roadLine } from './cityGen';

/** a street along z = 20; a fire station at x = 4 (4.6 min from the site at x = 50, beyond its 2.6-min reach), a clinic
 *  next to the site (in reach) and the site: a factory (industrial) or a home (collapse) */
function town(kind: 'industrial' | 'collapse'): { st: CityState; sim: Simulation; em: EmergencySystem; site: Building; id: number } {
  const st = newState(64);
  roadLine(st, 2, 20, 62, 20, Network.Road);
  place(st, 't_fire', 4, 19);
  place(st, 't_clinic', 48, 19);
  const site = kind === 'industrial' ? place(st, 't_id', 50, 21, { jobs: 40 }) : place(st, 't_r2', 50, 21, { pop: 60 });
  const sim = newSim(st);
  getFire(sim)!.riskBoost = 0; // no random ignitions
  const em = emergencyOf(sim)!;
  const id = em.spawn(sim, kind, site.x, site.z, { buildingId: site.id });
  expect(id).toBeGreaterThan(0);
  return { st, sim, em, site, id };
}

describe('supporting responders never end the wait for the primary one (P1)', () => {
  it('industrial accident outside fire coverage, clinic in reach: the ambulance goes, the accident stays uncovered with the Dispatch prompt', () => {
    expect(stationRange(getDef('t_fire'), 'fire')).toBeLessThan(4.6);
    const { st, sim, em, id } = town('industrial');
    const inc = em.incident(id)!;
    expect(inc.state).toBe('uncovered');
    expect(inc.reason).toBe('outOfRange');
    expect(inc.manualPossible).toBe(true);
    expect(inc.canSend).toBe(true);
    // (counted as a prompt from the day's settle point on — EM-1 — see below)
    expect(inc.prompted).toBeFalsy();
    expect(inc.note).toMatch(/Outside fire coverage/);
    expect(inc.bestEta).toBeCloseTo(4.6, 5);
    // the ambulance was sent automatically; it answers nothing: no fire truck is on its way
    expect(em.vehicles().map((v) => v.responder)).toEqual(['medical']);
    expect(inc.answered).toBe(0);
    expect(inc.etaMin).toBeUndefined();
    expect(st.stats.emergency.manualActive).toBe(1);
    expect(st.stats.emergency.month.auto).toBe(0);
    // the window is the ignition, 3 days after the start; the next automatic attempt comes before it
    expect(dispatchWindowEnd(inc)).toBe(inc.start + EMERG_GRACE.industrial);
    expect(inc.retry).toBeLessThanOrEqual(dispatchWindowEnd(inc) - 1);
    // a day later the ambulance is on scene: still waiting for the fire truck (not 'onScene')
    sim.runDays(1);
    expect(inc.firstAt.medical).toBeDefined();
    expect(inc.state).toBe('uncovered');
    expect(inc.manualPossible).toBe(true);
    expect(inc.prompted).toBe(true);
    expect(st.stats.emergency.manualActive).toBe(1);
  });

  it('nobody sends a fire truck: the plant ignites at the end of the window and the prompt counts as ignored', () => {
    const { st, sim, em, site, id } = town('industrial');
    const start = em.incident(id)!.start;
    sim.runDays(EMERG_GRACE.industrial - 1);
    expect(site.flags & BF.OnFire).toBe(0);
    expect(em.incident(id)!.manualPossible).toBe(true);
    sim.runDays(1);
    expect(st.day).toBe(start + EMERG_GRACE.industrial);
    expect(site.flags & BF.OnFire).toBeTruthy();
    expect(em.incident(id)).toBeUndefined();
    const m = st.stats.emergency.month;
    expect(m.failed).toBe(1);
    expect(m.ignored).toBe(1);
    expect(m.count.fire).toBe(1);
  });

  it('a fire truck the player dispatches before the ignition saves the plant', () => {
    const { st, sim, em, site, id } = town('industrial');
    sim.runDays(1);
    const r = em.dispatchBest(sim, id);
    expect(r.ok).toBe(true);
    expect(r.responder).toBe('fire');
    expect(r.missing).toBeUndefined();
    const inc = em.incident(id)!;
    // the ambulance is on scene, the fire truck (the primary responder) on its way: dispatched, answered by the player
    expect(inc.state).toBe('dispatched');
    expect(inc.answered).toBe(2);
    expect(inc.manualPossible).toBe(false);
    expect(st.stats.emergency.manualActive).toBe(0);
    sim.runDays(15);
    expect(site.flags & (BF.OnFire | BF.Burnt)).toBe(0);
    expect(em.incident(id)).toBeUndefined();
    const m = st.stats.emergency.month;
    expect(m.manual).toBe(1);
    expect(m.auto).toBe(0);
    expect(m.failed).toBe(0);
    expect(m.ignored).toBe(0);
    expect(m.count.fire).toBe(0);
  });

  it('a covered accident is still answered automatically (fire truck + ambulance) and only becomes statistics', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    place(st, 't_fire', 44, 19);
    place(st, 't_clinic', 48, 19);
    const f = place(st, 't_id', 50, 21, { jobs: 40 });
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    const em = emergencyOf(sim)!;
    const id = em.spawn(sim, 'industrial', f.x, f.z, { buildingId: f.id });
    const inc = em.incident(id)!;
    expect(inc.state).toBe('dispatched');
    expect(em.vehicles().map((v) => v.responder).sort()).toEqual(['fire', 'medical']);
    expect(inc.answered).toBe(1);
    sim.runDays(10);
    expect(em.incident(id)).toBeUndefined();
    expect(f.flags & (BF.OnFire | BF.Burnt)).toBe(0);
    expect(st.stats.emergency.month.auto).toBe(1);
    expect(st.stats.emergency.month.failed).toBe(0);
  });

  it('collapse outside fire coverage: same rule — waits for the fire truck after the ambulance left; a dispatch resolves it, nobody fails it', () => {
    const a = town('collapse');
    const inc = a.em.incident(a.id)!;
    expect(inc.state).toBe('uncovered');
    expect(inc.reason).toBe('outOfRange');
    expect(inc.manualPossible).toBe(true);
    expect(a.em.vehicles().map((v) => v.responder)).toEqual(['medical']);
    expect(dispatchWindowEnd(inc)).toBe(inc.deadline);
    a.sim.runDays(2);
    expect(inc.state).toBe('uncovered');
    expect(a.em.dispatchBest(a.sim, a.id).ok).toBe(true);
    expect(inc.state).toBe('dispatched');
    a.sim.runDays(15);
    expect(a.em.incident(a.id)).toBeUndefined();
    expect(a.st.stats.emergency.month.manual).toBe(1);
    expect(a.st.stats.emergency.month.failed).toBe(0);
    // nobody answers: it fails at its deadline, an ignored prompt
    const b = town('collapse');
    b.sim.runDays(16);
    expect(b.em.incident(b.id)).toBeUndefined();
    expect(b.st.stats.emergency.month.failed).toBe(1);
    expect(b.st.stats.emergency.month.ignored).toBe(1);
  });

  it('"Send nearest" with no free fire truck sends the ambulance and says which unit is still missing', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    place(st, 't_clinic', 4, 19); // too far to be sent automatically (4.6 min > its 2.3-min reach)
    const f = place(st, 't_id', 50, 21, { jobs: 40 });
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    const em = emergencyOf(sim)!;
    const id = em.spawn(sim, 'industrial', f.x, f.z, { buildingId: f.id });
    const inc = em.incident(id)!;
    // no fire station at all: noStation, no prompt; the ambulance beyond its reach is still sent (supporting responders
    // get the nearest free unit that makes it in time)
    expect(inc.state).toBe('uncovered');
    expect(inc.reason).toBe('noStation');
    expect(inc.manualPossible).toBe(false);
    expect(em.vehicles().map((v) => v.responder)).toEqual(['medical']);
    const r = em.dispatchBest(sim, id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('No free fire truck can reach this place');
    expect(r.missing).toEqual(['fire']);
  });
});
