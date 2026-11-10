/**
 * B2 merged with W1.1's replica (cloud/b2m): a building flag never changes across a piece boundary without its
 * buildingChanged event. The worker's recorder ships building records on buildingChanged and audits the exact fields
 * (`flags` among them, protocol.ts EXACT_FIELDS) at every packet, and a packet can close between any two scheduler
 * steps, so every piece that flips a flag must also emit the events for it. B2's split passes first flipped the flags in a
 * publish piece and emitted the events in later pieces (crime, pollution's garbage and air / noise flags, utilities,
 * traffic's final2); tests/worker/replica*.test.ts and lag.test.ts caught it at a packet boundary on the 128² stress city.
 * Here every step of every infra task is checked, at production and at tiny piece sizes, on cities whose passes flip the
 * flags of every one of those tasks.
 */
import { describe, expect, it } from 'vitest';
import { BF, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { infraSystems } from '../../src/sim/systems/infra';
import { buildingList, removeBuilding } from '../../src/sim/infra/common';
import { schedulerOf, withPieceScale } from '../../src/sim/infra/scheduler';
import { registerTestDefs, stressCity } from './cityGen';
import { envCity } from './envCity';
import { utilCity } from './infraCity';

/** the bits each task owns, for the coverage count */
const OWNER: [string, number][] = [
  ['crime', BF.Crime], ['pollution', BF.Polluted | BF.Noisy | BF.NoGarbage], ['utilities', BF.Powered | BF.Watered],
  ['traffic', BF.NoJobs | BF.Congested],
];

interface Run { flips: Map<string, number>; silent: string[]; steps: number }

function run(st: CityState, days: number, scale: number, edit?: (sim: Simulation, day: number) => void): Run {
  registerTestDefs();
  const sim = new Simulation(st, infraSystems());
  const sch = schedulerOf(sim);
  const flips = new Map<string, number>(), silent: string[] = [];
  let announced = new Set<number>(), steps = 0;
  sim.events.on('buildingChanged', (b) => { announced.add(b.id); });
  for (const t of sch.tasks) {
    const step = t.step.bind(t);
    t.step = (s) => {
      const before = new Map<number, number>();
      for (const b of buildingList(sim.state)) before.set(b.id, b.flags);
      announced = new Set();
      step(s);
      steps++;
      for (const b of buildingList(sim.state)) {
        const f0 = before.get(b.id);
        if (f0 === undefined || f0 === b.flags) continue;
        for (const [task, bits] of OWNER) if ((f0 ^ b.flags) & bits) flips.set(task, (flips.get(task) ?? 0) + 1);
        if (!announced.has(b.id) && silent.length < 5) silent.push(`${t.name}: building ${b.id} flags ${f0} -> ${b.flags} without buildingChanged in the step`);
      }
    };
  }
  withPieceScale(scale, () => {
    for (let d = 0; d < days; d++) {
      edit?.(sim, d);
      sim.advanceDay();
    }
  });
  return { flips, silent, steps };
}

/** every 10 days a plant, pump or station goes, every 15 days one of the city's road cells: brownouts and congestion */
function edits(sim: Simulation, day: number): void {
  const st = sim.state;
  if (day > 0 && day % 10 === 0) {
    const util = buildingList(st).filter((b) => /plant|pump|tower|station/.test(b.def));
    if (util.length > 1) removeBuilding(sim, util[(day / 10) % util.length]);
  }
}

describe('B2 x W1.1: flag flips and their buildingChanged events share a piece', () => {
  for (const [label, scale] of [['production pieces', 1], ['small pieces', 0.05]] as const) {
    it(`${label}: the stress, utilities and environment cities (every infra task's flags)`, { timeout: 600_000 }, () => {
      const total = new Map<string, number>();
      const runs = [
        run(stressCity(96, 7).st, 60, scale, edits),
        run(utilCity(64, 11, 'short'), 45, scale, edits),
        run(envCity(64, 17), 45, scale),
      ];
      for (const r of runs) {
        expect(r.silent, label).toEqual([]);
        for (const [k, v] of r.flips) total.set(k, (total.get(k) ?? 0) + v);
      }
      // (the cities really flip every task's flags, so the check above is not vacuous)
      for (const [task] of OWNER) expect(total.get(task) ?? 0, `${task} flips`).toBeGreaterThan(0);
      console.log(`[b2FlagEvents] ${label}: flips ${JSON.stringify(Object.fromEntries(total))}, steps ${runs.map((r) => r.steps).join(' / ')}`);
    });
  }
});
