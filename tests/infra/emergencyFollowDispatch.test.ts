import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import type { EmergencyEvent } from '../../src/sim/Simulation';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { getFire } from '../../src/sim/systems/infra';
import { newSim, newState, place, roadLine } from './cityGen';

function supportingTown(kind: 'industrial' | 'collapse') {
  const st = newState(64);
  roadLine(st, 2, 20, 62, 20, Network.Road);
  place(st, 't_fire', 4, 19); // outside automatic reach; keeps the primary responder's prompt open
  const spare = place(st, 't_clinic', 46, 19);
  place(st, 't_clinic', 48, 19); // nearest ambulance goes automatically
  const site = kind === 'industrial' ? place(st, 't_id', 50, 21, { jobs: 40 }) : place(st, 't_r2', 50, 21, { pop: 60 });
  const sim = newSim(st);
  getFire(sim)!.riskBoost = 0;
  const events: EmergencyEvent[] = [];
  sim.events.on('emergency', e => events.push(e));
  const em = emergencyOf(sim)!;
  const id = em.spawn(sim, kind, site.x, site.z, { buildingId: site.id });
  expect(id).toBeGreaterThan(0);
  return { st, sim, em, id, spare, events };
}

describe('supporting responder dispatch events for camera follow', () => {
  it.each(['industrial', 'collapse'] as const)('a player-sent ambulance emits dispatched while %s still waits for its fire truck', kind => {
    const { st, sim, em, id, spare, events } = supportingTown(kind);
    const inc = em.incident(id)!;
    const waiting = { state: inc.state, reason: inc.reason, note: inc.note, manualPossible: inc.manualPossible, canSend: inc.canSend };
    expect(waiting.state).toBe('uncovered');
    expect(waiting.manualPossible).toBe(true);
    const before = em.vehicles().map(v => v.id);
    events.length = 0;

    expect(em.dispatch(sim, id, spare.id)).toMatchObject({ ok: true, sent: 1 });

    expect(events.filter(e => e.type === 'dispatched')).toEqual([
      expect.objectContaining({ id, kind, type: 'dispatched', manualPossible: true }),
    ]);
    const sent = em.vehicles().filter(v => !before.includes(v.id));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ incidentId: id, stationId: spare.id, responder: 'medical', state: 'outbound' });
    expect({ state: inc.state, reason: inc.reason, note: inc.note, manualPossible: inc.manualPossible, canSend: inc.canSend }).toEqual(waiting);
    expect(inc.answered).toBe(0);
    expect(inc.etaMin).toBeUndefined();
    expect(st.stats.emergency.manualActive).toBe(1);
    expect(st.stats.emergency.month.manual).toBe(0);
    expect(st.stats.emergency.month.auto).toBe(0);
  });

  it.each(['industrial', 'collapse'] as const)('an automatically sent ambulance adds no dispatched event for a waiting %s', kind => {
    const { em, id, events } = supportingTown(kind);
    expect(em.vehicles()).toHaveLength(1);
    expect(em.vehicles()[0]).toMatchObject({ incidentId: id, responder: 'medical' });
    expect(em.incident(id)).toMatchObject({ state: 'uncovered', manualPossible: true, answered: 0 });
    expect(events.filter(e => e.type === 'dispatched')).toEqual([]);
    expect(events.some(e => e.type === 'uncovered' && e.id === id)).toBe(true);
  });
});
