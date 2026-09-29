/**
 * Benchmark arms: a Simulation of the benchmark tree whose TrafficSystem runs
 *   orig        the tree's own traffic.ts + search.ts (untouched)
 *   fair        the driver + the fair optimised-JS core (src/wasm/js/trafficCore.ts) + the fair JS searches
 *   wasm        the driver + the wasm core (src/wasm/kernels/trafficBind.ts), shipped SIMD binary
 *   wasm-scalar the driver + the wasm core on a second instance of the scalar build (same Rust, no simd128)
 *   wasm-imp    the driver + the wasm core on a benchmark-only build whose exp / log are imported JS functions
 * The core is installed BEFORE Simulation.init (the warm-start cycle already runs on it). Per-phase CPU time of every
 * traffic step is accumulated in `phaseCpu` (step() dispatches by phase: the wrapper reads the phase before the call).
 */
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import type { CityState } from '../../../src/sim/CityState';
import { installTrafficCore, type TrafficCoreHandle } from '../../../src/wasm/kernels/trafficDriver';
import { makeFairTrafficCore } from '../../../src/wasm/js/trafficCore';
import { makeWasmTrafficCore } from '../../../src/wasm/kernels/trafficBind';
import type { TrafficCoreApi } from '../../../src/wasm/kernels/trafficLayout';
import type { SimWasmInstance } from '../../../src/wasm/simWasm';
import { deps, fairSearch, P } from './deps';

export type ArmKind = 'orig' | 'fair' | 'wasm' | 'wasm-scalar' | 'wasm-imp';
export const PHASE_NAMES = ['prep', 'prepTransit', 'transit', 'roundSearch', 'roundMatch', 'commute', 'inbound', 'shop', 'freight', 'final', 'final2'];

export const cpuMs = (): number => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};

export interface Arm {
  kind: ArmKind;
  sim: Simulation;
  st: CityState;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  tr: any;
  core: TrafficCoreApi | null;
  handle: TrafficCoreHandle | null;
  /** CPU ms per phase since the last reset (11 phases) */
  phaseCpu: Float64Array;
  /** steps per phase since the last reset */
  phaseSteps: Float64Array;
  /** CPU ms of Simulation construction (includes the warm-start cycle) */
  initMs: number;
}

export function makeArm(kind: ArmKind, st: CityState, instances: Partial<Record<ArmKind, () => SimWasmInstance | null>> = {}): Arm {
  const systems = createSystems();
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const tr = systems.find((s) => s.name === 'traffic') as any;
  let core: TrafficCoreApi | null = null;
  if (kind === 'fair') core = makeFairTrafficCore(P, fairSearch);
  else if (kind !== 'orig') core = makeWasmTrafficCore(P, { search: fairSearch, instance: instances[kind], label: kind });
  const handle = core ? installTrafficCore(tr, deps, core) : null;
  const phaseCpu = new Float64Array(PHASE_NAMES.length), phaseSteps = new Float64Array(PHASE_NAMES.length);
  const step = tr.step.bind(tr);
  tr.step = (sim: Simulation) => {
    const ph = tr.phase;
    const t0 = cpuMs();
    try {
      step(sim);
    } finally {
      if (ph >= 0) { phaseCpu[ph] += cpuMs() - t0; phaseSteps[ph]++; }
    }
  };
  const t0 = cpuMs();
  const sim = new Simulation(st, systems);
  return { kind, sim, st, tr, core, handle, phaseCpu, phaseSteps, initMs: cpuMs() - t0 };
}

/** one full traffic assignment (TrafficSystem.runCycleSync); returns its CPU ms */
export function runCycle(a: Arm): number {
  a.phaseCpu.fill(0);
  a.phaseSteps.fill(0);
  const t0 = cpuMs();
  a.tr.runCycleSync(a.sim);
  return cpuMs() - t0;
}
