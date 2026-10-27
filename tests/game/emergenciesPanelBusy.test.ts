/**
 * Close-out c2 polish (playtest c2 note): an Emergencies-panel row kept an enabled Dispatch button while every unit that
 * could go was busy (the Dispatch tool then had nothing to send). The button is disabled for a waiting incident no free
 * unit of a responder it still misses can be sent to, and its title says why; it comes back once a unit is free.
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { getFire, triggerDisaster } from '../../src/sim/systems/infra';
import type { GameContext } from '../../src/game/context';
import { EmergenciesPanel, dispatchBlocked } from '../../src/ui/panels/EmergenciesPanel';
import { newSim, newState, place, roadLine } from '../infra/cityGen';
import { type FEl, installFakeDom } from './fakeDom';

installFakeDom();

/** a street along z = 20, a fire station (2 trucks) at x = 4, a home far down the street (beyond its reach) */
function town() {
  const st = newState(96);
  roadLine(st, 2, 20, 93, 20, Network.Road);
  const station = place(st, 't_fire', 4, 19);
  const home = place(st, 't_r2', 60, 21, { pop: 60 });
  const sim = newSim(st);
  getFire(sim)!.riskBoost = 0;
  st.stats.population = 5000;
  return { st, sim, station, home };
}

describe('Emergencies panel: Dispatch while every unit is busy (close-out c2 polish)', () => {
  it('a waiting fire with both trucks out: the row\'s Dispatch button is disabled, its title gives the reason; a free truck enables it', () => {
    const { sim, station, home } = town();
    sim.speed = 1;
    triggerDisaster(sim, 'fire', home.x, home.z);
    sim.runDays(0.05);
    const em = emergencyOf(sim)!;
    const inc = em.incidents()[0];
    expect(inc).toBeDefined();
    expect(['uncovered', 'queued']).toContain(inc.state);
    expect(dispatchBlocked(sim, inc)).toBeNull();
    const ctx = { get state() { return sim.state; }, sim, focusCell: () => undefined, showQuery: () => undefined, sound: () => undefined } as unknown as GameContext;
    const panel = new EmergenciesPanel(ctx);
    panel.mount(() => undefined, () => undefined, () => undefined);
    panel.update();
    const disp = () => (panel.body as unknown as FEl).all().find((e) => e.tagName === 'button' && e.textContent === 'Dispatch')!;
    expect(disp()).toBeDefined();
    expect(disp().disabled).toBe(false);
    expect(disp().title).toBe('Dispatch a unit yourself');
    // both trucks out on other calls (behind the sim's back, as the banner tests do)
    (em as unknown as { out: Map<number, number> }).out.set(station.id, 2);
    const why = dispatchBlocked(sim, inc);
    expect(why).toBeTruthy();
    panel.update();
    expect(disp().disabled).toBe(true);
    expect(disp().title).toBe(why);
    // one is back: the button comes back
    (em as unknown as { out: Map<number, number> }).out.set(station.id, 1);
    panel.update();
    expect(disp().disabled).toBe(false);
    expect(disp().title).toBe('Dispatch a unit yourself');
  });
});
