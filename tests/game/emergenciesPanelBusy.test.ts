/**
 * Close-out c2 polish (playtest c2 note): an Emergencies-panel row kept an enabled Dispatch button while every unit that
 * could go was busy (the Dispatch tool then had nothing to send). The button is disabled for a waiting incident no free
 * unit of a responder it still misses can be sent to, and its title says why; it comes back once a unit is free.
 */
import { describe, expect, it, vi } from 'vitest';
import { Network } from '../../src/core/types';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { getFire, triggerDisaster } from '../../src/sim/systems/infra';
import type { GameContext } from '../../src/game/context';
import { EmergenciesPanel, dispatchBlocked } from '../../src/ui/panels/EmergenciesPanel';
import { newSim, newState, place, roadLine } from '../infra/cityGen';
import { type FEl, installFakeDom } from './fakeDom';
import { queryHost } from './queryHost';

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
    expect(dispatchBlocked(em, inc, em.dispatchOptions(sim, inc.id))).toBeNull();
    const abort = new AbortController();
    const ctx = { get state() { return sim.state; }, sim, host: { ...queryHost(sim), simTime: () => sim.simTime() }, signal: abort.signal, focusCell: () => undefined, showQuery: () => undefined, sound: () => undefined } as unknown as GameContext;
    const panel = new EmergenciesPanel(ctx);
    panel.mount(() => undefined, () => undefined, () => undefined);
    panel.update();
    const disp = () => (panel.body as unknown as FEl).all().find((e) => e.tagName === 'button' && e.textContent === 'Dispatch')!;
    expect(disp()).toBeDefined();
    expect(disp().disabled).toBe(false);
    expect(disp().title).toBe('Dispatch a unit yourself');
    // both trucks out on other calls (behind the sim's back, as the banner tests do)
    (em as unknown as { out: Map<number, number> }).out.set(station.id, 2);
    const why = dispatchBlocked(em, inc, em.dispatchOptions(sim, inc.id));
    expect(why).toBeTruthy();
    panel.update();
    expect(disp().disabled).toBe(true);
    expect(disp().title).toBe(why);
    // one is back: the button comes back
    (em as unknown as { out: Map<number, number> }).out.set(station.id, 1);
    panel.update();
    expect(disp().disabled).toBe(false);
    expect(disp().title).toBe('Dispatch a unit yourself');
    panel.onClose();
    abort.abort('dispose');
  });

  it('uses current view records and releases option watches on tab change, close and city abort', () => {
    const { sim, home } = town();
    triggerDisaster(sim, 'fire', home.x, home.z);
    sim.runDays(0.05);
    const em = emergencyOf(sim)!, inc = em.incidents()[0];
    const host = { ...queryHost(sim), simTime: () => sim.simTime() };
    host.emergency.incidents = () => structuredClone(em.incidents());
    host.emergency.incident = (id) => structuredClone(em.incident(id));
    const watch = host.watch.bind(host), closes: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(host, 'watch').mockImplementation((...args) => {
      const w = watch(...args);
      const close = vi.fn(w.dispose.bind(w));
      w.dispose = close;
      closes.push(close);
      return w;
    });
    const abort = new AbortController();
    const ctx = {
      get state() { return sim.state; },
      get sim() { throw new Error('The panel must read through its host'); },
      host, signal: abort.signal, focusCell: vi.fn(), showQuery: vi.fn(), sound: vi.fn(),
    } as unknown as GameContext;
    const panel = new EmergenciesPanel(ctx);
    try {
      panel.mount(() => {}, () => {}, () => {});
      panel.update();
      expect(closes).toHaveLength(1);
      inc.note = 'Both fire trucks are busy';
      panel.update();
      expect(panel.body.textContent).toContain(inc.note);
      panel.showTab('fleet');
      expect(closes[0]).toHaveBeenCalledTimes(1);
      panel.showTab('stats');
      expect(closes).toHaveLength(1);
      panel.showTab('active');
      expect(closes).toHaveLength(2);
      panel.onClose();
      expect(closes[1]).toHaveBeenCalledTimes(1);
      panel.update();
      expect(closes).toHaveLength(3);
      abort.abort('dispose');
      expect(closes[2]).toHaveBeenCalledTimes(1);
    } finally { panel.onClose(); abort.abort('dispose'); }
  });
});
