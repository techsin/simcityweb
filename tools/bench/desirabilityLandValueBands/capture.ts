/**
 * Node side of the band captures: load a .metropolis fixture, simulate `warm` days (headless, all systems) and capture
 * the inputs of the daily bands (see core.ts). Bundled with the tree redirect of plugins.mjs, so the simulation is the
 * frozen 24f8609 one unless the live tree is requested.
 */
import { readFileSync } from 'node:fs';
import { deserializeCity, type SerializedCity } from '../../../src/save/serialize';
import { unpackFile } from '../../../src/save/bundle';
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import type { EconRuntime } from '../../../src/sim/economy/runtime';
import { captureFrom, type EconCapture } from './core';

export function econRuntimeOf(sim: Simulation): EconRuntime {
  const rt = (sim.systems.find((s) => s.name === 'economy.population') as unknown as { rt?: EconRuntime } | undefined)?.rt;
  if (!rt) throw new Error('no economy runtime');
  return rt;
}

export async function loadFixture(file: string): Promise<ReturnType<typeof deserializeCity>> {
  const bytes = new Uint8Array(readFileSync(file));
  return deserializeCity((await unpackFile(bytes)) as SerializedCity);
}

export async function captureFixture(file: string, warm: number): Promise<EconCapture> {
  const st = await loadFixture(file);
  const sim = new Simulation(st, createSystems());
  for (let d = 0; d < warm; d++) sim.advanceDay();
  const name = file.split('/').pop()!.replace(/\.metropolis$/, '');
  return captureFrom(name, sim.state, econRuntimeOf(sim));
}
