/**
 * Types of the virtual module 'popagg:shell' (tools/bench/populationAggregateProbe/plugins.mjs popShell): the frozen
 * population.ts with the probed region of aggregate() replaced by a kernel call (benchmark bundles only).
 */
declare module 'popagg:shell' {
  import type { SimSystem, Simulation } from '../../../src/sim/Simulation';
  import type { EconRuntime, InfraFlags } from '../../../src/sim/economy/runtime';

  export interface ProbeKernelResult {
    W: number;
    eduSum: number;
    eduPop: number;
    accE: number;
    accW: number;
    unW: number;
    /** the traffic system when it gives worker access (truthy), else undefined */
    tAcc: unknown;
  }
  export interface ProbeKernel {
    run(sim: Simulation, rt: EconRuntime, cache: { wf: Float32Array; ensure(id: number): void }, inf: InfraFlags, first: boolean, sample: boolean,
      demo: boolean, dd: { eduMean: number }, coh: Float64Array): ProbeKernelResult;
  }
  export function populationSystemShell(rt: EconRuntime, kernel: ProbeKernel): SimSystem & { rt: EconRuntime };
}

/**
 * The virtual module 'popagg:js-b' (plugins.mjs jsCopy): a second copy of src/wasm/js/populationAggregateProbe.ts with
 * its own JIT feedback, for arm B.
 */
declare module 'popagg:js-b' {
  // (at runtime the namespace holds every export of src/wasm/js/populationAggregateProbe.ts; importers cast it to
  // ProbeJs from core.ts — an ambient module cannot re-export a relative path)
  const copyOf: 'src/wasm/js/populationAggregateProbe.ts';
  export default copyOf;
}
