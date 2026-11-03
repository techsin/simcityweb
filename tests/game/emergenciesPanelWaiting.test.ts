/**
 * T029 (emergency policy part 1): a call inside a station's range whose every unit is out (uncovered, reason 'busy')
 * never raises a banner or slows the game. It stays in the Emergencies panel as "Waiting for a unit", with a Send
 * button for a manual dispatch, and it is not counted in the banner stack's "N more emergencies need you" pill.
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { getFire, triggerDisaster } from '../../src/sim/systems/infra';
import type { GameContext } from '../../src/game/context';
import { EmergenciesPanel } from '../../src/ui/panels/EmergenciesPanel';
import { newSim, newState, place, roadLine } from '../infra/cityGen';
import { type FEl, installFakeDom } from './fakeDom';
import { queryHost } from './queryHost';

installFakeDom();

/** a street along z = 20; a fire station next to a home (in range) with every truck out, a far one with a free truck */
function busyTown() {
  const st = newState(96);
  roadLine(st, 2, 20, 93, 20, Network.Road);
  const far = place(st, 't_fire', 4, 19);
  const near = place(st, 't_fire', 56, 19);
  const home = place(st, 't_r2', 60, 21, { pop: 60 });
  const sim = newSim(st);
  getFire(sim)!.riskBoost = 0;
  st.stats.population = 5000;
  sim.speed = 1;
  sim.runDays(0.05); // the stations' fleets and the road graph are up
  const em = emergencyOf(sim)!;
  const units = em.stationList().find((s) => s.id === near.id)!.units;
  expect(units).toBeGreaterThan(0);
  // every truck of the in-range station is out on other calls (behind the sim's back, as the panel's busy test does)
  (em as unknown as { out: Map<number, number> }).out.set(near.id, units);
  (em as unknown as { stVer: number }).stVer++;
  triggerDisaster(sim, 'fire', home.x, home.z);
  sim.runDays(0.05);
  return { st, sim, em, far, near, home };
}

describe('Emergencies panel: a call waiting for a busy in-range station (T029)', () => {
  it('reads "Waiting for a unit" with an enabled Send button', () => {
    const { sim, em } = busyTown();
    const inc = em.incidents()[0];
    expect(inc).toBeDefined();
    expect(inc.state).toBe('uncovered');
    expect(inc.reason).toBe('busy');
    expect(inc.canSend).toBe(true);
    const abort = new AbortController();
    const ctx = { get state() { return sim.state; }, sim, host: { ...queryHost(sim), simTime: () => sim.simTime() }, signal: abort.signal, focusCell: () => undefined, showQuery: () => undefined, sound: () => undefined } as unknown as GameContext;
    const panel = new EmergenciesPanel(ctx);
    try {
      panel.mount(() => undefined, () => undefined, () => undefined);
      panel.update();
      const all = (panel.body as unknown as FEl).all();
      const send = all.find((e) => e.tagName === 'button' && e.textContent === 'Send');
      expect(send, 'a Send button on the waiting row').toBeDefined();
      expect(send!.disabled).toBe(false);
      expect(all.some((e) => e.tagName === 'button' && e.textContent === 'Dispatch')).toBe(false);
      expect(panel.body.textContent).toContain(`Waiting for a unit — ${inc.note}`);
    } finally { panel.onClose(); abort.abort('dispose'); }
  });
});
