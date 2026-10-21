/**
 * Final fixes r4 U3 (lane ui; found by triage r4 while checking playtest polish 9): the Dispatch tool's hover over a
 * station whose whole fleet is out had its own busy line — "All 1 ambulance are busy" for a clinic, "All 2 fire trucks
 * are busy" for a fire station. It now uses the sim's busy-note words (emergency.ts, final fixes r3 / r4): "The only
 * ambulance is busy", "Both fire trucks are busy", "All 5 fire trucks are busy".
 * Close-out c1: the free line of a one-unit station read "1 of 1 ambulances free" and "Click: send 1 · Shift-click: send
 * 1" — now "Its only ambulance is free" / "Click: send it"; Shift-click is offered only with 2 or more units free.
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import type { Building, CityState } from '../../src/sim/CityState';
import type { Simulation } from '../../src/sim/Simulation';
import { RESPONDER_UNIT, emergencyOf } from '../../src/sim/infra/emergency';
import { getFire } from '../../src/sim/systems/infra';
import { DispatchTool, allBusyText, freeUnitsText } from '../../src/game/tools/DispatchTool';
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

  it('close-out c1: the free words — the only one, N of M, and Shift-click only with 2+ free', () => {
    expect(freeUnitsText(1, 1, RESPONDER_UNIT.medical)).toEqual({ free: 'Its only ambulance is free', click: 'Click: send it' });
    expect(freeUnitsText(2, 2, RESPONDER_UNIT.fire)).toEqual({ free: '2 of 2 fire trucks free', click: 'Click: send 1 · Shift-click: send 2' });
    expect(freeUnitsText(1, 2, RESPONDER_UNIT.fire)).toEqual({ free: '1 of 2 fire trucks free', click: 'Click: send 1' });
    expect(freeUnitsText(3, 4, RESPONDER_UNIT.police).click).toBe('Click: send 1 · Shift-click: send 3');
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
    // free: its only ambulance (close-out c1: it read "1 of 1 ambulances free" / "Shift-click: send 1")
    const freeTip = hoverTip(sim, id, clinic);
    expect(freeTip).toMatch(/Its only ambulance is free · ETA/);
    expect(freeTip).toContain('Click: send it');
    expect(freeTip).not.toMatch(/1 of 1 ambulances|Shift-click/);
    // every unit out (behind the sim's back, as in the banner tests)
    out.set(clinic.id, 1);
    const tip = hoverTip(sim, id, clinic);
    expect(tip).toContain('The only ambulance is busy');
    expect(tip).not.toMatch(/All 1 ambulance/);
    // a fire: both trucks of the station out
    const f = em.spawn(sim, 'fire', home.x, home.z, { buildingId: home.id });
    // (both free: N of M, Shift-click sends both; one out: no Shift-click)
    const both = hoverTip(sim, f, fire);
    expect(both).toMatch(/2 of 2 fire trucks free · ETA/);
    expect(both).toContain('Click: send 1 · Shift-click: send 2');
    out.set(fire.id, 1);
    const one = hoverTip(sim, f, fire);
    expect(one).toMatch(/1 of 2 fire trucks free · ETA/);
    expect(one).not.toMatch(/Shift-click/);
    out.set(fire.id, 2);
    const ft = hoverTip(sim, f, fire);
    expect(ft).toContain('Both fire trucks are busy');
    expect(ft).not.toMatch(/All 2 fire trucks/);
  });
});
