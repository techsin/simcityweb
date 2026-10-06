/**
 * One arm of the ISOLATED browser A/B (tools/bench/trafficCore/browserIso.ts): hosted by its own page (own browser
 * context = own renderer process = own V8 isolate) or by a module Worker of that page. Loads the fixture and the wasm
 * binary itself, builds its Simulation, then runs traffic cycles on command. Nothing is shared with the other arms.
 */
import { unpackFile } from '../../../src/save/bundle';
import { deserializeCity } from '../../../src/save/serialize';
import { registerTestDefs } from '../../../tests/infra/cityGen';
import { initSimWasmSync, simWasmInstance, simWasmStatus } from '../../../src/wasm/simWasm';
import { adoptLayers } from '../../../src/wasm/layers';
import { trafficWasmStats, type TrafficWasmCore } from '../../../src/wasm/kernels/trafficBind';
import { baseKind, makeArm, runCycle, type Arm, type ArmKind } from './arms';
import { digestTraffic } from './compare';
import { instanceFrom } from './browserCore';
import { invalidateProtector, makeProtectorProbe } from './protector';
import type { SimWasmInstance } from '../../../src/wasm/simWasm';

export interface ArmHostOpts { kind: ArmKind; testdefs: boolean; resident: boolean }
export interface ArmHost {
  info: Record<string, unknown>;
  /** one traffic cycle: wall ms measured around runCycleSync inside this thread, per-phase ms, steps per phase */
  cycle(): { ms: number; phases: number[]; steps: number[] };
  digest(): { digest: Record<string, number>; stats: Record<string, unknown>; arena: number; lastJsReason: string | null; protector: boolean | null; heap: unknown };
}

export async function makeArmHost(o: ArmHostOpts): Promise<ArmHost> {
  const t0 = performance.now();
  // the probe first (it only sees invalidations after it was optimized; needs natives syntax), then '-inv' arms
  // invalidate the protector like the game's main thread today
  const probe = makeProtectorProbe();
  if (o.kind.endsWith('-inv')) invalidateProtector();
  const wasmBytes = await (await fetch('/sim_kernels.wasm')).arrayBuffer();
  if (!initSimWasmSync(wasmBytes)) throw new Error('wasm init failed: ' + simWasmStatus().error);
  const base = baseKind(o.kind);
  const other = base === 'wasm-scalar' || base === 'wasm-fdlibm'
    ? instanceFrom(await (await fetch(base === 'wasm-scalar' ? '/scalar.wasm' : '/fdlibm.wasm')).arrayBuffer(), base) : null;
  const inst: SimWasmInstance | null = other ?? (base.startsWith('wasm') ? simWasmInstance() : null);
  const file = new Uint8Array(await (await fetch('/fixture.metropolis')).arrayBuffer());
  if (o.testdefs) registerTestDefs();
  // Chromium's streams (DecompressionStream inside unpackFile) do not detach ArrayBuffers: the protector stays intact
  const st = deserializeCity((await unpackFile(file)) as Parameters<typeof deserializeCity>[0]);
  if (o.resident && base.startsWith('wasm')) adoptLayers(st, inst!.heap, { reserveExtra: 32 << 20 });
  const arm: Arm = makeArm(o.kind, st, other ? { [base]: () => other } : {});
  const info = {
    kind: o.kind, pop: st.stats.population, nodes: arm.tr.road.n, oN: arm.tr.oN, stops: arm.tr.stops.n,
    setupMs: performance.now() - t0, simd: inst ? inst.features.simd128 : null, protector: probe ? probe() : null,
  };
  return {
    info,
    cycle() {
      const ms = runCycle(arm);
      return { ms, phases: Array.from(arm.phaseCpu), steps: Array.from(arm.phaseSteps) };
    },
    digest() {
      const w = arm.core as TrafficWasmCore | null;
      return {
        digest: digestTraffic(arm.tr, arm.st), stats: { ...trafficWasmStats }, arena: w && 'arenaBytes' in w ? w.arenaBytes : 0,
        lastJsReason: w && 'lastJsReason' in w ? w.lastJsReason : null, protector: probe ? probe() : null, heap: inst ? inst.heap.stats() : null,
      };
    },
  };
}
