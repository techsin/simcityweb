/**
 * Final fixes r4 U3 (lane ui; found by triage r4 while checking playtest polish 9): the Dispatch tool's hover over a
 * station whose whole fleet is out had its own busy line — "All 1 ambulance are busy" for a clinic, "All 2 fire trucks
 * are busy" for a fire station. It now uses the sim's busy-note words (emergency.ts, final fixes r3 / r4): "The only
 * ambulance is busy", "Both fire trucks are busy", "All 5 fire trucks are busy".
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import type { Building, CityState } from '../../src/sim/CityState';
import type { Simulation } from '../../src/sim/Simulation';
import { RESPONDER_UNIT, emergencyOf } from '../../src/sim/infra/emergency';
import { getFire } from '../../src/sim/systems/infra';
import { DispatchTool, allBusyText } from '../../src/game/tools/DispatchTool';
import type { ToolPointer } from '../../src/game/tools/Tool';
import type { GameContext } from '../../src/game/context';
import { newSim, newState, place, roadLine } from '../infra/cityGen';

describe('Dispatch tool: a station with every unit out (final fixes r4 U3)', () => {
  it('the words: the only one / both / all N', () => {
    expect(allBusyText(1, RESPONDER_UNIT.medical)).toBe('The only ambulance is busy');
    expect(allBusyText(2, RESPONDER_UNIT.fire)).toBe('Both fire trucks are busy');
    expect(allBusyText(3, RESPONDER_UNIT.medical)).toBe('All 3 ambulances are busy');
    expect(allBusyText(5, RESPONDER_UNIT.fire)).toBe('All 5 fire trucks are busy');
    expect(allBusyText(1, RESPONDER_UNIT.police)).toBe(`The only ${RESPONDER_UNIT.police[0]} is busy`);
  });

  /** a street with a fire station (2 trucks) and a clinic (1 ambulance), both far from a home and a workshop */
  function town(): { st: CityState; sim: Simulation; fire: Building; clinic: Building; home: Building } {
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    const fire = place(st, 't_fire', 4, 19);
    const clinic = place(st, 't_clinic', 8, 19);
    const home = place(st, 't_r2', 50, 21, { pop: 60 });
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    st.stats.population = 5000;
    return { st, sim, fire, clinic, home };
  }

  /** the tool's hover tooltip over a station while it targets incident `id` */
  function hoverTip(sim: Simulation, id: number, station: Building): string {
    const tips: string[] = [];
    const ctx = {
      get state() { return sim.state; },
      sim,
      tip: { show: (html: string) => tips.push(html), hide: () => undefined, move: () => undefined },
      world: { setHighlight: () => undefined },
      ui: { on: () => () => undefined },
      toast: () => undefined,
      focusCell: () => undefined,
      tools: { select: () => true },
    } as unknown as GameContext;
    const tool = new DispatchTool(ctx);
    tool.target(id);
    const p: ToolPointer = { clientX: 0, clientY: 0, hit: { x: station.x, z: station.z } as ToolPointer['hit'], shift: false, ctrl: false, alt: false, down: false };
    tool.move(p);
    expect(tips.length).toBeGreaterThan(0);
    return tips.at(-1)!;
  }

  it('hovering a busy fire station (2 trucks) / clinic (1 ambulance): "Both fire trucks are busy", "The only ambulance is busy"', () => {
    const { sim, fire, clinic, home } = town();
    const em = emergencyOf(sim)!;
    const out = (em as unknown as { out: Map<number, number> }).out;
    const id = em.spawn(sim, 'medical', home.x, home.z, { buildingId: home.id });
    // free: the usual line
    expect(hoverTip(sim, id, clinic)).toMatch(/1 of 1 ambulances free · ETA/);
    // every unit out (behind the sim's back, as in the banner tests)
    out.set(clinic.id, 1);
    const tip = hoverTip(sim, id, clinic);
    expect(tip).toContain('The only ambulance is busy');
    expect(tip).not.toMatch(/All 1 ambulance/);
    // a fire: both trucks of the station out
    const f = em.spawn(sim, 'fire', home.x, home.z, { buildingId: home.id });
    out.set(fire.id, 2);
    const ft = hoverTip(sim, f, fire);
    expect(ft).toContain('Both fire trucks are busy');
    expect(ft).not.toMatch(/All 2 fire trucks/);
  });
});
