/** NOTE-022: the tornado's tree damage has its own map event, so W1.1a's replica can stay exact after every packet. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CellRect } from '../../src/core/events';
import { activeDisasters, triggerDisaster } from '../../src/sim/systems/infra';
import { ROOT, sourceFiles } from '../worker/hygieneScan';
import { newSim, newState } from './cityGen';

/** the bounds of the cells that differ, or null */
function changed(before: Uint8Array, after: Uint8Array, N: number): CellRect | null {
  let x0 = N, z0 = N, x1 = 0, z1 = 0;
  for (let i = 0; i < after.length; i++) {
    if (after[i] === before[i]) continue;
    const x = i % N, z = Math.floor(i / N);
    x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x + 1); z1 = Math.max(z1, z + 1);
  }
  return x1 > 0 ? { x0, z0, x1, z1 } : null;
}

function runTornado(trees: number) {
  const st = newState(64);
  st.trees.fill(trees);
  const sim = newSim(st);
  let before = st.trees.slice();
  // recorded, not asserted, inside the listeners: a throw there would stop the sim mid-step
  const steps: { reported: CellRect; actual: CellRect | null; raised: boolean }[] = [];
  const ends: (CellRect | null)[] = [];
  sim.events.on('treesDamaged', (r) => {
    let raised = false;
    for (let i = 0; i < st.trees.length; i++) if (st.trees[i] > before[i]) raised = true;
    steps.push({ reported: { ...r }, actual: changed(before, st.trees, st.size), raised });
    before = st.trees.slice();
  });
  sim.events.on('treesChanged', () => { ends.push(changed(before, st.trees, st.size)); before = st.trees.slice(); });
  expect(triggerDisaster(sim, 'tornado', 32, 32)).toBe(true);
  sim.runDays(6);
  expect(activeDisasters(sim).some((d) => d.kind === 'tornado')).toBe(false);
  return { steps, ends, unreported: changed(before, st.trees, st.size) };
}

describe('treesDamaged (NOTE-022)', () => {
  it('each tornado step that lowers trees reports exactly their bounds; the end still sends treesChanged', () => {
    const { steps, ends, unreported } = runTornado(4);
    expect(steps.length).toBeGreaterThan(1);
    for (const s of steps) {
      expect(s.reported).toEqual(s.actual);
      expect(s.raised).toBe(false);
    }
    // the end's treesChanged follows the last step's report, with nothing written in between or after
    expect(ends).toEqual([null]);
    expect(unreported).toBeNull();
  });

  it('a tornado that lowers no tree emits nothing', () => {
    const { steps, ends, unreported } = runTornado(0);
    expect(steps).toEqual([]);
    expect(ends).toEqual([null]);
    expect(unreported).toBeNull();
  });

  it('nothing in the sim listens to it (pollution.ts reacts to treesChanged), so the bot is unchanged', () => {
    const uses = sourceFiles('src/sim').flatMap((file) => readFileSync(join(ROOT, file), 'utf8').split('\n')
      .map((line) => line.trim()).filter((line) => line.includes('treesDamaged') && !/^(\*|\/\*\*|\/\/)/.test(line))
      .map((line) => `${file}: ${line}`));
    expect(uses).toEqual([
      'src/sim/Simulation.ts: treesDamaged: CellRect;',
      "src/sim/infra/disasters.ts: if (x1 > 0) sim.events.emit('treesDamaged', { x0, z0, x1, z1 });",
    ]);
  });
});
